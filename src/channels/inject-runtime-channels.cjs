// inject.js 专用的 Ch13~Ch16（telemetry / effortSlider / workbenchEnhancer / contextMenu）声明式派发辅助模块
'use strict';

const INJECT_RUNTIME_CHANNELS = Object.freeze([
  Object.freeze({
    id: 'telemetry',
    scriptKey: 'telemetryScriptId',
    mountedKey: 'telemetryMounted',
    shouldFn: 'shouldEnableTelemetry',
    buildFn: 'buildTelemetryChannelExpression',
    removeKey: 'TELEMETRY_REMOVE_EXPRESSION',
  }),
  Object.freeze({
    id: 'effortSlider',
    scriptKey: 'effortSliderScriptId',
    mountedKey: 'effortSliderMounted',
    shouldFn: 'shouldEnableEffortSlider',
    buildFn: 'buildEffortSliderChannelExpression',
    removeKey: 'EFFORT_SLIDER_REMOVE_EXPRESSION',
  }),
  Object.freeze({
    id: 'workbenchEnhancer',
    scriptKey: 'workbenchEnhancerScriptId',
    mountedKey: 'workbenchEnhancerMounted',
    shouldFn: 'shouldEnableWorkbenchEnhancer',
    buildFn: 'buildWorkbenchEnhancerChannelExpression',
    removeKey: 'WORKBENCH_ENHANCER_REMOVE_EXPRESSION',
  }),
  Object.freeze({
    id: 'contextMenu',
    scriptKey: 'contextMenuScriptId',
    mountedKey: 'contextMenuMounted',
    shouldFn: 'shouldEnableContextMenu',
    buildFn: 'buildContextMenuChannelExpression',
    removeKey: 'CONTEXT_MENU_REMOVE_EXPRESSION',
  }),
]);

function buildRuntimeChannelBundleMap(cdpMod, cfg, cacheOpts = null) {
  const out = [];
  for (const ch of INJECT_RUNTIME_CHANNELS) {
    const enabled = typeof cdpMod?.[ch.shouldFn] === 'function' ? Boolean(cdpMod[ch.shouldFn](cfg)) : false;
    const expr =
      enabled && typeof cdpMod?.[ch.buildFn] === 'function'
        ? (cacheOpts ? cdpMod[ch.buildFn](cfg, cacheOpts) : cdpMod[ch.buildFn](cfg))
        : '';
    const removeExpr = typeof cdpMod?.[ch.removeKey] === 'string' ? cdpMod[ch.removeKey] : '';
    out.push({ ...ch, enabled, expr: expr || '', removeExpr });
  }
  return out;
}

async function applyRuntimeChannelsOnce(session, cdpMod, cfg, cacheOpts = null) {
  const list = buildRuntimeChannelBundleMap(cdpMod, cfg, cacheOpts);
  for (const item of list) {
    if (item.expr) {
      await session.evaluate(item.expr).catch(() => {});
    } else if (!item.enabled && item.removeExpr) {
      await session.evaluate(item.removeExpr).catch(() => {});
    }
  }
}

async function evalRuntimeChannelsOnEntry(entry, items) {
  for (const item of items) {
    if (item.expr && item.enabled) {
      const res = await entry.session.evaluate(item.expr).catch(() => null);
      if (res && res.ok) entry[item.mountedKey] = !res.skippedByLiveCfg;
    } else if (!item.enabled && (entry[item.scriptKey] || entry[item.mountedKey])) {
      if (item.removeExpr) await entry.session.evaluate(item.removeExpr).catch(() => {});
      entry[item.mountedKey] = false;
    }
  }
}

async function syncRuntimeChannelScriptsOnEntry(entry, items) {
  for (const item of items) {
    if (entry[item.scriptKey]) {
      await entry.session
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry[item.scriptKey] })
        .catch(() => {});
      entry[item.scriptKey] = null;
    }
    if (item.expr && item.enabled) {
      const add = await entry.session
        .send('Page.addScriptToEvaluateOnNewDocument', { source: item.expr })
        .catch(() => null);
      entry[item.scriptKey] = add && add.identifier ? add.identifier : null;
    }
  }
}

const FALLBACK_THOUGHT_REMOVE_EXPRESSION =
  "(() => { try { window.__agPrismThought?.destroy?.(); } catch {} try { document.querySelectorAll('[data-testid=\"prism-thought-ai-config\"],[data-testid=\"prism-thought-general-config\"]').forEach((n) => n.remove()); } catch {} try { delete window.__agPrismThought; } catch {} try { delete globalThis.__agPrismThought; } catch {} try { delete window.__agPrismThoughtSettingsUi; } catch {} try { delete globalThis.__agPrismThoughtSettingsUi; } catch {} return { ok: true, status: 'off' }; })()";
const FALLBACK_INLINE_DIFF_REMOVE_EXPRESSION =
  "(() => { try { window.__agPrismInlineDiff?.destroy?.(); } catch {} try { document.getElementById('ag-prism-inline-diff-css')?.remove(); } catch {} try { document.querySelectorAll('.ag-cs-inline-diff-box, .ag-cs-diff-ctx-menu').forEach((n) => n.remove()); } catch {} try { delete window.__agPrismInlineDiff; } catch {} try { delete globalThis.__agPrismInlineDiff; } catch {} try { delete window.__agPrismInlineDiffFactory; } catch {} try { delete globalThis.__agPrismInlineDiffFactory; } catch {} try { delete window.__agPrismInlineDiffResolve; } catch {} return { ok: true, status: 'off' }; })()";
const ENTRY_BASE_SCRIPT_KEYS = Object.freeze([
  'scriptId', 'omniScriptId', 'sidebarScriptId', 'hostI18nScriptId',
  'thoughtScriptId', 'inlineDiffScriptId', 'periodicPickerScriptId', 'mascotScriptId',
]);

async function clearRuntimeChannelScriptsOnEntry(entry) {
  for (const ch of INJECT_RUNTIME_CHANNELS) {
    if (entry[ch.scriptKey]) {
      await entry.session
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry[ch.scriptKey] })
        .catch(() => {});
      entry[ch.scriptKey] = null;
    }
    entry[ch.mountedKey] = false;
  }
}

async function clearAllEntryScripts(entry) {
  for (const key of ENTRY_BASE_SCRIPT_KEYS) {
    if (entry[key]) {
      await entry.session
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry[key] })
        .catch(() => {});
      entry[key] = null;
    }
  }
  await clearRuntimeChannelScriptsOnEntry(entry);
}

module.exports = {
  INJECT_RUNTIME_CHANNELS,
  FALLBACK_THOUGHT_REMOVE_EXPRESSION,
  FALLBACK_INLINE_DIFF_REMOVE_EXPRESSION,
  buildRuntimeChannelBundleMap,
  applyRuntimeChannelsOnce,
  evalRuntimeChannelsOnEntry,
  syncRuntimeChannelScriptsOnEntry,
  clearRuntimeChannelScriptsOnEntry,
  clearAllEntryScripts,
};
