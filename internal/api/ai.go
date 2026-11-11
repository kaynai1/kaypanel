package api

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"kaypanel/internal/ai"
	"kaypanel/internal/node"
	"kaypanel/internal/notify"
)

func (s *Server) handleNotifyTest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Webhook string `json:"webhook"`
		Channel string `json:"channel"`
		SMTP    *struct {
			Host string `json:"host"`
			Port int    `json:"port"`
			Mode string `json:"mode"`
			User string `json:"user"`
			Pass string `json:"pass"`
			From string `json:"from"`
			To   string `json:"to"`
		} `json:"smtp"`
	}
	_ = readJSON(r, &req)
	set := s.store.Settings()
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	stamp := time.Now().Format("2006-01-02 15:04:05")

	if strings.EqualFold(strings.TrimSpace(req.Channel), "smtp") {
		mc := notify.MailConfig{
			Host: set.SMTPHost, Port: set.SMTPPort, Mode: set.SMTPMode,
			User: set.SMTPUser, Pass: set.SMTPPass,
			From: set.SMTPFrom, To: []string{set.SMTPTo},
		}
		if req.SMTP != nil && strings.TrimSpace(req.SMTP.Host) != "" {
			mc = notify.MailConfig{
				Host: req.SMTP.Host, Port: req.SMTP.Port, Mode: req.SMTP.Mode,
				User: req.SMTP.User, Pass: req.SMTP.Pass,
				From: req.SMTP.From, To: []string{req.SMTP.To},
			}
			if strings.TrimSpace(mc.Pass) == "" && strings.TrimSpace(mc.Host) == set.SMTPHost && strings.TrimSpace(mc.User) == set.SMTPUser {
				mc.Pass = set.SMTPPass
			}
		}
		if err := notify.SendMail(ctx, mc, "KayPanel 测试邮件", "如果你看到这封邮件，说明 SMTP 邮件通道配置成功。\n"+stamp); err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		s.audit.Add("admin", "", "邮件测试", "")
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	hook := strings.TrimSpace(req.Webhook)
	if hook == "" {
		hook = strings.TrimSpace(set.Webhook)
	}
	if hook == "" {
		writeErr(w, http.StatusBadRequest, "请先填写并保存 Webhook 地址")
		return
	}
	if err := notify.Send(ctx, hook, "KayPanel 测试推送", "如果你看到这条消息，说明 Webhook 配置成功。\n"+stamp); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	s.audit.Add("admin", "", "推送测试", "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAIModels(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BaseURL string `json:"base_url"`
		APIKey  string `json:"api_key"`
	}
	_ = readJSON(r, &req)
	set := s.store.Settings()
	base := strings.TrimSpace(req.BaseURL)
	if base == "" {
		base = set.AIBase
	}
	key := strings.TrimSpace(req.APIKey)
	if key == "" {
		key = set.AIKey
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	models, err := ai.Models(ctx, base, key)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}

type aiChatReq struct {
	NodeID   string       `json:"node_id"`
	Messages []ai.Message `json:"messages"`
}

func (s *Server) handleAIChat(w http.ResponseWriter, r *http.Request) {
	var req aiChatReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	set := s.store.Settings()
	if strings.TrimSpace(set.AIBase) == "" || strings.TrimSpace(set.AIKey) == "" || strings.TrimSpace(set.AIModel) == "" {
		writeErr(w, http.StatusBadRequest, "AI 助手尚未配置，请先在设置中填写 Base URL、模型和 API Key")
		return
	}
	n, ok := s.mgr.Get(req.NodeID)
	if !ok {
		writeErr(w, http.StatusNotFound, "节点不存在")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()

	v := n.View()
	var sb strings.Builder
	fmt.Fprintf(&sb, "当前时间：%s\n", time.Now().Format("2006-01-02 15:04:05"))
	fmt.Fprintf(&sb, "节点：%s\n", v.Name)
	if v.SFTPOnly {
		fmt.Fprintf(&sb, "类型：虚拟主机（仅 SFTP 文件管理，无系统指标）\n")
	} else if !v.Online {
		fmt.Fprintf(&sb, "状态：离线（%s）\n", v.Error)
	} else {
		m := v.Latest
		memP := 0.0
		if m.MemTotal > 0 {
			memP = float64(m.MemUsed) / float64(m.MemTotal) * 100
		}
		diskP := 0.0
		if m.DiskTotal > 0 {
			diskP = float64(m.DiskUsed) / float64(m.DiskTotal) * 100
		}
		fmt.Fprintf(&sb, "系统：%s，内核 %s，运行 %s\n", m.OS, m.Kernel, time.Duration(m.Uptime*float64(time.Second)).Truncate(time.Minute))
		fmt.Fprintf(&sb, "CPU：%.1f%%（%d 核），负载 %.2f / %.2f / %.2f\n", m.CPU, m.Cores, m.Load1, m.Load5, m.Load15)
		fmt.Fprintf(&sb, "内存：%.1f%%（%s / %s），磁盘：%.1f%%（%s / %s）\n", memP, fmtBytes(m.MemUsed), fmtBytes(m.MemTotal), diskP, fmtBytes(m.DiskUsed), fmtBytes(m.DiskTotal))
		fmt.Fprintf(&sb, "网络：↓ %s/s，↑ %s/s，温度：%.0f°C，容器：%d/%d 运行\n", fmtBytes(uint64(m.NetRx)), fmtBytes(uint64(m.NetTx)), m.Temp, m.DockerRunning, m.DockerTotal)
		peakCPU, peakMem := 0.0, 0.0
		for _, sp := range v.History {
			if sp.CPU > peakCPU {
				peakCPU = sp.CPU
			}
			if sp.MemTotal > 0 {
				if p := float64(sp.MemUsed) / float64(sp.MemTotal) * 100; p > peakMem {
					peakMem = p
				}
			}
		}
		fmt.Fprintf(&sb, "最近 %d 个采样：CPU 峰值 %.1f%%，内存峰值 %.1f%%\n", len(v.History), peakCPU, peakMem)

		if out, err := n.OutputCtx(ctx, "ps -eo pid,comm,pcpu,pmem,args --sort=-pcpu 2>/dev/null | head -n 8", 8*time.Second); err == nil && strings.TrimSpace(out) != "" {
			fmt.Fprintf(&sb, "\n进程 Top（按 CPU）：\n%s\n", strings.TrimSpace(out))
		}
		if m.DockerTotal > 0 {
			if out, err := n.OutputCtx(ctx, "docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null | head -n 20", 8*time.Second); err == nil && strings.TrimSpace(out) != "" {
				fmt.Fprintf(&sb, "\n运行中容器：\n%s\n", strings.TrimSpace(out))
			}
		}
	}

	system := "你是 KayPanel 的服务器运维助手。根据下面的实时节点上下文回答用户问题，用中文，简洁直接；" +
		"给出命令时说明风险，涉及删除、重启、停止服务必须先提醒确认；不确定就直说，不要编造指标。\n\n" +
		"如果用户希望执行运维操作，你可以在回答的最后追加一个操作建议块：" +
		"<actions>[{\"type\":\"container_restart\",\"target\":\"容器名\",\"reason\":\"一句话原因\"}]</actions>\n" +
		"type 只能是 container_restart（重启容器）、container_logs（查看最近日志）、disk_usage（分析磁盘占用）、disk_clean（清理 Docker 悬空镜像）；" +
		"container_* 的 target 必须是上面上下文里真实出现的容器名，disk_* 不需要 target；一次最多 3 个；" +
		"container_logs 与 disk_usage 是只读操作。面板会让用户确认后执行白名单命令，不要在文字里伪造执行结果，也不要输出操作块以外的代码块。" +
		"\n\n" + sb.String()
	msgs := []ai.Message{{Role: "system", Content: system}}
	for _, m := range req.Messages {
		if len(msgs) > 21 {
			break
		}
		if m.Role != "user" && m.Role != "assistant" {
			continue
		}
		content := strings.TrimSpace(m.Content)
		if content == "" {
			continue
		}
		if len(content) > 4000 {
			content = content[:4000]
		}
		msgs = append(msgs, ai.Message{Role: m.Role, Content: content})
	}
	if len(msgs) == 1 {
		writeErr(w, http.StatusBadRequest, "请输入问题")
		return
	}
	reply, err := ai.Chat(ctx, set.AIBase, set.AIKey, set.AIModel, msgs)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	reply, proposed := ai.ParseActions(reply)
	proposed = ai.NormalizeActions(proposed, node.ValidContainerRef)
	actions := make([]aiActionView, 0, len(proposed))
	for _, a := range proposed {
		actions = append(actions, buildActionView(a))
	}
	if reply == "" && len(actions) == 0 {
		reply = "（空回复）"
	}
	s.audit.Add("admin", v.ID, "AI 提问", firstN(msgs[len(msgs)-1].Content, 60))
	writeJSON(w, http.StatusOK, map[string]any{"reply": reply, "actions": actions})
}

type aiActionView struct {
	Type     string `json:"type"`
	Label    string `json:"label"`
	Target   string `json:"target,omitempty"`
	Reason   string `json:"reason,omitempty"`
	Detail   string `json:"detail"`
	Command  string `json:"command"`
	ReadOnly bool   `json:"read_only"`
	Danger   bool   `json:"danger"`
}

func buildActionView(a ai.Action) aiActionView {
	v := aiActionView{Type: a.Type, Target: a.Target, Reason: a.Reason}
	switch a.Type {
	case "container_restart":
		v.Label = "重启容器"
		v.Detail = "容器 " + a.Target
		v.Command = "docker restart " + node.ShQuote(a.Target)
		v.Danger = true
	case "container_logs":
		v.Label = "查看容器日志"
		v.Detail = "容器 " + a.Target + " · 最近 120 行"
		v.Command = "docker logs --tail 120 --timestamps " + node.ShQuote(a.Target)
		v.ReadOnly = true
	case "disk_usage":
		v.Label = "分析磁盘占用"
		v.Detail = "只读扫描根目录一级占用与 Docker 占用"
		v.Command = "df -h; du -xhd1 / | sort -rh | head -n 12; docker system df"
		v.ReadOnly = true
	case "disk_clean":
		v.Label = "清理悬空镜像"
		v.Detail = "docker image prune -f，删除无标签的悬空镜像"
		v.Command = "docker image prune -f"
		v.Danger = true
	}
	return v
}

type aiActionReq struct {
	NodeID string `json:"node_id"`
	Type   string `json:"type"`
	Target string `json:"target"`
}

// handleAIAction executes only the fixed commands below; the model never
// supplies or influences the command text.
func (s *Server) handleAIAction(w http.ResponseWriter, r *http.Request) {
	var req aiActionReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	n, ok := s.mgr.Get(req.NodeID)
	if !ok {
		writeErr(w, http.StatusNotFound, "节点不存在")
		return
	}
	if n.View().SFTPOnly {
		writeErr(w, http.StatusBadRequest, "虚拟主机不支持该操作")
		return
	}
	target := strings.TrimSpace(req.Target)
	var cmd, label string
	timeout := 60 * time.Second
	switch req.Type {
	case "container_restart", "container_logs":
		if !node.ValidContainerRef(target) {
			writeErr(w, http.StatusBadRequest, "容器名不合法")
			return
		}
		names, err := n.OutputCtx(r.Context(), `docker ps -a --format '{{.Names}}'`, 15*time.Second)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "读取容器列表失败: "+dockerError(err))
			return
		}
		if !hasLine(names, target) {
			writeErr(w, http.StatusBadRequest, "容器不存在："+target)
			return
		}
		if req.Type == "container_restart" {
			label = "AI.重启容器"
			cmd = "docker restart " + node.ShQuote(target)
			timeout = 90 * time.Second
		} else {
			label = "AI.查看日志"
			cmd = "docker logs --tail 120 --timestamps " + node.ShQuote(target) + " 2>&1"
			timeout = 30 * time.Second
		}
	case "disk_usage":
		label = "AI.磁盘分析"
		cmd = "df -h 2>/dev/null | head -n 12; echo; du -xhd1 / 2>/dev/null | sort -rh | head -n 12; echo; docker system df 2>/dev/null || true"
		timeout = 45 * time.Second
	case "disk_clean":
		label = "AI.清理镜像"
		cmd = "docker image prune -f"
		timeout = 120 * time.Second
	default:
		writeErr(w, http.StatusBadRequest, "不支持的操作")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout+5*time.Second)
	defer cancel()
	out, err := n.OutputCtx(ctx, cmd, timeout)
	if err != nil {
		s.audit.Add("admin", n.Config().ID, label+"失败", target)
		writeErr(w, http.StatusBadGateway, "执行失败: "+err.Error())
		return
	}
	s.audit.Add("admin", n.Config().ID, label, target)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "output": clipOutput(out), "command": cmd})
}

func hasLine(out, want string) bool {
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) == want {
			return true
		}
	}
	return false
}

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)

func clipOutput(s string) string {
	s = ansiRe.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "\r", "")
	s = strings.TrimSpace(s)
	if s == "" {
		return "（无输出）"
	}
	r := []rune(s)
	if len(r) > 8000 {
		return string(r[:8000]) + "\n…（输出已截断）"
	}
	return s
}

func firstN(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}

func fmtBytes(n uint64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := uint64(unit), 0
	for v := n / unit; v >= unit; v /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}
