/**
 * 海大易物 · 数据层
 * 只用 Node 内置模块（fs / path / crypto），不依赖任何第三方包。
 * 负责：db.json 的读写（原子写）、首次启动的种子数据初始化、
 *       商品 / 私信 / 用户 / 评论 / 举报 / 信用评价的增删改查与字段校验。
 * db.json 结构：{ items, messages, users, comments, reports, ratings, accounts }。
 * accounts 是账号表：密码只存 crypto.scryptSync 的哈希与每账号独立随机 salt，明文从不落盘。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TMP_FILE = path.join(DATA_DIR, 'db.json.tmp');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');

// ---- 与前端 views.js 中的选项常量保持一致 ----
const CATEGORIES = ['教材书籍', '自行车', '生活用品', '数码电子', '其他'];
const CONDITIONS = ['全新', '几乎全新', '轻微使用痕迹', '明显使用痕迹'];
const CAMPUSES = ['崂山校区·南海苑', '崂山校区·东海苑', '崂山校区·北海苑', '鱼山校区·学生公寓', '浮山校区', '西海岸校区'];
const ITEM_STATUS = ['on', 'off', 'sold'];
const MESSAGE_FROM = ['me', 'seller'];

// 新商品没有真实图片时轮换使用的柔和占位色（与前端一致）
const COVER_COLORS = ['#dbeafe', '#fde68a', '#c7f0d8', '#fbcfe8', '#e0e7ff', '#fed7aa',
  '#bfdbfe', '#d9f99d', '#fecaca', '#a7f3d0', '#ddd6fe', '#fef08a'];

// 字段长度 / 数值上限
const LIMITS = {
  title: 60,        // 标题最多 60 字
  desc: 500,        // 描述最多 500 字
  text: 300,        // 私信最多 300 字
  sellerName: 20,   // 卖家昵称最多 20 字
  price: 99999,     // 价格上限
  id: 64,           // 客户端自带 id 的长度上限
  commentText: 200, // 评论内容最多 200 字
  reportDetail: 200, // 举报补充说明最多 200 字
  ratingComment: 120 // 信用评价评语最多 120 字
};

// 演示用当前用户（与前端 store.js 的 DEFAULT_USER 对齐）
const SELF_USER = {
  id: 'u_self',
  name: '校园用户0823',
  campus: '崂山校区·南海苑',
  verified: true,
  studentId: '220100010823',
  realName: '校园用户0823'
};

// ---------- 账号种子与密码哈希 ----------
// 与 miniprogram/utils/api.js 的 DEFAULT_ACCOUNTS 对齐：学号 / 姓名 / 昵称 / 校区一字不改，
// 这样前端不再本地校验密码之后，老用户仍然用原来的学号密码登录。
// 密码 123456 只以 scrypt 哈希形式存在，明文仅出现在下面这份种子定义里，且只在建库时用一次。
const SEED_ACCOUNT_CREATED_AT = 1735660800000; // 预置账号的 createdAt 固定，便于复现和排查
const SEED_ACCOUNT_PASSWORD = '123456';
const SEED_ACCOUNTS = [
  { id: 'u_zhangsan', studentId: '220100010823', realName: '张三', nickname: '张三', campus: '崂山校区·南海苑' },
  { id: 'u_lisi', studentId: '220200020456', realName: '李四', nickname: '李四', campus: '崂山校区·东海苑' },
  { id: 'u_wangwu', studentId: '220300030789', realName: '王五', nickname: '王五', campus: '西海岸校区·听海苑' },
  { id: 'u_zhaoliu', studentId: '220400041122', realName: '赵六', nickname: '赵六', campus: '鱼山校区·学生公寓' },
  { id: 'u_sunqi', studentId: '220500052233', realName: '孙七', nickname: '孙七', campus: '浮山校区' },
  { id: 'u_zhouba', studentId: '220600063344', realName: '周八', nickname: '周八', campus: '西海岸校区·听海苑' }
];

// 学号不存在时用来做一次同代价的哈希，避免攻击者靠响应时间枚举已注册学号
const DUMMY_SALT = 'dummy-salt-for-timing-only-do-not-use';

/** 每个账号一份独立随机 salt（16 字节 hex），绝不复用。 */
function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/** 密码哈希：Node 内置 crypto.scryptSync(password, salt, 64) 的 hex，零第三方依赖。 */
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64).toString('hex');
}

