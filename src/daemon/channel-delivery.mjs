// Obsidian Prism 延迟通道绑定管理、服务懒启动与单窗口增量下发/卸载（接入 Per-Channel 熔断器，Tier 1）
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OmniServer } from '../../vendor/omni-viewer/omni-server.mjs';
import {
  PKG_VERSION,
  SIDEBAR_BINDING,
  INLINE_DIFF_BINDING,
  WALLPAPER_BINDING,
  SUGGESTER_BINDING,
} from './constants.mjs';
import {
  recordChannelSuccess,
  recordChannelSkipped,
  recordChannelOff,
  recordChannelFailure,
} from './session-fsm.mjs';
import { RUNTIME_CHANNEL_SPECS } from './runtime-channel-specs.mjs';

const SIMPLE_SCRIPT_FIELDS = Object.freeze([
  ['scriptId', null],
  ['omniScriptId', 'omni'],
  ['sidebarScriptId', 'sidebar'],
  ['hostI18nScriptId', 'hostI18n'],
  ['thoughtScriptId', 'thought'],
  ['inlineDiffScriptId', 'inlineDiff'],
  ['wallpaperScriptId', 'wallpaper'],
  ['suggesterScriptId', 'suggester'],
]);

async function syncStudioManagedChannel(daemon, entry, cfgNow, spec, opts = {}) {
  const {
    expr = null,
    hash = '',
    enabled = null,
    probe = null,
    forceReplaceScript = false,
    forceEval = false,
    runCleanup = false,
    evalTimeoutMs = 4500,
    cleanupTimeoutMs = 3500,
  } = opts;
  if (!entry || entry.session.closed) return;
  const isEnabled = enabled !== null ? Boolean(enabled) : spec.checkEnabled(daemon, cfgNow);
  if (isEnabled) {
    const activeExpr = expr || daemon[spec.exprField] || spec.buildExpr(daemon, cfgNow);
    if (!activeExpr) return;
    const chHash = hash || spec.getHash(daemon, activeExpr);
    const chSig = `${spec.getCfgSig(daemon, cfgNow)}:${chHash}`;
    if (forceReplaceScript || !entry[spec.scriptField] || entry[spec.scriptSigField] !== chSig) {
      if (entry[spec.scriptField]) {
        await entry.session
          .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry[spec.scriptField] })
          .catch(() => {});
        entry[spec.scriptField] = null;
      }
      const addRes = await entry.session
        .send('Page.addScriptToEvaluateOnNewDocument', { source: activeExpr })
        .catch(() => null);
      if (addRes && addRes.identifier) {
        entry[spec.scriptField] = addRes.identifier;
        entry[spec.scriptSigField] = chSig;
      } else {
        entry[spec.scriptSigField] = '';
      }
    }
    const needsEval =
      forceEval || !probe || !probe[spec.probeHasField] || Boolean(chHash && probe[spec.probeHashField] !== chHash);
    if (needsEval && !entry.session.closed) {
      const evalRes =
        evalTimeoutMs > 0
          ? await entry.session.evaluate(activeExpr, false, evalTimeoutMs).catch(() => null)
          : await entry.session.evaluate(activeExpr).catch(() => null);
      if (evalRes && evalRes.ok) {
        if (spec.respectSkippedByLiveCfg && evalRes.skippedByLiveCfg) {
          entry[spec.mountedField] = false;
          entry[spec.sigField] = chSig;
          recordChannelSkipped(entry, spec.id, { codeHash: chHash });
        } else {
          entry[spec.mountedField] = true;
          entry[spec.sigField] = chSig;
          recordChannelSuccess(entry, spec.id, { codeHash: chHash, scriptId: entry[spec.scriptField] });
        }
      } else {
        recordChannelFailure(entry, spec.id);
      }
    }
    return;
  }

  const hadBefore = Boolean(entry[spec.scriptField] || entry[spec.mountedField]);
  if (entry[spec.scriptField]) {
    await entry.session
      .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry[spec.scriptField] })
      .catch(() => {});
    entry[spec.scriptField] = null;
  }
  if ((runCleanup || hadBefore || probe?.[spec.probeHasField]) && !entry.session.closed) {
    const cleanupExpr = spec.getCleanup(daemon);
    if (cleanupTimeoutMs > 0) {
      await entry.session.evaluate(cleanupExpr, false, cleanupTimeoutMs).catch(() => null);
    } else {
      await entry.session.evaluate(cleanupExpr).catch(() => null);
    }
  }
  entry[spec.mountedField] = false;
  entry[spec.sigField] = '';
  entry[spec.scriptSigField] = '';
  recordChannelOff(entry, spec.id);
}

