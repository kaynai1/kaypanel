package probe

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Target struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	URL       string `json:"url"`
	Interval  int    `json:"interval"`
	CreatedAt int64  `json:"created_at"`
}

type Check struct {
	Time    int64  `json:"time"`
	OK      bool   `json:"ok"`
	Latency int64  `json:"latency_ms"`
	Code    int    `json:"code,omitempty"`
	Error   string `json:"error,omitempty"`
}

type State struct {
	Target
	Up      bool    `json:"up"`
	Latency int64   `json:"latency_ms"`
	Uptime  float64 `json:"uptime"`
	Checks  []Check `json:"checks"`
}

type fileData struct {
	Targets []Target           `json:"targets"`
	Checks  map[string][]Check `json:"checks"`
}

type Manager struct {
	mu       sync.Mutex
	path     string
	targets  []Target
	checks   map[string][]Check
	next     map[string]time.Time
	inFlight map[string]bool
}

func New(dir string) *Manager {
	m := &Manager{
		path:     filepath.Join(dir, "probes.json"),
		checks:   map[string][]Check{},
		next:     map[string]time.Time{},
		inFlight: map[string]bool{},
	}
	m.load()
	return m
}

func (m *Manager) load() {
	b, err := os.ReadFile(m.path)
	if err != nil {
		return
	}
	var f fileData
	if json.Unmarshal(b, &f) != nil {
		return
	}
	cut := time.Now().Add(-7 * 24 * time.Hour).Unix()
	m.targets = f.Targets
	for id, list := range f.Checks {
		var kept []Check
		for _, c := range list {
			if c.Time >= cut {
				kept = append(kept, c)
			}
		}
		if len(kept) > 120 {
			kept = kept[len(kept)-120:]
		}
		m.checks[id] = kept
	}
}

func (m *Manager) saveLocked() {
	f := fileData{Targets: m.targets, Checks: m.checks}
	b, err := json.Marshal(&f)
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(m.path), 0o700); err != nil {
		return
	}
	tmp := m.path + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, m.path)
	}
}

func (m *Manager) Start(ctx context.Context) {
	go m.loop(ctx)
}

func (m *Manager) loop(ctx context.Context) {
	m.runDue()
	t := time.NewTicker(10 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.runDue()
		}
	}
}

func (m *Manager) runDue() {
	now := time.Now()
	var due []Target
	m.mu.Lock()
	for _, t := range m.targets {
		if m.inFlight[t.ID] {
			continue
		}
		if next, ok := m.next[t.ID]; ok && now.Before(next) {
			continue
		}
		due = append(due, t)
	}
	m.mu.Unlock()
	for _, t := range due {
		t := t
		go m.checkTarget(t, true)
	}
}

func (m *Manager) checkTarget(t Target, record bool) Check {
	m.mu.Lock()
	if m.inFlight[t.ID] && record {
		m.mu.Unlock()
		return Check{}
	}
	m.inFlight[t.ID] = true
	m.mu.Unlock()
	c := runCheck(t)
	m.mu.Lock()
	delete(m.inFlight, t.ID)
	m.next[t.ID] = time.Now().Add(time.Duration(t.Interval) * time.Second)
	if record {
		m.appendLocked(t.ID, c)
		m.saveLocked()
	}
	m.mu.Unlock()
	return c
}

func (m *Manager) appendLocked(id string, c Check) {
	list := append(m.checks[id], c)
	if len(list) > 120 {
		list = list[len(list)-120:]
	}
	m.checks[id] = list
}

func runCheck(t Target) Check {
	start := time.Now()
	c := Check{Time: start.Unix()}
	switch t.Type {
	case "tcp":
		conn, err := net.DialTimeout("tcp", t.URL, 8*time.Second)
		c.Latency = time.Since(start).Milliseconds()
		if err != nil {
			c.Error = trimErr(err.Error())
			return c
		}
		c.OK = true
		_ = conn.Close()
	default:
		client := &http.Client{Timeout: 10 * time.Second}
		req, err := http.NewRequest(http.MethodGet, t.URL, nil)
		if err != nil {
			c.Error = trimErr(err.Error())
			return c
		}
		req.Header.Set("User-Agent", "KayPanel-Probe/1.0")
		resp, err := client.Do(req)
		c.Latency = time.Since(start).Milliseconds()
		if err != nil {
			c.Error = trimErr(err.Error())
			return c
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 128<<10))
		_ = resp.Body.Close()
		c.Code = resp.StatusCode
		c.OK = resp.StatusCode >= 200 && resp.StatusCode < 400
		if !c.OK {
			c.Error = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
	}
	return c
}

