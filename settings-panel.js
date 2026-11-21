// Obsidian Prism — Collapsible Settings Control Center, Scene Presets, Config Backup & Credits Module
(function (root) {
  'use strict';
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : window);
  if (!G) return;

  const SETTINGS_SEC_ID = 'ag-cs-settings-sec';
  const STORAGE_SETTINGS_OPEN_KEY = 'ag-prism:settings-open';
  const STORAGE_SETTINGS_SUBTAB_KEY = 'ag-prism:settings-subtab';
  const SETTINGS_STYLE_ID = 'ag-prism-settings-v101-css';
  const PRISM_STORAGE_KEYS = [
    'ag-prism:config',
    'ag-prism:lastFileConfig',
    'agClaudeStyle.settings.v3',
    'ag-claude-style:config',
    'ag-prism:trajRollup.v1',
    STORAGE_SETTINGS_OPEN_KEY,
    STORAGE_SETTINGS_SUBTAB_KEY,
    '__op_chroma_v1',
    'agCs.pulseVialMode.v1',
    'ag_prism_thought_zh_cache_v1',
    'ag_prism_thought_view_mode_v1',
    'ag_prism_thought_style_tag_v1',
  ];

  function clearPrismLocalStorage(store) {
    const st = store || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!st || typeof st.removeItem !== 'function') return 0;
    let n = 0;
    for (const k of PRISM_STORAGE_KEYS) {
      try { st.removeItem(k); n += 1; } catch {}
    }
    return n;
  }

  const SETTINGS_EXTRA_CSS =
    '.ag-cs-settings-topdeck{display:flex;flex-direction:column;gap:8px;margin-bottom:10px;padding:9px 11px;border-radius:var(--ag-cs-r-md,10px);border:1px solid var(--border,rgba(148,163,184,.18));background:rgba(128,138,158,.05)}' +
    '.ag-cs-preset-row,.ag-cs-cfg-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}' +
    '.ag-cs-preset-label{font-size:11px;font-weight:600;color:var(--muted-foreground)}' +
    '.ag-cs-preset-pills,.ag-cs-cfg-actions{display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap}' +
    '.ag-cs-preset-btn,.ag-cs-cfg-btn{height:25px;padding:0 10px;border-radius:999px;border:1px solid var(--border,rgba(148,163,184,.22));background:transparent;color:var(--foreground);font-size:11.5px;font-weight:500;cursor:pointer;transition:background .15s,border-color .15s}' +
    '.ag-cs-cfg-btn{border-radius:var(--ag-cs-r-sm,7px);height:26px}' +
    '.ag-cs-preset-btn:hover,.ag-cs-cfg-btn:hover{background:rgba(128,138,158,.12);border-color:rgba(148,163,184,.38)}' +
    '.ag-cs-preset-btn[data-active="1"]{background:rgba(49,134,255,.15);border-color:rgba(49,134,255,.48);font-weight:600}' +
    '.ag-cs-subtabs{display:flex;align-items:center;gap:3px;flex-wrap:wrap;padding-top:6px;border-top:1px solid var(--border,rgba(148,163,184,.14))}' +
    '.ag-cs-subtab-btn{height:24px;padding:0 9px;border-radius:var(--ag-cs-r-sm,6px);border:0;background:transparent;color:var(--muted-foreground);font-size:11.5px;font-weight:500;cursor:pointer}' +
    '.ag-cs-subtab-btn:hover{color:var(--foreground);background:rgba(128,138,158,.09)}' +
    '.ag-cs-subtab-btn[aria-selected="true"]{background:var(--secondary,rgba(128,138,158,.18));color:var(--foreground);font-weight:600}' +
    '.ag-cs-settings-group[hidden]{display:none!important}' +
    '.ag-cs-settings-card{border-radius:var(--ag-cs-r-lg,12px)!important}' +
    '.ag-cs-seg-group{border-radius:var(--ag-cs-r-md,8px)!important}' +
    '.ag-cs-seg-btn{border-radius:var(--ag-cs-r-sm,6px)!important}' +
    '.ag-cs-cfg-footer{margin-top:10px;padding:10px 12px;border-radius:var(--ag-cs-r-md,10px);border:1px solid var(--border,rgba(148,163,184,.18));background:rgba(128,138,158,.04)}' +
    '.ag-cs-cfg-meta{display:flex;flex-direction:column;gap:2px;min-width:180px;flex:1}' +
    '.ag-cs-cfg-title{font-size:12px;font-weight:600;color:var(--foreground)}' +
    '.ag-cs-cfg-hint{font-size:11px;color:var(--muted-foreground)}' +
    '.ag-cs-cfg-hint[data-tone="ok"]{color:#10b981}.ag-cs-cfg-hint[data-tone="err"]{color:#ef4444}';

  const S_ON = Object.freeze({ allowed: ['on', 'off'], default: 'on' });
  const S_OFF = Object.freeze({ allowed: ['on', 'off'], default: 'off' });
  const S_AUTO = Object.freeze({ allowed: ['auto', 'on', 'off'], default: 'auto' });
  const S_T = Object.freeze({ allowed: [true, false], default: true });
  const S_F = Object.freeze({ allowed: [true, false], default: false });

  const PRISM_SETTINGS_SCHEMA = Object.freeze({
    palette: { allowed: ['obsidian', 'host', 'warm'], default: 'obsidian', aliases: { claude: 'warm' } },
    lightPreset: { allowed: ['crystal', 'alabaster'], default: 'crystal' },
    accentTone: { allowed: ['follow', 'cobalt', 'iris', 'amber', 'mono'], default: 'follow' },
    cornerStyle: { allowed: ['sharp', 'balanced', 'soft'], default: 'balanced' },
    ambientIntensity: { allowed: ['0', '35', '70', '100'], default: '100' },
    motionLevel: { allowed: ['off', 'subtle', 'standard', 'ultra'], default: 'ultra' },
    targetFps: { allowed: ['60', '120', '180', 'native'], default: '180' },
    homeLayout: { allowed: ['studio', 'classic', 'off'], default: 'studio' },
    homeRipple: S_T,
    logoInk: { allowed: ['accent', 'foreground'], default: 'accent' },
    language: { allowed: ['zh-CN', 'zh-TW', 'yue', 'en', 'ja'], default: 'zh-CN' },
    composerRestyle: S_T,
    placeholderStyle: { allowed: ['studio', 'host'], default: 'studio' },
    smoothCaret: S_T,
    codeFont: { allowed: ['default', 'jetbrains', 'cascadia', 'sfmono'], default: 'default' },
    codeLigatures: S_F,
    mascot: { allowed: ['crab', 'minis', 'off'], default: 'crab', aliases: { dual: 'crab' } },
    sidebarRestyle: S_T,
    sidebarCompact: S_F,
    thoughtTranslate: { allowed: ['off', 'machine', 'ai'], default: 'off' },
    thoughtTrigger: { allowed: ['preload', 'expand'], default: 'preload' },
    thoughtView: { allowed: ['immersive', 'bilingual'], default: 'immersive' },
    telemetryModule: S_AUTO,
    effortSliderModule: S_AUTO,
    omniModule: S_ON,
    linkTarget: { allowed: ['builtin', 'external'], default: 'builtin' },
    sidebarStudio: S_OFF,
    autoUpdate: S_OFF,
  });

  const SCENE_PRESETS = Object.freeze({
    ultra: Object.freeze({ motionLevel: 'ultra', targetFps: '180', homeRipple: true, mascot: 'crab', sidebarCompact: false, smoothCaret: true, ambientIntensity: '100' }),
    focus: Object.freeze({ motionLevel: 'subtle', targetFps: '120', homeRipple: false, mascot: 'off', sidebarCompact: true, smoothCaret: true, ambientIntensity: '35' }),
    eco: Object.freeze({ motionLevel: 'off', targetFps: '60', homeRipple: false, mascot: 'off', sidebarCompact: false, smoothCaret: false, ambientIntensity: '0' }),
  });

  const normThoughtStyle = (s) => (s === 'tech' || s === 'technical' ? 'technical' : s === 'concise' || s === 'custom' ? s : null);

  function getDefaultSettingsPatch() {
    const out = {};
    for (const [k, spec] of Object.entries(PRISM_SETTINGS_SCHEMA)) out[k] = spec.default;
    return out;
  }

  const redactSecrets = (s) =>
    String(s || '')
      .replace(/\b(?:sk|rk|pk|ak|AIza)[A-Za-z0-9_\-]{10,}\b/g, '[REDACTED]')
      .replace(/\bBearer\s+[A-Za-z0-9._\-]{10,}\b/gi, 'Bearer [REDACTED]');

  function sanitizeKeyVal(key, rawVal) {
    if (!Object.prototype.hasOwnProperty.call(PRISM_SETTINGS_SCHEMA, key)) return { valid: false };
    const spec = PRISM_SETTINGS_SCHEMA[key];
    let val = typeof rawVal === 'string' && spec.aliases && Object.prototype.hasOwnProperty.call(spec.aliases, rawVal) ? spec.aliases[rawVal] : rawVal;
    if (key === 'language' && val === 'auto') {
      const nav = typeof navigator !== 'undefined' && navigator?.language ? navigator.language : '';
      const normFn = G.__agCsI18n?.normalizeLanguage;
      val = typeof normFn === 'function' && nav ? normFn(nav) : /^ja\b/i.test(nav) ? 'ja' : /^en\b/i.test(nav) ? 'en' : /^zh[-_](?:HK|MO)/i.test(nav) ? 'yue' : /^zh[-_](?:TW|Hant)/i.test(nav) ? 'zh-TW' : 'zh-CN';
    }
    if ((key === 'omniModule' || key === 'sidebarStudio' || key === 'autoUpdate') && typeof val === 'boolean') val = val ? 'on' : 'off';
    if (typeof spec.default === 'string' && typeof val === 'number' && Number.isFinite(val)) val = String(val);
    return spec.allowed.includes(val) ? { valid: true, value: val } : { valid: false };
  }

  function buildSanitizedConfigExport(currentSettings = {}, rawThoughtCfg = null, version = '1.0.4') {
    const settings = {};
    for (const [k, spec] of Object.entries(PRISM_SETTINGS_SCHEMA)) {
      const c = sanitizeKeyVal(k, currentSettings[k]);
      settings[k] = c.valid ? c.value : spec.default;
    }
    const out = { schema: 'obsidian-prism-config-v1', version: String(version || '1.0.4'), exportedAt: new Date().toISOString(), settings };
    const tSrc =
      rawThoughtCfg && typeof rawThoughtCfg === 'object' && rawThoughtCfg.config && typeof rawThoughtCfg.config === 'object'
        ? rawThoughtCfg.config
        : rawThoughtCfg;
    if (tSrc && typeof tSrc === 'object' && !Array.isArray(tSrc) && typeof tSrc.then !== 'function' && tSrc.ok !== false) {
      out.thought = {
        stylePreset: normThoughtStyle(tSrc.stylePreset) || 'technical',
        customPrompt: typeof tSrc.customPrompt === 'string' ? redactSecrets(tSrc.customPrompt.slice(0, 4000)) : '',
        activeProfileId: typeof tSrc.activeProfileId === 'string' ? tSrc.activeProfileId.slice(0, 64) : '',
        profiles: Array.isArray(tSrc.profiles)
          ? tSrc.profiles
              .filter((p) => p && typeof p === 'object' && !Array.isArray(p))
              .slice(0, 16)
              .map((p, i) => ({
                id: String(p.id || `p-${i + 1}`).slice(0, 64),
                name: redactSecrets(String(p.name || '').slice(0, 80)),
                baseUrl: redactSecrets(String(p.baseUrl || '').slice(0, 260)),
                model: redactSecrets(String(p.model || '').slice(0, 120)),
              }))
          : [],
      };
    }
    return out;
  }

  function validateImportedConfigJson(rawInput) {
    let parsed = rawInput;
    if (typeof rawInput === 'string') {
      if (rawInput.length > 131072) return { ok: false, error: 'payload-too-large' };
      try {
        parsed = JSON.parse(rawInput);
      } catch {
        return { ok: false, error: 'invalid-json' };
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'invalid-root' };
    const src = parsed.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings) ? parsed.settings : parsed;
    const cleanPatch = {};
    for (const k of Object.keys(src)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype' || /apikey|secret|token|password/i.test(k)) continue;
      const c = sanitizeKeyVal(k, src[k]);
      if (c.valid) cleanPatch[k] = c.value;
    }
    let cleanThought = null;
    if (parsed.thought && typeof parsed.thought === 'object' && !Array.isArray(parsed.thought)) {
      const t = parsed.thought;
      const stylePreset = normThoughtStyle(t.stylePreset) || undefined;
      const customPrompt = typeof t.customPrompt === 'string' ? redactSecrets(t.customPrompt.slice(0, 4000)) : undefined;
      const profiles = Array.isArray(t.profiles)
        ? t.profiles
            .filter((p) => p && typeof p === 'object' && !Array.isArray(p))
            .slice(0, 16)
            .map((p, i) => ({
              id: String(p.id || `p-${i + 1}`).slice(0, 64),
              name: redactSecrets(String(p.name || '').slice(0, 80)),
              baseUrl: /^https?:\/\//i.test(String(p.baseUrl || '').trim()) ? redactSecrets(String(p.baseUrl).trim().slice(0, 260)) : '',
              model: redactSecrets(String(p.model || '').slice(0, 120)),
              apiKey: '',
              keepExistingKey: true,
            }))
        : undefined;
      if (stylePreset !== undefined || customPrompt !== undefined || (profiles && profiles.length > 0)) {
        cleanThought = {
          ...(stylePreset !== undefined ? { stylePreset } : {}),
          ...(customPrompt !== undefined ? { customPrompt } : {}),
          ...(typeof t.activeProfileId === 'string' ? { activeProfileId: t.activeProfileId.slice(0, 64) } : {}),
          ...(profiles ? { profiles } : {}),
          keepExistingKey: true,
        };
      }
    }
    return Object.keys(cleanPatch).length === 0 && !cleanThought ? { ok: false, error: 'no-valid-keys' } : { ok: true, settings: cleanPatch, thought: cleanThought };
  }

  const UPSTREAM_CREDITS = [
    { repo: '0DNANCY/agy-claude-style', url: 'https://github.com/0DNANCY/agy-claude-style', meta: 'MIT · 0DNANCY' },
    { repo: 'ATtacK030130/antigrative-dashboard', url: 'https://github.com/ATtacK030130/antigrative-dashboard', meta: 'MIT · AG Pulse' },
    { repo: 'LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider', url: 'https://github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider', meta: 'MIT · 月上寒' },
    { repo: 'Nwflower/dsh-claude-style', url: 'https://github.com/Nwflower/dsh-claude-style', meta: 'Inspiration' },
    { repo: 'Microqian2th/dsh-codex-effort-slider', url: 'https://github.com/Microqian2th/dsh-codex-effort-slider', meta: 'Upstream' },
    { repo: 'mobius/dsh-performance-slider', url: 'https://github.com/mobius/dsh-performance-slider', meta: 'Upstream' },
    { repo: 'claudenoshujin/claude-web', url: 'https://github.com/claudenoshujin/claude-web', meta: 'Mascot Pile & Micro-Ecology Interaction Inspiration' },
  ];

  const LICENSE_SUMMARY_TEXT = [
    'GNU General Public License v3.0 (GPL-3.0-only)',
    'Copyright (C) 2026 RMvdesi (https://github.com/RMvdesi/obsidian-prism)',
    '',
    'Obsidian Prism is free and open-source software licensed under GPL-3.0.',
    'Per GPL-3.0 Sections 4–7 and NOTICE, any modified version, fork, or derivative',
    'distribution MUST:',
    '  1. Remain open-source as a whole under GPL-3.0 with complete source code;',
    '  2. Preserve RMvdesi / Obsidian Prism copyright, NOTICE, and UI credits;',
    '  3. Clearly mark modifications and not misrepresent derived builds as official.',
    '',
    'Preserved Upstream Component Notices (MIT License — GPL-3.0 Compatible):',
    '  - Copyright (c) 2026 0DNANCY (agy-claude-style)',
    '  - Copyright (c) 2026 AG Pulse contributors (antigrative-dashboard)',
    '  - Copyright (c) 2026 月上寒 / LLYSH-HANNARI (antigravity-Codex-Claude-effort-slider)',
    '',
    'See LICENSE, NOTICE, CITATION.cff, and THIRD_PARTY_NOTICES.md in the repository.',
  ].join('\n');

  let pendingCfgToast = null;

  function invokePrismRepoAction(action, versionStr, extra) {
    const allowed = ['pull', 'storage-health', 'prepare-archive', 'uninstall', 'update-status', 'check-update', 'apply-update'];
    const act = allowed.includes(action) ? action : 'status';
    const win = typeof window !== 'undefined' ? window : G;
    try {
      const bridge = win?.__agPrismRepoBridge;
      const arg = extra && typeof extra === 'object' ? { ...extra, action: act } : { action: act };
      if (typeof bridge === 'function') return Promise.resolve(bridge(arg));
      if (bridge && typeof bridge[act] === 'function') return Promise.resolve(bridge[act](extra));
      if (bridge && typeof bridge.call === 'function') return Promise.resolve(bridge.call(arg));
    } catch (err) {
      return Promise.resolve({ ok: false, action: act, error: String(err?.message || err) });
    }
    return Promise.resolve({ ok: false, offline: true, action: act, noRemote: true, hasRemote: false, branch: 'local', shortHash: versionStr });
  }

  const readStore = (k) => {
    try { return typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem(k) || '' : ''; } catch { return ''; }
  };
  const writeStore = (k, v) => {
    try { if (typeof localStorage !== 'undefined' && localStorage) localStorage.setItem(k, v); } catch {}
  };

  function renderObsidianPrismBrandSvg(size = 20) {
    try {
      const ext = G.__agPrismBrandLogoSvg || (typeof window !== 'undefined' && window.__agPrismBrandLogoSvg);
      const out = typeof ext === 'function' ? ext(size) : ext;
      if (typeof out === 'string' && out.includes('<svg')) return out;
    } catch {}
    return '';
  }

  function mascotLabels(lang, ui) {
    if (lang === 'zh-TW' || lang === 'yue') return ['雙寵', '雙寵+三蟹', ui.offLabel || '關閉'];
    if (lang === 'ja') return ['ペア', 'ペア+ミニ蟹', ui.offLabel || 'オフ'];
    if (lang === 'en') return ['Dual', 'Dual+Crabs', ui.offLabel || 'Off'];
    return ['双宠', '双宠+三蟹', ui.offLabel || '关闭'];
  }

  function mountOrSyncSettingsSection(ctx) {
    const {
      version,
      getLang,
      uiText,
      isZh,
      i18nCore,
      formatSettingsSummary,
      resolveSettingRowActiveValue,
      isSettingButtonMatch,
      saveSetting,
      saveSettingsBatch,
      getThoughtTranslateMode,
      handledGroupClicks,
      runSettingsGroupGlide,
      runGuardedMut,
    } = ctx;

    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return;
    const lang = getLang();
    const ui = uiText(lang);
    const targetTitles = ['Appearance', '外观', '外觀', '外観'];
    let panel = null;
    for (const h2 of doc.querySelectorAll('[role="dialog"] h2')) {
      if (targetTitles.includes((h2.textContent || '').trim())) {
        panel = h2.closest('div.p-6') || h2.parentElement?.parentElement;
        if (panel) break;
      }
    }
    if (!panel) return;

    const effVal = (k, l) => {
      const v = typeof resolveSettingRowActiveValue === 'function' ? resolveSettingRowActiveValue(k, l) : undefined;
      return v !== undefined && v !== null && v !== '' ? v : PRISM_SETTINGS_SCHEMA[k]?.default;
    };
    const matchBtn = (k, valJson, cur) => {
      if (typeof isSettingButtonMatch === 'function') {
        const r = isSettingButtonMatch(k, valJson, cur);
        if (r === true) return true;
        if (cur !== undefined && cur !== null) return false;
      }
      try { return JSON.parse(valJson) === cur; } catch { return String(valJson) === String(cur); }
    };
    const applyBatch = (patch) => {
      if (!patch || typeof patch !== 'object') return;
      if (typeof saveSettingsBatch === 'function') saveSettingsBatch(patch);
      else if (typeof saveSetting === 'function') for (const [k, v] of Object.entries(patch)) saveSetting(k, v);
    };
    const syncRootState = (rootEl, l, u) => {
      rootEl.querySelectorAll('button[data-ag-cs-key]').forEach((btn) => {
        const k = btn.getAttribute('data-ag-cs-key');
        const on = matchBtn(k, btn.getAttribute('data-ag-cs-val'), effVal(k, l));
        if (btn.getAttribute('aria-pressed') !== String(on)) {
          btn.setAttribute('aria-pressed', String(on));
          btn.toggleAttribute('data-pressed', on);
        }
      });
      rootEl.querySelectorAll('button[data-ag-cs-preset]').forEach((pBtn) => {
        const spec = SCENE_PRESETS[pBtn.getAttribute('data-ag-cs-preset')];
        if (!spec) return;
        const m = Object.entries(spec).every(([k, ex]) => effVal(k, l) === ex);
        pBtn.setAttribute('data-active', m ? '1' : '0');
        pBtn.setAttribute('aria-pressed', String(m));
      });
      const th = rootEl.__prismThoughtUiHandle;
      if (th?.onViewSwitched) th.onViewSwitched(effVal('thoughtView', l));
      const tb = rootEl.querySelector('[data-testid="prism-thought-ai-config"]');
      if (tb) tb.hidden = getThoughtTranslateMode() !== 'ai';
      const ltRow = rootEl.querySelector('[data-ag-cs-row="linkTarget"]');
      if (ltRow && ltRow.style) ltRow.style.opacity = effVal('omniModule', l) === 'off' ? '0.55' : '';
      const lpDescEl = rootEl.querySelector('[data-ag-cs-row="lightPreset"] [data-k="d"]');
      if (lpDescEl) {
        const de = doc.documentElement;
        const themeAttr = de?.getAttribute?.('data-ag-cs-theme');
        const isLightTheme =
          themeAttr === 'light' ||
          (!themeAttr && (Boolean(de?.classList?.contains?.('light')) || Boolean(doc.body?.classList?.contains?.('light'))));
        const curPal = effVal('palette', l);
        let lpText = u.setLightPresetDesc || '';
        if (!isLightTheme && u.lightPresetHintDark) lpText = u.lightPresetHintDark;
        else if (isLightTheme && curPal === 'warm' && u.lightPresetHintWarm) lpText = u.lightPresetHintWarm;
        else if (isLightTheme && curPal === 'host' && u.lightPresetHintHost) lpText = u.lightPresetHintHost;
        if (lpDescEl.textContent !== lpText) lpDescEl.textContent = lpText;
      }
      const sumEl = rootEl.querySelector('[data-ag-cs-fold-summary]');
      if (sumEl) {
        const ns = formatSettingsSummary(l, u);
        if (sumEl.textContent !== ns) sumEl.textContent = ns;
      }
    };

    runGuardedMut(() => {
      try {
        if (doc.head && typeof doc.getElementById === 'function' && !doc.getElementById(SETTINGS_STYLE_ID)) {
          const stEl = doc.createElement('style');
          stEl.id = SETTINGS_STYLE_ID;
          stEl.textContent = SETTINGS_EXTRA_CSS;
          doc.head.appendChild(stEl);
        }
      } catch {}

      const existing = doc.getElementById(SETTINGS_SEC_ID);
      if (existing) {
        if (panel.querySelector('#' + SETTINGS_SEC_ID) === existing && existing.getAttribute('data-ag-cs-lang') === lang) {
          syncRootState(existing, lang, ui);
          return;
        }
        existing.remove();
      }

      const sections = Array.from(panel.querySelectorAll('div.space-y-2')).filter(
        (s) => !s.id.startsWith('ag-cs-') && !(s.parentElement && s.parentElement.closest('div.space-y-2'))
      );
      const anchor = sections[sections.length - 1];
      if (!anchor || !anchor.parentElement) return;

      const BTN =
        'ag-cs-seg-btn inline-flex items-center justify-center transition-colors text-secondary-foreground outline-none cursor-pointer border-none shrink-0 select-none h-full hover:text-foreground data-[pressed]:bg-secondary data-[pressed]:text-foreground text-sm px-2 rounded-md gap-1.5';

      const initOpen = ['1', 'true'].includes(readStore(STORAGE_SETTINGS_OPEN_KEY));
      const savedTab = readStore(STORAGE_SETTINGS_SUBTAB_KEY);
      let activeSubTab = ['all', 'appearance', 'interaction', 'thought', 'modules', 'beta', 'about'].includes(savedTab) ? savedTab : 'all';

      const sec = doc.createElement('div');
      sec.id = SETTINGS_SEC_ID;
      sec.className = initOpen ? 'space-y-2 is-open' : 'space-y-2';
      sec.setAttribute('data-ag-no-i18n', '');
      sec.setAttribute('data-ag-cs-lang', lang);
      sec.setAttribute('data-open', initOpen ? '1' : '0');
      sec.setAttribute('data-ag-cs-open', initOpen ? '1' : '0');

      const langOpts = (
        i18nCore?.LANG_OPTIONS || [
          { id: 'zh-CN', label: '简体中文' },
          { id: 'zh-TW', label: '繁體中文' },
          { id: 'yue', label: '粵語' },
          { id: 'en', label: 'English' },
          { id: 'ja', label: '日本語' },
        ]
      ).map((o) => [o.id, o.label]);

      const [mDual, mMinis, mOff] = mascotLabels(lang, ui);
      const U = (k, d = '') => ui[k] || d;
      const onOff = [[true, U('onLabel', 'On')], [false, U('offLabel', 'Off')]];
      const autoOnOff = [['auto', U('optAutoCoexist', 'Auto')], ['on', U('onLabel', 'On')], ['off', U('offLabel', 'Off')]];
      const onOffStr = autoOnOff.slice(1);
      const warmLbl = ui.optWarm || (ui.optClaude && !/claude/i.test(ui.optClaude) ? ui.optClaude : '') || 'Alabaster';
      const R = (key, tk, dk, opts) => ({ key, title: U(tk, key), desc: U(dk), opts });

      const rowDefs = {
        palette: R('palette', 'setPaletteTitle', 'setPaletteDesc', [['host', U('optHost')], ['warm', warmLbl], ['obsidian', U('optObsidian')]]),
        lightPreset: R('lightPreset', 'setLightPresetTitle', 'setLightPresetDesc', [['crystal', U('optLightCrystal')], ['alabaster', U('optLightAlabaster')]]),
        accentTone: R('accentTone', 'setAccentToneTitle', 'setAccentToneDesc', [['follow', U('optToneFollow')], ['cobalt', U('optToneCobalt')], ['iris', U('optToneIris')], ['amber', U('optToneAmber')], ['mono', U('optToneMono')]]),
        cornerStyle: R('cornerStyle', 'setCornerStyleTitle', 'setCornerStyleDesc', [['sharp', U('optCornerSharp')], ['balanced', U('optCornerBalanced')], ['soft', U('optCornerSoft')]]),
        ambientIntensity: R('ambientIntensity', 'setAmbientIntensityTitle', 'setAmbientIntensityDesc', [['0', U('optAmb0', '0%')], ['35', U('optAmb35', '35%')], ['70', U('optAmb70', '70%')], ['100', U('optAmb100', '100%')]]),
        motionLevel: R('motionLevel', 'setMotionLevelTitle', 'setMotionLevelDesc', [['off', U('optMotionOff')], ['subtle', U('optMotionSubtle')], ['standard', U('optMotionStandard')], ['ultra', U('optMotionUltra')]]),
        targetFps: R('targetFps', 'setTargetFpsTitle', 'setTargetFpsDesc', [['60', U('optFps60', '60')], ['120', U('optFps120', '120')], ['180', U('optFps180', '180')], ['native', U('optFpsNative')]]),
        homeLayout: R('homeLayout', 'setHomeLayoutTitle', 'setHomeLayoutDesc', [['studio', U('optStudio')], ['classic', U('optClassic')], ['off', U('optNativeOff')]]),
        homeRipple: R('homeRipple', 'setRippleTitle', 'setRippleDesc', onOff),
        logoInk: R('logoInk', 'setLogoInkTitle', 'setLogoInkDesc', [['accent', U('optAccent')], ['foreground', U('optForeground')]]),
        language: R('language', 'setLanguageTitle', 'setLanguageDesc', langOpts),
        composerRestyle: R('composerRestyle', 'setComposerTitle', 'setComposerDesc', onOff),
        placeholderStyle: R('placeholderStyle', 'setPlaceholderTitle', 'setPlaceholderDesc', [['studio', 'Studio'], ['host', U('optPlaceholderHost')]]),
        smoothCaret: R('smoothCaret', 'setSmoothCaretTitle', 'setSmoothCaretDesc', onOff),
        codeFont: R('codeFont', 'setCodeFontTitle', 'setCodeFontDesc', [['default', U('optFontDefault')], ['jetbrains', 'JetBrains Mono'], ['cascadia', 'Cascadia Code'], ['sfmono', U('optFontSfmono', 'SF Mono')]]),
        codeLigatures: R('codeLigatures', 'setCodeLigaturesTitle', 'setCodeLigaturesDesc', onOff),
        mascot: R('mascot', 'setMascotTitle', 'setMascotDesc', [['crab', mDual], ['minis', mMinis], ['off', mOff]]),
        sidebarRestyle: R('sidebarRestyle', 'setSidebarTitle', 'setSidebarDesc', onOff),
        sidebarCompact: R('sidebarCompact', 'setSidebarCompactTitle', 'setSidebarCompactDesc', onOff),
        thoughtTranslate: R('thoughtTranslate', 'setThoughtModeTitle', 'setThoughtModeDesc', [['off', U('optThoughtOff')], ['machine', U('optThoughtMachine')], ['ai', U('optThoughtAi')]]),
        thoughtTrigger: R('thoughtTrigger', 'setThoughtTriggerTitle', 'setThoughtTriggerDesc', [['preload', U('optTriggerPreload')], ['expand', U('optTriggerExpand')]]),
        thoughtView: R('thoughtView', 'setThoughtViewTitle', 'setThoughtViewDesc', [['immersive', U('optThoughtImmersive')], ['bilingual', U('optThoughtBilingual')]]),
        telemetryModule: R('telemetryModule', 'setTelemetryTitle', 'setTelemetryDesc', autoOnOff),
        effortSliderModule: R('effortSliderModule', 'setEffortSliderTitle', 'setEffortSliderDesc', autoOnOff),
        omniModule: R('omniModule', 'setOmniTitle', 'setOmniDesc', onOffStr),
        linkTarget: R('linkTarget', 'setLinkTargetTitle', 'setLinkTargetDesc', [['builtin', U('optLinkBuiltin')], ['external', U('optLinkExternal')]]),
        sidebarStudio: R('sidebarStudio', 'setSidebarStudioTitle', 'setSidebarStudioDesc', onOffStr),
        autoUpdate: R('autoUpdate', 'setAutoUpdateTitle', 'setAutoUpdateDesc', onOffStr),
      };

      const groups = [
        { id: 'appearance', title: U('grpAppearance'), keys: ['palette', 'lightPreset', 'accentTone', 'cornerStyle', 'ambientIntensity', 'motionLevel', 'targetFps', 'homeLayout', 'homeRipple', 'logoInk', 'language'] },
        { id: 'interaction', title: U('grpInteraction'), keys: ['composerRestyle', 'placeholderStyle', 'smoothCaret', 'codeFont', 'codeLigatures', 'mascot', 'sidebarRestyle', 'sidebarCompact'] },
        { id: 'thought', title: U('grpThought'), keys: ['thoughtTranslate', 'thoughtTrigger', 'thoughtView'] },
        { id: 'modules', title: U('groupModules'), keys: ['telemetryModule', 'effortSliderModule', 'omniModule', 'linkTarget'] },
        { id: 'beta', title: U('grpBeta'), keys: ['sidebarStudio'] },
      ];

      const mkEl = (tag, cls, txt) => {
        const el = doc.createElement(tag);
        if (cls) el.className = cls;
        if (txt !== undefined) el.textContent = txt;
        return el;
      };
      const setVis = (el, on) => {
        el.hidden = !on;
        if (on) el.removeAttribute('hidden');
        else el.setAttribute('hidden', '');
      };
      const fmtTpl = (tpl, args) => String(tpl || '').replace(/\{(\d)\}/g, (_, k) => String(args[k] ?? ''));

      const foldSummaryEl = mkEl('span', 'ag-cs-settings-fold-summary', formatSettingsSummary(lang, ui));
      foldSummaryEl.setAttribute('data-ag-cs-fold-summary', '');
      let thoughtUiHandle = null;

      const buildRow = (r) => {
        const row = mkEl('div', 'w-full');
        row.setAttribute('data-ag-cs-row', r.key);
        const inner = mkEl('div', 'py-2 px-3 w-full bg-transparent flex justify-between gap-4 items-center');
        const textCol = mkEl('div', 'flex-1 flex flex-col gap-0.5');
        const titleLine = mkEl('div', 'ag-cs-settings-title-line');
        const tSpan = mkEl('span', 'text-sm', r.title);
        tSpan.setAttribute('data-k', 't');
        titleLine.appendChild(tSpan);
        const dSpan = mkEl('span', 'text-xs text-muted-foreground whitespace-pre-wrap', r.desc);
        dSpan.setAttribute('data-k', 'd');
        textCol.appendChild(titleLine);
        textCol.appendChild(dSpan);

        const ctlWrap = mkEl('div', 'shrink-0');
        const group = mkEl('div', 'ag-cs-seg-group inline-flex items-center rounded-lg border border-border bg-secondary/20 p-0.5 gap-0.5 select-none min-h-8');
        group.setAttribute('role', 'group');
        const curVal = effVal(r.key, lang);
        for (const [val, lbl] of r.opts) {
          const b = mkEl('button', BTN, lbl);
          b.type = 'button';
          const valJson = JSON.stringify(val);
          b.setAttribute('data-ag-cs-key', r.key);
          b.setAttribute('data-ag-cs-val', valJson);
          const on = matchBtn(r.key, valJson, curVal);
          b.setAttribute('aria-pressed', String(on));
          if (on) b.setAttribute('data-pressed', '');
          b.addEventListener('click', (ev) => {
            if (ev && typeof ev === 'object' && handledGroupClicks) handledGroupClicks.add(ev);
            const prevBtn = Array.from(group.children).find((s) => s.getAttribute('aria-pressed') === 'true' || s.hasAttribute('data-pressed'));
            const prevRect = prevBtn && typeof prevBtn.getBoundingClientRect === 'function' ? prevBtn.getBoundingClientRect() : null;
            for (const sib of group.children) {
              sib.setAttribute('aria-pressed', String(sib === b));
              sib.toggleAttribute('data-pressed', sib === b);
            }
            saveSetting(r.key, val);
            if (r.key === 'thoughtTranslate' && thoughtUiHandle) thoughtUiHandle.onModeSwitched(val);
            if (r.key === 'thoughtView' && thoughtUiHandle?.onViewSwitched) thoughtUiHandle.onViewSwitched(val);
            const lNow = getLang();
            syncRootState(sec, lNow, uiText(lNow));
            if (prevBtn && prevBtn !== b && typeof runSettingsGroupGlide === 'function') runSettingsGroupGlide(group, prevBtn, b, prevRect);
          });
          group.appendChild(b);
        }
        ctlWrap.appendChild(group);
        inner.appendChild(textCol);
        inner.appendChild(ctlWrap);
        row.appendChild(inner);
        return row;
      };

      const foldHead = mkEl('button', 'ag-cs-settings-fold-head');
      foldHead.type = 'button';
      foldHead.setAttribute('data-ag-cs-fold-toggle', '1');
      foldHead.setAttribute('aria-expanded', String(initOpen));
      foldHead.setAttribute('aria-label', initOpen ? ui.foldCollapseHint || 'Collapse' : ui.foldExpandHint || 'Expand');

      const foldLeft = mkEl('span', 'ag-cs-settings-fold-left');
      const brandMark = mkEl('span', 'ag-cs-settings-brand-mark inline-flex items-center shrink-0');
      brandMark.setAttribute('aria-hidden', 'true');
      brandMark.innerHTML = renderObsidianPrismBrandSvg(20);
      foldLeft.appendChild(brandMark);
      const brandTitle = ui.sectionTitle && /Obsidian Prism/i.test(ui.sectionTitle) ? ui.sectionTitle : 'Obsidian Prism';
      foldLeft.appendChild(mkEl('h3', 'm-0 text-sm font-medium', brandTitle));
      foldLeft.appendChild(mkEl('span', 'ag-cs-settings-ver', `v${version}`));
      const updBadge = mkEl('span', 'ag-cs-update-badge', '');
      updBadge.setAttribute('data-ag-cs-update-badge', '1');
      setVis(updBadge, false);
      foldLeft.appendChild(updBadge);

      const foldRight = mkEl('span', 'ag-cs-settings-fold-right');
      foldRight.appendChild(foldSummaryEl);
      const chevron = mkEl('span', 'ag-cs-settings-fold-chevron');
      chevron.setAttribute('data-ag-cs-chevron', '');
      chevron.setAttribute('aria-hidden', 'true');
      chevron.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';
      foldRight.appendChild(chevron);

      foldHead.appendChild(foldLeft);
      foldHead.appendChild(foldRight);
      sec.appendChild(foldHead);

      const foldBody = mkEl('div', initOpen ? 'ag-cs-settings-fold-body is-open' : 'ag-cs-settings-fold-body');
      foldBody.setAttribute('data-open', initOpen ? '1' : '0');
      foldBody.setAttribute('aria-hidden', String(!initOpen));

      const topDeck = mkEl('div', 'ag-cs-settings-topdeck');
      topDeck.setAttribute('data-ag-cs-topdeck', '1');
      const presetRow = mkEl('div', 'ag-cs-preset-row');
      presetRow.appendChild(mkEl('span', 'ag-cs-preset-label', ui.presetBarLabel || 'Scene Presets'));
      const presetPills = mkEl('div', 'ag-cs-preset-pills');
      for (const [pid, plbl] of [['ultra', ui.presetUltra || 'Full Optical'], ['focus', ui.presetFocus || 'Deep Focus'], ['eco', ui.presetEco || 'Silent Eco']]) {
        const pb = mkEl('button', 'ag-cs-preset-btn', plbl);
        pb.type = 'button';
        pb.setAttribute('data-ag-cs-preset', pid);
        pb.addEventListener('click', (ev) => {
          ev?.stopPropagation?.();
          applyBatch({ ...SCENE_PRESETS[pid] });
          const lNow = getLang();
          runGuardedMut(() => syncRootState(sec, lNow, uiText(lNow)));
        });
        presetPills.appendChild(pb);
      }
      presetRow.appendChild(presetPills);
      topDeck.appendChild(presetRow);

      const subTabBar = mkEl('div', 'ag-cs-subtabs');
      subTabBar.setAttribute('role', 'tablist');
      const subTabBtns = [];
      const groupElsById = new Map();
      const applySubTab = (sid) => {
        activeSubTab = sid;
        writeStore(STORAGE_SETTINGS_SUBTAB_KEY, sid);
        for (const sb of subTabBtns) sb.setAttribute('aria-selected', String(sb.getAttribute('data-ag-cs-subtab') === sid));
        for (const [gid, gel] of groupElsById.entries()) {
          const show = sid === 'all' || sid === gid;
          gel.hidden = !show;
          if (!show) gel.setAttribute('hidden', '');
          else gel.removeAttribute('hidden');
        }
      };
      for (const [sid, slbl] of [
        ['all', ui.subTabAll || 'All'],
        ['appearance', ui.subTabAppearance || 'Appearance'],
        ['interaction', ui.subTabInteraction || 'Workspace'],
        ['thought', ui.subTabThought || 'Thought'],
        ['modules', ui.subTabModules || 'Modules'],
        ['beta', ui.subTabBeta || 'Beta'],
        ['about', ui.subTabAbout || 'Config & About'],
      ]) {
        const sb = mkEl('button', 'ag-cs-subtab-btn', slbl);
        sb.type = 'button';
        sb.setAttribute('role', 'tab');
        sb.setAttribute('data-ag-cs-subtab', sid);
        sb.setAttribute('aria-selected', String(activeSubTab === sid));
        sb.addEventListener('click', (ev) => {
          ev?.stopPropagation?.();
          runGuardedMut(() => applySubTab(sid));
        });
        subTabBtns.push(sb);
        subTabBar.appendChild(sb);
      }
      topDeck.appendChild(subTabBar);
      const fileInput = mkEl('input');
      fileInput.type = 'file';
      fileInput.setAttribute('accept', '.json,application/json');
      fileInput.hidden = true;
      fileInput.setAttribute('hidden', '');
      topDeck.appendChild(fileInput);
      foldBody.appendChild(topDeck);

      const groupsWrap = mkEl('div', 'ag-cs-settings-groups');
      for (const grp of groups) {
        const grpEl = mkEl('div', 'ag-cs-settings-group');
        grpEl.setAttribute('data-ag-cs-group', grp.id);
        groupElsById.set(grp.id, grpEl);
        grpEl.appendChild(mkEl('div', 'ag-cs-settings-subhead', grp.title));
        const list = mkEl('div', 'ag-cs-settings-card bg-transparent rounded-xl border border-border overflow-hidden divide-y divide-border');
        for (const k of grp.keys) if (rowDefs[k]) list.appendChild(buildRow(rowDefs[k]));
        if (grp.id === 'thought' && G.__agPrismThoughtSettingsUi?.createThoughtAiConfigBox) {
          thoughtUiHandle = G.__agPrismThoughtSettingsUi.createThoughtAiConfigBox({ mkEl, btnClass: BTN, ui, lang, getLang, isZh, getMode: getThoughtTranslateMode, runGuardedMut });
          sec.__prismThoughtUiHandle = thoughtUiHandle;
          if (thoughtUiHandle?.box) list.appendChild(thoughtUiHandle.box);
        }
        grpEl.appendChild(list);
        groupsWrap.appendChild(grpEl);
      }

      const aboutGrp = mkEl('div', 'ag-cs-settings-group');
      aboutGrp.setAttribute('data-ag-cs-group', 'about');
      groupElsById.set('about', aboutGrp);
      aboutGrp.appendChild(mkEl('div', 'ag-cs-settings-subhead', ui.aboutGroupTitle || 'About'));

      const aboutBox = mkEl('div', 'ag-cs-about-box');
      aboutBox.setAttribute('data-ag-cs-about', '1');
      const repoRow = mkEl('div', 'ag-cs-about-repo-row');
      const repoInfo = mkEl('div', 'ag-cs-about-repo-info');
      repoInfo.appendChild(mkEl('span', 'font-medium text-foreground', `Obsidian Prism v${version}`));
      const repoChip = mkEl('span', 'ag-cs-repo-chip', ui.aboutRepoSyncTitle || 'Git');
      repoChip.setAttribute('data-ag-cs-repo-status', '');
      repoChip.setAttribute('data-status', 'idle');
      repoInfo.appendChild(repoChip);

      const syncBtn = mkEl('button', 'ag-cs-repo-sync-btn', ui.aboutRepoSyncBtn || 'Sync');
      syncBtn.type = 'button';
      syncBtn.setAttribute('data-ag-cs-repo-sync', '1');

      let repoProbedOnce = false;
      let repoSyncBusy = false;
      const applyRepoStatusView = (res, isPull) => {
        if (!repoChip.isConnected) return;
        runGuardedMut(() => {
          const branch = res?.branch || 'local';
          const hash = res?.shortHash || (res?.commit ? String(res.commit).slice(0, 7) : '');
          const ref = hash && hash !== branch ? `${branch} @ ${hash}` : branch;
          const hasRemote = Boolean(res && !res.noRemote && res.hasRemote !== false && res.remoteUrl);
          if (!hasRemote) {
            repoChip.setAttribute('data-status', 'warn');
            repoChip.textContent = `${ref} · ${ui.aboutRepoNoRemote || 'Local'}`;
          } else if (isPull && res?.updated) {
            repoChip.setAttribute('data-status', 'updated');
            repoChip.textContent = `${ref} · ${ui.aboutRepoUpdated || 'Updated'}`;
          } else if (res?.ok === false && res?.error) {
            repoChip.setAttribute('data-status', 'error');
            repoChip.textContent = `${ref} · ${res.error}`;
          } else {
            repoChip.setAttribute('data-status', 'ok');
            repoChip.textContent = `${ref} · ${ui.aboutRepoUpToDate || 'OK'}`;
          }
        });
      };
      const probeRepoStatusSilently = () => {
        if (repoProbedOnce || repoSyncBusy) return;
        repoProbedOnce = true;
        void invokePrismRepoAction('status', version).then((st) => st && applyRepoStatusView(st, false));
        probeStorageSilently();
      };
      syncBtn.addEventListener('click', (ev) => {
        ev?.stopPropagation?.();
        if (repoSyncBusy) return;
        repoSyncBusy = true;
        repoProbedOnce = true;
        runGuardedMut(() => {
          syncBtn.disabled = true;
          repoChip.setAttribute('data-status', 'idle');
          repoChip.textContent = ui.aboutRepoChecking || '...';
        });
        void invokePrismRepoAction('status', version)
          .then((st) => {
            if (!(st && !st.noRemote && st.hasRemote !== false && st.remoteUrl)) {
              applyRepoStatusView(st || { noRemote: true, branch: 'local' }, false);
              return null;
            }
            return invokePrismRepoAction('pull', version).then((p) => {
              applyRepoStatusView({ ...st, ...p }, true);
              return p;
            });
          })
          .finally(() => {
            repoSyncBusy = false;
            runGuardedMut(() => { if (syncBtn.isConnected) syncBtn.disabled = false; });
          });
      });

      repoRow.appendChild(repoInfo);
      repoRow.appendChild(syncBtn);
      aboutBox.appendChild(repoRow);

      const updRow = mkEl('div', 'ag-cs-about-repo-row');
      updRow.setAttribute('data-ag-cs-update-row', '1');
      const updInfo = mkEl('div', 'ag-cs-about-repo-info');
      const updChip = mkEl('span', 'ag-cs-repo-chip', fmtTpl(ui.updUpToDate || 'v{0}', [version]));
      updChip.setAttribute('data-ag-cs-update-status', '');
      updChip.setAttribute('data-status', 'idle');
      updInfo.appendChild(updChip);
      const updLinkSlot = mkEl('span', 'ag-cs-update-link-slot');
      updInfo.appendChild(updLinkSlot);

      const updBtns = mkEl('div', 'ag-cs-thought-btn-group');
      const checkUpdBtn = mkEl('button', 'ag-cs-repo-sync-btn', ui.updCheckBtn || 'Check Update');
      checkUpdBtn.type = 'button';
      checkUpdBtn.setAttribute('data-ag-cs-update-check', '1');
      const applyUpdBtn = mkEl('button', 'ag-cs-repo-sync-btn', ui.updApplyBtn || 'Update Now');
      applyUpdBtn.type = 'button';
      applyUpdBtn.setAttribute('data-ag-cs-update-apply', '1');
      setVis(applyUpdBtn, false);
      updBtns.appendChild(checkUpdBtn);
      updBtns.appendChild(applyUpdBtn);
      updRow.appendChild(updInfo);
      updRow.appendChild(updBtns);
      aboutBox.appendChild(updRow);

      const updNote = mkEl('p', 'ag-cs-thought-hint ag-cs-update-note', ui.updHotNote || '');
      updNote.setAttribute('data-ag-cs-update-note', '1');
      aboutBox.appendChild(updNote);

      const updCfgCard = mkEl('div', 'ag-cs-settings-card bg-transparent rounded-xl border border-border overflow-hidden divide-y divide-border');
      updCfgCard.appendChild(buildRow(rowDefs.autoUpdate));
      aboutBox.appendChild(updCfgCard);

      let updBusy = false;
      const isSafeGhUrl = (u) => typeof u === 'string' && /^https:\/\/github\.com\/RMvdesi\/obsidian-prism(?:\/|$)/i.test(u.trim());
      const applyUpdateView = (st) => {
        if (!updChip.isConnected || !st || st.offline || st.timeout) return;
        const u = uiText(getLang()) || ui;
        runGuardedMut(() => {
          updLinkSlot.textContent = '';
          if (st.applied || st.hotReloaded || st.hotReloadExpected) {
            setVis(updBadge, false);
            setVis(applyUpdBtn, false);
            updChip.setAttribute('data-status', 'updated');
            updChip.textContent = u.updHotDone || 'Updated';
            return;
          }
          if (st.hasUpdate) {
            const tv = st.latestVersion || '';
            updBadge.textContent = `v${tv}`;
            setVis(updBadge, true);
            updChip.setAttribute('data-status', 'warn');
            if (st.manualRequired) {
              updChip.textContent = fmtTpl(u.updManualHint || 'v{0}', [tv]);
              setVis(applyUpdBtn, false);
              const href = isSafeGhUrl(st.downloadUrl) ? st.downloadUrl : isSafeGhUrl(st.releaseUrl) ? st.releaseUrl : '';
              if (href) {
                const a = mkEl('a', '', `v${tv} ↗`);
                a.setAttribute('href', href);
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener noreferrer');
                a.setAttribute('data-ag-cs-update-link', '1');
                updLinkSlot.appendChild(a);
              }
            } else {
              updChip.textContent = fmtTpl(u.updAvailTpl || 'v{0}', [tv]);
              setVis(applyUpdBtn, true);
            }
            return;
          }
          setVis(updBadge, false);
          setVis(applyUpdBtn, false);
          if (st.ok === false && st.error) {
            updChip.setAttribute('data-status', 'error');
            updChip.textContent = st.error;
          } else {
            updChip.setAttribute('data-status', 'ok');
            updChip.textContent = fmtTpl(u.updUpToDate || 'v{0}', [st.currentVersion || version]);
          }
        });
      };
      const probeUpdateSilently = () => {
        void invokePrismRepoAction('update-status', version).then((st) => st && applyUpdateView(st)).catch(() => {});
      };
      checkUpdBtn.addEventListener('click', (ev) => {
        ev?.stopPropagation?.();
        if (updBusy) return;
        updBusy = true;
        runGuardedMut(() => {
          checkUpdBtn.disabled = true;
          updChip.setAttribute('data-status', 'idle');
          updChip.textContent = ui.aboutRepoChecking || '...';
        });
        void invokePrismRepoAction('check-update', version, { force: true, manual: true })
          .then((st) => st && applyUpdateView(st))
          .catch((e) => applyUpdateView({ ok: false, error: String(e?.message || e) }))
          .finally(() => {
            updBusy = false;
            runGuardedMut(() => { if (checkUpdBtn.isConnected) checkUpdBtn.disabled = false; });
          });
      });
      applyUpdBtn.addEventListener('click', (ev) => {
        ev?.stopPropagation?.();
        if (updBusy) return;
        updBusy = true;
        runGuardedMut(() => {
          applyUpdBtn.disabled = true;
          checkUpdBtn.disabled = true;
          updChip.setAttribute('data-status', 'idle');
          updChip.textContent = (uiText(getLang()) || ui).updUpdating || '...';
        });
        void invokePrismRepoAction('apply-update', version, { confirm: true })
          .then((st) => st && applyUpdateView(st))
          .catch((e) => applyUpdateView({ ok: false, error: String(e?.message || e) }))
          .finally(() => {
            updBusy = false;
            runGuardedMut(() => {
              if (applyUpdBtn.isConnected) applyUpdBtn.disabled = false;
              if (checkUpdBtn.isConnected) checkUpdBtn.disabled = false;
            });
          });
      });

      // 对话库健康度体检与一键安全归档入口（防止隐藏子代理 .db 撑爆 language_server 内存）
      const storageRow = mkEl('div', 'ag-cs-about-repo-row');
      const storageInfo = mkEl('div', 'ag-cs-about-repo-info');
      storageInfo.appendChild(mkEl('span', 'font-medium text-foreground', ui.storageHealthTitle || 'DB'));
      const storageChip = mkEl('span', 'ag-cs-repo-chip', ui.storageHealthIdle || 'DB');
      storageChip.setAttribute('data-ag-cs-storage-status', '');
      storageChip.setAttribute('data-status', 'idle');
      storageInfo.appendChild(storageChip);
      const archiveBtn = mkEl('button', 'ag-cs-repo-sync-btn', ui.storageArchiveBtn || 'Archive');
      archiveBtn.type = 'button';
      archiveBtn.setAttribute('data-ag-cs-storage-archive', '1');
      let storageBusy = false;
      const applyStorageView = (st, prepared) => {
        if (!storageChip.isConnected || !st || st.offline || st.timeout) return;
        const u = uiText(getLang()) || ui;
        runGuardedMut(() => {
          if (st.ok === false && st.error) {
            storageChip.setAttribute('data-status', 'error');
            storageChip.textContent = st.error;
            return;
          }
          const fmtMb = (v) => (Number(v) >= 1024 ? `${(Number(v) / 1024).toFixed(2)} GB` : `${Math.round(Number(v) || 0)} MB`);
          if (prepared && st.archiveScriptPath) {
            storageChip.setAttribute('data-status', 'updated');
            storageChip.textContent = fmtTpl(
              u.storageReadyTpl || '{0}/{1}:{2}',
              [st.archivableSubagentCount || 0, fmtMb(st.archivableSubagentMb), st.archiveScriptPath]
            );
            try { navigator?.clipboard?.writeText?.(st.archiveScriptPath)?.catch?.(() => {}); } catch {}
          } else {
            storageChip.setAttribute('data-status', st.warn ? 'warn' : 'ok');
            storageChip.textContent = fmtTpl(
              u.storageSummaryTpl || '{0}({1}/{2}/{3}){4}',
              [
                fmtMb(st.totalMb),
                st.mainCount || 0,
                st.subagentCount || 0,
                fmtMb(st.subagentMb),
                st.warn ? u.storageWarn || '!' : u.storageOk || 'OK',
              ]
            );
          }
        });
      };
      const probeStorageSilently = () => {
        if (storageBusy) return;
        void invokePrismRepoAction('storage-health', version)
          .then((st) => st && applyStorageView(st, false))
          .catch((err) => applyStorageView({ ok: false, error: String(err?.message || err) }, false));
      };
      archiveBtn.addEventListener('click', (ev) => {
        ev?.stopPropagation?.();
        if (storageBusy) return;
        storageBusy = true;
        runGuardedMut(() => { archiveBtn.disabled = true; });
        void invokePrismRepoAction('prepare-archive', version)
          .then((st) => st && applyStorageView(st, true))
          .catch((err) => applyStorageView({ ok: false, error: String(err?.message || err) }, false))
          .finally(() => {
            storageBusy = false;
            runGuardedMut(() => { if (archiveBtn.isConnected) archiveBtn.disabled = false; });
          });
      });
      storageRow.appendChild(storageInfo);
      storageRow.appendChild(archiveBtn);
      aboutBox.appendChild(storageRow);

      aboutBox.appendChild(mkEl('div', 'ag-cs-about-credits-title', ui.aboutCreditsTitle || 'Credits'));

      const creditsGrid = mkEl('div', 'ag-cs-about-credits');
      for (const item of UPSTREAM_CREDITS) {
        const a = mkEl('a');
        a.setAttribute('href', item.url);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        a.setAttribute('data-ag-cs-credit', item.repo);
        a.appendChild(mkEl('span', 'truncate', item.repo));
        a.appendChild(mkEl('span', 'opacity-75 text-[10px] shrink-0', `${item.meta} ↗`));
        creditsGrid.appendChild(a);
      }
      aboutBox.appendChild(creditsGrid);

      const licDetails = mkEl('details', 'ag-cs-about-license');
      licDetails.appendChild(mkEl('summary', '', ui.aboutLicenseTitle || 'GPL-3.0'));
      licDetails.appendChild(mkEl('pre', 'ag-cs-license-pre', LICENSE_SUMMARY_TEXT));
      aboutBox.appendChild(licDetails);

      const mkBtn = (txt, attr, danger) => {
        const b = mkEl('button', 'ag-cs-thought-btn', txt);
        b.type = 'button';
        b.setAttribute(attr, '1');
        if (danger) b.setAttribute('data-danger', '1');
        return b;
      };
      const uRow = mkEl('div', 'ag-cs-about-repo-row');
      const uInfo = mkEl('div', 'ag-cs-about-repo-info');
      const uChip = mkEl('span', 'ag-cs-repo-chip', '');
      setVis(uChip, false);
      uChip.setAttribute('data-ag-cs-uninstall-status', '');
      uInfo.appendChild(uChip);
      const uBtn = mkBtn(ui.uninstallBtn || 'Uninstall', 'data-ag-cs-uninstall', 1);
      uRow.appendChild(uInfo);
      uRow.appendChild(uBtn);
      aboutBox.appendChild(uRow);

      const uBox = mkEl('div', 'ag-cs-thought-cfg-box');
      setVis(uBox, false);
      uBox.setAttribute('data-ag-cs-uninstall-box', '1');
      const uLbl = mkEl('label', 'ag-cs-about-repo-info');
      const uCb = mkEl('input');
      uCb.type = 'checkbox';
      uCb.checked = false;
      uCb.setAttribute('data-ag-cs-uninstall-purge', '1');
      uLbl.appendChild(uCb);
      uLbl.appendChild(mkEl('span', '', ui.uninstallPurge || 'Purge'));
      uBox.appendChild(uLbl);
      uBox.appendChild(mkEl('p', 'ag-cs-thought-hint', ui.uninstallKeepNote || ''));
      const uAct = mkEl('div', 'ag-cs-thought-actions');
      const uBtns = mkEl('div', 'ag-cs-thought-btn-group');
      const uCancel = mkBtn(ui.uninstallCancelBtn || 'Cancel', 'data-ag-cs-uninstall-cancel');
      const uConfirm = mkBtn(ui.uninstallConfirmBtn || 'Confirm', 'data-ag-cs-uninstall-confirm', 1);
      uBtns.appendChild(uCancel);
      uBtns.appendChild(uConfirm);
      uAct.appendChild(uBtns);
      uBox.appendChild(uAct);
      aboutBox.appendChild(uBox);

      let uBusy = false;
      uBtn.addEventListener('click', (ev) => { ev?.stopPropagation?.(); runGuardedMut(() => setVis(uBox, Boolean(uBox.hidden))); });
      uCancel.addEventListener('click', (ev) => { ev?.stopPropagation?.(); runGuardedMut(() => setVis(uBox, false)); });
      uConfirm.addEventListener('click', (ev) => {
        ev?.stopPropagation?.();
        if (uBusy) return;
        uBusy = true;
        const purgeData = Boolean(uCb.checked);
        if (purgeData) clearPrismLocalStorage();
        runGuardedMut(() => { uConfirm.disabled = true; });
        void invokePrismRepoAction('uninstall', version, { confirm: true, purgeData })
          .then((r) => {
            if (!uChip.isConnected) return;
            const u = uiText(getLang()) || ui;
            runGuardedMut(() => {
              setVis(uChip, true);
              if (r && r.ok !== false && !r.offline) {
                uChip.setAttribute('data-status', 'ok');
                uChip.textContent = u.uninstallDone || 'OK';
                setVis(uBox, false);
              } else {
                uChip.setAttribute('data-status', 'error');
                uChip.textContent = r?.error || 'Err';
              }
            });
          })
          .finally(() => {
            uBusy = false;
            runGuardedMut(() => { if (uConfirm.isConnected) uConfirm.disabled = false; });
          });
      });

      aboutBox.appendChild(mkEl('p', 'ag-cs-about-disclaimer', ui.aboutDisclaimer || 'Obsidian Prism is an independent open-source project and is not affiliated with or endorsed by Google LLC.'));
      aboutGrp.appendChild(aboutBox);
      groupsWrap.appendChild(aboutGrp);
      foldBody.appendChild(groupsWrap);

      const cfgFooter = mkEl('div', 'ag-cs-cfg-footer');
      cfgFooter.setAttribute('data-ag-cs-cfg-footer', '1');
      const cfgMeta = mkEl('div', 'ag-cs-cfg-meta');
      cfgMeta.appendChild(mkEl('span', 'ag-cs-cfg-title', ui.cfgToolbarTitle || 'Config'));
      const cfgHint = mkEl('span', 'ag-cs-cfg-hint', ui.cfgToolbarHint || '');
      cfgHint.setAttribute('data-ag-cs-cfg-status', '');
      cfgMeta.appendChild(cfgHint);
      const setCfgStatus = (msg, tone = '') =>
        runGuardedMut(() => {
          cfgHint.textContent = msg;
          if (tone) cfgHint.setAttribute('data-tone', tone);
          else cfgHint.removeAttribute('data-tone');
        });
      if (pendingCfgToast && pendingCfgToast.exp > Date.now()) {
        const toastMsg = (pendingCfgToast.key && ui[pendingCfgToast.key]) || pendingCfgToast.fallback || '';
        const toastTone = pendingCfgToast.tone || 'ok';
        pendingCfgToast = null;
        if (toastMsg) setCfgStatus(toastMsg, toastTone);
      } else {
        pendingCfgToast = null;
      }

      const cfgActions = mkEl('div', 'ag-cs-cfg-actions');
      const exportBtn = mkEl('button', 'ag-cs-cfg-btn', ui.cfgExportBtn || 'Export JSON');
      exportBtn.type = 'button';
      exportBtn.setAttribute('data-ag-cs-cfg-action', 'export');
      exportBtn.addEventListener('click', async (ev) => {
        ev?.stopPropagation?.();
        const lNow = getLang(), uNow = uiText(lNow), cur = {};
        for (const k of Object.keys(PRISM_SETTINGS_SCHEMA)) cur[k] = effVal(k, lNow);
        const win = typeof window !== 'undefined' ? window : G;
        const rawThought = await Promise.resolve(win?.__agPrismThought?.getConfig?.()).catch(() => null);
        const jsonStr = JSON.stringify(buildSanitizedConfigExport(cur, rawThought || null, version), null, 2);
        try {
          if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            const url = URL.createObjectURL(new Blob([jsonStr], { type: 'application/json;charset=utf-8' }));
            const dl = mkEl('a');
            dl.href = url;
            dl.download = `obsidian-prism-settings-v${version}.json`;
            dl.click?.();
            setTimeout(() => URL.revokeObjectURL(url), 1500);
          } else win?.navigator?.clipboard?.writeText?.(jsonStr);
        } catch {
          try { win?.navigator?.clipboard?.writeText?.(jsonStr); } catch {}
        }
        setCfgStatus(uNow.cfgExportOk || 'OK', 'ok');
      });

      const handleImportRaw = (rawText) => {
        const lNow = getLang(), uNow = uiText(lNow), res = validateImportedConfigJson(rawText);
        if (!res.ok) {
          setCfgStatus(uNow.cfgImportErr || 'Invalid JSON', 'err');
          return false;
        }
        pendingCfgToast = { key: 'cfgImportOk', fallback: 'OK', tone: 'ok', exp: Date.now() + 2500 };
        if (Object.keys(res.settings).length > 0) {
          applyBatch(res.settings);
          if (res.settings.thoughtTranslate && thoughtUiHandle) thoughtUiHandle.onModeSwitched(res.settings.thoughtTranslate);
          if (res.settings.thoughtView && thoughtUiHandle?.onViewSwitched) thoughtUiHandle.onViewSwitched(res.settings.thoughtView);
        }
        if (res.thought) {
          const win = typeof window !== 'undefined' ? window : G;
          try {
            void Promise.resolve(win?.__agPrismThought?.saveConfig?.(res.thought))
              .then(() => {
                const livePanel = doc.getElementById(SETTINGS_SEC_ID);
                const liveTh = livePanel?.__prismThoughtUiHandle || thoughtUiHandle;
                liveTh?.reloadConfig?.();
                liveTh?.ensureLoaded?.(true);
              })
              .catch(() => {});
          } catch {}
          thoughtUiHandle?.reloadConfig?.();
        }
        const rl = getLang(), ru = uiText(rl);
        if (sec.isConnected) {
          pendingCfgToast = null;
          runGuardedMut(() => syncRootState(sec, rl, ru));
          setCfgStatus(ru.cfgImportOk || 'OK', 'ok');
        }
        return true;
      };
      fileInput.addEventListener('change', () => {
        const f = fileInput.files?.[0];
        if (!f) return;
        if (typeof f.text === 'function') void f.text().then(handleImportRaw).catch(() => handleImportRaw(''));
        else if (typeof FileReader === 'function') {
          const rd = new FileReader();
          rd.onload = () => handleImportRaw(String(rd.result || ''));
          rd.readAsText(f);
        }
        fileInput.value = '';
      });

      const importBtn = mkEl('button', 'ag-cs-cfg-btn', ui.cfgImportBtn || 'Import JSON');
      importBtn.type = 'button';
      importBtn.setAttribute('data-ag-cs-cfg-action', 'import');
      importBtn.addEventListener('click', (ev) => { ev?.stopPropagation?.(); fileInput.click?.(); });

      const resetBtn = mkEl('button', 'ag-cs-cfg-btn', ui.cfgResetBtn || 'Reset Defaults');
      resetBtn.type = 'button';
      resetBtn.setAttribute('data-ag-cs-cfg-action', 'reset');
      resetBtn.addEventListener('click', (ev) => {
        ev?.stopPropagation?.();
        const defs = getDefaultSettingsPatch();
        pendingCfgToast = { key: 'cfgResetOk', fallback: 'OK', tone: 'ok', exp: Date.now() + 2500 };
        applyBatch(defs);
        if (thoughtUiHandle) thoughtUiHandle.onModeSwitched(defs.thoughtTranslate);
        if (thoughtUiHandle?.onViewSwitched) thoughtUiHandle.onViewSwitched(defs.thoughtView);
        const rl = getLang(), ru = uiText(rl);
        if (sec.isConnected) {
          pendingCfgToast = null;
          runGuardedMut(() => syncRootState(sec, rl, ru));
          setCfgStatus(ru.cfgResetOk || 'OK', 'ok');
        }
      });

      cfgActions.appendChild(exportBtn);
      cfgActions.appendChild(importBtn);
      cfgActions.appendChild(resetBtn);
      cfgFooter.appendChild(cfgMeta);
      cfgFooter.appendChild(cfgActions);
      foldBody.appendChild(cfgFooter);

      sec.appendChild(foldBody);
      applySubTab(activeSubTab);
      syncRootState(sec, lang, ui);

      foldHead.addEventListener('click', (ev) => {
        ev?.preventDefault?.();
        const nextOpen = sec.getAttribute('data-open') !== '1';
        writeStore(STORAGE_SETTINGS_OPEN_KEY, nextOpen ? '1' : '0');
        runGuardedMut(() => {
          sec.setAttribute('data-open', nextOpen ? '1' : '0');
          sec.setAttribute('data-ag-cs-open', nextOpen ? '1' : '0');
          if (nextOpen) sec.classList?.add?.('is-open');
          else sec.classList?.remove?.('is-open');
          foldHead.setAttribute('aria-expanded', String(nextOpen));
          foldHead.setAttribute('aria-label', nextOpen ? ui.foldCollapseHint || 'Collapse' : ui.foldExpandHint || 'Expand');
          foldBody.setAttribute('data-open', nextOpen ? '1' : '0');
          foldBody.setAttribute('aria-hidden', String(!nextOpen));
          if (nextOpen) foldBody.classList?.add?.('is-open');
          else foldBody.classList?.remove?.('is-open');
        });
        if (nextOpen) probeRepoStatusSilently();
      });

      anchor.parentElement.appendChild(sec);
      probeUpdateSilently();
      if (initOpen) probeRepoStatusSilently();
    });
  }

  const exportedApi = {
    SETTINGS_SEC_ID,
    PRISM_SETTINGS_SCHEMA,
    PRISM_STORAGE_KEYS,
    SCENE_PRESETS,
    UPSTREAM_CREDITS,
    getDefaultSettingsPatch,
    buildSanitizedConfigExport,
    validateImportedConfigJson,
    clearPrismLocalStorage,
    mountOrSyncSettingsSection,
  };
  if (typeof module === 'object' && module.exports) module.exports = exportedApi;
  G.__agPrismSettingsPanel = exportedApi;
})(typeof globalThis !== 'undefined' ? globalThis : window);
