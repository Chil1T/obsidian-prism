// Obsidian Prism 统一安装清单（schemaVersion: 2, layoutVersion: 2）与 4 阶段原子事务升级引擎
// 零外部依赖（仅 Node.js >= 22 内置模块），全仓受保护用户路径与清理白名单单一真相源。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const INSTALL_MANIFEST_FILENAME = 'install-manifest.json';
export const INSTALL_MANIFEST_SCHEMA_VERSION = 2;
export const INSTALL_MANIFEST_LAYOUT_VERSION = 2;
export const VALID_SCOPES = Object.freeze(['install', 'plugin', 'both']);

export const PROTECTED_USER_PATHS = Object.freeze([
  'config.json', 'custom.css', '.bundle-cache.json', '.daemon.pid', '.watch.pid',
  '.relaunch-prompt-state.json', '.pending-restore-run-in-bg.json', 'repo-meta.json',
  'wallpapers/', 'backups/',
]);
export const USER_OWNED_ASSET_PATHS = Object.freeze(['custom.css', 'wallpapers/', 'backups/']);
export const PURGE_DATA_FILES = Object.freeze([
  'obsidian-prism-config.backup.json',
  'obsidian-prism-thought.json',
  'obsidian-prism-thought-cache.json',
  'obsidian-prism-usage-rollup-cache.json',
  'obsidian-prism-storage-guard-state.json',
  'obsidian-prism-sidebar.json',
  'obsidian-prism-sidebar.json.lock',
  'obsidian-prism-wallpaper.json',
  'obsidian-prism-suggester.json',
]);
export const DEFAULT_OBSOLETE_PATHS = Object.freeze([]);
export const ATOMIC_UPGRADE_RETRY_BACKOFFS_MS = Object.freeze([100, 250, 500]);

const EXCLUDED_SYNC_PREFIXES = Object.freeze(['assets/screenshots']);
const EXCLUDED_SYNC_NAMES = new Set(['.ds_store', '__pycache__', '.daemon.pid', '.watch.pid', '.watch.lock']);

export function computeBufferSha256(buf) {
  const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf ?? ''), 'utf8');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function computeFileSha256(filePath) {
  return computeBufferSha256(fs.readFileSync(filePath));
}

export function isSafeManagedRelPath(relPath, { allowTrailingSlash = false } = {}) {
  if (typeof relPath !== 'string' || relPath.length === 0 || relPath.trim() !== relPath) return false;
  if (/[\0\r\n]/.test(relPath)) return false;
  const unified = relPath.replace(/\\/g, '/');
  if (unified.startsWith('/') || /^[a-zA-Z]:/.test(unified) || unified.includes(':')) return false;
  const hasTrailing = unified.endsWith('/');
  if (hasTrailing && !allowTrailingSlash) return false;
  const core = hasTrailing ? unified.slice(0, -1) : unified;
  if (!core || core.endsWith('/')) return false;
  for (const seg of core.split('/')) {
    if (!seg || seg === '.' || seg === '..') return false;
  }
  const normalized = path.posix.normalize(core);
  return normalized === core && !normalized.startsWith('../') && !normalized.startsWith('/');
}

export function shouldExcludeSyncRelPath(relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) return true;
  const norm = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!norm) return true;
  for (const prefix of EXCLUDED_SYNC_PREFIXES) {
    if (norm === prefix || norm.startsWith(`${prefix}/`)) return true;
  }
  for (const seg of norm.split('/')) {
    if (!seg) continue;
    if (EXCLUDED_SYNC_NAMES.has(seg)) return true;
    if (seg.endsWith('.log') || seg.endsWith('.tmp') || /\.tmp\.[a-z0-9._-]+$/i.test(seg)) return true;
    if (seg.startsWith('.staging-') || seg.startsWith('.rollback-')) return true;
  }
  return false;
}

