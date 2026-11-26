// Obsidian Prism 守护进程顶层组装入口（组装 PrismDaemon 原型与 CLI 启动，L3 Assembly）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { UpdateService } from '../../sidecars/daemon/update-service.mjs';
import { AddonRegistry } from '../../sidecars/daemon/addon-registry.mjs';
import { QuotaForceRefreshGuard } from './quota-guard.mjs';
import { OmniServer, OMNI_BINDING } from '../../vendor/omni-viewer/omni-server.mjs';
import { copyUpdatedRuntimeFromRepo } from '../platform/repo-sync.cjs';
import {
  DEFAULT_ROOT_DIR,
  PKG_VERSION,
  METRICS_BINDING,
  REPO_BINDING,
  THOUGHT_BINDING,
  USAGE_BINDING,
  INLINE_DIFF_BINDING,
  SIDEBAR_BINDING,
  WALLPAPER_BINDING,
  SUGGESTER_BINDING,
  resolveStorageGuardStatePath,
  resolveUsageCachePath,
  resolvePortFileCandidates,
  discoverActivePort,
  isEligibleTarget,
  isPluginEnabledInHostConfig,
} from './constants.mjs';
import { sanitizeGitRemoteUrl, writeFileAtomicSync } from './fs-atomic.mjs';
import { loggerMethods, sanitizeSecretText, sanitizeLogLine } from './logger.mjs';
import {
  parseTasklistCsvImageName,
  queryWindowsProcessImageNameSync,
  verifyDaemonPidLockToken,
  isObsidianPrismDaemonCommandLine,
  parseArgs,
  isMainEntry,
  DAEMON_SHUTDOWN_SIGNALS,
  registerDaemonShutdownSignals,
  pidLockMethods,
} from './pid-lock.mjs';
import {
  HOST_FSM_STATES,
  ENTRY_FSM_STATES,
  CHANNEL_FSM_STATES,
  AWAITING_DOM_MAX_ATTEMPTS,
  CHANNEL_CIRCUIT_FAIL_THRESHOLD,
  ConfigFingerprintTracker,
  computeConfigFingerprint,
  extractSignificantTargetUrl,
  evaluateTargetInfoChange,
} from './session-fsm.mjs';
import { isSensitiveInlineDiffPath } from './inline-diff-filter.mjs';
import { readSafeInlineDiff } from './inline-diff-service.mjs';
import {
  normalizeUsageScopeKey,
  extractScopeKeyFromUri,
  extractScopeKeyFromTitle,
  resolveUsageScopeKey,
  hasRealUsageRecord,
  telemetryScopeMethods,
} from './telemetry-scope.mjs';
import { telemetryCacheMethods } from './telemetry-cache.mjs';
import { telemetryServiceMethods } from './telemetry-service.mjs';
import { repoUpdateMethods } from './repo-update-coordinator.mjs';
import { storageGuardActionMethods } from './storage-guard-actions.mjs';
import { storageGuardCoordinatorMethods } from './storage-guard-coordinator.mjs';
import { swarmSessionMethods } from './swarm-session-manager.mjs';
import { channelCoordinatorMethods } from './channel-coordinator.mjs';
import { channelDeliveryMethods } from './channel-delivery.mjs';
import { initRuntimeChannelDaemonFields } from './runtime-channel-specs.mjs';
import { isTrustedMainFrameBindingCall, isTrustedHostContext, rpcDispatcherMethods } from './rpc-dispatcher.mjs';
import { sessionApplyMethods } from './session-apply.mjs';
import { sessionBroadcastMethods } from './session-broadcast.mjs';
import { sessionHealMethods } from './session-heal.mjs';
import { relaunchGuardMethods } from './relaunch-guard.mjs';
import { browserDiscoveryMethods } from './browser-discovery.mjs';
import { daemonLoopMethods } from './daemon-loop.mjs';

const require = createRequire(import.meta.url);

