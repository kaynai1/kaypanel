package node

import (
	"context"
	"fmt"
	"net"
	"regexp"
	"strings"
	"sync"
	"time"

	"kaypanel/internal/config"
	"kaypanel/internal/metrics"
	"kaypanel/internal/sshx"
)

var (
	userRe  = regexp.MustCompile(`^[A-Za-z0-9._-]{1,32}$`)
	nameRe  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)
	stackRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,62}$`)
)

type View struct {
	config.Node
	HasPassword bool              `json:"has_password"`
	HasKey      bool              `json:"has_key"`
	Online      bool              `json:"online"`
	Error       string            `json:"error"`
	Latest      metrics.Snapshot  `json:"latest"`
	History     []metrics.Snapshot `json:"history"`
}

type TestResult struct {
	OK          bool   `json:"ok"`
	Fingerprint string `json:"fingerprint"`
	Hostname    string `json:"hostname"`
	OS          string `json:"os"`
	Kernel      string `json:"kernel"`
	Cores       string `json:"cores"`
	Docker      string `json:"docker"`
	Error       string `json:"error,omitempty"`
}

type Node struct {
	mu     sync.RWMutex
	cfg    config.Node
	client *sshx.Client
	store  *config.Store
	ctx    context.Context
	cancel context.CancelFunc

	online  bool
	errMsg  string
	latest  metrics.Snapshot
	hist    []metrics.Snapshot
	proc    metrics.Processor
}

type Manager struct {
	store *config.Store

	mu    sync.RWMutex
	nodes map[string]*Node
	order []string
}

func NewManager(store *config.Store) *Manager {
	return &Manager{store: store, nodes: map[string]*Node{}}
}

func (m *Manager) Start() {
	for _, cfg := range m.store.Nodes() {
		m.startNode(cfg)
	}
}

func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, n := range m.nodes {
		n.cancel()
		n.closeClient()
	}
}

func (m *Manager) startNode(cfg config.Node) {
	ctx, cancel := context.WithCancel(context.Background())
	n := &Node{cfg: cfg, ctx: ctx, cancel: cancel, store: m.store}
	m.mu.Lock()
	m.nodes[cfg.ID] = n
	m.order = append(m.order, cfg.ID)
	m.mu.Unlock()
	go n.run()
}

func (m *Manager) Get(id string) (*Node, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	n, ok := m.nodes[id]
	return n, ok
}

func (m *Manager) Views() []View {
	m.mu.RLock()
	ids := append([]string(nil), m.order...)
	m.mu.RUnlock()
	out := make([]View, 0, len(ids))
	for _, id := range ids {
		if n, ok := m.Get(id); ok {
			out = append(out, n.View())
		}
	}
	return out
}

func (m *Manager) Add(c config.Node) (config.Node, error) {
	c.ID = config.RandomHex(4)
	c.CreatedAt = time.Now().Format("2006-01-02 15:04:05")
	c, err := normalize(c)
	if err != nil {
		return c, err
	}
	m.startNode(c)
	if err := m.persist(); err != nil {
		return c, err
	}
	return c, nil
}

func (m *Manager) Update(id string, patch config.Node) error {
	n, ok := m.Get(id)
	if !ok {
		return fmt.Errorf("节点不存在")
	}
	old := n.Config()
	if patch.AuthType == "" {
		patch.AuthType = old.AuthType
	}
	if patch.PrivateKey == "" {
		patch.PrivateKey = old.PrivateKey
	}
	if patch.Password == "" {
		patch.Password = old.Password
	}
	if patch.SudoPassword == "" {
		patch.SudoPassword = old.SudoPassword
	}
	if patch.HostKey == "" && patch.Addr == old.Addr {
		patch.HostKey = old.HostKey
	}
	patch.ID = id
	patch.CreatedAt = old.CreatedAt
	patch, err := normalize(patch)
	if err != nil {
		return err
	}
	n.setConfig(patch)
	if err := m.persist(); err != nil {
		return err
	}
	return nil
}

func (m *Manager) Delete(id string) error {
	n, ok := m.Get(id)
	if !ok {
		return fmt.Errorf("节点不存在")
	}
	n.cancel()
	n.closeClient()
	m.mu.Lock()
	delete(m.nodes, id)
	for i, v := range m.order {
		if v == id {
			m.order = append(m.order[:i], m.order[i+1:]...)
			break
		}
	}
	m.mu.Unlock()
	return m.persist()
}

func (m *Manager) persist() error {
	m.mu.RLock()
	nodes := make([]config.Node, 0, len(m.nodes))
	for _, id := range m.order {
		if n, ok := m.nodes[id]; ok {
			nodes = append(nodes, n.Config())
		}
	}
	m.mu.RUnlock()
	return m.store.SetNodes(nodes)
}

func (m *Manager) Test(id string) TestResult {
	n, ok := m.Get(id)
	if !ok {
		return TestResult{Error: "节点不存在"}
	}
	cfg := n.Config()
	tr := TestResult{}
	client := sshx.New(toSSHConfig(cfg), func(fp string) {
		tr.Fingerprint = fp
		n.setHostKey(fp)
		m.store.SetNodeHostKey(id, fp)
	})
	defer client.Close()
	script := `printf 'host='; hostname 2>/dev/null
