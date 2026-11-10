package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"kaypanel/internal/audit"
	"kaypanel/internal/changes"
	"kaypanel/internal/config"
	"kaypanel/internal/insight"
	"kaypanel/internal/instabox"
	"kaypanel/internal/metrics"
	"kaypanel/internal/node"
	"kaypanel/internal/probe"
)

const sessionCookie = "kp_session"

type Server struct {
	store    *config.Store
	mgr      *node.Manager
	audit    *audit.Log
	web      http.FileSystem
	version  string
	sessions *sessions
	limiter  *loginLimiter
	probes   *probe.Manager
	changes  *changes.Manager
	insights *insight.Store

	wrapMu sync.Mutex
	updMu  sync.Mutex

	updCache   updateInfo
	updCacheAt time.Time

	desktopToken string
}

func New(store *config.Store, mgr *node.Manager, auditLog *audit.Log, web http.FileSystem, version string, probes *probe.Manager, changeLog *changes.Manager, insights *insight.Store) *Server {
	return &Server{
		store:    store,
		mgr:      mgr,
		audit:    auditLog,
		web:      web,
		version:  version,
		sessions: newSessions(store.SessionSecret()),
		limiter:  newLoginLimiter(),
		probes:   probes,
		changes:  changeLog,
		insights: insights,
	}
}

