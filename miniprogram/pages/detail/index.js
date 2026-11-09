/**
 * 商品详情
 * 结构、文案、面交提示与 H5 版 renderDetail 一致：
 * 大图/色块 → 标题 → 价格+浏览 → 属性表 → 卖家卡片 → 描述 → 底部固定条（收藏 + 联系卖家 + 返回首页）。
 * 卖家是自己时（item.sellerId === 当前登录用户 id）不给「联系卖家」，也不能自己跟自己聊。
 *
 * Beta 新增三块（评论 / 举报 / 评价卖家），三者都只存在于服务端，统一走 utils/api.js 的
 * remote 方法（api.getComments / addComment / addReport / submitRating / getUserRatings）：
 *   评论     —— 商品信息下方，进入详情页加载一次；未登录时点「发表」引导去登录
 *   举报     —— 标题右侧不显眼的文字按钮，登录后且不是自己发布的才出现
 *   评价卖家 —— 仅「已售出 + 当前用户是买家 + 已登录」，提交后按钮变成「已评价」
 */
const api = require('../../utils/api.js');
const format = require('../../utils/format.js');

const SAFE_TIP = '平台不提供线上支付，建议在崂山/鱼山等校区公共区域面交';
const REPORT_REASONS = ['虚假信息', '骚扰', '违禁品', '其他'];

// 评分弹层的五颗星：score 是这颗星代表的分值，on 决定它是否点亮
function buildStars(score) {
  const list = [];
  for (let i = 1; i <= 5; i += 1) {
    list.push({ score: i, on: i <= score });
  }
  return list;
}

