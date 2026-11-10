package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"sort"
	"strings"
	"time"

	"kaypanel/internal/node"
)

type template struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	YAML        string `json:"yaml"`
}

func appTemplates() []template {
	return []template{
		{
			ID:          "filebrowser",
			Name:        "File Browser",
			Description: "网页文件管理器，可浏览和共享 NAS 文件",
			YAML: `services:
  filebrowser:
    image: filebrowser/filebrowser:latest
    container_name: filebrowser
    restart: unless-stopped
    ports:
      - "8082:80"
    volumes:
      - /vol1:/srv
      - ./data:/database
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Asia/Shanghai
`,
		},
		{
			ID:          "uptime-kuma",
			Name:        "Uptime Kuma",
			Description: "自托管站点与端口可用性监控",
			YAML: `services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: uptime-kuma
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - ./data:/app/data
    environment:
      - TZ=Asia/Shanghai
`,
		},
		{
			ID:          "qbittorrent",
			Name:        "qBittorrent",
			Description: "BT 下载器（LinuxServer 版）",
			YAML: `services:
  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    container_name: qbittorrent
    restart: unless-stopped
    ports:
      - "8090:8080"
      - "6881:6881"
      - "6881:6881/udp"
    volumes:
      - ./config:/config
      - /vol1/downloads:/downloads
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Asia/Shanghai
      - WEBUI_PORT=8080
`,
		},
		{
			ID:          "alist",
			Name:        "AList",
			Description: "聚合多个网盘的文件列表程序",
			YAML: `services:
  alist:
    image: xhofe/alist:latest
    container_name: alist
    restart: unless-stopped
    ports:
      - "5244:5244"
    volumes:
      - ./data:/opt/alist/data
    environment:
      - PUID=0
      - PGID=0
      - UMASK=022
      - TZ=Asia/Shanghai
`,
		},
		{
			ID:          "vaultwarden",
			Name:        "Vaultwarden",
			Description: "轻量 Bitwarden 密码管理服务",
			YAML: `services:
  vaultwarden:
    image: vaultwarden/server:latest
    container_name: vaultwarden
    restart: unless-stopped
    ports:
      - "8222:80"
    volumes:
      - ./data:/data
    environment:
      - TZ=Asia/Shanghai
`,
		},
		{
			ID:          "nginx",
			Name:        "Nginx",
			Description: "静态网站与反向代理",
			YAML: `services:
  nginx:
    image: nginx:alpine
    container_name: nginx
    restart: unless-stopped
    ports:
      - "8088:80"
    volumes:
      - ./html:/usr/share/nginx/html:ro
    environment:
      - TZ=Asia/Shanghai
`,
		},
	}
}

type stackInfo struct {
	Name     string `json:"name"`
	Dir      string `json:"dir"`
	File     string `json:"file"`
	Status   string `json:"status"`
	Services int    `json:"services"`
	Running  int    `json:"running"`
	Updated  int64  `json:"updated"`
	Error    string `json:"error,omitempty"`
}

type composePS struct {
	Name    string `json:"Name"`
	Service string `json:"Service"`
	State   string `json:"State"`
	Health  string `json:"Health"`
	Status  string `json:"Status"`
}

var composeFiles = []string{"compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"}

func stacksBase(n *node.Node) string {
	return n.Config().StacksDir
}

func (s *Server) composeCommand(ctx context.Context, n *node.Node) (string, error) {
	out, err := n.OutputCtx(ctx, `docker compose version 2>/dev/null || docker-compose version 2>/dev/null`, 15*time.Second)
	if err != nil || strings.TrimSpace(out) == "" {
		return "", fmt.Errorf("未检测到 Docker Compose，请先在节点安装 compose 插件")
	}
	if strings.Contains(out, "Docker Compose version") {
		return "docker compose", nil
	}
	return "docker-compose", nil
}

