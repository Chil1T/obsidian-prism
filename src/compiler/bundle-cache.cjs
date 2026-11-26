// .bundle-cache.json v2 高层编排：热模板复用、多通道磁盘缓存、延迟批量刷盘与 buildInjectExpression
'use strict';

const path = require('path');
const { sha256Text, computeHash } = require('../utils/fs-safe.cjs');
const { SETTING_BINDING, reconcileConfigAliases } = require('../config/schema.cjs');
const {
  BUNDLE_CACHE_SCHEMA_VERSION,
  BUNDLE_CACHE_FILENAME,
  BUNDLE_CACHE_MAX_ENTRIES,
  CHANNEL_CACHE_NAMES,
  SHA256_HEX_RE,
  resolveBundleCachePathOption,
  isValidBundleBaseTemplate,
  isValidBundleCacheEntry,
  extractValidChannelsMap,
} = require('./cache-validate.cjs');
const { createBundleCacheIo } = require('./bundle-cache-io.cjs');

function createInitialBundleCacheStats() {
  return {
    diskHits: 0,
    diskBaseHits: 0,
    diskMisses: 0,
    diskWrites: 0,
    diskWriteFailures: 0,
    diskReadFallbacks: 0,
    compileUnifiedRuns: 0,
    mangledUnitRuns: 0,
    cssMinifyRuns: 0,
    deferredExprHashRuns: 0,
    channelDiskHits: 0,
    channelDiskMisses: 0,
    channelCompileRuns: 0,
    channelHitsByName: {
      omni: 0,
      sidebar: 0,
      hostI18n: 0,
      thought: 0,
      inlineDiff: 0,
      wallpaper: 0,
      periodicPicker: 0,
      settings: 0,
      mascot: 0,
      suggester: 0,
      homeStudio: 0,
    },
    lastOutcome: 'none',
    lastCachePath: null,
  };
}

