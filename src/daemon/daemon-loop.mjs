// Obsidian Prism 守护进程主循环、fs.watch SHA-256 指纹热重载与启停生命周期（Tier 3，独立组合类，无原型 Mixin）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as conversationArchive from '../../sidecars/daemon/conversation-archive.mjs';
import { DEFAULT_ROOT_DIR, discoverActivePort, isPluginEnabledInHostConfig } from './constants.mjs';
import {
  HOST_FSM_STATES,
  ENTRY_FSM_STATES,
  transitionEntryState,
} from './session-fsm.mjs';

const require = createRequire(import.meta.url);
const runInBgRecovery = require('../platform/run-in-bg-recovery.cjs');

export class DaemonLoop {
  constructor({
    pollIntervalMs = 3000,
    enabledCheck = () => isPluginEnabledInHostConfig(),
    pendingRunInBgMarkerPath = '',
    getRootDir = () => DEFAULT_ROOT_DIR,
    getOverridePort = () => null,
    getPortFile = () => null,
    getCdp = () => null,
    logger = null,
    pidLock = null,
    relaunchGuard = null,
    sessionRegistry = null,
    channelOrchestrator = null,
    telemetrySubsystem = null,
    updateStorageSubsystem = null,
    invokeIsCurrentOwner = null,
    invokeStop = null,
    invokeDetachAll = null,
    invokeRebuildBundle = null,
    invokeTick = null,
    invokeScheduleImmediateTick = null,
    invokeReleaseOwnership = null,
    invokeApplyToEntry = null,
    invokeVerifyAndHealEntry = null,
    invokeLog = null,
  } = {}) {
    this.pollIntervalMs = Math.max(200, Number(pollIntervalMs) || 3000);
    this.enabledCheck = enabledCheck;
    this._pendingRunInBgMarkerPath = typeof pendingRunInBgMarkerPath === 'string' ? pendingRunInBgMarkerPath : '';
    this._getRootDir = getRootDir;
    this._getOverridePort = getOverridePort;
    this._getPortFile = getPortFile;
    this._getCdp = getCdp;

    this.logger = logger;
    this.pidLock = pidLock;
    this.relaunchGuard = relaunchGuard;
    this.sessionRegistry = sessionRegistry;
    this.channelOrchestrator = channelOrchestrator;
    this.telemetrySubsystem = telemetrySubsystem;
    this.updateStorageSubsystem = updateStorageSubsystem;

    this._invokeIsCurrentOwner = invokeIsCurrentOwner;
    this._invokeStop = invokeStop;
    this._invokeDetachAll = invokeDetachAll;
    this._invokeRebuildBundle = invokeRebuildBundle;
    this._invokeTick = invokeTick;
    this._invokeScheduleImmediateTick = invokeScheduleImmediateTick;
    this._invokeReleaseOwnership = invokeReleaseOwnership;
    this._invokeApplyToEntry = invokeApplyToEntry;
    this._invokeVerifyAndHealEntry = invokeVerifyAndHealEntry;
    this._invokeLog = invokeLog;

    this.running = false;
    this.busy = false;
    this.timer = null;
    this.fsw = null;
    this._reloadTimer = null;
    this._pendingTick = false;
  }

  log(msg) {
    if (typeof this._invokeLog === 'function') return this._invokeLog(msg);
    this.logger?.log(msg);
  }

  redact(text) {
    return this.logger ? this.logger.redactSensitiveText(text) : String(text || '');
  }

  _isCurrentOwner() {
    if (typeof this._invokeIsCurrentOwner === 'function') return this._invokeIsCurrentOwner();
    return this.pidLock.isCurrentOwner();
  }

  _stop(cleanPageDom, opts) {
    if (typeof this._invokeStop === 'function') return this._invokeStop(cleanPageDom, opts);
    return this.stop(cleanPageDom, opts);
  }

  _detachAll(cleanPageDom) {
    if (typeof this._invokeDetachAll === 'function') return this._invokeDetachAll(cleanPageDom);
    return this.sessionRegistry.detachAll(cleanPageDom);
  }

  _rebuildBundle(opts) {
    if (typeof this._invokeRebuildBundle === 'function') return this._invokeRebuildBundle(opts);
    return this.channelOrchestrator.rebuildBundle(opts);
  }

  _tick() {
    if (typeof this._invokeTick === 'function') return this._invokeTick();
    return this.tick();
  }

  _scheduleImmediateTick(delayMs) {
    if (typeof this._invokeScheduleImmediateTick === 'function') return this._invokeScheduleImmediateTick(delayMs);
    return this.sessionRegistry.scheduleImmediateTick(delayMs);
  }

