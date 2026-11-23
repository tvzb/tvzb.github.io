// ⚠️ Cloudflare Worker 后端域名（末尾不要加斜杠）
const API_BASE = 'https://tvbox.hahagw.eu.org';

// 与 tv.txt 对应的 21 个点播资源站列表（用于本地家庭宽带测速与排序）
const VOD_SITES = [
  { key: '非凡资源', name: '非凡资源', pingUrl: 'https://api.ffzyapi.com/' },
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
  { key: '电影天堂', name: '电影天堂', pingUrl: 'https://caiji.dyttzyapi.com/' },
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

let currentSites = VOD_SITES.map(s => ({ ...s, status: 'idle', speedMBs: 0, latency: undefined }));
let summaryChannels = [];
let currentSummaryGroup = 'all';
let isRegisterMode = true;
let selectedPlan = null;
let appliedCoupon = null;
let selectedPayMethod = 'wechat';
let pollTimer = null;
let codeCooldown = 0;
let codeTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('year').textContent = new Date().getFullYear();
  renderSiteList();
  bindEvents();
  loadChannelSummary();
  checkLoginState();
});

function bindEvents() {
  document.getElementById('loginOpen').onclick = () => openAuthModal(true);
  document.getElementById('heroTrialBtn').onclick = () => openAuthModal(true);

  document.getElementById('switchAuth').onclick = (e) => {
    e.preventDefault();
    openAuthModal(!isRegisterMode);
  };

  document.querySelectorAll('.close').forEach(btn => {
    btn.onclick = () => {
      document.getElementById(btn.dataset.close).classList.add('hidden');
      if (pollTimer) clearInterval(pollTimer);
    };
  });

  document.getElementById('authForm').onsubmit = handleAuthSubmit;
  document.getElementById('sendCodeBtn').onclick = sendEmailCode;

  document.getElementById('logout').onclick = () => {
    localStorage.removeItem('tvbox_token');
    location.reload();
  };

  document.querySelectorAll('[data-copy-id]').forEach(btn => {
    btn.onclick = () => copyText(document.getElementById(btn.dataset.copyId).textContent, btn);
  });

  // 实时频道看板筛选与搜索
  document.querySelectorAll('.tab-pill[data-group]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-pill[data-group]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSummaryGroup = btn.dataset.group;
      renderChannelSummaryTable();
    };
  });
  document.getElementById('channelSearch')?.addEventListener('input', renderChannelSummaryTable);

  // 测速与排序
  document.getElementById('startSpeedTest').onclick = runSpeedTest;
  document.getElementById('saveCustomOrder').onclick = saveCustomOrder;
  ['optTagRank', 'optShowSpeed'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderSiteList);
  });

  // 购买套餐弹窗
  document.querySelectorAll('.order-btn').forEach(btn => {
    btn.onclick = () => {
      const token = localStorage.getItem('tvbox_token');
      if (!token) {
        alert('请先注册或登录账号后再购买会员（注册即送 5 天点播+直播全功能试用）！');
        openAuthModal(true);
        return;
      }
      selectedPlan = {
        code: btn.dataset.plan,
        title: btn.dataset.title,
        price: Number(btn.dataset.price)
      };
      appliedCoupon = null;
      document.getElementById('couponInput').value = '';
      document.getElementById('couponMsg').textContent = '';
      document.getElementById('payLast6').value = '';
      document.getElementById('payStatusMsg').textContent = '';
      renderPaymentSummary();
      document.getElementById('paymentModal').classList.remove('hidden');
    };
  });

  document.getElementById('verifyCouponBtn').onclick = verifyCoupon;

  document.querySelectorAll('.qr-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.qr-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectedPayMethod = tab.dataset.pay;
      document.getElementById('qrImage').src = selectedPayMethod === 'wechat' ? 'wechat_qr.png' : 'alipay_qr.png';
    };
  });

  document.getElementById('submitOrderBtn').onclick = submitOrder;

  // 工单弹窗
  document.getElementById('openTicketModalBtn').onclick = () => {
    document.getElementById('ticketSubject').value = '';
    document.getElementById('ticketContent').value = '';
    document.getElementById('ticketMsg').textContent = '';
    document.getElementById('ticketModal').classList.remove('hidden');
  };
  document.getElementById('submitTicketBtn').onclick = submitTicket;
}

