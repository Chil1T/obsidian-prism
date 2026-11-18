"use strict";

/**
 * Obsidian Prism 原生自启动插件一键同步安装器 (tools/install-plugin.cjs)
 *
 * 职责：
 * 1. 将 obsidian-prism 完整同步部署至 ~/.gemini/config/plugins/obsidian-prism
 *    （含 plugin.json、assets/logo.svg、THIRD_PARTY_NOTICES.md、sidecars/daemon/sidecar.json、全部运行时与 vendor/）；
 * 2. 自动停用并清理旧临时插件目录 ~/.gemini/config/plugins/antigravity-prism（若存在用户配置则平滑迁入新目录）；
 * 3. 写入 repo-meta.json 链接本地 Git 源码目录，支持设置面板「检查 / 同步 Git 更新」；
 * 4. 通过 PowerShell Start-Process -WindowStyle Hidden 脱离终端 Job Object 确保后台守护实例已启动并接管当前 CDP 窗口！
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnBreakawayNodeProcess, isPidAlive } = require("./patch-asar.cjs");

const ROOT_DIR = path.resolve(__dirname, "..");
const { SYNC_ROOT_FILES, readPidFromLockFile, isExpectedDaemonProcess } = require(path.join(ROOT_DIR, "cdp.js"));

function getDefaultPluginTargetDir() {
  return path.join(os.homedir(), ".gemini", "config", "plugins", "obsidian-prism");
}

function getLegacyTempPluginDir(targetDir = getDefaultPluginTargetDir()) {
  const parent = path.dirname(path.resolve(targetDir));
  const candidate = path.join(parent, "antigravity-prism");
  if (path.resolve(candidate).toLowerCase() === path.resolve(targetDir).toLowerCase()) {
    return null;
  }
  return candidate;
}

function resolveHostGeminiConfigDir(targetDir, explicitHostDir = null) {
  if (explicitHostDir) return path.resolve(explicitHostDir);
  if (process.env.AG_PRISM_GEMINI_CONFIG_DIR) {
    return path.resolve(process.env.AG_PRISM_GEMINI_CONFIG_DIR);
  }
  const defaultTarget = path.resolve(getDefaultPluginTargetDir());
  const resolvedTarget = path.resolve(targetDir || defaultTarget);
  if (resolvedTarget.toLowerCase() === defaultTarget.toLowerCase()) {
    return path.join(os.homedir(), ".gemini", "config");
  }
  const parentDir = path.dirname(resolvedTarget);
  if (path.basename(parentDir).toLowerCase() === "plugins") {
    return path.dirname(parentDir);
  }
  return null;
}

function syncHostPluginRegistry(configDir, enable) {
  if (!configDir) return false;
  const hostConfigPath = path.join(configDir, "config.json");
  try {
    if (enable) {
      fs.mkdirSync(configDir, { recursive: true });
      let hostObj = {};
      if (fs.existsSync(hostConfigPath)) {
        const raw = fs.readFileSync(hostConfigPath, "utf8").replace(/^\uFEFF/, "").trim();
        if (raw.length > 0) {
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
          hostObj = parsed;
        }
      }
      hostObj.plugins = hostObj.plugins && typeof hostObj.plugins === "object" && !Array.isArray(hostObj.plugins) ? hostObj.plugins : {};
      const prevEntry = hostObj.plugins["obsidian-prism"];
      hostObj.plugins["obsidian-prism"] =
        prevEntry && typeof prevEntry === "object" && !Array.isArray(prevEntry)
          ? { ...prevEntry, enabled: true }
          : { enabled: true };
      if (hostObj.plugins["antigravity-prism"]) {
        delete hostObj.plugins["antigravity-prism"];
      }
      fs.writeFileSync(hostConfigPath, JSON.stringify(hostObj, null, 2) + "\n", "utf8");
      return true;
    }

    if (fs.existsSync(hostConfigPath)) {
      const raw = fs.readFileSync(hostConfigPath, "utf8").replace(/^\uFEFF/, "").trim();
      if (raw.length > 0) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          let changed = false;
          if (parsed.plugins && typeof parsed.plugins === "object") {
            if ("obsidian-prism" in parsed.plugins) { delete parsed.plugins["obsidian-prism"]; changed = true; }
            if ("antigravity-prism" in parsed.plugins) { delete parsed.plugins["antigravity-prism"]; changed = true; }
          }
          if (parsed.sidecars && typeof parsed.sidecars === "object" && "obsidian-prism/daemon" in parsed.sidecars) {
            delete parsed.sidecars["obsidian-prism/daemon"];
            changed = true;
          }
          if (changed) {
            fs.writeFileSync(hostConfigPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
          }
        }
      }
    }
    const cachePath = path.join(configDir, "obsidian-prism-thought-cache.json");
    if (fs.existsSync(cachePath)) {
      try { fs.unlinkSync(cachePath); } catch {}
    }
    return true;
  } catch {
    return false;
  }
}

const ROOT_FILES_TO_SYNC = SYNC_ROOT_FILES;

const DIRS_TO_SYNC = [
  "assets",
  "vendor",
  "sidecars",
];

function copyDirRecursiveSync(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return 0;
  fs.mkdirSync(dstDir, { recursive: true });
  let copied = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === "__pycache__" || entry.name === ".DS_Store") continue;
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copied += copyDirRecursiveSync(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
      copied += 1;
    }
  }
  return copied;
}

function stopExistingDaemonInDir(targetDir) {
  if (!targetDir || !fs.existsSync(targetDir)) return null;
  const pidFile = path.join(targetDir, ".daemon.pid");
  if (!fs.existsSync(pidFile)) return null;
  let killedPid = null;
  try {
    const pid = readPidFromLockFile(pidFile);
    if (pid && isPidAlive(pid) && isExpectedDaemonProcess(pid)) {
      try {
        process.kill(pid);
        killedPid = pid;
      } catch {}
    }
  } catch {}
  try {
    fs.unlinkSync(pidFile);
  } catch {}
  return killedPid;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function verifyLiveWindowAttach(targetCdp, portOverride = null) {
  const port = portOverride || targetCdp.readPort();
  if (!port) return { cdpPort: null, attachedPages: [] };
  let active;
  try {
    active = await targetCdp.listPages(port);
  } catch {
    return { cdpPort: port, attachedPages: [], unreachable: true };
  }
  const attachedPages = [];
  for (const page of active) {
    let session = null;
    try {
      session = await targetCdp.CdpSession.connect(page.webSocketDebuggerUrl, 2500);
      const state = await session.evaluate(
        `(() => ({
        hasPrism: Boolean(window.__agPrism),
        hasRepoBridge: Boolean(window.__agPrismRepoBridge),
        version: document.documentElement?.getAttribute('data-ag-prism') || null,
        hasStyle: Boolean(document.getElementById('ag-prism-css')),
      }))()`,
        false,
        2000
      );
      if (state && state.hasPrism && state.hasStyle) {
        attachedPages.push({
          id: page.id,
          title: page.title || page.url,
          version: state.version,
          hasRepoBridge: state.hasRepoBridge,
        });
      }
    } catch {
    } finally {
      if (session) session.close();
    }
  }
  return { cdpPort: port, attachedPages };
}

async function installPlugin(opts = {}) {
  const sourceDir = path.resolve(opts.sourceDir || ROOT_DIR);
  const targetDir = path.resolve(opts.targetDir || getDefaultPluginTargetDir());
  const startDaemon = opts.startDaemon !== false;
  const cdpPort = opts.cdpPort || null;

  fs.mkdirSync(targetDir, { recursive: true });

  // Migrate config & clean legacy temporary sibling directory `antigravity-prism` if present
  let cleanedLegacyPluginDir = false;
  const legacyDir = opts.cleanLegacySibling !== false ? getLegacyTempPluginDir(targetDir) : null;
  if (legacyDir && fs.existsSync(legacyDir)) {
    stopExistingDaemonInDir(legacyDir);
    const legacyCfg = path.join(legacyDir, "config.json");
    const newCfg = path.join(targetDir, "config.json");
    if (fs.existsSync(legacyCfg) && !fs.existsSync(newCfg)) {
      try {
        fs.copyFileSync(legacyCfg, newCfg);
      } catch {}
    }
    try {
      fs.rmSync(legacyDir, { recursive: true, force: true });
      cleanedLegacyPluginDir = !fs.existsSync(legacyDir);
    } catch {}
  }

  const stoppedOldPid = stopExistingDaemonInDir(targetDir);

  let copiedFiles = 0;
  const missingOptional = [];
  for (const rel of ROOT_FILES_TO_SYNC) {
    const src = path.join(sourceDir, rel);
    const dst = path.join(targetDir, rel);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      copiedFiles += 1;
    } else {
      missingOptional.push(rel);
    }
  }

  for (const dirName of DIRS_TO_SYNC) {
    const srcSub = path.join(sourceDir, dirName);
    const dstSub = path.join(targetDir, dirName);
    copiedFiles += copyDirRecursiveSync(srcSub, dstSub);
  }

  // Record linked Git repository metadata so Sidecar can inspect/pull source repo
  try {
    fs.writeFileSync(
      path.join(targetDir, "repo-meta.json"),
      JSON.stringify({ sourceRepoDir: sourceDir, installedAt: new Date().toISOString() }, null, 2) + "\n",
      "utf8"
    );
  } catch {}

  const targetCfg = path.join(targetDir, "config.json");
  let preservedConfig = false;
  if (fs.existsSync(targetCfg)) {
    preservedConfig = true;
  } else {
    const srcLocalCfg = path.join(sourceDir, "config.json");
    const srcExampleCfg = path.join(sourceDir, "config.example.json");
    if (fs.existsSync(srcLocalCfg)) {
      fs.copyFileSync(srcLocalCfg, targetCfg);
      copiedFiles += 1;
    } else if (fs.existsSync(srcExampleCfg)) {
      fs.copyFileSync(srcExampleCfg, targetCfg);
      copiedFiles += 1;
    }
  }

  // If installing into default host plugin dir and user already configured obsidian-prism-thought.json
  // with no explicit `thoughtTranslate` preference yet, default to 'ai'.
  if (!opts.targetDir && fs.existsSync(targetCfg)) {
    try {
      const parsedCfg = JSON.parse(fs.readFileSync(targetCfg, "utf8"));
      if (parsedCfg && typeof parsedCfg === "object" && parsedCfg.thoughtTranslate === undefined) {
        const prismThoughtCfg = path.join(os.homedir(), ".gemini", "config", "obsidian-prism-thought.json");
        if (fs.existsSync(prismThoughtCfg)) {
          parsedCfg.thoughtTranslate = "ai";
          parsedCfg.thoughtTrigger = parsedCfg.thoughtTrigger || "preload";
          fs.writeFileSync(targetCfg, JSON.stringify(parsedCfg, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
        }
      }
    } catch {}
  }

  // Ensure ~/.gemini/config/config.json (including 0-byte empty file) registers `obsidian-prism` cleanly
  const hostConfigDir = resolveHostGeminiConfigDir(opts.targetDir ? targetDir : null, opts.hostConfigDir || null);
  syncHostPluginRegistry(hostConfigDir, true);

  let daemonInfo = { started: false, pid: null, method: null, pidVerified: false };
  let liveCheck = { cdpPort: null, attachedPages: [] };

  if (startDaemon) {
    const daemonScript = path.join(targetDir, "sidecars", "daemon", "main.mjs");
    const daemonArgs = [daemonScript, "--root", targetDir, "--repo", sourceDir];
    if (cdpPort) daemonArgs.push("--port", String(cdpPort));

    const spawnRes = spawnBreakawayNodeProcess(daemonArgs, {
      cwd: path.dirname(daemonScript),
      disablePowerShellBreakaway: Boolean(opts.disablePowerShellBreakaway),
    });

    const pidFile = path.join(targetDir, ".daemon.pid");
    let verifiedPid = spawnRes.pid;
    let pidVerified = false;

    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(pidFile)) {
        try {
          const info = JSON.parse(fs.readFileSync(pidFile, "utf8"));
          if (info && info.pid && isPidAlive(info.pid)) {
            verifiedPid = info.pid;
            pidVerified = true;
            break;
          }
        } catch {}
      }
      await sleep(150);
    }

    daemonInfo = {
      started: Boolean(spawnRes.spawned),
      pid: verifiedPid,
      method: spawnRes.method,
      pidVerified,
      stoppedOldPid,
    };

    try {
      const targetCdp = require(path.join(targetDir, "cdp.js"));
      for (let attempt = 0; attempt < 12; attempt++) {
        liveCheck = await verifyLiveWindowAttach(targetCdp, cdpPort);
        if (!liveCheck.cdpPort || liveCheck.unreachable || liveCheck.attachedPages.length > 0) {
          break;
        }
        await sleep(250);
      }
    } catch {}
  }

  return {
    ok: true,
    targetDir,
    cleanedLegacyPluginDir,
    copiedFiles,
    missingOptional,
    preservedConfig,
    daemon: daemonInfo,
    live: liveCheck,
  };
}

async function uninstallPlugin(opts = {}) {
  const targetDir = path.resolve(opts.targetDir || getDefaultPluginTargetDir());
  const stoppedPid = stopExistingDaemonInDir(targetDir);
  const legacyDir = getLegacyTempPluginDir(targetDir);
  if (legacyDir && fs.existsSync(legacyDir)) {
    stopExistingDaemonInDir(legacyDir);
  }
  let removedDomPages = 0;

  if (!opts.noCdp) {
    try {
      const cdpPath = fs.existsSync(path.join(targetDir, "cdp.js"))
        ? path.join(targetDir, "cdp.js")
        : path.join(ROOT_DIR, "cdp.js");
      const cdp = require(cdpPath);
      const port = opts.cdpPort || cdp.readPort();
      if (port) {
        const pages = await cdp.listPages(port).catch(() => []);
        for (const p of pages) {
          let s = null;
          try {
            s = await cdp.CdpSession.connect(p.webSocketDebuggerUrl, 2000);
            await s.evaluate(cdp.REMOVE_EXPRESSION);
            removedDomPages += 1;
          } catch {
          } finally {
            if (s) s.close();
          }
        }
      }
    } catch {}
  }

  const hostConfigDir = resolveHostGeminiConfigDir(opts.targetDir ? targetDir : null, opts.hostConfigDir || null);
  syncHostPluginRegistry(hostConfigDir, false);

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  return {
    ok: true,
    targetDir,
    stoppedPid,
    removedDomPages,
  };
}

function getPluginInstallStatus(opts = {}) {
  const targetDir = path.resolve(opts.targetDir || getDefaultPluginTargetDir());
  const pluginJsonPath = path.join(targetDir, "plugin.json");
  const sidecarJsonPath = path.join(targetDir, "sidecars", "daemon", "sidecar.json");
  const logoPath = path.join(targetDir, "assets", "logo.svg");
  const pidFile = path.join(targetDir, ".daemon.pid");

  let daemonPid = null;
  let daemonAlive = false;
  if (fs.existsSync(pidFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(pidFile, "utf8"));
      daemonPid = parsed?.pid || null;
      daemonAlive = Boolean(daemonPid && isPidAlive(daemonPid));
    } catch {}
  }

  return {
    installed: fs.existsSync(pluginJsonPath) && fs.existsSync(sidecarJsonPath),
    targetDir,
    hasLogo: fs.existsSync(logoPath),
    hasSidecar: fs.existsSync(sidecarJsonPath),
    daemonPid,
    daemonAlive,
  };
}

function parseCliArgs(argv) {
  const args = argv.slice(2);
  let action = "install";
  let targetDir = null;
  let noDaemon = false;
  let noCdp = false;
  let cdpPort = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--install") action = "install";
    else if (a === "--uninstall") action = "uninstall";
    else if (a === "--status") action = "status";
    else if (a === "--no-daemon") noDaemon = true;
    else if (a === "--no-cdp") noCdp = true;
    else if (a === "--target" && args[i + 1]) targetDir = args[++i];
    else if (a === "--cdp-port" && args[i + 1]) cdpPort = parseInt(args[++i], 10);
  }
  return { action, targetDir, noDaemon, noCdp, cdpPort };
}

if (require.main === module) {
  const cli = parseCliArgs(process.argv);
  (async () => {
    if (cli.action === "status") {
      console.log(JSON.stringify(getPluginInstallStatus({ targetDir: cli.targetDir }), null, 2));
      return;
    }
    if (cli.action === "uninstall") {
      const res = await uninstallPlugin({ targetDir: cli.targetDir, noCdp: cli.noCdp, cdpPort: cli.cdpPort });
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    const res = await installPlugin({
      targetDir: cli.targetDir,
      startDaemon: !cli.noDaemon,
      cdpPort: cli.cdpPort,
    });
    console.log(JSON.stringify(res, null, 2));
  })().catch((err) => {
    console.error("[Obsidian Prism InstallPlugin] Error:", err);
    process.exit(1);
  });
}

module.exports = {
  getDefaultPluginTargetDir,
  getLegacyTempPluginDir,
  resolveHostGeminiConfigDir,
  syncHostPluginRegistry,
  installPlugin,
  uninstallPlugin,
  getPluginInstallStatus,
  stopExistingDaemonInDir,
};
