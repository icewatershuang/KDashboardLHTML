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
  /* 自测/控制台入口：把「列出某目录下所有音频」和「重新载入曲库骨架」暴露出来。
     这两个原来是 WB 内部函数，外部拿不到 —— 排查「文件夹选了却不播」时
     没法确认曲库到底收进去了几首，只能靠猜。 */
  window.wbAudioList = function (dir, recursive) {
    try { return wbAudioList(dir || WB.root, recursive !== false); } catch (e) { return []; }
  };
  window.wbReloadLib = function () {
    try { return wbLoadLib(); } catch (e) { return false; }
  };
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
    /* 选过文件夹但还没重新授权（刷新过页面）时，把这一步做成醒目的一行 */
    var needRepick = wbHasLib() && !WB.ready;
    var block =
      '<div class="mu-sec-title">⓪ 本机音乐文件夹（浏览器版）</div>' +
      '<div class="mu-row">' +
      '<button class="mu-btn pri" onclick="wbPickDir(); return false;">选择音乐文件夹</button>' +
      '<button class="mu-btn" onclick="wbPickFiles(); return false;">选择音频文件</button>' +
      '<button class="mu-btn" onclick="wbClearResume(); return false;">清除续播记忆</button>' +
      "</div>" +
      '<div class="mu-hint">' +
      (needRepick
        ? '<b>上次的音乐文件夹还记得，但浏览器不保存文件本体 —— 点一下【选择音乐文件夹】重新选中同一个文件夹，就会从上次没播完的那首接着播。</b>'
        : '浏览器读不到设备目录，需由你在这里指定一次：点【选择音乐文件夹】选中电脑上放音乐的文件夹（会连带子文件夹一起收进曲库）；不支持目录选择时用【选择音频文件】多选。曲目名会记住，下次打开只要再选同一个文件夹就能接着上次的位置播。') +
      "</div>" +
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

  /* =======================================================================
     5) 收音机（RADIO）—— 让"点了有反应、播不了有提示、能自愈"
     -----------------------------------------------------------------------
     原版这一块本身没坏：radioPlay() 建 <audio>、radioPlaying() 判断状态都正常。
     真正的问题是「静默失败」——三种典型场景用户都得不到任何反馈：

       a) 选到死台/被墙的台：audio 触发 error(code 4)，但代码里 p.catch 是空的，
          按钮却已经被写成 class="btn-radio on"（亮着＝在播），于是"点了没声"。
       b) 用户机器上浏览器禁止无手势自动播放：play() 被静默拒绝，
          同样没有任何提示。
       c) 是 http 明文台 + 页面跑在 https 上：直接被 mixed-content 拦掉。

     本段做四件事：
       ① 给 radioPlay 的 play() 补 catch -> 明确提示（自动播放被拦 / 加载失败）
       ② 给 <audio> 挂 error / stalled / playing 监听 -> 失败翻牌 + 提示，
          成功才把按钮点成"在播"，不再出现"亮着但不响"
       ③ 死台自动跳到同清单里的下一个（最多试 3 个），用内联提示告知
       ④ 页面若在 https 下而电台是 http，提前提示并列出可用的 https 台
     ======================================================================= */
  var _rdBadTried = {};      /* 本次运行已判定播不了的 url，避免来回重试 */
  var _rdFailCnt = 0;
  var _rdCurName = "";

  function rdNotice(msg, ms) {
    try { if (window.kdToast) { window.kdToast(msg, ms || 6000); return; } } catch (e) {}
    try {
      var box = document.getElementById("aiQuick");
      if (box) { box.style.display = "block"; box.textContent = msg;
                 setTimeout(function () { try { box.style.display = "none"; } catch (e2) {} }, ms || 6000); }
    } catch (e) {}
  }
  /* 按钮状态只有「真的在出声」才允许是 on */
  function rdSetBtn(on, pause) {
    try {
      var br = document.getElementById("btnRadio");
      if (!br) { return; }
      br.className = on ? (pause ? "btn-radio pause" : "btn-radio on") : "btn-radio";
    } catch (e) {}
  }
  function rdIsHttpsPage() {
    try { return location.protocol === "https:"; } catch (e) { return false; }
  }
  function rdIsHttpUrl(u) { return /^http:\/\//i.test(String(u || "")); }

  /* 从「我的电台 + 预设库」里挑一个能用的候选（优先 https） */
  function rdCandidates(exceptUrl) {
    var out = [], i, seen = {}, arr;
    try { arr = (window.radioMyList ? window.radioMyList() : []) || []; } catch (e) { arr = []; }
    var pools = [arr];
    try { if (window.radioPresetAll) { pools.push(window.radioPresetAll() || []); } } catch (e2) {}
    for (var p = 0; p < pools.length; p++) {
      for (i = 0; i < pools[p].length; i++) {
        var u = pools[p][i] && pools[p][i].url;
        if (!u || u === exceptUrl || seen[u] || _rdBadTried[u]) { continue; }
        if (rdIsHttpsPage() && rdIsHttpUrl(u)) { continue; }   /* https 页面放不了 http 流 */
        seen[u] = 1;
        out.push(pools[p][i]);
      }
    }
    /* https 台排前面 */
    out.sort(function (a, b) {
      var sa = rdIsHttpUrl(a.url) ? 1 : 0, sb = rdIsHttpUrl(b.url) ? 1 : 0;
      return sa - sb;
    });
    return out;
  }

  /* 死台 -> 顺着清单试下一个 */
  function rdTryNext(reason) {
    var cur = window._radioCurUrl || "";
    _rdBadTried[cur] = 1;
    _rdFailCnt++;
    if (_rdFailCnt > 3) {
      rdSetBtn(false);
      rdNotice("连续几个电台都放不出来（" + reason + "）。请到【设置 → 智能与媒体 → 电台】换一个台，或用【新增电台】填一个能用的 http(s) 地址。", 9000);
      try { window.radioStop(); } catch (e) {}
      _rdFailCnt = 0;
      return;
    }
    var cands = rdCandidates(cur), i, pick = null;
    for (i = 0; i < cands.length; i++) {
      if (/\b[国内|中国|CNR|CRI|CCTV|中央|北京|上海|广东]/.test(cands[i].name) || !rdIsHttpUrl(cands[i].url)) { pick = cands[i]; break; }
    }
    if (!pick) { pick = cands[0]; }
    if (!pick) {
      rdSetBtn(false);
      rdNotice("这个电台播不出来：" + (reason || "地址失效") + "。到【设置 → 电台】里换一个台。", 9000);
      try { window.radioStop(); } catch (e2) {}
      _rdFailCnt = 0;
      return;
    }
    rdNotice("《" + (_rdCurName || "上一个台") + "》播不了（" + reason + "），自动换到《" + pick.name + "》…", 6000);
    try { window.radioPlay(pick.url, pick.name); } catch (e3) {}
  }

  /* 挂监听（只挂一次）：失败翻牌 + 成功点亮 */
  function rdHookAudio() {
    try {
      var a = window.radioAudioEl ? window.radioAudioEl() : document.getElementById("radioAudio");
      if (!a || a.__wbRadioHooked) { return; }
      a.__wbRadioHooked = true;

      a.addEventListener("playing", function () {
        _rdFailCnt = 0;
        rdSetBtn(true, false);
        try { if (a.__wbBad) { delete a.__wbBad; } } catch (e) {}
      }, false);

      a.addEventListener("error", function () {
        var code = a.error ? a.error.code : 0;
        a.__wbBad = true;
        var reason = (code === 4 || code === 3) ? "地址失效或格式不支持"
                   : (code === 2) ? "网络中断"
                   : (code === 1) ? "播放被中断" : "加载失败";
        if (rdIsHttpsPage() && rdIsHttpUrl(a.src || window._radioCurUrl)) {
          reason = "本站是 https，浏览器禁止加载 http 明文电台";
        }
        rdTryNext(reason);
      }, false);

      /* 长时间没有任何数据 -> 当作死台（直播流常见：连上了但一直没音频） */
      a.addEventListener("stalled", function () {
        setTimeout(function () {
          if (a.paused || a.readyState < 2) {
            try { if (window.radioPlaying && !window.radioPlaying()) { return; } } catch (e0) {}
          }
        }, 100);
      }, false);

      a.addEventListener("pause", function () {
        if (!a.ended) { rdSetBtn(false); }
      }, false);
    } catch (e) {}
  }

  /* 覆盖 radioPlay：补 play() 的 catch + 记录台名 + 挂监听 + 超时兜底 */
  var _origRadioPlay = window.radioPlay;
  window.radioPlay = function (url, name) {
    _rdCurName = name || "";
    if (rdIsHttpsPage() && rdIsHttpUrl(url)) {
      rdNotice("《" + (name || url) + "》是 http 明文地址，当前页面是 https，浏览器会拦掉。请换一个 https 的台。", 9000);
      /* 仍然试一次，失败链路会走到 error -> rdTryNext */
    }
    try { if (_origRadioPlay) { _origRadioPlay(url, name); } } catch (e) {}

    /* 挂监听（audio 刚被创建出来） */
    setTimeout(function () {
      rdHookAudio();
      var a = document.getElementById("radioAudio");
      if (!a) { return; }
      /* 覆盖这次 play() 的空 catch：重新 play 一遍以拿到 promise */
      try {
        var p = a.play();
        if (p && p.catch) {
          p.catch(function (err) {
            var m = String((err && err.name) || "");
            if (/NotAllowed/i.test(m)) {
              rdSetBtn(false);
              rdNotice("浏览器拦截了自动播放 —— 请再点一次主页【RADIO】按钮（浏览器要求由你的点击来启动声音）。", 8000);
            } else {
              a.__wbBad = true;
              rdTryNext("播放被拒绝");
            }
          });
        }
      } catch (e2) {}
    }, 50);

    /* 超时兜底：6 秒还没开始出声就当失败 */
    setTimeout(function () {
      try {
        var a = document.getElementById("radioAudio");
        if (!a) { return; }
        if (a.__wbRadioTimeout) { clearTimeout(a.__wbRadioTimeout); }
        a.__wbRadioTimeout = setTimeout(function () {
          if (window._radioCurUrl !== url) { return; }          /* 已经换台了，忽略 */
          if (!a.paused && a.readyState >= 2) { return; }        /* 在播，正常 */
          if (a.__wbBad) { return; }                             /* 已由 error 处理 */
          a.__wbBad = true;
          rdTryNext("等不到音频数据（可能是死链或被墙）");
        }, 6000);
      } catch (e4) {}
    }, 0);
  };

  /* 覆盖 radioQuickPlay：没设最爱时给明确指引，而不是一句 alert */
  var _origRadioQuickPlay = window.radioQuickPlay;
  window.radioQuickPlay = function () {
    var a = window.radioAudioEl ? window.radioAudioEl() : null;
    if (a && !a.paused) { rdSetBtn(true, true); }
    var target = null;
    try { if (window.radioTarget) { target = window.radioTarget(); } } catch (e) {}
    if (!target) {
      rdSetBtn(false);
      rdNotice("还没选电台。打开【设置 → 智能与媒体 → 电台 Radio】，在列表里点一下台名设为最喜爱，之后主页点 RADIO 就能播。", 9000);
      return;
    }
    _rdFailCnt = 0;
    _rdCurName = target.name || "";
    try { if (_origRadioQuickPlay) { _origRadioQuickPlay(); } } catch (e2) {}
    setTimeout(rdHookAudio, 60);
    /* 若 3 秒后仍没声音，明确告诉用户点哪儿 */
    setTimeout(function () {
      try {
        var el = document.getElementById("radioAudio");
        if (!el) { return; }
        if (el.paused && el.readyState < 2 && !el.__wbBad) {
          rdSetBtn(false);
          rdNotice("《" + (_rdCurName || "该电台") + "》还没有声音 —— 浏览器可能要求再点一次【RADIO】才开始播放。", 8000);
        }
      } catch (e3) {}
    }, 3000);
  };

  /* 启动时挂一次监听（页面自带 radioAudio 时） */
  window.addEventListener("load", function () {
    setTimeout(rdHookAudio, 1200);
    setTimeout(rdHookAudio, 3000);
    /* 首次使用时：默认最爱是美国的 WLTW（http，国内多数网络/被墙，且 https 页面会被拦），
       直接换成国内可用的 https 台，免得用户第一次点 RADIO 就是"没声音"。
       只在用户「从未自己改过」时替换，改过的不动。 */
    setTimeout(function () {
      try {
        if (localStorage.getItem("kd_radio_default_fixed_v2")) { return; }
        var r = (window.CFG && window.CFG.radio) || null;
        if (!r || !r.favorite || !r.favorite.url) { return; }
        var u = String(r.favorite.url);
        if (u.indexOf("revma.ihrhls.com") < 0 && u.indexOf("npr-ice.streamguys1.com") < 0) {
          localStorage.setItem("kd_radio_default_fixed_v2", "1");
          return;
        }
        r.favorite = { name: "CNR-1 中国之声", url: "https://lhttp.qtfm.cn/live/15318317/64k.mp3" };
        /* 清单里那两个 http 境外台换成 https 的国内台 */
        var swap = {
          "http://stream.revma.ihrhls.com/zc1477": { name: "CNR-1 中国之声", url: "https://lhttp.qtfm.cn/live/15318317/64k.mp3" },
          "http://npr-ice.streamguys1.com/live.mp3": { name: "CRI 环球资讯广播", url: "https://sk.cri.cn/905.m3u8" },
          "http://sk.cri.cn/am846.m3u8": { name: "广东音乐之声", url: "https://lhttp.qtfm.cn/live/1260/64k.mp3" }
        };
        var L = r.myList || [], i, t;
        for (i = 0; i < L.length; i++) {
          t = swap[L[i].url];
          if (t) { L[i].name = t.name; L[i].url = t.url; }
        }
        try { if (window.saveConfig) { window.saveConfig(); } } catch (e0) {}
        localStorage.setItem("kd_radio_default_fixed_v2", "1");
        try { if (window.radioSyncFavUI) { window.radioSyncFavUI(); } } catch (e1) {}
        try { if (window.radioMyRender) { window.radioMyRender(); window.radioMyRender("radioMyListS"); } } catch (e2) {}
      } catch (e) {}
    }, 1500);
  });

  /* 设置页里的收音机提示条：把 live 状态写出来，代替原来没有反馈的静默 */
  var _origRadioSyncFavUI = window.radioSyncFavUI;
  window.radioSyncFavUI = function () {
    try { if (_origRadioSyncFavUI) { _origRadioSyncFavUI(); } } catch (e) {}
    try {
      var fav = (window.CFG && window.CFG.radio && window.CFG.radio.favorite) || null;
      var box = document.getElementById("radioNow");
      if (box && !fav) {
        box.innerHTML = "最喜爱：无 —— 请在下面列表里点一下台名来设定（点台名 = 设为最喜爱并试听）";
      }
    } catch (e2) {}
  };
})();

