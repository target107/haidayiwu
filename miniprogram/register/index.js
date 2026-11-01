/**
 * 注册
 * 校验顺序和六条文案集中在 utils/api.js 的 register()：页面只收集字段、展示第一条未通过的提示，
 * 这样「注册」和「登录」两处不会各写一套规则而慢慢走偏。
 * 失败用 wx.showModal（标题「注册失败」）；成功先 toast，再延迟 600ms 回登录页并预填学号。
 */
const api = require('../../utils/api.js');

// 校区列表只维护一份，放在数据层（utils/api.js 的 CAMPUSES），这里直接引用
const CAMPUSES = api.campuses;

Page({
  data: {
    appName: '海大易物',
    studentId: '',
    realName: '',
    nickname: '',
    campuses: CAMPUSES,
    campusIndex: 0,
    campusText: CAMPUSES[0],
    password: '',
    confirmPassword: '',
    submitting: false
  },

  onLoad: function () {
    // 昵称默认跟真实姓名走，用户一旦手动改过昵称就不再同步
    this.nicknameEdited = false;
  },

  onStudentIdInput: function (event) {
    this.setData({ studentId: event.detail.value });
  },

  onRealNameInput: function (event) {
    const name = event.detail.value;
    const patch = { realName: name };
    if (!this.nicknameEdited) patch.nickname = name;
    this.setData(patch);
  },

  onNicknameInput: function (event) {
    this.nicknameEdited = true;
    this.setData({ nickname: event.detail.value });
  },

  onCampusChange: function (event) {
    const index = Number(event.detail.value);
    this.setData({ campusIndex: index, campusText: CAMPUSES[index] });
  },

  onPasswordInput: function (event) {
    this.setData({ password: event.detail.value });
  },

  onConfirmPasswordInput: function (event) {
    this.setData({ confirmPassword: event.detail.value });
  },

  showError: function (content) {
    wx.showModal({
      title: '注册失败',
      content: content,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  onSubmit: function () {
    if (this.data.submitting) return;
    const page = this;
    page.setData({ submitting: true });
    api.register({
      studentId: String(page.data.studentId || '').trim(),
      realName: String(page.data.realName || '').trim(),
      nickname: String(page.data.nickname || '').trim(),
      campus: CAMPUSES[page.data.campusIndex] || CAMPUSES[0],
      password: String(page.data.password || ''),
      confirmPassword: String(page.data.confirmPassword || '')
    }).then(function (account) {
      page.setData({ submitting: false });
      wx.showToast({ title: '注册成功', icon: 'success' });
      // 延迟 600ms 再跳，否则 toast 会被页面切换直接截断
      setTimeout(function () {
        wx.redirectTo({ url: '/pages/login/index?studentId=' + encodeURIComponent(account.studentId) });
      }, 600);
    }).catch(function (err) {
      page.setData({ submitting: false });
      console.warn('[海大易物] 注册失败', err);
      page.showError((err && err.message) || '注册失败，请稍后重试');
    });
  },

  onBackToLogin: function () {
    wx.navigateBack();
  }
});
