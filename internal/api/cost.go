package api

import (
	"net/http"
	"sort"
	"strconv"
	"time"
)

type costNode struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Online    bool    `json:"online"`
	SFTPOnly  bool    `json:"sftp_only"`
	Watts     float64 `json:"watts"`
	KWhDay    float64 `json:"kwh_day"`
	CostDay   float64 `json:"cost_day"`
	CostMonth float64 `json:"cost_month"`
	CostYear  float64 `json:"cost_year"`
}

type costReport struct {
	Time        int64      `json:"time"`
	Price       float64    `json:"price"`
	TotalWatts  float64    `json:"total_watts"`
	KWhToday    float64    `json:"kwh_today"`
	CostToday   float64    `json:"cost_today"`
	CostMonth   float64    `json:"cost_month"`
	CostYear    float64    `json:"cost_year"`
	Configured  int        `json:"configured"`
	Unconfigured int       `json:"unconfigured"`
	Nodes       []costNode `json:"nodes"`
}

func round2(v float64) float64 {
	return float64(int64(v*100+0.5)) / 100
}

func (s *Server) handleCost(w http.ResponseWriter, r *http.Request) {
	set := s.store.Settings()
	price := set.CostPerKWh
	if price <= 0 {
		price = 0.6
	}
	views := s.mgr.Views()
	now := time.Now()
	dayFrac := float64(now.Hour()*3600+now.Minute()*60+now.Second()) / 86400
	daysInMonth := float64(time.Date(now.Year(), now.Month()+1, 0, 0, 0, 0, 0, now.Location()).Day())
	report := costReport{Time: now.Unix(), Price: round2(price), Nodes: make([]costNode, 0, len(views))}
	for _, v := range views {
		it := costNode{ID: v.ID, Name: v.Name, Online: v.Online, SFTPOnly: v.SFTPOnly, Watts: v.PowerWatts}
		if it.SFTPOnly {
			it.Watts = 0
		}
		if it.Watts > 0 {
			report.Configured++
			it.KWhDay = it.Watts * 24 / 1000
			it.CostDay = it.KWhDay * price
			it.CostMonth = it.CostDay * daysInMonth
			it.CostYear = it.CostDay * 365
			report.TotalWatts += it.Watts
			report.KWhToday += it.KWhDay * dayFrac
			report.CostToday += it.CostDay * dayFrac
			report.CostMonth += it.CostMonth
			report.CostYear += it.CostYear
		} else if !it.SFTPOnly {
			report.Unconfigured++
		}
		it.KWhDay = round2(it.KWhDay)
		it.CostDay = round2(it.CostDay)
		it.CostMonth = round2(it.CostMonth)
		it.CostYear = round2(it.CostYear)
		report.Nodes = append(report.Nodes, it)
	}
	sort.SliceStable(report.Nodes, func(i, j int) bool { return report.Nodes[i].CostMonth > report.Nodes[j].CostMonth })
	report.TotalWatts = round2(report.TotalWatts)
	report.KWhToday = round2(report.KWhToday)
	report.CostToday = round2(report.CostToday)
	report.CostMonth = round2(report.CostMonth)
	report.CostYear = round2(report.CostYear)
	writeJSON(w, http.StatusOK, report)
}

func (s *Server) handleCostPrice(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Price float64 `json:"price"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if req.Price < 0.05 || req.Price > 20 {
		writeErr(w, http.StatusBadRequest, "电价需在 0.05-20 元/度之间")
		return
	}
	if err := s.store.SetCostPerKWh(req.Price); err != nil {
		writeErr(w, http.StatusInternalServerError, "保存失败: "+err.Error())
		return
	}
	s.audit.Add("admin", "", "修改电价", strconv.FormatFloat(req.Price, 'f', 2, 64)+" 元/度")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "price": req.Price})
}

func (s *Server) handleNodePower(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Watts float64 `json:"watts"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if req.Watts < 0 || req.Watts > 5000 {
		writeErr(w, http.StatusBadRequest, "功率需在 0-5000W 之间")
		return
	}
	if _, ok := s.mgr.Get(id); !ok {
		writeErr(w, http.StatusNotFound, "节点不存在")
		return
	}
	if err := s.mgr.SetPower(id, req.Watts); err != nil {
		writeErr(w, http.StatusInternalServerError, "保存失败: "+err.Error())
		return
	}
	s.audit.Add("admin", id, "设置功率", strconv.FormatFloat(req.Watts, 'f', 0, 64)+"W")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "watts": req.Watts})
}
