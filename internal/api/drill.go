package api

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"kaypanel/internal/ai"
	"kaypanel/internal/insight"
)

type drillStep struct {
	ID   string
	Text string
	OK   bool
	Why  string
}

type drillScenario struct {
	ID      string
	Title   string
	Level   string
	Tag     string
	Scene   string
	Signals []string
	Steps   []drillStep
}

var drillScenarios = []drillScenario{
	{
		ID: "disk-full", Title: "磁盘写满引发的雪崩", Level: "P1", Tag: "存储",
		Scene:   "凌晨 02:10，飞牛 NAS 根分区使用率达到 100%，容器陆续退出，反向代理开始返回 502，SSH 登录明显变慢。",
		Signals: []string{"根分区使用率 100%", "docker ps 出现大量 Exited", "反向代理返回 502", "df -i 的 inode 占用正常"},
		Steps: []drillStep{
			{ID: "df", Text: "用 df -h 与 du -xhd1 / 排序定位大目录", OK: true, Why: "先量化占用来源，避免盲目删除"},
			{ID: "docker-df", Text: "用 docker system df 查看镜像、容器日志与卷占用", OK: true, Why: "容器环境常见的空间黑洞在这里"},
			{ID: "logrotate", Text: "检查 /var/log 与容器 json 日志的轮转配置", OK: true, Why: "日志未轮转是磁盘写满的高频原因"},
			{ID: "clean-log", Text: "清理可删旧日志，并补上 logrotate / compose 日志上限", OK: true, Why: "止血同时防止再次发生"},
			{ID: "backup", Text: "删除前确认数据可删，并备份关键配置", OK: true, Why: "清理动作不可逆，先保留退路"},
			{ID: "rm-docker", Text: "直接 rm -rf /var/lib/docker 释放空间", OK: false, Why: "会丢失全部镜像、容器与卷数据"},
			{ID: "reboot", Text: "重启整台服务器释放文件句柄", OK: false, Why: "磁盘满时重启可能直接无法再起来"},
			{ID: "expand", Text: "评估扩容分区或把数据目录迁到独立磁盘", OK: true, Why: "从容量规划层面解决根因"},
		},
	},
	{
		ID: "mem-leak", Title: "内存缓慢泄漏", Level: "P2", Tag: "内存",
		Scene:   "华为云 2C2G 节点内存连续 6 小时从 55% 缓慢涨到 96%，Swap 开始使用，SSH 偶尔卡顿，业务容器并没有重启记录。",
		Signals: []string{"内存曲线持续上升", "Swap 使用率 28%", "SSH 偶尔卡顿", "业务容器运行时长正常"},
		Steps: []drillStep{
			{ID: "free", Text: "free -h 并对照历史曲线确认增长趋势", OK: true, Why: "先判断是泄漏还是短时峰值"},
			{ID: "ps-mem", Text: "用 ps --sort=-%mem 找持续增长的进程", OK: true, Why: "定位到进程才能进一步定位代码或配置"},
			{ID: "oom", Text: "查看 dmesg 中的 OOM 记录", OK: true, Why: "确认是否已经发生过内核杀进程"},
			{ID: "limit", Text: "检查服务/容器的内存限制与重启策略", OK: true, Why: "缺失限制会让单服务拖垮整机"},
			{ID: "restart", Text: "对异常服务限流或重启，并保留现场日志", OK: true, Why: "先恢复服务，同时保留证据"},
			{ID: "swap", Text: "直接加 8G Swap 掩盖问题", OK: false, Why: "Swap 会放大 IO 抖动，泄漏仍在继续"},
			{ID: "reboot", Text: "直接重启整台服务器", OK: false, Why: "治标不治本，问题会再次出现"},
			{ID: "smaps", Text: "用 /proc/<pid>/smaps 观察可疑进程的内存段", OK: true, Why: "区分堆、映射文件与匿名内存增长"},
		},
	},
	{
		ID: "ssh-lockout", Title: "改 SSH 配置后失联", Level: "P1", Tag: "SSH",
		Scene:   "你把 sshd 端口从 22 改成 2222 并重启 sshd，新连接全部被拒绝；当前旧会话还能操作，云控制台 VNC 可用。",
		Signals: []string{"新连接 Connection refused", "旧 SSH 会话仍然可用", "22 端口已无监听", "云控制台可登录"},
		Steps: []drillStep{
			{ID: "keep", Text: "保持当前旧会话不退出", OK: true, Why: "旧会话是最后的远程操作通道"},
			{ID: "syntax", Text: "用 sshd -t 校验配置语法", OK: true, Why: "语法错误会让 sshd 无法启动"},
			{ID: "firewall", Text: "检查防火墙与云安全组是否放行 2222", OK: true, Why: "端口改了但访问规则没改是常见疏忽"},
			{ID: "nc", Text: "从另一台机器用 nc -vz 验证端口", OK: true, Why: "区分是 sshd 未启动还是链路被拦"},
			{ID: "backup", Text: "修改前备份 sshd_config 并准备回滚", OK: true, Why: "配置类操作必须可回退"},
			{ID: "vnc", Text: "保持云控制台 VNC 在线后再重启 sshd", OK: true, Why: "保留一条不依赖 SSH 的通道"},
			{ID: "reboot", Text: "直接 reboot 服务器", OK: false, Why: "重启不会修复配置错误，还可能失去 VNC 之外的入口"},
			{ID: "disable-fw", Text: "关闭防火墙或清空安全组", OK: false, Why: "暴露面骤增，属于危险操作"},
		},
	},
	{
		ID: "dns-fail", Title: "容器内 DNS 解析失败", Level: "P2", Tag: "网络",
		Scene:   "应用容器内访问 api.example.com 报 Temporary failure in name resolution，宿主机 curl 正常，其他节点访问同一域名也正常。",
		Signals: []string{"仅容器内解析失败", "宿主机 dig 正常", "容器最近改过网络配置", "其他节点访问正常"},
		Steps: []drillStep{
			{ID: "resolv", Text: "docker exec 进入容器查看 /etc/resolv.conf", OK: true, Why: "先确认容器实际使用的 DNS 地址"},
			{ID: "compare", Text: "把容器 resolv.conf 与宿主机对照", OK: true, Why: "差异能直接指出问题所在"},
			{ID: "inspect", Text: "docker network inspect 查看网络的 DNS 配置", OK: true, Why: "自定义网络的 DNS 行为与默认桥接不同"},
			{ID: "daemon", Text: "检查 daemon.json 中是否配置了 dns", OK: true, Why: "daemon 级配置会影响所有容器"},
			{ID: "dig", Text: "在容器内用 dig/nslookup 复现并测试不同 DNS", OK: true, Why: "定位是解析链路还是上游服务问题"},
			{ID: "upstream", Text: "检查上游 DNS 是否限流或故障", OK: true, Why: "只修容器可能只是绕过了真正故障点"},
			{ID: "hosts", Text: "直接在容器里写死 hosts 后不追根因", OK: false, Why: "临时绕过会在容器重建后失效并留下隐患"},
			{ID: "restart-net", Text: "重启宿主机网络服务", OK: false, Why: "影响面大，且可能中断当前 SSH 连接"},
		},
	},
	{
		ID: "cert-expire", Title: "HTTPS 证书过期", Level: "P1", Tag: "证书",
		Scene:   "早上 9 点，站点 HTTPS 全部提示证书过期，HTTP 访问正常，用户开始投诉；证书原本由 ACME 自动续期。",
		Signals: []string{"浏览器提示证书过期", "HTTP 访问正常", "证书由 ACME 自动续期", "最近没有改过 Nginx 配置"},
		Steps: []drillStep{
			{ID: "openssl", Text: "用 openssl s_client 查看证书有效期与域名", OK: true, Why: "先确认过期事实与证书链完整度"},
			{ID: "logs", Text: "检查 ACME 客户端续期日志", OK: true, Why: "自动续期失败通常留有错误原因"},
			{ID: "dryrun", Text: "用 certbot renew --dry-run 验证续期链路", OK: true, Why: "不消耗正式配额就能验证问题是否已修复"},
			{ID: "reach", Text: "检查 80/443 与 DNS 验证是否可达", OK: true, Why: "验证失败是续期失败的最常见原因"},
			{ID: "reload", Text: "续期成功后 nginx -t 并平滑 reload", OK: true, Why: "先校验再生效，避免二次故障"},
			{ID: "monitor", Text: "为证书到期增加拨测或提醒", OK: true, Why: "把一次性事故变成可观测指标"},
			{ID: "http-only", Text: "直接关闭 HTTPS 继续用 HTTP", OK: false, Why: "会引入明文传输与浏览器不安全警告"},
			{ID: "rm-cert", Text: "删除证书文件后裸签且不备份", OK: false, Why: "失败时连回滚材料都没有"},
		},
	},
	{
		ID: "load-spike", Title: "负载飙高但 CPU 不高", Level: "P2", Tag: "性能",
		Scene:   "飞牛 NAS 15 分钟负载达到 18，CPU 只有 35%，Docker 应用响应变慢，磁盘指示灯持续常亮。",
		Signals: []string{"load15 达到 18", "CPU 使用率仅 35%", "应用响应变慢", "磁盘活动明显"},
		Steps: []drillStep{
			{ID: "uptime", Text: "用 uptime 与 top 观察负载和运行队列", OK: true, Why: "先确认是 CPU 型还是 IO 型负载"},
			{ID: "iostat", Text: "用 iostat -x 2 查看磁盘 await 与 %util", OK: true, Why: "CPU 不高而负载高，IO 等待是首要嫌疑"},
			{ID: "dstate", Text: "用 ps 查找 D 状态进程", OK: true, Why: "D 状态进程是 IO 阻塞的直接证据"},
			{ID: "tasks", Text: "检查是否有备份、同步或媒体刮削任务", OK: true, Why: "NAS 上的定时任务常是负载来源"},
			{ID: "changelog", Text: "对照变更记录确认最近做过的操作", OK: true, Why: "把负载峰值与变更时间线对应起来"},
			{ID: "limit", Text: "对异常容器限流，或把 IO 任务错峰迁移", OK: true, Why: "从调度层面消除资源争抢"},
			{ID: "killall", Text: "直接 kill -9 所有高负载进程", OK: false, Why: "可能杀掉数据库等关键进程并造成数据损坏"},
			{ID: "reboot", Text: "直接重启整机", OK: false, Why: "中断业务且无法定位根因"},
		},
	},
}

