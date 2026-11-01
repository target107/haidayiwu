/**
 * 商品详情
 * 结构、文案、面交提示与 H5 版 renderDetail 一致：
 * 大图/色块 → 标题 → 价格+浏览 → 属性表 → 卖家卡片 → 描述 → 底部固定条（收藏 + 联系卖家 + 返回首页）。
 * 卖家是自己时（item.sellerId === 当前登录用户 id）不给「联系卖家」，也不能自己跟自己聊。
 */
const api = require('../../utils/api.js');
const format = require('../../utils/format.js');

const SAFE_TIP = '平台不提供线上支付，建议在崂山/鱼山等校区公共区域面交';

Page({
  data: {
    loading: true,
    notFound: false,
    item: null,
    mine: false,
    favorite: false,
    favoriteText: '收藏',
    sellerNote: '',
    descText: '',
    safeTip: SAFE_TIP,
    statusTag: '',        // '' 在售 / '已下架' / '已售出'
    statusClass: '',
    canContact: false     // 只有「别人的」且「在售」的才给联系卖家
  },

  onLoad(options) {
    this.itemId = (options && options.id) || '';
    this.loadItem();
  },

  loadItem() {
    if (!this.itemId) {
      this.setData({ loading: false, notFound: true });
      return Promise.resolve();
    }
    const that = this;
    return Promise.all([
      api.getItemById(this.itemId),
      api.getFavorites(),
      api.getMe()
    ]).then(function (res) {
      const item = res[0];
      const favorites = res[1] || [];
      const me = res[2];
      // 商品不存在（下架 / 删除）时直接进 notFound，不累加浏览量
      if (!item) {
        that.setData({ loading: false, notFound: true, item: null });
        return null;
      }
      that.applyItem(item, favorites, me);
      // 浏览量：只有商品存在才 +1，并用手上的最新数据刷新页面
      return api.bumpViews(item.id).then(function (updated) {
        if (updated) that.applyItem(updated, favorites, me);
        // 浏览记录：未登录时数据层静默返回 false，不抛错、也不影响详情页展示
        return api.addHistory(item.id);
      });
    }).catch(function (err) {
      console.warn('[海大易物] 详情加载失败', err);
      that.setData({ loading: false, notFound: true });
      wx.showToast({ title: '加载失败，请返回重试', icon: 'none' });
    });
  },

  // 详情页所有展示字段都在这里算，loadItem 与 bumpViews 回来后各调一次
  applyItem(item, favorites, me) {
    const view = format.decorate(item);
    // me 为 null 表示未登录：这时的商品一律按「别人的」展示，不会误伤按钮
    const mine = !!me && item.sellerId === me.id;
    const favorite = favorites.some(function (fav) { return fav.id === item.id; });
    const onSale = view.status === 'on';
    this.setData({
      loading: false,
      notFound: false,
      item: view,
      mine: mine,
      favorite: favorite,
      favoriteText: favorite ? '已收藏' : '收藏',
      sellerNote: mine ? '这是我发布的物品' : '校内同学 · ' + view.campus,
      descText: view.desc ? view.desc : '卖家没有填写描述，可以私信问问细节。',
      statusTag: onSale ? '' : view.statusText,
      statusClass: onSale ? '' : view.status,
      canContact: !mine && onSale
    });
    wx.setNavigationBarTitle({ title: view.title || '物品详情' });
  },

  onToggleFavorite() {
    if (!this.itemId) return;
    api.toggleFavorite(this.itemId).then((added) => {
      this.setData({ favorite: added, favoriteText: added ? '已收藏' : '收藏' });
    }).catch((err) => {
      console.warn('[海大易物] 收藏失败', err);
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
    });
  },

  goChat() {
    if (!this.itemId) return;
    // 自己发布的物品不给私信（按钮已隐藏，这里再兜一层）
    if (this.data.mine) return;
    wx.navigateTo({ url: '/pages/chat/index?itemId=' + this.itemId });
  },

  // 所有详情页都有：发完东西想回主菜单，不用一路返回
  goHome() {
    wx.switchTab({ url: '/pages/list/index' });
  }
});
