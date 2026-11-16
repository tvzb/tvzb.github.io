// ⚠️ 请将此处替换为你部署后的 Cloudflare Worker 域名（末尾不要加斜杠）
const API_BASE = 'https://tvbox.hahagw2016.workers.dev';

// 与你的 tv.txt 对应的 21 个点播资源站列表（用于本地浏览器测速与排序）
const VOD_SITES = [
  { key: '非凡资源', name: '非凡资源', pingUrl: 'http://api.ffzyapi.com/' },
  { key: '量子资源', name: '量子资源', pingUrl: 'https://cj.lziapi.com/' },
  { key: '暴风资源', name: '暴风资源', pingUrl: 'https://bfzyapi.com/' },
  { key: '红牛资源', name: '红牛资源', pingUrl: 'https://www.hongniuzy2.com/' },
  { key: '极速资源', name: '极速资源', pingUrl: 'https://jszyapi.com/' },
  { key: '光速资源', name: '光速资源', pingUrl: 'https://api.guangsuapi.com/' },
  { key: '金鹰资源', name: '金鹰资源', pingUrl: 'https://jyzyapi.com/' },
  { key: '新浪资源', name: '新浪资源', pingUrl: 'https://api.xinlangapi.com/' },
  { key: '优质资源', name: '优质资源', pingUrl: 'https://api.yyzy-tv.vip/' },
  { key: '闪电资源', name: '闪电资源', pingUrl: 'https://xsd.sdzyapi.com/' },
  { key: '魔都资源', name: '魔都资源', pingUrl: 'https://www.mdzyapi.com/' },
  { key: '电影天堂', name: '电影天堂', pingUrl: 'http://caiji.dyttzyapi.com/' },
  { key: '豪华资源', name: '豪华资源', pingUrl: 'https://hhzyapi.com/' },
  { key: '无尽资源', name: '无尽资源', pingUrl: 'https://api.wujinapi.me/' },
  { key: '速播资源', name: '速播资源', pingUrl: 'https://subocj.com/' },
  { key: '如意资源', name: '如意资源', pingUrl: 'https://cj.rycjapi.com/' },
  { key: '虎牙资源', name: '虎牙资源', pingUrl: 'https://www.huyaapi.com/' },
  { key: '百度资源', name: '百度资源', pingUrl: 'https://api.apibdzy.com/' },
  { key: 'U酷资源', name: 'U酷资源', pingUrl: 'https://api.ukuapi88.com/' },
  { key: 'ikun资源', name: 'iKun资源', pingUrl: 'https://ikunzyapi.com/' },
  { key: '索尼资源', name: '索尼资源', pingUrl: 'https://suoniapi.com/' }
];

let currentSites = [...VOD_SITES];
let isRegisterMode = true;
let captchaAnswer = 8;
let selectedPlan = null;
let selectedPayMethod = 'wechat';
let pollTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('year').textContent = new Date().getFullYear();
  renderSiteList();
  bindEvents();
  checkLoginState();
});

function bindEvents() {
  // 打开登录/注册弹窗
  document.getElementById('loginOpen').onclick = () => openAuthModal(true);
  document.getElementById('heroTrialBtn').onclick = () => openAuthModal(true);

  // 切换注册/登录模式
  document.getElementById('switchAuth').onclick = (e) => {
    e.preventDefault();
    openAuthModal(!isRegisterMode);
  };

  // 关闭弹窗
  document.querySelectorAll('.close').forEach(btn => {
    btn.onclick = () => {
      document.getElementById(btn.dataset.close).classList.add('hidden');
      if (pollTimer) clearInterval(pollTimer);
    };
  });

  // 提交登录/注册表单
  document.getElementById('authForm').onsubmit = handleAuthSubmit;

  // 退出登录
  document.getElementById('logout').onclick = () => {
    localStorage.removeItem('tvbox_token');
    location.reload();
  };

  // 复制免费直播地址
  document.querySelectorAll('[data-copy-id]').forEach(btn => {
    btn.onclick = () => {
      const text = document.getElementById(btn.dataset.copyId).textContent;
      copyText(text, btn);
    };
  });

  // 节点测速与保存排序
  document.getElementById('startSpeedTest').onclick = runSpeedTest;
  document.getElementById('saveCustomOrder').onclick = saveCustomOrder;

  // 点击购买套餐按钮
  document.querySelectorAll('.order-btn').forEach(btn => {
    btn.onclick = () => {
      const token = localStorage.getItem('tvbox_token');
      if (!token) {
        alert('请先注册或登录账号后再购买会员（注册即送10天点播试用）！');
        openAuthModal(true);
        return;
      }
      selectedPlan = {
        code: btn.dataset.plan,
        title: btn.dataset.title,
        price: btn.dataset.price
      };
      document.getElementById('paymentDetails').innerHTML =
        `购买项目：<b>${selectedPlan.title}</b><br>应付金额：<b style="color:#10b981;font-size:1.1rem;">¥${selectedPlan.price}</b>`;
      document.getElementById('payLast6').value = '';
      document.getElementById('payStatusMsg').textContent = '';
      document.getElementById('paymentModal').classList.remove('hidden');
    };
  });

  // 切换微信/支付宝收款码
  document.querySelectorAll('.qr-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.qr-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectedPayMethod = tab.dataset.pay;
      document.getElementById('qrImage').src = selectedPayMethod === 'wechat' ? 'wechat_qr.png' : 'alipay_qr.png';
    };
  });

  // 提交订单号后6位
  document.getElementById('submitOrderBtn').onclick = submitOrder;
}

