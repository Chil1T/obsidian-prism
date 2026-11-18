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
  const CHUNK_FADE_TTL_MS = 350;
  const MAX_LIVE_CHUNKS = 10;
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

  const SEL_TRIGGER = 'button[data-testid="thinking-collapsible-trigger"]';
  const SEL_OVERLAY = '.ag-prism-thought-overlay[data-op-thought="1"]';

  // [0:rawShow, 1:rawHide, 2:fallback, 3:fallbackTitle, 4:retranslateTitle, 5:errorText, 6:retryBtn, 7:pendingMachine, 8:pendingAi, 9:pendingStreaming, 10:pendingSettling]
  const CLIENT_I18N = {
    'zh-CN': [
      '原文', '收起原文', '机翻降级', '当前未配置可用 AI 模型或密钥，已降级为机翻', '重新转译此块（跳过缓存）',
      '转译未完成', '↻ 重试', '正在极速机翻思考过程…', '正在通过 AI 转译并润色思考过程…', '思考流式输出中，完结后自动转译…', '正在收束思考上下文…',
    ],
    'zh-TW': [
      '原文', '收起原文', '機翻降級', '目前未設定可用 AI 模型或金鑰，已降級為機器翻譯', '重新轉譯此區塊（略過快取）',
      '轉譯未完成', '↻ 重試', '正在快速機器翻譯思考過程…', '正在透過 AI 轉譯並潤飾思考過程…', '思考串流輸出中，完成後自動轉譯…', '正在整理思考上下文…',
    ],
    yue: [
      '原文', '收埋原文', '機翻降級', '目前未設定可用 AI 模型或金鑰，已降級為機器翻譯', '重新轉譯呢一塊（跳過快取）',
      '轉譯未完成', '↻ 重試', '正在機器翻譯思考過程…', '正在透過 AI 轉譯同潤飾思考過程…', '思考串流輸出緊，完成後自動轉譯…', '正在整理思考上下文…',
    ],
    en: [
      'Raw', 'Hide Raw', 'Fallback', 'AI model or key unavailable; degraded to machine translation', 'Retranslate block (bypass cache)',
      'Translation incomplete', '↻ Retry', 'Translating thought block…', 'Polishing thought block with AI…', 'Streaming thought; auto-translating once done…', 'Settling thought context…',
    ],
    ja: [
      '原文', '原文を隠す', '機械翻訳代替', 'AIモデルまたはキーが未設定のため、機械翻訳に切り替えました', 'このブロックを再翻訳（キャッシュ無視）',
      '翻訳未完了', '↻ 再試行', '思考プロセスを機械翻訳中…', 'AIで思考プロセスを翻訳・整形中…', '思考ストリーミング中、完了後に自動翻訳…', '思考コンテキストを整えています…',
    ],
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
  const panelStreamStates = new WeakMap();
  const panelSettleTimers = new WeakMap();

  const docRoot = () => (typeof document !== 'undefined' ? document.documentElement : null);
  const ga = (e, k) => (e && e.getAttribute ? e.getAttribute(k) : null);
  const sa = (e, k, v) => { if (e && e.setAttribute) e.setAttribute(k, v); };
  const ra = (e, k) => { if (e && e.removeAttribute) e.removeAttribute(k); };
  const raList = (e, ks) => { for (let i = 0; i < ks.length; i++) ra(e, ks[i]); };
  const ce = (d, t, cls) => { const e = d.createElement(t); if (cls) e.className = cls; return e; };
  const ctn = (d, s) => d.createTextNode(s);
  const ap = (p, c) => p.appendChild(c);
  const clearEl = (e) => { while (e && e.firstChild) e.removeChild(e.firstChild); };
  const setTn = (tn, v) => { if (tn) { if ('nodeValue' in tn) tn.nodeValue = v; tn.textContent = v; } };
  const qsa = (s) => (typeof document !== 'undefined' ? document.querySelectorAll(s) : []);
  const onClk = (e, fn) => e.addEventListener('click', fn);
  const stopEv = (ev) => {
    if (ev) {
      if (typeof ev.preventDefault === 'function') ev.preventDefault();
      if (typeof ev.stopPropagation === 'function') ev.stopPropagation();
    }
  };

  function nowMs() {
    return W.Date && typeof W.Date.now === 'function' ? W.Date.now() : Date.now();
  }

  function isMotionOff() {
    try {
      if (ga(docRoot(), 'data-ag-cs-motion') === 'off') return true;
      if (W.__agPrism?.getState?.()?.cfg?.motionLevel === 'off') return true;
    } catch (_) {}
    return false;
  }

  function getRafFn() {
    if (typeof W.requestAnimationFrame === 'function') return W.requestAnimationFrame.bind(W);
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame;
    return null;
  }

  function getCafFn() {
    if (typeof W.cancelAnimationFrame === 'function') return W.cancelAnimationFrame.bind(W);
    if (typeof cancelAnimationFrame === 'function') return cancelAnimationFrame;
    return null;
  }

  function canUseSmoothStream() {
    return Boolean(getRafFn()) && !isMotionOff();
  }

  function clearPanelStreamState(panel) {
    if (!panel) return;
    const t = panelSettleTimers.get(panel);
    if (t) {
      clearTimeout(t);
      panelSettleTimers.delete(panel);
    }
    panelStreamStates.delete(panel);
  }

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

  function resolveActiveLang(explicitLang) {
    const fromArg = normalizeLangCode(explicitLang);
    if (fromArg) return fromArg;
    try {
      const rootEl = docRoot();
      if (rootEl) {
        const csLang = normalizeLangCode(ga(rootEl, 'data-ag-cs-lang')) || normalizeLangCode(ga(rootEl, 'data-ag-prism-lang'));
        if (csLang) return csLang;
      }
      const stateLang = normalizeLangCode(W.__agPrism?.getState?.()?.cfg?.language);
      if (stateLang) return stateLang;
    } catch (_) {}
    return currentLang || 'zh-CN';
  }

  function getClientPack(explicitLang) {
    return CLIENT_I18N[resolveActiveLang(explicitLang)] || CLIENT_I18N['zh-CN'];
  }

  function setPanelWaitTimer(panel, btn, fn, delayMs) {
    if (!panel) return;
    clearPanelWaitTimer(panel);
    const t = setTimeout(() => {
      trackedWaitPanels.delete(panel);
      fn();
    }, delayMs);
    trackedWaitPanels.set(panel, { t, b: btn });
  }

  function clearPanelWaitTimer(panel) {
    const rec = trackedWaitPanels.get(panel);
    if (!rec) return;
    clearTimeout(rec.t);
    trackedWaitPanels.delete(panel);
  }

  function isPanelCurrentlyExpanded(panel) {
    if (!panel) return false;
    if (ga(panel.previousElementSibling, 'aria-expanded') === 'true') return true;
    const triggers = qsa(SEL_TRIGGER);
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i] && triggers[i].nextElementSibling === panel) {
        return ga(triggers[i], 'aria-expanded') === 'true';
      }
    }
    return false;
  }

  function clearAllWaitTimers(onlyCollapsed = false) {
    for (const [panel, rec] of Array.from(trackedWaitPanels.entries())) {
      const expanded = ga(rec.b, 'aria-expanded') === 'true' || isPanelCurrentlyExpanded(panel);
      if (onlyCollapsed && expanded) continue;
      clearTimeout(rec.t);
      trackedWaitPanels.delete(panel);
      if (!expanded) clearPendingKeepRaw(panel);
    }
  }

  function cancelCollapsedInflightRequests() {
    clearAllWaitTimers(true);
    for (const [sig, entry] of Array.from(inflightBySig.entries())) {
      const kept = [];
      for (let i = 0; i < entry.ps.length; i++) {
        const p = entry.ps[i];
        if (p && p.isConnected && isPanelCurrentlyExpanded(p)) kept.push(p);
        else if (p) clearPendingKeepRaw(p);
      }
      entry.ps = kept;
      if (!kept.length) {
        cancelTranslateRequest(entry);
        inflightBySig.delete(sig);
      }
    }
  }

  function hasAttr(el, name) {
    if (!el) return false;
    return typeof el.hasAttribute === 'function' ? el.hasAttribute(name) : ga(el, name) !== null;
  }

  function findChildByClass(parent, cls) {
    const chs = parent && parent.children;
    if (!chs) return null;
    for (let i = 0; i < chs.length; i++) {
      if (chs[i] && chs[i].classList && chs[i].classList.contains(cls)) return chs[i];
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

  const getStore = () => W.localStorage || null;

  function loadViewModePreference() {
    if (viewModeLoaded || hasExplicitHostView) {
      viewModeLoaded = true;
      return;
    }
    viewModeLoaded = true;
    try {
      const saved = getStore()?.getItem(VIEW_MODE_STORAGE_KEY);
      if (saved === 'bilingual' || saved === 'immersive') currentViewMode = saved;
    } catch (_) {}
  }

  function persistViewModePreference(mode) {
    try { getStore()?.setItem(VIEW_MODE_STORAGE_KEY, mode); } catch (_) {}
  }

  function loadLocalStorageCache() {
    if (localCacheLoaded) return;
    localCacheLoaded = true;
    try {
      const raw = getStore()?.getItem(LOCAL_CACHE_KEY);
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
      const store = getStore();
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
        for (let i = list.length - 1; i >= 0; i--) obj[list[i][0]] = list[i][1];
        store.setItem(LOCAL_CACHE_KEY, JSON.stringify(obj));
      };
      try {
        writePicked(picked);
      } catch (_) {
        if (picked.length > 4) {
          try { writePicked(picked.slice(0, Math.floor(picked.length / 2))); } catch (_) {}
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
      const raw = getStore()?.getItem(LOCAL_CACHE_KEY) || '';
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') storageEntries = Object.keys(parsed).length;
      }
    } catch (_) {}
    return { ok: true, memEntries: memCache.size, storageEntries };
  }

  function clearLocalCache() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    const cleared = memCache.size;
    memCache.clear();
    failedSigs.clear();
    try { getStore()?.removeItem?.(LOCAL_CACHE_KEY); } catch (_) {}
    return { ok: true, cleared, memEntries: 0, storageEntries: 0 };
  }

  function isSigInCooldown(sig) {
    const rec = failedSigs.get(sig);
    if (!rec) return false;
    if (Date.now() >= rec.u) {
      failedSigs.delete(sig);
      return false;
    }
    return true;
  }

  function recordSigFailure(sig) {
    if (!sig) return;
    const prev = failedSigs.get(sig);
    const c = prev ? prev.c + 1 : 1;
    failedSigs.set(sig, { c, u: Date.now() + (c === 1 ? 15000 : c === 2 ? 45000 : 120000) });
  }

  function getBridge() {
    return W.__agPrismThoughtBridge || null;
  }

  function callDaemonRpc(payload) {
    try {
      const br = getBridge();
      if (br) {
        const act = payload && payload.action;
        if (act === 'cache-stats' && typeof br.cacheStats === 'function') return Promise.resolve().then(() => br.cacheStats());
        if (act === 'clear-cache' && typeof br.clearCache === 'function') return Promise.resolve().then(() => br.clearCache());
        if (act === 'cancel-translate' && typeof br.cancelTranslate === 'function') return Promise.resolve().then(() => br.cancelTranslate(payload));
        if (typeof br.call === 'function') return Promise.resolve().then(() => br.call(payload));
      }
      if (typeof W.__agPrismThoughtCall === 'function') {
        const ret = W.__agPrismThoughtCall(payload);
        if (ret && typeof ret.then === 'function') return ret;
      }
    } catch (_) {}
    return Promise.resolve({ ok: false, offline: true });
  }

  function syncDocViewAttribute() {
    sa(docRoot(), 'data-ag-prism-thought-view', currentViewMode);
  }

  function ensureInitialized() {
    loadLocalStorageCache();
    loadViewModePreference();
    const rootEl = docRoot();
    if (rootEl && ga(rootEl, 'data-ag-prism-thought-owner') !== OWNER_ID) {
      sa(rootEl, 'data-ag-prism-thought-owner', OWNER_ID);
    }
    syncDocViewAttribute();

    if (cacheWarmed) return;
    cacheWarmed = true;
    const br = getBridge();
    if (br && typeof br.call === 'function') {
      br.call({ action: 'get-cache' })
        .then((res) => {
          const nextTag = res?.styleTag || (res?.stylePreset ? `ai_${res.stylePreset}` : '');
          if (nextTag && nextTag !== activeStyleTag) activeStyleTag = nextTag;
          if (!hasExplicitHostView && (res?.viewMode === 'bilingual' || res?.viewMode === 'immersive')) {
            let hasLocalPref = false;
            try { hasLocalPref = Boolean(W.localStorage?.getItem(VIEW_MODE_STORAGE_KEY)); } catch (_) {}
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
            if (added > 0) persistLocalStorageCache();
          }
          scheduleScan(20);
        })
        .catch(() => {});
    }
  }

  function cancelFlushHandle(entry) {
    if (!entry) return;
    const caf = getCafFn();
    if (entry.pRaf) {
      if (caf) caf(entry.pRaf);
      entry.pRaf = null;
    }
    if (!entry.fTm) return;
    if (entry.fRaf && caf) caf(entry.fTm);
    else clearTimeout(entry.fTm);
    entry.fTm = null;
    entry.fRaf = false;
  }

  function cancelTranslateRequest(entry) {
    if (!entry || entry.x) return;
    entry.x = true;
    cancelFlushHandle(entry);
    if (entry.id) {
      void callDaemonRpc({ action: 'cancel-translate', requestId: entry.id }).catch(() => {});
    }
  }

  function applyPanelViewMode(panel) {
    if (!panel) return;
    const ov = findDirectOverlay(panel);
    const isFailed = ga(panel, 'data-op-zh-failed') === '1';
    const manualRaw = ga(panel, 'data-op-manual-raw');
    const shouldShowRaw = isFailed || (manualRaw === '1' ? true : manualRaw === '0' ? false : currentViewMode === 'bilingual');

    if (shouldShowRaw) sa(panel, 'data-op-show-raw', '1');
    else ra(panel, 'data-op-show-raw');

    if (currentViewMode === 'bilingual' && shouldShowRaw && !isFailed) sa(panel, 'data-op-bilingual', '1');
    else ra(panel, 'data-op-bilingual');

    if (ov) {
      const toggleBtn = findChildByClass(ov, 'ag-prism-thought-raw-toggle');
      if (toggleBtn) {
        sa(toggleBtn, 'aria-pressed', String(shouldShowRaw));
        const t = getClientPack();
        toggleBtn.textContent = shouldShowRaw ? t[1] : t[0];
      }
    }
  }

  function refreshAllOverlayLocaleStrings() {
    const t = getClientPack();
    qsa(SEL_OVERLAY).forEach((ov) => {
      const panel = ov.parentElement;
      const fb = findChildByClass(ov, 'ag-prism-thought-fallback-badge');
      if (fb) {
        fb.textContent = t[2];
        fb.title = t[3];
      }
      const rb = findChildByClass(ov, 'ag-prism-thought-retranslate-btn');
      if (rb) {
        rb.title = t[4];
        sa(rb, 'aria-label', t[4]);
      }
      const tb = findChildByClass(ov, 'ag-prism-thought-raw-toggle');
      if (tb) {
        tb.textContent = ga(panel, 'data-op-show-raw') === '1' ? t[1] : t[0];
      }
      const body = findChildByClass(ov, 'ag-prism-thought-body');
      if (body) {
        const errBar = findChildByClass(body, 'ag-prism-thought-error-bar');
        if (errBar) {
          const errTxt = findChildByClass(errBar, 'ag-prism-thought-error-text');
          if (errTxt) errTxt.textContent = t[5];
          const retryBtn = findChildByClass(errBar, 'ag-prism-thought-retry-btn');
          if (retryBtn) retryBtn.textContent = t[6];
        }
        const pendingHint = findChildByClass(body, 'ag-prism-thought-pending-hint');
        const kind = ga(pendingHint, 'data-pending-kind');
        if (kind === 'machine') pendingHint.textContent = t[7];
        else if (kind === 'ai') pendingHint.textContent = t[8];
        else if (kind === 'streaming') pendingHint.textContent = t[9];
        else if (kind === 'settling') pendingHint.textContent = t[10];
      }
    });
  }

  function refreshAllPanelViewModes() {
    qsa(SEL_OVERLAY).forEach((ov) => {
      if (ov.parentElement) applyPanelViewMode(ov.parentElement);
    });
  }

  const PANEL_CLEAN_ATTRS = [
    'data-op-zh-ready', 'data-op-zh-pending', 'data-op-zh-failed', 'data-op-zh-fallback',
    'data-op-zh-sig', 'data-op-show-raw', 'data-op-manual-raw', 'data-op-bilingual', 'data-op-thought-panel',
  ];

  function cleanSinglePanelAttributes(panel) {
    if (!panel) return;
    clearPanelStreamState(panel);
    lockedHeights.delete(panel);
    clearPanelWaitTimer(panel);
    panelMeta.delete(panel);
    const ov = findDirectOverlay(panel);
    if (ov) ov.remove();
    raList(panel, PANEL_CLEAN_ATTRS);
    if (panel.style) panel.style.removeProperty('min-height');
  }

  function releasePrismOverlays() {
    clearAllWaitTimers(false);
    for (const entry of inflightBySig.values()) cancelTranslateRequest(entry);
    inflightBySig.clear();
    qsa(SEL_OVERLAY).forEach((ov) => {
      const panel = ov.parentElement;
      ov.remove();
      if (panel) cleanSinglePanelAttributes(panel);
    });
    qsa(SEL_TRIGGER).forEach((btn) => {
      if (btn && btn.nextElementSibling) cleanSinglePanelAttributes(btn.nextElementSibling);
    });
    const rootEl = docRoot();
    ra(rootEl, 'data-ag-prism-thought-owner');
    ra(rootEl, 'data-ag-prism-thought-view');
  }

  function isTriggerStreaming(btn) {
    if (!btn) return false;
    if (ga(btn, 'data-op-thought-state') === 'streaming' || ga(btn, 'data-ag-cs-spark-streaming') === '1') return true;
    try {
      if (
        btn.querySelector &&
        btn.querySelector(
          '.animate-shimmer-text, .animate-spin, .animate-pulse, [class*="animate-shimmer"], .ag-cs-thinking-spark[data-state="streaming"]'
        )
      ) return true;
    } catch (_) {}
    const txt = (btn.textContent || '').trim();
    if (!txt || /已思考|Thought\s+for|Thought\s+process/i.test(txt)) return false;
    return /thinking|正在思考|思考中|推演中|諗緊/i.test(txt) && !/\d+\s*(s|sec|秒|m|min|分)/i.test(txt);
  }

  function isOverlayOrIgnoredElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (hasAttr(el, 'data-op-thought') || hasAttr(el, 'data-prism-ignore')) return true;
    const cls = String(ga(el, 'class') || el.className || '');
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
    const hi = safeHref.indexOf('#');
    const bh = hi >= 0 ? safeHref.slice(0, hi) : safeHref;
    const h = hi >= 0 ? safeHref.slice(hi) : '';
    let dp = bh.replace(/^file:\/\/(?:localhost)?/i, '');
    try { dp = decodeURIComponent(dp); } catch (_) {}
    dp = dp.replace(/\\/g, '/');
    const segs = dp.split('/').filter(Boolean);
    const bn = segs.length ? segs[segs.length - 1] : '';
    return { bh, h, dp, bn, pb: segs.length >= 2 ? `${segs[segs.length - 2]}/${bn}` : bn };
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
    return { list: [], nh: new Map(), tk: new Map(), btk: new Map() };
  }

  function registerFileNodeInMap(node, fm) {
    if (!node || !fm) return;
    const tag = node.tagName ? String(node.tagName).toUpperCase() : '';
    const rawHref = (tag === 'A' && (ga(node, 'href') || node.href)) || ga(node, 'data-file-href') || ga(node, 'data-href') || '';
    let safeHref = sanitizeFileHref(rawHref);
    let omniRel = '';
    if (!safeHref) {
      const rawPath = ga(node, 'data-file-path') || ga(node, 'data-filepath') || ga(node, 'data-omni-path') || '';
      if (rawPath) {
        const ls = ga(node, 'data-line') || ga(node, 'data-omni-line-start') || '';
        const le = ga(node, 'data-omni-line-end') || '';
        const hashSfx = ls && /^\d+$/.test(ls) ? (le && /^\d+$/.test(le) && le !== ls ? `#L${ls}-L${le}` : `#L${ls}`) : '';
        const base = filePathToSafeHref(rawPath);
        if (base) safeHref = hashSfx ? `${base}${hashSfx}` : base;
        else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawPath) && !/[\u0000-\u001f\u007f"'<>`]/.test(rawPath)) {
          omniRel = `${rawPath.trim().replace(/\\/g, '/')}${hashSfx}`;
        }
      }
    }
    if (!safeHref && !omniRel) return;

    const label = String(node.textContent || '').trim().replace(/^`+|`+$/g, '').trim();
    let rec;
    let bname = '';
    let pbase = '';
    let hsh = '';
    let extraBase = '';

    if (!safeHref) {
      const hi = omniRel.indexOf('#');
      const baseRel = hi >= 0 ? omniRel.slice(0, hi) : omniRel;
      hsh = hi >= 0 ? omniRel.slice(hi) : '';
      const segs = baseRel.split('/').filter(Boolean);
      bname = segs.length ? segs[segs.length - 1] : '';
      pbase = segs.length >= 2 ? `${segs[segs.length - 2]}/${bname}` : bname;
      extraBase = baseRel;
      rec = { el: node, href: '', rel: omniRel, bRel: baseRel, bh: '', h: hsh, dp: `/${baseRel.toLowerCase()}` };
    } else {
      const nh = normalizeFileHrefForMatch(safeHref);
      const pts = parseFileHrefParts(safeHref);
      bname = pts.bn;
      pbase = pts.pb;
      hsh = pts.h;
      rec = { el: node, href: safeHref, rel: '', bRel: '', bh: pts.bh, h: hsh, dp: pts.dp.toLowerCase() };
      if (!fm.nh.has(nh)) fm.nh.set(nh, rec);
    }

    fm.list.push(rec);
    const addMap = (mp, k) => {
      const key = String(k || '').trim().replace(/\\/g, '/').toLowerCase();
      if (key && !mp.has(key)) mp.set(key, rec);
    };
    if (label && (/[./\\]/.test(label) || /#L\d+/i.test(label))) {
      addMap(fm.tk, label);
      if (!/#L\d+|:\d+/i.test(label)) addMap(fm.btk, label);
    }
    if (bname && bname.includes('.')) {
      if (hsh) {
        addMap(fm.tk, `${bname}${hsh}`);
        if (pbase !== bname) addMap(fm.tk, `${pbase}${hsh}`);
      }
      addMap(fm.btk, bname);
      if (pbase !== bname) addMap(fm.btk, pbase);
      if (extraBase) addMap(fm.btk, extraBase);
    }
  }

  function collectCleanText(node, chunks, fm) {
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
    if (fm) registerFileNodeInMap(node, fm);
    const isBlock = Boolean(BLOCK_TAGS[tag]);
    if (isBlock) chunks.push('\n');
    const chs = node.childNodes;
    if (chs && chs.length) {
      for (let i = 0; i < chs.length; i++) collectCleanText(chs[i], chunks, fm);
    } else if (typeof node.textContent === 'string' && (!node.children || !node.children.length)) {
      chunks.push(node.textContent);
    }
    if (isBlock) chunks.push('\n');
  }

  function extractRawEnglishText(panel) {
    if (!panel || !panel.childNodes) return '';
    const chunks = [];
    const fm = createEmptyFileMap();
    for (let i = 0; i < panel.childNodes.length; i++) collectCleanText(panel.childNodes[i], chunks, fm);
    panelFileMaps.set(panel, fm);
    return normalizeTextKey(chunks.join(''));
  }

  function ensurePanelFileMap(panel) {
    if (!panel) return null;
    if (!panelFileMaps.has(panel)) extractRawEnglishText(panel);
    return panelFileMaps.get(panel) || null;
  }

  function lookupFileTarget(fm, rawCandidate) {
    const cleaned = String(rawCandidate || '').trim().replace(/^`+|`+$/g, '').trim();
    if (!cleaned) return null;

    if (/^file:\/\//i.test(cleaned)) {
      const safe = sanitizeFileHref(cleaned);
      if (!safe) return null;
      const hit = fm ? fm.nh.get(normalizeFileHrefForMatch(safe)) : null;
      return { href: safe, el: hit ? hit.el : null };
    }

    if (!fm || !fm.list.length) return null;

    const normToken = cleaned.replace(/\\/g, '/').replace(/^\.\//, '');
    const exactHit = fm.tk.get(normToken.toLowerCase());
    if (exactHit) return { href: exactHit.href, rel: exactHit.rel, el: exactHit.el };

    const lineSplit = /^(.+?)(#L\d+(?:-L?\d+)?|:\d+(?:-\d+)?(?::\d+)?)$/i.exec(normToken);
    const basePart = (lineSplit ? lineSplit[1] : normToken).toLowerCase();
    const normHash = lineSplit ? normalizeLineHashSuffix(lineSplit[2]) : '';

    if (normHash) {
      const withHashHit = fm.tk.get(`${basePart}${normHash.toLowerCase()}`);
      if (withHashHit) return { href: withHashHit.href, rel: withHashHit.rel, el: withHashHit.el };
    }

    let baseRec = fm.btk.get(basePart) || null;
    if (!baseRec && basePart.includes('/')) {
      const suffix = `/${basePart}`;
      for (let i = 0; i < fm.list.length; i++) {
        if (fm.list[i].dp.endsWith(suffix)) {
          baseRec = fm.list[i];
          break;
        }
      }
    }
    if (!baseRec) return null;

    const sameHash = !normHash || baseRec.h.toLowerCase() === normHash.toLowerCase();
    if (baseRec.rel && !baseRec.href) {
      return { href: '', rel: normHash ? `${baseRec.bRel}${normHash}` : baseRec.rel, el: sameHash ? baseRec.el : null };
    }

    if (normHash) {
      const composedHref = sanitizeFileHref(`${baseRec.bh}${normHash}`);
      if (!composedHref) return null;
      const exactAnchor = fm.nh.get(normalizeFileHrefForMatch(composedHref));
      return { href: composedHref, rel: '', el: exactAnchor ? exactAnchor.el : !baseRec.h || sameHash ? baseRec.el : null };
    }

    return { href: baseRec.href, rel: '', el: baseRec.el };
  }

  function findLiveAnchorInTree(node, targetNormHref, targetBaseHref, out) {
    if (!node || node.nodeType !== 1 || isOverlayOrIgnoredElement(node)) return;
    const tag = node.tagName ? String(node.tagName).toUpperCase() : '';
    if (tag === 'A' || ga(node, 'data-file-href') || ga(node, 'data-file-path')) {
      const safe = sanitizeFileHref(ga(node, 'href') || ga(node, 'data-file-href') || node.href || '');
      if (safe) {
        if (normalizeFileHrefForMatch(safe) === targetNormHref && !out.e) {
          out.e = node;
          return;
        }
        if (parseFileHrefParts(safe).bh.toLowerCase() === targetBaseHref && !out.b) out.b = node;
      }
    }
    const chs = node.children || node.childNodes;
    if (chs && chs.length) {
      for (let i = 0; i < chs.length && !out.e; i++) findLiveAnchorInTree(chs[i], targetNormHref, targetBaseHref, out);
    }
  }

  function resolveLiveNativeAnchor(panel, safeHref, cachedEl) {
    if (cachedEl && cachedEl.isConnected !== false && typeof cachedEl.click === 'function') return cachedEl;
    if (!panel || !panel.childNodes) return null;
    const tNorm = normalizeFileHrefForMatch(safeHref);
    const tBase = parseFileHrefParts(safeHref).bh.toLowerCase();
    const out = { e: null, b: null };
    for (let i = 0; i < panel.childNodes.length && !out.e; i++) findLiveAnchorInTree(panel.childNodes[i], tNorm, tBase, out);
    return out.e || out.b || null;
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
      const hm = /^#L(\d+)(?:-L?(\d+))?/i.exec(parts.h || '');
      lineStart = hm ? parseInt(hm[1], 10) : null;
      lineEnd = hm && hm[2] ? parseInt(hm[2], 10) : lineStart;
      filePath = parts.dp || safeHref;
      if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1);
    } else {
      const hm = /#L(\d+)(?:-L?(\d+))?$/i.exec(filePath);
      if (hm) {
        lineStart = parseInt(hm[1], 10);
        lineEnd = hm[2] ? parseInt(hm[2], 10) : lineStart;
        filePath = filePath.slice(0, hm.index);
      }
    }
    stopEv(ev);
    void omni.openFile(filePath, {
      mode: ev && (ev.ctrlKey || ev.metaKey) ? 'external' : 'workbench',
      rawUri: safeHref || undefined,
      lineStart,
      lineEnd,
    });
    return true;
  }

  function createFilePill(doc, labelText, targetHref, nativeEl, panel, omniRel = '') {
    const safeHref = sanitizeFileHref(targetHref);
    const cleanRel =
      !safeHref && omniRel && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(omniRel) && !/[\u0000-\u001f\u007f"'<>`]/.test(omniRel)
        ? String(omniRel).trim()
        : '';
    if (!safeHref && !cleanRel) return ctn(doc, labelText);
    const pill = ce(doc, safeHref ? 'a' : 'span', 'ag-prism-thought-file-pill');
    if (safeHref) {
      sa(pill, 'href', safeHref);
      sa(pill, 'title', safeHref);
    } else {
      sa(pill, 'role', 'link');
      sa(pill, 'tabindex', '0');
      sa(pill, 'data-file-path', cleanRel);
      sa(pill, 'title', cleanRel);
    }
    sa(pill, 'data-file-pill', '1');
    if (pill.style) Object.assign(pill.style, { cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' });
    pill.textContent = labelText;
    onClk(pill, (ev) => {
      if (ev && typeof ev.button === 'number' && ev.button !== 0) return;
      const targetAnchor = safeHref
        ? resolveLiveNativeAnchor(panel, safeHref, nativeEl)
        : nativeEl && nativeEl.isConnected !== false && typeof nativeEl.click === 'function'
        ? nativeEl
        : null;
      if (targetAnchor && targetAnchor !== pill && typeof targetAnchor.click === 'function') {
        stopEv(ev);
        targetAnchor.click();
        return;
      }
      openInOmniFallback(cleanRel || safeHref, safeHref, ev);
    });
    return pill;
  }

  function appendPlainTextWithFileRefs(parent, plainSlice, doc, fm, panel) {
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
      const hit = lookupFileTarget(fm, rawTok);
      if (hit && (hit.href || hit.rel)) {
        if (m.index > last) ap(parent, ctn(doc, plainSlice.slice(last, m.index)));
        let displayLabel = rawTok;
        if (/^file:\/\//i.test(rawTok) && hit.href) {
          const parts = parseFileHrefParts(hit.href);
          displayLabel = parts.bn ? `${parts.bn}${parts.h}` : rawTok;
        }
        ap(parent, createFilePill(doc, displayLabel, hit.href, hit.el, panel, hit.rel));
        if (trailing) ap(parent, ctn(doc, trailing));
        last = m.index + m[0].length;
      }
    }
    if (last < plainSlice.length) ap(parent, ctn(doc, plainSlice.slice(last)));
  }

  function appendInlineFormatted(parent, lineText, doc, fm, panel, depth = 0) {
    const tokenRe = /(\[([^\[\]\n]+)\]\(((?:\([^()\s]*\)|[^()\s])+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*)/g;
    let lastIdx = 0;
    let m;
    while ((m = tokenRe.exec(lineText)) !== null) {
      if (m.index > lastIdx) appendPlainTextWithFileRefs(parent, lineText.slice(lastIdx, m.index), doc, fm, panel);
      if (m[2] !== undefined && m[3] !== undefined) {
        const cleanLabel = m[2].trim().replace(/^`+|`+$/g, '').trim() || m[2].trim();
        const rawUrl = m[3].trim();
        const safeHref = sanitizeFileHref(rawUrl);
        if (safeHref) {
          const hit = lookupFileTarget(fm, safeHref) || lookupFileTarget(fm, cleanLabel);
          ap(parent, createFilePill(doc, cleanLabel, safeHref, hit ? hit.el : null, panel));
        } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawUrl)) {
          const mapped = lookupFileTarget(fm, rawUrl) || lookupFileTarget(fm, cleanLabel);
          if (mapped && (mapped.href || mapped.rel)) {
            ap(parent, createFilePill(doc, cleanLabel, mapped.href, mapped.el, panel, mapped.rel));
          } else {
            ap(parent, ctn(doc, cleanLabel));
          }
        } else {
          ap(parent, ctn(doc, cleanLabel));
        }
      } else if (m[4] !== undefined) {
        const codeInner = m[4];
        const hit = lookupFileTarget(fm, codeInner);
        if (hit && (hit.href || hit.rel)) {
          ap(parent, createFilePill(doc, codeInner.trim(), hit.href, hit.el, panel, hit.rel));
        } else {
          const code = ce(doc, 'code', 'ag-prism-thought-code');
          code.textContent = codeInner;
          ap(parent, code);
        }
      } else if (m[5] !== undefined) {
        const strong = ce(doc, 'strong');
        if (depth < 2) appendInlineFormatted(strong, m[5], doc, fm, panel, depth + 1);
        else strong.textContent = m[5];
        ap(parent, strong);
      }
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < lineText.length) appendPlainTextWithFileRefs(parent, lineText.slice(lastIdx), doc, fm, panel);
  }

  function quickStructureSig(panel) {
    if (!panel || !panel.childNodes) return null;
    const nodes = panel.childNodes;
    let c = 0;
    let f = null;
    let l = null;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.nodeType === 1 && isOverlayOrIgnoredElement(n)) continue;
      c++;
      if (c === 1) f = n;
      l = n;
    }
    return { c, f, l };
  }

  function quickPanelStamp(panel) {
    if (!panel || !panel.childNodes) return '';
    const nodes = panel.childNodes;
    let c = 0;
    let fl = 0;
    let ll = 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.nodeType === 1 && isOverlayOrIgnoredElement(n)) continue;
      c++;
      const l = n.nodeType === 3 ? (n.nodeValue || '').length : (n.textContent || '').length;
      if (c === 1) fl = l;
      ll = l;
    }
    return `${c}:${fl}:${ll}`;
  }

  function splitMarkdownBlocks(markdownText) {
    const lines = String(markdownText || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let inFence = false;
    let fenceLines = [];
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();
      if (trimmed.startsWith('```')) {
        if (!inFence) {
          inFence = true;
          fenceLines = [];
        } else {
          blocks.push({ type: 'pre', text: fenceLines.join('\n') });
          inFence = false;
          fenceLines = [];
        }
        continue;
      }
      if (inFence) {
        fenceLines.push(rawLine);
        continue;
      }
      if (!trimmed) continue;
      const ulMatch = /^[-*•]\s+(.+)$/.exec(trimmed);
      if (ulMatch) {
        blocks.push({ type: 'ul', text: ulMatch[1] });
        continue;
      }
      const olMatch = /^\d+[.)]\s+(.+)$/.exec(trimmed);
      if (olMatch) {
        blocks.push({ type: 'ol', text: olMatch[1] });
        continue;
      }
      blocks.push({ type: 'p', text: trimmed.replace(/^#{1,4}\s+/, '') });
    }
    if (inFence && fenceLines.length) {
      blocks.push({ type: 'pre', text: fenceLines.join('\n') });
    }
    return blocks;
  }

  function advanceSafeChunkEnd(str, fromIdx, rawTake) {
    const len = str.length;
    let end = Math.min(len, fromIdx + Math.max(1, rawTake));
    if (end >= len) return len;
    // Never split UTF-16 surrogate pairs
    const prevCode = str.charCodeAt(end - 1);
    if (prevCode >= 0xd800 && prevCode <= 0xdbff && end < len) {
      end++;
    }
    // Keep short ASCII identifier/word intact instead of chopping mid-word
    const curCh = str.charCodeAt(end - 1);
    const isAsciiWord = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95;
    if (isAsciiWord(curCh)) {
      let look = end;
      while (look < len && look - end < 18 && isAsciiWord(str.charCodeAt(look))) {
        look++;
      }
      if (look >= len || !isAsciiWord(str.charCodeAt(look))) {
        end = look;
      }
    }
    // Absorb trailing CJK/ASCII punctuation attached to current phrase
    if (end < len && /[,.;:!?，。、；：！？）》」\]`]/.test(str[end])) {
      end++;
    }
    return end;
  }

  function compactLiveChunks(st, now, flushAll) {
    if (!st || !st.cks.length) return;
    while (st.cks.length > 0 && (flushAll || now - st.cks[0].at >= CHUNK_FADE_TTL_MS || st.cks.length >= MAX_LIVE_CHUNKS)) {
      const old = st.cks.shift();
      if (old.tn) setTn(old.tn, (old.tn.nodeValue ?? old.tn.textContent ?? '') + old.tx);
      old.sp.remove();
    }
  }

  function mountStreamBlockContainer(st, blockType, doc, body) {
    if (blockType === 'ul' || blockType === 'ol') {
      if (!st.le || st.lt !== blockType) {
        st.le = ce(doc, blockType, blockType === 'ul' ? 'ag-prism-thought-ul' : 'ag-prism-thought-ol');
        st.lt = blockType;
        ap(body, st.le);
      }
      return ap(st.le, ce(doc, 'li', 'ag-prism-thought-li'));
    }
    st.le = null;
    st.lt = '';
    return ap(body, ce(doc, blockType === 'pre' ? 'pre' : 'p', blockType === 'pre' ? 'ag-prism-thought-pre' : 'ag-prism-thought-p'));
  }

  function renderIncrementalStreamDom(panel, body, visibleText, now, animateChunks) {
    const blocks = splitMarkdownBlocks(visibleText);
    if (!blocks.length) return;
    const doc = panel.ownerDocument || document;
    sa(body, 'data-streaming-live', '1');
    ra(body, 'data-raw-zh');

    let st = panelStreamStates.get(panel);
    let diverged = !st || st.bd !== body || blocks.length < st.bs.length;
    if (!diverged) {
      const checkLen = Math.min(st.bs.length - 1, blocks.length - 1);
      for (let i = 0; i < checkLen; i++) {
        if (st.bs[i].type !== blocks[i].type || st.bs[i].text !== blocks[i].text) {
          diverged = true;
          break;
        }
      }
    }

    if (diverged) {
      clearEl(body);
      st = { bd: body, bs: [], el: null, tn: null, raw: '', tp: '', le: null, lt: '', cks: [] };
      panelStreamStates.set(panel, st);
    }

    const lastIdx = blocks.length - 1;

    if (st.bs.length > 0 && st.bs.length - 1 < lastIdx) {
      const prevIdx = st.bs.length - 1;
      const targetPrev = blocks[prevIdx];
      if (st.el && st.tn) {
        if (targetPrev.text.startsWith(st.raw) && targetPrev.text.length > st.raw.length) {
          const tail = targetPrev.text.slice(st.raw.length);
          if (animateChunks && targetPrev.type !== 'pre') {
            compactLiveChunks(st, now, false);
            const sp = ce(doc, 'span', 'ag-prism-thought-chunk');
            sp.textContent = tail;
            ap(st.el, sp);
            st.cks.push({ sp, tn: st.tn, tx: tail, at: now });
          } else {
            compactLiveChunks(st, now, true);
            setTn(st.tn, (st.tn.nodeValue ?? st.tn.textContent ?? '') + tail);
          }
        }
        st.bs[prevIdx] = { type: targetPrev.type, text: targetPrev.text };
      }
      st.el = null;
      st.tn = null;
      st.raw = '';
      st.tp = '';
    }

    while (st.bs.length < lastIdx) {
      const blk = blocks[st.bs.length];
      const el = mountStreamBlockContainer(st, blk.type, doc, body);
      if (blk.type === 'pre') el.textContent = blk.text;
      else appendInlineFormatted(el, blk.text, doc, ensurePanelFileMap(panel), panel, 0);
      st.bs.push({ type: blk.type, text: blk.text });
    }

    const curBlk = blocks[lastIdx];
    if (!st.el || st.tp !== curBlk.type) {
      if (st.el && st.bs.length > lastIdx) {
        const staleTn = st.tn;
        st.cks = st.cks.filter((c) => (c.tn === staleTn ? (c.sp.remove(), false) : true));
        st.el.remove();
      }
      const el = mountStreamBlockContainer(st, curBlk.type, doc, body);
      const tn = ap(el, ctn(doc, ''));
      st.el = el;
      st.tn = tn;
      st.raw = '';
      st.tp = curBlk.type;
      st.bs[lastIdx] = { type: curBlk.type, text: '' };
    }

    if (!animateChunks || curBlk.type === 'pre') compactLiveChunks(st, now, true);
    if (curBlk.text === st.raw) {
      compactLiveChunks(st, now, false);
      return;
    }

    if (curBlk.text.startsWith(st.raw)) {
      const delta = curBlk.text.slice(st.raw.length);
      if (!animateChunks || curBlk.type === 'pre') {
        setTn(st.tn, (st.tn.nodeValue ?? st.tn.textContent ?? '') + delta);
      } else {
        compactLiveChunks(st, now, false);
        const sp = ce(doc, 'span', 'ag-prism-thought-chunk');
        sp.textContent = delta;
        ap(st.el, sp);
        st.cks.push({ sp, tn: st.tn, tx: delta, at: now });
      }
    } else {
      const activeTn = st.tn;
      st.cks = st.cks.filter((c) => (c.tn === activeTn ? (c.sp.remove(), false) : true));
      setTn(activeTn, curBlk.text);
    }
    st.raw = curBlk.text;
    st.bs[lastIdx].text = curBlk.text;
  }

  function renderSafeMarkdownDom(container, markdownText, fm, panel) {
    const hasStreamChild =
      hasAttr(container, 'data-streaming-live') ||
      Boolean((container.querySelector && container.querySelector('.ag-prism-thought-stream')) || findChildByClass(container, 'ag-prism-thought-stream'));
    if (!hasStreamChild && !findChildByClass(container, 'ag-prism-thought-error-bar') && ga(container, 'data-raw-zh') === markdownText) {
      return;
    }
    ra(container, 'data-streaming-live');
    const doc = container.ownerDocument || document;
    clearEl(container);
    sa(container, 'data-raw-zh', markdownText);

    const blocks = splitMarkdownBlocks(markdownText);
    const listCtx = { le: null, lt: '' };
    for (let i = 0; i < blocks.length; i++) {
      const blk = blocks[i];
      const el = mountStreamBlockContainer(listCtx, blk.type, doc, container);
      if (blk.type === 'pre') el.textContent = blk.text;
      else appendInlineFormatted(el, blk.text, doc, fm, panel, 0);
    }
  }

  function findDirectOverlay(panel) {
    return findChildByClass(panel, 'ag-prism-thought-overlay');
  }

  function triggerSingleBlockRetranslate(panel) {
    if (!panel || currentMode === 'off') return;
    const rawText = extractRawEnglishText(panel);
    if (!rawText) return;
    const sig = computeSig(rawText, currentMode);
    failedSigs.delete(sig);
    memCache.delete(hashKey(rawText, 'mt'));
    memCache.delete(hashKey(rawText, activeStyleTag || 'ai_technical'));
    persistLocalStorageCache();

    const existing = inflightBySig.get(sig);
    if (existing) {
      cancelTranslateRequest(existing);
      inflightBySig.delete(sig);
    }
    startOrJoinTranslation(panel, rawText, currentMode, sig, hashKey(rawText, 'sig'), true, { force: true, priority: 30000 });
  }

  function ensureOverlayShell(panel) {
    const doc = panel.ownerDocument || document;
    let ov = findDirectOverlay(panel);
    if (ov) return ov;

    const t = getClientPack();
    ov = ce(doc, 'div', 'ag-prism-thought-overlay');
    sa(ov, 'data-op-thought', '1');
    sa(ov, 'data-prism-ignore', '1');
    sa(ov, 'data-ag-no-i18n', '');

    const body = ce(doc, 'span', 'ag-prism-thought-body');
    sa(body, 'data-ag-no-i18n', '');
    ap(ov, body);

    const fb = ce(doc, 'span', 'ag-prism-thought-fallback-badge');
    sa(fb, 'data-testid', 'thought-fallback-badge');
    fb.hidden = true;
    fb.textContent = t[2];
    fb.title = t[3];
    if (fb.style) {
      Object.assign(fb.style, { display: 'none', fontSize: '11px', padding: '1px 6px', borderRadius: '999px', opacity: '0.85', marginRight: '4px' });
    }
    ap(ov, fb);

    const rb = ce(doc, 'button', 'ag-prism-thought-retranslate-btn');
    rb.type = 'button';
    sa(rb, 'data-no-press-spring', '1');
    sa(rb, 'data-testid', 'thought-retranslate-btn');
    rb.hidden = true;
    rb.textContent = '↻';
    rb.title = t[4];
    sa(rb, 'aria-label', t[4]);
    if (rb.style) Object.assign(rb.style, { display: 'none', opacity: '0.6', cursor: 'pointer', marginRight: '4px' });
    onClk(rb, (ev) => {
      stopEv(ev);
      triggerSingleBlockRetranslate(panel);
    });
    ap(ov, rb);

    const tb = ce(doc, 'button', 'ag-prism-thought-raw-toggle');
    tb.type = 'button';
    sa(tb, 'data-no-press-spring', '1');
    const showingRaw = ga(panel, 'data-op-show-raw') === '1';
    sa(tb, 'aria-pressed', String(showingRaw));
    tb.textContent = showingRaw ? t[1] : t[0];
    onClk(tb, (ev) => {
      stopEv(ev);
      sa(panel, 'data-op-manual-raw', ga(panel, 'data-op-show-raw') === '1' ? '0' : '1');
      applyPanelViewMode(panel);
    });
    ap(ov, tb);

    sa(panel, 'data-op-thought-panel', '1');
    panel.insertBefore(ov, panel.firstChild);
    return ov;
  }

  function syncOverlayBadges(ov, panel, isFallback, isReady) {
    if (!ov) return;
    const t = getClientPack();
    const fb = findChildByClass(ov, 'ag-prism-thought-fallback-badge');
    if (fb) {
      fb.hidden = !isFallback;
      if (fb.style) fb.style.display = isFallback ? '' : 'none';
      fb.textContent = t[2];
      fb.title = t[3];
    }
    if (panel) {
      if (isFallback) sa(panel, 'data-op-zh-fallback', '1');
      else ra(panel, 'data-op-zh-fallback');
    }
    const rb = findChildByClass(ov, 'ag-prism-thought-retranslate-btn');
    if (rb) {
      rb.hidden = !isReady;
      if (rb.style) rb.style.display = isReady ? '' : 'none';
      rb.disabled = false;
      rb.title = t[4];
      sa(rb, 'aria-label', t[4]);
    }
  }

  function renderPendingState(panel, message, pendingKind = '') {
    if (!panel) return;
    const existingOv = findDirectOverlay(panel);
    if (ga(panel, 'data-op-zh-ready') === '1' && existingOv && ga(existingOv, 'data-pending') !== '1') {
      const rb = findChildByClass(existingOv, 'ag-prism-thought-retranslate-btn');
      if (rb) rb.disabled = true;
      return;
    }
    clearPanelStreamState(panel);
    const ov = ensureOverlayShell(panel);
    sa(ov, 'data-pending', '1');
    ra(ov, 'data-failed');
    ra(panel, 'data-op-zh-failed');
    syncOverlayBadges(ov, panel, false, false);

    const body = findChildByClass(ov, 'ag-prism-thought-body');
    if (body) {
      ra(body, 'data-raw-zh');
      let hint = findChildByClass(body, 'ag-prism-thought-pending-hint');
      if (!hint) {
        clearEl(body);
        hint = ap(body, ce(panel.ownerDocument || document, 'span', 'ag-prism-thought-pending-hint'));
      }
      if (pendingKind) sa(hint, 'data-pending-kind', pendingKind);
      if (hint.textContent !== message) hint.textContent = message;
    }
    if (ga(panel, 'data-op-zh-pending') !== '1') sa(panel, 'data-op-zh-pending', '1');
    ra(panel, 'data-op-zh-ready');
  }

  function clearPendingKeepRaw(panel) {
    if (!panel || ga(panel, 'data-op-zh-ready') === '1') return;
    lockedHeights.delete(panel);
    if (panel.style) panel.style.removeProperty('min-height');
    ra(panel, 'data-op-zh-pending');
    const ov = findDirectOverlay(panel);
    if (ov && ga(ov, 'data-pending') === '1') {
      ov.remove();
      if (ga(panel, 'data-op-zh-failed') !== '1') ra(panel, 'data-op-thought-panel');
    }
  }

  function renderFailedState(panel, rawText, mode, sig) {
    if (!panel) return;
    clearPanelStreamState(panel);
    lockedHeights.delete(panel);
    if (panel.style) panel.style.removeProperty('min-height');
    ra(panel, 'data-op-zh-pending');

    const existingOv = findDirectOverlay(panel);
    if (ga(panel, 'data-op-zh-ready') === '1' && existingOv) {
      const rb = findChildByClass(existingOv, 'ag-prism-thought-retranslate-btn');
      if (rb) rb.disabled = false;
      return;
    }

    const doc = panel.ownerDocument || document;
    const t = getClientPack();
    const ov = ensureOverlayShell(panel);
    ra(ov, 'data-pending');
    sa(ov, 'data-failed', '1');
    ra(panel, 'data-op-zh-ready');
    sa(panel, 'data-op-zh-failed', '1');
    syncOverlayBadges(ov, panel, false, false);

    const body = findChildByClass(ov, 'ag-prism-thought-body');
    if (body) {
      ra(body, 'data-raw-zh');
      clearEl(body);
      const errBar = ce(doc, 'span', 'ag-prism-thought-error-bar');
      if (errBar.style) Object.assign(errBar.style, { display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px', opacity: '0.82' });
      const errTxt = ce(doc, 'span', 'ag-prism-thought-error-text');
      errTxt.textContent = t[5];
      ap(errBar, errTxt);

      const retryBtn = ce(doc, 'button', 'ag-prism-thought-retry-btn');
      retryBtn.type = 'button';
      sa(retryBtn, 'data-testid', 'thought-retry-btn');
      sa(retryBtn, 'data-no-press-spring', '1');
      retryBtn.textContent = t[6];
      if (retryBtn.style) Object.assign(retryBtn.style, { cursor: 'pointer', textDecoration: 'underline' });
      onClk(retryBtn, (ev) => {
        stopEv(ev);
        failedSigs.delete(sig);
        ra(ov, 'data-failed');
        ra(panel, 'data-op-zh-failed');
        applyPanelViewMode(panel);
        const curRaw = extractRawEnglishText(panel) || rawText;
        const activeMode = currentMode === 'off' ? mode : currentMode;
        const nextSig = computeSig(curRaw, activeMode);
        failedSigs.delete(nextSig);
        startOrJoinTranslation(panel, curRaw, activeMode, nextSig, hashKey(curRaw, 'sig'), true, { force: true, priority: 30000 });
      });
      ap(errBar, retryBtn);
      ap(body, errBar);
    }
    applyPanelViewMode(panel);
  }

  function renderTranslatedText(panel, text, isPartial, sig, engine = '', streamOpts = null) {
    if (!panel || typeof text !== 'string' || !text) return;
    const ov = ensureOverlayShell(panel);
    if (hasAttr(ov, 'data-pending')) ra(ov, 'data-pending');
    if (hasAttr(ov, 'data-failed')) ra(ov, 'data-failed');
    if (hasAttr(panel, 'data-op-zh-failed')) ra(panel, 'data-op-zh-failed');
    const body = findChildByClass(ov, 'ag-prism-thought-body');
    if (!body) return;

    const isFallback = engine === 'machine-fallback';

    if (isPartial) {
      if (!lockedHeights.has(panel)) {
        const curH = panel.offsetHeight || 0;
        if (curH > 0 && panel.style) {
          lockedHeights.set(panel, curH);
          panel.style.minHeight = `${curH}px`;
        }
      }
      if (streamOpts && streamOpts.inc) {
        renderIncrementalStreamDom(panel, body, text, streamOpts.now || nowMs(), Boolean(streamOpts.anim && !isMotionOff()));
      } else {
        let streamEl = findChildByClass(body, 'ag-prism-thought-stream');
        if (streamEl && streamLastLenMap.get(streamEl) === text.length && ga(panel, 'data-op-zh-ready') === '1') return;
        if (hasAttr(body, 'data-raw-zh')) ra(body, 'data-raw-zh');
        if (!streamEl) {
          clearEl(body);
          const doc = panel.ownerDocument || document;
          streamEl = ce(doc, 'p', 'ag-prism-thought-stream');
          sa(streamEl, 'data-ag-no-i18n', '');
          if (typeof doc.createTextNode === 'function') ap(streamEl, ctn(doc, text));
          else streamEl.textContent = text;
          ap(body, streamEl);
        } else {
          const tn = streamEl.firstChild;
          if (tn && tn.nodeType === 3) setTn(tn, text);
          else streamEl.textContent = text;
        }
        streamLastLenMap.set(streamEl, text.length);
      }
      syncOverlayBadges(ov, panel, isFallback, false);
    } else {
      const commitFinalDom = () => {
        panelSettleTimers.delete(panel);
        panelStreamStates.delete(panel);
        if (!panel.isConnected || currentMode === 'off') return;
        const prevScrollTop = typeof panel.scrollTop === 'number' ? panel.scrollTop : 0;
        renderSafeMarkdownDom(body, text, ensurePanelFileMap(panel), panel);
        lockedHeights.delete(panel);
        if (panel.style && panel.style.minHeight) panel.style.removeProperty('min-height');
        if (prevScrollTop > 0 && typeof panel.scrollTop === 'number') panel.scrollTop = prevScrollTop;
      };

      const st = panelStreamStates.get(panel);
      const now = nowMs();
      const hasLive = Boolean(!isMotionOff() && st && st.cks && st.cks.length);
      const remFadeMs = hasLive ? Math.max(0, CHUNK_FADE_TTL_MS - Math.max(0, now - st.cks[st.cks.length - 1].at)) : 0;

      if (remFadeMs > 16) {
        const prevT = panelSettleTimers.get(panel);
        if (prevT) clearTimeout(prevT);
        const timer = setTimeout(commitFinalDom, remFadeMs + 12);
        if (timer && typeof timer.unref === 'function') timer.unref();
        panelSettleTimers.set(panel, timer);
      } else {
        clearPanelStreamState(panel);
        commitFinalDom();
      }

      syncOverlayBadges(ov, panel, isFallback, true);
      if (sig) {
        const effectiveSig = isFallback ? `${sig}:fallback` : sig;
        if (ga(panel, 'data-op-zh-sig') !== effectiveSig) sa(panel, 'data-op-zh-sig', effectiveSig);
        const meta = panelMeta.get(panel) || {};
        meta.ds = effectiveSig;
        meta.rs = quickPanelStamp(panel);
        panelMeta.set(panel, meta);
      }
    }

    if (hasAttr(panel, 'data-op-zh-pending')) ra(panel, 'data-op-zh-pending');
    if (ga(panel, 'data-op-zh-ready') !== '1') sa(panel, 'data-op-zh-ready', '1');
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
    if (panel && !entry.ps.includes(panel)) entry.ps.push(panel);
    if (panel && expanded) {
      const shown = entry.sh || entry.lp;
      if (shown) {
        renderTranslatedText(panel, shown, true, null, '', { inc: Boolean(entry.sh), anim: false, now: nowMs() });
      } else {
        const t = getClientPack();
        renderPendingState(panel, entry.m === 'machine' ? t[7] : t[8], entry.m === 'machine' ? 'machine' : 'ai');
      }
    }
  }

  function startOrJoinTranslation(panel, rawText, mode, sig, srcSkelHash, expanded, opts = {}) {
    const force = Boolean(opts.force);
    const priority = Number(opts.priority) || 0;

    if (!force) {
      const cached = findCachedTranslation(rawText, mode);
      if (cached) {
        if (panel && expanded) renderTranslatedText(panel, cached, false, sig, mode === 'machine' ? 'machine' : 'ai');
        return;
      }
      if (isSigInCooldown(sig)) {
        if (panel && expanded && ga(panel, 'data-op-zh-failed') !== '1') renderFailedState(panel, rawText, mode, sig);
        return;
      }
      const existing = inflightBySig.get(sig);
      if (existing && !existing.x && Date.now() - existing.at <= 75000) {
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
      id: requestId,
      sk: srcSkelHash,
      sc: panel ? quickStructureSig(panel) : null,
      m: mode,
      at: Date.now(),
      x: false,
      lp: '',
      tg: '',
      sh: '',
      cy: 0,
      pa: 0,
      pRaf: null,
      dn: false,
      fn: null,
      fa: 0,
      pp: '',
      fTm: null,
      fRaf: false,
      ps: panel ? [panel] : [],
    };
    inflightBySig.set(sig, entry);

    if (panel && expanded) {
      const t = getClientPack();
      renderPendingState(panel, mode === 'machine' ? t[7] : t[8], mode === 'machine' ? 'machine' : 'ai');
    }

    const verifyPanel = (p) => {
      if (!p || !p.isConnected) return false;
      const cs = quickStructureSig(p);
      if (entry.sc && cs && (cs.c !== entry.sc.c || cs.f !== entry.sc.f || cs.l !== entry.sc.l)) {
        const curRaw = extractRawEnglishText(p);
        if (curRaw && hashKey(curRaw, 'sig') !== entry.sk) return false;
        entry.sc = cs;
      }
      return true;
    };

    const flushPartialToPanels = (partialStr, streamOpts = null) => {
      const trimmed = String(partialStr || '').trimStart();
      if (!trimmed || trimmed === entry.lp || entry.x) return;
      entry.lp = trimmed;
      entry.fa = nowMs();
      entry.pp = '';
      for (const p of entry.ps) {
        if (verifyPanel(p)) renderTranslatedText(p, trimmed, true, null, '', streamOpts);
      }
    };

    const commitFinalPayloadToPanels = (pl) => {
      if (inflightBySig.get(sig) === entry) inflightBySig.delete(sig);
      if (!pl || currentMode === 'off' || entry.x) return;
      for (const p of entry.ps) {
        if (!p || !p.isConnected) continue;
        const curRaw = extractRawEnglishText(p);
        if (curRaw && hashKey(curRaw, 'sig') !== entry.sk) continue;
        renderTranslatedText(p, pl.z, false, pl.s, pl.e);
      }
      scheduleScan(30);
    };

    const ensurePacerLoop = () => {
      if (entry.pRaf || entry.x || currentMode === 'off') return;
      const raf = getRafFn();
      if (!raf) return;
      const stepPacer = () => {
        entry.pRaf = null;
        if (currentMode === 'off' || entry.x) return;
        const now = nowMs();
        if (isMotionOff()) {
          if (entry.dn && entry.fn) {
            entry.sh = entry.fn.z;
            commitFinalPayloadToPanels(entry.fn);
          } else if (entry.tg) {
            entry.sh = entry.tg;
            flushPartialToPanels(entry.sh, { inc: true, anim: false, now });
          }
          return;
        }

        const target = entry.tg;
        if (!target) return;
        if (!target.startsWith(entry.sh)) {
          let common = 0;
          const lim = Math.min(target.length, entry.sh.length);
          while (common < lim && target.charCodeAt(common) === entry.sh.charCodeAt(common)) common++;
          entry.sh = target.slice(0, common);
        }

        const backlog = target.length - entry.sh.length;
        if (backlog <= 0) {
          if (entry.dn && entry.fn) commitFinalPayloadToPanels(entry.fn);
          return;
        }

        const dt = entry.pa > 0 ? Math.min(64, Math.max(8, now - entry.pa)) : 16.67;
        const basePerFrame = entry.dn
          ? Math.max(3.2, backlog / 6.2)
          : backlog > 48
          ? Math.max(3.0, backlog / 9.5)
          : Math.max(1.25, backlog / 11.5);

        entry.cy += basePerFrame * (dt / 16.67);
        const minChunk = backlog === 1 || entry.dn || now - entry.pa >= 26 ? 1 : 2;
        if (entry.cy < minChunk) {
          entry.pRaf = raf(stepPacer);
          return;
        }

        const nextIdx = advanceSafeChunkEnd(target, entry.sh.length, Math.min(backlog, Math.floor(entry.cy)));
        entry.cy = Math.max(0, entry.cy - (nextIdx - entry.sh.length));
        entry.pa = now;
        entry.sh = target.slice(0, nextIdx);

        flushPartialToPanels(entry.sh, { inc: true, anim: true, now });

        if (entry.sh.length < entry.tg.length) entry.pRaf = raf(stepPacer);
        else if (entry.dn && entry.fn) commitFinalPayloadToPanels(entry.fn);
      };
      entry.pRaf = raf(stepPacer);
    };

    const scheduleAlignedStreamFlush = () => {
      if (entry.fTm || entry.x) return;
      const stepFlush = () => {
        entry.fTm = null;
        entry.fRaf = false;
        if (currentMode === 'off' || entry.x || !entry.pp) return;
        if (entry.fa > 0 && nowMs() - entry.fa < STREAM_FLUSH_MS) {
          scheduleAlignedStreamFlush();
          return;
        }
        flushPartialToPanels(entry.pp);
      };
      const raf = getRafFn();
      if (raf) {
        entry.fRaf = true;
        entry.fTm = raf(stepFlush);
      } else {
        entry.fRaf = false;
        entry.fTm = setTimeout(stepFlush, STREAM_FLUSH_MS);
      }
    };

    const failEntry = () => {
      cancelFlushHandle(entry);
      if (inflightBySig.get(sig) === entry) inflightBySig.delete(sig);
      if (entry.x || currentMode === 'off') return;
      recordSigFailure(sig);
      for (const p of entry.ps) {
        if (p && p.isConnected) renderFailedState(p, rawText, mode, sig);
      }
    };

    br.translateStream({ text: rawText, mode, priority, requestId, force }, (partial) => {
      if (currentMode === 'off' || entry.x || typeof partial !== 'string' || !partial.trim()) return;
      const trimmed = partial.trimStart();
      if (!trimmed) return;
      if (canUseSmoothStream()) {
        entry.tg = trimmed;
        ensurePacerLoop();
        return;
      }
      entry.pp = trimmed;
      const now = nowMs();
      const immediate = !getRafFn() || isMotionOff();
      if (entry.fa === 0 && immediate) flushPartialToPanels(trimmed);
      else if (now - entry.fa >= STREAM_FLUSH_MS && immediate) {
        cancelFlushHandle(entry);
        flushPartialToPanels(trimmed);
      } else scheduleAlignedStreamFlush();
    })
      .then((res) => {
        if (currentMode === 'off' || entry.x || res?.cancelled) {
          cancelFlushHandle(entry);
          if (inflightBySig.get(sig) === entry) inflightBySig.delete(sig);
          for (const p of entry.ps) {
            if (p && p.isConnected && ga(p, 'data-op-zh-ready') !== '1') clearPendingKeepRaw(p);
          }
          return;
        }
        if (res && res.ok && typeof res.text === 'string' && res.text.trim()) {
          const finalZh = res.text.trim();
          const isFb = res.engine === 'machine-fallback' || Boolean(res.fallback);
          const eng = isFb ? 'machine-fallback' : res.engine || (mode === 'machine' ? 'machine' : 'ai');
          failedSigs.delete(sig);
          putMemCache(res.key || hashKey(rawText, isFb || mode === 'machine' ? 'mt' : activeStyleTag || 'ai_technical'), finalZh, true);

          if (
            canUseSmoothStream() &&
            entry.ps.some((p) => p && p.isConnected && isPanelCurrentlyExpanded(p)) &&
            entry.sh.length < finalZh.length &&
            finalZh.startsWith(entry.sh) &&
            (entry.sh.length > 0 || finalZh.length <= 900)
          ) {
            entry.tg = finalZh;
            entry.dn = true;
            entry.fn = { z: finalZh, s: sig, e: eng };
            ensurePacerLoop();
            return;
          }
          cancelFlushHandle(entry);
          commitFinalPayloadToPanels({ z: finalZh, s: sig, e: eng });
        } else {
          failEntry();
        }
      })
      .catch(failEntry);
  }

  function isElementInViewport(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return true;
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const rootEl = docRoot();
      const vh = W.innerHeight || (rootEl && rootEl.clientHeight) || 900;
      const vw = W.innerWidth || (rootEl && rootEl.clientWidth) || 1440;
      return rect.bottom >= -120 && rect.top <= vh + 120 && rect.right >= 0 && rect.left <= vw;
    } catch (_) {
      return true;
    }
  }

  function processSingleTrigger(btn, allowPreloadCollapsed, priority = 0) {
    if (!btn) return;
    const expanded = ga(btn, 'aria-expanded') === 'true';
    if (!expanded && !allowPreloadCollapsed) return;

    const panel = btn.nextElementSibling;
    if (!panel || String(panel.tagName || '').toUpperCase() !== 'DIV') return;

    const streaming = isTriggerStreaming(btn);
    const t = getClientPack();

    if (streaming) {
      const now = Date.now();
      const meta = panelMeta.get(panel) || { h: '', c: now, s: true, m: true, f: 0, ds: '', rs: '' };
      meta.s = true;
      meta.m = true;
      meta.f = 0;
      meta.c = now;
      panelMeta.set(panel, meta);
      clearPanelWaitTimer(panel);
      if (expanded) renderPendingState(panel, t[9], 'streaming');
      return;
    }

    if (expanded && ga(panel, 'data-op-zh-ready') === '1') {
      const em = panelMeta.get(panel);
      if (em && em.rs === quickPanelStamp(panel) && em.ds && em.ds === ga(panel, 'data-op-zh-sig')) return;
    }

    const rawText = extractRawEnglishText(panel);
    if (!rawText || isMostlyZh(rawText)) {
      if (ga(panel, 'data-op-zh-pending') === '1') clearPendingKeepRaw(panel);
      return;
    }

    const srcSkelHash = hashKey(rawText, 'sig');
    const sig = computeSig(rawText, currentMode);

    if (expanded && ga(panel, 'data-op-zh-ready') === '1' && ga(panel, 'data-op-zh-sig') === sig) {
      const meta = panelMeta.get(panel) || {};
      meta.ds = sig;
      meta.rs = quickPanelStamp(panel);
      panelMeta.set(panel, meta);
      return;
    }

    const now = Date.now();
    let meta = panelMeta.get(panel);
    if (!meta) {
      meta = { h: srcSkelHash, c: now, s: false, m: false, f: now - FINISH_GATE_MS, ds: '', rs: '' };
    } else if (meta.h !== srcSkelHash) {
      meta.h = srcSkelHash;
      meta.c = now;
      meta.m = true;
    }

    if (meta.s && !meta.f) {
      meta.s = false;
      meta.f = now;
    } else if (!meta.f) {
      meta.f = now - FINISH_GATE_MS;
    }
    panelMeta.set(panel, meta);

    const cached = findCachedTranslation(rawText, currentMode);
    if (cached) {
      clearPanelWaitTimer(panel);
      if (expanded) renderTranslatedText(panel, cached, false, sig, currentMode === 'machine' ? 'machine' : 'ai');
      else putMemCache(hashKey(rawText, currentMode === 'machine' ? 'mt' : activeStyleTag || 'ai_technical'), cached, false);
      return;
    }

    const activeFlight = inflightBySig.get(sig);
    if (activeFlight && !activeFlight.x && now - activeFlight.at <= 75000) {
      bindPanelToInflight(activeFlight, panel, expanded);
      return;
    }

    if (isSigInCooldown(sig)) {
      if (expanded && ga(panel, 'data-op-zh-failed') !== '1') renderFailedState(panel, rawText, currentMode, sig);
      return;
    }

    const waitMs = meta.m ? Math.max(0, FINISH_GATE_MS - (now - meta.f), QUIET_GATE_MS - (now - meta.c)) : 0;
    if (waitMs > 0) {
      if (expanded) renderPendingState(panel, t[10], 'settling');
      setPanelWaitTimer(
        panel,
        btn,
        () => {
          if (currentMode === 'off' || !btn.isConnected) return;
          const liveExpanded = ga(btn, 'aria-expanded') === 'true';
          let liveAllowPreload = false;
          if (!liveExpanded && triggerTiming === 'preload') {
            const allBtns = qsa(SEL_TRIGGER);
            liveAllowPreload = Boolean(allBtns.length > 0 && allBtns[allBtns.length - 1] === btn);
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
      if (entry.lp || entry.x) continue;
      if (!entry.ps.some((p) => p && p.isConnected && activePanelSet.has(p))) {
        cancelTranslateRequest(entry);
        inflightBySig.delete(sig);
      }
    }
  }

  function scanNow() {
    scanTimer = null;
    if (currentMode === 'off') return;
    const triggers = qsa(SEL_TRIGGER);
    if (!triggers.length) return;

    const lastIdx = triggers.length - 1;
    const candidates = [];
    const activePanelSet = new Set();

    for (let i = 0; i <= lastIdx; i++) {
      const btn = triggers[i];
      if (!btn) continue;
      const isLatest = i === lastIdx;
      const allowPreload = triggerTiming === 'preload' && isLatest;
      const expanded = ga(btn, 'aria-expanded') === 'true';
      if (!allowPreload && !expanded) continue;

      const panel = btn.nextElementSibling;
      if (panel) activePanelSet.add(panel);

      const inViewport = expanded ? isElementInViewport(panel || btn) : false;
      const tier = isLatest && expanded ? 25 : inViewport ? 20 : isLatest ? 12 : 5;
      candidates.push({ b: btn, a: allowPreload, p: tier * 1000 + i });
    }

    if (inflightBySig.size > 0) pruneUnneededPendingRequests(activePanelSet);
    candidates.sort((x, y) => y.p - x.p);
    for (let i = 0; i < candidates.length; i++) {
      processSingleTrigger(candidates[i].b, candidates[i].a, candidates[i].p);
    }
  }

  function scheduleScan(delayMs = 55) {
    if (currentMode === 'off' || scanTimer) return;
    scanTimer = setTimeout(scanNow, delayMs);
  }

  const RESET_SIG_ATTRS = ['data-op-zh-sig', 'data-op-zh-fallback', 'data-op-zh-failed'];

  const api = {
    sync(cfg = {}) {
      const nextMode = cfg.thoughtTranslate === 'machine' || cfg.thoughtTranslate === 'ai' ? cfg.thoughtTranslate : 'off';
      const prevTrigger = triggerTiming;
      triggerTiming = cfg.thoughtTrigger === 'expand' ? 'expand' : 'preload';

      currentLang = resolveActiveLang(cfg.language);
      refreshAllOverlayLocaleStrings();

      const incomingView = cfg.thoughtView || cfg.thoughtViewMode;
      if (incomingView === 'bilingual' || incomingView === 'immersive') {
        hasExplicitHostView = true;
        viewModeLoaded = true;
        const viewChanged = currentViewMode !== incomingView;
        currentViewMode = incomingView;
        persistViewModePreference(currentViewMode);
        syncDocViewAttribute();
        if (viewChanged) {
          qsa(SEL_OVERLAY).forEach((ov) => {
            if (ov.parentElement) {
              ra(ov.parentElement, 'data-op-manual-raw');
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

      if (triggerTiming === 'expand' && prevTrigger !== 'expand') cancelCollapsedInflightRequests();
      else if (triggerTiming === 'expand') clearAllWaitTimers(true);

      const changed = currentMode !== nextMode;
      const hadPrevEngine = currentMode !== 'off';
      currentMode = nextMode;
      ensureInitialized();
      if (changed) {
        if (hadPrevEngine) {
          clearAllWaitTimers(false);
          for (const entry of inflightBySig.values()) cancelTranslateRequest(entry);
          inflightBySig.clear();
        }
        const resetPanelSig = (p) => {
          if (!p) return;
          raList(p, RESET_SIG_ATTRS);
          panelMeta.delete(p);
        };
        qsa(SEL_TRIGGER).forEach((b) => { if (b && b.nextElementSibling) resetPanelSig(b.nextElementSibling); });
        qsa(SEL_OVERLAY).forEach((ov) => { if (ov && ov.parentElement) resetPanelSig(ov.parentElement); });
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
      qsa(SEL_OVERLAY).forEach((ov) => {
        if (ov.parentElement) {
          ra(ov.parentElement, 'data-op-manual-raw');
          applyPanelViewMode(ov.parentElement);
        }
      });
      if (changed && opts.persistDaemon !== false) {
        void callDaemonRpc({ action: 'save-config', viewMode: normalized }).catch(() => {});
      }
      return currentViewMode;
    },
    getLocalCacheStats,
    clearLocalCache,
    getCacheStats() {
      const local = getLocalCacheStats();
      const mk = (localOnly, dEntries, dBytes) => ({
        ok: true,
        localOnly,
        localEntries: local.memEntries,
        storageEntries: local.storageEntries,
        daemonEntries: dEntries,
        diskBytes: dBytes,
        totalEntries: Math.max(local.memEntries, dEntries),
      });
      return callDaemonRpc({ action: 'cache-stats' })
        .then((res) => (res && res.ok && typeof res.entries === 'number' ? mk(false, res.entries, res.diskBytes || 0) : mk(true, 0, 0)))
        .catch(() => mk(true, 0, 0));
    },
    clearCache() {
      const localRes = clearLocalCache();
      const mk = (localOnly, dc) => ({ ok: true, localOnly, localCleared: localRes.cleared, daemonCleared: dc });
      return callDaemonRpc({ action: 'clear-cache' })
        .then((res) => (res && res.ok ? mk(false, typeof res.cleared === 'number' ? res.cleared : 0) : mk(true, 0)))
        .catch(() => mk(true, 0));
    },
    getConfig() {
      const br = getBridge();
      if (!br) return Promise.resolve({ ok: false, offline: true });
      return br.call({ action: 'get-config' }).then((res) => {
        const nextTag = res?.styleTag || (res?.stylePreset ? `ai_${res.stylePreset}` : '');
        if (nextTag) activeStyleTag = nextTag;
        if (!hasExplicitHostView && (res?.viewMode === 'bilingual' || res?.viewMode === 'immersive')) {
          let hasLocalPref = false;
          try { hasLocalPref = Boolean(W.localStorage?.getItem(VIEW_MODE_STORAGE_KEY)); } catch (_) {}
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
        qsa(SEL_TRIGGER).forEach((b) => {
          const p = b && b.nextElementSibling;
          if (p && (tagChanged || ga(p, 'data-op-zh-fallback') === '1' || ga(p, 'data-op-zh-failed') === '1')) {
            raList(p, RESET_SIG_ATTRS);
            panelMeta.delete(p);
          }
        });
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
      if (persistTimer) flushLocalStorageCacheNow();
      releasePrismOverlays();
    },
  };

  W.__agPrismThought = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
