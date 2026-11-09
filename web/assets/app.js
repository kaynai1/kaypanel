'use strict';

const TOP_PAGES = ['overview', 'containers', 'apps', 'files', 'terminal', 'settings'];
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const state = {
  authed: false,
  version: '',
  settings: { cpu_alert: 90, mem_alert: 90, disk_alert: 90 },
  nodes: [],
  selected: localStorage.getItem('kp_node') || '',
  page: 'overview',
  subview: null,
  pageTimer: null,
  procTimer: null,
  nodeTimer: null,
  overviewError: '',
  processes: [],
  procNode: '',
  containerList: [],
  containerStats: {},
  containerError: '',
  ctrFilter: 'all',
  stacks: [],
  stacksError: '',
  stacksComposeOK: true,
  filePath: '',
  files: null,
  fileNode: '',
  terminal: null,
  logs: null,
  audit: [],
};

/* ---------- helpers ---------- */

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtBytes(n) {
  if (n == null || isNaN(n)) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = Number(n), i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

function fmtRate(n) { return `${fmtBytes(n || 0)}/s`; }

function pct(used, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (used / total) * 100));
}

function fmtPct(v) { return `${(Number(v) || 0).toFixed(1)}%`; }

function fmtUptime(sec) {
  sec = Math.floor(Number(sec) || 0);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分钟`;
}

function fmtTime(unix) {
  if (!unix) return '-';
  const d = new Date(unix * 1000);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function timeAgo(unix) {
  if (!unix) return '-';
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - unix));
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return fmtTime(unix).split(' ')[0];
}

function joinPath(base, name) {
  return (base.endsWith('/') ? base : base + '/') + name;
}

function toast(msg, type = '', ms = 3400) {
  const wrap = $('#toast');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, ms);
}

async function api(path, opts = {}) {
  const headers = Object.assign({ 'X-KayPanel': '1' }, opts.headers || {});
  if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, Object.assign({}, opts, { credentials: 'same-origin', headers }));
  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.includes('application/json')) {
    try { data = await res.json(); } catch (e) { data = null; }
  }
  if (res.status === 401) {
    showLogin();
    throw new Error('登录已过期');
  }
  if (!res.ok) throw new Error((data && data.error) || res.statusText || '请求失败');
  return data;
}

function currentNode() {
  return state.nodes.find(n => n.id === state.selected) || null;
}

function ensureSelected() {
  if (!state.nodes.find(n => n.id === state.selected)) {
    state.selected = state.nodes.length ? state.nodes[0].id : '';
    if (state.selected) localStorage.setItem('kp_node', state.selected);
    else localStorage.removeItem('kp_node');
  }
}

function wsURL(path) {
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + path;
}

/* ---------- login ---------- */

function showLogin() {
  if (!state.authed) { renderLogin(); return; }
  state.authed = false;
  if (state.pageTimer) clearInterval(state.pageTimer);
  if (state.procTimer) clearInterval(state.procTimer);
  if (state.nodeTimer) clearInterval(state.nodeTimer);
  state.pageTimer = state.procTimer = state.nodeTimer = null;
  closeLogDrawer();
  disposeTerminal();
  renderLogin();
}

function renderLogin() {
  $('#app').innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <img class="login-logo" src="/assets/logo.svg" alt="">
        <h1 class="login-title">KayPanel</h1>
        <p class="login-sub">多机服务器管理面板</p>
        <form id="loginForm">
          <div class="login-field">
            <input id="loginPwd" type="password" autocomplete="current-password" placeholder="管理员密码" autofocus>
          </div>
          <button class="btn primary" type="submit">登 录</button>
        </form>
        <div class="login-error" id="loginError"></div>
        <div class="login-foot">首次启动的初始密码请查看服务端启动日志</div>
      </div>
    </div>`;
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const pwd = $('#loginPwd').value;
    if (!pwd) return;
    $('#loginError').textContent = '';
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-KayPanel': '1' },
        body: JSON.stringify({ password: pwd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '登录失败');
      location.reload();
    } catch (err) {
      $('#loginError').textContent = err.message;
      $('#loginPwd').select();
    }
  });
}

/* ---------- shell & routing ---------- */

function renderShell() {
  $('#app').innerHTML = `
    <header class="topbar">
      <div class="brand">
        <img class="brand-logo" src="/assets/logo.svg" alt="">
        <div class="brand-text"><b>KayPanel</b><span class="brand-sub">多机管理</span></div>
      </div>
      <nav class="tabs" id="tabs">
        <button class="tab" data-page="overview">概览</button>
        <button class="tab" data-page="containers">容器</button>
        <button class="tab" data-page="apps">应用</button>
        <button class="tab" data-page="files">文件</button>
        <button class="tab" data-page="terminal">终端</button>
        <button class="tab" data-page="settings">设置</button>
      </nav>
      <div class="top-right">
        <span class="ver">${esc(state.version || 'dev')}</span>
        <button class="btn-logout" id="logoutBtn">退出</button>
      </div>
    </header>
    <div class="subbar">
      <div class="node-pills" id="nodePills"></div>
      <div class="sub-right"><span class="live-dot"></span><span>实时监控</span></div>
    </div>
    <main class="page" id="page"></main>`;

  $('#tabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-page]');
    if (btn) navigate(btn.dataset.page);
  });
  $('#nodePills').addEventListener('click', e => {
    const btn = e.target.closest('[data-node]');
    if (btn) selectNode(btn.dataset.node);
  });
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch (e) {}
    location.reload();
  });
  updateTabs();
  updateNodePills();
}

function updateTabs() {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === state.page));
  const tabs = $('#tabs');
  const active = tabs && tabs.querySelector('.tab.active');
  if (tabs && active && tabs.scrollWidth > tabs.clientWidth) {
    active.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
}

function updateNodePills() {
  const wrap = $('#nodePills');
  if (!wrap) return;
  if (!state.nodes.length) {
    wrap.innerHTML = `<span class="pill-label">节点</span><span class="muted" style="font-size:12.5px">尚未添加节点</span>`;
    return;
  }
  wrap.innerHTML = `<span class="pill-label">节点</span>` + state.nodes.map(n => `
    <button class="node-pill ${n.id === state.selected ? 'active' : ''}" data-node="${esc(n.id)}" title="${esc(n.name + ' · ' + n.addr)}">
      <span class="dot ${n.online ? 'online' : 'offline'}"></span>${esc(n.name)}
    </button>`).join('') + `<span class="node-count">${state.nodes.length} 台</span>`;
}

function navigate(page) {
  if (!TOP_PAGES.includes(page)) page = 'overview';
  state.subview = null;
  state.page = page;
  const hash = '#/' + page;
  if (location.hash !== hash) {
    location.hash = hash;
  } else {
    renderPage();
  }
}

