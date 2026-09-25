# KDashBoardL 横版仪表盘 · 静态网页版（GitHub 发布）

> 来源 APK：`KDashBoardL_V3.3_760_v123横版新安卓.apk`
> 原程序作者：水哥（WATERS）　|　本仓库为「提取 HTML + 全部配置并转译为可发布的静态网页」

这是一个 Android WebView 水墨屏仪表盘（时钟 / 日历 / 天气 / 新闻 / 诗歌 / 电台 / AI）。
UI 与全部逻辑都写在 `assets/dashboard.html` 里（约 953 KB 单文件），外层只是极薄的
原生壳。本仓库把它**原样提取**，再用一个浏览器桥接垫片（`bridge-shim.js`）替换掉
安卓原生能力，从而无需任何后端即可作为**纯静态网页**部署到 GitHub Pages。

---

## 一、APK 身份与结构

| 项目 | 值 |
|---|---|
| 包名 | `com.kindledash.landscape` |
| 版本名 / 构建号 | V3.3 / **123**（文件名尾部 `_v123`） |
| 内部迭代号 `KD_BUILD_CODE` | 757 |
| 目标设备 | Topsir H9 / 海尔 9.7" 水墨屏，1200×825 横屏，安卓 4.0.4 |
| 应用名 / 作者 | KDashBoardL / 水哥（WATERS） |

**原生组件（Java）**
`MainActivity`（启动器 + HOME 类别，相当于桌面 kiosk）、`BootReceiver`、`DevAdminReceiver`
（设备管理员 watch-login）、`KdMusicService`（音频播放）、`KeepService`（保活）、
`NetReceiver`、`OverlayService`（悬浮窗）、`WatchdogReceiver`。

**权限**：INTERNET、ACCESS_NETWORK_STATE / WIFI_STATE、CHANGE_WIFI_STATE、WAKE_LOCK、
RECORD_AUDIO、MODIFY_AUDIO_SETTINGS、FOREGROUND_SERVICE（media/microphone/special_use）、
POST_NOTIFICATIONS、READ_EXTERNAL_STORAGE、READ_MEDIA_AUDIO、RECEIVE_BOOT_COMPLETED、
RECEIVE_USER_PRESENT、SYSTEM_ALERT_WINDOW、USE_FULL_SCREEN_INTENT、WRITE_SETTINGS、
REQUEST_IGNORE_BATTERY_OPTIMIZATIONS、SCHEDULE_EXACT_ALARM、DISABLE_KEYGUARD、
REQUEST_DELETE_PACKAGES、BIND_DEVICE_ADMIN。

**网络策略**：`res/xml/network_security_config.xml` 开启 `cleartextTrafficPermitted` 并信任
系统 + 用户证书（即「宽松 HTTPS」，原生桥可忽略证书错误抓 https）。

---

## 二、从 APK 提取出的资源清单

| 文件 | 说明 |
|---|---|
| `assets/dashboard.html` | **核心**：全部 UI + JS 逻辑 + 配置默认值（已提取为 `index.html`） |
| `assets/hls.min.js` | HLS 播放器（电台 `.m3u8` 直播流用），已随站发布 |
| `assets/radio_presets.js` | 原生电台曲库（约 50 个预设地址，参考用） |
| `AndroidManifest.xml` | 二进制 AXML，已解码出包名 / 组件 / 权限（见上） |
| `res/xml/network_security_config.xml` | 网络宽松策略 |
| `res/xml/device_admin.xml` | 设备管理员策略（watch-login） |
| `classes.dex` | 原生桥 / 服务实现（无源码，仅作能力参考） |

> 原始提取物保留在 `../kdashboard_extract/`（工作区相对路径），便于核查。

---

## 三、原生桥 `KindleBridge` API 一览（被垫片模拟）

