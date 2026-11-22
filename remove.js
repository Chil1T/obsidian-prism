// Stop watch/daemon processes and remove Obsidian Prism from every open Antigravity window.
// Passing --purge-data additionally removes Prism user configs, caches (including usage rollup cache), and telemetry safely.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  PID_FILE,
  REMOVE_EXPRESSION,
  readPort,
  listPages,
  CdpSession,
  readPidFromLockFile,
  isExpectedDaemonProcess,
} = require('./cdp');

const USAGE_ROLLUP_CACHE_FILENAME = 'obsidian-prism-usage-rollup-cache.json';
const REDLINE_DIR_SEGMENTS = new Set([
  'conversations_archive',
  'prism-knowledge-space',
  'antigravity-spark',
]);
const PURGE_EXACT_FILES = [
  'obsidian-prism-config.backup.json',
  'obsidian-prism-thought.json',
  'obsidian-prism-thought-cache.json',
  USAGE_ROLLUP_CACHE_FILENAME,
  'obsidian-prism-sidebar.json',
  'obsidian-prism-sidebar.json.lock',
];

function parseCliArgs(argv = process.argv.slice(2)) {
  let purgeData = false;
  for (const arg of argv) {
    if (arg === '--purge-data') purgeData = true;
  }
  return { purgeData };
}