// ================= 实时频道汇总看板（优先读同域 channel_summary.json，兜底读 Worker） =================
async function loadChannelSummary() {
  let data = null;
  try {
    const r = await fetch('./channel_summary.json?_t=' + Math.floor(Date.now() / 60000));
    if (r.ok) data = await r.json();
  } catch (e) {}

  if (!data) {
    try {
      const r2 = await fetch(API_BASE + '/api/channel-summary');
      if (r2.ok) data = await r2.json();
    } catch (e) {}
  }

  const tbody = document.getElementById('summaryTableBody');
  if (!data || !Array.isArray(data.channels)) {
    document.getElementById('summaryUpdatedAt').textContent = '等待首次工作流同步汇总数据';
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">暂未生成频道汇总数据，运行工作流后将自动更新展示。</td></tr>';
    return;
  }

  document.getElementById('summaryUpdatedAt').textContent = `最近同步：${data.updated_at || data.date || '-'}`;
  document.getElementById('kpiChannels').textContent = `${data.total_channels || 0} / ${data.total_targets || 49}`;
  document.getElementById('kpiStreams').textContent = data.total_streams ?? '-';
  document.getElementById('kpiHd').textContent = data.hd_streams ?? '-';
  document.getElementById('kpiSpeed').textContent = data.avg_speed_kbs ? `${data.avg_speed_kbs} KB/s` : '-';
  document.getElementById('kpiTtfb').textContent = data.avg_ttfb_ms ? `${data.avg_ttfb_ms} ms` : '-';

  summaryChannels = data.channels;
  renderChannelSummaryTable();
}

function renderChannelSummaryTable() {
  const tbody = document.getElementById('summaryTableBody');
  const q = (document.getElementById('channelSearch')?.value || '').trim().toLowerCase();
  const filtered = summaryChannels.filter(item => {
    if (currentSummaryGroup !== 'all' && item.group !== currentSummaryGroup) return false;
    if (q && !item.channel.toLowerCase().includes(q)) return false;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">没有匹配的频道</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const cls = r.count >= 8 ? 'cnt-ok' : (r.count > 0 ? 'cnt-warn' : 'cnt-zero');
    return `<tr>
      <td><span class="grp-tag">${escapeHtml(r.group)}</span></td>
      <td><b>${escapeHtml(r.channel)}</b></td>
      <td><span class="cnt-badge ${cls}">${r.count}</span></td>
      <td><code class="spec-code">${escapeHtml(r.spec || '--')}</code></td>
      <td class="num-col">${r.speed_kbs ? r.speed_kbs + ' KB/s' : '--'}</td>
      <td class="num-col">${r.ttfb_ms ? r.ttfb_ms + ' ms' : '--'}</td>
    </tr>`;
  }).join('');
}

// ================= 登录与注册 =================
function openAuthModal(registerMode) {
  isRegisterMode = registerMode;
  document.getElementById('authError').textContent = '';
  document.getElementById('emailCode').value = '';

  if (isRegisterMode) {
    document.getElementById('authTitle').textContent = '注册并领取 5 天全功能免费试用';
    document.getElementById('authSubtitle').classList.remove('hidden');
    document.getElementById('codeRow').classList.remove('hidden');
    document.getElementById('authSubmitBtn').textContent = '立即注册并领取试用';
    document.getElementById('authSwitchText').textContent = '已有账号？';
    document.getElementById('switchAuth').textContent = '点击登录';
  } else {
    document.getElementById('authTitle').textContent = '会员登录';
    document.getElementById('authSubtitle').classList.add('hidden');
    document.getElementById('codeRow').classList.add('hidden');
    document.getElementById('authSubmitBtn').textContent = '立即登录';
    document.getElementById('authSwitchText').textContent = '还没有账号？';
    document.getElementById('switchAuth').textContent = '免费注册领5天试用';
  }
  document.getElementById('authModal').classList.remove('hidden');
}

