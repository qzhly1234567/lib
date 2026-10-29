'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { installFixture } = require('./seatable-fixture.cjs');
Object.assign(process.env, { ALLOWED_ORIGIN: 'https://example.com', VERCEL_URL: 'test.vercel.app', SEATABLE_API_TOKEN: 'local-test-only', SEATABLE_BASE_UUID: 'local-base' });
let fixture, main;
beforeEach(() => {
  fixture = installFixture();
  delete require.cache[require.resolve('../lib/data-service')];
  main = require('../lib/data-service').main;
});
const invoke = (body, admin = false) => main({ httpMethod: 'POST', body: JSON.stringify(body) }, admin);
const supplier = { system: '给排水', name: '泵', brand: '测试厂家', contact: '测试联系人', phone: '00000000000' };
test('普通接口拦截修改删除、未知操作和提权参数，零上游请求', async () => {
  for (const action of ['update', 'delete', 'sql', 'append']) assert.equal((await invoke({ action, entity: 'suppliers' })).statusCode, 403);
  assert.equal((await invoke({ action: 'list', entity: 'suppliers', adminMode: true })).statusCode, 400);
  assert.equal(fixture.calls.length, 0);
});
test('实体和表名由白名单控制', async () => {
  for (const entity of ['__proto__', 'constructor', 'other', '../equipment']) assert.equal((await invoke({ action: 'list', entity })).statusCode, 403);
  assert.equal((await invoke({ action: 'list', entity: 'suppliers', table_name: '信息登记' })).statusCode, 400);
  assert.equal(fixture.calls.length, 0);
});
test('两表数据隔离，普通列表不暴露记录 ID 和隐藏列', async () => {
  const a = JSON.parse((await invoke({ action: 'list', entity: 'suppliers' })).body);
  const b = JSON.parse((await invoke({ action: 'list', entity: 'equipment' })).body);
  assert.equal(a.rows[0].name, '离心泵'); assert.equal(b.rows[0].price, 6800);
  assert.ok(!('id' in a.rows[0])); assert.ok(!JSON.stringify(a).includes('不应返回')); assert.equal(a.total, 1);
  const managed = JSON.parse((await invoke({ action: 'list', entity: 'equipment' }, true)).body);
  assert.equal(managed.rows[0].id, 'zyxwvutsrqponmlkjihgfe');
});
test('模糊筛选支持多个条件 AND，空条件、数值零与中文', async () => {
  fixture.rows['设备信息'].push({ _id: '0000000000000000000099', 设备名称: '零价泵', 设备分类: '其他', '购置单价（元）': 0 });
  const result = JSON.parse((await invoke({ action: 'list', entity: 'equipment', filters: { name: '泵', price: '0', category: '水泵设备' } })).body);
  assert.equal(result.rows.length, 1); assert.equal(result.total, 1);
  assert.equal(JSON.parse((await invoke({ action: 'list', entity: 'equipment', filters: { price: '0', category: '其他' } })).body).rows[0].price, 0);
  assert.equal(JSON.parse((await invoke({ action: 'list', entity: 'suppliers', filters: { name: ' ' } })).body).rows.length, 1);
});
test('过滤值参数绑定不拼接进 SQL，拒绝未知字段与非字符串条件', async () => {
  const result = JSON.parse((await invoke({ action: 'list', entity: 'suppliers', filters: { name: "' OR 1=1 --" } })).body);
  assert.equal(result.rows.length, 0); assert.ok(fixture.calls.filter(c => c.url.includes('/sql/')).every(c => !c.data.sql.includes('OR 1=1')));
  for (const filters of [{ unknown: 'x' }, { name: {} }, { name: 'x'.repeat(201) }, [], null]) assert.equal((await invoke({ action: 'list', entity: 'suppliers', filters })).statusCode, 400);
});
test('厂家必填与长度校验，无效数据不调用上游', async () => {
  for (const data of [{ ...supplier, phone: ' ' }, { ...supplier, name: 'x'.repeat(201) }, { ...supplier, id: 'x' }, null]) assert.equal((await invoke({ action: 'add', entity: 'suppliers', data })).statusCode, 400);
  assert.equal(fixture.calls.length, 0);
});
test('设备仅两项必填，数值列保存数字，可选空数值保存 null', async () => {
  assert.equal((await invoke({ action: 'add', entity: 'equipment', data: { category: '设备', name: '测试' } })).statusCode, 200);
  assert.equal(fixture.rows['设备信息'].at(-1)['购置单价（元）'], null);
  assert.equal((await invoke({ action: 'add', entity: 'equipment', data: { category: '设备', name: '零价', price: '0' } })).statusCode, 200);
  assert.equal(fixture.rows['设备信息'].at(-1)['购置单价（元）'], 0);
  assert.equal((await invoke({ action: 'add', entity: 'equipment', data: { category: '设备', name: '金额', price: '12.34' } })).statusCode, 200);
  assert.equal(fixture.rows['设备信息'].at(-1)['购置单价（元）'], 12.34);
});
test('金额拒绝负数、科学计数、超额小数、非有限数和过大数', async () => {
  for (const price of ['-1', '1.001', 'NaN', 'Infinity', '1e3', '1000000000000', 'abc']) assert.equal((await invoke({ action: 'add', entity: 'equipment', data: { category: '设备', name: '测试', price } })).statusCode, 400);
  assert.equal(fixture.calls.length, 0);
});
test('缺表或列时明确报错，绝不发送写入请求', async () => {
  fixture.tables = fixture.tables.filter(t => t.name !== '询价厂家信息');
  const missing = await invoke({ action: 'add', entity: 'suppliers', data: supplier });
  assert.equal(missing.statusCode, 503); assert.match(missing.body, /缺少/);
  assert.ok(!fixture.calls.some(c => c.method === 'POST'));
});
test('列类型不匹配时不允许新增', async () => {
  fixture.tables.find(t => t.name === '设备信息').columns.find(c => c.name === '购置单价（元）').type = 'text';
  const result = await invoke({ action: 'add', entity: 'equipment', data: { category: '设备', name: '测试', price: '12' } });
  assert.equal(result.statusCode, 503); assert.match(result.body, /类型应为数字/);
});
test('超过 1000 行时由 SeaTable 先筛选，只返回匹配结果', async () => {
  fixture.rows['设备信息'] = Array.from({ length: 1001 }, (_, i) => ({ _id: String(i).padStart(22, '0'), 设备名称: i === 1000 ? '最后一行' : '其他' }));
  const result = JSON.parse((await invoke({ action: 'list', entity: 'equipment', filters: { name: '最后' } })).body);
  assert.equal(result.total, 1); assert.equal(result.rows.length, 1);
  assert.equal(fixture.calls.filter(c => c.url.includes('/rows/')).length, 0);
  assert.equal(fixture.calls.filter(c => c.url.includes('/sql/')).length, 2);
});
test('管理修改删除仅影响指定实体和单条记录', async () => {
  const id = 'abcdefghijklmnopqrstuv';
  assert.equal((await invoke({ action: 'update', entity: 'suppliers', id, data: { ...supplier, name: '修改后' } }, true)).statusCode, 200);
  assert.equal(fixture.calls.at(-1).method, 'PUT'); assert.equal(fixture.calls.at(-1).data.updates.length, 1);
  assert.equal(fixture.rows['询价厂家信息'][0]['设备名称'], '修改后');
  assert.equal((await invoke({ action: 'delete', entity: 'equipment', id }, true)).statusCode, 409);
  assert.equal(fixture.rows['询价厂家信息'].length, 1);
  assert.equal((await invoke({ action: 'delete', entity: 'suppliers', id }, true)).statusCode, 200);
  assert.equal(fixture.rows['询价厂家信息'].length, 0); assert.equal(fixture.rows['设备信息'].length, 1);
});
test('管理记录 ID 格式校验和上游失败不重试', async () => {
  for (const id of [undefined, '../../x', 1]) assert.equal((await invoke({ action: 'delete', entity: 'suppliers', id }, true)).statusCode, 400);
  fixture.failure = 500;
  assert.equal((await invoke({ action: 'delete', entity: 'suppliers', id: 'abcdefghijklmnopqrstuv' }, true)).statusCode, 502);
  assert.equal(fixture.calls.filter(c => c.method === 'DELETE').length, 1);
});
test('HTTP 与损坏 JSON 校验', async () => {
  assert.equal((await main({ httpMethod: 'GET' })).statusCode, 405);
  assert.equal((await main({ httpMethod: 'POST', body: '{' })).statusCode, 400);
  assert.equal((await main({ httpMethod: 'POST', body: 'x'.repeat(16385) })).statusCode, 400);
});
test('普通和管理 Vercel 适配器正确分流并拒绝其他网站来源', async () => {
  for (const module of ['../api/data', '../api/admin']) delete require.cache[require.resolve(module)];
  async function run(handler, origin, body) {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.value = value; }, send(value) { this.value = JSON.parse(value); } };
    await handler({ method: 'POST', headers: { origin }, body }, res); return res;
  }
  const ordinary = require('../api/data'), managed = require('../api/admin');
  const body = { action: 'delete', entity: 'suppliers', id: 'abcdefghijklmnopqrstuv' };
  assert.equal((await run(ordinary, 'https://example.com', body)).code, 403);
  assert.equal((await run(managed, 'https://evil.test', body)).code, 403);
  assert.equal((await run(managed, 'https://test.vercel.app', body)).code, 200);
});

