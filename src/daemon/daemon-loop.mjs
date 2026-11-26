// Obsidian Prism 守护进程主循环、fs.watch SHA-256 指纹热重载与启停生命周期（Tier 3）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as conversationArchive from '../../sidecars/daemon/conversation-archive.mjs';
import { DEFAULT_ROOT_DIR, discoverActivePort } from './constants.mjs';
import {
  HOST_FSM_STATES,
  ENTRY_FSM_STATES,
  transitionEntryState,
  resetAllChannelCircuits,
  computeConfigFingerprint,
} from './session-fsm.mjs';

const require = createRequire(import.meta.url);
const runInBgRecovery = require('../platform/run-in-bg-recovery.cjs');

export const daemonLoopMethods = {
  _resolveWatchedConfigPath() {
    return typeof this.cdp?.CONFIG_PATH === 'string' && this.cdp.CONFIG_PATH
      ? path.resolve(this.cdp.CONFIG_PATH)
      : path.join(this.rootDir, 'config.json');
  },

  _syncConfigFingerprintFromDisk(configPath = null) {
    const targetPath = configPath || this._resolveWatchedConfigPath();
    try {
      if (fs.existsSync(targetPath)) {
        const raw = fs.readFileSync(targetPath, 'utf8');
        if (raw && raw.trim()) {
          return this._configFingerprintTracker?.recordApplied(raw) || '';
        }
      }
    } catch {}
    try {
      const cfg = this.cdp?.readConfig?.();
      if (cfg && typeof cfg === 'object') {
        return this._configFingerprintTracker?.recordApplied(cfg) || '';
      }
    } catch {}
    return '';
  },

  _isWatchedConfigUnchangedPeek(configPath = null) {
    const targetPath = configPath || this._resolveWatchedConfigPath();
    try {
      const raw = fs.readFileSync(targetPath, 'utf8');
      if (!raw || !raw.trim()) return false;
      const hash = computeConfigFingerprint(raw);
      const last = this._configFingerprintTracker?.getLastHash?.() || '';
      return Boolean(hash && last && hash === last);
    } catch {
      return false;
    }
  },

  async _handleWatchedConfigChange(configPath = null) {
    const targetPath = configPath || this._resolveWatchedConfigPath();
    let raw = '';
    try {
      raw = fs.readFileSync(targetPath, 'utf8');
    } catch {
      return { applied: false, reason: 'read-failed' };
    }
    const res = this._configFingerprintTracker
      ? this._configFingerprintTracker.checkExternalChange(raw)
      : { changed: true, hash: '' };
    if (!res.changed) {
      return { applied: false, reason: 'fingerprint-unchanged', hash: res.hash };
    }
    this.cdp?.invalidateConfigCache?.();
    this._configSeq += 1;
    if (this.sessions && typeof this.sessions.values === 'function') {
      for (const entry of this.sessions.values()) {
        resetAllChannelCircuits(entry);
      }
    }
    await this.broadcastConfigRefresh();
    return { applied: true, hash: res.hash, configSeq: this._configSeq };
  },

  async tick() {
    if (!this.running) return { attached: this.sessions.size };
    if (this.busy) {
      this._pendingTick = true;
      return { attached: this.sessions.size };
    }
    this.busy = true;
    this._pendingTick = false;
    try {
      if (!this.isCurrentOwner()) {
        await this.stop(false, { skipAutoArchive: true });
        return { attached: 0, superseded: true };
      }

      if (!this.enabledCheck()) {
        this.hostFsmState = HOST_FSM_STATES.IDLE;
        this._noPortSinceMs = 0;
        this._hasActiveCdpPort = false;
        if (this.sessions.size > 0 || this.swarmSessions.size > 0 || this.browserSession) {
          await this.detachAll(true);
        }
        return { attached: 0, disabled: true };
      }

      const port = discoverActivePort(this.overridePort, this.portFile);
      if (!port) {
        this.hostFsmState = HOST_FSM_STATES.MISSING_CDP;
        this._hasActiveCdpPort = false;
        this._resetShortcutBackoff('no-port');
        if (this.sessions.size === 0 && this._prevAttachedCount > 0) {
          this._disconnectedAllSessions = true;
          this._prevAttachedCount = 0;
        }
        if (
          this.sessions.size === 0 &&
          this._sawLiveHost &&
          this._getAutoArchiveOnExitSetting() &&
          !this._autoArchiveInFlight &&
          !this._autoArchiveExitRan
        ) {
          void this._maybeRunAutoArchiveOnExit().catch(() => {});
        }
        await this._handleMissingCdpPort();
        return { attached: 0, port: null };
      }

      const now = Date.now();
      const canSkipListPoll =
        this.timer != null &&
        Boolean(this.browserSession && !this.browserSession.closed && this._browserDiscoverySubscribed) &&
        this.browserPort === port &&
        this.sessions.size > 0 &&
        !this._forceListPagesNextTick &&
        this._lastListPagesAt > 0 &&
        now - this._lastListPagesAt < this._listPagesFallbackIntervalMs;

      if (canSkipListPoll) {
        this._noPortSinceMs = 0;
        this._hasActiveCdpPort = true;
        this._maybeSyncShortcuts(false, { hasActivePort: true });

        const liveEntries = [];
        for (const [wsUrl, entry] of this.sessions.entries()) {
          if (entry.session.closed) {
            this.sessions.delete(wsUrl);
            continue;
          }
          liveEntries.push(entry);
        }

        if (liveEntries.length > 0) {
          await Promise.allSettled(liveEntries.map((entry) => this.verifyAndHealEntry(entry)));
          if (this.sessions.size > 0) {
            this.hostFsmState = HOST_FSM_STATES.ATTACHED;
            this._sawLiveHost = true;
            if (!(this._archiveScheduledAt > 0 && Date.now() - this._archiveScheduledAt < 60000)) {
              this._autoArchiveExitRan = false;
            }
          } else if (this._prevAttachedCount > 0) {
            this.hostFsmState = HOST_FSM_STATES.DISCOVERING;
            this._disconnectedAllSessions = true;
          }
          this._prevAttachedCount = this.sessions.size;
          this._releaseIdleTelemetry(Boolean(this._isTelemetryDisabled()));
          return {
            attached: this.sessions.size,
            port,
            pages: [...this.sessions.values()].map((e) => this._redactSensitiveText(e.title || e.url)),
            skippedListPoll: true,
          };
        }
        if (this._prevAttachedCount > 0) {
          this._disconnectedAllSessions = true;
          this._prevAttachedCount = 0;
        }
      }

      let rawPages = [];
      try {
        rawPages = await this.cdp.listPages(port);
        this._lastListPagesAt = Date.now();
        this._forceListPagesNextTick = false;
      } catch {
        this.hostFsmState = HOST_FSM_STATES.MISSING_CDP;
        this._hasActiveCdpPort = false;
        this._resetShortcutBackoff('port-unreachable');
        this.closeBrowserDiscovery();
        if (this.sessions.size === 0) {
          if (this._prevAttachedCount > 0) {
            this._disconnectedAllSessions = true;
            this._prevAttachedCount = 0;
          }
          if (this._sawLiveHost && this._getAutoArchiveOnExitSetting() && !this._autoArchiveInFlight && !this._autoArchiveExitRan) {
            void this._maybeRunAutoArchiveOnExit().catch(() => {});
          }
          await this._handleMissingCdpPort();
        }
        return { attached: this.sessions.size, port, unreachable: true };
      }

      this._noPortSinceMs = 0;
      this._hasActiveCdpPort = true;
      const prevActivePort = this._lastActiveCdpPort;
      const portChanged = prevActivePort !== null && prevActivePort !== port;
      this._lastActiveCdpPort = port;
      const prevSessionCount = this.sessions.size;
      const canRunShortcutSync = Boolean(this.timer || typeof this._relaunchHooks?.syncShortcuts === 'function');
      let forcedShortcutSyncThisTick = false;
      if (portChanged) {
        this._resetShortcutBackoff(`port-changed:${prevActivePort}->${port}`);
        if (canRunShortcutSync) {
          forcedShortcutSyncThisTick = true;
          this._maybeSyncShortcuts(true, { hasActivePort: true });
        }
      } else if (this.timer) {
        this._maybeSyncShortcuts(false, { hasActivePort: true });
      }

      if (this.timer) {
        void this.ensureBrowserDiscovery(port);
      }

      const eligible = rawPages.filter((t) => this._isEligibleDaemonTarget(t));
      const activeUrls = new Set(eligible.map((t) => t.webSocketDebuggerUrl));

      for (const [wsUrl, entry] of this.sessions.entries()) {
        if (entry.session.closed) {
          this.sessions.delete(wsUrl);
          continue;
        }
        if (!activeUrls.has(wsUrl)) {
          // 防御 SPA 短暂标题漂移（如 Swarm "Full View" -> "Untitled Conversation"）：卸载前先复核页面真实 DOM
          const check = await this.verifyAndHealEntry(entry, true);
          if (check && check.alive && (!check.ready || check.isHostDom)) {
            continue;
          }
          if (!entry.session.closed) {
            await this._teardownAllEntryChannelScripts(entry, entry.session, { removeBindings: true });
            await entry.session.evaluate(this.cdp.REMOVE_EXPRESSION).catch(() => {});
            if (entry._isoPauseTimers) {
              for (const tid of entry._isoPauseTimers) clearTimeout(tid);
              entry._isoPauseTimers.clear();
            }
            if (entry.isolatedHostI18nPaused) {
              await this._syncIsolatedHostI18n(entry, false).catch(() => {});
            }
          }
          transitionEntryState(entry, ENTRY_FSM_STATES.DETACHED, 'target-gone');
          entry.session.close();
          this.sessions.delete(wsUrl);
        }
      }

      if (!this.injectExpr) this.rebuildBundle();

      await Promise.allSettled(
        eligible.map((target) => {
          if (!this.sessions.has(target.webSocketDebuggerUrl)) {
            return this.attachTarget(target);
          }
          return this.verifyAndHealEntry(this.sessions.get(target.webSocketDebuggerUrl));
        })
      );

      // 盲区 3：全部窗口断开后重连，或活跃窗口数从 0 恢复时，立即复位 45 分钟退避并补检快捷方式
      const nowAttachedCount = this.sessions.size;
      this.hostFsmState = nowAttachedCount > 0 ? HOST_FSM_STATES.ATTACHED : HOST_FSM_STATES.DISCOVERING;
      if (nowAttachedCount > 0) {
        this._sawLiveHost = true;
        if (!(this._archiveScheduledAt > 0 && Date.now() - this._archiveScheduledAt < 60000)) {
          this._autoArchiveExitRan = false;
        }
      }
      if (nowAttachedCount === 0) {
        if (this._prevAttachedCount > 0 || prevSessionCount > 0) {
          this._disconnectedAllSessions = true;
        }
      } else {
        const recoveredFromAllDisconnected = this._disconnectedAllSessions;
        const recoveredFromZero = prevSessionCount === 0 && this._lastShortcutCheckAt > 0;
        if (recoveredFromAllDisconnected) {
          this._disconnectedAllSessions = false;
        }
        if ((recoveredFromAllDisconnected || recoveredFromZero) && !forcedShortcutSyncThisTick) {
          this._resetShortcutBackoff(
            recoveredFromAllDisconnected ? 'all-windows-reconnected' : 'active-windows-recovered-from-zero'
          );
          if (canRunShortcutSync) {
            this._maybeSyncShortcuts(true, { hasActivePort: true });
          }
        }
      }
      this._prevAttachedCount = nowAttachedCount;

      this._releaseIdleTelemetry(Boolean(this._isTelemetryDisabled()));

      return { attached: this.sessions.size, port, pages: eligible.map((p) => this._redactSensitiveText(p.title || p.url)) };
    } finally {
      this.busy = false;
      this._lastTickFinishedAt = Date.now();
      if (this._pendingTick && this.running) {
        this._pendingTick = false;
        this.scheduleImmediateTick(45);
      }
    }
  },

  _recoverPendingRunInBackgroundOnBoot() {
    runInBgRecovery.recoverPendingForDaemonBoot({
      rootDir: this.rootDir,
      defaultRootDir: DEFAULT_ROOT_DIR,
      extraMarkerPath: this._pendingRunInBgMarkerPath,
      getDefaultAppStoragePath: conversationArchive.getDefaultAntigravityAppStoragePath,
      log: (m) => this.log(m),
    });
  },

  start({ claimPid = true, watchFiles = true } = {}) {
    if (this.running) return;
    this._sidebarStopped = false;
    this._wallpaperStopped = false;
    this._suggesterStopped = false;
    this.running = true;
    this.hostFsmState = HOST_FSM_STATES.DISCOVERING;
    if (claimPid) this.claimOwnership();
    this._recoverPendingRunInBackgroundOnBoot();
    const initialPort = discoverActivePort(this.overridePort, this.portFile);
    this.log(`[boot] PrismDaemon started (pid=${process.pid}, activePort=${initialPort || 'none'}, root=${this.rootDir})`);
    this.rebuildBundle();
    const configPath = this._resolveWatchedConfigPath();
    this._syncConfigFingerprintFromDisk(configPath);

    if (watchFiles) {
      let pendingCodeChange = false;
      const devWatch = process.env.AG_PRISM_DEV_WATCH === '1';
      const watchTargetDir = devWatch ? this.rootDir : path.dirname(configPath);
      const configBaseName = path.basename(configPath);
      let lastConfigMtimeMs = 0;
      try {
        lastConfigMtimeMs = fs.statSync(configPath).mtimeMs || 0;
      } catch {}
      try {
        this.fsw = fs.watch(watchTargetDir, devWatch ? { recursive: true } : { persistent: false }, (_, filename) => {
          if (!this.running) return;
          const base = filename ? path.basename(String(filename)) : '';
          if (!devWatch) {
            if (base && base.toLowerCase() !== configBaseName.toLowerCase()) return;
            if (!base) {
              let nextMtime = 0;
              try {
                nextMtime = fs.statSync(configPath).mtimeMs || 0;
              } catch {}
              if (nextMtime === lastConfigMtimeMs && this._isWatchedConfigUnchangedPeek(configPath)) return;
              lastConfigMtimeMs = nextMtime;
            } else {
              try {
                lastConfigMtimeMs = fs.statSync(configPath).mtimeMs || 0;
              } catch {}
            }
            // 内容 SHA-256 指纹未变则零自激幂等跳过（无论杀软/慢盘延迟 100ms 还是 3000ms）
            if (this._isWatchedConfigUnchangedPeek(configPath)) return;
          } else {
            if (!base || base.startsWith('.') || !/\.(css|c?js|mjs|json)$/i.test(base)) return;
            if (base === 'daemon.log' || base === 'watch.log' || base === 'repo-meta.json') return;
            if (base.toLowerCase() === configBaseName.toLowerCase()) {
              if (this._isWatchedConfigUnchangedPeek(configPath)) return;
            } else {
              pendingCodeChange = true;
            }
          }
          if (this._reloadTimer) {
            clearTimeout(this._reloadTimer);
            this._reloadTimer = null;
          }
          const delayMs = pendingCodeChange ? 180 : 120;
          this._reloadTimer = setTimeout(async () => {
            this._reloadTimer = null;
            if (!this.running) return;
            const isCodeChange = pendingCodeChange;
            pendingCodeChange = false;
            try {
              if (!isCodeChange) {
                await this._handleWatchedConfigChange(configPath);
                return;
              }
              this.rebuildBundle();
              const activeItems = [...this.sessions.values()].filter((e) => e && !e.session.closed);
              await Promise.allSettled(activeItems.map((entry) => this.applyToEntry(entry)));
            } catch {}
          }, delayMs);
          if (this._reloadTimer && typeof this._reloadTimer.unref === 'function') {
            this._reloadTimer.unref();
          }
        });
        if (this.fsw && typeof this.fsw.unref === 'function') this.fsw.unref();
      } catch {}
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    void this.tick();

    if (this._enableAutoUpdateTimer) {
      this._updateInitialTimer = setTimeout(() => {
        this._updateInitialTimer = null;
        if (this.running && this._getAutoUpdateSetting() === 'on') {
          void this.runUpdateCheck({ force: false, manual: false, allowAutoApply: true }).catch(() => {});
        }
      }, this._updateCheckInitialDelayMs);
      this._updateInitialTimer?.unref?.();

      this._updateIntervalTimer = setInterval(() => {
        if (this.running && this._getAutoUpdateSetting() === 'on') {
          void this.runUpdateCheck({ force: false, manual: false, allowAutoApply: true }).catch(() => {});
        }
      }, this._updateCheckIntervalMs);
      this._updateIntervalTimer?.unref?.();
    }

    if (this._enableStorageGuardTimer) {
      this._storageGuardInitialTimer = setTimeout(() => {
        this._storageGuardInitialTimer = null;
        if (this.running) {
          void this._checkStorageGuardAndNotify().catch(() => {});
        }
      }, this._storageGuardInitialDelayMs);
      this._storageGuardInitialTimer?.unref?.();

      this._storageGuardIntervalTimer = setInterval(() => {
        if (this.running) {
          void this._checkStorageGuardAndNotify().catch(() => {});
        }
      }, this._storageGuardIntervalMs);
      this._storageGuardIntervalTimer?.unref?.();
    }
  },

  async stop(cleanPageDom = false, _testOverrides = null) {
    this.hostFsmState = HOST_FSM_STATES.STOPPING;
    this._flushUsageDiskCache();
    // 原生 sidecar 随宿主退出时：若开启了退出自动归档且非卸载动作，零 await 同步落盘内存目录索引并同步派生纯等待脱离任务，
    // 在宿主与 language_server 彻底退出 4s 后静默归档（杜绝异步 import 竞态导致进程退出前尚未完成派生）
    const autoArchiveEnabled =
      _testOverrides?.autoArchiveOnExit !== undefined
        ? Boolean(_testOverrides.autoArchiveOnExit)
        : this._getAutoArchiveOnExitSetting();
    const hasRecentManualArchive = this._archiveScheduledAt > 0 && Date.now() - this._archiveScheduledAt < 60000;
    if (
      !cleanPageDom &&
      !_testOverrides?.skipAutoArchive &&
      !this._isUninstalling &&
      this._sawLiveHost &&
      !this._autoArchiveExitRan &&
      !this._autoArchiveInFlight &&
      !hasRecentManualArchive &&
      autoArchiveEnabled
    ) {
      this._autoArchiveExitRan = true;
      try {
        const arch = _testOverrides?.arch || conversationArchive;
        const convDir = _testOverrides?.convDir || arch.getDefaultConversationsDir();
        const archiveDir = _testOverrides?.archiveDir || arch.getDefaultArchiveDir();
        this._flushCatalogIndexFromMemory(arch, convDir, archiveDir);
        const scriptPath = path.join(this.rootDir, 'sidecars', 'daemon', 'conversation-archive.mjs');
        arch.spawnDetachedArchiveTask(
          {
            action: 'auto-exit-archive',
            ...(_testOverrides?.convDir ? { convDir } : {}),
            ...(_testOverrides?.archiveDir ? { archiveDir } : {}),
            gracefulQuit: false,
            relaunch: false,
            mode: 'subagents',
            subagentMaxAgeHours: arch.AUTO_ARCHIVE_SUBAGENT_MAX_AGE_HOURS,
            settleMs: 4000,
            waitExitTimeoutMs: 30000,
          },
          {
            scriptPath,
            spawnHook: _testOverrides?.spawnHook,
            disableWmiBreakaway: Boolean(_testOverrides?.disableWmiBreakaway),
          }
        );
      } catch {}
    }
    this._sidebarStopped = true;
    this._wallpaperStopped = true;
    this._suggesterStopped = true;
    this.running = false;
    if (this._storageGuardInitialTimer) {
      clearTimeout(this._storageGuardInitialTimer);
      this._storageGuardInitialTimer = null;
    }
    if (this._storageGuardIntervalTimer) {
      clearInterval(this._storageGuardIntervalTimer);
      this._storageGuardIntervalTimer = null;
    }
    if (this._updateInitialTimer) {
      clearTimeout(this._updateInitialTimer);
      this._updateInitialTimer = null;
    }
    if (this._updateIntervalTimer) {
      clearInterval(this._updateIntervalTimer);
      this._updateIntervalTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this._reloadTimer) {
      clearTimeout(this._reloadTimer);
      this._reloadTimer = null;
    }
    if (this._bundleCacheFlushTimer) {
      clearTimeout(this._bundleCacheFlushTimer);
      this._bundleCacheFlushTimer = null;
    }
    if (this._discoverTimer) {
      clearTimeout(this._discoverTimer);
      this._discoverTimer = null;
    }
    this._discoverTimerTargetAt = 0;
    if (this._managedTimers) {
      for (const t of this._managedTimers) {
        clearTimeout(t);
      }
      this._managedTimers.clear();
    }
    if (this.sessions && typeof this.sessions.values === 'function') {
      for (const entry of this.sessions.values()) {
        if (entry && entry._healTimer) {
          clearTimeout(entry._healTimer);
          entry._healTimer = null;
        }
      }
    }
    if (this.fsw) {
      try {
        this.fsw.close();
      } catch {}
      this.fsw = null;
    }
    await this.detachAll(cleanPageDom);
    const standaloneLsClient = this._lazyLsClient && this._lazyLsClient !== this._lazyStore?.client ? this._lazyLsClient : null;
    for (const svc of [this._lazyUsage, this._lazyStore, standaloneLsClient, this._lazyThoughtService]) {
      if (!svc) continue;
      try {
        if (typeof svc.dispose === 'function') await svc.dispose();
        else if (typeof svc.close === 'function') await svc.close();
        else if (typeof svc.stop === 'function') await svc.stop();
      } catch {}
    }
    this._lazyUsage = null;
    this._lazyStore = null;
    this._lazyLsClient = null;
    this._backendSummariesCache = null;
    this._backendSummariesAt = 0;
    this._usageDiskCache = null;
    this._lazyThoughtService = null;
    if (this.omniServer) {
      const srv = this.omniServer;
      this.omniServer = null;
      this._omniServerPromise = null;
      await srv.stop().catch(() => {});
    }
    await this._sidebarServicePromise?.catch(() => null);
    if (this.sidebarService) {
      const sb = this.sidebarService;
      this.sidebarService = null;
      try {
        if (typeof sb.dispose === 'function') await sb.dispose();
      } catch {}
    }
    await this._wallpaperServicePromise?.catch(() => null);
    if (this._lazyWallpaperService) {
      const wp = this._lazyWallpaperService;
      this._lazyWallpaperService = null;
      try {
        if (typeof wp.dispose === 'function') await wp.dispose();
      } catch {}
    }
    await this._suggesterServicePromise?.catch(() => null);
    if (this._lazySuggesterService) {
      const sg = this._lazySuggesterService;
      this._lazySuggesterService = null;
      try {
        if (typeof sg.dispose === 'function') await sg.dispose();
      } catch {}
    }
    this.releaseOwnership();
    this.hostFsmState = HOST_FSM_STATES.IDLE;
  },
};
