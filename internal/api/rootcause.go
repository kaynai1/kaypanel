package api

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"kaypanel/internal/ai"
)

type rcSignal struct {
	NodeID   string `json:"node"`
	NodeName string `json:"node_name"`
	Kind     string `json:"kind"`
	Detail   string `json:"detail"`
	Time     int64  `json:"time"`
}

type rcCluster struct {
	Start      int64      `json:"start"`
	End        int64      `json:"end"`
	Title      string     `json:"title"`
	Severity   string     `json:"severity"`
	Nodes      []string   `json:"nodes"`
	NodeNames  []string   `json:"node_names"`
	Kinds      []string   `json:"kinds"`
	Signals    []rcSignal `json:"signals"`
	Hypothesis string     `json:"hypothesis"`
	Confidence int        `json:"confidence"`
	Advice     []string   `json:"advice"`
}

type rcSuspect struct {
	NodeID   string   `json:"node"`
	NodeName string   `json:"node_name"`
	Score    int      `json:"score"`
	Reasons  []string `json:"reasons"`
}

type rcReport struct {
	Time        int64      `json:"time"`
	WindowHours int        `json:"window_hours"`
	Nodes       int        `json:"nodes"`
	Count       int        `json:"signal_count"`
	Clusters    []rcCluster `json:"clusters"`
	Suspects    []rcSuspect `json:"suspects"`
	Signals     []rcSignal  `json:"signals"`
	Summary     string      `json:"summary"`
	Empty       bool        `json:"empty"`
}

var rcKindLabels = map[string]string{
	"cpu":     "CPU 冲高",
	"mem":     "内存吃紧",
	"disk":    "磁盘告急",
	"temp":    "温度过高",
	"docker":  "容器退出",
	"offline": "节点离线",
	"probe":   "拨测失败",
}

func rcKindOf(title string) (string, bool) {
	switch title {
	case "CPU 冲高":
		return "cpu", true
	case "内存吃紧":
		return "mem", true
	case "磁盘告急":
		return "disk", true
	case "温度过高":
		return "temp", true
	case "容器退出":
		return "docker", true
	case "节点离线":
		return "offline", true
	}
	return "", false
}

func clipTextShort(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}

