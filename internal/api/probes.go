package api

import (
	"fmt"
	"html"
	"net/http"
	"strings"
	"time"

	"kaypanel/internal/probe"
)

func (s *Server) handleProbes(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"targets": s.probes.States()})
}

func (s *Server) handleProbeAdd(w http.ResponseWriter, r *http.Request) {
	var req probe.Target
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	t, err := s.probes.Add(req)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.audit.Add("admin", "", "添加拨测", t.Name+" "+t.URL)
	writeJSON(w, http.StatusOK, map[string]any{"target": t})
}

func (s *Server) handleProbeDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.probes.Remove(id) {
		writeErr(w, http.StatusNotFound, "拨测目标不存在")
		return
	}
	s.audit.Add("admin", "", "删除拨测", id)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleProbeCheck(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	c, ok := s.probes.CheckNow(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "拨测目标不存在")
		return
	}
	st, _ := s.probes.Get(id)
	writeJSON(w, http.StatusOK, map[string]any{"check": c, "target": st})
}

type publicProbe struct {
	Name    string      `json:"name"`
	Type    string      `json:"type"`
	Up      bool        `json:"up"`
	Latency int64       `json:"latency_ms"`
	Uptime  float64     `json:"uptime"`
	Checks  []probe.Check `json:"checks"`
}

func (s *Server) publicStatus() map[string]any {
	list := s.probes.States()
	out := make([]publicProbe, 0, len(list))
	up := 0
	for _, st := range list {
		checks := st.Checks
		if len(checks) > 40 {
			checks = checks[len(checks)-40:]
		}
		for i := range checks {
			checks[i].Error = ""
		}
		pp := publicProbe{Name: st.Name, Type: st.Type, Up: st.Up, Latency: st.Latency, Uptime: st.Uptime, Checks: checks}
		if st.Up {
			up++
		}
		out = append(out, pp)
	}
	state := "empty"
	if len(out) > 0 {
		state = "up"
		if up < len(out) {
			state = "down"
		}
	}
	return map[string]any{
		"generated": time.Now().Unix(),
		"version":   s.version,
		"state":     state,
		"up":        up,
		"total":     len(out),
		"targets":   out,
	}
}

func (s *Server) handlePublicStatusAPI(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.publicStatus())
}

func statusColor(ok bool) string {
	if ok {
		return "#16a34a"
	}
	return "#dc2626"
}

func sparkSVG(checks []probe.Check) string {
	if len(checks) == 0 {
		return `<span class="spark-empty">暂无数据</span>`
	}
	var b strings.Builder
	wpx := 8
	gap := 3
	b.WriteString(fmt.Sprintf(`<svg class="spark" width="%d" height="34" viewBox="0 0 %d 34" aria-hidden="true">`, len(checks)*(wpx+gap), len(checks)*(wpx+gap)))
	for i, c := range checks {
		h := 20
		if !c.OK {
			h = 34
		}
		x := i * (wpx + gap)
		b.WriteString(fmt.Sprintf(`<rect x="%d" y="%d" width="%d" height="%d" rx="1.5" fill="%s" opacity="%s"/>`, x, 34-h, wpx, h, statusColor(c.OK), "0.85"))
	}
	b.WriteString(`</svg>`)
	return b.String()
}

