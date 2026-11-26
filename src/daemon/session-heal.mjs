// Obsidian Prism 窗口健康探针调度与显式 FSM 增量自愈（Per-Window AWAITING_DOM 护栏 + Per-Channel 3 次熔断，Tier 2）
import { OMNI_BINDING } from '../../vendor/omni-viewer/omni-server.mjs';
import {
  METRICS_BINDING,
  REPO_BINDING,
  THOUGHT_BINDING,
  USAGE_BINDING,
} from './constants.mjs';
import { normalizeUsageScopeKey } from './telemetry-scope.mjs';
import {
  ENTRY_FSM_STATES,
  ensureEntryFsm,
  transitionEntryState,
  recordEntryCh1Outcome,
  shouldHoldAwaitingDomReinject,
  isChannelInCooldown,
} from './session-fsm.mjs';
import { PAGE_HEALTH_PROBE_EXPRESSION, healSecondaryChannels } from './session-heal-channels.mjs';
import { RUNTIME_CHANNEL_SPECS } from './runtime-channel-specs.mjs';

export const sessionHealMethods = {
  async verifyAndHealEntry(entry, force = false) {
    if (!entry || entry.session.closed) return { alive: false, ready: false, isHostDom: false };
    return this._runEntryExclusive(entry, () => this._verifyAndHealEntryUnlocked(entry, force));
  },

  async _verifyAndHealEntryUnlocked(entry, force = false) {
    if (!entry || entry.session.closed) return { alive: false, ready: false, isHostDom: false };
    ensureEntryFsm(entry);
    const now = Date.now();
    const cfg = typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null;
    const thoughtEnabled = this._isThoughtEnabled(cfg);
    const hasCtxMap = entry.contextFrames instanceof Map;
    const needsBindingHeal = hasCtxMap && (!entry.mainFrameId || !this._hasMainDefaultContext(entry));
    const holdingDeferred = shouldHoldAwaitingDomReinject(entry);

    const thoughtNeedsSync =
      !isChannelInCooldown(entry, 'thought', now) &&
      (thoughtEnabled ? !entry.thoughtScriptId || !entry.thoughtMounted : Boolean(entry.thoughtScriptId || entry.thoughtMounted));
    const inlineDiffAvailable = Boolean(this.inlineDiffExpr || this._hasInlineDiffClientFile());
    const inlineDiffNeedsSync =
      !isChannelInCooldown(entry, 'inlineDiff', now) &&
      (inlineDiffAvailable ? !entry.inlineDiffSkipped && (!entry.inlineDiffScriptId || !entry.inlineDiffMounted) : Boolean(entry.inlineDiffScriptId || entry.inlineDiffMounted));
    const wallpaperAvailable = Boolean(this.wallpaperExpr || this._hasWallpaperClientFile());
    const wallpaperNeedsSync =
      !isChannelInCooldown(entry, 'wallpaper', now) &&
      (wallpaperAvailable ? !entry.wallpaperSkipped && (!entry.wallpaperScriptId || !entry.wallpaperMounted) : Boolean(entry.wallpaperScriptId || entry.wallpaperMounted));
    const suggesterAvailable = Boolean(this.suggesterExpr || this._hasSuggesterClientFile());
    const suggesterNeedsSync =
      !isChannelInCooldown(entry, 'suggester', now) &&
      (suggesterAvailable ? !entry.suggesterSkipped && (!entry.suggesterScriptId || !entry.suggesterMounted) : Boolean(entry.suggesterScriptId || entry.suggesterMounted));

    const periodicPickerAvailable = this._isPeriodicPickerEnabled(cfg) && this._hasPeriodicPickerFile();
    const expectedPeriodicEarlySig =
      periodicPickerAvailable && this.periodicPickerExpr
        ? `${this._getPeriodicPickerCfgSig(cfg)}:${this._getPeriodicPickerExprHash(this.periodicPickerExpr)}`
        : '';
    const periodicPickerNeedsSync =
      !isChannelInCooldown(entry, 'periodicPicker', now) &&
      (periodicPickerAvailable
        ? !entry.periodicPickerScriptId || !entry.periodicPickerMounted || Boolean(expectedPeriodicEarlySig && (entry.lastPeriodicPickerSig !== expectedPeriodicEarlySig || entry.lastPeriodicPickerScriptSig !== expectedPeriodicEarlySig))
        : Boolean(entry.periodicPickerScriptId || entry.periodicPickerMounted));

    const mascotAvailable = this._isMascotEnabled(cfg) && this._hasMascotFile();
    const expectedMascotEarlySig =
      mascotAvailable && this.mascotExpr
        ? `${this._getMascotCfgSig(cfg)}:${this._getMascotExprHash(this.mascotExpr)}`
        : '';
    const mascotNeedsSync =
      !isChannelInCooldown(entry, 'mascot', now) &&
      (mascotAvailable
        ? !entry.mascotScriptId || !entry.mascotMounted || Boolean(expectedMascotEarlySig && (entry.lastMascotSig !== expectedMascotEarlySig || entry.lastMascotScriptSig !== expectedMascotEarlySig))
        : Boolean(entry.mascotScriptId || entry.mascotMounted));

    const homeStudioAvailable = this._isHomeStudioEnabled(cfg) && this._hasHomeStudioFile();
    const expectedHomeStudioEarlySig =
      homeStudioAvailable && this.homeStudioExpr
        ? `${this._getHomeStudioCfgSig(cfg)}:${this._getHomeStudioExprHash(this.homeStudioExpr)}`
        : '';
    const homeStudioNeedsSync =
      !isChannelInCooldown(entry, 'homeStudio', now) &&
      (homeStudioAvailable
        ? !entry.homeStudioScriptId || !entry.homeStudioMounted || Boolean(expectedHomeStudioEarlySig && (entry.lastHomeStudioSig !== expectedHomeStudioEarlySig || entry.lastHomeStudioScriptSig !== expectedHomeStudioEarlySig))
        : Boolean(entry.homeStudioScriptId || entry.homeStudioMounted));

    let runtimeChannelsNeedSync = false;
    for (const spec of RUNTIME_CHANNEL_SPECS) {
      if (isChannelInCooldown(entry, spec.id, now)) continue;
      const avail = this._isRuntimeChannelEnabled(spec, cfg) && this._hasRuntimeChannelFile(spec);
      const expSig =
        avail && this[spec.exprField]
          ? `${this._getRuntimeChannelCfgSig(spec, cfg)}:${this._getRuntimeChannelExprHash(spec, this[spec.exprField])}`
          : '';
      const need = avail
        ? !entry[spec.scriptField] || !entry[spec.mountedField] || Boolean(expSig && (entry[spec.sigField] !== expSig || entry[spec.scriptSigField] !== expSig))
        : Boolean(entry[spec.scriptField] || entry[spec.mountedField]);
      if (need) {
        runtimeChannelsNeedSync = true;
        break;
      }
    }

    const hashMatches = !this.codeHash || entry.lastVerifiedCodeHash === this.codeHash;
    if (
      !force &&
      !needsBindingHeal &&
      !thoughtNeedsSync &&
      !inlineDiffNeedsSync &&
      !wallpaperNeedsSync &&
      !suggesterNeedsSync &&
      !periodicPickerNeedsSync &&
      !mascotNeedsSync &&
      !homeStudioNeedsSync &&
      !runtimeChannelsNeedSync &&
      !entry.verifyDirty &&
      hashMatches &&
      entry.lastVerifyAt > 0 &&
      entry.healthyStreak > 0
    ) {
      const browserLive = Boolean(this.browserSession && !this.browserSession.closed);
      const backoffMs = browserLive
        ? Math.min(45000, 3000 * Math.pow(2, Math.min(4, entry.healthyStreak - 1)))
        : 6000;
      if (now - entry.lastVerifyAt < backoffMs) {
        return { alive: true, ready: true, isHostDom: true, skipped: true };
      }
    }

    try {
      if (!entry.mainFrameId) await this._ensureMainFrameId(entry, 3000, 0);
      if (entry.mainFrameId && hasCtxMap && !this._hasMainDefaultContext(entry)) {
        const lastResyncAt = Number(entry._lastRuntimeResyncAt) || 0;
        if (force || now - lastResyncAt >= 5000) {
          entry._lastRuntimeResyncAt = Date.now();
          await entry.session.send('Runtime.disable', {}, 2000).catch(() => {});
          await entry.session.send('Runtime.enable', {}, 2600).catch(() => {});
          if (entry.sidebarHostVerified === true && entry.sidebarHostContextId == null) {
            entry.sidebarHostContextId = this._findCurrentMainDefaultContextId(entry);
          }
        }
      }

      const probe = await entry.session.evaluate(PAGE_HEALTH_PROBE_EXPRESSION, false, 2600);
      if (!probe || !probe.ready) return { alive: true, ready: false, isHostDom: true };
      if (probe.href) entry.url = probe.href;
      if (probe.title) entry.title = probe.title;
      if (probe.scopeAttr) {
        const probedScope = normalizeUsageScopeKey(probe.scopeAttr);
        if (probedScope && probedScope !== 'local') entry.detectedScopeKey = probedScope;
      }

      // 若页面正处于 AWAITING_DOM 静默/耗尽等待态，则绝不执行 546 KB 全量 Ch1 重注，也不归零 healthyStreak 退避
      if (holdingDeferred) {
        entry.lastVerifyAt = Date.now();
        entry.verifyDirty = false;
        if (probe.hasPrism && probe.prismAttr === this.cdp.PLUGIN_VERSION) {
          this._markSidebarHostVerified(entry, entry.sidebarDocument, true);
          recordEntryCh1Outcome(entry, { status: 'ok' }, entry.sidebarDocument);
        }
        entry.healthyStreak = Math.min(8, Math.max(1, (entry.healthyStreak || 0) + 1));
        return { alive: true, ready: true, isHostDom: Boolean(probe.isHostDom), href: probe.href || '', awaitingDom: true };
      }

      const omniEnabled = this._isOmniEnabled(cfg) && probe.omniMode !== 'off';
      const hasClientOnDisk = omniEnabled && this._hasOmniClientFile();
      const needsOmniHeal =
        omniEnabled && !isChannelInCooldown(entry, 'omni', now) &&
        (!probe.hasOmniBridge || !probe.hasOmniServerMeta || (hasClientOnDisk && !probe.hasOmni));
      const needsOmniCleanup = !omniEnabled && Boolean(probe.hasOmni || entry.omniScriptId || entry.lastOmniExpr);

      const sidebarEnabled = this._isSidebarStudioEnabled(cfg);
      const hasSafeSidebarOnDisk = sidebarEnabled && this._hasSafeV2SidebarClientFile();
      const needsSidebarHeal =
        sidebarEnabled && !isChannelInCooldown(entry, 'sidebar', now) &&
        (!probe.hasSidebarBridge || (hasSafeSidebarOnDisk && !probe.hasSidebar));
      const needsSidebarCleanup =
        !sidebarEnabled && Boolean(probe.hasSidebar || entry.sidebarScriptId || entry.sidebarMounted || entry.sidebarBindingAdded);

      const hostI18nEnabled = this._isHostI18nEnabled(cfg);
      const expectedHostI18nMode = cfg?.hostLocalization === 'on' ? 'on' : cfg?.hostLocalization === 'off' ? 'off' : 'auto';
      const hostI18nSig = hostI18nEnabled ? this._getHostI18nCfgSig(cfg) : '';
      const hostI18nSkippedSameSig = Boolean(entry.hostI18nSkippedByLiveCfg && entry.lastHostI18nSig === hostI18nSig);
      const uncheckedIsoCtxs =
        expectedHostI18nMode === 'off' && !entry.isolatedHostI18nPaused
          ? this._getMainFrameIsolatedContextIds(entry).filter((cid) => !entry.isolatedHostI18nNoExtCtxs?.has(cid))
          : [];
      const needsIsoHostI18nSync =
        uncheckedIsoCtxs.length > 0 || (expectedHostI18nMode !== 'off' && Boolean(entry.isolatedHostI18nPaused));
      const expectedHostI18nHash =
        hostI18nEnabled && this.hostI18nExpr ? /const targetHash = "([^"]+)"/.exec(this.hostI18nExpr)?.[1] || '' : '';
      const hostI18nHashMismatch = Boolean(expectedHostI18nHash && probe.hostI18nCodeHash && probe.hostI18nCodeHash !== expectedHostI18nHash);
      const needsHostI18nHeal =
        !isChannelInCooldown(entry, 'hostI18n', now) &&
        ((hostI18nEnabled &&
          !hostI18nSkippedSameSig &&
          (!probe.hasHostI18n || !entry.hostI18nScriptId || hostI18nHashMismatch || (probe.hostI18nMode && probe.hostI18nMode !== expectedHostI18nMode))) ||
          (expectedHostI18nMode === 'off' && uncheckedIsoCtxs.length > 0));
      const needsHostI18nCleanup =
        (!hostI18nEnabled && Boolean(probe.hasHostI18n || entry.hostI18nScriptId || entry.hostI18nMounted)) ||
        (expectedHostI18nMode !== 'off' && Boolean(entry.isolatedHostI18nPaused) && !hostI18nEnabled);

      const needsThoughtHeal =
        thoughtEnabled && !isChannelInCooldown(entry, 'thought', now) &&
        (!probe.hasThought || !probe.hasThoughtSettingsUi || !entry.thoughtScriptId || !entry.thoughtMounted);
      const needsThoughtCleanup =
        !thoughtEnabled && Boolean(probe.hasThought || probe.hasThoughtSettingsUi || entry.thoughtScriptId || entry.thoughtMounted);

      const needsInlineDiffHeal =
        inlineDiffAvailable && !entry.inlineDiffSkipped && !isChannelInCooldown(entry, 'inlineDiff', now) &&
        (!probe.hasInlineDiff || !entry.inlineDiffScriptId || !entry.inlineDiffMounted);
      const needsInlineDiffCleanup =
        !inlineDiffAvailable && Boolean(probe.hasInlineDiff || entry.inlineDiffScriptId || entry.inlineDiffMounted);

      if (wallpaperAvailable && !entry.wallpaperSkipped && !this.wallpaperExpr && typeof this.cdp.buildWallpaperExpression === 'function') {
        this._buildWallpaperExprForConfig(cfg);
      }
      const expectedWallpaperHash = wallpaperAvailable && this.wallpaperExpr ? this._getWallpaperExprHash(this.wallpaperExpr) : '';
      const wallpaperHashMismatch = Boolean(expectedWallpaperHash && probe.wallpaperCodeHash && probe.wallpaperCodeHash !== expectedWallpaperHash);
      const needsWallpaperHeal =
        wallpaperAvailable && !entry.wallpaperSkipped && !isChannelInCooldown(entry, 'wallpaper', now) &&
        (!probe.hasWallpaper || !probe.hasWallpaperUi || wallpaperHashMismatch || !entry.wallpaperScriptId || !entry.wallpaperMounted);
      const needsWallpaperCleanup =
        !wallpaperAvailable && Boolean(probe.hasWallpaper || probe.hasWallpaperUi || entry.wallpaperScriptId || entry.wallpaperMounted);

      const needsSuggesterHeal =
        suggesterAvailable && !entry.suggesterSkipped && !isChannelInCooldown(entry, 'suggester', now) &&
        (probe.hasSuggester === false || probe.hasSuggesterUi === false || !entry.suggesterScriptId || !entry.suggesterMounted);
      const needsSuggesterCleanup =
        !suggesterAvailable && Boolean(probe.hasSuggester || probe.hasSuggesterUi || entry.suggesterScriptId || entry.suggesterMounted);

      const periodicPickerEnabled = this._isPeriodicPickerEnabled(cfg);
      const hasPeriodicPickerOnDisk = periodicPickerEnabled && this._hasPeriodicPickerFile();
      if (hasPeriodicPickerOnDisk && !this.periodicPickerExpr && typeof this.cdp.buildPeriodicPickerExpression === 'function') {
        this._buildPeriodicPickerExprForConfig(cfg);
      }
      const expectedPeriodicHash = hasPeriodicPickerOnDisk && this.periodicPickerExpr ? this._getPeriodicPickerExprHash(this.periodicPickerExpr) : '';
      const expectedPeriodicSig = hasPeriodicPickerOnDisk && this.periodicPickerExpr ? `${this._getPeriodicPickerCfgSig(cfg)}:${expectedPeriodicHash}` : '';
      const periodicPickerHashMismatch = Boolean(expectedPeriodicHash && probe.periodicPickerCodeHash !== expectedPeriodicHash);
      const periodicPickerScriptStale = Boolean(!entry.periodicPickerScriptId || (expectedPeriodicSig && entry.lastPeriodicPickerScriptSig !== expectedPeriodicSig));
      const needsPeriodicPickerHeal =
        hasPeriodicPickerOnDisk && !isChannelInCooldown(entry, 'periodicPicker', now) &&
        (!probe.hasPeriodicPicker || periodicPickerHashMismatch || periodicPickerScriptStale);
      const needsPeriodicPickerCleanup =
        !periodicPickerEnabled && Boolean(probe.hasPeriodicPicker || entry.periodicPickerScriptId || entry.periodicPickerMounted);

      const mascotEnabled = this._isMascotEnabled(cfg);
      const hasMascotOnDisk = mascotEnabled && this._hasMascotFile();
      if (hasMascotOnDisk && !this.mascotExpr && typeof this.cdp.buildMascotChannelExpression === 'function') {
        this._buildMascotExprForConfig(cfg);
      }
      const expectedMascotHash = hasMascotOnDisk && this.mascotExpr ? this._getMascotExprHash(this.mascotExpr) : '';
      const expectedMascotSig = hasMascotOnDisk && this.mascotExpr ? `${this._getMascotCfgSig(cfg)}:${expectedMascotHash}` : '';
      const mascotHashMismatch = Boolean(expectedMascotHash && probe.mascotCodeHash !== expectedMascotHash);
      const mascotScriptStale = Boolean(!entry.mascotScriptId || (expectedMascotSig && entry.lastMascotScriptSig !== expectedMascotSig));
      const needsMascotHeal =
        hasMascotOnDisk && !isChannelInCooldown(entry, 'mascot', now) &&
        (!probe.hasMascot || mascotHashMismatch || mascotScriptStale);
      const needsMascotCleanup = !mascotEnabled && Boolean(probe.hasMascot || entry.mascotScriptId || entry.mascotMounted);

      const homeStudioEnabled = this._isHomeStudioEnabled(cfg);
      const hasHomeStudioOnDisk = homeStudioEnabled && this._hasHomeStudioFile();
      if (hasHomeStudioOnDisk && !this.homeStudioExpr && typeof this.cdp.buildHomeStudioChannelExpression === 'function') {
        this._buildHomeStudioExprForConfig(cfg);
      }
      const expectedHomeStudioHash = hasHomeStudioOnDisk && this.homeStudioExpr ? this._getHomeStudioExprHash(this.homeStudioExpr) : '';
      const expectedHomeStudioSig = hasHomeStudioOnDisk && this.homeStudioExpr ? `${this._getHomeStudioCfgSig(cfg)}:${expectedHomeStudioHash}` : '';
      const homeStudioHashMismatch = Boolean(expectedHomeStudioHash && probe.homeStudioCodeHash !== expectedHomeStudioHash);
      const homeStudioScriptStale = Boolean(!entry.homeStudioScriptId || (expectedHomeStudioSig && entry.lastHomeStudioScriptSig !== expectedHomeStudioSig));
      const needsHomeStudioHeal =
        hasHomeStudioOnDisk && !isChannelInCooldown(entry, 'homeStudio', now) &&
        (!probe.hasHomeStudio || homeStudioHashMismatch || homeStudioScriptStale);
      const needsHomeStudioCleanup = !homeStudioEnabled && Boolean(probe.hasHomeStudio || entry.homeStudioScriptId || entry.homeStudioMounted);

      const runtimeChannels = RUNTIME_CHANNEL_SPECS.map((spec) => {
        const enabled = this._isRuntimeChannelEnabled(spec, cfg);
        const hasOnDisk = enabled && this._hasRuntimeChannelFile(spec);
        if (hasOnDisk && !this[spec.exprField] && typeof this.cdp?.[spec.cdpBuild] === 'function') {
          this._buildRuntimeChannelExpr(spec, cfg);
        }
        const expHash = hasOnDisk && this[spec.exprField] ? this._getRuntimeChannelExprHash(spec, this[spec.exprField]) : '';
        const expSig = hasOnDisk && this[spec.exprField] ? `${this._getRuntimeChannelCfgSig(spec, cfg)}:${expHash}` : '';
        const hashMismatch = Boolean(expHash && probe[spec.probeHashField] !== expHash);
        const scriptStale = Boolean(!entry[spec.scriptField] || (expSig && entry[spec.scriptSigField] !== expSig));
        const needsHeal =
          hasOnDisk && !isChannelInCooldown(entry, spec.id, now) &&
          (!probe[spec.probeHasField] || hashMismatch || scriptStale);
        const needsCleanup = !enabled && Boolean(probe[spec.probeHasField] || entry[spec.scriptField] || entry[spec.mountedField]);
        return { spec, enabled, hasOnDisk, needsHeal, needsCleanup };
      });

      const shouldCheckSettingsHash = Boolean(probe.needsSettingsChannel || probe.hasSettingsPanel || probe.settingsCodeHash);
      const expectedSettingsHash = shouldCheckSettingsHash ? this._getSettingsExprHash(this._ensureSettingsExpr()) : '';
      const settingsHashMismatch = Boolean(expectedSettingsHash && (probe.hasSettingsPanel || probe.settingsCodeHash) && probe.settingsCodeHash !== expectedSettingsHash);
      const needsSettingsHeal = Boolean(probe.needsSettingsChannel || settingsHashMismatch);

      const plan = {
        omniEnabled, needsOmniHeal, needsOmniCleanup,
        sidebarEnabled, needsSidebarHeal, needsSidebarCleanup,
        hostI18nEnabled, expectedHostI18nMode, hostI18nSkippedSameSig, hostI18nHashMismatch,
        needsHostI18nHeal, needsIsoHostI18nSync, needsHostI18nCleanup,
        thoughtEnabled, needsThoughtHeal, needsThoughtCleanup,
        inlineDiffAvailable, needsInlineDiffHeal, needsInlineDiffCleanup,
        wallpaperAvailable, wallpaperHashMismatch, needsWallpaperHeal, needsWallpaperCleanup,
        suggesterAvailable, needsSuggesterHeal, needsSuggesterCleanup,
        periodicPickerEnabled, needsPeriodicPickerHeal, needsPeriodicPickerCleanup,
        mascotEnabled, needsMascotHeal, needsMascotCleanup,
        homeStudioEnabled, hasHomeStudioOnDisk, needsHomeStudioHeal, needsHomeStudioCleanup,
        runtimeChannels,
        needsSettingsHeal,
      };

      const needsCh1Heal =
        (entry.sidebarHostVerified === false && probe.isHostDom) ||
        !probe.hasPrism ||
        !probe.hasRepoBridge ||
        !probe.hasThoughtBridge ||
        !probe.hasUsageBridge ||
        probe.prismAttr !== this.cdp.PLUGIN_VERSION ||
        probe.hasLegacyCss ||
        (this.codeHash && probe.codeHash && probe.codeHash !== this.codeHash);

      let healed = false;
      let deferredThisPass = false;
      if (needsCh1Heal) {
        transitionEntryState(entry, ENTRY_FSM_STATES.HEALING, 'ch1-heal');
        healed = true;
        if (omniEnabled) await this.ensureOmniServer().catch(() => null);
        if (sidebarEnabled) await this.ensureSidebarService().catch(() => null);
        await entry.session.send('Runtime.addBinding', { name: this.cdp.SETTING_BINDING }, 2600).catch(() => {});
        await entry.session.send('Runtime.addBinding', { name: METRICS_BINDING }, 2600).catch(() => {});
        await entry.session.send('Runtime.addBinding', { name: REPO_BINDING }, 2600).catch(() => {});
        await entry.session.send('Runtime.addBinding', { name: THOUGHT_BINDING }, 2600).catch(() => {});
        await entry.session.send('Runtime.addBinding', { name: USAGE_BINDING }, 2600).catch(() => {});
        await this._ensureInlineDiffBinding(entry, 2600, true);
        if (omniEnabled) await entry.session.send('Runtime.addBinding', { name: OMNI_BINDING }, 2600).catch(() => {});
        if (sidebarEnabled) await this._ensureSidebarBinding(entry, 2600, true);

        const sidebarDocument = entry.sidebarDocument;
        const healRes = await entry.session.evaluate(this.injectExpr, false, 4500);
        this._markSidebarHostVerified(entry, sidebarDocument, healRes?.status === 'ok');
        const ch1Outcome = recordEntryCh1Outcome(entry, healRes, sidebarDocument);

        if (healRes && healRes.status === 'skipped-non-host') {
          await this._teardownAllEntryChannelScripts(entry, entry.session, { markSkippedNonHost: true });
          this._markTargetIgnored({ id: entry.pageId, webSocketDebuggerUrl: entry.wsUrl }, probe.href || entry.url);
          entry.session.close();
          this.sessions.delete(entry.wsUrl);
          this.log(`[↷] Detached & ignored deferred non-host target: ${this._redactSensitiveText(entry.title)}`);
          return { alive: false, ready: true, isHostDom: false };
        }

        if (ch1Outcome.deferred) {
          deferredThisPass = true;
        } else {
          healed = await healSecondaryChannels(this, entry, cfg, probe, plan, { afterCh1Heal: true, now });
          this.log(`[↻] Hot-healed window to Obsidian Prism v${this.cdp.PLUGIN_VERSION}: ${this._redactSensitiveText(entry.title)}`);
        }
      } else {
        healed = await healSecondaryChannels(this, entry, cfg, probe, plan, { afterCh1Heal: false, now });
      }

      entry.lastVerifyAt = Date.now();
      entry.verifyDirty = false;
      entry.lastVerifiedCodeHash = this.codeHash || '';
      if (deferredThisPass) {
        entry.healthyStreak = Math.min(8, Math.max(1, entry.healthyStreak || 1));
      } else {
        entry.healthyStreak = healed ? 0 : Math.min(8, (entry.healthyStreak || 0) + 1);
        if (!healed && entry.fsmState !== ENTRY_FSM_STATES.AWAITING_DOM) {
          transitionEntryState(entry, ENTRY_FSM_STATES.HEALTHY_BACKOFF, 'verify-healthy');
        }
      }
      return { alive: true, ready: true, isHostDom: Boolean(probe.isHostDom), href: probe.href || '', ...(deferredThisPass ? { awaitingDom: true } : {}) };
    } catch {
      entry.session.close();
      this.sessions.delete(entry.wsUrl);
      return { alive: false, ready: false, isHostDom: false };
    }
  },
};
