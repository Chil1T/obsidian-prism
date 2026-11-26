# Obsidian Prism Architecture Constitution / 架构宪法

> **最高工程规范 / Supreme Engineering Constitution**
> 本文件定义 **Obsidian Prism（黑曜棱镜）** 的长期架构边界、十条不可违工程铁律与自动化适应度门禁（Fitness Gates）。
> 任何功能开发、重构、兼容性适配或社区 Pull Request 均须遵守本宪法，并由 `test/gates/*.test.mjs`（`npm run test:gates`）与 CI Fail-Fast 门禁自动强制执行。

---

## 十条长期架构铁律 / Ten Non-Negotiable Architecture Laws

### 铁律 ① · 零运行期外部依赖与 `L0 → L4` 单向无环 DAG
*Zero Runtime `node_modules` Dependencies & Strict `L0 → L4` Acyclic DAG*

1. **0 外部运行期 `node_modules` 依赖**：`package.json` 严禁引入运行期第三方 npm 包；Node 侧仅允许 Node.js >= 22 内置能力（`node:*`、`fetch`、`WebSocket`、`node:sqlite`、`node:test`），浏览器侧仅允许原生 Web API。
2. **严格分层单向依赖（`L0 → L4`）**：
   - **`L0` 纯叶子 / 契约层**：无副作用纯函数、静态常量、词典、配置 Schema 与通道注册表（如 `i18n-core.js`、`i18n-locales.js`、`vendor/pulse-dashboard/sidecars/panel/usage-keys.mjs`，以及规划中的 `src/config/schema.mjs`、`src/channels/registry.mjs`）。
   - **`L1` 浏览器核心组件层**：光学渲染、动效引擎、状态与 DOM 增强组件（如 `motion-engine.js`、`ripple-core.js`、`vial-core.js`、`settings-panel.js`、`style.css`）。
   - **`L2` 浏览器运行期编排与按需通道客户端层**：主运行期入口（`ui-runtime.js`）与按需延迟注入的各通道客户端（`vendor/**/*-client.js`、`vendor/**/*-settings-ui.js`、`vendor/periodic-picker/*.js`、`vendor/host-i18n/*.js`）。
   - **`L3` 本地守护、服务与编译胶水层**：`cdp.js`、`sidecars/daemon/*`、`vendor/**/*-service.mjs`、`vendor/**/*-server.mjs`、`vendor/pulse-dashboard/sidecars/*`。
   - **`L4` 入口工具、构建器、原生安装器与测试层**：`inject.js`、`remove.js`、`tools/*`、`scripts/*`、`installer/*`、`workbench/*`、`test/*`。
3. **跨层禁令**：
   - `L0`/`L1`/`L2` 浏览器前端模块**严禁**导入 `node:*` 或 `sidecars/`；
   - `L3` 守护与服务层**严禁**反向依赖 `scripts/`、`workbench/` 或 `installer/`；
   - 全仓静态 `import` / `export ... from` / `require` / `new Worker(new URL(...))` 依赖图必须保持 **严格 0 循环依赖**。

---

### 铁律 ② · 体积与膨胀棘轮
*Module Size & Monolith Ratchet*

1. **新建模块硬上限**：任何新建源码或样式文件严格 `<= 800 行` 且 `<= 40 KB (40,960 B)`。
2. **存量巨石只降不涨**：历史遗留超大文件（如 `cdp.js`、`sidecars/daemon/main.mjs`、`vendor/periodic-picker/keyboard-3d-gl.js` 等）纳入 `test/gates/architecture-fitness.test.mjs` 棘轮基线表，**只允许持平或削减，严禁继续膨胀**；新增复杂逻辑必须拆分为独立小模块。
3. **根目录冻结红线**：严禁向仓库根目录新增任何运行期 `.js` / `.css`、脚本或散落文档；根目录存量 25 个运行期文件保持原位直至 `v1.0.9+` 渐进迁入 `src/`。

---

### 铁律 ③ · 单一真相源（SSOT）
*Single Source of Truth*

1. **唯一版本源**：`package.json#version` 是全仓唯一版本真相源。Node 侧模块优先动态读取 `package.json#version`；所有静态版本锚点（`plugin.json`、`CITATION.cff`、`installer/setup/app.manifest`、C#/Swift 默认常量与浏览器兜底版本）统一由 `node scripts/bump-version.mjs <newVersion>` 一键同步，并由 `npm run version:check` 校验零漂移。
2. **唯一配置 / 通道 / 安装清单源**：配置契约（向 `src/config/schema.mjs` 收敛）、通道注册元数据（向 `src/channels/registry.mjs` 收敛）与安装资产清单（`install-manifest.json`）禁止多处手工复制粘贴导致状态漂移。

---

