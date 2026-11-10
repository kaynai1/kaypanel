package wrapped

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"kaypanel/internal/metrics"
)

type dayAgg struct {
	Samples  int     `json:"samples"`
	CPUSum   float64 `json:"cpu_sum"`
	CPUPeak  float64 `json:"cpu_peak"`
	PeakTime int64   `json:"peak_time"`
	MemSum   float64 `json:"mem_sum"`
	MemPeak  float64 `json:"mem_peak"`
	Night    int     `json:"night"`
}

type dayEvents struct {
	Total int `json:"total"`
	Error int `json:"error"`
}

type fileData struct {
	Updated int64                      `json:"updated"`
	Days    map[string]map[string]*dayAgg `json:"days"`
	Events  map[string]*dayEvents      `json:"events"`
	Names   map[string]string          `json:"names"`
}

type NodeData struct {
	ID    string
	Name  string
	Trend []metrics.Snapshot
}

type Event struct {
	Time  int64
	Level string
}

type Store struct {
	path string
	mu   sync.Mutex
	data fileData
}

func New(dir string) *Store {
	s := &Store{path: filepath.Join(dir, "wrapped.json")}
	s.data = fileData{
		Days:   map[string]map[string]*dayAgg{},
		Events: map[string]*dayEvents{},
		Names:  map[string]string{},
	}
	b, err := os.ReadFile(s.path)
	if err != nil {
		return s
	}
	var f fileData
	if json.Unmarshal(b, &f) != nil {
		return s
	}
	if f.Days != nil {
		s.data.Days = f.Days
	}
	if f.Events != nil {
		s.data.Events = f.Events
	}
	if f.Names != nil {
		s.data.Names = f.Names
	}
	s.data.Updated = f.Updated
	return s
}

// Update replaces the aggregates for every day still covered by the rolling
// trend window and keeps older days, so the report can outlive the 7-day
// in-memory history.
func (s *Store) Update(nodes []NodeData, events []Event) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	active := map[string]bool{}
	for _, n := range nodes {
		active[n.ID] = true
		s.data.Names[n.ID] = n.Name
		byDay := map[string]*dayAgg{}
		for _, sp := range n.Trend {
			if sp.Time <= 0 {
				continue
			}
			t := time.Unix(sp.Time, 0)
			day := t.Format("2006-01-02")
			ag := byDay[day]
			if ag == nil {
				ag = &dayAgg{}
				byDay[day] = ag
			}
			ag.Samples++
			ag.CPUSum += sp.CPU
			if sp.CPU > ag.CPUPeak {
				ag.CPUPeak = sp.CPU
				ag.PeakTime = sp.Time
			}
			mem := pct(sp.MemUsed, sp.MemTotal)
			ag.MemSum += mem
			if mem > ag.MemPeak {
				ag.MemPeak = mem
			}
			if t.Hour() < 6 {
				ag.Night++
			}
		}
		for day, ag := range byDay {
			if s.data.Days[day] == nil {
				s.data.Days[day] = map[string]*dayAgg{}
			}
			s.data.Days[day][n.ID] = ag
		}
	}
	for day, m := range s.data.Days {
		for id := range m {
			if !active[id] {
				delete(m, id)
			}
		}
		if len(m) == 0 {
			delete(s.data.Days, day)
		}
	}
	for id := range s.data.Names {
		if !active[id] {
			delete(s.data.Names, id)
		}
	}
	if len(events) > 0 {
		byDay := map[string]*dayEvents{}
		for _, e := range events {
			if e.Time <= 0 {
				continue
			}
			day := time.Unix(e.Time, 0).Format("2006-01-02")
			de := byDay[day]
			if de == nil {
				de = &dayEvents{}
				byDay[day] = de
			}
			de.Total++
			if e.Level == "error" {
				de.Error++
			}
		}
		for day, de := range byDay {
			s.data.Events[day] = de
		}
	}
	s.data.Updated = time.Now().Unix()
	return s.saveLocked()
}

