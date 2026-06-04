/**
 * sites/zhihu.js — 知乎深度感知层
 *
 *   · 问题页 / 话题页：读取官方话题标签，分类精度最高
 *   · 首页 Feed：MutationObserver 捕获新卡片 + IntersectionObserver 测停留，
 *     把当前主导卡片的话题上报为「当前上下文」，让知乎时间被精确归类
 *   · 答题编辑器：基于 Draft.js 的 contenteditable，单独检测创作状态
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

  /* ───────── 问题页 / 话题页：读取官方标签 ───────── */
  function reportStaticMeta() {
    let title = '';
    let tags = [];
    let content_type = 'page';

    if (/^\/question\//.test(path)) {
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

  /* ───────── 答题编辑器：创作检测 ───────── */
  function detectZhihuEditor() {
    const editorRoot = document.querySelector(
      '.InputLike.AnswerForm-editor .DraftEditor-root, .RichText-editor, .Editable-content, .public-DraftEditor-content'
    );
    if (!editorRoot) return false;
    const editable = editorRoot.matches('[contenteditable="true"]')
      ? editorRoot
      : editorRoot.querySelector('[contenteditable="true"]');
    return !!editable;
  }

  let editorCreating = false;
  let editorTimer = null;

  // 编辑器内键盘输入 = 创作；停止 2 分钟切回浏览
  document.addEventListener('keydown', (e) => {
    if (!detectZhihuEditor()) return;
    if (e.key && e.key.length > 1 && !['Backspace', 'Delete'].includes(e.key)) return;
    if (!editorCreating) {
      editorCreating = true;
      send({ type: 'START_CREATING', source: 'zhihu-editor' });
    }
    clearTimeout(editorTimer);
    editorTimer = setTimeout(() => {
      editorCreating = false;
      send({ type: 'STOP_CREATING', source: 'zhihu-editor' });
    }, 2 * 60 * 1000);
  }, true);

  // 编辑器消失（提交/关闭）时结束创作
  new MutationObserver(() => {
    if (editorCreating && !detectZhihuEditor()) {
      editorCreating = false;
      clearTimeout(editorTimer);
      send({ type: 'STOP_CREATING', source: 'zhihu-editor' });
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
