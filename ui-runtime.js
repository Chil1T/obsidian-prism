(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.__agCsUiMain = factory;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (initialConfig) {
  const VERSION = '1.0.0';
  const LEGACY_API_VERSION = 3;
  const CODE_HASH = initialConfig?.codeHash || '';

  if (window.__agTokenHud) {
    try {
      window.__agTokenHud.destroy();
    } catch {}
    delete window.__agTokenHud;
  }
  document
    .querySelectorAll(
      '#ag-token-hud-style, .ag-th-top-bar, .ag-th-bottom-bar, .ag-th-rim-progress, .ag-th-footer-chip, .ag-th-popover, .ag-th-turn-bar, .ag-th-reopen-pill, .ag-cs-turn-bar, .ag-cs-effort-popover, .ag-cs-ctx-popover, .ag-cs-perf-backdrop, .ag-cs-inline-stats, .ag-cs-context-ring, .ag-cs-hud-top-bar, .ag-cs-hud-bottom-bar, .ag-cs-hud-rim-progress, .ag-cs-hud-footer-chip'
    )
    .forEach((n) => n.remove());

  const existingRuntime = window.__agPrism || window.__agClaudeStyle;
  if (
    existingRuntime &&
    existingRuntime.version === VERSION &&
    (!CODE_HASH || existingRuntime.codeHash === CODE_HASH)
  ) {
    existingRuntime.refreshConfig(initialConfig);
    return;
  }
  if (Array.isArray(globalThis.__agCsCleanups)) {
    while (globalThis.__agCsCleanups.length) {
      const fn = globalThis.__agCsCleanups.pop();
      try {
        if (typeof fn === 'function') fn();
      } catch {}
    }
  }
  if (window.__agPrism && typeof window.__agPrism.destroy === 'function') {
    try {
      window.__agPrism.destroy();
    } catch {}
  }
  if (window.__agClaudeStyle && window.__agClaudeStyle !== window.__agPrism && typeof window.__agClaudeStyle.destroy === 'function') {
    try {
      window.__agClaudeStyle.destroy();
    } catch {}
  }
  delete window.__agPrism;
  delete window.__agClaudeStyle;

  if (window.__agCsI18n && typeof window.__agCsI18n.destroy === 'function') {
    try {
      window.__agCsI18n.destroy();
    } catch {}
    delete window.__agCsI18n;
  }

  const usageCore = globalThis.__agCsUsageCore;
  const rippleCore = globalThis.__agCsRippleCore;
  const i18nCore = globalThis.__agCsI18nCore;
  const i18nLocales = globalThis.__agCsLocales;
  const dualMascotRig = globalThis.__agDualMascotRig;
  const crystalPrismCore = globalThis.__agCrystalPrismCore;
  const motionEngine = globalThis.__agMotionEngine;
  const animatedIcons = globalThis.__agAnimatedIcons;
  const pulseVialBridgeMod = globalThis.__agCsPulseVialBridge;
  const convAuraMod = globalThis.__agPrismConvAura;
  const smoothCaretMod = globalThis.__agPrismSmoothCaret;
  const settingsPanelMod = globalThis.__agPrismSettingsPanel;

  // 新品牌 Obsidian Prism 主存储键 + 旧版历史键平滑迁移兼容
  const STORAGE_PRISM_KEY = 'ag-prism:config';
  const STORAGE_SETTINGS_OPEN_KEY = 'ag-prism:settings-open';
  const STORAGE_LEGACY_COLON_KEY = 'ag-claude-style:config';
  const STORAGE_LEGACY_V3_KEY = 'agClaudeStyle.settings.v3';
  const STORAGE_FILE_CFG_KEY = 'ag-prism:lastFileConfig';
  const STORAGE_USAGE_CACHE_KEY = 'ag-prism:trajRollup.v1';
  const SETTINGS_SEC_ID = 'ag-cs-settings-sec';

  const BRAND_PATHS = {
    gemini:
      'M24 12.024c-6.437.388-11.59 5.539-11.977 11.976h-.047C11.588 17.563 6.436 12.412 0 12.024v-.047C6.437 11.588 11.588 6.437 11.976 0h.047c.388 6.437 5.54 11.588 11.977 11.977z',
    claude:
      'm4.714 15.956l4.718-2.648l.079-.23l-.08-.128h-.23l-.79-.048l-2.695-.073l-2.337-.097l-2.265-.122l-.57-.121l-.535-.704l.055-.353l.48-.321l.685.06l1.518.104l2.277.157l1.651.098l2.447.255h.389l.054-.158l-.133-.097l-.103-.098l-2.356-1.596l-2.55-1.688l-1.336-.972l-.722-.491L2 6.223l-.158-1.008l.656-.722l.88.06l.224.061l.893.686l1.906 1.476l2.49 1.833l.364.304l.146-.104l.018-.072l-.164-.274l-1.354-2.446l-1.445-2.49l-.644-1.032l-.17-.619a3 3 0 0 1-.103-.729L6.287.133L6.7 0l.995.134l.42.364l.619 1.415L9.735 4.14l1.555 3.03l.455.898l.243.832l.09.255h.159V9.01l.127-1.706l.237-2.095l.23-2.695l.08-.76l.376-.91l.747-.492l.583.28l.48.685l-.067.444l-.286 1.851l-.558 2.903l-.365 1.942h.213l.243-.242l.983-1.306l1.652-2.064l.728-.82l.85-.904l.547-.431h1.032l.759 1.129l-.34 1.166l-1.063 1.347l-.88 1.142l-1.263 1.7l-.79 1.36l.074.11l.188-.02l2.853-.606l1.542-.28l1.84-.315l.832.388l.09.395l-.327.807l-1.967.486l-2.307.462l-3.436.813l-.043.03l.049.061l1.548.146l.662.036h1.62l3.018.225l.79.522l.473.638l-.08.485l-1.213.62l-1.64-.389l-3.825-.91l-1.31-.329h-.183v.11l1.093 1.068l2.003 1.81l2.508 2.33l.127.578l-.321.455l-.34-.049l-2.204-1.657l-.85-.747l-1.925-1.62h-.127v.17l.443.649l2.343 3.521l.122 1.08l-.17.353l-.607.213l-.668-.122l-1.372-1.924l-1.415-2.168l-1.141-1.943l-.14.08l-.674 7.254l-.316.37l-.728.28l-.607-.461l-.322-.747l.322-1.476l.388-1.924l.316-1.53l.285-1.9l.17-.632l-.012-.042l-.14.018l-1.432 1.967l-2.18 2.945l-1.724 1.845l-.413.164l-.716-.37l.066-.662l.401-.589l2.386-3.036l1.439-1.882l.929-1.086l-.006-.158h-.055L4.138 18.56l-1.13.146l-.485-.456l.06-.746l.231-.243l1.907-1.312Z',
    openai:
      'M20.562 10.188c.25-.688.313-1.376.25-2.063c-.062-.687-.312-1.375-.625-2c-.562-.937-1.375-1.687-2.312-2.125c-1-.437-2.063-.562-3.125-.312c-.5-.5-1.063-.938-1.688-1.25S11.687 2 11 2a5.17 5.17 0 0 0-3 .938c-.875.624-1.5 1.5-1.813 2.5c-.75.187-1.375.5-2 .875c-.562.437-1 1-1.375 1.562c-.562.938-.75 2-.625 3.063a5.44 5.44 0 0 0 1.25 2.874a4.7 4.7 0 0 0-.25 2.063c.063.688.313 1.375.625 2c.563.938 1.375 1.688 2.313 2.125c1 .438 2.062.563 3.125.313c.5.5 1.062.937 1.687 1.25S12.312 22 13 22a5.17 5.17 0 0 0 3-.937c.875-.625 1.5-1.5 1.812-2.5a4.54 4.54 0 0 0 1.938-.875c.562-.438 1.062-.938 1.375-1.563c.562-.937.75-2 .625-3.062c-.125-1.063-.5-2.063-1.188-2.876m-7.5 10.5c-1 0-1.75-.313-2.437-.875c0 0 .062-.063.125-.063l4-2.312a.5.5 0 0 0 .25-.25a.57.57 0 0 0 .062-.313V11.25l1.688 1v4.625a3.685 3.685 0 0 1-3.688 3.813M5 17.25c-.438-.75-.625-1.625-.438-2.5c0 0 .063.063.125.063l4 2.312a.56.56 0 0 0 .313.063c.125 0 .25 0 .312-.063l4.875-2.812v1.937l-4.062 2.375A3.7 3.7 0 0 1 7.312 19c-1-.25-1.812-.875-2.312-1.75M3.937 8.563a3.8 3.8 0 0 1 1.938-1.626v4.751c0 .124 0 .25.062.312a.5.5 0 0 0 .25.25l4.875 2.813l-1.687 1l-4-2.313a3.7 3.7 0 0 1-1.75-2.25c-.25-.937-.188-2.062.312-2.937M17.75 11.75l-4.875-2.812l1.687-1l4 2.312c.625.375 1.125.875 1.438 1.5s.5 1.313.437 2.063a3.7 3.7 0 0 1-.75 1.937c-.437.563-1 1-1.687 1.25v-4.75c0-.125 0-.25-.063-.312c0 0-.062-.126-.187-.188m1.687-2.5s-.062-.062-.125-.062l-4-2.313c-.125-.062-.187-.062-.312-.062s-.25 0-.313.062L9.812 9.688V7.75l4.063-2.375c.625-.375 1.312-.5 2.062-.5c.688 0 1.375.25 2 .688c.563.437 1.063 1 1.313 1.625s.312 1.375.187 2.062m-10.5 3.5l-1.687-1V7.063c0-.688.187-1.438.562-2C8.187 4.438 8.75 4 9.375 3.688a3.37 3.37 0 0 1 2.062-.313c.688.063 1.375.375 1.938.813c0 0-.063.062-.125.062l-4 2.313a.5.5 0 0 0-.25.25c-.063.125-.063.187-.063.312zm.875-2L12 9.5l2.187 1.25v2.5L12 14.5l-2.188-1.25z',
  };

  function isElementLike(n) {
    return Boolean(n && (n.nodeType === 1 || (n.nodeType === undefined && typeof n.tagName === 'string')));
  }

  function safeParseJsonObj(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  // 双向对齐新旧配置字段（兼容 homeLayout/homeMode、homeRipple/ripple、mascot dual/crab 等）
  function normalizeConfigShape(rawCfg) {
    const out = { ...(rawCfg || {}) };

    // palette: 'host' | 'obsidian' | 'warm' | 'claude'
    if (out.palette !== 'host' && out.palette !== 'obsidian' && out.palette !== 'warm' && out.palette !== 'claude') {
      out.palette = 'obsidian';
    }
    // lightPreset: 'crystal' | 'alabaster'
    out.lightPreset = out.lightPreset === 'alabaster' ? 'alabaster' : 'crystal';
    // motionLevel: 'off' | 'subtle' | 'standard' | 'ultra'
    if (out.motionLevel !== 'off' && out.motionLevel !== 'subtle' && out.motionLevel !== 'standard' && out.motionLevel !== 'ultra') {
      out.motionLevel = 'ultra';
    }
    // telemetryModule & effortSliderModule: 'auto' | 'on' | 'off'
    out.telemetryModule = out.telemetryModule === 'on' || out.telemetryModule === 'off' ? out.telemetryModule : 'auto';
    out.effortSliderModule = out.effortSliderModule === 'on' || out.effortSliderModule === 'off' ? out.effortSliderModule : 'auto';
    // thoughtTranslate: 'off' | 'machine' | 'ai'; thoughtTrigger: 'preload' | 'expand'
    out.thoughtTranslate =
      out.thoughtTranslate === 'machine' || out.thoughtTranslate === 'ai' ? out.thoughtTranslate : 'off';
    out.thoughtTrigger = out.thoughtTrigger === 'expand' ? 'expand' : 'preload';

    // homeLayout <-> homeMode
    const rawHome = out.homeLayout ?? out.homeMode ?? 'studio';
    const normHome = rawHome === 'classic' ? 'classic' : rawHome === 'off' ? 'off' : 'studio';
    out.homeLayout = normHome;
    out.homeMode = normHome;

    // homeRipple <-> ripple
    const rippleOn =
      out.homeRipple !== undefined
        ? out.homeRipple !== false && out.homeRipple !== 'off'
        : out.ripple !== undefined
        ? out.ripple !== 'off' && out.ripple !== false
        : true;
    out.homeRipple = rippleOn;
    out.ripple = rippleOn ? 'on' : 'off';

    // composerRestyle <-> composer
    const compOn =
      out.composerRestyle !== undefined
        ? out.composerRestyle !== false && out.composerRestyle !== 'off'
        : out.composer !== undefined
        ? out.composer !== 'off' && out.composer !== false
        : true;
    out.composerRestyle = compOn;
    out.composer = compOn ? 'on' : 'off';

    // placeholderStyle <-> promptStyle
    const rawPh = out.placeholderStyle ?? out.promptStyle ?? 'studio';
    const normPh = rawPh === 'host' ? 'host' : 'studio';
    out.placeholderStyle = normPh;
    out.promptStyle = normPh;

    // mascot: 'crab' | 'dual' | 'minis' | 'off'
    if (out.mascot === 'off' || out.mascot === false) {
      out.mascot = 'off';
    } else if (out.mascot === 'minis') {
      out.mascot = 'minis';
    } else if (out.mascot === 'dual') {
      out.mascot = 'dual';
    } else {
      out.mascot = 'crab';
    }

    // sidebarRestyle <-> sidebar
    const sbOn =
      out.sidebarRestyle !== undefined
        ? out.sidebarRestyle !== false && out.sidebarRestyle !== 'off'
        : out.sidebar !== undefined
        ? out.sidebar !== 'off' && out.sidebar !== false
        : true;
    out.sidebarRestyle = sbOn;
    out.sidebar = sbOn ? 'on' : 'off';

    // sidebarCompact: boolean <-> 'on'/'off'
    const sbCompact = out.sidebarCompact === true || out.sidebarCompact === 'on';
    out.sidebarCompact = sbCompact;

    // smoothCaret: boolean <-> 'on'/'off'
    const caretOn = out.smoothCaret === undefined ? true : out.smoothCaret !== false && out.smoothCaret !== 'off';
    out.smoothCaret = caretOn;

    // language <-> lang
    const rawLang = out.language || (out.lang && out.lang !== 'auto' ? out.lang : '');
    if (rawLang) {
      out.language = rawLang;
      if (!out.lang) out.lang = rawLang;
    }

    return out;
  }

  function loadSettings(base) {
    try {
      const cleanBase = { ...base };
      delete cleanBase.binding;
      delete cleanBase.pollIntervalMs;
      delete cleanBase.codeHash;
      const baseJson = JSON.stringify(cleanBase);
      const prevBaseJson = localStorage.getItem(STORAGE_FILE_CFG_KEY);
      if (!prevBaseJson || prevBaseJson !== baseJson) {
        localStorage.setItem(STORAGE_FILE_CFG_KEY, baseJson);
      }

      // 平滑迁移读取旧 localStorage['ag-claude-style:config'] / v3 至 localStorage['ag-prism:config']
      const savedV3 = safeParseJsonObj(localStorage.getItem(STORAGE_LEGACY_V3_KEY));
      const savedLegacyColon = safeParseJsonObj(localStorage.getItem(STORAGE_LEGACY_COLON_KEY));
      const savedPrism = safeParseJsonObj(localStorage.getItem(STORAGE_PRISM_KEY));
      const mergedSaved = { ...(savedV3 || {}), ...(savedLegacyColon || {}), ...(savedPrism || {}) };

      if (!savedPrism && (savedLegacyColon || savedV3)) {
        const cleanMigrated = { ...mergedSaved };
        localStorage.setItem(STORAGE_PRISM_KEY, JSON.stringify(cleanMigrated));
      }

      return normalizeConfigShape({ ...base, ...mergedSaved });
    } catch {
      return normalizeConfigShape({ ...base });
    }
  }

  let cfg = loadSettings(initialConfig);
  let destroyed = false;
  let internalDomMutating = false;

  // 细粒度增量同步标记与脏节点队列
  const dirtyAddedRoots = new Set();
  const dirtyFlags = {
    full: true,
    theme: false,
    route: false,
    sidebar: false,
    composer: false,
    buttons: false,
    overlays: false,
    collapsible: false,
    settings: false,
  };
  const perfStats = {
    lastSyncMs: 0,
    syncCount: 0,
    iconIncrementalRuns: 0,
    iconFullRuns: 0,
  };

  function markAllDirty() {
    dirtyFlags.full = true;
    dirtyFlags.theme = true;
    dirtyFlags.route = true;
    dirtyFlags.sidebar = true;
    dirtyFlags.composer = true;
    dirtyFlags.buttons = true;
    dirtyFlags.overlays = true;
    dirtyFlags.collapsible = true;
    dirtyFlags.settings = true;
  }

  function resolveWireSettingPair(key, value) {
    const base = initialConfig || {};
    if (key === 'homeLayout' && 'homeMode' in base && !('homeLayout' in base)) {
      return ['homeMode', value];
    }
    if (key === 'homeRipple' && 'ripple' in base && !('homeRipple' in base)) {
      return ['ripple', value ? 'on' : 'off'];
    }
    if (key === 'composerRestyle' && 'composer' in base && !('composerRestyle' in base)) {
      return ['composer', value ? 'on' : 'off'];
    }
    if (key === 'placeholderStyle' && 'promptStyle' in base && !('placeholderStyle' in base)) {
      return ['promptStyle', value];
    }
    if (key === 'sidebarRestyle' && 'sidebar' in base && !('sidebarRestyle' in base)) {
      return ['sidebar', value ? 'on' : 'off'];
    }
    if (key === 'sidebarCompact' && typeof base.sidebarCompact === 'string') {
      return ['sidebarCompact', value ? 'on' : 'off'];
    }
    if (key === 'smoothCaret' && typeof base.smoothCaret === 'string') {
      return ['smoothCaret', value ? 'on' : 'off'];
    }
    if (key === 'language' && 'lang' in base && !('language' in base)) {
      return ['lang', value];
    }
    if (key === 'mascot') {
      if (base.mascot === 'dual' && (value === 'crab' || value === 'minis')) {
        return ['mascot', value === 'minis' ? 'minis' : 'dual'];
      }
      if (value === 'minis') return ['mascot', 'crab'];
      return ['mascot', value];
    }
    return [key, value];
  }

  function saveSetting(key, value) {
    const patch = { [key]: value };
    if (key === 'language') patch.lang = value;
    if (key === 'homeLayout') patch.homeMode = value;
    if (key === 'homeRipple') patch.ripple = value ? 'on' : 'off';
    if (key === 'composerRestyle') patch.composer = value ? 'on' : 'off';
    if (key === 'placeholderStyle') patch.promptStyle = value;
    if (key === 'sidebarRestyle') patch.sidebar = value ? 'on' : 'off';
    cfg = normalizeConfigShape({ ...cfg, ...patch });

    try {
      const saved = safeParseJsonObj(localStorage.getItem(STORAGE_PRISM_KEY)) || {};
      Object.assign(saved, patch);
      const serialized = JSON.stringify(saved);
      localStorage.setItem(STORAGE_PRISM_KEY, serialized);
      localStorage.setItem(STORAGE_LEGACY_V3_KEY, serialized);
    } catch {}
    try {
      const send = window[cfg.binding] || window.__agPrismSetting || window.__agClaudeStyleSetting;
      if (typeof send === 'function') {
        const [wireKey, wireVal] = resolveWireSettingPair(key, value);
        send(JSON.stringify({ key: wireKey, value: wireVal }));
      }
    } catch {}
    markAllDirty();
    applyRootAttrs();
    scheduleSync();
  }

  function getLang() {
    const raw =
      cfg.language ||
      (cfg.lang && cfg.lang !== 'auto' ? cfg.lang : '') ||
      initialConfig?.language ||
      (initialConfig?.lang && initialConfig.lang !== 'auto' ? initialConfig.lang : '') ||
      (typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'zh-CN');
    if (i18nCore && typeof i18nCore.normalizeLanguage === 'function') {
      return i18nCore.normalizeLanguage(raw);
    }
    if (raw === 'zh-TW' || raw === 'yue' || raw === 'en' || raw === 'ja') return raw;
    const low = String(raw || '').toLowerCase();
    if (low.startsWith('zh-tw') || low.startsWith('zh-hk')) return 'zh-TW';
    if (low.startsWith('yue')) return 'yue';
    if (low.startsWith('ja')) return 'ja';
    if (low.startsWith('en')) return 'en';
    return 'zh-CN';
  }

  function uiText(lang = getLang()) {
    if (i18nLocales && typeof i18nLocales.getUiStrings === 'function') {
      return i18nLocales.getUiStrings(lang);
    }
    return {};
  }

  function isZh() {
    const lang = getLang();
    return lang === 'zh-CN' || lang === 'zh-TW' || lang === 'yue';
  }

  function isDarkTheme() {
    const b = document.body?.classList;
    const h = document.documentElement?.classList;
    if (b?.contains('theme-light') || b?.contains('light-theme') || b?.contains('light')) return false;
    if (b?.contains('theme-dark') || b?.contains('dark') || b?.contains('dark-theme')) return true;
    if (h?.contains('theme-light') || h?.contains('light-theme') || h?.contains('light')) return false;
    if (h?.contains('theme-dark') || h?.contains('dark') || h?.contains('dark-theme')) return true;
    return true;
  }

  function getEffectivePalette() {
    const p = cfg.palette;
    return p === 'obsidian' || p === 'warm' || p === 'claude' || p === 'host' ? p : 'obsidian';
  }

  function getLightPreset() {
    return cfg.lightPreset === 'alabaster' ? 'alabaster' : 'crystal';
  }

  function getMotionLevel() {
    const v = cfg.motionLevel;
    return v === 'off' || v === 'subtle' || v === 'standard' || v === 'ultra' ? v : 'ultra';
  }

  function getTelemetryMode() {
    return cfg.telemetryModule === 'on' || cfg.telemetryModule === 'off' ? cfg.telemetryModule : 'auto';
  }

  function getEffortSliderMode() {
    return cfg.effortSliderModule === 'on' || cfg.effortSliderModule === 'off' ? cfg.effortSliderModule : 'auto';
  }

  function getThoughtTranslateMode() {
    return cfg.thoughtTranslate === 'machine' || cfg.thoughtTranslate === 'ai' ? cfg.thoughtTranslate : 'off';
  }

  function getThoughtTriggerTiming() {
    return cfg.thoughtTrigger === 'expand' ? 'expand' : 'preload';
  }

  function isMascotEnabled() {
    return cfg.mascot === 'crab' || cfg.mascot === 'dual' || cfg.mascot === 'minis';
  }

  function motionReduced() {
    if (cfg.motionLevel === 'off') return true;
    return typeof matchMedia === 'function' && Boolean(matchMedia('(prefers-reduced-motion: reduce)')?.matches);
  }

  function isMotionStandardOrUltra() {
    if (motionReduced()) return false;
    const lv = getMotionLevel();
    return lv === 'standard' || lv === 'ultra';
  }

  function isMotionUltra() {
    return !motionReduced() && getMotionLevel() === 'ultra';
  }

  // ── Built-in Thought Translator Overlay Isolation Helpers (Zero-Flicker Guard) ──
  const THOUGHT_ISOLATED_SELECTOR = '.ag-prism-thought-overlay, .ag-prism-thought-raw-toggle, [data-prism-ignore]';

  function isThoughtIsolatedNode(node) {
    if (!node) return false;
    const el = isElementLike(node) ? node : node.parentElement;
    if (!el) return false;
    if (
      el.classList?.contains?.('ag-prism-thought-overlay') ||
      el.classList?.contains?.('ag-prism-thought-raw-toggle') ||
      el.classList?.contains?.('ag-prism-thought-body') ||
      el.hasAttribute?.('data-prism-ignore')
    ) {
      return true;
    }
    return Boolean(el.closest?.(THOUGHT_ISOLATED_SELECTOR));
  }

  function isThoughtMutationRecord(m) {
    if (!m) return false;
    if (isThoughtIsolatedNode(m.target)) return true;
    const added = m.addedNodes;
    const removed = m.removedNodes;
    const addLen = added ? added.length : 0;
    const remLen = removed ? removed.length : 0;
    if (addLen + remLen > 0) {
      for (let i = 0; i < addLen; i++) {
        if (!isThoughtIsolatedNode(added[i])) return false;
      }
      for (let i = 0; i < remLen; i++) {
        if (!isThoughtIsolatedNode(removed[i])) return false;
      }
      return true;
    }
    return false;
  }

  function isManagedThoughtPanel(panel) {
    if (!panel || !isElementLike(panel)) return false;
    if (panel.hasAttribute?.('data-op-zh-ready') || panel.hasAttribute?.('data-op-zh-pending')) return true;
    if (panel.querySelector?.('.ag-prism-thought-overlay') !== null && panel.querySelector?.('.ag-prism-thought-overlay') !== undefined) {
      return true;
    }
    return false;
  }

  function runGuardedMut(fn) {
    const prev = internalDomMutating;
    internalDomMutating = true;
    try {
      return fn();
    } finally {
      internalDomMutating = prev;
    }
  }

  let lastThemeKey = '';
  let lastAppliedLang = '';
  let lastAppliedMotion = '';

  function setAttrIfChanged(el, name, val) {
    if (!el) return;
    if (el.getAttribute(name) !== val) el.setAttribute(name, val);
  }

  function refreshOpenUiForLanguage() {
    const inHero = Boolean(document.querySelector('.agy-home [data-testid="home-greeting"]'));
    syncGreeting(inHero);
    if (inHero && cfg.homeLayout === 'studio') renderHomePanel(true);
    syncComposers(null);
    ensureSettingsSection();
  }

  function syncMotionSpringTokens() {
    const html = document.documentElement;
    if (!html || !html.style || typeof html.style.setProperty !== 'function') return;
    if (!motionEngine || typeof motionEngine.springLinear !== 'function') return;
    try {
      const sp = motionEngine.springLinear({ stiffness: 420, damping: 32, mass: 1 });
      const easing = typeof sp === 'string' ? sp : sp && sp.easing;
      const durMs = sp && typeof sp === 'object' ? sp.durationMs || 300 : 300;
      if (easing) {
        html.style.setProperty('--ag-spring-sidebar-ease', easing);
        html.style.setProperty('--ag-spring-sidebar-dur', `${Math.round(durMs)}ms`);
      }
    } catch {}
  }

  function syncAbsorbedModules() {
    try {
      window.__agPrismTelemetry?.sync?.(cfg);
    } catch {}
    try {
      window.__agPrismEffortSlider?.sync?.(cfg);
    } catch {}
    try {
      window.__agPrismThought?.sync?.(cfg);
    } catch {}
  }

  function applyRootAttrs() {
    const html = document.documentElement;
    if (!html) return;
    const palette = getEffectivePalette();
    const lightPreset = getLightPreset();
    const lang = getLang();
    const motionLv = getMotionLevel();
    const telemetryMod = getTelemetryMode();
    const effortSliderMod = getEffortSliderMode();

    const prevMut = internalDomMutating;
    internalDomMutating = true;
    try {
      setAttrIfChanged(html, 'data-ag-prism', VERSION);
      setAttrIfChanged(html, 'data-ag-cs-style', '1');
      setAttrIfChanged(html, 'data-ag-cs-palette', palette);
      setAttrIfChanged(html, 'data-ag-cs-light-preset', lightPreset);
      setAttrIfChanged(html, 'data-ag-cs-motion', motionLv);
      setAttrIfChanged(html, 'data-ag-cs-telemetry', telemetryMod);
      setAttrIfChanged(html, 'data-ag-cs-effort-slider', effortSliderMod);
      setAttrIfChanged(html, 'data-ag-cs-thought-translate', getThoughtTranslateMode());
      setAttrIfChanged(
        html,
        'data-ag-cs-home',
        cfg.homeLayout === 'classic' ? 'classic' : cfg.homeLayout === 'off' ? 'off' : 'studio'
      );
      setAttrIfChanged(html, 'data-ag-cs-composer', cfg.composerRestyle === false ? 'off' : 'on');
      setAttrIfChanged(html, 'data-ag-cs-logo-ink', cfg.logoInk === 'foreground' ? 'foreground' : 'accent');
      setAttrIfChanged(html, 'data-ag-cs-sidebar', cfg.sidebarRestyle === false ? 'off' : 'on');
      setAttrIfChanged(html, 'data-ag-cs-sidebar-compact', cfg.sidebarCompact === true ? 'on' : 'off');
      setAttrIfChanged(html, 'data-ag-cs-lang', lang);
      const isCjk = i18nCore && typeof i18nCore.isCjkLanguage === 'function' ? i18nCore.isCjkLanguage(lang) : isZh();
      if (isCjk) setAttrIfChanged(html, 'data-ag-cs-cjk', '1');
      else if (html.hasAttribute('data-ag-cs-cjk')) html.removeAttribute('data-ag-cs-cjk');

      syncAbsorbedModules();

      const prevMotion = lastAppliedMotion;
      if (motionLv !== prevMotion) {
        lastAppliedMotion = motionLv;
        if (rippleMount && typeof rippleMount.refreshTheme === 'function') rippleMount.refreshTheme();
        convAuraCtl.refreshTheme();
        if (prevMotion !== '') {
          syncHostAnimatedIcons(null);
          syncDualStreamEngine();
        }
      }

      const prevLang = lastAppliedLang;
      if (lang !== prevLang) {
        lastAppliedLang = lang;
        if (prevLang !== '') refreshOpenUiForLanguage();
      }

      const dark = isDarkTheme();
      const themeKey = `${palette}|${lightPreset}|${dark ? 'd' : 'l'}`;
      if (themeKey !== lastThemeKey) {
        lastThemeKey = themeKey;
        if (rippleMount && typeof rippleMount.refreshTheme === 'function') {
          rippleMount.refreshTheme();
        }
        convAuraCtl.refreshTheme();
      }
    } finally {
      internalDomMutating = prevMut;
    }
  }

  // ── Antigravity React Fiber & Store Bridge ─────────────────────────────
  let cachedSvc = null;
  let cachedStore = null;
  let storeUnsub = null;
  let storeDebounce = null;

  function ensureHooks(allowPartial = false) {
    if (cachedSvc && cachedStore) return { svc: cachedSvc, store: cachedStore };
    const anchors = document.querySelectorAll(
      '[data-testid="conversation-view"], [data-testid="agent-input-box"], [data-testid="conversation-row-sidebar"], [data-testid="new-conversation-button"], [data-testid="home-greeting"]'
    );
    for (const el of anchors) {
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      for (let f = key && el[key]; f && !(cachedSvc && cachedStore); f = f.return) {
        const p = f.memoizedProps;
        if (!cachedStore && p && p.store && typeof p.store.getState === 'function') {
          cachedStore = p.store;
        }
        for (let d = f.dependencies && f.dependencies.firstContext; d; d = d.next) {
          const v = d.memoizedValue;
          if (!v || typeof v !== 'object') continue;
          if (!cachedSvc && typeof v.getCascadeTrajectory === 'function') cachedSvc = v;
          if (!cachedStore && v.store && typeof v.store.getState === 'function') cachedStore = v.store;
        }
      }
      if (cachedSvc && cachedStore) break;
    }
    if (cachedStore && !storeUnsub) {
      storeUnsub = cachedStore.subscribe(() => {
        if (destroyed || storeDebounce) return;
        storeDebounce = setTimeout(() => {
          storeDebounce = null;
          if (!destroyed) onStoreChanged();
        }, 400);
      });
    }
    if (cachedSvc && cachedStore) return { svc: cachedSvc, store: cachedStore };
    if (allowPartial && (cachedSvc || cachedStore)) return { svc: cachedSvc, store: cachedStore };
    return null;
  }

  function getDisplayName() {
    const h = ensureHooks(true);
    const raw = String(h?.store?.getState()?.userStatus?.name || '').trim();
    if (!raw) return '';
    return raw.split(/\s+/)[0] || raw;
  }

  function resolveCascadeId(inputBox) {
    const cv = inputBox ? inputBox.closest('[data-testid="conversation-view"]') : document.querySelector('[data-testid="conversation-view"]');
    if (inputBox && !cv && inputBox.closest('.agy-home')) return '';
    if (cv) {
      const attrId = cv.getAttribute('data-cascade-id');
      if (attrId && attrId !== 'conversation') return attrId;
    }
    const m = location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
    if (m) return m[1];
    const readCascadeFromFiber = (el, maxDepth) => {
      if (!el) return '';
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      for (let f = key && el[key], d = 0; f && d < maxDepth; f = f.return, d++) {
        const p = f.memoizedProps || f.pendingProps;
        if (p && typeof p.cascadeId === 'string' && p.cascadeId) return p.cascadeId;
      }
      return '';
    };
    const fromInputFiber = readCascadeFromFiber(inputBox, 60);
    if (fromInputFiber) return fromInputFiber;
    const fromCvFiber = readCascadeFromFiber(cv, 35);
    if (fromCvFiber) return fromCvFiber;
    if (cv && !inputBox?.closest?.('[data-testid="subagent-tab-conversation"]')) {
      const h = ensureHooks(true);
      const convoState = h?.store?.getState?.()?.conversation?.convoState;
      if (convoState?.type === 'active' && typeof convoState.cascadeId === 'string' && convoState.cascadeId) {
        return convoState.cascadeId;
      }
    }
    return '';
  }

  // ── Usage Rollup Store ─────────────────────────────────────────────────
  const usageRecords = new Map();
  let usageLoading = false;
  let usageHasData = false;
  let lastUsageFetchAt = 0;
  let bookPick = 0.07;
  let activeTab = 'overview';
  let activeRange = 'all';
  let modelsExpanded = false;
  let lastPanelRenderKey = '';

  function loadUsageCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_USAGE_CACHE_KEY) || '{}');
      if (raw && typeof raw === 'object') {
        for (const [id, rec] of Object.entries(raw)) {
          if (rec && rec.days) usageRecords.set(id, rec);
        }
        if (usageRecords.size > 0) usageHasData = true;
      }
    } catch {}
  }

  function saveUsageCache() {
    try {
      const obj = {};
      for (const [id, rec] of usageRecords.entries()) obj[id] = rec;
      localStorage.setItem(STORAGE_USAGE_CACHE_KEY, JSON.stringify(obj));
    } catch {}
  }

  loadUsageCache();

  async function refreshUsageRollup(force = false) {
    if (destroyed || usageLoading) return;
    const h = ensureHooks();
    if (!h) return;
    const now = Date.now();
    if (!force && usageHasData && now - lastUsageFetchAt < 15000) return;
    const sums = h.store.getState().trajectorySummaries?.summaries || {};
    const entries = Object.entries(sums).filter(([, s]) => !!s);
    if (entries.length === 0) {
      usageHasData = true;
      renderHomePanel();
      return;
    }

    const staleIds = [];
    const presentIds = new Set();
    for (const [id, sum] of entries) {
      presentIds.add(id);
      const stepCount = Number(sum.stepCount || 0);
      const lastModSec = Number(sum.lastModifiedTime?.seconds || 0);
      const cached = usageRecords.get(id);
      if (!cached || cached.stepCount !== stepCount || cached.lastModifiedSec !== lastModSec) {
        staleIds.push([id, sum]);
      }
    }
    for (const oldId of Array.from(usageRecords.keys())) {
      if (!presentIds.has(oldId)) usageRecords.delete(oldId);
    }

    if (staleIds.length === 0) {
      usageHasData = true;
      lastUsageFetchAt = now;
      renderHomePanel();
      return;
    }

    usageLoading = true;
    renderHomePanel();
    try {
      const CONCURRENCY = 6;
      const FETCH_TIMEOUT_MS = 4000;
      const buildFallbackUsageRecord = (id, sum) => {
        const sec = Number(sum?.lastModifiedTime?.seconds || sum?.createdTime?.seconds || 0);
        const days = {};
        if (sec > 0 && typeof usageCore.homeDayKey === 'function') {
          const d = new Date(sec * 1000);
          const dk = usageCore.homeDayKey(d);
          const hours = new Array(24).fill(0);
          hours[d.getHours()] = 1;
          days[dk] = { calls: 1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, hours, models: {} };
        }
        return {
          cascadeId: String(id || ''),
          stepCount: Number(sum?.stepCount || 0),
          lastModifiedSec: Number(sum?.lastModifiedTime?.seconds || 0),
          subagent: typeof usageCore.isSubagentSummary === 'function' ? usageCore.isSubagentSummary(sum) : false,
          calls: 0,
          days,
        };
      };
      for (let i = 0; i < staleIds.length && !destroyed; i += CONCURRENCY) {
        const batch = staleIds.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async ([id, sum]) => {
            try {
              let timerId = null;
              const timeoutProm = new Promise((_, reject) => {
                timerId = setTimeout(() => reject(new Error('Usage fetch timeout')), FETCH_TIMEOUT_MS);
              });
              let res;
              try {
                res = await Promise.race([h.svc.getCascadeTrajectory({ cascadeId: id }), timeoutProm]);
              } finally {
                if (timerId !== null) clearTimeout(timerId);
              }
              const rec = usageCore.analyzeTrajectoryForUsage(res, sum, id);
              usageRecords.set(id, rec);
            } catch {
              const prev = usageRecords.get(id);
              usageRecords.set(id, prev || buildFallbackUsageRecord(id, sum));
            }
          })
        );
      }
      if (!destroyed) {
        usageHasData = true;
        lastUsageFetchAt = Date.now();
        saveUsageCache();
      }
    } finally {
      usageLoading = false;
      if (!destroyed) renderHomePanel();
    }
  }

  // ── Home Greeting Copy Manager ─────────────────────────────────────────
  const replacedGreetings = new Map();
  let wasHero = false;

  function syncGreeting(inHero) {
    if (inHero && !wasHero) {
      bookPick = Math.random();
      if (cfg.homeLayout === 'studio') refreshUsageRollup(false);
    }
    wasHero = inHero;

    const h1 = document.querySelector('[data-testid="home-greeting"] h1');
    if (!h1) return;

    if (cfg.homeLayout !== 'studio') {
      h1.removeAttribute('data-ag-no-i18n');
      const orig = replacedGreetings.get(h1);
      if (orig !== undefined) {
        if (h1.textContent !== orig.host) h1.textContent = orig.host;
        replacedGreetings.delete(h1);
      }
      return;
    }

    const lang = getLang();
    const name = getDisplayName();
    let target;
    if (lang === 'zh-CN') target = name ? `接下来做什么，${name}？` : '接下来做什么？';
    else if (lang === 'zh-TW') target = name ? `接下來做什麼，${name}？` : '接下來做什麼？';
    else if (lang === 'yue') target = name ? `跟住想做啲咩，${name}？` : '跟住想做啲咩？';
    else if (lang === 'ja') target = name ? `次は何をしますか、${name}？` : '次は何をしますか？';
    else target = name ? `What's up next, ${name}?` : "What's up next?";

    setAttrIfChanged(h1, 'data-ag-no-i18n', '');
    if (h1.textContent !== target) {
      const prev = replacedGreetings.get(h1);
      const hostText = prev && h1.textContent === prev.written ? prev.host : h1.textContent || '';
      h1.textContent = target;
      replacedGreetings.set(h1, { host: hostText, written: target });
    }
  }

  function restoreGreetings() {
    for (const [el, rec] of replacedGreetings.entries()) {
      el.removeAttribute('data-ag-no-i18n');
      if (el.isConnected && el.textContent === rec.written) el.textContent = rec.host;
    }
    replacedGreetings.clear();
  }

  // ── Home Dashboard Card Renderer & Orbital Geometry Backdrop ───────────
  let panelSeat = null;
  let panelEl = null;
  let heatTipEl = null;
  let modelColours = usageCore ? usageCore.createHomeModelColours() : () => ({});

  const ORBITAL_SVG_HTML =
    '<svg class="ag-cs-orbital-svg" viewBox="0 0 760 280" fill="none" preserveAspectRatio="none">' +
    '<ellipse class="ag-cs-orbit-arc is-primary" cx="468" cy="136" rx="348" ry="118" transform="rotate(-10 468 136)"/>' +
    '<ellipse class="ag-cs-orbit-arc is-dashed" cx="468" cy="136" rx="252" ry="82" stroke-dasharray="2.5 5.5" transform="rotate(-10 468 136)"/>' +
    '<g class="ag-cs-orbit-reticle" transform="translate(466 36)"><path d="M-4 0H4M0 -4V4"/></g>' +
    '<g class="ag-cs-orbit-reticle" transform="translate(216 184)"><path d="M-3.5 0H3.5M0 -3.5V3.5"/></g>' +
    '<g class="ag-cs-orbit-reticle" transform="translate(698 92)"><path d="M-3.5 0H3.5M0 -3.5V3.5"/></g>' +
    '<circle class="ag-cs-orbit-node is-cobalt" cx="634" cy="54" r="2.2"/>' +
    '<circle class="ag-cs-orbit-node is-iris" cx="308" cy="64" r="1.8"/>' +
    '<circle class="ag-cs-orbit-node is-amber" cx="566" cy="212" r="1.8"/>' +
    '</svg>';

  function ensurePanelSeat() {
    const home = document.querySelector('.agy-home');
    if (!home || cfg.homeLayout !== 'studio') {
      unmountPanelSeat();
      return null;
    }
    const greeting = home.querySelector('[data-testid="home-greeting"]');
    if (!greeting || !greeting.parentElement) return null;

    if (!panelSeat || !panelSeat.isConnected || panelSeat.parentElement !== greeting.parentElement) {
      unmountPanelSeat();
      panelSeat = document.createElement('div');
      panelSeat.className = 'ag-cs-home-panel-seat';
      panelSeat.setAttribute('data-ag-no-i18n', '');
      panelEl = document.createElement('section');
      panelEl.className = 'ag-cs-home-panel';
      panelSeat.appendChild(panelEl);
      greeting.parentElement.insertBefore(panelSeat, greeting.nextSibling);
    }
    return panelEl;
  }

  function unmountPanelSeat() {
    if (panelSeat && panelSeat.parentElement) panelSeat.parentElement.removeChild(panelSeat);
    panelSeat = null;
    panelEl = null;
    heatTipEl = null;
    lastPanelRenderKey = '';
  }

  function showHeatTip(cell, grid) {
    const tipText = cell.getAttribute('data-tip');
    if (!tipText || !heatTipEl) return;
    heatTipEl.textContent = tipText;
    heatTipEl.setAttribute('data-shown', 'true');
    const gBox = grid.getBoundingClientRect();
    const cBox = cell.getBoundingClientRect();
    const tBox = heatTipEl.getBoundingClientRect();
    const centred = cBox.left + cBox.width / 2 - tBox.width / 2;
    const left = Math.min(Math.max(centred, gBox.left), gBox.right - tBox.width) - gBox.left;
    const above = cBox.top - gBox.top;
    const below = gBox.bottom - cBox.bottom;
    const sideBelow = below > above && below >= tBox.height + 6;
    const top = (sideBelow ? cBox.bottom + 6 : cBox.top - 6 - tBox.height) - gBox.top;
    heatTipEl.style.left = Math.round(left) + 'px';
    heatTipEl.style.top = Math.round(top) + 'px';
  }

  function hideHeatTip() {
    if (heatTipEl) heatTipEl.removeAttribute('data-shown');
  }

  function renderHomePanel(force = false) {
    if (!usageCore) return;
    const panel = ensurePanelSeat();
    if (!panel) return;
    const lang = getLang();
    const ui = uiText(lang);
    const skeleton = !usageHasData && usageLoading;
    const data = usageCore.aggregateUsageRollup(Array.from(usageRecords.values()), activeRange, bookPick, lang);
    const renderKey = [
      lang,
      activeTab,
      activeRange,
      modelsExpanded ? '1' : '0',
      skeleton ? 'skel' : 'ready',
      usageRecords.size,
      data.sessions,
      data.calls,
      data.tokens,
      data.activeDays,
      data.peakHour || '',
      data.model || '',
    ].join('|');
    if (!force && renderKey === lastPanelRenderKey && panel.childElementCount > 0) return;
    lastPanelRenderKey = renderKey;

    const prevMut = internalDomMutating;
    internalDomMutating = true;
    try {
      panel.innerHTML = '';

      const orbital = document.createElement('div');
      orbital.className = 'ag-cs-orbital-backdrop';
      orbital.setAttribute('aria-hidden', 'true');
      orbital.innerHTML = ORBITAL_SVG_HTML;
      panel.appendChild(orbital);

      const head = document.createElement('div');
      head.className = 'ag-cs-home-panel-head';

      const tabs = document.createElement('div');
      tabs.className = 'ag-cs-home-tabs';
      for (const [id, label] of [
        ['overview', ui.tabOverview || 'Overview'],
        ['models', ui.tabModels || 'Models'],
      ]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ag-cs-home-tab';
        btn.setAttribute('data-tab', id);
        btn.textContent = label;
        if (activeTab === id) btn.setAttribute('data-active', '');
        btn.addEventListener('click', () => {
          activeTab = id;
          renderHomePanel();
        });
        tabs.appendChild(btn);
      }

      const ranges = document.createElement('div');
      ranges.className = 'ag-cs-home-ranges';
      for (const r of usageCore.HOME_RANGES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ag-cs-home-range';
        btn.setAttribute('data-range', r.id);
        btn.textContent = typeof usageCore.homeRangeLabel === 'function' ? usageCore.homeRangeLabel(r, lang) : r.labelEn;
        if (activeRange === r.id) btn.setAttribute('data-active', '');
        btn.addEventListener('click', () => {
          activeRange = r.id;
          renderHomePanel();
        });
        ranges.appendChild(btn);
      }

      head.appendChild(tabs);
      head.appendChild(ranges);
      panel.appendChild(head);

      if (activeTab === 'overview') {
        const stats = document.createElement('div');
        stats.className = 'ag-cs-home-stats';
        const items = [
          ['sessions', ui.kpiSessions || 'Sessions', usageCore.formatHomeCount(data.sessions), String(data.sessions)],
          ['calls', ui.kpiCalls || 'Messages', usageCore.formatHomeCount(data.calls), String(data.calls)],
          ['tokens', ui.kpiTokens || 'Total tokens', usageCore.formatCompactTokens(data.tokens), usageCore.formatHomeCount(data.tokens) + ' tokens'],
          ['days', ui.kpiDays || 'Active days', usageCore.formatHomeCount(data.activeDays), String(data.activeDays)],
          ['peak', ui.kpiPeak || 'Peak hour', data.peakHour || '—', data.peakHour || '—'],
          ['model', ui.kpiFavModel || 'Favorite model', data.model || '—', data.model || '—'],
        ];
        for (const [k, label, valText, titleText] of items) {
          const cell = document.createElement('div');
          cell.className = 'ag-cs-home-stat';
          cell.setAttribute('data-stat', k);
          if (skeleton) cell.setAttribute('data-skeleton', '');
          const lbl = document.createElement('span');
          lbl.className = 'ag-cs-home-stat-label';
          lbl.textContent = label;
          const val = document.createElement('span');
          val.className = 'ag-cs-home-stat-value';
          val.textContent = skeleton ? '' : valText;
          if (!skeleton) val.title = titleText;
          cell.appendChild(lbl);
          cell.appendChild(val);
          stats.appendChild(cell);
        }
        panel.appendChild(stats);

        const heat = document.createElement('div');
        heat.className = 'ag-cs-home-heat';
        if (skeleton) heat.setAttribute('data-skeleton', '');
        const fmt = usageCore.homeShortDateFormat(lang);
        for (const c of data.grid.cells) {
          const sq = document.createElement('span');
          sq.className = 'ag-cs-home-heat-cell';
          sq.setAttribute('data-level', String(c.level));
          if (!skeleton) {
            const tip = `${usageCore.homeShortDate(fmt, c.date)} — ${usageCore.formatCompactTokens(c.tokens)} ${ui.tokenUnit || 'tokens'}`;
            sq.setAttribute('data-tip', tip);
            sq.setAttribute('aria-label', tip);
          }
          heat.appendChild(sq);
        }
        heatTipEl = document.createElement('span');
        heatTipEl.className = 'ag-cs-home-heat-hint';
        heatTipEl.setAttribute('aria-hidden', 'true');
        heat.appendChild(heatTipEl);

        heat.addEventListener('mouseover', (ev) => {
          const target = ev.target && ev.target.closest ? ev.target.closest('.ag-cs-home-heat-cell') : null;
          if (target) showHeatTip(target, heat);
        });
        heat.addEventListener('mouseleave', hideHeatTip);
        panel.appendChild(heat);

        if (data.funBook) {
          const fun = document.createElement('span');
          fun.className = 'ag-cs-home-fun';
          fun.textContent = data.funBook;
          panel.appendChild(fun);
        }
      } else {
        const models = data.models || [];
        if (models.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'ag-cs-home-models-empty';
          empty.textContent = ui.noModelUsage || 'No model usage data yet';
          panel.appendChild(empty);
          return;
        }

        const ids = models.map((m) => m.id);
        for (const col of data.modelDays || []) {
          for (const id of Object.keys(col.models || {})) ids.push(id);
        }
        const colours = modelColours(ids);
        const columns = data.modelDays || [];
        const fmt = usageCore.homeShortDateFormat(lang);

        if (columns.length > 0) {
          let peak = 0;
          for (const col of columns) {
            let sum = 0;
            for (const t of Object.values(col.models)) sum += t;
            if (sum > peak) peak = sum;
          }
          const top = usageCore.axisMax(peak);
          const chart = document.createElement('div');
          chart.className = 'ag-cs-home-chart';

          const plot = document.createElement('div');
          plot.className = 'ag-cs-home-chart-plot';
          for (const at of [1, 0.75, 0.5, 0.25, 0]) {
            const tick = document.createElement('span');
            tick.className = 'ag-cs-home-chart-tick';
            tick.style.bottom = `${at * 100}%`;
            tick.textContent = top > 0 ? usageCore.formatCompactTokens(top * at) : '';
            plot.appendChild(tick);
          }

          const bars = document.createElement('div');
          bars.className = 'ag-cs-home-chart-bars';
          for (const col of columns) {
            let dayTotal = 0;
            const stack = [];
            for (const [mId, tok] of Object.entries(col.models)) {
              dayTotal += tok;
              stack.push({ id: mId, tokens: tok });
            }
            stack.sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id));
            const colEl = document.createElement('span');
            colEl.className = 'ag-cs-home-chart-col';
            colEl.title = `${usageCore.homeShortDate(fmt, col.date)} · ${usageCore.formatCompactTokens(dayTotal)}`;
            colEl.style.height = `${top > 0 ? (dayTotal / top) * 100 : 0}%`;
            for (const slice of stack) {
              const seg = document.createElement('span');
              seg.className = 'ag-cs-home-chart-seg';
              seg.setAttribute('data-color', String(colours[slice.id] ?? 0));
              seg.style.height = `${dayTotal > 0 ? (slice.tokens / dayTotal) * 100 : 0}%`;
              colEl.appendChild(seg);
            }
            bars.appendChild(colEl);
          }
          plot.appendChild(bars);
          chart.appendChild(plot);

          const axis = document.createElement('div');
          axis.className = 'ag-cs-home-chart-axis';
          chart.appendChild(axis);
          panel.appendChild(chart);

          requestAnimationFrame(() => {
            if (!axis.isConnected) return;
            const plotW = plot.clientWidth || 420;
            const labels = columns.map((c) => usageCore.homeShortDate(fmt, c.date));
            const widths = labels.map((l) => Math.max(32, l.length * 6.5));
            const ticks = usageCore.homeChartTicks(widths, plotW);
            const prevInner = internalDomMutating;
            internalDomMutating = true;
            try {
              axis.innerHTML = '';
              for (const tk of ticks) {
                const sp = document.createElement('span');
                sp.className = 'ag-cs-home-chart-label';
                sp.style.left = `${tk.left}px`;
                sp.textContent = labels[tk.index];
                axis.appendChild(sp);
              }
            } finally {
              internalDomMutating = prevInner;
            }
          });
        }

        let totalAll = 0;
        for (const m of models) totalAll += m.tokens;
        const shown = modelsExpanded ? models : models.slice(0, usageCore.HOME_MODEL_ROWS);
        const listEl = document.createElement('div');
        listEl.className = 'ag-cs-home-models';
        for (const m of shown) {
          const row = document.createElement('div');
          row.className = 'ag-cs-home-model';
          row.title = `${m.id} · ${m.sessions} ${ui.sessionsUnit || 'sessions'}`;
          const sw = document.createElement('span');
          sw.className = 'ag-cs-home-model-swatch';
          sw.setAttribute('data-color', String(colours[m.id] ?? 0));
          const nm = document.createElement('span');
          nm.className = 'ag-cs-home-model-name';
          nm.textContent = m.id;
          const inp = (m.input || 0) + (m.cacheRead || 0) + (m.cacheWrite || 0);
          const outTok = m.output || 0;
          const sp = document.createElement('span');
          sp.className = 'ag-cs-home-model-split';
          sp.textContent = `${usageCore.formatCompactTokens(inp)} in · ${usageCore.formatCompactTokens(outTok)} out`;
          const sh = document.createElement('span');
          sh.className = 'ag-cs-home-model-share';
          sh.textContent = totalAll > 0 ? (Math.round((m.tokens / totalAll) * 1000) / 10).toFixed(1) + '%' : '—';
          row.appendChild(sw);
          row.appendChild(nm);
          row.appendChild(sp);
          row.appendChild(sh);
          listEl.appendChild(row);
        }
        if (models.length > usageCore.HOME_MODEL_ROWS) {
          const more = document.createElement('button');
          more.type = 'button';
          more.className = 'ag-cs-home-models-more';
          const hiddenCount = models.length - shown.length;
          more.textContent = modelsExpanded
            ? ui.showLess || 'Show less'
            : typeof ui.showMoreN === 'function'
            ? ui.showMoreN(hiddenCount)
            : `Show ${hiddenCount} more`;
          more.addEventListener('click', () => {
            modelsExpanded = !modelsExpanded;
            renderHomePanel();
          });
          listEl.appendChild(more);
        }
        panel.appendChild(listEl);
      }
    } finally {
      internalDomMutating = prevMut;
    }
  }

  // ── Home Interactive ASCII Matrix & Silk Skimmer Ripple Field (0fps True Sleep) ──
  const RIPPLE_INTRO_MS = 1600;
  let rippleMount = null;

  function readRipplePalette(canvas, auraState, now, cachedStyle) {
    const cs = cachedStyle || (typeof getComputedStyle === 'function' ? getComputedStyle(canvas) : null);
    const dark = isDarkTheme();
    const ink =
      (cs && rippleCore.parseCssColorToRgb(cs.getPropertyValue('--ag-cs-ripple-ink'))) ||
      (dark ? [146, 148, 156] : [104, 114, 134]);
    const wave =
      (cs && rippleCore.parseCssColorToRgb(cs.getPropertyValue('--ag-cs-ripple-wave'))) ||
      (dark ? [214, 218, 228] : [37, 99, 235]);
    const fontFamily = (cs && cs.getPropertyValue('--font-mono').trim()) || 'ui-monospace, Consolas, monospace';
    const aura =
      auraState && auraState.active && !motionReduced()
        ? { x: auraState.x, y: auraState.y, radius: 230, strength: 1, active: true }
        : { x: 0, y: 0, radius: 230, strength: 0, active: false };
    return { ink, wave, dark, fontFamily, prismStrength: 1, aura, auraPhase: (now || 0) * 0.0006 };
  }

  function unmountRipple() {
    if (!rippleMount) return;
    if (rippleMount.timer) clearTimeout(rippleMount.timer);
    if (rippleMount.rafId) cancelAnimationFrame(rippleMount.rafId);
    if (rippleMount.ro) rippleMount.ro.disconnect();
    rippleMount.root.removeEventListener('pointerdown', rippleMount.onPress);
    if (rippleMount.onMove) rippleMount.root.removeEventListener('pointermove', rippleMount.onMove);
    if (rippleMount.onLeave) rippleMount.root.removeEventListener('pointerleave', rippleMount.onLeave);
    document.removeEventListener('visibilitychange', rippleMount.onVis);
    rippleMount.field.dispose();
    if (rippleMount.glow && typeof rippleMount.glow.dispose === 'function') rippleMount.glow.dispose();
    rippleMount.host.remove();
    rippleMount = null;
  }

  function syncRipple() {
    if (!rippleCore) return;
    const home = cfg.homeRipple !== false && cfg.homeLayout !== 'off' ? document.querySelector('.agy-home') : null;
    if (rippleMount && (rippleMount.root !== home || !rippleMount.canvas.isConnected)) {
      unmountRipple();
    }
    if (!home || rippleMount) return;

    const host = document.createElement('div');
    host.className = 'ag-cs-ripple-host';
    host.setAttribute('aria-hidden', 'true');
    const glowCanvas = document.createElement('canvas');
    glowCanvas.className = 'ag-cs-brand-glow';
    glowCanvas.setAttribute('data-testid', 'onboarding-brand-glow');
    glowCanvas.setAttribute('aria-hidden', 'true');
    host.appendChild(glowCanvas);
    const canvas = document.createElement('canvas');
    canvas.className = 'ag-cs-ripple-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    home.insertBefore(host, home.firstChild);

    const auraState = { x: 0, y: 0, active: false };
    let lastSkimX = null;
    let lastSkimY = null;
    let lastSkimAt = 0;
    let skimCarryDist = 0;
    let cachedCanvasStyle = null;

    const state = {
      root: home,
      host,
      glowCanvas,
      canvas,
      width: -1,
      height: -1,
      dpr: 0,
      mountedAt: performance.now(),
      sleeping: false,
      aura: { reach: 0.47, strength: 1.0 },
      tideSwellAt: 0,
      waves: rippleCore.createWaveField(0, 0),
      glow:
        typeof rippleCore.mountBrandHorizonGlow === 'function'
          ? rippleCore.mountBrandHorizonGlow(glowCanvas)
          : { mode: 'none', resize() {}, draw() {}, dispose() {} },
      field: rippleCore.createGlyphField(canvas, 0, 0, rippleCore.createWaveField(0, 0)),
      timer: 0,
      rafId: 0,
      ro: null,
      onPress: null,
      onMove: null,
      onLeave: null,
      onVis: null,
      wake: null,
    };
    let previous = state.mountedAt;
    let frameWanted = false;
    let drawnOnce = false;
    let forceSingleDraw = true;

    function updateCalmZones() {
      if (!state.field || typeof state.field.setCalmZones !== 'function') return;
      const greet = home.querySelector('[data-testid="home-greeting"]');
      if (!greet) {
        state.field.setCalmZones([]);
        return;
      }
      const c = canvas.getBoundingClientRect();
      const g = greet.getBoundingClientRect();
      if (!c.width || !g.width) return;
      state.field.setCalmZones([
        { x: g.left - c.left - 28, y: g.top - c.top - 14, w: g.width + 56, h: g.height + 28 },
      ]);
    }

    function layout() {
      const w = home.clientWidth;
      const h = home.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (w === state.width && h === state.height && dpr === state.dpr) return;
      const cols = Math.ceil(w / rippleCore.RIPPLE.cellWidth);
      const rows = Math.ceil(h / rippleCore.RIPPLE.cellHeight);
      state.width = w;
      state.height = h;
      state.dpr = dpr;
      canvas.width = Math.round(cols * rippleCore.RIPPLE.cellWidth * dpr);
      canvas.height = Math.round(rows * rippleCore.RIPPLE.cellHeight * dpr);
      canvas.style.width = `${cols * rippleCore.RIPPLE.cellWidth}px`;
      canvas.style.height = `${rows * rippleCore.RIPPLE.cellHeight}px`;
      if (state.glow && typeof state.glow.resize === 'function') {
        state.glow.resize(w, h, Math.min(dpr, 1.5));
      }
      state.field.dispose();
      state.waves = rippleCore.createWaveField(cols, rows);
      state.field = rippleCore.createGlyphField(canvas, cols, rows, state.waves);
      cachedCanvasStyle = typeof getComputedStyle === 'function' ? getComputedStyle(canvas) : null;
      updateCalmZones();
      drawnOnce = false;
      forceSingleDraw = true;
    }

    function enterIdleSleep() {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = 0;
      }
      state.sleeping = true;
      setAttrIfChanged(host, 'data-ripple-sleep', '1');
    }

    function wake() {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = 0;
      }
      if (destroyed || frameWanted) return;
      state.sleeping = false;
      if (host.hasAttribute('data-ripple-sleep')) host.removeAttribute('data-ripple-sleep');
      if (document.hidden) {
        if (!drawnOnce && canvas.width > 0) drawFrame(performance.now());
        enterIdleSleep();
        return;
      }
      frameWanted = true;
      state.rafId = requestAnimationFrame(drawFrame);
    }

    function drawFrame(now) {
      state.rafId = 0;
      frameWanted = false;
      if (destroyed || rippleMount !== state && rippleMount !== null) return;
      const still = motionReduced();
      state.waves.advance(still ? 0 : Math.min(0.06, Math.max(0, (now - previous) / 1000)));
      previous = now;
      const tideElapsed = state.tideSwellAt > 0 ? now - state.tideSwellAt : -1;
      const inTideSwell = !still && tideElapsed >= 0 && tideElapsed < 480;
      if (state.tideSwellAt > 0 && !inTideSwell) {
        state.tideSwellAt = 0;
        state.aura.reach = 0.47;
        state.aura.strength = 1.0;
        forceSingleDraw = true;
      } else if (inTideSwell) {
        const p = Math.max(0, Math.min(1, tideElapsed / 480));
        const ease = 1 - Math.pow(1 - p, 2.2);
        state.aura.reach = +(0.2 + (0.47 - 0.2) * ease).toFixed(4);
        state.aura.strength = +(0.32 + (1.0 - 0.32) * ease).toFixed(4);
      }

      const inIntro = !still && now - state.mountedAt < RIPPLE_INTRO_MS;
      const fieldBusy = Boolean(state.field && typeof state.field.busy === 'function' && state.field.busy());
      const needsRender =
        forceSingleDraw ||
        !drawnOnce ||
        inTideSwell ||
        inIntro ||
        auraState.active ||
        (state.field && state.field.needsDraw(now, still));

      if (canvas.width > 0 && needsRender) {
        forceSingleDraw = false;
        const pal = readRipplePalette(canvas, auraState, now, cachedCanvasStyle);
        if (state.glow && typeof state.glow.draw === 'function') {
          state.glow.draw(now, {
            dark: pal.dark,
            still,
            strength: inTideSwell ? state.aura.strength * pal.prismStrength : pal.prismStrength,
            reach: state.aura.reach,
            prismStrength: pal.prismStrength,
          });
        }
        state.field.draw(now, pal, still);
        drawnOnce = true;
      }

      if (destroyed || document.hidden || still) {
        enterIdleSleep();
        return;
      }
      if (inTideSwell || fieldBusy) {
        wake();
      } else if (inIntro || auraState.active) {
        // 入场前 1.6s 或鼠标光晕悬停在首页时以温和节拍刷新；一旦离开且波纹平息则进入 0fps 静止真休眠！
        state.sleeping = false;
        state.timer = setTimeout(wake, 42);
      } else {
        enterIdleSleep();
      }
    }
    state.wake = wake;

    state.onMove = (ev) => {
      if (motionReduced()) return;
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
        lastSkimX = null;
        lastSkimY = null;
        skimCarryDist = 0;
        if (auraState.active) {
          auraState.active = false;
          forceSingleDraw = true;
          state.field.invalidate();
          wake();
        }
        return;
      }
      const now = performance.now();
      if (lastSkimX !== null && lastSkimY !== null) {
        const stepDist = Math.hypot(x - lastSkimX, y - lastSkimY);
        const dtSec = Math.max(0.004, (now - lastSkimAt) / 1000);
        const pxPerSec = stepDist / dtSec;
        if (pxPerSec >= 220) {
          skimCarryDist += stepDist;
          if (skimCarryDist >= 42) {
            skimCarryDist = Math.min(20, skimCarryDist - 42);
            const speedNorm = Math.max(0.05, Math.min(1, (pxPerSec - 220) / 1800));
            const col = Math.floor(x / rippleCore.RIPPLE.cellWidth);
            const row = Math.floor(y / rippleCore.RIPPLE.cellHeight);
            if (typeof state.waves.skimmer === 'function') {
              state.waves.skimmer(col, row, speedNorm);
            }
          }
        } else {
          skimCarryDist *= 0.85;
        }
      }
      lastSkimX = x;
      lastSkimY = y;
      lastSkimAt = now;
      auraState.x = x;
      auraState.y = y;
      auraState.active = true;
      previous = now;
      state.field.invalidate();
      wake();
    };

    state.onLeave = () => {
      lastSkimX = null;
      lastSkimY = null;
      skimCarryDist = 0;
      if (auraState.active) {
        auraState.active = false;
        forceSingleDraw = true;
        state.field.invalidate();
        wake();
      }
    };

    state.onPress = (ev) => {
      if (ev.button !== 0 || motionReduced()) return;
      const rect = canvas.getBoundingClientRect();
      const col = Math.floor((ev.clientX - rect.left) / rippleCore.RIPPLE.cellWidth);
      const row = Math.floor((ev.clientY - rect.top) / rippleCore.RIPPLE.cellHeight);
      previous = performance.now();
      state.waves.disturb(col, row);
      state.field.invalidate();
      wake();
      if (mascotState.rig && mascotState.root && typeof mascotState.rig.notify === 'function') {
        try {
          const mr = mascotState.root.getBoundingClientRect();
          mascotState.rig.notify('ripple', { x: ev.clientX - mr.left });
        } catch {}
      }
    };
    home.addEventListener('pointerdown', state.onPress, { passive: true });
    home.addEventListener('pointermove', state.onMove, { passive: true });
    home.addEventListener('pointerleave', state.onLeave, { passive: true });

    state.onVis = () => {
      if (!document.hidden) {
        previous = performance.now();
        forceSingleDraw = true;
        wake();
      } else {
        if (state.rafId) cancelAnimationFrame(state.rafId);
        state.rafId = 0;
        frameWanted = false;
        enterIdleSleep();
      }
    };
    document.addEventListener('visibilitychange', state.onVis);

    if (typeof ResizeObserver === 'function') {
      state.ro = new ResizeObserver(() => {
        layout();
        wake();
      });
      state.ro.observe(home);
    }
    rippleMount = state;
    layout();
    state.refreshTheme = () => {
      cachedCanvasStyle = typeof getComputedStyle === 'function' ? getComputedStyle(canvas) : null;
      forceSingleDraw = true;
      state.field.invalidate();
      if (state.glow && typeof state.glow.invalidate === 'function') state.glow.invalidate();
      if (document.hidden && canvas.width > 0) drawFrame(performance.now());
      else wake();
    };
    wake();
  }

  // ── 4-State Conversation Horizon Aura (Delegated to conv-aura.js) ──────
  const convAuraCtl = convAuraMod?.createConvAuraController
    ? convAuraMod.createConvAuraController({
        isDestroyed: () => destroyed,
        isHomeRippleEnabled: () => cfg.homeRipple !== false,
        isMotionStandardOrUltra,
        isDarkTheme,
        rippleCore,
        setAttrIfChanged,
        runGuardedMut,
      })
    : {
        sync() {},
        unmount() {},
        triggerStart() {},
        triggerLiftoffEbb() {},
        advancePhase: () => 'off',
        refreshTheme() {},
        getInstance: () => null,
      };

  function isConvRunning() {
    if (convAuraMod && typeof convAuraMod.isConvRunning === "function") return convAuraMod.isConvRunning();
    return false;
  }
  function syncConvAura() { convAuraCtl.sync(); }
  function unmountConvAura() { convAuraCtl.unmount(); }
  function triggerConvAuraStart() { convAuraCtl.triggerStart(); }

  // ── Official Brand Optical Glyph & Model Parser ────────────────────────
  function readButtonLabelWithoutGlyph(el) {
    if (!el) return '';
    const parts = [];
    const collect = (node) => {
      if (!node) return;
      if (node.nodeType === 3) {
        parts.push(node.nodeValue || '');
        return;
      }
      if (node.classList && node.classList.contains('ag-cs-model-glyph')) return;
      if (node.childNodes && node.childNodes.length > 0) {
        for (const cn of node.childNodes) collect(cn);
        return;
      }
      if (node.children && node.children.length > 0) {
        let nonGlyph = 0;
        for (const ch of node.children) {
          if (ch.classList && ch.classList.contains('ag-cs-model-glyph')) continue;
          nonGlyph++;
          collect(ch);
        }
        if (nonGlyph === 0 && typeof node._text === 'string' && node._text) {
          parts.push(node._text);
        }
        return;
      }
      parts.push(node.textContent || '');
    };
    collect(el);
    const aria = el.getAttribute?.('aria-label') || '';
    if (aria) parts.push(aria);
    return parts.join(' ').trim();
  }

  function parseModelLabelInfo(rawText) {
    const raw = String(rawText || '').toLowerCase();
    let brand = 'gemini';
    let isOrchestrator = false;
    if (/\borchestrator\b|编排/.test(raw)) {
      brand = 'antigravity';
      isOrchestrator = true;
    } else if (/\bclaude\b|\banthropic\b|\bsonnet\b|\bopus\b|\bhaiku\b/.test(raw)) {
      brand = 'claude';
    } else if (/\bgpt\b|\bopenai\b|\bo1\b|\bo3\b|\bo4\b|\bcodex\b|\bdeepseek\b/.test(raw)) {
      brand = 'openai';
    } else if (/\bantigravity\b/.test(raw) && !/\bgemini\b|\bargon\b|\bcarbon\b|\bhydrogen\b|\bflash\b/.test(raw)) {
      brand = 'antigravity';
    }

    let tier = 'medium';
    if (isOrchestrator) {
      tier = 'auto';
    } else if (/\bgpt-oss\b|\bfixed\b|固定/.test(raw)) {
      tier = 'fixed';
    } else if (/\bxhigh\b|\bextra\b|超深|极高/.test(raw)) {
      tier = 'xhigh';
    } else if (/\bhigh\b|\bmax\b|\bthinking\b|高/.test(raw)) {
      tier = 'high';
    } else if (/\blow\b|\blite\b|\bminimal\b|低/.test(raw)) {
      tier = 'low';
    } else if (/\bmedium\b|\bmed\b|中/.test(raw)) {
      tier = 'medium';
    }
    return { brand, tier, isOrchestrator, camp: brand === 'claude' ? 'claude' : 'gemini' };
  }

  function parseModelTriggerInfo(btn) {
    return parseModelLabelInfo(readButtonLabelWithoutGlyph(btn));
  }

  function renderSparkSvg(size = 16, tier = 'auto', monochrome = false, className = '') {
    if (animatedIcons && typeof animatedIcons.renderGoogleSparkOrbitSvg === 'function') {
      const svg = animatedIcons.renderGoogleSparkOrbitSvg({ size, tier, monochrome, className });
      if (svg) return svg;
    }
    const cls = className ? ` class="${className}"` : '';
    const fill = monochrome ? 'currentColor' : '#669DF6';
    return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 1.2c.25 0 .47.17.53.41c.21.79.48 1.56.8 2.31c1.23 2.86 3.39 5.02 6.25 6.25c.75.32 1.52.59 2.31.8c.24.06.41.28.41.53s-.17.47-.41.53a16 16 0 0 0-2.31.8c-2.86 1.23-5.02 3.39-6.25 6.25c-.32.75-.59 1.52-.8 2.31a.55.55 0 0 1-.53.41a.55.55 0 0 1-.53-.41a16 16 0 0 0-.8-2.31c-1.23-2.86-3.39-5.02-6.25-6.25a16 16 0 0 0-2.31-.8A.55.55 0 0 1 1.2 12c0-.25.17-.47.41-.53c.79-.21 1.56-.48 2.31-.8c2.86-1.23 5.02-3.39 6.25-6.25c.32-.75.59-1.52.8-2.31c.06-.24.28-.41.53-.41Z" fill="${fill}"/></svg>`;
  }

  function buildBrandMarkSvg(brand, size = 14, tier = 'auto', monochrome = false) {
    if (brand === 'antigravity') return renderSparkSvg(size, tier, monochrome, '');
    const d = BRAND_PATHS[brand] || BRAND_PATHS.gemini;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="${d}" fill="currentColor" fill-rule="evenodd"/></svg>`;
  }

  function buildModelGlyphInnerSvg(brand, tier) {
    if (brand === 'antigravity') {
      return renderSparkSvg(16, tier || 'auto', false, 'ag-cs-model-glyph-svg');
    }
    const d = BRAND_PATHS[brand] || BRAND_PATHS.gemini;
    const coreR = brand === 'gemini' ? '2.7' : '2.1';
    const fixedLock =
      tier === 'fixed'
        ? '<g class="ag-cs-glyph-lock"><rect x="15.2" y="16.2" width="8.6" height="6.8" rx="1.6"/><path d="M17.3 16.2v-1.7a2.2 2.2 0 1 1 4.4 0v1.7" fill="none" stroke-width="1.5"/></g>'
        : '';
    return (
      '<svg class="ag-cs-model-glyph-svg" width="16" height="16" viewBox="-4 -4 32 32" fill="none" aria-hidden="true">' +
      '<g class="ag-cs-glyph-orbit-group">' +
      '<ellipse class="ag-cs-glyph-orbit" cx="12" cy="12" rx="14.5" ry="6.2" transform="rotate(-24 12 12)"/>' +
      '<circle class="ag-cs-glyph-sat is-a" cx="25.2" cy="6.1" r="1.65"/>' +
      '<circle class="ag-cs-glyph-sat is-b" cx="-1.2" cy="17.9" r="1.25"/>' +
      '</g>' +
      `<path class="ag-cs-glyph-body" d="${d}" fill-rule="evenodd"/>` +
      `<circle class="ag-cs-glyph-core" cx="12" cy="12" r="${coreR}"/>` +
      fixedLock +
      '</svg>'
    );
  }

  function syncModelGlyphOnButton(modelBtn) {
    if (!modelBtn) return null;
    modelBtn.querySelectorAll('.ag-cs-effort-badge, [data-ag-cs-effort]').forEach((el) => {
      el.removeAttribute('data-ag-cs-effort');
      el.classList.remove('ag-cs-effort-badge');
    });

    const info = parseModelTriggerInfo(modelBtn);
    if (cfg.composerRestyle === false) {
      modelBtn.querySelectorAll('.ag-cs-model-glyph').forEach((n) => n.remove());
      return info;
    }

    let glyph = modelBtn.querySelector('.ag-cs-model-glyph');
    let created = false;
    if (!glyph) {
      glyph = document.createElement('span');
      glyph.className = 'ag-cs-model-glyph';
      glyph.setAttribute('data-icon', '1');
      glyph.setAttribute('aria-hidden', 'true');
      glyph.setAttribute('data-ag-no-i18n', '');
      created = true;
    }
    if (modelBtn.firstChild !== glyph) {
      modelBtn.insertBefore(glyph, modelBtn.firstChild);
    }
    const prevBrand = glyph.getAttribute('data-brand');
    const prevTier = glyph.getAttribute('data-tier');
    if (created || prevBrand !== info.brand || prevTier !== info.tier) {
      glyph.setAttribute('data-brand', info.brand);
      glyph.setAttribute('data-tier', info.tier);
      glyph.innerHTML = buildModelGlyphInnerSvg(info.brand, info.tier);
      if (!created && !motionReduced() && typeof requestAnimationFrame === 'function') {
        glyph.classList.remove('is-pulsing');
        requestAnimationFrame(() => {
          if (glyph.isConnected) glyph.classList.add('is-pulsing');
        });
      }
    }
    return info;
  }

  // ── Lightweight Active Status & Official Dual Mascot Stage ─────────────
  function getLightweightActiveInfo(card) {
    if (!card) return null;
    const inputBox = card.closest?.('[data-testid="agent-input-box"]');
    const inConvo = Boolean(card.closest?.('[data-testid="conversation-view"]'));
    const cascadeId = inConvo ? resolveCascadeId(inputBox) : '';
    const cancelBtn = Boolean(card.querySelector?.('[data-testid="input-cancel-button"]'));
    let isRunning = cancelBtn;
    let isThinking = false;
    let hasError = false;
    if (cascadeId) {
      const h = ensureHooks(true);
      const st = h?.store?.getState?.();
      const sums = st?.trajectorySummaries?.summaries || st?.cascadeTrajectorySummaries || {};
      const entry = sums[cascadeId];
      const sum = entry?.summary || entry || {};
      if (sum.notFullyIdle || sum.hasActivity || sum.status === 2 || sum.hasRunningSubagents) isRunning = true;
      if (sum.status === 3 || sum.hasError) hasError = true;
    }
    const cv = card.closest?.('[data-testid="conversation-view"]');
    if (cv && isRunning) {
      const thinkingEl = cv.querySelector?.('[data-testid="thinking-collapsible-trigger"], [data-testid="worked-for-collapsible"]');
      if (thinkingEl && String(thinkingEl.textContent || '').includes('...')) isThinking = true;
    }
    return { cascadeId, isRunning, isThinking, hasError };
  }

  let mascotState = {
    root: null,
    rig: null,
    anchor: null,
    lastOrch: null,
    lastActivityAt: 0,
  };

  function canMountRealCanvas(node) {
    try {
      const doc = node?.ownerDocument;
      if (!doc || typeof doc.createElement !== 'function') return false;
      const cv = doc.createElement('canvas');
      return Boolean(cv && cv.dataset && typeof cv.getContext === 'function' && cv.getContext('2d'));
    } catch {
      return false;
    }
  }

  function unmountCrab() {
    if (mascotState.rig && typeof mascotState.rig.dispose === 'function') {
      try {
        mascotState.rig.dispose();
      } catch {}
    }
    if (mascotState.root && mascotState.root.parentElement) {
      mascotState.root.parentElement.removeChild(mascotState.root);
    }
    if (mascotState.anchor) mascotState.anchor.removeAttribute('data-ag-cs-crab-anchor');
    if (document.documentElement?.hasAttribute('data-ag-cs-has-crab')) {
      document.documentElement.removeAttribute('data-ag-cs-has-crab');
    }
    mascotState.root = null;
    mascotState.rig = null;
    mascotState.anchor = null;
    mascotState.lastOrch = null;
  }

  function syncCrab(activeCard, activeInfo, modelInfo) {
    const enabled = isMascotEnabled();
    if (!enabled) {
      unmountCrab();
      return;
    }
    if (!activeCard) {
      // Transient route switch: detach stage from stale anchor without disposing rig/chroma progress!
      if (mascotState.root && mascotState.root.parentElement) {
        mascotState.root.parentElement.removeChild(mascotState.root);
      }
      if (mascotState.anchor) {
        mascotState.anchor.removeAttribute('data-ag-cs-crab-anchor');
        mascotState.anchor = null;
      }
      if (document.documentElement?.hasAttribute('data-ag-cs-has-crab')) {
        document.documentElement.removeAttribute('data-ag-cs-has-crab');
      }
      return;
    }
    if (!mascotState.root) {
      const stage = document.createElement('div');
      stage.className = 'ag-cs-crab ag-cs-dual-stage';
      stage.setAttribute('data-mascot-stage', 'true');
      stage.setAttribute('aria-hidden', 'true');
      stage.setAttribute('data-ag-no-i18n', '');
      mascotState.root = stage;
    }
    if (mascotState.root.parentElement !== activeCard) {
      if (mascotState.anchor) mascotState.anchor.removeAttribute('data-ag-cs-crab-anchor');
      activeCard.setAttribute('data-ag-cs-crab-anchor', 'composer');
      activeCard.appendChild(mascotState.root);
      mascotState.anchor = activeCard;
    }
    if (document.documentElement) {
      setAttrIfChanged(document.documentElement, 'data-ag-cs-has-crab', '1');
    }

    const camp = modelInfo?.camp || 'gemini';
    const isOrch = Boolean(modelInfo?.isOrchestrator);
    const streamTier = modelInfo?.tier === 'xhigh' || isOrch ? 3 : 2;
    const nextState = {
      camp,
      streaming: Boolean(activeInfo?.isRunning),
      streamTier,
      hasError: Boolean(activeInfo?.hasError),
      yieldMode: 'none',
      leapOffsetY: 0,
      popoverRightWidth: 0,
      miniPileEnabled: cfg.mascot === 'minis',
      orchestrator: isOrch,
    };

    const mountFn = dualMascotRig && (dualMascotRig.mountDualMascotStage || dualMascotRig.createDualMascotRig);
    if (!mascotState.rig && mountFn && canMountRealCanvas(mascotState.root)) {
      try {
        mascotState.rig = mountFn(mascotState.root, nextState);
      } catch {
        mascotState.rig = null;
      }
    } else if (mascotState.rig && typeof mascotState.rig.setState === 'function') {
      try {
        mascotState.rig.setState(nextState);
      } catch {}
    }

    if (mascotState.lastOrch !== null && mascotState.lastOrch !== isOrch && mascotState.rig && typeof mascotState.rig.notify === 'function') {
      try {
        mascotState.rig.notify('orchestrator', { on: isOrch });
      } catch {}
    }
    mascotState.lastOrch = isOrch;
  }

  // ── Orchestrator Cut Crystal Prism Bar in [data-testid="model-selector-panel"] ──
  let crystalMount = {
    panel: null,
    bar: null,
    track: null,
    canvas: null,
    inst: null,
    rafId: 0,
    lastStepMs: 0,
    wasOrch: false,
  };

  const PANEL_MODEL_ROW_RE = /orchestrator|编排|gemini|claude|sonnet|opus|haiku|gpt|openai|\bo[134]\b|deepseek/i;

  function buildPanelRowGlyphSvg(brand, tier, isSelected) {
    if (brand === 'antigravity') {
      return renderSparkSvg(15, isSelected ? tier || 'auto' : 'low', !isSelected, 'ag-cs-model-glyph-svg');
    }
    const d = BRAND_PATHS[brand] || BRAND_PATHS.gemini;
    const fillAttr = isSelected
      ? 'style="fill:var(--glyph-color-hi);fill-opacity:1"'
      : 'fill="currentColor" fill-opacity="0.72"';
    return `<svg class="ag-cs-model-glyph-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="${d}" ${fillAttr} fill-rule="evenodd"/></svg>`;
  }

  function clearPanelRowGlyphs(root = document) {
    root?.querySelectorAll?.('.ag-cs-panel-row-glyph').forEach((n) => n.remove());
  }

  function isPanelRowSelected(row) {
    if (!row) return false;
    if (
      row.getAttribute?.('data-selected') === 'true' ||
      row.getAttribute?.('aria-checked') === 'true' ||
      row.getAttribute?.('data-state') === 'checked'
    ) {
      return true;
    }
    if (row.hasAttribute?.('data-ces-model-selected')) {
      return row.getAttribute('data-ces-model-selected') === 'true';
    }
    return Boolean(
      row.classList?.contains?.('text-foreground') &&
        !row.classList?.contains?.('text-secondary-foreground')
    );
  }

  function syncPanelRowGlyphs(panel) {
    if (!panel) return;
    const rows = panel.querySelectorAll('[role="menuitem"], [role="option"], button');
    for (const row of rows) {
      if (row.closest?.('.ces-ag-section, [data-testid="orchestrator-effort-bar"]')) continue;
      if (row.parentElement?.closest?.('[role="menuitem"], [role="option"], button')) continue;
      const label = readButtonLabelWithoutGlyph(row);
      if (!PANEL_MODEL_ROW_RE.test(label)) {
        clearPanelRowGlyphs(row);
        continue;
      }
      const info = parseModelLabelInfo(label);
      const isSelected = isPanelRowSelected(row);

      let firstChildEl = null;
      if (row.children) {
        for (const ch of row.children) {
          if (ch.classList && ch.classList.contains('ag-cs-model-glyph')) continue;
          firstChildEl = ch;
          break;
        }
      }
      const targetParent =
        firstChildEl &&
        (firstChildEl.querySelector?.('[data-testid="model-selector-effort-group"]') ||
          /\bflex\b|\bitems-center\b/.test(String(firstChildEl.className || '')))
          ? firstChildEl
          : row;

      let glyph = row.querySelector('.ag-cs-panel-row-glyph');
      let created = false;
      if (!glyph) {
        glyph = document.createElement('span');
        glyph.className = 'ag-cs-model-glyph ag-cs-panel-row-glyph';
        glyph.setAttribute('data-ag-no-i18n', '');
        glyph.setAttribute('aria-hidden', 'true');
        created = true;
      }
      if (glyph.parentElement !== targetParent || targetParent.firstChild !== glyph) {
        targetParent.insertBefore(glyph, targetParent.firstChild);
      }

      const selStr = isSelected ? 'true' : 'false';
      if (
        created ||
        glyph.getAttribute('data-brand') !== info.brand ||
        glyph.getAttribute('data-tier') !== info.tier ||
        glyph.getAttribute('data-selected') !== selStr
      ) {
        glyph.setAttribute('data-brand', info.brand);
        glyph.setAttribute('data-tier', info.tier);
        glyph.setAttribute('data-selected', selStr);
        glyph.innerHTML = buildPanelRowGlyphSvg(info.brand, info.tier, isSelected);
        if (isSelected) {
          glyph.style.setProperty('opacity', '1');
          if (info.brand === 'openai') glyph.style.setProperty('filter', 'none');
          else glyph.style.setProperty('filter', 'drop-shadow(0 0 3px var(--glyph-glow))');
        } else {
          glyph.style.setProperty('filter', 'none');
          glyph.style.setProperty('opacity', '0.78');
        }
      }
    }
  }

  function teardownCrystalMount() {
    if (crystalMount.rafId) {
      cancelAnimationFrame(crystalMount.rafId);
      crystalMount.rafId = 0;
    }
    if (crystalMount.inst && typeof crystalMount.inst.dispose === 'function') {
      try {
        crystalMount.inst.dispose();
      } catch {}
    }
    if (crystalMount.panel && crystalMount.panel.isConnected) {
      clearPanelRowGlyphs(crystalMount.panel);
      crystalMount.panel.removeAttribute('data-ag-cs-orch-active');
      crystalMount.panel
        .querySelectorAll('.ces-ag-effort-row:not([data-testid="orchestrator-effort-bar"])')
        .forEach((row) => {
          row.removeAttribute('data-row-hidden');
          row.removeAttribute('aria-hidden');
        });
    }
    clearPanelRowGlyphs();
    if (crystalMount.bar && crystalMount.bar.parentElement) {
      crystalMount.bar.remove();
    }
    crystalMount = { panel: null, bar: null, track: null, canvas: null, inst: null, rafId: 0, lastStepMs: 0, wasOrch: false };
  }

  function detectPanelIsOrchestrator(panel, fallbackModelInfo) {
    if (fallbackModelInfo && typeof fallbackModelInfo.isOrchestrator === 'boolean') {
      return fallbackModelInfo.isOrchestrator;
    }
    if (panel) {
      let sel = panel.querySelector(
        '[data-selected="true"], [aria-checked="true"], [data-state="checked"], [data-ces-model-selected="true"]'
      );
      if (!sel) {
        for (const r of panel.querySelectorAll('[role="menuitem"], [role="option"], button')) {
          if (isPanelRowSelected(r)) {
            sel = r;
            break;
          }
        }
      }
      if (sel) {
        const txt = readButtonLabelWithoutGlyph(sel);
        return /\borchestrator\b|编排/i.test(txt);
      }
    }
    return false;
  }

  function stepCrystalLoop(now) {
    crystalMount.rafId = 0;
    if (destroyed || !crystalMount.inst || !crystalMount.panel || !crystalMount.panel.isConnected || !crystalMount.wasOrch) {
      return;
    }
    const dt = crystalMount.lastStepMs > 0 ? Math.min(0.05, Math.max(0.004, (now - crystalMount.lastStepMs) / 1000)) : 0.016;
    crystalMount.lastStepMs = now;
    try {
      crystalMount.inst.step(dt);
    } catch {}
    if (!motionReduced() && !document.hidden) {
      crystalMount.rafId = requestAnimationFrame(stepCrystalLoop);
    }
  }

  function syncModelSelectorPanel(primaryModelInfo) {
    if (cfg.composerRestyle === false) {
      clearPanelRowGlyphs();
      if (crystalMount.panel || crystalMount.bar) teardownCrystalMount();
      return;
    }
    const panel = document.querySelector('[data-testid="model-selector-panel"]');
    if (!panel) {
      clearPanelRowGlyphs();
      if (crystalMount.panel || crystalMount.bar) teardownCrystalMount();
      return;
    }
    if (crystalMount.panel && crystalMount.panel !== panel) {
      teardownCrystalMount();
    }

    const isOrch = detectPanelIsOrchestrator(panel, primaryModelInfo);
    syncPanelRowGlyphs(panel);
    const cesSec = panel.querySelector('.ces-ag-section');
    if (cesSec && cesSec.getAttribute('data-effort-slot') !== 'true') {
      cesSec.setAttribute('data-effort-slot', 'true');
    }
    const slot = cesSec || panel;

    let bar = panel.querySelector('[data-testid="orchestrator-effort-bar"]');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'ces-ag-effort-row ag-cs-orch-row';
      bar.setAttribute('data-testid', 'orchestrator-effort-bar');
      bar.setAttribute('data-ag-no-i18n', '');

      const head = document.createElement('div');
      head.className = 'ces-ag-effort-head ag-cs-orch-head';
      const title = document.createElement('span');
      title.className = 'ces-ag-effort-title';
      title.textContent = isZh() ? '推理等级' : 'Reasoning Effort';
      const val = document.createElement('span');
      val.className = 'ces-ag-effort-value ag-cs-orch-value';
      val.textContent = 'Auto';
      head.appendChild(title);
      head.appendChild(val);

      const inline = document.createElement('div');
      inline.className = 'ces-inline';
      const track = document.createElement('div');
      track.className = 'ag-cs-orch-track';
      track.setAttribute('role', 'status');
      track.setAttribute('aria-label', 'Orchestrator Auto');
      const cv = document.createElement('canvas');
      cv.className = 'ag-cs-orch-canvas';
      cv.setAttribute('data-orch-crystal-canvas', 'true');
      cv.setAttribute('aria-hidden', 'true');
      track.appendChild(cv);
      inline.appendChild(track);

      bar.appendChild(head);
      bar.appendChild(inline);
      slot.appendChild(bar);
    } else if (bar.parentElement !== slot) {
      slot.appendChild(bar);
    }

    crystalMount.panel = panel;
    crystalMount.bar = bar;
    crystalMount.track = bar.querySelector('.ag-cs-orch-track');
    crystalMount.canvas = bar.querySelector('canvas[data-orch-crystal-canvas="true"]');

    if (isOrch) setAttrIfChanged(panel, 'data-ag-cs-orch-active', '1');
    else if (panel.hasAttribute('data-ag-cs-orch-active')) panel.removeAttribute('data-ag-cs-orch-active');

    panel
      .querySelectorAll('.ces-ag-effort-row:not([data-testid="orchestrator-effort-bar"])')
      .forEach((row) => {
        setAttrIfChanged(row, 'data-row-hidden', String(isOrch));
        setAttrIfChanged(row, 'aria-hidden', String(isOrch));
      });

    const switchedIn = isOrch && !crystalMount.wasOrch;
    crystalMount.wasOrch = isOrch;
    setAttrIfChanged(bar, 'data-row-hidden', String(!isOrch));
    setAttrIfChanged(bar, 'aria-hidden', String(!isOrch));

    if (isOrch) {
      if (
        !crystalMount.inst &&
        crystalMount.canvas &&
        crystalPrismCore &&
        typeof crystalPrismCore.mountCrystalPrismBar === 'function' &&
        canMountRealCanvas(crystalMount.canvas)
      ) {
        try {
          crystalMount.inst = crystalPrismCore.mountCrystalPrismBar(crystalMount.canvas, {
            reduceMotion: motionReduced(),
            getState: () => ({ isDark: isDarkTheme(), prismStrength: 1 }),
          });
        } catch {
          crystalMount.inst = null;
        }
      }
      if (crystalMount.inst) {
        if (lastPointerPos.x > -1000) {
          crystalMount.inst.setPointerClient(lastPointerPos.x, lastPointerPos.y);
        }
        if (switchedIn && typeof crystalMount.inst.wake === 'function') {
          crystalMount.inst.wake();
        }
        try {
          crystalMount.inst.step(0.016);
        } catch {}
        if (!crystalMount.rafId && !motionReduced()) {
          crystalMount.lastStepMs = performance.now();
          crystalMount.rafId = requestAnimationFrame(stepCrystalLoop);
        }
      }
    } else if (crystalMount.rafId) {
      cancelAnimationFrame(crystalMount.rafId);
      crystalMount.rafId = 0;
    }
  }

  // ── Living Thinking Spark on [data-testid="thinking-collapsible-trigger"] ──
  function syncThinkingSparks(primaryModelInfo) {
    const triggers = document.querySelectorAll('[data-testid="thinking-collapsible-trigger"]');
    if (cfg.composerRestyle === false) {
      document.querySelectorAll('.ag-cs-thinking-spark').forEach((n) => n.remove());
      triggers.forEach((t) => {
        if (t.hasAttribute('data-ag-cs-spark-streaming')) t.removeAttribute('data-ag-cs-spark-streaming');
      });
      return;
    }
    const brand = primaryModelInfo?.brand || 'gemini';
    const len = triggers.length;
    for (let i = 0; i < len; i++) {
      const trig = triggers[i];
      let spark = trig.firstElementChild?.classList?.contains('ag-cs-thinking-spark')
        ? trig.firstElementChild
        : trig.querySelector('.ag-cs-thinking-spark');
      // Fast-skip historical settled triggers in long conversations (O(1) attribute check, 0 textContent regex)
      if (
        i < len - 2 &&
        spark &&
        spark.getAttribute('data-state') === 'done' &&
        spark.getAttribute('data-brand') === brand &&
        !trig.hasAttribute('data-ag-cs-spark-streaming')
      ) {
        continue;
      }
      const txt = String(trig.textContent || '');
      const st = /\.\.\.|…|正在|思考中|thinking/i.test(txt) ? 'streaming' : 'done';
      if (st === 'streaming') {
        setAttrIfChanged(trig, 'data-ag-cs-spark-streaming', '1');
      } else if (trig.hasAttribute('data-ag-cs-spark-streaming')) {
        trig.removeAttribute('data-ag-cs-spark-streaming');
      }
      if (!spark) {
        spark = document.createElement('span');
        spark.className = 'ag-cs-thinking-spark';
        spark.setAttribute('aria-hidden', 'true');
        spark.setAttribute('data-ag-no-i18n', '');
        trig.insertBefore(spark, trig.firstChild);
      }
      if (spark.getAttribute('data-brand') !== brand || spark.getAttribute('data-state') !== st) {
        spark.setAttribute('data-brand', brand);
        spark.setAttribute('data-state', st);
        spark.innerHTML = buildBrandMarkSvg(brand, 13, 'auto', false);
      }
    }
  }

  // ── Smart Two-Tier Auto-Unfold on [data-testid="worked-for-collapsible"] ──
  let workedForClickTimer = 0;

  function clearWorkedForAutoUnfoldAttrs() {
    document.querySelectorAll('[data-ag-cs-auto-unfolded]').forEach((el) => el.removeAttribute('data-ag-cs-auto-unfolded'));
    document.querySelectorAll('[data-ag-cs-outer-open]').forEach((el) => el.removeAttribute('data-ag-cs-outer-open'));
  }

  function syncWorkedForAutoUnfold() {
    if (destroyed || cfg.composerRestyle === false) {
      clearWorkedForAutoUnfoldAttrs();
      return;
    }
    const outers = document.querySelectorAll('[data-testid="worked-for-collapsible"]');
    for (const btn of outers) {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      let scope = btn.nextElementSibling;
      if (!scope) {
        let sib = btn.nextSibling;
        while (sib && sib.nodeType && sib.nodeType !== 1) sib = sib.nextSibling;
        scope = sib || null;
      }
      if (!scope) scope = btn.parentElement;
      const innerBtns = scope
        ? scope.querySelectorAll('[data-testid="tool-group-collapsible"]')
        : [];
      if (expanded) {
        setAttrIfChanged(btn, 'data-ag-cs-outer-open', '1');
        for (const childBtn of innerBtns) {
          if (childBtn === btn) continue;
          if (childBtn.getAttribute('data-ag-cs-auto-unfolded') !== '1') {
            childBtn.setAttribute('data-ag-cs-auto-unfolded', '1');
            if (childBtn.getAttribute('aria-expanded') === 'false' && typeof childBtn.click === 'function') {
              try {
                childBtn.click();
              } catch {}
            }
          }
        }
      } else if (btn.getAttribute('data-ag-cs-outer-open') === '1') {
        btn.removeAttribute('data-ag-cs-outer-open');
        for (const childBtn of innerBtns) {
          childBtn.removeAttribute('data-ag-cs-auto-unfolded');
        }
        if (btn.parentElement && btn.parentElement !== scope) {
          btn.parentElement
            .querySelectorAll('[data-ag-cs-auto-unfolded]')
            .forEach((el) => el.removeAttribute('data-ag-cs-auto-unfolded'));
        }
      }
    }
  }

  // ── FastDOM Smooth Typing Caret (Delegated to smooth-caret.js) ─────────
  const smoothCaretCtl = smoothCaretMod?.createSmoothCaretController
    ? smoothCaretMod.createSmoothCaretController({
        isDestroyed: () => destroyed,
        isEnabled: () => cfg.smoothCaret !== false,
        setAttrIfChanged,
        runGuardedMut,
      })
    : {
        teardown() {},
        bumpMetricsEpoch() {},
        measureSnapshot: () => null,
        applyMutations() {},
        sync() {},
        queue() {},
      };

  function teardownSmoothCarets() { smoothCaretCtl.teardown(); }
  function measureSmoothCaretsSnapshot(refreshMetrics = false) { return smoothCaretCtl.measureSnapshot(refreshMetrics); }
  function applySmoothCaretsMutations(snapshotList, isTypingEvent = false) { smoothCaretCtl.applyMutations(snapshotList, isTypingEvent); }
  function syncSmoothCaret(isTypingEvent = false, refreshMetrics = false) { smoothCaretCtl.sync(isTypingEvent, refreshMetrics); }
  function queueSmoothCaret(isTyping = false, immediate = false, refreshMetrics = false) { smoothCaretCtl.queue(isTyping, immediate, refreshMetrics); }

  // ── Composer Prism Box, Placeholder, Glyph & Mascot Clearance ──────────
  function setCrabClearanceAttr(el, attrName, active) {
    if (!el) return;
    if (active) {
      if (el.getAttribute(attrName) !== '1') el.setAttribute(attrName, '1');
      if (el.style.getPropertyValue('margin-bottom') !== '46px') {
        el.style.setProperty('margin-bottom', '46px', 'important');
      }
    } else if (el.hasAttribute(attrName)) {
      el.removeAttribute(attrName);
      el.style.removeProperty('margin-bottom');
    }
  }

  function syncCrabClearance(card, inputBox, active) {
    if (!inputBox) return;
    const composerShell = card.closest('#antigravity\\.agentSidePanelInputBox') || card.parentElement;
    let hasLowerClearance = false;

    if (composerShell) {
      for (const ch of Array.from(composerShell.children)) {
        if (ch === card) break;
        const panel =
          ch.getAttribute?.('data-testid') === 'running-items-panel'
            ? ch
            : ch.querySelector?.('[data-testid="running-items-panel"]');
        const isActivePanel = Boolean(panel && String(panel.className || '').includes('grid-rows-[1fr]'));
        const shouldClear = active && isActivePanel && !hasLowerClearance;
        setCrabClearanceAttr(ch, 'data-ag-cs-queued', shouldClear);
        if (shouldClear) hasLowerClearance = true;
      }
    }

    const ibChildren = Array.from(inputBox.children);
    const shellIdx = ibChildren.indexOf(composerShell);
    const beforeShell = shellIdx >= 0 ? ibChildren.slice(0, shellIdx) : ibChildren;
    for (let i = beforeShell.length - 1; i >= 0; i--) {
      const ch = beforeShell[i];
      if (ch.classList && (ch.classList.contains('ag-cs-hud-top-bar') || ch.classList.contains('ag-cs-hud-bottom-bar'))) {
        continue;
      }
      const hasQueued = ch.childElementCount > 0 || (ch.textContent || '').trim().length > 0;
      const shouldClear = active && hasQueued && !hasLowerClearance;
      setCrabClearanceAttr(ch, 'data-ag-cs-queued', shouldClear);
      if (shouldClear) hasLowerClearance = true;
    }

    const inputSlot =
      inputBox.parentElement &&
      inputBox.parentElement.classList &&
      inputBox.parentElement.classList.contains('contents')
        ? inputBox.parentElement
        : inputBox;
    const hostWrap = inputSlot.parentElement;
    if (hostWrap) {
      const siblings = Array.from(hostWrap.children);
      const slotIdx = siblings.indexOf(inputSlot);
      for (let i = slotIdx - 1; i >= 0; i--) {
        const sib = siblings[i];
        const isTakeoverOrSideQ =
          sib.getAttribute?.('data-testid') === 'interaction-takeover-card' ||
          sib.getAttribute?.('data-testid') === 'side-question-panel' ||
          Boolean(sib.querySelector?.('[data-testid="interaction-takeover-card"], [data-testid="side-question-panel"]'));
        if (!isTakeoverOrSideQ) {
          if (sib.hasAttribute?.('data-ag-cs-takeover')) {
            setCrabClearanceAttr(sib, 'data-ag-cs-takeover', false);
          }
          continue;
        }
        const shouldClear = active && !hasLowerClearance;
        setCrabClearanceAttr(sib, 'data-ag-cs-takeover', shouldClear);
        if (shouldClear) hasLowerClearance = true;
      }
    }
  }

  let latestPrimaryModelInfo = null;

  function syncComposers(measured) {
    const cards = Array.from(document.querySelectorAll('[data-testid="agent-input-box"] .surface-composer-card'));
    const lang = getLang();
    const ui = uiText(lang);

    let primaryCard = null;
    for (const c of cards) {
      if (!c.closest('[data-testid="subagent-tab-conversation"]')) {
        primaryCard = c;
        break;
      }
    }
    if (!primaryCard && cards.length > 0) primaryCard = cards[0];

    const mascotOn = isMascotEnabled();
    let primaryModelInfo = null;

    for (const card of cards) {
      const inputBox = card.closest('[data-testid="agent-input-box"]');
      const isPrimary = card === primaryCard;

      if (isPrimary && cfg.composerRestyle !== false) {
        setAttrIfChanged(card, 'data-ag-cs-prism-box', '1');
      } else if (card.hasAttribute('data-ag-cs-prism-box')) {
        card.removeAttribute('data-ag-cs-prism-box');
        card.style.removeProperty('--ag-px');
        card.style.removeProperty('--ag-py');
      }

      syncCrabClearance(card, inputBox, mascotOn && isPrimary);

      const p = card.querySelector('div.relative.w-full p.pointer-events-none');
      if (p) {
        if (cfg.composerRestyle !== false && cfg.placeholderStyle === 'studio') {
          const text = ui.studioPlaceholder || 'How can I help you today?';
          setAttrIfChanged(p, 'data-ag-cs-placeholder', text);
        } else if (p.hasAttribute('data-ag-cs-placeholder')) {
          p.removeAttribute('data-ag-cs-placeholder');
        }
      }

      let didModelShift = false;
      const modelBtn = card.querySelector('[data-testid="model-selector-trigger"]');
      const mInfo = syncModelGlyphOnButton(modelBtn);
      if (isPrimary && mInfo) {
        primaryModelInfo = mInfo;
        const cleanModelLabel = readButtonLabelWithoutGlyph(modelBtn);
        if (cleanModelLabel) {
          const modelSig = `${mInfo.brand}:${cleanModelLabel}`;
          if (heroState.lastModelSig === null) {
            heroState.lastModelSig = modelSig;
          } else if (modelSig !== heroState.lastModelSig) {
            heroState.lastModelSig = modelSig;
            didModelShift = true;
            if (isMotionUltra()) {
              triggerHeroDFiberPulse(card, modelBtn, mInfo.brand);
            }
          }
        }
      }
      if (didModelShift && isPrimary) {
        heroState.pendingModelShiftNotify = true;
      }
    }

    latestPrimaryModelInfo = primaryModelInfo;
    const activeInfoForCrab = getLightweightActiveInfo(primaryCard);
    syncCrab(primaryCard, activeInfoForCrab, primaryModelInfo);
    if (heroState.pendingModelShiftNotify) {
      heroState.pendingModelShiftNotify = false;
      try {
        mascotState.rig?.notify?.('model-shift');
      } catch {}
    }
    syncModelSelectorPanel(primaryModelInfo);
    syncThinkingSparks(primaryModelInfo);
    if (measured && 'caretList' in measured) {
      applySmoothCaretsMutations(measured.caretList, false);
    } else {
      syncSmoothCaret(false, false);
    }
  }

  // ── Hero A~E Transitions, Dual-Track Streaming, Lens & Host Icons ──────
  const transientTimers = new Set();
  function scheduleTransient(fn, ms) {
    const id = setTimeout(() => {
      transientTimers.delete(id);
      if (!destroyed) {
        try {
          fn();
        } catch {}
      }
    }, ms);
    transientTimers.add(id);
    return id;
  }

  function clearTransientTimers() {
    for (const id of transientTimers) clearTimeout(id);
    transientTimers.clear();
  }

  const heroState = {
    routeInitialized: false,
    wasInHome: false,
    wasInFormalConv: false,
    lastHomeComposerRect: null,
    pendingLiftoffBubbleUntil: 0,
    runTrackInitialized: false,
    wasConvRunning: false,
    runStartedAt: 0,
    lastModelSig: null,
    fiberTimer: 0,
    sidebarInitialized: false,
    sidebarIndex: -1,
    sidebarRow: null,
    sidebarRect: null,
    lastTriggerOrigin: null,
    lastGroupPress: null,
  };
  const seenChangedFileHeaders = new WeakSet();
  const seenLensOverlays = new WeakSet();
  const handledGroupClicks = new WeakSet();

  function findFormalConvView() {
    const views = document.querySelectorAll('[data-testid="conversation-view"]');
    for (const cv of views) {
      if (cv.closest?.('[data-testid="subagent-tab-conversation"]')) continue;
      if (cv.closest?.('.agy-home') || cv.querySelector?.('.agy-home')) continue;
      return cv;
    }
    return null;
  }

  function sampleHomeComposerRect() {
    const home = document.querySelector('.agy-home');
    if (!home) return null;
    const target = home.querySelector('[data-testid="agent-input-box"]') || home.querySelector('.surface-composer-card');
    if (!target || typeof target.getBoundingClientRect !== 'function') return null;
    const r = target.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) {
      heroState.lastHomeComposerRect = { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    return heroState.lastHomeComposerRect;
  }

  function triggerHomeLiftoffRippleBurst() {
    const home = document.querySelector('.agy-home');
    if (!home) return;
    const rect = sampleHomeComposerRect();
    if (!isMotionUltra() || !rippleMount || typeof rippleMount.field?.triggerLiftoffBurst !== 'function') return;
    let normX = 0.5;
    let normY = 0.62;
    const cvRect = rippleMount.canvas?.getBoundingClientRect?.();
    if (rect && cvRect && cvRect.width > 0 && cvRect.height > 0) {
      normX = Math.max(0.05, Math.min(0.95, (rect.left + rect.width * 0.5 - cvRect.left) / cvRect.width));
      normY = Math.max(0.05, Math.min(0.95, (rect.top + rect.height * 0.5 - cvRect.top) / cvRect.height));
    }
    try {
      rippleMount.field.triggerLiftoffBurst(normX, normY);
      rippleMount.field.invalidate?.();
      rippleMount.wake?.();
    } catch {}
  }

  function markFirstUserLiftoffBubble(formalConv) {
    if (!formalConv) return false;
    const bubble = formalConv.querySelector('[data-testid="user-message-bubble"]');
    if (!bubble) return false;
    bubble.setAttribute('data-ag-cs-liftoff-bubble', '1');
    scheduleTransient(() => {
      if (bubble.isConnected) bubble.removeAttribute('data-ag-cs-liftoff-bubble');
    }, 500);
    return true;
  }

  function triggerHeroALiftoff(formalConv, measuredConvInputRect = null) {
    if (!isMotionUltra() || !formalConv) return;
    const now = performance.now();

    document.querySelectorAll('.ag-cs-liftoff-veil').forEach((n) => n.remove());
    const veil = document.createElement('div');
    veil.className = 'ag-cs-liftoff-veil';
    veil.setAttribute('aria-hidden', 'true');
    veil.setAttribute('data-ag-no-i18n', '');
    const r = heroState.lastHomeComposerRect;
    const cx = r && r.width > 0 ? `${Math.round(r.left + r.width / 2)}px` : '50%';
    const cy = r && r.height > 0 ? `${Math.round(r.top + r.height / 2)}px` : '58%';
    veil.style.setProperty('--ag-lift-x', cx);
    veil.style.setProperty('--ag-lift-y', cy);
    const ring = document.createElement('div');
    ring.className = 'ag-cs-liftoff-ring';
    veil.appendChild(ring);
    if (document.body) document.body.appendChild(veil);
    scheduleTransient(() => veil.remove(), 540);

    const inputBox =
      formalConv.querySelector('[data-testid="agent-input-box"]') ||
      document.querySelector('[data-testid="agent-input-box"]');
    if (inputBox && motionEngine && typeof motionEngine.spring === 'function') {
      const nr = measuredConvInputRect || (typeof inputBox.getBoundingClientRect === 'function' ? inputBox.getBoundingClientRect() : null);
      const rawDelta = r && nr ? Math.round(r.top - nr.top) : -160;
      const deltaY = Math.max(-420, Math.min(-24, rawDelta === 0 ? -140 : rawDelta));
      try {
        motionEngine.spring(
          inputBox,
          [
            { transform: `translateY(${deltaY}px) scale(0.985)` },
            { transform: 'translateY(0) scale(1)' },
          ],
          { durationMs: 480, stiffness: 310, damping: 28, slot: 'liftoff-dock' }
        );
      } catch {}
    }

    if (!markFirstUserLiftoffBubble(formalConv)) {
      heroState.pendingLiftoffBubbleUntil = now + 900;
    } else {
      heroState.pendingLiftoffBubbleUntil = 0;
    }

    convAuraCtl.triggerLiftoffEbb(now);
  }

  function triggerHeroBHomeReturn() {
    if (!isMotionUltra()) return;
    const home = document.querySelector('.agy-home');
    if (!home) return;
    if (!rippleMount) syncRipple();
    if (rippleMount) {
      rippleMount.tideSwellAt = performance.now();
      rippleMount.aura.reach = 0.2;
      rippleMount.aura.strength = 0.32;
      try {
        rippleMount.field?.triggerTideSwell?.();
        rippleMount.field?.invalidate?.();
        rippleMount.wake?.();
      } catch {}
    }
    if (motionEngine && typeof motionEngine.stagger === 'function') {
      const items = [
        home.querySelector('[data-testid="home-greeting"]'),
        home.querySelector('.ag-cs-home-panel'),
        home.querySelector('[data-testid="agent-input-box"]'),
      ].filter(Boolean);
      if (items.length > 0) {
        try {
          motionEngine.stagger(
            items,
            [
              { opacity: 0.01, transform: 'translateY(10px)' },
              { opacity: 1, transform: 'translateY(0px)' },
            ],
            { delayStep: 35, stepMs: 35, stiffness: 340, damping: 28, slot: 'home-return' }
          );
        } catch {}
      }
    }
  }

  function measureSidebarSelectionSnapshot() {
    const rows = document.querySelectorAll('[data-testid="conversation-row-sidebar"]');
    if (!rows || rows.length === 0) return { empty: true };
    let selIdx = -1;
    let selRow = null;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-selected') === 'true') {
        selIdx = i;
        selRow = rows[i];
        break;
      }
    }
    if (!selRow) return { empty: false, selIdx: -1, selRow: null, curSnap: null, listRect: null, scrollTop: 0 };
    const listContainer = selRow.parentElement;
    const rowRect = typeof selRow.getBoundingClientRect === 'function' ? selRow.getBoundingClientRect() : null;
    const listRect = listContainer && typeof listContainer.getBoundingClientRect === 'function' ? listContainer.getBoundingClientRect() : null;
    const scrollTop = listContainer ? listContainer.scrollTop || 0 : 0;
    const curSnap = rowRect
      ? {
          left: rowRect.left,
          top: rowRect.top,
          width: rowRect.width,
          height: rowRect.height,
          relTop: listRect ? rowRect.top - listRect.top + scrollTop : rowRect.top,
          relLeft: listRect ? rowRect.left - listRect.left : rowRect.left,
        }
      : null;
    return { empty: false, selIdx, selRow, curSnap, listRect, scrollTop };
  }

  function syncSidebarSelectionGlide(measuredSidebar) {
    const snap = measuredSidebar || measureSidebarSelectionSnapshot();
    if (snap.empty) {
      heroState.sidebarInitialized = false;
      heroState.sidebarIndex = -1;
      heroState.sidebarRow = null;
      heroState.sidebarRect = null;
      return;
    }
    const { selIdx, selRow, curSnap, listRect, scrollTop } = snap;
    if (!selRow) return;

    if (!heroState.sidebarInitialized) {
      heroState.sidebarInitialized = true;
      heroState.sidebarIndex = selIdx;
      heroState.sidebarRow = selRow;
      heroState.sidebarRect = curSnap;
      return;
    }

    const prevIdx = heroState.sidebarIndex;
    const prevSnap = heroState.sidebarRect;
    if (prevIdx >= 0 && selIdx >= 0 && selIdx !== prevIdx && prevSnap && curSnap) {
      const fromViewportRect = listRect
        ? {
            left: listRect.left + prevSnap.relLeft,
            top: listRect.top + prevSnap.relTop - scrollTop,
            width: prevSnap.width,
            height: prevSnap.height,
          }
        : prevSnap;

      if (isMotionStandardOrUltra()) {
        document.querySelectorAll('.ag-cs-sidebar-glide-pill').forEach((n) => n.remove());
        const pill = document.createElement('div');
        pill.className = 'ag-cs-sidebar-glide-pill';
        pill.setAttribute('aria-hidden', 'true');
        pill.setAttribute('data-ag-no-i18n', '');
        pill.style.setProperty('position', 'fixed');
        pill.style.setProperty('z-index', '38');
        pill.style.setProperty('pointer-events', 'none');
        pill.style.setProperty('left', `${Math.round(curSnap.left)}px`);
        pill.style.setProperty('top', `${Math.round(curSnap.top)}px`);
        pill.style.setProperty('width', `${Math.round(curSnap.width)}px`);
        pill.style.setProperty('height', `${Math.round(curSnap.height)}px`);
        if (document.body) document.body.appendChild(pill);
        if (motionEngine && typeof motionEngine.glideIndicator === 'function') {
          try {
            motionEngine.glideIndicator(pill, fromViewportRect, curSnap, { durationMs: 240 });
          } catch {}
        }
        scheduleTransient(() => pill.remove(), 260);
      }

      if (isMotionUltra()) {
        const dir = selIdx < prevIdx ? 'down' : 'up';
        const viewports = document.querySelectorAll('[data-testid="autoscroll-viewport"]');
        for (const vp of viewports) {
          if (vp.closest?.('[data-testid="subagent-tab-conversation"]')) continue;
          vp.setAttribute('data-ag-cs-stage-glide', dir);
          scheduleTransient(() => {
            if (vp.isConnected && vp.getAttribute('data-ag-cs-stage-glide') === dir) {
              vp.removeAttribute('data-ag-cs-stage-glide');
            }
          }, 220);
          break;
        }
      }
    }

    heroState.sidebarIndex = selIdx;
    heroState.sidebarRow = selRow;
    heroState.sidebarRect = curSnap;
  }

  function applyCausticSweep(el) {
    if (!el || !isMotionUltra()) return;
    el.setAttribute('data-ag-cs-caustic', '1');
    scheduleTransient(() => {
      if (el.isConnected) el.removeAttribute('data-ag-cs-caustic');
    }, 920);
  }

  function measureVisibleChangedHeaders() {
    const out = [];
    const headers = document.querySelectorAll('[data-testid="changed-files-card-header"]');
    const vh = typeof window.innerHeight === 'number' && window.innerHeight > 0 ? window.innerHeight : 1080;
    for (const hdr of headers) {
      if (seenChangedFileHeaders.has(hdr)) continue;
      const r = typeof hdr.getBoundingClientRect === 'function' ? hdr.getBoundingClientRect() : null;
      const inView = !r || r.height <= 0 || (r.bottom > 0 && r.top < vh);
      if (inView) out.push(hdr);
    }
    return out;
  }

  function syncHeroCCaustics(measuredHeaders) {
    const now = performance.now();
    const visibleHeaders = measuredHeaders || measureVisibleChangedHeaders();
    let sawNewChangedFiles = false;
    for (const hdr of visibleHeaders) {
      if (seenChangedFileHeaders.has(hdr)) continue;
      seenChangedFileHeaders.add(hdr);
      sawNewChangedFiles = true;
      if (isMotionUltra()) applyCausticSweep(hdr);
    }
    if (sawNewChangedFiles) {
      try {
        mascotState.rig?.notify?.('files-changed');
      } catch {}
    }

    const runningNow = isConvRunning();
    if (!heroState.runTrackInitialized) {
      heroState.runTrackInitialized = true;
      heroState.wasConvRunning = runningNow;
      heroState.runStartedAt = runningNow ? now : 0;
    } else if (runningNow && !heroState.wasConvRunning) {
      heroState.wasConvRunning = true;
      heroState.runStartedAt = now;
    } else if (!runningNow && heroState.wasConvRunning) {
      heroState.wasConvRunning = false;
      const elapsed = heroState.runStartedAt > 0 ? now - heroState.runStartedAt : 0;
      heroState.runStartedAt = 0;
      if (elapsed >= 6000 && isMotionUltra()) {
        const cards = document.querySelectorAll('[data-testid="agent-input-box"] .surface-composer-card');
        let primaryCard = null;
        for (const c of cards) {
          if (!c.closest?.('[data-testid="subagent-tab-conversation"]')) {
            primaryCard = c;
            break;
          }
        }
        if (primaryCard) applyCausticSweep(primaryCard);
      }
      if (mascotState.rig && typeof mascotState.rig.notify === 'function') {
        try {
          mascotState.rig.notify('complete', { durationMs: elapsed });
        } catch {}
      }
    }
  }

  function triggerHeroDFiberPulse(card, modelBtn, brand) {
    if (!card || !isMotionUltra()) return;
    const camp = brand === 'antigravity' || brand === 'claude' || brand === 'openai' ? brand : 'gemini';
    if (heroState.fiberTimer) {
      clearTimeout(heroState.fiberTimer);
      transientTimers.delete(heroState.fiberTimer);
      heroState.fiberTimer = 0;
    }
    card.setAttribute('data-ag-cs-fiber-camp', camp);
    heroState.fiberTimer = scheduleTransient(() => {
      heroState.fiberTimer = 0;
      if (card.isConnected) card.removeAttribute('data-ag-cs-fiber-camp');
    }, 480);
    const glyph = modelBtn?.querySelector?.('.ag-cs-model-glyph');
    if (glyph && motionEngine && typeof motionEngine.spring === 'function') {
      try {
        motionEngine.spring(
          glyph,
          [
            { transform: 'scale(0.84) rotate(-8deg)' },
            { transform: 'scale(1.12) rotate(3deg)' },
            { transform: 'scale(1) rotate(0deg)' },
          ],
          { stiffness: 420, damping: 22, slot: 'fiber-focus' }
        );
      } catch {}
    }
  }

  function triggerHeroESonar(navTurn) {
    if (!navTurn || !isMotionUltra()) return;
    let idx = -1;
    const rawAttr = navTurn.getAttribute?.('data-turn-index') ?? navTurn.getAttribute?.('data-index');
    if (rawAttr !== null && rawAttr !== undefined && /^\d+$/.test(String(rawAttr).trim())) {
      idx = parseInt(String(rawAttr).trim(), 10);
    } else if (navTurn.parentElement) {
      const sibs = Array.from(navTurn.parentElement.querySelectorAll('[data-testid="conversation-navigator-turn"]'));
      idx = sibs.indexOf(navTurn);
    }
    if (idx < 0) return;
    const conv = navTurn.closest?.('[data-testid="conversation-view"]') || findFormalConvView();
    if (!conv) return;
    let turns = conv.querySelectorAll('[data-testid="user-input-step"]');
    if (!turns || turns.length === 0) turns = conv.querySelectorAll('[data-testid="conversation-turn"]');
    if (!turns || turns.length === 0) turns = conv.querySelectorAll('[data-testid="user-message-bubble"]');
    const target = turns && turns[idx];
    if (!target) return;
    target.setAttribute('data-ag-cs-sonar', '1');
    scheduleTransient(() => {
      if (target.isConnected) target.removeAttribute('data-ag-cs-sonar');
    }, 720);
  }

  function syncHeroRouteChoreography(measured) {
    const inHome = measured ? measured.inHome : Boolean(document.querySelector('.agy-home'));
    const formalConv = measured ? measured.formalConv : !inHome ? findFormalConvView() : null;
    const inFormalConv = Boolean(formalConv);

    if (inHome && !measured?.homeComposerSampled) sampleHomeComposerRect();

    if (!heroState.routeInitialized) {
      heroState.routeInitialized = true;
      heroState.wasInHome = inHome;
      heroState.wasInFormalConv = inFormalConv;
    } else {
      if (heroState.wasInHome && !inHome && inFormalConv) {
        triggerHeroALiftoff(formalConv, measured?.convInputRect || null);
      } else if (heroState.wasInFormalConv && !heroState.wasInHome && inHome) {
        triggerHeroBHomeReturn();
      }
      heroState.wasInHome = inHome;
      heroState.wasInFormalConv = inFormalConv;
    }

    if (heroState.pendingLiftoffBubbleUntil > 0 && formalConv) {
      if (performance.now() <= heroState.pendingLiftoffBubbleUntil) {
        if (markFirstUserLiftoffBubble(formalConv)) heroState.pendingLiftoffBubbleUntil = 0;
      } else {
        heroState.pendingLiftoffBubbleUntil = 0;
      }
    }

    syncSidebarSelectionGlide(measured?.sidebarSnap);
    syncHeroCCaustics(measured?.visibleChangedHeaders);
  }

  // ── Dual-Track Smart Streaming Engine (Zero-Splice Element Class Tagging — 100% React Fiber Safe!) ───
  const STREAM_BATCH_MS = 52;
  const CODE_OR_TABLE_TAGS = new Set(['PRE', 'CODE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD']);
  let streamObserver = null;
  let streamObservedRoot = null;
  let streamMutating = false;
  let lastProseWrapAt = -1000;
  let lastThoughtWrapAt = -1000;

  function isInsideCodeOrTable(node, stopAt) {
    let cur = isElementLike(node) ? node : node?.parentElement;
    while (cur && cur !== stopAt) {
      if (CODE_OR_TABLE_TAGS.has(String(cur.tagName || '').toUpperCase())) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function flushAllStreamArtifacts() {
    const prevInt = internalDomMutating;
    internalDomMutating = true;
    try {
      document.querySelectorAll('.ag-cs-stream-chunk').forEach((el) => el.classList?.remove?.('ag-cs-stream-chunk'));
      document.querySelectorAll('.ag-cs-thought-chunk').forEach((el) => el.classList?.remove?.('ag-cs-thought-chunk'));
      document.querySelectorAll('.ag-cs-code-scan').forEach((el) => el.classList?.remove?.('ag-cs-code-scan'));
      document
        .querySelectorAll('[data-ag-cs-thought-streaming]')
        .forEach((el) => el.removeAttribute('data-ag-cs-thought-streaming'));
    } finally {
      internalDomMutating = prevInt;
    }
  }

  function findExpandedStreamingThoughtBody(node) {
    let cur = isElementLike(node) ? node : node?.parentElement;
    while (cur && cur !== document.body) {
      if (cur.getAttribute?.('data-ag-cs-thought-streaming') === '1') return cur;
      const prev = cur.previousElementSibling;
      if (
        prev &&
        prev.getAttribute?.('data-testid') === 'thinking-collapsible-trigger' &&
        prev.getAttribute?.('aria-expanded') === 'true'
      ) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function markTransientStreamClass(el, clsName, durationMs = 240) {
    if (!el || !el.classList || el.classList.contains(clsName)) return false;
    const prevInt = internalDomMutating;
    internalDomMutating = true;
    try {
      el.classList.add(clsName);
    } finally {
      internalDomMutating = prevInt;
    }
    scheduleTransient(() => {
      const p = internalDomMutating;
      internalDomMutating = true;
      try {
        el.classList?.remove?.(clsName);
      } finally {
        internalDomMutating = p;
      }
    }, durationMs);
    return true;
  }

  function markCodeScanElement(el) {
    markTransientStreamClass(el, 'ag-cs-code-scan', 240);
  }

  function onStreamMutations(mutations) {
    if (destroyed || streamMutating || internalDomMutating || !isMotionUltra()) return;
    const now = performance.now();

    for (const m of mutations) {
      if (m.type !== 'childList' || !m.addedNodes || m.addedNodes.length === 0) continue;
      if (isThoughtMutationRecord(m)) continue;

      const target = m.target;
      if (!target) continue;
      const baseEl = isElementLike(target) ? target : target.parentElement;
      if (!baseEl) continue;
      if (
        baseEl.closest?.(
          '.ag-cs-stream-chunk, .ag-cs-thought-chunk, .ag-cs-smooth-caret, .ag-cs-crab, .ag-cs-conv-aura-host, [data-testid="agent-input-box"]'
        )
      ) {
        continue;
      }

      const thoughtBody = findExpandedStreamingThoughtBody(target);
      if (thoughtBody) {
        if (isManagedThoughtPanel(thoughtBody)) continue;
        for (const added of m.addedNodes) {
          if (isThoughtIsolatedNode(added)) continue;
          if (isElementLike(added) && now - lastThoughtWrapAt >= STREAM_BATCH_MS) {
            if (markTransientStreamClass(added, 'ag-cs-thought-chunk', 200)) {
              lastThoughtWrapAt = now;
            }
          }
        }
        continue;
      }

      const proseRoot = baseEl.closest?.('[data-testid="planner-response-text"]');
      if (!proseRoot) continue;

      const codeCtx = isInsideCodeOrTable(target, proseRoot);
      if (codeCtx) {
        let marked = false;
        for (const added of m.addedNodes) {
          if (isElementLike(added)) {
            markCodeScanElement(added);
            marked = true;
          }
        }
        if (!marked) markCodeScanElement(codeCtx);
        continue;
      }

      for (const added of m.addedNodes) {
        if (!isElementLike(added)) continue;
        const tag = String(added.tagName || '').toUpperCase();
        if (CODE_OR_TABLE_TAGS.has(tag) || added.querySelector?.('pre, code, table')) {
          markCodeScanElement(added);
          continue;
        }
        if (now - lastProseWrapAt >= STREAM_BATCH_MS) {
          if (markTransientStreamClass(added, 'ag-cs-stream-chunk', 240)) {
            lastProseWrapAt = now;
          }
        }
      }
    }
  }

  function syncDualStreamEngine() {
    const activeUltraStream = isMotionUltra() && isConvRunning();
    const formalConv = activeUltraStream ? findFormalConvView() : null;

    if (!activeUltraStream || !formalConv) {
      if (streamObserver) {
        try {
          streamObserver.disconnect();
        } catch {}
        streamObservedRoot = null;
      }
      flushAllStreamArtifacts();
      return;
    }

    // 仅在 panel 外壳自身挂载/移除 data-ag-cs-thought-streaming="1"（与 thought-client 0 冲突共生）
    const triggers = formalConv.querySelectorAll('[data-testid="thinking-collapsible-trigger"]');
    for (let i = 0; i < triggers.length; i++) {
      const trig = triggers[i];
      const bodyDiv = trig.nextElementSibling;
      if (!bodyDiv || String(bodyDiv.tagName || '').toUpperCase() !== 'DIV') continue;
      const expanded = trig.getAttribute('aria-expanded') === 'true';
      const txt = String(trig.textContent || '');
      const isTrigStreaming =
        trig.getAttribute('data-op-thought-state') === 'streaming' ||
        /\.\.\.|…|正在|思考中|thinking/i.test(txt) ||
        i === triggers.length - 1;
      if (expanded && isTrigStreaming) {
        setAttrIfChanged(bodyDiv, 'data-ag-cs-thought-streaming', '1');
      } else if (bodyDiv.hasAttribute('data-ag-cs-thought-streaming')) {
        bodyDiv.removeAttribute('data-ag-cs-thought-streaming');
      }
    }

    if (!streamObserver && typeof MutationObserver === 'function') {
      streamObserver = new MutationObserver(onStreamMutations);
    }
    if (streamObserver && streamObservedRoot !== formalConv) {
      try {
        streamObserver.disconnect();
        streamObserver.observe(formalConv, { childList: true, subtree: true });
        streamObservedRoot = formalConv;
      } catch {}
    }
  }

  // ── Anchor Cryo-Lens Coordinates & Incremental 21 Host Animated Icons ──
  function measureNewLensOverlays() {
    if (!isMotionStandardOrUltra()) return [];
    const candidates = new Set();
    document.querySelectorAll('.agy-overlay').forEach((el) => candidates.add(el));
    document.querySelectorAll('div[role="dialog"]').forEach((el) => candidates.add(el));
    document.querySelectorAll('[data-testid="overview-panel"]').forEach((el) => {
      if (el.parentElement && String(el.parentElement.tagName || '').toUpperCase() === 'DIV') {
        candidates.add(el.parentElement);
      }
    });
    const out = [];
    for (const ov of candidates) {
      if (seenLensOverlays.has(ov)) continue;
      const r = typeof ov.getBoundingClientRect === 'function' ? ov.getBoundingClientRect() : null;
      out.push({ ov, rect: r });
    }
    return out;
  }

  function syncLensOverlayOrigins(measuredOverlays) {
    if (!isMotionStandardOrUltra()) return;
    const entries = measuredOverlays || measureNewLensOverlays();
    const trig = heroState.lastTriggerOrigin;
    for (const { ov, rect: r } of entries) {
      if (seenLensOverlays.has(ov)) continue;
      seenLensOverlays.add(ov);
      if (trig && r && r.width > 0 && r.height > 0) {
        const ox = Math.round(Math.max(-40, Math.min(r.width + 40, trig.x - r.left)));
        const oy = Math.round(Math.max(-40, Math.min(r.height + 40, trig.y - r.top)));
        ov.style.setProperty('--ag-origin-x', `${ox}px`);
        ov.style.setProperty('--ag-origin-y', `${oy}px`);
      }
      const rowNodes = [];
      const allEls = ov.querySelectorAll('[role="option"], [role="menuitem"], [data-testid]');
      for (const item of allEls) {
        const role = item.getAttribute?.('role');
        const tid = item.getAttribute?.('data-testid') || '';
        if (role === 'option' || role === 'menuitem' || tid.startsWith('overview-panel-row-')) {
          rowNodes.push(item);
          if (rowNodes.length >= 10) break;
        }
      }
      for (let i = 0; i < rowNodes.length; i++) {
        rowNodes[i].style?.setProperty?.('--ag-row-i', String(i));
      }
    }
  }

  function detectHostIconTarget(btn) {
    // 第三重隔离：第一行显式排除中文思考转译「原文」按钮与浮层！
    if (btn?.classList?.contains?.('ag-prism-thought-raw-toggle') || btn?.closest?.('.ag-prism-thought-overlay')) return '';
    if (!btn) return '';

    const tid = String(btn.getAttribute?.('data-testid') || '').toLowerCase();
    if (
      tid === 'model-selector-trigger' ||
      tid === 'app-icon-new-conversation-button' ||
      tid === 'input-cancel-button' ||
      tid === 'stop-button'
    ) {
      return '';
    }
    if (
      btn.closest?.(
        '#' +
          SETTINGS_SEC_ID +
          ', .ag-cs-home-panel, [data-testid="orchestrator-effort-bar"], .ag-cs-crab'
      )
    ) {
      return '';
    }
    if (btn.querySelector?.('.ag-cs-model-glyph, .ag-spark-orbit-svg, .ag-cs-thinking-spark')) return '';

    if (btn.hasAttribute?.('data-ag-cs-filter-btn') || tid === 'sidebar-search-button' || tid === 'conversation-filter-button') {
      return 'search';
    }
    if (tid === 'new-conversation-button') return 'sparkles-pen';
    if (
      tid === 'sidebar-toggle' ||
      tid === 'sidebar-toggle-button' ||
      tid === 'toggle-sidebar-button' ||
      tid === 'toggle-aux-sidebar'
    ) {
      return 'panel-left';
    }
    if (tid === 'automations-button') return 'zap-bolt';
    if (tid === 'input-send-button') return 'arrow-up-launch';
    if (tid === 'sidebar-add-project-button' || tid === 'toggle-overview-panel') return '';

    const aria = String(btn.getAttribute?.('aria-label') || '').toLowerCase();
    const title = String(btn.getAttribute?.('title') || '').toLowerCase();
    const tip = String(btn.getAttribute?.('data-tooltip-id') || '').toLowerCase();
    const meta = `${tid} ${aria} ${title} ${tip}`;
    const labelMeta = `${aria} ${title} ${tip}`;
    const origSvg = findOriginalHostSvg(btn);
    const svgCls = String(origSvg?.getAttribute?.('class') || origSvg?.className || '').toLowerCase();

    if (/\bcopy\b|复制|複製|コピー/.test(meta) || /\blucide-copy\b/.test(svgCls)) return 'copy-check';
    if (
      /(?:toggle|open|close|show|hide)\s+(?:the\s+)?(?:side\s*panel|sidebar)|切换侧边栏|切換側邊欄|折叠侧边栏|展开侧边栏|サイドバー/.test(
        labelMeta
      ) ||
      /\blucide-panel-left\b/.test(svgCls)
    ) {
      return 'panel-left';
    }
    if (
      tid === 'settings-button' ||
      tid === 'open-settings-button' ||
      /\blucide-settings\b/.test(svgCls) ||
      (/(?:\bsettings\b|设置|設定)/.test(meta) && btn.getAttribute?.('role') !== 'menuitem' && btn.getAttribute?.('role') !== 'tab')
    ) {
      return 'settings-gear';
    }
    if (
      btn.closest?.('[data-testid="agent-input-box"], .surface-composer-card') &&
      (tid === 'attachment-button' ||
        tid === 'add-context-button' ||
        tid === 'composer-plus-button' ||
        tid === 'input-add-button' ||
        /\blucide-plus\b/.test(svgCls) ||
        /\battach|\badd\b|upload|context|附件|添加/.test(meta))
    ) {
      return 'plus-spin';
    }
    return '';
  }

  function findOriginalHostSvg(btn) {
    if (!btn || !btn.querySelectorAll) return null;
    const svgs = btn.querySelectorAll('svg');
    for (const svg of svgs) {
      if (svg.classList?.contains?.('ag-anim-icon')) continue;
      return svg;
    }
    return null;
  }

  function restoreHostButtonIcon(btn) {
    if (!btn) return;
    btn.querySelectorAll?.('.ag-anim-icon').forEach((n) => n.remove());
    btn.querySelectorAll?.('[data-ag-cs-orig-svg]').forEach((orig) => {
      orig.removeAttribute('hidden');
      orig.hidden = false;
      const prevDisp = orig.getAttribute('data-ag-cs-orig-disp');
      if (prevDisp) {
        orig.style?.setProperty?.('display', prevDisp);
        orig.removeAttribute('data-ag-cs-orig-disp');
      } else {
        orig.style?.removeProperty?.('display');
      }
      orig.removeAttribute('data-ag-cs-orig-svg');
    });
    btn.removeAttribute('data-ag-cs-icon-injected');
  }

  function restoreAllHostAnimatedIcons() {
    document.querySelectorAll('[data-ag-cs-icon-injected]').forEach((btn) => restoreHostButtonIcon(btn));
  }

  function isHostButtonCandidate(el) {
    if (!isElementLike(el)) return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'BUTTON') return true;
    if (el.getAttribute?.('role') === 'button') return true;
    if (tag === 'A' && el.getAttribute?.('data-testid') === 'new-conversation-button') return true;
    return false;
  }

  const HOST_BTN_QUERY = 'button, [role="button"], a[data-testid="new-conversation-button"]';

  // 增量按钮扫描：正常帧仅扫描 dirtyAddedRoots 内的新增按钮节点（O(新增几节点)）！
  function syncHostAnimatedIcons(roots = null) {
    if (!animatedIcons || typeof animatedIcons.renderIcon !== 'function' || !isMotionStandardOrUltra()) {
      if (motionReduced()) restoreAllHostAnimatedIcons();
      return;
    }

    let buttons;
    if (roots && Array.isArray(roots)) {
      perfStats.iconIncrementalRuns += 1;
      const set = new Set();
      for (const r of roots) {
        if (!r || r.isConnected === false || isThoughtIsolatedNode(r)) continue;
        if (isHostButtonCandidate(r)) set.add(r);
        if (typeof r.querySelectorAll === 'function') {
          const inner = r.querySelectorAll(HOST_BTN_QUERY);
          for (let i = 0; i < inner.length; i++) {
            if (!isThoughtIsolatedNode(inner[i])) set.add(inner[i]);
          }
        }
      }
      if (set.size === 0) return;
      buttons = set;
    } else {
      perfStats.iconFullRuns += 1;
      buttons = document.querySelectorAll(HOST_BTN_QUERY);
    }

    for (const btn of buttons) {
      if (isThoughtIsolatedNode(btn)) continue;
      const existingIcon = btn.getAttribute('data-ag-cs-icon-injected');
      const iconName = detectHostIconTarget(btn);
      if (existingIcon) {
        if (existingIcon !== iconName) {
          restoreHostButtonIcon(btn);
        } else if (btn.querySelector?.('.ag-anim-icon')) {
          continue;
        } else {
          btn.removeAttribute('data-ag-cs-icon-injected');
        }
      }
      if (!iconName) continue;
      const origSvg = findOriginalHostSvg(btn);
      if (!origSvg || !origSvg.parentNode) continue;

      const rawSize = parseInt(origSvg.getAttribute?.('width') || '15', 10);
      const size = Number.isFinite(rawSize) && rawSize >= 12 && rawSize <= 20 ? rawSize : 15;
      const htmlStr = animatedIcons.renderIcon(iconName, { size });
      if (!htmlStr) continue;

      const prevDisp = origSvg.style?.getPropertyValue?.('display') || '';
      if (prevDisp) origSvg.setAttribute('data-ag-cs-orig-disp', prevDisp);
      origSvg.setAttribute('hidden', '');
      origSvg.setAttribute('data-ag-cs-orig-svg', '1');
      origSvg.hidden = true;
      origSvg.style?.setProperty?.('display', 'none', 'important');

      const tmp = document.createElement('span');
      tmp.innerHTML = htmlStr;
      let animSvg = tmp.firstElementChild || tmp.firstChild;
      if (!animSvg) {
        animSvg = document.createElement('svg');
        animSvg.className = `ag-anim-icon ag-icon-${iconName}`;
        animSvg.setAttribute('data-anim-icon', iconName);
        animSvg.setAttribute('width', String(size));
        animSvg.setAttribute('height', String(size));
        animSvg.setAttribute('viewBox', '0 0 24 24');
        animSvg.setAttribute('aria-hidden', 'true');
        if (iconName === 'copy-check') animSvg.setAttribute('data-icon-state', 'copy');
        animSvg.innerHTML = htmlStr;
      }
      origSvg.parentNode.insertBefore(animSvg, origSvg);
      btn.setAttribute('data-ag-cs-icon-injected', iconName);
    }
  }

  function runSettingsGroupGlide(group, prevBtn, nextBtn, prevRectOverride = null) {
    if (!group || !prevBtn || !nextBtn || prevBtn === nextBtn || !isMotionStandardOrUltra()) return;
    if (!motionEngine || typeof motionEngine.glideIndicator !== 'function') return;
    const prevRect = prevRectOverride || (typeof prevBtn.getBoundingClientRect === 'function' ? prevBtn.getBoundingClientRect() : null);
    const nextRect = typeof nextBtn.getBoundingClientRect === 'function' ? nextBtn.getBoundingClientRect() : null;
    const pill = document.createElement('div');
    pill.className = 'ag-cs-pill-glide';
    pill.setAttribute('aria-hidden', 'true');
    pill.setAttribute('data-ag-no-i18n', '');
    if (nextRect && nextRect.width > 0 && nextRect.height > 0) {
      pill.style.setProperty('position', 'fixed');
      pill.style.setProperty('left', `${Math.round(nextRect.left)}px`);
      pill.style.setProperty('top', `${Math.round(nextRect.top)}px`);
      pill.style.setProperty('width', `${Math.round(nextRect.width)}px`);
      pill.style.setProperty('height', `${Math.round(nextRect.height)}px`);
      pill.style.setProperty('border-radius', '6px');
      pill.style.setProperty('background', 'rgba(148, 163, 184, 0.14)');
      pill.style.setProperty('box-shadow', 'inset 0 1px 0 rgba(255, 255, 255, 0.12)');
      pill.style.setProperty('pointer-events', 'none');
      pill.style.setProperty('z-index', '9999');
    }
    if (document.body) document.body.appendChild(pill);
    try {
      motionEngine.glideIndicator(pill, prevRect || prevBtn, nextRect || nextBtn, { durationMs: 220 });
    } catch {}
    scheduleTransient(() => pill.remove(), 240);
  }

  // ── Pointer Tracking for Prism Rim & Orchestrator Crystal Bar (FastDOM Read->Write) ──
  let lastPointerPos = { x: -9999, y: -9999 };
  let prismRaf = 0;
  let lastPrismPointerAt = 0;

  function flushPrismPointer() {
    prismRaf = 0;
    if (destroyed) return;
    const reduced = motionReduced();
    const { x, y } = lastPointerPos;

    // Phase 1: Read all rects first
    const boxes = document.querySelectorAll('[data-ag-cs-prism-box="1"]');
    const boxReads = [];
    for (const box of boxes) {
      boxReads.push({ box, rect: !reduced && x >= -1000 ? box.getBoundingClientRect() : null });
    }
    const trackEl = crystalMount.track && crystalMount.wasOrch ? crystalMount.track : null;
    const trackRect = trackEl && !reduced && x >= -1000 ? trackEl.getBoundingClientRect() : null;

    // Phase 2: Write CSS variables
    const prevInt = internalDomMutating;
    internalDomMutating = true;
    try {
      for (const { box, rect: r } of boxReads) {
        if (!r) {
          box.style.setProperty('--ag-px', '-9999px');
          box.style.setProperty('--ag-py', '-9999px');
          continue;
        }
        const maxRange = 280;
        if (x < r.left - maxRange || x > r.right + maxRange || y < r.top - maxRange || y > r.bottom + maxRange) {
          box.style.setProperty('--ag-px', '-9999px');
          box.style.setProperty('--ag-py', '-9999px');
          continue;
        }
        box.style.setProperty('--ag-px', `${Math.round(x - r.left)}px`);
        box.style.setProperty('--ag-py', `${Math.round(y - r.top)}px`);
      }

      if (trackEl) {
        if (!trackRect) {
          trackEl.style.setProperty('--orch-px', '-9999px');
          trackEl.style.setProperty('--orch-py', '-9999px');
        } else {
          const maxRange = 120;
          if (
            trackRect.width < 10 ||
            x < trackRect.left - maxRange ||
            x > trackRect.right + maxRange ||
            y < trackRect.top - maxRange ||
            y > trackRect.bottom + maxRange
          ) {
            trackEl.style.setProperty('--orch-px', '-9999px');
            trackEl.style.setProperty('--orch-py', '-9999px');
          } else {
            trackEl.style.setProperty('--orch-px', `${Math.round(x - trackRect.left)}px`);
            trackEl.style.setProperty('--orch-py', `${Math.round(y - trackRect.top)}px`);
          }
        }
        if (crystalMount.inst && typeof crystalMount.inst.setPointerClient === 'function') {
          crystalMount.inst.setPointerClient(x, y);
        }
      }
    } finally {
      internalDomMutating = prevInt;
    }
  }

  function onWinPointerMove(ev) {
    if (destroyed) return;
    lastPointerPos.x = Number(ev.clientX);
    lastPointerPos.y = Number(ev.clientY);
    const now = performance.now();
    if (!motionReduced() && !prismRaf && now - lastPrismPointerAt >= 28 && typeof requestAnimationFrame === 'function') {
      lastPrismPointerAt = now;
      prismRaf = requestAnimationFrame(flushPrismPointer);
    }
    if (now - mascotState.lastActivityAt >= 2000) {
      mascotState.lastActivityAt = now;
      if (mascotState.rig && typeof mascotState.rig.notify === 'function') {
        try {
          mascotState.rig.notify('activity', {});
        } catch {}
      }
    }
  }

  function onWinResize() {
    if (destroyed) return;
    smoothCaretCtl.bumpMetricsEpoch();
    queueSmoothCaret(false, false, true);
  }

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.getAttribute?.('contenteditable') === 'true' || el.isContentEditable) return true;
    if (el.closest?.('[contenteditable="true"], input, textarea, select, [role="textbox"]')) return true;
    return false;
  }

  function onWinKeyDown(ev) {
    if (destroyed || !ev) return;
    if (
      ev.key === 'Enter' &&
      !ev.shiftKey &&
      !ev.isComposing &&
      ev.target?.closest?.('[data-testid="agent-input-box"] [contenteditable="true"]')
    ) {
      if (ev.target.closest?.('.agy-home')) {
        triggerHomeLiftoffRippleBurst();
      }
      triggerConvAuraStart();
      if (mascotState.rig && typeof mascotState.rig.notify === 'function') {
        try {
          mascotState.rig.notify('send', {});
        } catch {}
      }
      return;
    }
    if (ev.key === '[' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !isEditableTarget(ev.target)) {
      const html = document.documentElement;
      if (!html || cfg.sidebarRestyle === false) return;
      if (html.getAttribute('data-ag-cs-sidebar-collapsed') === '1') {
        html.removeAttribute('data-ag-cs-sidebar-collapsed');
      } else {
        html.setAttribute('data-ag-cs-sidebar-collapsed', '1');
      }
    }
  }

  function onWinClick(ev) {
    if (destroyed || !ev?.target?.closest) return;
    if (isThoughtIsolatedNode(ev.target)) return;

    const pulseClicked =
      ev.target?.id === 'ag-pulse-status-bar' ||
      Boolean(ev.target?.closest?.('#ag-pulse-status-bar')) ||
      Boolean(typeof ev.composedPath === 'function' && ev.composedPath().some((n) => n?.id === 'ag-pulse-status-bar'));
    if (pulseClicked) {
      setTimeout(() => {
        if (!destroyed) syncContextCardOpenNotify();
      }, 28);
    }

    const thinkBtn = ev.target.closest('[data-testid="thinking-collapsible-trigger"]');
    if (thinkBtn && getThoughtTranslateMode() !== 'off') {
      setTimeout(() => {
        try {
          window.__agPrismThought?.scan?.();
        } catch {}
      }, 25);
    }

    const sendBtn = ev.target.closest('[data-testid="input-send-button"], [data-testid="send-button"]');
    if (sendBtn && !sendBtn.disabled) {
      if (sendBtn.closest?.('.agy-home')) {
        triggerHomeLiftoffRippleBurst();
      }
      if (sendBtn.getAttribute('data-ag-cs-icon-injected') === 'arrow-up-launch' && isMotionStandardOrUltra()) {
        try {
          motionEngine?.triggerIcon?.(sendBtn, 'launch');
        } catch {}
      }
      triggerConvAuraStart();
      if (mascotState.rig && typeof mascotState.rig.notify === 'function') {
        try {
          mascotState.rig.notify('send', {});
        } catch {}
      }
    }

    const copyBtn =
      ev.target.closest('[data-ag-cs-icon-injected="copy-check"]') ||
      ev.target.closest('pre button, button[aria-label*="Copy" i], button[aria-label*="复制"]');
    if (copyBtn && !copyBtn.disabled && !isThoughtIsolatedNode(copyBtn)) {
      if (
        copyBtn.getAttribute?.('data-ag-cs-icon-injected') === 'copy-check' &&
        !motionReduced() &&
        motionEngine &&
        typeof motionEngine.triggerIcon === 'function'
      ) {
        try {
          motionEngine.triggerIcon(copyBtn, 'check', { revertAfterMs: 1600 });
        } catch {}
      }
      try {
        mascotState.rig?.notify?.('code-copied');
      } catch {}
    }

    const navTurn = ev.target.closest('[data-testid="conversation-navigator-turn"]');
    if (navTurn) {
      triggerHeroESonar(navTurn);
    }

    const grpBtn = ev.target.closest('[role="dialog"] [role="group"] button');
    if (grpBtn && !grpBtn.hasAttribute('data-ag-cs-key') && !handledGroupClicks.has(ev)) {
      handledGroupClicks.add(ev);
      const grp = grpBtn.closest('[role="group"]');
      const gp = heroState.lastGroupPress;
      if (gp && gp.group === grp && gp.prevBtn && gp.prevBtn !== grpBtn) {
        runSettingsGroupGlide(grp, gp.prevBtn, grpBtn, gp.prevRect);
      }
    }

    const wfBtn = ev.target.closest('[data-testid="worked-for-collapsible"]');
    if (wfBtn && cfg.composerRestyle !== false) {
      if (workedForClickTimer) clearTimeout(workedForClickTimer);
      workedForClickTimer = setTimeout(() => {
        workedForClickTimer = 0;
        if (!destroyed) syncWorkedForAutoUnfold();
      }, 28);
    }
  }

  // ── Settings Panel Integration (Delegated to settings-panel.js) ────────
  function formatSettingsSummary(lang, ui) {
    const pal = getEffectivePalette();
    const palLabel =
      pal === 'host'
        ? ui.optHost || (isZh() ? '跟随主题' : 'Host')
        : pal === 'warm' || pal === 'claude'
        ? ui.optWarm || (isZh() ? 'Alabaster 暖岩' : 'Alabaster')
        : ui.optObsidian || (isZh() ? 'Obsidian 深空' : 'Obsidian');
    const lp =
      getLightPreset() === 'alabaster'
        ? ui.optLightAlabaster || (isZh() ? '暖白画册' : 'Warm Alabaster')
        : ui.optLightCrystal || (isZh() ? '白昼冷晶' : 'Daylight Crystal');
    const ml = getMotionLevel();
    const mlLabel =
      ml === 'off'
        ? ui.optMotionOff || (isZh() ? '动效关' : 'Off')
        : ml === 'subtle'
        ? ui.optMotionSubtle || (isZh() ? '克制' : 'Subtle')
        : ml === 'standard'
        ? ui.optMotionStandard || (isZh() ? '标准' : 'Standard')
        : ui.optMotionUltra || (isZh() ? '旗舰光学' : 'Ultra');
    return `${palLabel} · ${lp} · ${mlLabel}`;
  }

  function resolveSettingRowActiveValue(key, lang) {
    if (key === 'language') return lang;
    if (key === 'motionLevel') return getMotionLevel();
    if (key === 'lightPreset') return getLightPreset();
    if (key === 'telemetryModule') return getTelemetryMode();
    if (key === 'effortSliderModule') return getEffortSliderMode();
    if (key === 'thoughtTranslate') return getThoughtTranslateMode();
    if (key === 'thoughtTrigger') return getThoughtTriggerTiming();
    if (key === 'palette') {
      const p = getEffectivePalette();
      return p === 'claude' ? 'warm' : p;
    }
    if (key === 'mascot') {
      return cfg.mascot === 'dual' ? 'crab' : cfg.mascot;
    }
    return cfg[key];
  }

  function isSettingButtonMatch(key, btnValJson, curVal) {
    if (JSON.stringify(curVal) === btnValJson) return true;
    if (key === 'palette' && (curVal === 'warm' || curVal === 'claude')) {
      return btnValJson === '"warm"' || btnValJson === '"claude"';
    }
    return false;
  }

  function ensureSettingsSection() {
    if (!settingsPanelMod || typeof settingsPanelMod.mountOrSyncSettingsSection !== "function") return;
    settingsPanelMod.mountOrSyncSettingsSection({
      version: VERSION,
      getLang,
      uiText,
      isZh,
      i18nCore,
      formatSettingsSummary,
      resolveSettingRowActiveValue,
      isSettingButtonMatch,
      saveSetting,
      getThoughtTranslateMode,
      handledGroupClicks,
      runSettingsGroupGlide,
      runGuardedMut,
    });
  }

  // ── Pulse Physical Water Vial Bridge & Micro-Interactions ──────────────
  let pulseBridgeInst = null;
  let motionBinding = null;
  let wasContextCardOpen = false;

  function syncContextCardOpenNotify() {
    const pulseHost = document.getElementById('ag-pulse-status-bar');
    const cardEl =
      document.getElementById('context-card') ||
      (pulseHost && pulseHost.shadowRoot && typeof pulseHost.shadowRoot.getElementById === 'function'
        ? pulseHost.shadowRoot.getElementById('context-card')
        : null);
    const openNow = Boolean(
      cardEl &&
        (cardEl.isConnected !== false) &&
        !cardEl.hidden &&
        cardEl.getAttribute?.('aria-hidden') !== 'true' &&
        cardEl.style?.display !== 'none'
    );
    if (openNow && !wasContextCardOpen) {
      try {
        mascotState.rig?.notify?.('vial-opened');
      } catch {}
    }
    wasContextCardOpen = openNow;
  }

  function ensurePulseBridge() {
    syncContextCardOpenNotify();
    if (destroyed || !pulseVialBridgeMod || typeof pulseVialBridgeMod.mountPulseVialBridge !== 'function') return;
    if (getTelemetryMode() === 'off') return;
    if (!pulseBridgeInst) {
      try {
        pulseBridgeInst = pulseVialBridgeMod.mountPulseVialBridge({ win: window, doc: document });
      } catch {
        pulseBridgeInst = null;
      }
    } else if (typeof pulseBridgeInst.sync === 'function') {
      try {
        void pulseBridgeInst.sync();
      } catch {}
    }
  }

  // ── FastDOM Two-Phase Incremental Synchronization Loop ─────────────────
  let syncQueued = false;
  let syncTimer = null;
  let syncIsRaf = false;

  function cancelScheduledSync() {
    if (syncTimer === null) return;
    try {
      if (syncIsRaf && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(syncTimer);
      } else {
        clearTimeout(syncTimer);
      }
    } catch {}
    syncTimer = null;
    syncQueued = false;
  }

  const OWN_PLUGIN_SELECTOR =
    '.ag-cs-home-panel-seat, .ag-cs-ripple-host, .ag-cs-conv-aura-host, .ag-cs-crab, .ag-cs-model-glyph, [data-testid="orchestrator-effort-bar"], .ag-cs-thinking-spark, .ag-cs-smooth-caret, .ag-cs-liftoff-veil, .ag-cs-sidebar-glide-pill, .ag-cs-pill-glide, .ag-cs-stream-chunk, .ag-cs-thought-chunk, .ag-anim-icon, #' +
    SETTINGS_SEC_ID +
    ', #ag-prism-css, #ag-claude-style-css';

  function isOwnPluginNode(target) {
    if (!target) return false;
    const el = target.closest ? target : target.parentElement;
    if (!el || !el.closest) return false;
    return Boolean(el.closest(OWN_PLUGIN_SELECTOR));
  }

  function isOwnPluginMutation(m) {
    if (!m) return false;
    if (isOwnPluginNode(m.target)) return true;
    const added = m.addedNodes;
    const removed = m.removedNodes;
    const addLen = added ? added.length : 0;
    const remLen = removed ? removed.length : 0;
    if (addLen + remLen > 0) {
      for (let i = 0; i < addLen; i++) {
        if (!isOwnPluginNode(added[i])) return false;
      }
      for (let i = 0; i < remLen; i++) {
        if (!isOwnPluginNode(removed[i])) return false;
      }
      return true;
    }
    return false;
  }

  function classifyDirtySubtree(el, isAdded) {
    if (!isElementLike(el)) return;
    const tid = String(el.getAttribute?.('data-testid') || '');
    const role = String(el.getAttribute?.('role') || '');
    const cls = String(el.className || '');

    if (
      cls.includes('agy-home') ||
      tid === 'conversation-view' ||
      tid === 'home-greeting' ||
      (!isAdded && el.querySelector?.('.agy-home, [data-testid="conversation-view"]')) ||
      (isAdded && el.querySelector?.('.agy-home, [data-testid="conversation-view"], [data-testid="home-greeting"]'))
    ) {
      dirtyFlags.route = true;
      dirtyFlags.composer = true;
      dirtyFlags.buttons = true;
      dirtyFlags.collapsible = true;
      if (!isAdded) dirtyFlags.full = true;
    }

    if (tid === 'conversation-row-sidebar' || el.closest?.('aside') || el.querySelector?.('[data-testid="conversation-row-sidebar"]')) {
      dirtyFlags.sidebar = true;
      if (isAdded) dirtyFlags.buttons = true;
    }

    if (
      tid === 'agent-input-box' ||
      tid === 'input-cancel-button' ||
      tid === 'stop-button' ||
      tid === 'cancel-button' ||
      tid === 'agent-loading' ||
      tid === 'send-button' ||
      tid === 'input-send-button' ||
      tid === 'model-selector-trigger' ||
      tid === 'interaction-takeover-card' ||
      tid === 'side-question-panel' ||
      tid === 'running-items-panel' ||
      cls.includes('surface-composer-card') ||
      el.closest?.('[data-testid="agent-input-box"]') ||
      el.querySelector?.('[data-testid="agent-input-box"], [data-testid="input-cancel-button"], .surface-composer-card')
    ) {
      dirtyFlags.composer = true;
      dirtyFlags.route = true;
      if (isAdded) dirtyFlags.buttons = true;
    }

    if (
      role === 'dialog' ||
      tid === 'model-selector-panel' ||
      tid === 'overview-panel' ||
      cls.includes('agy-overlay') ||
      el.id === 'ag-pulse-status-bar' ||
      el.id === 'context-card' ||
      el.closest?.('[role="dialog"], [data-testid="model-selector-panel"]') ||
      el.querySelector?.('[role="dialog"], [data-testid="model-selector-panel"], .agy-overlay, #context-card')
    ) {
      dirtyFlags.overlays = true;
      dirtyFlags.settings = true;
      dirtyFlags.composer = true;
      if (isAdded) dirtyFlags.buttons = true;
    }

    if (
      tid === 'worked-for-collapsible' ||
      tid === 'thinking-collapsible-trigger' ||
      tid === 'tool-group-collapsible' ||
      tid === 'changed-files-card-header' ||
      el.querySelector?.(
        '[data-testid="worked-for-collapsible"], [data-testid="thinking-collapsible-trigger"], [data-testid="changed-files-card-header"]'
      )
    ) {
      dirtyFlags.collapsible = true;
      dirtyFlags.route = true;
      dirtyFlags.composer = true;
    }

    if (isAdded && (isHostButtonCandidate(el) || el.querySelector?.(HOST_BTN_QUERY))) {
      dirtyFlags.buttons = true;
    }
  }

  // Phase 1: Measure (集中读取所有几何信息，零 DOM 写入，杜绝 Layout Thrashing！)
  function measureSyncPhase(flags) {
    const inHome = Boolean(document.querySelector('.agy-home'));
    const inHero = inHome && Boolean(document.querySelector('.agy-home [data-testid="home-greeting"]'));
    const formalConv = !inHome ? findFormalConvView() : null;

    let homeComposerSampled = false;
    if (inHome && (flags.full || flags.route || flags.composer)) {
      sampleHomeComposerRect();
      homeComposerSampled = true;
    }

    let convInputRect = null;
    if (heroState.routeInitialized && heroState.wasInHome && !inHome && formalConv && isMotionUltra()) {
      const ib = formalConv.querySelector('[data-testid="agent-input-box"]') || document.querySelector('[data-testid="agent-input-box"]');
      if (ib && typeof ib.getBoundingClientRect === 'function') {
        convInputRect = ib.getBoundingClientRect();
      }
    }

    const sidebarSnap =
      flags.full || flags.sidebar || flags.route ? measureSidebarSelectionSnapshot() : null;
    const visibleChangedHeaders =
      flags.full || flags.collapsible || flags.route ? measureVisibleChangedHeaders() : [];
    const lensOverlays =
      (flags.full || flags.overlays) && isMotionStandardOrUltra() ? measureNewLensOverlays() : [];
    const caretList =
      (flags.full || flags.composer) && cfg.smoothCaret !== false ? measureSmoothCaretsSnapshot(false) : null;

    return {
      inHome,
      inHero,
      formalConv,
      homeComposerSampled,
      convInputRect,
      sidebarSnap,
      visibleChangedHeaders,
      lensOverlays,
      caretList,
    };
  }

  function runSync(forceFull = false) {
    if (destroyed) return;
    const t0 = performance.now();
    if (forceFull) markAllDirty();

    const flags = { ...dirtyFlags };
    const addedRoots = Array.from(dirtyAddedRoots);
    dirtyAddedRoots.clear();
    dirtyFlags.full = false;
    dirtyFlags.theme = false;
    dirtyFlags.route = false;
    dirtyFlags.sidebar = false;
    dirtyFlags.composer = false;
    dirtyFlags.buttons = false;
    dirtyFlags.overlays = false;
    dirtyFlags.collapsible = false;
    dirtyFlags.settings = false;

    const prevWasInHome = heroState.wasInHome;
    const prevWasInConv = heroState.wasInFormalConv;

    // ── Phase 1: Pure Measure ──
    const measured = measureSyncPhase(flags);

    // ── Phase 2: Pure Mutate ──
    const prevInt = internalDomMutating;
    internalDomMutating = true;
    try {
      applyRootAttrs();

      if (flags.full || flags.route || measured.inHero !== wasHero) {
        syncGreeting(measured.inHero);
        if (measured.inHero && cfg.homeLayout === 'studio') {
          renderHomePanel();
        } else {
          unmountPanelSeat();
        }
      }

      if (flags.full || flags.route || flags.theme) {
        syncRipple();
      }
      if (flags.full || flags.route || flags.composer || flags.collapsible || flags.theme) {
        syncConvAura();
      }
      if (flags.full || flags.composer || flags.overlays || flags.collapsible) {
        syncComposers(measured);
      }
      if (flags.full || flags.route || flags.sidebar || flags.collapsible || flags.composer) {
        syncHeroRouteChoreography(measured);
      }
      if (flags.full || flags.route || flags.composer || flags.collapsible) {
        syncDualStreamEngine();
      }
      if (flags.full || flags.overlays) {
        syncLensOverlayOrigins(measured.lensOverlays);
      }

      const routeJumped =
        flags.full ||
        measured.inHome !== prevWasInHome ||
        Boolean(measured.formalConv) !== prevWasInConv;
      if (routeJumped) {
        syncHostAnimatedIcons(null);
      } else if (flags.buttons && addedRoots.length > 0) {
        syncHostAnimatedIcons(addedRoots);
      }

      if (flags.full || flags.collapsible) {
        syncWorkedForAutoUnfold();
      }
      if ((flags.full || flags.collapsible || flags.route || flags.composer) && getThoughtTranslateMode() !== 'off') {
        try {
          window.__agPrismThought?.scan?.();
        } catch {}
      }
      if (flags.full || flags.settings || flags.overlays) {
        ensureSettingsSection();
      }
      if (flags.full || flags.route || flags.composer || flags.overlays || flags.theme) {
        try {
          window.__agPrismTelemetry?.sync?.(cfg);
        } catch {}
        ensurePulseBridge();
      }
    } finally {
      internalDomMutating = prevInt;
    }

    perfStats.lastSyncMs = +(performance.now() - t0).toFixed(3);
    perfStats.syncCount += 1;
  }

  function scheduleSync() {
    if (destroyed || syncQueued) return;
    syncQueued = true;
    if (!document.hidden && typeof requestAnimationFrame === 'function') {
      syncIsRaf = true;
      syncTimer = requestAnimationFrame(() => {
        syncTimer = null;
        syncQueued = false;
        runSync(false);
      });
    } else {
      syncIsRaf = false;
      syncTimer = setTimeout(() => {
        syncTimer = null;
        syncQueued = false;
        runSync(false);
      }, 50);
    }
  }

  function onStoreChanged() {
    const inHero = Boolean(document.querySelector('.agy-home'));
    if (inHero && cfg.homeLayout === 'studio') {
      refreshUsageRollup(false);
    }
    dirtyFlags.composer = true;
    dirtyFlags.route = true;
    scheduleSync();
  }

  function onDocPointerDown(ev) {
    if (ev && ev.target?.closest) {
      const trigBtn = ev.target.closest('button, [role="button"], [data-testid]');
      if (trigBtn && typeof trigBtn.getBoundingClientRect === 'function') {
        const r = trigBtn.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) {
          heroState.lastTriggerOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2, at: performance.now() };
        }
      } else if (Number.isFinite(ev.clientX) && Number.isFinite(ev.clientY)) {
        heroState.lastTriggerOrigin = { x: ev.clientX, y: ev.clientY, at: performance.now() };
      }

      const grp = ev.target.closest('[role="dialog"] [role="group"]');
      if (grp && grp.children) {
        const prevBtn = Array.from(grp.children).find(
          (sib) =>
            sib.getAttribute?.('aria-pressed') === 'true' ||
            sib.hasAttribute?.('data-pressed') ||
            sib.getAttribute?.('aria-checked') === 'true' ||
            sib.getAttribute?.('data-state') === 'on'
        );
        heroState.lastGroupPress = {
          group: grp,
          prevBtn: prevBtn || null,
          prevRect: prevBtn && typeof prevBtn.getBoundingClientRect === 'function' ? prevBtn.getBoundingClientRect() : null,
        };
      }
    }
    if (mascotState.rig && typeof mascotState.rig.notify === 'function') {
      try {
        mascotState.rig.notify('activity', {});
      } catch {}
    }
    queueSmoothCaret(false);
  }

  function onDocCaretEvent(ev) {
    const type = ev?.type || '';
    if (type === 'scroll' || type === 'selectionchange') {
      const ae = document.activeElement;
      if (!ae || !ae.closest?.('[data-testid="agent-input-box"]')) {
        return;
      }
    }
    const isTyping = type === 'input' || type === 'keyup' || type === 'compositionupdate' || type === 'compositionend';
    const immediate = type === 'focusin' || type === 'mouseup' || type === 'transitionend';
    const refreshMetrics = type === 'focusin';
    queueSmoothCaret(isTyping, immediate, refreshMetrics);
    if (type === 'input' && ev?.target?.closest && ev.target.closest('[data-testid="agent-input-box"]')) {
      if (mascotState.rig && typeof mascotState.rig.onUserType === 'function') {
        try {
          const ed = ev.target.closest('[contenteditable="true"]') || ev.target;
          mascotState.rig.onUserType(ed?.textContent || '');
        } catch {}
      }
    }
  }

  function onDocTransitionEnd(ev) {
    if (ev?.target?.closest && ev.target.closest('[data-testid="agent-input-box"]')) {
      queueSmoothCaret(false, true, false);
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (destroyed || internalDomMutating || streamMutating || !mutations || mutations.length === 0) return;

    let anyRelevant = false;
    for (let i = 0; i < mutations.length; i++) {
      const m = mutations[i];
      // 1. 内置中文思考转译绝对隔离：0 扫描、0 同步
      if (isThoughtMutationRecord(m)) continue;
      // 2. 插件自有 DOM 变动绝对隔离
      if (isOwnPluginMutation(m)) continue;

      if (m.type === 'attributes') {
        const tgt = m.target;
        if (tgt === document.body || tgt === document.documentElement) {
          dirtyFlags.theme = true;
          anyRelevant = true;
          continue;
        }
        const tid = String(tgt?.getAttribute?.('data-testid') || '');
        if (tid === 'conversation-row-sidebar') {
          dirtyFlags.sidebar = true;
          anyRelevant = true;
        } else if (tid === 'worked-for-collapsible' || tid === 'thinking-collapsible-trigger') {
          dirtyFlags.collapsible = true;
          dirtyFlags.route = true;
          anyRelevant = true;
        } else if (tid === 'running-items-panel') {
          dirtyFlags.composer = true;
          anyRelevant = true;
        }
        continue;
      }

      if (m.type === 'childList') {
        const added = m.addedNodes;
        if (added && added.length > 0) {
          for (let j = 0; j < added.length; j++) {
            const node = added[j];
            if (!isElementLike(node) || isThoughtIsolatedNode(node) || isOwnPluginNode(node)) continue;
            dirtyAddedRoots.add(node);
            classifyDirtySubtree(node, true);
            anyRelevant = true;
          }
        }
        const removed = m.removedNodes;
        if (removed && removed.length > 0) {
          for (let j = 0; j < removed.length; j++) {
            const node = removed[j];
            if (!isElementLike(node) || isThoughtIsolatedNode(node) || isOwnPluginNode(node)) continue;
            classifyDirtySubtree(node, false);
            if (isElementLike(m.target) && m.target.closest?.('[data-testid="agent-input-box"]')) {
              dirtyFlags.composer = true;
              dirtyFlags.route = true;
            }
            anyRelevant = true;
          }
        }
      }
    }

    if (
      anyRelevant &&
      (dirtyFlags.full ||
        dirtyFlags.theme ||
        dirtyFlags.route ||
        dirtyFlags.sidebar ||
        dirtyFlags.composer ||
        dirtyFlags.buttons ||
        dirtyFlags.overlays ||
        dirtyFlags.collapsible ||
        dirtyFlags.settings ||
        dirtyAddedRoots.size > 0)
    ) {
      scheduleSync();
    }
  });

  // Strict test contract: NEVER register 'click' or 'mousedown' on document!
  const DOC_LISTENERS = [
    ['pointerdown', onDocPointerDown],
    ['keyup', onDocCaretEvent],
    ['mouseup', onDocCaretEvent],
    ['input', onDocCaretEvent],
    ['selectionchange', onDocCaretEvent],
    ['focusin', onDocCaretEvent],
    ['focusout', onDocCaretEvent],
    ['scroll', onDocCaretEvent],
    ['compositionupdate', onDocCaretEvent],
    ['compositionend', onDocCaretEvent],
    ['transitionend', onDocTransitionEnd],
  ];

  const WIN_LISTENERS = [
    ['pointermove', onWinPointerMove, { passive: true }],
    ['resize', onWinResize, { passive: true }],
    ['keydown', onWinKeyDown, false],
    ['click', onWinClick, true],
  ];

  let pollTimer = null;
  let coreTornDown = false;
  function teardownCore() {
    if (coreTornDown) return;
    coreTornDown = true;
    destroyed = true;
    cancelScheduledSync();
    clearTransientTimers();
    dirtyAddedRoots.clear();
    if (streamObserver) {
      try {
        streamObserver.disconnect();
      } catch {}
      streamObserver = null;
      streamObservedRoot = null;
    }
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (storeDebounce) {
      clearTimeout(storeDebounce);
      storeDebounce = null;
    }
    if (workedForClickTimer) {
      clearTimeout(workedForClickTimer);
      workedForClickTimer = 0;
    }
    smoothCaretCtl.teardown();
    if (prismRaf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(prismRaf);
      prismRaf = 0;
    }
    if (storeUnsub) {
      try {
        storeUnsub();
      } catch {}
      storeUnsub = null;
    }
    try {
      observer.disconnect();
    } catch {}
    for (const [evName, handler] of DOC_LISTENERS) {
      try {
        document.removeEventListener(evName, handler, true);
      } catch {}
    }
    if (typeof window.removeEventListener === 'function') {
      for (const [evName, handler, opts] of WIN_LISTENERS) {
        try {
          window.removeEventListener(evName, handler, opts);
        } catch {}
      }
    }
    if (motionBinding && typeof motionBinding.unbind === 'function') {
      try {
        motionBinding.unbind();
      } catch {}
      motionBinding = null;
    }
    if (pulseBridgeInst && typeof pulseBridgeInst.destroy === 'function') {
      try {
        pulseBridgeInst.destroy();
      } catch {}
      pulseBridgeInst = null;
    }
    teardownCrystalMount();

    if (Array.isArray(globalThis.__agCsCleanups)) {
      const idx = globalThis.__agCsCleanups.indexOf(teardownCore);
      if (idx >= 0) globalThis.__agCsCleanups.splice(idx, 1);
    }
  }

  globalThis.__agCsCleanups = Array.isArray(globalThis.__agCsCleanups) ? globalThis.__agCsCleanups : [];
  globalThis.__agCsCleanups.push(teardownCore);

  let lifecycleStarted = false;
  function startLifecycle() {
    if (destroyed || lifecycleStarted || !document.documentElement) return;
    lifecycleStarted = true;
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-expanded', 'data-selected'],
    });
    for (const [evName, handler] of DOC_LISTENERS) {
      document.addEventListener(evName, handler, true);
    }
    if (typeof window.addEventListener === 'function') {
      for (const [evName, handler, opts] of WIN_LISTENERS) {
        window.addEventListener(evName, handler, opts);
      }
      if (motionEngine && typeof motionEngine.bindMicroInteractions === 'function') {
        try {
          motionBinding = motionEngine.bindMicroInteractions(window);
        } catch {}
      }
    }

    syncMotionSpringTokens();

    // 低功耗后台守护定时器（>= 5000ms，document.hidden 时暂停；仅检查主题类名是否漂移，无漂移则 0 DOM 扫描、0 重排！）
    pollTimer = setInterval(() => {
      if (destroyed || document.hidden) return;
      const darkNow = isDarkTheme();
      const expectedThemeKey = `${getEffectivePalette()}|${getLightPreset()}|${darkNow ? 'd' : 'l'}`;
      if (expectedThemeKey !== lastThemeKey || !document.documentElement?.hasAttribute('data-ag-prism')) {
        applyRootAttrs();
      }
      if (wasHero && cfg.homeLayout === 'studio') {
        refreshUsageRollup(false);
      }
    }, Math.max(5000, Number(cfg.pollIntervalMs) || 5000));

    ensureHooks(true);
    markAllDirty();
    runSync(true);
    if (wasHero && cfg.homeLayout === 'studio') {
      refreshUsageRollup(false);
    }
  }

  const prismRuntimeApi = {
    brand: 'Obsidian Prism',
    version: VERSION,
    legacyApiVersion: LEGACY_API_VERSION,
    codeHash: CODE_HASH,
    refreshConfig(next) {
      if (next && typeof next === 'object') {
        cfg = loadSettings({ ...initialConfig, ...next });
      } else {
        cfg = loadSettings({ ...initialConfig, ...cfg });
      }
      markAllDirty();
      applyRootAttrs();
      runSync(true);
    },
    sync() {
      if (!destroyed) runSync(true);
    },
    getState() {
      const convAura = convAuraCtl.getInstance();
      const auraConnected = Boolean(convAura && convAura.host && convAura.host.isConnected);
      const convAuraPhase = auraConnected ? convAuraCtl.advancePhase(performance.now()) : 'off';
      return {
        brand: 'Obsidian Prism',
        version: VERSION,
        cfg: {
          ...cfg,
          palette: getEffectivePalette(),
          lightPreset: getLightPreset(),
          motionLevel: getMotionLevel(),
          telemetryModule: getTelemetryMode(),
          effortSliderModule: getEffortSliderMode(),
          thoughtTranslate: getThoughtTranslateMode(),
          thoughtTrigger: getThoughtTriggerTiming(),
        },
        motionLevel: getMotionLevel(),
        lightPreset: getLightPreset(),
        hasThoughtModule: Boolean(window.__agPrismThought),
        usageRecordsCount: usageRecords.size,
        hasPanel: Boolean(panelEl && panelEl.isConnected),
        hasRipple: Boolean(rippleMount && rippleMount.canvas.isConnected),
        rippleSleeping: Boolean(!rippleMount || rippleMount.sleeping),
        rippleAura: rippleMount ? { ...rippleMount.aura } : null,
        hasConvAura: auraConnected,
        convAuraPhase,
        convAuraSleeping: Boolean(!convAura || convAura.sleeping),
        convAuraDrawCount: convAura ? convAura.drawCount : 0,
        convAuraCanvasSize: convAura ? { width: convAura.width, height: convAura.height } : null,
        convAuraOptics: convAura && convAura.lastOptics ? { ...convAura.lastOptics } : null,
        hasCrab: Boolean(mascotState.root && mascotState.root.isConnected),
        hasDualRig: Boolean(mascotState.rig),
        hasSmoothCaret: Boolean(document.querySelector('.ag-cs-smooth-caret')),
        hasPulseBridge: Boolean(pulseBridgeInst && pulseBridgeInst.getDebugState?.()?.attached),
        hasStreamObserver: Boolean(streamObserver && streamObservedRoot),
        modelInfo: latestPrimaryModelInfo ? { ...latestPrimaryModelInfo } : null,
        perf: { ...perfStats },
      };
    },
    destroy() {
      teardownCore();
      try {
        window.__agPrismTelemetry?.destroy?.();
      } catch {}
      try {
        window.__agPrismEffortSlider?.destroy?.();
      } catch {}
      try {
        window.__agPrismThought?.destroy?.();
      } catch {}
      for (const fn of [
        flushAllStreamArtifacts,
        restoreAllHostAnimatedIcons,
        teardownSmoothCarets,
        unmountRipple,
        unmountConvAura,
        clearWorkedForAutoUnfoldAttrs,
        unmountPanelSeat,
        unmountCrab,
        restoreGreetings,
      ]) {
        try {
          fn();
        } catch {}
      }
      document.querySelectorAll('[data-ag-cs-placeholder]').forEach((el) => el.removeAttribute('data-ag-cs-placeholder'));
      document.querySelectorAll('[data-ag-cs-prism-box]').forEach((el) => {
        el.removeAttribute('data-ag-cs-prism-box');
        el.style.removeProperty('--ag-px');
        el.style.removeProperty('--ag-py');
      });
      document.querySelectorAll('[data-ag-cs-effort]').forEach((el) => {
        el.removeAttribute('data-ag-cs-effort');
        el.classList.remove('ag-cs-effort-badge');
      });
      document.querySelectorAll('[data-ag-cs-queued], [data-ag-cs-takeover]').forEach((el) => {
        el.removeAttribute('data-ag-cs-queued');
        el.removeAttribute('data-ag-cs-takeover');
        el.style.removeProperty('margin-bottom');
      });
      for (const attr of [
        'data-ag-cs-orch-active',
        'data-ag-cs-auto-unfolded',
        'data-ag-cs-outer-open',
        'data-ag-cs-caustic',
        'data-ag-cs-fiber-camp',
        'data-ag-cs-sonar',
        'data-ag-cs-stage-glide',
        'data-ag-cs-liftoff-bubble',
        'data-ag-cs-thought-streaming',
        'data-ag-cs-spark-streaming',
      ]) {
        document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
      }
      document
        .querySelectorAll(
          '.ag-cs-liftoff-veil, .ag-cs-sidebar-glide-pill, .ag-cs-pill-glide, .ag-cs-conv-aura-host, .ag-cs-conv-glow, .ag-cs-model-glyph, .ag-cs-panel-row-glyph, [data-testid="orchestrator-effort-bar"], .ag-cs-thinking-spark, .ag-cs-orbital-backdrop, .ag-cs-inline-stats, .ag-cs-context-ring, .ag-cs-perf-backdrop, #' +
            SETTINGS_SEC_ID
        )
        .forEach((el) => el.remove());
      const html = document.documentElement;
      if (html) {
        for (const attr of [
          'data-ag-prism',
          'data-ag-cs-style',
          'data-ag-cs-palette',
          'data-ag-cs-light-preset',
          'data-ag-cs-motion',
          'data-ag-cs-telemetry',
          'data-ag-cs-effort-slider',
          'data-ag-cs-thought-translate',
          'data-ag-cs-home',
          'data-ag-cs-composer',
          'data-ag-cs-logo-ink',
          'data-ag-cs-sidebar',
          'data-ag-cs-sidebar-compact',
          'data-ag-cs-sidebar-collapsed',
          'data-ag-cs-has-crab',
          'data-ag-cs-lang',
          'data-ag-cs-cjk',
        ]) {
          html.removeAttribute(attr);
        }
        if (html.style && typeof html.style.removeProperty === 'function') {
          html.style.removeProperty('--ag-spring-sidebar-ease');
          html.style.removeProperty('--ag-spring-sidebar-dur');
        }
      }
    },
  };

  window.__agPrism = prismRuntimeApi;
  window.__agClaudeStyle = prismRuntimeApi;

  if (document.documentElement) {
    startLifecycle();
  } else if (typeof document.addEventListener === 'function') {
    const onReady = () => {
      if (document.documentElement) {
        document.removeEventListener('readystatechange', onReady);
        document.removeEventListener('DOMContentLoaded', onReady);
        startLifecycle();
      }
    };
    document.addEventListener('readystatechange', onReady);
    document.addEventListener('DOMContentLoaded', onReady);
  }
});