func (s *Server) handleStacks(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	compose, err := s.composeCommand(ctx, n)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"stacks": []stackInfo{}, "compose_ok": false, "error": err.Error()})
		return
	}
	client, err := n.Client()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"stacks": []stackInfo{}, "compose_ok": true, "error": err.Error()})
		return
	}
	sf, err := client.SFTP()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"stacks": []stackInfo{}, "compose_ok": true, "error": err.Error()})
		return
	}
	base := stacksBase(n)
	if err := sf.MkdirAll(base); err != nil {
		client.ResetSFTP()
		writeJSON(w, http.StatusOK, map[string]any{"stacks": []stackInfo{}, "compose_ok": true, "error": "应用目录不可写: " + err.Error()})
		return
	}
	entries, err := sf.ReadDir(base)
	if err != nil {
		client.ResetSFTP()
		writeJSON(w, http.StatusOK, map[string]any{"stacks": []stackInfo{}, "compose_ok": true, "error": err.Error()})
		return
	}
	stacks := make([]stackInfo, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") || !node.ValidStackName(e.Name()) {
			continue
		}
		dir := path.Join(base, e.Name())
		file := ""
		var mtime int64
		for _, f := range composeFiles {
			if st, err := sf.Stat(path.Join(dir, f)); err == nil && !st.IsDir() {
				file = f
				mtime = st.ModTime().Unix()
				break
			}
		}
		if file == "" {
			continue
		}
		info := stackInfo{
			Name:    e.Name(),
			Dir:     dir,
			File:    file,
			Status:  "stopped",
			Updated: mtime,
		}
		cmd := fmt.Sprintf("cd %s && %s -p %s ps -a --format json", node.ShQuote(dir), compose, node.ShQuote(e.Name()))
		out, err := n.OutputCtx(ctx, cmd, 25*time.Second)
		if err != nil {
			info.Status = "error"
			info.Error = err.Error()
		} else {
			info.Services, info.Running = parseComposePS(out)
			switch {
			case info.Services == 0:
				info.Status = "stopped"
			case info.Running == info.Services:
				info.Status = "running"
			case info.Running == 0:
				info.Status = "stopped"
			default:
				info.Status = "partial"
			}
		}
		stacks = append(stacks, info)
	}
	sort.Slice(stacks, func(i, j int) bool { return stacks[i].Name < stacks[j].Name })
	writeJSON(w, http.StatusOK, map[string]any{"stacks": stacks, "compose_ok": true, "base": base})
}

func parseComposePS(out string) (services, running int) {
	out = strings.TrimSpace(out)
	if out == "" {
		return 0, 0
	}
	if strings.HasPrefix(out, "[") {
		var arr []composePS
		if json.Unmarshal([]byte(out), &arr) == nil {
			services = len(arr)
			for _, s := range arr {
				if serviceRunning(s) {
					running++
				}
			}
			return services, running
		}
	}
	lines := strings.Split(out, "\n")
	jsonSeen := false
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "{") {
			continue
		}
		jsonSeen = true
		var s composePS
		if json.Unmarshal([]byte(line), &s) == nil {
			services++
			if serviceRunning(s) {
				running++
			}
		}
	}
	if !jsonSeen {
		for _, line := range lines {
			l := strings.TrimSpace(line)
			if l == "" || strings.HasPrefix(l, "Name") {
				continue
			}
			services++
			if strings.Contains(l, "Up") {
				running++
			}
		}
	}
	return services, running
}

func serviceRunning(s composePS) bool {
	if strings.EqualFold(s.State, "running") {
		return true
	}
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(s.Status)), "up")
}

func (s *Server) handleStackGet(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	name := r.PathValue("name")
	if !node.ValidStackName(name) {
		writeErr(w, http.StatusBadRequest, "应用名称不合法")
		return
	}
	client, err := n.Client()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	sf, err := client.SFTP()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	dir := path.Join(stacksBase(n), name)
	file := ""
	for _, f := range composeFiles {
		if st, err := sf.Stat(path.Join(dir, f)); err == nil && !st.IsDir() {
			file = f
			break
		}
	}
	if file == "" {
		writeErr(w, http.StatusNotFound, "应用不存在")
		return
	}
	fh, err := sf.Open(path.Join(dir, file))
	if err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	defer fh.Close()
	b, err := io.ReadAll(io.LimitReader(fh, 1<<20))
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"name":    name,
		"file":    file,
		"dir":     dir,
		"content": string(b),
	})
}

type stackSaveReq struct {
	Content string `json:"content"`
}

