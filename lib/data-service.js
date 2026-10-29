'use strict';
const https = require('node:https');
const TABLES = require('../public/fields');
let cachedToken;
let metadataCache;
let tokenFlight;
let metadataFlight;
function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
function request(url, token, body, deadline, method) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining < 50) return reject(failure('SeaTable 响应超时', 504));
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(url, { method: method || (data ? 'POST' : 'GET'), headers: {
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
    const timer = setTimeout(() => req.destroy(failure('SeaTable 响应超时', 504)), remaining);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(data);
  });
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function validateData(data, schema, updating = false) {
  if (!object(data) || Object.keys(data).some(key => !schema.fields.some(f => f.key === key))) throw failure('数据包含不允许的字段');
  // 更新时不触碰未提交的选填字段，避免前端隐藏字段的数据被清空。
  return Object.fromEntries(schema.fields.filter(field => !updating || field.required || Object.hasOwn(data, field.key)).map(field => {
    let value = data[field.key] ?? '';
    if (typeof value !== 'string' && !(field.type === 'number' && typeof value === 'number')) throw failure(`${field.label}格式不正确`);
    value = String(value).trim();
    if (field.required && !value) throw failure(`请填写${field.label}`);
    if (value.length > field.max) throw failure(`${field.label}不能超过 ${field.max} 字`);
    if (field.type === 'number') {
      if (!value) return [field.column, null];
      if (!/^\d+(?:\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) > 999999999999.99) throw failure('购置单价请输入非负金额，最多两位小数，且小于 1 万亿元');
      return [field.column, Number(value)];
    }
    return [field.column, value];
  }));
}
function validateFilters(filters, schema) {
  if (filters === undefined) return {};
  if (!object(filters)) throw failure('筛选条件格式错误');
  const allowed = schema.fields.filter(f => f.filter).map(f => f.key);
  for (const [key, value] of Object.entries(filters)) {
    if (!allowed.includes(key) || typeof value !== 'string' || value.length > 200) throw failure('筛选条件不合法');
  }
  return Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, value.trim().toLocaleLowerCase()]).filter(([,value]) => value));
}
async function validateTable(server, token, base, tableName, schema, deadline) {
  // SeaTable 会静默忽略未知列；写入前核对，防止丢失字段。
  const cacheKey = `${server.origin}/${base}/${token}`;
  if (!metadataCache || metadataCache.key !== cacheKey || metadataCache.until < Date.now()) {
    if (!metadataFlight || metadataFlight.key !== cacheKey) {
      const promise = (async () => {
        const result = await request(new URL(`/api-gateway/api/v2/dtables/${encodeURIComponent(base)}/metadata/`, server), token, undefined, deadline);
        if (!Array.isArray(result.metadata?.tables)) throw failure('无法读取表结构，请联系管理员', 502);
        metadataCache = { key: cacheKey, tables: result.metadata.tables, until: Date.now() + 60000 };
      })();
      metadataFlight = { key: cacheKey, promise };
    }
    const flight = metadataFlight;
    try { await flight.promise; } finally { if (metadataFlight === flight) metadataFlight = undefined; }
  }
  const table = metadataCache.tables.find(table => table.name === tableName);
  if (!table) throw failure(`SeaTable 缺少“${tableName}”表，请按部署说明完成建表`, 503);
  const missing = schema.fields.filter(field => !table.columns.some(c => c.name === field.column));
  if (missing.length) throw failure(`“${tableName}”缺少字段：${missing.map(f => f.column).join('、')}，请联系管理员配置`, 503);
  for (const field of schema.fields) {
    const type = table.columns.find(c => c.name === field.column).type;
    const valid = field.type === 'number' ? type === 'number' : ['text', 'long-text'].includes(type);
    if (!valid) throw failure(`“${tableName}”的“${field.column}”类型应为${field.type === 'number' ? '数字' : '文本或长文本'}`, 503);
  }
}
// adminMode 只能由服务端入口传入，不接受客户端提权标志。管理接口按需求无需身份验证。
exports.main = async (event, adminMode = false) => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  let writeAttempted = false;
  try {
    const method = event.httpMethod;
    if (method !== 'POST') throw failure('仅支持 POST 请求', 405);
    let body;
    try {
      if (typeof event.body !== 'string' || Buffer.byteLength(event.body) > 16384) throw new Error();
      body = JSON.parse(event.body);
      if (!object(body)) throw new Error();
    } catch { throw failure('请求格式错误或内容过长'); }
    if (!adminMode && ['update', 'delete'].includes(body.action)) throw failure('不允许修改和删除数据', 403);
    if (!(adminMode ? ['list', 'detail', 'options', 'add', 'update', 'delete'] : ['list', 'options', 'add']).includes(body.action)) throw failure('不允许的操作', 403);
    if (typeof body.entity !== 'string' || !Object.hasOwn(TABLES, body.entity)) throw failure('不允许访问此数据表', 403);
    const schema = TABLES[body.entity];
    const tableName = process.env[schema.env] || schema.table;
    const hasData = ['add', 'update'].includes(body.action), hasId = ['update', 'delete', 'detail'].includes(body.action);
    const allowedKeys = ['action', 'entity', ...(body.action === 'list' ? ['filters', 'page', 'pageSize'] : []), ...(hasData ? ['data'] : []), ...(hasId ? ['id'] : [])];
    if (Object.keys(body).some(k => !allowedKeys.includes(k))) throw failure('包含不允许的参数');
    if (hasId && (typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(body.id))) throw failure('记录 ID 不合法');
    const row = hasData ? validateData(body.data, schema, body.action === 'update') : undefined;
    const filters = body.action === 'list' ? validateFilters(body.filters, schema) : {};
    const requestedPage = body.page ?? 1, pageSize = body.pageSize ?? 20;
    if (body.action === 'list' && (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || requestedPage > 1000000 || ![20, 50, 100].includes(pageSize))) throw failure('分页参数不合法');
    if (!process.env.SEATABLE_API_TOKEN || !process.env.SEATABLE_BASE_UUID) throw failure('管理员尚未完成服务配置', 503);
    const server = new URL(process.env.SEATABLE_SERVER || 'https://cloud.seatable.io');
    if (server.protocol !== 'https:' || server.pathname !== '/' || server.username || server.password || server.search || server.hash) throw failure('管理员服务地址配置错误', 503);
    const base = process.env.SEATABLE_BASE_UUID;
    const deadline = Date.now() + 25000; // 留出 5 秒供 Vercel 返回响应。
    if (!cachedToken || cachedToken.until < Date.now()) {
      if (!tokenFlight) {
        tokenFlight = (async () => {
          const auth = await request(new URL('/api/v2.1/dtable/app-access-token/?exp=1h', server), process.env.SEATABLE_API_TOKEN, undefined, deadline);
          if (!auth.access_token || auth.dtable_uuid !== base) throw failure('管理员 Base UUID 或 Token 配置错误', 503);
          cachedToken = { value: auth.access_token, until: Date.now() + 50 * 60 * 1000 };
        })();
      }
      const flight = tokenFlight;
      try { await flight; } finally { if (tokenFlight === flight) tokenFlight = undefined; }
    }
    if (body.action === 'options') {
      const options = {};
      for (const field of schema.fields.filter(field => field.optionsSource)) {
        const source = field.optionsSource;
        await validateTable(server, cachedToken.value, base, source.table, { fields: [{ column: source.column, type: 'text' }] }, deadline);
        const values = new Set();
        const sourceUrl = new URL(`/api-gateway/api/v2/dtables/${encodeURIComponent(base)}/rows/`, server);
        sourceUrl.searchParams.set('table_name', source.table);
        sourceUrl.searchParams.set('convert_keys', 'true');
        sourceUrl.searchParams.set('limit', '1000');
        for (let start = 0; ; start += 1000) {
          sourceUrl.searchParams.set('start', String(start));
          const result = await request(sourceUrl, cachedToken.value, undefined, deadline);
          if (!Array.isArray(result.rows)) throw failure('下拉选项数据返回异常', 502);
          for (const row of result.rows) {
            const value = String(row[source.column] ?? '').trim();
            if (value.length > field.max) throw failure(`“${source.table}”中的名称超过 ${field.max} 字，请联系管理员修正`, 503);
            if (value) values.add(value);
          }
          if (result.rows.length < 1000) break;
        }
        options[field.key] = [...values];
      }
      return reply(200, { ok: true, options });
    }
    await validateTable(server, cachedToken.value, base, tableName, schema, deadline);
    const url = new URL(`/api-gateway/api/v2/dtables/${encodeURIComponent(base)}/rows/`, server);
    if (['add', 'update', 'delete'].includes(body.action)) {
      const payload = body.action === 'add' ? { table_name: tableName, rows: [row] }
        : body.action === 'update' ? { table_name: tableName, updates: [{ row_id: body.id, row }] }
          : { table_name: tableName, row_ids: [body.id] };
      writeAttempted = true;
      const result = await request(url, cachedToken.value, payload, deadline, { add: 'POST', update: 'PUT', delete: 'DELETE' }[body.action]);
      if (result.updated_row_count === 0 || result.deleted_row_count === 0 || result.inserted_row_count === 0) throw failure('记录未保存，可能已被其他人删除，请刷新确认', 409);
      return reply(200, { ok: true });
    }
    // 表和列来自服务端白名单，筛选值使用参数绑定，客户端不能传 SQL。
    const quote = name => {
      if (typeof name !== 'string' || /[`\x00-\x1f]/.test(name)) throw failure('管理员表名或列名配置不合法', 503);
      return '`' + name + '`';
    };
    const table = quote(tableName);
    const selected = [...(adminMode ? ['`_id`'] : []), ...schema.fields.map(f => quote(f.column))].join(', ');
    const sqlUrl = new URL(`/api-gateway/api/v2/dtables/${encodeURIComponent(base)}/sql/`, server);
    const query = async (sql, parameters) => {
      const result = await request(sqlUrl, cachedToken.value, { sql, parameters, convert_keys: true }, deadline);
      if (!Array.isArray(result.results)) throw failure('分页查询返回格式异常，请联系管理员', 502);
      return result.results;
    };
    const project = source => Object.fromEntries(schema.fields.map(field => [field.key, field.type === 'number' ? source[field.column] ?? '' : String(source[field.column] ?? '')]).concat(adminMode ? [['id', source._id]] : []));
    if (body.action === 'detail') {
      const rows = await query(`SELECT ${selected} FROM ${table} WHERE \`_id\` = ? LIMIT 1`, [body.id]);
      if (!rows.length) throw failure('记录不存在或已被删除', 404);
      return reply(200, { ok: true, row: project(rows[0]) });
    }
    const parameters = [];
    const clauses = Object.entries(filters).map(([key, value]) => {
      const field = schema.fields.find(field => field.key === key), column = quote(field.column);
      parameters.push(field.optionsSource ? value : '%' + value + '%');
      return field.optionsSource ? `LOWER(TRIM(${column})) = ?` : `${field.type === 'number' ? "concatenate('', " + column + ')' : column} ILIKE ?`;
    });
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
    const counts = await query(`SELECT COUNT(*) AS total FROM ${table}${where}`, parameters);
    const total = Number(counts[0]?.total);
    if (!Number.isSafeInteger(total) || total < 0) throw failure('分页总数返回异常', 502);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    let page = Math.min(requestedPage, totalPages);
    let sources = total ? await query(`SELECT ${selected} FROM ${table}${where} ORDER BY \`_ctime\` DESC, \`_id\` ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, parameters) : [];
    // 并发删除导致最后一页已空时，回退一页；不返回全表。
    if (!sources.length && page > 1) {
      page--;
      sources = await query(`SELECT ${selected} FROM ${table}${where} ORDER BY \`_ctime\` DESC, \`_id\` ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, parameters);
    }
    return reply(200, { ok: true, rows: sources.map(project), total, page, pageSize, totalPages });
  } catch (error) {
    const message = error.status === 504
      ? writeAttempted ? '保存请求超时，操作可能已生效。请先查询确认结果，避免重复操作。' : 'SeaTable 查询超时，请稍后重新查询。此次查询不会修改数据。'
      : error.status ? error.message : writeAttempted ? '网络异常，操作结果尚未确认。请先查询结果，避免重复操作。' : '数据服务连接异常，请稍后重新查询。';
    return reply(error.status || 502, { ok: false, message });
  }
};
