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
function indexToRouteAlias(idx) {
  let n = Math.max(0, Number(idx) || 0);
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `路线${letters}`;
}

const DEFAULT_VOD_SITES = Array.from({ length: 21 }, (_, i) => ({
  key: `route_site_${String(i + 1).padStart(2, '0')}`,
  rawKey: `site_${String(i + 1).padStart(2, '0')}`,
  name: indexToRouteAlias(i),
  defaultRank: i + 1,
  healthScore: 0
}));

let currentSites = DEFAULT_VOD_SITES.map(s => ({ ...s }));
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
  if (tabName === 'speed') scheduleSilentSiteCalibration(false);
  if (tabName !== 'speed') document.getElementById('vodTvOnlyOverlay')?.classList.add('hidden');
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
  document.getElementById('loginOpen').onclick = () => openAuthModal(false);
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
  document.getElementById('vodSearchForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    runVodSearch();
  });
  document.getElementById('vodSearchResetBtn')?.addEventListener('click', exitVodSearchMode);
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

  // 路线排序同步 & 双端视图切换 & 安装大全搜索筛选
  document.getElementById('saveCustomOrder')?.addEventListener('click', saveCustomOrder);
  document.getElementById('reprobeLatencyBtn')?.addEventListener('click', () => scheduleSilentSiteCalibration(true));
  document.querySelectorAll('#siteRankViewTabs .seg-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#siteRankViewTabs .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeSiteRankView = btn.dataset.rview || 'web';
      renderSiteList();
    };
  });
  document.getElementById('brandGuideSearch')?.addEventListener('input', filterBrandGuides);
  document.querySelectorAll('#brandCatTabs .seg-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#brandCatTabs .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterBrandGuides();
    };
  });
  ['optTagRank', 'optShowSpeed'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      renderSiteList();
      renderVodLinePillsOnly();
      persistPersonalVodState();
      autoSyncUserOrderQuietly();
    });
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
        currentSites = d.sites.map((s, i) => ({
          key: s.key,
          rawKey: s.rawKey || stripSiteKeyMaskClient(s.key),
          name: s.name,
          defaultRank: Number(s.defaultRank || (i + 1)),
          healthScore: Number(s.healthScore || 0)
        }));
        hydratePersonalVodState();
        currentVodCount = currentSites.length;
        document.querySelectorAll('.js-vod-count').forEach(el => { el.textContent = String(currentVodCount); });
        const mv = document.getElementById('mineVodCount'); if (mv) mv.textContent = currentVodCount + ' 条';
        renderSiteList();
        if (document.getElementById('view-speed')?.classList.contains('active')) {
          scheduleSilentSiteCalibration(false);
        }
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
  const catRank = { combo: 1, vod: 2, live: 3 };
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
    if (p.vodDays > 0) chips.push(`🎬 点播 ${p.vodDays} 天`);
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
    document.getElementById('authSubtitle')?.classList.add('hidden');
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
    <span class="badge ${vodActive ? 'active' : 'expired'}">点播: ${vodActive ? '剩' + daysLeft(user.vod_expire_at) + '天' : '未开通'}</span>
    <span class="badge ${liveActive ? 'active' : 'expired'}">直播: ${liveActive ? '剩' + daysLeft(user.live_expire_at) + '天' : '免费版'}</span>
  `;

  const allUrl = user.allSubUrl || `${API_BASE}/s/${user.token}`;
  const vodUrl = user.vodSubUrl || `${API_BASE}/v/${user.token}`;
  const liveUrl = user.liveSubUrl || `${API_BASE}/l/${user.token}`;

  document.getElementById('accountInfo').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
      <b>🚀 一键全能聚合地址</b>
      <span class="muted-sm" style="font-size:0.74rem;">直接填进 TVBox</span>
    </div>
    <div class="sub-url-box">
      <code class="sub-url-code">${allUrl}</code>
    </div>
    <div class="sub-btn-pair">
      <button type="button" class="btn-primary btn-sm-pad" onclick="copyText('${allUrl}', this)">📋 一键复制</button>
      <button type="button" class="btn-outline btn-sm-pad" onclick="openSubQrModal('${allUrl}', '一键全能聚合地址')">📱 扫码导入</button>
    </div>
    <p class="muted-sm" style="margin-top:10px;">到期时间：点播 ${formatDate(user.vod_expire_at)} · 直播 ${formatDate(user.live_expire_at)}（仅限 TVBox 加载防泄露）</p>
    <details style="margin-top:12px;border-top:1px dashed var(--border);padding-top:10px;">
      <summary style="cursor:pointer;color:var(--muted);font-size:0.84rem;">展开独立点播 / 独立直播分离地址</summary>
      <div style="margin-top:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span class="muted-sm">🎬 独立点播</span>
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

  if (user.site_config || (user.site_order && user.site_order.length > 0)) {
    mergeCloudPersonalVodConfig(user.site_config || { order: user.site_order });
  }

  // 同步把专属订阅地址置顶渲染到「首页」最显目卡片
  const homeSubBadges = document.getElementById('homeSubBadges');
  const homeSubBody = document.getElementById('homeSubBody');
  if (homeSubBadges) {
    homeSubBadges.innerHTML = `<span class="badge ${vodActive ? 'active' : 'expired'}">点播:${vodActive ? '剩' + daysLeft(user.vod_expire_at) + '天' : '未开'}</span> <span class="badge ${liveActive ? 'active' : 'expired'}">直播:${liveActive ? '剩' + daysLeft(user.live_expire_at) + '天' : '免费'}</span>`;
  }
  if (homeSubBody) {
    homeSubBody.innerHTML = `
      <p class="muted-sm" style="margin:6px 0 10px;">填入 TVBox「配置地址」栏，点播与直播全自动更新。</p>
      <div class="sub-url-box">
        <code class="sub-url-code">${allUrl}</code>
      </div>
      <div class="sub-btn-pair">
        <button type="button" class="btn-primary btn-sm-pad" onclick="copyText('${allUrl}', this)">📋 一键复制</button>
        <button type="button" class="btn-outline btn-sm-pad" onclick="openSubQrModal('${allUrl}', '我的专属订阅地址')">📱 扫码导入</button>
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
  const invPosterBtn = document.getElementById('openInvitePosterBtn');
  if (invPosterBtn) {
    invPosterBtn.onclick = () => openInvitePosterModal({
      invUrl,
      invCode,
      rewardDays: Number(user.invite_reward_days ?? 15)
    });
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
function stripSiteKeyMaskClient(siteKey) {
  return String(siteKey || '').replace(/^(?:line_\d+_|route_)/, '').trim();
}

function cleanBaseSiteName(name) {
  return String(name || '')
    .replace(/^\d+[丨·.\-\s]+/, '')
    .replace(/\d{2}$/, '')
    .trim();
}

// ================= V19 千人千面双维度测速与排序引擎（网页端 vs TVBox 端各自最优） =================
const PERSONAL_VOD_STORAGE_KEY = 'tvbox_personal_vod_v2';
let activeSiteRankView = 'web'; // 'web' | 'tvbox'
let personalVodMetrics = {};    // { [rawKey]: { webState, speedMBs, latencyMs, probeMs, updatedAt } }
let personalSavedTvOrder = [];  // 历史云端保存的 TVBox 顺序（冷启动兜底）
let personalSavedWebOrder = []; // 历史云端保存的 Web 顺序
let silentCalibrationRunning = false;
let silentCalibrationDoneTs = 0;

function getSiteMetric(rawKey) {
  const rk = stripSiteKeyMaskClient(rawKey);
  return personalVodMetrics[rk] || { webState: 'idle', speedMBs: 0, latencyMs: 9999, probeMs: 9999, updatedAt: 0 };
}

function setSiteMetric(rawKey, patch) {
  const rk = stripSiteKeyMaskClient(rawKey);
  if (!rk) return;
  const prev = getSiteMetric(rk);
  personalVodMetrics[rk] = {
    ...prev,
    ...patch,
    updatedAt: Date.now()
  };
}

function hydratePersonalVodState() {
  try {
    const raw = localStorage.getItem(PERSONAL_VOD_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (parsed.metrics && typeof parsed.metrics === 'object') {
          personalVodMetrics = { ...parsed.metrics, ...personalVodMetrics };
        }
        if (Array.isArray(parsed.order) && personalSavedTvOrder.length === 0) {
          personalSavedTvOrder = parsed.order;
        }
        if (Array.isArray(parsed.webOrder) && personalSavedWebOrder.length === 0) {
          personalSavedWebOrder = parsed.webOrder;
        }
        if (parsed.tagRank !== undefined) {
          const el = document.getElementById('optTagRank');
          if (el) el.checked = Boolean(parsed.tagRank);
        }
        if (parsed.showSpeed !== undefined) {
          const el = document.getElementById('optShowSpeed');
          if (el) el.checked = Boolean(parsed.showSpeed);
        }
      }
    }
  } catch (e) {}
}

function mergeCloudPersonalVodConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  if (cfg.metrics && typeof cfg.metrics === 'object') {
    for (const [k, v] of Object.entries(cfg.metrics)) {
      const rk = stripSiteKeyMaskClient(k);
      if (!rk || !v) continue;
      const local = personalVodMetrics[rk];
      if (!local || Number(v.updatedAt || 0) > Number(local.updatedAt || 0)) {
        personalVodMetrics[rk] = {
          webState: v.webState || 'idle',
          speedMBs: Number(v.speedMBs || 0),
          latencyMs: Number(v.latencyMs || 9999),
          probeMs: Number(v.probeMs || 9999),
          updatedAt: Number(v.updatedAt || 0)
        };
      }
    }
  }
  if (Array.isArray(cfg.order) && cfg.order.length > 0) {
    personalSavedTvOrder = cfg.order.map(stripSiteKeyMaskClient);
  }
  if (Array.isArray(cfg.webOrder) && cfg.webOrder.length > 0) {
    personalSavedWebOrder = cfg.webOrder.map(stripSiteKeyMaskClient);
  }
  if (cfg.tagRank !== undefined) {
    const el = document.getElementById('optTagRank');
    if (el) el.checked = Boolean(cfg.tagRank);
  }
  if (cfg.showSpeed !== undefined) {
    const el = document.getElementById('optShowSpeed');
    if (el) el.checked = Boolean(cfg.showSpeed);
  }
  persistPersonalVodState();
  renderSiteList();
  if (activeVodMovie) {
    resortActiveMovieSourcesForWeb();
    renderVodLinePillsOnly();
  }
}

// 网页端个人排序：实测流畅均速(降序) > 静默探测支持网页跨域(延迟升序) > 未测 > 网页跨域受限(沉底不删) > 超时(沉底不删)
function compareForWeb(rawA, rawB, defRankA = 9999, defRankB = 9999) {
  const mA = getSiteMetric(rawA);
  const mB = getSiteMetric(rawB);
  const tierOf = (m) => {
    if (m.webState === 'ok') return 1;
    if (m.webState === 'web_ready') return 2;
    if (m.webState === 'idle') return 3;
    if (m.webState === 'cors') return 4;
    return 5;
  };
  const tA = tierOf(mA);
  const tB = tierOf(mB);
  if (tA !== tB) return tA - tB;

  if (tA === 1) {
    if ((mB.speedMBs || 0) !== (mA.speedMBs || 0)) return (mB.speedMBs || 0) - (mA.speedMBs || 0);
    if ((mA.latencyMs || 9999) !== (mB.latencyMs || 9999)) return (mA.latencyMs || 9999) - (mB.latencyMs || 9999);
  }
  if (tA === 2 || tA === 4) {
    if ((mA.probeMs || 9999) !== (mB.probeMs || 9999)) return (mA.probeMs || 9999) - (mB.probeMs || 9999);
  }
  const savedIdxA = personalSavedWebOrder.indexOf(rawA);
  const savedIdxB = personalSavedWebOrder.indexOf(rawB);
  if (savedIdxA >= 0 && savedIdxB >= 0 && savedIdxA !== savedIdxB) return savedIdxA - savedIdxB;
  return defRankA - defRankB;
}

// TVBox 端个人排序：实测均速(降序) > 网络连通站[含网页CORS受限的国内大站!](延迟升序) > 未测 > 真超时站(沉底不删)
function compareForTvBox(rawA, rawB, defRankA = 9999, defRankB = 9999) {
  const mA = getSiteMetric(rawA);
  const mB = getSiteMetric(rawB);
  const tierOf = (m) => {
    if (m.speedMBs > 0) return 1;
    if (m.webState === 'ok' || m.webState === 'web_ready' || m.webState === 'cors') return 2;
    if (m.webState === 'idle') return 3;
    return 4;
  };
  const tA = tierOf(mA);
  const tB = tierOf(mB);
  if (tA !== tB) return tA - tB;

  if (tA === 1) {
    if ((mB.speedMBs || 0) !== (mA.speedMBs || 0)) return (mB.speedMBs || 0) - (mA.speedMBs || 0);
    return (mA.latencyMs || 9999) - (mB.latencyMs || 9999);
  }
  if (tA === 2) {
    const latA = (mA.probeMs < 9000 ? mA.probeMs : mA.latencyMs) || 9999;
    const latB = (mB.probeMs < 9000 ? mB.probeMs : mB.latencyMs) || 9999;
    if (latA !== latB) return latA - latB;
  }
  const savedIdxA = personalSavedTvOrder.indexOf(rawA);
  const savedIdxB = personalSavedTvOrder.indexOf(rawB);
  if (savedIdxA >= 0 && savedIdxB >= 0 && savedIdxA !== savedIdxB) return savedIdxA - savedIdxB;
  return defRankA - defRankB;
}

function getSortedSitesForView(viewMode = 'web') {
  const cmp = viewMode === 'tvbox' ? compareForTvBox : compareForWeb;
  return [...currentSites].sort((a, b) => cmp(a.rawKey, b.rawKey, a.defaultRank || 9999, b.defaultRank || 9999));
}

