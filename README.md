# Obsidian Prism · 黑曜棱镜 (v1.0.0)

<p align="center">
  <img src="assets/logo.svg" width="104" height="104" alt="Obsidian Prism Logo" />
</p>

<p align="center">
  <strong>Optical UI, Spring Choreography &amp; Dual-Mode Thought Suite for Antigravity</strong><br/>
  统一光学主题 · 四档物理弹簧编排 · 白昼水晶双预设 · 512K 遥测试管 · 星空推理滑块 · 双模思考转译
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-blue.svg" alt="License: GPL-3.0" /></a>
  <a href="./NOTICE"><img src="https://img.shields.io/badge/Attribution-Required%20(NOTICE)-purple.svg" alt="Attribution Required" /></a>
  <a href="https://github.com/RMvdesi/obsidian-prism/actions"><img src="https://img.shields.io/github/actions/workflow/status/RMvdesi/obsidian-prism/ci.yml?branch=main&label=CI" alt="CI Status" /></a>
</p>

> **非官方社区项目与商标免责声明 (Non-Affiliation Disclaimer)**
>
> **Obsidian Prism is an independent open-source project and is not affiliated with or endorsed by Google LLC.**
> 本项目为独立的开源社区工程，与 Google LLC 无任何隶属、赞助或官方背书关系；文中提及的 “Antigravity” 与 “Google” 仅作兼容性说明用途。

---

## 一、开箱即用安装指南 (Quick Start)

Obsidian Prism 提供 **「免环境图形安装器」** 与 **「原生插件守护一键部署」** 双轨使用方式，重启或刷新 Antigravity 均会自动常驻生效、不丢失：

