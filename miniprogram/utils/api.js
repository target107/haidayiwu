/**
 * 海大易物 · 数据层（小程序版）
 *
 * 一套 Promise 接口，两种实现，页面代码完全不用改：
 *
 *   mode: 'local' —— 默认。数据放在 wx.getStorageSync / wx.setStorageSync 里，
 *                    第一次读的时候用 data/seed.js 初始化 12 条商品。
 *                    不启后端也能在微信开发者工具里跑完整流程（登录 / 发布 / 上下架 / 收藏 / 私信）。
 *
 *   mode: 'http'  —— 用 wx.request 打 server/（零依赖 Node REST 服务，默认 http://127.0.0.1:3000）。
 *                    接口契约见 server/api.md：
 *                      GET    /api/items          全部商品
 *                      GET    /api/items/:id      单个商品
 *                      POST   /api/items          新建商品
 *                      PATCH  /api/items/:id      局部更新（上下架）
 *                      GET    /api/messages/:itemId
 *                      POST   /api/messages/:itemId
 *                      GET    /api/health         健康检查
 *                    切过去之后必须在微信开发者工具里勾选
 *                    「详情 → 本地设置 → 不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」，
 *                    否则 127.0.0.1:3000 会被域名校验直接拦掉。
 *
 * 将来接云开发：只要再加一个 mode: 'cloud' 分支（云函数里调同样的方法名），
 * 把下面的 localDriver / httpDriver 并列着再写一个 driver 就够了，pages/ 里的页面一行都不用动。
 *
 * 收藏 / 私信会话 / 浏览记录现在也在后端（favorites / conversations / historyEntries 三张表）：
 *   GET/POST /api/favorites、GET/POST /api/conversations（+ /messages、/read）、GET/POST/DELETE /api/history。
 * 后端没启动时这几个方法一律降级：读操作 resolve 空值，写操作 reject 交给页面的 toast，
 * 都不会抛出未捕获异常。
 *
 * 账号体系已迁到后端（见 server/store.js 的 accounts 表）：
 *   登录 POST /api/accounts/login、注册 POST /api/accounts/register、列表 GET /api/accounts，
 *   密码只在服务端以 scrypt + 每账号独立 salt 哈希保存，前端不再持有任何密码。
 *
 * 但「是否已登录」仍然是本地缓存：登录成功后把 user 写进 haidayiwu.v1.user，
 * readMe() / isLoggedIn() / getMe() 读的还是这个键，所以 pages/ 里的页面一行都没改。
 * 本地账号表（haidayiwu.v1.accounts）降级为登录态缓存——readMe() 只认「能按 id 在本地账号表里
 * 查到」的用户，所以登录 / 注册成功后要把服务端账号同步进去，但它的密码字段不再参与任何校验。
 */

const SEED_ITEMS = require('../data/seed.js');

const CONFIG = {
  mode: 'http',                       // 'local' | 'http'；当前为 http：商品数据全部来自 server/
  // ↓ 换网络（换热点）时只改这一行：取 server 启动日志里「手机访问」那行地址
  baseUrl: 'http://192.168.181.67:3000'    // mode 为 http 时使用；这是本机 Wi-Fi 的局域网地址，真机与开发者工具都连它
};

const KEY = {
  items: 'haidayiwu.v1.items',
  favorites: 'haidayiwu.v1.favorites',
  user: 'haidayiwu.v1.user',          // 登录态缓存：readMe() 只读这一项
  token: 'haidayiwu.v1.token',        // 登录成功后服务端下发的普通用户 token（本版只保存，未用于鉴权）
  accounts: 'haidayiwu.v1.accounts',
  chatPrefix: 'haidayiwu.v1.chat.',
  historyPrefix: 'haidayiwu.v1.history.'
};

// 校区列表：发布页选择器、种子数据、页面展示都用这一份，不在各处再抄一遍
const CAMPUSES = [
  '崂山校区·南海苑',
  '崂山校区·东海苑',
  '崂山校区·北海苑',
  '鱼山校区·学生公寓',
  '浮山校区',
  '西海岸校区·听海苑',
  '西海岸校区·望海苑'
];

// 内置账号表：现在已经不在前端做任何登录校验，只作为两处参照保留——
//   1. server/store.js 的 SEED_ACCOUNTS 与这里逐条对齐（学号 / 姓名 / 昵称 / 校区完全一致），
//      这样密码改到服务端哈希之后，老用户仍然用原来的学号密码登录；
//   2. 本地账号表（haidayiwu.v1.accounts）被清空时用它兜底初始化，readMe() 才不会把已登录用户判成未登录。
// 这里的 password 字段前端不再读取，服务端的密码只有 scrypt 哈希。
const SEED_ACCOUNT_CREATED_AT = 1735660800000;   // 预置账号的 createdAt 固定，便于复现和排查
// 这六个账号的密码在服务端（server/store.js 的 SEED_ACCOUNT_PASSWORD，仍是 123456，只以 scrypt 哈希形式落盘），
// 本文件不再保存任何明文密码：password 字段固定为空字符串，前端也不再用它做任何比对。
const DEFAULT_ACCOUNTS = [
  { id: 'u_zhangsan', studentId: '220100010823', realName: '张三', nickname: '张三', campus: '崂山校区·南海苑', password: '', createdAt: SEED_ACCOUNT_CREATED_AT, status: 'normal', bannedUntil: 0 },
  { id: 'u_lisi', studentId: '220200020456', realName: '李四', nickname: '李四', campus: '崂山校区·东海苑', password: '', createdAt: SEED_ACCOUNT_CREATED_AT, status: 'normal', bannedUntil: 0 },
  { id: 'u_wangwu', studentId: '220300030789', realName: '王五', nickname: '王五', campus: '西海岸校区·听海苑', password: '', createdAt: SEED_ACCOUNT_CREATED_AT, status: 'normal', bannedUntil: 0 },
  { id: 'u_zhaoliu', studentId: '220400041122', realName: '赵六', nickname: '赵六', campus: '鱼山校区·学生公寓', password: '', createdAt: SEED_ACCOUNT_CREATED_AT, status: 'normal', bannedUntil: 0 },
  { id: 'u_sunqi', studentId: '220500052233', realName: '孙七', nickname: '孙七', campus: '浮山校区', password: '', createdAt: SEED_ACCOUNT_CREATED_AT, status: 'normal', bannedUntil: 0 },
  { id: 'u_zhouba', studentId: '220600063344', realName: '周八', nickname: '周八', campus: '西海岸校区·听海苑', password: '', createdAt: SEED_ACCOUNT_CREATED_AT, status: 'normal', bannedUntil: 0 }
];

