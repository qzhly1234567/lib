# 信息登记与查询 · Vercel + SeaTable

原生单页 HTML，Vercel Node.js API 中转，SeaTable 持久化存储。访客无需登录，可查询、新增，不能修改或删除。没有前端框架或运行时第三方依赖。

## 1. 准备 SeaTable

已经验证的 Base UUID：`fedadbce-8c09-4dfb-83fb-41898fb59fa0`；服务地址：`https://cloud.seatable.io`；表名：`信息登记`；文本列：`姓名`、`电话`。已实际新增并读回一条测试记录。

API Token 仅由你填写到 Vercel 环境变量，不在任何源文件中保存。若重新生成 Token，请在该 Base 的 API Token 菜单选择读写权限。不要使用账户 Token 或 external-apps 链接里的应用 ID。

其他 Base：创建表和两个同名文本列，用 Base 的读写 API Token 请求 `GET /api/v2.1/dtable/app-access-token/`（Authorization: Bearer API-Token），响应的 `dtable_uuid` 就是 Base UUID。临时 `access_token` 由后端自动获取并缓存，无需手动填写。

## 2. 导入 Vercel

1. 将本目录 `data-entry` 的内容上传到你自己的 GitHub 仓库。不要上传 `.env` 或任何 Token。
2. 登录 Vercel，选择 **Add New → Project → Import Git Repository**，导入仓库。
3. 如果仓库根目录就是本目录的内容，Root Directory 保持默认；如果仓库里还包含 `data-entry` 这一层，Root Directory 选择 `data-entry`。
4. Framework Preset 选择 **Other**，Output Directory 使用 `public`（vercel.json 已配置），Build Command 不设置，保持无构建命令；不要填写 `npm run build`。使用 Node.js 22.x。
5. 在部署页面 Environment Variables 中添加下表变量。也可在导入后通过 **项目 → Settings → Environment Variables** 添加。至少勾选 Production；如果需要预览环境测试，也勾选 Preview。

| 变量 | 内容 |
| --- | --- |
| `SEATABLE_SERVER` | `https://cloud.seatable.io` |
| `SEATABLE_API_TOKEN` | 你自己的 Base 读写 API Token |
| `SEATABLE_BASE_UUID` | `fedadbce-8c09-4dfb-83fb-41898fb59fa0` |
| `SEATABLE_TABLE_NAME` | `信息登记` |

值不加引号，不加多余空格。Token 不要加 `NEXT_PUBLIC_`、`VITE_` 等公开前缀。

6. 点击 **Deploy**。前端已经使用相对路径 `/api/data`，无需修改任何网址，网站和 API 会一起部署。
7. 点击部署完成后的 HTTPS 网站地址，测试列表加载、新增、搜索和刷新。首次调用可能较慢。
8. 在项目 **Settings → Deployment Protection** 中检查生产部署是否要求 Vercel 登录；要允许熟人直接打开，生产网站应允许公开访问。预览环境可以继续保留保护。

后续修改环境变量只影响新部署，需要在 **Deployments → 对应部署的菜单 → Redeploy** 重新部署。

## 3. 自定义域名（可选）

默认 `vercel.app` 当前部署及生产域名自动识别，无需 `ALLOWED_ORIGIN`。自定义域名需要额外环境变量 `ALLOWED_ORIGIN=https://你的域名`，不带末尾 `/`，添加后 Redeploy。项目必须启用 Vercel 系统环境变量（默认提供 `VERCEL_URL` 和 `VERCEL_PROJECT_PRODUCTION_URL`）；若自行关闭，可用 ALLOWED_ORIGIN 指定唯一网站来源。

## 文件结构与扩展

- `public/index.html`：页面、表单、列表和本地搜索。
- `api/data.js`：Vercel HTTP 适配器，校验网站来源。
- `lib/data-service.js`：凭证管理、动作白名单、字段校验、SeaTable 调用。
- `vercel.json`：静态目录和 10 秒函数执行时间。
- `.env.example`：变量示例，不包含真实 Token。
- `tests/api.test.js`：隔离测试，不连接真实 SeaTable。

扩展字段：同步修改前端 `CONFIG.fields`、后端 `FIELDS`，并在 SeaTable 添加对应文本列。所有字段目前均为必填字符串。例如前端 `{key:'department',label:'部门',max:80}`，后端 `department: {column:'部门',max:80}`。

## 验证与运行

```sh
npm test
```

本地完整预览可在安装 Vercel CLI 后执行 `vercel dev`，按 CLI 提示关联项目和开发环境变量。直接双击 HTML 不会启动 API。

测试覆盖动作拦截、必填与长度校验、字段白名单、HTTP 方法、来源校验、上游写入格式、返回字段投影及 Vercel 适配器。尚未连接 Vercel 账户实际部署；线上域名、函数打包、环境变量和完整读写仍需部署后验证。

## 使用边界

- 后端只接受 `list`、`add`。`update`、`delete` 返回“不允许修改和删除数据”。客户端不能指定表名、上游地址、行 ID 或任意列名。
- SeaTable 每次最多返回 1000 行，后端内部批量读取全部记录，前端无分页。内部上游请求共用 8 秒预算，超时会明确报错，不返回部分列表；不适合大表。
- 新增不自动重试；超时可能发生在服务已经写入之后，请先查询确认，避免重复提交。本项目不提供幂等去重。
- 所有页面访问者都能看到姓名和电话。CORS/来源校验不是身份验证，公开接口可被其他脚本直接请求；仅向熟人分享，不能当作私密系统。
- 默认 HTTPS 接口不缓存数据；只返回配置字段，前端使用 textContent，避免把记录内容当 HTML 执行。
- Vercel Hobby 有额度和用途限制，不应把“可免费部署”理解为适用于任何内部商业用途；使用前确认当前计划条款与项目用途是否匹配。SeaTable 配额也以你的账户为准。

官方参考：
- Node.js API：https://vercel.com/docs/functions/runtimes/node-js
- 环境变量：https://vercel.com/docs/environment-variables
- Hobby 计划：https://vercel.com/docs/plans/hobby
- SeaTable 查询：https://api.seatable.com/reference/listrows
- SeaTable 新增：https://api.seatable.com/reference/appendrows
