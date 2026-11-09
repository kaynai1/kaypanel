package api

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/crypto/ssh"
)

type sshCandidate struct {
	Name         string `json:"name"`
	Host         string `json:"host"`
	Port         int    `json:"port"`
	User         string `json:"user"`
	KeyPath      string `json:"key_path,omitempty"`
	KeyEncrypted bool   `json:"key_encrypted,omitempty"`
	Note         string `json:"note,omitempty"`
	Source       string `json:"source"`
}

type localKey struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	Encrypted bool   `json:"encrypted"`
}

type sshDefaults struct {
	user string
	port int
	keys []string
}

type sshHostBlock struct {
	alias string
	host  string
	user  string
	port  int
	keys  []string
	skip  bool
	proxy bool
}

func sshDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".ssh"), nil
}

func (s *Server) handleSSHDiscover(w http.ResponseWriter, r *http.Request) {
	dir, err := sshDir()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "无法定位本机用户目录")
		return
	}
	cfgPath := filepath.Join(dir, "config")
	khPath := filepath.Join(dir, "known_hosts")

	seen := map[string]bool{}
	var cands []sshCandidate
	cfgFound := parseSSHConfig(cfgPath, 0, &cands, seen)
	known, khFound := parseKnownHosts(khPath, seen)
	cands = append(cands, known...)

	keys := scanLocalKeys(dir, cands)
	keyByPath := make(map[string]localKey, len(keys))
	for _, k := range keys {
		keyByPath[k.Path] = k
	}
	for i := range cands {
		if cands[i].KeyPath == "" {
			continue
		}
		if k, ok := keyByPath[cands[i].KeyPath]; ok {
			cands[i].KeyEncrypted = k.Encrypted
			continue
		}
		if !pathInside(dir, cands[i].KeyPath) {
			cands[i].Note = "私钥不在 ~/.ssh 目录内，请手动粘贴"
		} else if cands[i].Note == "" {
			cands[i].Note = "私钥不可用，请手动选择或粘贴"
		}
		cands[i].KeyPath = ""
	}

	if len(cands) > 60 {
		cands = cands[:60]
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ssh_dir":           dir,
		"config_found":      cfgFound,
		"known_hosts_found": khFound,
		"candidates":        cands,
		"keys":              keys,
	})
}

func parseSSHConfig(path string, depth int, out *[]sshCandidate, seen map[string]bool) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()

	var def sshDefaults
	var cur *sshHostBlock

	flush := func() {
		if cur == nil {
			return
		}
		b := *cur
		cur = nil
		if b.skip || b.alias == "" {
			return
		}
		host := strings.TrimSpace(b.host)
		if host == "" {
			host = b.alias
		}
		user := b.user
		if user == "" {
			user = def.user
		}
		port := b.port
		if port == 0 {
			port = def.port
		}
		if port == 0 {
			port = 22
		}
		keys := b.keys
		if len(keys) == 0 {
			keys = def.keys
		}
		key := "a|" + b.alias + "|" + host + "|" + strconv.Itoa(port)
		if seen[key] {
			return
		}
		seen[key] = true
		seen["h|"+host+"|"+strconv.Itoa(port)] = true
		c := sshCandidate{
			Name:   b.alias,
			Host:   host,
			Port:   port,
			User:   user,
			Source: "config",
		}
		if len(keys) > 0 {
			c.KeyPath = keys[0]
		}
		if b.proxy {
			c.Note = "需要跳板机，面板暂不支持直连"
		}
		*out = append(*out, c)
	}

	sc := bufio.NewScanner(io.LimitReader(f, 1<<20))
	sc.Buffer(make([]byte, 64*1024), 256*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val := splitDirective(line)
		if key == "" {
			continue
		}
		switch key {
		case "host":
			flush()
			cur = &sshHostBlock{}
			aliases := strings.Fields(val)
			if len(aliases) == 0 {
				cur.skip = true
			}
			for _, a := range aliases {
				a = trimQuotes(a)
				if a == "" || strings.ContainsAny(a, "*?!") {
					cur.skip = true
					continue
				}
				if cur.alias == "" {
					cur.alias = a
				}
			}
		case "match":
			if cur != nil {
				cur.skip = true
			}
		case "hostname":
			if cur != nil {
				cur.host = trimQuotes(val)
			}
		case "user":
			if cur != nil {
				cur.user = trimQuotes(val)
			} else {
				def.user = trimQuotes(val)
			}
		case "port":
			p, err := strconv.Atoi(strings.TrimSpace(val))
			if err != nil || p < 1 || p > 65535 {
				continue
			}
			if cur != nil {
				cur.port = p
			} else {
				def.port = p
			}
		case "identityfile":
			p := expandSSHPath(val)
			if p == "" {
				continue
			}
			if cur != nil {
				cur.keys = append(cur.keys, p)
			} else {
				def.keys = append(def.keys, p)
			}
		case "proxyjump", "proxycommand":
			if cur != nil {
				cur.proxy = true
			}
		case "include":
			if depth >= 2 {
				continue
			}
			for _, inc := range expandInclude(val) {
				parseSSHConfig(inc, depth+1, out, seen)
			}
		}
	}
	flush()
	return true
}

