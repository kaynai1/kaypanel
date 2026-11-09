package node

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"kaypanel/internal/metrics"
)

type historyFile struct {
	SavedAt int64                         `json:"saved_at"`
	Nodes   map[string][]metrics.Snapshot `json:"nodes"`
	Trends  map[string][]metrics.Snapshot `json:"trends,omitempty"`
	Events  map[string][]Event            `json:"events,omitempty"`
}

func (m *Manager) historyPath() string {
	return filepath.Join(m.dir, "history.json")
}

func (m *Manager) loadHistory() (map[string][]metrics.Snapshot, map[string][]metrics.Snapshot, map[string][]Event) {
	nodes := map[string][]metrics.Snapshot{}
	trends := map[string][]metrics.Snapshot{}
	events := map[string][]Event{}
	b, err := os.ReadFile(m.historyPath())
	if err != nil {
		return nodes, trends, events
	}
	var f historyFile
	if json.Unmarshal(b, &f) != nil {
		return nodes, trends, events
	}
	now := time.Now()
	cut := now.Add(-12 * time.Hour).Unix()
	cutTrend := now.Add(-7 * 24 * time.Hour).Unix()
	for id, list := range f.Nodes {
		kept := make([]metrics.Snapshot, 0, len(list))
		for _, s := range list {
			if s.Time >= cut {
				kept = append(kept, s)
			}
		}
		nodes[id] = capHistory(kept)
	}
	for id, list := range f.Trends {
		kept := make([]metrics.Snapshot, 0, len(list))
		for _, s := range list {
			if s.Time >= cutTrend {
				kept = append(kept, s)
			}
		}
		trends[id] = capTrend(kept)
	}
	for id, list := range f.Events {
		kept := make([]Event, 0, len(list))
		for _, e := range list {
			if e.Time >= cutTrend {
				kept = append(kept, e)
			}
		}
		events[id] = capEvents(kept)
	}
	return nodes, trends, events
}

func (m *Manager) saveHistory() {
	if m.dir == "" {
		return
	}
	f := historyFile{
		SavedAt: time.Now().Unix(),
		Nodes:   map[string][]metrics.Snapshot{},
		Trends:  map[string][]metrics.Snapshot{},
		Events:  map[string][]Event{},
	}
	m.mu.RLock()
	ids := append([]string(nil), m.order...)
	m.mu.RUnlock()
	for _, id := range ids {
		if n, ok := m.Get(id); ok {
			if h := n.historyCopy(); len(h) > 0 {
				f.Nodes[id] = h
			}
			if t := n.trendCopy(); len(t) > 0 {
				f.Trends[id] = t
			}
			if e := n.eventsCopy(); len(e) > 0 {
				f.Events[id] = e
			}
		}
	}
	b, err := json.Marshal(&f)
	if err != nil {
		return
	}
	if err := os.MkdirAll(m.dir, 0o700); err != nil {
		return
	}
	tmp := m.historyPath() + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, m.historyPath())
	}
}

func (m *Manager) historyLoop(ctx context.Context) {
	t := time.NewTicker(60 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.saveHistory()
		}
	}
}

func capHistory(in []metrics.Snapshot) []metrics.Snapshot {
	if len(in) <= 120 {
		return append([]metrics.Snapshot(nil), in...)
	}
	return append([]metrics.Snapshot(nil), in[len(in)-120:]...)
}

func capTrend(in []metrics.Snapshot) []metrics.Snapshot {
	if len(in) <= 2016 {
		return append([]metrics.Snapshot(nil), in...)
	}
	return append([]metrics.Snapshot(nil), in[len(in)-2016:]...)
}

func capEvents(in []Event) []Event {
	if len(in) <= 200 {
		return append([]Event(nil), in...)
	}
	return append([]Event(nil), in[len(in)-200:]...)
}

func (n *Node) historyCopy() []metrics.Snapshot {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return append([]metrics.Snapshot(nil), n.hist...)
}

func (n *Node) trendCopy() []metrics.Snapshot {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return append([]metrics.Snapshot(nil), n.trend...)
}

func (n *Node) eventsCopy() []Event {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return append([]Event(nil), n.events...)
}