func (s *Server) handleStackSave(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	name := r.PathValue("name")
	if !node.ValidStackName(name) {
		writeErr(w, http.StatusBadRequest, "应用名称仅支持小写字母、数字、- 和 _")
		return
	}
	var req stackSaveReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeErr(w, http.StatusBadRequest, "Compose 内容不能为空")
		return
	}
	if len(req.Content) > 512*1024 {
		writeErr(w, http.StatusBadRequest, "Compose 内容过大")
		return
	}
	client, err := n.Client()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	sf, err := client.SFTP()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	dir := path.Join(stacksBase(n), name)
	if err := sf.MkdirAll(dir); err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, "创建应用目录失败: "+err.Error())
		return
	}
	file := "compose.yaml"
	for _, f := range composeFiles {
		if _, err := sf.Stat(path.Join(dir, f)); err == nil {
			file = f
			break
		}
	}
	target := path.Join(dir, file)
	before := ""
	if fh, err := sf.Open(target); err == nil {
		if b, rerr := io.ReadAll(io.LimitReader(fh, 1<<20)); rerr == nil {
			before = string(b)
		}
		fh.Close()
	}
	tmp := target + ".kptmp"
	fh, err := sf.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY)
	if err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, "写入失败: "+err.Error())
		return
	}
	_, werr := fh.Write([]byte(req.Content))
	cerr := fh.Close()
	if werr != nil || cerr != nil {
		_ = sf.Remove(tmp)
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, "写入失败")
		return
	}
	if err := sf.PosixRename(tmp, target); err != nil {
		_ = sf.Remove(target)
		if err := sf.Rename(tmp, target); err != nil {
			_ = sf.Remove(tmp)
			client.ResetSFTP()
			writeErr(w, http.StatusBadGateway, "保存失败: "+err.Error())
			return
		}
	}
	if s.changes != nil {
		cfg := n.Config()
		s.changes.Add("stack", cfg.ID, cfg.Name, target, "应用 "+name+" 的 Compose 配置", before, req.Content)
	}
	s.audit.Add("admin", n.Config().ID, "保存应用", name)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "file": file})
}

type stackActionReq struct {
	Action string `json:"action"`
}

func (s *Server) handleStackAction(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	name := r.PathValue("name")
	if !node.ValidStackName(name) {
		writeErr(w, http.StatusBadRequest, "应用名称不合法")
		return
	}
	var req stackActionReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	var inner string
	switch req.Action {
	case "up":
		inner = "up -d --remove-orphans"
	case "down":
		inner = "down --remove-orphans"
	case "restart":
		inner = "restart"
	case "stop":
		inner = "stop"
	case "pull":
		inner = "pull"
	case "update":
		inner = "pull && up -d --remove-orphans"
	default:
		writeErr(w, http.StatusBadRequest, "不支持的操作")
		return
	}
	compose, err := s.composeCommand(r.Context(), n)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	dir := path.Join(stacksBase(n), name)
	cmd := fmt.Sprintf("cd %s && %s -p %s %s", node.ShQuote(dir), compose, node.ShQuote(name), inner)
	out, err := n.OutputCtx(r.Context(), cmd, 300*time.Second)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "操作失败: "+err.Error())
		return
	}
	s.audit.Add("admin", n.Config().ID, "应用."+req.Action, name)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "output": out})
}

func (s *Server) handleStackDelete(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	name := r.PathValue("name")
	if !node.ValidStackName(name) {
		writeErr(w, http.StatusBadRequest, "应用名称不合法")
		return
	}
	if compose, err := s.composeCommand(r.Context(), n); err == nil {
		dir := path.Join(stacksBase(n), name)
		_, _ = n.OutputCtx(r.Context(), fmt.Sprintf("cd %s && %s -p %s down --remove-orphans", node.ShQuote(dir), compose, node.ShQuote(name)), 120*time.Second)
	}
	client, err := n.Client()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	sf, err := client.SFTP()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	dir := path.Join(stacksBase(n), name)
	if err := removeTree(sf, dir); err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, "删除失败: "+err.Error())
		return
	}
	s.audit.Add("admin", n.Config().ID, "删除应用", name)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
