'use strict';
// 按确认需求，此管理接口无需登录；任何访问者都具备完整增删改权限。
const { createHandler } = require('./data');
module.exports = createHandler(true);
