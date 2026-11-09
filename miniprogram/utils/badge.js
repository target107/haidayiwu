/**
 * 海大易物 · tabBar 未读红点
 * 未读数来自数据层 getUnreadTotal（有未读的会话数），这里只负责画到「我的」这个 tab 上。
 * 非 tabBar 页面、页面栈未就绪时调用 wx.setTabBarBadge 会报错，所以整段包在 try/catch 里静默失败。
 */
const api = require('./api.js');

const TAB_INDEX = 2;   // tabBar 第三项 = 我的

function apply(total) {
  const count = Number(total) || 0;
  try {
    if (count > 0) wx.setTabBarBadge({ index: TAB_INDEX, text: String(count) });
    else wx.removeTabBarBadge({ index: TAB_INDEX });
  } catch (err) {
    // 页面不在 tabBar 上时去掉红点会抛错，忽略即可
  }
}

// 刷新红点：未登录直接清掉
function update() {
  return api.getMe().then(function (me) {
    if (!me) {
      apply(0);
      return 0;
    }
    return api.getUnreadTotal(me.id).then(function (total) {
      apply(total);
      return total;
    });
  }).catch(function (err) {
    console.warn('[海大易物] 未读红点刷新失败', err);
    return 0;
  });
}

module.exports = {
  update: update
};
