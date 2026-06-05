/* ============================================================
   新标签页接管守卫 —— 在页面渲染前决定行为，避免闪烁
   · 作为工具栏弹窗(popup)打开：始终显示面板（Dashboard）
   · 作为新标签页打开：
       - newtabTakeover === false → 跳转空白页（放弃接管）
       - true 或 未决定          → 显示面板（未决定时由主脚本征询）
   注：MV3 无法在运行时注销 chrome_url_overrides，故以「跳转空白页」
       的方式实现「不接管」。
   ============================================================ */
(function () {
  'use strict';
  var html = document.documentElement;
  function reveal() { html.classList.remove('nt-boot'); }

  // 兜底：1.2s 内若仍未决定，强制显示，避免任何异常导致永久空白
  var failSafe = setTimeout(reveal, 1200);
  function done(fn) { clearTimeout(failSafe); fn(); }

  try {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.storage) {
      done(reveal);
      return;
    }
    chrome.tabs.getCurrent(function (tab) {
      if (!tab) { done(reveal); return; }              // popup：始终显示
      chrome.storage.local.get(['newtabTakeover'], function (res) {
        if (res && res.newtabTakeover === false) {
          done(function () { location.replace('about:blank'); });
        } else {
          done(reveal);                                 // true 或 未决定
        }
      });
    });
  } catch (e) {
    done(reveal);
  }
})();