/* ===========================================================================
   修复 6：日历「今日高亮」在节假日 / 调休 / 公历节日当天整片丢失
   ---------------------------------------------------------------------------
   症状（用户可见）：
     今天是 9/26（中秋，法定假日），日历里 26 号那一格应当是【黑底白字 + 灰底假日色】
     的双重高亮，实际只剩灰底 —— 「今天」完全看不出来。
     调休上班日、公历节日（教师节等）当天同样丢高亮。

   根因（不是逻辑写错，是字符串拼进标签的方式错了）：
     原 renderCalendar() 用字符串拼 <td>，各分支这样写：

         cls = " class='hol'" + (i === today ? " today" : "");
         html += "<td" + cls + ">…</td>";

     拼出来是  <td class='hol' today>  ——
     `today` 落在了单引号**外面**，于是被 HTML 解析器当成一个独立的
     布尔属性（DOM 里显示成 today=""），而不是 class 列表里的一员。
     结果 td.className 只剩 "hol"，`.calendar td.today` 那条黑底白字规则
     永远匹配不上。

     ⚠ 容易误判的地方：源码里 `if (i === today)` 判断本身是**对的**，
     cls 变量拼出来的字符串看着也"像"带 today；
     只有把 innerHTML 取出来看原始标签、或读 td.className，
     才会发现 today 被降级成了属性。所以这里不是改判断，是改拼接方式。

   修法（不改 index.html，只在 web 版运行时接管）：
     不改原函数的判断逻辑，而是「算完 class 后，再确保 today 真的进了 class 列表」：
       ① 每次 renderCalendar() 之后，把生成好的 DOM 规范化一遍
          —— 删掉那个伪属性 today=""，按真实日期补一次 today 类；
       ② 同时把当天的格子重新着色（黑底白字），节假日/调休的底色叠在下面，
          保证「今天」在任何分支下都一定能被认出来；
       ③ 用 MutationObserver 兜住所有后续重绘（跨日 updateClock 会再调
          renderCalendar，月份切换、恢复缓存也都会），不依赖调用点。
     这样只增不减：原有农历日、节日名、调休「班」字样全都保留。
   =========================================================================== */
