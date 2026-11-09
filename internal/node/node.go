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
	"kaypanel/internal/instabox"
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
	HasPassword bool               `json:"has_password"`
	HasKey      bool               `json:"has_key"`
	HasIBKey    bool               `json:"has_instabox_key"`
	Online      bool               `json:"online"`
	Waking      bool               `json:"waking"`
	Error       string             `json:"error"`
	Latest      metrics.Snapshot   `json:"latest"`
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

type Event struct {
	Time     int64            `json:"time"`
	Level    string           `json:"level"`
	Title    string           `json:"title"`
	Detail   string           `json:"detail,omitempty"`
	Snapshot metrics.Snapshot `json:"snapshot"`
}

type Node struct {
	mu     sync.RWMutex
	cfg    config.Node
	client *sshx.Client
	store  *config.Store
	ctx    context.Context
	cancel context.CancelFunc

	online bool
	waking bool
	errMsg string
	latest metrics.Snapshot
	hist   []metrics.Snapshot
	trend  []metrics.Snapshot
	events []Event
	proc   metrics.Processor

	lastTrend  time.Time
	lastEvent  map[string]time.Time
	lastWake   time.Time
	lastLease  time.Time
}

type Manager struct {
	store *config.Store
	dir   string

	histCtx    context.Context
	histCancel context.CancelFunc

	mu    sync.RWMutex
	nodes map[string]*Node
	order []string
}

func NewManager(store *config.Store, dataDir string) *Manager {
	return &Manager{store: store, dir: dataDir, nodes: map[string]*Node{}}
}

func (m *Manager) Start() {
	hist, trends, events := m.loadHistory()
	for _, cfg := range m.store.Nodes() {
		m.startNode(cfg, hist[cfg.ID], trends[cfg.ID], events[cfg.ID])
	}
	m.histCtx, m.histCancel = context.WithCancel(context.Background())
	go m.historyLoop(m.histCtx)
}

func (m *Manager) Stop() {
	if m.histCancel != nil {
		m.histCancel()
	}
	m.saveHistory()
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, n := range m.nodes {
		n.cancel()
		n.closeClient()
	}
}