func (s *Store) saveLocked() bool {
	b, err := json.Marshal(&s.data)
	if err != nil {
		return false
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return false
	}
	tmp := s.path + ".tmp"
	if os.WriteFile(tmp, b, 0o600) != nil {
		return false
	}
	return os.Rename(tmp, s.path) == nil
}

type Peak struct {
	Node  string  `json:"node"`
	Value float64 `json:"value"`
	Time  int64   `json:"time"`
}

type NodeStat struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Samples   int     `json:"samples"`
	Days      int     `json:"days"`
	CPUAvg    float64 `json:"cpu_avg"`
	CPUPeak   float64 `json:"cpu_peak"`
	MemAvg    float64 `json:"mem_avg"`
	MemPeak   float64 `json:"mem_peak"`
	Night     int     `json:"night"`
	OnlinePct float64 `json:"online_pct"`
}

type MonthStat struct {
	Month   string  `json:"month"`
	Label   string  `json:"label"`
	Samples int     `json:"samples"`
	CPUAvg  float64 `json:"cpu_avg"`
	Days    int     `json:"days"`
}

type Report struct {
	Year      int         `json:"year"`
	Time      int64       `json:"time"`
	Version   string      `json:"version"`
	Days      int         `json:"days"`
	FirstDay  string      `json:"first_day"`
	LastDay   string      `json:"last_day"`
	Samples   int         `json:"samples"`
	Night     int         `json:"night"`
	Events    int         `json:"events"`
	Errors    int         `json:"errors"`
	CPUAvg    float64     `json:"cpu_avg"`
	Peak      Peak        `json:"peak"`
	Nodes     []NodeStat  `json:"nodes"`
	Monthly   []MonthStat `json:"monthly"`
	Busiest   *NodeStat   `json:"busiest,omitempty"`
	Calmest   *NodeStat   `json:"calmest,omitempty"`
	Steadiest *NodeStat   `json:"steadiest,omitempty"`
	NightOwl  *NodeStat   `json:"night_owl,omitempty"`
}

type nodeAcc struct {
	stat     NodeStat
	cpuSum   float64
	memSum   float64
	peakTime int64
	days     map[string]bool
}

