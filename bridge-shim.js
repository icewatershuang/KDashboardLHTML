/* =============================================================================
 * KDashBoardL — 浏览器桥接垫片 (Browser bridge shim)
 * -----------------------------------------------------------------------------
 * 原 APK 里所有网络 / 存储 / 设备能力都由一个叫 KindleBridge 的原生(Java)对象
 * 提供。本文件在纯浏览器环境里"模拟"它，让 assets/dashboard.html 这套 WebView
 * 前端无需改动即可作为静态网页运行：
 *
 *   · 网络  get()        -> fetch + HTTPS 公共 CORS 代理兜底
 *                          (这样即便是 http 的中国天气网、各 RSS 源在
 *                           GitHub Pages 的 https 源站下也能正常抓取，
 *                           不会触发 mixed-content / CORS 报错)
 *   · 存储  getPref/setPref -> localStorage
 *   · 设备  keepScreenOn / setOverlay / setWifiAlwaysOn / restart ... -> 安全空操作
 *
 * 同时重写 applyRotation()，强制「横版宽屏」版式并抵消 +90°/-90° 旋转对消，
 * 让 applyFit() 按窗口尺寸等比缩放出端正宽屏仪表盘。
 *
 * 该垫片必须在 dashboard.html 主体脚本之后、load 事件之前注入(放在 </body> 前)。
 * ========================================================================== */
