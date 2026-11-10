package api

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"kaypanel/internal/node"
)

type batchTarget struct {
	node *node.Node
	name string
}

func (s *Server) batchTargets(ids []string) []batchTarget {
	out := make([]batchTarget, 0, len(ids))
	for _, id := range ids {
		n, ok := s.mgr.Get(id)
		if !ok {
			continue
		}
		out = append(out, batchTarget{node: n, name: n.Config().Name})
	}
	return out
}

func parseIDs(raw string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, part := range strings.Split(raw, ",") {
		id := strings.TrimSpace(part)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
		if len(out) >= 20 {
			break
		}
	}
	return out
}

func truncRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

type batchExecReq struct {
	IDs []string `json:"ids"`
	Cmd string   `json:"cmd"`
}

type batchExecResult struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	OK      bool   `json:"ok"`
	Output  string `json:"output"`
	Error   string `json:"error,omitempty"`
	Elapsed int64  `json:"elapsed_ms"`
}

func (s *Server) handleBatchExec(w http.ResponseWriter, r *http.Request) {
	var req batchExecReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	cmd := strings.TrimSpace(req.Cmd)
	if cmd == "" {
		writeErr(w, http.StatusBadRequest, "请填写要执行的命令")
		return
	}
	if len(cmd) > 4000 {
		writeErr(w, http.StatusBadRequest, "命令过长")
		return
	}
	targets := s.batchTargets(req.IDs)
	if len(targets) == 0 {
		writeErr(w, http.StatusBadRequest, "请选择至少一个节点")
		return
	}
	results := make([]batchExecResult, len(targets))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for i, t := range targets {
		wg.Add(1)
		go func(i int, t batchTarget) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			start := time.Now()
			res := batchExecResult{ID: t.node.Config().ID, Name: t.name}
			defer func() {
				res.Elapsed = time.Since(start).Milliseconds()
				results[i] = res
			}()
			cfg := t.node.Config()
			if cfg.SFTPOnly {
				res.Error = "仅 SFTP 节点不支持批量命令"
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
			defer cancel()
			out, err := t.node.OutputCtx(ctx, cmd, 100*time.Second)
			res.Output = truncRunes(strings.TrimSpace(out), 6000)
			if err != nil {
				res.Error = truncIssue(err.Error())
				return
			}
			res.OK = true
		}(i, t)
	}
	wg.Wait()
	line := cmd
	if i := strings.IndexByte(line, '\n'); i >= 0 {
		line = line[:i]
	}
	s.audit.Add("admin", "", "批量命令", fmt.Sprintf("%d 台: %s", len(targets), truncRunes(line, 80)))
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

type batchApp struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Output string `json:"output"`
}

type batchUpdateResult struct {
	ID      string     `json:"id"`
	Name    string     `json:"name"`
	OK      bool       `json:"ok"`
	Apps    []batchApp `json:"apps"`
	Error   string     `json:"error,omitempty"`
	Elapsed int64      `json:"elapsed_ms"`
}

func parseBatchApps(out string) []batchApp {
	apps := []batchApp{}
	var cur *batchApp
	var buf strings.Builder
	flush := func(ok bool) {
		if cur == nil {
			return
		}
		cur.OK = ok
		cur.Output = truncRunes(strings.TrimSpace(buf.String()), 1200)
		apps = append(apps, *cur)
		cur = nil
		buf.Reset()
	}
	for _, line := range strings.Split(out, "\n") {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "@@@KP_APP ") {
			flush(false)
			name := strings.TrimSpace(strings.TrimPrefix(trim, "@@@KP_APP "))
			cur = &batchApp{Name: name}
			continue
		}
		if strings.HasPrefix(trim, "@@@KP_RC ") {
			rc := strings.TrimSpace(strings.TrimPrefix(trim, "@@@KP_RC "))
			flush(rc == "0")
			continue
		}
		if cur != nil {
			buf.WriteString(line)
			buf.WriteByte('\n')
		}
	}
	flush(false)
	return apps
}