function normalizeProtectedRule(rule) {
  if (typeof rule !== 'string' || !rule.trim()) return null;
  const unified = rule.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const isDir = unified.endsWith('/');
  const core = unified.replace(/\/+$/, '');
  if (!core || !isSafeManagedRelPath(core)) return null;
  return { canonical: isDir ? `${core}/` : core, lower: core.toLowerCase() };
}

export function isProtectedUserPath(relPath, protectedPaths = PROTECTED_USER_PATHS) {
  if (typeof relPath !== 'string' || !relPath.trim()) return false;
  const clean = relPath.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!clean) return false;
  const lowerRel = clean.toLowerCase();
  const rules = Array.isArray(protectedPaths) ? protectedPaths : PROTECTED_USER_PATHS;
  for (const raw of rules) {
    const parsed = normalizeProtectedRule(raw);
    if (parsed && (lowerRel === parsed.lower || lowerRel.startsWith(`${parsed.lower}/`))) return true;
  }
  return false;
}

export function mergeProtectedUserPaths(extraProtectedPaths = []) {
  const seen = new Set();
  const out = [];
  for (const raw of [...PROTECTED_USER_PATHS, ...(Array.isArray(extraProtectedPaths) ? extraProtectedPaths : [])]) {
    const parsed = normalizeProtectedRule(raw);
    if (!parsed || seen.has(parsed.lower)) continue;
    seen.add(parsed.lower);
    out.push(parsed.canonical);
  }
  return out;
}

export function classifyObsoleteCandidate(relPath, protectedPaths = PROTECTED_USER_PATHS) {
  if (!isSafeManagedRelPath(relPath)) return { allowed: false, reason: 'unsafe_path' };
  if (isProtectedUserPath(relPath, mergeProtectedUserPaths(protectedPaths))) {
    return { allowed: false, reason: 'protected_user_path' };
  }
  return { allowed: true, reason: 'ok', normalizedPath: relPath.replace(/\\/g, '/') };
}