test('新建表缺列时返回列名，避免写入静默丢字段', async () => {
  fixture.tables.find(t => t.name === '询价厂家信息').columns = fixture.tables.find(t => t.name === '询价厂家信息').columns.filter(c => c.name !== '备注');
  const result = await invoke({ action: 'add', entity: 'suppliers', data: supplier });
  assert.equal(result.statusCode, 503); assert.match(result.body, /缺少字段：备注/);
  assert.ok(!fixture.calls.some(c => c.method === 'POST'));
});

test('隐藏选填字段不展示，更新其他字段不清空原有设备类别', async () => {
  const field = require('../public/fields').equipment.fields.find(f => f.key === 'subcategory');
  assert.equal(field.hidden, true); assert.equal(field.required, false);
  fixture.rows['设备信息'][0]['设备类别'] = '原有子类别';
  const response = await invoke({ action: 'update', entity: 'equipment', id: 'zyxwvutsrqponmlkjihgfe', data: { category: '水泵', name: '更新名称' } }, true);
  assert.equal(response.statusCode, 200);
  assert.equal(fixture.rows['设备信息'][0]['设备类别'], '原有子类别');
  assert.ok(!Object.hasOwn(fixture.calls.at(-1).data.updates[0].row, '设备类别'));
});

test('下拉选项按实体读取对应字典，只返回去重非空名称', async () => {
  const supplierOptions = JSON.parse((await invoke({ action: 'options', entity: 'suppliers' })).body);
  assert.deepEqual(supplierOptions.options, { system: ['泵', '膜系统'] });
  const equipmentOptions = JSON.parse((await invoke({ action: 'options', entity: 'equipment' }, true)).body);
  assert.deepEqual(equipmentOptions.options, { category: ['潜水泵', '离心泵'] });
  assert.ok(!JSON.stringify(equipmentOptions).includes('_id'));
});
test('下拉接口拒绝任意指定字典或注入参数', async () => {
  const result = await invoke({ action: 'options', entity: 'equipment', table_name: '信息登记' });
  assert.equal(result.statusCode, 400); assert.equal(fixture.calls.length, 0);
});
test('字典不存在时明确报错，空字典返回空数组而非示例数据', async () => {
  fixture.rows['系统'] = [];
  assert.deepEqual(JSON.parse((await invoke({ action: 'options', entity: 'suppliers' })).body).options.system, []);
  fixture.tables = fixture.tables.filter(t => t.name !== '设备分类');
  delete require.cache[require.resolve('../lib/data-service')]; main = require('../lib/data-service').main;
  const missing = await invoke({ action: 'options', entity: 'equipment' });
  assert.equal(missing.statusCode, 503); assert.match(missing.body, /设备分类/);
});
test('字典超过1000行也能完整读取', async () => {
  fixture.rows['系统'] = Array.from({ length: 1001 }, (_, i) => ({ 名称: '系统' + i }));
  const result = JSON.parse((await invoke({ action: 'options', entity: 'suppliers' })).body);
  assert.equal(result.options.system.length, 1001);
});

