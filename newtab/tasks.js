/* global BPCat, BPUtil */
'use strict';

/* ════════════════════════════════════════
   任务管理 — 浏览器标签页整理
   读取所有窗口所有 tab，按域名/类别归类、可展开、
   手动关闭、陈旧提醒(>12h)、重复检测、搜索过滤、
   一键应用为真实 Chrome 标签组。
   ════════════════════════════════════════ */
(function () {
  const STALE_MS = 12 * 3600 * 1000; // 陈旧阈值：12 小时未访问
  const esc = (s) => (window.BPUtil ? BPUtil.escapeHtml(s) : String(s));

  /* 类别名 → Chrome 标签组颜色枚举 */
  const GROUP_COLORS = {
    '开发工具': 'blue',
    '视频': 'red',
    '社交媒体': 'cyan',
    '内容社区': 'purple',
    '效率办公': 'green',
    '其他': 'grey',
  };

  let groupMode = 'domain';   // 'domain' | 'category'
  let filterMode = 'all';     // 'all' | 'stale' | 'dup'
  let searchTerm = '';
  let allTabs = [];
  let siteGroups = null;
  const expanded = new Set(); // 展开的组 key

  /* 类别 → 展示用 emoji 图标（按类别分组时使用） */
  const CATEGORY_EMOJI = {
    '开发工具': '🛠️',
    '视频': '🎬',
    '社交媒体': '💬',
    '内容社区': '📰',
    '效率办公': '📊',
    '其他': '🗂️',
  };

  /* ── 工具 ── */
  function domainOf(url) {
    try {
      const h = new URL(url).hostname;
      return BPCat.rootDomain(h) || h;
    } catch (e) { return ''; }
  }
  function normUrl(url) {
    try {
      const u = new URL(url);
      return (u.origin + u.pathname).replace(/\/$/, '');
    } catch (e) { return url || ''; }
  }
  function isStale(t) {
    return typeof t.lastAccessed === 'number' && (Date.now() - t.lastAccessed > STALE_MS);
  }
  function staleHours(t) {
    return Math.round((Date.now() - t.lastAccessed) / 3600000);
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ── 分组计算 ── */
  function buildGroups() {
    const urlCount = new Map();
    for (const t of allTabs) {
      const k = normUrl(t.url);
      urlCount.set(k, (urlCount.get(k) || 0) + 1);
    }
    const groups = new Map(); // key -> { label, tabs:[] }
    for (const t of allTabs) {
      const domain = domainOf(t.url);
      let key, label;
      if (groupMode === 'category') {
        label = BPCat.siteGroupOf(domain, siteGroups);
        key = label;
      } else {
        key = domain || '__local__';
        label = domain ? BPCat.prettyDomain(domain) : '本地 / 浏览器页面';
      }
      if (!groups.has(key)) groups.set(key, { label, tabs: [] });
      groups.get(key).tabs.push(t);
    }
    const sorted = [...groups.entries()].sort((a, b) => b[1].tabs.length - a[1].tabs.length);
    return { sorted, urlCount };
  }

  /* ── 渲染 ── */
  function paint() {
    const container = document.getElementById('taskGroups');
    if (!container) return;
    const { sorted, urlCount } = buildGroups();
    const term = searchTerm.trim().toLowerCase();

    // 顶部统计
    const total = allTabs.length;
    const staleTotal = allTabs.filter(isStale).length;
    let dupTotal = 0;
    urlCount.forEach((c) => { if (c > 1) dupTotal += c - 1; });
    const statsEl = document.getElementById('taskStats');
    if (statsEl) statsEl.textContent =
      `共 ${total} 个标签 · ${sorted.length} 组 · ⏰陈旧 ${staleTotal} · 🔁重复 ${dupTotal}`;

    const html = sorted.map(([key, g]) => renderGroup(key, g, urlCount, term)).filter(Boolean).join('');
    container.innerHTML = html || '<div class="empty-hint">没有匹配的标签页 🔍</div>';
    bindEvents();
  }

  function tabMatches(t, term, domain) {
    if (!term) return true;
    return (t.title || '').toLowerCase().includes(term) ||
           (domain || '').toLowerCase().includes(term) ||
           (t.url || '').toLowerCase().includes(term);
  }

  function rowPassesFilter(t, urlCount) {
    if (filterMode === 'stale') return isStale(t);
    if (filterMode === 'dup') return urlCount.get(normUrl(t.url)) > 1;
    return true;
  }

  function groupIcon(key, g) {
    if (groupMode === 'category') {
      return `<span class="group-fav-emoji">${CATEGORY_EMOJI[g.label] || '🗂️'}</span>`;
    }
    if (key === '__local__') return `<span class="group-fav-emoji">💻</span>`;
    // 按域名：复用组内任一标签页已加载的 favicon（本地数据，无需外部请求）
    const favTab = g.tabs.find((t) => t.favIconUrl && /^https?:/.test(t.favIconUrl));
    return favTab
      ? `<img class="group-fav" src="${esc(favTab.favIconUrl)}" alt="">`
      : `<span class="group-fav-emoji">🌐</span>`;
  }

  function renderGroup(key, g, urlCount, term) {
    const rows = g.tabs.filter((t) => tabMatches(t, term, domainOf(t.url)) && rowPassesFilter(t, urlCount));
    // 搜索或筛选时隐藏没有匹配项的组
    if ((term || filterMode !== 'all') && !rows.length) return '';

    const staleN = g.tabs.filter(isStale).length;
    const dupN = g.tabs.filter((t) => urlCount.get(normUrl(t.url)) > 1).length;
    // 搜索/筛选时强制展开；否则按用户状态，默认折叠（除非曾展开）
    const open = (term || filterMode !== 'all') ? true : expanded.has(key);

    const badges =
      (staleN ? `<span class="tag tag-stale">⏰ ${staleN}</span>` : '') +
      (dupN ? `<span class="tag tag-dup">🔁 ${dupN}</span>` : '');
    const actions =
      (staleN ? `<button class="mini-btn" data-closestale="${esc(key)}">关闭陈旧 (${staleN})</button>` : '') +
      (dupN ? `<button class="mini-btn" data-closedup="${esc(key)}">关闭重复 (${dupN})</button>` : '');

    const rowsHtml = rows.map((t) => renderRow(t, urlCount)).join('');

    return `<div class="task-group">
      <div class="group-head" data-toggle="${esc(key)}">
        <span class="group-caret">${open ? '▾' : '▸'}</span>
        ${groupIcon(key, g)}
        <span class="group-name">${esc(g.label)}</span>
        <span class="group-count">${rows.length === g.tabs.length ? g.tabs.length : rows.length + '/' + g.tabs.length}</span>
        ${badges}
        <span class="group-actions">${actions}</span>
      </div>
      <div class="group-body"${open ? '' : ' style="display:none"'}>${rowsHtml}</div>
    </div>`;
  }

  function renderRow(t, urlCount) {
    const domain = domainOf(t.url);
    const dup = urlCount.get(normUrl(t.url)) > 1;
    const stale = isStale(t);
    const fav = (t.favIconUrl && /^https?:/.test(t.favIconUrl))
      ? `<img class="tab-fav" src="${esc(t.favIconUrl)}" alt="">`
      : `<span class="tab-fav-emoji">🌐</span>`;
    const tags =
      (stale ? `<span class="tag tag-stale">⏰ ${staleHours(t)}h</span>` : '') +
      (dup ? `<span class="tag tag-dup">🔁 重复</span>` : '') +
      (t.active ? `<span class="tag tag-active">当前</span>` : '');
    return `<div class="tab-row" data-tabid="${t.id}" data-winid="${t.windowId}">
      ${fav}
      <div class="tab-meta">
        <div class="tab-title">${esc(t.title || t.url || '')}</div>
        <div class="tab-sub">${esc(BPCat.prettyDomain(domain) || domain || '—')}${tags}</div>
      </div>
      <button class="tab-close" data-close="${t.id}" title="关闭此标签">✕</button>
    </div>`;
  }

  /* ── 事件 ── */
  function bindEvents() {
    document.querySelectorAll('.group-head').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.mini-btn')) return; // 让按钮自己处理
        const key = el.dataset.toggle;
        if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
        paint();
      });
    });
    document.querySelectorAll('[data-close]').forEach((el) => {
      el.addEventListener('click', (e) => { e.stopPropagation(); closeTab(parseInt(el.dataset.close, 10)); });
    });
    document.querySelectorAll('.tab-row').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.tab-close')) return;
        focusTab(parseInt(el.dataset.tabid, 10), parseInt(el.dataset.winid, 10));
      });
    });
    document.querySelectorAll('[data-closestale]').forEach((el) => {
      el.addEventListener('click', (e) => { e.stopPropagation(); closeStaleInGroup(el.dataset.closestale); });
    });
    document.querySelectorAll('[data-closedup]').forEach((el) => {
      el.addEventListener('click', (e) => { e.stopPropagation(); closeDupInGroup(el.dataset.closedup); });
    });
  }

  /* ── 操作 ── */
  async function closeTab(id) {
    try { await chrome.tabs.remove(id); } catch (e) { /* 已关闭 */ }
    await refresh();
  }

  function focusTab(id, winId) {
    try {
      chrome.tabs.update(id, { active: true });
      if (winId != null) chrome.windows.update(winId, { focused: true });
    } catch (e) { /* ignore */ }
  }

  function groupTabsOf(key) {
    const { sorted } = buildGroups();
    const found = sorted.find(([k]) => k === key);
    return found ? found[1].tabs : [];
  }

  async function closeStaleInGroup(key) {
    const ids = groupTabsOf(key).filter(isStale).map((t) => t.id);
    if (!ids.length) return;
    if (!confirm(`关闭该组 ${ids.length} 个超过 12 小时未访问的标签页？`)) return;
    try { await chrome.tabs.remove(ids); } catch (e) { /* ignore */ }
    toast(`已关闭 ${ids.length} 个陈旧标签`);
    await refresh();
  }

  async function closeDupInGroup(key) {
    const tabs = groupTabsOf(key);
    const seen = new Set();
    const ids = [];
    // 保留每个 URL 第一个（优先保留当前活动的）
    const order = [...tabs].sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
    for (const t of order) {
      const u = normUrl(t.url);
      if (seen.has(u)) ids.push(t.id);
      else seen.add(u);
    }
    if (!ids.length) return;
    if (!confirm(`关闭该组 ${ids.length} 个重复标签页（每个网址保留一个）？`)) return;
    try { await chrome.tabs.remove(ids); } catch (e) { /* ignore */ }
    toast(`已关闭 ${ids.length} 个重复标签`);
    await refresh();
  }

  async function applyGroups() {
    // 标签组不能跨窗口 → 按窗口分别处理
    const byWin = new Map(); // winId -> Map(category -> [tabId])
    for (const t of allTabs) {
      if (typeof t.id !== 'number') continue;
      const cat = BPCat.siteGroupOf(domainOf(t.url), siteGroups);
      if (!byWin.has(t.windowId)) byWin.set(t.windowId, new Map());
      const m = byWin.get(t.windowId);
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat).push(t.id);
    }
    let made = 0;
    for (const [winId, cats] of byWin) {
      for (const [cat, ids] of cats) {
        if (cat === '其他' || ids.length < 2) continue; // 跳过未归类与单个
        try {
          const gid = await chrome.tabs.group({ createProperties: { windowId: winId }, tabIds: ids });
          await chrome.tabGroups.update(gid, { title: cat, color: GROUP_COLORS[cat] || 'grey' });
          made++;
        } catch (e) { console.warn('建组失败', cat, e); }
      }
    }
    toast(made ? `已创建 ${made} 个 Chrome 标签组 ✨` : '没有可分组的标签（每类需 ≥2 个）');
    await refresh();
  }

  /* ── 数据加载 ── */
  async function refresh() {
    const container = document.getElementById('taskGroups');
    try {
      const rules = await BPCat.getRules();
      siteGroups = rules.siteGroups;
      allTabs = await chrome.tabs.query({});
    } catch (e) {
      if (container) container.innerHTML = '<div class="empty-hint">无法读取标签页，请检查权限 ⚠️</div>';
      return;
    }
    paint();
  }

  /* ── 初始化 ── */
  function setup() {
    const search = document.getElementById('tabSearch');
    if (search) search.addEventListener('input', () => { searchTerm = search.value; paint(); });

    document.querySelectorAll('.seg-btn[data-group]').forEach((b) => {
      b.addEventListener('click', () => {
        groupMode = b.dataset.group;
        b.parentElement.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
        expanded.clear();
        paint();
      });
    });

    document.querySelectorAll('.seg-btn[data-filter]').forEach((b) => {
      b.addEventListener('click', () => {
        filterMode = b.dataset.filter;
        b.parentElement.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
        paint();
      });
    });

    const refreshBtn = document.getElementById('refreshTabsBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', refresh);
    const applyBtn = document.getElementById('applyGroupsBtn');
    if (applyBtn) applyBtn.addEventListener('click', applyGroups);
  }

  document.addEventListener('DOMContentLoaded', setup);

  // 供 newtab.js 在切到任务 Tab 时调用
  window.BPTasks = { render: refresh };
})();
