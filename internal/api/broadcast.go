package api

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"kaypanel/internal/ai"
	"kaypanel/internal/config"
	"kaypanel/internal/insight"
	"kaypanel/internal/node"
)

func aiReady(set config.Settings) bool {
	return strings.TrimSpace(set.AIBase) != "" && strings.TrimSpace(set.AIKey) != "" && strings.TrimSpace(set.AIModel) != ""
}

type fleetEvent struct {
	node.Event
	NodeName string `json:"node_name"`
}

type fleetNode struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Online      bool     `json:"online"`
	SFTPOnly    bool     `json:"sftp_only"`
	CPU         float64  `json:"cpu"`
	Mem         float64  `json:"mem"`
	Disk        float64  `json:"disk"`
	Load1       float64  `json:"load1"`
	Temp        float64  `json:"temp"`
	DockerRun   int      `json:"docker_running"`
	DockerTotal int      `json:"docker_total"`
	Alerts      []string `json:"alerts"`
}

type fleetFacts struct {
	Time        int64       `json:"time"`
	Total       int         `json:"total"`
	Online      int         `json:"online"`
	Offline     []string    `json:"offline"`
	Nodes       []fleetNode `json:"nodes"`
	AvgCPU      float64     `json:"avg_cpu"`
	AvgMem      float64     `json:"avg_mem"`
	AvgDisk     float64     `json:"avg_disk"`
	MaxCPUNode  string      `json:"max_cpu_node"`
	MaxCPU      float64     `json:"max_cpu"`
	MaxMemNode  string      `json:"max_mem_node"`
	MaxMem      float64     `json:"max_mem"`
	MaxDiskNode string      `json:"max_disk_node"`
	MaxDisk     float64     `json:"max_disk"`
	Alerts      []string     `json:"alerts"`
	Events      []fleetEvent `json:"events"`
	EventTotal  int          `json:"event_total"`
	ProbeTotal  int          `json:"probe_total"`
	ProbeDown   []string    `json:"probe_down"`
	Highlights  []string    `json:"highlights"`
}

func metricPct(used, total uint64) float64 {
	if total == 0 {
		return 0
	}
	return float64(used) / float64(total) * 100
}

func (s *Server) collectFleetFacts() fleetFacts {
	set := s.store.Settings()
	f := fleetFacts{Time: time.Now().Unix(), Nodes: []fleetNode{}, Offline: []string{}, Alerts: []string{}, Events: []fleetEvent{}, ProbeDown: []string{}}
	cut := time.Now().Add(-24 * time.Hour).Unix()
	for _, v := range s.mgr.Views() {
		f.Total++
		fn := fleetNode{ID: v.ID, Name: v.Name, Online: v.Online, SFTPOnly: v.SFTPOnly}
		if v.Online {
			f.Online++
		} else {
			f.Offline = append(f.Offline, v.Name)
		}
		if v.Online && !v.SFTPOnly {
			m := v.Latest
			fn.CPU = m.CPU
			fn.Mem = metricPct(m.MemUsed, m.MemTotal)
			fn.Disk = metricPct(m.DiskUsed, m.DiskTotal)
			fn.Load1 = m.Load1
			fn.Temp = m.Temp
			fn.DockerRun = m.DockerRunning
			fn.DockerTotal = m.DockerTotal
			fn.Alerts = computeAlerts(v, set)
			f.AvgCPU += fn.CPU
			f.AvgMem += fn.Mem
			f.AvgDisk += fn.Disk
			if fn.CPU >= f.MaxCPU {
				f.MaxCPU, f.MaxCPUNode = fn.CPU, v.Name
			}
			if fn.Mem >= f.MaxMem {
				f.MaxMem, f.MaxMemNode = fn.Mem, v.Name
			}
			if fn.Disk >= f.MaxDisk {
				f.MaxDisk, f.MaxDiskNode = fn.Disk, v.Name
			}
			for _, a := range fn.Alerts {
				f.Alerts = append(f.Alerts, v.Name+" · "+a)
			}
		}
		f.Nodes = append(f.Nodes, fn)
		if v.SFTPOnly {
			continue
		}
		if n, ok := s.mgr.Get(v.ID); ok {
			for _, ev := range n.Events() {
				if ev.Time >= cut {
					f.Events = append(f.Events, fleetEvent{Event: ev, NodeName: v.Name})
					f.EventTotal++
				}
			}
		}
	}
	live := 0
	for _, fn := range f.Nodes {
		if fn.Online && !fn.SFTPOnly {
			live++
		}
	}
	if live > 0 {
		f.AvgCPU /= float64(live)
		f.AvgMem /= float64(live)
		f.AvgDisk /= float64(live)
	}
	sort.SliceStable(f.Events, func(i, j int) bool { return f.Events[i].Time > f.Events[j].Time })
	if len(f.Events) > 8 {
		f.Events = f.Events[:8]
	}
	if s.probes != nil {
		for _, st := range s.probes.States() {
			f.ProbeTotal++
			if len(st.Checks) > 0 && !st.Up {
				f.ProbeDown = append(f.ProbeDown, st.Name)
			}
		}
	}
	f.Highlights = append(f.Highlights, fmt.Sprintf("在线 %d/%d", f.Online, f.Total))
	if live > 0 {
		f.Highlights = append(f.Highlights, fmt.Sprintf("平均 CPU %.0f%%", f.AvgCPU))
	}
	if len(f.Alerts) > 0 {
		f.Highlights = append(f.Highlights, fmt.Sprintf("告警 %d 条", len(f.Alerts)))
	} else {
		f.Highlights = append(f.Highlights, "无阈值告警")
	}
	if len(f.Offline) > 0 {
		f.Highlights = append(f.Highlights, "离线 "+strings.Join(f.Offline, "、"))
	}
	if len(f.ProbeDown) > 0 {
		f.Highlights = append(f.Highlights, fmt.Sprintf("拨测异常 %d 个", len(f.ProbeDown)))
	}
	if len(f.Highlights) > 6 {
		f.Highlights = f.Highlights[:6]
	}
	return f
}

