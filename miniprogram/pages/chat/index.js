/**
 * 私信（真实双端会话）
 * 一个「买家 × 一件商品」= 一个会话，数据层键 haidayiwu.v1.chat.<itemId>.<buyerId>。
 * 进入只读不写：不建会话、不插平台提示、不写欢迎语，一条消息都没发过就只显示空状态；
 * 会话记录由 appendMessage 在发出第一条消息时懒创建，所以「只看不聊」不会在消息中心留下任何记录。
 * 发送身份由「当前登录用户是不是卖家」决定（buyer / seller），没有任何自动回复。
 */
const api = require('../../utils/api.js');
const format = require('../../utils/format.js');
const badge = require('../../utils/badge.js');

const SAFE_TIP = '平台不提供线上支付，建议在校区公共区域面交，贵重物品请当面验货。';

Page({
  data: {
    loading: true,
    notFound: false,
    selfItem: false,        // 卖家点开了自己没有 buyerId 的会话
    isSeller: false,
    canMarkSold: false,     // 卖家 + 商品在售 → 顶部显示「确认交易完成」
    sellerName: '',
    buyerName: '',
    itemTitle: '',
    safeTip: SAFE_TIP,      // 常驻安全提示条，不占消息列表
    messages: [],
    inputValue: '',
    scrollTarget: ''
  },

  onLoad(options) {
    const opts = options || {};
    this.itemId = opts.itemId || opts.id || '';
    this.buyerIdParam = opts.buyerId || '';
    this.loadThread();
  },

  onShow() {
    // 当前会话刚读过，红点里不该再算它，切回页面时同步一次
    badge.update();
  },

  loadThread() {
    const that = this;
    if (!this.itemId) {
      this.setData({ loading: false, notFound: true });
      return Promise.resolve();
    }
    return Promise.all([api.getItemById(this.itemId), api.getMe()]).then(function (res) {
      const item = res[0];
      const me = res[1];
      if (!item) {
        that.setData({ loading: false, notFound: true });
        return null;
      }
      if (!me) {
        // 登录态失效：回登录页，不留任何幽灵会话
        wx.reLaunch({ url: '/pages/login/index' });
        return null;
      }
      const view = format.decorate(item);
      const isSeller = item.sellerId === me.id;
      that.item = item;
      that.me = me;
      that.isSeller = isSeller;
      that.role = isSeller ? 'seller' : 'buyer';

      // 卖家必须有 buyerId 参数，否则就是自己点开了自己的商品
      if (isSeller && !that.buyerIdParam) {
        that.setData({
          loading: false,
          notFound: false,
          selfItem: true,
          isSeller: true,
          itemTitle: view.title,
          sellerName: view.sellerName,
          buyerName: me.nickname
        });
        return null;
      }

      that.buyerId = isSeller ? that.buyerIdParam : me.id;

      // 只读不写：不管买家还是卖家都只 getConversation，读不到就渲染空状态。
      // 这里绝不建会话，否则「进了页面但一句话没发」也会在消息中心多一条空记录。
      return api.getConversation(that.itemId, that.buyerId).then(function (conv) {
        if (!conv) {
          that.renderEmpty(item, me);
          return null;
        }
        // 进来只读不写：标记已读，然后按会话内容渲染
        return api.markConversationRead(that.itemId, that.buyerId).then(function (read) {
          return read || conv;
        });
      });
    }).then(function (conv) {
      if (!conv) return;
      that.renderConversation(conv);
    }).catch(function (err) {
      console.warn('[海大易物] 私信加载失败', err);
      that.setData({ loading: false });
      wx.showToast({ title: '私信加载失败，请重试', icon: 'none' });
    });
  },

  // 还没有任何会话（一句话都没发过）：渲染空壳 + 「还没有消息，发一句话试试」，不写 storage
  renderEmpty(item, me) {
    const view = format.decorate(item);
    const otherName = this.isSeller ? '买家' : (view.sellerName || '卖家');
    this.otherChar = String(otherName || '同').slice(0, 1);
    this.setData({
      loading: false,
      notFound: false,
      selfItem: false,
      isSeller: this.isSeller,
      sellerName: view.sellerName || '卖家',
      buyerName: (me && me.nickname) || '同学',
      itemTitle: view.title,
      canMarkSold: !!this.isSeller && view.status === 'on',
      messages: [],
      scrollTarget: ''
    });
    badge.update();
  },

  renderConversation(conv) {
    const list = this.toViewList(conv);
    const last = list.length ? list[list.length - 1] : null;
    this.setData({
      loading: false,
      notFound: false,
      selfItem: false,
      isSeller: this.isSeller,
      sellerName: conv.sellerName,
      buyerName: conv.buyerName,
      itemTitle: conv.itemTitle,
      canMarkSold: !!this.isSeller && !!this.item && this.item.status === 'on',
      messages: list,
      scrollTarget: last ? last.anchor : ''
    });
    badge.update();
  },

  toViewList(conv) {
    const that = this;
    const otherName = this.role === 'seller' ? conv.buyerName : conv.sellerName;
    this.otherChar = String(otherName || '同').slice(0, 1);
    return (conv.messages || []).map(function (message) {
      return that.toView(message);
    });
  },

  // 只给 WXML 用的视图字段，原始消息结构保持 { id, from, text, createdAt }
  toView(message) {
    const isMe = message.from === this.role;
    return {
      id: message.id,
      anchor: 'msg-' + message.id,
      isMe: isMe,
      avatar: isMe ? '我' : (this.otherChar || '同'),
      text: message.text,
      timeText: format.formatClock(message.createdAt)
    };
  },

  onInput(event) {
    this.setData({ inputValue: event.detail.value });
  },

  onSend() {
    const that = this;
    if (this.data.selfItem) {
      wx.showToast({ title: '这是你发布的物品，不能发消息', icon: 'none' });
      return;
    }
    const text = String(this.data.inputValue || '').trim();
    if (!text) {
      wx.showToast({ title: '先输入内容再发送', icon: 'none' });
      return;
    }
    if (!this.itemId || !this.buyerId) return;
    const from = this.role === 'seller' ? 'seller' : 'buyer';
    api.appendMessage(this.itemId, this.buyerId, from, text).then(function (message) {
      if (!message) {
        wx.showToast({ title: '发送失败，请重试', icon: 'none' });
        return;
      }
      that.setData({
        messages: that.data.messages.concat([that.toView(message)]),
        inputValue: '',
        scrollTarget: 'msg-' + message.id
      });
    }).catch(function (err) {
      console.warn('[海大易物] 发送失败', err);
      wx.showToast({ title: '发送失败，请重试', icon: 'none' });
    });
  },

  // 卖家确认交易完成 → 商品标记为已售出，列表里不再出现
  onMarkSold() {
    const that = this;
    if (!this.data.canMarkSold) return;
    wx.showModal({
      title: '确认交易完成',
      content: '标记后这件物品会显示「已售出」，并从首页列表移除，确定吗？',
      success: function (res) {
        if (!res.confirm) return;
        api.setItemStatus(that.itemId, 'sold').then(function (updated) {
          if (!updated) {
            wx.showToast({ title: '标记失败，请重试', icon: 'none' });
            return;
          }
          wx.showToast({ title: '已标记为售出', icon: 'success' });
          wx.navigateBack();
        }).catch(function (err) {
          console.warn('[海大易物] 标记售出失败', err);
          wx.showToast({ title: '标记失败，请重试', icon: 'none' });
        });
      }
    });
  }
});
