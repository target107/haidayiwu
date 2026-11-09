/**
 * 海大易物 · HTTP 服务
 * 只用 Node 内置模块（http / fs / path / url），不依赖任何第三方包。
 * 职责：路由分发、CORS、请求体解析与限额、静态托管（../admin，网页管理后台，Beta 阶段落地）、错误处理。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const store = require('./store');

const VERSION = 'v0.9.2';
const PORT = Number(process.env.PORT) || 3000;
// 静态托管目录：Beta 阶段的网页管理后台。目录不存在时只影响 GET /，/api/* 全部正常。
const WEB_ROOT = path.resolve(__dirname, '..', 'admin');
const MAX_BODY = 1024 * 1024; // 请求体上限 1MB

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

// ---------- 响应助手 ----------

/** 所有响应都带这三个 CORS 头。 */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    // x-admin-token 是网页管理后台带的管理员令牌，必须列进来，否则跨端口调试时预检会被浏览器拦下
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-token'
  };
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    ...corsHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendBuffer(res, status, buffer, type) {
  res.writeHead(status, {
    ...corsHeaders(),
    'Content-Type': type,
    'Content-Length': buffer.length
  });
  res.end(buffer);
}

/** 读请求体并按 JSON 解析；超过 1MB 或格式非法时返回错误码给调用方。 */
function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        settled = true;
        resolve({ error: 'TOO_LARGE' });
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text === '') return resolve({ error: 'BAD_JSON' });
      try {
        resolve({ body: JSON.parse(text) });
      } catch (err) {
        resolve({ error: 'BAD_JSON' });
      }
    });

    req.on('error', () => {
      if (settled) return;
      settled = true;
      resolve({ error: 'BAD_JSON' });
    });
  });
}

/** 统一处理请求体错误：413 / 400 BAD_JSON。返回 true 表示已经响应过。 */
function replyBodyError(res, parsed) {
  if (parsed.error === 'TOO_LARGE') {
    sendJson(res, 413, { error: 'PAYLOAD_TOO_LARGE', message: '请求体不能超过 1MB' });
    return true;
  }
  if (parsed.error) {
    sendJson(res, 400, { error: 'BAD_JSON' });
    return true;
  }
  return false;
}

// ---------- 管理员令牌 ----------
// 管理员账号写死在服务端：adminId 固定为 haidayiwu2026，adminName 只做记录用途（谁处理的举报）。
// token 存在内存 Map 里，进程重启即全部失效，需要重新登录；不落盘，也不下发任何密码。

const ADMIN_ID = 'haidayiwu2026';
const adminTokens = new Map(); // token -> { adminId, adminName, createdAt }

function issueAdminToken(adminName) {
  const token = crypto.randomBytes(16).toString('hex');
  adminTokens.set(token, { adminId: ADMIN_ID, adminName, createdAt: Date.now() });
  return token;
}

// ---------- 用户令牌 ----------
// 登录成功后发的普通用户 token，与上面的管理员 token 完全分开（两张 Map、互不承认）。
// 同样只存在内存里，进程重启即失效；本版只做「登录成功」的凭据，商品写入鉴权还没接上。

const userTokens = new Map(); // token -> { accountId, createdAt }

function issueUserToken(accountId) {
  const token = crypto.randomBytes(16).toString('hex');
  userTokens.set(token, { accountId, createdAt: Date.now() });
  return token;
}

/** 从请求头 x-admin-token 取管理员身份；缺失或无效一律返回 null，由调用方回 401。 */
function readAdmin(req) {
  const token = String(req.headers['x-admin-token'] || '').trim();
  if (!token) return null;
  return adminTokens.get(token) || null;
}

/** 校验管理员身份；不通过时已经写过 401 响应，调用方直接 return 即可。 */
function requireAdmin(req, res) {
  const admin = readAdmin(req);
  if (!admin) sendJson(res, 401, { error: 'UNAUTHORIZED' });
  return admin;
}

// ---------- API ----------

async function handleCreateItem(req, res) {
  const parsed = await readJsonBody(req);
  if (replyBodyError(res, parsed)) return;

  const result = store.createItem(parsed.body);
  if (result.error === 'VALIDATION') return sendJson(res, 400, { error: 'VALIDATION', fields: result.fields });
  if (result.error === 'ID_CONFLICT') return sendJson(res, 409, { error: 'ID_CONFLICT', message: '该 id 已存在' });
  return sendJson(res, 201, { item: result.item });
}