### 方式 A：图形化一键安装器（推荐普通用户，免装 Node 环境）
前往 [**GitHub Releases**](https://github.com/RMvdesi/obsidian-prism/releases) 下载对应系统安装包：
- **Windows**：运行 `obsidian-prism-installer.exe`，点击一键安装即可自动注入并配置开机守护（亦支持卸载一键无痕还原）。
- **macOS (Apple Silicon & Intel Universal)**：打开 `Obsidian-Prism-macOS-universal.dmg`，运行 `Obsidian Prism.app` 一键完成部署与 LaunchAgent 自启配置。

### 方式 B：源码一键部署为 Antigravity 原生插件（推荐开发者，支持面板内一键拉取 Git 更新）
```bash
git clone https://github.com/RMvdesi/obsidian-prism.git
cd obsidian-prism

# 一键安装至 ~/.gemini/config/plugins/obsidian-prism 并启动常驻守护进程
npm run install:plugin
```
安装完成后打开 **Antigravity → 设置 (Settings) → 外观 (Appearance)**，即可看到可折叠的 **「Obsidian Prism · 黑曜棱镜」** 控制面板（支持在「关于」专区一键检查并热同步最新 Git 提交）。

<details>
<summary>常用命令行工具说明（单次注入 / 无痕移除 / 自编译安装包）</summary>

```bash
# 单次实时注入当前已打开的 Antigravity 窗口
npm run inject

# 无痕移除注入样式与组件，立即恢复 Antigravity 原生界面
npm run remove

# 无损清理历史旧版 app.asar 中的遗留代码块（100% 保护汉化与外部插件）
npm run clean:legacy

# 本地运行全量跨模块安全与回归单测
npm test

# 本地自编译独立安装包（Windows .exe / macOS Universal .dmg）
npm run build:installer
npm run build:macos
```
</details>

---

## 二、核心光学特性与模块矩阵

| 模式 | 预设标识 | 侧栏底色 | 主画布 | 输入舱与悬浮卡 | 光学特征 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **深色默认** | `palette: "obsidian"` | 深空黑曜 | 暗晶深海 | 高不透明暗晶微渐变 | 四色极光丝滑呼吸流淌、零高斯模糊重采样开销 |
| **深色暖调** | `palette: "warm"` | 暖炭玄岩 | 温润深褐 | 暖晶微描边卡片 | 琥珀暖金微光与柔和长文阅读对比度 |
| **浅色预设 1** | `lightPreset: "crystal"` | `#E8EEF6` 冰川冷雾 | `#F4F7FB` 冷瓷白 | `#FFFFFF` 纯白双层投影 | **白昼冷晶**：白瓷芯四色运行环、皇家钴蓝导引线、晴空蓝高硼硅试管 |
| **浅色预设 2** | `lightPreset: "alabaster"` | `#EBE6DC` 砂岩亚麻 | `#F6F4EE` 暖白画册 | `#FFFFFF` 象牙微投影 | **暖白画册**：温润纸感层次、四色彩虹棱镜焦散扫光 |

- **四档物理弹簧动效引擎 (`off` / `subtle` / `standard` / `ultra`)**：从新建会话到正式会话的光学英雄过渡、双轨流式吐字柔化、按钮微弹阻尼反馈与 21 枚微动态矢量图标，完美遵循系统 `prefers-reduced-motion` 无障碍设置。
- **GPU 合成器减负与 `0fps` 静默休眠**：移除常驻多层 `backdrop-filter` 重采样开销；会话地平线极光采用 `32%` 视口裁剪 + `0.72x` 分辨率（GPU 占用 `< 0.4%`），窗口失焦或 `subtle`/`off` 档位下严格进入 **`0fps`** 休眠。
- **像素双宠微生态舞台 (`Clawd` 小橘蟹 & 小紫猫)**：刚体防重叠间距、抛物线跃过、最多 5 层叠叠乐图腾拖拽物理与低频帧缓存。
- **512K 高硼硅物理水试管 & 星空推理滑块（智能共存让位）**：
  - `telemetryModule: "auto"`：检测到外部独立 Pulse 插件时 **0 重复轮询**礼貌让位；独立运行时自动采样 TPS / TTFT / 缓存命中率并驱动物理浅水波试管；
  - `effortSliderModule: "auto"`：检测到外部推理滑块实例时 **100% 自动让位**，内置启用 `120ms` 节流防抖。
- **内置双模思考转译与润色（`极速机翻` / `OpenAI 协议流式 AI 翻译`）**：
  - 支持多渠道 BaseURL + API Key 预设切换、`GET /v1/models` 实时拉取上游模型与毫秒级连通测速；
  - 所有 API 密钥与自定义提示词均以 **`0600` 权限**仅保存在本机 `~/.gemini/config/obsidian-prism-thought.json`，零遥测上传、零日志回显；流式输出期间「原文」切换按钮 **0 闪烁、0 重排**。

---

## 三、目录结构概览

```text
obsidian-prism/
├── plugin.json                         # Antigravity 原生插件清单 (obsidian-prism@1.0.0)
├── LICENSE / NOTICE / CITATION.cff     # GPL-3.0 许可证、强制署名声明与官方仓库引用元数据
├── THIRD_PARTY_NOTICES.md              # 吸收整合的上游 MIT 项目完整版权与许可声明
├── assets/                             # 黑曜棱镜真矢量图标与像素精灵矢量资源
├── cdp.js / inject.js / remove.js      # 零依赖词法压缩构建器、CDP 热接管与无痕还原协议
├── style.css                           # 黑曜/暖岩双深色 + 冷晶/暖白双浅色样式表
├── i18n-locales.js / i18n-core.js      # 简/繁/粤/英/日 5 语种多语言词条
├── motion-engine.js / animated-icons.js# 4 档二阶阻尼谐振子弹簧引擎与 21 枚微动态图标
├── ripple-core.js / conv-aura.js       # WebGL2 地平线极光、四态会话流光与字符水波纹矩阵
├── smooth-caret.js                     # FastDOM 读写分离零强制重排丝滑光标引擎
├── vial-core.js / pulse-vial-bridge.js # 512K 物理浅水波试管与遥测浮窗桥接器
├── dual-mascot-rig.js                  # 双宠微生态走廊、刚体分离与叠叠乐物理引擎
├── settings-panel.js                   # 可折叠外观设置面板、Git 同步与开源致谢专区
├── ui-runtime.js                       # 增量脏节点调度与模块协调核心
├── sidecars/daemon/                    # 常驻守护 Sidecar (自动重连、遥测桥、思考转译桥)
├── vendor/                             # 吸收整合的遥测采集、推理滑块与双模思考转译组件
├── installer/ & scripts/               # Windows (C#) 与 macOS Universal (Swift) 独立安装器源码
└── tools/                              # 原生插件一键安装脚本与旧版 ASAR 无损清理工具
```

---

## 四、开源协议、二次开发强制规范与引用协议 (License, Attribution & Citation)

### 1. 本项目开源与二次开发协议 (`GPL-3.0` + `NOTICE`)
**Obsidian Prism**（`Copyright (C) 2026 RMvdesi`）整体及所有原创模块采用 **[GNU General Public License v3.0 (`GPL-3.0-only`)](./LICENSE)** 开源发布，并附带基于 GPL-3.0 第 7 条的法定归属声明 **[`NOTICE`](./NOTICE)**。

**任何人基于本项目进行修改、二次开发、移植或打包再分发时，必须同时遵守以下三条硬性规则**：
1. **强制同源开源（Copyleft）**：任何包含或修改自 Obsidian Prism 代码的衍生插件、主题包或安装程序，整体必须同样以 **`GPL-3.0`** 协议免费开放完整源代码，**严禁闭源打包、代码混淆锁死或商业售卖**。
2. **强制保留作者署名与致谢链（Attribution Required）**：必须在衍生仓库根目录完整保留 [`LICENSE`](./LICENSE)、[`NOTICE`](./NOTICE) 与 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)；若衍生作品保留图形设置界面或 README 说明文档，**必须醒目保留对原作者 `RMvdesi` 及原仓库 `RMvdesi/obsidian-prism` 的来源致谢链接**。
3. **显著标注修改记录与禁止冒用官方名义（Mark Modifications & Non-Endorsement）**：必须在修改过的文件中注明修改日期与变更内容；未经书面许可，衍生版本不得盗用 `Obsidian Prism` 品牌名冒充官方原版发布。

