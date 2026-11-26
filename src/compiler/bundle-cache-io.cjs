// .bundle-cache.json v2 底层磁盘 I/O、SHA-256 源指纹与单读根缓存
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  IS_WIN,
  isSymlinkPathSync,
  getFileSig,
} = require('../utils/fs-safe.cjs');
const {
  STYLE_ID,
  LEGACY_STYLE_ID,
  SETTING_BINDING,
} = require('../config/schema.cjs');
const { RUNTIME_PARTS } = require('./part-preprocess.cjs');
const {
  BUNDLE_CACHE_SCHEMA_VERSION,
  BUNDLE_CACHE_MAX_FILE_BYTES,
  SHA256_HEX_RE,
  BUNDLE_CACHE_ROOT_MEM_TTL_MS,
  freezeBundleCacheRoot,
  isValidBundleBaseTemplate,
  isValidBundleCacheEntry,
  isValidChannelCacheEntry,
} = require('./cache-validate.cjs');

// 收集所有会影响打包/通道输出的自源模块（cdp.js + 工具/配置真相源 + src/compiler + src/channels）
function listSelfFingerprintFiles(rootDir) {
  const files = [{ rel: 'cdp.js', fullPath: path.join(rootDir, 'cdp.js'), optional: false }];
  const fixedSrc = [
    'src/utils/fs-safe.cjs',
    'src/config/schema.cjs',
  ];
  for (const rel of fixedSrc) {
    files.push({ rel, fullPath: path.join(rootDir, ...rel.split('/')), optional: true });
  }
  for (const subDir of ['src/compiler', 'src/channels']) {
    const absDir = path.join(rootDir, ...subDir.split('/'));
    try {
      if (!fs.existsSync(absDir)) continue;
      const names = fs.readdirSync(absDir).filter((n) => n.endsWith('.cjs') || n.endsWith('.mjs')).sort();
      for (const name of names) {
        files.push({ rel: `${subDir}/${name}`, fullPath: path.join(absDir, name), optional: true });
      }
    } catch {}
  }
  return files;
}