func (s *Store) Report(year int, version string) Report {
	s.mu.Lock()
	defer s.mu.Unlock()
	rep := Report{Year: year, Time: time.Now().Unix(), Version: version, Nodes: []NodeStat{}, Monthly: []MonthStat{}}
	if rep.Year <= 0 {
		rep.Year = time.Now().Year()
	}
	prefix := fmt.Sprintf("%04d-", rep.Year)

	days := make([]string, 0, 400)
	for day := range s.data.Days {
		if strings.HasPrefix(day, prefix) {
			days = append(days, day)
		}
	}
	sort.Strings(days)
	if len(days) == 0 {
		return rep
	}
	rep.FirstDay = days[0]
	rep.LastDay = days[len(days)-1]
	rep.Days = len(days)

	acc := map[string]*nodeAcc{}
	expected := 0
	monthSamples := map[int]int{}
	monthCPU := map[int]float64{}
	monthDays := map[string]bool{}
	peak := Peak{}
	for _, day := range days {
		m := s.data.Days[day]
		dayMax := 0
		for _, ag := range m {
			if ag.Samples > dayMax {
				dayMax = ag.Samples
			}
		}
		if dayMax > 288 {
			dayMax = 288
		}
		expected += dayMax
		mi := int(0)
		if len(day) >= 7 {
			fmt.Sscanf(day[5:7], "%d", &mi)
		}
		if mi >= 1 && mi <= 12 {
			monthDays[day] = true
		}
		for id, ag := range m {
			a := acc[id]
			if a == nil {
				a = &nodeAcc{stat: NodeStat{ID: id, Name: s.data.Names[id]}, days: map[string]bool{}}
				acc[id] = a
			}
			if a.stat.Name == "" {
				a.stat.Name = id
			}
			a.stat.Samples += ag.Samples
			a.stat.CPUPeak = maxF(a.stat.CPUPeak, ag.CPUPeak)
			a.stat.MemPeak = maxF(a.stat.MemPeak, ag.MemPeak)
			a.stat.Night += ag.Night
			a.cpuSum += ag.CPUSum
			a.memSum += ag.MemSum
			a.days[day] = true
			if ag.PeakTime > a.peakTime {
				a.peakTime = ag.PeakTime
			}
			if ag.CPUPeak > peak.Value {
				peak = Peak{Node: a.stat.Name, Value: ag.CPUPeak, Time: ag.PeakTime}
			}
			rep.Samples += ag.Samples
			rep.Night += ag.Night
			monthSamples[mi] += ag.Samples
			monthCPU[mi] += ag.CPUSum
		}
	}

	names := make([]string, 0, len(acc))
	for id := range acc {
		names = append(names, id)
	}
	sort.Strings(names)
	cpuTotal := 0.0
	for _, id := range names {
		a := acc[id]
		a.stat.Days = len(a.days)
		if a.stat.Samples > 0 {
			a.stat.CPUAvg = round1(a.cpuSum / float64(a.stat.Samples))
			a.stat.MemAvg = round1(a.memSum / float64(a.stat.Samples))
		}
		if expected > 0 {
			a.stat.OnlinePct = round1(float64(a.stat.Samples) / float64(expected) * 100)
			if a.stat.OnlinePct > 100 {
				a.stat.OnlinePct = 100
			}
		}
		cpuTotal += a.cpuSum
		rep.Nodes = append(rep.Nodes, a.stat)
	}
	if rep.Samples > 0 {
		rep.CPUAvg = round1(cpuTotal / float64(rep.Samples))
	}
	rep.Peak = peak

	sort.Slice(rep.Nodes, func(i, j int) bool {
		if rep.Nodes[i].CPUAvg == rep.Nodes[j].CPUAvg {
			return rep.Nodes[i].Samples > rep.Nodes[j].Samples
		}
		return rep.Nodes[i].CPUAvg > rep.Nodes[j].CPUAvg
	})
	for i := range rep.Nodes {
		n := &rep.Nodes[i]
		if n.Samples == 0 {
			continue
		}
		if rep.Busiest == nil || n.CPUAvg > rep.Busiest.CPUAvg {
			rep.Busiest = n
		}
		if rep.Calmest == nil || n.CPUAvg < rep.Calmest.CPUAvg {
			rep.Calmest = n
		}
		if rep.Steadiest == nil || n.OnlinePct > rep.Steadiest.OnlinePct {
			rep.Steadiest = n
		}
		if rep.NightOwl == nil || n.Night > rep.NightOwl.Night {
			rep.NightOwl = n
		}
	}

	firstMonth, lastMonth := 12, 1
	for day := range monthDays {
		mi := 0
		if len(day) >= 7 {
			fmt.Sscanf(day[5:7], "%d", &mi)
		}
		if mi < firstMonth {
			firstMonth = mi
		}
		if mi > lastMonth {
			lastMonth = mi
		}
	}
	for mi := firstMonth; mi <= lastMonth; mi++ {
		ms := MonthStat{Month: fmt.Sprintf("%04d-%02d", rep.Year, mi), Label: fmt.Sprintf("%d月", mi), Samples: monthSamples[mi]}
		if ms.Samples > 0 {
			ms.CPUAvg = round1(monthCPU[mi] / float64(ms.Samples))
		}
		for day := range monthDays {
			dmi := 0
			if len(day) >= 7 {
				fmt.Sscanf(day[5:7], "%d", &dmi)
			}
			if dmi == mi {
				ms.Days++
			}
		}
		rep.Monthly = append(rep.Monthly, ms)
	}

	for day, de := range s.data.Events {
		if strings.HasPrefix(day, prefix) {
			rep.Events += de.Total
			rep.Errors += de.Error
		}
	}
	return rep
}

func pct(used, total uint64) float64 {
	if total == 0 {
		return 0
	}
	return float64(used) / float64(total) * 100
}

func maxF(a, b float64) float64 {
	if b > a {
		return b
	}
	return a
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}
