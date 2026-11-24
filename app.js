// ⚠️ Cloudflare Worker 后端域名（末尾不要加斜杠）
const API_BASE = 'https://tvbox.hahagw.eu.org';

// 12 款可选用户头像图标
const AVATAR_OPTIONS = [
  { icon: '🎬', label: '影视迷' },
  { icon: '🦊', label: '极速狐' },
  { icon: '🐱', label: '追剧猫' },
  { icon: '🚀', label: '宇航员' },
  { icon: '🎮', label: '玩家' },
  { icon: '🐼', label: '国宝' },
  { icon: '🦉', label: '夜猫子' },
  { icon: '🎧', label: '音浪' },
  { icon: '🌟', label: '星探' },
  { icon: '🐉', label: '龙腾' },
  { icon: '🦁', label: '狮王' },
  { icon: '🍿', label: '爆米花' }
];

// 默认脱敏点播专线（启动后自动通过 /api/vod-sites 与后台实时同步）
const DEFAULT_VOD_SITES = Array.from({ length: 21 }, (_, i) => ({
  key: `line_${String(i + 1).padStart(2, '0')}`,
  name: `极速专线 ${String(i + 1).padStart(2, '0')}`,
  pingUrl: ''
}));

let currentSites = DEFAULT_VOD_SITES.map(s => ({ ...s, status: 'idle', speedMBs: 0, latency: undefined }));
let dynamicPlans = [];
let earlyBirdState = null;
let currentPlanCategory = 'combo';
let summaryChannels = [];
let currentSummaryGroup = 'all';
let currentTrialDays = 7;
let currentVodCount = 21;
let couponsEnabled = true;
let currentUser = null;
let isRegisterMode = true;
let selectedPlan = null;
let appliedCoupon = null;
let selectedPayMethod = 'wechat';
let pollTimer = null;
let codeCooldown = 0;
let codeTimer = null;
let toastTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('year').textContent = new Date().getFullYear();
  initTheme();
  renderAvatarPicker();
  renderSiteList();
  bindEvents();
  loadPublicConfigAndSites();
  loadChannelSummary();
  checkLoginState();
});

// ================= 深色/浅色主题切换 =================
function initTheme() {
  const saved = localStorage.getItem('tvbox_theme') || 'dark';
  applyTheme(saved);
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('tvbox_theme', theme);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// ================= 轻提示 Toast =================
function showToast(msg, duration = 2600) {
  const box = document.getElementById('toastBox');
  if (!box) return;
  box.textContent = msg;
  box.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.add('hidden'), duration);
}

// ================= App 级分栏视图切换 =================
function switchView(tabName) {
  document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + tabName);
  if (target) target.classList.add('active');

  document.querySelectorAll('[data-nav]').forEach(el => {
    if (el.classList.contains('nav-pill') || el.classList.contains('mnav-item')) {
      el.classList.toggle('active', el.dataset.nav === tabName);
    }
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindEvents() {
  document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });

  // 所有分栏切换触发器
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (el.tagName === 'A') e.preventDefault();
      switchView(el.dataset.nav);
    });
  });

  // 登录/注册入口
  document.getElementById('loginOpen').onclick = () => openAuthModal(true);
  document.getElementById('heroTrialBtn').onclick = () => {
    if (currentUser) { switchView('mine'); return; }
    openAuthModal(true);
  };
  document.getElementById('mineRegisterBtn').onclick = () => openAuthModal(true);
  document.getElementById('mineLoginBtn').onclick = () => openAuthModal(false);
  document.getElementById('userAvatarBtn').onclick = () => switchView('mine');

  // 头像选择器
  document.getElementById('openAvatarPickerBtn').onclick = () => {
    renderAvatarPicker();
    document.getElementById('avatarModal').classList.remove('hidden');
  };

  document.getElementById('switchAuth').onclick = (e) => {
    e.preventDefault();
    openAuthModal(!isRegisterMode);
  };

  document.getElementById('openResetPwd').onclick = (e) => {
    e.preventDefault();
    document.getElementById('authModal').classList.add('hidden');
    document.getElementById('resetMsg').textContent = '';
    document.getElementById('resetModal').classList.remove('hidden');
  };
  document.getElementById('sendResetCodeBtn').onclick = sendResetCode;
  document.getElementById('confirmResetPwdBtn').onclick = confirmResetPassword;

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

  // 套餐分类切换
  document.querySelectorAll('#planCategoryTabs .seg-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#planCategoryTabs .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPlanCategory = btn.dataset.cat;
      renderDynamicPlans();
    };
  });

  // 频道监测筛选
  document.querySelectorAll('.ch-grp-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.ch-grp-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSummaryGroup = btn.dataset.group;
      renderChannelSummaryList();
    };
  });
  document.getElementById('channelSearch')?.addEventListener('input', renderChannelSummaryList);

  // 宽带测速
  document.getElementById('startSpeedTest').onclick = runSpeedTest;
  document.getElementById('saveCustomOrder').onclick = saveCustomOrder;
  ['optTagRank', 'optShowSpeed'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderSiteList);
  });

  // 支付与优惠码
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

  // 工单入口
  const openTicketOrAuth = () => {
    if (!localStorage.getItem('tvbox_token')) {
      showToast('请先登录后再提交客服工单');
      openAuthModal(false);
      return;
    }
    document.getElementById('ticketSubject').value = '';
    document.getElementById('ticketContent').value = '';
    document.getElementById('ticketMsg').textContent = '';
    document.getElementById('ticketModal').classList.remove('hidden');
  };
  document.getElementById('openTicketModalBtn').onclick = openTicketOrAuth;
  document.querySelectorAll('[data-open-ticket]').forEach(btn => { btn.onclick = openTicketOrAuth; });
  document.getElementById('submitTicketBtn').onclick = submitTicket;
}

