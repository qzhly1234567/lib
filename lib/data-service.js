'use strict';
// 配置全部来自云函数环境变量，绝不发送到浏览器。
const https = require('node:https');
const FIELDS = { name: { column: '姓名', max: 80 }, phone: { column: '电话', max: 40 } };
let cachedToken;
function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
function request(url, token, body, deadline) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining < 50) return reject(failure('服务响应超时，请稍后查询确认结果', 504));
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(url, { method: data ? 'POST' : 'GET', headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/json',
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
    } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; if (text.length > 8 * 1024 * 1024) req.destroy(failure('数据过大，请联系管理员', 502)); });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          if (res.statusCode === 401 || res.statusCode === 403) cachedToken = undefined;
          return reject(failure(res.statusCode === 429 ? '服务额度或频率受限，请稍后再试' : '数据服务暂不可用，请联系管理员', 502));
        }
        try { const result = JSON.parse(text); if (result.error || result.success === false) throw new Error(); resolve(result); }
        catch { reject(failure('数据服务返回异常，请联系管理员', 502)); }
      });
      res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(failure('服务响应超时，请先查询确认提交结果，避免重复提交', 504)), remaining);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(data);
  });
}
exports.main = async event => {
  const origin = event.headers?.origin || event.headers?.Origin;
  const allowed = process.env.ALLOWED_ORIGIN;
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin && origin === allowed) Object.assign(headers, { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  try {
    if (!process.env.SEATABLE_API_TOKEN || !process.env.SEATABLE_BASE_UUID || !process.env.SEATABLE_TABLE_NAME) throw failure('管理员尚未完成服务配置', 503);
    if (origin && origin !== allowed) throw failure('请求来源不被允许', 403);
    const method = event.httpMethod || event.requestContext?.http?.method;
    if (method === 'OPTIONS') return reply(204, null);
    if (method !== 'POST') throw failure('仅支持 POST 请求', 405);
    let body;
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body;
      if (typeof raw !== 'string' || Buffer.byteLength(raw) > 4096) throw new Error();
      body = JSON.parse(raw);
      if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    } catch { throw failure('请求格式错误或内容过长'); }
    if (body.action === 'update' || body.action === 'delete') throw failure('不允许修改和删除数据', 403);
    if (!['list', 'add'].includes(body.action)) throw failure('不允许的操作', 403);
    // 客户端不能指定表名、行 ID、转发 URL 或任意 SeaTable 字段。
    if (Object.keys(body).some(key => !['action', ...(body.action === 'add' ? ['data'] : [])].includes(key))) throw failure('包含不允许的参数');
    const row = {};
    if (body.action === 'add') {
      const data = body.data;
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !Object.hasOwn(FIELDS, key))) throw failure('数据字段不合法');
      for (const [key, field] of Object.entries(FIELDS)) {
        const value = data[key];
        if (typeof value !== 'string' || !value.trim() || value.trim().length > field.max) throw failure(`${field.column}必填且不能超过 ${field.max} 字`);
        row[field.column] = value.trim();
      }
    }
    const server = new URL(process.env.SEATABLE_SERVER || 'https://cloud.seatable.io');
    if (server.protocol !== 'https:' || server.pathname !== '/' || server.username || server.password) throw failure('管理员服务地址配置错误', 503);
    const deadline = Date.now() + 8000; // 为 Vercel 10 秒执行预算预留返回时间；不自动重试写入。
    if (!cachedToken || cachedToken.until < Date.now()) {
      const auth = await request(new URL('/api/v2.1/dtable/app-access-token/?exp=1h', server), process.env.SEATABLE_API_TOKEN, undefined, deadline);
      if (!auth.access_token || auth.dtable_uuid !== process.env.SEATABLE_BASE_UUID) throw failure('管理员 Base UUID 或 Token 配置错误', 503);
      cachedToken = { value: auth.access_token, until: Date.now() + 50 * 60 * 1000 };
    }
    const url = new URL(`/api-gateway/api/v2/dtables/${encodeURIComponent(process.env.SEATABLE_BASE_UUID)}/rows/`, server);
    if (body.action === 'add') {
      await request(url, cachedToken.value, { table_name: process.env.SEATABLE_TABLE_NAME, rows: [row] }, deadline);
      return reply(200, { ok: true });
    }
    url.searchParams.set('table_name', process.env.SEATABLE_TABLE_NAME);
    url.searchParams.set('convert_keys', 'true');
    url.searchParams.set('limit', '1000');
    const rows = [];
    for (let start = 0; ; start += 1000) {
      url.searchParams.set('start', String(start));
      const result = await request(url, cachedToken.value, undefined, deadline);
      if (!Array.isArray(result.rows)) throw failure('数据服务返回异常', 502);
      rows.push(...result.rows.map(source => Object.fromEntries(Object.entries(FIELDS).map(([key, field]) => [key, String(source[field.column] ?? '')]))));
      if (result.rows.length < 1000) break;
    }
    return reply(200, { ok: true, rows });
  } catch (error) {
    // 不记录上游响应、请求头或凭证。
    return reply(error.status || 502, { ok: false, message: error.status ? error.message : '网络异常，请稍后查询确认结果；提交操作请勿连续重试' });
  }
};
