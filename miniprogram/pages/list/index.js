/**
 * 首页 · 商品列表 + 搜索 + 筛选（分类 / 成色 / 价格区间）
 * 筛选规则、空状态文案与 H5 版 web/js/views.js 的 renderList 保持一致。
 */
const api = require('../../utils/api.js');
const format = require('../../utils/format.js');

const ALL = '全部';
const CATEGORIES = ['教材书籍', '自行车', '生活用品', '数码电子', '其他'];
const CONDITIONS = ['全新', '几乎全新', '轻微使用痕迹', '明显使用痕迹'];

// 价格区间用左闭右开区间，保证四档互不重叠
const PRICE_RANGES = [
  { label: '不限', match: function () { return true; } },
  { label: '50以下', match: function (price) { return price < 50; } },
  { label: '50-200', match: function (price) { return price >= 50 && price < 200; } },
  { label: '200-500', match: function (price) { return price >= 200 && price < 500; } },
  { label: '500以上', match: function (price) { return price >= 500; } }
];

function pickRange(label) {
  for (let i = 0; i < PRICE_RANGES.length; i += 1) {
    if (PRICE_RANGES[i].label === label) return PRICE_RANGES[i];
  }
  return PRICE_RANGES[0];
}

Page({
  data: {
    keyword: '',
    categoryChips: [ALL].concat(CATEGORIES),
    conditionChips: [ALL].concat(CONDITIONS),
    priceChips: PRICE_RANGES.map(function (range) { return range.label; }),
    campusChips: [ALL].concat(api.campuses),
    category: ALL,
    condition: ALL,
    price: '不限',
    campus: ALL,
    items: [],
    countText: '加载中…',
    loading: true
  },

  // 只挂 onShow：从详情 / 我的返回时列表要重新拉一次，下架的商品立刻消失
  onShow() {
    this.loadItems();
  },

  onPullDownRefresh() {
    this.loadItems().then(function () {
      wx.stopPullDownRefresh();
    });
  },

  loadItems() {
    return api.getItems().then((list) => {
      this.allItems = list;
      this.applyFilter();
    }).catch((err) => {
      console.warn('[海大易物] 商品列表加载失败', err);
      this.allItems = [];
      this.setData({ items: [], countText: '加载失败', loading: false });
      wx.showToast({ title: '列表加载失败，请下拉重试', icon: 'none' });
    });
  },

  // 搜索 + 四组筛选（分类 / 成色 / 价格 / 校区）都在内存里做；只显示在售（status === 'on'），下架和已售出都不显示
  applyFilter() {
    const state = this.data;
    const keyword = String(state.keyword || '').trim().toLowerCase();
    const range = pickRange(state.price);
    const all = this.allItems || [];

    const filtered = all.filter(function (item) {
      if (item.status !== 'on') return false;
      if (state.category !== ALL && item.category !== state.category) return false;
      if (state.condition !== ALL && item.condition !== state.condition) return false;
      if (state.campus !== ALL && item.campus !== state.campus) return false;
      if (!range.match(Number(item.price) || 0)) return false;
      if (!keyword) return true;
      return (String(item.title) + ' ' + String(item.desc || '')).toLowerCase().indexOf(keyword) !== -1;
    });

    this.setData({
      items: filtered.map(format.decorate),
      countText: filtered.length ? '共 ' + filtered.length + ' 件在售' : '暂无结果',
      loading: false
    });
  },

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
    this.applyFilter();
  },

  onCategoryTap(event) {
    this.setData({ category: event.currentTarget.dataset.value });
    this.applyFilter();
  },

  onConditionTap(event) {
    this.setData({ condition: event.currentTarget.dataset.value });
    this.applyFilter();
  },

  onPriceTap(event) {
    this.setData({ price: event.currentTarget.dataset.value });
    this.applyFilter();
  },

  onCampusTap(event) {
    this.setData({ campus: event.currentTarget.dataset.value });
    this.applyFilter();
  },

  onResetTap() {
    this.setData({ keyword: '', category: ALL, condition: ALL, price: '不限', campus: ALL });
    this.applyFilter();
  },

  goDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/detail/index?id=' + id });
  }
});
