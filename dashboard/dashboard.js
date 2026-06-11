/* global BPDB, BPCat, BPAI */
'use strict';

/* 主题偏好：'system' | 'light' | 'dark'（system 跟随操作系统） */
let themePref = 'system';
const themeMQ = matchMedia('(prefers-color-scheme: dark)');
const SVG = {
  sun:    '<svg class="ic ic-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon:   '<svg class="ic ic-sm" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  system: '<svg class="ic ic-sm" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
};
const THEME_META = {
  system: SVG.system + '跟随系统',
  light:  SVG.sun + '明亮',
  dark:   SVG.moon + '暗黑',
};
function resolvedDark() {
  return themePref === 'dark' || (themePref === 'system' && themeMQ.matches);
}
function applyTheme() {
  document.documentElement.setAttribute('data-theme', resolvedDark() ? 'dark' : 'light');
  document.getElementById('themeBtn').innerHTML = THEME_META[themePref];
}
chrome.storage.local.get(['theme'], (res) => {
  themePref = ['system', 'light', 'dark'].includes(res.theme) ? res.theme : 'system';
  applyTheme();
});
themeMQ.addEventListener('change', () => { if (themePref === 'system') applyTheme(); });
document.getElementById('themeBtn').addEventListener('click', () => {
  themePref = themePref === 'system' ? 'light' : themePref === 'light' ? 'dark' : 'system';
  applyTheme();
  chrome.storage.local.set({ theme: themePref });
});
document.getElementById('optionsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.getElementById('homeBtn').addEventListener('click', () => {
  // 从新标签页跳转而来时直接后退；否则打开新标签页
  if (history.length > 1) history.back();
  else location.href = '../newtab/newtab.html';
});

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
let _weekRecords = [];          // 缓存本周记录，供趋势筛选重绘
let trendMetric = '__bvc__';    // '__bvc__' = 浏览 vs 创作；否则为某个域名

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
  _weekRecords = weekRecords;
  populateTrendSelect(weekRecords);
  renderWeekTrend(weekRecords);
  renderWeeklyReport(weekRecords, categories);
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
    { lbl: '浏览总时长', val: fmtDur(browse), sub: '今日', color: 'var(--ink)' },
    { lbl: '创作总时长', val: fmtDur(create), sub: '键盘输入', color: 'var(--teal)' },
    { lbl: '使用最多', val: top ? BPCat.prettyDomain(top[0]) : '—', sub: top ? fmtDur(top[1]) : '暂无', color: 'var(--ink)' },
    { lbl: '完成专注', val: (sessions.length || 0) + ' 轮', sub: '番茄/深度', color: 'var(--steel)' },
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
    `<div class="split-seg" style="width:${(browse / total * 100)}%;background:var(--steel)">${browse / total > 0.12 ? fmtDur(browse) : ''}</div>` +
    `<div class="split-seg" style="width:${(create / total * 100)}%;background:var(--teal)">${create / total > 0.12 ? fmtDur(create) : ''}</div>`;
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
    const c = domain.includes('zhihu') ? 'var(--steel)' : 'var(--neutral-bar)';
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
    const color = (categories[cat] && categories[cat].color) || 'var(--ink-3)';
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
  if (!list.length) { el.innerHTML = '<div class="empty">本周暂无知乎深度记录</div>'; return; }
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
  if (!list.length) { el.innerHTML = '<div class="empty">今日暂无创作记录</div>'; return; }
  const max = Math.max(1, ...list.map((x) => x[1]));
  el.innerHTML = list.map(([domain, sec]) => {
    const pct = Math.round(sec / max * 100);
    return `<div class="row"><span class="name">${esc(BPCat.prettyDomain(domain))}</span>
      <div class="track"><div class="fill" style="width:${pct}%;background:var(--teal)"></div></div>
      <span class="val">${fmtDur(sec)}</span></div>`;
  }).join('');
}

