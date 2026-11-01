/**
 * 海大易物 · 数据层
 * 只用 Node 内置模块（fs / path / crypto），不依赖任何第三方包。
 * 负责：db.json 的读写（原子写）、首次启动的种子数据初始化、
 *       商品 / 私信 / 用户的增删改查与字段校验。
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
const ITEM_STATUS = ['on', 'off'];
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
  id: 64            // 客户端自带 id 的长度上限
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
    db = { items: seed, messages: [], users: deriveUsers(seed) };
    writeDb();
    return { initialized: true, items: db.items.length };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    throw new Error('db.json 无法解析（' + err.message + '），请删除该文件后重启以重新初始化');
  }
  // 容错：字段缺失时补齐，避免旧文件导致运行时报错
  db = {
    items: Array.isArray(parsed.items) ? parsed.items : [],
    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    users: Array.isArray(parsed.users) && parsed.users.length ? parsed.users : deriveUsers(parsed.items || [])
  };
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

module.exports = {
  DB_FILE,
  SEED_FILE,
  CATEGORIES,
  CONDITIONS,
  CAMPUSES,
  ITEM_STATUS,
  MESSAGE_FROM,
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
  getUser,
  verifyStudent
};
