// Channel 18 Settings UI extension: mounts Global UI Font + custom.css controls into Ch9 (0 innerHTML, 0 B added to Ch9)
(function (root, factory) {
  try {
    const prev = (typeof window !== 'undefined' && window && window.__agPrismCustomStyleSettingsUi) || (root && root.__agPrismCustomStyleSettingsUi);
    if (prev && typeof prev.dispose === 'function') prev.dispose(typeof document !== 'undefined' ? document : null);
  } catch {}
  const api = factory(root);
  if (root) root.__agPrismCustomStyleSettingsUi = api;
  if (typeof window !== 'undefined' && window && window !== root) {
    window.__agPrismCustomStyleSettingsUi = api;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function (G) {
  'use strict';

  const UI_STYLE_ID = 'ag-prism-custom-style-ui-css';
  const DATALIST_ID = 'ag-prism-local-fonts-list';
  const UI_FONT_MODES = Object.freeze(['default', 'system-sans', 'noto-sans', 'inter', 'harmony', 'custom']);
  const UI_FONT_OPT_KEYS = Object.freeze({
    default: 'optChatFontDefault',
    'system-sans': 'optChatFontSystemSans',
    'noto-sans': 'optChatFontNotoSans',
    inter: 'optChatFontInter',
    harmony: 'optChatFontHarmony',
    custom: 'optFontCustom',
  });

  const EXTRA_CSS = [
    '.ag-cs-css-meta-box{margin:0 0 10px;padding:8px 10px;border-radius:8px;border:1px solid var(--ag-cs-border-1,rgba(148,163,184,.22));background:var(--ag-cs-tonal-1,rgba(148,163,184,.06));display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;}',
    '.ag-cs-css-status{font-size:11.5px;line-height:1.4;color:var(--muted-foreground,#94A3B8);}',
    '.ag-cs-css-status[data-tone="ok"]{color:var(--success,#50A37B);}',
    '.ag-cs-css-status[data-tone="warn"]{color:var(--warning,#F2B84B);}',
    '.ag-cs-css-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}',
  ].join('\n');

  let hookedBeta4 = false;
  let hookedBeta4Ext = null;
  let origBeta4Sync = null;
  let lastCustomCssMeta = null;
  const trappedTargets = [];
  const activeTimers = new Set();
  const clearTimer = (t) => {
    if (!t) return;
    try {
      const fn = (typeof clearTimeout === 'function' ? clearTimeout : G.clearTimeout);
      if (typeof fn === 'function') fn(t);
    } catch {}
  };

  const sa = (el, k, v = '') => el && el.setAttribute && el.setAttribute(k, String(v));
  const ga = (el, k) => (el && el.getAttribute ? el.getAttribute(k) : null);
  const ra = (el, k) => el && el.removeAttribute && el.removeAttribute(k);
  const qs = (el, s) => (el && el.querySelector ? el.querySelector(s) : null);
  const mk = (doc, tag, cls, txt) => {
    const el = doc.createElement(tag);
    if (cls) el.className = cls;
    if (txt !== undefined && txt !== null) el.textContent = String(txt);
    return el;
  };

  function getStrings(lang, baseUi, win) {
    const locMod = (win && win.__agCsLocales) || G.__agCsLocales || (typeof window !== 'undefined' ? window.__agCsLocales : null);
    let seed = baseUi && typeof baseUi === 'object' ? Object.assign({}, baseUi) : {};
    if ((!seed.onLabel || !seed.offLabel) && locMod && typeof locMod.getUiStrings === 'function') {
      try { seed = Object.assign({}, locMod.getUiStrings(lang), seed); } catch {}
    }
    const b4 = (win && win.__agPrismI18nExtBeta4) || G.__agPrismI18nExtBeta4 || (typeof window !== 'undefined' ? window.__agPrismI18nExtBeta4 : null);
    const cs = (win && win.__agPrismCustomStyleI18n) || G.__agPrismCustomStyleI18n || (typeof window !== 'undefined' ? window.__agPrismCustomStyleI18n : null);
    const merged = b4 && typeof b4.mergeIntoUiStrings === 'function' ? b4.mergeIntoUiStrings(seed, lang) : seed;
    if (cs && typeof cs.getStrings === 'function') {
      return Object.assign(merged, cs.getStrings(lang));
    }
    return merged;
  }

  function ensureStyle(doc, win) {
    if (!doc || !doc.head) return;
    let st = typeof doc.getElementById === 'function' ? doc.getElementById(UI_STYLE_ID) : null;
    if (!st) {
      st = doc.createElement('style');
      st.id = UI_STYLE_ID;
      st.textContent = EXTRA_CSS;
      doc.head.appendChild(st);
    } else if (st.textContent !== EXTRA_CSS) {
      st.textContent = EXTRA_CSS;
    }
    try { ((win && win.__agPrismCustomStyle) || G.__agPrismCustomStyle)?.ensureUserCssLast?.(doc); } catch {}
  }

  function sendSettingPayload(win, payload) {
    try {
      const fn =
        (win && (win.__agPrismSetting || win.__agClaudeStyleSetting)) ||
        G.__agPrismSetting ||
        G.__agClaudeStyleSetting;
      if (typeof fn === 'function') {
        fn(JSON.stringify(payload));
        return true;
      }
    } catch {}
    return false;
  }

  function saveSettingFallback(win, ctx, key, value) {
    if (ctx && typeof ctx.saveSetting === 'function') {
      ctx.saveSetting(key, value);
      return;
    }
    sendSettingPayload(win, { key, value });
  }

  function saveBatchFallback(win, ctx, entries) {
    if (ctx && typeof ctx.saveSettingsBatch === 'function') {
      ctx.saveSettingsBatch(entries);
      return;
    }
    sendSettingPayload(win, { action: 'patch-batch', entries });
  }

  function readLiveCfg(ctx, key, fallback) {
    if (ctx && ctx.cfgOverride && Object.prototype.hasOwnProperty.call(ctx.cfgOverride, key)) {
      const ov = ctx.cfgOverride[key];
      if (ov !== undefined && ov !== null) return ov;
    }
    try {
      if (ctx && typeof ctx.effVal === 'function') {
        const v = ctx.effVal(key, ctx.lang);
        if (v !== undefined && v !== null) return v;
      }
    } catch {}
    try {
      const st = ((ctx && ctx.win) || G).__agPrism?.getState?.();
      if (st && st.cfg && Object.prototype.hasOwnProperty.call(st.cfg, key)) {
        return st.cfg[key];
      }
    } catch {}
    try {
      const cs = ((ctx && ctx.win) || G).__agPrismCustomStyle?.getState?.();
      if (cs && cs.cfg && Object.prototype.hasOwnProperty.call(cs.cfg, key)) {
        return cs.cfg[key];
      }
    } catch {}
    return fallback;
  }

  function applyLivePreview(win, doc, patch) {
    const cs = (win && win.__agPrismCustomStyle) || G.__agPrismCustomStyle;
    if (!cs || typeof cs.sync !== 'function') return;
    let cur = {};
    try { cur = (win || G).__agPrism?.getState?.()?.cfg || cs.getState?.()?.cfg || {}; } catch {}
    cs.sync(Object.assign({}, cur, patch), null, doc);
  }

  function ensureLocalFontDatalist(doc, rootEl) {
    let dl = typeof doc.getElementById === 'function' ? doc.getElementById(DATALIST_ID) : qs(rootEl, '#' + DATALIST_ID);
    if (!dl) {
      dl = doc.createElement('datalist');
      dl.id = DATALIST_ID;
      sa(dl, 'id', DATALIST_ID);
      (rootEl || doc.body || doc.documentElement).appendChild(dl);
    }
    return dl;
  }

  function populateDatalist(doc, dl, families) {
    if (!dl) return;
    while (dl.firstChild) dl.removeChild(dl.firstChild);
    for (let i = 0; i < families.length; i++) {
      const opt = doc.createElement('option');
      opt.value = families[i];
      sa(opt, 'value', families[i]);
      dl.appendChild(opt);
    }
  }

  function ensureUiFontRow(rootEl, doc, ctx) {
    let row = qs(rootEl, '[data-ag-cs-row="uiFont"]');
    if (row) return row;
    const anchor = qs(rootEl, '[data-ag-cs-row="chatFont"]') || qs(rootEl, '[data-ag-cs-row="codeFont"]');
    if (!anchor || !anchor.parentElement) return null;

    row = mk(doc, 'div');
    sa(row, 'data-ag-cs-row', 'uiFont');
    sa(row, 'data-ag-cs-custom-style-owned', '1');

    const inner = mk(doc, 'div', 'py-2');
    const textCol = mk(doc, 'div', 'flex-1');
    const titleLine = mk(doc, 'div', 'ag-cs-settings-title-line');
    const tSpan = mk(doc, 'span');
    sa(tSpan, 'data-k', 't');
    const dSpan = mk(doc, 'span', 'whitespace-pre-wrap');
    sa(dSpan, 'data-k', 'd');
    titleLine.appendChild(tSpan);
    textCol.appendChild(titleLine);
    textCol.appendChild(dSpan);

    const ctrlWrap = mk(doc, 'div', 'shrink-0');
    const sel = mk(doc, 'select', 'ag-cs-font-select');
    sa(sel, 'data-ag-cs-ext-select', 'uiFont');
    for (let i = 0; i < UI_FONT_MODES.length; i++) {
      const m = UI_FONT_MODES[i];
      const opt = mk(doc, 'option');
      opt.value = m;
      sa(opt, 'value', m);
      sel.appendChild(opt);
    }

    const box = mk(doc, 'div', 'ag-cs-font-custom-box');
    sa(box, 'data-ag-cs-ext-custom', 'ui');
    const crow = mk(doc, 'div', 'ag-cs-font-custom-row');
    const inp = mk(doc, 'input', 'ag-cs-font-input');
    inp.type = 'text';
    inp.maxLength = 160;
    sa(inp, 'type', 'text');
    sa(inp, 'maxlength', '160');
    sa(inp, 'list', DATALIST_ID);
    sa(inp, 'data-ag-cs-ext-input', 'uiFontCustom');

    const loadBtn = mk(doc, 'button', 'ag-cs-font-act-btn');
    loadBtn.type = 'button';
    sa(loadBtn, 'type', 'button');
    sa(loadBtn, 'data-ag-cs-ext-action', 'load-local-fonts-ui');

    const resetBtn = mk(doc, 'button', 'ag-cs-font-act-btn');
    resetBtn.type = 'button';
    sa(resetBtn, 'type', 'button');
    sa(resetBtn, 'data-ag-cs-ext-action', 'reset-ui-font');

    const hint = mk(doc, 'div', 'ag-cs-font-hint');
    sa(hint, 'data-ag-cs-ext-hint', 'ui');
    hint.hidden = true;
    sa(hint, 'hidden', '');

    crow.appendChild(inp);
    crow.appendChild(loadBtn);
    crow.appendChild(resetBtn);
    box.appendChild(crow);
    box.appendChild(hint);

    let saveTimer = null;
    const commitInput = (immediate) => {
      const raw = String(inp.value || '').slice(0, 160);
      const cs = (ctx.win && ctx.win.__agPrismCustomStyle) || G.__agPrismCustomStyle;
      const fc = (ctx.win && ctx.win.__agPrismFontCustomizer) || G.__agPrismFontCustomizer;
      const sanitizer = (cs && typeof cs.sanitizeFontFamilyList === 'function' ? cs : null) || fc;
      const check = sanitizer && typeof sanitizer.sanitizeFontFamilyList === 'function' ? sanitizer.sanitizeFontFamilyList(raw) : { hadRejected: false };
      if (check.hadRejected) {
        const s = row.__csStrings || {};
        hint.textContent = s.fontSanitizedNotice || 'Unsafe characters were stripped; only valid font family names are applied';
        sa(hint, 'data-tone', 'warn');
        hint.hidden = false;
        ra(hint, 'hidden');
      } else if (ga(hint, 'data-tone') === 'warn') {
        hint.textContent = '';
        hint.hidden = true;
        sa(hint, 'hidden', '');
        ra(hint, 'data-tone');
      }
      applyLivePreview(ctx.win, doc, { uiFont: 'custom', uiFontCustom: raw });
      const persist = () => {
        if (saveTimer) { activeTimers.delete(saveTimer); saveTimer = null; }
        saveSettingFallback(ctx.win, row.__csCtx, 'uiFontCustom', raw);
      };
      if (saveTimer) { clearTimer(saveTimer); activeTimers.delete(saveTimer); saveTimer = null; }
      if (immediate) persist();
      else {
        const setFn = typeof setTimeout === 'function' ? setTimeout : G.setTimeout;
        if (typeof setFn === 'function') {
          saveTimer = setFn(persist, 180);
          activeTimers.add(saveTimer);
        } else {
          persist();
        }
      }
    };

    sel.addEventListener('change', () => {
      const val = String(sel.value || 'default');
      applyLivePreview(ctx.win, doc, { uiFont: val, uiFontCustom: String(inp.value || '') });
      saveSettingFallback(ctx.win, row.__csCtx, 'uiFont', val);
      if (typeof row.__csResync === 'function') row.__csResync({ uiFont: val });
    });
    inp.addEventListener('input', () => commitInput(false));
    inp.addEventListener('change', () => commitInput(true));

    loadBtn.addEventListener('click', async (ev) => {
      ev?.stopPropagation?.();
      const s = row.__csStrings || {};
      const fc = (ctx.win && ctx.win.__agPrismFontCustomizer) || G.__agPrismFontCustomizer;
      hint.textContent = s.fontLocalLoading || 'Loading local fonts...';
      ra(hint, 'data-tone');
      hint.hidden = false;
      ra(hint, 'hidden');
      if (!fc || typeof fc.listLocalFontFamilies !== 'function') {
        hint.textContent = s.fontLocalUnsupported || 'Local font enumeration is unavailable here';
        return;
      }
      const res = await fc.listLocalFontFamilies(ctx.win);
      if (res && res.ok) {
        const dl = ensureLocalFontDatalist(doc, rootEl);
        populateDatalist(doc, dl, res.families);
        hint.textContent = String(s.fontLocalLoaded || 'Loaded {n} local fonts').replace('{n}', String(res.families.length));
      } else if (res && res.denied) {
        hint.textContent = s.fontLocalDenied || 'Font permission was declined';
      } else {
        hint.textContent = s.fontLocalUnsupported || 'Local font enumeration is unavailable here';
      }
    });

    resetBtn.addEventListener('click', (ev) => {
      ev?.stopPropagation?.();
      if (saveTimer) { clearTimer(saveTimer); activeTimers.delete(saveTimer); saveTimer = null; }
      inp.value = '';
      hint.textContent = '';
      hint.hidden = true;
      sa(hint, 'hidden', '');
      ra(hint, 'data-tone');
      applyLivePreview(ctx.win, doc, { uiFont: 'default', uiFontCustom: '' });
      saveBatchFallback(ctx.win, row.__csCtx, { uiFont: 'default', uiFontCustom: '' });
      if (typeof row.__csResync === 'function') row.__csResync({ uiFont: 'default', uiFontCustom: '' });
    });

    ctrlWrap.appendChild(sel);
    inner.appendChild(textCol);
    inner.appendChild(ctrlWrap);
    row.appendChild(inner);
    row.appendChild(box);
    row.__csUi = { sel, box, inp, loadBtn, resetBtn, hint };

    const parent = anchor.parentElement;
    if (typeof parent.insertBefore === 'function') parent.insertBefore(row, anchor);
    else parent.appendChild(row);
    return row;
  }

  function ensureCustomCssRow(rootEl, doc, ctx) {
    let row = qs(rootEl, '[data-ag-cs-row="customCss"]');
    if (row) return row;
    const anchor = qs(rootEl, '[data-ag-cs-row="codeLigatures"]') || qs(rootEl, '[data-ag-cs-row="codeFont"]');
    if (!anchor || !anchor.parentElement) return null;

    row = mk(doc, 'div');
    sa(row, 'data-ag-cs-row', 'customCss');
    sa(row, 'data-ag-cs-custom-style-owned', '1');

    const inner = mk(doc, 'div', 'py-2');
    const textCol = mk(doc, 'div', 'flex-1');
    const titleLine = mk(doc, 'div', 'ag-cs-settings-title-line');
    const tSpan = mk(doc, 'span');
    sa(tSpan, 'data-k', 't');
    const dSpan = mk(doc, 'span', 'whitespace-pre-wrap');
    sa(dSpan, 'data-k', 'd');
    titleLine.appendChild(tSpan);
    textCol.appendChild(titleLine);
    textCol.appendChild(dSpan);

    const ctrlWrap = mk(doc, 'div', 'shrink-0');
    const grp = mk(doc, 'div', 'ag-cs-seg-group');
    sa(grp, 'role', 'group');
    sa(grp, 'data-ui-kind', 'switch');
    sa(grp, 'data-switch-on', '1');
    const thumb = mk(doc, 'span', 'ag-cs-switch-thumb');
    sa(thumb, 'aria-hidden', 'true');
    grp.appendChild(thumb);

    const BTN_CLS = 'ag-cs-seg-btn data-[pressed]:bg-secondary data-[pressed]:text-foreground';
    for (const val of ['on', 'off']) {
      const btn = mk(doc, 'button', BTN_CLS);
      btn.type = 'button';
      sa(btn, 'type', 'button');
      sa(btn, 'data-ag-cs-ext-key', 'customCss');
      sa(btn, 'data-ag-cs-ext-val', JSON.stringify(val));
      sa(btn, 'data-ag-cs-ext-role', val);
      btn.addEventListener('click', (ev) => {
        ev?.stopPropagation?.();
        applyLivePreview(ctx.win, doc, { customCss: val });
        saveSettingFallback(ctx.win, row.__csCtx, 'customCss', val);
        if (typeof row.__csResync === 'function') row.__csResync({ customCss: val });
      });
      grp.appendChild(btn);
    }

    const metaBox = mk(doc, 'div', 'ag-cs-css-meta-box');
    const statusEl = mk(doc, 'div', 'ag-cs-css-status');
    sa(statusEl, 'data-ag-cs-css-status', '1');
    const actions = mk(doc, 'div', 'ag-cs-css-actions');

    const tplBtn = mk(doc, 'button', 'ag-cs-font-act-btn');
    tplBtn.type = 'button';
    sa(tplBtn, 'type', 'button');
    sa(tplBtn, 'data-ag-cs-ext-action', 'create-custom-css-template');
    tplBtn.addEventListener('click', (ev) => {
      ev?.stopPropagation?.();
      sendSettingPayload(ctx.win, { action: 'custom-css-create-template' });
      const s = row.__csStrings || {};
      statusEl.textContent = s.cssTemplateRequested || 'Template requested; custom.css will hot-reload shortly';
      sa(statusEl, 'data-tone', 'ok');
    });

    const reloadBtn = mk(doc, 'button', 'ag-cs-font-act-btn');
    reloadBtn.type = 'button';
    sa(reloadBtn, 'type', 'button');
    sa(reloadBtn, 'data-ag-cs-ext-action', 'reload-custom-css');
    reloadBtn.addEventListener('click', (ev) => {
      ev?.stopPropagation?.();
      sendSettingPayload(ctx.win, { action: 'custom-css-reload' });
      const s = row.__csStrings || {};
      statusEl.textContent = s.cssReloadRequested || 'Reloading custom.css...';
      ra(statusEl, 'data-tone');
    });

    actions.appendChild(tplBtn);
    actions.appendChild(reloadBtn);
    metaBox.appendChild(statusEl);
    metaBox.appendChild(actions);

    ctrlWrap.appendChild(grp);
    inner.appendChild(textCol);
    inner.appendChild(ctrlWrap);
    row.appendChild(inner);
    row.appendChild(metaBox);
    row.__csCssUi = { grp, statusEl, tplBtn, reloadBtn };

    const parent = anchor.parentElement;
    if (anchor.nextSibling && typeof parent.insertBefore === 'function') parent.insertBefore(row, anchor.nextSibling);
    else parent.appendChild(row);
    return row;
  }

  function formatCssStatus(s, cssState, cssOn) {
    if (!cssOn) return { text: s.cssStatusDisabled || 'Disabled (local file preserved)', tone: '' };
    const st = cssState && cssState.status ? cssState.status : 'missing';
    const blocked = Number(cssState && cssState.blockedImports) || 0;
    const suffix = blocked > 0 ? ` · ${String(s.cssBlockedImports || 'Blocked {n} @import rule(s)').replace('{n}', String(blocked))}` : '';
    if (st === 'active') {
      const kb = (Math.max(1, Number(cssState.bytes) || 0) / 1024).toFixed(1);
      return { text: String(s.cssStatusActive || 'Active ({kb} KB)').replace('{kb}', kb) + suffix, tone: blocked > 0 ? 'warn' : 'ok' };
    }
    if (st === 'rejected-too-large') return { text: s.cssStatusTooLarge || 'Rejected: exceeds 256 KB safety limit', tone: 'warn' };
    if (st === 'rejected-symlink' || st === 'rejected-non-file') return { text: s.cssStatusSymlink || 'Rejected: symlinks are not allowed', tone: 'warn' };
    if (st === 'error') return { text: s.cssStatusError || 'Failed to read custom.css (check permissions)', tone: 'warn' };
    if (st === 'empty') return { text: (s.cssStatusEmpty || 'custom.css is currently empty') + suffix, tone: blocked > 0 ? 'warn' : '' };
    return { text: s.cssStatusMissing || 'No custom.css found (0 overhead)', tone: '' };
  }

  function sync(rootEl, rawCtx) {
    if (!rootEl || ga(rootEl, 'data-body-built') !== '1') return false;
    const baseCtx = rootEl.__csLastBaseCtx && typeof rootEl.__csLastBaseCtx === 'object' ? rootEl.__csLastBaseCtx : null;
    if (rawCtx && typeof rawCtx === 'object' && (rawCtx.ui || typeof rawCtx.saveSetting === 'function' || typeof rawCtx.effVal === 'function')) {
      rootEl.__csLastBaseCtx = rawCtx;
    }
    const mergedRawCtx = baseCtx ? Object.assign({}, baseCtx, rawCtx || {}) : (rawCtx || {});
    const doc = mergedRawCtx.doc || rootEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return false;
    const win = mergedRawCtx.win || doc.defaultView || (typeof window !== 'undefined' ? window : G);
    const rawLang =
      (rawCtx && rawCtx.lang) ||
      ga(rootEl, 'data-ag-cs-lang') ||
      (doc.documentElement && ga(doc.documentElement, 'data-ag-cs-lang')) ||
      mergedRawCtx.lang ||
      (mergedRawCtx.cfgOverride && mergedRawCtx.cfgOverride.language) ||
      'en';
    const lang = rawLang === 'auto' ? 'en' : rawLang;
    const ui = getStrings(lang, mergedRawCtx.ui, win);
    const ctx = Object.assign({}, mergedRawCtx, { doc, win, lang, ui });
    const runMut = typeof ctx.runGuardedMut === 'function' ? ctx.runGuardedMut : (fn) => fn();

    const uiFont = String(readLiveCfg(ctx, 'uiFont', 'default') || 'default');
    const uiFontCustom = String(readLiveCfg(ctx, 'uiFontCustom', '') || '');
    const customCssRaw = readLiveCfg(ctx, 'customCss', 'on');
    const customCssOn = customCssRaw !== 'off' && customCssRaw !== false;
    const clientState = (win.__agPrismCustomStyle || G.__agPrismCustomStyle)?.getState?.()?.customCss || null;
    const csState =
      (mergedRawCtx.customCssMeta && typeof mergedRawCtx.customCssMeta === 'object' ? mergedRawCtx.customCssMeta : null) ||
      (clientState && clientState.status ? clientState : null) ||
      lastCustomCssMeta ||
      {};

    const resyncNow = (patch) => {
      const nextCtx = rawCtx ? Object.assign({}, rawCtx) : {};
      if (patch && typeof patch === 'object') nextCtx.cfgOverride = Object.assign({}, nextCtx.cfgOverride || {}, patch);
      else delete nextCtx.cfgOverride;
      return sync(rootEl, nextCtx);
    };

    runMut(() => {
      ensureStyle(doc, win);

      const uiRow = ensureUiFontRow(rootEl, doc, ctx);
      if (uiRow) {
        uiRow.__csStrings = ui;
        uiRow.__csCtx = ctx;
        uiRow.__csResync = resyncNow;
        const tEl = qs(uiRow, '[data-k="t"]');
        const dEl = qs(uiRow, '[data-k="d"]');
        if (tEl && tEl.textContent !== ui.setUiFontTitle) tEl.textContent = ui.setUiFontTitle || 'Global UI Font';
        if (dEl && dEl.textContent !== ui.setUiFontDesc) dEl.textContent = ui.setUiFontDesc || '';
        const u = uiRow.__csUi;
        if (u && u.sel) {
          const opts = u.sel.children || [];
          for (let i = 0; i < opts.length; i++) {
            const opt = opts[i];
            const k = UI_FONT_OPT_KEYS[opt.value];
            const lbl = (k && ui[k]) || opt.value;
            if (opt.textContent !== lbl) opt.textContent = lbl;
          }
          const safeMode = UI_FONT_MODES.includes(uiFont) ? uiFont : 'default';
          if (u.sel.value !== safeMode) u.sel.value = safeMode;
          const showCustom = safeMode === 'custom';
          u.box.hidden = !showCustom;
          if (showCustom) ra(u.box, 'hidden');
          else sa(u.box, 'hidden', '');
          if (u.box.style) u.box.style.display = showCustom ? 'flex' : 'none';
          if (doc.activeElement !== u.inp && u.inp.value !== uiFontCustom) u.inp.value = uiFontCustom;
          sa(u.inp, 'placeholder', ui.uiFontCustomPlaceholder || 'UI font families, comma-separated');
          u.loadBtn.textContent = ui.btnLoadLocalFonts || 'Load Local Fonts';
          u.resetBtn.textContent = ui.btnResetFontDefault || 'Reset Default';
        }
      }

      const cssRow = ensureCustomCssRow(rootEl, doc, ctx);
      if (cssRow) {
        cssRow.__csStrings = ui;
        cssRow.__csCtx = ctx;
        cssRow.__csResync = resyncNow;
        const tEl = qs(cssRow, '[data-k="t"]');
        const dEl = qs(cssRow, '[data-k="d"]');
        if (tEl && tEl.textContent !== ui.setCustomCssTitle) tEl.textContent = ui.setCustomCssTitle || 'Custom CSS (custom.css)';
        if (dEl && dEl.textContent !== ui.setCustomCssDesc) dEl.textContent = ui.setCustomCssDesc || '';
        const cu = cssRow.__csCssUi;
        if (cu) {
          sa(cu.grp, 'data-switch-on', customCssOn ? '1' : '0');
          const btns = cu.grp.querySelectorAll ? cu.grp.querySelectorAll('button[data-ag-cs-ext-key="customCss"]') : [];
          for (let i = 0; i < btns.length; i++) {
            const b = btns[i];
            const isOnBtn = ga(b, 'data-ag-cs-ext-role') === 'on';
            const lbl = isOnBtn ? (ui.onLabel || 'On') : (ui.offLabel || 'Off');
            if (b.textContent !== lbl) b.textContent = lbl;
            const act = isOnBtn === customCssOn;
            sa(b, 'aria-pressed', act ? 'true' : 'false');
            if (act) sa(b, 'data-pressed');
            else ra(b, 'data-pressed');
            b.tabIndex = act ? -1 : 0;
            sa(b, 'tabindex', act ? '-1' : '0');
          }
          const info = formatCssStatus(ui, csState, customCssOn);
          if (cu.statusEl.textContent !== info.text) cu.statusEl.textContent = info.text;
          if (info.tone) sa(cu.statusEl, 'data-tone', info.tone);
          else ra(cu.statusEl, 'data-tone');
          cu.tplBtn.textContent = ui.btnCreateCustomCss || 'Create Template';
          cu.reloadBtn.textContent = ui.btnReloadCustomCss || 'Reload';
          const showCreate = csState.status === 'missing' || !csState.status;
          cu.tplBtn.hidden = !showCreate;
          if (showCreate) ra(cu.tplBtn, 'hidden');
          else sa(cu.tplBtn, 'hidden', '');
          if (cu.tplBtn.style) cu.tplBtn.style.display = showCreate ? '' : 'none';
        }
      }
    });
    return true;
  }

  function hookBeta4Ext(win, extOverride) {
    const ext = extOverride || (win && win.__agPrismSettingsExtBeta4) || G.__agPrismSettingsExtBeta4;
    if (!ext || typeof ext.sync !== 'function') return false;
    if (ext.__agCustomStyleHooked) return true;
    origBeta4Sync = ext.sync;
    hookedBeta4Ext = ext;
    ext.sync = function wrappedBeta4Sync(rootEl, rawCtx) {
      const res = origBeta4Sync.apply(this, arguments);
      try { sync(rootEl, rawCtx); } catch {}
      return res;
    };
    ext.__agCustomStyleHooked = true;
    hookedBeta4 = true;
    return true;
  }

  function setCustomCssMeta(meta) {
    if (meta && typeof meta === 'object') {
      lastCustomCssMeta = Object.assign({}, lastCustomCssMeta || {}, meta);
    }
  }

  function syncIfPresent(docOverride, winOverride, cfgOverride, customCssMetaOverride) {
    const doc = docOverride || (typeof document !== 'undefined' ? document : null);
    const win = winOverride || (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : G);
    if (customCssMetaOverride && typeof customCssMetaOverride === 'object') {
      setCustomCssMeta(customCssMetaOverride);
    }
    hookBeta4Ext(win);
    if (!doc) return false;
    const sec = typeof doc.getElementById === 'function' ? doc.getElementById('ag-cs-settings-sec') : null;
    if (!sec || ga(sec, 'data-body-built') !== '1') return false;
    const syncCtx = { doc, win };
    if (cfgOverride && typeof cfgOverride === 'object') syncCtx.cfgOverride = cfgOverride;
    if (customCssMetaOverride && typeof customCssMetaOverride === 'object') syncCtx.customCssMeta = customCssMetaOverride;
    return sync(sec, syncCtx);
  }

  function installBeta4Trap(win, doc) {
    const targets = [];
    if (win && typeof win === 'object') targets.push(win);
    if (G && typeof G === 'object' && G !== win) targets.push(G);
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      if (trappedTargets.includes(target)) continue;
      try {
        const desc = Object.getOwnPropertyDescriptor(target, '__agPrismSettingsExtBeta4');
        if (desc && desc.configurable === false) continue;
        let curVal = target.__agPrismSettingsExtBeta4;
        if (curVal && typeof curVal.sync === 'function') {
          hookBeta4Ext(win, curVal);
        }
        Object.defineProperty(target, '__agPrismSettingsExtBeta4', {
          configurable: true,
          enumerable: true,
          get() { return curVal; },
          set(v) {
            curVal = v;
            if (v && typeof v.sync === 'function') {
              hookBeta4Ext(win, v);
              try { syncIfPresent(doc, win); } catch {}
            }
          },
        });
        trappedTargets.push(target);
      } catch {}
    }
  }

  function install(docOverride, winOverride) {
    const doc = docOverride || (typeof document !== 'undefined' ? document : null);
    const win = winOverride || (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : G);
    hookBeta4Ext(win);
    installBeta4Trap(win, doc);
    syncIfPresent(doc, win);
  }

  function dispose(docOverride) {
    for (const tid of activeTimers) {
      clearTimer(tid);
    }
    activeTimers.clear();
    if (hookedBeta4 && origBeta4Sync) {
      try {
        const ext = hookedBeta4Ext || (typeof window !== 'undefined' && window.__agPrismSettingsExtBeta4) || G.__agPrismSettingsExtBeta4;
        if (ext && ext.__agCustomStyleHooked) {
          ext.sync = origBeta4Sync;
          delete ext.__agCustomStyleHooked;
        }
      } catch {}
      hookedBeta4 = false;
      hookedBeta4Ext = null;
      origBeta4Sync = null;
    }
    while (trappedTargets.length > 0) {
      const target = trappedTargets.pop();
      try {
        const curVal = target.__agPrismSettingsExtBeta4;
        delete target.__agPrismSettingsExtBeta4;
        if (curVal !== undefined) {
          target.__agPrismSettingsExtBeta4 = curVal;
        }
      } catch {}
    }
    const doc = docOverride || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;
    try { doc.getElementById?.(UI_STYLE_ID)?.remove?.(); } catch {}
    try { doc.querySelectorAll?.('[data-ag-cs-custom-style-owned="1"]')?.forEach?.((n) => n.remove?.()); } catch {}
  }

  return {
    UI_STYLE_ID,
    UI_FONT_MODES,
    setCustomCssMeta,
    sync,
    syncIfPresent,
    install,
    dispose,
  };
});