// ================= 动态加载站点配置、动态套餐、早鸟折扣与点播站 =================
async function loadPublicConfigAndSites() {
  try {
    const r = await fetch(API_BASE + '/api/public-config');
    if (r.ok) {
      const cfg = await r.json();
      if (cfg.freeLiveUrl) {
        const el = document.getElementById('freeLiveUrl');
        if (el) el.textContent = cfg.freeLiveUrl;
      }
      if (cfg.trialDays !== undefined && cfg.trialDays !== null) {
        currentTrialDays = Number(cfg.trialDays);
        document.querySelectorAll('.js-trial-days').forEach(el => { el.textContent = String(currentTrialDays); });
      }
      if (cfg.vodSiteCount !== undefined) {
        currentVodCount = Number(cfg.vodSiteCount);
        document.querySelectorAll('.js-vod-count').forEach(el => { el.textContent = String(currentVodCount); });
        const mv = document.getElementById('mineVodCount');
        if (mv) mv.textContent = currentVodCount + ' 条';
      }
      if (cfg.couponsEnabled !== undefined) {
        couponsEnabled = Boolean(cfg.couponsEnabled);
        document.getElementById('couponSectionWrap')?.classList.toggle('hidden', !couponsEnabled);
      }
      if (Array.isArray(cfg.plans)) {
        dynamicPlans = cfg.plans.map(p => ({
          ...p,
          desc: (p.desc || '').replace(/\b\d+\s*站/g, `${currentVodCount}站`)
        }));
      }
      if (cfg.earlyBird) earlyBirdState = cfg.earlyBird;
      renderEarlyBirdBanner();
      renderDynamicPlans();

      const tvBtn = document.getElementById('tvApkDownloadBtn');
      if (tvBtn) {
        if (cfg.tvApkUrl) { tvBtn.href = cfg.tvApkUrl; tvBtn.textContent = '⬇️ 下载电视版'; }
        else { tvBtn.removeAttribute('target'); tvBtn.href = '#'; tvBtn.onclick = (e) => { e.preventDefault(); switchView('mine'); showToast('请登录后在工单获取最新电视版安装包'); }; }
      }
      const mobBtn = document.getElementById('mobileApkDownloadBtn');
      if (mobBtn) {
        if (cfg.mobileApkUrl) { mobBtn.href = cfg.mobileApkUrl; mobBtn.textContent = '⬇️ 下载手机版'; }
        else { mobBtn.removeAttribute('target'); mobBtn.href = '#'; mobBtn.onclick = (e) => { e.preventDefault(); switchView('mine'); showToast('请登录后在工单获取最新手机版安装包'); }; }
      }
      if (cfg.downloadNote) {
        const noteEl = document.getElementById('downloadNoteText');
        if (noteEl) noteEl.textContent = '💡 ' + cfg.downloadNote;
      }
    }
  } catch (e) {}

  try {
    const r2 = await fetch(API_BASE + '/api/vod-sites');
    if (r2.ok) {
      const d = await r2.json();
      if (Array.isArray(d.sites) && d.sites.length > 0) {
        currentSites = d.sites.map(s => ({ ...s, status: 'idle', speedMBs: 0, latency: undefined }));
        const btn = document.getElementById('startSpeedTest');
        if (btn) btn.textContent = `⚡ 开始拉流测速 (${currentSites.length}条专线)`;
        currentVodCount = currentSites.length;
        document.querySelectorAll('.js-vod-count').forEach(el => { el.textContent = String(currentVodCount); });
        const mv = document.getElementById('mineVodCount'); if (mv) mv.textContent = currentVodCount + ' 条';
        renderSiteList();
      }
    }
  } catch (e) {}
}

