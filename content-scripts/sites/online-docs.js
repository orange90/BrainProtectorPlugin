/**
 * online-docs.js — 在线文档创作检测层
 *
 * 通用层（content-general.js）靠「activeElement 是 textarea / contenteditable + 文本净增长」
 * 判定创作。但 Google Docs / 腾讯文档 / 飞书 等用 canvas 渲染正文，真正接收输入的是一个
 * 离屏 iframe 里的隐藏 contenteditable，主文档的 activeElement 测不到、也读不到文本长度。
 *
 * 这一层改用「按键节奏」信号：在已知在线文档域名上（含其编辑器 iframe，故 all_frames），
 * 统计持续的可打印按键 / 输入法上屏，达到阈值即判作创作；停止输入 2 分钟自动切回浏览。
 * 单行 <input>（标题/搜索）排除在外。
 */
(function () {
  'use strict';

  const DOC_HOSTS = [
    /(^|\.)docs\.google\.com$/,
    /(^|\.)docs\.qq\.com$/,
    /(^|\.)doc\.weixin\.qq\.com$/,
    /(^|\.)feishu\.cn$/,
    /(^|\.)larksuite\.com$/,
    /(^|\.)larkoffice\.com$/,
    /(^|\.)yuque\.com$/,
    /(^|\.)notion\.so$/,
    /(^|\.)notion\.site$/,
  ];
  if (!DOC_HOSTS.some((re) => re.test(location.hostname))) return;

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
    } catch (e) { /* 扩展上下文失效，忽略 */ }
  }

  const MIN_KEYS = 6;                 // 连续 6 次有效输入才认作创作，挡住误触/快捷键
  const IDLE_MS = 2 * 60 * 1000;      // 停手 2 分钟切回浏览
  const REPING_MS = 8000;             // 每 8s 重发一次 START，单条丢失可自愈

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
})();