### 铁律 ④ · 声明式微内核扩展原则
*Declarative Microkernel & On-Demand Lazy Channels*

1. **按需延迟通道优先**：新功能与重型交互能力优先设计为独立按需通道（Channel 2~11 或独立 Sidecar 服务），而非塞入主入口 Channel 1。
2. **开关关闭三零保障**：功能开关处于 `off` 时，必须保证 **0 编译开销、0 页面注入、0 运行期常驻内存**。
3. **独立字节预算**：
   - Channel 1 全语种（`auto` + 8 语）编译产物严格 `< 549,500 B`；
   - `pulse-vial-bridge.js` 严格 `< 31,000 B`；
   - 增量 `configRefresh` 表达式（不含语言包切换）严格 `< 4,096 B`；
   - 任何涉及 Channel 1 的变更须保持字节中性或同步无损瘦身。

---

### 铁律 ⑤ · 显式有限状态机（FSM）与熔断收敛
*Explicit FSM & Content-Hash Idempotent Convergence*

1. **禁止裸布尔拼接死循环**：热自愈、通道生命周期、守护重连与 UI 挂载状态严禁通过散落布尔标志位相互触发导致振荡或死循环；须采用显式状态迁移与重入护栏。
2. **内容指纹替代墙钟防抖**：通道热重载、样式同步与构建缓存一致性判定优先采用内容 `SHA-256` 指纹（如 `codeHash`、`cssHash`、`hostI18nCodeHash`），替代脆弱的墙钟定时器防抖。
3. **熔断与退避边界**：对外部进程探测、CDP 重连与自动更新设置显式退避、上限重试与 fail-closed 降级路径。

---

### 铁律 ⑥ · CSS 与前端抗腐化
*CSS Hygiene, Shadow DOM Isolation & Trusted-Types Safety*

1. **主样式表 `style.css` 四大铁律**：
   - **0 `:has(`**：杜绝高开销结构伪类污染宿主高频 DOM 变更；
   - **100% 纯 ASCII**：防止编码差异或编码压缩污染；
   - **括号严格配平**（`{}` / `()` / `[]`）；
   - **规避 Chromium CSSOM 陷阱**：严禁在含 `var(...)` 的简写属性后再叠加同族长写覆写。
2. **CSS 变量命名空间棘轮**：严禁新增 `--_*` 或长度 `<= 4` 字符的短变量名（历史存量纳入棘轮白名单只减不增）；插件自建独立 UI 优先使用 Shadow DOM 与 `--ag-prism-*` 语义前缀隔离宿主样式。
3. **运行期 0 新增 `innerHTML`**：运行期 JS 严禁新增 `innerHTML` / `outerHTML` / `insertAdjacentHTML` 写入（免疫 Trusted Types 限制与 XSS），优先使用纯 DOM API（`createElement` / `createElementNS` / `textContent` / `replaceChildren`）；历史极少量残留登记在棘轮清单中只减不增并逐步清零。

---

### 铁律 ⑦ · 防杀软、防风控与零隐私四防铁律
*AV Hygiene, Host Safety, Loopback Networking & Zero Privacy Leak*

1. **防杀软红线（全仓含 `vendor/`、`installer/`、`scripts/`）**：
   - 永久禁绝隐藏 PowerShell（`-WindowStyle Hidden`、`-EncodedCommand`）、WMI 进程查询/拉起（`Win32_Process`、`Get-CimInstance`、`Get-WmiObject`）、`Add-Type` 动态 C# 编译、`WScript.Shell` COM 反射，以及大段内联 `node -e` 自删脚本；
   - Phase 1 待清零的少量历史残留登记在 `test/gates/security-redteam.test.mjs` 的临时清零棘轮表中，严禁扩散至任何其他文件，清零后彻底锁死为 `0`。
2. **防宿主风控红线**：
   - **CDP Domain 永久白名单**：全仓只允许 `Page.*`、`Runtime.*`、`Target.*` 与 `Browser.close`；严禁出现 `Network.*`、`Fetch.*`、`Debugger.*`、`Input.*`、`Emulation.*` 调用；
   - **宿主二进制与数据库物理绝缘**：严禁修改 `app.asar` 或宿主二进制；严禁打开宿主 `state.vscdb` 或向在线 `conversations/*.db` 传入 SQLite 打开句柄；严禁对 `Antigravity.exe` 或 `language_server` 执行跨进程 `EmptyWorkingSet`、非只读 `OpenProcess`、`taskkill`、`Stop-Process`、`SIGKILL`。
3. **本地 HTTP 与出网安全**：
   - 所有 `http.createServer` 必须严格绑定 `127.0.0.1`（或 `localhost` 回环地址），并校验 `Host` 与 `Origin` / `Sec-Fetch-Site`；
   - 所有外部出网模块强制校验目标协议与主机防 SSRF，禁止向远端非本地明文 `http://` 外发 API Key 或凭据。
