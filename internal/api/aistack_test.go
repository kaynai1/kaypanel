package api

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSanitizeStackName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"Uptime Kuma", "uptime-kuma"},
		{"  my_app  ", "my_app"},
		{"---", "ai-app"},
		{"", "ai-app"},
		{"中文应用", "ai-app"},
		{"a/b\\c", "a-b-c"},
		{"very-long-name-with-many-characters-exceeding-forty", "very-long-name-with-many-characters-exce"},
	}
	for _, c := range cases {
		if got := sanitizeStackName(c.in); got != c.want {
			t.Fatalf("sanitizeStackName(%q)=%q want %q", c.in, got, c.want)
		}
	}
}

func TestExtractJSONObject(t *testing.T) {
	wrapped := "好的，这是方案：\n```json\n{\"name\":\"x\",\"compose\":\"services:\\n  a:\\n    image: nginx\"}\n```\n完成"
	out := extractJSONObject(wrapped)
	var m map[string]any
	if err := json.Unmarshal([]byte(out), &m); err != nil {
		t.Fatalf("extract failed: %v (%q)", err, out)
	}
	if m["name"] != "x" {
		t.Fatalf("unexpected object: %v", m)
	}
	plain := extractJSONObject(`{"name":"y"}`)
	if plain != `{"name":"y"}` {
		t.Fatalf("plain json mangled: %q", plain)
	}
}

func TestStringList(t *testing.T) {
	if got := stringList(json.RawMessage(`["a","b"]`)); len(got) != 2 {
		t.Fatalf("array parse failed: %+v", got)
	}
	if got := stringList(json.RawMessage(`"one"`)); len(got) != 1 || got[0] != "one" {
		t.Fatalf("string parse failed: %+v", got)
	}
	if got := stringList(json.RawMessage(`""`)); len(got) != 0 {
		t.Fatalf("empty string should yield nil: %+v", got)
	}
	if got := stringList(nil); got != nil {
		t.Fatalf("nil input should yield nil: %+v", got)
	}
}

func TestCleanList(t *testing.T) {
	got := cleanList([]string{"  a ", "", "b", "c", "d", "e"}, 3)
	if len(got) != 3 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("unexpected clean list: %+v", got)
	}
	long := strings.Repeat("长", 200)
	trimmed := cleanList([]string{long}, 4)
	if len([]rune(trimmed[0])) != 161 {
		t.Fatalf("expected 160 runes + ellipsis, got %d", len([]rune(trimmed[0])))
	}
}

func TestValidateComposeValid(t *testing.T) {
	compose := `services:
  web:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "8088:80"
    volumes:
      - ./html:/usr/share/nginx/html:ro
    environment:
      - TZ=Asia/Shanghai
`
	services, images, err := validateCompose(compose)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if services != 1 || len(images) != 1 || images[0] != "nginx:alpine" {
		t.Fatalf("unexpected result: %d %+v", services, images)
	}
}

func TestValidateComposeRejects(t *testing.T) {
	cases := []string{
		"",
		"foo: bar",
		"services:\n  web:\n    restart: unless-stopped\n",
		"services:\n  web:\n    image: nginx\n    build: .\n",
		"services:\n  web:\n    image: nginx\n    privileged: true\n",
		"services:\n  web:\n    image: nginx\n    network_mode: host\n",
		"services:\n  web:\n    image: nginx\n    pid: host\n",
		"services:\n  web:\n    image: nginx\n    devices:\n      - /dev/dri:/dev/dri\n",
		"services:\n  web:\n    image: nginx\n    cap_add:\n      - NET_ADMIN\n",
		"services:\n  web:\n    image: nginx\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n",
	}
	for _, c := range cases {
		if _, _, err := validateCompose(c); err == nil {
			t.Fatalf("expected rejection for: %q", c)
		}
	}
	if _, _, err := validateCompose("services:\n  a:\n    image: x\n  b:\n    image: y\n  c:\n    image: z\n  d:\n    image: w\n  e:\n    image: v\n  f:\n    image: u\n"); err == nil {
		t.Fatalf("expected rejection for too many services")
	}
}
