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
}

func (m *Manager) historyPath() string {
	return filepath.Join(m.dir, "history.json")
}

func (m *Manager) loadHistory() map[string][]metrics.Snapshot {
	out := map[string][]metrics.Snapshot{}
	b, err := os.ReadFile(m.historyPath())
	if err != nil {
		return out
	}
	var f historyFile
	if json.Unmarshal(b, &f) != nil {
		return out
	}
	cut := time.Now().Add(-12 * time.Hour).Unix()
	for id, list := range f.Nodes {
		kept := make([]metrics.Snapshot, 0, len(list))
		for _, s := range list {
			if s.Time >= cut {
				kept = append(kept, s)
			}
		}
		out[id] = capHistory(kept)
	}
	return out
}

func (m *Manager) saveHistory() {
	if m.dir == "" {
		return
	}
	f := historyFile{SavedAt: time.Now().Unix(), Nodes: map[string][]metrics.Snapshot{}}
	m.mu.RLock()
	ids := append([]string(nil), m.order...)
	m.mu.RUnlock()
	for _, id := range ids {
		if n, ok := m.Get(id); ok {
			if h := n.historyCopy(); len(h) > 0 {
				f.Nodes[id] = h
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

func (n *Node) historyCopy() []metrics.Snapshot {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return append([]metrics.Snapshot(nil), n.hist...)
}
