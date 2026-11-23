const API_BASE = 'https://tvbox.hahagw.eu.org';

let adminToken = sessionStorage.getItem('tvbox_admin_token') || '';
let currentOrderStatus = '';
let currentTicketStatus = '';
let extendTargetEmail = '';
let currentReplyTicketNo = '';

document.addEventListener('DOMContentLoaded', () => {
  if (adminToken) {
    showAdmin();
    loadAll();
  } else {
    showLogin();
  }

  document.getElementById('loginBtn').onclick = doLogin;
  document.getElementById('adminPassword').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
  document.getElementById('logoutBtn').onclick = () => {
    sessionStorage.removeItem('tvbox_admin_token');
    adminToken = '';
    showLogin();
  };
  document.getElementById('refreshBtn').onclick = loadAll;

  // 主选项卡切换
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      ['orders', 'users', 'tickets', 'coupons', 'livecfg', 'testcfg', 'settings'].forEach(t => {
        const cap = t.charAt(0).toUpperCase() + t.slice(1);
        document.getElementById('panel' + cap).classList.toggle('hidden', tab !== t);
      });
      if (tab === 'orders') loadOrders();
      if (tab === 'users') loadUsers();
      if (tab === 'tickets') loadTickets();
      if (tab === 'coupons') loadCoupons();
      if (tab === 'livecfg' || tab === 'testcfg') loadChannelConfig();
      if (tab === 'settings') loadSiteSettings();
    };
  });

  // 订单筛选与搜索
  document.querySelectorAll('.order-filter').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.order-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentOrderStatus = btn.dataset.status;
      loadOrders();
    };
  });
  document.getElementById('searchOrderBtn').onclick = loadOrders;
  document.getElementById('orderSearch').onkeydown = (e) => { if (e.key === 'Enter') loadOrders(); };

  // 用户搜索
  document.getElementById('searchUserBtn').onclick = () => loadUsers(document.getElementById('userSearch').value.trim());
  document.getElementById('userSearch').onkeydown = (e) => {
    if (e.key === 'Enter') loadUsers(document.getElementById('userSearch').value.trim());
  };

  // 工单筛选
  document.querySelectorAll('.ticket-filter').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.ticket-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTicketStatus = btn.dataset.status;
      loadTickets();
    };
  });

  // 弹窗关闭
  document.querySelectorAll('.close').forEach(btn => {
    btn.onclick = () => document.getElementById(btn.dataset.close).classList.add('hidden');
  });

  document.getElementById('confirmExtendBtn').onclick = doExtend;
  document.getElementById('confirmReplyBtn').onclick = doReplyTicket;
  document.getElementById('openCreateCouponBtn').onclick = () => {
    document.getElementById('couponCreateMsg').textContent = '';
    document.getElementById('createCouponModal').classList.remove('hidden');
  };
  document.getElementById('confirmCreateCouponBtn').onclick = doCreateCoupon;

  document.getElementById('triggerWfBtn').onclick = () => {
    document.getElementById('wfMsg').textContent = '';
    document.getElementById('workflowModal').classList.remove('hidden');
  };
  document.getElementById('confirmTriggerWfBtn').onclick = doTriggerWorkflow;

  document.getElementById('addLiveGroupBtn')?.addEventListener('click', () => addConfigGroup('live'));
  document.getElementById('saveLiveCfgBtn')?.addEventListener('click', () => saveChannelConfig('liveCfgMsg'));
  document.getElementById('addTestGroupBtn')?.addEventListener('click', () => addConfigGroup('test'));
  document.getElementById('saveTestCfgBtn')?.addEventListener('click', () => saveChannelConfig('testCfgMsg'));
  document.getElementById('previewTestTxtBtn')?.addEventListener('click', previewTestTxt);
  document.getElementById('saveSiteSettingsBtn')?.addEventListener('click', saveSiteSettings);
});

function showLogin() {
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('adminPage').classList.add('hidden');
}

function showAdmin() {
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('adminPage').classList.remove('hidden');
}

async function doLogin() {
  const password = document.getElementById('adminPassword').value.trim();
  const msg = document.getElementById('loginMsg');
  msg.textContent = '';
  msg.className = 'msg';
  if (!password) { msg.textContent = '请输入密码'; msg.classList.add('error'); return; }

  try {
    const res = await fetch(API_BASE + '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) { msg.textContent = data.error || '登录失败'; msg.classList.add('error'); return; }
    adminToken = data.token;
    sessionStorage.setItem('tvbox_admin_token', adminToken);
    showAdmin();
    loadAll();
  } catch (e) {
    msg.textContent = '网络错误，请检查 API 地址';
    msg.classList.add('error');
  }
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + adminToken
  };
}

