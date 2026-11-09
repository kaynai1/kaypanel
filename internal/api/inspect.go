package api

import (
	"fmt"
	"net/http"
	"time"

	"kaypanel/internal/node"
)

type inspectNode struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Addr          string   `json:"addr"`
	User          string   `json:"user"`
	SFTPOnly      bool     `json:"sftp_only"`
	Online        bool     `json:"online"`
	Score         int      `json:"score"`
	Grade         string   `json:"grade"`
	Issues        []string `json:"issues"`
	Hostname      string   `json:"hostname,omitempty"`
	OS            string   `json:"os,omitempty"`
	CPU           float64  `json:"cpu"`
	Cores         int      `json:"cores"`
	MemPct        float64  `json:"mem_pct"`
	MemUsed       uint64   `json:"mem_used"`
	MemTotal      uint64   `json:"mem_total"`
	DiskPct       float64  `json:"disk_pct"`
	DiskUsed      uint64   `json:"disk_used"`
	DiskTotal     uint64   `json:"disk_total"`
	Load1         float64  `json:"load1"`
	Load5         float64  `json:"load5"`
	Load15        float64  `json:"load15"`
	Uptime        float64  `json:"uptime"`
	Temp          float64  `json:"temp"`
	DockerRunning int      `json:"docker_running"`
	DockerTotal   int      `json:"docker_total"`
}

type inspectReport struct {
	Time    int64          `json:"time"`
	Version string         `json:"version"`
	Average int            `json:"average"`
	Grade   string         `json:"grade"`
	Total   int            `json:"total"`
	Online  int            `json:"online"`
	Counts  map[string]int `json:"counts"`
	Nodes   []inspectNode  `json:"nodes"`
}

func gradeOf(score int) string {
	switch {
	case score >= 90:
		return "优秀"
	case score >= 75:
		return "良好"
	case score >= 60:
		return "一般"
	default:
		return "需关注"
	}
}

