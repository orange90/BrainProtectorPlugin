/**
 * focus-block.js — 专注会话期间的硬拦截层
 *
 * 触发条件（与 background 一致）：
 *   ① 用户在新标签页开启了番茄 / 深度 / 自定义专注计时器（focusTimerState.running === true）
 *   ② 当前页面域名落在用户在「设置」中维护的「分心域名」清单内
 *   ③ 当前域名尚未在本次专注会话内被「我必须现在用」放行
 *
 * 体验：
 *   · 注入一个最高 z-index 的全屏遮罩（Shadow DOM 隔离站点样式），冻结页面滚动
 *   · 强制 5 秒倒计时，期间「我必须现在用」按钮禁用
 *   · 倒计时归零后启用按钮；点击后向 background 发送 GRANT_DOMAIN_BYPASS，并移除遮罩
 *   · 同时提供「回到上一页 / 关闭此页」两个更安全的逃生口
 *   · 监听 chrome.storage 变化：若用户停止 / 重置计时器、或将域名移出清单，遮罩立即消失
 *   · SPA 导航（pushState/replaceState/popstate）后重新检查当前 URL
 */
(function () {
  'use strict';

  // 仅处理顶层 frame，避免每个 iframe 都注入遮罩
  if (window.top !== window.self) return;
  if (window.__BP_FOCUS_BLOCK_INSTALLED__) return;
  window.__BP_FOCUS_BLOCK_INSTALLED__ = true;

  const HOST_ID = 'bp-focus-block-host';
  let hostEl = null;        // shadow host
  let shadow = null;
  let countdownTimer = null;
  let bodyOverflowBackup = '';
  let htmlOverflowBackup = '';
  let lastCheckedUrl = location.href;

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          void chrome.runtime.lastError;
          resolve(resp || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function currentHost() {
    return (location.hostname || '').toLowerCase().replace(/^www\./, '');
  }

  async function checkAndShow() {
    if (!/^https?:$/.test(location.protocol)) return;
    const host = currentHost();
    if (!host) return;
    const resp = await send({ type: 'GET_FOCUS_BLOCK_STATE', hostname: host });
    if (!resp || !resp.ok) return;
    if (resp.shouldBlock) {
      showMask({
        domain: host,
        focusEndAt: resp.focusEndAt,
      });
    } else {
      hideMask();
    }
  }

  function fmtRemain(ms) {
    if (!ms || ms <= 0) return '00:00';
    const sec = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function lockScroll() {
    try {
      bodyOverflowBackup = document.body ? document.body.style.overflow : '';
      htmlOverflowBackup = document.documentElement ? document.documentElement.style.overflow : '';
      if (document.documentElement) document.documentElement.style.overflow = 'hidden';
      if (document.body) document.body.style.overflow = 'hidden';
    } catch (e) { /* ignore */ }
  }

  function unlockScroll() {
    try {
      if (document.documentElement) document.documentElement.style.overflow = htmlOverflowBackup;
      if (document.body) document.body.style.overflow = bodyOverflowBackup;
    } catch (e) { /* ignore */ }
  }

  function showMask({ domain, focusEndAt }) {
    if (hostEl) return; // 已在显示
    // 先尝试附着到 documentElement，body 可能还未生成
    const root = document.body || document.documentElement;
    if (!root) {
      // DOM 还没准备好，等一下再试
      document.addEventListener('DOMContentLoaded', () => showMask({ domain, focusEndAt }), { once: true });
      return;
    }
    hostEl = document.createElement('div');
    hostEl.id = HOST_ID;
    // 即便页面用 z-index 也压不过我们
    hostEl.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;';
    shadow = hostEl.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; }
        .overlay {
          position: fixed; inset: 0;
          background: radial-gradient(900px 520px at 20% 10%, rgba(255,120,0,0.18), transparent 60%),
                      radial-gradient(760px 480px at 90% 90%, rgba(44,122,107,0.18), transparent 55%),
                      rgba(12, 14, 18, 0.92);
          color: #f3f4f6;
          font-family: "Inter","SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(8px) saturate(1.1);
          -webkit-backdrop-filter: blur(8px) saturate(1.1);
          animation: fadeIn 0.18s ease-out;
        }
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        .card {
          max-width: 480px; width: calc(100% - 32px);
          background: rgba(28, 30, 36, 0.86);
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 18px;
          padding: 34px 32px 28px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08);
          text-align: center;
        }
        .mark {
          font-size: 10.5px; letter-spacing: 0.24em; text-transform: uppercase;
          color: #ff8c2b; font-weight: 600; margin-bottom: 12px;
        }
        h1 {
          font-size: 22px; font-weight: 650; letter-spacing: 0.01em;
          margin: 0 0 10px; line-height: 1.3;
        }
        .domain {
          display: inline-block; padding: 4px 10px;
          background: rgba(255,140,43,0.16); color: #ffb578;
          border: 1px solid rgba(255,140,43,0.32); border-radius: 6px;
          font-family: ui-monospace,"SF Mono",Menlo,monospace;
          font-size: 13px; margin: 4px 0 14px;
        }
        .desc {
          font-size: 13.5px; color: #c4c8d1; line-height: 1.65;
          margin: 0 0 20px;
        }
        .desc strong { color: #ffb578; font-weight: 600; }
        .ring {
          width: 92px; height: 92px; border-radius: 50%;
          margin: 6px auto 18px;
          background: conic-gradient(#ff8c2b var(--p, 0%), rgba(255,255,255,0.10) 0);
          display: flex; align-items: center; justify-content: center;
          position: relative;
        }
        .ring::after {
          content: ''; position: absolute; inset: 6px;
          background: rgba(28, 30, 36, 0.96); border-radius: 50%;
        }
        .ring .num {
          position: relative; z-index: 1; font-size: 30px; font-weight: 650;
          color: #fff; font-variant-numeric: tabular-nums;
        }
        .ring .num.done { color: #5bb39e; }
        .actions {
          display: flex; flex-direction: column; gap: 10px;
          margin-top: 8px;
        }
        button {
          font-family: inherit; font-size: 13.5px; font-weight: 500;
          border-radius: 10px; padding: 11px 18px; cursor: pointer;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.06); color: #e7eaef;
          transition: background 0.15s, border-color 0.15s, transform 0.1s;
        }
        button:hover:not(:disabled) { background: rgba(255,255,255,0.10); border-color: rgba(255,255,255,0.22); }
        button:active:not(:disabled) { transform: scale(0.98); }
        button.danger {
          background: rgba(224, 122, 110, 0.10);
          border-color: rgba(224, 122, 110, 0.35);
          color: #f0a39a;
        }
        button.danger:disabled {
          opacity: 0.45; cursor: not-allowed;
        }
        button.danger:not(:disabled):hover {
          background: rgba(224, 122, 110, 0.18);
          border-color: rgba(224, 122, 110, 0.55);
        }
        .secondary-row {
          display: flex; gap: 10px; margin-top: 4px;
        }
        .secondary-row button { flex: 1; font-size: 12.5px; padding: 9px 12px; }
        .foot {
          margin-top: 16px; font-size: 11.5px; color: #8a909b;
        }
        .foot .focus-remain {
          color: #5bb39e; font-variant-numeric: tabular-nums; font-weight: 500;
        }
      </style>
      <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="bpfb-title">
        <div class="card">
          <div class="mark">Brain Protector · 专注守护</div>
          <h1 id="bpfb-title">你正在专注，确定要打开吗？</h1>
          <div class="domain" id="bpfb-domain">${escapeText(domain)}</div>
          <div class="desc">
            这是你标记为<strong>分心域名</strong>的网站。<br/>
            倒计时结束后，你可以选择继续访问 —— 但请确认这真的是必要的。
          </div>
          <div class="ring" id="bpfb-ring"><span class="num" id="bpfb-num">5</span></div>
          <div class="actions">
            <button class="danger" id="bpfb-go" disabled>等待 5 秒…</button>
            <div class="secondary-row">
              <button id="bpfb-back">回到上一页</button>
              <button id="bpfb-close">关闭此页</button>
            </div>
          </div>
          <div class="foot">
            ${focusEndAt ? `本轮专注剩余 <span class="focus-remain" id="bpfb-remain">${fmtRemain(focusEndAt - Date.now())}</span>` : '专注中'}
          </div>
        </div>
      </div>
    `;
    (document.body || document.documentElement).appendChild(hostEl);
    lockScroll();

    const ring = shadow.getElementById('bpfb-ring');
    const numEl = shadow.getElementById('bpfb-num');
    const goBtn = shadow.getElementById('bpfb-go');
    const backBtn = shadow.getElementById('bpfb-back');
    const closeBtn = shadow.getElementById('bpfb-close');
    const remainEl = shadow.getElementById('bpfb-remain');

    let left = 5;
    function tick() {
      numEl.textContent = String(left);
      ring.style.setProperty('--p', ((5 - left) / 5 * 100) + '%');
      if (remainEl && focusEndAt) remainEl.textContent = fmtRemain(focusEndAt - Date.now());
      if (left <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        // 倒计时归零后，每秒仍刷新专注剩余时间
        if (focusEndAt) countdownTimer = setInterval(() => {
          if (remainEl) remainEl.textContent = fmtRemain(focusEndAt - Date.now());
        }, 1000);
        numEl.textContent = '✓';
        numEl.classList.add('done');
        ring.style.setProperty('--p', '100%');
        goBtn.disabled = false;
        goBtn.textContent = '我必须现在用';
        return;
      }
      left--;
    }
    tick();
    countdownTimer = setInterval(tick, 1000);

    goBtn.addEventListener('click', async () => {
      if (goBtn.disabled) return;
      goBtn.disabled = true;
      goBtn.textContent = '正在放行…';
      await send({ type: 'GRANT_DOMAIN_BYPASS', hostname: currentHost() });
      hideMask();
    });
    backBtn.addEventListener('click', () => {
      hideMask();
      if (history.length > 1) history.back();
      else window.close();
    });
    closeBtn.addEventListener('click', () => {
      hideMask();
      window.close();
    });
  }

  function hideMask() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (hostEl && hostEl.parentNode) hostEl.parentNode.removeChild(hostEl);
    hostEl = null;
    shadow = null;
    unlockScroll();
  }

  function escapeText(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── 启动：立即检查一次 ── */
  checkAndShow();

  /* ── 监听 storage：计时器停止 / 清单变更 / 放行变更 → 重新判定 ── */
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.focusTimerState || changes.blockDomains) checkAndShow();
    });
  } catch (e) { /* ignore */ }

  /* ── SPA 导航：监听 URL 变化重新判定 ── */
  const _push = history.pushState;
  const _replace = history.replaceState;
  function onUrlChange() {
    if (location.href === lastCheckedUrl) return;
    lastCheckedUrl = location.href;
    // 切换到新 URL 时，先撤掉旧遮罩再重新询问；新页面若仍命中则会立刻重新出现
    hideMask();
    checkAndShow();
  }
  history.pushState = function () { const r = _push.apply(this, arguments); onUrlChange(); return r; };
  history.replaceState = function () { const r = _replace.apply(this, arguments); onUrlChange(); return r; };
  window.addEventListener('popstate', onUrlChange);
  window.addEventListener('hashchange', onUrlChange);

  /* ── 标签页重新可见时复查（处理「专注期间切回此 tab」） ── */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkAndShow();
  });
})();
