package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"kaypanel/internal/ai"
	"kaypanel/internal/metrics"
	"kaypanel/internal/node"
)

type queryMetric struct {
	Key   string
	Label string
	Unit  string
	Kind  string
	Pick  func(metrics.Snapshot) float64
	Valid func(metrics.Snapshot) bool
}

var queryMetrics = map[string]queryMetric{
	"cpu": {
		Key: "cpu", Label: "CPU 使用率", Unit: "%", Kind: "percent",
		Pick: func(s metrics.Snapshot) float64 { return s.CPU },
		Valid: func(s metrics.Snapshot) bool { return true },
	},
	"mem": {
		Key: "mem", Label: "内存使用率", Unit: "%", Kind: "percent",
		Pick: func(s metrics.Snapshot) float64 { return metricPct(s.MemUsed, s.MemTotal) },
		Valid: func(s metrics.Snapshot) bool { return s.MemTotal > 0 },
	},
	"disk": {
		Key: "disk", Label: "磁盘使用率", Unit: "%", Kind: "percent",
		Pick: func(s metrics.Snapshot) float64 { return metricPct(s.DiskUsed, s.DiskTotal) },
		Valid: func(s metrics.Snapshot) bool { return s.DiskTotal > 0 },
	},
	"load": {
		Key: "load", Label: "1 分钟负载", Unit: "", Kind: "load",
		Pick: func(s metrics.Snapshot) float64 { return s.Load1 },
		Valid: func(s metrics.Snapshot) bool { return true },
	},
	"net": {
		Key: "net", Label: "网络吞吐", Unit: "B/s", Kind: "bytes",
		Pick: func(s metrics.Snapshot) float64 { return s.NetRx + s.NetTx },
		Valid: func(s metrics.Snapshot) bool { return true },
	},
	"temp": {
		Key: "temp", Label: "温度", Unit: "°C", Kind: "temp",
		Pick: func(s metrics.Snapshot) float64 { return s.Temp },
		Valid: func(s metrics.Snapshot) bool { return s.Temp > 0 },
	},
	"docker": {
		Key: "docker", Label: "运行容器数", Unit: "个", Kind: "count",
		Pick: func(s metrics.Snapshot) float64 { return float64(s.DockerRunning) },
		Valid: func(s metrics.Snapshot) bool { return s.DockerTotal > 0 },
	},
}

var queryMetricAliases = []struct{ word, key string }{
	{"cpu", "cpu"}, {"处理器", "cpu"}, {"核心占用", "cpu"},
	{"内存", "mem"}, {"运存", "mem"}, {"memory", "mem"}, {"mem", "mem"},
	{"磁盘", "disk"}, {"硬盘", "disk"}, {"根分区", "disk"}, {"disk", "disk"}, {"空间使用", "disk"},
	{"负载", "load"}, {"load", "load"},
	{"网络", "net"}, {"流量", "net"}, {"带宽", "net"}, {"上下行", "net"},
	{"温度", "temp"}, {"temp", "temp"},
	{"容器数", "docker"}, {"容器数量", "docker"}, {"运行容器", "docker"}, {"docker", "docker"},
}

var (
	reQueryDays  = regexp.MustCompile(`(最近|过去|近|前)?\s*(\d{1,2})\s*个?\s*天`)
	reQueryHours = regexp.MustCompile(`(最近|过去|近|前)?\s*(\d{1,3})\s*个?\s*(小时|钟头|h)`)
	reQueryThr   = regexp.MustCompile(`(超过|高于|大于|超出|达到|至少|>=|>)\s*(\d{1,4}(\.\d+)?)`)
	reQueryAbove = regexp.MustCompile(`(\d{1,4}(\.\d+)?)\s*(%|度|℃)?\s*(以上|及以上|往上)`)
)

