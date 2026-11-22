(() => {
  // 1. 从 tv.txt 同步的全部 21 个点播资源站
  const VOD_SITES = [
    { key: "非凡资源", name: "非凡", api: "https://api.ffzyapi.com/api.php/provide/vod/" },
    { key: "量子资源", name: "量子", api: "https://cj.lziapi.com/api.php/provide/vod/" },
    { key: "暴风资源", name: "暴风", api: "https://bfzyapi.com/api.php/provide/vod/" },
    { key: "红牛资源", name: "红牛", api: "https://www.hongniuzy2.com/api.php/provide/vod/" },
    { key: "极速资源", name: "极速", api: "https://jszyapi.com/api.php/provide/vod/" },
    { key: "光速资源", name: "光速", api: "https://api.guangsuapi.com/api.php/provide/vod/" },
    { key: "金鹰资源", name: "金鹰", api: "https://jyzyapi.com/provide/vod/" },
    { key: "新浪资源", name: "新浪", api: "https://api.xinlangapi.com/xinlangapi.php/provide/vod/" },
    { key: "闪电资源", name: "闪电", api: "https://xsd.sdzyapi.com/api.php/provide/vod/" },
    { key: "魔都资源", name: "魔都", api: "https://www.mdzyapi.com/api.php/provide/vod/" },
    { key: "电影天堂", name: "电影天堂", api: "https://caiji.dyttzyapi.com/api.php/provide/vod/" },
    { key: "豪华资源", name: "豪华", api: "https://hhzyapi.com/api.php/provide/vod/" },
    { key: "无尽资源", name: "无尽", api: "https://api.wujinapi.me/api.php/provide/vod/" },
    { key: "速播资源", name: "速播", api: "https://subocj.com/api.php/provide/vod/" },
    { key: "如意资源", name: "如意", api: "https://cj.rycjapi.com/api.php/provide/vod/" },
    { key: "虎牙资源", name: "虎牙", api: "https://www.huyaapi.com/api.php/provide/vod/" },
    { key: "百度资源", name: "百度", api: "https://api.apibdzy.com/api.php/provide/vod/" },
    { key: "U酷资源", name: "U酷", api: "https://api.ukuapi88.com/api.php/provide/vod/" },
    { key: "ikun资源", name: "iKun", api: "https://ikunzyapi.com/api.php/provide/vod/" },
    { key: "索尼资源", name: "索尼", api: "https://suoniapi.com/api.php/provide/vod/" }
  ];

  // 配置项：指向你的切片样本接口（下文提供 Cloudflare Worker / Node 代码）
  const SAMPLES_API = "/api/vod-samples";
  const MAX_DL_BYTES = 1.5 * 1024 * 1024; // 单站最多拉取 1.5MB 切片
  const TIMEOUT_MS = 5000;                // 单站超时 5 秒
  const CONCURRENCY = 3;                  // 并发数设小(2~3)，避免互相抢占家庭宽带导致结果失真

  let siteState = VOD_SITES.map((s, idx) => ({
    ...s,
    rank: idx + 1,
    speedMBs: null,   // 真实下载速率 MB/s
    ttfbMs: null,     // 首帧延迟 ms
    status: "idle",   // idle | testing | ok | failed
    mode: ""          // stream | nocors | ping
  }));

  const elList = document.getElementById("siteList");
  const elStartBtn = document.getElementById("startSpeedTest");
  const elProgressWrap = document.getElementById("speedProgressWrap");
  const elProgressFill = document.getElementById("speedProgressFill");
  const elStatusText = document.getElementById("speedStatusText");
  const elCountText = document.getElementById("speedCountText");
  const elModeBadge = document.getElementById("speedModeBadge");
  const optTagRank = document.getElementById("optTagRank");
  const optShowSpeed = document.getElementById("optShowSpeed");
  const optHideFailed = document.getElementById("optHideFailed");

  // 格式化最终写入 TVBox 的名称
  function formatDisplayName(site, rankIndex) {
    if (site.status === "failed") return `❌ ${site.name}`;
    let label = site.name;
    if (optTagRank?.checked && site.status === "ok") {
      label = `${String(rankIndex).padStart(2, "0")}丨${label}`;
    }
    if (optShowSpeed?.checked && site.speedMBs > 0) {
      label += ` [${site.speedMBs.toFixed(1)}M/s]`;
    }
    return label;
  }

  // 渲染列表
  function renderList() {
    if (!elList) return;
    let validRank = 0;
    elList.innerHTML = siteState.map((s) => {
      if (s.status === "ok") validRank++;
      const displayTitle = formatDisplayName(s, s.status === "ok" ? validRank : s.rank);

      let metricHtml = `<span class="muted">待测速</span>`;
      if (s.status === "testing") {
        metricHtml = `<span style="color:#3b82f6;">拉流测速中...</span>`;
      } else if (s.status === "ok") {
        const cls = s.speedMBs >= 3 ? "speed-fast" : (s.speedMBs >= 1 ? "speed-mid" : "speed-slow");
        const speedText = s.speedMBs > 0 ? `${s.speedMBs.toFixed(2)} MB/s` : `可播`;
        metricHtml = `
          <div class="speed-val ${cls}">${speedText}</div>
          <div class="muted" style="font-size:12px;">起播 ${s.ttfbMs} ms</div>
        `;
      } else if (s.status === "failed") {
        metricHtml = `<span class="speed-slow">超时 / 不可用</span>`;
      }

      const badgeClass = (s.status === "ok" && validRank <= 3) ? "rank-badge top3" : "rank-badge";
      const badgeText = s.status === "ok" ? String(validRank).padStart(2, "0") : "--";

      return `
        <div class="site-card ${s.status}">
          <div class="site-title">
            <span class="${badgeClass}">${badgeText}</span>
            <span>${displayTitle}</span>
          </div>
          <div class="site-metrics">${metricHtml}</div>
        </div>
      `;
    }).join("");
  }

  // 核心：使用用户自家宽带直连切片 URL 测速
  async function measureSliceSpeed(tsUrl, knownBytes = 0) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const cacheBuster = (tsUrl.includes("?") ? "&" : "?") + "_t=" + Date.now();
    const start = performance.now();

    try {
      // 方案 A：支持 CORS 的视频 CDN，流式读取真实字节数（最精准）
      const resp = await fetch(tsUrl + cacheBuster, {
        mode: "cors",
        cache: "no-store",
        signal: controller.signal
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);

      const ttfbMs = Math.round(performance.now() - start);
      const reader = resp.body?.getReader();
      let downloaded = 0;
      const dlStart = performance.now();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          downloaded += value.byteLength;
          if (downloaded >= MAX_DL_BYTES) {
            controller.abort(); // 达标即停，省流量提速
            break;
          }
        }
      } else {
        const buf = await resp.arrayBuffer();
        downloaded = buf.byteLength;
      }

      const elapsedSec = Math.max((performance.now() - dlStart) / 1000, 0.05);
      const speedMBs = (downloaded / (1024 * 1024)) / elapsedSec;
      return { ok: true, speedMBs, ttfbMs, mode: "stream" };
    } catch (err) {
      if (err.name === "AbortError") {
        // 如果是因为达标主动 abort，不走降级；否则判定超时
        clearTimeout(timer);
        throw err;
      }
      // 方案 B：若该 CDN 限制 CORS，降级为 no-cors 整片下载计时（依然走用户宽带）
      const start2 = performance.now();
      await fetch(tsUrl + cacheBuster, {
        mode: "no-cors",
        cache: "no-store",
        signal: controller.signal
      });
      const totalMs = Math.max(performance.now() - start2, 50);
      // 若后端提供了切片大小则换算真实速率，否则按平均 1MB 切片估算
      const estBytes = knownBytes > 0 ? knownBytes : 1024 * 1024;
      const speedMBs = (estBytes / (1024 * 1024)) / (totalMs / 1000);
      return { ok: true, speedMBs, ttfbMs: Math.round(totalMs), mode: "nocors" };
    } finally {
      clearTimeout(timer);
    }
  }

  // 兜底：当样本接口暂未部署时，测接口连接延迟
  async function fallbackApiPing(apiUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const start = performance.now();
    try {
      await fetch(apiUrl + "?ac=list&_t=" + Date.now(), {
        mode: "no-cors",
        cache: "no-store",
        signal: controller.signal
      });
      const ttfbMs = Math.round(performance.now() - start);
      return { ok: true, speedMBs: 0, ttfbMs, mode: "ping" };
    } finally {
      clearTimeout(timer);
    }
  }

  // 排序：真实速度高的在前 -> 延迟低的在前 -> 失败的沉底
  function sortSites() {
    siteState.sort((a, b) => {
      if (a.status === "ok" && b.status !== "ok") return -1;
      if (a.status !== "ok" && b.status === "ok") return 1;
      if (b.speedMBs !== a.speedMBs) return (b.speedMBs || 0) - (a.speedMBs || 0);
      return (a.ttfbMs || 99999) - (b.ttfbMs || 99999);
    });
  }

  async function runSpeedTest() {
    elStartBtn.disabled = true;
    elStartBtn.textContent = "⏳ 正在拉流测速...";
    elProgressWrap.classList.remove("hidden");
    elProgressFill.style.width = "0%";

    // 重置状态
    siteState.forEach(s => {
      s.status = "idle";
      s.speedMBs = null;
      s.ttfbMs = null;
    });
    renderList();

    // 第 1 步：拉取后端缓存的 21 个站点最新 .ts 切片地址
    let samplesMap = {};
    try {
      elStatusText.textContent = "正在同步各站点最新影片切片地址...";
      const res = await fetch(SAMPLES_API);
      if (res.ok) {
        samplesMap = await res.json();
        elModeBadge.textContent = "测速模式：真实视频切片拉流 (MB/s)";
      } else {
        throw new Error("no samples api");
      }
    } catch {
      elModeBadge.textContent = "测速模式：接口延迟降级模式（未检测到切片样本接口）";
    }

    // 第 2 步：控制并发，逐批用用户宽带测速
    let finished = 0;
    const total = siteState.length;
    const queue = [...siteState];

    async function worker() {
      while (queue.length > 0) {
        const site = queue.shift();
        site.status = "testing";
        elStatusText.textContent = `正在测试：${site.name}...`;
        renderList();

        try {
          const sample = samplesMap[site.key];
          const res = sample?.tsUrl
            ? await measureSliceSpeed(sample.tsUrl, sample.size || 0)
            : await fallbackApiPing(site.api);

          site.status = "ok";
          site.speedMBs = res.speedMBs;
          site.ttfbMs = res.ttfbMs;
          site.mode = res.mode;
        } catch {
          site.status = "failed";
          site.speedMBs = 0;
          site.ttfbMs = 9999;
        }

        finished++;
        elCountText.textContent = `${finished} / ${total}`;
        elProgressFill.style.width = `${Math.round((finished / total) * 100)}%`;
        sortSites();
        renderList();
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    const okCount = siteState.filter(s => s.status === "ok").length;
    elStatusText.textContent = `测速完成！共 ${okCount} 个站点可用，已按自家宽带实测速度排序`;
    elStartBtn.disabled = false;
    elStartBtn.textContent = "⚡ 重新测速";
  }

  // 选项切换时实时预览名称变化
  [optTagRank, optShowSpeed].forEach(el => el?.addEventListener("change", renderList));
  elStartBtn?.addEventListener("click", runSpeedTest);

  // 暴露给 app.js：点击「保存为我的专属排序」时直接调用此方法获取提交数据
  window.VOD_SPEEDTEST = {
    getCustomOrderPayload() {
      let rank = 0;
      const hideFailed = optHideFailed?.checked ?? true;
      return siteState
        .filter(s => !(hideFailed && s.status === "failed"))
        .map(s => {
          if (s.status === "ok") rank++;
          return {
            key: s.key,
            customName: formatDisplayName(s, s.status === "ok" ? rank : 99),
            speedMBs: s.speedMBs,
            ttfbMs: s.ttfbMs
          };
        });
    }
  };

  renderList();
})();