printf 'kernel='; uname -r 2>/dev/null
printf 'os='; (. /etc/os-release 2>/dev/null && printf '%s' "$PRETTY_NAME")
printf '\ncores='; (nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null) | head -n1
printf 'docker='; (docker version --format '{{.Server.Version}}' 2>&1 | head -n1)`
	cmd, stdin := wrap(cfg, script)
	res, err := client.Run(context.Background(), cmd, stdin, 20*time.Second)
	if err != nil {
		tr.Error = err.Error()
		return tr
	}
	if res.ExitCode != 0 && strings.TrimSpace(res.Stdout) == "" {
		msg := strings.TrimSpace(res.Stderr)
		if msg == "" {
			msg = fmt.Sprintf("命令退出码 %d", res.ExitCode)
		}
		tr.Error = msg
		return tr
	}
	for _, line := range strings.Split(res.Stdout, "\n") {
		k, v, _ := strings.Cut(strings.TrimSpace(line), "=")
		switch k {
		case "host":
			tr.Hostname = v
		case "kernel":
			tr.Kernel = v
		case "os":
			tr.OS = v
		case "cores":
			tr.Cores = v
		case "docker":
			v = strings.TrimSpace(v)
			switch {
			case strings.Contains(v, "not found"), strings.Contains(v, "No such file"):
				v = "未安装 Docker"
			case strings.Contains(v, "permission denied"):
				v = "无权限访问 Docker（请开启 sudo）"
			case strings.Contains(v, "Cannot connect"):
				v = "Docker 服务未运行"
			}
			tr.Docker = v
		}
	}
	if strings.TrimSpace(tr.Hostname) == "" {
		tr.Error = "已连接但未获取到主机信息"
		return tr
	}
	tr.OK = true
	if tr.Fingerprint == "" {
		tr.Fingerprint = cfg.HostKey
	}
	return tr
}

func normalize(c config.Node) (config.Node, error) {
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" || len([]rune(c.Name)) > 64 {
		return c, fmt.Errorf("节点名称需为 1-64 个字符")
	}
	c.Addr = strings.TrimSpace(c.Addr)
	c.Addr = strings.TrimPrefix(c.Addr, "ssh://")
	c.Addr = strings.TrimSuffix(c.Addr, "/")
	if c.Addr == "" {
		return c, fmt.Errorf("请填写 SSH 地址")
	}
	if !strings.Contains(c.Addr, ":") {
		c.Addr += ":22"
	}
	if _, _, err := net.SplitHostPort(c.Addr); err != nil {
		return c, fmt.Errorf("SSH 地址格式应为 主机:端口")
	}
	c.User = strings.TrimSpace(c.User)
	if !userRe.MatchString(c.User) {
		return c, fmt.Errorf("SSH 用户名不合法")
	}
	if c.AuthType != "password" && c.AuthType != "none" {
		c.AuthType = "key"
	}
	if c.AuthType == "key" && strings.TrimSpace(c.PrivateKey) == "" {
		return c, fmt.Errorf("请粘贴 SSH 私钥")
	}
	if c.AuthType == "password" && c.Password == "" {
		return c, fmt.Errorf("请填写 SSH 密码")
	}
	c.FileRoot = strings.TrimSpace(c.FileRoot)
	if c.FileRoot == "" {
		c.FileRoot = "/"
	}
	if !strings.HasPrefix(c.FileRoot, "/") {
		return c, fmt.Errorf("文件根目录必须是绝对路径")
	}
	c.FileRoot = strings.TrimRight(c.FileRoot, "/")
	if c.FileRoot == "" {
		c.FileRoot = "/"
	}
	c.StacksDir = strings.TrimSpace(c.StacksDir)
	if c.StacksDir == "" {
		if c.User == "root" {
			c.StacksDir = "/root/kaypanel/stacks"
		} else {
			c.StacksDir = "/home/" + c.User + "/kaypanel/stacks"
		}
	}
	if !strings.HasPrefix(c.StacksDir, "/") {
		return c, fmt.Errorf("应用目录必须是绝对路径")
	}
	return c, nil
}

func toSSHConfig(c config.Node) sshx.Config {
	return sshx.Config{
		Addr:         c.Addr,
		User:         c.User,
		AuthType:     c.AuthType,
		PrivateKey:   c.PrivateKey,
		Password:     c.Password,
		HostKey:      c.HostKey,
		Sudo:         c.Sudo,
		SudoPassword: c.SudoPassword,
	}
}

func wrap(c config.Node, inner string) (string, string) {
	cmd := "/bin/sh -c " + ShQuote(inner)
	stdin := ""
	if c.Sudo {
		if c.SudoPassword != "" {
			cmd = "sudo -S -p '' " + cmd
			stdin = c.SudoPassword + "\n"
		} else {
			cmd = "sudo -n " + cmd
		}
	}
	return cmd, stdin
}

func ShQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func (n *Node) Config() config.Node {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return n.cfg
}

func (n *Node) setConfig(c config.Node) {
	n.mu.Lock()
	changed := n.cfg.Addr != c.Addr || n.cfg.User != c.User || n.cfg.AuthType != c.AuthType ||
		n.cfg.PrivateKey != c.PrivateKey || n.cfg.Password != c.Password ||
		n.cfg.HostKey != c.HostKey || n.cfg.Sudo != c.Sudo || n.cfg.SudoPassword != c.SudoPassword
	n.cfg = c
	client := n.client
	if changed {
		n.client = nil
	}
	n.mu.Unlock()
	if changed && client != nil {
		client.Close()
	}
}

func (n *Node) setHostKey(fp string) {
	n.mu.Lock()
	n.cfg.HostKey = fp
	if n.client != nil {
		// existing client keeps its old expected key; rebuild on next use
	}
	n.mu.Unlock()
}

func (n *Node) Client() (*sshx.Client, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.client != nil {
		return n.client, nil
	}
	cfg := n.cfg
	id := cfg.ID
	client := sshx.New(toSSHConfig(cfg), func(fp string) {
		n.setHostKey(fp)
		n.store.SetNodeHostKey(id, fp)
	})
	n.client = client
	return client, nil
}

func (n *Node) closeClient() {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.client != nil {
		n.client.Close()
		n.client = nil
	}
}

func (n *Node) Wrap(inner string) (string, string) {
	return wrap(n.Config(), inner)
}

func (n *Node) RunCtx(ctx context.Context, inner string, timeout time.Duration) (sshx.Result, error) {
	client, err := n.Client()
	if err != nil {
		return sshx.Result{}, err
	}
	cmd, stdin := n.Wrap(inner)
	return client.Run(ctx, cmd, stdin, timeout)
}

func (n *Node) Run(inner string, timeout time.Duration) (sshx.Result, error) {
	ctx := n.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return n.RunCtx(ctx, inner, timeout)
}

func (n *Node) OutputCtx(ctx context.Context, inner string, timeout time.Duration) (string, error) {
	res, err := n.RunCtx(ctx, inner, timeout)
	if err != nil {
		return "", err
	}
	out := strings.TrimSpace(res.Stdout)
	if res.ExitCode != 0 {
		msg := strings.TrimSpace(res.Stderr)
		if msg == "" {
			msg = out
		}
		if msg == "" {
			msg = fmt.Sprintf("命令退出码 %d", res.ExitCode)
		}
		return out, fmt.Errorf("%s", msg)
	}
	return out, nil
}

func (n *Node) Output(inner string, timeout time.Duration) (string, error) {
	return n.OutputCtx(context.Background(), inner, timeout)
}

func (n *Node) run() {
	for {
		if n.ctx.Err() != nil {
			return
		}
		err := n.sample()
		if err != nil {
			n.setOffline(err)
			select {
			case <-n.ctx.Done():
				return
			case <-time.After(12 * time.Second):
			}
			continue
		}
		select {
		case <-n.ctx.Done():
			return
		case <-time.After(3 * time.Second):
		}
	}
}

func (n *Node) sample() error {
	res, err := n.RunCtx(n.ctx, metrics.Script(), 18*time.Second)
	if err != nil {
		return err
	}
	if res.ExitCode != 0 && strings.TrimSpace(res.Stdout) == "" {
		msg := strings.TrimSpace(res.Stderr)
		if msg == "" {
			msg = fmt.Sprintf("采集命令退出码 %d", res.ExitCode)
		}
		return fmt.Errorf("%s", msg)
	}
	snap := n.proc.Next(res.Stdout, time.Now())
	if snap.Hostname == "" && snap.MemTotal == 0 {
		return fmt.Errorf("无法读取 /proc 指标")
	}
	n.mu.Lock()
	n.latest = snap
	n.online = true
	n.errMsg = ""
	n.hist = append(n.hist, snap)
	if len(n.hist) > 120 {
		n.hist = append([]metrics.Snapshot(nil), n.hist[len(n.hist)-120:]...)
	}
	n.mu.Unlock()
	return nil
}

func (n *Node) setOffline(err error) {
	n.mu.Lock()
	n.online = false
	if err != nil {
		n.errMsg = err.Error()
	}
	n.mu.Unlock()
}

func (n *Node) View() View {
	n.mu.RLock()
	defer n.mu.RUnlock()
	hist := append([]metrics.Snapshot(nil), n.hist...)
	return View{
		Node:        n.cfg,
		HasPassword: n.cfg.Password != "",
		HasKey:      strings.TrimSpace(n.cfg.PrivateKey) != "",
		Online:      n.online,
		Error:       n.errMsg,
		Latest:      n.latest,
		History:     hist,
	}
}

func ValidContainerRef(s string) bool {
	return nameRe.MatchString(s)
}

func ValidStackName(s string) bool {
	return stackRe.MatchString(s)
}