func (s *Server) EnableDesktop(token string) {
	s.desktopToken = token
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("GET /api/desktop/login", s.handleDesktopLogin)
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.Handle("POST /api/logout", s.auth(s.handleLogout))
	mux.Handle("GET /api/me", s.auth(s.handleMe))
	mux.Handle("POST /api/password", s.auth(s.handlePassword))
	mux.Handle("GET /api/settings", s.auth(s.handleGetSettings))
	mux.Handle("PUT /api/settings", s.auth(s.handleSetSettings))
	mux.Handle("POST /api/notify/test", s.auth(s.handleNotifyTest))
	mux.Handle("POST /api/ai/chat", s.auth(s.handleAIChat))
	mux.Handle("POST /api/ai/models", s.auth(s.handleAIModels))
	mux.Handle("POST /api/ai/action", s.auth(s.handleAIAction))
	mux.Handle("POST /api/ai/stack", s.auth(s.handleAIStack))
	mux.Handle("GET /api/inspect", s.auth(s.handleInspect))
	mux.Handle("GET /api/personality", s.auth(s.handlePersonality))
	mux.Handle("GET /api/events", s.auth(s.handleEvents))
	mux.Handle("GET /api/audit", s.auth(s.handleAudit))
	mux.Handle("GET /api/overview", s.auth(s.handleOverview))
	mux.Handle("GET /api/templates", s.auth(s.handleTemplates))

	mux.Handle("GET /api/security", s.auth(s.handleSecurity))
	mux.Handle("GET /api/cost", s.auth(s.handleCost))
	mux.Handle("POST /api/cost/price", s.auth(s.handleCostPrice))
	mux.Handle("POST /api/nodes/{id}/power", s.auth(s.handleNodePower))
	mux.Handle("GET /api/netmatrix", s.auth(s.handleNetMatrix))
	mux.Handle("GET /api/drift", s.auth(s.handleDrift))
	mux.Handle("GET /api/probes", s.auth(s.handleProbes))
	mux.Handle("POST /api/probes", s.auth(s.handleProbeAdd))
	mux.Handle("DELETE /api/probes/{id}", s.auth(s.handleProbeDelete))
	mux.Handle("POST /api/probes/{id}/check", s.auth(s.handleProbeCheck))
	mux.Handle("GET /api/changes", s.auth(s.handleChanges))
	mux.Handle("GET /api/changes/{id}", s.auth(s.handleChangeGet))
	mux.Handle("POST /api/changes/{id}/rollback", s.auth(s.handleChangeRollback))
	mux.Handle("POST /api/batch/exec", s.auth(s.handleBatchExec))
	mux.Handle("POST /api/batch/update", s.auth(s.handleBatchUpdate))
	mux.Handle("POST /api/batch/upload", s.auth(s.handleBatchUpload))

	mux.Handle("GET /api/broadcast", s.auth(s.handleBroadcastList))
	mux.Handle("POST /api/broadcast", s.auth(s.handleBroadcastGenerate))
	mux.Handle("GET /api/drill", s.auth(s.handleDrillList))
	mux.Handle("POST /api/drill/eval", s.auth(s.handleDrillEval))
	mux.Handle("GET /api/rootcause", s.auth(s.handleRootCause))
	mux.Handle("POST /api/rootcause/ai", s.auth(s.handleRootCauseAI))
	mux.Handle("POST /api/query", s.auth(s.handleQuery))
	mux.Handle("GET /api/wrapped", s.auth(s.handleWrapped))
	mux.Handle("GET /api/update/check", s.auth(s.handleUpdateCheck))
	mux.Handle("POST /api/update/download", s.auth(s.handleUpdateDownload))
	mux.Handle("POST /api/update/install", s.auth(s.handleUpdateInstall))

	mux.HandleFunc("GET /api/status", s.handlePublicStatusAPI)
	mux.HandleFunc("GET /status", s.handlePublicStatusPage)

	mux.Handle("GET /api/ssh/discover", s.auth(s.handleSSHDiscover))
	mux.Handle("GET /api/nodes", s.auth(s.handleNodes))
	mux.Handle("POST /api/nodes", s.auth(s.handleNodeAdd))
	mux.Handle("PUT /api/nodes/{id}", s.auth(s.handleNodeUpdate))
	mux.Handle("DELETE /api/nodes/{id}", s.auth(s.handleNodeDelete))
	mux.Handle("POST /api/nodes/{id}/test", s.auth(s.handleNodeTest))
	mux.Handle("POST /api/instabox/machines", s.auth(s.handleInstaboxMachines))
	mux.Handle("GET /api/nodes/{id}/processes", s.auth(s.handleProcesses))

	mux.Handle("GET /api/nodes/{id}/containers", s.auth(s.handleContainers))
	mux.Handle("GET /api/nodes/{id}/containers/stats", s.auth(s.handleContainerStats))
	mux.Handle("POST /api/nodes/{id}/containers/{cid}/action", s.auth(s.handleContainerAction))
	mux.Handle("POST /api/nodes/{id}/containers/{cid}/update", s.auth(s.handleContainerUpdate))
	mux.Handle("GET /api/nodes/{id}/images", s.auth(s.handleImages))
	mux.Handle("POST /api/nodes/{id}/images/prune", s.auth(s.handleImagePrune))

	mux.Handle("GET /api/nodes/{id}/stacks", s.auth(s.handleStacks))
	mux.Handle("GET /api/nodes/{id}/stacks/{name}", s.auth(s.handleStackGet))
	mux.Handle("PUT /api/nodes/{id}/stacks/{name}", s.auth(s.handleStackSave))
	mux.Handle("DELETE /api/nodes/{id}/stacks/{name}", s.auth(s.handleStackDelete))
	mux.Handle("POST /api/nodes/{id}/stacks/{name}/action", s.auth(s.handleStackAction))

	mux.Handle("GET /api/nodes/{id}/files", s.auth(s.handleFiles))
	mux.Handle("GET /api/nodes/{id}/files/download", s.auth(s.handleFileDownload))
	mux.Handle("POST /api/nodes/{id}/files/upload", s.auth(s.handleFileUpload))
	mux.Handle("POST /api/nodes/{id}/files/mkdir", s.auth(s.handleFileMkdir))
	mux.Handle("POST /api/nodes/{id}/files/rename", s.auth(s.handleFileRename))
	mux.Handle("POST /api/nodes/{id}/files/delete", s.auth(s.handleFileDelete))
	mux.Handle("GET /api/nodes/{id}/files/text", s.auth(s.handleFileRead))
	mux.Handle("PUT /api/nodes/{id}/files/text", s.auth(s.handleFileWrite))

	mux.Handle("GET /ws/term", s.auth(s.wsTerm))
	mux.Handle("GET /ws/logs", s.auth(s.wsLogs))

	mux.HandleFunc("/", s.serveStatic)

	return s.securityHeaders(mux)
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	if strings.HasPrefix(p, "/api/") || strings.HasPrefix(p, "/ws/") {
		http.NotFound(w, r)
		return
	}
	if p == "/" || p == "/index.html" {
		s.serveIndex(w, r)
		return
	}
	if strings.HasPrefix(p, "/assets/") {
		w.Header().Set("Cache-Control", "public, max-age=86400")
	} else {
		w.Header().Set("Cache-Control", "no-store")
	}
	switch p {
	case "/manifest.webmanifest":
		w.Header().Set("Content-Type", "application/manifest+json")
	case "/sw.js":
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	}
	http.FileServer(s.web).ServeHTTP(w, r)
}