// 收藏不预置任何商品：新用户第一次进来是空的，收藏全由用户自己点出来
const DEFAULT_FAVORITES = [];

// 新发布商品没有真实图片时轮换使用的柔和占位色（与 H5 版同一套色板）
const COVER_COLORS = ['#dbeafe', '#fde68a', '#c7f0d8', '#fbcfe8', '#e0e7ff', '#fed7aa', '#bfdbfe', '#d9f99d', '#fecaca', '#a7f3d0', '#ddd6fe', '#fef08a'];

// ---------- 本地存储小工具 ----------

function readJSON(key, fallback) {
  try {
    const raw = wx.getStorageSync(key);
    if (raw === '' || raw === null || raw === undefined) return fallback;
    if (typeof raw === 'object') return raw;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[海大易物] 读取本地存储失败：' + key);
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    wx.setStorageSync(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[海大易物] 写入本地存储失败：' + key);
  }
}

function makeId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---------- 数据结构归一化 ----------

// 后端返回的 item 可能缺 coverImage / views 之类的字段，统一补齐，页面就不用到处写默认值
function normalizeItem(raw) {
  const item = raw || {};
  return {
    id: String(item.id || ''),
    title: String(item.title || ''),
    desc: String(item.desc || ''),
    price: Number(item.price) || 0,
    category: String(item.category || ''),
    condition: String(item.condition || ''),
    campus: String(item.campus || ''),
    sellerName: String(item.sellerName || ''),
    sellerId: String(item.sellerId || ''),
    coverColor: String(item.coverColor || '#e5e7eb'),
    coverImage: String(item.coverImage || ''),
    createdAt: Number(item.createdAt) || Date.now(),
    // 'on' 在售 / 'off' 已下架 / 'sold' 已售出，其它值一律按在售处理
    status: item.status === 'off' ? 'off' : (item.status === 'sold' ? 'sold' : 'on'),
    views: Number(item.views) || 0
  };
}

// ---------- 私信会话 ----------
// 一个「买家 × 一件商品」= 一个会话，storage 键 haidayiwu.v1.chat.<itemId>.<buyerId>。
// 会话里带 itemTitle / buyerName / sellerName 快照，商品或账号后续改名也不影响历史会话。

function chatKey(itemId, buyerId) {
  return KEY.chatPrefix + itemId + '.' + buyerId;
}

// 消息只有两种来源：buyer（买家）/ seller（卖家）；时间统一叫 createdAt
function normalizeMessage(raw) {
  const message = raw || {};
  return {
    id: String(message.id || makeId('m')),
    from: message.from === 'seller' ? 'seller' : 'buyer',
    text: String(message.text || ''),
    createdAt: Number(message.createdAt || message.at) || Date.now()
  };
}

function normalizeConversation(raw, itemId, buyerId) {
  const conv = raw || {};
  const messages = Array.isArray(conv.messages) ? conv.messages.map(normalizeMessage) : [];
  return {
    itemId: String(conv.itemId || itemId || ''),
    buyerId: String(conv.buyerId || buyerId || ''),
    sellerId: String(conv.sellerId || ''),
    buyerName: String(conv.buyerName || '同学'),
    sellerName: String(conv.sellerName || '卖家'),
    itemTitle: String(conv.itemTitle || '闲置物品'),
    messages: messages,
    buyerReadAt: Number(conv.buyerReadAt) || 0,
    sellerReadAt: Number(conv.sellerReadAt) || 0
  };
}

// 读会话：不存在就返回 null，绝不自动创建
function readConversation(itemId, buyerId) {
  if (!itemId || !buyerId) return null;
  const raw = readJSON(chatKey(itemId, buyerId), null);
  // 旧版按 itemId 存的是消息数组而不是会话对象，一律当成不存在
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return normalizeConversation(raw, itemId, buyerId);
}

function writeConversation(conv) {
  writeJSON(chatKey(conv.itemId, conv.buyerId), conv);
}

function findNickname(userId) {
  const accounts = readAccounts();
  const index = indexById(accounts, String(userId || ''));
  return index === -1 ? '' : accounts[index].nickname;
}

function findLocalItem(itemId) {
  const found = readLocalItems().filter(function (item) {
    return item.id === itemId;
  })[0];
  return found ? normalizeItem(found) : null;
}

function createConversation(item, buyerId) {
  const conv = normalizeConversation({
    itemId: item.id,
    buyerId: buyerId,
    sellerId: item.sellerId,
    buyerName: findNickname(buyerId) || '同学',
    sellerName: item.sellerName || findNickname(item.sellerId) || '卖家',
    itemTitle: item.title,
    messages: [],
    buyerReadAt: 0,
    sellerReadAt: 0
  });
  writeConversation(conv);
  return conv;
}

// 遍历 storage 生成会话列表，只能靠 getStorageInfoSync 拿键名
function listConversationKeys() {
  let keys = [];
  try {
    const info = wx.getStorageInfoSync();
    keys = (info && info.keys) || [];
  } catch (err) {
    console.warn('[海大易物] 读取本地存储索引失败');
    return [];
  }
  return keys.filter(function (key) {
    return String(key).indexOf(KEY.chatPrefix) === 0;
  });
}

// 我这一侧的未读消息数：对面发来的、比本侧 ReadAt 新的条数
function unreadCount(conv, userId) {
  const isSeller = userId === conv.sellerId;
  const isBuyer = userId === conv.buyerId;
  if (!isSeller && !isBuyer) return 0;
  const readAt = isSeller ? conv.sellerReadAt : conv.buyerReadAt;
  const fromOther = isSeller ? 'buyer' : 'seller';
  return conv.messages.filter(function (message) {
    return message.from === fromOther && message.createdAt > readAt;
  }).length;
}

// 发布时间倒序：新发布的排最前面
function sortByCreatedDesc(items) {
  return items.slice().sort(function (a, b) {
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

// ---------- 账号表（两种模式都落本地 storage，键 haidayiwu.v1.accounts） ----------

// 账号对象固定这九个字段，缺一个就补默认值，页面不用到处写兜底
function normalizeAccount(raw) {
  const account = raw || {};
  return {
    id: String(account.id || ''),
    studentId: String(account.studentId || ''),
    realName: String(account.realName || ''),
    nickname: String(account.nickname || ''),
    campus: String(account.campus || ''),
    password: String(account.password || ''),
    createdAt: Number(account.createdAt) || 0,
    status: account.status === 'banned' ? 'banned' : 'normal',
    bannedUntil: Number(account.bannedUntil) || 0
  };
}

// 首次启动（或 storage 被清空）用内置账号初始化，之后一律以 storage 为准。
// 这张表现在只是登录态缓存（readMe() 靠它确认「这个 id 还在」），不再参与密码校验；
// 读到旧版本遗留的明文密码时顺手抹掉并回写一次，升级后的设备不会继续留着明文。
function readAccounts() {
  const stored = readJSON(KEY.accounts, null);
  const seeded = !(Array.isArray(stored) && stored.length);
  const list = seeded ? DEFAULT_ACCOUNTS.map(normalizeAccount) : stored.map(normalizeAccount);
  let dirty = seeded;
  list.forEach(function (account) {
    if (account.password) {
      account.password = '';
      dirty = true;
    }
  });
  if (dirty) writeAccounts(list);
  return list;
}

function writeAccounts(accounts) {
  writeJSON(KEY.accounts, accounts);
}

// 说明：脱敏规则（哪些字段能出服务端）和账号 id 生成规则现在都在服务端
// （server/store.js 的 sanitizeAccount / makeAccountId），前端只保留登录态缓存需要的工具。

function indexById(accounts, id) {
  for (let i = 0; i < accounts.length; i += 1) {
    if (accounts[i].id === id) return i;
  }
  return -1;
}

function indexByStudentId(accounts, studentId) {
  for (let i = 0; i < accounts.length; i += 1) {
    if (accounts[i].studentId === studentId) return i;
  }
  return -1;
}

// 服务端返回的账号固定这九个字段（不含任何密码字段），本地缓存与对外返回值都用它兜底
function toPublicAccount(raw) {
  var account = raw || {};
  return {
    id: String(account.id || ''),
    studentId: String(account.studentId || ''),
    realName: String(account.realName || ''),
    nickname: String(account.nickname || ''),
    campus: String(account.campus || ''),
    createdAt: Number(account.createdAt) || 0,
    status: account.status === 'banned' ? 'banned' : 'normal',
    bannedUntil: Number(account.bannedUntil) || 0
  };
}

// 把服务端账号同步进本地账号表缓存：readMe() 只认「能按 id 在 haidayiwu.v1.accounts 里查到」的用户，
// 不写这条缓存的话，服务端新建的学号登录成功之后会被 readMe() 判成未登录。
// 缓存里的密码字段一律留空，本地不再保存、也不再校验任何密码。
function cacheAccount(account) {
  if (!account || !account.id) return;
  var list = readAccounts();
  var record = normalizeAccount(account);
  record.password = '';
  var index = indexById(list, account.id);
  if (index === -1) list.push(record);
  else list[index] = record;
  writeAccounts(list);
}

// 400 响应的 fields 是 { 字段名: 中文文案 }，取第一条当弹窗文案
function firstFieldMessage(body) {
  var fields = body && body.fields;
  if (!fields || typeof fields !== 'object') return '';
  var keys = Object.keys(fields);
  return keys.length ? String(fields[keys[0]] || '') : '';
}

// 账号表（脱敏）：走后端 GET /api/accounts，响应里没有任何密码字段。
// 失败一律 resolve 空数组、绝不 reject：app.js 的调用是即发即忘的预热调用，
// 后端没起时抛出去就是一个没人接的未捕获异常。
function getAccounts() {
  // 顺手读一次本地账号表：负责首次种子初始化，并清掉旧版本遗留的明文密码。
  // 放在网络请求之前，后端没起时也会执行（app.js 的预热调用因此在离线时仍然有用）。
  readAccounts();
  return request('GET', '/api/accounts').then(function (body) {
    var list = (body && body.accounts) || [];
    return list.map(toPublicAccount);
  }).catch(function (err) {
    console.warn('[海大易物] 读取账号列表失败：' + ((err && err.message) || '未知错误'));
    return [];
  });
}

function makeAuthError(code, message) {
  var err = new Error(message);
  err.code = code;
  return err;
}

// ---------- 当前用户（两种模式都落本地） ----------

// 已登录用户只从 storage 读：读不到就是未登录，返回 null，页面自己兜底。
// 只认账号表里的 id——旧的演示用户（u_self）即使还留在 storage 里也算未登录。
function readMe() {
  const stored = readJSON(KEY.user, null);
  if (!stored || typeof stored !== 'object') return null;
  const accounts = readAccounts();
  const index = indexById(accounts, String(stored.id || ''));
  if (index === -1) return null;
  const account = accounts[index];
  return {
    id: account.id,
    nickname: String(stored.nickname || account.nickname),
    campus: String(stored.campus || account.campus),
    studentId: String(stored.studentId || account.studentId),
    realName: String(stored.realName || account.realName)
  };
}

// 登录：本地只做和改动前完全一致的格式校验（12 位数字 / 密码非空），凭据交给服务端核对，
// 前端不再持有、也不再比对任何密码。「学号不存在」和「密码不正确」由服务端返回同一句文案。
function login(studentId, password) {
  var id = String(studentId || '').trim();
  var pwd = String(password || '');
  if (!/^\d{12}$/.test(id)) return Promise.reject(makeAuthError('LOGIN_FAILED', '学号必须为 12 位数字'));
  if (!pwd) return Promise.reject(makeAuthError('LOGIN_FAILED', '请输入密码'));

  return request('POST', '/api/accounts/login', { studentId: id, password: pwd }).then(function (body) {
    var account = toPublicAccount(body && body.user);
    var user = {
      id: account.id,
      nickname: account.nickname,
      campus: account.campus,
      studentId: account.studentId,
      realName: account.realName
    };
    // 登录态仍然落本地：readMe() / isLoggedIn() / getMe() 读的就是这两个键
    writeJSON(KEY.user, user);
    writeJSON(KEY.token, String((body && body.token) || ''));
    cacheAccount(account);
    return user;
  }).catch(function (err) {
    // request() 给 4xx / 5xx 的错误带了 statusCode；没有 statusCode 说明根本没连上后端
    if (!err || !err.statusCode) {
      return Promise.reject(makeAuthError('LOGIN_FAILED', '服务未启动，请先运行 node server.js'));
    }
    if (err.statusCode === 401) {
      return Promise.reject(makeAuthError('LOGIN_FAILED', '学号或密码不正确，请核对后重试'));
    }
    var text = (err.body && err.body.message) || firstFieldMessage(err.body) || '学号或密码不正确，请核对后重试';
    return Promise.reject(makeAuthError('LOGIN_FAILED', text));
  });
}

// 注册：本地六项校验的顺序与文案一个字都没改（学号格式 → 是否已注册 → 姓名 → 昵称 → 密码 → 两次一致），
// 只返回第一条未通过的文案；校验通过后交给后端落库（后端用同样的规则再校验一遍）。
// 服务端只存 scrypt 哈希，密码明文既不上本地 storage，也不出现在任何返回值里。
function register(payload) {
  const values = payload || {};
  const studentId = String(values.studentId || '').trim();
  const realName = String(values.realName || '').trim();
  const nickname = String(values.nickname || '').trim();
  const campus = String(values.campus || '');
  const password = String(values.password || '');
  const confirmPassword = String(values.confirmPassword || '');

  if (!/^\d{12}$/.test(studentId)) return Promise.reject(makeAuthError('REGISTER_FAILED', '学号必须为 12 位数字'));

  // 「学号是否已注册」的权威判断在服务端：本地账号表只是登录态缓存，不再充当账号库
  if (indexByStudentId(readAccounts(), studentId) !== -1) {
    return Promise.reject(makeAuthError('REGISTER_FAILED', '该学号已注册，请直接登录'));
  }
  if (realName.length < 2) return Promise.reject(makeAuthError('REGISTER_FAILED', '请输入真实姓名'));
  if (!nickname || nickname.length > 12) return Promise.reject(makeAuthError('REGISTER_FAILED', '昵称需在 1-12 个字之间'));
  if (password.length < 6) return Promise.reject(makeAuthError('REGISTER_FAILED', '密码至少 6 位'));
  if (password !== confirmPassword) return Promise.reject(makeAuthError('REGISTER_FAILED', '两次输入的密码不一致'));

  var payloadOut = {
    studentId: studentId,
    realName: realName,
    nickname: nickname,
    campus: CAMPUSES.indexOf(campus) === -1 ? CAMPUSES[0] : campus,
    password: password
  };

  return request('POST', '/api/accounts/register', payloadOut).then(function (body) {
    var account = toPublicAccount(body && body.user);
    cacheAccount(account);   // 同步进本地登录态缓存，readMe() 才能认出这个新学号
    return account;
  }).catch(function (err) {
    if (!err || !err.statusCode) {
      return Promise.reject(makeAuthError('REGISTER_FAILED', '服务未启动，请先运行 node server.js'));
    }
    if (err.statusCode === 409) {
      return Promise.reject(makeAuthError('REGISTER_FAILED', '该学号已注册，请直接登录'));
    }
    var text = firstFieldMessage(err.body) || (err.body && err.body.message) || '注册失败，请核对信息后重试';
    return Promise.reject(makeAuthError('REGISTER_FAILED', text));
  });
}

// 退出登录：清本地登录态（user + token），商品 / 收藏 / 私信都不动。
// token 没有交给服务端作废：userTokens 只在内存里，进程重启即全部失效，本版不做主动注销接口。
function logout() {
  try {
    wx.removeStorageSync(KEY.user);
  } catch (err) {
    console.warn('[海大易物] 清除登录态失败：' + KEY.user);
  }
  try {
    wx.removeStorageSync(KEY.token);
  } catch (err) {
    console.warn('[海大易物] 清除登录凭证失败：' + KEY.token);
  }
}

function isLoggedIn() {
  return !!readMe();
}

// 两种模式读同一份本地登录态；未登录返回 null
function getMe() {
  return Promise.resolve(readMe());
}

// ---------- 收藏（local 模式落本地 storage；http 模式走服务端 favorites 表，见 httpDriver） ----------

function readFavoriteIds() {
  const ids = readJSON(KEY.favorites, null);
  if (Array.isArray(ids)) return ids;
  writeJSON(KEY.favorites, DEFAULT_FAVORITES);
  return DEFAULT_FAVORITES.slice();
}

function readLocalItems() {
  const items = readJSON(KEY.items, null);
  if (Array.isArray(items) && items.length) return items;
  const seed = (SEED_ITEMS || []).map(normalizeItem);
  writeJSON(KEY.items, seed);
  return seed;
}

function writeLocalItems(items) {
  writeJSON(KEY.items, items);
}

// ---------- 浏览记录（local 模式落本地 storage，键 haidayiwu.v1.history.<userId>；http 模式走服务端） ----------
// 值形如 [ { itemId, viewedAt } ]：按 viewedAt 倒序，同一商品只留最新一条，最多 30 条。
// 未登录时三个方法都静默返回空值 / false，既不抛错也不写任何数据。

const HISTORY_LIMIT = 30;

function historyKey(userId) {
  return KEY.historyPrefix + String(userId || '');
}

// 读出来的记录一律重新排序 + 去重 + 截断，storage 里的脏数据也不会变成重复条目
function readHistoryEntries(userId) {
  const raw = readJSON(historyKey(userId), null);
  if (!Array.isArray(raw)) return [];
  const sorted = raw.filter(function (entry) {
    return !!entry && typeof entry === 'object' && !!String(entry.itemId || '');
  }).map(function (entry) {
    return { itemId: String(entry.itemId), viewedAt: Number(entry.viewedAt) || 0 };
  }).sort(function (a, b) {
    return (b.viewedAt || 0) - (a.viewedAt || 0);
  });
  const seen = {};
  const list = [];
  sorted.forEach(function (entry) {
    if (seen[entry.itemId]) return;
    seen[entry.itemId] = true;
    list.push(entry);
  });
  return list.slice(0, HISTORY_LIMIT);
}

function writeHistoryEntries(userId, entries) {
  writeJSON(historyKey(userId), entries);
}

// 记一条浏览：已经看过同一件商品就更新时间并挪到最前面
function addHistory(itemId) {
  const me = readMe();
  const id = String(itemId || '');
  if (!me || !id) return Promise.resolve(false);
  const entries = readHistoryEntries(me.id).filter(function (entry) {
    return entry.itemId !== id;
  });
  entries.unshift({ itemId: id, viewedAt: Date.now() });
  writeHistoryEntries(me.id, entries.slice(0, HISTORY_LIMIT));
  return Promise.resolve(true);
}

// 浏览过的商品（按最近浏览倒序），商品已被删除的直接跳过；返回的商品上带 viewedAt
function getHistory() {
  const me = readMe();
  if (!me) return Promise.resolve([]);
  const byId = {};
  readLocalItems().forEach(function (raw) {
    const item = normalizeItem(raw);
    byId[item.id] = item;
  });
  const list = [];
  readHistoryEntries(me.id).forEach(function (entry) {
    const item = byId[entry.itemId];
    if (!item) return;
    const view = normalizeItem(item);
    view.viewedAt = entry.viewedAt;
    list.push(view);
  });
  return Promise.resolve(list);
}

// 只清当前用户自己的浏览记录，商品 / 收藏 / 私信都不动
function clearHistory() {
  const me = readMe();
  if (!me) return Promise.resolve(false);
  try {
    wx.removeStorageSync(historyKey(me.id));
  } catch (err) {
    console.warn('[海大易物] 清除浏览记录失败：' + historyKey(me.id));
  }
  return Promise.resolve(true);
}

// ---------- http 请求封装：统一成 Promise，页面里没有任何回调 ----------

function baseUrl() {
  return String(CONFIG.baseUrl || '').replace(/\/+$/, '');
}

function request(method, path, data) {
  return new Promise(function (resolve, reject) {
    wx.request({
      url: baseUrl() + path,
      method: method,
      data: data,
      header: { 'content-type': 'application/json' },
      success: function (res) {
        const code = Number(res.statusCode) || 0;
        if (code >= 200 && code < 300) {
          resolve(res.data);
          return;
        }
        const body = res.data || {};
        const err = new Error(body.message || body.error || ('请求失败 HTTP ' + code));
        err.statusCode = code;
        err.body = body;
        reject(err);
      },
      fail: function (err) {
        reject(new Error('网络请求失败：' + ((err && err.errMsg) || '未知错误')));
      }
    });
  });
}

// =====================================================================
// local 驱动：全部数据来自 wx.getStorageSync
// =====================================================================

const localDriver = {
  getItems() {
    return Promise.resolve(sortByCreatedDesc(readLocalItems().map(normalizeItem)));
  },

  getItemById(id) {
    const found = readLocalItems().filter(function (item) {
      return item.id === id;
    })[0];
    return Promise.resolve(found ? normalizeItem(found) : null);
  },

  addItem(input) {
    const items = readLocalItems();
    const me = readMe() || {};
    const values = input || {};
    const item = normalizeItem({
      id: makeId('i'),
      title: String(values.title || '').trim(),
      desc: String(values.desc || '').trim(),
      price: Math.round(Number(values.price) * 100) / 100,
      category: values.category,
      condition: values.condition,
      campus: values.campus,
      sellerName: me.nickname || '未登录用户',
      sellerId: me.id || '',
      coverColor: COVER_COLORS[items.length % COVER_COLORS.length],
      coverImage: String(values.coverImage || ''),
      createdAt: Date.now(),
      status: 'on',
      views: 1
    });
    items.unshift(item);
    writeLocalItems(items);
    return Promise.resolve(item);
  },

  setItemStatus(id, status) {
    if (status !== 'on' && status !== 'off' && status !== 'sold') return Promise.resolve(null);
    const items = readLocalItems();
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].id === id) {
        items[i].status = status;
        writeLocalItems(items);
        return Promise.resolve(normalizeItem(items[i]));
      }
    }
    return Promise.resolve(null);
  },

  toggleFavorite(id) {
    const ids = readFavoriteIds();
    const index = ids.indexOf(id);
    if (index === -1) ids.unshift(id);
    else ids.splice(index, 1);
    writeJSON(KEY.favorites, ids);
    return Promise.resolve(index === -1);
  },

  getFavorites() {
    const items = readLocalItems().map(normalizeItem);
    const favorites = readFavoriteIds().map(function (id) {
      return items.filter(function (item) { return item.id === id; })[0];
    }).filter(function (item) { return !!item; });
    return Promise.resolve(favorites);
  },

  getConversation(itemId, buyerId) {
    return Promise.resolve(readConversation(String(itemId || ''), String(buyerId || '')));
  },

  // 会话只在这里懒创建：第一条消息真正发出来时才写 storage，只看不聊不会留任何记录
  appendMessage(itemId, buyerId, from, text) {
    const id = String(itemId || '');
    const buyer = String(buyerId || '');
    if (!id || !buyer) return Promise.resolve(null);
    let conv = readConversation(id, buyer);
    if (!conv) {
      const item = findLocalItem(id);
      if (!item) return Promise.resolve(null);
      conv = createConversation(item, buyer);
    }
    const message = normalizeMessage({
      id: makeId('m'),
      from: from === 'seller' ? 'seller' : 'buyer',
      text: String(text || ''),
      createdAt: Date.now()
    });
    conv.messages.push(message);
    writeConversation(conv);
    return Promise.resolve(message);
  },

  getConversations(userId) {
    const me = String(userId || '');
    if (!me) return Promise.resolve([]);
    const list = [];
    listConversationKeys().forEach(function (key) {
      const raw = readJSON(key, null);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      const conv = normalizeConversation(raw, '', '');
      if (me !== conv.sellerId && me !== conv.buyerId) return;
      // 空会话（一条消息都没有）不进列表：会话记录只在 appendMessage 时才产生
      if (!conv.messages.length) return;
      const isSeller = me === conv.sellerId;
      const last = conv.messages.length ? conv.messages[conv.messages.length - 1] : null;
      list.push({
        key: key,
        itemId: conv.itemId,
        buyerId: conv.buyerId,
        itemTitle: conv.itemTitle,
        counterpartName: isSeller ? conv.buyerName : conv.sellerName,
        lastText: last ? last.text : '',
        lastAt: last ? last.createdAt : 0,
        unread: unreadCount(conv, me)
      });
    });
    list.sort(function (a, b) {
      return (b.lastAt || 0) - (a.lastAt || 0);
    });
    return Promise.resolve(list);
  },

  // 按当前登录用户身份，只更新自己那一侧的 ReadAt
  markConversationRead(itemId, buyerId) {
    const conv = readConversation(String(itemId || ''), String(buyerId || ''));
    const me = readMe();
    if (!conv || !me) return Promise.resolve(null);
    const now = Date.now();
    if (me.id === conv.sellerId) conv.sellerReadAt = now;
    else if (me.id === conv.buyerId) conv.buyerReadAt = now;
    else return Promise.resolve(conv);
    writeConversation(conv);
    return Promise.resolve(conv);
  },

  // tabBar 红点用「有未读的会话数」，不是消息条数
  getUnreadTotal(userId) {
    const me = String(userId || '');
    if (!me) return Promise.resolve(0);
    let total = 0;
    listConversationKeys().forEach(function (key) {
      const raw = readJSON(key, null);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      const conv = normalizeConversation(raw, '', '');
      if (me !== conv.sellerId && me !== conv.buyerId) return;
      if (!conv.messages.length) return;
      if (unreadCount(conv, me) > 0) total += 1;
    });
    return Promise.resolve(total);
  },

  // 详情页进来一次 +1；找不到商品返回 null，不凭空造数据
  bumpViews(id) {
    const items = readLocalItems();
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].id === id) {
        items[i].views = (Number(items[i].views) || 0) + 1;
        writeLocalItems(items);
        return Promise.resolve(normalizeItem(items[i]));
      }
    }
    return Promise.resolve(null);
  }
};