  _releaseOwnership() {
    if (typeof this._invokeReleaseOwnership === 'function') return this._invokeReleaseOwnership();
    return this.pidLock.releaseOwnership();
  }

  _applyToEntry(entry) {
    if (typeof this._invokeApplyToEntry === 'function') return this._invokeApplyToEntry(entry);
    return this.channelOrchestrator.applyToEntry(entry);
  }

  _verifyAndHealEntry(entry, force = false) {
    if (typeof this._invokeVerifyAndHealEntry === 'function') return this._invokeVerifyAndHealEntry(entry, force);
    return this.channelOrchestrator.verifyAndHealEntry(entry, force);
  }

  recoverPendingRunInBackgroundOnBoot() {
    runInBgRecovery.recoverPendingForDaemonBoot({
      rootDir: this._getRootDir(),
      defaultRootDir: DEFAULT_ROOT_DIR,
      extraMarkerPath: this._pendingRunInBgMarkerPath,
      getDefaultAppStoragePath: conversationArchive.getDefaultAntigravityAppStoragePath,
      log: (m) => this.log(m),
    });
  }

  async tick() {
    const reg = this.sessionRegistry;
    const ch = this.channelOrchestrator;
    const tel = this.telemetrySubsystem;
    const upd = this.updateStorageSubsystem;
    const rg = this.relaunchGuard;
    const cdp = this._getCdp();

    if (!this.running) return { attached: reg.sessions.size };
    if (this.busy) {
      this._pendingTick = true;
      return { attached: reg.sessions.size };
    }
    this.busy = true;
    this._pendingTick = false;
    try {
      if (!this._isCurrentOwner()) {
        await this._stop(false, { skipAutoArchive: true });
        return { attached: 0, superseded: true };
      }

      if (!this.enabledCheck()) {
        reg.hostFsmState = HOST_FSM_STATES.IDLE;
        rg._noPortSinceMs = 0;
        rg._hasActiveCdpPort = false;
        if (reg.sessions.size > 0 || ch.swarmManager.swarmSessions.size > 0 || reg.browserSession) {
          await this._detachAll(true);
        }
        return { attached: 0, disabled: true };
      }

      const port = discoverActivePort(this._getOverridePort(), this._getPortFile());
      if (!port) {
        reg.hostFsmState = HOST_FSM_STATES.MISSING_CDP;
        rg._hasActiveCdpPort = false;
        rg.resetShortcutBackoff('no-port');
        if (reg.sessions.size === 0 && reg._prevAttachedCount > 0) {
          reg._disconnectedAllSessions = true;
          reg._prevAttachedCount = 0;
        }
        if (
          reg.sessions.size === 0 &&
          upd._sawLiveHost &&
          upd.getAutoArchiveOnExitSetting() &&
          !upd._autoArchiveInFlight &&
          !upd._autoArchiveExitRan
        ) {
          void upd.maybeRunAutoArchiveOnExit().catch(() => {});
        }
        await rg.handleMissingCdpPort();
        return { attached: 0, port: null };
      }

      const now = Date.now();
      const canSkipListPoll =
        this.timer != null &&
        Boolean(reg.browserSession && !reg.browserSession.closed && reg._browserDiscoverySubscribed) &&
        reg.browserPort === port &&
        reg.sessions.size > 0 &&
        !reg._forceListPagesNextTick &&
        reg._lastListPagesAt > 0 &&
        now - reg._lastListPagesAt < reg._listPagesFallbackIntervalMs;

      if (canSkipListPoll) {
        rg._noPortSinceMs = 0;
        rg._hasActiveCdpPort = true;
        rg.maybeSyncShortcuts(false, { hasActivePort: true });

        const liveEntries = [];
        for (const [wsUrl, entry] of reg.sessions.entries()) {
          if (entry.session.closed) {
            reg.sessions.delete(wsUrl);
            continue;
          }
          liveEntries.push(entry);
        }

        if (liveEntries.length > 0) {
          await Promise.allSettled(liveEntries.map((entry) => this._verifyAndHealEntry(entry)));
          if (reg.sessions.size > 0) {
            reg.hostFsmState = HOST_FSM_STATES.ATTACHED;
            upd.markHostLive();
          } else if (reg._prevAttachedCount > 0) {
            reg.hostFsmState = HOST_FSM_STATES.DISCOVERING;
            reg._disconnectedAllSessions = true;
          }
          reg._prevAttachedCount = reg.sessions.size;
          tel.releaseIdle(Boolean(tel.isDisabled()));
          return {
            attached: reg.sessions.size,
            port,
            pages: [...reg.sessions.values()].map((e) => this.redact(e.title || e.url)),
            skippedListPoll: true,
          };
        }
        if (reg._prevAttachedCount > 0) {
          reg._disconnectedAllSessions = true;
          reg._prevAttachedCount = 0;
        }
      }

      let rawPages = [];
      try {
        rawPages = await cdp.listPages(port);
        reg._lastListPagesAt = Date.now();
        reg._forceListPagesNextTick = false;
      } catch {
        reg.hostFsmState = HOST_FSM_STATES.MISSING_CDP;
        rg._hasActiveCdpPort = false;
        rg.resetShortcutBackoff('port-unreachable');
        reg.closeBrowserDiscovery();
        if (reg.sessions.size === 0) {
          if (reg._prevAttachedCount > 0) {
            reg._disconnectedAllSessions = true;
            reg._prevAttachedCount = 0;
          }
          if (upd._sawLiveHost && upd.getAutoArchiveOnExitSetting() && !upd._autoArchiveInFlight && !upd._autoArchiveExitRan) {
            void upd.maybeRunAutoArchiveOnExit().catch(() => {});
          }
          await rg.handleMissingCdpPort();
        }
        return { attached: reg.sessions.size, port, unreachable: true };
      }

      rg._noPortSinceMs = 0;
      rg._hasActiveCdpPort = true;
      const prevActivePort = rg._lastActiveCdpPort;
      const portChanged = prevActivePort !== null && prevActivePort !== port;
      rg._lastActiveCdpPort = port;
      const prevSessionCount = reg.sessions.size;
      const canRunShortcutSync = Boolean(this.timer || typeof rg._relaunchHooks?.syncShortcuts === 'function');
      let forcedShortcutSyncThisTick = false;
      if (portChanged) {
        rg.resetShortcutBackoff(`port-changed:${prevActivePort}->${port}`);
        if (canRunShortcutSync) {
          forcedShortcutSyncThisTick = true;
          rg.maybeSyncShortcuts(true, { hasActivePort: true });
        }
      } else if (this.timer) {
        rg.maybeSyncShortcuts(false, { hasActivePort: true });
      }

      if (this.timer) {
        void reg.ensureBrowserDiscovery(port);
      }

      const eligible = rawPages.filter((t) => reg.isEligibleDaemonTarget(t));
      const activeUrls = new Set(eligible.map((t) => t.webSocketDebuggerUrl));

      for (const [wsUrl, entry] of reg.sessions.entries()) {
        if (entry.session.closed) {
          reg.sessions.delete(wsUrl);
          continue;
        }
        if (!activeUrls.has(wsUrl)) {
          // 防御 SPA 短暂标题漂移（如 Swarm "Full View" -> "Untitled Conversation"）：卸载前先复核页面真实 DOM
          const check = await this._verifyAndHealEntry(entry, true);
          if (check && check.alive && (!check.ready || check.isHostDom)) {
            continue;
          }
          if (!entry.session.closed) {
            await ch.teardownAllEntryChannelScripts(entry, entry.session, { removeBindings: true });
            await entry.session.evaluate(cdp.REMOVE_EXPRESSION).catch(() => {});
            if (entry._isoPauseTimers) {
              for (const tid of entry._isoPauseTimers) clearTimeout(tid);
              entry._isoPauseTimers.clear();
            }
            if (entry.isolatedHostI18nPaused) {
              await ch.swarmManager.syncIsolatedHostI18n(entry, false).catch(() => {});
            }
          }
          transitionEntryState(entry, ENTRY_FSM_STATES.DETACHED, 'target-gone');
          entry.session.close();
          reg.sessions.delete(wsUrl);
        }
      }

      if (!ch.injectExpr) this._rebuildBundle();

      await Promise.allSettled(
        eligible.map((target) => {
          if (!reg.sessions.has(target.webSocketDebuggerUrl)) {
            return reg.attachTarget(target);
          }
          return this._verifyAndHealEntry(reg.sessions.get(target.webSocketDebuggerUrl));
        })
      );

      const nowAttachedCount = reg.sessions.size;
      reg.hostFsmState = nowAttachedCount > 0 ? HOST_FSM_STATES.ATTACHED : HOST_FSM_STATES.DISCOVERING;
      if (nowAttachedCount > 0) {
        upd.markHostLive();
      }
      if (nowAttachedCount === 0) {
        if (reg._prevAttachedCount > 0 || prevSessionCount > 0) {
          reg._disconnectedAllSessions = true;
        }
      } else {
        const recoveredFromAllDisconnected = reg._disconnectedAllSessions;
        const recoveredFromZero = prevSessionCount === 0 && rg._lastShortcutCheckAt > 0;
        if (recoveredFromAllDisconnected) {
          reg._disconnectedAllSessions = false;
        }
        if ((recoveredFromAllDisconnected || recoveredFromZero) && !forcedShortcutSyncThisTick) {
          rg.resetShortcutBackoff(
            recoveredFromAllDisconnected ? 'all-windows-reconnected' : 'active-windows-recovered-from-zero'
          );
          if (canRunShortcutSync) {
            rg.maybeSyncShortcuts(true, { hasActivePort: true });
          }
        }
      }
      reg._prevAttachedCount = nowAttachedCount;

      tel.releaseIdle(Boolean(tel.isDisabled()));

      return { attached: reg.sessions.size, port, pages: eligible.map((p) => this.redact(p.title || p.url)) };
    } finally {
      this.busy = false;
      reg._lastTickFinishedAt = Date.now();
      if (this._pendingTick && this.running) {
        this._pendingTick = false;
        this._scheduleImmediateTick(45);
      }
    }
  }

