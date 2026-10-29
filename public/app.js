'use strict';
const $ = id => document.getElementById(id);
const fields = window.FIELD_SCHEMA;
const isAdmin = /^\/admin(?:\.html)?\/?$/.test(location.pathname);
const apiUrl = isAdmin ? '/api/admin' : '/api/data';
let records = [], loaded = false, loading = false, saving = false, editing = null, deleting = null;
let current = isAdmin ? 'admin' : 'submit';

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const next = theme === 'dark' ? '日间' : '夜间';
  $('themeToggle').textContent = (theme === 'dark' ? '☀ ' : '☾ ') + next;
  $('themeToggle').setAttribute('aria-label', '切换为' + next + '主题');
  try { localStorage.setItem('information-theme', theme); } catch {}
}
let initialTheme = 'dark';
try { if (localStorage.getItem('information-theme') === 'light') initialTheme = 'light'; } catch {}
setTheme(initialTheme);
$('themeToggle').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

function feedback(text = '', error = false) {
  $('feedback').textContent = text;
  $('feedback').className = 'feedback' + (error ? ' error' : '');
  $('feedback').hidden = !text;
}
function createInput(field, prefix) {
  const group = document.createElement('div'), label = document.createElement('label'), input = document.createElement('input');
  label.htmlFor = prefix + field.key;
  label.textContent = field.label + (field.required ? ' *' : '');
  Object.assign(input, { id: prefix + field.key, name: field.key, type: field.type, required: field.required, maxLength: field.max, autocomplete: field.autocomplete || 'off', placeholder: field.placeholder || '' });
  group.append(label, input);
  if (prefix === 'field-' && field.hint) { const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = field.hint; group.append(hint); }
  return group;
}
for (const field of fields) {
  $('fields').append(createInput(field, 'field-'));
  $('editFields').append(createInput(field, 'edit-'));
}
for (const label of ['序号', ...fields.map(f => f.label), '状态', ...(isAdmin ? ['操作'] : [])]) {
  const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; $('tableHead').append(th);
}
function readForm(prefix) {
  const data = Object.fromEntries(fields.map(f => [f.key, $(prefix + f.key).value.trim()]));
  for (const f of fields) if (f.required && !data[f.key]) throw new Error('请填写' + f.label + '。');
  return data;
}
async function api(action, extra = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }), signal: controller.signal });
    let result;
    try { result = await response.json(); } catch { throw new Error('接口响应异常，请稍后再试或联系管理员。'); }
    if (!response.ok || !result.ok) throw new Error(result.message || '操作失败，请稍后再试。');
    return result;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error(action === 'list' ? '网络异常或请求超时，请刷新重试。' : '网络异常或请求超时，操作可能已生效。请先刷新确认结果，避免重复操作。');
    throw error;
  } finally { clearTimeout(timer); }
}
function td(text) { const element = document.createElement('td'); element.textContent = text; return element; }
function render() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const filtered = records.filter(row => fields.some(f => String(row[f.key] ?? '').toLocaleLowerCase().includes(query)));
  $('rows').replaceChildren();
  $('count').textContent = loaded ? records.length : '—';
  $('statCount').textContent = loaded ? records.length : '—';
  $('statVisible').textContent = loaded ? filtered.length : '—';
  $('footCount').textContent = loaded ? `当前显示 ${filtered.length} 条 / 全部 ${records.length} 条` : '尚未加载数据';
  $('empty').hidden = filtered.length > 0;
  $('empty').textContent = loading ? '正在加载信息…' : !loaded ? '暂未获取到数据，请点击刷新重试。' : records.length ? '没有找到匹配的信息，试试其他关键词。' : '还没有登记信息，添加第一条吧。';
  for (const [index, row] of filtered.entries()) {
    const tr = document.createElement('tr'); tr.append(td(String(index + 1).padStart(2, '0')));
    for (const [i, field] of fields.entries()) {
      const value = String(row[field.key] ?? ''), cell = td(value || '—');
      if (i === 0) {
        const person = document.createElement('div'), avatar = document.createElement('span'), label = document.createElement('span');
        person.className = 'person'; avatar.className = 'avatar'; avatar.textContent = Array.from(value).slice(0, 1).join('') || '·'; avatar.setAttribute('aria-hidden', 'true'); label.textContent = value || '—';
        person.append(avatar, label); cell.replaceChildren(person);
      }
      tr.append(cell);
    }
    const status = td(''), pill = document.createElement('span'); pill.className = 'pill'; pill.textContent = '已登记'; status.append(pill); tr.append(status);
    if (isAdmin) {
      const actions = td('');
      for (const [label, action] of [['编辑', 'edit'], ['删除', 'delete']]) {
        const button = document.createElement('button'); button.className = 'row-action' + (action === 'delete' ? ' danger' : ''); button.textContent = label;
        button.setAttribute('aria-label', label + String(row[fields[0].key] ?? '记录'));
        button.disabled = saving || loading || !row.id;
        button.onclick = () => action === 'edit' ? openEdit(row) : openDelete(row); actions.append(button);
      }
      tr.append(actions);
    }
    $('rows').append(tr);
  }
}
function controls() {
  $('submitButton').disabled = saving;
  $('refresh').disabled = saving || loading;
  $('refresh').textContent = loading ? '加载中…' : '↻ 刷新';
  $('add').disabled = saving || loading;
  $('editSave').disabled = saving;
  $('confirmDelete').disabled = saving;
  document.querySelectorAll('[data-close]').forEach(button => button.disabled = saving);
}
async function refresh() {
  if (loading) return;
  loading = true; controls(); render();
  try {
    const result = await api('list');
    if (!Array.isArray(result.rows)) throw new Error('列表返回格式异常，请联系管理员。');
    records = result.rows; loaded = true; $('serviceState').textContent = '服务已连接';
  } catch (error) { $('serviceState').textContent = '连接异常'; throw error; }
  finally { loading = false; controls(); render(); }
}
function page() {
  current = isAdmin ? 'admin' : location.hash === '#list' ? 'list' : 'submit';
  const submit = current === 'submit';
  $('submitPage').hidden = !submit; $('dataPage').hidden = submit;
  $('adminBanner').hidden = !isAdmin; $('stats').hidden = !isAdmin; $('add').hidden = !isAdmin;
  document.querySelector('nav').hidden = isAdmin;
  const brand = document.querySelector('.brand');
  if (isAdmin) { brand.removeAttribute('href'); brand.style.cursor = 'default'; }
  document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === current));
  $('eyebrow').textContent = 'INFORMATION / ' + (submit ? 'COLLECT' : isAdmin ? 'ADMIN' : 'EXPLORE');
  $('title').textContent = submit ? '让每一条信息，有序抵达。' : isAdmin ? '信息管理，尽在掌握。' : '所有信息，一目了然。';
  $('lead').textContent = submit ? '轻松登记，随时查阅。让信息收集与管理更简单。' : isAdmin ? '在这里维护全部登记信息，新增、编辑与删除都更从容。' : '每一次登记都在这里汇聚，输入关键词，快速找到你需要的信息。';
  $('badge').textContent = submit ? '✦ 简单填写 · 即刻提交' : isAdmin ? '◇ 管理工作台' : '✦ 实时汇聚 · 轻松查找';
  $('tableNote').textContent = isAdmin ? '请谨慎操作，修改将影响所有访问者' : '普通页面仅支持查看和新增';
  document.title = isAdmin ? '信息管理 · 信息空间' : '信息登记与查询 · 信息空间';
  render();
  if (!submit && !loaded && !loading) refresh().catch(error => feedback(error.message, true));
}
document.querySelectorAll('[data-page]').forEach(b => b.onclick = () => { if (!isAdmin) location.hash = b.dataset.page; });
window.addEventListener('hashchange', page);
$('search').oninput = render;
$('refresh').onclick = () => { feedback(); refresh().then(() => feedback('列表已更新。')).catch(error => feedback(error.message, true)); };

