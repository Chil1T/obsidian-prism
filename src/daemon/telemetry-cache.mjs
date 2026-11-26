// Obsidian Prism 遥测服务懒加载、闲置释放与 4MB LRU 磁盘缓存（Tier 1）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GUID_RE,
  USAGE_CACHE_MAX_BYTES,
  USAGE_CACHE_MAX_PER_SCOPE,
  USAGE_CACHE_MAX_SCOPES,
  USAGE_CACHE_MAX_TOTAL_RECORDS,
  resolveUsageCachePath,
  discoverActivePort,
} from './constants.mjs';
import { assertNotSymlinkSync, writeFileAtomicSync } from './fs-atomic.mjs';
import { normalizeUsageScopeKey, sanitizeUsageRecord, hasRealUsageRecord } from './telemetry-scope.mjs';

export const telemetryCacheMethods = {
  _isTelemetryDisabled(cfgOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.();
      return cfg?.telemetryModule === 'off';
    } catch {
      return false;
    }
  },

  _releaseIdleTelemetry(force = false) {
    if (!this._lazyStore && !this._lazyUsage && !this._lazyLsClient && !this._backendSummariesCache) {
      return false;
    }
    if ((this._telemetryInFlight || 0) > 0) {
      return false;
    }
    if (!force) {
      const idleMs = Date.now() - (this._lastTelemetryActivityAt || 0);
      if (idleMs < 120000) return false;
      if (
        this._lazyUsage?.syncing ||
        this._lazyUsage?.ledger?.diskWrites > 0 ||
        this._lazyUsage?.ledger?.diskSummaryPending ||
        this._lazyStore?.background?.active
      ) {
        return false;
      }
    }
    const storeClient = this._lazyStore?.client || null;
    const lsClient = this._lazyLsClient && this._lazyLsClient !== storeClient ? this._lazyLsClient : null;
    const targets = [this._lazyUsage, this._lazyStore, lsClient];
    this._lazyUsage = null;
    this._lazyStore = null;
    this._lazyLsClient = null;
    this._backendSummariesCache = null;
    this._backendSummariesAt = 0;
    this._flushUsageDiskCache();
    this._usageDiskCache = null;
    for (const svc of targets) {
      if (!svc) continue;
      try {
        if (typeof svc.dispose === 'function') svc.dispose();
        else if (typeof svc.close === 'function') svc.close();
      } catch {}
    }
    return true;
  },

  resolveTelemetryDataDir() {
    if (this._telemetryDataDir) return this._telemetryDataDir;
    const dir = path.join(os.homedir(), '.gemini', 'antigravity', 'sidecar_data', 'obsidian-prism', 'telemetry');
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
    this._telemetryDataDir = dir;
    return dir;
  },

  syncClientCdpPort(clientOrStore) {
    if (!clientOrStore) return null;
    const activePort = discoverActivePort(this.overridePort, this.portFile);
    if (activePort) {
      if (typeof clientOrStore.setCdpPort === 'function') {
        clientOrStore.setCdpPort(activePort);
      } else {
        clientOrStore.cdpPort = activePort;
        if (clientOrStore.client) clientOrStore.client.cdpPort = activePort;
      }
    }
    return activePort;
  },

  async _ensureLazyDesktopUsage() {
    if (this._lazyUsage || !this._lazyStore) return this._lazyUsage;
    const telemetryDataDir = this.resolveTelemetryDataDir();
    const usageModUrl = new URL('../../vendor/pulse-dashboard/sidecars/panel/usage.mjs', import.meta.url);
    const { DesktopUsage } = await import(usageModUrl.href);
    this._lazyUsage = new DesktopUsage(this._lazyStore, { dataDir: telemetryDataDir });
    this._lazyStore.onTrajectory = (scope, id, raw, options) =>
      typeof this._lazyUsage.ingestLive === 'function'
        ? this._lazyUsage.ingestLive(scope, id, raw, options)
        : this._lazyUsage.ingest(scope, id, raw);
    this._lazyStore.onBackgroundResult = (scope, id, jobDb, options) =>
      typeof this._lazyUsage.ingestDisk === 'function'
        ? this._lazyUsage.ingestDisk(scope, id, jobDb, options)
        : undefined;
    return this._lazyUsage;
  },

  async ensureMetricsCollector() {
    if (this._customMetricsProvider) return this._customMetricsProvider;
    if (this._lazyStore) {
      return async (input) => {
        this.syncClientCdpPort(this._lazyStore);
        const safeId = input?.conversationId && GUID_RE.test(input.conversationId) ? input.conversationId : null;
        const base = await this._lazyStore.snapshot({
          conversationId: safeId,
          force: Boolean(input?.force),
          quotaRefresh: Boolean(input?.quotaRefresh),
          selectLatest: input?.selectLatest === false ? false : true,
        });
        let usageSnap = null;
        if (input?.includeUsage === true) {
          if (!this._lazyUsage) {
            await this._ensureLazyDesktopUsage().catch(() => null);
          }
          if (this._lazyUsage) {
            if (input?.force) void this._lazyUsage.sync(true);
            usageSnap = await this._lazyUsage
              .snapshot({ groups: Array.isArray(base?.groups) ? base.groups : null })
              .catch(() => null);
          }
        }
        return { ...base, usage: usageSnap };
      };
    }
    const telemetryDataDir = this.resolveTelemetryDataDir();
    const activePort = discoverActivePort(this.overridePort, this.portFile);
    const storeModUrl = new URL('../../vendor/pulse-dashboard/sidecars/panel/store.mjs', import.meta.url);
    const { MetricsStore } = await import(storeModUrl.href);
    this._lazyStore = new MetricsStore({
      dataDir: telemetryDataDir,
      rendererRpc: (m, b) => this._invokeRendererLsRpc(m, b, { scopeKey: 'local' }),
      ...(activePort ? { cdpPort: activePort } : {}),
    });
    return this.ensureMetricsCollector();
  },

  async ensureThoughtService() {
    if (this._lazyThoughtService) return this._lazyThoughtService;
    const modUrl = new URL('../../vendor/thought-translator/translator-service.mjs', import.meta.url);
    const { ThoughtTranslatorService } = await import(modUrl.href);
    this._lazyThoughtService = new ThoughtTranslatorService();
    return this._lazyThoughtService;
  },

  async ensureLsClient() {
    if (this._lazyLsClient) {
      this.syncClientCdpPort(this._lazyLsClient);
      return this._lazyLsClient;
    }
    if (this._lazyStore && this._lazyStore.client) {
      this._lazyLsClient = this._lazyStore.client;
      this._lazyLsClient.setScopeResolver?.(() => this._resolveActiveRpcScope());
      this.syncClientCdpPort(this._lazyLsClient);
      return this._lazyLsClient;
    }
    const activePort = discoverActivePort(this.overridePort, this.portFile);
    const clientModUrl = new URL('../../vendor/pulse-dashboard/sidecars/panel/client.mjs', import.meta.url);
    const { AntigravityClient } = await import(clientModUrl.href);
    this._lazyLsClient = new AntigravityClient({
      rendererRpc: (m, b) => this._invokeRendererLsRpc(m, b),
      scopeResolver: () => this._resolveActiveRpcScope(),
      ...(activePort ? { cdpPort: activePort } : {}),
    });
    return this._lazyLsClient;
  },

  _resolveUsageCachePath() {
    if (typeof this._usageCacheFile === 'string' && this._usageCacheFile.trim()) {
      return path.resolve(this._usageCacheFile.trim());
    }
    return resolveUsageCachePath(this._usageCachePathOpt);
  },

  _loadUsageDiskCache() {
    if (this._usageDiskCache instanceof Map) return this._usageDiskCache;
    const scopesMap = new Map();
    const cacheFile = this._resolveUsageCachePath();
    let healedAny = false;
    const parseScopeEntries = (obj) => {
      const m = new Map();
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return m;
      for (const [k, v] of Object.entries(obj)) {
        if (m.size >= USAGE_CACHE_MAX_PER_SCOPE) break;
        const sc = Number(v?.stepCount || 0);
        const lm = Number(v?.lastModifiedSec || 0);
        const dbMtimeSec = Number(v?.dbMtimeSec || 0);
        const dbSize = Number(v?.dbSize || 0);
        if (
          GUID_RE.test(k) &&
          v &&
          v.record?.days &&
          lm > 0 &&
          (sc > 0 || (dbMtimeSec > 0 && dbSize > 0) || hasRealUsageRecord(v.record))
        ) {
          const clean = sanitizeUsageRecord(k, v.record);
          if (clean !== v.record) healedAny = true;
          m.set(k.toLowerCase(), {
            stepCount: Math.max(0, sc),
            lastModifiedSec: lm,
            ...(dbMtimeSec > 0 ? { dbMtimeSec } : {}),
            ...(dbSize > 0 ? { dbSize } : {}),
            record: clean,
          });
        }
      }
      return m;
    };
    try {
      const dir = path.dirname(cacheFile);
      if (fs.existsSync(cacheFile)) {
        const dirStat = fs.lstatSync(dir);
        const lst = fs.lstatSync(cacheFile);
        if (
          !dirStat.isSymbolicLink() &&
          dirStat.isDirectory() &&
          !lst.isSymbolicLink() &&
          lst.isFile() &&
          lst.size > 0 &&
          lst.size <= USAGE_CACHE_MAX_BYTES
        ) {
          const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            if (raw.version === 2 && raw.scopes && typeof raw.scopes === 'object' && !Array.isArray(raw.scopes)) {
              for (const [rawScope, bucketObj] of Object.entries(raw.scopes)) {
                if (scopesMap.size >= USAGE_CACHE_MAX_SCOPES) break;
                const sc = normalizeUsageScopeKey(rawScope);
                if (!sc) continue;
                const parsedBucket = parseScopeEntries(bucketObj);
                if (parsedBucket.size > 0) scopesMap.set(sc, parsedBucket);
              }
            } else {
              const localBucket = parseScopeEntries(raw);
              if (localBucket.size > 0) scopesMap.set('local', localBucket);
            }
          }
        }
      }
    } catch {}
    this._usageDiskCache = scopesMap;
    if (healedAny) {
      this._usageCacheDirty = true;
      if (!this._usageCacheTimer) {
        this._usageCacheTimer = setTimeout(() => {
          this._usageCacheTimer = null;
          this._flushUsageDiskCache();
        }, 1500);
        this._usageCacheTimer.unref?.();
      }
    }
    return scopesMap;
  },

  _getUsageDiskCacheScope(scopeKey = 'local', create = false) {
    const safeScope = normalizeUsageScopeKey(scopeKey) || 'local';
    const scopesMap = this._loadUsageDiskCache();
    let bucket = scopesMap.get(safeScope);
    if (!bucket && create) {
      bucket = new Map();
      scopesMap.set(safeScope, bucket);
      while (scopesMap.size > USAGE_CACHE_MAX_SCOPES) {
        const oldestKey = scopesMap.keys().next().value;
        if (oldestKey === safeScope) break;
        scopesMap.delete(oldestKey);
      }
    }
    return bucket || new Map();
  },

  _putUsageDiskCache(id, stepCount, lastModifiedSec, record, scopeKey = 'local', diskMeta = null) {
    if (!id || !GUID_RE.test(id) || !record?.days) return;
    const cleanRec = sanitizeUsageRecord(id, record);
    const sc = Math.max(0, Number(stepCount || cleanRec.stepCount || 0));
    const lm = Math.max(0, Number(lastModifiedSec || cleanRec.lastModifiedSec || 0));
    const dbMtimeSec = Math.max(0, Number(diskMeta?.dbMtimeSec || cleanRec.dbMtimeSec || 0));
    const dbSize = Math.max(0, Number(diskMeta?.dbSize || cleanRec.dbSize || 0));
    if (lm <= 0 || (sc <= 0 && !(dbMtimeSec > 0 && dbSize > 0) && !hasRealUsageRecord(cleanRec))) return;
    const safeScope = normalizeUsageScopeKey(scopeKey) || 'local';
    const bucket = this._getUsageDiskCacheScope(safeScope, true);
    const key = id.toLowerCase();
    const existing = bucket.get(key);
    if (existing && hasRealUsageRecord(existing.record) && !hasRealUsageRecord(cleanRec)) {
      const cleanExisting = sanitizeUsageRecord(id, existing.record);
      if (
        cleanExisting !== existing.record ||
        (dbMtimeSec > 0 && existing.dbMtimeSec !== dbMtimeSec) ||
        (dbSize > 0 && existing.dbSize !== dbSize)
      ) {
        bucket.set(key, {
          ...existing,
          ...(dbMtimeSec > 0 ? { dbMtimeSec } : {}),
          ...(dbSize > 0 ? { dbSize } : {}),
          record: cleanExisting,
        });
        this._usageCacheDirty = true;
      }
      return;
    }
    const nextRecord =
      dbMtimeSec > 0 || dbSize > 0
        ? { ...cleanRec, ...(dbMtimeSec > 0 ? { dbMtimeSec } : {}), ...(dbSize > 0 ? { dbSize } : {}) }
        : cleanRec;
    bucket.set(key, {
      stepCount: sc,
      lastModifiedSec: lm,
      ...(dbMtimeSec > 0 ? { dbMtimeSec } : existing?.dbMtimeSec > 0 ? { dbMtimeSec: existing.dbMtimeSec } : {}),
      ...(dbSize > 0 ? { dbSize } : existing?.dbSize > 0 ? { dbSize: existing.dbSize } : {}),
      record: nextRecord,
    });
    this._usageCacheDirty = true;
    if (!this._usageCacheTimer) {
      this._usageCacheTimer = setTimeout(() => {
        this._usageCacheTimer = null;
        this._flushUsageDiskCache();
      }, 1500);
      this._usageCacheTimer.unref?.();
    }
  },

  _flushUsageDiskCache() {
    if (this._usageCacheTimer) {
      clearTimeout(this._usageCacheTimer);
      this._usageCacheTimer = null;
    }
    if (!this._usageCacheDirty || !(this._usageDiskCache instanceof Map)) return;
    this._usageCacheDirty = false;
    try {
      const cacheFile = this._resolveUsageCachePath();
      const dir = path.dirname(cacheFile);
      assertNotSymlinkSync(cacheFile, 'usage cache file');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      assertNotSymlinkSync(dir, 'usage cache directory');

      const normalizedScopes = [];
      let totalCount = 0;
      for (const [rawScope, bucket] of this._usageDiskCache.entries()) {
        const sc = normalizeUsageScopeKey(rawScope);
        if (!sc || !(bucket instanceof Map) || bucket.size === 0) continue;
        let entries = Array.from(bucket.entries());
        entries.sort((a, b) => (b[1].lastModifiedSec || 0) - (a[1].lastModifiedSec || 0));
        if (entries.length > USAGE_CACHE_MAX_PER_SCOPE) {
          entries = entries.slice(0, USAGE_CACHE_MAX_PER_SCOPE);
          this._usageDiskCache.set(sc, new Map(entries));
        }
        const newestSec = entries[0]?.[1]?.lastModifiedSec || 0;
        normalizedScopes.push({ scope: sc, entries, newestSec });
        totalCount += entries.length;
      }
      normalizedScopes.sort((a, b) => b.newestSec - a.newestSec);
      if (normalizedScopes.length > USAGE_CACHE_MAX_SCOPES) {
        normalizedScopes.length = USAGE_CACHE_MAX_SCOPES;
      }

      if (totalCount > USAGE_CACHE_MAX_TOTAL_RECORDS) {
        const allItems = [];
        for (const s of normalizedScopes) {
          for (const [k, v] of s.entries) allItems.push({ scope: s.scope, key: k, val: v });
        }
        allItems.sort((a, b) => (b.val.lastModifiedSec || 0) - (a.val.lastModifiedSec || 0));
        const kept = allItems.slice(0, USAGE_CACHE_MAX_TOTAL_RECORDS);
        const byScope = new Map();
        for (const it of kept) {
          let arr = byScope.get(it.scope);
          if (!arr) {
            arr = [];
            byScope.set(it.scope, arr);
          }
          arr.push([it.key, it.val]);
        }
        normalizedScopes.length = 0;
        for (const [sc, entries] of byScope.entries()) {
          normalizedScopes.push({ scope: sc, entries, newestSec: entries[0]?.[1]?.lastModifiedSec || 0 });
        }
      }

      normalizedScopes.sort((a, b) => (b.newestSec || 0) - (a.newestSec || 0));
      const buildPayload = () => {
        const scopesObj = Object.create(null);
        for (const s of normalizedScopes) {
          if (!s.entries.length) continue;
          const bucketObj = Object.create(null);
          for (const [k, v] of s.entries) bucketObj[k] = v;
          scopesObj[s.scope] = bucketObj;
        }
        return JSON.stringify({ version: 2, scopes: scopesObj });
      };
      let serialized = buildPayload();
      while (Buffer.byteLength(serialized, 'utf8') > USAGE_CACHE_MAX_BYTES) {
        let trimmed = false;
        for (const s of normalizedScopes) {
          if (s.entries.length > 1) {
            s.entries = s.entries.slice(0, Math.max(1, Math.floor(s.entries.length * 0.8)));
            trimmed = true;
          }
        }
        if (!trimmed) {
          for (let i = normalizedScopes.length - 1; i >= 0; i--) {
            if (normalizedScopes[i].entries.length > 0) {
              normalizedScopes[i].entries.pop();
              trimmed = true;
              break;
            }
          }
        }
        if (!trimmed) break;
        serialized = buildPayload();
      }
      if (Buffer.byteLength(serialized, 'utf8') <= USAGE_CACHE_MAX_BYTES) {
        writeFileAtomicSync(cacheFile, serialized, { mode: 0o600 });
      }
    } catch {}
  },
};
