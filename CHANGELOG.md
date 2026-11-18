# Changelog / 更新日志

All notable changes to **Obsidian Prism** are documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

本项目遵循语义化版本（SemVer）规范，记录各正式版本的新增功能、架构变更、安全加固与缺陷修复。

## [1.0.1] - 2026-11-18

### Added / 新增特性

- **Omni 宿主原生右侧内置浏览器联动 (`omniModule` / `linkTarget`)**：修复宿主独立窗口下网页链接点击无响应问题；左键默认直连宿主原生右侧可拖拽拉伸分栏、支持原生多标签切换与 `×` 关闭的内置 Browser Tab（基于宿主隔离 `wcvBrowser` 真内核渲染，配合 `browser-hole-ancestor` 全链路透明视口穿透与三重防误注护栏，彻底消除 `X-Frame-Options` 白屏与暗色背景遮挡，按住 `Ctrl/Cmd+点击` 可临时切换系统默认浏览器）。
  - *Omni Native Right-Pane Browser Tab Integration (`omniModule` / `linkTarget`)*: Restores web link navigation in standalone host windows; opens links directly as native split-sash resizable, multi-tab closable host Browser Tabs (`wcvBrowser` isolated Chromium views with full `browser-hole-ancestor` transparent viewport pass-through, triple anti-misinjection guards, zero `X-Frame-Options` blanking, and `Ctrl/Cmd+Click` target inversion).
- **零悬停干扰纯右键操作菜单**：日常阅读保持零悬停浮条干扰，仅在右键点击（`contextmenu`）网页链接、文件药丸、Artifact 卡片、代码块路径头或 Mermaid 图表时弹出操作菜单，支持内外部浏览器/检视台打开、在文件夹中定位选中、复制绝对/相对路径、作为 `@引用` 填入输入框及 Mermaid 图表无损缩放。
  - *Right-Click Context Menu (Zero Hover Clutter)*: Keeps reading surfaces free of hover toolbars; surfaces actions strictly on `contextmenu` over links, file pills, Artifact cards, code headers, and Mermaid diagrams (open in side-pane/default app, reveal in folder, copy absolute/relative paths, insert as `@mention` into composer, and zoom Mermaid diagrams).
- **本地 `127.0.0.1` 流式媒体网关与五大侧栏检视台**：内置仅绑定本地回环接口的随机令牌鉴权 HTTP `206 Range` 流式网关，对宿主右侧边栏 `> 20MB` 超限报错文件自动原位接管切换为流式检视视图，提供五类侧栏专业检视器：① 大体积视频逐帧步进（`1/30s`）、倍速、`A-B` 区间循环与当前帧无损 PNG 截图；② 音频实时波形渲染与毫秒级时间码打点；③ SVG 与透明图像棋盘格无损缩放画布及 `1x/2x/4x` PNG 光栅化导出；④ 本地 HTML 响应式视口沙盒（支持相对路径资源加载）与 PDF 原生流式阅读；⑤ `CSV/TSV/JSONL` 冻结表头检索排序分页与 `TTF/OTF/WOFF2` 字体多字号瀑布流样张预览。
  - *Loopback HTTP `206 Range` Streaming Gateway & Five Side-Pane Viewers*: Adds a loopback-only (`127.0.0.1`) token-authenticated streaming server that automatically upgrades host `> 20MB` file-size limit views in-place into streaming workbenches: (1) frame-stepped (`1/30s`) large video inspection, `A-B` loop, and lossless PNG frame capture; (2) real-time audio waveform rendering with millisecond markers; (3) checkerboard SVG/transparent-image zoom canvas with `1x/2x/4x` PNG export; (4) responsive local HTML sandboxes and streaming PDF reader; (5) frozen-header `CSV/TSV/JSONL` table search/sorting/pagination and `TTF/OTF/WOFF2` font waterfall specimens.
- **`CSS.highlights` 零 DOM 篡改逐词水墨羽化流式淡入与裸链接激活**：采用 CSS Custom Highlight API 实现主对话与原生思考流的五级 `::highlight(ag-stream-f0..f4)` 逐词水墨羽化淡入（配合思考转译 Smooth Token Pacer 柔焦步进引擎，完结即归零至 `0fps`），并无损激活对话与终端内的裸 `http(s)://`、`localhost` 端口与本地文件路径，零 `replaceChild` 节点拆分，100% 保持宿主 React 19 `HostText` 节点完整。
  - *Zero-DOM-Mutation Ink-Feather Streaming Fade & Bare URL/Path Activation (`CSS.highlights`)*: Delivers 5-stage `::highlight(ag-stream-f0..f4)` word-level ink-feather streaming fade-ins across main responses and native thinking blocks (paired with a Smooth Token Pacer soft-focus engine in Thought Translator that settles to `0fps` on completion), while activating bare URLs, `localhost` ports, and local file paths without splitting or detaching host React 19 `HostText` nodes.
