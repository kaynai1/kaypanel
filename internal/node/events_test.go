package node

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"kaypanel/internal/config"
	"kaypanel/internal/metrics"
)

func newTestNode() *Node {
	return &Node{lastEvent: map[string]time.Time{}}
}

func TestDetectFirstSampleOnline(t *testing.T) {
	n := newTestNode()
	snap := metrics.Snapshot{Time: time.Now().Unix(), CPU: 10, MemUsed: 20, MemTotal: 100, DiskUsed: 10, DiskTotal: 100}
	n.detectEventsLocked(metrics.Snapshot{}, false, snap, config.Settings{})
	if len(n.events) != 1 || n.events[0].Title != "节点上线" || n.events[0].Level != "info" {
		t.Fatalf("unexpected events: %+v", n.events)
	}
}

func TestDetectRecovery(t *testing.T) {
	n := newTestNode()
	n.events = append(n.events, Event{Title: "节点离线", Level: "error"})
	snap := metrics.Snapshot{Time: time.Now().Unix(), CPU: 10}
	n.detectEventsLocked(metrics.Snapshot{}, false, snap, config.Settings{})
	if len(n.events) != 2 || n.events[1].Title != "节点恢复在线" {
		t.Fatalf("unexpected events: %+v", n.events)
	}
}

func TestDetectThresholdCrossings(t *testing.T) {
	n := newTestNode()
	prev := metrics.Snapshot{CPU: 40, MemUsed: 40, MemTotal: 100, DiskUsed: 40, DiskTotal: 100, Temp: 60}
	snap := metrics.Snapshot{
		Time: time.Now().Unix(), CPU: 95, MemUsed: 95, MemTotal: 100,
		DiskUsed: 95, DiskTotal: 100, Temp: 90,
		DockerTotal: 3, DockerRunning: 1,
	}
	set := config.Settings{CPUAlert: 90, MemAlert: 90, DiskAlert: 90}
	n.detectEventsLocked(prev, true, snap, set)
	titles := map[string]bool{}
	for _, e := range n.events {
		titles[e.Title] = true
	}
	for _, want := range []string{"CPU 冲高", "内存吃紧", "磁盘告急", "温度过高", "容器退出"} {
		if !titles[want] {
			t.Fatalf("missing event %q in %+v", want, titles)
		}
	}
}

func TestThresholdNoCrossNoEvent(t *testing.T) {
	n := newTestNode()
	prev := metrics.Snapshot{CPU: 95, MemUsed: 95, MemTotal: 100, DiskUsed: 95, DiskTotal: 100}
	snap := metrics.Snapshot{Time: time.Now().Unix(), CPU: 96, MemUsed: 96, MemTotal: 100, DiskUsed: 96, DiskTotal: 100}
	n.detectEventsLocked(prev, true, snap, config.Settings{})
	if len(n.events) != 0 {
		t.Fatalf("expected no events, got %+v", n.events)
	}
}

func TestThresholdCooldown(t *testing.T) {
	n := newTestNode()
	prev := metrics.Snapshot{CPU: 40}
	snap := metrics.Snapshot{Time: time.Now().Unix(), CPU: 95}
	n.detectEventsLocked(prev, true, snap, config.Settings{})
	n.detectEventsLocked(prev, true, snap, config.Settings{})
	if len(n.events) != 1 {
		t.Fatalf("cooldown failed: %+v", n.events)
	}
}

func TestAlertThresholdDefault(t *testing.T) {
	if alertThreshold(0) != 90 || alertThreshold(101) != 90 || alertThreshold(75) != 75 {
		t.Fatalf("unexpected threshold mapping")
	}
}

func TestOfflineEvent(t *testing.T) {
	n := newTestNode()
	n.online = true
	n.latest = metrics.Snapshot{Time: time.Now().Unix(), CPU: 30}
	n.setOffline(os.ErrDeadlineExceeded)
	if len(n.events) != 1 || n.events[0].Title != "节点离线" || n.events[0].Level != "error" {
		t.Fatalf("unexpected offline events: %+v", n.events)
	}
	n.setOffline(os.ErrDeadlineExceeded)
	if len(n.events) != 1 {
		t.Fatalf("duplicate offline events: %+v", n.events)
	}
}

func TestAppendTrendCadence(t *testing.T) {
	n := newTestNode()
	base := time.Now()
	n.appendTrendLocked(metrics.Snapshot{Time: base.Unix(), CPU: 1})
	n.appendTrendLocked(metrics.Snapshot{Time: base.Add(time.Minute).Unix(), CPU: 2})
	if len(n.trend) != 1 {
		t.Fatalf("trend should keep 5-min cadence: %+v", n.trend)
	}
	n.appendTrendLocked(metrics.Snapshot{Time: base.Add(6 * time.Minute).Unix(), CPU: 3})
	if len(n.trend) != 2 || n.trend[1].CPU != 3 {
		t.Fatalf("trend not appended after 6min: %+v", n.trend)
	}
}

func TestEventCap(t *testing.T) {
	n := newTestNode()
	for i := 0; i < 250; i++ {
		n.eventLocked("info", "e", "", metrics.Snapshot{}, 0)
	}
	if len(n.events) != 200 {
		t.Fatalf("event cap failed: %d", len(n.events))
	}
}

func TestHistoryRoundTrip(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().Truncate(time.Second)
	write := historyFile{
		SavedAt: now.Unix(),
		Nodes: map[string][]metrics.Snapshot{
			"n1": {{Time: now.Unix(), CPU: 12}},
		},
		Trends: map[string][]metrics.Snapshot{
			"n1": {{Time: now.Unix(), CPU: 12}, {Time: now.Add(-8 * 24 * time.Hour).Unix(), CPU: 1}},
		},
		Events: map[string][]Event{
			"n1": {{Time: now.Unix(), Level: "warn", Title: "CPU 冲高"}, {Time: now.Add(-8 * 24 * time.Hour).Unix(), Title: "旧事件"}},
		},
	}
	b, err := json.Marshal(write)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "history.json")
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatal(err)
	}
	m := &Manager{dir: dir}
	nodes, trends, events := m.loadHistory()
	if len(nodes["n1"]) != 1 || len(trends["n1"]) != 1 || len(events["n1"]) != 1 {
		t.Fatalf("pruning failed: %d %d %d", len(nodes["n1"]), len(trends["n1"]), len(events["n1"]))
	}
	if events["n1"][0].Title != "CPU 冲高" {
		t.Fatalf("unexpected event: %+v", events["n1"][0])
	}
}