function persistPersonalVodState() {
  try {
    const tvList = getSortedSitesForView('tvbox').map(s => s.rawKey);
    const webList = getSortedSitesForView('web').map(s => s.rawKey);
    const payload = {
      v: 2,
      order: tvList,
      webOrder: webList,
      metrics: personalVodMetrics,
      tagRank: document.getElementById('optTagRank')?.checked ?? true,
      showSpeed: document.getElementById('optShowSpeed')?.checked ?? false
    };
    localStorage.setItem(PERSONAL_VOD_STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {}
}

function renderSiteList() {
  const box = document.getElementById('siteList');
  if (!box) return;
  const list = getSortedSitesForView(activeSiteRankView);
  const tagRank = document.getElementById('optTagRank')?.checked ?? true;
  const showSpeed = document.getElementById('optShowSpeed')?.checked ?? false;

  let webOkCnt = 0, corsCnt = 0, timeoutCnt = 0;
  list.forEach(s => {
    const m = getSiteMetric(s.rawKey);
    if (m.webState === 'ok' || m.webState === 'web_ready') webOkCnt++;
    else if (m.webState === 'cors') corsCnt++;
    else if (m.webState === 'timeout') timeoutCnt++;
  });

  const badge = document.getElementById('speedModeBadge');
  if (badge && !silentCalibrationRunning) {
    badge.textContent = `全部 ${list.length} 条路线 · 网页可播 ${webOkCnt} · 仅电视 ${corsCnt}${timeoutCnt > 0 ? ' · 超时 ' + timeoutCnt : ''}`;
  }

  let rankSeq = 0;
  box.innerHTML = list.map((site, idx) => {
    const m = getSiteMetric(site.rawKey);
    const base = cleanBaseSiteName(site.name);
    const isMeasured = m.webState !== 'idle';
    const isTopGood = activeSiteRankView === 'tvbox'
      ? (m.webState !== 'timeout')
      : (m.webState === 'ok' || m.webState === 'web_ready');

    if (isTopGood) rankSeq++;
    const rankNum = isTopGood ? rankSeq : (idx + 1);
    let title = (tagRank && isTopGood && isMeasured) ? `${base}${String(rankNum).padStart(2, '0')}` : base;
    if (showSpeed && m.speedMBs > 0) title += ` [${m.speedMBs.toFixed(1)}M]`;

    let tagHtml = '<span class="site-mode-tag unknown">待测</span>';
    let cardCls = '';
    let metricHtml = '<span class="muted-sm">待校准</span>';

    if (m.webState === 'ok') {
      tagHtml = '<span class="site-mode-tag web">🌐网页+电视</span>';
      cardCls = 'ok';
      const spdCls = m.speedMBs >= 3 ? 'speed-fast' : (m.speedMBs >= 1 ? 'speed-mid' : 'speed-slow');
      const latTxt = m.latencyMs < 9000 ? `${m.latencyMs}ms` : '';
      metricHtml = `<div class="speed-val ${spdCls}">${m.speedMBs > 0 ? m.speedMBs.toFixed(1) + 'M/s' : '流畅'}</div><div class="muted-sm">${latTxt}</div>`;
    } else if (m.webState === 'web_ready') {
      tagHtml = '<span class="site-mode-tag ready">🌐网页+电视</span>';
      cardCls = 'ok';
      metricHtml = `<div class="speed-val speed-mid">${m.probeMs < 9000 ? m.probeMs + 'ms' : '连通'}</div><div class="muted-sm">看片测均速</div>`;
    } else if (m.webState === 'cors') {
      tagHtml = '<span class="site-mode-tag cors">📺电视畅看</span>';
      cardCls = activeSiteRankView === 'tvbox' ? 'ok' : '';
      metricHtml = `<div class="speed-val ${activeSiteRankView === 'tvbox' ? 'speed-mid' : ''}" style="${activeSiteRankView === 'tvbox' ? '' : 'color:#94a3b8;'}">${m.probeMs < 9000 ? m.probeMs + 'ms' : '电视可用'}</div><div class="muted-sm">网页跨域受限</div>`;
    } else if (m.webState === 'timeout') {
      tagHtml = '<span class="site-mode-tag timeout">连接超时</span>';
      cardCls = 'failed';
      metricHtml = '<span class="speed-slow">超时</span>';
    }

    const badgeClass = (isTopGood && rankNum <= 3 && isMeasured) ? 'rank-badge top3' : 'rank-badge';
    const badgeText = String(idx + 1).padStart(2, '0');
    return `<div class="site-card ${cardCls}"><div class="site-title"><span class="${badgeClass}">${badgeText}</span><span>${escapeHtml(title)}${tagHtml}</span></div><div class="site-metrics">${metricHtml}</div></div>`;
  }).join('');
}

// 后台静默轻量校准：只用热播片单里的 CDN .m3u8 地址，绝不泄露采集站域名，不伪造 MB/s，精准区分「网页可播 / 电视可用(CORS) / 真超时」
async function probeSingleStreamConnectivity(streamUrl) {
  const sep = streamUrl.includes('?') ? '&' : '?';
  const testUrl = `${streamUrl}${sep}_p=${Date.now()}`;
  const t0 = performance.now();
  try {
    const resp = await fetch(testUrl, { mode: 'cors', cache: 'no-store', signal: AbortSignal.timeout(2800) });
    const ms = Math.max(15, Math.round(performance.now() - t0));
    if (resp.ok) {
      return { state: 'web_ready', probeMs: ms };
    }
    return { state: 'cors', probeMs: ms };
  } catch (err) {
    if (err && err.name === 'TimeoutError') {
      return { state: 'timeout', probeMs: 9999 };
    }
    const t1 = performance.now();
    try {
      await fetch(testUrl, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(3000) });
      const ms2 = Math.max(15, Math.round(performance.now() - t1));
      return { state: 'cors', probeMs: ms2 };
    } catch (err2) {
      return { state: 'timeout', probeMs: 9999 };
    }
  }
}

async function scheduleSilentSiteCalibration(force = false) {
  if (silentCalibrationRunning) return;
  if (!force && Date.now() - silentCalibrationDoneTs < 6 * 3600 * 1000 && Object.keys(personalVodMetrics).length > 0) {
    return;
  }
  if (!Array.isArray(vodHotMovies) || vodHotMovies.length === 0 || currentSites.length === 0) return;

  const sampleUrlMap = new Map();
  for (const m of vodHotMovies) {
    for (const src of (m.sources || [])) {
      const rk = src.rawKey || stripSiteKeyMaskClient(src.siteKey);
      const firstEp = src.episodes?.[0]?.url;
      if (rk && firstEp && !sampleUrlMap.has(rk)) {
        sampleUrlMap.set(rk, firstEp);
      }
    }
  }

  const now = Date.now();
  const targets = currentSites.filter(s => {
    if (!sampleUrlMap.has(s.rawKey)) return false;
    if (force) return true;
    const m = getSiteMetric(s.rawKey);
    if (m.webState === 'ok' && m.speedMBs > 0 && (now - m.updatedAt < 6 * 3600 * 1000)) return false;
    return m.webState === 'idle' || (now - m.updatedAt > 6 * 3600 * 1000);
  });

  if (targets.length === 0) return;

  silentCalibrationRunning = true;
  const badge = document.getElementById('speedModeBadge');
  const reprobeBtn = document.getElementById('reprobeLatencyBtn');
  if (reprobeBtn) { reprobeBtn.disabled = true; reprobeBtn.textContent = '⏳ 校准中...'; }

  let done = 0;
  const queue = [...targets];
  const worker = async () => {
    while (queue.length > 0) {
      const site = queue.shift();
      const url = sampleUrlMap.get(site.rawKey);
      if (!url) continue;
      const res = await probeSingleStreamConnectivity(url);
      const prev = getSiteMetric(site.rawKey);
      if (res.state === 'web_ready') {
        setSiteMetric(site.rawKey, {
          webState: prev.webState === 'ok' ? 'ok' : 'web_ready',
          probeMs: res.probeMs
        });
      } else if (res.state === 'cors') {
        setSiteMetric(site.rawKey, {
          webState: 'cors',
          speedMBs: 0,
          probeMs: res.probeMs
        });
      } else {
        setSiteMetric(site.rawKey, {
          webState: 'timeout',
          speedMBs: 0,
          probeMs: 9999
        });
      }
      done++;
      if (badge) badge.textContent = `⚡ 静默校准您家宽带延迟 (${done}/${targets.length})...`;
      renderSiteList();
    }
  };

  try {
    await Promise.all([worker(), worker(), worker()]);
    silentCalibrationDoneTs = Date.now();
    persistPersonalVodState();
    autoSyncUserOrderQuietly();
    if (activeVodMovie) {
      resortActiveMovieSourcesForWeb();
      renderVodLinePillsOnly();
    }
    if (force) showToast('✅ 已按您当前宽带完成全平台延迟校准并排序！', 2800);
  } finally {
    silentCalibrationRunning = false;
    if (reprobeBtn) { reprobeBtn.disabled = false; reprobeBtn.textContent = '🔄 校准延迟'; }
    renderSiteList();
  }
}

async function saveCustomOrder() {
  const token = localStorage.getItem('tvbox_token');
  if (!token) { showToast('请先登录后再同步个人排序到云端'); openAuthModal(false); return; }
  const tagRank = document.getElementById('optTagRank')?.checked ?? true;
  const showSpeed = document.getElementById('optShowSpeed')?.checked ?? false;
  const siteOrder = getSortedSitesForView('tvbox').map(s => s.rawKey);
  const webOrder = getSortedSitesForView('web').map(s => s.rawKey);
  persistPersonalVodState();

  const res = await fetch(API_BASE + '/api/save-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ siteOrder, webOrder, metrics: personalVodMetrics, tagRank, showSpeed })
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
  if (subId !== 'sub-guide-dl' && typeof stopTutorialVideo === 'function') stopTutorialVideo();
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

// ================= 点播页：内嵌式播放 + 个人实测均速排序 + 跨域无感自动接力 =================
let vodHotMovies = [];
let vodSearchResults = [];
let vodSearchMode = false;
let vodSearchKeyword = '';
let vodPreviewMinutes = 10;
let activeVodMovie = null;
let activeVodMovieIdx = -1;
let activeVodSourceIdx = 0;
let activeVodEpIdx = 0;
let activeVodHls = null;
let activeVodSiteKey = '';
let vodLoadTimer = null;
let autoSaveOrderTimer = null;

const vodSpeedSamplesMap = new Map();

function isVodMemberActive() {
  return Boolean(currentUser && Number(currentUser.vod_expire_at || 0) > Date.now());
}

function updateVodPreviewRuleText() {
  const el = document.getElementById('vodPreviewRuleText');
  if (!el) return;
  if (vodPreviewMinutes > 0) {
    el.textContent = `点击海报在上方展开播放，全平台完整保留，自动按您家宽带均速排序（如 路线D01）· 游客试看前 ${vodPreviewMinutes} 分钟，会员不限时`;
  } else {
    el.textContent = '点击海报在上方展开播放，全平台完整保留，自动按您家宽带均速排序';
  }
}

function autoSyncUserOrderQuietly() {
  const token = localStorage.getItem('tvbox_token');
  if (!token) return;
  clearTimeout(autoSaveOrderTimer);
  autoSaveOrderTimer = setTimeout(async () => {
    try {
      const tagRank = document.getElementById('optTagRank')?.checked ?? true;
      const showSpeed = document.getElementById('optShowSpeed')?.checked ?? false;
      const siteOrder = getSortedSitesForView('tvbox').map(s => s.rawKey);
      const webOrder = getSortedSitesForView('web').map(s => s.rawKey);
      if (siteOrder.length === 0) return;
      await fetch(API_BASE + '/api/save-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ siteOrder, webOrder, metrics: personalVodMetrics, tagRank, showSpeed })
      });
    } catch (e) {}
  }, 2600);
}

function getCurrentVodList() {
  return vodSearchMode ? vodSearchResults : vodHotMovies;
}

function classifyMovieTypeClient(m) {
  const rawType = String(m.type || '');
  if (m.category === 'short' || /短剧|微剧/.test(rawType)) {
    return { category: 'short', label: '📱 短剧' };
  }
  const remarks = String(m.remarks || '');
  const epNames = (m.sources || []).flatMap(s => (s.episodes || []).map(e => String(e.name || '')));
  const txt = `${remarks} ${epNames.join(' ')}`;
  if (txt.includes('集')) return { category: 'tv', label: '📺 电视剧' };
  if (txt.includes('正片')) return { category: 'movie', label: '🎬 电影' };
  return m.category === 'movie' ? { category: 'movie', label: '🎬 电影' } : { category: 'tv', label: '📺 电视剧' };
}

function renderVodHotGrid() {
  const grid = document.getElementById('vodHotGrid');
  if (!grid) return;
  const list = getCurrentVodList();
  if (!Array.isArray(list) || list.length === 0) {
    if (vodSearchMode) {
      grid.innerHTML = '<div class="card muted-sm" style="grid-column:1/-1;text-align:center;padding:28px;">未搜到匹配的影片，请尝试缩短或更换关键词（如只输片名核心字）</div>';
    }
    return;
  }
  applySmartVodGridLayout(grid, list.length);
  grid.innerHTML = list.map((m, idx) => {
    const rateBadge = m.rate ? `⭐ ${m.rate}` : (m.remarks || '');
    const cls = classifyMovieTypeClient(m);
    const isPlaying = idx === activeVodMovieIdx;
    const totalCnt = (m.sources || []).length;
    return `
    <div class="vod-card ${isPlaying ? 'playing' : ''}" onclick="openVodMovie(${idx})">
      <div class="vod-poster-wrap">
        <img src="${escapeHtml(m.pic)}" alt="${escapeHtml(m.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity='0.2'">
        ${isPlaying ? '<span class="vod-playing-pill">▶ 正在播放</span>' : ''}
        ${rateBadge ? `<span class="vod-remarks-tag">${escapeHtml(rateBadge)}</span>` : ''}
        <span class="vod-lines-tag">⚡ ${totalCnt}条路线</span>
      </div>
      <div class="vod-card-info">
        <div class="vod-card-title" title="${escapeHtml(m.title)}">${escapeHtml(m.title)}</div>
        <div class="vod-card-sub">${escapeHtml([cls.label, m.year, m.remarks && m.rate ? m.remarks : ''].filter(Boolean).join(' · '))}</div>
      </div>
    </div>`;
  }).join('');
}

async function runVodSearch() {
  const input = document.getElementById('vodSearchInput');
  const wd = (input?.value || '').trim();
  if (wd.length < 2) {
    showToast('请至少输入 2 个字再搜索', 2400);
    input?.focus();
    return;
  }

  const token = localStorage.getItem('tvbox_token');
  if (!token) {
    showToast(`登录后即可全网搜片与短剧（注册即送 ${currentTrialDays} 天免费试用）`, 3200);
    openAuthModal(false);
    return;
  }

  const btn = document.getElementById('vodSearchBtn');
  const resetBtn = document.getElementById('vodSearchResetBtn');
  const banner = document.getElementById('vodSearchBanner');
  const bannerTxt = document.getElementById('vodSearchBannerText');
  const grid = document.getElementById('vodHotGrid');

  if (btn) { btn.disabled = true; btn.textContent = '搜片中...'; }
  if (grid) {
    grid.innerHTML = `<div class="card muted-sm" style="grid-column:1/-1;text-align:center;padding:28px;">🔍 正在全平台并发检索「${escapeHtml(wd)}」...</div>`;
  }

  try {
    const res = await fetch(API_BASE + '/api/vod-search?wd=' + encodeURIComponent(wd), {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    if (res.status === 401) {
      showToast(data.error || '请重新登录后再搜索', 3000);
      openAuthModal(false);
      renderVodHotGrid();
      return;
    }
    if (!res.ok) {
      showToast(data.error || '搜索失败，请稍后重试', 3000);
      renderVodHotGrid();
      return;
    }

    if (data.previewMinutes !== undefined) {
      vodPreviewMinutes = Number(data.previewMinutes);
      updateVodPreviewRuleText();
    }
    vodSearchMode = true;
    vodSearchKeyword = wd;
    vodSearchResults = Array.isArray(data.movies) ? data.movies : [];
    activeVodMovieIdx = -1;

    if (resetBtn) resetBtn.classList.remove('hidden');
    if (banner) banner.classList.remove('hidden');
    if (bannerTxt) {
      const cacheTag = data.cached ? ' · 秒级缓存' : '';
      bannerTxt.textContent = `🔍 「${wd}」共找到 ${vodSearchResults.length} 部影片/短剧（全平台完整收录）${cacheTag}`;
    }
    renderVodHotGrid();
  } catch (e) {
    showToast('搜索网络异常，请稍后重试', 2800);
    renderVodHotGrid();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '搜片'; }
  }
}

function exitVodSearchMode() {
  vodSearchMode = false;
  vodSearchKeyword = '';
  vodSearchResults = [];
  activeVodMovieIdx = -1;
  const input = document.getElementById('vodSearchInput');
  if (input) input.value = '';
  document.getElementById('vodSearchResetBtn')?.classList.add('hidden');
  document.getElementById('vodSearchBanner')?.classList.add('hidden');
  renderVodHotGrid();
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
    renderVodHotGrid();
    if (document.getElementById('view-speed')?.classList.contains('active')) {
      scheduleSilentSiteCalibration(false);
    }
  } catch (e) {
    grid.innerHTML = '<div class="card muted-sm" style="grid-column:1/-1;text-align:center;padding:24px;">热门影片加载失败，请稍后刷新</div>';
  }
}

function getSortedMovieSourcesForWeb(movie) {
  return [...(movie.sources || [])]
    .map((src, idx) => ({
      ...src,
      rawKey: src.rawKey || stripSiteKeyMaskClient(src.siteKey),
      _defaultRank: Number(src.defaultRank || (idx + 1))
    }))
    .sort((a, b) => compareForWeb(a.rawKey, b.rawKey, a._defaultRank, b._defaultRank));
}

function resortActiveMovieSourcesForWeb() {
  if (!activeVodMovie || !Array.isArray(activeVodMovie.sortedSources)) return;
  activeVodMovie.sortedSources.sort((a, b) => compareForWeb(a.rawKey, b.rawKey, a._defaultRank || 9999, b._defaultRank || 9999));
  const newIdx = activeVodMovie.sortedSources.findIndex(s => s.siteKey === activeVodSiteKey);
  if (newIdx >= 0) activeVodSourceIdx = newIdx;
}

function inspectRealNetworkTransfer(fragUrl, fallbackBytes, fallbackMs) {
  let realBytes = Number(fallbackBytes || 0);
  let realMs = Number(fallbackMs || 0);

  if (fragUrl && typeof performance !== 'undefined' && typeof performance.getEntriesByName === 'function') {
    const entries = performance.getEntriesByName(fragUrl);
    if (entries && entries.length > 0) {
      const ent = entries[entries.length - 1];
      if (typeof ent.transferSize === 'number') {
        if (ent.transferSize === 0 && (ent.decodedBodySize > 0 || ent.duration < 80)) {
          return { valid: false, reason: 'browser_cache' };
        }
        if (ent.transferSize > 0) realBytes = ent.transferSize;
      }
      if (ent.responseEnd > 0 && ent.requestStart > 0 && ent.responseEnd > ent.requestStart) {
        realMs = ent.responseEnd - ent.requestStart;
      }
    }
  }
  if (realBytes < 64 * 1024) return { valid: false, reason: 'too_small' };
  const safeMs = Math.max(15, realMs);
  let speedMBs = (realBytes / (1024 * 1024)) / (safeMs / 1000);
  if (safeMs < 25 && speedMBs > 25) return { valid: false, reason: 'fast_local_cache' };
  speedMBs = Math.min(35, Math.max(0.05, speedMBs));
  return { valid: true, speedMBs, realBytes, realMs: safeMs };
}

function recordVodNetworkSample(rawKey, speedMBs, latencyMs, weight = 1.0, isSeek = false) {
  const rk = stripSiteKeyMaskClient(rawKey);
  if (!rk) return;
  let bucket = vodSpeedSamplesMap.get(rk);
  if (!bucket) {
    bucket = { samples: [], avgSpeedMBs: 0, avgLatencyMs: 9999 };
    vodSpeedSamplesMap.set(rk, bucket);
  }
  bucket.samples.push({
    speedMBs: Number(speedMBs),
    latencyMs: Math.max(10, Math.round(Number(latencyMs || 100))),
    weight: Number(weight || 1.0),
    isSeek: Boolean(isSeek),
    ts: Date.now()
  });
  if (bucket.samples.length > 8) bucket.samples.shift();

  let calcList = [...bucket.samples];
  if (calcList.length >= 4) {
    calcList.sort((a, b) => a.speedMBs - b.speedMBs);
    calcList.pop();
    if (calcList.length >= 4) calcList.shift();
  }
  let wSum = 0, spdSum = 0, latSum = 0;
  for (const it of calcList) {
    wSum += it.weight;
    spdSum += it.speedMBs * it.weight;
    latSum += it.latencyMs * it.weight;
  }
  bucket.avgSpeedMBs = wSum > 0 ? (spdSum / wSum) : speedMBs;
  bucket.avgLatencyMs = wSum > 0 ? Math.round(latSum / wSum) : Math.round(latencyMs);

  setSiteMetric(rk, {
    webState: 'ok',
    speedMBs: Number(bucket.avgSpeedMBs.toFixed(2)),
    latencyMs: bucket.avgLatencyMs
  });
  persistPersonalVodState();
  autoSyncUserOrderQuietly();
  renderSiteList();
  renderVodLinePillsOnly();
}

function renderVodLinePillsOnly() {
  if (!activeVodMovie) return;
  const sources = activeVodMovie.sortedSources || [];
  const lineBox = document.getElementById('vodLinePills');
  if (!lineBox) return;

  const tagRank = document.getElementById('optTagRank')?.checked ?? true;
  let webRank = 0;
  let corsCount = 0;

  lineBox.innerHTML = sources.map((s) => {
    const isCur = s.siteKey === activeVodSiteKey;
    const m = getSiteMetric(s.rawKey);
    const bucket = vodSpeedSamplesMap.get(s.rawKey);
    const baseName = cleanBaseSiteName(s.siteName);

    let displayTitle = baseName;
    let tag = '';
    let extraCls = '';

    if (s._liveState === 'testing') {
      tag = ' · 连接中…';
    } else if (s._liveState === 'seeking') {
      webRank++;
      if (tagRank) displayTitle = `${baseName}${String(webRank).padStart(2, '0')}`;
      tag = m.speedMBs > 0 ? ` · ${m.speedMBs.toFixed(1)}M/s(校准中)` : ' · 拖动测速中…';
    } else if (m.webState === 'ok') {
      webRank++;
      if (tagRank) displayTitle = `${baseName}${String(webRank).padStart(2, '0')}`;
      tag = m.speedMBs > 0 ? ` · ${m.speedMBs.toFixed(1)}M/s` : (m.latencyMs < 9000 ? ` · ${m.latencyMs}ms` : ' · 流畅');
    } else if (m.webState === 'web_ready') {
      webRank++;
      if (tagRank) displayTitle = `${baseName}${String(webRank).padStart(2, '0')}`;
      tag = m.probeMs < 9000 ? ` · ${m.probeMs}ms` : ' · 网页可播';
    } else if (m.webState === 'cors') {
      corsCount++;
      tag = ' · 📺仅电视';
      extraCls = ' cors-only';
    } else if (m.webState === 'timeout') {
      tag = ' · 超时';
      extraCls = ' failed';
    }

    const hint = bucket && bucket.samples.length > 0
      ? `个人已采样 ${bucket.samples.length} 个真实网络切片（已剔除本地缓存）`
      : (m.webState === 'cors' ? '浏览器跨域受限，导入 TVBox 电视端可直接畅看' : '点击播放自动按您家宽带测速排序');

    return `<button type="button" title="${hint}" class="live-ch-pill ${isCur ? 'active' : ''}${extraCls}" onclick="selectVodSourceByKey('${escapeHtml(s.siteKey)}', true)">${escapeHtml(displayTitle)}${tag}</button>`;
  }).join('');

  const tvHint = document.getElementById('vodTvboxOnlyHint');
  if (tvHint) {
    tvHint.textContent = corsCount > 0
      ? `共 ${sources.length} 条路线（末尾 ${corsCount} 条浏览器受限，TVBox 电视端全部可用）`
      : `共 ${sources.length} 条路线（均已按您家宽带排序）`;
  }
}

function openVodMovie(idx) {
  if (typeof stopFreeLivePlayer === 'function') stopFreeLivePlayer();
  if (typeof stopTutorialVideo === 'function') stopTutorialVideo();
  const m = getCurrentVodList()[idx];
  if (!m) return;
  activeVodMovieIdx = idx;

  const sources = getSortedMovieSourcesForWeb(m);
  activeVodMovie = { ...m, sortedSources: sources };
  activeVodSourceIdx = 0;
  activeVodSiteKey = sources[0]?.siteKey || '';
  activeVodEpIdx = 0;

  const cls = classifyMovieTypeClient(m);
  document.getElementById('vodModalTitle').textContent = m.title;
  document.getElementById('vodModalMeta').textContent = [cls.label, m.year, m.remarks].filter(Boolean).join(' · ') || '高清路线';
  document.getElementById('vodModalBlurb').textContent = m.blurb || '全平台完整保留：网页端优先为您起播高速路线，遇浏览器跨域受限自动无缝切换，并在您的个人设备记录最优排序。';
  document.getElementById('vodLimitOverlay')?.classList.add('hidden');
  document.getElementById('vodTvOnlyOverlay')?.classList.add('hidden');

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

  const stage = document.getElementById('vodInlineStage');
  if (stage) {
    stage.classList.remove('hidden');
    stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  renderVodHotGrid();
  renderVodSelectorsAndPlay(true, new Set());
}

function renderVodSelectorsAndPlay(allowAutoRelay = true, triedRawKeys = new Set()) {
  if (!activeVodMovie) return;
  const sources = activeVodMovie.sortedSources || [];
  if (sources.length === 0) {
    const lineBox = document.getElementById('vodLinePills');
    if (lineBox) lineBox.innerHTML = '<span class="muted-sm">该影片暂无可用播放路线。</span>';
    return;
  }

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
    playVodStreamUrl(eps[activeVodEpIdx].url, curSrc, allowAutoRelay, triedRawKeys);
  }
}

function selectVodSourceByKey(siteKey, isManualClick = false) {
  resortActiveMovieSourcesForWeb();
  activeVodSiteKey = siteKey;
  const curSrc = activeVodMovie?.sortedSources?.find(s => s.siteKey === siteKey);
  const m = curSrc ? getSiteMetric(curSrc.rawKey) : null;
  const allowRelay = !(isManualClick && m && m.webState === 'cors');
  renderVodSelectorsAndPlay(allowRelay, new Set());
}

function selectVodSource(idx) {
  const s = activeVodMovie?.sortedSources?.[idx];
  if (s) selectVodSourceByKey(s.siteKey, true);
}

function selectVodEpisode(idx) {
  activeVodEpIdx = idx;
  renderVodSelectorsAndPlay(true, new Set());
}

function playVodStreamUrl(streamUrl, srcObj, allowAutoRelay = true, triedRawKeys = new Set()) {
  const video = document.getElementById('vodVideoPlayer');
  const overlay = document.getElementById('vodLimitOverlay');
  const tvOnlyOverlay = document.getElementById('vodTvOnlyOverlay');
  if (!video || !srcObj) return;
  overlay?.classList.add('hidden');
  tvOnlyOverlay?.classList.add('hidden');

  const siteKey = srcObj.siteKey;
  const rawKey = srcObj.rawKey || stripSiteKeyMaskClient(siteKey);
  triedRawKeys.add(rawKey);

  if (vodLoadTimer) { clearTimeout(vodLoadTimer); vodLoadTimer = null; }
  if (activeVodHls) { activeVodHls.destroy(); activeVodHls = null; }
  video.pause();
  video.onerror = null;
  video.onloadedmetadata = null;
  video.removeAttribute('src');

  (activeVodMovie?.sortedSources || []).forEach(s => { s._liveState = ''; });
  srcObj._liveState = 'testing';
  renderVodLinePillsOnly();

  const startTs = performance.now();
  let connected = false;
  let handledFailure = false;
  let lastSeekTs = 0;
  let seekPending = false;

  const handleFailureAndRelay = async (isTimeout) => {
    if (connected || handledFailure) return;
    handledFailure = true;
    if (vodLoadTimer) { clearTimeout(vodLoadTimer); vodLoadTimer = null; }
    if (activeVodHls) { activeVodHls.destroy(); activeVodHls = null; }
    srcObj._liveState = '';

    let finalState = 'timeout';
    let probeMs = 9999;
    if (!isTimeout) {
      const tProbe = performance.now();
      try {
        await fetch(streamUrl, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(3000) });
        finalState = 'cors';
        probeMs = Math.max(15, Math.round(performance.now() - tProbe));
      } catch (e) {
        finalState = 'timeout';
        probeMs = 9999;
      }
    }

    setSiteMetric(rawKey, {
      webState: finalState,
      speedMBs: 0,
      probeMs
    });
    persistPersonalVodState();
    autoSyncUserOrderQuietly();
    renderSiteList();
    resortActiveMovieSourcesForWeb();
    renderVodLinePillsOnly();

    if (allowAutoRelay && triedRawKeys.size < 6 && activeVodMovie) {
      const nextCandidate = activeVodMovie.sortedSources.find(s => {
        if (triedRawKeys.has(s.rawKey)) return false;
        const sm = getSiteMetric(s.rawKey);
        return sm.webState !== 'cors' && sm.webState !== 'timeout';
      });
      if (nextCandidate) {
        const failedBase = cleanBaseSiteName(srcObj.siteName);
        const nextBase = cleanBaseSiteName(nextCandidate.siteName);
        showToast(
          finalState === 'cors'
            ? `${failedBase} 浏览器受限(电视端可用)，已自动切至 ${nextBase}…`
            : `${failedBase} 连接超时，已自动切至 ${nextBase}…`,
          2400
        );
        activeVodSiteKey = nextCandidate.siteKey;
        renderVodSelectorsAndPlay(true, triedRawKeys);
        return;
      }
    }

    if (finalState === 'cors' && tvOnlyOverlay) {
      const titleEl = document.getElementById('vodTvOnlyTitle');
      if (titleEl) {
        titleEl.textContent = `${cleanBaseSiteName(srcObj.siteName)} 受浏览器跨域限制，TVBox 电视端畅看`;
      }
      tvOnlyOverlay.classList.remove('hidden');
    } else {
      showToast(`${cleanBaseSiteName(srcObj.siteName)} 连接超时，请切换其他路线或在 TVBox 电视端播放`, 3200);
    }
  };

  const markConnected = (fallbackLatencyMs) => {
    if (!connected) {
      connected = true;
      if (vodLoadTimer) { clearTimeout(vodLoadTimer); vodLoadTimer = null; }
      srcObj._liveState = '';
      const prev = getSiteMetric(rawKey);
      if (prev.webState !== 'ok') {
        setSiteMetric(rawKey, {
          webState: 'ok',
          latencyMs: Math.round(fallbackLatencyMs)
        });
        persistPersonalVodState();
        autoSyncUserOrderQuietly();
        renderSiteList();
      }
      renderVodLinePillsOnly();
    }
  };

  vodLoadTimer = setTimeout(() => {
    if (!connected) {
      handleFailureAndRelay(true);
    }
  }, 7500);

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
      overlay?.classList.remove('hidden');
    }
  };

  video.onseeking = () => {
    if (limitSec > 0 && video.currentTime > limitSec) {
      video.currentTime = Math.max(0, limitSec - 1);
      showToast(`游客最多可试看前 ${vodPreviewMinutes} 分钟，开通会员不限时！`);
      return;
    }
    lastSeekTs = performance.now();
    seekPending = true;
    srcObj._liveState = 'seeking';
    renderVodLinePillsOnly();
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
    hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
      const now = performance.now();
      const baseLat = manifestLatency || Math.max(10, Math.round(now - startTs));
      markConnected(baseLat);

      const frag = data?.frag || {};
      const st = frag.stats || data?.stats || {};
      const fallbackBytes = st.loaded || st.total || 0;
      const fallbackMs = Math.max(15, (st.loading?.end || now) - (st.loading?.start || startTs));

      const check = inspectRealNetworkTransfer(frag.url, fallbackBytes, fallbackMs);
      if (!check.valid) {
        if (srcObj._liveState === 'seeking') {
          srcObj._liveState = '';
          renderVodLinePillsOnly();
        }
        return;
      }
      const isSeekBurst = seekPending && (now - lastSeekTs <= 10000);
      const sampleLatency = isSeekBurst ? Math.max(15, Math.round(now - lastSeekTs)) : baseLat;
      const weight = isSeekBurst ? 2.0 : 1.0;
      if (isSeekBurst) seekPending = false;
      srcObj._liveState = '';
      recordVodNetworkSample(rawKey, check.speedMBs, sampleLatency, weight, isSeekBurst);
    });
    hls.on(Hls.Events.ERROR, (_, errData) => {
      if (errData.fatal) {
        const isTimeout = errData.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT || errData.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT;
        handleFailureAndRelay(isTimeout);
      }
    });
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
  } else if (canNativeHls) {
    video.src = streamUrl;
    video.onloadedmetadata = () => {
      markConnected(Math.max(10, Math.round(performance.now() - startTs)));
      tryPlay();
    };
    video.onerror = () => handleFailureAndRelay(false);
    tryPlay();
  } else {
    video.src = streamUrl;
    video.onloadedmetadata = () => {
      markConnected(Math.max(10, Math.round(performance.now() - startTs)));
      tryPlay();
    };
    video.onerror = () => handleFailureAndRelay(false);
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
  activeVodMovieIdx = -1;
  document.getElementById('vodInlineStage')?.classList.add('hidden');
  document.getElementById('vodTvOnlyOverlay')?.classList.add('hidden');
  renderVodHotGrid();
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

// ================= 安装大全：品牌搜索与设备分类筛选 =================
function filterBrandGuides() {
  const q = (document.getElementById('brandGuideSearch')?.value || '').trim().toLowerCase();
  const activeCatBtn = document.querySelector('#brandCatTabs .seg-btn.active');
  const cat = activeCatBtn ? activeCatBtn.dataset.bcat : 'all';
  const items = document.querySelectorAll('#brandGuideList .brand-item');
  items.forEach(el => {
    const itemCat = el.dataset.bcat || '';
    const kw = ((el.dataset.keywords || '') + ' ' + (el.querySelector('summary')?.textContent || '')).toLowerCase();
    const catOk = (cat === 'all' || itemCat === cat);
    const qOk = (!q || kw.includes(q));
    el.classList.toggle('hidden', !(catOk && qOk));
    if (q && catOk && qOk) el.open = true;
  });
}


// ================= 专属邀请裂变海报生成（纯前端 Canvas 高清合成，支持微信长按保存/转发） =================
let activeInvitePosterMeta = null;
let activePosterTheme = 'cinema';
let activePosterDataUrl = '';

function drawRoundedRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function generateLocalQrCanvas(text, size = 240) {
  return new Promise((resolve) => {
    if (typeof QRCode !== 'undefined') {
      try {
        const tmp = document.createElement('div');
        tmp.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;';
        document.body.appendChild(tmp);
        new QRCode(tmp, {
          text,
          width: size,
          height: size,
          colorDark: '#0f172a',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
        setTimeout(() => {
          const qrCanvas = tmp.querySelector('canvas');
          const qrImg = tmp.querySelector('img');
          if (qrCanvas) {
            const copyC = document.createElement('canvas');
            copyC.width = qrCanvas.width;
            copyC.height = qrCanvas.height;
            copyC.getContext('2d').drawImage(qrCanvas, 0, 0);
            tmp.remove();
            resolve(copyC);
            return;
          }
          if (qrImg && qrImg.src) {
            const img = new Image();
            img.onload = () => { tmp.remove(); resolve(img); };
            img.onerror = () => { tmp.remove(); resolve(null); };
            img.src = qrImg.src;
            return;
          }
          tmp.remove();
          resolve(null);
        }, 60);
        return;
      } catch (e) {}
    }
    // 兜底远程二维码（带 anonymous CORS，避免污染 Canvas）
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
  });
}

async function renderInvitePosterImage(themeKey = 'cinema') {
  if (!activeInvitePosterMeta) return;
  activePosterTheme = themeKey;

  const loadingEl = document.getElementById('invitePosterLoading');
  const imgEl = document.getElementById('invitePosterImg');
  if (loadingEl) { loadingEl.textContent = '正在合成高清专属海报...'; loadingEl.classList.remove('hidden'); }
  if (imgEl) imgEl.classList.add('hidden');

  const { invUrl, invCode, rewardDays } = activeInvitePosterMeta;
  const trialDays = Number(currentTrialDays || 7);
  const liveCnt = Number(currentLiveCount || 49);
  const vodCnt = Number(currentVodCount || 21);

  const palettes = {
    cinema: {
      bgTop: '#070d1f',
      bgMid: '#0f1f44',
      bgBot: '#091124',
      glow1: 'rgba(59, 130, 246, 0.36)',
      glow2: 'rgba(16, 185, 129, 0.24)',
      accentText: '#38bdf8',
      ribbonStart: '#2563eb',
      ribbonEnd: '#06b6d4',
      cardBg: 'rgba(15, 23, 42, 0.72)',
      cardBorder: 'rgba(96, 165, 250, 0.28)',
      qrAccent: '#2563eb'
    },
    gold: {
      bgTop: '#24090d',
      bgMid: '#451218',
      bgBot: '#1b070a',
      glow1: 'rgba(245, 158, 11, 0.34)',
      glow2: 'rgba(239, 68, 68, 0.26)',
      accentText: '#fcd34d',
      ribbonStart: '#d97706',
      ribbonEnd: '#f59e0b',
      cardBg: 'rgba(44, 14, 18, 0.76)',
      cardBorder: 'rgba(251, 191, 36, 0.34)',
      qrAccent: '#b45309'
    }
  };
  const pal = palettes[themeKey] || palettes.cinema;

  const W = 750;
  const H = 1180;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const fontStack = '"PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, sans-serif';

  // 1. 背景深色渐变
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, pal.bgTop);
  bgGrad.addColorStop(0.5, pal.bgMid);
  bgGrad.addColorStop(1, pal.bgBot);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // 2. 氛围光晕装饰
  const g1 = ctx.createRadialGradient(140, 140, 20, 140, 140, 380);
  g1.addColorStop(0, pal.glow1);
  g1.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);

  const g2 = ctx.createRadialGradient(640, 680, 20, 640, 680, 360);
  g2.addColorStop(0, pal.glow2);
  g2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);

  // 3. 顶部品牌徽章
  drawRoundedRectPath(ctx, 185, 58, 380, 50, 25);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8fafc';
  ctx.font = `700 23px ${fontStack}`;
  ctx.fillText('📺  TVBox 电视影视 · tv.171234.xyz', W / 2, 83);

  // 4. 主标题（高转化大字）
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 58px ${fontStack}`;
  ctx.fillText('告别电视套娃收费', W / 2, 182);

  ctx.fillStyle = pal.accentText;
  ctx.font = `800 40px ${fontStack}`;
  ctx.fillText('一链畅看全网 4K 大片 & 央卫视', W / 2, 248);

  // 5. 福利横幅（免费试用 + 双方各送会员天数）
  drawRoundedRectPath(ctx, 56, 304, W - 112, 118, 22);
  const ribGrad = ctx.createLinearGradient(56, 304, W - 56, 422);
  ribGrad.addColorStop(0, pal.ribbonStart);
  ribGrad.addColorStop(1, pal.ribbonEnd);
  ctx.fillStyle = ribGrad;
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = `900 34px ${fontStack}`;
  ctx.fillText(`🎁 扫码免费领 ${trialDays} 天全功能试用`, W / 2, 345);
  ctx.font = `700 23px ${fontStack}`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
  const subBonus = rewardDays > 0
    ? `通过好友邀请开通任意套餐 · 双方再各送 ${rewardDays} 天会员`
    : '注册即领专属超短地址 · 电视/盒子/手机全通用';
  ctx.fillText(subBonus, W / 2, 390);

  // 6. 三大核心卖点卡片
  const perks = [
    { icon: '🎬', title: `${vodCnt} 条高速 4K 点播路线`, sub: '全网电影/热剧/动漫/短剧随心搜 · 手机网页直接播' },
    { icon: '📡', title: `${liveCnt} 台高清央卫视直播`, sub: '毫秒切台 · 多源自动测速维护 · 告别失效卡顿' },
    { icon: '⚡', title: '超短地址 3 分钟装好', sub: '支持小米/华为/海信/TCL/创维电视、盒子与手机' }
  ];

  let curY = 454;
  for (const pk of perks) {
    drawRoundedRectPath(ctx, 56, curY, W - 112, 102, 18);
    ctx.fillStyle = pal.cardBg;
    ctx.fill();
    ctx.strokeStyle = pal.cardBorder;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = `40px ${fontStack}`;
    ctx.fillText(pk.icon, 112, curY + 52);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#f8fafc';
    ctx.font = `800 27px ${fontStack}`;
    ctx.fillText(pk.title, 158, curY + 38);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = `500 21px ${fontStack}`;
    ctx.fillText(pk.sub, 158, curY + 72);

    curY += 118;
  }

  // 7. 底部白色二维码卡片（确保微信/相机 100% 秒识别）
  const cardTop = 830;
  const cardH = 294;
  drawRoundedRectPath(ctx, 56, cardTop, W - 112, cardH, 26);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // 绘制二维码
  const qrSource = await generateLocalQrCanvas(invUrl, 230);
  const qrBoxX = 88;
  const qrBoxY = cardTop + 32;
  const qrSize = 230;

  if (qrSource) {
    ctx.drawImage(qrSource, qrBoxX, qrBoxY, qrSize, qrSize);
  } else {
    drawRoundedRectPath(ctx, qrBoxX, qrBoxY, qrSize, qrSize, 12);
    ctx.fillStyle = '#f1f5f9';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#64748b';
    ctx.font = `700 20px ${fontStack}`;
    ctx.fillText('二维码生成失败', qrBoxX + qrSize / 2, qrBoxY + qrSize / 2);
  }

  // 右侧引导文案
  const rx = 346;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0f172a';
  ctx.font = `900 32px ${fontStack}`;
  ctx.fillText('长按识别二维码', rx, cardTop + 72);

  ctx.fillStyle = pal.qrAccent;
  ctx.font = `800 25px ${fontStack}`;
  ctx.fillText(`立领 ${trialDays} 天免费全功能试用`, rx, cardTop + 116);

  // 邀请码胶囊
  drawRoundedRectPath(ctx, rx, cardTop + 144, 314, 46, 12);
  ctx.fillStyle = '#f1f5f9';
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.font = `700 22px ${fontStack}`;
  ctx.fillText(`专属邀请码：${invCode}`, rx + 16, cardTop + 167);

  // 微信打开小提示（防拦截）
  ctx.fillStyle = '#64748b';
  ctx.font = `500 19px ${fontStack}`;
  ctx.fillText('微信扫码若提示非官方页面，', rx, cardTop + 224);
  ctx.fillText('点右上角「浏览器打开」即可畅享', rx, cardTop + 252);

  // 底部小字网址
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(226, 232, 240, 0.58)';
  ctx.font = `600 19px ${fontStack}`;
  ctx.fillText('官网直达：https://tv.171234.xyz  ·  云端自动维护', W / 2, H - 26);

  try {
    activePosterDataUrl = canvas.toDataURL('image/png');
    if (imgEl) {
      imgEl.src = activePosterDataUrl;
      imgEl.classList.remove('hidden');
    }
    if (loadingEl) loadingEl.classList.add('hidden');
  } catch (e) {
    if (loadingEl) loadingEl.textContent = '海报合成受浏览器限制，请点击下方「复制推广文案」分享';
  }
}

function openInvitePosterModal(meta) {
  activeInvitePosterMeta = meta;
  const modal = document.getElementById('invitePosterModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  // 绑定风格切换按钮
  document.querySelectorAll('#posterThemeTabs .poster-theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ptheme === activePosterTheme);
    btn.onclick = () => {
      document.querySelectorAll('#posterThemeTabs .poster-theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderInvitePosterImage(btn.dataset.ptheme);
    };
  });

  // 绑定下载图片按钮
  const dlBtn = document.getElementById('downloadPosterBtn');
  if (dlBtn) {
    dlBtn.onclick = () => {
      if (!activePosterDataUrl) { showToast('海报尚未生成完成'); return; }
      const a = document.createElement('a');
      a.href = activePosterDataUrl;
      a.download = `TVBox邀请海报_${meta.invCode}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast('✅ 海报已开始下载（手机端也可直接长按图片保存）', 2800);
    };
  }

  // 绑定一键复制推广文案按钮
  const copyTxtBtn = document.getElementById('copyPosterTextBtn');
  if (copyTxtBtn) {
    copyTxtBtn.onclick = () => {
      const trialDays = Number(currentTrialDays || 7);
      const rewardTxt = meta.rewardDays > 0 ? `开通任意套餐你我还能各白嫖 ${meta.rewardDays} 天！` : '';
      const text = `推荐一个超好用的电视/手机看片神器！告别各种电视套娃会员，全网4K电影/电视剧/短剧随心搜着看 + ${currentLiveCount}台高清央卫视直播！点我专属链接注册直接领 ${trialDays} 天免费试用，${rewardTxt} 👉 ${meta.invUrl}`;
      copyText(text, copyTxtBtn);
    };
  }

  renderInvitePosterImage(activePosterTheme);
}
