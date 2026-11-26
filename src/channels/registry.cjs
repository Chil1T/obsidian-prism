// 声明式多通道微内核注册表（CHANNEL_REGISTRY 单一真相源 + 多通道预算报表）
'use strict';

const { reconcileConfigAliases } = require('../config/schema.cjs');
const { PERIODIC_PICKER_MODULE_FILES } = require('./builders-studio.cjs');
const { CHANNEL_TEARDOWN_MAP } = require('./channel-teardowns.cjs');

// 静态元数据清单（每个独立通道声明 id / 通道号 / 配置键 / 源文件 / 字节预算上限 / 卸载表达式）
const CHANNEL_STATIC_SPECS = Object.freeze([
  Object.freeze({
    id: 'omni',
    channelNumber: 2,
    label: 'Omni File Viewer',
    configKeys: Object.freeze(['omniModule', 'linkTarget']),
    files: Object.freeze(['vendor/omni-viewer/omni-client.js']),
    budgetBytes: 80 * 1024,
  }),
  Object.freeze({
    id: 'sidebar',
    channelNumber: 3,
    label: 'Sidebar Studio',
    configKeys: Object.freeze(['sidebarStudio']),
    files: Object.freeze(['vendor/sidebar-studio/sidebar-client.js']),
    budgetBytes: 144 * 1024,
  }),
  Object.freeze({
    id: 'hostI18n',
    channelNumber: 4,
    label: 'Host UI Localization',
    configKeys: Object.freeze(['hostLocalization', 'language']),
    files: Object.freeze([
      'vendor/host-i18n/reverse-patterns.js',
      'vendor/host-i18n/host-i18n-runtime.js',
      'vendor/host-i18n/zh-CN.json',
    ]),
    budgetBytes: 560 * 1024,
  }),
  Object.freeze({
    id: 'swarmI18n',
    channelNumber: 4.5,
    label: 'Swarm Board Localization',
    configKeys: Object.freeze(['hostLocalization', 'language']),
    files: Object.freeze([
      'vendor/host-i18n/swarm-i18n-runtime.js',
      'vendor/host-i18n/swarm-zh-CN.json',
    ]),
    budgetBytes: 48 * 1024,
  }),
  Object.freeze({
    id: 'thought',
    channelNumber: 5,
    label: 'Thought Stream Translator',
    configKeys: Object.freeze(['thoughtTranslate', 'thoughtTrigger', 'thoughtView']),
    files: Object.freeze([
      'vendor/thought-translator/thought-client.js',
      'vendor/thought-translator/thought-settings-ui.js',
    ]),
    budgetBytes: 160 * 1024,
  }),
  Object.freeze({
    id: 'inlineDiff',
    channelNumber: 6,
    label: 'Inline Diff Preview',
    configKeys: Object.freeze([]),
    files: Object.freeze(['vendor/inline-diff/inline-diff-client.js']),
    budgetBytes: 56 * 1024,
  }),
  Object.freeze({
    id: 'wallpaper',
    channelNumber: 7,
    label: 'Background Wallpaper Studio',
    configKeys: Object.freeze([]),
    files: Object.freeze([
      'vendor/wallpaper/wallpaper-client.js',
      'vendor/wallpaper/wallpaper-settings-ui.js',
    ]),
    budgetBytes: 64 * 1024,
  }),
  Object.freeze({
    id: 'periodicPicker',
    channelNumber: 8,
    label: 'Periodic 3D Model Picker',
    configKeys: Object.freeze(['periodicModelPicker']),
    files: Object.freeze(PERIODIC_PICKER_MODULE_FILES.map((name) => `vendor/periodic-picker/${name}`)),
    budgetBytes: 820 * 1024,
  }),
  Object.freeze({
    id: 'settings',
    channelNumber: 9,
    label: 'Settings Panel & Full Locales',
    configKeys: Object.freeze(['language']),
    files: Object.freeze([
      'i18n-locales.js',
      'assets/brand-mark-svg.js',
      'vendor/clawd-mascot/tavern-atlas-data.js',
      'vendor/clawd-mascot/octopath-stage-webgl.js',
      'settings-panel.js',
    ]),
    budgetBytes: 500 * 1024,
  }),
  Object.freeze({
    id: 'mascot',
    channelNumber: 10,
    label: 'Dual Mascot Rig',
    configKeys: Object.freeze(['mascot']),
    files: Object.freeze(['dual-mascot-rig.js']),
    budgetBytes: 128 * 1024,
  }),
  Object.freeze({
    id: 'suggester',
    channelNumber: 11,
    label: 'Prompt Suggester',
    configKeys: Object.freeze([]),
    files: Object.freeze([
      'vendor/prompt-suggester/suggester-client.js',
      'vendor/prompt-suggester/suggester-settings-ui.js',
    ]),
    budgetBytes: 72 * 1024,
  }),
  Object.freeze({
    id: 'homeStudio',
    channelNumber: 12,
    label: 'Home Studio Dashboard',
    configKeys: Object.freeze(['homeLayout']),
    files: Object.freeze(['home-studio-panel.js']),
    budgetBytes: 56 * 1024,
  }),
]);