/** 定长比较，避免用 === 比哈希带来的时序差异。 */
function safeEqualHex(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** 用内置 6 个账号生成种子账号表（每次调用 salt 都是新随机值，只在建库时跑一次）。 */
function buildSeedAccounts() {
  return SEED_ACCOUNTS.map((seed) => {
    const salt = makeSalt();
    return {
      id: seed.id, // 与旧前端本地账号表的 id 保持一致，老登录态缓存不会因为换 id 而失效
      studentId: seed.studentId,
      realName: seed.realName,
      nickname: seed.nickname,
      campus: seed.campus,
      createdAt: SEED_ACCOUNT_CREATED_AT,
      status: 'normal',
      bannedUntil: 0,
      salt: salt,
      passwordHash: hashPassword(SEED_ACCOUNT_PASSWORD, salt)
    };
  });
}

let db = null; // 内存中的数据库镜像，进程内单例

// ---------- 落盘 ----------

/** 原子写：先写 db.json.tmp，再 rename 覆盖，避免留下半截文件。 */
function writeDb() {
  const json = JSON.stringify(db, null, 2);
  fs.writeFileSync(TMP_FILE, json + '\n', 'utf8');
  fs.renameSync(TMP_FILE, DB_FILE);
}

/** 从商品列表里推导出卖家信息，再补上当前演示用户。 */
function deriveUsers(items) {
  const users = {};
  for (const item of items) {
    if (!item || !item.sellerId || users[item.sellerId]) continue;
    users[item.sellerId] = {
      id: item.sellerId,
      name: item.sellerName || '校园用户',
      campus: item.campus || '',
      verified: true,
      itemsCount: 0
    };
  }
  users[SELF_USER.id] = {
    ...SELF_USER,
    itemsCount: 0
  };
  for (const item of items) {
    if (item && users[item.sellerId]) users[item.sellerId].itemsCount += 1;
  }
  return Object.keys(users).map((key) => users[key]);
}

/**
 * 载入数据库：db.json 不存在时用 seed.json 初始化。
 * 解析失败直接抛错，由 server.js 打印中文提示后退出。
 */
function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(DB_FILE)) {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    if (!Array.isArray(seed)) throw new Error('seed.json 格式不正确，应为商品数组');
    db = {
      items: seed,
      messages: [],
      users: deriveUsers(seed),
      comments: [],
      reports: [],
      ratings: [],
      // 会话 / 收藏 / 浏览记录：不再是「本地 storage 专属」，与商品一样落服务端
      conversations: [],
      favorites: [],
      historyEntries: [],
      accounts: buildSeedAccounts() // 内置 6 个账号，密码以 scrypt 哈希落盘
    };
    writeDb();
    return { initialized: true, items: db.items.length };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    throw new Error('db.json 无法解析（' + err.message + '），请删除该文件后重启以重新初始化');
  }
  // accounts 是后加的账号表：旧 db.json 里没有（或是空数组）时在内存里补上内置 6 个账号，
  // 并立刻落盘一次，让这些账号的 salt / hash 就此固定下来。
  // writeDb 写的是整个 db 对象，items / messages / users / comments / reports / ratings 原样写回，一个字段都不动。
  const needsSeedAccounts = !(Array.isArray(parsed.accounts) && parsed.accounts.length);
  // 会话 / 收藏 / 浏览记录也是后加的三张表：旧 db.json 缺任何一张就在内存里补空数组，
  // 并落盘一次让它们真正写进文件（与 accounts 的处理方式一致，已有表原样写回，一个字段都不动）。
  const needsNewTables = !Array.isArray(parsed.conversations) || !Array.isArray(parsed.favorites) || !Array.isArray(parsed.historyEntries);

  // 容错：字段缺失时补齐，避免旧文件导致运行时报错
  db = {
    items: Array.isArray(parsed.items) ? parsed.items : [],
    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    users: Array.isArray(parsed.users) && parsed.users.length ? parsed.users : deriveUsers(parsed.items || []),
    // 评论 / 举报 / 评价是后加的三张表：旧 db.json 里没有这三项时在内存里补成空数组，
    // 首次写入时自然落盘（初始化为 []，不需要迁移脚本）
    comments: Array.isArray(parsed.comments) ? parsed.comments : [],
    reports: Array.isArray(parsed.reports) ? parsed.reports : [],
    ratings: Array.isArray(parsed.ratings) ? parsed.ratings : [],
    // 会话 / 收藏 / 浏览记录同样是后加的三张表：旧 db.json 里没有时补成空数组，
    // 已有数据一个字段都不动（writeDb 写的是整个 db 对象，缺的表就此自然落盘）。
    conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
    favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
    historyEntries: Array.isArray(parsed.historyEntries) ? parsed.historyEntries : [],
    accounts: needsSeedAccounts ? buildSeedAccounts() : parsed.accounts
  };
  if (needsSeedAccounts || needsNewTables) writeDb();
  return { initialized: false, items: db.items.length };
}

// ---------- 工具函数 ----------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** 客户端自带 id：非空字符串、不含斜杠、长度不超过 64，否则视为未提供。 */
function normalizeClientId(value) {
  if (!isNonEmptyString(value)) return null;
  const id = value.trim();
  if (id.length > LIMITS.id || id.indexOf('/') !== -1 || id.indexOf('\\') !== -1) return null;
  return id;
}

function newId(prefix) {
  return prefix + '_' + crypto.randomUUID();
}

/** 按 id 稳定地挑一个占位色，让列表看起来不单调。 */
function pickColor(seed) {
  let sum = 0;
  for (let i = 0; i < seed.length; i++) sum = (sum + seed.charCodeAt(i)) % 4096;
  return COVER_COLORS[sum % COVER_COLORS.length];
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value.trim());
}

/** 价格：允许数字或纯数字字符串，统一转成数字。 */
function toPrice(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  return NaN;
}

// ---------- 校验 ----------

function validateTitle(value, fields) {
  if (!isNonEmptyString(value)) {
    fields.title = '标题不能为空';
    return;
  }
  if (value.trim().length > LIMITS.title) fields.title = '标题不能超过 ' + LIMITS.title + ' 字';
}

function validatePrice(value, fields) {
  const price = toPrice(value);
  if (!Number.isFinite(price)) {
    fields.price = '必须是数字';
    return;
  }
  if (price <= 0) {
    fields.price = '必须大于 0';
    return;
  }
  if (price > LIMITS.price) fields.price = '不能超过 ' + LIMITS.price;
}

function validateEnum(value, allowed, label, fields, key) {
  if (allowed.indexOf(value) === -1) fields[key] = label + '不在允许范围内';
}

function validateDesc(value, fields) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') {
    fields.desc = '必须是字符串';
    return;
  }
  if (value.trim().length > LIMITS.desc) fields.desc = '描述不能超过 ' + LIMITS.desc + ' 字';
}

function validateStatus(value, fields) {
  if (ITEM_STATUS.indexOf(value) === -1) fields.status = '必须是 on 或 off';
}

function validateViews(value, fields) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fields.views = '必须是不小于 0 的整数';
  }
}

/** 新建商品：title / price / category / condition / campus 为必填。 */
function validateNewItem(input) {
  const fields = {};
  validateTitle(input.title, fields);
  validatePrice(input.price, fields);
  validateEnum(input.category, CATEGORIES, '分类', fields, 'category');
  validateEnum(input.condition, CONDITIONS, '成色', fields, 'condition');
  validateEnum(input.campus, CAMPUSES, '校区', fields, 'campus');
  validateDesc(input.desc, fields);
  if (input.sellerName !== undefined && input.sellerName !== null) {
    if (!isNonEmptyString(input.sellerName)) fields.sellerName = '不能为空';
    else if (input.sellerName.trim().length > LIMITS.sellerName) {
      fields.sellerName = '不能超过 ' + LIMITS.sellerName + ' 字';
    }
  }
  if (input.sellerId !== undefined && input.sellerId !== null && !isNonEmptyString(input.sellerId)) {
    fields.sellerId = '不能为空';
  }
  if (input.coverColor !== undefined && input.coverColor !== null && !isHexColor(input.coverColor)) {
    fields.coverColor = '必须是 #rrggbb 形式的颜色';
  }
  if (input.status !== undefined && input.status !== null) validateStatus(input.status, fields);
  if (input.views !== undefined && input.views !== null) validateViews(input.views, fields);
  return fields;
}

