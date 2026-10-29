'use strict';
const { main } = require('../lib/data-service');
function createHandler(adminMode = false) {
return async (req, res) => {
  // 同域调用：允许当前部署、生产域名或显式配置的自有域名。
  // 仅使用平台环境变量，不信任客户端 Host / 转发头来决定允许的来源。
  const origins = new Set([
    process.env.ALLOWED_ORIGIN,
    ...[process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map(host => `https://${host}`)
  ].filter(Boolean));
  const origin = req.headers.origin;
  res.setHeader('Cache-Control', 'no-store');
  if (origin && !origins.has(origin)) return res.status(403).json({ ok: false, message: '请求来源不被允许' });
  // 同域 API 无需跨域头。来源已在适配器校验，内部事件不透传 Origin。
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
  const result = await main({ httpMethod: req.method, headers: {}, body }, adminMode);
  for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
  res.status(result.statusCode).send(result.statusCode === 204 ? '' : result.body);
};

}
module.exports = createHandler();
module.exports.createHandler = createHandler;