func (s *Server) buildRootCause(hours int) rcReport {
	if hours < 6 {
		hours = 6
	}
	if hours > 72 {
		hours = 72
	}
	now := time.Now()
	cut := now.Add(-time.Duration(hours) * time.Hour).Unix()
	rep := rcReport{Time: now.Unix(), WindowHours: hours, Clusters: []rcCluster{}, Suspects: []rcSuspect{}, Signals: []rcSignal{}}
	views := s.mgr.Views()
	rep.Nodes = len(views)
	var signals []rcSignal
	for _, v := range views {
		if v.SFTPOnly {
			continue
		}
		n, ok := s.mgr.Get(v.ID)
		if !ok {
			continue
		}
		hasOffline := false
		for _, ev := range n.Events() {
			if ev.Time < cut {
				continue
			}
			kind, ok := rcKindOf(ev.Title)
			if !ok {
				continue
			}
			if kind == "offline" {
				hasOffline = true
			}
			detail := ev.Title
			if ev.Detail != "" {
				detail += " · " + ev.Detail
			}
			signals = append(signals, rcSignal{NodeID: v.ID, NodeName: v.Name, Kind: kind, Detail: clipTextShort(detail, 140), Time: ev.Time})
		}
		if !v.Online && !hasOffline {
			detail := "节点离线"
			if v.Error != "" {
				detail += " · " + v.Error
			}
			signals = append(signals, rcSignal{NodeID: v.ID, NodeName: v.Name, Kind: "offline", Detail: clipTextShort(detail, 140), Time: now.Unix()})
		}
	}
	if s.probes != nil {
		for _, st := range s.probes.States() {
			if len(st.Checks) == 0 || st.Up {
				continue
			}
			last := st.Checks[len(st.Checks)-1]
			if last.Time < cut {
				continue
			}
			detail := "拨测失败"
			if last.Error != "" {
				detail += " · " + last.Error
			} else if last.Code > 0 {
				detail += fmt.Sprintf(" · HTTP %d", last.Code)
			}
			signals = append(signals, rcSignal{NodeID: "probe:" + st.ID, NodeName: st.Name, Kind: "probe", Detail: clipTextShort(detail, 140), Time: last.Time})
		}
	}
	sort.SliceStable(signals, func(i, j int) bool { return signals[i].Time < signals[j].Time })
	rep.Count = len(signals)
	rep.Signals = append(rep.Signals, signals...)
	if len(signals) == 0 {
		rep.Empty = true
		rep.Summary = fmt.Sprintf("过去 %d 小时没有检测到节点事件或拨测失败，系统运行平稳。", hours)
		return rep
	}

	var groups [][]rcSignal
	for _, sig := range signals {
		if len(groups) == 0 {
			groups = append(groups, []rcSignal{sig})
			continue
		}
		last := groups[len(groups)-1]
		if sig.Time-last[len(last)-1].Time > 20*60 {
			groups = append(groups, []rcSignal{sig})
			continue
		}
		groups[len(groups)-1] = append(last, sig)
	}
	for _, group := range groups {
		nodeSet := map[string]bool{}
		nameSet := map[string]bool{}
		kindSet := map[string]bool{}
		var names []string
		for _, sig := range group {
			kindSet[sig.Kind] = true
			display := sig.NodeName
			if strings.HasPrefix(sig.NodeID, "probe:") {
				display = "拨测·" + sig.NodeName
			} else {
				nodeSet[sig.NodeID] = true
			}
			if !nameSet[display] {
				nameSet[display] = true
				names = append(names, display)
			}
		}
		var nodeIDs []string
		for id := range nodeSet {
			nodeIDs = append(nodeIDs, id)
		}
		var kinds []string
		for k := range kindSet {
			kinds = append(kinds, k)
		}
		sort.Strings(kinds)
		if len(nodeIDs) < 2 && len(kinds) < 2 {
			continue
		}
		c := rcCluster{
			Start:     group[0].Time,
			End:       group[len(group)-1].Time,
			Nodes:     nodeIDs,
			NodeNames: names,
			Kinds:     kinds,
			Signals:   group,
		}
		c.Title, c.Hypothesis, c.Advice, c.Confidence, c.Severity = classifyCluster(nodeIDs, kindSet, len(group))
		rep.Clusters = append(rep.Clusters, c)
	}
	sort.SliceStable(rep.Clusters, func(i, j int) bool { return rep.Clusters[i].End > rep.Clusters[j].End })
	if len(rep.Clusters) > 8 {
		rep.Clusters = rep.Clusters[:8]
	}

	type suspectAgg struct {
		name  string
		score int
		kinds map[string]int
	}
	agg := map[string]*suspectAgg{}
	for _, sig := range signals {
		if strings.HasPrefix(sig.NodeID, "probe:") {
			continue
		}
		a := agg[sig.NodeID]
		if a == nil {
			a = &suspectAgg{name: sig.NodeName, kinds: map[string]int{}}
			agg[sig.NodeID] = a
		}
		a.score += 12
		a.kinds[sig.Kind]++
	}
	for id, a := range agg {
		sp := rcSuspect{NodeID: id, NodeName: a.name, Score: a.score}
		for kind, count := range a.kinds {
			label := rcKindLabels[kind]
			if label == "" {
				label = kind
			}
			if count > 1 {
				sp.Reasons = append(sp.Reasons, fmt.Sprintf("%s ×%d", label, count))
			} else {
				sp.Reasons = append(sp.Reasons, label)
			}
		}
		sort.Strings(sp.Reasons)
		if sp.Score > 97 {
			sp.Score = 97
		}
		rep.Suspects = append(rep.Suspects, sp)
	}
	sort.SliceStable(rep.Suspects, func(i, j int) bool { return rep.Suspects[i].Score > rep.Suspects[j].Score })
	if len(rep.Suspects) > 5 {
		rep.Suspects = rep.Suspects[:5]
	}

	sort.SliceStable(rep.Signals, func(i, j int) bool { return rep.Signals[i].Time > rep.Signals[j].Time })
	if len(rep.Signals) > 40 {
		rep.Signals = rep.Signals[:40]
	}
	if len(rep.Clusters) == 0 {
		rep.Summary = fmt.Sprintf("过去 %d 小时发现 %d 条孤立异常信号，暂未形成跨节点的时间聚类，可结合事件回放单独查看。", hours, len(signals))
	} else {
		top := rep.Clusters[0]
		rep.Summary = fmt.Sprintf("过去 %d 小时发现 %d 条异常信号，聚合为 %d 组关联事件；最值得关注的是“%s”（置信度 %d%%），涉及 %s。",
			hours, len(signals), len(rep.Clusters), top.Title, top.Confidence, strings.Join(top.NodeNames, "、"))
	}
	return rep
}

