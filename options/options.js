/* global BPDB, BPCat, BPAI */
'use strict';

let categories = {};
let siteGroups = {};
let blockDomains = [];
let aiConfig = { endpoint: '', apiKey: '', model: '', temperature: 0.6, systemPrompt: '' };

const DEFAULT_BLOCK_DOMAINS = [
  { domain: 'bilibili.com', note: '视频 · 数码娱乐' },
  { domain: 'youtube.com', note: '视频' },
  { domain: 'douyin.com', note: '短视频' },
  { domain: 'weibo.com', note: '社交媒体' },
  { domain: 'zhihu.com', note: '内容社区 · 数码评测' },
  { domain: 'xiaohongshu.com', note: '内容社区' },
  { domain: 'twitter.com', note: '社交媒体' },
  { domain: 'x.com', note: '社交媒体' },
  { domain: 'reddit.com', note: '内容社区' },
  { domain: 'douban.com', note: '内容社区' },
];

function normalizeDomain(raw) {
  if (!raw) return '';
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return s;
}

function showStatus(msg, isErr) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.style.color = isErr ? 'var(--crim)' : 'var(--teal)';
  if (msg) setTimeout(() => { el.textContent = ''; }, 2600);
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderCategories() {
  const body = document.getElementById('catBody');
  body.innerHTML = Object.entries(categories).map(([name, def]) => {
    const kw = (def.keywords || []).join(', ');
    const color = def.color || '#9a9a92';
    const thr = def.alert_threshold_minutes || 0;
    const isDefault = name === '未分类';
    return `<tr data-cat="${esc(name)}">
      <td class="cat-name">${esc(name)}</td>
      <td><input type="text" class="kw" value="${esc(kw)}" ${isDefault ? 'placeholder="兜底分类，无需关键词" disabled' : ''} /></td>
      <td><input type="color" class="color" value="${toHex(color)}" /></td>
      <td><input type="number" class="num thr" min="0" value="${thr}" /></td>
      <td>${isDefault ? '' : '<button class="btn-x" data-del="' + esc(name) + '" title="删除"><svg class="ic ic-sm" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>'}</td>
    </tr>`;
  }).join('');
  body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    delete categories[b.dataset.del];
    collectFromForm();
    renderCategories();
  }));
}

function toHex(c) {
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  return '#9a9a92';
}

function collectFromForm() {
  document.querySelectorAll('#catBody tr').forEach((tr) => {
    const name = tr.dataset.cat;
    if (!categories[name]) return;
    const kwEl = tr.querySelector('.kw');
    if (kwEl && !kwEl.disabled) {
      categories[name].keywords = kwEl.value.split(',').map((s) => s.trim()).filter(Boolean);
    }
    categories[name].color = tr.querySelector('.color').value;
    categories[name].alert_threshold_minutes = parseInt(tr.querySelector('.thr').value, 10) || 0;
  });
}

function renderSiteGroups() {
  document.getElementById('siteGroupsArea').value = JSON.stringify(siteGroups, null, 2);
}

function renderBlockDomains() {
  const body = document.getElementById('blockDomainBody');
  if (!body) return;
  if (!blockDomains.length) {
    body.innerHTML = '<tr><td colspan="3" style="color:var(--ink-3);font-size:12px;padding:14px 6px">尚未添加。点击「使用推荐清单」可一键填入常见分心域名。</td></tr>';
    return;
  }
  body.innerHTML = blockDomains.map((item, idx) => `
    <tr data-idx="${idx}">
      <td class="cat-name">${esc(item.domain)}</td>
      <td><input type="text" class="bd-note" value="${esc(item.note || '')}" placeholder="备注（可选）" /></td>
      <td><button class="btn-x" data-del-bd="${idx}" title="删除"><svg class="ic ic-sm" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></td>
    </tr>`).join('');
  body.querySelectorAll('[data-del-bd]').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.delBd);
    collectBlockDomainNotes();
    const removed = blockDomains[i] ? blockDomains[i].domain : '';
    blockDomains.splice(i, 1);
    renderBlockDomains();
    persistBlockDomains(removed ? '已从清单移除：' + removed : '');
  }));
  body.querySelectorAll('.bd-note').forEach((inp) => inp.addEventListener('change', () => {
    collectBlockDomainNotes();
    persistBlockDomains('备注已保存');
  }));
}

function collectBlockDomainNotes() {
  document.querySelectorAll('#blockDomainBody tr[data-idx]').forEach((tr) => {
    const i = Number(tr.dataset.idx);
    const noteEl = tr.querySelector('.bd-note');
    if (blockDomains[i] && noteEl) blockDomains[i].note = noteEl.value.trim();
  });
}

