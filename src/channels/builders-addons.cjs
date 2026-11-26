// 扩展功能独立通道构建器：通道 5（思维链转译）、通道 9（设置面板与全量词典）、通道 10（双桌宠）、通道 11（Prompt Suggester）
'use strict';

const fs = require('fs');
const path = require('path');
const {
  getFileSig,
  sha256Text,
  computeHash,
  serializeJsonForEval,
} = require('../utils/fs-safe.cjs');
const { VALIDATORS, reconcileConfigAliases } = require('../config/schema.cjs');
const { resolveBundleCachePathOption } = require('../compiler/cache-validate.cjs');
const { minifyEmbeddedGlslTemplates } = require('../compiler/part-preprocess.cjs');
const { minifySingleSource } = require('../compiler/js-string-pool.cjs');
const { CHANNEL_MAIN_FRAME_HOST_GUARD } = require('./host-guard.cjs');

function createAddonChannelBuilders({ rootDir, readConfig, bundleCache }) {
  function shouldEnableThought(config = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    const raw = typeof cfg.thoughtTranslate === 'string' ? cfg.thoughtTranslate.trim().toLowerCase() : '';
    if (!raw || raw === 'off' || raw === 'false' || raw === '0' || raw === 'none') {
      return false;
    }
    return VALIDATORS.thoughtTranslate.includes(raw) || raw === 'on' || raw === 'auto';
  }

  function readCompiledThoughtAssets(opts = null) {
    const clientPath = path.join(rootDir, 'vendor', 'thought-translator', 'thought-client.js');
    const settingsUiPath = path.join(rootDir, 'vendor', 'thought-translator', 'thought-settings-ui.js');
    if (!fs.existsSync(clientPath) || !fs.existsSync(settingsUiPath)) {
      return { sig: '', minClient: '', minSettingsUi: '', codeHash: '' };
    }
    const sig = `${getFileSig(clientPath)}|${getFileSig(settingsUiPath)}`;
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('thought');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    const clientBuf = fs.readFileSync(clientPath);
    const settingsBuf = fs.readFileSync(settingsUiPath);
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'thought',
      sig,
      fileEntries: [
        { rel: 'vendor/thought-translator/thought-client.js', content: clientBuf },
        { rel: 'vendor/thought-translator/thought-settings-ui.js', content: settingsBuf },
      ],
      opts,
      compileFn: () => {
        const minClient = minifySingleSource(clientBuf.toString('utf8'));
        const minSettingsUi = minifySingleSource(settingsBuf.toString('utf8'));
        const codeHash = computeHash(`${minClient}\n${minSettingsUi}`);
        return { minClient, minSettingsUi, codeHash };
      },
      toCacheEntry: (assets, sourceHash) => ({
        sourceHash,
        codeHash: assets.codeHash,
        minClient: assets.minClient,
        minSettingsUi: assets.minSettingsUi,
        payloadSha256: sha256Text(`${assets.codeHash}\0${assets.minClient}\0${assets.minSettingsUi}`),
        updatedAt: Date.now(),
      }),
      fromCacheEntry: (entry) => ({
        minClient: entry.minClient,
        minSettingsUi: entry.minSettingsUi,
        codeHash: entry.codeHash,
      }),
    });
  }

  // 第五通道独立注入（思维链实时转译 + AI 渠道工作台 UI）：默认 off 态 0 B Fail-Closed，支持零刷新热插拔与无损卸载
  function buildThoughtExpression(config = null, opts = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    if (!shouldEnableThought(cfg)) {
      return '';
    }
    const { minClient, minSettingsUi, codeHash } = readCompiledThoughtAssets(opts);
    if (!minClient || !minSettingsUi) {
      return '';
    }
    const rawMode = String(cfg.thoughtTranslate || '').trim().toLowerCase();
    const normalizedBootMode = rawMode === 'machine' ? 'machine' : 'ai';
    const bootCfg = {
      ...cfg,
      thoughtTranslate: normalizedBootMode,
    };
    const bootCfgJson = serializeJsonForEval(bootCfg);
    const hashJson = serializeJsonForEval(codeHash);

    return `(() => {
${CHANNEL_MAIN_FRAME_HOST_GUARD}

    const getSettingsSec = () => {
      try {
        return document.getElementById?.('ag-cs-settings-sec') || document.getElementById?.('ag-prism-settings-sec') || null;
      } catch {
        return null;
      }
    };
    const cleanupThought = () => {
      try { window.__agPrismThought?.destroy?.(); } catch {}
      try { document.querySelectorAll?.('[data-testid="prism-thought-ai-config"], [data-testid="prism-thought-general-config"]')?.forEach?.((el) => el.remove()); } catch {}
      try { delete window.__agPrismThought; } catch {}
      try { delete globalThis.__agPrismThought; } catch {}
      try { delete window.__agPrismThoughtSettingsUi; } catch {}
      try { delete globalThis.__agPrismThoughtSettingsUi; } catch {}
      try {
        const sec = getSettingsSec();
        if (sec) {
          sec.__prismThoughtUiHandle = null;
          sec.__prismMountThoughtUi?.();
        }
      } catch {}
    };
    const getLiveCfg = () => {
      try {
        const st = window.__agPrism?.getState?.();
        return st && st.cfg && typeof st.cfg === 'object' ? st.cfg : null;
      } catch {
        return null;
      }
    };

    const bootCfg = ${bootCfgJson};
    const initialLiveCfg = getLiveCfg();
    if (initialLiveCfg && initialLiveCfg.thoughtTranslate === 'off') {
      cleanupThought();
      return { ok: true, status: 'off', skippedByLiveCfg: true };
    }

    const targetHash = ${hashJson};
    const mountOrReuse = () => {
      if (needDomMarkerOnReady && !hasDomMarker() && (isPlainHttpLocalhost || !/\\bantigravity\\b/i.test(String(document.title || '')))) {
        return { ok: false, status: 'skipped-non-host' };
      }
      const liveCfg = getLiveCfg();
      if (liveCfg && liveCfg.thoughtTranslate === 'off') {
        cleanupThought();
        return { ok: true, status: 'off', skippedByLiveCfg: true };
      }
      const effectiveCfg = liveCfg || bootCfg;
      const existingThought = window.__agPrismThought;
      const existingUi = window.__agPrismThoughtSettingsUi || globalThis.__agPrismThoughtSettingsUi;
      if (
        existingThought &&
        existingThought.__prismCodeHash === targetHash &&
        existingUi &&
        existingUi.__prismCodeHash === targetHash
      ) {
        try { existingThought.sync?.(effectiveCfg); } catch {}
        try { window.__agPrism?.syncAbsorbed?.(); } catch {}
        try { getSettingsSec()?.__prismMountThoughtUi?.(); } catch {}
        return { ok: true, reused: true, codeHash: targetHash };
      }

      cleanupThought();
      ;${minClient};
      ;${minSettingsUi};

      const mountedThought = window.__agPrismThought || globalThis.__agPrismThought;
      const mountedUi = window.__agPrismThoughtSettingsUi || globalThis.__agPrismThoughtSettingsUi;
      if (mountedThought && typeof mountedThought === 'object') {
        mountedThought.__prismCodeHash = targetHash;
        try { window.__agPrismThought = mountedThought; } catch {}
        try { globalThis.__agPrismThought = mountedThought; } catch {}
      }
      if (mountedUi && typeof mountedUi === 'object') {
        mountedUi.__prismCodeHash = targetHash;
        try { window.__agPrismThoughtSettingsUi = mountedUi; } catch {}
        try { globalThis.__agPrismThoughtSettingsUi = mountedUi; } catch {}
      }
      try { mountedThought?.sync?.(effectiveCfg); } catch {}
      try { window.__agPrism?.syncAbsorbed?.(); } catch {}
      try { getSettingsSec()?.__prismMountThoughtUi?.(); } catch {}
      return { ok: true, status: 'mounted', codeHash: targetHash };
    };

    if ((needDomMarkerOnReady || !document.documentElement) && typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', () => { try { mountOrReuse(); } catch {} }, { once: true });
      return { ok: true, status: 'deferred', codeHash: targetHash };
    }
    return mountOrReuse();
  })()`;
  }

  function readCompiledSettingsChannelAssets(opts = null) {
    const locPath = path.join(rootDir, 'i18n-locales.js');
    const setPath = path.join(rootDir, 'settings-panel.js');
    if (!fs.existsSync(locPath) || !fs.existsSync(setPath)) {
      return { sig: '', minRuntime: '', codeHash: '' };
    }
    const brandPath = path.join(rootDir, 'assets', 'brand-mark-svg.js');
    const atlasPath = path.join(rootDir, 'vendor', 'clawd-mascot', 'tavern-atlas-data.js');
    const stageGlPath = path.join(rootDir, 'vendor', 'clawd-mascot', 'octopath-stage-webgl.js');
    const hasBrand = fs.existsSync(brandPath);
    const hasAtlas = fs.existsSync(atlasPath);
    const hasStageGl = fs.existsSync(stageGlPath);
    const sig = `${getFileSig(locPath)}|${hasBrand ? getFileSig(brandPath) : '0'}|${hasAtlas ? getFileSig(atlasPath) : '0'}|${hasStageGl ? getFileSig(stageGlPath) : '0'}|${getFileSig(setPath)}`;
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('settings');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    const locBuf = fs.readFileSync(locPath);
    const brandBuf = hasBrand ? fs.readFileSync(brandPath) : null;
    const atlasBuf = hasAtlas ? fs.readFileSync(atlasPath) : null;
    const stageGlBuf = hasStageGl ? fs.readFileSync(stageGlPath) : null;
    const setBuf = fs.readFileSync(setPath);
    const fileEntries = [{ rel: 'i18n-locales.js', content: locBuf }];
    if (brandBuf) fileEntries.push({ rel: 'assets/brand-mark-svg.js', content: brandBuf });
    if (atlasBuf) fileEntries.push({ rel: 'vendor/clawd-mascot/tavern-atlas-data.js', content: atlasBuf });
    if (stageGlBuf) fileEntries.push({ rel: 'vendor/clawd-mascot/octopath-stage-webgl.js', content: stageGlBuf });
    fileEntries.push({ rel: 'settings-panel.js', content: setBuf });
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'settings',
      sig,
      fileEntries,
      opts,
      compileFn: () => {
        const parts = [minifySingleSource(locBuf.toString('utf8'))];
        if (brandBuf) parts.push(minifySingleSource(brandBuf.toString('utf8')));
        if (atlasBuf) parts.push(atlasBuf.toString('utf8').trim());
        if (stageGlBuf) parts.push(minifySingleSource(minifyEmbeddedGlslTemplates(stageGlBuf.toString('utf8'))));
        parts.push(minifySingleSource(setBuf.toString('utf8')));
        const minRuntime = parts.join(';\n');
        const codeHash = computeHash(minRuntime);
        return { minRuntime, codeHash };
      },
      toCacheEntry: (assets, sourceHash) => ({
        sourceHash,
        codeHash: assets.codeHash,
        minRuntime: assets.minRuntime,
        payloadSha256: sha256Text(`${assets.codeHash}\0${assets.minRuntime}`),
        updatedAt: Date.now(),
      }),
      fromCacheEntry: (entry) => ({
        minRuntime: entry.minRuntime,
        codeHash: entry.codeHash,
      }),
    });
  }

  // 第九通道：设置面板 + 全量 8 语言词典 + 3D 视差黑曜石星辰酒馆 WebGL2 选角舞台按需独立注入
  function buildSettingsChannelExpression(config = null, opts = null) {
    let resolvedOpts = opts;
    if (config && typeof config === 'object' && ('cachePath' in config || 'noDiskCache' in config || 'deferCacheWrite' in config) && !resolvedOpts) {
      resolvedOpts = config;
    }
    const { minRuntime, codeHash } = readCompiledSettingsChannelAssets(resolvedOpts);
    if (!minRuntime || !codeHash) {
      return '';
    }
    const hashJson = serializeJsonForEval(codeHash);
    return `(() => {
    try {
      if (window.self !== window.top) return { ok: false, status: 'skipped-subframe' };
    } catch {
      return { ok: false, status: 'skipped-subframe' };
    }
    const targetHash = ${hashJson};
    const existingPanel = globalThis.__agPrismSettingsPanel || window.__agPrismSettingsPanel;
    const existingLoc = globalThis.__agCsLocales || window.__agCsLocales;
    if (existingPanel && existingPanel.__prismCodeHash === targetHash && existingLoc && existingLoc.__isFullLocales) {
      try { (window.__agPrism || window.__agClaudeStyle)?.sync?.(); } catch {}
      return { ok: true, reused: true, codeHash: targetHash };
    }
    try {
      const staleSec = document.getElementById?.('ag-cs-settings-sec');
      if (staleSec) {
        try { staleSec.querySelector?.('[data-testid="prism-wallpaper-slot"]')?.__agPrismWpUiHandle?.destroy?.(); } catch {}
        try { staleSec.querySelector?.('[data-testid="prism-suggester-slot"]')?.__agPrismSgUiHandle?.destroy?.(); } catch {}
        try { staleSec.__agMascotStageApi?.dispose?.(); } catch {}
        try { staleSec.__prismThoughtUiHandle = null; } catch {}
        staleSec.remove?.();
      }
    } catch {}
    ${minRuntime};
    try {
      const panel = globalThis.__agPrismSettingsPanel || window.__agPrismSettingsPanel;
      if (panel && typeof panel === 'object') {
        panel.__prismCodeHash = targetHash;
        window.__agPrismSettingsPanel = panel;
      }
      const loc = globalThis.__agCsLocales || window.__agCsLocales;
      if (loc && typeof loc === 'object') {
        loc.__isFullLocales = true;
        window.__agCsLocales = loc;
      }
    } catch {}
    try { (window.__agPrism || window.__agClaudeStyle)?.sync?.(); } catch {}
    try { document.getElementById('ag-cs-settings-sec')?.__prismMountThoughtUi?.(); } catch {}
    try { document.getElementById('ag-cs-settings-sec')?.__prismMountWp?.(); } catch {}
    try { (document.getElementById('ag-cs-settings-sec') || document.getElementById('ag-prism-settings-sec'))?.__prismMountSg?.(); } catch {}
    return { ok: true, codeHash: targetHash };
  })()`;
  }

  function shouldEnableMascot(config = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    return cfg.mascot !== 'off' && cfg.mascot !== false;
  }

  function readCompiledMascotAssets(opts = null) {
    const mascotPath = path.join(rootDir, 'dual-mascot-rig.js');
    if (!fs.existsSync(mascotPath)) {
      return { sig: '', minRuntime: '', codeHash: '' };
    }
    const sig = getFileSig(mascotPath);
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('mascot');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    const buf = fs.readFileSync(mascotPath);
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'mascot',
      sig,
      fileEntries: [{ rel: 'dual-mascot-rig.js', content: buf }],
      opts,
      compileFn: () => {
        const minRuntime = minifySingleSource(buf.toString('utf8'));
        const codeHash = computeHash(minRuntime);
        return { minRuntime, codeHash };
      },
      toCacheEntry: (assets, sourceHash) => ({
        sourceHash,
        codeHash: assets.codeHash,
        minRuntime: assets.minRuntime,
        payloadSha256: sha256Text(`${assets.codeHash}\0${assets.minRuntime}`),
        updatedAt: Date.now(),
      }),
      fromCacheEntry: (entry) => ({
        minRuntime: entry.minRuntime,
        codeHash: entry.codeHash,
      }),
    });
  }

  // 第十通道：双桌宠（dual-mascot-rig.js）配置门控独立注入（mascot === 'off' 时 0 B）
  function buildMascotChannelExpression(config = null, opts = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    if (!shouldEnableMascot(cfg)) {
      return '';
    }
    const { minRuntime, codeHash } = readCompiledMascotAssets(opts);
    if (!minRuntime || !codeHash) {
      return '';
    }
    const hashJson = serializeJsonForEval(codeHash);
    return `(() => {
    try {
      if (window.self !== window.top) return { ok: false, status: 'skipped-subframe' };
    } catch {
      return { ok: false, status: 'skipped-subframe' };
    }
    try {
      const liveCfg = window.__agPrism?.getState?.()?.cfg;
      if (liveCfg && (liveCfg.mascot === 'off' || liveCfg.mascot === false)) {
        try { window.__agDualMascotRig?.dispose?.(); } catch {}
        try { (window.__agPrism || window.__agClaudeStyle)?.sync?.(); } catch {}
        try {
          document.querySelectorAll?.('.ag-cs-crab, .ag-cs-dual-stage, .ag-cs-crab-stage, .ag-cs-mascot-stage, .ag-v2-mascot-stage, .ag-v2-habitat-prop').forEach((n) => {
            try { n.__agMascotApi?.dispose?.(); } catch {}
            n.remove?.();
          });
        } catch {}
        try { document.querySelectorAll?.('[data-ag-cs-crab-anchor]').forEach((n) => n.removeAttribute?.('data-ag-cs-crab-anchor')); } catch {}
        try { document.documentElement?.removeAttribute?.('data-ag-cs-has-crab'); document.documentElement?.removeAttribute?.('data-ag-cs-mascot-drag'); } catch {}
        try { delete window.__agDualMascotRig; delete globalThis.__agDualMascotRig; delete window.__agPrismMascotArt; delete globalThis.__agPrismMascotArt; } catch {}
        return { ok: true, status: 'off', skippedByLiveCfg: true };
      }
    } catch {}
    const targetHash = ${hashJson};
    const existing = globalThis.__agDualMascotRig || window.__agDualMascotRig;
    if (existing && existing.__prismCodeHash === targetHash) {
      try { (window.__agPrism || window.__agClaudeStyle)?.sync?.(); } catch {}
      return { ok: true, reused: true, codeHash: targetHash };
    }
    ${minRuntime};
    try {
      const mod = globalThis.__agDualMascotRig || window.__agDualMascotRig;
      if (mod && typeof mod === 'object') {
        mod.__prismCodeHash = targetHash;
        window.__agDualMascotRig = mod;
      }
    } catch {}
    try { (window.__agPrism || window.__agClaudeStyle)?.sync?.(); } catch {}
    return { ok: true, codeHash: targetHash };
  })()`;
  }

  function readCompiledSuggesterAssets(opts = null) {
    const clientPath = path.join(rootDir, 'vendor', 'prompt-suggester', 'suggester-client.js');
    const settingsUiPath = path.join(rootDir, 'vendor', 'prompt-suggester', 'suggester-settings-ui.js');
    if (!fs.existsSync(clientPath) || !fs.existsSync(settingsUiPath)) {
      return { sig: '', minClient: '', minSettingsUi: '', codeHash: '' };
    }
    const sig = `${getFileSig(clientPath)}|${getFileSig(settingsUiPath)}`;
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('suggester');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    const clientBuf = fs.readFileSync(clientPath);
    const settingsBuf = fs.readFileSync(settingsUiPath);
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'suggester',
      sig,
      fileEntries: [
        { rel: 'vendor/prompt-suggester/suggester-client.js', content: clientBuf },
        { rel: 'vendor/prompt-suggester/suggester-settings-ui.js', content: settingsBuf },
      ],
      opts,
      compileFn: () => {
        const minClient = minifySingleSource(clientBuf.toString('utf8'));
        const minSettingsUi = minifySingleSource(settingsBuf.toString('utf8'));
        const codeHash = computeHash(`${minClient}\n${minSettingsUi}`);
        return { minClient, minSettingsUi, codeHash };
      },
      toCacheEntry: (assets, sourceHash) => ({
        sourceHash,
        codeHash: assets.codeHash,
        minClient: assets.minClient,
        minSettingsUi: assets.minSettingsUi,
        payloadSha256: sha256Text(`${assets.codeHash}\0${assets.minClient}\0${assets.minSettingsUi}`),
        updatedAt: Date.now(),
      }),
      fromCacheEntry: (entry) => ({
        minClient: entry.minClient,
        minSettingsUi: entry.minSettingsUi,
        codeHash: entry.codeHash,
      }),
    });
  }

  // 第十一通道独立注入（对话续写幽灵补全 + 8 语种 Beta 设置卡片）
  function buildSuggesterExpression(config = null, opts = null) {
    let resolvedOpts = opts;
    if (
      !resolvedOpts &&
      config &&
      typeof config === 'object' &&
      ('cachePath' in config || 'noDiskCache' in config || 'deferCacheWrite' in config || 'customClientSource' in config)
    ) {
      resolvedOpts = config;
    }
    let minClient = '';
    let minSettingsUi = '';
    let codeHash = '';
    if (
      resolvedOpts &&
      typeof resolvedOpts.customClientSource === 'string' &&
      typeof resolvedOpts.customSettingsUiSource === 'string'
    ) {
      minClient = resolvedOpts.customClientSource ? minifySingleSource(resolvedOpts.customClientSource) : '';
      minSettingsUi = resolvedOpts.customSettingsUiSource ? minifySingleSource(resolvedOpts.customSettingsUiSource) : '';
      codeHash = minClient && minSettingsUi ? computeHash(`${minClient}\n${minSettingsUi}`) : '';
    } else {
      const compiled = readCompiledSuggesterAssets(resolvedOpts);
      minClient = compiled.minClient;
      minSettingsUi = compiled.minSettingsUi;
      codeHash = compiled.codeHash;
    }
    if (!minClient || !minSettingsUi || !codeHash) {
      return '';
    }

    const hashJson = serializeJsonForEval(codeHash);

    return `(() => {
${CHANNEL_MAIN_FRAME_HOST_GUARD}

    const mountSettingsSlot = () => {
      try {
        const sec = document.getElementById?.('ag-cs-settings-sec') || document.getElementById?.('ag-prism-settings-sec');
        if (sec && typeof sec.__prismMountSg === 'function') {
          sec.__prismMountSg();
          return;
        }
        const slot = document.querySelector?.('[data-testid="prism-suggester-slot"]');
        const fn = window.__prismMountSuggesterUi || globalThis.__prismMountSuggesterUi;
        if (slot && typeof fn === 'function') fn(slot, {});
      } catch {}
    };

    const cleanupSuggester = () => {
      try { (window.__agPrismSuggester || globalThis.__agPrismSuggester)?.destroy?.(); } catch {}
      try { (window.__agPrismSuggesterBridge || globalThis.__agPrismSuggesterBridge)?.dispose?.(); } catch {}
      try { document.getElementById?.('ag-prism-suggester-css')?.remove?.(); } catch {}
      try { document.getElementById?.('ag-prism-model-dd-css')?.remove?.(); } catch {}
      try { document.querySelectorAll?.('[data-testid="prism-suggest-trigger"], [data-testid="prism-ghost-overlay"]')?.forEach?.((n) => n.remove()); } catch {}
      try {
        document.querySelectorAll?.('[data-ag-prism-ghost-active]')?.forEach?.((el) => {
          el.removeAttribute('data-ag-prism-ghost-active');
          el.style?.removeProperty?.('--ag-prism-ghost-min-h');
        });
      } catch {}
      try {
        const slot = document.querySelector?.('[data-testid="prism-suggester-slot"]');
        if (slot) {
          try { slot.__agPrismSgUiHandle?.destroy?.(); } catch {}
          slot.__agPrismSgUiHandle = null;
          while (slot.firstChild) slot.removeChild(slot.firstChild);
        }
      } catch {}
      try { delete window.__agPrismSuggester; } catch {}
      try { delete globalThis.__agPrismSuggester; } catch {}
      try { delete window.__agPrismSuggesterFactory; } catch {}
      try { delete globalThis.__agPrismSuggesterFactory; } catch {}
      try { delete window.__agPrismSuggesterSettingsUi; } catch {}
      try { delete globalThis.__agPrismSuggesterSettingsUi; } catch {}
      try { delete window.__prismMountSuggesterUi; } catch {}
      try { delete globalThis.__prismMountSuggesterUi; } catch {}
      try { delete window.__agPrismSuggesterBridge; } catch {}
      try { delete globalThis.__agPrismSuggesterBridge; } catch {}
      try { delete window.__agPrismSuggesterResolve; } catch {}
      try { delete globalThis.__agPrismSuggesterResolve; } catch {}
    };

    const targetHash = ${hashJson};
    const mountOrReuse = () => {
      if (needDomMarkerOnReady && !hasDomMarker() && (isPlainHttpLocalhost || !/\\bantigravity\\b/i.test(String(document.title || '')))) {
        return { ok: false, status: 'skipped-non-host' };
      }
      const existing = window.__agPrismSuggester || globalThis.__agPrismSuggester;
      const existingUi = window.__agPrismSuggesterSettingsUi || globalThis.__agPrismSuggesterSettingsUi;
      if (
        existing &&
        !existing.getDebugState?.()?.destroyed &&
        existing.__prismCodeHash === targetHash &&
        existingUi &&
        existingUi.__prismCodeHash === targetHash
      ) {
        try { existing.sync?.(); } catch {}
        mountSettingsSlot();
        return { ok: true, reused: true, codeHash: targetHash };
      }

      cleanupSuggester();
      ;${minClient};
      ;${minSettingsUi};

      let mounted = window.__agPrismSuggester || globalThis.__agPrismSuggester;
      const factory = window.__agPrismSuggesterFactory || globalThis.__agPrismSuggesterFactory;
      if (!mounted && typeof factory === 'function') {
        try {
          mounted = factory({ window, document });
        } catch {}
      }
      if (mounted && typeof mounted === 'object') {
        mounted.__prismCodeHash = targetHash;
        try { window.__agPrismSuggester = mounted; } catch {}
        try { globalThis.__agPrismSuggester = mounted; } catch {}
      }
      const mountedUi = window.__agPrismSuggesterSettingsUi || globalThis.__agPrismSuggesterSettingsUi;
      if (mountedUi && typeof mountedUi === 'object') {
        mountedUi.__prismCodeHash = targetHash;
        try { window.__agPrismSuggesterSettingsUi = mountedUi; } catch {}
        try { globalThis.__agPrismSuggesterSettingsUi = mountedUi; } catch {}
      }
      try { mounted?.sync?.(); } catch {}
      mountSettingsSlot();
      return { ok: true, status: 'mounted', codeHash: targetHash };
    };

    if ((needDomMarkerOnReady || !document.documentElement) && typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', () => { try { mountOrReuse(); } catch {} }, { once: true });
      return { ok: true, status: 'deferred', codeHash: targetHash };
    }
    return mountOrReuse();
  })()`;
  }

  return {
    shouldEnableThought,
    buildThoughtExpression,
    buildSettingsChannelExpression,
    shouldEnableMascot,
    buildMascotChannelExpression,
    buildSuggesterExpression,
  };
}

module.exports = {
  createAddonChannelBuilders,
};