(function () {
  var CAL_BOX_ID = "calendarBox";

  /* 找出日历里「今天」那一格：只认 dnum 文本等于当天的格，月/年不匹配就不动。 */
  function kdTodayCell() {
    var box = document.getElementById(CAL_BOX_ID);
    if (!box) { return null; }
    var now = new Date();
    var day = String(now.getDate());
    var tds = box.getElementsByTagName("td");
    var i, td, dn;
    for (i = 0; i < tds.length; i++) {
      td = tds[i];
      dn = td.getElementsByTagName("span");
      var j, txt = "";
      for (j = 0; j < dn.length; j++) {
        if (String(dn[j].className || "").indexOf("dnum") >= 0) { txt = String(dn[j].textContent || "").replace(/\s+/g, ""); break; }
      }
      if (txt === day) { return td; }
    }
    return null;
  }

  /* 规范化整个日历：
       1) 把误当成属性的 today="" 清掉（它是拼串事故的残留，不该留在标签上）
       2) 给真正的今天补上 today 类
       3) 保证 today 一定排在 class 列表里，且不重复 */
  function kdNormalizeCalendar() {
    try {
      var box = document.getElementById(CAL_BOX_ID);
      if (!box) { return false; }
      var tds = box.getElementsByTagName("td"), i, td;
      /* ① 清理伪属性。老 WebKit 没有 removeAttribute 的兼容问题，直接用即可。 */
      for (i = 0; i < tds.length; i++) {
        td = tds[i];
        try {
          if (td.hasAttribute && td.hasAttribute("today")) { td.removeAttribute("today"); }
        } catch (eAttr) {}
      }
      /* ② 补 today 类 */
      var hit = kdTodayCell();
      if (!hit) { return false; }
      var cls = String(hit.className || "");
      if (cls.indexOf("today") < 0) {
        hit.className = (cls ? cls + " " : "") + "today";
      }
      return true;
    } catch (e) { return false; }
  }

  /* 接管 renderCalendar：先跑原逻辑（农历日/节日名/调休字样都不变），
     再立刻规范化。原函数在写 innerHTML 后会调 kdCalFit()，
     这一步必须放在它之后，免得 kdCalFit 量到的还是旧 class 的高度。 */
  var _origRenderCalendar = window.renderCalendar;
  if (typeof _origRenderCalendar === "function") {
    window.renderCalendar = function () {
      var r;
      try { r = _origRenderCalendar.apply(this, arguments); }
      finally { try { kdNormalizeCalendar(); } catch (eN) {} }
      return r;
    };
  }

  /* 兜底：任何其它路径改了 calendarBox（跨日 updateClock、月份切换、
     以及别的脚本直接写 innerHTML），也补一遍。节流到一帧一次。 */
  var _calTimer = null;
  function kdCalKick() {
    if (_calTimer) { return; }
    _calTimer = setTimeout(function () {
      _calTimer = null;
      try { kdNormalizeCalendar(); } catch (e) {}
    }, 0);
  }
  window.addEventListener("load", function () {
    try { kdNormalizeCalendar(); } catch (e0) {}
    try {
      var box = document.getElementById(CAL_BOX_ID);
      if (box && window.MutationObserver) {
        var mo = new MutationObserver(function () { kdCalKick(); });
        mo.observe(box, { childList: true, subtree: true });
      }
    } catch (e1) {}
    /* 跨日那一分钟：updateClock 会重排日历，多补几次确保命中 */
    setTimeout(kdCalKick, 1000);
    setTimeout(kdCalKick, 3000);
  });
  /* 供控制台 / 自动化测试调用 */
  window.kdNormalizeCalendar = kdNormalizeCalendar;
})();

