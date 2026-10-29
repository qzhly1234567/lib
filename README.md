# 信息登记与查询 · Vercel + SeaTable

原生单页 HTML，Vercel Node.js API 中转，SeaTable 持久化存储。普通页面可查询、新增；独立 `/admin` 管理页可新增、编辑和删除，按确认需求不设置密码。两个页面没有相互跳转入口。没有前端框架或运行时第三方依赖。

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

## 页面与字段配置

- 普通页面：`/`，顶部「提交信息」「数据列表」，提交成功清空表单，切换列表自动获取最新记录。
- 独立管理页：`/admin`，支持查询、新增、编辑、删除，删除二次确认；没有跳转普通页面的链接。
- 两页均提供日夜主题切换，并在当前浏览器记住选择。
- 按需求管理页面与管理 API 不验证身份；普通接口虽然仍禁止修改和删除，但任何人都可直接调用公开的 `/api/admin` 修改数据。页面独立不构成权限隔离。

字段统一配置在 `public/fields.js`。前端表单、列表列、搜索及编辑弹窗和后端校验共用该配置。文件公开，绝对不能放密钥。

增加「部门」示例：先在 SeaTable 新建文本列 `部门`，再向字段数组增加：

```js
{ key: 'department', column: '部门', label: '部门', type: 'text', max: 80,
  required: false, placeholder: '请输入部门', autocomplete: 'organization' }
```

旧记录没有新字段时显示 `—`。建议新字段先设为可选，补齐旧数据后再改必填。当前支持文本及电话输入，值均为字符串；数字、日期、附件等 SeaTable 列类型需要专门的转换和校验，不能只改 type。`key` 保持唯一，不得使用内部保留字段 `id`；更名时同步调整 SeaTable 的 column 名，label 可独立修改。

文件结构：

- `public/index.html`、`public/admin.html`：独立页面入口。
- `public/app.js`、`public/styles.css`：共用业务交互和主题。
- `public/fields.js`：唯一字段配置。
- `api/data.js`、`api/admin.js`：Vercel 普通/管理 API。
- `lib/data-service.js`：凭证管理、请求校验及 SeaTable 操作。
- `vercel.json`：静态目录、两个 API 的执行时间、`/admin` 路由。
- `tests/api.test.js`：后端隔离测试。
- `tests/preview-server.cjs`：本地 UI 隔离预览，使用真实适配器和模拟的内存数据，不连接 SeaTable。

## 验证与运行

```sh
npm test
```

本地隔离预览（模拟数据，重启后恢复）可执行：

```sh
node tests/preview-server.cjs
```

普通页 `http://127.0.0.1:8766/`，管理页 `http://127.0.0.1:8766/admin`。

本地连接真实平台的完整预览可在安装 Vercel CLI 后执行 `vercel dev`，按 CLI 提示关联项目和开发环境变量。直接双击 HTML 不会启动 API。

测试覆盖动作拦截、必填与长度校验、字段白名单、HTTP 方法、来源校验、上游写入格式、返回字段投影及 Vercel 适配器。尚未连接 Vercel 账户实际部署；线上域名、函数打包、环境变量和完整读写仍需部署后验证。

## 使用边界

- 普通 `/api/data` 只接受 `list`、`add`，修改和删除被拒绝；公开管理 `/api/admin` 额外支持 `update`、`delete`，校验单条记录 ID 和字段。客户端不能指定表名、上游地址或任意列名。
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

- SeaTable 编辑接口：https://api.seatable.com/reference/updaterow
- SeaTable 删除接口：https://api.seatable.com/reference/deleterow
