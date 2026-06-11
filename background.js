/**
 * background.js — Service Worker：计时主逻辑 + 状态机（持久化 / 自愈版）
 *
 * 关键设计（针对 MV3 Service Worker 随时被回收的特性）：
 *   · 当前活跃段持久化到 chrome.storage.session，SW 重启后自动恢复
 *   · chrome.alarms 心跳（30s）周期性把活跃段已累计的时间「落盘」到 IndexedDB，
 *     因此 Dashboard 最多 30s 即可看到进行中的浏览/创作时间，SW 被杀也最多丢 30s
 *   · 焦点判断以「tab.active + 窗口 focused」为准（不再使用 chrome.idle 判定空闲），
 *     避免长文阅读 / 视频观看时被错误判定为空闲而漏算时间。
 *     系统休眠时浏览器窗口会自然失焦，由 windows.onFocusChanged 兜底结束计时。
 *   · 创作检测由内容脚本周期性重发，单条消息丢失可自愈
 */
importScripts('src/db.js', 'src/categorize.js');

const MIN_SEGMENT_SECONDS = 1;   // 小于 1 秒的段不记录
const HEARTBEAT_MINUTES = 0.5;   // 心跳落盘周期（30s）
const STATE_KEY = 'bp_state';

let rules = { categories: BPCat.DEFAULT_CATEGORIES, siteGroups: BPCat.DEFAULT_SITE_GROUPS };

/* ───────── 专注期间硬拦截 ─────────
 * · blockDomains: 用户在设置里维护的「分心域名」清单（chrome.storage.local）
 * · focusTimerState: 由 newtab.js 写入的专注计时器状态（chrome.storage.local）
 * · bypassedDomains: 内存中维护「本次专注会话内已放行域名」集合，会话切换时清空
 * 拦截判定（GET_FOCUS_BLOCK_STATE）：
 *   仅当「计时器 running」且「域名在 blockDomains 中」且「未在 bypassedDomains 中」才返回 shouldBlock=true
 */
let blockDomains = [];           // 已规范化的根域名数组
let focusSessionId = null;       // 每开始一次专注，生成一个新会话 ID
let focusRunning = false;        // 计时器是否正在运行
const bypassedDomains = new Set();

// 运行时状态（内存镜像，权威副本在 storage.session）
let active = null;
let focusedWindowId = chrome.windows.WINDOW_ID_NONE;
let stateLoaded = false;
const tabContext = new Map(); // tabId -> { title, tags, content_type, source }

/* ───────── 串行化：避免 flush/start 交错 ───────── */
let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.then(() => {}, () => {});
  return run;
}

/* ───────── 状态持久化 ───────── */
async function saveState() {
  try {
    await chrome.storage.session.set({ [STATE_KEY]: { active, focusedWindowId } });
  } catch (e) { /* ignore */ }
}

async function ensureLoaded() {
  if (stateLoaded) return;
  stateLoaded = true;
  try {
    const res = await chrome.storage.session.get([STATE_KEY]);
    const s = res && res[STATE_KEY];
    if (s) {
      active = s.active || null;
      focusedWindowId = (s.focusedWindowId != null) ? s.focusedWindowId : chrome.windows.WINDOW_ID_NONE;
    }
  } catch (e) { /* ignore */ }
}

/* ───────── 规则加载 ───────── */
async function loadRules() { rules = await BPCat.getRules(); }
loadRules();
loadBlockDomains();
loadFocusSession();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.categories || changes.siteGroups)) loadRules();
  if (area === 'local' && changes.blockDomains) loadBlockDomains();
  if (area === 'local' && changes.focusTimerState) onFocusTimerChanged(changes.focusTimerState.newValue);
});

function normalizeBlockDomain(raw) {
  if (!raw) return '';
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return s;
}

function loadBlockDomains() {
  try {
    chrome.storage.local.get(['blockDomains'], (res) => {
      const list = Array.isArray(res && res.blockDomains) ? res.blockDomains : [];
      blockDomains = list
        .map((it) => normalizeBlockDomain(typeof it === 'string' ? it : (it && it.domain)))
        .filter(Boolean);
    });
  } catch (e) { /* ignore */ }
}

/** 域名是否落在「分心域名清单」内：精确匹配或为其子域名 */
function isBlockedDomain(hostname) {
  if (!hostname || !blockDomains.length) return false;
  const host = String(hostname).toLowerCase().replace(/^www\./, '');
  return blockDomains.some((d) => host === d || host.endsWith('.' + d));
}

function loadFocusSession() {
  try {
    chrome.storage.local.get(['focusTimerState'], (res) => {
      onFocusTimerChanged(res && res.focusTimerState);
    });
  } catch (e) { /* ignore */ }
}

