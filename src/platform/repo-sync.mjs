// Obsidian Prism 仓库运行时热同步模块（从 sidecars/daemon/main.mjs 拆分）
// 统一复用 install-manifest.mjs 排除 assets/screenshots、保护用户路径与清扫历史废弃受管文件。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  ATOMIC_UPGRADE_RETRY_BACKOFFS_MS,
  DEFAULT_OBSOLETE_PATHS,
  INSTALL_MANIFEST_FILENAME,
  PROTECTED_USER_PATHS,
  USER_OWNED_ASSET_PATHS,
  classifyObsoleteCandidate,
  isProtectedUserPath,
  isSafeManagedRelPath,
  mergeProtectedUserPaths,
  readInstallManifestFromDir,
  shouldExcludeSyncRelPath,
} from './install-manifest.mjs';

const require = createRequire(import.meta.url);

function isPathWithinRoot(rootDir, candidatePath, allowEqual = false) {
  const rel = path.relative(rootDir, candidatePath);
  if (!rel) return allowEqual;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function hasSymlinkSegment(rootDir, targetPath) {
  const rel = path.relative(rootDir, targetPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return true;
  let cur = rootDir;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    try {
      if (fs.lstatSync(cur).isSymbolicLink()) return true;
    } catch (err) {
      if (err && err.code === 'ENOENT') break;
      return true;
    }
  }
  return false;
}

export function copyUpdatedRuntimeFromRepo(repoDir, pluginDir, syncFilesList) {
  if (!repoDir || !pluginDir) return 0;
  const repoRoot = path.resolve(repoDir);
  const pluginRoot = path.resolve(pluginDir);
  if (repoRoot.toLowerCase() === pluginRoot.toLowerCase()) return 0;

  let repoRootStat;
  try {
    repoRootStat = fs.lstatSync(repoRoot);
  } catch {
    return 0;
  }
  if (repoRootStat.isSymbolicLink() || !repoRootStat.isDirectory()) return 0;

  try {
    const pluginRootStat = fs.lstatSync(pluginRoot);
    if (pluginRootStat.isSymbolicLink() || !pluginRootStat.isDirectory()) return 0;
  } catch (err) {
    if (err && err.code !== 'ENOENT') return 0;
    fs.mkdirSync(pluginRoot, { recursive: true });
  }

  let realRepoRoot;
  let realPluginRoot;
  try {
    realRepoRoot = fs.realpathSync(repoRoot);
    realPluginRoot = fs.realpathSync(pluginRoot);
  } catch {
    return 0;
  }
  if (realRepoRoot.toLowerCase() === realPluginRoot.toLowerCase()) return 0;

  const repoManifest = readInstallManifestFromDir(repoRoot);
  const protectedPaths = mergeProtectedUserPaths(repoManifest?.protectedUserPaths);

  let resolvedFiles = null;
  const repoCdpPath = path.join(repoRoot, 'cdp.js');
  try {
    const cdpStat = fs.lstatSync(repoCdpPath);
    if (!cdpStat.isSymbolicLink() && cdpStat.isFile()) {
      const realCdp = fs.realpathSync(repoCdpPath);
      if (isPathWithinRoot(realRepoRoot, realCdp)) {
        const reqKey = require.resolve(repoCdpPath);
        delete require.cache[reqKey];
        const freshRepoCdp = require(repoCdpPath);
        if (Array.isArray(freshRepoCdp?.SYNC_ROOT_FILES) && freshRepoCdp.SYNC_ROOT_FILES.length > 0) {
          resolvedFiles = freshRepoCdp.SYNC_ROOT_FILES;
        }
      }
    }
  } catch {}

  const safeCopyFile = (rel) => {
    const posixRel = String(rel || '').replace(/\\/g, '/');
    if (!isSafeManagedRelPath(posixRel)) return false;
    if (shouldExcludeSyncRelPath(posixRel)) return false;
    const src = path.resolve(repoRoot, posixRel);
    const dst = path.resolve(pluginRoot, posixRel);
    if (!isPathWithinRoot(repoRoot, src) || !isPathWithinRoot(pluginRoot, dst)) return false;
    if (isProtectedUserPath(posixRel, protectedPaths) && fs.existsSync(dst)) return false;
    if (hasSymlinkSegment(repoRoot, src)) return false;

    let srcStat;
    try {
      srcStat = fs.lstatSync(src);
    } catch {
      return false;
    }
    if (srcStat.isSymbolicLink() || !srcStat.isFile()) return false;
    try {
      const realSrc = fs.realpathSync(src);
      if (!isPathWithinRoot(realRepoRoot, realSrc)) return false;
    } catch {
      return false;
    }

    if (hasSymlinkSegment(pluginRoot, dst)) return false;
    try {
      const dstStat = fs.lstatSync(dst);
      if (dstStat.isSymbolicLink() || !dstStat.isFile()) return false;
    } catch (err) {
      if (!err || err.code !== 'ENOENT') return false;
    }

    const dstParent = path.dirname(dst);
    fs.mkdirSync(dstParent, { recursive: true });
    if (hasSymlinkSegment(pluginRoot, dst)) return false;
    try {
      const realDstParent = fs.realpathSync(dstParent);
      if (!isPathWithinRoot(realPluginRoot, realDstParent, true)) return false;
      try {
        const dstStatAfter = fs.lstatSync(dst);
        if (dstStatAfter.isSymbolicLink() || !dstStatAfter.isFile()) return false;
      } catch (err) {
        if (!err || err.code !== 'ENOENT') return false;
      }
    } catch {
      return false;
    }

    fs.copyFileSync(src, dst);
    return true;
  };

  let synced = 0;
  const files =
    resolvedFiles ||
    (Array.isArray(syncFilesList) && syncFilesList.length > 0 ? syncFilesList : ['cdp.js', 'style.css', 'ui-runtime.js']);
  for (const rel of files) {
    if (safeCopyFile(rel)) synced += 1;
  }

  const syncSubDir = (sub) => {
    const posixSub = String(sub || '').replace(/\\/g, '/');
    if (!isSafeManagedRelPath(posixSub) || shouldExcludeSyncRelPath(posixSub)) return;
    if (isProtectedUserPath(posixSub, protectedPaths)) return;
    const sDir = path.resolve(repoRoot, posixSub);
    const dDir = path.resolve(pluginRoot, posixSub);
    if (!isPathWithinRoot(repoRoot, sDir) || !isPathWithinRoot(pluginRoot, dDir)) return;
    if (hasSymlinkSegment(repoRoot, sDir)) return;

    let sDirStat;
    try {
      sDirStat = fs.lstatSync(sDir);
    } catch {
      return;
    }
    if (sDirStat.isSymbolicLink() || !sDirStat.isDirectory()) return;
    try {
      const realSDir = fs.realpathSync(sDir);
      if (!isPathWithinRoot(realRepoRoot, realSDir)) return;
    } catch {
      return;
    }

    if (hasSymlinkSegment(pluginRoot, dDir)) return;
    try {
      const dDirStat = fs.lstatSync(dDir);
      if (dDirStat.isSymbolicLink() || !dDirStat.isDirectory()) return;
    } catch (err) {
      if (!err || err.code !== 'ENOENT') return;
    }
    fs.mkdirSync(dDir, { recursive: true });
    if (hasSymlinkSegment(pluginRoot, dDir)) return;
    try {
      const realDDir = fs.realpathSync(dDir);
      if (!isPathWithinRoot(realPluginRoot, realDDir)) return;
    } catch {
      return;
    }

    for (const ent of fs.readdirSync(sDir, { withFileTypes: true })) {
      if (ent.isSymbolicLink()) continue;
      const childRel = `${posixSub}/${ent.name}`;
      if (shouldExcludeSyncRelPath(childRel)) continue;
      const childSrc = path.join(sDir, ent.name);
      let childStat;
      try {
        childStat = fs.lstatSync(childSrc);
      } catch {
        continue;
      }
      if (childStat.isSymbolicLink()) continue;
      if (childStat.isDirectory()) syncSubDir(childRel);
      else if (childStat.isFile()) {
        if (safeCopyFile(childRel)) synced += 1;
      }
    }
  };

  syncSubDir('assets');
  syncSubDir('src');
  syncSubDir('vendor');
  syncSubDir('sidecars');

  const obsoleteList = [
    ...DEFAULT_OBSOLETE_PATHS,
    ...(Array.isArray(repoManifest?.obsoletePaths) ? repoManifest.obsoletePaths : []),
  ];
  if (obsoleteList.length > 0) {
    cleanupObsoletePathsInDir(pluginRoot, obsoleteList, protectedPaths);
  }
  return synced;
}

function clearReadOnlyRegularFile(filePath) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return;
    if (process.platform === 'win32') fs.chmodSync(filePath, 0o666);
    else if ((st.mode & 0o200) === 0) fs.chmodSync(filePath, (st.mode & 0o777) | 0o200);
  } catch {}
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms)); } catch {}
}

