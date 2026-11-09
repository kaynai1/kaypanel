package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"kaypanel/internal/ai"
	"kaypanel/internal/notify"
)

func (s *Server) handleNotifyTest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Webhook string `json:"webhook"`
	}
	_ = readJSON(r, &req)
	set := s.store.Settings()
	hook := strings.TrimSpace(req.Webhook)
	if hook == "" {
		hook = strings.TrimSpace(set.Webhook)
	}
	if hook == "" {
		writeErr(w, http.StatusBadRequest, "请先填写并保存 Webhook 地址")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if err := notify.Send(ctx, hook, "KayPanel 测试推送", "如果你看到这条消息，说明 Webhook 配置成功。\n"+time.Now().Format("2006-01-02 15:04:05")); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	s.audit.Add("admin", "", "推送测试", "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
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
		"给出命令时说明风险，涉及删除、重启、停止服务必须先提醒确认；不确定就直说，不要编造指标。\n\n" + sb.String()
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
	s.audit.Add("admin", v.ID, "AI 提问", firstN(msgs[len(msgs)-1].Content, 60))
	writeJSON(w, http.StatusOK, map[string]any{"reply": reply})
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
