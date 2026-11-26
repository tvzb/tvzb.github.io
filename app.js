// ⚠️ Cloudflare Worker 后端域名（末尾不要加斜杠）
const API_BASE = 'https://tv.171234.xyz';

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
let currentPlanCategory = 'all';
let summaryChannels = [];
let currentSummaryGroup = 'all';
let currentTrialDays = 7;
let currentVodCount = 21;
let currentLiveCount = 49;
let currentOnsitePrice = 99;
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
  captureInviteRef();
  loadPublicConfigAndSites();
  loadChannelSummary();
  loadFreeLivePlayer();
  loadVodHotMovies();
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
  // 离开对应页面时自动停止并销毁播放器，防止后台串音和偷跑流量
  if (tabName !== 'channels' && typeof stopFreeLivePlayer === 'function') stopFreeLivePlayer();
  if (tabName !== 'speed' && typeof closeVodModal === 'function') closeVodModal();
  if (tabName !== 'install' && typeof stopTutorialVideo === 'function') stopTutorialVideo();

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

  // 安装中心子标签切换（下载 / 视频教程 / 图文步骤）
  document.querySelectorAll('#installSubTabs .seg-btn').forEach(btn => {
    btn.onclick = () => switchInstallSubTab(btn.dataset.subtab);
  });

  document.getElementById('closeAnnouncementBtn')?.addEventListener('click', () => {
    document.getElementById('globalAnnouncementBar')?.classList.add('hidden');
  });
  document.getElementById('liveNextSourceBtn')?.addEventListener('click', switchNextLiveSource);
  document.getElementById('closeVodModalBtn')?.addEventListener('click', closeVodModal);
  document.getElementById('vodLimitActionBtn')?.addEventListener('click', () => {
    closeVodModal();
    if (currentUser) switchView('home');
    else openAuthModal(true);
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
  document.getElementById('submitOnsiteBtn')?.addEventListener('click', submitOnsiteBooking);
  document.getElementById('userTicketSelectAll')?.addEventListener('change', (e) => {
    document.querySelectorAll('.user-tk-cb').forEach(cb => { cb.checked = e.target.checked; });
  });
  document.getElementById('batchDeleteUserTicketsBtn')?.addEventListener('click', batchDeleteUserTickets);
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
      if (cfg.liveChannelCount !== undefined) {
        currentLiveCount = Number(cfg.liveChannelCount);
        document.querySelectorAll('.js-live-count').forEach(el => { el.textContent = String(currentLiveCount); });
      }
      if (cfg.onsitePrice !== undefined) {
        currentOnsitePrice = Number(cfg.onsitePrice);
        document.querySelectorAll('.onsite-price-txt').forEach(el => { el.textContent = '¥' + currentOnsitePrice; });
      }
      if (cfg.couponsEnabled !== undefined) {
        couponsEnabled = Boolean(cfg.couponsEnabled);
        document.getElementById('couponSectionWrap')?.classList.toggle('hidden', !couponsEnabled);
      }
      if (Array.isArray(cfg.plans)) {
        dynamicPlans = cfg.plans.map(p => ({
          ...p,
          desc: (p.desc || '').replace(/\b\d+\s*站/g, `${currentVodCount}站`).replace(/\b\d+\s*台/g, `${currentLiveCount}台`)
        }));
      }
      if (cfg.earlyBird) earlyBirdState = cfg.earlyBird;
      renderEarlyBirdBanner();
      renderDynamicPlans();

      renderApkDownloads(cfg.apkDownloads || []);
      if (cfg.downloadNote) {
        const noteEl = document.getElementById('downloadNoteText');
        if (noteEl) noteEl.textContent = '💡 ' + cfg.downloadNote;
      }
      renderTutorialVideo(cfg.tutorialVideoUrl || '', cfg.tutorialVideoDesc || '');
      if (cfg.announcementEnabled && cfg.announcementText) {
        const bar = document.getElementById('globalAnnouncementBar');
        const txt = document.getElementById('globalAnnouncementText');
        if (bar && txt) { txt.textContent = cfg.announcementText; bar.classList.remove('hidden'); }
      }
      if (cfg.inviteRewardDays !== undefined) {
        const rEl = document.getElementById('inviteRewardDaysTxt');
        if (rEl) rEl.textContent = String(cfg.inviteRewardDays);
      }
      if (cfg.vodPreviewMinutes !== undefined) {
        vodPreviewMinutes = Number(cfg.vodPreviewMinutes);
        updateVodPreviewRuleText();
      }
      const showOnsite = cfg.onsiteEnabled !== false;
      ['homeOnsiteBanner', 'guideOnsiteCard'].forEach(id => {
        document.getElementById(id)?.classList.toggle('hidden', !showOnsite);
      });
      if (cfg.onsiteTitle) {
        ['homeOnsiteTitle', 'guideOnsiteTitle'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = cfg.onsiteTitle; });
      }
      if (cfg.onsiteDesc) {
        ['homeOnsiteDesc', 'guideOnsiteDesc'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = cfg.onsiteDesc; });
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
  const catRank = { combo: 1, live: 2, vod: 3 };
  const list = dynamicPlans
    .filter(p => currentPlanCategory === 'all' || p.category === currentPlanCategory)
    .sort((a, b) => (catRank[a.category] || 9) - (catRank[b.category] || 9) || Number(a.sort || 99) - Number(b.sort || 99));
  if (list.length === 0) {
    grid.innerHTML = '<div class="card muted-sm" style="text-align:center;">该分类暂无上架套餐</div>';
    return;
  }

  grid.innerHTML = list.map(p => {
    const hasDisc = p.earlyBirdSaved > 0 && p.effectivePrice < p.originalPrice;
    const chips = [];
    if (p.liveDays > 0) chips.push(`📡 直播 ${p.liveDays} 天`);
    if (p.vodDays > 0) chips.push(`📺 点播 ${p.vodDays} 天`);
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
  const inviteCode = (fd.get('inviteCode') || localStorage.getItem('tvbox_ref') || '').trim();

  const endpoint = isRegisterMode ? '/api/register' : '/api/login';
  const body = isRegisterMode ? { email, password, code, inviteCode } : { email, password };

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
    <span class="badge ${liveActive ? 'active' : 'expired'}">直播: ${liveActive ? '剩' + daysLeft(user.live_expire_at) + '天' : '免费版'}</span>
    <span class="badge ${vodActive ? 'active' : 'expired'}">点播: ${vodActive ? '剩' + daysLeft(user.vod_expire_at) + '天' : '未开通'}</span>
  `;

  const allUrl = user.allSubUrl || `${API_BASE}/s/${user.token}`;
  const vodUrl = user.vodSubUrl || `${API_BASE}/v/${user.token}`;
  const liveUrl = user.liveSubUrl || `${API_BASE}/l/${user.token}`;

  document.getElementById('accountInfo').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
      <b>🚀 一键全能聚合地址（直接填进 TVBox）</b>
      <div style="display:flex;gap:6px;">
        <button type="button" class="btn-outline btn-sm-pad" onclick="openSubQrModal('${allUrl}', '一键全能聚合地址')">📱 二维码</button>
        <button type="button" class="btn-primary btn-sm-pad" onclick="copyText('${allUrl}', this)">一键复制</button>
      </div>
    </div>
    <code class="inline-code" style="width:100%;">${allUrl}</code>
    <p class="muted-sm" style="margin-top:8px;">到期时间：直播 ${formatDate(user.live_expire_at)} · 点播 ${formatDate(user.vod_expire_at)}（仅限 TVBox 加载防泄露）</p>
    <details style="margin-top:12px;border-top:1px dashed var(--border);padding-top:10px;">
      <summary style="cursor:pointer;color:var(--muted);font-size:0.84rem;">展开独立直播 / 独立点播分离地址</summary>
      <div style="margin-top:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span class="muted-sm">📡 独立直播</span>
          <button type="button" class="btn-outline btn-xs" onclick="copyText('${liveUrl}', this)">复制</button>
        </div>
        <code class="inline-code" style="width:100%;">${liveUrl}</code>
      </div>
      <div style="margin-top:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span class="muted-sm">📺 独立点播</span>
          <button type="button" class="btn-outline btn-xs" onclick="copyText('${vodUrl}', this)">复制</button>
        </div>
        <code class="inline-code" style="width:100%;">${vodUrl}</code>
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
    homeSubBadges.innerHTML = `<span class="badge ${liveActive ? 'active' : 'expired'}">直播:${liveActive ? '剩' + daysLeft(user.live_expire_at) + '天' : '免费'}</span> <span class="badge ${vodActive ? 'active' : 'expired'}">点播:${vodActive ? '剩' + daysLeft(user.vod_expire_at) + '天' : '未开'}</span>`;
  }
  if (homeSubBody) {
    homeSubBody.innerHTML = `
      <p class="muted-sm" style="margin:6px 0 6px;">一键全能聚合地址（复制到 TVBox「配置地址」栏，直播+点播自动同步）：</p>
      <div class="copy-code-row">
        <code class="inline-code" style="flex:1;">${allUrl}</code>
        <button type="button" class="btn-outline btn-sm-pad" onclick="openSubQrModal('${allUrl}', '我的专属订阅地址')">📱 二维码</button>
        <button type="button" class="btn-primary btn-sm-pad" onclick="copyText('${allUrl}', this)">一键复制</button>
      </div>
    `;
  }

  // 渲染老带新邀请卡片
  const invCode = user.invite_code || user.token;
  const invUrl = `${location.origin}${location.pathname}?ref=${encodeURIComponent(invCode)}`;
  const invCodeEl = document.getElementById('myInviteUrlCode');
  const invStatsEl = document.getElementById('inviteStatsBadge');
  const invDaysEl = document.getElementById('inviteRewardDaysTxt');
  const invCopyBtn = document.getElementById('copyInviteUrlBtn');
  if (invCodeEl) invCodeEl.textContent = invUrl;
  if (invDaysEl && user.invite_reward_days !== undefined) invDaysEl.textContent = String(user.invite_reward_days);
  if (invStatsEl && user.invite_stats) {
    invStatsEl.textContent = `已邀请 ${user.invite_stats.count || 0} 人 · 累计获赠 ${user.invite_stats.totalDays || 0} 天`;
  }
  if (invCopyBtn) invCopyBtn.onclick = () => copyText(invUrl, invCopyBtn);

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
          <span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <input type="checkbox" class="user-tk-cb" value="${escapeHtml(t.ticket_no)}" style="width:auto;margin:0;">
            <span class="core-pill vip" style="font-size:0.7rem;padding:2px 7px;">${escapeHtml(t.category)}</span>
            <b>${escapeHtml(t.subject)}</b>
          </span>
          <span style="display:inline-flex;align-items:center;gap:8px;">
            ${st[t.status] || t.status}
            <button type="button" class="btn-outline btn-xs" style="color:var(--danger);border-color:rgba(239,68,68,0.35);padding:2px 8px;" onclick="deleteUserTicket('${escapeHtml(t.ticket_no)}')">删除</button>
          </span>
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

async function deleteUserTicket(ticketNo) {
  if (!confirm('确认删除这条工单记录？')) return;
  const token = localStorage.getItem('tvbox_token');
  const res = await fetch(API_BASE + '/api/tickets/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ ticketNo })
  });
  const data = await res.json();
  showToast(data.message || data.error);
  checkLoginState();
}

async function batchDeleteUserTickets() {
  const checked = Array.from(document.querySelectorAll('.user-tk-cb:checked')).map(cb => cb.value);
  if (checked.length === 0) { showToast('请先勾选要删除的工单'); return; }
  if (!confirm(`确认批量删除选中的 ${checked.length} 条工单？`)) return;
  const token = localStorage.getItem('tvbox_token');
  const res = await fetch(API_BASE + '/api/tickets/batch-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ ticketNos: checked })
  });
  const data = await res.json();
  const selAll = document.getElementById('userTicketSelectAll');
  if (selAll) selAll.checked = false;
  showToast(data.message || data.error);
  checkLoginState();
}

function renderApkDownloads(list) {
  const box = document.getElementById('apkDownloadsGrid');
  if (!box) return;
  const items = (Array.isArray(list) && list.length > 0) ? list : [
    { name: 'TVBox 通用最新版 (Android 5.0+)', desc: '推荐首选！智能电视、机顶盒、投影仪、安卓手机/平板全通用', tag: '🔥 推荐', url: '' },
    { name: 'TVBox 老旧设备兼容版 (Android 4.x)', desc: '专为安卓 4.1~4.4 老款电视与机顶盒优化，解决解析错误或闪退', tag: '老设备专用', url: '' }
  ];
  box.innerHTML = items.map(a => {
    const hasUrl = a.url && /^https?:\/\//i.test(a.url);
    const btnHtml = hasUrl
      ? `<a class="btn-primary btn-sm-pad" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">⬇️ 下载此版本</a>`
      : `<button type="button" class="btn-secondary btn-sm-pad" onclick="switchView('mine');showToast('请登录后提交工单获取此版本安装包');">联系客服获取</button>`;
    return `
      <div class="dl-card">
        <div class="dl-icon">📦</div>
        <div class="dl-body">
          ${a.tag ? `<span class="apk-tag-pill">${escapeHtml(a.tag)}</span>` : ''}
          <h3>${escapeHtml(a.name)}</h3>
          <p class="muted-sm">${escapeHtml(a.desc || '')}</p>
        </div>
        ${btnHtml}
      </div>
    `;
  }).join('');
}