async function handlePatchItem(req, res, id) {
  const parsed = await readJsonBody(req);
  if (replyBodyError(res, parsed)) return;

  const result = store.updateItem(id, parsed.body);
  if (result.error === 'NOT_FOUND') return sendJson(res, 404, { error: 'NOT_FOUND' });
  if (result.error === 'VALIDATION') return sendJson(res, 400, { error: 'VALIDATION', fields: result.fields });
  return sendJson(res, 200, { item: result.item });
}

async function handleCreateMessage(req, res, itemId) {
  const parsed = await readJsonBody(req);
  if (replyBodyError(res, parsed)) return;

  const result = store.createMessage(itemId, parsed.body);
  if (result.error === 'VALIDATION') return sendJson(res, 400, { error: 'VALIDATION', fields: result.fields });
  if (result.error === 'ID_CONFLICT') return sendJson(res, 409, { error: 'ID_CONFLICT', message: '该 id 已存在' });
  return sendJson(res, 201, { message: result.message });
}

async function handleCreateConversationMessage(req, res, itemId, buyerId) {
  const parsed = await readJsonBody(req);
  if (replyBodyError(res, parsed)) return;

  const result = store.appendConversationMessage(itemId, buyerId, parsed.body);
  if (result.error === 'VALIDATION') return sendJson(res, 400, { error: 'VALIDATION', fields: result.fields });
  return sendJson(res, 201, { conversation: result.conversation });
}

async function handleMarkConversationRead(req, res, itemId, buyerId) {
  const parsed = await readJsonBody(req);
  if (replyBodyError(res, parsed)) return;

  const body = parsed.body && typeof parsed.body === 'object' ? parsed.body : {};
  const result = store.markConversationReadBy(itemId, buyerId, body.userId);
  if (result.error === 'VALIDATION') return sendJson(res, 400, { error: 'VALIDATION', fields: result.fields });
  if (result.error === 'NOT_FOUND') return sendJson(res, 404, { error: 'NOT_FOUND' });
  return sendJson(res, 200, { conversation: result.conversation });
}

async function handleToggleFavorite(req, res) {
  const parsed = await readJsonBody(req);
  if (replyBodyError(res, parsed)) return;

  const body = parsed.body && typeof parsed.body === 'object' ? parsed.body : {};
  const result = store.toggleFavoriteFor(body.userId, body.itemId);
  if (result.error === 'VALIDATION') return sendJson(res, 400, { error: 'VALIDATION', fields: result.fields });
  return sendJson(res, 200, { favorited: result.favorited, itemIds: result.itemIds });
}

async function handleAddHistory(req, res) {
  const parsed = await readJsonBody(req);
  if (replyBodyError(res, parsed)) return;

  const body = parsed.body && typeof parsed.body === 'object' ? parsed.body : {};
  const result = store.addHistoryFor(body.userId, body.itemId);
  if (result.error === 'VALIDATION') return sendJson(res, 400, { error: 'VALIDATION', fields: result.fields });
  return sendJson(res, 201, { entries: result.entries });
}

async function handleVerify(req, res) {
  const parsed = await readJsonBody(req);
  if (replyBodyError(res, parsed)) return;

  const result = store.verifyStudent(parsed.body);
  if (result.fields) return sendJson(res, 400, { ok: false, fields: result.fields });
  return sendJson(res, 200, { ok: true, user: result.user });
}

// ---------- 账号：注册 / 登录 / 脱敏列表 ----------
// 规则全部在 store.js 里（与前端本地校验逐条对齐），这里只负责状态码映射：
//   注册 201 { user } / 400 { error:'VALIDATION', fields } / 409 { error:'STUDENT_ID_EXISTS' }
//   登录 200 { token, user } / 401 { error:'INVALID_CREDENTIALS' }
//   列表 200 { accounts }

async function handleAccountRegister(req, res) {
  const parsed = await readJsonBody(req);
  if (replyBodyError(res, parsed)) return;

  const result = store.createAccount(parsed.body);
  if (result.error === 'VALIDATION') return sendJson(res, 400, { error: 'VALIDATION', fields: result.fields });
  if (result.error === 'STUDENT_ID_EXISTS') {
    return sendJson(res, 409, { error: 'STUDENT_ID_EXISTS', message: '该学号已注册，请直接登录' });
  }
  return sendJson(res, 201, { user: result.account });
}

