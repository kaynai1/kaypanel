package metrics

import (
	"strconv"
	"strings"
	"time"
)

type Snapshot struct {
	Time          int64   `json:"time"`
	CPU           float64 `json:"cpu"`
	MemUsed       uint64  `json:"mem_used"`
	MemTotal      uint64  `json:"mem_total"`
	SwapUsed      uint64  `json:"swap_used"`
	SwapTotal     uint64  `json:"swap_total"`
	DiskUsed      uint64  `json:"disk_used"`
	DiskTotal     uint64  `json:"disk_total"`
	Load1         float64 `json:"load1"`
	Load5         float64 `json:"load5"`
	Load15        float64 `json:"load15"`
	Uptime        float64 `json:"uptime"`
	NetRx         float64 `json:"net_rx"`
	NetTx         float64 `json:"net_tx"`
	Temp          float64 `json:"temp"`
	Cores         int     `json:"cores"`
	DockerRunning int     `json:"docker_running"`
	DockerTotal   int     `json:"docker_total"`
	DockerError   string  `json:"docker_error,omitempty"`
	Hostname      string  `json:"hostname"`
	Kernel        string  `json:"kernel"`
	OS            string  `json:"os"`
}

type cpuStat struct {
	total uint64
	idle  uint64
	ok    bool
}

type Processor struct {
	prevCPU  cpuStat
	prevRx   uint64
	prevTx   uint64
	prevTime time.Time
}

func Script() string {
	return `
echo '@@@KP_STAT'; head -n1 /proc/stat 2>/dev/null
echo '@@@KP_MEM'; grep -E '^(MemTotal|MemAvailable|MemFree|Buffers|Cached|SwapTotal|SwapFree):' /proc/meminfo 2>/dev/null
echo '@@@KP_LOAD'; cat /proc/loadavg 2>/dev/null
echo '@@@KP_UPTIME'; cut -d' ' -f1 /proc/uptime 2>/dev/null
echo '@@@KP_DF'; df -Pk / 2>/dev/null
echo '@@@KP_NET'; cat /proc/net/dev 2>/dev/null
echo '@@@KP_TEMP'
for f in /sys/class/thermal/thermal_zone*/temp /sys/class/hwmon/hwmon*/temp*_input; do [ -r "$f" ] && cat "$f" 2>/dev/null; done
echo '@@@KP_INFO'
echo "host=$(hostname 2>/dev/null)"
echo "kernel=$(uname -r 2>/dev/null)"
echo "os=$(. /etc/os-release 2>/dev/null && printf '%s' "$PRETTY_NAME")"
echo "cores=$( (nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null) | head -n1)"
echo '@@@KP_DOCKER'
if command -v docker >/dev/null 2>&1; then docker ps -a --format '{{.State}}' 2>&1 | head -n 500; else echo 'docker-not-found'; fi
echo '@@@KP_END'
`
}

func sections(out string) map[string][]string {
	m := map[string][]string{}
	cur := ""
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(line, "@@@KP_") {
			cur = strings.TrimSpace(strings.TrimPrefix(line, "@@@KP_"))
			m[cur] = []string{}
			continue
		}
		if cur != "" {
			m[cur] = append(m[cur], line)
		}
	}
	return m
}