function persistBlockDomains(successMsg) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ blockDomains }, () => {
      if (chrome.runtime && chrome.runtime.lastError) {
        showStatus('保存失败：' + chrome.runtime.lastError.message, true);
      } else if (successMsg) {
        showStatus(successMsg);
      }
      resolve();
    });
  });
}

function addBlockDomain() {
  const input = document.getElementById('newBlockDomain');
  const d = normalizeDomain(input.value);
  if (!d) return;
  if (blockDomains.some((x) => x.domain === d)) {
    showStatus('该域名已在清单中', true);
    return;
  }
  collectBlockDomainNotes();
  blockDomains.push({ domain: d, note: '' });
  input.value = '';
  renderBlockDomains();
  persistBlockDomains('已加入清单：' + d);
}

function fillDefaultBlockDomains() {
  collectBlockDomainNotes();
  const existing = new Set(blockDomains.map((x) => x.domain));
  let added = 0;
  DEFAULT_BLOCK_DOMAINS.forEach((it) => {
    if (!existing.has(it.domain)) { blockDomains.push({ ...it }); added++; }
  });
  renderBlockDomains();
  if (added) {
    persistBlockDomains(`已添加并保存 ${added} 个推荐域名`);
  } else {
    showStatus('推荐域名均已存在');
  }
}

function renderAIConfig() {
  const ep = document.getElementById('aiEndpoint');
  const key = document.getElementById('aiApiKey');
  const model = document.getElementById('aiModel');
  const temp = document.getElementById('aiTemperature');
  const sp = document.getElementById('aiSystemPrompt');
  if (ep) ep.value = aiConfig.endpoint || '';
  if (key) key.value = aiConfig.apiKey || '';
  if (model) model.value = aiConfig.model || '';
  if (temp) temp.value = (aiConfig.temperature != null && aiConfig.temperature !== '') ? aiConfig.temperature : 0.6;
  if (sp) sp.value = aiConfig.systemPrompt || '';
}

function collectAIConfig() {
  const ep = document.getElementById('aiEndpoint');
  const key = document.getElementById('aiApiKey');
  const model = document.getElementById('aiModel');
  const temp = document.getElementById('aiTemperature');
  const sp = document.getElementById('aiSystemPrompt');
  aiConfig = {
    endpoint: ep ? ep.value.trim() : '',
    apiKey: key ? key.value.trim() : '',
    model: model ? model.value.trim() : '',
    temperature: temp && temp.value !== '' ? Math.max(0, Math.min(2, parseFloat(temp.value))) : 0.6,
    systemPrompt: sp ? sp.value : '',
  };
}

function setAIStatus(msg, isErr) {
  const el = document.getElementById('aiStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isErr ? 'var(--crim)' : 'var(--teal)';
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4200);
}

async function testAI() {
  collectAIConfig();
  if (!aiConfig.endpoint || !aiConfig.apiKey || !aiConfig.model) {
    setAIStatus('请先填写接口地址 / API Key / 模型名称', true);
    return;
  }
  setAIStatus('测试中…');
  try {
    const reply = await BPAI.callAI(aiConfig, [
      { role: 'system', content: '你是一个回答测试用例的助手，只用一句中文回答。' },
      { role: 'user', content: '请用一句话确认连通：如可读到此消息请回复「连接成功」。' },
    ], { maxTokens: 40 });
    const text = (reply || '').slice(0, 60);
    setAIStatus('连通成功：' + (text || 'OK'));
  } catch (e) {
    setAIStatus('连通失败：' + (e && e.message ? e.message : String(e)), true);
  }
}

function load() {
  BPCat.getRules().then((rules) => {
    categories = JSON.parse(JSON.stringify(rules.categories));
    siteGroups = JSON.parse(JSON.stringify(rules.siteGroups));
    renderCategories();
    renderSiteGroups();
  });
  chrome.storage.local.get(['blockDomains', 'aiConfig'], (res) => {
    const list = Array.isArray(res && res.blockDomains) ? res.blockDomains : [];
    blockDomains = list
      .map((it) => (typeof it === 'string' ? { domain: normalizeDomain(it), note: '' } : { domain: normalizeDomain(it && it.domain), note: (it && it.note) || '' }))
      .filter((it) => it.domain);
    renderBlockDomains();
    const ai = (res && res.aiConfig) || {};
    aiConfig = {
      endpoint: ai.endpoint || '',
      apiKey: ai.apiKey || '',
      model: ai.model || '',
      temperature: (ai.temperature != null) ? ai.temperature : 0.6,
      systemPrompt: ai.systemPrompt || '',
    };
    renderAIConfig();
  });
}

