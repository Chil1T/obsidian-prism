// Phase 2A 契约测试：CONFIG_SCHEMA 单一真相源、CHANNEL_REGISTRY 微内核、cdp.js Facade 兼容与三端打包完整性
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { PURGE_DATA_FILES as MANIFEST_PURGE_DATA_FILES } from '../src/platform/install-manifest.cjs';
import { collectNativePluginEntries, createInstallManifestPayload } from '../scripts/build-common.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const cdp = require(path.join(ROOT, 'cdp.js'));

const LEGACY_CDP_EXPORTS = [
  'STYLE_ID', 'LEGACY_STYLE_ID', 'PLUGIN_VERSION',
  'SETTING_BINDING', 'LEGACY_SETTING_BINDING', 'OMNI_BINDING', 'SIDEBAR_BINDING',
  'INLINE_DIFF_BINDING', 'WALLPAPER_BINDING', 'SUGGESTER_BINDING',
  'PORT_FILE', 'PID_FILE', 'CONFIG_FILE', 'DEFAULT_CONFIG', 'VALIDATORS',
  'validateConfigEntry', 'reconcileConfigAliases',
  'isEligibleTarget', 'isSwarmSidecarUrl', 'redactSensitiveUrl',
  'readPidFromLockFile', 'parseWindowsTasklistCsv', 'inspectProcessSync',
  'matchesExpectedDaemonSignature', 'isExpectedDaemonProcess',
  'CDP_OPT_IN_SWITCH', 'LNK_MAX_FILE_BYTES', 'APP_STORAGE_MAX_BYTES',
  'assertSafeRegularFileSync', 'parseWindowsLnkBuffer', 'updateWindowsLnkArguments',
  'readWindowsLnkFileSync', 'writeWindowsLnkArgumentsSync',
  'getDefaultWindowsShortcutDirs', 'collectWindowsLnkFilesSync',
  'runWindowsShortcutAdapter', 'runWindowsShortcutAdapterAsync',
  'resolveWindowsDetachedNodeRuntime', 'probeLoopbackCdpVersionAsync',
  'probeLoopbackCdpVersionSync', 'buildWindowsHostCandidatesFromTasklist',
  'getAntigravityAppStoragePath', 'suspendAntigravityRunInBackground',
  'restoreAntigravityRunInBackground', 'requestLoopbackCdpBrowserClose',
  'isWindowsAntigravityHostAliveSync', 'runWindowsDetachedRelaunchTask',
  'IS_LINUX', 'LINUX_DESKTOP_SHADOW_MARKER', 'LINUX_GOMEMLIMIT_LINE_RE',
  'hasRemoteDebuggingPortSwitch', 'appendCdpFlagToArguments', 'stripCdpFlagFromArguments',
  'isAntigravityShortcutTarget', 'isAntigravityLinuxTarget', 'isMainAntigravityProcessSignature',
  'tokenizeDesktopExec', 'extractDesktopExecTarget', 'patchDesktopExecLine',
  'stripDesktopExecLine', 'readDesktopShadowMarker', 'isManagedPrismDesktopContent',
  'patchDesktopEntryContent', 'stripDesktopEntryContent', 'getDefaultLinuxDesktopDirs',
  'ensureLinuxDesktopShortcutsCdpFlag', 'restoreLinuxDesktopShortcutsCdpFlag',
  'readLinuxGoMemLimitFromEnvD', 'ensureAntigravityShortcutsCdpFlag',
  'ensureAntigravityShortcutsCdpFlagAsync', 'restoreAntigravityShortcutsCdpFlag',
  'extractPosixCommandExecutable', 'parseAppImageFromProcEnviron', 'parsePosixPsHostCandidates',
  'detectRunningAntigravityHostSync', 'detectRunningAntigravityHost',
  'getRelaunchPromptStatePaths', 'hasRelaunchBeenPromptedForHost', 'recordRelaunchPromptState',
  'promptUserForHostRelaunch', 'executeHostRelaunchSequence',
  'normalizeMacAppBundlePath', 'MAC_DETACHED_RELAUNCH_SH', 'LINUX_DETACHED_RELAUNCH_SH',
  'spawnDetachedHostRelaunchHelper',
  'RUNTIME_PARTS', 'SYNC_ROOT_FILES', 'REMOVE_EXPRESSION',
  'readConfig', 'writeConfig', 'invalidateConfigCache', 'readCss', 'readPort',
  'listPages', 'listSwarmTargets', 'getBrowserWsUrl', 'CdpSession',
  'minifyCss', 'minifyGlsl', 'minifyJs', 'stripJsFunctionsByName', 'prepareRuntimePart',
  'computeHash', 'buildConfigRefreshExpression', 'buildInjectExpression',
  'BUNDLE_CACHE_SCHEMA_VERSION', 'BUNDLE_CACHE_FILENAME', 'BUNDLE_CACHE_MAX_ENTRIES',
  'computeBundleSourceHash', 'computeBundleConfigHash',
  'getBundleCacheStats', 'resetBundleCacheStats', 'flushPendingBundleCache',
  'buildOmniClientExpression', 'buildSidebarStudioExpression',
  'shouldEnableHostI18n', 'readWindowsPreferredUiLanguage', 'detectSystemUiLocale',
  'resolveSystemLangNode', '_setWindowsUiLocaleReaderForTest',
  'buildHostI18nExpression', 'buildRelaunchDialogCopy', 'HOST_I18N_REMOVE_EXPRESSION',
  'shouldEnableSwarmI18n', 'buildSwarmI18nExpression', 'SWARM_I18N_REMOVE_EXPRESSION',
  'ISOLATED_HOST_I18N_PAUSE_EXPRESSION', 'ISOLATED_HOST_I18N_RESUME_EXPRESSION',
  'shouldEnableThought', 'buildThoughtExpression', 'THOUGHT_REMOVE_EXPRESSION',
  'buildInlineDiffInjectExpression', 'INLINE_DIFF_REMOVE_EXPRESSION',
  'buildWallpaperExpression', 'WALLPAPER_REMOVE_EXPRESSION',
  'PERIODIC_PICKER_MODULE_FILES', 'shouldEnablePeriodicPicker',
  'buildPeriodicPickerExpression', 'PERIODIC_PICKER_REMOVE_EXPRESSION',
  'DEFERRED_ROOT_MODULES',
  'buildSettingsChannelExpression', 'SETTINGS_REMOVE_EXPRESSION',
  'shouldEnableMascot', 'buildMascotChannelExpression', 'MASCOT_REMOVE_EXPRESSION',
  'buildSuggesterExpression', 'SUGGESTER_REMOVE_EXPRESSION',
  'shouldEnableHomeStudio', 'buildHomeStudioChannelExpression', 'HOME_STUDIO_REMOVE_EXPRESSION',
  'isSafeV2SidebarClientSource',
];