func fleetFactsText(f fleetFacts) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "时间：%s\n", time.Unix(f.Time, 0).Format("2006-01-02 15:04"))
	fmt.Fprintf(&sb, "节点：%d 台，在线 %d 台", f.Total, f.Online)
	if len(f.Offline) > 0 {
		fmt.Fprintf(&sb, "，离线：%s", strings.Join(f.Offline, "、"))
	}
	sb.WriteString("\n")
	if f.MaxCPUNode != "" {
		fmt.Fprintf(&sb, "在线节点平均 CPU %.1f%%、内存 %.1f%%、磁盘 %.1f%%；CPU 最高 %s %.1f%%，内存最高 %s %.1f%%，磁盘最高 %s %.1f%%\n",
			f.AvgCPU, f.AvgMem, f.AvgDisk, f.MaxCPUNode, f.MaxCPU, f.MaxMemNode, f.MaxMem, f.MaxDiskNode, f.MaxDisk)
	}
	sb.WriteString("\n各节点：\n")
	for _, n := range f.Nodes {
		if !n.Online {
			fmt.Fprintf(&sb, "- %s：离线\n", n.Name)
			continue
		}
		if n.SFTPOnly {
			fmt.Fprintf(&sb, "- %s：虚拟主机（仅文件管理）\n", n.Name)
			continue
		}
		fmt.Fprintf(&sb, "- %s：CPU %.1f%%，内存 %.1f%%，磁盘 %.1f%%，负载 %.2f，温度 %.0f°C，容器 %d/%d 运行",
			n.Name, n.CPU, n.Mem, n.Disk, n.Load1, n.Temp, n.DockerRun, n.DockerTotal)
		if len(n.Alerts) > 0 {
			fmt.Fprintf(&sb, "，告警：%s", strings.Join(n.Alerts, "、"))
		}
		sb.WriteString("\n")
	}
	if len(f.Events) > 0 {
		fmt.Fprintf(&sb, "\n过去 24 小时事件（共 %d 条，最近 %d 条）：\n", f.EventTotal, len(f.Events))
		for _, ev := range f.Events {
			fmt.Fprintf(&sb, "- %s · %s · %s", time.Unix(ev.Time, 0).Format("01-02 15:04"), ev.NodeName, ev.Title)
			if ev.Detail != "" {
				fmt.Fprintf(&sb, "（%s）", ev.Detail)
			}
			sb.WriteString("\n")
		}
	} else {
		sb.WriteString("\n过去 24 小时没有节点事件。\n")
	}
	if f.ProbeTotal > 0 {
		if len(f.ProbeDown) > 0 {
			fmt.Fprintf(&sb, "\n拨测目标 %d 个，异常：%s\n", f.ProbeTotal, strings.Join(f.ProbeDown, "、"))
		} else {
			fmt.Fprintf(&sb, "\n拨测目标 %d 个，全部正常。\n", f.ProbeTotal)
		}
	}
	return sb.String()
}

