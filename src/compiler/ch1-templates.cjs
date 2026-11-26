// Channel 1 运行时语种切片、增量 configRefresh 模板与主注入壳模板生成器
'use strict';

const fs = require('fs');
const path = require('path');
const { getFileSig } = require('../utils/fs-safe.cjs');
const {
  STYLE_ID,
  LEGACY_STYLE_ID,
  SETTING_BINDING,
  reconcileConfigAliases,
} = require('../config/schema.cjs');
const { minifySingleSource } = require('./js-string-pool.cjs');

// Channel 1 自身实际消费的最小运行时 key 集（Omni / InlineDiff 均在各自独立通道内自带完整 8 语表，无需重复打入 Channel 1 bootCfg）
const CH1_RUNTIME_UI_KEYS = Object.freeze([
  'cacheRead', 'cacheShort', 'effortTitle', 'fiveHourLabel',
  'homeLocalOnlyTag', 'homeLocalScopeNote', 'homeScopeActive', 'homeScopeActiveCount', 'homeScopeAll', 'homeScopeArchivedCount',
  'kpiCacheHit', 'kpiCalls', 'kpiDays', 'kpiFavModel', 'kpiSessions', 'kpiTokens',
  'noModelUsage',
  'optHost', 'optLightAlabaster', 'optLightCrystal', 'optMotionOff', 'optMotionStandard', 'optMotionSubtle',
  'optMotionUltra', 'optObsidian', 'optThoughtBilingual', 'optThoughtImmersive', 'optWarm',
  'quotaEmptyHint', 'quotaJustNow', 'quotaLoading', 'quotaPoolsTitle', 'refreshBtnTitle', 'sessionsUnit',
  'showLess', 'sidebarLessLabel', 'sidebarMoreLabel', 'studioPlaceholder', 'subagentsUnit', 'swarmBadge',
  'tabModels', 'tabOverview', 'tabQuotas', 'thinkingEllipsis', 'tokenUnit', 'tokensInShort', 'tokensOutShort',
  'weeklyLabel', 'workspaceAll', 'workspaceFilterAria',
]);

function normalizeLangIdNode(rawLang, fallback = 'en') {
  const raw = typeof rawLang === 'string' ? rawLang.trim().toLowerCase().replace(/_/g, '-') : '';
  if (!raw || raw === 'auto') return fallback;
  if (raw === 'en' || raw.startsWith('en-') || raw === 'english') return 'en';
  if (raw === 'ja' || raw.startsWith('ja-') || raw === 'jp' || raw === 'japanese') return 'ja';
  if (raw === 'ko' || raw.startsWith('ko-') || raw === 'kr' || raw === 'korean') return 'ko';
  if (raw === 'es' || raw.startsWith('es-') || raw === 'spanish') return 'es';
  if (raw === 'fr' || raw.startsWith('fr-') || raw === 'french') return 'fr';
  if (raw === 'de' || raw.startsWith('de-') || raw === 'german') return 'de';
  if (raw === 'yue' || raw.startsWith('yue-') || raw === 'zh-yue' || raw.includes('cantonese')) return 'zh-CN';
  if (raw === 'zh-tw' || raw === 'zh-hk' || raw.startsWith('zh-hk-') || raw === 'zh-mo' || raw === 'zh-hant' || raw.startsWith('zh-hant-') || raw === 'tw' || raw === 'hant') return 'zh-TW';
  if (raw === 'zh' || raw === 'zh-cn' || raw === 'zh-hans' || raw.startsWith('zh-')) return 'zh-CN';
  return fallback;
}

function extractSingleLangRuntimeSlice(mod, langId) {
  if (!mod) return {};
  const src =
    typeof mod.getRuntimeUiSlice === 'function'
      ? mod.getRuntimeUiSlice(langId)?.strings
      : typeof mod.getUiStrings === 'function'
        ? mod.getUiStrings(langId)
        : null;
  if (!src || typeof src !== 'object') return {};
  const out = {};
  for (let i = 0; i < CH1_RUNTIME_UI_KEYS.length; i++) {
    const k = CH1_RUNTIME_UI_KEYS[i];
    if (typeof src[k] === 'string') out[k] = src[k];
  }
  return out;
}

