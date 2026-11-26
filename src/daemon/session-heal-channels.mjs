// Obsidian Prism 窗口健康探针表达式与次级通道增量自愈（Tier 2）
import { OMNI_BINDING } from '../../vendor/omni-viewer/omni-server.mjs';
import { THOUGHT_BINDING } from './constants.mjs';
import {
  isChannelInCooldown,
  recordChannelSuccess,
  recordChannelSkipped,
  recordChannelOff,
  recordChannelFailure,
} from './session-fsm.mjs';

export const PAGE_HEALTH_PROBE_EXPRESSION = `(() => {
  const root = typeof document !== 'undefined' && document.documentElement;
  if (!root || document.readyState === 'loading') return { ready: false };
  const api = window.__agPrism;
  const isHostDom = Boolean(
    api ||
      (document.body &&
        document.body.classList &&
        (document.body.classList.contains('theme-standalone') || document.body.classList.contains('monaco-workbench'))) ||
      document.querySelector(
        '.agy-shell, .agy-home, [data-testid="aux-pane-split"], [data-testid="conversation-view"], [data-testid="agent-input-box"], [data-testid="model-selector-trigger"], .monaco-workbench'
      )
  );
  const st = api && typeof api.getState === 'function' ? api.getState() : null;
  const telMode = st?.cfg?.telemetryModule || 'auto';
  const omniMode = st?.cfg?.omniModule || 'on';
  const sidebarMode = st?.cfg?.sidebarStudio === 'on' ? 'on' : 'off';
  const needTelCheck = Boolean(api && telMode !== 'off');
  const hasPulseBar = needTelCheck && Boolean(
    (typeof document.getElementById === 'function' &&
      (document.getElementById('ag-prism-pulse-bar') || document.getElementById('ag-pulse-status-bar'))) ||
      document.querySelector('[data-ag-prism-pulse-bar="true"], [data-ag-pulse-bar="true"]')
  );
  const isHome = needTelCheck && !hasPulseBar && Boolean(document.querySelector('.agy-home, [data-testid="home-greeting"]'));
  const hasModelBtn = needTelCheck && !hasPulseBar && !isHome && Boolean(document.querySelector('[data-testid="model-selector-trigger"]'));
  return {
    ready: true,
    isHostDom,
    href: (typeof location !== 'undefined' && location && typeof location.href === 'string') ? location.href : '',
    title: typeof document.title === 'string' ? document.title.slice(0, 200) : '',
    scopeAttr: root.getAttribute('data-ag-prism-scope') || '',
    prismAttr: root.getAttribute('data-ag-prism') || '',
    hasPrism: Boolean(api),
    hasRepoBridge: Boolean(window.__agPrismRepoBridge),
    hasThoughtBridge: Boolean(window.__agPrismThoughtBridge && typeof window.__agPrismThoughtBridge.cacheStats === 'function'),
    hasUsageBridge: Boolean(window.__agPrismUsageBridge && typeof window.__agPrismUsageBridge.listSummaries === 'function'),
    hasOmniBridge: Boolean(window.__agPrismOmniBridge && typeof window.__agPrismOmniBridge.call === 'function'),
    hasOmniServerMeta: Boolean(window.__agPrismOmniServerMeta && window.__agPrismOmniServerMeta.baseUrl && window.__agPrismOmniServerMeta.token),
    hasOmni: Boolean(window.__agPrismOmni),
    omniMode,
    hasSidebarBridge: Boolean(window.__agPrismSidebarBridge && typeof window.__agPrismSidebarBridge.call === 'function'),
    hasSidebar: Boolean(window.__agPrismSidebar),
    sidebarMode,
    hasHostI18n: Boolean(window.__agPrismHostI18n),
    hostI18nMode: String(window.__agPrismHostI18n?.getStatus?.()?.mode || ''),
    hostI18nCodeHash: String(window.__agPrismHostI18n?.__prismCodeHash || ''),
    hasMascot: Boolean(window.__agDualMascotRig || globalThis.__agDualMascotRig),
    mascotCodeHash: String((window.__agDualMascotRig || globalThis.__agDualMascotRig)?.__prismCodeHash || ''),
    hasHomeStudio: Boolean(window.__agPrismHomeStudioPanel || globalThis.__agPrismHomeStudioPanel || window.__agHomeStudioPanel || globalThis.__agHomeStudioPanel),
    homeStudioCodeHash: String((window.__agPrismHomeStudioPanel || globalThis.__agPrismHomeStudioPanel || window.__agHomeStudioPanel || globalThis.__agHomeStudioPanel)?.__prismCodeHash || ''),
    needsHomeStudioChannel: Boolean(
      st?.cfg?.homeLayout === 'studio' &&
        document.querySelector('.agy-home') &&
        !(window.__agPrismHomeStudioPanel || globalThis.__agPrismHomeStudioPanel || window.__agHomeStudioPanel || globalThis.__agHomeStudioPanel)
    ),
    hasSettingsPanel: Boolean(
      (window.__agPrismSettingsPanel || globalThis.__agPrismSettingsPanel) &&
        window.__agCsLocales &&
        window.__agCsLocales.__isFullLocales
    ),
    hasSettingsDialog: Boolean(document.querySelector('[role="dialog"]') || document.getElementById('ag-cs-settings-sec')),
    settingsCodeHash: String((window.__agPrismSettingsPanel || globalThis.__agPrismSettingsPanel)?.__prismCodeHash || ''),
    needsSettingsChannel: Boolean(
      (document.querySelector('[role="dialog"]') || document.getElementById('ag-cs-settings-sec')) &&
        (!window.__agPrismSettingsPanel || !(window.__agCsLocales && window.__agCsLocales.__isFullLocales))
    ),
    hasThought: Boolean(window.__agPrismThought),
    hasThoughtSettingsUi: Boolean(window.__agPrismThoughtSettingsUi),
    hasInlineDiff: Boolean(window.__agPrismInlineDiff && !window.__agPrismInlineDiff.getDebugState?.()?.destroyed),
    hasWallpaper: Boolean(window.__agPrismWallpaper && !window.__agPrismWallpaper.getDebugState?.()?.destroyed),
    hasWallpaperUi: Boolean(typeof window.__prismMountWallpaperUi === 'function'),
    wallpaperCodeHash: String((window.__agPrismWallpaper || globalThis.__agPrismWallpaper)?.__prismCodeHash || ''),
    hasSuggester: Boolean(window.__agPrismSuggester && !window.__agPrismSuggester.getDebugState?.()?.destroyed),
    hasSuggesterUi: Boolean(typeof window.__prismMountSuggesterUi === 'function'),
    hasPeriodicPicker: Boolean(
      window.__agPrismPeriodicPicker &&
      window.__agPrismPeriodicPicker.getStatus?.()?.status !== 'destroyed' &&
      window.__agPrismPeriodicPicker.getStatus?.()?.status !== 'off'
    ),
    periodicPickerCodeHash: String(window.__agPrismPeriodicPicker?.__prismCodeHash || ''),
    codeHash: (api && api.codeHash) || '',
    hasLegacyCss: Boolean(document.getElementById('ag-claude-style-css')),
    needsDashboardSync: Boolean(api && telMode !== 'off' && !isHome && hasModelBtn && !hasPulseBar),
  };
})()`;

