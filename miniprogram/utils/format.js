/**
 * 海大易物 · 通用工具
 * 纯函数集合，不依赖 wx / api，页面和数据层都可以 require。
 * 对应 H5 版的 web/js/util.js，规则与文案保持一致。
 */

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 安全转义。
 * 小程序 WXML 的 {{}} 本身就会转义文本，页面不直接调用它；
 * 保留这个函数是为了与 H5 版接口对齐，将来需要把用户输入拼进 rich-text 或日志时直接可用。
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, function (ch) {
    return ESCAPE_MAP[ch];
  });
}

// 25 -> ¥25，25.5 -> ¥25.50，非法值按 0 处理
function formatPrice(price) {
  let value = Number(price);
  if (!isFinite(value)) value = 0;
  return '¥' + (value % 1 === 0 ? String(value) : value.toFixed(2));
}

// 列表里显示「3小时前」这类相对时间，超过一周显示日期
function formatTime(timestamp) {
  const time = Number(timestamp) || 0;
  if (!time) return '';
  const diff = Date.now() - time;
  if (diff < MINUTE) return '刚刚';
  if (diff < HOUR) return Math.floor(diff / MINUTE) + '分钟前';
  if (diff < DAY) return Math.floor(diff / HOUR) + '小时前';
  if (diff < 7 * DAY) return Math.floor(diff / DAY) + '天前';
  const date = new Date(time);
  return (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

// 私信气泡上的时分
function formatClock(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

// 学号脱敏：220100010823 -> 2201****0823
function maskStudentId(studentId) {
  const value = String(studentId || '');
  if (value.length !== 12) return value || '未填写';
  return value.slice(0, 4) + '****' + value.slice(-4);
}

/**
 * 把一条商品数据整理成页面直接可用的字段，
 * 免得列表 / 详情 / 我的各写一遍价格、时间、封面色块的计算。
 */
function decorate(item) {
  const safe = item || {};
  const title = String(safe.title || '未命名物品');
  // 'on' 在售 / 'off' 已下架 / 'sold' 已售出（与 utils/api.js 的 normalizeItem 保持一致）
  const status = safe.status === 'off' ? 'off' : (safe.status === 'sold' ? 'sold' : 'on');
  return {
    id: String(safe.id || ''),
    title: title,
    desc: String(safe.desc || ''),
    price: Number(safe.price) || 0,
    priceText: formatPrice(safe.price),
    timeText: formatTime(safe.createdAt),
    createdAt: Number(safe.createdAt) || 0,
    coverChar: title.slice(0, 1),
    coverBg: safe.coverImage ? '#f1f5f9' : String(safe.coverColor || '#e5e7eb'),
    coverImage: String(safe.coverImage || ''),
    category: String(safe.category || ''),
    condition: String(safe.condition || ''),
    campus: String(safe.campus || ''),
    sellerName: String(safe.sellerName || ''),
    sellerId: String(safe.sellerId || ''),
    sellerChar: String(safe.sellerName || '卖').slice(0, 1),
    status: status,
    statusOn: status === 'on',
    statusSold: status === 'sold',
    statusClass: status,
    statusText: status === 'on' ? '在售中' : (status === 'sold' ? '已售出' : '已下架'),
    views: Number(safe.views) || 0
  };
}

module.exports = {
  escapeHtml: escapeHtml,
  formatPrice: formatPrice,
  formatTime: formatTime,
  formatClock: formatClock,
  maskStudentId: maskStudentId,
  decorate: decorate
};
