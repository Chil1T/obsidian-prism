// Obsidian Prism 存储健康体检、目录索引信号融合与离线归档调度（Tier 1）
import fs from 'node:fs';
import path from 'node:path';
import {
  buildRendererRpcExpression,
  normalizeRendererSummaries,
} from '../../vendor/pulse-dashboard/sidecars/panel/renderer-rpc-adapter.mjs';
import * as conversationArchive from '../../sidecars/daemon/conversation-archive.mjs';
import { sanitizeSecretText } from '../../sidecars/daemon/redact.mjs';
import {
  GUID_RE,
  USAGE_CACHE_MAX_SCOPES,
  resolvePortFileCandidates,
  discoverActivePort,
} from './constants.mjs';
import { assertNotSymlinkSync, writeFileAtomicSync } from './fs-atomic.mjs';
import { normalizeUsageScopeKey, resolveUsageScopeKey, hasRealUsageRecord } from './telemetry-scope.mjs';

export const storageGuardActionMethods = {
  _getAutoArchiveOnExitSetting() {
    try {
      const cfg = this.cdp?.readConfig?.();
      return cfg?.autoArchiveOnExit === true;
    } catch {
      return false;
    }
  },

  _readStorageGuardState() {
    try {
      const file = this._storageGuardStateFile;
      if (!file || !fs.existsSync(file)) return { snoozeUntilMs: 0, firstPromptShownAt: 0 };
      const st = assertNotSymlinkSync(file, 'storage guard state');
      if (!st || !st.isFile() || st.size > 65536) return { snoozeUntilMs: 0, firstPromptShownAt: 0 };
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        snoozeUntilMs: Math.max(0, Number(parsed?.snoozeUntilMs || 0) || 0),
        firstPromptShownAt: Math.max(0, Number(parsed?.firstPromptShownAt || 0) || 0),
      };
    } catch {
      return { snoozeUntilMs: 0, firstPromptShownAt: 0 };
    }
  },

  _writeStorageGuardState(patch = {}) {
    try {
      const file = this._storageGuardStateFile;
      if (!file) return null;
      const cur = this._readStorageGuardState();
      const next = {
        schema: 1,
        snoozeUntilMs:
          patch.snoozeUntilMs !== undefined ? Math.max(0, Number(patch.snoozeUntilMs) || 0) : cur.snoozeUntilMs,
        firstPromptShownAt:
          patch.firstPromptShownAt !== undefined
            ? Math.max(0, Number(patch.firstPromptShownAt) || 0)
            : cur.firstPromptShownAt,
        updatedAt: new Date().toISOString(),
      };
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileAtomicSync(file, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
      return next;
    } catch {
      return null;
    }
  },

  _rememberDiscoveredSubagentList(items = [], scopeKey = 'local') {
    if (!Array.isArray(items) || items.length === 0) return;
    const safeScope = normalizeUsageScopeKey(scopeKey) || 'local';
    if (!this._discoveredSubagentsByScope) this._discoveredSubagentsByScope = new Map();
    let scopeMap = this._discoveredSubagentsByScope.get(safeScope);
    if (!scopeMap) {
      scopeMap = new Map();
      this._discoveredSubagentsByScope.set(safeScope, scopeMap);
      while (this._discoveredSubagentsByScope.size > USAGE_CACHE_MAX_SCOPES) {
        this._discoveredSubagentsByScope.delete(this._discoveredSubagentsByScope.keys().next().value);
      }
    }
    for (const raw of items) {
      const cid = String(typeof raw === 'string' ? raw : raw?.id || raw?.cascadeId || '').trim().toLowerCase();
      if (!GUID_RE.test(cid)) continue;
      const pid = String(typeof raw === 'object' && raw ? raw.parentId || raw.parentConversationId || '' : '').trim().toLowerCase();
      const prev = scopeMap.get(cid);
      scopeMap.delete(cid);
      scopeMap.set(cid, {
        ...(prev || {}),
        ...(GUID_RE.test(pid) && pid !== cid ? { parentId: pid } : {}),
      });
      while (scopeMap.size > 512) {
        scopeMap.delete(scopeMap.keys().next().value);
      }
    }
  },

  _rememberVisibleMainIds(ids = []) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    if (!this._lastVisibleMainIds) this._lastVisibleMainIds = new Set();
    for (const raw of ids) {
      const id = String(raw || '').trim().toLowerCase();
      if (!GUID_RE.test(id)) continue;
      this._lastVisibleMainIds.delete(id);
      this._lastVisibleMainIds.add(id);
      while (this._lastVisibleMainIds.size > 512) {
        this._lastVisibleMainIds.delete(this._lastVisibleMainIds.values().next().value);
      }
    }
  },

  _collectArchiveExtraSignals(convDir, visibleMainIds = [], extraSubagents = null) {
    const discoveredSubagents = new Map();
    const localSubs = this._getDiscoveredSubagents?.('local');
    if (localSubs instanceof Map) {
      for (const [cid, info] of localSubs.entries()) {
        if (GUID_RE.test(cid)) discoveredSubagents.set(cid.toLowerCase(), info || {});
      }
    }
    if (Array.isArray(extraSubagents)) {
      for (const raw of extraSubagents) {
        const cid = String(typeof raw === 'string' ? raw : raw?.id || raw?.cascadeId || '').trim().toLowerCase();
        if (!GUID_RE.test(cid)) continue;
        const pid = String(typeof raw === 'object' && raw ? raw.parentId || raw.parentConversationId || '' : '').trim().toLowerCase();
        if (!discoveredSubagents.has(cid)) {
          discoveredSubagents.set(cid, GUID_RE.test(pid) && pid !== cid ? { parentId: pid } : {});
        } else if (GUID_RE.test(pid) && pid !== cid && !discoveredSubagents.get(cid)?.parentId) {
          discoveredSubagents.set(cid, { ...discoveredSubagents.get(cid), parentId: pid });
        }
      }
    }
    try {
      const storeSessions = this._lazyStore?.sessions;
      if (storeSessions instanceof Map) {
        for (const [parentId, ent] of storeSessions.entries()) {
          const delegated = Array.isArray(ent?.data?.delegatedConversations)
            ? ent.data.delegatedConversations
            : Array.isArray(ent?.delegatedConversations)
              ? ent.delegatedConversations
              : null;
          if (!delegated) continue;
          for (const rawChild of delegated) {
            const cid = String(typeof rawChild === 'string' ? rawChild : rawChild?.id || rawChild?.cascadeId || '').trim().toLowerCase();
            if (GUID_RE.test(cid) && cid !== String(parentId || '').toLowerCase() && !discoveredSubagents.has(cid)) {
              discoveredSubagents.set(cid, { parentId: String(parentId || '').toLowerCase() });
            }
          }
        }
      }
    } catch {}

    const protectedMainIds = new Set();
    if (this._lastVisibleMainIds instanceof Set) {
      for (const id of this._lastVisibleMainIds) {
        if (GUID_RE.test(id)) protectedMainIds.add(id);
      }
    }
    for (const raw of Array.isArray(visibleMainIds) ? visibleMainIds : []) {
      const id = String(raw || '').trim().toLowerCase();
      if (GUID_RE.test(id)) protectedMainIds.add(id);
    }

    const chapterTitleIds = new Set();
    try {
      const chapDir = path.join(path.dirname(path.resolve(convDir)), 'chapter_titles');
      if (fs.existsSync(chapDir)) {
        const st = fs.lstatSync(chapDir);
        if (!st.isSymbolicLink() && st.isDirectory()) {
          for (const d of fs.readdirSync(chapDir, { withFileTypes: true })) {
            if (d.isSymbolicLink() || !d.isFile()) continue;
            const stem = d.name.replace(/\.[^.]+$/, '').toLowerCase();
            if (GUID_RE.test(stem)) chapterTitleIds.add(stem);
          }
        }
      }
    } catch {}

    return { discoveredSubagents, protectedMainIds, chapterTitleIds };
  },

  _flushCatalogIndexFromMemory(arch, convDir, archiveDir) {
    try {
      const mod = arch || conversationArchive;
      const warmSums = this._lazyStore?.client?.reader?.summaries || {};
      const extraSignals = this._collectArchiveExtraSignals(convDir, []);
      const hasWarm =
        Object.keys(warmSums).length > 0 ||
        extraSignals.discoveredSubagents.size > 0 ||
        extraSignals.protectedMainIds.size > 0;
      if (hasWarm) {
        mod.saveCatalogIndex(archiveDir, warmSums, { mergeExisting: true, extraSignals });
        return true;
      }
    } catch {}
    return false;
  },

  async _checkActiveHostIdleState(_testOverrides = null) {
    if (typeof _testOverrides?.checkIdle === 'function') {
      return _testOverrides.checkIdle();
    }
    const localEntries = [];
    for (const entry of this.sessions.values()) {
      if (!entry || entry.session?.closed) continue;
      if (resolveUsageScopeKey({ entry }) === 'local') localEntries.push(entry);
    }
    if (localEntries.length === 0) {
      return { idle: true, runningCount: 0, domBusy: false, reason: 'no-active-local-window' };
    }
    for (const entry of localEntries) {
      try {
        const expr = buildRendererRpcExpression('CheckHostIdleState', {});
        const evalRes = await entry.session.send(
          'Runtime.evaluate',
          { expression: expr, awaitPromise: true, returnByValue: true },
          4000
        );
        const val = evalRes?.result?.value;
        if (val && val.ok && val.data && val.data.idle === false) {
          return val.data;
        }
      } catch {
        return { idle: false, runningCount: 0, domBusy: false, reason: 'probe-failed' };
      }
    }
    return { idle: true, runningCount: 0, domBusy: false, reason: 'idle' };
  },

  async _snapshotUsageBeforeArchive(candidateItems = [], { maxFetch = 24, timeoutMs = 8000 } = {}) {
    if (!Array.isArray(candidateItems) || candidateItems.length === 0) return { fetched: 0, flushed: false };
    const diskCache = this._getUsageDiskCacheScope('local', false);
    const missing = [];
    for (const it of candidateItems) {
      const id = String(typeof it === 'string' ? it : it?.id || '').trim().toLowerCase();
      if (!GUID_RE.test(id)) continue;
      const hit = diskCache.get(id);
      if (hit?.record && hasRealUsageRecord(hit.record)) continue;
      const dbEntry = Array.isArray(it?.files) ? it.files.find((f) => f && f.suffix === 'db') : null;
      const lmSec = Number(it?.mtimeMs || 0) > 0 ? Math.floor(Number(it.mtimeMs) / 1000) : 0;
      const dbMtimeSec = Number(it?.dbMtimeMs || 0) > 0 ? Math.floor(Number(it.dbMtimeMs) / 1000) : lmSec;
      const dbSize = Math.max(0, Number(dbEntry?.bytes || 0) || 0);
      missing.push({
        id,
        stepCount: Number(it?.stepCount || 0) || 0,
        lastModifiedSec: lmSec,
        ...(dbMtimeSec > 0 ? { dbMtimeSec } : {}),
        ...(dbSize > 0 ? { dbSize } : {}),
        subagent: true,
        ...(it?.parentId ? { parentId: it.parentId } : {}),
      });
      if (missing.length >= maxFetch) break;
    }
    if (missing.length === 0) {
      this._flushUsageDiskCache();
      return { fetched: 0, flushed: true };
    }
    let fetched = 0;
    const deadline = Date.now() + Math.max(1000, timeoutMs);
    for (let i = 0; i < missing.length && Date.now() < deadline; i += 6) {
      const slice = missing.slice(i, i + 6);
      try {
        const res = await this.fetchUsageRollupBatch(slice, { action: 'fetch-batch', scopeKey: 'local' });
        if (res?.ok && Array.isArray(res.records)) {
          fetched += res.records.filter((r) => r && r.mode !== 'error').length;
        }
      } catch {
        break;
      }
    }
    this._flushUsageDiskCache();
    return { fetched, flushed: true };
  },

  _resolveCdpQuitTarget(_testOverrides = null) {
    if (_testOverrides?.cdpPort !== undefined) {
      return {
        cdpPort: Number(_testOverrides.cdpPort) || 0,
        cdpBrowserWsPath: String(_testOverrides.cdpBrowserWsPath || '').trim(),
      };
    }
    if (_testOverrides) {
      return { cdpPort: 0, cdpBrowserWsPath: '' };
    }
    const verifiedPort = Number(this.browserPort) || 0;
    const rawPort = this.overridePort || verifiedPort || discoverActivePort(this.overridePort, this.portFile) || 0;
    const cdpPort = Number.isInteger(Number(rawPort)) && Number(rawPort) > 0 && Number(rawPort) <= 65535 ? Number(rawPort) : 0;
    let cdpBrowserWsPath = '';
    if (cdpPort > 0 && !this.overridePort) {
      const files = this.portFile ? [this.portFile] : resolvePortFileCandidates();
      for (const file of files) {
        try {
          const st = fs.lstatSync(file);
          if (st.isSymbolicLink() || !st.isFile() || st.size > 2048) continue;
          const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
          const filePort = parseInt(String(lines[0] || '').trim(), 10);
          const wsPath = String(lines[1] || '').trim();
          if (filePort === cdpPort && wsPath.startsWith('/devtools/browser/') && !/[\r\n\s]/.test(wsPath)) {
            cdpBrowserWsPath = wsPath;
            break;
          }
        } catch {}
      }
    }
    return { cdpPort, cdpBrowserWsPath };
  },

  async _handleStorageAction(action, _testOverrides = null, rawInput = {}) {
    let acquiredArchiveLock = false;
    if (action === 'archive-and-restart') {
      if (rawInput?.confirm !== true) {
        return { ok: false, action, error: 'confirmation_required' };
      }
      if (
        this._archiveActionInFlight ||
        (!_testOverrides && this._archiveScheduledAt > 0 && Date.now() - this._archiveScheduledAt < 15000)
      ) {
        return { ok: false, action, code: 'ARCHIVE_IN_PROGRESS', error: '已有归档或还原任务正在执行，请勿重复触发。' };
      }
      this._archiveActionInFlight = true;
      acquiredArchiveLock = true;
    }
    try {
      const arch = conversationArchive;
      const now = Number.isFinite(_testOverrides?.now) ? _testOverrides.now : Date.now();
      const forceFresh = Boolean(rawInput?.force);
      const reqLang = typeof rawInput?.lang === 'string' && rawInput.lang.trim() ? rawInput.lang.trim() : 'en';
      const labels = typeof arch.getStorageWorkbenchLabels === 'function' ? arch.getStorageWorkbenchLabels(reqLang) : null;
      const fmtBatches = (list) =>
        list.map((b) => [
          b.batchName,
          `${b.batchName} (${b.movedCount || 0}/${Number(b.movedMb) >= 1024 ? `${(Number(b.movedMb) / 1024).toFixed(2)} GB` : `${Math.round(Number(b.movedMb) || 0)} MB`})`,
        ]);
      if (action === 'storage-health' && !forceFresh && this._storageHealthCache && now - this._storageHealthAt < 300000) {
        return this._storageHealthCache;
      }
      const convDir = _testOverrides?.convDir || arch.getDefaultConversationsDir();
      const archiveDir = _testOverrides?.archiveDir || arch.getDefaultArchiveDir();

      if (action === 'prepare-restore') {
        const batches = arch.listArchiveBatches(archiveDir).slice(0, 12);
        const rawBatch =
          typeof rawInput?.batchName === 'string' && rawInput.batchName.trim()
            ? rawInput.batchName.trim()
            : typeof rawInput?.batch === 'string' && rawInput.batch.trim()
              ? rawInput.batch.trim()
              : 'latest';
        let validatedBatch = 'latest';
        try {
          validatedBatch = arch.validateBatchSelector(rawBatch || 'latest');
        } catch (err) {
          return { ok: false, action, code: 'INVALID_BATCH', error: sanitizeSecretText(err?.message || 'invalid_batch'), batches };
        }
        const matched =
          validatedBatch === 'latest'
            ? batches[0] || null
            : batches.find((b) => b.batchName === validatedBatch) || null;
        if (!matched) {
          return { ok: false, action, code: 'BATCH_NOT_FOUND', error: 'batch_not_found', batches, ...(labels ? { labels } : {}) };
        }
        const scriptPath = path.join(this.rootDir, 'sidecars', 'daemon', 'conversation-archive.mjs');
        const helpers = arch.writeHelperScripts({
          scriptPath,
          archiveDir,
          restoreBatch: matched.batchName,
          writeArchiveScript: false,
          writeRestoreScript: true,
        });
        const chipText = labels?.restoreReadyTpl
          ? labels.restoreReadyTpl.replace('{0}', matched.batchName).replace('{1}', helpers.restoreScriptPath)
          : `${matched.batchName}: ${helpers.restoreScriptPath}`;
        return {
          ok: true,
          action,
          batchName: matched.batchName,
          batches,
          wbB: fmtBatches(batches),
          ...helpers,
          chipText,
          clipPath: helpers.restoreScriptPath,
          ...(labels ? { labels, wbL: [labels.summary, labels.archiveOldMain, labels.restoreBtn, labels.refreshBtn] } : {}),
        };
      }
      let liveSummaries = null;
      let visibleMainIds = [];
      let pageSubagents = [];
      const existingIdx = arch.loadCatalogIndex(archiveDir);
      const parsedUpdatedAt = existingIdx?.updatedAt ? Date.parse(existingIdx.updatedAt) : NaN;
      const idxAgeMs = Number.isFinite(parsedUpdatedAt) ? Math.max(0, now - parsedUpdatedAt) : Infinity;
      const mustRefreshIndex =
        action === 'prepare-archive' ||
        action === 'archive-and-restart' ||
        forceFresh ||
        !existingIdx ||
        idxAgeMs > 1800000 ||
        (action === 'storage-health' && !this._lastStorageIndexRefreshAt);

      if (mustRefreshIndex) {
        const warmReaderSums = this._lazyStore?.client?.reader?.summaries;
        this._telemetryInFlight = (this._telemetryInFlight || 0) + 1;
        this._lastTelemetryActivityAt = Date.now();
        try {
          const client = await this.ensureLsClient();
          const raw = await client.call('GetAllCascadeTrajectories', {
            excludeSubtrajectories: false,
            maxEntries: 4096,
            includeVisibleMainIds: true,
          });
          if (raw?.trajectorySummaries && Object.keys(raw.trajectorySummaries).length > 0) {
            liveSummaries = raw.trajectorySummaries;
          }
          if (Array.isArray(raw?.visibleMainIds) && raw.visibleMainIds.length > 0) {
            visibleMainIds = raw.visibleMainIds;
            this._rememberVisibleMainIds(visibleMainIds);
          }
          if (Array.isArray(raw?.discoveredSubagentIds) && raw.discoveredSubagentIds.length > 0) {
            pageSubagents = raw.discoveredSubagentIds;
            this._rememberDiscoveredSubagentList(pageSubagents, 'local');
          }
        } catch {
        } finally {
          this._telemetryInFlight = Math.max(0, (this._telemetryInFlight || 1) - 1);
          this._lastTelemetryActivityAt = Date.now();
        }
        if (!liveSummaries && warmReaderSums && Object.keys(warmReaderSums).length > 0) {
          liveSummaries = warmReaderSums;
        }
        const extraSignals = this._collectArchiveExtraSignals(convDir, visibleMainIds, pageSubagents);
        const hasSignalData =
          Boolean(liveSummaries && Object.keys(liveSummaries).length > 0) ||
          extraSignals.protectedMainIds.size > 0 ||
          extraSignals.discoveredSubagents.size > 0;
        if (hasSignalData) {
          try {
            arch.saveCatalogIndex(archiveDir, liveSummaries || {}, { mergeExisting: true, extraSignals });
            this._lastStorageIndexRefreshAt = now;
          } catch {}
        }
      } else {
        try {
          if (this.sessions && typeof this.sessions.values === 'function') {
            let localEntry = null;
            for (const entry of this.sessions.values()) {
              if (!entry || entry.session?.closed || typeof entry.session?.send !== 'function') continue;
              if (resolveUsageScopeKey({ entry }) === 'local') {
                localEntry = entry;
                break;
              }
            }
            if (localEntry) {
              const sigExpr = buildRendererRpcExpression('GetAllCascadeTrajectories', {
                includeVisibleMainIds: true,
                signalsOnly: true,
              });
              const evalRes = await localEntry.session
                .send('Runtime.evaluate', { expression: sigExpr, awaitPromise: true, returnByValue: true }, 2500)
                .catch(() => null);
              const val = evalRes?.result?.value;
              if (val && val.ok && val.data) {
                const normSig = normalizeRendererSummaries(val.data);
                if (Array.isArray(normSig?.visibleMainIds) && normSig.visibleMainIds.length > 0) {
                  visibleMainIds = normSig.visibleMainIds;
                  this._rememberVisibleMainIds(visibleMainIds);
                }
                if (Array.isArray(normSig?.discoveredSubagentIds) && normSig.discoveredSubagentIds.length > 0) {
                  pageSubagents = normSig.discoveredSubagentIds;
                  this._rememberDiscoveredSubagentList(pageSubagents, 'local');
                }
              }
            }
          }
        } catch {}
        const extraSignals = this._collectArchiveExtraSignals(convDir, visibleMainIds, pageSubagents);
        const prevEntries = existingIdx?.entries || {};
        let hasUnsavedDelta = false;
        for (const cid of extraSignals.discoveredSubagents.keys()) {
          if (extraSignals.protectedMainIds.has(cid) || extraSignals.chapterTitleIds.has(cid)) continue;
          if (!prevEntries[cid] || prevEntries[cid].subagent !== true) {
            hasUnsavedDelta = true;
            break;
          }
        }
        if (!hasUnsavedDelta) {
          for (const mid of extraSignals.protectedMainIds) {
            if (!prevEntries[mid] || prevEntries[mid].protectedMain !== true) {
              hasUnsavedDelta = true;
              break;
            }
          }
        }
        if (hasUnsavedDelta) {
          try {
            arch.saveCatalogIndex(archiveDir, {}, { mergeExisting: true, extraSignals });
            this._lastStorageIndexRefreshAt = now;
          } catch {}
        }
      }

      let lsMemoryMb = null;
      if (Number.isFinite(_testOverrides?.lsMemoryMb)) {
        lsMemoryMb = Number(_testOverrides.lsMemoryMb);
      } else if (typeof _testOverrides?.getMemoryStats === 'function') {
        const mem = await _testOverrides.getMemoryStats();
        if (mem?.ok && Number.isFinite(mem.totalMb)) lsMemoryMb = mem.totalMb;
      } else if (!_testOverrides?.convDir) {
        const mem = await arch.getLanguageServerMemoryStatsAsync();
        if (mem?.ok && Number.isFinite(mem.totalMb) && mem.totalMb > 0) lsMemoryMb = mem.totalMb;
      }

      const subagentHours = Number.isFinite(Number(rawInput?.subagentMaxAgeHours))
        ? Number(rawInput.subagentMaxAgeHours)
        : arch.AUTO_ARCHIVE_SUBAGENT_MAX_AGE_HOURS;

      const scan =
        typeof arch.scanConversationStorageAsync === 'function'
          ? await arch.scanConversationStorageAsync({
              convDir,
              archiveDir,
              summaries: null,
              subagentMaxAgeHours: subagentHours,
              lsMemoryMb,
              now,
            })
          : arch.scanConversationStorage({
              convDir,
              archiveDir,
              summaries: null,
              subagentMaxAgeHours: subagentHours,
              lsMemoryMb,
              now,
            });

      const batches = arch.listArchiveBatches(archiveDir);
      const recentBatches = batches.slice(0, 12);
      const lastArchiveResult = arch.readLastArchiveResult(archiveDir);
      const guardState = this._readStorageGuardState();
      const base = {
        ok: true,
        action,
        totalMb: scan.totalMb,
        walMb: scan.walMb,
        conversationCount: scan.conversationCount,
        mainCount: scan.mainCount,
        mainMb: scan.mainMb,
        subagentCount: scan.subagentCount,
        subagentMb: scan.subagentMb,
        unknownCount: scan.unknownCount,
        unknownMb: scan.unknownMb,
        archivableSubagentCount: scan.archivableSubagentCount,
        archivableSubagentMb: scan.archivableSubagentMb,
        archivableOldMainCount: scan.archivableOldMainCount,
        archivableOldMainMb: scan.archivableOldMainMb,
        lsMemoryMb: scan.lsMemoryMb,
        warn: scan.warn,
        warnReasons: scan.warnReasons,
        warnThresholds: scan.warnThresholds,
        archiveDir: scan.archiveDir,
        autoArchiveOnExit: this._getAutoArchiveOnExitSetting(),
        batchesCount: batches.length,
        batches: recentBatches,
        latestBatch: batches[0] || null,
        lastArchiveResult,
        snoozeUntilMs: guardState.snoozeUntilMs,
      };

      if (action === 'storage-detail') {
        const topConsumers = Array.isArray(scan.topConsumers) ? scan.topConsumers : [];
        const detailObj = { ...base, subagentMaxAgeHours: subagentHours, topConsumers, batches: recentBatches };
        const detailText =
          typeof arch.formatStorageDetailReport === 'function' ? arch.formatStorageDetailReport(detailObj, reqLang) : '';
        return {
          ...detailObj,
          detailText,
          wbB: fmtBatches(recentBatches),
          ...(labels ? { labels, wbL: [labels.summary, labels.archiveOldMain, labels.restoreBtn, labels.refreshBtn] } : {}),
        };
      }

      if (action === 'prepare-archive') {
        const mode = rawInput?.mode === 'subagents+old-main' || rawInput?.oldMain === true ? 'subagents+old-main' : 'subagents';
        if (mode === 'subagents+old-main' && rawInput?.confirm !== true) {
          return { ok: false, action, error: 'confirmation_required', mode };
        }
        const snapshotTargets =
          mode === 'subagents+old-main'
            ? [...(scan.archivableSubagents || []), ...(scan.archivableOldMain || [])]
            : [...(scan.archivableSubagents || [])];
        if (snapshotTargets.length > 0 && !_testOverrides?.skipUsageSnapshot) {
          await this._snapshotUsageBeforeArchive(snapshotTargets).catch(() => {});
        }
        const scriptPath = path.join(this.rootDir, 'sidecars', 'daemon', 'conversation-archive.mjs');
        const helpers = arch.writeHelperScripts({
          scriptPath,
          archiveDir,
          mode,
          subagentMaxAgeHours: subagentHours,
          writeArchiveScript: true,
          writeRestoreScript: mode !== 'subagents+old-main',
        });
        this._storageHealthCache = null;
        this._storageHealthAt = 0;
        const fmtMbChip = (v) => (Number(v) >= 1024 ? `${(Number(v) / 1024).toFixed(2)} GB` : `${Math.round(Number(v) || 0)} MB`);
        const totalArchCount = (base.archivableSubagentCount || 0) + (base.archivableOldMainCount || 0);
        const totalArchMb = (Number(base.archivableSubagentMb) || 0) + (Number(base.archivableOldMainMb) || 0);
        const extraChip =
          mode === 'subagents+old-main'
            ? labels?.oldMainReadyTpl
              ? labels.oldMainReadyTpl
                  .replace('{0}', String(totalArchCount))
                  .replace('{1}', fmtMbChip(totalArchMb))
                  .replace('{2}', helpers.archiveScriptPath)
              : `${totalArchCount} (${fmtMbChip(totalArchMb)}) · ${helpers.archiveScriptPath}`
            : undefined;
        return {
          ...base,
          ...helpers,
          wbB: fmtBatches(recentBatches),
          ...(extraChip ? { chipText: extraChip, clipPath: helpers.archiveScriptPath } : {}),
          ...(labels ? { labels, wbL: [labels.summary, labels.archiveOldMain, labels.restoreBtn, labels.refreshBtn] } : {}),
        };
      }

      if (action === 'archive-and-restart') {
        if (_testOverrides?.forceBusy !== true) {
          const idleState = await this._checkActiveHostIdleState(_testOverrides);
          if (!idleState?.idle) {
            return {
              ok: false,
              action,
              code: 'HOST_BUSY',
              error: '检测到 AI 正在生成或 Swarm 任务运行中，请等待空闲后再执行归档并重启。',
              idleState,
            };
          }
        }
        const snapRes =
          scan.archivableSubagents?.length > 0 && !_testOverrides?.skipUsageSnapshot
            ? await this._snapshotUsageBeforeArchive(scan.archivableSubagents, { maxFetch: 24, timeoutMs: 6000 }).catch(() => ({ fetched: 0, flushed: false }))
            : { fetched: 0, flushed: true };
        this._flushUsageDiskCache();

        let host = null;
        if (typeof _testOverrides?.detectHost === 'function') {
          host = await _testOverrides.detectHost();
        } else if (typeof this.cdp?.detectRunningAntigravityHost === 'function') {
          try { host = await this.cdp.detectRunningAntigravityHost(); } catch {}
        }

        const cdpTarget = this._resolveCdpQuitTarget(_testOverrides);
        const scriptPath = path.join(this.rootDir, 'sidecars', 'daemon', 'conversation-archive.mjs');
        const spawnRes = arch.spawnDetachedArchiveTask(
          {
            action: 'archive-and-restart',
            convDir,
            archiveDir,
            hostPid: host?.pid || 0,
            cdpPort: cdpTarget.cdpPort,
            cdpBrowserWsPath: cdpTarget.cdpBrowserWsPath,
            exePath: host?.exePath || '',
            gracefulQuit: true,
            relaunch: true,
            mode: 'subagents',
            subagentMaxAgeHours: subagentHours,
            settleMs: 4000,
          },
          {
            scriptPath,
            spawnHook: _testOverrides?.spawnHook,
            disableWmiBreakaway: Boolean(_testOverrides?.disableWmiBreakaway),
          }
        );
        if (spawnRes?.spawned) {
          this._autoArchiveExitRan = true;
          if (!_testOverrides) this._archiveScheduledAt = Date.now();
        }
        this._storageHealthCache = null;
        this._storageHealthAt = 0;
        return {
          ...base,
          ok: Boolean(spawnRes?.spawned),
          ...(spawnRes?.spawned ? {} : { code: spawnRes?.code || 'SPAWN_FAILED', error: spawnRes?.error || 'Failed to launch detached archive task' }),
          scheduled: Boolean(spawnRes?.spawned),
          method: spawnRes?.method || 'custom',
          snapshottedUsageCount: snapRes.fetched || 0,
        };
      }

      this._storageHealthCache = base;
      this._storageHealthAt = now;
      return base;
    } catch (err) {
      return { ok: false, action, error: sanitizeSecretText(err?.message || err) };
    } finally {
      if (acquiredArchiveLock) {
        this._archiveActionInFlight = false;
      }
    }
  },
};
