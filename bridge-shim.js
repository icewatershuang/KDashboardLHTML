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
})();