/** 局部更新：只校验请求里真实出现、且允许被改的字段。 */
const PATCHABLE = ['title', 'desc', 'price', 'category', 'condition', 'campus',
  'status', 'views', 'coverColor', 'coverImage', 'sellerName'];

function validateItemPatch(input) {
  const fields = {};
  if ('title' in input) validateTitle(input.title, fields);
  if ('price' in input) validatePrice(input.price, fields);
  if ('category' in input) validateEnum(input.category, CATEGORIES, '分类', fields, 'category');
  if ('condition' in input) validateEnum(input.condition, CONDITIONS, '成色', fields, 'condition');
  if ('campus' in input) validateEnum(input.campus, CAMPUSES, '校区', fields, 'campus');
  if ('desc' in input) validateDesc(input.desc, fields);
  if ('status' in input) validateStatus(input.status, fields);
  if ('views' in input) validateViews(input.views, fields);
  if ('coverColor' in input && !isHexColor(input.coverColor)) fields.coverColor = '必须是 #rrggbb 形式的颜色';
  if ('coverImage' in input && input.coverImage !== null && typeof input.coverImage !== 'string') {
    fields.coverImage = '必须是字符串或 null';
  }
  if ('sellerName' in input) {
    if (!isNonEmptyString(input.sellerName)) fields.sellerName = '不能为空';
    else if (input.sellerName.trim().length > LIMITS.sellerName) {
      fields.sellerName = '不能超过 ' + LIMITS.sellerName + ' 字';
    }
  }
  return fields;
}

// ---------- 商品 ----------

function listItems() {
  return db.items;
}

function countItems() {
  return db.items.length;
}

function getItem(id) {
  const item = db.items.find((one) => one.id === id);
  return item ? { item } : { error: 'NOT_FOUND' };
}

/**
 * 新建商品。
 * 若请求体带非空 id（前端乐观写入时客户端先生成）,直接使用该 id；否则服务端生成。
 */
function createItem(input) {
  if (!isPlainObject(input)) return { error: 'VALIDATION', fields: { body: '请求体必须是 JSON 对象' } };

  const fields = validateNewItem(input);
  if (Object.keys(fields).length) return { error: 'VALIDATION', fields };

  const clientId = normalizeClientId(input.id);
  const id = clientId || newId('i');
  if (db.items.some((one) => one.id === id)) return { error: 'ID_CONFLICT' };

  const item = {
    id,
    title: input.title.trim(),
    desc: typeof input.desc === 'string' ? input.desc.trim() : '',
    price: toPrice(input.price),
    category: input.category,
    condition: input.condition,
    campus: input.campus,
    sellerName: isNonEmptyString(input.sellerName) ? input.sellerName.trim() : SELF_USER.name,
    sellerId: isNonEmptyString(input.sellerId) ? input.sellerId.trim() : SELF_USER.id,
    coverColor: isHexColor(input.coverColor) ? input.coverColor.trim() : pickColor(id),
    coverImage: isNonEmptyString(input.coverImage) ? input.coverImage.trim() : null,
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
    status: input.status === 'off' ? 'off' : 'on',
    views: typeof input.views === 'number' ? input.views : 0
  };

  db.items.unshift(item); // 新发布的排在最前面，与前端列表逻辑一致
  writeDb();
  return { item };
}

function updateItem(id, patch) {
  if (!isPlainObject(patch)) return { error: 'VALIDATION', fields: { body: '请求体必须是 JSON 对象' } };
  const item = db.items.find((one) => one.id === id);
  if (!item) return { error: 'NOT_FOUND' };

  const fields = validateItemPatch(patch);
  if (Object.keys(fields).length) return { error: 'VALIDATION', fields };

  for (const key of PATCHABLE) {
    if (!(key in patch)) continue;
    if (key === 'price') item.price = toPrice(patch.price);
    else if (key === 'views') item.views = patch.views;
    else if (key === 'coverImage') item.coverImage = isNonEmptyString(patch.coverImage) ? patch.coverImage.trim() : null;
    else if (key === 'desc') item.desc = patch.desc === null ? '' : patch.desc.trim();
    else item[key] = typeof patch[key] === 'string' ? patch[key].trim() : patch[key];
  }

  writeDb();
  return { item };
}

function deleteItem(id) {
  const index = db.items.findIndex((one) => one.id === id);
  if (index === -1) return { error: 'NOT_FOUND' };

  db.items.splice(index, 1);
  db.messages = db.messages.filter((one) => one.itemId !== id); // 连同该商品的私信一起清理
  writeDb();
  return { ok: true };
}

// ---------- 私信 ----------

function listMessages(itemId) {
  return db.messages.filter((one) => one.itemId === itemId);
}

/** 新建私信：text 必填，from 只能是 me / seller（缺省 me）；id 支持客户端指定。 */
function createMessage(itemId, input) {
  if (!isPlainObject(input)) return { error: 'VALIDATION', fields: { body: '请求体必须是 JSON 对象' } };
  if (!db.items.some((one) => one.id === itemId)) {
    return { error: 'VALIDATION', fields: { itemId: '商品不存在' } };
  }

  const fields = {};
  if (!isNonEmptyString(input.text)) fields.text = '私信内容不能为空';
  else if (input.text.trim().length > LIMITS.text) fields.text = '不能超过 ' + LIMITS.text + ' 字';
  if (input.from !== undefined && input.from !== null && MESSAGE_FROM.indexOf(input.from) === -1) {
    fields.from = '必须是 me 或 seller';
  }
  if (Object.keys(fields).length) return { error: 'VALIDATION', fields };

  const clientId = normalizeClientId(input.id);
  const id = clientId || newId('m');
  if (db.messages.some((one) => one.id === id)) return { error: 'ID_CONFLICT' };

  const message = {
    id,
    itemId,
    from: input.from === 'seller' ? 'seller' : 'me',
    text: input.text.trim(),
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now()
  };

  db.messages.push(message);
  writeDb();
  return { message };
}