type querySpec struct {
	Metric       string  `json:"metric"`
	Agg          string  `json:"agg"`
	From         int64   `json:"from"`
	To           int64   `json:"to"`
	Window       string  `json:"window"`
	NodeID       string  `json:"node_id,omitempty"`
	NodeName     string  `json:"node,omitempty"`
	Threshold    float64 `json:"threshold,omitempty"`
	HasThreshold bool    `json:"has_threshold"`
}

type queryPoint struct {
	Time  int64   `json:"time"`
	Value float64 `json:"value"`
}

type queryRow struct {
	NodeID     string  `json:"node"`
	NodeName   string  `json:"node_name"`
	Value      float64 `json:"value"`
	At         int64   `json:"at"`
	Online     bool    `json:"online"`
	Points     int     `json:"points"`
	AboveCount int     `json:"above_count,omitempty"`
	AbovePct   float64 `json:"above_pct,omitempty"`
}

type queryResult struct {
	Query       string       `json:"query"`
	Spec        querySpec    `json:"spec"`
	Mode        string       `json:"mode"`
	MetricLabel string       `json:"metric_label"`
	Unit        string       `json:"unit"`
	UnitKind    string       `json:"unit_kind"`
	AggLabel    string       `json:"agg_label"`
	Value       *float64     `json:"value"`
	At          int64        `json:"at"`
	SeriesNode  string       `json:"series_node"`
	Series      []queryPoint `json:"series"`
	Rows        []queryRow   `json:"rows"`
	Nodes       int          `json:"nodes"`
	Samples     int          `json:"samples"`
	Answer      string       `json:"answer"`
	Parser      string       `json:"parser"`
	AIError     string       `json:"ai_error,omitempty"`
}

func parseQueryAgg(q string) string {
	switch {
	case strings.Contains(q, "平均") || strings.Contains(q, "均值") || strings.Contains(q, "avg"):
		return "avg"
	case strings.Contains(q, "最低") || strings.Contains(q, "最小") || strings.Contains(q, "谷值") || strings.Contains(q, "min"):
		return "min"
	case strings.Contains(q, "最高") || strings.Contains(q, "最大") || strings.Contains(q, "峰值") || strings.Contains(q, "max"):
		return "max"
	case strings.Contains(q, "现在") || strings.Contains(q, "当前") || strings.Contains(q, "最新") || strings.Contains(q, "此刻"):
		return "latest"
	default:
		return "max"
	}
}

func parseQueryWindow(q string, now time.Time) (int64, int64, string) {
	y, m, d := now.Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, now.Location())
	if strings.Contains(q, "昨天") || strings.Contains(q, "昨日") {
		start := today.AddDate(0, 0, -1)
		return start.Unix(), today.Unix(), "昨天"
	}
	if strings.Contains(q, "今天") || strings.Contains(q, "今日") {
		return today.Unix(), now.Unix(), "今天"
	}
	if m := reQueryDays.FindStringSubmatch(q); m != nil {
		n, _ := strconv.Atoi(m[2])
		if n < 1 {
			n = 1
		}
		if n > 7 {
			n = 7
		}
		return now.Add(-time.Duration(n) * 24 * time.Hour).Unix(), now.Unix(), fmt.Sprintf("最近 %d 天", n)
	}
	if m := reQueryHours.FindStringSubmatch(q); m != nil {
		n, _ := strconv.Atoi(m[2])
		if n < 1 {
			n = 1
		}
		if n > 168 {
			n = 168
		}
		return now.Add(-time.Duration(n) * time.Hour).Unix(), now.Unix(), fmt.Sprintf("最近 %d 小时", n)
	}
	if strings.Contains(q, "一周") || strings.Contains(q, "本周") || strings.Contains(q, "这周") {
		return now.Add(-7 * 24 * time.Hour).Unix(), now.Unix(), "最近 7 天"
	}
	return now.Add(-24 * time.Hour).Unix(), now.Unix(), "最近 24 小时"
}