function createChannelRegistry({ builders, readConfig }) {
  const alwaysEnabled = () => true;
  const specMap = new Map(CHANNEL_STATIC_SPECS.map((s) => [s.id, s]));

  const bindEntry = (id, shouldEnable, build, buildForReport) => {
    const spec = specMap.get(id);
    return Object.freeze({
      ...spec,
      shouldEnable,
      build,
      teardown: CHANNEL_TEARDOWN_MAP[id] || '',
      _buildForReport: buildForReport || ((cfg, opts) => build(cfg, opts)),
    });
  };

  const CHANNEL_REGISTRY = Object.freeze([
    bindEntry(
      'omni',
      (cfg) => {
        const c = cfg && typeof cfg === 'object' ? reconcileConfigAliases(cfg) : readConfig();
        return c.omniModule !== 'off';
      },
      builders.buildOmniClientExpression,
      (_cfg, opts) => builders.buildOmniClientExpression(null, null, opts)
    ),
    bindEntry(
      'sidebar',
      (cfg) => {
        const c = cfg && typeof cfg === 'object' ? reconcileConfigAliases(cfg) : readConfig();
        return c.sidebarStudio === 'on';
      },
      builders.buildSidebarStudioExpression,
      (_cfg, opts) => builders.buildSidebarStudioExpression(null, null, opts)
    ),
    bindEntry(
      'hostI18n',
      builders.shouldEnableHostI18n,
      builders.buildHostI18nExpression,
      (cfg, opts) => builders.buildHostI18nExpression(cfg, null, opts)
    ),
    bindEntry(
      'swarmI18n',
      builders.shouldEnableSwarmI18n,
      builders.buildSwarmI18nExpression,
      (cfg, opts) => builders.buildSwarmI18nExpression(cfg, null, opts)
    ),
    bindEntry('thought', builders.shouldEnableThought, builders.buildThoughtExpression),
    bindEntry('inlineDiff', alwaysEnabled, builders.buildInlineDiffInjectExpression),
    bindEntry('wallpaper', alwaysEnabled, builders.buildWallpaperExpression),
    bindEntry('periodicPicker', builders.shouldEnablePeriodicPicker, builders.buildPeriodicPickerExpression),
    bindEntry('settings', alwaysEnabled, builders.buildSettingsChannelExpression),
    bindEntry('mascot', builders.shouldEnableMascot, builders.buildMascotChannelExpression),
    bindEntry('suggester', alwaysEnabled, builders.buildSuggesterExpression),
    bindEntry('homeStudio', builders.shouldEnableHomeStudio, builders.buildHomeStudioChannelExpression),
  ]);

  const registryById = new Map(CHANNEL_REGISTRY.map((ch) => [ch.id, ch]));

  function findChannel(id) {
    if (typeof id !== 'string' || !id) return null;
    return registryById.get(id) || null;
  }

  function getChannelDescriptors() {
    return CHANNEL_REGISTRY.map((ch) => ({
      id: ch.id,
      channelNumber: ch.channelNumber,
      label: ch.label,
      configKeys: [...ch.configKeys],
      files: [...ch.files],
      budgetBytes: ch.budgetBytes,
      hasTeardown: typeof ch.teardown === 'string' && ch.teardown.length > 0,
    }));
  }

  function getChannelBudgetReport(config = null, opts = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    const buildOpts = opts && typeof opts === 'object' ? opts : { noDiskCache: true };
    const channels = [];
    const overBudgetChannels = [];
    let totalBytes = 0;
    let totalBudgetBytes = 0;

    for (const ch of CHANNEL_REGISTRY) {
      const enabled = Boolean(ch.shouldEnable(cfg));
      let expr = '';
      if (enabled) {
        expr = String(ch._buildForReport(cfg, buildOpts) || '');
      }
      const bytes = Buffer.byteLength(expr, 'utf8');
      const withinBudget = bytes <= ch.budgetBytes;
      totalBytes += bytes;
      totalBudgetBytes += ch.budgetBytes;
      if (!withinBudget) {
        overBudgetChannels.push(ch.id);
      }
      channels.push({
        id: ch.id,
        channelNumber: ch.channelNumber,
        label: ch.label,
        enabled,
        bytes,
        budgetBytes: ch.budgetBytes,
        withinBudget,
        files: [...ch.files],
        configKeys: [...ch.configKeys],
      });
    }

    return {
      ok: overBudgetChannels.length === 0,
      totalBytes,
      totalBudgetBytes,
      overBudgetChannels,
      channels,
    };
  }

  return {
    CHANNEL_REGISTRY,
    findChannel,
    getChannelDescriptors,
    getChannelBudgetReport,
  };
}

module.exports = {
  CHANNEL_STATIC_SPECS,
  createChannelRegistry,
};