// 刷新算术验证码
function generateCaptcha() {
  const a = Math.floor(1 + Math.random() * 9);
  const b = Math.floor(1 + Math.random() * 9);
  captchaAnswer = a + b;
  document.getElementById('captchaLabel').innerHTML =
    `人机验证：${a} + ${b} = ？<input id="captchaInput" type="number" placeholder="请输入计算结果" required>`;
}

function openAuthModal(registerMode) {
  isRegisterMode = registerMode;
  document.getElementById('authError').textContent = '';
  if (isRegisterMode) {
    document.getElementById('authTitle').textContent = '注册并领取 10 天免费试用';
    document.getElementById('authSubtitle').classList.remove('hidden');
    document.getElementById('captchaBox').classList.remove('hidden');
    document.getElementById('authSubmitBtn').textContent = '立即注册并领取试用';
    document.getElementById('authSwitchText').textContent = '已有账号？';
    document.getElementById('switchAuth').textContent = '点击登录';
    generateCaptcha();
  } else {
    document.getElementById('authTitle').textContent = '会员登录';
    document.getElementById('authSubtitle').classList.add('hidden');
    document.getElementById('captchaBox').classList.add('hidden');
    document.getElementById('authSubmitBtn').textContent = '立即登录';
    document.getElementById('authSwitchText').textContent = '还没有账号？';
    document.getElementById('switchAuth').textContent = '免费注册领10天试用';
  }
  document.getElementById('authModal').classList.remove('hidden');
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById('authError');
  errEl.textContent = '';

  const formData = new FormData(e.target);
  const email = formData.get('email');
  const password = formData.get('password');

  if (isRegisterMode) {
    const userAns = Number(document.getElementById('captchaInput').value);
    if (userAns !== captchaAnswer) {
      errEl.textContent = '算术验证码结果错误，请重新计算';
      generateCaptcha();
      return;
    }
  }

  const endpoint = isRegisterMode ? '/api/register' : '/api/login';
  try {
    const res = await fetch(API_BASE + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || '操作失败';
      if (isRegisterMode) generateCaptcha();
      return;
    }

    localStorage.setItem('tvbox_token', data.token);
    document.getElementById('authModal').classList.add('hidden');
    if (data.message) alert(data.message);
    checkLoginState();
  } catch (err) {
    errEl.textContent = '网络请求失败，请稍后再试';
  }
}

async function checkLoginState() {
  const token = localStorage.getItem('tvbox_token');
  if (!token) return;

  try {
    const res = await fetch(API_BASE + '/api/me', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) {
      localStorage.removeItem('tvbox_token');
      return;
    }
    const data = await res.json();
    renderAccountDashboard(data.user, data.orders);
  } catch (e) {}
}

function renderAccountDashboard(user, orders) {
  document.getElementById('loginOpen').textContent = user.email;
  document.getElementById('account').classList.remove('hidden');

  const now = Date.now();
  const vodActive = user.vod_expire_at > now;
  const liveActive = user.live_expire_at > now;
  const subUrl = `${API_BASE}/sub?token=${user.token}`;

  document.getElementById('accountInfo').innerHTML = `
    <div class="sub-url-box">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <strong style="font-size:1.05rem;">🔑 您的专属 TVBox 配置接口（一客一码，切勿外传）</strong>
          <p class="muted" style="margin-top:4px;">填入 TVBox「配置地址」即可同时加载点播与直播，有效期自动同步。</p>
        </div>
        <button class="primary" onclick="copyText('${subUrl}', this)">一键复制专属地址</button>
      </div>
      <code>${subUrl}</code>
    </div>
    <div>
      <span class="muted">点播会员状态</span>
      <div style="margin-top:6px;">
        ${vodActive
          ? `<span class="badge active">生效中</span> <span class="muted">到期：${formatDate(user.vod_expire_at)}</span>`
          : `<span class="badge expired">未开通 / 已到期</span>`}
      </div>
    </div>
    <div>
      <span class="muted">直播会员状态</span>
      <div style="margin-top:6px;">
        ${liveActive
          ? `<span class="badge active">生效中</span> <span class="muted">到期：${formatDate(user.live_expire_at)}</span>`
          : `<span class="badge expired">免费体验版 (10台)</span>`}
      </div>
    </div>
  `;

  // 如果用户之前保存过站点排序，自动应用到当前列表
  if (user.site_order && user.site_order.length > 0) {
    const orderMap = new Map(user.site_order.map((k, i) => [k, i]));
    currentSites.sort((a, b) => {
      const ia = orderMap.has(a.key) ? orderMap.get(a.key) : 999;
      const ib = orderMap.has(b.key) ? orderMap.get(b.key) : 999;
      return ia - ib;
    });
    renderSiteList();
  }

  // 渲染订单列表
  if (orders.length > 0) {
    document.getElementById('orders').innerHTML = orders.map(o => {
      const statusMap = {
        pending: '<span style="color:#f59e0b;">⏳ 审核中（约1-3分钟）</span>',
        approved: '<span style="color:#10b981;">✅ 已开通</span>',
        rejected: '<span style="color:#ef4444;">❌ 已驳回（尾号不符）</span>'
      };
      return `<div class="stat">
        <span><b>${o.plan_name}</b> (¥${o.amount} · ${o.pay_method}尾号:${o.pay_last6})</span>
        <span>${statusMap[o.status] || o.status}</span>
      </div>`;
    }).join('');
  }
}

