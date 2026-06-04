/**
 * content-general.js — 通用层：注入所有网站
 *
 * 职责：
 *   1. 上报页面元信息（标题），并周期性发送活动心跳（自愈：SW 被回收后能重新计时）
 *   2. 通用创作状态检测：焦点在可编辑元素 + 持续键盘输入（周期性重发，单条丢失可自愈）
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

  /* ── 通用创作状态检测 ── */
  let creatingTimer = null;
  let lastCreatingPing = 0;

  function isEditableTarget() {
    const a = document.activeElement;
    if (!a) return false;
    return a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable === true;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key && e.key.length > 1 && !['Backspace', 'Delete'].includes(e.key)) return;
    if (!isEditableTarget()) return;

    const now = Date.now();
    // 首次或每 8s 重发一次 START_CREATING，单条消息丢失也能自愈
    if (now - lastCreatingPing > 8000) {
      lastCreatingPing = now;
      send({ type: 'START_CREATING', source: 'general' });
    }

    // 停止输入超过 2 分钟，自动切回浏览状态
    clearTimeout(creatingTimer);
    creatingTimer = setTimeout(() => {
      lastCreatingPing = 0;
      send({ type: 'STOP_CREATING', source: 'general' });
    }, 2 * 60 * 1000);
  }, true);

  // 失焦于编辑器立即结束创作
  document.addEventListener('blur', () => {
    if (lastCreatingPing && !isEditableTarget()) {
      lastCreatingPing = 0;
      clearTimeout(creatingTimer);
      send({ type: 'STOP_CREATING', source: 'general' });
    }
  }, true);
})();