type drillStepView struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type drillScenarioView struct {
	ID      string          `json:"id"`
	Title   string          `json:"title"`
	Level   string          `json:"level"`
	Tag     string          `json:"tag"`
	Scene   string          `json:"scene"`
	Signals []string        `json:"signals"`
	Steps   []drillStepView `json:"steps"`
	Key     int             `json:"key_steps"`
}

func findDrill(id string) *drillScenario {
	for i := range drillScenarios {
		if drillScenarios[i].ID == id {
			return &drillScenarios[i]
		}
	}
	return nil
}

func drillScenarioViews() []drillScenarioView {
	out := make([]drillScenarioView, 0, len(drillScenarios))
	for _, sc := range drillScenarios {
		v := drillScenarioView{ID: sc.ID, Title: sc.Title, Level: sc.Level, Tag: sc.Tag, Scene: sc.Scene, Signals: sc.Signals}
		for _, st := range sc.Steps {
			v.Steps = append(v.Steps, drillStepView{ID: st.ID, Text: st.Text})
			if st.OK {
				v.Key++
			}
		}
		out = append(out, v)
	}
	return out
}

func (s *Server) handleDrillList(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"scenarios": drillScenarioViews(),
		"runs":      s.insights.Drills(),
		"ai":        aiReady(s.store.Settings()),
	})
}