export async function healSecondaryChannels(daemon, entry, cfg, probe, plan, { afterCh1Heal, now }) {
  let healed = afterCh1Heal;

  // Channel 2: Omni
  if ((afterCh1Heal && plan.omniEnabled) || (!afterCh1Heal && plan.needsOmniHeal)) {
    if (!isChannelInCooldown(entry, 'omni', now)) {
      if (!afterCh1Heal) {
        healed = true;
        await daemon.ensureOmniServer().catch(() => null);
        await entry.session.send('Runtime.addBinding', { name: OMNI_BINDING }, 2600).catch(() => {});
      }
      if (!daemon.omniExpr && daemon.omniServer && typeof daemon.cdp.buildOmniClientExpression === 'function') {
        const chOpts = daemon._getChannelCacheOpts(true);
        daemon.omniExpr = chOpts
          ? daemon.cdp.buildOmniClientExpression(daemon.omniServer.getServerInfo(), null, chOpts)
          : daemon.cdp.buildOmniClientExpression(daemon.omniServer.getServerInfo());
        if (chOpts && daemon.running) daemon._scheduleBundleCacheFlush();
      }
      if (daemon.omniExpr) {
        if (!entry.omniScriptId) {
          const id = await daemon._replaceEntryNewDocScript(entry, 'omniScriptId', daemon.omniExpr);
          if (id) entry.lastOmniExpr = daemon.omniExpr;
        }
        const ev = await entry.session.evaluate(daemon.omniExpr, false, 3500).catch(() => null);
        if (ev && ev.ok !== false) recordChannelSuccess(entry, 'omni', { scriptId: entry.omniScriptId });
        else recordChannelFailure(entry, 'omni', { now });
      }
    }
  } else if (plan.needsOmniCleanup) {
    healed = true;
    await daemon._replaceEntryNewDocScript(entry, 'omniScriptId', '');
    entry.lastOmniExpr = '';
    await entry.session.evaluate(daemon._buildOmniCleanupExpression(), false, 3500).catch(() => {});
    recordChannelOff(entry, 'omni');
  }

  // Channel 3: Sidebar Studio
  if ((afterCh1Heal && plan.sidebarEnabled) || (!afterCh1Heal && plan.needsSidebarHeal)) {
    if (!isChannelInCooldown(entry, 'sidebar', now)) {
      if (!afterCh1Heal) {
        healed = true;
        await daemon.ensureSidebarService().catch(() => null);
        await daemon._ensureSidebarBinding(entry, 2600, true);
      }
      if (!daemon.sidebarExpr && typeof daemon.cdp.buildSidebarStudioExpression === 'function') {
        daemon.sidebarExpr = daemon._buildSidebarExprForCurrentClient();
      }
      if (daemon.sidebarExpr) {
        const ev = await entry.session.evaluate(daemon.sidebarExpr, false, 3500).catch(() => null);
        if (ev === null) {
          recordChannelFailure(entry, 'sidebar', { now });
        } else {
          entry.sidebarMounted = true;
          recordChannelSuccess(entry, 'sidebar', { scriptId: entry.sidebarScriptId });
        }
      }
    }
  } else if (plan.needsSidebarCleanup) {
    healed = true;
    await daemon._replaceEntryNewDocScript(entry, 'sidebarScriptId', '');
    await daemon._removeSidebarBinding(entry);
    await entry.session.evaluate(daemon._buildSidebarCleanupExpression(true), false, 3500).catch(() => {});
    entry.sidebarMounted = false;
    recordChannelOff(entry, 'sidebar');
  }

  // Channel 4: Host I18n
  const runHostI18nHeal = afterCh1Heal
    ? plan.hostI18nEnabled && !plan.hostI18nSkippedSameSig
    : plan.needsHostI18nHeal || plan.needsIsoHostI18nSync;
  if (runHostI18nHeal) {
    if (!isChannelInCooldown(entry, 'hostI18n', now)) {
      healed = true;
      let isoHealRes = null;
      if (plan.expectedHostI18nMode === 'off') {
        isoHealRes = await daemon._syncIsolatedHostI18n(entry, true, { skipNoExt: true });
      }
      let evaluatedHostI18nHeal = false;
      if (
        plan.hostI18nEnabled &&
        !plan.hostI18nSkippedSameSig &&
        (!probe.hasHostI18n || !entry.hostI18nScriptId || plan.hostI18nHashMismatch || (probe.hostI18nMode && probe.hostI18nMode !== plan.expectedHostI18nMode))
      ) {
        if (!daemon.hostI18nExpr && typeof daemon.cdp.buildHostI18nExpression === 'function') {
          const chOpts = daemon._getChannelCacheOpts(true);
          daemon.hostI18nExpr = chOpts ? daemon.cdp.buildHostI18nExpression(cfg, null, chOpts) : daemon.cdp.buildHostI18nExpression(cfg);
          if (chOpts && daemon.running) daemon._scheduleBundleCacheFlush();
        }
        if (daemon.hostI18nExpr) {
          const hiSig = daemon._getHostI18nCfgSig(cfg);
          if (!entry.hostI18nScriptId || plan.hostI18nHashMismatch) {
            const hiId = await daemon._replaceEntryNewDocScript(entry, 'hostI18nScriptId', daemon.hostI18nExpr);
            if (hiId) entry.lastHostI18nScriptSig = hiSig;
          }
          if (!probe.hasHostI18n || plan.hostI18nHashMismatch || (probe.hostI18nMode && probe.hostI18nMode !== plan.expectedHostI18nMode)) {
            const evalRes = await entry.session.evaluate(daemon.hostI18nExpr, false, 4500).catch(() => null);
            if (evalRes?.skippedByLiveCfg) {
              entry.hostI18nMounted = false;
              entry.hostI18nSkippedByLiveCfg = true;
              entry.lastHostI18nSig = hiSig;
              recordChannelSkipped(entry, 'hostI18n', { codeHash: hiSig });
            } else if (evalRes && evalRes.ok) {
              entry.hostI18nMounted = true;
              entry.hostI18nSkippedByLiveCfg = false;
              entry.lastHostI18nSig = hiSig;
              evaluatedHostI18nHeal = !evalRes.reused;
              recordChannelSuccess(entry, 'hostI18n', { codeHash: hiSig, scriptId: entry.hostI18nScriptId });
            } else {
              recordChannelFailure(entry, 'hostI18n', { now });
            }
          }
        }
      }
      if (plan.expectedHostI18nMode === 'off' && isoHealRes && isoHealRes.newlyPaused && !evaluatedHostI18nHeal) {
        await daemon._forceMainWorldHostI18nOffRescan(entry);
      } else if (plan.expectedHostI18nMode !== 'off' && entry.isolatedHostI18nPaused) {
        await daemon._syncIsolatedHostI18n(entry, false);
      }
    }
  } else if (plan.needsHostI18nCleanup) {
    healed = true;
    await daemon._replaceEntryNewDocScript(entry, 'hostI18nScriptId', '');
    await entry.session.evaluate(daemon._getHostI18nCleanupExpression(), false, 3500).catch(() => {});
    entry.hostI18nMounted = false;
    entry.hostI18nSkippedByLiveCfg = false;
    entry.lastHostI18nSig = '';
    entry.lastHostI18nScriptSig = '';
    recordChannelOff(entry, 'hostI18n');
    if (entry.isolatedHostI18nPaused) await daemon._syncIsolatedHostI18n(entry, false);
  } else if (afterCh1Heal && plan.expectedHostI18nMode !== 'off' && entry.isolatedHostI18nPaused) {
    await daemon._syncIsolatedHostI18n(entry, false);
  }

  // Channel 8: Periodic Picker
  if ((plan.periodicPickerEnabled && plan.needsPeriodicPickerHeal) || (!plan.periodicPickerEnabled && plan.needsPeriodicPickerCleanup)) {
    if (!plan.needsPeriodicPickerHeal || !isChannelInCooldown(entry, 'periodicPicker', now)) {
      healed = true;
      await daemon._syncPeriodicPickerOnEntry(entry, cfg, {
        enabled: plan.periodicPickerEnabled && plan.needsPeriodicPickerHeal,
        probe,
        runCleanup: plan.needsPeriodicPickerCleanup,
      });
    }
  }

  // Channel 10: Mascot
  if ((plan.mascotEnabled && plan.needsMascotHeal) || (!plan.mascotEnabled && plan.needsMascotCleanup)) {
    if (!plan.needsMascotHeal || !isChannelInCooldown(entry, 'mascot', now)) {
      healed = true;
      await daemon._syncMascotOnEntry(entry, cfg, {
        enabled: plan.mascotEnabled && plan.needsMascotHeal,
        probe,
        runCleanup: plan.needsMascotCleanup,
      });
    }
  }

  // Channel 12: Home Studio
  if ((plan.homeStudioEnabled && (plan.needsHomeStudioHeal || probe.needsHomeStudioChannel)) || (!plan.homeStudioEnabled && plan.needsHomeStudioCleanup)) {
    if (!(plan.needsHomeStudioHeal || probe.needsHomeStudioChannel) || !isChannelInCooldown(entry, 'homeStudio', now)) {
      healed = true;
      await daemon._syncHomeStudioOnEntry(entry, cfg, {
        enabled: plan.homeStudioEnabled && plan.hasHomeStudioOnDisk,
        probe,
        forceEval: Boolean(probe.needsHomeStudioChannel),
        runCleanup: plan.needsHomeStudioCleanup,
      });
    }
  }

  // Channel 5: Thought
  if ((afterCh1Heal && plan.thoughtEnabled) || (!afterCh1Heal && plan.needsThoughtHeal)) {
    if (!isChannelInCooldown(entry, 'thought', now)) {
      if (!afterCh1Heal) {
        healed = true;
        await entry.session.send('Runtime.addBinding', { name: THOUGHT_BINDING }, 2600).catch(() => {});
      }
      if (!daemon.thoughtExpr && typeof daemon.cdp.buildThoughtExpression === 'function') daemon._buildThoughtExprForConfig(cfg);
      if (daemon.thoughtExpr) {
        const thoughtSig = daemon._getThoughtCfgSig(cfg);
        if (!entry.thoughtScriptId) {
          const tId = await daemon._replaceEntryNewDocScript(entry, 'thoughtScriptId', daemon.thoughtExpr);
          if (tId) entry.lastThoughtScriptSig = thoughtSig;
        }
        if (afterCh1Heal || !probe.hasThought || !probe.hasThoughtSettingsUi || !entry.thoughtMounted) {
          const evalRes = await entry.session.evaluate(daemon.thoughtExpr, false, 4500).catch(() => null);
          if (evalRes && evalRes.ok) {
            entry.thoughtMounted = true;
            entry.lastThoughtSig = thoughtSig;
            recordChannelSuccess(entry, 'thought', { codeHash: thoughtSig, scriptId: entry.thoughtScriptId });
          } else {
            if (afterCh1Heal) { entry.thoughtMounted = false; entry.lastThoughtSig = ''; }
            recordChannelFailure(entry, 'thought', { now });
          }
        }
      }
    }
  } else if (plan.needsThoughtCleanup) {
    healed = true;
    await daemon._replaceEntryNewDocScript(entry, 'thoughtScriptId', '');
    await entry.session.evaluate(daemon._getThoughtCleanupExpression(), false, 3500).catch(() => {});
    entry.thoughtMounted = false;
    entry.lastThoughtSig = '';
    entry.lastThoughtScriptSig = '';
    recordChannelOff(entry, 'thought');
  }

  // Channel 6: Inline Diff
  if ((afterCh1Heal && plan.inlineDiffAvailable) || (!afterCh1Heal && plan.needsInlineDiffHeal)) {
    if (!isChannelInCooldown(entry, 'inlineDiff', now)) {
      if (!afterCh1Heal) {
        healed = true;
        await daemon._ensureInlineDiffBinding(entry, 2600, true);
      }
      if (!daemon.inlineDiffExpr && typeof daemon.cdp.buildInlineDiffInjectExpression === 'function') daemon._buildInlineDiffExprForConfig(cfg);
      if (daemon.inlineDiffExpr) {
        const inlineDiffHash = daemon._getInlineDiffExprHash(daemon.inlineDiffExpr);
        if (!entry.inlineDiffScriptId) {
          const idAdd = await daemon._replaceEntryNewDocScript(entry, 'inlineDiffScriptId', daemon.inlineDiffExpr);
          if (idAdd) entry.lastInlineDiffScriptHash = inlineDiffHash;
        }
        if (afterCh1Heal || !probe.hasInlineDiff || !entry.inlineDiffMounted) {
          const evalRes = await entry.session.evaluate(daemon.inlineDiffExpr, false, 4500).catch(() => null);
          await daemon._recordInlineDiffEvalOutcome(entry, evalRes, inlineDiffHash);
        }
      }
    }
  } else if (plan.needsInlineDiffCleanup) {
    healed = true;
    await daemon._replaceEntryNewDocScript(entry, 'inlineDiffScriptId', '');
    await entry.session.evaluate(daemon._getInlineDiffCleanupExpression(), false, 3500).catch(() => {});
    entry.inlineDiffMounted = false;
    entry.inlineDiffSkipped = false;
    entry.lastInlineDiffHash = '';
    entry.lastInlineDiffScriptHash = '';
    recordChannelOff(entry, 'inlineDiff');
  }

  // Channel 7: Wallpaper
  if ((afterCh1Heal && plan.wallpaperAvailable) || (!afterCh1Heal && plan.needsWallpaperHeal)) {
    if (!isChannelInCooldown(entry, 'wallpaper', now)) {
      if (!afterCh1Heal) healed = true;
      await daemon._ensureWallpaperBinding(entry, 2600, true);
      if (!daemon.wallpaperExpr && typeof daemon.cdp.buildWallpaperExpression === 'function') daemon._buildWallpaperExprForConfig(cfg);
      if (daemon.wallpaperExpr) {
        const wallpaperHash = daemon._getWallpaperExprHash(daemon.wallpaperExpr);
        if (!entry.wallpaperScriptId || (wallpaperHash && entry.lastWallpaperScriptHash !== wallpaperHash)) {
          const wpAdd = await daemon._replaceEntryNewDocScript(entry, 'wallpaperScriptId', daemon.wallpaperExpr);
          if (wpAdd) entry.lastWallpaperScriptHash = wallpaperHash;
        }
        if (afterCh1Heal || !probe.hasWallpaper || !probe.hasWallpaperUi || plan.wallpaperHashMismatch || !entry.wallpaperMounted) {
          const evalRes = await entry.session.evaluate(daemon.wallpaperExpr, false, 4500).catch(() => null);
          await daemon._recordWallpaperEvalOutcome(entry, evalRes, wallpaperHash);
        }
      }
    }
  } else if (plan.needsWallpaperCleanup) {
    healed = true;
    await daemon._replaceEntryNewDocScript(entry, 'wallpaperScriptId', '');
    await daemon._removeWallpaperBinding(entry);
    await entry.session.evaluate(daemon._getWallpaperCleanupExpression(), false, 3500).catch(() => {});
    entry.wallpaperMounted = false;
    entry.wallpaperSkipped = false;
    entry.lastWallpaperHash = '';
    entry.lastWallpaperScriptHash = '';
    recordChannelOff(entry, 'wallpaper');
  }

  // Channel 11: Suggester
  if ((afterCh1Heal && plan.suggesterAvailable) || (!afterCh1Heal && plan.needsSuggesterHeal)) {
    if (!isChannelInCooldown(entry, 'suggester', now)) {
      if (!afterCh1Heal) healed = true;
      await daemon._ensureSuggesterBinding(entry, 2600, true);
      if (!daemon.suggesterExpr && typeof daemon.cdp.buildSuggesterExpression === 'function') daemon._buildSuggesterExprForConfig(cfg);
      if (daemon.suggesterExpr) {
        const suggesterHash = daemon._getSuggesterExprHash(daemon.suggesterExpr);
        if (!entry.suggesterScriptId) {
          const sgAdd = await daemon._replaceEntryNewDocScript(entry, 'suggesterScriptId', daemon.suggesterExpr);
          if (sgAdd) entry.lastSuggesterScriptHash = suggesterHash;
        }
        if (afterCh1Heal || probe.hasSuggester === false || probe.hasSuggesterUi === false || !entry.suggesterMounted) {
          const evalRes = await entry.session.evaluate(daemon.suggesterExpr, false, 4500).catch(() => null);
          await daemon._recordSuggesterEvalOutcome(entry, evalRes, suggesterHash);
        }
      }
    }
  } else if (plan.needsSuggesterCleanup) {
    healed = true;
    await daemon._replaceEntryNewDocScript(entry, 'suggesterScriptId', '');
    await daemon._removeSuggesterBinding(entry);
    await entry.session.evaluate(daemon._getSuggesterCleanupExpression(), false, 3500).catch(() => {});
    entry.suggesterMounted = false;
    entry.suggesterSkipped = false;
    entry.lastSuggesterHash = '';
    entry.lastSuggesterScriptHash = '';
    recordChannelOff(entry, 'suggester');
  }

  // Channel 9: Settings
  if (plan.needsSettingsHeal && !isChannelInCooldown(entry, 'settings', now)) {
    if (!afterCh1Heal) healed = true;
    await daemon._deliverSettingsChannelToEntry(entry);
  }

  if (!afterCh1Heal && probe.needsDashboardSync) {
    healed = true;
    await entry.session
      .evaluate(
        '(() => { const cfg = window.__agPrism?.getState?.()?.cfg || {}; window.__agPrismTelemetry?.sync?.(cfg); window.__agPrism?.sync?.(); return true; })()',
        false,
        2200
      )
      .catch(() => {});
  }

  return healed;
}
