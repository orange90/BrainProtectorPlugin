/* global BPDB, BPCat */
'use strict';

/* ════════════════════════════════════════
   主题
   ════════════════════════════════════════ */
/* 线性图标（与界面统一的 1.6px stroke 风格） */
const SVG = {
  sun:    '<svg class="ic ic-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon:   '<svg class="ic ic-sm" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  system: '<svg class="ic ic-sm" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  play:   '<svg class="ic ic-fill" viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
  pause:  '<svg class="ic ic-fill" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
};

/* 主题偏好：'system' | 'light' | 'dark'（system 跟随操作系统） */
let themePref = 'system';
const themeMQ = matchMedia('(prefers-color-scheme: dark)');
const THEME_META = {
  system: { icon: SVG.system, label: '跟随系统' },
  light:  { icon: SVG.sun,    label: '明亮' },
  dark:   { icon: SVG.moon,   label: '暗黑' },
};
function resolvedDark() {
  return themePref === 'dark' || (themePref === 'system' && themeMQ.matches);
}
function applyTheme() {
  document.documentElement.setAttribute('data-theme', resolvedDark() ? 'dark' : 'light');
  document.getElementById('themeBtnIcon').innerHTML = THEME_META[themePref].icon;
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
    document.getElementById('tdWasteSub').textContent = over > 0 ? `超出目标 ${over}m` : `目标 ${wasteThreshold}m 未超`;
    wasteEl.style.color = over > 0 ? 'var(--crim)' : 'var(--teal)';
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
    siteRows.innerHTML = '<div class="empty-hint">今日暂无浏览记录</div>';
  } else {
    siteRows.innerHTML = sites.filter((s) => s.browse > 0).map((s) => {
      const pct = Math.round((s.browse / maxB) * 100);
      const c = s.domain.includes('zhihu') ? 'linear-gradient(90deg,var(--steel),var(--steel-2))' : 'var(--neutral-bar)';
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
    zhihuRows.innerHTML = '<div class="empty-hint">暂无知乎浏览，深度感知待激活</div>';
  } else {
    const maxZ = Math.max(1, ...zhihuEntries.map((z) => z.sec));
    zhihuRows.innerHTML = zhihuEntries.map((z) => {
      const pct = Math.round((z.sec / maxZ) * 100);
      const min = Math.round(z.sec / 60);
      const over = z.threshold > 0 && min > z.threshold;
      return `<div class="bar-row">
        <span class="bar-name">${escapeHtml(z.cat)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${z.color}"></div></div>
        <span class="bar-val${over ? ' warn' : ''}">${fmtDur(z.sec)}</span>
      </div>`;
    }).join('');
  }

  // 创作明细
  const creators = sites.filter((s) => s.create > 0).sort((a, b) => b.create - a.create);
  document.getElementById('createRows').innerHTML = creators.length
    ? creators.map((s) => `<div class="create-badge"><span class="site-name">${escapeHtml(s.name)}</span><span class="site-time">${fmtDur(s.create)}</span></div>`).join('')
    : '<span class="empty-hint">今日暂无创作记录</span>';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* 暴露给 tasks.js 复用 */
window.BPUtil = { escapeHtml, fmtDur };

/* ════════════════════════════════════════
   Tab 切换
   ════════════════════════════════════════ */
const TAB_ORDER = ['time', 'task', 'state'];
function setupTabs() {
  const indicator = document.getElementById('tabIndicator');
  const btns = [...document.querySelectorAll('.tab-btn')];
  const panes = [...document.querySelectorAll('.tab-pane')];
  const wrap = document.getElementById('tabPanesWrap');
  const paneOf = (name) => document.getElementById('pane-' + name);
  let current = 'time';

  function moveIndicator(animate) {
    const btn = btns.find((b) => b.dataset.tab === current);
    if (!btn) return;
    if (!animate) indicator.style.transition = 'none';
    indicator.style.width = btn.offsetWidth + 'px';
    indicator.style.transform = `translateX(${btn.offsetLeft}px)`;
    if (!animate) { void indicator.offsetWidth; indicator.style.transition = ''; }
  }

  // 只负责状态同步（按钮高亮 / 指示条 / 持久化），不触发任何滚动
  function syncState(name, persist) {
    if (!TAB_ORDER.includes(name) || name === current) return;
    current = name;
    btns.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    panes.forEach((p) => p.classList.toggle('active', p.id === 'pane-' + name));
    moveIndicator(true);
    if (persist) chrome.storage.local.set({ activeTab: name });
    if (name === 'task' && window.BPTasks) window.BPTasks.render();
  }

  // 程序化平滑滚动 → 浏览器自身完成动画，scroll 事件结尾会调用 syncState
  function scrollToTab(name, smooth) {
    if (!wrap) return syncState(name, true);
    const p = paneOf(name);
    if (!p) return;
    wrap.scrollTo({ left: p.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
  }

  // scroll 事件防抖：滚动停止 80ms 后判定停在哪一页
  let settleTimer = null;
  function onScroll() {
    if (!wrap) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      const w = wrap.clientWidth || 1;
      const idx = Math.round(wrap.scrollLeft / w);
      const name = TAB_ORDER[Math.max(0, Math.min(TAB_ORDER.length - 1, idx))];
      if (name) syncState(name, true);
    }, 80);
  }

  btns.forEach((b) => b.addEventListener('click', () => {
    const name = b.dataset.tab;
    syncState(name, true);
    scrollToTab(name, true);
  }));

  if (wrap) wrap.addEventListener('scroll', onScroll, { passive: true });

  window.addEventListener('resize', () => {
    moveIndicator(false);
    // 容器宽度变化后，scrollLeft 需要重新对齐到当前 Tab
    if (wrap) scrollToTab(current, false);
  });

  chrome.storage.local.get(['activeTab'], (res) => {
    const name = TAB_ORDER.includes(res.activeTab) ? res.activeTab : 'time';
    syncState(name, false);
    // 等布局完成后再瞬时滚动到位（首次进入不显示动画）
    requestAnimationFrame(() => {
      moveIndicator(false);
      scrollToTab(name, false);
    });
  });
}

/* ════════════════════════════════════════
   专注工具（番茄钟 / 有害自检 / 切换 / 认知负荷 / 建议）
   ════════════════════════════════════════ */
const MODES = { pomodoro: 25 * 60, deep: 90 * 60, custom: 45 * 60 };
let mode = 'pomodoro', totalTime = MODES.pomodoro, timeLeft = totalTime;
let running = false, interval = null, switchLog = [], customMinutes = 45;
// 计时器持久化：以墙钟终点时间(endAt)为锚点，跨刷新/新标签页继续走动
let timerEndAt = null;
const TIMER_KEY = 'focusTimerState';
// 完成提醒开关（用户在计时器下方勾选，默认关闭）
const NOTIFY_KEY = 'focusNotifyEnabled';
let notifyEnabled = false;
// 区分本标签页写入与其他标签页写入，避免 storage 变更回环
const TAB_ID = Math.random().toString(36).slice(2);

/* ──────────────────────────────────────────
   状态管理：意图锚 + 自动切换 + 实时信号灯
   ────────────────────────────────────────── */
// 干扰域名集合（来自 rules/site-groups.json 中的社交/内容/视频三组）
const DISTRACTION_DOMAINS = new Set([
  'twitter.com', 'x.com', 'weibo.com', 'threads.net', 'facebook.com', 'instagram.com',
  'zhihu.com', 'xiaohongshu.com', 'douban.com', 'tieba.baidu.com', 'reddit.com',
  'youtube.com', 'bilibili.com', 'douyin.com', 'iqiyi.com', 'youku.com',
]);

// 意图锚：本轮专注的一句话目标 + 完成结算
let intent = { text: '', startedAt: 0, sessionId: 0, history: [] };
const INTENT_KEY_PREFIX = 'bp_intent_';
function intentKey() { return INTENT_KEY_PREFIX + BPDB.todayKey(); }

// 实时信号灯：4 个客观信号 0~100
const signals = { fatigue: 0, multitask: 0, consistency: 0, distraction: 0 };
let consistencyBreaks = 0;       // 当前番茄期间切出工作域的次数
let distractionHitsToday = 0;    // 今天命中干扰域的切换次数

/* ── 持久化（按天） ── */
function focusKey() { return 'focus_' + BPDB.todayKey(); }
function loadFocus() {
  return new Promise((resolve) => {
    chrome.storage.local.get([focusKey(), intentKey()], (res) => {
      const data = res[focusKey()];
      if (data) {
        // 兼容老格式（旧版本 switchLog/checkedHarms），但本版本数据源已迁到 bp_autoSwitch_
        distractionHitsToday = data.distractionHitsToday || 0;
      }
      const it = res[intentKey()];
      if (it) intent = Object.assign(intent, it);
      resolve();
    });
  });
}

function persistIntent() {
  chrome.storage.local.set({ [intentKey()]: intent });
}

function renderIntent() {
  const body = document.getElementById('intentBody');
  if (!body) return;
  if (intent.text) {
    const mins = intent.startedAt ? Math.round((Date.now() - intent.startedAt) / 60000) : 0;
    body.innerHTML = `
      <div class="intent-active">
        <div class="intent-text">${escapeHtml(intent.text)}</div>
        <div class="intent-meta">
          <span class="badge badge-ok">已锚定</span>
          ${mins > 0 ? `<span class="intent-elapsed">已坚持 ${mins} 分钟</span>` : ''}
          <button class="intent-clear" id="intentClearBtn">清除</button>
        </div>
      </div>`;
    const btn = document.getElementById('intentClearBtn');
    if (btn) btn.addEventListener('click', clearIntent);
  } else {
    body.innerHTML = `
      <div class="intent-empty">还没设定本轮专注的目标。开始番茄时会自动询问，或现在就写下来 ↓</div>
      <div class="intent-input-row">
        <input type="text" id="intentInput" class="intent-input" maxlength="80" placeholder="例：写完报告第 3 节 / 改完 PR 反馈" />
        <button class="ctrl-btn" id="intentSetBtn">
          <svg class="ic ic-sm" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>锚定</button>
      </div>`;
    const btn = document.getElementById('intentSetBtn');
    const inp = document.getElementById('intentInput');
    if (btn) btn.addEventListener('click', () => setIntent(inp && inp.value));
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') setIntent(inp.value); });
  }
}

function setIntent(text) {
  const t = (text || '').trim();
  if (!t) return;
  intent.text = t;
  intent.startedAt = Date.now();
  intent.sessionId = Date.now();
  persistIntent();
  renderIntent();
  updateInsights(); updateCogBars();
}

function clearIntent() {
  if (intent.text) intent.history.push({ text: intent.text, startedAt: intent.startedAt, endedAt: Date.now(), result: 'cleared' });
  intent = { text: '', startedAt: 0, sessionId: 0, history: intent.history };
  persistIntent();
  renderIntent();
  updateInsights(); updateCogBars();
}

function reviewIntent(result) {
  if (!intent.text) return hideIntentReviewModal();
  intent.history.push({ text: intent.text, startedAt: intent.startedAt, endedAt: Date.now(), result });
  intent = { text: '', startedAt: 0, sessionId: 0, history: intent.history };
  persistIntent();
  hideIntentReviewModal();
  renderIntent();
  updateInsights(); updateCogBars();
  showToast(result === 'done' ? '✦ 意图达成，干得漂亮' : '记下了 — 下一轮会更专注', result === 'done' ? 'ok' : 'warn');
}

function showIntentReviewModal() {
  const modal = document.getElementById('intentReviewModal');
  if (!modal || !intent.text) return;
  document.getElementById('intentReviewText').textContent = `「${intent.text}」`;
  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add('show'));
}
function hideIntentReviewModal() {
  const modal = document.getElementById('intentReviewModal');
  if (!modal) return;
  modal.classList.remove('show');
  setTimeout(() => { modal.hidden = true; }, 240);
}

function showIntentInputModal(onConfirm, onSkip) {
  const modal = document.getElementById('intentModal');
  const inp = document.getElementById('intentModalInput');
  if (!modal || !inp) { onConfirm && onConfirm(''); return; }
  inp.value = intent.text || '';
  modal.hidden = false;
  requestAnimationFrame(() => { modal.classList.add('show'); inp.focus(); });
  const confirm = () => {
    const v = (inp.value || '').trim();
    hideIntentInputModal();
    if (v) setIntent(v);
    onConfirm && onConfirm(v);
  };
  const skip = () => { hideIntentInputModal(); onSkip && onSkip(); };
  document.getElementById('intentConfirmBtn').onclick = confirm;
  document.getElementById('intentSkipBtn').onclick = skip;
  inp.onkeydown = (e) => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') skip(); };
}
function hideIntentInputModal() {
  const modal = document.getElementById('intentModal');
  if (!modal) return;
  modal.classList.remove('show');
  setTimeout(() => { modal.hidden = true; }, 240);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showToast(msg, kind = 'ok') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + (kind === 'warn' ? 'toast-warn' : kind === 'danger' ? 'toast-danger' : 'toast-ok');
  setTimeout(() => { t.className = 'toast'; }, 2200);
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
  document.getElementById('startLabel').textContent = '开始';
  setPlayIcon('play');
  document.getElementById('focusScore').textContent = '—';
  persistTimer();
}

function updateTimerDisplay() {
  const m = Math.floor(timeLeft / 60), s = timeLeft % 60;
  document.getElementById('timerDisplay').textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function setPlayIcon(kind) {
  const el = document.querySelector('#startBtn .play-ic');
  if (el) el.innerHTML = kind === 'pause' ? SVG.pause : SVG.play;
}

function runningLabel() {
  return mode === 'pomodoro' ? '专注中' : mode === 'deep' ? '深度工作中' : '自定义专注中';
}

function updateProgressBar() {
  const pct = totalTime ? Math.round(((totalTime - timeLeft) / totalTime) * 100) : 0;
  document.getElementById('timerProgress').style.width = pct + '%';
}

function startTick() {
  clearInterval(interval);
  interval = setInterval(tick, 1000);
}

// 每秒根据墙钟终点重新计算剩余时间，避免标签页被节流时计时漂移
function tick() {
  if (running && timerEndAt) timeLeft = Math.max(0, Math.round((timerEndAt - Date.now()) / 1000));
  if (running && timeLeft <= 0) { completeTimer(); return; }
  updateTimerDisplay();
  updateProgressBar();
  updateFocusScore(); updateFocusTime();
}

function finishUI() {
  document.getElementById('startLabel').textContent = '开始';
  setPlayIcon('play');
  document.getElementById('timerLabel').textContent = '完成 · 休息一下';
  document.getElementById('timerProgress').style.width = '100%';
  updateTimerDisplay();
}

function completeTimer() {
  clearInterval(interval);
  running = false; timerEndAt = null; timeLeft = 0;
  finishUI();
  updateFocusScore(); updateFocusTime();
  // 只记录一次会话 / 只提醒一次：若其他标签页已标记完成则跳过
  chrome.storage.local.get([TIMER_KEY], (res) => {
    const st = res[TIMER_KEY];
    if (!(st && st.completed)) { saveSession(); notifyTimerDone(); }
    persistTimer();
    // 番茄结束后弹意图结算（仅当本轮锚定过意图）
    if (intent.text) setTimeout(showIntentReviewModal, 600);
  });
}

/* ── 完成提醒：页内弹窗 + 系统通知 + 提示音 ── */
// 读取提醒开关并同步到复选框
function loadNotifyPref() {
  return new Promise((resolve) => {
    chrome.storage.local.get([NOTIFY_KEY], (res) => {
      notifyEnabled = res[NOTIFY_KEY] === true;
      const cb = document.getElementById('notifyToggle');
      if (cb) cb.checked = notifyEnabled;
      resolve();
    });
  });
}

function toggleNotifyPref(on) {
  notifyEnabled = on;
  chrome.storage.local.set({ [NOTIFY_KEY]: on });
}

function modeName() {
  return mode === 'pomodoro' ? '番茄专注' : mode === 'deep' ? '深度工作' : '专注';
}

function notifyTimerDone() {
  if (!notifyEnabled) return; // 用户未勾选「完成后提醒」时不打扰
  const mins = Math.round(totalTime / 60);
  showTimerDoneModal(mins);
  playChime();
  // 标签页不在前台时，用系统通知提醒，避免错过
  if (document.visibilityState !== 'visible' && chrome.notifications) {
    try {
      chrome.notifications.create('bp-focus-done-' + Date.now(), {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '专注完成 · 脑力守护',
        message: `你已完成 ${mins} 分钟${modeName()}，休息一下吧。`,
        priority: 2,
      });
    } catch (e) { /* 无 notifications 权限时忽略 */ }
  }
}

function showTimerDoneModal(mins) {
  const modal = document.getElementById('timerDoneModal');
  if (!modal) return;
  document.getElementById('tdmSub').textContent =
    `你已完成 ${mins} 分钟${modeName()}，起身走一走，让前额叶恢复一下。`;
  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add('show'));
}

function hideTimerDoneModal() {
  const modal = document.getElementById('timerDoneModal');
  if (!modal) return;
  modal.classList.remove('show');
  setTimeout(() => { modal.hidden = true; }, 240);
}

// 用 Web Audio 合成一段轻柔的两声提示音，无需音频文件
function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1108.73].forEach((freq, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.5);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch (e) { /* 自动播放被拦截时忽略 */ }
}

