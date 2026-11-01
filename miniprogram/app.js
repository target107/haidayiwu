/**
 * 海大易物 · 小程序入口
 * 启动时做三件事：打印数据层模式（方便演示时确认连着哪份数据）、
 * 首次启动初始化本地账号表、如果本机已经有登录态就直接进首页列表，不让人再看一遍登录页。
 * 数据层的全部读写都在 utils/api.js 里，页面不直接碰 wx.getStorageSync。
 */
const api = require('./utils/api.js');
const badge = require('./utils/badge.js');

App({
  globalData: {
    appName: '海大易物',
    version: 'v1.0.0-alpha'
  },

  onLaunch() {
    // 演示时打开调试器就能看到当前是 local（本地 storage）还是 http（本机后端）
    console.log('[海大易物] 启动，数据层模式：' + api.config.mode + '，baseUrl：' + api.config.baseUrl);

    // 首次启动把内置账号写进 storage 的 haidayiwu.v1.accounts，之后一律以 storage 为准
    api.getAccounts();

    // 已登录：跳过登录页直接进首页（登录态只认 utils/api.js 里的本地账号表）
    // 注意：这里必须用 reLaunch 而不是 switchTab。switchTab 在 onLaunch 阶段页面栈还没建好，
    // 调用经常被静默丢弃，表现就是"明明登录过，每次打开还要重新登录"。
    goHomeIfLoggedIn();
  },

  // 从后台切回前台时再兜一次：避免某些机型上 onLaunch 的跳转被丢弃
  onShow() {
    goHomeIfLoggedIn();
    // 未读私信红点：切回前台时重新拉一次（非 tabBar 场景内部已静默失败）
    badge.update();
  }
});

function goHomeIfLoggedIn() {
  if (!api.isLoggedIn()) return;
  // 已经停在首页就不要再跳一次，避免 onLaunch 与 onShow 连续触发导致页面闪一下
  const stack = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const current = stack.length ? stack[stack.length - 1].route : '';
  if (current === 'pages/list/index') return;
  wx.reLaunch({ url: '/pages/list/index' });
}
