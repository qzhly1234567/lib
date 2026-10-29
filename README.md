# 厂家与设备信息系统 · Vercel + SeaTable

原生 HTML/CSS/JavaScript，零运行时第三方依赖。Vercel 提供前端静态托管和 Node.js API，SeaTable 保存两类数据，Token 仅在服务端环境变量中。

## 页面和操作

- 普通页面 `/`：顶部「询价厂家信息」「设备信息」，每个模块都有筛选区、列表及右侧添加按钮。
- 添加视图 `/#suppliers/add`、`/#equipment/add`：提交后弹出成功提示，可「返回列表」或「继续添加」。返回列表重置筛选并重新查询，继续添加清空表单。
- 独立后台 `/admin`：两模块均可查询、新增、编辑和删除，编辑视图回填原记录，删除二次确认。
- 两页没有互相跳转入口。按用户确认需求，管理页面和 `/api/admin` **无需密码，任何取得管理地址或接口地址的人均可修改/删除数据**。独立地址不构成身份认证。
- 日间/夜间主题切换，浏览器本地记忆；列表宽于窗口时可横向滚动。

## SeaTable 配置

先按 [两表字段清单](docs/seatable-schema.md) 配置现有 Base。代码不会自动新建表、改列或迁移旧“信息登记”数据。厂家的五项信息必填，备注选填；设备仅“设备分类”“设备名称”必填，单价是数字类型。

已验证 Base UUID：`fedadbce-8c09-4dfb-83fb-41898fb59fa0`，服务为 `https://cloud.seatable.io`。

在 Base 菜单的 API Token 中生成该 Base 的读写 Token。Base UUID 可通过服务端请求 `GET /api/v2.1/dtable/app-access-token/` 获取，使用请求头 `Authorization: Bearer API-Token`，返回 `dtable_uuid`。临时 `access_token` 由后端自动获取和缓存，不需要手动配置。

## Vercel 部署

1. 导入 GitHub 仓库 `qzhly1234567/lib`，Root Directory 为仓库根目录，Framework Preset 选 **Other**，Output Directory 为 `public`，不设置 Build Command，使用 Node.js 22.x。
2. 在 **Settings → Environment Variables** 配置下表，勾选 Production；若需预览部署，也在 Preview 设置相同变量。不要添加任何公开前缀如 `VITE_` 或 `NEXT_PUBLIC_`。

| 变量 | 值 |
| --- | --- |
| `SEATABLE_SERVER` | `https://cloud.seatable.io` |
| `SEATABLE_API_TOKEN` | Base 读写 Token，建议 Sensitive |
| `SEATABLE_BASE_UUID` | `fedadbce-8c09-4dfb-83fb-41898fb59fa0` |
| `SEATABLE_SUPPLIERS_TABLE` | 可选，默认 `询价厂家信息` |
| `SEATABLE_EQUIPMENT_TABLE` | 可选，默认 `设备信息` |
| `ALLOWED_ORIGIN` | 自定义域名填 `https://lib.paper-cranes.cn`，不带末尾斜杠 |

旧 `SEATABLE_TABLE_NAME` 已不再使用，可移除。默认 `vercel.app` 部署域名通过平台系统环境变量识别，自定义域名使用 ALLOWED_ORIGIN。前端始终使用同域 `/api/data` 或 `/api/admin`，无需修改接口地址。

3. Deploy 或 Redeploy。环境变量变更只影响新部署。生产域名若需要熟人无需登录访问，应检查 Deployment Protection 配置。
4. 在真实环境验证两表列表、组合筛选、必填校验、新增成功分支以及管理编辑/删除。对于真实数据，删除前确认有需要保留的副本。

本轮代码更改没有自动提交、推送或部署；本地隔离验证不代表线上表结构和部署路由已通过完整测试。

## 查询行为

前端向 Vercel 发出结构化请求，例如：

```json
{
  "action": "list",
  "entity": "suppliers",
  "filters": { "system": "给排", "name": "泵" }
}
```

entity 仅允许 `suppliers`、`equipment`，实际表名由服务端配置决定。每个非空条件进行不区分大小写的文本包含匹配，多个条件按 AND 组合；空条件忽略。设备金额也按原始数值的文本形式模糊匹配（输入 `6800`，不要输入显示用的逗号）。备注和序号不作为筛选项。

列表使用 SeaTable SQL 服务端分页：先在 SeaTable 按条件统计匹配总数，再只查询当前页。默认 20 条，可选 50/100 条；后端固定 SELECT 列、表名及排序（创建时间倒序、ID 升序），查询值通过 parameters 绑定，不接收客户端 SQL。每页通常产生两次 SQL API 请求（统计和页面记录），空结果只统计一次；下拉字典仍独立按批读取。

分页请求示例：

```json
{"action":"list","entity":"suppliers","filters":{"system":"泵"},"page":2,"pageSize":20}
```