async function handleAccountLogin(req, res) {
  const parsed = await readJsonBody(req);
  if (replyBodyError(res, parsed)) return;

  const body = parsed.body && typeof parsed.body === 'object' ? parsed.body : {};
  const account = store.verifyAccount(body.studentId, body.password);

  // 「学号不存在」与「密码不正确」返回完全相同的 401 响应体：不得泄露学号是否已注册。
  if (!account) {
    return sendJson(res, 401, {
      error: 'INVALID_CREDENTIALS',
      message: '学号或密码不正确，请核对后重试'
    });
  }
  const token = issueUserToken(account.id);
  return sendJson(res, 200, { token, user: account });
}

function handleListAccounts(res) {
  return sendJson(res, 200, { accounts: store.listAccountsPublic() });
}

// ---------- 评论 / 举报 / 评价 / 管理员 处理器 ----------
// 说明：评论与举报不校验商品是否存在于服务端（store.js 里有详细原因），
// 所以这几个处理器里没有 itemId 存在性判断，只有字段校验。

async function handleCreateComment(req, res) {
  const parsed = await readJsonBody(req);
  if (replyBodyError(res, parsed)) return;

  const result = store.createComment(parsed.body);
  if (result.error === 'VALIDATION') return sendJson(res, 400, { error: 'VALIDATION', fields: result.fields });
  if (result.error === 'ID_CONFLICT') return sendJson(res, 409, { error: 'ID_CONFLICT', message: '该 id 已存在' });
  return sendJson(res, 201, { comment: result.comment });
}

async function handleCreateReport(req, res) {
  const parsed = await readJsonBody(req);
  if (replyBodyError(res, parsed)) return;

  const result = store.createReport(parsed.body);
  if (result.error === 'VALIDATION') return sendJson(res, 400, { error: 'VALIDATION', fields: result.fields });
  if (result.error === 'ID_CONFLICT') return sendJson(res, 409, { error: 'ID_CONFLICT', message: '该 id 已存在' });
  return sendJson(res, 201, { report: result.report });
}

/** PATCH /api/reports/:id：只接受 { status:'handled' }，处理人取自管理员 token。 */
async function handlePatchReport(req, res, id, admin) {
  const parsed = await readJsonBody(req);
  if (replyBodyError(res, parsed)) return;

  const body = parsed.body && typeof parsed.body === 'object' ? parsed.body : {};
  const result = store.handleReport(id, body.status, admin.adminName);
  if (result.error === 'NOT_FOUND') return sendJson(res, 404, { error: 'NOT_FOUND' });
  if (result.error === 'VALIDATION') return sendJson(res, 400, { error: 'VALIDATION', fields: result.fields });
  return sendJson(res, 200, { report: result.report });
}

async function handleCreateRating(req, res) {
  const parsed = await readJsonBody(req);
  if (replyBodyError(res, parsed)) return;

  const result = store.createRating(parsed.body);
  if (result.error === 'ALREADY_RATED') {
    return sendJson(res, 409, { error: 'ALREADY_RATED', message: '你已经评价过了' });
  }
  if (result.error === 'VALIDATION') return sendJson(res, 400, { error: 'VALIDATION', fields: result.fields });
  if (result.error === 'ID_CONFLICT') return sendJson(res, 409, { error: 'ID_CONFLICT', message: '该 id 已存在' });
  return sendJson(res, 201, { rating: result.rating });
}

async function handleAdminLogin(req, res) {
  const parsed = await readJsonBody(req);
  if (replyBodyError(res, parsed)) return;

  const body = parsed.body && typeof parsed.body === 'object' ? parsed.body : {};
  const adminId = typeof body.adminId === 'string' ? body.adminId.trim() : '';
  const adminName = typeof body.adminName === 'string' ? body.adminName.trim() : '';

  const fields = {};
  if (!adminId) fields.adminId = '管理员 ID 不能为空';
  else if (adminId !== ADMIN_ID) fields.adminId = '管理员 ID 不正确';
  if (!adminName) fields.adminName = '管理员姓名不能为空';
  if (Object.keys(fields).length) return sendJson(res, 400, { error: 'VALIDATION', fields });

  const token = issueAdminToken(adminName);
  return sendJson(res, 200, { token, adminName });
}

/** 204 是个空响应体，DELETE 软删统一走这里。 */
function sendNoContent(res) {
  res.writeHead(204, corsHeaders());
  return res.end();
}