function save() {
  collectFromForm();
  collectBlockDomainNotes();
  collectAIConfig();
  let sg;
  try {
    sg = JSON.parse(document.getElementById('siteGroupsArea').value);
  } catch (e) {
    showStatus('域名分组 JSON 格式有误：' + e.message, true);
    return;
  }
  siteGroups = sg;
  // 确保「未分类」存在
  if (!categories['未分类']) categories['未分类'] = { keywords: [], color: '#9a9a92', alert_threshold_minutes: 0 };
  chrome.storage.local.set({ categories, siteGroups, blockDomains, aiConfig }, () => {
    showStatus('已保存');
  });
}

function resetDefaults() {
  if (!confirm('确定恢复为默认分类与域名分组？当前自定义规则将被覆盖。')) return;
  BPCat.getDefaultRules().then((defaults) => {
    categories = defaults.categories;
    siteGroups = defaults.siteGroups;
    renderCategories();
    renderSiteGroups();
    chrome.storage.local.set({ categories, siteGroups }, () => showStatus('已恢复默认'));
  });
}

function addCategory() {
  const input = document.getElementById('newCatName');
  const name = input.value.trim();
  if (!name) return;
  if (categories[name]) { showStatus('分类已存在', true); return; }
  collectFromForm();
  // 插入到「未分类」之前
  const palette = ['#E24B4A', '#639922', '#7F77DD', '#EF9F27', '#378ADD', '#534AB7'];
  const newCats = {};
  for (const [k, v] of Object.entries(categories)) {
    if (k === '未分类') newCats[name] = { keywords: [], color: palette[Object.keys(categories).length % palette.length], alert_threshold_minutes: 0 };
    newCats[k] = v;
  }
  if (!newCats[name]) newCats[name] = { keywords: [], color: palette[0], alert_threshold_minutes: 0 };
  categories = newCats;
  input.value = '';
  renderCategories();
}

async function exportData() {
  try {
    const records = await BPDB.getAllRecords();
    const payload = { exported_at: new Date().toISOString(), categories, siteGroups, records };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'brain-protector-' + BPDB.todayKey() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showStatus('已导出 ' + records.length + ' 条记录');
  } catch (e) {
    showStatus('导出失败：' + e.message, true);
  }
}

async function clearData() {
  if (!confirm('确定永久清空全部时间记录与专注会话？此操作不可恢复。')) return;
  try {
    await BPDB.clearAll();
    showStatus('已清空全部数据');
  } catch (e) {
    showStatus('清空失败：' + e.message, true);
  }
}

document.getElementById('backBtn').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else window.close();
});
document.getElementById('saveBtn').addEventListener('click', save);
document.getElementById('resetBtn').addEventListener('click', resetDefaults);
document.getElementById('addCatBtn').addEventListener('click', addCategory);
document.getElementById('exportBtn').addEventListener('click', exportData);
document.getElementById('clearBtn').addEventListener('click', clearData);
const addBdBtn = document.getElementById('addBlockDomainBtn');
if (addBdBtn) addBdBtn.addEventListener('click', addBlockDomain);
const useDefBdBtn = document.getElementById('useDefaultBlockBtn');
if (useDefBdBtn) useDefBdBtn.addEventListener('click', fillDefaultBlockDomains);
const newBdInput = document.getElementById('newBlockDomain');
if (newBdInput) newBdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBlockDomain(); } });
const aiTestBtn = document.getElementById('aiTestBtn');
if (aiTestBtn) aiTestBtn.addEventListener('click', testAI);
const aiApiKeyReveal = document.getElementById('aiApiKeyReveal');
if (aiApiKeyReveal) aiApiKeyReveal.addEventListener('click', () => {
  const input = document.getElementById('aiApiKey');
  const icon = document.getElementById('aiApiKeyRevealIcon');
  if (!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  aiApiKeyReveal.setAttribute('aria-pressed', String(!showing));
  if (icon) {
    icon.innerHTML = showing
      ? '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>'
      : '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.77 19.77 0 0 1 4.22-5.06"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a19.8 19.8 0 0 1-3.16 4.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
  }
});
document.addEventListener('DOMContentLoaded', load);

function focusHashTarget() {
  const hash = (location.hash || '').replace(/^#/, '');
  if (!hash) return;
  const el = document.getElementById(hash);
  if (!el) return;
  try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  catch (e) { el.scrollIntoView(); }
  if (el.classList.contains('panel')) {
    el.classList.remove('panel-focus');
    void el.offsetWidth;
    el.classList.add('panel-focus');
    setTimeout(() => el.classList.remove('panel-focus'), 1800);
  }
}
window.addEventListener('load', () => setTimeout(focusHashTarget, 60));
window.addEventListener('hashchange', focusHashTarget);