export function buildInstallManifest({
  version = '0.0.0',
  entries = [],
  obsoletePaths = [],
  extraProtectedPaths = [],
} = {}) {
  const protectedUserPaths = mergeProtectedUserPaths(extraProtectedPaths);
  const fileMap = new Map();
  for (const item of Array.isArray(entries) ? entries : []) {
    if (!item || typeof item !== 'object') continue;
    const rawPath = String(item.path ?? item.name ?? '').replace(/\\/g, '/');
    if (!isSafeManagedRelPath(rawPath)) throw new Error(`Unsafe managed entry path in manifest: "${rawPath}"`);
    const scope = VALID_SCOPES.includes(item.scope) ? item.scope : 'plugin';
    let sha256 = typeof item.sha256 === 'string' ? item.sha256.trim().toLowerCase() : '';
    let size = Number.isInteger(item.size) && item.size >= 0 ? item.size : -1;
    if (item.data !== undefined && item.data !== null) {
      const buf = Buffer.isBuffer(item.data) ? item.data : Buffer.from(String(item.data), 'utf8');
      sha256 = computeBufferSha256(buf);
      size = buf.length;
    }
    if (!/^[0-9a-f]{64}$/.test(sha256) || size < 0) {
      throw new Error(`Manifest entry "${rawPath}" requires valid data or sha256/size`);
    }
    const prev = fileMap.get(rawPath);
    fileMap.set(rawPath, {
      path: rawPath,
      scope: prev ? (prev.scope === scope ? scope : 'both') : scope,
      sha256,
      size,
      required: item.required !== false && (prev ? prev.required !== false : true),
    });
  }

  const safeObsolete = [];
  const seenObs = new Set();
  for (const obs of [...DEFAULT_OBSOLETE_PATHS, ...(Array.isArray(obsoletePaths) ? obsoletePaths : [])]) {
    const check = classifyObsoleteCandidate(obs, protectedUserPaths);
    if (!check.allowed) continue;
    const key = check.normalizedPath.toLowerCase();
    if (!seenObs.has(key)) { seenObs.add(key); safeObsolete.push(check.normalizedPath); }
  }

  return {
    schemaVersion: INSTALL_MANIFEST_SCHEMA_VERSION,
    layoutVersion: INSTALL_MANIFEST_LAYOUT_VERSION,
    version: String(version || '0.0.0'),
    protectedUserPaths,
    purgeDataFiles: [...PURGE_DATA_FILES],
    obsoletePaths: safeObsolete.sort((a, b) => a.localeCompare(b)),
    files: [...fileMap.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function readInstallManifestFromDir(dirPath) {
  if (!dirPath) return null;
  const manifestPath = path.join(dirPath, INSTALL_MANIFEST_FILENAME);
  try {
    const st = fs.lstatSync(manifestPath);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function defaultSleepSync(ms) {
  const duration = Math.max(1, Number(ms) || 1);
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, duration); }
  catch { const end = Date.now() + duration; while (Date.now() < end) {} }
}

function retryFsOp(fn, { backoffs = ATOMIC_UPGRADE_RETRY_BACKOFFS_MS, sleepFn = defaultSleepSync } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    try { return fn(attempt); }
    catch (err) {
      const code = err && err.code;
      if ((code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') || attempt >= backoffs.length) throw err;
      lastErr = err;
      sleepFn(backoffs[attempt]);
    }
  }
  throw lastErr;
}

function assertNoSymlinkRelative(rootDir, relPath) {
  let cur = path.resolve(rootDir);
  for (const seg of relPath.replace(/\\/g, '/').split('/').filter(Boolean)) {
    cur = path.join(cur, seg);
    try { if (fs.lstatSync(cur).isSymbolicLink()) throw new Error(`Refusing symbolic link segment: ${cur}`); }
    catch (err) { if (err && err.code === 'ENOENT') break; throw err; }
  }
}

function clearReadOnlyRegularFile(filePath) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return;
    if (process.platform === 'win32') fs.chmodSync(filePath, 0o666);
    else if ((st.mode & 0o200) === 0) fs.chmodSync(filePath, (st.mode & 0o777) | 0o200);
  } catch {}
}

function resolveUnderRootStrict(rootDir, relPath) {
  if (!isSafeManagedRelPath(relPath)) throw new Error(`Unsafe managed relative path: "${relPath}"`);
  const absRoot = path.resolve(rootDir);
  const absTarget = path.resolve(absRoot, ...relPath.replace(/\\/g, '/').split('/'));
  const cmpRoot = process.platform === 'win32' ? absRoot.toLowerCase() : absRoot;
  const cmpTarget = process.platform === 'win32' ? absTarget.toLowerCase() : absTarget;
  const prefix = cmpRoot.endsWith(path.sep) ? cmpRoot : cmpRoot + path.sep;
  if (!cmpTarget.startsWith(prefix)) throw new Error(`Path escapes target root: "${relPath}"`);
  return absTarget;
}

function normalizeStagedFilesInput(stagedFiles) {
  const map = new Map();
  const add = (rawPath, spec) => {
    const rel = String(rawPath ?? '').replace(/\\/g, '/');
    if (!isSafeManagedRelPath(rel)) throw new Error(`Unsafe staged file path: "${rel}"`);
    if (Buffer.isBuffer(spec)) return void map.set(rel, spec);
    if (typeof spec === 'string') return void map.set(rel, Buffer.from(spec, 'utf8'));
    if (spec && typeof spec === 'object') {
      if (spec.data !== undefined && spec.data !== null) {
        return void map.set(rel, Buffer.isBuffer(spec.data) ? spec.data : Buffer.from(String(spec.data), 'utf8'));
      }
      if (typeof spec.srcPath === 'string' && spec.srcPath) {
        const st = fs.lstatSync(spec.srcPath);
        if (st.isSymbolicLink() || !st.isFile()) throw new Error(`Refusing non-regular staged source: ${spec.srcPath}`);
        return void map.set(rel, fs.readFileSync(spec.srcPath));
      }
    }
    throw new Error(`Unsupported staged entry for "${rel}"`);
  };
  if (stagedFiles instanceof Map) for (const [k, v] of stagedFiles.entries()) add(k, v);
  else if (Array.isArray(stagedFiles)) for (const item of stagedFiles) if (item && typeof item === 'object') add(item.path ?? item.name, item);
  else if (stagedFiles && typeof stagedFiles === 'object') for (const [k, v] of Object.entries(stagedFiles)) add(k, v);
  return map;
}

function pruneEmptyParentDirs(filePath, stopRoot) {
  const absStop = path.resolve(stopRoot);
  const cmpStop = process.platform === 'win32' ? absStop.toLowerCase() : absStop;
  const prefix = cmpStop.endsWith(path.sep) ? cmpStop : cmpStop + path.sep;
  let cur = path.dirname(path.resolve(filePath));
  for (let depth = 0; depth < 32; depth++) {
    const cmpCur = process.platform === 'win32' ? cur.toLowerCase() : cur;
    if (cmpCur === cmpStop || !cmpCur.startsWith(prefix)) break;
    try {
      const st = fs.lstatSync(cur);
      if (st.isSymbolicLink() || !st.isDirectory() || fs.readdirSync(cur).length > 0) break;
      fs.rmdirSync(cur);
      cur = path.dirname(cur);
    } catch { break; }
  }
}

/**
 * 4 阶段纯 Node 原子事务升级引擎：
 * 1) 同卷 .staging-<pid> 落盘并全量校验 SHA-256；
 * 2) 被覆盖受管文件与待清扫废弃文件快照到 .rollback-<pid>（严禁触碰 protectedUserPaths）；
 * 3) 原子替换到位（Windows 锁文件按 100/250/500ms 退避重试）并按 obsoletePaths 精准清扫；
 * 4) 完整性复核，任意步骤失败自动逆序从 .rollback-<pid> 完整回滚并清理暂存目录。
 */
export function applyManifestAtomicUpgrade({
  targetDir,
  stagedFiles,
  manifest,
  backupDir = null,
  scope = null,
  allowSeedProtected = false,
  _testHooks = null,
} = {}) {
  if (!targetDir || typeof targetDir !== 'string') throw new Error('targetDir is required');
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.files)) {
    throw new Error('Valid manifest with files array is required');
  }
  const hooks = _testHooks && typeof _testHooks === 'object' ? _testHooks : {};
  const retryOpts = {
    backoffs: ATOMIC_UPGRADE_RETRY_BACKOFFS_MS,
    sleepFn: typeof hooks.sleepSync === 'function' ? hooks.sleepSync : defaultSleepSync,
  };
  const renameFn = typeof hooks.renameSync === 'function' ? hooks.renameSync : fs.renameSync;
  const unlinkFn = typeof hooks.unlinkSync === 'function' ? hooks.unlinkSync : fs.unlinkSync;

  const absTarget = path.resolve(targetDir);
  try {
    const st = fs.lstatSync(absTarget);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`Refusing symlink or non-directory targetDir: ${absTarget}`);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
    fs.mkdirSync(absTarget, { recursive: true });
  }

  const protectedPaths = mergeProtectedUserPaths(manifest.protectedUserPaths);
  const stagedMap = normalizeStagedFilesInput(stagedFiles);
  const preservedProtected = [];
  const deployPlan = [];

  for (const rawEntry of manifest.files) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const rel = String(rawEntry.path || '').replace(/\\/g, '/');
    if (!isSafeManagedRelPath(rel)) throw new Error(`Unsafe managed file path in manifest: "${rel}"`);
    if (scope && rawEntry.scope && rawEntry.scope !== 'both' && rawEntry.scope !== scope) continue;
    const entry = {
      path: rel,
      sha256: String(rawEntry.sha256 || '').trim().toLowerCase(),
      size: Number(rawEntry.size),
      required: rawEntry.required !== false,
    };
    const destAbs = resolveUnderRootStrict(absTarget, rel);
    if (isProtectedUserPath(rel, protectedPaths) && (fs.existsSync(destAbs) || !allowSeedProtected)) {
      preservedProtected.push(rel);
      continue;
    }
    const buf = stagedMap.get(rel);
    if (!buf) {
      if (entry.required) throw new Error(`Missing required staged file for manifest entry: "${rel}"`);
      continue;
    }
    deployPlan.push({ entry, destAbs, buf });
  }

  const plannedSet = new Set(deployPlan.map((d) => d.entry.path));
  for (const rel of stagedMap.keys()) {
    if (!plannedSet.has(rel) && isProtectedUserPath(rel, protectedPaths) && !preservedProtected.includes(rel)) {
      preservedProtected.push(rel);
    }
  }

  const obsoletePlan = [];
  const rejectedObsolete = [];
  for (const rawObs of Array.isArray(manifest.obsoletePaths) ? manifest.obsoletePaths : []) {
    const cls = classifyObsoleteCandidate(rawObs, protectedPaths);
    if (!cls.allowed) { rejectedObsolete.push({ path: String(rawObs ?? ''), reason: cls.reason }); continue; }
    if (!plannedSet.has(cls.normalizedPath)) {
      obsoletePlan.push({ relPath: cls.normalizedPath, absPath: resolveUnderRootStrict(absTarget, cls.normalizedPath) });
    }
  }

  const token = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const stagingDir = path.join(absTarget, `.staging-${token}`);
  const rollbackDir = backupDir ? path.join(path.resolve(backupDir), `.rollback-${token}`) : path.join(absTarget, `.rollback-${token}`);
  const committedOps = [];
  const removedObsolete = [];

  const cleanupTemps = () => {
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(rollbackDir, { recursive: true, force: true }); } catch {}
  };

  const rollbackCommitted = () => {
    for (let i = committedOps.length - 1; i >= 0; i--) {
      const op = committedOps[i];
      try {
        if (op.existed && op.backupAbs && fs.existsSync(op.backupAbs)) {
          fs.mkdirSync(path.dirname(op.destAbs), { recursive: true });
          clearReadOnlyRegularFile(op.destAbs);
          retryFsOp(() => {
            try { fs.renameSync(op.backupAbs, op.destAbs); } catch { fs.copyFileSync(op.backupAbs, op.destAbs); }
          }, retryOpts);
        } else if (!op.existed) {
          clearReadOnlyRegularFile(op.destAbs);
          if (fs.existsSync(op.destAbs)) retryFsOp(() => fs.unlinkSync(op.destAbs), retryOpts);
          pruneEmptyParentDirs(op.destAbs, absTarget);
        }
      } catch {}
    }
  };

  try {
    // Stage 1: 同卷 .staging-<pid> 落盘并全量校验 SHA-256
    fs.mkdirSync(stagingDir, { recursive: true });
    for (const item of deployPlan) {
      item.stageAbs = resolveUnderRootStrict(stagingDir, item.entry.path);
      fs.mkdirSync(path.dirname(item.stageAbs), { recursive: true });
      fs.writeFileSync(item.stageAbs, item.buf);
    }
    if (typeof hooks.afterStage === 'function') hooks.afterStage({ stagingDir, deployPlan });
    for (const item of deployPlan) {
      const actualBuf = fs.readFileSync(item.stageAbs);
      const actualSha = computeBufferSha256(actualBuf);
      if (actualBuf.length !== item.entry.size || actualSha !== item.entry.sha256) {
        const err = new Error(`SHA256_MISMATCH for "${item.entry.path}": expected ${item.entry.sha256}, got ${actualSha}`);
        err.code = 'SHA256_MISMATCH';
        throw err;
      }
    }

    // Stage 2: 将被覆盖受管文件与待清扫废弃文件快照到 .rollback-<pid>
    fs.mkdirSync(rollbackDir, { recursive: true });
    for (const item of deployPlan) {
      assertNoSymlinkRelative(absTarget, item.entry.path);
      let existing = null;
      try { existing = fs.lstatSync(item.destAbs); } catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
      if (existing) {
        if (existing.isSymbolicLink() || !existing.isFile()) throw new Error(`Refusing non-regular target: ${item.destAbs}`);
        item.backupAbs = resolveUnderRootStrict(rollbackDir, item.entry.path);
        fs.mkdirSync(path.dirname(item.backupAbs), { recursive: true });
        fs.copyFileSync(item.destAbs, item.backupAbs);
        item.existed = true;
      } else { item.existed = false; item.backupAbs = null; }
    }
    for (const obs of obsoletePlan) {
      try {
        assertNoSymlinkRelative(absTarget, obs.relPath);
        const st = fs.lstatSync(obs.absPath);
        if (st.isSymbolicLink() || !st.isFile()) {
          rejectedObsolete.push({ path: obs.relPath, reason: st.isSymbolicLink() ? 'symlink' : 'not_regular_file' });
          obs.skip = true;
          continue;
        }
        obs.backupAbs = resolveUnderRootStrict(rollbackDir, obs.relPath);
        fs.mkdirSync(path.dirname(obs.backupAbs), { recursive: true });
        fs.copyFileSync(obs.absPath, obs.backupAbs);
      } catch (e) {
        if (!e || e.code !== 'ENOENT') rejectedObsolete.push({ path: obs.relPath, reason: 'symlink' });
        obs.skip = true;
      }
    }

    // Stage 3: 原子替换到位（退避重试）+ obsoletePaths 精准清扫
    for (let idx = 0; idx < deployPlan.length; idx++) {
      const item = deployPlan[idx];
      if (typeof hooks.beforeCommitFile === 'function') hooks.beforeCommitFile(item.entry.path, idx, item);
      assertNoSymlinkRelative(absTarget, item.entry.path);
      fs.mkdirSync(path.dirname(item.destAbs), { recursive: true });
      clearReadOnlyRegularFile(item.destAbs);
      retryFsOp(() => renameFn(item.stageAbs, item.destAbs), retryOpts);
      committedOps.push({ destAbs: item.destAbs, existed: item.existed, backupAbs: item.backupAbs });
    }
    for (const obs of obsoletePlan) {
      if (obs.skip) continue;
      if (isProtectedUserPath(obs.relPath, protectedPaths)) {
        rejectedObsolete.push({ path: obs.relPath, reason: 'protected_user_path' });
        continue;
      }
      assertNoSymlinkRelative(absTarget, obs.relPath);
      const cur = fs.lstatSync(obs.absPath);
      if (cur.isSymbolicLink() || !cur.isFile()) {
        rejectedObsolete.push({ path: obs.relPath, reason: 'symlink' });
        continue;
      }
      clearReadOnlyRegularFile(obs.absPath);
      retryFsOp(() => unlinkFn(obs.absPath), retryOpts);
      committedOps.push({ destAbs: obs.absPath, existed: true, backupAbs: obs.backupAbs });
      removedObsolete.push(obs.relPath);
      pruneEmptyParentDirs(obs.absPath, absTarget);
    }

    // Stage 4: 完整性复核
    if (typeof hooks.beforeVerify === 'function') hooks.beforeVerify({ targetDir: absTarget, deployPlan });
    for (const item of deployPlan) {
      const diskSha = computeFileSha256(item.destAbs);
      if (diskSha !== item.entry.sha256) {
        const err = new Error(`POST_COMMIT_VERIFY_FAILED for "${item.entry.path}": expected ${item.entry.sha256}, got ${diskSha}`);
        err.code = 'POST_COMMIT_VERIFY_FAILED';
        throw err;
      }
    }

    cleanupTemps();
    return {
      ok: true,
      appliedFiles: deployPlan.map((d) => d.entry.path),
      preservedProtected,
      removedObsolete,
      rejectedObsolete,
      verifiedCount: deployPlan.length,
    };
  } catch (err) {
    rollbackCommitted();
    cleanupTemps();
    if (err && typeof err === 'object') err.rolledBack = true;
    throw err;
  }
}