function openOnsiteBooking() {
  document.getElementById('onsiteMsg').textContent = '';
  document.getElementById('onsiteModal').classList.remove('hidden');
}

async function submitOnsiteBooking() {
  const name = document.getElementById('osName').value.trim();
  const phone = document.getElementById('osPhone').value.trim();
  const address = document.getElementById('osAddress').value.trim();
  const timeSlot = document.getElementById('osTimeSlot').value;
  const device = document.getElementById('osDevice').value.trim();
  const msg = document.getElementById('onsiteMsg');

  if (!phone || !address) {
    msg.textContent = '请填写联系电话/微信与赣州城区小区地址';
    msg.style.color = '#ef4444';
    return;
  }

  const btn = document.getElementById('submitOnsiteBtn');
  btn.disabled = true;
  btn.textContent = '正在提交预约...';
  try {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('tvbox_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(API_BASE + '/api/onsite-booking', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, phone, address, timeSlot, device })
    });
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || '提交失败';
      msg.style.color = '#ef4444';
    } else {
      msg.textContent = '✅ ' + (data.message || '预约成功！');
      msg.style.color = '#10b981';
      showToast('🎉 上门安装预约已提交！', 3500);
      if (token) checkLoginState();
      setTimeout(() => document.getElementById('onsiteModal').classList.add('hidden'), 1200);
    }
  } catch (e) {
    msg.textContent = '网络异常，请重试';
    msg.style.color = '#ef4444';
  } finally {
    btn.disabled = false;
    btn.textContent = '提交上门安装预约（免登录）';
  }
}