type drillEvalReq struct {
	Scenario string   `json:"scenario"`
	Steps    []string `json:"steps"`
	Note     string   `json:"note"`
}

type drillStepResult struct {
	ID       string `json:"id"`
	Text     string `json:"text"`
	OK       bool   `json:"ok"`
	Selected bool   `json:"selected"`
	Why      string `json:"why"`
}

func drillVerdict(score int) string {
	switch {
	case score >= 90:
		return "优秀"
	case score >= 70:
		return "合格"
	case score >= 50:
		return "待加强"
	default:
		return "需要复盘"
	}
}

func (s *Server) handleDrillEval(w http.ResponseWriter, r *http.Request) {
	var req drillEvalReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	sc := findDrill(req.Scenario)
	if sc == nil {
		writeErr(w, http.StatusNotFound, "演练场景不存在")
		return
	}
	if len(req.Steps) > 30 {
		writeErr(w, http.StatusBadRequest, "提交的步骤过多")
		return
	}
	selected := map[string]bool{}
	for _, id := range req.Steps {
		selected[id] = true
	}
	var passed, missed, wrong []string
	detail := make([]drillStepResult, 0, len(sc.Steps))
	hit, total, penalty := 0, 0, 0
	for _, st := range sc.Steps {
		if st.OK {
			total++
		}
		sel := selected[st.ID]
		detail = append(detail, drillStepResult{ID: st.ID, Text: st.Text, OK: st.OK, Selected: sel, Why: st.Why})
		switch {
		case st.OK && sel:
			hit++
			passed = append(passed, st.Text)
		case st.OK && !sel:
			missed = append(missed, st.Text)
		case !st.OK && sel:
			penalty++
			wrong = append(wrong, st.Text)
		}
	}
	score := 0
	if total > 0 {
		score = int(math.Round(float64(hit) / float64(total) * 100))
	}
	score -= penalty * 12
	if score < 0 {
		score = 0
	}
	feedback := drillLocalFeedback(score, hit, total, missed, wrong)
	usedAI := false
	aiErr := ""
	set := s.store.Settings()
	if aiReady(set) {
		ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
		defer cancel()
		prompt := fmt.Sprintf("场景：%s\n背景：%s\n用户选择的动作：%s\n遗漏的关键动作：%s\n误选的高风险动作：%s\n用户补充判断：%s",
			sc.Title, sc.Scene, joinOr(selectedTexts(sc, selected), "无"), joinOr(missed, "无"), joinOr(wrong, "无"), strings.TrimSpace(req.Note))
		reply, err := ai.ChatTokens(ctx, set.AIBase, set.AIKey, set.AIModel, []ai.Message{
			{Role: "system", Content: "你是 SRE 教官，负责点评故障演练。用中文给一段 100-160 字的点评：先肯定思路中正确的地方，再指出最关键的一条改进，最后给一句可执行的提醒。不要复述题目，不要编造系统状态，不要输出代码块或列表。"},
			{Role: "user", Content: prompt},
		}, 400)
		if err != nil {
			aiErr = err.Error()
		} else if strings.TrimSpace(reply) != "" {
			feedback = clipText(strings.TrimSpace(reply), 900)
			usedAI = true
		}
	}
	run := s.insights.AddDrill(insight.DrillRun{
		Scenario: sc.Title,
		Score:    score,
		Passed:   passed,
		Missed:   missed,
		Wrong:    wrong,
		Feedback: feedback,
		AI:       usedAI,
	})
	s.audit.Add("admin", "", "故障演练", fmt.Sprintf("%s · %d 分", sc.Title, score))
	writeJSON(w, http.StatusOK, map[string]any{
		"run":      run,
		"steps":    detail,
		"verdict":  drillVerdict(score),
		"ai_error": aiErr,
	})
}

