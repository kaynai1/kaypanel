package insight

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Broadcast struct {
	ID         string   `json:"id"`
	Time       int64    `json:"time"`
	Text       string   `json:"text"`
	Tone       string   `json:"tone"`
	AI         bool     `json:"ai"`
	Highlights []string `json:"highlights"`
}

type DrillRun struct {
	ID       string   `json:"id"`
	Time     int64    `json:"time"`
	Scenario string   `json:"scenario"`
	Score    int      `json:"score"`
	Passed   []string `json:"passed"`
	Missed   []string `json:"missed"`
	Wrong    []string `json:"wrong"`
	Feedback string   `json:"feedback"`
	AI       bool     `json:"ai"`
}

type fileData struct {
	Broadcasts []Broadcast `json:"broadcasts"`
	Drills     []DrillRun  `json:"drills"`
}

type Store struct {
	mu   sync.Mutex
	path string
	data fileData
}

func New(dir string) *Store {
	s := &Store{path: filepath.Join(dir, "insight.json")}
	s.load()
	return s
}

func (s *Store) load() {
	b, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	_ = json.Unmarshal(b, &s.data)
}

func (s *Store) saveLocked() {
	b, err := json.Marshal(&s.data)
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return
	}
	tmp := s.path + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, s.path)
	}
}

func newID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().String()))
	}
	return hex.EncodeToString(b)
}

func (s *Store) Broadcasts() []Broadcast {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Broadcast(nil), s.data.Broadcasts...)
}

func (s *Store) LatestBroadcast() (Broadcast, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.data.Broadcasts) == 0 {
		return Broadcast{}, false
	}
	return s.data.Broadcasts[0], true
}

func (s *Store) AddBroadcast(b Broadcast) Broadcast {
	s.mu.Lock()
	defer s.mu.Unlock()
	b.ID = newID()
	b.Time = time.Now().Unix()
	if b.Highlights == nil {
		b.Highlights = []string{}
	}
	s.data.Broadcasts = append([]Broadcast{b}, s.data.Broadcasts...)
	if len(s.data.Broadcasts) > 12 {
		s.data.Broadcasts = s.data.Broadcasts[:12]
	}
	s.saveLocked()
	return b
}

func (s *Store) Drills() []DrillRun {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]DrillRun(nil), s.data.Drills...)
}

func (s *Store) AddDrill(r DrillRun) DrillRun {
	s.mu.Lock()
	defer s.mu.Unlock()
	r.ID = newID()
	r.Time = time.Now().Unix()
	if r.Passed == nil {
		r.Passed = []string{}
	}
	if r.Missed == nil {
		r.Missed = []string{}
	}
	if r.Wrong == nil {
		r.Wrong = []string{}
	}
	s.data.Drills = append([]DrillRun{r}, s.data.Drills...)
	if len(s.data.Drills) > 20 {
		s.data.Drills = s.data.Drills[:20]
	}
	s.saveLocked()
	return r
}