function createCh1Templates({
  rootDir = path.resolve(__dirname, '..', '..'),
  pluginVersion,
  readConfig,
  resolveCurrentBundleCodeHash,
  detectSystemUiLocale,
}) {
  let _localesFreshCache = { sig: '', mod: null };
  let _configRefreshTemplate = '';
  let _injectWrapperTemplate = null;

  function loadLocalesModuleFresh() {
    const locPath = path.join(rootDir, 'i18n-locales.js');
    if (!fs.existsSync(locPath)) return null;
    try {
      const sig = getFileSig(locPath);
      if (_localesFreshCache.sig === sig && _localesFreshCache.mod) {
        return _localesFreshCache.mod;
      }
      try { delete require.cache[require.resolve(locPath)]; } catch {}
      const mod = require(locPath);
      _localesFreshCache = { sig, mod };
      return mod;
    } catch {
      return null;
    }
  }

  function resolveSystemLangNode(hostLocaleHint = null) {
    const sysLocale = hostLocaleHint || detectSystemUiLocale();
    const stripped = String(sysLocale || '').trim().split(/[.@]/)[0];
    return normalizeLangIdNode(stripped, 'en');
  }

  // 为 Channel 1 bootCfg 生成当前活跃语言（及 auto 模式下的 en 兜底）迷你运行时词典（列式编码消除双语重复键名）
  function buildRuntimeUiSlicePayload(config) {
    const mod = loadLocalesModuleFresh();
    if (!mod) return null;
    const rawLang = (config && (config.language || config.lang)) || 'auto';
    const isAuto = String(rawLang).trim().toLowerCase() === 'auto';
    const primary = isAuto ? resolveSystemLangNode() : normalizeLangIdNode(rawLang, 'en');
    const pObj = extractSingleLangRuntimeSlice(mod, primary);
    const enObj = isAuto && primary !== 'en' ? extractSingleLangRuntimeSlice(mod, 'en') : null;
    const keys = CH1_RUNTIME_UI_KEYS.filter((k) => typeof pObj[k] === 'string' || typeof enObj?.[k] === 'string');
    const vals = { [primary]: keys.map((k) => pObj[k] ?? '') };
    if (enObj) vals.en = keys.map((k) => enObj[k] ?? '');
    return { active: primary, keys, vals };
  }

  function getConfigRefreshTemplate() {
    if (_configRefreshTemplate) return _configRefreshTemplate;
    const rawTpl = `(() => {
      const cfg = __AG_REF_CFG__, W = window, D = document, G = globalThis;
      const api = W.__agPrism || W.__agClaudeStyle;
      if (api && api.version === __AG_REF_VER__ && api.codeHash === __AG_REF_HASH__ && typeof api.refreshConfig === 'function') {
        if (api.refreshConfig(cfg) === false) return { refreshed: true, skippedStale: true, version: api.version };
        const e = api.getState?.()?.cfg || cfg, de = D.documentElement;
        const T = (f) => { try { f(); } catch {} };
        const qa = (s) => D.querySelectorAll?.(s) || [];
        const rm = (s) => qa(s).forEach((n) => n.remove?.());
        const ra = (s) => de && s.split(',').forEach((a) => de.removeAttribute?.(a));
        const dw = (s) => s.split(',').forEach((k) => { T(() => delete W[k]); T(() => delete G[k]); });
        T(() => (e?.telemetryModule === 'off' || e?.telemetryModule === false ? (api.detachTelemetry?.(), W.__agPrismTelemetry?.destroy?.()) : (W.__agPrismTelemetry?.sync?.(e), api.syncTelemetry?.())));
        T(() => (e?.effortSliderModule === 'off' || e?.effortSliderModule === false ? W.__agPrismEffortSlider?.destroy?.() : W.__agPrismEffortSlider?.sync?.(e)));
        if (e?.contextMenu === false || e?.contextMenu === 'off') T(() => W.__agPrismContextMenu?.destroy?.());
        T(() => W.__agPrismThought?.sync?.(e));
        T(() => W.__agPrismInlineDiff?.sync?.(e));
        T(() => (e?.omniModule === 'off' ? W.__agPrismOmni?.destroy?.() : W.__agPrismOmni?.sync?.(e, W.__agPrismOmniServerMeta || null)));
        if (e?.sidebarStudio !== 'on') {
          T(() => { W.__agPrismSidebar?.sync?.(e, W.__agPrismSidebarMeta || null); W.__agPrismSidebar?.destroy?.(); delete W.__agPrismSidebar; });
          T(() => ra('data-ag-prism-mode,data-ag-prism-chat-kind,data-ag-prism-chat-telemetry,data-ag-cs-space,data-ag-cs-space-palette,data-ag-cs-space-accent'));
        } else T(() => W.__agPrismSidebar?.sync?.(e, W.__agPrismSidebarMeta || null));
        T(() => {
          const m = e?.hostLocalization, l = e?.language;
          const navL = String((typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || '').trim();
          if (m === 'off' || m === 'on') W.__agPrismHostI18n?.setMode?.(m);
          else if ((l && l !== 'zh-CN' && l !== 'auto') || ((!l || l === 'auto') && navL && !/^zh(?:$|-(?:cn|hans|sg)(?:-|$))/i.test(navL))) W.__agPrismHostI18n?.destroy?.();
          else W.__agPrismHostI18n?.setMode?.('auto');
        });
        if (e?.mascot === 'off' || e?.mascot === false) {
          T(() => {
            T(() => W.__agDualMascotRig?.dispose?.()); T(() => api.sync?.());
            qa('.ag-cs-crab,.ag-cs-dual-stage,.ag-cs-crab-stage,.ag-cs-mascot-stage,.ag-v2-mascot-stage,.ag-v2-habitat-prop').forEach((n) => { T(() => n.__agMascotApi?.dispose?.()); n.remove?.(); });
            qa('[data-ag-cs-crab-anchor]').forEach((n) => n.removeAttribute?.('data-ag-cs-crab-anchor'));
            ra('data-ag-cs-has-crab,data-ag-cs-mascot-drag');
            dw('__agDualMascotRig,__agPrismMascotArt');
          });
        }
        if (e?.homeLayout && e.homeLayout !== 'studio') {
          T(() => {
            api.detachHomeStudio?.(); D.getElementById?.('ag-prism-studio-v101-css')?.remove?.();
            rm('.ag-cs-home-panel-seat,.ag-cs-home-panel'); ra('data-ag-prism-scope');
            dw('__agPrismHomeStudioPanel,__agHomeStudioPanel');
          });
        }
        if (e?.periodicModelPicker === 'off' || e?.periodicModelPicker === false) {
          T(() => {
            W.__agPrismPeriodicPicker?.destroy?.();
            ra('data-ag-prism-periodic-picker,data-ag-pp-open,data-ag-pp-holding');
            rm('#ag-prism-periodic-picker-css,#ag-prism-periodic-picker-root,.ag-pp-hold-ring,.ag-pp-mini-keycap');
            dw('__agPrismPeriodicPicker,__agPrismPeriodicPickerFactory,__agPrismKeyboard3D,__agPrismPeriodicKeyboard3D,__agPrismOledScreen,__agPrismGrainAssets,__agPeriodicAudioFx,__agPeriodicModelCatalog,__agPeriodicHostBridge,__agPeriodicBentoUi,__agPeriodicPbrGrainAssets,__agPeriodicOledScreen,__agPeriodicKeyboard3D');
          });
        }
        if (de) {
          if (e?.thoughtTranslate && e.thoughtTranslate !== 'off') de.setAttribute('data-ag-prism-thought-view', e.thoughtView === 'bilingual' ? 'bilingual' : 'immersive');
          else de.removeAttribute('data-ag-prism-thought-view');
          de.setAttribute('data-ag-prism-sidebar-studio', e?.sidebarStudio === 'on' ? 'on' : 'off');
        }
        T(() => {
          const pm = e?.performanceMode;
          if (W.__agPrismDomBus?.applyPerformanceMode) W.__agPrismDomBus.applyPerformanceMode(pm, D, W);
          else if (de && pm) de.setAttribute('data-ag-cs-perf-mode', pm === 'eco' ? 'performance' : pm === 'auto' ? 'balanced' : pm);
          W.__agPrismApplyIgnoreReducedMotion?.(!!e?.ignoreReducedMotion);
          W.__agPrismFontCustomizer?.applyCustomFonts?.(e, D);
          W.__agPrismCssMgr?.sync?.(e);
        });
        return { refreshed: true, version: api.version };
      }
      return { refreshed: false };
    })()`;
    _configRefreshTemplate = minifySingleSource(rawTpl);
    return _configRefreshTemplate;
  }

  function buildConfigRefreshExpression(customConfig, extraMeta = null) {
    const config = customConfig ? reconcileConfigAliases(customConfig) : readConfig();
    const codeHash = resolveCurrentBundleCodeHash();
    const hasExplicitLang = !customConfig || Object.prototype.hasOwnProperty.call(config, 'language') || Object.prototype.hasOwnProperty.call(config, 'lang');
    const uiSlice = hasExplicitLang ? buildRuntimeUiSlicePayload(config) : null;
    const bootCfg = {
      ...config,
      ...(uiSlice ? { __uiSlice: uiSlice } : {}),
      ...(extraMeta && typeof extraMeta === 'object' ? extraMeta : {}),
      binding: SETTING_BINDING,
      codeHash,
      __fromFile: true,
    };
    return getConfigRefreshTemplate()
      .replace('__AG_REF_CFG__', () => JSON.stringify(bootCfg))
      .replace('__AG_REF_VER__', () => JSON.stringify(pluginVersion))
      .replace('__AG_REF_HASH__', () => JSON.stringify(codeHash));
  }

  function getInjectWrapperTemplate() {
    if (_injectWrapperTemplate) return _injectWrapperTemplate;
    const rawTpl = `(() => {
      const W = window, D = document, G = globalThis;
      const isF = (v) => typeof v === 'function', isO = (v) => Boolean(v && typeof v === 'object');
      const T = (f) => { try { return f(); } catch {} }, sp = (s) => s.split(',');
      const gid = (i) => D.getElementById?.(i), qa = (s) => D.querySelectorAll?.(s) || [], qs = (s) => T(() => D.querySelector(s));
      const VER = ${JSON.stringify(pluginVersion)}, SID = ${JSON.stringify(STYLE_ID)}, LSID = ${JSON.stringify(LEGACY_STYLE_ID)}, OFF_MSG = 'Sidecar daemon offline';
      let _css = null;
      const getCss = () => (_css === null ? (_css = __AG_INJ_CSS__) : _css);
      const cleanOld = () => {
        T(() => gid(LSID)?.remove());
        T(() => {
          const o = W.__agClaudeStyle;
          if (o && (!W.__agPrism || Number(o.version) <= 2)) { if (isF(o.destroy)) o.destroy(); delete W.__agClaudeStyle; }
        });
      };
      const parseBuckets = (raw) => {
        const b = {}, pfx = '/*@ag:';
        let pos = raw.indexOf(pfx);
        if (pos < 0) return { core: raw };
        if (pos > 0) b.core = raw.slice(0, pos);
        while (pos >= 0) {
          const e = raw.indexOf('*/', pos + 6);
          if (e < 0) break;
          const k = raw.slice(pos + 6, e), nx = raw.indexOf(pfx, e + 2);
          b[k] = (b[k] || '') + (nx < 0 ? raw.slice(e + 2) : raw.slice(e + 2, nx));
          pos = nx;
        }
        return b;
      };
      const ensureCssMgr = () => {
        const fk = __AG_INJ_CSSHASH__, prev = W.__agPrismCssMgr;
        if (prev && prev.cssHash === fk && !prev._disposed) return prev;
        T(() => prev?.destroy?.());
        const buckets = parseBuckets(getCss()), SC = W.CSSStyleSheet || (typeof CSSStyleSheet === 'function' ? CSSStyleSheet : null);
        const canA = () => Boolean(T(() => SC && isF(SC.prototype?.replaceSync) && isF(D.adoptedStyleSheets?.[Symbol.iterator])));
        const sheets = new Map(), owned = new Set();
        let lastSig = '', mo = null, lastCfg = null;
        const calcKeys = (cfg, h) => {
          const de = D.documentElement, hc = isO(cfg), c = hc ? cfg : lastCfg || W.__agPrism?.getState?.()?.cfg || {};
          const ga = (k) => de?.getAttribute?.(k), on = (hv, fn) => hv === true || (hv !== false && fn());
          h = isO(h) ? h : {};
          const pal = h.palette || (hc && cfg.palette) || ga('data-ag-cs-palette') || c.palette || 'obsidian';
          const acc = h.accent || (hc && cfg.accentTone) || ga('data-ag-cs-accent') || c.accentTone || 'follow';
          const mot = h.motion || (hc && cfg.motionLevel) || ga('data-ag-cs-motion') || c.motionLevel || 'standard';
          const ta = ga('data-ag-cs-theme'), th = h.theme || (ta === 'light' || ta === 'dark' ? ta : (/\b(?:theme-light|light-theme|light)\b/.test(String(D.body?.className || '')) ? 'light' : 'dark'));
          const ks = ['core'];
          if (pal === 'warm') ks.push('paletteWarm'); else if (pal === 'host') ks.push('paletteHost');
          if (acc && acc !== 'follow') ks.push('accentCustom');
          if (on(h.convRipple, () => ga('data-ag-cs-conv-ripple') === '1' || (c.convRipple && c.convRipple !== 'off'))) ks.push('convRipple');
          if (on(h.thought, () => Boolean(ga('data-ag-prism-thought-view')) || (c.thoughtTranslate && c.thoughtTranslate !== 'off'))) ks.push('thoughtExt');
          if (on(h.home, () => ga('data-ag-cs-home') !== 'off' && c.homeLayout !== 'off' && Boolean(qs('.agy-home,.ag-cs-home-panel')))) ks.push('viewHome');
          if (on(h.sidebar, () => ga('data-ag-cs-sidebar') !== 'off' && c.sidebarRestyle !== false)) ks.push('viewSidebar');
          if (on(h.settings, () => Boolean(gid('ag-cs-settings-sec') || qs('div[role="dialog"],.agy-dialog,[data-ag-cs-settings-dlg="1"]')))) ks.push('viewSettings');
          ks.push(mot === 'off' ? 'motionOff' : mot === 'subtle' ? 'motionSubtle' : 'motionFull');
          if (th === 'light') ks.push('themeLight');
          return ks.filter((k) => Boolean(buckets[k]));
        };
        const setSent = (txt, ad) => {
          const p = D.head || D.documentElement;
          if (!p) return;
          let st = gid(SID);
          if (!st) { st = D.createElement('style'); st.id = SID; }
          if (ad) { if (st.textContent) st.textContent = ''; st.setAttribute?.('data-ag-cs-adopted', '1'); }
          else { st.removeAttribute?.('data-ag-cs-adopted'); if (st.textContent !== txt) st.textContent = txt; }
          st.setAttribute?.('data-ag-cs-css-hash', fk);
          st.setAttribute?.('data-ag-cs-flat', fk + ':' + (ad ? 0 : txt.length));
          if (st.parentNode !== p || p.lastElementChild !== st) p.appendChild(st);
        };
        const mgr = {
          cssHash: fk, mode: canA() ? 'adopted' : 'style', buckets, activeKeys: [], activeBytes: 0, _disposed: false,
          sync(cfg, hints) {
            if (mgr._disposed) return mgr;
            if (isO(cfg)) lastCfg = cfg;
            const keys = calcKeys(cfg, hints), sig = keys.join(','), ad = canA();
            mgr.mode = ad ? 'adopted' : 'style';
            let bytes = 0;
            for (const k of keys) bytes += buckets[k].length;
            mgr.activeKeys = keys; mgr.activeBytes = bytes;
            if (ad) {
              const cur = Array.from(D.adoptedStyleSheets);
              if (sig !== lastSig || !owned.size || !cur.some((s) => owned.has(s))) {
                const nx = keys.map((k) => { let sh = sheets.get(k); if (!sh) { sh = new SC(); sh.replaceSync(buckets[k]); sheets.set(k, sh); } return sh; });
                const kept = cur.filter((s) => !owned.has(s));
                owned.clear(); nx.forEach((s) => owned.add(s));
                D.adoptedStyleSheets = kept.concat(nx); lastSig = sig;
              }
              setSent('', true);
            } else if (sig !== lastSig || !gid(SID)?.textContent) {
              setSent(keys.map((k) => buckets[k]).join(''), false); lastSig = sig;
            }
            return mgr;
          },
          _armObserver() {
            if (mgr._disposed || mo || !canA() || !D.documentElement || !isF(W.MutationObserver)) return;
            T(() => {
              mo = new W.MutationObserver(() => T(() => mgr.sync(null)));
              mo.observe(D.documentElement, { attributes: true, attributeFilter: sp('theme,palette,light-preset,accent,motion,sidebar,home,conv-ripple').map((s) => 'data-ag-cs-' + s).concat('data-ag-prism-thought-view') });
            });
          },
          destroy(opts) {
            if (mgr._disposed) return;
            mgr._disposed = true;
            T(() => mo?.disconnect?.()); mo = null;
            if (owned.size && isF(D.adoptedStyleSheets?.[Symbol.iterator])) T(() => { D.adoptedStyleSheets = Array.from(D.adoptedStyleSheets).filter((s) => !owned.has(s)); });
            owned.clear(); sheets.clear(); lastSig = ''; mgr.activeKeys = []; mgr.activeBytes = 0;
            T(() => { const s = gid(SID); if (s) { if (opts?.keepStyleNode) s.textContent = ''; else s.remove?.(); } });
          },
        };
        return (W.__agPrismCssMgr = G.__agPrismCssMgr = mgr);
      };
      const applyStyle = (cfg, hints) => {
        if (!(D.head || D.documentElement)) return;
        cleanOld();
        ensureCssMgr().sync(cfg, hints);
        T(() => { if (W.__agPrismCssMgr?.mode !== 'adopted') W.__agPrism?.flattenCss?.(); });
      };
      const hookApiCssMgr = (api) => {
        if (!api || api.__agCssMgrHooked) return;
        api.__agCssMgrHooked = true;
        const wrap = (k, fn) => { const o = isF(api[k]) ? api[k].bind(api) : null; if (o) api[k] = (...a) => fn(o, a); };
        wrap('refreshConfig', (o, a) => { const r = o(...a); T(() => W.__agPrismCssMgr?.sync?.(api.getState?.()?.cfg || a[0])); return r; });
        wrap('sync', (o, a) => { const r = o(...a); T(() => W.__agPrismCssMgr?.sync?.(api.getState?.()?.cfg)); return r; });
        wrap('destroy', (o, a) => { T(() => W.__agPrismCssMgr?.destroy?.({ keepStyleNode: true })); return o(...a); });
      };

      const mkRpc = (bk, lim, onTo, onErr, disp) => {
        const pend = new Map();
        let seq = 0;
        const send = (mkReq, ms, ext, bypass) =>
          new Promise((res) => {
            if (!bypass && pend.size >= lim) return res(onErr('busy', true));
            const id = ++seq, it = ext ? { res, t: null, ...ext } : { res, t: null };
            it.arm = (d = ms) => { clearTimeout(it.t); it.t = setTimeout(() => { pend.delete(id); res(onTo()); }, d); };
            it.arm(); pend.set(id, it);
            try { W[bk](JSON.stringify(mkReq(id))); }
            catch (e) { clearTimeout(it.t); pend.delete(id); res(onErr(String(e?.message || e), false)); }
          });
        const resolve = (id, r) => { const it = pend.get(id); if (it) { clearTimeout(it.t); pend.delete(id); it.res(r); } };
        const dispose = () => { for (const it of pend.values()) { clearTimeout(it.t); it.res(disp); } pend.clear(); };
        return { pend, send, resolve, dispose };
      };

      const ensureRepo = () => T(() => {
        if (W.__agPrismRepoBridge?.__prismBridgeReady) return;
        const c = mkRpc('__agPrismRepoCall', 8, () => ({ ok: false, timeout: true, noRemote: true, hasRemote: false }), (e) => ({ ok: false, error: e }), { ok: false, disposed: true });
        const fn = (inp) => {
          const p = typeof inp === 'string' ? { action: inp } : isO(inp) ? { ...inp } : { action: 'status' }, a = p.action || 'status';
          if (!isF(W.__agPrismRepoCall)) return Promise.resolve({ ok: false, offline: true, action: a, isGitRepo: false, noRemote: true, hasRemote: false, branch: 'local', commit: VER, shortHash: VER, remoteUrl: '', hasUpdates: false, upToDate: true, updated: false, message: OFF_MSG });
          return c.send((id) => ({ id, action: a, input: p }), 16000).then((r) => (r && !r.action ? { ...r, action: a } : r));
        };
        Object.assign(fn, { __prismBridgeReady: true, call: fn, request: fn, status: () => fn({ action: 'status' }), pull: () => fn({ action: 'pull' }), sync: () => fn({ action: 'pull' }), resolve: c.resolve, dispose: c.dispose });
        W.__agPrismRepoBridge = fn; W.__agPrismRepoResolve = c.resolve;
      });

      const ensureThought = () => T(() => {
        const cur = W.__agPrismThoughtBridge;
        if (cur?.__prismBridgeReady && isF(cur.cacheStats) && isF(cur.cancelTranslate)) return;
        T(() => cur?.dispose?.());
        const c = mkRpc('__agPrismThoughtCall', 64, () => ({ ok: false, timeout: true, error: 'Request timed out' }), (e) => ({ ok: false, error: e }), { ok: false, disposed: true });
        const rpc = (p, onP, ms = 48000) => {
          const a = p?.action || 'get-config';
          if (!isF(W.__agPrismThoughtCall)) return Promise.resolve({ ok: false, offline: true, action: a, error: OFF_MSG });
          return c.send((id) => ({ id, action: a, input: p }), ms, onP ? { onP, buf: '' } : null, a === 'cancel-translate' || a === 'cache-stats' || a === 'clear-cache').then((r) => (r && !r.action && !r.ok ? { ...r, action: a } : r));
        };
        const b = {
          __prismBridgeReady: true,
          call: (i) => rpc(isO(i) ? { ...i } : { action: String(i || 'get-config') }, null, 25000),
          translateStream: (o, onP) => rpc({ ...(isO(o) ? o : {}), action: 'translate-stream', text: o?.text || '', mode: o?.mode || 'ai' }, onP, Math.min(180000, 90000 + Math.max(0, c.pend.size - 2) * 30000)),
          cancelTranslate: (v) => rpc(isO(v) ? { ...v, action: 'cancel-translate' } : { action: 'cancel-translate', requestId: v, key: v }, null, 8000),
          cacheStats: () => rpc({ action: 'cache-stats' }, null, 8000),
          clearCache: () => rpc({ action: 'clear-cache' }, null, 8000),
          onChunk: (id, ch) => {
            const it = c.pend.get(id);
            if (!it || !isF(it.onP)) return;
            let txt = null;
            if (typeof ch === 'string') it.buf = txt = ch;
            else if (isO(ch) && typeof ch.a === 'string') { const s = typeof it.buf === 'string' ? it.buf : ''; if ((ch.o | 0) === s.length) it.buf = txt = s + ch.a; }
            if (txt !== null) { T(() => it.arm?.(60000)); T(() => it.onP(txt)); }
          },
          resolve: c.resolve, dispose: c.dispose,
        };
        W.__agPrismThoughtBridge = b; W.__agPrismThoughtOnChunk = b.onChunk; W.__agPrismThoughtResolve = c.resolve;
      });

      const ensureUsage = () => T(() => {
        const cur = W.__agPrismUsageBridge;
        if (cur?.__prismBridgeReady && isF(cur.listSummaries)) return;
        T(() => cur?.dispose?.());
        const fu = (x) => ({ ok: false, records: [], summaries: [], ...x });
        const c = mkRpc('__agPrismUsageCall', 12, () => fu({ timeout: true }), (e, b) => fu(b ? { busy: true } : { error: e }), fu({ disposed: true }));
        const rpc = (q, ms = 18000) => (!isF(W.__agPrismUsageCall) ? Promise.resolve(fu({ offline: true })) : c.send((id) => ({ id, ...q }), ms));
        const b = {
          __prismBridgeReady: true, isOnline: () => isF(W.__agPrismUsageCall),
          fetchBatch: (o, ms = 18000) => (isO(o) && !Array.isArray(o) ? rpc({ action: o.action || 'fetch-batch', items: Array.isArray(o.items) ? o.items : [], includeSummaries: Boolean(o.includeSummaries) }, ms) : rpc({ action: 'fetch-batch', items: Array.isArray(o) ? o : [] }, ms)),
          listSummaries: (ms = 12000) => rpc({ action: 'list-summaries', items: [], includeSummaries: true }, ms),
          resolve: c.resolve, dispose: c.dispose,
        };
        W.__agPrismUsageBridge = b; W.__agPrismUsageResolve = c.resolve;
      });

      const destroyMods = (extra) => {
        const ks = sp('__agPrismTelemetry,__agPrismEffortSlider,__agPrismThought,__agPrismOmni,__agPrismContextMenu');
        if (extra) ks.push(...sp(extra));
        for (const k of ks) T(() => W[k]?.destroy?.());
      };

      const stripForeign = () => {
        destroyMods('__agPrism,__agPrismInlineDiff,__agPrismHostI18n,__agPrismPeriodicPicker,__agPrismCssMgr');
        T(() => {
          const de = D.documentElement;
          for (const a of sp('data-ag-prism-host-i18n,data-ag-prism-periodic-picker,data-ag-pp-open,data-ag-cs-model-menu')) de?.removeAttribute?.(a);
          qa('[data-ag-cs-aux-dual],[data-ag-cs-model-overlay]').forEach((el) => { el.removeAttribute('data-ag-cs-aux-dual'); el.removeAttribute('data-ag-cs-model-overlay'); });
          qa('[data-testid="prism-thought-ai-config"],[data-testid="prism-thought-general-config"],.ag-cs-ctx-menu,.ag-cs-ctx-toast,.ag-cs-inline-diff-box,.ag-cs-diff-ctx-menu').forEach((el) => el.remove());
        });
        for (const k of sp('__agPrismRepoBridge,__agPrismThoughtBridge,__agPrismUsageBridge,__agPrismOmniBridge')) T(() => W[k]?.dispose?.());
        for (const id of [SID, LSID, ...sp('ag-prism-settings-v101-css,ag-prism-studio-v101-css,ag-prism-omni-css,ag-prism-inline-diff-css')]) T(() => gid(id)?.remove());
        for (const k of sp('__agPrismCssMgr,__agPrismThought,__agPrismThoughtSettingsUi,__agPrismInlineDiff,__agPrismInlineDiffFactory,__agPrismInlineDiffResolve,__agPrismOmni,__agPrismContextMenu,__agPrism,__agClaudeStyle')) { delete W[k]; delete G[k]; }
      };

      const hasMarkers = () => Boolean(T(() => {
        const cl = D.body?.classList;
        return (cl && (cl.contains('theme-standalone') || cl.contains('monaco-workbench'))) || qs('.agy-shell,.agy-home,[data-testid="aux-pane-split"],[data-testid="conversation-view"],[data-testid="agent-input-box"],[data-testid="model-selector-trigger"],.monaco-workbench');
      }));

      const checkHost = () => T(() => {
        const href = typeof W.location?.href === 'string' ? W.location.href : '';
        if (!href) return 'ok';
        const low = href.toLowerCase(), ttl = String(D.title || '');
        if (/^(?:devtools:\\/\\/|data:|chrome:|chrome-extension:|edge:|blob:|plugin:)/.test(low)) return 'reject';
        if (/^(?:vscode-file:\\/\\/|app:\\/\\/|about:)/.test(low)) return /^(?:untitled|launchpad)$/i.test(ttl.trim()) || /\\/launchpad(?:\\.html)?(?:[?#]|$)/i.test(low) ? 'reject' : 'ok';
        const m = /^(https?):\\/\\/(127\\.0\\.0\\.1|localhost|\\[::1\\])(?::\\d+)?(\\/[^?#]*)?(?:[?#]|$)/i.exec(href);
        if (!m) return /^https?:/.test(low) ? 'reject' : 'ok';
        if (/^\\/(?:viewer(?:\\/|$)|sandbox(?:\\/|$)|stream(?:\\/|$)|api(?:\\/|$))/.test((m[3] || '/').toLowerCase())) return 'reject';
        if (hasMarkers()) return 'ok';
        const rs = String(D.readyState || '');
        if (m[1].toLowerCase() === 'http') return rs === 'loading' ? 'defer' : 'reject';
        return /\\bantigravity\\b/i.test(ttl) ? 'ok' : (rs === 'complete' ? 'reject' : 'ok');
      }) || 'ok';

      let status = 'ok', mounted = false;
      const mount = () => {
        if (mounted || !D.documentElement) return;
        const v = checkHost();
        if (v === 'reject') { status = 'skipped-non-host'; stripForeign(); return; }
        if (v === 'defer') { status = 'deferred'; D.addEventListener('DOMContentLoaded', mount, { once: true }); return; }
        mounted = true;
        if (W.addEventListener && String(D.readyState || '') !== 'complete') W.addEventListener('load', () => { if (checkHost() === 'reject') stripForeign(); }, { once: true });
        try {
          cleanOld(); ensureRepo(); ensureThought(); ensureUsage();
          const bootCfg = __AG_INJ_BOOTCFG__;
          if (D.head) applyStyle(bootCfg);
          else D.addEventListener('DOMContentLoaded', () => applyStyle(bootCfg), { once: true });
          const cur = W.__agPrism || W.__agClaudeStyle;
          if (cur && cur.version === VER && cur.codeHash === __AG_INJ_CODEHASH__) cur.refreshConfig(bootCfg);
          else {
            destroyMods();
            T(() => qa('[data-ag-prism-fallback="1"]').forEach((n) => n.remove()));
            __AG_INJ_BUNDLE__();
            if (isF(G.__agCsUiMain)) G.__agCsUiMain(bootCfg);
          }
          if (W.__agClaudeStyle && !W.__agPrism) W.__agPrism = W.__agClaudeStyle;
          else if (W.__agPrism) W.__agClaudeStyle = W.__agPrism;
          hookApiCssMgr(W.__agPrism);
          const eCfg = (isF(W.__agPrism?.getState) ? W.__agPrism.getState()?.cfg : null) || bootCfg;
          T(() => { W.__agPrismCssMgr?.sync?.(eCfg); W.__agPrismCssMgr?._armObserver?.(); });
          T(() => (eCfg?.omniModule === 'off' ? W.__agPrismOmni?.destroy?.() : W.__agPrismOmni?.sync?.(eCfg, W.__agPrismOmniServerMeta || null)));
          const de = D.documentElement;
          if (de) {
            if (!de.hasAttribute('data-ag-prism')) de.setAttribute('data-ag-prism', VER);
            if (eCfg?.thoughtTranslate && eCfg.thoughtTranslate !== 'off') de.setAttribute('data-ag-prism-thought-view', eCfg.thoughtView === 'bilingual' ? 'bilingual' : 'immersive');
            else de.removeAttribute('data-ag-prism-thought-view');
          }
        } catch (e) {
          status = 'error: ' + (e?.message || String(e));
          if (typeof console !== 'undefined' && console.error) console.error('[obsidian-prism] init error:', e);
        }
      };

      if (D.documentElement) mount();
      else {
        status = 'deferred';
        const onR = () => { if (D.documentElement) { D.removeEventListener('readystatechange', onR); D.removeEventListener('DOMContentLoaded', onR); mount(); } };
        D.addEventListener('readystatechange', onR); D.addEventListener('DOMContentLoaded', onR);
      }
      const api = W.__agPrism || W.__agClaudeStyle;
      return { version: VER, status, codeHash: api?.codeHash || __AG_INJ_CODEHASH__ };
    })()`;
    _injectWrapperTemplate = minifySingleSource(rawTpl);
    return _injectWrapperTemplate;
  }

  return {
    CH1_RUNTIME_UI_KEYS,
    normalizeLangIdNode,
    resolveSystemLangNode,
    loadLocalesModuleFresh,
    buildRuntimeUiSlicePayload,
    getConfigRefreshTemplate,
    buildConfigRefreshExpression,
    getInjectWrapperTemplate,
  };
}

module.exports = {
  CH1_RUNTIME_UI_KEYS,
  normalizeLangIdNode,
  extractSingleLangRuntimeSlice,
  createCh1Templates,
};
