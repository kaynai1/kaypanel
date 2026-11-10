package changes

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Item struct {
	ID         string `json:"id"`
	Time       int64  `json:"time"`
	NodeID     string `json:"node_id"`
	NodeName   string `json:"node_name"`
	Kind       string `json:"kind"`
	Target     string `json:"target"`
	Summary    string `json:"summary"`
	BeforeSize int    `json:"before_size"`
	AfterSize  int    `json:"after_size"`
	Restorable bool   `json:"restorable"`
	RolledBack bool   `json:"rolled_back"`
}

type meta struct {
	Items []Item `json:"items"`
}

type Manager struct {
	mu    sync.Mutex
	dir   string
	path  string
	items []Item
}

func New(dir string) *Manager {
	m := &Manager{dir: filepath.Join(dir, "changes"), path: filepath.Join(dir, "changes", "meta.json")}
	m.load()
	return m
}

func (m *Manager) load() {
	b, err := os.ReadFile(m.path)
	if err != nil {
		return
	}
	var f meta
	if json.Unmarshal(b, &f) == nil {
		m.items = f.Items
	}
}

func (m *Manager) saveLocked() {
	b, err := json.Marshal(&meta{Items: m.items})
	if err != nil {
		return
	}
	_ = os.MkdirAll(m.dir, 0o700)
	tmp := m.path + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, m.path)
	}
}

func newID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().String()))
	}
	return hex.EncodeToString(b)
}

func (m *Manager) Add(kind, nodeID, nodeName, target, summary, before, after string) (Item, bool) {
	if before == after {
		return Item{}, false
	}
	it := Item{
		ID:         newID(),
		Time:       time.Now().Unix(),
		NodeID:     nodeID,
		NodeName:   nodeName,
		Kind:       kind,
		Target:     target,
		Summary:    summary,
		BeforeSize: len(before),
		AfterSize:  len(after),
		Restorable: before != "",
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	_ = os.MkdirAll(m.dir, 0o700)
	if before != "" {
		_ = os.WriteFile(filepath.Join(m.dir, it.ID+"-before.txt"), []byte(before), 0o600)
	}
	_ = os.WriteFile(filepath.Join(m.dir, it.ID+"-after.txt"), []byte(after), 0o600)
	m.items = append([]Item{it}, m.items...)
	if len(m.items) > 80 {
		for _, old := range m.items[80:] {
			_ = os.Remove(filepath.Join(m.dir, old.ID+"-before.txt"))
			_ = os.Remove(filepath.Join(m.dir, old.ID+"-after.txt"))
		}
		m.items = m.items[:80]
	}
	m.saveLocked()
	return it, true
}

func (m *Manager) List() []Item {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Item, len(m.items))
	copy(out, m.items)
	return out
}

func (m *Manager) Get(id string) (Item, string, string, bool) {
	m.mu.Lock()
	var it Item
	found := false
	for _, v := range m.items {
		if v.ID == id {
			it = v
			found = true
			break
		}
	}
	m.mu.Unlock()
	if !found {
		return Item{}, "", "", false
	}
	before, _ := os.ReadFile(filepath.Join(m.dir, id+"-before.txt"))
	after, _ := os.ReadFile(filepath.Join(m.dir, id+"-after.txt"))
	return it, string(before), string(after), true
}

func (m *Manager) MarkRolledBack(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.items {
		if m.items[i].ID == id {
			m.items[i].RolledBack = true
			m.saveLocked()
			return
		}
	}
}
