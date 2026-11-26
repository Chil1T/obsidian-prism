// 视觉与工作台独立通道构建器：通道 7（背景壁纸）、通道 8（元素周期表 3D 模型选择器）、通道 12（Studio 首页仪表盘）
'use strict';

const fs = require('fs');
const path = require('path');
const {
  getFileSig,
  sha256Text,
  computeHash,
  serializeJsonForEval,
} = require('../utils/fs-safe.cjs');
const { reconcileConfigAliases } = require('../config/schema.cjs');
const { resolveBundleCachePathOption } = require('../compiler/cache-validate.cjs');
const { minifyEmbeddedCssTemplate } = require('../compiler/js-serializer.cjs');
const { minifySingleSource } = require('../compiler/js-string-pool.cjs');
const { CHANNEL_MAIN_FRAME_HOST_GUARD } = require('./host-guard.cjs');
const { PERIODIC_PICKER_MODULE_FILES } = require('./registry.cjs');

function createStudioChannelBuilders({ rootDir, readConfig, bundleCache }) {
  function readCompiledWallpaperAssets(opts = null) {
    const clientPath = path.join(rootDir, 'vendor', 'wallpaper', 'wallpaper-client.js');
    const settingsUiPath = path.join(rootDir, 'vendor', 'wallpaper', 'wallpaper-settings-ui.js');
    if (!fs.existsSync(clientPath) || !fs.existsSync(settingsUiPath)) {
      return { sig: '', minClient: '', minSettingsUi: '', codeHash: '' };
    }
    const sig = `${getFileSig(clientPath)}|${getFileSig(settingsUiPath)}`;
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('wallpaper');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    const clientBuf = fs.readFileSync(clientPath);
    const settingsBuf = fs.readFileSync(settingsUiPath);
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'wallpaper',
      sig,
      fileEntries: [
        { rel: 'vendor/wallpaper/wallpaper-client.js', content: clientBuf },
        { rel: 'vendor/wallpaper/wallpaper-settings-ui.js', content: settingsBuf },
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

  // 第七通道独立注入（本地静态/动态背景壁纸引擎 + 5 语种设置卡片）：完全独立于 Channel 1，缺文件时安全返回 ''，支持 codeHash 幂等复用与零泄漏热卸载
  function buildWallpaperExpression(config = null, opts = null) {
    let minClient = '';
    let minSettingsUi = '';
    let codeHash = '';
    if (opts && typeof opts.customClientSource === 'string' && typeof opts.customSettingsUiSource === 'string') {
      minClient = opts.customClientSource ? minifySingleSource(opts.customClientSource) : '';
      minSettingsUi = opts.customSettingsUiSource ? minifySingleSource(opts.customSettingsUiSource) : '';
      codeHash = minClient && minSettingsUi ? computeHash(`${minClient}\n${minSettingsUi}`) : '';
    } else {
      const compiled = readCompiledWallpaperAssets(opts);
      minClient = compiled.minClient;
      minSettingsUi = compiled.minSettingsUi;
      codeHash = compiled.codeHash;
    }
    if (!minClient || !minSettingsUi || !codeHash) {
      return '';
    }

    const hashJson = serializeJsonForEval(codeHash);

    return `(() => {
  try {
${CHANNEL_MAIN_FRAME_HOST_GUARD}

    const mountSettingsSlot = () => {
      try {
        const sec = document.getElementById?.('ag-cs-settings-sec') || document.getElementById?.('ag-prism-settings-sec');
        if (sec && typeof sec.__prismMountWp === 'function') {
          sec.__prismMountWp();
          return;
        }
        const slot = document.querySelector?.('[data-testid="prism-wallpaper-slot"]');
        const fn = window.__prismMountWallpaperUi || globalThis.__prismMountWallpaperUi;
        if (slot && typeof fn === 'function') fn(slot, {});
      } catch {}
    };

    const cleanupWallpaper = () => {
      try {
        document.querySelectorAll?.('#ag-prism-wallpaper-root video')?.forEach?.((v) => {
          try { v.pause?.(); } catch {}
          try { v.removeAttribute?.('src'); } catch {}
          try { v.src = ''; } catch {}
          try { v.load?.(); } catch {}
        });
      } catch {}
      try { (window.__agPrismWallpaper || globalThis.__agPrismWallpaper)?.destroy?.(); } catch {}
      try { (window.__agPrismWallpaperBridge || globalThis.__agPrismWallpaperBridge)?.dispose?.(); } catch {}
      try { document.getElementById?.('ag-prism-wallpaper-root')?.remove?.(); } catch {}
      try { document.getElementById?.('ag-prism-wallpaper-css')?.remove?.(); } catch {}
      try {
        const slot = document.querySelector?.('[data-testid="prism-wallpaper-slot"]');
        if (slot) {
          try { slot.__agPrismWpUiHandle?.destroy?.(); } catch {}
          slot.__agPrismWpUiHandle = null;
          while (slot.firstChild) slot.removeChild(slot.firstChild);
        }
      } catch {}
      try { delete window.__agPrismWallpaper; } catch {}
      try { delete globalThis.__agPrismWallpaper; } catch {}
      try { delete window.__agPrismWallpaperFactory; } catch {}
      try { delete globalThis.__agPrismWallpaperFactory; } catch {}
      try { delete window.__agPrismWallpaperSettingsUi; } catch {}
      try { delete globalThis.__agPrismWallpaperSettingsUi; } catch {}
      try { delete window.__prismMountWallpaperUi; } catch {}
      try { delete globalThis.__prismMountWallpaperUi; } catch {}
      try { delete window.__agPrismWallpaperBridge; } catch {}
      try { delete globalThis.__agPrismWallpaperBridge; } catch {}
      try { delete window.__agPrismWallpaperResolve; } catch {}
      try { delete globalThis.__agPrismWallpaperResolve; } catch {}
    };

    const targetHash = ${hashJson};
    const mountOrReuse = () => {
      if (needDomMarkerOnReady && !hasDomMarker() && (isPlainHttpLocalhost || !/\\bantigravity\\b/i.test(String(document.title || '')))) {
        return { ok: false, status: 'skipped-non-host' };
      }
      const existing = window.__agPrismWallpaper || globalThis.__agPrismWallpaper;
      const existingUi = window.__agPrismWallpaperSettingsUi || globalThis.__agPrismWallpaperSettingsUi;
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

      cleanupWallpaper();
      ;${minClient};
      ;${minSettingsUi};

      let mounted = window.__agPrismWallpaper || globalThis.__agPrismWallpaper;
      const factory = window.__agPrismWallpaperFactory || globalThis.__agPrismWallpaperFactory;
      if (!mounted && typeof factory === 'function') {
        try {
          mounted = factory({ window, document });
        } catch {}
      }
      if (mounted && typeof mounted === 'object') {
        mounted.__prismCodeHash = targetHash;
        try { window.__agPrismWallpaper = mounted; } catch {}
        try { globalThis.__agPrismWallpaper = mounted; } catch {}
      }
      const mountedUi = window.__agPrismWallpaperSettingsUi || globalThis.__agPrismWallpaperSettingsUi;
      if (mountedUi && typeof mountedUi === 'object') {
        mountedUi.__prismCodeHash = targetHash;
        try { window.__agPrismWallpaperSettingsUi = mountedUi; } catch {}
        try { globalThis.__agPrismWallpaperSettingsUi = mountedUi; } catch {}
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
  } catch (err) {
    return { ok: false, status: 'error', channel: 'wallpaper', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  function shouldEnablePeriodicPicker(config) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    return cfg.periodicModelPicker !== 'off' && cfg.periodicModelPicker !== false;
  }

  function readCompiledPeriodicPickerAssets(opts = null) {
    const baseDir = path.join(rootDir, 'vendor', 'periodic-picker');
    const rtPath = path.join(baseDir, 'periodic-picker.js');
    if (!fs.existsSync(rtPath)) {
      return { sig: '', minRuntime: '', codeHash: '' };
    }
    const presentModules = [];
    const sigParts = [];
    for (const name of PERIODIC_PICKER_MODULE_FILES) {
      const filePath = path.join(baseDir, name);
      if (fs.existsSync(filePath)) {
        presentModules.push({ name, filePath, rel: `vendor/periodic-picker/${name}` });
        sigParts.push(`${name}:${getFileSig(filePath)}`);
      } else {
        sigParts.push(`${name}:none`);
      }
    }
    const sig = sigParts.join('|');
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('periodicPicker');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    const fileEntries = presentModules.map((mod) => ({
      rel: mod.rel,
      content: fs.readFileSync(mod.filePath),
    }));
    const extraTag = presentModules.map((mod) => mod.name).join(',');
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'periodicPicker',
      sig,
      fileEntries,
      extraTag,
      opts,
      compileFn: () => {
        const parts = [];
        for (const item of fileEntries) {
          const minPart = minifySingleSource(item.content.toString('utf8'));
          if (minPart) parts.push(minPart);
        }
        const minRuntime = parts.join(';\n');
        const codeHash = minRuntime ? computeHash(minRuntime) : '';
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

  // 第八通道独立注入（元素周期表 3D 模型选择器）：绝不打入静态主包，支持 8 模块顺序合并、.bundle-cache.json 磁盘缓存、长按呼出与 100% 对称卸载
  function buildPeriodicPickerExpression(config = null, opts = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    if (!shouldEnablePeriodicPicker(cfg)) {
      return '';
    }
    const { minRuntime, codeHash } = readCompiledPeriodicPickerAssets(opts);
    if (!minRuntime || !codeHash) {
      return '';
    }
    const hashJson = serializeJsonForEval(codeHash);

    return `(() => {
  try {
${CHANNEL_MAIN_FRAME_HOST_GUARD}

    try {
      const liveCfg = window.__agPrism?.getState?.()?.cfg;
      if (liveCfg && typeof liveCfg === 'object' && (liveCfg.periodicModelPicker === 'off' || liveCfg.periodicModelPicker === false)) {
        try {
          window.__agPrismPeriodicPicker?.destroy?.();
          document.documentElement?.removeAttribute?.('data-ag-prism-periodic-picker');
          document.documentElement?.removeAttribute?.('data-ag-pp-open');
          document.documentElement?.removeAttribute?.('data-ag-pp-holding');
          document.querySelectorAll?.('#ag-prism-periodic-picker-css, #ag-prism-periodic-picker-root, .ag-pp-hold-ring, .ag-pp-mini-keycap').forEach((n) => n.remove());
          for (const k of ['__agPrismPeriodicPicker', '__agPrismPeriodicPickerFactory', '__agPrismKeyboard3D', '__agPrismPeriodicKeyboard3D', '__agPrismOledScreen', '__agPrismGrainAssets', '__agPeriodicAudioFx', '__agPeriodicModelCatalog', '__agPeriodicHostBridge', '__agPeriodicBentoUi', '__agPeriodicPbrGrainAssets', '__agPeriodicOledScreen', '__agPeriodicKeyboard3D']) {
            try { delete window[k]; } catch {}
            try { delete globalThis[k]; } catch {}
          }
        } catch {}
        return { ok: true, status: 'off', skippedByLiveCfg: true };
      }
    } catch {}

    const targetHash = ${hashJson};
    const mountOrReuse = () => {
      if (needDomMarkerOnReady && !hasDomMarker() && (isPlainHttpLocalhost || !/\\bantigravity\\b/i.test(String(document.title || '')))) {
        return { ok: false, status: 'skipped-non-host' };
      }
      const existing = window.__agPrismPeriodicPicker;
      if (existing && existing.__prismCodeHash === targetHash) {
        const st = typeof existing.getStatus === 'function' ? existing.getStatus() : null;
        const domActive = !document.documentElement || document.documentElement.getAttribute('data-ag-prism-periodic-picker') === '1';
        if ((!st || (st.status !== 'off' && st.status !== 'destroyed' && st.mode !== 'off')) && domActive) {
          return { ok: true, reused: true, codeHash: targetHash, ...(st && typeof st === 'object' ? st : {}) };
        }
      }
      try { existing?.destroy?.(); } catch {}

      ${minRuntime};
      const factory = window.__agPrismPeriodicPickerFactory || globalThis.__agPrismPeriodicPickerFactory;
      if (!factory || typeof factory.mountPeriodicPicker !== 'function') {
        return { ok: false, status: 'factory-missing' };
      }
      const inst = factory.mountPeriodicPicker({
        root: window,
        doc: document,
        mode: 'on',
      });
      if (inst && typeof inst === 'object') {
        inst.__prismCodeHash = targetHash;
        if (!window.__agPrismPeriodicPicker) window.__agPrismPeriodicPicker = inst;
      }
      const cur = inst && typeof inst.getStatus === 'function' ? inst.getStatus() : { status: 'active' };
      return { ok: true, codeHash: targetHash, ...(cur && typeof cur === 'object' ? cur : {}) };
    };

    if (needDomMarkerOnReady && typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', () => { try { mountOrReuse(); } catch {} }, { once: true });
      return { ok: true, status: 'deferred', codeHash: targetHash };
    }
    return mountOrReuse();
  } catch (err) {
    return { ok: false, status: 'error', channel: 'periodicPicker', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  function shouldEnableHomeStudio(config = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    return (cfg.homeLayout || cfg.homeMode || 'studio') === 'studio';
  }

  function readCompiledHomeStudioAssets(opts = null) {
    const studioPath = path.join(rootDir, 'home-studio-panel.js');
    if (!fs.existsSync(studioPath)) {
      return { sig: '', minRuntime: '', codeHash: '' };
    }
    const sig = getFileSig(studioPath);
    const cachePath = resolveBundleCachePathOption(opts);
    const curMem = bundleCache.getChannelMemCache('homeStudio');
    if (!cachePath && curMem && curMem.sig === sig && curMem.codeHash) {
      return curMem;
    }
    const buf = fs.readFileSync(studioPath);
    return bundleCache.resolveChannelAssetsWithDiskCache({
      channelName: 'homeStudio',
      sig,
      fileEntries: [{ rel: 'home-studio-panel.js', content: buf }],
      opts,
      compileFn: () => {
        const minRuntime = minifySingleSource(minifyEmbeddedCssTemplate(buf.toString('utf8')));
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

  // 第十二通道独立注入（Studio 首页用量仪表盘与缓存控制器）：完全独立于 Channel 1，接入磁盘缓存，支持幂等复用、热替换旧实例与零泄漏卸载
  function buildHomeStudioChannelExpression(config = null, opts = null) {
    let resolvedCfg = config;
    let resolvedOpts = opts;
    if (
      !resolvedOpts &&
      config &&
      typeof config === 'object' &&
      ('cachePath' in config || 'noDiskCache' in config || 'deferCacheWrite' in config) &&
      !('homeLayout' in config) &&
      !('homeMode' in config)
    ) {
      resolvedOpts = config;
      resolvedCfg = null;
    }
    const cfg = resolvedCfg && typeof resolvedCfg === 'object' ? reconcileConfigAliases(resolvedCfg) : readConfig();
    if (!shouldEnableHomeStudio(cfg)) {
      return '';
    }
    const { minRuntime, codeHash } = readCompiledHomeStudioAssets(resolvedOpts);
    if (!minRuntime || !codeHash) {
      return '';
    }
    const hashJson = serializeJsonForEval(codeHash);
    return `(() => {
  try {
    try {
      if (window.self !== window.top) return { ok: false, status: 'skipped-subframe' };
    } catch {
      return { ok: false, status: 'skipped-subframe' };
    }
    try {
      const loc = typeof window !== 'undefined' && window.location;
      const href = loc && typeof loc.href === 'string' ? loc.href : '';
      if (href) {
        const low = href.toLowerCase();
        if (low.startsWith('devtools://') || low.startsWith('data:') || low.startsWith('chrome:') || low.startsWith('chrome-extension:') || low.startsWith('edge:') || low.startsWith('blob:') || low.startsWith('plugin:')) {
          return { ok: false, status: 'skipped-non-host' };
        }
      }
    } catch {}
    try {
      const liveCfg = (window.__agPrism || window.__agClaudeStyle)?.getState?.()?.cfg;
      if (liveCfg && typeof liveCfg === 'object' && (liveCfg.homeLayout || liveCfg.homeMode || 'studio') !== 'studio') {
        try { (window.__agPrism || window.__agClaudeStyle)?.detachHomeStudio?.(); } catch {}
        try { document.getElementById?.('ag-prism-studio-v101-css')?.remove?.(); } catch {}
        try { document.querySelectorAll?.('.ag-cs-home-panel-seat, .ag-cs-home-panel')?.forEach?.((n) => n.remove()); } catch {}
        try { document.documentElement?.removeAttribute?.('data-ag-prism-scope'); } catch {}
        try { delete window.__agPrismHomeStudioPanel; delete globalThis.__agPrismHomeStudioPanel; delete window.__agHomeStudioPanel; delete globalThis.__agHomeStudioPanel; } catch {}
        return { ok: true, status: 'off', skippedByLiveCfg: true };
      }
    } catch {}
    const targetHash = ${hashJson};
    const existing = globalThis.__agPrismHomeStudioPanel || window.__agPrismHomeStudioPanel || globalThis.__agHomeStudioPanel || window.__agHomeStudioPanel;
    if (existing && existing.__prismCodeHash === targetHash) {
      try {
        const api = window.__agPrism || window.__agClaudeStyle;
        if (typeof api?.syncHomeStudio === 'function') api.syncHomeStudio();
        else api?.sync?.();
      } catch {}
      return { ok: true, reused: true, codeHash: targetHash };
    }
    try { (window.__agPrism || window.__agClaudeStyle)?.detachHomeStudio?.(); } catch {}
    ${minRuntime};
    try {
      const mod = globalThis.__agPrismHomeStudioPanel || window.__agPrismHomeStudioPanel || globalThis.__agHomeStudioPanel || window.__agHomeStudioPanel;
      if (mod && typeof mod === 'object') {
        mod.__prismCodeHash = targetHash;
        window.__agPrismHomeStudioPanel = mod;
        globalThis.__agPrismHomeStudioPanel = mod;
        window.__agHomeStudioPanel = mod;
        globalThis.__agHomeStudioPanel = mod;
      }
    } catch {}
    try {
      const api = window.__agPrism || window.__agClaudeStyle;
      if (typeof api?.syncHomeStudio === 'function') api.syncHomeStudio();
      else api?.sync?.();
    } catch {}
    return { ok: true, status: 'mounted', codeHash: targetHash };
  } catch (err) {
    return { ok: false, status: 'error', channel: 'homeStudio', error: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || '').slice(0, 600) };
  }
  })()`;
  }

  return {
    PERIODIC_PICKER_MODULE_FILES,
    buildWallpaperExpression,
    shouldEnablePeriodicPicker,
    buildPeriodicPickerExpression,
    shouldEnableHomeStudio,
    buildHomeStudioChannelExpression,
  };
}

module.exports = {
  PERIODIC_PICKER_MODULE_FILES,
  createStudioChannelBuilders,
};
