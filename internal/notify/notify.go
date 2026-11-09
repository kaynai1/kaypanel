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

func bodyOf(title, body string) string {
	if strings.TrimSpace(body) == "" {
		return title
	}
	return body
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
	target := webhook
	var (
		payload   any
		form      url.Values
		codeCheck bool
		codeOK    int
	)
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
	case strings.Contains(host, "sctapi.ftqq.com"):
		form = url.Values{"title": {title}, "desp": {bodyOf(title, body)}}
		codeCheck, codeOK = true, 0
	case strings.Contains(host, "pushplus.plus"):
		token := u.Query().Get("token")
		if token == "" {
			return fmt.Errorf("PushPlus Webhook 需在 URL 中带 token 参数")
		}
		payload = map[string]any{"token": token, "title": title, "content": bodyOf(title, body), "template": "txt"}
		codeCheck, codeOK = true, 200
	case strings.Contains(host, "api.day.app") || strings.Contains(host, "bark.day.app"):
		payload = map[string]any{"title": title, "body": bodyOf(title, body), "group": "KayPanel"}
		codeCheck, codeOK = true, 200
	case host == "ntfy.sh" || strings.HasSuffix(host, ".ntfy.sh"):
		topic := strings.Trim(u.Path, "/")
		if topic == "" {
			return fmt.Errorf("ntfy Webhook 需带主题路径，例如 https://ntfy.sh/kaypanel")
		}
		target = u.Scheme + "://" + u.Host + "/"
		payload = map[string]any{"topic": topic, "title": title, "message": bodyOf(title, body)}
	case strings.HasSuffix(strings.TrimRight(u.Path, "/"), "/message") && u.Query().Get("token") != "":
		payload = map[string]any{"title": title, "message": bodyOf(title, body), "priority": 5}
	default:
		payload = map[string]any{"title": title, "text": body, "content": msg, "source": "KayPanel"}
	}

	var (
		reqBody     io.Reader
		contentType = "application/json"
	)
	if form != nil {
		reqBody = strings.NewReader(form.Encode())
		contentType = "application/x-www-form-urlencoded"
	} else {
		b, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		reqBody = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, reqBody)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("User-Agent", "KayPanel/1.0")
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("推送请求失败: %v", err)
	}
	defer res.Body.Close()
	snippet, _ := io.ReadAll(io.LimitReader(res.Body, 500))
	detail := strings.TrimSpace(string(snippet))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("推送被拒绝（HTTP %d）: %s", res.StatusCode, detail)
	}
	if codeCheck {
		var ar struct {
			Code    *int   `json:"code"`
			Message string `json:"message"`
			Msg     string `json:"msg"`
		}
		if json.Unmarshal(snippet, &ar) == nil && ar.Code != nil && *ar.Code != codeOK {
			reason := ar.Message
			if reason == "" {
				reason = ar.Msg
			}
			if reason == "" {
				reason = detail
			}
			return fmt.Errorf("推送被拒绝（code %d）: %s", *ar.Code, reason)
		}
	}
	return nil
}