export class PrismDaemon {
  constructor({
    rootDir = DEFAULT_ROOT_DIR,
    gitRepoDir = null,
    bundleCachePath = undefined,
    usageCachePath = undefined,
    overridePort = null,
    portFile = null,
    pollIntervalMs = 3000,
    enabledCheck = () => isPluginEnabledInHostConfig(),
    metricsProvider = null,
    thoughtService = null,
    wallpaperService = null,
    suggesterService = null,
    omniExecHooks = null,
    sidebarService = null,
    relaunchHooks = null,
    daemonPidVerifier = null,
    noPortRelaunchThresholdMs = 8000,
    shortcutCheckIntervalMs = 300000,
    shortcutBackoffIntervalMs = 45 * 60 * 1000,
    listPagesFallbackIntervalMs = 12000,
    _testUpdateService = null,
    _testAddonRegistry = null,
    addonsDir = null,
    updateCheckInitialDelayMs = 45000,
    updateCheckIntervalMs = 6 * 60 * 60 * 1000,
    enableAutoUpdateTimer = true,
    storageGuardStatePath = null,
    storageGuardInitialDelayMs = 35000,
    storageGuardIntervalMs = 300000,
    enableStorageGuardTimer = true,
    silent = false,
    quotaCooldownNow = null,
    pendingRunInBgMarkerPath = '',
  } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.gitRepoDir = gitRepoDir ? path.resolve(gitRepoDir) : null;
    this._bundleCachePathOpt = bundleCachePath;
    this.overridePort = overridePort;
    this.portFile = portFile;
    this.pollIntervalMs = Math.max(200, Number(pollIntervalMs) || 3000);
    this.enabledCheck = enabledCheck;
    this.silent = Boolean(silent);
    this.cdp = require(path.join(this.rootDir, 'cdp.js'));
    this._loadedCdpVerifier = typeof this.cdp?.isExpectedDaemonProcess === 'function' ? this.cdp.isExpectedDaemonProcess : null;
    this._daemonPidVerifier = typeof daemonPidVerifier === 'function' ? daemonPidVerifier : null;
    this._cdpFileSig = this._readCdpFileSig();
    this._configFingerprintTracker = new ConfigFingerprintTracker();
    this._configSeq = 0;
    this._broadcastRunning = false;
    this._broadcastPending = false;
    this._broadcastWaiters = [];
    this._configConvergenceDirty = false;
    this.hostFsmState = HOST_FSM_STATES.IDLE;
    this._reentrantTickStreak = 0;
    this._lastTickFinishedAt = 0;
    this._discoverTimerTargetAt = 0;
    this.sessions = new Map();
    this.swarmSessions = new Map();
    this._swarmAttaching = new Set();
    this.ignoredTargets = new Map();
    this.browserSession = null;
    this.browserPort = null;
    this._browserDiscoverySubscribed = false;
    this._lastListPagesAt = 0;
    this._forceListPagesNextTick = false;
    const fallbackListMs = Number(listPagesFallbackIntervalMs);
    this._listPagesFallbackIntervalMs = Number.isFinite(fallbackListMs) ? Math.max(100, fallbackListMs) : 12000;
    this._discoverTimer = null;
    this._reloadTimer = null;
    this._bundleCacheFlushTimer = null;
    this._managedTimers = new Set();
    this._pendingTick = false;
    this.running = false;
    this.busy = false;
    this.timer = null;
    this.fsw = null;
    this.injectExpr = '';
    this.omniExpr = '';
    this.sidebarExpr = '';
    this.hostI18nExpr = '';
    this.swarmI18nExpr = '';
    this.swarmI18nCodeHash = '';
    this.thoughtExpr = '';
    this.thoughtCodeHash = '';
    this._thoughtHashSource = '';
    this.inlineDiffExpr = '';
    this.inlineDiffCodeHash = '';
    this._inlineDiffHashSource = '';
    this.wallpaperExpr = '';
    this.wallpaperCodeHash = '';
    this._wallpaperHashSource = '';
    this.suggesterExpr = '';
    this.suggesterCodeHash = '';
    this._suggesterHashSource = '';
    this.periodicPickerExpr = '';
    this.periodicPickerCodeHash = '';
    this._periodicPickerHashSource = '';
    this.settingsExpr = '';
    this.settingsCodeHash = '';
    this._settingsHashSource = '';
    this.mascotExpr = '';
    this.mascotCodeHash = '';
    this._mascotHashSource = '';
    this.homeStudioExpr = '';
    this.homeStudioCodeHash = '';
    this._homeStudioHashSource = '';
    initRuntimeChannelDaemonFields(this);
    this.codeHash = '';
    this.ownerToken = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    this.pidFile = path.join(this.rootDir, '.daemon.pid');
    this.logFile = path.join(this.rootDir, 'daemon.log');
    this._logBytes = -1;
    this._ownerFileCache = null;
    this._safeSidebarFileCache = null;
    this._lazyStore = null;
    this._lazyUsage = null;
    this._lazyLsClient = null;
    this._backendSummariesCache = null;
    this._backendSummariesAt = 0;
    this._usageCachePathOpt = usageCachePath;
    this._usageCacheFile = resolveUsageCachePath(usageCachePath);
    this._usageDiskCache = null;
    this._usageCacheDirty = false;
    this._usageCacheTimer = null;
    this._storageHealthCache = null;
    this._storageHealthAt = 0;
    this._storageGuardStateFile = resolveStorageGuardStatePath(storageGuardStatePath);
    this._enableStorageGuardTimer = enableStorageGuardTimer !== false;
    const sgInit = Number(storageGuardInitialDelayMs);
    this._storageGuardInitialDelayMs = Number.isFinite(sgInit) ? Math.max(0, sgInit) : 35000;
    const sgInt = Number(storageGuardIntervalMs);
    this._storageGuardIntervalMs = Number.isFinite(sgInt) ? Math.max(5000, sgInt) : 300000;
    this._storageGuardInitialTimer = null;
    this._storageGuardIntervalTimer = null;
    this._storageGuardBannerShownAt = 0;
    this._lastStorageIndexRefreshAt = 0;
    this._sawLiveHost = false;
    this._autoArchiveExitRan = false;
    this._autoArchiveInFlight = false;
    this._archiveActionInFlight = false;
    this._archiveScheduledAt = 0;
    this._isUninstalling = false;
    this._lastTelemetryActivityAt = 0;
    this._telemetryInFlight = 0;
    this._customMetricsProvider = metricsProvider;
    this._lazyThoughtService = thoughtService;
    this._lazyWallpaperService = wallpaperService;
    this._wallpaperServicePromise = null;
    this._wallpaperStopped = false;
    this._lazySuggesterService = suggesterService;
    this._suggesterServicePromise = null;
    this._suggesterStopped = false;
    this.omniServer = null;
    this._omniServerPromise = null;
    this._omniExecHooks = omniExecHooks;
    this.sidebarService = sidebarService;
    this._sidebarServicePromise = null;
    this._sidebarStopped = false;
    this._relaunchHooks = relaunchHooks;
    this.noPortRelaunchThresholdMs = Math.max(50, Number(noPortRelaunchThresholdMs) || 8000);
    this.shortcutCheckIntervalMs = Math.max(1000, Number(shortcutCheckIntervalMs) || 300000);
    const backoffMs = Number(shortcutBackoffIntervalMs);
    this._shortcutBackoffIntervalMs = Math.max(
      this.shortcutCheckIntervalMs,
      Number.isFinite(backoffMs) && backoffMs > 0 ? backoffMs : 45 * 60 * 1000
    );
    this._shortcutAllClean = false;
    this._hasActiveCdpPort = false;
    this._noPortSinceMs = 0;
    this._promptInFlight = false;
    this._lastShortcutCheckAt = 0;
    this._lastObservedHostPid = 0;
    this._lastActiveCdpPort = null;
    this._prevAttachedCount = 0;
    this._disconnectedAllSessions = false;
    this._enableAutoUpdateTimer = enableAutoUpdateTimer !== false;
    const initDelayNum = Number(updateCheckInitialDelayMs);
    this._updateCheckInitialDelayMs = Number.isFinite(initDelayNum) ? Math.max(0, initDelayNum) : 45000;
    const intervalNum = Number(updateCheckIntervalMs);
    this._updateCheckIntervalMs = Number.isFinite(intervalNum) ? Math.max(1000, intervalNum) : 6 * 60 * 60 * 1000;
    this._updateInitialTimer = null;
    this._updateIntervalTimer = null;
    this._lastUpdateState = null;
    this._updateCheckInFlight = null;
    this._updateCheckInFlightChannel = null;
    const initialUpdateChannel = this._getUpdateChannelSetting();
    this.updateService =
      _testUpdateService ||
      new UpdateService({
        currentVersion: this.cdp?.PLUGIN_VERSION || PKG_VERSION,
        channel: initialUpdateChannel,
      });
    if (_testUpdateService && typeof _testUpdateService.setChannel === 'function') {
      try {
        _testUpdateService.setChannel(initialUpdateChannel);
      } catch {}
    }
    this._quotaForceRefreshGuard = new QuotaForceRefreshGuard({
      ...(typeof quotaCooldownNow === 'function' ? { now: quotaCooldownNow } : {}),
    });
    this._pendingRunInBgMarkerPath = typeof pendingRunInBgMarkerPath === 'string' ? pendingRunInBgMarkerPath : '';
    this.addonRegistry =
      _testAddonRegistry ||
      new AddonRegistry({
        rootDir: this.rootDir,
        ...(addonsDir ? { addonsDir } : {}),
      });
  }
}

