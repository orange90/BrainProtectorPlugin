/**
 * sites/zhihu.js — 知乎深度感知层
 *
 *   · 问题页 / 话题页：读取官方话题标签，分类精度最高
 *   · 首页 Feed：MutationObserver 捕获新卡片 + IntersectionObserver 测停留，
 *     把当前主导卡片的话题上报为「当前上下文」，让知乎时间被精确归类
 *   · 答题 / 写文章编辑器：基于 contenteditable 的文本净增长检测创作状态
 *     （只认正经编辑器，排除评论框；用 input 事件兼容中文输入法上屏 / 粘贴）
 */
(function () {
  'use strict';

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
    } catch (e) {
      /* ignore */
    }
  }

  const path = location.pathname;

  /* 知乎创作类页面识别：URL 命中即视为「创作场景」，
     即便用户只是停留思考、没有持续敲字（未触发 START_CREATING），
     也不会被兜底为「未分类」，而是归入「内容创作」。 */
  function isCreatorPage() {
    const host = location.host;
    if (/(^|\.)zhuanlan\.zhihu\.com$/.test(host)) {
      // 专栏写作 / 编辑：/write、/write/xxx
      if (/^\/write(\/|$)/.test(path)) return true;
    }
    // 创作者中心：/creator、/creator/...
    if (/^\/creator(\/|$)/.test(path)) return true;
    // 答案编辑态：/question/<id>/answer/<aid>/edit、/answer/<aid>/edit
    if (/\/answer\/[^/]+\/edit(\/|$)/.test(path)) return true;
    if (/^\/question\/[^/]+\/answer\/[^/]+\/edit(\/|$)/.test(path)) return true;
    // 想法 / 文章新建入口
    if (/^\/pin\/edit(\/|$)/.test(path)) return true;
    return false;
  }

  /* ───────── 问题页 / 话题页：读取官方标签 ───────── */
  function reportStaticMeta() {
    let title = '';
    let tags = [];
    let content_type = 'page';

    if (isCreatorPage()) {
      content_type = 'creator';
      title = document.title || '知乎创作';
      // 带上「创作」「内容创作」关键词，命中「内容创作」分类，避免兜底为「未分类」
      tags = ['创作', '内容创作'];
    } else if (/^\/question\//.test(path)) {
      content_type = 'question';
      title = (document.querySelector('h1.QuestionHeader-title') || {}).innerText || document.title;
      tags = [...document.querySelectorAll('.QuestionHeader-topics .TopicLink, .Tag .Popover div')]
        .map((el) => (el.innerText || '').trim())
        .filter(Boolean);
    } else if (/^\/topic\//.test(path)) {
      content_type = 'topic';
      const h1 = document.querySelector('.TopicMetaCard-title, h1');
      title = (h1 && h1.innerText) || document.title;
      if (title) tags = [title.trim()];
    } else if (/^\/p\//.test(path) || /zhuanlan/.test(location.host)) {
      content_type = 'article';
      const h1 = document.querySelector('h1.Post-Title, h1');
      title = (h1 && h1.innerText) || document.title;
      tags = [...document.querySelectorAll('.Post-topicsContainer .TopicLink')]
        .map((el) => (el.innerText || '').trim())
        .filter(Boolean);
    }

    if (title) {
      send({ type: 'PAGE_META', title: title.trim(), tags, content_type, source: 'deep' });
    }
  }

  // 知乎多为异步渲染，延迟并重试上报
  reportStaticMeta();
  let metaTries = 0;
  const metaTimer = setInterval(() => {
    reportStaticMeta();
    if (++metaTries >= 6) clearInterval(metaTimer);
  }, 1500);

  /* ───────── 首页 Feed：双 Observer 测停留 + 上报主导话题 ───────── */
  const DWELL_MS = 3000; // 停留 ≥ 3 秒才认作有效上下文
  const dwellTimers = new WeakMap();

  function cardMeta(card) {
    const titleEl = card.querySelector('.ContentItem-title, h2 a, .ContentItem-title a');
    const title = titleEl ? (titleEl.innerText || '').trim() : '';
    const tags = [...card.querySelectorAll('.TopicLink, .Tag')]
      .map((el) => (el.innerText || '').trim())
      .filter(Boolean);
    return { title, tags };
  }

  function setupFeedObservers() {
    const feed = document.querySelector('.Feed, .Topstory-mainColumn, [role="feed"]');
    if (!feed) return false;

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const card = entry.target;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          const t = setTimeout(() => {
            const meta = cardMeta(card);
            if (meta.title || meta.tags.length) {
              send({ type: 'FEED_CONTEXT', title: meta.title, tags: meta.tags });
            }
          }, DWELL_MS);
          dwellTimers.set(card, t);
        } else {
          const t = dwellTimers.get(card);
          if (t) clearTimeout(t);
        }
      });
    }, { threshold: [0.5] });

    const observeCards = (root) => {
      root.querySelectorAll('.Feed-item, .TopstoryItem, .Card.TopstoryItem').forEach((c) => io.observe(c));
    };
    observeCards(feed);

    new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches('.Feed-item, .TopstoryItem')) io.observe(node);
          if (node.querySelectorAll) observeCards(node);
        });
      });
    }).observe(feed, { childList: true, subtree: true });

    return true;
  }

  // Feed 容器可能延迟出现
  if (path === '/' || /^\/$/.test(path)) {
    let tries = 0;
    const feedTimer = setInterval(() => {
      if (setupFeedObservers() || ++tries >= 10) clearInterval(feedTimer);
    }, 1000);
  }

  /* ───────── 答题 / 写文章编辑器：创作检测 ─────────
   * 以「当前聚焦的 contenteditable」为准，排除评论框等轻输入；
   * 用 input 事件 + 文本净增长，兼容中文输入法上屏 / 粘贴。
   */
  const Z_MIN_GROWTH = 8;

  function zhihuEditor() {
    const a = document.activeElement;
    if (!a || a.isContentEditable !== true) return null;
    // 排除评论框：评论也是输入，但按约定不计为创作
    if (a.closest('.Comments, .CommentEditorV2, .CommentEditor, .CommentRichText, .CommentTopbar')) return null;
    return a;
  }

  function zTextLen(el) { return el ? (el.textContent || '').length : 0; }

  let editorLastPing = 0;
  let editorTimer = null;
  let zCur = null, zLastLen = 0, zGrown = 0;

  function zReset(el) { zCur = el; zLastLen = zTextLen(el); zGrown = 0; }

  function zStop() {
    if (!editorLastPing) return;
    editorLastPing = 0;
    clearTimeout(editorTimer);
    send({ type: 'STOP_CREATING', source: 'zhihu-editor' });
  }

  // 编辑器内文本净增长 = 创作；每 8s 重发一次（自愈），停止 2 分钟切回浏览
  document.addEventListener('input', () => {
    const el = zhihuEditor();
    if (!el) return;
    if (el !== zCur) zReset(el);
    const len = zTextLen(el);
    if (len > zLastLen) zGrown += len - zLastLen;
    zLastLen = len;
    if (zGrown < Z_MIN_GROWTH) return;

    const now = Date.now();
    if (now - editorLastPing > 8000) {
      editorLastPing = now;
      send({ type: 'START_CREATING', source: 'zhihu-editor' });
    }
    clearTimeout(editorTimer);
    editorTimer = setTimeout(zStop, 2 * 60 * 1000);
  }, true);

  // 失焦 / 提交后焦点离开编辑器即结束创作
  document.addEventListener('blur', () => {
    if (!zhihuEditor()) { zReset(null); zStop(); }
  }, true);
})();