async function apiFetch(path, options = {}) {
  const res = await fetch(API_BASE + path, { ...options, headers: authHeaders() });
  if (res.status === 403) {
    sessionStorage.removeItem('tvbox_admin_token');
    adminToken = '';
    showLogin();
    throw new Error('登录已过期');
  }
  return res;
}

async function loadAll() {
  await Promise.all([loadStats(), loadOrders()]);
}

async function loadStats() {
  try {
    const res = await apiFetch('/api/admin/stats');
    const data = await res.json();
    if (!data.ok) return;
    const s = data.stats;
    document.getElementById('statUsers').textContent = s.totalUsers;
    document.getElementById('statActiveVod').textContent = s.activeVodUsers;
    document.getElementById('statActiveLive').textContent = s.activeLiveUsers;
    document.getElementById('statPending').textContent = s.pendingOrders;
    document.getElementById('statOpenTickets').textContent = s.openTickets ?? 0;
    document.getElementById('statToday').textContent = s.todayOrders;
    document.getElementById('statRevenue').textContent = '¥' + (s.totalRevenue ?? 0);
  } catch (e) {}
}

// ================= 1. 订单管理与详情 =================
async function loadOrders() {
  try {
    const params = new URLSearchParams();
    if (currentOrderStatus) params.set('status', currentOrderStatus);
    const q = document.getElementById('orderSearch').value.trim();
    if (q) params.set('q', q);
    const qs = params.toString() ? '?' + params.toString() : '';

    const res = await apiFetch('/api/admin/orders' + qs);
    const data = await res.json();
    const tbody = document.getElementById('ordersBody');
    if (!data.orders || data.orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#94a3b8;">暂无订单</td></tr>';
      return;
    }
    tbody.innerHTML = data.orders.map(o => {
      const statusText = { pending: '待审核', approved: '已开通', rejected: '已驳回' }[o.status] || o.status;
      const couponHtml = o.coupon_code ? `<br><span class="muted" style="font-size:0.75rem;">券:${escapeHtml(o.coupon_code)} (-¥${o.discount_amount || 0})</span>` : '';
      let actions = `<button class="btn-sm btn-detail" onclick="openOrderDetail('${o.order_no}')">详情</button>`;
      if (o.status === 'pending') {
        actions = `
          <button class="btn-sm btn-approve" onclick="approveOrder('${o.order_no}')">开通</button>
          <button class="btn-sm btn-reject" onclick="rejectOrder('${o.order_no}')">驳回</button>
          ${actions}`;
      }
      return `<tr>
        <td><code style="font-size:0.78rem;margin:0;padding:2px 6px;">${escapeHtml(o.order_no)}</code></td>
        <td>${escapeHtml(o.email)}</td>
        <td>${escapeHtml(o.plan_name)}</td>
        <td><b>¥${o.amount}</b>${couponHtml}</td>
        <td>${escapeHtml(o.pay_method)}</td>
        <td>${escapeHtml(o.pay_last6)}</td>
        <td class="status-${o.status}">${statusText}</td>
        <td>${formatTime(o.created_at)}</td>
        <td><div class="action-btns">${actions}</div></td>
      </tr>`;
    }).join('');
  } catch (e) {}
}

async function openOrderDetail(orderNo) {
  const modal = document.getElementById('orderDetailModal');
  const body = document.getElementById('orderDetailBody');
  body.innerHTML = '加载中...';
  modal.classList.remove('hidden');
  try {
    const res = await apiFetch('/api/admin/order/detail?orderNo=' + encodeURIComponent(orderNo));
    const data = await res.json();
    if (!data.ok) { body.innerHTML = data.error || '加载失败'; return; }
    const o = data.order;
    const u = data.user || {};
    body.innerHTML = `
      <div class="detail-kv">
        <b>订单编号</b><span>${escapeHtml(o.order_no)}</span>
        <b>用户邮箱</b><span>${escapeHtml(o.email)} (UID: ${o.user_id})</span>
        <b>购买套餐</b><span>${escapeHtml(o.plan_name)} (${escapeHtml(o.plan_code)})</span>
        <b>价格明细</b><span>原价 ¥${o.original_amount || o.amount} | 优惠 -¥${o.discount_amount || 0} (${escapeHtml(o.coupon_code || '无')}) | <b>实付 ¥${o.amount}</b></span>
        <b>支付凭证</b><span>${escapeHtml(o.pay_method)} · 尾号 <b>${escapeHtml(o.pay_last6)}</b></span>
        <b>当前状态</b><span class="status-${o.status}">${o.status}</span>
        <b>下单时间</b><span>${formatFullTime(o.created_at)}</span>
        <b>处理时间</b><span>${o.handled_at ? formatFullTime(o.handled_at) : '未处理'}</span>
        <b>处理备注</b><span>${escapeHtml(o.admin_note || '-')}</span>
        <b>用户当前权益</b><span>点播至 ${formatDate(u.vod_expire_at)} / 直播至 ${formatDate(u.live_expire_at)}</span>
      </div>
    `;
  } catch (e) {
    body.innerHTML = '加载失败';
  }
}