// =====================================================================
// http 驱动：wx.request 打本机 Node 后端（契约见 server/api.md）
// =====================================================================

const httpDriver = {
  getItems() {
    return request('GET', '/api/items').then(function (body) {
      const list = (body && body.items) || [];
      return sortByCreatedDesc(list.map(normalizeItem));
    });
  },

  getItemById(id) {
    return request('GET', '/api/items/' + encodeURIComponent(id)).then(function (body) {
      return body && body.item ? normalizeItem(body.item) : null;
    }).catch(function (err) {
      if (err.statusCode === 404) return null;   // 下架 / 删除后按「不存在」处理
      throw err;
    });
  },

  addItem(input) {
    const me = readMe() || {};
    const values = input || {};
    const payload = {
      id: makeId('i'),
      title: String(values.title || '').trim(),
      desc: String(values.desc || '').trim(),
      price: Math.round(Number(values.price) * 100) / 100,
      category: values.category,
      condition: values.condition,
      campus: values.campus,
      sellerName: me.nickname || '未登录用户',
      sellerId: me.id || '',
      coverImage: String(values.coverImage || ''),
      status: 'on',
      createdAt: Date.now()
    };
    return request('POST', '/api/items', payload).then(function (body) {
      return normalizeItem(body && body.item);
    });
  },

  setItemStatus(id, status) {
    if (status !== 'on' && status !== 'off' && status !== 'sold') return Promise.resolve(null);
    return request('PATCH', '/api/items/' + encodeURIComponent(id), { status: status })
      .then(function (body) {
        return body && body.item ? normalizeItem(body.item) : null;
      });
  },

  // ---------- 收藏（服务端 favorites 表） ----------
  // 返回值保持旧语义：resolve 的是「这次操作之后是否已收藏」的 boolean，页面用它切按钮文案
  toggleFavorite(id) {
    var me = readMe();
    var itemId = String(id || '');
    if (!me) return Promise.reject(makeAuthError('FAVORITE_FAILED', '请先登录'));
    if (!itemId) return Promise.resolve(false);
    return request('POST', '/api/favorites', { userId: me.id, itemId: itemId }).then(function (body) {
      return !!(body && body.favorited);
    });
  },

  // 服务端只给 id 列表，商品对象还是要按 /api/items 解析：与旧实现拼装顺序一致（收藏在前）
  getFavorites() {
    var me = readMe();
    if (!me) return Promise.resolve([]);
    return request('GET', '/api/favorites?userId=' + encodeURIComponent(me.id)).then(function (body) {
      var ids = (body && body.itemIds) || [];
      return httpDriver.getItems().then(function (items) {
        return ids.map(function (id) {
          return items.filter(function (item) { return item.id === id; })[0];
        }).filter(function (item) { return !!item; });
      });
    }).catch(function (err) {
      console.warn('[海大易物] 读取收藏失败：' + ((err && err.message) || '未知错误'));
      return [];
    });
  },

  // ---------- 私信会话（服务端 conversations 表，一件商品 × 一个买家一条） ----------
  // 读不到就是 null：会话只在第一条消息发出来时才由服务端创建，这里绝不建空会话
  getConversation(itemId, buyerId) {
    var id = String(itemId || '');
    var buyer = String(buyerId || '');
    if (!id || !buyer) return Promise.resolve(null);
    var url = '/api/conversations/' + encodeURIComponent(id) + '/' + encodeURIComponent(buyer);
    return request('GET', url).then(function (body) {
      return body && body.conversation ? normalizeConversation(body.conversation, id, buyer) : null;
    }).catch(function (err) {
      // 404 与「后端没启动」都按「还没有会话」处理，绝不把未捕获异常抛给页面
      if (err && err.statusCode && err.statusCode !== 404) {
        console.warn('[海大易物] 读取会话失败：' + ((err && err.message) || '未知错误'));
      }
      return null;
    });
  },

  // 发一条私信：resolve 的是刚落库的那条消息（页面 appendMessage 的用法没变）
  // 会话快照字段：readMe() 能给的（我自己这一侧的昵称）先带上，商品标题 / 卖家 id
  // 服务端会根据 itemId 从自己的 items / accounts 表补齐，客户端不必为此多请求一次。
  appendMessage(itemId, buyerId, from, text) {
    var id = String(itemId || '');
    var buyer = String(buyerId || '');
    if (!id || !buyer) return Promise.resolve(null);
    var me = readMe() || {};
    var isSeller = !!me.id && me.id !== buyer;
    var payload = {
      from: from === 'seller' ? 'seller' : 'buyer',
      text: String(text || '').trim(),
      itemTitle: '',
      sellerId: isSeller ? String(me.id) : '',
      buyerName: isSeller ? '' : String(me.nickname || ''),
      sellerName: isSeller ? String(me.nickname || '') : ''
    };
    var url = '/api/conversations/' + encodeURIComponent(id) + '/' + encodeURIComponent(buyer) + '/messages';
    return request('POST', url, payload).then(function (body) {
      var conv = normalizeConversation(body && body.conversation, id, buyer);
      // 页面只需要「刚发出去的那条」，取会话里最后一条返回
      return conv.messages.length ? conv.messages[conv.messages.length - 1] : null;
    });
  },

  getConversations(userId) {
    var me = String(userId || '');
    if (!me) return Promise.resolve([]);
    return request('GET', '/api/conversations?userId=' + encodeURIComponent(me)).then(function (body) {
      var list = (body && body.conversations) || [];
      return list.map(function (row) {
        var itemId = String(row.itemId || '');
        var buyerId = String(row.buyerId || '');
        return {
          // messages 页的 wx:key 用的是 key，本地实现里是 storage 键名，这里按同样规则拼
          key: chatKey(itemId, buyerId),
          itemId: itemId,
          buyerId: buyerId,
          itemTitle: String(row.itemTitle || ''),
          counterpartName: String(row.counterpartName || ''),
          lastText: String(row.lastText || ''),
          lastAt: Number(row.lastAt) || 0,
          unread: Number(row.unread) || 0
        };
      });
    }).catch(function (err) {
      console.warn('[海大易物] 读取会话列表失败：' + ((err && err.message) || '未知错误'));
      return [];
    });
  },

  // 已读：只更新自己那一侧的 ReadAt，服务端按 userId 判断是哪一侧
  markConversationRead(itemId, buyerId) {
    var id = String(itemId || '');
    var buyer = String(buyerId || '');
    var me = readMe();
    if (!id || !buyer || !me) return Promise.resolve(null);
    var url = '/api/conversations/' + encodeURIComponent(id) + '/' + encodeURIComponent(buyer) + '/read';
    return request('PATCH', url, { userId: me.id }).then(function (body) {
      return body && body.conversation ? normalizeConversation(body.conversation, id, buyer) : null;
    }).catch(function (err) {
      console.warn('[海大易物] 标记已读失败：' + ((err && err.message) || '未知错误'));
      return null;
    });
  },

  // tabBar 红点：仍是「有未读的会话数」，直接用会话列表里每条的 unread 数出来
  getUnreadTotal(userId) {
    return httpDriver.getConversations(userId).then(function (list) {
      var total = 0;
      (list || []).forEach(function (row) {
        if (Number(row.unread) > 0) total += 1;
      });
      return total;
    }).catch(function () {
      return 0;
    });
  },

  // ---------- 浏览记录（服务端 historyEntries 表） ----------
  // 与旧的本地实现保持同一套返回值：resolve true / false，失败时 reject（详情页已有 catch）
  addHistory(itemId) {
    var me = readMe();
    var id = String(itemId || '');
    if (!me || !id) return Promise.resolve(false);
    return request('POST', '/api/history', { userId: me.id, itemId: id }).then(function () {
      return true;
    });
  },

  // 服务端只回 { itemId, viewedAt }，商品对象按 /api/items 拼，顺序就是服务端给的最近浏览倒序
  getHistory() {
    var me = readMe();
    if (!me) return Promise.resolve([]);
    return request('GET', '/api/history?userId=' + encodeURIComponent(me.id)).then(function (body) {
      var entries = (body && body.entries) || [];
      return httpDriver.getItems().then(function (items) {
        var byId = {};
        items.forEach(function (item) { byId[item.id] = item; });
        var list = [];
        entries.forEach(function (entry) {
          var item = byId[String(entry.itemId || '')];
          if (!item) return;   // 商品已被删除的直接跳过，与旧实现一致
          var view = normalizeItem(item);
          view.viewedAt = Number(entry.viewedAt) || 0;
          list.push(view);
        });
        list.sort(function (a, b) { return (b.viewedAt || 0) - (a.viewedAt || 0); });
        return list;
      });
    }).catch(function (err) {
      console.warn('[海大易物] 读取浏览记录失败：' + ((err && err.message) || '未知错误'));
      return [];
    });
  },

  clearHistory() {
    var me = readMe();
    if (!me) return Promise.resolve(false);
    return request('DELETE', '/api/history?userId=' + encodeURIComponent(me.id)).then(function () {
      return true;
    });
  },

  // 后端 PATCH 支持 views（绝对值）：先读当前商品，再写回 +1
  bumpViews(id) {
    return httpDriver.getItemById(id).then(function (item) {
      if (!item) return null;
      const next = (Number(item.views) || 0) + 1;
      return request('PATCH', '/api/items/' + encodeURIComponent(id), { views: next })
        .then(function (body) { return body && body.item ? normalizeItem(body.item) : null; });
    });
  }
};