async function sendEmailCode() {
  const email = document.querySelector('#authForm input[name="email"]').value.trim();
  const errEl = document.getElementById('authError');
  errEl.textContent = '';
  if (!email) { errEl.textContent = '请先填写邮箱地址'; return; }
  if (codeCooldown > 0) return;

  const btn = document.getElementById('sendCodeBtn');
  btn.disabled = true;
  btn.textContent = '发送中...';

  try {
    const res = await fetch(API_BASE + '/api/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || '发送失败';
      btn.disabled = false;
      btn.textContent = '获取验证码';
      return;
    }

    codeCooldown = 60;
    btn.textContent = `${codeCooldown}s 后重发`;
    codeTimer = setInterval(() => {
      codeCooldown--;
      if (codeCooldown <= 0) {
        clearInterval(codeTimer);
        btn.disabled = false;
        btn.textContent = '获取验证码';
      } else {
        btn.textContent = `${codeCooldown}s 后重发`;
      }
    }, 1000);
    alert(data.message || '验证码已发送');
  } catch (e) {
    errEl.textContent = '网络请求失败，请稍后再试';
    btn.disabled = false;
    btn.textContent = '获取验证码';
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById('authError');
  errEl.textContent = '';
  const formData = new FormData(e.target);
  const email = formData.get('email');
  const password = formData.get('password');
  const code = formData.get('code') || '';

  const endpoint = isRegisterMode ? '/api/register' : '/api/login';
  const body = isRegisterMode ? { email, password, code } : { email, password };

  try {
    const res = await fetch(API_BASE + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || '操作失败'; return; }

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
    if (!res.ok) { localStorage.removeItem('tvbox_token'); return; }
    const data = await res.json();
    renderAccountDashboard(data.user, data.orders, data.tickets);
  } catch (e) {}
}

function renderAccountDashboard(user, orders, tickets) {
  document.getElementById('loginOpen').textContent = user.email;
  document.getElementById('account').classList.remove('hidden');

  const now = Date.now();
  const vodActive = user.vod_expire_at > now;
  const liveActive = user.live_expire_at > now;

  const allUrl = user.allSubUrl || `${API_BASE}/sub/all?token=${user.token}`;
  const vodUrl = user.vodSubUrl || `${API_BASE}/sub/vod?token=${user.token}`;
  const liveUrl = user.liveSubUrl || `${API_BASE}/sub/live?token=${user.token}`;

  document.getElementById('accountInfo').innerHTML = `
    <div class="sub-url-box">
      <div>
        <strong style="font-size:1.05rem;">🔑 您的专属 TVBox 配置地址（一客一码，切勿外传）</strong>
        <p class="muted" style="margin-top:4px;">点播与直播权益状态实时同步。推荐直接复制下方的「一键全能聚合地址」填入 TVBox 配置地址栏，一步到位。</p>
      </div>

      <div class="sub-item" style="margin-top:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <b>🚀 一键全能聚合地址（推荐直接填这个）</b>
            <span class="badge ${vodActive ? 'active' : 'expired'}" style="margin-left:6px;">点播: ${vodActive ? formatDate(user.vod_expire_at) : '未开通'}</span>
            <span class="badge ${liveActive ? 'active' : 'expired'}" style="margin-left:6px;">直播: ${liveActive ? formatDate(user.live_expire_at) : '免费10台'}</span>
          </div>
          <button class="primary" onclick="copyText('${allUrl}', this)">一键复制聚合地址</button>
        </div>
        <code>${allUrl}</code>
        <p class="muted" style="margin-top:6px;font-size:0.84rem;">安全说明：订阅与直播源均受云端代理保护，仅限 TVBox 客户端加载，浏览器直接打开会拦截。</p>
      </div>

      <details style="margin-top:14px;border-top:1px dashed var(--border);padding-top:12px;">
        <summary style="cursor:pointer;color:var(--muted);font-size:0.9rem;">高级选项：展开独立的点播 / 直播分离地址</summary>
        <div class="sub-item" style="margin-top:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <b>📺 独立点播地址</b>
            <button class="secondary" style="padding:6px 12px;font-size:0.85rem;" onclick="copyText('${vodUrl}', this)">复制点播地址</button>
          </div>
          <code>${vodUrl}</code>
        </div>
        <div class="sub-item">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <b>📡 独立直播地址</b>
            <button class="secondary" style="padding:6px 12px;font-size:0.85rem;" onclick="copyText('${liveUrl}', this)">复制直播地址</button>
          </div>
          <code>${liveUrl}</code>
        </div>
      </details>
    </div>
  `;

  const optTagRank = document.getElementById('optTagRank');
  const optHideFailed = document.getElementById('optHideFailed');
  if (optTagRank && typeof user.tag_rank === 'boolean') optTagRank.checked = user.tag_rank;
  if (optHideFailed && typeof user.hide_failed === 'boolean') optHideFailed.checked = user.hide_failed;

  if (user.site_order && user.site_order.length > 0) {
    const orderMap = new Map(user.site_order.map((k, i) => [k, i]));
    currentSites.sort((a, b) => {
      const ia = orderMap.has(a.key) ? orderMap.get(a.key) : 999;
      const ib = orderMap.has(b.key) ? orderMap.get(b.key) : 999;
      return ia - ib;
    });
    renderSiteList();
  }

  // 订单列表
  if (orders && orders.length > 0) {
    document.getElementById('orders').innerHTML = orders.map(o => {
      const statusMap = {
        pending: '<span style="color:#f59e0b;">⏳ 审核中</span>',
        approved: '<span style="color:#10b981;">✅ 已开通</span>',
        rejected: '<span style="color:#ef4444;">❌ 已驳回</span>'
      };
      const couponTag = o.coupon_code ? ` · 券:${escapeHtml(o.coupon_code)}` : '';
      return `<div class="stat">
        <span><b>${escapeHtml(o.plan_name)}</b> (¥${o.amount}${couponTag} · 尾号:${escapeHtml(o.pay_last6)})</span>
        <span>${statusMap[o.status] || o.status}</span>
      </div>`;
    }).join('');
  } else {
    document.getElementById('orders').innerHTML = '<span class="muted">暂无订单记录</span>';
  }

  // 工单列表
  renderUserTickets(tickets || []);
}

function renderUserTickets(tickets) {
  const el = document.getElementById('userTickets');
  if (!tickets || tickets.length === 0) {
    el.innerHTML = '<span class="muted">暂无工单记录，遇到安装或使用问题可点击右上角提交。</span>';
    return;
  }
  const stMap = {
    open: '<span style="color:#f59e0b;">待回复</span>',
    replied: '<span style="color:#10b981;">已回复</span>',
    closed: '<span style="color:#94a3b8;">已关闭</span>'
  };
  el.innerHTML = tickets.map(t => `
    <div class="ticket-item">
      <div class="ticket-head">
        <span><span class="grp-tag">${escapeHtml(t.category)}</span> <b>${escapeHtml(t.subject)}</b></span>
        <span>${stMap[t.status] || t.status}</span>
      </div>
      <div class="muted" style="font-size:0.84rem;margin-top:4px;">${escapeHtml(t.content)}</div>
      ${t.admin_reply ? `<div class="ticket-reply">💬 客服回复：${escapeHtml(t.admin_reply)}</div>` : ''}
    </div>
  `).join('');
}

async function submitTicket() {
  const token = localStorage.getItem('tvbox_token');
  if (!token) { alert('请先登录'); return; }
  const category = document.getElementById('ticketCategory').value;
  const subject = document.getElementById('ticketSubject').value.trim();
  const content = document.getElementById('ticketContent').value.trim();
  const msg = document.getElementById('ticketMsg');
  msg.textContent = '';

  if (!subject || !content) {
    msg.textContent = '请填写问题标题和详细描述';
    msg.style.color = '#ef4444';
    return;
  }

  const btn = document.getElementById('submitTicketBtn');
  btn.disabled = true;
  btn.textContent = '提交中...';
  try {
    const res = await fetch(API_BASE + '/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ category, subject, content })
    });
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || '提交失败';
      msg.style.color = '#ef4444';
    } else {
      msg.textContent = data.message || '提交成功';
      msg.style.color = '#10b981';
      setTimeout(() => {
        document.getElementById('ticketModal').classList.add('hidden');
        checkLoginState();
      }, 800);
    }
  } catch (e) {
    msg.textContent = '网络异常，请重试';
    msg.style.color = '#ef4444';
  } finally {
    btn.disabled = false;
    btn.textContent = '提交工单';
  }
}