function toggleTimer() {
  if (running) {
    clearInterval(interval); running = false; timerEndAt = null;
    document.getElementById('startLabel').textContent = '继续';
    document.getElementById('timerLabel').textContent = '已暂停';
    setPlayIcon('play');
    persistTimer();
  } else {
    const start = () => {
      if (timeLeft <= 0) timeLeft = totalTime; // 完成后再次点击 = 重新开始一轮
      running = true;
      consistencyBreaks = 0; // 新一轮清零专注一致性计数
      timerEndAt = Date.now() + timeLeft * 1000;
      document.getElementById('startLabel').textContent = '暂停';
      setPlayIcon('pause');
      document.getElementById('timerLabel').textContent = runningLabel();
      persistTimer();
      startTick();
      refreshSignals();
    };
    // 从待开始 / 完成 状态启动时弹意图输入；从暂停继续不弹
    const fresh = timeLeft <= 0 || timeLeft === totalTime;
    if (fresh && !intent.text) {
      showIntentInputModal(() => start(), () => start());
    } else {
      start();
    }
  }
}

function resetTimer() {
  clearInterval(interval); running = false; timerEndAt = null; timeLeft = totalTime;
  updateTimerDisplay();
  document.getElementById('timerProgress').style.width = '0%';
  document.getElementById('startLabel').textContent = '开始';
  setPlayIcon('play');
  document.getElementById('timerLabel').textContent = '待开始';
  document.getElementById('focusScore').textContent = '—';
  document.getElementById('focusTime').textContent = '00:00';
  document.getElementById('focusTimeSub').textContent = '未开始';
  persistTimer();
}

