// Obsidian Prism Node compile-cache 启用门禁与延迟异步有界治理（严守四防红线：严格路径边界、防 symlink 逃逸、分批让出事件循环）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_COMPILE_CACHE_MAX_FILES = 250;
export const DEFAULT_COMPILE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
export const DEFAULT_COMPILE_CACHE_CLEANUP_DELAY_MS = 15_000;
export const DEFAULT_COMPILE_CACHE_FOLLOW_UP_DELAY_MS = 5_000;
export const DEFAULT_COMPILE_CACHE_MIN_AGE_MS = 5 * 60 * 1000;
export const DEFAULT_COMPILE_CACHE_MAX_SCAN_ENTRIES = 4_000;
export const DEFAULT_COMPILE_CACHE_MAX_DELETE_PER_PASS = 500;
export const DEFAULT_COMPILE_CACHE_BATCH_SIZE = 25;
export const DEFAULT_COMPILE_CACHE_BATCH_YIELD_MS = 15;
export const DEFAULT_COMPILE_CACHE_MAX_FOLLOW_UP_PASSES = 12;

const SHORT_LIVED_CLI_FLAGS = new Set([
  '--once',
  '--help',
  '-h',
  '--version',
  '-v',
  '--uninstall',
  '--status',
  '--stop',
  '--check',
]);

export function resolveDefaultCompileCacheDir(homeDir = os.homedir()) {
  return path.join(homeDir, '.gemini', 'antigravity', 'sidecar_data', 'obsidian-prism', 'compile-cache');
}

/**
 * 仅允许长期驻留的守护进程主入口启用 Node compile-cache，
 * 避免短命一次性 CLI（--once/--help 等）及单测子进程不断制造海量一次性碎片缓存文件。
 */
export function shouldEnableDaemonCompileCache({
  argv = process.argv,
  execArgv = process.execArgv,
  env = process.env,
  isMain = false,
} = {}) {
  if (isMain !== true) return false;
  if (env && (env.AG_PRISM_DISABLE_COMPILE_CACHE === '1' || env.NODE_TEST_CONTEXT || env.NODE_ENV === 'test' || env.CI)) {
    return false;
  }
  if (Array.isArray(execArgv) && execArgv.some((a) => a === '--test' || String(a || '').startsWith('--test-'))) {
    return false;
  }
  if (Array.isArray(argv)) {
    for (let i = 2; i < argv.length; i += 1) {
      const arg = String(argv[i] || '').trim().toLowerCase();
      if (SHORT_LIVED_CLI_FLAGS.has(arg)) return false;
    }
  }
  return true;
}

