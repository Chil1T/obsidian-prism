# AGENTS.md — Obsidian Prism 变更黄金路径与防篡改合同

> **定位 / Role**
> 本文件是所有 AI 编码代理（Claude Code / Codex / Cursor / Antigravity / Swarm Workers）在 **Obsidian Prism（黑曜棱镜）** 仓库执行新功能开发、Bug 修复与重构时必须遵守的**不可违变更合同（Immutable Change Contract）**。
>
> - 最高架构宪法与十条工程铁律：[`.github/ARCHITECTURE.md`](./.github/ARCHITECTURE.md)
> - 不可回退架构决策卡（ADR）：[`docs/adr/README.md`](./docs/adr/README.md)

---

## 一、黄金路径手册 / Golden Paths

### ① 新增通道或交互功能（Microkernel Channel）

1. **唯一登记入口**：仅在 [`src/channels/registry.cjs`](./src/channels/registry.cjs) 的 `CHANNEL_REGISTRY` 注册新通道，配齐 `configKeys`、`files`、独立 `budgetBytes`、`shouldEnable()`、`build()`、`teardown`（登记于 [`src/channels/channel-teardowns.cjs`](./src/channels/channel-teardowns.cjs)）及探针字段。
2. **配置契约同步**：在 [`src/config/schema.cjs`](./src/config/schema.cjs) 声明配置键、默认值与校验器，并 100% 同步 [`config.example.json`](./config.example.json)。
3. **8 语种一等公民**：补齐 `zh-CN` / `zh-TW` / `en` / `ja` / `ko` / `es` / `fr` / `de`（非 CJK 语种 **0 汉字**，严禁新增 `yue` 独立词典或选项）。
4. **硬性禁令**：
   - 严禁向 Channel 1（[`ui-runtime.js`](./ui-runtime.js) 首屏主包）硬塞非首屏大模块；
   - 严禁在守护进程、[`inject.js`](./inject.js) 或 [`scripts/build-common.mjs`](./scripts/build-common.mjs) 中新增平行通道表；
   - 开关处于 `off` 时必须保持 **0 编译、0 页面注入、0 运行期常驻内存**。

### ② 修复 Antigravity 宿主兼容性（Host Compatibility）

1. 先运行兼容性诊断探针定位断裂选择器与影响面：
   - 在线探测：`node scripts/probe-host-compat.mjs --live`
   - 离线快照：`node scripts/probe-host-compat.mjs --snapshot`
2. 所有跨模块宿主 UI 选择器统一收口至 [`src/compat/host-selectors.cjs`](./src/compat/host-selectors.cjs)（主锚点 → `.agy-*` 语义降级 → 标注 `fragile: true` 的结构兜底），并在对应调用点标注 `@host-compat`。

### ③ 升级、写盘与热同步（Atomic Persistence & Hot-Sync）

1. 安装、热同步与增量升级必须经由 [`src/platform/install-manifest.cjs`](./src/platform/install-manifest.cjs) 四阶段原子事务引擎（同目录临时文件 + 校验 + 原子替换）落盘。
2. **严禁**使用裸 `fs.copyFileSync`、`fs.writeFileSync` 直覆或 `rm -rf` 覆盖/删除用户目录受保护资产（`config.json`、`custom.css`、`wallpapers/`、`backups/`、`*cache*.json`）。

### ④ 后台守护、模块化与扩展名纪律（Daemon, Composition & Module Discipline）

1. **扩展名不可混用**：`src/{utils,config,cdp,compat,compiler,channels,platform}/` 统一 `.cjs`；`src/daemon/` 与 `src/security/` 统一 `.mjs`；严禁 `.cjs` 同步 `require('*.mjs')`（保障 Node `22.0–22.11` 零 `ERR_REQUIRE_ESM`）。
2. **严禁原型混入与裸布尔死循环**：
   - 严禁 `Object.assign(*.prototype, ...)` 上帝对象与散落布尔轮询自愈；
   - 统一使用 [`SessionRegistry`](./src/daemon/session-registry.mjs)、[`ChannelOrchestrator`](./src/daemon/channel-orchestrator.mjs)、[`TelemetrySubsystem`](./src/daemon/telemetry-subsystem.mjs)、[`UpdateStorageSubsystem`](./src/daemon/update-storage-subsystem.mjs) 显式组合，以及 [`session-fsm.mjs`](./src/daemon/session-fsm.mjs) 显式有限状态机（FSM + 3 次熔断 + SHA-256 内容指纹）。
