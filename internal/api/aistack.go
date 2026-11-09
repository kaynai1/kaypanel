package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"kaypanel/internal/ai"
	"kaypanel/internal/node"
)

type aiStackReq struct {
	NodeID string `json:"node_id"`
	Prompt string `json:"prompt"`
}

type aiStackRaw struct {
	Name        string          `json:"name"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Compose     string          `json:"compose"`
	Notes       json.RawMessage `json:"notes"`
	Warnings    json.RawMessage `json:"warnings"`
}

var badStackName = regexp.MustCompile(`[^a-z0-9_-]+`)

func sanitizeStackName(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = badStackName.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-_")
	if len(s) > 40 {
		s = strings.Trim(s[:40], "-_")
	}
	if s == "" || !node.ValidStackName(s) {
		return "ai-app"
	}
	return s
}

func extractJSONObject(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.Index(s, "```"); i >= 0 {
		rest := s[i+3:]
		if j := strings.Index(rest, "\n"); j >= 0 {
			rest = rest[j+1:]
		}
		if k := strings.Index(rest, "```"); k >= 0 {
			rest = rest[:k]
		}
		s = strings.TrimSpace(rest)
	}
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start >= 0 && end > start {
		return s[start : end+1]
	}
	return s
}

func stringList(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var list []string
	if json.Unmarshal(raw, &list) == nil {
		return list
	}
	var one string
	if json.Unmarshal(raw, &one) == nil && strings.TrimSpace(one) != "" {
		return []string{one}
	}
	return nil
}

func cleanList(in []string, max int) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if r := []rune(s); len(r) > 160 {
			s = string(r[:160]) + "…"
		}
		out = append(out, s)
		if len(out) == max {
			break
		}
	}
	return out
}

// validateCompose accepts only pull-based, non-privileged single-file compose apps.
func validateCompose(compose string) (services int, images []string, err error) {
	compose = strings.TrimSpace(compose)
	if compose == "" {
		return 0, nil, fmt.Errorf("Compose 内容为空")
	}
	if len(compose) > 64*1024 {
		return 0, nil, fmt.Errorf("Compose 内容过大")
	}
	lower := strings.ToLower(compose)
	for _, bad := range []string{"docker.sock", "network_mode: host", "network_mode: \"host\"", "pid: host", "privileged: true", "privileged:true"} {
		if strings.Contains(lower, bad) {
			return 0, nil, fmt.Errorf("包含不允许的配置：%s", bad)
		}
	}
	var doc map[string]any
	if err := yaml.Unmarshal([]byte(compose), &doc); err != nil {
		return 0, nil, fmt.Errorf("YAML 解析失败：%v", err)
	}
	rawServices, ok := doc["services"]
	if !ok {
		return 0, nil, fmt.Errorf("缺少 services 字段")
	}
	serviceMap, ok := rawServices.(map[string]any)
	if !ok || len(serviceMap) == 0 {
		return 0, nil, fmt.Errorf("services 配置无效")
	}
	if len(serviceMap) > 5 {
		return 0, nil, fmt.Errorf("服务数量不能超过 5 个")
	}
	for name, raw := range serviceMap {
		svc, ok := raw.(map[string]any)
		if !ok {
			return 0, nil, fmt.Errorf("服务 %s 配置无效", name)
		}
		image, _ := svc["image"].(string)
		if strings.TrimSpace(image) == "" {
			return 0, nil, fmt.Errorf("服务 %s 缺少 image", name)
		}
		if _, ok := svc["build"]; ok {
			return 0, nil, fmt.Errorf("服务 %s 不允许使用 build", name)
		}
		if p, _ := svc["privileged"].(bool); p {
			return 0, nil, fmt.Errorf("服务 %s 不允许 privileged", name)
		}
		if nm, _ := svc["network_mode"].(string); strings.EqualFold(strings.TrimSpace(nm), "host") {
			return 0, nil, fmt.Errorf("服务 %s 不允许 host 网络", name)
		}
		if pid, _ := svc["pid"].(string); strings.EqualFold(strings.TrimSpace(pid), "host") {
			return 0, nil, fmt.Errorf("服务 %s 不允许 host PID", name)
		}
		if list, ok := svc["devices"].([]any); ok && len(list) > 0 {
			return 0, nil, fmt.Errorf("服务 %s 不允许挂载设备", name)
		}
		if list, ok := svc["cap_add"].([]any); ok && len(list) > 0 {
			return 0, nil, fmt.Errorf("服务 %s 不允许添加 capabilities", name)
		}
		if list, ok := svc["volumes"].([]any); ok {
			for _, item := range list {
				if s, ok := item.(string); ok && strings.Contains(strings.ToLower(s), "docker.sock") {
					return 0, nil, fmt.Errorf("服务 %s 不允许挂载 Docker socket", name)
				}
			}
		}
		images = append(images, strings.TrimSpace(image))
	}
	sort.Strings(images)
	return len(serviceMap), images, nil
}