/* ── 计时器持久化 / 跨标签页恢复 ── */
function buildTimerState() {
  return {
    mode, totalTime, customMinutes,
    running,
    endAt: running ? timerEndAt : null,
    remaining: running ? null : timeLeft,
    completed: !running && timeLeft <= 0,
    writer: TAB_ID,
  };
}

function persistTimer() {
  chrome.storage.local.set({ [TIMER_KEY]: buildTimerState() });
}

// 把存储中的计时器状态应用到当前页面（用于初始加载与跨标签页同步）
function applyTimerState(st) {
  if (!st) return;
  mode = st.mode || 'pomodoro';
  customMinutes = st.customMinutes || customMinutes;
  if (mode === 'custom') MODES.custom = customMinutes * 60;
  totalTime = st.totalTime || MODES[mode] || MODES.pomodoro;

  ['pomodoro', 'deep', 'custom'].forEach((x) =>
    document.getElementById('mode' + x[0].toUpperCase() + x.slice(1)).classList.toggle('active', x === mode));

  clearInterval(interval);

  if (st.running && st.endAt) {
    const remain = Math.round((st.endAt - Date.now()) / 1000);
    if (remain > 0) {
      running = true; timerEndAt = st.endAt; timeLeft = remain;
      document.getElementById('startLabel').textContent = '暂停';
      setPlayIcon('pause');
      document.getElementById('timerLabel').textContent = runningLabel();
      startTick();
    } else {
      // 在标签页关闭期间已走完
      running = false; timerEndAt = null; timeLeft = 0;
      finishUI();
      if (!st.completed) { saveSession(); notifyTimerDone(); persistTimer(); }
    }
  } else if (st.completed) {
    running = false; timerEndAt = null; timeLeft = 0;
    finishUI();
  } else {
    running = false; timerEndAt = null;
    timeLeft = (st.remaining != null) ? st.remaining : totalTime;
    setPlayIcon('play');
    if (timeLeft < totalTime) {
      document.getElementById('startLabel').textContent = '继续';
      document.getElementById('timerLabel').textContent = '已暂停';
    } else {
      document.getElementById('startLabel').textContent = '开始';
      document.getElementById('timerLabel').textContent =
        mode === 'pomodoro' ? '番茄时钟 · 待开始' : mode === 'deep' ? '深度工作 · 待开始' : `自定义 ${customMinutes}min · 待开始`;
    }
  }

  updateTimerDisplay();
  updateProgressBar();
  if (running || timeLeft < totalTime) {
    updateFocusScore(); updateFocusTime();
  } else {
    document.getElementById('focusScore').textContent = '—';
    document.getElementById('focusTime').textContent = '00:00';
    document.getElementById('focusTimeSub').textContent = '未开始';
  }
}

function restoreTimer() {
  return new Promise((resolve) => {
    chrome.storage.local.get([TIMER_KEY], (res) => {
      applyTimerState(res[TIMER_KEY]);
      resolve();
    });
  });
}

