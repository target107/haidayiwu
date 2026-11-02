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
 * 注意：收藏、登录态、账号表在这两种模式下都落在本地 storage——
 * 后端没有收藏接口，也没有登录态，登录只认本地账号表（storage 键 haidayiwu.v1.accounts，
 * 首次启动时用本文件里的 DEFAULT_ACCOUNTS 初始化）。
 *
 * 【已知局限】Alpha 阶段密码为本地明文存储，仅用于演示；Beta 阶段改为服务端哈希 + HTTPS 传输。
 */

const SEED_ITEMS = require('../data/seed.js');

const CONFIG = {
  mode: 'local',                      // 'local' | 'http'
  baseUrl: 'http://127.0.0.1:3000'    // mode 为 http 时使用
};

const KEY = {
  items: 'haidayiwu.v1.items',
  favorites: 'haidayiwu.v1.favorites',
  user: 'haidayiwu.v1.user',
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

// 内置账号表：首次启动时写进 storage 的 haidayiwu.v1.accounts，之后一律以 storage 为准。
// 登录要求「学号 + 密码」同时匹配其中一条；这是 Alpha 版的演示凭据，不对接学校统一身份认证。
// status / bannedUntil 是给 Beta 的封禁功能预留的字段，本版只存不校验。
// 【已知局限】Alpha 阶段密码为本地明文存储，仅用于演示；Beta 阶段改为服务端哈希 + HTTPS 传输。
const SEED_ACCOUNT_CREATED_AT = 1735660800000;   // 预置账号的 createdAt 固定，便于复现和排查
const DEFAULT_ACCOUNTS = [
  { id: 'u_zhangsan', studentId: '220100010823', realName: '张三', nickname: '张三', campus: '崂山校区·南海苑', password: '123456', createdAt: SEED_ACCOUNT_CREATED_AT, status: 'normal', bannedUntil: 0 },
  { id: 'u_lisi', studentId: '220200020456', realName: '李四', nickname: '李四', campus: '崂山校区·东海苑', password: '123456', createdAt: SEED_ACCOUNT_CREATED_AT, status: 'normal', bannedUntil: 0 },
  { id: 'u_wangwu', studentId: '220300030789', realName: '王五', nickname: '王五', campus: '西海岸校区·听海苑', password: '123456', createdAt: SEED_ACCOUNT_CREATED_AT, status: 'normal', bannedUntil: 0 },
  { id: 'u_zhaoliu', studentId: '220400041122', realName: '赵六', nickname: '赵六', campus: '鱼山校区·学生公寓', password: '123456', createdAt: SEED_ACCOUNT_CREATED_AT, status: 'normal', bannedUntil: 0 },
  { id: 'u_sunqi', studentId: '220500052233', realName: '孙七', nickname: '孙七', campus: '浮山校区', password: '123456', createdAt: SEED_ACCOUNT_CREATED_AT, status: 'normal', bannedUntil: 0 },
  { id: 'u_zhouba', studentId: '220600063344', realName: '周八', nickname: '周八', campus: '西海岸校区·听海苑', password: '123456', createdAt: SEED_ACCOUNT_CREATED_AT, status: 'normal', bannedUntil: 0 }
];

// 预置两条收藏，方便演示「我的 → 我收藏的」
const DEFAULT_FAVORITES = ['i_002', 'i_008'];

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

// 首次启动（或 storage 被清空）用内置账号初始化，之后一律以 storage 为准
function readAccounts() {
  const stored = readJSON(KEY.accounts, null);
  if (Array.isArray(stored) && stored.length) return stored.map(normalizeAccount);
  const seed = DEFAULT_ACCOUNTS.map(normalizeAccount);
  writeAccounts(seed);
  return seed;
}

function writeAccounts(accounts) {
  writeJSON(KEY.accounts, accounts);
}

// 对外一律用脱敏账号：不含 password，其余字段原样保留
function sanitizeAccount(raw) {
  const account = normalizeAccount(raw);
  return {
    id: account.id,
    studentId: account.studentId,
    realName: account.realName,
    nickname: account.nickname,
    campus: account.campus,
    createdAt: account.createdAt,
    status: account.status,
    bannedUntil: account.bannedUntil
  };
}

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

// 账号 id = u_ + 学号后 6 位；撞了就追加随机后缀，最多试 20 次
function makeAccountId(studentId, accounts) {
  const base = 'u_' + String(studentId || '').slice(-6);
  let candidate = base;
  let guard = 0;
  while (indexById(accounts, candidate) !== -1 && guard < 20) {
    candidate = base + '_' + Math.random().toString(36).slice(2, 5);
    guard += 1;
  }
  return candidate;
}

// 账号表（脱敏）：不含密码，给页面和调试用
function getAccounts() {
  return Promise.resolve(readAccounts().map(sanitizeAccount));
}

function makeAuthError(code, message) {
  const err = new Error(message);
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

// 登录：学号 + 密码必须同时在账号表里匹配，只校验格式不算登录成功。
// 「学号不存在」和「密码不正确」共用一句文案，不泄露账号是否已注册。
function login(studentId, password) {
  const id = String(studentId || '').trim();
  const pwd = String(password || '');
  if (!/^\d{12}$/.test(id)) return Promise.reject(makeAuthError('LOGIN_FAILED', '学号必须为 12 位数字'));
  if (!pwd) return Promise.reject(makeAuthError('LOGIN_FAILED', '请输入密码'));
  const accounts = readAccounts();
  const index = indexByStudentId(accounts, id);
  const account = index === -1 ? null : accounts[index];
  if (!account || account.password !== pwd) {
    return Promise.reject(makeAuthError('LOGIN_FAILED', '学号或密码不正确，请核对后重试'));
  }
  const user = {
    id: account.id,
    nickname: account.nickname,
    campus: account.campus,
    studentId: account.studentId,
    realName: account.realName
  };
  writeJSON(KEY.user, user);
  return Promise.resolve(user);
}

// 注册：校验顺序固定为 学号格式 → 是否已注册 → 姓名 → 昵称 → 密码 → 两次一致，
// 只返回第一条未通过的文案；成功则写回账号表，并把脱敏账号 resolve 出去。
// 密码在本版是明文存 storage（见文件头「已知局限」），不写任何伪装的加密。
function register(payload) {
  const values = payload || {};
  const studentId = String(values.studentId || '').trim();
  const realName = String(values.realName || '').trim();
  const nickname = String(values.nickname || '').trim();
  const campus = String(values.campus || '');
  const password = String(values.password || '');
  const confirmPassword = String(values.confirmPassword || '');

  if (!/^\d{12}$/.test(studentId)) return Promise.reject(makeAuthError('REGISTER_FAILED', '学号必须为 12 位数字'));

  const accounts = readAccounts();
  if (indexByStudentId(accounts, studentId) !== -1) {
    return Promise.reject(makeAuthError('REGISTER_FAILED', '该学号已注册，请直接登录'));
  }
  if (realName.length < 2) return Promise.reject(makeAuthError('REGISTER_FAILED', '请输入真实姓名'));
  if (!nickname || nickname.length > 12) return Promise.reject(makeAuthError('REGISTER_FAILED', '昵称需在 1-12 个字之间'));
  if (password.length < 6) return Promise.reject(makeAuthError('REGISTER_FAILED', '密码至少 6 位'));
  if (password !== confirmPassword) return Promise.reject(makeAuthError('REGISTER_FAILED', '两次输入的密码不一致'));

  const account = normalizeAccount({
    id: makeAccountId(studentId, accounts),
    studentId: studentId,
    realName: realName,
    nickname: nickname,
    campus: CAMPUSES.indexOf(campus) === -1 ? CAMPUSES[0] : campus,
    password: password,
    createdAt: Date.now(),
    status: 'normal',
    bannedUntil: 0
  });
  accounts.push(account);
  writeAccounts(accounts);
  return Promise.resolve(sanitizeAccount(account));
}

// 退出登录：只清本地登录态，商品 / 收藏 / 私信都不动
function logout() {
  try {
    wx.removeStorageSync(KEY.user);
  } catch (err) {
    console.warn('[海大易物] 清除登录态失败：' + KEY.user);
  }
}

function isLoggedIn() {
  return !!readMe();
}

// 两种模式读同一份本地登录态；未登录返回 null
function getMe() {
  return Promise.resolve(readMe());
}

// ---------- 收藏（后端没有收藏接口，两种模式都落本地） ----------

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

// ---------- 浏览记录（两种模式都落本地 storage，键 haidayiwu.v1.history.<userId>） ----------
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

  // 收藏只存本地 id 列表，但列表内容要按服务器商品解析，否则 http 模式下收藏的新商品查不到
  toggleFavorite(id) {
    return localDriver.toggleFavorite(id);
  },

  getFavorites() {
    return httpDriver.getItems().then(function (items) {
      const ids = readFavoriteIds();
      return ids.map(function (id) {
        return items.filter(function (item) { return item.id === id; })[0];
      }).filter(function (item) { return !!item; });
    });
  },

  // 后端没有会话模型：http 模式下会话一律落本地 storage，只做最小兼容，保证页面不报错
  getConversation(itemId, buyerId) {
    return localDriver.getConversation(itemId, buyerId);
  },

  appendMessage(itemId, buyerId, from, text) {
    return localDriver.appendMessage(itemId, buyerId, from, text);
  },

  getConversations(userId) {
    return localDriver.getConversations(userId);
  },

  markConversationRead(itemId, buyerId) {
    return localDriver.markConversationRead(itemId, buyerId);
  },

  getUnreadTotal(userId) {
    return localDriver.getUnreadTotal(userId);
  },

  // 后端也没有浏览量接口：只回读一次当前商品
  bumpViews(id) {
    return httpDriver.getItemById(id);
  }
};

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
  addHistory: addHistory,
  getHistory: getHistory,
  clearHistory: clearHistory,
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
  getMe: getMe
};