func trimErr(s string) string {
	r := []rune(s)
	if len(r) > 120 {
		return string(r[:120]) + "…"
	}
	return s
}

func Normalize(t Target) (Target, error) {
	t.Name = strings.TrimSpace(t.Name)
	t.URL = strings.TrimSpace(t.URL)
	if t.Type != "tcp" {
		t.Type = "http"
	}
	if t.Name == "" {
		t.Name = t.URL
	}
	if r := []rune(t.Name); len(r) == 0 || len(r) > 40 {
		return t, fmt.Errorf("名称需为 1-40 个字符")
	}
	if t.URL == "" || len(t.URL) > 500 {
		return t, fmt.Errorf("请填写监控地址")
	}
	if t.Type == "http" {
		if !strings.HasPrefix(t.URL, "http://") && !strings.HasPrefix(t.URL, "https://") {
			return t, fmt.Errorf("HTTP 地址需以 http:// 或 https:// 开头")
		}
	} else {
		if _, _, err := net.SplitHostPort(t.URL); err != nil {
			return t, fmt.Errorf("TCP 地址格式应为 主机:端口")
		}
	}
	if t.Interval < 30 {
		t.Interval = 60
	}
	if t.Interval > 3600 {
		t.Interval = 3600
	}
	return t, nil
}

func (m *Manager) Add(t Target) (Target, error) {
	t, err := Normalize(t)
	if err != nil {
		return t, err
	}
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		return t, fmt.Errorf("生成标识失败")
	}
	t.ID = hex.EncodeToString(b)
	t.CreatedAt = time.Now().Unix()
	m.mu.Lock()
	if len(m.targets) >= 30 {
		m.mu.Unlock()
		return t, fmt.Errorf("最多添加 30 个拨测目标")
	}
	m.targets = append(m.targets, t)
	m.next[t.ID] = time.Time{}
	m.saveLocked()
	m.mu.Unlock()
	go m.checkTarget(t, true)
	return t, nil
}

func (m *Manager) Remove(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	idx := -1
	for i, t := range m.targets {
		if t.ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return false
	}
	m.targets = append(m.targets[:idx], m.targets[idx+1:]...)
	delete(m.checks, id)
	delete(m.next, id)
	m.saveLocked()
	return true
}

func (m *Manager) CheckNow(id string) (Check, bool) {
	m.mu.Lock()
	var target Target
	found := false
	for _, t := range m.targets {
		if t.ID == id {
			target = t
			found = true
			break
		}
	}
	m.mu.Unlock()
	if !found {
		return Check{}, false
	}
	return m.checkTarget(target, true), true
}

func uptimeOf(list []Check) float64 {
	cut := time.Now().Add(-24 * time.Hour).Unix()
	ok, total := 0, 0
	for _, c := range list {
		if c.Time < cut {
			continue
		}
		total++
		if c.OK {
			ok++
		}
	}
	if total == 0 {
		return 0
	}
	return float64(ok) / float64(total) * 100
}

func (m *Manager) States() []State {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]State, 0, len(m.targets))
	for _, t := range m.targets {
		list := append([]Check(nil), m.checks[t.ID]...)
		st := State{Target: t, Checks: list, Uptime: uptimeOf(list)}
		if len(list) > 0 {
			last := list[len(list)-1]
			st.Up = last.OK
			st.Latency = last.Latency
		}
		out = append(out, st)
	}
	return out
}

func (m *Manager) Get(id string) (State, bool) {
	for _, st := range m.States() {
		if st.ID == id {
			return st, true
		}
	}
	return State{}, false
}

func SortedStates(list []State) []State {
	sort.SliceStable(list, func(i, j int) bool { return list[i].CreatedAt < list[j].CreatedAt })
	return list
}