func selectedTexts(sc *drillScenario, selected map[string]bool) []string {
	var out []string
	for _, st := range sc.Steps {
		if selected[st.ID] {
			out = append(out, st.Text)
		}
	}
	return out
}

func joinOr(list []string, empty string) string {
	if len(list) == 0 {
		return empty
	}
	return strings.Join(list, "；")
}

func drillLocalFeedback(score, hit, total int, missed, wrong []string) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "本场得分 %d 分（%s），命中 %d/%d 个关键动作。", score, drillVerdict(score), hit, total)
	if hit == 0 {
		sb.WriteString(" 先按“观察现象 → 定位资源 → 确认根因 → 再动手”的顺序思考，不要一上来就重启或删除。")
	}
	if len(wrong) > 0 {
		fmt.Fprintf(&sb, " 有 %d 个高风险动作不该选：%s。", len(wrong), firstItems(wrong, 2))
	}
	if len(missed) > 0 {
		fmt.Fprintf(&sb, " 还遗漏了 %d 个关键动作，优先补上：%s。", len(missed), firstItems(missed, 2))
	}
	switch {
	case score >= 90:
		sb.WriteString(" 处置思路完整，可以尝试更高难度场景。")
	case score >= 70:
		sb.WriteString(" 主线正确，注意把验证与回滚动作纳入流程。")
	case score >= 50:
		sb.WriteString(" 方向基本对，但排查顺序与风险控制还需要加强。")
	default:
		sb.WriteString(" 建议先复盘场景信号，再重新演练一次。")
	}
	return sb.String()
}

func firstItems(list []string, n int) string {
	if len(list) > n {
		list = list[:n]
	}
	return strings.Join(list, "；")
}