function openImgLightbox(src) {
  const lb = document.getElementById('imgLightbox');
  const im = document.getElementById('lightboxImg');
  if (lb && im && src) { im.src = src; lb.classList.remove('hidden'); }
}

function switchInstallSubTab(subId) {
  if (subId !== 'sub-video' && typeof stopTutorialVideo === 'function') stopTutorialVideo();
  document.querySelectorAll('#installSubTabs .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.subtab === subId);
  });
  document.querySelectorAll('.install-subpanel').forEach(p => {
    p.classList.toggle('active', p.id === subId);
  });
}

function stopTutorialVideo() {
  const wrap = document.getElementById('tutorialVideoWrap');
  if (!wrap) return;
  const v = wrap.querySelector('video');
  if (v && !v.paused) v.pause();
  const ifr = wrap.querySelector('iframe');
  if (ifr && ifr.src) {
    const src = ifr.src;
    ifr.src = src;
  }
}

function renderTutorialVideo(videoUrl, videoDesc) {
  const descEl = document.getElementById('tutorialVideoDesc');
  if (descEl && videoDesc) descEl.textContent = videoDesc;
  const wrap = document.getElementById('tutorialVideoWrap');
  if (!wrap) return;
  const url = String(videoUrl || '').trim();
  if (!url) return;

  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(url)) {
    wrap.innerHTML = `<video controls playsinline preload="metadata" src="${escapeHtml(url)}">您的浏览器暂不支持在线播放，请<a href="${escapeHtml(url)}" target="_blank" rel="noopener">点击下载观看</a>。</video>`;
  } else if (/^(https?:)?\/\//i.test(url)) {
    wrap.innerHTML = `<div class="video-iframe-wrap"><iframe src="${escapeHtml(url)}" allowfullscreen="true" scrolling="no" frameborder="0" sandbox="allow-top-navigation allow-same-origin allow-forms allow-scripts"></iframe></div>`;
  }
}