func classifyCluster(realNodes []string, kinds map[string]bool, signalCount int) (title, hypothesis string, advice []string, confidence int, severity string) {
	severity = "low"
	switch {
	case len(realNodes) >= 2 && kinds["offline"]:
		title = "多节点离线 / 链路异常"
		hypothesis = "多台节点在同一时间窗离线或失联，问题更可能来自网络链路、机房供电或宿主机层，而不是单个应用。"
		advice = []string{"用 ping / mtr 从其他节点验证到异常节点的链路", "检查云厂商或机房网络公告、安全组与端口变更", "确认节点电源与宿主状态，必要时通过控制台登录"}
		confidence = 62 + len(realNodes)*7
		severity = "high"
	case len(realNodes) >= 2 && kinds["probe"]:
		title = "多节点异常 + 拨测失败"
		hypothesis = "节点指标异常与外部拨测失败同时出现，可能是共用上游服务、DNS 或公网链路问题，也可能由同一次变更触发。"
		advice = []string{"先确认拨测目标是单点故障还是多个目标同时失败", "对比异常节点的 DNS、证书与出口网络", "对照变更记录与最近部署时间线"}
		confidence = 58 + len(realNodes)*6
		severity = "high"
	case len(realNodes) >= 2 && (kinds["cpu"] || kinds["mem"] || kinds["docker"]):
		title = "多节点载荷同步波动"
		hypothesis = "多台节点在同一时段出现 CPU、内存或容器异常，常见原因是批量任务、上游依赖抖动或同一镜像/编排变更。"
		advice = []string{"对照变更记录与 crontab 定时任务", "检查共用镜像仓库、数据库或上游 API", "把备份与批处理任务错峰执行"}
		confidence = 55 + len(realNodes)*6
		if len(realNodes) >= 3 {
			severity = "high"
		} else {
			severity = "medium"
		}
	case len(realNodes) >= 2 && (kinds["disk"] || kinds["temp"]):
		title = "存储 / 温度压力聚集"
		hypothesis = "多节点磁盘或温度同时升高，可能是集中备份、日志暴涨或环境散热问题。"
		advice = []string{"检查日志轮转与备份目录增长", "用 docker system df 查看镜像与容器日志占用", "为关键分区与温度设置告警阈值"}
		confidence = 55 + len(realNodes)*5
		severity = "medium"
	case len(realNodes) == 1 && len(kinds) >= 2:
		title = "单节点多指标异常"
		hypothesis = "单台节点多项指标同时异常，优先排查该节点自身的进程、容器与系统日志，而不是外部链路。"
		advice = []string{"查看该节点的事件时间轴与容器退出记录", "用 AI 助手分析该节点的进程与日志", "在故障演练场预演一次处置流程"}
		confidence = 50 + len(kinds)*6
		severity = "medium"
	case kinds["probe"]:
		title = "外部可达性异常"
		hypothesis = "仅拨测目标失败而节点指标平稳，问题更可能出在目标站点、证书或外部链路上。"
		advice = []string{"检查目标站点证书有效期与 HTTP 状态码", "从多台节点分别访问目标确认是否地域性故障", "确认目标服务是否在维护窗口"}
		confidence = 60 + minInt(signalCount, 4)*4
		if len(realNodes) > 0 {
			severity = "medium"
		}
	default:
		title = "时间窗关联异常"
		hypothesis = "时间窗内出现关联异常信号，建议对照变更记录确认是否由发布或配置调整触发。"
		advice = []string{"对照变更记录与最近部署", "查看相关节点的 Top 进程与容器状态", "在拨测页面确认外部可达性"}
		confidence = 45 + len(realNodes)*5
		severity = "medium"
	}
	confidence += minInt(signalCount, 6) * 2
	if confidence > 92 {
		confidence = 92
	}
	if confidence < 40 {
		confidence = 40
	}
	if kinds["offline"] || len(realNodes) >= 3 {
		severity = "high"
	}
	return title, hypothesis, advice, confidence, severity
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (s *Server) handleRootCause(w http.ResponseWriter, r *http.Request) {
	hours := 24
	if v := r.URL.Query().Get("hours"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			hours = n
		}
	}
	writeJSON(w, http.StatusOK, s.buildRootCause(hours))
}

