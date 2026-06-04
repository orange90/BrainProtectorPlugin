/* global BPDB, BPCat */
'use strict';

/* ════════════════════════════════════════
   主题
   ════════════════════════════════════════ */
/* 主题偏好：'system' | 'light' | 'dark'（system 跟随操作系统） */
let themePref = 'system';
const themeMQ = matchMedia('(prefers-color-scheme: dark)');
const THEME_META = {
  system: { icon: '🌓', label: '跟随系统' },
  light:  { icon: '☀️', label: '明亮' },
  dark:   { icon: '🌙', label: '暗黑' },
};
function resolvedDark() {
  return themePref === 'dark' || (themePref === 'system' && themeMQ.matches);
}
function applyTheme() {
  document.documentElement.setAttribute('data-theme', resolvedDark() ? 'dark' : 'light');
  document.getElementById('themeBtnIcon').textContent = THEME_META[themePref].icon;
  document.getElementById('themeBtnLabel').textContent = THEME_META[themePref].label;
}
function toggleTheme() {
  themePref = themePref === 'system' ? 'light' : themePref === 'light' ? 'dark' : 'system';
  applyTheme();
  chrome.storage.local.set({ theme: themePref });
}
chrome.storage.local.get(['theme'], (res) => {
  themePref = ['system', 'light', 'dark'].includes(res.theme) ? res.theme : 'system';
  applyTheme();
});
themeMQ.addEventListener('change', () => { if (themePref === 'system') applyTheme(); });

function greet() {
  const h = new Date().getHours();
  const g = h < 6 ? '凌晨好，注意休息' : h < 12 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : h < 23 ? '晚上好' : '夜深了，早点睡';
  document.getElementById('greet').textContent = '· ' + g;
}

/* ════════════════════════════════════════
   时间面板（真实数据）
   ════════════════════════════════════════ */
function fmtDur(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return sec + 's';
  const m = Math.round(sec / 60);
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

function getLive() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_LIVE' }, (res) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(res && res.live);
      });
    } catch (e) { resolve(null); }
  });
}

