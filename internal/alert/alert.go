package alert

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"kaypanel/internal/config"
	"kaypanel/internal/node"
	"kaypanel/internal/notify"
)

type Engine struct {
	store *config.Store
	mgr   *node.Manager

	mu        sync.Mutex
	active    map[string]map[string]bool
	lastDaily string
}

func New(store *config.Store, mgr *node.Manager) *Engine {
	return &Engine{store: store, mgr: mgr, active: map[string]map[string]bool{}}
}

func (e *Engine) Start(ctx context.Context) {
	go e.loop(ctx)
}

func (e *Engine) loop(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	e.tick(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			e.tick(ctx)
		}
	}
}

type metric struct {
	kind  string
	label string
	value float64
	limit int
}

func nodeMetrics(v node.View, set config.Settings) []metric {
	if !v.Online || v.SFTPOnly {
		return nil
	}
	out := []metric{{kind: "cpu", label: "CPU", value: v.Latest.CPU, limit: set.CPUAlert}}
	if v.Latest.MemTotal > 0 {
		out = append(out, metric{kind: "mem", label: "内存", value: float64(v.Latest.MemUsed) / float64(v.Latest.MemTotal) * 100, limit: set.MemAlert})
	}
	if v.Latest.DiskTotal > 0 {
		out = append(out, metric{kind: "disk", label: "磁盘", value: float64(v.Latest.DiskUsed) / float64(v.Latest.DiskTotal) * 100, limit: set.DiskAlert})
	}
	return out
}

func (e *Engine) tick(ctx context.Context) {
	set := e.store.Settings()
	e.checkDaily(ctx, set)
	if strings.TrimSpace(set.Webhook) == "" {
		return
	}
	views := e.mgr.Views()
	var lines []string
	e.mu.Lock()
	for _, v := range views {
		cur := map[string]bool{}
		prev := e.active[v.ID]
		for _, m := range nodeMetrics(v, set) {
			bad := m.limit > 0 && m.value >= float64(m.limit)
			if bad {
				cur[m.kind] = true
			}
			was := prev != nil && prev[m.kind]
			switch {
			case bad && !was:
				lines = append(lines, fmt.Sprintf("[告警] %s %s %.1f%%（阈值 %d%%）", v.Name, m.label, m.value, m.limit))
			case !bad && was:
				lines = append(lines, fmt.Sprintf("[恢复] %s %s 已恢复至 %.1f%%", v.Name, m.label, m.value))
			}
		}
		if !v.Online && !v.SFTPOnly {
			cur["offline"] = true
			if prev != nil && !prev["offline"] {
				lines = append(lines, fmt.Sprintf("[离线] %s 连接中断：%s", v.Name, v.Error))
			}
		}
		e.active[v.ID] = cur
	}
	e.mu.Unlock()
	if len(lines) == 0 {
		return
	}
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	_ = notify.Send(cctx, set.Webhook, "KayPanel 告警 · "+time.Now().Format("01-02 15:04"), strings.Join(lines, "\n"))
}

func (e *Engine) checkDaily(ctx context.Context, set config.Settings) {
	if !set.DailyReport || strings.TrimSpace(set.Webhook) == "" {
		return
	}
	now := time.Now()
	hour := set.DailyHour
	if hour < 0 || hour > 23 {
		hour = 8
	}
	if now.Hour() != hour {
		return
	}
	day := now.Format("2006-01-02")
	e.mu.Lock()
	if e.lastDaily == day {
		e.mu.Unlock()
		return
	}
	e.lastDaily = day
	e.mu.Unlock()

	views := e.mgr.Views()
	var lines []string
	online, total := 0, 0
	for _, v := range views {
		if v.SFTPOnly {
			continue
		}
		total++
		if !v.Online {
			lines = append(lines, fmt.Sprintf("- %s：离线", v.Name))
			continue
		}
		online++
		peakCPU, peakMem := 0.0, 0.0
		for _, s := range v.History {
			if s.CPU > peakCPU {
				peakCPU = s.CPU
			}
			if s.MemTotal > 0 {
				if p := float64(s.MemUsed) / float64(s.MemTotal) * 100; p > peakMem {
					peakMem = p
				}
			}
		}
		disk := 0.0
		if v.Latest.DiskTotal > 0 {
			disk = float64(v.Latest.DiskUsed) / float64(v.Latest.DiskTotal) * 100
		}
		part := fmt.Sprintf("- %s：CPU 峰值 %.1f%%，内存峰值 %.1f%%，磁盘 %.1f%%", v.Name, peakCPU, peakMem, disk)
		if v.Latest.DockerTotal > 0 {
			part += fmt.Sprintf("，容器 %d/%d 运行", v.Latest.DockerRunning, v.Latest.DockerTotal)
		}
		lines = append(lines, part)
	}
	title := "KayPanel 每日早报 · " + now.Format("01-02")
	body := fmt.Sprintf("在线 %d/%d 台\n%s", online, total, strings.Join(lines, "\n"))
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	_ = notify.Send(cctx, set.Webhook, title, body)
}
