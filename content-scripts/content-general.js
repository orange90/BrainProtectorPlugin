/**
 * content-general.js — 通用层：注入所有网站
 *
 * 职责：
 *   1. 上报页面元信息（标题），并周期性发送活动心跳（自愈：SW 被回收后能重新计时）
 *   2. 通用创作状态检测：焦点在「正经编辑器」(textarea / contenteditable) + 文本净增长
 *      （用 input 事件，兼容中文输入法上屏 / 粘贴 / 听写；周期性重发，单条丢失可自愈）
 */
(function () {
  'use strict';

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
    } catch (e) { /* 扩展上下文失效，忽略 */ }
  }

  function focusedVisible() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  /* ── 页面元信息 / 活动心跳 ── */
  function reportMeta() {
    send({ type: 'PAGE_META', title: document.title || '', tags: [], content_type: 'page', source: 'general' });
  }
  reportMeta();

  const titleEl = document.querySelector('title');
  if (titleEl) new MutationObserver(reportMeta).observe(titleEl, { childList: true });

  let lastTitle = document.title;
  // 每 20s：若页面可见且聚焦，发送活动心跳让后台保持/重建计时
  setInterval(() => {
    if (document.title !== lastTitle) { lastTitle = document.title; reportMeta(); return; }
    if (focusedVisible()) send({ type: 'ACTIVITY_PING', title: document.title || '' });
  }, 20000);

  /* ── 通用创作状态检测 ──
   * 信号 = 在「正经编辑器」里文本净增长。用 input 而非 keydown：中文输入法合成期
   * keydown 的 e.key 是 'Process'，旧逻辑会把整段中文创作漏掉；input 则覆盖输入法
   * 上屏、粘贴、语音听写、自动补全。单行 <input>（搜索 / 登录 / 地址）一律不算创作。
   * 知乎交由 sites/zhihu.js 精确判定（排除评论框），通用层在知乎上不介入。
   */
  const IS_ZHIHU = /(^|\.)zhihu\.com$/.test(location.hostname);
  const MIN_GROWTH = 8; // 净增长达 8 字才认作真正在创作，挡住「改俩字 / 误触」

  let creatingTimer = null;
  let lastCreatingPing = 0;
  let curEditor = null, lastLen = 0, grown = 0;

  function editorEl() {
    if (IS_ZHIHU) return null;
    const a = document.activeElement;
    if (!a) return null;
    if (a.isContentEditable === true) return a;
    if (a.tagName === 'TEXTAREA') return a;
    return null; // 单行 input 不算创作
  }

  function textLen(el) {
    if (!el) return 0;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return (el.value || '').length;
    return (el.textContent || '').length;
  }

  function resetGrowth(el) { curEditor = el; lastLen = textLen(el); grown = 0; }

  function stopCreating() {
    if (!lastCreatingPing) return;
    lastCreatingPing = 0;
    clearTimeout(creatingTimer);
    send({ type: 'STOP_CREATING', source: 'general' });
  }

  document.addEventListener('input', () => {
    const el = editorEl();
    if (!el) return;
    if (el !== curEditor) resetGrowth(el);
    const len = textLen(el);
    if (len > lastLen) grown += len - lastLen; // 仅累计净增长，删除不计
    lastLen = len;
    if (grown < MIN_GROWTH) return;

    const now = Date.now();
    // 首次或每 8s 重发一次 START_CREATING，单条消息丢失也能自愈
    if (now - lastCreatingPing > 8000) {
      lastCreatingPing = now;
      send({ type: 'START_CREATING', source: 'general' });
    }
    // 停止输入超过 2 分钟，自动切回浏览状态
    clearTimeout(creatingTimer);
    creatingTimer = setTimeout(stopCreating, 2 * 60 * 1000);
  }, true);

  // 失焦于编辑器立即结束创作
  document.addEventListener('blur', () => {
    if (!editorEl()) { resetGrowth(null); stopCreating(); }
  }, true);
})();