Object.assign(
  PrismDaemon.prototype,
  loggerMethods,
  pidLockMethods,
  telemetryScopeMethods,
  telemetryCacheMethods,
  telemetryServiceMethods,
  repoUpdateMethods,
  storageGuardActionMethods,
  storageGuardCoordinatorMethods,
  swarmSessionMethods,
  channelCoordinatorMethods,
  channelDeliveryMethods,
  rpcDispatcherMethods,
  sessionApplyMethods,
  sessionBroadcastMethods,
  sessionHealMethods,
  relaunchGuardMethods,
  browserDiscoveryMethods,
  daemonLoopMethods
);

export function runDaemonCli(argv = process.argv) {
  const cli = parseArgs(argv);
  const daemon = new PrismDaemon({
    rootDir: cli.rootDir,
    gitRepoDir: cli.gitRepoDir,
    overridePort: cli.port,
  });

  if (cli.once) {
    daemon.running = true;
    daemon.rebuildBundle();
    daemon
      .tick()
      .then(async (res) => {
        if (cli.outFile) {
          fs.writeFileSync(cli.outFile, JSON.stringify({ ok: true, ...res }, null, 2), 'utf8');
        } else {
          console.log(JSON.stringify({ ok: true, ...res }, null, 2));
        }
        await daemon.stop(false, { skipAutoArchive: true });
        process.exit(0);
      })
      .catch(async (err) => {
        console.error('[obsidian-prism daemon] error:', err.message);
        await daemon.stop(false, { skipAutoArchive: true });
        process.exitCode = 1;
      });
  } else {
    daemon.start({ claimPid: true, watchFiles: true });
    registerDaemonShutdownSignals(daemon);
    process.on('uncaughtException', (err) => {
      daemon.log(`[!] uncaughtException: ${err?.stack || err}`);
    });
    process.on('unhandledRejection', (err) => {
      daemon.log(`[!] unhandledRejection: ${err?.stack || err}`);
    });
  }
  return daemon;
}