#### 下游二次开发 README 标准致谢模板（可直接复制）
```markdown
> Built upon [Obsidian Prism](https://github.com/RMvdesi/obsidian-prism) by [@RMvdesi](https://github.com/RMvdesi), licensed under [GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html). Upstream component notices are preserved in `NOTICE` and `THIRD_PARTY_NOTICES.md`.
```

#### 学术 / 技术文章与衍生工程引用格式 (`CITATION.cff` / BibTeX)
也可直接点击 GitHub 仓库右侧边栏的 **“Cite this repository”** 按钮获取引用卡片：
```bibtex
@software{rmvdesi_obsidian_prism_2026,
  author       = {RMvdesi},
  title        = {{Obsidian Prism: Optical UI, Spring Choreography & Dual-Mode Thought Suite for Antigravity}},
  year         = {2026},
  version      = {1.0.0},
  license      = {GPL-3.0-only},
  url          = {https://github.com/RMvdesi/obsidian-prism}
}
```

---

### 2. 上游开源项目与灵感致谢 (Upstream Credits)

本项目吸收整合的第三方组件原采用宽松的 **MIT License**（与 GPL-3.0 向上兼容），其完整原始版权与许可文本均永久保留于 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)：

1. **[0DNANCY/agy-claude-style](https://github.com/0DNANCY/agy-claude-style)** — `MIT License`, `Copyright (c) 2026 0DNANCY`（主视觉光学底座、物理弹簧编排、WebGL2 极光/字符波纹矩阵、像素双宠底座与零依赖构建器）。
2. **[YOU-SHOULD-KNOW-ME/antigrative-dashboard](https://github.com/YOU-SHOULD-KNOW-ME/antigrative-dashboard)** — `MIT License`, `Copyright (c) 2026 AG Pulse contributors`（吸收于 `vendor/pulse-dashboard/`，实时吞吐速率、缓存命中率与配额遥测采集）。
3. **[LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider](https://github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider)** — `MIT License`, `Copyright (c) 2026 月上寒 (LLYSH-HANNARI)`（吸收于 `vendor/effort-slider/`，模型菜单推理等级滑块与智能共存封装）。
4. **[Nwflower/dsh-claude-style](https://github.com/Nwflower/dsh-claude-style)** — Studio 极简排版美学、清爽输入舱架构与温润画册配色灵感致谢。
5. **[Microqian2th/dsh-codex-effort-slider](https://github.com/Microqian2th/dsh-codex-effort-slider)** — 星尘能量轨道、迟滞棘轮分档与阻尼运动曲线灵感致谢。
6. **[mobius/dsh-performance-slider](https://github.com/mobius/dsh-performance-slider)** — 性能档位滑块交互范式与实时视觉反馈设计致谢。
7. **[claudenoshujin/claude-web](https://github.com/claudenoshujin/claude-web)** (by `lulu`) — *Mascot Pile & Micro-Ecology Interaction Inspiration*（桌面宠物叠叠乐与微生态交互灵感致谢；本项目物理引擎为净室独立实现）。
