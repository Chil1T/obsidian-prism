// Obsidian Prism — Route Choreography, Velvet Stream Feathering, Auto-Unfold & Lens Module (stream-choreography.js)
(function (root) {
  'use strict';
  const M = Math;
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : window);
  if (!G) return;

  const STREAM_BATCH_MS = 52;
  const STREAM_FADE_MS = 300;
  const STREAM_FADE_STEP_MS = 60;
  const MAX_FADE_RANGES = 48;
  const SIDEBAR_RUN_HOLD_MS = 450;
  const STOP_TID_RE = /(?:^|[^a-z])(?:stop|cancel|abort)(?:[^a-z]|$)/i;
  const STOP_CAMEL_RE = /(?:^|[^a-zA-Z])(?:stop|cancel|abort)(?=[A-Z])|(?:Stop|Cancel|Abort)(?:[A-Z0-9_-]|$)/;
  const STOP_LABEL_RE = /(?:^|\b)(?:stop|cancel|abort)(?:\b|$)|停止|取消|中止/i;
  const NON_STOP_RE =
    /取消置顶|取消固定|取消收藏|unpin|\b(?:pin|menu|more|options|delete|trash|archive|rename|close|dismiss)\b|置顶|固定|更多|菜单|选项|删除|归档|重命名/i;
  const HIGHLIGHT_NAMES = [0, 1, 2, 3, 4].map((i) => 'ag-stream-f' + i);
  const TABLE_TAGS = new Set('TABLE|THEAD|TBODY|TFOOT|TR|TH|TD'.split('|'));
  const INLINE_TAGS = new Set('SPAN|STRONG|EM|B|I|A|CODE|MARK|DEL|SUB|SUP'.split('|'));
  const K_PE = 'parentElement', K_CL = 'classList', K_IC = 'isConnected';
  const A_TID = 'data-testid', A_EXP = 'aria-expanded', A_SB = 'data-ag-cs-sidebar', A_RR = 'data-ag-cs-row-running';
  const A_AU = 'data-ag-cs-auto-unfolded', A_OO = 'data-ag-cs-outer-open', A_TS = 'data-ag-cs-thought-streaming';
  const S_SUB = '[data-testid="subagent-tab-conversation"]', S_CV = '[data-testid="conversation-view"]', S_TKT = '[data-testid="thinking-collapsible-trigger"]';
  const S_WF = '[data-testid="worked-for-collapsible"]', S_SBR = '[data-testid="conversation-row-sidebar"]', S_IB = '[data-testid="agent-input-box"]';

  const isEl = (n) => !!(n && (n.nodeType === 1 || (n.nodeType === undefined && typeof n.tagName === 'string')));
  const tagOf = (n) => String(n?.tagName || '').toUpperCase();
  const peOf = (n) => n?.[K_PE] || null;
  const clHas = (e, c) => !!(e?.[K_CL]?.contains?.(c));
  const clRm = (e, c) => e?.[K_CL]?.remove?.(c);
  const isConn = (e) => !!(e && e[K_IC] !== false);
  const ga = (e, k) => e?.getAttribute?.(k);
  const sa = (e, k, v) => e?.setAttribute?.(k, v);
  const ra = (e, k) => e?.removeAttribute?.(k);
  const ha = (e, k) => !!(e?.hasAttribute?.(k));
  const qs = (e, s) => e?.querySelector?.(s) || null;
  const qsa = (e, s) => e?.querySelectorAll?.(s) || [];
  const closestOf = (e, s) => e?.closest?.(s) || null;
  const isF = (v) => typeof v === 'function', T = (f) => { try { return f(); } catch {} };
  const rectOf = (e) => (isF(e?.getBoundingClientRect) ? e.getBoundingClientRect() : null);
  const setProp = (e, k, v) => e?.style?.setProperty?.(k, v);
  const docOf = () => (typeof document !== 'undefined' ? document : null);
  const nowOf = () => (typeof performance !== 'undefined' && isF(performance.now) ? performance.now() : Date.now());
  const rAF = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : 0);
  const cAF = (id) => { if (id && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); return 0; };
  const ST = (fn, ms) => setTimeout(fn, ms), CT = (id) => clearTimeout(id), cT = (id) => { if (id) clearTimeout(id); return 0; }, AF = Array.from, isFin = Number.isFinite;
  const PO = 'ag-prism-overlay-portal';
  const mkOv = (d, c) => { const e = d.createElement('div'); if (c) { e.className = c; sa(e, 'aria-hidden', 'true'); } sa(e, 'data-ag-owned', '1'); sa(e, 'data-ag-no-i18n', ''); return e; };
  const portalOf = (d) => {
    let p = d?.getElementById?.(PO);
    if (!p && d?.body) {
      p = mkOv(d); p.id = PO; sa(p, 'translate', 'no'); sa(p, 'data-no-translate', 'true');
      if (p.style) p.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9990;contain:layout style';
      d.body.appendChild(p);
    }
    return p || d?.body;
  };

  const createStreamChoreographyController = ({
    motionEngine,
    isDestroyed,
    isMotionStandardOrUltra,
    isMotionUltra,
    isConvRunning,
    isThoughtIsolatedNode,
    isThoughtMutationRecord,
    isManagedThoughtPanel,
    setAttrIfChanged,
    runGuardedMut,
    cloneCachedSvgElement,
    buildBrandMarkSvg,
    applySingleHostIcon,
    rippleCtl,
    convAuraCtl,
    notifyMascot,
  }) => {
    let hydrateRaf = 0;
    let sparkQueue = [];
    let iconQueue = [];
    let unfoldQueue = [];
    let unfoldRaf = 0;
    let wfClickTimer = 0;
    let convEntryTimer = 0;
    let convEntryRaf = 0;
    let convEntrySeq = 0;
    const transientTimers = new Set();

    const heroState = {
      routeInitialized: false,
      wasInHome: false,
      wasInFormalConv: false,
      lastModelSig: null,
      pendingModelShiftNotify: false,
      lastTriggerOrigin: null,
      lastGroupPress: null,
    };
    let lastHomeRect = null;
    let liftoffBubbleUntil = 0;
    let suppressEntryMotionUntil = 0;
    let runInit = false;
    let wasRunning = false;
    let runStartAt = 0;
    let lastVialHighNotifyAt = -600000;
    let fiberTimer = 0;
    let sbInit = false;
    let sbIndex = -1;
    let sbCid = '';
    let sbRect = null;
    let sbRunning = false;
    const runningCidMap = new Map();
    const runningRowMap = new WeakMap();
    let runHoldTimer = 0;

    const seenHeaders = new WeakSet();
    const seenOverlays = new WeakSet();

    let streamObs = null;
    const streamRoots = new Set();
    const paneRunState = new WeakMap();
    let streamMutating = false;
    let lastCodeAt = -1000;
    let scannedNodes = new WeakSet();
    let seenBlocks = new WeakSet();
    const textLenMap = new WeakMap();

    const fadeItems = [];
    let hlBuckets = null;
    let fadeRaf = 0;
    let fadeTimer = 0;
    let nextFadeDueAt = 0;
    const doneSparkCache = new WeakMap();

    const expirableClasses = new Map();
    let sweepTimer = 0;

    const guardMut = (fn) => {
      const p = streamMutating; streamMutating = true;
      try { return isF(runGuardedMut) ? runGuardedMut(fn) : fn(); } finally {
        if (!p && streamObs?.takeRecords) T(() => streamObs.takeRecords());
        streamMutating = p;
      }
    };

    const canStreamMotion = () => ga(docOf()?.documentElement, 'data-ag-cs-motion') !== 'off' && !!(isF(isMotionStandardOrUltra) ? isMotionStandardOrUltra() : isMotionUltra());
    const tA = (e, k, on) => { if (on) setAttrIfChanged(e, k, '1'); else if (ha(e, k)) ra(e, k); };

    const getHlBuckets = () => {
      const cssObj = typeof CSS !== 'undefined' ? CSS : G.CSS, HlCtor = typeof Highlight === 'function' ? Highlight : G.Highlight, d = docOf();
      if (!cssObj?.highlights?.set || !isF(HlCtor) || !isF(d?.createRange)) return null;
      if (!hlBuckets) hlBuckets = HIGHLIGHT_NAMES.map((n) => { const h = cssObj.highlights.get?.(n) || new HlCtor(); cssObj.highlights.set(n, h); return h; });
      else for (let i = 0; i < 5; i++) { const n = HIGHLIGHT_NAMES[i], cur = cssObj.highlights.get?.(n); if (cur && cur !== hlBuckets[i]) hlBuckets[i] = cur; else if (!cur) cssObj.highlights.set(n, hlBuckets[i]); }
      return hlBuckets;
    };

    const dropBucketItem = (it) => { if (hlBuckets && it.b >= 0 && it.b < 5) T(() => hlBuckets[it.b].delete(it.r)); it.b = -1; };
    const clearFadeTimer = () => { fadeTimer = cT(fadeTimer); };

    const clearHighlightFade = () => {
      clearFadeTimer(); fadeRaf = cAF(fadeRaf); nextFadeDueAt = 0;
      for (const it of fadeItems) dropBucketItem(it);
      fadeItems.length = 0;
    };

    const scheduleFadeStep = (now, useTimer) => {
      if (isDestroyed() || !fadeItems.length) return;
      if (docOf()?.hidden) return clearHighlightFade();
      if (fadeRaf) return;
      const delay = nextFadeDueAt > 0 ? nextFadeDueAt - now : 0;
      if (useTimer && delay > 18 && typeof setTimeout === 'function') {
        if (fadeTimer) return;
        fadeTimer = ST(() => {
          fadeTimer = 0;
          if (isDestroyed() || !canStreamMotion() || !fadeItems.length || docOf()?.hidden) return clearHighlightFade();
          if (!fadeRaf && !(fadeRaf = rAF(stepHighlightFade))) clearHighlightFade();
        }, M.max(8, M.round(delay - 6)));
        return;
      }
      clearFadeTimer();
      if (!(fadeRaf = rAF(stepHighlightFade))) clearHighlightFade();
    };

    function stepHighlightFade(ts) {
      clearFadeTimer(); fadeRaf = 0;
      if (isDestroyed() || !canStreamMotion() || !fadeItems.length || docOf()?.hidden) return clearHighlightFade();
      const now = typeof ts === 'number' && isFin(ts) ? ts : nowOf();
      if (nextFadeDueAt > 0 && now < nextFadeDueAt - 1) return scheduleFadeStep(now, true);
      const buckets = getHlBuckets();
      if (!buckets) return clearHighlightFade();
      let w = 0, earliestDue = Infinity;
      for (const it of fadeItems) {
        const tn = it.n, val = tn ? tn.data ?? tn.nodeValue ?? '' : '', age = M.max(0, now - it.t);
        if (!isConn(tn) || val.length < it.e || age >= STREAM_FADE_MS) { dropBucketItem(it); continue; }
        const nb = M.min(4, (age / STREAM_FADE_STEP_MS) | 0);
        if (it.b !== nb) { dropBucketItem(it); try { buckets[nb].add(it.r); it.b = nb; } catch { continue; } }
        const due = it.t + (it.b + 1) * STREAM_FADE_STEP_MS;
        if (due < earliestDue) earliestDue = due;
        fadeItems[w++] = it;
      }
      fadeItems.length = w;
      if (w > 0) { nextFadeDueAt = isFin(earliestDue) ? earliestDue : 0; scheduleFadeStep(now, false); }
      else clearHighlightFade();
    }

    const enqueueFadeRange = (tn, sOff, eOff, now) => {
      if (!tn || eOff <= sOff) return false;
      const d = docOf(), buckets = d && !d.hidden ? getHlBuckets() : null;
      if (!buckets) return false;
      const raw = tn.data ?? tn.nodeValue ?? '';
      if (eOff > raw.length || !/\S/.test(raw.slice(sOff, eOff))) return false;
      const prev = fadeItems[fadeItems.length - 1];
      if (prev && prev.n === tn && prev.e === sOff && now - prev.t <= 64 && T(() => (prev.r.setEnd(tn, eOff), prev.e = eOff, true))) return true;
      if (fadeItems.length >= MAX_FADE_RANGES) { const old = fadeItems.shift(); if (old) dropBucketItem(old); }
      return !!T(() => {
        const r = d.createRange(); r.setStart(tn, sOff); r.setEnd(tn, eOff); buckets[0].add(r);
        fadeItems.push({ n: tn, s: sOff, e: eOff, r, b: 0, t: now });
        const due = now + STREAM_FADE_STEP_MS, earlier = !nextFadeDueAt || due < nextFadeDueAt;
        if (earlier) { nextFadeDueAt = due; clearFadeTimer(); }
        scheduleFadeStep(now, false);
        return true;
      });
    };

    const snapTextLens = (node, limit = 24) => {
      if (!node) return;
      let c = 0;
      const walk = (n) => {
        if (!n || c >= limit) return;
        if (n.nodeType === 3) { textLenMap.set(n, (n.data ?? n.nodeValue ?? '').length); c++; return; }
        const ks = n.childNodes;
        if (ks) for (let i = ks.length - 1; i >= 0 && c < limit; i--) walk(ks[i]);
      };
      walk(node);
    };

    const flushExpiredClasses = () => {
      sweepTimer = 0;
      if (!expirableClasses.size) return;
      const now = Date.now();
      let nextDue = Infinity;
      guardMut(() => {
        for (const [el, map] of expirableClasses.entries()) {
          for (const [cls, expAt] of map.entries()) {
            if (now >= expAt - 2) { clRm(el, cls); map.delete(cls); }
            else if (expAt < nextDue) nextDue = expAt;
          }
          if (!map.size) expirableClasses.delete(el);
        }
      });
      if (!isDestroyed() && expirableClasses.size && isFin(nextDue)) sweepTimer = ST(flushExpiredClasses, M.max(16, M.ceil(nextDue - Date.now())));
    };

    const scheduleTransient = (fn, ms) => {
      const id = ST(() => { transientTimers.delete(id); if (!isDestroyed()) T(() => guardMut(fn)); }, ms);
      transientTimers.add(id);
      return id;
    };

    const clearTransientTimers = () => {
      convEntrySeq++;
      convEntryTimer = cT(convEntryTimer); convEntryRaf = cAF(convEntryRaf);
      wfClickTimer = cT(wfClickTimer); sweepTimer = cT(sweepTimer); runHoldTimer = cT(runHoldTimer);
      runningCidMap.clear(); expirableClasses.clear();
      for (const id of transientTimers) CT(id);
      transientTimers.clear();
    };
    const cancelDeferredHydration = () => {
      convEntrySeq++;
      convEntryTimer = cT(convEntryTimer); convEntryRaf = cAF(convEntryRaf);
      hydrateRaf = cAF(hydrateRaf); unfoldRaf = cAF(unfoldRaf);
      sparkQueue = []; iconQueue = []; unfoldQueue = [];
    };

    const applySingleSpark = (trig, brand, st) => {
      const d = docOf();
      if (!d || !isConn(trig)) return;
      tA(trig, 'data-ag-cs-spark-streaming', st === 'streaming');
      let spark = clHas(trig.firstElementChild, 'ag-cs-thinking-spark') ? trig.firstElementChild : qs(trig, '.ag-cs-thinking-spark');
      if (!spark) {
        spark = d.createElement('span');
        spark.className = 'ag-cs-thinking-spark';
        sa(spark, 'aria-hidden', 'true');
        sa(spark, 'data-ag-no-i18n', '');
        sa(spark, 'data-ag-owned', '1');
        trig.insertBefore(spark, trig.firstChild);
      }
      const isMono = ga(d.documentElement, 'data-ag-cs-accent') === 'mono';
      const mv = isMono ? '1' : '0';
      if (ga(spark, 'data-brand') !== brand || ga(spark, 'data-state') !== st || ga(spark, 'data-mono') !== mv) {
        sa(spark, 'data-brand', brand);
        sa(spark, 'data-state', st);
        sa(spark, 'data-mono', mv);
        const c = cloneCachedSvgElement(`spark:${brand}:${mv}`, buildBrandMarkSvg(brand, 13, 'auto', isMono));
        if (c) (G.__agPrismSvgUtil ? G.__agPrismSvgUtil.mount(spark, c) : spark.replaceChildren?.(c));
      }
    };

    const stepHydration = () => {
      hydrateRaf = 0;
      if (isDestroyed()) return;
      guardMut(() => {
        let budget = 18;
        while (budget > 0 && sparkQueue.length > 0) {
          const it = sparkQueue.pop();
          applySingleSpark(it.trig, it.brand, it.st);
          budget--;
        }
        while (budget > 0 && iconQueue.length > 0) {
          const it = iconQueue.pop();
          if (!ga(it.btn, 'data-ag-cs-icon-injected')) applySingleHostIcon(it.btn, it.iconName, it.origSvg, it.size);
          budget--;
        }
      });
      if (sparkQueue.length > 0 || iconQueue.length > 0) hydrateRaf = rAF(stepHydration);
    };

    const enqueueDeferredIcons = (items) => {
      iconQueue = items;
      if (!isDestroyed() && !hydrateRaf) hydrateRaf = rAF(stepHydration);
    };

    const STREAM_THOUGHT_RE = /(?:\.\.\.|…)\s*$|正在思考|思考中/i;
    const isStreamingThoughtTrigger = (trig, isLast) => {
      if (ga(trig, 'data-op-thought-state') === 'streaming') return true;
      if (!isLast) return false;
      return STREAM_THOUGHT_RE.test(String(trig.textContent || '').trim());
    };

    const resolveScopeBrand = (scope, primaryModelInfo, paneModelMap) => {
      const mapped = isF(paneModelMap?.get) ? paneModelMap.get(scope)?.brand : '';
      if (mapped) return mapped;
      const d = docOf();
      return (scope && scope !== d && (ga(scope, 'data-ag-cs-pane-camp') || (isF(scope.closest) && ga(scope.closest('[data-tiling-pane]'), 'data-ag-cs-pane-camp')) || ga(qs(scope, '[data-testid="model-selector-trigger"] .ag-cs-model-glyph'), 'data-brand'))) || primaryModelInfo?.brand || 'gemini';
    };

    const syncThinkingSparks = (primaryModelInfo, paneModelMap = null) => {
      const d = docOf();
      if (isDestroyed() || !d) return;
      const views = findFormalConvViews();
      const scopes = views.length > 0 ? views : [d];
      const mv = ga(d.documentElement, 'data-ag-cs-accent') === 'mono' ? '1' : '0';
      const pending = [];
      for (let s = 0; s < scopes.length; s++) {
        const scope = scopes[s], brand = resolveScopeBrand(scope, primaryModelInfo, paneModelMap), cacheSig = `${brand}:${mv}`;
        const triggers = qsa(scope, S_TKT), len = triggers.length;
        for (let i = 0; i < len; i++) {
          const trig = triggers[i], isLast = i === len - 1, expSt = ga(trig, 'data-op-thought-state') === 'streaming';
          if (!expSt && !isLast && doneSparkCache.get(trig) === cacheSig) continue;
          const spark = clHas(trig.firstElementChild, 'ag-cs-thinking-spark') ? trig.firstElementChild : qs(trig, '.ag-cs-thinking-spark');
          const st = expSt || isStreamingThoughtTrigger(trig, isLast) ? 'streaming' : 'done';
          if (spark && ga(spark, 'data-brand') === brand && ga(spark, 'data-state') === st && ga(spark, 'data-mono') === mv && (st === 'streaming') === ha(trig, 'data-ag-cs-spark-streaming')) {
            if (st === 'done' && !isLast) doneSparkCache.set(trig, cacheSig); else doneSparkCache.delete(trig);
            continue;
          }
          if (st !== 'done') doneSparkCache.delete(trig);
          pending.push({ trig, brand, st, isLast, cacheSig });
        }
      }
      const runApply = (it) => {
        applySingleSpark(it.trig, it.brand, it.st);
        if (it.st === 'done' && !it.isLast) doneSparkCache.set(it.trig, it.cacheSig);
      };
      if (pending.length <= 16 || typeof requestAnimationFrame !== 'function') {
        for (let i = 0; i < pending.length; i++) runApply(pending[i]);
      } else {
        const syncStart = pending.length - 12;
        for (let i = syncStart; i < pending.length; i++) runApply(pending[i]);
        sparkQueue = pending.slice(0, syncStart);
        if (!hydrateRaf) hydrateRaf = rAF(stepHydration);
      }
    };

    const clearWorkedForAutoUnfoldAttrs = () => {
      const d = docOf();
      if (!d) return;
      for (const el of qsa(d, '[data-ag-cs-auto-unfolded]')) ra(el, A_AU);
      for (const el of qsa(d, '[data-ag-cs-outer-open]')) ra(el, A_OO);
    };

    const clickClosed = (cb) => {
      if (!cb || !isConn(cb) || ga(cb, A_EXP) !== 'false' || !isF(cb.click)) return false;
      T(() => cb.click());
      return true;
    };
    const pumpUnfoldQueue = () => {
      unfoldRaf = 0;
      if (isDestroyed() || !unfoldQueue.length) { unfoldQueue = []; return; }
      for (let b = 2; unfoldQueue.length && b > 0;) if (clickClosed(unfoldQueue.pop())) b--;
      if (unfoldQueue.length && !isDestroyed()) unfoldRaf = rAF(pumpUnfoldQueue);
    };
    const processOuterWf = (btn, pendingClicks) => {
      if (!isConn(btn)) return;
      const expanded = ga(btn, A_EXP) === 'true';
      let scope = btn.nextElementSibling;
      if (!scope) { let sib = btn.nextSibling; while (sib && sib.nodeType && sib.nodeType !== 1) sib = sib.nextSibling; scope = sib || null; }
      if (!scope) scope = peOf(btn);
      const innerBtns = qsa(scope, '[data-testid="tool-group-collapsible"]');
      if (expanded) {
        setAttrIfChanged(btn, A_OO, '1');
        for (const cb of innerBtns) if (cb !== btn && ga(cb, A_AU) !== '1') {
          sa(cb, A_AU, '1');
          if (ga(cb, A_EXP) === 'false' && isF(cb.click)) pendingClicks.push(cb);
        }
      } else if (ga(btn, A_OO) === '1') {
        ra(btn, A_OO);
        for (const cb of innerBtns) ra(cb, A_AU);
        const p = peOf(btn);
        if (p && p !== scope) for (const el of qsa(p, '[data-ag-cs-auto-unfolded]')) ra(el, A_AU);
      }
    };
    const flushPendingUnfoldClicks = (pendingClicks) => {
      if (!pendingClicks.length) return;
      if (pendingClicks.length <= 2 || typeof requestAnimationFrame !== 'function') { for (const cb of pendingClicks) clickClosed(cb); return; }
      for (let k = 0; k < 2 && pendingClicks.length; k++) clickClosed(pendingClicks.pop());
      unfoldQueue.push(...pendingClicks);
      if (!unfoldRaf && unfoldQueue.length) unfoldRaf = rAF(pumpUnfoldQueue);
    };

    const syncWorkedForAutoUnfold = (dirtyTargets = null) => {
      const d = docOf();
      if (isDestroyed()) { clearWorkedForAutoUnfoldAttrs(); return; }
      if (!d) return;
      const pendingClicks = [];
      if (dirtyTargets && dirtyTargets.size > 0) {
        const outers = new Set();
        for (const node of dirtyTargets) {
          if (!isConn(node)) continue;
          if (ga(node, A_TID) === 'worked-for-collapsible') { outers.add(node); continue; }
          const prev = node.previousElementSibling;
          if (prev && ga(prev, A_TID) === 'worked-for-collapsible') outers.add(prev);
          for (const b of qsa(node, S_WF)) outers.add(b);
          for (let cur = peOf(node); cur && cur !== d.body; cur = peOf(cur)) {
            const sib = cur.previousElementSibling;
            if (sib && ga(sib, A_TID) === 'worked-for-collapsible') { outers.add(sib); break; }
          }
        }
        for (const btn of outers) processOuterWf(btn, pendingClicks);
        return flushPendingUnfoldClicks(pendingClicks);
      }
      for (const btn of qsa(d, S_WF)) processOuterWf(btn, pendingClicks);
      flushPendingUnfoldClicks(pendingClicks);
    };

    const scheduleWorkedForClickSync = () => {
      if (isDestroyed()) return;
      if (wfClickTimer) CT(wfClickTimer);
      wfClickTimer = ST(() => { wfClickTimer = 0; if (!isDestroyed()) syncWorkedForAutoUnfold(); }, 28);
    };

    function findFormalConvViews() {
      const d = docOf(), out = [];
      for (const cv of qsa(d, S_CV)) {
        if (closestOf(cv, S_SUB) || closestOf(cv, '.agy-home') || qs(cv, '.agy-home') || cv.hidden === true || cv.style?.display === 'none') continue;
        out.push(cv);
      }
      return out;
    }

    function findFormalConvView() {
      const d = docOf(), views = findFormalConvViews();
      if (views.length <= 1) return views[0] || null;
      const actCv = closestOf(d?.activeElement, S_CV);
      return actCv && views.includes(actCv) ? actCv : views[0];
    }

    const sampleHomeComposerRect = () => {
      const home = qs(docOf(), '.agy-home');
      if (!home) return null;
      const r = rectOf(qs(home, S_IB) || qs(home, '.surface-composer-card'));
      if (r && r.width > 0 && r.height > 0) lastHomeRect = { left: r.left, top: r.top, width: r.width, height: r.height };
      return lastHomeRect;
    };

    const triggerHomeLiftoffRippleBurst = () => {
      const home = qs(docOf(), '.agy-home');
      if (!home) return;
      const r = sampleHomeComposerRect();
      if (isMotionUltra() && rippleCtl) rippleCtl.triggerLiftoffBurst(r);
    };

    const clrA = (el, a, ms) => scheduleTransient(() => { if (isConn(el)) ra(el, a); }, ms);
    const markLiftoffBubble = (conv) => {
      const bubble = qs(conv, '[data-testid="user-message-bubble"]');
      if (!bubble) return false;
      sa(bubble, 'data-ag-cs-liftoff-bubble', '1');
      clrA(bubble, 'data-ag-cs-liftoff-bubble', 500);
      return true;
    };

    const triggerHeroALiftoff = (formalConv, measuredRect = null) => {
      const d = docOf();
      if (!isMotionUltra() || !formalConv || !d) return;
      const now = nowOf();
      for (const n of qsa(d, '.ag-cs-liftoff-veil')) n.remove();
      const veil = mkOv(d, 'ag-cs-liftoff-veil');
      const r = lastHomeRect;
      setProp(veil, '--ag-lift-x', r && r.width > 0 ? `${M.round(r.left + r.width / 2)}px` : '50%');
      setProp(veil, '--ag-lift-y', r && r.height > 0 ? `${M.round(r.top + r.height / 2)}px` : '58%');
      const ring = d.createElement('div');
      ring.className = 'ag-cs-liftoff-ring';
      veil.appendChild(ring);
      portalOf(d)?.appendChild(veil);
      scheduleTransient(() => veil.remove(), 540);

      const inputBox = qs(formalConv, S_IB) || qs(d, S_IB);
      if (inputBox && isF(motionEngine?.spring)) {
        const nr = measuredRect || rectOf(inputBox), rawDelta = r && nr ? M.round(r.top - nr.top) : -160;
        const hostFade = !!(closestOf(inputBox, '.animate-fade-in, .no-transitions') || closestOf(formalConv, '.no-transitions') || clHas(formalConv, 'no-transitions'));
        const dy = hostFade ? M.max(-24, M.min(0, rawDelta === 0 ? -10 : M.round(rawDelta * 0.08))) : M.max(-420, M.min(-24, rawDelta === 0 ? -140 : rawDelta));
        T(() => motionEngine.spring(inputBox, [{ transform: `translateY(${dy}px) scale(${hostFade ? 0.996 : 0.985})` }, { transform: 'translateY(0) scale(1)' }], { durationMs: hostFade ? 220 : 480, stiffness: hostFade ? 360 : 310, damping: hostFade ? 32 : 28, slot: 'liftoff-dock' }));
      }
      liftoffBubbleUntil = markLiftoffBubble(formalConv) ? 0 : now + 900;
      convAuraCtl?.triggerLiftoffEbb?.(now);
    };

    const triggerHeroBHomeReturn = () => {
      if (!isMotionUltra()) return;
      const home = qs(docOf(), '.agy-home');
      if (!home) return;
      rippleCtl?.triggerTideSwell?.();
      if (isF(motionEngine?.stagger)) {
        const items = [qs(home, '[data-testid="home-greeting"]'), qs(home, '.ag-cs-home-panel'), qs(home, S_IB)].filter(Boolean);
        if (items.length) T(() => motionEngine.stagger(items, [{ transform: 'translateY(8px)' }, { transform: 'translateY(0px)' }], { durationMs: 200, delayStep: 20, stepMs: 20, stiffness: 360, damping: 32, slot: 'home-return' }));
      }
    };

    const setAttrSafe = (el, k, v) => (isF(setAttrIfChanged) ? setAttrIfChanged(el, k, v) : ga(el, k) !== v && sa(el, k, v));

    const getSidebarRowCid = (row) => String(ga(row, 'data-cascade-id') || ga(qs(row, 'a[href]'), 'href') || ga(row, 'data-conversation-id') || '').trim();

const isStopBtn = (b) => {
if (!b || b.hidden === true || ga(b, 'aria-hidden') === 'true' || ga(b, 'aria-haspopup') || ga(b, 'role') === 'checkbox') return false;
const tid = String(ga(b, A_TID) || '').trim(), lbl = String(ga(b, 'aria-label') || ga(b, 'title') || '').trim();
if (NON_STOP_RE.test(tid + ' ' + lbl)) return false;
return !!((tid && (STOP_TID_RE.test(tid) || STOP_CAMEL_RE.test(tid))) || (lbl && STOP_LABEL_RE.test(lbl)) || qs(b, '.lucide-square,.lucide-circle-stop'));
};
const isSidebarRowRunning = (row) => {
if (!row) return false;
if (qs(row, '[data-testid="status-loading-spinner"]')) return true;
if (isF(row.getElementsByTagName)) {
for (const b of row.getElementsByTagName('button')) if (isStopBtn(b)) return true;
for (const b of qsa(row, '[role="button"]')) if (isStopBtn(b)) return true;
return false;
}
for (const b of qsa(row, 'button, [role="button"]')) if (isStopBtn(b)) return true;
return false;
};

    const pruneRunningCidMap = (now) => {
      for (const [k, ts] of runningCidMap) {
        if (now - ts > SIDEBAR_RUN_HOLD_MS) runningCidMap.delete(k);
      }
      if (runningCidMap.size > 256) {
        let drop = runningCidMap.size - 256;
        for (const k of runningCidMap.keys()) {
          runningCidMap.delete(k);
          if (--drop <= 0) break;
        }
      }
    };

    const scheduleRunningHoldExpiry = (delayMs) => {
      if (isDestroyed() || runHoldTimer) return;
      const wait = M.max(24, M.min(SIDEBAR_RUN_HOLD_MS + 40, M.ceil(delayMs) + 16));
      runHoldTimer = ST(() => {
        runHoldTimer = 0;
        if (isDestroyed()) return;
        const d = docOf();
        if (!d || ga(d.documentElement, A_SB) === 'off') return;
        const now = nowOf();
        pruneRunningCidMap(now);
        let minRem = Infinity;
        guardMut(() => {
          for (const r of qsa(d, S_SBR)) {
            const cid = getSidebarRowCid(r);
            if (isSidebarRowRunning(r)) { runningRowMap.set(r, now); if (cid) runningCidMap.set(cid, now); setAttrSafe(r, A_RR, '1'); continue; }
            const lastAt = M.max(cid ? runningCidMap.get(cid) || 0 : 0, runningRowMap.get(r) || 0);
            const rem = lastAt > 0 ? SIDEBAR_RUN_HOLD_MS - (now - lastAt) : -1;
            if (rem > 0) { if (rem < minRem) minRem = rem; setAttrSafe(r, A_RR, '1'); }
            else { if (cid && runningCidMap.get(cid) === lastAt) runningCidMap.delete(cid); runningRowMap.delete(r); if (ha(r, A_RR)) ra(r, A_RR); }
          }
        });
        if (isFin(minRem)) scheduleRunningHoldExpiry(minRem);
      }, wait);
    };

    const resolveSidebarRowRunning = (row, domRunning, now) => {
      const cid = getSidebarRowCid(row);
      if (domRunning) { runningRowMap.set(row, now); if (cid) runningCidMap.set(cid, now); return true; }
      const lastAt = M.max(cid ? runningCidMap.get(cid) || 0 : 0, runningRowMap.get(row) || 0);
      if (lastAt > 0) {
        const el = now - lastAt;
        if (el >= 0 && el <= SIDEBAR_RUN_HOLD_MS) { scheduleRunningHoldExpiry(SIDEBAR_RUN_HOLD_MS - el); return true; }
        if (cid && runningCidMap.get(cid) === lastAt) runningCidMap.delete(cid);
        runningRowMap.delete(row);
      }
      return false;
    };

    const lockSidebarRowRunningOnPointerDown = (row) => {
      const d = docOf();
      if (!row || !d || ga(d.documentElement, A_SB) === 'off') return false;
      const now = nowOf(), cid = getSidebarRowCid(row);
      const heldAt = M.max(cid ? runningCidMap.get(cid) || 0 : 0, runningRowMap.get(row) || 0);
      if (!(ha(row, A_RR) || isSidebarRowRunning(row) || (heldAt > 0 && now - heldAt <= SIDEBAR_RUN_HOLD_MS))) return false;
      runningRowMap.set(row, now);
      if (cid) runningCidMap.set(cid, now);
      guardMut(() => setAttrSafe(row, A_RR, '1'));
      scheduleRunningHoldExpiry(SIDEBAR_RUN_HOLD_MS);
      return true;
    };

    const stampSidebarRowRunningImmediate = (row) => {
      const d = docOf();
      if (!row || !d || ga(d.documentElement, A_SB) === 'off') return false;
      const run = resolveSidebarRowRunning(row, isSidebarRowRunning(row), nowOf());
      if (run) guardMut(() => setAttrSafe(row, A_RR, '1'));
      return run;
    };

const measureSidebarSelectionSnapshot = () => {
const rows = qsa(docOf(), S_SBR);
if (!rows.length) return { e: true };
const now = nowOf();
pruneRunningCidMap(now);
let selIdx = -1, selRow = null, selRun = false, batchRun = null;
const states = [], listP = rows.length > 1 ? peOf(rows[0]) : null;
if (listP && isF(listP.getElementsByTagName) && AF(rows).every((r) => peOf(r) === listP)) {
batchRun = new Set();
const mr = (n) => { const r = closestOf(n, S_SBR); if (r) batchRun.add(r); };
for (const sp of qsa(listP, '[data-testid="status-loading-spinner"]')) mr(sp);
for (const b of listP.getElementsByTagName('button')) if (isStopBtn(b)) mr(b);
for (const rb of qsa(listP, '[role="button"]')) if (isStopBtn(rb)) mr(rb);
}
for (let i = 0; i < rows.length; i++) {
const r = rows[i], run = resolveSidebarRowRunning(r, batchRun ? batchRun.has(r) : isSidebarRowRunning(r), now);
if (selIdx < 0 && ga(r, 'data-selected') === 'true') { selIdx = i; selRow = r; selRun = run; }
states.push([r, run]);
}
      if (!selRow) return { e: false, i: -1, cid: '', r: null, rn: false, s: null, l: null, t: 0, st: states };
      const curCid = getSidebarRowCid(selRow);
      if (sbInit && sbRect && (curCid && sbCid ? curCid === sbCid : selIdx === sbIndex)) return { e: false, i: selIdx, cid: curCid, r: selRow, rn: selRun, s: sbRect, st: states };
      const list = peOf(selRow);
      if (getBus()?.isSkipped?.(selRow)) return { e: false, i: selIdx, cid: curCid, r: selRow, rn: selRun, s: sbRect, st: states };
      const rr = rectOf(selRow), lr = rectOf(list), stTop = list ? list.scrollTop || 0 : 0;
      const snap = rr ? { left: rr.left, top: rr.top, width: rr.width, height: rr.height, ry: lr ? rr.top - lr.top + stTop : rr.top, rx: lr ? rr.left - lr.left : rr.left } : null;
      return { e: false, i: selIdx, cid: curCid, r: selRow, rn: selRun, s: snap, l: lr, t: stTop, st: states };
    };

    const rstSb = () => { sbInit = sbRunning = false; sbIndex = -1; sbCid = ''; sbRect = null; };
    const syncSidebarSelectionGlide = (snap) => {
      const d = docOf();
      if (!snap || !d) return;
      if (ga(d.documentElement, A_SB) === 'off') {
        for (const n of qsa(d, '.ag-cs-sidebar-glide-pill')) n.remove();
        if (snap.st) for (const [row] of snap.st) if (ha(row, A_RR)) ra(row, A_RR);
        if (runHoldTimer) { CT(runHoldTimer); runHoldTimer = 0; }
        runningCidMap.clear();
        return rstSb();
      }
      if (snap.st) for (const [row, run] of snap.st) { if (run) setAttrSafe(row, A_RR, '1'); else if (ha(row, A_RR)) ra(row, A_RR); }
      if (snap.e) return rstSb();
      const { i: selIdx, cid: curCid, r: selRow, rn: selRun, s: curSnap, l: listRect, t: scrollTop } = snap;
      if (!selRow) return;
      const targetRun = !!(selRun || ha(selRow, A_RR));
      if (!sbInit) { sbInit = true; sbIndex = selIdx; sbCid = curCid; sbRect = curSnap; sbRunning = targetRun; return; }
      const sessionChanged = curCid && sbCid ? curCid !== sbCid : selIdx !== sbIndex;
      if (sbIndex >= 0 && selIdx >= 0 && sessionChanged && sbRect && curSnap && !(suppressEntryMotionUntil > nowOf())) {
        const fromRect = listRect ? { left: listRect.left + sbRect.rx, top: listRect.top + sbRect.ry - scrollTop, width: sbRect.width, height: sbRect.height } : sbRect;
        if (isMotionStandardOrUltra()) {
          for (const n of qsa(d, '.ag-cs-sidebar-glide-pill')) n.remove();
          const pill = mkOv(d, 'ag-cs-sidebar-glide-pill');
          if (targetRun) sa(pill, 'data-ag-cs-glide-running', '1'); else if (sbRunning) sa(pill, 'data-ag-cs-glide-from-running', '1');
          setProp(pill, 'position', 'fixed'); setProp(pill, 'z-index', '38'); setProp(pill, 'pointer-events', 'none');
          for (const k of ['left', 'top', 'width', 'height']) setProp(pill, k, `${M.round(curSnap[k])}px`);
          portalOf(d)?.appendChild(pill);
          T(() => motionEngine?.glideIndicator?.(pill, fromRect, curSnap, { durationMs: 240, stiffness: 390, damping: 32, mass: 0.9 }));
          scheduleTransient(() => pill.remove(), 260);
        }
        if (isMotionUltra()) {
          const dir = selIdx < sbIndex ? 'down' : 'up';
          const vps = AF(qsa(d, '[data-testid="autoscroll-viewport"]')).filter((vp) => !closestOf(vp, S_SUB));
          const matchedVp = curCid ? vps.find((vp) => ga(closestOf(vp, '[data-cascade-id]'), 'data-cascade-id') === curCid) : null;
          for (const vp of matchedVp ? [matchedVp] : vps) {
            sa(vp, 'data-ag-cs-stage-glide', dir);
            const kids = vp.children ? AF(vp.children) : [], glideKids = kids.slice(M.max(0, kids.length - 3));
            for (const ch of glideKids) sa(ch, 'data-ag-cs-glide-item', dir);
            scheduleTransient(() => {
              if (isConn(vp) && ga(vp, 'data-ag-cs-stage-glide') === dir) ra(vp, 'data-ag-cs-stage-glide');
              for (const ch of glideKids) if (isConn(ch) && ga(ch, 'data-ag-cs-glide-item') === dir) ra(ch, 'data-ag-cs-glide-item');
            }, 220);
          }
        }
      }
      sbIndex = selIdx; sbCid = curCid; sbRect = curSnap; sbRunning = targetRun;
    };

    const applyCaustic = (el) => { if (el && isMotionUltra()) { sa(el, 'data-ag-cs-caustic', '1'); clrA(el, 'data-ag-cs-caustic', 920); } };

    const getBus = () => G.__agDomBus || G.__agPrismDomBus || (typeof window !== 'undefined' && (window.__agDomBus || window.__agPrismDomBus)) || null;
    const measureVisibleChangedHeaders = () => {
      const out = [], bus = getBus();
      const vh = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 1080;
      for (const hdr of qsa(docOf(), '[data-testid="changed-files-card-header"]')) {
        if (seenHeaders.has(hdr) || bus?.isSkipped?.(hdr)) continue;
        const r = rectOf(hdr);
        if (!r || r.height <= 0 || (r.bottom > 0 && r.top < vh)) out.push(hdr);
      }
      return out;
    };

    const syncHeaderOpenStates = (scope = null) => {
      const root = scope || docOf();
      if (!root) return;
      for (const hdr of qsa(root, '[data-testid="changed-files-card-header"]')) {
        const next = hdr.nextElementSibling;
        tA(hdr, 'data-ag-cs-hdr-open', next && tagOf(next) === 'DIV');
      }
    };

    const applyCausticHeaders = (list) => {
      let sawNew = false;
      for (const hdr of list) {
        if (seenHeaders.has(hdr)) continue;
        seenHeaders.add(hdr); sawNew = true;
        if (isMotionUltra()) applyCaustic(hdr);
      }
      if (sawNew) notifyMascot('files-changed');
    };

    const syncHeroCCaustics = (measuredHeaders) => {
      const d = docOf(), now = nowOf(), bus = getBus();
      syncHeaderOpenStates(d);
      if (measuredHeaders) applyCausticHeaders(measuredHeaders);
      else if (bus?.measure && bus?.mutate) {
        let mHdrs = null;
        bus.measure('sc:caustics-r', () => { mHdrs = measureVisibleChangedHeaders(); });
        bus.mutate('sc:caustics-w', () => { if (!isDestroyed() && mHdrs?.length) guardMut(() => applyCausticHeaders(mHdrs)); });
      } else applyCausticHeaders(measureVisibleChangedHeaders());

      const PRS = '[data-testid="input-cancel-button"],[data-testid="stop-button"],[data-testid="cancel-button"],[data-testid="agent-loading"],[data-testid="thinking-collapsible-trigger"][data-op-thought-state="streaming"]';
      const vs = findFormalConvViews();
      let pCh = false;
      if (vs.length > 1) {
        for (const cv of vs) {
          const rP = !!(qs(cv, PRS)), ps = paneRunState.get(cv);
          if (!ps) paneRunState.set(cv, { wasRunning: rP, startAt: rP ? now : 0 });
          else if (rP && !ps.wasRunning) { ps.wasRunning = true; ps.startAt = now; }
          else if (!rP && ps.wasRunning) {
            ps.wasRunning = false;
            const dur = ps.startAt > 0 ? now - ps.startAt : 0;
            ps.startAt = 0;
            if (dur >= 6000 && isMotionUltra()) {
              const c = qs(cv, '[data-testid="agent-input-box"] .surface-composer-card');
              if (c && !closestOf(c, S_SUB)) { applyCaustic(c); pCh = true; }
            }
          }
        }
      }
      const rNow = isConvRunning(true);
      if (!runInit) { runInit = true; wasRunning = rNow; runStartAt = rNow ? now : 0; }
      else if (rNow && !wasRunning) { wasRunning = true; runStartAt = now; }
      else if (!rNow && wasRunning) {
        wasRunning = false;
        const el = runStartAt > 0 ? now - runStartAt : 0;
        runStartAt = 0;
        if (convAuraCtl?.getInstance?.()?.phase === 'error-halted' || qs(d, '[data-testid="conversation-view"] [data-testid="agent-error-banner"], [data-testid="conversation-view"] [data-testid="error-message"]')) {
          convAuraCtl?.triggerErrorHalted?.(now);
          notifyMascot('streamDone', { error: true, durationMs: el });
        } else {
          if (!pCh && el >= 6000 && isMotionUltra()) for (const c of qsa(d, '[data-testid="agent-input-box"] .surface-composer-card')) if (!closestOf(c, S_SUB)) applyCaustic(c);
          if (el >= 15000) { convAuraCtl?.triggerLongTaskComplete?.(now); notifyMascot('aura-complete', { durationMs: el }); }
          else notifyMascot('complete', { durationMs: el });
          if (qs(d, '[data-ag-prism-pulse-bar][data-pv-warn="1"], #ag-prism-pulse-bar[data-pv-warn="1"]') && now - lastVialHighNotifyAt >= 600000) {
            lastVialHighNotifyAt = now;
            notifyMascot('vial-high', { fraction: 0.8 });
          }
        }
      }
    };

    const triggerHeroDFiberPulse = (card, modelBtn, brand) => {
      if (!card || !isMotionUltra()) return;
      if (fiberTimer) { transientTimers.delete(fiberTimer); fiberTimer = cT(fiberTimer); }
      sa(card, 'data-ag-cs-fiber-camp', brand === 'antigravity' || brand === 'claude' || brand === 'openai' ? brand : 'gemini');
      fiberTimer = scheduleTransient(() => { fiberTimer = 0; if (isConn(card)) ra(card, 'data-ag-cs-fiber-camp'); }, 480);
      const glyph = qs(modelBtn, '.ag-cs-model-glyph');
      if (glyph && isF(motionEngine?.spring)) T(() => motionEngine.spring(glyph, [{ transform: 'scale(0.84) rotate(-8deg)' }, { transform: 'scale(1.12) rotate(3deg)' }, { transform: 'scale(1) rotate(0deg)' }], { stiffness: 420, damping: 22, slot: 'fiber-focus' }));
    };

    const triggerHeroESonar = (navTurn) => {
      if (!navTurn || !isMotionUltra()) return;
      const conv = closestOf(navTurn, S_CV) || findFormalConvView();
      if (!conv) return;
      let turns = qsa(conv, '[data-testid="user-input-step"]');
      if (!turns.length) turns = qsa(conv, '[data-testid="conversation-turn"]');
      if (!turns.length) turns = qsa(conv, '[data-testid="user-message-bubble"]');
      if (!turns.length) return;
      let idx = -1;
      const rawAttr = ga(navTurn, 'data-turn-index') ?? ga(navTurn, 'data-index');
      if (rawAttr != null && /^\d+$/.test(String(rawAttr).trim())) idx = parseInt(String(rawAttr).trim(), 10);
      else if (ga(navTurn, A_TID) === 'conversation-navigator-group') idx = 0;
      else {
        const navRoot = closestOf(navTurn, '[data-testid="conversation-navigator"]') || peOf(navTurn);
        if (navRoot) {
          const sibs = AF(qsa(navRoot, '[data-testid="conversation-navigator-turn"]')), rel = sibs.indexOf(navTurn);
          if (rel >= 0) idx = M.min(turns.length - 1, M.max(0, turns.length - sibs.length) + rel);
        }
      }
      const target = idx >= 0 && idx < turns.length ? turns[idx] : null;
      if (!target) return;
      sa(target, 'data-ag-cs-sonar', '1');
      clrA(target, 'data-ag-cs-sonar', 720);
    };

    const syncHeroRouteChoreography = (measured) => {
      const d = docOf(), inHome = measured ? measured.inHome : !!(qs(d, '.agy-home'));
      const formalConv = measured ? measured.formalConv : !inHome ? findFormalConvView() : null, inFormalConv = !!formalConv;
      if (inHome) { const sheet = closestOf(qs(d, '.agy-home'), '.agy-sheet'); if (sheet) setAttrIfChanged(sheet, 'data-ag-cs-home-sheet', '1'); }
      if (!inHome) for (const cv of findFormalConvViews()) {
        const seat = peOf(cv), vpP = peOf(qs(cv, '[data-testid="autoscroll-viewport"]'));
        if (seat && tagOf(seat) === 'DIV') setAttrIfChanged(seat, 'data-ag-cs-conv-seat', '1');
        if (vpP && vpP !== cv) setAttrIfChanged(vpP, 'data-ag-cs-vp-wrap', '1');
      }
      if (inHome && !measured?.homeComposerSampled) sampleHomeComposerRect();
      if (!heroState.routeInitialized) { heroState.routeInitialized = true; heroState.wasInHome = inHome; heroState.wasInFormalConv = inFormalConv; }
      else {
        if (!(suppressEntryMotionUntil > nowOf())) {
          if (heroState.wasInHome && !inHome && inFormalConv) triggerHeroALiftoff(formalConv, measured?.convInputRect || null);
          else if (heroState.wasInFormalConv && !heroState.wasInHome && inHome) triggerHeroBHomeReturn();
        } else liftoffBubbleUntil = 0;
        heroState.wasInHome = inHome; heroState.wasInFormalConv = inFormalConv;
      }
      if (liftoffBubbleUntil > 0 && formalConv && (nowOf() > liftoffBubbleUntil || markLiftoffBubble(formalConv))) liftoffBubbleUntil = 0;
      if (measured?.sidebarSnap) syncSidebarSelectionGlide(measured.sidebarSnap);
      if (!measured || measured.checkCaustics !== false) syncHeroCCaustics(measured?.visibleChangedHeaders);
    };

    const isBlockCode = (el, stopAt) => {
      if (!isEl(el)) return false;
      const t = tagOf(el);
      if (t === 'PRE' || clHas(el, 'code-block') || clHas(el, 'code-line')) return true;
      if (t === 'CODE') {
        let p = peOf(el);
        while (p && p !== stopAt) {
          if (tagOf(p) === 'PRE' || clHas(p, 'code-block')) return true;
          p = peOf(p);
        }
      }
      return false;
    };

    const insideCodeOrTable = (node, stopAt) => {
      let cur = isEl(node) ? node : peOf(node);
      while (cur && cur !== stopAt) {
        if (TABLE_TAGS.has(tagOf(cur)) || isBlockCode(cur, stopAt)) return cur;
        cur = peOf(cur);
      }
      return null;
    };

    const findRowAnc = (node, stopAt) => {
      let cur = isEl(node) ? node : peOf(node);
      while (cur && cur !== stopAt) {
        if (tagOf(cur) === 'TR') return cur;
        cur = peOf(cur);
      }
      return null;
    };

    const flushAllStreamArtifacts = (immediate = true) => {
      scannedNodes = new WeakSet(); seenBlocks = new WeakSet();
      const force = immediate || !canStreamMotion() || isDestroyed();
      if (force) { clearHighlightFade(); if (sweepTimer) { CT(sweepTimer); sweepTimer = 0; } }
      guardMut(() => {
        const d = docOf();
        if (force) {
          for (const [el, map] of expirableClasses.entries()) for (const cls of map.keys()) clRm(el, cls);
          expirableClasses.clear();
          if (d) for (const cls of ['ag-cs-stream-chunk', 'ag-cs-thought-chunk', 'ag-cs-code-scan']) for (const el of qsa(d, '.' + cls)) clRm(el, cls);
        }
        if (!d) return;
        for (const el of qsa(d, '[data-ag-cs-thought-streaming]')) ra(el, A_TS);
        if (!isMotionUltra()) {
          for (const el of qsa(d, '.ag-cs-liftoff-veil')) el.remove();
          for (const s of 'liftoff-bubble|caustic|fiber-camp|stage-glide|glide-item|sonar'.split('|')) for (const el of qsa(d, `[data-ag-cs-${s}]`)) ra(el, 'data-ag-cs-' + s);
        }
        if (!isMotionStandardOrUltra()) for (const el of qsa(d, '.ag-cs-sidebar-glide-pill')) el.remove();
      });
    };

    const PROSE_SEL = '[data-testid="planner-response-text"],[data-testid="agent-response"] [data-markdown-root]';

    const findStreamingThoughtBody = (node) => {
      const body = docOf()?.body;
      let cur = isEl(node) ? node : peOf(node);
      while (cur && cur !== body) {
        if (ga(cur, A_TS) === '1') return cur;
        const tid = ga(cur, A_TID);
        if (tid === 'planner-response-text' || tid === 'agent-response' || tid === 'background-task-command' || tid === 'tool-group-collapsible' || tid === 'conversation-view' || tid === 'autoscroll-viewport') return null;
        const prev = cur.previousElementSibling;
        if (prev && ga(prev, A_TID) === 'thinking-collapsible-trigger' && ga(prev, A_EXP) === 'true') return cur;
        cur = peOf(cur);
      }
      return null;
    };

    const markStreamClass = (el, cls, dur = 300) => {
      if (!el?.[K_CL] || clHas(el, cls)) return false;
      guardMut(() => el[K_CL].add(cls));
      let map = expirableClasses.get(el);
      if (!map) {
        map = new Map();
        expirableClasses.set(el, map);
      }
      map.set(cls, Date.now() + dur);
      if (!sweepTimer) sweepTimer = ST(flushExpiredClasses, dur);
      return true;
    };

    const fadeLeafTexts = (node, now, max = 4) => {
      if (!node || isThoughtIsolatedNode(node)) return;
      let c = 0;
      const walk = (cur) => {
        if (!cur || c >= max || isThoughtIsolatedNode(cur)) return;
        if (cur.nodeType === 3) {
          const s = cur.data ?? cur.nodeValue ?? '';
          textLenMap.set(cur, s.length);
          if (s.length > 0) {
            enqueueFadeRange(cur, 0, s.length, now);
            c++;
          }
          return;
        }
        if (!isEl(cur) || !cur.childNodes) return;
        for (let i = 0; i < cur.childNodes.length && c < max; i++) walk(cur.childNodes[i]);
      };
      walk(node);
    };

    const onStreamMutations = (mutations) => {
      if (isDestroyed() || streamMutating || !canStreamMotion()) return;
      const now = nowOf();
      let newBlocks = 0;

      for (const m of mutations) {
        if (!m || isThoughtMutationRecord(m)) continue;
        const target = m.target;
        if (!target || isThoughtIsolatedNode(target)) continue;
        const baseEl = isEl(target) ? target : peOf(target);
        if (
          !baseEl ||
          getBus()?.isSkipped?.(baseEl) ||
          closestOf(
            baseEl,
            '.ag-prism-thought-overlay, .ag-cs-smooth-caret, .ag-cs-crab, .ag-cs-conv-aura-host, [data-testid="agent-input-box"], script, style'
          )
        ) {
          continue;
        }

        if (m.type === 'characterData') {
          if (target.nodeType !== 3) continue;
          const nLen = (target.data ?? target.nodeValue ?? '').length;
          const pLen = textLenMap.get(target);
          textLenMap.set(target, nLen);
          if (pLen !== undefined ? nLen <= pLen : nLen <= 0 || nLen > 28) continue;
          const tb = findStreamingThoughtBody(baseEl);
          if (tb) {
            if (isManagedThoughtPanel(tb)) continue;
          } else if (!closestOf(baseEl, PROSE_SEL)) continue;
          if (pLen !== undefined) enqueueFadeRange(target, pLen, nLen, now);
          else enqueueFadeRange(target, 0, nLen, now);
          continue;
        }

        if (m.type !== 'childList' || !m.addedNodes?.length) continue;

        const inAnimBlock = !!(closestOf(baseEl, '.ag-cs-stream-chunk, .ag-cs-thought-chunk'));
        const thoughtBody = findStreamingThoughtBody(target);
        const eachAdd = (fn) => { for (const a of m.addedNodes) { if (isThoughtIsolatedNode(a)) continue; if (a.nodeType === 3) fadeLeafTexts(a, now, 1); else if (isEl(a)) fn(a); } };
        if (thoughtBody) {
          if (isManagedThoughtPanel(thoughtBody)) continue;
          eachAdd((a) => {
            if (inAnimBlock || INLINE_TAGS.has(tagOf(a))) fadeLeafTexts(a, now, 4);
            else if (!seenBlocks.has(a) && newBlocks < 4) { seenBlocks.add(a); newBlocks++; snapTextLens(a, 12); markStreamClass(a, 'ag-cs-thought-chunk', 290); }
          });
          continue;
        }
        const proseRoot = closestOf(baseEl, PROSE_SEL);
        if (!proseRoot) continue;
        const markCode = (el, lim) => { scannedNodes.add(el); lastCodeAt = now; snapTextLens(el, lim); markStreamClass(el, 'ag-cs-code-scan', 240); };
        const codeCtx = insideCodeOrTable(target, proseRoot);
        if (codeCtx) {
          if (TABLE_TAGS.has(tagOf(codeCtx))) {
            eachAdd((a) => {
              const tr = tagOf(a) === 'TR' ? a : findRowAnc(a, proseRoot) || findRowAnc(codeCtx, proseRoot);
              if (tr && !scannedNodes.has(tr) && now - lastCodeAt >= STREAM_BATCH_MS) markCode(tr, 12);
              else fadeLeafTexts(a, now, 3);
            });
          } else eachAdd((a) => {
            if (tagOf(a) === 'PRE' || clHas(a, 'code-block')) { if (!scannedNodes.has(a)) markCode(a, 16); return; }
            const ln = clHas(a, 'code-line') ? a : closestOf(a, '.code-line') || a;
            if (ln && ln !== proseRoot && tagOf(ln) !== 'PRE' && !clHas(ln, 'code-block') && !scannedNodes.has(ln) && now - lastCodeAt >= STREAM_BATCH_MS) markCode(ln, 8);
            else fadeLeafTexts(a, now, 3);
          });
          continue;
        }
        eachAdd((a) => {
          const tag = tagOf(a);
          if (tag === 'PRE' || tag === 'TABLE' || clHas(a, 'code-block') || clHas(a, 'md-table-host') || clHas(a, 'md-table-frame') || qs(a, 'pre, table, .code-block, .md-table-frame')) {
            if (!scannedNodes.has(a) && now - lastCodeAt >= STREAM_BATCH_MS) markCode(a, 16);
          } else if (inAnimBlock || (INLINE_TAGS.has(tag) && baseEl !== proseRoot)) fadeLeafTexts(a, now, 4);
          else if (!seenBlocks.has(a) && newBlocks < 4) { seenBlocks.add(a); newBlocks++; snapTextLens(a, 12); markStreamClass(a, 'ag-cs-stream-chunk', 310); }
          else fadeLeafTexts(a, now, 4);
        });
}
};
const syncStreamActiveAttr = (on) => {
const h = docOf()?.documentElement;
if (h && isF(on ? h.setAttribute : h.removeAttribute)) tA(h, 'data-ag-cs-stream-active', on);
T(() => getBus()?.setStreaming?.(on));
};
const syncDualStreamEngine = () => {
const running = isConvRunning(true), views = running ? findFormalConvViews() : [];
syncStreamActiveAttr(running && views.length > 0);
if (!(canStreamMotion() && running) || !views.length) {
if (streamObs) { T(() => streamObs.disconnect()); streamRoots.clear(); }
getBus()?.cancelGroup?.('conv:stream');
return flushAllStreamArtifacts(!canStreamMotion());
}
const trigByView = [];
for (const conv of views) {
const triggers = qsa(conv, S_TKT);
trigByView.push([conv, triggers]);
for (let i = 0; i < triggers.length; i++) {
const trig = triggers[i], bodyDiv = trig.nextElementSibling;
if (!bodyDiv || tagOf(bodyDiv) !== 'DIV') continue;
tA(bodyDiv, A_TS, ga(trig, A_EXP) === 'true' && isStreamingThoughtTrigger(trig, i === triggers.length - 1));
}
}
if (!streamObs && typeof MutationObserver === 'function') streamObs = new MutationObserver(onStreamMutations);
if (streamObs && (streamRoots.size !== views.length || views.some((v) => !streamRoots.has(v)))) {
T(() => {
streamObs.disconnect(); streamRoots.clear();
for (const [conv, triggers] of trigByView) {
const resps = qsa(conv, PROSE_SEL), lb = triggers[triggers.length - 1]?.nextElementSibling;
if (resps.length) snapTextLens(resps[resps.length - 1], 24);
if (lb && !isManagedThoughtPanel(lb)) snapTextLens(lb, 16);
streamObs.observe(conv, { childList: true, characterData: true, subtree: true });
streamRoots.add(conv);
}
});
}
};
const resolveTriggerOriginCoords = (trig) => {
const age = trig && isFin(trig.at) ? nowOf() - trig.at : -1;
if (age < 0 || age > 900) return null;
if (trig.el && !trig._measured) {
trig._measured = true;
const r = trig.el.isConnected !== false ? rectOf(trig.el) : null;
if (r && r.width > 0 && r.height > 0) { trig.x = r.left + r.width / 2; trig.y = r.top + r.height / 2; }
trig.el = null;
}
return isFin(trig.x) && isFin(trig.y) ? trig : null;
};
const measureNewLensOverlays = () => {
const d = docOf();
if (!isMotionStandardOrUltra() || !d) return [];
const cands = new Set([...qsa(d, '.agy-overlay, .agy-fastpick, [data-testid="context-menu-popup"], [data-testid="context-menu-submenu-popup"]')]);
for (const el of qsa(d, '[data-testid="overview-panel"]')) { const p = peOf(el); if (p && tagOf(p) === 'DIV') cands.add(p); }
const freshNew = [], bus = getBus();
for (const ov of cands) if (!ha(ov, 'data-hover-card-popup') && !seenOverlays.has(ov) && !bus?.isSkipped?.(ov)) freshNew.push(ov);
if (!freshNew.length) return [];
const trig = resolveTriggerOriginCoords(heroState.lastTriggerOrigin);
return freshNew.map((ov) => ({ ov, rect: trig ? rectOf(ov) : null }));
};
const applyLensOverlays = (list) => {
if (!list?.length) return;
const trig = resolveTriggerOriginCoords(heroState.lastTriggerOrigin);
for (const { ov, rect: r } of list) {
if (seenOverlays.has(ov) || (trig && r && (r.width <= 0 || r.height <= 0))) continue;
seenOverlays.add(ov);
if (trig && r && r.width > 0 && r.height > 0) {
setProp(ov, '--ag-origin-x', `${M.round(M.max(-40, M.min(r.width + 40, trig.x - r.left)))}px`);
setProp(ov, '--ag-origin-y', `${M.round(M.max(-40, M.min(r.height + 40, trig.y - r.top)))}px`);
}
let idx = 0;
for (const item of qsa(ov, '[role="option"], [role="menuitem"], [data-testid]')) {
const role = ga(item, 'role'), tid = ga(item, A_TID) || '';
if (role === 'option' || role === 'menuitem' || tid.startsWith('overview-panel-row-') || tid === 'subagent-node' || tid === 'artifact-row') {
setProp(item, '--ag-row-i', String(idx++));
setAttrIfChanged(item, 'data-ag-row-stagger', '1');
if (idx >= 12) break;
}
}
}
};
const syncLensOverlayOrigins = (measuredOverlays) => {
const d = docOf();
if (!d) return;
for (const el of qsa(d, '[data-testid="overview-panel"]')) {
const p = peOf(el);
if (p && tagOf(p) === 'DIV') { setAttrIfChanged(p, 'data-ag-cs-overview-shell', '1'); setAttrIfChanged(p, 'data-ag-cs-prism-box', '1'); setAttrIfChanged(p, 'data-ag-cs-prism-mirror', '1'); }
}
if (!isMotionStandardOrUltra()) return;
if (measuredOverlays) return applyLensOverlays(measuredOverlays);
const bus = getBus();
if (bus?.measure && bus?.mutate) {
let mList = null;
bus.measure('sc:lens-r', () => { mList = measureNewLensOverlays(); });
bus.mutate('sc:lens-w', () => { if (!isDestroyed() && mList?.length) guardMut(() => applyLensOverlays(mList)); });
return;
}
applyLensOverlays(measureNewLensOverlays());
};
const scheduleDeferredConvEntry = (fn, delayMs = 65, frame2Fn = null) => {
const seq = ++convEntrySeq;
convEntryTimer = cT(convEntryTimer); convEntryRaf = cAF(convEntryRaf);
convEntryTimer = ST(() => {
convEntryTimer = 0;
if (isDestroyed() || seq !== convEntrySeq) return;
if (fn() !== false && seq === convEntrySeq && isF(frame2Fn)) convEntryRaf = rAF(() => { convEntryRaf = 0; if (!isDestroyed() && seq === convEntrySeq) frame2Fn(); });
}, delayMs);
};
const disconnectStreamObserver = () => {
syncStreamActiveAttr(false);
if (streamObs) { T(() => streamObs.disconnect()); streamObs = null; streamRoots.clear(); }
flushAllStreamArtifacts(true);
};
return {
heroState,
scheduleTransient,
clearTransientTimers,
cancelDeferredHydration,
enqueueDeferredIcons,
syncThinkingSparks,
clearWorkedForAutoUnfoldAttrs,
syncWorkedForAutoUnfold,
scheduleWorkedForClickSync,
findFormalConvView,
findFormalConvViews,
sampleHomeComposerRect,
triggerHomeLiftoffRippleBurst,
triggerHeroDFiberPulse,
triggerHeroESonar,
isSidebarRowRunning,
lockSidebarRowRunningOnPointerDown,
stampSidebarRowRunningImmediate,
measureSidebarSelectionSnapshot,
syncSidebarSelectionGlide,
measureVisibleChangedHeaders,
syncHeaderOpenStates,
syncHeroCCaustics,
syncHeroRouteChoreography,
flushAllStreamArtifacts,
onStreamMutations,
syncDualStreamEngine,
disconnectStreamObserver,
measureNewLensOverlays,
syncLensOverlayOrigins,
scheduleDeferredConvEntry,
suppressEntryMotion(ms) {
suppressEntryMotionUntil = M.max(suppressEntryMotionUntil, nowOf() + M.max(120, Number(ms) || 900));
liftoffBubbleUntil = 0;
const d = docOf();
if (d) for (const n of qsa(d, '.ag-cs-liftoff-veil,.ag-cs-sidebar-glide-pill')) n.remove();
},
isEntryMotionSuppressed: () => suppressEntryMotionUntil > nowOf(),
isStreamMutating: () => streamMutating,
hasStreamObserver: () => !!(streamObs && streamRoots.size > 0),
stepHighlightFade,
clearHighlightFade,
getHighlightFadeState: () => ({
activeCount: fadeItems.length,
rafActive: !!(fadeRaf || fadeTimer),
buckets: hlBuckets ? hlBuckets.map((h) => h.size ?? 0) : [],
}),
};
};
  const api = { STREAM_BATCH_MS, STREAM_FADE_MS, SIDEBAR_RUN_HOLD_MS, HIGHLIGHT_NAMES, createStreamChoreographyController };
  if (typeof module === 'object' && module.exports) module.exports = api;
  G.__agPrismStreamChoreography = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