test('字典下拉过滤采用完整值匹配，其他字段仍模糊搜索', async () => {
  fixture.rows['询价厂家信息'] = [
    { 系统: '泵', 设备名称: '离心泵' }, { 系统: '水泵系统', 设备名称: '离心泵' }
  ];
  const result = JSON.parse((await invoke({ action: 'list', entity: 'suppliers', filters: { system: '泵', name: '心' } })).body);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].system, '泵');
});

test('并发查询与下拉仅共享一次鉴权和元数据读取', async () => {
  const results = await Promise.all([invoke({ action: 'list', entity: 'suppliers' }), invoke({ action: 'options', entity: 'suppliers' })]);
  assert.ok(results.every(r => r.statusCode === 200));
  assert.equal(fixture.calls.filter(c => c.url.includes('app-access-token')).length, 1);
  assert.equal(fixture.calls.filter(c => c.url.includes('/metadata/')).length, 1);
});
test('查询正文接收超时时提示安全重查，不提示提交结果不确定', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  fixture.stallRows = true;
  const pending = invoke({ action: 'list', entity: 'suppliers' });
  for (let i = 0; i < 6; i++) await new Promise(setImmediate);
  context.mock.timers.tick(25001);
  const result = await pending;
  assert.equal(result.statusCode, 504); assert.match(result.body, /此次查询不会修改数据/);
  assert.ok(!result.body.includes('避免重复'));
});
test('只有实际写入后的超时才提示先查询确认，不自动重试', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  fixture.stallRows = true;
  const pending = invoke({ action: 'add', entity: 'suppliers', data: supplier });
  for (let i = 0; i < 6; i++) await new Promise(setImmediate);
  context.mock.timers.tick(25001);
  const result = await pending;
  assert.equal(result.statusCode, 504); assert.match(result.body, /操作可能已生效/);
  assert.equal(fixture.calls.filter(c => c.method === 'POST').length, 1);
});

