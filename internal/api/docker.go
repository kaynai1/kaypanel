package api

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
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

type inspectDetail struct {
	ID     string `json:"Id"`
	Name   string `json:"Name"`
	Config struct {
		Hostname   string            `json:"Hostname"`
		User       string            `json:"User"`
		Env        []string          `json:"Env"`
		Cmd        []string          `json:"Cmd"`
		Entrypoint []string          `json:"Entrypoint"`
		Image      string            `json:"Image"`
		WorkingDir string            `json:"WorkingDir"`
		Labels     map[string]string `json:"Labels"`
	} `json:"Config"`
	HostConfig struct {
		Binds        []string `json:"Binds"`
		PortBindings map[string][]struct {
			HostIP   string `json:"HostIp"`
			HostPort string `json:"HostPort"`
		} `json:"PortBindings"`
		RestartPolicy struct {
			Name string `json:"Name"`
		} `json:"RestartPolicy"`
		NetworkMode string   `json:"NetworkMode"`
		Privileged  bool     `json:"Privileged"`
		CapAdd      []string `json:"CapAdd"`
		CapDrop     []string `json:"CapDrop"`
		Devices     []struct {
			PathOnHost        string `json:"PathOnHost"`
			PathInContainer   string `json:"PathInContainer"`
			CgroupPermissions string `json:"CgroupPermissions"`
		} `json:"Devices"`
		ExtraHosts []string          `json:"ExtraHosts"`
		Dns        []string          `json:"Dns"`
		Tmpfs      map[string]string `json:"Tmpfs"`
		ShmSize    int64             `json:"ShmSize"`
		NanoCpus   int64             `json:"NanoCpus"`
		Memory     int64             `json:"Memory"`
	} `json:"HostConfig"`
}

func (s *Server) handleContainerUpdate(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	cid := r.PathValue("cid")
	if !node.ValidContainerRef(cid) {
		writeErr(w, http.StatusBadRequest, "容器标识不合法")
		return
	}
	ctx := r.Context()
	out, err := n.OutputCtx(ctx, "docker inspect "+node.ShQuote(cid), 30*time.Second)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "读取容器配置失败: "+dockerError(err))
		return
	}
	var list []inspectDetail
	if err := json.Unmarshal([]byte(out), &list); err != nil || len(list) == 0 {
		writeErr(w, http.StatusBadGateway, "无法解析容器配置")
		return
	}
	d := list[0]
	name := strings.TrimPrefix(d.Name, "/")
	if !node.ValidContainerRef(name) {
		writeErr(w, http.StatusBadRequest, "容器名称不合法")
		return
	}
	image := strings.TrimSpace(d.Config.Image)
	if image == "" {
		writeErr(w, http.StatusBadRequest, "容器没有镜像信息")
		return
	}

	labels := d.Config.Labels
	proj := labels["com.docker.compose.project"]
	svc := labels["com.docker.compose.service"]
	workDir := labels["com.docker.compose.project.working_dir"]
	confFiles := labels["com.docker.compose.project.config_files"]

	var script string
	if proj != "" && svc != "" && workDir != "" {
		dc := "DC='docker compose'"
		cmd := "cd " + node.ShQuote(workDir) + " && "
		var files []string
		for _, f := range strings.Split(confFiles, ",") {
			if f = strings.TrimSpace(f); f != "" {
				files = append(files, "-f "+node.ShQuote(f))
			}
		}
		base := "$DC -p " + node.ShQuote(proj) + " " + strings.Join(files, " ") + " "
		script = dc + `
docker compose version >/dev/null 2>&1 || DC='docker-compose'
` + cmd + base + "pull " + node.ShQuote(svc) + " && " + cmd + base + "up -d " + node.ShQuote(svc)
	} else {
		script = buildRecreateScript(d, name, image)
	}

	out2, err := n.OutputCtx(ctx, script, 10*time.Minute)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "更新失败: "+dockerError(err)+"\n"+tail(out2, 800))
		return
	}
	s.audit.Add("admin", n.Config().ID, "容器.更新", name)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "output": tail(out2, 2000)})
}