/**
 * API 路由分发。
 * 既有：/api/health、/api/items、/api/messages、/api/users、/api/verify
 * 新增：/api/comments、/api/reports、/api/ratings、/api/admin/*
 * parsedUrl 是整个 URL 对象（不再只传 pathname）：?itemId= / ?status= / ?userId= 都要读查询串。
 */
async function handleApi(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.searchParams;
  const seg = pathname.split('/').filter((one) => one !== '');
  const method = req.method;
  const resource = seg[1] || '';
  let id = seg[2];
  if (id !== undefined) {
    try {
      id = decodeURIComponent(id);
    } catch (err) {
      return sendJson(res, 400, { error: 'BAD_PATH' });
    }
  }
  const noRoute = () => sendJson(res, 404, { error: 'NO_ROUTE' });
  const methodNotAllowed = () => sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });

  // GET /api/health
  if (seg.length === 2 && resource === 'health') {
    if (method !== 'GET') return methodNotAllowed();
    return sendJson(res, 200, { ok: true, version: VERSION, db: 'db.json', items: store.countItems() });
  }

  // /api/items
  if (resource === 'items') {
    if (seg.length === 2) {
      if (method === 'GET') return sendJson(res, 200, { items: store.listItems() });
      if (method === 'POST') return handleCreateItem(req, res);
      return methodNotAllowed();
    }
    if (seg.length === 3) {
      if (method === 'GET') {
        const result = store.getItem(id);
        return result.error ? sendJson(res, 404, { error: result.error }) : sendJson(res, 200, { item: result.item });
      }
      if (method === 'PATCH') return handlePatchItem(req, res, id);
      if (method === 'DELETE') {
        const result = store.deleteItem(id);
        if (result.error) return sendJson(res, 404, { error: result.error });
        res.writeHead(204, corsHeaders());
        return res.end();
      }
      return methodNotAllowed();
    }
    return noRoute();
  }

  // /api/messages/:itemId
  if (resource === 'messages' && seg.length === 3) {
    if (method === 'GET') return sendJson(res, 200, { messages: store.listMessages(id) });
    if (method === 'POST') return handleCreateMessage(req, res, id);
    return methodNotAllowed();
  }

  // /api/users/:sellerId
  if (resource === 'users' && seg.length === 3) {
    if (method !== 'GET') return methodNotAllowed();
    const result = store.getUser(id);
    return result.error ? sendJson(res, 404, { error: result.error }) : sendJson(res, 200, { user: result.user });
  }

  // /api/verify
  if (resource === 'verify' && seg.length === 2) {
    if (method !== 'POST') return methodNotAllowed();
    return handleVerify(req, res);
  }

  // /api/accounts：GET 脱敏列表；POST /register、POST /login
  if (resource === 'accounts') {
    if (seg.length === 2) {
      if (method !== 'GET') return methodNotAllowed();
      return handleListAccounts(res);
    }
    if (seg.length === 3) {
      if (method !== 'POST') return methodNotAllowed();
      if (id === 'register') return handleAccountRegister(req, res);
      if (id === 'login') return handleAccountLogin(req, res);
    }
    return noRoute();
  }

  // /api/comments
  if (resource === 'comments') {
    if (seg.length === 2) {
      if (method === 'GET') return sendJson(res, 200, { comments: store.listComments(query.get('itemId') || '') });
      if (method === 'POST') return handleCreateComment(req, res);
      return methodNotAllowed();
    }
    if (seg.length === 3) {
      if (method !== 'DELETE') return methodNotAllowed();
      const result = store.deleteComment(id);
      if (result.error) return sendJson(res, 404, { error: result.error });
      return sendNoContent(res);
    }
    return noRoute();
  }

  // /api/reports
  if (resource === 'reports') {
    if (seg.length === 2) {
      if (method === 'GET') return sendJson(res, 200, { reports: store.listReports(query.get('status') || '') });
      if (method === 'POST') return handleCreateReport(req, res);
      return methodNotAllowed();
    }
    if (seg.length === 3) {
      if (method !== 'PATCH') return methodNotAllowed();
      const admin = requireAdmin(req, res);
      if (!admin) return;
      return handlePatchReport(req, res, id, admin);
    }
    return noRoute();
  }

  // /api/ratings
  if (resource === 'ratings') {
    if (seg.length === 2) {
      if (method === 'GET') return sendJson(res, 200, store.listRatings(query.get('userId') || ''));
      if (method === 'POST') return handleCreateRating(req, res);
      return methodNotAllowed();
    }
    if (seg.length === 3) {
      if (method !== 'DELETE') return methodNotAllowed();
      const admin = requireAdmin(req, res);
      if (!admin) return;
      const result = store.deleteRating(id);
      if (result.error) return sendJson(res, 404, { error: result.error });
      return sendNoContent(res);
    }
    return noRoute();
  }

  // /api/conversations
  //   GET   /api/conversations?userId=xxx         我的会话列表
  //   GET   /api/conversations/:itemId/:buyerId   单条会话（不存在 404）
  //   POST  /api/conversations/:itemId/:buyerId/messages  发私信（会话懒创建，201）
  //   PATCH /api/conversations/:itemId/:buyerId/read      标记已读
  if (resource === 'conversations') {
    if (seg.length === 2) {
      if (method !== 'GET') return methodNotAllowed();
      return sendJson(res, 200, { conversations: store.listConversationsByUser(query.get('userId') || '') });
    }
    if (seg.length >= 4) {
      let conversationBuyerId;
      try {
        conversationBuyerId = decodeURIComponent(seg[3]);
      } catch (err) {
        return sendJson(res, 400, { error: 'BAD_PATH' });
      }
      if (seg.length === 4) {
        if (method !== 'GET') return methodNotAllowed();
        const conversation = store.readConversationEntry(id, conversationBuyerId);
        return conversation
          ? sendJson(res, 200, { conversation: conversation })
          : sendJson(res, 404, { error: 'NOT_FOUND' });
      }
      if (seg.length === 5) {
        const action = seg[4];
        if (action === 'messages') {
          if (method !== 'POST') return methodNotAllowed();
          return handleCreateConversationMessage(req, res, id, conversationBuyerId);
        }
        if (action === 'read') {
          if (method !== 'PATCH') return methodNotAllowed();
          return handleMarkConversationRead(req, res, id, conversationBuyerId);
        }
      }
    }
    return noRoute();
  }

  // /api/favorites：GET ?userId= → { itemIds }；POST { userId, itemId } → { favorited, itemIds }
  if (resource === 'favorites') {
    if (seg.length !== 2) return noRoute();
    if (method === 'GET') return sendJson(res, 200, { itemIds: store.listFavoriteIds(query.get('userId') || '') });
    if (method === 'POST') return handleToggleFavorite(req, res);
    return methodNotAllowed();
  }

  // /api/history：GET ?userId= → { entries }；POST { userId, itemId } → 201 { entries }；DELETE ?userId= → 204
  if (resource === 'history') {
    if (seg.length !== 2) return noRoute();
    if (method === 'GET') return sendJson(res, 200, { entries: store.listHistoryEntries(query.get('userId') || '') });
    if (method === 'POST') return handleAddHistory(req, res);
    if (method === 'DELETE') {
      const result = store.clearHistoryFor(query.get('userId') || '');
      if (result.error === 'VALIDATION') return sendJson(res, 400, { error: 'VALIDATION', fields: result.fields });
      return sendNoContent(res);
    }
    return methodNotAllowed();
  }

  // /api/admin/*：login 不需要 token，其余四个都要
  if (resource === 'admin' && seg.length === 3) {
    const action = id;
    if (action === 'login') {
      if (method !== 'POST') return methodNotAllowed();
      return handleAdminLogin(req, res);
    }
    if (method !== 'GET') return methodNotAllowed();
    const admin = requireAdmin(req, res);
    if (!admin) return;
    if (action === 'stats') return sendJson(res, 200, store.adminStats());
    if (action === 'items') return sendJson(res, 200, { items: store.listItems() });
    if (action === 'reports') return sendJson(res, 200, { reports: store.listReports('') });
    return noRoute();
  }

  return noRoute();
}

