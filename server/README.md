# 海大易物 · 后端服务（零依赖 Node.js REST API）

为纯前端演示版「海大易物」（校园二手交易 H5）提供真实 API + JSON 文件持久化。
**不使用任何第三方包**：只用 Node 内置模块（http / fs / path / url / crypto），没有 node_modules，也不需要 npm install。

## 环境要求

- Node.js 18 或以上（用到了 crypto.randomUUID、fs.rmSync）
- 不需要数据库，不需要安装依赖

## 怎么启动

```powershell
cd D:\dseek\haidayiwu-alpha\server
node server.js
```

启动后终端会打印：

```text
[海大易物] API 服务已启动：http://localhost:3000
  版本      v0.9.2
  接口前缀  /api
  静态目录  D:\dseek\haidayiwu-alpha\web
  数据文件  D:\dseek\haidayiwu-alpha\server\data\db.json
  商品条数  12
  健康检查  GET /api/health
```

也可以 ```npm start```（package.json 里只声明了 scripts，dependencies 为空）。

**本服务同时托管 ../web 静态目录**，所以前端与 API 天然同源，正常演示路径就是
```node server.js``` 之后直接访问 http://localhost:3000 —— 既拿到页面，又拿到 /api 接口，不存在跨域问题。

## 端口

- 默认 3000，用环境变量 PORT 改：

```powershell
$env:PORT=3001; node server.js
```

```cmd
set PORT=3001 && node server.js
```

- 端口被占用时会打印中文提示并以退出码 1 结束，不会静默失败：

```text
[海大易物] 端口 3000 已被占用，服务未能启动。
  换个端口再试：PowerShell  $env:PORT=3001; node server.js
```

## 目录说明

```text
server/
  server.js        HTTP 服务：路由分发、CORS、请求体解析与限额、静态托管、错误处理
  store.js         数据层：db.json 读写（原子写）、种子初始化、增删改查与字段校验
  data/seed.json   12 条种子商品（直接由 web/data/seed.js 求值导出，字段未改动）
  data/db.json     运行时数据文件（首次启动自动生成，交付时不含该文件）
  api.md           接口文档（含真实请求 / 响应示例）
  README.md        本文件
  package.json     只有 name / version / scripts，dependencies 为空
```

## 数据存在哪

- 全部数据存在 ```server/data/db.json```，结构为 ```{ items, messages, users }```。
- 写入是**原子**的：先把完整 JSON 写进 ```data/db.json.tmp```，再用 ```fs.renameSync``` 覆盖 ```db.json```，
  所以即使进程在写入中途被杀，也不会留下半截 JSON 文件。
- 首次启动时如果 ```db.json``` 不存在，会自动读取 ```data/seed.json``` 初始化（12 条商品 + 从商品推导出的卖家信息）。

## 怎么重置数据

停掉服务，然后删掉数据文件，下次启动会重新从 seed.json 初始化：

```powershell
Remove-Item .\data\db.json        # 或者：npm run reset
node server.js                   # 重新初始化
```

如果 db.json 被手工改坏（JSON 解析失败），启动时会打印
```[海大易物] 数据初始化失败：db.json 无法解析……``` 并以退出码 1 退出，删掉该文件即可恢复。

## 安全与限额

- 所有请求带 CORS 头：```Access-Control-Allow-Origin: *```、```Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS```、```Access-Control-Allow-Headers: Content-Type```；OPTIONS 预检直接返回 204。
- 请求体上限 1MB，超出返回 413；JSON 解析失败返回 400 ```{"error":"BAD_JSON"}```。
- 静态托管做了目录穿越防护：路径里出现 ```..``` 段直接 403（在 URL 规范化之前检查，避免被 ```/../``` 折叠绕过）；
  解析后的绝对路径还会二次确认必须落在 ```web/``` 目录内。
- 非文件路径一律回落到 ```index.html```（前端用 hash 路由）。

## 已知限制

- 单进程、内存 + 整文件重写：适合演示与课程项目，不适合并发写入或大数据量场景。
- 没有鉴权、没有会话：```sellerId```、```from``` 等身份字段都由客户端自报，任何人都能改。
- 私信按 itemId 平铺存储，不带已读状态、不带分页。
- seed.json 里的 ```createdAt``` 是生成该文件那一刻的相对时间戳（源 seed.js 用 Date.now() 往前推小时数），之后不会再变；
  种子商品没有 ```coverImage``` 字段（前端仅用 coverColor 占位），所以这些条目的响应里也没有该字段，
  只有通过 POST 新建的商品才会带 ```coverImage```（缺省为 null）。
- 客户端可以自带 id（前端离线乐观写入需要），如果 id 已存在会返回 409 ```ID_CONFLICT```，不做自动合并。
- 静态响应没有做缓存协商（不带 ETag / Last-Modified），每次都是完整读取文件。

## 接口文档

见 ```api.md```。