function normalizePathForCmp(p) {
  const abs = path.resolve(p);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

function isPathInsideDir(baseDir, candidatePath) {
  const rel = path.relative(normalizePathForCmp(baseDir), normalizePathForCmp(candidatePath));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * 严格校验目标目录为自管的非符号链接 compile-cache 目录，绝不越界触碰用户配置或外部路径。
 */
export async function validateCompileCacheDir(dirPath, { allowedBaseDir = '' } = {}) {
  if (typeof dirPath !== 'string' || !dirPath.trim()) {
    return { ok: false, reason: 'empty-path' };
  }
  const absDir = path.resolve(dirPath.trim());
  const baseName = path.basename(absDir).toLowerCase();
  if (baseName !== 'compile-cache') {
    return { ok: false, reason: 'invalid-dirname' };
  }
  const parentName = path.basename(path.dirname(absDir)).toLowerCase();
  if (!allowedBaseDir) {
    if (parentName !== 'obsidian-prism') {
      return { ok: false, reason: 'invalid-parent' };
    }
  } else if (!isPathInsideDir(allowedBaseDir, absDir)) {
    return { ok: false, reason: 'outside-allowed-base' };
  }

  let lst;
  try {
    lst = await fs.promises.lstat(absDir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, reason: 'not-found' };
    return { ok: false, reason: 'lstat-failed' };
  }
  if (lst.isSymbolicLink() || !lst.isDirectory()) {
    return { ok: false, reason: lst.isSymbolicLink() ? 'symlink-root' : 'not-directory' };
  }

  let realDir;
  try {
    realDir = await fs.promises.realpath(absDir);
  } catch {
    return { ok: false, reason: 'realpath-failed' };
  }
  if (path.basename(realDir).toLowerCase() !== 'compile-cache') {
    return { ok: false, reason: 'realpath-escape' };
  }
  if (path.basename(path.dirname(realDir)).toLowerCase() !== 'obsidian-prism') {
    return { ok: false, reason: 'realpath-invalid-parent' };
  }
  if (allowedBaseDir) {
    let realBase;
    try {
      realBase = await fs.promises.realpath(path.resolve(allowedBaseDir));
    } catch {
      return { ok: false, reason: 'invalid-allowed-base' };
    }
    if (!isPathInsideDir(realBase, realDir)) {
      return { ok: false, reason: 'realpath-outside-base' };
    }
  }
  return { ok: true, absDir, realDir };
}

function yieldTick(ms) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

/**
 * 延迟异步有界清理 compile-cache：
 * - 逐级 lstat 防 symlink 逃逸；
 * - 有界扫描（maxScanEntries）与有界分批删除（maxDeletePerPass / batchSize + yield）；
 * - 按 mtime 升序优先淘汰最老过期缓存文件，保护近期热缓存并顺手清理空子目录。
 */
export async function cleanupCompileCacheAsync(
  dirPath = resolveDefaultCompileCacheDir(),
  {
    allowedBaseDir = '',
    maxFiles = DEFAULT_COMPILE_CACHE_MAX_FILES,
    maxBytes = DEFAULT_COMPILE_CACHE_MAX_BYTES,
    minAgeMs = DEFAULT_COMPILE_CACHE_MIN_AGE_MS,
    maxScanEntries = DEFAULT_COMPILE_CACHE_MAX_SCAN_ENTRIES,
    maxDeletePerPass = DEFAULT_COMPILE_CACHE_MAX_DELETE_PER_PASS,
    batchSize = DEFAULT_COMPILE_CACHE_BATCH_SIZE,
    batchYieldMs = DEFAULT_COMPILE_CACHE_BATCH_YIELD_MS,
    now = () => Date.now(),
    shouldAbort = () => false,
  } = {}
) {
  const checked = await validateCompileCacheDir(dirPath, { allowedBaseDir });
  if (!checked.ok) {
    return {
      ok: checked.reason === 'not-found',
      skipped: true,
      reason: checked.reason,
      scannedFiles: 0,
      totalBytes: 0,
      deletedFiles: 0,
      deletedBytes: 0,
      removedDirs: 0,
      hasMore: false,
    };
  }

  const rootDir = checked.realDir;
  const safeMaxFiles = Math.max(1, Math.floor(Number(maxFiles) || DEFAULT_COMPILE_CACHE_MAX_FILES));
  const safeMaxBytes = Math.max(1024, Math.floor(Number(maxBytes) || DEFAULT_COMPILE_CACHE_MAX_BYTES));
  const safeMinAgeMs = Math.max(0, Number(minAgeMs) || 0);
  const safeMaxScan = Math.max(safeMaxFiles + 1, Math.floor(Number(maxScanEntries) || DEFAULT_COMPILE_CACHE_MAX_SCAN_ENTRIES));
  const safeMaxDelete = Math.max(1, Math.floor(Number(maxDeletePerPass) || DEFAULT_COMPILE_CACHE_MAX_DELETE_PER_PASS));
  const safeBatchSize = Math.max(1, Math.floor(Number(batchSize) || DEFAULT_COMPILE_CACHE_BATCH_SIZE));
  const safeYieldMs = Math.max(0, Number(batchYieldMs) || 0);

  const files = [];
  const subDirs = [];
  const queue = [rootDir];
  let totalBytes = 0;
  let scanCapped = false;
  let visitedCount = 0;

  while (queue.length > 0) {
    if (shouldAbort()) {
      return { ok: true, skipped: true, reason: 'aborted', scannedFiles: files.length, totalBytes, deletedFiles: 0, deletedBytes: 0, removedDirs: 0, hasMore: false };
    }
    const curDir = queue.shift();
    let names;
    try {
      names = await fs.promises.readdir(curDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (shouldAbort()) {
        return { ok: true, skipped: true, reason: 'aborted', scannedFiles: files.length, totalBytes, deletedFiles: 0, deletedBytes: 0, removedDirs: 0, hasMore: false };
      }
      if (files.length >= safeMaxScan) {
        scanCapped = true;
        break;
      }
      const fullPath = path.join(curDir, name);
      if (!isPathInsideDir(rootDir, fullPath)) continue;
      let st;
      try {
        st = await fs.promises.lstat(fullPath);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        subDirs.push(fullPath);
        queue.push(fullPath);
      } else if (st.isFile()) {
        const size = Math.max(0, Number(st.size) || 0);
        const mtimeMs = Number.isFinite(st.mtimeMs) ? st.mtimeMs : 0;
        files.push({ fullPath, size, mtimeMs });
        totalBytes += size;
      }
      visitedCount += 1;
      if (visitedCount % 120 === 0 && safeYieldMs > 0) {
        await yieldTick(safeYieldMs);
      }
    }
    if (scanCapped) break;
  }

  if (files.length <= safeMaxFiles && totalBytes <= safeMaxBytes && !scanCapped) {
    return {
      ok: true,
      skipped: false,
      reason: 'within-budget',
      scannedFiles: files.length,
      totalBytes,
      deletedFiles: 0,
      deletedBytes: 0,
      removedDirs: 0,
      hasMore: false,
    };
  }

  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const nowTs = now();
  const severeBacklog = scanCapped || files.length > safeMaxFiles * 4;
  let remainingFiles = files.length;
  let remainingBytes = totalBytes;
  const targets = [];

  for (const item of files) {
    if (remainingFiles <= safeMaxFiles && remainingBytes <= safeMaxBytes) break;
    if (targets.length >= safeMaxDelete) break;
    if (!severeBacklog && safeMinAgeMs > 0 && nowTs - item.mtimeMs < safeMinAgeMs) continue;
    targets.push(item);
    remainingFiles -= 1;
    remainingBytes -= item.size;
  }

  let deletedFiles = 0;
  let deletedBytes = 0;
  for (let i = 0; i < targets.length; i += 1) {
    if (shouldAbort()) break;
    const item = targets[i];
    if (!isPathInsideDir(rootDir, item.fullPath)) continue;
    try {
      const curSt = await fs.promises.lstat(item.fullPath);
      if (curSt.isSymbolicLink() || !curSt.isFile()) continue;
      await fs.promises.unlink(item.fullPath);
      deletedFiles += 1;
      deletedBytes += item.size;
    } catch {}
    if ((i + 1) % safeBatchSize === 0 && safeYieldMs > 0) {
      await yieldTick(safeYieldMs);
    }
  }

  let removedDirs = 0;
  if (deletedFiles > 0 && subDirs.length > 0 && !shouldAbort()) {
    subDirs.sort((a, b) => b.length - a.length);
    for (const d of subDirs) {
      if (shouldAbort()) break;
      if (!isPathInsideDir(rootDir, d)) continue;
      try {
        const dSt = await fs.promises.lstat(d);
        if (dSt.isSymbolicLink() || !dSt.isDirectory()) continue;
        await fs.promises.rmdir(d);
        removedDirs += 1;
      } catch {}
    }
  }

  const stillOverBudget = remainingFiles > safeMaxFiles || remainingBytes > safeMaxBytes;
  const hasMore = Boolean(deletedFiles > 0 && (scanCapped || stillOverBudget));
  return {
    ok: true,
    skipped: false,
    reason: deletedFiles > 0 ? 'pruned' : 'protected-recent',
    scannedFiles: files.length,
    totalBytes,
    deletedFiles,
    deletedBytes,
    removedDirs,
    hasMore,
  };
}

/**
 * 调度守护进程后台低优先级 compile-cache 维护任务（冷启后延迟启动，绝不阻塞冷启，支持取消防泄漏）。
 */
export function scheduleCompileCacheMaintenance({
  dirPath = resolveDefaultCompileCacheDir(),
  allowedBaseDir = '',
  delayMs = DEFAULT_COMPILE_CACHE_CLEANUP_DELAY_MS,
  followUpDelayMs = DEFAULT_COMPILE_CACHE_FOLLOW_UP_DELAY_MS,
  maxFollowUpPasses = DEFAULT_COMPILE_CACHE_MAX_FOLLOW_UP_PASSES,
  maxFiles = DEFAULT_COMPILE_CACHE_MAX_FILES,
  maxBytes = DEFAULT_COMPILE_CACHE_MAX_BYTES,
  minAgeMs = DEFAULT_COMPILE_CACHE_MIN_AGE_MS,
  maxScanEntries = DEFAULT_COMPILE_CACHE_MAX_SCAN_ENTRIES,
  maxDeletePerPass = DEFAULT_COMPILE_CACHE_MAX_DELETE_PER_PASS,
  batchSize = DEFAULT_COMPILE_CACHE_BATCH_SIZE,
  batchYieldMs = DEFAULT_COMPILE_CACHE_BATCH_YIELD_MS,
  isRunning = () => true,
  log = () => {},
} = {}) {
  let cancelled = false;
  let timer = null;
  let pass = 0;

  const schedulePass = (waitMs) => {
    if (cancelled || !isRunning()) return;
    timer = setTimeout(async () => {
      timer = null;
      if (cancelled || !isRunning()) return;
      try {
        const res = await cleanupCompileCacheAsync(dirPath, {
          allowedBaseDir,
          maxFiles,
          maxBytes,
          minAgeMs,
          maxScanEntries,
          maxDeletePerPass,
          batchSize,
          batchYieldMs,
          shouldAbort: () => cancelled || !isRunning(),
        });
        if (res.deletedFiles > 0) {
          const freedMb = (res.deletedBytes / (1024 * 1024)).toFixed(2);
          log(`[🧹] Pruned compile-cache: removed ${res.deletedFiles} files (${freedMb} MB)`);
        }
        if (res.hasMore && !cancelled && isRunning() && pass < maxFollowUpPasses) {
          pass += 1;
          schedulePass(Math.max(100, Number(followUpDelayMs) || DEFAULT_COMPILE_CACHE_FOLLOW_UP_DELAY_MS));
        }
      } catch {}
    }, Math.max(0, Number(waitMs) || 0));
    timer.unref?.();
  };

  schedulePass(delayMs);

  return {
    cancel() {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