function renderEarlyBirdBanner() {
  const wrap = document.getElementById('earlyBirdBanner');
  if (!wrap) return;
  const eb = earlyBirdState;
  if (!eb || !eb.active || !eb.tier) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  const zhe = (eb.discountPercent / 10).toFixed(1).replace(/\.0$/, '');
  document.getElementById('ebTitle').textContent = eb.title || '创始会员限时阶梯特惠';
  document.getElementById('ebDiscountBadge').textContent = `当前 ${zhe} 折`;
  document.getElementById('ebSub').innerHTML =
    `${escapeHtml(eb.tier.label || `第 ${eb.tier.min_rank}~${eb.tier.max_rank} 名享 ${zhe} 折`)} · <b>仅剩 ${eb.remainingInTier} 席</b>（当前第 ${eb.nextRank} 位）`;

  const tierSpan = Math.max(1, Number(eb.tier.max_rank) - Number(eb.tier.min_rank) + 1);
  const usedInTier = Math.max(0, eb.currentCount - Number(eb.tier.min_rank) + 1);
  const pct = Math.min(100, Math.max(8, Math.round((usedInTier / tierSpan) * 100)));
  document.getElementById('ebProgressFill').style.width = pct + '%';

  const row = document.getElementById('ebTiersRow');
  row.innerHTML = (eb.tiers || []).map(t => {
    const isNow = eb.tier && t.min_rank === eb.tier.min_rank && t.max_rank === eb.tier.max_rank;
    const z = (Number(t.discount_percent) / 10).toFixed(1).replace(/\.0$/, '');
    return `<span class="eb-tier-chip ${isNow ? 'now' : ''}">${isNow ? '▶ ' : ''}${t.min_rank}~${t.max_rank}名 ${z}折</span>`;
  }).join('');
}

function renderDynamicPlans() {
  const grid = document.getElementById('dynamicPlansGrid');
  if (!grid) return;
  const list = dynamicPlans.filter(p => currentPlanCategory === 'all' || p.category === currentPlanCategory);
  if (list.length === 0) {
    grid.innerHTML = '<div class="card muted-sm" style="text-align:center;">该分类暂无上架套餐</div>';
    return;
  }

  grid.innerHTML = list.map(p => {
    const hasDisc = p.earlyBirdSaved > 0 && p.effectivePrice < p.originalPrice;
    const chips = [];
    if (p.vodDays > 0) chips.push(`📺 点播 ${p.vodDays} 天`);
    if (p.liveDays > 0) chips.push(`📡 直播 ${p.liveDays} 天`);
    return `
      <article class="plan-card ${p.featured ? 'featured' : ''}">
        <div>
          <div class="plan-top">
            <div class="plan-name">${escapeHtml(p.name)}</div>
            ${p.tag ? `<span class="plan-tag">${escapeHtml(p.tag)}</span>` : ''}
          </div>
          <p class="muted-sm" style="margin:6px 0 10px;">${escapeHtml(p.desc || '')}</p>
          <div class="plan-meta-chips">${chips.map(c => `<span>${c}</span>`).join('')}</div>
        </div>
        <div>
          <div class="plan-price-row" style="margin-bottom:10px;">
            <span class="plan-price-now">¥${p.effectivePrice}</span>
            ${hasDisc ? `<span class="plan-price-orig">¥${p.originalPrice}</span><span class="plan-save-pill">早鸟立省 ¥${p.earlyBirdSaved}</span>` : ''}
          </div>
          <button type="button" class="${p.featured ? 'btn-primary' : 'btn-secondary'} block" style="margin-top:0;" onclick="openBuyPlan('${escapeHtml(p.code)}')">立即开通</button>
        </div>
      </article>
    `;
  }).join('');
}

function openBuyPlan(planCode) {
  if (!localStorage.getItem('tvbox_token')) {
    showToast(`请先注册或登录（注册即送 ${currentTrialDays} 天免费试用）`);
    openAuthModal(true);
    return;
  }
  const p = dynamicPlans.find(x => x.code === planCode);
  if (!p) return;
  selectedPlan = p;
  appliedCoupon = null;
  document.getElementById('couponInput').value = '';
  document.getElementById('couponMsg').textContent = '';
  document.getElementById('payLast6').value = '';
  document.getElementById('payStatusMsg').textContent = '';
  renderPaymentSummary();
  document.getElementById('paymentModal').classList.remove('hidden');
}

// ================= 实时频道汇总（同时更新首页 2x2 与频道页） =================
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

  if (!data || !Array.isArray(data.channels)) {
    document.getElementById('summaryUpdatedAt').textContent = '等待首次工作流同步汇总数据';
    return;
  }

  const chText = `${data.total_channels || 0}/${data.total_targets || 49}`;
  const spdText = data.avg_speed_kbs ? `${(data.avg_speed_kbs / 1024).toFixed(1)} MB/s` : '-';

  document.getElementById('summaryUpdatedAt').textContent = `最近同步：${data.updated_at || data.date || '-'}`;
  ['kpiChannels', 'homeKpiCh'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = chText; });
  ['kpiStreams', 'homeKpiStreams'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = data.total_streams ?? '-'; });
  ['kpiHd', 'homeKpiHd'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = data.hd_streams ?? '-'; });
  ['kpiSpeed', 'homeKpiSpeed'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = spdText; });

  summaryChannels = data.channels;
  renderChannelSummaryList();
}