export {
  sanitizeSecretText,
  sanitizeLogLine,
  copyUpdatedRuntimeFromRepo,
  METRICS_BINDING,
  REPO_BINDING,
  THOUGHT_BINDING,
  USAGE_BINDING,
  INLINE_DIFF_BINDING,
  SIDEBAR_BINDING,
  WALLPAPER_BINDING,
  SUGGESTER_BINDING,
  OmniServer,
  OMNI_BINDING,
  resolveStorageGuardStatePath,
  resolveUsageCachePath,
  normalizeUsageScopeKey,
  extractScopeKeyFromUri,
  extractScopeKeyFromTitle,
  resolveUsageScopeKey,
  hasRealUsageRecord,
  sanitizeGitRemoteUrl,
  writeFileAtomicSync,
  isSensitiveInlineDiffPath,
  readSafeInlineDiff,
  resolvePortFileCandidates,
  discoverActivePort,
  isEligibleTarget,
  isPluginEnabledInHostConfig,
  parseTasklistCsvImageName,
  queryWindowsProcessImageNameSync,
  verifyDaemonPidLockToken,
  isObsidianPrismDaemonCommandLine,
  isMainEntry,
  DAEMON_SHUTDOWN_SIGNALS,
  registerDaemonShutdownSignals,
  isTrustedMainFrameBindingCall,
  isTrustedHostContext,
  HOST_FSM_STATES,
  ENTRY_FSM_STATES,
  CHANNEL_FSM_STATES,
  AWAITING_DOM_MAX_ATTEMPTS,
  CHANNEL_CIRCUIT_FAIL_THRESHOLD,
  ConfigFingerprintTracker,
  computeConfigFingerprint,
  extractSignificantTargetUrl,
  evaluateTargetInfoChange,
};
