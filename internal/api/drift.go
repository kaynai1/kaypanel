package api

import (
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"kaypanel/internal/node"
)

type driftNode struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Online bool   `json:"online"`
}

type driftGroup struct {
	Hash  string   `json:"hash"`
	Nodes []string `json:"nodes"`
}

type driftItem struct {
	Key     string       `json:"key"`
	Label   string       `json:"label"`
	Groups  []driftGroup `json:"groups"`
	Drifted []string     `json:"drifted"`
}

type driftReport struct {
	Time    int64       `json:"time"`
	Nodes   []driftNode `json:"nodes"`
	Items   []driftItem `json:"items"`
	Drifts  int         `json:"drifts"`
	Scanned int         `json:"scanned"`
}

var driftKeys = []struct{ key, label string }{
	{"file:/etc/ssh/sshd_config", "SSH 配置"},
	{"file:/etc/nginx/nginx.conf", "Nginx 主配置"},
	{"nginx", "Nginx 全量配置"},
	{"file:/etc/docker/daemon.json", "Docker 配置"},
	{"file:/etc/crontab", "系统 crontab"},
	{"crontab", "用户 crontab"},
	{"compose", "Compose 应用"},
}

func driftScript(stacksDir string) string {
	q := node.ShQuote(stacksDir)
	return `
echo '@@@DRIFT'
for p in /etc/ssh/sshd_config /etc/nginx/nginx.conf /etc/docker/daemon.json /etc/crontab; do
  if [ -r "$p" ]; then printf 'file:%s|' "$p"; sha256sum "$p" 2>/dev/null | cut -d' ' -f1; else printf 'file:%s|missing\n' "$p"; fi
done
if command -v crontab >/dev/null 2>&1; then printf 'crontab|'; crontab -l 2>/dev/null | sha256sum | cut -d' ' -f1; else printf 'crontab|missing\n'; fi
if command -v nginx >/dev/null 2>&1; then printf 'nginx|'; (nginx -T 2>/dev/null | sha256sum | cut -d' ' -f1); else printf 'nginx|missing\n'; fi
dir=` + q + `
if [ -d "$dir" ]; then printf 'compose|'; (cd "$dir" && find . -maxdepth 3 -name 'compose.y*ml' -type f | sort | while read -r f; do echo "== $f"; cat "$f"; done | sha256sum | cut -d' ' -f1); else printf 'compose|missing\n'; fi
echo '@@@END'
`
}

const emptySHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

func (s *Server) handleDrift(w http.ResponseWriter, r *http.Request) {
	views := s.mgr.Views()
	report := driftReport{Time: time.Now().Unix(), Nodes: make([]driftNode, 0, len(views))}
	var scan []node.View
	for _, v := range views {
		report.Nodes = append(report.Nodes, driftNode{ID: v.ID, Name: v.Name, Online: v.Online && !v.SFTPOnly})
		if v.Online && !v.SFTPOnly {
			scan = append(scan, v)
		}
	}
	hashes := make([]map[string]string, len(scan))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for i, v := range scan {
		n, ok := s.mgr.Get(v.ID)
		if !ok {
			continue
		}
		wg.Add(1)
		go func(i int, n *node.Node, v node.View) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			out, err := n.OutputCtx(r.Context(), driftScript(v.StacksDir), 20*time.Second)
			if err != nil && strings.TrimSpace(out) == "" {
				return
			}
			m := map[string]string{}
			for _, line := range strings.Split(out, "\n") {
				k, h, ok := strings.Cut(strings.TrimSpace(line), "|")
				if !ok || h == "" {
					continue
				}
				m[k] = h
			}
			hashes[i] = m
		}(i, n, v)
	}
	wg.Wait()
	report.Scanned = len(scan)
	for _, dk := range driftKeys {
		it := driftItem{Key: dk.key, Label: dk.label, Groups: []driftGroup{}, Drifted: []string{}}
		byHash := map[string][]string{}
		var order []string
		for i, v := range scan {
			if len(hashes[i]) == 0 {
				continue
			}
			h := hashes[i][dk.key]
			if h == "" || h == emptySHA {
				h = "missing"
			}
			if _, ok := byHash[h]; !ok {
				order = append(order, h)
			}
			byHash[h] = append(byHash[h], v.ID)
		}
		if len(order) == 0 {
			continue
		}
		sort.SliceStable(order, func(a, b int) bool { return len(byHash[order[a]]) > len(byHash[order[b]]) })
		for _, h := range order {
			it.Groups = append(it.Groups, driftGroup{Hash: h, Nodes: byHash[h]})
		}
		if len(it.Groups) > 1 {
			for _, g := range it.Groups[1:] {
				it.Drifted = append(it.Drifted, g.Nodes...)
			}
			report.Drifts++
		}
		report.Items = append(report.Items, it)
	}
	writeJSON(w, http.StatusOK, report)
}