func (s *Server) handleBatchUpdate(w http.ResponseWriter, r *http.Request) {
	var req batchIDsReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	targets := s.batchTargets(req.IDs)
	if len(targets) == 0 {
		writeErr(w, http.StatusBadRequest, "请选择至少一个节点")
		return
	}
	results := make([]batchUpdateResult, len(targets))
	sem := make(chan struct{}, 2)
	var wg sync.WaitGroup
	for i, t := range targets {
		wg.Add(1)
		go func(i int, t batchTarget) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			start := time.Now()
			res := batchUpdateResult{ID: t.node.Config().ID, Name: t.name, Apps: []batchApp{}}
			defer func() {
				res.Elapsed = time.Since(start).Milliseconds()
				results[i] = res
			}()
			cfg := t.node.Config()
			if cfg.SFTPOnly {
				res.Error = "仅 SFTP 节点不支持批量更新"
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 660*time.Second)
			defer cancel()
			compose, err := s.composeCommand(ctx, t.node)
			if err != nil {
				res.Error = err.Error()
				return
			}
			script := batchUpdateScript(cfg.StacksDir, compose)
			out, err := t.node.OutputCtx(ctx, script, 600*time.Second)
			res.Apps = parseBatchApps(out)
			if err != nil && strings.TrimSpace(out) == "" {
				res.Error = truncIssue(err.Error())
				return
			}
			if strings.Contains(out, "@@@KP_NONE") && len(res.Apps) == 0 {
				res.Error = "节点上没有应用"
				return
			}
			res.OK = true
			for _, a := range res.Apps {
				if !a.OK {
					res.OK = false
					break
				}
			}
		}(i, t)
	}
	wg.Wait()
	s.audit.Add("admin", "", "批量更新应用", fmt.Sprintf("%d 台节点", len(targets)))
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func batchUpdateScript(stacksDir, compose string) string {
	q := node.ShQuote(strings.TrimRight(stacksDir, "/"))
	if q == "''" {
		q = "'/'"
	}
	return fmt.Sprintf(`base=%s
if [ ! -d "$base" ]; then echo '@@@KP_NONE'; exit 0; fi
found=0
for d in "$base"/*/; do
  [ -d "$d" ] || continue
  name=$(basename "$d")
  found=1
  echo "@@@KP_APP $name"
  out=$(cd "$d" && %s -p "$name" pull -q 2>&1 && %s -p "$name" up -d --remove-orphans 2>&1)
  rc=$?
  printf '%%s\n' "$out" | tail -n 30
  echo "@@@KP_RC $rc"
done
[ "$found" = 1 ] || echo '@@@KP_NONE'
exit 0`, q, compose, compose)
}

type batchIDsReq struct {
	IDs []string `json:"ids"`
}

type batchUploadResult struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

func (s *Server) handleBatchUpload(w http.ResponseWriter, r *http.Request) {
	ids := parseIDs(r.URL.Query().Get("ids"))
	if len(ids) == 0 {
		writeErr(w, http.StatusBadRequest, "请选择至少一个节点")
		return
	}
	dir := strings.TrimSpace(r.URL.Query().Get("path"))
	if dir == "" || !strings.HasPrefix(dir, "/") {
		writeErr(w, http.StatusBadRequest, "请填写绝对路径")
		return
	}
	name := path.Base(strings.ReplaceAll(strings.TrimSpace(r.URL.Query().Get("name")), "\\", "/"))
	if name == "" || name == "." || name == ".." || name == "/" {
		writeErr(w, http.StatusBadRequest, "文件名不合法")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 20<<20)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "读取上传内容失败")
		return
	}
	targets := s.batchTargets(ids)
	if len(targets) == 0 {
		writeErr(w, http.StatusBadRequest, "节点不存在")
		return
	}
	results := make([]batchUploadResult, len(targets))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for i, t := range targets {
		wg.Add(1)
		go func(i int, t batchTarget) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			res := batchUploadResult{ID: t.node.Config().ID, Name: t.name}
			cfg := t.node.Config()
			if cfg.SFTPOnly && cfg.FileRoot == "" {
				res.Error = "节点未配置文件根目录"
				results[i] = res
				return
			}
			client, err := t.node.Client()
			if err != nil {
				res.Error = truncIssue(err.Error())
				results[i] = res
				return
			}
			sf, err := client.SFTP()
			if err != nil {
				res.Error = truncIssue(err.Error())
				results[i] = res
				return
			}
			root := fileRoot(t.node)
			realDir, err := resolveExisting(sf, root, dir)
			if err != nil {
				client.ResetSFTP()
				res.Error = "目录不可用: " + truncIssue(err.Error())
				results[i] = res
				return
			}
			if st, err := sf.Stat(realDir); err != nil || !st.IsDir() {
				res.Error = "目标不是目录"
				results[i] = res
				return
			}
			if err := writeRemoteFile(sf, path.Join(realDir, name), string(data)); err != nil {
				client.ResetSFTP()
				res.Error = truncIssue(err.Error())
				results[i] = res
				return
			}
			res.OK = true
			results[i] = res
		}(i, t)
	}
	wg.Wait()
	okCount := 0
	for _, res := range results {
		if res.OK {
			okCount++
		}
	}
	s.audit.Add("admin", "", "批量上传文件", fmt.Sprintf("%s -> %d 台节点", path.Join(dir, name), len(targets)))
	writeJSON(w, http.StatusOK, map[string]any{"results": results, "ok": okCount, "total": len(results)})
}