func (s *Server) handleRootCauseAI(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Hours int `json:"hours"`
	}
	_ = readJSON(r, &req)
	hours := req.Hours
	if hours <= 0 {
		hours = 24
	}
	rep := s.buildRootCause(hours)
	if rep.Empty {
		writeErr(w, http.StatusBadRequest, "当前时间窗没有异常信号，无需根因分析")
		return
	}
	set := s.store.Settings()
	if !aiReady(set) {
		writeErr(w, http.StatusBadRequest, "AI 助手尚未配置，请先在设置中填写 Base URL、模型和 API Key")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 75*time.Second)
	defer cancel()
	reply, err := ai.ChatTokens(ctx, set.AIBase, set.AIKey, set.AIModel, []ai.Message{
		{Role: "system", Content: "你是资深 SRE，负责做跨节点根因分析。只依据给出的信号与关联结果作答，不要编造系统状态。用中文输出 250-400 字：先给最可能的根因假设（按可能性排序），再说明判断依据，最后给出 2-3 条只读的排查命令或动作。不要输出代码块。"},
		{Role: "user", Content: rcReportText(rep)},
	}, 900)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	s.audit.Add("admin", "", "根因分析.AI", fmt.Sprintf("%d 小时", hours))
	writeJSON(w, http.StatusOK, map[string]any{"text": strings.TrimSpace(reply), "ai": true})
}

func rcReportText(rep rcReport) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "时间窗：过去 %d 小时；节点数：%d；异常信号：%d 条。\n", rep.WindowHours, rep.Nodes, rep.Count)
	sb.WriteString(rep.Summary + "\n\n")
	if len(rep.Suspects) > 0 {
		sb.WriteString("重点怀疑节点：\n")
		for i, sp := range rep.Suspects {
			if i >= 5 {
				break
			}
			fmt.Fprintf(&sb, "- %s：%s\n", sp.NodeName, strings.Join(sp.Reasons, "、"))
		}
	}
	for i, c := range rep.Clusters {
		if i >= 4 {
			break
		}
		fmt.Fprintf(&sb, "\n关联事件 %d：%s（%s，置信度 %d%%）\n", i+1, c.Title, c.Severity, c.Confidence)
		fmt.Fprintf(&sb, "涉及节点：%s；假设：%s\n", strings.Join(c.NodeNames, "、"), c.Hypothesis)
		for j, sig := range c.Signals {
			if j >= 10 {
				break
			}
			fmt.Fprintf(&sb, "- %s %s：%s\n", time.Unix(sig.Time, 0).Format("01-02 15:04"), sig.NodeName, sig.Detail)
		}
	}
	return sb.String()
}