func parseKnownHosts(path string, seen map[string]bool) ([]sshCandidate, bool) {
	f, err := os.Open(path)
	if err != nil {
		return nil, false
	}
	defer f.Close()

	var out []sshCandidate
	sc := bufio.NewScanner(io.LimitReader(f, 2<<20))
	sc.Buffer(make([]byte, 64*1024), 256*1024)
	for sc.Scan() && len(out) < 40 {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "@") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) == 0 || strings.HasPrefix(fields[0], "|") {
			continue
		}
		for _, part := range strings.Split(fields[0], ",") {
			host, port := knownHostAddr(part)
			if host == "" || strings.ContainsAny(host, "*?!") {
				continue
			}
			k := strconv.Itoa(port)
			if seen["h|"+host+"|"+k] || seen["k|"+host+"|"+k] {
				continue
			}
			seen["k|"+host+"|"+k] = true
			out = append(out, sshCandidate{
				Name:   host,
				Host:   host,
				Port:   port,
				Source: "known_hosts",
				Note:   "来自 known_hosts，请补充用户名",
			})
		}
	}
	return out, true
}

func knownHostAddr(s string) (string, int) {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "[") {
		if i := strings.LastIndex(s, "]:"); i > 0 {
			port, err := strconv.Atoi(s[i+2:])
			if err == nil && port > 0 && port < 65536 {
				return s[1:i], port
			}
		}
		return strings.Trim(s, "[]"), 22
	}
	return s, 22
}

func splitDirective(line string) (string, string) {
	line = strings.TrimSpace(line)
	if i := strings.IndexAny(line, " \t"); i > 0 {
		return strings.ToLower(line[:i]), stripComment(line[i+1:])
	}
	if i := strings.Index(line, "="); i > 0 {
		return strings.ToLower(strings.TrimSpace(line[:i])), stripComment(line[i+1:])
	}
	return strings.ToLower(line), ""
}

func stripComment(v string) string {
	v = strings.TrimSpace(v)
	for i := 1; i < len(v); i++ {
		if v[i] == '#' && (v[i-1] == ' ' || v[i-1] == '\t') {
			return strings.TrimSpace(v[:i])
		}
	}
	return v
}

func trimQuotes(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 && ((s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'')) {
		return s[1 : len(s)-1]
	}
	return s
}

