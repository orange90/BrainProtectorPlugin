/**
 * content-general.js — 通用层：注入所有网站
 *
 * 职责：
 *   1. 上报页面元信息（标题），供 background 计时与分类
 *   2. 通用创作状态检测：焦点在可编辑元素 + 持续键盘输入
 */
(function () {
  'use strict';

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
    } catch (e) {
      /* 扩展上下文失效，忽略 */
    }
  }

  /* ── 页面元信息上报 ── */
  function reportMeta() {
    send({ type: 'PAGE_META', title: document.title || '', tags: [], content_type: 'page', source: 'general' });
  }
  reportMeta();

  // 标题变化（SPA 站点常见）时重新上报
  const titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(reportMeta).observe(titleEl, { childList: true });
  }
  let lastTitle = document.title;
  setInterval(() => {
    if (document.title !== lastTitle) {
      lastTitle = document.title;
      reportMeta();
    }
  }, 5000);

  /* ── 通用创作状态检测 ── */
  let creatingTimer = null;
  let isCreating = false;

  function isEditableTarget() {
    const a = document.activeElement;
    if (!a) return false;
    return a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable === true;
  }

  document.addEventListener('keydown', (e) => {
    // 过滤功能键，只计真实输入；保留 Backspace/Delete
    if (e.key && e.key.length > 1 && !['Backspace', 'Delete'].includes(e.key)) return;
    if (!isEditableTarget()) return;

    if (!isCreating) {
      isCreating = true;
      send({ type: 'START_CREATING', source: 'general' });
    }

    // 停止输入超过 2 分钟，自动切回浏览状态
    clearTimeout(creatingTimer);
    creatingTimer = setTimeout(() => {
      isCreating = false;
      send({ type: 'STOP_CREATING', source: 'general' });
    }, 2 * 60 * 1000);
  }, true);

  // 失焦于编辑器立即结束创作
  document.addEventListener('blur', () => {
    if (isCreating && !isEditableTarget()) {
      isCreating = false;
      clearTimeout(creatingTimer);
      send({ type: 'STOP_CREATING', source: 'general' });
    }
  }, true);
})();