| 方法 | 原作用 | 网页垫片行为 |
|---|---|---|
| `get(url, tok)` | Java 代抓任意 URL（绕开 file:// 同源限制、忽略证书） | `fetch` + HTTPS 公共 CORS 代理兜底；结果做 URL-safe Base64 后回调 `__bridgeChunk` |
| `getPref / setPref` | SharedPreferences 持久化 | `localStorage` |
| `getVersion` | 版本串 | 返回 `KDashBoardL Web 1.0` |
| `getDeviceModel` | 设备型号（H9 走专属微调） | 返回 `""`（不套用 H9 微调） |
| `getFontScale / getViewW / getViewH / getViewInfo` | 系统字号 / 可视区尺寸 | 返回 `1` / `window.innerWidth/Height` |
| `keepScreenOn / setOverlay / setWifiAlwaysOn` | 常亮 / 悬浮窗 / WiFi 常开 | 安全空操作 |
| `permStatus / wifiStatus / checkPerms / requestWriteSettings / requestBatteryWhitelist` | 权限/设置诊断 | 返回「浏览器模式」提示 / `false` |
| `restart` | 重启 Activity | `location.reload()` |
| `setSettingsOpen` | 通知原生设置页开关 | 空操作 |

网页里**所有**网络请求（新闻 RSS、中国天气网、和风、open-meteo、wttr、IP 定位、AI）
都经由 `nativeGet() → KindleBridge.get()`，因此统一走代理，GitHub Pages 的 https 源站
下也不会触发 mixed-content / CORS 错误。

---

## 四、全部可配置项（`CFG`，默认值）

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `displayMode` | `auto` | 显示模式 auto / tablet / eink |
| `weatherAuto` | `false` | 关闭 IP 自动定位（锁定下方城市） |
| `weatherCity` | `汕头` | 天气城市（中文名或 `纬度,经度`） |
| `weatherSource` | `cn` | 天气源 cn=中国天气网 / qweather=和风 / wttr |
| `weatherDays` | `7` | 预报天数 3~14 |
| `poemLines` | `2` | 诗歌同时显示条数 |
| `rss` | 12 个预设源 | 新闻 RSS 源（可逐条增删改） |
| `keywords` | `[]` | 关键词搜索 |
| `userProxy` | `""` | 用户自填中转 |
| `jsonpEndpoint` | rss2json | RSS→JSON 公共聚合 |
| `fetchInterval` | `180s` | 抓取间隔（每轮过全部源） |
| `weatherInterval` | 默认 | 天气刷新间隔 |
| `autoFlip` | 默认 | 新闻自动翻页秒数 |
| `newsPageSize` | 默认 | 每页条数 |
| `newsSortMode` | 默认 | 排序方式 |
| `clockTick` | 默认 | 时钟刷新秒数 |
| `sysFont` | `1` | 字号微调倍率 |
| `sysFollow` | `true` | 跟随系统字号 |
| `lockLayout` | 按屏幕 | 锁定版面（水墨屏默认锁，平板默认不锁） |
| `homeScale` | `0` | 主页缩放 %（0=开机自适应冻结） |
| `gap` | `12` | 板块间距 px |
| `rotate` | `0` | 旋转角（网页版强制按横屏渲染，忽略此项） |
| `ai` | 归一化默认 | AI 助手配置（含 base / key / 提供商） |
| `radio` | 归一化默认 | 电台配置（最喜爱 + 我的列表 + 预设库） |
| `uiFont` | 100 | 电台/AI/设置三界面字号倍率 |

### 出厂新闻源（12 个）
路透社最新报道、中新网、人民网、联合早报·中国、联合早报·世界、财新网、NPR、
澎湃、BBC、谷歌全球新闻、新华网、IT之家。

### 天气源链路（优先级）
中国天气网（默认，免 Key）→ open-meteo（兜底）→ wttr.in；用户可选和风（需自备 Key）。

### AI 提供商（11 个，需自备 Key）
DeepSeek、阿里通义千问、百度千帆（文心）、腾讯混元、字节豆包、讯飞星火、阶跃星辰、
零一万物 Yi、OpenAI、Google Gemini、Groq。

