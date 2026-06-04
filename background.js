/**
 * background.js — Service Worker：计时主逻辑 + 状态机
 *
 * 负责把「当前活跃标签」的浏览/创作时间切分为一段段记录写入 IndexedDB。
 * 状态切换点：tab 切换 / tab 内导航 / 窗口失焦 / 空闲 / 创作开关 / 上下文(分类)变化。
 */
importScripts('src/db.js', 'src/categorize.js');

const IDLE_SECONDS = 5 * 60; // 离开电脑 5 分钟判定空闲
const MIN_SEGMENT_SECONDS = 1; // 小于 1 秒的段不记录

let rules = { categories: BPCat.DEFAULT_CATEGORIES, siteGroups: BPCat.DEFAULT_SITE_GROUPS };

// 运行时状态
let active = null;            // 当前正在计时的段
let idleState = 'active';     // active | idle | locked
let focusedWindowId = chrome.windows.WINDOW_ID_NONE;
const tabContext = new Map(); // tabId -> { title, tags, content_type, source }

chrome.idle.setDetectionInterval(IDLE_SECONDS);

/* ───────── 规则加载 ───────── */
async function loadRules() {
  rules = await BPCat.getRules();
}
loadRules();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.categories || changes.siteGroups)) loadRules();
});

/* ───────── 工具 ───────── */
function parseDomain(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return BPCat.rootDomain(u.hostname);
  } catch (e) {
    return null;
  }
}

function isTrackable(url) {
  return !!parseDomain(url);
}

/* ───────── 段的开始 / 结束 ───────── */
async function flush(endTime) {
  if (!active) return;
  const seg = active;
  active = null;
  const duration = Math.round((endTime - seg.startAt) / 1000);
  if (duration < MIN_SEGMENT_SECONDS) return;
  const rec = {
    id: BPDB.uuid(),
    url: seg.url,
    title: seg.title || '',
    domain: seg.domain,
    site_group: seg.site_group,
    category: seg.category,
    tags: seg.tags || [],
    content_type: seg.content_type || 'page',
    time_type: seg.time_type,
    start_at: seg.startAt,
    duration_seconds: duration,
    source: seg.source || 'general',
  };
  try {
    await BPDB.putRecord(rec);
  } catch (e) {
    console.warn('[BrainProtector] 记录写入失败', e);
  }
}

function buildSegment(tabId, url, timeType) {
  const domain = parseDomain(url);
  if (!domain) return null;
  const ctx = tabContext.get(tabId) || {};
  const tags = ctx.tags || [];
  const title = ctx.title || '';
  return {
    tabId,
    url,
    domain,
    title,
    tags,
    content_type: ctx.content_type || 'page',
    source: ctx.source || 'general',
    category: BPCat.categorize(title, tags, rules.categories),
    site_group: BPCat.siteGroupOf(domain, rules.siteGroups),
    time_type: timeType,
    startAt: Date.now(),
  };
}

/** 开始为某 tab 计时（先 flush 旧段） */
async function startTracking(tabId, url, timeType) {
  await flush(Date.now());
  if (idleState !== 'active' || focusedWindowId === chrome.windows.WINDOW_ID_NONE) return;
  if (!isTrackable(url)) return;
  active = buildSegment(tabId, url, timeType || 'browsing');
}

/** 重新切段（保持 tab 不变，仅因分类/创作状态变化） */
async function resegment(timeType) {
  if (!active) return;
  const { tabId, url } = active;
  await flush(Date.now());
  if (idleState !== 'active' || focusedWindowId === chrome.windows.WINDOW_ID_NONE) return;
  active = buildSegment(tabId, url, timeType);
}

async function getActiveTabInWindow(windowId) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, windowId }, (tabs) => resolve(tabs && tabs[0]));
  });
}

async function refreshActiveTab() {
  if (focusedWindowId === chrome.windows.WINDOW_ID_NONE) {
    await flush(Date.now());
    return;
  }
  const tab = await getActiveTabInWindow(focusedWindowId);
  if (tab && tab.url) {
    await startTracking(tab.id, tab.url, 'browsing');
  } else {
    await flush(Date.now());
  }
}

