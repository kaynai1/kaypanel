package notify

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"
)

type MailConfig struct {
	Host string
	Port int
	Mode string
	User string
	Pass string
	From string
	To   []string
}

const (
	MailSSL      = "ssl"
	MailSTARTTLS = "starttls"
	MailPlain    = "plain"
)

// NormalizeMail validates the SMTP settings and fills defaults. It also splits
// recipient lists so callers can accept "a@x.com, b@y.com" from one input.
func NormalizeMail(c MailConfig) (MailConfig, error) {
	c.Host = strings.TrimSpace(c.Host)
	c.Mode = strings.ToLower(strings.TrimSpace(c.Mode))
	c.User = strings.TrimSpace(c.User)
	if c.Host == "" {
		return c, fmt.Errorf("尚未配置 SMTP 服务器")
	}
	if c.Mode == "" {
		c.Mode = MailSSL
	}
	if c.Port == 0 {
		switch c.Mode {
		case MailSSL:
			c.Port = 465
		case MailSTARTTLS:
			c.Port = 587
		case MailPlain:
			c.Port = 25
		}
	}
	if c.Port < 1 || c.Port > 65535 {
		return c, fmt.Errorf("SMTP 端口不正确")
	}
	switch c.Mode {
	case MailSSL, MailSTARTTLS, MailPlain:
	default:
		return c, fmt.Errorf("SMTP 加密方式不支持")
	}
	from, err := mail.ParseAddress(strings.TrimSpace(c.From))
	if err != nil || !strings.Contains(from.Address, "@") {
		return c, fmt.Errorf("发件人邮箱格式不正确")
	}
	c.From = from.Address
	var to []string
	for _, raw := range c.To {
		for _, part := range strings.FieldsFunc(raw, func(r rune) bool {
			return r == ',' || r == '，' || r == ';' || r == '；' || r == '\n'
		}) {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			addr, err := mail.ParseAddress(part)
			if err != nil || !strings.Contains(addr.Address, "@") {
				return c, fmt.Errorf("收件人邮箱格式不正确: %s", part)
			}
			to = append(to, addr.Address)
		}
	}
	if len(to) == 0 {
		return c, fmt.Errorf("请填写收件人邮箱")
	}
	c.To = to
	return c, nil
}

// SendMail delivers a plain-text alert over SMTP. Passwords are only sent over
// TLS, so "plain" mode is intended for local relays without authentication.
func SendMail(ctx context.Context, cfg MailConfig, title, body string) error {
	c, err := NormalizeMail(cfg)
	if err != nil {
		return err
	}
	if c.Mode == MailPlain && c.User != "" && !isLocalSMTPHost(c.Host) {
		return fmt.Errorf("不加密模式不允许发送账号密码，请改用 SSL/TLS 或 STARTTLS")
	}
	deadline, ok := ctx.Deadline()
	if !ok {
		deadline = time.Now().Add(20 * time.Second)
	}
	addr := net.JoinHostPort(c.Host, fmt.Sprint(c.Port))
	dialer := &net.Dialer{Timeout: 10 * time.Second}

	var conn net.Conn
	switch c.Mode {
	case MailSSL:
		td := &tls.Dialer{
			NetDialer: dialer,
			Config:    &tls.Config{ServerName: c.Host, MinVersion: tls.VersionTLS12},
		}
		conn, err = td.DialContext(ctx, "tcp", addr)
	default:
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("连接 SMTP 服务器失败: %v", err)
	}
	_ = conn.SetDeadline(deadline)

	client, err := smtp.NewClient(conn, c.Host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("SMTP 握手失败: %v", err)
	}
	defer client.Close()

	if c.Mode == MailSTARTTLS {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return fmt.Errorf("SMTP 服务器不支持 STARTTLS，请改用 SSL/TLS 或换端口")
		}
		if err := client.StartTLS(&tls.Config{ServerName: c.Host, MinVersion: tls.VersionTLS12}); err != nil {
			return fmt.Errorf("STARTTLS 加密失败: %v", err)
		}
	}
	if c.User != "" {
		ok, mechs := client.Extension("AUTH")
		if !ok {
			return fmt.Errorf("SMTP 服务器不支持账号密码登录")
		}
		upper := strings.ToUpper(mechs)
		var auth smtp.Auth
		switch {
		case strings.Contains(upper, "PLAIN"):
			auth = smtp.PlainAuth("", c.User, c.Pass, c.Host)
		case strings.Contains(upper, "LOGIN"):
			auth = &loginAuth{username: c.User, password: c.Pass}
		default:
			return fmt.Errorf("SMTP 服务器不支持 PLAIN/LOGIN 登录")
		}
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("SMTP 登录失败: %v", err)
		}
	}
	if err := client.Mail(c.From); err != nil {
		return fmt.Errorf("SMTP 发件人被拒绝: %v", err)
	}
	for _, rcpt := range c.To {
		if err := client.Rcpt(rcpt); err != nil {
			return fmt.Errorf("SMTP 收件人被拒绝: %v", err)
		}
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("SMTP 开始发送失败: %v", err)
	}
	if _, err := w.Write([]byte(mailMessage(c, title, body))); err != nil {
		w.Close()
		return fmt.Errorf("SMTP 发送失败: %v", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("SMTP 发送失败: %v", err)
	}
	_ = client.Quit()
	return nil
}

func isLocalSMTPHost(host string) bool {
	switch strings.ToLower(host) {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	return false
}

func mailMessage(c MailConfig, title, body string) string {
	subject := strings.NewReplacer("\r", " ", "\n", " ").Replace(strings.TrimSpace(title))
	if subject == "" {
		subject = "KayPanel 通知"
	}
	from := mail.Address{Name: "KayPanel", Address: c.From}
	to := make([]string, 0, len(c.To))
	for _, addr := range c.To {
		to = append(to, (&mail.Address{Address: addr}).String())
	}
	return "From: " + from.String() + "\r\n" +
		"To: " + strings.Join(to, ", ") + "\r\n" +
		"Subject: " + mime.QEncoding.Encode("UTF-8", subject) + "\r\n" +
		"Date: " + time.Now().Format(time.RFC1123Z) + "\r\n" +
		"Message-ID: <" + fmt.Sprint(time.Now().UnixNano()) + "@" + c.Host + ">\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n" +
		"Content-Transfer-Encoding: base64\r\n" +
		"X-Mailer: KayPanel\r\n\r\n" +
		base64Lines(text(title, body)) + "\r\n"
}

func base64Lines(s string) string {
	enc := base64.StdEncoding.EncodeToString([]byte(s))
	var b strings.Builder
	for len(enc) > 76 {
		b.WriteString(enc[:76])
		b.WriteString("\r\n")
		enc = enc[76:]
	}
	b.WriteString(enc)
	return b.String()
}

type loginAuth struct {
	username string
	password string
}

func (a *loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS && !isLocalSMTPHost(server.Name) {
		return "", nil, fmt.Errorf("unencrypted connection")
	}
	return "LOGIN", nil, nil
}

func (a *loginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	prompt := strings.ToLower(strings.TrimSpace(string(fromServer)))
	switch {
	case strings.HasPrefix(prompt, "username"):
		return []byte(a.username), nil
	case strings.HasPrefix(prompt, "password"):
		return []byte(a.password), nil
	}
	return nil, fmt.Errorf("SMTP 登录返回未知挑战: %s", prompt)
}