function listAllSrcCjsFiles(rootDir) {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile() && ent.name.endsWith('.cjs')) {
        out.push(path.relative(rootDir, abs).replace(/\\/g, '/'));
      }
    }
  };
  walk(path.join(rootDir, 'src'));
  return out.sort();
}

test('CONFIG_SCHEMA is the single source of truth for DEFAULT_CONFIG, VALIDATORS, and aliases', () => {
  const schema = cdp.CONFIG_SCHEMA;
  assert.ok(schema && typeof schema === 'object' && !Array.isArray(schema));
  const exampleCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));

  // VALIDATORS keys must match config.example.json 1:1
  assert.deepEqual(
    Object.keys(cdp.VALIDATORS).sort(),
    Object.keys(exampleCfg).sort(),
    'VALIDATORS derived from CONFIG_SCHEMA must match config.example.json keys'
  );

  // Every required entry in CONFIG_SCHEMA appears in DEFAULT_CONFIG with matching default
  for (const [key, def] of Object.entries(schema)) {
    if (!def.optional) {
      assert.equal(cdp.DEFAULT_CONFIG[key], def.default, `DEFAULT_CONFIG.${key} must match CONFIG_SCHEMA.${key}.default`);
    } else {
      assert.equal(Object.prototype.hasOwnProperty.call(cdp.DEFAULT_CONFIG, key), false);
    }
    if (def.type === 'enum' && def.inValidators !== false) {
      assert.deepEqual(cdp.VALIDATORS[key], def.values);
    }
  }

  // validateConfigEntry checks enum, number range, boolean, and unknown keys
  assert.equal(cdp.validateConfigEntry('palette', 'warm'), true);
  assert.equal(cdp.validateConfigEntry('palette', 'invalid-palette'), false);
  assert.equal(cdp.validateConfigEntry('pollIntervalMs', 2500), true);
  assert.equal(cdp.validateConfigEntry('pollIntervalMs', 50), false);
  assert.equal(cdp.validateConfigEntry('pollIntervalMs', 99999), false);
  assert.equal(cdp.validateConfigEntry('autoPromptCdpRelaunch', true), true);
  assert.equal(cdp.validateConfigEntry('autoPromptCdpRelaunch', 'yes'), false);
  assert.equal(cdp.validateConfigEntry('unknownConfigKey', 'x'), false);

  // reconcileConfigAliases handles legacy aliases cleanly
  const reconciled = cdp.reconcileConfigAliases({
    palette: 'claude',
    lang: 'yue',
    mascot: 'dual',
    homeMode: 'classic',
    convRipple: true,
    sidebar: 'off',
  });
  assert.equal(reconciled.palette, 'warm');
  assert.equal(reconciled.language, 'zh-CN');
  assert.equal(reconciled.lang, 'zh-CN');
  assert.equal(reconciled.mascot, 'crab');
  assert.equal(reconciled.homeLayout, 'classic');
  assert.equal(reconciled.homeMode, 'classic');
  assert.equal(reconciled.convRipple, 'medium');
  assert.equal(reconciled.sidebarRestyle, false);
  assert.equal(reconciled.sidebar, 'off');
});