function renderChannelSummaryList() {
  const box = document.getElementById('channelListContainer');
  if (!box) return;
  const q = (document.getElementById('channelSearch')?.value || '').trim().toLowerCase();
  const filtered = summaryChannels.filter(item => {
    if (currentSummaryGroup !== 'all' && item.group !== currentSummaryGroup) return false;
    if (q && !item.channel.toLowerCase().includes(q)) return false;
    return true;
  });

  if (filtered.length === 0) {
    box.innerHTML = '<div class="muted-sm" style="text-align:center;padding:24px 0;">没有匹配的频道</div>';
    return;
  }

  box.innerHTML = filtered.map(r => {
    const cls = r.count >= 8 ? 'cnt-ok' : (r.count > 0 ? 'cnt-warn' : 'cnt-zero');
    return `
      <div class="ch-row-card">
        <div class="ch-row-main">
          <div class="ch-row-title">
            <span>${escapeHtml(r.channel)}</span>
            <span class="cnt-badge ${cls}">${r.count} 源</span>
          </div>
          <div class="ch-row-spec">${escapeHtml(r.spec || '--')}</div>
        </div>
        <div class="ch-row-right">
          <div class="ch-spd">${r.speed_kbs ? r.speed_kbs + ' KB/s' : '--'}</div>
          <div class="ch-ttfb">${r.ttfb_ms ? r.ttfb_ms + ' ms' : '--'}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ================= 头像选择与云端保存 =================
function renderAvatarPicker() {
  const grid = document.getElementById('avatarGrid');
  if (!grid) return;
  const cur = currentUser?.avatar || localStorage.getItem('tvbox_avatar') || '🎬';
  grid.innerHTML = AVATAR_OPTIONS.map(a => `
    <button type="button" class="avatar-opt ${a.icon === cur ? 'selected' : ''}" onclick="selectAvatar('${a.icon}')">
      <span class="av-emo">${a.icon}</span>
      <span class="av-lbl">${a.label}</span>
    </button>
  `).join('');
}

function applyAvatarToUI(icon) {
  const safe = icon || '🎬';
  localStorage.setItem('tvbox_avatar', safe);
  const h = document.getElementById('headerAvatarIcon');
  const p = document.getElementById('profileAvatarIcon');
  const b = document.getElementById('bottomMineIcon');
  if (h) h.textContent = safe;
  if (p) p.textContent = safe;
  if (b && currentUser) b.textContent = safe;
}

async function selectAvatar(icon) {
  applyAvatarToUI(icon);
  if (currentUser) currentUser.avatar = icon;
  document.getElementById('avatarModal').classList.add('hidden');
  const token = localStorage.getItem('tvbox_token');
  if (!token) return;
  try {
    await fetch(API_BASE + '/api/profile/avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ avatar: icon })
    });
    showToast('头像已更新 ' + icon);
  } catch (e) {}
}

// ================= 认证与个人中心 =================
function openAuthModal(registerMode) {
  isRegisterMode = registerMode;
  document.getElementById('authError').textContent = '';
  document.getElementById('emailCode').value = '';

  if (isRegisterMode) {
    document.getElementById('authTitle').textContent = `注册并领取 ${currentTrialDays} 天全功能免费试用`;
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
    document.getElementById('switchAuth').textContent = `免费注册领${currentTrialDays}天试用`;
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
    btn.textContent = `${codeCooldown}s`;
    codeTimer = setInterval(() => {
      codeCooldown--;
      if (codeCooldown <= 0) { clearInterval(codeTimer); btn.disabled = false; btn.textContent = '获取验证码'; }
      else btn.textContent = `${codeCooldown}s`;
    }, 1000);
    showToast('验证码已发送！未看到请查收垃圾邮件箱', 4000);
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
  const fd = new FormData(e.target);
  const email = fd.get('email');
  const password = fd.get('password');
  const code = fd.get('code') || '';

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
    showToast(data.message || '登录成功！', 3500);
    await checkLoginState();
    switchView('mine');
  } catch (err) {
    errEl.textContent = '网络请求失败，请稍后再试';
  }
}

async function checkLoginState() {
  const token = localStorage.getItem('tvbox_token');
  if (!token) return;
  try {
    const res = await fetch(API_BASE + '/api/me', { headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok) { localStorage.removeItem('tvbox_token'); return; }
    const data = await res.json();
    currentUser = data.user;
    renderAccountDashboard(data.user, data.orders, data.tickets);
  } catch (e) {}
}

function renderAccountDashboard(user, orders, tickets) {
  // 顶部栏隐藏长邮箱，改为紧凑头像图标
  document.getElementById('loginOpen').classList.add('hidden');
  document.getElementById('userAvatarBtn').classList.remove('hidden');
  document.getElementById('mineGuestCard').classList.add('hidden');
  document.getElementById('mineAuthedWrap').classList.remove('hidden');

  const avatar = user.avatar || localStorage.getItem('tvbox_avatar') || '🎬';
  applyAvatarToUI(avatar);
  document.getElementById('profileEmailText').textContent = user.email;

  const now = Date.now();
  const vodActive = user.vod_expire_at > now;
  const liveActive = user.live_expire_at > now;

  document.getElementById('profileBadges').innerHTML = `
    <span class="badge ${vodActive ? 'active' : 'expired'}">点播: ${vodActive ? '剩' + daysLeft(user.vod_expire_at) + '天' : '未开通'}</span>
    <span class="badge ${liveActive ? 'active' : 'expired'}">直播: ${liveActive ? '剩' + daysLeft(user.live_expire_at) + '天' : '免费版'}</span>
  `;

  const allUrl = user.allSubUrl || `${API_BASE}/sub/all?token=${user.token}`;
  const vodUrl = user.vodSubUrl || `${API_BASE}/sub/vod?token=${user.token}`;
  const liveUrl = user.liveSubUrl || `${API_BASE}/sub/live?token=${user.token}`;

  document.getElementById('accountInfo').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
      <b>🚀 一键全能聚合地址（直接填进 TVBox）</b>
      <button type="button" class="btn-primary btn-sm-pad" onclick="copyText('${allUrl}', this)">一键复制</button>
    </div>
    <code class="inline-code" style="width:100%;">${allUrl}</code>
    <p class="muted-sm" style="margin-top:8px;">到期时间：点播 ${formatDate(user.vod_expire_at)} · 直播 ${formatDate(user.live_expire_at)}（仅限 TVBox 加载防泄露）</p>
    <details style="margin-top:12px;border-top:1px dashed var(--border);padding-top:10px;">
      <summary style="cursor:pointer;color:var(--muted);font-size:0.84rem;">展开独立点播 / 独立直播分离地址</summary>
      <div style="margin-top:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span class="muted-sm">📺 独立点播</span>
          <button type="button" class="btn-outline btn-xs" onclick="copyText('${vodUrl}', this)">复制</button>
        </div>
        <code class="inline-code" style="width:100%;">${vodUrl}</code>
      </div>
      <div style="margin-top:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span class="muted-sm">📡 独立直播</span>
          <button type="button" class="btn-outline btn-xs" onclick="copyText('${liveUrl}', this)">复制</button>
        </div>
        <code class="inline-code" style="width:100%;">${liveUrl}</code>
      </div>
    </details>
  `;

  if (user.site_order && user.site_order.length > 0) {
    const orderMap = new Map(user.site_order.map((k, i) => [k, i]));
    currentSites.sort((a, b) => (orderMap.has(a.key) ? orderMap.get(a.key) : 999) - (orderMap.has(b.key) ? orderMap.get(b.key) : 999));
    renderSiteList();
  }

  // 同步把专属订阅地址置顶渲染到「首页」最显目卡片
  const homeSubBadges = document.getElementById('homeSubBadges');
  const homeSubBody = document.getElementById('homeSubBody');
  if (homeSubBadges) {
    homeSubBadges.innerHTML = `<span class="badge ${vodActive ? 'active' : 'expired'}">点播:${vodActive ? '剩' + daysLeft(user.vod_expire_at) + '天' : '未开'}</span> <span class="badge ${liveActive ? 'active' : 'expired'}">直播:${liveActive ? '剩' + daysLeft(user.live_expire_at) + '天' : '免费'}</span>`;
  }
  if (homeSubBody) {
    homeSubBody.innerHTML = `
      <p class="muted-sm" style="margin:6px 0 6px;">一键全能聚合地址（复制到 TVBox「配置地址」栏，点播+直播自动同步）：</p>
      <div class="copy-code-row">
        <code class="inline-code" style="flex:1;">${allUrl}</code>
        <button type="button" class="btn-primary btn-sm-pad" onclick="copyText('${allUrl}', this)">一键复制</button>
      </div>
    `;
  }

  document.getElementById('mineOrderCount').textContent = String((orders || []).length);
  document.getElementById('mineTicketCount').textContent = String((tickets || []).length);

  const ordersEl = document.getElementById('orders');
  if (orders && orders.length > 0) {
    const sm = { pending: '<span style="color:#f59e0b;">⏳ 审核中</span>', approved: '<span style="color:#10b981;">✅ 已开通(已叠加)</span>', rejected: '<span style="color:#ef4444;">❌ 已驳回</span>' };
    ordersEl.innerHTML = orders.map(o => `
      <div class="order-rich-card ${o.status}">
        <div class="order-rich-top">
          <span>${escapeHtml(o.plan_name)}</span>
          <span>${sm[o.status] || o.status}</span>
        </div>
        <div class="order-rich-meta">
          <span>实付 <b style="color:var(--accent);">¥${o.amount}</b>${o.coupon_code ? ' · 优惠: ' + escapeHtml(o.coupon_code) : ''}</span>
          <span>${escapeHtml(o.pay_method || '')} · 尾号 ${escapeHtml(o.pay_last6)}</span>
        </div>
        <div class="order-rich-meta">
          <span>单号：${escapeHtml(o.order_no)}</span>
          <span>${formatDateTime(o.created_at)}</span>
        </div>
      </div>
    `).join('');
  } else {
    ordersEl.innerHTML = '<div style="text-align:center;padding:18px 0;">暂无订单记录，去首页选择适合您的套餐吧</div>';
  }

  const tEl = document.getElementById('userTickets');
  if (tickets && tickets.length > 0) {
    const st = { open: '<span class="badge expired" style="background:rgba(245,158,11,0.18);color:#fbbf24;">待回复</span>', replied: '<span class="badge active">已回复</span>', closed: '<span class="badge" style="background:rgba(148,163,184,0.18);color:#94a3b8;">已关闭</span>' };
    tEl.innerHTML = tickets.map(t => `
      <div class="ticket-rich-card">
        <div class="ticket-head">
          <span><span class="core-pill vip" style="font-size:0.7rem;padding:2px 7px;">${escapeHtml(t.category)}</span> <b>${escapeHtml(t.subject)}</b></span>
          ${st[t.status] || t.status}
        </div>
        <div class="muted-sm" style="font-size:0.74rem;margin-top:4px;">工单号：${escapeHtml(t.ticket_no)} · ${formatDateTime(t.created_at)}</div>
        <div class="ticket-user-bubble">${escapeHtml(t.content)}</div>
        ${t.admin_reply ? `<div class="ticket-admin-bubble"><b>🎧 客服回复</b>${t.replied_at ? ' (' + formatDateTime(t.replied_at) + ')' : ''}：<br>${escapeHtml(t.admin_reply)}</div>` : ''}
      </div>
    `).join('');
  } else {
    tEl.innerHTML = '<div style="text-align:center;padding:18px 0;">暂无工单记录，有问题随时点击右上角提交</div>';
  }
}

// ================= 支付、早鸟价与优惠码 =================
function renderPaymentSummary() {
  if (!selectedPlan) return;
  const el = document.getElementById('paymentDetails');
  if (appliedCoupon) {
    el.innerHTML =
      `购买套餐：<b>${escapeHtml(selectedPlan.name)}</b><br>` +
      `原价：<s>¥${appliedCoupon.originalAmount}</s> &nbsp; 优惠码立减：<b style="color:#f59e0b;">-¥${appliedCoupon.discountAmount}</b> (不叠加早鸟)<br>` +
      `折后实付：<b style="color:#10b981;font-size:1.25rem;">¥${appliedCoupon.finalAmount}</b>`;
  } else if (selectedPlan.earlyBirdSaved > 0) {
    el.innerHTML =
      `购买套餐：<b>${escapeHtml(selectedPlan.name)}</b><br>` +
      `原价：<s>¥${selectedPlan.originalPrice}</s> &nbsp; 早鸟立省：<b style="color:#f59e0b;">-¥${selectedPlan.earlyBirdSaved}</b><br>` +
      `实付金额：<b style="color:#10b981;font-size:1.25rem;">¥${selectedPlan.effectivePrice}</b>`;
  } else {
    el.innerHTML =
      `购买套餐：<b>${escapeHtml(selectedPlan.name)}</b><br>` +
      `应付金额：<b style="color:#10b981;font-size:1.2rem;">¥${selectedPlan.effectivePrice}</b>`;
  }
}

async function verifyCoupon() {
  const code = document.getElementById('couponInput').value.trim().toUpperCase();
  const msg = document.getElementById('couponMsg');
  if (!code) { appliedCoupon = null; msg.textContent = ''; renderPaymentSummary(); return; }
  msg.textContent = '核验中...';
  try {
    const res = await fetch(API_BASE + '/api/coupon/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, planCode: selectedPlan.code })
    });
    const data = await res.json();
    if (!res.ok) { appliedCoupon = null; msg.textContent = '❌ ' + (data.error || '无效优惠码'); msg.style.color = '#ef4444'; renderPaymentSummary(); return; }
    appliedCoupon = data;
    msg.textContent = `✅ 已应用优惠码 ${data.code}（${data.desc}，与早鸟不叠加，按原价计算），请按折后金额扫码！`;
    msg.style.color = '#10b981';
    renderPaymentSummary();
  } catch (e) { msg.textContent = '核验失败'; }
}

async function submitOrder() {
  const token = localStorage.getItem('tvbox_token');
  const payLast6 = document.getElementById('payLast6').value.trim();
  const msgEl = document.getElementById('payStatusMsg');
  if (!/^\d{6}$/.test(payLast6)) { showToast('请输入支付账单订单号的后 6 位数字'); return; }

  const btn = document.getElementById('submitOrderBtn');
  btn.disabled = true;
  btn.textContent = '正在提交...';
  try {
    const res = await fetch(API_BASE + '/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ planCode: selectedPlan.code, payMethod: selectedPayMethod, payLast6, couponCode: appliedCoupon ? appliedCoupon.code : '' })
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || '提交失败'); btn.disabled = false; btn.textContent = '我已完成支付，提交审核'; return; }

    msgEl.innerHTML = '<b style="color:#10b981;">✅ 已提交！等待管理员核账（页面自动刷新）...</b>';
    checkLoginState();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      const meRes = await fetch(API_BASE + '/api/me', { headers: { 'Authorization': 'Bearer ' + token } });
      const meData = await meRes.json();
      const target = (meData.orders || []).find(o => o.order_no === data.orderNo);
      if (target && target.status === 'approved') {
        clearInterval(pollTimer);
        document.getElementById('paymentModal').classList.add('hidden');
        showToast('🎉 审核通过！会员权益已实时生效', 4000);
        renderAccountDashboard(meData.user, meData.orders, meData.tickets);
        switchView('mine');
      } else if (target && target.status === 'rejected') {
        clearInterval(pollTimer);
        msgEl.innerHTML = '<b style="color:#ef4444;">❌ 尾号核实未通过，请检查后重新提交。</b>';
        btn.disabled = false;
        btn.textContent = '重新提交审核';
      }
    }, 5000);
  } catch (err) {
    showToast('网络异常，请重试');
    btn.disabled = false;
    btn.textContent = '我已完成支付，提交审核';
  }
}

