/* global BPDB, BPCat */
'use strict';

let categories = {};
let siteGroups = {};

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

function load() {
  BPCat.getRules().then((rules) => {
    categories = JSON.parse(JSON.stringify(rules.categories));
    siteGroups = JSON.parse(JSON.stringify(rules.siteGroups));
    renderCategories();
    renderSiteGroups();
  });
}

function save() {
  collectFromForm();
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
  chrome.storage.local.set({ categories, siteGroups }, () => {
    showStatus('已保存');
  });
}

function resetDefaults() {
  if (!confirm('确定恢复为默认分类与域名分组？当前自定义规则将被覆盖。')) return;
  categories = JSON.parse(JSON.stringify(BPCat.DEFAULT_CATEGORIES));
  siteGroups = JSON.parse(JSON.stringify(BPCat.DEFAULT_SITE_GROUPS));
  renderCategories();
  renderSiteGroups();
  chrome.storage.local.set({ categories, siteGroups }, () => showStatus('已恢复默认'));
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
document.addEventListener('DOMContentLoaded', load);