响应包含 rows、total（匹配总数）、page、pageSize、totalPages。页码必须为正整数，每页条数仅允许 20/50/100；超出最后一页时回退至有效页。多个查询条件 AND 组合，系统/设备分类完整匹配，其余字段 ILIKE 模糊匹配（% 为通配符）。序号按分页偏移连续计算，筛选/重置/改变条数回到第一页，删除最后一页最后一条后自动退回有效页。空表显示 0 条、1/1 页，不填充模拟数据。

后台 detail 动作按单条记录 ID 加载编辑内容，不受当前页限制；普通接口不允许此动作。

所有上游调用共用 25 秒请求预算（Vercel 上限 30 秒、前端等待 35 秒）。分页减少记录传输量，但不能消除网络异常；统计和页面读取之间如有其他人增删数据，总数与当页可能短暂变化。

普通 `/api/data` 接受 `list/options/add`；管理 `/api/admin` 支持 `list/detail/options/add/update/delete`。更新/删除必须指定单条记录 ID，字段和筛选均通过白名单校验。普通响应不包含管理 ID 或隐藏列，列表内容以纯文本渲染。

## 字段扩展与文件结构

`public/fields.js` 是两表字段的统一配置，前端表单、筛选、列表、编辑和后端校验共用。每个字段的 column 是真实 SeaTable 列名，label 是界面名称。file 公开，绝不能保存 Token。

新增字段：先在对应 SeaTable 表建列，然后在相应 entity 的 fields 中增加配置：

```js
{ key: 'department', column: '部门', label: '部门', type: 'text', max: 100,
  required: false, filter: true, placeholder: '请输入部门' }
```

现有配置代码会给缺省项补默认值；显式配置的 column、max、filter 会保留。旧记录没有值时显示 `—`；建议新字段先设为可选。当前支持文本、长文本、电话文本和两位小数金额，其他 SeaTable 列类型需要专门转换和校验。不要使用保留 key `id`；key 必须唯一。

- `public/index.html`、`public/admin.html`：独立普通/管理页面。
- `public/app.js`、`public/styles.css`：页面视图、主题、真实 API 交互。
- `public/fields.js`：两表集中配置。
- `api/data.js`、`api/admin.js`：Vercel 普通/管理入口。
- `lib/data-service.js`：鉴权、表结构校验、两表筛选、增删改。
- `vercel.json`：静态目录、`/admin` 路由和函数执行时间。
- `tests/api.test.js`：隔离测试；`tests/seatable-fixture.cjs` 为上游替身。
- `tests/preview-server.cjs`：本地真实服务预览，从进程环境读取凭证，直接连接 SeaTable。

## 本地验证

```sh
npm test
node tests/preview-server.cjs
```

运行预览前，需通过本机进程环境配置 SEATABLE_API_TOKEN、SEATABLE_BASE_UUID 等变量。普通页 `http://127.0.0.1:8766/`，后台 `http://127.0.0.1:8766/admin`。预览直接连接真实 SeaTable，不生成示例记录，新增/编辑/删除会真实保存；数据为空时展示空表。单元测试仍使用隔离替身，不接触真实数据。也可使用 Vercel CLI `vercel dev`。不要把 Token 放入仓库或前端。

## 边界

- 新增、修改、删除均不自动重试。网络超时可能发生在数据已经保存后，应先重新查询确认，避免重复操作。
- 删除二次确认只发生在网页，不能防止直接调用公开管理 API。
- 来源校验不是身份认证。所有普通页面访问者都能查看联系人和电话，请控制分享范围。
- 不保存请求凭证或上游错误到日志；缺表、缺列和类型错误会明确提示。元数据热缓存 60 秒。
- Vercel、SeaTable 的免费额度、用途条款和期限以当前账户为准。

官方参考：
- https://api.seatable.com/reference/listrows
- https://api.seatable.com/reference/appendrows
- https://api.seatable.com/reference/updaterow
- https://api.seatable.com/reference/deleterow
- https://vercel.com/docs/environment-variables

## 动态下拉

厂家“系统”与设备“设备分类”的表单项通过 options 动作读取同名子表的“名称”列，查询区同样使用下拉，其他条件保留模糊文本输入。见 [子表说明](docs/seatable-schema.md)。前端不直连 SeaTable，无示例选项；修改子表后重新打开表单即可。

- 最新查询交互：系统、设备分类使用真实子表下拉，含“全部”选项；选择后按完整名称精确匹配，其他输入条件仍模糊匹配，多个条件 AND 组合。

并发列表与下拉请求会复用进行中的鉴权和表结构读取，避免重复冷启动请求。查询超时提示可安全重查；仅实际尝试写入后的超时提示需要先确认结果。

- SeaTable SQL 分页官方接口：https://api.seatable.com/reference/querysql
