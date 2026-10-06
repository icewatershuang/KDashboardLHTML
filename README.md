# KDashBoardL 横版仪表盘 · 静态网页版（GitHub 发布）

> 来源 APK：`KDashBoardL_V4.1_808最终版横屏.apk`（本仓库已随附改版 APK，见 `apk/`）
> 原程序作者：水哥（WATERS）　|　本仓库为「提取 HTML + 全部配置并转译为可发布的静态网页」

这是一个 Android WebView 水墨屏仪表盘（时钟 / 日历 / 天气 / 新闻 / 诗歌 / 电台 / AI）。
UI 与全部逻辑都写在 `assets/dashboard.html` 里（约 1 MB 单文件），外层只是极薄的
原生壳。本仓库把它**原样提取**，再用一个浏览器桥接垫片（`bridge-shim.js`）替换掉
安卓原生能力，从而无需任何后端即可作为**纯静态网页**部署到 GitHub Pages。

**在线访问**：<https://icewatershuang.github.io/KDashboardLHTML/>

---

## 一、APK 身份与结构

| 项目 | 值 |
|---|---|
| 包名 | `com.kindledash.landscape` |
| 版本名 / 构建号 | **V4.1 / 808**（文件名尾部 `_808`） |
| SDK 范围 | `minSdk 14`（Android 4.0）/ `targetSdk 34`（Android 14）/ 编译于 API 36 |
| 目标设备 | Topsir H9 / 海尔 9.7" 水墨屏，1200×825 横屏，安卓 4.0.4 |
| 应用名 / 作者 | KDashBoardL / 水哥（WATERS） |
| 兼容范围 | 安装门槛 Android 4.0 起、无上限；v1+v2 双签覆盖全代际 |

**原生组件（Java）**
`MainActivity`（启动器 + HOME 类别，相当于桌面 kiosk）、`KdMusicService`（音频播放）、
`KeepService`（保活）、`OverlayService`（悬浮窗）、`BootReceiver`（开机自启）、
`WatchdogReceiver`（看门狗）、`NetReceiver`（网络监听）、`DevAdminReceiver`
（设备管理员 watch-login）。

**权限**：INTERNET、ACCESS_NETWORK_STATE / WIFI_STATE、CHANGE_WIFI_STATE、WAKE_LOCK、
RECORD_AUDIO、MODIFY_AUDIO_SETTINGS、FOREGROUND_SERVICE（media/microphone/special_use）、
POST_NOTIFICATIONS、READ_EXTERNAL_STORAGE、READ_MEDIA_AUDIO、RECEIVE_BOOT_COMPLETED、
RECEIVE_USER_PRESENT、SYSTEM_ALERT_WINDOW、USE_FULL_SCREEN_INTENT、WRITE_SETTINGS、
REQUEST_IGNORE_BATTERY_OPTIMIZATIONS、SCHEDULE_EXACT_ALARM、DISABLE_KEYGUARD、
REQUEST_DELETE_PACKAGES。

**网络策略**：`res/xml/network_security_config.xml` 开启 `cleartextTrafficPermitted` 并信任
系统 + 用户证书（即「宽松 HTTPS」，原生桥可忽略证书错误抓 https）；
`application` 上另开 `usesCleartextTraffic=true`。

**代际适配（实测确认）**：网页层为纯 ES5（箭头函数 / let / const / 模板串 / class /
async 全为 0），并自带「Android 4.0 兼容垫片」——`Promise` / `fetch` 在缺失时注入最小实现；
CSS 变量由 `kdResolveCssVars()` 运行时解析。原生层含 `checkSelfPermission` /
`requestPermissions`（6.0+ 运行时权限）、`createNotificationChannel` /
`startForegroundService`（8.0+）、`evaluateJavascript` + `loadUrl` 双路径。

---

## 二、本仓库内容清单

