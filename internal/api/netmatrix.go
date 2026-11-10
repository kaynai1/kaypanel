package api

import (
	"fmt"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"kaypanel/internal/node"
)

type matrixNode struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Online bool   `json:"online"`
}

type netMatrix struct {
	Time    int64        `json:"time"`
	Nodes   []matrixNode `json:"nodes"`
	Latency [][]float64  `json:"latency"`
	Loss    [][]float64  `json:"loss"`
}

var hostSafe = regexp.MustCompile(`^[A-Za-z0-9._:-]+$`)

func nodeHost(addr string) string {
	h, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return h
}

func pingScript(hosts []string) string {
	var b strings.Builder
	for _, h := range hosts {
		q := node.ShQuote(h)
		fmt.Fprintf(&b, "out=$(ping -c 3 -W 1 -q %s 2>/dev/null); ", q)
		b.WriteString(`loss=$(printf '%s\n' "$out" | sed -n 's/.* \([0-9.]*\)% packet loss.*/\1/p' | head -n1); `)
		b.WriteString(`avg=$(printf '%s\n' "$out" | sed -n 's/.*rtt min\/avg\/max\/mdev = [0-9.]*\/\([0-9.]*\)\/.*/\1/p' | head -n1); `)
		fmt.Fprintf(&b, "echo %s\"|$loss|$avg\"\n", q)
	}
	b.WriteString("true\n")
	return b.String()
}

func (s *Server) handleNetMatrix(w http.ResponseWriter, r *http.Request) {
	views := s.mgr.Views()
	res := netMatrix{Time: time.Now().Unix(), Nodes: make([]matrixNode, 0, len(views))}
	idx := map[string]int{}
	var online []int
	for _, v := range views {
		idx[v.ID] = len(res.Nodes)
		res.Nodes = append(res.Nodes, matrixNode{ID: v.ID, Name: v.Name, Online: v.Online && !v.SFTPOnly})
	}
	res.Latency = make([][]float64, len(res.Nodes))
	res.Loss = make([][]float64, len(res.Nodes))
	for i := range res.Nodes {
		res.Latency[i] = make([]float64, len(res.Nodes))
		res.Loss[i] = make([]float64, len(res.Nodes))
		for j := range res.Nodes {
			res.Latency[i][j] = -1
			res.Loss[i][j] = -1
		}
	}
	for i, v := range views {
		if !v.Online || v.SFTPOnly {
			continue
		}
		if len(online) >= 8 {
			break
		}
		online = append(online, i)
	}
	var mu sync.Mutex
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for _, ai := range online {
		var hosts []string
		var targets []int
		for _, bi := range online {
			if ai == bi {
				continue
			}
			h := nodeHost(views[bi].Addr)
			if !hostSafe.MatchString(h) {
				continue
			}
			hosts = append(hosts, h)
			targets = append(targets, bi)
		}
		if len(hosts) == 0 {
			continue
		}
		n, ok := s.mgr.Get(views[ai].ID)
		if !ok {
			continue
		}
		wg.Add(1)
		go func(ai int, n *node.Node, hosts []string, targets []int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			out, err := n.OutputCtx(r.Context(), pingScript(hosts), 40*time.Second)
			if err != nil && strings.TrimSpace(out) == "" {
				return
			}
			mu.Lock()
			defer mu.Unlock()
			for _, line := range strings.Split(out, "\n") {
				f := strings.Split(strings.TrimSpace(line), "|")
				if len(f) != 3 {
					continue
				}
				ti := -1
				for k, h := range hosts {
					if h == f[0] {
						ti = targets[k]
						break
					}
				}
				if ti < 0 {
					continue
				}
				loss, lok := parseFloat(f[1])
				lat, aok := parseFloat(f[2])
				if lok {
					res.Loss[ai][ti] = round2(loss)
				}
				if aok {
					res.Latency[ai][ti] = round2(lat)
				}
			}
		}(ai, n, hosts, targets)
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, res)
}

func parseFloat(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	v := 0.0
	dot := false
	frac := 0.1
	for _, c := range s {
		if c == '.' && !dot {
			dot = true
			continue
		}
		if c < '0' || c > '9' {
			return 0, false
		}
		if dot {
			v += float64(c-'0') * frac
			frac /= 10
		} else {
			v = v*10 + float64(c-'0')
		}
	}
	return v, true
}
