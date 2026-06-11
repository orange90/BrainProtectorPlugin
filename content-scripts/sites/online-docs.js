/**
 * online-docs.js — 在线文档创作检测层
 *
 * 通用层（content-general.js）靠「activeElement 是 textarea / contenteditable + 文本净增长」
 * 判定创作。但 Google Docs / 腾讯文档 等用 canvas 渲染正文，真正接收输入的是一个离屏
 * iframe 里的隐藏 contenteditable，主文档的 activeElement 测不到、也读不到文本长度。
 *
 * 实测三类站点差异（2026-06，DevTools 验证），分别采用不同策略：
 *
 *   · KEYSTROKE_HOSTS（Google Docs）：canvas + 离屏 iframe，键入只在该 iframe 内派发 keydown，
 *     主文档零事件、无 input/beforeinput；Selection 也跨不出 iframe。
 *     → 策略：all_frames 注入 + 统计按键节奏。
 *
 *   · CARET_HOSTS（飞书 / Lark / 语雀 / Notion）：真实 DOM contenteditable，
 *     主文档上 focus / selection 全部可观测。
 *     → 策略：「可编辑光标存在」单信号判定——只要光标还插在编辑器里、窗口没切走，
 *        即使长时间不打字（思考、查资料）也持续算作创作。一旦光标离开 / 选中文字 /
 *        切走标签页 / 窗口失焦，立即停止。
 *        - 仅阅读 / 划词复制 / 鼠标悬停 → 没有折叠光标，判为浏览；
 *        - 点进编辑器思考 → 有光标，持续算创作；
 *        - 真正在码字 → 持续算创作。
 *
 *   · ALWAYS_HOSTS（腾讯文档：docs.qq.com / doc.weixin.qq.com）：受工具限制无法注入探测，
 *     新版亦 canvas 渲染。按用户要求改为「域名级」判定：只要停留在该域名的页面
 *     （且标签页处于前台聚焦）即算创作，不再依赖按键。前台/聚焦/空闲的把关由
 *     background.js（tabIsActiveFocused）负责。
 */
