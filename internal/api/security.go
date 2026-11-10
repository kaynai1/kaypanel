package api

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"kaypanel/internal/node"
)

type secIssue struct {
	Level  string `json:"level"`
	Title  string `json:"title"`
	Detail string `json:"detail,omitempty"`
	Fix    string `json:"fix,omitempty"`
}

type secNode struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Addr         string     `json:"addr"`
	Online       bool       `json:"online"`
	SFTPOnly     bool       `json:"sftp_only"`
	Error        string     `json:"error,omitempty"`
	Score        int        `json:"score"`
	Grade        string     `json:"grade"`
	SSHPort      string     `json:"ssh_port,omitempty"`
	RootLogin    string     `json:"root_login,omitempty"`
	PasswordAuth string     `json:"password_auth,omitempty"`
	Firewall     string     `json:"firewall,omitempty"`
	PublicPorts  int        `json:"public_ports"`
	CertDays     int        `json:"cert_days"`
	Issues       []secIssue `json:"issues"`
}

type secReport struct {
	Time    int64          `json:"time"`
	Average int            `json:"average"`
	Grade   string         `json:"grade"`
	Total   int            `json:"total"`
	Online  int            `json:"online"`
	Counts  map[string]int `json:"counts"`
	Nodes   []secNode      `json:"nodes"`
}

const secScript = `
echo '@@@SEC_SSH'
if command -v sshd >/dev/null 2>&1; then
  sshd -T 2>/dev/null | grep -Ei '^(port|permitrootlogin|passwordauthentication|permitemptypasswords)[[:space:]]'
fi
grep -Ei '^[[:space:]]*(Port|PermitRootLogin|PasswordAuthentication|PermitEmptyPasswords)[[:space:]]' /etc/ssh/sshd_config 2>/dev/null
echo '@@@SEC_DOCKER'
docker ps --format '{{.Names}}|{{.Ports}}' 2>/dev/null | head -n 100
echo '@@@SEC_LISTEN'
(ss -tlnH 2>/dev/null || netstat -tln 2>/dev/null | tail -n +3) | awk '{print $4}' | head -n 200
echo '@@@SEC_UFW'
(ufw status 2>/dev/null || firewall-cmd --state 2>/dev/null || echo unknown) | head -n 3
echo '@@@SEC_CERT'
for f in /etc/letsencrypt/live/*/fullchain.pem; do
  [ -r "$f" ] || continue
  end=$(openssl x509 -enddate -noout -in "$f" 2>/dev/null | cut -d= -f2)
  [ -n "$end" ] && echo "$f|$end"
done
echo '@@@SEC_END'
`

var riskyPorts = map[string]string{
	"3306": "MySQL", "5432": "PostgreSQL", "6379": "Redis", "27017": "MongoDB",
	"9200": "Elasticsearch", "11211": "Memcached", "5672": "RabbitMQ",
}

func splitSections(out string, prefix string) map[string][]string {
	m := map[string][]string{}
	cur := ""
	for _, line := range strings.Split(out, "\n") {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, prefix) {
			cur = strings.TrimPrefix(trim, prefix)
			m[cur] = []string{}
			continue
		}
		if cur != "" {
			m[cur] = append(m[cur], line)
		}
	}
	return m
}

func levelPoints(level string) int {
	switch level {
	case "critical":
		return 30
	case "high":
		return 20
	case "medium":
		return 12
	case "low":
		return 5
	default:
		return 2
	}
}

func addSecIssue(it *secNode, level, title, detail, fix string, score *int) {
	it.Issues = append(it.Issues, secIssue{Level: level, Title: title, Detail: detail, Fix: fix})
	if score != nil {
		*score -= levelPoints(level)
	}
}