// ================= 优惠码核验与支付金额渲染 =================
function renderPaymentSummary() {
  if (!selectedPlan) return;
  const el = document.getElementById('paymentDetails');
  if (appliedCoupon) {
    el.innerHTML =
      `购买项目：<b>${escapeHtml(selectedPlan.title)}</b><br>` +
      `原价：<s>¥${appliedCoupon.originalAmount}</s> &nbsp; 优惠：<b style="color:#f59e0b;">-¥${appliedCoupon.discountAmount}</b> (${escapeHtml(appliedCoupon.desc)})<br>` +
      `实付金额：<b style="color:#10b981;font-size:1.2rem;">¥${appliedCoupon.finalAmount}</b>`;
  } else {
    el.innerHTML =
      `购买项目：<b>${escapeHtml(selectedPlan.title)}</b><br>` +
      `应付金额：<b style="color:#10b981;font-size:1.15rem;">¥${selectedPlan.price}</b>`;
  }
}

async function verifyCoupon() {
  const code = document.getElementById('couponInput').value.trim().toUpperCase();
  const msg = document.getElementById('couponMsg');
  if (!code) {
    appliedCoupon = null;
    msg.textContent = '';
    renderPaymentSummary();
    return;
  }
  msg.textContent = '正在核验优惠码...';
  msg.style.color = '#94a3b8';

  try {
    const res = await fetch(API_BASE + '/api/coupon/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, planCode: selectedPlan.code })
    });
    const data = await res.json();
    if (!res.ok) {
      appliedCoupon = null;
      msg.textContent = '❌ ' + (data.error || '优惠码无效');
      msg.style.color = '#ef4444';
      renderPaymentSummary();
      return;
    }
    appliedCoupon = data;
    msg.textContent = `✅ 已使用优惠码 ${data.code}（${data.desc}），请按折后金额扫码支付！`;
    msg.style.color = '#10b981';
    renderPaymentSummary();
  } catch (e) {
    msg.textContent = '核验失败，请稍后重试';
    msg.style.color = '#ef4444';
  }
}