(function () {
  'use strict';

  // 键盘节奏判定的域名（Google Docs：canvas + 离屏 iframe，光标无法跨 iframe 取到）
  const KEYSTROKE_HOSTS = [
    /(^|\.)docs\.google\.com$/,
  ];
  // 光标 + 输入双信号判定的域名（飞书 / Lark / 语雀 / Notion：真实 DOM contenteditable）
  const CARET_HOSTS = [
    /(^|\.)feishu\.cn$/,
    /(^|\.)larksuite\.com$/,
    /(^|\.)larkoffice\.com$/,
    /(^|\.)yuque\.com$/,
    /(^|\.)notion\.so$/,
    /(^|\.)notion\.site$/,
  ];
  // 域名级判定的域名（只要在站内即算创作，无法/无需探测按键）
  const ALWAYS_HOSTS = [
    /(^|\.)docs\.qq\.com$/,
    /(^|\.)doc\.weixin\.qq\.com$/,
  ];

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
    } catch (e) { /* 扩展上下文失效，忽略 */ }
  }

  const REPING_MS = 8000;             // 每 8s 重发一次 START，单条丢失 / SW 重启可自愈

  // ── 域名级判定（腾讯文档）────────────────────────────────────────────────
  if (ALWAYS_HOSTS.some((re) => re.test(location.hostname))) {
    if (window.top !== window) return; // 仅顶层框架发，避免多 iframe 重复

    function ping() {
      // 后台 / 失焦时不发；background 也会拦，但这里先省掉无效消息
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        send({ type: 'START_CREATING', source: 'general' });
      }
    }
    function end() { send({ type: 'STOP_CREATING', source: 'general' }); }

    setInterval(ping, REPING_MS);
    ping();

    // 切走标签页 / 窗口失焦立即结束创作段，避免多算（最多 REPING_MS）
    document.addEventListener('visibilitychange', () => {
      document.visibilityState === 'visible' ? ping() : end();
    });
    window.addEventListener('blur', end);
    window.addEventListener('focus', ping);
    return;
  }

  // ── 按键节奏判定（Google Docs）──────────────────────────────────────────
  if (KEYSTROKE_HOSTS.some((re) => re.test(location.hostname))) {
    const MIN_KEYS = 6;                 // 连续 6 次有效输入才认作创作，挡住误触/快捷键
    const IDLE_MS = 2 * 60 * 1000;      // 停手 2 分钟切回浏览

    let keys = 0, lastPing = 0, idleTimer = null;

    function isTypingTarget() {
      const a = document.activeElement;
      // canvas 编辑器里 activeElement 多为 body / contenteditable / iframe，均放行；
      // 仅排除单行输入框（文档标题、搜索框等）
      if (a && a.tagName === 'INPUT') return false;
      return true;
    }

    // 判断一次 keydown 是否属于「正在码字」
    function isContentKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;     // 快捷键不算
      if (e.isComposing || e.key === 'Process' || e.keyCode === 229) return true; // 输入法合成中（中文）
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') return true;
      return typeof e.key === 'string' && e.key.length === 1;    // 单个可打印字符
    }

    function stopCreating() {
      if (!lastPing) return;
      lastPing = 0; keys = 0;
      clearTimeout(idleTimer);
      send({ type: 'STOP_CREATING', source: 'general' });
    }

    function onType() {
      keys++;
      if (keys < MIN_KEYS) return;
      const now = Date.now();
      if (now - lastPing > REPING_MS) {
        lastPing = now;
        send({ type: 'START_CREATING', source: 'general' });
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(stopCreating, IDLE_MS);
    }

    document.addEventListener('keydown', (e) => {
      if (!isTypingTarget()) return;
      if (isContentKey(e)) onType();
    }, true);

    // input 事件兜底（粘贴、语音听写、部分输入法不触发 keydown 的上屏）
    document.addEventListener('input', () => {
      if (isTypingTarget()) onType();
    }, true);

    // 离开页面 / 切走焦点立即结束创作
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') stopCreating();
    });
    window.addEventListener('blur', stopCreating);
    return;
  }

  // ── 光标判定（飞书 / Lark / 语雀 / Notion）──────────────────────────────
  // 思路（按用户偏好「思考也算创作」）：
  //   1) 焦点必须在「真正的可编辑元素」(contenteditable / textarea) 内
  //   2) Selection 折叠（isCollapsed = 光标）且锚点确实在该编辑元素中
  //   两条同时成立 = creating；只要光标还插在编辑器里、窗口没切走，
  //   即使长时间不打字（思考、查资料）也持续算作创作。
  //   一旦切走标签页 / 浏览器窗口失焦 / 焦点离开编辑器 / 选中文字（非折叠）→ 立即停。
  if (!CARET_HOSTS.some((re) => re.test(location.hostname))) return;

  const CARET_POLL_MS = 1500;         // 光标状态轮询周期（兜底 SW 重启自愈）

  let creating = false;
  let lastStartPing = 0;

  // 找到包含给定节点的最近一个「可编辑宿主」
  function editableHost(node) {
    let n = node;
    while (n && n !== document) {
      if (n.nodeType === 1) {
        const el = /** @type {Element} */ (n);
        if (el.tagName === 'TEXTAREA') return el;
        if (el.tagName === 'INPUT') return null;                 // 单行输入框不算
        if (el.isContentEditable === true) return el;
      }
      n = n.parentNode || (n.getRootNode && n.getRootNode().host) || null;
    }
    return null;
  }

  // 当前是否处于「可编辑光标」状态
  function hasEditableCaret() {
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return false;
    const a = document.activeElement;
    if (!a) return false;
    if (a.tagName === 'TEXTAREA') return true;                   // textarea 聚焦即有光标
    if (a.tagName === 'INPUT') return false;
    if (!a.isContentEditable) return false;
    try {
      const sel = window.getSelection && window.getSelection();
      if (!sel || sel.rangeCount === 0) return false;
      if (!sel.isCollapsed) return false;                        // 选区高亮 ≠ 光标，按浏览
      const host = editableHost(sel.anchorNode);
      return host === a || (host && a.contains(host));
    } catch (e) { return false; }
  }

  function startCreating() {
    const now = Date.now();
    if (creating && now - lastStartPing < REPING_MS) return;
    creating = true;
    lastStartPing = now;
    send({ type: 'START_CREATING', source: 'general' });
  }

  function stopCreating() {
    if (!creating) return;
    creating = false;
    lastStartPing = 0;
    send({ type: 'STOP_CREATING', source: 'general' });
  }

  function evaluate() {
    if (hasEditableCaret()) startCreating();
    else stopCreating();
  }

  // 光标 / 焦点变化即刻评估
  document.addEventListener('selectionchange', evaluate);
  document.addEventListener('focusin', evaluate, true);
  document.addEventListener('focusout', evaluate, true);

  // 失焦 / 切走立即结束
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') stopCreating();
    else evaluate();
  });
  window.addEventListener('blur', stopCreating);
  window.addEventListener('focus', evaluate);

  // 周期性兜底：SW 重启后重发 START（间隔由 REPING_MS 限流，不会重复发）
  setInterval(evaluate, CARET_POLL_MS);
})();