  start({ claimPid = true, watchFiles = true } = {}) {
    if (this.running) return;
    const reg = this.sessionRegistry;
    const ch = this.channelOrchestrator;
    const upd = this.updateStorageSubsystem;
    const rootDir = this._getRootDir();

    ch.services.markStarted();
    this.running = true;
    reg.hostFsmState = HOST_FSM_STATES.DISCOVERING;
    if (claimPid) this.pidLock.claimOwnership();
    this.recoverPendingRunInBackgroundOnBoot();
    const initialPort = discoverActivePort(this._getOverridePort(), this._getPortFile());
    this.log(`[boot] PrismDaemon started (pid=${process.pid}, activePort=${initialPort || 'none'}, root=${rootDir})`);
    this._rebuildBundle();
    const configPath = ch.resolveWatchedConfigPath();
    ch.syncConfigFingerprintFromDisk(configPath);

    if (watchFiles) {
      let pendingCodeChange = false;
      const devWatch = process.env.AG_PRISM_DEV_WATCH === '1';
      const watchTargetDir = devWatch ? rootDir : path.dirname(configPath);
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
              if (nextMtime === lastConfigMtimeMs && ch.isWatchedConfigUnchangedPeek(configPath)) return;
              lastConfigMtimeMs = nextMtime;
            } else {
              try {
                lastConfigMtimeMs = fs.statSync(configPath).mtimeMs || 0;
              } catch {}
            }
            if (ch.isWatchedConfigUnchangedPeek(configPath)) return;
          } else {
            if (!base || base.startsWith('.') || !/\.(css|c?js|mjs|json)$/i.test(base)) return;
            if (base === 'daemon.log' || base === 'watch.log' || base === 'repo-meta.json') return;
            if (base.toLowerCase() === configBaseName.toLowerCase()) {
              if (ch.isWatchedConfigUnchangedPeek(configPath)) return;
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
                await ch.handleWatchedConfigChange(configPath);
                return;
              }
              this._rebuildBundle();
              const activeItems = [...reg.sessions.values()].filter((e) => e && !e.session.closed);
              await Promise.allSettled(activeItems.map((entry) => this._applyToEntry(entry)));
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
      void this._tick();
    }, this.pollIntervalMs);
    void this._tick();
    upd.startTimers();
  }

  async stop(cleanPageDom = false, _testOverrides = null) {
    const reg = this.sessionRegistry;
    const ch = this.channelOrchestrator;
    const tel = this.telemetrySubsystem;
    const upd = this.updateStorageSubsystem;

    reg.hostFsmState = HOST_FSM_STATES.STOPPING;
    tel.flushUsageDiskCache();
    // 原生 sidecar 随宿主退出时：若开启了退出自动归档且非卸载动作，零 await 同步落盘内存目录索引并同步派生纯等待脱离任务
    upd.triggerDetachedExitArchiveSync(conversationArchive, cleanPageDom, _testOverrides);

    ch.services.markStopping();
    this.running = false;
    upd.stopTimers();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this._reloadTimer) {
      clearTimeout(this._reloadTimer);
      this._reloadTimer = null;
    }
    ch.clearFlushTimer();
    reg.clearAllTimers();
    if (this.fsw) {
      try {
        this.fsw.close();
      } catch {}
      this.fsw = null;
    }
    await this._detachAll(cleanPageDom);
    await tel.disposeAll();
    await ch.services.disposeAll();
    this._releaseOwnership();
    reg.hostFsmState = HOST_FSM_STATES.IDLE;
  }
}
