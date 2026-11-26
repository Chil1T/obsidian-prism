// Obsidian Prism 配置写盘（SHA-256 指纹去重）与多窗口配置广播收敛协调器（Tier 2）
import path from 'node:path';
import { OMNI_BINDING } from '../../vendor/omni-viewer/omni-server.mjs';
import { THOUGHT_BINDING } from './constants.mjs';
import { writeFileAtomicSync } from './fs-atomic.mjs';
import {
  resetAllChannelCircuits,
  recordChannelSuccess,
  recordChannelSkipped,
  recordChannelOff,
  recordChannelFailure,
} from './session-fsm.mjs';
import { RUNTIME_CHANNEL_SPECS } from './runtime-channel-specs.mjs';

async function syncPersistentNewDocScript(daemon, entry, enabled, source, scriptProp, sigProp, targetSig) {
  if (!enabled || !source) {
    if (entry[scriptProp]) {
      await entry.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry[scriptProp] }).catch(() => {});
      entry[scriptProp] = null;
    }
    if (sigProp) entry[sigProp] = '';
    return;
  }
  if (!entry.session.closed && (!entry[scriptProp] || (sigProp && entry[sigProp] !== targetSig))) {
    const id = await daemon._replaceEntryNewDocScript(entry, scriptProp, source);
    if (id && sigProp) entry[sigProp] = targetSig;
  }
}