// ---------- 私信会话（一件商品 × 一个买家） ----------
// 与上面旧的扁平 messages 表并存：messages 仍按 itemId 存单条私信（老接口照旧可用），
// conversations 是新表，一次私信往来 = 一条会话，带 itemTitle / buyerName / sellerName 快照和两侧已读时间。
// 会话只在第一条消息真正发出来时才创建（懒创建）：只看不聊不会留下空会话。

const HISTORY_LIMIT = 30; // 浏览记录每人最多保留的条数（与小程序端一致）

/** 会话内消息归一化：from 只认 buyer / seller，时间统一叫 createdAt。 */
function normalizeStoredMessage(raw) {
  const one = isPlainObject(raw) ? raw : {};
  return {
    id: String(one.id || newId('m')),
    from: one.from === 'seller' ? 'seller' : 'buyer',
    text: String(one.text || ''),
    createdAt: Number(one.createdAt) || Date.now()
  };
}

/** 会话归一化：缺字段补默认值，手改过 / 旧版本的 db.json 也不会让接口报错。 */
function normalizeConversationEntry(raw) {
  const conv = isPlainObject(raw) ? raw : {};
  const list = Array.isArray(conv.messages) ? conv.messages : [];
  const messages = [];
  for (let i = 0; i < list.length; i += 1) messages.push(normalizeStoredMessage(list[i]));
  return {
    itemId: String(conv.itemId || ''),
    buyerId: String(conv.buyerId || ''),
    sellerId: String(conv.sellerId || ''),
    buyerName: String(conv.buyerName || '同学'),
    sellerName: String(conv.sellerName || '卖家'),
    itemTitle: String(conv.itemTitle || '闲置物品'),
    messages: messages,
    buyerReadAt: Number(conv.buyerReadAt) || 0,
    sellerReadAt: Number(conv.sellerReadAt) || 0
  };
}

/** 定位一条会话：返回 db.conversations 里的下标，找不到返回 -1。 */
function findConversationIndex(itemId, buyerId) {
  const id = String(itemId || '');
  const buyer = String(buyerId || '');
  for (let i = 0; i < db.conversations.length; i += 1) {
    if (String(db.conversations[i].itemId || '') === id && String(db.conversations[i].buyerId || '') === buyer) {
      return i;
    }
  }
  return -1;
}

/** 按商品 id 找商品（只用于会话快照兜底，不做存在性校验）。 */
function findItemById(id) {
  for (let i = 0; i < db.items.length; i += 1) {
    if (String(db.items[i].id) === String(id)) return db.items[i];
  }
  return null;
}

/** 按账号 id 找昵称：懒创建会话时用来兜底 buyerName / sellerName。 */
function findNicknameById(id) {
  for (let i = 0; i < db.accounts.length; i += 1) {
    if (String(db.accounts[i].id) === String(id)) {
      return String(db.accounts[i].nickname || db.accounts[i].realName || '');
    }
  }
  return '';
}

/**
 * 懒创建会话时的快照字段：请求体里传了的优先（客户端从 readMe() 取），
 * 没传的从 items / accounts 表兜底——读的是服务端自己的表，不需要客户端多请求一次。
 */
function resolveConversationSnapshot(itemId, buyerId, input) {
  const item = findItemById(itemId);
  const sellerId = String(input.sellerId || '') || (item ? String(item.sellerId || '') : '');
  return {
    sellerId: sellerId,
    itemTitle: String(input.itemTitle || '') || (item ? String(item.title || '') : '') || '闲置物品',
    buyerName: String(input.buyerName || '') || findNicknameById(buyerId) || '同学',
    sellerName: String(input.sellerName || '') || (item ? String(item.sellerName || '') : '') || findNicknameById(sellerId) || '卖家'
  };
}

/** 某会话对某人的未读数：对方发的、createdAt 比「我这一侧 ReadAt」新的条数。 */
function unreadCountFor(conv, userId) {
  const me = String(userId || '');
  const isSeller = me === conv.sellerId;
  const isBuyer = me === conv.buyerId;
  if (!isSeller && !isBuyer) return 0;
  const readAt = isSeller ? conv.sellerReadAt : conv.buyerReadAt;
  const fromOther = isSeller ? 'buyer' : 'seller';
  let count = 0;
  for (let i = 0; i < conv.messages.length; i += 1) {
    if (conv.messages[i].from === fromOther && conv.messages[i].createdAt > readAt) count += 1;
  }
  return count;
}

/** 读一条会话：不存在返回 null（绝不自动创建）。 */
function readConversationEntry(itemId, buyerId) {
  const index = findConversationIndex(itemId, buyerId);
  return index === -1 ? null : normalizeConversationEntry(db.conversations[index]);
}

/** 我参与的会话列表：过滤掉空会话，按最后一条消息时间倒序。 */
function listConversationsByUser(userId) {
  const me = String(userId || '');
  const list = [];
  if (!me) return list;
  for (let i = 0; i < db.conversations.length; i += 1) {
    const conv = normalizeConversationEntry(db.conversations[i]);
    const isSeller = me === conv.sellerId;
    const isBuyer = me === conv.buyerId;
    if (!isSeller && !isBuyer) continue;
    if (!conv.messages.length) continue; // 空会话不进列表
    const last = conv.messages[conv.messages.length - 1];
    list.push({
      itemId: conv.itemId,
      buyerId: conv.buyerId,
      itemTitle: conv.itemTitle,
      counterpartName: isSeller ? conv.buyerName : conv.sellerName,
      lastText: last.text,
      lastAt: last.createdAt,
      unread: unreadCountFor(conv, me)
    });
  }
  list.sort(function (a, b) { return (b.lastAt || 0) - (a.lastAt || 0); });
  return list;
}