func (s *Server) handleAIStack(w http.ResponseWriter, r *http.Request) {
	var req aiStackReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		writeErr(w, http.StatusBadRequest, "请描述要部署的应用")
		return
	}
	if len([]rune(prompt)) > 500 {
		writeErr(w, http.StatusBadRequest, "需求描述最多 500 字")
		return
	}
	n, ok := s.mgr.Get(req.NodeID)
	if !ok {
		writeErr(w, http.StatusNotFound, "节点不存在")
		return
	}
	if n.View().SFTPOnly {
		writeErr(w, http.StatusBadRequest, "虚拟主机不支持部署应用")
		return
	}
	set := s.store.Settings()
	if strings.TrimSpace(set.AIBase) == "" || strings.TrimSpace(set.AIKey) == "" || strings.TrimSpace(set.AIModel) == "" {
		writeErr(w, http.StatusBadRequest, "请先在设置中配置 AI 接口")
		return
	}
	v := n.View()
	existing := []string{}
	if client, err := n.Client(); err == nil {
		if sf, err := client.SFTP(); err == nil {
			if entries, err := sf.ReadDir(n.Config().StacksDir); err == nil {
				for _, e := range entries {
					if e.IsDir() && node.ValidStackName(e.Name()) {
						existing = append(existing, e.Name())
					}
				}
			}
		} else {
			client.ResetSFTP()
		}
	}
	sort.Strings(existing)

	system := "你是 KayPanel 的 Docker Compose 部署助手。根据用户需求，生成一个可直接运行的单文件 compose.yaml。\n" +
		"只输出一个 JSON 对象，不要 markdown 围栏，不要额外文字。JSON 结构：\n" +
		"{\"name\":\"项目名\",\"title\":\"应用名\",\"description\":\"一句话说明\",\"compose\":\"完整 YAML 字符串\",\"notes\":[\"部署后要做的步骤\"],\"warnings\":[\"风险提示\"]}\n" +
		"硬性要求：\n" +
		"1. name 只能包含小写字母、数字、- 和 _，简短易读；\n" +
		"2. compose 顶层只写 services（可带 volumes/networks），服务数 1-5；\n" +
		"3. 每个服务必须写 image，禁止使用 build；必须写 restart: unless-stopped；\n" +
		"4. 端口写成 \"宿主机端口:容器端口\"；数据目录用相对路径 ./data 等；设置 TZ=Asia/Shanghai；\n" +
		"5. 禁止 privileged、network_mode: host、pid: host、devices、cap_add、挂载 /var/run/docker.sock；\n" +
		"6. 优先使用稳定版本标签，notes 和 warnings 用中文，各不超过 4 条；\n" +
		"7. 不要编造不存在的镜像。\n" +
		fmt.Sprintf("节点信息：%s，系统 %s，%d 核 CPU。已有应用：%s。", v.Name, v.Latest.OS, v.Latest.Cores, strings.Join(existing, ", "))
	msgs := []ai.Message{
		{Role: "system", Content: system},
		{Role: "user", Content: prompt},
	}
	ctx, cancel := context.WithTimeout(r.Context(), 150*time.Second)
	defer cancel()
	reply, err := ai.ChatTokens(ctx, set.AIBase, set.AIKey, set.AIModel, msgs, 2600)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	var raw aiStackRaw
	if err := json.Unmarshal([]byte(extractJSONObject(reply)), &raw); err != nil {
		writeErr(w, http.StatusBadGateway, "AI 未返回有效的部署方案，请重试")
		return
	}
	compose := strings.TrimRight(strings.TrimSpace(raw.Compose), "\n") + "\n"
	services, images, err := validateCompose(compose)
	if err != nil {
		writeErr(w, http.StatusUnprocessableEntity, "生成的 Compose 未通过安全校验："+err.Error())
		return
	}
	name := sanitizeStackName(raw.Name)
	base := name
	for i := 2; ; i++ {
		taken := false
		for _, e := range existing {
			if e == name {
				taken = true
				break
			}
		}
		if !taken {
			break
		}
		if i > 20 {
			break
		}
		name = sanitizeStackName(fmt.Sprintf("%s-%d", base, i))
	}
	title := strings.TrimSpace(raw.Title)
	if title == "" {
		title = name
	}
	s.audit.Add("admin", n.Config().ID, "AI 生成应用", firstN(prompt, 60))
	writeJSON(w, http.StatusOK, map[string]any{
		"name":        name,
		"title":       title,
		"description": strings.TrimSpace(raw.Description),
		"compose":     compose,
		"notes":       cleanList(stringList(raw.Notes), 4),
		"warnings":    cleanList(stringList(raw.Warnings), 4),
		"services":    services,
		"images":      images,
	})
}
