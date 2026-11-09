package audit

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Entry struct {
	Time   string `json:"time"`
	User   string `json:"user"`
	Node   string `json:"node,omitempty"`
	Action string `json:"action"`
	Detail string `json:"detail,omitempty"`
}

type Log struct {
	mu   sync.Mutex
	path string
	f    *os.File
}

func Open(path string) (*Log, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	return &Log{path: path, f: f}, nil
}

func (l *Log) Add(user, node, action, detail string) {
	e := Entry{
		Time:   time.Now().Format("2006-01-02 15:04:05"),
		User:   user,
		Node:   node,
		Action: action,
		Detail: detail,
	}
	b, err := json.Marshal(e)
	if err != nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if st, err := l.f.Stat(); err == nil && st.Size() > 4<<20 {
		l.f.Close()
		_ = os.Rename(l.path, l.path+".1")
		l.f, _ = os.OpenFile(l.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	}
	if l.f != nil {
		_, _ = l.f.Write(append(b, '\n'))
	}
}

func (l *Log) Tail(n int) []Entry {
	l.mu.Lock()
	defer l.mu.Unlock()
	f, err := os.Open(l.path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var lines []string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		lines = append(lines, sc.Text())
		if len(lines) > 4000 {
			lines = lines[len(lines)-2000:]
		}
	}
	out := make([]Entry, 0, n)
	start := 0
	if len(lines) > n {
		start = len(lines) - n
	}
	for _, line := range lines[start:] {
		var e Entry
		if json.Unmarshal([]byte(line), &e) == nil {
			out = append(out, e)
		}
	}
	return out
}