func (s *Server) serveIndex(w http.ResponseWriter, r *http.Request) {
	f, err := s.web.Open("index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, 1<<20))
	if err != nil {
		http.Error(w, "读取页面失败", http.StatusInternalServerError)
		return
	}
	html := string(b)
	for _, a := range []string{
		"/assets/style.css", "/assets/logo.svg", "/assets/app.js",
		"/assets/vendor/xterm.css", "/assets/vendor/xterm.js", "/assets/vendor/addon-fit.js",
	} {
		html = strings.ReplaceAll(html, `"`+a+`"`, `"`+a+`?v=`+s.version+`"`)
	}
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(html))
}

func (s *Server) auth(h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil || !s.sessions.verify(c.Value) {
			writeErr(w, http.StatusUnauthorized, "登录已过期，请重新登录")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
			if r.Header.Get("X-KayPanel") != "1" || !sameOrigin(r) {
				writeErr(w, http.StatusForbidden, "非法请求来源")
				return
			}
		}
		h(w, r)
	})
}

func sameOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true
	}
	u, err := url.Parse(o)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Host, r.Host)
}

func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

type loginReq struct {
	Password string `json:"password"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) || r.Header.Get("X-KayPanel") != "1" {
		writeErr(w, http.StatusForbidden, "非法请求来源")
		return
	}
	var req loginReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	ip := remoteIP(r)
	if !s.limiter.allow(ip) {
		writeErr(w, http.StatusTooManyRequests, "尝试次数过多，请稍后再试")
		return
	}
	if !s.store.CheckPassword(req.Password) {
		s.limiter.fail(ip)
		s.audit.Add("admin", "", "登录失败", ip)
		writeErr(w, http.StatusUnauthorized, "密码错误")
		return
	}
	s.limiter.reset(ip)
	s.setSessionCookie(w, r)
	s.audit.Add("admin", "", "登录成功", ip)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) setSessionCookie(w http.ResponseWriter, r *http.Request) {
	sig := s.sessions.create()
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    sig,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"),
		MaxAge:   7 * 24 * 3600,
	})
}

func (s *Server) handleDesktopLogin(w http.ResponseWriter, r *http.Request) {
	if s.desktopToken == "" {
		http.NotFound(w, r)
		return
	}
	ip := net.ParseIP(remoteIP(r))
	if ip == nil || !ip.IsLoopback() {
		http.NotFound(w, r)
		return
	}
	token := r.URL.Query().Get("token")
	if subtle.ConstantTimeCompare([]byte(token), []byte(s.desktopToken)) != 1 {
		http.NotFound(w, r)
		return
	}
	s.setSessionCookie(w, r)
	s.audit.Add("admin", "", "桌面版登录", remoteIP(r))
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		s.sessions.destroy(c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	s.audit.Add("admin", "", "退出登录", "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	set := s.store.Settings()
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated": true,
		"version":       s.version,
		"settings":      set,
		"has_webhook":   strings.TrimSpace(set.Webhook) != "",
		"has_ai_key":    strings.TrimSpace(set.AIKey) != "",
		"desktop":       s.desktopToken != "",
	})
}

type passwordReq struct {
	Old string `json:"old"`
	New string `json:"new"`
}

func (s *Server) handlePassword(w http.ResponseWriter, r *http.Request) {
	var req passwordReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if len(req.New) < 8 {
		writeErr(w, http.StatusBadRequest, "新密码至少 8 位")
		return
	}
	if !(s.desktopToken != "" && req.Old == "") && !s.store.CheckPassword(req.Old) {
		writeErr(w, http.StatusForbidden, "当前密码错误")
		return
	}
	if err := s.store.SetPassword(req.New); err != nil {
		writeErr(w, http.StatusInternalServerError, "保存失败: "+err.Error())
		return
	}
	s.audit.Add("admin", "", "修改密码", "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	set := s.store.Settings()
	writeJSON(w, http.StatusOK, map[string]any{
		"settings":    set,
		"has_webhook": strings.TrimSpace(set.Webhook) != "",
		"has_ai_key":  strings.TrimSpace(set.AIKey) != "",
		"version":     s.version,
	})
}

type settingsReq struct {
	CPUAlert     int    `json:"cpu_alert"`
	MemAlert     int    `json:"mem_alert"`
	DiskAlert    int    `json:"disk_alert"`
	Webhook      string `json:"webhook"`
	ClearWebhook bool   `json:"clear_webhook"`
	DailyReport  bool   `json:"daily_report"`
	DailyHour    int    `json:"daily_hour"`
	AIBase       string `json:"ai_base"`
	AIModel      string `json:"ai_model"`
	AIKey        string `json:"ai_key"`
	ClearAIKey   bool   `json:"clear_ai_key"`
}

func validHTTPURL(v string) bool {
	u, err := url.Parse(v)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func (s *Server) handleSetSettings(w http.ResponseWriter, r *http.Request) {
	var req settingsReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	for _, v := range []int{req.CPUAlert, req.MemAlert, req.DiskAlert} {
		if v < 1 || v > 100 {
			writeErr(w, http.StatusBadRequest, "阈值需在 1-100 之间")
			return
		}
	}
	if req.DailyHour < 0 || req.DailyHour > 23 {
		writeErr(w, http.StatusBadRequest, "早报时间需在 0-23 点之间")
		return
	}
	old := s.store.Settings()
	cfg := config.Settings{
		CPUAlert:    req.CPUAlert,
		MemAlert:    req.MemAlert,
		DiskAlert:   req.DiskAlert,
		DailyReport: req.DailyReport,
		DailyHour:   req.DailyHour,
		CostPerKWh:  old.CostPerKWh,
	}
	cfg.Webhook = old.Webhook
	if req.ClearWebhook {
		cfg.Webhook = ""
	} else if v := strings.TrimSpace(req.Webhook); v != "" {
		if !validHTTPURL(v) {
			writeErr(w, http.StatusBadRequest, "Webhook 需为 http(s) 地址")
			return
		}
		cfg.Webhook = v
	}
	cfg.AIBase = old.AIBase
	if v := strings.TrimRight(strings.TrimSpace(req.AIBase), "/"); v != "" {
		if !validHTTPURL(v) {
			writeErr(w, http.StatusBadRequest, "AI Base URL 需为 http(s) 地址")
			return
		}
		cfg.AIBase = v
	} else {
		cfg.AIBase = ""
	}
	cfg.AIModel = strings.TrimSpace(req.AIModel)
	cfg.AIKey = old.AIKey
	if req.ClearAIKey {
		cfg.AIKey = ""
	} else if v := strings.TrimSpace(req.AIKey); v != "" {
		cfg.AIKey = v
	}
	if cfg.AIBase != "" && cfg.AIKey != "" && cfg.AIModel == "" {
		writeErr(w, http.StatusBadRequest, "使用 AI 助手需要填写模型名称")
		return
	}
	if err := s.store.SetSettings(cfg); err != nil {
		writeErr(w, http.StatusInternalServerError, "保存失败: "+err.Error())
		return
	}
	s.audit.Add("admin", "", "修改设置", "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAudit(w http.ResponseWriter, r *http.Request) {
	limit := 200
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 1000 {
			limit = n
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": s.audit.Tail(limit)})
}

type overviewNode struct {
	node.View
	Alerts []string `json:"alerts"`
}

func (s *Server) handleOverview(w http.ResponseWriter, r *http.Request) {
	set := s.store.Settings()
	views := s.mgr.Views()
	out := make([]overviewNode, 0, len(views))
	for _, v := range views {
		out = append(out, overviewNode{View: v, Alerts: computeAlerts(v, set)})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"nodes":       out,
		"settings":    set,
		"has_webhook": strings.TrimSpace(set.Webhook) != "",
		"has_ai_key":  strings.TrimSpace(set.AIKey) != "",
		"version":     s.version,
	})
}

func computeAlerts(v node.View, set config.Settings) []string {
	alerts := []string{}
	if !v.Online {
		alerts = append(alerts, "离线")
		return alerts
	}
	if v.Latest.CPU >= float64(set.CPUAlert) {
		alerts = append(alerts, "CPU "+strconv.FormatFloat(v.Latest.CPU, 'f', 1, 64)+"%")
	}
	if v.Latest.MemTotal > 0 {
		p := float64(v.Latest.MemUsed) / float64(v.Latest.MemTotal) * 100
		if p >= float64(set.MemAlert) {
			alerts = append(alerts, "内存 "+strconv.FormatFloat(p, 'f', 1, 64)+"%")
		}
	}
	if v.Latest.DiskTotal > 0 {
		p := float64(v.Latest.DiskUsed) / float64(v.Latest.DiskTotal) * 100
		if p >= float64(set.DiskAlert) {
			alerts = append(alerts, "磁盘 "+strconv.FormatFloat(p, 'f', 1, 64)+"%")
		}
	}
	return alerts
}

func (s *Server) handleNodes(w http.ResponseWriter, r *http.Request) {
	views := s.mgr.Views()
	if r.URL.Query().Get("light") == "1" {
		for i := range views {
			views[i].History = nil
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"nodes": views})
}

type nodeReq struct {
	Name         string `json:"name"`
	Addr         string `json:"addr"`
	User         string `json:"user"`
	AuthType     string `json:"auth_type"`
	PrivateKey   string `json:"private_key"`
	Password     string `json:"password"`
	Sudo         bool   `json:"sudo"`
	SudoPassword string `json:"sudo_password"`
	SkipHostKey  bool   `json:"skip_host_key"`
	SFTPOnly     bool   `json:"sftp_only"`
	AutoWake     bool   `json:"auto_wake"`
	IBAPIKey     string `json:"instabox_api_key"`
	IBMachineID  string `json:"instabox_machine_id"`
	FileRoot     string `json:"file_root"`
	StacksDir    string `json:"stacks_dir"`
	KeyPath      string `json:"key_path"`
}

func (n *nodeReq) loadKey() error {
	if n.AuthType == "password" || n.PrivateKey != "" || n.KeyPath == "" {
		return nil
	}
	key, err := readLocalKey(n.KeyPath)
	if err != nil {
		return err
	}
	n.PrivateKey = key
	return nil
}

func (n nodeReq) config() config.Node {
	return config.Node{
		Name:         n.Name,
		Addr:         n.Addr,
		User:         n.User,
		AuthType:     n.AuthType,
		PrivateKey:   n.PrivateKey,
		Password:     n.Password,
		Sudo:         n.Sudo,
		SudoPassword: n.SudoPassword,
		SkipHostKey:  n.SkipHostKey,
		SFTPOnly:     n.SFTPOnly,
		AutoWake:     n.AutoWake,
		IBAPIKey:     n.IBAPIKey,
		IBMachineID:  n.IBMachineID,
		FileRoot:     n.FileRoot,
		StacksDir:    n.StacksDir,
	}
}

func (s *Server) handleNodeAdd(w http.ResponseWriter, r *http.Request) {
	var req nodeReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if err := req.loadKey(); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	c, err := s.mgr.Add(req.config())
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.audit.Add("admin", c.ID, "添加节点", c.Name+" ("+c.Addr+")")
	writeJSON(w, http.StatusOK, map[string]any{"node": c})
}

func (s *Server) handleNodeUpdate(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req nodeReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if err := req.loadKey(); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	c := req.config()
	c.ID = id
	if err := s.mgr.Update(id, c); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.audit.Add("admin", id, "更新节点", req.Name+" ("+req.Addr+")")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleNodeDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	n, ok := s.mgr.Get(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "节点不存在")
		return
	}
	name := n.Config().Name
	if err := s.mgr.Delete(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.audit.Add("admin", id, "删除节点", name)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleNodeTest(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	res := s.mgr.Test(id)
	s.audit.Add("admin", id, "测试节点", res.Hostname)
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleInstaboxMachines(w http.ResponseWriter, r *http.Request) {
	var req struct {
		APIKey string `json:"api_key"`
		NodeID string `json:"node_id"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	key := strings.TrimSpace(req.APIKey)
	if key == "" && req.NodeID != "" {
		if n, ok := s.mgr.Get(req.NodeID); ok {
			key = n.Config().IBAPIKey
		}
	}
	if key == "" {
		writeErr(w, http.StatusBadRequest, "请先填写 Instabox API Key")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	list, err := instabox.Machines(ctx, key)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "读取机器列表失败: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"machines": list})
}

func (s *Server) handleProcesses(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	out, err := n.OutputCtx(r.Context(), metrics.ProcessesCommand(), 15*time.Second)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "读取进程失败: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"processes": metrics.ParseProcesses(out)})
}

func (s *Server) handleTemplates(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"templates": appTemplates()})
}