/** tabBar 红点用「有未读的会话数」，不是未读消息条数。 */
function getUnreadTotalFor(userId) {
  const me = String(userId || '');
  let total = 0;
  if (!me) return total;
  for (let i = 0; i < db.conversations.length; i += 1) {
    const conv = normalizeConversationEntry(db.conversations[i]);
    if (me !== conv.sellerId && me !== conv.buyerId) continue;
    if (!conv.messages.length) continue;
    if (unreadCountFor(conv, me) > 0) total += 1;
  }
  return total;
}

/** 追加一条私信：会话不存在就懒创建（用请求体里的快照字段）。 */
function appendConversationMessage(itemId, buyerId, input) {
  const id = String(itemId || '');
  const buyer = String(buyerId || '');
  if (!id || !buyer) {
    return { error: 'VALIDATION', fields: { itemId: '商品 id 与买家 id 都不能为空' } };
  }
  const body = isPlainObject(input) ? input : {};
  const fields = {};
  if (body.from !== 'buyer' && body.from !== 'seller') fields.from = '必须是 buyer 或 seller';
  const text = String(body.text === undefined || body.text === null ? '' : body.text).trim();
  if (!text) fields.text = '私信内容不能为空';
  else if (text.length > LIMITS.text) fields.text = '不能超过 ' + LIMITS.text + ' 字';
  if (Object.keys(fields).length) return { error: 'VALIDATION', fields };

  let index = findConversationIndex(id, buyer);
  if (index === -1) {
    const snapshot = resolveConversationSnapshot(id, buyer, body);
    db.conversations.push({
      itemId: id,
      buyerId: buyer,
      sellerId: snapshot.sellerId,
      buyerName: snapshot.buyerName,
      sellerName: snapshot.sellerName,
      itemTitle: snapshot.itemTitle,
      messages: [],
      buyerReadAt: 0,
      sellerReadAt: 0
    });
    index = db.conversations.length - 1;
  } else if (!isPlainObject(db.conversations[index])) {
    db.conversations[index] = normalizeConversationEntry(db.conversations[index]);
  }

  const conv = db.conversations[index];
  if (!Array.isArray(conv.messages)) conv.messages = [];
  // 旧会话缺快照字段时补上，已有值一律不覆盖
  if (!conv.sellerId || !conv.itemTitle || !conv.buyerName || !conv.sellerName) {
    const snapshot = resolveConversationSnapshot(id, buyer, body);
    if (!conv.sellerId) conv.sellerId = snapshot.sellerId;
    if (!conv.itemTitle) conv.itemTitle = snapshot.itemTitle;
    if (!conv.buyerName) conv.buyerName = snapshot.buyerName;
    if (!conv.sellerName) conv.sellerName = snapshot.sellerName;
  }
  conv.messages.push(normalizeStoredMessage({ from: body.from, text: text, createdAt: Date.now() }));
  writeDb();
  return { conversation: normalizeConversationEntry(conv) };
}

/** 标记已读：只更新传进来的那个用户自己那一侧的 ReadAt。 */
function markConversationReadBy(itemId, buyerId, userId) {
  const me = String(userId || '');
  if (!me) return { error: 'VALIDATION', fields: { userId: '缺少 userId' } };
  const index = findConversationIndex(itemId, buyerId);
  if (index === -1) return { error: 'NOT_FOUND' };
  if (!isPlainObject(db.conversations[index])) {
    db.conversations[index] = normalizeConversationEntry(db.conversations[index]);
  }
  const conv = db.conversations[index];
  const now = Date.now();
  // 与买家 / 卖家都对不上的人：原样返回，不改任何数据
  if (me === String(conv.sellerId || '')) conv.sellerReadAt = now;
  else if (me === String(conv.buyerId || '')) conv.buyerReadAt = now;
  else return { conversation: normalizeConversationEntry(conv) };
  writeDb();
  return { conversation: normalizeConversationEntry(conv) };
}

// ---------- 收藏（服务端 favorites 表：一条 { userId, itemId, createdAt }） ----------

/** 某人的收藏 id 列表，最近收藏的排最前面（与旧版本地 storage 的顺序一致）。 */
function listFavoriteIds(userId) {
  const me = String(userId || '');
  const ids = [];
  if (!me) return ids;
  for (let i = db.favorites.length - 1; i >= 0; i -= 1) {
    if (String(db.favorites[i].userId || '') === me) ids.push(String(db.favorites[i].itemId || ''));
  }
  return ids;
}

/** 收藏开关：已收藏则取消、未收藏则加上，返回 { favorited, itemIds }。 */
function toggleFavoriteFor(userId, itemId) {
  const me = String(userId || '');
  const id = String(itemId || '');
  const fields = {};
  if (!me) fields.userId = '缺少 userId';
  if (!id) fields.itemId = '缺少 itemId';
  if (Object.keys(fields).length) return { error: 'VALIDATION', fields };

  let index = -1;
  for (let i = 0; i < db.favorites.length; i += 1) {
    if (String(db.favorites[i].userId || '') === me && String(db.favorites[i].itemId || '') === id) {
      index = i;
      break;
    }
  }
  let favorited;
  if (index === -1) {
    db.favorites.push({ userId: me, itemId: id, createdAt: Date.now() });
    favorited = true;
  } else {
    db.favorites.splice(index, 1);
    favorited = false;
  }
  writeDb();
  return { favorited: favorited, itemIds: listFavoriteIds(me) };
}

// ---------- 浏览记录（服务端 historyEntries 表：一条 { userId, itemId, viewedAt }） ----------

/** 某人的浏览记录：按 viewedAt 倒序。 */
function listHistoryEntries(userId) {
  const me = String(userId || '');
  const list = [];
  if (!me) return list;
  for (let i = 0; i < db.historyEntries.length; i += 1) {
    const one = db.historyEntries[i];
    if (String(one.userId || '') !== me) continue;
    list.push({ itemId: String(one.itemId || ''), viewedAt: Number(one.viewedAt) || 0 });
  }
  list.sort(function (a, b) { return (b.viewedAt || 0) - (a.viewedAt || 0); });
  return list;
}