// 监听其他标签页对计时器状态的修改，实时同步本页
function onTimerStorageChange(changes, area) {
  if (area !== 'local') return;
  // 提醒开关跨标签页同步
  if (changes[NOTIFY_KEY]) {
    notifyEnabled = changes[NOTIFY_KEY].newValue === true;
    const cb = document.getElementById('notifyToggle');
    if (cb) cb.checked = notifyEnabled;
  }
  if (!changes[TIMER_KEY]) return;
  const st = changes[TIMER_KEY].newValue;
  if (!st || st.writer === TAB_ID) return; // 忽略本页自身写入
  applyTimerState(st);
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
  const switchPenalty = Math.min(switchLog.length * 8, 40);
  const breakPenalty = Math.min(consistencyBreaks * 12, 40);
  const score = Math.max(0, Math.round(frac * 100) - switchPenalty - breakPenalty);
  const el = document.getElementById('focusScore');
  el.textContent = score;
  el.style.color = score >= 70 ? 'var(--teal)' : score >= 40 ? 'var(--amber)' : 'var(--crim)';
}

function renderSwitchLog() {
  const ul = document.getElementById('switchLog');
  if (!ul) return;
  if (!switchLog.length) {
    ul.innerHTML = '<li class="log-empty">尚未检测到切换 — 保持专注 ✦</li>';
    return;
  }
  // switchLog 项可以是字符串 "HH:MM" 或对象 { ts, host, distract }
  const recent = switchLog.slice().reverse();
  ul.innerHTML = recent.map((it, i) => {
    const count = switchLog.length - i;
    const sev = count <= 2 ? 'ok' : count <= 5 ? 'warn' : 'danger';
    const obj = typeof it === 'string' ? { ts: it } : it;
    const host = obj.host ? `<span class="log-host">${escapeHtml(obj.host)}</span>` : '';
    const tag = obj.distract ? '<span class="badge badge-danger">干扰域</span>' : `<span class="badge badge-${sev}">${count <= 2 ? '轻微' : count <= 5 ? '多任务' : '碎片化'}</span>`;
    return `<li class="log-item"><span class="log-time">${obj.ts || '--:--'}</span><span class="log-text">第${count}次 ${host}${tag}</span></li>`;
  }).join('');
}

// 信号灯指标定义（数据已由 refreshSignals 写入 signals 对象）
const SIGNAL_DEFS = [
  { key: 'fatigue',     label: '疲劳',     icon: '🌙', tip: '基于活跃时长与系统 idle' },
  { key: 'multitask',   label: '多任务',   icon: '🔀', tip: '当前打开的跨域名标签数' },
  { key: 'consistency', label: '专注一致', icon: '🎯', tip: '番茄期间切出工作域的次数' },
  { key: 'distraction', label: '干扰命中', icon: '📵', tip: '今天切换到社交 / 视频 / 内容站的次数' },
];

function renderSignalGrid() {
  const root = document.getElementById('signalGrid');
  if (!root) return;
  root.innerHTML = SIGNAL_DEFS.map((d) => {
    const v = Math.min(Math.round(signals[d.key] || 0), 100);
    const level = v < 30 ? 'ok' : v < 60 ? 'warn' : 'danger';
    return `<div class="signal-card signal-${level}" title="${d.tip}">
      <div class="signal-head"><span class="signal-icon">${d.icon}</span><span class="signal-label">${d.label}</span></div>
      <div class="signal-bar"><div class="signal-fill" style="width:${v}%"></div></div>
      <div class="signal-val">${v}<span class="signal-unit">/100</span></div>
    </div>`;
  }).join('');
}

// 把所有客观信号统一刷新到 signals 对象
async function refreshSignals() {
  // 多任务：所有窗口标签去重后的根域数
  signals.multitask = await new Promise((r) => {
    try {
      chrome.tabs.query({}, (tabs) => {
        const hosts = new Set();
        (tabs || []).forEach((t) => {
          try {
            const u = new URL(t.url || '');
            if (u.protocol.startsWith('http')) hosts.add(rootDomain(u.hostname));
          } catch (e) {}
        });
        // 6 个不同站点起算危险，>= 12 满格
        r(Math.min(Math.max(hosts.size - 2, 0) * 12, 100));
      });
    } catch (e) { r(0); }
  });

  // 干扰命中：今天命中干扰域名的切换次数
  signals.distraction = Math.min(distractionHitsToday * 18, 100);

  // 专注一致性：番茄期间切出工作域的次数（越多越糟）
  signals.consistency = running ? Math.min(consistencyBreaks * 20, 100) : 0;

  // 疲劳：累计活跃时间 + idle 状态
  signals.fatigue = await new Promise((r) => {
    try {
      chrome.idle.queryState(60, (state) => {
        // 90 分钟连续活跃 = 满格；idle 时降一档；locked 时大幅降
        const activeMins = running ? Math.round((totalTime - timeLeft) / 60) : Math.min(switchLog.length * 3, 90);
        let base = Math.min(activeMins / 90 * 100, 100);
        if (state === 'idle') base = Math.max(0, base - 20);
        if (state === 'locked') base = Math.max(0, base - 50);
        r(Math.round(base));
      });
    } catch (e) { r(0); }
  });

  renderSignalGrid();
  updateCogBars();
  updateInsights();
}

function rootDomain(host) {
  const p = (host || '').split('.');
  return p.length >= 2 ? p.slice(-2).join('.') : host;
}

const cogMetrics = [
  { label: '任务切换损耗', get: () => Math.min(switchLog.length * 12, 100) },
  { label: '工作记忆压力', get: () => Math.min((signals.multitask * 0.7) + switchLog.length * 4, 100) },
  { label: '注意力恢复成本', get: () => switchLog.length > 0 ? Math.min(20 + switchLog.length * 8 + consistencyBreaks * 10, 100) : 0 },
  { label: '前额叶疲劳', get: () => Math.min(signals.fatigue, 100) },
];

function updateCogBars() {
  const root = document.getElementById('cogBars');
  if (!root) return;
  root.innerHTML = cogMetrics.map((m) => {
    const val = Math.min(Math.round(m.get()), 100);
    const c = val < 30 ? 'var(--teal)' : val < 60 ? 'var(--amber)' : 'var(--crim)';
    return `<div class="cog-row">
      <span class="cog-lbl">${m.label}</span>
      <div class="cog-track"><div class="cog-fill" style="width:${val}%;background:${c}"></div></div>
      <span class="cog-val">${val}%</span>
    </div>`;
  }).join('');
}