// ================= 本地家庭宽带真实拉流测速与排序 =================
function formatSiteTitle(site, rankIndex) {
  const tagRank = document.getElementById('optTagRank')?.checked ?? true;
  const showSpeed = document.getElementById('optShowSpeed')?.checked ?? false;
  if (site.status === 'failed') return `❌ ${site.name}`;
  let title = site.name;
  if (tagRank && site.status === 'ok') title = `${String(rankIndex).padStart(2, '0')}丨${title}`;
  if (showSpeed && site.speedMBs > 0) title += ` [${site.speedMBs.toFixed(1)}M/s]`;
  return title;
}

function renderSiteList() {
  const container = document.getElementById('siteList');
  if (!container) return;

  let validRank = 0;
  container.innerHTML = currentSites.map((site, idx) => {
    if (site.status === 'ok') validRank++;
    const displayTitle = formatSiteTitle(site, site.status === 'ok' ? validRank : idx + 1);

    let metricHtml = '<span class="muted">待测速</span>';
    if (site.status === 'testing') {
      metricHtml = '<span style="color:#3b82f6;">拉流测速中...</span>';
    } else if (site.status === 'ok') {
      const cls = site.speedMBs >= 3 ? 'speed-fast' : (site.speedMBs >= 1 ? 'speed-mid' : 'speed-slow');
      const speedText = site.speedMBs > 0 ? `${site.speedMBs.toFixed(2)} MB/s` : '可连接';
      metricHtml = `<div class="speed-val ${cls}">${speedText}</div><div class="muted" style="font-size:12px;">起播 ${site.latency} ms</div>`;
    } else if (site.status === 'failed') {
      metricHtml = '<span class="speed-slow">超时 / 不可用</span>';
    }

    const badgeClass = (site.status === 'ok' && validRank <= 3) ? 'rank-badge top3' : 'rank-badge';
    const badgeText = site.status === 'ok' ? String(validRank).padStart(2, '0') : String(idx + 1).padStart(2, '0');

    return `
      <div class="site-card ${site.status || ''}">
        <div class="site-title">
          <span class="${badgeClass}">${badgeText}</span>
          <span>${displayTitle}</span>
        </div>
        <div class="site-metrics">${metricHtml}</div>
      </div>
    `;
  }).join('');
}

async function measureRealSlice(tsUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const url = tsUrl + (tsUrl.includes('?') ? '&' : '?') + '_t=' + Date.now();
  const start = performance.now();

  try {
    const resp = await fetch(url, { mode: 'cors', cache: 'no-store', signal: controller.signal });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    const latency = Math.round(performance.now() - start);
    const reader = resp.body?.getReader();
    let downloaded = 0;
    const dlStart = performance.now();

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        downloaded += value.byteLength;
        if (downloaded >= 1.5 * 1024 * 1024) { controller.abort(); break; }
      }
    } else {
      downloaded = (await resp.arrayBuffer()).byteLength;
    }

    const sec = Math.max((performance.now() - dlStart) / 1000, 0.05);
    return { speedMBs: (downloaded / (1024 * 1024)) / sec, latency };
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    const s2 = performance.now();
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    const ms = Math.max(performance.now() - s2, 50);
    return { speedMBs: 1.0 / (ms / 1000), latency: Math.round(ms) };
  } finally {
    clearTimeout(timer);
  }
}