func inspectScore(v node.View) inspectNode {
	it := inspectNode{
		ID:       v.ID,
		Name:     v.Name,
		Addr:     v.Addr,
		User:     v.User,
		SFTPOnly: v.SFTPOnly,
		Online:   v.Online,
		Issues:   []string{},
	}
	if v.SFTPOnly {
		if v.Online {
			it.Score, it.Grade = 100, "在线"
		} else {
			it.Grade = "离线"
			it.Issues = append(it.Issues, "SFTP 连接失败")
			if msg := trimIssue(v.Error); msg != "" {
				it.Issues = append(it.Issues, msg)
			}
		}
		return it
	}
	if !v.Online {
		it.Grade = "离线"
		it.Issues = append(it.Issues, "节点离线")
		if msg := trimIssue(v.Error); msg != "" {
			it.Issues = append(it.Issues, msg)
		}
		return it
	}

	m := v.Latest
	it.Hostname = m.Hostname
	it.OS = m.OS
	it.CPU = m.CPU
	it.Cores = m.Cores
	it.MemUsed, it.MemTotal = m.MemUsed, m.MemTotal
	it.DiskUsed, it.DiskTotal = m.DiskUsed, m.DiskTotal
	it.Load1, it.Load5, it.Load15 = m.Load1, m.Load5, m.Load15
	it.Uptime = m.Uptime
	it.Temp = m.Temp
	it.DockerRunning, it.DockerTotal = m.DockerRunning, m.DockerTotal
	if m.MemTotal > 0 {
		it.MemPct = float64(m.MemUsed) / float64(m.MemTotal) * 100
	}
	if m.DiskTotal > 0 {
		it.DiskPct = float64(m.DiskUsed) / float64(m.DiskTotal) * 100
	}

	score := 100
	deduct := func(points int, issue string) {
		score -= points
		it.Issues = append(it.Issues, issue)
	}
	switch {
	case m.CPU >= 95:
		deduct(25, fmt.Sprintf("CPU %.1f%%", m.CPU))
	case m.CPU >= 85:
		deduct(15, fmt.Sprintf("CPU %.1f%%", m.CPU))
	case m.CPU >= 70:
		deduct(8, fmt.Sprintf("CPU %.1f%%", m.CPU))
	}
	switch {
	case it.MemPct >= 95:
		deduct(25, fmt.Sprintf("内存 %.1f%%", it.MemPct))
	case it.MemPct >= 85:
		deduct(15, fmt.Sprintf("内存 %.1f%%", it.MemPct))
	case it.MemPct >= 70:
		deduct(8, fmt.Sprintf("内存 %.1f%%", it.MemPct))
	}
	switch {
	case it.DiskPct >= 95:
		deduct(30, fmt.Sprintf("磁盘 %.1f%%", it.DiskPct))
	case it.DiskPct >= 90:
		deduct(20, fmt.Sprintf("磁盘 %.1f%%", it.DiskPct))
	case it.DiskPct >= 80:
		deduct(10, fmt.Sprintf("磁盘 %.1f%%", it.DiskPct))
	}
	if m.Cores > 0 {
		ratio := m.Load1 / float64(m.Cores)
		switch {
		case ratio >= 2:
			deduct(15, fmt.Sprintf("负载 %.2f（%d 核）", m.Load1, m.Cores))
		case ratio >= 1.2:
			deduct(8, fmt.Sprintf("负载 %.2f（%d 核）", m.Load1, m.Cores))
		case ratio >= 0.8:
			deduct(3, fmt.Sprintf("负载 %.2f（%d 核）", m.Load1, m.Cores))
		}
	}
	switch {
	case m.Temp >= 85:
		deduct(12, fmt.Sprintf("温度 %.0f°C", m.Temp))
	case m.Temp >= 75:
		deduct(6, fmt.Sprintf("温度 %.0f°C", m.Temp))
	}
	if m.DockerTotal > 0 {
		if stopped := m.DockerTotal - m.DockerRunning; stopped > 0 {
			p := stopped * 2
			if p > 8 {
				p = 8
			}
			deduct(p, fmt.Sprintf("%d 个容器未运行（共 %d 个）", stopped, m.DockerTotal))
		}
	}
	if m.SwapTotal > 0 {
		if p := float64(m.SwapUsed) / float64(m.SwapTotal) * 100; p >= 50 {
			deduct(5, fmt.Sprintf("交换分区 %.0f%%", p))
		}
	}
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
	if peakCPU >= 95 && m.CPU < 85 {
		deduct(5, fmt.Sprintf("近期 CPU 峰值 %.0f%%", peakCPU))
	}
	if peakMem >= 95 && it.MemPct < 85 {
		deduct(5, fmt.Sprintf("近期内存峰值 %.0f%%", peakMem))
	}
	if score < 0 {
		score = 0
	}
	it.Score = score
	it.Grade = gradeOf(score)
	return it
}

func trimIssue(s string) string {
	r := []rune(s)
	if len(r) > 60 {
		return string(r[:60]) + "…"
	}
	return s
}

func (s *Server) handleInspect(w http.ResponseWriter, r *http.Request) {
	views := s.mgr.Views()
	report := inspectReport{
		Time:    time.Now().Unix(),
		Version: s.version,
		Total:   len(views),
		Counts:  map[string]int{},
		Nodes:   make([]inspectNode, 0, len(views)),
	}
	total := 0
	for _, v := range views {
		it := inspectScore(v)
		if v.Online {
			report.Online++
		}
		report.Counts[it.Grade]++
		total += it.Score
		report.Nodes = append(report.Nodes, it)
	}
	if len(views) > 0 {
		report.Average = total / len(views)
		report.Grade = gradeOf(report.Average)
	} else {
		report.Grade = "—"
	}
	writeJSON(w, http.StatusOK, report)
}