func securityOf(ctx context.Context, runner interface {
	OutputCtx(context.Context, string, time.Duration) (string, error)
}, id, name, addr string, online, sftp bool) secNode {
	it := secNode{ID: id, Name: name, Addr: addr, Online: online, SFTPOnly: sftp, Issues: []secIssue{}}
	if sftp {
		it.Grade = "不扫描"
		it.Issues = append(it.Issues, secIssue{Level: "info", Title: "虚拟主机节点不做安全检查"})
		return it
	}
	if !online {
		it.Grade = "离线"
		it.Issues = append(it.Issues, secIssue{Level: "critical", Title: "节点离线", Detail: "无法连接，安全检查未执行"})
		return it
	}
	out, err := runner.OutputCtx(ctx, secScript, 25*time.Second)
	if err != nil && strings.TrimSpace(out) == "" {
		it.Grade = "扫描失败"
		it.Error = trimIssue(err.Error())
		it.Issues = append(it.Issues, secIssue{Level: "low", Title: "无法完成扫描", Detail: trimIssue(err.Error()), Fix: "确认节点在线，并在节点设置中按需开启 sudo"})
		return it
	}
	sec := splitSections(out, "@@@SEC_")
	score := 100
	sshPorts := map[string]bool{}
	rootLogin, passAuth, emptyPass := "", "", ""
	for _, line := range sec["SSH"] {
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		key := strings.ToLower(f[0])
		val := strings.ToLower(strings.TrimSpace(f[1]))
		switch key {
		case "port":
			sshPorts[val] = true
		case "permitrootlogin":
			rootLogin = val
		case "passwordauthentication":
			passAuth = val
		case "permitemptypasswords":
			emptyPass = val
		}
	}
	var portList []string
	for p := range sshPorts {
		portList = append(portList, p)
	}
	sort.Strings(portList)
	it.SSHPort = strings.Join(portList, ",")
	it.RootLogin = rootLogin
	it.PasswordAuth = passAuth
	if emptyPass == "yes" {
		addSecIssue(&it, "critical", "SSH 允许空密码登录", "PermitEmptyPasswords yes", "改为 PermitEmptyPasswords no", &score)
	}
	switch rootLogin {
	case "yes", "true":
		addSecIssue(&it, "high", "允许 root 直接登录 SSH", "PermitRootLogin "+rootLogin, "改为 PermitRootLogin no，并使用普通用户 + sudo", &score)
	case "prohibit-password", "without-password", "forced-commands-only":
		addSecIssue(&it, "info", "root 仅允许密钥登录", "PermitRootLogin "+rootLogin, "", nil)
	}
	if passAuth == "yes" || passAuth == "true" {
		addSecIssue(&it, "medium", "SSH 开启了密码登录", "PasswordAuthentication yes", "关闭密码登录，统一使用密钥", &score)
	}
	if len(portList) > 0 {
		only22 := true
		for p := range sshPorts {
			if p != "22" {
				only22 = false
			}
		}
		if only22 {
			addSecIssue(&it, "low", "SSH 使用默认端口 22", "公网扫描器会持续尝试登录", "改用非默认端口，或在防火墙层限制来源 IP", &score)
		}
	}

	fw := "unknown"
	ufwOut := strings.ToLower(strings.Join(sec["UFW"], " "))
	switch {
	case strings.Contains(ufwOut, "status: active"), strings.Contains(ufwOut, "running"), strings.Contains(ufwOut, "enabled"):
		fw = "active"
	case strings.Contains(ufwOut, "inactive"), strings.Contains(ufwOut, "not running"), strings.Contains(ufwOut, "disabled"):
		fw = "inactive"
		addSecIssue(&it, "medium", "防火墙未启用", "未检测到 ufw/firewalld 处于运行状态", "启用 ufw 或 firewalld，仅放行业务端口", &score)
	case strings.Contains(ufwOut, "root"):
		addSecIssue(&it, "low", "无法确认防火墙状态", "读取防火墙状态需要 root 权限", "在节点设置中开启 sudo 后重新体检", &score)
	}
	it.Firewall = fw

	publicDocker := map[string]bool{}
	portRe := func(ports string) string {
		best := ""
		for _, part := range strings.Split(ports, ",") {
			part = strings.TrimSpace(part)
			if !strings.Contains(part, "->") {
				continue
			}
			left := strings.SplitN(part, "->", 2)[0]
			host := left
			port := ""
			if i := strings.LastIndex(left, ":"); i >= 0 {
				host = left[:i]
				port = left[i+1:]
			}
			pub := host == "0.0.0.0" || host == "[::]" || host == "::" || host == ""
			if pub && port != "" {
				best = port
				if riskyPorts[port] != "" {
					return port
				}
			}
		}
		return best
	}
	for _, line := range sec["DOCKER"] {
		_, ports, ok := strings.Cut(line, "|")
		if !ok {
			continue
		}
		if p := portRe(ports); p != "" {
			publicDocker[p] = true
		}
	}
	listenPublic := map[string]bool{}
	for _, line := range sec["LISTEN"] {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		host, port := "", ""
		if i := strings.LastIndex(line, ":"); i >= 0 {
			host = line[:i]
			port = line[i+1:]
		}
		if host == "0.0.0.0" || host == "[::]" || host == "::" || host == "*" {
			if _, err := strconv.Atoi(port); err == nil {
				listenPublic[port] = true
			}
		}
	}
	var risky []string
	for p := range publicDocker {
		it.PublicPorts++
		if riskyPorts[p] != "" {
			risky = append(risky, riskyPorts[p]+":"+p)
		}
	}
	for p := range listenPublic {
		if p == "22" {
			continue
		}
		if riskyPorts[p] != "" {
			name := riskyPorts[p] + ":" + p
			dup := false
			for _, r := range risky {
				if r == name {
					dup = true
				}
			}
			if !dup {
				risky = append(risky, name)
			}
		}
	}
	sort.Strings(risky)
	if len(risky) > 0 {
		addSecIssue(&it, "high", "数据库/中间件端口对所有网卡开放", strings.Join(risky, "、"), "通过防火墙限制来源，或改为只监听 127.0.0.1", &score)
	}
	if it.PublicPorts > 0 {
		addSecIssue(&it, "medium", fmt.Sprintf("%d 个容器端口映射到所有网卡", it.PublicPorts), "0.0.0.0 映射会直接暴露在公网", "对外服务前置反向代理，其余改为 127.0.0.1:端口", &score)
	}

	minDays := 0
	certFile := ""
	for _, line := range sec["CERT"] {
		f, end, ok := strings.Cut(strings.TrimSpace(line), "|")
		if !ok {
			continue
		}
		end = strings.Join(strings.Fields(end), " ")
		t, err := time.Parse("Jan 2 15:04:05 2006 MST", end)
		if err != nil {
			continue
		}
		days := int(time.Until(t).Hours() / 24)
		if minDays == 0 || days < minDays {
			minDays = days
			certFile = f
		}
	}
	it.CertDays = minDays
	if certFile != "" {
		switch {
		case minDays < 0:
			addSecIssue(&it, "critical", "TLS 证书已过期", certFile, "立即续期证书", &score)
		case minDays < 7:
			addSecIssue(&it, "critical", fmt.Sprintf("TLS 证书 %d 天后过期", minDays), certFile, "立即续期证书", &score)
		case minDays < 30:
			addSecIssue(&it, "high", fmt.Sprintf("TLS 证书 %d 天后过期", minDays), certFile, "尽快续期证书", &score)
		}
	}
	if score < 0 {
		score = 0
	}
	it.Score = score
	it.Grade = gradeOf(score)
	return it
}

func (s *Server) handleSecurity(w http.ResponseWriter, r *http.Request) {
	views := s.mgr.Views()
	report := secReport{
		Time:   time.Now().Unix(),
		Total:  len(views),
		Counts: map[string]int{},
		Nodes:  make([]secNode, len(views)),
	}
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for i, v := range views {
		n, ok := s.mgr.Get(v.ID)
		if !ok {
			continue
		}
		if v.Online {
			report.Online++
		}
		wg.Add(1)
		go func(i int, n *node.Node, v node.View) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			report.Nodes[i] = securityOf(r.Context(), n, v.ID, v.Name, v.Addr, v.Online, v.SFTPOnly)
		}(i, n, v)
	}
	wg.Wait()
	total, count := 0, 0
	for _, it := range report.Nodes {
		report.Counts[it.Grade]++
		if it.SFTPOnly {
			continue
		}
		total += it.Score
		count++
	}
	if count > 0 {
		report.Average = total / count
		report.Grade = gradeOf(report.Average)
	} else {
		report.Grade = "—"
	}
	writeJSON(w, http.StatusOK, report)
}