/** 计时器状态变化：仅在「未运行 → 运行」时新建会话并清空放行列表 */
function onFocusTimerChanged(st) {
  const nowRunning = !!(st && st.running && st.endAt && st.endAt > Date.now());
  if (nowRunning && !focusRunning) {
    focusSessionId = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    bypassedDomains.clear();
  } else if (!nowRunning && focusRunning) {
    // 计时结束/暂停/重置：放行列表保留对当前会话无意义，但仍清空避免误用
    bypassedDomains.clear();
    focusSessionId = null;
  }
  focusRunning = nowRunning;
}

/* ───────── 工具 ───────── */
function parseDomain(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return BPCat.rootDomain(u.hostname);
  } catch (e) { return null; }
}

/* ───────── 自动切换日志（供「状态管理」面板订阅） ─────────
   数据写入 chrome.storage.local 的 key: bp_autoSwitch_<YYYY-MM-DD>
   { entries: [{ ts:"HH:MM", host, distract:bool, t:Date.now }], consistencyBreaks, anchorDomain }
   合并规则：
   - 同根域 90s 内的连续切换不计（避免来回切同一站刷次数）
   - distract: 命中预置的社交/视频/内容三组干扰域
   - consistencyBreaks: 每次切到与 anchorDomain 不同的工作域 +1（anchorDomain 由首次切换时锚定）
*/
const DISTRACTION_DOMAINS = new Set([
  'twitter.com', 'x.com', 'weibo.com', 'threads.net', 'facebook.com', 'instagram.com',
  'zhihu.com', 'xiaohongshu.com', 'douban.com', 'tieba.baidu.com', 'reddit.com',
  'youtube.com', 'bilibili.com', 'douyin.com', 'iqiyi.com', 'youku.com',
]);
const SWITCH_DEDUP_MS = 90 * 1000;

function autoSwitchKey() {
  const d = new Date();
  const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return 'bp_autoSwitch_' + k;
}

async function recordAutoSwitch(host) {
  if (!host) return;
  const key = autoSwitchKey();
  await new Promise((resolve) => {
    chrome.storage.local.get([key], (res) => {
      const data = res[key] || { entries: [], consistencyBreaks: 0, anchorDomain: null };
      const now = Date.now();
      const last = data.entries[data.entries.length - 1];
      // 同域 90s 内不重复计数
      if (last && last.host === host && now - (last.t || 0) < SWITCH_DEDUP_MS) {
        chrome.storage.local.set({ [key]: data }, resolve);
        return;
      }
      // 锚定第一次出现的域为"工作域"
      if (!data.anchorDomain) data.anchorDomain = host;
      // 一致性：切到非锚定域 +1
      if (data.anchorDomain && host !== data.anchorDomain) data.consistencyBreaks = (data.consistencyBreaks || 0) + 1;
      const d = new Date(now);
      const ts = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      data.entries.push({
        ts, host, t: now,
        distract: DISTRACTION_DOMAINS.has(host),
      });
      // 上限保护
      if (data.entries.length > 300) data.entries = data.entries.slice(-300);
      chrome.storage.local.set({ [key]: data }, resolve);
    });
  });
}

function getWindow(windowId) {
  return new Promise((r) => {
    try { chrome.windows.get(windowId, (w) => r(chrome.runtime.lastError ? null : w)); }
    catch (e) { r(null); }
  });
}

/** 该 tab 当前是否真正处于「可计时」状态（活跃 + 窗口聚焦）
 *  说明：不再使用 chrome.idle 判定空闲——只要浏览器窗口仍在前台且当前 tab 是
 *  active，就持续计时；系统休眠 / 切到其他 App 时浏览器会自然失焦，由
 *  windows.onFocusChanged 兜底结束当前段。
 */
async function tabIsActiveFocused(tab) {
  if (!tab || tab.active !== true || tab.windowId == null) return false;
  const w = await getWindow(tab.windowId);
  if (!w || !w.focused) return false;
  focusedWindowId = tab.windowId;
  return true;
}

/* ───────── 段：构建 / 落盘 ───────── */
function buildSegment(tabId, url, timeType) {
  const domain = parseDomain(url);
  if (!domain) return null;
  const ctx = tabContext.get(tabId) || {};
  const tags = ctx.tags || [];
  const title = ctx.title || '';
  return {
    tabId, url, domain, title, tags,
    content_type: ctx.content_type || 'page',
    source: ctx.source || 'general',
    category: BPCat.categorize(title, tags, rules.categories),
    site_group: BPCat.siteGroupOf(domain, rules.siteGroups),
    time_type: timeType,
    startAt: Date.now(),
  };
}

