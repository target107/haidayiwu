/**
 * 海大易物 · HTTP 服务
 * 只用 Node 内置模块（http / fs / path / url），不依赖任何第三方包。
 * 职责：路由分发、CORS、请求体解析与限额、静态托管（../web）、错误处理。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('./store');

const VERSION = 'v0.9.2';
const PORT = Number(process.env.PORT) || 3000;
const WEB_ROOT = path.resolve(__dirname, '..', 'web');
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
    'Access-Control-Allow-Headers': 'Content-Type'
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

async function handleVerify(req, res) {
  const parsed = await readJsonBody(req);
  if (replyBodyError(res, parsed)) return;

  const result = store.verifyStudent(parsed.body);
  if (result.fields) return sendJson(res, 400, { ok: false, fields: result.fields });
  return sendJson(res, 200, { ok: true, user: result.user });
}

/** API 路由分发：/api/health、/api/items、/api/messages、/api/users、/api/verify。 */
async function handleApi(req, res, pathname) {
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

  return noRoute();
}

// ---------- 静态托管 ----------

/**
 * 托管 ../web 目录；非文件路径回落到 index.html，并拦截目录穿越。
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
  let pathname;
  try {
    pathname = new URL(req.url, 'http://' + (req.headers.host || 'localhost')).pathname;
  } catch (err) {
    return sendJson(res, 400, { error: 'BAD_REQUEST' });
  }

  // OPTIONS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  // 原始路径（未规范化）；绝对形式的请求行直接用上面解析出的 pathname
  const rawUrl = req.url || '/';
  const rawPath = rawUrl.indexOf('://') > 0 ? pathname : rawUrl.split('?')[0].split('#')[0];

  if (pathname === '/api' || pathname.indexOf('/api/') === 0) {
    return handleApi(req, res, pathname);
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