async function runSpeedTest() {
  const btn = document.getElementById('startSpeedTest');
  const progressWrap = document.getElementById('speedProgressWrap');
  const progressFill = document.getElementById('speedProgressFill');
  const statusText = document.getElementById('speedStatusText');
  const countText = document.getElementById('speedCountText');
  const modeBadge = document.getElementById('speedModeBadge');

  btn.disabled = true;
  btn.textContent = '⏳ 正在拉流测速...';
  progressWrap?.classList.remove('hidden');
  if (progressFill) progressFill.style.width = '0%';

  currentSites.forEach(s => { s.status = 'idle'; s.speedMBs = 0; s.latency = 9999; });
  renderSiteList();

  let samples = {};
  try {
    if (statusText) statusText.textContent = '正在获取 21 个站点最新影片切片...';
    const [r1, r2] = await Promise.all([
      fetch(API_BASE + '/api/vod-samples?batch=1').then(r => r.ok ? r.json() : {}),
      fetch(API_BASE + '/api/vod-samples?batch=2').then(r => r.ok ? r.json() : {})
    ]);
    samples = { ...r1, ...r2 };
    if (modeBadge) modeBadge.textContent = '测速模式：真实视频切片拉流 (MB/s)';
  } catch {
    if (modeBadge) modeBadge.textContent = '测速模式：接口延迟降级模式';
  }

  let finished = 0;
  const total = currentSites.length;
  const queue = [...currentSites];

  async function worker() {
    while (queue.length > 0) {
      const site = queue.shift();
      site.status = 'testing';
      if (statusText) statusText.textContent = `正在实测：${site.name}...`;
      renderSiteList();

      try {
        const sample = samples[site.key];
        if (sample?.tsUrl) {
          const res = await measureRealSlice(sample.tsUrl);
          site.status = 'ok';
          site.speedMBs = res.speedMBs;
          site.latency = res.latency;
        } else {
          const start = performance.now();
          await fetch(site.pingUrl, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(4000) });
          site.status = 'ok';
          site.speedMBs = 0;
          site.latency = Math.round(performance.now() - start);
        }
      } catch {
        site.status = 'failed';
        site.speedMBs = 0;
        site.latency = 9999;
      }

      finished++;
      if (countText) countText.textContent = `${finished} / ${total}`;
      if (progressFill) progressFill.style.width = `${Math.round((finished / total) * 100)}%`;

      currentSites.sort((a, b) => {
        if (a.status === 'ok' && b.status !== 'ok') return -1;
        if (a.status !== 'ok' && b.status === 'ok') return 1;
        if (b.speedMBs !== a.speedMBs) return b.speedMBs - a.speedMBs;
        return a.latency - b.latency;
      });
      renderSiteList();
    }
  }

  await Promise.all([worker(), worker(), worker()]);

  if (statusText) statusText.textContent = '✅ 测速完成！点击「保存为我的专属排序」即可同步到电视端';
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

  const hideFailed = document.getElementById('optHideFailed')?.checked ?? true;
  const tagRank = document.getElementById('optTagRank')?.checked ?? true;
  const listToSave = currentSites.filter(s => !(hideFailed && s.status === 'failed'));
  const siteOrder = listToSave.map(s => s.key);

  const res = await fetch(API_BASE + '/api/save-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ siteOrder, tagRank, hideFailed })
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
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        planCode: selectedPlan.code,
        payMethod: selectedPayMethod,
        payLast6,
        couponCode: appliedCoupon ? appliedCoupon.code : ''
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
        alert('🎉 审核通过！您的会员已实时开通，请复制专属聚合地址填入 TVBox！');
        renderAccountDashboard(meData.user, meData.orders, meData.tickets);
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
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    const old = btn.textContent;
    btn.textContent = '✅ 已复制';
    setTimeout(() => btn.textContent = old, 2000);
  });
}

function formatDate(ts) {
  if (!ts || ts <= 0) return '未开通';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}
