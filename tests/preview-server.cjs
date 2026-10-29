// 本地真实服务预览：仅从进程环境读取凭证，不注入模拟数据。
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const origin = 'http://127.0.0.1:8766';
if (!process.env.SEATABLE_API_TOKEN || !process.env.SEATABLE_BASE_UUID) {
  console.error('请通过环境变量设置 SEATABLE_API_TOKEN 和 SEATABLE_BASE_UUID，预览服务不会使用模拟数据。');
  process.exit(1);
}
process.env.ALLOWED_ORIGIN = origin;
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
}).listen(8766, '127.0.0.1', () => console.log('本地真实预览：http://127.0.0.1:8766（连接 SeaTable）'));
