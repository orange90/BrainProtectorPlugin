/**
 * src/categorize.js — 分类规则引擎（共享）
 *
 * 匹配优先级：① 深度感知层话题标签 → ② 页面标题关键词 → ③ 兜底「未分类」
 * 规则默认值内置于此，options 页面可写入 chrome.storage.local 覆盖。
 */
(function (global) {
  'use strict';

  const DEFAULT_CATEGORIES = {
    '数码娱乐': {
      keywords: ['小米', '华为', 'iPhone', '苹果', '三星', 'OPPO', 'vivo', '开箱', '评测', '旗舰机', '手机', '数码', '相机', '耳机', '笔记本'],
      color: '#E24B4A',
      alert_threshold_minutes: 30,
    },
    'AI / 技术': {
      keywords: ['LLM', 'Claude', 'GPT', '大模型', 'Agent', '编程', 'Python', 'JavaScript', '算法', '机器学习', '深度学习', 'AI', '人工智能', '开源', '技术'],
      color: '#639922',
      alert_threshold_minutes: 0,
    },
    '内容创作': {
      keywords: ['写作', '自媒体', '流量', '涨粉', '选题', '爆款', '文案', '运营', '博客', '创作'],
      color: '#7F77DD',
      alert_threshold_minutes: 0,
    },
    '娱乐消遣': {
      keywords: ['综艺', '明星', '八卦', '游戏', '搞笑', '电影', '电视剧', '娱乐', '段子', '梗'],
      color: '#EF9F27',
      alert_threshold_minutes: 60,
    },
    '未分类': { keywords: [], color: '#9a9a92', alert_threshold_minutes: 0 },
  };

  const DEFAULT_SITE_GROUPS = {
    '社交媒体': ['twitter.com', 'x.com', 'weibo.com', 'threads.net', 'facebook.com', 'instagram.com'],
    '内容社区': ['zhihu.com', 'xiaohongshu.com', 'douban.com', 'tieba.baidu.com', 'reddit.com'],
    '视频': ['youtube.com', 'bilibili.com', 'douyin.com', 'iqiyi.com', 'youku.com'],
    '开发工具': ['github.com', 'stackoverflow.com', 'claude.ai', 'gitlab.com', 'developer.mozilla.org'],
    '效率办公': ['notion.so', 'feishu.cn', 'yuque.com', 'google.com', 'docs.google.com', 'docs.qq.com', 'doc.weixin.qq.com'],
  };

  /**
   * 这些在线文档子域单独统计，不折叠到主站。
   * 否则 docs.google.com 会并进 google.com（搜索）、docs.qq.com 会并进 qq.com，
   * 在文档里的创作时间就被混到主站头上，看起来「没记录」。
   */
  const KEEP_SUBDOMAINS = [
    'docs.google.com',
    'docs.qq.com',
    'doc.weixin.qq.com',
  ];

  /** 已知域名 → 展示名 */
  const DOMAIN_NAMES = {
    'zhihu.com': '知乎',
    'twitter.com': 'Twitter',
    'x.com': 'X',
    'xiaohongshu.com': '小红书',
    'weibo.com': '微博',
    'github.com': 'GitHub',
    'claude.ai': 'Claude.ai',
    'bilibili.com': '哔哩哔哩',
    'youtube.com': 'YouTube',
    'douban.com': '豆瓣',
    'stackoverflow.com': 'StackOverflow',
    'google.com': 'Google',
    'docs.google.com': 'Google 文档',
    'docs.qq.com': '腾讯文档',
    'doc.weixin.qq.com': '微信文档',
    'feishu.cn': '飞书',
    'yuque.com': '语雀',
    'notion.so': 'Notion',
  };

  let _fileDefaultsPromise = null;
  function loadFileDefaults() {
    if (_fileDefaultsPromise) return _fileDefaultsPromise;
    _fileDefaultsPromise = (async () => {
      const result = { categories: DEFAULT_CATEGORIES, siteGroups: DEFAULT_SITE_GROUPS };
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.getURL !== 'function') {
          return result;
        }
        const [catRes, sgRes] = await Promise.all([
          fetch(chrome.runtime.getURL('rules/categories.json')).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch(chrome.runtime.getURL('rules/site-groups.json')).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        if (catRes && typeof catRes === 'object') result.categories = catRes;
        if (sgRes && typeof sgRes === 'object') result.siteGroups = sgRes;
      } catch (e) {
        // 保留内置默认值
      }
      return result;
    })();
    return _fileDefaultsPromise;
  }

  function getDefaultRules() {
    return loadFileDefaults().then((d) => ({
      categories: JSON.parse(JSON.stringify(d.categories)),
      siteGroups: JSON.parse(JSON.stringify(d.siteGroups)),
    }));
  }

  function getRules() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['categories', 'siteGroups'], async (res) => {
          const hasCat = res && res.categories && typeof res.categories === 'object' && Object.keys(res.categories).length > 0;
          const hasSG = res && res.siteGroups && typeof res.siteGroups === 'object' && Object.keys(res.siteGroups).length > 0;
          if (hasCat && hasSG) {
            resolve({ categories: res.categories, siteGroups: res.siteGroups });
            return;
          }
          const defaults = await loadFileDefaults();
          resolve({
            categories: hasCat ? res.categories : defaults.categories,
            siteGroups: hasSG ? res.siteGroups : defaults.siteGroups,
          });
        });
      } catch (e) {
        loadFileDefaults().then((defaults) => resolve(defaults));
      }
    });
  }

  /** 根据标题 + 标签匹配分类 */
  function categorize(title, tags, categories) {
    categories = categories || DEFAULT_CATEGORIES;
    const haystack = [(title || ''), ...(tags || [])].join(' ').toLowerCase();
    // 标签优先：标签命中权重更高（先扫一遍标签，再扫标题）
    const tagText = (tags || []).join(' ').toLowerCase();
    for (const pass of [tagText, haystack]) {
      if (!pass) continue;
      for (const [name, def] of Object.entries(categories)) {
        if (name === '未分类') continue;
        const kws = def.keywords || [];
        for (const kw of kws) {
          if (kw && pass.includes(kw.toLowerCase())) return name;
        }
      }
    }
    return '未分类';
  }

  function rootDomain(hostname) {
    if (!hostname) return '';
    const host = hostname.replace(/^www\./, '');
    // 在线文档子域保留全名，与主站分开统计
    if (KEEP_SUBDOMAINS.includes(host)) return host;
    const parts = host.split('.');
    if (parts.length <= 2) return parts.join('.');
    // 处理 .com.cn / .co.uk 等
    const secondLevel = ['com', 'net', 'org', 'gov', 'edu', 'co'];
    if (secondLevel.includes(parts[parts.length - 2])) {
      return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
  }

  function siteGroupOf(domain, siteGroups) {
    siteGroups = siteGroups || DEFAULT_SITE_GROUPS;
    for (const [group, domains] of Object.entries(siteGroups)) {
      if (domains.some((d) => domain === d || domain.endsWith('.' + d))) return group;
    }
    return '其他';
  }

  function prettyDomain(domain) {
    return DOMAIN_NAMES[domain] || domain;
  }

  global.BPCat = {
    DEFAULT_CATEGORIES,
    DEFAULT_SITE_GROUPS,
    DOMAIN_NAMES,
    getRules,
    getDefaultRules,
    categorize,
    rootDomain,
    siteGroupOf,
    prettyDomain,
  };
})(typeof self !== 'undefined' ? self : this);
