# 海大易物 · API 文档（v0.9.2）

基地址：```http://localhost:3000```（端口可用环境变量 PORT 改）
所有接口都在 ```/api``` 前缀下，响应统一 ```Content-Type: application/json; charset=utf-8```（DELETE 成功的 204 除外）。

## 通用约定

| 项目 | 说明 |
|---|---|
| CORS | ```Access-Control-Allow-Origin: *```、```Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS```、```Access-Control-Allow-Headers: Content-Type``` |
| 预检 | ```OPTIONS``` 一律 204，无响应体 |
| 请求体 | 最大 1MB，超出 413 ```{"error":"PAYLOAD_TOO_LARGE","message":"请求体不能超过 1MB"}``` |
| 非法 JSON | 400 ```{"error":"BAD_JSON"}``` |
| 未知 API | 404 ```{"error":"NO_ROUTE"}``` |
| 方法不对 | 405 ```{"error":"METHOD_NOT_ALLOWED"}``` |
| id 冲突 | 409 ```{"error":"ID_CONFLICT","message":"该 id 已存在"}``` |

### 关于客户端指定 id

POST ```/api/items``` 与 POST ```/api/messages/:itemId``` **支持客户端在请求体里自带非空字符串 ```id```**，服务端会直接使用它落库；
没带 id 时才由服务端生成（商品 ```i_<uuid>```、私信 ```m_<uuid>```）。
这是为前端「乐观本地写入 + 异步同步后端」的模式准备的：前端先生成 id、先渲染，再把同一条数据 POST 上来。
id 长度上限 64，且不能含斜杠。

## 接口总表

| 方法 | 路径 | 说明 | 成功 | 失败 |
|---|---|---|---|---|
| GET | /api/health | 健康检查 | 200 | — |
| GET | /api/items | 全部商品 | 200 | — |
| GET | /api/items/:id | 单个商品 | 200 | 404 NOT_FOUND |
| POST | /api/items | 新建商品 | 201 | 400 VALIDATION / 409 ID_CONFLICT |
| PATCH | /api/items/:id | 局部更新（上下架、浏览量等） | 200 | 404 NOT_FOUND / 400 VALIDATION |
| DELETE | /api/items/:id | 删除（连带删掉该商品私信） | 204 无内容 | 404 NOT_FOUND |
| GET | /api/messages/:itemId | 某商品的私信列表 | 200 | — |
| POST | /api/messages/:itemId | 发一条私信 | 201 | 400 VALIDATION / 409 ID_CONFLICT |
| GET | /api/users/:sellerId | 卖家信息 | 200 | 404 NOT_FOUND |
| POST | /api/verify | 校内身份校验（12 位学号 + 姓名） | 200 | 400 |

---

## 1. GET /api/health

请求：

```http
GET /api/health HTTP/1.1
```

响应 200（真实返回）：

```json
{"ok":true,"version":"v0.9.2","db":"db.json","items":12}
```

## 2. GET /api/items

请求：

```http
GET /api/items HTTP/1.1
```

响应 200（首条节选）：

```json
{
  "items": [
    {
      "id": "i_001",
      "title": "高等数学同济第七版 上下册",
      "desc": "上下册齐全，书页干净，只有少量铅笔笔记可以擦掉。期末复习够用，南海苑自提，也能送到教学楼。",
      "price": 25,
      "category": "教材书籍",
      "condition": "轻微使用痕迹",
      "campus": "崂山校区·南海苑",
      "sellerName": "李同学",
      "sellerId": "u_1001",
      "coverColor": "#dbeafe",
      "createdAt": 1793428917885,
      "status": "on",
      "views": 46
    }
  ]
}
```

实际条数：首次启动 12 条（全部来自 ```data/seed.json```），新建后会增加。新发布的商品排在最前面。

## 3. GET /api/items/:id

```http
GET /api/items/i_cef265e3-ac26-478f-9078-6abec9fa55db HTTP/1.1
```

响应 200：

```json
{
  "item": {
    "id": "i_cef265e3-ac26-478f-9078-6abec9fa55db",
    "title": "台灯 护眼 LED",
    "desc": "用了半年，光很柔和",
    "price": 45,
    "category": "生活用品",
    "condition": "轻微使用痕迹",
    "campus": "崂山校区·南海苑",
    "sellerName": "校园用户0823",
    "sellerId": "u_self",
    "coverColor": "#a7f3d0",
    "coverImage": null,
    "createdAt": 1793428924223,
    "status": "on",
    "views": 0
  }
}
```