/** 记一条浏览：同一商品只留一条并更新时间，最多保留最近 30 条，返回完整列表。 */
function addHistoryFor(userId, itemId) {
  const me = String(userId || '');
  const id = String(itemId || '');
  const fields = {};
  if (!me) fields.userId = '缺少 userId';
  if (!id) fields.itemId = '缺少 itemId';
  if (Object.keys(fields).length) return { error: 'VALIDATION', fields };

  const now = Date.now();
  let index = -1;
  for (let i = 0; i < db.historyEntries.length; i += 1) {
    const one = db.historyEntries[i];
    if (String(one.userId || '') === me && String(one.itemId || '') === id) {
      index = i;
      break;
    }
  }
  if (index === -1) db.historyEntries.push({ userId: me, itemId: id, viewedAt: now });
  else db.historyEntries[index].viewedAt = now;

  // 只截断当前用户自己的记录：按时间倒序留下前 30 条，其余从表里删掉
  const mine = [];
  for (let i = 0; i < db.historyEntries.length; i += 1) {
    if (String(db.historyEntries[i].userId || '') === me) mine.push(db.historyEntries[i]);
  }
  if (mine.length > HISTORY_LIMIT) {
    mine.sort(function (a, b) { return (Number(b.viewedAt) || 0) - (Number(a.viewedAt) || 0); });
    const dropped = mine.slice(HISTORY_LIMIT);
    db.historyEntries = db.historyEntries.filter(function (one) {
      return dropped.indexOf(one) === -1;
    });
  }
  writeDb();
  return { entries: listHistoryEntries(me) };
}

/** 清空某个人的浏览记录（其它用户的记录一条都不动）。 */
function clearHistoryFor(userId) {
  const me = String(userId || '');
  if (!me) return { error: 'VALIDATION', fields: { userId: '缺少 userId' } };
  db.historyEntries = db.historyEntries.filter(function (one) {
    return String(one.userId || '') !== me;
  });
  writeDb();
  return { ok: true };
}

// ---------- 评论 ----------
// 【重要设计约束】评论不校验商品是否存在于服务端，只在写入时存一份 itemTitle 快照。
// 原因：小程序的商品数据仍然放在本机 storage（pages/publish 写的是本地列表），
// 用户新发布的商品服务端根本不知道；一旦拿 db.items 做存在性校验，
// 本机新商品的评论会被直接 400 拒掉，前端也就没法评论自己刚发的东西。

/** 某件商品的评论：只返回未软删的，按时间正序（像讨论串一样往下读）。 */
function listComments(itemId) {
  const id = String(itemId || '');
  return db.comments.filter((one) => one.deleted !== true && (id === '' || one.itemId === id));
}

function createComment(input) {
  if (!isPlainObject(input)) return { error: 'VALIDATION', fields: { body: '请求体必须是 JSON 对象' } };

  const fields = {};
  const itemId = isNonEmptyString(input.itemId) ? input.itemId.trim() : '';
  const text = isNonEmptyString(input.text) ? input.text.trim() : '';
  if (!itemId) fields.itemId = '不能为空';
  else if (itemId.length > LIMITS.id) fields.itemId = '不能超过 ' + LIMITS.id + ' 个字符';
  if (!text) fields.text = '评论内容不能为空';
  else if (text.length > LIMITS.commentText) fields.text = '不能超过 ' + LIMITS.commentText + ' 字';
  if (Object.keys(fields).length) return { error: 'VALIDATION', fields };

  const clientId = normalizeClientId(input.id);
  const id = clientId || newId('c');
  if (db.comments.some((one) => one.id === id)) return { error: 'ID_CONFLICT' };

  const comment = {
    id,
    itemId,
    itemTitle: typeof input.itemTitle === 'string' ? input.itemTitle.trim() : '',
    userId: isNonEmptyString(input.userId) ? input.userId.trim() : SELF_USER.id,
    userName: isNonEmptyString(input.userName) ? input.userName.trim() : SELF_USER.name,
    text,
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
    deleted: false
  };

  db.comments.push(comment);
  writeDb();
  return { comment };
}

/** 软删：只把 deleted 置 true，记录本身留在 db.json 里便于追溯。 */
function deleteComment(id) {
  const comment = db.comments.find((one) => one.id === id);
  if (!comment) return { error: 'NOT_FOUND' };
  comment.deleted = true;
  writeDb();
  return { ok: true };
}

// ---------- 举报 / 投诉 ----------
// 与评论同理：不校验商品是否存在于服务端，只存 itemTitle 快照（见上面评论区的说明）。
// status：pending 待处理 / handled 已处理。管理员 PATCH 时写入 handledAt 与 handledBy。

const REPORT_STATUS = ['pending', 'handled'];

