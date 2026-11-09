/**
 * 消息中心：当前用户参与的全部私信会话
 * 数据来自 api.getConversations（按最后一条消息时间倒序），未读数来自 api.getUnreadTotal。
 * 点某条会话进 pages/chat/index?itemId=xxx&buyerId=yyy，chat 页按当前登录用户判断自己是买家还是卖家。
 */
const api = require('../../utils/api.js');
const format = require('../../utils/format.js');
const badge = require('../../utils/badge.js');

Page({
  data: {
    loading: true,
    conversations: [],
    unreadTotal: 0,
    emptyText: '还没有任何会话'
  },

  // 用 onShow：从私信页回来时未读数会变，列表要重新拉
  onShow() {
    this.loadList();
  },

  loadList() {
    const that = this;
    return api.getMe().then(function (me) {
      if (!me) {
        wx.reLaunch({ url: '/pages/login/index' });
        return null;
      }
      that.me = me;
      return Promise.all([api.getConversations(me.id), api.getUnreadTotal(me.id)]);
    }).then(function (res) {
      if (!res) return;
      const list = res[0] || [];
      that.setData({
        loading: false,
        unreadTotal: Number(res[1]) || 0,
        conversations: list.map(function (conv) { return that.toView(conv); })
      });
      // 列表页只刷新红点，不代替用户把会话标记已读（点进会话才标已读）
      badge.update();
    }).catch(function (err) {
      console.warn('[海大易物] 消息列表加载失败', err);
      that.setData({ loading: false });
      wx.showToast({ title: '消息加载失败，请重试', icon: 'none' });
    });
  },

  toView(conv) {
    const unread = Number(conv.unread) || 0;
    return {
      key: conv.key,
      itemId: conv.itemId,
      buyerId: conv.buyerId,
      counterpartName: conv.counterpartName,
      avatarChar: String(conv.counterpartName || '同').slice(0, 1),
      itemTitle: conv.itemTitle,
      lastText: conv.lastText || '（还没有消息）',
      lastAtText: format.formatTime(conv.lastAt),
      unread: unread,
      unreadText: unread > 9 ? '9+' : String(unread)
    };
  },

  goChat(event) {
    const dataset = event.currentTarget.dataset;
    if (!dataset.itemId || !dataset.buyerId) return;
    wx.navigateTo({
      url: '/pages/chat/index?itemId=' + dataset.itemId + '&buyerId=' + dataset.buyerId
    });
  }
});