async function writeRecord(seg, endTime) {
  const duration = Math.round((endTime - seg.startAt) / 1000);
  if (duration < MIN_SEGMENT_SECONDS) return;
  try {
    await BPDB.putRecord({
      id: BPDB.uuid(),
      url: seg.url, title: seg.title || '', domain: seg.domain,
      site_group: seg.site_group, category: seg.category,
      tags: seg.tags || [], content_type: seg.content_type || 'page',
      time_type: seg.time_type, start_at: seg.startAt,
      duration_seconds: duration, source: seg.source || 'general',
    });
  } catch (e) {
    console.warn('[BrainProtector] 记录写入失败', e);
  }
}

/** 把活跃段已累计的时间落盘，并把计时起点前移到 now（不结束段） */
async function commit(now) {
  if (!active) return;
  await writeRecord(active, now);
  active.startAt = now;
}

/** 结束并清空活跃段 */
async function flush(now) {
  if (!active) return;
  await writeRecord(active, now);
  active = null;
  await saveState();
}

/** 开始为某 tab 计时（先结算旧段）
 *  注意：无论新 tab 是否「可计时」，旧段都必须先结算，避免用户切到 newtab/
 *  扩展页面/chrome:// 时，旧段被心跳继续累计到旧网站头上。
 */
async function startTracking(tab, timeType) {
  await flush(Date.now());
  if (!tab) return;
  if (!(await tabIsActiveFocused(tab))) return;
  if (!parseDomain(tab.url)) return;
  active = buildSegment(tab.id, tab.url, timeType || 'browsing');
  await saveState();
}

/** 同 tab 内仅切换浏览/创作或分类：结算旧段后原地重开 */
async function resegment(changes) {
  if (!active) return;
  const now = Date.now();
  await commit(now);
  Object.assign(active, changes);
  active.startAt = now;
  await saveState();
}

async function getActiveTabInWindow(windowId) {
  return new Promise((r) => chrome.tabs.query({ active: true, windowId }, (t) => r(t && t[0])));
}

async function refreshActiveTab() {
  if (focusedWindowId === chrome.windows.WINDOW_ID_NONE) { await flush(Date.now()); return; }
  const tab = await getActiveTabInWindow(focusedWindowId);
  if (tab && tab.url) await startTracking(tab, 'browsing');
  else await flush(Date.now());
}

/* ───────── 心跳：周期性落盘 ───────── */
chrome.alarms.create('bp_heartbeat', { periodInMinutes: HEARTBEAT_MINUTES });
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('bp_heartbeat', { periodInMinutes: HEARTBEAT_MINUTES });
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('bp_heartbeat', { periodInMinutes: HEARTBEAT_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'bp_heartbeat') return;
  withLock(async () => {
    await ensureLoaded();
    if (!active) return;
    // 防御性兜底：若 active 段所在的 tab 已不再是当前聚焦窗口的活跃 tab
    // （例如用户已切到 newtab/扩展页面/chrome:// 等不可计时页面，但这些
    //  页面没有 content-script 来触发 ACTIVITY_PING 自愈），
    // 必须结束该段，避免 newtab 的停留时间被错误累计到旧网站。
    // 此外，若浏览器窗口已失焦（focusedWindowId === NONE），同样直接 flush。
    if (focusedWindowId === chrome.windows.WINDOW_ID_NONE) { await flush(Date.now()); return; }
    const focusedTab = await getActiveTabInWindow(focusedWindowId);
    if (!focusedTab || focusedTab.id !== active.tabId) {
      await flush(Date.now());
      return;
    }
    await commit(Date.now());
    await saveState();
  });
});

/* ───────── 事件监听 ───────── */
chrome.tabs.onActivated.addListener((info) =>
  withLock(async () => {
    await ensureLoaded();
    const tab = await new Promise((r) => chrome.tabs.get(info.tabId, (t) => r(chrome.runtime.lastError ? null : t)));
    // 即使新 tab 的 url 暂时为空（新建标签页加载中）或为扩展/chrome:// 页面，
    // 也必须调用 startTracking 来结算旧段；否则旧段会在心跳中被错误累计。
    await startTracking(tab, 'browsing');
    // 自动切换日志（供「状态管理」面板订阅）
    if (tab && tab.url) await recordAutoSwitch(parseDomain(tab.url));
  })
);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) =>
  withLock(async () => {
    await ensureLoaded();
    if (active && active.tabId === tabId && changeInfo.url && changeInfo.url !== active.url) {
      tabContext.delete(tabId);
      await startTracking(tab, 'browsing');
      // 当前 tab 内 URL 变化也视为一次"切换"
      await recordAutoSwitch(parseDomain(tab.url));
    }
  })
);

chrome.tabs.onRemoved.addListener((tabId) =>
  withLock(async () => {
    await ensureLoaded();
    tabContext.delete(tabId);
    if (active && active.tabId === tabId) await flush(Date.now());
  })
);