// ================= 老带新邀请码自动捕获 =================
function captureInviteRef() {
  try {
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref && /^[a-zA-Z0-9_-]{4,24}$/.test(ref)) {
      localStorage.setItem('tvbox_ref', ref);
    }
    const saved = localStorage.getItem('tvbox_ref') || '';
    const input = document.getElementById('registerInviteCode');
    if (input && saved) input.value = saved;
  } catch (e) {}
}

// ================= 订阅地址一键二维码弹窗 =================
function openSubQrModal(url, title) {
  const modal = document.getElementById('qrSubModal');
  const box = document.getElementById('qrSubBox');
  const urlEl = document.getElementById('qrSubUrlText');
  const titleEl = document.getElementById('qrSubTitle');
  const copyBtn = document.getElementById('qrSubCopyBtn');
  if (!modal || !box) return;

  if (titleEl) titleEl.textContent = '📱 ' + (title || '扫码获取订阅地址');
  if (urlEl) urlEl.textContent = url;
  if (copyBtn) copyBtn.onclick = () => copyText(url, copyBtn);
  box.innerHTML = '';

  if (typeof QRCode !== 'undefined') {
    try {
      new QRCode(box, { text: url, width: 190, height: 190, colorDark: '#0f172a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    } catch (e) {
      box.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=190x190&data=${encodeURIComponent(url)}" alt="二维码">`;
    }
  } else {
    box.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=190x190&data=${encodeURIComponent(url)}" alt="二维码">`;
  }
  modal.classList.remove('hidden');
}

// ================= 直播页：游客在线试看（仅保留网页可播 HTTPS 源 + 多源直切） =================
let freeLiveGroups = [];
let activeLiveChannel = null;
let activeLiveUrlIdx = 0;
let failedLiveSrcMap = {};
let activeHls = null;

async function loadFreeLivePlayer() {
  const box = document.getElementById('livePlayerGroups');
  if (!box) return;
  try {
    const res = await fetch(API_BASE + '/api/free-live-list');
    const data = await res.json();
    if (!res.ok || !Array.isArray(data.groups) || data.groups.length === 0) {
      box.innerHTML = '<span class="muted-sm">当前暂无支持网页直连播放的 HTTPS 体验源，请复制首页免费地址到 TVBox 观看</span>';
      return;
    }
    freeLiveGroups = data.groups;
    box.innerHTML = freeLiveGroups.map((g, gIdx) => `
      <div class="live-grp-block">
        <div class="live-grp-title">${escapeHtml(g.name)} (${g.channels.length}台)</div>
        <div class="live-ch-pills">
          ${g.channels.map((ch, cIdx) => {
            const cntHtml = ch.urls.length > 1 ? `<span class="live-ch-cnt">${ch.urls.length}源</span>` : '';
            return `<button type="button" class="live-ch-pill" data-g="${gIdx}" data-c="${cIdx}" onclick="playFreeLiveChannel(${gIdx}, ${cIdx}, 0)">${escapeHtml(ch.name)}${cntHtml}</button>`;
          }).join('')}
        </div>
      </div>
    `).join('');
  } catch (e) {
    box.innerHTML = '<span class="muted-sm">体验频道加载失败，请稍后刷新</span>';
  }
}

function renderLiveSourceBar(gIdx, cIdx, ch, currentIdx) {
  const bar = document.getElementById('liveSourceBar');
  if (!bar) return;
  const chKey = `${gIdx}_${cIdx}`;
  const failedSet = failedLiveSrcMap[chKey] || new Set();
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <span class="live-src-label">📡 ${escapeHtml(ch.name)} 线路 (${ch.urls.length}个)：</span>
    ${ch.urls.map((_, idx) => {
      const isCur = idx === currentIdx;
      const isFail = failedSet.has(idx);
      const cls = isCur ? 'active' : (isFail ? 'failed' : '');
      return `<button type="button" class="live-src-btn ${cls}" onclick="playFreeLiveChannel(${gIdx}, ${cIdx}, ${idx}, true)">${isFail ? '✕ ' : ''}线路 ${idx + 1}</button>`;
    }).join('')}
  `;
}

function stopFreeLivePlayer() {
  if (activeHls) {
    activeHls.destroy();
    activeHls = null;
  }
  const video = document.getElementById('liveVideoPlayer');
  if (video) {
    video.pause();
    video.onerror = null;
    video.onloadedmetadata = null;
    video.removeAttribute('src');
    video.load();
  }
  activeLiveChannel = null;
  document.querySelectorAll('.live-ch-pill').forEach(b => b.classList.remove('active'));
  document.getElementById('liveSourceBar')?.classList.add('hidden');
  const statusEl = document.getElementById('livePlayStatus');
  if (statusEl) statusEl.textContent = '选择频道开始试看';
  const overlay = document.getElementById('livePlayerOverlay');
  if (overlay) overlay.classList.remove('hidden');
  const ovTitle = document.getElementById('liveOverlayTitle');
  if (ovTitle) ovTitle.textContent = '点击下方任意体验频道立即播放';
  const ovSub = document.getElementById('liveOverlaySub');
  if (ovSub) ovSub.textContent = '已过滤不兼容源 · 多线路支持自由点击切换';
}

function playFreeLiveChannel(gIdx, cIdx, urlIdx = 0, manual = false) {
  if (typeof closeVodModal === 'function') closeVodModal();
  if (typeof stopTutorialVideo === 'function') stopTutorialVideo();
  const ch = freeLiveGroups?.[gIdx]?.channels?.[cIdx];
  if (!ch || !ch.urls || ch.urls.length === 0) return;
  const chKey = `${gIdx}_${cIdx}`;
  if (!failedLiveSrcMap[chKey]) failedLiveSrcMap[chKey] = new Set();
  if (manual) failedLiveSrcMap[chKey].delete(urlIdx);

  activeLiveChannel = { gIdx, cIdx, ch };
  activeLiveUrlIdx = urlIdx;

  document.querySelectorAll('.live-ch-pill').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.g) === gIdx && Number(b.dataset.c) === cIdx);
  });
  renderLiveSourceBar(gIdx, cIdx, ch, urlIdx);

  const statusEl = document.getElementById('livePlayStatus');
  const overlay = document.getElementById('livePlayerOverlay');
  const ovTitle = document.getElementById('liveOverlayTitle');
  const ovSub = document.getElementById('liveOverlaySub');
  const video = document.getElementById('liveVideoPlayer');
  const streamUrl = ch.urls[urlIdx];

  if (statusEl) statusEl.textContent = `${ch.name} · 线路 ${urlIdx + 1}/${ch.urls.length}`;
  if (overlay) overlay.classList.add('hidden');

  if (activeHls) { activeHls.destroy(); activeHls = null; }
  video.pause();
  video.removeAttribute('src');

  const onPlayFail = () => {
    failedLiveSrcMap[chKey].add(urlIdx);
    renderLiveSourceBar(gIdx, cIdx, ch, urlIdx);
    const nextUntried = ch.urls.findIndex((_, i) => !failedLiveSrcMap[chKey].has(i));
    if (!manual && nextUntried >= 0) {
      playFreeLiveChannel(gIdx, cIdx, nextUntried, false);
    } else {
      if (statusEl) statusEl.textContent = `${ch.name} · 线路 ${urlIdx + 1} 不可用`;
      if (overlay) overlay.classList.remove('hidden');
      if (ovTitle) ovTitle.textContent = `「${ch.name}」线路 ${urlIdx + 1} 暂不可播`;
      if (ovSub) ovSub.textContent = nextUntried >= 0
        ? '请点击下方其他可用线路切换，或导入 TVBox 畅看全部 49 台！'
        : '该频道的网页源受浏览器跨域限制，导入 TVBox 可 100% 流畅观看！';
    }
  };

  const tryPlay = () => {
    const p = video.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // 手机端若被拦截自动播放，尝试静音起播或提示用户点播放键
        video.muted = true;
        video.play().then(() => {
          showToast('已静音起播，点击播放器音量键可开启声音', 2800);
        }).catch(() => {
          showToast('请点击播放器中央的播放按钮开始观看', 2800);
        });
      });
    }
  };

  const canNativeHls = Boolean(video.canPlayType && video.canPlayType('application/vnd.apple.mpegurl'));

  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    const hls = new Hls({ maxBufferLength: 15, enableWorker: true, lowLatencyMode: false });
    activeHls = hls;
    let failed = false;
    hls.on(Hls.Events.ERROR, (_, errData) => {
      if (errData.fatal && !failed) {
        failed = true;
        hls.destroy();
        activeHls = null;
        onPlayFail();
      }
    });
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, tryPlay);
  } else if (canNativeHls) {
    // iOS Safari / 部分原生支持 HLS 的手机浏览器
    video.src = streamUrl;
    video.onerror = onPlayFail;
    video.onloadedmetadata = tryPlay;
    tryPlay();
  } else {
    // 安卓浏览器若 hls.js 未加载成功，给出明确提示
    video.src = streamUrl;
    video.onerror = onPlayFail;
    tryPlay();
  }
}

function switchNextLiveSource() {
  if (!activeLiveChannel) return;
  const { gIdx, cIdx, ch } = activeLiveChannel;
  const nextIdx = (activeLiveUrlIdx + 1) % ch.urls.length;
  playFreeLiveChannel(gIdx, cIdx, nextIdx, true);
}

// ================= 点播页：热门精选 8 部 + 选专线试看（与测速联动 + 游客试看计时） =================
let vodHotMovies = [];
let vodPreviewMinutes = 10;
let activeVodMovie = null;
let activeVodSourceIdx = 0;
let activeVodEpIdx = 0;
let activeVodHls = null;

function isVodMemberActive() {
  return Boolean(currentUser && Number(currentUser.vod_expire_at || 0) > Date.now());
}

function updateVodPreviewRuleText() {
  const el = document.getElementById('vodPreviewRuleText');
  if (!el) return;
  if (vodPreviewMinutes > 0) {
    el.textContent = `点击海报选专线直接播（线路自动按您的宽带测速排序）· 游客可试看前 ${vodPreviewMinutes} 分钟，有效点播会员不限时`;
  } else {
    el.textContent = '点击海报选专线直接播放，线路自动按您的家庭宽带测速排序';
  }
}

async function loadVodHotMovies() {
  const grid = document.getElementById('vodHotGrid');
  if (!grid) return;
  try {
    const res = await fetch(API_BASE + '/api/vod-hot');
    const data = await res.json();
    if (data.previewMinutes !== undefined) {
      vodPreviewMinutes = Number(data.previewMinutes);
      updateVodPreviewRuleText();
    }
    if (!res.ok || !Array.isArray(data.movies) || data.movies.length === 0) {
      grid.innerHTML = '<div class="card muted-sm" style="grid-column:1/-1;text-align:center;padding:24px;">热门影片暂未同步，管理员可在后台点击刷新</div>';
      return;
    }
    vodHotMovies = data.movies;
    applySmartVodGridLayout(grid, vodHotMovies.length);
    grid.innerHTML = vodHotMovies.map((m, idx) => {
      const rateBadge = m.rate ? `⭐ ${m.rate}` : (m.remarks || '');
      const typeLabel = m.category === 'movie' ? '🎬 电影' : (m.category === 'tv' ? '📺 电视剧' : (m.type || '热播'));
      return `
      <div class="vod-card" onclick="openVodMovie(${idx})">
        <div class="vod-poster-wrap">
          <img src="${escapeHtml(m.pic)}" alt="${escapeHtml(m.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity='0.2'">
          ${rateBadge ? `<span class="vod-remarks-tag">${escapeHtml(rateBadge)}</span>` : ''}
          <span class="vod-lines-tag">⚡ ${m.sources.length}条专线</span>
        </div>
        <div class="vod-card-info">
          <div class="vod-card-title" title="${escapeHtml(m.title)}">${escapeHtml(m.title)}</div>
          <div class="vod-card-sub">${escapeHtml([typeLabel, m.year, m.remarks && m.rate ? m.remarks : ''].filter(Boolean).join(' · '))}</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    grid.innerHTML = '<div class="card muted-sm" style="grid-column:1/-1;text-align:center;padding:24px;">热门影片加载失败，请稍后刷新</div>';
  }
}

function getSortedMovieSources(movie) {
  const rankMap = new Map();
  const speedMap = new Map();
  currentSites.forEach((s, i) => {
    rankMap.set(s.key, i);
    if (s.status === 'ok' && s.speedMBs > 0) speedMap.set(s.key, s.speedMBs);
  });
  return [...(movie.sources || [])]
    .map(src => ({
      ...src,
      _rank: rankMap.has(src.siteKey) ? rankMap.get(src.siteKey) : 9999,
      _speedMBs: speedMap.get(src.siteKey) || 0
    }))
    .sort((a, b) => a._rank - b._rank);
}

let activeVodSiteKey = '';
let vodLoadTimer = null;

function syncVodSpeedToGlobalSites(siteKey, status, speedMBs, latency) {
  const target = currentSites.find(s => s.key === siteKey);
  if (target) {
    target.status = status;
    target.speedMBs = status === 'ok' ? Number(speedMBs || 0) : 0;
    target.latency = status === 'ok' ? Math.round(Number(latency || 0)) : 9999;
    currentSites.sort((a, b) => {
      if (a.status === 'ok' && b.status !== 'ok') return -1;
      if (a.status !== 'ok' && b.status === 'ok') return 1;
      if (a.status === 'failed' && b.status !== 'failed') return 1;
      if (a.status !== 'failed' && b.status === 'failed') return -1;
      if (b.speedMBs !== a.speedMBs) return b.speedMBs - a.speedMBs;
      return (a.latency || 9999) - (b.latency || 9999);
    });
    renderSiteList();
  }
  if (activeVodMovie && Array.isArray(activeVodMovie.sortedSources)) {
    const src = activeVodMovie.sortedSources.find(s => s.siteKey === siteKey);
    if (src) {
      src._status = status;
      src._speedMBs = status === 'ok' ? Number(speedMBs || 0) : 0;
      src._latency = status === 'ok' ? Math.round(Number(latency || 0)) : 9999;
    }
    sortActiveVodSources();
    renderVodLinePillsOnly();
  }
}

function sortActiveVodSources() {
  if (!activeVodMovie || !Array.isArray(activeVodMovie.sortedSources)) return;
  activeVodMovie.sortedSources.sort((a, b) => {
    const aOk = a._status === 'ok' ? 1 : 0;
    const bOk = b._status === 'ok' ? 1 : 0;
    if (aOk !== bOk) return bOk - aOk;
    const aFail = a._status === 'failed' ? 1 : 0;
    const bFail = b._status === 'failed' ? 1 : 0;
    if (aFail !== bFail) return aFail - bFail;
    if ((b._speedMBs || 0) !== (a._speedMBs || 0)) return (b._speedMBs || 0) - (a._speedMBs || 0);
    if ((a._latency || 9999) !== (b._latency || 9999)) return (a._latency || 9999) - (b._latency || 9999);
    return (a._rank || 9999) - (b._rank || 9999);
  });
  const newIdx = activeVodMovie.sortedSources.findIndex(s => s.siteKey === activeVodSiteKey);
  if (newIdx >= 0) activeVodSourceIdx = newIdx;
}

function renderVodLinePillsOnly() {
  if (!activeVodMovie) return;
  const sources = activeVodMovie.sortedSources || [];
  const lineBox = document.getElementById('vodLinePills');
  if (!lineBox) return;
  lineBox.innerHTML = sources.map((s, i) => {
    const isCur = s.siteKey === activeVodSiteKey;
    let tag = '';
    let extraCls = '';
    if (s._status === 'testing') {
      tag = ' · 测速中…';
    } else if (s._status === 'ok') {
      tag = s._speedMBs > 0 ? ` · ${s._speedMBs.toFixed(1)}M/s` : (s._latency < 9000 ? ` · ${s._latency}ms` : ' · 可用');
    } else if (s._status === 'failed') {
      tag = ' · 受限/超时';
      extraCls = ' failed';
    }
    return `<button type="button" class="live-ch-pill ${isCur ? 'active' : ''}${extraCls}" onclick="selectVodSourceByKey('${escapeHtml(s.siteKey)}')">${escapeHtml(s.siteName)}${tag}</button>`;
  }).join('');
}

function openVodMovie(idx) {
  if (typeof stopFreeLivePlayer === 'function') stopFreeLivePlayer();
  if (typeof stopTutorialVideo === 'function') stopTutorialVideo();
  const m = vodHotMovies[idx];
  if (!m) return;

  const sources = getSortedMovieSources(m).map(s => {
    const g = currentSites.find(x => x.key === s.siteKey);
    return {
      ...s,
      _status: g?.status || 'idle',
      _speedMBs: g?.speedMBs || 0,
      _latency: g?.latency || 9999
    };
  });
  activeVodMovie = { ...m, sortedSources: sources };
  sortActiveVodSources();
  activeVodSourceIdx = 0;
  activeVodSiteKey = activeVodMovie.sortedSources[0]?.siteKey || '';
  activeVodEpIdx = 0;

  document.getElementById('vodModalTitle').textContent = m.title;
  document.getElementById('vodModalMeta').textContent = [m.year, m.type, m.remarks].filter(Boolean).join(' · ') || '高清专线';
  document.getElementById('vodModalBlurb').textContent = m.blurb || '点击下方专线即可流畅试看，系统自动记录各专线网速并按快慢排序。';
  document.getElementById('vodLimitOverlay').classList.add('hidden');

  const timerBadge = document.getElementById('vodPreviewTimerBadge');
  if (isVodMemberActive()) {
    timerBadge.className = 'badge active';
    timerBadge.textContent = '👑 尊享会员 · 不限时';
  } else if (vodPreviewMinutes > 0) {
    timerBadge.className = 'badge expired';
    timerBadge.textContent = `⏱️ 游客试看前 ${vodPreviewMinutes} 分钟`;
  } else {
    timerBadge.className = 'badge active';
    timerBadge.textContent = '🆓 限时免费试看';
  }

  document.getElementById('vodPlayerModal').classList.remove('hidden');
  renderVodSelectorsAndPlay();
}

function renderVodSelectorsAndPlay() {
  if (!activeVodMovie) return;
  const sources = activeVodMovie.sortedSources || [];
  if (sources.length === 0) return;

  let curSrc = sources.find(s => s.siteKey === activeVodSiteKey);
  if (!curSrc) {
    curSrc = sources[0];
    activeVodSiteKey = curSrc.siteKey;
  }
  activeVodSourceIdx = sources.indexOf(curSrc);
  renderVodLinePillsOnly();

  const eps = curSrc.episodes || [];
  if (activeVodEpIdx >= eps.length) activeVodEpIdx = 0;

  const epWrap = document.getElementById('vodEpWrap');
  const epBox = document.getElementById('vodEpPills');
  if (eps.length > 1) {
    epWrap.classList.remove('hidden');
    epBox.innerHTML = eps.map((ep, i) =>
      `<button type="button" class="vod-ep-btn ${i === activeVodEpIdx ? 'active' : ''}" onclick="selectVodEpisode(${i})">${escapeHtml(ep.name)}</button>`
    ).join('');
  } else {
    epWrap.classList.add('hidden');
  }

  if (eps[activeVodEpIdx]) {
    playVodStreamUrl(eps[activeVodEpIdx].url, curSrc.siteKey);
  }
}

function selectVodSourceByKey(siteKey) {
  activeVodSiteKey = siteKey;
  renderVodSelectorsAndPlay();
}

function selectVodSource(idx) {
  const s = activeVodMovie?.sortedSources?.[idx];
  if (s) selectVodSourceByKey(s.siteKey);
}

function selectVodEpisode(idx) {
  activeVodEpIdx = idx;
  renderVodSelectorsAndPlay();
}

function playVodStreamUrl(streamUrl, siteKey) {
  const video = document.getElementById('vodVideoPlayer');
  const overlay = document.getElementById('vodLimitOverlay');
  if (!video) return;
  overlay.classList.add('hidden');

  if (vodLoadTimer) { clearTimeout(vodLoadTimer); vodLoadTimer = null; }
  if (activeVodHls) { activeVodHls.destroy(); activeVodHls = null; }
  video.pause();
  video.onerror = null;
  video.onloadedmetadata = null;
  video.removeAttribute('src');

  // 标记当前专线为加载测速中
  if (activeVodMovie && siteKey) {
    const cur = activeVodMovie.sortedSources.find(s => s.siteKey === siteKey);
    if (cur && cur._status !== 'ok') {
      cur._status = 'testing';
      renderVodLinePillsOnly();
    }
  }

  const startTs = performance.now();
  let settled = false;
  const markFail = (reasonMsg) => {
    if (settled) return;
    settled = true;
    if (vodLoadTimer) { clearTimeout(vodLoadTimer); vodLoadTimer = null; }
    if (siteKey) syncVodSpeedToGlobalSites(siteKey, 'failed', 0, 9999);
    showToast(reasonMsg || '该专线受浏览器跨域限制或超时，请切换其他专线（TVBox 端可正常播）', 3200);
  };
  const markSuccess = (speedMBs, latencyMs) => {
    if (settled) return;
    settled = true;
    if (vodLoadTimer) { clearTimeout(vodLoadTimer); vodLoadTimer = null; }
    if (siteKey) syncVodSpeedToGlobalSites(siteKey, 'ok', speedMBs, latencyMs);
  };

  // 8 秒加载超时保护，防止个别卡死平台毫无反应
  vodLoadTimer = setTimeout(() => {
    if (!settled) {
      if (activeVodHls) { activeVodHls.destroy(); activeVodHls = null; }
      markFail('当前专线连接超时(8s)，已自动标记并下沉排序，请点其他专线');
    }
  }, 8000);

  // 游客试看时长监控（付费会员不限时）
  const limitSec = (!isVodMemberActive() && vodPreviewMinutes > 0) ? vodPreviewMinutes * 60 : 0;
  const timerBadge = document.getElementById('vodPreviewTimerBadge');

  video.ontimeupdate = () => {
    if (limitSec <= 0) return;
    const rem = Math.max(0, Math.ceil(limitSec - video.currentTime));
    const mm = String(Math.floor(rem / 60)).padStart(2, '0');
    const ss = String(rem % 60).padStart(2, '0');
    if (timerBadge) timerBadge.textContent = `⏱️ 试看剩余 ${mm}:${ss}`;
    if (video.currentTime >= limitSec) {
      video.pause();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      document.getElementById('vodLimitTitle').textContent = `试看已达上限（前 ${vodPreviewMinutes} 分钟）`;
      overlay.classList.remove('hidden');
    }
  };
  video.onseeking = () => {
    if (limitSec > 0 && video.currentTime > limitSec) {
      video.currentTime = Math.max(0, limitSec - 1);
      showToast(`游客最多可试看前 ${vodPreviewMinutes} 分钟，开通会员不限时！`);
    }
  };

  const tryPlay = () => {
    const p = video.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        video.muted = true;
        video.play().then(() => showToast('已静音起播，点击音量键开启声音', 2500)).catch(() => {});
      });
    }
  };

  const canNativeHls = Boolean(video.canPlayType && video.canPlayType('application/vnd.apple.mpegurl'));
  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    const hls = new Hls({ maxBufferLength: 20, enableWorker: true });
    activeVodHls = hls;
    let manifestLatency = 0;

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      manifestLatency = Math.max(10, Math.round(performance.now() - startTs));
      tryPlay();
    });
    // 真实监听首个 TS 切片下载完成，精确计算该平台到用户宽带的 MB/s 速率
    hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
      if (settled) return;
      const st = data?.frag?.stats || data?.stats || {};
      const loadedBytes = st.loaded || st.total || 0;
      const loadMs = Math.max(10, (st.loading?.end || performance.now()) - (st.loading?.start || startTs));
      const speedMBs = loadedBytes > 0 ? (loadedBytes / (1024 * 1024)) / (loadMs / 1000) : 0;
      const lat = manifestLatency || Math.round(performance.now() - startTs);
      markSuccess(speedMBs, lat);
    });
    hls.on(Hls.Events.ERROR, (_, errData) => {
      if (errData.fatal) {
        hls.destroy();
        activeVodHls = null;
        markFail('该专线被浏览器跨域拦截或无法播放，已自动标记，请换其他专线');
      }
    });
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
  } else if (canNativeHls) {
    video.src = streamUrl;
    video.onloadedmetadata = () => {
      const lat = Math.max(10, Math.round(performance.now() - startTs));
      markSuccess(0, lat);
      tryPlay();
    };
    video.onerror = () => markFail();
    tryPlay();
  } else {
    video.src = streamUrl;
    video.onloadedmetadata = () => {
      const lat = Math.max(10, Math.round(performance.now() - startTs));
      markSuccess(0, lat);
      tryPlay();
    };
    video.onerror = () => markFail();
    tryPlay();
  }
}

