/**
 * src/ai-analyzer.js — AI 行为分析模块
 *
 * 职责：
 *   1. 从 IndexedDB 读取最近 N 天的记录与专注会话；
 *   2. 计算可解释的行为指标（总时长、浏览/创作比、Top 域名、分类占比、
 *      切换频率、平均会话时长、空闲段、深夜活跃、知乎话题等）；
 *   3. 把指标压缩成紧凑 JSON 摘要，构造 prompt；
 *   4. 通过用户在设置里配置的 OpenAI 兼容接口发起 chat/completions 请求。
 *
 * 所有调用都是用户主动触发，密钥仅保存在本地浏览器。
 */
(function (global) {
  'use strict';

  const DEFAULT_SYSTEM_PROMPT = [
    '你是一名专业的「专注力 & 数字行为」教练，擅长结合时间数据给出可执行建议。',
    '请基于用户提供的浏览器行为指标 JSON，用中文输出一份结构化的 **Markdown** 分析报告，包含：',
    '1. 整体画像：用 2~3 句话概括用户最近的使用模式；',
    '2. 关键观察：分点列出 3~5 条具体发现（必须引用具体数字，例如平均切换 X 次/小时、Y 类时长占比 Z%）；',
    '3. 风险信号：例如频繁切换、深夜使用、分心域名占比过高、单个网站时长过长等；',
    '4. 当前状态：结合「extras」中的实时上下文（当前打开的标签页数量与构成、任务管理中的陈旧/重复标签、当前番茄/意图、信号灯）给出此刻的工作环境评估；',
    '5. 改进建议：给出 3 条以内可立刻执行、与数据强相关的建议（如「关闭 N 个陈旧标签」「先完成意图『xxx』再开新页」）；',
    '6. 鼓励一句：用一句不超过 30 字的正向反馈结尾。',
    '',
    '【创作 vs 浏览 · 必读分析口径】',
    '- 同一个站点（如 zhihu.com、feishu.cn、docs.google.com）可能同时贡献「浏览」和「创作」两类时长，**严禁仅看总时长就把站点笼统判定为「消耗」或「分心」**。',
    '- 在「关键观察」与「风险信号」中，凡是提及某个 Top 域名时，**必须**同时引用该域名的 `create` / `browse` 两个数字以及 `create_share_pct`（域内创作占比），并参考 `top_creating_domains` 中的 `create_share_pct_of_all_create`（该站贡献了全部创作时长的多少）。',
    '- 评估示例（务必模仿）：',
    '  · ✅ 「知乎 1h6m 中创作 37m（占该站 56%、占全部创作 X%），主要是输出而非消遣，整体偏健康」；',
    '  · ❌ 「知乎用了 1h6m，时长过长，建议减少使用」（这种说法忽略了创作占比，是错误的）。',
    '- 在「改进建议」中要区分「该站以创作为主」「该站以浏览为主」「该站浏览/创作各半」三种情形，给出不同建议；不要对创作占比高的站点提『减少使用』。',
    '- 若 `creation.total` 显著（例如 ≥ 总时长 20% 或 ≥ 30 分钟），应**单独**用一节或一个观察点强调创作产出，并结合 `creation.by_time_of_day` 指出用户的高产时段。',
    '',
    '篇幅要求（强制）：',
    '- 全文中文正文（不含 Mermaid 代码块与表格内文字）总字数控制在 **1000 字以内**，宁可精炼也不要冗长；',
    '- 每节内容点到为止，避免重复同一指标的多种表述。',
    '',
    '排版要求（重要）：',
    '- 使用 Markdown：二级/三级标题、无序列表、**加粗**、`代码`、必要时使用表格汇总 Top 数据。',
    '- **必须**包含 **2~3 张 Mermaid 图表**用于「比较 / 可视化」，且类型应有差异，避免全部使用同一种；图表语法必须放在 ```mermaid 代码块中。',
    '  建议组合（至少覆盖一种「对比」型，且**至少有一张图涉及「浏览 vs 创作」维度**，例如 Top 域名内浏览/创作堆叠对比、每日创作时长趋势、或创作时段分布）：',
    '    · `pie` —— 展示分类占比 / 浏览 vs 创作 / 时段构成；',
    '    · `xychart-beta` 或 `gantt` —— 展示每日时长、24 小时分布、切换频率趋势、每日创作时长等可对比数据；',
    '    · `flowchart` —— 概括「问题 → 建议」的改进路径或当前状态决策树；',
    '    · 也可使用 `quadrantChart` 对比「时长 × 切换频率」之类的双维度指标。',
    '- 图表必须服务于「比较」这一目的（同一维度的多项对照、时间序列对照、占比对照等），不要画装饰性图。',
    '- 所有引用的数字、域名、分类必须来自输入 JSON（包括顶层与 `extras` 字段），不要编造；如果某些维度数据缺失，请明确指出。',
    '- 标签与节点文本使用中文，简短为宜（≤ 10 字）。',
    '',
    '语气克制、专业、避免夸大。',
    '',
    '结尾规则（强制）：',
    '- 这是一份单向输出的分析报告，不是对话。**严禁**在报告末尾或任意位置出现任何向用户提问、征询意见或邀请继续互动的句子，例如「需要我…吗？」「是否需要进一步…？」「要不要我帮你…？」「如果你希望…请告诉我」「需要我针对…提供…吗？」之类的反问/引导句一律禁止。',
    '- 如果你想补充某个方向的建议，请直接在「改进建议」中以陈述句给出，不要以提问的形式抛给用户。',
    '- 报告必须以第 6 步「鼓励一句」作为最后一句结束，之后不得再追加任何额外文字。最后一句必须是正向鼓励的陈述句，不得包含问号「？」或「?」。',
  ].join('\n');

  const NO_QUESTION_RULES = [
    '',
    '【最高优先级 · 结尾规则 · 不可违反】',
    '- 本输出为单向分析报告，严禁出现任何反问、征询或邀请互动的句子。',
    '- 包括但不限于：「需要我…吗？」「是否需要…？」「要不要我…？」「如果你希望…请告诉我」「需要我针对…提供更详细的方案吗？」等所有以问号结尾的、面向用户的句子。',
    '- 报告必须以一句不超过 30 字的正向鼓励陈述句结尾，结尾句不得包含「？」「?」。',
  ].join('\n');

  /**
   * 兜底后处理：剥离 AI 偶发输出的「反问/邀请互动」尾句。
   * 仅处理报告末尾的整段反问句，不影响正文中合理的疑问表达。
   */
  function stripTrailingQuestions(text) {
    if (!text || typeof text !== 'string') return text;
    let out = text.replace(/\s+$/, '');
    const askPatterns = [
      /需要我[^\n。！!]*[?？]\s*$/,
      /是否需要[^\n。！!]*[?？]\s*$/,
      /要不要我[^\n。！!]*[?？]\s*$/,
      /如果你(希望|想|需要)[^\n。！!]*[，,。.!！?？]?\s*(请告诉我|可以告诉我|随时告诉我)[^\n]*$/,
      /如需[^\n。！!]*(可|请)告诉我[^\n]*$/,
      /可以告诉我[^\n。！!]*[?？]\s*$/,
      /^[>\-*\s]*[^？?\n]{0,80}[?？]\s*$/,
    ];
    for (let i = 0; i < 3; i++) {
      let changed = false;
      const lines = out.split(/\n/);
      while (lines.length) {
        const last = lines[lines.length - 1].trim();
        if (!last) { lines.pop(); changed = true; continue; }
        const isAsk = askPatterns.some((re) => re.test(last));
        if (isAsk) { lines.pop(); changed = true; continue; }
        break;
      }
      out = lines.join('\n').replace(/\s+$/, '');
      if (!changed) break;
    }
    return out;
  }

  /* ───────── 工具函数 ───────── */

  function dayKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function daysAgoKey(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return dayKey(d.getTime());
  }

  function fmtDur(sec) {
    sec = Math.round(sec || 0);
    if (sec < 60) return sec + 's';
    const m = Math.round(sec / 60);
    if (m < 60) return m + 'm';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  function round1(x) { return Math.round(x * 10) / 10; }

  /* ───────── 指标聚合 ───────── */

  /**
   * 聚合最近 dayCount 天（含今天）的行为指标。
   * @param {number} dayCount  天数窗口，默认 7
   * @returns {Promise<object>} 指标摘要
   */
  async function buildMetrics(dayCount) {
    if (!global.BPDB) throw new Error('BPDB 数据层未加载');
    const days = Math.max(1, Math.min(30, dayCount || 7));
    const today = global.BPDB.todayKey();
    const startDay = daysAgoKey(days - 1);

    const records = await global.BPDB.getRecordsInRange(startDay, today);
    // sessions 按天接口：循环取
    const sessions = [];
    for (let i = 0; i < days; i++) {
      const dk = daysAgoKey(i);
      try {
        const list = await global.BPDB.getSessionsByDay(dk);
        if (Array.isArray(list)) sessions.push(...list);
      } catch (e) { /* ignore */ }
    }

    // 总览
    let totalSec = 0, browseSec = 0, createSec = 0;
    const byDomain = new Map();      // domain -> sec (总时长)
    const byDomainBC = new Map();    // domain -> { browse, create } 域内浏览/创作拆分
    const byCategory = new Map();    // category -> sec
    const byCategoryBC = new Map();  // category -> { browse, create } 分类内浏览/创作拆分
    const byDay = new Map();         // day -> sec
    const byDayCreate = new Map();   // day -> create_sec 每日创作时长
    const byHour = new Array(24).fill(0); // 24 小时分布
    const byHourCreate = new Array(24).fill(0); // 24 小时创作分布
    const dayDomainSet = new Map();  // day -> Set(domain) 用于切换频率
    const dayDomainOrder = new Map();// day -> [domain,...] 用于相邻切换计数
    const zhihuTopics = new Map();   // title -> sec

    for (const r of records) {
      const dur = r.duration_seconds || 0;
      totalSec += dur;
      const isCreate = r.time_type === 'creating';
      if (isCreate) createSec += dur; else browseSec += dur;
      if (r.domain) {
        byDomain.set(r.domain, (byDomain.get(r.domain) || 0) + dur);
        if (!byDomainBC.has(r.domain)) byDomainBC.set(r.domain, { browse: 0, create: 0 });
        const bc = byDomainBC.get(r.domain);
        if (isCreate) bc.create += dur; else bc.browse += dur;
      }
      const cat = r.category || '未分类';
      byCategory.set(cat, (byCategory.get(cat) || 0) + dur);
      if (!byCategoryBC.has(cat)) byCategoryBC.set(cat, { browse: 0, create: 0 });
      const cbc = byCategoryBC.get(cat);
      if (isCreate) cbc.create += dur; else cbc.browse += dur;
      if (r.day) {
        byDay.set(r.day, (byDay.get(r.day) || 0) + dur);
        if (isCreate) byDayCreate.set(r.day, (byDayCreate.get(r.day) || 0) + dur);
      }

      // 小时分布（按 start_at 落在哪个小时计入起始小时）
      if (r.start_at) {
        const h = new Date(r.start_at).getHours();
        if (h >= 0 && h < 24) {
          byHour[h] += dur;
          if (isCreate) byHourCreate[h] += dur;
        }
      }

      // 切换：按 day 维护域名出现顺序
      if (r.day && r.domain) {
        if (!dayDomainSet.has(r.day)) dayDomainSet.set(r.day, new Set());
        dayDomainSet.get(r.day).add(r.domain);
        if (!dayDomainOrder.has(r.day)) dayDomainOrder.set(r.day, []);
        dayDomainOrder.get(r.day).push({ d: r.domain, t: r.start_at || 0 });
      }

      // 知乎话题
      if (r.domain && r.domain.includes('zhihu') && r.title && ['question', 'topic', 'article', 'feed'].includes(r.content_type)) {
        zhihuTopics.set(r.title, (zhihuTopics.get(r.title) || 0) + dur);
      }
    }

    // Top 10 域名（含域内浏览/创作拆分）
    const topDomains = [...byDomain.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([domain, sec]) => {
        const bc = byDomainBC.get(domain) || { browse: 0, create: 0 };
        return {
          domain,
          seconds: sec,
          readable: fmtDur(sec),
          share_pct: totalSec ? round1(sec / totalSec * 100) : 0,
          browse: fmtDur(bc.browse),
          create: fmtDur(bc.create),
          browse_seconds: bc.browse,
          create_seconds: bc.create,
          create_share_pct: sec ? round1(bc.create / sec * 100) : 0,
        };
      });

    // Top 创作域名（按域内创作秒数排序，只列出真有创作发生的站点）
    const topCreatingDomains = [...byDomainBC.entries()]
      .filter(([, bc]) => bc.create > 0)
      .sort((a, b) => b[1].create - a[1].create)
      .slice(0, 8)
      .map(([domain, bc]) => {
        const total = bc.browse + bc.create;
        return {
          domain,
          create: fmtDur(bc.create),
          browse: fmtDur(bc.browse),
          create_seconds: bc.create,
          create_share_pct_in_domain: total ? round1(bc.create / total * 100) : 0,
          create_share_pct_of_total: totalSec ? round1(bc.create / totalSec * 100) : 0,
          create_share_pct_of_all_create: createSec ? round1(bc.create / createSec * 100) : 0,
        };
      });

    // 分类占比（含分类内浏览/创作拆分）
    const categoryShare = [...byCategory.entries()].sort((a, b) => b[1] - a[1])
      .map(([cat, sec]) => {
        const bc = byCategoryBC.get(cat) || { browse: 0, create: 0 };
        return {
          category: cat,
          seconds: sec,
          readable: fmtDur(sec),
          share_pct: totalSec ? round1(sec / totalSec * 100) : 0,
          browse: fmtDur(bc.browse),
          create: fmtDur(bc.create),
          create_share_pct: sec ? round1(bc.create / sec * 100) : 0,
        };
      });

    // 每日切换频率（相邻记录中域名不同的次数 / 当日累计小时）
    let totalSwitches = 0;
    let totalActiveSec = 0;
    const daySwitchStats = [];
    for (const [day, arr] of dayDomainOrder) {
      arr.sort((a, b) => a.t - b.t);
      let switches = 0;
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].d !== arr[i - 1].d) switches++;
      }
      const sec = byDay.get(day) || 0;
      const hours = sec / 3600;
      const createOfDay = byDayCreate.get(day) || 0;
      totalSwitches += switches;
      totalActiveSec += sec;
      daySwitchStats.push({
        day,
        switches,
        unique_domains: (dayDomainSet.get(day) || new Set()).size,
        active: fmtDur(sec),
        create: fmtDur(createOfDay),
        create_share_pct: sec ? round1(createOfDay / sec * 100) : 0,
        switches_per_hour: hours > 0 ? round1(switches / hours) : 0,
      });
    }
    daySwitchStats.sort((a, b) => a.day < b.day ? -1 : 1);

    const overallSwitchesPerHour = totalActiveSec > 0 ? round1(totalSwitches / (totalActiveSec / 3600)) : 0;

    // 时段画像（含创作时段拆分）
    const part = (a, b) => byHour.slice(a, b).reduce((s, x) => s + x, 0);
    const partC = (a, b) => byHourCreate.slice(a, b).reduce((s, x) => s + x, 0);
    const morning = part(6, 12);
    const afternoon = part(12, 18);
    const evening = part(18, 23);
    const lateNight = part(23, 24) + part(0, 6);
    const morningC = partC(6, 12);
    const afternoonC = partC(12, 18);
    const eveningC = partC(18, 23);
    const lateNightC = partC(23, 24) + partC(0, 6);

    // 专注会话统计
    let focusSec = 0;
    let focusCount = sessions.length;
    let pomodoroCount = 0;
    for (const s of sessions) {
      const d = (s.duration_seconds != null) ? s.duration_seconds
        : (s.end_at && s.start_at ? Math.round((s.end_at - s.start_at) / 1000) : 0);
      focusSec += d || 0;
      if (s.mode === 'pomodoro' || s.type === 'pomodoro') pomodoroCount++;
    }

    // Top 知乎话题
    const topZhihu = [...zhihuTopics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([title, sec]) => ({ title, readable: fmtDur(sec), seconds: sec }));

    return {
      window: { days, start_day: startDay, end_day: today },
      totals: {
        total: fmtDur(totalSec),
        total_seconds: totalSec,
        browse: fmtDur(browseSec),
        create: fmtDur(createSec),
        create_share_pct: totalSec ? round1(createSec / totalSec * 100) : 0,
        unique_domains: byDomain.size,
        record_count: records.length,
      },
      creation: {
        total: fmtDur(createSec),
        total_seconds: createSec,
        share_of_all_pct: totalSec ? round1(createSec / totalSec * 100) : 0,
        avg_per_day: fmtDur(days ? createSec / days : 0),
        by_time_of_day: {
          morning_06_12: fmtDur(morningC),
          afternoon_12_18: fmtDur(afternoonC),
          evening_18_23: fmtDur(eveningC),
          late_night_23_06: fmtDur(lateNightC),
        },
        note: '创作时长 = 在站点编辑器/可编辑区域内有键盘输入或光标停留的实际焦点时间；同一站点既可能贡献「浏览」也可能贡献「创作」。请结合 top_domains[*].create / top_creating_domains 综合判断，不要仅凭某站点的总时长就把它定性为「分心」。',
      },
      top_domains: topDomains,
      top_creating_domains: topCreatingDomains,
      category_share: categoryShare,
      switching: {
        total_switches: totalSwitches,
        avg_switches_per_hour: overallSwitchesPerHour,
        per_day: daySwitchStats,
      },
      time_of_day: {
        morning_06_12: fmtDur(morning),
        afternoon_12_18: fmtDur(afternoon),
        evening_18_23: fmtDur(evening),
        late_night_23_06: fmtDur(lateNight),
        late_night_share_pct: totalSec ? round1(lateNight / totalSec * 100) : 0,
      },
      focus: {
        sessions_count: focusCount,
        pomodoro_count: pomodoroCount,
        focus_total: fmtDur(focusSec),
      },
      zhihu_top_topics: topZhihu,
    };
  }

  /* ───────── Prompt 构造 ───────── */

  function buildUserPrompt(metrics) {
    const header = `以下是用户最近 ${metrics.window.days} 天（${metrics.window.start_day} 至 ${metrics.window.end_day}）`
      + `在浏览器中的行为指标 JSON。所有时长统计基于本地实际焦点时间，"create" 代表存在键盘输入或光标停留的创作时段。`
      + `\n关键字段说明：`
      + `\n- \`creation\`：本窗口的创作总时长、占比、日均，以及创作的时段分布；`
      + `\n- \`top_domains[*].browse / create / create_share_pct\`：每个 Top 域名内部的浏览/创作拆分（同一站点既可能浏览也可能创作，**禁止只看总时长就判定为分心**）；`
      + `\n- \`top_creating_domains\`：仅按「创作秒数」排序的站点列表，含「该站创作占全部创作多少」；`
      + `\n- \`switching.per_day[*].create / create_share_pct\`：每天的创作时长与占比，可用于看趋势；`
      + `\n- \`extras\`：此刻的实时上下文（当前打开的标签页、任务管理统计、当前番茄/意图、实时信号灯）。`
      + `\n请严格基于以上字段进行分析，不要编造未出现的网站、分类或事件，也不要在结论里忽略「创作」维度。`;
    return header + '\n\n```json\n' + JSON.stringify(metrics, null, 2) + '\n```';
  }

  /* ───────── HTTP 调用 ───────── */

  async function callAI(config, messages, opts) {
    if (!config || !config.endpoint) throw new Error('未配置接口地址');
    if (!config.apiKey) throw new Error('未配置 API Key');
    if (!config.model) throw new Error('未配置模型名称');
    const body = {
      model: config.model,
      messages,
      temperature: (config.temperature != null && !Number.isNaN(Number(config.temperature)))
        ? Number(config.temperature) : 0.6,
      stream: false,
    };
    if (opts && opts.maxTokens) body.max_tokens = opts.maxTokens;

    const controller = new AbortController();
    const timeoutMs = (opts && opts.timeoutMs) || 60000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let resp;
    try {
      resp = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + config.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') throw new Error('请求超时（' + Math.round(timeoutMs / 1000) + 's）');
      throw new Error('网络错误：' + (e && e.message ? e.message : String(e)));
    }
    clearTimeout(timer);

    const text = await resp.text();
    if (!resp.ok) {
      const snippet = text ? text.slice(0, 240) : '';
      throw new Error('HTTP ' + resp.status + (snippet ? ' · ' + snippet : ''));
    }
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('响应不是合法 JSON：' + text.slice(0, 160)); }
    const content = data && data.choices && data.choices[0]
      && (data.choices[0].message && data.choices[0].message.content)
        || (data.choices && data.choices[0] && data.choices[0].text);
    if (!content) throw new Error('响应中未找到内容（choices[0].message.content）');
    return String(content).trim();
  }

  /* ───────── 顶层入口 ───────── */

  async function getConfig() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['aiConfig'], (res) => resolve((res && res.aiConfig) || {}));
      } catch (e) { resolve({}); }
    });
  }

  /**
   * 一站式：读取配置 → 聚合指标 → 调用 AI → 返回 Markdown 文本。
   * @param {object} [opts] { days, extras, signal }
   *   - extras: 可选；调用方注入的「此刻实时上下文」对象，会以 `extras` 字段
   *     合并进 metrics，作为附加分析维度（如打开的标签页、任务管理、当前番茄等）。
   */
  async function analyze(opts) {
    const cfg = await getConfig();
    if (!cfg.endpoint || !cfg.apiKey || !cfg.model) {
      throw new Error('请先在「设置 → AI 行为分析」中配置接口地址、API Key 与模型名称。');
    }
    const metrics = await buildMetrics((opts && opts.days) || 7);
    if (opts && opts.extras && typeof opts.extras === 'object') {
      metrics.extras = opts.extras;
    }
    const sys = (cfg.systemPrompt && cfg.systemPrompt.trim()) || DEFAULT_SYSTEM_PROMPT;
    const sysFinal = sys + '\n' + NO_QUESTION_RULES;
    const user = buildUserPrompt(metrics);
    const reply = await callAI(cfg, [
      { role: 'system', content: sysFinal },
      { role: 'user', content: user },
    ], { timeoutMs: 90000 });
    const cleaned = stripTrailingQuestions(reply);
    return { metrics, reply: cleaned };
  }

  global.BPAI = {
    DEFAULT_SYSTEM_PROMPT,
    NO_QUESTION_RULES,
    stripTrailingQuestions,
    buildMetrics,
    buildUserPrompt,
    callAI,
    analyze,
    getConfig,
  };
})(typeof self !== 'undefined' ? self : this);