function updateInsights() {
  const root = document.getElementById('insights');
  if (!root) return;
  const msgs = [];

  // 意图相关
  if (running && !intent.text) {
    msgs.push({ t: 'warn', x: '当前番茄没有锚定意图 — 写下一句具体目标可显著降低中途分心。' });
  }
  if (intent.text && running) {
    msgs.push({ t: 'ok', x: `当前意图：「${intent.text}」— 把注意力收回到这一件事上。` });
  }

  // 信号灯衍生建议
  if (signals.consistency >= 60) {
    msgs.push({ t: 'danger', x: `本轮已离开工作域 ${consistencyBreaks} 次 — 每次切换平均消耗 23 分钟恢复成本。` });
  } else if (signals.consistency >= 30) {
    msgs.push({ t: 'warn', x: '注意：本轮已经有几次离开工作域，关闭无关标签页保持心流。' });
  }
  if (signals.distraction >= 60) {
    msgs.push({ t: 'danger', x: `今天已 ${distractionHitsToday} 次切到社交 / 视频站 — 考虑临时屏蔽。` });
  } else if (signals.distraction >= 30) {
    msgs.push({ t: 'warn', x: '出现了几次干扰站点访问，把手机翻到屏幕朝下，关闭通知。' });
  }
  if (signals.multitask >= 60) {
    msgs.push({ t: 'warn', x: '同时打开的站点过多 — 多窗口等于隐性持续切换，只留一个任务界面。' });
  }
  if (signals.fatigue >= 70) {
    msgs.push({ t: 'danger', x: '连续高强度活跃 — 前额叶资源接近耗尽，立刻起身 2 分钟。' });
  }
  if (switchLog.length >= 6) {
    msgs.push({ t: 'danger', x: `今日已切换 ${switchLog.length} 次。建议番茄结束后真正休息 5 分钟。` });
  }

  if (!msgs.length) {
    msgs.push({ t: 'ok', x: '一切正常 — 保持当前状态，继续深度工作。' });
  }

  root.innerHTML = msgs.map((m) => `<div class="insight-box insight-${m.t}">${m.x}</div>`).join('');
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

  // 完成弹窗：休息 / 再来一轮 / 点击遮罩或 Esc 关闭
  document.getElementById('tdmRestBtn').addEventListener('click', hideTimerDoneModal);
  document.getElementById('tdmAgainBtn').addEventListener('click', () => { hideTimerDoneModal(); toggleTimer(); });
  document.getElementById('timerDoneModal').addEventListener('click', (e) => {
    if (e.target.id === 'timerDoneModal') hideTimerDoneModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideTimerDoneModal(); hideIntentInputModal(); hideIntentReviewModal(); }
  });

  // 意图锚结算弹窗按钮
  const doneBtn = document.getElementById('intentDoneBtn');
  const missBtn = document.getElementById('intentMissBtn');
  if (doneBtn) doneBtn.addEventListener('click', () => reviewIntent('done'));
  if (missBtn) missBtn.addEventListener('click', () => reviewIntent('miss'));

  // 完成提醒开关
  document.getElementById('notifyToggle').addEventListener('change', (e) => toggleNotifyPref(e.target.checked));
}

/* ════════════════════════════════════════
   新标签页接管：弹窗检测 / 首次征询 / 开关
   ════════════════════════════════════════ */
let isPopupCtx = false;

function setToggleState(on) {
  const t = document.getElementById('ntToggle');
  if (!t) return;
  t.classList.toggle('on', on);
  t.setAttribute('aria-checked', on ? 'true' : 'false');
}

function showConsent() {
  const m = document.getElementById('consentModal');
  if (m) m.hidden = false;
}
function hideConsent() {
  const m = document.getElementById('consentModal');
  if (m) m.hidden = true;
}

function bindNewtabPrefs() {
  const toggle = document.getElementById('ntToggle');
  if (toggle) toggle.addEventListener('click', () => {
    const willOn = !toggle.classList.contains('on');
    setToggleState(willOn);
    chrome.storage.local.set({ newtabTakeover: willOn });
  });

  const accept = document.getElementById('consentAccept');
  if (accept) accept.addEventListener('click', () => {
    chrome.storage.local.set({ newtabTakeover: true });
    setToggleState(true);
    hideConsent();
  });

  const decline = document.getElementById('consentDecline');
  if (decline) decline.addEventListener('click', () => {
    chrome.storage.local.set({ newtabTakeover: false });
    setToggleState(false);
    hideConsent();
    // 在真实新标签页中拒绝接管时，立即跳转空白页以体现效果
    if (!isPopupCtx) location.replace('about:blank');
  });
}

/* 弹窗模式检测 + 读取接管偏好（未决定则首次征询）。
   作为工具栏 popup 打开时无对应 tab → 加宽布局并展示提示条。 */
function initNewtabPrefs() {
  try {
    chrome.tabs.getCurrent((tab) => {
      isPopupCtx = !tab;
      if (isPopupCtx) {
        document.body.classList.add('is-popup');
        const openBtn = document.getElementById('popupHintOpen');
        if (openBtn) openBtn.addEventListener('click', () => {
          chrome.tabs.create({});
          window.close();
        });
      }
      chrome.storage.local.get(['newtabTakeover'], (res) => {
        const v = res.newtabTakeover;
        setToggleState(v !== false);              // 仅显式关闭时为 off
        if (v === undefined || v === null) showConsent();  // 首次使用：征询
      });
    });
  } catch (_) { /* 非扩展环境，忽略 */ }
}

async function init() {
  bindNewtabPrefs();
  initNewtabPrefs();
  greet();
  bindEvents();
  setupTabs();
  await loadFocus();
  await loadNotifyPref();
  await syncAutoSwitchFromBg();
  await restoreTimer();
  chrome.storage.onChanged.addListener(onTimerStorageChange);
  chrome.storage.onChanged.addListener(onAutoSwitchStorageChange);
  document.getElementById('switchCount').textContent = switchLog.length;
  renderIntent();
  renderSwitchLog();
  renderSignalGrid();
  updateCogBars();
  updateInsights();
  refreshSignals();
  renderTimeDashboard();
  // 数据可能在打开期间被后台更新，定时刷新（含进行中活跃段的实时合并）
  setInterval(renderTimeDashboard, 5000);
  // 信号灯每 20s 自检一次（idle / 多任务 / 疲劳是连续变量）
  setInterval(refreshSignals, 20000);
  // 意图锚的"已坚持 N 分钟"每 60s 重渲一次
  setInterval(() => { if (intent.text) renderIntent(); }, 60000);
}

/* ── 监听后台自动写入的切换日志 ── */
const BG_SWITCH_KEY_PREFIX = 'bp_autoSwitch_';
function bgSwitchKey() { return BG_SWITCH_KEY_PREFIX + BPDB.todayKey(); }

async function syncAutoSwitchFromBg() {
  return new Promise((resolve) => {
    chrome.storage.local.get([bgSwitchKey()], (res) => {
      const data = res[bgSwitchKey()];
      if (data && Array.isArray(data.entries)) {
        switchLog = data.entries.slice(-200); // 上限避免无限增长
        distractionHitsToday = data.entries.filter((e) => e && e.distract).length;
        consistencyBreaks = data.consistencyBreaks || 0;
      }
      resolve();
    });
  });
}

function onAutoSwitchStorageChange(changes, area) {
  if (area !== 'local') return;
  if (!changes[bgSwitchKey()]) return;
  const data = changes[bgSwitchKey()].newValue;
  if (!data || !Array.isArray(data.entries)) return;
  switchLog = data.entries.slice(-200);
  distractionHitsToday = data.entries.filter((e) => e && e.distract).length;
  consistencyBreaks = data.consistencyBreaks || 0;
  const el = document.getElementById('switchCount');
  if (el) el.textContent = switchLog.length;
  renderSwitchLog();
  refreshSignals();
}

document.addEventListener('DOMContentLoaded', init);

/* ════════════════════════════════════════
   AI 行为洞察（顶部独立菜单 · 综合：历史指标 + 当前标签页 + 任务管理 + 番茄/意图 + 信号灯）
   ════════════════════════════════════════ */
let _aiBusy = false;
let _aiMermaidReady = false;
let _aiMermaidSeq = 0;