function createBundleCache({
  rootDir = path.resolve(__dirname, '..', '..'),
  pluginVersion,
  stats = createInitialBundleCacheStats(),
  readConfig,
  compiler,
  templates,
}) {
  const io = createBundleCacheIo({ rootDir, pluginVersion, templates });

  let _diskCacheLastSource = { sourceHash: '', codeHash: '' };
  let _warmBaseCache = {
    statSig: '',
    sourceHash: '',
    codeHash: '',
    basePrefix: '',
    baseSuffix: '',
    baseSha256: '',
  };
  let _pendingDiskCachePersist = null;
  const _pendingChannelCacheWrites = new Map();
  let _lastCompiledSourceHash = '';
  const _channelMemCaches = new Map();

  function getChannelMemCache(name) {
    return _channelMemCaches.get(name) || null;
  }

  function setChannelMemCache(name, value) {
    _channelMemCaches.set(name, value);
  }

  function getBundleCacheStats() {
    return {
      ...stats,
      channelHitsByName: { ...stats.channelHitsByName },
    };
  }

  function resetBundleCacheStats() {
    const fresh = createInitialBundleCacheStats();
    Object.assign(stats, fresh);
    for (const mem of _channelMemCaches.values()) {
      try { mem.cachedPaths?.clear?.(); } catch {}
    }
    io.invalidateBundleCacheRootCache();
  }

  function queuePendingChannelCacheWrite(cachePath, channelName, record) {
    if (!cachePath || !channelName || !record) return;
    const resolved = path.resolve(cachePath);
    let bucket = _pendingChannelCacheWrites.get(resolved);
    if (!bucket) {
      bucket = {};
      _pendingChannelCacheWrites.set(resolved, bucket);
    }
    bucket[channelName] = record;
  }

  function persistChannelsOnlySync(cachePath, channelUpdates) {
    if (!cachePath || !channelUpdates || typeof channelUpdates !== 'object') return false;
    const resolved = path.resolve(cachePath);
    const existing = io.readValidBundleCacheRootSync(resolved);
    const mergedChannels = {
      ...extractValidChannelsMap(existing?.channels),
      ...extractValidChannelsMap(channelUpdates),
    };
    if (Object.keys(mergedChannels).length === 0) return false;
    const payload =
      existing &&
      typeof existing.sourceHash === 'string' &&
      SHA256_HEX_RE.test(existing.sourceHash) &&
      Array.isArray(existing.entries) &&
      isValidBundleBaseTemplate(existing)
        ? {
            schemaVersion: BUNDLE_CACHE_SCHEMA_VERSION,
            pluginVersion,
            sourceHash: existing.sourceHash,
            codeHash: existing.codeHash,
            basePrefix: existing.basePrefix,
            baseSuffix: existing.baseSuffix,
            baseSha256: existing.baseSha256,
            entries: existing.entries,
            channels: mergedChannels,
          }
        : {
            schemaVersion: BUNDLE_CACHE_SCHEMA_VERSION,
            pluginVersion,
            channels: mergedChannels,
          };
    if (io.writeBundleCacheAtomicSync(resolved, payload)) {
      stats.diskWrites += 1;
      return true;
    }
    stats.diskWriteFailures += 1;
    return false;
  }

  function resolveChannelAssetsWithDiskCache({
    channelName,
    memCache = null,
    setMemCache = null,
    sig,
    fileEntries,
    extraTag = '',
    opts = null,
    compileFn,
    toCacheEntry,
    fromCacheEntry,
  }) {
    const curMem = memCache || getChannelMemCache(channelName);
    const updateMem = (nextVal) => {
      setChannelMemCache(channelName, nextVal);
      if (typeof setMemCache === 'function') setMemCache(nextVal);
    };
    const cachePath = resolveBundleCachePathOption(opts);
    const deferCacheWrite = Boolean(opts && opts.deferCacheWrite === true);
    if (!cachePath) {
      if (curMem && curMem.sig === sig && curMem.codeHash) {
        return curMem;
      }
      stats.channelCompileRuns += 1;
      const compiled = compileFn();
      const nextMem = { ...compiled, sig, sourceHash: '', cachedPaths: new Set() };
      updateMem(nextMem);
      return nextMem;
    }

    const resolvedCachePath = path.resolve(cachePath);
    stats.lastCachePath = resolvedCachePath;
    const sourceHash = io.computeChannelSourceHash(channelName, fileEntries, extraTag);

    if (
      curMem &&
      curMem.sourceHash === sourceHash &&
      curMem.cachedPaths &&
      curMem.cachedPaths.has(resolvedCachePath)
    ) {
      return curMem;
    }

    const diskHit = io.tryReadChannelCacheHitSync(resolvedCachePath, channelName, sourceHash);
    if (diskHit.hit) {
      stats.channelDiskHits += 1;
      stats.channelHitsByName[channelName] = (stats.channelHitsByName[channelName] || 0) + 1;
      const restored = fromCacheEntry(diskHit.entry);
      const cachedPaths =
        curMem && curMem.sourceHash === sourceHash && curMem.cachedPaths
          ? curMem.cachedPaths
          : new Set();
      cachedPaths.add(resolvedCachePath);
      const nextMem = { ...restored, sig, sourceHash, cachedPaths };
      updateMem(nextMem);
      return nextMem;
    }

    stats.channelDiskMisses += 1;
    let assets;
    if (curMem && curMem.sourceHash === sourceHash && curMem.codeHash) {
      assets = curMem;
    } else {
      stats.channelCompileRuns += 1;
      assets = compileFn();
    }
    const record = toCacheEntry(assets, sourceHash);
    const cachedPaths =
      curMem && curMem.sourceHash === sourceHash && curMem.cachedPaths
        ? curMem.cachedPaths
        : new Set();
    if (deferCacheWrite) {
      queuePendingChannelCacheWrite(resolvedCachePath, channelName, record);
    } else if (persistChannelsOnlySync(resolvedCachePath, { [channelName]: record })) {
      cachedPaths.add(resolvedCachePath);
    }
    const nextMem = { ...assets, sig, sourceHash, cachedPaths };
    updateMem(nextMem);
    return nextMem;
  }

  function persistBundleCacheRecordSync(
    cachePath,
    sourceHash,
    baseForDisk,
    newEntry,
    existingRawEntries = null,
    extraChannels = null
  ) {
    if (!cachePath || !sourceHash || !baseForDisk || !newEntry) return false;
    const resolved = path.resolve(cachePath);
    let rawEntries = Array.isArray(existingRawEntries) ? existingRawEntries : null;
    let existingChannels = {};
    const existingRoot = io.readValidBundleCacheRootSync(resolved);
    if (existingRoot) {
      existingChannels = extractValidChannelsMap(existingRoot.channels);
      if (rawEntries === null && existingRoot.sourceHash === sourceHash && Array.isArray(existingRoot.entries)) {
        rawEntries = existingRoot.entries;
      }
    }
    if (rawEntries === null) {
      rawEntries = [];
    }
    const retained = [];
    const seen = new Set([newEntry.configHash]);
    for (const rawEnt of rawEntries) {
      if (retained.length >= BUNDLE_CACHE_MAX_ENTRIES - 1) break;
      if (
        rawEnt &&
        typeof rawEnt === 'object' &&
        !Array.isArray(rawEnt) &&
        Object.prototype.hasOwnProperty.call(rawEnt, 'configHash') &&
        typeof rawEnt.configHash === 'string' &&
        !seen.has(rawEnt.configHash) &&
        isValidBundleCacheEntry(rawEnt, baseForDisk)
      ) {
        seen.add(rawEnt.configHash);
        retained.push({
          configHash: rawEnt.configHash,
          codeHash: rawEnt.codeHash,
          bootCfgJson: rawEnt.bootCfgJson,
          exprSha256: rawEnt.exprSha256,
          updatedAt: Number.isFinite(Number(rawEnt.updatedAt)) ? Number(rawEnt.updatedAt) : 0,
        });
      }
    }
    const pendingForPath = _pendingChannelCacheWrites.get(resolved) || null;
    if (pendingForPath) {
      _pendingChannelCacheWrites.delete(resolved);
    }
    const mergedChannels = {
      ...existingChannels,
      ...extractValidChannelsMap(pendingForPath),
      ...extractValidChannelsMap(extraChannels),
    };
    const payload = {
      schemaVersion: BUNDLE_CACHE_SCHEMA_VERSION,
      pluginVersion,
      sourceHash,
      codeHash: baseForDisk.codeHash,
      basePrefix: baseForDisk.basePrefix,
      baseSuffix: baseForDisk.baseSuffix,
      baseSha256: baseForDisk.baseSha256,
      entries: [newEntry, ...retained],
      ...(Object.keys(mergedChannels).length > 0 ? { channels: mergedChannels } : {}),
    };
    if (io.writeBundleCacheAtomicSync(resolved, payload)) {
      stats.diskWrites += 1;
      return true;
    }
    stats.diskWriteFailures += 1;
    return false;
  }

  function markChannelCachedOnPath(cachePath, chMap) {
    if (!cachePath || !chMap || typeof chMap !== 'object') return;
    const resolved = path.resolve(cachePath);
    for (const name of CHANNEL_CACHE_NAMES) {
      const rec = chMap[name];
      const mem = _channelMemCaches.get(name);
      if (rec && mem && mem.sourceHash && mem.sourceHash === rec.sourceHash && mem.cachedPaths) {
        mem.cachedPaths.add(resolved);
      }
    }
  }

  function flushPendingBundleCache() {
    const pending = _pendingDiskCachePersist;
    _pendingDiskCachePersist = null;
    const pendingChannelsSnapshot = new Map(_pendingChannelCacheWrites);
    _pendingChannelCacheWrites.clear();

    let anyWritten = false;
    if (pending) {
      const resolved = path.resolve(pending.cachePath);
      const matchedChannels = pendingChannelsSnapshot.get(resolved) || null;
      if (matchedChannels) {
        pendingChannelsSnapshot.delete(resolved);
      }
      if (!pending.newEntry.exprSha256) {
        const exprText =
          typeof pending.deferredExpr === 'string'
            ? pending.deferredExpr
            : pending.baseForDisk.basePrefix + pending.newEntry.bootCfgJson + pending.baseForDisk.baseSuffix;
        pending.newEntry.exprSha256 = sha256Text(exprText);
        stats.deferredExprHashRuns += 1;
      }
      if (
        persistBundleCacheRecordSync(
          resolved,
          pending.sourceHash,
          pending.baseForDisk,
          pending.newEntry,
          null,
          matchedChannels
        )
      ) {
        markChannelCachedOnPath(resolved, matchedChannels);
        anyWritten = true;
      }
    }

    for (const [chPath, chMap] of pendingChannelsSnapshot.entries()) {
      if (persistChannelsOnlySync(chPath, chMap)) {
        markChannelCachedOnPath(chPath, chMap);
        anyWritten = true;
      }
    }
    return anyWritten;
  }

  function resolveCurrentBundleCodeHash() {
    if (compiler.hasCompiledUnifiedBundle()) {
      return computeHash(compiler.readRuntimeBundle());
    }
    if (_warmBaseCache.codeHash && _warmBaseCache.statSig) {
      try {
        if (io.getBundleSourceStatSig() === _warmBaseCache.statSig) {
          return _warmBaseCache.codeHash;
        }
      } catch {}
    }
    if (_diskCacheLastSource.sourceHash && _diskCacheLastSource.codeHash) {
      try {
        if (io.computeBundleSourceHash() === _diskCacheLastSource.sourceHash) {
          return _diskCacheLastSource.codeHash;
        }
      } catch {}
    }
    return computeHash(compiler.readRuntimeBundle());
  }

  function buildInjectExpression(customConfig, opts = null) {
    const config = customConfig ? reconcileConfigAliases(customConfig) : readConfig();
    const uiSlice = templates.buildRuntimeUiSlicePayload(config);
    const buildBootCfgJson = (codeHash) =>
      JSON.stringify({
        ...config,
        ...(uiSlice ? { __uiSlice: uiSlice } : {}),
        binding: SETTING_BINDING,
        codeHash,
        __fromFile: true,
      });
    const cachePath = resolveBundleCachePathOption(opts);
    const deferCacheWrite = Boolean(opts && opts.deferCacheWrite === true);

    if (cachePath && deferCacheWrite && _warmBaseCache.basePrefix && _warmBaseCache.statSig) {
      try {
        if (io.getBundleSourceStatSig() === _warmBaseCache.statSig) {
          const codeHash = _warmBaseCache.codeHash;
          const bootCfgJson = buildBootCfgJson(codeHash);
          const expr = _warmBaseCache.basePrefix + bootCfgJson + _warmBaseCache.baseSuffix;
          const configHash = io.computeBundleConfigHash(config);
          stats.diskBaseHits += 1;
          stats.lastOutcome = 'warm-base-hit';
          stats.lastCachePath = cachePath;
          _pendingDiskCachePersist = {
            cachePath,
            sourceHash: _warmBaseCache.sourceHash,
            baseForDisk: {
              codeHash,
              basePrefix: _warmBaseCache.basePrefix,
              baseSuffix: _warmBaseCache.baseSuffix,
              baseSha256: _warmBaseCache.baseSha256,
            },
            newEntry: {
              configHash,
              codeHash,
              bootCfgJson,
              exprSha256: null,
              updatedAt: Date.now(),
            },
            deferredExpr: expr,
          };
          return expr;
        }
      } catch {}
    }

    let sourceHash = '';
    let configHash = '';
    let existingRawEntries = [];
    let cachedBaseTemplate = null;
    let forceInvalidateMem = false;

    if (cachePath) {
      stats.lastCachePath = cachePath;
      try {
        sourceHash = io.computeBundleSourceHash();
        configHash = io.computeBundleConfigHash(config);
        const lookup = io.tryReadBundleCacheHitSync(cachePath, sourceHash, configHash);
        if (lookup.hit) {
          stats.diskHits += 1;
          stats.lastOutcome = 'disk-hit';
          _diskCacheLastSource = { sourceHash, codeHash: lookup.codeHash };
          if (lookup.baseTemplate) {
            try {
              _warmBaseCache = {
                statSig: io.getBundleSourceStatSig(),
                sourceHash,
                ...lookup.baseTemplate,
              };
            } catch {}
          }
          return lookup.expr;
        }
        stats.diskMisses += 1;
        if (lookup.reason === 'source-hash-mismatch') {
          forceInvalidateMem = true;
        } else if (lookup.reason !== 'missing' && lookup.reason !== 'config-miss') {
          stats.diskReadFallbacks += 1;
        }
        if (Array.isArray(lookup.existingEntries)) {
          existingRawEntries = lookup.existingEntries;
        }
        if (lookup.reason === 'config-miss' && lookup.baseTemplate) {
          cachedBaseTemplate = lookup.baseTemplate;
        }
      } catch {
        stats.diskMisses += 1;
        stats.diskReadFallbacks += 1;
        sourceHash = '';
        configHash = '';
        existingRawEntries = [];
        cachedBaseTemplate = null;
      }
    }

    let codeHash = '';
    let bootCfgJson = '';
    let expr = '';
    let baseForDisk = null;

    if (cachedBaseTemplate) {
      codeHash = cachedBaseTemplate.codeHash;
      bootCfgJson = buildBootCfgJson(codeHash);
      expr = cachedBaseTemplate.basePrefix + bootCfgJson + cachedBaseTemplate.baseSuffix;
      baseForDisk = cachedBaseTemplate;
      stats.diskBaseHits += 1;
      stats.lastOutcome = 'disk-base-hit';
    } else {
      if (forceInvalidateMem || (sourceHash && _lastCompiledSourceHash && sourceHash !== _lastCompiledSourceHash)) {
        compiler.clearMemCaches();
      }

      const compiledBase = compiler.compileBaseInjectTemplate();
      codeHash = compiledBase.codeHash;
      bootCfgJson = buildBootCfgJson(codeHash);
      if (compiledBase.basePrefix !== null && compiledBase.baseSuffix !== null) {
        expr = compiledBase.basePrefix + bootCfgJson + compiledBase.baseSuffix;
        baseForDisk = {
          codeHash,
          basePrefix: compiledBase.basePrefix,
          baseSuffix: compiledBase.baseSuffix,
          baseSha256: compiledBase.baseSha256,
        };
      } else {
        expr = templates.getInjectWrapperTemplate()
          .replace('__AG_INJ_CSS__', () => compiledBase.packedCss)
          .replace('__AG_INJ_CSSHASH__', () => compiledBase.cssHashJson)
          .replace('__AG_INJ_BOOTCFG__', () => bootCfgJson)
          .replace('__AG_INJ_CODEHASH__', () => compiledBase.codeHashJson)
          .replace('__AG_INJ_BUNDLE__();', () => compiledBase.bundle);
      }
      if (sourceHash) {
        _lastCompiledSourceHash = sourceHash;
      }
      stats.lastOutcome = 'compiled';
    }

    if (sourceHash && codeHash) {
      _diskCacheLastSource = { sourceHash, codeHash };
      if (baseForDisk) {
        try {
          _warmBaseCache = {
            statSig: io.getBundleSourceStatSig(),
            sourceHash,
            ...baseForDisk,
          };
        } catch {}
      }
    }

    if (cachePath && sourceHash && configHash && baseForDisk) {
      if (deferCacheWrite) {
        _pendingDiskCachePersist = {
          cachePath,
          sourceHash,
          baseForDisk,
          newEntry: {
            configHash,
            codeHash,
            bootCfgJson,
            exprSha256: null,
            updatedAt: Date.now(),
          },
          deferredExpr: expr,
        };
      } else {
        const newEntry = {
          configHash,
          codeHash,
          bootCfgJson,
          exprSha256: sha256Text(expr),
          updatedAt: Date.now(),
        };
        _pendingDiskCachePersist = null;
        persistBundleCacheRecordSync(cachePath, sourceHash, baseForDisk, newEntry, existingRawEntries);
      }
    }

    return expr;
  }

  return {
    BUNDLE_CACHE_SCHEMA_VERSION,
    BUNDLE_CACHE_FILENAME,
    BUNDLE_CACHE_MAX_ENTRIES,
    getChannelMemCache,
    setChannelMemCache,
    computeBundleSourceHash: io.computeBundleSourceHash,
    computeBundleConfigHash: io.computeBundleConfigHash,
    getBundleCacheStats,
    resetBundleCacheStats,
    resolveChannelAssetsWithDiskCache,
    flushPendingBundleCache,
    resolveCurrentBundleCodeHash,
    buildInjectExpression,
  };
}

module.exports = {
  BUNDLE_CACHE_SCHEMA_VERSION,
  BUNDLE_CACHE_FILENAME,
  BUNDLE_CACHE_MAX_ENTRIES,
  createInitialBundleCacheStats,
  createBundleCache,
};