function onRoute() {
  const p = (location.hash.replace(/^#\/?/, '') || 'overview');
  state.page = TOP_PAGES.includes(p) ? p : 'overview';
  state.subview = null;
  renderPage();
}

function selectNode(id) {
  if (!id || id === state.selected) return;
  state.selected = id;
  localStorage.setItem('kp_node', id);
  state.filePath = '';
  state.files = null;
  state.fileNode = '';
  state.processes = [];
  state.procNode = '';
  updateNodePills();
  if (state.page === 'overview' && !state.subview) {
    drawOverview();
    loadProcesses();
  } else if (!state.subview) {
    renderPage();
  }
}

function cleanupPage() {
  if (state.pageTimer) { clearInterval(state.pageTimer); state.pageTimer = null; }
  if (state.procTimer) { clearInterval(state.procTimer); state.procTimer = null; }
  closeLogDrawer();
  disposeTerminal();
}

function renderPage() {
  cleanupPage();
  updateTabs();
  updateNodePills();
  const sub = state.subview;
  if (sub && sub.type === 'stack-edit') return renderStackEditor(sub);
  if (sub && sub.type === 'file-edit') return renderFileEditor(sub);
  if (sub && sub.type === 'node-edit') return renderNodeForm(sub);
  switch (state.page) {
    case 'overview': return renderOverview();
    case 'containers': return renderContainers();
    case 'apps': return renderApps();
    case 'files': return renderFiles();
    case 'terminal': return renderTerminalPage();
    case 'settings': return renderSettings();
    default: return renderOverview();
  }
}

/* ---------- overview ---------- */

async function loadOverview(render = true) {
  try {
    const data = await api('/api/overview');
    state.overviewError = '';
    state.nodes = data.nodes || [];
    state.settings = data.settings || state.settings;
    if (data.version) state.version = data.version;
    ensureSelected();
    updateNodePills();
    if (render && state.page === 'overview' && !state.subview) drawOverview();
  } catch (e) {
    state.overviewError = e.message;
    if (state.page === 'overview' && !state.subview) drawOverview();
  }
}

async function refreshNodesLight() {
  if (state.page === 'overview' && !state.subview) return;
  try {
    const d = await api('/api/nodes?light=1');
    const list = d.nodes || [];
    for (const item of list) {
      const old = state.nodes.find(x => x.id === item.id);
      if (old && old.history) item.history = old.history;
    }
    state.nodes = list;
    ensureSelected();
    updateNodePills();
  } catch (e) { /* keep current view */ }
}

function renderOverview() {
  drawOverview();
  loadProcesses();
  state.pageTimer = setInterval(() => loadOverview(true), 3000);
  state.procTimer = setInterval(loadProcesses, 9000);
}

let chartSeq = 0;

function chartSVG(series, opts = {}) {
  const height = opts.height || 112;
  const w = 600, h = height, pad = 6;
  const all = [];
  series.forEach(s => s.values.forEach(v => { if (typeof v === 'number' && isFinite(v)) all.push(v); }));
  const peak = Math.max(opts.max || 0, ...all);
  const mx = peak > 0 ? peak : 1;
  let defs = '', paths = '';
  for (const s of series) {
    const vals = s.values.filter(v => typeof v === 'number' && isFinite(v));
    if (vals.length < 2) continue;
    const step = (w - pad * 2) / (vals.length - 1);
    const pts = vals.map((v, i) => [pad + i * step, h - pad - (Math.max(0, Math.min(v, mx)) / mx) * (h - pad * 2)]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    if (s.fill) {
      const gid = 'kp-grad-' + (++chartSeq);
      defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity="0.22"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
      paths += `<path d="${line} L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z" fill="url(#${gid})"/>`;
    }
    paths += `<path class="chart-line" d="${line}" stroke="${s.color}"/>`;
  }
  if (!paths) return `<div class="chart-empty">等待采样数据…</div>`;
  const grids = [0.25, 0.5, 0.75].map(f => `<line class="grid-line" x1="0" y1="${(h * f).toFixed(1)}" x2="${w}" y2="${(h * f).toFixed(1)}"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${defs}${grids}${paths}</svg>`;
}

function nodeCard(n) {
  const m = n.latest || {};
  const memP = pct(m.mem_used, m.mem_total);
  const diskP = pct(m.disk_used, m.disk_total);
  const hist = (n.history || []).map(s => s.cpu || 0);
  const alerts = (n.alerts || []).filter(a => a !== '离线');
  return `
  <article class="node-card ${n.id === state.selected ? 'active' : ''} ${n.online ? '' : 'offline-card'}" data-node="${esc(n.id)}" tabindex="0">
    <div class="node-card-top">
      <div>
        <h3 class="node-name">${esc(n.name)}</h3>
        <div class="node-addr">${esc(n.user)}@${esc(n.addr)}</div>
      </div>
      <span class="chip ${n.online ? 'online' : 'offline'}">${n.online ? '在线' : '离线'}</span>
    </div>
    ${alerts.length ? `<div class="alert-row">${alerts.map(a => `<span class="alert-chip">${esc(a)}</span>`).join('')}</div>` : ''}
    <div class="node-metrics">
      <div>
        <div class="metric-label">CPU</div>
        <div class="big-metric"><b>${m.cpu != null ? Number(m.cpu).toFixed(1) : '-'}</b><span>%</span></div>
      </div>
      <div class="mini-chart">${chartSVG([{ values: hist, color: 'var(--accent)', fill: true }], { height: 42, max: 100 })}</div>
    </div>
    <div class="bars">
      <div class="bar-row"><span class="bar-label">内存</span><div class="bar-track"><div class="bar-fill mem ${memP >= state.settings.mem_alert ? 'warn' : ''}" style="width:${memP.toFixed(1)}%"></div></div><span class="bar-value">${m.mem_total ? memP.toFixed(0) + '%' : '-'}</span></div>
      <div class="bar-row"><span class="bar-label">磁盘</span><div class="bar-track"><div class="bar-fill disk ${diskP >= state.settings.disk_alert ? 'warn' : ''}" style="width:${diskP.toFixed(1)}%"></div></div><span class="bar-value">${m.disk_total ? diskP.toFixed(0) + '%' : '-'}</span></div>
    </div>
    <div class="node-foot">
      <span>负载 ${m.load1 != null ? Number(m.load1).toFixed(2) : '-'}</span>
      <span>↓ ${fmtRate(m.net_rx)}</span>
      <span>↑ ${fmtRate(m.net_tx)}</span>
      <span>${m.uptime ? fmtUptime(m.uptime) : '-'}</span>
    </div>
  </article>`;
}

function processRows(list) {
  if (!list || !list.length) return `<tr><td colspan="4" class="muted">暂无数据</td></tr>`;
  return list.slice(0, 10).map(p => `
    <tr>
      <td><span class="proc-comm">${esc(p.comm)}</span> <span class="faint">#${esc(p.pid)}</span></td>
      <td class="num">${(Number(p.cpu) || 0).toFixed(1)}%</td>
      <td class="num">${(Number(p.mem) || 0).toFixed(1)}%</td>
      <td class="faint">${esc(p.elapsed)}</td>
    </tr>`).join('');
}

function detailHTML(n) {
  const m = n.latest || {};
  const hist = n.history || [];
  const cpuSeries = hist.map(s => s.cpu || 0);
  const memSeries = hist.map(s => pct(s.mem_used, s.mem_total));
  const rxSeries = hist.map(s => s.net_rx || 0);
  const txSeries = hist.map(s => s.net_tx || 0);
  const memP = pct(m.mem_used, m.mem_total);
  const diskP = pct(m.disk_used, m.disk_total);
  const netMax = Math.max(1, ...rxSeries, ...txSeries);
  return `
    <div class="section-head">
      <div>
        <h2>节点详情 · ${esc(n.name)}</h2>
        <div class="sub">${n.online ? '在线' : '离线'} · ${esc(m.os || '')} ${m.kernel ? '· ' + esc(m.kernel) : ''}</div>
      </div>
      <div class="head-actions">
        <button class="btn sm" id="goTerminal">打开终端</button>
        <button class="btn sm ghost" id="goContainers">管理容器</button>
      </div>
    </div>
    ${!n.online && n.error ? `<div class="banner error">连接失败：${esc(n.error)}</div>` : ''}
    <div class="detail-grid">
      <div class="card chart-card span-8">
        <div class="chart-head"><span class="chart-title">CPU 使用率</span><span class="chart-value">${(Number(m.cpu) || 0).toFixed(1)}<small>% · ${m.cores || '-'} 核</small></span></div>
        <div class="chart-wrap">${chartSVG([{ values: cpuSeries, color: 'var(--accent)', fill: true }], { max: 100 })}</div>
      </div>
      <div class="card span-4">
        <div class="chart-title" style="margin-bottom:10px">系统信息</div>
        <div class="info-list">
          <div class="info-row"><span>主机名</span><span>${esc(m.hostname || '-')}</span></div>
          <div class="info-row"><span>系统</span><span class="os-pill" title="${esc(m.os || '')}">${esc(m.os || '-')}</span></div>
          <div class="info-row"><span>内核</span><span>${esc(m.kernel || '-')}</span></div>
          <div class="info-row"><span>运行时间</span><span>${m.uptime ? fmtUptime(m.uptime) : '-'}</span></div>
          <div class="info-row"><span>CPU 温度</span><span>${m.temp > 0 ? m.temp.toFixed(1) + ' °C' : '未检测到'}</span></div>
          <div class="info-row"><span>Docker</span><span>${m.docker_total >= 0 ? `${m.docker_running} 运行 / ${m.docker_total} 个` : '未安装'}</span></div>
          <div class="info-row"><span>SSH</span><span>${esc(n.user)}@${esc(n.addr)}</span></div>
        </div>
      </div>
      <div class="card chart-card span-6">
        <div class="chart-head"><span class="chart-title">内存</span><span class="chart-value">${m.mem_total ? memP.toFixed(1) : '-'}<small>%</small></span></div>
        <div class="chart-wrap">${chartSVG([{ values: memSeries, color: 'var(--blue)', fill: true }], { max: 100 })}</div>
        <div class="chart-legend"><span>${fmtBytes(m.mem_used)} / ${fmtBytes(m.mem_total)}</span>${m.swap_total ? `<span>Swap ${fmtBytes(m.swap_used)} / ${fmtBytes(m.swap_total)}</span>` : ''}</div>
      </div>
      <div class="card chart-card span-6">
        <div class="chart-head"><span class="chart-title">网络</span><span class="chart-value">${fmtRate(m.net_rx)}<small>↓ / ↑ ${fmtRate(m.net_tx)}</small></span></div>
        <div class="chart-wrap">${chartSVG([
          { values: rxSeries, color: 'var(--violet)' },
          { values: txSeries, color: 'var(--pink)' },
        ], { max: netMax })}</div>
        <div class="chart-legend">
          <span class="legend-item"><i class="legend-swatch" style="background:var(--violet)"></i>下载</span>
          <span class="legend-item"><i class="legend-swatch" style="background:var(--pink)"></i>上传</span>
        </div>
      </div>
      <div class="card span-4">
        <div class="chart-title" style="margin-bottom:12px">磁盘</div>
        <div class="big-metric"><b>${m.disk_total ? diskP.toFixed(1) : '-'}</b><span>%</span></div>
        <div class="bar-track" style="margin:10px 0 8px"><div class="bar-fill disk ${diskP >= state.settings.disk_alert ? 'warn' : ''}" style="width:${diskP.toFixed(1)}%"></div></div>
        <div class="muted" style="font-size:12.5px">${fmtBytes(m.disk_used)} / ${fmtBytes(m.disk_total)}</div>
        <div class="node-foot"><span>负载 ${(Number(m.load1) || 0).toFixed(2)} / ${(Number(m.load5) || 0).toFixed(2)} / ${(Number(m.load15) || 0).toFixed(2)}</span></div>
        ${m.docker_error ? `<div class="muted" style="font-size:11.5px;margin-top:8px;color:var(--amber)">${esc(m.docker_error)}</div>` : ''}
      </div>
      <div class="card span-8">
        <div class="chart-head"><span class="chart-title">进程 Top 10</span><span class="faint" style="font-size:11.5px">按 CPU 排序</span></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>进程</th><th style="text-align:right">CPU</th><th style="text-align:right">内存</th><th>运行时间</th></tr></thead>
            <tbody id="procBody">${processRows(state.procNode === n.id ? state.processes : [])}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function noNodeHTML(text) {
  return `<div class="card empty">
    <h3>${esc(text || '还没有添加节点')}</h3>
    <p>添加服务器后即可在这里管理容器、文件与终端。只需 SSH 地址和凭据。</p>
    <button class="btn primary" id="addNodeBtn">添加节点</button>
  </div>`;
}

function bindNoNode() {
  const btn = $('#addNodeBtn');
  if (btn) btn.addEventListener('click', () => openNodeForm(null));
}

function drawOverview() {
  const page = $('#page');
  if (!page) return;
  const sel = currentNode();
  page.innerHTML = `
    ${state.overviewError ? `<div class="banner error">${esc(state.overviewError)}</div>` : ''}
    <section class="page-head">
      <div><h1>集群总览</h1><p class="page-sub">统一查看所有节点状态，点击节点卡片可切换当前管理对象</p></div>
      <div class="head-actions"><span class="updated">每 3 秒自动刷新</span><button class="btn sm ghost" id="ovRefresh">刷新</button></div>
    </section>
    ${state.nodes.length ? `<div class="node-grid">${state.nodes.map(nodeCard).join('')}</div>` : noNodeHTML()}
    ${sel ? detailHTML(sel) : ''}`;

  const refresh = $('#ovRefresh');
  if (refresh) refresh.addEventListener('click', () => loadOverview(true));
  $$('.node-card[data-node]', page).forEach(card => {
    const go = () => selectNode(card.dataset.node);
    card.addEventListener('click', go);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  const term = $('#goTerminal');
  if (term) term.addEventListener('click', () => navigate('terminal'));
  const cont = $('#goContainers');
  if (cont) cont.addEventListener('click', () => navigate('containers'));
  bindNoNode();
}

async function loadProcesses() {
  const n = currentNode();
  if (!n) return;
  if (!n.online) {
    state.processes = [];
    state.procNode = n.id;
    updateProcTable();
    return;
  }
  try {
    const d = await api(`/api/nodes/${n.id}/processes`);
    state.processes = d.processes || [];
    state.procNode = n.id;
    updateProcTable();
  } catch (e) {
    state.processes = [];
    state.procNode = n.id;
    const body = $('#procBody');
    if (body) body.innerHTML = `<tr><td colspan="4" class="muted">${esc(e.message)}</td></tr>`;
  }
}

function updateProcTable() {
  const n = currentNode();
  const body = $('#procBody');
  if (!body || !n || state.procNode !== n.id) return;
  body.innerHTML = processRows(state.processes);
}

/* ---------- containers ---------- */

function startPolling(fn, ms) {
  if (state.pageTimer) clearInterval(state.pageTimer);
  state.pageTimer = setInterval(fn, ms);
  fn();
}

function renderContainers() {
  const n = currentNode();
  const page = $('#page');
  if (!n) {
    page.innerHTML = `<section class="page-head"><div><h1>容器</h1><p class="page-sub">Docker 容器管理</p></div></section>` + noNodeHTML();
    bindNoNode();
    return;
  }
  page.innerHTML = `
    <section class="page-head">
      <div><h1>容器</h1><p class="page-sub">${esc(n.name)} · ${esc(n.addr)}</p></div>
      <div class="head-actions"><button class="btn sm ghost" id="ctrRefresh">刷新</button></div>
    </section>
    <div id="ctrError" class="banner error hidden"></div>
    <div class="filterbar">
      <div class="seg" id="ctrFilter">
        <button data-f="all" class="${state.ctrFilter === 'all' ? 'active' : ''}">全部</button>
        <button data-f="running" class="${state.ctrFilter === 'running' ? 'active' : ''}">运行中</button>
        <button data-f="stopped" class="${state.ctrFilter === 'stopped' ? 'active' : ''}">已停止</button>
      </div>
      <input class="search-input" id="ctrSearch" placeholder="搜索容器 / 镜像">
      <div class="spacer"></div>
      <button class="btn sm ghost" id="pruneBtn">清理未使用镜像</button>
    </div>
    <div class="card ctr-list" id="ctrList"><div class="empty">加载中…</div></div>`;

  $('#ctrRefresh').addEventListener('click', loadContainers);
  $('#ctrFilter').addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    state.ctrFilter = b.dataset.f;
    $$('#ctrFilter button').forEach(x => x.classList.toggle('active', x === b));
    renderCtrRows();
  });
  $('#ctrSearch').addEventListener('input', renderCtrRows);
  $('#pruneBtn').addEventListener('click', async () => {
    if (!await confirmDialog('清理镜像', '执行 docker image prune -f，删除未被使用的悬空镜像。是否继续？', '清理')) return;
    try {
      const d = await api(`/api/nodes/${n.id}/images/prune`, { method: 'POST', body: '{}' });
      toast(firstLine(d.output) || '清理完成', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
  $('#ctrList').addEventListener('click', onContainerClick);
  startPolling(loadContainers, 5000);
}

function firstLine(s) {
  return String(s || '').trim().split('\n').filter(Boolean).slice(-1)[0] || '';
}

async function loadContainers() {
  const n = currentNode();
  if (!n) return;
  const nid = n.id;
  try {
    const [listRes, statsRes] = await Promise.allSettled([
      api(`/api/nodes/${nid}/containers`),
      api(`/api/nodes/${nid}/containers/stats`),
    ]);
    if (state.page !== 'containers' || !currentNode() || currentNode().id !== nid) return;
    if (listRes.status === 'rejected') throw listRes.reason;
    const data = listRes.value || {};
    state.containerList = data.containers || [];
    state.containerError = data.error || '';
    state.containerStats = {};
    if (statsRes.status === 'fulfilled' && statsRes.value) {
      for (const s of statsRes.value.stats || []) state.containerStats[s.Name] = s;
    }
    const err = $('#ctrError');
    if (err) {
      err.textContent = state.containerError;
      err.classList.toggle('hidden', !state.containerError);
    }
    renderCtrRows();
  } catch (e) {
    if (state.page !== 'containers') return;
    const err = $('#ctrError');
    if (err) { err.textContent = e.message; err.classList.remove('hidden'); }
  }
}

function renderCtrRows() {
  const host = $('#ctrList');
  if (!host) return;
  const search = ($('#ctrSearch') ? $('#ctrSearch').value : '').toLowerCase().trim();
  let list = state.containerList.filter(c => {
    const running = c.state === 'running';
    if (state.ctrFilter === 'running' && !running) return false;
    if (state.ctrFilter === 'stopped' && running) return false;
    if (search && !(`${c.name} ${c.image}`.toLowerCase().includes(search))) return false;
    return true;
  });
  if (!list.length) {
    host.innerHTML = `<div class="empty">${state.containerList.length ? '没有匹配的容器' : '没有容器'}</div>`;
    return;
  }
  host.innerHTML = list.map(c => {
    const st = state.containerStats[c.name];
    const running = c.state === 'running';
    const paused = c.state === 'paused';
    const stateChip = `<span class="chip ${esc(c.state || 'exited')}">${esc(ctrStateLabel(c.state))}</span>`;
    const actions = [
      paused ? `<button class="btn sm" data-act="unpause" data-id="${esc(c.id)}" data-name="${esc(c.name)}">继续</button>` : '',
      (!running && !paused) ? `<button class="btn sm" data-act="start" data-id="${esc(c.id)}" data-name="${esc(c.name)}">启动</button>` : '',
      (running || paused) ? `<button class="btn sm" data-act="stop" data-id="${esc(c.id)}" data-name="${esc(c.name)}">停止</button>` : '',
      (running || paused) ? `<button class="btn sm ghost" data-act="restart" data-id="${esc(c.id)}" data-name="${esc(c.name)}">重启</button>` : '',
      `<button class="btn sm ghost" data-act="logs" data-id="${esc(c.id)}" data-name="${esc(c.name)}">日志</button>`,
      `<button class="btn sm danger" data-act="remove" data-id="${esc(c.id)}" data-name="${esc(c.name)}">删除</button>`,
    ].filter(Boolean).join('');
    return `<div class="ctr-row">
      <div>
        <div class="ctr-name"><span class="dot ${running ? 'online' : 'offline'}"></span><span class="n">${esc(c.name)}</span>${c.project ? `<span class="tag">${esc(c.project)}</span>` : ''}</div>
        <div class="ctr-image" title="${esc(c.image)}">${esc(c.image)}</div>
      </div>
      <div class="ctr-stat">
        <span>CPU ${st ? esc(st.CPUPerc) : '-'} · 内存 ${st ? esc(st.MemPerc) : '-'}</span>
        <span class="faint">${st ? esc(st.MemUsage) : ''}</span>
      </div>
      <div class="ctr-state">${stateChip}<span class="ports" title="${esc(c.ports)}">${esc(c.ports || c.status || '')}</span></div>
      <div class="ctr-actions">${actions}</div>
    </div>`;
  }).join('');
}

function ctrStateLabel(s) {
  return ({ running: '运行中', exited: '已停止', created: '已创建', paused: '已暂停', restarting: '重启中', dead: '异常', removing: '删除中' })[s] || s || '未知';
}

async function onContainerClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const n = currentNode();
  if (!n) return;
  const act = btn.dataset.act, id = btn.dataset.id, name = btn.dataset.name;
  if (act === 'logs') { openLogDrawer(n, id, name); return; }
  if (act === 'remove') {
    if (!await confirmDialog('删除容器', `确定删除「${name}」吗？\n运行中的容器会被强制删除，容器数据卷不会被删除。`, '删除', true)) return;
  }
  btn.disabled = true;
  try {
    await api(`/api/nodes/${n.id}/containers/${encodeURIComponent(id)}/action`, {
      method: 'POST',
      body: JSON.stringify({ action: act, force: act === 'remove' }),
    });
    toast(act === 'remove' ? '已删除' : '操作成功', 'success', 1800);
    loadContainers();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
  }
}

function openLogDrawer(n, cid, name) {
  closeLogDrawer();
  const root = $('#drawer-root');
  root.innerHTML = `
    <div class="log-drawer">
      <div class="log-head">
        <span class="title">日志 · ${esc(name)}</span>
        <span class="sub">${esc(cid)}</span>
        <span class="spacer"></span>
        <select id="logTail" class="search-input" style="height:30px;min-width:110px;flex:none;padding:0 8px">
          <option value="300">最近 300 行</option>
          <option value="1000" selected>最近 1000 行</option>
          <option value="3000">最近 3000 行</option>
        </select>
        <button class="btn sm ghost" id="logClose">关闭</button>
      </div>
      <div class="log-term" id="logTerm"></div>
    </div>`;
  document.body.classList.add('no-scroll');
  const term = new Terminal({
    cursorBlink: false,
    disableStdin: true,
    fontSize: 13,
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim(),
    theme: XTERM_THEME,
    scrollback: 8000,
    convertEol: true,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($('#logTerm'));
  fit.fit();
  term.write('\x1b[90m正在连接日志流…\x1b[0m\r\n');

  let ws = null;
  const connect = (tail) => {
    if (ws) { try { ws.close(); } catch (e) {} }
    term.reset();
    term.write(`\x1b[90m正在连接日志流（最近 ${tail} 行）…\x1b[0m\r\n`);
    ws = new WebSocket(wsURL(`/ws/logs?node=${encodeURIComponent(n.id)}&id=${encodeURIComponent(cid)}&tail=${tail}`));
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => fit.fit();
    ws.onmessage = ev => {
      if (typeof ev.data === 'string') term.write(ev.data);
      else term.write(new Uint8Array(ev.data));
    };
    ws.onerror = () => term.write('\r\n\x1b[31m日志连接失败\x1b[0m\r\n');
    ws.onclose = () => { term.write('\r\n\x1b[90m连接已关闭\x1b[0m\r\n'); };
  };
  const onKey = ev => { if (ev.key === 'Escape') closeLogDrawer(); };
  const ro = new ResizeObserver(() => { try { fit.fit(); } catch (e) {} });
  ro.observe($('#logTerm'));
  $('#logClose').addEventListener('click', closeLogDrawer);
  $('#logTail').addEventListener('change', e => connect(e.target.value));
  document.addEventListener('keydown', onKey);
  connect(1000);
  state.logs = {
    close() {
      document.removeEventListener('keydown', onKey);
      ro.disconnect();
      if (ws) try { ws.close(); } catch (e) {}
      term.dispose();
      root.innerHTML = '';
      document.body.classList.remove('no-scroll');
    },
  };
}

function closeLogDrawer() {
  if (state.logs) {
    const fn = state.logs.close;
    state.logs = null;
    try { fn(); } catch (e) {}
  }
}

/* ---------- apps / stacks ---------- */

function renderApps() {
  const n = currentNode();
  const page = $('#page');
  if (!n) {
    page.innerHTML = `<section class="page-head"><div><h1>应用</h1><p class="page-sub">Compose 应用一键部署</p></div></section>` + noNodeHTML();
    bindNoNode();
    return;
  }
  page.innerHTML = `
    <section class="page-head">
      <div><h1>应用</h1><p class="page-sub">${esc(n.name)} · Compose 应用与一键模板</p></div>
      <div class="head-actions">
        <button class="btn sm ghost" id="stacksRefresh">刷新</button>
        <button class="btn sm primary" id="newStack">新建应用</button>
      </div>
    </section>
    <div id="appsError" class="banner error hidden"></div>
    <div class="stack-grid" id="stackGrid"><div class="empty">加载中…</div></div>`;

  $('#stacksRefresh').addEventListener('click', loadStacks);
  $('#newStack').addEventListener('click', () => openStackEditor('', true));
  $('#stackGrid').addEventListener('click', onStackClick);
  startPolling(loadStacks, 10000);
}

async function loadStacks() {
  const n = currentNode();
  if (!n) return;
  const nid = n.id;
  try {
    const d = await api(`/api/nodes/${nid}/stacks`);
    if (state.page !== 'apps' || state.subview) return;
    state.stacks = d.stacks || [];
    state.stacksError = d.error || '';
    state.stacksComposeOK = d.compose_ok !== false;
    const err = $('#appsError');
    if (err) {
      err.textContent = state.stacksError;
      err.classList.toggle('hidden', !state.stacksError);
    }
    renderStacks();
  } catch (e) {
    if (state.page !== 'apps') return;
    const err = $('#appsError');
    if (err) { err.textContent = e.message; err.classList.remove('hidden'); }
  }
}

function renderStacks() {
  const grid = $('#stackGrid');
  if (!grid) return;
  if (!state.stacks.length) {
    grid.innerHTML = `<div class="card empty" style="grid-column:1/-1">
      <h3>还没有 Compose 应用</h3>
      <p>从内置模板开始，或在浏览器里粘贴自己的 compose 文件。应用目录：${esc(currentNode() ? currentNode().stacks_dir : '')}</p>
      <button class="btn primary" id="newStackEmpty">新建应用</button>
    </div>`;
    const b = $('#newStackEmpty');
    if (b) b.addEventListener('click', () => openStackEditor('', true));
    return;
  }
  grid.innerHTML = state.stacks.map(s => {
    const online = s.status === 'running';
    const statusMap = { running: ['running', '运行中'], stopped: ['stopped', '已停止'], partial: ['partial', '部分运行'], error: ['error', '异常'] };
    const st = statusMap[s.status] || ['stopped', s.status];
    return `<div class="card stack-card" data-stack="${esc(s.name)}">
      <div class="stack-top">
        <div style="min-width:0">
          <h3>${esc(s.name)}</h3>
          <div class="stack-path" title="${esc(s.dir + '/' + s.file)}">${esc(s.dir)}/${esc(s.file)}</div>
        </div>
        <span class="chip ${st[0]}">${st[1]}</span>
      </div>
      <div class="stack-meta">
        <span>${s.services > 0 ? `${s.running} / ${s.services} 个服务运行` : '尚未启动'}</span>
        <span>更新于 ${timeAgo(s.updated)}</span>
      </div>
      ${s.error ? `<div class="muted" style="font-size:11.5px;color:var(--amber)">${esc(s.error)}</div>` : ''}
      <div class="stack-actions">
        <button class="btn sm ghost" data-sact="up" data-stack="${esc(s.name)}">启动</button>
        <button class="btn sm ghost" data-sact="down" data-stack="${esc(s.name)}">停止</button>
        <button class="btn sm ghost" data-sact="restart" data-stack="${esc(s.name)}">重启</button>
        <button class="btn sm ghost" data-sact="update" data-stack="${esc(s.name)}">拉取更新</button>
        <button class="btn sm" data-sact="edit" data-stack="${esc(s.name)}">编辑</button>
        <button class="btn sm danger" data-sact="delete" data-stack="${esc(s.name)}">删除</button>
      </div>
    </div>`;
  }).join('');
}

async function onStackClick(e) {
  const btn = e.target.closest('[data-sact]');
  if (!btn) return;
  const act = btn.dataset.sact, name = btn.dataset.stack;
  const n = currentNode();
  if (!n) return;
  if (act === 'edit') { openStackEditor(name, false); return; }
  if (act === 'delete') {
    if (!await confirmDialog('删除应用', `确定停止并删除应用「${name}」吗？\n将删除应用目录及 Compose 文件，容器数据卷不会被删除。`, '删除', true)) return;
    try {
      await api(`/api/nodes/${n.id}/stacks/${encodeURIComponent(name)}`, { method: 'DELETE' });
      toast('已删除', 'success');
      loadStacks();
    } catch (err) { toast(err.message, 'error'); }
    return;
  }
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = '执行中…';
  try {
    await api(`/api/nodes/${n.id}/stacks/${encodeURIComponent(name)}/action`, {
      method: 'POST',
      body: JSON.stringify({ action: act }),
    });
    toast('操作完成', 'success', 1800);
  } catch (err) {
    toast(err.message, 'error', 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
    loadStacks();
  }
}

function openStackEditor(name, isNew) {
  state.subview = { type: 'stack-edit', name, isNew };
  renderPage();
}

async function renderStackEditor(sub) {
  const n = currentNode();
  const page = $('#page');
  page.innerHTML = `<section class="page-head"><div><h1>${sub.isNew ? '新建应用' : '编辑应用'}</h1><p class="page-sub">${esc(n ? n.name : '')} · Compose</p></div></section>
    <div class="card"><div class="empty">加载中…</div></div>`;

  let content = 'services:\n';
  let templates = [];
  if (sub.isNew) {
    try {
      const d = await api('/api/templates');
      templates = d.templates || [];
      content = templates[0] ? templates[0].yaml : content;
    } catch (e) { /* ignore */ }
  } else {
    try {
      const d = await api(`/api/nodes/${n.id}/stacks/${encodeURIComponent(sub.name)}`);
      content = d.content || '';
    } catch (e) {
      page.innerHTML = `<section class="page-head"><div><h1>编辑应用</h1></div><div class="head-actions"><button class="btn sm ghost" id="stackBackTop">返回</button></div></section>
        <div class="banner error">${esc(e.message)}</div>`;
      $('#stackBackTop').addEventListener('click', () => { state.subview = null; renderPage(); });
      return;
    }
  }

  page.innerHTML = `
    <section class="page-head">
      <div><h1>${sub.isNew ? '新建应用' : '编辑应用'}</h1><p class="page-sub">${esc(n.name)} · 保存到 ${esc(n.stacks_dir)}</p></div>
      <div class="head-actions"><button class="btn sm ghost" id="stackBackTop">返回</button></div>
    </section>
    <div class="card">
      <div class="form-grid">
        <div class="field">
          <label>应用名称</label>
          <input type="text" id="stackName" value="${esc(sub.name)}" ${sub.isNew ? '' : 'readonly'} placeholder="如 uptime-kuma">
          <div class="hint">小写字母、数字、- 或 _，保存后作为 Compose 项目名</div>
        </div>
        <div class="field">
          <label>模板</label>
          <select id="stackTemplate" ${sub.isNew && templates.length ? '' : 'disabled'}>
            ${templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)} · ${esc(t.description)}</option>`).join('') || '<option>无可用模板</option>'}
          </select>
          <div class="hint">选择模板只会填入下方编辑框，可自由修改</div>
        </div>
        <div class="field full">
          <label>docker-compose.yaml</label>
          <textarea id="stackContent" class="code-editor" spellcheck="false">${esc(content)}</textarea>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn primary" id="stackSave">保存</button>
        <button class="btn" id="stackSaveUp">${sub.isNew ? '保存并启动' : '保存并更新'}</button>
        <div class="spacer"></div>
        <button class="btn ghost" id="stackBack">返回</button>
      </div>
    </div>`;

  const tplSel = $('#stackTemplate');
  if (tplSel && templates.length) {
    tplSel.addEventListener('change', async () => {
      const t = templates.find(x => x.id === tplSel.value);
      if (!t) return;
      if (await confirmDialog('载入模板', `用「${t.name}」模板覆盖当前编辑内容？`, '载入')) {
        $('#stackContent').value = t.yaml;
      }
      tplSel.value = '';
    });
  }
  const back = () => { state.subview = null; renderPage(); };
  $('#stackBack').addEventListener('click', back);
  $('#stackBackTop').addEventListener('click', back);

  const save = async (deploy) => {
    const name = $('#stackName').value.trim();
    const bodyContent = $('#stackContent').value;
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(name)) { toast('应用名称仅支持小写字母、数字、- 和 _', 'error'); return; }
    if (!bodyContent.trim()) { toast('Compose 内容不能为空', 'error'); return; }
    $('#stackSave').disabled = true;
    $('#stackSaveUp').disabled = true;
    try {
      await api(`/api/nodes/${n.id}/stacks/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify({ content: bodyContent }),
      });
      if (deploy) {
        await api(`/api/nodes/${n.id}/stacks/${encodeURIComponent(name)}/action`, {
          method: 'POST',
          body: JSON.stringify({ action: sub.isNew ? 'up' : 'update' }),
        });
      }
      toast('已保存', 'success', 1600);
      state.subview = null;
      navigate('apps');
    } catch (e) {
      toast(e.message, 'error', 6000);
      $('#stackSave').disabled = false;
      $('#stackSaveUp').disabled = false;
    }
  };
  $('#stackSave').addEventListener('click', () => save(false));
  $('#stackSaveUp').addEventListener('click', () => save(true));
}

/* ---------- files ---------- */

function renderFiles() {
  const n = currentNode();
  const page = $('#page');
  if (!n) {
    page.innerHTML = `<section class="page-head"><div><h1>文件</h1><p class="page-sub">SFTP 文件管理</p></div></section>` + noNodeHTML();
    bindNoNode();
    return;
  }
  if (state.fileNode !== n.id) {
    state.fileNode = n.id;
    state.filePath = n.file_root || '/';
    state.files = null;
  }
  page.innerHTML = `
    <section class="page-head">
      <div><h1>文件</h1><p class="page-sub">${esc(n.name)} · 根目录 ${esc(n.file_root || '/')}</p></div>
      <div class="head-actions"><button class="btn sm ghost" id="fileRefresh">刷新</button></div>
    </section>
    <div id="fileError" class="banner error hidden"></div>
    <div class="filterbar">
      <button class="btn sm ghost" id="fileUp">上一级</button>
      <div class="crumb" id="crumb"></div>
      <div class="spacer"></div>
      <button class="btn sm" id="fileMkdirBtn">新建文件夹</button>
      <button class="btn sm primary" id="fileUploadBtn">上传文件</button>
      <input type="file" id="fileInput" multiple hidden>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>名称</th><th style="text-align:right">大小</th><th>权限</th><th>修改时间</th><th style="text-align:right">操作</th></tr></thead>
        <tbody id="fileBody"><tr><td colspan="5" class="muted">加载中…</td></tr></tbody>
      </table>
    </div>`;

  $('#fileRefresh').addEventListener('click', () => loadFiles(state.filePath));
  $('#fileUp').addEventListener('click', () => {
    const root = n.file_root || '/';
    const cur = state.filePath || root;
    if (cur === root) return;
    let parent = cur.replace(/\/+$/, '');
    parent = parent.slice(0, parent.lastIndexOf('/')) || '/';
    if (root !== '/' && !(parent === root || parent.startsWith(root + '/'))) parent = root;
    state.filePath = parent || root;
    loadFiles(state.filePath);
  });
  $('#fileMkdirBtn').addEventListener('click', async () => {
    const name = await promptDialog('新建文件夹', '文件夹名称', '');
    if (!name) return;
    try {
      await api(`/api/nodes/${n.id}/files/mkdir`, { method: 'POST', body: JSON.stringify({ path: joinPath(state.filePath, name) }) });
      toast('已创建', 'success', 1600);
      loadFiles(state.filePath);
    } catch (e) { toast(e.message, 'error'); }
  });
  $('#fileUploadBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const btn = $('#fileUploadBtn');
    btn.disabled = true;
    let ok = 0;
    for (const f of files) {
      btn.textContent = `上传中 ${ok + 1}/${files.length}`;
      const fd = new FormData();
      fd.append('file', f, f.name);
      try {
        await api(`/api/nodes/${n.id}/files/upload?path=${encodeURIComponent(state.filePath)}`, { method: 'POST', body: fd });
        ok++;
      } catch (err) {
        toast(`${f.name}: ${err.message}`, 'error', 5000);
      }
    }
    btn.disabled = false;
    btn.textContent = '上传文件';
    if (ok) toast(`已上传 ${ok} 个文件`, 'success');
    loadFiles(state.filePath);
  });
  $('#fileBody').addEventListener('click', e => onFileClick(e, n));
  loadFiles(state.filePath);
}

async function loadFiles(path) {
  const n = currentNode();
  if (!n) return;
  const errEl = $('#fileError');
  try {
    const d = await api(`/api/nodes/${n.id}/files?path=${encodeURIComponent(path || n.file_root || '/')}`);
    if (state.page !== 'files' || state.subview) return;
    state.filePath = d.path;
    state.files = d;
    if (errEl) errEl.classList.add('hidden');
    renderCrumbs(d);
    renderFileRows(d);
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.classList.remove('hidden'); }
    const body = $('#fileBody');
    if (body) body.innerHTML = `<tr><td colspan="5" class="muted">加载失败</td></tr>`;
  }
}

function renderCrumbs(d) {
  const crumb = $('#crumb');
  if (!crumb) return;
  const root = d.root;
  const cur = d.path;
  let segments = [];
  if (root === '/') {
    segments.push({ label: '/', path: '/' });
    let acc = '';
    cur.split('/').filter(Boolean).forEach(seg => { acc += '/' + seg; segments.push({ label: seg, path: acc }); });
  } else {
    segments.push({ label: root, path: root });
    const rest = cur.slice(root.length).replace(/^\//, '');
    let acc = root;
    rest.split('/').filter(Boolean).forEach(seg => { acc += '/' + seg; segments.push({ label: seg, path: acc }); });
  }
  crumb.innerHTML = segments.map((s, i) =>
    `${i ? '<span class="sep">/</span>' : ''}<button data-path="${esc(s.path)}">${esc(s.label)}</button>`
  ).join('');
  $$('button[data-path]', crumb).forEach(b => b.addEventListener('click', () => {
    state.filePath = b.dataset.path;
    loadFiles(state.filePath);
  }));
}

function renderFileRows(d) {
  const body = $('#fileBody');
  if (!body) return;
  if (!d.entries.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted">空目录</td></tr>`;
    return;
  }
  body.innerHTML = d.entries.map(f => {
    const path = joinPath(d.path, f.name);
    return `<tr>
      <td>
        <button class="file-name" data-open="${esc(path)}" data-dir="${f.is_dir ? '1' : '0'}">
          <span class="file-ico">${f.is_dir ? folderIcon() : fileIcon()}</span>
          <span class="n">${esc(f.name)}${f.is_link ? ' ↗' : ''}</span>
        </button>
      </td>
      <td class="num faint">${f.is_dir ? '—' : esc(fmtBytes(f.size))}</td>
      <td class="faint mono" style="font-size:11.5px">${esc(f.mode)}</td>
      <td class="faint">${esc(fmtTime(f.mod_time))}</td>
      <td>
        <div class="file-actions">
          ${f.is_dir ? '' : `<button class="btn sm ghost" data-fedit="${esc(path)}">编辑</button><button class="btn sm ghost" data-fdl="${esc(path)}" data-name="${esc(f.name)}">下载</button>`}
          <button class="btn sm ghost" data-frename="${esc(path)}" data-name="${esc(f.name)}">重命名</button>
          <button class="btn sm danger" data-fdel="${esc(path)}" data-name="${esc(f.name)}" data-dir="${f.is_dir ? '1' : '0'}">删除</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function folderIcon() {
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>';
}

function fileIcon() {
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z"/><path d="M14 3v6h6"/></svg>';
}

async function onFileClick(e, n) {
  const openBtn = e.target.closest('[data-open]');
  if (openBtn) {
    if (openBtn.dataset.dir === '1') {
      state.filePath = openBtn.dataset.open;
      loadFiles(state.filePath);
    } else {
      openFileEditor(openBtn.dataset.open);
    }
    return;
  }
  const editBtn = e.target.closest('[data-fedit]');
  if (editBtn) { openFileEditor(editBtn.dataset.fedit); return; }
  const dlBtn = e.target.closest('[data-fdl]');
  if (dlBtn) {
    const a = document.createElement('a');
    a.href = `/api/nodes/${n.id}/files/download?path=${encodeURIComponent(dlBtn.dataset.fdl)}`;
    a.download = dlBtn.dataset.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  const rnBtn = e.target.closest('[data-frename]');
  if (rnBtn) {
    const name = await promptDialog('重命名', '新名称', rnBtn.dataset.name);
    if (!name || name === rnBtn.dataset.name) return;
    try {
      await api(`/api/nodes/${n.id}/files/rename`, {
        method: 'POST',
        body: JSON.stringify({ from: rnBtn.dataset.frename, to: joinPath(state.filePath, name) }),
      });
      toast('已重命名', 'success', 1600);
      loadFiles(state.filePath);
    } catch (err) { toast(err.message, 'error'); }
    return;
  }
  const delBtn = e.target.closest('[data-fdel]');
  if (delBtn) {
    const isDir = delBtn.dataset.dir === '1';
    if (!await confirmDialog('删除文件', `确定删除「${delBtn.dataset.name}」吗？${isDir ? '\n目录会被递归删除，无法恢复。' : ''}`, '删除', true)) return;
    try {
      await api(`/api/nodes/${n.id}/files/delete`, {
        method: 'POST',
        body: JSON.stringify({ path: delBtn.dataset.fdel, recursive: isDir }),
      });
      toast('已删除', 'success', 1600);
      loadFiles(state.filePath);
    } catch (err) { toast(err.message, 'error'); }
  }
}

function openFileEditor(path) {
  state.subview = { type: 'file-edit', path };
  renderPage();
}

async function renderFileEditor(sub) {
  const n = currentNode();
  const page = $('#page');
  page.innerHTML = `<section class="page-head"><div><h1>编辑文件</h1><p class="page-sub">${esc(sub.path)}</p></div>
    <div class="head-actions"><button class="btn sm ghost" id="fileBackTop">返回</button></div></section>
    <div class="card"><div class="empty">加载中…</div></div>`;
  const back = () => { state.subview = null; renderPage(); };
  $('#fileBackTop').addEventListener('click', back);
  try {
    const d = await api(`/api/nodes/${n.id}/files/text?path=${encodeURIComponent(sub.path)}`);
    page.innerHTML = `
      <section class="page-head">
        <div><h1>编辑文件</h1><p class="page-sub">${esc(d.path)} · ${fmtBytes(d.size)}</p></div>
        <div class="head-actions"><button class="btn sm ghost" id="fileBackTop">返回</button></div>
      </section>
      <div class="card">
        <textarea id="fileContent" class="code-editor" spellcheck="false">${esc(d.content)}</textarea>
        <div class="form-actions">
          <button class="btn primary" id="fileSave">保存</button>
          <div class="spacer"></div>
          <button class="btn ghost" id="fileBack">返回</button>
        </div>
      </div>`;
    $('#fileBackTop').addEventListener('click', back);
    $('#fileBack').addEventListener('click', back);
    $('#fileSave').addEventListener('click', async () => {
      const btn = $('#fileSave');
      btn.disabled = true;
      try {
        await api(`/api/nodes/${n.id}/files/text`, {
          method: 'PUT',
          body: JSON.stringify({ path: d.path, content: $('#fileContent').value }),
        });
        toast('已保存', 'success', 1600);
      } catch (e) { toast(e.message, 'error', 5000); }
      btn.disabled = false;
    });
  } catch (e) {
    page.innerHTML = `
      <section class="page-head"><div><h1>编辑文件</h1><p class="page-sub">${esc(sub.path)}</p></div>
      <div class="head-actions"><button class="btn sm ghost" id="fileBackTop">返回</button></div></section>
      <div class="banner error">${esc(e.message)}</div>
      <div class="card empty"><h3>无法在线编辑</h3><p>可以下载后在本地编辑。</p>
        <button class="btn" id="fileDownloadFallback">下载文件</button>
      </div>`;
    $('#fileBackTop').addEventListener('click', back);
    $('#fileDownloadFallback').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = `/api/nodes/${n.id}/files/download?path=${encodeURIComponent(sub.path)}`;
      a.click();
    });
  }
}

/* ---------- terminal ---------- */

const XTERM_THEME = {
  background: '#0a0d11',
  foreground: '#dbe4ee',
  cursor: '#5eead4',
  cursorAccent: '#0a0d11',
  selectionBackground: 'rgba(94, 234, 212, 0.25)',
  black: '#1b232c', red: '#f87171', green: '#34d399', yellow: '#fbbf24',
  blue: '#60a5fa', magenta: '#a78bfa', cyan: '#5eead4', white: '#e5eaf1',
  brightBlack: '#677283', brightRed: '#fca5a5', brightGreen: '#6ee7b7', brightYellow: '#fde68a',
  brightBlue: '#93c5fd', brightMagenta: '#c4b5fd', brightCyan: '#99f6e4', brightWhite: '#f8fafc',
};

function renderTerminalPage() {
  const n = currentNode();
  const page = $('#page');
  if (!n) {
    page.innerHTML = `<section class="page-head"><div><h1>终端</h1><p class="page-sub">Web SSH</p></div></section>` + noNodeHTML();
    bindNoNode();
    return;
  }
  page.innerHTML = `
    <section class="page-head">
      <div><h1>终端</h1><p class="page-sub">${esc(n.name)} · ${esc(n.user)}@${esc(n.addr)}</p></div>
      <div class="head-actions">
        <button class="btn sm ghost" id="termReconnect">重新连接</button>
        <button class="btn sm ghost" id="termClear">清屏</button>
      </div>
    </section>
    <div class="term-toolbar"><span class="term-status" id="termStatus">正在连接…</span><span class="faint" style="font-size:12px">交互式 shell，请谨慎执行命令</span></div>
    <div class="card term-card"><div class="term-host" id="termHost"></div></div>`;
  $('#termReconnect').addEventListener('click', () => connectTerminal(n));
  $('#termClear').addEventListener('click', () => {
    if (state.terminal) state.terminal.term.clear();
  });
  connectTerminal(n);
}

function disposeTerminal() {
  if (state.terminal) {
    const t = state.terminal;
    state.terminal = null;
    try { t.close(); } catch (e) {}
  }
}

function connectTerminal(n) {
  disposeTerminal();
  const host = $('#termHost');
  if (!host) return;
  const status = $('#termStatus');
  const setStatus = (txt, cls) => { if (status) { status.textContent = txt; status.className = 'term-status ' + (cls || ''); } };
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim(),
    theme: XTERM_THEME,
    scrollback: 8000,
    allowProposedApi: true,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  fit.fit();
  term.focus();
  term.write(`\x1b[90m正在连接 ${n.user}@${n.addr} …\x1b[0m\r\n`);

  let ws = null;
  let closed = false;
  const send = obj => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); };
  const resize = () => {
    try { fit.fit(); } catch (e) {}
    if (term.cols > 0 && term.rows > 0) send({ type: 'resize', cols: term.cols, rows: term.rows });
  };
  const ro = new ResizeObserver(() => { if (!closed) resize(); });
  ro.observe(host);
  term.onResize(() => { if (!closed) send({ type: 'resize', cols: term.cols, rows: term.rows }); });
  term.onData(data => send({ type: 'input', data }));

  ws = new WebSocket(wsURL(`/ws/term?node=${encodeURIComponent(n.id)}`));
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { setStatus(`已连接 · ${n.name}`, 'on'); resize(); term.focus(); };
  ws.onmessage = ev => {
    if (typeof ev.data === 'string') term.write(ev.data);
    else term.write(new Uint8Array(ev.data));
  };
  ws.onerror = () => setStatus('连接失败', 'off');
  ws.onclose = () => {
    if (closed) return;
    setStatus('连接已断开', 'off');
    term.write('\r\n\x1b[90m[连接已断开，可点击「重新连接」]\x1b[0m\r\n');
  };

  state.terminal = {
    term,
    close() {
      closed = true;
      ro.disconnect();
      if (ws) try { ws.close(); } catch (e) {}
      term.dispose();
    },
  };
}

/* ---------- settings ---------- */

function renderSettings() {
  const page = $('#page');
  page.innerHTML = `
    <section class="page-head">
      <div><h1>设置</h1><p class="page-sub">账号、告警阈值与节点管理</p></div>
    </section>
    <div class="settings-grid">
      <div class="card settings-card">
        <h2>告警阈值</h2>
        <p class="sub">超过阈值时，概览页的节点卡片会高亮提示</p>
        <div class="form-grid">
          <div class="field"><label>CPU %</label><input type="number" id="thCpu" min="1" max="100" value="${Number(state.settings.cpu_alert) || 90}"></div>
          <div class="field"><label>内存 %</label><input type="number" id="thMem" min="1" max="100" value="${Number(state.settings.mem_alert) || 90}"></div>
          <div class="field"><label>磁盘 %</label><input type="number" id="thDisk" min="1" max="100" value="${Number(state.settings.disk_alert) || 90}"></div>
        </div>
        <button class="btn" id="saveThresholds">保存阈值</button>
      </div>
      <div class="card settings-card">
        <h2>修改密码</h2>
        <p class="sub">密码用于登录面板，不会修改服务器 SSH 密码</p>
        <div class="form-grid">
          <div class="field full"><label>当前密码</label><input type="password" id="pwdOld" autocomplete="current-password"></div>
          <div class="field"><label>新密码</label><input type="password" id="pwdNew" autocomplete="new-password"></div>
          <div class="field"><label>确认新密码</label><input type="password" id="pwdNew2" autocomplete="new-password"></div>
        </div>
        <button class="btn" id="savePassword">更新密码</button>
      </div>
      <div class="card settings-card full">
        <h2>节点管理</h2>
        <p class="sub">通过 SSH 纳管服务器，无需在目标机器安装 Agent</p>
        <div class="node-list" id="nodeList"></div>
        <button class="btn primary" id="addNodeBtn">添加节点</button>
      </div>
      <div class="card settings-card full">
        <h2>操作日志</h2>
        <p class="sub">最近 200 条关键操作记录，保存在 data/audit.log</p>
        <div class="audit-list" id="auditList"><div class="muted">加载中…</div></div>
        <button class="btn sm ghost" id="auditRefresh">刷新日志</button>
      </div>
      <div class="card settings-card full">
        <h2>关于</h2>
        <p class="sub">KayPanel ${esc(state.version || 'dev')} · 单二进制多机面板 · SSH 架构，无 Agent</p>
        <div class="info-list">
          <div class="info-row"><span>当前节点</span><span>${state.nodes.length} 台</span></div>
          <div class="info-row"><span>数据目录</span><span>data/（config.yaml、audit.log）</span></div>
          <div class="info-row"><span>项目仓库</span><span><a href="https://github.com/kaynai1/kaypanel" target="_blank" rel="noreferrer">github.com/kaynai1/kaypanel</a></span></div>
        </div>
      </div>
    </div>`;

  renderNodeList();
  $('#addNodeBtn').addEventListener('click', () => openNodeForm(null));
  $('#saveThresholds').addEventListener('click', async () => {
    const cpu = Number($('#thCpu').value), mem = Number($('#thMem').value), disk = Number($('#thDisk').value);
    if (![cpu, mem, disk].every(v => v >= 1 && v <= 100)) { toast('阈值需在 1-100 之间', 'error'); return; }
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ cpu_alert: cpu, mem_alert: mem, disk_alert: disk }) });
      state.settings = { cpu_alert: cpu, mem_alert: mem, disk_alert: disk };
      toast('阈值已保存', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
  $('#savePassword').addEventListener('click', async () => {
    const oldPwd = $('#pwdOld').value, newPwd = $('#pwdNew').value, newPwd2 = $('#pwdNew2').value;
    if (newPwd.length < 8) { toast('新密码至少 8 位', 'error'); return; }
    if (newPwd !== newPwd2) { toast('两次输入的新密码不一致', 'error'); return; }
    try {
      await api('/api/password', { method: 'POST', body: JSON.stringify({ old: oldPwd, new: newPwd }) });
      toast('密码已更新', 'success');
      $('#pwdOld').value = $('#pwdNew').value = $('#pwdNew2').value = '';
    } catch (e) { toast(e.message, 'error'); }
  });
  $('#auditRefresh').addEventListener('click', loadAudit);
  loadAudit();
}

function renderNodeList() {
  const host = $('#nodeList');
  if (!host) return;
  if (!state.nodes.length) {
    host.innerHTML = `<div class="empty" style="padding:24px 10px"><p>还没有节点</p></div>`;
    return;
  }
  host.innerHTML = state.nodes.map(n => `
    <div class="node-row" data-id="${esc(n.id)}">
      <span class="dot ${n.online ? 'online' : 'offline'}"></span>
      <div class="nr-main">
        <div class="nr-name">${esc(n.name)} <span class="chip ghost">${esc(n.user)}@${esc(n.addr)}</span></div>
        <div class="nr-sub">文件根目录 ${esc(n.file_root || '/')} · 应用目录 ${esc(n.stacks_dir)}</div>
      </div>
      <div class="nr-actions">
        <button class="btn sm ghost" data-nact="test">测试连接</button>
        <button class="btn sm" data-nact="edit">编辑</button>
        <button class="btn sm danger" data-nact="delete">删除</button>
      </div>
    </div>`).join('');
  host.onclick = onNodeListClick;
}

async function onNodeListClick(e) {
  const btn = e.target.closest('[data-nact]');
  if (!btn) return;
  const row = btn.closest('[data-id]');
  const id = row.dataset.id;
  const n = state.nodes.find(x => x.id === id);
  if (!n) return;
  if (btn.dataset.nact === 'edit') { openNodeForm(id); return; }
  if (btn.dataset.nact === 'delete') {
    if (!await confirmDialog('删除节点', `确定删除节点「${n.name}」吗？\n只会从面板移除，不会影响服务器本身。`, '删除', true)) return;
    try {
      await api(`/api/nodes/${id}`, { method: 'DELETE' });
      toast('已删除', 'success');
      await loadOverview(false);
      renderNodeList();
      updateNodePills();
    } catch (err) { toast(err.message, 'error'); }
    return;
  }
  if (btn.dataset.nact === 'test') {
    btn.disabled = true;
    btn.textContent = '测试中…';
    try {
      const r = await api(`/api/nodes/${id}/test`, { method: 'POST', body: '{}' });
      if (r.ok) {
        toast(`连接成功：${r.hostname} · ${r.os} · Docker ${r.docker || '未检测到'}`, 'success', 6000);
      } else {
        toast(`连接失败：${r.error || '未知错误'}`, 'error', 6000);
      }
    } catch (err) { toast(err.message, 'error', 6000); }
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
}

async function loadAudit() {
  const host = $('#auditList');
  if (!host) return;
  try {
    const d = await api('/api/audit?limit=200');
    state.audit = d.entries || [];
    if (!state.audit.length) { host.innerHTML = `<div class="muted">暂无记录</div>`; return; }
    host.innerHTML = state.audit.slice().reverse().map(en => `
      <div class="audit-row">
        <span class="t">${esc(en.time)}</span>
        <span class="d"><span class="a">${esc(en.action)}</span>${en.detail ? ' · ' + esc(en.detail) : ''}</span>
      </div>`).join('');
  } catch (e) {
    host.innerHTML = `<div class="muted">${esc(e.message)}</div>`;
  }
}

function openNodeForm(id) {
  state.subview = { type: 'node-edit', id: id || null };
  renderPage();
}

function renderNodeForm(sub) {
  const editing = !!sub.id;
  const n = editing ? state.nodes.find(x => x.id === sub.id) : null;
  if (editing && !n) {
    state.subview = null;
    return renderSettings();
  }
  const page = $('#page');
  page.innerHTML = `
    <section class="page-head">
      <div><h1>${editing ? '编辑节点' : '添加节点'}</h1><p class="page-sub">通过 SSH 连接服务器，凭据仅保存在面板数据目录</p></div>
      <div class="head-actions"><button class="btn sm ghost" id="nodeBackTop">返回</button></div>
    </section>
    <div class="card" style="max-width:920px">
      <div class="form-grid">
        <div class="field"><label>节点名称</label><input type="text" id="nodeName" value="${esc(n ? n.name : '')}" placeholder="如 kaynai NAS"></div>
        <div class="field"><label>SSH 地址</label><input type="text" id="nodeAddr" value="${esc(n ? n.addr : '')}" placeholder="192.168.5.50:22"></div>
        <div class="field"><label>SSH 用户名</label><input type="text" id="nodeUser" value="${esc(n ? n.user : '')}" placeholder="root"></div>
        <div class="field">
          <label>认证方式</label>
          <div class="radio-row">
            <label><input type="radio" name="authType" value="key" ${!n || n.auth_type !== 'password' ? 'checked' : ''}> 私钥</label>
            <label><input type="radio" name="authType" value="password" ${n && n.auth_type === 'password' ? 'checked' : ''}> 密码</label>
          </div>
        </div>
        <div class="field full" id="keyField">
          <label>SSH 私钥</label>
          <textarea id="nodeKey" class="keyarea" spellcheck="false" placeholder="${editing ? '留空表示不修改已保存的私钥' : '-----BEGIN OPENSSH PRIVATE KEY-----'}">${n && n.has_key ? '' : ''}</textarea>
          <div class="hint">${editing && n.has_key ? '已保存私钥，留空保持不变' : '粘贴 OpenSSH / PEM 格式私钥内容'}</div>
        </div>
        <div class="field full hidden" id="passwordField">
          <label>SSH 密码</label>
          <input type="password" id="nodePassword" autocomplete="new-password" placeholder="${editing && n.has_password ? '留空表示不修改已保存的密码' : 'SSH 登录密码'}">
        </div>
        <div class="field"><label>文件根目录</label><input type="text" id="nodeFileRoot" value="${esc(n ? n.file_root : '/')}" placeholder="/ 或 /vol1"></div>
        <div class="field"><label>Compose 应用目录</label><input type="text" id="nodeStacksDir" value="${esc(n ? n.stacks_dir : '')}" placeholder="留空使用 ~/kaypanel/stacks"></div>
        <div class="field full">
          <label class="check-row"><input type="checkbox" id="nodeSudo" ${n && n.sudo ? 'checked' : ''}> Docker 命令使用 sudo</label>
          <div class="hint">如果当前用户在 docker 组里则不需要；需要密码时请在下方填写 sudo 密码</div>
        </div>
        <div class="field full hidden" id="sudoField">
          <label>sudo 密码</label>
          <input type="password" id="nodeSudoPwd" autocomplete="new-password" placeholder="${editing ? '留空表示不修改' : 'sudo 密码（如已配置免密可留空）'}">
        </div>
        ${editing && n.host_key ? `<div class="field full"><label>主机指纹</label><input type="text" value="${esc(n.host_key)}" readonly></div>` : ''}
      </div>
      <div class="form-actions">
        <button class="btn primary" id="nodeSave">保存</button>
        <button class="btn" id="nodeSaveTest">保存并测试</button>
        <div class="spacer"></div>
        <button class="btn ghost" id="nodeBack">返回</button>
      </div>
      <div id="nodeTestResult"></div>
    </div>`;

  const back = () => { state.subview = null; renderPage(); };
  $('#nodeBack').addEventListener('click', back);
  $('#nodeBackTop').addEventListener('click', back);

  const syncAuth = () => {
    const type = $('input[name=authType]:checked').value;
    $('#keyField').classList.toggle('hidden', type !== 'key');
    $('#passwordField').classList.toggle('hidden', type !== 'password');
  };
  $$('input[name=authType]').forEach(r => r.addEventListener('change', syncAuth));
  syncAuth();
  const syncSudo = () => $('#sudoField').classList.toggle('hidden', !$('#nodeSudo').checked);
  $('#nodeSudo').addEventListener('change', syncSudo);
  syncSudo();

  const collect = () => ({
    name: $('#nodeName').value.trim(),
    addr: $('#nodeAddr').value.trim(),
    user: $('#nodeUser').value.trim(),
    auth_type: $('input[name=authType]:checked').value,
    private_key: $('#nodeKey') ? $('#nodeKey').value : '',
    password: $('#nodePassword') ? $('#nodePassword').value : '',
    sudo: $('#nodeSudo').checked,
    sudo_password: $('#nodeSudoPwd').value,
    file_root: $('#nodeFileRoot').value.trim() || '/',
    stacks_dir: $('#nodeStacksDir').value.trim(),
  });

  const save = async (test) => {
    const payload = collect();
    if (!payload.name) { toast('请填写节点名称', 'error'); return; }
    if (!payload.addr) { toast('请填写 SSH 地址', 'error'); return; }
    if (!payload.user) { toast('请填写 SSH 用户名', 'error'); return; }
    if (!editing && payload.auth_type === 'key' && !payload.private_key.trim()) { toast('请粘贴 SSH 私钥', 'error'); return; }
    if (!editing && payload.auth_type === 'password' && !payload.password) { toast('请填写 SSH 密码', 'error'); return; }
    $('#nodeSave').disabled = true;
    $('#nodeSaveTest').disabled = true;
    let nodeId = sub.id;
    try {
      if (editing) {
        await api(`/api/nodes/${sub.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        const d = await api('/api/nodes', { method: 'POST', body: JSON.stringify(payload) });
        nodeId = d.node && d.node.id;
      }
      toast('节点已保存', 'success');
      await loadOverview(false);
      updateNodePills();
      if (test && nodeId) {
        toast('正在测试连接…');
        try {
          const r = await api(`/api/nodes/${nodeId}/test`, { method: 'POST', body: '{}' });
          const box = $('#nodeTestResult');
          if (box) {
            box.innerHTML = `<div class="test-result ${r.ok ? 'ok' : 'err'}">
              <div class="row"><span>状态</span><span>${r.ok ? '连接成功' : '连接失败'}</span></div>
              ${r.hostname ? `<div class="row"><span>主机名</span><span>${esc(r.hostname)}</span></div>` : ''}
              ${r.os ? `<div class="row"><span>系统</span><span>${esc(r.os)}</span></div>` : ''}
              ${r.kernel ? `<div class="row"><span>内核</span><span>${esc(r.kernel)}</span></div>` : ''}
              ${r.docker ? `<div class="row"><span>Docker</span><span>${esc(r.docker)}</span></div>` : ''}
              ${r.fingerprint ? `<div class="row"><span>主机指纹</span><span class="mono" style="font-size:11px">${esc(r.fingerprint)}</span></div>` : ''}
              ${r.error ? `<div class="row"><span>错误</span><span>${esc(r.error)}</span></div>` : ''}
            </div>`;
          }
        } catch (e) {
          toast('测试失败：' + e.message, 'error', 6000);
        }
      }
      $('#nodeSave').disabled = false;
      $('#nodeSaveTest').disabled = false;
      if (state.subview && state.subview.type === 'node-edit' && !editing) {
        state.subview = { type: 'node-edit', id: nodeId };
        renderNodeForm(state.subview);
        renderNodeList();
      } else {
        state.subview = null;
        renderPage();
      }
    } catch (e) {
      toast(e.message, 'error', 6000);
      $('#nodeSave').disabled = false;
      $('#nodeSaveTest').disabled = false;
    }
  };

  $('#nodeSave').addEventListener('click', () => save(false));
  $('#nodeSaveTest').addEventListener('click', () => save(true));
}

/* ---------- modal ---------- */

function modalShell(title, desc, extra, confirmText, danger) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-mask"><div class="modal" role="dialog" aria-modal="true">
    <h3 class="modal-title">${esc(title)}</h3>
    ${desc ? `<p class="modal-desc">${esc(desc)}</p>` : ''}
    ${extra || ''}
    <div class="modal-actions">
      <button class="btn ghost" data-x="cancel">取消</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-x="ok">${esc(confirmText || '确定')}</button>
    </div>
  </div></div>`;
  return root;
}

function closeModal() {
  const root = $('#modal-root');
  if (root) root.innerHTML = '';
}

function confirmDialog(title, message, confirmText, danger) {
  return new Promise(resolve => {
    const root = modalShell(title, message, '', confirmText || '确定', danger);
    let done = false;
    const finish = v => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey);
      closeModal();
      resolve(v);
    };
    const onKey = ev => { if (ev.key === 'Escape') finish(false); };
    document.addEventListener('keydown', onKey);
    root.querySelector('[data-x=cancel]').onclick = () => finish(false);
    root.querySelector('[data-x=ok]').onclick = () => finish(true);
    root.querySelector('.modal-mask').onclick = ev => { if (ev.target.classList.contains('modal-mask')) finish(false); };
    root.querySelector('[data-x=ok]').focus();
  });
}

function promptDialog(title, desc, value) {
  return new Promise(resolve => {
    const extra = `<input class="modal-input" id="promptInput" value="${esc(value || '')}" autocomplete="off">`;
    const root = modalShell(title, desc, extra, '确定', false);
    const input = root.querySelector('#promptInput');
    let done = false;
    const finish = v => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey);
      closeModal();
      resolve(v);
    };
    const submit = () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      finish(v);
    };
    const onKey = ev => { if (ev.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);
    root.querySelector('[data-x=cancel]').onclick = () => finish(null);
    root.querySelector('[data-x=ok]').onclick = submit;
    root.querySelector('.modal-mask').onclick = ev => { if (ev.target.classList.contains('modal-mask')) finish(null); };
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } });
    input.focus();
    input.select();
  });
}

/* ---------- boot ---------- */

async function boot() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('unauth');
    const me = await res.json();
    state.authed = true;
    state.version = me.version || '';
    state.settings = me.settings || state.settings;
  } catch (e) {
    showLogin();
    return;
  }
  renderShell();
  window.addEventListener('hashchange', onRoute);
  await loadOverview(false);
  if (!location.hash) history.replaceState(null, '', '#/overview');
  onRoute();
  state.nodeTimer = setInterval(refreshNodesLight, 30000);
}

boot();