// 一条评论 → 页面直接用：首字圆形头像 + 相对时间
function toCommentView(comment) {
  const raw = comment || {};
  const name = String(raw.userName || '同学');
  return {
    id: String(raw.id || ''),
    userName: name,
    avatarChar: name.slice(0, 1),
    text: String(raw.text || ''),
    timeText: format.formatTime(raw.createdAt)
  };
}

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
    canContact: false,    // 只有「别人的」且「在售」的才给联系卖家
    loggedIn: false,
    canReport: false,     // 登录 + 不是自己发布的物品，才显示「举报」
    commentText: '',
    comments: [],
    commentCount: 0,
    // 评价卖家
    canRateSeller: false, // 已售出 + 当前用户不是卖家 + 已登录
    ratedSeller: false,
    rateLayer: false,
    rateScore: 0,
    starList: buildStars(0),
    rateComment: ''
  },

  onLoad(options) {
    this.itemId = (options && options.id) || '';
    this.loadItem();
    this.loadComments();
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
      that.me = me;
      // 商品不存在（下架 / 删除）时直接进 notFound，不累加浏览量
      if (!item) {
        that.setData({ loading: false, notFound: true, item: null });
        return null;
      }
      that.applyItem(item, favorites, me);
      // 已售出的商品才需要查「我评价过没有」，其它情况不发多余请求
      that.checkSellerRating();
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
      canContact: !mine && onSale,
      loggedIn: !!me,
      // 举报：未登录不显示；自己发布的物品也藏起来（自己举报自己没意义）
      canReport: !!me && !mine,
      // 评价卖家：已售出 + 当前用户是买家（不是卖家）+ 已登录
      canRateSeller: !!me && !mine && view.status === 'sold'
    });
    wx.setNavigationBarTitle({ title: view.title || '物品详情' });
  },

  // ---------- 评论区 ----------

  // 每次进入详情页加载一次；后端没启动时降级成空列表 + 一次性提示，不影响页面其它内容
  loadComments() {
    const that = this;
    if (!this.itemId) return Promise.resolve();
    return api.getComments(this.itemId).then(function (list) {
      const views = (list || []).map(toCommentView);
      that.setData({ comments: views, commentCount: views.length });
    }).catch(function (err) {
      that.setData({ comments: [], commentCount: 0 });
      console.warn('[海大易物] 评论加载失败', err);
      if (err && err.isNetworkError) {
        wx.showToast({ title: api.errorText(err), icon: 'none' });
      }
    });
  },

  onCommentInput(event) {
    this.setData({ commentText: event.detail.value });
  },

  onSubmitComment() {
    const that = this;
    const item = this.data.item;
    const me = this.me;
    if (!item) return;
    if (!me) {
      wx.showModal({
        title: '还没有登录',
        content: '登录后才能发表评论',
        confirmText: '去登录',
        success: function (res) {
          if (res.confirm) wx.reLaunch({ url: '/pages/login/index' });
        }
      });
      return;
    }
    const text = String(this.data.commentText || '').trim();
    if (!text) {
      wx.showToast({ title: '先写两句再发表', icon: 'none' });
      return;
    }
    api.addComment({
      itemId: item.id,
      itemTitle: item.title,
      userId: me.id,
      userName: me.nickname,
      text: text
    }).then(function () {
      that.setData({ commentText: '' });
      wx.showToast({ title: '评论已发表', icon: 'success' });
      // 重新拉一次，保证列表和服务端完全一致（也顺带拿到服务端生成的时间）
      that.loadComments();
    }).catch(function (err) {
      console.warn('[海大易物] 评论发表失败', err);
      wx.showToast({ title: api.errorText(err), icon: 'none' });
    });
  },

  // ---------- 举报 ----------

  onReportTap() {
    const that = this;
    if (!this.data.canReport) return;
    wx.showActionSheet({
      itemList: REPORT_REASONS,
      success: function (sheet) {
        const reason = REPORT_REASONS[sheet.tapIndex] || '其他';
        // 补充说明选填：editable 为真的 memo 框在小程序基础库 2.17.1 起可用
        wx.showModal({
          title: '举报原因：' + reason,
          editable: true,
          placeholderText: '补充说明（选填）',
          confirmText: '提交举报',
          success: function (modal) {
            if (!modal.confirm) return;
            that.submitReport(reason, modal.content || '');
          }
        });
      },
      fail: function () {
        // 用户取消选择：什么都不做
      }
    });
  },

  submitReport(reason, detail) {
    const item = this.data.item;
    const me = this.me;
    if (!item || !me) {
      wx.showToast({ title: '请先登录后再举报', icon: 'none' });
      return;
    }
    api.addReport({
      itemId: item.id,
      itemTitle: item.title,
      targetUserId: item.sellerId,
      targetName: item.sellerName,
      reporterId: me.id,
      reporterName: me.nickname,
      reason: reason,
      detail: String(detail || '').trim()
    }).then(function () {
      wx.showToast({ title: '举报已提交，我们会尽快处理', icon: 'none' });
    }).catch(function (err) {
      console.warn('[海大易物] 举报提交失败', err);
      wx.showToast({ title: api.errorText(err), icon: 'none' });
    });
  },

  // ---------- 评价卖家 ----------

  // 查一次「我是不是已经评价过这个卖家了」；未登录或不可评价时直接跳过
  checkSellerRating() {
    const that = this;
    const item = this.data.item;
    const me = this.me;
    if (!item || !me || !this.data.canRateSeller) return Promise.resolve();
    return api.getUserRatings(item.sellerId).then(function (res) {
      const rated = (res.ratings || []).some(function (one) {
        return one.itemId === item.id && one.fromUserId === me.id;
      });
      that.setData({ ratedSeller: rated });
    }).catch(function (err) {
      // 后端没启动时静默忽略：评价状态不该影响详情页其它内容
      console.warn('[海大易物] 评价状态查询失败', err);
    });
  },

  onOpenRate() {
    if (this.data.ratedSeller) {
      wx.showToast({ title: '你已经评价过了', icon: 'none' });
      return;
    }
    this.setData({ rateLayer: true, rateScore: 0, starList: buildStars(0), rateComment: '' });
  },

  onCloseRate() {
    this.setData({ rateLayer: false });
  },

  onPickStar(event) {
    const score = Number(event.currentTarget.dataset.score) || 0;
    this.setData({ rateScore: score, starList: buildStars(score) });
  },

  onRateCommentInput(event) {
    this.setData({ rateComment: event.detail.value });
  },

  onSubmitRating() {
    const that = this;
    const item = this.data.item;
    const me = this.me;
    if (!item || !me) return;
    const score = Number(this.data.rateScore) || 0;
    if (score < 1) {
      wx.showToast({ title: '请先选择星级', icon: 'none' });
      return;
    }
    api.submitRating({
      itemId: item.id,
      itemTitle: item.title,
      fromUserId: me.id,
      fromName: me.nickname,
      toUserId: item.sellerId,
      toName: item.sellerName,
      score: score,
      comment: String(this.data.rateComment || '').trim()
    }).then(function () {
      that.setData({ rateLayer: false, ratedSeller: true });
      wx.showToast({ title: '评价已提交', icon: 'success' });
    }).catch(function (err) {
      console.warn('[海大易物] 评价提交失败', err);
      // 409 ALREADY_RATED：后端说这条已经评过了，按钮同步成「已评价」
      if (err && err.statusCode === 409) {
        that.setData({ rateLayer: false, ratedSeller: true });
        wx.showToast({ title: '你已经评价过了', icon: 'none' });
        return;
      }
      wx.showToast({ title: api.errorText(err), icon: 'none' });
    });
  },

  // ---------- 原有交互 ----------

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
