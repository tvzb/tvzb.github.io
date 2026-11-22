// ⚠️ Cloudflare Worker 后端域名（末尾不要加斜杠）
const API_BASE = 'https://tvbox.hahagw.eu.org';

// 与你的 tv.txt 对应的 21 个点播资源站列表（用于本地浏览器测速与排序）
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
let isRegisterMode = true;
let selectedPlan = null;
let selectedPayMethod = 'wechat';
let pollTimer = null;
let codeCooldown = 0;
let codeTimer = null;

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

  // 发送验证码
  document.getElementById('sendCodeBtn').onclick = sendEmailCode;

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

  // 节点测速、保存排序及实时预览开关
  document.getElementById('startSpeedTest').onclick = runSpeedTest;
  document.getElementById('saveCustomOrder').onclick = saveCustomOrder;
  ['optTagRank', 'optShowSpeed'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderSiteList);
  });

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

function openAuthModal(registerMode) {
  isRegisterMode = registerMode;
  document.getElementById('authError').textContent = '';
  document.getElementById('emailCode').value = '';

  if (isRegisterMode) {
    document.getElementById('authTitle').textContent = '注册并领取 10 天免费试用';
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
    document.getElementById('switchAuth').textContent = '免费注册领10天试用';
  }
  document.getElementById('authModal').classList.remove('hidden');
}

async function sendEmailCode() {
  const email = document.querySelector('#authForm input[name="email"]').value.trim();
  const errEl = document.getElementById('authError');
  errEl.textContent = '';

  if (!email) {
    errEl.textContent = '请先填写邮箱地址';
    return;
  }

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
  const body = isRegisterMode
    ? { email, password, code }
    : { email, password };

  try {
    const res = await fetch(API_BASE + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || '操作失败';
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

  const vodUrl = user.vodSubUrl || `${API_BASE}/sub/vod?token=${user.token}`;
  const liveUrl = user.liveSubUrl || `${API_BASE}/sub/live?token=${user.token}`;

  document.getElementById('accountInfo').innerHTML = `
    <div class="sub-url-box">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <strong style="font-size:1.05rem;">🔑 您的专属订阅地址（一客一码，切勿外传）</strong>
          <p class="muted" style="margin-top:4px;">点播与直播已完全分离，只展示您当前拥有权限的地址。请分别填入 TVBox 对应位置。</p>
        </div>
      </div>

      <div class="sub-item" style="margin-top:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <b>📺 点播订阅地址</b>
            <span class="badge ${vodActive ? 'active' : 'expired'}" style="margin-left:8px;">
              ${vodActive ? '生效中 · 到期 ' + formatDate(user.vod_expire_at) : '未开通 / 已到期'}
            </span>
          </div>
          ${vodActive ? `<button class="primary" onclick="copyText('${vodUrl}', this)">一键复制点播地址</button>` : ''}
        </div>
        ${vodActive ? `<code>${vodUrl}</code>` : '<p class="muted" style="margin-top:6px;">开通点播会员后即可获得专属点播接口</p>'}
      </div>

      <div class="sub-item" style="margin-top:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <b>📡 直播订阅地址</b>
            <span class="badge ${liveActive ? 'active' : 'expired'}" style="margin-left:8px;">
              ${liveActive ? '生效中 · 到期 ' + formatDate(user.live_expire_at) : '免费体验版 (10台)'}
            </span>
          </div>
          <button class="primary" onclick="copyText('${liveUrl}', this)">一键复制直播地址</button>
        </div>
        <code>${liveUrl}</code>
        <p class="muted" style="margin-top:6px;font-size:0.85rem;">提示：直播地址仅限 TVBox 客户端使用，浏览器直接打开会显示提示信息，防止源地址泄露。</p>
      </div>
    </div>
  `;

  // 同步用户之前保存的开关偏好与站点排序
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

  // 渲染订单列表
  if (orders && orders.length > 0) {
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
  } else {
    document.getElementById('orders').innerHTML = '暂无订单记录';
  }
}

// ================= 本地家庭宽带真实拉流测速与排序 =================
function formatSiteTitle(site, rankIndex) {
  const tagRank = document.getElementById('optTagRank')?.checked ?? true;
  const showSpeed = document.getElementById('optShowSpeed')?.checked ?? false;
  if (site.status === 'failed') return `❌ ${site.name}`;
  let title = site.name;
  if (tagRank && site.status === 'ok') {
    title = `${String(rankIndex).padStart(2, '0')}丨${title}`;
  }
  if (showSpeed && site.speedMBs > 0) {
    title += ` [${site.speedMBs.toFixed(1)}M/s]`;
  }
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

// 用用户自家宽带直连 .ts 切片测速（最多下载 1.5MB）
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
        if (downloaded >= 1.5 * 1024 * 1024) {
          controller.abort();
          break;
        }
      }
    } else {
      downloaded = (await resp.arrayBuffer()).byteLength;
    }

    const sec = Math.max((performance.now() - dlStart) / 1000, 0.05);
    return { speedMBs: (downloaded / (1024 * 1024)) / sec, latency };
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // 若该 CDN 禁止 CORS，降级为 no-cors 整片下载耗时估算
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

  // 1. 并发拉取两批切片样本
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

  // 2. 控制 3 并发用用户宽带实测，避免互相抢占带宽
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
          // 兜底测接口连接时间
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

      // 按速度降序 -> 延迟升序 -> 失败沉底
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
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
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
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
