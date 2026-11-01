/**
 * 浏览记录：当前登录用户最近看过的商品，按最近浏览倒序（最多 30 条）
 * 数据来自 api.getHistory（storage 键 haidayiwu.v1.history.<userId>），商品已被删除的由数据层跳过。
 * 点条目进详情页；「清空」二次确认后调 api.clearHistory 并刷新列表。
 */
const api = require('../../utils/api.js');
const format = require('../../utils/format.js');

Page({
  data: {
    loading: true,
    records: [],
    count: 0
  },

  // 用 onShow：从详情页返回时刚看过的商品要排到最前面
  onShow() {
    this.loadList();
  },

  loadList() {
    const that = this;
    return api.getMe().then(function (me) {
      // 入口已经拦过未登录，这里只做防御
      if (!me) {
        wx.reLaunch({ url: '/pages/login/index' });
        return null;
      }
      return api.getHistory().then(function (items) {
        that.setData({
          loading: false,
          records: items.map(function (item) { return that.toView(item); }),
          count: items.length
        });
      });
    }).catch(function (err) {
      console.warn('[海大易物] 浏览记录加载失败', err);
      that.setData({ loading: false });
      wx.showToast({ title: '加载失败，请重试', icon: 'none' });
    });
  },

  // 视图字段：封面 / 标题 / 价格 / 校区都在 format.decorate 里算，浏览时间单独补一条
  toView(item) {
    const view = format.decorate(item);
    view.viewedText = format.formatTime(item.viewedAt) || '刚刚';
    return view;
  },

  goDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/detail/index?id=' + id });
  },

  onClear() {
    const that = this;
    if (!this.data.count) return;
    wx.showModal({
      title: '清空浏览记录',
      content: '清空后无法恢复，确定要清空吗？',
      success: function (res) {
        if (!res.confirm) return;
        api.clearHistory().then(function () {
          wx.showToast({ title: '已清空', icon: 'success' });
          that.loadList();
        }).catch(function (err) {
          console.warn('[海大易物] 清空浏览记录失败', err);
          wx.showToast({ title: '清空失败，请重试', icon: 'none' });
        });
      }
    });
  }
});