func expandSSHPath(p string) string {
	p = trimQuotes(p)
	if p == "" {
		return ""
	}
	if p == "~" || strings.HasPrefix(p, "~/") || strings.HasPrefix(p, `~\`) {
		if home, err := os.UserHomeDir(); err == nil {
			p = home + p[1:]
		}
	}
	if !filepath.IsAbs(p) {
		if abs, err := filepath.Abs(p); err == nil {
			p = abs
		}
	}
	return filepath.Clean(p)
}

func expandInclude(v string) []string {
	v = trimQuotes(stripComment(v))
	if v == "" {
		return nil
	}
	if strings.HasPrefix(v, "~") {
		if home, err := os.UserHomeDir(); err == nil {
			v = home + v[1:]
		}
	}
	matches, _ := filepath.Glob(v)
	if len(matches) == 0 {
		return nil
	}
	if len(matches) > 8 {
		matches = matches[:8]
	}
	return matches
}

func scanLocalKeys(dir string, cands []sshCandidate) []localKey {
	paths := map[string]bool{}
	order := []string{}
	add := func(p string) {
		if p == "" || paths[p] {
			return
		}
		paths[p] = true
		order = append(order, p)
	}
	for _, name := range []string{"id_ed25519", "id_ecdsa", "id_rsa", "id_dsa"} {
		add(filepath.Join(dir, name))
	}
	for _, c := range cands {
		add(c.KeyPath)
	}
	if entries, err := os.ReadDir(dir); err == nil {
		for _, e := range entries {
			if e.IsDir() || len(paths) >= 40 {
				continue
			}
			name := e.Name()
			lower := strings.ToLower(name)
			if strings.HasSuffix(lower, ".pub") || strings.HasPrefix(lower, "known_hosts") ||
				strings.HasPrefix(lower, "config") || lower == "authorized_keys" ||
				lower == "agent.env" || strings.HasPrefix(lower, ".") {
				continue
			}
			add(filepath.Join(dir, name))
		}
	}

	var out []localKey
	for _, p := range order {
		if !pathInside(dir, p) {
			continue
		}
		info, err := os.Stat(p)
		if err != nil || !info.Mode().IsRegular() || info.Size() > 1<<20 {
			continue
		}
		enc, ok := inspectKey(p)
		if !ok {
			continue
		}
		out = append(out, localKey{Name: filepath.Base(p), Path: p, Encrypted: enc})
		if len(out) >= 20 {
			break
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return keyRank(out[i].Name) < keyRank(out[j].Name)
	})
	return out
}

func keyRank(name string) int {
	switch name {
	case "id_ed25519":
		return 0
	case "id_ecdsa":
		return 1
	case "id_rsa":
		return 2
	case "id_dsa":
		return 3
	}
	return 10
}

func inspectKey(path string) (encrypted bool, ok bool) {
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 || bytes.IndexByte(b, 0) >= 0 {
		return false, false
	}
	if !bytes.Contains(b, []byte("PRIVATE KEY")) {
		return false, false
	}
	if bytes.Contains(b, []byte("ENCRYPTED")) {
		return true, true
	}
	_, err = ssh.ParsePrivateKey(b)
	var pme *ssh.PassphraseMissingError
	if errors.As(err, &pme) {
		return true, true
	}
	return false, true
}

func pathInside(base, path string) bool {
	rb, err := filepath.EvalSymlinks(base)
	if err != nil {
		rb = base
	}
	rp, err := filepath.EvalSymlinks(path)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(rb, rp)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}

func readLocalKey(path string) (string, error) {
	dir, err := sshDir()
	if err != nil {
		return "", fmt.Errorf("无法定位本机用户目录")
	}
	if !pathInside(dir, path) {
		return "", fmt.Errorf("仅支持导入 ~/.ssh 目录内的私钥")
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("私钥文件不存在")
	}
	if !info.Mode().IsRegular() || info.Size() > 1<<20 {
		return "", fmt.Errorf("私钥文件无效或过大")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("读取私钥失败: %w", err)
	}
	content := strings.ReplaceAll(string(b), "\r\n", "\n")
	if _, err := ssh.ParsePrivateKey([]byte(content)); err != nil {
		var pme *ssh.PassphraseMissingError
		if errors.As(err, &pme) {
			return "", fmt.Errorf("该私钥有口令保护，面板暂不支持，请使用无口令私钥")
		}
		return "", fmt.Errorf("私钥解析失败: %w", err)
	}
	return content, nil
}
