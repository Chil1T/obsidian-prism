// Obsidian Prism — Route Choreography, Velvet Stream Feathering, Auto-Unfold & Lens Module (stream-choreography.js)
(function (root) {
  'use strict';
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : window);
  if (!G) return;

  const STREAM_BATCH_MS = 52;
  const STREAM_FADE_MS = 300;
  const STREAM_FADE_STEP_MS = 60;
  const MAX_FADE_RANGES = 48;
  const HIGHLIGHT_NAMES = [0, 1, 2, 3, 4].map((i) => 'ag-stream-f' + i);
  const TABLE_TAGS = new Set('TABLE|THEAD|TBODY|TFOOT|TR|TH|TD'.split('|'));
  const INLINE_TAGS = new Set('SPAN|STRONG|EM|B|I|A|CODE|MARK|DEL|SUB|SUP'.split('|'));
  const K_PE = 'parentElement';
  const K_CL = 'classList';
  const K_IC = 'isConnected';

  const isEl = (n) => Boolean(n && (n.nodeType === 1 || (n.nodeType === undefined && typeof n.tagName === 'string')));
  const tagOf = (n) => String(n?.tagName || '').toUpperCase();
  const peOf = (n) => n?.[K_PE] || null;
  const clHas = (e, c) => Boolean(e?.[K_CL]?.contains?.(c));
  const clRm = (e, c) => e?.[K_CL]?.remove?.(c);
  const isConn = (e) => Boolean(e && e[K_IC] !== false);
  const ga = (e, k) => e?.getAttribute?.(k);
  const sa = (e, k, v) => e?.setAttribute?.(k, v);
  const ra = (e, k) => e?.removeAttribute?.(k);
  const ha = (e, k) => Boolean(e?.hasAttribute?.(k));
  const qs = (e, s) => e?.querySelector?.(s) || null;
  const qsa = (e, s) => e?.querySelectorAll?.(s) || [];
  const closestOf = (e, s) => e?.closest?.(s) || null;
  const rectOf = (e) => (typeof e?.getBoundingClientRect === 'function' ? e.getBoundingClientRect() : null);
  const setProp = (e, k, v) => e?.style?.setProperty?.(k, v);
  const docOf = () => (typeof document !== 'undefined' ? document : null);
  const nowOf = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
  const rAF = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : 0);
  const cAF = (id) => {
    if (id && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  };

  function createStreamChoreographyController({
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
  }) {
    let hydrateRaf = 0;
    let sparkQueue = [];
    let iconQueue = [];
    let wfClickTimer = 0;
    let convEntryTimer = 0;
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
    let runInit = false;
    let wasRunning = false;
    let runStartAt = 0;
    let fiberTimer = 0;
    let sbInit = false;
    let sbIndex = -1;
    let sbRect = null;

    const seenHeaders = new WeakSet();
    const seenOverlays = new WeakSet();

    let streamObs = null;
    let streamRoot = null;
    let streamMutating = false;
    let lastCodeAt = -1000;
    let scannedNodes = new WeakSet();
    let seenBlocks = new WeakSet();
    const textLenMap = new WeakMap();

    const fadeItems = [];
    let hlBuckets = null;
    let fadeRaf = 0;
    let nextFadeDueAt = 0;
    const doneSparkCache = new WeakMap();

    const expirableClasses = new Map();
    let sweepTimer = 0;

    const canStreamMotion = () => {
      const d = docOf();
      if (ga(d?.documentElement, 'data-ag-cs-motion') === 'off') return false;
      return typeof isMotionStandardOrUltra === 'function' ? Boolean(isMotionStandardOrUltra()) : Boolean(isMotionUltra());
    };

    function getHlBuckets() {
      const cssObj = typeof CSS !== 'undefined' ? CSS : G.CSS;
      const HlCtor = typeof Highlight === 'function' ? Highlight : G.Highlight;
      const d = docOf();
      if (!cssObj?.highlights?.set || typeof HlCtor !== 'function' || typeof d?.createRange !== 'function') return null;
      if (!hlBuckets) {
        hlBuckets = HIGHLIGHT_NAMES.map((n) => {
          const h = cssObj.highlights.get?.(n) || new HlCtor();
          cssObj.highlights.set(n, h);
          return h;
        });
      } else {
        for (let i = 0; i < 5; i++) {
          const n = HIGHLIGHT_NAMES[i];
          const cur = cssObj.highlights.get?.(n);
          if (cur && cur !== hlBuckets[i]) hlBuckets[i] = cur;
          else if (!cur) cssObj.highlights.set(n, hlBuckets[i]);
        }
      }
      return hlBuckets;
    }

    function dropBucketItem(it) {
      if (hlBuckets && it.b >= 0 && it.b < 5) {
        try {
          hlBuckets[it.b].delete(it.r);
        } catch {}
      }
      it.b = -1;
    }

    function clearHighlightFade() {
      cAF(fadeRaf);
      fadeRaf = 0;
      nextFadeDueAt = 0;
      for (let i = 0; i < fadeItems.length; i++) dropBucketItem(fadeItems[i]);
      fadeItems.length = 0;
    }

    function stepHighlightFade(ts) {
      fadeRaf = 0;
      if (isDestroyed() || !canStreamMotion() || fadeItems.length === 0) {
        clearHighlightFade();
        return;
      }
      const now = typeof ts === 'number' && Number.isFinite(ts) ? ts : nowOf();
      if (nextFadeDueAt > 0 && now < nextFadeDueAt - 1) {
        fadeRaf = rAF(stepHighlightFade);
        if (!fadeRaf) clearHighlightFade();
        return;
      }
      const buckets = getHlBuckets();
      if (!buckets) {
        clearHighlightFade();
        return;
      }
      let w = 0;
      let earliestDue = Infinity;
      for (let i = 0; i < fadeItems.length; i++) {
        const it = fadeItems[i];
        const tn = it.n;
        const val = tn ? tn.data ?? tn.nodeValue ?? '' : '';
        const age = Math.max(0, now - it.t);
        if (!isConn(tn) || val.length < it.e || age >= STREAM_FADE_MS) {
          dropBucketItem(it);
          continue;
        }
        const nb = Math.min(4, (age / STREAM_FADE_STEP_MS) | 0);
        if (it.b !== nb) {
          dropBucketItem(it);
          try {
            buckets[nb].add(it.r);
            it.b = nb;
          } catch {
            continue;
          }
        }
        const due = it.t + (it.b + 1) * STREAM_FADE_STEP_MS;
        if (due < earliestDue) earliestDue = due;
        fadeItems[w++] = it;
      }
      fadeItems.length = w;
      if (w > 0) {
        nextFadeDueAt = Number.isFinite(earliestDue) ? earliestDue : 0;
        fadeRaf = rAF(stepHighlightFade);
        if (!fadeRaf) clearHighlightFade();
      } else {
        clearHighlightFade();
      }
    }

    function enqueueFadeRange(tn, sOff, eOff, now) {
      if (!tn || eOff <= sOff) return false;
      const buckets = getHlBuckets();
      const d = docOf();
      if (!buckets || !d) return false;
      const raw = tn.data ?? tn.nodeValue ?? '';
      if (eOff > raw.length || !/\S/.test(raw.slice(sOff, eOff))) return false;

      const prev = fadeItems.length > 0 ? fadeItems[fadeItems.length - 1] : null;
      if (prev && prev.n === tn && prev.e === sOff && now - prev.t <= 34) {
        try {
          prev.r.setEnd(tn, eOff);
          prev.e = eOff;
          return true;
        } catch {}
      }
      if (fadeItems.length >= MAX_FADE_RANGES) {
        const old = fadeItems.shift();
        if (old) dropBucketItem(old);
      }
      try {
        const r = d.createRange();
        r.setStart(tn, sOff);
        r.setEnd(tn, eOff);
        buckets[0].add(r);
        fadeItems.push({ n: tn, s: sOff, e: eOff, r, b: 0, t: now });
        const due = now + STREAM_FADE_STEP_MS;
        if (!nextFadeDueAt || due < nextFadeDueAt) nextFadeDueAt = due;
        if (!fadeRaf) fadeRaf = rAF(stepHighlightFade);
        return true;
      } catch {
        return false;
      }
    }

    function snapTextLens(node, limit = 24) {
      if (!node) return;
      let c = 0;
      const walk = (n) => {
        if (!n || c >= limit) return;
        if (n.nodeType === 3) {
          textLenMap.set(n, (n.data ?? n.nodeValue ?? '').length);
          c++;
          return;
        }
        const ks = n.childNodes;
        if (!ks) return;
        for (let i = ks.length - 1; i >= 0 && c < limit; i--) walk(ks[i]);
      };
      walk(node);
    }

    function flushExpiredClasses() {
      sweepTimer = 0;
      if (expirableClasses.size === 0) return;
      const now = Date.now();
      let nextDue = Infinity;
      runGuardedMut(() => {
        for (const [el, map] of expirableClasses.entries()) {
          for (const [cls, expAt] of map.entries()) {
            if (now >= expAt - 2) {
              clRm(el, cls);
              map.delete(cls);
            } else if (expAt < nextDue) nextDue = expAt;
          }
          if (map.size === 0) expirableClasses.delete(el);
        }
      });
      if (!isDestroyed() && expirableClasses.size > 0 && Number.isFinite(nextDue)) {
        sweepTimer = setTimeout(flushExpiredClasses, Math.max(16, Math.ceil(nextDue - Date.now())));
      }
    }

    function scheduleTransient(fn, ms) {
      const id = setTimeout(() => {
        transientTimers.delete(id);
        if (!isDestroyed()) {
          try {
            fn();
          } catch {}
        }
      }, ms);
      transientTimers.add(id);
      return id;
    }

    function clearTransientTimers() {
      if (convEntryTimer) {
        clearTimeout(convEntryTimer);
        convEntryTimer = 0;
      }
      if (wfClickTimer) {
        clearTimeout(wfClickTimer);
        wfClickTimer = 0;
      }
      if (sweepTimer) {
        clearTimeout(sweepTimer);
        sweepTimer = 0;
      }
      expirableClasses.clear();
      for (const id of transientTimers) clearTimeout(id);
      transientTimers.clear();
    }

    function cancelDeferredHydration() {
      cAF(hydrateRaf);
      hydrateRaf = 0;
      sparkQueue = [];
      iconQueue = [];
    }

    function applySingleSpark(trig, brand, st) {
      const d = docOf();
      if (!d || !isConn(trig)) return;
      if (st === 'streaming') setAttrIfChanged(trig, 'data-ag-cs-spark-streaming', '1');
      else if (ha(trig, 'data-ag-cs-spark-streaming')) ra(trig, 'data-ag-cs-spark-streaming');
      let spark = clHas(trig.firstElementChild, 'ag-cs-thinking-spark') ? trig.firstElementChild : qs(trig, '.ag-cs-thinking-spark');
      if (!spark) {
        spark = d.createElement('span');
        spark.className = 'ag-cs-thinking-spark';
        sa(spark, 'aria-hidden', 'true');
        sa(spark, 'data-ag-no-i18n', '');
        trig.insertBefore(spark, trig.firstChild);
      }
      const isMono = ga(d.documentElement, 'data-ag-cs-accent') === 'mono';
      const mv = isMono ? '1' : '0';
      if (ga(spark, 'data-brand') !== brand || ga(spark, 'data-state') !== st || ga(spark, 'data-mono') !== mv) {
        sa(spark, 'data-brand', brand);
        sa(spark, 'data-state', st);
        sa(spark, 'data-mono', mv);
        const svgStr = buildBrandMarkSvg(brand, 13, 'auto', isMono);
        const cloned = cloneCachedSvgElement(`spark:${brand}:${mv}`, svgStr);
        if (cloned && typeof spark.replaceChildren === 'function') spark.replaceChildren(cloned);
        else spark.innerHTML = svgStr;
      }
    }

    function stepHydration() {
      hydrateRaf = 0;
      if (isDestroyed()) return;
      runGuardedMut(() => {
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
    }

    function enqueueDeferredIcons(items) {
      iconQueue = items;
      if (!isDestroyed() && !hydrateRaf) hydrateRaf = rAF(stepHydration);
    }

    function syncThinkingSparks(primaryModelInfo) {
      const d = docOf();
      if (isDestroyed() || !d) return;
      const conv = findFormalConvView();
      const triggers = qsa(conv || d, '[data-testid="thinking-collapsible-trigger"]');
      const brand = primaryModelInfo?.brand || 'gemini';
      const mv = ga(d.documentElement, 'data-ag-cs-accent') === 'mono' ? '1' : '0';
      const cacheSig = `${brand}:${mv}`;
      const len = triggers.length;
      const pending = [];
      for (let i = 0; i < len; i++) {
        const trig = triggers[i];
        if (i < len - 1 && doneSparkCache.get(trig) === cacheSig) continue;
        const spark = clHas(trig.firstElementChild, 'ag-cs-thinking-spark') ? trig.firstElementChild : qs(trig, '.ag-cs-thinking-spark');
        if (
          i < len - 1 &&
          spark &&
          ga(spark, 'data-state') === 'done' &&
          ga(spark, 'data-brand') === brand &&
          ga(spark, 'data-mono') === mv &&
          !ha(trig, 'data-ag-cs-spark-streaming')
        ) {
          doneSparkCache.set(trig, cacheSig);
          continue;
        }
        const st = /\.\.\.|…|正在|思考中|thinking/i.test(String(trig.textContent || '')) ? 'streaming' : 'done';
        if (
          spark &&
          ga(spark, 'data-brand') === brand &&
          ga(spark, 'data-state') === st &&
          ga(spark, 'data-mono') === mv &&
          (st === 'streaming') === ha(trig, 'data-ag-cs-spark-streaming')
        ) {
          if (st === 'done' && i < len - 1) doneSparkCache.set(trig, cacheSig);
          else doneSparkCache.delete(trig);
          continue;
        }
        if (st !== 'done') doneSparkCache.delete(trig);
        pending.push({ trig, brand, st, idx: i });
      }
      const runApply = (it) => {
        applySingleSpark(it.trig, it.brand, it.st);
        if (it.st === 'done' && it.idx < len - 1) doneSparkCache.set(it.trig, cacheSig);
      };
      if (pending.length <= 16 || typeof requestAnimationFrame !== 'function') {
        for (let i = 0; i < pending.length; i++) runApply(pending[i]);
      } else {
        const syncStart = pending.length - 12;
        for (let i = syncStart; i < pending.length; i++) runApply(pending[i]);
        sparkQueue = pending.slice(0, syncStart);
        if (!hydrateRaf) hydrateRaf = rAF(stepHydration);
      }
    }

    function clearWorkedForAutoUnfoldAttrs() {
      const d = docOf();
      if (!d) return;
      for (const el of qsa(d, '[data-ag-cs-auto-unfolded]')) ra(el, 'data-ag-cs-auto-unfolded');
      for (const el of qsa(d, '[data-ag-cs-outer-open]')) ra(el, 'data-ag-cs-outer-open');
    }

    function processOuterWf(btn) {
      if (!isConn(btn)) return;
      const expanded = ga(btn, 'aria-expanded') === 'true';
      let scope = btn.nextElementSibling;
      if (!scope) {
        let sib = btn.nextSibling;
        while (sib && sib.nodeType && sib.nodeType !== 1) sib = sib.nextSibling;
        scope = sib || null;
      }
      if (!scope) scope = peOf(btn);
      const innerBtns = qsa(scope, '[data-testid="tool-group-collapsible"]');
      if (expanded) {
        setAttrIfChanged(btn, 'data-ag-cs-outer-open', '1');
        for (const cb of innerBtns) {
          if (cb !== btn && ga(cb, 'data-ag-cs-auto-unfolded') !== '1') {
            sa(cb, 'data-ag-cs-auto-unfolded', '1');
            if (ga(cb, 'aria-expanded') === 'false' && typeof cb.click === 'function') {
              try {
                cb.click();
              } catch {}
            }
          }
        }
      } else if (ga(btn, 'data-ag-cs-outer-open') === '1') {
        ra(btn, 'data-ag-cs-outer-open');
        for (const cb of innerBtns) ra(cb, 'data-ag-cs-auto-unfolded');
        const p = peOf(btn);
        if (p && p !== scope) {
          for (const el of qsa(p, '[data-ag-cs-auto-unfolded]')) ra(el, 'data-ag-cs-auto-unfolded');
        }
      }
    }

    function syncWorkedForAutoUnfold(dirtyTargets = null) {
      const d = docOf();
      if (isDestroyed()) {
        clearWorkedForAutoUnfoldAttrs();
        return;
      }
      if (!d) return;
      if (dirtyTargets && dirtyTargets.size > 0) {
        const outers = new Set();
        for (const node of dirtyTargets) {
          if (!isConn(node)) continue;
          if (ga(node, 'data-testid') === 'worked-for-collapsible') {
            outers.add(node);
            continue;
          }
          const prev = node.previousElementSibling;
          if (prev && ga(prev, 'data-testid') === 'worked-for-collapsible') outers.add(prev);
          for (const b of qsa(node, '[data-testid="worked-for-collapsible"]')) outers.add(b);
          let cur = peOf(node);
          while (cur && cur !== d.body) {
            const sib = cur.previousElementSibling;
            if (sib && ga(sib, 'data-testid') === 'worked-for-collapsible') {
              outers.add(sib);
              break;
            }
            cur = peOf(cur);
          }
        }
        for (const btn of outers) processOuterWf(btn);
        return;
      }
      for (const btn of qsa(d, '[data-testid="worked-for-collapsible"]')) processOuterWf(btn);
    }

    function scheduleWorkedForClickSync() {
      if (isDestroyed()) return;
      if (wfClickTimer) clearTimeout(wfClickTimer);
      wfClickTimer = setTimeout(() => {
        wfClickTimer = 0;
        if (!isDestroyed()) syncWorkedForAutoUnfold();
      }, 28);
    }

    function findFormalConvView() {
      const d = docOf();
      for (const cv of qsa(d, '[data-testid="conversation-view"]')) {
        if (closestOf(cv, '[data-testid="subagent-tab-conversation"]')) continue;
        if (closestOf(cv, '.agy-home') || qs(cv, '.agy-home')) continue;
        return cv;
      }
      return null;
    }

    function sampleHomeComposerRect() {
      const home = qs(docOf(), '.agy-home');
      if (!home) return null;
      const r = rectOf(qs(home, '[data-testid="agent-input-box"]') || qs(home, '.surface-composer-card'));
      if (r && r.width > 0 && r.height > 0) {
        lastHomeRect = { left: r.left, top: r.top, width: r.width, height: r.height };
      }
      return lastHomeRect;
    }

    function triggerHomeLiftoffRippleBurst() {
      const home = qs(docOf(), '.agy-home');
      if (!home) return;
      const r = sampleHomeComposerRect();
      if (isMotionUltra() && rippleCtl) rippleCtl.triggerLiftoffBurst(r);
    }

    function markLiftoffBubble(conv) {
      const bubble = qs(conv, '[data-testid="user-message-bubble"]');
      if (!bubble) return false;
      sa(bubble, 'data-ag-cs-liftoff-bubble', '1');
      scheduleTransient(() => {
        if (isConn(bubble)) ra(bubble, 'data-ag-cs-liftoff-bubble');
      }, 500);
      return true;
    }

    function triggerHeroALiftoff(formalConv, measuredRect = null) {
      const d = docOf();
      if (!isMotionUltra() || !formalConv || !d) return;
      const now = nowOf();
      for (const n of qsa(d, '.ag-cs-liftoff-veil')) n.remove();
      const veil = d.createElement('div');
      veil.className = 'ag-cs-liftoff-veil';
      sa(veil, 'aria-hidden', 'true');
      sa(veil, 'data-ag-no-i18n', '');
      const r = lastHomeRect;
      setProp(veil, '--ag-lift-x', r && r.width > 0 ? `${Math.round(r.left + r.width / 2)}px` : '50%');
      setProp(veil, '--ag-lift-y', r && r.height > 0 ? `${Math.round(r.top + r.height / 2)}px` : '58%');
      const ring = d.createElement('div');
      ring.className = 'ag-cs-liftoff-ring';
      veil.appendChild(ring);
      d.body?.appendChild(veil);
      scheduleTransient(() => veil.remove(), 540);

      const inputBox = qs(formalConv, '[data-testid="agent-input-box"]') || qs(d, '[data-testid="agent-input-box"]');
      if (inputBox && typeof motionEngine?.spring === 'function') {
        const nr = measuredRect || rectOf(inputBox);
        const rawDelta = r && nr ? Math.round(r.top - nr.top) : -160;
        const dy = Math.max(-420, Math.min(-24, rawDelta === 0 ? -140 : rawDelta));
        try {
          motionEngine.spring(
            inputBox,
            [{ transform: `translateY(${dy}px) scale(0.985)` }, { transform: 'translateY(0) scale(1)' }],
            { durationMs: 480, stiffness: 310, damping: 28, slot: 'liftoff-dock' }
          );
        } catch {}
      }
      liftoffBubbleUntil = markLiftoffBubble(formalConv) ? 0 : now + 900;
      convAuraCtl?.triggerLiftoffEbb?.(now);
    }

    function triggerHeroBHomeReturn() {
      if (!isMotionUltra()) return;
      const home = qs(docOf(), '.agy-home');
      if (!home) return;
      rippleCtl?.triggerTideSwell?.();
      if (typeof motionEngine?.stagger === 'function') {
        const items = [qs(home, '[data-testid="home-greeting"]'), qs(home, '.ag-cs-home-panel'), qs(home, '[data-testid="agent-input-box"]')].filter(
          Boolean
        );
        if (items.length > 0) {
          try {
            motionEngine.stagger(items, [{ opacity: 0.01, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0px)' }], {
              durationMs: 220,
              delayStep: 24,
              stepMs: 24,
              stiffness: 360,
              damping: 30,
              slot: 'home-return',
            });
          } catch {}
        }
      }
    }

    function measureSidebarSelectionSnapshot() {
      const rows = qsa(docOf(), '[data-testid="conversation-row-sidebar"]');
      if (!rows.length) return { e: true };
      let selIdx = -1;
      let selRow = null;
      const states = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (selIdx < 0 && ga(r, 'data-selected') === 'true') {
          selIdx = i;
          selRow = r;
        }
        states.push([r, Boolean(qs(r, '[data-testid="status-loading-spinner"]'))]);
      }
      if (!selRow) return { e: false, i: -1, r: null, s: null, l: null, t: 0, st: states };
      const list = peOf(selRow);
      const rr = rectOf(selRow);
      const lr = rectOf(list);
      const stTop = list ? list.scrollTop || 0 : 0;
      const snap = rr
        ? {
            left: rr.left,
            top: rr.top,
            width: rr.width,
            height: rr.height,
            ry: lr ? rr.top - lr.top + stTop : rr.top,
            rx: lr ? rr.left - lr.left : rr.left,
          }
        : null;
      return { e: false, i: selIdx, r: selRow, s: snap, l: lr, t: stTop, st: states };
    }

    function syncSidebarSelectionGlide(snap) {
      const d = docOf();
      if (!snap || !d) return;
      if (ga(d.documentElement, 'data-ag-cs-sidebar') === 'off') {
        for (const n of qsa(d, '.ag-cs-sidebar-glide-pill')) n.remove();
        if (snap.st) {
          for (const [row] of snap.st) if (ha(row, 'data-ag-cs-row-running')) ra(row, 'data-ag-cs-row-running');
        }
        sbInit = false;
        sbIndex = -1;
        sbRect = null;
        return;
      }
      if (snap.st) {
        for (const [row, run] of snap.st) {
          if (run) setAttrIfChanged(row, 'data-ag-cs-row-running', '1');
          else if (ha(row, 'data-ag-cs-row-running')) ra(row, 'data-ag-cs-row-running');
        }
      }
      if (snap.e) {
        sbInit = false;
        sbIndex = -1;
        sbRect = null;
        return;
      }
      const { i: selIdx, r: selRow, s: curSnap, l: listRect, t: scrollTop } = snap;
      if (!selRow) return;
      if (!sbInit) {
        sbInit = true;
        sbIndex = selIdx;
        sbRect = curSnap;
        return;
      }
      if (sbIndex >= 0 && selIdx >= 0 && selIdx !== sbIndex && sbRect && curSnap) {
        const fromRect = listRect
          ? { left: listRect.left + sbRect.rx, top: listRect.top + sbRect.ry - scrollTop, width: sbRect.width, height: sbRect.height }
          : sbRect;
        if (isMotionStandardOrUltra()) {
          for (const n of qsa(d, '.ag-cs-sidebar-glide-pill')) n.remove();
          const pill = d.createElement('div');
          pill.className = 'ag-cs-sidebar-glide-pill';
          sa(pill, 'aria-hidden', 'true');
          sa(pill, 'data-ag-no-i18n', '');
          for (const [k, v] of [
            ['position', 'fixed'],
            ['z-index', '38'],
            ['pointer-events', 'none'],
            ['left', `${Math.round(curSnap.left)}px`],
            ['top', `${Math.round(curSnap.top)}px`],
            ['width', `${Math.round(curSnap.width)}px`],
            ['height', `${Math.round(curSnap.height)}px`],
          ]) {
            setProp(pill, k, v);
          }
          d.body?.appendChild(pill);
          try {
            motionEngine?.glideIndicator?.(pill, fromRect, curSnap, { durationMs: 240 });
          } catch {}
          scheduleTransient(() => pill.remove(), 260);
        }
        if (isMotionUltra()) {
          const dir = selIdx < sbIndex ? 'down' : 'up';
          for (const vp of qsa(d, '[data-testid="autoscroll-viewport"]')) {
            if (closestOf(vp, '[data-testid="subagent-tab-conversation"]')) continue;
            sa(vp, 'data-ag-cs-stage-glide', dir);
            scheduleTransient(() => {
              if (isConn(vp) && ga(vp, 'data-ag-cs-stage-glide') === dir) ra(vp, 'data-ag-cs-stage-glide');
            }, 220);
            break;
          }
        }
      }
      sbIndex = selIdx;
      sbRect = curSnap;
    }

    function applyCaustic(el) {
      if (!el || !isMotionUltra()) return;
      sa(el, 'data-ag-cs-caustic', '1');
      scheduleTransient(() => {
        if (isConn(el)) ra(el, 'data-ag-cs-caustic');
      }, 920);
    }

    function measureVisibleChangedHeaders() {
      const out = [];
      const vh = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 1080;
      for (const hdr of qsa(docOf(), '[data-testid="changed-files-card-header"]')) {
        if (seenHeaders.has(hdr)) continue;
        const r = rectOf(hdr);
        if (!r || r.height <= 0 || (r.bottom > 0 && r.top < vh)) out.push(hdr);
      }
      return out;
    }

    function syncHeroCCaustics(measuredHeaders) {
      const d = docOf();
      const now = nowOf();
      let sawNew = false;
      for (const hdr of measuredHeaders || measureVisibleChangedHeaders()) {
        if (seenHeaders.has(hdr)) continue;
        seenHeaders.add(hdr);
        sawNew = true;
        if (isMotionUltra()) applyCaustic(hdr);
      }
      if (sawNew) notifyMascot('files-changed');

      const runningNow = isConvRunning();
      if (!runInit) {
        runInit = true;
        wasRunning = runningNow;
        runStartAt = runningNow ? now : 0;
      } else if (runningNow && !wasRunning) {
        wasRunning = true;
        runStartAt = now;
      } else if (!runningNow && wasRunning) {
        wasRunning = false;
        const elapsed = runStartAt > 0 ? now - runStartAt : 0;
        runStartAt = 0;
        const auraPhase = convAuraCtl?.getInstance?.()?.phase || '';
        const errDom = qs(
          d,
          '[data-testid="conversation-view"] [data-testid="agent-error-banner"], [data-testid="conversation-view"] [data-testid="error-message"]'
        );
        if (auraPhase === 'error-halted' || Boolean(errDom)) {
          convAuraCtl?.triggerErrorHalted?.(now);
          notifyMascot('streamDone', { error: true, durationMs: elapsed });
        } else {
          if (elapsed >= 6000 && isMotionUltra()) {
            for (const c of qsa(d, '[data-testid="agent-input-box"] .surface-composer-card')) {
              if (!closestOf(c, '[data-testid="subagent-tab-conversation"]')) {
                applyCaustic(c);
                break;
              }
            }
          }
          if (elapsed >= 15000) convAuraCtl?.triggerLongTaskComplete?.(now);
          notifyMascot('complete', { durationMs: elapsed });
        }
      }
    }

    function triggerHeroDFiberPulse(card, modelBtn, brand) {
      if (!card || !isMotionUltra()) return;
      const camp = brand === 'antigravity' || brand === 'claude' || brand === 'openai' ? brand : 'gemini';
      if (fiberTimer) {
        clearTimeout(fiberTimer);
        transientTimers.delete(fiberTimer);
        fiberTimer = 0;
      }
      sa(card, 'data-ag-cs-fiber-camp', camp);
      fiberTimer = scheduleTransient(() => {
        fiberTimer = 0;
        if (isConn(card)) ra(card, 'data-ag-cs-fiber-camp');
      }, 480);
      const glyph = qs(modelBtn, '.ag-cs-model-glyph');
      if (glyph && typeof motionEngine?.spring === 'function') {
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
      const conv = closestOf(navTurn, '[data-testid="conversation-view"]') || findFormalConvView();
      if (!conv) return;
      let turns = qsa(conv, '[data-testid="user-input-step"]');
      if (!turns.length) turns = qsa(conv, '[data-testid="conversation-turn"]');
      if (!turns.length) turns = qsa(conv, '[data-testid="user-message-bubble"]');
      if (!turns.length) return;

      let idx = -1;
      const rawAttr = ga(navTurn, 'data-turn-index') ?? ga(navTurn, 'data-index');
      if (rawAttr != null && /^\d+$/.test(String(rawAttr).trim())) {
        idx = parseInt(String(rawAttr).trim(), 10);
      } else if (ga(navTurn, 'data-testid') === 'conversation-navigator-group') {
        idx = 0;
      } else {
        const navRoot = closestOf(navTurn, '[data-testid="conversation-navigator"]') || peOf(navTurn);
        if (navRoot) {
          const sibs = Array.from(qsa(navRoot, '[data-testid="conversation-navigator-turn"]'));
          const relIdx = sibs.indexOf(navTurn);
          if (relIdx >= 0) idx = Math.min(turns.length - 1, Math.max(0, turns.length - sibs.length) + relIdx);
        }
      }
      const target = idx >= 0 && idx < turns.length ? turns[idx] : null;
      if (!target) return;
      sa(target, 'data-ag-cs-sonar', '1');
      scheduleTransient(() => {
        if (isConn(target)) ra(target, 'data-ag-cs-sonar');
      }, 720);
    }

    function syncHeroRouteChoreography(measured) {
      const d = docOf();
      const inHome = measured ? measured.inHome : Boolean(qs(d, '.agy-home'));
      const formalConv = measured ? measured.formalConv : !inHome ? findFormalConvView() : null;
      const inFormalConv = Boolean(formalConv);

      if (inHome) {
        const sheet = closestOf(qs(d, '.agy-home'), '.agy-sheet');
        if (sheet) setAttrIfChanged(sheet, 'data-ag-cs-home-sheet', '1');
      }
      if (formalConv) {
        const seat = peOf(formalConv);
        if (seat && tagOf(seat) === 'DIV') setAttrIfChanged(seat, 'data-ag-cs-conv-seat', '1');
        const vp = qs(formalConv, '[data-testid="autoscroll-viewport"]');
        const vpP = peOf(vp);
        if (vpP && vpP !== formalConv) setAttrIfChanged(vpP, 'data-ag-cs-vp-wrap', '1');
      }
      if (inHome && !measured?.homeComposerSampled) sampleHomeComposerRect();

      if (!heroState.routeInitialized) {
        heroState.routeInitialized = true;
        heroState.wasInHome = inHome;
        heroState.wasInFormalConv = inFormalConv;
      } else {
        if (heroState.wasInHome && !inHome && inFormalConv) triggerHeroALiftoff(formalConv, measured?.convInputRect || null);
        else if (heroState.wasInFormalConv && !heroState.wasInHome && inHome) triggerHeroBHomeReturn();
        heroState.wasInHome = inHome;
        heroState.wasInFormalConv = inFormalConv;
      }

      if (liftoffBubbleUntil > 0 && formalConv) {
        if (nowOf() <= liftoffBubbleUntil) {
          if (markLiftoffBubble(formalConv)) liftoffBubbleUntil = 0;
        } else liftoffBubbleUntil = 0;
      }
      if (measured?.sidebarSnap) syncSidebarSelectionGlide(measured.sidebarSnap);
      if (!measured || measured.checkCaustics !== false) syncHeroCCaustics(measured?.visibleChangedHeaders);
    }

    function isBlockCode(el, stopAt) {
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
    }

    function insideCodeOrTable(node, stopAt) {
      let cur = isEl(node) ? node : peOf(node);
      while (cur && cur !== stopAt) {
        if (TABLE_TAGS.has(tagOf(cur)) || isBlockCode(cur, stopAt)) return cur;
        cur = peOf(cur);
      }
      return null;
    }

    function findRowAnc(node, stopAt) {
      let cur = isEl(node) ? node : peOf(node);
      while (cur && cur !== stopAt) {
        if (tagOf(cur) === 'TR') return cur;
        cur = peOf(cur);
      }
      return null;
    }

    function flushAllStreamArtifacts(immediate = true) {
      scannedNodes = new WeakSet();
      seenBlocks = new WeakSet();
      const force = immediate || !canStreamMotion() || isDestroyed();
      if (force) {
        clearHighlightFade();
        if (sweepTimer) {
          clearTimeout(sweepTimer);
          sweepTimer = 0;
        }
      }
      runGuardedMut(() => {
        const d = docOf();
        if (force) {
          for (const [el, map] of expirableClasses.entries()) {
            for (const cls of map.keys()) clRm(el, cls);
          }
          expirableClasses.clear();
          if (d) {
            for (const cls of ['ag-cs-stream-chunk', 'ag-cs-thought-chunk', 'ag-cs-code-scan']) {
              for (const el of qsa(d, '.' + cls)) clRm(el, cls);
            }
          }
        }
        if (!d) return;
        for (const el of qsa(d, '[data-ag-cs-thought-streaming]')) ra(el, 'data-ag-cs-thought-streaming');
        if (!isMotionUltra()) {
          for (const el of qsa(d, '.ag-cs-liftoff-veil')) el.remove();
          for (const attr of [
            'data-ag-cs-liftoff-bubble',
            'data-ag-cs-caustic',
            'data-ag-cs-fiber-camp',
            'data-ag-cs-stage-glide',
            'data-ag-cs-sonar',
          ]) {
            for (const el of qsa(d, `[${attr}]`)) ra(el, attr);
          }
        }
        if (!isMotionStandardOrUltra()) {
          for (const el of qsa(d, '.ag-cs-sidebar-glide-pill')) el.remove();
        }
      });
    }

    function findStreamingThoughtBody(node) {
      const body = docOf()?.body;
      let cur = isEl(node) ? node : peOf(node);
      while (cur && cur !== body) {
        if (ga(cur, 'data-ag-cs-thought-streaming') === '1') return cur;
        const prev = cur.previousElementSibling;
        if (prev && ga(prev, 'data-testid') === 'thinking-collapsible-trigger' && ga(prev, 'aria-expanded') === 'true') return cur;
        cur = peOf(cur);
      }
      return null;
    }

    function markStreamClass(el, cls, dur = 300) {
      if (!el?.[K_CL] || clHas(el, cls)) return false;
      runGuardedMut(() => el[K_CL].add(cls));
      let map = expirableClasses.get(el);
      if (!map) {
        map = new Map();
        expirableClasses.set(el, map);
      }
      map.set(cls, Date.now() + dur);
      if (!sweepTimer) sweepTimer = setTimeout(flushExpiredClasses, dur);
      return true;
    }

    function fadeLeafTexts(node, now, max = 4) {
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
    }

    function onStreamMutations(mutations) {
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
          closestOf(
            baseEl,
            '.ag-prism-thought-overlay, .ag-cs-smooth-caret, .ag-cs-crab, .ag-cs-conv-aura-host, [data-testid="agent-input-box"], script, style'
          )
        ) {
          continue;
        }

        if (m.type === 'characterData') {
          if (target.nodeType !== 3) continue;
          const tb = findStreamingThoughtBody(baseEl);
          if (tb) {
            if (isManagedThoughtPanel(tb)) continue;
          } else if (!closestOf(baseEl, '[data-testid="planner-response-text"]')) continue;
          const nLen = (target.data ?? target.nodeValue ?? '').length;
          const pLen = textLenMap.get(target);
          textLenMap.set(target, nLen);
          if (pLen !== undefined) {
            if (nLen > pLen) enqueueFadeRange(target, pLen, nLen, now);
          } else if (nLen > 0 && nLen <= 28) enqueueFadeRange(target, 0, nLen, now);
          continue;
        }

        if (m.type !== 'childList' || !m.addedNodes?.length) continue;

        const inAnimBlock = Boolean(closestOf(baseEl, '.ag-cs-stream-chunk, .ag-cs-thought-chunk'));
        const thoughtBody = findStreamingThoughtBody(target);
        if (thoughtBody) {
          if (isManagedThoughtPanel(thoughtBody)) continue;
          for (const added of m.addedNodes) {
            if (isThoughtIsolatedNode(added)) continue;
            if (added.nodeType === 3) {
              fadeLeafTexts(added, now, 1);
            } else if (isEl(added)) {
              if (inAnimBlock || INLINE_TAGS.has(tagOf(added))) fadeLeafTexts(added, now, 4);
              else if (!seenBlocks.has(added) && newBlocks < 4) {
                seenBlocks.add(added);
                newBlocks++;
                snapTextLens(added, 12);
                markStreamClass(added, 'ag-cs-thought-chunk', 290);
              }
            }
          }
          continue;
        }

        const proseRoot = closestOf(baseEl, '[data-testid="planner-response-text"]');
        if (!proseRoot) continue;

        const codeCtx = insideCodeOrTable(target, proseRoot);
        if (codeCtx) {
          if (TABLE_TAGS.has(tagOf(codeCtx))) {
            for (const added of m.addedNodes) {
              if (added.nodeType === 3) {
                fadeLeafTexts(added, now, 1);
                continue;
              }
              if (!isEl(added)) continue;
              const tr = tagOf(added) === 'TR' ? added : findRowAnc(added, proseRoot) || findRowAnc(codeCtx, proseRoot);
              if (tr && !scannedNodes.has(tr) && now - lastCodeAt >= STREAM_BATCH_MS) {
                scannedNodes.add(tr);
                lastCodeAt = now;
                snapTextLens(tr, 12);
                markStreamClass(tr, 'ag-cs-code-scan', 240);
              } else fadeLeafTexts(added, now, 3);
            }
            continue;
          }

          for (const added of m.addedNodes) {
            if (added.nodeType === 3) {
              fadeLeafTexts(added, now, 1);
              continue;
            }
            if (!isEl(added)) continue;
            if (tagOf(added) === 'PRE' || clHas(added, 'code-block')) {
              if (!scannedNodes.has(added)) {
                scannedNodes.add(added);
                lastCodeAt = now;
                snapTextLens(added, 16);
                markStreamClass(added, 'ag-cs-code-scan', 240);
              }
              continue;
            }
            const lineEl = clHas(added, 'code-line') ? added : closestOf(added, '.code-line') || added;
            if (
              lineEl &&
              lineEl !== proseRoot &&
              tagOf(lineEl) !== 'PRE' &&
              !clHas(lineEl, 'code-block') &&
              !scannedNodes.has(lineEl) &&
              now - lastCodeAt >= STREAM_BATCH_MS
            ) {
              scannedNodes.add(lineEl);
              lastCodeAt = now;
              snapTextLens(lineEl, 8);
              markStreamClass(lineEl, 'ag-cs-code-scan', 240);
            } else fadeLeafTexts(added, now, 3);
          }
          continue;
        }

        for (const added of m.addedNodes) {
          if (added.nodeType === 3) {
            fadeLeafTexts(added, now, 1);
            continue;
          }
          if (!isEl(added)) continue;
          const tag = tagOf(added);
          const isCodeOrTbl =
            tag === 'PRE' ||
            tag === 'TABLE' ||
            clHas(added, 'code-block') ||
            clHas(added, 'md-table-host') ||
            clHas(added, 'md-table-frame') ||
            Boolean(qs(added, 'pre, table, .code-block, .md-table-frame'));
          if (isCodeOrTbl) {
            if (!scannedNodes.has(added) && now - lastCodeAt >= STREAM_BATCH_MS) {
              scannedNodes.add(added);
              lastCodeAt = now;
              snapTextLens(added, 16);
              markStreamClass(added, 'ag-cs-code-scan', 240);
            }
          } else if (inAnimBlock || (INLINE_TAGS.has(tag) && baseEl !== proseRoot)) {
            fadeLeafTexts(added, now, 4);
          } else if (!seenBlocks.has(added) && newBlocks < 4) {
            seenBlocks.add(added);
            newBlocks++;
            snapTextLens(added, 12);
            markStreamClass(added, 'ag-cs-stream-chunk', 310);
          } else {
            fadeLeafTexts(added, now, 4);
          }
        }
      }
    }

    function syncDualStreamEngine() {
      const active = canStreamMotion() && isConvRunning();
      const conv = active ? findFormalConvView() : null;
      if (!active || !conv) {
        if (streamObs) {
          try {
            streamObs.disconnect();
          } catch {}
          streamRoot = null;
        }
        flushAllStreamArtifacts(!canStreamMotion());
        return;
      }

      const triggers = qsa(conv, '[data-testid="thinking-collapsible-trigger"]');
      for (let i = 0; i < triggers.length; i++) {
        const trig = triggers[i];
        const bodyDiv = trig.nextElementSibling;
        if (!bodyDiv || tagOf(bodyDiv) !== 'DIV') continue;
        const streaming =
          ga(trig, 'aria-expanded') === 'true' &&
          (ga(trig, 'data-op-thought-state') === 'streaming' ||
            /\.\.\.|…|正在|思考中|thinking/i.test(String(trig.textContent || '')) ||
            i === triggers.length - 1);
        if (streaming) setAttrIfChanged(bodyDiv, 'data-ag-cs-thought-streaming', '1');
        else if (ha(bodyDiv, 'data-ag-cs-thought-streaming')) ra(bodyDiv, 'data-ag-cs-thought-streaming');
      }

      if (!streamObs && typeof MutationObserver === 'function') streamObs = new MutationObserver(onStreamMutations);
      if (streamObs && streamRoot !== conv) {
        try {
          streamObs.disconnect();
          const resps = qsa(conv, '[data-testid="planner-response-text"]');
          if (resps.length > 0) snapTextLens(resps[resps.length - 1], 24);
          if (triggers.length > 0) {
            const lb = triggers[triggers.length - 1]?.nextElementSibling;
            if (lb && !isManagedThoughtPanel(lb)) snapTextLens(lb, 16);
          }
          streamObs.observe(conv, { childList: true, characterData: true, subtree: true });
          streamRoot = conv;
        } catch {}
      }
    }

    function measureNewLensOverlays() {
      const d = docOf();
      if (!isMotionStandardOrUltra() || !d) return [];
      const cands = new Set([
        ...qsa(d, '.agy-overlay, .agy-fastpick, div[role="dialog"], [data-testid="context-menu-popup"], [data-testid="context-menu-submenu-popup"]'),
      ]);
      for (const el of qsa(d, '[data-testid="overview-panel"]')) {
        const p = peOf(el);
        if (p && tagOf(p) === 'DIV') cands.add(p);
      }
      const out = [];
      for (const ov of cands) {
        if (!seenOverlays.has(ov)) out.push({ ov, rect: rectOf(ov) });
      }
      return out;
    }

    function syncLensOverlayOrigins(measuredOverlays) {
      const d = docOf();
      if (!d) return;
      for (const el of qsa(d, '[data-testid="overview-panel"]')) {
        const p = peOf(el);
        if (p && tagOf(p) === 'DIV') setAttrIfChanged(p, 'data-ag-cs-overview-shell', '1');
      }
      if (!isMotionStandardOrUltra()) return;
      const trig = heroState.lastTriggerOrigin;
      for (const { ov, rect: r } of measuredOverlays || measureNewLensOverlays()) {
        if (seenOverlays.has(ov)) continue;
        seenOverlays.add(ov);
        if (trig && r && r.width > 0 && r.height > 0) {
          setProp(ov, '--ag-origin-x', `${Math.round(Math.max(-40, Math.min(r.width + 40, trig.x - r.left)))}px`);
          setProp(ov, '--ag-origin-y', `${Math.round(Math.max(-40, Math.min(r.height + 40, trig.y - r.top)))}px`);
        }
        let idx = 0;
        for (const item of qsa(ov, '[role="option"], [role="menuitem"], [data-testid]')) {
          const role = ga(item, 'role');
          const tid = ga(item, 'data-testid') || '';
          if (
            role === 'option' ||
            role === 'menuitem' ||
            tid.startsWith('overview-panel-row-') ||
            tid === 'subagent-node' ||
            tid === 'artifact-row'
          ) {
            setProp(item, '--ag-row-i', String(idx++));
            if (idx >= 12) break;
          }
        }
      }
    }

    function scheduleDeferredConvEntry(fn, delayMs = 65) {
      if (convEntryTimer) clearTimeout(convEntryTimer);
      convEntryTimer = setTimeout(() => {
        convEntryTimer = 0;
        if (!isDestroyed()) fn();
      }, delayMs);
    }

    function disconnectStreamObserver() {
      if (streamObs) {
        try {
          streamObs.disconnect();
        } catch {}
        streamObs = null;
        streamRoot = null;
      }
      flushAllStreamArtifacts(true);
    }

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
      sampleHomeComposerRect,
      triggerHomeLiftoffRippleBurst,
      triggerHeroDFiberPulse,
      triggerHeroESonar,
      measureSidebarSelectionSnapshot,
      measureVisibleChangedHeaders,
      syncHeroCCaustics,
      syncHeroRouteChoreography,
      flushAllStreamArtifacts,
      onStreamMutations,
      syncDualStreamEngine,
      disconnectStreamObserver,
      measureNewLensOverlays,
      syncLensOverlayOrigins,
      scheduleDeferredConvEntry,
      isStreamMutating: () => streamMutating,
      hasStreamObserver: () => Boolean(streamObs && streamRoot),
      stepHighlightFade,
      clearHighlightFade,
      getHighlightFadeState: () => ({
        activeCount: fadeItems.length,
        rafActive: Boolean(fadeRaf),
        buckets: hlBuckets ? hlBuckets.map((h) => h.size ?? 0) : [],
      }),
    };
  }

  const api = { STREAM_BATCH_MS, STREAM_FADE_MS, HIGHLIGHT_NAMES, createStreamChoreographyController };
  if (typeof module === 'object' && module.exports) module.exports = api;
  G.__agPrismStreamChoreography = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
