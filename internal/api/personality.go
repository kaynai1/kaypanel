package api

import (
	"fmt"
	"net/http"
	"time"

	"kaypanel/internal/metrics"
	"kaypanel/internal/node"
)

type personalityNode struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Addr       string   `json:"addr"`
	User       string   `json:"user"`
	OS         string   `json:"os,omitempty"`
	Online     bool     `json:"online"`
	SFTPOnly   bool     `json:"sftp_only"`
	Title      string   `json:"title"`
	Tags       []string `json:"tags"`
	Line       string   `json:"line"`
	Stable     int      `json:"stable"`
	StableText string   `json:"stable_text"`
	CPUAvg     float64  `json:"cpu_avg"`
	MemAvg     float64  `json:"mem_avg"`
	DiskPct    float64  `json:"disk_pct"`
	Temp       float64  `json:"temp"`
	Uptime     float64  `json:"uptime"`
	UptimeText string   `json:"uptime_text"`
	PeakCPU    float64  `json:"peak_cpu"`
	Cores      int      `json:"cores"`
	Containers int      `json:"containers"`
	Events     int      `json:"events"`
	Offline    int      `json:"offline_events"`
	Samples    int      `json:"samples"`
	Days       float64  `json:"days"`
}

type personalityHighlight struct {
	Label string `json:"label"`
	Name  string `json:"name"`
	Value string `json:"value"`
}

type personalityReport struct {
	Time    int64                `json:"time"`
	Version string               `json:"version"`
	Average int                  `json:"average"`
	Days    float64              `json:"days"`
	Samples int                  `json:"samples"`
	Nodes   []personalityNode    `json:"nodes"`
	Top     []personalityHighlight `json:"highlights"`
}

func humanUptime(sec float64) string {
	if sec <= 0 {
		return "—"
	}
	d := int(sec) / 86400
	h := int(sec) % 86400 / 3600
	m := int(sec) % 3600 / 60
	switch {
	case d > 0:
		return fmt.Sprintf("%d 天 %d 小时", d, h)
	case h > 0:
		return fmt.Sprintf("%d 小时 %d 分", h, m)
	default:
		return fmt.Sprintf("%d 分钟", m)
	}
}

func apiPct(used, total uint64) float64 {
	if total == 0 {
		return 0
	}
	return float64(used) / float64(total) * 100
}

func addTag(tags []string, tag string) []string {
	if tag == "" || len(tags) >= 4 {
		return tags
	}
	for _, t := range tags {
		if t == tag {
			return tags
		}
	}
	return append(tags, tag)
}