| 文件 | 说明 |
|---|---|
| `index.html` | **核心**：由 V4.1 的 `assets/dashboard.html` 原样转译（末尾注入垫片引用） |
| `bridge-shim.js` | 浏览器桥接垫片（网络 / 存储 / 横屏版式 / 若干版面修复） |
| `hls.min.js` | HLS 播放器（电台 `.m3u8` 直播流用），与 V3.3/V4.1 完全同源 |
| `radio_presets.js` | 电台预设库，与 V3.3/V4.1 完全同源 |
| `apk/KDashBoardL_V4.1_808_10s.apk` | **改版 APK**：首次授权引导框已精简（见下） |
| `.nojekyll` | 关闭 Jekyll，避免下划线文件被忽略 |
| `README.md` | 本文档 |

> 提取自 APK 的原始文件（`AndroidManifest.xml`、`classes.dex`、`res/xml/*`）未随站发布，
> 仅作分析参考；站点只包含浏览器需要的 4 个文件。

---

## 三、随附 APK 的改动说明（`apk/KDashBoardL_V4.1_808_10s.apk`）

原版 V4.1 首次安装会弹一个**全屏授权引导框**：四张权限卡（电池白名单 / 通知 / 存储 /
自启动）+ 重新检测 + 权限状态输出。本改版把它精简为：

- **两句话**：提示用户到后台「设置」中为本应用授予相应权限，并说明未授权时部分功能会受限；
- 打开 **10 秒后自动消失**（带倒计时提示）；
- 也可随时点「**跳过**」立即关闭；
- 关闭后记住，之后不再弹；设置页原有的「首次权限引导」入口保留。

**除这一个弹窗外，其余内容与原版逐字节一致**（`AndroidManifest.xml`、`classes.dex`、
`resources.arsc`、`hls.min.js`、`radio_presets.js` 均未改动，已做逐条目哈希比对）。

> ⚠️ **签名提示**：改版 APK 使用本仓库维护者的密钥（CN=KindleDash）重签，
> 与原作者的 CN=KDashBoardL 签名不同。因此**不能覆盖安装**，
> 需先卸载原版再装（会清空应用内配置）。原签名私钥不在本机，无法保留原签名。

---

## 四、原生桥 `KindleBridge` API 一览（被垫片模拟）

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

## 五、网页版相对 APK 的适配点（`bridge-shim.js`）

1. **桥接**：`KindleBridge.get()` 用 `fetch` 直连 + 公共 CORS 代理兜底，协议与原生桥一致。
2. **横屏版式**：重写 `applyRotation()`，抵消 `+90°/-90°` 对消旋转，给 `#mainPage` 打
   `landscape` 标记，让原 `applyFit()` 按窗口等比缩放出端正宽屏仪表盘。
3. **授权引导框**：V4.1 新增的 `#onboard` 全屏弹窗在浏览器里没有意义（没有系统权限可授予，
   而垫片实现了 `KindleBridge.get` 会让 `bridgeOK()` 误判为真），已整体屏蔽；
   设置页里点「首次权限引导」会得到一句网页版说明而非空弹窗。
4. **诗歌自适应**：V4.1 默认一次显示中英两条诗，英文句子长会折行，卡片装不下（实测需
   160px、只有 119px）。垫片按可用高度把诗歌字号收敛到刚好放下（只缩不放，
   写进样式表以压过应用自身每轮轮换重写的内联字号），每次轮换后自动重算。
5. **日历今日高亮**：原版把 `today` 拼在 `class` 引号外，浏览器当成布尔属性，
   法定假日 / 调休 / 公历节日当天的今日高亮会丢；垫片补写 `today` 类并清残留伪属性。
6. **中段两列等宽**：旧竖版遗留的 flex 规则会把日历挤到 147px；垫片钉回 50/50，
   并在老引擎上用像素宽兜底。
7. **电台**：沿用页面内 `<audio>` + `hls.min.js`；播放按钮只在真正出声时才点亮，
   死台自动换台（最多 3 次），失败给出明确提示；默认台换为国内 https 台。
8. **音乐**：浏览器端用 `<input webkitdirectory>` 选本机文件夹，收进虚拟目录树播放，
   支持顺序 / 随机两种模式与续播记忆；无任何上传行为。
9. **字号校准**：天气 / 诗歌 / 新闻 / 底部按钮按 APK 相对比例 ×0.8，横屏媒体查询内生效。