test('CHANNEL_REGISTRY contract covers all 16 delayed/on-demand channels with valid metadata and gating', () => {
  const expectedIds = [
    'omni',
    'sidebar',
    'hostI18n',
    'swarmI18n',
    'thought',
    'inlineDiff',
    'wallpaper',
    'periodicPicker',
    'settings',
    'mascot',
    'suggester',
    'homeStudio',
    'telemetry',
    'effortSlider',
    'workbenchEnhancer',
    'contextMenu',
  ];

  const descriptors = cdp.getChannelDescriptors();
  assert.deepEqual(descriptors.map((d) => d.id), expectedIds);

  for (const id of expectedIds) {
    const ch = cdp.findChannel(id);
    assert.ok(ch, `findChannel('${id}') must resolve`);
    assert.equal(ch.id, id);
    assert.ok(Number.isFinite(ch.channelNumber) && ch.channelNumber >= 2);
    assert.ok(Number.isInteger(ch.budgetBytes) && ch.budgetBytes > 0);
    for (const key of ch.configKeys) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(cdp.CONFIG_SCHEMA, key),
        `Channel ${id} configKey '${key}' must exist in CONFIG_SCHEMA`
      );
    }
    for (const rel of ch.files) {
      assert.equal(
        fs.existsSync(path.join(ROOT, rel)),
        true,
        `Channel ${id} declared file missing on disk: ${rel}`
      );
    }
    assert.doesNotThrow(
      () => new vm.Script(ch.teardown),
      `Channel ${id} teardown expression must be syntactically valid JS`
    );
  }
  assert.equal(cdp.findChannel('non-existent'), null);

  // Gated channels must disable cleanly and build to empty string
  const gatedOffCfg = {
    ...cdp.DEFAULT_CONFIG,
    omniModule: 'off',
    sidebarStudio: 'off',
    hostLocalization: 'off',
    thoughtTranslate: 'off',
    periodicModelPicker: 'off',
    mascot: 'off',
    homeLayout: 'native',
    telemetryModule: 'off',
    effortSliderModule: 'off',
    sidebarNavFold: 'off',
    scrollBottomMotion: 'instant',
    sidebarRestyle: false,
    motionLevel: 'off',
    contextMenu: false,
  };
  assert.equal(cdp.findChannel('omni').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('sidebar').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('swarmI18n').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('swarmI18n').build(gatedOffCfg), '');
  assert.equal(cdp.findChannel('thought').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('thought').build(gatedOffCfg), '');
  assert.equal(cdp.findChannel('periodicPicker').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('periodicPicker').build(gatedOffCfg), '');
  assert.equal(cdp.findChannel('mascot').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('mascot').build(gatedOffCfg), '');
  assert.equal(cdp.findChannel('homeStudio').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('homeStudio').build(gatedOffCfg), '');
  assert.equal(cdp.findChannel('telemetry').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('telemetry').build(gatedOffCfg), '');
  assert.equal(cdp.findChannel('effortSlider').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('effortSlider').build(gatedOffCfg), '');
  assert.equal(cdp.findChannel('workbenchEnhancer').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('workbenchEnhancer').build(gatedOffCfg), '');
  assert.equal(cdp.findChannel('contextMenu').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('contextMenu').build(gatedOffCfg), '');

  const offReport = cdp.getChannelBudgetReport(gatedOffCfg, { noDiskCache: true });
  assert.equal(offReport.ok, true);
  for (const id of ['omni', 'sidebar', 'swarmI18n', 'thought', 'periodicPicker', 'mascot', 'homeStudio', 'telemetry', 'effortSlider', 'workbenchEnhancer', 'contextMenu']) {
    const row = offReport.channels.find((c) => c.id === id);
    assert.equal(row.enabled, false);
    assert.equal(row.bytes, 0);
  }
});

