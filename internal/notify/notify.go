package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var client = &http.Client{Timeout: 12 * time.Second}

func text(title, body string) string {
	if strings.TrimSpace(body) == "" {
		return title
	}
	return title + "\n" + body
}

// Send posts a plain-text message to a webhook and auto-detects the provider
// from the URL host. Unknown hosts get a generic JSON body.
func Send(ctx context.Context, webhook, title, body string) error {
	webhook = strings.TrimSpace(webhook)
	if webhook == "" {
		return fmt.Errorf("尚未配置推送 Webhook")
	}
	u, err := url.Parse(webhook)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("Webhook 地址格式不正确")
	}
	host := strings.ToLower(u.Hostname())
	msg := text(title, body)
	var payload any
	switch {
	case strings.Contains(host, "qyapi.weixin.qq.com"):
		payload = map[string]any{"msgtype": "text", "text": map[string]string{"content": msg}}
	case strings.Contains(host, "oapi.dingtalk.com"):
		payload = map[string]any{"msgtype": "text", "text": map[string]string{"content": msg}}
	case strings.Contains(host, "open.feishu.cn") || strings.Contains(host, "open.larksuite.com"):
		payload = map[string]any{"msg_type": "text", "content": map[string]string{"text": msg}}
	case strings.Contains(host, "hooks.slack.com"):
		payload = map[string]any{"text": msg}
	case strings.Contains(host, "discord.com"):
		payload = map[string]any{"content": msg}
	case strings.Contains(host, "api.telegram.org"):
		chat := u.Query().Get("chat_id")
		if chat == "" {
			return fmt.Errorf("Telegram Webhook 需在 URL 中带 chat_id 参数")
		}
		payload = map[string]any{"chat_id": chat, "text": msg}
	default:
		payload = map[string]any{"title": title, "text": body, "content": msg, "source": "KayPanel"}
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhook, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("推送请求失败: %v", err)
	}
	defer res.Body.Close()
	snippet, _ := io.ReadAll(io.LimitReader(res.Body, 300))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("推送被拒绝（HTTP %d）: %s", res.StatusCode, strings.TrimSpace(string(snippet)))
	}
	return nil
}
