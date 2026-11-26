// Obsidian Prism 快捷方式 CDP 参数退避同步与无端口重启弹窗守卫（Tier 1）
import fs from 'node:fs';
import path from 'node:path';
import { discoverActivePort } from './constants.mjs';
import { isAutomatedTestRuntime } from './pid-lock.mjs';

export const relaunchGuardMethods = {
  _isRelaunchGuardAllowed() {
    if (this._relaunchHooks) return true;
    if (isAutomatedTestRuntime()) return false;
    if (process.env.PRISM_NO_RELAUNCH_PROMPT === '1') return false;
    if (this.overridePort) return false;
    return true;
  },

  _readDiskRawConfig() {
    try {
      const cfgPath = path.join(this.rootDir, 'config.json');
      if (!fs.existsSync(cfgPath)) return {};
      return JSON.parse(fs.readFileSync(cfgPath, 'utf8')) || {};
    } catch {
      return {};
    }
  },

  _resetShortcutBackoff(reason = '') {
    const hadBackoff = Boolean(this._shortcutAllClean || this._lastShortcutCheckAt > 0);
    this._shortcutAllClean = false;
    this._lastShortcutCheckAt = 0;
    if (reason && hadBackoff) {
      this.log(`[shortcut-guard] Reset shortcut backoff (${reason})`);
    }
  },

  _maybeSyncShortcuts(force = false, opts = null) {
    if (!this._isRelaunchGuardAllowed()) return null;
    if (process.env.PRISM_DISABLE_SHORTCUT_SYNC === '1' && !this._relaunchHooks?.syncShortcuts) return null;
    if (this._shortcutSyncInFlight) {
      if (force) this._shortcutForcePending = true;
      return null;
    }
    const now = Date.now();
    const hasActivePort =
      opts && typeof opts.hasActivePort === 'boolean' ? opts.hasActivePort : Boolean(this._hasActiveCdpPort);
    const effectiveIntervalMs =
      this._shortcutAllClean && hasActivePort
        ? this._shortcutBackoffIntervalMs
        : this.shortcutCheckIntervalMs;
    if (!force && this._lastShortcutCheckAt > 0 && now - this._lastShortcutCheckAt < effectiveIntervalMs) {
      return null;
    }
    const onDone = (res) => {
      if (res && !res.error) {
        this._lastShortcutCheckAt = Date.now();
        const patchedLen = Array.isArray(res.patched) ? res.patched.length : 0;
        const skippedLen = Array.isArray(res.skipped) ? res.skipped.length : 0;
        const alreadyLen = Array.isArray(res.alreadySet) ? res.alreadySet.length : 0;
        const matched = Number(res.matched || 0);
        // 全部快捷方式已确认 alreadySet 且无跳过/新修补时，开启智能退避（30~60 分钟）
        this._shortcutAllClean = patchedLen === 0 && skippedLen === 0 && (alreadyLen > 0 || matched === 0);
      } else {
        this._shortcutAllClean = false;
      }
      if (res && Array.isArray(res.patched) && res.patched.length > 0) {
        this.log(`[shortcut-guard] Ensured --remote-debugging-port=0 on ${res.patched.length} shortcut(s)`);
      }
      return res;
    };
    const onFinally = () => {
      this._shortcutSyncInFlight = false;
      if (this._shortcutForcePending && this.running) {
        this._shortcutForcePending = false;
        void this._maybeSyncShortcuts(true);
      }
    };
    try {
      if (typeof this._relaunchHooks?.syncShortcuts === 'function') {
        const res = this._relaunchHooks.syncShortcuts({ pluginDir: this.rootDir });
        if (res && typeof res.then === 'function') {
          this._shortcutSyncInFlight = true;
          return res.then(onDone).catch(() => null).finally(onFinally);
        }
        return onDone(res);
      }
      if (typeof this.cdp.ensureAntigravityShortcutsCdpFlagAsync === 'function') {
        this._shortcutSyncInFlight = true;
        return this.cdp
          .ensureAntigravityShortcutsCdpFlagAsync({ pluginDir: this.rootDir })
          .then(onDone)
          .catch(() => null)
          .finally(onFinally);
      }
      if (typeof this.cdp.ensureAntigravityShortcutsCdpFlag === 'function') {
        return onDone(this.cdp.ensureAntigravityShortcutsCdpFlag({ pluginDir: this.rootDir }));
      }
      return null;
    } catch {
      this._shortcutSyncInFlight = false;
      return null;
    }
  },

  async _handleMissingCdpPort() {
    this._hasActiveCdpPort = false;
    this._shortcutAllClean = false;
    if (!this.running || !this.timer || this._promptInFlight) return;
    if (!this._isRelaunchGuardAllowed()) return;

    const now = Date.now();
    if (this._noPortSinceMs <= 0) {
      this._noPortSinceMs = now;
    }
    this._maybeSyncShortcuts(false, { hasActivePort: false });

    if (now - this._noPortSinceMs < this.noPortRelaunchThresholdMs) {
      return;
    }

    const rawCfg = this._readDiskRawConfig();
    if (rawCfg.autoPromptCdpRelaunch === false) {
      return;
    }

    const detectFn =
      typeof this._relaunchHooks?.detectHost === 'function'
        ? this._relaunchHooks.detectHost
        : typeof this.cdp.detectRunningAntigravityHost === 'function'
        ? () => this.cdp.detectRunningAntigravityHost()
        : null;
    if (!detectFn) return;

    const host = await detectFn();
    if (!this.running) return;
    if (!host || !host.pid) {
      this._noPortSinceMs = Date.now();
      return;
    }

    if (host.pid !== this._lastObservedHostPid) {
      this._lastObservedHostPid = host.pid;
      this._shortcutAllClean = false;
      this._maybeSyncShortcuts(true);
    }

    if (host.hasDebugPortSwitch) {
      return;
    }

    const hostAgeMs = host.startMs > 0 ? Math.max(0, Date.now() - host.startMs) : now - this._noPortSinceMs;
    if (hostAgeMs < this.noPortRelaunchThresholdMs) {
      return;
    }

    const extraDirs = Array.isArray(this._relaunchHooks?.stateExtraDirs) ? this._relaunchHooks.stateExtraDirs : [];
    const alreadyPrompted =
      typeof this.cdp.hasRelaunchBeenPromptedForHost === 'function'
        ? this.cdp.hasRelaunchBeenPromptedForHost(this.rootDir, host.pid, host.startMs, extraDirs)
        : false;
    if (alreadyPrompted) {
      return;
    }

    this._promptInFlight = true;
    try {
      if (typeof this.cdp.recordRelaunchPromptState === 'function') {
        this.cdp.recordRelaunchPromptState(this.rootDir, host.pid, host.startMs, 'prompted', extraDirs);
      }
      this.log(`[relaunch-guard] Host pid=${host.pid} running without CDP port; prompting user once`);
      const lang = rawCfg.language || rawCfg.lang || 'auto';
      const promptFn =
        typeof this._relaunchHooks?.promptUser === 'function'
          ? this._relaunchHooks.promptUser
          : typeof this.cdp.promptUserForHostRelaunch === 'function'
          ? (o) => this.cdp.promptUserForHostRelaunch(o)
          : async () => false;
      const confirmed = await promptFn({ lang, host });
      if (!this.running) return;
      if (!confirmed) {
        if (typeof this.cdp.recordRelaunchPromptState === 'function') {
          this.cdp.recordRelaunchPromptState(this.rootDir, host.pid, host.startMs, 'no', extraDirs);
        }
        this.log(`[relaunch-guard] User declined immediate relaunch for pid=${host.pid}; shortcuts ready for next launch`);
        return;
      }
      // 二次复核：若用户在等待点击期间已自行重开带参实例，则直接挂载不再重复重启
      const portNow = discoverActivePort(this.overridePort, this.portFile);
      if (portNow) {
        this._noPortSinceMs = 0;
        return;
      }
      if (typeof this.cdp.recordRelaunchPromptState === 'function') {
        this.cdp.recordRelaunchPromptState(this.rootDir, host.pid, host.startMs, 'yes', extraDirs);
      }
      const spawnFn =
        typeof this._relaunchHooks?.spawnRelaunch === 'function'
          ? this._relaunchHooks.spawnRelaunch
          : typeof this.cdp.spawnDetachedHostRelaunchHelper === 'function'
          ? (t) => this.cdp.spawnDetachedHostRelaunchHelper(t)
          : () => ({ spawned: false });
      const spawnRes = await spawnFn({
        hostPid: host.pid,
        exePath: host.exePath || '',
        pluginDir: this.rootDir,
      });
      this.log(
        `[relaunch-guard] Triggered detached relaunch helper for pid=${host.pid} (spawned=${Boolean(spawnRes?.spawned)}, method=${spawnRes?.method || 'custom'})`
      );
    } finally {
      this._promptInFlight = false;
    }
  },
};
