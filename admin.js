const API_BASE = 'https://tvbox.hahagw.eu.org';

let adminToken = sessionStorage.getItem('tvbox_admin_token') || '';
let currentOrderStatus = '';
let extendTargetEmail = '';

document.addEventListener('DOMContentLoaded', () => {
  if (adminToken) {
    showAdmin();
    loadAll();
  } else {
    showLogin();
  }

  document.getElementById('loginBtn').onclick = doLogin;
  document.getElementById('adminPassword').onkeydown = (e) => {
    if (e.key === 'Enter') doLogin();
  };
  document.getElementById('logoutBtn').onclick = () => {
    sessionStorage.removeItem('tvbox_admin_token');
    adminToken = '';
    showLogin();
  };
  document.getElementById('refreshBtn').onclick = loadAll;

  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById('panelOrders').classList.toggle('hidden', tab !== 'orders');
      document.getElementById('panelUsers').classList.toggle('hidden', tab !== 'users');
      if (tab === 'users') loadUsers();
      if (tab === 'orders') loadOrders();
    };
  });

  document.querySelectorAll('.order-filter').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.order-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentOrderStatus = btn.dataset.status;
      loadOrders();
    };
  });

  document.getElementById('searchUserBtn').onclick = () => loadUsers(document.getElementById('userSearch').value.trim());
  document.getElementById('userSearch').onkeydown = (e) => {
    if (e.key === 'Enter') loadUsers(document.getElementById('userSearch').value.trim());
  };

  document.getElementById('confirmExtendBtn').onclick = doExtend;
  document.querySelectorAll('.close').forEach(btn => {
    btn.onclick = () => document.getElementById(btn.dataset.close).classList.add('hidden');
  });
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

  if (!password) {
    msg.textContent = '请输入密码';
    msg.classList.add('error');
    return;
  }

  try {
    const res = await fetch(API_BASE + '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || '登录失败';
      msg.classList.add('error');
      return;
    }
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
    'Authorization': 'Bearer ' + adminToken,
    'X-Admin-Secret': adminToken
  };
}

async function loadAll() {
  await Promise.all([loadStats(), loadOrders()]);
}

async function loadStats() {
  try {
    const res = await fetch(API_BASE + '/api/admin/stats', { headers: authHeaders() });
    if (res.status === 403) {
      sessionStorage.removeItem('tvbox_admin_token');
      showLogin();
      return;
    }
    const data = await res.json();
    if (!data.ok) return;
    const s = data.stats;
    document.getElementById('statUsers').textContent = s.totalUsers;
    document.getElementById('statActiveVod').textContent = s.activeVodUsers;
    document.getElementById('statActiveLive').textContent = s.activeLiveUsers;
    document.getElementById('statPending').textContent = s.pendingOrders;
    document.getElementById('statToday').textContent = s.todayOrders;
    document.getElementById('statOrders').textContent = s.totalOrders;
  } catch (e) {}
}

async function loadOrders() {
  try {
    let url = API_BASE + '/api/admin/orders';
    if (currentOrderStatus) url += '?status=' + currentOrderStatus;
    const res = await fetch(url, { headers: authHeaders() });
    const data = await res.json();
    const tbody = document.getElementById('ordersBody');
    if (!data.orders || data.orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#94a3b8;">暂无订单</td></tr>';
      return;
    }
    tbody.innerHTML = data.orders.map(o => {
      const statusClass = 'status-' + o.status;
      const statusText = { pending: '待审核', approved: '已开通', rejected: '已驳回' }[o.status] || o.status;
      const time = formatTime(o.created_at);
      let actions = '-';
      if (o.status === 'pending') {
        actions = `
          <div class="action-btns">
            <button class="btn-sm btn-approve" onclick="approveOrder('${o.order_no}')">开通</button>
            <button class="btn-sm btn-reject" onclick="rejectOrder('${o.order_no}')">驳回</button>
          </div>`;
      }
      return `<tr>
        <td><code style="font-size:0.8rem;">${o.order_no}</code></td>
        <td>${o.email}</td>
        <td>${o.plan_name}</td>
        <td>¥${o.amount}</td>
        <td>${o.pay_method}</td>
        <td>${o.pay_last6}</td>
        <td class="${statusClass}">${statusText}</td>
        <td>${time}</td>
        <td>${actions}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    document.getElementById('ordersBody').innerHTML = '<tr><td colspan="9">加载失败</td></tr>';
  }
}

async function approveOrder(orderNo) {
  if (!confirm('确认开通此订单的会员权益？')) return;
  try {
    const res = await fetch(API_BASE + '/api/admin/order/approve', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ orderNo })
    });
    const data = await res.json();
    alert(data.message || data.error);
    loadAll();
  } catch (e) {
    alert('操作失败');
  }
}

async function rejectOrder(orderNo) {
  if (!confirm('确认驳回此订单？')) return;
  try {
    const res = await fetch(API_BASE + '/api/admin/order/reject', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ orderNo })
    });
    const data = await res.json();
    alert(data.message || data.error);
    loadAll();
  } catch (e) {
    alert('操作失败');
  }
}

async function loadUsers(q = '') {
  try {
    let url = API_BASE + '/api/admin/users';
    if (q) url += '?q=' + encodeURIComponent(q);
    const res = await fetch(url, { headers: authHeaders() });
    const data = await res.json();
    const tbody = document.getElementById('usersBody');
    if (!data.users || data.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">暂无用户</td></tr>';
      return;
    }
    const now = Date.now();
    tbody.innerHTML = data.users.map(u => {
      const vodCls = u.vod_expire_at > now ? 'expire-active' : 'expire-dead';
      const liveCls = u.live_expire_at > now ? 'expire-active' : 'expire-dead';
      return `<tr>
        <td>${u.id}</td>
        <td>${u.email}</td>
        <td class="${vodCls}">${formatDate(u.vod_expire_at)}</td>
        <td class="${liveCls}">${formatDate(u.live_expire_at)}</td>
        <td>${u.register_ip || '-'}</td>
        <td>${formatTime(u.created_at)}</td>
        <td>
          <button class="btn-sm btn-extend" onclick="openExtend('${u.email}')">延长</button>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    document.getElementById('usersBody').innerHTML = '<tr><td colspan="7">加载失败</td></tr>';
  }
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

  if (vodDays <= 0 && liveDays <= 0) {
    msg.textContent = '请至少填写一个天数';
    msg.classList.add('error');
    return;
  }

  try {
    const res = await fetch(API_BASE + '/api/admin/user/extend', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email: extendTargetEmail, vodDays, liveDays })
    });
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || '操作失败';
      msg.classList.add('error');
      return;
    }
    msg.textContent = data.message || '成功';
    msg.classList.add('ok');
    setTimeout(() => {
      document.getElementById('extendModal').classList.add('hidden');
      loadUsers(document.getElementById('userSearch').value.trim());
      loadStats();
    }, 800);
  } catch (e) {
    msg.textContent = '网络错误';
    msg.classList.add('error');
  }
}

function formatDate(ts) {
  if (!ts || ts <= 0) return '未开通';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