const PERIODIC_SPEC = {
  id: 'periodicPicker',
  exprField: 'periodicPickerExpr',
  scriptField: 'periodicPickerScriptId',
  mountedField: 'periodicPickerMounted',
  sigField: 'lastPeriodicPickerSig',
  scriptSigField: 'lastPeriodicPickerScriptSig',
  probeHasField: 'hasPeriodicPicker',
  probeHashField: 'periodicPickerCodeHash',
  checkEnabled: (d, cfg) => d._hasPeriodicPickerFile() && d._isPeriodicPickerEnabled(cfg),
  buildExpr: (d, cfg) => d._buildPeriodicPickerExprForConfig(cfg),
  getHash: (d, e) => d._getPeriodicPickerExprHash(e),
  getCfgSig: (d, cfg) => d._getPeriodicPickerCfgSig(cfg),
  getCleanup: (d) => d._getPeriodicPickerCleanupExpression(),
};

const MASCOT_SPEC = {
  id: 'mascot',
  exprField: 'mascotExpr',
  scriptField: 'mascotScriptId',
  mountedField: 'mascotMounted',
  sigField: 'lastMascotSig',
  scriptSigField: 'lastMascotScriptSig',
  probeHasField: 'hasMascot',
  probeHashField: 'mascotCodeHash',
  checkEnabled: (d, cfg) => d._hasMascotFile() && d._isMascotEnabled(cfg),
  buildExpr: (d, cfg) => d._buildMascotExprForConfig(cfg),
  getHash: (d, e) => d._getMascotExprHash(e),
  getCfgSig: (d, cfg) => d._getMascotCfgSig(cfg),
  getCleanup: (d) => d._getMascotCleanupExpression(),
};

const HOME_STUDIO_SPEC = {
  id: 'homeStudio',
  exprField: 'homeStudioExpr',
  scriptField: 'homeStudioScriptId',
  mountedField: 'homeStudioMounted',
  sigField: 'lastHomeStudioSig',
  scriptSigField: 'lastHomeStudioScriptSig',
  probeHasField: 'hasHomeStudio',
  probeHashField: 'homeStudioCodeHash',
  respectSkippedByLiveCfg: true,
  checkEnabled: (d, cfg) => d._hasHomeStudioFile() && d._isHomeStudioEnabled(cfg),
  buildExpr: (d, cfg) => d._buildHomeStudioExprForConfig(cfg),
  getHash: (d, e) => d._getHomeStudioExprHash(e),
  getCfgSig: (d, cfg) => d._getHomeStudioCfgSig(cfg),
  getCleanup: (d) => d._getHomeStudioCleanupExpression(),
};

function toManagedRuntimeSpec(spec) {
  return {
    id: spec.id,
    exprField: spec.exprField,
    scriptField: spec.scriptField,
    mountedField: spec.mountedField,
    sigField: spec.sigField,
    scriptSigField: spec.scriptSigField,
    probeHasField: spec.probeHasField,
    probeHashField: spec.probeHashField,
    respectSkippedByLiveCfg: Boolean(spec.respectSkippedByLiveCfg),
    checkEnabled: (d, cfg) => d._hasRuntimeChannelFile(spec) && d._isRuntimeChannelEnabled(spec, cfg),
    buildExpr: (d, cfg) => d._buildRuntimeChannelExpr(spec, cfg),
    getHash: (d, e) => d._getRuntimeChannelExprHash(spec, e),
    getCfgSig: (d, cfg) => d._getRuntimeChannelCfgSig(spec, cfg),
    getCleanup: (d) => d._getRuntimeChannelCleanupExpression(spec),
  };
}