// ---------- 静态托管 ----------

/**
 * 托管 ../admin 目录；非文件路径回落到 index.html，并拦截目录穿越。目录不存在时返回 404，不影响 /api/*。
 * rawPath 是未经 URL 规范化的原始路径：WHATWG URL 会把 /../ 折叠掉，
 * 所以必须在规范化之前先检查一遍，否则穿越请求会被悄悄改写成合法路径。
 */
function serveStatic(req, res, rawPath, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  }

  if (rawPath.split(/[\\/]+/).indexOf('..') !== -1) {
    return sendJson(res, 403, { error: 'FORBIDDEN' });
  }

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (err) {
    return sendJson(res, 400, { error: 'BAD_PATH' });
  }
  if (decoded.indexOf('\0') !== -1) return sendJson(res, 400, { error: 'BAD_PATH' });

  // 目录穿越：只要路径里出现 .. 段，直接拒绝，不进入文件系统
  const segments = decoded.split(/[\\/]+/);
  if (segments.indexOf('..') !== -1) return sendJson(res, 403, { error: 'FORBIDDEN' });

  // 把请求路径拼到 web 根目录下，并二次确认结果仍在 web 目录内
  const target = path.resolve(WEB_ROOT, '.' + path.posix.normalize('/' + decoded));
  if (target !== WEB_ROOT && target.indexOf(WEB_ROOT + path.sep) !== 0) {
    return sendJson(res, 403, { error: 'FORBIDDEN' });
  }

  const indexPath = path.join(WEB_ROOT, 'index.html');

  // 是目录或用例里不存在的文件路径 -> 回落到 index.html（前端用 hash 路由）
  let filePath = target;
  let stat = null;
  try {
    stat = fs.statSync(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch (err) {
    filePath = indexPath;
  }

  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    // 连 index.html 都读不到，说明 web 目录没放对
    return sendJson(res, 500, { error: 'WEB_ROOT_MISSING', message: '找不到前端目录或 index.html：' + WEB_ROOT });
  }

  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  return sendBuffer(res, 200, buffer, type);
}