// =====================================================================
// 远程接口（评论 / 举报 / 信用评价）
// 这一组方法不走 driver：local 与 http 两种模式下都直接打 CONFIG.baseUrl，
// 因为评论、举报、评价只存在于服务端（server/store.js 的 comments / reports / ratings），
// 小程序本机 storage 里没有对应的表，也没有办法离线补一份。
// 后端没启动时（wx.request 的 fail 分支）统一包成带 isNetworkError 的错误对象，
// 页面层据此提示「服务未启动，请先运行 node server.js」，不会白屏也不会崩。
// =====================================================================

function remoteRequest(method, path, data) {
  return request(method, path, data).catch(function (err) {
    // request() 给 HTTP 4xx / 5xx 的错误带了 statusCode；没有 statusCode 说明根本没连上后端
    if (!err || !err.statusCode) {
      const netErr = new Error('服务未启动，请先运行 node server.js');
      netErr.isNetworkError = true;
      netErr.raw = err;
      throw netErr;
    }
    throw err;
  });
}

/** 页面统一的错误文案：网络错误说清原因，其余用后端给的 message。 */
function remoteErrorText(err) {
  if (err && err.isNetworkError) return '服务未启动，请先运行 node server.js';
  if (err && err.statusCode === 409) return '你已经评价过了';
  return (err && err.message) || '操作失败，请重试';
}