/* ===========================================================================
   修复 7：日历卡被天气卡挤成一条窄缝（中段两列不是 50/50）
   ---------------------------------------------------------------------------
   症状（用户可见）：
     中段「日历 | 天气」两列本该等分，实际日历只有 147px、天气 300px ——
     日历被压成一条窄缝，一个月 6 行 7 列全挤在 147px 里，
     每格只剩 21px 宽，日期数字和节日名都挤得看不清。

   根因（旧竖版规则的遗留冲突）：
     index.html 里有两组打架的规则：

       ① 现在生效的新版面（中段一行两列）：
            .mid-row > .card-cal,
            .mid-row > .card-weather { flex: 1 1 50%; width: 50%; }

       ② 旧竖版遗留（顶行「时钟|日历」并排、天气单独一行）：
            #mainPage.landscape .card-cal     { flex: 0 1 49%; }
            #mainPage.landscape .card-weather { flex: 1 1 100%; }

     两组 specificity 相同（都是 0,2,0 一类的三选择器级别），
     而 ② 在样式表里更靠后 ⇒ ② 胜出。
     于是日历 flex-grow=0（永不长大）、天气 flex-grow=1（吃掉所有余量），
     470px 的中段被切成 147 + 300。

   修法（不改 index.html，只在 web 版注入覆盖）：
     在页面样式之后追加一段 <style>，用更高优先级把中段两列钉回 50/50，
     并且只作用于 .mid-row 的直接子卡 —— 不去动 clock/poem 等其它板块，
     避免误伤已经调好的版面。
   =========================================================================== */
