(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.__agCsI18nCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const LANG_OPTIONS = Object.freeze([
    { id: 'zh-CN', label: '简体中文', htmlLang: 'zh-CN', intl: 'zh-CN' },
    { id: 'zh-TW', label: '繁體中文', htmlLang: 'zh-TW', intl: 'zh-TW' },
    { id: 'yue', label: '粵語', htmlLang: 'zh-HK', intl: 'zh-HK' },
    { id: 'en', label: 'English', htmlLang: 'en', intl: 'en-US' },
    { id: 'ja', label: '日本語', htmlLang: 'ja', intl: 'ja-JP' },
  ]);

  const LANG_META = Object.fromEntries(LANG_OPTIONS.map((opt) => [opt.id, opt]));

  /**
   * 规范化界面语言标识至插件支持的 5 种本地化语言之一。
   */
  function normalizeLanguage(lang, fallback = 'zh-CN') {
    if (lang === true) return 'zh-CN';
    if (lang === false) return 'en';
    const raw = typeof lang === 'string' ? lang.trim().toLowerCase().replace(/_/g, '-') : '';
    if (!raw) return fallback;
    if (raw === 'en' || raw.startsWith('en-') || raw === 'english') return 'en';
    if (raw === 'ja' || raw.startsWith('ja-') || raw === 'jp' || raw === 'japanese') return 'ja';
    if (
      raw === 'yue' ||
      raw.startsWith('yue-') ||
      raw === 'zh-yue' ||
      raw === 'zh-hk' ||
      raw.startsWith('zh-hk-') ||
      raw === 'zh-mo' ||
      raw.includes('cantonese')
    ) {
      return 'yue';
    }
    if (
      raw === 'zh-tw' ||
      raw === 'zh-hant' ||
      raw.startsWith('zh-hant-') ||
      raw === 'tw' ||
      raw === 'hant'
    ) {
      return 'zh-TW';
    }
    if (raw === 'zh' || raw === 'zh-cn' || raw === 'zh-hans' || raw.startsWith('zh-')) {
      return 'zh-CN';
    }
    return fallback;
  }

  function intlLocale(lang) {
    const id = normalizeLanguage(lang);
    return LANG_META[id]?.intl || 'zh-CN';
  }

  function htmlLangAttr(lang) {
    const id = normalizeLanguage(lang);
    return LANG_META[id]?.htmlLang || 'zh-CN';
  }

  function isCjkLanguage(lang) {
    return normalizeLanguage(lang) !== 'en';
  }

  const DURATION_TOKEN = /(\d+)\s*(months?|mo|weeks?|w|days?|d|hours?|h|minutes?|mins?|m|seconds?|secs?|s|years?|y)\b/g;

  function formatDuration(text, units) {
    if (!text || !units) return null;
    DURATION_TOKEN.lastIndex = 0;
    const parts = [...String(text).matchAll(DURATION_TOKEN)];
    if (!parts.length) return null;
    const leftover = String(text)
      .replace(DURATION_TOKEN, '')
      .replace(/,|\band\b/gi, '')
      .trim();
    if (leftover) return null;
    if (parts.length === 1 && parts[0][2] === 'm' && units.singleMin) {
      return parts[0][1] + units.singleMin;
    }
    const sep = typeof units.joiner === 'string' ? units.joiner : '';
    return parts
      .map((p) => {
        const key = p[2].toLowerCase();
        const unit = units[key] || units[key.replace(/s$/, '')] || key;
        return p[1] + unit;
      })
      .join(sep);
  }

  /**
   * 为避免与宿主原生语言包或独立本地化层冲突并消除额外 MutationObserver 开销，
   * 已禁用全局宿主 DOM 词典覆盖引擎（始终返回 null）。
   */
  function createDomTranslator() {
    return null;
  }

  return {
    LANG_OPTIONS,
    normalizeLanguage,
    intlLocale,
    htmlLangAttr,
    isCjkLanguage,
    formatDuration,
    createDomTranslator,
  };
});
