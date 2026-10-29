'use strict';
const $ = id => document.getElementById(id);
const schemas = window.TABLE_SCHEMAS;
const visibleFields = schema => schema.fields.filter(field => !field.hidden);
const admin = document.documentElement.dataset.admin === 'true';
const endpoint = admin ? '/api/admin' : '/api/data';
const choiceState = { loading: false, error: '' };
const filterOptions = {};
const states = Object.fromEntries(Object.keys(schemas).map(key => [key, { rows: [], total: 0, page: 1, pageSize: 20, totalPages: 1, filters: {}, loaded: false, error: '', loading: false, version: 0 }]));
let entity = 'suppliers', view = 'list', editId = null, busy = false, deleteId = null, activeFormRoute = '', routeVersion = 0, pendingNotice = '';

function feedback(text = '', error = false) {
  $('feedback').textContent = text; $('feedback').className = 'feedback' + (error ? ' error' : ''); $('feedback').hidden = !text;
}
function setTheme(value) {
  document.documentElement.dataset.theme = value;
  const next = value === 'dark' ? '日间' : '夜间';
  $('theme').textContent = (value === 'dark' ? '☀ ' : '☾ ') + next;
  $('theme').setAttribute('aria-label', '切换为' + next + '主题');
  try { localStorage.setItem('information-theme', value); } catch {}
}
let initialTheme = 'dark';
try { if (localStorage.getItem('information-theme') === 'light') initialTheme = 'light'; } catch {}
setTheme(initialTheme);
$('theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('brandName').textContent = admin ? '信息管理' : '信息空间';
$('mode').textContent = admin ? '管理工作台' : '信息查询与收集';

async function api(target, action, extra = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 35000);
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, entity: target, ...extra }), signal: controller.signal });
    let result;
    try { result = await response.json(); } catch { throw new Error('接口返回异常，请稍后再试或联系管理员。'); }
    if (!response.ok || !result.ok) throw new Error(result.message || '操作失败，请稍后再试。');
    return result;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error(action === 'list' ? '网络异常或请求超时，请重新查询。' : '网络异常或请求超时，操作可能已生效。请先返回列表查询确认，避免重复提交。');
    throw error;
  } finally { clearTimeout(timer); }
}
function navigate(target, nextView = 'list', id = null) {
  if (busy) return;
  location.hash = target + '/' + nextView + (id !== null ? '/' + encodeURIComponent(id) : '');
}
function buildFilters() {
  $('filterFields').replaceChildren();
  for (const field of visibleFields(schemas[entity]).filter(f => f.filter)) {
    const group = document.createElement('div'), label = document.createElement('label'), input = document.createElement(field.optionsSource ? 'select' : 'input');
    label.htmlFor = 'filter-' + field.key; label.textContent = field.label;
    Object.assign(input, { id: label.htmlFor, name: field.key });
    if (field.optionsSource) {
      const values = filterOptions[entity]?.[field.key] || [];
      fillChoice(input, field, values, states[entity].filters[field.key] || '', true);
    } else Object.assign(input, { type: 'text', maxLength: 200, placeholder: '输入' + field.label + '搜索', value: states[entity].filters[field.key] || '' });
    group.append(label, input); $('filterFields').append(group);
  }
}
function buildForm(row) {
  $('formFields').replaceChildren();
  for (const field of visibleFields(schemas[entity])) {
    const group = document.createElement('div'), label = document.createElement('label'), input = document.createElement(field.optionsSource ? 'select' : field.textarea ? 'textarea' : 'input');
    if (field.wide) group.className = 'wide';
    label.htmlFor = 'input-' + field.key; label.textContent = field.label;
    if (field.required) { const star = document.createElement('span'); star.className = 'required'; star.textContent = '*'; label.append(star); }
    Object.assign(input, { id: label.htmlFor, name: field.key, required: field.required, maxLength: field.max, placeholder: field.placeholder || '' });
    if (!field.textarea && !field.optionsSource) input.type = field.type || 'text';
    if (field.optionsSource) {
      const option = document.createElement('option'); option.value = ''; option.textContent = '正在加载选项…'; input.append(option); input.disabled = true; input.dataset.currentValue = String(row?.[field.key] ?? '');
    }
    if (field.type === 'number') { input.min = '0'; input.step = '0.01'; input.max = '999999999999.99'; }
    input.value = row?.[field.key] ?? '';
    group.append(label, input);
    if (field.hint) { const hint = document.createElement('div'); hint.className = 'field-hint'; hint.textContent = field.hint; group.append(hint); }
    $('formFields').append(group);
  }
  $('formError').hidden = true;
}
function cell(text, className) { const td = document.createElement('td'); td.textContent = text; if (className) td.className = className; return td; }
function renderRows() {
  const schema = schemas[entity], state = states[entity];
  $('head').replaceChildren(); $('rows').replaceChildren();
  for (const text of ['序号', ...visibleFields(schema).map(f => f.label), ...(admin ? ['操作'] : [])]) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = text; $('head').append(th); }
  for (const [index, row] of state.rows.entries()) {
    const tr = document.createElement('tr'); tr.append(cell(String((state.page - 1) * state.pageSize + index + 1).padStart(2, '0')));
    for (const [i, field] of visibleFields(schema).entries()) {
      const value = row[field.key];
      const td = cell(value === '' || value == null ? '—' : String(value), field.key === 'remark' ? 'remark' : field.type === 'number' ? 'money' : '');
      if (i === 0) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = value || '—'; td.replaceChildren(tag); }
      if (field.type === 'number' && value !== '' && value != null && Number.isFinite(Number(value))) td.textContent = Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      tr.append(td);
    }
    if (admin) {
      const td = cell('');
      for (const [text, action] of [['编辑', 'edit'], ['删除', 'delete']]) {
        const button = document.createElement('button'); button.className = 'row-action' + (action === 'delete' ? ' danger' : ''); button.textContent = text;
        button.setAttribute('aria-label', text + row.name); button.disabled = busy || state.loading || !row.id;
        button.onclick = () => action === 'edit' ? navigate(entity, 'edit', row.id) : openDelete(row);
        td.append(button);
      }
      tr.append(td);
    }
    $('rows').append(tr);
  }
  $('rows').classList.toggle('loading', state.loading);
  $('empty').hidden = state.rows.length > 0;
  if (state.loading && !state.rows.length) $('empty').textContent = '正在加载数据…';
  else if (state.error) $('empty').textContent = '查询未成功。请查看上方错误提示，修正后点击“查询”重试。';
  else if (!state.loaded) $('empty').textContent = '尚未加载数据。';
  else $('empty').textContent = Object.keys(state.filters).length ? '没有找到匹配的数据，调整筛选条件或重置后再试。' : '暂无数据，点击右上角按钮添加第一条信息。';
  $('total').textContent = state.loaded ? state.total : '—';
  $('resultCount').textContent = state.loading ? '正在查询…' : state.error ? '查询失败' : state.loaded ? (Object.keys(state.filters).length ? '筛选后 ' : '共 ') + state.total + ' 条记录' : '尚未加载';
  $('resultCount').className = Object.keys(state.filters).length ? 'active-filter' : '';
  $('tableCount').textContent = state.error ? '上次结果可能已过期，请重新查询' : state.loaded ? `共 ${state.total} 条，当前显示 ${state.total ? (state.page - 1) * state.pageSize + 1 : 0}–${Math.min((state.page - 1) * state.pageSize + state.rows.length, state.total)} 条` : '等待查询';
  $('tableNote').textContent = admin ? '编辑和删除将影响所有使用者' : '仅展示查询结果，不影响已保存的数据';
  $('pageInfo').textContent = `第 ${state.page} / ${state.totalPages} 页`;
  $('pageSize').value = String(state.pageSize);
  controls();
}
function controls() {
  const loading = states[entity].loading;
  for (const id of ['searchButton', 'reset']) $(id).disabled = busy || loading || (view === 'list' && (choiceState.loading || Boolean(choiceState.error)));
  $('searchButton').textContent = loading ? '查询中…' : '查询';
  for (const id of ['submit', 'cancel', 'crumbBack', 'deleteCancel', 'deleteConfirm']) $(id).disabled = busy;
  $('submit').disabled = busy || choiceState.loading || Boolean(choiceState.error) || (view === 'edit' && !activeFormRoute);
  $('addButton').disabled = busy;
  const state = states[entity], pagingDisabled = busy || loading || !state.loaded || Boolean(state.error);
  $('firstPage').disabled = $('prevPage').disabled = pagingDisabled || state.page <= 1;
  $('lastPage').disabled = $('nextPage').disabled = pagingDisabled || state.page >= state.totalPages;
  $('pageSize').disabled = busy || loading;
  $('pageJump').disabled = pagingDisabled; $('pageJump').max = String(state.totalPages);
  $('jumpButton').disabled = pagingDisabled;
  document.querySelectorAll('[data-tab]').forEach(b => b.disabled = busy);
}
async function loadRows(target, filters = states[target].filters, page = states[target].page, pageSize = states[target].pageSize) {
  const state = states[target], version = ++state.version;
  state.loading = true; state.error = ''; state.filters = { ...filters };
  if (entity === target) renderRows();
  try {
    const result = await api(target, 'list', { filters, page, pageSize });
    if (!Array.isArray(result.rows) || !Number.isInteger(result.total) || !Number.isInteger(result.page) || !Number.isInteger(result.totalPages) || ![20, 50, 100].includes(result.pageSize)) throw new Error('列表数据格式异常，请联系管理员。');
    if (version !== state.version) return false;
    state.rows = result.rows; state.total = result.total; state.page = result.page; state.pageSize = result.pageSize; state.totalPages = result.totalPages; state.loaded = true;
    return true;
  } catch (error) {
    if (version !== state.version) return false;
    state.error = error.message;
    if (entity === target && view === 'list') feedback(error.message, true);
    return false;
  } finally {
    if (version === state.version) { state.loading = false; if (entity === target) renderRows(); }
  }
}
async function route() {
  const version = ++routeVersion;
  const parts = location.hash.slice(1).split('/');
  entity = Object.hasOwn(schemas, parts[0]) ? parts[0] : 'suppliers';
  view = ['add', 'edit'].includes(parts[1]) ? parts[1] : 'list';
  editId = admin && view === 'edit' ? parts[2] || '' : null;
  if (view === 'edit' && !admin) view = 'list';
  const schema = schemas[entity], form = view !== 'list', editing = view === 'edit';
  feedback(); window.scrollTo(0, 0); activeFormRoute = ''; choiceState.loading = false; choiceState.error = '';
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === entity));
  $('listPage').hidden = form; $('formPage').hidden = !form; $('crumb').hidden = !form; $('counter').hidden = form;
  $('title').textContent = form ? editing ? '编辑' + schema.short + '信息' : schema.add : schema.title;
  $('lead').textContent = form ? editing ? '更新记录内容，保存后将同步至列表。' : '完善' + schema.short + '信息，提交后可继续添加或返回列表。' : schema.description;
  $('crumbText').textContent = editing ? '编辑信息' : schema.add;
  $('listTitle').textContent = schema.short + '信息列表'; $('addButton').textContent = '＋ ' + schema.add;
  $('formTitle').textContent = $('title').textContent; $('formIcon').textContent = editing ? '✎' : '＋';
  $('submit').textContent = editing ? '保存修改' : '提交信息 ↗';
  $('formTips').textContent = entity === 'suppliers' ? '系统、设备名称、品牌（供货厂家）、联系人和联系电话必填。' : '设备分类、设备名称必填，其余字段可按实际情况填写。';
  buildFilters(); renderRows(); document.title = (admin ? '管理 · ' : '') + $('title').textContent + ' · 信息空间';
  if (view === 'add') { buildForm(); activeFormRoute = location.hash; }
  else if (editing) {
    const target = entity, id = editId;
    $('formFields').replaceChildren(); $('formError').textContent = '正在加载记录…'; $('formError').hidden = false;
    let row = states[target].rows.find(row => row.id === id);
    if (!row) {
      try { row = (await api(target, 'detail', { id })).row; }
      catch (error) { if (version === routeVersion) { $('formError').textContent = error.message; controls(); } return; }
    }
    if (version !== routeVersion) return;
    if (!row) { $('formError').textContent = '记录不存在或已被删除，请返回列表重新查询。'; controls(); return; }
    buildForm(row); activeFormRoute = location.hash;
  } else await Promise.all([loadRows(entity), loadChoices(entity, version)]);
  if (version === routeVersion && form && activeFormRoute) await loadChoices(entity, version);
  if (version === routeVersion) { controls(); if (pendingNotice) { const message = pendingNotice; pendingNotice = ''; if (!states[entity].error) feedback(message); else feedback(message + ' 但列表刷新失败：' + states[entity].error, true); } }
}
$('filterForm').onsubmit = event => {
  event.preventDefault(); if (busy || states[entity].loading || choiceState.loading || choiceState.error) return;
  const filters = {};
  for (const field of visibleFields(schemas[entity]).filter(f => f.filter)) { const value = $('filter-' + field.key).value.trim(); if (value) filters[field.key] = value; }
  feedback(); loadRows(entity, filters, 1);
};
$('reset').onclick = () => { if (busy || states[entity].loading || choiceState.loading || choiceState.error) return; states[entity].filters = {}; buildFilters(); feedback(); loadRows(entity, {}, 1); };
function turnPage(page) {
  if (busy || states[entity].loading || page < 1 || page > states[entity].totalPages) return;
  feedback(); loadRows(entity, states[entity].filters, page);
}
$('firstPage').onclick = () => turnPage(1);
$('prevPage').onclick = () => turnPage(states[entity].page - 1);
$('nextPage').onclick = () => turnPage(states[entity].page + 1);
$('lastPage').onclick = () => turnPage(states[entity].totalPages);
$('pageSize').onchange = event => { feedback(); loadRows(entity, states[entity].filters, 1, Number(event.target.value)); };
$('jumpForm').onsubmit = event => { event.preventDefault(); const value = Number($('pageJump').value); if (Number.isInteger(value)) turnPage(value); };
$('addButton').onclick = () => navigate(entity, 'add');
$('crumbBack').onclick = $('cancel').onclick = () => navigate(entity);
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => navigate(b.dataset.tab));
function fillChoice(select, field, values, currentValue, filtering) {
  select.replaceChildren();
  const placeholder = document.createElement('option'); placeholder.value = '';
  placeholder.textContent = filtering ? '全部' + field.label : values.length ? '请选择' + field.label : '暂无可选项，请联系管理员维护';
  select.append(placeholder);
  if (currentValue && !values.includes(currentValue)) {
    const historic = document.createElement('option'); historic.value = currentValue; historic.textContent = currentValue + '（历史值）'; select.append(historic);
  }
  for (const value of values) { const option = document.createElement('option'); option.value = value; option.textContent = value; select.append(option); }
  select.value = currentValue; select.disabled = false; delete select.dataset.currentValue;
}
async function loadChoices(target, version) {
  const optionFields = schemas[target].fields.filter(field => field.optionsSource && !field.hidden);
  if (!optionFields.length) return;
  choiceState.loading = true; choiceState.error = ''; controls();
  try {
    const result = await api(target, 'options');
    if (version !== routeVersion) return;
    for (const field of optionFields) {
      const values = result.options?.[field.key];
      if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new Error('下拉选项格式异常，请稍后重试。');
      const filtering = view === 'list';
      const select = $((filtering ? 'filter-' : 'input-') + field.key);
      const currentValue = select.dataset.currentValue || select.value;
      fillChoice(select, field, values, currentValue, filtering);
    }
    filterOptions[target] = result.options;
    $('formError').hidden = true;
    if (view === 'list' && !states[target].error) feedback();
  } catch (error) {
    if (version !== routeVersion) return;
    choiceState.error = error.message;
    const errorHost = view === 'list' ? $('feedback') : $('formError');
    errorHost.className = view === 'list' ? 'feedback error' : 'error';
    errorHost.replaceChildren(document.createTextNode('下拉选项加载失败：' + error.message + ' '));
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'retry'; retry.textContent = '重新加载选项'; retry.onclick = () => loadChoices(target, version); errorHost.append(retry); errorHost.hidden = false;
  } finally { if (version === routeVersion) { choiceState.loading = false; controls(); } }
}
function readForm() {
  return Object.fromEntries(visibleFields(schemas[entity]).map(field => {
    const value = $('input-' + field.key).value.trim();
    if (field.required && !value) throw new Error('请填写' + field.label);
    if (field.type === 'number' && value && (!/^\d+(?:\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) > 999999999999.99)) throw new Error('购置单价请输入非负金额，最多两位小数，且小于 1 万亿元。');
    return [field.key, value];
  }));
}
$('entryForm').onsubmit = async event => {
  event.preventDefault(); if (busy || !activeFormRoute || choiceState.loading || choiceState.error) return;
  let data; try { data = readForm(); } catch (error) { $('formError').textContent = error.message; $('formError').hidden = false; return; }
  const target = entity, editing = view === 'edit', id = editId, originRoute = location.hash;
  busy = true; controls(); $('submit').textContent = '正在提交…'; $('formError').hidden = true;
  try {
    await api(target, editing ? 'update' : 'add', { data, ...(editing ? { id } : {}) });
    states[target].loaded = false;
    if (location.hash !== originRoute) { feedback('操作成功，请查询列表查看结果。'); return; }
    if (editing) { busy = false; pendingNotice = '修改已保存。'; navigate(target); }
    else { $('successText').textContent = schemas[target].short + '信息已保存，你可以返回列表查看，或继续添加下一条。'; $('successDialog').showModal(); }
  } catch (error) {
    if (location.hash === originRoute) { $('formError').textContent = error.message; $('formError').hidden = false; }
    else feedback(error.message, true);
  } finally { busy = false; controls(); $('submit').textContent = editing ? '保存修改' : '提交信息 ↗'; }
};
$('returnList').onclick = () => { $('successDialog').close(); states[entity].filters = {}; states[entity].page = 1; navigate(entity); };
$('continueAdd').onclick = () => { $('successDialog').close(); $('entryForm').reset(); $('formFields').querySelectorAll('select').forEach(select => select.value = ''); $('formError').hidden = true; $('formFields').querySelector('select,input')?.focus(); };
$('successDialog').addEventListener('cancel', event => event.preventDefault());
function openDelete(row) { if (busy || !admin) return; deleteId = row.id; $('deleteName').textContent = row.name; $('deleteError').hidden = true; $('deleteDialog').showModal(); }
$('deleteCancel').onclick = () => { if (!busy) $('deleteDialog').close(); };
$('deleteDialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('deleteConfirm').onclick = async () => {
  if (busy || !admin || !deleteId) return;
  const target = entity, id = deleteId;
  busy = true; controls(); $('deleteError').hidden = true; renderRows();
  try {
    await api(target, 'delete', { id }); $('deleteDialog').close(); states[target].loaded = false;
    const refreshed = await loadRows(target);
    if (entity === target) feedback(refreshed ? '记录已删除。' : '记录已删除，但列表刷新失败：' + states[target].error, !refreshed);
  } catch (error) { $('deleteError').textContent = error.message; $('deleteError').hidden = false; }
  finally { busy = false; controls(); renderRows(); }
};
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
route();