// 某件商品的评论（服务端只返回未软删的），按时间正序
function getComments(itemId) {
  return remoteRequest('GET', '/api/comments?itemId=' + encodeURIComponent(String(itemId || '')))
    .then(function (body) {
      return (body && body.comments) || [];
    });
}

// 发表评论：成功后返回服务端落库的那条记录
function addComment(payload) {
  return remoteRequest('POST', '/api/comments', payload || {}).then(function (body) {
    return body && body.comment;
  });
}

// 提交举报（投诉）：服务端只存 itemTitle 快照，不校验商品是否存在
function addReport(payload) {
  return remoteRequest('POST', '/api/reports', payload || {}).then(function (body) {
    return body && body.report;
  });
}

// 信用评价：同一件商品同一个人只能评一次，重复时后端回 409 ALREADY_RATED
function submitRating(payload) {
  return remoteRequest('POST', '/api/ratings', payload || {}).then(function (body) {
    return body && body.rating;
  });
}

// 某个用户收到的评价：{ ratings, average（保留一位小数）, count }，无评价时 0 / 0
function getUserRatings(userId) {
  return remoteRequest('GET', '/api/ratings?userId=' + encodeURIComponent(String(userId || '')))
    .then(function (body) {
      return {
        ratings: (body && body.ratings) || [],
        average: Number(body && body.average) || 0,
        count: Number(body && body.count) || 0
      };
    });
}

