// Obsidian Prism — Unified Thought Translator & Polisher Client Runtime (v1.0.1 Upgraded)
// Incorporates proven anti-jank & anti-retranslate safeguards + v1.0.1 workbench capabilities:
// 1. Rendered-signature idempotence (`data-op-zh-sig` + `data-raw-zh`) -> 0 redundant DOM rebuilds on cache hit;
// 2. Global `inflightBySig` flight pool across React panel remounts + pre-commit source-hash verification -> 0 duplicate requests & 0 misplacement;
// 3. Monotonic `minHeight` lock during streaming + `scrollTop` preservation + non-regressive pending state -> 0 height collapse jank;
// 4. Safe `file://` source path & `#L` line-anchor pill restoration delegating clicks to host native anchors (strict `file://` whitelist, 0 XSS);
// 5. Explicit `machine-fallback` badge, viewport-first priority scheduling + cancel-pending, per-block retry/retranslate, bilingual stacked view & dual cache management.

(function (root) {
  'use strict';
  const W = root || (typeof window !== 'undefined' ? window : globalThis);
  if (!W) return;

  const OWNER_ID = 'obsidian-prism-thought';
  const LOCAL_CACHE_KEY = 'ag_prism_thought_zh_cache_v1';
  const VIEW_MODE_STORAGE_KEY = 'ag_prism_thought_view_mode_v1';
  const MEM_CACHE_LIMIT = 1500;
  const STORAGE_CACHE_LIMIT = 500;
  const MAX_STORAGE_TOTAL_CHARS = 600000;
  const MAX_STORAGE_ENTRY_CHARS = 32000;
  const STREAM_FLUSH_MS = 48;
  const FINISH_GATE_MS = 450;
  const QUIET_GATE_MS = 900;

  const BLOCK_TAGS = {
    P: 1, DIV: 1, LI: 1, UL: 1, OL: 1, PRE: 1, BLOCKQUOTE: 1,
    H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, TR: 1, HR: 1,
    SECTION: 1, ARTICLE: 1,
  };
  const SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, BUTTON: 1, SVG: 1, NOSCRIPT: 1,
  };

  let currentMode = 'off'; // 'off' | 'machine' | 'ai'
  let triggerTiming = 'preload'; // 'preload' | 'expand'
  let currentViewMode = 'immersive'; // 'immersive' | 'bilingual'
  let currentLang = 'zh-CN'; // 'zh-CN' | 'zh-TW' | 'yue' | 'en' | 'ja'
  let activeStyleTag = ''; // e.g. 'ai_technical' | 'ai_concise' | 'ai_custom_<hash>'
  let cacheWarmed = false;
  let localCacheLoaded = false;
  let viewModeLoaded = false;
  let hasExplicitHostView = false;
  let scanTimer = null;
  let reqSeq = 0;

  const CLIENT_I18N = {
    'zh-CN': {
      rawShow: '原文',
      rawHide: '收起原文',
      fallback: '机翻降级',
      fallbackTitle: '当前未配置可用 AI 模型或密钥，已降级为机翻',
      retranslateTitle: '重新转译此块（跳过缓存）',
      errorText: '转译未完成',
      retryBtn: '↻ 重试',
      pendingMachine: '正在极速机翻思考过程…',
      pendingAi: '正在通过 AI 转译并润色思考过程…',
      pendingStreaming: '思考流式输出中，完结后自动转译…',
      pendingSettling: '正在收束思考上下文…',
    },
    'zh-TW': {
      rawShow: '原文',
      rawHide: '收起原文',
      fallback: '機翻降級',
      fallbackTitle: '目前未設定可用 AI 模型或金鑰，已降級為機器翻譯',
      retranslateTitle: '重新轉譯此區塊（略過快取）',
      errorText: '轉譯未完成',
      retryBtn: '↻ 重試',
      pendingMachine: '正在快速機器翻譯思考過程…',
      pendingAi: '正在透過 AI 轉譯並潤飾思考過程…',
      pendingStreaming: '思考串流輸出中，完成後自動轉譯…',
      pendingSettling: '正在整理思考上下文…',
    },
    yue: {
      rawShow: '原文',
      rawHide: '收埋原文',
      fallback: '機翻降級',
      fallbackTitle: '目前未設定可用 AI 模型或金鑰，已降級為機器翻譯',
      retranslateTitle: '重新轉譯呢一塊（跳過快取）',
      errorText: '轉譯未完成',
      retryBtn: '↻ 重試',
      pendingMachine: '正在機器翻譯思考過程…',
      pendingAi: '正在透過 AI 轉譯同潤飾思考過程…',
      pendingStreaming: '思考串流輸出緊，完成後自動轉譯…',
      pendingSettling: '正在整理思考上下文…',
    },
    en: {
      rawShow: 'Raw',
      rawHide: 'Hide Raw',
      fallback: 'Fallback',
      fallbackTitle: 'AI model or key unavailable; degraded to machine translation',
      retranslateTitle: 'Retranslate block (bypass cache)',
      errorText: 'Translation incomplete',
      retryBtn: '↻ Retry',
      pendingMachine: 'Translating thought block…',
      pendingAi: 'Polishing thought block with AI…',
      pendingStreaming: 'Streaming thought; auto-translating once done…',
      pendingSettling: 'Settling thought context…',
    },
    ja: {
      rawShow: '原文',
      rawHide: '原文を隠す',
      fallback: '機械翻訳代替',
      fallbackTitle: 'AIモデルまたはキーが未設定のため、機械翻訳に切り替えました',
      retranslateTitle: 'このブロックを再翻訳（キャッシュ無視）',
      errorText: '翻訳未完了',
      retryBtn: '↻ 再試行',
      pendingMachine: '思考プロセスを機械翻訳中…',
      pendingAi: 'AIで思考プロセスを翻訳・整形中…',
      pendingStreaming: '思考ストリーミング中、完了後に自動翻訳…',
      pendingSettling: '思考コンテキストを整えています…',
    },
  };

  const memCache = new Map();
  if (W.__agPrismThought && W.__agPrismThought.__memCache instanceof Map) {
    for (const [k, v] of W.__agPrismThought.__memCache.entries()) {
      memCache.set(k, v);
    }
  }
  try { W.__agPrismThought?.destroy?.(); } catch {}

  const failedSigs = new Map();
  const inflightBySig = new Map();
  const trackedWaitPanels = new Map();
  const panelMeta = new WeakMap();
  const lockedHeights = new WeakMap();
  const streamLastLenMap = new WeakMap();
  const panelFileMaps = new WeakMap();

  function normalizeLangCode(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^zh[-_](?:TW|HK|MO|Hant)/i.test(s)) return 'zh-TW';
    if (/^(?:yue|zh[-_]yue)/i.test(s)) return 'yue';
    if (/^ja\b/i.test(s)) return 'ja';
    if (/^en\b/i.test(s)) return 'en';
    if (/^zh\b/i.test(s)) return 'zh-CN';
    return '';
  }

  // Strictly prioritize Prism `data-ag-cs-lang` over host `<html lang="en">`!
  function resolveActiveLang(explicitLang) {
    const fromArg = normalizeLangCode(explicitLang);
    if (fromArg) return fromArg;
    try {
      const docEl = typeof document !== 'undefined' ? document.documentElement : null;
      if (docEl && docEl.getAttribute) {
        const csLang = normalizeLangCode(docEl.getAttribute('data-ag-cs-lang'));
        if (csLang) return csLang;
        const prismLang = normalizeLangCode(docEl.getAttribute('data-ag-prism-lang'));
        if (prismLang) return prismLang;
      }
      const stateLang = normalizeLangCode(W.__agPrism?.getState?.()?.cfg?.language);
      if (stateLang) return stateLang;
    } catch (_) {}
    return currentLang || 'zh-CN';
  }

  function getClientPack(explicitLang) {
    const code = resolveActiveLang(explicitLang);
    return CLIENT_I18N[code] || CLIENT_I18N['zh-CN'];
  }

  function setPanelWaitTimer(panel, btn, fn, delayMs) {
    if (!panel) return;
    clearPanelWaitTimer(panel);
    const timer = setTimeout(() => {
      trackedWaitPanels.delete(panel);
      fn();
    }, delayMs);
    trackedWaitPanels.set(panel, { timer, btn });
  }

  function clearPanelWaitTimer(panel) {
    const rec = trackedWaitPanels.get(panel);
    if (!rec) return;
    clearTimeout(rec.timer);
    trackedWaitPanels.delete(panel);
  }

  function isPanelCurrentlyExpanded(panel) {
    if (!panel) return false;
    const prev = panel.previousElementSibling;
    if (prev && prev.getAttribute && prev.getAttribute('aria-expanded') === 'true') return true;
    if (typeof document !== 'undefined') {
      const triggers = document.querySelectorAll('button[data-testid="thinking-collapsible-trigger"]');
      for (let i = 0; i < triggers.length; i++) {
        if (triggers[i] && triggers[i].nextElementSibling === panel) {
          return triggers[i].getAttribute('aria-expanded') === 'true';
        }
      }
    }
    return false;
  }

  function clearAllWaitTimers(onlyCollapsed = false) {
    for (const [panel, rec] of Array.from(trackedWaitPanels.entries())) {
      const expanded =
        (rec.btn && rec.btn.getAttribute && rec.btn.getAttribute('aria-expanded') === 'true') ||
        isPanelCurrentlyExpanded(panel);
      if (onlyCollapsed && expanded) continue;
      clearTimeout(rec.timer);
      trackedWaitPanels.delete(panel);
      if (!expanded) clearPendingKeepRaw(panel);
    }
  }

  function cancelCollapsedInflightRequests() {
    clearAllWaitTimers(true);
    for (const [sig, entry] of Array.from(inflightBySig.entries())) {
      const keptPanels = [];
      for (let i = 0; i < entry.panels.length; i++) {
        const p = entry.panels[i];
        if (p && p.isConnected && isPanelCurrentlyExpanded(p)) {
          keptPanels.push(p);
        } else if (p) {
          clearPendingKeepRaw(p);
        }
      }
      entry.panels = keptPanels;
      if (keptPanels.length === 0) {
        cancelTranslateRequest(entry);
        inflightBySig.delete(sig);
      }
    }
  }

  function hasAttr(el, name) {
    if (!el) return false;
    if (typeof el.hasAttribute === 'function') return el.hasAttribute(name);
    return typeof el.getAttribute === 'function' && el.getAttribute(name) !== null;
  }

  function findChildByClass(parent, cls) {
    if (!parent || !parent.children) return null;
    for (let i = 0; i < parent.children.length; i++) {
      const ch = parent.children[i];
      if (ch && ch.classList && ch.classList.contains(cls)) return ch;
    }
    return null;
  }

  function normalizeTextKey(str) {
    return String(str || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  function canonicalizeSkeleton(str) {
    return String(str || '')
      .replace(/\r\n/g, '\n')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, '')
      .toLowerCase();
  }

  function hashKey(rawText, prefix) {
    const norm = normalizeTextKey(rawText);
    if (!norm) return '';
    const skel = canonicalizeSkeleton(norm) || norm;
    let h = 2166136261;
    for (let i = 0; i < skel.length; i++) {
      h ^= skel.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `${prefix}_v3_${(h >>> 0).toString(36)}_${skel.length}`;
  }

  function isMostlyZh(text) {
    const norm = normalizeTextKey(text);
    if (!norm || norm.length < 10 || norm.length > 48000) return true;
    const prose = norm
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`\n]+`/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[A-Za-z]:[\\/][^\s"'<>|]+/g, ' ')
      .replace(/(?:\/[A-Za-z0-9._-]+){2,}/g, ' ');
    const cjk = (prose.match(/[\u4e00-\u9fa5]/g) || []).length;
    const latin = (prose.match(/[A-Za-z]/g) || []).length;
    if (cjk >= 24 && cjk / Math.max(1, cjk + latin) >= 0.18) return true;
    if (latin < 12) return true;
    return cjk / Math.max(1, cjk + latin) >= 0.28;
  }

  function loadViewModePreference() {
    if (viewModeLoaded || hasExplicitHostView) {
      viewModeLoaded = true;
      return;
    }
    viewModeLoaded = true;
    try {
      const store = W.localStorage;
      if (!store) return;
      const saved = store.getItem(VIEW_MODE_STORAGE_KEY);
      if (saved === 'bilingual' || saved === 'immersive') {
        currentViewMode = saved;
      }
    } catch (_) {}
  }

  function persistViewModePreference(mode) {
    try {
      const store = W.localStorage;
      if (store) store.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch (_) {}
  }

  function loadLocalStorageCache() {
    if (localCacheLoaded) return;
    localCacheLoaded = true;
    try {
      const store = W.localStorage;
      if (!store) return;
      const raw = store.getItem(LOCAL_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (k && typeof v === 'string' && v.trim()) memCache.set(k, v);
        }
      }
    } catch (_) {}
  }

  let persistTimer = null;

  function flushLocalStorageCacheNow() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    try {
      const store = W.localStorage;
      if (!store) return;
      const entries = Array.from(memCache.entries());
      const picked = [];
      let totalChars = 0;
      for (let i = entries.length - 1; i >= 0 && picked.length < STORAGE_CACHE_LIMIT; i--) {
        const [k, v] = entries[i];
        if (!k || typeof v !== 'string' || v.length > MAX_STORAGE_ENTRY_CHARS) continue;
        const cost = k.length + v.length + 8;
        if (totalChars + cost > MAX_STORAGE_TOTAL_CHARS) break;
        totalChars += cost;
        picked.push([k, v]);
      }
      const writePicked = (list) => {
        const obj = {};
        for (let i = list.length - 1; i >= 0; i--) {
          obj[list[i][0]] = list[i][1];
        }
        store.setItem(LOCAL_CACHE_KEY, JSON.stringify(obj));
      };
      try {
        writePicked(picked);
      } catch (_) {
        if (picked.length > 4) {
          try {
            writePicked(picked.slice(0, Math.floor(picked.length / 2)));
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  function persistLocalStorageCache() {
    if (persistTimer) return;
    persistTimer = setTimeout(flushLocalStorageCacheNow, 1500);
    if (persistTimer && typeof persistTimer.unref === 'function') persistTimer.unref();
  }

  function putMemCache(key, val, persist = true) {
    if (!key || typeof val !== 'string' || !val.trim()) return;
    const trimmed = val.trim();
    if (memCache.has(key)) memCache.delete(key);
    while (memCache.size >= MEM_CACHE_LIMIT) {
      const oldest = memCache.keys().next().value;
      if (oldest === undefined) break;
      memCache.delete(oldest);
    }
    memCache.set(key, trimmed);
    if (persist) persistLocalStorageCache();
  }

  function getLocalCacheStats() {
    loadLocalStorageCache();
    let storageEntries = 0;
    try {
      const store = W.localStorage;
      const raw = store ? store.getItem(LOCAL_CACHE_KEY) : '';
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          storageEntries = Object.keys(parsed).length;
        }
      }
    } catch (_) {}
    return {
      ok: true,
      memEntries: memCache.size,
      storageEntries,
    };
  }

  function clearLocalCache() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    const cleared = memCache.size;
    memCache.clear();
    failedSigs.clear();
    try {
      const store = W.localStorage;
      if (store && typeof store.removeItem === 'function') {
        store.removeItem(LOCAL_CACHE_KEY);
      }
    } catch (_) {}
    return {
      ok: true,
      cleared,
      memEntries: 0,
      storageEntries: 0,
    };
  }

  function isSigInCooldown(sig) {
    const rec = failedSigs.get(sig);
    if (!rec) return false;
    if (Date.now() >= rec.retryAfter) {
      failedSigs.delete(sig);
      return false;
    }
    return true;
  }

  function recordSigFailure(sig) {
    if (!sig) return;
    const prev = failedSigs.get(sig);
    const count = prev ? prev.count + 1 : 1;
    const delayMs = count === 1 ? 15000 : count === 2 ? 45000 : 120000;
    failedSigs.set(sig, { count, retryAfter: Date.now() + delayMs });
  }

  function getBridge() {
    return W.__agPrismThoughtBridge || null;
  }

  // Strictly prioritize `__agPrismThoughtBridge` over raw V8 CDP binding `__agPrismThoughtCall(jsonStr) -> void`!
  function callDaemonRpc(payload) {
    try {
      const br = getBridge();
      if (br) {
        const act = payload && payload.action;
        if (act === 'cache-stats' && typeof br.cacheStats === 'function') {
          return Promise.resolve().then(() => br.cacheStats());
        }
        if (act === 'clear-cache' && typeof br.clearCache === 'function') {
          return Promise.resolve().then(() => br.clearCache());
        }
        if (act === 'cancel-translate' && typeof br.cancelTranslate === 'function') {
          return Promise.resolve().then(() => br.cancelTranslate(payload));
        }
        if (typeof br.call === 'function') {
          return Promise.resolve().then(() => br.call(payload));
        }
      }
      if (typeof W.__agPrismThoughtCall === 'function') {
        const ret = W.__agPrismThoughtCall(payload);
        if (ret && typeof ret.then === 'function') return ret;
      }
    } catch (_) {}
    return Promise.resolve({ ok: false, offline: true });
  }

  function syncDocViewAttribute() {
    try {
      const docEl = typeof document !== 'undefined' && document.documentElement;
      if (docEl && docEl.setAttribute) {
        docEl.setAttribute('data-ag-prism-thought-view', currentViewMode);
      }
    } catch (_) {}
  }

  function ensureInitialized() {
    loadLocalStorageCache();
    loadViewModePreference();
    try {
      const docEl = typeof document !== 'undefined' && document.documentElement;
      if (docEl && docEl.getAttribute('data-ag-prism-thought-owner') !== OWNER_ID) {
        docEl.setAttribute('data-ag-prism-thought-owner', OWNER_ID);
      }
      syncDocViewAttribute();
    } catch (_) {}

    if (cacheWarmed) return;
    cacheWarmed = true;
    const br = getBridge();
    if (br && typeof br.call === 'function') {
      br.call({ action: 'get-cache' })
        .then((res) => {
          const nextTag = res?.styleTag || (res?.stylePreset ? `ai_${res.stylePreset}` : '');
          if (nextTag && nextTag !== activeStyleTag) {
            activeStyleTag = nextTag;
          }
          if (!hasExplicitHostView && (res?.viewMode === 'bilingual' || res?.viewMode === 'immersive')) {
            let hasLocalPref = false;
            try {
              hasLocalPref = Boolean(W.localStorage && W.localStorage.getItem(VIEW_MODE_STORAGE_KEY));
            } catch (_) {}
            if (!hasLocalPref && res.viewMode !== currentViewMode) {
              currentViewMode = res.viewMode;
              syncDocViewAttribute();
              refreshAllPanelViewModes();
            }
          }
          if (res && res.entries && typeof res.entries === 'object') {
            let added = 0;
            for (const [k, v] of Object.entries(res.entries)) {
              if (k && typeof v === 'string' && v.trim()) {
                putMemCache(k, v, false);
                added++;
              }
            }
            if (added > 0) {
              persistLocalStorageCache();
            }
          }
          scheduleScan(20);
        })
        .catch(() => {});
    }
  }

  function cancelFlushHandle(entry) {
    if (!entry || !entry.flushTimer) return;
    if (entry.flushIsRaf && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(entry.flushTimer);
    } else {
      clearTimeout(entry.flushTimer);
    }
    entry.flushTimer = null;
    entry.flushIsRaf = false;
  }

  function cancelTranslateRequest(entry) {
    if (!entry || entry.cancelled) return;
    entry.cancelled = true;
    cancelFlushHandle(entry);
    if (entry.requestId) {
      void callDaemonRpc({ action: 'cancel-translate', requestId: entry.requestId }).catch(() => {});
    }
  }

  function applyPanelViewMode(panel) {
    if (!panel) return;
    const ov = findDirectOverlay(panel);
    const isFailed = panel.getAttribute('data-op-zh-failed') === '1';
    const manualRaw = panel.getAttribute('data-op-manual-raw');

    let shouldShowRaw = false;
    if (isFailed) {
      shouldShowRaw = true;
    } else if (manualRaw === '1') {
      shouldShowRaw = true;
    } else if (manualRaw === '0') {
      shouldShowRaw = false;
    } else {
      shouldShowRaw = currentViewMode === 'bilingual';
    }

    if (shouldShowRaw) {
      panel.setAttribute('data-op-show-raw', '1');
    } else {
      panel.removeAttribute('data-op-show-raw');
    }

    if (currentViewMode === 'bilingual' && shouldShowRaw && !isFailed) {
      panel.setAttribute('data-op-bilingual', '1');
    } else {
      panel.removeAttribute('data-op-bilingual');
    }

    if (ov) {
      const toggleBtn = findChildByClass(ov, 'ag-prism-thought-raw-toggle');
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-pressed', String(shouldShowRaw));
        const t = getClientPack();
        toggleBtn.textContent = shouldShowRaw ? t.rawHide : t.rawShow;
      }
    }
  }

  function refreshAllOverlayLocaleStrings() {
    if (typeof document === 'undefined') return;
    const t = getClientPack();
    document.querySelectorAll('.ag-prism-thought-overlay[data-op-thought="1"]').forEach((ov) => {
      const panel = ov.parentElement;
      const fallbackBadge = findChildByClass(ov, 'ag-prism-thought-fallback-badge');
      if (fallbackBadge) {
        fallbackBadge.textContent = t.fallback;
        fallbackBadge.title = t.fallbackTitle;
      }
      const retranslateBtn = findChildByClass(ov, 'ag-prism-thought-retranslate-btn');
      if (retranslateBtn) {
        retranslateBtn.title = t.retranslateTitle;
        retranslateBtn.setAttribute('aria-label', t.retranslateTitle);
      }
      const toggleBtn = findChildByClass(ov, 'ag-prism-thought-raw-toggle');
      if (toggleBtn) {
        const showingRaw = Boolean(panel && panel.getAttribute('data-op-show-raw') === '1');
        toggleBtn.textContent = showingRaw ? t.rawHide : t.rawShow;
      }
      const body = findChildByClass(ov, 'ag-prism-thought-body');
      if (body) {
        const errBar = findChildByClass(body, 'ag-prism-thought-error-bar');
        if (errBar) {
          const errTxt = findChildByClass(errBar, 'ag-prism-thought-error-text');
          if (errTxt) errTxt.textContent = t.errorText;
          const retryBtn = findChildByClass(errBar, 'ag-prism-thought-retry-btn');
          if (retryBtn) retryBtn.textContent = t.retryBtn;
        }
        const pendingHint = findChildByClass(body, 'ag-prism-thought-pending-hint');
        if (pendingHint && pendingHint.getAttribute) {
          const kind = pendingHint.getAttribute('data-pending-kind');
          if (kind === 'machine') pendingHint.textContent = t.pendingMachine;
          else if (kind === 'ai') pendingHint.textContent = t.pendingAi;
          else if (kind === 'streaming') pendingHint.textContent = t.pendingStreaming;
          else if (kind === 'settling') pendingHint.textContent = t.pendingSettling;
        }
      }
    });
  }

  function refreshAllPanelViewModes() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.ag-prism-thought-overlay[data-op-thought="1"]').forEach((ov) => {
      if (ov.parentElement) applyPanelViewMode(ov.parentElement);
    });
  }

  function cleanSinglePanelAttributes(panel) {
    if (!panel) return;
    lockedHeights.delete(panel);
    clearPanelWaitTimer(panel);
    panelMeta.delete(panel);
    const ov = findDirectOverlay(panel);
    if (ov) ov.remove();
    panel.removeAttribute('data-op-zh-ready');
    panel.removeAttribute('data-op-zh-pending');
    panel.removeAttribute('data-op-zh-failed');
    panel.removeAttribute('data-op-zh-fallback');
    panel.removeAttribute('data-op-zh-sig');
    panel.removeAttribute('data-op-show-raw');
    panel.removeAttribute('data-op-manual-raw');
    panel.removeAttribute('data-op-bilingual');
    panel.removeAttribute('data-op-thought-panel');
    if (panel.style) panel.style.removeProperty('min-height');
  }

  function releasePrismOverlays() {
    clearAllWaitTimers(false);
    for (const entry of inflightBySig.values()) {
      cancelTranslateRequest(entry);
    }
    inflightBySig.clear();
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.ag-prism-thought-overlay[data-op-thought="1"]').forEach((ov) => {
      const panel = ov.parentElement;
      ov.remove();
      if (panel) cleanSinglePanelAttributes(panel);
    });
    document.querySelectorAll('button[data-testid="thinking-collapsible-trigger"]').forEach((btn) => {
      if (btn && btn.nextElementSibling) {
        cleanSinglePanelAttributes(btn.nextElementSibling);
      }
    });
    try {
      document.documentElement?.removeAttribute?.('data-ag-prism-thought-owner');
      document.documentElement?.removeAttribute?.('data-ag-prism-thought-view');
    } catch (_) {}
  }

  function isTriggerStreaming(btn) {
    if (!btn) return false;
    if (btn.getAttribute('data-op-thought-state') === 'streaming') return true;
    if (btn.getAttribute('data-ag-cs-spark-streaming') === '1') return true;
    try {
      if (
        btn.querySelector &&
        btn.querySelector(
          '.animate-shimmer-text, .animate-spin, .animate-pulse, [class*="animate-shimmer"], .ag-cs-thinking-spark[data-state="streaming"]'
        )
      ) {
        return true;
      }
    } catch (_) {}
    const txt = (btn.textContent || '').trim();
    if (!txt) return false;
    if (/已思考|Thought\s+for|Thought\s+process/i.test(txt)) return false;
    if (/thinking|正在思考|思考中|推演中|諗緊/i.test(txt) && !/\d+\s*(s|sec|秒|m|min|分)/i.test(txt)) {
      return true;
    }
    return false;
  }

  function isOverlayOrIgnoredElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (hasAttr(el, 'data-op-thought') || hasAttr(el, 'data-prism-ignore')) return true;
    const cls = String((el.getAttribute && el.getAttribute('class')) || el.className || '');
    return cls.includes('ag-prism-thought-overlay') || cls.includes('-zh-overlay');
  }

  // Strict security whitelist: ONLY allow `file://` URIs; reject `javascript:`, `data:`, `vbscript:`, `http(s):`, etc.
  function sanitizeFileHref(rawHref) {
    const trimmed = String(rawHref || '').trim().replace(/^<|>$/g, '');
    if (!trimmed) return '';
    if (/[\u0000-\u001f\u007f"'<>`]/.test(trimmed)) return '';
    if (!/^file:\/\//i.test(trimmed)) return '';
    try {
      if (typeof URL === 'function') {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'file:') return '';
        return parsed.href;
      }
    } catch {
      return '';
    }
    return /^file:\/\/[^\s"'<>`]+$/i.test(trimmed) ? trimmed : '';
  }

  function filePathToSafeHref(rawPath) {
    const p = String(rawPath || '').trim();
    if (!p || /[\u0000-\u001f\u007f"'<>`]/.test(p)) return '';
    if (/^file:\/\//i.test(p)) return sanitizeFileHref(p);
    if (/^[A-Za-z]:[\\/]/.test(p)) {
      return sanitizeFileHref('file:///' + p.replace(/\\/g, '/'));
    }
    if (p.startsWith('/')) {
      return sanitizeFileHref('file://' + p);
    }
    return '';
  }

  function normalizeFileHrefForMatch(href) {
    const safe = sanitizeFileHref(href);
    if (!safe) return '';
    let s = safe;
    try {
      s = decodeURIComponent(safe);
    } catch (_) {}
    return s.replace(/\\/g, '/').replace(/^file:\/\/\/([A-Z]):/i, (_, d) => `file:///${d.toLowerCase()}:`).toLowerCase();
  }

  function parseFileHrefParts(safeHref) {
    const hashIdx = safeHref.indexOf('#');
    const baseHref = hashIdx >= 0 ? safeHref.slice(0, hashIdx) : safeHref;
    const hash = hashIdx >= 0 ? safeHref.slice(hashIdx) : '';
    let decodedPath = baseHref.replace(/^file:\/\/(?:localhost)?/i, '');
    try {
      decodedPath = decodeURIComponent(decodedPath);
    } catch (_) {}
    decodedPath = decodedPath.replace(/\\/g, '/');
    const segs = decodedPath.split('/').filter(Boolean);
    const basename = segs.length ? segs[segs.length - 1] : '';
    const parentAndBase = segs.length >= 2 ? `${segs[segs.length - 2]}/${basename}` : basename;
    return { baseHref, hash, decodedPath, basename, parentAndBase };
  }

  function normalizeLineHashSuffix(rawLinePart) {
    if (!rawLinePart) return '';
    if (/^#L\d+/i.test(rawLinePart)) {
      const m = /^#L(\d+)(?:-L?(\d+))?/i.exec(rawLinePart);
      return m ? (m[2] ? `#L${m[1]}-L${m[2]}` : `#L${m[1]}`) : '';
    }
    const colon = /^:(\d+)(?:-(\d+))?/.exec(rawLinePart);
    if (colon) {
      return colon[2] ? `#L${colon[1]}-L${colon[2]}` : `#L${colon[1]}`;
    }
    return '';
  }

  function createEmptyFileMap() {
    return {
      entries: [],
      byNormHref: new Map(),
      byToken: new Map(),
      byBaseToken: new Map(),
    };
  }

  function registerFileNodeInMap(node, fileMap) {
    if (!node || !fileMap) return;
    const tag = node.tagName ? String(node.tagName).toUpperCase() : '';
    const rawHref =
      (tag === 'A' && ((node.getAttribute && node.getAttribute('href')) || node.href)) ||
      (node.getAttribute && (node.getAttribute('data-file-href') || node.getAttribute('data-href'))) ||
      '';
    let safeHref = sanitizeFileHref(rawHref);
    let omniRelRef = '';
    if (!safeHref && node.getAttribute) {
      const rawPath =
        node.getAttribute('data-file-path') ||
        node.getAttribute('data-filepath') ||
        node.getAttribute('data-omni-path') ||
        '';
      if (rawPath) {
        const lineStart = node.getAttribute('data-line') || node.getAttribute('data-omni-line-start') || '';
        const lineEnd = node.getAttribute('data-omni-line-end') || '';
        const hashSuffix =
          lineStart && /^\d+$/.test(lineStart)
            ? lineEnd && /^\d+$/.test(lineEnd) && lineEnd !== lineStart
              ? `#L${lineStart}-L${lineEnd}`
              : `#L${lineStart}`
            : '';
        const base = filePathToSafeHref(rawPath);
        if (base) {
          safeHref = hashSuffix ? `${base}${hashSuffix}` : base;
        } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawPath) && !/[\u0000-\u001f\u007f"'<>`]/.test(rawPath)) {
          omniRelRef = `${rawPath.trim().replace(/\\/g, '/')}${hashSuffix}`;
        }
      }
    }
    if (!safeHref && !omniRelRef) return;

    const label = String(node.textContent || '')
      .trim()
      .replace(/^`+|`+$/g, '')
      .trim();

    if (!safeHref && omniRelRef) {
      const hashIdx = omniRelRef.indexOf('#');
      const baseRel = hashIdx >= 0 ? omniRelRef.slice(0, hashIdx) : omniRelRef;
      const hash = hashIdx >= 0 ? omniRelRef.slice(hashIdx) : '';
      const segs = baseRel.split('/').filter(Boolean);
      const basename = segs.length ? segs[segs.length - 1] : '';
      const parentAndBase = segs.length >= 2 ? `${segs[segs.length - 2]}/${basename}` : basename;
      const rec = {
        el: node,
        href: '',
        omniRelRef,
        baseRel,
        normHref: '',
        baseHref: '',
        hash,
        decodedPathLower: `/${baseRel.toLowerCase()}`,
        label,
      };
      fileMap.entries.push(rec);
      const addExact = (k) => {
        const key = String(k || '').trim().replace(/\\/g, '/').toLowerCase();
        if (key && !fileMap.byToken.has(key)) fileMap.byToken.set(key, rec);
      };
      const addBase = (k) => {
        const key = String(k || '').trim().replace(/\\/g, '/').toLowerCase();
        if (key && !fileMap.byBaseToken.has(key)) fileMap.byBaseToken.set(key, rec);
      };
      if (label && (/[./\\]/.test(label) || /#L\d+/i.test(label))) {
        addExact(label);
        if (!/#L\d+|:\d+/i.test(label)) addBase(label);
      }
      if (basename && basename.includes('.')) {
        if (hash) {
          addExact(`${basename}${hash}`);
          if (parentAndBase !== basename) addExact(`${parentAndBase}${hash}`);
        }
        addBase(basename);
        if (parentAndBase !== basename) addBase(parentAndBase);
        addBase(baseRel);
      }
      return;
    }

    const normHref = normalizeFileHrefForMatch(safeHref);
    const parts = parseFileHrefParts(safeHref);
    const rec = {
      el: node,
      href: safeHref,
      omniRelRef: '',
      normHref,
      baseHref: parts.baseHref,
      hash: parts.hash,
      decodedPathLower: parts.decodedPath.toLowerCase(),
      label,
    };

    fileMap.entries.push(rec);
    if (!fileMap.byNormHref.has(normHref)) {
      fileMap.byNormHref.set(normHref, rec);
    }

    const addExact = (k) => {
      const key = String(k || '').trim().replace(/\\/g, '/').toLowerCase();
      if (key && !fileMap.byToken.has(key)) fileMap.byToken.set(key, rec);
    };
    const addBase = (k) => {
      const key = String(k || '').trim().replace(/\\/g, '/').toLowerCase();
      if (key && !fileMap.byBaseToken.has(key)) fileMap.byBaseToken.set(key, rec);
    };

    if (label && (/[./\\]/.test(label) || /#L\d+/i.test(label))) {
      addExact(label);
      if (!/#L\d+|:\d+/i.test(label) && !parts.hash) {
        addBase(label);
      } else if (!/#L\d+|:\d+/i.test(label) && parts.hash) {
        addBase(label);
      }
    }

    if (parts.basename && parts.basename.includes('.')) {
      if (parts.hash) {
        addExact(`${parts.basename}${parts.hash}`);
        if (parts.parentAndBase !== parts.basename) {
          addExact(`${parts.parentAndBase}${parts.hash}`);
        }
      }
      addBase(parts.basename);
      if (parts.parentAndBase !== parts.basename) {
        addBase(parts.parentAndBase);
      }
    }
  }

  function collectCleanText(node, chunks, fileMap) {
    if (!node) return;
    const nt = node.nodeType;
    if (nt === 3) {
      if (node.nodeValue !== undefined && node.nodeValue !== null) chunks.push(node.nodeValue);
      else if (node.textContent) chunks.push(node.textContent);
      return;
    }
    if (nt !== 1 || isOverlayOrIgnoredElement(node)) return;
    const tag = node.tagName ? String(node.tagName).toUpperCase() : '';
    if (SKIP_TAGS[tag]) return;
    if (tag === 'BR') {
      chunks.push('\n');
      return;
    }
    if (fileMap) {
      registerFileNodeInMap(node, fileMap);
    }
    const isBlock = Boolean(BLOCK_TAGS[tag]);
    if (isBlock) chunks.push('\n');
    const children = node.childNodes;
    if (children && children.length) {
      for (let i = 0; i < children.length; i++) {
        collectCleanText(children[i], chunks, fileMap);
      }
    } else if (typeof node.textContent === 'string' && (!node.children || node.children.length === 0)) {
      chunks.push(node.textContent);
    }
    if (isBlock) chunks.push('\n');
  }

  function extractRawEnglishText(panel) {
    if (!panel || !panel.childNodes) return '';
    const chunks = [];
    const fileMap = createEmptyFileMap();
    for (let i = 0; i < panel.childNodes.length; i++) {
      collectCleanText(panel.childNodes[i], chunks, fileMap);
    }
    panelFileMaps.set(panel, fileMap);
    return normalizeTextKey(chunks.join(''));
  }

  function ensurePanelFileMap(panel) {
    if (!panel) return null;
    const existing = panelFileMaps.get(panel);
    if (existing) return existing;
    extractRawEnglishText(panel);
    return panelFileMaps.get(panel) || null;
  }

  function lookupFileTarget(fileMap, rawCandidate) {
    const cleaned = String(rawCandidate || '')
      .trim()
      .replace(/^`+|`+$/g, '')
      .trim();
    if (!cleaned) return null;

    if (/^file:\/\//i.test(cleaned)) {
      const safe = sanitizeFileHref(cleaned);
      if (!safe) return null;
      const hit = fileMap ? fileMap.byNormHref.get(normalizeFileHrefForMatch(safe)) : null;
      return { href: safe, nativeEl: hit ? hit.el : null };
    }

    if (!fileMap || !fileMap.entries.length) return null;

    const normToken = cleaned.replace(/\\/g, '/').replace(/^\.\//, '');
    const lowerToken = normToken.toLowerCase();

    const exactHit = fileMap.byToken.get(lowerToken);
    if (exactHit) {
      return { href: exactHit.href, omniRelRef: exactHit.omniRelRef || '', nativeEl: exactHit.el };
    }

    const lineSplit = /^(.+?)(#L\d+(?:-L?\d+)?|:\d+(?:-\d+)?(?::\d+)?)$/i.exec(normToken);
    const basePart = (lineSplit ? lineSplit[1] : normToken).toLowerCase();
    const normHash = lineSplit ? normalizeLineHashSuffix(lineSplit[2]) : '';

    if (normHash) {
      const withHashHit = fileMap.byToken.get(`${basePart}${normHash.toLowerCase()}`);
      if (withHashHit) {
        return { href: withHashHit.href, omniRelRef: withHashHit.omniRelRef || '', nativeEl: withHashHit.el };
      }
    }

    let baseRec = fileMap.byBaseToken.get(basePart) || null;
    if (!baseRec && basePart.includes('/')) {
      const suffix = `/${basePart}`;
      for (let i = 0; i < fileMap.entries.length; i++) {
        if (fileMap.entries[i].decodedPathLower.endsWith(suffix)) {
          baseRec = fileMap.entries[i];
          break;
        }
      }
    }

    if (!baseRec) return null;

    if (baseRec.omniRelRef && !baseRec.href) {
      const composedRel = normHash ? `${baseRec.baseRel}${normHash}` : baseRec.omniRelRef;
      return {
        href: '',
        omniRelRef: composedRel,
        nativeEl: !normHash || baseRec.hash.toLowerCase() === normHash.toLowerCase() ? baseRec.el : null,
      };
    }

    if (normHash) {
      const composedHref = sanitizeFileHref(`${baseRec.baseHref}${normHash}`);
      if (!composedHref) return null;
      const exactAnchor = fileMap.byNormHref.get(normalizeFileHrefForMatch(composedHref));
      return {
        href: composedHref,
        omniRelRef: '',
        nativeEl: exactAnchor
          ? exactAnchor.el
          : !baseRec.hash || baseRec.hash.toLowerCase() === normHash.toLowerCase()
          ? baseRec.el
          : null,
      };
    }

    return { href: baseRec.href, omniRelRef: '', nativeEl: baseRec.el };
  }

  function findLiveAnchorInTree(node, targetNormHref, targetBaseHref, out) {
    if (!node || node.nodeType !== 1 || isOverlayOrIgnoredElement(node)) return;
    const tag = node.tagName ? String(node.tagName).toUpperCase() : '';
    if (tag === 'A' || (node.getAttribute && (node.getAttribute('data-file-href') || node.getAttribute('data-file-path')))) {
      const rawHref = (node.getAttribute && (node.getAttribute('href') || node.getAttribute('data-file-href'))) || node.href || '';
      const safe = sanitizeFileHref(rawHref);
      if (safe) {
        const norm = normalizeFileHrefForMatch(safe);
        if (norm === targetNormHref && !out.exact) {
          out.exact = node;
          return;
        }
        const base = parseFileHrefParts(safe).baseHref.toLowerCase();
        if (base === targetBaseHref && !out.base) {
          out.base = node;
        }
      }
    }
    const children = node.children || node.childNodes;
    if (children && children.length) {
      for (let i = 0; i < children.length && !out.exact; i++) {
        findLiveAnchorInTree(children[i], targetNormHref, targetBaseHref, out);
      }
    }
  }

  function resolveLiveNativeAnchor(panel, safeHref, cachedEl) {
    if (cachedEl && cachedEl.isConnected !== false && typeof cachedEl.click === 'function') {
      return cachedEl;
    }
    if (!panel || !panel.childNodes) return null;
    const targetNormHref = normalizeFileHrefForMatch(safeHref);
    const targetBaseHref = parseFileHrefParts(safeHref).baseHref.toLowerCase();
    const out = { exact: null, base: null };
    for (let i = 0; i < panel.childNodes.length && !out.exact; i++) {
      findLiveAnchorInTree(panel.childNodes[i], targetNormHref, targetBaseHref, out);
    }
    return out.exact || out.base || null;
  }

  function openInOmniFallback(rawPathOrUri, safeHref, ev) {
    const omni = W.__agPrismOmni;
    if (!omni || typeof omni.openFile !== 'function') return false;
    const rawStr = String(rawPathOrUri || safeHref || '').trim();
    if (!rawStr) return false;
    let filePath = rawStr;
    let lineStart = null;
    let lineEnd = null;
    if (safeHref) {
      const parts = parseFileHrefParts(safeHref);
      const hm = /^#L(\d+)(?:-L?(\d+))?/i.exec(parts.hash || '');
      lineStart = hm ? parseInt(hm[1], 10) : null;
      lineEnd = hm && hm[2] ? parseInt(hm[2], 10) : lineStart;
      filePath = parts.decodedPath || safeHref;
      if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1);
    } else {
      const hm = /#L(\d+)(?:-L?(\d+))?$/i.exec(filePath);
      if (hm) {
        lineStart = parseInt(hm[1], 10);
        lineEnd = hm[2] ? parseInt(hm[2], 10) : lineStart;
        filePath = filePath.slice(0, hm.index);
      }
    }
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    void omni.openFile(filePath, {
      mode: ev && (ev.ctrlKey || ev.metaKey) ? 'external' : 'workbench',
      rawUri: safeHref || undefined,
      lineStart,
      lineEnd,
    });
    return true;
  }

  function createFilePill(doc, labelText, targetHref, nativeEl, panel, omniRelRef = '') {
    const safeHref = sanitizeFileHref(targetHref);
    const cleanRel =
      !safeHref && omniRelRef && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(omniRelRef) && !/[\u0000-\u001f\u007f"'<>`]/.test(omniRelRef)
        ? String(omniRelRef).trim()
        : '';
    if (!safeHref && !cleanRel) {
      return doc.createTextNode(labelText);
    }
    const pill = doc.createElement(safeHref ? 'a' : 'span');
    pill.className = 'ag-prism-thought-file-pill';
    if (safeHref) {
      pill.setAttribute('href', safeHref);
      pill.setAttribute('title', safeHref);
    } else {
      pill.setAttribute('role', 'link');
      pill.setAttribute('tabindex', '0');
      pill.setAttribute('data-file-path', cleanRel);
      pill.setAttribute('title', cleanRel);
    }
    pill.setAttribute('data-file-pill', '1');
    if (pill.style) {
      pill.style.cursor = 'pointer';
      pill.style.textDecoration = 'underline';
      pill.style.textUnderlineOffset = '2px';
    }
    pill.textContent = labelText;
    pill.addEventListener('click', (ev) => {
      if (ev && typeof ev.button === 'number' && ev.button !== 0) return;
      const targetAnchor = safeHref
        ? resolveLiveNativeAnchor(panel, safeHref, nativeEl)
        : nativeEl && nativeEl.isConnected !== false && typeof nativeEl.click === 'function'
        ? nativeEl
        : null;
      if (targetAnchor && targetAnchor !== pill && typeof targetAnchor.click === 'function') {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
        targetAnchor.click();
        return;
      }
      openInOmniFallback(cleanRel || safeHref, safeHref, ev);
    });
    return pill;
  }

  function appendPlainTextWithFileRefs(parent, plainSlice, doc, fileMap, panel) {
    if (!plainSlice) return;
    const refRe =
      /(file:\/\/[^\s"'<>()`\uff0c\u3002\uff1b\uff01\uff1f\u3001\uff08\uff09\u3010\u3011\]]+|(?:[A-Za-z0-9_.-]+[\\/])*[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8}(?:#L\d+(?:-L?\d+)?|:\d+(?:-\d+)?)?)/g;
    let last = 0;
    let m;
    while ((m = refRe.exec(plainSlice)) !== null) {
      let rawTok = m[0];
      let trailing = '';
      if (/^file:\/\//i.test(rawTok)) {
        const stripped = rawTok.replace(/[.,;:!?]+$/, '');
        trailing = rawTok.slice(stripped.length);
        rawTok = stripped;
      }
      const hit = lookupFileTarget(fileMap, rawTok);
      if (hit && (hit.href || hit.omniRelRef)) {
        if (m.index > last) {
          parent.appendChild(doc.createTextNode(plainSlice.slice(last, m.index)));
        }
        let displayLabel = rawTok;
        if (/^file:\/\//i.test(rawTok) && hit.href) {
          const parts = parseFileHrefParts(hit.href);
          displayLabel = parts.basename ? `${parts.basename}${parts.hash}` : rawTok;
        }
        parent.appendChild(createFilePill(doc, displayLabel, hit.href, hit.nativeEl, panel, hit.omniRelRef));
        if (trailing) {
          parent.appendChild(doc.createTextNode(trailing));
        }
        last = m.index + m[0].length;
      }
    }
    if (last < plainSlice.length) {
      parent.appendChild(doc.createTextNode(plainSlice.slice(last)));
    }
  }

  function appendInlineFormatted(parent, lineText, doc, fileMap, panel, depth = 0) {
    const tokenRe = /(\[([^\[\]\n]+)\]\(((?:\([^()\s]*\)|[^()\s])+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*)/g;
    let lastIdx = 0;
    let m;
    while ((m = tokenRe.exec(lineText)) !== null) {
      if (m.index > lastIdx) {
        appendPlainTextWithFileRefs(parent, lineText.slice(lastIdx, m.index), doc, fileMap, panel);
      }
      if (m[2] !== undefined && m[3] !== undefined) {
        const cleanLabel = m[2].trim().replace(/^`+|`+$/g, '').trim() || m[2].trim();
        const rawUrl = m[3].trim();
        const safeHref = sanitizeFileHref(rawUrl);
        if (safeHref) {
          const hit = lookupFileTarget(fileMap, safeHref) || lookupFileTarget(fileMap, cleanLabel);
          parent.appendChild(createFilePill(doc, cleanLabel, safeHref, hit ? hit.nativeEl : null, panel));
        } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawUrl)) {
          const mapped = lookupFileTarget(fileMap, rawUrl) || lookupFileTarget(fileMap, cleanLabel);
          if (mapped && (mapped.href || mapped.omniRelRef)) {
            parent.appendChild(createFilePill(doc, cleanLabel, mapped.href, mapped.nativeEl, panel, mapped.omniRelRef));
          } else {
            parent.appendChild(doc.createTextNode(cleanLabel));
          }
        } else {
          // Non-file scheme (e.g. javascript:, data:, http:): never render executable href, emit safe plain text only
          parent.appendChild(doc.createTextNode(cleanLabel));
        }
      } else if (m[4] !== undefined) {
        const codeInner = m[4];
        const hit = lookupFileTarget(fileMap, codeInner);
        if (hit && (hit.href || hit.omniRelRef)) {
          parent.appendChild(createFilePill(doc, codeInner.trim(), hit.href, hit.nativeEl, panel, hit.omniRelRef));
        } else {
          const code = doc.createElement('code');
          code.className = 'ag-prism-thought-code';
          code.textContent = codeInner;
          parent.appendChild(code);
        }
      } else if (m[5] !== undefined) {
        const strong = doc.createElement('strong');
        if (depth < 2) {
          appendInlineFormatted(strong, m[5], doc, fileMap, panel, depth + 1);
        } else {
          strong.textContent = m[5];
        }
        parent.appendChild(strong);
      }
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < lineText.length) {
      appendPlainTextWithFileRefs(parent, lineText.slice(lastIdx), doc, fileMap, panel);
    }
  }

  // Zero-textContent O(1) structural check for high-frequency streaming frames (0 string concatenation!)
  function quickStructureSig(panel) {
    if (!panel || !panel.childNodes) return null;
    const nodes = panel.childNodes;
    let count = 0;
    let first = null;
    let last = null;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.nodeType === 1 && isOverlayOrIgnoredElement(n)) continue;
      count++;
      if (count === 1) first = n;
      last = n;
    }
    return { count, first, last };
  }

  // Fast O(1) fingerprint of non-overlay children count + edge lengths to avoid full tree walk on unchanged ready panels
  function quickPanelStamp(panel) {
    if (!panel || !panel.childNodes) return '';
    const nodes = panel.childNodes;
    let count = 0;
    let firstLen = 0;
    let lastLen = 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.nodeType === 1 && isOverlayOrIgnoredElement(n)) continue;
      count++;
      const l = n.nodeType === 3 ? (n.nodeValue || '').length : (n.textContent || '').length;
      if (count === 1) firstLen = l;
      lastLen = l;
    }
    return `${count}:${firstLen}:${lastLen}`;
  }

  function renderSafeMarkdownDom(container, markdownText, fileMap, panel) {
    const hasStreamChild = Boolean(
      (container.querySelector && container.querySelector('.ag-prism-thought-stream')) ||
        findChildByClass(container, 'ag-prism-thought-stream')
    );
    const hasErrorChild = Boolean(findChildByClass(container, 'ag-prism-thought-error-bar'));
    if (
      !hasStreamChild &&
      !hasErrorChild &&
      container.getAttribute &&
      container.getAttribute('data-raw-zh') === markdownText
    ) {
      return;
    }
    const doc = container.ownerDocument || document;
    while (container.firstChild) container.removeChild(container.firstChild);
    if (container.setAttribute) container.setAttribute('data-raw-zh', markdownText);

    const lines = String(markdownText || '').replace(/\r\n/g, '\n').split('\n');
    let inFence = false;
    let fenceLines = [];
    let listEl = null;
    let listType = '';

    const flushList = () => {
      if (listEl) {
        container.appendChild(listEl);
        listEl = null;
        listType = '';
      }
    };

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (trimmed.startsWith('```')) {
        flushList();
        if (!inFence) {
          inFence = true;
          fenceLines = [];
        } else {
          const pre = doc.createElement('pre');
          pre.className = 'ag-prism-thought-pre';
          pre.textContent = fenceLines.join('\n');
          container.appendChild(pre);
          inFence = false;
          fenceLines = [];
        }
        continue;
      }
      if (inFence) {
        fenceLines.push(rawLine);
        continue;
      }
      if (!trimmed) {
        flushList();
        continue;
      }

      const ulMatch = /^[-*•]\s+(.+)$/.exec(trimmed);
      const olMatch = /^\d+[.)]\s+(.+)$/.exec(trimmed);
      if (ulMatch || olMatch) {
        const nextType = ulMatch ? 'ul' : 'ol';
        if (!listEl || listType !== nextType) {
          flushList();
          listEl = doc.createElement(nextType);
          listEl.className = nextType === 'ul' ? 'ag-prism-thought-ul' : 'ag-prism-thought-ol';
          listType = nextType;
        }
        const li = doc.createElement('li');
        li.className = 'ag-prism-thought-li';
        appendInlineFormatted(li, (ulMatch || olMatch)[1], doc, fileMap, panel, 0);
        listEl.appendChild(li);
        continue;
      }

      flushList();
      const p = doc.createElement('p');
      p.className = 'ag-prism-thought-p';
      appendInlineFormatted(p, trimmed.replace(/^#{1,4}\s+/, ''), doc, fileMap, panel, 0);
      container.appendChild(p);
    }

    if (inFence && fenceLines.length) {
      const pre = doc.createElement('pre');
      pre.className = 'ag-prism-thought-pre';
      pre.textContent = fenceLines.join('\n');
      container.appendChild(pre);
    }
    flushList();
  }

  function findDirectOverlay(panel) {
    return findChildByClass(panel, 'ag-prism-thought-overlay');
  }

  function triggerSingleBlockRetranslate(panel) {
    if (!panel || currentMode === 'off') return;
    const rawText = extractRawEnglishText(panel);
    if (!rawText) return;
    const srcSkelHash = hashKey(rawText, 'sig');
    const sig = computeSig(rawText, currentMode);
    failedSigs.delete(sig);

    const mtKey = hashKey(rawText, 'mt');
    const aiKey = hashKey(rawText, activeStyleTag || 'ai_technical');
    memCache.delete(mtKey);
    memCache.delete(aiKey);
    persistLocalStorageCache();

    const existing = inflightBySig.get(sig);
    if (existing) {
      cancelTranslateRequest(existing);
      inflightBySig.delete(sig);
    }

    startOrJoinTranslation(panel, rawText, currentMode, sig, srcSkelHash, true, {
      force: true,
      priority: 30000,
    });
  }

  function ensureOverlayShell(panel) {
    const doc = panel.ownerDocument || document;
    let ov = findDirectOverlay(panel);
    if (ov) return ov;

    const t = getClientPack();
    ov = doc.createElement('div');
    ov.className = 'ag-prism-thought-overlay';
    ov.setAttribute('data-op-thought', '1');
    ov.setAttribute('data-prism-ignore', '1');
    ov.setAttribute('data-ag-no-i18n', '');

    const body = doc.createElement('span');
    body.className = 'ag-prism-thought-body';
    body.setAttribute('data-ag-no-i18n', '');
    ov.appendChild(body);

    const fallbackBadge = doc.createElement('span');
    fallbackBadge.className = 'ag-prism-thought-fallback-badge';
    fallbackBadge.setAttribute('data-testid', 'thought-fallback-badge');
    fallbackBadge.hidden = true;
    fallbackBadge.textContent = t.fallback;
    fallbackBadge.title = t.fallbackTitle;
    if (fallbackBadge.style) {
      fallbackBadge.style.display = 'none';
      fallbackBadge.style.fontSize = '11px';
      fallbackBadge.style.padding = '1px 6px';
      fallbackBadge.style.borderRadius = '999px';
      fallbackBadge.style.opacity = '0.85';
      fallbackBadge.style.marginRight = '4px';
    }
    ov.appendChild(fallbackBadge);

    const retranslateBtn = doc.createElement('button');
    retranslateBtn.type = 'button';
    retranslateBtn.className = 'ag-prism-thought-retranslate-btn';
    retranslateBtn.setAttribute('data-no-press-spring', '1');
    retranslateBtn.setAttribute('data-testid', 'thought-retranslate-btn');
    retranslateBtn.hidden = true;
    retranslateBtn.textContent = '↻';
    retranslateBtn.title = t.retranslateTitle;
    retranslateBtn.setAttribute('aria-label', t.retranslateTitle);
    if (retranslateBtn.style) {
      retranslateBtn.style.display = 'none';
      retranslateBtn.style.opacity = '0.6';
      retranslateBtn.style.cursor = 'pointer';
      retranslateBtn.style.marginRight = '4px';
    }
    retranslateBtn.addEventListener('click', (ev) => {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      triggerSingleBlockRetranslate(panel);
    });
    ov.appendChild(retranslateBtn);

    const toggleBtn = doc.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'ag-prism-thought-raw-toggle';
    toggleBtn.setAttribute('data-no-press-spring', '1');
    const showingRaw = panel.getAttribute('data-op-show-raw') === '1';
    toggleBtn.setAttribute('aria-pressed', String(showingRaw));
    toggleBtn.textContent = showingRaw ? t.rawHide : t.rawShow;
    toggleBtn.addEventListener('click', (ev) => {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
      const currentlyShowing = panel.getAttribute('data-op-show-raw') === '1';
      panel.setAttribute('data-op-manual-raw', currentlyShowing ? '0' : '1');
      applyPanelViewMode(panel);
    });
    ov.appendChild(toggleBtn);

    panel.setAttribute('data-op-thought-panel', '1');
    panel.insertBefore(ov, panel.firstChild);
    return ov;
  }

  function syncOverlayBadges(ov, panel, isFallback, isReady) {
    if (!ov) return;
    const t = getClientPack();
    const fallbackBadge = findChildByClass(ov, 'ag-prism-thought-fallback-badge');
    if (fallbackBadge) {
      fallbackBadge.hidden = !isFallback;
      if (fallbackBadge.style) fallbackBadge.style.display = isFallback ? '' : 'none';
      fallbackBadge.textContent = t.fallback;
      fallbackBadge.title = t.fallbackTitle;
    }
    if (panel) {
      if (isFallback) panel.setAttribute('data-op-zh-fallback', '1');
      else panel.removeAttribute('data-op-zh-fallback');
    }
    const retranslateBtn = findChildByClass(ov, 'ag-prism-thought-retranslate-btn');
    if (retranslateBtn) {
      retranslateBtn.hidden = !isReady;
      if (retranslateBtn.style) retranslateBtn.style.display = isReady ? '' : 'none';
      retranslateBtn.disabled = false;
      retranslateBtn.title = t.retranslateTitle;
      retranslateBtn.setAttribute('aria-label', t.retranslateTitle);
    }
  }

  function renderPendingState(panel, message, pendingKind = '') {
    if (!panel) return;
    // Never regress an already-rendered panel back to a tiny pending pill (prevents height collapse jank!)
    const existingOv = findDirectOverlay(panel);
    if (panel.getAttribute('data-op-zh-ready') === '1' && existingOv && existingOv.getAttribute('data-pending') !== '1') {
      const retranslateBtn = findChildByClass(existingOv, 'ag-prism-thought-retranslate-btn');
      if (retranslateBtn) retranslateBtn.disabled = true;
      return;
    }
    const ov = ensureOverlayShell(panel);
    ov.setAttribute('data-pending', '1');
    ov.removeAttribute('data-failed');
    panel.removeAttribute('data-op-zh-failed');
    syncOverlayBadges(ov, panel, false, false);

    const body = findChildByClass(ov, 'ag-prism-thought-body');
    if (body) {
      if (body.removeAttribute) body.removeAttribute('data-raw-zh');
      let hint = findChildByClass(body, 'ag-prism-thought-pending-hint');
      if (!hint) {
        while (body.firstChild) body.removeChild(body.firstChild);
        hint = (panel.ownerDocument || document).createElement('span');
        hint.className = 'ag-prism-thought-pending-hint';
        body.appendChild(hint);
      }
      if (pendingKind && hint.setAttribute) {
        hint.setAttribute('data-pending-kind', pendingKind);
      }
      if (hint.textContent !== message) {
        hint.textContent = message;
      }
    }
    if (panel.getAttribute('data-op-zh-pending') !== '1') {
      panel.setAttribute('data-op-zh-pending', '1');
    }
    panel.removeAttribute('data-op-zh-ready');
  }

  function clearPendingKeepRaw(panel) {
    if (!panel || panel.getAttribute('data-op-zh-ready') === '1') return;
    lockedHeights.delete(panel);
    if (panel.style) panel.style.removeProperty('min-height');
    panel.removeAttribute('data-op-zh-pending');
    const ov = findDirectOverlay(panel);
    if (ov && ov.getAttribute('data-pending') === '1') {
      ov.remove();
      if (panel.getAttribute('data-op-zh-failed') !== '1') {
        panel.removeAttribute('data-op-thought-panel');
      }
    }
  }

  function renderFailedState(panel, rawText, mode, sig) {
    if (!panel) return;
    lockedHeights.delete(panel);
    if (panel.style) panel.style.removeProperty('min-height');
    panel.removeAttribute('data-op-zh-pending');

    // If panel already had a valid ready translation (e.g. manual retranslate failed), preserve existing translation cleanly
    const existingOv = findDirectOverlay(panel);
    if (panel.getAttribute('data-op-zh-ready') === '1' && existingOv) {
      const retranslateBtn = findChildByClass(existingOv, 'ag-prism-thought-retranslate-btn');
      if (retranslateBtn) retranslateBtn.disabled = false;
      return;
    }

    const doc = panel.ownerDocument || document;
    const t = getClientPack();
    const ov = ensureOverlayShell(panel);
    ov.removeAttribute('data-pending');
    ov.setAttribute('data-failed', '1');
    panel.removeAttribute('data-op-zh-ready');
    panel.setAttribute('data-op-zh-failed', '1');
    syncOverlayBadges(ov, panel, false, false);

    const body = findChildByClass(ov, 'ag-prism-thought-body');
    if (body) {
      if (body.removeAttribute) body.removeAttribute('data-raw-zh');
      while (body.firstChild) body.removeChild(body.firstChild);

      const errBar = doc.createElement('span');
      errBar.className = 'ag-prism-thought-error-bar';
      if (errBar.style) {
        errBar.style.display = 'inline-flex';
        errBar.style.alignItems = 'center';
        errBar.style.gap = '8px';
        errBar.style.fontSize = '12px';
        errBar.style.opacity = '0.82';
      }

      const errTxt = doc.createElement('span');
      errTxt.className = 'ag-prism-thought-error-text';
      errTxt.textContent = t.errorText;
      errBar.appendChild(errTxt);

      const retryBtn = doc.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'ag-prism-thought-retry-btn';
      retryBtn.setAttribute('data-testid', 'thought-retry-btn');
      retryBtn.setAttribute('data-no-press-spring', '1');
      retryBtn.textContent = t.retryBtn;
      if (retryBtn.style) {
        retryBtn.style.cursor = 'pointer';
        retryBtn.style.textDecoration = 'underline';
      }
      retryBtn.addEventListener('click', (ev) => {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
        failedSigs.delete(sig);
        ov.removeAttribute('data-failed');
        panel.removeAttribute('data-op-zh-failed');
        applyPanelViewMode(panel);
        const curRaw = extractRawEnglishText(panel) || rawText;
        const activeMode = currentMode === 'off' ? mode : currentMode;
        const nextSig = computeSig(curRaw, activeMode);
        failedSigs.delete(nextSig);
        startOrJoinTranslation(panel, curRaw, activeMode, nextSig, hashKey(curRaw, 'sig'), true, {
          force: true,
          priority: 30000,
        });
      });
      errBar.appendChild(retryBtn);
      body.appendChild(errBar);
    }

    applyPanelViewMode(panel);
  }

  function renderTranslatedText(panel, text, isPartial, sig, engine = '') {
    if (!panel || typeof text !== 'string' || !text) return;
    const ov = ensureOverlayShell(panel);
    if (hasAttr(ov, 'data-pending')) ov.removeAttribute('data-pending');
    if (hasAttr(ov, 'data-failed')) ov.removeAttribute('data-failed');
    if (hasAttr(panel, 'data-op-zh-failed')) panel.removeAttribute('data-op-zh-failed');
    const body = findChildByClass(ov, 'ag-prism-thought-body');
    if (!body) return;

    const isFallback = engine === 'machine-fallback';

    if (isPartial) {
      let streamEl = findChildByClass(body, 'ag-prism-thought-stream');
      if (
        streamEl &&
        streamLastLenMap.get(streamEl) === text.length &&
        panel.getAttribute('data-op-zh-ready') === '1'
      ) {
        return;
      }
      if (!lockedHeights.has(panel)) {
        const curH = panel.offsetHeight || 0;
        if (curH > 0 && panel.style) {
          lockedHeights.set(panel, curH);
          panel.style.minHeight = `${curH}px`;
        }
      }
      if (hasAttr(body, 'data-raw-zh')) body.removeAttribute('data-raw-zh');
      if (!streamEl) {
        while (body.firstChild) body.removeChild(body.firstChild);
        const doc = panel.ownerDocument || document;
        streamEl = doc.createElement('p');
        streamEl.className = 'ag-prism-thought-stream';
        if (streamEl.setAttribute) streamEl.setAttribute('data-ag-no-i18n', '');
        if (typeof doc.createTextNode === 'function') {
          streamEl.appendChild(doc.createTextNode(text));
        } else {
          streamEl.textContent = text;
        }
        body.appendChild(streamEl);
      } else {
        const tn = streamEl.firstChild;
        if (tn && tn.nodeType === 3) {
          if ('nodeValue' in tn) tn.nodeValue = text;
          else tn.textContent = text;
        } else {
          streamEl.textContent = text;
        }
      }
      streamLastLenMap.set(streamEl, text.length);
      syncOverlayBadges(ov, panel, isFallback, false);
    } else {
      const prevScrollTop = typeof panel.scrollTop === 'number' ? panel.scrollTop : 0;
      const fileMap = ensurePanelFileMap(panel);
      renderSafeMarkdownDom(body, text, fileMap, panel);
      lockedHeights.delete(panel);
      if (panel.style && panel.style.minHeight) panel.style.removeProperty('min-height');
      if (prevScrollTop > 0 && typeof panel.scrollTop === 'number') {
        panel.scrollTop = prevScrollTop;
      }
      syncOverlayBadges(ov, panel, isFallback, true);
      if (sig) {
        const effectiveSig = isFallback ? `${sig}:fallback` : sig;
        if (panel.getAttribute('data-op-zh-sig') !== effectiveSig) {
          panel.setAttribute('data-op-zh-sig', effectiveSig);
        }
        const meta = panelMeta.get(panel) || {};
        meta.doneSig = effectiveSig;
        meta.readyStamp = quickPanelStamp(panel);
        panelMeta.set(panel, meta);
      }
    }

    if (hasAttr(panel, 'data-op-zh-pending')) {
      panel.removeAttribute('data-op-zh-pending');
    }
    if (panel.getAttribute('data-op-zh-ready') !== '1') {
      panel.setAttribute('data-op-zh-ready', '1');
    }
    applyPanelViewMode(panel);
  }

  function computeSig(rawText, mode) {
    const presetTag = mode === 'machine' ? 'mt' : activeStyleTag || 'ai_pending';
    return `${presetTag}:${hashKey(rawText, 'sig')}`;
  }

  function findCachedTranslation(rawText, mode) {
    if (mode === 'machine') {
      return memCache.get(hashKey(rawText, 'mt')) || '';
    }
    if (!activeStyleTag) return '';
    return memCache.get(hashKey(rawText, activeStyleTag)) || '';
  }

  function bindPanelToInflight(entry, panel, expanded) {
    if (panel && !entry.panels.includes(panel)) {
      entry.panels.push(panel);
    }
    if (panel && expanded) {
      if (entry.lastPartial) {
        renderTranslatedText(panel, entry.lastPartial, true, null);
      } else {
        const t = getClientPack();
        renderPendingState(
          panel,
          entry.mode === 'machine' ? t.pendingMachine : t.pendingAi,
          entry.mode === 'machine' ? 'machine' : 'ai'
        );
      }
    }
  }

  function startOrJoinTranslation(panel, rawText, mode, sig, srcSkelHash, expanded, opts = {}) {
    const force = Boolean(opts.force);
    const priority = Number(opts.priority) || 0;

    if (!force) {
      const cached = findCachedTranslation(rawText, mode);
      if (cached) {
        if (panel && expanded) {
          renderTranslatedText(panel, cached, false, sig, mode === 'machine' ? 'machine' : 'ai');
        }
        return;
      }

      if (isSigInCooldown(sig)) {
        if (panel && expanded && panel.getAttribute('data-op-zh-failed') !== '1') {
          renderFailedState(panel, rawText, mode, sig);
        }
        return;
      }

      const existing = inflightBySig.get(sig);
      if (existing && !existing.cancelled && Date.now() - existing.startedAt <= 75000) {
        bindPanelToInflight(existing, panel, expanded);
        return;
      }
      if (existing) {
        cancelFlushHandle(existing);
        inflightBySig.delete(sig);
      }
    } else {
      failedSigs.delete(sig);
    }

    const br = getBridge();
    if (!br || typeof br.translateStream !== 'function') return;

    const requestId = `op_tr_${Date.now().toString(36)}_${++reqSeq}`;
    const entry = {
      sig,
      requestId,
      srcSkelHash,
      srcStruct: panel ? quickStructureSig(panel) : null,
      mode,
      startedAt: Date.now(),
      cancelled: false,
      lastPartial: '',
      lastFlushAt: 0,
      pendingPartial: '',
      flushTimer: null,
      flushIsRaf: false,
      panels: panel ? [panel] : [],
    };
    inflightBySig.set(sig, entry);

    if (panel && expanded) {
      const t = getClientPack();
      renderPendingState(
        panel,
        mode === 'machine' ? t.pendingMachine : t.pendingAi,
        mode === 'machine' ? 'machine' : 'ai'
      );
    }

    const flushPartialToPanels = (partialStr) => {
      const trimmed = String(partialStr || '').trimStart();
      if (!trimmed || trimmed === entry.lastPartial || entry.cancelled) return;
      entry.lastPartial = trimmed;
      entry.lastFlushAt = Date.now();
      entry.pendingPartial = '';
      for (const p of entry.panels) {
        if (!p || !p.isConnected) continue;
        // Zero-textContent O(1) reference check during streaming: only read English text if child node references changed!
        const curStruct = quickStructureSig(p);
        if (
          entry.srcStruct &&
          curStruct &&
          (curStruct.count !== entry.srcStruct.count ||
            curStruct.first !== entry.srcStruct.first ||
            curStruct.last !== entry.srcStruct.last)
        ) {
          const curRaw = extractRawEnglishText(p);
          if (curRaw && hashKey(curRaw, 'sig') !== entry.srcSkelHash) continue;
          entry.srcStruct = curStruct;
        }
        renderTranslatedText(p, trimmed, true, null);
      }
    };

    const scheduleAlignedStreamFlush = () => {
      if (entry.flushTimer || entry.cancelled) return;
      const stepFlush = () => {
        entry.flushTimer = null;
        entry.flushIsRaf = false;
        if (currentMode === 'off' || entry.cancelled || !entry.pendingPartial) return;
        const now = Date.now();
        if (entry.lastFlushAt > 0 && now - entry.lastFlushAt < STREAM_FLUSH_MS) {
          scheduleAlignedStreamFlush();
          return;
        }
        flushPartialToPanels(entry.pendingPartial);
      };
      if (typeof requestAnimationFrame === 'function') {
        entry.flushIsRaf = true;
        entry.flushTimer = requestAnimationFrame(stepFlush);
      } else {
        entry.flushIsRaf = false;
        entry.flushTimer = setTimeout(stepFlush, STREAM_FLUSH_MS);
      }
    };

    br.translateStream(
      { text: rawText, mode, priority, requestId, force },
      (partial) => {
        if (currentMode === 'off' || entry.cancelled || typeof partial !== 'string' || !partial.trim()) return;
        entry.pendingPartial = partial;
        const now = Date.now();
        if (entry.lastFlushAt === 0 && typeof requestAnimationFrame !== 'function') {
          flushPartialToPanels(partial);
        } else if (now - entry.lastFlushAt >= STREAM_FLUSH_MS && typeof requestAnimationFrame !== 'function') {
          cancelFlushHandle(entry);
          flushPartialToPanels(partial);
        } else {
          scheduleAlignedStreamFlush();
        }
      }
    )
      .then((res) => {
        cancelFlushHandle(entry);
        if (inflightBySig.get(sig) === entry) {
          inflightBySig.delete(sig);
        }
        if (currentMode === 'off' || entry.cancelled || res?.cancelled) {
          for (const p of entry.panels) {
            if (p && p.isConnected && p.getAttribute('data-op-zh-ready') !== '1') {
              clearPendingKeepRaw(p);
            }
          }
          return;
        }

        if (res && res.ok && typeof res.text === 'string' && res.text.trim()) {
          const finalZh = res.text.trim();
          const isFallback = res.engine === 'machine-fallback' || Boolean(res.fallback);
          const effectiveEngine = isFallback ? 'machine-fallback' : res.engine || (mode === 'machine' ? 'machine' : 'ai');
          failedSigs.delete(sig);
          const fallbackCacheKey = hashKey(
            rawText,
            isFallback || mode === 'machine' ? 'mt' : activeStyleTag || 'ai_technical'
          );
          putMemCache(res.key || fallbackCacheKey, finalZh, true);

          for (const p of entry.panels) {
            if (!p || !p.isConnected) continue;
            const curRaw = extractRawEnglishText(p);
            if (curRaw && hashKey(curRaw, 'sig') !== entry.srcSkelHash) continue;
            renderTranslatedText(p, finalZh, false, sig, effectiveEngine);
          }
          // Rescan once in case user expanded a matching collapsed panel while request was in flight
          scheduleScan(30);
        } else {
          recordSigFailure(sig);
          for (const p of entry.panels) {
            if (p && p.isConnected) {
              renderFailedState(p, rawText, mode, sig);
            }
          }
        }
      })
      .catch(() => {
        cancelFlushHandle(entry);
        if (inflightBySig.get(sig) === entry) {
          inflightBySig.delete(sig);
        }
        if (entry.cancelled || currentMode === 'off') return;
        recordSigFailure(sig);
        for (const p of entry.panels) {
          if (p && p.isConnected) {
            renderFailedState(p, rawText, mode, sig);
          }
        }
      });
  }

  function isElementInViewport(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return true;
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const vh =
        W.innerHeight ||
        (typeof document !== 'undefined' && document.documentElement && document.documentElement.clientHeight) ||
        900;
      const vw =
        W.innerWidth ||
        (typeof document !== 'undefined' && document.documentElement && document.documentElement.clientWidth) ||
        1440;
      return rect.bottom >= -120 && rect.top <= vh + 120 && rect.right >= 0 && rect.left <= vw;
    } catch (_) {
      return true;
    }
  }

  function processSingleTrigger(btn, allowPreloadCollapsed, priority = 0) {
    if (!btn) return;
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    if (!expanded && !allowPreloadCollapsed) return;

    const panel = btn.nextElementSibling;
    if (!panel || String(panel.tagName || '').toUpperCase() !== 'DIV') return;

    const streaming = isTriggerStreaming(btn);
    const t = getClientPack();

    // Fast streaming early-exit: skip expensive full DOM text walk & regexes while host is still streaming raw English!
    if (streaming) {
      const now = Date.now();
      const meta = panelMeta.get(panel) || {
        lastSkelHash: '',
        lastChangeAt: now,
        sawStreaming: true,
        mutated: true,
        finishedAt: 0,
        doneSig: '',
        readyStamp: '',
      };
      meta.sawStreaming = true;
      meta.mutated = true;
      meta.finishedAt = 0;
      meta.lastChangeAt = now;
      panelMeta.set(panel, meta);
      clearPanelWaitTimer(panel);
      if (expanded) {
        renderPendingState(panel, t.pendingStreaming, 'streaming');
      }
      return;
    }

    // O(1) fast-path: if panel is already rendered for current mode, not streaming, and child stamp unchanged -> skip!
    if (expanded && !streaming && panel.getAttribute('data-op-zh-ready') === '1') {
      const existingMeta = panelMeta.get(panel);
      const curStamp = quickPanelStamp(panel);
      if (
        existingMeta &&
        existingMeta.readyStamp === curStamp &&
        existingMeta.doneSig &&
        existingMeta.doneSig === panel.getAttribute('data-op-zh-sig')
      ) {
        return;
      }
    }

    const rawText = extractRawEnglishText(panel);
    if (!rawText || isMostlyZh(rawText)) {
      if (panel.getAttribute('data-op-zh-pending') === '1') clearPendingKeepRaw(panel);
      return;
    }

    const srcSkelHash = hashKey(rawText, 'sig');
    const sig = computeSig(rawText, currentMode);

    // Exact signature idempotence check: never rebuild DOM if already rendered with identical signature!
    if (
      expanded &&
      !streaming &&
      panel.getAttribute('data-op-zh-ready') === '1' &&
      panel.getAttribute('data-op-zh-sig') === sig
    ) {
      const meta = panelMeta.get(panel) || {};
      meta.doneSig = sig;
      meta.readyStamp = quickPanelStamp(panel);
      panelMeta.set(panel, meta);
      return;
    }

    const now = Date.now();
    let meta = panelMeta.get(panel);
    if (!meta) {
      meta = {
        lastSkelHash: srcSkelHash,
        lastChangeAt: now,
        sawStreaming: streaming,
        mutated: streaming,
        finishedAt: streaming ? 0 : now - FINISH_GATE_MS,
        doneSig: '',
        readyStamp: '',
      };
    } else if (meta.lastSkelHash !== srcSkelHash) {
      meta.lastSkelHash = srcSkelHash;
      meta.lastChangeAt = now;
      meta.mutated = true;
    }

    if (meta.sawStreaming && !meta.finishedAt) {
      meta.sawStreaming = false;
      meta.finishedAt = now;
    } else if (!meta.finishedAt) {
      meta.finishedAt = now - FINISH_GATE_MS;
    }
    panelMeta.set(panel, meta);

    // Instant cache hit bypasses stability wait gates cleanly
    const cached = findCachedTranslation(rawText, currentMode);
    if (cached) {
      clearPanelWaitTimer(panel);
      if (expanded) {
        renderTranslatedText(panel, cached, false, sig, currentMode === 'machine' ? 'machine' : 'ai');
      } else {
        putMemCache(hashKey(rawText, currentMode === 'machine' ? 'mt' : activeStyleTag || 'ai_technical'), cached, false);
      }
      return;
    }

    // Reattach immediately if an identical flight is already running (e.g. panel just remounted/expanded)
    const activeFlight = inflightBySig.get(sig);
    if (activeFlight && !activeFlight.cancelled && now - activeFlight.startedAt <= 75000) {
      bindPanelToInflight(activeFlight, panel, expanded);
      return;
    }

    if (isSigInCooldown(sig)) {
      if (expanded && panel.getAttribute('data-op-zh-failed') !== '1') {
        renderFailedState(panel, rawText, currentMode, sig);
      }
      return;
    }

    const finishRem = meta.mutated ? Math.max(0, FINISH_GATE_MS - (now - meta.finishedAt)) : 0;
    const quietRem = meta.mutated ? Math.max(0, QUIET_GATE_MS - (now - meta.lastChangeAt)) : 0;
    const waitMs = Math.max(finishRem, quietRem);

    if (waitMs > 0) {
      if (expanded) {
        renderPendingState(panel, t.pendingSettling, 'settling');
      }
      setPanelWaitTimer(
        panel,
        btn,
        () => {
          if (currentMode === 'off' || !btn.isConnected) return;
          const liveExpanded = btn.getAttribute('aria-expanded') === 'true';
          let liveAllowPreload = false;
          if (!liveExpanded && triggerTiming === 'preload' && typeof document !== 'undefined') {
            const allBtns = document.querySelectorAll('button[data-testid="thinking-collapsible-trigger"]');
            liveAllowPreload = Boolean(allBtns && allBtns.length > 0 && allBtns[allBtns.length - 1] === btn);
          }
          if (!liveExpanded && !liveAllowPreload) {
            clearPendingKeepRaw(panel);
            return;
          }
          processSingleTrigger(btn, liveAllowPreload, priority);
        },
        waitMs + 25
      );
      return;
    }

    startOrJoinTranslation(panel, rawText, currentMode, sig, srcSkelHash, expanded, { priority });
  }

  function pruneUnneededPendingRequests(activePanelSet) {
    for (const [sig, entry] of inflightBySig.entries()) {
      if (entry.lastPartial || entry.cancelled) continue;
      const stillNeeded = entry.panels.some((p) => p && p.isConnected && activePanelSet.has(p));
      if (!stillNeeded) {
        cancelTranslateRequest(entry);
        inflightBySig.delete(sig);
      }
    }
  }

  function scanNow() {
    scanTimer = null;
    if (currentMode === 'off' || typeof document === 'undefined') return;
    const triggers = document.querySelectorAll('button[data-testid="thinking-collapsible-trigger"]');
    if (!triggers || !triggers.length) return;

    const lastIdx = triggers.length - 1;
    const candidates = [];
    const activePanelSet = new Set();

    for (let i = 0; i <= lastIdx; i++) {
      const btn = triggers[i];
      if (!btn) continue;
      const isLatest = i === lastIdx;
      const allowPreload = triggerTiming === 'preload' && isLatest;
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      if (!allowPreload && !expanded) continue;

      const panel = btn.nextElementSibling;
      if (panel) activePanelSet.add(panel);

      const inViewport = expanded ? isElementInViewport(panel || btn) : false;
      const tier = isLatest && expanded ? 25 : inViewport ? 20 : isLatest ? 12 : 5;
      const priority = tier * 1000 + i;
      candidates.push({ btn, allowPreload, priority });
    }

    if (inflightBySig.size > 0) {
      pruneUnneededPendingRequests(activePanelSet);
    }

    // Schedule highest-priority (viewport-visible & latest turn) thought blocks first!
    candidates.sort((a, b) => b.priority - a.priority);
    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      processSingleTrigger(item.btn, item.allowPreload, item.priority);
    }
  }

  function scheduleScan(delayMs = 55) {
    if (currentMode === 'off') return;
    if (scanTimer) return;
    scanTimer = setTimeout(scanNow, delayMs);
  }

  const api = {
    sync(cfg = {}) {
      const nextMode =
        cfg.thoughtTranslate === 'machine' || cfg.thoughtTranslate === 'ai' ? cfg.thoughtTranslate : 'off';
      const prevTrigger = triggerTiming;
      triggerTiming = cfg.thoughtTrigger === 'expand' ? 'expand' : 'preload';

      const nextLang = resolveActiveLang(cfg.language);
      if (nextLang !== currentLang) {
        currentLang = nextLang;
        refreshAllOverlayLocaleStrings();
      } else {
        refreshAllOverlayLocaleStrings();
      }

      const incomingView = cfg.thoughtView || cfg.thoughtViewMode;
      if (incomingView === 'bilingual' || incomingView === 'immersive') {
        hasExplicitHostView = true;
        viewModeLoaded = true;
        const viewChanged = currentViewMode !== incomingView;
        currentViewMode = incomingView;
        persistViewModePreference(currentViewMode);
        syncDocViewAttribute();
        if (viewChanged && typeof document !== 'undefined') {
          document.querySelectorAll('.ag-prism-thought-overlay[data-op-thought="1"]').forEach((ov) => {
            if (ov.parentElement) {
              ov.parentElement.removeAttribute('data-op-manual-raw');
              applyPanelViewMode(ov.parentElement);
            }
          });
        } else {
          refreshAllPanelViewModes();
        }
      }

      if (nextMode === 'off') {
        if (scanTimer) {
          clearTimeout(scanTimer);
          scanTimer = null;
        }
        currentMode = 'off';
        releasePrismOverlays();
        return;
      }

      if (triggerTiming === 'expand' && prevTrigger !== 'expand') {
        cancelCollapsedInflightRequests();
      } else if (triggerTiming === 'expand') {
        clearAllWaitTimers(true);
      }

      const changed = currentMode !== nextMode;
      const hadPrevEngine = currentMode !== 'off';
      currentMode = nextMode;
      ensureInitialized();
      if (changed) {
        if (hadPrevEngine) {
          clearAllWaitTimers(false);
          for (const entry of inflightBySig.values()) {
            cancelTranslateRequest(entry);
          }
          inflightBySig.clear();
        }
        if (typeof document !== 'undefined') {
          const resetPanelSig = (p) => {
            if (!p) return;
            p.removeAttribute('data-op-zh-sig');
            p.removeAttribute('data-op-zh-fallback');
            p.removeAttribute('data-op-zh-failed');
            panelMeta.delete(p);
          };
          document.querySelectorAll('button[data-testid="thinking-collapsible-trigger"]').forEach((b) => {
            if (b && b.nextElementSibling) resetPanelSig(b.nextElementSibling);
          });
          document.querySelectorAll('.ag-prism-thought-overlay[data-op-thought="1"]').forEach((ov) => {
            if (ov && ov.parentElement) resetPanelSig(ov.parentElement);
          });
        }
      }
      scheduleScan(25);
    },
    scan() {
      scheduleScan(45);
    },
    scanImmediate() {
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
      }
      scanNow();
    },
    getViewMode() {
      loadViewModePreference();
      return currentViewMode;
    },
    setViewMode(nextViewMode, opts = {}) {
      const normalized = nextViewMode === 'bilingual' ? 'bilingual' : 'immersive';
      hasExplicitHostView = true;
      viewModeLoaded = true;
      const changed = currentViewMode !== normalized;
      currentViewMode = normalized;
      persistViewModePreference(normalized);
      syncDocViewAttribute();
      if (typeof document !== 'undefined') {
        document.querySelectorAll('.ag-prism-thought-overlay[data-op-thought="1"]').forEach((ov) => {
          if (ov.parentElement) {
            // Reset per-panel manual override when user explicitly flips global reading view
            ov.parentElement.removeAttribute('data-op-manual-raw');
            applyPanelViewMode(ov.parentElement);
          }
        });
      }
      if (changed && opts.persistDaemon !== false) {
        void callDaemonRpc({ action: 'save-config', viewMode: normalized }).catch(() => {});
      }
      return currentViewMode;
    },
    getLocalCacheStats,
    clearLocalCache,
    getCacheStats() {
      const local = getLocalCacheStats();
      return callDaemonRpc({ action: 'cache-stats' })
        .then((res) => {
          if (res && res.ok && typeof res.entries === 'number') {
            return {
              ok: true,
              localOnly: false,
              localEntries: local.memEntries,
              storageEntries: local.storageEntries,
              daemonEntries: res.entries,
              diskBytes: res.diskBytes || 0,
              totalEntries: Math.max(local.memEntries, res.entries),
            };
          }
          return {
            ok: true,
            localOnly: true,
            localEntries: local.memEntries,
            storageEntries: local.storageEntries,
            daemonEntries: 0,
            diskBytes: 0,
            totalEntries: local.memEntries,
          };
        })
        .catch(() => ({
          ok: true,
          localOnly: true,
          localEntries: local.memEntries,
          storageEntries: local.storageEntries,
          daemonEntries: 0,
          diskBytes: 0,
          totalEntries: local.memEntries,
        }));
    },
    clearCache() {
      const localRes = clearLocalCache();
      return callDaemonRpc({ action: 'clear-cache' })
        .then((res) => {
          if (res && res.ok) {
            return {
              ok: true,
              localOnly: false,
              localCleared: localRes.cleared,
              daemonCleared: typeof res.cleared === 'number' ? res.cleared : 0,
            };
          }
          return {
            ok: true,
            localOnly: true,
            localCleared: localRes.cleared,
            daemonCleared: 0,
          };
        })
        .catch(() => ({
          ok: true,
          localOnly: true,
          localCleared: localRes.cleared,
          daemonCleared: 0,
        }));
    },
    getConfig() {
      const br = getBridge();
      if (!br) return Promise.resolve({ ok: false, offline: true });
      return br.call({ action: 'get-config' }).then((res) => {
        const nextTag = res?.styleTag || (res?.stylePreset ? `ai_${res.stylePreset}` : '');
        if (nextTag) activeStyleTag = nextTag;
        if (!hasExplicitHostView && (res?.viewMode === 'bilingual' || res?.viewMode === 'immersive')) {
          let hasLocalPref = false;
          try {
            hasLocalPref = Boolean(W.localStorage && W.localStorage.getItem(VIEW_MODE_STORAGE_KEY));
          } catch (_) {}
          if (!hasLocalPref) {
            currentViewMode = res.viewMode;
            syncDocViewAttribute();
            refreshAllPanelViewModes();
          }
        }
        return res;
      });
    },
    saveConfig(input) {
      const br = getBridge();
      if (!br) return Promise.resolve({ ok: false, offline: true });
      return br.call({ action: 'save-config', ...input }).then((res) => {
        const nextTag = res?.styleTag || (res?.stylePreset ? `ai_${res.stylePreset}` : '');
        const tagChanged = Boolean(nextTag && nextTag !== activeStyleTag);
        if (nextTag) activeStyleTag = nextTag;
        if (typeof document !== 'undefined') {
          document.querySelectorAll('button[data-testid="thinking-collapsible-trigger"]').forEach((b) => {
            const p = b.nextElementSibling;
            if (!p) return;
            // Re-run if styleTag changed OR if panel previously degraded to machine-fallback!
            if (tagChanged || p.getAttribute('data-op-zh-fallback') === '1' || p.getAttribute('data-op-zh-failed') === '1') {
              p.removeAttribute('data-op-zh-sig');
              p.removeAttribute('data-op-zh-fallback');
              p.removeAttribute('data-op-zh-failed');
              panelMeta.delete(p);
            }
          });
        }
        failedSigs.clear();
        scheduleScan(25);
        return res;
      });
    },
    fetchModels(input) {
      const br = getBridge();
      return br ? br.call({ action: 'fetch-models', ...input }) : Promise.resolve({ ok: false, offline: true });
    },
    testConnection(input) {
      const br = getBridge();
      return br ? br.call({ action: 'test-connection', ...input }) : Promise.resolve({ ok: false, offline: true });
    },
    __memCache: memCache,
    destroy() {
      currentMode = 'off';
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
      }
      if (persistTimer) {
        flushLocalStorageCacheNow();
      }
      releasePrismOverlays();
    },
  };

  W.__agPrismThought = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