- **宿主深水区适配、26 项设置扩展与思考转译增强**：新增 `plugin://*` Sidecar 面板四主题变量实时同步桥、已完成长代码块（`>= 48` 行）Sticky 吸顶与手动折叠、左侧会话导轨章节刻度与悬停大纲过滤（含 `Alt+↑/↓` 轮次跳转）、三态 `0fps` 静态语义边缘余晖；设置中心扩充至 **26 项**可校验配置键（含 `omniModule`、`linkTarget`、5 档强调色含纯银钛单色 `mono`、3 档圆角、4 档代码字体与连字、环境光浓度、双语对照视图），提供三档场景预设（完整光效 / 专注编码 / 静默省电）、脱敏 JSON 导入/导出备份与已存翻译 API Key 一键清除按钮；思考转译新增 `file://` 行号药丸还原、本地免密 Ollama/LM Studio/vLLM 直连与并发限流队列；双端独立安装器支持直接部署完整原生 Sidecar 插件树。
  - *Host Workbench Integration, 26-Key Settings Center & Thought Translator Upgrades*: Adds real-time four-theme token syncing for `plugin://*` Sidecar iframes, sticky headers with manual folding for completed code blocks (`>= 48` lines), conversation rail outline filtering with `Alt+↑/↓` navigation, and three-state `0fps` semantic edge cues; expands the settings schema to **26** validated keys with three scene presets (Full Visuals / Deep Focus / Silent Eco), sanitized JSON config backup/restore, and one-click stored API key clearing; adds `file://` line-number jump pills, keyless local LLM endpoints, concurrency queuing, and full native Sidecar plugin deployment in Windows/macOS installers.

### Changed & Optimized / 架构重构与优化

- **`ui-runtime.js` 微内核拆分**：将原单体运行时重构为轻量微内核加 6 个独立控制器模块（`home-studio-panel.js`、`home-ripple-host.js`、`model-glyph-crystal.js`、`stream-choreography.js`、`prism-rim-canvas.js`、`host-workbench-enhancer.js`）。
  - *Microkernel Runtime Split*: Decomposes `ui-runtime.js` into a compact microkernel orchestrating 6 independent controller modules.
- **全局共享字符串池编译与双通道动态注入**：`cdp.js` 引入跨模块共享字符串池、GLSL 着色器预压缩与内嵌 CSS 常量折叠，静态主包体积收敛至 **`669.66 KiB`**（低于 `670 KiB` / `680 KiB` 门限），Omni 客户端通过独立第二通道按需注入；增量配置刷新构建耗时降至 **`< 3.6ms`**，并在 300Hz 高刷屏下将稳态背景极光限频至 `~30fps`、空闲 `1.2s` 转入 `0fps` 休眠。
  - *Shared-Pool Compiler & Dual-Channel Injection*: Upgrades `cdp.js` with a cross-module shared string pool, GLSL minification, and CSS constant folding (`669.66 KiB < 670 KiB` static main bundle, plus second-channel Omni client injection); reduces warm config refresh builds to `< 3.6ms` and enforces `~30fps` steady-state throttling with `0fps` idle sleep on 300Hz displays.
- **遥测引擎对齐 `v0.9.1`、饱满光学配额条与 1:1 原版像素点阵滑块**：`vendor/pulse-dashboard/` 对齐上游 `ATtacK030130/antigrative-dashboard` `v0.9.1`（MIT），重塑饱满实心光学渐变配额条，支持主会话与 Swarm/子代理 Token 消耗拆分、Cache 命中率与基于 CDP 进程族谱的多实例归属；Windows 平台采用 `NtQueryInformationProcess` 零 WMI 内核直读快车道（`< 520ms`），内置胶囊采用独立 `#ag-prism-pulse-bar` 宿主标识并在新建会话首页自动隐退，上下文试管卡片收敛为黄金紧凑比例且右边界向内对齐主输入框；推理等级滑块 1:1 忠实还原原版 Claude / Gemini 高对比像素方块点阵、档位刻度圆点与 `High` 档发光细边框，并支持 `mono` 纯银钛与全局动效档位联动。
  - *Telemetry `v0.9.1` Alignment, Solid Optical Quota Bars & 1:1 Pixel-Matrix Effort Slider*: Aligns `vendor/pulse-dashboard/` with `ATtacK030130/antigrative-dashboard` `v0.9.1` (MIT) with redesigned solid optical-gradient quota bars, main vs. Swarm/subagent token attribution, cache hit rate, and CDP process-lineage discovery; introduces a zero-WMI `NtQueryInformationProcess` fast path on Windows (`< 520ms`), dedicated `#ag-prism-pulse-bar` host isolation (auto-hidden on New Conversation home screens) with compact right-aligned context vial cards, and 1:1 faithful Claude / Gemini pixel-dot matrix, detent dots, and `High`-tier luminous border rendering on the effort slider.
