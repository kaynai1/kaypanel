package sshx

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type Config struct {
	Addr         string
	User         string
	AuthType     string
	PrivateKey   string
	Password     string
	HostKey      string
	Sudo         bool
	SudoPassword string
}

type Client struct {
	cfg       Config
	onHostKey func(string)

	mu   sync.Mutex
	conn *ssh.Client
	sf   *sftp.Client
}

type Result struct {
	Stdout   string
	Stderr   string
	ExitCode int
}

func New(cfg Config, onHostKey func(string)) *Client {
	return &Client{cfg: cfg, onHostKey: onHostKey}
}

func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sf != nil {
		c.sf.Close()
		c.sf = nil
	}
	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}
}

func (c *Client) ensure() (*ssh.Client, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		return c.conn, nil
	}
	auths := []ssh.AuthMethod{}
	switch c.cfg.AuthType {
	case "none":
		// Token 用户名主机（如 Instabox）：x/crypto/ssh 会先自动尝试 RFC 4252 的 none 认证
	case "password":
		if c.cfg.Password == "" {
			return nil, fmt.Errorf("节点未配置密码")
		}
		auths = append(auths, ssh.Password(c.cfg.Password))
		auths = append(auths, ssh.KeyboardInteractive(func(name, instruction string, questions []string, echos []bool) ([]string, error) {
			answers := make([]string, len(questions))
			for i := range answers {
				answers[i] = c.cfg.Password
			}
			return answers, nil
		}))
	default:
		if strings.TrimSpace(c.cfg.PrivateKey) == "" {
			return nil, fmt.Errorf("节点未配置私钥")
		}
		signer, err := ssh.ParsePrivateKey([]byte(c.cfg.PrivateKey))
		if err != nil {
			return nil, fmt.Errorf("私钥解析失败: %w", err)
		}
		auths = append(auths, ssh.PublicKeys(signer))
	}

	var seenFP string
	hostKeyCB := func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		fp := ssh.FingerprintSHA256(key)
		seenFP = fp
		if c.cfg.HostKey == "" {
			if c.onHostKey != nil {
				c.onHostKey(fp)
			}
			return nil
		}
		if c.cfg.HostKey != fp {
			return fmt.Errorf("主机指纹不匹配：已保存 %s，当前 %s", c.cfg.HostKey, fp)
		}
		return nil
	}

	clientCfg := &ssh.ClientConfig{
		User:            c.cfg.User,
		Auth:            auths,
		HostKeyCallback: hostKeyCB,
		Timeout:         12 * time.Second,
	}
	conn, err := net.DialTimeout("tcp", c.cfg.Addr, 12*time.Second)
	if err != nil {
		return nil, fmt.Errorf("连接 %s 失败: %w", c.cfg.Addr, err)
	}
	sshConn, chans, reqs, err := ssh.NewClientConn(conn, c.cfg.Addr, clientCfg)
	if err != nil {
		conn.Close()
		if seenFP != "" {
			return nil, fmt.Errorf("SSH 握手失败（主机指纹 %s）: %w", seenFP, err)
		}
		return nil, fmt.Errorf("SSH 握手失败: %w", err)
	}
	c.conn = ssh.NewClient(sshConn, chans, reqs)
	go c.keepalive(c.conn)
	return c.conn, nil
}

func (c *Client) keepalive(conn *ssh.Client) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for range t.C {
		if _, _, err := conn.SendRequest("keepalive@openssh.com", true, nil); err != nil {
			c.resetConn(conn)
			return
		}
	}
}

func (c *Client) resetConn(conn *ssh.Client) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != conn {
		return
	}
	if c.sf != nil {
		c.sf.Close()
		c.sf = nil
	}
	conn.Close()
	c.conn = nil
}

func (c *Client) ResetSFTP() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sf != nil {
		c.sf.Close()
		c.sf = nil
	}
}

func (c *Client) SFTP() (*sftp.Client, error) {
	conn, err := c.ensure()
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sf != nil {
		return c.sf, nil
	}
	sf, err := sftp.NewClient(conn)
	if err != nil {
		return nil, fmt.Errorf("SFTP 初始化失败: %w", err)
	}
	c.sf = sf
	return sf, nil
}

func (c *Client) NewSession() (*ssh.Session, error) {
	conn, err := c.ensure()
	if err != nil {
		return nil, err
	}
	s, err := conn.NewSession()
	if err != nil {
		c.resetConn(conn)
		return nil, fmt.Errorf("创建 SSH 会话失败: %w", err)
	}
	return s, nil
}

func (c *Client) Run(ctx context.Context, command, stdin string, timeout time.Duration) (Result, error) {
	if timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}
	sess, err := c.NewSession()
	if err != nil {
		return Result{}, err
	}
	defer sess.Close()
	if stdin != "" {
		sess.Stdin = strings.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	sess.Stdout = &stdout
	sess.Stderr = &stderr
	if err := sess.Start(command); err != nil {
		return Result{}, fmt.Errorf("执行命令失败: %w", err)
	}
	done := make(chan error, 1)
	go func() { done <- sess.Wait() }()
	select {
	case werr := <-done:
		res := Result{Stdout: stdout.String(), Stderr: stderr.String()}
		if werr != nil {
			if ee, ok := werr.(*ssh.ExitError); ok {
				res.ExitCode = ee.ExitStatus()
				return res, nil
			}
			return res, werr
		}
		return res, nil
	case <-ctx.Done():
		_ = sess.Signal(ssh.SIGKILL)
		_ = sess.Close()
		return Result{}, fmt.Errorf("执行超时或已取消")
	}
}