// ---------- 主流程 ----------

async function handleRequest(req, res) {
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  } catch (err) {
    return sendJson(res, 400, { error: 'BAD_REQUEST' });
  }
  const pathname = parsedUrl.pathname;

  // OPTIONS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  // 原始路径（未规范化）；绝对形式的请求行直接用上面解析出的 pathname
  const rawUrl = req.url || '/';
  const rawPath = rawUrl.indexOf('://') > 0 ? pathname : rawUrl.split('?')[0].split('#')[0];

  if (pathname === '/api' || pathname.indexOf('/api/') === 0) {
    return handleApi(req, res, parsedUrl);
  }
  return serveStatic(req, res, rawPath, pathname);
}

let boot;
try {
  boot = store.loadDb();
} catch (err) {
  console.error('[海大易物] 数据初始化失败：' + err.message);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[海大易物] 处理请求出错：', err);
    if (!res.headersSent) sendJson(res, 500, { error: 'INTERNAL_ERROR' });
    else res.end();
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('[海大易物] 端口 ' + PORT + ' 已被占用，服务未能启动。');
    console.error('  换个端口再试：PowerShell  $env:PORT=3001; node server.js');
    console.error('                cmd        set PORT=3001 && node server.js');
    console.error('  或先关掉占用该端口的进程：Get-NetTCPConnection -LocalPort ' + PORT);
    process.exit(1);
  }
  console.error('[海大易物] 服务启动失败：' + err.message);
  process.exit(1);
});

// 列出可用的局域网 IPv4，方便手机直接访问（过滤掉虚拟网卡）
const VIRTUAL_HINTS = ['vmware', 'vethernet', 'virtualbox', 'hyper-v', 'radmin', 'tailscale', 'loopback', 'vpn'];
function listLanAddresses() {
  const real = [];
  const all = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((net) => {
      if (net.family !== 'IPv4' || net.internal) return;
      const entry = { name: name, address: net.address };
      all.push(entry);
      if (!VIRTUAL_HINTS.some((hint) => name.toLowerCase().indexOf(hint) !== -1)) real.push(entry);
    });
  });
  return real.length ? real : all;
}

server.listen(PORT, () => {
  console.log('[海大易物] API 服务已启动：http://localhost:' + PORT);
  const lan = listLanAddresses();
  if (lan.length) {
    console.log('  手机访问  （手机需与本机连同一个 Wi-Fi）');
    lan.forEach((net) => {
      console.log('            http://' + net.address + ':' + PORT + '    [' + net.name + ']');
    });
  }
  console.log('  版本      ' + VERSION);
  console.log('  接口前缀  /api');
  console.log('  静态目录  ' + WEB_ROOT);
  console.log('  数据文件  ' + store.DB_FILE + (boot.initialized ? '（本次由 seed.json 初始化）' : ''));
  console.log('  商品条数  ' + boot.items);
  console.log('  健康检查  GET /api/health');
});

// Ctrl+C 时正常退出
process.on('SIGINT', () => {
  console.log('\n[海大易物] 已停止服务。');
  server.close(() => process.exit(0));
});