- **冗余配置键与遗留文件清理**：清退 3 个零前端消费者的历史配置键（`ringMode`、`effortSliderStyle`、`effortAccent`），移除 `vendor/pulse-dashboard/compat/` 下 8 个无引用的遗留文件，并清理未引用的多语言死词条、冗余精灵表与废弃 CSS 样式。
  - *Legacy Key & Dead-File Cleanup*: Retires 3 unreferenced legacy config keys (`ringMode`, `effortSliderStyle`, `effortAccent`), removes 8 unused legacy files under `vendor/pulse-dashboard/compat/`, and prunes unused localization entries, sprite tables, and stale CSS rules.

### Security / 纵深安全加固

- **本地 HTML 预览单目录 HMAC 子令牌与沙盒隔离**：`/sandbox` 挂载采用 `HMAC-SHA256(secret, mountId)` 派生的单目录只读子令牌（严禁访问 `/meta`、`/stream`、`/viewer` 等其他路由，带滑动 TTL 淘汰），预览容器剥离 `allow-same-origin` 以不透明源（opaque origin）沙盒运行。
  - *Per-Directory HMAC Sub-Tokens & Opaque Sandbox Isolation*: Protects local HTML preview mounts with `HMAC-SHA256(secret, mountId)` read-only sub-tokens (isolated from `/meta`, `/stream`, and `/viewer` with sliding TTL eviction) inside opaque `sandbox` iframes without `allow-same-origin`.
- **CDP 特权绑定顶层主 Frame 上下文校验**：守护进程与跨平台 Watcher 追踪顶层 `mainFrameId` 与主世界执行上下文 ID，拒绝任何子 `<iframe>` 发起的 `__agPrism*` CDP Binding 越权调用。
  - *Top-Level Frame Verification on CDP Bindings*: Enforces top-level `mainFrameId` and main-world context validation across all `__agPrism*` CDP bindings, rejecting sub-`<iframe>` RPC calls.
- **敏感凭据文件双重拦截与远程 UNC 阻断**：本地流式网关在 `realpath` 解析前后双重拦截敏感凭据文件（`.env*`、`.ssh`、`.aws`、私钥证书、浏览器凭据库及本地翻译密钥配置等），并阻断远程 Windows UNC 网络路径（防范 NetNTLMv2 哈希泄露）与危险可执行快捷方式。
  - *Sensitive Credential & Remote UNC Blocking*: Applies pre- and post-`realpath` denylists for `.env*`, `.ssh`, `.aws`, private keys, browser credential stores, and local translator config files, while blocking remote Windows UNC paths (preventing NetNTLMv2 hash leakage) and executable shortcuts.
- **跨站请求防护、SVG 深度净化与上游 SSRF 拦截**：流式网关强制校验 `Host` 头与 `Sec-Fetch-Site`、下发严格 `CSP` 与 `Referrer-Policy: no-referrer`，`postMessage` 锁定精确源与窗口引用；检视台采用 `DOMParser` 深度剥离 SVG 脚本与外链引用；思考转译请求设置 `redirect: 'error'` 并拦截云元数据网段、`0.0.0.0` 及高危端口。
  - *Cross-Site Guards, SVG `DOMParser` Sanitization & SSRF Protection*: Enforces `Host`, `Sec-Fetch-Site`, strict `CSP`, `Referrer-Policy: no-referrer`, and exact-origin `postMessage` checks; strips active elements and external image refs in SVG via `DOMParser`; sets `redirect: 'error'` and blocks cloud-metadata IPs, `0.0.0.0`, and unsafe ports in translator requests.

### Fixed / 缺陷修复

- **根除快速连点设置回弹与脚本句柄泄漏**：引入会话级 `pendingAckEpoch` 与单飞合并广播队列，串行化启动脚本替换并过滤过期快照，确保 26 项设置连续快速切换零回弹、零句柄泄漏。
  - *Single-Flight Config Broadcast & `pendingAckEpoch` Guard*: Eliminates UI state rebound during rapid consecutive setting toggles and prevents startup script handle leaks via session-scoped `pendingAckEpoch` tracking and single-flight broadcast coalescing.
