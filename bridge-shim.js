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
  /* 同名函数后定义者生效：覆盖 dashboard.html 内原本依赖 ROT 的 applyRotation */
  window.applyRotation = function () { forceLandscape(); };

  /* 抵消 .layout 自带的 rotate(-90deg) 对消(现在 #mainPage 不再 +90) */
  var st = document.createElement("style");
  st.type = "text/css";
  st.textContent =
    "#mainPage.landscape .layout{ -webkit-transform:none !important; transform:none !important; }\n";
  (document.head || document.documentElement).appendChild(st);

  /* boot 之后可能再跑一次 applyRotation，兜底重打 landscape 标记 */
  window.addEventListener("load", function () {
    forceLandscape();
    setTimeout(forceLandscape, 300);
    setTimeout(forceLandscape, 1300);
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
    try { if (typeof window.applyFit === "function") { window.applyFit(); } } catch (e) {}
    try { forceLandscape(); } catch (e) {}
    relayoutNewsColumn();
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
      } catch (e0) {}
    };
    setTimeout(run, 60);     /* 等 fit CSS 生效后再量 */
    setTimeout(run, 420);    /* 二次保险（异步天气/新闻渲染可能又撑高） */
  }
  window.addEventListener("resize", function () {
    if (_rzT) { clearTimeout(_rzT); }
    _rzT = setTimeout(refit, 120);
  });
  window.addEventListener("orientationchange", function () {
    setTimeout(refit, 220);
  });

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
    "@media (hover:hover) and (pointer:fine){\n" +
    "  html body #settingsMask{ overflow-y:auto !important; overflow-x:hidden !important; touch-action:auto !important; }\n" +
    "  html body .kdl-scrollbox, html body .radio-results, html body .radio-my,\n" +
    "  html body .mu-list, html body #rssList{ overflow-y:auto !important; touch-action:auto !important; }\n" +
    "  html body #settingsMask::-webkit-scrollbar{ width:10px; }\n" +
    "  html body #settingsMask::-webkit-scrollbar-thumb{ background:#9a9a9a; border-radius:6px; }\n" +
    "  html body #settingsMask::-webkit-scrollbar-track{ background:transparent; }\n" +
    "}\n";
  (document.head || document.documentElement).appendChild(st2);
})();