// ================= 工单与密码重置 =================
async function submitTicket() {
  const token = localStorage.getItem('tvbox_token');
  const category = document.getElementById('ticketCategory').value;
  const subject = document.getElementById('ticketSubject').value.trim();
  const content = document.getElementById('ticketContent').value.trim();
  const msg = document.getElementById('ticketMsg');
  if (!subject || !content) { msg.textContent = '请填写标题与问题描述'; msg.style.color = '#ef4444'; return; }
  const res = await fetch(API_BASE + '/api/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ category, subject, content })
  });
  const data = await res.json();
  if (!res.ok) { msg.textContent = data.error || '提交失败'; msg.style.color = '#ef4444'; return; }
  document.getElementById('ticketModal').classList.add('hidden');
  showToast('工单已提交，客服将尽快回复！');
  checkLoginState();
}

async function sendResetCode() {
  const email = document.getElementById('resetEmail').value.trim();
  const msg = document.getElementById('resetMsg');
  if (!email) { msg.textContent = '请先输入注册邮箱'; msg.style.color = '#ef4444'; return; }
  const res = await fetch(API_BASE + '/api/send-reset-code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
  });
  const data = await res.json();
  msg.textContent = data.message || data.error;
  msg.style.color = res.ok ? '#10b981' : '#ef4444';
}