func (s *Server) node(w http.ResponseWriter, r *http.Request) (*node.Node, bool) {
	id := r.PathValue("id")
	n, ok := s.mgr.Get(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "节点不存在")
		return nil, false
	}
	return n, true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": msg})
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, 2<<20))
	return dec.Decode(v)
}

type sessions struct {
	mu     sync.Mutex
	secret []byte
	m      map[string]time.Time
}

func newSessions(secret []byte) *sessions {
	return &sessions{secret: secret, m: map[string]time.Time{}}
}

func (s *sessions) sign(id string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(id))
	return id + "." + hex.EncodeToString(mac.Sum(nil))
}

func (s *sessions) create() string {
	id := config.RandomHex(24)
	s.mu.Lock()
	now := time.Now()
	for k, exp := range s.m {
		if now.After(exp) {
			delete(s.m, k)
		}
	}
	s.m[id] = now.Add(7 * 24 * time.Hour)
	s.mu.Unlock()
	return s.sign(id)
}

func (s *sessions) verify(signed string) bool {
	id, sig, ok := strings.Cut(signed, ".")
	if !ok {
		return false
	}
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(id))
	want := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(sig), []byte(want)) {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	exp, ok := s.m[id]
	if !ok {
		return false
	}
	if time.Now().After(exp) {
		delete(s.m, id)
		return false
	}
	return true
}

func (s *sessions) destroy(signed string) {
	id, _, ok := strings.Cut(signed, ".")
	if !ok {
		return
	}
	s.mu.Lock()
	delete(s.m, id)
	s.mu.Unlock()
}

type loginLimiter struct {
	mu sync.Mutex
	m  map[string][]time.Time
}

func newLoginLimiter() *loginLimiter {
	return &loginLimiter{m: map[string][]time.Time{}}
}

func (l *loginLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	var kept []time.Time
	for _, t := range l.m[ip] {
		if now.Sub(t) < 5*time.Minute {
			kept = append(kept, t)
		}
	}
	l.m[ip] = kept
	return len(kept) < 8
}

func (l *loginLimiter) fail(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.m[ip] = append(l.m[ip], time.Now())
}

func (l *loginLimiter) reset(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.m, ip)
}