(function () {
  "use strict";

  /* ---- Base64(URL-safe) 编码：与 dashboard.html 内的 _B64T 字母表一致 ---- */
  function b64encUtf8(str) {
    try {
      // btoa 只认 Latin-1；先按 UTF-8 字节化再编码
      return btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
      return "";
    }
  }
  function toUrlSafe(b64) {
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /* ---- 抓取一个 URL 的原文文本；直连优先，失败走 CORS 代理 ---- */
  var PROXIES = [
    function (u) {
      return "https://api.allorigins.win/raw?url=" + encodeURIComponent(u);
    },
    function (u) {
      return "https://corsproxy.io/?url=" + encodeURIComponent(u);
    }
  ];

  function fetchText(url, ms) {
    ms = ms || 15000;
    var controller = null, signal = null, timer = null;
    if (typeof AbortController !== "undefined") {
      controller = new AbortController();
      signal = controller.signal;
      timer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, ms);
    }
    function direct() {
      return fetch(url, { mode: "cors", signal: signal, cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.text();
      });
    }
    function viaProxy(i) {
      if (i >= PROXIES.length) return Promise.reject(new Error("all-proxies-failed"));
      return fetch(PROXIES[i](url), { signal: signal, cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("proxy " + r.status);
          return r.text();
        })
        .catch(function () { return viaProxy(i + 1); });
    }
    var p = direct().catch(function () { return viaProxy(0); });
    if (timer) {
      p = p.then(
        function (v) { clearTimeout(timer); return v; },
        function (err) { clearTimeout(timer); throw err; }
      );
    }
    return p;
  }

  /* ---- 模拟原生 KindleBridge ----
   * get(url, tok)：抓到文本后做 URL-safe Base64，回调 dashboard.html 的
   * __bridgeChunk(tok, idx, total, part)；对齐原始 Java 桥的回传协议。 */
  window.KindleBridge = {
    get: function (url, tok) {
      fetchText(url, 15000)
        .then(function (text) {
          var b = toUrlSafe(b64encUtf8(text || ""));
          if (typeof __bridgeChunk === "function") {
            __bridgeChunk(tok, 0, 1, b);
          } else if (window.__bridgeChunk) {
            window.__bridgeChunk(tok, 0, 1, b);
          }
        })
        .catch(function () {
          if (typeof __bridgeFail === "function") {
            __bridgeFail(tok);
          } else if (window.__bridgeFail) {
            window.__bridgeFail(tok);
          }
        });
    },

    getPref: function (k) {
      try {
        var v = localStorage.getItem(k);
        return v === null ? null : v;
      } catch (e) { return null; }
    },
    setPref: function (k, v) {
      try { localStorage.setItem(k, String(v)); return true; } catch (e) { return false; }
    },

    getVersion: function () { return "KDashBoardL Web 1.0 (browser build)"; },
    permStatus: function () { return "浏览器模式：无需安卓权限"; },
    wifiStatus: function () { return "—"; },

    keepScreenOn: function () {},
    setOverlay: function () {},
    setWifiAlwaysOn: function () {},

    requestBatteryWhitelist: function () { return false; },
    checkPerms: function () { return "浏览器模式：无需权限"; },
    requestWriteSettings: function () { return "浏览器模式：无需系统设置"; },

    restart: function () { try { location.reload(); } catch (e) {} },

    getDeviceModel: function () { return ""; },          /* 空 -> 不套用 H9 专属微调 */
    getFontScale: function () { return 1; },
    getViewInfo: function () {
      return (window.innerWidth || 1200) + "x" + (window.innerHeight || 825);
    },
    getViewW: function () { return window.innerWidth || 1200; },
    getViewH: function () { return window.innerHeight || 825; },
    setSettingsOpen: function () {}
  };

  /* ---- 强制横版宽屏版式 ---- */
  function forceLandscape() {
    try { window.ROT = 90; } catch (e) {}   /* 让 applyFit 走 LS_W/LS_H 宽屏路径 */
    var el = document.getElementById("mainPage");
    if (!el) return;
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.webkitTransform = "none";
    el.style.transform = "none";
    el.style.webkitTransformOrigin = "center center";
    el.style.transformOrigin = "center center";
    var cn = el.className || "";
    if ((" " + cn + " ").indexOf(" rot-land ") < 0) {
      el.className = (cn ? cn + " " : "") + "rot-land";
    }
    if ((" " + cn + " ").indexOf(" landscape ") < 0) {
      el.className = (el.className ? el.className + " " : "") + "landscape";
    }
  }
  /* ---- 按屏幕方向自适应版式 ----
   * 原版支持竖屏（ROT=0 竖版式）与横屏（ROT=90 宽版式）两套布局。
   * 此前垫片无条件强制横屏，手机竖着拿（宽高比 < 1）时就把横版版式
   * 硬塞进竖屏视口 —— 时钟爆大、新闻列挤出屏外、诗歌被裁。
   * 现在按视口方向分流：竖屏走原版竖版式（原样 applyRotation），
   * 横屏才强制宽版。旋转手机时 resize/orientationchange 会重新分流。 */
  var _origApplyRotation = window.applyRotation;   /* 原版函数（先存后覆盖） */
  function isPortraitView() {
    var w = window.innerWidth || 1, h = window.innerHeight || 1;
    return h > w;
  }
  /* 同名函数后定义者生效：覆盖 dashboard.html 内原本依赖 ROT 的 applyRotation */
  window.applyRotation = function () {
    if (isPortraitView()) {
      try { window.ROT = 0; } catch (e) {}
      if (typeof _origApplyRotation === "function") {
        try { _origApplyRotation(); } catch (eO) { forceLandscape(); }
      } else {
        forceLandscape();
      }
      /* 保险：竖屏时确保横屏标记被清掉（原版会清，这里兜底） */
      try {
        var _mp = document.getElementById("mainPage");
        if (_mp) {
          _mp.className = (" " + (_mp.className || "") + " ")
            .replace(" landscape ", " ").replace(" rot-land ", " ")
            .replace(/^\s+|\s+$/g, "");
        }
      } catch (eC) {}
    } else {
      forceLandscape();
    }
  };

  /* 抵消 .layout 自带的 rotate(-90deg) 对消(现在 #mainPage 不再 +90) */
  var st = document.createElement("style");
  st.type = "text/css";
  st.textContent =
    "#mainPage.landscape .layout{ -webkit-transform:none !important; transform:none !important; }\n";
  (document.head || document.documentElement).appendChild(st);

  /* boot 之后可能再跑一次 applyRotation，兜底按当前方向重打标记 */
  window.addEventListener("load", function () {
    try { window.applyRotation(); } catch (e) {}
    setTimeout(function () { try { window.applyRotation(); } catch (e) {} }, 300);
    setTimeout(function () { try { window.applyRotation(); } catch (e) {} }, 1300);
  });

  /* ================= v2 浏览器适配补丁 ================= */

  /* ---- 1) 窗口尺寸变化时重排 ----
   * 原版为水墨屏做了「缩放硬锁」：_bootK 只在第一次 applyFit 算出并冻结，
   * 之后即使窗口变小也沿用大窗口的 k → 内容溢出视口，底部按钮被裁、字超大。
   * 浏览器里窗口大小常变，这里在 resize / orientationchange 时清掉冻结值，
   * 让 applyFit 按当前视口重新计算。 */
  var _rzT = null;
  function refit() {
    try { window._bootK = 0; window._lockedK = 0; } catch (e) {}
    try { window.applyRotation(); } catch (e) {}
    try { if (typeof window.applyFit === "function") { window.applyFit({ force: true }); } } catch (e) {}
    relayoutNewsColumn();
  }
  /* ---- 1c) 铺满保险（fitGuard） ----
   * 桌面/仿真环境排版都精确贴合视口，但真机浏览器（字体放大、内核差异、
   * 系统字号）可能让实际渲染超出屏幕 —— 用户只能看到页面的一部分。
   * 这里在每轮排版后实测 document 的滚动尺寸：一旦真的超宽/超高，
   * 就对 body 施加整体 zoom 等比收缩到正好放满；不再溢出时自动复原。
   * zoom 是整页统一缩放，不破坏 APK 的相对比例。 */
  function fitGuard() {
    try {
      var mp = document.getElementById("mainPage");
      if (!mp || mp.style.display === "none") { return; }   /* 设置页打开时不动 */
      var doc = document.documentElement, body = document.body;
      if (!doc || !body) { return; }
      var vw = window.innerWidth || doc.clientWidth, vh = window.innerHeight || doc.clientHeight;
      var sw = Math.max(doc.scrollWidth || 0, body.scrollWidth || 0);
      var sh = Math.max(doc.scrollHeight || 0, body.scrollHeight || 0);
      var z = parseFloat(body.style.zoom) || 1;
      var f = 1;
      if (sw > vw + 2) { f = Math.min(f, (vw - 2) / sw); }
      if (sh > vh + 2) { f = Math.min(f, (vh - 2) / sh); }
      if (f < 0.98) {
        var target = z * f;
        if (target < 0.4) { target = 0.4; }
        body.style.zoom = String(target);
      } else if (z !== 1 && body.style.zoom) {
        body.style.zoom = "";       /* 已不溢出 -> 撤掉缩放，恢复原生排版 */
      }
    } catch (e) {}
  }
  /* ---- 1b) 右栏新闻列重排 ----
   * .cr-wrap 是 display:table（height 相当于最小值，内容能撑破容器）。
   * 大窗口启动时 fillNewsToHeight 塞满了新闻；缩小窗口后内容比盒子高，
   * 表格被撑到 1079px，而 clampNewsToHeight 量的又是这个被撑大的盒子
   * → 永远判定"没超高"、一条也不删，右栏整体溢出视口（底部裁切）。
   * 打破死锁：临时把 .cr-body 切成 block+hidden 的受控盒，让测量回归
   * 真实可用高度，裁完/填完再把 display/overflow 还原（全程同步执行，无闪烁）。 */
  function relayoutNewsColumn() {
    var run = function () {
      try {
        var body = document.querySelector(".cr-body");
        var prevD = null, prevO = null;
        if (body) {
          prevD = body.style.display; prevO = body.style.overflow;
          body.style.display = "block"; body.style.overflow = "hidden";
        }
        try { if (window.fitPagerBottom) { window.fitPagerBottom(); } } catch (e1) {}
        try { if (window.fitNewsToList) { window.fitNewsToList(); } } catch (e2) {}
        try { if (window.clampNewsToHeight) { window.clampNewsToHeight(); } } catch (e3) {}
        try { if (window.fillNewsToHeight) { window.fillNewsToHeight(); } } catch (e4) {}
        try { if (window.refreshPageInfo) { window.refreshPageInfo(); } } catch (e5) {}
        if (body) { body.style.display = prevD; body.style.overflow = prevO; }
        try { if (window.trimForecastToFit) { window.trimForecastToFit(); } } catch (e6) {}
        try { syncWeatherCard(); } catch (eW) {}
      } catch (e0) {}
      try { fitGuard(); } catch (eFg) {}
    };
    setTimeout(run, 60);     /* 等 fit CSS 生效后再量 */
    setTimeout(run, 420);    /* 二次保险（异步天气/新闻渲染可能又撑高） */
    setTimeout(run, 1600);   /* 三次保险（字体放大/晚到的渲染） */
  }
  window.addEventListener("resize", function () {
    if (_rzT) { clearTimeout(_rzT); }
    _rzT = setTimeout(refit, 120);
  });
  window.addEventListener("orientationchange", function () {
    setTimeout(refit, 220);
  });
  /* visualViewport：用户缩放/系统栏收展时也重排 */
  try {
    if (window.visualViewport && window.visualViewport.addEventListener) {
      window.visualViewport.addEventListener("resize", function () {
        setTimeout(refit, 150);
      });
    }
  } catch (eVv) {}

  /* ---- 2) 桌面浏览器恢复设置页「原生滚动」 ----
   * 原版把 #settingsMask 及各清单盒强制 overflow:hidden + touch-action:none，
   * 滚动全靠触摸拖拽（bindSettingsDrag）。桌面浏览器没有 touch 事件，
   * 滚轮/滚动条全部失效 —— 设置页只能看到第一屏，下面的项点不到。
   * 现代浏览器原生滚动完全可靠，这里只对「鼠标精细指针」环境放开原生滚动；
   * 手机/平板仍走原版的触摸拖拽逻辑，互不干扰。 */
  var st2 = document.createElement("style");
  st2.type = "text/css";
  st2.textContent =
    /* 四键等宽：原版横屏给 SETUP 键 flex:4、其余各占 1 份，
       小窗口下三个键窄到装不下文字（MUSIC/RADIO/Q&A 相互叠字）。
       改为四键等宽后文字正好放下。 */
    "html body #mainPage.rot-land #btnBar .gear-btn{ flex:1 1 0 !important; -webkit-box-flex:1 !important; }\n" +
    /* 天气预报温度列防裁切：.wtemp 是固定 34% 宽 + nowrap + 右对齐 + overflow:hidden，
       字体偏宽时（真机安卓字体、系统字号放大）"25~28°" 会从左边被裁成"5~28°"。
       放开 overflow 让文本向左伸展进 wtxt 列右侧的空白区（天气文本通常只有两三个字，
       右端大量留白，不会压字）。四个浮动列宽度总和不变，无换行风险。 */
    "html body .wrow .wtemp{ overflow:visible !important; }\n" +
    "@media (hover:hover) and (pointer:fine){\n" +
    "  html body #settingsMask{ overflow-y:auto !important; overflow-x:hidden !important; touch-action:auto !important; }\n" +
    "  html body .kdl-scrollbox, html body .radio-results, html body .radio-my,\n" +
    "  html body .mu-list, html body #rssList{ overflow-y:auto !important; touch-action:auto !important; }\n" +
    "  html body #settingsMask::-webkit-scrollbar{ width:10px; }\n" +
    "  html body #settingsMask::-webkit-scrollbar-thumb{ background:#9a9a9a; border-radius:6px; }\n" +
    "  html body #settingsMask::-webkit-scrollbar-track{ background:transparent; }\n" +
    "}\n";
  (document.head || document.documentElement).appendChild(st2);

  /* ---- 3) 横屏版式的「APK 比例字号校准」----
   * 原版字号的相对比例是在 1200x825（宽高比 1.45:1）的 H9 墨水屏上调好的。
   * 手机横屏（宽高比普遍 2:1 以上）下列宽随视口横向拉伸，而字号仍按"高度-derived k"
   * 缩放，于是：时钟贴满被拉宽的左栏 -> 偏大；新闻/天气被"填满高度"逻辑放大 -> 偏大；
   * 日历相对反而显小。
   * 作用域：直接挂 #mainPage.landscape（横屏类名由垫片按实际方向维护），
   * 不再用 @media (min-aspect-ratio) —— 部分手机浏览器对分数 aspect-ratio
   * 媒体查询支持不佳，会导致校准整块失效（用户端实拍证实过）。
   * 竖屏时垫片会移除 landscape 类，此处规则自动失配，竖版管线不受影响。
   * 数值 = APK 参考视口实测 vh 比例 × 用户要求的 0.8 缩放：
   *   天气(实况/盒/预报行/天数行/预警/提醒)、诗歌、新闻(标题/长标题/日期)
   *   全部再乘 0.8（用户 2026-09-26 反馈"缩小到原来的0.8倍"）。 */
  var st3 = document.createElement("style");
  st3.type = "text/css";
  st3.textContent =
    /* 时钟：APK 21.0vh × 0.92（此前已微调） */
    "  html body #mainPage.landscape #clockH, html body #mainPage.landscape #clockM{ font-size:calc(20.5vh * var(--wbscale,1)) !important; letter-spacing:0.06em !important; }\n" +
    "  html body #mainPage.landscape .date-line{ font-size:calc(4.7vh * var(--wbscale,1)) !important; }\n" +
    "  html body #mainPage.landscape .lunar-line{ font-size:calc(4.4vh * var(--wbscale,1)) !important; }\n" +
    /* 天气：APK 实况 6.7vh / 盒 3.33vh / 预报行 3.07vh / 天数行 3.47vh，先收一档再 ×0.8 */
    "  html body #mainPage.landscape .weather-now{ font-size:calc(4.64vh * var(--wbscale,1)) !important; }\n" +
    "  html body #mainPage.landscape .weather-box{ font-size:calc(2.48vh * var(--wbscale,1)) !important; }\n" +
    "  html body #mainPage.landscape .wrow{ font-size:calc(2.16vh * var(--wbscale,1)) !important; }\n" +
    "  html body #mainPage.landscape .weather-days{ font-size:calc(2.32vh * var(--wbscale,1)) !important; }\n" +
    "  html body #mainPage.landscape .weather-stale, html body #mainPage.landscape .wx-alert{ font-size:calc(2.08vh * var(--wbscale,1)) !important; }\n" +
    "  html body #mainPage.landscape .wx-remind{ font-size:calc(2.56vh * var(--wbscale,1)) !important; }\n" +
    /* 新闻：APK 标题 4.6vh / 日期 3.4vh，先收一档再 ×0.8 */
    "  html body #mainPage.landscape .news-title{ font-size:calc(3.28vh * var(--wbscale,1)) !important; }\n" +
    "  html body #mainPage.landscape .news-title.t-long{ font-size:calc(2.88vh * var(--wbscale,1)) !important; }\n" +
    "  html body #mainPage.landscape .news-date{ font-size:calc(2.4vh * var(--wbscale,1)) !important; }\n" +
    /* 诗歌：4.3vh × 0.8 */
    "  html body #mainPage.landscape .poem-box{ font-size:calc(3.44vh * var(--wbscale,1)) !important; }\n" +
    /* 日历：不钉字号！引擎 kdCalFit() 负责拟合（二分找最大字号 + 行距微调 +
       "宁可字小也不裁末行"安全网）。但原版 .calendar th { height:34px } 是
       固定像素：小屏卡片里表头吃掉约 1/4 高度，把拟合结果压得比 APK 比例小。
       这里把表头高度按 APK 比例（34px/825 ≈ 4.1vh）缩放，拟合空间就公平了。 */
    "  html body #mainPage.landscape .card-cal .calendar th{ height:calc(4.1vh * var(--wbscale,1)) !important; }\n" +
    /* 天气预报行防逐字堆叠保险：任何环境下都强制单行（宁可裁切不可竖排重叠） */
    "  html body .wrow .wday, html body .wrow .wico, html body .wrow .wtxt, html body .wrow .wtemp{ white-space:nowrap !important; }\n";
  (document.head || document.documentElement).appendChild(st3);

  /* ---- 3b) 底部四个按钮字号 ×0.8 ----
   * 原版 #btnBar button 基准 calc(28px*var(--sys,1))，宽<900px 时 calc(22px*var(--sys,1))。
   * 按用户要求整体缩到 0.8 倍：22.4px / 17.6px。用与原版相同的媒体条件保持一致。 */
  var st4 = document.createElement("style");
  st4.type = "text/css";
  st4.textContent =
    "html body #mainPage #btnBar button, html body #mainPage #btnBar .btn-music, html body #mainPage #btnBar .btn-radio, html body #mainPage #btnBar .btn-ai, html body #mainPage #btnBar .gear-btn{ font-size:calc(22.4px * var(--sys,1)) !important; }\n" +
    "@media (max-width:900px){\n" +
    "  html body #mainPage #btnBar button, html body #mainPage #btnBar .btn-music, html body #mainPage #btnBar .btn-radio, html body #mainPage #btnBar .btn-ai, html body #mainPage #btnBar .gear-btn{ font-size:calc(17.6px * var(--sys,1)) !important; }\n" +
    "}\n";
  (document.head || document.documentElement).appendChild(st4);

  /* --wbscale 跟随原版「主页缩放」设置（CFG.homeScale，%），让校准字号
     也服从用户的整体缩放；0/未设置 = 100%。轮询 + 钩子双保险。 */
  function wbScaleUpdate() {
    try {
      var hs = 100, c = window.CFG;
      if (c && c.homeScale && c.homeScale > 0) { hs = c.homeScale; }
      document.documentElement.style.setProperty("--wbscale", String(hs / 100));
    } catch (e) {}
  }
  try {
    var _origHomeScale = window.onHomeScaleChange;
    window.onHomeScaleChange = function () {
      if (typeof _origHomeScale === "function") { try { _origHomeScale(); } catch (e0) {} }
      wbScaleUpdate();
    };
  } catch (eHs) {}
  setInterval(wbScaleUpdate, 1200);
  window.addEventListener("load", wbScaleUpdate);

  /* ---- 4) 天气板块：面积固定、与日历上下齐平、预报行纵向等分 ----
   * 原版横屏逻辑 applyLandscapeSizes() 会按「首次测算冻结」的 CFG.lsSizes 给
   * .card-weather 写一个固定内联高度（与日历卡无关），实测总比日历卡矮一截
   * （915x412 下日历 133px vs 天气 101px），底部参差不齐；预报行虽然已是
   * flex:1 等分，但盒子矮，7 天预报挤在一起。
   * 修复：
   *   a) 同步天气卡高度 = 日历卡实测高度（两者同在 .mid-row 一行、顶边已齐，
   *      高度对齐后上下端自然齐平），并压掉原版冻结的内联高度；
   *   b) #weatherBox 撑满天气卡，.wrow 全部 flex:1 1 0 + min-height:0 ——
   *      剩余纵向空间被 7 天预报行严格均分（引擎 V30 起已把 fitForecastDays
   *      置为空操作、行本就 flex 等分，这里补上 CSS 保险确保任何时序都成立）；
   *   c) 钩住 applyLandscapeSizes / renderWeather，并在 refit 与 1s 轮询里
   *      持续同步，任何时序（字体加载、日历拟合、窗口变化）下都不回退。 */
  var st5 = document.createElement("style");
  st5.type = "text/css";
  st5.textContent =
    "html body .mid-row{ -webkit-align-items:stretch !important; align-items:stretch !important; }\n" +
    "html body .card-weather{ display:flex !important; -webkit-flex-direction:column !important; flex-direction:column !important; min-height:0 !important; overflow:hidden !important; }\n" +
    "html body .card-weather #weatherBox{ display:flex !important; -webkit-flex-direction:column !important; flex-direction:column !important; -webkit-box-flex:1 !important; -webkit-flex:1 1 auto !important; flex:1 1 auto !important; min-height:0 !important; }\n" +
    "html body .card-weather #weatherBox > .weather-now{ -webkit-flex:0 0 auto !important; flex:0 0 auto !important; }\n" +
    "html body .card-weather #weatherBox > .weather-stale{ -webkit-flex:0 0 auto !important; flex:0 0 auto !important; }\n" +
    "html body .card-weather #weatherBox > .wrow{ display:block !important; -webkit-box-flex:1 !important; -webkit-flex:1 1 0 !important; flex:1 1 0 !important; min-height:0 !important; overflow:hidden !important; }\n";
  (document.head || document.documentElement).appendChild(st5);

  function syncWeatherCard() {
    try {
      var mp = document.getElementById("mainPage");
      if (!mp || mp.style.display === "none") { return; }   /* 设置页打开时不动 */
      var cal = mp.querySelector(".card-cal");
      var wx = mp.querySelector(".card-weather");
      if (!cal || !wx) { return; }
      if (cal.parentElement !== wx.parentElement) { return; }  /* 只处理同一行内的兄弟卡 */
      var h = cal.getBoundingClientRect().height;
      if (!h || h < 10) { return; }
      var cur = parseFloat(wx.style.height) || 0;
      if (Math.abs(cur - h) > 0.5) {
        wx.style.height = h + "px";        /* 压掉原版冻结高度，改为与日历等高 */
        /* 高度变化后行高重排，宽度自适应字号重跑一次 */
        try { if (window.fitWeatherRows) { window.fitWeatherRows(); } } catch (eFr) {}
      }
      if (wx.style.minHeight !== "0px") { wx.style.minHeight = "0px"; }
      if (wx.style.maxHeight && wx.style.maxHeight !== "none") { wx.style.maxHeight = "none"; }
      /* 行数保险：预报行若被任何旧版裁行/快照逻辑删掉（少于可用天数），
         按 _fcAll 全量补回 —— flex 等分下多行永远不会溢出，补回是无损的。 */
      try {
        var wbox = document.getElementById("weatherBox");
        var all = window._fcAll;
        if (wbox && all && all.length) {
          var want = all.length;
          try {
            if (typeof window.fcDays === "function") {
              var fd = window.fcDays();
              if (fd > 0 && fd < want) { want = fd; }
            }
          } catch (eFd) {}
          var rowsEl = wbox.getElementsByClassName("wrow");
          if (rowsEl.length && rowsEl.length < want) {
            try { if (typeof window.fcSetRows === "function") { window.fcSetRows(want); } } catch (eSr) {}
          }
        }
      } catch (eRows) {}
    } catch (e) {}
  }
  window.syncWeatherCard = syncWeatherCard;   /* 供控制台/探针调用 */

  /* 钩住原版「横屏冻结尺寸」：先让它写完，再用日历实测高覆盖 */
  try {
    var _origALS = window.applyLandscapeSizes;
    if (typeof _origALS === "function") {
      window.applyLandscapeSizes = function (k) {
        try { _origALS(k); } catch (e0) {}
        setTimeout(syncWeatherCard, 0);
        setTimeout(syncWeatherCard, 150);
      };
    }
  } catch (eAls) {}
  /* 钩住天气渲染：实况行(.weather-now)高度可能变化，渲染后重新对齐 */
  try {
    var _origRW = window.renderWeather;
    if (typeof _origRW === "function") {
      window.renderWeather = function (ts) {
        var r = _origRW(ts);
        setTimeout(syncWeatherCard, 0);
        setTimeout(syncWeatherCard, 250);
        return r;
      };
    }
  } catch (eRw) {}
  /* 兜底轮询：字体/异步渲染晚到导致日历卡高度变化时也能跟上 */
  setInterval(syncWeatherCard, 1000);
  /* =========================================================================
     5) 浏览器版音乐：文件夹选择 + 目录浏览 + 播放记忆（续播）
     -------------------------------------------------------------------------
     原 APK 的音乐靠原生 KdMusicService 读设备文件系统：musicBrowse 列目录、
     musicPlay 直接读 file://。浏览器里两者都不存在，所以原逻辑一路走到
     「目录浏览需要原生模块」「没找到可播放的音乐」，既选不了文件夹也播不了。
     这里在浏览器里补一套等价能力，并把页面原有的音乐 UI 全部复用：
       · 选文件夹：<input webkitdirectory>（安卓 Chrome / 桌面 Chrome 都支持）
       · 选文件  ：<input type=file multiple accept="audio/*">（Safari/iOS 兜底）
       · 曲库    ：把选中的文件按相对路径搭成一棵虚拟目录树，
                   于是 musicBrowse / muLoadFolder 能像原生一样逐级浏览；
                   文件名清单存 localStorage，下次打开仍看得到结构。
       · 播放    ：File 对象不能持久化，但本会话内可 createObjectURL 出 blob:
                   地址交给页面 <audio>；重开页面后按文件名重新匹配。
       · 续播    ：记 {曲目路径, 位置秒}，每 2 秒写一次；下次播放（无论
                   「整个文件夹循环」还是「随机播放」）都先回到上一次没播完的
                   那一首、接着那个位置播，播完再按各自模式走下一首。
     ====================================================================== */
  var WB_LIB_KEY = "kd_music_lib";     /* 曲库骨架：目录树 + 文件名（可持久） */
  var WB_RES_KEY = "kd_mu_resume";     /* 续播记忆：{path,name,pos,dir,mode} */
  var WB = { root: "", dirs: {}, files: {}, byPath: {}, ready: false, total: 0 };
  var wbPendingSeek = 0;

  function wbBase(p) {
    try { if (window.muBaseName) { return window.muBaseName(p); } } catch (e) {}
    var s = String(p || ""), i = s.lastIndexOf("/");
    return (i >= 0) ? s.substring(i + 1) : s;
  }
  function wbIsAudio(n) {
    try { if (window.muIsAudio) { return !!window.muIsAudio(n); } } catch (e) {}
    return /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|wma|amr|mid|midi|aiff|ape|mka)$/i.test(String(n || ""));
  }
  function wbParent(d) {
    var s = String(d || ""), i = s.lastIndexOf("/");
    if (i <= 0) { return ""; }
    return s.substring(0, i) || "/";
  }
  function wbEnsureDir(dir) {
    if (!WB.dirs[dir]) { WB.dirs[dir] = []; WB.files[dir] = []; }
    var seg = String(dir).split("/"), i, child = "", parent;
    var acc = [];
    for (i = 0; i < seg.length; i++) {
      if (!seg[i]) { continue; }
      acc.push(seg[i]);
      child = "/" + acc.join("/");
      parent = (acc.length === 1) ? "/" : ("/" + acc.slice(0, acc.length - 1).join("/"));
      if (!WB.dirs[parent]) { WB.dirs[parent] = []; WB.files[parent] = []; }
      if (WB.dirs[parent].indexOf(child) < 0) { WB.dirs[parent].push(child); }
      if (!WB.dirs[child]) { WB.dirs[child] = []; WB.files[child] = []; }
    }
    return dir;
  }
  /* 路径归一：去掉前导斜杠、合并重复斜杠、反斜杠转正斜杠。
     真实 File.webkitRelativePath 是 "根目录/子目录/xx.mp3"（无前导斜杠），
     但拖拽/某些实现会给绝对路径，不归一就会出现 "//xx" 这种空段，
     目录树会断成两截、音频列表扫不到。 */
  function wbNorm(p) {
    return String(p || "").replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+/, "");
  }
  function wbAddFile(rel, file) {
    rel = wbNorm(rel);
    var seg = String(rel || "").split("/"), name = seg.pop();
    if (!name) { return; }
    var dir = seg.length ? ("/" + seg.join("/")) : "/";
    wbEnsureDir(dir);
    var p = dir + "/" + name, i, has = false;
    for (i = 0; i < WB.files[dir].length; i++) { if (WB.files[dir][i].name === name) { has = true; break; } }
    if (!has) {
      WB.files[dir].push({ name: name, path: p, size: (file && file.size) || 0 });
      WB.total++;
    }
    if (file) { WB.byPath[p] = { name: name, path: p, file: file, size: (file && file.size) || 0 }; }
    else if (!WB.byPath[p]) { WB.byPath[p] = { name: name, path: p, file: null, size: 0 }; }
    if (!WB.root) { WB.root = seg.length ? ("/" + seg[0]) : "/"; }
  }
  /* 收集 dir 下所有音频（含子目录）—— 用户选的是一个「音乐文件夹」，
     里面常有歌手/专辑子目录，只扫本层会漏掉大半。 */
  function wbAudioList(dir, recursive) {
    var out = [];
    function walk(d) {
      var fs = WB.files[d] || [], i, ds;
      for (i = 0; i < fs.length; i++) { if (wbIsAudio(fs[i].name)) { out.push(fs[i].path); } }
      if (recursive) {
        ds = WB.dirs[d] || [];
        for (i = 0; i < ds.length; i++) { walk(ds[i]); }
      }
    }
    walk(dir);
    return out;
  }
  /* 曲库骨架（只有路径，没有 File）：下次打开仍能看到目录结构和曲目名 */
  function wbSaveLib() {
    try {
      var slim = { root: WB.root, total: WB.total, dirs: {}, files: {} }, d;
      for (d in WB.dirs) { slim.dirs[d] = WB.dirs[d].slice(); }
      for (d in WB.files) {
        slim.files[d] = [];
        for (var i = 0; i < WB.files[d].length; i++) {
          slim.files[d].push({ name: WB.files[d][i].name, path: WB.files[d][i].path, size: WB.files[d][i].size });
        }
      }
      localStorage.setItem(WB_LIB_KEY, JSON.stringify(slim));
    } catch (e) {}
  }
  function wbLoadLib() {
    try {
      var raw = localStorage.getItem(WB_LIB_KEY);
      if (!raw) { return false; }
      var s = JSON.parse(raw), d, i;
      if (!s || !s.dirs) { return false; }
      WB.dirs = {}; WB.files = {};
      for (d in s.dirs) { WB.dirs[d] = (s.dirs[d] || []).slice(); }
      for (d in s.files) {
        WB.files[d] = [];
        for (i = 0; i < (s.files[d] || []).length; i++) {
          WB.files[d].push({ name: s.files[d][i].name, path: s.files[d][i].path, size: s.files[d][i].size || 0 });
          if (!WB.byPath[s.files[d][i].path]) {
            WB.byPath[s.files[d][i].path] = { name: s.files[d][i].name, path: s.files[d][i].path, file: null, size: s.files[d][i].size || 0 };
          }
        }
      }
      WB.root = s.root || WB.root;
      WB.total = s.total || 0;
      WB.ready = false;      /* 只有骨架，没有 File -> 还不能播 */
      return true;
    } catch (e) { return false; }
  }
  function wbHasLib() { var n = 0; for (var d in WB.dirs) { n++; break; } return n > 0; }

  /* ---- 续播记忆 ---- */
  function wbResume() {
    try { return JSON.parse(localStorage.getItem(WB_RES_KEY) || "null"); } catch (e) { return null; }
  }
  function wbCurPath() {
    /* 以「当前列表 + 当前下标」为准：a.__wbPath 只在 muPlayFile 里更新，
       若中途换过源会与列表脱节，续播就会记错曲目 */
    try {
      var L = window._muList || [], i = window._muIdx;
      if (typeof i === "number" && i >= 0 && i < L.length) { return L[i]; }
    } catch (e) {}
    try {
      var a = window.muAudioEl ? window.muAudioEl() : null;
      if (a && a.__wbPath) { return a.__wbPath; }
    } catch (e2) {}
    return "";
  }
  function wbSaveResume(pos) {
    try {
      var path = wbCurPath();
      if (!path) { return; }
      var r = wbResume() || {};
      r.path = path; r.name = wbBase(path);
      r.pos = (typeof pos === "number" && pos > 0) ? pos : 0;
      r.ts = Date.now();
      try { var c = window.muCfg ? window.muCfg() : null; if (c) { r.dir = c.dir || ""; r.mode = c.mode || ""; } } catch (e0) {}
      localStorage.setItem(WB_RES_KEY, JSON.stringify(r));
    } catch (e) {}
  }
  function wbClearResume() {
    try { localStorage.removeItem(WB_RES_KEY); } catch (e) {}
    try { window.muMsg ? window.muMsg("已清除续播记忆（下次从第一首开始）") : null; } catch (e0) {}
    wbRenderLib();
  }
  function wbFmt(sec) {
    var s = Math.floor(sec || 0);
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }
  /* 给 <audio> 挂上「位置记忆」监听（只挂一次） */
  function wbHookResume() {
    try {
      var a = window.muAudioEl ? window.muAudioEl() : null;
      if (!a || a.__wbResumeHooked) { return; }
      a.__wbResumeHooked = true;
      var last = 0;
      a.addEventListener("timeupdate", function () {
        var now = Date.now();
        if (now - last < 2000) { return; }
        last = now;
        wbSaveResume(a.currentTime);
      }, false);
      a.addEventListener("pause", function () { wbSaveResume(a.currentTime); }, false);
      a.addEventListener("ended", function () { try { localStorage.setItem(WB_RES_KEY, JSON.stringify({ path: a.__wbPath || "", name: "", pos: 0, ts: Date.now() })); } catch (e) {} }, false);
      window.addEventListener("beforeunload", function () { try { wbSaveResume(a.currentTime); } catch (e) {} });
      document.addEventListener("visibilitychange", function () { try { if (document.hidden) { wbSaveResume(a.currentTime); } } catch (e) {} });
    } catch (e) {}
  }

  /* ---- 设置页/弹窗里的曲库状态条 ---- */
  function wbLibHTML() {
    var r = wbResume(), h = "";
    if (WB.ready) {
      h = "曲库已就绪：" + (WB.root || "/") + "　（" + WB.total + " 个文件，" + wbAudioList(WB.root, true).length + " 首可播）";
    } else if (wbHasLib()) {
      h = "上次曲库：" + (WB.root || "/") + "　（" + WB.total + " 个文件）· <b>浏览器不保存文件本身，请点【选择音乐文件夹】重新选中同一个文件夹即可播放</b>";
    } else {
      h = "尚未选择音乐文件夹 —— 点下面【选择音乐文件夹】";
    }
    if (r && r.name) {
      h += "<br>续播记忆：" + String(r.name) + "　·　" + wbFmt(r.pos) +
           (r.pos > 0 ? "（下次从这里接着播）" : "（已播完，下次播下一首）");
    }
    return h;
  }
  function wbRenderLib() {
    try {
      var nl = document.querySelectorAll(".j-wb-lib"), i;
      for (i = 0; i < nl.length; i++) { nl[i].innerHTML = wbLibHTML(); }
    } catch (e) {}
  }
  window.wbRenderLib = wbRenderLib;
  window.wbClearResume = wbClearResume;
  /* 调试/自测入口：返回当前曲库与续播状态 */
  window.wbDebug = function () {
    var n = 0, d;
    for (d in WB.dirs) { n++; }
    return {
      root: WB.root, ready: WB.ready, dirCount: n, fileTotal: WB.total,
      audio: wbAudioList(WB.root || "/", true).length,
      muList: (window._muList || []).length, muIdx: window._muIdx,
      resume: wbResume()
    };
  };

  /* ---- 文件/文件夹选择 ---- */
  function wbIngest(list, virtRoot) {
    var i, f, rel, n = 0;
    WB.dirs = {}; WB.files = {}; WB.byPath = {}; WB.root = ""; WB.total = 0;
    for (i = 0; i < list.length; i++) {
      f = list[i];
      if (!f) { continue; }
      rel = (f.webkitRelativePath && f.webkitRelativePath.indexOf("/") > 0)
        ? f.webkitRelativePath
        : (String(virtRoot || "选择的文件") + "/" + (f.name || ("f" + i)));
      rel = wbNorm(rel);
      if (!rel) { continue; }
      wbAddFile(rel, f);
      n++;
    }
    if (!n) { return 0; }
    WB.ready = true;
    wbSaveLib();
    wbAfterPick();
    return n;
  }
  window.wbIngest = wbIngest;
  function wbAfterPick() {
    try {
      if (!WB.root) { WB.root = "/"; }
      window._muDir = WB.root;
      try { if (window.muUseCurDir) { window.muUseCurDir(); } } catch (e0) {}   /* 顺手设为默认文件夹 */
      try { if (window.musicBrowse) { window.musicBrowse(WB.root); } } catch (e1) {}
      try { wbRenderLib(); } catch (e2) {}
      try {
        var n = wbAudioList(WB.root, true).length;
        window.muMsg("已载入音乐文件夹：" + WB.root + "（" + n + " 首可播）· 点主页 MUSIC 即可播放");
        if (window.kdToast) { window.kdToast("音乐文件夹：" + WB.root + "（" + n + " 首）"); }
      } catch (e3) {}
    } catch (e) {}
  }
  function wbMakeInput(dirMode, virtRoot) {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.style.display = "none";
    inp.multiple = true;
    if (dirMode) {
      try { inp.setAttribute("webkitdirectory", ""); } catch (e0) {}
      try { inp.setAttribute("directory", ""); } catch (e1) {}
      try { inp.webkitdirectory = true; } catch (e2) {}
    } else {
      try { inp.setAttribute("accept", "audio/*"); } catch (e3) {}
    }
    inp.addEventListener("change", function () {
      var fs = inp.files || [];
      var arr = [], i;
      for (i = 0; i < fs.length; i++) { arr.push(fs[i]); }
      try {
        if (!arr.length) { window.muMsg("没有选中任何文件"); return; }
      } catch (eM) {}
      wbIngest(arr, virtRoot);
      try { if (inp.parentNode) { inp.parentNode.removeChild(inp); } } catch (e4) {}
    }, false);
    (document.body || document.documentElement).appendChild(inp);
    return inp;
  }
  function wbPickDir() {
    try {
      var inp = wbMakeInput(true, "");
      inp.click();
    } catch (e) {
      try { window.muMsg("本浏览器不支持文件夹选择，请改用【选择音频文件】"); } catch (e0) {}
    }
  }
  function wbPickFiles() {
    try {
      var inp = wbMakeInput(false, "选择的文件");
      inp.click();
    } catch (e) {
      try { window.muMsg("本浏览器不支持文件选择"); } catch (e0) {}
    }
  }
  window.wbPickDir = wbPickDir;
  window.wbPickFiles = wbPickFiles;

  /* ---- 覆盖：目录浏览 / 载入文件夹 / 播放 ---- */
  var _origMusicBrowse = window.musicBrowse;
  window.musicBrowse = function (path) {
    if (wbHasLib()) {
      try {
        var d = (path && WB.dirs[path]) ? path : (WB.root || "/");
        window._muDir = d;
        window._muDirs = (WB.dirs[d] || []).slice();
        window._muFiles = [];
        var fs = WB.files[d] || [], i;
        for (i = 0; i < fs.length; i++) { window._muFiles.push(fs[i].path); }
        window._muParent = wbParent(d);
        try { if (window.muRenderBrowse) { window.muRenderBrowse(); } } catch (e0) {}
        try {
          if (window.muPathTip) {
            window.muPathTip(d + "　·　本层 " + window._muDirs.length + " 个子文件夹 / " + window._muFiles.length + " 个文件");
          }
        } catch (e1) {}
        try { if (window.muCurTip) { window.muCurTip(); } } catch (e2) {}
        try { if (window.muSetValAll) { window.muSetValAll("j-mu-dir", d); } } catch (e3) {}
        return;
      } catch (e) {}
    }
    if (_origMusicBrowse) { return _origMusicBrowse(path); }
  };

  var _origLoadFolder = window.muLoadFolder;
  window.muLoadFolder = function (dir) {
    if (!wbHasLib()) { return _origLoadFolder ? _origLoadFolder(dir) : 0; }
    try {
      if (!dir) { dir = (window.muCfg && window.muCfg().dir) || WB.root; }
      var d = WB.dirs[dir] ? dir : (WB.root || "/");
      window._muDir = d;
      window._muDirs = (WB.dirs[d] || []).slice();
      window._muFiles = [];
      var fs = WB.files[d] || [], i;
      for (i = 0; i < fs.length; i++) { window._muFiles.push(fs[i].path); }
      window._muParent = wbParent(d);
      try { if (window.muRenderBrowse) { window.muRenderBrowse(); } } catch (e0) {}
      try { if (window.muSetValAll) { window.muSetValAll("j-mu-dir", d); } } catch (e1) {}
      var list = wbAudioList(d, true);
      window._muList = list; window._muIdx = -1;
      if (!list.length) {
        try { window.muMsg("这个文件夹里没有可播放的音频：" + d); } catch (e2) {}
      }
      return list.length;
    } catch (e) { return 0; }
  };

  var _origPlayFile = window.muPlayFile;
  window.muPlayFile = function (path) {
    var a = null;
    try { a = window.muAudioEl ? window.muAudioEl() : null; } catch (e0) {}
    if (!a || !path) { return _origPlayFile ? _origPlayFile(path) : undefined; }
    var rec = WB.byPath[path];
    if (rec && rec.file) {
      var url = "";
      try { url = (window.URL && URL.createObjectURL) ? URL.createObjectURL(rec.file) : ""; } catch (e1) {}
      if (url) {
        try { if (a.src && a.src.indexOf("blob:") === 0) { URL.revokeObjectURL(a.src); } } catch (e2) {}
        try { if (window.muAudioHook) { window.muAudioHook(); } } catch (e3) {}
        wbHookResume();
        window._muErrCnt = 0;
        window._muLoop = true;
        a.__wbPath = path;
        a.src = url;
        try { localStorage.setItem("kd_mu_last", String(path)); } catch (e4) {}
        var seek = wbPendingSeek; wbPendingSeek = 0;
        if (seek > 0) {
          var h = function () {
            try {
              a.removeEventListener("loadedmetadata", h, false);
              if (a.duration && seek < a.duration - 2) { a.currentTime = seek; }
            } catch (e5) {}
          };
          try { a.addEventListener("loadedmetadata", h, false); } catch (e6) {}
        }
        try { a.play(); } catch (e7) {}
        try { if (window.musicSyncState) { window.musicSyncState(); } } catch (e8) {}
        wbSaveResume(seek || 0);
        return;
      }
    }
    /* 没有 File（比如换了浏览器只剩骨架）—— 提示重新选一次，别默默失败 */
    if (rec && !rec.file) {
      try { window.muMsg("浏览器不保存文件本体，请点【选择音乐文件夹】重新选中同一个文件夹，即可从《" + rec.name + "》续播"); } catch (e9) {}
      try { wbRenderLib(); } catch (e10) {}
      return;
    }
    return _origPlayFile ? _origPlayFile(path) : undefined;
  };

  /* 单击 MUSIC / 开始播放：先看续播记忆，命中就从那一首、那个位置开始 */
  var _origStartLoop = window.musicStartLoop;
  window.musicStartLoop = function () {
    if (!wbHasLib()) { return _origStartLoop ? _origStartLoop() : undefined; }
    try {
      var c = window.muCfg ? window.muCfg() : { dir: WB.root, mode: "folder" };
      var n = window.muLoadFolder(c.dir);
      if (!n) {
        try { window.muMsg("没找到可播放的音乐，请先点【选择音乐文件夹】"); } catch (e0) {}
        return;
      }
      var L = window._muList || [], r = wbResume(), idx = -1, pos = 0, i;
      if (r && r.path) {
        for (i = 0; i < L.length; i++) { if (L[i] === r.path) { idx = i; pos = r.pos || 0; break; } }
        if (idx < 0 && r.name) {
          for (i = 0; i < L.length; i++) { if (wbBase(L[i]) === r.name) { idx = i; pos = r.pos || 0; break; } }
        }
      }
      window._muLoop = true; window._muErrCnt = 0;
      if (idx >= 0) {
        window._muIdx = idx;
        if (pos > 2) { wbPendingSeek = pos; }
        try {
          if (window.kdToast) {
            window.kdToast(pos > 2 ? ("续播：" + wbBase(L[idx]) + "　从 " + wbFmt(pos)) : ("播放：" + wbBase(L[idx])));
          }
        } catch (e1) {}
      } else {
        window._muIdx = (c.mode === "shuffle" && window.muPickRandom) ? window.muPickRandom() : 0;
        if (window._muIdx < 0) { window._muIdx = 0; }
      }
      window.muPlayFile(L[window._muIdx]);
      return;
    } catch (e) {
      return _origStartLoop ? _origStartLoop() : undefined;
    }
  };
  /* 单击 MUSIC：有曲库时统一走 musicStartLoop（带续播）。
     原版 muSmartClick 会先看 kd_mu_last 并「从头」播那一首 —— 位置记忆就被丢了，
     所以这里改成：正在播 -> 暂停；暂停中 -> 继续；没在播 -> 按续播记忆开播。 */
  var _origSmartClick = window.muSmartClick;
  window.muSmartClick = function () {
    if (!wbHasLib()) { return _origSmartClick ? _origSmartClick() : undefined; }
    try {
      var a = window.muAudioEl ? window.muAudioEl() : null;
      if (a && a.src && !a.paused) {
        try { a.pause(); } catch (e0) {}
        try { if (window.musicSyncState) { window.musicSyncState(); } } catch (e1) {}
        return;
      }
      if (a && a.src) {
        try { a.play(); } catch (e2) {}
        try { if (window.musicSyncState) { window.musicSyncState(); } } catch (e3) {}
        return;
      }
      return window.musicStartLoop();
    } catch (e) {
      return _origSmartClick ? _origSmartClick() : undefined;
    }
  };
  /* 设置页【试听这个文件夹】：同样先按记忆续播 */
  var _origPlayCurDir = window.muPlayCurDir;
  window.muPlayCurDir = function (btn) {
    if (!wbHasLib()) { return _origPlayCurDir ? _origPlayCurDir(btn) : undefined; }
    try {
      var n = window.muLoadFolder(window._muDir || (window.muCfg && window.muCfg().dir) || WB.root);
      if (!n) { return; }
      var L = window._muList || [], r = wbResume(), idx = -1, pos = 0, i;
      if (r && r.path) {
        for (i = 0; i < L.length; i++) { if (L[i] === r.path) { idx = i; pos = r.pos || 0; break; } }
      }
      window._muLoop = true; window._muErrCnt = 0;
      if (idx >= 0) { window._muIdx = idx; if (pos > 2) { wbPendingSeek = pos; } }
      else { window._muIdx = 0; }
      window.muPlayFile(L[window._muIdx]);
      try { window.muMsg("试听：" + (window._muDir || "") + "（" + n + " 首）"); } catch (e0) {}
      return;
    } catch (e) { return _origPlayCurDir ? _origPlayCurDir(btn) : undefined; }
  };

  /* ---- 面板模板：插入「选择文件夹 / 选择文件 / 清除记忆 / 曲库状态」---- */
  var _origMuSurfaceHTML = window.muSurfaceHTML;
  window.muSurfaceHTML = function (ns) {
    var h = "";
    try { h = _origMuSurfaceHTML ? _origMuSurfaceHTML(ns) : ""; } catch (e) { h = ""; }
    if (!h) { return h; }
    var block =
      '<div class="mu-sec-title">⓪ 本机音乐文件夹（浏览器版）</div>' +
      '<div class="mu-row">' +
      '<button class="mu-btn pri" onclick="wbPickDir(); return false;">选择音乐文件夹</button>' +
      '<button class="mu-btn" onclick="wbPickFiles(); return false;">选择音频文件</button>' +
      '<button class="mu-btn" onclick="wbClearResume(); return false;">清除续播记忆</button>' +
      "</div>" +
      '<div class="mu-hint">浏览器读不到设备目录，需由你在这里指定一次：点【选择音乐文件夹】选中放音乐的文件夹（会连带子文件夹一起收进曲库）；iPhone/不支持目录选择时用【选择音频文件】多选。曲目名会记住，下次打开只要再选同一个文件夹就能接着上次的位置播。</div>' +
      '<div class="mu-cur j-wb-lib"></div>';
    try {
      if (h.indexOf('<div class="mu-sec-title">②') >= 0) {
        h = h.replace('<div class="mu-sec-title">②', block + '<div class="mu-sec-title">②');
      } else if (h.indexOf('<div class="mu-sec-title">浏览并播放') >= 0) {
        h = h.replace('<div class="mu-sec-title">浏览并播放', block + '<div class="mu-sec-title">浏览并播放');
      } else {
        h = block + h;
      }
    } catch (e2) { h = block + h; }
    return h;
  };
  /* 模板重渲染后把曲库状态条填进去 */
  var _origMuRenderSurface = window.muRenderSurface;
  window.muRenderSurface = function (el) {
    try { if (_origMuRenderSurface) { _origMuRenderSurface(el); } } catch (e) {}
    setTimeout(wbRenderLib, 0);
  };

  /* 启动：把上次的曲库骨架读回来（结构可见，播之前需重选一次文件夹） */
  try { wbLoadLib(); } catch (eL) {}
  window.addEventListener("load", function () {
    setTimeout(function () {
      try { wbRenderLib(); } catch (e) {}
      try { if (wbHasLib() && window.musicBrowse) { window.musicBrowse(WB.root || "/"); } } catch (e2) {}
    }, 600);
    setTimeout(function () { try { wbRenderLib(); } catch (e) {} }, 1800);
  });

  window.addEventListener("load", function () {
    setTimeout(syncWeatherCard, 300);
    setTimeout(syncWeatherCard, 900);
    setTimeout(syncWeatherCard, 2000);
  });
})();