不存在时 404：

```json
{"error":"NOT_FOUND"}
```

## 4. POST /api/items

请求体字段（必填：```title``` ```price``` ```category``` ```condition``` ```campus```）：

| 字段 | 类型 | 约束 |
|---|---|---|
| id | string | 可选，客户端自带则直接用；≤64 字符、不含斜杠 |
| title | string | 非空，≤ 60 字 |
| desc | string | 可选，≤ 500 字 |
| price | number | 数字，> 0 且 ≤ 99999（纯数字字符串也接受） |
| category | string | 教材书籍 / 自行车 / 生活用品 / 数码电子 / 其他 |
| condition | string | 全新 / 几乎全新 / 轻微使用痕迹 / 明显使用痕迹 |
| campus | string | 崂山校区·南海苑 / 崂山校区·东海苑 / 崂山校区·北海苑 / 鱼山校区·学生公寓 / 浮山校区 / 西海岸校区 |
| sellerName | string | 可选，缺省「校园用户0823」 |
| sellerId | string | 可选，缺省 u_self |
| coverColor | string | 可选，#rrggbb 形式；缺省按 id 从 12 色板里挑 |
| coverImage | string | 可选，缺省 null |
| status / views / createdAt | — | 可选；缺省 on / 0 / 服务端当前毫秒时间戳 |

请求：

```http
POST /api/items HTTP/1.1
Content-Type: application/json

{"title":"台灯 护眼 LED","desc":"用了半年，光很柔和","price":45,"category":"生活用品","condition":"轻微使用痕迹","campus":"崂山校区·南海苑"}
```

响应 201（真实返回）：

```json
{
  "item": {
    "id": "i_cef265e3-ac26-478f-9078-6abec9fa55db",
    "title": "台灯 护眼 LED",
    "desc": "用了半年，光很柔和",
    "price": 45,
    "category": "生活用品",
    "condition": "轻微使用痕迹",
    "campus": "崂山校区·南海苑",
    "sellerName": "校园用户0823",
    "sellerId": "u_self",
    "coverColor": "#a7f3d0",
    "coverImage": null,
    "createdAt": 1793428924223,
    "status": "on",
    "views": 0
  }
}
```

校验失败 400（真实返回）：

```http
POST /api/items HTTP/1.1
Content-Type: application/json

{"title":"x","price":-5,"category":"生活用品","condition":"全新","campus":"浮山校区"}
```

```json
{"error":"VALIDATION","fields":{"price":"必须大于 0"}}
```

fields 里每个键对应出错字段，可能同时出现多个，例如：

```json
{"error":"VALIDATION","fields":{"title":"标题不能为空","price":"必须大于 0","category":"分类不在允许范围内","condition":"成色不在允许范围内","campus":"校区不在允许范围内"}}
```

价格相关的三种提示：```必须是数字``` / ```必须大于 0``` / ```不能超过 99999```。

## 5. PATCH /api/items/:id

只更新请求体里出现的字段，允许改：```title desc price category condition campus status views coverColor coverImage sellerName```。

下架某个商品：

```http
PATCH /api/items/i_cef265e3-ac26-478f-9078-6abec9fa55db HTTP/1.1
Content-Type: application/json

{"status":"off"}
```

响应 200：

```json
{"item":{"id":"i_cef265e3-ac26-478f-9078-6abec9fa55db","title":"台灯 护眼 LED","price":45,"status":"off","views":0,"createdAt":1793428924223}}
```

（上面为节选，完整响应包含全部字段。）

加浏览量：

```http
PATCH /api/items/i_001 HTTP/1.1
Content-Type: application/json

{"views":47}
```

id 不存在返回 404 ```{"error":"NOT_FOUND"}```；字段非法返回 400 ```{"error":"VALIDATION","fields":{...}}```，此时不会改动任何字段。

## 6. DELETE /api/items/:id

```http
DELETE /api/items/i_client_abc123 HTTP/1.1
```

成功：```204 No Content```，无响应体（Content-Type 也不带）。该商品名下的私信会一起删除。
不存在：404 ```{"error":"NOT_FOUND"}```。

## 7. GET /api/messages/:itemId

```http
GET /api/messages/i_cef265e3-ac26-478f-9078-6abec9fa55db HTTP/1.1
```