func personalityOf(v node.View, trend []metrics.Snapshot, events []node.Event) personalityNode {
	p := personalityNode{
		ID:       v.ID,
		Name:     v.Name,
		Addr:     v.Addr,
		User:     v.User,
		Online:   v.Online,
		SFTPOnly: v.SFTPOnly,
		OS:       v.Latest.OS,
		Cores:    v.Latest.Cores,
		Temp:     v.Latest.Temp,
		Uptime:   v.Latest.Uptime,
		UptimeText: humanUptime(v.Latest.Uptime),
		Containers: v.Latest.DockerTotal,
		Events:     len(events),
		Tags:       []string{},
	}
	p.DiskPct = apiPct(v.Latest.DiskUsed, v.Latest.DiskTotal)
	for _, e := range events {
		if e.Title == "节点离线" {
			p.Offline++
		}
	}

	samples := trend
	if len(samples) == 0 {
		samples = v.History
	}
	p.Samples = len(samples)
	if len(samples) > 1 {
		p.Days = float64(samples[len(samples)-1].Time-samples[0].Time) / 86400
	}
	var cpuSum, memSum float64
	nightSum, daySum := 0.0, 0.0
	nightN, dayN := 0, 0
	for _, sp := range samples {
		cpuSum += sp.CPU
		memSum += apiPct(sp.MemUsed, sp.MemTotal)
		if sp.CPU > p.PeakCPU {
			p.PeakCPU = sp.CPU
		}
		if sp.Time > 0 {
			if time.Unix(sp.Time, 0).Hour() < 6 {
				nightSum += sp.CPU
				nightN++
			} else {
				daySum += sp.CPU
				dayN++
			}
		}
	}
	if len(samples) > 0 {
		p.CPUAvg = cpuSum / float64(len(samples))
		p.MemAvg = memSum / float64(len(samples))
	} else {
		p.MemAvg = apiPct(v.Latest.MemUsed, v.Latest.MemTotal)
	}

	if !v.Online {
		p.Title = "失联中"
		p.Tags = append(p.Tags, "等待重连")
		if v.Latest.Hostname != "" {
			p.Line = "最后一次采集在 " + humanUptime(time.Since(time.Unix(v.Latest.Time, 0)).Seconds()) + "前"
		} else {
			p.Line = "还没有成功采集过指标"
		}
	} else if v.SFTPOnly {
		p.Title = "佛系主机"
		p.Tags = append(p.Tags, "只做文件", "与世无争")
		p.Line = "只提供 SFTP 文件管理，不跑容器，也不内卷。"
	} else {
		p.Line = fmt.Sprintf("在线运行 %s，平均 CPU %.0f%%、内存 %.0f%%", p.UptimeText, p.CPUAvg, p.MemAvg)
		if len(samples) < 2 {
			p.Tags = addTag(p.Tags, "数据积累中")
		}
	}

	if v.Online && !v.SFTPOnly {
		if p.Offline >= 5 {
			p.Title = "惊弓之鸟"
			p.Tags = addTag(p.Tags, "网络敏感")
		} else if p.MemAvg >= 85 {
			p.Title = "内存饕餮"
			p.Tags = addTag(p.Tags, "大胃王")
		} else if p.DiskPct >= 90 {
			p.Title = "仓库爆仓"
			p.Tags = addTag(p.Tags, "囤积癖")
		} else if p.CPUAvg >= 60 {
			p.Title = "卷王"
			p.Tags = addTag(p.Tags, "高负载")
		} else if p.Uptime >= 30*86400 {
			p.Title = "老黄牛"
			p.Tags = addTag(p.Tags, "长跑")
		} else if p.Containers >= 10 {
			p.Title = "码头管理员"
			p.Tags = addTag(p.Tags, "集装箱")
		} else if p.Temp >= 75 {
			p.Title = "发烧友"
			p.Tags = addTag(p.Tags, "怕热")
		} else if p.DiskPct > 0 && p.DiskPct <= 30 && p.MemAvg <= 50 {
			p.Title = "极简主义"
			p.Tags = addTag(p.Tags, "洁癖")
		} else if p.Uptime >= 7*86400 {
			p.Title = "稳如老狗"
			p.Tags = addTag(p.Tags, "长跑")
		} else {
			p.Title = "摸鱼选手"
		}
		if p.MemAvg >= 60 && p.MemAvg < 85 {
			p.Tags = addTag(p.Tags, "能吃内存")
		}
		if p.DiskPct >= 70 && p.DiskPct < 90 {
			p.Tags = addTag(p.Tags, "囤积癖")
		}
		if p.DiskPct > 0 && p.DiskPct <= 30 {
			p.Tags = addTag(p.Tags, "洁癖")
		}
		if p.Temp > 0 && p.Temp <= 35 {
			p.Tags = addTag(p.Tags, "冷静派")
		}
		if p.Temp >= 70 && p.Temp < 75 {
			p.Tags = addTag(p.Tags, "有点热")
		}
		if p.Containers >= 5 && p.Containers < 10 {
			p.Tags = addTag(p.Tags, "集装箱")
		}
		if p.Containers == 0 {
			p.Tags = addTag(p.Tags, "空手道")
		}
		if p.PeakCPU >= 95 {
			p.Tags = addTag(p.Tags, "爆表过")
		}
		if nightN >= 4 && dayN > 0 {
			nightAvg := nightSum / float64(nightN)
			dayAvg := daySum / float64(dayN)
			if nightAvg >= 10 && nightAvg >= dayAvg*1.35 {
				p.Tags = addTag(p.Tags, "夜猫子")
			}
		}
	}

	stable := 100
	for _, e := range events {
		switch e.Level {
		case "error":
			stable -= 15
		case "warn":
			stable -= 4
		}
	}
	if !v.Online {
		stable = 0
	}
	if stable < 0 {
		stable = 0
	}
	p.Stable = stable
	switch {
	case !v.Online:
		p.StableText = "等待重连"
	case stable >= 95:
		p.StableText = "稳如老狗"
	case stable >= 80:
		p.StableText = "相当可靠"
	case stable >= 60:
		p.StableText = "偶有波动"
	default:
		p.StableText = "多灾多难"
	}
	return p
}

func (s *Server) handlePersonality(w http.ResponseWriter, r *http.Request) {
	views := s.mgr.Views()
	nodes := make([]personalityNode, 0, len(views))
	for _, v := range views {
		n, ok := s.mgr.Get(v.ID)
		if !ok {
			continue
		}
		nodes = append(nodes, personalityOf(v, n.Trend(), n.Events()))
	}
	report := personalityReport{
		Time:    time.Now().Unix(),
		Version: s.version,
		Nodes:   nodes,
		Top:     []personalityHighlight{},
	}
	total := 0
	samples := 0
	days := 0.0
	for _, p := range nodes {
		total += p.Stable
		samples += p.Samples
		if p.Days > days {
			days = p.Days
		}
	}
	if len(nodes) > 0 {
		report.Average = total / len(nodes)
	}
	report.Samples = samples
	report.Days = days

	var stableNode, memNode, uptimeNode, coldNode *personalityNode
	for i := range nodes {
		p := &nodes[i]
		if stableNode == nil || p.Stable > stableNode.Stable {
			stableNode = p
		}
		if p.Online && !p.SFTPOnly {
			if memNode == nil || p.MemAvg > memNode.MemAvg {
				memNode = p
			}
			if uptimeNode == nil || p.Uptime > uptimeNode.Uptime {
				uptimeNode = p
			}
			if p.Temp > 0 && (coldNode == nil || p.Temp < coldNode.Temp) {
				coldNode = p
			}
		}
	}
	if stableNode != nil {
		report.Top = append(report.Top, personalityHighlight{"最稳", stableNode.Name, fmt.Sprintf("%d 分", stableNode.Stable)})
	}
	if memNode != nil {
		report.Top = append(report.Top, personalityHighlight{"最能吃内存", memNode.Name, fmt.Sprintf("%.0f%%", memNode.MemAvg)})
	}
	if uptimeNode != nil {
		report.Top = append(report.Top, personalityHighlight{"最能扛", uptimeNode.Name, uptimeNode.UptimeText})
	}
	if coldNode != nil {
		report.Top = append(report.Top, personalityHighlight{"最冷静", coldNode.Name, fmt.Sprintf("%.0f°C", coldNode.Temp)})
	}
	writeJSON(w, http.StatusOK, report)
}
