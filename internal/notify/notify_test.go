package notify

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

type rewriteTransport struct {
	base *url.URL
}

func (t rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.URL.Scheme = t.base.Scheme
	clone.URL.Host = t.base.Host
	return http.DefaultTransport.RoundTrip(clone)
}

func TestSendProviderPayloads(t *testing.T) {
	var (
		gotPath, gotQuery, gotType, gotBody string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotPath, gotQuery, gotType, gotBody = r.URL.Path, r.URL.RawQuery, r.Header.Get("Content-Type"), string(b)
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, ".send") {
			io.WriteString(w, `{"code":0,"message":"ok"}`)
			return
		}
		io.WriteString(w, `{"code":200,"message":"ok"}`)
	}))
	defer srv.Close()
	base, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	old := client
	client = &http.Client{Transport: rewriteTransport{base}}
	defer func() { client = old }()

	cases := []struct {
		name      string
		webhook   string
		wantType  string
		wantPath  string
		wantQuery string
		wantBody  []string
	}{
		{
			name: "wecom", webhook: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x",
			wantType: "application/json", wantPath: "/cgi-bin/webhook/send", wantQuery: "key=x",
			wantBody: []string{`"msgtype":"text"`, `标题\n正文`},
		},
		{
			name: "serverchan", webhook: "https://sctapi.ftqq.com/SCTKEY.send",
			wantType: "application/x-www-form-urlencoded", wantPath: "/SCTKEY.send",
			wantBody: []string{"title=", "desp=", "%E6%A0%87%E9%A2%98"},
		},
		{
			name: "pushplus", webhook: "https://www.pushplus.plus/send?token=TOK",
			wantType: "application/json", wantPath: "/send", wantQuery: "token=TOK",
			wantBody: []string{`"token":"TOK"`, `"template":"txt"`},
		},
		{
			name: "bark", webhook: "https://api.day.app/DEVKEY",
			wantType: "application/json", wantPath: "/DEVKEY",
			wantBody: []string{`"title":"标题"`, `"body":"正文"`, `"group":"KayPanel"`},
		},
		{
			name: "ntfy", webhook: "https://ntfy.sh/kaypanel",
			wantType: "application/json", wantPath: "/",
			wantBody: []string{`"topic":"kaypanel"`, `"message":"正文"`},
		},
		{
			name: "gotify", webhook: "https://gotify.example.com/message?token=TOK",
			wantType: "application/json", wantPath: "/message", wantQuery: "token=TOK",
			wantBody: []string{`"title":"标题"`, `"priority":5`},
		},
		{
			name: "generic", webhook: "https://example.com/hook",
			wantType: "application/json", wantPath: "/hook",
			wantBody: []string{`"source":"KayPanel"`, `"title":"标题"`},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gotPath, gotQuery, gotType, gotBody = "", "", "", ""
			if err := Send(context.Background(), c.webhook, "标题", "正文"); err != nil {
				t.Fatalf("Send: %v", err)
			}
			if gotType != c.wantType {
				t.Errorf("content-type = %q, want %q", gotType, c.wantType)
			}
			if gotPath != c.wantPath {
				t.Errorf("path = %q, want %q", gotPath, c.wantPath)
			}
			if gotQuery != c.wantQuery {
				t.Errorf("query = %q, want %q", gotQuery, c.wantQuery)
			}
			for _, want := range c.wantBody {
				if !strings.Contains(gotBody, want) {
					t.Errorf("body %q missing %q", gotBody, want)
				}
			}
		})
	}
}

func TestSendRejectsBadProviderConfig(t *testing.T) {
	if err := Send(context.Background(), "https://www.pushplus.plus/send", "t", "b"); err == nil {
		t.Fatal("pushplus without token should fail")
	}
	if err := Send(context.Background(), "https://ntfy.sh/", "t", "b"); err == nil {
		t.Fatal("ntfy without topic should fail")
	}
	if err := Send(context.Background(), "https://api.telegram.org/botX/sendMessage", "t", "b"); err == nil {
		t.Fatal("telegram without chat_id should fail")
	}
}