响应 200（真实返回）：

```json
{
  "messages": [
    {
      "id": "m_c30e9e31-cef3-4e71-a1c1-83ed363cc605",
      "itemId": "i_cef265e3-ac26-478f-9078-6abec9fa55db",
      "from": "me",
      "text": "同学你好，台灯还在吗？",
      "createdAt": 1793428924241
    }
  ]
}
```

没有私信时返回 ```{"messages":[]}```（200，不报 404）。

## 8. POST /api/messages/:itemId

请求体：```text``` 必填（非空，≤ 300 字）；```from``` 只能是 ```me``` / ```seller```，缺省 ```me```；```id``` 可选（客户端自带则直接用）。

```http
POST /api/messages/i_cef265e3-ac26-478f-9078-6abec9fa55db HTTP/1.1
Content-Type: application/json

{"from":"me","text":"同学你好，台灯还在吗？"}
```

响应 201（真实返回）：

```json
{
  "message": {
    "id": "m_c30e9e31-cef3-4e71-a1c1-83ed363cc605",
    "itemId": "i_cef265e3-ac26-478f-9078-6abec9fa55db",
    "from": "me",
    "text": "同学你好，台灯还在吗？",
    "createdAt": 1793428924241
  }
}
```

校验失败 400：

```json
{"error":"VALIDATION","fields":{"text":"私信内容不能为空"}}
```

商品不存在也走 400，指到 ```itemId```：

```json
{"error":"VALIDATION","fields":{"itemId":"商品不存在"}}
```

## 9. GET /api/users/:sellerId

卖家信息来自「商品里出现过的 sellerId」，另有一个演示用户 ```u_self```。

```http
GET /api/users/u_1001 HTTP/1.1
```

响应 200（真实返回）：

```json
{"user":{"id":"u_1001","name":"李同学","campus":"崂山校区·南海苑","verified":true,"itemsCount":1}}
```

```u_self``` 在校验通过后会带上真实姓名与学号（真实返回，节选）：

```json
{"user":{"id":"u_self","name":"校园用户0823","campus":"崂山校区·南海苑","verified":true,"studentId":"220100010823","realName":"张三","itemsCount":3}}
```

不存在：404 ```{"error":"NOT_FOUND"}```。

## 10. POST /api/verify

请求体：```studentId```（12 位数字）+ ```realName```（至少 2 个字）。

失败 400（真实返回，学号 11 位）：

```http
POST /api/verify HTTP/1.1
Content-Type: application/json

{"studentId":"22010001082","realName":"张三"}
```

```json
{"ok":false,"fields":{"studentId":"学号必须为 12 位数字"}}
```

成功 200（真实返回）：

```http
POST /api/verify HTTP/1.1
Content-Type: application/json

{"studentId":"220100010823","realName":"张三"}
```

```json
{"ok":true,"user":{"id":"u_self","name":"校园用户0823","campus":"崂山校区·南海苑","verified":true,"studentId":"220100010823","realName":"张三","itemsCount":3}}
```

姓名不足 2 个字时：```{"ok":false,"fields":{"realName":"请填写真实姓名（至少 2 个字）"}}```。

## 11. OPTIONS 预检

```http
OPTIONS /api/items HTTP/1.1
```

响应 ```204```，无响应体，响应头（真实返回）：

```text
access-control-allow-origin: *
access-control-allow-methods: GET,POST,PATCH,DELETE,OPTIONS
access-control-allow-headers: Content-Type
```

## 12. 静态资源

服务同时托管 ```../web``` 目录，前端与 API 同源，正常演示直接访问 ```http://localhost:3000```。

| 请求 | 结果 |
|---|---|
| ```GET /``` | 200，```web/index.html```（content-type: text/html; charset=utf-8） |
| ```GET /js/app.js```、```/css/style.css```、```/data/seed.js``` | 200，按扩展名给 content-type |
| ```GET /mypage``` 等非文件路径 | 200，回落到 index.html（前端是 hash 路由） |
| ```GET /../server/store.js``` | 403 ```{"error":"FORBIDDEN"}``` |

目录穿越是显式拒绝的：路径里只要出现 ```..``` 段就返回 403（在 URL 规范化之前判断，避免 ```/../``` 被折叠成合法路径），
```/..%2f..%2fserver/store.js``` 这类编码形式同样 403。
