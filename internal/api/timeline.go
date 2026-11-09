package api

import (
	"net/http"
	"sort"
	"strconv"
	"time"

	"kaypanel/internal/metrics"
)

type trendPoint struct {
	Time int64   `json:"t"`
	CPU  float64 `json:"cpu"`
	Mem  float64 `json:"mem"`
	Disk float64 `json:"disk"`
}

type eventView struct {
	NodeID   string  `json:"node_id"`
	NodeName string  `json:"node_name"`
	Time     int64   `json:"time"`
	Level    string  `json:"level"`
	Title    string  `json:"title"`
	Detail   string  `json:"detail,omitempty"`
	CPU      float64 `json:"cpu"`
	MemPct   float64 `json:"mem_pct"`
	DiskPct  float64 `json:"disk_pct"`
	Load1    float64 `json:"load1"`
	Temp     float64 `json:"temp"`
	DockerRunning int `json:"docker_running"`
	DockerTotal   int `json:"docker_total"`
}

type timelineNode struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Online   bool   `json:"online"`
	SFTPOnly bool   `json:"sftp_only"`
	Events   int    `json:"events"`
	Warnings int    `json:"warnings"`
	Offlines int    `json:"offlines"`
}

type timelineReport struct {
	Time    int64            `json:"time"`
	Version string           `json:"version"`
	Nodes   []timelineNode   `json:"nodes"`
	Events  []eventView      `json:"events"`
	Trends  map[string][]trendPoint `json:"trends"`
}

func downsampleTrend(in []metrics.Snapshot, max int) []trendPoint {
	if len(in) == 0 {
		return []trendPoint{}
	}
	step := 1
	if len(in) > max {
		step = (len(in) + max - 1) / max
	}
	out := make([]trendPoint, 0, (len(in)+step-1)/step)
	for i := 0; i < len(in); i += step {
		s := in[i]
		out = append(out, trendPoint{
			Time: s.Time,
			CPU:  s.CPU,
			Mem:  apiPct(s.MemUsed, s.MemTotal),
			Disk: apiPct(s.DiskUsed, s.DiskTotal),
		})
	}
	if last := in[len(in)-1]; len(out) == 0 || out[len(out)-1].Time != last.Time {
		out = append(out, trendPoint{
			Time: last.Time,
			CPU:  last.CPU,
			Mem:  apiPct(last.MemUsed, last.MemTotal),
			Disk: apiPct(last.DiskUsed, last.DiskTotal),
		})
	}
	return out
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	limit := 200
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	views := s.mgr.Views()
	report := timelineReport{
		Time:    time.Now().Unix(),
		Version: s.version,
		Nodes:   make([]timelineNode, 0, len(views)),
		Events:  make([]eventView, 0, len(views)*4),
		Trends:  map[string][]trendPoint{},
	}
	for _, v := range views {
		n, ok := s.mgr.Get(v.ID)
		if !ok {
			continue
		}
		events := n.Events()
		tn := timelineNode{ID: v.ID, Name: v.Name, Online: v.Online, SFTPOnly: v.SFTPOnly, Events: len(events)}
		for _, e := range events {
			if e.Level == "warn" {
				tn.Warnings++
			}
			if e.Title == "节点离线" {
				tn.Offlines++
			}
			report.Events = append(report.Events, eventView{
				NodeID:        v.ID,
				NodeName:      v.Name,
				Time:          e.Time,
				Level:         e.Level,
				Title:         e.Title,
				Detail:        e.Detail,
				CPU:           e.Snapshot.CPU,
				MemPct:        apiPct(e.Snapshot.MemUsed, e.Snapshot.MemTotal),
				DiskPct:       apiPct(e.Snapshot.DiskUsed, e.Snapshot.DiskTotal),
				Load1:         e.Snapshot.Load1,
				Temp:          e.Snapshot.Temp,
				DockerRunning: e.Snapshot.DockerRunning,
				DockerTotal:   e.Snapshot.DockerTotal,
			})
		}
		trend := n.Trend()
		if len(trend) < 2 {
			trend = v.History
		}
		report.Trends[v.ID] = downsampleTrend(trend, 240)
		report.Nodes = append(report.Nodes, tn)
	}
	sort.SliceStable(report.Events, func(i, j int) bool {
		return report.Events[i].Time > report.Events[j].Time
	})
	if len(report.Events) > limit {
		report.Events = report.Events[:limit]
	}
	writeJSON(w, http.StatusOK, report)
}