function unlinkWithRetry(filePath) {
  for (let i = 0; i <= ATOMIC_UPGRADE_RETRY_BACKOFFS_MS.length; i++) {
    try { fs.unlinkSync(filePath); return; }
    catch (err) {
      const c = err && err.code;
      if ((c !== 'EBUSY' && c !== 'EPERM' && c !== 'EACCES') || i >= ATOMIC_UPGRADE_RETRY_BACKOFFS_MS.length) throw err;
      sleepSync(ATOMIC_UPGRADE_RETRY_BACKOFFS_MS[i]);
    }
  }
}

export function cleanupObsoletePathsInDir(targetDir, obsoletePaths = [], protectedPaths = PROTECTED_USER_PATHS) {
  const removed = [];
  const rejected = [];
  if (!targetDir || !Array.isArray(obsoletePaths) || obsoletePaths.length === 0) return { removed, rejected };
  const absTarget = path.resolve(targetDir);
  const merged = mergeProtectedUserPaths(protectedPaths);
  for (const rawObs of obsoletePaths) {
    const cls = classifyObsoleteCandidate(rawObs, merged);
    if (!cls.allowed) { rejected.push({ path: String(rawObs ?? ''), reason: cls.reason }); continue; }
    const obsAbs = path.resolve(absTarget, ...cls.normalizedPath.split('/'));
    if (!isPathWithinRoot(absTarget, obsAbs) || hasSymlinkSegment(absTarget, obsAbs)) {
      rejected.push({ path: cls.normalizedPath, reason: 'symlink' });
      continue;
    }
    try {
      const st = fs.lstatSync(obsAbs);
      if (st.isSymbolicLink() || !st.isFile()) {
        rejected.push({ path: cls.normalizedPath, reason: st.isSymbolicLink() ? 'symlink' : 'not_regular_file' });
        continue;
      }
      clearReadOnlyRegularFile(obsAbs);
      unlinkWithRetry(obsAbs);
      removed.push(cls.normalizedPath);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') rejected.push({ path: cls.normalizedPath, reason: err?.code || 'unlink_failed' });
    }
  }
  return { removed, rejected };
}

