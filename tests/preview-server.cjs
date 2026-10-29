// 本地 UI 验证专用：真实 API 适配器 + 内存 SeaTable 替身。绝不连接真实数据。
'use strict';
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const origin = 'http://127.0.0.1:8766';
Object.assign(process.env, { ALLOWED_ORIGIN: origin, SEATABLE_API_TOKEN: 'local-test-only', SEATABLE_BASE_UUID: 'local-base', SEATABLE_TABLE_NAME: '信息登记' });
let rows = [{ _id: 'abcdefghijklmnopqrstuv', 姓名: '本地演示记录', 电话: '00000000000' }], nextId = 1;
https.request = (url, options, callback) => {
  const req = new EventEmitter();
  req.end = raw => setImmediate(() => {
    let data = raw ? JSON.parse(raw) : null, result;
    if (String(url).includes('app-access-token')) result = { access_token: 'local-temporary', dtable_uuid: 'local-base' };
    else if (options.method === 'POST') { for (const row of data.rows) rows.push({ ...row, _id: String(nextId++).padStart(22, '0') }); result = { success: true }; }
    else if (options.method === 'PUT') { for (const update of data.updates) Object.assign(rows.find(r => r._id === update.row_id) || {}, update.row); result = { success: true }; }
    else if (options.method === 'DELETE') { rows = rows.filter(r => !data.row_ids.includes(r._id)); result = { success: true }; }
    else result = { rows };
    const res = new EventEmitter(); res.statusCode = 200; res.setEncoding = () => {}; callback(res); res.emit('data', JSON.stringify(result)); res.emit('end'); req.emit('close');
  });
  req.destroy = error => { req.emit('error', error); req.emit('close'); };
  return req;
};
const handlers = { '/api/data': require('../api/data'), '/api/admin': require('../api/admin') };
http.createServer(async (req, res) => {
  const pathname = new URL(req.url, origin).pathname;
  if (handlers[pathname]) {
    let body = ''; for await (const chunk of req) body += chunk;
    req.body = body;
    res.status = code => { res.statusCode = code; return res; };
    res.json = value => res.end(JSON.stringify(value)); res.send = value => res.end(value);
    return handlers[pathname](req, res);
  }
  const relative = pathname === '/' ? 'index.html' : pathname === '/admin' || pathname === '/admin/' ? 'admin.html' : pathname.slice(1);
  const root = path.resolve(__dirname, '../public'), file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const data = fs.readFileSync(file);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8'); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(8766, '127.0.0.1', () => console.log('本地隔离预览：http://127.0.0.1:8766（模拟数据，不连接 SeaTable）'));