async function approveOrder(orderNo) {
  if (!confirm('确认已收到款项并开通此订单？')) return;
  const res = await apiFetch('/api/admin/order/approve', { method: 'POST', body: JSON.stringify({ orderNo }) });
  const data = await res.json();
  alert(data.message || data.error);
  loadAll();
}

async function rejectOrder(orderNo) {
  const note = prompt('请输入驳回原因（可选）：', '未核实到对应尾号账单');
  if (note === null) return;
  const res = await apiFetch('/api/admin/order/reject', { method: 'POST', body: JSON.stringify({ orderNo, note }) });
  const data = await res.json();
  alert(data.message || data.error);
  loadAll();
}

// ================= 2. 会员管理与深度详情 =================
async function loadUsers(q = '') {
  try {
    let path = '/api/admin/users';
    if (q) path += '?q=' + encodeURIComponent(q);
    const res = await apiFetch(path);
    const data = await res.json();
    const tbody = document.getElementById('usersBody');
    if (!data.users || data.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#94a3b8;">暂无用户</td></tr>';
      return;
    }
    const now = Date.now();
    tbody.innerHTML = data.users.map(u => {
      const vodCls = u.vod_expire_at > now ? 'expire-active' : 'expire-dead';
      const liveCls = u.live_expire_at > now ? 'expire-active' : 'expire-dead';
      const stateHtml = u.is_banned ? '<span class="status-rejected">已封禁</span>' : '<span class="status-approved">正常</span>';
      return `<tr>
        <td>${u.id}</td>
        <td>${escapeHtml(u.email)}</td>
        <td class="${vodCls}">${formatDate(u.vod_expire_at)}</td>
        <td class="${liveCls}">${formatDate(u.live_expire_at)}</td>
        <td>${stateHtml}</td>
        <td>${escapeHtml(u.register_ip || '-')}</td>
        <td>${u.last_active_at ? formatTime(u.last_active_at) : '-'}</td>
        <td>
          <div class="action-btns">
            <button class="btn-sm btn-detail" onclick="openUserDetail(${u.id})">详情</button>
            <button class="btn-sm btn-extend" onclick="openExtend('${escapeHtml(u.email)}')">延长</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {}
}

async function openUserDetail(userId) {
  const modal = document.getElementById('userDetailModal');
  const body = document.getElementById('userDetailBody');
  body.innerHTML = '加载中...';
  modal.classList.remove('hidden');

  try {
    const res = await apiFetch('/api/admin/user/detail?id=' + userId);
    const data = await res.json();
    if (!data.ok) { body.innerHTML = data.error || '加载失败'; return; }
    const u = data.user;
    const ipWarn = data.ip24hCount >= 5 ? `<span style="color:#ef4444;font-weight:700;">${data.ip24hCount} 个 (疑似共享!)</span>` : `${data.ip24hCount} 个`;

    const ordersHtml = (data.orders || []).length
      ? data.orders.map(o => `<div class="mini-row"><span>${escapeHtml(o.order_no)} · ${escapeHtml(o.plan_name)} (¥${o.amount})</span><span class="status-${o.status}">${o.status}</span></div>`).join('')
      : '<div class="muted">无订单记录</div>';

    const logsHtml = (data.recentLogs || []).length
      ? data.recentLogs.map(l => `<div class="mini-row"><span>${escapeHtml(l.ip)} (${escapeHtml(l.region || '-')}) · ${escapeHtml(l.endpoint)}</span><span class="muted">${formatTime(l.created_at)}</span></div>`).join('')
      : '<div class="muted">暂无订阅拉取记录</div>';

    body.innerHTML = `
      <div class="detail-kv">
        <b>用户 ID / 邮箱</b><span>#${u.id} · ${escapeHtml(u.email)}</span>
        <b>专属 Token</b><span><code style="margin:0;padding:2px 6px;">${escapeHtml(u.token)}</code> <button class="btn-sm btn-reject" style="margin-left:8px;" onclick="resetUserToken(${u.id})">重置 Token</button></span>
        <b>点播 / 直播到期</b><span>点播：${formatDate(u.vod_expire_at)} &nbsp;|&nbsp; 直播：${formatDate(u.live_expire_at)}</span>
        <b>注册 IP / 24h IP数</b><span>${escapeHtml(u.register_ip || '-')} &nbsp;|&nbsp; 近24h活跃IP：${ipWarn}</span>
        <b>注册时间</b><span>${formatFullTime(u.created_at)}</span>
      </div>

      <label>精确设定到期日期（留空则不修改）
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px;">
          <span class="muted">点播至</span>
          <input id="editVodDate" type="date" value="${u.vod_expire_at > 0 ? formatDate(u.vod_expire_at) : ''}" style="width:155px;margin-top:0;">
          <span class="muted">直播至</span>
          <input id="editLiveDate" type="date" value="${u.live_expire_at > 0 ? formatDate(u.live_expire_at) : ''}" style="width:155px;margin-top:0;">
          <button class="secondary" style="padding:8px 14px;" onclick="saveUserExactExpire(${u.id})">更新到期日</button>
        </div>
      </label>

      <label>账号状态与管理员备注
        <div style="display:flex;gap:10px;align-items:center;margin-top:6px;">
          <select id="editUserBanned" style="width:140px;margin-top:0;">
            <option value="0" ${!u.is_banned ? 'selected' : ''}>正常启用</option>
            <option value="1" ${u.is_banned ? 'selected' : ''}>封禁暂停</option>
          </select>
          <input id="editUserNote" type="text" value="${escapeHtml(u.admin_note || '')}" placeholder="填写内部备注..." style="flex:1;margin-top:0;">
          <button class="primary" style="padding:8px 14px;" onclick="saveUserStatus(${u.id})">保存</button>
        </div>
      </label>

      <div style="margin-top:14px;"><b>历史订单 (${data.orders.length})</b><div class="mini-list">${ordersHtml}</div></div>
      <div style="margin-top:12px;"><b>最近订阅拉取日志 (${data.recentLogs.length})</b><div class="mini-list">${logsHtml}</div></div>
    `;
  } catch (e) {
    body.innerHTML = '加载失败';
  }
}

async function saveUserStatus(userId) {
  const isBanned = document.getElementById('editUserBanned').value === '1';
  const adminNote = document.getElementById('editUserNote').value.trim();
  const res = await apiFetch('/api/admin/user/update', { method: 'POST', body: JSON.stringify({ id: userId, isBanned, adminNote }) });
  const data = await res.json();
  alert(data.message || data.error);
  loadUsers(document.getElementById('userSearch').value.trim());
}

async function resetUserToken(userId) {
  if (!confirm('确认重置该用户的专属 Token？重置后对方旧的订阅链接会立即失效！')) return;
  const res = await apiFetch('/api/admin/user/reset-token', { method: 'POST', body: JSON.stringify({ id: userId }) });
  const data = await res.json();
  alert(data.message || data.error);
  openUserDetail(userId);
}

function openExtend(email) {
  extendTargetEmail = email;
  document.getElementById('extendEmail').textContent = '用户：' + email;
  document.getElementById('extendVodDays').value = 0;
  document.getElementById('extendLiveDays').value = 0;
  document.getElementById('extendMsg').textContent = '';
  document.getElementById('extendModal').classList.remove('hidden');
}

async function doExtend() {
  const vodDays = Number(document.getElementById('extendVodDays').value) || 0;
  const liveDays = Number(document.getElementById('extendLiveDays').value) || 0;
  const msg = document.getElementById('extendMsg');
  msg.textContent = '';
  msg.className = 'msg';
  if (vodDays <= 0 && liveDays <= 0) { msg.textContent = '请至少填写一个天数'; msg.classList.add('error'); return; }

  const res = await apiFetch('/api/admin/user/extend', {
    method: 'POST',
    body: JSON.stringify({ email: extendTargetEmail, vodDays, liveDays })
  });
  const data = await res.json();
  if (!res.ok) { msg.textContent = data.error || '操作失败'; msg.classList.add('error'); return; }
  msg.textContent = data.message || '成功';
  msg.classList.add('ok');
  setTimeout(() => {
    document.getElementById('extendModal').classList.add('hidden');
    loadUsers(document.getElementById('userSearch').value.trim());
    loadStats();
  }, 700);
}

// ================= 3. 客服工单管理 =================
async function loadTickets() {
  try {
    let path = '/api/admin/tickets';
    if (currentTicketStatus) path += '?status=' + currentTicketStatus;
    const res = await apiFetch(path);
    const data = await res.json();
    const tbody = document.getElementById('ticketsBody');
    if (!data.tickets || data.tickets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">暂无工单</td></tr>';
      return;
    }
    const stText = { open: '待回复', replied: '已回复', closed: '已关闭' };
    tbody.innerHTML = data.tickets.map(t => `<tr>
      <td><code style="font-size:0.78rem;margin:0;padding:2px 6px;">${escapeHtml(t.ticket_no)}</code></td>
      <td>${escapeHtml(t.email)}</td>
      <td>${escapeHtml(t.category)}</td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.subject)}</td>
      <td class="status-${t.status}">${stText[t.status] || t.status}</td>
      <td>${formatTime(t.created_at)}</td>
      <td><button class="btn-sm btn-extend" onclick='openReplyTicket(${JSON.stringify(t).replace(/'/g, "&#39;")})'>查看 / 回复</button></td>
    </tr>`).join('');
  } catch (e) {}
}

function openReplyTicket(ticket) {
  currentReplyTicketNo = ticket.ticket_no;
  document.getElementById('ticketDetailInfo').innerHTML = `
    <b>工单号</b><span>${escapeHtml(ticket.ticket_no)}</span>
    <b>提交用户</b><span>${escapeHtml(ticket.email)}</span>
    <b>分类 / 标题</b><span>[${escapeHtml(ticket.category)}] ${escapeHtml(ticket.subject)}</span>
    <b>用户描述</b><span style="white-space:pre-wrap;">${escapeHtml(ticket.content)}</span>
  `;
  document.getElementById('adminReplyText').value = ticket.admin_reply || '';
  document.getElementById('adminTicketStatus').value = ticket.status === 'closed' ? 'closed' : 'replied';
  document.getElementById('replyMsg').textContent = '';
  document.getElementById('replyTicketModal').classList.remove('hidden');
}

async function doReplyTicket() {
  const reply = document.getElementById('adminReplyText').value.trim();
  const status = document.getElementById('adminTicketStatus').value;
  const msg = document.getElementById('replyMsg');
  msg.textContent = '';
  msg.className = 'msg';
  if (!reply && status === 'replied') { msg.textContent = '请输入回复内容'; msg.classList.add('error'); return; }

  const res = await apiFetch('/api/admin/ticket/reply', {
    method: 'POST',
    body: JSON.stringify({ ticketNo: currentReplyTicketNo, reply, status })
  });
  const data = await res.json();
  if (!res.ok) { msg.textContent = data.error || '提交失败'; msg.classList.add('error'); return; }
  msg.textContent = data.message || '回复成功';
  msg.classList.add('ok');
  setTimeout(() => {
    document.getElementById('replyTicketModal').classList.add('hidden');
    loadTickets();
    loadStats();
  }, 600);
}

// ================= 4. 优惠码管理 =================
async function loadCoupons() {
  try {
    const res = await apiFetch('/api/admin/coupons');
    const data = await res.json();
    const tbody = document.getElementById('couponsBody');
    if (!data.coupons || data.coupons.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#94a3b8;">暂无优惠码，点击右上角创建</td></tr>';
      return;
    }
    const scopeMap = { all: '全部套餐', combo: '仅全能包', vod: '仅点播', live: '仅直播' };
    tbody.innerHTML = data.coupons.map(c => {
      const desc = c.type === 'fixed' ? `立减 ¥${c.value}` : `${(c.value / 10).toFixed(1)} 折`;
      const limit = c.max_uses > 0 ? `${c.used_count} / ${c.max_uses}` : `${c.used_count} / 不限`;
      const exp = c.expires_at > 0 ? formatDate(c.expires_at) : '长期有效';
      const st = c.enabled ? '<span class="status-approved">启用中</span>' : '<span class="status-rejected">已停用</span>';
      return `<tr>
        <td><code style="margin:0;padding:2px 6px;">${escapeHtml(c.code)}</code></td>
        <td><b>${desc}</b>${c.min_amount > 0 ? ` (满¥${c.min_amount})` : ''}</td>
        <td>${scopeMap[c.plan_scope] || c.plan_scope}</td>
        <td>${limit}</td>
        <td>${exp}</td>
        <td>${st}</td>
        <td>${escapeHtml(c.note || '-')}</td>
        <td>
          <div class="action-btns">
            <button class="btn-sm btn-extend" onclick="toggleCoupon(${c.id}, ${c.enabled ? 0 : 1})">${c.enabled ? '停用' : '启用'}</button>
            <button class="btn-sm btn-reject" onclick="deleteCoupon(${c.id})">删除</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {}
}