// ================= 本地浏览器并发测速与排序 =================
function renderSiteList() {
  const container = document.getElementById('siteList');
  container.innerHTML = currentSites.map((site, idx) => {
    let pingHtml = '<span class="muted">待测速</span>';
    if (site.latency !== undefined) {
      if (site.latency === 9999) {
        pingHtml = '<span class="ping-badge ping-bad">超时/较慢</span>';
      } else if (site.latency < 300) {
        pingHtml = `<span class="ping-badge ping-fast">${site.latency} ms</span>`;
      } else {
        pingHtml = `<span class="ping-badge ping-mid">${site.latency} ms</span>`;
      }
    }
    return `
      <div class="site-item">
        <div><span class="site-rank">${idx + 1}</span><b>${site.name}</b></div>
        <div>${pingHtml}</div>
      </div>
    `;
  }).join('');
}

async function runSpeedTest() {
  const btn = document.getElementById('startSpeedTest');
  btn.disabled = true;
  btn.textContent = '⏳ 正在测速中...';

  const tasks = currentSites.map(async (site) => {
    const start = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      await fetch(site.pingUrl, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
      clearTimeout(timer);
      site.latency = Math.round(performance.now() - start);
    } catch (e) {
      clearTimeout(timer);
      site.latency = 9999;
    }
  });

  await Promise.all(tasks);
  currentSites.sort((a, b) => a.latency - b.latency);
  renderSiteList();

  btn.disabled = false;
  btn.textContent = '⚡ 重新测速';
}

async function saveCustomOrder() {
  const token = localStorage.getItem('tvbox_token');
  if (!token) {
    alert('请先登录后再保存您的专属测速排序！');
    openAuthModal(true);
    return;
  }

  const siteOrder = currentSites.map(s => s.key);
  const res = await fetch(API_BASE + '/api/save-order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ siteOrder })
  });
  const data = await res.json();
  alert(data.message || data.error);
}

// ================= 提交订单并自动轮询审核状态 =================
async function submitOrder() {
  const token = localStorage.getItem('tvbox_token');
  const payLast6 = document.getElementById('payLast6').value.trim();
  const msgEl = document.getElementById('payStatusMsg');

  if (!/^\d{6}$/.test(payLast6)) {
    alert('请输入账单订单号的后 6 位数字！');
    return;
  }

  const btn = document.getElementById('submitOrderBtn');
  btn.disabled = true;
  btn.textContent = '正在提交...';

  try {
    const res = await fetch(API_BASE + '/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        planCode: selectedPlan.code,
        payMethod: selectedPayMethod,
        payLast6
      })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || '提交失败');
      btn.disabled = false;
      btn.textContent = '我已完成支付，提交审核';
      return;
    }

    msgEl.innerHTML = '<b style="color:#10b981;">✅ 提交成功！正在等待管理员确认到账（页面会自动刷新状态）...</b>';
    checkLoginState();

    // 每 5 秒轮询一次是否已审核通过
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      const meRes = await fetch(API_BASE + '/api/me', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const meData = await meRes.json();
      const target = (meData.orders || []).find(o => o.order_no === data.orderNo);
      if (target && target.status === 'approved') {
        clearInterval(pollTimer);
        document.getElementById('paymentModal').classList.add('hidden');
        alert('🎉 审核通过！您的会员已实时开通，请复制专属配置地址填入 TVBox！');
        renderAccountDashboard(meData.user, meData.orders);
      } else if (target && target.status === 'rejected') {
        clearInterval(pollTimer);
        msgEl.innerHTML = '<b style="color:#ef4444;">❌ 审核未通过：未核实到对应尾号账单，请核对后重新提交。</b>';
        btn.disabled = false;
        btn.textContent = '重新提交审核';
      }
    }, 5000);
  } catch (err) {
    alert('网络异常，请重试');
    btn.disabled = false;
    btn.textContent = '我已完成支付，提交审核';
  }
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const old = btn.textContent;
    btn.textContent = '✅ 已复制';
    setTimeout(() => btn.textContent = old, 2000);
  });
}

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
