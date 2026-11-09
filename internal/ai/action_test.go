package ai

import "testing"

func TestParseActionsTag(t *testing.T) {
	reply := "内存偏高，可以先看日志。\n<actions>[{\"type\":\"container_logs\",\"target\":\"nginx\",\"reason\":\"排查内存\"}]</actions>"
	clean, acts := ParseActions(reply)
	if clean != "内存偏高，可以先看日志。" {
		t.Fatalf("unexpected clean reply: %q", clean)
	}
	if len(acts) != 1 || acts[0].Type != "container_logs" || acts[0].Target != "nginx" || acts[0].Reason != "排查内存" {
		t.Fatalf("unexpected actions: %+v", acts)
	}
}

func TestParseActionsFence(t *testing.T) {
	reply := "磁盘占用较高。\n```json\n{\"actions\":[{\"type\":\"disk_usage\",\"reason\":\"查看占用\"}]}\n```"
	clean, acts := ParseActions(reply)
	if clean != "磁盘占用较高。" {
		t.Fatalf("unexpected clean reply: %q", clean)
	}
	if len(acts) != 1 || acts[0].Type != "disk_usage" {
		t.Fatalf("unexpected actions: %+v", acts)
	}
}

func TestParseActionsIgnoresPlainReply(t *testing.T) {
	clean, acts := ParseActions("一切正常。")
	if clean != "一切正常。" || len(acts) != 0 {
		t.Fatalf("unexpected result: %q %+v", clean, acts)
	}
}

func TestParseActionsInvalidJSON(t *testing.T) {
	clean, acts := ParseActions("稍等。<actions>not json</actions>")
	if clean != "稍等。" || len(acts) != 0 {
		t.Fatalf("unexpected result: %q %+v", clean, acts)
	}
}

func TestNormalizeActions(t *testing.T) {
	in := []Action{
		{Type: "container_restart", Target: "nginx", Reason: "重启"},
		{Type: "container_logs", Target: "bad name", Reason: "日志"},
		{Type: "disk_usage", Target: "/", Reason: "分析"},
		{Type: "rm_rf", Target: "/", Reason: "任意命令"},
		{Type: "container_restart", Target: "redis", Reason: "重启"},
		{Type: "container_restart", Target: "mysql", Reason: "重启"},
		{Type: "container_restart", Target: "postgres", Reason: "重启"},
	}
	out := NormalizeActions(in, func(s string) bool { return s != "bad name" })
	if len(out) != 3 {
		t.Fatalf("expected 3 actions, got %d: %+v", len(out), out)
	}
	if out[0].Type != "container_restart" || out[0].Target != "nginx" {
		t.Fatalf("unexpected first action: %+v", out[0])
	}
	if out[1].Type != "disk_usage" || out[1].Target != "" {
		t.Fatalf("unexpected second action: %+v", out[1])
	}
	if out[2].Target != "redis" {
		t.Fatalf("unexpected third action: %+v", out[2])
	}
}
