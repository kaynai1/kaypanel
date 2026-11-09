'use strict';

const TOP_PAGES = ['overview', 'personality', 'timeline', 'containers', 'apps', 'files', 'terminal', 'ai', 'settings'];
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
  aiStackPrompt: '',
  aiStackBusy: false,
  aiStackResult: null,
  aiStackError: '',
  trendMetric: 'cpu',
  autoRefresh: prefOn('kp_auto'),
  procOn: prefOn('kp_proc'),
  alertOn: prefOn('kp_alert'),
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
        <button class="nav-item" data-page="personality">${ico('heart')}<span>性格周报</span></button>
        <button class="nav-item" data-page="timeline">${ico('clock')}<span>故障回放</span></button>
        <button class="nav-item" data-page="containers">${ico('container')}<span>容器</span><span class="nav-badge hidden" id="navCtrBadge"></span></button>
        <button class="nav-item" data-page="apps">${ico('app')}<span>应用</span></button>
        <div class="nav-group">工具</div>
        <button class="nav-item" data-page="files">${ico('folder')}<span>文件</span></button>
        <button class="nav-item" data-page="terminal">${ico('terminal')}<span>终端</span></button>
        <button class="nav-item" data-page="ai">${ico('spark')}<span>AI 助手</span></button>
        <div class="nav-group">系统</div>
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
          <button class="icon-btn" id="wallBtn" title="监控大屏">${ico('wall')}</button>
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
    case 'personality': loadPersonality(true); break;
    case 'timeline': loadTimeline(true); break;
    case 'containers': loadContainers(); break;
    case 'apps': loadStacks(); break;
    case 'files': loadFiles(state.filePath); break;
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
  if (page !== 'wall' && !TOP_PAGES.includes(page)) page = 'overview';
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
  if (p === 'wall') {
    state.page = 'wall';
    state.subview = null;
    renderPage();
    return;
  }
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
  if (state.wallTimer) { clearInterval(state.wallTimer); state.wallTimer = null; }
  if (state.wallClock) { clearInterval(state.wallClock); state.wallClock = null; }
  if (state.wallKey) { document.removeEventListener('keydown', state.wallKey); state.wallKey = null; }
  const wall = $('#wallRoot');
  if (wall) wall.remove();
  document.body.classList.remove('wall-mode');
  closeLogDrawer();
  disposeTerminal();
}

function renderPage() {
  cleanupPage();
  if (state.page === 'wall') return renderWall();
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
    case 'personality': return renderPersonality();
    case 'timeline': return renderTimeline();
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
      <button class="wall-exit" id="wallFull" title="切换全屏">${ico('expand')}<span>全屏</span></button>
      <button class="wall-exit" id="wallExit" title="退出大屏">退出 Esc</button>
    </header>
    <div class="wall-grid" id="wallGrid"></div>
    <footer class="wall-foot"><span id="wallCount"></span><span>CPU / 内存 / 磁盘超过告警阈值时红色高亮</span></footer>`;
  document.body.appendChild(root);
  drawWall();
  updateWallClock();
  const exit = () => navigate('overview');
  $('#wallExit').addEventListener('click', exit);
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
  if ((state.page === 'overview' || state.page === 'wall') && !state.subview) return;
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

function timelineHTML(d) {
  const nodes = d.nodes || [];
  const all = d.events || [];
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
  window.addEventListener('hashchange', onRoute);
  await loadOverview(false);
  if (!location.hash) history.replaceState(null, '', '#/overview');
  onRoute();
  state.nodeTimer = setInterval(refreshNodesLight, 30000);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