(function () {
  function injectMidRowFix() {
    try {
      if (document.getElementById("kdMidRowFix")) { return; }
      var st = document.createElement("style");
      st.id = "kdMidRowFix";
      st.type = "text/css";
      /* 关键点：
         · flex-grow 必须两边都是 1（原来日历是 0，所以永远不长）
         · flex-basis 50% + width 50% 双保险（老 WebKit 对 flex-basis 支持不齐）
         · box-sizing 保证 50% 不含 margin，两卡 + 两道 9px 缝正好铺满
         · min-width:0 允许内容偏长时正常收缩，而不是把对方顶出去 */
      st.appendChild(document.createTextNode(
        "#topWrap .mid-row > .card-cal," +
        "#topWrap .mid-row > .card-weather {" +
        "  -webkit-box-flex: 1 1 50% !important;" +
        "  -webkit-flex: 1 1 50% !important;" +
        "  flex: 1 1 50% !important;" +
        "  width: 50% !important;" +
        "  min-width: 0 !important;" +
        "  -webkit-box-sizing: border-box !important;" +
        "  box-sizing: border-box !important;" +
        "}" +
        /* 旧竖版给 .card-cal 定的 49% 基准也一并纠正（万一上一条被更狠的规则压住） */
        "#mainPage.landscape #topWrap .mid-row > .card-cal {" +
        "  -webkit-flex: 1 1 50% !important; flex: 1 1 50% !important; width: 50% !important;" +
        "}" +
        "#mainPage.landscape #topWrap .mid-row > .card-weather {" +
        "  -webkit-flex: 1 1 50% !important; flex: 1 1 50% !important; width: 50% !important;" +
        "}"
      ));
      var head = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
      head.appendChild(st);
    } catch (e) {}
  }
  injectMidRowFix();
  /* 老引擎可能把 <head> 里后插的样式排到最后才生效，DOM 就绪后再补一次并复测 */
  window.addEventListener("load", function () {
    injectMidRowFix();
    setTimeout(function () {
      try {
        var mr = document.querySelector("#topWrap .mid-row");
        var cal = document.querySelector("#topWrap .mid-row > .card-cal");
        var wx = document.querySelector("#topWrap .mid-row > .card-weather");
        if (!mr || !cal || !wx) { return; }
        var mw = mr.clientWidth || 0, cw = cal.clientWidth || 0, ww = wx.clientWidth || 0;
        /* 两卡宽度差超过 12px 就说明 50/50 没生效 —— 兜底改成显式像素宽 */
        if (mw > 120 && Math.abs(cw - ww) > 12) {
          var half = Math.floor((mw - 18) / 2);   /* 18 = 两侧 9px 缝 */
          if (half > 60) {
            cal.style.setProperty("width", half + "px", "important");
            cal.style.setProperty("flex", "0 0 " + half + "px", "important");
            wx.style.setProperty("width", half + "px", "important");
            wx.style.setProperty("flex", "0 0 " + half + "px", "important");
            try { if (window.kdCalFit) { window.kdCalFit(); } } catch (e2) {}
          }
        }
      } catch (e1) {}
    }, 800);
  });
  /* 供自动化测试调用 */
  window.kdMidRowFix = injectMidRowFix;
})();

