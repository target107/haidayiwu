# 海大易物 · 后端服务

零依赖 Node REST 服务，为微信小程序提供数据接口。只用 Node 内置模块，没有第三方包，不需要 npm install。

## 启动

```powershell
cd server
node server.js
```

启动后终端会打印服务地址、数据文件位置与商品条数。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/health | 健康检查，返回服务状态与商品条数 |
| GET | /api/items | 全部商品 |
| GET | /api/items/:id | 单个商品 |
| POST | /api/items | 新建商品（服务端校验字段） |
| PATCH | /api/items/:id | 局部更新（上下架、浏览量） |
| DELETE | /api/items/:id | 删除 |
| GET | /api/messages/:itemId | 早期私信接口 |
| POST | /api/messages/:itemId | 早期私信接口 |
| GET | /api/users/:sellerId | 卖家信息 |
| POST | /api/verify | 早期身份校验接口 |

## 数据

全部数据存于 `data/db.json`，首次启动时由 `data/seed.json` 初始化 12 条商品。写入为原子操作（先写临时文件再重命名）。

## 已知限制

- `/api/messages` 与 `/api/verify` 是早期版本的扁平接口。小程序改为「商品 + 买家」会话模型与本地账号表后，这两个接口已无调用方，将在 Beta 阶段重构或移除。
- 静态托管目录为 `../admin`（Beta 阶段的网页管理后台），当前尚未创建，因此访问 `/` 会返回 404；`/api/*` 不受影响。
- 单进程整文件重写，无并发控制；无鉴权，身份字段由客户端自报。
