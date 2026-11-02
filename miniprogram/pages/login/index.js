/**
 * 登录
 * Alpha 版没有后端登录接口：学号 + 密码必须同时匹配 utils/api.js 的本地账号表才算登录成功。
 * 失败一律用 wx.showModal 弹窗（不是一闪而过的 toast），成功后写 storage 再 switchTab 进首页。
 * 界面上不提示任何测试账号：内置账号只存在于数据层和 README 里。
 */
const api = require('../../utils/api.js');

const ERR_ID = '学号必须为 12 位数字';
const ERR_PASSWORD = '请输入密码';
const ERR_CREDENTIALS = '学号或密码不正确，请核对后重试';

// 注册成功后 redirectTo 回来会带 ?studentId=xxx（注册页做过 encodeURIComponent）。
// 小程序自己也可能已经解码过一次，解码失败就直接用原值——学号只有数字，两种结果一致。
function readPrefill(options) {
  const raw = options && options.studentId ? String(options.studentId) : '';
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch (err) {
    return raw;
  }
}

Page({
  data: {
    appName: '海大易物',
    subtitle: '中国海洋大学校园二手交易 · Alpha 版',
    studentId: '',
    password: '',
    submitting: false
  },

  onLoad: function (options) {
    // 注册成功跳回来时预填学号；登录态判断统一放在 onShow
    const prefill = readPrefill(options);
    if (prefill) this.setData({ studentId: prefill });
  },

  // 已登录不允许再走一遍登录，唯一换账号的路径是「我的 → 切换账号」
  // 放在 onShow 而不是 onLoad：页面已经渲染出来之后跳转才可靠
  onShow: function () {
    if (api.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/list/index' });
    }
  },

  onStudentIdInput: function (event) {
    this.setData({ studentId: event.detail.value });
  },

  onPasswordInput: function (event) {
    this.setData({ password: event.detail.value });
  },

  // 三种失败共用一个弹窗，只换内容，保证「登录失败」的提示形式一致
  showError: function (content) {
    wx.showModal({
      title: '登录失败',
      content: content,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  onSubmit: function () {
    if (this.data.submitting) return;
    const studentId = String(this.data.studentId || '').trim();
    const password = String(this.data.password || '');

    if (!/^\d{12}$/.test(studentId)) {
      this.showError(ERR_ID);
      return;
    }
    if (!password) {
      this.showError(ERR_PASSWORD);
      return;
    }

    const page = this;
    page.setData({ submitting: true });
    api.login(studentId, password).then(function (user) {
      page.setData({ submitting: false });
      wx.showToast({ title: '欢迎，' + user.nickname, icon: 'success' });
      wx.reLaunch({ url: '/pages/list/index' });
    }).catch(function (err) {
      page.setData({ submitting: false });
      console.warn('[海大易物] 登录失败', err);
      page.showError((err && err.message) || ERR_CREDENTIALS);
    });
  },

  onGoRegister: function () {
    wx.navigateTo({ url: '/pages/register/index' });
  }
});
