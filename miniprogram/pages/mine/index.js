/**
 * 我的：当前用户卡片 + 消息中心 / 浏览记录两个入口 + 我发布的（在售 / 已下架 / 已售出）+ 我收藏的
 * 上下架是硬要求：这里把 status 改成 off 之后，首页列表（只显示 status === 'on'）立刻不再出现这条商品。
 * 已售出（status === 'sold'）的商品不允许再上架，卖出去了就该留在售出状态。
 * 「切换账号」「退出登录」两个按钮行为一致：清本地登录态 → reLaunch 回登录页。
 * Beta 新增：用户卡片显示我收到的信用评价（平均分 + 条数），数据来自服务端 /api/ratings。
 */
const api = require('../../utils/api.js');
const format = require('../../utils/format.js');
const badge = require('../../utils/badge.js');

Page({
  data: {
    user: {
      nickname: '',
      avatarChar: '',
      loginText: '未登录',
      studentIdMasked: '',
      campus: ''
    },
    // 我收到的信用评价，例如「⭐ 4.5 · 3 条评价」，没有评价时是「暂无评价」
    ratingText: '',
    posts: [],
    favorites: [],
    postsCount: 0,
    favoritesCount: 0,
    historyCount: 0,
    unreadTotal: 0,
    unreadText: ''
  },

  // 用 onShow：从详情页下架 / 取消收藏后返回，「我的」要立刻反映最新状态
  onShow() {
    this.loadAll();
  },

  loadAll() {
    const that = this;
    return Promise.all([api.getMe(), api.getItems(), api.getFavorites(), api.getHistory()]).then(function (res) {
      const me = res[0];
      // 入口已经拦过未登录，这里只做防御：拿不到当前用户就直接回登录页
      if (!me) {
        wx.reLaunch({ url: '/pages/login/index' });
        return null;
      }
      const items = res[1] || [];
      const favorites = res[2] || [];
      const history = res[3] || [];
      const posts = items.filter(function (item) { return item.sellerId === me.id; });

      that.setData({
        user: {
          nickname: me.nickname,
          avatarChar: String(me.nickname || '我').slice(0, 1),
          loginText: '已登录',
          studentIdMasked: format.maskStudentId(me.studentId),
          campus: me.campus
        },
        // 三种状态都在这里算好，WXML 只负责显示：在售 / 已下架 / 已售出
        posts: posts.map(function (item) {
          const view = format.decorate(item);
          view.actionText = view.statusSold ? '已售出' : (view.statusOn ? '下架' : '上架');
          view.actionDisabled = view.statusSold;
          return view;
        }),
        favorites: favorites.map(format.decorate),
        postsCount: posts.length,
        favoritesCount: favorites.length,
        historyCount: history.length
      });

      // 信用评价：单独一次请求，失败也不影响页面其它内容
      that.loadRating(me.id);

      // 未读私信数：消息中心入口和 tabBar 红点共用这一份
      return api.getUnreadTotal(me.id).then(function (total) {
        const count = Number(total) || 0;
        that.setData({ unreadTotal: count, unreadText: count > 9 ? '9+' : String(count) });
        badge.update();
      });
    }).catch(function (err) {
      console.warn('[海大易物] 我的页面加载失败', err);
      wx.showToast({ title: '加载失败，请重试', icon: 'none' });
    });
  },

  // 我收到的信用评价：⭐ 4.5 · 3 条评价；一条都没有时显示「暂无评价」。
  // 后端没启动时静默忽略（不弹 toast），不影响页面上其它内容
  loadRating(userId) {
    const that = this;
    if (!userId) return Promise.resolve();
    return api.getUserRatings(userId).then(function (res) {
      const count = Number(res.count) || 0;
      const average = Number(res.average) || 0;
      that.setData({ ratingText: count ? '⭐ ' + average + ' · ' + count + ' 条评价' : '暂无评价' });
    }).catch(function (err) {
      console.warn('[海大易物] 信用评价加载失败', err);
    });
  },

  // 上架 / 下架切换：已售出的商品不允许再上架
  onToggleStatus(event) {
    const id = event.currentTarget.dataset.id;
    const status = event.currentTarget.dataset.status;
    const target = (this.data.posts || []).filter(function (item) { return item.id === id; })[0];
    if (target && target.statusSold) {
      wx.showToast({ title: '已售出的物品不能重新上架', icon: 'none' });
      return;
    }
    api.setItemStatus(id, status).then(() => {
      wx.showToast({ title: status === 'off' ? '已下架' : '已上架', icon: 'success' });
      this.loadAll();
    }).catch((err) => {
      console.warn('[海大易物] 上下架失败', err);
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
    });
  },

  onUnfavorite(event) {
    const id = event.currentTarget.dataset.id;
    api.toggleFavorite(id).then(() => {
      this.loadAll();
    }).catch((err) => {
      console.warn('[海大易物] 取消收藏失败', err);
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
    });
  },

  goDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/detail/index?id=' + id });
  },

  // 消息中心：未读会话一览
  goMessages() {
    wx.navigateTo({ url: '/pages/messages/index' });
  },

  // 浏览记录：最近看过的商品
  goHistory() {
    wx.navigateTo({ url: '/pages/history/index' });
  },

  onSwitchAccount() {
    wx.showModal({
      title: '切换账号',
      content: '切换账号将退出当前登录，是否继续？',
      success: (res) => {
        if (res.confirm) this.exitToLogin();
      }
    });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) this.exitToLogin();
      }
    });
  },

  // 两个按钮落地行为一致：清本地登录态 → reLaunch 回登录页
  exitToLogin() {
    api.logout();
    wx.reLaunch({ url: '/pages/login/index' });
  }
});