func (m *Manager) startNode(cfg config.Node, hist, trend []metrics.Snapshot, events []Event) {
	ctx, cancel := context.WithCancel(context.Background())
	n := &Node{
		cfg:       cfg,
		ctx:       ctx,
		cancel:    cancel,
		store:     m.store,
		hist:      capHistory(hist),
		trend:     capTrend(trend),
		events:    capEvents(events),
		lastEvent: map[string]time.Time{},
	}
	if len(n.trend) > 0 {
		n.lastTrend = time.Unix(n.trend[len(n.trend)-1].Time, 0)
	}
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
	m.startNode(c, nil, nil, nil)
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
	if patch.IBAPIKey == "" {
		patch.IBAPIKey = old.IBAPIKey
	}
	if patch.SudoPassword == "" {
		patch.SudoPassword = old.SudoPassword
	}
	if patch.HostKey == "" && patch.Addr == old.Addr {
		patch.HostKey = old.HostKey
	}
	if patch.SkipHostKey {
		patch.HostKey = ""
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
	if err := m.persist(); err != nil {
		return err
	}
	m.saveHistory()
	return nil
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
	if cfg.SFTPOnly {
		sf, err := client.SFTP()
		if err != nil {
			tr.Error = err.Error()
			return tr
		}
		root := cfg.FileRoot
		if root == "" {
			root = "/"
		}
		if _, err := sf.Stat(root); err != nil {
			tr.Error = fmt.Sprintf("SFTP 登录成功，但无法访问根目录 %s: %v", root, err)
			return tr
		}
		tr.OK = true
		tr.Docker = "虚拟主机不支持"
		return tr
	}
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
	c.IBAPIKey = strings.TrimSpace(c.IBAPIKey)
	c.IBMachineID = strings.TrimSpace(c.IBMachineID)
	if c.AutoWake {
		if c.IBMachineID == "" {
			return c, fmt.Errorf("自动唤醒需要填写 Instabox 机器 ID")
		}
		if c.IBAPIKey == "" {
			return c, fmt.Errorf("自动唤醒需要填写 Instabox API Key")
		}
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
		SkipHostKey:  c.SkipHostKey,
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
		n.cfg.HostKey != c.HostKey || n.cfg.SkipHostKey != c.SkipHostKey ||
		n.cfg.Sudo != c.Sudo || n.cfg.SudoPassword != c.SudoPassword
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
		if n.Config().SFTPOnly {
			err := n.sftpProbe()
			wait := 30 * time.Second
			if err != nil {
				n.setOffline(err)
				wait = 12 * time.Second
			} else {
				n.markOnline()
			}
			select {
			case <-n.ctx.Done():
				return
			case <-time.After(wait):
			}
			continue
		}
		err := n.sample()
		if err != nil {
			if attempted, werr := n.tryWake(); attempted {
				if werr != nil {
					err = fmt.Errorf("%s；自动唤醒失败: %v", err, werr)
				} else if serr := n.sample(); serr == nil {
					err = nil
				} else {
					err = serr
				}
			}
		}
		wait := 3 * time.Second
		if err != nil {
			n.setOffline(err)
			wait = 12 * time.Second
		} else {
			n.maybeLease()
		}
		select {
		case <-n.ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

func (n *Node) sftpProbe() error {
	client, err := n.Client()
	if err != nil {
		return err
	}
	sf, err := client.SFTP()
	if err != nil {
		client.Close()
		return err
	}
	root := n.Config().FileRoot
	if root == "" {
		root = "/"
	}
	if _, err := sf.Stat(root); err != nil {
		client.Close()
		return fmt.Errorf("无法访问根目录 %s: %v", root, err)
	}
	return nil
}

func (n *Node) markOnline() {
	n.mu.Lock()
	wasOnline := n.online
	n.online = true
	n.errMsg = ""
	if !wasOnline {
		title := "节点上线"
		if len(n.events) > 0 {
			title = "节点恢复在线"
		}
		n.eventLocked("info", title, "", n.latest, 0)
	}
	n.mu.Unlock()
}

func (n *Node) tryWake() (bool, error) {
	cfg := n.Config()
	if !cfg.AutoWake || cfg.IBAPIKey == "" || cfg.IBMachineID == "" {
		return false, nil
	}
	if time.Since(n.lastWake) < 2*time.Minute {
		return false, nil
	}
	n.lastWake = time.Now()
	n.setWaking(true)
	defer n.setWaking(false)
	ctx, cancel := context.WithTimeout(n.ctx, 60*time.Second)
	defer cancel()
	if err := instabox.Wake(ctx, cfg.IBAPIKey, cfg.IBMachineID); err != nil {
		return true, err
	}
	return true, nil
}

func (n *Node) maybeLease() {
	cfg := n.Config()
	if !cfg.AutoWake || cfg.IBAPIKey == "" || cfg.IBMachineID == "" {
		return
	}
	if !n.lastLease.IsZero() && time.Since(n.lastLease) < 5*time.Minute {
		return
	}
	n.lastLease = time.Now()
	ctx, cancel := context.WithTimeout(n.ctx, 15*time.Second)
	defer cancel()
	_ = instabox.Lease(ctx, cfg.IBAPIKey, cfg.IBMachineID, "kaypanel-"+cfg.ID, 900)
}

func (n *Node) setWaking(v bool) {
	n.mu.Lock()
	n.waking = v
	n.mu.Unlock()
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
	set := n.store.Settings()
	n.mu.Lock()
	prev := n.latest
	wasOnline := n.online
	n.latest = snap
	n.online = true
	n.errMsg = ""
	n.hist = append(n.hist, snap)
	if len(n.hist) > 120 {
		n.hist = append([]metrics.Snapshot(nil), n.hist[len(n.hist)-120:]...)
	}
	n.detectEventsLocked(prev, wasOnline, snap, set)
	n.appendTrendLocked(snap)
	n.mu.Unlock()
	return nil
}

func (n *Node) setOffline(err error) {
	n.mu.Lock()
	wasOnline := n.online
	n.online = false
	msg := ""
	if err != nil {
		n.errMsg = err.Error()
		msg = n.errMsg
	}
	if wasOnline {
		n.eventLocked("error", "节点离线", msg, n.latest, 0)
	}
	n.mu.Unlock()
}

func alertThreshold(v int) int {
	if v <= 0 || v > 100 {
		return 90
	}
	return v
}

func nodePct(used, total uint64) float64 {
	if total == 0 {
		return 0
	}
	return float64(used) / float64(total) * 100
}

func (n *Node) detectEventsLocked(prev metrics.Snapshot, wasOnline bool, snap metrics.Snapshot, set config.Settings) {
	if !wasOnline {
		title := "节点恢复在线"
		if prev.Time == 0 && len(n.events) == 0 {
			title = "节点上线"
		}
		n.eventLocked("info", title, "指标采集已恢复", snap, 0)
		return
	}
	cpuAlert := alertThreshold(set.CPUAlert)
	memAlert := alertThreshold(set.MemAlert)
	diskAlert := alertThreshold(set.DiskAlert)
	prevMem := nodePct(prev.MemUsed, prev.MemTotal)
	mem := nodePct(snap.MemUsed, snap.MemTotal)
	prevDisk := nodePct(prev.DiskUsed, prev.DiskTotal)
	disk := nodePct(snap.DiskUsed, snap.DiskTotal)
	if prev.CPU < float64(cpuAlert) && snap.CPU >= float64(cpuAlert) {
		n.eventLocked("warn", "CPU 冲高", fmt.Sprintf("CPU %.1f%%，超过阈值 %d%%", snap.CPU, cpuAlert), snap, 5*time.Minute)
	}
	if prevMem < float64(memAlert) && mem >= float64(memAlert) {
		n.eventLocked("warn", "内存吃紧", fmt.Sprintf("内存 %.1f%%，超过阈值 %d%%", mem, memAlert), snap, 5*time.Minute)
	}
	if prevDisk < float64(diskAlert) && disk >= float64(diskAlert) {
		n.eventLocked("warn", "磁盘告急", fmt.Sprintf("磁盘 %.1f%%，超过阈值 %d%%", disk, diskAlert), snap, 10*time.Minute)
	}
	if prev.Temp < 85 && snap.Temp >= 85 {
		n.eventLocked("warn", "温度过高", fmt.Sprintf("%.0f°C", snap.Temp), snap, 10*time.Minute)
	}
	prevStopped := 0
	if prev.DockerTotal > 0 {
		prevStopped = prev.DockerTotal - prev.DockerRunning
	}
	stopped := 0
	if snap.DockerTotal > 0 {
		stopped = snap.DockerTotal - snap.DockerRunning
	}
	if stopped > prevStopped {
		n.eventLocked("warn", "容器退出", fmt.Sprintf("%d 个容器未运行（共 %d 个）", stopped, snap.DockerTotal), snap, 10*time.Minute)
	}
}

func (n *Node) eventLocked(level, title, detail string, snap metrics.Snapshot, cooldown time.Duration) {
	now := time.Now()
	if cooldown > 0 {
		if last, ok := n.lastEvent[title]; ok && now.Sub(last) < cooldown {
			return
		}
	}
	if n.lastEvent == nil {
		n.lastEvent = map[string]time.Time{}
	}
	n.lastEvent[title] = now
	n.events = append(n.events, Event{
		Time:     now.Unix(),
		Level:    level,
		Title:    title,
		Detail:   detail,
		Snapshot: snap,
	})
	if len(n.events) > 200 {
		n.events = append([]Event(nil), n.events[len(n.events)-200:]...)
	}
}

func (n *Node) appendTrendLocked(snap metrics.Snapshot) {
	t := time.Unix(snap.Time, 0)
	if snap.Time == 0 {
		t = time.Now()
	}
	if !n.lastTrend.IsZero() && t.Sub(n.lastTrend) < 5*time.Minute {
		return
	}
	n.lastTrend = t
	n.trend = append(n.trend, snap)
	if len(n.trend) > 2016 {
		n.trend = append([]metrics.Snapshot(nil), n.trend[len(n.trend)-2016:]...)
	}
}

func (n *Node) Trend() []metrics.Snapshot {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return append([]metrics.Snapshot(nil), n.trend...)
}

func (n *Node) Events() []Event {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return append([]Event(nil), n.events...)
}

func (n *Node) View() View {
	n.mu.RLock()
	defer n.mu.RUnlock()
	hist := append([]metrics.Snapshot(nil), n.hist...)
	return View{
		Node:        n.cfg,
		HasPassword: n.cfg.Password != "",
		HasKey:      strings.TrimSpace(n.cfg.PrivateKey) != "",
		HasIBKey:    n.cfg.IBAPIKey != "",
		Online:      n.online,
		Waking:      n.waking,
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