function escAI(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ensureAIMermaid() {
  if (typeof window.mermaid === 'undefined') return null;
  if (!_aiMermaidReady) {
    try {
      const dark = resolvedDark();
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: dark ? 'dark' : 'default',
        fontFamily: 'inherit',
        themeVariables: dark
          ? { background: 'transparent', primaryColor: '#1e2a3a', primaryTextColor: '#e6ecf3', lineColor: '#5b6b80' }
          : { background: 'transparent', primaryColor: '#fff3e6', primaryTextColor: '#1a2533', lineColor: '#6f7d92' },
      });
      _aiMermaidReady = true;
    } catch (e) { /* ignore */ }
  }
  return window.mermaid;
}

function renderAIMarkdown(md) {
  const text = String(md || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (typeof window.marked === 'undefined') {
    return '<pre class="ai-fallback">' + escAI(text) + '</pre>';
  }
  try {
    if (window.marked.setOptions) window.marked.setOptions({ breaks: true, gfm: true });
    const renderer = new window.marked.Renderer();
    const origCode = renderer.code.bind(renderer);
    renderer.code = function (code, infostring) {
      const lang = (infostring || '').trim().toLowerCase().split(/\s+/)[0] || '';
      if (lang === 'mermaid') {
        const id = 'bp-nt-mmd-' + (++_aiMermaidSeq);
        return '<div class="mermaid-wrap"><div class="mermaid" id="' + id + '">' + escAI(code) + '</div></div>';
      }
      return origCode(code, infostring);
    };
    return window.marked.parse(text, { renderer });
  } catch (e) {
    return '<pre class="ai-fallback">' + escAI(text) + '</pre>';
  }
}

async function renderAIMermaidIn(container) {
  if (!container) return;
  const nodes = container.querySelectorAll('.mermaid');
  if (!nodes.length) return;
  const mm = ensureAIMermaid();
  if (!mm) return;
  for (const node of nodes) {
    if (node.dataset.bpRendered === '1') continue;
    const src = node.textContent || '';
    const id = node.id || 'bp-nt-mmd-x-' + (++_aiMermaidSeq);
    try {
      const { svg, bindFunctions } = await mm.render(id + '-svg', src);
      node.innerHTML = svg;
      if (typeof bindFunctions === 'function') bindFunctions(node);
      node.dataset.bpRendered = '1';
    } catch (err) {
      node.innerHTML = '<pre class="mermaid-error">Mermaid 渲染失败：'
        + escAI(err && err.message ? err.message : String(err))
        + '\n\n' + escAI(src) + '</pre>';
      node.dataset.bpRendered = '1';
    }
  }
}

function setAIOutput(html, cls) {
  const out = document.getElementById('aiOutput');
  if (!out) return;
  out.className = 'ai-output' + (cls ? ' ' + cls : '');
  out.innerHTML = html;
  renderAIMermaidIn(out);
}

/* —— 收集「此刻」的额外上下文 —— */
function rootDomainOf(url) {
  try {
    const h = new URL(url).hostname;
    if (window.BPCat && BPCat.rootDomain) return BPCat.rootDomain(h) || h;
    return h;
  } catch (e) { return ''; }
}

function normalizeUrl(url) {
  try { const u = new URL(url); return (u.origin + u.pathname).replace(/\/$/, ''); }
  catch (e) { return url || ''; }
}

async function collectTabsContext() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (e) { tabs = []; }
  const STALE_MS = 12 * 3600 * 1000;
  const now = Date.now();

  const winSet = new Set();
  const domainMap = new Map();
  const urlCount = new Map();
  let pinned = 0, audible = 0, stale = 0;

  for (const t of tabs) {
    if (t.windowId != null) winSet.add(t.windowId);
    const d = rootDomainOf(t.url) || '本地/浏览器';
    domainMap.set(d, (domainMap.get(d) || 0) + 1);
    const u = normalizeUrl(t.url);
    urlCount.set(u, (urlCount.get(u) || 0) + 1);
    if (t.pinned) pinned++;
    if (t.audible) audible++;
    if (typeof t.lastAccessed === 'number' && (now - t.lastAccessed > STALE_MS)) stale++;
  }
  let duplicates = 0;
  urlCount.forEach((c) => { if (c > 1) duplicates += c - 1; });

  // Top 域名（按打开数）
  const topDomains = [...domainMap.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([domain, count]) => ({ domain, count }));

  // 类别归类（依赖 site-groups 规则）
  const byCategory = new Map();
  try {
    const rules = await BPCat.getRules();
    for (const t of tabs) {
      const cat = BPCat.siteGroupOf(rootDomainOf(t.url), rules.siteGroups);
      byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
    }
  } catch (e) { /* ignore */ }
  const categoryShare = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));

  return {
    total: tabs.length,
    unique_windows: winSet.size,
    unique_domains: domainMap.size,
    pinned, audible_playing: audible,
    stale_over_12h: stale,
    duplicate_tabs: duplicates,
    top_domains: topDomains,
    category_share: categoryShare,
  };
}

function fmtSec(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

function collectFocusContext() {
  const remainingSec = (typeof timerEndAt === 'number' && timerEndAt > Date.now())
    ? Math.round((timerEndAt - Date.now()) / 1000)
    : (typeof timeLeft === 'number' ? timeLeft : 0);
  const totalSec = typeof totalTime === 'number' ? totalTime : 0;
  const elapsedSec = Math.max(0, totalSec - remainingSec);
  return {
    running: !!running,
    mode: mode || 'pomodoro',
    total_seconds: totalSec,
    remaining_seconds: remainingSec,
    remaining_readable: fmtSec(remainingSec),
    elapsed_seconds: running ? elapsedSec : 0,
    notify_enabled: !!notifyEnabled,
  };
}

function collectIntentContext() {
  if (!intent || !intent.text) return { active: false };
  const ageMin = intent.startedAt ? Math.round((Date.now() - intent.startedAt) / 60000) : 0;
  return {
    active: true,
    text: intent.text,
    minutes_since_set: ageMin,
    history_count: Array.isArray(intent.history) ? intent.history.length : 0,
  };
}

function collectSignalsContext() {
  return {
    fatigue: Math.round(signals.fatigue || 0),
    multitask: Math.round(signals.multitask || 0),
    consistency_break: Math.round(signals.consistency || 0),
    distraction: Math.round(signals.distraction || 0),
    switch_count_today: switchLog.length,
    consistency_breaks_this_pomodoro: consistencyBreaks,
    distraction_hits_today: distractionHitsToday,
  };
}

function nowContext() {
  const d = new Date();
  const wk = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return {
    iso: d.toISOString(),
    local: d.toLocaleString('zh-CN', { hour12: false }),
    weekday: wk,
    hour: d.getHours(),
  };
}

async function collectAIExtras() {
  const tabs = await collectTabsContext();
  return {
    now: nowContext(),
    open_tabs: tabs,
    task_management: {
      stale_tabs: tabs.stale_over_12h,
      duplicate_tabs: tabs.duplicate_tabs,
      total_open: tabs.total,
      windows: tabs.unique_windows,
      suggestion_hint: tabs.stale_over_12h + tabs.duplicate_tabs > 0
        ? '存在可清理的陈旧 / 重复标签页，可在「任务管理」一键处理'
        : '标签页较为整洁',
    },
    focus_timer: collectFocusContext(),
    intent_anchor: collectIntentContext(),
    live_signals: collectSignalsContext(),
  };
}

function paintAIChips(extras) {
  const t = extras.open_tabs || {};
  const set = (id, text, cls) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove('warn', 'ok');
    if (cls) el.classList.add(cls);
  };
  set('aiChipTabs', `标签页 ${t.total || 0} · ${t.unique_windows || 0} 窗 · ${t.unique_domains || 0} 域`);
  const taskWarn = (t.stale_over_12h || 0) + (t.duplicate_tabs || 0);
  set('aiChipTasks', `任务 陈旧 ${t.stale_over_12h || 0} · 重复 ${t.duplicate_tabs || 0}`, taskWarn > 0 ? 'warn' : 'ok');
  const f = extras.focus_timer || {};
  set('aiChipFocus', f.running ? `番茄 ${f.mode} · 剩 ${f.remaining_readable}` : '番茄 未开始');
  const it = extras.intent_anchor || {};
  set('aiChipIntent', it.active ? `意图 已坚持 ${it.minutes_since_set} 分钟` : '意图 未锚定');
  const sig = extras.live_signals || {};
  set('aiChipSwitch', `切换 ${sig.switch_count_today || 0} · 干扰命中 ${sig.distraction_hits_today || 0}`,
    (sig.distraction_hits_today || 0) >= 3 ? 'warn' : '');
}