export function hasUserOwnedAssetsInDir(targetDir, userAssetPaths = USER_OWNED_ASSET_PATHS) {
  if (!targetDir || !fs.existsSync(targetDir)) return false;
  const absTarget = path.resolve(targetDir);
  for (const rel of userAssetPaths) {
    const clean = String(rel || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!clean || !isSafeManagedRelPath(clean)) continue;
    const candidate = path.join(absTarget, ...clean.split('/'));
    try {
      const st = fs.lstatSync(candidate);
      if (!st.isSymbolicLink() && (st.isFile() || (st.isDirectory() && fs.readdirSync(candidate).length > 0))) return true;
    } catch {}
  }
  return false;
}

export function removeManagedFilesKeepingUserAssets(targetDir, userAssetPaths = USER_OWNED_ASSET_PATHS) {
  const walk = (curDir, prefix) => {
    let entries = [];
    try { entries = fs.readdirSync(curDir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (isProtectedUserPath(rel, userAssetPaths)) continue;
      const full = path.join(curDir, ent.name);
      try {
        const st = fs.lstatSync(full);
        if (st.isSymbolicLink() || st.isFile()) { clearReadOnlyRegularFile(full); fs.unlinkSync(full); }
        else if (st.isDirectory()) {
          walk(full, rel);
          if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
        }
      } catch {}
    }
  };
  walk(path.resolve(targetDir), '');
}

export function syncPluginDirWithManifest({ sourceDir, targetDir, rootFiles, dirs, copyFile, copyDir, assertNotSymlink }) {
  const srcManifest = readInstallManifestFromDir(sourceDir);
  const protectedPaths = mergeProtectedUserPaths(srcManifest?.protectedUserPaths);
  let copiedFiles = 0;
  const missingOptional = [];
  for (const rel of rootFiles) {
    if (isProtectedUserPath(rel, protectedPaths) && fs.existsSync(path.join(targetDir, rel))) continue;
    const src = path.join(sourceDir, rel);
    const dst = path.join(targetDir, rel);
    if (assertNotSymlink(src, 'source')) { copyFile(src, dst); copiedFiles += 1; }
    else missingOptional.push(rel);
  }
  for (const dirName of dirs) {
    copiedFiles += copyDir(path.join(sourceDir, dirName), path.join(targetDir, dirName), dirName, protectedPaths);
  }
  const srcManifestFile = path.join(sourceDir, INSTALL_MANIFEST_FILENAME);
  if (fs.existsSync(srcManifestFile)) copyFile(srcManifestFile, path.join(targetDir, INSTALL_MANIFEST_FILENAME));
  const obsoleteList = [
    ...DEFAULT_OBSOLETE_PATHS,
    ...(Array.isArray(srcManifest?.obsoletePaths) ? srcManifest.obsoletePaths : []),
  ];
  if (obsoleteList.length > 0) cleanupObsoletePathsInDir(targetDir, obsoleteList, protectedPaths);
  return { copiedFiles, missingOptional };
}