export const channelDeliveryMethods = {
  async _replaceEntryNewDocScript(entry, scriptProp, source) {
    if (!entry || entry.session?.closed) return null;
    if (entry[scriptProp]) {
      await entry.session
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry[scriptProp] })
        .catch(() => {});
      entry[scriptProp] = null;
    }
    if (!source) return null;
    const addRes = await entry.session
      .send('Page.addScriptToEvaluateOnNewDocument', { source })
      .catch(() => null);
    if (addRes && addRes.identifier) {
      entry[scriptProp] = addRes.identifier;
      return addRes.identifier;
    }
    return null;
  },

  async _teardownAllEntryChannelScripts(
    entry,
    session = entry?.session,
    { markSkippedNonHost = false, removeBindings = true, resetMascot = true, resetHomeStudio = true } = {}
  ) {
    if (!entry) return;
    for (const [scriptProp, chId] of SIMPLE_SCRIPT_FIELDS) {
      if (entry[scriptProp] && session && !session.closed) {
        await session
          .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry[scriptProp] })
          .catch(() => {});
      }
      entry[scriptProp] = null;
      if (chId) recordChannelOff(entry, chId);
    }
    if (removeBindings) {
      await this._removeSidebarBinding(entry);
      await this._removeInlineDiffBinding(entry);
      await this._removeWallpaperBinding(entry);
      await this._removeSuggesterBinding(entry);
    }
    entry.sidebarMounted = false;
    entry.hostI18nMounted = false;
    entry.hostI18nSkippedByLiveCfg = false;
    entry.lastHostI18nSig = '';
    entry.lastHostI18nScriptSig = '';
    entry.thoughtMounted = false;
    entry.lastThoughtSig = '';
    entry.lastThoughtScriptSig = '';
    entry.inlineDiffMounted = false;
    entry.inlineDiffSkipped = Boolean(markSkippedNonHost);
    entry.lastInlineDiffHash = '';
    entry.lastInlineDiffScriptHash = '';
    entry.wallpaperMounted = false;
    entry.wallpaperSkipped = Boolean(markSkippedNonHost);
    entry.lastWallpaperHash = '';
    entry.lastWallpaperScriptHash = '';
    entry.suggesterMounted = false;
    entry.suggesterSkipped = Boolean(markSkippedNonHost);
    entry.lastSuggesterHash = '';
    entry.lastSuggesterScriptHash = '';
    await this._resetPeriodicPickerEntryState(entry, session);
    if (resetMascot) await this._resetMascotEntryState(entry, session);
    if (resetHomeStudio) await this._resetHomeStudioEntryState(entry, session);
    for (const spec of RUNTIME_CHANNEL_SPECS) {
      await this._resetRuntimeChannelEntryState(entry, spec, session);
    }
  },

  async _resetPeriodicPickerEntryState(entry, session = entry?.session) {
    if (!entry) return;
    if (entry.periodicPickerScriptId && session && !session.closed) {
      await session
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.periodicPickerScriptId })
        .catch(() => {});
    }
    entry.periodicPickerScriptId = null;
    entry.periodicPickerMounted = false;
    entry.lastPeriodicPickerSig = '';
    entry.lastPeriodicPickerScriptSig = '';
    recordChannelOff(entry, 'periodicPicker');
  },

  async _syncPeriodicPickerOnEntry(entry, cfgNow, opts = {}) {
    return syncStudioManagedChannel(this, entry, cfgNow, PERIODIC_SPEC, opts);
  },

  async _deliverSettingsChannelToEntry(entry, executionContextId = null) {
    if (!entry || entry.session.closed) return false;
    if (entry._settingsChannelInFlight) return false;
    const expr = this._ensureSettingsExpr();
    if (!expr) return false;
    entry._settingsChannelInFlight = true;
    try {
      const evalParams = { expression: expr, returnByValue: true };
      if (typeof executionContextId === 'number' && executionContextId > 0) {
        evalParams.contextId = executionContextId;
      }
      const res = await entry.session.send('Runtime.evaluate', evalParams, 5000).catch(() => null);
      if (res && res.result && res.result.value && res.result.value.ok) {
        entry.settingsChannelDelivered = true;
        recordChannelSuccess(entry, 'settings', { codeHash: this._getSettingsExprHash(expr) });
        return true;
      }
      recordChannelFailure(entry, 'settings');
      return false;
    } finally {
      entry._settingsChannelInFlight = false;
    }
  },

  async _resetMascotEntryState(entry, session = entry?.session) {
    if (!entry) return;
    if (entry.mascotScriptId && session && !session.closed) {
      await session
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.mascotScriptId })
        .catch(() => {});
    }
    entry.mascotScriptId = null;
    entry.mascotMounted = false;
    entry.lastMascotSig = '';
    entry.lastMascotScriptSig = '';
    recordChannelOff(entry, 'mascot');
  },

  async _syncMascotOnEntry(entry, cfgNow, opts = {}) {
    return syncStudioManagedChannel(this, entry, cfgNow, MASCOT_SPEC, opts);
  },

  async _resetHomeStudioEntryState(entry, session = entry?.session) {
    if (!entry) return;
    if (entry.homeStudioScriptId && session && !session.closed) {
      await session
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.homeStudioScriptId })
        .catch(() => {});
    }
    entry.homeStudioScriptId = null;
    entry.homeStudioMounted = false;
    entry.lastHomeStudioSig = '';
    entry.lastHomeStudioScriptSig = '';
    recordChannelOff(entry, 'homeStudio');
  },

  async _syncHomeStudioOnEntry(entry, cfgNow, opts = {}) {
    return syncStudioManagedChannel(this, entry, cfgNow, HOME_STUDIO_SPEC, opts);
  },

  async _resetRuntimeChannelEntryState(entry, spec, session = entry?.session) {
    if (!entry || !spec) return;
    if (entry[spec.scriptField] && session && !session.closed) {
      await session
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry[spec.scriptField] })
        .catch(() => {});
    }
    entry[spec.scriptField] = null;
    entry[spec.mountedField] = false;
    entry[spec.sigField] = '';
    entry[spec.scriptSigField] = '';
    recordChannelOff(entry, spec.id);
  },

  async _syncRuntimeChannelOnEntry(entry, spec, cfgNow, opts = {}) {
    return syncStudioManagedChannel(this, entry, cfgNow, toManagedRuntimeSpec(spec), opts);
  },

  async _deliverHomeStudioChannelToEntry(entry, executionContextId = null) {
    if (!entry || entry.session.closed) return false;
    if (entry._homeStudioChannelInFlight) return false;
    const cfgNow = typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null;
    if (!this._hasHomeStudioFile() || !this._isHomeStudioEnabled(cfgNow)) return false;
    const expr = this.homeStudioExpr || this._buildHomeStudioExprForConfig(cfgNow);
    if (!expr) return false;
    const hsHash = this._getHomeStudioExprHash(expr);
    const hsSig = `${this._getHomeStudioCfgSig(cfgNow)}:${hsHash}`;
    entry._homeStudioChannelInFlight = true;
    try {
      if (!entry.homeStudioScriptId || entry.lastHomeStudioScriptSig !== hsSig) {
        const id = await this._replaceEntryNewDocScript(entry, 'homeStudioScriptId', expr);
        if (id) entry.lastHomeStudioScriptSig = hsSig;
      }
      const evalParams = { expression: expr, returnByValue: true };
      if (typeof executionContextId === 'number' && executionContextId > 0) {
        evalParams.contextId = executionContextId;
      }
      const res = await entry.session.send('Runtime.evaluate', evalParams, 5000).catch(() => null);
      if (res && res.result && res.result.value && res.result.value.ok) {
        entry.homeStudioMounted = !res.result.value.skippedByLiveCfg;
        entry.lastHomeStudioSig = hsSig;
        if (res.result.value.skippedByLiveCfg) {
          recordChannelSkipped(entry, 'homeStudio', { codeHash: hsHash });
        } else {
          recordChannelSuccess(entry, 'homeStudio', { codeHash: hsHash, scriptId: entry.homeStudioScriptId });
        }
        return true;
      }
      recordChannelFailure(entry, 'homeStudio');
      return false;
    } finally {
      entry._homeStudioChannelInFlight = false;
    }
  },

  _buildSidebarCleanupExpression(force = false) {
    const residueGuard = force
      ? ''
      : `const hasResidue = Boolean(
          window.__agPrismSidebar ||
          document.getElementById('ag-prism-sidebar-studio-css') ||
          document.querySelector('[data-ag-prism-sidebar-owned="1"], .ag-prism-sidebar-studio, .ag-prism-sidebar-rail, .ag-prism-sidebar-popover, .ag-prism-sidebar-modal')
        );
        if (!hasResidue) return { ok: true, status: 'clean' };`;
    return `(() => {
      try {
        ${residueGuard}
        if (document.documentElement) {
          document.documentElement.setAttribute('data-ag-prism-sidebar-studio', 'off');
        }
        try { window.__agPrismSidebar?.destroy?.({ preserveRuntimeState: false }); } catch {}
        try { delete window.__agPrismSidebar; } catch {}
        try { delete window.${SIDEBAR_BINDING}; } catch {}
        document.getElementById('ag-prism-sidebar-studio-css')?.remove();
        document.querySelectorAll('[data-ag-prism-sidebar-owned="1"], .ag-prism-sidebar-studio, .ag-prism-sidebar-rail, .ag-prism-sidebar-popover, .ag-prism-sidebar-modal').forEach((n) => n.remove());
        if (document.documentElement) {
          ['data-ag-prism-mode', 'data-ag-prism-chat-kind', 'data-ag-prism-chat-telemetry', 'data-ag-cs-space', 'data-ag-cs-space-palette', 'data-ag-cs-space-accent'].forEach((a) => document.documentElement.removeAttribute(a));
        }
        return { ok: true, status: 'cleaned' };
      } catch {}
      return { ok: true, status: 'disabled' };
    })()`;
  },

  _buildSidebarExprForCurrentClient(cacheOpts = undefined) {
    if (typeof this.cdp.buildSidebarStudioExpression !== 'function') return '';
    const meta = this._getSidebarServerMeta();
    if (!this._hasSafeV2SidebarClientFile()) {
      return this.cdp.buildSidebarStudioExpression(meta, '');
    }
    const opts = cacheOpts !== undefined ? cacheOpts : this._getChannelCacheOpts(true);
    const expr = opts
      ? this.cdp.buildSidebarStudioExpression(meta, null, opts)
      : this.cdp.buildSidebarStudioExpression(meta);
    if (cacheOpts === undefined && opts && this.running) this._scheduleBundleCacheFlush();
    return expr;
  },

  _pickActiveSidebarHostEntry() {
    for (const entry of this.sessions.values()) {
      if (entry && !entry.session?.closed && entry.sidebarHostVerified === true) return entry;
    }
    return null;
  },

  _getSidebarServerMeta() {
    return {
      binding: SIDEBAR_BINDING,
      version: this.cdp?.PLUGIN_VERSION || PKG_VERSION,
      schemaVersion: 2,
      serviceReady:
        !this._sidebarStopped &&
        typeof this.sidebarService?.handleRpc === 'function' &&
        !this.sidebarService.getBootDiagnostic?.(),
    };
  },

  async _ensureSidebarBinding(entry, timeoutMs = 2600, force = false) {
    if (!entry || entry.session.closed) return false;
    if (!force && entry.sidebarBindingAdded) return true;
    const ok = await entry.session.send('Runtime.addBinding', { name: SIDEBAR_BINDING }, timeoutMs).then(() => true).catch(() => false);
    if (ok) entry.sidebarBindingAdded = true;
    return ok;
  },

  async _removeSidebarBinding(entry, timeoutMs = 2000) {
    if (!entry || entry.session.closed) return;
    if (!entry.sidebarBindingAdded) return;
    await entry.session.send('Runtime.removeBinding', { name: SIDEBAR_BINDING }, timeoutMs).catch(() => {});
    entry.sidebarBindingAdded = false;
  },

  async _ensureInlineDiffBinding(entry, timeoutMs = 2600, force = false) {
    if (!entry || entry.session.closed) return false;
    if (!force && entry.inlineDiffBindingAdded) return true;
    const ok = await entry.session.send('Runtime.addBinding', { name: INLINE_DIFF_BINDING }, timeoutMs).then(() => true).catch(() => false);
    if (ok) entry.inlineDiffBindingAdded = true;
    return ok;
  },

  async _removeInlineDiffBinding(entry, timeoutMs = 2000) {
    if (!entry || entry.session.closed) return;
    await entry.session.send('Runtime.removeBinding', { name: INLINE_DIFF_BINDING }, timeoutMs).catch(() => {});
    entry.inlineDiffBindingAdded = false;
  },

  async _recordInlineDiffEvalOutcome(entry, evalRes, inlineDiffHash) {
    const isSkipped = Boolean(evalRes && typeof evalRes.status === 'string' && evalRes.status.startsWith('skipped-'));
    if (evalRes && evalRes.ok) {
      entry.inlineDiffMounted = true;
      entry.inlineDiffSkipped = false;
      entry.lastInlineDiffHash = inlineDiffHash;
      recordChannelSuccess(entry, 'inlineDiff', { codeHash: inlineDiffHash, scriptId: entry.inlineDiffScriptId });
    } else if (isSkipped) {
      entry.inlineDiffMounted = false;
      entry.inlineDiffSkipped = true;
      entry.lastInlineDiffHash = inlineDiffHash;
      recordChannelSkipped(entry, 'inlineDiff', { codeHash: inlineDiffHash });
      if (evalRes.status === 'skipped-non-host') await this._removeInlineDiffBinding(entry);
    } else {
      entry.inlineDiffMounted = false;
      entry.inlineDiffSkipped = false;
      entry.lastInlineDiffHash = '';
      recordChannelFailure(entry, 'inlineDiff');
    }
  },

  async _ensureWallpaperBinding(entry, timeoutMs = 2600, force = false) {
    if (!entry || entry.session.closed) return false;
    if (!force && entry.wallpaperBindingAdded) return true;
    const bindingName = this.cdp?.WALLPAPER_BINDING || WALLPAPER_BINDING;
    const ok = await entry.session.send('Runtime.addBinding', { name: bindingName }, timeoutMs).then(() => true).catch(() => false);
    if (ok) entry.wallpaperBindingAdded = true;
    return ok;
  },

  async _removeWallpaperBinding(entry, timeoutMs = 2000) {
    if (!entry || entry.session.closed) return;
    const bindingName = this.cdp?.WALLPAPER_BINDING || WALLPAPER_BINDING;
    await entry.session.send('Runtime.removeBinding', { name: bindingName }, timeoutMs).catch(() => {});
    entry.wallpaperBindingAdded = false;
  },

  async _recordWallpaperEvalOutcome(entry, evalRes, wallpaperHash) {
    const isSkipped = Boolean(evalRes && typeof evalRes.status === 'string' && evalRes.status.startsWith('skipped-'));
    if (evalRes && evalRes.ok) {
      entry.wallpaperMounted = true;
      entry.wallpaperSkipped = false;
      entry.lastWallpaperHash = wallpaperHash;
      recordChannelSuccess(entry, 'wallpaper', { codeHash: wallpaperHash, scriptId: entry.wallpaperScriptId });
    } else if (isSkipped) {
      entry.wallpaperMounted = false;
      entry.wallpaperSkipped = true;
      entry.lastWallpaperHash = wallpaperHash;
      recordChannelSkipped(entry, 'wallpaper', { codeHash: wallpaperHash });
      if (evalRes.status === 'skipped-non-host') await this._removeWallpaperBinding(entry);
    } else {
      entry.wallpaperMounted = false;
      entry.wallpaperSkipped = false;
      entry.lastWallpaperHash = '';
      recordChannelFailure(entry, 'wallpaper');
    }
  },

  async ensureWallpaperService() {
    if (this._wallpaperStopped) return null;
    if (this._lazyWallpaperService) return this._lazyWallpaperService;
    if (this._wallpaperServicePromise) return this._wallpaperServicePromise;
    this._wallpaperServicePromise = (async () => {
      const svcPath = path.join(this.rootDir, 'vendor', 'wallpaper', 'wallpaper-service.mjs');
      if (!fs.existsSync(svcPath)) return null;
      const mod = await import(pathToFileURL(svcPath).href);
      const factory = mod?.createWallpaperService || mod?.default;
      if (this._wallpaperStopped || typeof factory !== 'function') return null;
      const svc = factory({ logger: (m) => this.log(m) });
      if (this._wallpaperStopped) {
        try { if (typeof svc?.dispose === 'function') await svc.dispose(); } catch {}
        return null;
      }
      this._lazyWallpaperService = svc;
      return svc;
    })();
    try { return await this._wallpaperServicePromise; } finally { this._wallpaperServicePromise = null; }
  },

  async _ensureSuggesterBinding(entry, timeoutMs = 2600, force = false) {
    if (!entry || entry.session.closed) return false;
    if (!force && entry.suggesterBindingAdded) return true;
    const bindingName = this.cdp?.SUGGESTER_BINDING || SUGGESTER_BINDING;
    const ok = await entry.session.send('Runtime.addBinding', { name: bindingName }, timeoutMs).then(() => true).catch(() => false);
    if (ok) entry.suggesterBindingAdded = true;
    return ok;
  },

  async _removeSuggesterBinding(entry, timeoutMs = 2000) {
    if (!entry || entry.session.closed) return;
    const bindingName = this.cdp?.SUGGESTER_BINDING || SUGGESTER_BINDING;
    await entry.session.send('Runtime.removeBinding', { name: bindingName }, timeoutMs).catch(() => {});
    entry.suggesterBindingAdded = false;
  },

  async _recordSuggesterEvalOutcome(entry, evalRes, suggesterHash) {
    const isSkipped = Boolean(evalRes && typeof evalRes.status === 'string' && evalRes.status.startsWith('skipped-'));
    if (evalRes && evalRes.ok) {
      entry.suggesterMounted = true;
      entry.suggesterSkipped = false;
      entry.lastSuggesterHash = suggesterHash;
      recordChannelSuccess(entry, 'suggester', { codeHash: suggesterHash, scriptId: entry.suggesterScriptId });
    } else if (isSkipped) {
      entry.suggesterMounted = false;
      entry.suggesterSkipped = true;
      entry.lastSuggesterHash = suggesterHash;
      recordChannelSkipped(entry, 'suggester', { codeHash: suggesterHash });
      if (evalRes.status === 'skipped-non-host') await this._removeSuggesterBinding(entry);
    } else {
      entry.suggesterMounted = false;
      entry.suggesterSkipped = false;
      entry.lastSuggesterHash = '';
      recordChannelFailure(entry, 'suggester');
    }
  },

  async ensureSuggesterService() {
    if (this._suggesterStopped) return null;
    if (this._lazySuggesterService) return this._lazySuggesterService;
    if (this._suggesterServicePromise) return this._suggesterServicePromise;
    this._suggesterServicePromise = (async () => {
      const svcPath = path.join(this.rootDir, 'vendor', 'prompt-suggester', 'suggester-service.mjs');
      if (!fs.existsSync(svcPath)) return null;
      const mod = await import(pathToFileURL(svcPath).href);
      const factory = mod?.createPromptSuggesterService || mod?.default;
      if (this._suggesterStopped || typeof factory !== 'function') return null;
      const svc = factory({ getTranslatorService: () => this.ensureThoughtService() });
      if (this._suggesterStopped) {
        try { if (typeof svc?.dispose === 'function') await svc.dispose(); } catch {}
        return null;
      }
      this._lazySuggesterService = svc;
      return svc;
    })();
    try { return await this._suggesterServicePromise; } finally { this._suggesterServicePromise = null; }
  },

  async ensureSidebarService() {
    if (this._sidebarStopped) return null;
    if (this.sidebarService) return this.sidebarService;
    if (this._sidebarServicePromise) return this._sidebarServicePromise;
    this._sidebarServicePromise = (async () => {
      const svcPath = path.join(this.rootDir, 'vendor', 'sidebar-studio', 'sidebar-service.mjs');
      if (!fs.existsSync(svcPath)) return null;
      const mod = await import(pathToFileURL(svcPath).href);
      const Ctor = mod?.SidebarStudioService || mod?.default;
      if (this._sidebarStopped || typeof Ctor !== 'function') return null;

      let hostAdapter = null;
      const adapterPath = path.join(this.rootDir, 'vendor', 'sidebar-studio', 'live-host-adapter.mjs');
      if (fs.existsSync(adapterPath)) {
        try {
          const adapterMod = await import(pathToFileURL(adapterPath).href);
          if (typeof adapterMod?.createLiveHostAdapter === 'function') {
            hostAdapter = adapterMod.createLiveHostAdapter({
              logger: (m) => this.log(m),
              evaluateInHost: async (expr, timeoutMs = 4500) => {
                const entry = this._pickActiveSidebarHostEntry();
                if (!entry || entry.session.closed) return { ok: false, error: 'no-verified-host-window' };
                return entry.session.evaluate(expr, true, timeoutMs);
              },
            });
          }
        } catch {}
      }

      const svc = new Ctor({ logger: (m) => this.log(m), hostAdapter });
      this.sidebarService = svc;
      if (typeof this.cdp.buildSidebarStudioExpression === 'function') {
        this.sidebarExpr = this._buildSidebarExprForCurrentClient();
      }
      return svc;
    })();
    try { return await this._sidebarServicePromise; } finally { this._sidebarServicePromise = null; }
  },

  async ensureOmniServer() {
    if (this.omniServer && this.omniServer.running) return this.omniServer;
    if (this._omniServerPromise) return this._omniServerPromise;
    this._omniServerPromise = (async () => {
      const srv = new OmniServer({ rootDir: this.rootDir, execHooks: this._omniExecHooks });
      await srv.start();
      this.omniServer = srv;
      if (typeof this.cdp.buildOmniClientExpression === 'function') {
        const opts = this._getChannelCacheOpts(true);
        this.omniExpr = opts
          ? this.cdp.buildOmniClientExpression(srv.getServerInfo(), null, opts)
          : this.cdp.buildOmniClientExpression(srv.getServerInfo());
        if (opts && this.running) this._scheduleBundleCacheFlush();
      }
      return srv;
    })();
    try { return await this._omniServerPromise; } finally { this._omniServerPromise = null; }
  },
};
