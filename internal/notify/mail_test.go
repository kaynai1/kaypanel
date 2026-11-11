package notify

import (
	"encoding/base64"
	"mime"
	"strings"
	"testing"
)

func TestNormalizeMail(t *testing.T) {
	c, err := NormalizeMail(MailConfig{Host: "smtp.example.com", From: "Bot <bot@example.com>", To: []string{"a@qq.com， b@163.com; c@x.com"}})
	if err != nil {
		t.Fatal(err)
	}
	if c.Mode != MailSSL || c.Port != 465 {
		t.Errorf("defaults = %s:%d, want ssl:465", c.Mode, c.Port)
	}
	if c.From != "bot@example.com" {
		t.Errorf("from = %q", c.From)
	}
	if len(c.To) != 3 || c.To[2] != "c@x.com" {
		t.Errorf("to = %v", c.To)
	}
	if _, err := NormalizeMail(MailConfig{Host: "smtp.example.com", From: "bad", To: []string{"a@qq.com"}}); err == nil {
		t.Error("bad from should fail")
	}
	if _, err := NormalizeMail(MailConfig{Host: "smtp.example.com", From: "a@x.com", To: []string{"bad"}}); err == nil {
		t.Error("bad recipient should fail")
	}
	if _, err := NormalizeMail(MailConfig{Host: "smtp.example.com", Mode: "unknown", From: "a@x.com", To: []string{"b@x.com"}}); err == nil {
		t.Error("unknown mode should fail")
	}
}

func TestMailMessage(t *testing.T) {
	c := MailConfig{Host: "smtp.example.com", From: "bot@example.com", To: []string{"a@qq.com"}}
	msg := mailMessage(c, "KayPanel 告警 · 11-11 10:00", "CPU 95%\n磁盘 90%")
	if !strings.Contains(msg, "Subject: "+mime.QEncoding.Encode("UTF-8", "KayPanel 告警 · 11-11 10:00")) {
		t.Errorf("missing encoded subject: %s", msg)
	}
	if !strings.Contains(msg, "From: \"KayPanel\" <bot@example.com>") {
		t.Errorf("missing from header")
	}
	head, body, ok := strings.Cut(msg, "\r\n\r\n")
	if !ok {
		t.Fatal("missing header/body separator")
	}
	if strings.Contains(strings.ReplaceAll(head, "\r\n", ""), "\n") {
		t.Error("headers must use CRLF")
	}
	raw, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(strings.TrimSpace(body), "\r\n", ""))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(raw); got != "KayPanel 告警 · 11-11 10:00\nCPU 95%\n磁盘 90%" {
		t.Errorf("body = %q", got)
	}
}

func TestBase64Lines(t *testing.T) {
	out := base64Lines(strings.Repeat("告警", 200))
	for _, line := range strings.Split(out, "\r\n") {
		if len(line) > 76 {
			t.Fatalf("line too long: %d", len(line))
		}
	}
}
