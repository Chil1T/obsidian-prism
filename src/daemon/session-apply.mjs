// Obsidian Prism 窗口会话附着、主帧追踪、Ch1/多通道初次注入与连接池拆卸（Tier 2）
import { OMNI_BINDING } from '../../vendor/omni-viewer/omni-server.mjs';
import {
  METRICS_BINDING,
  REPO_BINDING,
  THOUGHT_BINDING,
  USAGE_BINDING,
  INLINE_DIFF_BINDING,
  SIDEBAR_BINDING,
  isEligibleTarget,
} from './constants.mjs';
import {
  ENTRY_FSM_STATES,
  ensureEntryFsm,
  transitionEntryState,
  recordEntryCh1Outcome,
  onEntryDomReadySignal,
  resetEntryForNewDocument,
  recordChannelSuccess,
  recordChannelSkipped,
  recordChannelOff,
  recordChannelFailure,
} from './session-fsm.mjs';

export const sessionApplyMethods = {
  _runEntryExclusive(entry, fn) {
    if (!entry) return Promise.resolve();
    const prev = entry._opChain || Promise.resolve();
    const next = prev.then(() => fn(), () => fn());
    entry._opChain = next.catch(() => {});
    return next;
  },

  _hasMainDefaultContext(entry) {
    if (!entry?.mainFrameId || !(entry.contextFrames instanceof Map)) return false;
    for (const meta of entry.contextFrames.values()) {
      if (meta && meta.isDefault === true && (!meta.type || meta.type === 'default') && meta.frameId === entry.mainFrameId) {
        return true;
      }
    }
    return false;
  },

  _findCurrentMainDefaultContextId(entry) {
    if (!entry?.contextFrames || !entry.mainFrameId) return null;
    let found = null;
    for (const [id, meta] of entry.contextFrames.entries()) {
      if (
        meta &&
        meta.isDefault === true &&
        meta.type === 'default' &&
        meta.frameId === entry.mainFrameId &&
        (typeof meta.docGen !== 'number' || meta.docGen === entry.sidebarDocument)
      ) {
        found = id;
      }
    }
    return found;
  },

  _markSidebarHostVerified(entry, expectedDoc, ok) {
    if (!entry || expectedDoc !== entry.sidebarDocument) return;
    if (ok) {
      entry.sidebarHostVerified = true;
      entry.sidebarVerifiedDocument = expectedDoc;
      entry.sidebarHostContextId = this._findCurrentMainDefaultContextId(entry);
    } else {
      entry.sidebarHostVerified = false;
      entry.sidebarVerifiedDocument = -1;
      entry.sidebarHostContextId = null;
    }
  },

  async _ensureMainFrameId(entry, timeoutMs = 4000, retries = 0) {
    if (!entry || entry.session?.closed) return null;
    if (typeof entry.mainFrameId === 'string' && entry.mainFrameId) return entry.mainFrameId;
    if (entry._mainFrameInFlight) return entry._mainFrameInFlight;
    const maxAttempts = Math.max(1, (Number(retries) | 0) + 1);
    const task = (async () => {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (entry.session?.closed) return null;
        if (typeof entry.mainFrameId === 'string' && entry.mainFrameId) return entry.mainFrameId;
        const ft = await entry.session.send('Page.getFrameTree', {}, timeoutMs).catch(() => null);
        const topFrameId = ft?.frameTree?.frame?.id;
        if (typeof topFrameId === 'string' && topFrameId) {
          entry.mainFrameId = topFrameId;
          entry.hasFrameTree = true;
          if (entry.sidebarHostVerified === true && entry.sidebarHostContextId == null) {
            entry.sidebarHostContextId = this._findCurrentMainDefaultContextId(entry);
          }
          return topFrameId;
        }
      }
      return typeof entry.mainFrameId === 'string' && entry.mainFrameId ? entry.mainFrameId : null;
    })();
    entry._mainFrameInFlight = task;
    try {
      return await task;
    } finally {
      if (entry._mainFrameInFlight === task) entry._mainFrameInFlight = null;
    }
  },

  _targetKey(target) {
    if (!target || typeof target !== 'object') return '';
    return String(target.id || target.targetId || target.webSocketDebuggerUrl || '').trim();
  },

  _normalizeIgnoreUrl(rawUrl) {
    const s = String(rawUrl || '').trim();
    if (!s) return '';
    try {
      const u = new URL(s);
      return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname}`;
    } catch {
      return s.split(/[?#]/)[0].toLowerCase();
    }
  },

  _markTargetIgnored(target, urlOverride = '') {
    const key = this._targetKey(target);
    if (!key) return;
    const normUrl = this._normalizeIgnoreUrl(urlOverride || target?.url || '');
    if (this.ignoredTargets.has(key)) {
      this.ignoredTargets.delete(key);
    } else if (this.ignoredTargets.size >= 256) {
      const oldest = this.ignoredTargets.keys().next().value;
      if (oldest !== undefined) this.ignoredTargets.delete(oldest);
    }
    this.ignoredTargets.set(key, normUrl);
  },

  isTargetIgnored(target) {
    const key = this._targetKey(target);
    if (!key || !this.ignoredTargets.has(key)) return false;
    const prevNorm = this.ignoredTargets.get(key);
    const curNorm = this._normalizeIgnoreUrl(target?.url || '');
    if (curNorm && prevNorm && curNorm !== prevNorm) {
      this.ignoredTargets.delete(key);
      return false;
    }
    return true;
  },

  _isEligibleDaemonTarget(target) {
    const checkFn = typeof this.cdp?.isEligibleTarget === 'function' ? this.cdp.isEligibleTarget : isEligibleTarget;
    if (!checkFn(target)) return false;
    return !this.isTargetIgnored(target);
  },

  async applyToEntry(entry) {
    return this._runEntryExclusive(entry, async () => {
      if (!entry || entry.session.closed) return null;
      ensureEntryFsm(entry);
      transitionEntryState(entry, ENTRY_FSM_STATES.INJECTING_CH1, 'applyToEntry');
      const readCfg = () => (typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null);
      let cfgSeq = this._configSeq;
      let cfg = readCfg();
      const getCurrentCfg = () => {
        if (this._configSeq !== cfgSeq) {
          cfgSeq = this._configSeq;
          cfg = readCfg();
        }
        return cfg;
      };
      const omniEnabledInit = this._isOmniEnabled(cfg);
      if (omniEnabledInit) await this.ensureOmniServer().catch(() => null);
      const sidebarEnabledInit = this._isSidebarStudioEnabled(cfg);
      if (sidebarEnabledInit) await this.ensureSidebarService().catch(() => null);

      if (!this.injectExpr) {
        this.rebuildBundle();
      } else {
        const curCfg = getCurrentCfg();
        const chOpts = this._getChannelCacheOpts(true);
        let usedChCache = false;
        if (!omniEnabledInit) {
          this.omniExpr = '';
        } else if (this.omniServer && !this.omniExpr && typeof this.cdp.buildOmniClientExpression === 'function') {
          this.omniExpr = chOpts
            ? this.cdp.buildOmniClientExpression(this.omniServer.getServerInfo(), null, chOpts)
            : this.cdp.buildOmniClientExpression(this.omniServer.getServerInfo());
          if (chOpts) usedChCache = true;
        }
        if (sidebarEnabledInit && !this.sidebarExpr && typeof this.cdp.buildSidebarStudioExpression === 'function') {
          this.sidebarExpr = this._buildSidebarExprForCurrentClient(chOpts);
          if (chOpts) usedChCache = true;
        }
        if (!this.hostI18nExpr && this._isHostI18nEnabled(curCfg) && typeof this.cdp.buildHostI18nExpression === 'function') {
          this.hostI18nExpr = chOpts
            ? this.cdp.buildHostI18nExpression(curCfg, null, chOpts)
            : this.cdp.buildHostI18nExpression(curCfg);
          if (chOpts) usedChCache = true;
        }
        if (!this.thoughtExpr && this._isThoughtEnabled(curCfg) && typeof this.cdp.buildThoughtExpression === 'function') {
          this._buildThoughtExprForConfig(curCfg, chOpts);
          if (chOpts) usedChCache = true;
        }
        if (!this.inlineDiffExpr && typeof this.cdp.buildInlineDiffInjectExpression === 'function') {
          this._buildInlineDiffExprForConfig(curCfg, chOpts);
          if (chOpts && this.inlineDiffExpr) usedChCache = true;
        }
        if (!this.wallpaperExpr && typeof this.cdp.buildWallpaperExpression === 'function') {
          this._buildWallpaperExprForConfig(curCfg, chOpts);
          if (chOpts && this.wallpaperExpr) usedChCache = true;
        }
        if (!this.periodicPickerExpr && this._hasPeriodicPickerFile() && this._isPeriodicPickerEnabled(curCfg) && typeof this.cdp.buildPeriodicPickerExpression === 'function') {
          this._buildPeriodicPickerExprForConfig(curCfg, chOpts);
          if (chOpts && this.periodicPickerExpr) usedChCache = true;
        }
        if (!this.suggesterExpr && typeof this.cdp.buildSuggesterExpression === 'function') {
          this._buildSuggesterExprForConfig(curCfg, chOpts);
          if (chOpts && this.suggesterExpr) usedChCache = true;
        }
        if (!this.homeStudioExpr && this._hasHomeStudioFile() && this._isHomeStudioEnabled(curCfg) && typeof this.cdp.buildHomeStudioChannelExpression === 'function') {
          this._buildHomeStudioExprForConfig(curCfg, chOpts);
          if (chOpts && this.homeStudioExpr) usedChCache = true;
        }
        if (usedChCache && this.running) this._scheduleBundleCacheFlush();
      }

      await this._replaceEntryNewDocScript(entry, 'scriptId', this.injectExpr);
      const sidebarDocument = entry.sidebarDocument;
      const mainRes = await entry.session.evaluate(this.injectExpr);
      this._markSidebarHostVerified(entry, sidebarDocument, mainRes?.status === 'ok');
      const ch1Outcome = recordEntryCh1Outcome(entry, mainRes, sidebarDocument);

      if (mainRes && mainRes.status === 'skipped-non-host') {
        await this._teardownAllEntryChannelScripts(entry, entry.session, {
          markSkippedNonHost: true,
          resetMascot: false,
          resetHomeStudio: true,
        });
        return mainRes;
      }

      // 页面处于 DOM 未就绪延迟态时进入 AWAITING_DOM 等待 domContentLoaded/load，绝不盲目灌注 10 个子通道或归零退避
      if (ch1Outcome.deferred) {
        entry.lastVerifyAt = Date.now();
        entry.verifyDirty = false;
        entry.lastVerifiedCodeHash = this.codeHash || '';
        return mainRes;
      }

      const cfgNow = getCurrentCfg();

      // Channel 2: Omni
      const hadOmniBefore = Boolean(entry.omniScriptId || entry.lastOmniExpr);
      await this._replaceEntryNewDocScript(entry, 'omniScriptId', '');
      if (this._isOmniEnabled(cfgNow) && this.omniExpr) {
        await entry.session.send('Runtime.addBinding', { name: OMNI_BINDING }).catch(() => {});
        const id = await this._replaceEntryNewDocScript(entry, 'omniScriptId', this.omniExpr);
        if (id) entry.lastOmniExpr = this.omniExpr;
        const ev = await entry.session.evaluate(this.omniExpr).catch(() => null);
        if (ev && ev.ok !== false) recordChannelSuccess(entry, 'omni', { scriptId: entry.omniScriptId });
        else recordChannelFailure(entry, 'omni');
      } else {
        if (hadOmniBefore) await entry.session.evaluate(this._buildOmniCleanupExpression()).catch(() => null);
        entry.lastOmniExpr = '';
        recordChannelOff(entry, 'omni');
      }

      // Channel 3: Sidebar Studio
      const hadSidebarBefore = Boolean(entry.sidebarScriptId || entry.sidebarMounted);
      await this._replaceEntryNewDocScript(entry, 'sidebarScriptId', '');
      if (this._isSidebarStudioEnabled(cfgNow)) {
        if (!this.sidebarService) await this.ensureSidebarService().catch(() => null);
        await this._ensureSidebarBinding(entry);
        if (!this.sidebarExpr && typeof this.cdp.buildSidebarStudioExpression === 'function') {
          this.sidebarExpr = this._buildSidebarExprForCurrentClient();
        }
        if (this.sidebarExpr) {
          await this._replaceEntryNewDocScript(entry, 'sidebarScriptId', this.sidebarExpr);
          await entry.session.evaluate(this.sidebarExpr).catch(() => null);
          entry.sidebarMounted = true;
          recordChannelSuccess(entry, 'sidebar', { scriptId: entry.sidebarScriptId });
        }
      } else {
        await this._removeSidebarBinding(entry);
        await entry.session.evaluate(this._buildSidebarCleanupExpression(hadSidebarBefore)).catch(() => null);
        entry.sidebarMounted = false;
        recordChannelOff(entry, 'sidebar');
      }

      // Channel 4: Host I18n
      const hadHostI18nBefore = Boolean(entry.hostI18nScriptId || entry.hostI18nMounted);
      await this._replaceEntryNewDocScript(entry, 'hostI18nScriptId', '');
      const hostI18nEnabledNow = this._isHostI18nEnabled(cfgNow);
      const hostI18nOffAtInject = cfgNow?.hostLocalization === 'off';
      if (hostI18nOffAtInject && !entry.session.closed) await this._syncIsolatedHostI18n(entry, true);
      if (hostI18nEnabledNow) {
        if (!this.hostI18nExpr && typeof this.cdp.buildHostI18nExpression === 'function') {
          const chOpts = this._getChannelCacheOpts(true);
          this.hostI18nExpr = chOpts ? this.cdp.buildHostI18nExpression(cfgNow, null, chOpts) : this.cdp.buildHostI18nExpression(cfgNow);
          if (chOpts && this.running) this._scheduleBundleCacheFlush();
        }
        if (this.hostI18nExpr) {
          const hiId = await this._replaceEntryNewDocScript(entry, 'hostI18nScriptId', this.hostI18nExpr);
          const evalRes = await entry.session.evaluate(this.hostI18nExpr).catch(() => null);
          const hiSig = this._getHostI18nCfgSig(cfgNow);
          if (evalRes?.skippedByLiveCfg) {
            entry.hostI18nMounted = false;
            entry.hostI18nSkippedByLiveCfg = true;
            entry.lastHostI18nSig = hiSig;
            recordChannelSkipped(entry, 'hostI18n', { codeHash: hiSig });
          } else if (evalRes && evalRes.ok) {
            entry.hostI18nMounted = true;
            entry.hostI18nSkippedByLiveCfg = false;
            entry.lastHostI18nSig = hiSig;
            recordChannelSuccess(entry, 'hostI18n', { codeHash: hiSig, scriptId: hiId });
          } else {
            recordChannelFailure(entry, 'hostI18n');
          }
          if (hiId) entry.lastHostI18nScriptSig = hiSig;
        }
      } else {
        if (hadHostI18nBefore) await entry.session.evaluate(this._getHostI18nCleanupExpression()).catch(() => null);
        entry.hostI18nMounted = false;
        entry.hostI18nSkippedByLiveCfg = false;
        entry.lastHostI18nSig = '';
        entry.lastHostI18nScriptSig = '';
        recordChannelOff(entry, 'hostI18n');
      }
      if (!hostI18nOffAtInject && entry.isolatedHostI18nPaused && !entry.session.closed) {
        await this._syncIsolatedHostI18n(entry, false);
      }

      // Channel 5: Thought
      const hadThoughtBefore = Boolean(entry.thoughtScriptId || entry.thoughtMounted);
      await this._replaceEntryNewDocScript(entry, 'thoughtScriptId', '');
      const thoughtCfgNow = getCurrentCfg();
      if (this._isThoughtEnabled(thoughtCfgNow)) {
        if (!this.thoughtExpr && typeof this.cdp.buildThoughtExpression === 'function') this._buildThoughtExprForConfig(thoughtCfgNow);
        if (this.thoughtExpr) {
          await entry.session.send('Runtime.addBinding', { name: THOUGHT_BINDING }).catch(() => {});
          const tId = await this._replaceEntryNewDocScript(entry, 'thoughtScriptId', this.thoughtExpr);
          const evalRes = await entry.session.evaluate(this.thoughtExpr).catch(() => null);
          const thoughtSig = this._getThoughtCfgSig(thoughtCfgNow);
          if (evalRes && evalRes.ok) {
            entry.thoughtMounted = true;
            entry.lastThoughtSig = thoughtSig;
            recordChannelSuccess(entry, 'thought', { codeHash: thoughtSig, scriptId: tId });
          } else {
            entry.thoughtMounted = false;
            entry.lastThoughtSig = '';
            recordChannelFailure(entry, 'thought');
          }
          entry.lastThoughtScriptSig = tId ? thoughtSig : '';
        }
      } else {
        if (hadThoughtBefore) await entry.session.evaluate(this._getThoughtCleanupExpression()).catch(() => null);
        entry.thoughtMounted = false;
        entry.lastThoughtSig = '';
        entry.lastThoughtScriptSig = '';
        recordChannelOff(entry, 'thought');
      }

      // Channel 6: Inline Diff
      const hadInlineDiffBefore = Boolean(entry.inlineDiffScriptId || entry.inlineDiffMounted);
      await this._replaceEntryNewDocScript(entry, 'inlineDiffScriptId', '');
      if (!this.inlineDiffExpr && typeof this.cdp.buildInlineDiffInjectExpression === 'function') {
        this._buildInlineDiffExprForConfig(getCurrentCfg());
      }
      if (this.inlineDiffExpr) {
        await this._ensureInlineDiffBinding(entry);
        const idAdd = await this._replaceEntryNewDocScript(entry, 'inlineDiffScriptId', this.inlineDiffExpr);
        const evalRes = await entry.session.evaluate(this.inlineDiffExpr).catch(() => null);
        const inlineDiffHash = this._getInlineDiffExprHash(this.inlineDiffExpr);
        await this._recordInlineDiffEvalOutcome(entry, evalRes, inlineDiffHash);
        entry.lastInlineDiffScriptHash = idAdd ? inlineDiffHash : '';
      } else {
        if (hadInlineDiffBefore) await entry.session.evaluate(this._getInlineDiffCleanupExpression()).catch(() => null);
        entry.inlineDiffMounted = false;
        entry.inlineDiffSkipped = false;
        entry.lastInlineDiffHash = '';
        entry.lastInlineDiffScriptHash = '';
        recordChannelOff(entry, 'inlineDiff');
      }

      // Channel 7: Wallpaper
      const hadWallpaperBefore = Boolean(entry.wallpaperScriptId || entry.wallpaperMounted);
      await this._replaceEntryNewDocScript(entry, 'wallpaperScriptId', '');
      if (!this.wallpaperExpr && typeof this.cdp.buildWallpaperExpression === 'function') {
        this._buildWallpaperExprForConfig(getCurrentCfg());
      }
      if (this.wallpaperExpr) {
        await this._ensureWallpaperBinding(entry);
        const wpAdd = await this._replaceEntryNewDocScript(entry, 'wallpaperScriptId', this.wallpaperExpr);
        const evalRes = await entry.session.evaluate(this.wallpaperExpr).catch(() => null);
        const wallpaperHash = this._getWallpaperExprHash(this.wallpaperExpr);
        await this._recordWallpaperEvalOutcome(entry, evalRes, wallpaperHash);
        entry.lastWallpaperScriptHash = wpAdd ? wallpaperHash : '';
      } else {
        if (hadWallpaperBefore) {
          await this._removeWallpaperBinding(entry);
          await entry.session.evaluate(this._getWallpaperCleanupExpression()).catch(() => null);
        }
        entry.wallpaperMounted = false;
        entry.wallpaperSkipped = false;
        entry.lastWallpaperHash = '';
        entry.lastWallpaperScriptHash = '';
        recordChannelOff(entry, 'wallpaper');
      }

      // Channels 8, 10, 12: Periodic Picker / Mascot / Home Studio
      await this._syncPeriodicPickerOnEntry(entry, getCurrentCfg(), { forceReplaceScript: true, forceEval: true, evalTimeoutMs: 0, cleanupTimeoutMs: 0 });
      await this._syncMascotOnEntry(entry, getCurrentCfg(), { forceReplaceScript: true, forceEval: true, evalTimeoutMs: 0, cleanupTimeoutMs: 0 });
      await this._syncHomeStudioOnEntry(entry, getCurrentCfg(), { forceReplaceScript: true, forceEval: true, evalTimeoutMs: 0, cleanupTimeoutMs: 0 });

      // Channel 11: Suggester
      const hadSuggesterBefore = Boolean(entry.suggesterScriptId || entry.suggesterMounted);
      await this._replaceEntryNewDocScript(entry, 'suggesterScriptId', '');
      if (!this.suggesterExpr && typeof this.cdp.buildSuggesterExpression === 'function') {
        this._buildSuggesterExprForConfig(getCurrentCfg());
      }
      if (this.suggesterExpr) {
        await this._ensureSuggesterBinding(entry);
        const sgAdd = await this._replaceEntryNewDocScript(entry, 'suggesterScriptId', this.suggesterExpr);
        const evalRes = await entry.session.evaluate(this.suggesterExpr).catch(() => null);
        const suggesterHash = this._getSuggesterExprHash(this.suggesterExpr);
        await this._recordSuggesterEvalOutcome(entry, evalRes, suggesterHash);
        entry.lastSuggesterScriptHash = sgAdd ? suggesterHash : '';
      } else {
        if (hadSuggesterBefore) {
          await this._removeSuggesterBinding(entry);
          await entry.session.evaluate(this._getSuggesterCleanupExpression()).catch(() => null);
        }
        entry.suggesterMounted = false;
        entry.suggesterSkipped = false;
        entry.lastSuggesterHash = '';
        entry.lastSuggesterScriptHash = '';
        recordChannelOff(entry, 'suggester');
      }

      entry.lastVerifyAt = Date.now();
      entry.healthyStreak = 1;
      entry.verifyDirty = false;
      entry.lastVerifiedCodeHash = this.codeHash || '';
      entry.appliedConfigSeq = this._configSeq;
      if (entry.fsmState === ENTRY_FSM_STATES.INJECTING_CH1) {
        transitionEntryState(entry, ENTRY_FSM_STATES.HEALTHY_BACKOFF, 'apply-complete');
      }
      return mainRes;
    });
  },

  async attachTarget(target) {
    const wsUrl = target.webSocketDebuggerUrl;
    if (this.isTargetIgnored(target)) return null;
    if (this.sessions.has(wsUrl)) return this.sessions.get(wsUrl);

    const session = await this.cdp.CdpSession.connect(wsUrl, 3500);
    const entry = ensureEntryFsm({
      wsUrl,
      pageId: target.id,
      url: String(target.url || ''),
      title: target.title || target.url || 'Antigravity',
      targetType: target.type || 'page',
      targetAttached: typeof target.attached === 'boolean' ? target.attached : true,
      detectedScopeKey: '',
      _usageScopeVerified: false,
      session,
      scriptId: null,
      omniScriptId: null,
      sidebarScriptId: null,
      sidebarBindingAdded: false,
      sidebarMounted: false,
      hostI18nScriptId: null,
      hostI18nMounted: false,
      hostI18nSkippedByLiveCfg: false,
      lastHostI18nSig: '',
      lastHostI18nScriptSig: '',
      isolatedHostI18nPaused: false,
      isolatedHostI18nNoExtCtxs: new Set(),
      _isoPauseTimers: new Set(),
      thoughtScriptId: null,
      thoughtMounted: false,
      lastThoughtSig: '',
      lastThoughtScriptSig: '',
      inlineDiffScriptId: null,
      inlineDiffBindingAdded: false,
      inlineDiffMounted: false,
      inlineDiffSkipped: false,
      lastInlineDiffHash: '',
      lastInlineDiffScriptHash: '',
      wallpaperScriptId: null,
      wallpaperBindingAdded: false,
      wallpaperMounted: false,
      wallpaperSkipped: false,
      lastWallpaperHash: '',
      lastWallpaperScriptHash: '',
      suggesterScriptId: null,
      suggesterBindingAdded: false,
      suggesterMounted: false,
      suggesterSkipped: false,
      lastSuggesterHash: '',
      lastSuggesterScriptHash: '',
      periodicPickerScriptId: null,
      periodicPickerMounted: false,
      lastPeriodicPickerSig: '',
      lastPeriodicPickerScriptSig: '',
      homeStudioScriptId: null,
      homeStudioMounted: false,
      lastHomeStudioSig: '',
      lastHomeStudioScriptSig: '',
      sidebarHostVerified: false,
      sidebarVerifiedDocument: -1,
      sidebarHostContextId: null,
      sidebarDocument: 0,
      lastOmniExpr: '',
      lastVerifyAt: 0,
      healthyStreak: 0,
      verifyDirty: true,
      lastVerifiedCodeHash: '',
      mainFrameId: null,
      hasFrameTree: false,
      contextFrames: new Map(),
      swarmSubFrames: new Map(),
      pendingAckEpoch: 0,
      _healTimer: null,
      _opChain: Promise.resolve(),
    });
    this.sessions.set(wsUrl, entry);

    session.onClose = () => {
      if (entry._healTimer) {
        clearTimeout(entry._healTimer);
        this._managedTimers?.delete(entry._healTimer);
        entry._healTimer = null;
      }
      transitionEntryState(entry, ENTRY_FSM_STATES.DETACHED, 'session-closed');
      if (this.sessions.get(wsUrl) === entry) {
        this.sessions.delete(wsUrl);
        if (this.sessions.size === 0 && this._prevAttachedCount > 0) {
          this._disconnectedAllSessions = true;
        }
      }
    };

    try {
      const revokeSidebarHost = () => {
        entry.sidebarHostVerified = false;
        entry.sidebarVerifiedDocument = -1;
        entry.sidebarHostContextId = null;
        entry.sidebarDocument += 1;
        entry.inlineDiffSkipped = false;
        entry.wallpaperSkipped = false;
        resetEntryForNewDocument(entry);
      };
      session.on('Runtime.executionContextCreated', (params) => {
        const ctx = params?.context;
        if (!ctx || typeof ctx.id !== 'number') return;
        const aux = ctx.auxData && typeof ctx.auxData === 'object' ? ctx.auxData : {};
        const frameId = typeof aux.frameId === 'string' ? aux.frameId : '';
        const isDefault = aux.isDefault === true;
        const type = typeof aux.type === 'string' && aux.type ? aux.type : isDefault ? 'default' : '';
        const isMainDefault = Boolean(entry.mainFrameId && frameId === entry.mainFrameId && isDefault && type === 'default');
        if (isMainDefault) {
          if (entry.sidebarHostVerified || (typeof entry.sidebarHostContextId === 'number' && entry.sidebarHostContextId !== ctx.id)) {
            revokeSidebarHost();
            entry.verifyDirty = true;
            entry.healthyStreak = 0;
          }
        }
        entry.contextFrames.set(ctx.id, { frameId, isDefault, type, docGen: entry.sidebarDocument });
        const isMainIsolated = Boolean(entry.mainFrameId && frameId === entry.mainFrameId && !isDefault && type === 'isolated');
        if (isMainIsolated) {
          const cfgOnCtx = typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null;
          if (cfgOnCtx?.hostLocalization === 'off' && this.running && !entry.session.closed) {
            const targetCtxId = ctx.id;
            const pauseIsoCtx = () => {
              if (!this.running || entry.session.closed || !entry.contextFrames.has(targetCtxId)) return;
              const liveCfgNow = typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null;
              if (liveCfgNow?.hostLocalization !== 'off') return;
              void this._syncIsolatedHostI18n(entry, true, { contextIds: [targetCtxId] })
                .then((r) => {
                  if (r && r.newlyPaused && !entry.session.closed) return this._forceMainWorldHostI18nOffRescan(entry);
                })
                .catch(() => {});
            };
            pauseIsoCtx();
            const retryTid = setTimeout(() => {
              entry._isoPauseTimers?.delete(retryTid);
              pauseIsoCtx();
            }, 350);
            if (typeof retryTid.unref === 'function') retryTid.unref();
            entry._isoPauseTimers?.add(retryTid);
          }
        }
        if (!isMainDefault && isDefault && type === 'default' && frameId && frameId !== entry.mainFrameId) {
          const ctxOriginOrUrl = String(ctx.origin || aux.url || '').trim();
          const existingSub = entry.swarmSubFrames?.get(frameId);
          const isSwarmSub = Boolean(existingSub) || (ctxOriginOrUrl && typeof this.cdp?.isSwarmSidecarUrl === 'function' && this.cdp.isSwarmSidecarUrl(ctxOriginOrUrl));
          if (isSwarmSub && !this.swarmSessions.has(frameId)) {
            if (!existingSub) {
              entry.swarmSubFrames.set(frameId, { url: this._redactSensitiveText(ctxOriginOrUrl), contextId: ctx.id, mounted: false, codeHash: '' });
            } else {
              existingSub.contextId = ctx.id;
            }
            if (this.running && !entry.session.closed) void this._injectSwarmIntoSubFrame(entry, frameId, ctx.id).catch(() => {});
          }
        }
      });
      session.on('Runtime.executionContextDestroyed', (params) => {
        if (typeof params?.executionContextId === 'number') {
          const destroyedId = params.executionContextId;
          const destroyedMeta = entry.contextFrames.get(destroyedId);
          entry.contextFrames.delete(destroyedId);
          entry.isolatedHostI18nNoExtCtxs?.delete(destroyedId);
          if (entry.swarmSubFrames instanceof Map) {
            for (const sub of entry.swarmSubFrames.values()) {
              if (sub && sub.contextId === destroyedId) { sub.contextId = null; sub.mounted = false; }
            }
          }
          const wasMainDefault = Boolean(
            destroyedMeta && destroyedMeta.isDefault === true && destroyedMeta.type === 'default' && entry.mainFrameId && destroyedMeta.frameId === entry.mainFrameId
          );
          if (destroyedId === entry.sidebarHostContextId || wasMainDefault) {
            revokeSidebarHost();
            entry.verifyDirty = true;
            entry.healthyStreak = 0;
          }
        }
      });
      session.on('Runtime.executionContextsCleared', () => {
        entry.contextFrames.clear();
        entry.swarmSubFrames?.clear();
        entry.isolatedHostI18nNoExtCtxs?.clear();
        entry.isolatedHostI18nPaused = false;
        revokeSidebarHost();
        entry.pendingAckEpoch = 0;
      });
      session.on('Page.frameNavigated', (params) => {
        const frame = params?.frame;
        if (frame && !frame.parentId && typeof frame.id === 'string' && frame.id) {
          entry.mainFrameId = frame.id;
          entry.hasFrameTree = true;
          revokeSidebarHost();
          entry.pendingAckEpoch = 0;
          entry.verifyDirty = true;
          entry.healthyStreak = 0;
          if (typeof frame.url === 'string' && frame.url) entry.url = frame.url;
        } else if (frame && frame.parentId && typeof frame.id === 'string' && frame.id) {
          const fid = frame.id;
          if (this._isSwarmTargetInfo({ type: 'iframe', url: frame.url }) && !this.swarmSessions.has(fid)) {
            let subCtxId = null;
            for (const [cid, meta] of entry.contextFrames.entries()) {
              if (meta && meta.frameId === fid && meta.isDefault === true && meta.type === 'default') { subCtxId = cid; break; }
            }
            entry.swarmSubFrames.set(fid, { url: this._redactSensitiveText(frame.url || ''), contextId: subCtxId, mounted: false, codeHash: '' });
            if (typeof subCtxId === 'number' && this.running && !entry.session.closed) {
              void this._injectSwarmIntoSubFrame(entry, fid, subCtxId).catch(() => {});
            }
          } else if (entry.swarmSubFrames.has(fid)) {
            entry.swarmSubFrames.delete(fid);
          }
        }
      });

      await session.send('Page.enable');
      await this._ensureMainFrameId(entry, 4500, 1);
      await session.send('Runtime.enable');
      session.on('Runtime.bindingCalled', (params) => {
        void this.handleBindingCall(entry, params || {});
      });
      await session.send('Runtime.addBinding', { name: this.cdp.SETTING_BINDING });
      await session.send('Runtime.addBinding', { name: this.cdp.LEGACY_SETTING_BINDING }).catch(() => {});
      await session.send('Runtime.addBinding', { name: METRICS_BINDING });
      await session.send('Runtime.addBinding', { name: REPO_BINDING });
      await session.send('Runtime.addBinding', { name: THOUGHT_BINDING });
      await session.send('Runtime.addBinding', { name: USAGE_BINDING });
      await session.send('Runtime.addBinding', { name: INLINE_DIFF_BINDING });
      entry.inlineDiffBindingAdded = true;
      if (this._isOmniEnabled()) await session.send('Runtime.addBinding', { name: OMNI_BINDING });
      if (this._isSidebarStudioEnabled()) {
        await session.send('Runtime.addBinding', { name: SIDEBAR_BINDING });
        entry.sidebarBindingAdded = true;
      }

      const healOnNav = () => {
        if (!this.running || entry.session.closed) return;
        const allowWake = onEntryDomReadySignal(entry);
        if (!allowWake) return;
        entry.verifyDirty = true;
        // AWAITING_DOM 状态下不归零 healthyStreak 退避
        if (entry.fsmState !== ENTRY_FSM_STATES.AWAITING_DOM) {
          entry.healthyStreak = 0;
        }
        if (entry._healTimer) {
          clearTimeout(entry._healTimer);
          this._managedTimers?.delete(entry._healTimer);
          entry._healTimer = null;
        }
        const t = setTimeout(() => {
          entry._healTimer = null;
          this._managedTimers?.delete(t);
          if (!this.running || entry.session.closed) return;
          void this.verifyAndHealEntry(entry, true);
        }, 50);
        if (typeof t.unref === 'function') t.unref();
        entry._healTimer = t;
        this._managedTimers?.add(t);
      };
      session.on('Page.domContentLoadedEventFired', healOnNav);
      session.on('Page.loadEventFired', healOnNav);

      const res = await this.applyToEntry(entry);
      if (res && res.status === 'skipped-non-host') {
        this._markTargetIgnored(target, entry.url || target.url);
        session.close();
        this.sessions.delete(wsUrl);
        this.log(`[↷] Ignored non-host target: ${this._redactSensitiveText(entry.title)}`);
        return null;
      }
      this.log(`[✓] Attached & injected Obsidian Prism v${this.cdp.PLUGIN_VERSION}: ${this._redactSensitiveText(entry.title)} (${res?.status || 'ok'})`);
      return entry;
    } catch (err) {
      try {
        await this._teardownAllEntryChannelScripts(entry, session, { removeBindings: false, resetHomeStudio: false });
      } catch {}
      session.close();
      this.sessions.delete(wsUrl);
      throw err;
    }
  },

  async detachAll(cleanPageDom = false) {
    await this._detachAllSwarmSessions(cleanPageDom).catch(() => {});
    this.closeBrowserDiscovery();
    const entries = [...this.sessions.values()];
    await Promise.allSettled(
      entries.map(async (entry) => {
        try {
          await this._teardownAllEntryChannelScripts(entry, entry.session, { removeBindings: true });
          await this._cleanupSwarmSubFrames(entry, cleanPageDom).catch(() => {});
          entry.swarmSubFrames?.clear?.();
          if (cleanPageDom && !entry.session.closed) {
            await entry.session.evaluate(this.cdp.REMOVE_EXPRESSION).catch(() => {});
          }
          if (entry._isoPauseTimers) {
            for (const tid of entry._isoPauseTimers) clearTimeout(tid);
            entry._isoPauseTimers.clear();
          }
          if (entry.isolatedHostI18nPaused && !entry.session.closed) {
            await this._syncIsolatedHostI18n(entry, false).catch(() => {});
          }
        } catch {}
        transitionEntryState(entry, ENTRY_FSM_STATES.DETACHED, 'detachAll');
        entry.session.close();
      })
    );
    this.sessions.clear();
  },
};