func broadcastLocalText(f fleetFacts, tone string) string {
	var sb strings.Builder
	stamp := time.Unix(f.Time, 0).Format("01-02 15:04")
	if tone == "alert" {
		fmt.Fprintf(&sb, "【异常简报】%s\n", stamp)
	} else {
		fmt.Fprintf(&sb, "【运维播报】%s\n", stamp)
	}
	fmt.Fprintf(&sb, "节点 %d 台中有 %d 台在线", f.Total, f.Online)
	if len(f.Offline) > 0 {
		fmt.Fprintf(&sb, "，离线：%s", strings.Join(f.Offline, "、"))
	} else {
		sb.WriteString("，全部在线")
	}
	sb.WriteString("。\n")
	if f.MaxCPUNode != "" {
		fmt.Fprintf(&sb, "资源方面，在线节点平均 CPU %.0f%%、内存 %.0f%%、磁盘 %.0f%%；CPU 最高的是 %s（%.1f%%），内存最高 %s（%.0f%%），磁盘最高 %s（%.0f%%）。\n",
			f.AvgCPU, f.AvgMem, f.AvgDisk, f.MaxCPUNode, f.MaxCPU, f.MaxMemNode, f.MaxMem, f.MaxDiskNode, f.MaxDisk)
	}
	if len(f.Alerts) > 0 {
		show := f.Alerts
		if len(show) > 4 {
			show = show[:4]
		}
		fmt.Fprintf(&sb, "共 %d 条阈值告警：%s。\n", len(f.Alerts), strings.Join(show, "；"))
	} else {
		sb.WriteString("当前没有触发阈值告警。\n")
	}
	if len(f.Events) > 0 {
		fmt.Fprintf(&sb, "过去 24 小时记录 %d 条事件，最近是 %s 的 %s（%s）。\n",
			f.EventTotal, f.Events[0].NodeName, f.Events[0].Title, time.Unix(f.Events[0].Time, 0).Format("01-02 15:04"))
	} else {
		sb.WriteString("过去 24 小时没有记录到节点事件。\n")
	}
	if f.ProbeTotal > 0 {
		if len(f.ProbeDown) > 0 {
			fmt.Fprintf(&sb, "拨测目标 %d 个，异常 %s。\n", f.ProbeTotal, strings.Join(f.ProbeDown, "、"))
		} else {
			fmt.Fprintf(&sb, "拨测目标 %d 个，全部正常。\n", f.ProbeTotal)
		}
	}
	switch {
	case len(f.Offline) > 0:
		sb.WriteString("建议：先确认离线节点的电源与网络链路，恢复后可在故障回放中定位断点。")
	case len(f.Alerts) > 0:
		sb.WriteString("建议：优先处理告警节点，可在故障演练场预演一次处置流程。")
	case len(f.ProbeDown) > 0:
		sb.WriteString("建议：检查异常拨测目标的上游服务与证书有效期。")
	case tone == "alert":
		sb.WriteString("结论：本时段没有发现需要立即处置的异常，已记录为基线。")
	default:
		sb.WriteString("建议：整体运行平稳，保持关注磁盘余量与证书到期时间。")
	}
	return sb.String()
}

func (s *Server) handleBroadcastList(w http.ResponseWriter, r *http.Request) {
	latest, has := s.insights.LatestBroadcast()
	writeJSON(w, http.StatusOK, map[string]any{
		"latest":  latest,
		"has":     has,
		"history": s.insights.Broadcasts(),
		"ai":      aiReady(s.store.Settings()),
	})
}

func (s *Server) handleBroadcastGenerate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Tone string `json:"tone"`
	}
	_ = readJSON(r, &req)
	tone := req.Tone
	if tone != "alert" {
		tone = "daily"
	}
	f := s.collectFleetFacts()
	text := broadcastLocalText(f, tone)
	usedAI := false
	aiErr := ""
	set := s.store.Settings()
	if aiReady(set) {
		role := "你是 KayPanel 的服务器值班运维播报员。只依据给出的实时数据写一段中文运维播报，不要编造指标，不要输出 Markdown 标题或代码块。"
		if tone == "alert" {
			role += "这是异常简报：先给结论（是否存在需要立即处置的异常），再列关键异常与影响面，最后给 1-2 条可执行的处置建议，控制在 260 字以内。"
		} else {
			role += "这是日常播报：语气自然、专业、简洁，覆盖在线情况、资源水位、值得注意的事件和一句建议，220-320 字。"
		}
		ctx, cancel := context.WithTimeout(r.Context(), 75*time.Second)
		defer cancel()
		reply, err := ai.ChatTokens(ctx, set.AIBase, set.AIKey, set.AIModel, []ai.Message{
			{Role: "system", Content: role},
			{Role: "user", Content: fleetFactsText(f)},
		}, 1000)
		if err != nil {
			aiErr = err.Error()
		} else if strings.TrimSpace(reply) != "" {
			text = clipText(strings.TrimSpace(reply), 2600)
			usedAI = true
		}
	}
	b := s.insights.AddBroadcast(insight.Broadcast{
		Text:       text,
		Tone:       tone,
		AI:         usedAI,
		Highlights: f.Highlights,
	})
	s.audit.Add("admin", "", "生成运维播报", map[bool]string{true: "异常简报", false: "日常播报"}[tone == "alert"])
	writeJSON(w, http.StatusOK, map[string]any{"broadcast": b, "ai_error": aiErr})}

func clipText(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}