- **修复思考转译 V8 原生绑定断路与假降级徽章**：打通前端经 `window.__agPrismThoughtBridge.call` 调用后端缓存统计、清空磁盘缓存与队列取消的完整链路；修复 AI 转译成功时误显「机翻降级」徽章、取消时中断在途 SSE 流及 Windows 写盘失败临时文件残留。
  - *Thought Translator V8 Binding & Fallback Badge Fixes*: Connects cache stats, disk cache clearing, and queue cancellation through `window.__agPrismThoughtBridge.call`; fixes false fallback badge display on AI responses, aborts in-flight SSE streams on cancel, and removes temporary files on Windows rename failures.
- **修复 macOS 安装包打包遗漏、JSON PID 解析与原生 Sidecar 进程交接**：补齐 macOS `.dmg/.app` 构建脚本中的原生 Sidecar 插件树与 `omni-client.js`；修复 `remove.js` 解析 JSON 格式 `.daemon.pid` 锁文件报 `NaN` 的缺陷，并通过进程创建时间窗口与命令行签名精准核验宿主拉起的原生 `Antigravity` Sidecar 守护进程（Fail-Closed 防误杀主窗口或跨插件进程）。
  - *macOS Installer Packaging, JSON PID Lock & Native Sidecar Handover Fixes*: Includes the full native Sidecar plugin tree and `omni-client.js` in macOS `.dmg/.app` builds; fixes JSON `.daemon.pid` parsing in `remove.js` and verifies process creation timestamps and command-line signatures for host-spawned native `Antigravity` Sidecar daemons.
- **修复 Windows 代码字体/连字回退、`mono` 纯银钛同步与浅色对比度**：补齐 Windows 平台 `SF Mono -> Consolas` 字体栈与编程连字回退；对齐水试管、配额条与推理滑块的 `mono` 纯银钛单色表现；校准底栏遥测弹出卡片与像素宠物舞台的堆叠上下文层级；修复 `mascot: "minis"` 持久化、WebGL 上下文丢失 2D 自动回退，并将浅色模式检视台对比度提升至 WCAG AA 标准（`>= 4.87:1`）。
  - *Font Fallbacks, Monochrome Token Sync & WCAG AA Contrast*: Adds Windows `Consolas` fallback for `SF Mono` and code ligatures; aligns the context vial, quota bars, and effort slider with `mono` silver-titanium tokens; calibrates stacking context layering between bottom telemetry popover cards and the pixel mascot stage; fixes `mascot: "minis"` persistence, `webglcontextlost` 2D fallback, and light-mode workbench contrast (`>= 4.87:1` WCAG AA).

## [1.0.0] - 2026-11-17

### Added / 初始正式版发布

- **四套深浅光学主题**：发布深空黑曜（`obsidian`）、暖炭玄岩（`warm`）、白昼冷晶（`crystal`）与暖白画册（`alabaster`）四套配色方案，支持跟随宿主亮暗模式自动切换与简/繁/粤/英/日 5 语种界面。
  - *Four Dark/Daylight Themes*: Initial release with `obsidian`, `warm`, `crystal`, and `alabaster` palettes, automatic host light/dark tracking, and 5 UI languages (`zh-CN`, `zh-TW`, `yue`, `en`, `ja`).
- **弹簧动画、WebGL2 背景与像素宠物**：内置 4 档二阶阻尼弹簧物理引擎、底部地平线着色器与字符波纹矩阵、读写分离编辑器光标跟随及可开关的输入框桌面像素宠物。
  - *Spring Motion, WebGL2 Shaders & Pixel Mascots*: Introduces 4-tier damped spring physics, WebGL2 horizon and glyph wavefields, read/write-separated smooth caret tracking, and optional composer pixel mascots.
- **智能共存遥测、推理滑块与双模思考转译**：集成 512K 浅水波上下文胶囊、模型菜单推理等级滑块（检测到独立外部插件时自动礼貌避让 Auto-Yield）及支持机器翻译/OpenAI 兼容接口的思考转译模块，提供 Windows `.exe` 与 macOS Universal `.dmg` 独立安装器及 `GPL-3.0-only` + `NOTICE` 开源合规体系。
  - *Smart-Coexisting Telemetry, Effort Slider & Dual-Mode Thought Translator*: Ships the 512K shallow-water context vial, model-menu effort slider with Auto-Yield coexistence, dual-mode thought translation, standalone Windows/macOS installers, and `GPL-3.0-only` + `NOTICE` compliance metadata.