**未改动** dashboard.html 的业务逻辑（新闻链、天气链、日历拟合、设置页等），
最大程度保留原作者成果。

---

## 六、全部可配置项（`CFG`，默认值）

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `displayMode` | `auto` | 显示模式 auto / tablet / eink |
| `weatherAuto` | `false` | 关闭 IP 自动定位（锁定下方城市） |
| `weatherCity` | `汕头` | 天气城市（中文名或 `纬度,经度`） |
| `weatherSource` | `cn` | 天气源 cn=中国天气网 / qweather=和风 / wttr |
| `weatherDays` | `7` | 预报天数 3~14 |
| `poemLines` | `2` | 诗歌同时显示条数（V4.1 默认中英各一条） |
| `rss` | 12 个预设源 | 新闻 RSS 源（可逐条增删改） |
| `keywords` | `[]` | 关键词搜索 |
| `userProxy` | `""` | 用户自填中转 |
| `jsonpEndpoint` | rss2json | RSS→JSON 公共聚合 |
| `fetchInterval` | `180s` | 抓取间隔（每轮过全部源） |
| `ai` | 归一化默认 | AI 助手配置（含 base / key / 提供商） |
| `radio` | 归一化默认 | 电台配置（最喜爱 + 我的列表 + 预设库） |
| `sysFont` | `1` | 字号微调倍率 |
| `homeScale` | `0` | 主页缩放 %（0=开机自适应冻结） |

### 出厂新闻源（12 个）
路透社最新报道、中新网、人民网、联合早报·中国、联合早报·世界、财新网、NPR、
澎湃、BBC、谷歌全球新闻、新华网、IT之家。

### 天气源链路（优先级）
中国天气网（默认，免 Key）→ open-meteo（兜底）→ wttr.in；用户可选和风（需自备 Key）。

### AI 提供商（11 个，需自备 Key）
DeepSeek、阿里通义千问、百度千帆（文心）、腾讯混元、字节豆包、讯飞星火、阶跃星辰、
零一万物 Yi、OpenAI、Google Gemini、Groq。

---

## 七、本地预览

```bash
cd kdashboard-web
python -m http.server 8080
# 浏览器打开 http://localhost:8080/
```

> 直接双击 `index.html`（file://）也能跑，但部分浏览器对 file:// 的 fetch 限制更严，
> 建议用上面的本地服务器预览。新闻/天气依赖公共 CORS 代理，需要联网。

---

## 八、发布到 GitHub Pages

本文件夹即一个完整静态站。仓库已带 `.github/workflows/pages.yml`，
推送到 `main` 即自动发布（Settings → Pages → Source 选 `GitHub Actions`）。
访问 <https://icewatershuang.github.io/KDashboardLHTML/>。

---

## 九、已知限制

- **公共代理依赖**：新闻/天气默认走 `allorigins` / `corsproxy.io` 等免费代理，
  高并发或代理不稳时可能偶发失败；可在设置里改用 `rss2json`（免费额度有限）或自建代理。
- **电台 http 流**：部分预设是 `http://` 地址，在 https 站点下会被 mixed-content 拦截；
  网页版遇到播不出的台会自动换下一个，并提示原因。
- **AI 助手**：需用户在设置里填入各提供商 API Key；浏览器直连可能受提供商 CORS 策略影响。
- **设备专属能力**（常亮、悬浮窗、WiFi 常开、设备管理员、开机自启）为浏览器所无，
  已做无操作降级；对应的授权引导框也已按上文说明屏蔽。
- **APK 改版签名**：见第三节，覆盖安装需先卸载。

---

## 十、文件结构

```
kdashboard-web/
├── index.html                       # 由 V4.1 assets/dashboard.html 转译（已注入垫片）
├── bridge-shim.js                   # 浏览器桥接垫片（网络/存储/横屏/版面修复）
├── hls.min.js                       # HLS 播放器（电台直播）
├── radio_presets.js                 # 电台预设库
├── apk/
│   └── KDashBoardL_V4.1_808_10s.apk # 改版 APK（授权引导框精简为两句话+10秒）
├── .github/workflows/pages.yml      # Pages 自动发布
├── .nojekyll
└── README.md                        # 本文档
```