### 电台
网页版直接用页面内 `<audio>` + `hls.min.js` 播放（原生前台播放模块已去除）。预设库见
`radio_presets.js`，最喜爱默认 WLTW 106.7 Lite FM。

---

## 五、转译改造说明（如何把 APK 变成静态站）

1. **提取**：解包 APK → `assets/dashboard.html` 即完整前端。
2. **桥接垫片** `bridge-shim.js`：在 `</body>` 前注入，定义 `window.KindleBridge`：
   - `get()`：先直连 `fetch`，失败走 `api.allorigins.win` / `corsproxy.io` 等 HTTPS 代理；
     文本做 URL-safe Base64 后回调 `__bridgeChunk`（与 APK 原生桥协议一致）。
   - `getPref/setPref` → `localStorage`；其余设备方法为安全空操作。
3. **横屏版式**：重写 `applyRotation()`，给 `#mainPage` 打 `landscape` 标记并抵消
   `+90°/-90°` 对消旋转，让原 `applyFit()` 按窗口等比缩放出端正宽屏仪表盘。
4. **电台**：沿用页面内 `<audio>` + `hls.min.js`，无需原生服务。

**未改动** dashboard.html 的业务逻辑（新闻链、天气链、日历拟合、诗歌轮换、设置页等），
最大程度保留原作者成果。

---

## 六、本地预览

```bash
cd kdashboard-web
python -m http.server 8080
# 浏览器打开 http://localhost:8080/
```

> 直接双击 `index.html`（file://）也能跑，但部分浏览器对 file:// 的 fetch 限制更严，
> 建议用上面的本地服务器预览。新闻/天气依赖公共 CORS 代理，需要联网。

---

## 七、发布到 GitHub Pages

本文件夹 `kdashboard-web/` 的内容就是一个完整静态站。两种发布方式：

**方式 A：仓库根目录（最简单）**
1. 新建仓库，把 `kdashboard-web/` 内的 `index.html`、`bridge-shim.js`、`hls.min.js`、
   `.nojekyll`、`README.md` 放到仓库根。
2. 仓库 Settings → Pages → Source 选 `Deploy from a branch` → 分支 `main`、目录 `/(root)`。
3. 等待约 1 分钟，访问 `https://<用户名>.github.io/<仓库名>/`。

**方式 B：docs 目录**
把上述文件放进仓库的 `docs/` 目录，Pages Source 选 `main` / `/docs`。

**方式 C：GitHub Actions（推荐，自动化）**
本文件夹已自带 `.github/workflows/pages.yml`，把 `kdashboard-web/` 整体作为仓库根推送即自动发布
（Actions 里需到 Settings → Pages → Source 选 `GitHub Actions`）。

```yaml
# .github/workflows/pages.yml  （已包含在 kdashboard-web/ 内）
name: Deploy to GitHub Pages
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: github-pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with: { path: . }            # 本文件夹即站点根
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages }
    steps:
      - uses: actions/deploy-pages@v4
```

---

## 八、已知限制

- **电台 http 流**：部分预设是 `http://` 地址，在 GitHub Pages 的 https 下会被
  mixed-content 拦截。可把电台地址改为 `https` 版本，或用自托管 http→https 反代。
- **公共代理依赖**：新闻/天气默认走 `allorigins` / `corsproxy.io` 等免费代理，
  高并发或代理不稳时可能偶发失败；可在设置里改用 `rss2json`（免费额度有限）或自建代理。
- **AI 助手**：需用户在设置里填入各提供商 API Key；浏览器直连可能受提供商 CORS 策略影响。
- **设备专属能力**（常亮、悬浮窗、WiFi 常开、设备管理员）为浏览器所无，已做无操作降级。

---

## 九、文件结构

```
kdashboard-web/
├── index.html          # 由 assets/dashboard.html 转译而来（已注入垫片）
├── bridge-shim.js      # 浏览器桥接垫片（网络/存储/设备/横屏版式）
├── hls.min.js          # HLS 播放器（电台直播）
├── .nojekyll           # 关闭 Jekyll 以避免下划线文件被忽略
└── README.md           # 本文档
```