func (s *Server) handlePublicStatusPage(w http.ResponseWriter, r *http.Request) {
	data := s.publicStatus()
	targets := data["targets"].([]publicProbe)
	up := data["up"].(int)
	total := data["total"].(int)
	stateText := "暂无监控目标"
	stateClass := "empty"
	if total > 0 {
		if up == total {
			stateText = "所有服务运行正常"
			stateClass = "ok"
		} else {
			stateText = fmt.Sprintf("%d / %d 项服务可用", up, total)
			stateClass = "down"
		}
	}
	var cards strings.Builder
	for _, t := range targets {
		statusText := "异常"
		cls := "down"
		lat := "—"
		if t.Up {
			statusText = "正常"
			cls = "up"
		}
		if t.Latency > 0 {
			lat = fmt.Sprintf("%d ms", t.Latency)
		}
		uptime := "—"
		if len(t.Checks) > 0 {
			uptime = fmt.Sprintf("%.1f%%", t.Uptime)
		}
		cards.WriteString(fmt.Sprintf(`
    <div class="p-card">
      <div class="p-head">
        <div class="p-name"><i class="p-dot %s"></i>%s<span class="p-type">%s</span></div>
        <b class="p-status %s">%s</b>
      </div>
      <div class="p-meta"><span>24h 可用率 <b>%s</b></span><span>最近延迟 <b>%s</b></span></div>
      <div class="p-spark">%s</div>
    </div>`, cls, html.EscapeString(t.Name), strings.ToUpper(t.Type), cls, statusText, uptime, lat, sparkSVG(t.Checks)))
	}
	if total == 0 {
		cards.WriteString(`<div class="p-empty">管理员尚未添加拨测目标</div>`)
	}
	updated := time.Now().Format("2006-01-02 15:04:05")
	page := `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>KayPanel 状态页</title>
<style>
:root{--bg:#f4f7fb;--card:#fff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(circle at 20% 0%,#e0f2fe 0,transparent 40%),var(--bg);font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink);min-height:100vh;padding:40px 20px}
.wrap{max-width:860px;margin:0 auto}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px;color:var(--muted);margin-bottom:18px}
.brand em{font-style:normal;background:#0f172a;color:#fff;border-radius:8px;padding:3px 7px;font-size:12px}
h1{font-size:28px;margin:0 0 8px}
.state{display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:14px;padding:6px 14px;border-radius:99px;margin-bottom:26px}
.state.ok{background:#dcfce7;color:#15803d}
.state.down{background:#fee2e2;color:#b91c1c}
.state.empty{background:#e2e8f0;color:#475569}
.state i{width:8px;height:8px;border-radius:50%;background:currentColor}
.grid{display:grid;gap:12px}
.p-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.p-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.p-name{display:flex;align-items:center;gap:9px;font-weight:600;font-size:15px;flex-wrap:wrap}
.p-dot{width:9px;height:9px;border-radius:50%}
.p-dot.up{background:#16a34a;box-shadow:0 0 0 4px #dcfce7}
.p-dot.down{background:#dc2626;box-shadow:0 0 0 4px #fee2e2}
.p-type{font-size:10.5px;font-weight:600;color:var(--muted);border:1px solid var(--line);border-radius:99px;padding:1px 7px}
.p-status{font-size:13px}
.p-status.up{color:#16a34a}
.p-status.down{color:#dc2626}
.p-meta{display:flex;gap:20px;color:var(--muted);font-size:12.5px;margin-top:9px}
.p-meta b{color:var(--ink);font-weight:600}
.p-spark{margin-top:10px}
.spark{display:block;max-width:100%}
.spark-empty{font-size:12px;color:var(--muted)}
.p-empty{background:var(--card);border:1px dashed var(--line);border-radius:14px;padding:40px;text-align:center;color:var(--muted)}
.foot{margin-top:26px;display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:12px;flex-wrap:wrap}
</style></head><body>
<div class="wrap">
  <div class="brand"><em>KP</em> KayPanel 状态页</div>
  <h1>服务运行状态</h1>
  <div class="state ` + stateClass + `"><i></i>` + stateText + `</div>
  <div class="grid">` + cards.String() + `</div>
  <div class="foot"><span>每 30 秒自动刷新</span><span>更新于 ` + updated + ` · KayPanel ` + html.EscapeString(runtimeVersion(s.version)) + `</span></div>
</div>
</body></html>`
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(page))
}

func runtimeVersion(v string) string {
	if strings.TrimSpace(v) == "" {
		return "dev"
	}
	return v
}