async function doCreateCoupon() {
  const msg = document.getElementById('couponCreateMsg');
  msg.textContent = '';
  msg.className = 'msg';
  const payload = {
    code: document.getElementById('cpCode').value.trim().toUpperCase(),
    type: document.getElementById('cpType').value,
    value: Number(document.getElementById('cpValue').value),
    planScope: document.getElementById('cpScope').value,
    minAmount: Number(document.getElementById('cpMin').value) || 0,
    maxUses: Number(document.getElementById('cpMaxUses').value) || 0,
    expireDays: Number(document.getElementById('cpExpireDays').value) || 0,
    note: document.getElementById('cpNote').value.trim()
  };

  const res = await apiFetch('/api/admin/coupon/create', { method: 'POST', body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) { msg.textContent = data.error || '创建失败'; msg.classList.add('error'); return; }
  msg.textContent = data.message || '创建成功';
  msg.classList.add('ok');
  setTimeout(() => {
    document.getElementById('createCouponModal').classList.add('hidden');
    loadCoupons();
  }, 600);
}

async function toggleCoupon(id, enabled) {
  await apiFetch('/api/admin/coupon/toggle', { method: 'POST', body: JSON.stringify({ id, enabled: Boolean(enabled) }) });
  loadCoupons();
}

async function deleteCoupon(id) {
  if (!confirm('确认删除此优惠码？')) return;
  await apiFetch('/api/admin/coupon/delete', { method: 'POST', body: JSON.stringify({ id }) });
  loadCoupons();
}

// ================= 5. 一键触发采集工作流 =================
async function doTriggerWorkflow() {
  const msg = document.getElementById('wfMsg');
  msg.textContent = '正在请求 GitHub Actions...';
  msg.className = 'msg';
  const payload = {
    collect_threshold: document.getElementById('wfCollectThreshold').value,
    resume_checkpoint: document.getElementById('wfResume').value,
    search_pages: document.getElementById('wfPages').value
  };
  const res = await apiFetch('/api/admin/trigger-workflow', { method: 'POST', body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) { msg.textContent = data.error || '触发失败'; msg.classList.add('error'); return; }
  msg.textContent = data.message || '触发成功！';
  msg.classList.add('ok');
}

function formatDate(ts) {
  if (!ts || ts <= 0) return '未开通';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatFullTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${formatDate(ts)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}

async function saveUserExactExpire(userId) {
  const vodStr = document.getElementById('editVodDate').value;
  const liveStr = document.getElementById('editLiveDate').value;
  const payload = { id: userId };
  if (vodStr) payload.vodExpireAt = new Date(vodStr + 'T23:59:59+08:00').getTime();
  if (liveStr) payload.liveExpireAt = new Date(liveStr + 'T23:59:59+08:00').getTime();
  const res = await apiFetch('/api/admin/user/set-expire', { method: 'POST', body: JSON.stringify(payload) });
  const data = await res.json();
  alert(data.message || data.error);
  openUserDetail(userId);
  loadUsers(document.getElementById('userSearch').value.trim());
}

let channelCfgState = null;

async function loadChannelConfig() {
  try {
    const res = await apiFetch('/api/admin/channel-config');
    const data = await res.json();
    if (!data.ok) return;
    channelCfgState = data.config;
    if (!channelCfgState.live_groups) channelCfgState.live_groups = {};
    if (!channelCfgState.test_config) channelCfgState.test_config = { max_per_channel: 5, groups: {} };
    if (!channelCfgState.test_config.groups) channelCfgState.test_config.groups = {};
    renderLiveGroupsEditor();
    renderTestGroupsEditor();
  } catch (e) {}
}

function renderLiveGroupsEditor() {
  if (!channelCfgState) return;
  document.getElementById('selfTopSatInput').value = channelCfgState.self_top_satellite || '江西卫视';
  const groups = channelCfgState.live_groups;
  const totalG = Object.keys(groups).length;
  const totalC = Object.values(groups).reduce((acc, arr) => acc + arr.length, 0);
  document.getElementById('liveCfgSummary').textContent = `当前共 ${totalG} 个分类，${totalC} 个采集频道`;
  document.getElementById('liveGroupsContainer').innerHTML = renderGroupCardsHtml(groups, 'live');
}

function renderTestGroupsEditor() {
  if (!channelCfgState) return;
  document.getElementById('testMaxPerCh').value = channelCfgState.test_config.max_per_channel || 5;
  const groups = channelCfgState.test_config.groups;
  const totalG = Object.keys(groups).length;
  const totalC = Object.values(groups).reduce((acc, arr) => acc + arr.length, 0);
  document.getElementById('testCfgSummary').textContent = `当前共 ${totalG} 个体验分类，${totalC} 个频道`;
  document.getElementById('testGroupsContainer').innerHTML = renderGroupCardsHtml(groups, 'test');
}

function renderGroupCardsHtml(groupsObj, mode) {
  const entries = Object.entries(groupsObj);
  if (entries.length === 0) return '<p class="muted">暂无频道分类，请点击右上角新增分类。</p>';
  return entries.map(([gName, chList], gIdx) => {
    const chips = chList.map((ch, cIdx) => `
      <span class="ch-chip">${escapeHtml(ch)} <button type="button" title="删除频道" onclick="removeChannelItem('${mode}', ${gIdx}, ${cIdx})">×</button></span>
    `).join('');
    return `
      <div class="cfg-group-card">
        <div class="cfg-group-head">
          <div><b>${escapeHtml(gName)}</b><span class="muted" style="margin-left:8px;font-size:0.82rem;">(${chList.length} 个频道)</span></div>
          <div class="action-btns">
            <button type="button" class="btn-sm btn-detail" onclick="renameConfigGroup('${mode}', ${gIdx})">重命名分类</button>
            <button type="button" class="btn-sm btn-reject" onclick="deleteConfigGroup('${mode}', ${gIdx})">删除分类</button>
          </div>
        </div>
        <div class="chip-list">${chips || '<span class="muted">该分类下暂无频道</span>'}</div>
        <div class="add-ch-row">
          <input id="addCh_${mode}_${gIdx}" type="text" placeholder="输入频道名称（支持用逗号分隔一次添加多个，如：凤凰中文, 翡翠台）">
          <button type="button" class="btn-sm btn-approve" onclick="addChannelItems('${mode}', ${gIdx})">+ 添加频道</button>
        </div>
      </div>
    `;
  }).join('');
}

function getTargetGroupsObj(mode) {
  return mode === 'live' ? channelCfgState.live_groups : channelCfgState.test_config.groups;
}

function rerenderMode(mode) {
  if (mode === 'live') renderLiveGroupsEditor();
  else renderTestGroupsEditor();
}

function addConfigGroup(mode) {
  if (!channelCfgState) return;
  const name = prompt('请输入新频道分类名称（例如：地方频道 / 港澳台 / 轮播影视）：');
  if (!name || !name.trim()) return;
  const clean = name.trim();
  const obj = getTargetGroupsObj(mode);
  if (obj[clean]) { alert('该分类已存在'); return; }
  obj[clean] = [];
  rerenderMode(mode);
}

function renameConfigGroup(mode, gIdx) {
  const obj = getTargetGroupsObj(mode);
  const keys = Object.keys(obj);
  const oldName = keys[gIdx];
  const newName = prompt('请输入新的分类名称：', oldName);
  if (!newName || !newName.trim() || newName.trim() === oldName) return;
  const clean = newName.trim();
  if (obj[clean]) { alert('目标分类名称已存在'); return; }
  const rebuilt = {};
  for (const k of keys) rebuilt[k === oldName ? clean : k] = obj[k];
  if (mode === 'live') channelCfgState.live_groups = rebuilt;
  else channelCfgState.test_config.groups = rebuilt;
  rerenderMode(mode);
}

function deleteConfigGroup(mode, gIdx) {
  const obj = getTargetGroupsObj(mode);
  const name = Object.keys(obj)[gIdx];
  if (!confirm(`确认删除分类「${name}」及其下全部频道？`)) return;
  delete obj[name];
  rerenderMode(mode);
}

function addChannelItems(mode, gIdx) {
  const input = document.getElementById(`addCh_${mode}_${gIdx}`);
  const raw = (input?.value || '').trim();
  if (!raw) return;
  const obj = getTargetGroupsObj(mode);
  const gName = Object.keys(obj)[gIdx];
  const items = raw.split(/[,，\n]+/).map(s => s.trim()).filter(Boolean);
  for (const ch of items) {
    if (!obj[gName].includes(ch)) obj[gName].push(ch);
  }
  input.value = '';
  rerenderMode(mode);
}

function removeChannelItem(mode, gIdx, cIdx) {
  const obj = getTargetGroupsObj(mode);
  const gName = Object.keys(obj)[gIdx];
  obj[gName].splice(cIdx, 1);
  rerenderMode(mode);
}

async function saveChannelConfig(msgElId) {
  if (!channelCfgState) return;
  channelCfgState.self_top_satellite = document.getElementById('selfTopSatInput').value.trim() || '江西卫视';
  channelCfgState.test_config.max_per_channel = Math.max(1, Math.min(Number(document.getElementById('testMaxPerCh').value) || 5, 50));

  const msg = document.getElementById(msgElId);
  msg.textContent = '正在保存至 Cloudflare KV...';
  msg.className = 'msg';
  try {
    const res = await apiFetch('/api/admin/channel-config', {
      method: 'POST',
      body: JSON.stringify(channelCfgState)
    });
    const data = await res.json();
    if (!res.ok) { msg.textContent = data.error || '保存失败'; msg.classList.add('error'); return; }
    msg.textContent = data.message || '保存成功！';
    msg.classList.add('ok');
  } catch (e) {
    msg.textContent = '网络错误';
    msg.classList.add('error');
  }
}

async function previewTestTxt() {
  if (!channelCfgState) return;
  channelCfgState.test_config.max_per_channel = Math.max(1, Math.min(Number(document.getElementById('testMaxPerCh').value) || 5, 50));
  const wrap = document.getElementById('testPreviewWrap');
  const box = document.getElementById('testPreviewBox');
  const meta = document.getElementById('testPreviewMeta');
  wrap.classList.remove('hidden');
  box.textContent = '正在从 Cloudflare KV 读取当前 live.txt 并生成预览...';
  try {
    const res = await apiFetch('/api/admin/test-txt/preview', {
      method: 'POST',
      body: JSON.stringify({ test_config: channelCfgState.test_config })
    });
    const data = await res.json();
    if (!res.ok) { box.textContent = '❌ ' + (data.error || '预览失败'); return; }
    meta.textContent = `匹配频道：${data.matchedChannels} 个 | 保留总源数：${data.totalStreams} 条 (每频道最多前 ${data.maxN} 条)`;
    box.textContent = data.text;
  } catch (e) {
    box.textContent = '预览请求失败';
  }
}

// ================= 7. 站点与客户端下载设置 =================
async function loadSiteSettings() {
  try {
    const res = await apiFetch('/api/admin/site-settings');
    const data = await res.json();
    if (!data.ok || !data.settings) return;
    document.getElementById('setTrialDays').value = data.settings.trial_days ?? 7;
    document.getElementById('setTvApkUrl').value = data.settings.tv_apk_url || '';
    document.getElementById('setMobileApkUrl').value = data.settings.mobile_apk_url || '';
    document.getElementById('setDownloadNote').value = data.settings.download_note || '';
  } catch (e) {}
}

async function saveSiteSettings() {
  const msg = document.getElementById('siteSettingsMsg');
  msg.textContent = '正在保存...';
  msg.className = 'msg';
  const payload = {
    trial_days: Number(document.getElementById('setTrialDays').value),
    tv_apk_url: document.getElementById('setTvApkUrl').value.trim(),
    mobile_apk_url: document.getElementById('setMobileApkUrl').value.trim(),
    download_note: document.getElementById('setDownloadNote').value.trim()
  };
  try {
    const res = await apiFetch('/api/admin/site-settings', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) { msg.textContent = data.error || '保存失败'; msg.classList.add('error'); return; }
    msg.textContent = data.message || '保存成功！';
    msg.classList.add('ok');
  } catch (e) {
    msg.textContent = '网络错误';
    msg.classList.add('error');
  }
}
