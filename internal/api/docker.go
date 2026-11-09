package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"kaypanel/internal/node"
)

type container struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Image      string `json:"image"`
	State      string `json:"state"`
	Status     string `json:"status"`
	Ports      string `json:"ports"`
	Project    string `json:"project"`
	Health     string `json:"health"`
	RunningFor string `json:"running_for"`
}

type psLine struct {
	ID         string `json:"ID"`
	Names      string `json:"Names"`
	Image      string `json:"Image"`
	State      string `json:"State"`
	Status     string `json:"Status"`
	Ports      string `json:"Ports"`
	Labels     string `json:"Labels"`
	RunningFor string `json:"RunningFor"`
}

func dockerError(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "docker: not found"), strings.Contains(msg, "docker: command not found"):
		return "节点未安装 Docker"
	case strings.Contains(msg, "permission denied"):
		return "当前 SSH 用户无权访问 Docker，请在节点设置中开启 sudo"
	case strings.Contains(msg, "Cannot connect to the Docker daemon"):
		return "无法连接 Docker 服务，请确认 Docker 正在运行"
	}
	return msg
}

func (s *Server) handleContainers(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	out, err := n.OutputCtx(r.Context(), `docker ps -a --format '{{json .}}'`, 20*time.Second)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"containers": []container{}, "error": dockerError(err)})
		return
	}
	list := make([]container, 0, 32)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "{") {
			continue
		}
		var p psLine
		if json.Unmarshal([]byte(line), &p) != nil {
			continue
		}
		id := p.ID
		if len(id) > 12 {
			id = id[:12]
		}
		project := ""
		for _, kv := range strings.Split(p.Labels, ",") {
			if strings.HasPrefix(kv, "com.docker.compose.project=") {
				project = strings.TrimPrefix(kv, "com.docker.compose.project=")
			}
		}
		health := ""
		switch {
		case strings.Contains(p.Status, "(healthy)"):
			health = "healthy"
		case strings.Contains(p.Status, "(unhealthy)"):
			health = "unhealthy"
		case strings.Contains(p.Status, "(health: starting)"):
			health = "starting"
		}
		list = append(list, container{
			ID:         id,
			Name:       p.Names,
			Image:      p.Image,
			State:      p.State,
			Status:     p.Status,
			Ports:      p.Ports,
			Project:    project,
			Health:     health,
			RunningFor: p.RunningFor,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"containers": list})
}

type statLine struct {
	ID       string `json:"ID"`
	Name     string `json:"Name"`
	CPUPerc  string `json:"CPUPerc"`
	MemUsage string `json:"MemUsage"`
	MemPerc  string `json:"MemPerc"`
	NetIO    string `json:"NetIO"`
	BlockIO  string `json:"BlockIO"`
	PIDs     string `json:"PIDs"`
}

func (s *Server) handleContainerStats(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	out, err := n.OutputCtx(r.Context(), `docker stats --no-stream --format '{{json .}}'`, 30*time.Second)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"stats": []statLine{}, "error": dockerError(err)})
		return
	}
	list := make([]statLine, 0, 16)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "{") {
			continue
		}
		var st statLine
		if json.Unmarshal([]byte(line), &st) == nil {
			list = append(list, st)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"stats": list})
}

type containerActionReq struct {
	Action string `json:"action"`
	Force  bool   `json:"force"`
}

func (s *Server) handleContainerAction(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	cid := r.PathValue("cid")
	if !node.ValidContainerRef(cid) {
		writeErr(w, http.StatusBadRequest, "容器标识不合法")
		return
	}
	var req containerActionReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	var cmd string
	switch req.Action {
	case "start":
		cmd = "docker start " + cid
	case "stop":
		cmd = "docker stop " + cid
	case "restart":
		cmd = "docker restart " + cid
	case "pause":
		cmd = "docker pause " + cid
	case "unpause":
		cmd = "docker unpause " + cid
	case "remove":
		cmd = "docker rm "
		if req.Force {
			cmd += "-f "
		}
		cmd += cid
	default:
		writeErr(w, http.StatusBadRequest, "不支持的操作")
		return
	}
	out, err := n.OutputCtx(r.Context(), cmd, 60*time.Second)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "操作失败: "+dockerError(err))
		return
	}
	s.audit.Add("admin", n.Config().ID, "容器."+req.Action, cid)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "output": out})
}

type imageItem struct {
	ID           string `json:"id"`
	Repository   string `json:"repository"`
	Tag          string `json:"tag"`
	Size         string `json:"size"`
	CreatedSince string `json:"created_since"`
}

func (s *Server) handleImages(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	out, err := n.OutputCtx(r.Context(), `docker images --format '{{json .}}'`, 20*time.Second)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"images": []imageItem{}, "error": dockerError(err)})
		return
	}
	var list []imageItem
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "{") {
			continue
		}
		var raw struct {
			ID           string `json:"ID"`
			Repository   string `json:"Repository"`
			Tag          string `json:"Tag"`
			Size         string `json:"Size"`
			CreatedSince string `json:"CreatedSince"`
		}
		if json.Unmarshal([]byte(line), &raw) != nil {
			continue
		}
		id := raw.ID
		if len(id) > 19 {
			id = id[:19]
		}
		list = append(list, imageItem{
			ID:           id,
			Repository:   raw.Repository,
			Tag:          raw.Tag,
			Size:         raw.Size,
			CreatedSince: raw.CreatedSince,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"images": list})
}

func (s *Server) handleImagePrune(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	out, err := n.OutputCtx(r.Context(), `docker image prune -f`, 90*time.Second)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "清理失败: "+dockerError(err))
		return
	}
	s.audit.Add("admin", n.Config().ID, "镜像清理", "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "output": out})
}