chrome.windows.onFocusChanged.addListener((windowId) =>
  withLock(async () => {
    await ensureLoaded();
    focusedWindowId = windowId;
    await refreshActiveTab();
  })
);

/* ───────── 内容脚本消息 ───────── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  withLock(() => handleMessage(msg, sender)).then((r) => sendResponse(r || { ok: true }));
  return true;
});

async function handleMessage(msg, sender) {
  await ensureLoaded();
  const tab = sender && sender.tab;
  const tabId = tab && tab.id;

  switch (msg.type) {
    case 'GET_TODAY': {
      const records = await BPDB.getRecordsByDay(BPDB.todayKey());
      return { ok: true, records };
    }
    case 'GET_LIVE': {
      // 返回进行中的活跃段，供 Dashboard 实时合并（心跳之外的最后几十秒）
      if (!active) return { ok: true, live: null };
      return { ok: true, live: {
        domain: active.domain, category: active.category, time_type: active.time_type,
        elapsed: Math.round((Date.now() - active.startAt) / 1000),
      } };
    }
    case 'GET_FOCUS_BLOCK_STATE': {
      // content-script 启动时询问：当前域名在专注期间是否需要拦截？
      let hostname = msg.hostname || '';
      if (!hostname && tab && tab.url) {
        try { hostname = new URL(tab.url).hostname; } catch (e) { /* ignore */ }
      }
      const host = hostname.toLowerCase().replace(/^www\./, '');
      const inList = isBlockedDomain(host);
      const bypassed = host && bypassedDomains.has(host);
      const shouldBlock = focusRunning && inList && !bypassed;
      let endAt = null;
      try {
        const r = await new Promise((resolve) => chrome.storage.local.get(['focusTimerState'], resolve));
        if (r && r.focusTimerState && r.focusTimerState.endAt) endAt = r.focusTimerState.endAt;
      } catch (e) { /* ignore */ }
      return {
        ok: true,
        shouldBlock,
        focusRunning,
        sessionId: focusSessionId,
        focusEndAt: endAt,
        domain: host,
        inBlockList: inList,
        bypassed,
      };
    }
    case 'GRANT_DOMAIN_BYPASS': {
      // 用户在遮罩里完成 5s 倒计时并点击「我必须现在用」
      const host = (msg.hostname || '').toLowerCase().replace(/^www\./, '');
      if (host && focusRunning) bypassedDomains.add(host);
      return { ok: true, bypassed: host && bypassedDomains.has(host) };
    }
  }

  if (tabId == null) return { ok: false };

  switch (msg.type) {
    case 'PAGE_META':
    case 'FEED_CONTEXT':
    case 'ACTIVITY_PING': {
      const ctx = tabContext.get(tabId) || {};
      if (msg.title != null) ctx.title = msg.title;
      if (Array.isArray(msg.tags)) ctx.tags = msg.tags;
      if (msg.content_type) ctx.content_type = msg.content_type;
      if (msg.source) ctx.source = msg.source;
      if (msg.type === 'FEED_CONTEXT') { ctx.content_type = 'feed'; ctx.source = 'deep'; }
      tabContext.set(tabId, ctx);

      if (active && active.tabId === tabId) {
        // 已在计时本 tab：按最新上下文更新分类（变化则切段）
        const newCat = BPCat.categorize(ctx.title, ctx.tags, rules.categories);
        if (newCat !== active.category) {
          await resegment({
            category: newCat, title: ctx.title || active.title, tags: ctx.tags || active.tags,
            content_type: ctx.content_type || active.content_type, source: ctx.source || active.source,
          });
        } else {
          active.title = ctx.title || active.title;
          active.tags = ctx.tags || active.tags;
          await saveState();
        }
      } else if (await tabIsActiveFocused(tab)) {
        // 自愈：用户已停留在该页面（SW 曾被回收），现在开始为它计时
        await startTracking(tab, 'browsing');
      }
      return { ok: true };
    }

    case 'START_CREATING': {
      if (active && active.tabId === tabId) {
        if (active.time_type !== 'creating') await resegment({ time_type: 'creating' });
      } else if (await tabIsActiveFocused(tab)) {
        await startTracking(tab, 'creating');
      }
      return { ok: true };
    }

    case 'STOP_CREATING': {
      if (active && active.tabId === tabId && active.time_type === 'creating') {
        await resegment({ time_type: 'browsing' });
      }
      return { ok: true };
    }

    default:
      return { ok: false };
  }
}

/* ───────── 启动初始化 ───────── */
withLock(async () => {
  await ensureLoaded();
  const win = await new Promise((r) => chrome.windows.getLastFocused((w) => r(chrome.runtime.lastError ? null : w)));
  if (win && win.focused) focusedWindowId = win.id;
  await refreshActiveTab();
});