4. **零隐私与凭据安全**：
   - 日志、缓存与状态文件使用 `0o600` 最小权限落盘，敏感路径与密钥强制脱敏；绝不记录或上传用户提示词、私密路径或鉴权令牌。

---

### 铁律 ⑧ · 原子升级与用户数据绝对隔离
*Atomic Upgrades & Strict User-Data Isolation*

1. **原子落盘**：配置、缓存、清单与安装文件升级须通过同目录临时文件 + 原子替换（`rename` / `MoveFileExW`）完成，禁止半截写入破坏用户现场。
2. **用户数据绝对保护**：热同步、增量更新与卸载默认严格保留并绝不覆盖用户目录中的 `config.json`、`*cache*.json`、`wallpapers/`、`custom.css` 及本地对话归档数据。

---

### 铁律 ⑨ · 8 语种一等公民与文案净洁
*8 First-Class Locales & Clean Terminology*

1. **统一 8 语种一等公民**：全仓 UI 与服务端文案统一收口至 **`zh-CN`、`zh-TW`、`en`、`ja`、`ko`、`es`、`fr`、`de`** 8 个标准语种；非 CJK 语种（`en`、`ko`、`es`、`fr`、`de`）严格 **0 汉字（CJK）泄漏**。
2. **0 新增 `yue` 独立分支**：严禁在词典表或 UI 选项中新增或保留 `yue` 独立列；仅在 `normalizeLanguage` 等语言规范化入口保留将历史 `'yue'` / `'zh-yue'` 平滑映射为 `'zh-CN'` 的向后兼容逻辑。
3. **0 禁用词与版权归属**：所有面向用户的文案、文档、`CHANGELOG.md` 与元数据严禁出现禁用词（如第三方游戏译名/英文原名）；3D 元素周期表模块保留原设计来源与 GPL-3.0 协议归属说明。

---

### 铁律 ⑩ · 契约测试与渐进重构
*Contract Testing & Incremental Refactoring*

1. **禁止版本号碎片测试**：严禁新增 `v10x-*.test.mjs` 或 `issueXX-*.test.mjs` 按版本号/单号命名的碎片测试文件；新增回归用例统一按模块域组织或追加至对应域测试文件。
2. **所有文本文件编码统一**：受跟踪核心文本文件严格保持 **UTF-8 无 BOM + LF 换行**。
3. **双层必跑验收**：每次提交前必须依次通过秒级门禁与全量并发测试：
   ```bash
   npm run test:gates
   npm run version:check
   node --test --test-concurrency=4 test/*.test.mjs test/gates/*.test.mjs
   ```

---

## 自动化适应度门禁总览 / Automated Fitness Gates (`test/gates/`)

| 门禁文件 | 守护铁律 | 核心校验内容 |
| --- | --- | --- |
| [`repo-hygiene.test.mjs`](../test/gates/repo-hygiene.test.mjs) | ② ⑩ | 目录规范、根目录白名单棘轮、宪法/文档相对链接有效、测试命名棘轮 |
| [`architecture-fitness.test.mjs`](../test/gates/architecture-fitness.test.mjs) | ① ② ⑥ | 0 外部依赖、0 循环依赖（含 Worker 边）、`L0→L4` 分层、文件行数/体积棘轮、CSS 变量/卫生棘轮、运行期 `innerHTML` 棘轮 |
| [`bundle-budget.test.mjs`](../test/gates/bundle-budget.test.mjs) | ④ ⑩ | Ch1 (`auto` + 8 语) `< 549,500 B`、`pulse-vial-bridge.js < 31,000 B`、`configRefresh < 4,096 B`、全仓 0 BOM / 0 CRLF |
| [`security-redteam.test.mjs`](../test/gates/security-redteam.test.mjs) | ⑦ | CDP Domain 永久白名单、宿主 `.db` 物理绝缘、全仓 AV 红线（含临时清零棘轮表）、本地 HTTP 强制 `127.0.0.1` 绑定 |
| [`i18n-and-version-sync.test.mjs`](../test/gates/i18n-and-version-sync.test.mjs) | ③ ⑨ | 8 语种完整度 + 非 CJK 0 汉字 + 0 `yue` 独立词典、0 禁用词、`bump-version.mjs` 全静态版本锚点与 `CHANGELOG.md` 卫生校验 |

---

## 版本升级标准操作 / Version Bump Workflow

```bash
# 1. 校验当前所有静态版本锚点与 package.json#version 一致，以及 CHANGELOG 格式
npm run version:check

# 2. 发版时一键同步全部静态版本锚点（package.json / plugin.json / CITATION.cff / app.manifest / C# / Swift / 前端兜底常量等）
node scripts/bump-version.mjs <newVersion>
```
