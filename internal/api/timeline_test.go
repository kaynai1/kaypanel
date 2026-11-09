package api

import (
	"testing"

	"kaypanel/internal/metrics"
)

func TestDownsampleTrendEmpty(t *testing.T) {
	out := downsampleTrend(nil, 240)
	if out == nil || len(out) != 0 {
		t.Fatalf("expected empty non-nil slice, got %#v", out)
	}
}

func TestDownsampleTrendSmall(t *testing.T) {
	in := []metrics.Snapshot{
		{Time: 1, CPU: 10, MemUsed: 1, MemTotal: 2, DiskUsed: 1, DiskTotal: 4},
		{Time: 2, CPU: 20, MemUsed: 2, MemTotal: 2, DiskUsed: 2, DiskTotal: 4},
	}
	out := downsampleTrend(in, 240)
	if len(out) != 2 {
		t.Fatalf("expected 2 points, got %d", len(out))
	}
	if out[0].Mem != 50 || out[1].Mem != 100 || out[1].Disk != 50 {
		t.Fatalf("unexpected pct conversion: %+v", out)
	}
}

func TestDownsampleTrendLargeKeepsLast(t *testing.T) {
	in := make([]metrics.Snapshot, 1000)
	for i := range in {
		in[i] = metrics.Snapshot{Time: int64(i + 1), CPU: float64(i)}
	}
	out := downsampleTrend(in, 240)
	if len(out) > 241 || len(out) < 200 {
		t.Fatalf("unexpected downsampled size: %d", len(out))
	}
	last := out[len(out)-1]
	if last.Time != 1000 || last.CPU != 999 {
		t.Fatalf("last point lost: %+v", last)
	}
}

func TestDownsampleTrendLastOffGrid(t *testing.T) {
	in := make([]metrics.Snapshot, 0, 501)
	for i := 0; i < 500; i++ {
		in = append(in, metrics.Snapshot{Time: int64(i + 1)})
	}
	in = append(in, metrics.Snapshot{Time: 9999})
	out := downsampleTrend(in, 240)
	last := out[len(out)-1]
	if last.Time != 9999 {
		t.Fatalf("off-grid last point missing: %+v", last)
	}
}
