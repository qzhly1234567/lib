'use strict';
// 测试专用：拦截 Node HTTPS，不连接真实 SeaTable。
const https = require('node:https');
const { EventEmitter } = require('node:events');
const schemas = require('../public/fields');
function installFixture() {
  const fixture = {
    rows: {
      '设备分类': [{ 名称: '潜水泵' }, { 名称: '离心泵' }, { 名称: '潜水泵' }, { 名称: '  ' }],
      '系统': [{ 名称: '泵' }, { 名称: '膜系统' }],
      '询价厂家信息': [{ _id: 'abcdefghijklmnopqrstuv', 系统: '给排水系统', 设备名称: '离心泵', '品牌（供货厂家）': '示例厂家', 联系人: '测试联系人', 联系电话: '00000000000', 备注: '<script>安全文本</script>', 隐藏字段: '不应返回' }],
      '设备信息': [{ _id: 'zyxwvutsrqponmlkjihgfe', 设备分类: '水泵设备', 设备名称: '测试泵', '规格/参数': '25m³/h', 材质: '304不锈钢', '购置单价（元）': 6800, 备注: '' }]
    }, calls: [], failure: null, nextId: 1
  };
  fixture.tables = Object.values(schemas).map(schema => ({ name: schema.table, columns: schema.fields.map(field => ({ name: field.column, type: field.type === 'number' ? 'number' : field.textarea ? 'long-text' : 'text' })) }));
  fixture.tables.push(...['设备分类','系统'].map(name => ({ name, columns: [{ name: '名称', type: 'text' }] })));
  https.request = (url, options, callback) => {
    const req = new EventEmitter();
    req.end = raw => setImmediate(() => {
      const target = new URL(url), data = raw ? JSON.parse(raw) : null;
      const table = data?.table_name || target.searchParams.get('table_name');
      fixture.calls.push({ url: String(url), method: options.method, data });
      const res = new EventEmitter(); res.setEncoding = () => {}; res.statusCode = 200;
      let result;
      if (fixture.failure && (target.pathname.endsWith('/rows/') || target.pathname.endsWith('/sql/'))) { res.statusCode = fixture.failure; fixture.failure = null; result = { error: 'simulated' }; }
      else if (target.pathname.includes('app-access-token')) result = { access_token: 'local-temporary', dtable_uuid: process.env.SEATABLE_BASE_UUID };
      else if (target.pathname.endsWith('/metadata/')) result = { metadata: { tables: fixture.tables } };
      else if (target.pathname.endsWith('/sql/')) {
        const sql = data.sql, tableName = sql.match(/FROM `([^`]+)`/)[1];
        let selected = [...(fixture.rows[tableName] || [])];
        const where = sql.split(' WHERE ')[1]?.split(/ ORDER BY | LIMIT /)[0];
        if (where) {
          const clauses = where.split(' AND ');
          selected = selected.filter(row => clauses.every((clause, index) => {
            const column = clause.match(/`([^`]+)`/)[1], value = String(row[column] ?? ''), parameter = String(data.parameters[index]);
            return clause.includes(' ILIKE ') ? value.toLocaleLowerCase().includes(parameter.slice(1, -1).toLocaleLowerCase()) : value.trim().toLocaleLowerCase() === parameter.toLocaleLowerCase();
          }));
        }
        if (sql.includes('COUNT(*)')) result = { success: true, results: [{ total: selected.length }] };
        else {
          const limit = Number(sql.match(/LIMIT (\d+)/)?.[1] || 100), offset = Number(sql.match(/OFFSET (\d+)/)?.[1] || 0);
          selected.sort((a,b) => String(a._id || '').localeCompare(String(b._id || '')));
          const columns = [...sql.split(' FROM ')[0].matchAll(/`([^`]+)`/g)].map(match => match[1]);
          result = { success: true, results: selected.slice(offset, offset + limit).map(row => Object.fromEntries(columns.map(column => [column, row[column]]))) };
        }
      }
      else if (!fixture.rows[table]) { res.statusCode = 404; result = { error: 'missing table' }; }
      else if (options.method === 'POST') {
        fixture.rows[table].push(...data.rows.map(row => ({ ...row, _id: String(fixture.nextId++).padStart(22, '0') })));
        result = { inserted_row_count: data.rows.length };
      } else if (options.method === 'PUT') {
        let count = 0;
        for (const update of data.updates) { const row = fixture.rows[table].find(row => row._id === update.row_id); if (row) { Object.assign(row, update.row); count++; } }
        result = { updated_row_count: count };
      } else if (options.method === 'DELETE') {
        const before = fixture.rows[table].length;
        fixture.rows[table] = fixture.rows[table].filter(row => !data.row_ids.includes(row._id));
        result = { deleted_row_count: before - fixture.rows[table].length };
      } else {
        const start = Number(target.searchParams.get('start') || 0), limit = Number(target.searchParams.get('limit') || 1000);
        result = { rows: fixture.rows[table].slice(start, start + limit) };
      }
      if (fixture.stallRows && (target.pathname.endsWith('/rows/') || target.pathname.endsWith('/sql/'))) { callback(res); return; }
      callback(res); res.emit('data', JSON.stringify(result)); res.emit('end'); req.emit('close');
    });
    req.destroy = error => { req.emit('error', error); req.emit('close'); };
    return req;
  };
  return fixture;
}
module.exports = { installFixture };
