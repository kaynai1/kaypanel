'use strict';

const TOP_PAGES = ['overview', 'topology', 'netmatrix', 'security', 'personality', 'timeline', 'probes', 'batch', 'changes', 'drift', 'stocks', 'park', 'containers', 'apps', 'files', 'terminal', 'ai', 'cost', 'settings'];
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const state = {
  authed: false,
  desktop: false,
  version: '',
  settings: { cpu_alert: 90, mem_alert: 90, disk_alert: 90 },
  nodes: [],
  selected: localStorage.getItem('kp_node') || '',
  page: 'overview',
  subview: null,
  pageTimer: null,
  procTimer: null,
  nodeTimer: null,
  wallTimer: null,
  wallClock: null,
  wallKey: null,
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
  auditAt: 0,
  hasWebhook: false,
  hasAIKey: false,
  aiMessages: [],
  aiBusy: false,
  aiModels: [],
  inspect: null,
  inspectBusy: false,
  inspectError: '',
  personality: null,
  personalityBusy: false,
  personalityError: '',
  timeline: null,
  timelineBusy: false,
  timelineError: '',
  timelineNode: 'all',
  timelineLevel: 'all',
  timelineOpen: {},
  tlPlay: { t: 0, playing: false, speed: 8, timer: null, last: 0, cache: null, popKey: '' },
  topologyError: '',
  topoPoll: null,
  topoResize: null,
  widgetTimer: null,
  aiStackPrompt: '',
  aiStackBusy: false,
  aiStackResult: null,
  aiStackError: '',
  trendMetric: 'cpu',
  theme: localStorage.getItem('kp_theme') === 'dark' ? 'dark' : 'light',
  stockTimer: null,
  parkTimer: null,
  parkTab: localStorage.getItem('kp_park_tab') || 'pets',
  ambientRAF: null,
  ambientResize: null,
  paletteOpen: false,
  paletteIndex: 0,
  paletteFiltered: [],
  autoRefresh: prefOn('kp_auto'),
  procOn: prefOn('kp_proc'),
  alertOn: prefOn('kp_alert'),
  security: null,
  securityBusy: false,
  securityError: '',
  cost: null,
  costBusy: false,
  costError: '',
  netmatrix: null,
  netmatrixBusy: false,
  netmatrixError: '',
  probes: null,
  probesBusy: false,
  probesError: '',
  changes: null,
  changesBusy: false,
  changesError: '',
  drift: null,
  driftBusy: false,
  driftError: '',
  batchTab: 'exec',
  batchSel: {},
  batchResults: null,
  batchBusy: false,
};

function prefOn(key) {
  return localStorage.getItem(key) !== '0';
}

/* ---------- helpers ---------- */

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ICON_PATHS = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
  container: '<path d="M21 8.4 12 3 3 8.4v7.2L12 21l9-5.4V8.4Z"/><path d="M3.4 8.5 12 13l8.6-4.5"/><path d="M12 13v8"/>',
  app: '<path d="m12 3 9 4.8-9 4.8-9-4.8L12 3Z"/><path d="m3 12.5 9 4.8 9-4.8"/><path d="m3 17 9 4.8 9-4.8"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7.5 10 2.5 2-2.5 2"/><path d="M12.5 14H16"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.6 6.3"/><path d="M20 4v7h-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  activity: '<path d="M3 12h4l2.4-7 4.8 14 2.4-7H21"/>',
  heart: '<path d="M19.5 12.6 12 20l-7.5-7.4a4.6 4.6 0 0 1 0-6.6 4.7 4.7 0 0 1 6.6 0l.9.9.9-.9a4.7 4.7 0 0 1 6.6 0 4.6 4.6 0 0 1 0 6.6Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  wall: '<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8 20h8"/><path d="M12 16.5V20"/>',
  expand: '<path d="M8 3H3v5"/><path d="M16 3h5v5"/><path d="M16 21h5v-5"/><path d="M8 21H3v-5"/>',
  spark: '<path d="M12 3l1.8 4.9L19 10l-5.2 2.1L12 17l-1.8-4.9L5 10l5.2-2.1L12 3Z"/><path d="M18.5 15l.8 2.2L21.5 18l-2.2.8-.8 2.2-.8-2.2L15.5 18l2.2-.8.8-2.2Z"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 9.5-9.5"/><path d="m16 7 2.5 2.5"/><path d="m19 4 2 2"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  winMin: '<path d="M5 12h14"/>',
  winMax: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  winRestore: '<rect x="8.5" y="8.5" width="10" height="10" rx="1"/><path d="M8.5 16h-2a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1H16a1 1 0 0 1 1 1v2"/>',
  winClose: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  topology: '<circle cx="12" cy="12" r="2.4"/><circle cx="5" cy="5.5" r="1.9"/><circle cx="19" cy="6.5" r="1.9"/><circle cx="6" cy="18.5" r="1.9"/><circle cx="18" cy="18" r="1.9"/><path d="m6.5 6.9 3.1 3M17.6 7.6l-3.1 3M7.6 17.1l2.9-3M16.6 16.9l-2.8-2.6"/>',
  widget: '<rect x="3" y="4" width="18" height="13" rx="2"/><rect x="12.5" y="10" width="6.5" height="4.6" rx="1"/><path d="M8 20h8"/>',
  play: '<path d="M8 5.2v13.6L19 12 8 5.2Z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  stocks: '<path d="M3 20V4"/><path d="M3 20h18"/><rect x="7" y="9" width="3" height="8" rx=".8"/><rect x="12.5" y="5.5" width="3" height="11.5" rx=".8"/><rect x="18" y="12" width="3" height="5" rx=".8"/>',
  park: '<circle cx="6.5" cy="8.5" r="1.9"/><circle cx="12" cy="6" r="1.9"/><circle cx="17.5" cy="8.5" r="1.9"/><path d="M12 10.5c-3.1 0-5.6 2.5-5.6 5.1 0 2 1.5 3.4 3.5 3.4 1 0 1.6-.4 2.1-.4s1.1.4 2.1.4c2 0 3.5-1.4 3.5-3.4 0-2.6-2.5-5.1-5.6-5.1Z"/>',
  ambient: '<path d="M12 3.5l1.8 4.8 4.7 1.8-4.7 1.8L12 16.7l-1.8-4.8-4.7-1.8 4.7-1.8L12 3.5Z"/><path d="M18.5 15.5l.8 2.1 2.2.9-2.2.8-.8 2.2-.9-2.2-2.1-.8 2.1-.9.9-2.1Z"/>',
  command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  trophy: '<path d="M8 3h8v5a4 4 0 0 1-8 0V3Z"/><path d="M8 4H5v2a3 3 0 0 0 3 3M16 4h3v2a3 3 0 0 1-3 3"/><path d="M12 12v5M8 21h8M10 17h4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.4 3.1 8.4 7.5 9.5 4.4-1.1 7.5-5.1 7.5-9.5V6L12 3Z"/><path d="m8.8 12 2.2 2.2 4.4-4.4"/>',
  network: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="3.5" r="1.5"/><circle cx="12" cy="20.5" r="1.5"/><circle cx="3.5" cy="12" r="1.5"/><circle cx="20.5" cy="12" r="1.5"/><path d="M12 5v4M12 15v4M5 12h4M15 12h4"/>',
  probe: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="m12 12 5.7-5.7"/><circle cx="12" cy="12" r="1"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3"/><path d="M3.5 4.2V9H8"/><path d="M12 7.5V12l3 1.8"/>',
  batch: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>',
  coin: '<ellipse cx="12" cy="6.2" rx="7" ry="3"/><path d="M5 6.2v5.2c0 1.7 3.1 3 7 3s7-1.3 7-3V6.2"/><path d="M5 11.4v5.2c0 1.7 3.1 3 7 3s7-1.3 7-3v-5.2"/>',
  diff: '<circle cx="6.5" cy="6" r="2.2"/><circle cx="17.5" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M8.7 6h6.6M7.6 8l3.4 7.8M16.4 8l-3.4 7.8"/>',
};

function ico(name, cls = '') {
  const paths = ICON_PATHS[name] || '';
  return `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function hasWindowHost() {
  return typeof window.kaypanelWindow === 'function';
}

function winControlsHTML() {
  if (!hasWindowHost()) return '';
  return `<div class="win-controls">
    <button class="win-btn" data-win="min" title="最小化">${ico('winMin')}</button>
    <button class="win-btn" data-win="max" title="最大化">${ico('winMax')}</button>
    <button class="win-btn win-close" data-win="close" title="关闭">${ico('winClose')}</button>
  </div>`;
}

const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#4f46e5'];

function avatarColor(seed) {
  let h = 0;
  for (const ch of String(seed || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initialOf(name) {
  const s = String(name || '?').trim();
  return (s[0] || '?').toUpperCase();
}

function todayCN() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`;
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

/* ---------- theme & tray ---------- */

function applyTheme(theme) {
  state.theme = theme === 'dark' ? 'dark' : 'light';
  document.body.classList.toggle('dark', state.theme === 'dark');
  document.documentElement.style.colorScheme = state.theme;
  localStorage.setItem('kp_theme', state.theme);
  const btn = $('#topTheme');
  if (btn) {
    btn.innerHTML = ico(state.theme === 'dark' ? 'sun' : 'moon');
    btn.title = state.theme === 'dark' ? '切换浅色模式' : '切换深色模式';
  }
}

function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  toast(state.theme === 'dark' ? '已切换到深色主题' : '已切换到浅色主题', '', 1800);
  if (typeof checkAchievements === 'function') checkAchievements();
}

function traySummary(nodes) {
  const real = (nodes || []).filter(n => !n.sftp_only);
  const online = real.filter(n => n.online).length;
  if (!real.length) return { level: 'unknown', tip: '尚未添加节点' };
  if (online < real.length) return { level: 'crit', tip: `${online}/${real.length} 台在线 · 有节点离线` };
  const st = state.settings || {};
  let warn = false;
  for (const n of real) {
    const m = n.latest || {};
    const cpu = Number(m.cpu) || 0;
    const mem = pct(m.mem_used, m.mem_total);
    const disk = pct(m.disk_used, m.disk_total);
    if (cpu >= 95 || mem >= 95 || disk >= 95) return { level: 'crit', tip: `${real.length} 台在线 · ${n.name} 资源告急` };
    if (cpu >= (st.cpu_alert || 90) || mem >= (st.mem_alert || 90) || disk >= (st.disk_alert || 90)) warn = true;
  }
  return warn ? { level: 'warn', tip: `${real.length} 台在线 · 有指标超过告警线` } : { level: 'ok', tip: `${real.length} 台在线 · 状态良好` };
}