/** 举报列表：status 为空则返回全部；后台按时间倒序看（最新的排最前）。 */
function listReports(status) {
  const want = String(status || '');
  return db.reports
    .filter((one) => want === '' || one.status === want)
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function createReport(input) {
  if (!isPlainObject(input)) return { error: 'VALIDATION', fields: { body: '请求体必须是 JSON 对象' } };

  const fields = {};
  const itemId = isNonEmptyString(input.itemId) ? input.itemId.trim() : '';
  const reason = isNonEmptyString(input.reason) ? input.reason.trim() : '';
  const detail = typeof input.detail === 'string' ? input.detail.trim() : '';
  if (!itemId) fields.itemId = '不能为空';
  else if (itemId.length > LIMITS.id) fields.itemId = '不能超过 ' + LIMITS.id + ' 个字符';
  if (!reason) fields.reason = '请选择举报原因';
  else if (reason.length > 40) fields.reason = '不能超过 40 字';
  if (detail.length > LIMITS.reportDetail) fields.detail = '不能超过 ' + LIMITS.reportDetail + ' 字';
  if (Object.keys(fields).length) return { error: 'VALIDATION', fields };

  const clientId = normalizeClientId(input.id);
  const id = clientId || newId('r');
  if (db.reports.some((one) => one.id === id)) return { error: 'ID_CONFLICT' };

  const report = {
    id,
    itemId,
    itemTitle: typeof input.itemTitle === 'string' ? input.itemTitle.trim() : '',
    targetUserId: isNonEmptyString(input.targetUserId) ? input.targetUserId.trim() : '',
    targetName: isNonEmptyString(input.targetName) ? input.targetName.trim() : '',
    reporterId: isNonEmptyString(input.reporterId) ? input.reporterId.trim() : SELF_USER.id,
    reporterName: isNonEmptyString(input.reporterName) ? input.reporterName.trim() : SELF_USER.name,
    reason,
    detail,
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
    status: 'pending',
    handledAt: null,
    handledBy: ''
  };

  db.reports.push(report);
  writeDb();
  return { report };
}

/** 管理员处理举报：只接受 status === 'handled'，并记下处理人与处理时间。 */
function handleReport(id, status, handledBy) {
  if (REPORT_STATUS.indexOf(status) === -1) {
    return { error: 'VALIDATION', fields: { status: '只能是 pending 或 handled' } };
  }
  const report = db.reports.find((one) => one.id === id);
  if (!report) return { error: 'NOT_FOUND' };

  report.status = status;
  report.handledAt = status === 'handled' ? Date.now() : null;
  report.handledBy = status === 'handled' ? String(handledBy || '') : '';
  writeDb();
  return { report };
}

// ---------- 信用评价 ----------
// 一条评价 = 一次「某件已售出商品上，买家 ↔ 卖家」的互评；软删字段与评论一致。
// 规则：score 必须是 1-5 的整数；同一 (itemId, fromUserId) 只能评一次，重复返回 ALREADY_RATED。

function ratingSummary(list) {
  const rows = list.filter((one) => one.deleted !== true);
  if (!rows.length) return { average: 0, count: 0 };
  const sum = rows.reduce((acc, one) => acc + (Number(one.score) || 0), 0);
  return { average: Math.round((sum / rows.length) * 10) / 10, count: rows.length };
}

/** 某个用户收到的评价：userId 为空则返回全部；average 保留一位小数。 */
function listRatings(userId) {
  const id = String(userId || '');
  const ratings = db.ratings.filter((one) => one.deleted !== true && (id === '' || one.toUserId === id));
  const summary = ratingSummary(ratings);
  return { ratings, average: summary.average, count: summary.count };
}

function createRating(input) {
  if (!isPlainObject(input)) return { error: 'VALIDATION', fields: { body: '请求体必须是 JSON 对象' } };

  const fields = {};
  const itemId = isNonEmptyString(input.itemId) ? input.itemId.trim() : '';
  const fromUserId = isNonEmptyString(input.fromUserId) ? input.fromUserId.trim() : '';
  const toUserId = isNonEmptyString(input.toUserId) ? input.toUserId.trim() : '';
  if (!itemId) fields.itemId = '不能为空';
  else if (itemId.length > LIMITS.id) fields.itemId = '不能超过 ' + LIMITS.id + ' 个字符';
  if (!fromUserId) fields.fromUserId = '不能为空';
  if (!toUserId) fields.toUserId = '不能为空';
  if (fromUserId && fromUserId === toUserId) fields.toUserId = '不能评价自己';

  const score = input.score;
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
    fields.score = '必须是 1-5 的整数';
  }
  const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
  if (comment.length > LIMITS.ratingComment) fields.comment = '不能超过 ' + LIMITS.ratingComment + ' 字';
  if (Object.keys(fields).length) return { error: 'VALIDATION', fields };

  // 同一件商品、同一个人只能评一次（软删的老记录不占用名额）
  const dup = db.ratings.some((one) => one.deleted !== true && one.itemId === itemId && one.fromUserId === fromUserId);
  if (dup) return { error: 'ALREADY_RATED' };

  const clientId = normalizeClientId(input.id);
  const id = clientId || newId('t');
  if (db.ratings.some((one) => one.id === id)) return { error: 'ID_CONFLICT' };

  const rating = {
    id,
    itemId,
    itemTitle: typeof input.itemTitle === 'string' ? input.itemTitle.trim() : '',
    fromUserId,
    fromName: isNonEmptyString(input.fromName) ? input.fromName.trim() : SELF_USER.name,
    toUserId,
    toName: isNonEmptyString(input.toName) ? input.toName.trim() : '',
    score,
    comment,
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
    deleted: false
  };

  db.ratings.push(rating);
  writeDb();
  return { rating };
}

/** 软删评价：管理员在后台删掉不合适的评价，average 会随之下调。 */
function deleteRating(id) {
  const rating = db.ratings.find((one) => one.id === id);
  if (!rating) return { error: 'NOT_FOUND' };
  rating.deleted = true;
  writeDb();
  return { ok: true };
}

// ---------- 后台统计 ----------

/** 数据概览：所有计数都只算「未软删」的记录，与列表接口口径一致。 */
function adminStats() {
  const comments = db.comments.filter((one) => one.deleted !== true);
  const ratings = ratingSummary(db.ratings);
  return {
    items: db.items.length,
    comments: comments.length,
    reports: db.reports.length,
    pendingReports: db.reports.filter((one) => one.status === 'pending').length,
    ratings: ratings.count,
    averageRating: ratings.average
  };
}

// ---------- 用户 / 校内身份校验 ----------

function getUser(id) {
  const user = db.users.find((one) => one.id === id);
  return user ? { user } : { error: 'NOT_FOUND' };
}

/** 校内身份校验：12 位数字学号 + 至少 2 个字的真实姓名。 */
function verifyStudent(input) {
  if (!isPlainObject(input)) return { fields: { body: '请求体必须是 JSON 对象' } };

  const fields = {};
  const studentId = isNonEmptyString(input.studentId) ? input.studentId.trim() : '';
  const realName = isNonEmptyString(input.realName) ? input.realName.trim() : '';
  const idSource = studentId || (typeof input.studentId === 'number' ? String(input.studentId) : '');

  if (!/^\d{12}$/.test(idSource)) fields.studentId = '学号必须为 12 位数字';
  if (realName.length < 2) fields.realName = '请填写真实姓名（至少 2 个字）';
  if (Object.keys(fields).length) return { fields };

  // 校验通过：把结果写回当前演示用户，下次 GET /api/users/u_self 就能看到
  const user = db.users.find((one) => one.id === SELF_USER.id);
  const updated = user || { ...SELF_USER, itemsCount: 0 };
  updated.studentId = idSource;
  updated.realName = realName;
  updated.verified = true;
  if (!user) db.users.push(updated);
  writeDb();
  return { user: updated };
}