/* 本周访问域名 Top 10 → 趋势筛选选项 */
function populateTrendSelect(weekRecords) {
  const sel = document.getElementById('trendMetric');
  if (!sel) return;
  const map = aggBy(weekRecords, (r) => r.domain);
  const topSites = [...map.entries()].filter(([d]) => d).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // 若当前所选域名已不在本周数据里，回退到默认
  if (trendMetric !== '__bvc__' && !topSites.some(([d]) => d === trendMetric)) trendMetric = '__bvc__';

  // 仅当域名列表变化时才重建（避免每 2s 刷新打断正在展开的下拉框）
  const sig = topSites.map(([d]) => d).join('|');
  if (sel._sig !== sig) {
    sel.innerHTML = ['<option value="__bvc__">浏览 vs 创作</option>']
      .concat(topSites.map(([domain], i) =>
        `<option value="${esc(domain)}">Top${i + 1} · ${esc(BPCat.prettyDomain(domain))}</option>`))
      .join('');
    sel._sig = sig;
  }
  sel.value = trendMetric;

  if (!sel._bound) {
    sel.addEventListener('change', () => {
      trendMetric = sel.value;
      renderWeekTrend(_weekRecords);
    });
    sel._bound = true;
  }
}

function renderWeekTrend(weekRecords) {
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(daysAgoKey(i));
  const wk = ['日', '一', '二', '三', '四', '五', '六'];
  const dayLabel = (d) => (d === BPDB.todayKey()) ? '今天' : '周' + wk[new Date(d + 'T00:00:00').getDay()];
  const legend = document.getElementById('weekLegend');

  if (trendMetric === '__bvc__') {
    // 浏览 vs 创作（双柱）
    const browseByDay = {}, createByDay = {};
    days.forEach((d) => { browseByDay[d] = 0; createByDay[d] = 0; });
    for (const r of weekRecords) {
      if (!(r.day in browseByDay)) continue;
      if (r.time_type === 'creating') createByDay[r.day] += r.duration_seconds || 0;
      else browseByDay[r.day] += r.duration_seconds || 0;
    }
    const max = Math.max(1, ...days.map((d) => Math.max(browseByDay[d], createByDay[d])));
    document.getElementById('weekTrend').innerHTML = days.map((d) => {
      const bh = Math.round(browseByDay[d] / max * 100);
      const ch = Math.round(createByDay[d] / max * 100);
      return `<div class="week-col">
        <div class="week-bars">
          <div class="week-bar" style="height:${bh}%;background:var(--steel)" title="浏览 ${fmtDur(browseByDay[d])}"></div>
          <div class="week-bar" style="height:${ch}%;background:var(--teal)" title="创作 ${fmtDur(createByDay[d])}"></div>
        </div>
        <div class="week-lbl">${dayLabel(d)}</div>
      </div>`;
    }).join('');
    if (legend) legend.innerHTML =
      '<span><i class="dot" style="background:var(--steel)"></i>浏览</span>' +
      '<span><i class="dot" style="background:var(--teal)"></i>创作</span>';
    return;
  }

  // 单个网站：每日总时长（单柱）
  const domain = trendMetric;
  const byDay = {};
  days.forEach((d) => { byDay[d] = 0; });
  for (const r of weekRecords) {
    if (!(r.day in byDay) || r.domain !== domain) continue;
    byDay[r.day] += r.duration_seconds || 0;
  }
  const max = Math.max(1, ...days.map((d) => byDay[d]));
  const color = domain.includes('zhihu') ? 'var(--steel)' : 'var(--neutral-bar)';
  document.getElementById('weekTrend').innerHTML = days.map((d) => {
    const h = Math.round(byDay[d] / max * 100);
    return `<div class="week-col">
      <div class="week-bars">
        <div class="week-bar" style="height:${h}%;background:${color}" title="${fmtDur(byDay[d])}"></div>
      </div>
      <div class="week-lbl">${dayLabel(d)}</div>
    </div>`;
  }).join('');
  if (legend) legend.innerHTML =
    `<span><i class="dot" style="background:${color}"></i>${esc(BPCat.prettyDomain(domain))} · 每日访问时长</span>`;
}

/* ───────── 周报：易分心时段 + 连续无中断段 ───────── */