3. **四防安全红线**：0 运行期 npm 依赖、0 `innerHTML` 写入、0 隐藏 PowerShell/WMI/`Add-Type`/`WScript.Shell`/大段 `node -e`、CDP 严格白名单（仅 `Page.*` / `Runtime.*` / `Target.*` / `Browser.close`）、严禁触碰 `app.asar` 与宿主 `.db`、本地 HTTP 严格绑定 `127.0.0.1`。

### ⑤ 发版与版本同步（Version SSOT）

- 唯一版本真相源为 [`package.json`](./package.json) 的 `version` 字段；
- 发版升版统一执行 `node scripts/bump-version.mjs <ver>`，并运行 `npm run version:check` 校验全仓静态版本锚点零漂移。

---

## 二、门禁不可篡改铁律 / Immutable Gates Lock

> **红线指令 / HARD LOCK**
>
> **在任何新功能开发、Bug 修复或常规重构任务中，AI 编码代理绝对禁止擅自放宽 `test/gates/*` 的字节/行数阈值、删除安全或架构断言、降低棘轮上限，或往任何豁免白名单（`LEGACY_*` / `ALLOWED_*`）中新增条目！**
>
> 若确遇极端例外（如无法绕过的平台约束或确需调整门禁规则），AI **必须立刻停手**，向人类维护者提交原因、影响评估与替代方案，待**人类维护者显式审批**并在 [`docs/adr/`](./docs/adr/README.md) 新增对应 ADR 决策卡后，方可变更门禁。

---

## 三、写/审分离 6 项变更影响核验表 / Change Impact Checklist

提交或交卷前，编写代理与审查代理必须逐项核对以下 6 项（任一失败即退回整改）：

- [ ] **1. 边界与分层（DAG & Extensions）**：是否保持 `0` 外部 npm 依赖、`L0 → L4` 与 `src/` 四级单向无环、`src/` 扩展名规范及新建文件 `<= 800` 行 / `<= 40 KB`？
- [ ] **2. 通道与预算（Channels & Ch1 Budget）**：新增逻辑是否走按需通道而非塞入 Ch1？Ch1 全 8 语（+ `auto`）是否 `< 390,000 B`、`configRefresh < 4,096 B`、开关 `off` 时 `0 B`？
- [ ] **3. 契约与语种（Schema, I18n & Copy）**：`src/config/schema.cjs` 与 `config.example.json` 是否 100% 对齐？8 语种是否完整、非 CJK 0 汉字、0 `yue` 独立词典、0 禁用词？
- [ ] **4. 宿主与安全（Safety & AV Redlines）**：是否 0 `innerHTML`、0 `:has(`、100% ASCII CSS？是否零新增 AV 红线词条、CDP 严守白名单、100% `127.0.0.1` 回环绑定？
- [ ] **5. 状态与落盘（FSM & Atomic I/O）**：是否避开原型混入与墙钟防抖、使用显式 FSM/内容哈希，且写盘走 `install-manifest.cjs` 原子事务不覆写用户数据？
- [ ] **6. 测试与卫生（Tests & Hygiene）**：是否按模块域命名测试（严禁 `v10x-*`/`issueXX-*`）、所有文本为 **UTF-8 无 BOM + LF**、Markdown 相对链接全部有效？

---

## 四、必跑验证命令 / Mandatory Verification Commands

每次修改完成后，必须按顺序实跑以下三条命令并确认全部通过（`0 fail` / `exit 0`）：

```bash
# 1. 秒级架构、安全红线、体积预算、语种版本与仓库卫生门禁
npm run test:gates

# 2. 单一版本真相源（SSOT）与 CHANGELOG 卫生校验
npm run version:check

# 3. 全量并发单元测试 + 门禁回归套
node --test --test-concurrency=4 test/*.test.mjs test/gates/*.test.mjs
```

---

## 五、延伸索引 / References

- 最高架构宪法与十条铁律：[`.github/ARCHITECTURE.md`](./.github/ARCHITECTURE.md)
- 不可回退架构决策记录（ADR）：[`docs/adr/README.md`](./docs/adr/README.md)
- 代码签名与发布合规策略：[`docs/CODE_SIGNING_POLICY.md`](./docs/CODE_SIGNING_POLICY.md)
- 贡献指南与测试夹具约定：[`.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.md)
