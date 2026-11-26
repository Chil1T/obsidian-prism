// Obsidian Prism 更新检查、Git 热更协调与 Repo Action 统一分发（Tier 1）
import fs from 'node:fs';
import path from 'node:path';
import { isBlockedUncPath } from '../../vendor/omni-viewer/omni-server.mjs';
import { RELEASES_PAGE_URL } from '../../sidecars/daemon/update-service.mjs';
import { sanitizeSecretText } from '../../sidecars/daemon/redact.mjs';
import { copyUpdatedRuntimeFromRepo } from '../platform/repo-sync.mjs';
import { PKG_VERSION } from './constants.mjs';
import { execGit, sanitizeGitRemoteUrl } from './fs-atomic.mjs';

export const repoUpdateMethods = {
  resolveGitRepoDir() {
    const candidates = [];
    if (this.gitRepoDir) candidates.push(this.gitRepoDir);
    candidates.push(this.rootDir);

    const repoMetaPath = path.join(this.rootDir, 'repo-meta.json');
    if (fs.existsSync(repoMetaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(repoMetaPath, 'utf8'));
        if (meta && meta.sourceRepoDir) {
          const src = path.resolve(meta.sourceRepoDir);
          candidates.push(src);
          const parent = path.dirname(src);
          candidates.push(path.join(parent, 'obsidian-prism'));
        }
      } catch {}
    }

    for (const cand of candidates) {
      try {
        if (cand && fs.existsSync(path.join(cand, '.git'))) {
          return cand;
        }
      } catch {}
    }
    return null;
  },

  _getAutoUpdateSetting() {
    try {
      const cfg = typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null;
      return cfg?.autoUpdate === 'on' ? 'on' : 'off';
    } catch {
      return 'off';
    }
  },

  async _inspectGitRepoState({ fetchRemote = false } = {}) {
    const repoDir = this.resolveGitRepoDir();
    if (!repoDir) {
      return {
        isGitRepo: false,
        repoDir: null,
        repoPath: path.basename(this.rootDir),
        branch: 'standalone',
        commit: this.cdp.PLUGIN_VERSION,
        dirty: false,
        remoteName: '',
        remoteUrl: '',
        hasRemote: false,
        noRemote: true,
        ahead: 0,
        behind: 0,
        netGitCfg: [],
        blockedUnc: false,
      };
    }

    let branch = 'HEAD';
    let commit = '';
    let dirty = false;
    let remoteName = '';
    let remoteUrl = '';

    try {
      branch = (await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir, 5000)) || 'HEAD';
    } catch {
      branch = 'main';
    }
    try {
      commit = await execGit(['rev-parse', '--short', 'HEAD'], repoDir, 5000);
    } catch {
      commit = 'uncommitted';
    }
    try {
      const porcelain = await execGit(['status', '--porcelain'], repoDir, 5000);
      dirty = Boolean(porcelain.trim());
    } catch {}

    let isNetworkRemote = false;
    let blockedUnc = false;
    try {
      const remotesRaw = await execGit(['remote'], repoDir, 4000);
      const remotes = remotesRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (remotes.length > 0) {
        remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
        const rawRemoteUrl = await execGit(['remote', 'get-url', remoteName], repoDir, 4000).catch(() => '');
        if (rawRemoteUrl && isBlockedUncPath(rawRemoteUrl)) {
          blockedUnc = true;
        } else {
          isNetworkRemote = /^(?:https?|ssh|git):\/\/|^[^/\\:\s]+@[^/\\:\s]+:/i.test(rawRemoteUrl);
          remoteUrl = sanitizeGitRemoteUrl(rawRemoteUrl);
        }
      }
    } catch {}

    const netGitCfg = isNetworkRemote ? ['-c', 'protocol.file.allow=never'] : [];
    const safeRepoName = path.basename(repoDir);
    const hasRemote = Boolean(!blockedUnc && remoteName && remoteUrl);

    let ahead = 0;
    let behind = 0;
    if (hasRemote) {
      if (fetchRemote) {
        try {
          await execGit(['fetch', '--quiet', '--no-recurse-submodules', remoteName], repoDir, 8000, netGitCfg);
        } catch {}
      }
      try {
        const targetRef = branch && branch !== 'HEAD' ? `${remoteName}/${branch}` : '@{u}';
        const counts = await execGit(['rev-list', '--left-right', '--count', `HEAD...${targetRef}`], repoDir, 5000);
        const parts = counts.split(/\s+/).map((x) => parseInt(x, 10));
        if (Number.isInteger(parts[0])) ahead = parts[0];
        if (Number.isInteger(parts[1])) behind = parts[1];
      } catch {}
    }

    return {
      isGitRepo: true,
      repoDir,
      repoPath: safeRepoName,
      branch,
      commit,
      dirty,
      remoteName,
      remoteUrl,
      hasRemote,
      noRemote: !hasRemote,
      ahead,
      behind,
      netGitCfg,
      blockedUnc,
    };
  },

  async _executeGitPullHotReload(gitState, actionName = 'pull') {
    const { repoDir, repoPath, branch, commit: prevCommit, dirty, remoteName, remoteUrl, netGitCfg } = gitState;
    try {
      const prevFullSha = await execGit(['rev-parse', 'HEAD'], repoDir, 5000).catch(() => '');
      const pullArgs =
        branch && branch !== 'HEAD'
          ? ['pull', '--ff-only', '--no-recurse-submodules', remoteName, branch]
          : ['pull', '--ff-only', '--no-recurse-submodules'];
      const pullOut = await execGit(pullArgs, repoDir, 15000, netGitCfg);
      const nextCommit = await execGit(['rev-parse', '--short', 'HEAD'], repoDir, 5000).catch(() => prevCommit);
      const nextFullSha = await execGit(['rev-parse', 'HEAD'], repoDir, 5000).catch(() => prevFullSha);
      const updated = Boolean(nextCommit && nextCommit !== prevCommit);

      let changedFiles = [];
      if (prevFullSha && nextFullSha && prevFullSha !== nextFullSha) {
        try {
          const diffOut = await execGit(['diff', '--name-only', `${prevFullSha}..${nextFullSha}`], repoDir, 5000);
          changedFiles = diffOut.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        } catch {}
      }
      const needsHardReload = changedFiles.some((f) => /^(?:sidecars\/|src\/daemon\/|installer\/|cdp\.js$)/.test(f));

      let hotReloaded = false;
      if (updated) {
        copyUpdatedRuntimeFromRepo(repoDir, this.rootDir, this.cdp.SYNC_ROOT_FILES);
      }
      this.rebuildBundle({ forceReloadCdp: updated });
      const activeItems = [...this.sessions.values()].filter((item) => item && !item.session.closed);
      if (activeItems.length > 0) {
        await Promise.allSettled(activeItems.map((item) => this.applyToEntry(item)));
        hotReloaded = true;
      }

      return {
        ok: true,
        action: actionName,
        isGitRepo: true,
        repoPath,
        branch,
        prevCommit,
        commit: nextCommit,
        shortHash: nextCommit,
        dirty,
        remoteName,
        remoteUrl,
        hasRemote: true,
        noRemote: false,
        ahead: 0,
        behind: 0,
        hasUpdates: false,
        upToDate: true,
        updated,
        hotReloaded,
        needsHardReload,
        needsHardReloadHint: needsHardReload,
        changedFiles,
        version: this.cdp.PLUGIN_VERSION,
        message: sanitizeSecretText(pullOut || (updated ? `Updated ${prevCommit} -> ${nextCommit}` : 'Already up to date')),
      };
    } catch (err) {
      const safeErr = sanitizeSecretText(err?.message || 'git pull --ff-only failed');
      return {
        ok: false,
        action: actionName,
        isGitRepo: true,
        repoPath,
        branch,
        commit: prevCommit,
        shortHash: prevCommit,
        dirty,
        remoteName,
        remoteUrl,
        hasRemote: true,
        noRemote: false,
        updated: false,
        version: this.cdp.PLUGIN_VERSION,
        error: safeErr,
        message: safeErr,
      };
    }
  },

  _getUpdateChannelSetting(cfgOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.();
      return cfg?.updateChannel === 'beta' ? 'beta' : 'stable';
    } catch {
      return 'stable';
    }
  },

  _syncUpdateServiceChannel(cfgOverride = null) {
    const ch = this._getUpdateChannelSetting(cfgOverride);
    let changed = false;
    if (typeof this.updateService?.setChannel === 'function') {
      changed = Boolean(this.updateService.setChannel(ch));
    } else if (this.updateService && typeof this.updateService === 'object' && this.updateService.channel !== ch) {
      this.updateService.channel = ch;
      changed = true;
    }
    if (changed) {
      this._lastUpdateState = null;
    }
    return { channel: ch, changed };
  },

  _extractExplicitUpdateChannel(rawInput) {
    if (!rawInput || typeof rawInput !== 'object') return null;
    const candidates = [
      rawInput.channel,
      rawInput.updateChannel,
      rawInput.version && typeof rawInput.version === 'object' ? rawInput.version.channel : undefined,
      rawInput.version && typeof rawInput.version === 'object' ? rawInput.version.updateChannel : undefined,
      rawInput.input && typeof rawInput.input === 'object' ? rawInput.input.channel : undefined,
      rawInput.input && typeof rawInput.input === 'object' ? rawInput.input.updateChannel : undefined,
      rawInput.payload && typeof rawInput.payload === 'object' ? rawInput.payload.channel : undefined,
      rawInput.payload && typeof rawInput.payload === 'object' ? rawInput.payload.updateChannel : undefined,
    ];
    for (const c of candidates) {
      if (c === 'stable' || c === 'beta') return c;
    }
    return null;
  },

  _buildCombinedUpdateStatus({ relState = null, gitState = null, action = 'update-status', channelOverride = null } = {}) {
    const currentVersion = this.cdp?.PLUGIN_VERSION || this.updateService?.currentVersion || PKG_VERSION;
    const rel = relState || this.updateService?.getStatus?.() || {};
    const autoUpdate = this._getAutoUpdateSetting();
    const explicitChannel = channelOverride === 'beta' || channelOverride === 'stable' ? channelOverride : null;
    const updateChannel = explicitChannel || this._getUpdateChannelSetting();
    const channel =
      explicitChannel ||
      (rel.channel === 'beta' || rel.channel === 'stable' ? rel.channel : updateChannel);
    const isGitRemote = Boolean(gitState?.hasRemote);
    const isPrerelease = isGitRemote ? false : Boolean(rel.isPrerelease);
    const gitHasUpdate = Boolean(isGitRemote && gitState.behind > 0);
    const relHasUpdate = Boolean(rel.hasUpdate);
    const hasUpdate = gitHasUpdate || relHasUpdate;
    const mode = isGitRemote ? 'git' : rel.mode || (process.platform === 'win32' ? 'installer' : 'manual');
    const hotReloadCapable = isGitRemote ? true : Boolean(rel.hotReloadCapable);
    const manualRequired = isGitRemote ? false : Boolean(rel.manualRequired);
    return {
      ok: true,
      action,
      channel,
      updateChannel,
      isPrerelease,
      currentVersion,
      latestVersion: rel.latestVersion || currentVersion,
      latestTag: rel.latestTag || null,
      hasUpdate,
      autoUpdate,
      mode,
      hotReloadCapable,
      manualRequired,
      releaseUrl: rel.releaseUrl || RELEASES_PAGE_URL,
      downloadUrl: rel.downloadUrl || null,
      checkedAt: rel.checkedAt || (isGitRemote ? Date.now() : null),
      applying: Boolean(this.updateService?.applying),
      lastError: rel.lastError || rel.error || null,
      isGitRepo: Boolean(gitState?.isGitRepo),
      hasRemote: isGitRemote,
      behind: Number(gitState?.behind || 0),
      branch: gitState?.branch || 'standalone',
      commit: gitState?.commit || currentVersion,
    };
  },

  async runUpdateCheck({ force = false, manual = false, allowAutoApply = false, channel = null } = {}) {
    const explicitChannel = channel === 'beta' || channel === 'stable' ? channel : null;
    const { channel: activeChannel, changed: channelChanged } = explicitChannel
      ? this._syncUpdateServiceChannel({ updateChannel: explicitChannel })
      : this._syncUpdateServiceChannel();
    const effectiveForce = Boolean(force || channelChanged);
    if (this._updateCheckInFlight && !channelChanged && this._updateCheckInFlightChannel === activeChannel) {
      return this._updateCheckInFlight;
    }
    const run = async () => {
      try {
        const gitState = await this._inspectGitRepoState({ fetchRemote: true });
        let relState = null;
        try {
          relState = await this.updateService.checkForUpdates({
            force: effectiveForce,
            manual,
            channel: activeChannel,
          });
        } catch (err) {
          relState = {
            ...(this.updateService?.getStatus?.() || {}),
            channel: activeChannel,
            ok: false,
            lastError: String(err?.message || err || 'check_failed'),
          };
        }
        const combined = this._buildCombinedUpdateStatus({
          relState,
          gitState,
          action: manual ? 'check-update' : 'update-status',
          channelOverride: activeChannel,
        });
        const svcChannel = this.updateService?.channel;
        const channelStillCurrent = !svcChannel || svcChannel === activeChannel;
        if (channelStillCurrent && (this._getUpdateChannelSetting() === activeChannel || explicitChannel !== null)) {
          this._lastUpdateState = combined;
        }

        if (channelStillCurrent && allowAutoApply && this._getAutoUpdateSetting() === 'on' && combined.hasUpdate) {
          if (gitState.hasRemote && gitState.behind > 0) {
            const pullRes = await this._executeGitPullHotReload(gitState, 'apply-update');
            this._lastUpdateState = {
              ...combined,
              hasUpdate: false,
              behind: 0,
              commit: pullRes.commit || combined.commit,
              lastAutoApply: pullRes,
            };
          } else if (!gitState.hasRemote && relState?.hasUpdate) {
            const applyRes = await this.updateService.applyReleaseUpdate({ confirm: true, auto: true });
            this._lastUpdateState = {
              ...combined,
              lastError: applyRes.ok ? null : applyRes.error || combined.lastError,
              lastAutoApply: applyRes,
            };
          }
        }
        return channelStillCurrent ? this._lastUpdateState || combined : combined;
      } finally {
        if (this._updateCheckInFlight === p) {
          this._updateCheckInFlight = null;
          this._updateCheckInFlightChannel = null;
        }
      }
    };
    const p = run();
    this._updateCheckInFlight = p;
    this._updateCheckInFlightChannel = activeChannel;
    return p;
  },

  async executeRepoAction(rawInput = {}, secondArg = undefined) {
    if (typeof rawInput === 'string') {
      const extra =
        secondArg && typeof secondArg === 'object' && !Array.isArray(secondArg)
          ? secondArg
          : typeof secondArg === 'string'
            ? { version: secondArg }
            : {};
      rawInput = { ...extra, action: rawInput };
    }
    if (
      rawInput?.action === 'storage-health' ||
      rawInput?.action === 'storage-detail' ||
      rawInput?.action === 'prepare-archive' ||
      rawInput?.action === 'prepare-restore' ||
      rawInput?.action === 'archive-and-restart'
    ) {
      return this._handleStorageAction(rawInput.action, rawInput?._testOverrides || null, rawInput);
    }
    if (rawInput?.action === 'restore-archive') {
      return this._handleRestoreArchiveAction(rawInput, rawInput?._testOverrides || null);
    }
    if (rawInput?.action === 'storage-snooze') {
      return this._handleStorageSnoozeAction(rawInput);
    }
    if (rawInput?.action === 'storage-auto-exit') {
      const enabled = rawInput?.autoArchiveOnExit === true || rawInput?.value === true || rawInput?.value === 'on';
      const updated = this.updateConfigSetting('autoArchiveOnExit', enabled);
      if (updated) {
        this._storageHealthCache = null;
        this._storageHealthAt = 0;
        await this.broadcastConfigRefresh().catch(() => {});
      }
      return { ok: Boolean(updated), action: 'storage-auto-exit', autoArchiveOnExit: enabled };
    }
    if (
      rawInput?.action === 'gomemlimit-status' ||
      rawInput?.action === 'gomemlimit-set' ||
      rawInput?.action === 'gomemlimit-clear'
    ) {
      return this._handleGoMemLimitAction(rawInput.action, rawInput);
    }
    if (rawInput?.action === 'uninstall') {
      return this._handleUninstallAction(rawInput);
    }
    if (
      rawInput?.action === 'addons-list' ||
      rawInput?.action === 'addons-status' ||
      rawInput?.action === 'addons-install' ||
      rawInput?.action === 'addons-remove'
    ) {
      return this._handleAddonsAction(rawInput.action, rawInput);
    }
    if (rawInput?.action === 'update-status') {
      const explicitChannel = this._extractExplicitUpdateChannel(rawInput);
      const { channel, changed } = explicitChannel
        ? this._syncUpdateServiceChannel({ updateChannel: explicitChannel })
        : this._syncUpdateServiceChannel();
      const gitState = await this._inspectGitRepoState({ fetchRemote: false });
      const relState = this.updateService?.getStatus?.() || null;
      const hasFreshCached = Boolean(
        this._lastUpdateState &&
          !changed &&
          this._lastUpdateState.channel === channel &&
          this._lastUpdateState.checkedAt
      );
      if (hasFreshCached) {
        return {
          ...this._lastUpdateState,
          action: 'update-status',
          channel,
          updateChannel: channel,
          checking: false,
          autoUpdate: this._getAutoUpdateSetting(),
          applying: Boolean(this.updateService?.applying),
        };
      }
      const baseState = this._buildCombinedUpdateStatus({
        relState,
        gitState,
        action: 'update-status',
        channelOverride: channel,
      });
      const shouldAwaitFreshCheck = changed || (explicitChannel !== null && !baseState.checkedAt);
      if (shouldAwaitFreshCheck) {
        const rawWait = Number(rawInput?.waitTimeoutMs);
        const waitMs = Number.isFinite(rawWait) && rawWait >= 0 ? Math.min(10000, rawWait) : 2500;
        const checkPromise = this.runUpdateCheck({
          force: changed,
          manual: false,
          allowAutoApply: false,
          channel,
        });
        let timedOut = false;
        let timer = null;
        const settled = await Promise.race([
          checkPromise.then((res) => ({ done: true, res })).catch(() => ({ done: false, res: null })),
          new Promise((resolve) => {
            timer = setTimeout(() => {
              timedOut = true;
              resolve({ done: false, res: null });
            }, waitMs);
            if (typeof timer.unref === 'function') timer.unref();
          }),
        ]);
        if (timer) clearTimeout(timer);
        if (settled?.done && settled.res && settled.res.channel === channel) {
          return {
            ...settled.res,
            action: 'update-status',
            channel,
            updateChannel: channel,
            checking: false,
            autoUpdate: this._getAutoUpdateSetting(),
            applying: Boolean(this.updateService?.applying),
          };
        }
        return {
          ...baseState,
          action: 'update-status',
          channel,
          updateChannel: channel,
          checking: Boolean(
            timedOut || (this._updateCheckInFlight && this._updateCheckInFlightChannel === channel)
          ),
        };
      }
      if (!baseState.checkedAt && this._getAutoUpdateSetting() === 'on') {
        void this.runUpdateCheck({ force: false, manual: false, allowAutoApply: false, channel }).catch(() => {});
        return { ...baseState, checking: true };
      }
      return { ...baseState, checking: false };
    }
    if (rawInput?.action === 'check-update') {
      const explicitChannel = this._extractExplicitUpdateChannel(rawInput);
      const res = await this.runUpdateCheck({
        force: rawInput?.force !== false,
        manual: Boolean(rawInput?.manual),
        allowAutoApply: false,
        channel: explicitChannel,
      });
      return { ...res, action: 'check-update' };
    }
    if (rawInput?.action === 'apply-update') {
      if (rawInput?.confirm !== true) {
        return { ok: false, action: 'apply-update', error: 'confirmation_required' };
      }
      const explicitChannel = this._extractExplicitUpdateChannel(rawInput);
      const { channel } = explicitChannel
        ? this._syncUpdateServiceChannel({ updateChannel: explicitChannel })
        : this._syncUpdateServiceChannel();
      const gitState = await this._inspectGitRepoState({ fetchRemote: false });
      if (gitState.blockedUnc) {
        return { ok: false, action: 'apply-update', error: 'Remote UNC Git paths are blocked' };
      }
      if (gitState.hasRemote) {
        const pullRes = await this._executeGitPullHotReload(gitState, 'apply-update');
        return {
          ...pullRes,
          channel,
          mode: 'git',
          hotReloadCapable: true,
          targetVersion: pullRes.commit,
        };
      }
      const applyRes = await this.updateService.applyReleaseUpdate({ confirm: true, auto: false });
      return {
        ...applyRes,
        action: 'apply-update',
        channel,
        currentVersion: this.cdp?.PLUGIN_VERSION || this.updateService?.currentVersion || PKG_VERSION,
      };
    }

    const action = rawInput?.action === 'pull' || rawInput?.action === 'sync' ? 'pull' : 'status';
    const gitState = await this._inspectGitRepoState({ fetchRemote: action === 'status' });
    if (!gitState.isGitRepo) {
      return {
        ok: true,
        action,
        isGitRepo: false,
        repoPath: path.basename(this.rootDir),
        branch: 'standalone',
        commit: this.cdp.PLUGIN_VERSION,
        shortHash: this.cdp.PLUGIN_VERSION,
        dirty: false,
        remoteUrl: '',
        hasRemote: false,
        noRemote: true,
        ahead: 0,
        behind: 0,
        hasUpdates: false,
        upToDate: true,
        updated: false,
        version: this.cdp.PLUGIN_VERSION,
        message: 'Installed standalone plugin (no linked Git repository)',
      };
    }
    if (gitState.blockedUnc) {
      return {
        ok: false,
        action,
        isGitRepo: true,
        repoPath: gitState.repoPath,
        branch: gitState.branch,
        commit: gitState.commit,
        shortHash: gitState.commit,
        dirty: gitState.dirty,
        error: 'Remote UNC Git paths are blocked',
        message: 'Remote UNC Git paths are blocked',
      };
    }
    if (!gitState.hasRemote) {
      return {
        ok: true,
        action,
        isGitRepo: true,
        repoPath: gitState.repoPath,
        branch: gitState.branch,
        commit: gitState.commit,
        shortHash: gitState.commit,
        dirty: gitState.dirty,
        remoteName: '',
        remoteUrl: '',
        hasRemote: false,
        noRemote: true,
        ahead: 0,
        behind: 0,
        hasUpdates: false,
        upToDate: true,
        updated: false,
        version: this.cdp.PLUGIN_VERSION,
        message: 'Local Git repository (no remote configured)',
      };
    }
    if (action === 'status') {
      return {
        ok: true,
        action: 'status',
        isGitRepo: true,
        repoPath: gitState.repoPath,
        branch: gitState.branch,
        commit: gitState.commit,
        shortHash: gitState.commit,
        dirty: gitState.dirty,
        remoteName: gitState.remoteName,
        remoteUrl: gitState.remoteUrl,
        hasRemote: true,
        noRemote: false,
        ahead: gitState.ahead,
        behind: gitState.behind,
        hasUpdates: gitState.behind > 0,
        upToDate: gitState.behind === 0,
        updated: false,
        version: this.cdp.PLUGIN_VERSION,
        message: gitState.behind > 0 ? `${gitState.behind} commit(s) available from ${gitState.remoteName}` : 'Already up to date',
      };
    }
    return this._executeGitPullHotReload(gitState, 'pull');
  },
};