function isDistractCategory(cat, categories) {
  const def = categories && categories[cat];
  if (!def) return false;
  return (def.alert_threshold_minutes || 0) > 0;
}

/** 将一条记录按 [start_at, start_at+duration] 摊到 24 个小时桶里 */
function spreadToHours(rec, bucketsTotal, bucketsDistract, isDistract) {
  const dur = (rec.duration_seconds || 0) * 1000;
  if (dur <= 0) return;
  let start = rec.start_at || 0;
  if (!start) return;
  let end = start + dur;
  while (start < end) {
    const d = new Date(start);
    const hour = d.getHours();
    const hourEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour + 1, 0, 0, 0).getTime();
    const chunk = Math.min(end, hourEnd) - start;
    const sec = chunk / 1000;
    bucketsTotal[hour] += sec;
    if (isDistract) bucketsDistract[hour] += sec;
    start = hourEnd;
  }
}

function renderWeeklyReport(weekRecords, categories) {
  const subEl = document.getElementById('weeklySub');
  const heatEl = document.getElementById('hourHeatmap');
  const axisEl = document.getElementById('hourAxis');
  const topEl = document.getElementById('distractTop');
  const streakEl = document.getElementById('streakList');
  const kpiEl = document.getElementById('weeklyKpis');
  if (!heatEl || !streakEl) return;

  const start = daysAgoKey(6), end = daysAgoKey(0);
  if (subEl) subEl.textContent = start + ' → ' + end;

  // 1) 按小时聚合：总时长 / 分心时长
  const total = new Array(24).fill(0);
  const distract = new Array(24).fill(0);
  let totalSec = 0, distractSec = 0;
  for (const r of weekRecords) {
    if (!r.start_at) continue;
    const isD = isDistractCategory(r.category, categories);
    spreadToHours(r, total, distract, isD);
    totalSec += r.duration_seconds || 0;
    if (isD) distractSec += r.duration_seconds || 0;
  }

  const maxDistract = Math.max(1, ...distract);
  heatEl.innerHTML = total.map((tSec, h) => {
    const dSec = distract[h];
    const ratio = dSec / maxDistract;
    const op = dSec > 0 ? (0.18 + ratio * 0.82).toFixed(2) : 0;
    const pct = tSec > 0 ? Math.round(dSec / tSec * 100) : 0;
    const tip = `${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00 · 分心 ${fmtDur(dSec)} / 共 ${fmtDur(tSec)}（${pct}%）`;
    return `<div class="hh-cell" style="background:rgba(163,58,58,${op})" title="${esc(tip)}">${h % 3 === 0 ? '' : ''}</div>`;
  }).join('');
  if (axisEl) {
    axisEl.innerHTML = Array.from({ length: 24 }, (_, h) =>
      `<span class="hh-tick">${h % 6 === 0 ? String(h).padStart(2, '0') : ''}</span>`).join('');
  }

  // 2) Top 3 分心时段
  const topHours = distract.map((v, h) => ({ h, v }))
    .filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 3);
  if (topEl) {
    if (!topHours.length) {
      topEl.innerHTML = '<div class="empty">本周暂无分心时段</div>';
    } else {
      topEl.innerHTML = '<div class="distract-hint">最易分心时段：</div>' +
        topHours.map((x, i) => {
          const pct = total[x.h] > 0 ? Math.round(x.v / total[x.h] * 100) : 0;
          return `<span class="distract-chip">#${i + 1} ${String(x.h).padStart(2, '0')}:00 · ${fmtDur(x.v)} · ${pct}%</span>`;
        }).join('');
    }
  }

  // 3) KPI 概览
  if (kpiEl) {
    const distractPct = totalSec > 0 ? Math.round(distractSec / totalSec * 100) : 0;
    const peak = topHours[0];
    kpiEl.innerHTML = [
      { lbl: '本周总活跃', val: fmtDur(totalSec), sub: '近 7 天', color: 'var(--ink)' },
      { lbl: '分心总时长', val: fmtDur(distractSec), sub: distractPct + '% 占比', color: 'var(--crim)' },
      { lbl: '最分心小时', val: peak ? (String(peak.h).padStart(2, '0') + ':00') : '—', sub: peak ? fmtDur(peak.v) : '暂无', color: 'var(--steel)' },
    ].map((c) =>
      `<div class="card"><div class="lbl">${c.lbl}</div><div class="val" style="color:${c.color}">${esc(c.val)}</div><div class="sub">${esc(c.sub)}</div></div>`
    ).join('');
  }

  // 4) 连续无中断段：按 start_at 排序，相邻同域名且 gap < 60s 合并
  const recs = weekRecords
    .filter((r) => r.start_at && (r.duration_seconds || 0) > 0)
    .slice()
    .sort((a, b) => a.start_at - b.start_at);
  const GAP_MS = 60 * 1000;
  const streaks = [];
  let cur = null;
  for (const r of recs) {
    const rStart = r.start_at;
    const rEnd = rStart + (r.duration_seconds || 0) * 1000;
    if (cur && r.domain === cur.domain && (rStart - cur.end) <= GAP_MS) {
      cur.end = Math.max(cur.end, rEnd);
      cur.sec += r.duration_seconds || 0;
      cur.category = cur.category || r.category;
      cur.time_type = cur.time_type || r.time_type;
    } else {
      if (cur) streaks.push(cur);
      cur = { domain: r.domain, start: rStart, end: rEnd, sec: r.duration_seconds || 0,
              category: r.category, time_type: r.time_type };
    }
  }
  if (cur) streaks.push(cur);

  const topStreaks = streaks
    .filter((s) => s.domain && (s.end - s.start) >= 5 * 60 * 1000)  // 仅展示 ≥5 分钟
    .sort((a, b) => (b.end - b.start) - (a.end - a.start))
    .slice(0, 5);

  if (!topStreaks.length) {
    streakEl.innerHTML = '<div class="empty">本周暂无 5 分钟以上的连续段</div>';
  } else {
    const max = Math.max(1, ...topStreaks.map((s) => s.end - s.start));
    streakEl.innerHTML = topStreaks.map((s) => {
      const lenMs = s.end - s.start;
      const lenSec = Math.round(lenMs / 1000);
      const pct = Math.round(lenMs / max * 100);
      const dt = new Date(s.start);
      const when = `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
      const tt = s.time_type === 'creating' ? '创作' : '浏览';
      const ttColor = s.time_type === 'creating' ? 'var(--teal)' : 'var(--steel)';
      return `<div class="row">
        <span class="name" title="${esc(s.domain)}">${esc(BPCat.prettyDomain(s.domain))}</span>
        <div class="track"><div class="fill" style="width:${pct}%;background:${ttColor}"></div></div>
        <span class="val">${fmtDur(lenSec)} · <span style="color:var(--ink-3)">${esc(when)} · ${tt}</span></span>
      </div>`;
    }).join('');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  main();
  // 面板打开期间每 2s 刷新：实时反映进行中的浏览/创作时间与新落盘的记录
  setInterval(main, 2000);
  initAIPanel();
});

/* ───────── AI 行为洞察 ───────── */

let _aiBusy = false;
let _mermaidReady = false;
let _mermaidSeq = 0;

function escAI(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ensureMermaid() {
  if (typeof window.mermaid === 'undefined') return null;
  const dark = resolvedDark();
  if (!_mermaidReady) {
    try {
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: dark ? 'dark' : 'default',
        fontFamily: 'inherit',
        themeVariables: dark
          ? { background: 'transparent', primaryColor: '#1e2a3a', primaryTextColor: '#e6ecf3', lineColor: '#5b6b80' }
          : { background: 'transparent', primaryColor: '#eef3fb', primaryTextColor: '#1a2533', lineColor: '#6f7d92' },
      });
      _mermaidReady = true;
    } catch (e) { /* ignore */ }
  }
  return window.mermaid;
}

function renderMarkdown(md) {
  const text = String(md || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (typeof window.marked === 'undefined') {
    return '<pre class="ai-fallback">' + escAI(text) + '</pre>';
  }
  try {
    if (window.marked.setOptions) {
      window.marked.setOptions({ breaks: true, gfm: true });
    }
    const renderer = new window.marked.Renderer();
    const origCode = renderer.code.bind(renderer);
    renderer.code = function (code, infostring) {
      const lang = (infostring || '').trim().toLowerCase().split(/\s+/)[0] || '';
      if (lang === 'mermaid') {
        const id = 'bp-mmd-' + (++_mermaidSeq);
        return '<div class="mermaid-wrap"><div class="mermaid" id="' + id + '">' + escAI(code) + '</div></div>';
      }
      return origCode(code, infostring);
    };
    const html = window.marked.parse(text, { renderer });
    return html;
  } catch (e) {
    return '<pre class="ai-fallback">' + escAI(text) + '</pre>';
  }
}

async function renderMermaidIn(container) {
  if (!container) return;
  const nodes = container.querySelectorAll('.mermaid');
  if (!nodes.length) return;
  const mm = ensureMermaid();
  if (!mm) return;
  for (const node of nodes) {
    if (node.dataset.bpRendered === '1') continue;
    const src = node.textContent || '';
    const id = node.id || 'bp-mmd-x-' + (++_mermaidSeq);
    try {
      const { svg, bindFunctions } = await mm.render(id + '-svg', src);
      node.innerHTML = svg;
      if (typeof bindFunctions === 'function') bindFunctions(node);
      node.dataset.bpRendered = '1';
    } catch (err) {
      node.innerHTML = '<pre class="mermaid-error">Mermaid 渲染失败：' + escAI(err && err.message ? err.message : String(err))
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
  renderMermaidIn(out);
}

async function runAIAnalysis() {
  if (_aiBusy) return;
  const btn = document.getElementById('aiRunBtn');
  const sel = document.getElementById('aiDays');
  const days = sel ? Math.max(1, parseInt(sel.value, 10) || 7) : 7;
  _aiBusy = true;
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
  setAIOutput('正在汇总最近 ' + days + ' 天的本地行为数据并请求 AI…（一般 5–30 秒）', 'loading');
  const startedAt = Date.now();
  try {
    const { metrics, reply } = await BPAI.analyze({ days });
    const cost = ((Date.now() - startedAt) / 1000).toFixed(1) + 's';
    const meta = `<div class="ai-meta">窗口：${escAI(metrics.window.start_day)} → ${escAI(metrics.window.end_day)} · `
      + `${metrics.totals.record_count} 条记录 · 切换 ${metrics.switching.total_switches} 次 · 耗时 ${cost}</div>`;
    setAIOutput(renderMarkdown(reply) + meta);
  } catch (e) {
    setAIOutput('❌ ' + escAI(e && e.message ? e.message : String(e)), 'error');
  } finally {
    _aiBusy = false;
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

function initAIPanel() {
  const btn = document.getElementById('aiRunBtn');
  if (btn) btn.addEventListener('click', runAIAnalysis);
  const cfg = document.getElementById('aiCfgBtn');
  if (cfg) cfg.addEventListener('click', () => openOptionsAtAIPanel());
  // 主题切换后，已渲染的 mermaid 图配色会过时；下次分析会按新主题重渲染
  themeMQ.addEventListener('change', () => { _mermaidReady = false; });
  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) themeBtn.addEventListener('click', () => { _mermaidReady = false; });
}

function openOptionsAtAIPanel() {
  const target = chrome.runtime.getURL('options/options.html') + '#aiPanel';
  try {
    chrome.tabs.query({}, (tabs) => {
      const base = chrome.runtime.getURL('options/options.html');
      const existing = (tabs || []).find((t) => t.url && t.url.split('#')[0] === base);
      if (existing) {
        chrome.tabs.update(existing.id, { active: true, url: target }, () => {
          if (existing.windowId != null && chrome.windows && chrome.windows.update) {
            chrome.windows.update(existing.windowId, { focused: true });
          }
        });
      } else {
        chrome.tabs.create({ url: target });
      }
    });
  } catch (e) {
    chrome.runtime.openOptionsPage();
  }
}