async function renderTimeDashboard() {
  let records = [];
  try {
    records = await BPDB.getRecordsByDay(BPDB.todayKey());
  } catch (e) {
    records = [];
  }
  const { categories } = await BPCat.getRules();
  const live = await getLive();

  // 聚合
  const siteMap = new Map();   // domain -> {browse, create}
  const zhihuCat = new Map();  // category -> seconds
  let totalBrowse = 0, totalCreate = 0;

  const tally = (domain, time_type, category, dur) => {
    if (!dur) return;
    if (!siteMap.has(domain)) siteMap.set(domain, { browse: 0, create: 0 });
    const s = siteMap.get(domain);
    if (time_type === 'creating') { s.create += dur; totalCreate += dur; }
    else { s.browse += dur; totalBrowse += dur; }
    if (domain === 'zhihu.com' || (domain && domain.endsWith('zhihu.com'))) {
      zhihuCat.set(category || '未分类', (zhihuCat.get(category || '未分类') || 0) + dur);
    }
  };

  for (const r of records) tally(r.domain, r.time_type, r.category, r.duration_seconds || 0);
  // 合并进行中的活跃段（心跳之外尚未落盘的最后几十秒）
  if (live && live.elapsed > 0) tally(live.domain, live.time_type, live.category, live.elapsed);

  // 指标条
  document.getElementById('tdTotalBrowse').textContent = totalBrowse ? fmtDur(totalBrowse) : '0m';
  document.getElementById('tdTotalCreate').textContent = totalCreate ? fmtDur(totalCreate) : '0m';

  const wasteSec = zhihuCat.get('数码娱乐') || 0;
  const wasteThreshold = (categories['数码娱乐'] && categories['数码娱乐'].alert_threshold_minutes) || 0;
  const wasteMin = Math.round(wasteSec / 60);
  document.getElementById('tdWasteTime').textContent = wasteSec ? fmtDur(wasteSec) : '0m';
  const wasteEl = document.getElementById('tdWasteTime');
  if (wasteThreshold > 0) {
    const over = wasteMin - wasteThreshold;
    document.getElementById('tdWasteSub').textContent = over > 0 ? `超出目标 ${over}m ⚠️` : `目标 ${wasteThreshold}m 未超`;
    wasteEl.style.color = over > 0 ? 'var(--red)' : 'var(--green)';
  } else {
    document.getElementById('tdWasteSub').textContent = '知乎话题';
  }

  // 各网站浏览
  const sites = [...siteMap.entries()]
    .map(([domain, v]) => ({ domain, name: BPCat.prettyDomain(domain), browse: v.browse, create: v.create }))
    .sort((a, b) => b.browse - a.browse)
    .slice(0, 7);
  const maxB = Math.max(1, ...sites.map((s) => s.browse));
  const siteRows = document.getElementById('siteRows');
  if (!sites.length || !totalBrowse) {
    siteRows.innerHTML = '<div class="empty-hint">今日暂无浏览记录，去逛逛吧 🌱</div>';
  } else {
    siteRows.innerHTML = sites.filter((s) => s.browse > 0).map((s) => {
      const pct = Math.round((s.browse / maxB) * 100);
      const c = s.domain.includes('zhihu') ? 'var(--bar-purple)' : 'var(--bar-blue)';
      return `<div class="bar-row">
        <span class="bar-name">${escapeHtml(s.name)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${c}"></div></div>
        <span class="bar-val">${fmtDur(s.browse)}</span>
      </div>`;
    }).join('');
  }

  // 知乎话题分析
  const zhihuRows = document.getElementById('zhihuRows');
  const catOrder = Object.keys(categories);
  const zhihuEntries = catOrder
    .filter((c) => zhihuCat.has(c))
    .map((c) => ({ cat: c, sec: zhihuCat.get(c), color: categories[c].color, threshold: categories[c].alert_threshold_minutes || 0 }));
  if (!zhihuEntries.length) {
    zhihuRows.innerHTML = '<div class="empty-hint">暂无知乎浏览，深度感知待激活 🔍</div>';
  } else {
    const maxZ = Math.max(1, ...zhihuEntries.map((z) => z.sec));
    zhihuRows.innerHTML = zhihuEntries.map((z) => {
      const pct = Math.round((z.sec / maxZ) * 100);
      const min = Math.round(z.sec / 60);
      const over = z.threshold > 0 && min > z.threshold;
      return `<div class="bar-row">
        <span class="bar-name">${escapeHtml(z.cat)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${z.color}"></div></div>
        <span class="bar-val${over ? ' warn' : ''}">${fmtDur(z.sec)}${over ? ' ⚠️' : ''}</span>
      </div>`;
    }).join('');
  }

  // 创作明细
  const creators = sites.filter((s) => s.create > 0).sort((a, b) => b.create - a.create);
  document.getElementById('createRows').innerHTML = creators.length
    ? creators.map((s) => `<div class="create-badge"><span class="site-name">${escapeHtml(s.name)}</span><span class="site-time">${fmtDur(s.create)}</span></div>`).join('')
    : '<span style="font-size:12px;color:var(--tx-muted)">今日暂无创作记录</span>';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* 暴露给 tasks.js 复用 */
window.BPUtil = { escapeHtml, fmtDur };

/* ════════════════════════════════════════
   Tab 切换
   ════════════════════════════════════════ */
function setupTabs() {
  const btns = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.tab-pane');
  function activate(name) {
    btns.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    panes.forEach((p) => p.classList.toggle('active', p.id === 'pane-' + name));
    chrome.storage.local.set({ activeTab: name });
    if (name === 'task' && window.BPTasks) window.BPTasks.render();
  }
  btns.forEach((b) => b.addEventListener('click', () => activate(b.dataset.tab)));
  chrome.storage.local.get(['activeTab'], (res) => {
    if (res.activeTab) activate(res.activeTab);
  });
}

/* ════════════════════════════════════════
   专注工具（番茄钟 / 有害自检 / 切换 / 认知负荷 / 建议）
   ════════════════════════════════════════ */
const MODES = { pomodoro: 25 * 60, deep: 90 * 60, custom: 45 * 60 };
let mode = 'pomodoro', totalTime = MODES.pomodoro, timeLeft = totalTime;
let running = false, interval = null, switchLog = [], customMinutes = 45;

const harmItems = [
  { id: 'h1', text: '查了手机/社交媒体', risk: '高度分心', severity: 'danger' },
  { id: 'h2', text: '同时开着多个任务窗口', risk: '工作记忆超载', severity: 'danger' },
  { id: 'h3', text: '边工作边听播客/视频', risk: '语言处理竞争', severity: 'warn' },
  { id: 'h4', text: '连续工作超90分钟未休息', risk: '前额叶疲劳', severity: 'danger' },
  { id: 'h5', text: '通知消息没有关闭', risk: '持续中断循环', severity: 'warn' },
  { id: 'h6', text: '工作时一直回复消息', risk: '多线程激活', severity: 'danger' },
  { id: 'h7', text: '跳过了午饭/喝水', risk: '血糖与认知下降', severity: 'warn' },
  { id: 'h8', text: '昨晚睡眠不足7小时', risk: '记忆巩固受损', severity: 'danger' },
];
const checkedHarms = new Set();

/* ── 持久化（按天） ── */
function focusKey() { return 'focus_' + BPDB.todayKey(); }
function persistFocus() {
  chrome.storage.local.set({ [focusKey()]: { switchLog, checkedHarms: [...checkedHarms] } });
}
function loadFocus() {
  return new Promise((resolve) => {
    chrome.storage.local.get([focusKey()], (res) => {
      const data = res[focusKey()];
      if (data) {
        switchLog = data.switchLog || [];
        (data.checkedHarms || []).forEach((id) => checkedHarms.add(id));
      }
      resolve();
    });
  });
}

function renderChecklist() {
  document.getElementById('harmChecklist').innerHTML = harmItems.map((item) => `
    <label class="check-row" for="${item.id}">
      <input type="checkbox" id="${item.id}" ${checkedHarms.has(item.id) ? 'checked' : ''} data-harm="${item.id}">
      <div>
        <div class="check-text">${item.text}</div>
        <div class="check-risk"><span class="badge badge-${item.severity === 'danger' ? 'danger' : 'warn'}">${item.risk}</span></div>
      </div>
    </label>`).join('');
  document.querySelectorAll('#harmChecklist input[data-harm]').forEach((el) => {
    el.addEventListener('change', () => toggleHarm(el.dataset.harm));
  });
}

function toggleHarm(id) {
  checkedHarms.has(id) ? checkedHarms.delete(id) : checkedHarms.add(id);
  document.getElementById('harmCountInline').textContent = checkedHarms.size;
  persistFocus();
  updateInsights(); updateCogBars();
}

function setMode(m) {
  if (running) return;
  mode = m;
  if (m === 'custom') {
    const mins = parseInt(prompt('自定义专注时长（分钟）:', '45'), 10) || 45;
    customMinutes = Math.max(1, Math.min(180, mins));
    MODES.custom = customMinutes * 60;
  }
  totalTime = MODES[m]; timeLeft = totalTime;
  document.getElementById('timerProgress').style.width = '0%';
  updateTimerDisplay();
  ['pomodoro', 'deep', 'custom'].forEach((x) =>
    document.getElementById('mode' + x[0].toUpperCase() + x.slice(1)).classList.toggle('active', x === m));
  document.getElementById('timerLabel').textContent =
    m === 'pomodoro' ? '番茄时钟 · 待开始' : m === 'deep' ? '深度工作 · 待开始' : `自定义 ${customMinutes}min · 待开始`;
}

function updateTimerDisplay() {
  const m = Math.floor(timeLeft / 60), s = timeLeft % 60;
  document.getElementById('timerDisplay').textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function setPlayIcon(ic) {
  const el = document.querySelector('#startBtn .play-ic');
  if (el) el.textContent = ic;
}

function toggleTimer() {
  if (running) {
    clearInterval(interval); running = false;
    document.getElementById('startLabel').textContent = '继续';
    document.getElementById('timerLabel').textContent = '已暂停';
    setPlayIcon('▶');
  } else {
    running = true;
    document.getElementById('startLabel').textContent = '暂停';
    setPlayIcon('⏸');
    document.getElementById('timerLabel').textContent = mode === 'pomodoro' ? '专注中 🍅' : mode === 'deep' ? '深度工作中 🧠' : '专注中 ⚙️';
    interval = setInterval(() => {
      if (timeLeft <= 0) {
        clearInterval(interval); running = false;
        document.getElementById('startLabel').textContent = '开始';
        setPlayIcon('▶');
        document.getElementById('timerLabel').textContent = '✅ 完成！休息一下';
        document.getElementById('timerProgress').style.width = '100%';
        saveSession();
        return;
      }
      timeLeft--;
      updateTimerDisplay();
      document.getElementById('timerProgress').style.width = Math.round(((totalTime - timeLeft) / totalTime) * 100) + '%';
      updateFocusScore(); updateFocusTime();
    }, 1000);
  }
}

function resetTimer() {
  clearInterval(interval); running = false; timeLeft = totalTime;
  updateTimerDisplay();
  document.getElementById('timerProgress').style.width = '0%';
  document.getElementById('startLabel').textContent = '开始';
  setPlayIcon('▶');
  document.getElementById('timerLabel').textContent = '待开始';
  document.getElementById('focusScore').textContent = '—';
}

function saveSession() {
  try {
    BPDB.putSession({ id: BPDB.uuid(), mode, duration_seconds: totalTime, end_at: Date.now() });
  } catch (e) { /* ignore */ }
}

function updateFocusTime() {
  const elapsed = totalTime - timeLeft, m = Math.floor(elapsed / 60), s = elapsed % 60;
  document.getElementById('focusTime').textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  document.getElementById('focusTimeSub').textContent = '本轮已专注';
}

function updateFocusScore() {
  const frac = (totalTime - timeLeft) / totalTime;
  const penalty = Math.min(switchLog.length * 8, 40) + Math.min(checkedHarms.size * 10, 50);
  const score = Math.max(0, Math.round(frac * 100) - penalty);
  const el = document.getElementById('focusScore');
  el.textContent = score;
  el.style.color = score >= 70 ? 'var(--green)' : score >= 40 ? 'var(--amber)' : 'var(--red)';
}

function renderSwitchLog() {
  const ul = document.getElementById('switchLog');
  if (!switchLog.length) {
    ul.innerHTML = '<li style="font-size:11px;color:var(--tx-muted);padding:6px 0;">暂无记录</li>';
    return;
  }
  const recent = switchLog.slice(-5).reverse();
  ul.innerHTML = recent.map((ts, i) => {
    const count = switchLog.length - i;
    const sev = count <= 2 ? 'ok' : count <= 5 ? 'warn' : 'danger';
    const msg = count <= 2 ? '轻微分心' : count <= 5 ? '注意多任务' : '严重碎片化';
    return `<li class="log-item"><span class="log-time">${ts}</span><span class="log-text">第${count}次 <span class="badge badge-${sev}">${msg}</span></span></li>`;
  }).join('');
}

function logSwitch() {
  const now = new Date();
  const ts = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  switchLog.push(ts);
  document.getElementById('switchCount').textContent = switchLog.length;
  renderSwitchLog();
  persistFocus();
  updateInsights(); updateCogBars();
  if (running) updateFocusScore();
}

const cogMetrics = [
  { label: '任务切换损耗', get: () => Math.min(switchLog.length * 15, 100) },
  { label: '工作记忆压力', get: () => Math.min(checkedHarms.size * 12 + switchLog.length * 5, 100) },
  { label: '注意力恢复成本', get: () => switchLog.length > 0 ? Math.min(20 + switchLog.length * 10, 100) : 0 },
  { label: '前额叶疲劳', get: () => {
    const h4 = checkedHarms.has('h4') ? 40 : 0;
    const h8 = checkedHarms.has('h8') ? 30 : 0;
    const el = running ? Math.round((totalTime - timeLeft) / 60) : 0;
    return Math.min(h4 + h8 + el, 100);
  } },
];

function updateCogBars() {
  document.getElementById('cogBars').innerHTML = cogMetrics.map((m) => {
    const val = Math.min(Math.round(m.get()), 100);
    const c = val < 30 ? 'var(--bar-green)' : val < 60 ? 'var(--bar-amber)' : 'var(--bar-red)';
    return `<div class="cog-row">
      <span class="cog-lbl">${m.label}</span>
      <div class="cog-track"><div class="cog-fill" style="width:${val}%;background:${c}"></div></div>
      <span class="cog-val">${val}%</span>
    </div>`;
  }).join('');
}

function updateInsights() {
  const msgs = [];
  if (!switchLog.length && !checkedHarms.size)
    msgs.push({ t: 'ok', x: '一切正常 — 保持当前状态，继续深度工作 💪' });
  if (switchLog.length >= 3)
    msgs.push({ t: 'danger', x: `⚡ 已切换 ${switchLog.length} 次。每次任务切换平均需 23 分钟恢复专注。建议休息后重开。` });
  else if (switchLog.length)
    msgs.push({ t: 'warn', x: `切换了 ${switchLog.length} 次 — 尚可控。关闭无关标签页，手机翻过来放。` });
  if (checkedHarms.has('h1')) msgs.push({ t: 'danger', x: '📱 查看手机平均消耗 20 分钟专注窗口。' });
  if (checkedHarms.has('h4')) msgs.push({ t: 'danger', x: '🧠 超 90 分钟未休息，前额叶资源耗尽 — 立刻走两分钟。' });
  if (checkedHarms.has('h8')) msgs.push({ t: 'danger', x: '😴 睡眠不足使记忆巩固效率下降 40%+。今天保护已有成果。' });
  if (checkedHarms.has('h3')) msgs.push({ t: 'warn', x: '🎧 语言类内容与语言处理中枢竞争，换无词音乐或白噪音。' });
  if (checkedHarms.has('h5')) msgs.push({ t: 'warn', x: '🔔 通知激活定向注意力网络，现在进入勿扰模式。' });
  if (checkedHarms.has('h2')) msgs.push({ t: 'danger', x: '🪟 多窗口 = 隐性持续切换，只留一个任务界面。' });
  if (checkedHarms.has('h6')) msgs.push({ t: 'danger', x: '💬 实时回消息让大脑始终在响应模式，设固定回复时段。' });
  if (checkedHarms.has('h7')) msgs.push({ t: 'warn', x: '🥗 跳过正餐认知表现下降 10-15%，去喝点水。' });
  document.getElementById('insights').innerHTML =
    msgs.map((m) => `<div class="insight-box insight-${m.t}">${m.x}</div>`).join('') ||
    '<div class="insight-box insight-ok">一切正常 — 保持当前状态，继续深度工作 💪</div>';
}

/* ════════════════════════════════════════
   绑定 & 初始化
   ════════════════════════════════════════ */
function bindEvents() {
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  document.getElementById('modePomodoro').addEventListener('click', () => setMode('pomodoro'));
  document.getElementById('modeDeep').addEventListener('click', () => setMode('deep'));
  document.getElementById('modeCustom').addEventListener('click', () => setMode('custom'));
  document.getElementById('startBtn').addEventListener('click', toggleTimer);
  document.getElementById('resetBtn').addEventListener('click', resetTimer);
  document.getElementById('logSwitchBtn').addEventListener('click', logSwitch);
}

async function init() {
  greet();
  bindEvents();
  setupTabs();
  await loadFocus();
  document.getElementById('switchCount').textContent = switchLog.length;
  document.getElementById('harmCountInline').textContent = checkedHarms.size;
  renderChecklist();
  renderSwitchLog();
  updateCogBars();
  updateInsights();
  renderTimeDashboard();
  // 数据可能在打开期间被后台更新，定时刷新（含进行中活跃段的实时合并）
  setInterval(renderTimeDashboard, 5000);
}

document.addEventListener('DOMContentLoaded', init);