function createBundleCacheIo({ rootDir, pluginVersion, templates }) {
  let _cdpSelfHashCache = { sig: '', hash: '' };
  let _bundleCacheRootCache = {
    resolved: '',
    sig: '',
    cachedAt: 0,
    parsed: null,
  };

  function invalidateBundleCacheRootCache(targetPath = null) {
    if (!targetPath) {
      _bundleCacheRootCache = { resolved: '', sig: '', cachedAt: 0, parsed: null };
      return;
    }
    const resolved = path.resolve(targetPath);
    if (_bundleCacheRootCache.resolved === resolved) {
      _bundleCacheRootCache = { resolved: '', sig: '', cachedAt: 0, parsed: null };
    }
  }

  function getBundleSourceFiles() {
    const files = [
      ...listSelfFingerprintFiles(rootDir),
      { rel: 'style.css', fullPath: path.join(rootDir, 'style.css'), optional: false },
      // i18n-locales.js 活跃语言迷你切片会打入 Channel 1 bootCfg.__uiSlice，纳入源哈希确保缓存强一致
      { rel: 'i18n-locales.js', fullPath: path.join(rootDir, 'i18n-locales.js'), optional: true },
    ];
    for (const partName of RUNTIME_PARTS) {
      files.push({ rel: partName, fullPath: path.join(rootDir, partName), optional: false });
      if (partName === 'vendor/effort-slider/slider-coexist.js') {
        files.push({
          rel: 'vendor/effort-slider/upstream-client.js',
          fullPath: path.join(rootDir, 'vendor', 'effort-slider', 'upstream-client.js'),
          optional: true,
        });
      }
    }
    return files;
  }

  // 快速 stat 指纹（仅用于同进程热路径配合 _warmBaseCache 毫秒级刷新 config，跨进程冷启一律使用 SHA-256）
  function getBundleSourceStatSig() {
    const parts = [];
    for (const item of getBundleSourceFiles()) {
      if (item.optional && !fs.existsSync(item.fullPath)) {
        parts.push(`${item.rel}:MISSING`);
        continue;
      }
      parts.push(`${item.rel}:${getFileSig(item.fullPath)}`);
    }
    return parts.join(';');
  }

  // 计算全部打包输入源文件的 SHA-256 内容指纹（100% 免疫 mtime 抖动与 git checkout）
  function computeBundleSourceHash() {
    const hash = crypto.createHash('sha256');
    hash.update(`schema:${BUNDLE_CACHE_SCHEMA_VERSION}\0`);
    hash.update(`version:${pluginVersion}\0`);
    hash.update(`consts:${STYLE_ID}:${LEGACY_STYLE_ID}:${SETTING_BINDING}\0`);
    for (const item of getBundleSourceFiles()) {
      hash.update(`file:${item.rel}\0`);
      if (item.optional && !fs.existsSync(item.fullPath)) {
        hash.update('MISSING\0');
        continue;
      }
      const buf = fs.readFileSync(item.fullPath);
      hash.update(`len:${buf.length}\0`);
      hash.update(buf);
      hash.update('\0');
    }
    return hash.digest('hex');
  }

  // 计算规范化后的有效 bootCfg 指纹（确保缓存命中输出与现场编译逐字节 100% 一致）
  function computeBundleConfigHash(config) {
    const uiSlice = templates.buildRuntimeUiSlicePayload(config);
    const effective = {
      ...(config && typeof config === 'object' ? config : {}),
      ...(uiSlice ? { __uiSlice: uiSlice } : {}),
      binding: SETTING_BINDING,
      codeHash: '',
      __fromFile: true,
    };
    const serialized = JSON.stringify(effective);
    return crypto
      .createHash('sha256')
      .update(`cfg:v${BUNDLE_CACHE_SCHEMA_VERSION}\0`)
      .update(serialized)
      .digest('hex');
  }

  // 计算编译管线自身（cdp.js + src/config/schema.cjs + src/compiler/*.cjs + src/channels/*.cjs）统一指纹
  function getCdpSelfSourceHash() {
    try {
      const files = listSelfFingerprintFiles(rootDir);
      const sigParts = [];
      for (const item of files) {
        if (!fs.existsSync(item.fullPath)) {
          sigParts.push(`${item.rel}:MISSING`);
        } else {
          sigParts.push(`${item.rel}:${getFileSig(item.fullPath)}`);
        }
      }
      const sig = sigParts.join(';');
      if (_cdpSelfHashCache.sig === sig && _cdpSelfHashCache.hash) {
        return _cdpSelfHashCache.hash;
      }
      const h = crypto.createHash('sha256');
      for (const item of files) {
        h.update(`self:${item.rel}\0`);
        if (!fs.existsSync(item.fullPath)) {
          h.update('MISSING\0');
          continue;
        }
        const buf = fs.readFileSync(item.fullPath);
        h.update(`len:${buf.length}\0`);
        h.update(buf);
        h.update('\0');
      }
      const hash = h.digest('hex');
      _cdpSelfHashCache = { sig, hash };
      return hash;
    } catch {
      return pluginVersion;
    }
  }

  function computeChannelSourceHash(channelName, fileEntries, extraTag = '') {
    const hash = crypto.createHash('sha256');
    hash.update(`schema:${BUNDLE_CACHE_SCHEMA_VERSION}\0version:${pluginVersion}\0channel:${channelName}\0`);
    hash.update(`cdp:${getCdpSelfSourceHash()}\0`);
    if (extraTag) {
      hash.update(`extra:${extraTag}\0`);
    }
    for (const item of fileEntries) {
      hash.update(`file:${item.rel}\0`);
      const buf = Buffer.isBuffer(item.content) ? item.content : Buffer.from(String(item.content || ''), 'utf8');
      hash.update(`len:${buf.length}\0`);
      hash.update(buf);
      hash.update('\0');
    }
    return hash.digest('hex');
  }

  function loadVerifiedBundleCacheRootSync(cachePath, bypassMemCache = false) {
    const resolved = path.resolve(cachePath);
    const dir = path.dirname(resolved);
    if (isSymlinkPathSync(dir)) {
      invalidateBundleCacheRootCache(resolved);
      return { ok: false, reason: 'symlink-dir', parsed: null, fromMemCache: false };
    }
    let st;
    try {
      st = fs.lstatSync(resolved);
    } catch (err) {
      invalidateBundleCacheRootCache(resolved);
      if (err && err.code === 'ENOENT') {
        return { ok: false, reason: 'missing', parsed: null, fromMemCache: false };
      }
      return { ok: false, reason: 'stat-error', parsed: null, fromMemCache: false };
    }
    if (st.isSymbolicLink() || !st.isFile()) {
      invalidateBundleCacheRootCache(resolved);
      return { ok: false, reason: 'not-regular-file', parsed: null, fromMemCache: false };
    }
    if (st.size <= 0 || st.size > BUNDLE_CACHE_MAX_FILE_BYTES) {
      invalidateBundleCacheRootCache(resolved);
      return { ok: false, reason: 'size-out-of-range', parsed: null, fromMemCache: false };
    }
    const sig = `${st.mtimeMs}:${st.size}:${st.ctimeMs}:${st.ino || 0}`;
    const now = Date.now();
    if (
      !bypassMemCache &&
      _bundleCacheRootCache.parsed &&
      _bundleCacheRootCache.resolved === resolved &&
      _bundleCacheRootCache.sig === sig &&
      now >= _bundleCacheRootCache.cachedAt &&
      now - _bundleCacheRootCache.cachedAt <= BUNDLE_CACHE_ROOT_MEM_TTL_MS
    ) {
      return { ok: true, parsed: _bundleCacheRootCache.parsed, fromMemCache: true };
    }
    let parsed;
    try {
      const raw = fs.readFileSync(resolved, 'utf8');
      parsed = JSON.parse(raw);
    } catch {
      invalidateBundleCacheRootCache(resolved);
      return { ok: false, reason: 'parse-or-read-error', parsed: null, fromMemCache: false };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      invalidateBundleCacheRootCache(resolved);
      return { ok: false, reason: 'invalid-root', parsed: null, fromMemCache: false };
    }
    const hasOwn = (k) => Object.prototype.hasOwnProperty.call(parsed, k);
    if (!hasOwn('schemaVersion') || parsed.schemaVersion !== BUNDLE_CACHE_SCHEMA_VERSION) {
      invalidateBundleCacheRootCache(resolved);
      return { ok: false, reason: 'schema-mismatch', parsed: null, fromMemCache: false };
    }
    if (!hasOwn('pluginVersion') || parsed.pluginVersion !== pluginVersion) {
      invalidateBundleCacheRootCache(resolved);
      return { ok: false, reason: 'version-mismatch', parsed: null, fromMemCache: false };
    }
    freezeBundleCacheRoot(parsed);
    _bundleCacheRootCache = { resolved, sig, cachedAt: now, parsed };
    return { ok: true, parsed, fromMemCache: false };
  }

  function readValidBundleCacheRootSync(cachePath, bypassMemCache = false) {
    try {
      const loaded = loadVerifiedBundleCacheRootSync(cachePath, bypassMemCache);
      return loaded.ok ? loaded.parsed : null;
    } catch {
      invalidateBundleCacheRootCache(cachePath);
      return null;
    }
  }

  function tryReadBundleCacheHitSync(cachePath, expectedSourceHash, expectedConfigHash) {
    try {
      const resolved = path.resolve(cachePath);
      for (let attempt = 0; attempt < 2; attempt++) {
        const loaded = loadVerifiedBundleCacheRootSync(resolved, attempt > 0);
        if (!loaded.ok) {
          return { hit: false, reason: loaded.reason, existingEntries: [], baseTemplate: null };
        }
        const parsed = loaded.parsed;
        const hasOwn = (k) => Object.prototype.hasOwnProperty.call(parsed, k);
        if (
          !hasOwn('sourceHash') ||
          typeof parsed.sourceHash !== 'string' ||
          !SHA256_HEX_RE.test(parsed.sourceHash) ||
          parsed.sourceHash !== expectedSourceHash
        ) {
          invalidateBundleCacheRootCache(resolved);
          if (loaded.fromMemCache && attempt === 0) continue;
          return { hit: false, reason: 'source-hash-mismatch', existingEntries: [], baseTemplate: null };
        }
        if (!hasOwn('entries') || !Array.isArray(parsed.entries)) {
          invalidateBundleCacheRootCache(resolved);
          if (loaded.fromMemCache && attempt === 0) continue;
          return { hit: false, reason: 'invalid-entries', existingEntries: [], baseTemplate: null };
        }
        if (!isValidBundleBaseTemplate(parsed)) {
          invalidateBundleCacheRootCache(resolved);
          if (loaded.fromMemCache && attempt === 0) continue;
          return { hit: false, reason: 'invalid-base-template', existingEntries: [], baseTemplate: null };
        }
        const baseTemplate = {
          codeHash: parsed.codeHash,
          basePrefix: parsed.basePrefix,
          baseSuffix: parsed.baseSuffix,
          baseSha256: parsed.baseSha256,
        };
        let retryFromDisk = false;
        for (const ent of parsed.entries) {
          if (
            ent &&
            typeof ent === 'object' &&
            !Array.isArray(ent) &&
            Object.prototype.hasOwnProperty.call(ent, 'configHash') &&
            ent.configHash === expectedConfigHash
          ) {
            if (isValidBundleCacheEntry(ent, baseTemplate)) {
              return {
                hit: true,
                reason: 'hit',
                expr: baseTemplate.basePrefix + ent.bootCfgJson + baseTemplate.baseSuffix,
                codeHash: ent.codeHash,
                existingEntries: [],
                baseTemplate,
              };
            }
            invalidateBundleCacheRootCache(resolved);
            if (loaded.fromMemCache && attempt === 0) {
              retryFromDisk = true;
              break;
            }
            return { hit: false, reason: 'corrupt-matching-entry', existingEntries: [], baseTemplate: null };
          }
        }
        if (retryFromDisk) continue;
        return { hit: false, reason: 'config-miss', existingEntries: parsed.entries, baseTemplate };
      }
      return { hit: false, reason: 'corrupt-matching-entry', existingEntries: [], baseTemplate: null };
    } catch {
      invalidateBundleCacheRootCache(cachePath);
      return { hit: false, reason: 'parse-or-read-error', existingEntries: [], baseTemplate: null };
    }
  }

  function tryReadChannelCacheHitSync(cachePath, channelName, expectedSourceHash) {
    const resolved = path.resolve(cachePath);
    for (let attempt = 0; attempt < 2; attempt++) {
      const loaded = loadVerifiedBundleCacheRootSync(resolved, attempt > 0);
      if (!loaded.ok || !loaded.parsed) {
        return { hit: false, reason: 'missing' };
      }
      const root = loaded.parsed;
      if (!root.channels || typeof root.channels !== 'object' || Array.isArray(root.channels)) {
        return { hit: false, reason: 'missing' };
      }
      if (!Object.prototype.hasOwnProperty.call(root.channels, channelName)) {
        return { hit: false, reason: 'channel-missing' };
      }
      const ent = root.channels[channelName];
      if (!ent || typeof ent !== 'object' || ent.sourceHash !== expectedSourceHash) {
        invalidateBundleCacheRootCache(resolved);
        if (loaded.fromMemCache && attempt === 0) continue;
        return { hit: false, reason: 'source-hash-mismatch' };
      }
      if (!isValidChannelCacheEntry(channelName, ent)) {
        invalidateBundleCacheRootCache(resolved);
        if (loaded.fromMemCache && attempt === 0) continue;
        return { hit: false, reason: 'corrupt-channel-entry' };
      }
      return { hit: true, entry: ent };
    }
    return { hit: false, reason: 'corrupt-channel-entry' };
  }

  function writeBundleCacheAtomicSync(cachePath, payloadObj) {
    let tmpPath = null;
    let fd = null;
    try {
      const resolved = path.resolve(cachePath);
      const dir = path.dirname(resolved);
      if (isSymlinkPathSync(dir) || isSymlinkPathSync(resolved)) {
        return false;
      }
      fs.mkdirSync(dir, { recursive: true });
      const dirStat = fs.lstatSync(dir);
      if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
        return false;
      }
      try {
        const existingStat = fs.lstatSync(resolved);
        if (existingStat.isSymbolicLink() || !existingStat.isFile()) {
          return false;
        }
      } catch (err) {
        if (!err || err.code !== 'ENOENT') return false;
      }

      const jsonText = JSON.stringify(payloadObj);
      if (Buffer.byteLength(jsonText, 'utf8') > BUNDLE_CACHE_MAX_FILE_BYTES) {
        return false;
      }

      const base = path.basename(resolved);
      const safeBase = base.startsWith('.') ? base.slice(1) : base;
      const rand = crypto.randomBytes(6).toString('hex');
      tmpPath = path.join(dir, `.${safeBase}.${process.pid}.${rand}.tmp`);
      fd = fs.openSync(tmpPath, 'wx', 0o600);
      fs.writeFileSync(fd, jsonText, 'utf8');
      fs.closeSync(fd);
      fd = null;
      try { fs.chmodSync(tmpPath, 0o600); } catch {}

      if (isSymlinkPathSync(dir) || isSymlinkPathSync(resolved)) {
        try { fs.unlinkSync(tmpPath); } catch {}
        return false;
      }

      let renamed = false;
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          fs.renameSync(tmpPath, resolved);
          renamed = true;
          break;
        } catch (err) {
          lastErr = err;
          if (!IS_WIN || !['EBUSY', 'EPERM', 'EACCES', 'EEXIST'].includes(err && err.code)) {
            throw err;
          }
        }
      }
      if (!renamed) {
        if (IS_WIN && ['EBUSY', 'EPERM', 'EACCES', 'EEXIST'].includes(lastErr && lastErr.code)) {
          if (isSymlinkPathSync(dir) || isSymlinkPathSync(resolved)) {
            try { fs.unlinkSync(tmpPath); } catch {}
            return false;
          }
          fs.copyFileSync(tmpPath, resolved);
          try { fs.unlinkSync(tmpPath); } catch {}
        } else {
          throw lastErr;
        }
      }
      try { fs.chmodSync(resolved, 0o600); } catch {}
      invalidateBundleCacheRootCache(resolved);
      return true;
    } catch {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch {}
      }
      if (tmpPath) {
        try { fs.unlinkSync(tmpPath); } catch {}
      }
      invalidateBundleCacheRootCache(cachePath);
      return false;
    }
  }

  return {
    invalidateBundleCacheRootCache,
    getBundleSourceFiles,
    getBundleSourceStatSig,
    computeBundleSourceHash,
    computeBundleConfigHash,
    getCdpSelfSourceHash,
    computeChannelSourceHash,
    readValidBundleCacheRootSync,
    tryReadBundleCacheHitSync,
    tryReadChannelCacheHitSync,
    writeBundleCacheAtomicSync,
  };
}

module.exports = {
  listSelfFingerprintFiles,
  createBundleCacheIo,
};