export const sessionBroadcastMethods = {
  updateConfigBatch(entriesObj) {
    if (!entriesObj || typeof entriesObj !== 'object' || Array.isArray(entriesObj)) return false;
    const validPatch = {};
    let count = 0;
    for (const [k, v] of Object.entries(entriesObj)) {
      if (this.cdp.validateConfigEntry(k, v)) {
        validPatch[k] = v;
        count += 1;
      }
    }
    if (count === 0) return false;
    const cfgPath = path.join(this.rootDir, 'config.json');
    const current = this.cdp.readConfig();
    const expandedPatch =
      typeof this.cdp.reconcileConfigAliases === 'function' ? this.cdp.reconcileConfigAliases(validPatch) : validPatch;
    const next = { ...current, ...expandedPatch };
    // 记录归一化配置内容 SHA-256 指纹替代 650ms 墙钟窗口，消除慢盘/杀软回声与高速外部写漏检
    this._configFingerprintTracker?.recordSelfWrite(next);
    writeFileAtomicSync(cfgPath, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    this.cdp?.invalidateConfigCache?.();
    if (Object.prototype.hasOwnProperty.call(expandedPatch, 'autoArchiveOnExit')) {
      this._storageHealthCache = null;
      this._storageHealthAt = 0;
    }
    this._configSeq += 1;
    // 配置变更立即复位全部存活窗口的通道熔断器
    if (this.sessions && typeof this.sessions.values === 'function') {
      for (const entry of this.sessions.values()) {
        resetAllChannelCircuits(entry);
      }
    }
    return true;
  },

  updateConfigSetting(key, value) {
    return this.updateConfigBatch({ [key]: value });
  },

  async broadcastConfigRefresh() {
    this._broadcastPending = true;
    if (this._broadcastRunning) {
      return new Promise((resolve) => {
        this._broadcastWaiters.push(resolve);
      });
    }

    this._broadcastRunning = true;
    try {
      while (this._broadcastPending) {
        this._broadcastPending = false;
        const snapSeq = this._configSeq;
        const activeItems = [...this.sessions.values()].filter((item) => item && !item.session.closed);
        const perEntryAck = new Map();
        for (const item of activeItems) {
          resetAllChannelCircuits(item);
          const entryAck = Number.isSafeInteger(item.pendingAckEpoch) && item.pendingAckEpoch > 0 ? item.pendingAckEpoch : 0;
          item.pendingAckEpoch = 0;
          perEntryAck.set(item, entryAck);
        }

        const restoreAllAcks = () => {
          for (const [item, ack] of perEntryAck.entries()) {
            if (ack > 0) item.pendingAckEpoch = Math.max(Number(item.pendingAckEpoch || 0), ack);
          }
        };

        const preCfg = typeof this.cdp.readConfig === 'function' ? this.cdp.readConfig() : {};
        if (this._isOmniEnabled(preCfg)) {
          await this.ensureOmniServer().catch(() => null);
          if (this._configSeq !== snapSeq) { restoreAllAcks(); this._broadcastPending = true; continue; }
        } else if (this.omniServer) {
          const oldSrv = this.omniServer;
          this.omniServer = null;
          this.omniExpr = '';
          await oldSrv.stop?.().catch?.(() => {});
          if (this._configSeq !== snapSeq) { restoreAllAcks(); this._broadcastPending = true; continue; }
        }
        if (preCfg?.sidebarStudio === 'on') {
          await this.ensureSidebarService().catch(() => null);
          if (this._configSeq !== snapSeq) { restoreAllAcks(); this._broadcastPending = true; continue; }
        }

        this.rebuildBundle({ deferDiskCacheWrite: true });
        const injectSnap = this.injectExpr;
        const omniSnap = this.omniExpr;
        const sidebarSnap = this.sidebarExpr;
        const hostI18nSnap = this.hostI18nExpr;
        let thoughtSnap = this.thoughtExpr;
        let inlineDiffSnap = this.inlineDiffExpr;
        let wallpaperSnap = this.wallpaperExpr;
        let periodicPickerSnap = this.periodicPickerExpr;
        let mascotSnap = this.mascotExpr;
        let suggesterSnap = this.suggesterExpr;
        let homeStudioSnap = this.homeStudioExpr;

        const currentCfg = typeof this.cdp.readConfig === 'function' ? this.cdp.readConfig() : {};
        this._configFingerprintTracker?.recordApplied(currentCfg);
        if (currentCfg?.telemetryModule === 'off') this._releaseIdleTelemetry(true);

        const { channel: syncedUpdateChannel, changed: updateChannelChanged } = this._syncUpdateServiceChannel(currentCfg);
        if (updateChannelChanged && this.running && this._getAutoUpdateSetting() === 'on') {
          void this.runUpdateCheck({ force: true, manual: false, allowAutoApply: false, channel: syncedUpdateChannel }).catch(() => {});
        }

        const omniEnabled = this._isOmniEnabled(currentCfg);
        const sidebarEnabled = currentCfg?.sidebarStudio === 'on';
        const hostI18nEnabled = this._isHostI18nEnabled(currentCfg);
        const hostI18nSig = hostI18nEnabled ? this._getHostI18nCfgSig(currentCfg) : '';
        const thoughtEnabled = this._isThoughtEnabled(currentCfg);
        if (thoughtEnabled && !thoughtSnap && typeof this.cdp.buildThoughtExpression === 'function') {
          thoughtSnap = this._buildThoughtExprForConfig(currentCfg);
        }
        const thoughtSig = thoughtEnabled ? this._getThoughtCfgSig(currentCfg, thoughtSnap) : '';
        if (!inlineDiffSnap && typeof this.cdp.buildInlineDiffInjectExpression === 'function') {
          inlineDiffSnap = this._buildInlineDiffExprForConfig(currentCfg);
        }
        const inlineDiffHash = inlineDiffSnap ? this._getInlineDiffExprHash(inlineDiffSnap) : '';
        if (!wallpaperSnap && typeof this.cdp.buildWallpaperExpression === 'function') {
          wallpaperSnap = this._buildWallpaperExprForConfig(currentCfg);
        }
        const wallpaperHash = wallpaperSnap ? this._getWallpaperExprHash(wallpaperSnap) : '';
        const periodicPickerEnabled = this._hasPeriodicPickerFile() && this._isPeriodicPickerEnabled(currentCfg);
        if (periodicPickerEnabled && !periodicPickerSnap && typeof this.cdp.buildPeriodicPickerExpression === 'function') {
          periodicPickerSnap = this._buildPeriodicPickerExprForConfig(currentCfg);
        }
        const periodicPickerHash = periodicPickerSnap ? this._getPeriodicPickerExprHash(periodicPickerSnap) : '';
        const periodicPickerSig = periodicPickerEnabled ? `${this._getPeriodicPickerCfgSig(currentCfg)}:${periodicPickerHash}` : '';
        const mascotEnabled = this._hasMascotFile() && this._isMascotEnabled(currentCfg);
        if (mascotEnabled && !mascotSnap && typeof this.cdp.buildMascotChannelExpression === 'function') {
          mascotSnap = this._buildMascotExprForConfig(currentCfg);
        }
        const mascotHash = mascotSnap ? this._getMascotExprHash(mascotSnap) : '';
        const mascotSig = mascotEnabled ? `${this._getMascotCfgSig(currentCfg)}:${mascotHash}` : '';
        if (!suggesterSnap && typeof this.cdp.buildSuggesterExpression === 'function') {
          suggesterSnap = this._buildSuggesterExprForConfig(currentCfg);
        }
        const suggesterHash = suggesterSnap ? this._getSuggesterExprHash(suggesterSnap) : '';
        const homeStudioEnabled = this._hasHomeStudioFile() && this._isHomeStudioEnabled(currentCfg);
        if (homeStudioEnabled && !homeStudioSnap && typeof this.cdp.buildHomeStudioChannelExpression === 'function') {
          homeStudioSnap = this._buildHomeStudioExprForConfig(currentCfg);
        }
        const homeStudioHash = homeStudioSnap ? this._getHomeStudioExprHash(homeStudioSnap) : '';
        const homeStudioSig = homeStudioEnabled ? `${this._getHomeStudioCfgSig(currentCfg)}:${homeStudioHash}` : '';
        const runtimeSnaps = RUNTIME_CHANNEL_SPECS.map((spec) => {
          const enabled = this._hasRuntimeChannelFile(spec) && this._isRuntimeChannelEnabled(spec, currentCfg);
          let snap = this[spec.exprField] || '';
          if (enabled && !snap && typeof this.cdp[spec.cdpBuild] === 'function') {
            snap = this._buildRuntimeChannelExpr(spec, currentCfg);
          }
          const hash = snap ? this._getRuntimeChannelExprHash(spec, snap) : '';
          const sig = enabled ? `${this._getRuntimeChannelCfgSig(spec, currentCfg)}:${hash}` : '';
          return { spec, enabled, snap, hash, sig };
        });

        const canFastRefresh = typeof this.cdp.buildConfigRefreshExpression === 'function';
        const baseRefreshExpr = canFastRefresh ? this.cdp.buildConfigRefreshExpression() : null;
        await this._syncSwarmSessionsForConfig(currentCfg).catch(() => {});
        if (activeItems.length === 0) continue;

        await Promise.allSettled(
          activeItems.map((entry) =>
            this._runEntryExclusive(entry, async () => {
              if (!entry || entry.session.closed) return;
              const entryAck = perEntryAck.get(entry) || 0;
              // 若上轮更新曾因新序号中断，本轮完整重算收敛，绝不遗漏未更新通道
              const forceFullConvergence = Boolean(entry._configConvergenceDirty);
              const abortIfStale = () => {
                if (this._configSeq !== snapSeq) {
                  if (entryAck > 0) entry.pendingAckEpoch = Math.max(Number(entry.pendingAckEpoch || 0), entryAck);
                  entry._configConvergenceDirty = true;
                  this._broadcastPending = true;
                  return true;
                }
                return entry.session.closed;
              };
              if (abortIfStale()) return;

              const hostI18nOffNow = currentCfg?.hostLocalization === 'off';
              let isoPauseRes = null;
              if (hostI18nOffNow && !entry.session.closed) isoPauseRes = await this._syncIsolatedHostI18n(entry, true);
              if (abortIfStale()) return;

              const refreshExpr =
                canFastRefresh && entryAck > 0
                  ? this.cdp.buildConfigRefreshExpression(null, { __ackEpoch: entryAck })
                  : baseRefreshExpr;
              let refreshedFast = false;
              let skippedStale = false;
              if (refreshExpr) {
                if (abortIfStale()) return;
                const fastRes = await entry.session.evaluate(refreshExpr).catch(() => null);
                if (fastRes && fastRes.refreshed) {
                  refreshedFast = true;
                  skippedStale = Boolean(fastRes.skippedStale);
                }
              }
              if (abortIfStale()) return;
              if (!refreshedFast && !entry.session.closed) {
                await entry.session.evaluate(injectSnap).catch(() => {});
              }
              if (abortIfStale()) return;

              // Channel 2: Omni
              const hadOmni = Boolean(entry.omniScriptId || entry.lastOmniExpr);
              const omniChanged = Boolean(omniEnabled && omniSnap && (forceFullConvergence || entry.lastOmniExpr !== omniSnap || !entry.omniScriptId));
              if (omniEnabled && omniSnap) {
                if (!skippedStale && !entry.session.closed && (!refreshedFast || omniChanged)) {
                  await entry.session.send('Runtime.addBinding', { name: OMNI_BINDING }).catch(() => {});
                  const ev = await entry.session.evaluate(omniSnap).catch(() => null);
                  if (ev && ev.ok !== false) recordChannelSuccess(entry, 'omni', { scriptId: entry.omniScriptId });
                  else recordChannelFailure(entry, 'omni');
                }
              } else if (hadOmni && !skippedStale && !entry.session.closed) {
                await entry.session.evaluate(this._buildOmniCleanupExpression()).catch(() => {});
                recordChannelOff(entry, 'omni');
              }
              if (abortIfStale()) return;

              // Channel 3: Sidebar Studio
              const hadSidebar = Boolean(entry.sidebarScriptId || entry.sidebarMounted || entry.sidebarBindingAdded);
              if (sidebarEnabled) {
                if (!skippedStale && !entry.session.closed) {
                  await this._ensureSidebarBinding(entry);
                  if (sidebarSnap && !entry.session.closed) {
                    await entry.session.evaluate(sidebarSnap).catch(() => {});
                    entry.sidebarMounted = true;
                    recordChannelSuccess(entry, 'sidebar', { scriptId: entry.sidebarScriptId });
                  }
                }
              } else if (hadSidebar && !skippedStale && !entry.session.closed) {
                await this._removeSidebarBinding(entry);
                await entry.session.evaluate(this._buildSidebarCleanupExpression(true)).catch(() => {});
                entry.sidebarMounted = false;
                recordChannelOff(entry, 'sidebar');
              } else {
                await this._removeSidebarBinding(entry);
                entry.sidebarMounted = false;
                recordChannelOff(entry, 'sidebar');
              }
              if (abortIfStale()) return;

              // Channel 4: Host I18n
              const hadHostI18n = Boolean(entry.hostI18nScriptId || entry.hostI18nMounted);
              const hostI18nSkippedSameSig = Boolean(entry.hostI18nSkippedByLiveCfg && entry.lastHostI18nSig === hostI18nSig);
              const hostI18nChanged = Boolean(
                hostI18nEnabled && hostI18nSnap && !hostI18nSkippedSameSig &&
                (forceFullConvergence || entry.lastHostI18nSig !== hostI18nSig || !entry.hostI18nScriptId || !entry.hostI18nMounted)
              );
              if (hostI18nEnabled && hostI18nSnap) {
                let evaluatedHostI18nFresh = false;
                if (!skippedStale && !entry.session.closed && (!refreshedFast || hostI18nChanged)) {
                  const evalRes = await entry.session.evaluate(hostI18nSnap).catch(() => null);
                  if (evalRes?.skippedByLiveCfg) {
                    entry.hostI18nMounted = false;
                    entry.hostI18nSkippedByLiveCfg = true;
                    entry.lastHostI18nSig = hostI18nSig;
                    recordChannelSkipped(entry, 'hostI18n', { codeHash: hostI18nSig });
                  } else if (evalRes && evalRes.ok) {
                    entry.hostI18nMounted = true;
                    entry.hostI18nSkippedByLiveCfg = false;
                    entry.lastHostI18nSig = hostI18nSig;
                    evaluatedHostI18nFresh = !evalRes.reused;
                    recordChannelSuccess(entry, 'hostI18n', { codeHash: hostI18nSig, scriptId: entry.hostI18nScriptId });
                  } else {
                    recordChannelFailure(entry, 'hostI18n');
                  }
                }
                if (hostI18nOffNow && isoPauseRes && isoPauseRes.newlyPaused && !evaluatedHostI18nFresh && !skippedStale && !entry.session.closed) {
                  await this._forceMainWorldHostI18nOffRescan(entry);
                }
              } else if (hadHostI18n && !skippedStale && !entry.session.closed) {
                await entry.session.evaluate(this._getHostI18nCleanupExpression()).catch(() => {});
                entry.hostI18nMounted = false;
                entry.hostI18nSkippedByLiveCfg = false;
                entry.lastHostI18nSig = '';
                recordChannelOff(entry, 'hostI18n');
              }
              if (!hostI18nOffNow && entry.isolatedHostI18nPaused && !skippedStale && !entry.session.closed) {
                await this._syncIsolatedHostI18n(entry, false);
              }
              if (abortIfStale()) return;

              // Channel 5: Thought
              const hadThought = Boolean(entry.thoughtScriptId || entry.thoughtMounted);
              const thoughtChanged = Boolean(
                thoughtEnabled && thoughtSnap &&
                (forceFullConvergence || entry.lastThoughtSig !== thoughtSig || !entry.thoughtScriptId || !entry.thoughtMounted)
              );
              if (thoughtEnabled && thoughtSnap) {
                if (!skippedStale && !entry.session.closed && (!refreshedFast || thoughtChanged)) {
                  await entry.session.send('Runtime.addBinding', { name: THOUGHT_BINDING }).catch(() => {});
                  const evalRes = await entry.session.evaluate(thoughtSnap).catch(() => null);
                  if (evalRes && evalRes.ok) {
                    entry.thoughtMounted = true;
                    entry.lastThoughtSig = thoughtSig;
                    recordChannelSuccess(entry, 'thought', { codeHash: thoughtSig, scriptId: entry.thoughtScriptId });
                  } else {
                    recordChannelFailure(entry, 'thought');
                  }
                }
              } else if (hadThought && !skippedStale && !entry.session.closed) {
                await entry.session.evaluate(this._getThoughtCleanupExpression()).catch(() => {});
                entry.thoughtMounted = false;
                entry.lastThoughtSig = '';
                recordChannelOff(entry, 'thought');
              }
              if (abortIfStale()) return;

              // Channel 6: Inline Diff
              const hadInlineDiff = Boolean(entry.inlineDiffScriptId || entry.inlineDiffMounted);
              const inlineDiffChanged = Boolean(
                inlineDiffSnap && !entry.inlineDiffSkipped &&
                (forceFullConvergence || entry.lastInlineDiffHash !== inlineDiffHash || !entry.inlineDiffScriptId || !entry.inlineDiffMounted)
              );
              if (inlineDiffSnap) {
                if (!skippedStale && !entry.session.closed && !entry.inlineDiffSkipped && (!refreshedFast || inlineDiffChanged)) {
                  await this._ensureInlineDiffBinding(entry);
                  const evalRes = await entry.session.evaluate(inlineDiffSnap).catch(() => null);
                  await this._recordInlineDiffEvalOutcome(entry, evalRes, inlineDiffHash);
                }
              } else if (hadInlineDiff && !skippedStale && !entry.session.closed) {
                await entry.session.evaluate(this._getInlineDiffCleanupExpression()).catch(() => {});
                entry.inlineDiffMounted = false;
                entry.inlineDiffSkipped = false;
                entry.lastInlineDiffHash = '';
                recordChannelOff(entry, 'inlineDiff');
              }
              if (abortIfStale()) return;

              // Channel 7: Wallpaper
              const hadWallpaper = Boolean(entry.wallpaperScriptId || entry.wallpaperMounted);
              const wallpaperChanged = Boolean(
                wallpaperSnap && !entry.wallpaperSkipped &&
                (forceFullConvergence || entry.lastWallpaperHash !== wallpaperHash || !entry.wallpaperScriptId || !entry.wallpaperMounted)
              );
              if (wallpaperSnap) {
                if (!skippedStale && !entry.session.closed && !entry.wallpaperSkipped && (!refreshedFast || wallpaperChanged)) {
                  await this._ensureWallpaperBinding(entry);
                  const evalRes = await entry.session.evaluate(wallpaperSnap).catch(() => null);
                  await this._recordWallpaperEvalOutcome(entry, evalRes, wallpaperHash);
                }
              } else if (hadWallpaper && !skippedStale && !entry.session.closed) {
                await this._removeWallpaperBinding(entry);
                await entry.session.evaluate(this._getWallpaperCleanupExpression()).catch(() => {});
                entry.wallpaperMounted = false;
                entry.wallpaperSkipped = false;
                entry.lastWallpaperHash = '';
                recordChannelOff(entry, 'wallpaper');
              }
              if (abortIfStale()) return;

              // Channel 8: Periodic Picker
              const hadPeriodicPicker = Boolean(entry.periodicPickerScriptId || entry.periodicPickerMounted);
              const periodicPickerChanged = Boolean(
                periodicPickerEnabled && periodicPickerSnap &&
                (forceFullConvergence || entry.lastPeriodicPickerSig !== periodicPickerSig || !entry.periodicPickerScriptId || !entry.periodicPickerMounted)
              );
              if (periodicPickerEnabled && periodicPickerSnap) {
                if (!skippedStale && !entry.session.closed && (!refreshedFast || periodicPickerChanged)) {
                  const evalRes = await entry.session.evaluate(periodicPickerSnap).catch(() => null);
                  if (evalRes && evalRes.ok) {
                    entry.periodicPickerMounted = true;
                    entry.lastPeriodicPickerSig = periodicPickerSig;
                    recordChannelSuccess(entry, 'periodicPicker', { codeHash: periodicPickerHash, scriptId: entry.periodicPickerScriptId });
                  } else {
                    recordChannelFailure(entry, 'periodicPicker');
                  }
                }
              } else if ((hadPeriodicPicker || !this._isPeriodicPickerEnabled(currentCfg)) && !skippedStale && !entry.session.closed) {
                if (hadPeriodicPicker) await entry.session.evaluate(this._getPeriodicPickerCleanupExpression()).catch(() => {});
                entry.periodicPickerMounted = false;
                entry.lastPeriodicPickerSig = '';
                recordChannelOff(entry, 'periodicPicker');
              }
              if (abortIfStale()) return;

              // Channel 10: Mascot
              const hadMascot = Boolean(entry.mascotScriptId || entry.mascotMounted);
              const mascotChanged = Boolean(
                mascotEnabled && mascotSnap &&
                (forceFullConvergence || entry.lastMascotSig !== mascotSig || !entry.mascotScriptId || !entry.mascotMounted)
              );
              if (mascotEnabled && mascotSnap) {
                if (!skippedStale && !entry.session.closed && (!refreshedFast || mascotChanged)) {
                  const evalRes = await entry.session.evaluate(mascotSnap).catch(() => null);
                  if (evalRes && evalRes.ok) {
                    entry.mascotMounted = true;
                    entry.lastMascotSig = mascotSig;
                    recordChannelSuccess(entry, 'mascot', { codeHash: mascotHash, scriptId: entry.mascotScriptId });
                  } else {
                    recordChannelFailure(entry, 'mascot');
                  }
                }
              } else if ((hadMascot || !this._isMascotEnabled(currentCfg)) && !skippedStale && !entry.session.closed) {
                if (hadMascot) await entry.session.evaluate(this._getMascotCleanupExpression()).catch(() => {});
                entry.mascotMounted = false;
                entry.lastMascotSig = '';
                recordChannelOff(entry, 'mascot');
              }
              if (abortIfStale()) return;

              // Channel 11: Suggester
              const hadSuggester = Boolean(entry.suggesterScriptId || entry.suggesterMounted);
              const suggesterChanged = Boolean(
                suggesterSnap && !entry.suggesterSkipped &&
                (forceFullConvergence || entry.lastSuggesterHash !== suggesterHash || !entry.suggesterScriptId || !entry.suggesterMounted)
              );
              if (suggesterSnap) {
                if (!skippedStale && !entry.session.closed && !entry.suggesterSkipped && (!refreshedFast || suggesterChanged)) {
                  await this._ensureSuggesterBinding(entry);
                  const evalRes = await entry.session.evaluate(suggesterSnap).catch(() => null);
                  await this._recordSuggesterEvalOutcome(entry, evalRes, suggesterHash);
                }
              } else if (hadSuggester && !skippedStale && !entry.session.closed) {
                await this._removeSuggesterBinding(entry);
                await entry.session.evaluate(this._getSuggesterCleanupExpression()).catch(() => {});
                entry.suggesterMounted = false;
                entry.suggesterSkipped = false;
                entry.lastSuggesterHash = '';
                recordChannelOff(entry, 'suggester');
              }
              if (abortIfStale()) return;

              // Channel 12: Home Studio
              const hadHomeStudio = Boolean(entry.homeStudioScriptId || entry.homeStudioMounted);
              const homeStudioChanged = Boolean(
                homeStudioEnabled && homeStudioSnap &&
                (forceFullConvergence || entry.lastHomeStudioSig !== homeStudioSig || !entry.homeStudioScriptId || !entry.homeStudioMounted)
              );
              if (homeStudioEnabled && homeStudioSnap) {
                if (!skippedStale && !entry.session.closed && (!refreshedFast || homeStudioChanged)) {
                  const evalRes = await entry.session.evaluate(homeStudioSnap).catch(() => null);
                  if (evalRes && evalRes.ok) {
                    entry.homeStudioMounted = !evalRes.skippedByLiveCfg;
                    entry.lastHomeStudioSig = homeStudioSig;
                    if (evalRes.skippedByLiveCfg) recordChannelSkipped(entry, 'homeStudio', { codeHash: homeStudioHash });
                    else recordChannelSuccess(entry, 'homeStudio', { codeHash: homeStudioHash, scriptId: entry.homeStudioScriptId });
                  } else {
                    recordChannelFailure(entry, 'homeStudio');
                  }
                }
              } else if ((hadHomeStudio || !this._isHomeStudioEnabled(currentCfg)) && !skippedStale && !entry.session.closed) {
                if (hadHomeStudio) await entry.session.evaluate(this._getHomeStudioCleanupExpression()).catch(() => {});
                entry.homeStudioMounted = false;
                entry.lastHomeStudioSig = '';
                recordChannelOff(entry, 'homeStudio');
              }

              // Channels 13~16: Telemetry / Effort Slider / Workbench Enhancer / Context Menu
              for (const rs of runtimeSnaps) {
                if (abortIfStale()) return;
                const { spec, enabled, snap, hash, sig } = rs;
                const hadBefore = Boolean(entry[spec.scriptField] || entry[spec.mountedField]);
                const changed = Boolean(
                  enabled && snap &&
                  (forceFullConvergence || entry[spec.sigField] !== sig || !entry[spec.scriptField] || !entry[spec.mountedField])
                );
                if (enabled && snap) {
                  if (!skippedStale && !entry.session.closed && (!refreshedFast || changed)) {
                    const evalRes = await entry.session.evaluate(snap).catch(() => null);
                    if (evalRes && evalRes.ok) {
                      entry[spec.mountedField] = !evalRes.skippedByLiveCfg;
                      entry[spec.sigField] = sig;
                      if (evalRes.skippedByLiveCfg) recordChannelSkipped(entry, spec.id, { codeHash: hash });
                      else recordChannelSuccess(entry, spec.id, { codeHash: hash, scriptId: entry[spec.scriptField] });
                    } else {
                      recordChannelFailure(entry, spec.id);
                    }
                  }
                } else if ((hadBefore || !this._isRuntimeChannelEnabled(spec, currentCfg)) && !skippedStale && !entry.session.closed) {
                  if (hadBefore) await entry.session.evaluate(this._getRuntimeChannelCleanupExpression(spec)).catch(() => {});
                  entry[spec.mountedField] = false;
                  entry[spec.sigField] = '';
                  recordChannelOff(entry, spec.id);
                }
              }

              // Coalesce persistent NewDocument script replacement; if interrupted, mark dirty for guaranteed next-pass convergence
              if (this._broadcastPending || this._configSeq !== snapSeq || entry.session.closed) {
                entry._configConvergenceDirty = true;
                this._broadcastPending = true;
                return;
              }

              await this._replaceEntryNewDocScript(entry, 'scriptId', injectSnap);
              await syncPersistentNewDocScript(this, entry, Boolean(omniEnabled && omniSnap), omniSnap, 'omniScriptId', 'lastOmniExpr', omniSnap);
              await this._replaceEntryNewDocScript(entry, 'sidebarScriptId', sidebarEnabled && sidebarSnap ? sidebarSnap : '');
              await syncPersistentNewDocScript(this, entry, Boolean(hostI18nEnabled && hostI18nSnap), hostI18nSnap, 'hostI18nScriptId', 'lastHostI18nScriptSig', hostI18nSig);
              await syncPersistentNewDocScript(this, entry, Boolean(thoughtEnabled && thoughtSnap), thoughtSnap, 'thoughtScriptId', 'lastThoughtScriptSig', thoughtSig);
              await syncPersistentNewDocScript(this, entry, Boolean(inlineDiffSnap), inlineDiffSnap, 'inlineDiffScriptId', 'lastInlineDiffScriptHash', inlineDiffHash);
              await syncPersistentNewDocScript(this, entry, Boolean(wallpaperSnap), wallpaperSnap, 'wallpaperScriptId', 'lastWallpaperScriptHash', wallpaperHash);
              await syncPersistentNewDocScript(this, entry, Boolean(periodicPickerEnabled && periodicPickerSnap), periodicPickerSnap, 'periodicPickerScriptId', 'lastPeriodicPickerScriptSig', periodicPickerSig);
              await syncPersistentNewDocScript(this, entry, Boolean(mascotEnabled && mascotSnap), mascotSnap, 'mascotScriptId', 'lastMascotScriptSig', mascotSig);
              await syncPersistentNewDocScript(this, entry, Boolean(suggesterSnap), suggesterSnap, 'suggesterScriptId', 'lastSuggesterScriptHash', suggesterHash);
              await syncPersistentNewDocScript(this, entry, Boolean(homeStudioEnabled && homeStudioSnap), homeStudioSnap, 'homeStudioScriptId', 'lastHomeStudioScriptSig', homeStudioSig);
              for (const rs of runtimeSnaps) {
                await syncPersistentNewDocScript(this, entry, Boolean(rs.enabled && rs.snap), rs.snap, rs.spec.scriptField, rs.spec.scriptSigField, rs.sig);
              }

              entry.appliedConfigSeq = snapSeq;
              entry._configConvergenceDirty = false;
            })
          )
        );
      }
    } finally {
      this._broadcastRunning = false;
      const waiters = this._broadcastWaiters.splice(0);
      for (const resolve of waiters) {
        try { resolve(); } catch {}
      }
    }
  },
};
