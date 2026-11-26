// Obsidian Prism 通用通道编译协调器（消费 cdp.CHANNEL_REGISTRY 驱动延迟通道按需编译、盘缓存与哈希追踪，Tier 1）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { isAutomatedTestRuntime } from './pid-lock.mjs';
import { RUNTIME_CHANNEL_SPECS } from './runtime-channel-specs.mjs';

const require = createRequire(import.meta.url);

export function extractTargetCodeHash(expr) {
  const str = typeof expr === 'string' ? expr : '';
  if (!str) return '';
  const m = /const targetHash = "([^"]+)"/.exec(str);
  if (m && m[1]) return m[1];
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

export function hashExpressionShort(expr) {
  const str = typeof expr === 'string' ? expr : '';
  if (!str) return '';
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

export function lookupRegistryChannel(cdpMod, id) {
  if (!cdpMod || !id) return null;
  if (typeof cdpMod.findChannel === 'function') {
    const hit = cdpMod.findChannel(id);
    if (hit) return hit;
  }
  if (Array.isArray(cdpMod.CHANNEL_REGISTRY)) {
    return cdpMod.CHANNEL_REGISTRY.find((c) => c && c.id === id) || null;
  }
  return null;
}

const FALLBACK_TEARDOWNS = Object.freeze({
  omni: "(() => { try { if (document.documentElement) document.documentElement.setAttribute('data-ag-prism-omni', 'off'); window.__agPrismOmni?.destroy?.(); delete window.__agPrismOmni; delete window.__agPrismOmniServerMeta; } catch {} return { ok: true, status: 'off' }; })()",
  hostI18n: "(() => { try { window.__agPrismHostI18n?.destroy?.(); } catch {} return { ok: true, status: 'off' }; })()",
  thought: "(() => { try { window.__agPrismThought?.destroy?.(); } catch {} try { document.querySelectorAll('[data-testid=\"prism-thought-ai-config\"]').forEach((n) => n.remove()); } catch {} try { delete window.__agPrismThought; } catch {} try { delete globalThis.__agPrismThought; } catch {} try { delete window.__agPrismThoughtSettingsUi; } catch {} try { delete globalThis.__agPrismThoughtSettingsUi; } catch {} return { ok: true, status: 'off' }; })()",
  inlineDiff: "(() => { try { window.__agPrismInlineDiff?.destroy?.(); } catch {} try { document.getElementById('ag-prism-inline-diff-css')?.remove(); } catch {} try { document.querySelectorAll('.ag-cs-inline-diff-box, .ag-cs-diff-ctx-menu').forEach((n) => n.remove()); } catch {} try { delete window.__agPrismInlineDiff; } catch {} try { delete globalThis.__agPrismInlineDiff; } catch {} try { delete window.__agPrismInlineDiffFactory; } catch {} try { delete globalThis.__agPrismInlineDiffFactory; } catch {} try { delete window.__agPrismInlineDiffResolve; } catch {} return { ok: true, status: 'off' }; })()",
  wallpaper: "(() => { try { window.__agPrismWallpaper?.destroy?.(); } catch {} try { const root = document.getElementById('ag-prism-wallpaper-root'); if (root) { root.querySelectorAll('video').forEach((v) => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch {} }); root.remove(); } } catch {} try { document.getElementById('ag-prism-wallpaper-css')?.remove(); } catch {} try { document.documentElement?.removeAttribute?.('data-ag-prism-wallpaper'); } catch {} try { delete window.__agPrismWallpaper; } catch {} try { delete globalThis.__agPrismWallpaper; } catch {} try { delete window.__prismMountWallpaperUi; } catch {} try { delete globalThis.__prismMountWallpaperUi; } catch {} try { delete window.__agPrismWallpaperResolve; } catch {} return { ok: true, status: 'off' }; })()",
  suggester: "(() => { try { window.__agPrismSuggester?.destroy?.(); } catch {} try { document.getElementById('ag-prism-suggester-css')?.remove(); } catch {} try { document.getElementById('ag-prism-model-dd-css')?.remove(); } catch {} try { document.querySelectorAll('[data-testid=\"prism-suggest-trigger\"], [data-testid=\"prism-ghost-overlay\"]').forEach((n) => n.remove()); } catch {} try { document.documentElement?.removeAttribute?.('data-ag-prism-suggester'); } catch {} try { delete window.__agPrismSuggester; } catch {} try { delete globalThis.__agPrismSuggester; } catch {} try { delete window.__prismMountSuggesterUi; } catch {} try { delete globalThis.__prismMountSuggesterUi; } catch {} try { delete window.__agPrismSuggesterResolve; } catch {} return { ok: true, status: 'off' }; })()",
  periodicPicker: "(() => { try { window.__agPrismPeriodicPicker?.destroy?.(); document.documentElement?.removeAttribute?.('data-ag-prism-periodic-picker'); document.documentElement?.removeAttribute?.('data-ag-pp-open'); document.documentElement?.removeAttribute?.('data-ag-pp-holding'); document.querySelectorAll?.('#ag-prism-periodic-picker-css,#ag-prism-periodic-picker-root,.ag-pp-hold-ring,.ag-pp-mini-keycap').forEach((n) => n.remove()); for (const k of ['__agPrismPeriodicPicker','__agPrismPeriodicPickerFactory','__agPrismKeyboard3D','__agPrismPeriodicKeyboard3D','__agPrismOledScreen','__agPrismGrainAssets','__agPeriodicAudioFx','__agPeriodicModelCatalog','__agPeriodicHostBridge','__agPeriodicBentoUi','__agPeriodicPbrGrainAssets','__agPeriodicOledScreen','__agPeriodicKeyboard3D']) { try { delete window[k]; } catch {} try { delete globalThis[k]; } catch {} } } catch {} return { ok: true, status: 'off' }; })()",
  mascot: "(() => { try { window.__agDualMascotRig?.dispose?.(); } catch {} try { (window.__agPrism || window.__agClaudeStyle)?.sync?.(); } catch {} try { document.querySelectorAll?.('.ag-cs-crab, .ag-cs-dual-stage, .ag-cs-crab-stage, .ag-cs-mascot-stage, .ag-v2-mascot-stage, .ag-v2-habitat-prop').forEach((n) => { try { n.__agMascotApi?.dispose?.(); } catch {} n.remove?.(); }); } catch {} try { document.querySelectorAll?.('[data-ag-cs-crab-anchor]').forEach((n) => n.removeAttribute?.('data-ag-cs-crab-anchor')); } catch {} try { document.documentElement?.removeAttribute?.('data-ag-cs-has-crab'); document.documentElement?.removeAttribute?.('data-ag-cs-mascot-drag'); } catch {} try { delete window.__agDualMascotRig; delete globalThis.__agDualMascotRig; delete window.__agPrismMascotArt; delete globalThis.__agPrismMascotArt; } catch {} return { ok: true, status: 'off' }; })()",
  homeStudio: "(() => { try { (window.__agPrism || window.__agClaudeStyle)?.detachHomeStudio?.(); } catch {} try { document.getElementById?.('ag-prism-studio-v101-css')?.remove?.(); } catch {} try { document.querySelectorAll?.('.ag-cs-home-panel-seat, .ag-cs-home-panel')?.forEach?.((n) => n.remove()); } catch {} try { document.documentElement?.removeAttribute?.('data-ag-prism-scope'); } catch {} try { delete window.__agPrismHomeStudioPanel; delete globalThis.__agPrismHomeStudioPanel; delete window.__agHomeStudioPanel; delete globalThis.__agHomeStudioPanel; } catch {} return { ok: true, status: 'off' }; })()",
});

function hasChannelAssetFile(rootDir, cdpMod, id, fallbackRelPath) {
  if (typeof rootDir !== 'string' || !rootDir) return false;
  const reg = lookupRegistryChannel(cdpMod, id);
  const rel = Array.isArray(reg?.files) && reg.files.length > 0 ? reg.files[0] : fallbackRelPath;
  try {
    return fs.existsSync(path.join(rootDir, ...rel.split('/')));
  } catch {
    return false;
  }
}

function resolveChannelTeardown(cdpMod, id, cdpConstName) {
  if (cdpConstName && cdpMod?.[cdpConstName]) return cdpMod[cdpConstName];
  const reg = lookupRegistryChannel(cdpMod, id);
  if (reg && typeof reg.teardown === 'string' && reg.teardown) return reg.teardown;
  return FALLBACK_TEARDOWNS[id] || '';
}

export const channelCoordinatorMethods = {
  _readCdpFileSig() {
    try {
      const st = fs.statSync(path.join(this.rootDir, 'cdp.js'));
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return '';
    }
  },

  _isGitSourceDir(dirPath) {
    if (!dirPath) return false;
    try {
      const resolved = path.resolve(dirPath);
      if (this.gitRepoDir && resolved.toLowerCase() === this.gitRepoDir.toLowerCase()) return true;
      if (fs.existsSync(path.join(resolved, '.git'))) return true;
    } catch {}
    return false;
  },

  _isWritableCacheDir(dirPath) {
    if (!dirPath) return false;
    try {
      const st = fs.lstatSync(dirPath);
      if (st.isSymbolicLink() || !st.isDirectory()) return false;
      fs.accessSync(dirPath, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  },

  resolveBundleCachePath() {
    if (this._bundleCachePathOpt === false || this._bundleCachePathOpt === null) return null;
    if (typeof this._bundleCachePathOpt === 'string') {
      const trimmed = this._bundleCachePathOpt.trim();
      return trimmed ? path.resolve(trimmed) : null;
    }
    const envRaw = process.env.AG_PRISM_BUNDLE_CACHE_PATH;
    if (typeof envRaw === 'string' && envRaw.trim()) {
      const trimmed = envRaw.trim();
      if (/^(?:0|off|false|none)$/i.test(trimmed)) return null;
      return path.resolve(trimmed);
    }
    const cacheFileName =
      typeof this.cdp?.BUNDLE_CACHE_FILENAME === 'string' && this.cdp.BUNDLE_CACHE_FILENAME
        ? this.cdp.BUNDLE_CACHE_FILENAME
        : '.bundle-cache.json';

    if (!this._isGitSourceDir(this.rootDir) && this._isWritableCacheDir(this.rootDir)) {
      return path.join(this.rootDir, cacheFileName);
    }
    if (isAutomatedTestRuntime()) return null;
    try {
      const stateDir = this.resolveTelemetryDataDir();
      if (stateDir && this._isWritableCacheDir(stateDir)) {
        return path.join(stateDir, cacheFileName);
      }
    } catch {}
    return null;
  },

  _scheduleBundleCacheFlush() {
    if (this._bundleCacheFlushTimer) {
      clearTimeout(this._bundleCacheFlushTimer);
      this._bundleCacheFlushTimer = null;
    }
    this._bundleCacheFlushTimer = setTimeout(() => {
      this._bundleCacheFlushTimer = null;
      if (!this.running) return;
      try {
        this.cdp?.flushPendingBundleCache?.();
      } catch {}
    }, 350);
    if (this._bundleCacheFlushTimer && typeof this._bundleCacheFlushTimer.unref === 'function') {
      this._bundleCacheFlushTimer.unref();
    }
  },

  _getChannelCacheOpts(deferCacheWrite = true) {
    const cachePath = this.resolveBundleCachePath();
    if (!cachePath) return null;
    return deferCacheWrite ? { cachePath, deferCacheWrite: true } : { cachePath };
  },

  getRegisteredChannel(id) {
    return lookupRegistryChannel(this.cdp, id);
  },

  rebuildBundle({ forceReloadCdp = false, deferDiskCacheWrite = false } = {}) {
    const cdpPath = path.join(this.rootDir, 'cdp.js');
    const nextSig = this._readCdpFileSig();
    if (forceReloadCdp || !this.cdp || (nextSig && nextSig !== this._cdpFileSig)) {
      if (this._bundleCacheFlushTimer) {
        clearTimeout(this._bundleCacheFlushTimer);
        this._bundleCacheFlushTimer = null;
      }
      try {
        delete require.cache[require.resolve(cdpPath)];
      } catch {}
      this.cdp = require(cdpPath);
      this._loadedCdpVerifier =
        typeof this.cdp?.isExpectedDaemonProcess === 'function' ? this.cdp.isExpectedDaemonProcess : null;
      this._cdpFileSig = nextSig;
    }
    const hasReadConfig = typeof this.cdp.readConfig === 'function';
    const cfg = hasReadConfig ? this.cdp.readConfig() : null;
    if (cfg && this._configFingerprintTracker) {
      this._configFingerprintTracker.recordApplied(cfg);
    }
    const bundleCachePath = this.resolveBundleCachePath();
    const canBatchFlush = Boolean(bundleCachePath && typeof this.cdp.flushPendingBundleCache === 'function');
    const useDeferWrite = Boolean(deferDiskCacheWrite || canBatchFlush);
    const cacheOpts = bundleCachePath
      ? useDeferWrite
        ? { cachePath: bundleCachePath, deferCacheWrite: true }
        : { cachePath: bundleCachePath }
      : null;

    this.injectExpr = cacheOpts
      ? this.cdp.buildInjectExpression(cfg || undefined, cacheOpts)
      : this.cdp.buildInjectExpression(cfg || undefined);
    const m = this.injectExpr.match(/"codeHash":"([^"]+)"/);
    this.codeHash = m ? m[1] : '';

    // 消费 CHANNEL_REGISTRY 驱动标准 10 个常驻/配置门控通道（Swarm & Settings 仍严格按需延迟编译）
    const shouldBuildOmni = typeof this.cdp.buildOmniClientExpression === 'function' && this._isOmniEnabled(cfg);
    if (shouldBuildOmni) {
      const meta = this.omniServer && this.omniServer.running ? this.omniServer.getServerInfo() : null;
      const omniReg = this.getRegisteredChannel('omni');
      const buildOmni = typeof omniReg?.build === 'function' ? omniReg.build : this.cdp.buildOmniClientExpression;
      this.omniExpr = cacheOpts ? buildOmni(meta, null, cacheOpts) : buildOmni(meta);
    } else {
      this.omniExpr = '';
    }

    const shouldBuildSidebar =
      typeof this.cdp.buildSidebarStudioExpression === 'function' && (!hasReadConfig || this._isSidebarStudioEnabled(cfg));
    this.sidebarExpr = shouldBuildSidebar ? this._buildSidebarExprForCurrentClient(cacheOpts) : '';

    const shouldBuildHostI18n = typeof this.cdp.buildHostI18nExpression === 'function' && this._isHostI18nEnabled(cfg);
    if (shouldBuildHostI18n) {
      const hostReg = this.getRegisteredChannel('hostI18n');
      const buildHost = typeof hostReg?.build === 'function' ? hostReg.build : this.cdp.buildHostI18nExpression;
      this.hostI18nExpr = cacheOpts ? buildHost(cfg, null, cacheOpts) : buildHost(cfg);
    } else {
      this.hostI18nExpr = '';
    }

    // Swarm 与 Settings 保持按需延迟编译（避免启动期额外编译与保持 10 通道冷/热盘缓存统计不回归）
    this.swarmI18nExpr = '';
    this.swarmI18nCodeHash = '';
    this._buildThoughtExprForConfig(cfg, cacheOpts);
    this._buildInlineDiffExprForConfig(cfg, cacheOpts);
    this._buildWallpaperExprForConfig(cfg, cacheOpts);
    this._buildPeriodicPickerExprForConfig(cfg, cacheOpts);
    this.settingsExpr = '';
    this.settingsCodeHash = '';
    this._settingsHashSource = '';
    this._buildMascotExprForConfig(cfg, cacheOpts);
    this._buildSuggesterExprForConfig(cfg, cacheOpts);
    this._buildHomeStudioExprForConfig(cfg, cacheOpts);
    for (const spec of RUNTIME_CHANNEL_SPECS) {
      this._buildRuntimeChannelExpr(spec, cfg, cacheOpts);
    }

    if (bundleCachePath) {
      if (deferDiskCacheWrite) {
        this._scheduleBundleCacheFlush();
      } else if (canBatchFlush) {
        try {
          this.cdp.flushPendingBundleCache();
        } catch {}
      }
    }
    return this.injectExpr;
  },

  _hasOmniClientFile() {
    return hasChannelAssetFile(this.rootDir, this.cdp, 'omni', 'vendor/omni-viewer/omni-client.js');
  },

  _hasSafeV2SidebarClientFile() {
    try {
      const p = path.join(this.rootDir, 'vendor', 'sidebar-studio', 'sidebar-client.js');
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        this._safeSidebarFileCache = { path: p, sig: '', ok: false };
        return false;
      }
      if (!st.isFile()) {
        this._safeSidebarFileCache = { path: p, sig: '', ok: false };
        return false;
      }
      const sig = `${st.mtimeMs}:${st.size}:${st.ctimeMs}`;
      if (this._safeSidebarFileCache && this._safeSidebarFileCache.path === p && this._safeSidebarFileCache.sig === sig) {
        return this._safeSidebarFileCache.ok;
      }
      const src = fs.readFileSync(p, 'utf8');
      const ok =
        typeof this.cdp?.isSafeV2SidebarClientSource === 'function'
          ? Boolean(this.cdp.isSafeV2SidebarClientSource(src))
          : src.includes('SIDEBAR_STUDIO_CLIENT_V2') && !/setPrefValues?/i.test(src);
      this._safeSidebarFileCache = { path: p, sig, ok };
      return ok;
    } catch {
      this._safeSidebarFileCache = null;
      return false;
    }
  },

  _isOmniEnabled(cfgOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.();
      const reg = this.getRegisteredChannel('omni');
      if (cfg && typeof reg?.shouldEnable === 'function') return Boolean(reg.shouldEnable(cfg));
      return cfg?.omniModule !== 'off' && cfg?.omniModule !== false;
    } catch {
      return true;
    }
  },

  _buildOmniCleanupExpression() {
    return resolveChannelTeardown(this.cdp, 'omni', null);
  },

  _isSidebarStudioEnabled(cfgOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.();
      const reg = this.getRegisteredChannel('sidebar');
      if (cfg && typeof reg?.shouldEnable === 'function') return Boolean(reg.shouldEnable(cfg));
      return cfg?.sidebarStudio === 'on';
    } catch {
      return false;
    }
  },

  _isHostI18nEnabled(cfgOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.();
      if (typeof this.cdp?.shouldEnableHostI18n === 'function') return Boolean(this.cdp.shouldEnableHostI18n(cfg));
      const reg = this.getRegisteredChannel('hostI18n');
      if (typeof reg?.shouldEnable === 'function') return Boolean(reg.shouldEnable(cfg));
      return false;
    } catch {
      return false;
    }
  },

  _getHostI18nCfgSig(cfgOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.() || {};
      return `${cfg.hostLocalization || 'auto'}:${cfg.language || cfg.lang || 'auto'}`;
    } catch {
      return '';
    }
  },

  _getHostI18nCleanupExpression() {
    return resolveChannelTeardown(this.cdp, 'hostI18n', 'HOST_I18N_REMOVE_EXPRESSION');
  },

  _setThoughtExpr(expr) {
    const next = typeof expr === 'string' ? expr : '';
    this.thoughtExpr = next;
    this._thoughtHashSource = next;
    this.thoughtCodeHash = hashExpressionShort(next);
    return next;
  },

  _buildThoughtExprForConfig(cfgOverride = null, cacheOpts = undefined) {
    const cfg = cfgOverride || (typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null);
    if (!this._isThoughtEnabled(cfg) || typeof this.cdp?.buildThoughtExpression !== 'function') {
      return this._setThoughtExpr('');
    }
    const opts = cacheOpts !== undefined ? cacheOpts : this._getChannelCacheOpts(true);
    const expr = opts ? this.cdp.buildThoughtExpression(cfg, opts) : this.cdp.buildThoughtExpression(cfg);
    if (cacheOpts === undefined && opts && this.running) this._scheduleBundleCacheFlush();
    return this._setThoughtExpr(expr);
  },

  _getThoughtExprHash(expr = this.thoughtExpr) {
    const str = typeof expr === 'string' ? expr : '';
    if (!str) return '';
    if (str === this._thoughtHashSource && this.thoughtCodeHash) return this.thoughtCodeHash;
    const hash = hashExpressionShort(str);
    if (str === this.thoughtExpr) {
      this._thoughtHashSource = str;
      this.thoughtCodeHash = hash;
    }
    return hash;
  },

  _isThoughtEnabled(cfgOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.();
      if (typeof this.cdp?.shouldEnableThought === 'function') return Boolean(this.cdp.shouldEnableThought(cfg));
      const mode = typeof cfg?.thoughtTranslate === 'string' ? cfg.thoughtTranslate.trim().toLowerCase() : 'off';
      return Boolean(mode && mode !== 'off');
    } catch {
      return false;
    }
  },

  _getThoughtCfgSig(cfgOverride = null, exprOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.() || {};
      if (!this._isThoughtEnabled(cfg)) return '';
      const mode = typeof cfg.thoughtTranslate === 'string' ? cfg.thoughtTranslate.trim().toLowerCase() : 'off';
      const exprHash = this._getThoughtExprHash(typeof exprOverride === 'string' ? exprOverride : this.thoughtExpr);
      return `1:${mode}:${exprHash}`;
    } catch {
      return '';
    }
  },

  _getThoughtCleanupExpression() {
    return resolveChannelTeardown(this.cdp, 'thought', 'THOUGHT_REMOVE_EXPRESSION');
  },

  _hasInlineDiffClientFile() {
    return hasChannelAssetFile(this.rootDir, this.cdp, 'inlineDiff', 'vendor/inline-diff/inline-diff-client.js');
  },
  _extractInlineDiffCodeHash(expr) { return extractTargetCodeHash(expr); },
  _setInlineDiffExpr(expr) {
    const next = typeof expr === 'string' ? expr : '';
    this.inlineDiffExpr = next;
    this._inlineDiffHashSource = next;
    this.inlineDiffCodeHash = this._extractInlineDiffCodeHash(next);
    return next;
  },
  _buildInlineDiffExprForConfig(cfgOverride = null, cacheOpts = undefined) {
    const cfg = cfgOverride || (typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null);
    if (typeof this.cdp?.buildInlineDiffInjectExpression !== 'function') return this._setInlineDiffExpr('');
    const opts = cacheOpts !== undefined ? cacheOpts : this._getChannelCacheOpts(true);
    const expr = opts ? this.cdp.buildInlineDiffInjectExpression(cfg, opts) : this.cdp.buildInlineDiffInjectExpression(cfg);
    if (cacheOpts === undefined && opts && this.running) this._scheduleBundleCacheFlush();
    return this._setInlineDiffExpr(expr);
  },
  _getInlineDiffExprHash(expr = this.inlineDiffExpr) {
    const str = typeof expr === 'string' ? expr : '';
    if (!str) return '';
    if (str === this._inlineDiffHashSource && this.inlineDiffCodeHash) return this.inlineDiffCodeHash;
    const hash = this._extractInlineDiffCodeHash(str);
    if (str === this.inlineDiffExpr) {
      this._inlineDiffHashSource = str;
      this.inlineDiffCodeHash = hash;
    }
    return hash;
  },
  _getInlineDiffCleanupExpression() { return resolveChannelTeardown(this.cdp, 'inlineDiff', 'INLINE_DIFF_REMOVE_EXPRESSION'); },

  _hasWallpaperClientFile() {
    return hasChannelAssetFile(this.rootDir, this.cdp, 'wallpaper', 'vendor/wallpaper/wallpaper-client.js');
  },
  _extractWallpaperCodeHash(expr) { return extractTargetCodeHash(expr); },
  _setWallpaperExpr(expr) {
    const next = typeof expr === 'string' ? expr : '';
    this.wallpaperExpr = next;
    this._wallpaperHashSource = next;
    this.wallpaperCodeHash = this._extractWallpaperCodeHash(next);
    return next;
  },
  _buildWallpaperExprForConfig(cfgOverride = null, cacheOpts = undefined) {
    const cfg = cfgOverride || (typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null);
    if (typeof this.cdp?.buildWallpaperExpression !== 'function') return this._setWallpaperExpr('');
    // 不在 NewDocument 脚本中内联含 mediaUrl/mediaPath Bearer Token 的静态快照
    const rawOpts = cacheOpts !== undefined ? cacheOpts : this._getChannelCacheOpts(true);
    let safeOpts = rawOpts;
    if (rawOpts && typeof rawOpts === 'object' && Object.prototype.hasOwnProperty.call(rawOpts, 'initialWallpaperConfig')) {
      const { initialWallpaperConfig: _stripped, ...rest } = rawOpts;
      safeOpts = Object.keys(rest).length > 0 ? rest : undefined;
    }
    const expr = safeOpts ? this.cdp.buildWallpaperExpression(cfg, safeOpts) : this.cdp.buildWallpaperExpression(cfg);
    if (cacheOpts === undefined && safeOpts && this.running) this._scheduleBundleCacheFlush();
    return this._setWallpaperExpr(expr);
  },
  _getWallpaperExprHash(expr = this.wallpaperExpr) {
    const str = typeof expr === 'string' ? expr : '';
    if (!str) return '';
    if (str === this._wallpaperHashSource && this.wallpaperCodeHash) return this.wallpaperCodeHash;
    const hash = this._extractWallpaperCodeHash(str);
    if (str === this.wallpaperExpr) {
      this._wallpaperHashSource = str;
      this.wallpaperCodeHash = hash;
    }
    return hash;
  },
  _getWallpaperCleanupExpression() { return resolveChannelTeardown(this.cdp, 'wallpaper', 'WALLPAPER_REMOVE_EXPRESSION'); },

  _hasSuggesterClientFile() {
    return hasChannelAssetFile(this.rootDir, this.cdp, 'suggester', 'vendor/prompt-suggester/suggester-client.js');
  },
  _extractSuggesterCodeHash(expr) { return extractTargetCodeHash(expr); },
  _setSuggesterExpr(expr) {
    const next = typeof expr === 'string' ? expr : '';
    this.suggesterExpr = next;
    this._suggesterHashSource = next;
    this.suggesterCodeHash = this._extractSuggesterCodeHash(next);
    return next;
  },
  _buildSuggesterExprForConfig(cfgOverride = null, cacheOpts = undefined) {
    const cfg = cfgOverride || (typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null);
    if (typeof this.cdp?.buildSuggesterExpression !== 'function') return this._setSuggesterExpr('');
    const rawOpts = cacheOpts !== undefined ? cacheOpts : this._getChannelCacheOpts(true);
    const expr = rawOpts ? this.cdp.buildSuggesterExpression(cfg, rawOpts) : this.cdp.buildSuggesterExpression(cfg);
    if (cacheOpts === undefined && rawOpts && this.running) this._scheduleBundleCacheFlush();
    return this._setSuggesterExpr(expr);
  },
  _getSuggesterExprHash(expr = this.suggesterExpr) {
    const str = typeof expr === 'string' ? expr : '';
    if (!str) return '';
    if (str === this._suggesterHashSource && this.suggesterCodeHash) return this.suggesterCodeHash;
    const hash = this._extractSuggesterCodeHash(str);
    if (str === this.suggesterExpr) {
      this._suggesterHashSource = str;
      this.suggesterCodeHash = hash;
    }
    return hash;
  },
  _getSuggesterCleanupExpression() { return resolveChannelTeardown(this.cdp, 'suggester', 'SUGGESTER_REMOVE_EXPRESSION'); },

  _hasPeriodicPickerFile() {
    return hasChannelAssetFile(this.rootDir, this.cdp, 'periodicPicker', 'vendor/periodic-picker/periodic-picker.js');
  },
  _isPeriodicPickerEnabled(cfgOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.();
      if (typeof this.cdp?.shouldEnablePeriodicPicker === 'function') return Boolean(this.cdp.shouldEnablePeriodicPicker(cfg));
      return cfg?.periodicModelPicker !== 'off' && cfg?.periodicModelPicker !== false;
    } catch {
      return true;
    }
  },
  _getPeriodicPickerCfgSig(cfgOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.() || {};
      return cfg.periodicModelPicker === 'off' || cfg.periodicModelPicker === false ? 'off' : 'on';
    } catch {
      return 'on';
    }
  },
  _extractPeriodicPickerCodeHash(expr) { return extractTargetCodeHash(expr); },
  _setPeriodicPickerExpr(expr) {
    const next = typeof expr === 'string' ? expr : '';
    this.periodicPickerExpr = next;
    this._periodicPickerHashSource = next;
    this.periodicPickerCodeHash = this._extractPeriodicPickerCodeHash(next);
    return next;
  },
  _buildPeriodicPickerExprForConfig(cfgOverride = null, cacheOpts = undefined) {
    const cfg = cfgOverride || (typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null);
    if (typeof this.cdp?.buildPeriodicPickerExpression !== 'function' || !this._hasPeriodicPickerFile() || !this._isPeriodicPickerEnabled(cfg)) {
      return this._setPeriodicPickerExpr('');
    }
    const opts = cacheOpts !== undefined ? cacheOpts : this._getChannelCacheOpts(true);
    const expr = opts ? this.cdp.buildPeriodicPickerExpression(cfg, opts) : this.cdp.buildPeriodicPickerExpression(cfg);
    if (cacheOpts === undefined && opts && this.running) this._scheduleBundleCacheFlush();
    return this._setPeriodicPickerExpr(expr);
  },
  _getPeriodicPickerExprHash(expr = this.periodicPickerExpr) {
    const str = typeof expr === 'string' ? expr : '';
    if (!str) return '';
    if (str === this._periodicPickerHashSource && this.periodicPickerCodeHash) return this.periodicPickerCodeHash;
    const hash = this._extractPeriodicPickerCodeHash(str);
    if (str === this.periodicPickerExpr) {
      this._periodicPickerHashSource = str;
      this.periodicPickerCodeHash = hash;
    }
    return hash;
  },
  _getPeriodicPickerCleanupExpression() { return resolveChannelTeardown(this.cdp, 'periodicPicker', 'PERIODIC_PICKER_REMOVE_EXPRESSION'); },

  _extractSettingsCodeHash(expr) { return extractTargetCodeHash(expr); },
  _getSettingsExprHash(expr = this.settingsExpr) {
    const str = typeof expr === 'string' ? expr : '';
    if (!str) return '';
    if (str === this._settingsHashSource && this.settingsCodeHash) return this.settingsCodeHash;
    const hash = this._extractSettingsCodeHash(str);
    if (str === this.settingsExpr) {
      this._settingsHashSource = str;
      this.settingsCodeHash = hash;
    }
    return hash;
  },
  _ensureSettingsExpr(cacheOpts = undefined) {
    if (this.settingsExpr) return this.settingsExpr;
    if (typeof this.cdp?.buildSettingsChannelExpression !== 'function') return '';
    const opts = cacheOpts !== undefined ? cacheOpts : this._getChannelCacheOpts(true);
    const expr = opts ? this.cdp.buildSettingsChannelExpression(null, opts) : this.cdp.buildSettingsChannelExpression();
    if (cacheOpts === undefined && opts && this.running) this._scheduleBundleCacheFlush();
    this.settingsExpr = typeof expr === 'string' ? expr : '';
    this._settingsHashSource = this.settingsExpr;
    this.settingsCodeHash = this._extractSettingsCodeHash(this.settingsExpr);
    return this.settingsExpr;
  },

  _hasMascotFile() {
    return hasChannelAssetFile(this.rootDir, this.cdp, 'mascot', 'dual-mascot-rig.js');
  },
  _isMascotEnabled(cfgOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.();
      if (typeof this.cdp?.shouldEnableMascot === 'function') return Boolean(this.cdp.shouldEnableMascot(cfg));
      return cfg?.mascot !== 'off' && cfg?.mascot !== false;
    } catch {
      return true;
    }
  },
  _getMascotCfgSig(cfgOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.() || {};
      return cfg.mascot === 'off' || cfg.mascot === false ? 'off' : String(cfg.mascot || 'crab');
    } catch {
      return 'crab';
    }
  },
  _extractMascotCodeHash(expr) { return extractTargetCodeHash(expr); },
  _setMascotExpr(expr) {
    const next = typeof expr === 'string' ? expr : '';
    this.mascotExpr = next;
    this._mascotHashSource = next;
    this.mascotCodeHash = this._extractMascotCodeHash(next);
    return next;
  },
  _buildMascotExprForConfig(cfgOverride = null, cacheOpts = undefined) {
    const cfg = cfgOverride || (typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null);
    if (typeof this.cdp?.buildMascotChannelExpression !== 'function' || !this._hasMascotFile() || !this._isMascotEnabled(cfg)) {
      return this._setMascotExpr('');
    }
    const opts = cacheOpts !== undefined ? cacheOpts : this._getChannelCacheOpts(true);
    const expr = opts ? this.cdp.buildMascotChannelExpression(cfg, opts) : this.cdp.buildMascotChannelExpression(cfg);
    if (cacheOpts === undefined && opts && this.running) this._scheduleBundleCacheFlush();
    return this._setMascotExpr(expr);
  },
  _getMascotExprHash(expr = this.mascotExpr) {
    const str = typeof expr === 'string' ? expr : '';
    if (!str) return '';
    if (str === this._mascotHashSource && this.mascotCodeHash) return this.mascotCodeHash;
    const hash = this._extractMascotCodeHash(str);
    if (str === this.mascotExpr) {
      this._mascotHashSource = str;
      this.mascotCodeHash = hash;
    }
    return hash;
  },
  _getMascotCleanupExpression() { return resolveChannelTeardown(this.cdp, 'mascot', 'MASCOT_REMOVE_EXPRESSION'); },

  _hasHomeStudioFile() {
    return hasChannelAssetFile(this.rootDir, this.cdp, 'homeStudio', 'home-studio-panel.js');
  },
  _isHomeStudioEnabled(cfgOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.();
      if (typeof this.cdp?.shouldEnableHomeStudio === 'function') return Boolean(this.cdp.shouldEnableHomeStudio(cfg));
      return (cfg?.homeLayout || cfg?.homeMode || 'studio') === 'studio';
    } catch {
      return true;
    }
  },
  _getHomeStudioCfgSig(cfgOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.() || {};
      return (cfg.homeLayout || cfg.homeMode || 'studio') === 'studio' ? 'studio' : 'off';
    } catch {
      return 'studio';
    }
  },
  _extractHomeStudioCodeHash(expr) { return extractTargetCodeHash(expr); },
  _setHomeStudioExpr(expr) {
    const next = typeof expr === 'string' ? expr : '';
    this.homeStudioExpr = next;
    this._homeStudioHashSource = next;
    this.homeStudioCodeHash = this._extractHomeStudioCodeHash(next);
    return next;
  },
  _buildHomeStudioExprForConfig(cfgOverride = null, cacheOpts = undefined) {
    const cfg = cfgOverride || (typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null);
    if (typeof this.cdp?.buildHomeStudioChannelExpression !== 'function' || !this._hasHomeStudioFile() || !this._isHomeStudioEnabled(cfg)) {
      return this._setHomeStudioExpr('');
    }
    const opts = cacheOpts !== undefined ? cacheOpts : this._getChannelCacheOpts(true);
    const expr = opts ? this.cdp.buildHomeStudioChannelExpression(cfg, opts) : this.cdp.buildHomeStudioChannelExpression(cfg);
    if (cacheOpts === undefined && opts && this.running) this._scheduleBundleCacheFlush();
    return this._setHomeStudioExpr(expr);
  },
  _getHomeStudioExprHash(expr = this.homeStudioExpr) {
    const str = typeof expr === 'string' ? expr : '';
    if (!str) return '';
    if (str === this._homeStudioHashSource && this.homeStudioCodeHash) return this.homeStudioCodeHash;
    const hash = this._extractHomeStudioCodeHash(str);
    if (str === this.homeStudioExpr) {
      this._homeStudioHashSource = str;
      this.homeStudioCodeHash = hash;
    }
    return hash;
  },
  _getHomeStudioCleanupExpression() { return resolveChannelTeardown(this.cdp, 'homeStudio', 'HOME_STUDIO_REMOVE_EXPRESSION'); },

  _hasRuntimeChannelFile(spec) {
    return hasChannelAssetFile(this.rootDir, this.cdp, spec.id, spec.fallbackRel);
  },
  _isRuntimeChannelEnabled(spec, cfgOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.();
      const fn = this.cdp?.[spec.cdpShouldEnable];
      if (typeof fn === 'function') return Boolean(fn(cfg));
      const reg = this.getRegisteredChannel(spec.id);
      if (typeof reg?.shouldEnable === 'function') return Boolean(reg.shouldEnable(cfg));
      return Boolean(spec.defaultShouldEnable(cfg));
    } catch {
      return false;
    }
  },
  _getRuntimeChannelCfgSig(spec, cfgOverride = null) {
    try {
      const cfg = cfgOverride || this.cdp?.readConfig?.() || {};
      return spec.getCfgSig(cfg);
    } catch {
      return 'on';
    }
  },
  _setRuntimeChannelExpr(spec, expr) {
    const next = typeof expr === 'string' ? expr : '';
    this[spec.exprField] = next;
    this[spec.hashSrcField] = next;
    this[spec.hashField] = extractTargetCodeHash(next);
    return next;
  },
  _buildRuntimeChannelExpr(spec, cfgOverride = null, cacheOpts = undefined) {
    const cfg = cfgOverride || (typeof this.cdp?.readConfig === 'function' ? this.cdp.readConfig() : null);
    const buildFn = this.cdp?.[spec.cdpBuild];
    if (typeof buildFn !== 'function' || !this._hasRuntimeChannelFile(spec) || !this._isRuntimeChannelEnabled(spec, cfg)) {
      return this._setRuntimeChannelExpr(spec, '');
    }
    const opts = cacheOpts !== undefined ? cacheOpts : this._getChannelCacheOpts(true);
    const expr = opts ? buildFn(cfg, opts) : buildFn(cfg);
    if (cacheOpts === undefined && opts && this.running) this._scheduleBundleCacheFlush();
    return this._setRuntimeChannelExpr(spec, expr);
  },
  _getRuntimeChannelExprHash(spec, exprOverride = undefined) {
    const str = typeof exprOverride === 'string' ? exprOverride : typeof this[spec.exprField] === 'string' ? this[spec.exprField] : '';
    if (!str) return '';
    if (str === this[spec.hashSrcField] && this[spec.hashField]) return this[spec.hashField];
    const hash = extractTargetCodeHash(str);
    if (str === this[spec.exprField]) {
      this[spec.hashSrcField] = str;
      this[spec.hashField] = hash;
    }
    return hash;
  },
  _getRuntimeChannelCleanupExpression(spec) {
    return resolveChannelTeardown(this.cdp, spec.id, spec.cdpRemove);
  },
};
