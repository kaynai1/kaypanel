package api

import (
	"net/http"
	"strconv"
	"time"

	"kaypanel/internal/wrapped"
)

func (s *Server) handleWrapped(w http.ResponseWriter, r *http.Request) {
	year := time.Now().Year()
	if v := r.URL.Query().Get("year"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 2000 && n <= 2100 {
			year = n
		}
	}
	views := s.mgr.Views()
	nodes := make([]wrapped.NodeData, 0, len(views))
	events := []wrapped.Event{}
	for _, v := range views {
		n, ok := s.mgr.Get(v.ID)
		if !ok {
			continue
		}
		nodes = append(nodes, wrapped.NodeData{ID: v.ID, Name: v.Name, Trend: n.Trend()})
		for _, e := range n.Events() {
			events = append(events, wrapped.Event{Time: e.Time, Level: e.Level})
		}
	}
	s.wrapMu.Lock()
	st := wrapped.New(s.store.Dir())
	st.Update(nodes, events)
	rep := st.Report(year, s.version)
	s.wrapMu.Unlock()
	writeJSON(w, http.StatusOK, rep)
}