/* ───────── 事件监听 ───────── */
chrome.tabs.onActivated.addListener(async (info) => {
  const tab = await new Promise((r) => chrome.tabs.get(info.tabId, (t) => r(chrome.runtime.lastError ? null : t)));
  if (tab && tab.url) await startTracking(tab.id, tab.url, 'browsing');
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!active || active.tabId !== tabId) return;
  if (changeInfo.url && changeInfo.url !== active.url) {
    // 同 tab 内 SPA / 链接跳转
    tabContext.delete(tabId);
    await startTracking(tabId, changeInfo.url, 'browsing');
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabContext.delete(tabId);
  if (active && active.tabId === tabId) flush(Date.now());
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  focusedWindowId = windowId;
  await refreshActiveTab();
});

chrome.idle.onStateChanged.addListener(async (state) => {
  idleState = state;
  if (state === 'active') {
    await refreshActiveTab();
  } else {
    await flush(Date.now()); // 空闲 / 锁屏：停止计时
  }
});

/* ───────── 内容脚本消息 ───────── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  handleMessage(msg, tabId).then((r) => sendResponse(r || { ok: true }));
  return true; // 异步响应
});

async function handleMessage(msg, tabId) {
  if (tabId == null && msg.type !== 'GET_TODAY') return { ok: false };

  switch (msg.type) {
    case 'PAGE_META': {
      // 内容脚本上报页面元信息（标题 / 标签 / 类型）
      const ctx = tabContext.get(tabId) || {};
      ctx.title = msg.title || ctx.title || '';
      ctx.tags = Array.isArray(msg.tags) ? msg.tags : (ctx.tags || []);
      ctx.content_type = msg.content_type || ctx.content_type || 'page';
      ctx.source = msg.source || ctx.source || 'general';
      tabContext.set(tabId, ctx);
      // 若是当前活跃段，更新其分类（可能因标签到达而变化）
      if (active && active.tabId === tabId) {
        const newCat = BPCat.categorize(ctx.title, ctx.tags, rules.categories);
        if (newCat !== active.category) {
          // 分类变化：先结算旧段（保留旧元信息），再以新上下文开新段
          await resegment(active.time_type);
        } else {
          active.title = ctx.title;
          active.tags = ctx.tags;
          active.content_type = ctx.content_type;
          active.source = ctx.source;
        }
      }
      return { ok: true };
    }

    case 'FEED_CONTEXT': {
      // 知乎 Feed 当前主导卡片，动态切换分类（同一域名时间被重新归类）
      const ctx = tabContext.get(tabId) || {};
      ctx.title = msg.title || ctx.title || '';
      ctx.tags = Array.isArray(msg.tags) ? msg.tags : (ctx.tags || []);
      ctx.content_type = 'feed';
      ctx.source = 'deep';
      tabContext.set(tabId, ctx);
      if (active && active.tabId === tabId) {
        const newCat = BPCat.categorize(ctx.title, ctx.tags, rules.categories);
        if (newCat !== active.category) {
          await resegment(active.time_type);
        } else {
          active.title = ctx.title;
          active.tags = ctx.tags;
          active.content_type = 'feed';
          active.source = 'deep';
        }
      }
      return { ok: true };
    }

    case 'START_CREATING': {
      if (active && active.tabId === tabId && active.time_type !== 'creating') {
        await resegment('creating');
      } else if (!active) {
        // 当前 tab 即活跃但尚未建段（极端情况）
        const tab = await new Promise((r) => chrome.tabs.get(tabId, (t) => r(chrome.runtime.lastError ? null : t)));
        if (tab && tab.url) {
          await startTracking(tabId, tab.url, 'creating');
        }
      }
      return { ok: true };
    }

    case 'STOP_CREATING': {
      if (active && active.tabId === tabId && active.time_type === 'creating') {
        await resegment('browsing');
      }
      return { ok: true };
    }

    case 'GET_TODAY': {
      const records = await BPDB.getRecordsByDay(BPDB.todayKey());
      return { ok: true, records };
    }

    default:
      return { ok: false };
  }
}

/* ───────── 启动时初始化当前窗口 ───────── */
(async function init() {
  try {
    const win = await new Promise((r) => chrome.windows.getLastFocused((w) => r(w)));
    if (win) focusedWindowId = win.focused ? win.id : focusedWindowId;
    chrome.idle.queryState(IDLE_SECONDS, async (state) => {
      idleState = state;
      await refreshActiveTab();
    });
  } catch (e) {
    /* ignore */
  }
})();