const driver = CONFIG.mode === 'http' ? httpDriver : localDriver;

module.exports = {
  config: CONFIG,
  campuses: CAMPUSES,
  getItems: driver.getItems,
  getItemById: driver.getItemById,
  addItem: driver.addItem,
  setItemStatus: driver.setItemStatus,
  toggleFavorite: driver.toggleFavorite,
  bumpViews: driver.bumpViews,
  getFavorites: driver.getFavorites,
  // 浏览记录两种模式各有一套：local 是模块级函数（读 haidayiwu.v1.history.<userId>），
  // http 走服务端 historyEntries 表，按 mode 二选一，页面调用方式完全一样。
  addHistory: CONFIG.mode === 'http' ? httpDriver.addHistory : addHistory,
  getHistory: CONFIG.mode === 'http' ? httpDriver.getHistory : getHistory,
  clearHistory: CONFIG.mode === 'http' ? httpDriver.clearHistory : clearHistory,
  getConversation: driver.getConversation,
  appendMessage: driver.appendMessage,
  getConversations: driver.getConversations,
  markConversationRead: driver.markConversationRead,
  getUnreadTotal: driver.getUnreadTotal,
  login: login,
  register: register,
  getAccounts: getAccounts,
  logout: logout,
  isLoggedIn: isLoggedIn,
  getMe: getMe,
  getComments: getComments,
  addComment: addComment,
  addReport: addReport,
  submitRating: submitRating,
  getUserRatings: getUserRatings,
  errorText: remoteErrorText
};