$('submitForm').onsubmit = async event => {
  event.preventDefault(); if (saving) return;
  let data; try { data = readForm('field-'); } catch (error) { feedback(error.message, true); return; }
  saving = true; controls(); $('submitButton').textContent = '正在提交…'; feedback();
  try { await api('add', { data }); $('serviceState').textContent = '服务已连接'; $('submitForm').reset(); loaded = false; feedback('提交成功！你的信息已登记，可在数据列表中查看。'); }
  catch (error) { feedback(error.message, true); }
  finally { saving = false; $('submitButton').textContent = '提交信息 ↗'; controls(); }
};
function openEdit(row) {
  if (!isAdmin || saving) return;
  editing = row?.id ?? null; $('dialogTitle').textContent = row ? '编辑信息' : '新增信息';
  for (const f of fields) $('edit-' + f.key).value = row?.[f.key] ?? '';
  $('editError').hidden = true; $('editDialog').showModal();
}
$('add').onclick = () => openEdit();
function openDelete(row) {
  if (!isAdmin || saving) return;
  deleting = row.id; $('deleteName').textContent = row[fields[0].key] || '该记录'; $('deleteError').hidden = true; $('deleteDialog').showModal();
}
async function mutate(action, extra, dialogId, errorId, success) {
  saving = true; controls(); render(); $(errorId).hidden = true; feedback();
  try {
    await api(action, extra); $(dialogId).close(); feedback(success);
    try { await refresh(); } catch (error) { feedback(success + ' 但列表刷新失败：' + error.message, true); }
  } catch (error) { $(errorId).textContent = error.message; $(errorId).hidden = false; }
  finally { saving = false; controls(); render(); }
}
$('editForm').onsubmit = async event => {
  event.preventDefault(); if (!isAdmin || saving) return;
  let data; try { data = readForm('edit-'); } catch (error) { $('editError').textContent = error.message; $('editError').hidden = false; return; }
  await mutate(editing === null ? 'add' : 'update', { data, ...(editing === null ? {} : { id: editing }) }, 'editDialog', 'editError', editing === null ? '新增成功。' : '修改已保存。');
};
$('confirmDelete').onclick = () => { if (isAdmin && !saving && deleting) mutate('delete', { id: deleting }, 'deleteDialog', 'deleteError', '记录已删除。'); };
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => { if (!saving) $(button.dataset.close).close(); });
for (const id of ['editDialog', 'deleteDialog']) $(id).addEventListener('cancel', event => { if (saving) event.preventDefault(); });
page(); controls();
