const API_BASE = 'https://tv.171234.xyz';

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
      ['orders', 'users', 'tickets', 'coupons', 'pricing', 'vodcfg', 'livecfg', 'testcfg', 'settings'].forEach(t => {
        const cap = t.charAt(0).toUpperCase() + t.slice(1);
        document.getElementById('panel' + cap).classList.toggle('hidden', tab !== t);
      });
      if (tab === 'orders') loadOrders();
      if (tab === 'users') loadUsers();
      if (tab === 'tickets') loadTickets();
      if (tab === 'coupons') loadCoupons();
      if (tab === 'livecfg' || tab === 'testcfg') loadChannelConfig();
      if (tab === 'settings') loadSiteSettings();
      if (tab === 'pricing') loadPricingConfig();
      if (tab === 'vodcfg') loadVodSitesConfig();
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
  document.getElementById('addApkVersionBtn')?.addEventListener('click', addApkVersionRow);
  document.getElementById('addTierBtn')?.addEventListener('click', addEarlyBirdTier);
  document.getElementById('addPlanBtn')?.addEventListener('click', addNewPlanRow);
  document.getElementById('savePricingBtn')?.addEventListener('click', savePricingConfig);
  document.getElementById('addVodSiteBtn')?.addEventListener('click', addVodSiteRow);
  document.getElementById('autoMaskVodBtn')?.addEventListener('click', autoMaskVodAliases);
  document.getElementById('saveVodSitesBtn')?.addEventListener('click', saveVodSitesConfig);
  document.getElementById('adminTicketSelectAll')?.addEventListener('change', (e) => {
    document.querySelectorAll('.admin-tk-cb').forEach(cb => { cb.checked = e.target.checked; });
  });
  document.getElementById('adminBatchDelTicketsBtn')?.addEventListener('click', adminBatchDeleteTickets);
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
    const selAll = document.getElementById('adminTicketSelectAll');
    if (selAll) selAll.checked = false;
    if (!data.tickets || data.tickets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#94a3b8;">暂无工单</td></tr>';
      return;
    }
    const stText = { open: '待回复', replied: '已回复', closed: '已关闭' };
    tbody.innerHTML = data.tickets.map(t => `<tr>
      <td><input type="checkbox" class="admin-tk-cb" value="${escapeHtml(t.ticket_no)}" style="width:auto;margin:0;"></td>
      <td><code style="font-size:0.78rem;margin:0;padding:2px 6px;">${escapeHtml(t.ticket_no)}</code></td>
      <td>${escapeHtml(t.email)}</td>
      <td>${escapeHtml(t.category)}</td>
      <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.subject)}</td>
      <td class="status-${t.status}">${stText[t.status] || t.status}</td>
      <td>${formatTime(t.created_at)}</td>
      <td>
        <div class="action-btns">
          <button class="btn-sm btn-extend" onclick='openReplyTicket(${JSON.stringify(t).replace(/'/g, "&#39;")})'>查看/回复</button>
          <button class="btn-sm btn-reject" onclick="adminDeleteTicket('${escapeHtml(t.ticket_no)}')">删除</button>
        </div>
      </td>
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
    for (const g of Object.keys(channelCfgState.live_groups)) {
      channelCfgState.live_groups[g] = sortLiveGroupChannels(g, channelCfgState.live_groups[g]);
    }
    syncTestGroupsOrderFromLive();
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


// 标准 CCTV-1~17 固定顺序 & 32 省级卫视 CVB 收视率标准顺序（含深圳卫视）
const STD_CCTV_ORDER = [
  'CCTV-1 综合', 'CCTV-2 财经', 'CCTV-3 综艺', 'CCTV-4 中文国际',
  'CCTV-5 体育', 'CCTV-6 电影', 'CCTV-7 国防军事', 'CCTV-8 电视剧',
  'CCTV-9 纪录', 'CCTV-10 科教', 'CCTV-11 戏曲', 'CCTV-12 社会与法',
  'CCTV-13 新闻', 'CCTV-14 少儿', 'CCTV-15 音乐', 'CCTV-16 奥林匹克',
  'CCTV-17 农业农村'
];

const STD_SATELLITE_ORDER = [
  '湖南卫视', '浙江卫视', '东方卫视', '江苏卫视', '北京卫视',
  '山东卫视', '广东卫视', '安徽卫视', '深圳卫视', '辽宁卫视',
  '湖北卫视', '天津卫视', '四川卫视', '河南卫视',
  '黑龙江卫视', '江西卫视', '东南卫视', '河北卫视', '重庆卫视',
  '贵州卫视', '广西卫视', '吉林卫视', '云南卫视', '陕西卫视',
  '山西卫视', '内蒙古卫视', '海南卫视', '甘肃卫视', '青海卫视',
  '宁夏卫视', '新疆卫视', '西藏卫视'
];

function getCctvFixedNum(name) {
  const m = String(name || '').match(/^CCTV[-\s]?0?(\d{1,2})(?!\d|\+|K)/i);
  if (!m) return -1;
  const n = Number(m[1]);
  return (n >= 1 && n <= 17) ? n : -1;
}

function getSatRatingIdx(name) {
  const clean = String(name || '').trim();
  const idx = STD_SATELLITE_ORDER.indexOf(clean);
  if (idx >= 0) return idx;
  return STD_SATELLITE_ORDER.findIndex(s => clean.includes(s.replace('卫视', '')) && clean.includes('卫视'));
}

function isFixedOrderChannel(gName, chName) {
  if (gName === '央视频道') return getCctvFixedNum(chName) >= 1;
  if (gName === '卫视频道') return getSatRatingIdx(chName) >= 0;
  return false;
}

function sortLiveGroupChannels(gName, list) {
  const arr = [...new Set((list || []).map(x => String(x || '').trim()).filter(Boolean))];
  if (gName === '央视频道') {
    const fixed = arr.filter(c => getCctvFixedNum(c) >= 1).sort((a, b) => getCctvFixedNum(a) - getCctvFixedNum(b));
    const extras = arr.filter(c => getCctvFixedNum(c) < 1);
    return [...fixed, ...extras];
  }
  if (gName === '卫视频道') {
    const fixed = arr.filter(c => getSatRatingIdx(c) >= 0).sort((a, b) => getSatRatingIdx(a) - getSatRatingIdx(b));
    const extras = arr.filter(c => getSatRatingIdx(c) < 0);
    return [...fixed, ...extras];
  }
  return arr;
}

function syncTestGroupsOrderFromLive() {
  if (!channelCfgState?.test_config?.groups) return;
  const liveGroups = channelCfgState.live_groups || {};
  const allLiveFlat = Object.values(liveGroups).flat();
  for (const [gName, chList] of Object.entries(channelCfgState.test_config.groups)) {
    const refOrder = Array.isArray(liveGroups[gName]) ? liveGroups[gName] : allLiveFlat;
    const rankMap = new Map(refOrder.map((c, i) => [c, i]));
    channelCfgState.test_config.groups[gName] = [...new Set(chList)].sort((a, b) => {
      const ia = rankMap.has(a) ? rankMap.get(a) : 99999;
      const ib = rankMap.has(b) ? rankMap.get(b) : 99999;
      return ia - ib;
    });
  }
}

let dragState = null;
function onChipDragStart(e, gIdx, cIdx) {
  dragState = { gIdx, cIdx };
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function onChipDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.ch-chip.drag-over').forEach(el => el.classList.remove('drag-over'));
  dragState = null;
}
function onChipDragOver(e, gIdx, cIdx) {
  if (!dragState || dragState.gIdx !== gIdx || dragState.cIdx === cIdx) return;
  const gName = Object.keys(channelCfgState.live_groups)[gIdx];
  const chName = channelCfgState.live_groups[gName][cIdx];
  if (isFixedOrderChannel(gName, chName)) return;
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}
function onChipDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}
function onChipDrop(e, gIdx, targetIdx) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!dragState || dragState.gIdx !== gIdx || dragState.cIdx === targetIdx) return;
  const gName = Object.keys(channelCfgState.live_groups)[gIdx];
  const list = channelCfgState.live_groups[gName];
  if (isFixedOrderChannel(gName, list[targetIdx])) return;
  const [moved] = list.splice(dragState.cIdx, 1);
  list.splice(targetIdx, 0, moved);
  channelCfgState.live_groups[gName] = sortLiveGroupChannels(gName, list);
  syncTestGroupsOrderFromLive();
  renderLiveGroupsEditor();
  renderTestGroupsEditor();
}

let openTestPickerGroups = new Set();

function renderGroupCardsHtml(groupsObj, mode) {
  const entries = Object.entries(groupsObj);
  if (entries.length === 0) return '<p class="muted">暂无频道分类，请点击右上角新增分类。</p>';
  return entries.map(([gName, chList], gIdx) => {
    const chips = chList.map((ch, cIdx) => {
      const canDrag = (mode === 'live') && !isFixedOrderChannel(gName, ch);
      if (canDrag) {
        return `<span class="ch-chip draggable" draggable="true" title="按住拖动可自由排序"
          ondragstart="onChipDragStart(event, ${gIdx}, ${cIdx})"
          ondragend="onChipDragEnd(event)"
          ondragover="onChipDragOver(event, ${gIdx}, ${cIdx})"
          ondragleave="onChipDragLeave(event)"
          ondrop="onChipDrop(event, ${gIdx}, ${cIdx})"><span class="drag-handle">⋮⋮</span>${escapeHtml(ch)} <button type="button" title="删除频道" onclick="removeChannelItem('${mode}', ${gIdx}, ${cIdx})">×</button></span>`;
      }
      return `<span class="ch-chip">${escapeHtml(ch)} <button type="button" title="删除频道" onclick="removeChannelItem('${mode}', ${gIdx}, ${cIdx})">×</button></span>`;
    }).join('');

    if (mode === 'test') {
      const liveGroups = channelCfgState?.live_groups || {};
      const sameGroupPool = Array.isArray(liveGroups[gName]) ? liveGroups[gName] : Object.values(liveGroups).flat();
      const remaining = [...new Set(sameGroupPool)].filter(ch => !chList.includes(ch));
      const isOpen = openTestPickerGroups.has(gName);
      const pickerHtml = isOpen ? `
        <div class="test-picker-panel">
          <div class="test-picker-head">
            <span>从标准 live.txt「${escapeHtml(gName)}」中点击 <b>+</b> 添加（剩余可选 ${remaining.length} 个）：</span>
            <button type="button" class="btn-sm btn-detail" onclick="toggleTestPicker(${gIdx})">收起</button>
          </div>
          <div class="chip-list" style="margin-bottom:0;">
            ${remaining.length > 0
              ? remaining.map(ch => `<button type="button" class="ch-chip-cand" onclick="pickChannelIntoTest(${gIdx}, '${escapeHtml(ch).replace(/'/g, "\'")}')">${escapeHtml(ch)} <span class="plus-sign">+</span></button>`).join('')
              : '<span class="muted">该分类下标准 live.txt 的全部频道均已添加完毕</span>'}
          </div>
        </div>
      ` : '';

      return `
        <div class="cfg-group-card">
          <div class="cfg-group-head">
            <div><b>${escapeHtml(gName)}</b><span class="muted" style="margin-left:8px;font-size:0.82rem;">(${chList.length} 个频道)</span></div>
            <div class="action-btns">
              <button type="button" class="btn-sm btn-detail" onclick="renameConfigGroup('${mode}', ${gIdx})">重命名分类</button>
              <button type="button" class="btn-sm btn-reject" onclick="deleteConfigGroup('${mode}', ${gIdx})">删除分类</button>
            </div>
          </div>
          <div class="chip-list" style="margin-bottom:0;">
            ${chips}
            <button type="button" class="ch-chip-add-trigger" onclick="toggleTestPicker(${gIdx})">${isOpen ? '收起候选' : '+ 添加频道'}</button>
          </div>
          ${pickerHtml}
        </div>
      `;
    }

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

function toggleTestPicker(gIdx) {
  const keys = Object.keys(channelCfgState?.test_config?.groups || {});
  const gName = keys[gIdx];
  if (!gName) return;
  if (openTestPickerGroups.has(gName)) openTestPickerGroups.delete(gName);
  else openTestPickerGroups.add(gName);
  renderTestGroupsEditor();
}

function pickChannelIntoTest(gIdx, chName) {
  const obj = channelCfgState?.test_config?.groups || {};
  const gName = Object.keys(obj)[gIdx];
  if (!gName || !Array.isArray(obj[gName])) return;
  if (!obj[gName].includes(chName)) obj[gName].push(chName);
  syncTestGroupsOrderFromLive();
  renderTestGroupsEditor();
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
  if (mode === 'live') {
    obj[gName] = sortLiveGroupChannels(gName, obj[gName]);
    syncTestGroupsOrderFromLive();
    renderTestGroupsEditor();
  }
  input.value = '';
  rerenderMode(mode);
}

function removeChannelItem(mode, gIdx, cIdx) {
  const obj = getTargetGroupsObj(mode);
  const gName = Object.keys(obj)[gIdx];
  obj[gName].splice(cIdx, 1);
  if (mode === 'test') syncTestGroupsOrderFromLive();
  rerenderMode(mode);
}

async function saveChannelConfig(msgElId) {
  if (!channelCfgState) return;
  for (const g of Object.keys(channelCfgState.live_groups || {})) {
    channelCfgState.live_groups[g] = sortLiveGroupChannels(g, channelCfgState.live_groups[g]);
  }
  syncTestGroupsOrderFromLive();
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
let apkDownloadsState = [];

async function loadSiteSettings() {
  try {
    const res = await apiFetch('/api/admin/site-settings');
    const data = await res.json();
    if (!data.ok || !data.settings) return;
    const s = data.settings;
    document.getElementById('setTrialDays').value = s.trial_days ?? 7;
    document.getElementById('setDownloadNote').value = s.download_note || '';
    document.getElementById('setOnsiteEnabled').value = s.onsite_enabled === false ? 'false' : 'true';
    document.getElementById('setOnsitePrice').value = s.onsite_price ?? 99;
    document.getElementById('setOnsiteTitle').value = s.onsite_title || '赣州市城区专属 · 上门安装调试服务';
    document.getElementById('setOnsiteDesc').value = s.onsite_desc || '上门费 88 元，包含电视/盒子现场安装 TVBox + 线路调试测速 + 赠送全年全能双享会员！';
    apkDownloadsState = Array.isArray(s.apk_downloads) ? s.apk_downloads : [];
    renderApkDownloadsEditor();
  } catch (e) {}
}

function renderApkDownloadsEditor() {
  const box = document.getElementById('apkDownloadsEditor');
  if (!box) return;
  if (apkDownloadsState.length === 0) {
    box.innerHTML = '<p class="muted">暂无 APK 版本，点击右上角「+ 新增 APK 版本」添加。</p>';
    return;
  }
  box.innerHTML = apkDownloadsState.map((a, idx) => `
    <div class="pricing-row-card" style="background:#131a2a;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <b>版本 #${idx + 1}</b>
        <button type="button" class="btn-sm btn-reject" onclick="removeApkVersionRow(${idx})">删除</button>
      </div>
      <div class="pricing-grid-4">
        <label>版本名称<input type="text" value="${escapeHtml(a.name || '')}" onchange="updateApkField(${idx}, 'name', this.value)"></label>
        <label>角标标签<input type="text" value="${escapeHtml(a.tag || '')}" placeholder="如：推荐 / 安卓4.x" onchange="updateApkField(${idx}, 'tag', this.value)"></label>
        <label style="grid-column:span 2;">下载地址 URL（网盘/直链）<input type="url" value="${escapeHtml(a.url || '')}" placeholder="https://..." onchange="updateApkField(${idx}, 'url', this.value)"></label>
      </div>
      <label style="margin-top:6px;font-size:0.78rem;">适用设备/系统说明
        <input type="text" value="${escapeHtml(a.desc || '')}" style="padding:7px 9px;font-size:0.84rem;margin-top:4px;" onchange="updateApkField(${idx}, 'desc', this.value)">
      </label>
    </div>
  `).join('');
}

function updateApkField(idx, key, val) { if (apkDownloadsState[idx]) apkDownloadsState[idx][key] = val; }
function addApkVersionRow() {
  apkDownloadsState.push({ name: 'TVBox 新版本 (Android 5.0+)', tag: '备用版', desc: '安卓电视/盒子/手机/平板通用', url: '' });
  renderApkDownloadsEditor();
}
function removeApkVersionRow(idx) { apkDownloadsState.splice(idx, 1); renderApkDownloadsEditor(); }

async function saveSiteSettings() {
  const msg = document.getElementById('siteSettingsMsg');
  msg.textContent = '正在保存...';
  msg.className = 'msg';
  const payload = {
    trial_days: Number(document.getElementById('setTrialDays').value),
    apk_downloads: apkDownloadsState,
    download_note: document.getElementById('setDownloadNote').value.trim(),
    onsite_enabled: document.getElementById('setOnsiteEnabled').value === 'true',
    onsite_price: Number(document.getElementById('setOnsitePrice').value ?? 99),
    onsite_title: document.getElementById('setOnsiteTitle').value.trim(),
    onsite_desc: document.getElementById('setOnsiteDesc').value.trim()
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

// ================= 8. 动态套餐与阶梯早鸟折扣管理 =================
let pricingState = null;

async function loadPricingConfig() {
  try {
    const res = await apiFetch('/api/admin/pricing-config');
    const data = await res.json();
    if (!data.ok) return;
    pricingState = data.config;
    const st = data.earlyBirdState;
    const statusEl = document.getElementById('ebLiveStatusText');
    if (statusEl && st) {
      statusEl.textContent = st.active && st.tier
        ? `当前已统计人数/单数：${st.currentCount} | 下一位第 ${st.nextRank} 名 → 生效中：${st.tier.label || (st.discountPercent/10)+'折'}（本档剩余 ${st.remainingInTier} 席）`
        : `当前已统计人数/单数：${st.currentCount} | 当前无生效早鸟折扣（按原价展示）`;
    }
    document.getElementById('ebEnabled').value = pricingState.early_bird?.enabled ? 'true' : 'false';
    document.getElementById('ebTitleInput').value = pricingState.early_bird?.title || '创始会员限时阶梯特惠';
    document.getElementById('ebCountMode').value = pricingState.early_bird?.count_mode || 'paid_users';
    document.getElementById('couponsMasterEnabled').value = pricingState.coupons_enabled === false ? 'false' : 'true';
    renderTiersEditor();
    renderPlansEditor();
  } catch (e) {}
}

function renderTiersEditor() {
  const box = document.getElementById('tiersContainer');
  const tiers = pricingState?.early_bird?.tiers || [];
  if (tiers.length === 0) {
    box.innerHTML = '<div class="muted">暂无阶梯区间，点击右上角「+ 新增折扣阶梯」添加（例如 1~100 名 60% 即 6 折）。</div>';
    return;
  }
  box.innerHTML = tiers.map((t, idx) => `
    <div class="tier-row">
      <label>起始名次<input type="number" min="1" value="${t.min_rank}" onchange="updateTierField(${idx}, 'min_rank', this.value)"></label>
      <label>截止名次<input type="number" min="1" value="${t.max_rank}" onchange="updateTierField(${idx}, 'max_rank', this.value)"></label>
      <label>折扣(%)如60=6折<input type="number" min="10" max="100" value="${t.discount_percent}" onchange="updateTierField(${idx}, 'discount_percent', this.value)"></label>
      <label>展示文案<input type="text" value="${escapeHtml(t.label || '')}" placeholder="如：前 100 名尊享 6 折" onchange="updateTierField(${idx}, 'label', this.value)"></label>
      <button type="button" class="btn-sm btn-reject" style="height:34px;" onclick="removeTier(${idx})">删除</button>
    </div>
  `).join('');
}

function updateTierField(idx, key, val) {
  if (!pricingState?.early_bird?.tiers?.[idx]) return;
  pricingState.early_bird.tiers[idx][key] = key === 'label' ? val : Number(val);
}

function addEarlyBirdTier() {
  if (!pricingState) return;
  if (!pricingState.early_bird) pricingState.early_bird = { enabled: true, title: '创始会员限时阶梯特惠', count_mode: 'paid_users', tiers: [] };
  const tiers = pricingState.early_bird.tiers;
  const lastMax = tiers.length > 0 ? Number(tiers[tiers.length - 1].max_rank || 0) : 0;
  const minR = lastMax + 1;
  const maxR = lastMax + 100;
  tiers.push({ min_rank: minR, max_rank: maxR, discount_percent: 80, label: `第 ${minR}~${maxR} 名尊享 8 折` });
  renderTiersEditor();
}

function removeTier(idx) {
  pricingState.early_bird.tiers.splice(idx, 1);
  renderTiersEditor();
}

function renderPlansEditor() {
  const box = document.getElementById('plansEditorContainer');
  const plans = pricingState?.plans || [];
  box.innerHTML = plans.map((p, idx) => `
    <div class="pricing-row-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px;flex-wrap:wrap;">
        <b>#${idx + 1} ${escapeHtml(p.name)} <code style="margin:0;padding:1px 6px;font-size:0.75rem;">${escapeHtml(p.code)}</code></b>
        <div style="display:flex;gap:10px;align-items:center;">
          <label style="margin:0;display:inline-flex;align-items:center;gap:4px;"><input type="checkbox" style="width:auto;margin:0;" ${p.featured ? 'checked' : ''} onchange="updatePlanField(${idx}, 'featured', this.checked)"> 主推高亮</label>
          <label style="margin:0;display:inline-flex;align-items:center;gap:4px;"><input type="checkbox" style="width:auto;margin:0;" ${p.enabled !== false ? 'checked' : ''} onchange="updatePlanField(${idx}, 'enabled', this.checked)"> 上架启用</label>
          <button type="button" class="btn-sm btn-reject" onclick="removePlanRow(${idx})">删除</button>
        </div>
      </div>
      <div class="pricing-grid-4">
        <label>套餐代码(唯一)<input type="text" value="${escapeHtml(p.code)}" onchange="updatePlanField(${idx}, 'code', this.value)"></label>
        <label>套餐名称<input type="text" value="${escapeHtml(p.name)}" onchange="updatePlanField(${idx}, 'name', this.value)"></label>
        <label>所属分类
          <select onchange="updatePlanField(${idx}, 'category', this.value)">
            <option value="combo" ${p.category === 'combo' ? 'selected' : ''}>全能双享包</option>
            <option value="vod" ${p.category === 'vod' ? 'selected' : ''}>纯点播</option>
            <option value="live" ${p.category === 'live' ? 'selected' : ''}>纯直播</option>
          </select>
        </label>
        <label>原价 (元)<input type="number" step="0.1" min="0.1" value="${p.price}" onchange="updatePlanField(${idx}, 'price', Number(this.value))"></label>
        <label>点播天数<input type="number" min="0" value="${p.vodDays}" onchange="updatePlanField(${idx}, 'vodDays', Number(this.value))"></label>
        <label>直播天数<input type="number" min="0" value="${p.liveDays}" onchange="updatePlanField(${idx}, 'liveDays', Number(this.value))"></label>
        <label>角标文案<input type="text" value="${escapeHtml(p.tag || '')}" onchange="updatePlanField(${idx}, 'tag', this.value)"></label>
        <label>排序权重<input type="number" value="${p.sort || (idx + 1)}" onchange="updatePlanField(${idx}, 'sort', Number(this.value))"></label>
      </div>
      <label style="margin-top:6px;font-size:0.78rem;">套餐简介
        <input type="text" value="${escapeHtml(p.desc || '')}" style="padding:7px 9px;font-size:0.84rem;margin-top:4px;" onchange="updatePlanField(${idx}, 'desc', this.value)">
      </label>
    </div>
  `).join('');
}

function updatePlanField(idx, key, val) {
  if (!pricingState?.plans?.[idx]) return;
  pricingState.plans[idx][key] = val;
}

function addNewPlanRow() {
  if (!pricingState) return;
  const n = pricingState.plans.length + 1;
  pricingState.plans.push({
    code: 'custom_' + Date.now().toString().slice(-4),
    name: '新自定义套餐',
    category: 'combo',
    desc: '点播 + 直播尊享权益',
    price: 19.9,
    vodDays: 90,
    liveDays: 90,
    tag: '限时季卡',
    featured: false,
    enabled: true,
    sort: n
  });
  renderPlansEditor();
}

function removePlanRow(idx) {
  if (!confirm('确认删除此套餐？')) return;
  pricingState.plans.splice(idx, 1);
  renderPlansEditor();
}

async function savePricingConfig() {
  if (!pricingState) return;
  pricingState.coupons_enabled = document.getElementById('couponsMasterEnabled').value === 'true';
  pricingState.early_bird = {
    enabled: document.getElementById('ebEnabled').value === 'true',
    title: document.getElementById('ebTitleInput').value.trim() || '创始会员限时阶梯特惠',
    count_mode: document.getElementById('ebCountMode').value,
    tiers: pricingState.early_bird?.tiers || []
  };
  const msg = document.getElementById('pricingMsg');
  msg.textContent = '正在保存至 Cloudflare KV...';
  msg.className = 'msg';
  try {
    const res = await apiFetch('/api/admin/pricing-config', { method: 'POST', body: JSON.stringify(pricingState) });
    const data = await res.json();
    if (!res.ok) { msg.textContent = data.error || '保存失败'; msg.classList.add('error'); return; }
    msg.textContent = data.message || '保存成功！';
    msg.classList.add('ok');
    loadPricingConfig();
  } catch (e) {
    msg.textContent = '网络错误';
    msg.classList.add('error');
  }
}

// ================= 9. 后台点播源平台管理（增删、排序、脱敏防泄密） =================
let vodCfgState = null;

async function loadVodSitesConfig() {
  try {
    const res = await apiFetch('/api/admin/vod-sites');
    const data = await res.json();
    if (!data.ok) return;
    vodCfgState = data.config || { mask_names: true, sites: [] };
    document.getElementById('vodMaskNamesToggle').value = vodCfgState.mask_names ? 'true' : 'false';
    renderVodSitesEditor();
  } catch (e) {}
}

function renderVodSitesEditor() {
  if (!vodCfgState) return;
  const list = vodCfgState.sites || [];
  const enabledCnt = list.filter(s => s.enabled !== false).length;
  document.getElementById('vodSitesSummary').textContent = `共 ${list.length} 条配置，当前启用 ${enabledCnt} 条（官网与 TVBox 实时同步此数字）`;
  const box = document.getElementById('vodSitesContainer');
  if (list.length === 0) {
    box.innerHTML = '<p class="muted">暂无点播源，点击右上角「+ 新增点播源」添加。</p>';
    return;
  }
  box.innerHTML = list.map((s, idx) => `
    <div class="pricing-row-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px;flex-wrap:wrap;">
        <b>#${String(idx + 1).padStart(2, '0')} ${escapeHtml(s.realName || s.key)} <span class="muted" style="font-weight:400;">→ 对外展示：${escapeHtml(s.alias || '')}</span></b>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <label style="margin:0;display:inline-flex;align-items:center;gap:4px;"><input type="checkbox" style="width:auto;margin:0;" ${s.enabled !== false ? 'checked' : ''} onchange="updateVodField(${idx}, 'enabled', this.checked)"> 启用</label>
          <button type="button" class="btn-sm btn-detail" onclick="moveVodSite(${idx}, -1)">↑上移</button>
          <button type="button" class="btn-sm btn-detail" onclick="moveVodSite(${idx}, 1)">↓下移</button>
          <button type="button" class="btn-sm btn-reject" onclick="removeVodSite(${idx})">删除</button>
        </div>
      </div>
      <div class="pricing-grid-4">
        <label>内部真实名称(仅后台可见)<input type="text" value="${escapeHtml(s.realName || s.key)}" onchange="updateVodField(${idx}, 'realName', this.value)"></label>
        <label>对外脱敏代号(前台/电视显示)<input type="text" value="${escapeHtml(s.alias || '')}" onchange="updateVodField(${idx}, 'alias', this.value)"></label>
        <label style="grid-column:span 2;">采集站 API 接口地址 (JSON)<input type="url" value="${escapeHtml(s.api || '')}" onchange="updateVodField(${idx}, 'api', this.value)"></label>
      </div>
    </div>
  `).join('');
}

function updateVodField(idx, key, val) {
  if (!vodCfgState?.sites?.[idx]) return;
  vodCfgState.sites[idx][key] = val;
}

function moveVodSite(idx, delta) {
  const arr = vodCfgState?.sites || [];
  const target = idx + delta;
  if (target < 0 || target >= arr.length) return;
  [arr[idx], arr[target]] = [arr[target], arr[idx]];
  renderVodSitesEditor();
}

function removeVodSite(idx) {
  if (!confirm('确认删除该点播资源站？')) return;
  vodCfgState.sites.splice(idx, 1);
  renderVodSitesEditor();
}

function addVodSiteRow() {
  if (!vodCfgState) vodCfgState = { mask_names: true, sites: [] };
  const n = vodCfgState.sites.length + 1;
  vodCfgState.sites.push({
    key: 'vod_' + Date.now().toString().slice(-5),
    realName: '新点播资源站',
    alias: `极速专线 ${String(n).padStart(2, '0')}`,
    api: 'https://',
    enabled: true
  });
  renderVodSitesEditor();
}

function autoMaskVodAliases() {
  if (!vodCfgState?.sites) return;
  vodCfgState.sites.forEach((s, idx) => {
    s.alias = `极速专线 ${String(idx + 1).padStart(2, '0')}`;
  });
  renderVodSitesEditor();
}

async function saveVodSitesConfig() {
  if (!vodCfgState) return;
  vodCfgState.mask_names = document.getElementById('vodMaskNamesToggle').value === 'true';
  const msg = document.getElementById('vodCfgMsg');
  msg.textContent = '正在保存至 Cloudflare KV...';
  msg.className = 'msg';
  try {
    const res = await apiFetch('/api/admin/vod-sites', { method: 'POST', body: JSON.stringify(vodCfgState) });
    const data = await res.json();
    if (!res.ok) { msg.textContent = data.error || '保存失败'; msg.classList.add('error'); return; }
    vodCfgState = data.config;
    renderVodSitesEditor();
    msg.textContent = data.message || '保存成功！';
    msg.classList.add('ok');
  } catch (e) {
    msg.textContent = '网络错误';
    msg.classList.add('error');
  }
}

async function adminDeleteTicket(ticketNo) {
  if (!confirm(`确认删除工单 ${ticketNo}？`)) return;
  const res = await apiFetch('/api/admin/ticket/delete', { method: 'POST', body: JSON.stringify({ ticketNo }) });
  const data = await res.json();
  alert(data.message || data.error);
  loadTickets();
  loadStats();
}

async function adminBatchDeleteTickets() {
  const checked = Array.from(document.querySelectorAll('.admin-tk-cb:checked')).map(cb => cb.value);
  if (checked.length === 0) { alert('请先勾选要删除的工单'); return; }
  if (!confirm(`确认一键批量删除选中的 ${checked.length} 条工单？`)) return;
  const res = await apiFetch('/api/admin/ticket/batch-delete', { method: 'POST', body: JSON.stringify({ ticketNos: checked }) });
  const data = await res.json();
  alert(data.message || data.error);
  loadTickets();
  loadStats();
}