function syncTray() {
  if (typeof window.kaypanelTray !== 'function') return;
  const s = traySummary(state.nodes);
  try { window.kaypanelTray(s.level, s.tip); } catch (e) { /* desktop shell handles old versions */ }
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
      ${hasWindowHost() ? `<div class="login-win">${winControlsHTML()}</div>` : ''}
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
  <div class="shell">
    <aside class="sidebar">
      <div class="side-brand">
        <img src="/assets/logo.svg" alt="">
        <div class="side-brand-text"><b>KayPanel</b><span>${esc(state.version || 'dev')}</span></div>
      </div>
      <nav class="side-nav" id="sideNav">
        <div class="nav-group">监控</div>
        <button class="nav-item" data-page="overview">${ico('overview')}<span>概览</span></button>
        <button class="nav-item" data-page="topology">${ico('topology')}<span>机房拓扑</span></button>
        <button class="nav-item" data-page="netmatrix">${ico('network')}<span>网络质量</span></button>
        <button class="nav-item" data-page="security">${ico('shield')}<span>安全体检</span></button>
        <button class="nav-item" data-page="personality">${ico('heart')}<span>性格周报</span></button>
        <button class="nav-item" data-page="timeline">${ico('clock')}<span>故障回放</span></button>
        <button class="nav-item" data-page="containers">${ico('container')}<span>容器</span><span class="nav-badge hidden" id="navCtrBadge"></span></button>
        <button class="nav-item" data-page="apps">${ico('app')}<span>应用</span></button>
        <div class="nav-group">工具</div>
        <button class="nav-item" data-page="probes">${ico('probe')}<span>拨测状态</span></button>
        <button class="nav-item" data-page="batch">${ico('batch')}<span>批量操作</span></button>
        <button class="nav-item" data-page="changes">${ico('history')}<span>变更记录</span></button>
        <button class="nav-item" data-page="drift">${ico('diff')}<span>配置漂移</span></button>
        <button class="nav-item" data-page="files">${ico('folder')}<span>文件</span></button>
        <button class="nav-item" data-page="terminal">${ico('terminal')}<span>终端</span></button>
        <button class="nav-item" data-page="ai">${ico('spark')}<span>AI 助手</span></button>
        <div class="nav-group">趣味</div>
        <button class="nav-item" data-page="stocks">${ico('stocks')}<span>行情</span></button>
        <button class="nav-item" data-page="park">${ico('park')}<span>服务器乐园</span></button>
        <div class="nav-group">系统</div>
        <button class="nav-item" data-page="cost">${ico('coin')}<span>电费账本</span></button>
        <button class="nav-item" data-page="settings">${ico('settings')}<span>设置</span></button>
      </nav>
      <div class="side-foot">
        <span class="foot-ic">${ico('activity')}</span>
        <div class="foot-main"><b>数据目录</b><span>${state.desktop ? 'AppData\\Roaming\\KayPanel' : 'data/'}</span></div>
      </div>
    </aside>
    <div class="main-col">
      <header class="topbar${hasWindowHost() ? ' has-win' : ''}">
        <div class="node-switch" id="nodeSwitchWrap"></div>
        <div class="live-pill"><span class="live-dot"></span><span id="liveText">实时监控</span></div>
        <div class="top-right">
          ${hasWindowHost() ? `<button class="icon-btn" id="widgetBtn" title="悬浮挂件">${ico('widget')}</button>` : ''}
          <button class="icon-btn" id="wallBtn" title="监控大屏">${ico('wall')}</button>
          <button class="icon-btn" id="paletteBtn" title="命令面板 (Ctrl+K)">${ico('command')}</button>
          <button class="icon-btn" id="topTheme" title="${state.theme === 'dark' ? '切换浅色模式' : '切换深色模式'}">${ico(state.theme === 'dark' ? 'sun' : 'moon')}</button>
          <button class="icon-btn" id="topRefresh" title="刷新当前页">${ico('refresh')}</button>
          ${state.desktop ? '' : `<button class="icon-btn" id="logoutBtn" title="退出登录">${ico('logout')}</button>`}
          ${winControlsHTML()}
        </div>
      </header>
      <div class="content" id="content">
        <main class="page-main" id="page"></main>
        <aside class="rail" id="rail"></aside>
      </div>
    </div>
  </div>`;

  $('#sideNav').addEventListener('click', e => {
    const btn = e.target.closest('[data-page]');
    if (btn) navigate(btn.dataset.page);
  });
  $('#nodeSwitchWrap').addEventListener('click', e => {
    const nodeBtn = e.target.closest('[data-node]');
    if (nodeBtn) { closeNodeMenu(); selectNode(nodeBtn.dataset.node); return; }
    if (e.target.closest('[data-addnode]')) { closeNodeMenu(); openNodeForm(null); return; }
    if (e.target.closest('#nodeSwitch')) {
      e.stopPropagation();
      const menu = $('#nodeMenu');
      if (menu) menu.classList.toggle('open');
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#nodeSwitchWrap')) closeNodeMenu();
  });
  $('#topRefresh').addEventListener('click', refreshCurrentPage);
  $('#wallBtn').addEventListener('click', () => navigate('wall'));
  $('#paletteBtn').addEventListener('click', openPalette);
  $('#topTheme').addEventListener('click', toggleTheme);
  if ($('#widgetBtn')) $('#widgetBtn').addEventListener('click', enterWidgetMode);
  if ($('#logoutBtn')) {
    $('#logoutBtn').addEventListener('click', async () => {
      try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch (e) {}
      location.reload();
    });
  }
  updateTabs();
  updateNodePills();
}

const DRAG_SKIP = 'button, input, textarea, select, a, .node-switch, .live-pill, .win-controls, .login-card';

function setMaxIcon(state) {
  const btn = document.querySelector('[data-win=max]');
  if (!btn) return;
  btn.innerHTML = ico(state === 'max' ? 'winRestore' : 'winMax');
  btn.title = state === 'max' ? '向下还原' : '最大化';
}

function toggleMax() {
  window.kaypanelWindow('max').then(setMaxIcon);
}

function setupWindowChrome() {
  if (!hasWindowHost()) return;
  document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('[data-win]');
    if (!btn) return;
    const action = btn.dataset.win;
    if (action === 'max') {
      toggleMax();
    } else {
      window.kaypanelWindow(action);
    }
  });
  let lastDown = 0, lastX = 0, lastY = 0;
  document.addEventListener('mousedown', e => {
    if (e.button !== 0 || !e.target.closest) return;
    const area = e.target.closest('.topbar, .side-brand, .login-wrap');
    if (!area || e.target.closest(DRAG_SKIP)) return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastDown < 400 && Math.abs(e.clientX - lastX) < 6 && Math.abs(e.clientY - lastY) < 6) {
      lastDown = 0;
      toggleMax();
      return;
    }
    lastDown = now;
    lastX = e.clientX;
    lastY = e.clientY;
    if (typeof window.kaypanelDrag === 'function') window.kaypanelDrag();
  });
}

function closeNodeMenu() {
  const m = $('#nodeMenu');
  if (m) m.classList.remove('open');
}

function refreshCurrentPage() {
  if (state.subview && state.subview.type === 'inspect') { loadInspect(); return; }
  switch (state.page) {
    case 'overview': loadOverview(true); loadProcesses(); break;
    case 'topology': loadTopology(true); break;
    case 'netmatrix': loadNetMatrix(true); break;
    case 'security': loadSecurity(true); break;
    case 'probes': loadProbes(true); break;
    case 'changes': loadChanges(true); break;
    case 'drift': loadDrift(true); break;
    case 'cost': loadCost(true); break;
    case 'batch': renderPage(); break;
    case 'personality': loadPersonality(true); break;
    case 'timeline': loadTimeline(true); break;
    case 'stocks': loadStocks(); break;
    case 'park': loadPark(); break;
    case 'containers': loadContainers(); break;
    case 'apps': loadStacks(); break;
    case 'files': loadFiles(state.filePath); break;
    case 'widget': refreshWidget(); break;
    default: renderPage();
  }
}

function updateTabs() {
  const sel = currentNode();
  const vhost = !!(sel && sel.sftp_only);
  $$('.nav-item').forEach(t => {
    const hide = vhost && ['containers', 'apps', 'terminal'].includes(t.dataset.page);
    t.classList.toggle('hidden', hide);
    t.classList.toggle('active', t.dataset.page === state.page);
  });
  const live = $('#liveText');
  if (live) live.textContent = vhost ? '仅文件管理' : '实时监控';
}

function nodeDotClass(n) {
  return n.online ? 'online' : n.waking ? 'waking' : 'offline';
}

function nodeStateText(n) {
  return n.online ? '在线' : n.waking ? '唤醒中' : '离线';
}

function nodeSwitchHTML() {
  const n = currentNode();
  const chip = n
    ? `<button type="button" class="switch-chip" id="nodeSwitch">
        <span class="avatar" style="background:${avatarColor(n.id)}">${esc(initialOf(n.name))}</span>
        <span class="switch-main"><b>${esc(n.name)}</b><span>${esc(n.user)}@${esc(n.addr)}</span></span>
        <span class="dot ${nodeDotClass(n)}"></span>
        ${ico('chevron', 'chev')}
      </button>`
    : `<button type="button" class="switch-chip" id="nodeSwitch"><span class="switch-main"><b>未选择节点</b><span>添加节点后开始管理</span></span>${ico('chevron', 'chev')}</button>`;
  const rows = state.nodes.map(x => `
    <button type="button" class="acct-item ${x.id === state.selected ? 'active' : ''}" data-node="${esc(x.id)}">
      <span class="avatar" style="background:${avatarColor(x.id)}">${esc(initialOf(x.name))}</span>
      <span class="acct-main"><b>${esc(x.name)}${x.id === state.selected ? '<span class="tag-soft">当前</span>' : ''}</b><span>${esc(x.user)}@${esc(x.addr)}</span></span>
      <span class="acct-state"><span class="dot ${nodeDotClass(x)}"></span>${nodeStateText(x)}</span>
    </button>`).join('') || `<div class="rail-empty">尚未添加节点</div>`;
  return `${chip}<div class="node-menu" id="nodeMenu"><div class="menu-head">切换节点</div>${rows}<button type="button" class="rail-add" data-addnode>+ 添加节点</button></div>`;
}

function updateNodePills() {
  const wrap = $('#nodeSwitchWrap');
  if (wrap && !wrap.querySelector('.node-menu.open')) wrap.innerHTML = nodeSwitchHTML();
  updateRailNodes();
  const badge = $('#navCtrBadge');
  if (badge) {
    const total = state.nodes.filter(n => n.online).reduce((a, n) => a + Math.max(0, Number(n.latest && n.latest.docker_running) || 0), 0);
    badge.textContent = total ? String(total) : '';
    badge.classList.toggle('hidden', !total);
  }
}

function navigate(page) {
  if (page !== 'wall' && page !== 'widget' && page !== 'ambient' && !TOP_PAGES.includes(page)) page = 'overview';
  state.subview = null;
  state.page = page;
  if (TOP_PAGES.includes(page)) recordVisit(page);
  const hash = '#/' + page;
  if (location.hash !== hash) {
    location.hash = hash;
  } else {
    renderPage();
  }
}

function onRoute() {
  const p = (location.hash.replace(/^#\/?/, '') || 'overview');
  if (p === 'wall' || p === 'widget' || p === 'ambient') {
    state.page = p;
    state.subview = null;
    renderPage();
    return;
  }
  state.page = TOP_PAGES.includes(p) ? p : 'overview';
  state.subview = null;
  recordVisit(state.page);
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
  state.aiMessages = [];
  if (state.subview && state.subview.type === 'ai-stack') {
    state.subview = null;
    state.aiStackResult = null;
    state.aiStackError = '';
  }
  closeNodeMenu();
  updateTabs();
  updateNodePills();
  if (state.page === 'overview' && !state.subview) {
    drawOverview();
    loadProcesses();
    restartOverviewTimers();
  } else if (!state.subview) {
    renderPage();
  }
}

function cleanupPage() {
  if (state.pageTimer) { clearInterval(state.pageTimer); state.pageTimer = null; }
  if (state.procTimer) { clearInterval(state.procTimer); state.procTimer = null; }
  if (state.stockTimer) { clearInterval(state.stockTimer); state.stockTimer = null; }
  if (state.parkTimer) { clearInterval(state.parkTimer); state.parkTimer = null; }
  if (state.ambientRAF) { cancelAnimationFrame(state.ambientRAF); state.ambientRAF = null; }
  if (state.ambientResize) { window.removeEventListener('resize', state.ambientResize); state.ambientResize = null; }
  if (state.wallTimer) { clearInterval(state.wallTimer); state.wallTimer = null; }
  if (state.wallClock) { clearInterval(state.wallClock); state.wallClock = null; }
  if (state.wallKey) { document.removeEventListener('keydown', state.wallKey); state.wallKey = null; }
  if (state.topoPoll) { clearInterval(state.topoPoll); state.topoPoll = null; }
  if (state.topoResize) { window.removeEventListener('resize', state.topoResize); state.topoResize = null; }
  if (state.widgetTimer) { clearInterval(state.widgetTimer); state.widgetTimer = null; }
  tlPlayPause();
  if (state.tlPlay.cache) state.tlPlay.cache = null;
  const wall = $('#wallRoot');
  if (wall) wall.remove();
  const ambient = $('#ambientRoot');
  if (ambient) ambient.remove();
  const widget = $('#widgetRoot');
  if (widget) widget.remove();
  closePalette();
  document.body.classList.remove('wall-mode');
  document.body.classList.remove('ambient-mode');
  document.body.classList.remove('widget-mode');
  closeLogDrawer();
  disposeTerminal();
}

function renderPage() {
  cleanupPage();
  if (state.page === 'wall') return renderWall();
  if (state.page === 'ambient') return renderAmbient();
  if (state.page === 'widget') return renderWidget();
  const selNode = currentNode();
  if (selNode && selNode.sftp_only && ['containers', 'apps', 'terminal'].includes(state.page)) {
    state.page = 'files';
    if (location.hash !== '#/files') history.replaceState(null, '', '#/files');
  }
  updateTabs();
  updateNodePills();
  syncRail();
  const sub = state.subview;
  if (sub && sub.type === 'stack-edit') return renderStackEditor(sub);
  if (sub && sub.type === 'file-edit') return renderFileEditor(sub);
  if (sub && sub.type === 'node-edit') return renderNodeForm(sub);
  if (sub && sub.type === 'inspect') return renderInspect();
  if (sub && sub.type === 'ai-stack') return renderAIStack();
  switch (state.page) {
    case 'overview': return renderOverview();
    case 'topology': return renderTopology();
    case 'netmatrix': return renderNetMatrix();
    case 'security': return renderSecurity();
    case 'probes': return renderProbes();
    case 'changes': return renderChanges();
    case 'drift': return renderDrift();
    case 'batch': return renderBatch();
    case 'cost': return renderCost();
    case 'personality': return renderPersonality();
    case 'timeline': return renderTimeline();
    case 'stocks': return renderStocks();
    case 'park': return renderPark();
    case 'containers': return renderContainers();
    case 'apps': return renderApps();
    case 'files': return renderFiles();
    case 'terminal': return renderTerminalPage();
    case 'ai': return renderAI();
    case 'settings': return renderSettings();
    default: return renderOverview();
  }
}

function syncRail() {
  const on = state.page === 'overview' && !state.subview;
  const content = $('#content');
  if (content) content.classList.toggle('rail-on', on);
  const rail = $('#rail');
  if (!rail) return;
  if (!on) {
    rail.innerHTML = '';
  } else if (!$('#railNodes')) {
    renderRail();
  }
}

/* ---------- wall ---------- */

function wallNodes() {
  return state.nodes.filter(n => !n.sftp_only);
}

function wallClockText() {
  const d = new Date();
  const pad = v => String(v).padStart(2, '0');
  return {
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    date: `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} 周${'日一二三四五六'[d.getDay()]}`,
  };
}

function updateWallClock() {
  const t = $('#wallTime'), d = $('#wallDate');
  if (!t || !d) return;
  const v = wallClockText();
  t.textContent = v.time;
  d.textContent = v.date;
}

function wallRing(percent, warn) {
  const p = Math.max(0, Math.min(100, percent));
  const r = 42, c = 2 * Math.PI * r;
  const color = warn ? '#f87171' : p >= 75 ? '#fbbf24' : '#38bdf8';
  return `<div class="wc-ring-wrap">
    <svg class="wc-ring" viewBox="0 0 100 100">
      <circle class="ring-track" cx="50" cy="50" r="${r}"/>
      <circle class="ring-bar" cx="50" cy="50" r="${r}" stroke="${color}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p / 100)).toFixed(1)}"/>
    </svg>
    <div class="wc-ring-num"><b>${p.toFixed(1)}</b><span>%</span><i>CPU</i></div>
  </div>`;
}

function wallBar(label, p, detail, color, warn) {
  const v = Math.max(0, Math.min(100, p));
  return `<div class="wc-bar">
    <div class="wc-bar-head"><span>${label}</span><b>${v.toFixed(0)}%</b></div>
    <div class="wc-track"><i style="width:${v.toFixed(1)}%;background:${warn ? '#f87171' : color}"></i></div>
    <div class="wc-bar-sub">${esc(detail)}</div>
  </div>`;
}

function wallCard(n) {
  const m = n.latest || {};
  const cpu = n.online ? Number(m.cpu) || 0 : 0;
  const memP = pct(m.mem_used, m.mem_total);
  const diskP = pct(m.disk_used, m.disk_total);
  const st = state.settings || {};
  const cpuWarn = n.online && cpu >= (st.cpu_alert || 90);
  const memWarn = n.online && memP >= (st.mem_alert || 90);
  const diskWarn = n.online && diskP >= (st.disk_alert || 90);
  const hist = (n.history || []).map(s => Number(s.cpu) || 0);
  return `<article class="wall-card ${n.online ? 'online' : 'offline'}">
    <div class="wc-head">
      <span class="avatar" style="background:${avatarColor(n.id)}">${esc(initialOf(n.name))}</span>
      <div class="wc-name"><b>${esc(n.name)}</b><span>${esc(m.os || (n.online ? '正在采集…' : n.error || '连接中断'))}</span></div>
      <span class="wc-state ${n.online ? '' : 'off'}"><span class="dot"></span>${n.online ? '在线' : n.waking ? '唤醒中' : '离线'}</span>
    </div>
    ${n.online ? `
    <div class="wc-main">
      ${wallRing(cpu, cpuWarn)}
      <div class="wc-bars">
        ${wallBar('内存', memP, `${fmtBytes(m.mem_used)} / ${fmtBytes(m.mem_total)}`, '#a78bfa', memWarn)}
        ${wallBar('磁盘', diskP, `${fmtBytes(m.disk_used)} / ${fmtBytes(m.disk_total)}`, '#34d399', diskWarn)}
      </div>
    </div>
    <div class="wc-stats">
      <div><span>下载</span><b>${fmtRate(m.net_rx)}</b></div>
      <div><span>上传</span><b>${fmtRate(m.net_tx)}</b></div>
      <div><span>负载</span><b>${(Number(m.load1) || 0).toFixed(2)}</b></div>
      <div><span>温度</span><b>${m.temp > 0 ? m.temp.toFixed(0) + '°C' : '—'}</b></div>
    </div>
    <div class="wc-chart">${chartSVG([{ values: hist, color: cpuWarn ? '#f87171' : '#38bdf8', fill: true }], { height: 64, max: 100 })}</div>
    ` : `<div class="wc-offline">
      <b>${n.waking ? '正在唤醒' : '离线'}</b>
      <span>${esc(n.waking ? 'Instabox 空闲休眠，正在自动唤醒…' : (n.error || 'SSH 连接失败'))}</span>
    </div>`}
  </article>`;
}

function drawWall() {
  const grid = $('#wallGrid');
  if (!grid) return;
  const list = wallNodes();
  const online = list.filter(n => n.online).length;
  grid.innerHTML = list.length ? list.map(wallCard).join('') : `<div class="wall-empty">还没有服务器节点<br><span>添加节点后即可在这里挂机监控</span></div>`;
  const count = $('#wallCount');
  if (count) count.textContent = `${online} / ${list.length} 台在线 · 3 秒刷新`;
}

function renderWall() {
  document.body.classList.add('wall-mode');
  const v = wallClockText();
  const root = document.createElement('div');
  root.id = 'wallRoot';
  root.className = 'wall';
  root.innerHTML = `
    <header class="wall-head">
      <div class="wall-brand"><img src="/assets/logo.svg" alt=""><span>KayPanel 监控大屏</span><span class="wall-live"><i></i>LIVE</span></div>
      <div class="wall-clock"><b id="wallTime">${v.time}</b><span id="wallDate">${v.date}</span></div>
      <button class="wall-exit" id="wallAmbient" title="切换到氛围屏">${ico('ambient')}<span>氛围屏</span></button>
      <button class="wall-exit" id="wallFull" title="切换全屏">${ico('expand')}<span>全屏</span></button>
      <button class="wall-exit" id="wallExit" title="退出大屏">退出 Esc</button>
    </header>
    <div class="wall-grid" id="wallGrid"></div>
    <footer class="wall-foot"><span id="wallCount"></span><span>CPU / 内存 / 磁盘超过告警阈值时红色高亮</span></footer>`;
  document.body.appendChild(root);
  drawWall();
  updateWallClock();
  bumpStat('kp_screens');
  const exit = () => navigate('overview');
  $('#wallExit').addEventListener('click', exit);
  $('#wallAmbient').addEventListener('click', () => navigate('ambient'));
  $('#wallFull').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  state.wallKey = e => { if (e.key === 'Escape' && !document.fullscreenElement) exit(); };
  document.addEventListener('keydown', state.wallKey);
  state.wallClock = setInterval(updateWallClock, 1000);
  const refreshWall = async () => {
    try {
      const data = await api('/api/overview');
      state.nodes = data.nodes || [];
      state.settings = data.settings || state.settings;
      drawWall();
    } catch (e) { /* keep last frame */ }
  };
  if (!state.nodes.length) refreshWall();
  state.wallTimer = setInterval(refreshWall, 3000);
}

/* ---------- overview ---------- */

async function loadOverview(render = true) {
  try {
    const data = await api('/api/overview');
    state.overviewError = '';
    state.nodes = data.nodes || [];
    state.settings = data.settings || state.settings;
    if (typeof data.has_webhook === 'boolean') state.hasWebhook = data.has_webhook;
    if (typeof data.has_ai_key === 'boolean') state.hasAIKey = data.has_ai_key;
    if (data.version) state.version = data.version;
    ensureSelected();
    updateNodePills();
    syncTray();
    if (render && state.page === 'overview' && !state.subview) {
      drawOverview();
      if (Date.now() - state.auditAt > 20000) loadRailOps();
    }
  } catch (e) {
    state.overviewError = e.message;
    if (state.page === 'overview' && !state.subview) drawOverview();
  }
}

async function refreshNodesLight() {
  if (['overview', 'wall', 'widget', 'topology'].includes(state.page) && !state.subview) return;
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
    syncTray();
  } catch (e) { /* keep current view */ }
}

function renderOverview() {
  drawOverview();
  const sel = currentNode();
  if (!sel || !sel.sftp_only) loadProcesses();
  restartOverviewTimers();
}

function restartOverviewTimers() {
  if (state.page !== 'overview' || state.subview) return;
  if (state.pageTimer) { clearInterval(state.pageTimer); state.pageTimer = null; }
  if (state.procTimer) { clearInterval(state.procTimer); state.procTimer = null; }
  const sel = currentNode();
  if (state.autoRefresh) state.pageTimer = setInterval(() => loadOverview(true), 3000);
  if (state.procOn && (!sel || !sel.sftp_only)) state.procTimer = setInterval(loadProcesses, 9000);
}

let chartSeq = 0;

function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function chartSVG(series, opts = {}) {
  const height = opts.height || 112;
  const w = 600, h = height, pad = 4;
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
    const line = smoothPath(pts);
    if (s.fill) {
      const gid = 'kp-grad-' + (++chartSeq);
      defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity="0.2"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
      paths += `<path d="${line} L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z" fill="url(#${gid})"/>`;
    }
    paths += `<path class="chart-line" d="${line}" stroke="${s.color}"/>`;
  }
  if (!paths) return `<div class="chart-empty">等待采样数据…</div>`;
  const grids = [0.25, 0.5, 0.75].map(f => `<line class="grid-line" x1="0" y1="${(h * f).toFixed(1)}" x2="${w}" y2="${(h * f).toFixed(1)}"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${defs}${grids}${paths}</svg>`;
}

function statCards() {
  const nodes = state.nodes;
  const online = nodes.filter(n => n.online);
  const latest = online.filter(n => !n.sftp_only).map(n => n.latest || {});
  const dockerNodes = latest.filter(m => Number(m.docker_total) >= 0);
  const dockerRunning = dockerNodes.reduce((a, m) => a + Math.max(0, Number(m.docker_running) || 0), 0);
  const dockerTotal = dockerNodes.reduce((a, m) => a + Math.max(0, Number(m.docker_total) || 0), 0);
  const cores = latest.reduce((a, m) => a + Math.max(0, Number(m.cores) || 0), 0);
  const cpuVals = latest.map(m => Number(m.cpu) || 0);
  const avgCpu = cpuVals.length ? cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length : null;
  const maxCpu = cpuVals.length ? Math.max(...cpuVals) : null;
  const memUsed = latest.reduce((a, m) => a + (Number(m.mem_used) || 0), 0);
  const memTotal = latest.reduce((a, m) => a + (Number(m.mem_total) || 0), 0);
  const memP = pct(memUsed, memTotal);
  const offCount = nodes.length - online.length;
  return `<div class="stat-grid">
    <div class="stat-card">
      <div class="stat-label">在线节点</div>
      <div class="stat-value">${online.length}<small>/ ${nodes.length}</small></div>
      <div class="stat-sub ${offCount ? 'warn' : nodes.length ? 'ok' : ''}">${nodes.length ? (offCount ? `${offCount} 台离线` : '全部节点连接正常') : '尚未添加节点'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">运行容器</div>
      <div class="stat-value">${dockerNodes.length ? dockerRunning : '—'}${dockerNodes.length ? '<small>个</small>' : ''}</div>
      <div class="stat-sub">${dockerNodes.length ? `共 ${dockerTotal} 个容器 · ${dockerNodes.length} 台已装 Docker` : '未检测到 Docker'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">平均 CPU 使用率</div>
      <div class="stat-value">${avgCpu != null ? avgCpu.toFixed(1) : '—'}<small>%</small></div>
      <div class="stat-sub">${maxCpu != null ? `最高 ${maxCpu.toFixed(1)}% · ${cores} 核` : '等待采样'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">平均内存占用</div>
      <div class="stat-value">${memTotal ? memP.toFixed(1) : '—'}<small>%</small></div>
      <div class="stat-sub">${memTotal ? `${fmtBytes(memUsed)} / ${fmtBytes(memTotal)}` : '等待采样'}</div>
    </div>
  </div>`;
}

function trendSeries(n) {
  const hist = (n && n.history) || [];
  const m = (n && n.latest) || {};
  if (state.trendMetric === 'mem') {    return {
      title: '内存使用率',
      values: hist.map(s => pct(s.mem_used, s.mem_total)),
      max: 100,
      series: [{ values: hist.map(s => pct(s.mem_used, s.mem_total)), color: '#7c3aed', fill: true }],
      value: m.mem_total ? pct(m.mem_used, m.mem_total).toFixed(1) : '—',
      unit: '%',
      sub: m.mem_total ? `${fmtBytes(m.mem_used)} / ${fmtBytes(m.mem_total)}` : '',
      showDelta: true,
    };
  }
  if (state.trendMetric === 'net') {
    const rx = hist.map(s => Number(s.net_rx) || 0);
    const tx = hist.map(s => Number(s.net_tx) || 0);
    return {
      title: '网络吞吐',
      values: rx,
      max: Math.max(1, ...rx, ...tx),
      series: [
        { values: rx, color: '#2563eb', fill: true },
        { values: tx, color: '#a855f7' },
      ],
      value: fmtRate(m.net_rx),
      unit: '',
      sub: `↑ ${fmtRate(m.net_tx)}`,
      showDelta: false,
      legend: [['下载', '#2563eb'], ['上传', '#a855f7']],
    };
  }
  const cpuVals = hist.map(s => Number(s.cpu) || 0);
  const cpuPeak = Math.max(1, ...cpuVals);
  return {
    title: 'CPU 使用率',
    values: cpuVals,
    max: Math.max(10, Math.ceil((cpuPeak * 1.25) / 10) * 10),
    series: [{ values: cpuVals, color: '#2563eb', fill: true }],
    value: m.cpu != null ? Number(m.cpu).toFixed(1) : '—',
    unit: '%',
    sub: `${m.cores || '-'} 核 · 负载 ${m.load1 != null ? Number(m.load1).toFixed(2) : '-'}`,
    showDelta: true,
  };
}

function trendCard(n) {
  if (!n) {
    return `<div class="card trend-card"><div class="empty" style="padding:34px 16px"><h3>暂无监控数据</h3><p>添加节点后开始采集 CPU、内存与网络趋势</p></div></div>`;
  }
  const d = trendSeries(n);
  const hist = n.history || [];
  const valid = d.values.filter(v => typeof v === 'number' && isFinite(v));
  let deltaHTML = '';
  if (d.showDelta && valid.length >= 2) {
    const diff = valid[valid.length - 1] - valid[0];
    deltaHTML = `<span class="delta ${diff < 0 ? 'down' : ''}">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%</span>`;
  }
  const samples = valid.length;
  const spanSec = Math.max(0, (samples - 1) * 3);
  const times = hist.map(s => Number(s.time) || 0).filter(t => t > 0);
  const fmtClock = t => new Date(t * 1000).toLocaleTimeString('zh-CN', { hour12: false });
  const tick = i => {
    if (samples < 2) return '';
    if (i === 4) return '现在';
    if (times.length >= 2) return fmtClock(times[Math.round((times.length - 1) * i / 4)]);
    const sec = Math.round(spanSec * (1 - i / 4));
    if (sec >= 60) return `-${Math.round(sec / 60)} 分钟`;
    return `-${sec} 秒`;
  };
  const ticks = [0, 1, 2, 3, 4].map(i => `<span>${tick(i)}</span>`).join('');
  const metric = state.trendMetric;
  return `<div class="card trend-card">
    <div class="trend-head">
      <div>
        <div class="trend-title">资源趋势</div>
        <div class="trend-sub">当前节点 · ${esc(n.name)} · 每 3 秒采样</div>
      </div>
      <div class="trend-tabs" id="trendTabs">
        <button type="button" data-metric="cpu" class="${metric === 'cpu' ? 'active' : ''}">CPU</button>
        <button type="button" data-metric="mem" class="${metric === 'mem' ? 'active' : ''}">内存</button>
        <button type="button" data-metric="net" class="${metric === 'net' ? 'active' : ''}">网络</button>
      </div>
    </div>
    <div class="trend-value"><b>${esc(d.value)}</b>${d.unit ? `<span class="trend-unit">${esc(d.unit)}</span>` : ''}${deltaHTML}<span class="trend-sub-inline">${esc(d.sub)}${samples ? ` · ${samples} 个采样点` : ''}</span></div>
    <div class="trend-chart">${chartSVG(d.series, { height: 176, max: d.max })}</div>
    <div class="trend-foot">
      <div class="trend-x">${ticks}</div>
      ${d.legend ? `<div class="chart-legend">${d.legend.map(([label, color]) => `<span class="legend-item"><i class="legend-swatch" style="background:${color}"></i>${label}</span>`).join('')}</div>` : ''}
    </div>
  </div>`;
}

function nodesCard() {
  if (!state.nodes.length) return noNodeHTML();
  return `<div class="card list-card">
    <div class="list-head">
      <h2>节点状态</h2>
      <span class="faint">${state.nodes.length} 台 · 点击切换当前节点</span>
    </div>
    ${state.nodes.map(n => {
      const m = n.latest || {};
      const memP = pct(m.mem_used, m.mem_total);
      const diskP = pct(m.disk_used, m.disk_total);
      const alerts = state.alertOn ? (n.alerts || []).filter(a => a !== '离线') : [];
      return `<div class="node-line ${n.id === state.selected ? 'active' : ''}" data-node="${esc(n.id)}" tabindex="0">
        <div class="nl-name">
          <span class="avatar" style="background:${avatarColor(n.id)}">${esc(initialOf(n.name))}</span>
          <div class="nl-main">
            <b>${esc(n.name)}${n.id === state.selected ? '<span class="tag-soft">当前</span>' : ''}${n.sftp_only ? '<span class="tag-soft">仅文件</span>' : ''}${alerts.length ? `<span class="alert-chip">${esc(alerts[0])}</span>` : ''}</b>
            <span>${n.sftp_only ? `虚拟主机 · ${esc(n.file_root || '/')}` : `${esc(n.user)}@${esc(n.addr)} · ${esc(m.os || '未知系统')}`}</span>
          </div>
        </div>
        <div class="nl-metric">${n.sftp_only ? '—' : n.online ? (Number(m.cpu) || 0).toFixed(1) + '%' : '—'}<span>CPU</span></div>
        <div class="nl-metric">${m.mem_total ? memP.toFixed(0) + '%' : '—'}<span>内存</span></div>
        <div class="nl-metric">${m.disk_total ? diskP.toFixed(0) + '%' : '—'}<span>磁盘</span></div>
        <div class="nl-state"><span class="dot ${nodeDotClass(n)}"></span>${nodeStateText(n)}</div>
      </div>`;
    }).join('')}
  </div>`;
}

function detailCards(n) {
  if (!n) return '';
  const m = n.latest || {};
  const memP = pct(m.mem_used, m.mem_total);
  const diskP = pct(m.disk_used, m.disk_total);
  const diskWarn = state.alertOn && diskP >= (state.settings.disk_alert || 90);
  return `<div class="split-grid">
    <div class="card">
      <div class="card-head">
        <div><h2>系统信息</h2><p>${esc(n.name)} · ${esc(n.user)}@${esc(n.addr)}</p></div>
        <div class="head-actions">
          <button class="btn sm ghost" id="goTerminal">终端</button>
          <button class="btn sm ghost" id="goContainers">容器</button>
        </div>
      </div>
      ${!n.online && (n.waking || n.error) ? `<div class="banner error">${n.waking ? '正在自动唤醒 Instabox 机器，请稍候…' : '连接失败：' + esc(n.error)}</div>` : ''}
      <div class="info-list">
        <div class="info-row"><span>主机名</span><span>${esc(m.hostname || '-')}</span></div>
        <div class="info-row"><span>系统</span><span class="os-pill" title="${esc(m.os || '')}">${esc(m.os || '-')}</span></div>
        <div class="info-row"><span>内核</span><span>${esc(m.kernel || '-')}</span></div>
        <div class="info-row"><span>运行时间</span><span>${m.uptime ? fmtUptime(m.uptime) : '-'}</span></div>
        <div class="info-row"><span>负载</span><span>${(Number(m.load1) || 0).toFixed(2)} / ${(Number(m.load5) || 0).toFixed(2)} / ${(Number(m.load15) || 0).toFixed(2)}</span></div>
        <div class="info-row"><span>CPU 温度</span><span>${m.temp > 0 ? m.temp.toFixed(1) + ' °C' : '未检测到'}</span></div>
        <div class="info-row"><span>Docker</span><span>${m.docker_total >= 0 ? `${m.docker_running} 运行 / ${m.docker_total} 个` : '未安装'}</span></div>
        <div class="info-row"><span>内存</span><span>${m.mem_total ? `${fmtBytes(m.mem_used)} / ${fmtBytes(m.mem_total)} · ${memP.toFixed(0)}%` : '-'}</span></div>
      </div>
      <div class="disk-block">
        <div class="disk-head"><span>磁盘</span><span>${m.disk_total ? `${fmtBytes(m.disk_used)} / ${fmtBytes(m.disk_total)}` : '-'}</span></div>
        <div class="bar-track"><div class="bar-fill ${diskWarn ? 'warn' : ''}" style="width:${diskP.toFixed(1)}%"></div></div>
        <div class="disk-pct">${m.disk_total ? diskP.toFixed(1) + '%' : '-'}</div>
      </div>
    </div>
    <div class="card">
      <div class="card-head">
        <div><h2>进程 Top 10</h2><p>按 CPU 占用排序</p></div>
        <span class="live-pill sm"><span class="live-dot"></span>${state.procOn ? '9 秒刷新' : '已暂停'}</span>
      </div>
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

function vhostCard(n) {
  return `<div class="card">
    <div class="card-head">
      <div><h2>虚拟主机</h2><p>${esc(n.name)} · ${esc(n.user)}@${esc(n.addr)}</p></div>
      <div class="head-actions">
        <button class="btn sm primary" id="goVhostFiles">文件管理</button>
        <button class="btn sm ghost" id="editVhost">编辑节点</button>
      </div>
    </div>
    ${!n.online && n.error ? `<div class="banner error">连接失败：${esc(n.error)}</div>` : ''}
    <div class="info-list">
      <div class="info-row"><span>节点类型</span><span>虚拟主机 · 仅文件管理</span></div>
      <div class="info-row"><span>文件根目录</span><span class="mono">${esc(n.file_root || '/')}</span></div>
      <div class="info-row"><span>连接状态</span><span>${nodeStateText(n)}</span></div>
      <div class="info-row"><span>说明</span><span>通过 SFTP 连接，不提供系统监控、容器、终端和应用部署。</span></div>
    </div>
  </div>`;
}

function drawOverview() {
  const page = $('#page');
  if (!page) return;
  const sel = currentNode();
  const online = state.nodes.filter(n => n.online).length;
  page.innerHTML = `
    ${state.overviewError ? `<div class="banner error">${esc(state.overviewError)}</div>` : ''}
    <section class="page-head">
      <div><h1>概览</h1><p class="page-sub">${todayCN()} · ${state.nodes.length ? `${online} / ${state.nodes.length} 台节点在线` : '尚未添加节点'}</p></div>
      <div class="head-actions">
        <button class="btn sm" id="ovInspect">${ico('activity', 'ico')}一键巡检</button>
        <button class="btn sm" id="ovWall">${ico('wall', 'ico')}大屏</button>
        <button class="btn sm" id="ovRefresh">刷新</button>
        <button class="btn sm primary" id="ovAddNode">${ico('plus', 'ico')}添加节点</button>
      </div>
    </section>
    ${state.nodes.length ? (sel && sel.sftp_only ? vhostCard(sel) + nodesCard() : statCards() + trendCard(sel) + nodesCard() + detailCards(sel)) : noNodeHTML()}`;

  const refresh = $('#ovRefresh');
  if (refresh) refresh.addEventListener('click', () => loadOverview(true));
  const inspectBtn = $('#ovInspect');
  if (inspectBtn) inspectBtn.addEventListener('click', openInspect);
  const wallBtn = $('#ovWall');
  if (wallBtn) wallBtn.addEventListener('click', () => navigate('wall'));
  const addNode = $('#ovAddNode');
  if (addNode) addNode.addEventListener('click', () => openNodeForm(null));
  const tabs = $('#trendTabs');
  if (tabs) {
    tabs.addEventListener('click', e => {
      const btn = e.target.closest('[data-metric]');
      if (!btn || btn.dataset.metric === state.trendMetric) return;
      state.trendMetric = btn.dataset.metric;
      drawOverview();
    });
  }
  $$('.node-line[data-node]', page).forEach(row => {
    const go = () => selectNode(row.dataset.node);
    row.addEventListener('click', go);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  const term = $('#goTerminal');
  if (term) term.addEventListener('click', () => navigate('terminal'));
  const cont = $('#goContainers');
  if (cont) cont.addEventListener('click', () => navigate('containers'));
  const vfiles = $('#goVhostFiles');
  if (vfiles) vfiles.addEventListener('click', () => navigate('files'));
  const vedit = $('#editVhost');
  if (vedit && sel) vedit.addEventListener('click', () => openNodeForm(sel.id));
  bindNoNode();
}

function renderRail() {
  const rail = $('#rail');
  if (!rail) return;
  rail.innerHTML = `
    <section class="rail-card">
      <div class="rail-head"><b>节点快切</b><span id="railCount"></span></div>
      <div class="rail-nodes" id="railNodes"></div>
      <button class="rail-add" id="railAdd" type="button">+ 添加节点</button>
    </section>
    <section class="rail-card">
      <div class="rail-head"><b>功能开关</b><span>偏好设置</span></div>
      <label class="switch-row">
        <span class="sw-main"><b>自动刷新</b><span>概览数据每 3 秒更新</span></span>
        <span class="toggle"><input type="checkbox" id="prefAuto" ${state.autoRefresh ? 'checked' : ''}><i></i></span>
      </label>
      <label class="switch-row">
        <span class="sw-main"><b>进程排行</b><span>定时拉取 Top 10 进程</span></span>
        <span class="toggle"><input type="checkbox" id="prefProc" ${state.procOn ? 'checked' : ''}><i></i></span>
      </label>
      <label class="switch-row">
        <span class="sw-main"><b>告警高亮</b><span>超过阈值时在概览提示</span></span>
        <span class="toggle"><input type="checkbox" id="prefAlert" ${state.alertOn ? 'checked' : ''}><i></i></span>
      </label>
    </section>
    <section class="rail-card">
      <div class="rail-head"><b>最近操作</b><span id="railOpsCount"></span></div>
      <div class="rail-ops" id="railOps"><div class="rail-empty">加载中…</div></div>
    </section>`;
  $('#railAdd').addEventListener('click', () => openNodeForm(null));
  $('#prefAuto').addEventListener('change', e => {
    state.autoRefresh = e.target.checked;
    localStorage.setItem('kp_auto', state.autoRefresh ? '1' : '0');
    restartOverviewTimers();
    if (state.autoRefresh) loadOverview(true);
  });
  $('#prefProc').addEventListener('change', e => {
    state.procOn = e.target.checked;
    localStorage.setItem('kp_proc', state.procOn ? '1' : '0');
    restartOverviewTimers();
    if (state.procOn) loadProcesses();
    else drawOverview();
  });
  $('#prefAlert').addEventListener('change', e => {
    state.alertOn = e.target.checked;
    localStorage.setItem('kp_alert', state.alertOn ? '1' : '0');
    drawOverview();
  });
  updateRailNodes();
  loadRailOps();
}

function updateRailNodes() {
  const host = $('#railNodes');
  if (!host) return;
  const count = $('#railCount');
  if (count) count.textContent = `${state.nodes.length} 台`;
  if (!state.nodes.length) {
    host.innerHTML = `<div class="rail-empty">尚未添加节点</div>`;
    return;
  }
  host.innerHTML = state.nodes.map(n => `
    <button type="button" class="acct-item ${n.id === state.selected ? 'active' : ''}" data-node="${esc(n.id)}">
      <span class="avatar" style="background:${avatarColor(n.id)}">${esc(initialOf(n.name))}</span>
      <span class="acct-main"><b>${esc(n.name)}${n.id === state.selected ? '<span class="tag-soft">当前</span>' : ''}</b><span>${esc(n.user)}@${esc(n.addr)}</span></span>
      <span class="acct-state"><span class="dot ${nodeDotClass(n)}"></span>${nodeStateText(n)}</span>
    </button>`).join('');
  host.onclick = e => {
    const btn = e.target.closest('[data-node]');
    if (btn) selectNode(btn.dataset.node);
  };
}

async function loadRailOps() {
  const host = $('#railOps');
  if (!host) return;
  try {
    if (!state.audit.length || Date.now() - state.auditAt > 20000) {
      const d = await api('/api/audit?limit=5');
      state.audit = d.entries || [];
      state.auditAt = Date.now();
    }
    const list = state.audit.slice(-4).reverse();
    const count = $('#railOpsCount');
    if (count) count.textContent = state.audit.length ? `${state.audit.length} 条` : '';
    if (!list.length) { host.innerHTML = `<div class="rail-empty">暂无操作记录</div>`; return; }
    host.innerHTML = list.map(en => {
      const time = String(en.time || '');
      return `<div class="op-row">
        <span class="op-main"><b>${esc(en.action)}</b><span>${esc(en.detail || '')}</span></span>
        <span class="op-right"><span class="chip done">完成</span><span class="op-time">${esc(time.slice(11, 19) || time)}</span></span>
      </div>`;
    }).join('');
  } catch (e) {
    host.innerHTML = `<div class="rail-empty">${esc(e.message)}</div>`;
  }
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
      <div class="head-actions"><button class="btn sm" id="ctrRefresh">刷新</button></div>
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
      `<button class="btn sm ghost" data-act="update" data-id="${esc(c.id)}" data-name="${esc(c.name)}" data-image="${esc(c.image)}">更新</button>`,
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
  if (act === 'update') {
    const img = btn.dataset.image || '';
    if (!await confirmDialog('更新容器', `将拉取镜像「${img}」并按原配置重建「${name}」，期间服务会短暂中断。`, '开始更新')) return;
    btn.disabled = true;
    btn.textContent = '更新中…';
    try {
      const d = await api(`/api/nodes/${n.id}/containers/${encodeURIComponent(id)}/update`, { method: 'POST', body: '{}' });
      toast(firstLine(d.output) || '更新完成', 'success', 4000);
      loadContainers();
    } catch (err) {
      toast(err.message, 'error', 8000);
      btn.disabled = false;
      btn.textContent = '更新';
    }
    return;
  }
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
        <button class="btn sm" id="stacksRefresh">刷新</button>
        <button class="btn sm" id="aiStackBtn">${ico('spark')} AI 装应用</button>
        <button class="btn sm primary" id="newStack">新建应用</button>
      </div>
    </section>
    <div id="appsError" class="banner error hidden"></div>
    <div class="stack-grid" id="stackGrid"><div class="empty">加载中…</div></div>`;

  $('#stacksRefresh').addEventListener('click', loadStacks);
  $('#aiStackBtn').addEventListener('click', openAIStack);
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
      <p>从内置模板开始，或用一句话让 AI 生成部署方案。应用目录：${esc(currentNode() ? currentNode().stacks_dir : '')}</p>
      <div class="empty-actions">
        <button class="btn primary" id="newStackEmpty">新建应用</button>
        <button class="btn" id="aiStackEmpty">${ico('spark')} AI 装应用</button>
      </div>
    </div>`;
    const b = $('#newStackEmpty');
    if (b) b.addEventListener('click', () => openStackEditor('', true));
    const a = $('#aiStackEmpty');
    if (a) a.addEventListener('click', openAIStack);
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
      <div class="head-actions"><button class="btn sm" id="fileRefresh">刷新</button></div>
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
        <button class="btn sm" id="termReconnect">重新连接</button>
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

/* ---------- ai ---------- */

function aiActionHTML(a, mi, ai) {
  const actIcon = a.type && a.type.startsWith('disk') ? 'server' : 'container';
  const btn = a.done
    ? '<button class="btn sm ghost" type="button" disabled>已执行</button>'
    : `<button class="btn sm ${a.danger ? 'danger' : 'primary'}" type="button" data-mi="${mi}" data-ai="${ai}">执行</button>`;
  return `<div class="ai-act ${a.danger ? 'risk' : ''}">
    <span class="ai-act-ic">${ico(actIcon)}</span>
    <div class="ai-act-main">
      <div class="ai-act-title"><b>${esc(a.label)}</b>${a.read_only ? '<span class="ai-act-ro">只读</span>' : '<span class="ai-act-risk">会改动服务器</span>'}</div>
      <div class="ai-act-detail">${esc(a.detail)}${a.reason ? ' · ' + esc(a.reason) : ''}</div>
      <code class="ai-act-cmd">${esc(a.command)}</code>
    </div>
    ${btn}
  </div>`;
}

function aiBubble(m, idx) {
  const acts = m.actions && m.actions.length
    ? `<div class="ai-acts">${m.actions.map((a, i) => aiActionHTML(a, idx, i)).join('')}</div>`
    : '';
  const output = m.output ? `<pre class="ai-pre">${esc(m.output)}</pre>` : '';
  return `<div class="ai-msg ${m.role === 'user' ? 'user' : 'assistant'} ${m.error ? 'err' : ''}">
    <div class="ai-role">${m.role === 'user' ? '我' : 'AI'}</div>
    <div class="ai-body">
      <div class="ai-text">${esc(m.content)}${output}</div>
      ${acts}
    </div>
  </div>`;
}

function aiChatHTML() {
  const n = currentNode();
  if (!state.aiMessages.length) {
    const samples = ['这台机器现在有什么异常？', 'CPU / 内存占用高，可能是什么原因？', '帮我看看哪些进程最吃资源？', '磁盘快满了，怎么安全清理？'];
    return `<div class="ai-empty">
      <div class="ai-empty-title">${n ? esc(n.name) + ' · 实时上下文已就绪' : '请选择一个节点'}</div>
      <p>AI 会读取当前节点的指标、进程和容器列表用于分析，也可以提议重启容器、看日志、分析或清理磁盘；执行前都会弹窗确认。</p>
      <div class="ai-samples">${samples.map(q => `<button type="button" class="ai-sample" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    </div>`;
  }
  return state.aiMessages.map((m, i) => aiBubble(m, i)).join('') +
    (state.aiBusy ? `<div class="ai-msg assistant"><div class="ai-role">AI</div><div class="ai-text ai-thinking">思考中…</div></div>` : '');
}

function renderAIChat() {
  const box = $('#aiChat');
  if (!box) return;
  box.innerHTML = aiChatHTML();
  box.scrollTop = box.scrollHeight;
}

async function sendAI(text) {
  if (state.aiBusy) return;
  const q = String(text || '').trim();
  if (!q) return;
  const n = currentNode();
  if (!n) { toast('请先选择节点', 'error'); return; }
  bumpStat('kp_ai_msgs');
  checkAchievements();
  state.aiMessages.push({ role: 'user', content: q });
  state.aiBusy = true;
  renderAIChat();
  if ($('#aiSend')) $('#aiSend').disabled = true;
  try {
    const history = state.aiMessages.filter(m => !m.error).slice(-12);
    const d = await api('/api/ai/chat', { method: 'POST', body: JSON.stringify({ node_id: n.id, messages: history }) });
    state.aiMessages.push({ role: 'assistant', content: d.reply || '（空回复）', actions: d.actions || [] });
  } catch (e) {
    state.aiMessages.push({ role: 'assistant', content: e.message, error: true });
  }
  state.aiBusy = false;
  renderAIChat();
  if ($('#aiSend')) $('#aiSend').disabled = false;
  if ($('#aiInput')) $('#aiInput').focus();
}

async function runAIAction(btn, a) {
  const n = currentNode();
  if (!n) { toast('请先选择节点', 'error'); return; }
  const desc = `${n.name} · ${a.detail}\n\n将要执行的命令：\n${a.command}\n\n` +
    (a.read_only ? '该操作只读取信息，不会修改服务器。' : '该操作会改动服务器状态，请确认当前业务可以承受。');
  if (!await confirmDialog(a.label, desc, a.danger ? '确认执行' : '执行', a.danger)) return;
  btn.disabled = true;
  btn.textContent = '执行中…';
  try {
    const d = await api('/api/ai/action', {
      method: 'POST',
      body: JSON.stringify({ node_id: n.id, type: a.type, target: a.target || '' }),
    });
    a.done = true;
    state.aiMessages.push({ role: 'assistant', content: `${a.label}执行完成（${a.detail}）`, output: d.output || '（无输出）' });
    toast(`${a.label}完成`);
  } catch (e) {
    a.done = true;
    state.aiMessages.push({ role: 'assistant', content: `${a.label}执行失败：${e.message}`, error: true });
    toast('执行失败', 'error');
  }
  renderAIChat();
}

function renderAI() {
  const n = currentNode();
  const page = $('#page');
  page.innerHTML = `
    <section class="page-head">
      <div><h1>AI 助手</h1><p class="page-sub">${n ? esc(n.name) + ' · ' + esc(n.addr) : '选择节点后提问'}</p></div>
      <div class="head-actions">
        <button class="btn sm ghost" id="aiClear">清空对话</button>
        <button class="btn sm" id="aiSettings">AI 设置</button>
      </div>
    </section>
    ${state.hasAIKey ? '' : '<div class="banner warn">尚未配置 AI 接口，请先在「设置 → AI 运维助手」填写 Base URL、模型和 API Key。</div>'}
    <div class="card ai-card">
      <div class="ai-chat" id="aiChat">${aiChatHTML()}</div>
      <div class="ai-input">
        <textarea id="aiInput" rows="2" placeholder="例如：这台机器为什么变慢？需要注意什么？"></textarea>
        <button class="btn primary" id="aiSend" ${state.aiBusy ? 'disabled' : ''}>发送</button>
      </div>
      <div class="ai-hint">AI 可提议重启容器、查看日志、分析或清理磁盘；执行前都会弹窗确认，只放行面板内置的白名单命令。</div>
    </div>`;
  $('#aiClear').addEventListener('click', () => { state.aiMessages = []; renderAIChat(); });
  $('#aiSettings').addEventListener('click', () => navigate('settings'));
  $('#aiSend').addEventListener('click', () => { const el = $('#aiInput'); sendAI(el.value); el.value = ''; });
  $('#aiInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const el = e.target; sendAI(el.value); el.value = ''; }
  });
  $('#aiChat').addEventListener('click', e => {
    const b = e.target.closest('[data-q]');
    if (b) { sendAI(b.dataset.q); return; }
    const act = e.target.closest('[data-mi][data-ai]');
    if (!act) return;
    const msg = state.aiMessages[Number(act.dataset.mi)];
    const a = msg && msg.actions && msg.actions[Number(act.dataset.ai)];
    if (a) runAIAction(act, a);
  });
  renderAIChat();
}

/* ---------- inspect ---------- */

const INSPECT_TONES = { '优秀': '#16a34a', '良好': '#2563eb', '一般': '#d97706', '需关注': '#dc2626', '在线': '#0891b2', '离线': '#64748b' };
const INSPECT_CLASSES = { '优秀': 'ok', '良好': 'good', '一般': 'fair', '需关注': 'bad', '在线': 'info', '离线': 'off' };

function inspectTone(grade) { return INSPECT_TONES[grade] || '#64748b'; }
function inspectClass(grade) { return INSPECT_CLASSES[grade] || 'off'; }

function openInspect() {
  if (state.subview && state.subview.type === 'inspect') return;
  state.subview = { type: 'inspect' };
  state.inspect = null;
  state.inspectError = '';
  state.inspectBusy = false;
  renderPage();
  loadInspect();
}

async function loadInspect() {
  if (state.inspectBusy) return;
  state.inspectBusy = true;
  if (state.subview && state.subview.type === 'inspect') renderPage();
  try {
    state.inspect = await api('/api/inspect');
    state.inspectError = '';
    bumpStat('kp_inspected');
    checkAchievements();
  } catch (e) {
    state.inspectError = e.message;
    toast(e.message, 'error');
  }
  state.inspectBusy = false;
  if (state.subview && state.subview.type === 'inspect') renderPage();
}

function inspectNodeHTML(n) {
  const cls = inspectClass(n.grade);
  const metric = (label, v) => {
    const p = Math.max(0, Math.min(100, Number(v) || 0));
    const bar = p >= 90 ? 'bad' : p >= 80 ? 'fair' : p >= 65 ? 'mid' : 'ok';
    return `<div class="insp-metric">
      <div class="insp-metric-head"><span>${label}</span><b>${p.toFixed(1)}%</b></div>
      <div class="insp-metric-bar"><i class="${bar}" style="width:${p.toFixed(1)}%"></i></div>
    </div>`;
  };
  let body;
  if (!n.online) {
    body = `<div class="insp-offline">节点离线，无法读取系统指标</div>`;
  } else if (n.sftp_only) {
    body = `<div class="insp-offline info">虚拟主机 · 仅 SFTP 文件管理，不采集系统指标</div>`;
  } else {
    body = `<div class="insp-metrics">${metric('CPU', n.cpu)}${metric('内存', n.mem_pct)}${metric('磁盘', n.disk_pct)}</div>
      <div class="insp-meta">
        <span>负载 <b>${(Number(n.load1) || 0).toFixed(2)}</b></span>
        <span>运行 <b>${fmtUptime(n.uptime)}</b></span>
        <span>Docker <b>${n.docker_total > 0 ? `${n.docker_running}/${n.docker_total}` : '未安装'}</b></span>
        ${n.temp > 0 ? `<span>温度 <b>${n.temp.toFixed(0)}°C</b></span>` : ''}
      </div>`;
  }
  const issues = n.issues && n.issues.length
    ? n.issues.map(x => `<span>${esc(x)}</span>`).join('')
    : '<span class="ok">未发现明显问题</span>';
  return `<div class="card insp-node tone-${cls}">
    <div class="insp-node-head">
      <span class="avatar" style="background:${avatarColor(n.id)}">${esc(initialOf(n.name))}</span>
      <div class="insp-node-main">
        <b>${esc(n.name)}${n.sftp_only ? '<span class="tag-soft">仅文件</span>' : ''}</b>
        <span>${esc(n.user)}@${esc(n.addr)}${n.os ? ' · ' + esc(n.os) : ''}</span>
      </div>
      <div class="insp-score"><b>${n.score}</b><span>${esc(n.grade)}</span></div>
    </div>
    ${body}
    <div class="insp-issues ${n.issues && n.issues.length ? 'has' : ''}">${issues}</div>
  </div>`;
}

function inspectHTML(d) {
  const counts = d.counts || {};
  const chip = g => `<span class="insp-chip tone-${inspectClass(g)}"><i></i>${g} ${counts[g] || 0}</span>`;
  return `<div class="card insp-hero">
      <div class="insp-ring" style="--pct:${d.average};--tone:${inspectTone(d.grade)}">
        <div class="insp-ring-in"><b>${d.average}</b><span>综合评分</span></div>
      </div>
      <div class="insp-hero-main">
        <div class="insp-hero-title">整体状态 <span class="insp-pill tone-${inspectClass(d.grade)}">${esc(d.grade)}</span></div>
        <p>共 ${d.total} 台节点，在线 ${d.online} 台。评分来自 CPU、内存、磁盘、负载、温度、容器运行状态与近期峰值，满分 100。</p>
        <div class="insp-chips">
          <span class="insp-chip all"><i></i>全部 ${d.total}</span>
          ${chip('优秀')}${chip('良好')}${chip('一般')}${chip('需关注')}${counts['在线'] ? chip('在线') : ''}${counts['离线'] ? chip('离线') : ''}
        </div>
      </div>
      <div class="insp-time">巡检快照<br><b>${fmtTime(d.time)}</b></div>
    </div>
    <div class="insp-grid">${d.nodes.map(inspectNodeHTML).join('')}</div>
    <div class="insp-foot">长图会带上巡检时间与每台节点的评分明细，可直接发到群里。</div>`;
}

function renderInspect() {
  const page = $('#page');
  if (!page) return;
  const d = state.inspect;
  const canExport = !!d && !state.inspectBusy;
  page.innerHTML = `
    <section class="page-head">
      <div><h1>一键巡检报告</h1><p class="page-sub">${d ? `${fmtTime(d.time)} · ${d.total} 台节点` : '正在读取所有节点指标…'}</p></div>
      <div class="head-actions">
        <button class="btn sm ghost" id="inspBack">返回概览</button>
        <button class="btn sm" id="inspRefresh" ${state.inspectBusy ? 'disabled' : ''}>${state.inspectBusy ? '巡检中…' : '重新巡检'}</button>
        <button class="btn sm" id="inspCopy" ${canExport ? '' : 'disabled'}>复制图片</button>
        <button class="btn sm primary" id="inspSave" ${canExport ? '' : 'disabled'}>保存长图</button>
      </div>
    </section>
    ${state.inspectError ? `<div class="banner error">${esc(state.inspectError)}</div>` : ''}
    ${!d ? `<div class="card empty"><h3>正在巡检…</h3><p>读取节点实时指标，计算健康分与扣分项</p></div>` : inspectHTML(d)}`;
  $('#inspBack').addEventListener('click', () => { state.subview = null; renderPage(); });
  $('#inspRefresh').addEventListener('click', loadInspect);
  if (canExport) {
    $('#inspSave').addEventListener('click', saveInspectImage);
    $('#inspCopy').addEventListener('click', copyInspectImage);
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitCanvasText(ctx, text, maxW) {
  text = String(text || '');
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function inspectBarColor(p) {
  if (p >= 90) return '#dc2626';
  if (p >= 80) return '#d97706';
  if (p >= 65) return '#2563eb';
  return '#16a34a';
}

const INSPECT_FONT = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif';

function buildInspectCanvas(d) {
  const dpr = 2;
  const W = 900, pad = 36;
  const cardX = pad, cardW = W - pad * 2;
  const headerH = 208, chipsH = 76, nodeH = 172, nodeGap = 14, footerH = 76;
  const nodes = d.nodes || [];
  const H = pad + headerH + chipsH + Math.max(nodes.length, 1) * (nodeH + nodeGap) + footerH + 16;
  const canvas = document.createElement('canvas');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#eef2f8';
  ctx.fillRect(0, 0, W, H);
  roundRectPath(ctx, cardX, pad, cardW, H - pad * 2, 26);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.save();
  roundRectPath(ctx, cardX, pad, cardW, headerH, 26);
  ctx.clip();
  const g = ctx.createLinearGradient(cardX, pad, cardX + cardW, pad + headerH);
  g.addColorStop(0, '#1e40af');
  g.addColorStop(0.55, '#2563eb');
  g.addColorStop(1, '#0891b2');
  ctx.fillStyle = g;
  ctx.fillRect(cardX, pad, cardW, headerH);
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(cardX + cardW - 60, pad + 24, 140, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cardX + cardW - 230, pad + headerH + 40, 96, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(219, 234, 254, 0.95)';
  ctx.font = '600 13px ' + INSPECT_FONT;
  ctx.fillText('KAYPANEL · 一键巡检', cardX + 44, pad + 48);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 34px ' + INSPECT_FONT;
  ctx.fillText('服务器巡检报告', cardX + 44, pad + 102);
  ctx.fillStyle = 'rgba(219, 234, 254, 0.92)';
  ctx.font = '400 14px ' + INSPECT_FONT;
  ctx.fillText(`${fmtTime(d.time)} · 共 ${d.total} 台节点 · 在线 ${d.online} 台`, cardX + 44, pad + 136);
  ctx.fillStyle = 'rgba(219, 234, 254, 0.75)';
  ctx.font = '400 12px ' + INSPECT_FONT;
  ctx.fillText(`KayPanel ${d.version || ''}`, cardX + 44, pad + 168);

  const cx = cardX + cardW - 112, cy = pad + 100, r = 62;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, r - 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(100, d.average)) / 100);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff'; ctx.font = '700 42px ' + INSPECT_FONT;
  ctx.fillText(String(d.average), cx, cy + 10);
  ctx.fillStyle = 'rgba(219, 234, 254, 0.9)'; ctx.font = '400 12px ' + INSPECT_FONT;
  ctx.fillText('综合评分', cx, cy + 32);
  ctx.textAlign = 'left';
  ctx.restore();

  const counts = d.counts || {};
  const chips = [
    ['全部', d.total, '#64748b', '#f1f5f9'],
    ['优秀', counts['优秀'] || 0, '#16a34a', '#e9f7ef'],
    ['良好', counts['良好'] || 0, '#2563eb', '#eef4ff'],
    ['一般', counts['一般'] || 0, '#b45309', '#fff7e8'],
    ['需关注', counts['需关注'] || 0, '#dc2626', '#fef2f2'],
  ];
  if (counts['在线']) chips.push(['在线', counts['在线'], '#0891b2', '#ecfeff']);
  if (counts['离线']) chips.push(['离线', counts['离线'], '#64748b', '#f1f5f9']);
  let chipX = cardX + 44;
  const chipY = pad + headerH + 22;
  for (const [label, value, color, soft] of chips) {
    const cw = 104;
    roundRectPath(ctx, chipX, chipY, cw, 34, 8);
    ctx.fillStyle = soft; ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(chipX + 15, chipY + 17, 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = '600 13px ' + INSPECT_FONT;
    ctx.fillText(label, chipX + 26, chipY + 22);
    ctx.textAlign = 'right';
    ctx.font = '700 15px ' + INSPECT_FONT;
    ctx.fillText(String(value), chipX + cw - 12, chipY + 23);
    ctx.textAlign = 'left';
    chipX += cw + 8;
  }

  let y = pad + headerH + chipsH;
  if (!nodes.length) {
    ctx.fillStyle = '#94a3b8'; ctx.font = '400 14px ' + INSPECT_FONT;
    ctx.textAlign = 'center';
    ctx.fillText('尚未添加节点', W / 2, y + 80);
    ctx.textAlign = 'left';
  }
  for (const n of nodes) {
    const tone = inspectTone(n.grade);
    const x = cardX + 28, w = cardW - 56;
    roundRectPath(ctx, x, y, w, nodeH, 16);
    ctx.fillStyle = '#fbfcfe'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = '#e5eaf2'; ctx.stroke();
    roundRectPath(ctx, x, y + 16, 5, nodeH - 32, 2.5);
    ctx.fillStyle = tone; ctx.fill();

    const nx = x + 26;
    ctx.fillStyle = '#0f172a'; ctx.font = '600 18px ' + INSPECT_FONT;
    ctx.fillText(fitCanvasText(ctx, n.name, 480), nx, y + 34);
    ctx.fillStyle = '#64748b'; ctx.font = '400 12px ' + INSPECT_FONT;
    const subtitle = `${n.user ? n.user + '@' : ''}${n.addr}${n.os ? ' · ' + n.os : ''}`;
    ctx.fillText(fitCanvasText(ctx, subtitle, 540), nx, y + 56);

    ctx.textAlign = 'right';
    ctx.fillStyle = tone; ctx.font = '700 32px ' + INSPECT_FONT;
    ctx.fillText(String(n.score), x + w - 92, y + 42);
    ctx.fillStyle = '#94a3b8'; ctx.font = '400 12px ' + INSPECT_FONT;
    ctx.fillText('分', x + w - 72, y + 42);
    ctx.fillStyle = tone; ctx.font = '600 12px ' + INSPECT_FONT;
    ctx.fillText(n.grade, x + w - 72, y + 62);
    ctx.textAlign = 'left';

    let issueText, issueColor;
    if (!n.online) {
      issueText = '节点离线，无法读取指标' + (n.issues && n.issues[1] ? ' · ' + n.issues[1] : '');
      issueColor = '#dc2626';
      ctx.fillStyle = '#94a3b8'; ctx.font = '400 12.5px ' + INSPECT_FONT;
      ctx.fillText('无法获取 CPU / 内存 / 磁盘数据', nx, y + 96);
    } else if (n.sftp_only) {
      issueText = '虚拟主机 · 仅 SFTP 文件管理';
      issueColor = '#0891b2';
      ctx.fillStyle = '#94a3b8'; ctx.font = '400 12.5px ' + INSPECT_FONT;
      ctx.fillText('不采集系统指标，仅验证连接可用', nx, y + 96);
    } else {
      const metrics = [['CPU', n.cpu], ['内存', n.mem_pct], ['磁盘', n.disk_pct]];
      const mw = 232, gap = 22, by = y + 84;
      metrics.forEach(([label, val], i) => {
        const mx = nx + i * (mw + gap);
        const p = Math.max(0, Math.min(100, Number(val) || 0));
        ctx.fillStyle = '#64748b'; ctx.font = '400 12px ' + INSPECT_FONT;
        ctx.fillText(label, mx, by);
        ctx.textAlign = 'right'; ctx.fillStyle = '#334155'; ctx.font = '600 12px ' + INSPECT_FONT;
        ctx.fillText(p.toFixed(1) + '%', mx + mw, by);
        ctx.textAlign = 'left';
        roundRectPath(ctx, mx, by + 9, mw, 7, 3.5); ctx.fillStyle = '#e9eef6'; ctx.fill();
        if (p > 0) {
          roundRectPath(ctx, mx, by + 9, Math.max(4, mw * p / 100), 7, 3.5);
          ctx.fillStyle = inspectBarColor(p); ctx.fill();
        }
      });
      ctx.fillStyle = '#94a3b8'; ctx.font = '400 11.5px ' + INSPECT_FONT;
      const meta = `负载 ${(Number(n.load1) || 0).toFixed(2)} · 运行 ${fmtUptime(n.uptime)}` +
        (n.docker_total > 0 ? ` · 容器 ${n.docker_running}/${n.docker_total} 运行` : '') +
        (n.temp > 0 ? ` · 温度 ${n.temp.toFixed(0)}°C` : '');
      ctx.fillText(fitCanvasText(ctx, meta, w - 52), nx, y + 122);
      issueText = n.issues && n.issues.length ? '待关注：' + n.issues.join(' · ') : '未发现明显问题';
      issueColor = n.issues && n.issues.length ? '#b45309' : '#16a34a';
    }
    ctx.fillStyle = issueColor; ctx.font = '500 12px ' + INSPECT_FONT;
    ctx.fillText(fitCanvasText(ctx, issueText, w - 52), nx, y + 148);
    y += nodeH + nodeGap;
  }

  const fy = H - pad - 30;
  ctx.strokeStyle = '#e9edf4';
  ctx.beginPath(); ctx.moveTo(cardX + 44, fy - 22); ctx.lineTo(cardX + cardW - 44, fy - 22); ctx.stroke();
  ctx.fillStyle = '#94a3b8'; ctx.font = '400 12px ' + INSPECT_FONT;
  ctx.fillText('由 KayPanel 自动生成 · 数据为巡检时刻快照', cardX + 44, fy);
  ctx.textAlign = 'right';
  ctx.fillText(`KayPanel ${d.version || ''}`, cardX + cardW - 44, fy);
  ctx.textAlign = 'left';
  return canvas;
}

function inspectStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function saveInspectImage() {
  const d = state.inspect;
  if (!d) return;
  const canvas = buildInspectCanvas(d);
  canvas.toBlob(blob => {
    if (!blob) { toast('生成图片失败', 'error'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `KayPanel-巡检报告-${inspectStamp()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('巡检长图已保存');
  }, 'image/png');
}

async function copyInspectImage() {
  const d = state.inspect;
  if (!d) return;
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('unsupported');
    const canvas = buildInspectCanvas(d);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('已复制到剪贴板，可直接粘贴到聊天窗口');
  } catch (e) {
    toast('复制失败，请使用「保存长图」', 'error');
  }
}

/* ---------- topology ---------- */

function topoWarn(v, limit) {
  return (Number(v) || 0) >= (limit || 90);
}

function topoBarHTML(label, val, color, warn) {
  const v = Math.max(0, Math.min(100, Number(val) || 0));
  return `<div class="topo-bar"><span>${label}</span><span class="topo-track"><i style="width:${v.toFixed(1)}%;background:${warn ? '#dc2626' : color}"></i></span><b>${v.toFixed(0)}%</b></div>`;
}

function topoNodeHTML(n, p) {
  const m = n.latest || {};
  const st = state.settings || {};
  const cpu = n.online ? Number(m.cpu) || 0 : 0;
  const memP = n.online ? pct(m.mem_used, m.mem_total) : 0;
  const diskP = n.online ? pct(m.disk_used, m.disk_total) : 0;
  const run = n.online ? Math.max(0, Number(m.docker_running) || 0) : 0;
  const total = n.online ? Math.max(0, Number(m.docker_total) || 0) : 0;
  let body;
  if (!n.online) {
    body = `<div class="topo-node-off">${esc(n.waking ? 'Instabox 空闲休眠，正在唤醒…' : (n.error || 'SSH 连接中断，等待重连'))}</div>`;
  } else if (n.sftp_only) {
    body = `<div class="topo-node-off soft">仅文件管理节点，不采集系统指标</div>`;
  } else {
    const dots = total
      ? Array.from({ length: Math.min(total, 6) }, (_, i) => `<i class="${i < run ? 'run' : ''}"></i>`).join('') + (total > 6 ? '<em>…</em>' : '')
      : '';
    body = `<div class="topo-bars">
        ${topoBarHTML('CPU', cpu, '#2563eb', topoWarn(cpu, st.cpu_alert))}
        ${topoBarHTML('内存', memP, '#7c3aed', topoWarn(memP, st.mem_alert))}
        ${topoBarHTML('磁盘', diskP, '#d97706', topoWarn(diskP, st.disk_alert))}
      </div>
      <div class="topo-node-foot">
        <span class="topo-ctrs">${dots}</span>
        <span>${total ? `${run} / ${total} 容器` : '未安装 Docker'}</span>
      </div>`;
  }
  return `<button type="button" class="topo-node ${n.online ? 'online' : 'offline'}" style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px" data-topo-node="${esc(n.id)}" title="打开 ${esc(n.name)} 概览">
    <div class="topo-node-head">
      <span class="avatar" style="background:${avatarColor(n.id)}">${esc(initialOf(n.name))}</span>
      <span class="topo-node-name"><b>${esc(n.name)}</b><span>${esc(n.user)}@${esc(n.addr)}</span></span>
      <span class="dot ${nodeDotClass(n)}"></span>
    </div>
    ${body}
  </button>`;
}

function topoStatsOf(nodes) {
  const online = nodes.filter(n => n.online && !n.sftp_only);
  const cpu = online.map(n => Number((n.latest || {}).cpu) || 0);
  const memUsed = online.reduce((a, n) => a + (Number((n.latest || {}).mem_used) || 0), 0);
  const memTotal = online.reduce((a, n) => a + (Number((n.latest || {}).mem_total) || 0), 0);
  const ctr = nodes.reduce((a, n) => a + Math.max(0, Number((n.latest || {}).docker_running) || 0), 0);
  return {
    total: nodes.length,
    online: nodes.filter(n => n.online).length,
    ctr,
    avgCpu: cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : null,
    avgMem: memTotal ? (memUsed / memTotal) * 100 : null,
  };
}

function topoCoreHTML(stats) {
  return `<div class="topo-core">
    <div class="topo-core-halo"><i></i><i></i><i></i></div>
    <img src="/assets/logo.svg" alt="">
    <div class="topo-core-brand">KayPanel</div>
    <div class="topo-core-ver">${esc(state.version || 'dev')} · 中控面板</div>
    <div class="topo-core-stats">
      <span><b>${stats.online}</b><i>/${stats.total}</i> 节点在线</span>
      <span><b>${stats.ctr}</b><i>个</i> 容器运行</span>
    </div>
    <div class="topo-core-live"><i></i>LIVE 实时链路</div>
  </div>`;
}

function drawTopology() {
  const stage = $('#topoStage');
  if (!stage) return;
  const nodes = state.nodes || [];
  const W = Math.max(stage.clientWidth || 0, 720);
  const H = stage.clientHeight || 560;
  const cx = W / 2, cy = H / 2;
  const rx = Math.min(W * 0.33, 400);
  const ry = Math.min(H * 0.34, 196);
  const pos = nodes.map((_, i) => {
    const ang = -Math.PI / 2 + (i * Math.PI * 2) / Math.max(nodes.length, 1);
    return { x: cx + Math.cos(ang) * rx, y: cy + Math.sin(ang) * ry };
  });
  const stats = topoStatsOf(nodes);
  const links = nodes.map((n, i) => {
    const p = pos[i];
    return `<line class="topo-link ${n.online ? 'on' : 'off'}" x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}"/>`;
  }).join('');
  const pulses = nodes.map((n, i) => {
    if (!n.online) return '';
    const p = pos[i];
    return `<circle class="topo-pulse" r="2.8"><animateMotion dur="${(2.4 + i * 0.35).toFixed(2)}s" repeatCount="indefinite" path="M${cx} ${cy} L${p.x.toFixed(1)} ${p.y.toFixed(1)}"/></circle>`;
  }).join('');
  stage.innerHTML = `
    <svg class="topo-links" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      ${links}${pulses}
    </svg>
    ${topoCoreHTML(stats)}
    ${nodes.map((n, i) => topoNodeHTML(n, pos[i])).join('')}
    ${nodes.length ? '' : '<div class="topo-empty">还没有服务器节点<br><span>先在概览页添加节点，拓扑会自动生成</span></div>'}`;
  const sub = $('#topoSub');
  if (sub) {
    sub.textContent = nodes.length
      ? `${nodes.length} 台节点 · ${stats.online} 台在线 · ${stats.ctr} 个容器运行 · 每 15 秒自动刷新`
      : '还没有节点 · 添加服务器后自动绘制拓扑';
  }
  const st = $('#topoStats');
  if (st) {
    st.innerHTML = `<div class="topo-stat"><span>平均 CPU</span><b>${stats.avgCpu == null ? '—' : stats.avgCpu.toFixed(1) + '%'}</b></div>
      <div class="topo-stat"><span>平均内存</span><b>${stats.avgMem == null ? '—' : stats.avgMem.toFixed(1) + '%'}</b></div>
      <div class="topo-stat"><span>运行容器</span><b>${stats.ctr}</b></div>
      <div class="topo-stat"><span>链路状态</span><b class="${stats.online === nodes.length && nodes.length ? 'ok' : 'warn'}">${nodes.length ? (stats.online === nodes.length ? '全部连通' : `${nodes.length - stats.online} 条链路中断`) : '等待节点'}</b></div>`;
  }
}

async function loadTopology(render) {
  try {
    const d = await api('/api/nodes?light=1');
    const list = d.nodes || [];
    for (const item of list) {
      const old = state.nodes.find(x => x.id === item.id);
      if (old && old.history) item.history = old.history;
    }
    state.nodes = list;
    state.topologyError = '';
    const errEl = $('#topoError');
    if (errEl) errEl.classList.add('hidden');
    ensureSelected();
    updateNodePills();
    if (render && state.page === 'topology' && !state.subview) drawTopology();
  } catch (e) {
    state.topologyError = e.message;
    const el = $('#topoError');
    if (el && state.page === 'topology') { el.textContent = e.message; el.classList.remove('hidden'); }
  }
}

function renderTopology() {
  const page = $('#page');
  if (!page) return;
  page.innerHTML = `
    <section class="page-head">
      <div><h1>机房拓扑</h1><p class="page-sub" id="topoSub">正在读取节点…</p></div>
      <div class="head-actions">
        <button class="btn sm" id="topoRefreshBtn">${ico('refresh', 'ico')}刷新</button>
        <button class="btn sm primary" id="topoSaveBtn">${ico('expand', 'ico')}导出拓扑图</button>
      </div>
    </section>
    <div class="banner error hidden" id="topoError"></div>
    <div class="card topo-card">
      <div class="topo-scroll"><div class="topo-stage" id="topoStage"></div></div>
      <div class="topo-legend">
        <span><i class="lg online"></i>在线</span>
        <span><i class="lg off"></i>离线</span>
        <span><i class="lg ctr"></i>运行中的容器</span>
        <span class="spacer"></span>
        <span>点击节点进入概览 · 流动光点表示实时链路</span>
      </div>
    </div>
    <div class="topo-stat-grid" id="topoStats"></div>`;
  drawTopology();
  loadTopology(true);
  $('#topoRefreshBtn').addEventListener('click', () => { loadTopology(true); toast('正在刷新拓扑…', '', 1200); });
  $('#topoSaveBtn').addEventListener('click', saveTopologyImage);
  $('#topoStage').addEventListener('click', e => {
    const btn = e.target.closest('[data-topo-node]');
    if (!btn) return;
    selectNode(btn.dataset.topoNode);
    navigate('overview');
  });
  if (state.topoPoll) clearInterval(state.topoPoll);
  state.topoPoll = setInterval(() => {
    if (state.page === 'topology' && !state.subview) loadTopology(true);
  }, 15000);
  state.topoResize = () => {
    if (state.page === 'topology' && !state.subview) drawTopology();
  };
  window.addEventListener('resize', state.topoResize);
}

function saveTopologyImage() {
  downloadCanvas(buildTopologyCanvas(), `KayPanel-机房拓扑-${inspectStamp()}.png`, '机房拓扑长图已保存');
}

function topoCanvasBars(ctx, x, y, w, label, val, color) {
  const v = Math.max(0, Math.min(100, Number(val) || 0));
  ctx.fillStyle = '#7c8798';
  ctx.font = '400 11px ' + INSPECT_FONT;
  ctx.fillText(label, x, y);
  const tx = x + 34, tw = w - 78;
  roundRectPath(ctx, tx, y - 9, tw, 6, 3);
  ctx.fillStyle = '#eef1f6'; ctx.fill();
  roundRectPath(ctx, tx, y - 9, Math.max(2, tw * v / 100), 6, 3);
  ctx.fillStyle = color; ctx.fill();
  ctx.fillStyle = '#475569';
  ctx.font = '600 11px ' + INSPECT_FONT;
  ctx.textAlign = 'right';
  ctx.fillText(`${v.toFixed(0)}%`, x + w, y);
  ctx.textAlign = 'left';
}

function buildTopologyCanvas() {
  const dpr = 2;
  const W = 1240, pad = 40;
  const headerH = 170, stageH = 700, footerH = 84;
  const H = pad + headerH + stageH + footerH;
  const canvas = document.createElement('canvas');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const nodes = state.nodes || [];
  const stats = topoStatsOf(nodes);

  ctx.fillStyle = '#eef2f8';
  ctx.fillRect(0, 0, W, H);
  roundRectPath(ctx, pad, pad, W - pad * 2, H - pad * 2, 28);
  ctx.fillStyle = '#ffffff'; ctx.fill();

  ctx.save();
  roundRectPath(ctx, pad, pad, W - pad * 2, headerH, 28);
  ctx.clip();
  const g = ctx.createLinearGradient(pad, pad, W - pad, pad + headerH);
  g.addColorStop(0, '#0f2c5c');
  g.addColorStop(0.55, '#1d4ed8');
  g.addColorStop(1, '#2563eb');
  ctx.fillStyle = g;
  ctx.fillRect(pad, pad, W - pad * 2, headerH);
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(W - 190, pad + 10, 170, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(W - 470, pad + headerH + 40, 110, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(191, 219, 254, 0.95)';
  ctx.font = '600 13px ' + INSPECT_FONT;
  ctx.fillText('KAYPANEL · 机房拓扑', pad + 44, pad + 46);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 34px ' + INSPECT_FONT;
  ctx.fillText('机房拓扑图', pad + 44, pad + 100);
  ctx.fillStyle = 'rgba(219, 234, 254, 0.92)';
  ctx.font = '400 14px ' + INSPECT_FONT;
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  ctx.fillText(`${now} · ${nodes.length} 台节点 · ${stats.online} 台在线 · ${stats.ctr} 个容器运行`, pad + 44, pad + 134);
  ctx.fillStyle = 'rgba(219, 234, 254, 0.72)';
  ctx.font = '400 12px ' + INSPECT_FONT;
  ctx.fillText(`平均 CPU ${stats.avgCpu == null ? '—' : stats.avgCpu.toFixed(1) + '%'} · 平均内存 ${stats.avgMem == null ? '—' : stats.avgMem.toFixed(1) + '%'}`, pad + 44, pad + 156);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(219, 234, 254, 0.8)';
  ctx.font = '600 13px ' + INSPECT_FONT;
  ctx.fillText(`KayPanel ${state.version || ''}`, W - pad - 44, pad + 46);
  ctx.textAlign = 'left';
  ctx.restore();

  const stageTop = pad + headerH + 20;
  const cx = W / 2, cy = stageTop + stageH / 2 - 10;
  const rx = 400, ry = 232;
  const pos = nodes.map((_, i) => {
    const ang = -Math.PI / 2 + (i * Math.PI * 2) / Math.max(nodes.length, 1);
    return { x: cx + Math.cos(ang) * rx, y: cy + Math.sin(ang) * ry };
  });

  nodes.forEach((n, i) => {
    const p = pos[i];
    ctx.strokeStyle = n.online ? 'rgba(37, 99, 235, 0.38)' : 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = n.online ? 1.6 : 1.2;
    ctx.setLineDash(n.online ? [7, 7] : [4, 8]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.quadraticCurveTo((cx + p.x) / 2, (cy + p.y) / 2 - 22, p.x, p.y); ctx.stroke();
  });
  ctx.setLineDash([]);

  const coreW = 300, coreH = 198;
  roundRectPath(ctx, cx - coreW / 2, cy - coreH / 2, coreW, coreH, 22);
  const cg = ctx.createLinearGradient(cx - coreW / 2, cy - coreH / 2, cx + coreW / 2, cy + coreH / 2);
  cg.addColorStop(0, '#0f172a');
  cg.addColorStop(1, '#1e3a8a');
  ctx.fillStyle = cg; ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff'; ctx.font = '700 24px ' + INSPECT_FONT;
  ctx.fillText('KayPanel', cx, cy - 38);
  ctx.fillStyle = 'rgba(191, 219, 254, 0.9)'; ctx.font = '400 12px ' + INSPECT_FONT;
  ctx.fillText(`中控面板 · ${state.version || ''}`, cx, cy - 16);
  ctx.fillStyle = '#93c5fd'; ctx.font = '600 12px ' + INSPECT_FONT;
  ctx.fillText(`${stats.online} / ${stats.total} 节点在线   ·   ${stats.ctr} 个容器运行`, cx, cy + 20);
  ctx.fillStyle = 'rgba(226, 232, 240, 0.7)'; ctx.font = '400 11px ' + INSPECT_FONT;
  ctx.fillText('LIVE · 实时监控拓扑', cx, cy + 48);
  ctx.textAlign = 'left';

  const cw = 252, ch = 136;
  nodes.forEach((n, i) => {
    const p = pos[i];
    const x = p.x - cw / 2, y = p.y - ch / 2;
    roundRectPath(ctx, x, y, cw, ch, 16);
    ctx.fillStyle = n.online ? '#fbfcfe' : '#f8fafc';
    ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = '#e2e8f2'; ctx.stroke();
    const m = n.latest || {};
    const color = avatarColor(n.id);
    ctx.beginPath(); ctx.arc(x + 26, y + 27, 14, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = '600 13px ' + INSPECT_FONT; ctx.textAlign = 'center';
    ctx.fillText(initialOf(n.name), x + 26, y + 32);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0f172a'; ctx.font = '600 15px ' + INSPECT_FONT;
    ctx.fillText(fitCanvasText(ctx, n.name, cw - 96), x + 48, y + 26);
    ctx.fillStyle = n.online ? '#16a34a' : '#94a3b8'; ctx.font = '400 10.5px ' + INSPECT_FONT;
    ctx.fillText(n.online ? '在线' : (n.waking ? '唤醒中' : '离线'), x + 48, y + 42);
    ctx.fillStyle = '#94a3b8'; ctx.font = '400 10.5px ' + INSPECT_FONT;
    ctx.textAlign = 'right';
    ctx.fillText(fitCanvasText(ctx, `${n.user}@${n.addr}`, 120), x + cw - 14, y + 42);
    ctx.textAlign = 'left';
    if (n.online && !n.sftp_only) {
      const cpu = Number(m.cpu) || 0;
      const memP = pct(m.mem_used, m.mem_total);
      const diskP = pct(m.disk_used, m.disk_total);
      topoCanvasBars(ctx, x + 16, y + 68, cw - 32, 'CPU', cpu, '#2563eb');
      topoCanvasBars(ctx, x + 16, y + 90, cw - 32, '内存', memP, '#7c3aed');
      topoCanvasBars(ctx, x + 16, y + 112, cw - 32, '磁盘', diskP, '#d97706');
      const run = Number(m.docker_running) || 0, total = Number(m.docker_total) || 0;
      ctx.fillStyle = '#64748b'; ctx.font = '400 10.5px ' + INSPECT_FONT;
      ctx.textAlign = 'right';
      ctx.fillText(total ? `${run}/${total} 容器运行` : '无 Docker', x + cw - 16, y + 130);
      ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = '#94a3b8'; ctx.font = '400 12px ' + INSPECT_FONT;
      ctx.fillText(n.sftp_only ? '仅文件管理节点' : '连接中断，等待重连', x + 16, y + 84);
    }
  });

  const fy = H - pad - 30;
  ctx.strokeStyle = '#e9edf4';
  ctx.beginPath(); ctx.moveTo(pad + 44, fy - 24); ctx.lineTo(W - pad - 44, fy - 24); ctx.stroke();
  ctx.fillStyle = '#94a3b8'; ctx.font = '400 12px ' + INSPECT_FONT;
  ctx.fillText('由 KayPanel 自动生成 · 基于节点实时监控数据', pad + 44, fy);
  ctx.textAlign = 'right';
  ctx.fillText(`KayPanel ${state.version || ''}`, W - pad - 44, fy);
  ctx.textAlign = 'left';
  return canvas;
}

/* ---------- desktop widget ---------- */

function enterWidgetMode() {
  if (!hasWindowHost()) { toast('悬浮挂件仅在桌面版可用'); return; }
  window.kaypanelWidget('enter');
  navigate('widget');
}

function wgRing(p, label, color, warn, sub) {
  const v = Math.max(0, Math.min(100, Number(p) || 0));
  const r = 21, c = 2 * Math.PI * r;
  const text = sub != null ? esc(sub) : `${Math.round(v)}<em>%</em>`;
  return `<span class="wg-ring">
    <span class="wg-ring-svg"><svg viewBox="0 0 54 54">
      <circle class="wg-track" cx="27" cy="27" r="${r}"/>
      <circle class="wg-bar" cx="27" cy="27" r="${r}" stroke="${warn ? '#f87171' : color}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - v / 100)).toFixed(1)}"/>
    </svg><span class="wg-ring-val">${text}</span></span>
    <span class="wg-ring-label">${label}</span>
  </span>`;
}

function widgetNodeHTML(n) {
  const m = n.latest || {};
  const st = state.settings || {};
  const online = !!n.online;
  const cpu = online ? Number(m.cpu) || 0 : 0;
  const memP = online ? pct(m.mem_used, m.mem_total) : 0;
  const run = online ? Math.max(0, Number(m.docker_running) || 0) : 0;
  const total = online ? Math.max(0, Number(m.docker_total) || 0) : 0;
  const cpuWarn = online && cpu >= (st.cpu_alert || 90);
  const memWarn = online && memP >= (st.mem_alert || 90);
  const ctrPct = total ? (run / total) * 100 : 0;
  return `<button type="button" class="wg-node ${online ? '' : 'off'}" data-wg-node="${esc(n.id)}">
    <div class="wg-node-head">
      <span class="dot ${nodeDotClass(n)}"></span>
      <b>${esc(n.name)}</b>
      <span class="wg-node-state">${online ? (n.sftp_only ? '仅文件' : '在线') : nodeStateText(n)}</span>
    </div>
    <div class="wg-rings">
      ${wgRing(cpu, 'CPU', '#3b82f6', cpuWarn)}
      ${wgRing(memP, '内存', '#8b5cf6', memWarn)}
      ${wgRing(ctrPct, '容器', '#10b981', false, total ? `${run}/${total}` : '—')}
    </div>
    ${online ? '' : `<div class="wg-off">${esc(n.waking ? '正在唤醒…' : (n.error || '连接中断'))}</div>`}
  </button>`;
}

function drawWidget() {
  const root = $('#widgetRoot');
  if (!root) return;
  const list = state.nodes || [];
  const online = list.filter(n => n.online).length;
  const wrap = $('#widgetList', root);
  if (wrap) wrap.innerHTML = list.length ? list.map(widgetNodeHTML).join('') : `<div class="wg-empty">还没有节点<span>在面板里添加服务器后，这里会显示实时指标</span></div>`;
  const meta = $('#widgetMeta', root);
  if (meta) meta.textContent = `${online}/${list.length} 在线 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
}

async function refreshWidget() {
  try {
    const d = await api('/api/nodes?light=1');
    state.nodes = d.nodes || [];
    ensureSelected();
    drawWidget();
  } catch (e) { /* keep last frame */ }
}

function openWidgetMain(nodeId) {
  if (hasWindowHost()) window.kaypanelWidget('open');
  navigate('overview');
  if (nodeId) selectNode(nodeId);
}

function renderWidget() {
  document.body.classList.add('widget-mode');
  const root = document.createElement('div');
  root.id = 'widgetRoot';
  root.className = 'widget';
  root.innerHTML = `
    <header class="wg-head" id="wgDrag">
      <span class="wg-logo">K</span>
      <div class="wg-brand"><b>KayPanel</b><span>悬浮监控</span></div>
      <div class="wg-meta"><i></i><span id="widgetMeta">读取中…</span></div>
      <button type="button" class="wg-btn" id="wgOpen" title="打开主面板" aria-label="打开主面板">${ico('expand')}</button>
      <button type="button" class="wg-btn wg-hide" id="wgHide" title="隐藏到托盘" aria-label="隐藏到托盘">${ico('winClose')}</button>
    </header>
    <div class="wg-list" id="widgetList"></div>
    <footer class="wg-foot"><span>每 3 秒自动刷新</span><span>拖动顶部移动 · 点节点打开面板</span></footer>`;
  document.body.appendChild(root);
  drawWidget();
  refreshWidget();
  $('#wgOpen', root).addEventListener('click', () => openWidgetMain(''));
  $('#wgHide', root).addEventListener('click', () => {
    if (hasWindowHost()) window.kaypanelWindow('close');
  });
  const head = $('#wgDrag', root);
  head.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    if (typeof window.kaypanelDrag === 'function') window.kaypanelDrag();
  });
  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-wg-node]');
    if (btn) openWidgetMain(btn.dataset.wgNode);
  });
  if (state.widgetTimer) clearInterval(state.widgetTimer);
  state.widgetTimer = setInterval(() => {
    if (state.page === 'widget') refreshWidget();
  }, 3000);
}

/* ---------- fun: shared stats ---------- */

function lsJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v == null ? fallback : v;
  } catch (e) { return fallback; }
}

function lsSave(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full */ }
}

function bumpStat(key, n = 1) {
  const s = lsJSON('kp_stats', {});
  s[key] = (Number(s[key]) || 0) + n;
  lsSave('kp_stats', s);
}

function statCount(key) {
  return Number((lsJSON('kp_stats', {})[key]) || 0);
}

function recordVisit(page) {
  if (!TOP_PAGES.includes(page)) return;
  const v = lsJSON('kp_visits', {});
  v[page] = (Number(v[page]) || 0) + 1;
  lsSave('kp_visits', v);
}

function visitCount() {
  return Object.keys(lsJSON('kp_visits', {})).length;
}

function realNodes() {
  return state.nodes.filter(n => !n.sftp_only);
}

function maxUptime() {
  return realNodes().reduce((a, n) => Math.max(a, Number((n.latest || {}).uptime) || 0), 0);
}

const ACHIEVEMENTS = [
  { id: 'first_node', title: '初来乍到', desc: '纳管第一台服务器', icon: 'server', test: () => realNodes().length >= 1 },
  { id: 'two_nodes', title: '双机互联', desc: '同时纳管 2 台服务器', icon: 'topology', test: () => realNodes().length >= 2 },
  { id: 'four_nodes', title: '机房管理员', desc: '同时纳管 4 台服务器', icon: 'overview', test: () => realNodes().length >= 4 },
  { id: 'all_online', title: '全员到齐', desc: '所有节点同时在线（至少 2 台）', icon: 'activity', test: () => { const r = realNodes(); return r.length >= 2 && r.every(n => n.online); } },
  { id: 'ironman', title: '铁人三项', desc: '任一节点连续运行满 30 天', icon: 'heart', test: () => maxUptime() >= 30 * 86400 },
  { id: 'hundred_days', title: '百天老店', desc: '任一节点连续运行满 100 天', icon: 'trophy', test: () => maxUptime() >= 100 * 86400 },
  { id: 'container_king', title: '容器大户', desc: '所有节点合计运行 20 个容器', icon: 'container', test: () => realNodes().reduce((a, n) => a + Math.max(0, Number((n.latest || {}).docker_running) || 0), 0) >= 20 },
  { id: 'cool_head', title: '冷静如水', desc: '所有在线节点 CPU 低于 30%', icon: 'clock', test: () => { const r = realNodes().filter(n => n.online); return r.length >= 1 && r.every(n => (Number((n.latest || {}).cpu) || 0) < 30); } },
  { id: 'night_owl', title: '夜猫子', desc: '凌晨 0-5 点打开面板', icon: 'moon', test: () => new Date().getHours() < 5 },
  { id: 'early_bird', title: '早起鸟', desc: '早上 5-7 点打开面板', icon: 'sun', test: () => { const h = new Date().getHours(); return h >= 5 && h < 7; } },
  { id: 'theme_knight', title: '深色骑士', desc: '切换到深色主题', icon: 'moon', test: () => state.theme === 'dark' },
  { id: 'inspect_master', title: '体检达人', desc: '累计完成 3 次一键巡检', icon: 'activity', progress: () => [Math.min(3, statCount('kp_inspected')), 3], test: () => statCount('kp_inspected') >= 3 },
  { id: 'pet_parent', title: '铲屎官', desc: '投喂服务器宠物 1 次', icon: 'park', test: () => statCount('kp_feeds') >= 1 },
  { id: 'ai_rookie', title: 'AI 初体验', desc: '向 AI 助手提问一次', icon: 'spark', test: () => statCount('kp_ai_msgs') >= 1 },
  { id: 'explorer', title: '环游面板', desc: '访问 8 个不同的页面', icon: 'command', progress: () => [Math.min(8, visitCount()), 8], test: () => visitCount() >= 8 },
  { id: 'screen_lover', title: '大屏爱好者', desc: '打开监控大屏或氛围屏', icon: 'wall', test: () => statCount('kp_screens') >= 1 },
];

function checkAchievements(quiet) {
  const got = lsJSON('kp_ach', {});
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (!got[a.id]) {
      let ok = false;
      try { ok = !!a.test(); } catch (e) { ok = false; }
      if (ok) { got[a.id] = Date.now(); fresh.push(a); }
    }
  }
  if (fresh.length) {
    lsSave('kp_ach', got);
    if (!quiet) fresh.slice(0, 2).forEach((a, i) => setTimeout(() => toast(`成就解锁 · ${a.title}`, 'success', 3000), i * 420));
  }
  return fresh;
}

function achUnlocked() {
  return lsJSON('kp_ach', {});
}

/* ---------- stocks ---------- */

function stockCode(n, i) {
  const clean = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const name = clean(n.name);
  const id = clean(n.id);
  const base = name.length >= 2 ? name : id;
  return base.length >= 2 ? base.slice(0, 6) : 'KP' + String(i + 1).padStart(2, '0');
}

function stockPriceOf(s) {
  const cpu = Math.max(0, Math.min(100, Number(s.cpu) || 0));
  const mem = pct(s.mem_used, s.mem_total);
  const disk = pct(s.disk_used, s.disk_total);
  const temp = Math.max(0, Number(s.temp) || 0);
  let health = 100 - (cpu * 0.5 + mem * 0.3 + disk * 0.2);
  if (temp > 70) health -= (temp - 70) * 0.3;
  return 24 + Math.max(0, health) * 1.08;
}

function stockOHLC(prices, buckets) {
  if (prices.length < 2) return [];
  const n = Math.min(buckets, prices.length);
  const size = prices.length / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const chunk = prices.slice(Math.floor(i * size), Math.max(Math.floor(i * size) + 1, Math.floor((i + 1) * size)));
    if (!chunk.length) continue;
    out.push({
      o: chunk[0], c: chunk[chunk.length - 1],
      h: Math.max(...chunk), l: Math.min(...chunk),
    });
  }
  return out;
}

function stockQuote(n, i) {
  const hist = (n.history || []).filter(s => s && typeof s.cpu === 'number');
  const prices = hist.map(stockPriceOf);
  const last = prices.length ? prices[prices.length - 1] : stockPriceOf(n.latest || {});
  const first = prices.length ? prices[0] : last;
  const change = first ? ((last - first) / first) * 100 : 0;
  const high = prices.length ? Math.max(...prices) : last;
  const low = prices.length ? Math.min(...prices) : last;
  const volume = hist.reduce((a, s) => a + (Number(s.net_rx) || 0) + (Number(s.net_tx) || 0), 0) * 3;
  const m = n.latest || {};
  return {
    node: n, code: stockCode(n, i), price: last, change, high, low, volume,
    series: prices, candles: stockOHLC(prices, 16),
    suspended: !n.online, memTotal: Number(m.mem_total) || 0,
  };
}

function stockAreaSVG(values, color, height = 84) {
  if (!values.length) return `<div class="chart-empty">等待采样数据…</div>`;
  const w = 600, h = height, pad = 3;
  const hi = Math.max(...values), lo = Math.min(...values);
  const range = hi - lo || 1;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [pad + i * step, h - pad - ((v - lo) / range) * (h - pad * 2)]);
  const line = smoothPath(pts);
  const gid = 'kp-stock-' + (++chartSeq);
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${line} L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z" fill="url(#${gid})"/>
    <path class="chart-line" d="${line}" stroke="${color}"/>
  </svg>`;
}

function stockCandlesSVG(candles) {
  if (candles.length < 2) return `<div class="chart-empty">数据积累中…</div>`;
  const w = 400, h = 96, pad = 6, gap = 3;
  const hi = Math.max(...candles.map(c => c.h)), lo = Math.min(...candles.map(c => c.l));
  const range = hi - lo || 1;
  const cw = (w - pad * 2 - gap * (candles.length - 1)) / candles.length;
  const y = v => pad + (1 - (v - lo) / range) * (h - pad * 2);
  const bars = candles.map((c, i) => {
    const x = pad + i * (cw + gap);
    const up = c.c >= c.o;
    const color = up ? '#ef4444' : '#16a34a';
    const top = y(Math.max(c.o, c.c)), bottom = y(Math.min(c.o, c.c));
    const bh = Math.max(1.6, bottom - top);
    return `<line x1="${(x + cw / 2).toFixed(1)}" y1="${y(c.h).toFixed(1)}" x2="${(x + cw / 2).toFixed(1)}" y2="${y(c.l).toFixed(1)}" stroke="${color}" stroke-width="1.2"/>
      <rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${cw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1" fill="${color}"/>`;
  }).join('');
  const grids = [0.25, 0.5, 0.75].map(f => `<line class="grid-line" x1="0" y1="${(h * f).toFixed(1)}" x2="${w}" y2="${(h * f).toFixed(1)}"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${grids}${bars}</svg>`;
}

function stockIndex(quotes) {
  const len = Math.max(0, ...quotes.map(q => q.series.length));
  const series = [];
  for (let off = 0; off < len; off++) {
    const vals = quotes.map(q => q.series[q.series.length - 1 - off]).filter(v => typeof v === 'number');
    if (vals.length) series.unshift(vals.reduce((a, b) => a + b, 0) / vals.length * 10);
  }
  const last = series.length ? series[series.length - 1] : 1000;
  const first = series.length ? series[0] : last;
  return {
    value: last,
    change: first ? ((last - first) / first) * 100 : 0,
    series,
    up: quotes.filter(q => q.change > 0.15).length,
    down: quotes.filter(q => q.change < -0.15).length,
    flat: quotes.filter(q => Math.abs(q.change) <= 0.15).length,
    cap: quotes.reduce((a, q) => a + q.memTotal, 0),
  };
}

function stockQuoteCard(q) {
  const n = q.node;
  const up = q.change >= 0;
  const cls = up ? 'up' : 'down';
  return `<article class="stock-card ${q.suspended ? 'suspended' : ''}" data-stocknode="${esc(n.id)}" title="点击切换到该节点">
    <div class="stock-head">
      <div class="stock-ident">
        <span class="stock-avatar" style="background:${avatarColor(n.id)}">${esc(initialOf(n.name))}</span>
        <div><b>${esc(n.name)}</b><span>${esc(q.code)} · ${esc((n.latest || {}).os || (n.online ? '采集中' : '已离线'))}</span></div>
      </div>
      ${q.suspended ? '<span class="stock-tag suspended">停牌</span>' : up ? '<span class="stock-tag up">上涨</span>' : '<span class="stock-tag down">下跌</span>'}
    </div>
    <div class="stock-quote">
      <b class="${cls}">${q.price.toFixed(2)}</b>
      <span class="stock-change ${cls}">${up ? '+' : ''}${q.change.toFixed(2)}%</span>
    </div>
    <div class="stock-candles">${stockCandlesSVG(q.candles)}</div>
    <div class="stock-stats">
      <div><span>最高</span><b>${q.high.toFixed(2)}</b></div>
      <div><span>最低</span><b>${q.low.toFixed(2)}</b></div>
      <div><span>成交额</span><b>${q.volume ? fmtBytes(q.volume) : '—'}</b></div>
      <div><span>市值</span><b>${q.memTotal ? fmtBytes(q.memTotal) : '—'}</b></div>
    </div>
  </article>`;
}

function drawStocks() {
  const page = $('#page');
  if (!page) return;
  const nodes = realNodes();
  const quotes = nodes.map(stockQuote);
  const idx = stockIndex(quotes);
  const idxUp = idx.change >= 0;
  if (!nodes.length) {
    page.innerHTML = `
      <section class="page-head">
        <div><h1>服务器行情</h1><p class="page-sub">把每台服务器的健康度当成一支股票 · 红涨绿跌</p></div>
      </section>
      ${noNodeHTML('还没有可以上市的服务器')}`;
    bindNoNode();
    return;
  }
  page.innerHTML = `
    <section class="page-head">
      <div><h1>服务器行情</h1><p class="page-sub">健康度指数 · 红涨绿跌 · 每 5 秒刷新</p></div>
      <div class="head-actions">
        <button class="btn sm" id="stkAmbient">${ico('ambient', 'ico')}氛围屏</button>
        <button class="btn sm ghost" id="stkRefresh">刷新行情</button>
      </div>
    </section>
    <div class="stock-board">
      <div class="stock-index-card">
        <div class="stock-index-main">
          <div class="stock-index-label">KP 算力指数 <span class="live-pill sm"><span class="live-dot"></span>交易中</span></div>
          <div class="stock-index-value ${idxUp ? 'up' : 'down'}">${idx.value.toFixed(1)}</div>
          <div class="stock-index-change ${idxUp ? 'up' : 'down'}">${idxUp ? '+' : ''}${idx.change.toFixed(2)}% <span>对比本轮 ${idx.series.length} 个采样</span></div>
        </div>
        <div class="stock-index-chart">${stockAreaSVG(idx.series, idxUp ? '#ef4444' : '#16a34a', 96)}</div>
        <div class="stock-index-foot">
          <div><span>上涨</span><b class="up">${idx.up}</b></div>
          <div><span>下跌</span><b class="down">${idx.down}</b></div>
          <div><span>平盘</span><b>${idx.flat}</b></div>
          <div><span>总市值</span><b>${fmtBytes(idx.cap)}</b></div>
        </div>
      </div>
      <div class="stock-grid">${quotes.map(stockQuoteCard).join('')}</div>
      <p class="stock-note">指数 = 各节点「健康度」均价：CPU 50% + 内存 30% + 磁盘 20%，温度超过 70°C 额外扣分；仅统计物理机与云主机节点。</p>
    </div>`;
  $('#stkRefresh').addEventListener('click', loadStocks);
  $('#stkAmbient').addEventListener('click', () => navigate('ambient'));
  $$('.stock-card[data-stocknode]', page).forEach(card => card.addEventListener('click', () => {
    selectNode(card.dataset.stocknode);
    navigate('overview');
  }));
}

async function loadStocks() {
  try {
    const data = await api('/api/overview');
    state.nodes = data.nodes || [];
    state.settings = data.settings || state.settings;
    if (data.version) state.version = data.version;
    ensureSelected();
    updateNodePills();
    syncTray();
    drawStocks();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderStocks() {
  drawStocks();
  loadStocks();
  if (state.pageTimer) clearInterval(state.pageTimer);
  state.pageTimer = setInterval(() => {
    if (state.page === 'stocks' && !state.subview) loadStocks();
  }, 5000);
}

/* ---------- server park: pets, weather, achievements ---------- */

const PET_SPECIES = [
  { id: 'slime', label: '史莱姆', pet: '布丁' },
  { id: 'cat', label: '猫猫', pet: '喵喵' },
  { id: 'robot', label: '机娘', pet: '小铁' },
  { id: 'ghost', label: '小幽灵', pet: '小幽' },
  { id: 'duck', label: '鸭鸭', pet: '鸭鸭' },
];

function hashSeed(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function petStore() {
  return lsJSON('kp_pets', {});
}

function petState(n) {
  const all = petStore();
  if (!all[n.id]) {
    all[n.id] = { xp: 0, feeds: 0, lastFeed: 0, name: '' };
    lsSave('kp_pets', all);
  }
  return all[n.id];
}

function petMoodInfo(n) {
  const m = n.latest || {};
  const cpu = Number(m.cpu) || 0;
  const mem = pct(m.mem_used, m.mem_total);
  const temp = Number(m.temp) || 0;
  if (!n.online) return { mood: 'sleep', label: '熟睡', word: '服务器离线，宠物钻进被窝了。' };
  if (cpu >= 85 || mem >= 92 || temp >= 78) return { mood: 'panic', label: '紧张', word: '有点喘不过气，快看看进程吧。' };
  if (cpu >= 55 || mem >= 75) return { mood: 'busy', label: '忙碌', word: '正在努力干活，别打扰它。' };
  return { mood: 'happy', label: '开心', word: '状态很好，想和你贴贴。' };
}

function petSVG(kind, mood, color) {
  const dark = 'rgba(15,23,42,.82)';
  const eyeY = kind === 'duck' ? 50 : 56;
  let body;
  if (kind === 'cat') {
    body = `<path d="M31 53c0-16 13-27 29-27s29 11 29 27c0 17-13 30-29 30S31 70 31 53Z" fill="${color}"/>
      <path d="M35 42 29 19l21 12Z" fill="${color}"/><path d="M85 42 91 19 70 31Z" fill="${color}"/>
      <path d="M38 35l-3-7 7 3Z" fill="rgba(255,255,255,.3)"/><path d="M82 35l3-7-7 3Z" fill="rgba(255,255,255,.3)"/>
      <ellipse cx="60" cy="71" rx="17" ry="12" fill="rgba(255,255,255,.22)"/>
      <g stroke="rgba(255,255,255,.55)" stroke-width="1.4" stroke-linecap="round"><path d="M25 60h8M25 66h7M95 60h-8M95 66h-7"/></g>`;
  } else if (kind === 'robot') {
    body = `<rect x="30" y="34" width="60" height="58" rx="18" fill="${color}"/>
      <rect x="36" y="41" width="48" height="45" rx="13" fill="rgba(255,255,255,.1)"/>
      <rect x="56" y="16" width="8" height="16" rx="3" fill="${color}"/><circle cx="60" cy="13" r="5" fill="${color}"/>
      <circle cx="33" cy="62" r="3.5" fill="rgba(255,255,255,.35)"/><circle cx="87" cy="62" r="3.5" fill="rgba(255,255,255,.35)"/>`;
  } else if (kind === 'ghost') {
    body = `<path d="M27 62c0-18 15-31 33-31s33 13 33 31v28c-5 5-10 5-15 0-5 5-10 5-15 0-5 5-10 5-15 0-5 5-10 5-15 0V62Z" fill="${color}" opacity=".94"/>
      <ellipse cx="60" cy="44" rx="18" ry="10" fill="rgba(255,255,255,.16)"/>`;
  } else if (kind === 'duck') {
    body = `<ellipse cx="60" cy="66" rx="32" ry="27" fill="${color}"/>
      <ellipse cx="60" cy="76" rx="18" ry="12" fill="rgba(255,255,255,.2)"/>
      <path d="M55 35c0-7 4-9 5-14 2 6 6 7 5 14Z" fill="${color}"/>
      <ellipse cx="60" cy="${eyeY + 13}" rx="7.5" ry="5" fill="#f59e0b"/>`;
  } else {
    body = `<ellipse cx="60" cy="64" rx="33" ry="29" fill="${color}"/>
      <ellipse cx="60" cy="74" rx="19" ry="13" fill="rgba(255,255,255,.22)"/>
      <ellipse cx="40" cy="44" rx="7" ry="4" fill="rgba(255,255,255,.25)" transform="rotate(-24 40 44)"/>`;
  }
  let face = '';
  if (mood === 'happy') {
    face = `<path d="M${47} ${eyeY}q4-5 8 0" stroke="${dark}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <path d="M${65} ${eyeY}q4-5 8 0" stroke="${dark}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <path d="M53 ${eyeY + 12}q7 6 14 0" stroke="${dark}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  } else if (mood === 'busy') {
    face = `<circle cx="51" cy="${eyeY}" r="3.6" fill="${dark}"/><circle cx="69" cy="${eyeY}" r="3.6" fill="${dark}"/>
      <path d="M54 ${eyeY + 13}h12" stroke="${dark}" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M88 40c3 5 3 9 0 12-3-3-3-7 0-12Z" fill="#38bdf8"/>`;
  } else if (mood === 'panic') {
    face = `<path d="m47 ${eyeY - 3} 7 7M54 ${eyeY - 3}l-7 7M66 ${eyeY - 3}l7 7M73 ${eyeY - 3}l-7 7" stroke="${dark}" stroke-width="2.2" stroke-linecap="round"/>
      <ellipse cx="60" cy="${eyeY + 14}" rx="5" ry="4" fill="${dark}"/>
      <path d="M46 ${eyeY - 10}l7 3M74 ${eyeY - 10}l-7 3" stroke="${dark}" stroke-width="2" stroke-linecap="round"/>`;
  } else {
    face = `<path d="M47 ${eyeY}q4 4 8 0" stroke="${dark}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <path d="M65 ${eyeY}q4 4 8 0" stroke="${dark}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <path d="M55 ${eyeY + 12}h10" stroke="${dark}" stroke-width="2.2" stroke-linecap="round"/>
      <text x="86" y="34" font-size="13" font-weight="700" fill="rgba(148,163,184,.9)">z</text>
      <text x="93" y="26" font-size="9" font-weight="700" fill="rgba(148,163,184,.7)">z</text>`;
  }
  return `<svg class="pet-svg" viewBox="0 0 120 112" aria-hidden="true"><g class="pet-bob">${body}${face}</g></svg>`;
}

function petCard(n) {
  const p = petState(n);
  const sp = PET_SPECIES[hashSeed(n.id) % PET_SPECIES.length];
  const m = petMoodInfo(n);
  const level = 1 + Math.floor(Math.sqrt(p.xp / 10));
  const prevXp = 10 * (level - 1) * (level - 1);
  const nextXp = 10 * level * level;
  const intimacy = Math.min(100, Math.round((p.xp - prevXp) / Math.max(1, nextXp - prevXp) * 100));
  const hunger = p.lastFeed ? Math.max(0, Math.min(100, 100 - (Date.now() - p.lastFeed) / 3600000 * 3)) : 65;
  const lm = n.latest || {};
  const happy = n.online ? Math.max(8, Math.min(100, Math.round(100 - (Number(lm.cpu) || 0) * 0.55 - Math.max(0, pct(lm.mem_used, lm.mem_total) - 60) * 0.7 - Math.max(0, (Number(lm.temp) || 0) - 70) * 1.5))) : 32;
  const name = p.name || sp.pet || sp.label;
  return `<div class="pet-card ${n.online ? '' : 'offline'}">
    <div class="pet-head">
      <span class="avatar" style="background:${avatarColor(n.id)}">${esc(initialOf(n.name))}</span>
      <div class="pet-node"><b>${esc(n.name)}</b><span>${esc(n.user)}@${esc(n.addr)}</span></div>
      <span class="pet-lv">Lv.${level}</span>
    </div>
    <div class="pet-stage mood-${m.mood}" style="background:radial-gradient(circle at 50% 68%, ${avatarColor(n.id)}1f, transparent 62%)">${petSVG(sp.id, m.mood, avatarColor(n.id))}</div>
    <div class="pet-name"><b>${esc(name)}</b><span>${sp.label} · ${m.label}</span></div>
    <div class="pet-say">${esc(m.word)}</div>
    <div class="pet-bars">
      <div class="pet-bar"><span>心情</span><i><b style="width:${happy}%;background:linear-gradient(90deg,#f472b6,#fb7185)"></b></i><em>${happy}</em></div>
      <div class="pet-bar"><span>饱食</span><i><b style="width:${hunger.toFixed(0)}%;background:linear-gradient(90deg,#fbbf24,#f59e0b)"></b></i><em>${hunger.toFixed(0)}</em></div>
      <div class="pet-bar"><span>亲密</span><i><b style="width:${intimacy}%;background:linear-gradient(90deg,#60a5fa,#2563eb)"></b></i><em>${intimacy}</em></div>
    </div>
    <div class="pet-actions">
      <button class="btn sm primary" data-feed="${esc(n.id)}">投喂 +8</button>
      <button class="btn sm ghost" data-rename="${esc(n.id)}">改名</button>
      <span class="pet-fed">${p.feeds ? `已投喂 ${p.feeds} 次` : '今日份口粮已备好'}</span>
    </div>
  </div>`;
}

const WX_TYPES = {
  sunny: { label: '晴朗', advice: '算力天气稳定，适合跑批、更新与备份。' },
  partly: { label: '多云', advice: '负载略有波动，日常作业不受影响。' },
  cloudy: { label: '阴天', advice: '资源占用偏高，建议留意大进程。' },
  overcast: { label: '闷热', advice: '内存水位偏高，注意容器与缓存。' },
  rain: { label: '雷阵雨', advice: '资源吃紧，可能出现卡顿或超时。' },
  storm: { label: '暴风雪', advice: '负载过高，建议立即排查占用进程。' },
  night: { label: '断网极夜', advice: '节点离线，天气数据缺失。' },
};

function wxIcon(type) {
  const sun = `<circle cx="32" cy="30" r="11" fill="#fbbf24"/><g stroke="#f8b21a" stroke-width="2.6" stroke-linecap="round"><path d="M32 9v5M32 46v5M9 30h5M50 30h5M14 12l3.5 3.5M46.5 44.5 50 48M14 48l3.5-3.5M46.5 15.5 50 12"/></g>`;
  const cloud = (fill, x, y, sc) => `<g transform="translate(${x} ${y}) scale(${sc})"><path d="M18 48h30a10 10 0 0 0 1-20 14 14 0 0 0-26-3 9 9 0 0 0-5 23Z" fill="${fill}"/></g>`;
  const rain = `<g stroke="#38bdf8" stroke-width="2.6" stroke-linecap="round"><path d="M26 52l-3 8M36 52l-3 8M46 52l-3 8"/></g>`;
  const bolt = `<path d="M34 50 28 60h6l-4 8 12-10h-6l4-8Z" fill="#fbbf24"/>`;
  const stars = `<g fill="#cbd5e1"><circle cx="16" cy="18" r="1.6"/><circle cx="24" cy="10" r="1.2"/><circle cx="50" cy="44" r="1.4"/></g>`;
  let inner;
  if (type === 'sunny') inner = sun;
  else if (type === 'partly') inner = `<g transform="translate(10 -8) scale(.78)">${sun}</g>${cloud('#cbd5e1', 4, 14, .9)}`;
  else if (type === 'cloudy') inner = `${cloud('#cbd5e1', 2, 4, .92)}${cloud('#94a3b8', 16, 16, .68)}`;
  else if (type === 'overcast') inner = cloud('#94a3b8', 2, 8, 1);
  else if (type === 'rain') inner = `${cloud('#b6c2d1', 0, 2, 1)}${rain}`;
  else if (type === 'storm') inner = `${cloud('#7d8ba0', 0, 2, 1)}${bolt}`;
  else inner = `<path d="M40 10a18 18 0 1 0 14 26 15 15 0 0 1-14-26Z" fill="#94a3b8"/>${stars}`;
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${inner}</svg>`;
}

function weatherOf(n) {
  const hist = (n.history || []).filter(s => s && typeof s.cpu === 'number');
  const recent = hist.slice(-40);
  const cpus = recent.map(s => Number(s.cpu) || 0);
  const m = n.latest || {};
  const cpu = cpus.length ? cpus[cpus.length - 1] : 0;
  const avg = cpus.length ? cpus.reduce((a, b) => a + b, 0) / cpus.length : 0;
  const mem = pct(m.mem_used, m.mem_total);
  const disk = pct(m.disk_used, m.disk_total);
  const hours = recent.length > 1 ? ((recent[recent.length - 1].time - recent[0].time) / 3600) : 0;
  const slope = hours > 0.005 ? (cpu - cpus[0]) / hours : 0;
  const proj = h => Math.max(0, Math.min(100, cpu + slope * h * 0.4));
  const typeOf = c => c < 30 ? 'sunny' : c < 55 ? 'partly' : c < 72 ? 'cloudy' : c < 88 ? 'rain' : 'storm';
  let type = n.online ? typeOf(cpu) : 'night';
  if (n.online && mem >= 84 && (type === 'cloudy' || type === 'partly')) type = 'overcast';
  const temp = Number(m.temp) > 0 ? Number(m.temp) : 36 + cpu * 0.5;
  const net = (Number(m.net_rx) || 0) + (Number(m.net_tx) || 0);
  const precip = n.online ? Math.max(4, Math.min(96, Math.round(6 + Math.max(0, avg - 25) * 1.4 + Math.max(0, slope) * 6))) : 0;
  const forecast = [0, 1, 3, 6].map(h => {
    const t = n.online ? typeOf(proj(h)) : 'night';
    return { label: h === 0 ? '现在' : `+${h}h`, type: t };
  });
  const advice = WX_TYPES[type].advice + (n.online && disk >= 85 ? ' 另外磁盘余量偏低，建议清理空间。' : '');
  return { type, temp, mem, disk, net, precip, forecast, advice, avg };
}

function weatherCard(n) {
  const w = weatherOf(n);
  const t = WX_TYPES[w.type];
  return `<div class="wx-card wx-${w.type}">
    <div class="wx-head">
      <span class="avatar" style="background:${avatarColor(n.id)}">${esc(initialOf(n.name))}</span>
      <div class="wx-node"><b>${esc(n.name)}</b><span>${esc((n.latest || {}).os || (n.online ? '采集中' : '离线'))}</span></div>
      <span class="wx-tag ${n.online ? '' : 'off'}">${t.label}</span>
    </div>
    <div class="wx-main">
      <div class="wx-icon">${wxIcon(w.type)}</div>
      <div class="wx-temp"><b>${w.temp.toFixed(0)}</b><span>°C</span><em>${t.label}</em></div>
    </div>
    <div class="wx-detail">
      <div><span>内存湿度</span><b>${n.online ? w.mem.toFixed(0) + '%' : '—'}</b></div>
      <div><span>网络风速</span><b>${n.online ? fmtRate(w.net) : '—'}</b></div>
      <div><span>降水概率</span><b>${n.online ? w.precip + '%' : '—'}</b></div>
      <div><span>磁盘余量</span><b>${n.online ? (100 - w.disk).toFixed(0) + '%' : '—'}</b></div>
    </div>
    <div class="wx-forecast">
      ${w.forecast.map(f => `<div><span>${f.label}</span>${wxIcon(f.type)}<em>${WX_TYPES[f.type].label}</em></div>`).join('')}
    </div>
    <div class="wx-advice">${esc(w.advice)}</div>
  </div>`;
}

function achievementCard(a) {
  const got = achUnlocked();
  const at = got[a.id];
  let prog = null;
  if (a.progress) {
    try { prog = a.progress(); } catch (e) { prog = null; }
  }
  return `<div class="ach-card ${at ? 'on' : 'off'}">
    <div class="ach-medal">${ico(a.icon)}</div>
    <div class="ach-body">
      <b>${esc(a.title)}</b>
      <p>${esc(a.desc)}</p>
      ${prog && !at ? `<div class="ach-bar"><i><b style="width:${Math.round(prog[0] / prog[1] * 100)}%"></b></i><span>${prog[0]}/${prog[1]}</span></div>` : ''}
      <span class="ach-state">${at ? '解锁于 ' + new Date(at).toLocaleDateString('zh-CN') : '尚未解锁'}</span>
    </div>
  </div>`;
}

function parkTabsHTML() {
  const ach = Object.keys(achUnlocked()).length;
  const tab = state.parkTab;
  return `<div class="park-tabs" id="parkTabs">
    <button data-parktab="pets" class="${tab === 'pets' ? 'active' : ''}">${ico('park')}服务器宠物</button>
    <button data-parktab="weather" class="${tab === 'weather' ? 'active' : ''}">${ico('sun')}资源天气</button>
    <button data-parktab="ach" class="${tab === 'ach' ? 'active' : ''}">${ico('trophy')}成就徽章 <em>${ach}/${ACHIEVEMENTS.length}</em></button>
  </div>`;
}

function parkCounter() {
  const ach = Object.keys(achUnlocked()).length;
  const top = $('.park-counter');
  if (top) top.innerHTML = `${ico('trophy')}${ach}/${ACHIEVEMENTS.length}`;
  const tab = $('#parkTabs [data-parktab=ach] em');
  if (tab) tab.textContent = `${ach}/${ACHIEVEMENTS.length}`;
}

function drawPark() {
  const host = $('#parkBody');
  if (!host) return;
  checkAchievements();
  parkCounter();
  const nodes = realNodes();
  if (state.parkTab === 'weather') {
    host.innerHTML = nodes.length
      ? `<div class="wx-grid">${nodes.map(weatherCard).join('')}</div><p class="stock-note">天气预报基于最近 2 分钟的 CPU 采样外推，仅供娱乐；温度优先读取 CPU 传感器。</p>`
      : noNodeHTML('还没有可以观测天气的服务器');
  } else if (state.parkTab === 'ach') {
    const got = Object.keys(achUnlocked()).length;
    host.innerHTML = `<div class="ach-summary">
        <div class="ach-count"><b>${got}</b><span>/ ${ACHIEVEMENTS.length} 已解锁</span></div>
        <div class="ach-progress"><i><b style="width:${Math.round(got / ACHIEVEMENTS.length * 100)}%"></b></i></div>
        <p>成就随使用自动解锁，保存在本机浏览器中。多逛逛、多投喂，徽章墙就会亮起来。</p>
      </div>
      <div class="ach-grid">${ACHIEVEMENTS.map(achievementCard).join('')}</div>`;
  } else {
    host.innerHTML = nodes.length
      ? `<div class="pet-grid">${nodes.map(petCard).join('')}</div><p class="stock-note">宠物由节点指纹孵化，心情随实时负载变化；投喂和改名只保存在本机，不会改动服务器。</p>`
      : noNodeHTML('还没有可以养宠物的服务器');
    bindNoNode();
    $$('[data-feed]', host).forEach(btn => btn.addEventListener('click', () => feedPet(btn.dataset.feed)));
    $$('[data-rename]', host).forEach(btn => btn.addEventListener('click', () => renamePet(btn.dataset.rename)));
  }
}

function feedPet(id) {
  const all = petStore();
  const p = all[id] || { xp: 0, feeds: 0, lastFeed: 0, name: '' };
  p.xp = (Number(p.xp) || 0) + 8;
  p.feeds = (Number(p.feeds) || 0) + 1;
  p.lastFeed = Date.now();
  all[id] = p;
  lsSave('kp_pets', all);
  bumpStat('kp_feeds');
  toast('投喂成功 · 亲密度 +8', 'success', 1800);
  drawPark();
  checkAchievements();
}

async function renamePet(id) {
  const all = petStore();
  const p = all[id] || { xp: 0, feeds: 0, lastFeed: 0, name: '' };
  const name = await promptDialog('给宠物改名', '取一个不超过 12 个字的名字', p.name || '');
  if (!name) return;
  p.name = name.slice(0, 12);
  all[id] = p;
  lsSave('kp_pets', all);
  drawPark();
}

async function loadPark() {
  try {
    const data = await api('/api/overview');
    state.nodes = data.nodes || [];
    state.settings = data.settings || state.settings;
    ensureSelected();
    updateNodePills();
    syncTray();
    drawPark();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderPark() {
  const page = $('#page');
  const ach = Object.keys(achUnlocked()).length;
  page.innerHTML = `
    <section class="page-head">
      <div><h1>服务器乐园</h1><p class="page-sub">养一只服务器宠物 · 看资源天气 · 收集成就徽章</p></div>
      <div class="head-actions">
        <span class="park-counter">${ico('trophy')}${ach}/${ACHIEVEMENTS.length}</span>
        <button class="btn sm ghost" id="parkRefresh">刷新</button>
      </div>
    </section>
    ${parkTabsHTML()}
    <div id="parkBody"></div>`;
  drawPark();
  $('#parkRefresh').addEventListener('click', loadPark);
  $('#parkTabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-parktab]');
    if (!btn || btn.dataset.parktab === state.parkTab) return;
    state.parkTab = btn.dataset.parktab;
    localStorage.setItem('kp_park_tab', state.parkTab);
    $$('#parkTabs button').forEach(b => b.classList.toggle('active', b.dataset.parktab === state.parkTab));
    drawPark();
  });
  if (state.pageTimer) clearInterval(state.pageTimer);
  state.pageTimer = setInterval(() => {
    if (state.page === 'park' && !state.subview) loadPark();
  }, 12000);
}

/* ---------- ambient screen ---------- */

function ambientStats() {
  const nodes = realNodes();
  const online = nodes.filter(n => n.online);
  const avg = online.length ? online.reduce((a, n) => a + (Number((n.latest || {}).cpu) || 0), 0) / online.length : 0;
  return { nodes, online, avg };
}

function ambientNodesHTML() {
  const nodes = realNodes();
  if (!nodes.length) return `<div class="ambient-empty">尚未添加节点</div>`;
  return nodes.map(n => {
    const m = n.latest || {};
    const cpu = n.online ? Number(m.cpu) || 0 : 0;
    const mem = pct(m.mem_used, m.mem_total);
    return `<div class="ambient-node ${n.online ? '' : 'off'}">
      <span class="dot ${nodeDotClass(n)}"></span>
      <div class="ambient-node-main"><b>${esc(n.name)}</b><span>${n.online ? `${cpu.toFixed(0)}% CPU · ${mem.toFixed(0)}% 内存` : '离线'}</span></div>
      <div class="ambient-bars"><i><b style="width:${Math.min(100, cpu)}%"></b></i><i><b style="width:${mem}%"></b></i></div>
    </div>`;
  }).join('');
}

function renderAmbient() {
  document.body.classList.add('ambient-mode');
  const root = document.createElement('div');
  root.id = 'ambientRoot';
  root.className = 'ambient';
  root.innerHTML = `
    <canvas id="ambientCanvas"></canvas>
    <div class="ambient-ui">
      <header class="ambient-head">
        <div class="ambient-brand">${ico('ambient')}<span>KayPanel 氛围屏</span></div>
        <div class="ambient-actions">
          <button class="wall-exit" id="ambFull">${ico('expand')}<span>全屏</span></button>
          <button class="wall-exit" id="ambExit">退出 Esc</button>
        </div>
      </header>
      <main class="ambient-center">
        <div class="ambient-clock" id="ambClock">--:--</div>
        <div class="ambient-date" id="ambDate"></div>
        <div class="ambient-line" id="ambLine"></div>
      </main>
      <footer class="ambient-nodes" id="ambNodes">${ambientNodesHTML()}</footer>
    </div>`;
  document.body.appendChild(root);
  bumpStat('kp_screens');
  const exit = () => navigate('overview');
  $('#ambExit').addEventListener('click', exit);
  $('#ambFull').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  state.wallKey = e => { if (e.key === 'Escape' && !document.fullscreenElement) exit(); };
  document.addEventListener('keydown', state.wallKey);
  const refresh = async () => {
    try {
      const data = await api('/api/overview');
      state.nodes = data.nodes || [];
      state.settings = data.settings || state.settings;
      const el = $('#ambNodes');
      if (el) el.innerHTML = ambientNodesHTML();
    } catch (e) { /* keep last frame */ }
  };
  if (!state.nodes.length) refresh();
  state.pageTimer = setInterval(refresh, 5000);

  const canvas = $('#ambientCanvas');
  const ctx = canvas.getContext('2d');
  let stars = [];
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    stars = Array.from({ length: 90 }, () => ({
      x: Math.random(), y: Math.random(),
      r: Math.random() * 1.4 + 0.3,
      p: Math.random() * Math.PI * 2,
      s: 0.3 + Math.random(),
    }));
  };
  resize();
  window.addEventListener('resize', resize);
  state.ambientResize = resize;
  const t0 = performance.now();
  let lastClock = '';
  const loop = now => {
    if (!document.body.classList.contains('ambient-mode')) return;
    const w = canvas.width, h = canvas.height;
    if (!w || !h) { state.ambientRAF = requestAnimationFrame(loop); return; }
    const t = (now - t0) / 1000;
    const stats = ambientStats();
    const hueBase = 188 + Math.min(100, stats.avg) * 1.35;
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#05070d');
    base.addColorStop(0.55, '#070d18');
    base.addColorStop(1, '#04060b');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (const s of stars) {
      const a = 0.35 + Math.sin(t * s.s * 1.4 + s.p) * 0.3;
      ctx.fillStyle = `rgba(173, 208, 255, ${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
    const radius = Math.max(w, h);
    const blobs = [
      { x: w * (0.28 + 0.06 * Math.sin(t * 0.18)), y: h * (0.34 + 0.05 * Math.cos(t * 0.22)), r: radius * 0.42, hue: hueBase - 12, a: 0.16 },
      { x: w * (0.72 + 0.05 * Math.cos(t * 0.14)), y: h * (0.5 + 0.06 * Math.sin(t * 0.17)), r: radius * 0.38, hue: hueBase + 32, a: 0.13 },
      { x: w * (0.5 + 0.07 * Math.sin(t * 0.11 + 2)), y: h * (0.82 + 0.03 * Math.cos(t * 0.2)), r: radius * 0.34, hue: hueBase + 70, a: 0.1 },
    ];
    for (const b of blobs) {
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, `hsla(${b.hue}, 90%, 62%, ${b.a})`);
      g.addColorStop(0.55, `hsla(${b.hue}, 90%, 52%, ${b.a * 0.4})`);
      g.addColorStop(1, 'hsla(210, 90%, 50%, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    const clock = $('#ambClock');
    if (clock) {
      const d = new Date();
      const pad = v => String(v).padStart(2, '0');
      const txt = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      if (txt !== lastClock) {
        clock.textContent = txt;
        const dateEl = $('#ambDate');
        if (dateEl) dateEl.textContent = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${'日一二三四五六'[d.getDay()]}`;
        const line = $('#ambLine');
        if (line) line.innerHTML = `${stats.online.length} / ${stats.nodes.length} 台在线 <i></i> 平均负载 <b>${stats.avg.toFixed(0)}%</b> <i></i> ${stats.avg < 45 ? '机房风平浪静' : stats.avg < 75 ? '算力暖流经过' : '高负载极光'}`;
        lastClock = txt;
      }
    }
    state.ambientRAF = requestAnimationFrame(loop);
  };
  state.ambientRAF = requestAnimationFrame(loop);
}

/* ---------- command palette ---------- */

const PALETTE_PAGES = [
  ['overview', '概览', '节点状态与资源趋势', 'overview'],
  ['topology', '机房拓扑', '可视化机房连接', 'topology'],
  ['netmatrix', '网络质量', '节点间延迟与丢包矩阵', 'network'],
  ['security', '安全体检', 'SSH / 防火墙 / 证书检查', 'shield'],
  ['probes', '拨测状态', '网站与端口可用性 + 公开状态页', 'probe'],
  ['changes', '变更记录', '文件与应用修改回滚', 'history'],
  ['drift', '配置漂移', '对比节点关键配置差异', 'diff'],
  ['batch', '批量操作', '多机命令 / 更新 / 分发', 'batch'],
  ['cost', '电费账本', '功率与电费估算', 'coin'],
  ['personality', '性格周报', '服务器性格与周报', 'heart'],
  ['timeline', '故障回放', '回放历史事件时间轴', 'clock'],
  ['stocks', '行情', '服务器健康度股票行情', 'stocks'],
  ['park', '服务器乐园', '宠物 / 天气 / 成就', 'park'],
  ['containers', '容器', 'Docker 容器管理', 'container'],
  ['apps', '应用', 'Compose 应用栈', 'app'],
  ['files', '文件', 'SFTP 文件管理', 'folder'],
  ['terminal', '终端', '网页 SSH 终端', 'terminal'],
  ['ai', 'AI 助手', '自然语言运维', 'spark'],
  ['settings', '设置', '通知 / AI / 节点', 'settings'],
];

function paletteEntries() {
  const items = PALETTE_PAGES.map(([page, label, hint, icon]) => ({
    kind: '页面', label, hint, icon, run: () => navigate(page),
  }));
  items.push(
    { kind: '界面', label: '监控大屏', hint: '挂机监控视图', icon: 'wall', run: () => navigate('wall') },
    { kind: '界面', label: '氛围屏', hint: '动态极光背景屏', icon: 'ambient', run: () => navigate('ambient') },
  );
  if (hasWindowHost()) items.push({ kind: '界面', label: '悬浮挂件', hint: '置顶小窗监控', icon: 'widget', run: () => enterWidgetMode() });
  items.push(
    { kind: '操作', label: '刷新当前页', hint: '重新拉取数据', icon: 'refresh', run: () => refreshCurrentPage() },
    { kind: '操作', label: '一键巡检', hint: '生成健康评分卡', icon: 'activity', run: () => { navigate('overview'); setTimeout(openInspect, 30); } },
    { kind: '操作', label: '添加节点', hint: '纳管一台新服务器', icon: 'plus', run: () => openNodeForm(null) },
    { kind: '操作', label: state.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题', hint: '外观偏好', icon: state.theme === 'dark' ? 'sun' : 'moon', run: () => toggleTheme() },
  );
  state.nodes.forEach(n => items.push({
    kind: '节点', label: n.name, hint: `${n.user}@${n.addr}${n.online ? '' : ' · 离线'}`, icon: 'server',
    run: () => { selectNode(n.id); navigate('overview'); },
  }));
  return items;
}

function renderPaletteList() {
  const list = $('#palList');
  if (!list) return;
  const input = $('#palInput');
  const q = input ? input.value.trim().toLowerCase() : '';
  let items = paletteEntries();
  if (q) {
    const scored = [];
    for (const it of items) {
      const hay = `${it.label} ${it.hint} ${it.kind}`.toLowerCase();
      const idx = hay.indexOf(q);
      if (idx >= 0) scored.push({ it, rank: it.label.toLowerCase().startsWith(q) ? 0 : idx });
    }
    scored.sort((a, b) => a.rank - b.rank);
    items = scored.map(s => s.it);
  }
  state.paletteFiltered = items;
  if (state.paletteIndex >= items.length) state.paletteIndex = 0;
  if (!items.length) {
    list.innerHTML = `<div class="pal-empty">没有匹配的页面或操作</div>`;
    return;
  }
  list.innerHTML = items.map((it, i) => `<button class="pal-item ${i === state.paletteIndex ? 'active' : ''}" data-pi="${i}">
    <span class="pal-ico">${ico(it.icon)}</span>
    <span class="pal-main"><b>${esc(it.label)}</b><span>${esc(it.hint)}</span></span>
    <em>${it.kind}</em>
  </button>`).join('');
}

function paletteSetIndex(i) {
  const items = state.paletteFiltered;
  if (!items.length) return;
  state.paletteIndex = (i + items.length) % items.length;
  $$('#palList .pal-item').forEach((el, idx) => el.classList.toggle('active', idx === state.paletteIndex));
  const active = $('#palList .pal-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function paletteRun() {
  const item = state.paletteFiltered[state.paletteIndex];
  if (!item) return;
  closePalette();
  setTimeout(() => {
    try { item.run(); } catch (e) { toast(e.message, 'error'); }
  }, 0);
}

function openPalette() {
  if (!state.authed || state.paletteOpen) return;
  state.paletteOpen = true;
  state.paletteIndex = 0;
  const root = document.createElement('div');
  root.id = 'paletteRoot';
  root.className = 'pal-mask';
  root.innerHTML = `<div class="pal" role="dialog" aria-modal="true">
    <div class="pal-input">${ico('search')}<input id="palInput" placeholder="搜索页面、节点或操作…" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
    <div class="pal-list" id="palList"></div>
    <div class="pal-foot"><span>↑↓ 选择</span><span>Enter 执行</span><span>Ctrl+K 关闭</span></div>
  </div>`;
  document.body.appendChild(root);
  root.addEventListener('mousedown', e => { if (e.target === root) closePalette(); });
  const input = $('#palInput');
  input.addEventListener('input', () => { state.paletteIndex = 0; renderPaletteList(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteSetIndex(state.paletteIndex + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); paletteSetIndex(state.paletteIndex - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); paletteRun(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  $('#palList').addEventListener('click', e => {
    const btn = e.target.closest('[data-pi]');
    if (!btn) return;
    state.paletteIndex = Number(btn.dataset.pi);
    paletteRun();
  });
  $('#palList').addEventListener('mousemove', e => {
    const btn = e.target.closest('[data-pi]');
    if (btn && Number(btn.dataset.pi) !== state.paletteIndex) paletteSetIndex(Number(btn.dataset.pi));
  });
  renderPaletteList();
  input.focus();
}

function closePalette() {
  const root = $('#paletteRoot');
  if (root) root.remove();
  state.paletteOpen = false;
  state.paletteFiltered = [];
}

function setupGlobalKeys() {
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      if (!state.authed) return;
      e.preventDefault();
      if (state.paletteOpen) closePalette();
      else openPalette();
    }
  });
}

/* ---------- personality ---------- */

const PERS_TONES = { ok: '#16a34a', good: '#2563eb', fair: '#d97706', bad: '#dc2626', off: '#94a3b8' };
const PERS_SOFTS = { ok: '#e9f7ef', good: '#eef4ff', fair: '#fff7e8', bad: '#fef2f2', off: '#f1f5f9' };

function stableClass(score, online) {
  if (!online) return 'off';
  if (score >= 95) return 'ok';
  if (score >= 80) return 'good';
  if (score >= 60) return 'fair';
  return 'bad';
}

function stableTone(score, online) { return PERS_TONES[stableClass(score, online)]; }

function fmtDays(v) {
  v = Number(v) || 0;
  if (v >= 1) return `${v.toFixed(1)} 天`;
  if (v > 0) return `${Math.max(1, Math.round(v * 24))} 小时`;
  return '不到 1 小时';
}

function loadPersonality(force) {
  if (state.personalityBusy) return;
  state.personalityBusy = true;
  state.personalityError = '';
  api('/api/personality').then(d => {
    state.personality = d;
  }).catch(e => {
    state.personalityError = e.message;
    if (force) toast(e.message, 'error');
  }).finally(() => {
    state.personalityBusy = false;
    if (state.page === 'personality' && !state.subview) renderPage();
  });
  if (force) toast('正在重新统计…', '', 1500);
}

function personalityCardHTML(p) {
  const cls = stableClass(p.stable, p.online);
  const tags = (p.tags || []).map(t => `<span class="pers-tag">${esc(t)}</span>`).join('');
  const stat = (label, value) => `<div class="pers-stat"><span>${label}</span><b>${value}</b></div>`;
  return `<div class="card pers-card tone-${cls}">
    <div class="pers-card-head">
      <span class="avatar" style="background:${avatarColor(p.id)}">${esc(initialOf(p.name))}</span>
      <div class="pers-card-main">
        <div class="pers-name">${esc(p.name)}<span class="pers-title">${esc(p.title)}</span></div>
        <div class="pers-sub">${esc(p.user)}@${esc(p.addr)}${p.os ? ' · ' + esc(p.os) : ''}</div>
      </div>
      <div class="pers-score"><b>${p.stable}</b><span>${esc(p.stable_text)}</span></div>
    </div>
    <div class="pers-tags">${tags || '<span class="pers-tag dim">数据积累中</span>'}</div>
    <div class="pers-line">${esc(p.line)}</div>
    <div class="pers-bar"><i class="${cls}" style="width:${Math.max(0, Math.min(100, p.stable))}%"></i></div>
    <div class="pers-metrics">
      ${stat('平均 CPU', `${(Number(p.cpu_avg) || 0).toFixed(1)}%`)}
      ${stat('平均内存', `${(Number(p.mem_avg) || 0).toFixed(1)}%`)}
      ${stat('磁盘', `${(Number(p.disk_pct) || 0).toFixed(1)}%`)}
      ${stat('峰值 CPU', `${(Number(p.peak_cpu) || 0).toFixed(0)}%`)}
      ${stat('事件', `${Number(p.events) || 0} 条`)}
    </div>
  </div>`;
}

function personalityHTML(d) {
  const nodes = d.nodes || [];
  const cls = stableClass(d.average, true);
  const hls = (d.highlights || []).map(h => `<div class="pers-hl">
    <span>${esc(h.label)}</span><b>${esc(h.name)}</b><i>${esc(h.value)}</i>
  </div>`).join('');
  return `<div class="card pers-hero">
    <div class="insp-ring" style="--pct:${Math.max(0, Math.min(100, d.average))};--tone:${stableTone(d.average, true)}">
      <div class="insp-ring-in"><b>${d.average}</b><span>平均稳定分</span></div>
    </div>
    <div class="pers-hero-main">
      <div class="pers-hero-title">这周，服务器们有自己的性格 <span class="insp-pill tone-${cls}">${esc(d.average >= 95 ? '都很稳' : d.average >= 80 ? '状态良好' : d.average >= 60 ? '小有波动' : '需要关心')}</span></div>
      <p>${nodes.length} 台节点，累计观察 ${fmtDays(d.days)}、${d.samples} 个采样点。稳定分从 100 起，按警告与离线事件扣分；性格标签来自平均负载、峰值、夜间活跃度与运行时长。</p>
      <div class="pers-highlights">${hls || '<span class="muted">数据还太少，先跑一段时间</span>'}</div>
    </div>
    <div class="insp-time">报告生成<br><b>${fmtTime(d.time)}</b></div>
  </div>
  <div class="pers-grid">${nodes.map(personalityCardHTML).join('') || '<div class="card empty"><h3>还没有节点</h3><p>添加服务器后就能生成性格周报</p></div>'}</div>
  <div class="insp-foot">性格来自真实监控数据，长图会带上每台节点的标题、标签与稳定分。</div>`;
}

function renderPersonality() {
  const page = $('#page');
  if (!page) return;
  const d = state.personality;
  const busy = state.personalityBusy;
  const canExport = !!d && !busy;
  page.innerHTML = `
    <section class="page-head">
      <div><h1>服务器性格周报</h1><p class="page-sub">${d ? `${fmtTime(d.time)} · ${d.nodes.length} 台节点 · 观察 ${fmtDays(d.days)}` : '正在读取最近 7 天的趋势与事件…'}</p></div>
      <div class="head-actions">
        <button class="btn sm" id="persRefresh" ${busy ? 'disabled' : ''}>${busy ? '统计中…' : '重新统计'}</button>
        <button class="btn sm" id="persCopy" ${canExport ? '' : 'disabled'}>复制图片</button>
        <button class="btn sm primary" id="persSave" ${canExport ? '' : 'disabled'}>保存长图</button>
      </div>
    </section>
    ${state.personalityError ? `<div class="banner error">${esc(state.personalityError)}</div>` : ''}
    ${!d ? `<div class="card empty"><h3>${busy ? '正在统计…' : '还没有性格数据'}</h3><p>基于每 5 分钟的趋势采样和故障事件计算，数据会随着运行逐渐变准</p></div>` : personalityHTML(d)}`;
  $('#persRefresh').addEventListener('click', () => loadPersonality(true));
  if (canExport) {
    $('#persSave').addEventListener('click', savePersonalityImage);
    $('#persCopy').addEventListener('click', copyPersonalityImage);
  }
  if (!d && !busy && !state.personalityError) setTimeout(() => loadPersonality(false), 0);
}

function persBadge(ctx, text, x, y, tone, soft, font) {
  ctx.font = '600 11.5px ' + INSPECT_FONT;
  const w = ctx.measureText(text).width + 16;
  roundRectPath(ctx, x, y, w, 21, 10.5);
  ctx.fillStyle = soft; ctx.fill();
  ctx.fillStyle = tone;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 8, y + 11.5);
  ctx.textBaseline = 'alphabetic';
  return w;
}

function buildPersonalityCanvas(d) {
  const dpr = 2;
  const W = 900, pad = 36;
  const cardX = pad, cardW = W - pad * 2;
  const headerH = 210, hlH = 64, hlGap = 24, nodeH = 182, nodeGap = 14, footerH = 76;
  const nodes = d.nodes || [];
  const top = pad + headerH + hlGap;
  const nodesTop = top + (d.highlights && d.highlights.length ? hlH + hlGap : 0);
  const H = nodesTop + Math.max(nodes.length, 1) * (nodeH + nodeGap) + footerH + 10;
  const canvas = document.createElement('canvas');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#eef2f8';
  ctx.fillRect(0, 0, W, H);
  roundRectPath(ctx, cardX, pad, cardW, H - pad * 2, 26);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.save();
  roundRectPath(ctx, cardX, pad, cardW, headerH, 26);
  ctx.clip();
  const g = ctx.createLinearGradient(cardX, pad, cardX + cardW, pad + headerH);
  g.addColorStop(0, '#4c1d95');
  g.addColorStop(0.55, '#6d28d9');
  g.addColorStop(1, '#2563eb');
  ctx.fillStyle = g;
  ctx.fillRect(cardX, pad, cardW, headerH);
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(cardX + cardW - 70, pad + 20, 150, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cardX + cardW - 260, pad + headerH + 50, 100, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(233, 213, 255, 0.95)';
  ctx.font = '600 13px ' + INSPECT_FONT;
  ctx.fillText('KAYPANEL · 性格周报', cardX + 44, pad + 48);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 34px ' + INSPECT_FONT;
  ctx.fillText('服务器性格周报', cardX + 44, pad + 102);
  ctx.fillStyle = 'rgba(237, 233, 254, 0.92)';
  ctx.font = '400 14px ' + INSPECT_FONT;
  ctx.fillText(`${fmtTime(d.time)} · ${nodes.length} 台节点 · 观察 ${fmtDays(d.days)}`, cardX + 44, pad + 136);
  ctx.fillStyle = 'rgba(237, 233, 254, 0.72)';
  ctx.font = '400 12px ' + INSPECT_FONT;
  ctx.fillText(`${d.samples} 个采样点 · 稳定分满分 100`, cardX + 44, pad + 168);

  const cx = cardX + cardW - 112, cy = pad + 104, r = 62;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, r - 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(100, d.average)) / 100);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff'; ctx.font = '700 42px ' + INSPECT_FONT;
  ctx.fillText(String(d.average), cx, cy + 10);
  ctx.fillStyle = 'rgba(237, 233, 254, 0.9)'; ctx.font = '400 12px ' + INSPECT_FONT;
  ctx.fillText('平均稳定分', cx, cy + 32);
  ctx.textAlign = 'left';
  ctx.restore();

  const hls = d.highlights || [];
  if (hls.length) {
    const bw = (cardW - 56 - (hls.length - 1) * 10) / hls.length;
    hls.forEach((h, i) => {
      const bx = cardX + 28 + i * (bw + 10);
      roundRectPath(ctx, bx, top, bw, hlH, 12);
      ctx.fillStyle = '#f7f9fd'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = '#e8edf6'; ctx.stroke();
      ctx.fillStyle = '#7c8798'; ctx.font = '400 11px ' + INSPECT_FONT;
      ctx.fillText(fitCanvasText(ctx, h.label, bw - 26), bx + 13, top + 20);
      ctx.fillStyle = '#0f172a'; ctx.font = '600 15px ' + INSPECT_FONT;
      ctx.fillText(fitCanvasText(ctx, h.name, bw - 26), bx + 13, top + 40);
      ctx.fillStyle = '#6d28d9'; ctx.font = '600 12px ' + INSPECT_FONT;
      ctx.fillText(fitCanvasText(ctx, h.value, bw - 26), bx + 13, top + 56);
    });
  }

  let y = nodesTop;
  if (!nodes.length) {
    ctx.fillStyle = '#94a3b8'; ctx.font = '400 14px ' + INSPECT_FONT;
    ctx.textAlign = 'center';
    ctx.fillText('尚未添加节点', W / 2, y + 80);
    ctx.textAlign = 'left';
  }
  for (const p of nodes) {
    const cls = stableClass(p.stable, p.online);
    const tone = PERS_TONES[cls], soft = PERS_SOFTS[cls];
    const x = cardX + 28, w = cardW - 56;
    roundRectPath(ctx, x, y, w, nodeH, 16);
    ctx.fillStyle = '#fbfcfe'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = '#e5eaf2'; ctx.stroke();
    roundRectPath(ctx, x, y + 16, 5, nodeH - 32, 2.5);
    ctx.fillStyle = tone; ctx.fill();

    const nx = x + 26;
    ctx.fillStyle = '#0f172a'; ctx.font = '600 18px ' + INSPECT_FONT;
    ctx.fillText(fitCanvasText(ctx, p.name, 330), nx, y + 34);
    ctx.font = '600 18px ' + INSPECT_FONT;
    const badgeX = nx + Math.min(ctx.measureText(p.name).width, 330) + 10;
    persBadge(ctx, p.title || '观察中', badgeX, y + 17, tone, soft);

    ctx.textAlign = 'right';
    ctx.fillStyle = tone; ctx.font = '700 30px ' + INSPECT_FONT;
    ctx.fillText(String(p.stable), x + w - 26, y + 40);
    ctx.fillStyle = tone; ctx.font = '600 11.5px ' + INSPECT_FONT;
    ctx.fillText(p.stable_text || '', x + w - 26, y + 58);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#64748b'; ctx.font = '400 12px ' + INSPECT_FONT;
    const subtitle = `${p.user ? p.user + '@' : ''}${p.addr}${p.os ? ' · ' + p.os : ''}`;
    ctx.fillText(fitCanvasText(ctx, subtitle, 500), nx, y + 56);

    let tx = nx;
    let shown = 0;
    for (const tag of (p.tags || [])) {
      ctx.font = '600 11.5px ' + INSPECT_FONT;
      const tw = ctx.measureText(tag).width + 18;
      if (tx + tw > x + w - 40 || shown >= 4) break;
      roundRectPath(ctx, tx, y + 70, tw, 22, 6);
      ctx.fillStyle = soft; ctx.fill();
      ctx.fillStyle = tone; ctx.font = '500 11.5px ' + INSPECT_FONT;
      ctx.fillText(tag, tx + 9, y + 85);
      tx += tw + 7;
      shown++;
    }

    ctx.fillStyle = '#52606f'; ctx.font = '400 12.5px ' + INSPECT_FONT;
    ctx.fillText(fitCanvasText(ctx, p.line || '', w - 52), nx, y + 122);

    const metrics = [
      ['平均 CPU', `${(Number(p.cpu_avg) || 0).toFixed(0)}%`],
      ['平均内存', `${(Number(p.mem_avg) || 0).toFixed(0)}%`],
      ['磁盘', `${(Number(p.disk_pct) || 0).toFixed(0)}%`],
      ['峰值 CPU', `${(Number(p.peak_cpu) || 0).toFixed(0)}%`],
      ['事件', `${Number(p.events) || 0} 条`],
    ];
    const mw = (w - 52) / 5;
    metrics.forEach(([label, value], i) => {
      const mx = nx + i * mw;
      ctx.fillStyle = '#8a94a6'; ctx.font = '400 10.5px ' + INSPECT_FONT;
      ctx.fillText(label, mx, y + 146);
      ctx.fillStyle = '#334155'; ctx.font = '600 14px ' + INSPECT_FONT;
      ctx.fillText(value, mx, y + 166);
    });

    y += nodeH + nodeGap;
  }

  const fy = H - pad - 26;
  ctx.strokeStyle = '#e9edf4';
  ctx.beginPath(); ctx.moveTo(cardX + 44, fy - 22); ctx.lineTo(cardX + cardW - 44, fy - 22); ctx.stroke();
  ctx.fillStyle = '#94a3b8'; ctx.font = '400 12px ' + INSPECT_FONT;
  ctx.fillText('由 KayPanel 自动生成 · 基于最近 7 天监控数据', cardX + 44, fy);
  ctx.textAlign = 'right';
  ctx.fillText(`KayPanel ${d.version || ''}`, cardX + cardW - 44, fy);
  ctx.textAlign = 'left';
  return canvas;
}

function downloadCanvas(canvas, filename, okText) {
  canvas.toBlob(blob => {
    if (!blob) { toast('生成图片失败', 'error'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(okText || '长图已保存');
  }, 'image/png');
}

async function copyCanvas(canvas) {
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('unsupported');
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('已复制到剪贴板，可直接粘贴到聊天窗口');
  } catch (e) {
    toast('复制失败，请使用「保存长图」', 'error');
  }
}

function savePersonalityImage() {
  const d = state.personality;
  if (!d) return;
  downloadCanvas(buildPersonalityCanvas(d), `KayPanel-性格周报-${inspectStamp()}.png`, '性格周报长图已保存');
}

function copyPersonalityImage() {
  const d = state.personality;
  if (!d) return;
  copyCanvas(buildPersonalityCanvas(d));
}

/* ---------- timeline ---------- */

const TL_LEVELS = {
  error: { label: '异常', color: '#dc2626', soft: '#fef2f2' },
  warn: { label: '警告', color: '#d97706', soft: '#fff7e8' },
  info: { label: '信息', color: '#2563eb', soft: '#eef4ff' },
};

function loadTimeline(force) {
  if (state.timelineBusy) return;
  state.timelineBusy = true;
  state.timelineError = '';
  api('/api/events').then(d => {
    state.timeline = d;
  }).catch(e => {
    state.timelineError = e.message;
    if (force) toast(e.message, 'error');
  }).finally(() => {
    state.timelineBusy = false;
    if (state.page === 'timeline' && !state.subview) renderPage();
  });
  if (force) toast('正在刷新事件…', '', 1500);
}

function fmtSpan(sec) {
  sec = Math.max(0, Number(sec) || 0);
  if (sec >= 86400) return `${(sec / 86400).toFixed(1)} 天`;
  if (sec >= 3600) return `${(sec / 3600).toFixed(1)} 小时`;
  if (sec >= 60) return `${Math.round(sec / 60)} 分钟`;
  return `${Math.round(sec)} 秒`;
}

function tlSparkCard(n, d) {
  const pts = (d.trends && d.trends[n.id]) || [];
  const span = pts.length > 1 ? pts[pts.length - 1].t - pts[0].t : 0;
  let chart;
  if (n.sftp_only) {
    chart = `<div class="tl-spark-empty">仅文件管理，不采集系统指标</div>`;
  } else if (pts.length < 2) {
    chart = `<div class="tl-spark-empty">采样中，趋势会在几分钟后出现</div>`;
  } else {
    chart = chartSVG([
      { values: pts.map(p => Number(p.cpu) || 0), color: '#2563eb', fill: true },
      { values: pts.map(p => Number(p.mem) || 0), color: '#7c3aed' },
      { values: pts.map(p => Number(p.disk) || 0), color: '#d97706' },
    ], { height: 54, max: 100 });
  }
  return `<div class="card tl-spark">
    <div class="tl-spark-head">
      <span class="dot ${n.online ? 'online' : 'offline'}"></span>
      <b>${esc(n.name)}</b>
      <span class="spacer"></span>
      <span class="tl-spark-events">${n.events} 事件</span>
    </div>
    <div class="tl-spark-chart">${chart}</div>
    <div class="tl-spark-foot">
      <span class="tl-leg"><i style="background:#2563eb"></i>CPU</span>
      <span class="tl-leg"><i style="background:#7c3aed"></i>内存</span>
      <span class="tl-leg"><i style="background:#d97706"></i>磁盘</span>
      <span class="spacer"></span>
      <span>${pts.length > 1 ? `近 ${fmtSpan(span)} · ${pts.length} 点` : n.sftp_only ? '无指标' : '采样中'}</span>
    </div>
  </div>`;
}

function tlEventHTML(e, open) {
  const lv = TL_LEVELS[e.level] || TL_LEVELS.info;
  const key = `${e.node_id}:${e.time}:${e.title}`;
  const metric = (label, value) => `<span class="tl-m"><span>${label}</span><b>${value}</b></span>`;
  return `<div class="tl-ev ${esc(e.level)}${open ? ' open' : ''}" data-ev="${esc(key)}">
    <div class="tl-rail"><i style="background:${lv.color}"></i></div>
    <div class="tl-ev-body">
      <div class="tl-ev-head">
        <span class="tl-badge" style="color:${lv.color};background:${lv.soft}">${lv.label}</span>
        <span class="tl-ev-title">${esc(e.title)}</span>
        <span class="tl-ev-node">${esc(e.node_name)}</span>
        <span class="spacer"></span>
        <span class="tl-ev-time">${fmtTime(e.time)}</span>
        <span class="tl-ev-ago">${timeAgo(e.time)}</span>
      </div>
      ${e.detail ? `<div class="tl-ev-detail">${esc(e.detail)}</div>` : ''}
      <div class="tl-ev-more" ${open ? '' : 'hidden'}>
        ${metric('CPU', fmtPct(e.cpu))}
        ${metric('内存', fmtPct(e.mem_pct))}
        ${metric('磁盘', fmtPct(e.disk_pct))}
        ${metric('负载', (Number(e.load1) || 0).toFixed(2))}
        ${e.temp > 0 ? metric('温度', `${Number(e.temp).toFixed(0)}°C`) : ''}
        ${metric('容器', e.docker_total > 0 ? `${e.docker_running}/${e.docker_total}` : '未安装')}
      </div>
      <button type="button" class="tl-ev-toggle">${open ? '收起指标' : '指标快照'}</button>
    </div>
  </div>`;
}

function timelineDayLabel(unix) {
  const d = new Date(unix * 1000);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
}

/* ---------- timeline playback ---------- */

const TL_WINDOW = 24 * 3600;
const TL_RATE = 60;

function tlClockText(unix) {
  const d = new Date(unix * 1000);
  if (isNaN(d.getTime())) return '--';
  const pad = v => String(v).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tlInterp(pts, t) {
  let lo = 0, hi = pts.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (idx < 0) return null;
  const a = pts[idx], b = pts[idx + 1];
  const av = { cpu: Number(a.cpu) || 0, mem: Number(a.mem) || 0 };
  if (!b) return av;
  const span = b.t - a.t;
  if (span <= 0) return av;
  const f = Math.max(0, Math.min(1, (t - a.t) / span));
  return {
    cpu: av.cpu * (1 - f) + (Number(b.cpu) || 0) * f,
    mem: av.mem * (1 - f) + (Number(b.mem) || 0) * f,
  };
}

function tlPlayData(d) {
  const key = `${d.time}:${state.timelineNode}:${state.timelineLevel}`;
  if (state.tlPlay.cache && state.tlPlay.cache.key === key) return state.tlPlay.cache;
  const end = Number(d.time) || Math.floor(Date.now() / 1000);
  const start = end - TL_WINDOW;
  const wantNode = state.timelineNode;
  const trends = {};
  for (const n of d.nodes || []) {
    if (wantNode !== 'all' && n.id !== wantNode) continue;
    const pts = ((d.trends && d.trends[n.id]) || []).filter(p => p && p.t && p.t >= start - 1800 && p.t <= end + 600);
    if (pts.length) trends[n.id] = pts;
  }
  const series = Object.values(trends);
  const buckets = [];
  for (let t = start; t <= end; t += 300) {
    let cpu = 0, mem = 0, count = 0;
    for (const pts of series) {
      const v = tlInterp(pts, t);
      if (!v) continue;
      cpu += v.cpu; mem += v.mem; count++;
    }
    if (count) buckets.push({ t, cpu: cpu / count, mem: mem / count });
  }
  const events = (d.events || [])
    .filter(e => e.time >= start && e.time <= end)
    .filter(e => wantNode === 'all' || e.node_id === wantNode)
    .filter(e => state.timelineLevel === 'all' || e.level === state.timelineLevel)
    .sort((a, b) => a.time - b.time);
  const data = { key, start, end, buckets, events };
  state.tlPlay.cache = data;
  return data;
}

function tlReplaySVG(pd, t) {
  if (pd.buckets.length < 2) return `<div class="chart-empty">还没有 24 小时趋势数据，最多几分钟后会生成</div>`;
  const w = 1000, h = 176, padX = 6, padY = 10;
  const xOf = bt => padX + ((bt - pd.start) / TL_WINDOW) * (w - padX * 2);
  const yOf = v => padY + (1 - Math.max(0, Math.min(100, v)) / 100) * (h - padY * 2);
  const line = (pts, pick) => smoothPath(pts.map(p => [xOf(p.t), yOf(pick(p))]));
  const cpuPts = pd.buckets, memPts = pd.buckets;
  const cpuPath = line(cpuPts, p => p.cpu);
  const memPath = line(memPts, p => p.mem);
  const cut = Math.max(padX, Math.min(w - padX, xOf(t)));
  const grids = [0.25, 0.5, 0.75].map(f => `<line class="tl-grid" x1="0" y1="${(h * f).toFixed(1)}" x2="${w}" y2="${(h * f).toFixed(1)}"/>`).join('')
    + [0.25, 0.5, 0.75].map(f => `<line class="tl-grid v" x1="${(w * f).toFixed(1)}" y1="0" x2="${(w * f).toFixed(1)}" y2="${h}"/>`).join('');
  const hit = pd.buckets.reduce((best, p) => Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best, pd.buckets[0]);
  return `<svg class="tl-replay-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="tl-cpu-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2563eb" stop-opacity="0.22"/><stop offset="1" stop-color="#2563eb" stop-opacity="0"/></linearGradient>
      <clipPath id="tl-clip"><rect x="0" y="0" width="${cut.toFixed(1)}" height="${h}"/></clipPath>
    </defs>
    ${grids}
    <path class="tl-faint-line cpu" d="${cpuPath}"/>
    <path class="tl-faint-line mem" d="${memPath}"/>
    <g clip-path="url(#tl-clip)">
      <path d="${cpuPath} L${xOf(hit.t).toFixed(1)},${h - padY} L${xOf(pd.buckets[0].t).toFixed(1)},${h - padY} Z" fill="url(#tl-cpu-fill)"/>
      <path class="tl-strong-line cpu" d="${cpuPath}"/>
      <path class="tl-strong-line mem" d="${memPath}"/>
    </g>
    <line class="tl-cursor" x1="${cut.toFixed(1)}" y1="0" x2="${cut.toFixed(1)}" y2="${h}"/>
    <circle class="tl-cursor-dot cpu" cx="${cut.toFixed(1)}" cy="${yOf(hit.cpu).toFixed(1)}" r="3.4"/>
    <circle class="tl-cursor-dot mem" cx="${cut.toFixed(1)}" cy="${yOf(hit.mem).toFixed(1)}" r="3.4"/>
  </svg>`;
}

function tlPlayerHTML(d, pd) {
  const has = pd.buckets.length >= 2;
  const speeds = [1, 8, 30].map(s => `<button type="button" data-tlspeed="${s}" class="${state.tlPlay.speed === s ? 'active' : ''}">${s}×</button>`).join('');
  return `<div class="card tl-player">
    <div class="tl-player-head">
      <div class="tl-player-title">
        <span class="tl-player-ico">${ico('clock')}</span>
        <div><h2>24 小时故障回放</h2><p>拖动时间轴，或按下播放键重看故障是怎样发生的</p></div>
      </div>
      <div class="tl-player-actions">
        <button class="btn sm primary" id="tlPlayBtn" ${has ? '' : 'disabled'}>${ico('play', 'ico')}播放</button>
        <div class="tl-speed" id="tlSpeed">${speeds}</div>
        <button class="btn sm" id="tlRealBtn">${ico('activity', 'ico')}回到最新</button>
      </div>
    </div>
    <div class="tl-player-clock">
      <b id="tlClock">${tlClockText(state.tlPlay.t)}</b>
      <span id="tlPlayCount"></span>
      <span class="spacer"></span>
      <span class="tl-leg"><i style="background:#2563eb"></i>CPU</span>
      <span class="tl-leg"><i style="background:#7c3aed"></i>内存</span>
      <span class="tl-speed-note">1× = 每秒回放 1 分钟</span>
    </div>
    <div class="tl-chart-wrap" id="tlChart">${tlReplaySVG(pd, state.tlPlay.t)}</div>
    <div class="tl-axis"><span>${tlClockText(pd.start)}</span><span>${tlClockText(pd.start + TL_WINDOW / 2)}</span><span>${tlClockText(pd.end)}</span></div>
    <div class="tl-scrub">
      <input type="range" id="tlScrub" min="${pd.start}" max="${pd.end}" step="30" value="${Math.round(state.tlPlay.t)}" aria-label="回放时间轴">
      <div class="tl-marks">${pd.events.map(e => `<i class="${esc(e.level)}" style="left:${(((e.time - pd.start) / TL_WINDOW) * 100).toFixed(2)}%" title="${esc(fmtTime(e.time))} · ${esc(e.title)}"></i>`).join('')}</div>
    </div>
    <div class="tl-pop" id="tlPop"></div>
  </div>`;
}

function tlPlayButton() {
  const btn = $('#tlPlayBtn');
  if (!btn) return;
  btn.innerHTML = state.tlPlay.playing ? `${ico('pause', 'ico')}暂停` : `${ico('play', 'ico')}播放`;
  btn.classList.toggle('playing', state.tlPlay.playing);
}

function tlPlayPaint() {
  const d = state.timeline;
  if (!d) return;
  const pd = tlPlayData(d);
  const t = Math.max(pd.start, Math.min(pd.end, state.tlPlay.t || pd.end));
  const chart = $('#tlChart');
  if (chart) chart.innerHTML = tlReplaySVG(pd, t);
  const clock = $('#tlClock');
  if (clock) clock.textContent = tlClockText(t);
  const scrub = $('#tlScrub');
  if (scrub && document.activeElement !== scrub) scrub.value = String(Math.round(t));
  const passed = pd.events.filter(e => e.time <= t);
  const count = $('#tlPlayCount');
  if (count) count.textContent = `已回放 ${passed.length} / ${pd.events.length} 条事件`;
  const recent = passed.slice(-3).reverse();
  const pop = $('#tlPop');
  if (pop) {
    const sig = recent.map(e => `${e.node_id}:${e.time}:${e.title}`).join('|');
    if (sig !== state.tlPlay.popKey) {
      state.tlPlay.popKey = sig;
      pop.innerHTML = recent.length
        ? recent.map(e => `<div class="tl-pop-item ${esc(e.level)}"><span class="tl-pop-dot"></span><b>${esc(e.title)}</b><span>${esc(e.node_name)} · ${esc(tlClockText(e.time).slice(6))}</span><span class="spacer"></span><span class="tl-pop-ago">${timeAgo(e.time)}</span></div>`).join('')
        : `<div class="tl-pop-empty">播放时，到点的事件会在这里弹出</div>`;
    }
  }
}

function tlPlayPause() {
  if (state.tlPlay.timer) { clearInterval(state.tlPlay.timer); state.tlPlay.timer = null; }
  state.tlPlay.playing = false;
  tlPlayButton();
}

function tlPlayTick() {
  const d = state.timeline;
  if (!d || state.page !== 'timeline' || state.subview) { tlPlayPause(); return; }
  const pd = tlPlayData(d);
  const now = performance.now();
  const dt = Math.min(1.5, (now - (state.tlPlay.last || now)) / 1000);
  state.tlPlay.last = now;
  state.tlPlay.t = Math.min(pd.end, state.tlPlay.t + dt * TL_RATE * state.tlPlay.speed);
  if (state.tlPlay.t >= pd.end) tlPlayPause();
  tlPlayPaint();
}

function tlPlayToggle() {
  const d = state.timeline;
  if (!d) return;
  if (state.tlPlay.playing) { tlPlayPause(); return; }
  const pd = tlPlayData(d);
  if (pd.buckets.length < 2) { toast('趋势数据还不够，稍等几分钟再试'); return; }
  if (state.tlPlay.t >= pd.end - 30) state.tlPlay.t = pd.start;
  state.tlPlay.playing = true;
  state.tlPlay.last = performance.now();
  state.tlPlay.timer = setInterval(tlPlayTick, 250);
  tlPlayButton();
  tlPlayPaint();
}

function timelineHTML(d) {
  const nodes = d.nodes || [];
  const all = d.events || [];
  const pd = tlPlayData(d);
  if (!state.tlPlay.t || state.tlPlay.t < pd.start || state.tlPlay.t > pd.end) state.tlPlay.t = pd.end;
  const errors = all.filter(e => e.level === 'error').length;
  const warns = all.filter(e => e.level === 'warn').length;
  const nodeCount = {};
  all.forEach(e => { nodeCount[e.node_id] = (nodeCount[e.node_id] || 0) + 1; });
  const levelCount = { all: all.length, error: errors, warn: warns, info: all.length - errors - warns };
  const nodeChips = [`<button class="tl-chip ${state.timelineNode === 'all' ? 'active' : ''}" data-tlnode="all">全部节点 ${all.length}</button>`]
    .concat(nodes.map(n => `<button class="tl-chip ${state.timelineNode === n.id ? 'active' : ''}" data-tlnode="${esc(n.id)}">${esc(n.name)} ${nodeCount[n.id] || 0}</button>`))
    .join('');
  const levelChips = ['all', 'error', 'warn', 'info'].map(k => {
    const label = k === 'all' ? '全部级别' : TL_LEVELS[k].label;
    return `<button class="tl-chip ${state.timelineLevel === k ? 'active' : ''} ${k}" data-tllevel="${k}">${label} ${levelCount[k]}</button>`;
  }).join('');
  const filtered = all.filter(e =>
    (state.timelineNode === 'all' || e.node_id === state.timelineNode) &&
    (state.timelineLevel === 'all' || e.level === state.timelineLevel));
  let rows = '';
  let day = '';
  for (const e of filtered) {
    const label = timelineDayLabel(e.time);
    if (label !== day) {
      day = label;
      rows += `<div class="tl-day">${esc(label)}</div>`;
    }
    const key = `${e.node_id}:${e.time}:${e.title}`;
    rows += tlEventHTML(e, !!state.timelineOpen[key]);
  }
  return `<div class="card tl-summary">
      <div class="tl-summary-main">
        <div class="tl-summary-title">最近 7 天共记录 ${all.length} 条事件</div>
        <p>异常 ${errors} 条、警告 ${warns} 条。节点离线、CPU / 内存 / 磁盘越过阈值、容器退出、温度过高都会被记录，并附带当时的指标快照。</p>
      </div>
      <div class="tl-summary-chips">
        <span class="tl-count bad"><b>${errors}</b>异常</span>
        <span class="tl-count warn"><b>${warns}</b>警告</span>
        <span class="tl-count info"><b>${levelCount.info}</b>信息</span>
      </div>
    </div>
    ${tlPlayerHTML(d, pd)}
    <div class="tl-spark-grid">${nodes.map(n => tlSparkCard(n, d)).join('')}</div>
    <div class="tl-filters">
      <div class="tl-chip-row">${nodeChips}</div>
      <div class="tl-chip-row">${levelChips}</div>
    </div>
    <div class="card tl-list">
      <div class="tl-list-head"><h2>故障回放</h2><span>${filtered.length} 条 · 按时间倒序</span></div>
      ${rows || `<div class="empty"><h3>没有匹配的事件</h3><p>换个筛选条件，或等下一次阈值触发</p></div>`}
    </div>`;
}

function renderTimeline() {
  const page = $('#page');
  if (!page) return;
  const d = state.timeline;
  const busy = state.timelineBusy;
  page.innerHTML = `
    <section class="page-head">
      <div><h1>故障回放时间轴</h1><p class="page-sub">${d ? `${fmtTime(d.time)} · ${d.nodes.length} 台节点 · ${(d.events || []).length} 条事件` : '正在读取事件与趋势…'}</p></div>
      <div class="head-actions">
        <button class="btn sm" id="tlRefresh" ${busy ? 'disabled' : ''}>${busy ? '刷新中…' : '刷新'}</button>
      </div>
    </section>
    ${state.timelineError ? `<div class="banner error">${esc(state.timelineError)}</div>` : ''}
    ${!d ? `<div class="card empty"><h3>${busy ? '正在读取…' : '还没有事件数据'}</h3><p>事件会在节点离线或指标越过阈值时自动记录，趋势每 5 分钟落一个点</p></div>` : timelineHTML(d)}`;
  $('#tlRefresh').addEventListener('click', () => loadTimeline(true));
  if (d) {
    const playBtn = $('#tlPlayBtn');
    if (playBtn) playBtn.addEventListener('click', tlPlayToggle);
    const realBtn = $('#tlRealBtn');
    if (realBtn) realBtn.addEventListener('click', () => {
      const pd = tlPlayData(d);
      tlPlayPause();
      state.tlPlay.t = pd.end;
      tlPlayPaint();
    });
    $$('[data-tlspeed]').forEach(b => b.addEventListener('click', () => {
      state.tlPlay.speed = Number(b.dataset.tlspeed) || 1;
      $$('[data-tlspeed]').forEach(x => x.classList.toggle('active', x === b));
      tlPlayPaint();
    }));
    const scrub = $('#tlScrub');
    if (scrub) scrub.addEventListener('input', () => {
      state.tlPlay.t = Number(scrub.value) || 0;
      state.tlPlay.last = performance.now();
      tlPlayPaint();
    });
    state.tlPlay.popKey = '';
    tlPlayPaint();
    $$('[data-tlnode]').forEach(b => b.addEventListener('click', () => {
      state.timelineNode = b.dataset.tlnode;
      renderPage();
    }));
    $$('[data-tllevel]').forEach(b => b.addEventListener('click', () => {
      state.timelineLevel = b.dataset.tllevel;
      renderPage();
    }));
    const list = $('.tl-list');
    if (list) {
      list.addEventListener('click', ev => {
        const row = ev.target.closest('[data-ev]');
        if (!row) return;
        const key = row.dataset.ev;
        state.timelineOpen[key] = !state.timelineOpen[key];
        const open = !!state.timelineOpen[key];
        row.classList.toggle('open', open);
        const more = row.querySelector('.tl-ev-more');
        if (more) more.hidden = !open;
        const t = row.querySelector('.tl-ev-toggle');
        if (t) t.textContent = open ? '收起指标' : '指标快照';
      });
    }
  }
  if (!d && !busy && !state.timelineError) setTimeout(() => loadTimeline(false), 0);
}

/* ---------- AI stack ---------- */

const AI_STACK_EXAMPLES = [
  '搭一个私有云盘，能在浏览器里预览文件',
  '装 Uptime Kuma 监控我的几个网站',
  '部署一个轻量博客，支持 Markdown 写作',
  '装一个 qBittorrent 下载器，带 Web 界面',
];

function openAIStack() {
  state.subview = { type: 'ai-stack' };
  state.aiStackPrompt = '';
  state.aiStackResult = null;
  state.aiStackError = '';
  state.aiStackBusy = false;
  renderPage();
}

function aiStackPromptHTML() {
  const examples = AI_STACK_EXAMPLES.map(x => `<button type="button" class="tl-chip" data-example="${esc(x)}">${esc(x)}</button>`).join('');
  return `<div class="card ai-stack-card">
    <div class="ai-stack-intro">
      <span class="ai-stack-ico">${ico('spark')}</span>
      <div><h2>一句话装应用</h2><p>描述想装什么，AI 会生成单文件 compose.yaml。生成后可以先预览和修改，确认后才会写入节点。</p></div>
    </div>
    <div class="field">
      <label>想装什么？</label>
      <textarea id="aiStackPrompt" class="ai-stack-prompt" maxlength="500" placeholder="例如：帮我搭一个家庭影音库，能自动整理电影和剧集">${esc(state.aiStackPrompt)}</textarea>
      <div class="hint">最多 500 字。AI 会遵守面板安全规则：不生成 privileged / host 网络 / Docker socket 等配置。</div>
    </div>
    <div class="ai-stack-examples" id="aiStackExamples">${examples}</div>
    <div class="form-actions">
      <button class="btn primary" id="aiStackGen" ${state.aiStackBusy ? 'disabled' : ''}>${state.aiStackBusy ? 'AI 正在设计…' : '生成部署方案'}</button>
      <span class="hint">${state.aiStackBusy ? '通常需要 10-40 秒，请稍候' : '生成不会改动服务器'}</span>
    </div>
  </div>`;
}

function aiStackPreviewHTML(r) {
  const images = (r.images || []).map(x => `<span class="tl-chip">${esc(x)}</span>`).join('');
  const notes = (r.notes || []).length
    ? `<div class="ai-stack-notes"><h4>部署后</h4><ol>${r.notes.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>`
    : '';
  const warnings = (r.warnings || []).length
    ? `<div class="ai-stack-notes warn"><h4>需要注意</h4><ul>${r.warnings.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`
    : '';
  return `<div class="card ai-stack-card">
    <div class="ai-stack-plan-head">
      <div>
        <h2>${esc(r.title || r.name)}</h2>
        <p>${esc(r.description || 'AI 生成的部署方案')}</p>
      </div>
      <div class="ai-stack-meta"><span>${r.services} 个服务</span>${images}</div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label>应用名称</label>
        <input type="text" id="aiStackName" value="${esc(r.name)}" maxlength="40">
        <div class="hint">小写字母、数字、- 或 _，作为 Compose 项目名和目录名</div>
      </div>
      <div class="field">
        <label>镜像</label>
        <input type="text" value="${esc((r.images || []).join('  ·  '))}" readonly>
        <div class="hint">来自 AI 生成结果，确认没有拼写错误</div>
      </div>
      <div class="field full">
        <label>compose.yaml</label>
        <textarea id="aiStackCompose" class="code-editor" spellcheck="false">${esc(r.compose)}</textarea>
        <div class="hint">保存前会再次经过面板安全校验，带 build、privileged、host 网络等配置会被拒绝</div>
      </div>
    </div>
    <div class="ai-stack-note-grid">${notes}${warnings}</div>
    <div class="form-actions">
      <button class="btn primary" id="aiStackDeploy">保存并部署</button>
      <button class="btn" id="aiStackSaveOnly">仅保存</button>
      <div class="spacer"></div>
      <button class="btn ghost" id="aiStackRetry">重新生成</button>
    </div>
  </div>`;
}

function renderAIStack() {
  const page = $('#page');
  const n = currentNode();
  const back = () => { state.subview = null; state.aiStackResult = null; state.aiStackError = ''; renderPage(); };
  if (!n) {
    page.innerHTML = `<section class="page-head"><div><h1>AI 装应用</h1><p class="page-sub">用一句话生成 Compose 部署方案</p></div></section>` + noNodeHTML();
    bindNoNode();
    return;
  }
  if (n.sftp_only) {
    page.innerHTML = `<section class="page-head"><div><h1>AI 装应用</h1><p class="page-sub">${esc(n.name)}</p></div>
      <div class="head-actions"><button class="btn sm ghost" id="aiStackBackOnly">返回应用</button></div></section>
      <div class="card empty"><h3>虚拟主机不支持部署应用</h3><p>这个节点只提供 SFTP 文件管理，请选择一台完整的服务器</p></div>`;
    $('#aiStackBackOnly').addEventListener('click', back);
    return;
  }
  const r = state.aiStackResult;
  page.innerHTML = `
    <section class="page-head">
      <div><h1>AI 装应用</h1><p class="page-sub">${esc(n.name)} · 一句话生成 Compose 并部署</p></div>
      <div class="head-actions"><button class="btn sm ghost" id="aiStackBackTop">返回应用</button></div>
    </section>
    ${state.aiStackError ? `<div class="banner error">${esc(state.aiStackError)}</div>` : ''}
    ${r ? aiStackPreviewHTML(r) : aiStackPromptHTML()}`;
  $('#aiStackBackTop').addEventListener('click', back);

  if (!r) {
    const ta = $('#aiStackPrompt');
    $$('#aiStackExamples [data-example]').forEach(b => b.addEventListener('click', () => {
      ta.value = b.dataset.example;
      ta.focus();
    }));
    $('#aiStackGen').addEventListener('click', generateAIStack);
    return;
  }

  const regenerate = () => {
    state.aiStackResult = null;
    state.aiStackError = '';
    renderPage();
  };
  $('#aiStackRetry').addEventListener('click', regenerate);
  $('#aiStackDeploy').addEventListener('click', () => saveAIStack(true));
  $('#aiStackSaveOnly').addEventListener('click', () => saveAIStack(false));
}

function generateAIStack() {
  const n = currentNode();
  if (!n || state.aiStackBusy) return;
  const prompt = ($('#aiStackPrompt').value || '').trim();
  if (!prompt) { toast('先描述一下想装什么', 'error'); return; }
  state.aiStackPrompt = prompt;
  state.aiStackBusy = true;
  state.aiStackError = '';
  state.aiStackResult = null;
  renderPage();
  api('/api/ai/stack', { method: 'POST', body: JSON.stringify({ node_id: n.id, prompt }) }).then(r => {
    state.aiStackResult = r;
  }).catch(e => {
    state.aiStackError = e.message;
    toast(e.message, 'error', 7000);
  }).finally(() => {
    state.aiStackBusy = false;
    if (state.subview && state.subview.type === 'ai-stack') renderPage();
  });
}

async function saveAIStack(deploy) {
  const n = currentNode();
  if (!n) return;
  const name = ($('#aiStackName').value || '').trim();
  const content = $('#aiStackCompose').value;
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(name)) { toast('应用名称仅支持小写字母、数字、- 和 _', 'error'); return; }
  if (!content.trim()) { toast('Compose 内容不能为空', 'error'); return; }
  const btn = deploy ? $('#aiStackDeploy') : $('#aiStackSaveOnly');
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = deploy ? '部署中…' : '保存中…';
  try {
    await api(`/api/nodes/${n.id}/stacks/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    if (deploy) {
      await api(`/api/nodes/${n.id}/stacks/${encodeURIComponent(name)}/action`, {
        method: 'POST',
        body: JSON.stringify({ action: 'up' }),
      });
    }
    toast(deploy ? '已保存并开始启动' : '已保存', 'success', 2200);
    state.subview = null;
    state.aiStackResult = null;
    state.aiStackPrompt = '';
    navigate('apps');
  } catch (e) {
    toast(e.message, 'error', 7000);
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

function settingsPayload(extra) {
  const s = state.settings || {};
  const num = (sel, fallback) => {
    const el = $(sel);
    const v = el ? Number(el.value) : Number(fallback);
    return Number.isFinite(v) ? v : fallback;
  };
  const payload = {
    cpu_alert: num('#thCpu', s.cpu_alert || 90),
    mem_alert: num('#thMem', s.mem_alert || 90),
    disk_alert: num('#thDisk', s.disk_alert || 90),
    daily_report: $('#dailyOn') ? $('#dailyOn').checked : !!s.daily_report,
    daily_hour: num('#dailyHour', s.daily_hour == null ? 8 : s.daily_hour),
    ai_base: $('#aiBase') ? $('#aiBase').value.trim() : (s.ai_base || ''),
    ai_model: $('#aiModel') ? $('#aiModel').value.trim() : (s.ai_model || ''),
  };
  if ($('#webhookUrl') && $('#webhookUrl').value.trim()) payload.webhook = $('#webhookUrl').value.trim();
  if ($('#aiKey') && $('#aiKey').value.trim()) payload.ai_key = $('#aiKey').value.trim();
  return Object.assign(payload, extra || {});
}

async function busyBtn(btn, fn, text) {
  if (!btn || btn.disabled) return;
  const old = btn.textContent;
  btn.disabled = true;
  if (text) btn.textContent = text;
  try { await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}

async function saveSettings(payload, okText) {
  if (![payload.cpu_alert, payload.mem_alert, payload.disk_alert].every(v => v >= 1 && v <= 100)) {
    toast('阈值需在 1-100 之间', 'error');
    return false;
  }
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
    state.settings = Object.assign({}, state.settings, {
      cpu_alert: payload.cpu_alert, mem_alert: payload.mem_alert, disk_alert: payload.disk_alert,
      daily_report: payload.daily_report, daily_hour: payload.daily_hour,
      ai_base: payload.ai_base, ai_model: payload.ai_model,
    });
    if (payload.webhook) state.hasWebhook = true;
    if (payload.clear_webhook) state.hasWebhook = false;
    if (payload.ai_key) state.hasAIKey = true;
    if (payload.clear_ai_key) state.hasAIKey = false;
    toast(okText || '已保存', 'success');
    return true;
  } catch (e) {
    toast(e.message, 'error', 6000);
    return false;
  }
}

function settingHead(icon, title, sub) {
  return `<div class="card-head"><span class="card-ico">${ico(icon)}</span><div class="card-title"><h2>${title}</h2><p class="sub">${sub}</p></div></div>`;
}

function pickModel(models) {
  const prefs = ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o', 'deepseek-chat', 'qwen-plus'];
  for (const p of prefs) {
    const hit = models.find(m => m === p || m.endsWith('/' + p));
    if (hit) return hit;
  }
  const mini = models.find(m => /(^|[-_])mini($|[._-])/i.test(m) && !/embed|tts|whisper|image|dall|audio/i.test(m));
  if (mini) return mini;
  const chat = models.find(m => /chat/i.test(m) && !/embed|tts|whisper|image|dall|audio/i.test(m));
  return chat || models[0] || '';
}

document.addEventListener('mousedown', e => {
  const menu = document.getElementById('aiModelMenu');
  if (!menu || menu.hidden) return;
  if (e.target instanceof Element && e.target.closest('#aiModelCombo')) return;
  menu.hidden = true;
});

function renderSettings() {
  const page = $('#page');
  const hour = Number(state.settings.daily_hour);
  const dailyHour = Number.isFinite(hour) ? hour : 8;
  const hourOptions = Array.from({ length: 24 }, (_, h) =>
    `<option value="${h}" ${h === dailyHour ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('');
  page.innerHTML = `
    <section class="page-head">
      <div><h1>设置</h1><p class="page-sub">告警推送、AI、账号与节点管理</p></div>
      <div class="head-actions">
        <button class="btn sm ghost" data-jump="setNotify">通知</button>
        <button class="btn sm ghost" data-jump="setAI">AI</button>
        <button class="btn sm ghost" data-jump="setNodes">节点</button>
        <button class="btn sm ghost" data-jump="setAudit">日志</button>
      </div>
    </section>
    <div class="settings-cols">
      <div class="settings-col">
        <div class="card settings-card" id="setThresholds">
          ${settingHead('activity', '告警阈值', '超过阈值时节点卡片高亮，并可通过 Webhook 推送')}
          <div class="form-grid three">
            <div class="field"><label>CPU %</label><input type="number" id="thCpu" min="1" max="100" value="${Number(state.settings.cpu_alert) || 90}"></div>
            <div class="field"><label>内存 %</label><input type="number" id="thMem" min="1" max="100" value="${Number(state.settings.mem_alert) || 90}"></div>
            <div class="field"><label>磁盘 %</label><input type="number" id="thDisk" min="1" max="100" value="${Number(state.settings.disk_alert) || 90}"></div>
          </div>
          <button class="btn" id="saveThresholds">保存阈值</button>
        </div>
        <div class="card settings-card" id="setNotify">
          ${settingHead('bell', '通知推送', '阈值告警只推一次，恢复时再通知；支持企业微信、钉钉、飞书、Bark、Server酱等十余种渠道')}
          <div class="form-grid">
            <div class="field full">
              <label>Webhook 地址</label>
              <input type="text" id="webhookUrl" autocomplete="off" placeholder="${state.hasWebhook ? '已配置，留空保持不变' : 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'}">
              <details class="hook-help">
                <summary>各平台 Webhook 格式</summary>
                <div class="hint">企业微信 / 钉钉 / 飞书 / Slack / Discord 粘贴机器人 Webhook；手机推送：Bark 填 https://api.day.app/设备Key，Server酱 填 https://sctapi.ftqq.com/SENDKEY.send，PushPlus 填 https://www.pushplus.plus/send?token=TOKEN，ntfy 填 https://ntfy.sh/主题，Gotify 填 https://你的域名/message?token=TOKEN，Telegram 填 https://api.telegram.org/botTOKEN/sendMessage?chat_id=ID</div>
              </details>
            </div>
            <div class="field"><label>每日早报</label><label class="check"><input type="checkbox" id="dailyOn" ${state.settings.daily_report ? 'checked' : ''}>每天推送节点运行概况</label></div>
            <div class="field"><label>推送时间</label><select id="dailyHour">${hourOptions}</select></div>
          </div>
          <div class="head-actions">
            <button class="btn" id="saveNotify">保存通知设置</button>
            <button class="btn ghost" id="testNotify">测试推送</button>
            ${state.hasWebhook ? '<button class="btn sm ghost" id="clearWebhook">清除 Webhook</button>' : ''}
          </div>
        </div>
      </div>
      <div class="settings-col">
        <div class="card settings-card" id="setAI">
          ${settingHead('spark', 'AI 运维助手', 'OpenAI 兼容接口，Base URL 填到 /v1 为止；Key 只保存在本机配置中')}
          <div class="form-grid">
            <div class="field full">
              <label>Base URL</label>
              <div class="model-row">
                <input type="text" id="aiBase" autocomplete="off" value="${esc(state.settings.ai_base || '')}" placeholder="https://api.example.com/v1">
                <button class="btn sm" id="aiDetect" type="button" title="从 Base URL 拉取可用模型列表">自动检测</button>
              </div>
            </div>
            <div class="field">
              <label>模型</label>
              <div class="combo" id="aiModelCombo">
                <input type="text" id="aiModel" autocomplete="off" value="${esc(state.settings.ai_model || '')}" placeholder="gpt-4o-mini">
                <button type="button" class="combo-btn" id="aiModelToggle" aria-label="从检测结果中选择模型" title="从检测结果中选择模型">${ico('chevron', 'chev')}</button>
                <div class="combo-menu" id="aiModelMenu" hidden></div>
              </div>
            </div>
            <div class="field"><label>API Key</label><input type="password" id="aiKey" autocomplete="new-password" placeholder="${state.hasAIKey ? '已配置，留空保持不变' : 'sk-...'}"></div>
            <div class="hint full" id="aiDetectHint"></div>
          </div>
          <button class="btn" id="saveAI">保存 AI 设置</button>
        </div>
        <div class="card settings-card" id="setPwd">
          ${settingHead('key', '修改密码', state.desktop ? '桌面版已自动登录；设置密码后也可在本机浏览器中登录' : '密码用于登录面板，不会修改服务器 SSH 密码')}
          <div class="form-grid">
            ${state.desktop ? '' : '<div class="field full"><label>当前密码</label><input type="password" id="pwdOld" autocomplete="current-password"></div>'}
            <div class="field"><label>新密码</label><input type="password" id="pwdNew" autocomplete="new-password"></div>
            <div class="field"><label>确认新密码</label><input type="password" id="pwdNew2" autocomplete="new-password"></div>
          </div>
          <button class="btn" id="savePassword">更新密码</button>
        </div>
      </div>
    </div>
    <div class="settings-grid">
      <div class="card settings-card full" id="setNodes">
        ${settingHead('server', '节点管理', '通过 SSH 纳管服务器，无需在目标机器安装 Agent')}
        <div class="node-list" id="nodeList"></div>
        <button class="btn primary" id="addNodeBtn">添加节点</button>
      </div>
      <div class="card settings-card full" id="setAudit">
        ${settingHead('list', '操作日志', '最近 200 条关键操作记录，保存在 data/audit.log')}
        <div class="audit-list" id="auditList"><div class="muted">加载中…</div></div>
        <button class="btn sm ghost" id="auditRefresh">刷新日志</button>
      </div>
      <div class="card settings-card full">
        ${settingHead('info', '关于', `KayPanel ${esc(state.version || 'dev')} · 单二进制多机面板 · SSH 架构，无 Agent`)}
        <div class="info-list">
          <div class="info-row"><span>当前节点</span><span>${state.nodes.length} 台</span></div>
          <div class="info-row"><span>数据目录</span><span>${state.desktop ? 'AppData\\Roaming\\KayPanel' : 'data/'}（config.yaml、audit.log、history.json）</span></div>
          <div class="info-row"><span>手机访问</span><span>浏览器打开面板后选择「添加到主屏幕」即可像 App 一样使用</span></div>
          <div class="info-row"><span>项目仓库</span><span><a href="https://github.com/kaynai1/kaypanel" target="_blank" rel="noreferrer">github.com/kaynai1/kaypanel</a></span></div>
        </div>
      </div>
    </div>`;

  renderNodeList();
  $$('[data-jump]').forEach(b => b.addEventListener('click', () => {
    const el = document.getElementById(b.dataset.jump);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  $('#addNodeBtn').addEventListener('click', () => openNodeForm(null));
  $('#saveThresholds').addEventListener('click', e => busyBtn(e.currentTarget, () => saveSettings(settingsPayload(), '阈值已保存'), '保存中…'));
  $('#saveNotify').addEventListener('click', e => busyBtn(e.currentTarget, () => saveSettings(settingsPayload(), '通知设置已保存'), '保存中…'));
  $('#saveAI').addEventListener('click', e => busyBtn(e.currentTarget, () => saveSettings(settingsPayload(), 'AI 设置已保存'), '保存中…'));
  const modelInput = $('#aiModel');
  const modelMenu = $('#aiModelMenu');
  const modelToggle = $('#aiModelToggle');
  const openModelMenu = (filtered = false) => {
    const q = filtered ? modelInput.value.trim().toLowerCase() : '';
    const list = state.aiModels.filter(m => !q || m.toLowerCase().includes(q));
    modelMenu.innerHTML = !state.aiModels.length
      ? '<div class="combo-empty">还没有检测结果，点击「自动检测」获取模型列表</div>'
      : list.length
        ? list.map(m => `<button type="button" class="combo-item${m === modelInput.value.trim() ? ' active' : ''}" data-model="${esc(m)}">${esc(m)}</button>`).join('')
        : '<div class="combo-empty">没有匹配的模型</div>';
    modelMenu.hidden = false;
  };
  const closeModelMenu = () => { modelMenu.hidden = true; };
  modelToggle.addEventListener('mousedown', e => e.preventDefault());
  modelToggle.addEventListener('click', () => {
    if (modelMenu.hidden) openModelMenu(); else closeModelMenu();
    modelInput.focus();
  });
  modelInput.addEventListener('focus', () => { if (state.aiModels.length) openModelMenu(); });
  modelInput.addEventListener('input', () => { if (state.aiModels.length) openModelMenu(true); });
  modelInput.addEventListener('blur', () => setTimeout(closeModelMenu, 150));
  modelInput.addEventListener('keydown', e => { if (e.key === 'Escape') closeModelMenu(); });
  modelMenu.addEventListener('mousedown', e => {
    const item = e.target.closest('[data-model]');
    if (!item) return;
    e.preventDefault();
    modelInput.value = item.dataset.model;
    closeModelMenu();
  });
  $('#aiDetect').addEventListener('click', async () => {
    const btn = $('#aiDetect');
    const base = $('#aiBase').value.trim();
    if (!base) { toast('请先填写 Base URL', 'error'); return; }
    btn.disabled = true;
    btn.textContent = '检测中…';
    try {
      const key = $('#aiKey').value.trim();
      const d = await api('/api/ai/models', { method: 'POST', body: JSON.stringify({ base_url: base, api_key: key }) });
      const models = (d && d.models) || [];
      state.aiModels = models;
      $('#aiDetectHint').textContent = `已检测到 ${models.length} 个模型，可在「模型」下拉列表中选择`;
      const cur = $('#aiModel').value.trim();
      const pick = !cur || !models.includes(cur) ? pickModel(models) : '';
      if (pick) $('#aiModel').value = pick;
      if (models.length) openModelMenu();
      toast(`检测到 ${models.length} 个模型${pick ? '，已填入 ' + pick : ''}`, 'success', 5000);
    } catch (e) {
      toast(e.message, 'error', 7000);
    }
    btn.disabled = false;
    btn.textContent = '自动检测';
  });
  $('#testNotify').addEventListener('click', async () => {
    const btn = $('#testNotify');
    btn.disabled = true;
    try {
      const hook = $('#webhookUrl').value.trim();
      const d = await api('/api/notify/test', { method: 'POST', body: JSON.stringify(hook ? { webhook: hook } : {}) });
      toast('测试消息已发送', 'success');
    } catch (e) {
      toast(e.message, 'error', 7000);
    }
    btn.disabled = false;
  });
  const clearHook = $('#clearWebhook');
  if (clearHook) clearHook.addEventListener('click', async () => {
    if (!await confirmDialog('清除 Webhook', '清除后阈值告警与每日早报将停止推送，确定继续？', '清除', true)) return;
    if (await saveSettings(settingsPayload({ clear_webhook: true }), 'Webhook 已清除')) renderSettings();
  });
  $('#savePassword').addEventListener('click', e => busyBtn(e.currentTarget, async () => {
    const oldPwd = $('#pwdOld') ? $('#pwdOld').value : '', newPwd = $('#pwdNew').value, newPwd2 = $('#pwdNew2').value;
    if (newPwd.length < 8) { toast('新密码至少 8 位', 'error'); return; }
    if (newPwd !== newPwd2) { toast('两次输入的新密码不一致', 'error'); return; }
    try {
      await api('/api/password', { method: 'POST', body: JSON.stringify({ old: oldPwd, new: newPwd }) });
      toast('密码已更新', 'success');
      if ($('#pwdOld')) $('#pwdOld').value = '';
      $('#pwdNew').value = $('#pwdNew2').value = '';
    } catch (err) { toast(err.message, 'error'); }
  }, '更新中…'));
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
    state.auditAt = Date.now();
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

async function openSSHScanner(onApply, onKey) {
  let data;
  try {
    data = await api('/api/ssh/discover');
  } catch (e) {
    toast(e.message, 'error', 6000);
    return;
  }
  const cands = data.candidates || [];
  const keys = (data.keys || []).filter(k => !k.encrypted);
  const row = (c, i) => {
    const tag = c.key_path ? (c.key_encrypted ? '<span class="ssh-tag warn">私钥有口令</span>' : '<span class="ssh-tag">带私钥</span>') : '';
    const addr = (c.user ? c.user + '@' : '') + c.host + ':' + c.port;
    return `<button type="button" class="ssh-item" data-c="${i}">
      <span class="ssh-src ${c.source === 'config' ? 'cfg' : ''}">${c.source === 'config' ? 'CONFIG' : 'KNOWN'}</span>
      <span class="ssh-main"><b>${esc(c.name)}</b><span class="mono">${esc(addr)}</span>${c.note ? `<span class="ssh-note">${esc(c.note)}</span>` : ''}</span>
      ${tag}
      <span class="ssh-go">填入</span>
    </button>`;
  };
  const cfgRows = cands.map((c, i) => c.source === 'config' ? row(c, i) : '').join('');
  const knownRows = cands.map((c, i) => c.source !== 'config' ? row(c, i) : '').join('');

  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-mask"><div class="modal ssh-modal" role="dialog" aria-modal="true">
    <h3 class="modal-title">识别本机 SSH</h3>
    <p class="modal-desc">扫描目录 <span class="mono">${esc(data.ssh_dir)}</span>，选择后自动填入节点信息</p>
    <div class="ssh-scan-list">
      ${cfgRows ? `<div class="ssh-group-h">~/.ssh/config</div>${cfgRows}` : ''}
      ${knownRows ? `<div class="ssh-group-h">known_hosts</div>${knownRows}` : ''}
      ${!cfgRows && !knownRows ? `<div class="ssh-empty"><b>没有找到可用的主机</b><span>在 ~/.ssh/config 中添加 Host 配置后重新识别，或在下方直接选择本机私钥</span></div>` : ''}
    </div>
    ${keys.length ? `<div class="ssh-keys"><div class="ssh-group-h">本机私钥（仅填入私钥）</div><div class="ssh-key-list">${keys.map((k, i) => `<button type="button" class="ssh-key-chip" data-k="${i}"><b>${esc(k.name)}</b><span class="mono">${esc(k.path)}</span></button>`).join('')}</div></div>` : ''}
    <div class="modal-actions">
      <button class="btn ghost" data-x="close">关闭</button>
      <button class="btn" data-x="reload">重新识别</button>
    </div>
  </div></div>`;

  root.querySelectorAll('[data-c]').forEach(btn => btn.addEventListener('click', () => {
    const c = cands[Number(btn.dataset.c)];
    if (!c) return;
    closeModal();
    onApply(c);
  }));
  root.querySelectorAll('[data-k]').forEach(btn => btn.addEventListener('click', () => {
    const k = keys[Number(btn.dataset.k)];
    if (!k) return;
    closeModal();
    onKey(k.path);
  }));
  root.querySelector('[data-x=close]').onclick = closeModal;
  root.querySelector('[data-x=reload]').onclick = () => { closeModal(); openSSHScanner(onApply, onKey); };
  root.querySelector('.modal-mask').onclick = ev => { if (ev.target.classList.contains('modal-mask')) closeModal(); };
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
      <div class="ssh-scan-bar">
        <div class="ssh-scan-main">
          <span class="ssh-scan-ic" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17h16"/><path d="M7 11.5 10.5 15 7 18.5" transform="translate(0 -4)"/><path d="M12 14.5h5" transform="translate(0 -4)"/></svg>
          </span>
          <div class="ssh-scan-text">
            <b>快速识别本机 SSH</b>
            <span>读取${state.desktop ? '本机' : '面板所在机器'}的 ~/.ssh/config 与 known_hosts，自动填入地址、用户名和私钥</span>
          </div>
        </div>
        <button class="btn sm" id="sshScanBtn" type="button">识别本机 SSH</button>
      </div>
      <div class="form-grid">
        <div class="field full">
          <label>节点类型</label>
          <div class="radio-row">
            <label><input type="radio" name="nodeMode" value="server" ${!n || !n.sftp_only ? 'checked' : ''}> Linux 服务器（SSH）</label>
            <label><input type="radio" name="nodeMode" value="vhost" ${n && n.sftp_only ? 'checked' : ''}> 虚拟主机（仅文件）</label>
          </div>
          <div class="hint hidden" id="vhostHint">虚拟主机通过 SFTP 登录，只启用文件管理；系统监控、容器、终端和应用部署不可用。</div>
        </div>
        <div class="field"><label>节点名称</label><input type="text" id="nodeName" value="${esc(n ? n.name : '')}" placeholder="如 kaynai NAS"></div>
        <div class="field"><label>SSH 地址</label><input type="text" id="nodeAddr" value="${esc(n ? n.addr : '')}" placeholder="192.168.5.50:22"></div>
        <div class="field"><label>SSH 用户名</label><input type="text" id="nodeUser" value="${esc(n ? n.user : '')}" placeholder="root"></div>
        <div class="field">
          <label>认证方式</label>
          <div class="radio-row">
            <label><input type="radio" name="authType" value="key" ${!n || n.auth_type === 'key' ? 'checked' : ''}> 私钥</label>
            <label><input type="radio" name="authType" value="password" ${n && n.auth_type === 'password' ? 'checked' : ''}> 密码</label>
            <label><input type="radio" name="authType" value="none" ${n && n.auth_type === 'none' ? 'checked' : ''}> 无认证</label>
          </div>
        </div>
        <div class="field full" id="keyField">
          <label>SSH 私钥</label>
          <div class="key-picked hidden" id="pickedKey">
            <div class="key-picked-main">
              <b id="pickedKeyName"></b>
              <span class="mono" id="pickedKeyPath"></span>
            </div>
            <button class="btn sm ghost" id="clearPickedKey" type="button">取消</button>
          </div>
          <textarea id="nodeKey" class="keyarea" spellcheck="false" placeholder="${editing ? '留空表示不修改已保存的私钥' : '-----BEGIN OPENSSH PRIVATE KEY-----'}">${n && n.has_key ? '' : ''}</textarea>
          <div class="hint">${editing && n.has_key ? '已保存私钥，留空保持不变；可粘贴新私钥覆盖' : '粘贴 OpenSSH / PEM 格式私钥，或点击上方「识别本机 SSH」导入'}</div>
        </div>
        <div class="field full hidden" id="passwordField">
          <label>SSH 密码</label>
          <input type="password" id="nodePassword" autocomplete="new-password" placeholder="${editing && n.has_password ? '留空表示不修改已保存的密码' : 'SSH 登录密码'}">
        </div>
        <div class="field full hidden" id="noneField">
          <div class="hint">主机只认用户名、不校验密码或密钥（如 Instabox 的 ibssh_… 用户名）。连接时不会发送任何凭据。</div>
        </div>
        <div class="field full">
          <label class="check-row"><input type="checkbox" id="nodeSkipHostKey" ${n && n.skip_host_key ? 'checked' : ''}> 跳过主机指纹校验</label>
          <div class="hint">仅用于 Instabox 这类每次连接指纹都会变化的主机；开启后不再校验主机身份。</div>
        </div>
        <div class="field full" id="autoWakeField">
          <label class="check-row"><input type="checkbox" id="nodeAutoWake" ${n && n.auto_wake ? 'checked' : ''}> Instabox 自动唤醒</label>
          <div class="hint">面板运行期间定期续租防止空闲休眠；机器已休眠时自动调用 Instabox 官方接口唤醒，约 1 分钟内重新上线。</div>
        </div>
        <div class="field full hidden" id="ibKeyField">
          <label>Instabox API Key</label>
          <input type="password" id="nodeIBKey" autocomplete="new-password" placeholder="${editing && n.has_instabox_key ? '已保存，留空保持不变' : 'ibk_…（在 dashboard.instabox.sh → API Keys 创建）'}">
          <div class="hint">API Key 需包含读写权限，创建地址 https://dashboard.instabox.sh/dashboard/api-keys；Key 只保存在面板数据目录。</div>
        </div>
        <div class="field full hidden" id="ibMachineField">
          <label>Instabox 机器 ID</label>
          <div class="inline-row">
            <input type="text" id="nodeIBMachine" value="${esc(n ? n.instabox_machine_id : '')}" placeholder="m_xxxxx">
            <button class="btn sm" id="ibMachinesBtn" type="button">读取机器列表</button>
          </div>
          <select id="ibMachineSelect" class="hidden"></select>
          <div class="hint">点「读取机器列表」会用上面的 Key 查询账号下的机器，选中后自动填入 ID。</div>
        </div>
        <div class="field"><label>文件根目录</label><input type="text" id="nodeFileRoot" value="${esc(n ? n.file_root : '/')}" placeholder="/ 或 /vol1"></div>
        <div class="field" id="stacksDirField"><label>Compose 应用目录</label><input type="text" id="nodeStacksDir" value="${esc(n ? n.stacks_dir : '')}" placeholder="留空使用 ~/kaypanel/stacks"></div>
        <div class="field full" id="sudoToggleField">
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
    $('#noneField').classList.toggle('hidden', type !== 'none');
  };
  $$('input[name=authType]').forEach(r => r.addEventListener('change', syncAuth));
  syncAuth();
  const syncSudo = () => $('#sudoField').classList.toggle('hidden', !$('#nodeSudo').checked);
  $('#nodeSudo').addEventListener('change', syncSudo);
  syncSudo();

  const syncWake = () => {
    const on = $('#nodeAutoWake').checked;
    $('#ibKeyField').classList.toggle('hidden', !on);
    $('#ibMachineField').classList.toggle('hidden', !on);
  };
  $('#nodeAutoWake').addEventListener('change', syncWake);
  syncWake();

  const syncMode = () => {
    const vhost = $('input[name=nodeMode]:checked').value === 'vhost';
    $('#vhostHint').classList.toggle('hidden', !vhost);
    $('#stacksDirField').classList.toggle('hidden', vhost);
    $('#sudoToggleField').classList.toggle('hidden', vhost);
    $('#autoWakeField').classList.toggle('hidden', vhost);
    if (vhost) {
      $('#sudoField').classList.add('hidden');
      $('#ibKeyField').classList.add('hidden');
      $('#ibMachineField').classList.add('hidden');
    } else {
      syncSudo();
      syncWake();
    }
  };
  $$('input[name=nodeMode]').forEach(r => r.addEventListener('change', syncMode));
  syncMode();

  $('#ibMachinesBtn').addEventListener('click', async () => {
    const btn = $('#ibMachinesBtn');
    const key = $('#nodeIBKey').value.trim();
    if (!key && !(editing && n.has_instabox_key)) {
      toast('请先填写 Instabox API Key', 'error');
      return;
    }
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '读取中…';
    try {
      const d = await api('/api/instabox/machines', {
        method: 'POST',
        body: JSON.stringify({ api_key: key, node_id: editing ? n.id : '' }),
      });
      const list = d.machines || [];
      if (!list.length) {
        toast('该账号下没有机器', 'error');
        return;
      }
      const sel = $('#ibMachineSelect');
      sel.innerHTML = list.map(m => `<option value="${esc(m.id)}">${esc(m.name || m.id)} · ${esc(m.state || '未知状态')} · ${esc(m.id)}</option>`).join('');
      sel.classList.remove('hidden');
      sel.onchange = () => { $('#nodeIBMachine').value = sel.value; };
      if (list.length === 1) $('#nodeIBMachine').value = list[0].id;
      toast(`已读取 ${list.length} 台机器`, 'success');
    } catch (e) {
      toast(e.message || '读取机器列表失败', 'error', 6500);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  let pickedKeyPath = '';
  const setPickedKey = path => {
    pickedKeyPath = path || '';
    const box = $('#pickedKey');
    if (!box) return;
    box.classList.toggle('hidden', !pickedKeyPath);
    if (pickedKeyPath) {
      const name = $('#pickedKeyName');
      name.textContent = pickedKeyPath.split(/[\\/]/).pop();
      name.title = pickedKeyPath;
      $('#pickedKeyPath').textContent = pickedKeyPath;
    }
  };
  $('#clearPickedKey').addEventListener('click', () => setPickedKey(''));
  $('#nodeKey').addEventListener('input', () => {
    if ($('#nodeKey').value.trim()) setPickedKey('');
  });

  const applySSHKey = path => {
    const rad = $('input[name=authType][value=key]');
    rad.checked = true;
    rad.dispatchEvent(new Event('change', { bubbles: true }));
    setPickedKey(path);
    toast('已选择本机私钥，保存时自动读取', 'success');
  };
  const applySSHCandidate = c => {
    $('#nodeName').value = c.name || c.host;
    $('#nodeAddr').value = c.host + (c.port && c.port !== 22 ? ':' + c.port : '');
    $('#nodeUser').value = c.user || '';
    if (c.key_path) {
      if (c.key_encrypted) {
        toast('该私钥有口令保护，已跳过；请改用密码或粘贴无口令私钥', 'error', 6500);
        return;
      }
      applySSHKey(c.key_path);
    } else {
      toast('已填入主机信息，请补充登录凭据后保存', 'success', 5000);
    }
  };
  $('#sshScanBtn').addEventListener('click', () => openSSHScanner(applySSHCandidate, applySSHKey));

  const collect = () => ({
    name: $('#nodeName').value.trim(),
    addr: $('#nodeAddr').value.trim(),
    user: $('#nodeUser').value.trim(),
    auth_type: $('input[name=authType]:checked').value,
    private_key: $('#nodeKey') ? $('#nodeKey').value : '',
    key_path: $('#nodeKey') && $('#nodeKey').value.trim() ? '' : pickedKeyPath,
    password: $('#nodePassword') ? $('#nodePassword').value : '',
    sudo: $('#nodeSudo').checked,
    sudo_password: $('#nodeSudoPwd').value,
    skip_host_key: $('#nodeSkipHostKey').checked,
    sftp_only: $('input[name=nodeMode]:checked').value === 'vhost',
    auto_wake: $('#nodeAutoWake').checked,
    instabox_api_key: $('#nodeIBKey').value.trim(),
    instabox_machine_id: $('#nodeIBMachine').value.trim(),
    file_root: $('#nodeFileRoot').value.trim() || '/',
    stacks_dir: $('#nodeStacksDir').value.trim(),
  });

  const save = async (test) => {
    const payload = collect();
    if (!payload.name) { toast('请填写节点名称', 'error'); return; }
    if (!payload.addr) { toast('请填写 SSH 地址', 'error'); return; }
    if (!payload.user) { toast('请填写 SSH 用户名', 'error'); return; }
    if (!editing && payload.auth_type === 'key' && !payload.private_key.trim() && !payload.key_path) { toast('请粘贴 SSH 私钥或选择本机私钥', 'error'); return; }
    if (!editing && payload.auth_type === 'password' && !payload.password) { toast('请填写 SSH 密码', 'error'); return; }
    if (payload.auto_wake) {
      if (!payload.instabox_machine_id) { toast('请填写 Instabox 机器 ID', 'error'); return; }
      if (!payload.instabox_api_key && !(editing && n.has_instabox_key)) { toast('请填写 Instabox API Key', 'error'); return; }
    }
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

/* ---------- batch 2: security, cost, netmatrix, probes, changes, batch ---------- */

const SEC_LEVEL_LABELS = { critical: '严重', high: '高风险', medium: '中风险', low: '低风险', info: '提示' };
const SEC_GRADE_TONES = { '优秀': 'ok', '良好': 'good', '一般': 'fair', '需关注': 'bad', '离线': 'off', '不扫描': 'info', '扫描失败': 'bad' };
const SEC_GRADE_COLORS = { '优秀': '#16a34a', '良好': '#2563eb', '一般': '#d97706', '需关注': '#dc2626', '离线': '#64748b', '不扫描': '#0891b2', '扫描失败': '#dc2626' };

function secTone(grade) { return SEC_GRADE_TONES[grade] || 'off'; }
function secGradeColor(grade) { return SEC_GRADE_COLORS[grade] || '#64748b'; }
function secLevelLabel(lv) { return SEC_LEVEL_LABELS[lv] || '提示'; }
function fmtMoney(v) { return '¥' + (Number(v) || 0).toFixed(2); }

function secRootText(v) {
  switch (v) {
    case 'yes': case 'true': return '允许';
    case 'no': case 'false': return '禁止';
    case 'prohibit-password': case 'without-password': return '仅密钥';
    case 'forced-commands-only': return '仅命令';
    default: return v || '—';
  }
}

function loadSecurity(force) {
  if (state.securityBusy) return;
  state.securityBusy = true;
  state.securityError = '';
  if (state.page === 'security' && !state.subview) renderPage();
  api('/api/security').then(d => {
    state.security = d;
  }).catch(e => {
    state.securityError = e.message;
    if (force) toast(e.message, 'error');
  }).finally(() => {
    state.securityBusy = false;
    if (state.page === 'security' && !state.subview) renderPage();
  });
  if (force) toast('正在重新体检…', '', 1600);
}

function secIssueHTML(is) {
  return `<div class="sec-issue">
    <span class="lv sec-lv-${esc(is.level)}">${secLevelLabel(is.level)}</span>
    <div class="main"><b>${esc(is.title)}</b>${is.detail ? `<span>${esc(is.detail)}</span>` : ''}${is.fix ? `<em>建议：${esc(is.fix)}</em>` : ''}</div>
  </div>`;
}

function secNodeCard(it) {
  const head = `<div class="sec-head">
    <span class="avatar" style="background:${avatarColor(it.id)}">${esc(initialOf(it.name))}</span>
    <div class="sec-head-main"><b>${esc(it.name)}</b><span>${esc(it.user || '')}@${esc(it.addr)}</span></div>
    <div class="sec-score"><b style="color:${secGradeColor(it.grade)}">${it.sftp_only ? '—' : it.score}</b><span>${esc(it.grade)}</span></div>
  </div>`;
  if (it.sftp_only) {
    return `<div class="card sec-card">${head}<div class="sec-issues"><div class="sec-issue">
      <span class="lv sec-lv-info">提示</span>
      <div class="main"><b>跳过安全扫描</b><span>SFTP 虚拟主机无法读取系统配置，建议在服务商控制台检查安全组与密钥。</span></div>
    </div></div></div>`;
  }
  if (!it.online) {
    return `<div class="card sec-card">${head}<div class="sec-issues">${(it.issues || []).map(secIssueHTML).join('') ||
      '<div class="sec-issue"><span class="lv sec-lv-low">低风险</span><div class="main"><b>节点离线</b><span>无法连接，体检未执行</span></div></div>'}</div></div>`;
  }
  const facts = [
    ['SSH 端口', it.ssh_port || '—', ''],
    ['root 登录', secRootText(it.root_login), it.root_login === 'yes' ? 'warn' : ''],
    ['密码登录', it.password_auth === 'yes' ? '开启' : it.password_auth === 'no' ? '关闭' : (it.password_auth || '—'), it.password_auth === 'yes' ? 'warn' : ''],
    ['防火墙', it.firewall === 'active' ? '已启用' : it.firewall === 'inactive' ? '未启用' : '未知', it.firewall === 'inactive' ? 'warn' : ''],
    ['公网容器端口', String(it.public_ports || 0), it.public_ports > 0 ? 'warn' : ''],
    ['证书剩余', it.cert_days > 0 ? it.cert_days + ' 天' : '未检测到', it.cert_days > 0 && it.cert_days < 30 ? 'warn' : ''],
  ];
  const issues = (it.issues || []).length
    ? it.issues.map(secIssueHTML).join('')
    : `<div class="sec-issue"><span class="lv sec-lv-info">通过</span><div class="main"><b>未发现明显风险</b><span>保持定期体检与系统更新。</span></div></div>`;
  return `<div class="card sec-card">${head}
    <div class="sec-facts">${facts.map(([label, value, cls]) => `<div class="sec-fact"><span>${label}</span><b class="${cls}">${esc(value)}</b></div>`).join('')}</div>
    <div class="sec-issues">${issues}</div>
  </div>`;
}

function secReportHTML(d) {
  const counts = d.counts || {};
  const chip = g => `<span class="sec-count tone-${secTone(g)}"><i></i>${esc(g)} <b>${counts[g] || 0}</b></span>`;
  return `<div class="card sec-hero">
    <div class="insp-ring" style="--pct:${Math.max(0, Math.min(100, d.average))};--tone:${secGradeColor(d.grade)}">
      <div class="insp-ring-in"><b>${d.average}</b><span>平均安全分</span></div>
    </div>
    <div class="sec-hero-main">
      <div class="sec-hero-title">整体安全态势 <span class="insp-pill tone-${secTone(d.grade)}">${esc(d.grade)}</span></div>
      <p class="page-sub" style="margin-top:8px">${d.total} 台节点，${d.online} 台在线。评分从 100 起按风险项扣分，SFTP 虚拟主机不参与扫描。</p>
      <div class="sec-counts">${['优秀', '良好', '一般', '需关注'].map(chip).join('')}</div>
    </div>
    <div class="insp-time">体检时间<br><b>${fmtTime(d.time)}</b></div>
  </div>
  <div class="sec-grid">${(d.nodes || []).map(secNodeCard).join('') || '<div class="card empty"><h3>还没有节点</h3><p>添加服务器后即可体检</p></div>'}</div>
  <p class="stock-note">安全体检只读取配置，不会修改任何系统设置；修复项请人工确认后执行。</p>`;
}

function renderSecurity() {
  const page = $('#page');
  if (!page) return;
  const d = state.security;
  page.innerHTML = `
    <section class="page-head">
      <div><h1>安全体检</h1><p class="page-sub">检查 SSH 配置、防火墙、暴露端口与证书有效期，给出可执行的修复建议</p></div>
      <div class="head-actions"><button class="btn sm ghost" id="secRefresh" ${state.securityBusy ? 'disabled' : ''}>${d ? '重新体检' : '开始体检'}</button></div>
    </section>
    ${state.securityBusy && !d ? '<div class="card empty"><h3>正在体检…</h3><p>并发读取每台节点的 SSH、防火墙与证书信息，约需 10-30 秒</p></div>' : ''}
    ${state.securityError && !d ? `<div class="card empty"><h3>体检失败</h3><p>${esc(state.securityError)}</p></div>` : ''}
    ${d ? secReportHTML(d) : ''}`;
  $('#secRefresh').addEventListener('click', () => loadSecurity(true));
  if (!d && !state.securityBusy && !state.securityError) setTimeout(() => { if (state.page === 'security' && !state.subview) loadSecurity(false); }, 0);
}

function loadCost(force) {
  if (state.costBusy) return;
  state.costBusy = true;
  state.costError = '';
  if (state.page === 'cost' && !state.subview) renderPage();
  api('/api/cost').then(d => {
    state.cost = d;
  }).catch(e => {
    state.costError = e.message;
    if (force) toast(e.message, 'error');
  }).finally(() => {
    state.costBusy = false;
    if (state.page === 'cost' && !state.subview) renderPage();
  });
}

function costRowHTML(n) {
  const money = v => n.watts > 0 ? fmtMoney(v) : '—';
  return `<tr>
    <td><div class="cost-node-name"><span class="avatar" style="background:${avatarColor(n.id)}">${esc(initialOf(n.name))}</span>
      <div><b>${esc(n.name)}</b><div class="chg-sub">${n.sftp_only ? '虚拟主机' : n.online ? '在线' : '离线'}</div></div></div></td>
    <td>${n.sftp_only ? '<span class="muted">—</span>' : `<input class="cost-watts" type="number" min="0" max="5000" step="1" value="${n.watts || ''}" placeholder="0" data-power-node="${esc(n.id)}">`}</td>
    <td class="num">${n.watts > 0 ? (Number(n.kwh_day) || 0).toFixed(2) + ' kWh' : '—'}</td>
    <td class="num">${money(n.cost_day)}</td>
    <td class="num">${money(n.cost_month)}</td>
    <td class="num">${money(n.cost_year)}</td>
    <td class="num">${n.sftp_only ? '' : `<button class="btn sm ghost watt-save" data-power-save="${esc(n.id)}">保存</button>`}</td>
  </tr>`;
}

function renderCost() {
  const page = $('#page');
  if (!page) return;
  const d = state.cost;
  page.innerHTML = `
    <section class="page-head">
      <div><h1>成本电费账本</h1><p class="page-sub">给每台节点填上功率，自动估算每天、每月、每年的电费</p></div>
      <div class="head-actions"><button class="btn sm ghost" id="costRefresh">刷新</button></div>
    </section>
    ${!d ? `<div class="card empty">${state.costBusy ? '正在计算…' : state.costError ? esc(state.costError) : '暂无数据'}</div>` : `
    <div class="card cost-price">
      <div class="field"><label>电价（元 / 度）</label><input id="costPrice" type="number" step="0.01" min="0.05" max="20" value="${d.price}"></div>
      <button class="btn primary" id="costPriceSave">保存电价</button>
      <span class="muted">国内居民电价通常在 0.5-0.8 元/度，可按实际账单调整</span>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">总功耗</div><div class="stat-value">${d.total_watts}<small>W</small></div><div class="stat-sub">${d.configured} 台已配置 / ${d.unconfigured} 台待填</div></div>
      <div class="stat-card"><div class="stat-label">今日用电</div><div class="stat-value">${d.kwh_today}<small>kWh</small></div><div class="stat-sub">按当前功率估算</div></div>
      <div class="stat-card"><div class="stat-label">今日电费</div><div class="stat-value">${fmtMoney(d.cost_today)}</div><div class="stat-sub">${d.price} 元/度</div></div>
      <div class="stat-card"><div class="stat-label">本月 / 全年</div><div class="stat-value">${fmtMoney(d.cost_month)}</div><div class="stat-sub">全年约 ${fmtMoney(d.cost_year)}</div></div>
    </div>
    <div class="card table-wrap">
      <table class="table">
        <thead><tr><th>节点</th><th>功率（W）</th><th class="num">日耗电</th><th class="num">日费用</th><th class="num">月费用</th><th class="num">年费用</th><th></th></tr></thead>
        <tbody>${(d.nodes || []).map(costRowHTML).join('') || '<tr><td colspan="7" class="muted">尚未添加节点</td></tr>'}</tbody>
      </table>
    </div>
    <p class="stock-note">耗电按 24 小时满载估算，实际功耗会随负载浮动；未配置功率的节点不计入合计。</p>`}`;
  $('#costRefresh').addEventListener('click', () => loadCost(true));
  if (d) {
    $('#costPriceSave').addEventListener('click', async () => {
      const price = Number($('#costPrice').value);
      if (!(price >= 0.05 && price <= 20)) return toast('电价需在 0.05-20 元/度之间', 'error');
      const btn = $('#costPriceSave');
      btn.disabled = true;
      try {
        await api('/api/cost/price', { method: 'POST', body: JSON.stringify({ price }) });
        toast('电价已保存', 'success');
        loadCost(true);
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    });
    $$('[data-power-save]', page).forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.powerSave;
      const input = $(`.cost-watts[data-power-node="${id}"]`, page);
      if (!input) return;
      const watts = Number(input.value) || 0;
      btn.disabled = true;
      try {
        await api('/api/nodes/' + encodeURIComponent(id) + '/power', { method: 'POST', body: JSON.stringify({ watts }) });
        toast('功率已保存', 'success');
        loadCost(true);
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    }));
  } else if (!state.costBusy && !state.costError) {
    setTimeout(() => { if (state.page === 'cost' && !state.subview) loadCost(false); }, 0);
  }
}

function loadNetMatrix(force) {
  if (state.netmatrixBusy) return;
  state.netmatrixBusy = true;
  state.netmatrixError = '';
  if (state.page === 'netmatrix' && !state.subview) renderPage();
  api('/api/netmatrix').then(d => {
    state.netmatrix = d;
  }).catch(e => {
    state.netmatrixError = e.message;
    if (force) toast(e.message, 'error');
  }).finally(() => {
    state.netmatrixBusy = false;
    if (state.page === 'netmatrix' && !state.subview) renderPage();
  });
  if (force) toast('正在从各节点互相 ping…', '', 2000);
}

function nmCellHTML(i, j, nodes, latency, loss) {
  if (i === j) return '<td class="nm-self">—</td>';
  const a = nodes[i] || {}, b = nodes[j] || {};
  if (!a.online || !b.online) return '<td><span class="nm-cell nm-off"><b>—</b><span>离线</span></span></td>';
  const lat = latency[i] ? latency[i][j] : -1;
  const ls = loss[i] ? loss[i][j] : -1;
  if (lat == null || lat < 0) {
    return `<td><span class="nm-cell nm-bad"><b>不可达</b><span>${ls > 0 ? ls.toFixed(0) + '% 丢包' : '无响应'}</span></span></td>`;
  }
  let cls = 'nm-good';
  if (lat >= 120 || ls >= 20) cls = 'nm-bad';
  else if (lat >= 40 || ls > 0) cls = 'nm-warn';
  else if (lat >= 20) cls = 'nm-mid';
  return `<td><span class="nm-cell ${cls}"><b>${lat.toFixed(1)}ms</b><span>${Math.max(0, ls).toFixed(0)}% 丢包</span></span></td>`;
}

function netMatrixHTML(d) {
  const nodes = d.nodes || [];
  const latency = d.latency || [];
  const loss = d.loss || [];
  if (!nodes.length) return '<div class="card empty"><h3>还没有节点</h3><p>至少添加两台物理机才能测量节点间网络质量</p></div>';
  const head = nodes.map(n => `<th class="${n.online ? '' : 'nm-th-off'}">${esc(n.name)}</th>`).join('');
  const rows = nodes.map((n, i) => `<tr><th>${esc(n.name)}</th>${nodes.map((m, j) => nmCellHTML(i, j, nodes, latency, loss)).join('')}</tr>`).join('');
  const online = nodes.filter(n => n.online).length;
  return `<div class="card table-wrap nm-wrap">
    <div class="nm-head"><b>节点互通矩阵</b><span>每格为源节点 → 目标节点的 ping 延迟 / 丢包，最多同时测量 8 台在线节点</span></div>
    <table class="table nm-table"><thead><tr><th>源 \\ 目标</th>${head}</tr></thead><tbody>${rows}</tbody></table>
  </div>
  <div class="nm-legend">
    <span><i class="nm-good"></i>&lt; 20ms 极佳</span>
    <span><i class="nm-mid"></i>20-40ms 良好</span>
    <span><i class="nm-warn"></i>40-120ms 偏慢</span>
    <span><i class="nm-bad"></i>丢包 / 不可达</span>
    <span class="muted">${online}/${nodes.length} 台在线</span>
  </div>
  <p class="stock-note">测量从各节点服务器发起，反映真实机器间的网络路径；需要节点安装 iputils-ping（多数系统已自带）。</p>`;
}

function renderNetMatrix() {
  const page = $('#page');
  if (!page) return;
  const d = state.netmatrix;
  page.innerHTML = `
    <section class="page-head">
      <div><h1>网络质量矩阵</h1><p class="page-sub">让每台服务器互相 ping，一眼看出机房内网与跨区域的延迟、丢包</p></div>
      <div class="head-actions"><button class="btn sm ghost" id="nmRefresh" ${state.netmatrixBusy ? 'disabled' : ''}>${state.netmatrixBusy ? '测量中…' : '重新测量'}</button></div>
    </section>
    ${state.netmatrixBusy && !d ? '<div class="card empty"><h3>正在测量…</h3><p>每台节点依次 ping 其他节点，约需 10-40 秒</p></div>' : ''}
    ${state.netmatrixError && !d ? `<div class="card empty"><h3>测量失败</h3><p>${esc(state.netmatrixError)}</p></div>` : ''}
    ${d ? netMatrixHTML(d) : ''}`;
  $('#nmRefresh').addEventListener('click', () => loadNetMatrix(true));
  if (!d && !state.netmatrixBusy && !state.netmatrixError) setTimeout(() => { if (state.page === 'netmatrix' && !state.subview) loadNetMatrix(false); }, 0);
}

function loadProbes(force) {
  if (state.probesBusy) return;
  state.probesBusy = true;
  state.probesError = '';
  api('/api/probes').then(d => {
    state.probes = d;
  }).catch(e => {
    state.probesError = e.message;
    if (force) toast(e.message, 'error');
  }).finally(() => {
    state.probesBusy = false;
    if (state.page === 'probes' && !state.subview) renderPage();
  });
}

function probeSparkHTML(checks) {
  const list = (checks || []).slice(-40);
  if (!list.length) return '<span class="muted" style="font-size:11.5px">等待首次检查…</span>';
  return list.map(c => `<i class="${c.ok ? 'ok' : 'bad'}" title="${esc(fmtTime(c.time))} · ${c.ok ? '正常' : esc(c.error || '异常')} · ${c.latency_ms}ms"></i>`).join('');
}

function probeCardHTML(t) {
  const has = (t.checks || []).length > 0;
  const cls = !has ? 'idle' : t.up ? 'up' : 'down';
  const status = !has ? '待检测' : t.up ? '正常' : '异常';
  const lat = has ? `${t.latency_ms || 0} ms` : '—';
  const uptime = has ? `${(Number(t.uptime) || 0).toFixed(1)}%` : '—';
  return `<div class="card probe-card">
    <div class="probe-head">
      <span class="probe-dot ${cls}"></span>
      <span class="probe-name">${esc(t.name)}</span>
      <span class="probe-type">${esc(String(t.type || 'http').toUpperCase())}</span>
      <span class="insp-pill tone-${cls === 'up' ? 'ok' : cls === 'down' ? 'bad' : 'off'}">${status}</span>
    </div>
    <div class="probe-url" title="${esc(t.url)}">${esc(t.url)}</div>
    <div class="probe-meta"><span>24h 可用率 <b>${uptime}</b></span><span>最近延迟 <b>${lat}</b></span><span>间隔 <b>${t.interval}s</b></span></div>
    <div class="probe-spark">${probeSparkHTML(t.checks)}</div>
    <div class="probe-actions">
      <button class="btn sm ghost" data-probe-check="${esc(t.id)}">立即检查</button>
      <button class="btn sm danger" data-probe-del="${esc(t.id)}" data-probe-name="${esc(t.name)}">删除</button>
    </div>
  </div>`;
}

function renderProbes() {
  const page = $('#page');
  if (!page) return;
  const d = state.probes;
  const list = (d && d.targets) || [];
  page.innerHTML = `
    <section class="page-head">
      <div><h1>网站拨测</h1><p class="page-sub">从面板所在机器监控 HTTP / TCP 可用性，公开状态页可直接分享给用户</p></div>
      <div class="head-actions">
        <a class="btn sm ghost" href="/status" target="_blank" rel="noopener">打开状态页</a>
        <button class="btn sm ghost" id="probeRefresh">刷新</button>
      </div>
    </section>
    <div class="card pr-form">
      <div class="field"><label>名称</label><input id="prName" maxlength="40" placeholder="博客首页"></div>
      <div class="field"><label>类型</label><select id="prType"><option value="http">HTTP</option><option value="tcp">TCP</option></select></div>
      <div class="field"><label>地址</label><input id="prUrl" spellcheck="false" placeholder="https://example.com 或 1.2.3.4:443"></div>
      <div class="field"><label>间隔（秒）</label><input id="prInterval" type="number" min="30" max="3600" value="60"></div>
      <button class="btn primary" id="probeAdd">${ico('plus')}添加</button>
    </div>
    ${state.probesBusy && !d ? '<div class="card empty">正在读取拨测状态…</div>' : ''}
    ${state.probesError && !d ? `<div class="card empty">${esc(state.probesError)}</div>` : ''}
    <div class="pr-grid" id="probeList">${list.map(probeCardHTML).join('') || (d ? '<div class="card empty"><h3>还没有拨测目标</h3><p>添加一个网址或端口，开始记录可用率</p></div>' : '')}</div>
    <p class="stock-note">拨测由面板本机发起，不消耗节点流量；24 小时可用率按检查次数计算，数据保留 7 天。</p>`;
  $('#probeRefresh').addEventListener('click', () => loadProbes(true));
  $('#probeAdd').addEventListener('click', async () => {
    const name = $('#prName').value.trim();
    const type = $('#prType').value;
    const url = $('#prUrl').value.trim();
    const interval = Number($('#prInterval').value) || 60;
    if (!url) return toast('请填写监控地址', 'error');
    const btn = $('#probeAdd');
    btn.disabled = true;
    try {
      await api('/api/probes', { method: 'POST', body: JSON.stringify({ name, type, url, interval }) });
      toast('已添加，正在执行首次检查', 'success');
      state.probes = null;
      loadProbes(true);
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  });
  $('#probeList').addEventListener('click', async e => {
    const check = e.target.closest('[data-probe-check]');
    const del = e.target.closest('[data-probe-del]');
    if (check) {
      check.disabled = true;
      check.textContent = '检查中…';
      try {
        await api('/api/probes/' + encodeURIComponent(check.dataset.probeCheck) + '/check', { method: 'POST', body: '{}' });
        loadProbes(true);
      } catch (err) { toast(err.message, 'error'); check.disabled = false; check.textContent = '立即检查'; }
    } else if (del) {
      const ok = await confirmDialog('删除拨测目标？', del.dataset.probeName + ' 的历史检查记录会一并删除。', '删除', true);
      if (!ok) return;
      try {
        await api('/api/probes/' + encodeURIComponent(del.dataset.probeDel), { method: 'DELETE' });
        toast('已删除', 'success');
        loadProbes(true);
      } catch (err) { toast(err.message, 'error'); }
    }
  });
  if (!d && !state.probesBusy && !state.probesError) setTimeout(() => { if (state.page === 'probes' && !state.subview) loadProbes(false); }, 0);
}

function loadChanges(force) {
  if (state.changesBusy) return;
  state.changesBusy = true;
  state.changesError = '';
  api('/api/changes').then(d => {
    state.changes = d;
  }).catch(e => {
    state.changesError = e.message;
    if (force) toast(e.message, 'error');
  }).finally(() => {
    state.changesBusy = false;
    if (state.page === 'changes' && !state.subview) renderPage();
  });
}

function changeKindLabel(kind) {
  return { stack: '应用', file: '文件' }[kind] || kind;
}

function changeSize(v) {
  v = Number(v) || 0;
  return v >= 1024 ? (v / 1024).toFixed(1) + ' KB' : v + ' B';
}

function changeRowHTML(c) {
  const status = c.rolled_back ? '已回滚' : c.restorable ? '可回滚' : '无旧版本';
  return `<tr>
    <td><div>${timeAgo(c.time)}</div><div class="chg-sub">${fmtTime(c.time)}</div></td>
    <td>${esc(c.node_name || '')}</td>
    <td><span class="chg-kind ${c.kind === 'file' ? 'file' : ''}">${changeKindLabel(c.kind)}</span></td>
    <td><div class="chg-target" title="${esc(c.target)}">${esc(c.target)}</div><div class="chg-sub">${esc(c.summary || '')}</div></td>
    <td class="num">${changeSize(c.before_size)} → ${changeSize(c.after_size)}</td>
    <td><span class="chg-status ${c.rolled_back || !c.restorable ? 'off' : 'ok'}">${status}</span></td>
    <td class="num">
      <button class="btn sm ghost" data-chg-view="${esc(c.id)}">查看</button>
      ${c.restorable && !c.rolled_back ? `<button class="btn sm danger" data-chg-rollback="${esc(c.id)}" data-chg-target="${esc(c.target)}">回滚</button>` : ''}
    </td>
  </tr>`;
}

function renderChanges() {
  const page = $('#page');
  if (!page) return;
  const d = state.changes;
  const list = (d && d.changes) || [];
  page.innerHTML = `
    <section class="page-head">
      <div><h1>变更记录</h1><p class="page-sub">保存应用与文件的修改前后内容，改坏了可以一键回滚</p></div>
      <div class="head-actions"><button class="btn sm ghost" id="chgRefresh">刷新</button></div>
    </section>
    ${state.changesBusy && !d ? '<div class="card empty">正在读取变更记录…</div>' : ''}
    ${state.changesError && !d ? `<div class="card empty">${esc(state.changesError)}</div>` : ''}
    ${d ? `<div class="card table-wrap">
      <table class="table" id="chgTable">
        <thead><tr><th>时间</th><th>节点</th><th>类型</th><th>目标</th><th class="num">大小</th><th>状态</th><th></th></tr></thead>
        <tbody>${list.map(changeRowHTML).join('') || '<tr><td colspan="7"><div class="batch-empty">还没有记录。通过面板保存应用或编辑文件后，这里会出现可回滚的版本。</div></td></tr>'}</tbody>
      </table>
    </div>
    <p class="stock-note">每个目标保留最近一次修改前的版本，最多保存 80 条记录；回滚同样通过 SFTP 原子写入。</p>` : ''}`;
  $('#chgRefresh').addEventListener('click', () => loadChanges(true));
  if (d) {
    $('#chgTable').addEventListener('click', e => {
      const view = e.target.closest('[data-chg-view]');
      const roll = e.target.closest('[data-chg-rollback]');
      if (view) openChangeDiff(view.dataset.chgView);
      else if (roll) rollbackChange(roll.dataset.chgRollback, roll.dataset.chgTarget);
    });
  } else if (!state.changesBusy && !state.changesError) {
    setTimeout(() => { if (state.page === 'changes' && !state.subview) loadChanges(false); }, 0);
  }
}

function diffHTML(before, after) {
  const cap = s => {
    s = String(s || '');
    return s.length > 8000 ? s.slice(0, 8000) + '\n… (已截断)' : s;
  };
  const a = cap(before).split('\n');
  const b = cap(after).split('\n');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const lines = (arr, from, to, cls) => arr.slice(from, to).map(l => `<span class="line ${cls}">${esc(l) || ' '}</span>`).join('');
  const col = (title, arr, midCls, midFrom, midTo) => `<div class="chg-col"><h4>${title}</h4><pre>${lines(arr, 0, midFrom, '')}${lines(arr, midFrom, midTo, midCls)}${lines(arr, midTo, arr.length, '')}</pre></div>`;
  return `<div class="chg-diff">${col('修改前', a, 'del', p, a.length - s)}${col('修改后', b, 'add', p, b.length - s)}</div>`;
}

async function openChangeDiff(id) {
  try {
    const d = await api('/api/changes/' + encodeURIComponent(id));
    const it = d.item || {};
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-mask"><div class="modal modal-wide" role="dialog" aria-modal="true">
      <h3 class="modal-title">变更详情 · ${esc(it.summary || it.target || '')}</h3>
      <p class="modal-desc">${esc(it.node_name || '')} · ${fmtTime(it.time)} · ${esc(it.target || '')}</p>
      ${diffHTML(d.before || '', d.after || '')}
      <div class="modal-actions"><button class="btn ghost" data-x="close">关闭</button></div>
    </div></div>`;
    root.querySelector('[data-x=close]').onclick = closeModal;
    root.querySelector('.modal-mask').onclick = ev => { if (ev.target.classList.contains('modal-mask')) closeModal(); };
  } catch (e) { toast(e.message, 'error'); }
}

async function rollbackChange(id, target) {
  const ok = await confirmDialog('回滚这次变更？', `将把 ${target} 恢复为修改前的内容。`, '回滚', true);
  if (!ok) return;
  try {
    await api('/api/changes/' + encodeURIComponent(id) + '/rollback', { method: 'POST', body: '{}' });
    toast('已回滚', 'success');
    loadChanges(true);
  } catch (e) { toast(e.message, 'error'); }
}

function loadDrift(force) {
  if (state.driftBusy) return;
  state.driftBusy = true;
  state.driftError = '';
  if (state.page === 'drift' && !state.subview) renderPage();
  api('/api/drift').then(d => {
    state.drift = d;
  }).catch(e => {
    state.driftError = e.message;
    if (force) toast(e.message, 'error');
  }).finally(() => {
    state.driftBusy = false;
    if (state.page === 'drift' && !state.subview) renderPage();
  });
}

function driftHashLabel(h) {
  if (h === 'unknown') return '读取失败';
  if (h === 'missing') return '未安装';
  return String(h).slice(0, 10);
}

function driftItemHTML(it, names) {
  const rows = it.groups.map((g, i) => {
    const nodeNames = g.nodes.map(id => names[id] || id).join('、');
    return `<div class="drift-group ${i === 0 ? 'major' : 'minor'}">
      <span class="drift-hash mono">${esc(driftHashLabel(g.hash))}</span>
      <span class="drift-nodes">${esc(nodeNames)}</span>
      <span class="drift-count">${g.nodes.length} 台</span>
    </div>`;
  }).join('');
  return `<div class="card drift-item">
    <div class="drift-head">
      <div class="drift-title"><b>${esc(it.label)}</b><span class="mono drift-key">${esc(String(it.key).replace(/^file:/, ''))}</span></div>
      <span class="drift-pill ${it.drifted.length ? 'bad' : 'ok'}">${it.drifted.length ? it.drifted.length + ' 台不一致' : '一致'}</span>
    </div>
    ${rows}
  </div>`;
}

function renderDrift() {
  const page = $('#page');
  if (!page) return;
  const d = state.drift;
  const names = {};
  ((d && d.nodes) || []).forEach(n => { names[n.id] = n.name; });
  const driftNodes = new Set();
  ((d && d.items) || []).forEach(it => (it.drifted || []).forEach(id => driftNodes.add(id)));
  const offNodes = ((d && d.nodes) || []).filter(n => !n.online).map(n => n.name).join('、');
  page.innerHTML = `
    <section class="page-head">
      <div><h1>配置漂移检测</h1><p class="page-sub">对比各节点关键配置的哈希，找出与多数节点不一致的机器</p></div>
      <div class="head-actions"><button class="btn sm ghost" id="driftRefresh">重新扫描</button></div>
    </section>
    ${state.driftBusy && !d ? '<div class="card empty">正在扫描各节点配置…</div>' : ''}
    ${state.driftError && !d ? `<div class="card empty">${esc(state.driftError)}</div>` : ''}
    ${d ? `
    <div class="card drift-hero">
      <div class="drift-sum"><b>${d.scanned}</b><span>在线节点</span></div>
      <div class="drift-sum"><b>${(d.items || []).length}</b><span>检查项</span></div>
      <div class="drift-sum ${d.drifts ? 'bad' : 'ok'}"><b>${d.drifts}</b><span>存在漂移</span></div>
      <div class="drift-sum ${driftNodes.size ? 'warn' : ''}"><b>${driftNodes.size}</b><span>漂移节点</span></div>
      <div class="drift-time">扫描于 ${fmtTime(d.time)}</div>
    </div>
    ${(d.items || []).length ? `<div class="drift-grid">${(d.items || []).map(it => driftItemHTML(it, names)).join('')}</div>` : '<div class="card empty">没有可扫描的在线节点</div>'}
    <p class="stock-note">按多数节点作为基准分组，SSH / Nginx / Docker / crontab / Compose 配置均以 SHA-256 对比，只读取哈希不上传原文。${offNodes ? ' 未参与扫描：' + esc(offNodes) + '（离线或仅 SFTP）。' : ''}</p>` : ''}`;
  $('#driftRefresh').addEventListener('click', () => loadDrift(true));
  if (!d && !state.driftBusy && !state.driftError) {
    setTimeout(() => { if (state.page === 'drift' && !state.subview) loadDrift(false); }, 0);
  }
}

function batchSelectedIds() {
  return Object.keys(state.batchSel).filter(id => state.batchSel[id]);
}

function batchTabsHTML() {
  const tabs = [['exec', '执行命令'], ['update', '批量更新应用'], ['upload', '分发文件']];
  return `<div class="park-tabs" id="batchTabs">${tabs.map(([k, l]) => `<button data-batch-tab="${k}" class="${state.batchTab === k ? 'active' : ''}">${l}</button>`).join('')}</div>`;
}

function batchBodyHTML() {
  if (state.batchTab === 'update') {
    return `<div class="batch-head"><div><h2 class="batch-title">批量更新 Compose 应用</h2><p class="batch-desc">对所选节点的应用目录逐个执行 pull + up -d --remove-orphans，可能持续几分钟。</p></div><button class="btn primary" id="batchUpdateBtn">更新应用</button></div>`;
  }
  if (state.batchTab === 'upload') {
    return `<div class="batch-head"><div><h2 class="batch-title">分发文件</h2><p class="batch-desc">把本地文件写入每台节点文件根目录下的指定路径，单文件最大 20MB。</p></div><button class="btn primary" id="batchUploadBtn">上传</button></div>
    <div class="batch-row">
      <div class="field"><label>目标目录（绝对路径）</label><input id="batchPath" value="/" spellcheck="false"></div>
      <div class="field"><label>选择文件</label><input type="file" id="batchFile"></div>
    </div>`;
  }
  return `<div class="batch-head"><div><h2 class="batch-title">执行 Shell 命令</h2><p class="batch-desc">命令通过 SSH 在每台节点以登录用户执行，需要 POSIX sh 兼容；只读查询与运维脚本都合适。</p></div><button class="btn primary" id="batchRun">${ico('play')}开始执行</button></div>
  <textarea class="batch-cmd" id="batchCmd" spellcheck="false" placeholder="例如：df -h /&#10;或：systemctl status docker --no-pager"></textarea>`;
}

function batchResultCard(r, kind) {
  const ms = r.elapsed_ms != null ? `${r.elapsed_ms} ms` : '';
  const head = `<div class="batch-res-head"><span class="dot ${r.ok ? 'ok' : ''}"></span>${esc(r.name)}<em>${ms}</em></div>`;
  const err = r.error ? `<div class="batch-app"><span class="st"></span><span class="err">${esc(r.error)}</span></div>` : '';
  if (kind === 'update') {
    const apps = (r.apps || []).map(a => `<div class="batch-app"><span class="st ${a.ok ? 'ok' : ''}"></span><b>${esc(a.name)}</b><span class="err">${a.ok ? '更新成功' : '失败'}</span></div>`).join('');
    return `<div class="batch-res-card">${head}${err}${apps ? `<div class="batch-apps">${apps}</div>` : ''}</div>`;
  }
  if (kind === 'upload') {
    return `<div class="batch-res-card">${head}${r.error ? err : '<div class="batch-app"><span class="st ok"></span><span class="err">写入成功</span></div>'}</div>`;
  }
  const out = r.output ? `<pre>${esc(r.output)}</pre>` : '';
  return `<div class="batch-res-card">${head}${err}${out}</div>`;
}

function drawBatchResults() {
  const box = $('#batchResults');
  if (!box) return;
  const br = state.batchResults;
  if (!br || br.kind !== state.batchTab) { box.innerHTML = ''; return; }
  if (!br.results.length) { box.innerHTML = '<div class="batch-empty">没有结果</div>'; return; }
  box.innerHTML = br.results.map(r => batchResultCard(r, br.kind)).join('');
}

function setBatchBusy(busy, msg) {
  state.batchBusy = busy;
  ['batchRun', 'batchUpdateBtn', 'batchUploadBtn'].forEach(id => {
    const b = $('#' + id);
    if (b) b.disabled = busy;
  });
  const box = $('#batchResults');
  if (box && busy) box.innerHTML = `<div class="batch-empty">${esc(msg || '处理中…')}</div>`;
}

async function runBatchExec() {
  const ids = batchSelectedIds();
  const el = $('#batchCmd');
  const cmd = el ? el.value.trim() : '';
  if (!ids.length) return toast('请先选择节点', 'error');
  if (!cmd) return toast('请填写要执行的命令', 'error');
  setBatchBusy(true, `正在 ${ids.length} 台节点执行命令…`);
  try {
    const d = await api('/api/batch/exec', { method: 'POST', body: JSON.stringify({ ids, cmd }) });
    state.batchResults = { kind: 'exec', results: d.results || [] };
  } catch (e) { toast(e.message, 'error'); state.batchResults = null; }
  setBatchBusy(false);
  drawBatchResults();
}

async function runBatchUpdate() {
  const ids = batchSelectedIds();
  if (!ids.length) return toast('请先选择节点', 'error');
  setBatchBusy(true, `正在更新 ${ids.length} 台节点的应用，可能需要几分钟…`);
  try {
    const d = await api('/api/batch/update', { method: 'POST', body: JSON.stringify({ ids }) });
    state.batchResults = { kind: 'update', results: d.results || [] };
  } catch (e) { toast(e.message, 'error'); state.batchResults = null; }
  setBatchBusy(false);
  drawBatchResults();
}

async function runBatchUpload() {
  const ids = batchSelectedIds();
  const dirEl = $('#batchPath');
  const input = $('#batchFile');
  const dir = dirEl ? dirEl.value.trim() : '';
  const file = input && input.files && input.files[0];
  if (!ids.length) return toast('请先选择节点', 'error');
  if (!dir.startsWith('/')) return toast('目标目录需为绝对路径', 'error');
  if (!file) return toast('请选择要分发的文件', 'error');
  setBatchBusy(true, `正在把 ${file.name} 分发到 ${ids.length} 台节点…`);
  try {
    const url = '/api/batch/upload?ids=' + encodeURIComponent(ids.join(',')) + '&path=' + encodeURIComponent(dir) + '&name=' + encodeURIComponent(file.name);
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'X-KayPanel': '1' }, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '上传失败');
    state.batchResults = { kind: 'upload', results: data.results || [] };
    toast(`已写入 ${data.ok}/${data.total} 台节点`, 'success');
    if (input) input.value = '';
  } catch (e) { toast(e.message, 'error'); state.batchResults = null; }
  setBatchBusy(false);
  drawBatchResults();
}

function renderBatch() {
  const page = $('#page');
  if (!page) return;
  const nodes = state.nodes;
  const sel = batchSelectedIds();
  page.innerHTML = `
    <section class="page-head">
      <div><h1>多机批量操作</h1><p class="page-sub">选中的节点并发执行，最多 20 台；适合群发命令、统一更新与分发文件</p></div>
      <div class="head-actions"><span class="park-counter">${ico('batch')}<span id="batchCount">${sel.length}</span> 台已选</span></div>
    </section>
    <div class="card batch-pick" id="batchPicker">
      ${nodes.map(n => `<button class="batch-node ${state.batchSel[n.id] ? 'on' : ''}" data-batch-node="${esc(n.id)}"><span class="dot ${n.online ? 'online' : ''}"></span>${esc(n.name)}</button>`).join('') || '<span class="muted">尚未添加节点</span>'}
      <div class="batch-pick-tools">
        <button class="btn sm ghost" id="batchAll">全选</button>
        <button class="btn sm ghost" id="batchNone">清空</button>
      </div>
    </div>
    ${batchTabsHTML()}
    <div class="card batch-body" id="batchBody">${batchBodyHTML()}</div>
    <div class="batch-res" id="batchResults"></div>`;
  $('#batchPicker').addEventListener('click', e => {
    const btn = e.target.closest('[data-batch-node]');
    if (!btn) return;
    const id = btn.dataset.batchNode;
    state.batchSel[id] = !state.batchSel[id];
    btn.classList.toggle('on', !!state.batchSel[id]);
    const c = $('#batchCount');
    if (c) c.textContent = String(batchSelectedIds().length);
  });
  $('#batchAll').addEventListener('click', () => {
    nodes.forEach(n => { state.batchSel[n.id] = true; });
    $$('[data-batch-node]', page).forEach(b => b.classList.add('on'));
    const c = $('#batchCount');
    if (c) c.textContent = String(batchSelectedIds().length);
  });
  $('#batchNone').addEventListener('click', () => {
    state.batchSel = {};
    $$('[data-batch-node]', page).forEach(b => b.classList.remove('on'));
    const c = $('#batchCount');
    if (c) c.textContent = '0';
  });
  $('#batchTabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-batch-tab]');
    if (!btn || btn.dataset.batchTab === state.batchTab) return;
    state.batchTab = btn.dataset.batchTab;
    renderPage();
  });
  if ($('#batchRun')) $('#batchRun').addEventListener('click', runBatchExec);
  if ($('#batchUpdateBtn')) $('#batchUpdateBtn').addEventListener('click', runBatchUpdate);
  if ($('#batchUploadBtn')) $('#batchUploadBtn').addEventListener('click', runBatchUpload);
  if (state.batchBusy) setBatchBusy(true, '处理中…');
  else drawBatchResults();
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
  applyTheme(state.theme);
  setupWindowChrome();
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('unauth');
    const me = await res.json();
    state.authed = true;
    state.desktop = !!me.desktop;
    state.version = me.version || '';
    state.settings = me.settings || state.settings;
    state.hasWebhook = !!me.has_webhook;
    state.hasAIKey = !!me.has_ai_key;
  } catch (e) {
    showLogin();
    return;
  }
  renderShell();
  setupGlobalKeys();
  window.addEventListener('hashchange', onRoute);
  await loadOverview(false);
  syncTray();
  if (!location.hash) history.replaceState(null, '', '#/overview');
  onRoute();
  state.nodeTimer = setInterval(refreshNodesLight, 30000);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