function normalizeCmpPath(p) {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isWithinOrEqualDir(targetPath, rootDir) {
  if (!targetPath || !rootDir) return false;
  const t = normalizeCmpPath(targetPath);
  const r = normalizeCmpPath(rootDir);
  if (t === r) return true;
  const prefix = r.endsWith(path.sep) ? r : r + path.sep;
  return t.startsWith(prefix);
}

function hasRedlineSegment(targetPath) {
  const parts = path.resolve(targetPath).split(/[\\/]+/).filter(Boolean);
  return parts.some((seg) => REDLINE_DIR_SEGMENTS.has(seg.toLowerCase()));
}

function hasSymlinkInChain(targetPath, stopRoot) {
  let cur = path.resolve(targetPath);
  const stop = stopRoot ? normalizeCmpPath(stopRoot) : '';
  for (let depth = 0; depth < 64; depth++) {
    try {
      const st = fs.lstatSync(cur);
      if (st.isSymbolicLink()) return true;
    } catch (err) {
      if (err && err.code !== 'ENOENT') return true;
    }
    if (stop && normalizeCmpPath(cur) === stop) break;
    const parent = path.dirname(cur);
    if (!parent || parent === cur) break;
    cur = parent;
  }
  return false;
}

function safeUnlinkNoSymlink(filePath) {
  if (!filePath || hasRedlineSegment(filePath)) return false;
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return false;
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveHostConfigDir(opts = {}) {
  const override = opts.hostConfigDir || process.env.AG_PRISM_GEMINI_CONFIG_DIR;
  if (typeof override === 'string' && override.trim()) {
    return path.resolve(override.trim());
  }
  return path.join(os.homedir(), '.gemini', 'config');
}

function resolveSafeUsageCacheOverride(candidate, hostConfigDir, geminiRoot) {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  const resolvedFile = path.resolve(candidate.trim());
  if (path.basename(resolvedFile).toLowerCase() !== USAGE_ROLLUP_CACHE_FILENAME) return null;
  const parentDir = path.dirname(resolvedFile);
  if (hasRedlineSegment(resolvedFile)) return null;

  const allowedRoots = [
    hostConfigDir,
    geminiRoot,
    path.join(os.homedir(), '.gemini'),
    os.tmpdir(),
  ].filter(Boolean);

  const matchedRoot = allowedRoots.find((root) => isWithinOrEqualDir(parentDir, root));
  if (!matchedRoot) return null;
  if (hasSymlinkInChain(parentDir, matchedRoot)) return null;
  return resolvedFile;
}

function resolveSafeTelemetryDir(hostConfigDir, geminiRoot, envTelemetryDir) {
  const rawOverride = typeof envTelemetryDir === 'string' ? envTelemetryDir.trim() : '';
  if (rawOverride) {
    const candidate = path.resolve(rawOverride);
    if (hasRedlineSegment(candidate)) return null;
    const allowedRoots = [
      geminiRoot,
      path.join(os.homedir(), '.gemini'),
      os.tmpdir(),
    ].filter(Boolean);
    const matchedRoot = allowedRoots.find(
      (root) => isWithinOrEqualDir(candidate, root) && normalizeCmpPath(candidate) !== normalizeCmpPath(root)
    );
    if (!matchedRoot) return null;
    const segs = candidate.split(/[\\/]+/).filter(Boolean);
    const owned = segs.some((s) => s.toLowerCase() === 'telemetry' || s.toLowerCase() === 'obsidian-prism');
    if (!owned || hasSymlinkInChain(candidate, matchedRoot)) return null;
    return candidate;
  }
  if (!geminiRoot) return null;
  const defaultDir = path.join(geminiRoot, 'antigravity', 'sidecar_data', 'obsidian-prism', 'telemetry');
  if (hasRedlineSegment(defaultDir) || hasSymlinkInChain(defaultDir, geminiRoot)) return null;
  return defaultDir;
}

function purgeUserPluginData(opts = {}) {
  // 绝对红线：严禁触碰 conversations_archive、Antigravity-Spark、prism-knowledge-space
  const purgedPaths = [];
  const hostConfigDir = resolveHostConfigDir(opts);
  const geminiRoot = hostConfigDir ? path.dirname(hostConfigDir) : null;

  if (hostConfigDir && !hasRedlineSegment(hostConfigDir) && fs.existsSync(hostConfigDir)) {
    try {
      const dirStat = fs.lstatSync(hostConfigDir);
      if (!dirStat.isSymbolicLink() && dirStat.isDirectory()) {
        for (const name of PURGE_EXACT_FILES) {
          const fp = path.join(hostConfigDir, name);
          if (safeUnlinkNoSymlink(fp)) purgedPaths.push(fp);
        }
        for (const entry of fs.readdirSync(hostConfigDir, { withFileTypes: true })) {
          if (entry.isSymbolicLink() || !entry.isFile()) continue;
          if (/^obsidian-prism-sidebar\.json\.v1.*\.bak$/i.test(entry.name)) {
            const fp = path.join(hostConfigDir, entry.name);
            if (safeUnlinkNoSymlink(fp)) purgedPaths.push(fp);
          }
        }
      }
    } catch {}
  }

  const usageCacheEnv = opts.usageCachePath !== undefined ? opts.usageCachePath : process.env.PRISM_USAGE_CACHE_PATH;
  const safeUsageOverride = resolveSafeUsageCacheOverride(usageCacheEnv, hostConfigDir, geminiRoot);
  if (safeUsageOverride && safeUnlinkNoSymlink(safeUsageOverride)) {
    purgedPaths.push(safeUsageOverride);
  }

  const envTel = opts.telemetryDir !== undefined ? opts.telemetryDir : process.env.AG_PRISM_TELEMETRY_DIR;
  const telemetryDir = resolveSafeTelemetryDir(hostConfigDir, geminiRoot, envTel);
  if (telemetryDir && fs.existsSync(telemetryDir)) {
    try {
      const telStat = fs.lstatSync(telemetryDir);
      if (!telStat.isSymbolicLink() && telStat.isDirectory()) {
        fs.rmSync(telemetryDir, { recursive: true, force: true });
        purgedPaths.push(telemetryDir);
      }
    } catch {}
  }

  return purgedPaths;
}

function stopPidFile(filePath, label) {
  try {
    if (!fs.existsSync(filePath)) return;
    const pid = readPidFromLockFile(filePath);
    if (pid && isExpectedDaemonProcess(pid)) {
      try {
        process.kill(pid);
        console.log(`[✓] 已停止${label} (PID ${pid})`);
      } catch {
        console.log(`[i] ${label}未在运行`);
      }
    }
    try {
      fs.unlinkSync(filePath);
    } catch {}
  } catch {}
}

function stopWatcher() {
  stopPidFile(PID_FILE, '守护进程');
  stopPidFile(path.join(__dirname, '.daemon.pid'), 'Sidecar 守护进程');
}

async function main(argv = process.argv.slice(2)) {
  const cli = parseCliArgs(argv);
  stopWatcher();
  const port = readPort();
  if (!port) {
    console.log('[i] Antigravity 未运行，无需清理窗口');
  } else {
    let pages = null;
    try {
      pages = await listPages(port);
    } catch {
      console.log(`[i] 端口 ${port} 无响应，无需清理窗口`);
    }
    if (Array.isArray(pages)) {
      for (const page of pages) {
        const session = await CdpSession.connect(page.webSocketDebuggerUrl);
        try {
          const res = await session.evaluate(REMOVE_EXPRESSION);
          console.log(`[✓] 已恢复原生界面: ${page.title || page.url} (清理节点 ${res?.removed ?? 0})`);
        } finally {
          session.close();
        }
      }
    }
  }

  if (cli.purgeData) {
    const purged = purgeUserPluginData();
    console.log(`[✓] 已彻底清理用户插件配置与缓存 (${purged.length} 项)`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[✗] ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  USAGE_ROLLUP_CACHE_FILENAME,
  parseCliArgs,
  purgeUserPluginData,
  main,
};