async function updateAIChips() {
  try {
    const extras = await collectAIExtras();
    paintAIChips(extras);
    // 今日浏览/创作时长直接读 metric 条已有数字（已实时刷新）
    const browseEl = document.getElementById('tdTotalBrowse');
    const createEl = document.getElementById('tdTotalCreate');
    const cb = document.getElementById('aiChipBrowse');
    const cc = document.getElementById('aiChipCreate');
    if (cb && browseEl) cb.textContent = '今日浏览 ' + (browseEl.textContent || '—');
    if (cc && createEl) cc.textContent = '今日创作 ' + (createEl.textContent || '—');
  } catch (e) { /* ignore */ }
}

async function runAIAnalysis() {
  if (_aiBusy) return;
  if (!window.BPAI) { setAIOutput('❌ AI 模块未加载', 'error'); return; }
  const btn = document.getElementById('aiRunBtn');
  const sel = document.getElementById('aiDays');
  const days = sel ? Math.max(1, parseInt(sel.value, 10) || 7) : 7;
  _aiBusy = true;
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
  setAIOutput('正在汇总最近 ' + days + ' 天的本地行为数据，并整合当前标签页 / 任务 / 番茄状态…（一般 5–30 秒）', 'loading');
  const startedAt = Date.now();
  try {
    const extras = await collectAIExtras();
    paintAIChips(extras);
    const { metrics, reply } = await BPAI.analyze({ days, extras });
    const finishedAt = Date.now();
    const cost = ((finishedAt - startedAt) / 1000).toFixed(1) + 's';
    const meta = `<div class="ai-meta">窗口：${escAI(metrics.window.start_day)} → ${escAI(metrics.window.end_day)} · `
      + `${metrics.totals.record_count} 条记录 · 切换 ${metrics.switching.total_switches} 次 · `
      + `当前 ${extras.open_tabs.total} 标签页 · 耗时 ${cost}</div>`;
    setAIOutput(renderAIMarkdown(reply) + meta);
    saveAILastReport({
      reply: String(reply || ''),
      days,
      finishedAt,
      cost,
      window: metrics.window,
      record_count: metrics.totals.record_count,
      switches: metrics.switching.total_switches,
      tabs_total: extras.open_tabs.total,
    });
  } catch (e) {
    setAIOutput('❌ ' + escAI(e && e.message ? e.message : String(e)), 'error');
  } finally {
    _aiBusy = false;
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

function openOptionsAtAIPanel() {
  try {
    const target = chrome.runtime.getURL('options/options.html') + '#aiPanel';
    chrome.tabs.create({ url: target });
  } catch (e) { /* ignore */ }
}

/* —— 最近 AI 报告（最多 7 份）：持久化 / 渲染 / 导出 —— */
const AI_LAST_KEY = 'bp_ai_last_report';      // 旧版单条键，仅用于一次性迁移
const AI_LIST_KEY = 'bp_ai_reports';          // 新版列表键
const AI_MAX_REPORTS = 7;
const AI_EXCERPT_LEN = 90;                    // 卡片摘要字符上限
let _aiReports = [];                          // 按时间倒序，最新在前
let _aiActiveIdx = -1;                        // -1 = 未展开任何报告；>=0 = 当前在输出区展示的报告下标

function _aiActiveReport() {
  if (!_aiReports || !_aiReports.length) return null;
  if (_aiActiveIdx < 0 || _aiActiveIdx >= _aiReports.length) return null;
  return _aiReports[_aiActiveIdx] || null;
}

/**
 * 从 Markdown 报告中提取一段纯文本摘要，用于卡片预览。
 * - 去掉代码块（含 mermaid）、标题井号、列表前缀、加粗/斜体标记等；
 * - 取前 N 个非空字符，超出加省略号。
 */
function aiReplyExcerpt(md, limit) {
  const max = limit || AI_EXCERPT_LEN;
  if (!md) return '';
  let s = String(md);
  s = s.replace(/```[\s\S]*?```/g, ' ');         // 代码块
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');   // 图片
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // 链接保留文本
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');      // 标题井号
  s = s.replace(/^\s*[-*+]\s+/gm, '');           // 无序列表
  s = s.replace(/^\s*\d+\.\s+/gm, '');           // 有序列表
  s = s.replace(/^\s*>\s?/gm, '');               // 引用
  s = s.replace(/[*_`~]+/g, '');                 // 强调/行内代码
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return s;
}

function fmtAILastTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  const sameDay = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 3600 * 1000) return Math.round(diff / 60000) + ' 分钟前';
  if (sameDay) return '今天 ' + hh + ':' + mm;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da} ${hh}:${mm}`;
}

function fmtAIShortTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return '今天 ' + hh + ':' + mm;
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${mo}-${da} ${hh}:${mm}`;
}

function renderAIRecap() {
  const hint = document.getElementById('aiLastRunHint');
  updateAIExportBtn();
  const latest = _aiReports && _aiReports[0];
  if (!latest) {
    if (hint) hint.textContent = '';
    renderAIHistoryList();
    return;
  }
  const timeText = '上次分析：' + fmtAILastTime(latest.finishedAt)
    + '（最近 ' + (latest.days || 7) + ' 天）';
  if (hint) hint.textContent = ' · ' + timeText;
  renderAIHistoryList();
}

function updateAIExportBtn() {
  const btn = document.getElementById('aiExportBtn');
  if (!btn) return;
  const active = _aiActiveReport();
  const has = !!(active && active.reply);
  btn.hidden = !has;
}

function renderAIHistoryList() {
  const wrap = document.getElementById('aiHistoryList');
  if (!wrap) return;
  if (!_aiReports || !_aiReports.length) {
    wrap.innerHTML = '<div class="ai-history-empty">暂无历史报告，点击上方「开始 AI 分析」即可生成第一份。</div>';
    return;
  }
  const items = _aiReports.slice(0, AI_MAX_REPORTS).map((r, i) => {
    const isActive = (i === _aiActiveIdx);
    const title = `最近 ${r.days || 7} 天分析`;
    const sub = fmtAIShortTime(r.finishedAt)
      + (r.record_count != null ? ' · ' + r.record_count + ' 条' : '')
      + (r.switches != null ? ' · 切换 ' + r.switches : '');
    const excerpt = aiReplyExcerpt(r.reply) || '（报告内容为空）';
    const ariaPressed = isActive ? 'true' : 'false';
    return `<button type="button" class="ai-card${isActive ? ' active' : ''}" data-idx="${i}" `
      + `aria-pressed="${ariaPressed}" title="${isActive ? '点击收起完整报告' : '点击查看完整报告'}">`
      + `<div class="ai-card-head">`
      + `<span class="ai-card-idx">#${i + 1}</span>`
      + `<span class="ai-card-title">${escAI(title)}</span>`
      + `<span class="ai-card-time">${escAI(fmtAIShortTime(r.finishedAt))}</span>`
      + `</div>`
      + `<div class="ai-card-sub">${escAI(sub)}</div>`
      + `<div class="ai-card-excerpt">${escAI(excerpt)}</div>`
      + `<div class="ai-card-foot">${isActive ? '已展开 · 点击收起' : '点击查看完整报告 →'}</div>`
      + `</button>`;
  }).join('');
  wrap.innerHTML = items;
  wrap.querySelectorAll('.ai-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10) || 0;
      if (idx === _aiActiveIdx) {
        // 再次点击当前选中的卡片 → 收起详情
        _aiActiveIdx = -1;
        clearAIOutput();
      } else {
        _aiActiveIdx = idx;
        renderAIRecapIntoModalOutput();
      }
      renderAIHistoryList();
      updateAIExportBtn();
    });
  });
}