async function confirmResetPassword() {
  const email = document.getElementById('resetEmail').value.trim();
  const code = document.getElementById('resetCode').value.trim();
  const newPassword = document.getElementById('resetNewPwd').value;
  const msg = document.getElementById('resetMsg');
  const res = await fetch(API_BASE + '/api/reset-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code, newPassword })
  });
  const data = await res.json();
  msg.textContent = data.message || data.error;
  msg.style.color = res.ok ? '#10b981' : '#ef4444';
  if (res.ok) {
    setTimeout(() => { document.getElementById('resetModal').classList.add('hidden'); openAuthModal(false); }, 900);
  }
}

// ================= 本地家庭宽带真实拉流测速 =================
function formatSiteTitle(site, rankIndex) {
  const tagRank = document.getElementById('optTagRank')?.checked ?? true;
  const showSpeed = document.getElementById('optShowSpeed')?.checked ?? false;
  if (site.status === 'failed') return `❌ ${site.name}`;
  let t = site.name;
  if (tagRank && site.status === 'ok') t = `${String(rankIndex).padStart(2, '0')}丨${t}`;
  if (showSpeed && site.speedMBs > 0) t += ` [${site.speedMBs.toFixed(1)}M]`;
  return t;
}

function renderSiteList() {
  const box = document.getElementById('siteList');
  if (!box) return;
  let validRank = 0;
  box.innerHTML = currentSites.map((site, idx) => {
    if (site.status === 'ok') validRank++;
    const title = formatSiteTitle(site, site.status === 'ok' ? validRank : idx + 1);
    let metricHtml = '<span class="muted-sm">待测</span>';
    if (site.status === 'testing') metricHtml = '<span style="color:#3b82f6;">测速中</span>';
    else if (site.status === 'ok') {
      const cls = site.speedMBs >= 3 ? 'speed-fast' : (site.speedMBs >= 1 ? 'speed-mid' : 'speed-slow');
      metricHtml = `<div class="speed-val ${cls}">${site.speedMBs > 0 ? site.speedMBs.toFixed(1) + 'M/s' : '可用'}</div><div class="muted-sm">${site.latency}ms</div>`;
    } else if (site.status === 'failed') metricHtml = '<span class="speed-slow">超时</span>';

    const badgeClass = (site.status === 'ok' && validRank <= 3) ? 'rank-badge top3' : 'rank-badge';
    const badgeText = site.status === 'ok' ? String(validRank).padStart(2, '0') : String(idx + 1).padStart(2, '0');
    return `<div class="site-card ${site.status || ''}"><div class="site-title"><span class="${badgeClass}">${badgeText}</span><span>${title}</span></div><div class="site-metrics">${metricHtml}</div></div>`;
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
    } else downloaded = (await resp.arrayBuffer()).byteLength;
    const sec = Math.max((performance.now() - dlStart) / 1000, 0.05);
    return { speedMBs: (downloaded / (1024 * 1024)) / sec, latency };
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    const s2 = performance.now();
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    const ms = Math.max(performance.now() - s2, 50);
    return { speedMBs: 1.0 / (ms / 1000), latency: Math.round(ms) };
  } finally { clearTimeout(timer); }
}