func buildRecreateScript(d inspectDetail, name, image string) string {
	q := node.ShQuote
	old := name + "-kp-old-" + strconv.FormatInt(time.Now().Unix(), 10)
	var args []string
	add := func(flag string, vals ...string) {
		for _, v := range vals {
			if v != "" {
				args = append(args, flag, q(v))
			}
		}
	}
	for _, e := range d.Config.Env {
		add("-e", e)
	}
	keys := make([]string, 0, len(d.HostConfig.PortBindings))
	for k := range d.HostConfig.PortBindings {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, port := range keys {
		for _, b := range d.HostConfig.PortBindings[port] {
			hp := b.HostPort
			if hp == "" {
				hp = port
			}
			spec := hp + ":" + port
			if b.HostIP != "" {
				spec = b.HostIP + ":" + spec
			}
			args = append(args, "-p", q(spec))
		}
	}
	for _, b := range d.HostConfig.Binds {
		add("-v", b)
	}
	if rp := d.HostConfig.RestartPolicy.Name; rp != "" && rp != "no" {
		add("--restart", rp)
	}
	if nm := d.HostConfig.NetworkMode; nm != "" && nm != "default" && nm != "bridge" {
		add("--network", nm)
	}
	if d.HostConfig.Privileged {
		args = append(args, "--privileged")
	}
	for _, c := range d.HostConfig.CapAdd {
		add("--cap-add", c)
	}
	for _, c := range d.HostConfig.CapDrop {
		add("--cap-drop", c)
	}
	for _, dev := range d.HostConfig.Devices {
		spec := dev.PathOnHost + ":" + dev.PathInContainer
		if dev.CgroupPermissions != "" {
			spec += ":" + dev.CgroupPermissions
		}
		args = append(args, "--device", q(spec))
	}
	for _, h := range d.HostConfig.ExtraHosts {
		add("--add-host", h)
	}
	for _, dn := range d.HostConfig.Dns {
		add("--dns", dn)
	}
	tkeys := make([]string, 0, len(d.HostConfig.Tmpfs))
	for k := range d.HostConfig.Tmpfs {
		tkeys = append(tkeys, k)
	}
	sort.Strings(tkeys)
	for _, k := range tkeys {
		spec := k
		if v := d.HostConfig.Tmpfs[k]; v != "" {
			spec += ":" + v
		}
		args = append(args, "--tmpfs", q(spec))
	}
	if d.HostConfig.ShmSize > 0 {
		add("--shm-size", strconv.FormatInt(d.HostConfig.ShmSize, 10))
	}
	if d.HostConfig.NanoCpus > 0 {
		add("--cpus", strconv.FormatFloat(float64(d.HostConfig.NanoCpus)/1e9, 'f', 2, 64))
	}
	if d.HostConfig.Memory > 0 {
		add("--memory", strconv.FormatInt(d.HostConfig.Memory, 10))
	}
	if u := d.Config.User; u != "" {
		add("--user", u)
	}
	if wd := d.Config.WorkingDir; wd != "" {
		add("-w", wd)
	}
	if h := d.Config.Hostname; h != "" && !strings.HasPrefix(d.ID, h) {
		add("--hostname", h)
	}
	lkeys := make([]string, 0, len(d.Config.Labels))
	for k := range d.Config.Labels {
		if strings.HasPrefix(k, "com.docker.compose.") {
			continue
		}
		lkeys = append(lkeys, k)
	}
	sort.Strings(lkeys)
	for _, k := range lkeys {
		add("--label", k+"="+d.Config.Labels[k])
	}
	entry := d.Config.Entrypoint
	var tailArgs []string
	if len(entry) > 0 {
		add("--entrypoint", entry[0])
		tailArgs = append(tailArgs, entry[1:]...)
	}
	tailArgs = append(tailArgs, d.Config.Cmd...)
	run := "docker run -d --name " + q(name) + " " + strings.Join(args, " ") + " " + q(image)
	for _, a := range tailArgs {
		run += " " + q(a)
	}
	return `docker pull ` + q(image) + ` || { echo '拉取镜像失败，容器未改动' >&2; exit 1; }
docker stop ` + q(name) + ` >/dev/null 2>&1 || true
docker rename ` + q(name) + ` ` + q(old) + `
if ` + run + `; then
  docker rm ` + q(old) + ` >/dev/null 2>&1 || true
else
  echo '启动新容器失败，正在回滚' >&2
  docker rm -f ` + q(name) + ` >/dev/null 2>&1 || true
  docker rename ` + q(old) + ` ` + q(name) + `
  docker start ` + q(name) + ` >/dev/null 2>&1 || true
  exit 1
fi`
}

func tail(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		return s[len(s)-n:]
	}
	return s
}
