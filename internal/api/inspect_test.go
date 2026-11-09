package api

import (
	"testing"

	"kaypanel/internal/metrics"
	"kaypanel/internal/node"
)

func TestInspectScoreHealthy(t *testing.T) {
	v := node.View{
		Online: true,
		Latest: metrics.Snapshot{
			CPU:         12,
			Cores:       4,
			MemUsed:     2 << 30,
			MemTotal:    8 << 30,
			DiskUsed:    20 << 30,
			DiskTotal:   100 << 30,
			Load1:       0.3,
			DockerRunning: 3,
			DockerTotal:   3,
		},
	}
	it := inspectScore(v)
	if it.Score != 100 || it.Grade != "优秀" || len(it.Issues) != 0 {
		t.Fatalf("unexpected score: %+v", it)
	}
}

func TestInspectScoreOffline(t *testing.T) {
	v := node.View{Online: false, Error: "connection refused"}
	it := inspectScore(v)
	if it.Score != 0 || it.Grade != "离线" || len(it.Issues) != 2 {
		t.Fatalf("unexpected score: %+v", it)
	}
}

func TestInspectScoreDeductions(t *testing.T) {
	v := node.View{
		Online: true,
		Latest: metrics.Snapshot{
			CPU:           96,
			Cores:         2,
			MemUsed:       95,
			MemTotal:      100,
			DiskUsed:      96,
			DiskTotal:     100,
			Load1:         5,
			Temp:          90,
			SwapUsed:      80,
			SwapTotal:     100,
			DockerRunning: 1,
			DockerTotal:   5,
		},
	}
	it := inspectScore(v)
	if it.Score != 0 {
		t.Fatalf("expected clamped score 0, got %d", it.Score)
	}
	if it.Grade != "需关注" || len(it.Issues) < 6 {
		t.Fatalf("unexpected score: %+v", it)
	}
}

func TestInspectScoreSingleDeduction(t *testing.T) {
	v := node.View{
		Online: true,
		Latest: metrics.Snapshot{
			CPU:        10,
			Cores:      2,
			MemUsed:    30,
			MemTotal:   100,
			DiskUsed:   82,
			DiskTotal:  100,
			Load1:      0.2,
			DockerTotal: 0,
		},
	}
	it := inspectScore(v)
	if it.Score != 90 || it.Grade != "优秀" {
		t.Fatalf("unexpected score: %+v", it)
	}
	if len(it.Issues) != 1 || it.Issues[0] != "磁盘 82.0%" {
		t.Fatalf("unexpected issues: %+v", it.Issues)
	}
}