func (p *Processor) Next(out string, now time.Time) Snapshot {
	sec := sections(out)
	snap := Snapshot{Time: now.Unix()}

	if lines := sec["STAT"]; len(lines) > 0 {
		if total, idle, ok := parseCPU(lines[0]); ok {
			if p.prevCPU.ok && total > p.prevCPU.total {
				dt := float64(total - p.prevCPU.total)
				di := float64(idle - p.prevCPU.idle)
				v := (dt - di) / dt * 100
				if v < 0 {
					v = 0
				}
				if v > 100 {
					v = 100
				}
				snap.CPU = round1(v)
			}
			p.prevCPU = cpuStat{total: total, idle: idle, ok: true}
		}
	}

	mem := parseKV(sec["MEM"])
	snap.MemTotal = mem["MemTotal"] * 1024
	avail := mem["MemAvailable"]
	if avail == 0 {
		avail = mem["MemFree"] + mem["Buffers"] + mem["Cached"]
	}
	if avail < snap.MemTotal {
		snap.MemUsed = snap.MemTotal - avail
	}
	snap.SwapTotal = mem["SwapTotal"] * 1024
	snap.SwapUsed = (mem["SwapTotal"] - mem["SwapFree"]) * 1024

	if lines := sec["LOAD"]; len(lines) > 0 {
		f := strings.Fields(lines[0])
		for i := 0; i < 3 && i < len(f); i++ {
			v, _ := strconv.ParseFloat(f[i], 64)
			switch i {
			case 0:
				snap.Load1 = v
			case 1:
				snap.Load5 = v
			case 2:
				snap.Load15 = v
			}
		}
	}

	if lines := sec["UPTIME"]; len(lines) > 0 {
		snap.Uptime, _ = strconv.ParseFloat(strings.TrimSpace(lines[0]), 64)
	}

	for _, line := range sec["DF"] {
		f := strings.Fields(line)
		if len(f) < 4 {
			continue
		}
		if f[0] == "Filesystem" {
			continue
		}
		total, _ := strconv.ParseUint(f[1], 10, 64)
		used, _ := strconv.ParseUint(f[2], 10, 64)
		if total > 0 {
			snap.DiskTotal = total * 1024
			snap.DiskUsed = used * 1024
			break
		}
	}

	var rx, tx uint64
	for _, line := range sec["NET"] {
		i := strings.Index(line, ":")
		if i < 0 {
			continue
		}
		name := strings.TrimSpace(line[:i])
		if name == "lo" || name == "" {
			continue
		}
		f := strings.Fields(strings.TrimSpace(line[i+1:]))
		if len(f) < 9 {
			continue
		}
		a, _ := strconv.ParseUint(f[0], 10, 64)
		b, _ := strconv.ParseUint(f[8], 10, 64)
		rx += a
		tx += b
	}
	if !p.prevTime.IsZero() && now.After(p.prevTime) {
		dt := now.Sub(p.prevTime).Seconds()
		if dt > 0 {
			drx := float64(rx) - float64(p.prevRx)
			dtx := float64(tx) - float64(p.prevTx)
			if drx >= 0 {
				snap.NetRx = round1(drx / dt)
			}
			if dtx >= 0 {
				snap.NetTx = round1(dtx / dt)
			}
		}
	}
	p.prevRx = rx
	p.prevTx = tx
	p.prevTime = now

	var temp float64
	for _, line := range sec["TEMP"] {
		v, err := strconv.ParseFloat(strings.TrimSpace(line), 64)
		if err != nil || v <= 0 {
			continue
		}
		if v > 1000 {
			v = v / 1000
		}
		if v > 5 && v < 130 && v > temp {
			temp = v
		}
	}
	snap.Temp = round1(temp)

	for _, line := range sec["INFO"] {
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch k {
		case "host":
			snap.Hostname = v
		case "kernel":
			snap.Kernel = v
		case "os":
			snap.OS = v
		case "cores":
			snap.Cores, _ = strconv.Atoi(strings.TrimSpace(v))
		}
	}

	snap.DockerRunning = -1
	snap.DockerTotal = -1
	var dockerErr string
	for _, line := range sec["DOCKER"] {
		l := strings.TrimSpace(line)
		if l == "" {
			continue
		}
		switch l {
		case "running":
			if snap.DockerRunning < 0 {
				snap.DockerRunning = 0
			}
			snap.DockerRunning++
			if snap.DockerTotal < 0 {
				snap.DockerTotal = 0
			}
			snap.DockerTotal++
		case "exited", "created", "paused", "restarting", "dead", "removing":
			if snap.DockerRunning < 0 {
				snap.DockerRunning = 0
			}
			if snap.DockerTotal < 0 {
				snap.DockerTotal = 0
			}
			snap.DockerTotal++
		default:
			switch {
			case strings.Contains(l, "docker-not-found"), strings.Contains(l, "docker: not found"):
				if dockerErr == "" {
					dockerErr = "未安装 Docker"
				}
			case strings.Contains(l, "permission denied"):
				if dockerErr == "" {
					dockerErr = "无权限访问 Docker（请在节点设置中开启 sudo）"
				}
			case strings.Contains(l, "Cannot connect"):
				if dockerErr == "" {
					dockerErr = "无法连接 Docker 服务"
				}
			default:
				if snap.DockerTotal < 0 {
					snap.DockerTotal = 0
				}
			}
		}
	}
	if snap.DockerRunning < 0 {
		snap.DockerRunning = 0
	}
	if snap.DockerTotal < 0 {
		snap.DockerTotal = 0
	}
	if len(dockerErr) > 200 {
		dockerErr = dockerErr[:200]
	}
	snap.DockerError = dockerErr

	return snap
}

func parseCPU(line string) (total, idle uint64, ok bool) {
	f := strings.Fields(line)
	if len(f) < 5 || f[0] != "cpu" {
		return 0, 0, false
	}
	vals := make([]uint64, 0, 8)
	for _, s := range f[1:] {
		v, err := strconv.ParseUint(s, 10, 64)
		if err != nil {
			continue
		}
		vals = append(vals, v)
	}
	for i := 0; i < 8 && i < len(vals); i++ {
		total += vals[i]
	}
	if len(vals) > 4 {
		idle = vals[3] + vals[4]
	} else if len(vals) > 3 {
		idle = vals[3]
	}
	return total, idle, true
}

func parseKV(lines []string) map[string]uint64 {
	m := map[string]uint64{}
	for _, line := range lines {
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		k := strings.TrimSuffix(f[0], ":")
		v, err := strconv.ParseUint(f[1], 10, 64)
		if err == nil {
			m[k] = v
		}
	}
	return m
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}

type Process struct {
	PID     string  `json:"pid"`
	Comm    string  `json:"comm"`
	CPU     float64 `json:"cpu"`
	Mem     float64 `json:"mem"`
	Elapsed string  `json:"elapsed"`
}

func ProcessesCommand() string {
	return `ps -eo pid=,comm=,%cpu=,%mem=,etime= --sort=-%cpu 2>/dev/null | head -n 20`
}

func ParseProcesses(out string) []Process {
	var list []Process
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 5 {
			continue
		}
		cpu, _ := strconv.ParseFloat(f[len(f)-3], 64)
		mem, _ := strconv.ParseFloat(f[len(f)-2], 64)
		list = append(list, Process{
			PID:     f[0],
			Comm:    strings.Join(f[1:len(f)-3], " "),
			CPU:     round1(cpu),
			Mem:     round1(mem),
			Elapsed: f[len(f)-1],
		})
	}
	return list
}