// ---------- 账号表：注册 / 登录 / 脱敏列表 ----------
// 规则与 miniprogram/utils/api.js 的本地校验逐条对齐（学号 12 位数字、姓名至少 2 个字、
// 昵称 1-12 个字、密码至少 6 位、学号不可重复），顺序也一致，前端只负责把文案弹出来。
// 对外返回一律走 sanitizeAccount：passwordHash / salt 永远不出这个文件。

/** 脱敏账号：不含 passwordHash / salt，也不含任何密码相关字段。 */
function sanitizeAccount(account) {
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

function findAccountByStudentId(studentId) {
  const id = String(studentId || '');
  return db.accounts.find((one) => one.studentId === id) || null;
}

/** 按 id 取脱敏账号；不存在返回 null（对外接口只暴露脱敏视图）。 */
function findAccountById(id) {
  const target = String(id || '');
  const account = db.accounts.find((one) => one.id === target);
  return account ? sanitizeAccount(account) : null;
}

/** 账号 id = u_ + 学号后 6 位；撞了就追加随机后缀，最多试 20 次（与前端旧规则一致）。 */
function makeAccountId(studentId) {
  const base = 'u_' + String(studentId || '').slice(-6);
  let candidate = base;
  let guard = 0;
  while (db.accounts.some((one) => one.id === candidate) && guard < 20) {
    candidate = base + '_' + crypto.randomBytes(2).toString('hex');
    guard += 1;
  }
  return candidate;
}

/**
 * 注册：校验顺序 学号格式 → 姓名 → 昵称 → 密码 → 学号是否重复，
 * 只为「学号重复」单独返回 STUDENT_ID_EXISTS（409），其余返回 VALIDATION + fields。
 * 校验全过才生成 salt、哈希密码并落盘，明文密码不进入任何持久化结构。
 */
function createAccount(input) {
  if (!isPlainObject(input)) return { error: 'VALIDATION', fields: { body: '请求体必须是 JSON 对象' } };

  const fields = {};
  const studentId = isNonEmptyString(input.studentId) ? input.studentId.trim() : '';
  const realName = isNonEmptyString(input.realName) ? input.realName.trim() : '';
  const nickname = isNonEmptyString(input.nickname) ? input.nickname.trim() : '';
  const campus = isNonEmptyString(input.campus) ? input.campus.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';

  // 顺序与前端 register() 完全一致：学号格式 → 是否已注册 → 姓名 → 昵称 → 密码。
  // 学号格式不过就直接返回，不再判断重复；格式正确但已注册时先给 409，不掺和其它字段错误。
  if (!/^[0-9]{12}$/.test(studentId)) {
    fields.studentId = '学号必须为 12 位数字';
    return { error: 'VALIDATION', fields };
  }
  if (findAccountByStudentId(studentId)) return { error: 'STUDENT_ID_EXISTS' };
  if (realName.length < 2) fields.realName = '请输入真实姓名';
  if (!nickname || nickname.length > 12) fields.nickname = '昵称需在 1-12 个字之间';
  if (password.length < 6) fields.password = '密码至少 6 位';
  if (Object.keys(fields).length) return { error: 'VALIDATION', fields };

  const salt = makeSalt();
  const account = {
    id: makeAccountId(studentId),
    studentId,
    realName,
    nickname,
    // 校区不在允许列表里时回落到第一个，与前端 register() 的兜底一致
    campus: CAMPUSES.indexOf(campus) === -1 ? CAMPUSES[0] : campus,
    createdAt: Date.now(),
    status: 'normal',
    bannedUntil: 0,
    salt,
    passwordHash: hashPassword(password, salt)
  };

  db.accounts.push(account);
  writeDb();
  return { account: sanitizeAccount(account) };
}

/**
 * 登录校验：学号 + 密码同时匹配才返回脱敏账号，否则一律返回 null。
 * 学号不存在时也照样算一次 scrypt，避免用响应时间判断某个学号是否已注册。
 */
function verifyAccount(studentId, password) {
  const account = findAccountByStudentId(isNonEmptyString(studentId) ? studentId.trim() : '');
  const pwd = typeof password === 'string' ? password : '';
  if (!account) {
    hashPassword(pwd, DUMMY_SALT); // 只为让耗时贴近命中分支，结果丢弃
    return null;
  }
  if (!pwd) return null;
  const hash = hashPassword(pwd, account.salt);
  if (!safeEqualHex(hash, account.passwordHash)) return null;
  return sanitizeAccount(account);
}

/** 账号表（脱敏）：给 GET /api/accounts 和调试用，绝不包含 passwordHash / salt。 */
function listAccountsPublic() {
  return db.accounts.map(sanitizeAccount);
}

module.exports = {
  DB_FILE,
  SEED_FILE,
  CATEGORIES,
  CONDITIONS,
  CAMPUSES,
  ITEM_STATUS,
  MESSAGE_FROM,
  REPORT_STATUS,
  LIMITS,
  SELF_USER,
  loadDb,
  countItems,
  listItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  listMessages,
  createMessage,
  listConversationsByUser,
  readConversationEntry,
  appendConversationMessage,
  markConversationReadBy,
  getUnreadTotalFor,
  listFavoriteIds,
  toggleFavoriteFor,
  listHistoryEntries,
  addHistoryFor,
  clearHistoryFor,
  HISTORY_LIMIT,
  getUser,
  verifyStudent,
  createAccount,
  verifyAccount,
  listAccountsPublic,
  findAccountById,
  listComments,
  createComment,
  deleteComment,
  listReports,
  createReport,
  handleReport,
  listRatings,
  createRating,
  deleteRating,
  adminStats
};