test('PURGE_DATA_FILES aligns 100% with src/platform/install-manifest.cjs and cdp.js Facade preserves all 151 legacy exports', () => {
  assert.deepEqual([...cdp.PURGE_DATA_FILES], [...MANIFEST_PURGE_DATA_FILES]);

  const missing = LEGACY_CDP_EXPORTS.filter((k) => !Object.prototype.hasOwnProperty.call(cdp, k));
  const undefs = LEGACY_CDP_EXPORTS.filter((k) => cdp[k] === undefined);
  assert.deepEqual(missing, [], `Missing legacy cdp.js exports: ${missing.join(', ')}`);
  assert.deepEqual(undefs, [], `Undefined legacy cdp.js exports: ${undefs.join(', ')}`);
  assert.equal(LEGACY_CDP_EXPORTS.length, 151);

  // Re-requiring cdp.js yields an isolated stateful instance
  const cdpPath = require.resolve(path.join(ROOT, 'cdp.js'));
  delete require.cache[cdpPath];
  const freshCdp = require(cdpPath);
  assert.notEqual(freshCdp, cdp);
  assert.equal(freshCdp.PLUGIN_VERSION, cdp.PLUGIN_VERSION);
  assert.equal(freshCdp.CHANNEL_REGISTRY.length, cdp.CHANNEL_REGISTRY.length);
});