func parseQueryThreshold(q string) (float64, bool) {
	if m := reQueryThr.FindStringSubmatch(q); m != nil {
		v, err := strconv.ParseFloat(m[2], 64)
		if err == nil && v > 0 && v <= 100000 {
			return v, true
		}
	}
	if m := reQueryAbove.FindStringSubmatch(q); m != nil {
		v, err := strconv.ParseFloat(m[1], 64)
		if err == nil && v > 0 && v <= 100000 {
			return v, true
		}
	}
	return 0, false
}

func matchQueryNode(q string, views []node.View) (string, string) {
	list := append([]node.View(nil), views...)
	sort.SliceStable(list, func(i, j int) bool { return len([]rune(list[i].Name)) > len([]rune(list[j].Name)) })
	for _, v := range list {
		name := strings.ToLower(v.Name)
		if name != "" && strings.Contains(q, name) {
			return v.ID, v.Name
		}
	}
	return "", ""
}

func parseQueryLocal(q string, views []node.View, now time.Time) (querySpec, bool) {
	lq := strings.ToLower(q)
	metric := ""
	for _, al := range queryMetricAliases {
		if strings.Contains(lq, al.word) {
			metric = al.key
			break
		}
	}
	if metric == "" {
		return querySpec{}, false
	}
	spec := querySpec{Metric: metric, Agg: parseQueryAgg(lq)}
	spec.From, spec.To, spec.Window = parseQueryWindow(lq, now)
	spec.NodeID, spec.NodeName = matchQueryNode(lq, views)
	if thr, ok := parseQueryThreshold(lq); ok {
		spec.Threshold, spec.HasThreshold = thr, true
	}
	return spec, true
}

func (s *Server) parseQueryAI(ctx context.Context, q string, views []node.View) (querySpec, error) {
	set := s.store.Settings()
	var names []string
	for _, v := range views {
		if v.Name != "" {
			names = append(names, v.Name)
		}
	}
	system := "把用户的中文服务器指标查询解析成 JSON，只输出 JSON，不要解释。格式：{\"metric\":\"cpu|mem|disk|load|net|temp|docker\",\"agg\":\"max|min|avg|latest\",\"window_hours\":24,\"node\":\"节点名或空字符串\",\"threshold\":0}。" +
		"window_hours 为 1-168 的整数；threshold 为数值阈值，没有阈值时为 0。可用节点名：" + strings.Join(names, "、")
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	reply, err := ai.ChatTokens(ctx, set.AIBase, set.AIKey, set.AIModel, []ai.Message{
		{Role: "system", Content: system},
		{Role: "user", Content: q},
	}, 200)
	if err != nil {
		return querySpec{}, err
	}
	start := strings.Index(reply, "{")
	end := strings.LastIndex(reply, "}")
	if start < 0 || end <= start {
		return querySpec{}, fmt.Errorf("AI 未返回可用的查询结构")
	}
	var out struct {
		Metric      string  `json:"metric"`
		Agg         string  `json:"agg"`
		WindowHours int     `json:"window_hours"`
		Node        string  `json:"node"`
		Threshold   float64 `json:"threshold"`
	}
	if err := json.Unmarshal([]byte(reply[start:end+1]), &out); err != nil {
		return querySpec{}, fmt.Errorf("AI 返回的 JSON 无法解析")
	}
	if _, ok := queryMetrics[out.Metric]; !ok {
		return querySpec{}, fmt.Errorf("AI 未识别出指标")
	}
	agg := out.Agg
	if agg != "max" && agg != "min" && agg != "avg" && agg != "latest" {
		agg = "max"
	}
	hours := out.WindowHours
	if hours < 1 {
		hours = 24
	}
	if hours > 168 {
		hours = 168
	}
	now := time.Now()
	spec := querySpec{
		Metric: out.Metric,
		Agg:    agg,
		From:   now.Add(-time.Duration(hours) * time.Hour).Unix(),
		To:     now.Unix(),
		Window: fmt.Sprintf("最近 %d 小时", hours),
	}
	if out.Node != "" {
		want := strings.ToLower(strings.TrimSpace(out.Node))
		for _, v := range views {
			name := strings.ToLower(v.Name)
			if name == want || strings.Contains(name, want) || strings.Contains(want, name) {
				spec.NodeID, spec.NodeName = v.ID, v.Name
				break
			}
		}
	}
	if out.Threshold > 0 && out.Threshold <= 100000 {
		spec.Threshold, spec.HasThreshold = out.Threshold, true
	}
	return spec, nil
}