function closeVodModal() {
  if (vodLoadTimer) { clearTimeout(vodLoadTimer); vodLoadTimer = null; }
  const video = document.getElementById('vodVideoPlayer');
  if (activeVodHls) { activeVodHls.destroy(); activeVodHls = null; }
  if (video) {
    video.pause();
    video.ontimeupdate = null;
    video.onseeking = null;
    video.onerror = null;
    video.onloadedmetadata = null;
    video.removeAttribute('src');
    video.load();
  }
  document.getElementById('vodPlayerModal')?.classList.add('hidden');
}

// 智能计算海报网格列数：根据实际影片数量自动匹配最饱满的行/列组合
function applySmartVodGridLayout(gridEl, count) {
  if (!gridEl || !count) return;
  const n = Number(count);

  // 电脑端列数（优先 5 / 4 / 3 列整除，否则选最后一行空位最少的列数）
  let desktopCols = 5;
  if (n <= 5) {
    desktopCols = Math.max(2, n);
  } else if (n % 5 === 0) {
    desktopCols = 5;
  } else if (n % 4 === 0) {
    desktopCols = 4;
  } else if (n % 3 === 0) {
    desktopCols = 3;
  } else {
    let bestCols = 5;
    let minEmpty = 99;
    for (const c of [5, 4, 3]) {
      const rem = n % c;
      const empty = rem === 0 ? 0 : c - rem;
      if (empty < minEmpty) {
        minEmpty = empty;
        bestCols = c;
      }
    }
    desktopCols = bestCols;
  }

  // 手机端列数（偶数默认 2 列完全填满；3 的倍数且为奇数如 3/9/15 用 3 列完全填满）
  let mobileCols = 2;
  if (n === 1) mobileCols = 1;
  else if (n % 2 === 0) mobileCols = 2;
  else if (n % 3 === 0) mobileCols = 3;
  else mobileCols = 2;

  gridEl.style.setProperty('--vod-cols-desktop', String(desktopCols));
  gridEl.style.setProperty('--vod-cols-mobile', String(mobileCols));
}

// 手机切后台或息屏时自动暂停播放，防止后台偷跑流量或持续出声
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    const liveV = document.getElementById('liveVideoPlayer');
    if (liveV && !liveV.paused) liveV.pause();
    const vodV = document.getElementById('vodVideoPlayer');
    if (vodV && !vodV.paused) vodV.pause();
    const tutV = document.querySelector('#tutorialVideoWrap video');
    if (tutV && !tutV.paused) tutV.pause();
  }
});