test('Packaging collectNativePluginEntries & install-manifest.json include 100% of src/**/*.cjs modules', () => {
  const srcCjsFiles = listAllSrcCjsFiles(ROOT);
  assert.ok(srcCjsFiles.length >= 30, `Expected >= 30 src/**/*.cjs modules, got ${srcCjsFiles.length}`);

  const nativeEntries = collectNativePluginEntries();
  const entryNames = new Set(nativeEntries.map((e) => e.name));
  assert.ok(entryNames.has('native-plugin/cdp.js'), 'native-plugin/cdp.js must be packaged');
  for (const rel of srcCjsFiles) {
    assert.ok(
      entryNames.has(`native-plugin/${rel}`),
      `Packaged native-plugin missing src module: native-plugin/${rel}`
    );
  }

  const { manifest } = createInstallManifestPayload({ pluginEntries: nativeEntries });
  const manifestPaths = new Set(manifest.files.map((e) => e.path));
  assert.ok(manifestPaths.has('cdp.js'));
  for (const rel of srcCjsFiles) {
    assert.ok(manifestPaths.has(rel), `install-manifest.json missing src module: ${rel}`);
  }
});

test('Bundle source hash and channel cache automatically invalidate on 1-byte edits in src/compiler/ or src/channels/', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-src-hash-'));
  const isoCdpPath = path.join(tmpDir, 'cdp.js');
  const cachePath = path.join(tmpDir, '.bundle-cache.json');

  try {
    fs.copyFileSync(path.join(ROOT, 'cdp.js'), isoCdpPath);
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(tmpDir, 'package.json'));
    fs.copyFileSync(path.join(ROOT, 'config.example.json'), path.join(tmpDir, 'config.example.json'));
    fs.copyFileSync(path.join(ROOT, 'style.css'), path.join(tmpDir, 'style.css'));
    fs.cpSync(path.join(ROOT, 'src'), path.join(tmpDir, 'src'), { recursive: true });
    for (const part of cdp.RUNTIME_PARTS) {
      const dst = path.join(tmpDir, part);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(ROOT, part), dst);
    }
    const omniRel = path.join('vendor', 'omni-viewer', 'omni-client.js');
    fs.mkdirSync(path.dirname(path.join(tmpDir, omniRel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, omniRel), path.join(tmpDir, omniRel));

    const loadIso = () => {
      for (const k of Object.keys(require.cache)) {
        if (k.startsWith(tmpDir)) delete require.cache[k];
      }
      return require(isoCdpPath);
    };

    const iso1 = loadIso();
    const h1 = iso1.computeBundleSourceHash();
    iso1.buildOmniClientExpression(null, null, { cachePath });
    const cacheBefore = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const omniHashBefore = cacheBefore.channels.omni.sourceHash;

    // 1-byte comment edit in src/compiler/ch1-bundle.cjs invalidates Ch1 source hash
    const compilerFile = path.join(tmpDir, 'src', 'compiler', 'ch1-bundle.cjs');
    fs.appendFileSync(compilerFile, '\n// 1-byte-bust\n', 'utf8');
    const iso2 = loadIso();
    const h2 = iso2.computeBundleSourceHash();
    assert.notEqual(h2, h1, 'Editing src/compiler/ch1-bundle.cjs must invalidate computeBundleSourceHash()');

    // 1-byte comment edit in src/channels/builders-core.cjs invalidates channel disk cache sourceHash
    const channelFile = path.join(tmpDir, 'src', 'channels', 'builders-core.cjs');
    fs.appendFileSync(channelFile, '\n// 1-byte-channel-bust\n', 'utf8');
    const iso3 = loadIso();
    iso3.buildOmniClientExpression(null, null, { cachePath });
    const stats3 = iso3.getBundleCacheStats();
    assert.equal(stats3.channelDiskHits, 0, 'Channel cache must miss after src/channels edit');
    assert.equal(stats3.channelCompileRuns, 1, 'Channel must recompile after src/channels edit');
    const cacheAfter = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.notEqual(cacheAfter.channels.omni.sourceHash, omniHashBefore);
  } finally {
    for (const k of Object.keys(require.cache)) {
      if (k.startsWith(tmpDir)) delete require.cache[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