function clearAIOutput() {
  const out = document.getElementById('aiOutput');
  if (!out) return;
  out.className = 'ai-output';
  out.innerHTML = '';
}

function renderAIRecapIntoModalOutput() {
  const r = _aiActiveReport();
  if (!r || !r.reply) return;
  const out = document.getElementById('aiOutput');
  if (!out) return;
  const meta = `<div class="ai-meta">报告时间：${escAI(fmtAILastTime(r.finishedAt))}`
    + `（最近 ${r.days || 7} 天`
    + (r.window ? ` · ${escAI(r.window.start_day)} → ${escAI(r.window.end_day)}` : '')
    + `）${r.record_count != null ? ' · ' + r.record_count + ' 条记录' : ''}`
    + `${r.switches != null ? ' · 切换 ' + r.switches + ' 次' : ''}`
    + `${r.cost ? ' · 耗时 ' + escAI(r.cost) : ''}</div>`;
  setAIOutput(renderAIMarkdown(r.reply) + meta);
}

function saveAILastReport(report) {
  if (!report) return;
  _aiReports.unshift(report);
  if (_aiReports.length > AI_MAX_REPORTS) _aiReports.length = AI_MAX_REPORTS;
  _aiActiveIdx = 0;
  try {
    chrome.storage.local.set({ [AI_LIST_KEY]: _aiReports });
    // 旧版单条键不再使用，清理以释放空间
    chrome.storage.local.remove([AI_LAST_KEY]);
  } catch (e) { /* ignore */ }
  renderAIRecap();
}

function loadAILastReport() {
  try {
    chrome.storage.local.get([AI_LIST_KEY, AI_LAST_KEY], (res) => {
      const list = res && Array.isArray(res[AI_LIST_KEY]) ? res[AI_LIST_KEY].slice(0) : [];
      // 一次性迁移旧版单条数据
      if (!list.length && res && res[AI_LAST_KEY]) {
        list.push(res[AI_LAST_KEY]);
        try {
          chrome.storage.local.set({ [AI_LIST_KEY]: list });
          chrome.storage.local.remove([AI_LAST_KEY]);
        } catch (e) { /* ignore */ }
      }
      _aiReports = list.slice(0, AI_MAX_REPORTS);
      _aiActiveIdx = -1;   // 打开页面/弹窗时默认不展开任何一份，避免拥挤
      renderAIRecap();
    });
  } catch (e) { /* ignore */ }
}

function exportAILastReport() {
  const r = _aiActiveReport();
  if (!r || !r.reply) {
    if (typeof showToast === 'function') showToast('暂无可导出的报告，请先生成一次 AI 分析', 'warn');
    return;
  }
  const d = new Date(r.finishedAt || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  const header = `# 脑力守护 · AI 行为洞察报告\n\n`
    + `- 生成时间：${d.toLocaleString('zh-CN', { hour12: false })}\n`
    + `- 分析窗口：最近 ${r.days || 7} 天`
    + (r.window ? `（${r.window.start_day} → ${r.window.end_day}）` : '') + `\n`
    + (r.record_count != null ? `- 行为记录：${r.record_count} 条\n` : '')
    + (r.switches != null ? `- 切换次数：${r.switches}\n` : '')
    + (r.tabs_total != null ? `- 当时标签页数：${r.tabs_total}\n` : '')
    + (r.cost ? `- 调用耗时：${r.cost}\n` : '')
    + `\n---\n\n`;
  const md = header + String(r.reply || '');
  try {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `脑力守护-AI洞察_${stamp}.md`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
    if (typeof showToast === 'function') showToast('已导出 Markdown 报告', 'ok');
  } catch (e) {
    if (typeof showToast === 'function') showToast('导出失败：' + (e && e.message ? e.message : e), 'warn');
  }
}

/* —— AI 洞察弹窗 —— */
function openAIInsightModal() {
  const m = document.getElementById('aiInsightModal');
  if (!m) return;
  m.hidden = false;
  requestAnimationFrame(() => m.classList.add('show'));
  updateAIChips();
  renderAIHistoryList();
  // 默认不展开任何一份历史报告，由用户点击卡片来查看详情，避免 UI 拥挤。
  // 若上次用户主动展开过某一份（_aiActiveIdx >= 0）则保留，否则清空输出区。
  if (_aiActiveIdx < 0) {
    clearAIOutput();
  } else {
    renderAIRecapIntoModalOutput();
  }
  updateAIExportBtn();
}
function closeAIInsightModal() {
  const m = document.getElementById('aiInsightModal');
  if (!m) return;
  m.classList.remove('show');
  setTimeout(() => { m.hidden = true; }, 220);
}

function initAIInsightPanel() {
  const btn = document.getElementById('aiRunBtn');
  if (btn) btn.addEventListener('click', runAIAnalysis);
  const cfg = document.getElementById('aiCfgBtn');
  if (cfg) cfg.addEventListener('click', openOptionsAtAIPanel);
  const exportBtn = document.getElementById('aiExportBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportAILastReport);

  // 顶栏「AI 洞察」按钮
  const openBtn = document.getElementById('aiInsightOpenBtn');
  if (openBtn) openBtn.addEventListener('click', openAIInsightModal);

  // 弹窗关闭：按钮 / 点击遮罩 / ESC
  const closeBtn = document.getElementById('aiInsightCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeAIInsightModal);
  const overlay = document.getElementById('aiInsightModal');
  if (overlay) overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeAIInsightModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const m = document.getElementById('aiInsightModal');
      if (m && !m.hidden) closeAIInsightModal();
    }
  });

  // 主题变化后 mermaid 颜色需重置
  themeMQ.addEventListener('change', () => { _aiMermaidReady = false; });
  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) themeBtn.addEventListener('click', () => { _aiMermaidReady = false; });

  // 首次渲染 chips + 周期刷新
  updateAIChips();
  setInterval(updateAIChips, 4000);

  // 载入最近一次 AI 报告
  loadAILastReport();
}

document.addEventListener('DOMContentLoaded', initAIInsightPanel);
