/* global BPDB, BPCat */
'use strict';

let dark = false;
function applyTheme() {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : '');
  document.getElementById('themeBtn').textContent = dark ? '☀️ 白天' : '🌙 暗黑';
}
chrome.storage.local.get(['theme'], (res) => {
  dark = res.theme === 'dark' || (!res.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  applyTheme();
});
document.getElementById('themeBtn').addEventListener('click', () => {
  dark = !dark; applyTheme(); chrome.storage.local.set({ theme: dark ? 'dark' : 'light' });
});
document.getElementById('optionsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());

function fmtDur(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return sec + 's';
  const m = Math.round(sec / 60);
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function daysAgoKey(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return BPDB.dayKey(d.getTime());
}

let _categories = null;

/** 取后台进行中的活跃段（心跳之外的最后几十秒），合成一条临时记录 */
async function fetchLiveRecord(today) {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_LIVE' });
    const L = resp && resp.live;
    if (!L || !(L.elapsed > 0)) return null;
    return {
      domain: L.domain, category: L.category, time_type: L.time_type,
      duration_seconds: L.elapsed, day: today, title: '', tags: [], content_type: 'page',
    };
  } catch (e) { return null; }
}

async function main() {
  const today = BPDB.todayKey();
  document.getElementById('dateSub').textContent = today + ' · 数据完全本地存储';

  if (!_categories) ({ categories: _categories } = await BPCat.getRules());
  const categories = _categories;
  let todayRecords = [], weekRecords = [], sessions = [];
  try {
    todayRecords = await BPDB.getRecordsByDay(today);
    weekRecords = await BPDB.getRecordsInRange(daysAgoKey(6), today);
    sessions = await BPDB.getSessionsByDay(today);
  } catch (e) { /* ignore */ }

  // 合并进行中的活跃段，让浏览/创作时间无需等落盘即可实时显示
  const live = await fetchLiveRecord(today);
  if (live) { todayRecords = todayRecords.concat(live); weekRecords = weekRecords.concat(live); }

  renderSummary(todayRecords, sessions);
  renderBrowseVsCreate(todayRecords);
  renderSiteRank(todayRecords);
  renderCatDist(todayRecords, categories);
  renderZhihuTopics(weekRecords);
  renderCreateDetail(todayRecords);
  renderWeekTrend(weekRecords);
}

function aggBy(records, keyFn) {
  const map = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (k == null) continue;
    map.set(k, (map.get(k) || 0) + (r.duration_seconds || 0));
  }
  return map;
}

function renderSummary(records, sessions) {
  let browse = 0, create = 0;
  const siteMap = new Map();
  for (const r of records) {
    const dur = r.duration_seconds || 0;
    if (r.time_type === 'creating') create += dur; else browse += dur;
    siteMap.set(r.domain, (siteMap.get(r.domain) || 0) + dur);
  }
  const top = [...siteMap.entries()].sort((a, b) => b[1] - a[1])[0];
  const cards = [
    { lbl: '浏览总时长', val: fmtDur(browse), sub: '今日', color: 'var(--tx-primary)' },
    { lbl: '创作总时长', val: fmtDur(create), sub: '键盘输入', color: 'var(--green)' },
    { lbl: '使用最多', val: top ? BPCat.prettyDomain(top[0]) : '—', sub: top ? fmtDur(top[1]) : '暂无', color: 'var(--tx-primary)' },
    { lbl: '完成专注', val: (sessions.length || 0) + ' 轮', sub: '番茄/深度', color: 'var(--bar-purple)' },
  ];
  document.getElementById('summaryCards').innerHTML = cards.map((c) =>
    `<div class="card"><div class="lbl">${c.lbl}</div><div class="val" style="color:${c.color}">${esc(c.val)}</div><div class="sub">${esc(c.sub)}</div></div>`
  ).join('');
}

function renderBrowseVsCreate(records) {
  let browse = 0, create = 0;
  for (const r of records) {
    if (r.time_type === 'creating') create += r.duration_seconds || 0;
    else browse += r.duration_seconds || 0;
  }
  const total = browse + create || 1;
  document.getElementById('bvcBar').innerHTML =
    `<div class="split-seg" style="width:${(browse / total * 100)}%;background:var(--bar-blue)">${browse / total > 0.12 ? fmtDur(browse) : ''}</div>` +
    `<div class="split-seg" style="width:${(create / total * 100)}%;background:var(--bar-green)">${create / total > 0.12 ? fmtDur(create) : ''}</div>`;
  document.getElementById('bvcBrowse').textContent = fmtDur(browse);
  document.getElementById('bvcCreate').textContent = fmtDur(create);
}

function renderSiteRank(records) {
  const map = aggBy(records, (r) => r.domain);
  const list = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const el = document.getElementById('siteRank');
  if (!list.length) { el.innerHTML = '<div class="empty">今日暂无记录</div>'; return; }
  const max = Math.max(1, ...list.map((x) => x[1]));
  el.innerHTML = list.map(([domain, sec]) => {
    const pct = Math.round(sec / max * 100);
    const c = domain.includes('zhihu') ? 'var(--bar-purple)' : 'var(--bar-blue)';
    return `<div class="row"><span class="name">${esc(BPCat.prettyDomain(domain))}</span>
      <div class="track"><div class="fill" style="width:${pct}%;background:${c}"></div></div>
      <span class="val">${fmtDur(sec)}</span></div>`;
  }).join('');
}

function renderCatDist(records, categories) {
  const map = aggBy(records, (r) => r.category || '未分类');
  const list = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const el = document.getElementById('catDist');
  if (!list.length) { el.innerHTML = '<div class="empty">今日暂无记录</div>'; return; }
  const total = list.reduce((s, x) => s + x[1], 0) || 1;
  el.innerHTML = list.map(([cat, sec]) => {
    const pct = Math.round(sec / total * 100);
    const color = (categories[cat] && categories[cat].color) || 'var(--tx-muted)';
    return `<div class="row"><span class="name">${esc(cat)}</span>
      <div class="track"><div class="fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="val">${fmtDur(sec)} · ${pct}%</span></div>`;
  }).join('');
}

function renderZhihuTopics(weekRecords) {
  const zhihu = weekRecords.filter((r) => r.domain && r.domain.includes('zhihu') && r.title && ['question', 'topic', 'article', 'feed'].includes(r.content_type));
  const map = new Map(); // title -> {sec, tags}
  for (const r of zhihu) {
    const key = r.title;
    if (!map.has(key)) map.set(key, { sec: 0, tags: r.tags || [] });
    map.get(key).sec += r.duration_seconds || 0;
  }
  const list = [...map.entries()].sort((a, b) => b[1].sec - a[1].sec).slice(0, 15);
  const el = document.getElementById('zhihuTopics');
  if (!list.length) { el.innerHTML = '<div class="empty">本周暂无知乎深度记录 🔍</div>'; return; }
  el.innerHTML = list.map(([title, v]) => {
    const tags = (v.tags || []).slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
    return `<div class="topic-item">
      <div class="topic-title"><span class="t">${esc(title)}</span><span class="time">${fmtDur(v.sec)}</span></div>
      <div class="topic-meta">${tags || '<span class="tag">未分类</span>'}</div>
    </div>`;
  }).join('');
}

function renderCreateDetail(records) {
  const map = aggBy(records.filter((r) => r.time_type === 'creating'), (r) => r.domain);
  const list = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const el = document.getElementById('createDetail');
  if (!list.length) { el.innerHTML = '<div class="empty">今日暂无创作记录 ✍️</div>'; return; }
  const max = Math.max(1, ...list.map((x) => x[1]));
  el.innerHTML = list.map(([domain, sec]) => {
    const pct = Math.round(sec / max * 100);
    return `<div class="row"><span class="name">${esc(BPCat.prettyDomain(domain))}</span>
      <div class="track"><div class="fill" style="width:${pct}%;background:var(--bar-green)"></div></div>
      <span class="val">${fmtDur(sec)}</span></div>`;
  }).join('');
}

function renderWeekTrend(weekRecords) {
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(daysAgoKey(i));
  const browseByDay = {}, createByDay = {};
  days.forEach((d) => { browseByDay[d] = 0; createByDay[d] = 0; });
  for (const r of weekRecords) {
    if (!(r.day in browseByDay)) continue;
    if (r.time_type === 'creating') createByDay[r.day] += r.duration_seconds || 0;
    else browseByDay[r.day] += r.duration_seconds || 0;
  }
  const max = Math.max(1, ...days.map((d) => Math.max(browseByDay[d], createByDay[d])));
  const wk = ['日', '一', '二', '三', '四', '五', '六'];
  document.getElementById('weekTrend').innerHTML = days.map((d) => {
    const dt = new Date(d + 'T00:00:00');
    const bh = Math.round(browseByDay[d] / max * 100);
    const ch = Math.round(createByDay[d] / max * 100);
    const label = (d === BPDB.todayKey()) ? '今天' : '周' + wk[dt.getDay()];
    return `<div class="week-col">
      <div class="week-bars">
        <div class="week-bar" style="height:${bh}%;background:var(--bar-blue)" title="浏览 ${fmtDur(browseByDay[d])}"></div>
        <div class="week-bar" style="height:${ch}%;background:var(--bar-green)" title="创作 ${fmtDur(createByDay[d])}"></div>
      </div>
      <div class="week-lbl">${label}</div>
    </div>`;
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  main();
  // 面板打开期间每 2s 刷新：实时反映进行中的浏览/创作时间与新落盘的记录
  setInterval(main, 2000);
});