async function runSpeedTest() {
  const btn = document.getElementById('startSpeedTest');
  const progressWrap = document.getElementById('speedProgressWrap');
  const progressFill = document.getElementById('speedProgressFill');
  const statusText = document.getElementById('speedStatusText');
  const countText = document.getElementById('speedCountText');
  const modeBadge = document.getElementById('speedModeBadge');

  btn.disabled = true;
  btn.textContent = '⏳ 测速中...';
  progressWrap.classList.remove('hidden');
  progressFill.style.width = '0%';
  currentSites.forEach(s => { s.status = 'idle'; s.speedMBs = 0; s.latency = 9999; });
  renderSiteList();

  let samples = {};
  try {
    statusText.textContent = '正在获取视频切片样本...';
    const [r1, r2] = await Promise.all([
      fetch(API_BASE + '/api/vod-samples?batch=1').then(r => r.ok ? r.json() : {}),
      fetch(API_BASE + '/api/vod-samples?batch=2').then(r => r.ok ? r.json() : {})
    ]);
    samples = { ...r1, ...r2 };
    modeBadge.textContent = '切片实测';
  } catch { modeBadge.textContent = '延迟模式'; }

  let finished = 0;
  const total = currentSites.length;
  const queue = [...currentSites];
  async function worker() {
    while (queue.length > 0) {
      const site = queue.shift();
      site.status = 'testing';
      statusText.textContent = `实测：${site.name}...`;
      renderSiteList();
      try {
        const sample = samples[site.key];
        if (sample?.tsUrl) {
          const res = await measureRealSlice(sample.tsUrl);
          site.status = 'ok'; site.speedMBs = res.speedMBs; site.latency = res.latency;
        } else {
          const s0 = performance.now();
          await fetch(site.pingUrl, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(4000) });
          site.status = 'ok'; site.speedMBs = 0; site.latency = Math.round(performance.now() - s0);
        }
      } catch { site.status = 'failed'; site.speedMBs = 0; site.latency = 9999; }

      finished++;
      countText.textContent = `${finished} / ${total}`;
      progressFill.style.width = `${Math.round((finished / total) * 100)}%`;
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
  statusText.textContent = '✅ 测速完成！点击「保存我的排序」即可同步到电视端';
  btn.disabled = false;
  btn.textContent = '⚡ 重新测速';
}

async function saveCustomOrder() {
  const token = localStorage.getItem('tvbox_token');
  if (!token) { showToast('请先登录后再保存排序'); openAuthModal(true); return; }
  const hideFailed = document.getElementById('optHideFailed')?.checked ?? true;
  const tagRank = document.getElementById('optTagRank')?.checked ?? true;
  const siteOrder = currentSites.filter(s => !(hideFailed && s.status === 'failed')).map(s => s.key);
  const res = await fetch(API_BASE + '/api/save-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ siteOrder, tagRank, hideFailed })
  });
  const data = await res.json();
  showToast(data.message || data.error, 3200);
}

// ================= 工具函数 =================
function copyText(text, btn) {
  const done = () => {
    showToast('✅ 已复制到剪贴板');
    if (btn) { const old = btn.textContent; btn.textContent = '✅ 已复制'; setTimeout(() => btn.textContent = old, 1800); }
  };
  navigator.clipboard.writeText(text).then(done).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    done();
  });
}
function daysLeft(ts) { return Math.max(1, Math.ceil((ts - Date.now()) / (24 * 3600 * 1000))); }
function formatDate(ts) {
  if (!ts || ts <= 0) return '未开通';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}

function formatDateTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
