package api

import (
	"math"
	"testing"
	"time"

	"kaypanel/internal/config"
	"kaypanel/internal/metrics"
	"kaypanel/internal/node"
)

func approx(a, b float64) bool {
	return math.Abs(a-b) < 0.01
}

func TestHumanUptime(t *testing.T) {
	cases := []struct {
		sec  float64
		want string
	}{
		{0, "—"},
		{90, "1 分钟"},
		{3 * 3600, "3 小时 0 分"},
		{2*86400 + 5*3600, "2 天 5 小时"},
	}
	for _, c := range cases {
		if got := humanUptime(c.sec); got != c.want {
			t.Fatalf("humanUptime(%v)=%q want %q", c.sec, got, c.want)
		}
	}
}

func TestApiPct(t *testing.T) {
	if got := apiPct(1, 4); !approx(got, 25) {
		t.Fatalf("apiPct(1,4)=%v", got)
	}
	if got := apiPct(1, 0); got != 0 {
		t.Fatalf("apiPct total 0 = %v", got)
	}
}

func TestAddTagCap(t *testing.T) {
	tags := addTag([]string{}, "a")
	tags = addTag(tags, "a")
	if len(tags) != 1 {
		t.Fatalf("duplicate tag added: %+v", tags)
	}
	tags = addTag(tags, "b")
	tags = addTag(tags, "c")
	tags = addTag(tags, "d")
	tags = addTag(tags, "e")
	if len(tags) != 4 {
		t.Fatalf("tag cap exceeded: %+v", tags)
	}
}

func TestPersonalityOffline(t *testing.T) {
	p := personalityOf(node.View{Online: false}, nil, nil)
	if p.Title != "失联中" || p.Stable != 0 || p.StableText != "等待重连" {
		t.Fatalf("unexpected offline personality: %+v", p)
	}
	if p.Line == "" {
		t.Fatalf("offline line should not be empty")
	}
}

func TestPersonalitySFTPOnly(t *testing.T) {
	p := personalityOf(node.View{Node: config.Node{SFTPOnly: true}, Online: true}, nil, nil)
	if p.Title != "佛系主机" {
		t.Fatalf("unexpected sftp title: %+v", p)
	}
}

func TestPersonalityHighMemory(t *testing.T) {
	v := node.View{
		Online: true,
		Latest: metrics.Snapshot{MemUsed: 90, MemTotal: 100, DiskUsed: 10, DiskTotal: 100, Uptime: 3600},
	}
	trend := []metrics.Snapshot{
		{Time: 1000, CPU: 10, MemUsed: 92, MemTotal: 100, DiskUsed: 10, DiskTotal: 100},
		{Time: 2000, CPU: 12, MemUsed: 92, MemTotal: 100, DiskUsed: 10, DiskTotal: 100},
	}
	p := personalityOf(v, trend, nil)
	if p.Title != "内存饕餮" {
		t.Fatalf("unexpected title: %+v", p)
	}
	if !approx(p.MemAvg, 92) || !approx(p.CPUAvg, 11) {
		t.Fatalf("unexpected averages: %+v", p)
	}
	if len(p.Tags) == 0 {
		t.Fatalf("expected tags")
	}
	if p.Stable != 100 || p.StableText != "稳如老狗" {
		t.Fatalf("unexpected stability: %+v", p)
	}
}

func TestPersonalityLongUptime(t *testing.T) {
	v := node.View{
		Online: true,
		Latest: metrics.Snapshot{CPU: 5, MemUsed: 30, MemTotal: 100, DiskUsed: 60, DiskTotal: 100, Uptime: 40 * 86400},
	}
	trend := []metrics.Snapshot{
		{Time: 1000, CPU: 4, MemUsed: 30, MemTotal: 100, DiskUsed: 60, DiskTotal: 100},
		{Time: 1000 + 1200, CPU: 6, MemUsed: 30, MemTotal: 100, DiskUsed: 60, DiskTotal: 100},
	}
	p := personalityOf(v, trend, nil)
	if p.Title != "老黄牛" {
		t.Fatalf("unexpected title: %+v", p)
	}
	if !approx(p.Days, 1200.0/86400) {
		t.Fatalf("unexpected days: %v", p.Days)
	}
}

func TestPersonalityStabilityDeductions(t *testing.T) {
	events := []node.Event{
		{Level: "error", Title: "节点离线"},
		{Level: "warn", Title: "CPU 冲高"},
		{Level: "warn", Title: "内存吃紧"},
		{Level: "info", Title: "节点上线"},
	}
	v := node.View{Online: true, Latest: metrics.Snapshot{CPU: 5, MemUsed: 30, MemTotal: 100, DiskUsed: 60, DiskTotal: 100}}
	p := personalityOf(v, nil, events)
	if p.Offline != 1 {
		t.Fatalf("offline count: %d", p.Offline)
	}
	if p.Stable != 100-15-4-4 {
		t.Fatalf("unexpected stable score: %d", p.Stable)
	}
	if p.StableText != "偶有波动" {
		t.Fatalf("unexpected stable text: %s", p.StableText)
	}
}

func TestPersonalityNightOwl(t *testing.T) {
	base := time.Date(2024, 3, 1, 2, 0, 0, 0, time.Local).Unix()
	night := []metrics.Snapshot{
		{Time: base, CPU: 30, MemUsed: 20, MemTotal: 100, DiskUsed: 10, DiskTotal: 100},
		{Time: base + 3600, CPU: 32, MemUsed: 20, MemTotal: 100, DiskUsed: 10, DiskTotal: 100},
		{Time: base + 7200, CPU: 34, MemUsed: 20, MemTotal: 100, DiskUsed: 10, DiskTotal: 100},
		{Time: base + 10800, CPU: 31, MemUsed: 20, MemTotal: 100, DiskUsed: 10, DiskTotal: 100},
		{Time: base + 10*3600, CPU: 5, MemUsed: 20, MemTotal: 100, DiskUsed: 10, DiskTotal: 100},
		{Time: base + 11*3600, CPU: 5, MemUsed: 20, MemTotal: 100, DiskUsed: 10, DiskTotal: 100},
	}
	v := node.View{Online: true, Latest: metrics.Snapshot{CPU: 30, MemUsed: 20, MemTotal: 100, DiskUsed: 10, DiskTotal: 100}}
	p := personalityOf(v, night, nil)
	found := false
	for _, tag := range p.Tags {
		if tag == "夜猫子" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected night tag, got %+v", p.Tags)
	}
}