test('服务端分页默认20条，第二页无重复，页码超出范围自动回退', async () => {
  fixture.rows['设备信息'] = Array.from({ length: 45 }, (_, i) => ({ _id: String(i).padStart(22, '0'), 设备名称: '设备' + i }));
  const a = JSON.parse((await invoke({ action: 'list', entity: 'equipment' }, true)).body);
  const b = JSON.parse((await invoke({ action: 'list', entity: 'equipment', page: 2 }, true)).body);
  const c = JSON.parse((await invoke({ action: 'list', entity: 'equipment', page: 99 }, true)).body);
  assert.equal(a.rows.length, 20); assert.equal(a.total, 45); assert.equal(a.totalPages, 3);
  assert.equal(b.page, 2); assert.equal(b.rows[0].id, String(20).padStart(22, '0'));
  assert.equal(c.page, 3); assert.equal(c.rows.length, 5);
  const queries = fixture.calls.filter(c => c.data?.sql && !c.data.sql.includes('COUNT(*)'));
  assert.ok(queries.every(c => c.data.sql.includes('LIMIT 20')));
});
test('分页先筛选再统计，支持50/100条，空表总数为0', async () => {
  fixture.rows['设备信息'] = Array.from({ length: 111 }, (_, i) => ({ _id: String(i).padStart(22, '0'), 设备名称: i % 2 ? '其他' : '目标' }));
  const result = JSON.parse((await invoke({ action: 'list', entity: 'equipment', pageSize: 50, filters: { name: '目标' } })).body);
  assert.equal(result.total, 56); assert.equal(result.totalPages, 2); assert.equal(result.rows.length, 50);
  const hundred = JSON.parse((await invoke({ action: 'list', entity: 'equipment', pageSize: 100 })).body);
  assert.equal(hundred.rows.length, 100);
  fixture.rows['设备信息'] = [];
  const empty = JSON.parse((await invoke({ action: 'list', entity: 'equipment', page: 9 })).body);
  assert.deepEqual(empty.rows, []); assert.equal(empty.total, 0); assert.equal(empty.page, 1);
});
test('非法页码和每页条数不调用上游', async () => {
  for (const extra of [{ page: 0 }, { page: -1 }, { page: 1.5 }, { page: '1' }, { page: 1000001 }, { pageSize: 10000 }, { pageSize: '20' }]) assert.equal((await invoke({ action: 'list', entity: 'equipment', ...extra })).statusCode, 400);
  assert.equal(fixture.calls.length, 0);
});
test('管理详情按ID读取，不依赖记录是否在当前页，普通接口不允许', async () => {
  const body = { action: 'detail', entity: 'equipment', id: 'zyxwvutsrqponmlkjihgfe' };
  assert.equal((await invoke(body)).statusCode, 403);
  const result = JSON.parse((await invoke(body, true)).body);
  assert.equal(result.row.name, '测试泵');
  assert.equal((await invoke({ ...body, id: '0000000000000000000000' }, true)).statusCode, 404);
});
test('删除末页最后一条后请求原页，会回到有效页', async () => {
  fixture.rows['设备信息'] = Array.from({ length: 21 }, (_, i) => ({ _id: String(i).padStart(22, '0'), 设备名称: '设备' + i }));
  await invoke({ action: 'delete', entity: 'equipment', id: String(20).padStart(22, '0') }, true);
  const result = JSON.parse((await invoke({ action: 'list', entity: 'equipment', page: 2 })).body);
  assert.equal(result.page, 1); assert.equal(result.total, 20); assert.equal(result.rows.length, 20);
});