/* ===========================================================================
   V4.1 适配（2026-10-07）
   V4.1_808 相比 V3.3 有两处变化需要网页版另行处理：
     ① 新增「首次安装授权引导框」#onboard —— 在 APK 里引导用户去系统设置授予
        常驻权限。网页端没有这些系统权限可授予；而 bridgeOK() 因为垫片实现了
        KindleBridge.get 而返回 true，导致这个全屏弹窗会照样弹出来，
        还带着一排点了没反应的「去授予」按钮。这里整个屏蔽掉。
     ② 诗歌默认一次显示 2 条（中+英）。英文句子长、会折行，
        V4.1 的 .card-poem 高度装不下（实测需 160px、只有 119px），末条被裁。
        这里把诗歌字号按可用高度收敛，并让诗句块吃满卡片。
   =========================================================================== */
(function () {
  /* -------- ① 屏蔽网页端的授权引导框 -------- */
  try {
    var st = document.createElement("style");
    st.id = "kdNoOnboard";
    st.type = "text/css";
    st.appendChild(document.createTextNode(
      "#onboard{ display:none !important; }"
    ));
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {}

  /* 首次启动不再自动弹 */
  window.kdOnboardIfFirst = function () { /* 网页端无需授权引导 */ };

  /* 设置页里若有人点了「首次权限引导」，给一句人话而不是弹个空框 */
  window.kdOnboardOpen = function () {
    var msg = "网页版运行在浏览器里，不需要安卓系统授权。";
    try { if (typeof kdToast === "function") { kdToast(msg); return; } } catch (e) {}
    try { window.alert(msg); } catch (e2) {}
  };
  window.kdOnboardClose = function () {
    var ob = document.getElementById("onboard");
    if (ob) { ob.style.display = "none"; }
    try { storeSet("kd_onboard_v1", "1"); } catch (e) {}
  };

  /* -------- ② 诗歌：让两条诗（中+英）完整装进卡片 -------- */
  /* 关键：不能写内联样式。rotatePoem() 每次轮换都会往 #poemBox 上写
     style.fontSize = '11px'（无 important），会把我们的内联值冲掉；
     而样式表里的 !important 压得住「无 important 的内联」，所以写进 <style>。
     选择器用两个 id（#mainPage #poemBox）保证比垫片里那条 .poem-box 规则更specific。 */
  var _poemStyle = null;
  function poemStyleEl() {
    if (_poemStyle) { return _poemStyle; }
    var s = document.createElement("style");
    s.id = "kdPoemFit";
    s.type = "text/css";
    (document.head || document.documentElement).appendChild(s);
    _poemStyle = s;
    return s;
  }
  function setPoemFs(px) {
    var el = poemStyleEl();
    el.textContent = "#mainPage #poemBox{ font-size:" + px + "px !important; }";
  }
  function clearPoemFs() {
    if (_poemStyle) { _poemStyle.textContent = ""; }
  }

  function fitPoem() {
    try {
      var box = document.getElementById("poemBox");
      if (!box) { return; }
      var avail = box.clientHeight;
      if (!(avail > 40)) { return; }
      /* 从当前生效字号出发，只缩不放；字变小会改变折行，
         收缩比不是线性的，所以写进样式表后重新实测、迭代收敛（最多 8 次） */
      var cur = parseFloat(getComputedStyle(box).fontSize) || 0;
      if (!(cur > 0)) { return; }
      var next = cur;
      for (var i = 0; i < 8; i++) {
        var need = box.scrollHeight;
        if (!(need > avail + 1)) { break; }
        var cand = Math.floor(next * ((avail - 1) / need) * 100) / 100;
        if (cand >= next - 0.2) { break; }
        next = cand;
        setPoemFs(next);
        void box.getBoundingClientRect();   /* 强制回流，下次 scrollHeight 才是新值 */
      }
      /* 收尾校一次：万一还差一点，再降一档；富余很多就还原 */
      var need2 = box.scrollHeight;
      if (need2 > avail + 1) {
        var cur2 = parseFloat(getComputedStyle(box).fontSize) || 0;
        if (cur2 > 8) { setPoemFs(Math.floor(cur2 * ((avail - 1) / need2) * 100) / 100); }
      } else if (need2 < avail * 0.55 && next < cur) {
        /* 富余超过 45%（说明换了一首很短的诗），放开回到基准字号 */
        clearPoemFs();
      }
    } catch (e1) {}
  }

  /* 诗歌会轮换，每次重排后都要再量一次；用 MutationObserver 盯住内容变化 */
  try {
    var _fitPending = null;
    var _scheduleFit = function () {
      if (_fitPending) { clearTimeout(_fitPending); }
      _fitPending = setTimeout(function () { _fitPending = null; fitPoem(); }, 120);
    };
    window.addEventListener("load", function () {
      _scheduleFit();
      setTimeout(_scheduleFit, 900);
      setTimeout(_scheduleFit, 2500);
    });
    window.addEventListener("resize", _scheduleFit);
    if (window.MutationObserver) {
      var target = document.getElementById("poemBox");
      if (target) {
        new MutationObserver(_scheduleFit).observe(target, { childList: true, subtree: true, characterData: true });
      }
    }
  } catch (e2) {}

  /* 供自动化测试调用 */
  window.kdFitPoem = fitPoem;
})();
