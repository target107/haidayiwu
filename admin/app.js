/**
 * 海大易物 · 网页管理后台
 * 纯原生 JS（无框架、无构建、无 CDN）。接口全部打同源的本机 server/：
 *   POST   /api/admin/login      用 adminId + 姓名换 token（token 只存服务端内存）
 *   GET    /api/admin/stats      数据概览
 *   GET    /api/admin/items      全部商品
 *   GET    /api/admin/reports    全部举报
 *   PATCH  /api/reports/:id      标记已处理
 *   GET    /api/comments         评论列表（?itemId= 省略即全部）
 *   DELETE /api/comments/:id     软删评论
 *   GET    /api/ratings          评价列表
 *   DELETE /api/ratings/:id      软删评价
 *   PATCH  /api/items/:id        强制下架（status = 'off'）/ 恢复上架（status = 'on'）
 * 所有需要身份的接口都带 x-admin-token 请求头，遇到 401 自动回到登录页。
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'haidayiwu.admin.token';
  var NAME_KEY = 'haidayiwu.admin.name';

  var TAB_LOADERS = {
    stats: loadStats,
    reports: loadReports,
    comments: loadComments,
    ratings: loadRatings,
    items: loadItems
  };

  var state = {
    token: readStore(TOKEN_KEY),
    adminName: readStore(NAME_KEY),
    tab: 'stats',
    // 强制下架失败时要提示「举报仍可标记处理」，用这张表把 itemId 找回来
    currentTab: 'stats'
  };

  // ---------- 小工具 ----------

  function readStore(key) {
    try {
      return window.localStorage.getItem(key) || '';
    } catch (err) {
      return '';
    }
  }

  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      /* 隐私模式下 localStorage 可能不可用，忽略即可 */
    }
  }

  function clearStore(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (err) {
      /* 同上 */
    }
  }

  function $(id) {
    return document.getElementById(id);
  }

  // 表格内容全部来自用户输入，拼 HTML 之前必须转义
  function text(value) {
    var raw = value === null || value === undefined ? '' : String(value);
    return raw.replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function fmtTime(timestamp) {
    var time = Number(timestamp) || 0;
    if (!time) return '—';
    var date = new Date(time);
    var pad = function (value) {
      return value < 10 ? '0' + value : String(value);
    };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function stars(score) {
    var value = Math.max(0, Math.min(5, Number(score) || 0));
    var out = '';
    for (var i = 1; i <= 5; i += 1) {
      out += i <= value ? '<span>★</span>' : '<span class="off">★</span>';
    }
    return '<span class="stars">' + out + '</span>';
  }

  var toastTimer = null;

  function notify(message, kind) {
    var box = $('toast');
    box.textContent = message;
    box.className = 'toast' + (kind ? ' is-' + kind : '');
    box.hidden = false;
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      box.hidden = true;
    }, kind === 'error' ? 6000 : 3200);
  }

  // ---------- 请求封装 ----------

  /**
   * 统一请求：自带 JSON 头 + x-admin-token；204 返回 null；
   * 401 直接退出登录回登录页；其它非 2xx 抛错，由调用方 catch 后提示。
   */
  function request(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['x-admin-token'] = state.token;

    return fetch(path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (res) {
      if (res.status === 401) {
        logout('登录已失效，请重新登录');
        throw new Error('登录已失效，请重新登录');
      }
      if (res.status === 204) return null;
      return res.text().then(function (raw) {
        var data = null;
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch (err) {
            data = null;
          }
        }
        if (res.ok) return data;
        var message = (data && (data.message || data.error)) || ('请求失败 HTTP ' + res.status);
        var error = new Error(message);
        error.status = res.status;
        error.body = data;
        throw error;
      });
    });
  }

  // ---------- 登录 / 退出 ----------

  function showLogin(message) {
    $('app-view').hidden = true;
    $('login-view').hidden = false;
    $('login-error').textContent = message || '';
    if (message) notify(message, 'error');
  }

  function showApp() {
    $('login-view').hidden = true;
    $('app-view').hidden = false;
    $('topbar-name').textContent = state.adminName || '管理员';
    switchTab(state.tab || 'stats');
  }

  function onLogin(event) {
    event.preventDefault();
    var adminId = $('login-id').value.trim();
    var adminName = $('login-name').value.trim();
    $('login-error').textContent = '';

    if (!adminId) {
      $('login-error').textContent = '请填写管理员 ID';
      return;
    }
    if (!adminName) {
      $('login-error').textContent = '请填写管理员姓名';
      return;
    }

    request('POST', '/api/admin/login', { adminId: adminId, adminName: adminName }).then(function (data) {
      state.token = (data && data.token) || '';
      state.adminName = (data && data.adminName) || adminName;
      writeStore(TOKEN_KEY, state.token);
      writeStore(NAME_KEY, state.adminName);
      showApp();
      notify('登录成功，欢迎 ' + state.adminName, 'success');
    }).catch(function (error) {
      var body = error.body || {};
      var fieldText = body.fields ? Object.keys(body.fields).map(function (key) {
        return body.fields[key];
      }).join('；') : '';
      $('login-error').textContent = fieldText || error.message || '登录失败，请重试';
    });
  }

  function logout(message) {
    state.token = '';
    state.adminName = '';
    clearStore(TOKEN_KEY);
    clearStore(NAME_KEY);
    showLogin(message || '');
  }

  // ---------- 标签页 ----------

  function switchTab(name) {
    state.tab = name;
    state.currentTab = name;
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i += 1) {
      tabs[i].classList.toggle('is-active', tabs[i].getAttribute('data-tab') === name);
    }
    var panels = document.querySelectorAll('.panel');
    for (var j = 0; j < panels.length; j += 1) {
      panels[j].hidden = panels[j].getAttribute('data-panel') !== name;
    }
    var loader = TAB_LOADERS[name];
    if (loader) loader();
  }

  // ---------- 各个列表 ----------

  function loadStats() {
    request('GET', '/api/admin/stats').then(function (data) {
      var stats = data || {};
      var rows = [
        { label: '商品数', value: Number(stats.items) || 0 },
        { label: '评论数', value: Number(stats.comments) || 0 },
        { label: '举报数', value: Number(stats.reports) || 0 },
        { label: '待处理举报', value: Number(stats.pendingReports) || 0 },
        { label: '评价数', value: Number(stats.ratings) || 0 },
        { label: '平均评分', value: Number(stats.averageRating) || 0 }
      ];
      $('stat-grid').innerHTML = rows.map(function (row) {
        return '<div class="stat"><span class="stat-num">' + text(row.value) +
          '</span><span class="stat-label">' + text(row.label) + '</span></div>';
      }).join('');
    }).catch(function (error) {
      notify('概览加载失败：' + error.message, 'error');
    });
  }

  function loadReports() {
    request('GET', '/api/admin/reports').then(function (data) {
      var reports = (data && data.reports) || [];
      var body = $('reports-body');
      if (!reports.length) {
        body.innerHTML = '<tr><td class="empty-row" colspan="6">暂无数据</td></tr>';
        return;
      }
      body.innerHTML = reports.map(function (report) {
        var handled = report.status === 'handled';
        var statusTag = handled
          ? '<span class="tag tag-handled">已处理</span>'
          : '<span class="tag tag-pending">待处理</span>';
        var detail = report.detail ? '<span class="cell-sub">' + text(report.detail) + '</span>' : '';
        var handler = handled && report.handledBy ? '<span class="cell-sub">处理人：' + text(report.handledBy) + '</span>' : '';
        return '<tr>' +
          '<td class="cell-title">' + text(report.itemTitle || report.itemId) + detail + '</td>' +
          '<td>' + text(report.reporterName || report.reporterId) + '</td>' +
          '<td>' + text(report.reason) + '</td>' +
          '<td class="cell-time">' + text(fmtTime(report.createdAt)) + '</td>' +
          '<td>' + statusTag + handler + '</td>' +
          '<td class="col-actions">' +
            '<button class="btn btn-ghost btn-sm" type="button" data-action="off-item" data-id="' + text(report.itemId) + '">强制下架商品</button> ' +
            (handled
              ? '<button class="btn btn-ghost btn-sm" type="button" disabled>已处理</button>'
              : '<button class="btn btn-primary btn-sm" type="button" data-action="handle-report" data-id="' + text(report.id) + '">标记已处理</button>') +
          '</td>' +
        '</tr>';
      }).join('');
    }).catch(function (error) {
      notify('举报列表加载失败：' + error.message, 'error');
    });
  }

  function loadComments() {
    request('GET', '/api/comments').then(function (data) {
      var comments = (data && data.comments) || [];
      var body = $('comments-body');
      if (!comments.length) {
        body.innerHTML = '<tr><td class="empty-row" colspan="5">暂无数据</td></tr>';
        return;
      }
      body.innerHTML = comments.map(function (comment) {
        return '<tr>' +
          '<td class="cell-title">' + text(comment.itemTitle || comment.itemId) + '</td>' +
          '<td>' + text(comment.userName || comment.userId) + '</td>' +
          '<td class="cell-text">' + text(comment.text) + '</td>' +
          '<td class="cell-time">' + text(fmtTime(comment.createdAt)) + '</td>' +
          '<td class="col-actions">' +
            '<button class="btn btn-danger btn-sm" type="button" data-action="del-comment" data-id="' + text(comment.id) + '">删除</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }).catch(function (error) {
      notify('评论列表加载失败：' + error.message, 'error');
    });
  }

  function loadRatings() {
    request('GET', '/api/ratings').then(function (data) {
      var ratings = (data && data.ratings) || [];
      var body = $('ratings-body');
      if (!ratings.length) {
        body.innerHTML = '<tr><td class="empty-row" colspan="7">暂无数据</td></tr>';
        return;
      }
      body.innerHTML = ratings.map(function (rating) {
        return '<tr>' +
          '<td class="cell-title">' + text(rating.itemTitle || rating.itemId) + '</td>' +
          '<td>' + text(rating.fromName || rating.fromUserId) + '</td>' +
          '<td>' + text(rating.toName || rating.toUserId) + '</td>' +
          '<td>' + stars(rating.score) + '</td>' +
          '<td class="cell-text">' + text(rating.comment || '（无评语）') + '</td>' +
          '<td class="cell-time">' + text(fmtTime(rating.createdAt)) + '</td>' +
          '<td class="col-actions">' +
            '<button class="btn btn-danger btn-sm" type="button" data-action="del-rating" data-id="' + text(rating.id) + '">删除</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }).catch(function (error) {
      notify('评价列表加载失败：' + error.message, 'error');
    });
  }

  var STATUS_TEXT = { on: '在售', off: '已下架', sold: '已售出' };

  function loadItems() {
    request('GET', '/api/admin/items').then(function (data) {
      var items = (data && data.items) || [];
      var body = $('items-body');
      if (!items.length) {
        body.innerHTML = '<tr><td class="empty-row" colspan="5">暂无数据</td></tr>';
        return;
      }
      body.innerHTML = items.map(function (item) {
        var status = item.status === 'off' ? 'off' : (item.status === 'sold' ? 'sold' : 'on');
        return '<tr>' +
          '<td class="cell-title">' + text(item.title) + '</td>' +
          '<td>' + text(item.sellerName || item.sellerId) + '</td>' +
          '<td>¥' + text(Number(item.price) || 0) + '</td>' +
          '<td><span class="tag tag-' + status + '">' + text(STATUS_TEXT[status]) + '</span></td>' +
          '<td class="col-actions">' +
            (status === 'on'
              ? '<button class="btn btn-ghost btn-sm" type="button" data-action="off-item" data-id="' + text(item.id) + '">强制下架</button>'
              : '<button class="btn btn-primary btn-sm" type="button" data-action="on-item" data-id="' + text(item.id) + '">恢复上架</button>') +
          '</td>' +
        '</tr>';
      }).join('');
    }).catch(function (error) {
      notify('商品列表加载失败：' + error.message, 'error');
    });
  }

  // ---------- 操作 ----------

  /**
   * 强制下架：调 PATCH /api/items/:id { status:'off' }。
   * 小程序里新发布的商品只存在本机 storage，服务端没有这条数据，PATCH 会回 404——
   * 这时提示管理员去小程序端下架，并说明该举报依然可以标记为已处理。
   */
  function forceOff(itemId) {
    if (!itemId) return;
    request('PATCH', '/api/items/' + encodeURIComponent(itemId), { status: 'off' }).then(function () {
      notify('已强制下架该商品', 'success');
      reloadCurrent();
    }).catch(function (error) {
      if (error.status === 404) {
        notify('该商品数据不在服务端，请在小程序端下架；本条举报仍可标记为已处理。', 'error');
        return;
      }
      notify('下架失败：' + error.message, 'error');
    });
  }

  /**
   * 恢复上架：调 PATCH /api/items/:id { status:'on' }。
   * 管理员把商品下架之后可能要撤销这个操作，所以商品管理里对非「在售」的商品都提供恢复按钮。
   */
  function forceOn(itemId) {
    if (!itemId) return;
    request('PATCH', '/api/items/' + encodeURIComponent(itemId), { status: 'on' }).then(function () {
      notify('已恢复上架该商品', 'success');
      reloadCurrent();
    }).catch(function (error) {
      if (error.status === 404) {
        notify('该商品数据不在服务端，无法恢复上架。', 'error');
        return;
      }
      notify('恢复上架失败：' + error.message, 'error');
    });
  }

  function handleReport(reportId) {
    if (!reportId) return;
    request('PATCH', '/api/reports/' + encodeURIComponent(reportId), { status: 'handled' }).then(function () {
      notify('举报已标记为已处理', 'success');
      reloadCurrent();
    }).catch(function (error) {
      notify('标记失败：' + error.message, 'error');
    });
  }

  function deleteComment(commentId) {
    if (!commentId) return;
    if (!window.confirm('确定删除这条评论吗？删除后小程序端不再显示。')) return;
    request('DELETE', '/api/comments/' + encodeURIComponent(commentId)).then(function () {
      notify('评论已删除', 'success');
      reloadCurrent();
    }).catch(function (error) {
      notify('删除失败：' + error.message, 'error');
    });
  }

  function deleteRating(ratingId) {
    if (!ratingId) return;
    if (!window.confirm('确定删除这条评价吗？删除后该用户的平均分会重新计算。')) return;
    request('DELETE', '/api/ratings/' + encodeURIComponent(ratingId)).then(function () {
      notify('评价已删除', 'success');
      reloadCurrent();
    }).catch(function (error) {
      notify('删除失败：' + error.message, 'error');
    });
  }

  function reloadCurrent() {
    var loader = TAB_LOADERS[state.currentTab];
    if (loader) loader();
  }

  // ---------- 事件绑定 ----------

  function bindEvents() {
    $('login-form').addEventListener('submit', onLogin);
    $('logout-btn').addEventListener('click', function () {
      logout('');
      notify('已退出登录');
    });

    $('tabs').addEventListener('click', function (event) {
      var button = event.target.closest('.tab');
      if (button) switchTab(button.getAttribute('data-tab'));
    });

    document.querySelector('.main').addEventListener('click', function (event) {
      var refresh = event.target.closest('[data-refresh]');
      if (refresh) {
        var loader = TAB_LOADERS[refresh.getAttribute('data-refresh')];
        if (loader) loader();
        return;
      }
      var action = event.target.closest('[data-action]');
      if (!action) return;
      var id = action.getAttribute('data-id');
      var name = action.getAttribute('data-action');
      if (name === 'off-item') forceOff(id);
      else if (name === 'on-item') forceOn(id);
      else if (name === 'handle-report') handleReport(id);
      else if (name === 'del-comment') deleteComment(id);
      else if (name === 'del-rating') deleteRating(id);
    });
  }

  // ---------- 启动 ----------

  function boot() {
    bindEvents();
    if (state.token) {
      showApp();
    } else {
      showLogin('');
    }
  }

  boot();
})();
