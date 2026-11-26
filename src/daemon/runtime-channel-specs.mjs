// Obsidian Prism Ch13~Ch16 声明式运行期延迟通道规格表（telemetry / effortSlider / workbenchEnhancer / contextMenu，Tier 0）
// 供 daemon 协调器、下发器、广播器、自愈探针与构造函数单一真相源复用，彻底消除四通道重复样板。

export const RUNTIME_CHANNEL_SPECS = Object.freeze([
  Object.freeze({
    id: 'telemetry',
    exprField: 'telemetryExpr',
    hashField: 'telemetryCodeHash',
    hashSrcField: '_telemetryHashSource',
    scriptField: 'telemetryScriptId',
    mountedField: 'telemetryMounted',
    sigField: 'lastTelemetrySig',
    scriptSigField: 'lastTelemetryScriptSig',
    probeHasField: 'hasTelemetry',
    probeHashField: 'telemetryCodeHash',
    fallbackRel: 'vial-core.js',
    cdpShouldEnable: 'shouldEnableTelemetry',
    cdpBuild: 'buildTelemetryChannelExpression',
    cdpRemove: 'TELEMETRY_REMOVE_EXPRESSION',
    respectSkippedByLiveCfg: true,
    defaultShouldEnable: (cfg) => cfg?.telemetryModule !== 'off' && cfg?.telemetryModule !== false,
    getCfgSig: (cfg) => (cfg?.telemetryModule === 'off' || cfg?.telemetryModule === false ? 'off' : String(cfg?.telemetryModule || 'auto')),
  }),
  Object.freeze({
    id: 'effortSlider',
    exprField: 'effortSliderExpr',
    hashField: 'effortSliderCodeHash',
    hashSrcField: '_effortSliderHashSource',
    scriptField: 'effortSliderScriptId',
    mountedField: 'effortSliderMounted',
    sigField: 'lastEffortSliderSig',
    scriptSigField: 'lastEffortSliderScriptSig',
    probeHasField: 'hasEffortSlider',
    probeHashField: 'effortSliderCodeHash',
    fallbackRel: 'vendor/effort-slider/slider-coexist.js',
    cdpShouldEnable: 'shouldEnableEffortSlider',
    cdpBuild: 'buildEffortSliderChannelExpression',
    cdpRemove: 'EFFORT_SLIDER_REMOVE_EXPRESSION',
    respectSkippedByLiveCfg: true,
    defaultShouldEnable: (cfg) => {
      const raw = cfg?.effortSliderModule !== undefined ? cfg.effortSliderModule : cfg?.effortSlider;
      return raw !== 'off' && raw !== false;
    },
    getCfgSig: (cfg) => {
      const raw = cfg?.effortSliderModule !== undefined ? cfg.effortSliderModule : cfg?.effortSlider;
      if (raw === 'off' || raw === false) return 'off';
      const mem = cfg?.effortMemory === 'off' || cfg?.effortMemory === false ? 'off' : 'on';
      return `${String(raw || 'auto')}:${mem}`;
    },
  }),
  Object.freeze({
    id: 'workbenchEnhancer',
    exprField: 'workbenchEnhancerExpr',
    hashField: 'workbenchEnhancerCodeHash',
    hashSrcField: '_workbenchEnhancerHashSource',
    scriptField: 'workbenchEnhancerScriptId',
    mountedField: 'workbenchEnhancerMounted',
    sigField: 'lastWorkbenchEnhancerSig',
    scriptSigField: 'lastWorkbenchEnhancerScriptSig',
    probeHasField: 'hasWorkbenchEnhancer',
    probeHashField: 'workbenchEnhancerCodeHash',
    fallbackRel: 'host-workbench-enhancer.js',
    cdpShouldEnable: 'shouldEnableWorkbenchEnhancer',
    cdpBuild: 'buildWorkbenchEnhancerChannelExpression',
    cdpRemove: 'WORKBENCH_ENHANCER_REMOVE_EXPRESSION',
    respectSkippedByLiveCfg: true,
    defaultShouldEnable: (cfg) => {
      if (cfg?.workbenchEnhancer === 'off' || cfg?.workbenchEnhancer === false) return false;
      if (cfg?.sidebarRestyle === false && cfg?.sidebarNavFold === 'off' && cfg?.scrollBottomMotion === 'instant' && cfg?.motionLevel === 'off') {
        return false;
      }
      return true;
    },
    getCfgSig: (cfg) => {
      if (cfg?.workbenchEnhancer === 'off' || cfg?.workbenchEnhancer === false) return 'off';
      if (cfg?.sidebarRestyle === false && cfg?.sidebarNavFold === 'off' && cfg?.scrollBottomMotion === 'instant' && cfg?.motionLevel === 'off') {
        return 'off';
      }
      return 'on';
    },
  }),
  Object.freeze({
    id: 'contextMenu',
    exprField: 'contextMenuExpr',
    hashField: 'contextMenuCodeHash',
    hashSrcField: '_contextMenuHashSource',
    scriptField: 'contextMenuScriptId',
    mountedField: 'contextMenuMounted',
    sigField: 'lastContextMenuSig',
    scriptSigField: 'lastContextMenuScriptSig',
    probeHasField: 'hasContextMenu',
    probeHashField: 'contextMenuCodeHash',
    fallbackRel: 'context-menu-btw.js',
    cdpShouldEnable: 'shouldEnableContextMenu',
    cdpBuild: 'buildContextMenuChannelExpression',
    cdpRemove: 'CONTEXT_MENU_REMOVE_EXPRESSION',
    respectSkippedByLiveCfg: true,
    defaultShouldEnable: (cfg) => cfg?.contextMenu !== false && cfg?.contextMenu !== 'off',
    getCfgSig: (cfg) => (cfg?.contextMenu === false || cfg?.contextMenu === 'off' ? 'off' : 'on'),
  }),
]);

export function initRuntimeChannelDaemonFields(daemon) {
  for (const spec of RUNTIME_CHANNEL_SPECS) {
    daemon[spec.exprField] = '';
    daemon[spec.hashField] = '';
    daemon[spec.hashSrcField] = '';
  }
}

export function initRuntimeChannelEntryFields(entry) {
  for (const spec of RUNTIME_CHANNEL_SPECS) {
    entry[spec.scriptField] = null;
    entry[spec.mountedField] = false;
    entry[spec.sigField] = '';
    entry[spec.scriptSigField] = '';
  }
  return entry;
}
