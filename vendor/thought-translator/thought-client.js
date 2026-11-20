// Obsidian Prism — Unified Thought Translator & Polisher Client Runtime (v1.0.2 Upgraded)
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
  const STYLE_TAG_KEY = 'ag_prism_thought_style_tag_v1';
  const MEM_CACHE_LIMIT = 1500;
  const STORAGE_CACHE_LIMIT = 80;
  const MAX_STORAGE_TOTAL_CHARS = 120000;
  const MAX_STORAGE_ENTRY_CHARS = 32000;
  const STREAM_FLUSH_MS = 48;
  const CHUNK_FADE_TTL_MS = 350;
  const MAX_LIVE_CHUNKS = 10;
  const FINISH_GATE_MS = 450;
  const QUIET_GATE_MS = 900;

  const BLOCK_TAGS = new Set('P,DIV,LI,UL,OL,PRE,BLOCKQUOTE,H1,H2,H3,H4,H5,H6,TR,HR,SECTION,ARTICLE'.split(','));
  const SKIP_TAGS = new Set('SCRIPT,STYLE,BUTTON,SVG,NOSCRIPT'.split(','));

  let currentMode = 'off';
  let triggerTiming = 'preload';
  let currentViewMode = 'immersive';
  let currentLang = 'zh-CN';
  let activeStyleTag = '';
  let storedCount = 0;
  let cacheDirty = false;
  let cacheWarmed = false;
  let localCacheLoaded = false;
  let viewModeLoaded = false;
  let hasExplicitHostView = false;
  let scrollBound = false;
  let scrollTimer = null;
  let scanTimer = null;
  let cachedConvRoot = null;
  let reqSeq = 0;

  const SEL_TRIGGER = 'button[data-testid="thinking-collapsible-trigger"]';
  const SEL_OVERLAY = '.ag-prism-thought-overlay[data-op-thought="1"]';
  const A_EXP = 'aria-expanded';
  const A_RDY = 'data-op-zh-ready';
  const A_PND = 'data-op-zh-pending';
  const A_FLD = 'data-op-zh-failed';
  const A_FBK = 'data-op-zh-fallback';
  const A_SIG = 'data-op-zh-sig';
  const A_SRW = 'data-op-show-raw';
  const A_MRW = 'data-op-manual-raw';
  const A_BIL = 'data-op-bilingual';
  const A_PNL = 'data-op-thought-panel';
  const C_OV = 'ag-prism-thought-overlay';
  const C_BD = 'ag-prism-thought-body';
  const C_FB = 'ag-prism-thought-fallback-badge';
  const C_RB = 'ag-prism-thought-retranslate-btn';
  const C_TB = 'ag-prism-thought-raw-toggle';
  const C_EB = 'ag-prism-thought-error-bar';
  const C_ET = 'ag-prism-thought-error-text';
  const C_RT = 'ag-prism-thought-retry-btn';
  const C_PH = 'ag-prism-thought-pending-hint';
  const C_CK = 'ag-prism-thought-chunk';

  const ZH_TW_PACK = '原文|收起原文|機翻降級|AI 未就緒，已降級機翻|重新轉譯|轉譯未完成|↻ 重試|機翻中…|AI 轉譯中…|思考輸出中…|收束中…'.split('|');
  const CLIENT_I18N = {
    'zh-CN': '原文|收起原文|机翻降级|AI 未就绪，已降级机翻|重新转译|转译未完成|↻ 重试|机翻中…|AI 转译中…|思考输出中…|收束中…'.split('|'),
    'zh-TW': ZH_TW_PACK,
    yue: ['原文', '收埋原文', ...ZH_TW_PACK.slice(2)],
    en: 'Raw|Hide Raw|Fallback|AI unavailable; machine fallback|Retranslate|Translation incomplete|↻ Retry|Translating…|AI polishing…|Streaming…|Settling…'.split('|'),
    ja: '原文|原文を隠す|機械翻訳代替|AI未設定・機械翻訳代替|再翻訳|翻訳未完了|↻ 再試行|翻訳中…|AI翻訳中…|出力中…|整理中…'.split('|'),
  };

  const memCache = new Map();
  if (W.__agPrismThought && W.__agPrismThought.__memCache instanceof Map) {
    for (const [k, v] of W.__agPrismThought.__memCache.entries()) memCache.set(k, v);
  }
  try { W.__agPrismThought?.destroy?.(); } catch {}

  const failedSigs = new Map();
  const inflightBySig = new Map();
  const trackedWaitPanels = new Map();
  const panelMeta = new WeakMap();
  const rawCacheMap = new WeakMap();
  const lockedHeights = new WeakMap();
  const panelFileMaps = new WeakMap();
  const panelActiveEntry = new WeakMap();
  const panelStreamStates = new WeakMap();
  const panelSettleTimers = new WeakMap();

  const K_TC = 'textContent';
  const K_NV = 'nodeValue';
  const K_CN = 'childNodes';
  const K_FC = 'firstChild';
  const K_PE = 'parentElement';
  const K_NS = 'nextElementSibling';
  const K_OD = 'ownerDocument';
  const K_IC = 'isConnected';
  const K_ST = 'style';
  const K_CV = 'checkVisibility';
  const low = (s) => String(s || '').toLowerCase();
  const trm = (s) => String(s || '').trim();
  const docRoot = () => (typeof document !== 'undefined' ? document.documentElement : null);
  const tc = (e) => (e ? e[K_TC] : '');
  const stc = (e, v) => { if (e) e[K_TC] = v; };
  const isConn = (e) => Boolean(e && e[K_IC] !== false);
  const docOf = (e) => (e && e[K_OD]) || document;
  const nextSib = (e) => e && e[K_NS];
  const parEl = (e) => e && e[K_PE];
  const ga = (e, k) => (e && e.getAttribute ? e.getAttribute(k) : null);
  const hasAttr = (e, k) => (e ? (typeof e.hasAttribute === 'function' ? e.hasAttribute(k) : ga(e, k) !== null) : false);
  const sa = (e, k, v) => {
    if (e && e.setAttribute) {
      const s = String(v);
      if (ga(e, k) !== s) e.setAttribute(k, s);
    }
  };
  const ra = (e, k) => { if (e && e.removeAttribute && hasAttr(e, k)) e.removeAttribute(k); };
  const raList = (e, ks) => { for (let i = 0; i < ks.length; i++) ra(e, ks[i]); };
  const ce = (d, t, cls) => { const e = d.createElement(t); if (cls) e.className = cls; return e; };
  const ctn = (d, s) => d.createTextNode(s);
  const ap = (p, c) => p.appendChild(c);
  const clearEl = (e) => { while (e && e[K_FC]) e.removeChild(e[K_FC]); };
  const getTnStr = (tn) => (tn ? tn[K_NV] ?? tn[K_TC] ?? '' : '');
  const setTn = (tn, v) => {
    if (!tn) return;
    if (K_NV in tn) tn[K_NV] = v;
    if (K_TC in tn && tn[K_TC] !== v) tn[K_TC] = v;
  };
  const appendTn = (tn, d) => {
    if (!tn || !d) return;
    if (typeof tn.appendData === 'function') tn.appendData(d);
    else setTn(tn, getTnStr(tn) + d);
  };
  const qsa = (s) => (typeof document !== 'undefined' ? document.querySelectorAll(s) : []);
  const onClk = (e, fn) => e.addEventListener('click', fn);
  const stopEv = (ev) => {
    if (ev) {
      if (typeof ev.preventDefault === 'function') ev.preventDefault();
      if (typeof ev.stopPropagation === 'function') ev.stopPropagation();
    }
  };
  const unlockHeight = (p) => {
    if (!p) return;
    lockedHeights.delete(p);
    if (p[K_ST] && p[K_ST].minHeight) p[K_ST].removeProperty('min-height');
  };

  function queryTriggers() {
    if (typeof document === 'undefined') return [];
    if (!isConn(cachedConvRoot)) {
      cachedConvRoot = document.querySelector ? document.querySelector('[data-testid="conversation-view"]') : null;
    }
    const scope = cachedConvRoot && cachedConvRoot.querySelectorAll ? cachedConvRoot : document;
    const list = scope.querySelectorAll(SEL_TRIGGER);
    return list && list.length ? list : scope !== document ? qsa(SEL_TRIGGER) : [];
  }

  const hlItems = [];
  let hlTimer = null;
  let hlBks = null;

  function getCssHlBuckets() {
    if (hlBks) return hlBks;
    const c = W.CSS || (typeof CSS !== 'undefined' ? CSS : null);
    const H = W.Highlight || (typeof Highlight === 'function' ? Highlight : null);
    if (!c?.highlights?.set || typeof H !== 'function' || typeof document === 'undefined' || !document.createRange) return null;
    hlBks = [];
    for (let i = 0; i < 5; i++) {
      const nm = `ag-stream-f${i}`;
      let h = c.highlights.get && c.highlights.get(nm);
      if (!h) c.highlights.set(nm, (h = new H()));
      hlBks.push(h);
    }
    return hlBks;
  }

  function dropHlItem(it, bs) {
    if (bs && it.b >= 0) {
      try { bs[it.b].delete(it.r); } catch (_) {}
    }
    it.b = -1;
  }

  function clearPanelHlItems(panel) {
    if (!hlItems.length) return;
    const bs = getCssHlBuckets();
    for (let i = hlItems.length - 1; i >= 0; i--) {
      if (!panel || hlItems[i].p === panel) {
        dropHlItem(hlItems[i], bs);
        hlItems.splice(i, 1);
      }
    }
    if (!hlItems.length && hlTimer) {
      clearTimeout(hlTimer);
      hlTimer = null;
    }
  }

  function stepHlFade() {
    hlTimer = null;
    const bs = !isMotionOff() && currentMode !== 'off' ? getCssHlBuckets() : null;
    if (!hlItems.length || !bs) return clearPanelHlItems(null);
    const now = nowMs();
    for (let i = hlItems.length - 1; i >= 0; i--) {
      const it = hlItems[i];
      const val = getTnStr(it.tn);
      const age = now - it.at;
      if (!isConn(it.p) || val.length < it.e || age >= 300) {
        dropHlItem(it, bs);
        hlItems.splice(i, 1);
      } else {
        const nb = Math.min(4, 1 + Math.max(0, (age / 75) | 0));
        if (it.b !== nb) {
          dropHlItem(it, bs);
          try { bs[nb].add(it.r); it.b = nb; } catch (_) {}
        }
      }
    }
    if (hlItems.length) (hlTimer = setTimeout(stepHlFade, 64))?.unref?.();
  }

  function pushHlSlice(panel, doc, tn, s, e, now, bs) {
    if (!bs || e <= s || !doc?.createRange) return;
    const last = hlItems[hlItems.length - 1];
    if (last && last.p === panel && last.tn === tn && last.e === s && now - last.at <= 42) {
      try {
        if (last.r.startOffset !== last.s) last.r.setStart(tn, last.s);
        last.r.setEnd(tn, (last.e = e));
        return;
      } catch (_) {}
    }
    while (hlItems.length >= 24) dropHlItem(hlItems.shift(), bs);
    try {
      const r = doc.createRange();
      r.setStart(tn, s);
      r.setEnd(tn, e);
      bs[1].add(r);
      hlItems.push({ p: panel, tn, r, s, e, b: 1, at: now });
      if (!hlTimer) (hlTimer = setTimeout(stepHlFade, 64))?.unref?.();
    } catch (_) {}
  }

  let syncHydrateBudget = 99;
  const hydrateQueue = [];
  let hydrateHandle = null;

  function clearHydrateQueue() {
    if (hydrateHandle) {
      clearTimeout(hydrateHandle);
      hydrateHandle = null;
    }
    hydrateQueue.length = 0;
  }

  const nowMs = () => (W.Date?.now ? W.Date.now() : Date.now());
  const isMotionOff = () => {
    try {
      return ga(docRoot(), 'data-ag-cs-motion') === 'off' || W.__agPrism?.getState?.()?.cfg?.motionLevel === 'off';
    } catch (_) {
      return false;
    }
  };
  const getRafFn = () => (W.requestAnimationFrame ? W.requestAnimationFrame.bind(W) : typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null);
  const getCafFn = () => (W.cancelAnimationFrame ? W.cancelAnimationFrame.bind(W) : typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null);
  const canUseSmoothStream = () => Boolean(getRafFn()) && !isMotionOff();

  function clearPanelStreamState(panel) {
    if (!panel) return;
    const t = panelSettleTimers.get(panel);
    if (t) {
      clearTimeout(t);
      panelSettleTimers.delete(panel);
    }
    panelStreamStates.delete(panel);
    clearPanelHlItems(panel);
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
    if (ga(panel.previousElementSibling, A_EXP) === 'true') return true;
    const triggers = queryTriggers();
    for (let i = 0; i < triggers.length; i++) {
      if (nextSib(triggers[i]) === panel) return ga(triggers[i], A_EXP) === 'true';
    }
    return false;
  }

  function clearAllWaitTimers(onlyCollapsed = false) {
    for (const [panel, rec] of trackedWaitPanels.entries()) {
      const expanded = ga(rec.b, A_EXP) === 'true' || isPanelCurrentlyExpanded(panel);
      if (onlyCollapsed && expanded) continue;
      clearTimeout(rec.t);
      trackedWaitPanels.delete(panel);
      if (!expanded) clearPendingKeepRaw(panel);
    }
  }

  function cancelCollapsedInflightRequests() {
    clearAllWaitTimers(true);
    for (const [sig, entry] of inflightBySig.entries()) {
      const kept = [];
      for (let i = 0; i < entry.ps.length; i++) {
        const p = entry.ps[i];
        if (isConn(p) && isPanelCurrentlyExpanded(p)) kept.push(p);
        else if (p) clearPendingKeepRaw(p);
      }
      entry.ps = kept;
      if (!kept.length) {
        cancelTranslateRequest(entry);
        inflightBySig.delete(sig);
      }
    }
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

  function computeSkelBody(norm) {
    if (!norm) return '';
    const skel = canonicalizeSkeleton(norm) || norm;
    let h = 2166136261;
    for (let i = 0; i < skel.length; i++) {
      h ^= skel.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `_v3_${(h >>> 0).toString(36)}_${skel.length}`;
  }

  function isMostlyZhNorm(norm) {
    if (!norm || norm.length < 10 || norm.length > 48000) return true;
    const prose = norm
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`\n]+`/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[A-Za-z]:[\\/][^\s"'<>|]+/g, ' ')
      .replace(/(?:\/[A-Za-z0-9._-]+){2,}/g, ' ');
    const cjk = (prose.match(/[\u4e00-\u9fa5]/g) || []).length;
    const latin = (prose.match(/[A-Za-z]/g) || []).length;
    return (cjk >= 24 && cjk / Math.max(1, cjk + latin) >= 0.18) || latin < 12 || cjk / Math.max(1, cjk + latin) >= 0.28;
  }

  const getStore = () => W.localStorage || null;

  function setActiveStyleTag(nextTag) {
    if (!nextTag || nextTag === activeStyleTag) return false;
    activeStyleTag = nextTag;
    try { getStore()?.setItem(STYLE_TAG_KEY, nextTag); } catch (_) {}
    return true;
  }

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
    const store = getStore();
    if (!store) return;
    try {
      if (!activeStyleTag) {
        const st = store.getItem(STYLE_TAG_KEY);
        if (st) activeStyleTag = st;
      }
      const raw = store.getItem(LOCAL_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        let cnt = 0;
        for (const [k, v] of Object.entries(parsed)) {
          if (k && typeof v === 'string' && v.trim()) {
            if (!memCache.has(k)) memCache.set(k, v);
            cnt++;
          }
        }
        storedCount = cnt;
      }
    } catch (_) {}
  }

  let persistTimer = null;
  let persistIdle = null;

  function cancelPersistHandles() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (persistIdle) {
      try { W.cancelIdleCallback?.(persistIdle); } catch (_) {}
      persistIdle = null;
    }
  }

  function flushLocalStorageCacheNow() {
    cancelPersistHandles();
    cacheDirty = false;
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
        storedCount = list.length;
      };
      try {
        writePicked(picked);
      } catch (_) {
        if (picked.length > 4) try { writePicked(picked.slice(0, picked.length >> 1)); } catch (_) {}
      }
    } catch (_) {}
  }

  function persistLocalStorageCache() {
    cacheDirty = true;
    if (persistTimer || persistIdle) return;
    const sched = (ms) => {
      persistTimer = setTimeout(() => {
        persistTimer = null;
        if (inflightBySig.size > 0) return sched(2000);
        if (W.requestIdleCallback) {
          persistIdle = W.requestIdleCallback(() => { persistIdle = null; flushLocalStorageCacheNow(); }, { timeout: 1500 });
        } else flushLocalStorageCacheNow();
      }, ms);
      persistTimer?.unref?.();
    };
    sched(3500);
  }

  function putMemCache(key, val, persist = true) {
    const trimmed = typeof val === 'string' ? val.trim() : '';
    if (!key || !trimmed) return false;
    const existed = memCache.get(key) === trimmed;
    if (memCache.has(key)) memCache.delete(key);
    while (memCache.size >= MEM_CACHE_LIMIT) {
      const oldest = memCache.keys().next().value;
      if (oldest === undefined) break;
      memCache.delete(oldest);
    }
    memCache.set(key, trimmed);
    if (!existed && persist) persistLocalStorageCache();
    return !existed;
  }

  function getLocalCacheStats() {
    loadLocalStorageCache();
    return { ok: true, memEntries: memCache.size, storageEntries: storedCount };
  }

  function clearLocalCache() {
    cancelPersistHandles();
    cacheDirty = false;
    storedCount = 0;
    const cleared = memCache.size;
    memCache.clear();
    failedSigs.clear();
    try { getStore()?.removeItem?.(LOCAL_CACHE_KEY); } catch (_) {}
    return { ok: true, cleared, memEntries: 0, storageEntries: 0 };
  }

  function isSigInCooldown(sig) {
    const rec = failedSigs.get(sig);
    if (!rec) return false;
    if (nowMs() >= rec.u) {
      failedSigs.delete(sig);
      return false;
    }
    return true;
  }

  function recordSigFailure(sig) {
    if (!sig) return;
    const prev = failedSigs.get(sig);
    const c = prev ? prev.c + 1 : 1;
    failedSigs.delete(sig);
    failedSigs.set(sig, { c, u: nowMs() + (c === 1 ? 15000 : c === 2 ? 45000 : 120000) });
    if (failedSigs.size > 512) {
      const oldest = failedSigs.keys().next().value;
      if (oldest !== undefined) failedSigs.delete(oldest);
    }
  }

  const getBridge = () => W.__agPrismThoughtBridge || null;
  const offRes = () => Promise.resolve({ ok: false, offline: true });

  function callDaemonRpc(p) {
    try {
      const br = getBridge();
      const a = p && p.action;
      const fn = br && (a === 'cache-stats' ? br.cacheStats : a === 'clear-cache' ? br.clearCache : a === 'cancel-translate' ? br.cancelTranslate : br.call);
      if (typeof fn === 'function') return Promise.resolve().then(() => fn.call(br, p));
      const ret = W.__agPrismThoughtCall?.(p);
      if (ret && typeof ret.then === 'function') return ret;
    } catch (_) {}
    return offRes();
  }

  function syncDocViewAttribute() {
    sa(docRoot(), 'data-ag-prism-thought-view', currentViewMode);
  }

  let hasOffscreenLazyPanels = false;
  const onScrollCapture = () => {
    if (currentMode === 'off' || scrollTimer || !hasOffscreenLazyPanels) return;
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      if (currentMode !== 'off' && hasOffscreenLazyPanels) scheduleScan(20);
    }, 100);
    scrollTimer?.unref?.();
  };

  function syncRemoteCfgMeta(res) {
    const nextTag = res?.styleTag || (res?.stylePreset ? `ai_${res.stylePreset}` : '');
    const tagChanged = setActiveStyleTag(nextTag);
    if (!hasExplicitHostView && (res?.viewMode === 'bilingual' || res?.viewMode === 'immersive')) {
      let hasLocalPref = false;
      try { hasLocalPref = Boolean(getStore()?.getItem(VIEW_MODE_STORAGE_KEY)); } catch (_) {}
      if (!hasLocalPref && res.viewMode !== currentViewMode) {
        currentViewMode = res.viewMode;
        syncDocViewAttribute();
        refreshAllPanelViewModes(false);
      }
    }
    return tagChanged;
  }

  function ensureInitialized() {
    loadLocalStorageCache();
    loadViewModePreference();
    const rootEl = docRoot();
    if (rootEl && ga(rootEl, 'data-ag-prism-thought-owner') !== OWNER_ID) {
      sa(rootEl, 'data-ag-prism-thought-owner', OWNER_ID);
    }
    syncDocViewAttribute();
    if (!scrollBound && typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('scroll', onScrollCapture, { capture: true, passive: true });
      scrollBound = true;
    }

    if (cacheWarmed) return;
    cacheWarmed = true;
    const br = getBridge();
    if (br && typeof br.call === 'function') {
      br.call({ action: 'get-cache', limit: 40, maxChars: 80000 })
        .then((res) => {
          const tagChanged = syncRemoteCfgMeta(res);
          if (tagChanged) {
            qsa(SEL_TRIGGER).forEach((b) => {
              const p = nextSib(b);
              if (p) panelMeta.delete(p);
            });
          }
          if (res && res.entries && typeof res.entries === 'object') {
            let added = 0;
            for (const [k, v] of Object.entries(res.entries)) {
              if (putMemCache(k, v, false)) added++;
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
    if (entry.pRaf) {
      getCafFn()?.(entry.pRaf);
      entry.pRaf = null;
    }
    if (entry.pTm) {
      clearTimeout(entry.pTm);
      entry.pTm = null;
    }
    if (entry.fTm) {
      clearTimeout(entry.fTm);
      entry.fTm = null;
    }
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
    const isFailed = ga(panel, A_FLD) === '1';
    const manualRaw = ga(panel, A_MRW);
    const shouldShowRaw = isFailed || (manualRaw === '1' ? true : manualRaw === '0' ? false : currentViewMode === 'bilingual');

    if (shouldShowRaw) sa(panel, A_SRW, '1');
    else ra(panel, A_SRW);

    if (currentViewMode === 'bilingual' && shouldShowRaw && !isFailed) sa(panel, A_BIL, '1');
    else ra(panel, A_BIL);

    if (ov) {
      const toggleBtn = findChildByClass(ov, C_TB);
      if (toggleBtn) {
        sa(toggleBtn, 'aria-pressed', String(shouldShowRaw));
        const t = getClientPack();
        stc(toggleBtn, shouldShowRaw ? t[1] : t[0]);
      }
    }
  }

  const KIND_IDX = { machine: 7, ai: 8, streaming: 9, settling: 10 };

  function refreshAllOverlayLocaleStrings() {
    const t = getClientPack();
    qsa(SEL_OVERLAY).forEach((ov) => {
      const panel = parEl(ov);
      const fb = findChildByClass(ov, C_FB);
      if (fb) {
        stc(fb, t[2]);
        fb.title = t[3];
      }
      const rb = findChildByClass(ov, C_RB);
      if (rb) {
        rb.title = t[4];
        sa(rb, 'aria-label', t[4]);
      }
      const tb = findChildByClass(ov, C_TB);
      if (tb) stc(tb, ga(panel, A_SRW) === '1' ? t[1] : t[0]);
      const body = findChildByClass(ov, C_BD);
      if (body) {
        const errBar = findChildByClass(body, C_EB);
        if (errBar) {
          stc(findChildByClass(errBar, C_ET), t[5]);
          stc(findChildByClass(errBar, C_RT), t[6]);
        }
        const ph = findChildByClass(body, C_PH);
        const ki = ph && KIND_IDX[ga(ph, 'data-pending-kind')];
        if (ki) stc(ph, t[ki]);
      }
    });
  }

  function refreshAllPanelViewModes(resetManual = false) {
    qsa(SEL_OVERLAY).forEach((ov) => {
      const p = parEl(ov);
      if (p) {
        if (resetManual) ra(p, A_MRW);
        applyPanelViewMode(p);
      }
    });
  }

  const PANEL_CLEAN_ATTRS = [A_RDY, A_PND, A_FLD, A_FBK, A_SIG, A_SRW, A_MRW, A_BIL, A_PNL];

  function cleanSinglePanelAttributes(panel) {
    if (!panel) return;
    claimPanelEntry(panel, null);
    clearPanelStreamState(panel);
    unlockHeight(panel);
    clearPanelWaitTimer(panel);
    panelMeta.delete(panel);
    rawCacheMap.delete(panel);
    findDirectOverlay(panel)?.remove();
    raList(panel, PANEL_CLEAN_ATTRS);
  }

  function releasePrismOverlays() {
    if (scrollTimer) {
      clearTimeout(scrollTimer);
      scrollTimer = null;
    }
    if (scrollBound && typeof document !== 'undefined' && document.removeEventListener) {
      document.removeEventListener('scroll', onScrollCapture, { capture: true });
      scrollBound = false;
    }
    clearHydrateQueue();
    clearPanelHlItems(null);
    clearAllWaitTimers(false);
    for (const entry of inflightBySig.values()) cancelTranslateRequest(entry);
    inflightBySig.clear();
    qsa(SEL_OVERLAY).forEach((ov) => {
      const panel = parEl(ov);
      ov.remove();
      if (panel) cleanSinglePanelAttributes(panel);
    });
    qsa(SEL_TRIGGER).forEach((btn) => cleanSinglePanelAttributes(nextSib(btn)));
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
    const txt = (tc(btn) || '').trim();
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
    const trimmed = trm(rawHref).replace(/^<|>$/g, '');
    if (!trimmed || /[\u0000-\u001f\u007f"'<>`]/.test(trimmed) || !/^file:\/\//i.test(trimmed)) return '';
    try {
      if (typeof URL === 'function') {
        const parsed = new URL(trimmed);
        return parsed.protocol === 'file:' ? parsed.href : '';
      }
    } catch {
      return '';
    }
    return /^file:\/\/[^\s"'<>`]+$/i.test(trimmed) ? trimmed : '';
  }

  function filePathToSafeHref(rawPath) {
    const p = trm(rawPath);
    if (!p || /[\u0000-\u001f\u007f"'<>`]/.test(p)) return '';
    if (/^file:\/\//i.test(p)) return sanitizeFileHref(p);
    if (/^[A-Za-z]:[\\/]/.test(p)) return sanitizeFileHref('file:///' + p.replace(/\\/g, '/'));
    return p.startsWith('/') ? sanitizeFileHref('file://' + p) : '';
  }

  function normalizeFileHrefForMatch(href) {
    const safe = sanitizeFileHref(href);
    if (!safe) return '';
    let s = safe;
    try { s = decodeURIComponent(safe); } catch (_) {}
    return low(s.replace(/\\/g, '/'));
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
    return { l: [], n: new Map(), t: new Map(), b: new Map() };
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

    const label = String(tc(node) || '').trim().replace(/^`+|`+$/g, '').trim();
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
      rec = { e: node, u: '', r: omniRel, br: baseRel, bh: '', h: hsh, dp: `/${baseRel.toLowerCase()}` };
    } else {
      const nh = normalizeFileHrefForMatch(safeHref);
      const pts = parseFileHrefParts(safeHref);
      bname = pts.bn;
      pbase = pts.pb;
      hsh = pts.h;
      rec = { e: node, u: safeHref, r: '', br: '', bh: pts.bh, h: hsh, dp: pts.dp.toLowerCase() };
      if (!fm.n.has(nh)) fm.n.set(nh, rec);
    }

    fm.l.push(rec);
    const addMap = (mp, k) => {
      const key = String(k || '').trim().replace(/\\/g, '/').toLowerCase();
      if (key && !mp.has(key)) mp.set(key, rec);
    };
    if (label && (/[./\\]/.test(label) || /#L\d+/i.test(label))) {
      addMap(fm.t, label);
      if (!/#L\d+|:\d+/i.test(label)) addMap(fm.b, label);
    }
    if (bname && bname.includes('.')) {
      if (hsh) {
        addMap(fm.t, `${bname}${hsh}`);
        if (pbase !== bname) addMap(fm.t, `${pbase}${hsh}`);
      }
      addMap(fm.b, bname);
      if (pbase !== bname) addMap(fm.b, pbase);
      if (extraBase) addMap(fm.b, extraBase);
    }
  }

  function collectCleanText(node, chunks, fm) {
    if (!node) return;
    const nt = node.nodeType;
    if (nt === 3) {
      if (node[K_NV] !== undefined && node[K_NV] !== null) chunks.push(node[K_NV]);
      else if (tc(node)) chunks.push(tc(node));
      return;
    }
    if (nt !== 1 || isOverlayOrIgnoredElement(node)) return;
    const tag = node.tagName ? String(node.tagName).toUpperCase() : '';
    if (SKIP_TAGS.has(tag)) return;
    if (tag === 'BR') {
      chunks.push('\n');
      return;
    }
    if (fm) registerFileNodeInMap(node, fm);
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) chunks.push('\n');
    const chs = node[K_CN];
    if (chs && chs.length) {
      for (let i = 0; i < chs.length; i++) collectCleanText(chs[i], chunks, fm);
    } else if (typeof tc(node) === 'string' && (!node.children || !node.children.length)) {
      chunks.push(tc(node));
    }
    if (isBlock) chunks.push('\n');
  }

  function extractPanelInfo(panel) {
    const chs = panel && panel[K_CN];
    if (!chs) return { s: '', t: '', k: '', z: true };
    const stp = quickPanelStamp(panel);
    const hit = rawCacheMap.get(panel);
    if (hit && hit.s === stp && panelFileMaps.has(panel)) return hit;
    const chunks = [];
    const fm = createEmptyFileMap();
    for (let i = 0; i < chs.length; i++) collectCleanText(chs[i], chunks, fm);
    panelFileMaps.set(panel, fm);
    const rt = normalizeTextKey(chunks.join(''));
    const rec = { s: stp, t: rt, k: computeSkelBody(rt), z: isMostlyZhNorm(rt) };
    rawCacheMap.set(panel, rec);
    return rec;
  }

  const extractRawEnglishText = (panel) => extractPanelInfo(panel).t;

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
      const hit = fm ? fm.n.get(normalizeFileHrefForMatch(safe)) : null;
      return { u: safe, e: hit ? hit.e : null };
    }

    if (!fm || !fm.l.length) return null;

    const normToken = cleaned.replace(/\\/g, '/').replace(/^\.\//, '');
    const exactHit = fm.t.get(normToken.toLowerCase());
    if (exactHit) return { u: exactHit.u, r: exactHit.r, e: exactHit.e };

    const lineSplit = /^(.+?)(#L\d+(?:-L?\d+)?|:\d+(?:-\d+)?(?::\d+)?)$/i.exec(normToken);
    const basePart = (lineSplit ? lineSplit[1] : normToken).toLowerCase();
    const normHash = lineSplit ? normalizeLineHashSuffix(lineSplit[2]) : '';

    if (normHash) {
      const withHashHit = fm.t.get(`${basePart}${normHash.toLowerCase()}`);
      if (withHashHit) return { u: withHashHit.u, r: withHashHit.r, e: withHashHit.e };
    }

    let baseRec = fm.b.get(basePart) || null;
    if (!baseRec && basePart.includes('/')) {
      const suffix = `/${basePart}`;
      for (let i = 0; i < fm.l.length; i++) {
        if (fm.l[i].dp.endsWith(suffix)) {
          baseRec = fm.l[i];
          break;
        }
      }
    }
    if (!baseRec) return null;

    const sameHash = !normHash || baseRec.h.toLowerCase() === normHash.toLowerCase();
    if (baseRec.r && !baseRec.u) {
      return { u: '', r: normHash ? `${baseRec.br}${normHash}` : baseRec.r, e: sameHash ? baseRec.e : null };
    }

    if (normHash) {
      const composedHref = sanitizeFileHref(`${baseRec.bh}${normHash}`);
      if (!composedHref) return null;
      const exactAnchor = fm.n.get(normalizeFileHrefForMatch(composedHref));
      return { u: composedHref, r: '', e: exactAnchor ? exactAnchor.e : !baseRec.h || sameHash ? baseRec.e : null };
    }

    return { u: baseRec.u, r: '', e: baseRec.e };
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
    const chs = node.children || node[K_CN];
    if (chs && chs.length) {
      for (let i = 0; i < chs.length && !out.e; i++) findLiveAnchorInTree(chs[i], targetNormHref, targetBaseHref, out);
    }
  }

  function resolveLiveNativeAnchor(panel, safeHref, cachedEl) {
    if (isConn(cachedEl) && typeof cachedEl.click === 'function') return cachedEl;
    const cns = panel && panel[K_CN];
    if (!cns) return null;
    const tNorm = normalizeFileHrefForMatch(safeHref);
    const tBase = parseFileHrefParts(safeHref).bh.toLowerCase();
    const out = { e: null, b: null };
    for (let i = 0; i < cns.length && !out.e; i++) findLiveAnchorInTree(cns[i], tNorm, tBase, out);
    return out.e || out.b || null;
  }

  function openInOmniFallback(rawPathOrUri, safeHref, ev) {
    const omni = W.__agPrismOmni;
    if (!omni || typeof omni.openFile !== 'function') return false;
    let filePath = String(rawPathOrUri || safeHref || '').trim();
    if (!filePath) return false;
    let hSrc = filePath;
    if (safeHref) {
      const parts = parseFileHrefParts(safeHref);
      hSrc = parts.h || '';
      filePath = (parts.dp || safeHref).replace(/^\/([A-Za-z]:\/)/, '$1');
    }
    const hm = /#L(\d+)(?:-L?(\d+))?$/i.exec(hSrc);
    const lineStart = hm ? parseInt(hm[1], 10) : null;
    const lineEnd = hm && hm[2] ? parseInt(hm[2], 10) : lineStart;
    if (!safeHref && hm) filePath = filePath.slice(0, hm.index);
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
    stc(pill, labelText);
    onClk(pill, (ev) => {
      if (ev && typeof ev.button === 'number' && ev.button !== 0) return;
      const targetAnchor = safeHref
        ? resolveLiveNativeAnchor(panel, safeHref, nativeEl)
        : isConn(nativeEl) && typeof nativeEl.click === 'function'
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
      if (hit && (hit.u || hit.r)) {
        if (m.index > last) ap(parent, ctn(doc, plainSlice.slice(last, m.index)));
        let displayLabel = rawTok;
        if (/^file:\/\//i.test(rawTok) && hit.u) {
          const parts = parseFileHrefParts(hit.u);
          displayLabel = parts.bn ? `${parts.bn}${parts.h}` : rawTok;
        }
        ap(parent, createFilePill(doc, displayLabel, hit.u, hit.e, panel, hit.r));
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
          ap(parent, createFilePill(doc, cleanLabel, safeHref, hit ? hit.e : null, panel));
        } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawUrl)) {
          const mapped = lookupFileTarget(fm, rawUrl) || lookupFileTarget(fm, cleanLabel);
          if (mapped && (mapped.u || mapped.r)) {
            ap(parent, createFilePill(doc, cleanLabel, mapped.u, mapped.e, panel, mapped.r));
          } else {
            ap(parent, ctn(doc, cleanLabel));
          }
        } else {
          ap(parent, ctn(doc, cleanLabel));
        }
      } else if (m[4] !== undefined) {
        const codeInner = m[4];
        const hit = lookupFileTarget(fm, codeInner);
        if (hit && (hit.u || hit.r)) {
          ap(parent, createFilePill(doc, codeInner.trim(), hit.u, hit.e, panel, hit.r));
        } else {
          const code = ce(doc, 'code', 'ag-prism-thought-code');
          stc(code, codeInner);
          ap(parent, code);
        }
      } else if (m[5] !== undefined) {
        const strong = ce(doc, 'strong');
        if (depth < 2) appendInlineFormatted(strong, m[5], doc, fm, panel, depth + 1);
        else stc(strong, m[5]);
        ap(parent, strong);
      }
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < lineText.length) appendPlainTextWithFileRefs(parent, lineText.slice(lastIdx), doc, fm, panel);
  }

  function quickStructureSig(panel) {
    const nodes = panel && panel[K_CN];
    if (!nodes) return null;
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

  const leafStr = (n) => {
    if (!n) return '';
    if (n.nodeType === 3) return n[K_NV] || '';
    const cns = n[K_CN];
    return cns && cns.length === 1 && cns[0].nodeType === 3 ? cns[0][K_NV] || '' : tc(n) || '';
  };

  function quickPanelStamp(panel) {
    const st = quickStructureSig(panel);
    if (!st || !st.c) return '';
    const fs = leafStr(st.f);
    const ls = st.l === st.f ? fs : leafStr(st.l);
    const ll = ls.length;
    return `${st.c}:${fs.length}:${ll}:${ll ? ls.charCodeAt(ll - 1) | 0 : 0}`;
  }

  function splitMarkdownBlocks(markdownText, isStreaming = false, metaOut = null) {
    const src = String(markdownText || '');
    const lines = src.split('\n');
    const lastLineIdx = lines.length - 1;
    const blocks = [];
    let inFence = false;
    let fenceLines = [];
    let cursor = 0;
    let safeEnd = 0;
    let safeCount = 0;
    for (let i = 0; i <= lastLineIdx; i++) {
      const origLine = lines[i];
      const nextCursor = cursor + origLine.length + (i < lastLineIdx ? 1 : 0);
      const rawLine = origLine.endsWith('\r') ? origLine.slice(0, -1) : origLine;
      const trimmed = rawLine.trim();
      const isTailLine = isStreaming && i === lastLineIdx;
      let commitSafe = false;
      if (!inFence && trimmed.startsWith('```')) {
        inFence = true;
        fenceLines = [];
      } else if (inFence && /^`{3,}\s*$/.test(trimmed)) {
        blocks.push({ k: 'pre', x: fenceLines.join('\n') });
        inFence = false;
        fenceLines = [];
        commitSafe = true;
      } else if (inFence) {
        if (!isTailLine || !/^`{1,2}$/.test(trimmed)) fenceLines.push(rawLine);
      } else if (!trimmed) {
        commitSafe = true;
      } else if (!(isTailLine && (/^`{1,2}$/.test(trimmed) || /^[-*•]$/.test(trimmed) || /^\d{1,3}[.)]?$/.test(trimmed) || /^#{1,4}$/.test(trimmed)))) {
        const ulMatch = /^[-*•]\s+(.+)$/.exec(trimmed);
        const olMatch = !ulMatch && /^\d+[.)]\s+(.+)$/.exec(trimmed);
        blocks.push(ulMatch ? { k: 'ul', x: ulMatch[1] } : olMatch ? { k: 'ol', x: olMatch[1] } : { k: 'p', x: trimmed.replace(/^#{1,4}\s+/, '') });
        commitSafe = true;
      }
      if (commitSafe && !isTailLine) {
        safeEnd = nextCursor;
        safeCount = blocks.length;
      }
      cursor = nextCursor;
    }
    if (inFence && fenceLines.length) blocks.push({ k: 'pre', x: fenceLines.join('\n') });
    if (metaOut) {
      metaOut.se = safeEnd;
      metaOut.sc = safeCount;
    }
    return blocks;
  }

  function advanceSafeChunkEnd(str, fromIdx, rawTake) {
    const len = str.length;
    let end = Math.min(len, fromIdx + Math.max(1, rawTake));
    if (end >= len) return len;
    const prevCode = str.charCodeAt(end - 1);
    if (prevCode >= 0xd800 && prevCode <= 0xdbff && end < len) end++;
    const curCh = str.charCodeAt(end - 1);
    const isAsciiWord = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95;
    if (isAsciiWord(curCh)) {
      let look = end;
      while (look < len && look - end < 18 && isAsciiWord(str.charCodeAt(look))) look++;
      if (look >= len || !isAsciiWord(str.charCodeAt(look))) end = look;
    }
    if (end < len && /[,.;:!?，。、；：！？）》」\]`]/.test(str[end])) end++;
    return end;
  }

  function compactLiveChunks(st, now, flushAll) {
    if (!st || !st.cks.length) return;
    while (st.cks.length > 0 && (flushAll || now - st.cks[0].at >= CHUNK_FADE_TTL_MS || st.cks.length >= MAX_LIVE_CHUNKS)) {
      const old = st.cks.shift();
      if (old.tn) appendTn(old.tn, old.tx);
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

  const INLINE_MD_HINT_RE = /[`*\[]|file:\/\/|[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8}/;

  function upgradeBlockInlineInPlace(el, blk, doc, panel) {
    if (!el || !blk || blk.k === 'pre') return;
    if (!INLINE_MD_HINT_RE.test(blk.x)) return;
    clearEl(el);
    appendInlineFormatted(el, blk.x, doc, ensurePanelFileMap(panel), panel, 0);
  }

  function renderIncrementalStreamDom(panel, body, visibleText, now, animateChunks) {
    const doc = docOf(panel);
    const hlBks = animateChunks ? getCssHlBuckets() : null;
    sa(body, 'data-streaming-live', '1');
    ra(body, 'data-raw-zh');

    let st = panelStreamStates.get(panel);
    const splitMeta = { se: 0, sc: 0, cr: false };
    let baseCount = 0;
    let baseEnd = 0;
    let tailBlocks = null;
    const canFastTail = Boolean(
      st &&
        st.bd === body &&
        st.lEnd > 0 &&
        st.lCnt > 0 &&
        st.lCnt < st.bs.length &&
        typeof st.lSrc === 'string' &&
        visibleText.length >= st.lEnd &&
        visibleText.startsWith(st.lSrc)
    );
    if (canFastTail) {
      baseCount = st.lCnt;
      baseEnd = st.lEnd;
      tailBlocks = splitMarkdownBlocks(visibleText.slice(baseEnd), true, splitMeta);
    } else {
      tailBlocks = splitMarkdownBlocks(visibleText, true, splitMeta);
    }
    const totalLen = baseCount + tailBlocks.length;
    if (!totalLen) return;
    const blockAt = (idx) => (idx < baseCount ? st.bs[idx] : tailBlocks[idx - baseCount]);

    let diverged = !st || st.bd !== body || totalLen < st.bs.length;
    if (!diverged) {
      const checkLen = Math.min(st.bs.length - 1, totalLen - 1);
      for (let i = baseCount; i < checkLen; i++) {
        const blk = blockAt(i);
        if (st.bs[i].k !== blk.k || st.bs[i].x !== blk.x) {
          diverged = true;
          break;
        }
      }
    }

    if (diverged) {
      if (canFastTail) {
        baseCount = 0;
        baseEnd = 0;
        tailBlocks = splitMarkdownBlocks(visibleText, true, splitMeta);
        if (!tailBlocks.length) return;
      }
      clearPanelHlItems(panel);
      clearEl(body);
      st = { bd: body, bs: [], el: null, tn: null, raw: '', tp: '', le: null, lt: '', cks: [], lEnd: 0, lCnt: 0, lSrc: '' };
      panelStreamStates.set(panel, st);
    }

    const lastIdx = baseCount + tailBlocks.length - 1;

    if (st.bs.length > 0 && st.bs.length - 1 < lastIdx) {
      const prevIdx = st.bs.length - 1;
      const targetPrev = blockAt(prevIdx);
      if (st.el && st.tn) {
        const needsFmt = targetPrev.k !== 'pre' && INLINE_MD_HINT_RE.test(targetPrev.x);
        if (needsFmt) {
          const prevTn = st.tn;
          st.cks = st.cks.filter((c) => (c.tn === prevTn ? (c.sp.remove(), false) : true));
          clearPanelHlItems(panel);
          upgradeBlockInlineInPlace(st.el, targetPrev, doc, panel);
        } else if (targetPrev.x.startsWith(st.raw) && targetPrev.x.length > st.raw.length) {
          const tail = targetPrev.x.slice(st.raw.length);
          if (animateChunks && targetPrev.k !== 'pre' && !hlBks) {
            compactLiveChunks(st, now, false);
            const sp = ce(doc, 'span', C_CK);
            stc(sp, tail);
            ap(st.el, sp);
            st.cks.push({ sp, tn: st.tn, tx: tail, at: now });
          } else {
            compactLiveChunks(st, now, true);
            const prevLen = getTnStr(st.tn).length;
            appendTn(st.tn, tail);
            if (hlBks && targetPrev.k !== 'pre') pushHlSlice(panel, doc, st.tn, prevLen, prevLen + tail.length, now, hlBks);
          }
        } else if (targetPrev.x !== st.raw) {
          clearPanelHlItems(panel);
          compactLiveChunks(st, now, true);
          setTn(st.tn, targetPrev.x);
        }
        st.bs[prevIdx] = { k: targetPrev.k, x: targetPrev.x, el: st.el };
      }
      st.el = null;
      st.tn = null;
      st.raw = '';
      st.tp = '';
    }

    while (st.bs.length < lastIdx) {
      const blk = blockAt(st.bs.length);
      const el = mountStreamBlockContainer(st, blk.k, doc, body);
      if (blk.k === 'pre') stc(el, blk.x);
      else appendInlineFormatted(el, blk.x, doc, ensurePanelFileMap(panel), panel, 0);
      st.bs.push({ k: blk.k, x: blk.x, el });
    }

    const curBlk = blockAt(lastIdx);
    if (!st.el || st.tp !== curBlk.k) {
      if (st.el && st.bs.length > lastIdx) {
        const staleTn = st.tn;
        st.cks = st.cks.filter((c) => (c.tn === staleTn ? (c.sp.remove(), false) : true));
        clearPanelHlItems(panel);
        st.el.remove();
      }
      const el = mountStreamBlockContainer(st, curBlk.k, doc, body);
      const tn = ap(el, ctn(doc, ''));
      st.el = el;
      st.tn = tn;
      st.raw = '';
      st.tp = curBlk.k;
      st.bs[lastIdx] = { k: curBlk.k, x: '', el };
    }

    if (!animateChunks || curBlk.k === 'pre' || hlBks) compactLiveChunks(st, now, true);
    if (curBlk.x === st.raw) {
      if (!hlBks) compactLiveChunks(st, now, false);
    } else if (curBlk.x.startsWith(st.raw)) {
      const delta = curBlk.x.slice(st.raw.length);
      if (!animateChunks || curBlk.k === 'pre' || hlBks) {
        const prevLen = getTnStr(st.tn).length;
        appendTn(st.tn, delta);
        if (hlBks && curBlk.k !== 'pre') pushHlSlice(panel, doc, st.tn, prevLen, prevLen + delta.length, now, hlBks);
      } else {
        compactLiveChunks(st, now, false);
        const sp = ce(doc, 'span', C_CK);
        stc(sp, delta);
        ap(st.el, sp);
        st.cks.push({ sp, tn: st.tn, tx: delta, at: now });
      }
      st.raw = curBlk.x;
      st.bs[lastIdx].x = curBlk.x;
      st.bs[lastIdx].el = st.el;
    } else {
      clearPanelHlItems(panel);
      const activeTn = st.tn;
      st.cks = st.cks.filter((c) => (c.tn === activeTn ? (c.sp.remove(), false) : true));
      setTn(activeTn, curBlk.x);
      st.raw = curBlk.x;
      st.bs[lastIdx].x = curBlk.x;
      st.bs[lastIdx].el = st.el;
    }

    // Advance O(1) incremental checkpoint past fully closed pre-tail blocks (works identically for LF and CRLF)
    if (splitMeta.se > 0 && splitMeta.sc > 0) {
      const nextSafeCnt = baseCount + splitMeta.sc;
      const nextSafeEnd = baseEnd + splitMeta.se;
      if (nextSafeCnt < st.bs.length && nextSafeEnd > (st.lEnd || 0) && nextSafeEnd < visibleText.length) {
        st.lCnt = nextSafeCnt;
        st.lEnd = nextSafeEnd;
        st.lSrc = visibleText.slice(0, nextSafeEnd);
      }
    }
  }

  function renderSafeMarkdownDom(container, markdownText, fm, panel, prevStreamState = null) {
    if (!hasAttr(container, 'data-streaming-live') && !findChildByClass(container, C_EB) && ga(container, 'data-raw-zh') === markdownText) {
      return;
    }
    ra(container, 'data-streaming-live');
    const doc = docOf(container);
    sa(container, 'data-raw-zh', markdownText);

    const blocks = splitMarkdownBlocks(markdownText, false);
    if (
      prevStreamState &&
      prevStreamState.bd === container &&
      blocks.length > 0 &&
      prevStreamState.bs.length === blocks.length &&
      prevStreamState.el &&
      prevStreamState.tp === blocks[blocks.length - 1].k
    ) {
      let reusable = true;
      for (let i = 0; i < blocks.length - 1; i++) {
        if (prevStreamState.bs[i].k !== blocks[i].k || prevStreamState.bs[i].x !== blocks[i].x) {
          reusable = false;
          break;
        }
      }
      if (reusable) {
        compactLiveChunks(prevStreamState, 0, true);
        const tailBlk = blocks[blocks.length - 1];
        if (tailBlk.k === 'pre') stc(prevStreamState.el, tailBlk.x);
        else if (INLINE_MD_HINT_RE.test(tailBlk.x)) {
          clearEl(prevStreamState.el);
          appendInlineFormatted(prevStreamState.el, tailBlk.x, doc, fm, panel, 0);
        } else if (prevStreamState.tn && getTnStr(prevStreamState.tn) !== tailBlk.x) {
          setTn(prevStreamState.tn, tailBlk.x);
        }
        return;
      }
    }

    clearEl(container);
    const listCtx = { le: null, lt: '' };
    for (let i = 0; i < blocks.length; i++) {
      const blk = blocks[i];
      const el = mountStreamBlockContainer(listCtx, blk.k, doc, container);
      if (blk.k === 'pre') stc(el, blk.x);
      else appendInlineFormatted(el, blk.x, doc, fm, panel, 0);
    }
  }

  const findDirectOverlay = (panel) => findChildByClass(panel, C_OV);

  function triggerSingleBlockRetranslate(panel) {
    if (!panel || currentMode === 'off') return;
    const inf = extractPanelInfo(panel);
    if (!inf.t) return;
    const sig = sigFromBody(inf.k, currentMode);
    failedSigs.delete(sig);
    memCache.delete(`mt${inf.k}`);
    memCache.delete(`${activeStyleTag || 'ai_technical'}${inf.k}`);
    persistLocalStorageCache();

    const existing = inflightBySig.get(sig);
    if (existing) {
      cancelTranslateRequest(existing);
      inflightBySig.delete(sig);
    }
    startOrJoinTranslation(panel, inf.t, currentMode, sig, `sig${inf.k}`, true, { force: true, priority: 30000 });
  }

  function ensureOverlayShell(panel) {
    const doc = docOf(panel);
    let ov = findDirectOverlay(panel);
    if (ov) return ov;

    const t = getClientPack();
    ov = ce(doc, 'div', C_OV);
    sa(ov, 'data-op-thought', '1');
    sa(ov, 'data-prism-ignore', '1');
    sa(ov, 'data-ag-no-i18n', '');

    const body = ce(doc, 'span', C_BD);
    sa(body, 'data-ag-no-i18n', '');
    ap(ov, body);

    const fb = ce(doc, 'span', C_FB);
    sa(fb, 'data-testid', 'thought-fallback-badge');
    fb.hidden = true;
    stc(fb, t[2]);
    fb.title = t[3];
    if (fb[K_ST]) fb[K_ST].display = 'none';
    ap(ov, fb);

    const rb = ce(doc, 'button', C_RB);
    rb.type = 'button';
    sa(rb, 'data-no-press-spring', '1');
    sa(rb, 'data-testid', 'thought-retranslate-btn');
    rb.hidden = true;
    stc(rb, '↻');
    rb.title = t[4];
    sa(rb, 'aria-label', t[4]);
    if (rb[K_ST]) rb[K_ST].display = 'none';
    onClk(rb, (ev) => {
      stopEv(ev);
      triggerSingleBlockRetranslate(panel);
    });
    ap(ov, rb);

    const tb = ce(doc, 'button', C_TB);
    tb.type = 'button';
    sa(tb, 'data-no-press-spring', '1');
    const showingRaw = ga(panel, A_SRW) === '1';
    sa(tb, 'aria-pressed', String(showingRaw));
    stc(tb, showingRaw ? t[1] : t[0]);
    onClk(tb, (ev) => {
      stopEv(ev);
      sa(panel, A_MRW, ga(panel, A_SRW) === '1' ? '0' : '1');
      applyPanelViewMode(panel);
    });
    ap(ov, tb);

    sa(panel, A_PNL, '1');
    panel.insertBefore(ov, panel[K_FC]);
    return ov;
  }

  function syncOverlayBadges(ov, panel, isFallback, isReady) {
    if (!ov) return;
    const t = getClientPack();
    const fb = findChildByClass(ov, C_FB);
    if (fb) {
      fb.hidden = !isFallback;
      if (fb[K_ST]) fb[K_ST].display = isFallback ? '' : 'none';
      stc(fb, t[2]);
      fb.title = t[3];
    }
    if (panel) {
      if (isFallback) sa(panel, A_FBK, '1');
      else ra(panel, A_FBK);
    }
    const rb = findChildByClass(ov, C_RB);
    if (rb) {
      rb.hidden = !isReady;
      if (rb[K_ST]) rb[K_ST].display = isReady ? '' : 'none';
      rb.disabled = false;
      rb.title = t[4];
      sa(rb, 'aria-label', t[4]);
    }
  }

  function renderPendingState(panel, message, pendingKind = '') {
    if (!panel) return;
    const existingOv = findDirectOverlay(panel);
    if (ga(panel, A_RDY) === '1' && existingOv && ga(existingOv, 'data-pending') !== '1') {
      const rb = findChildByClass(existingOv, C_RB);
      if (rb) rb.disabled = true;
      return;
    }
    clearPanelStreamState(panel);
    const ov = ensureOverlayShell(panel);
    sa(ov, 'data-pending', '1');
    ra(ov, 'data-failed');
    ra(panel, A_FLD);
    syncOverlayBadges(ov, panel, false, false);

    const body = findChildByClass(ov, C_BD);
    if (body) {
      ra(body, 'data-raw-zh');
      let hint = findChildByClass(body, C_PH);
      if (!hint) {
        clearEl(body);
        hint = ap(body, ce(docOf(panel), 'span', C_PH));
      }
      if (pendingKind) sa(hint, 'data-pending-kind', pendingKind);
      if (tc(hint) !== message) stc(hint, message);
    }
    sa(panel, A_PND, '1');
    ra(panel, A_RDY);
  }

  function clearPendingKeepRaw(panel) {
    if (!panel || ga(panel, A_RDY) === '1') return;
    unlockHeight(panel);
    ra(panel, A_PND);
    const ov = findDirectOverlay(panel);
    if (ov && ga(ov, 'data-pending') === '1') {
      ov.remove();
      if (ga(panel, A_FLD) !== '1') ra(panel, A_PNL);
    }
  }

  function renderFailedState(panel, rawText, mode, sig) {
    if (!panel) return;
    clearPanelStreamState(panel);
    unlockHeight(panel);
    ra(panel, A_PND);

    const existingOv = findDirectOverlay(panel);
    if (ga(panel, A_RDY) === '1' && existingOv) {
      const rb = findChildByClass(existingOv, C_RB);
      if (rb) rb.disabled = false;
      return;
    }

    const doc = docOf(panel);
    const t = getClientPack();
    const ov = ensureOverlayShell(panel);
    ra(ov, 'data-pending');
    sa(ov, 'data-failed', '1');
    ra(panel, A_RDY);
    sa(panel, A_FLD, '1');
    syncOverlayBadges(ov, panel, false, false);

    const body = findChildByClass(ov, C_BD);
    if (body) {
      ra(body, 'data-raw-zh');
      clearEl(body);
      const errBar = ce(doc, 'span', C_EB);
      const errTxt = ce(doc, 'span', C_ET);
      stc(errTxt, t[5]);
      ap(errBar, errTxt);

      const retryBtn = ce(doc, 'button', C_RT);
      retryBtn.type = 'button';
      sa(retryBtn, 'data-testid', 'thought-retry-btn');
      sa(retryBtn, 'data-no-press-spring', '1');
      stc(retryBtn, t[6]);
      onClk(retryBtn, (ev) => {
        stopEv(ev);
        failedSigs.delete(sig);
        ra(ov, 'data-failed');
        ra(panel, A_FLD);
        applyPanelViewMode(panel);
        const inf = extractPanelInfo(panel);
        const curRaw = inf.t || rawText;
        const kb = inf.t ? inf.k : computeSkelBody(normalizeTextKey(curRaw));
        const activeMode = currentMode === 'off' ? mode : currentMode;
        const nextSig = sigFromBody(kb, activeMode);
        failedSigs.delete(nextSig);
        startOrJoinTranslation(panel, curRaw, activeMode, nextSig, `sig${kb}`, true, { force: true, priority: 30000 });
      });
      ap(errBar, retryBtn);
      ap(body, errBar);
    }
    applyPanelViewMode(panel);
  }

  function renderTranslatedText(panel, text, isPartial, sig, engine = '', streamOpts = null) {
    if (!panel || typeof text !== 'string' || !text) return;
    const ov = ensureOverlayShell(panel);
    ra(ov, 'data-pending');
    ra(ov, 'data-failed');
    ra(panel, A_FLD);
    const body = findChildByClass(ov, C_BD);
    if (!body) return;

    const isFallback = engine === 'machine-fallback';
    const steadyPartial =
      isPartial &&
      ga(panel, A_RDY) === '1' &&
      !hasAttr(panel, A_PND) &&
      (ga(panel, A_FBK) === '1') === isFallback;

    if (isPartial) {
      if (!lockedHeights.has(panel)) {
        const curH = panel.offsetHeight || 0;
        lockedHeights.set(panel, curH);
        if (curH > 0 && panel[K_ST]) panel[K_ST].minHeight = `${curH}px`;
      }
      renderIncrementalStreamDom(panel, body, text, streamOpts?.now || nowMs(), Boolean(streamOpts?.anim && !isMotionOff()));
      if (steadyPartial) return;
      syncOverlayBadges(ov, panel, isFallback, false);
    } else {
      const commitFinalDom = () => {
        panelSettleTimers.delete(panel);
        const prevSt = panelStreamStates.get(panel) || null;
        panelStreamStates.delete(panel);
        clearPanelHlItems(panel);
        if (!isConn(panel) || currentMode === 'off') return;
        const prevScrollTop = typeof panel.scrollTop === 'number' ? panel.scrollTop : 0;
        renderSafeMarkdownDom(body, text, ensurePanelFileMap(panel), panel, prevSt);
        unlockHeight(panel);
        if (prevScrollTop > 0 && typeof panel.scrollTop === 'number') panel.scrollTop = prevScrollTop;
      };

      const st = panelStreamStates.get(panel);
      const now = nowMs();
      let youngestAt = 0;
      if (!isMotionOff()) {
        if (st && st.cks && st.cks.length) youngestAt = st.cks[st.cks.length - 1].at;
        for (let i = hlItems.length - 1; i >= 0; i--) {
          if (hlItems[i].p === panel) {
            if (hlItems[i].at > youngestAt) youngestAt = hlItems[i].at;
            break;
          }
        }
      }
      const remFadeMs = youngestAt > 0 ? Math.max(0, CHUNK_FADE_TTL_MS - Math.max(0, now - youngestAt)) : 0;

      if (remFadeMs > 16) {
        const prevT = panelSettleTimers.get(panel);
        if (prevT) clearTimeout(prevT);
        const timer = setTimeout(commitFinalDom, remFadeMs + 12);
        if (timer && typeof timer.unref === 'function') timer.unref();
        panelSettleTimers.set(panel, timer);
      } else {
        const prevT = panelSettleTimers.get(panel);
        if (prevT) {
          clearTimeout(prevT);
          panelSettleTimers.delete(panel);
        }
        commitFinalDom();
      }

      syncOverlayBadges(ov, panel, isFallback, true);
      if (sig) {
        const effectiveSig = isFallback ? `${sig}:fallback` : sig;
        sa(panel, A_SIG, effectiveSig);
        const meta = panelMeta.get(panel) || {};
        meta.ds = effectiveSig;
        meta.rs = quickPanelStamp(panel);
        panelMeta.set(panel, meta);
      }
    }

    ra(panel, A_PND);
    sa(panel, A_RDY, '1');
    applyPanelViewMode(panel);
  }

  const sigFromBody = (kb, mode) => `${mode === 'machine' ? 'mt' : activeStyleTag || 'ai_pending'}:sig${kb}`;

  function findCachedByBody(kb, mode) {
    if (!kb) return '';
    const tag = mode === 'machine' ? 'mt' : activeStyleTag;
    return tag ? memCache.get(`${tag}${kb}`) || '' : '';
  }

  function claimPanelEntry(panel, entry) {
    if (!panel) return;
    const prev = panelActiveEntry.get(panel);
    if (prev && prev !== entry) {
      const idx = prev.ps.indexOf(panel);
      if (idx >= 0) prev.ps.splice(idx, 1);
      if (!prev.ps.length && !prev.dn) cancelTranslateRequest(prev);
    }
    if (entry) {
      panelActiveEntry.set(panel, entry);
      if (!entry.ps.includes(panel)) entry.ps.push(panel);
    } else {
      panelActiveEntry.delete(panel);
    }
  }

  function bindPanelToInflight(entry, panel, expanded) {
    if (panel) claimPanelEntry(panel, entry);
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
    const skelBody = srcSkelHash && srcSkelHash.startsWith('sig') ? srcSkelHash.slice(3) : computeSkelBody(normalizeTextKey(rawText));

    if (!force) {
      const cached = findCachedByBody(skelBody, mode);
      if (cached) {
        claimPanelEntry(panel, null);
        if (panel && expanded) renderTranslatedText(panel, cached, false, sig, mode === 'machine' ? 'machine' : 'ai');
        return;
      }
      if (isSigInCooldown(sig)) {
        claimPanelEntry(panel, null);
        if (panel && expanded && ga(panel, A_FLD) !== '1') renderFailedState(panel, rawText, mode, sig);
        return;
      }
      const existing = inflightBySig.get(sig);
      if (existing && !existing.x && nowMs() - existing.at <= 75000) {
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

    const requestId = `op_tr_${nowMs().toString(36)}_${++reqSeq}`;
    const entry = {
      id: requestId,
      sk: srcSkelHash,
      sc: panel ? quickStructureSig(panel) : null,
      m: mode,
      at: nowMs(),
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
      ps: [],
    };
    if (panel) claimPanelEntry(panel, entry);
    inflightBySig.set(sig, entry);

    if (panel && expanded) {
      const t = getClientPack();
      renderPendingState(panel, mode === 'machine' ? t[7] : t[8], mode === 'machine' ? 'machine' : 'ai');
    }

    const verifyPanel = (p) => {
      if (!isConn(p) || panelActiveEntry.get(p) !== entry) return false;
      const cs = quickStructureSig(p);
      if (entry.sc && cs && (cs.c !== entry.sc.c || cs.f !== entry.sc.f || cs.l !== entry.sc.l)) {
        const inf = extractPanelInfo(p);
        if (inf.t && `sig${inf.k}` !== entry.sk) return false;
        entry.sc = cs;
      }
      return true;
    };

    const flushPartialToPanels = (partialStr, streamOpts = null) => {
      const trimmed = String(partialStr || '').trimStart();
      if (!trimmed || trimmed === entry.lp || entry.x) return;
      const isFirstChunk = !entry.lp;
      entry.lp = trimmed;
      entry.fa = nowMs();
      entry.pp = '';
      for (const p of entry.ps) {
        if (verifyPanel(p)) {
          if (isFirstChunk) clearPanelStreamState(p);
          renderTranslatedText(p, trimmed, true, null, '', streamOpts);
        }
      }
    };

    const commitFinalPayloadToPanels = (pl) => {
      if (inflightBySig.get(sig) === entry) inflightBySig.delete(sig);
      if (!pl || currentMode === 'off' || entry.x) return;
      for (const p of entry.ps) {
        if (panelActiveEntry.get(p) === entry) panelActiveEntry.delete(p);
        if (!isConn(p)) continue;
        const inf = extractPanelInfo(p);
        if (inf.t && `sig${inf.k}` !== entry.sk) continue;
        if (isPanelCurrentlyExpanded(p) && !isHiddenByAncestor(null, p)) {
          renderTranslatedText(p, pl.z, false, pl.s, pl.e);
        } else {
          const m = panelMeta.get(p) || {};
          m.ps = pl.s;
          m.rs = inf.s;
          panelMeta.set(p, m);
        }
      }
      scheduleScan(30);
    };

    const ensurePacerLoop = () => {
      if (entry.pRaf || entry.pTm || entry.x || currentMode === 'off') return;
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

        const rem = 30 - (now - entry.pa);
        if (entry.pa > 0 && !entry.dn && rem > 0) {
          entry.sk = (entry.sk || 0) + 1;
          if (entry.sk >= 2 && typeof setTimeout === 'function' && rem > 6) {
            entry.sk = 0;
            entry.pTm = setTimeout(() => {
              entry.pTm = null;
              if (!entry.x && currentMode !== 'off') ensurePacerLoop();
            }, Math.ceil(rem - 2));
            entry.pTm?.unref?.();
          } else {
            entry.pRaf = raf(stepPacer);
          }
          return;
        }
        entry.sk = 0;

        const dt = entry.pa > 0 ? Math.min(80, Math.max(8, now - entry.pa)) : 16.67;
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
      entry.fTm = setTimeout(() => {
        entry.fTm = null;
        if (currentMode === 'off' || entry.x || !entry.pp) return;
        if (entry.fa > 0 && nowMs() - entry.fa < STREAM_FLUSH_MS) return scheduleAlignedStreamFlush();
        flushPartialToPanels(entry.pp);
      }, STREAM_FLUSH_MS);
    };

    const failEntry = () => {
      cancelFlushHandle(entry);
      if (inflightBySig.get(sig) === entry) inflightBySig.delete(sig);
      if (entry.x || currentMode === 'off') return;
      recordSigFailure(sig);
      for (const p of entry.ps) {
        if (panelActiveEntry.get(p) === entry) {
          panelActiveEntry.delete(p);
          if (isConn(p)) renderFailedState(p, rawText, mode, sig);
        }
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
      if (entry.fa === 0) flushPartialToPanels(trimmed);
      else if (now - entry.fa >= STREAM_FLUSH_MS) {
        cancelFlushHandle(entry);
        flushPartialToPanels(trimmed);
      } else scheduleAlignedStreamFlush();
    })
      .then((res) => {
        if (currentMode === 'off' || entry.x || res?.cancelled) {
          cancelFlushHandle(entry);
          if (inflightBySig.get(sig) === entry) inflightBySig.delete(sig);
          for (const p of entry.ps) {
            if (isConn(p) && ga(p, A_RDY) !== '1') clearPendingKeepRaw(p);
          }
          return;
        }
        if (res && res.ok && typeof res.text === 'string' && res.text.trim()) {
          const finalZh = res.text.trim();
          const isFb = res.engine === 'machine-fallback' || Boolean(res.fallback);
          const eng = isFb ? 'machine-fallback' : res.engine || (mode === 'machine' ? 'machine' : 'ai');
          failedSigs.delete(sig);
          putMemCache(res.key || `${isFb || mode === 'machine' ? 'mt' : activeStyleTag || 'ai_technical'}${skelBody}`, finalZh, true);

          if (
            !res.cached &&
            canUseSmoothStream() &&
            entry.ps.some((p) => isConn(p) && isPanelCurrentlyExpanded(p) && !isHiddenByAncestor(null, p)) &&
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

  function isHiddenByAncestor(btn, panel) {
    return Boolean((btn && typeof btn[K_CV] === 'function' && !btn[K_CV]()) || (panel && typeof panel[K_CV] === 'function' && !panel[K_CV]()));
  }

  function probeViewportBand(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return 2;
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return typeof el[K_CV] === 'function' ? 0 : 2;
      const rootEl = docRoot();
      const vh = W.innerHeight || (rootEl && rootEl.clientHeight) || 0;
      if (vh <= 0 || rect.height <= 0) return 2;
      const vw = W.innerWidth || (rootEl && rootEl.clientWidth) || 1440;
      if (rect.right < 0 || rect.left > vw) return 0;
      if (rect.bottom >= -120 && rect.top <= vh + 120) return 2;
      if (rect.bottom >= -800 && rect.top <= vh + 800) return 1;
      return 0;
    } catch (_) {
      return 2;
    }
  }

  function enqueueHydrate(panel, cached, sig, engine) {
    if (!panel || hydrateQueue.some((x) => x.p === panel)) return;
    hydrateQueue.push({ p: panel, z: cached, s: sig, e: engine });
    if (hydrateHandle) return;
    const step = () => {
      hydrateHandle = null;
      if (currentMode === 'off') return clearHydrateQueue();
      // 两阶段读写分离：先批量读取可见性/视口位置，再统一写入 DOM，消除多帧 Layout Thrashing
      const ready = [];
      while (hydrateQueue.length && ready.length < 3) {
        const it = hydrateQueue.shift();
        if (isConn(it.p) && isPanelCurrentlyExpanded(it.p) && !isHiddenByAncestor(null, it.p) && probeViewportBand(it.p) > 0) {
          ready.push(it);
        }
      }
      for (let i = 0; i < ready.length; i++) {
        const it = ready[i];
        renderTranslatedText(it.p, it.z, false, it.s, it.e);
      }
      if (hydrateQueue.length) (hydrateHandle = setTimeout(step, 16))?.unref?.();
    };
    (hydrateHandle = setTimeout(step, 16))?.unref?.();
  }

  function processSingleTrigger(btn, allowPreloadCollapsed, priority = 0) {
    if (!btn) return;
    const expanded = ga(btn, A_EXP) === 'true';
    if (!expanded && !allowPreloadCollapsed) return;

    const panel = nextSib(btn);
    if (!panel || String(panel.tagName || '').toUpperCase() !== 'DIV') return;

    const streaming = isTriggerStreaming(btn);
    if (streaming) {
      const now = nowMs();
      const prevMeta = panelMeta.get(panel);
      const alreadyStreamingPending = Boolean(prevMeta && prevMeta.s && ga(panel, A_PND) === '1');
      const meta = prevMeta || { h: '', c: now, s: true, m: true, f: 0, ds: '', ps: '', rs: '' };
      meta.s = true;
      meta.m = true;
      meta.f = 0;
      meta.c = now;
      panelMeta.set(panel, meta);
      clearPanelWaitTimer(panel);
      if (alreadyStreamingPending) return;
      if (expanded && !isHiddenByAncestor(btn, panel)) renderPendingState(panel, getClientPack()[9], 'streaming');
      return;
    }

    if (expanded && ga(panel, A_RDY) === '1') {
      const em = panelMeta.get(panel);
      if (em && em.rs === quickPanelStamp(panel) && em.ds && em.ds === ga(panel, A_SIG)) return;
    }

    const hiddenAnc = isHiddenByAncestor(btn, panel);
    if (hiddenAnc && !allowPreloadCollapsed) return;
    const visExpanded = expanded && !hiddenAnc;

    const inf = extractPanelInfo(panel);
    if (!inf.t || inf.z) {
      if (ga(panel, A_PND) === '1') clearPendingKeepRaw(panel);
      const m0 = panelMeta.get(panel) || {};
      m0.ps = sigFromBody(inf.k, currentMode);
      m0.rs = inf.s;
      panelMeta.set(panel, m0);
      return;
    }

    const srcSkelHash = `sig${inf.k}`;
    const sig = sigFromBody(inf.k, currentMode);

    if (visExpanded && ga(panel, A_RDY) === '1' && ga(panel, A_SIG) === sig) {
      const meta = panelMeta.get(panel) || {};
      meta.ds = sig;
      meta.rs = inf.s;
      panelMeta.set(panel, meta);
      return;
    }

    const now = nowMs();
    let meta = panelMeta.get(panel);
    if (!meta) {
      meta = { h: srcSkelHash, c: now, s: false, m: false, f: now - FINISH_GATE_MS, ds: '', ps: '', rs: '' };
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

    const cached = findCachedByBody(inf.k, currentMode);
    if (cached) {
      clearPanelWaitTimer(panel);
      const eng = currentMode === 'machine' ? 'machine' : 'ai';
      if (visExpanded) {
        if (syncHydrateBudget > 0) {
          syncHydrateBudget--;
          renderTranslatedText(panel, cached, false, sig, eng);
        } else {
          enqueueHydrate(panel, cached, sig, eng);
        }
      } else {
        meta.ps = sig;
        meta.rs = inf.s;
        panelMeta.set(panel, meta);
      }
      return;
    }

    const activeFlight = inflightBySig.get(sig);
    if (activeFlight && !activeFlight.x && now - activeFlight.at <= 75000) {
      bindPanelToInflight(activeFlight, panel, visExpanded);
      return;
    }

    if (isSigInCooldown(sig)) {
      if (visExpanded && ga(panel, A_FLD) !== '1') renderFailedState(panel, inf.t, currentMode, sig);
      return;
    }

    const waitMs = meta.m ? Math.max(0, FINISH_GATE_MS - (now - meta.f), QUIET_GATE_MS - (now - meta.c)) : 0;
    if (waitMs > 0) {
      if (visExpanded) renderPendingState(panel, getClientPack()[10], 'settling');
      setPanelWaitTimer(
        panel,
        btn,
        () => {
          if (currentMode === 'off' || !isConn(btn)) return;
          const liveExpanded = ga(btn, A_EXP) === 'true';
          let liveAllowPreload = false;
          if (!liveExpanded && triggerTiming === 'preload') {
            const allBtns = queryTriggers();
            liveAllowPreload = Boolean(allBtns.length > 0 && allBtns[allBtns.length - 1] === btn);
          }
          if (!liveExpanded && !liveAllowPreload) return clearPendingKeepRaw(panel);
          processSingleTrigger(btn, liveAllowPreload, priority);
        },
        waitMs + 25
      );
      return;
    }

    startOrJoinTranslation(panel, inf.t, currentMode, sig, srcSkelHash, visExpanded, { priority });
  }

  function pruneUnneededPendingRequests(activePanelSet) {
    for (const [sig, entry] of inflightBySig.entries()) {
      if (entry.lp || entry.x) continue;
      if (!entry.ps.some((p) => isConn(p) && activePanelSet.has(p))) {
        cancelTranslateRequest(entry);
        inflightBySig.delete(sig);
      }
    }
  }

  function scanNow() {
    scanTimer = null;
    if (currentMode === 'off') return;
    const triggers = queryTriggers();
    if (!triggers.length) return;

    const lastIdx = triggers.length - 1;
    const candidates = [];
    const activePanelSet = new Set();
    let sawOffscreenLazy = false;

    for (let i = 0; i <= lastIdx; i++) {
      const btn = triggers[i];
      if (!btn) continue;
      const isLatest = i === lastIdx;
      const allowPreload = triggerTiming === 'preload' && isLatest;
      const expanded = ga(btn, A_EXP) === 'true';
      if (!allowPreload && !expanded) continue;

      const panel = nextSib(btn);
      if (panel) {
        const em = panelMeta.get(panel);
        const streamingNow = isTriggerStreaming(btn);
        if (streamingNow && expanded && isLatest && em && em.s && ga(panel, A_PND) === '1') {
          activePanelSet.add(panel);
          continue;
        }
        if (em && !streamingNow && em.rs === quickPanelStamp(panel)) {
          if (expanded && ga(panel, A_RDY) === '1' && em.ds && em.ds === ga(panel, A_SIG)) {
            continue;
          }
          if (!expanded) {
            const inf = rawCacheMap.get(panel);
            if (inf && inf.s === em.rs && em.ps && em.ps === sigFromBody(inf.k, currentMode)) {
              continue;
            }
          }
        }
        if (!isLatest && isHiddenByAncestor(btn, panel)) continue;
        if (em && !streamingNow && em.rs === quickPanelStamp(panel) && isHiddenByAncestor(btn, panel)) {
          const inf = rawCacheMap.get(panel);
          if (inf && inf.s === em.rs && em.ps && em.ps === sigFromBody(inf.k, currentMode)) {
            activePanelSet.add(panel);
            continue;
          }
        }
      }

      const band = expanded && !isLatest ? probeViewportBand(panel || btn) : 0;
      if (!isLatest && band === 0) {
        sawOffscreenLazy = true;
        continue;
      }
      if (panel) activePanelSet.add(panel);

      const tier = isLatest && expanded ? 25 : band === 2 ? 20 : isLatest ? 12 : 10;
      candidates.push({ b: btn, a: allowPreload, p: tier * 1000 + i });
    }
    hasOffscreenLazyPanels = sawOffscreenLazy;

    if (inflightBySig.size > 0) pruneUnneededPendingRequests(activePanelSet);
    if (!candidates.length) return;
    candidates.sort((x, y) => y.p - x.p);
    syncHydrateBudget = 1;
    try {
      for (let i = 0; i < candidates.length; i++) {
        processSingleTrigger(candidates[i].b, candidates[i].a, candidates[i].p);
      }
    } finally {
      syncHydrateBudget = 99;
    }
  }

  function scheduleScan(delayMs = 55) {
    if (currentMode === 'off' || scanTimer) return;
    scanTimer = setTimeout(scanNow, delayMs);
  }

  const clrScan = () => {
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
  };
  const brCall = (action, inp) => {
    const br = getBridge();
    return br ? br.call({ action, ...inp }) : offRes();
  };
  const RESET_SIG_ATTRS = [A_SIG, A_FBK, A_FLD];

  let syncedOnce = false;

  const api = {
    sync(cfg = {}) {
      const nextMode = cfg.thoughtTranslate === 'machine' || cfg.thoughtTranslate === 'ai' ? cfg.thoughtTranslate : 'off';
      const prevTrigger = triggerTiming;
      triggerTiming = cfg.thoughtTrigger === 'expand' ? 'expand' : 'preload';
      const triggerChanged = prevTrigger !== triggerTiming;

      const prevLang = currentLang;
      currentLang = resolveActiveLang(cfg.language);
      const langChanged = prevLang !== currentLang;
      if (langChanged) refreshAllOverlayLocaleStrings();

      const incomingView = cfg.thoughtView || cfg.thoughtViewMode;
      let viewChanged = false;
      if (incomingView === 'bilingual' || incomingView === 'immersive') {
        hasExplicitHostView = true;
        viewModeLoaded = true;
        viewChanged = currentViewMode !== incomingView;
        currentViewMode = incomingView;
        if (viewChanged || !syncedOnce) {
          persistViewModePreference(currentViewMode);
          syncDocViewAttribute();
          refreshAllPanelViewModes(viewChanged);
        }
      }

      if (nextMode === 'off') {
        clrScan();
        currentMode = 'off';
        syncedOnce = false;
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
        clearHydrateQueue();
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
        qsa(SEL_TRIGGER).forEach((b) => resetPanelSig(nextSib(b)));
        qsa(SEL_OVERLAY).forEach((ov) => resetPanelSig(parEl(ov)));
      }
      const needScan = !syncedOnce || changed || langChanged || viewChanged || triggerChanged;
      syncedOnce = true;
      if (needScan) scheduleScan(25);
    },
    scan() {
      scheduleScan(45);
    },
    scanImmediate() {
      clrScan();
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
      refreshAllPanelViewModes(true);
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
    getConfig: () => brCall('get-config').then((res) => (syncRemoteCfgMeta(res), res)),
    saveConfig(input) {
      return brCall('save-config', input).then((res) => {
        const nextTag = res?.styleTag || (res?.stylePreset ? `ai_${res.stylePreset}` : '');
        const tagChanged = setActiveStyleTag(nextTag);
        qsa(SEL_TRIGGER).forEach((b) => {
          const p = nextSib(b);
          if (p && (tagChanged || ga(p, A_FBK) === '1' || ga(p, A_FLD) === '1')) {
            raList(p, RESET_SIG_ATTRS);
            panelMeta.delete(p);
          }
        });
        failedSigs.clear();
        scheduleScan(25);
        return res;
      });
    },
    fetchModels: (input) => brCall('fetch-models', input),
    testConnection: (input) => brCall('test-connection', input),
    __memCache: memCache,
    destroy() {
      currentMode = 'off';
      syncedOnce = false;
      hasOffscreenLazyPanels = false;
      clrScan();
      if (cacheDirty || persistTimer || persistIdle || memCache.size > storedCount) flushLocalStorageCacheNow();
      releasePrismOverlays();
      hlBks = null;
    },
  };

  W.__agPrismThought = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