func (s *Server) handleQuery(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Q string `json:"q"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	q := strings.TrimSpace(req.Q)
	if q == "" {
		writeErr(w, http.StatusBadRequest, "请输入要查询的内容")
		return
	}
	if len([]rune(q)) > 200 {
		writeErr(w, http.StatusBadRequest, "查询内容过长")
		return
	}
	views := s.mgr.Views()
	spec, ok := parseQueryLocal(q, views, time.Now())
	parser := "本地"
	aiErr := ""
	if !ok && aiReady(s.store.Settings()) {
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		spec2, err := s.parseQueryAI(ctx, q, views)
		cancel()
		if err == nil {
			spec, ok, parser = spec2, true, "AI"
		} else {
			aiErr = err.Error()
		}
	}
	if !ok {
		writeErr(w, http.StatusBadRequest, "没听懂这句查询，可以试试：最近 24 小时 CPU 最高的节点 / 今天内存超过 80% 的节点 / 过去 7 天各节点磁盘平均 / 当前负载")
		return
	}
	res := s.runQuery(spec, views, q)
	res.Parser = parser
	res.AIError = aiErr
	s.audit.Add("admin", "", "指标问答", firstN(q, 60))
	writeJSON(w, http.StatusOK, res)
}

func querySamples(n *node.Node, from, to int64) []metrics.Snapshot {
	filter := func(list []metrics.Snapshot) []metrics.Snapshot {
		out := make([]metrics.Snapshot, 0, len(list))
		for _, sp := range list {
			if sp.Time >= from && sp.Time <= to {
				out = append(out, sp)
			}
		}
		return out
	}
	if out := filter(n.Trend()); len(out) > 0 {
		return out
	}
	return filter(n.View().History)
}

func (s *Server) runQuery(spec querySpec, views []node.View, q string) queryResult {
	met := queryMetrics[spec.Metric]
	res := queryResult{
		Query:       q,
		Spec:        spec,
		MetricLabel: met.Label,
		Unit:        met.Unit,
		UnitKind:    met.Kind,
		AggLabel:    map[string]string{"max": "最高", "min": "最低", "avg": "平均", "latest": "最新"}[spec.Agg],
		Rows:        []queryRow{},
		Series:      []queryPoint{},
	}
	if res.AggLabel == "" {
		res.AggLabel = "最高"
	}
	if spec.HasThreshold {
		res.Mode = "threshold"
		res.AggLabel = "超过阈值"
	} else {
		res.Mode = "stat"
	}
	type nodeScan struct {
		row    queryRow
		series []queryPoint
		sum    float64
		count  int
		maxVal float64
		maxAt  int64
		hasMax bool
	}
	var scans []*nodeScan
	var globalSum float64
	var globalCount int
	var globalMax, globalMin float64
	var globalMaxAt, globalMinAt int64
	var latestAt int64
	var latestVal float64
	for _, v := range views {
		if spec.NodeID != "" && v.ID != spec.NodeID {
			continue
		}
		if v.SFTPOnly {
			continue
		}
		n, ok := s.mgr.Get(v.ID)
		if !ok {
			continue
		}
		samples := querySamples(n, spec.From, spec.To)
		if len(samples) == 0 {
			continue
		}
		sc := &nodeScan{}
		sc.row.NodeID = v.ID
		sc.row.NodeName = v.Name
		sc.row.Online = v.Online
		sc.row.At = samples[len(samples)-1].Time
		first := true
		for _, sp := range samples {
			if met.Valid != nil && !met.Valid(sp) {
				continue
			}
			val := met.Pick(sp)
			pt := queryPoint{Time: sp.Time, Value: val}
			sc.series = append(sc.series, pt)
			sc.sum += val
			sc.count++
			if !sc.hasMax || val > sc.maxVal {
				sc.maxVal, sc.maxAt, sc.hasMax = val, sp.Time, true
			}
			globalSum += val
			globalCount++
			switch {
			case first:
				sc.row.Value = val
				sc.row.At = sp.Time
				first = false
			case spec.Agg == "max" && val > sc.row.Value:
				sc.row.Value, sc.row.At = val, sp.Time
			case spec.Agg == "min" && val < sc.row.Value:
				sc.row.Value, sc.row.At = val, sp.Time
			case spec.Agg == "avg":
				sc.row.Value = sc.sum / float64(sc.count)
				sc.row.At = sp.Time
			case spec.Agg == "latest":
				sc.row.Value, sc.row.At = val, sp.Time
			}
			if spec.HasThreshold && val > spec.Threshold {
				sc.row.AboveCount++
			}
			if res.Mode == "stat" && !spec.HasThreshold {
				if globalCount == 1 || val > globalMax {
					globalMax, globalMaxAt = val, sp.Time
				}
				if globalCount == 1 || val < globalMin {
					globalMin, globalMinAt = val, sp.Time
				}
			}
			if sp.Time >= latestAt {
				latestAt, latestVal = sp.Time, val
			}
		}
		if sc.count == 0 {
			continue
		}
		sc.row.Points = sc.count
		if spec.Agg == "avg" {
			sc.row.Value = sc.sum / float64(sc.count)
			sc.row.At = samples[len(samples)-1].Time
		}
		if spec.HasThreshold {
			sc.row.Value, sc.row.At = sc.maxVal, sc.maxAt
			sc.row.AbovePct = float64(sc.row.AboveCount) / float64(sc.count) * 100
			if sc.row.AboveCount == 0 {
				continue
			}
		}
		scans = append(scans, sc)
	}
	res.Samples = globalCount
	res.Nodes = len(scans)
	if len(scans) == 0 {
		if spec.HasThreshold && globalCount > 0 {
			zero := 0.0
			res.Value = &zero
			res.Unit = "台"
			res.Answer = buildQueryAnswer(&res)
			return res
		}
		res.Answer = "该时间窗内没有采样数据；节点可能离线，或面板刚启动还在积累历史。"
		return res
	}
	if spec.HasThreshold {
		sort.SliceStable(scans, func(i, j int) bool {
			if scans[i].row.AboveCount != scans[j].row.AboveCount {
				return scans[i].row.AboveCount > scans[j].row.AboveCount
			}
			return scans[i].row.Value > scans[j].row.Value
		})
		for _, sc := range scans {
			res.Rows = append(res.Rows, sc.row)
		}
		n := float64(len(scans))
		res.Value = &n
		res.Unit = "台"
		res.SeriesNode = scans[0].row.NodeName
		res.Series = downsamplePoints(scans[0].series, 120)
		res.Answer = buildQueryAnswer(&res)
		return res
	}
	sort.SliceStable(scans, func(i, j int) bool {
		switch spec.Agg {
		case "min":
			return scans[i].row.Value < scans[j].row.Value
		case "latest":
			return scans[i].row.At > scans[j].row.At
		default:
			return scans[i].row.Value > scans[j].row.Value
		}
	})
	for _, sc := range scans {
		res.Rows = append(res.Rows, sc.row)
	}
	var value float64
	switch spec.Agg {
	case "avg":
		value = globalSum / float64(globalCount)
		res.At = latestAt
	case "min":
		value, res.At = globalMin, globalMinAt
	case "latest":
		value, res.At = latestVal, latestAt
	default:
		value, res.At = globalMax, globalMaxAt
	}
	res.Value = &value
	res.SeriesNode = scans[0].row.NodeName
	res.Series = downsamplePoints(scans[0].series, 120)
	res.Answer = buildQueryAnswer(&res)
	return res
}

func downsamplePoints(points []queryPoint, limit int) []queryPoint {
	if len(points) <= limit {
		return points
	}
	out := make([]queryPoint, 0, limit)
	step := float64(len(points)) / float64(limit)
	for i := 0; i < limit; i++ {
		out = append(out, points[int(float64(i)*step)])
	}
	out[len(out)-1] = points[len(points)-1]
	return out
}

func formatMetricValue(kind string, v float64) string {
	switch kind {
	case "percent":
		return fmt.Sprintf("%.1f%%", v)
	case "bytes":
		return fmtBytes(uint64(v)) + "/s"
	case "load":
		return fmt.Sprintf("%.2f", v)
	case "temp":
		return fmt.Sprintf("%.0f°C", v)
	case "count":
		return fmt.Sprintf("%.0f 个", v)
	}
	return fmt.Sprintf("%.1f", v)
}

func formatQueryThreshold(kind string, v float64) string {
	switch kind {
	case "percent":
		return strconv.FormatFloat(v, 'f', -1, 64) + "%"
	case "bytes":
		return fmtBytes(uint64(v)) + "/s"
	case "temp":
		return strconv.FormatFloat(v, 'f', -1, 64) + "°C"
	}
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func shortTime(unix int64) string {
	if unix <= 0 {
		return "-"
	}
	return time.Unix(unix, 0).Format("01-02 15:04")
}

func buildQueryAnswer(res *queryResult) string {
	spec := res.Spec
	if res.Samples == 0 {
		return "该时间窗内没有采样数据；节点可能离线，或面板刚启动还在积累历史。"
	}
	if res.Mode == "threshold" {
		thr := formatQueryThreshold(res.UnitKind, spec.Threshold)
		if len(res.Rows) == 0 {
			return fmt.Sprintf("%s，没有节点的%s超过 %s。", spec.Window, res.MetricLabel, thr)
		}
		var parts []string
		for i, row := range res.Rows {
			if i >= 3 {
				break
			}
			parts = append(parts, fmt.Sprintf("%s（最高 %s，%d/%d 次）", row.NodeName, formatMetricValue(res.UnitKind, row.Value), row.AboveCount, row.Points))
		}
		more := ""
		if len(res.Rows) > 3 {
			more = fmt.Sprintf(" 等 %d 台", len(res.Rows))
		}
		return fmt.Sprintf("%s，%d 台节点的%s超过 %s：%s%s。", spec.Window, len(res.Rows), res.MetricLabel, thr, strings.Join(parts, "、"), more)
	}
	if spec.NodeID != "" {
		row := res.Rows[0]
		return fmt.Sprintf("%s，%s 的%s%s为 %s（%s）。", spec.Window, spec.NodeName, res.MetricLabel, res.AggLabel, formatMetricValue(res.UnitKind, row.Value), shortTime(row.At))
	}
	top := res.Rows[0]
	if spec.Agg == "avg" {
		return fmt.Sprintf("%s，%d 台节点的%s平均为 %s；均值最高的是 %s（%s）。", spec.Window, len(res.Rows), res.MetricLabel, formatMetricValue(res.UnitKind, *res.Value), top.NodeName, formatMetricValue(res.UnitKind, top.Value))
	}
	if spec.Agg == "latest" {
		return fmt.Sprintf("%s，%s 的%s最新为 %s（%s）。", spec.Window, top.NodeName, res.MetricLabel, formatMetricValue(res.UnitKind, top.Value), shortTime(top.At))
	}
	return fmt.Sprintf("%s，%d 台节点中%s%s的是 %s：%s（%s）。", spec.Window, len(res.Rows), res.MetricLabel, res.AggLabel, top.NodeName, formatMetricValue(res.UnitKind, top.Value), shortTime(top.At))
}
