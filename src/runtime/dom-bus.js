// Obsidian Prism 共享 DOM 观察总线、双拍 Read/Write Batcher、时间切片与无损性能档位引擎
// 暴露 window.__agPrismDomBus 与 window.__agPrismPerfCaps()，零外部依赖，支持完整 dispose()
(function (root, factory) {
  const api = factory(root);
  if (root) { root.__agPrismDomBus = api; root.__agPrismPerfCaps = api.getPerfCaps; }
  if (typeof window !== 'undefined' && window && window !== root) {
    window.__agPrismDomBus = api;
    window.__agPrismPerfCaps = api.getPerfCaps;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function (G) {
  'use strict';

  const BUSY_ATTR = 'data-ag-perf-busy';
  const PERF_MODE_ATTR = 'data-ag-cs-perf-mode';
  const STREAM_ATTR = 'data-ag-cs-stream-active';
  const PERF_CHANGE_EVENT = 'ag-prism-perf-mode-change';
  const SCROLL_HOLD_MS = 200;
  const LOW_STREAM_THROTTLE_MS = 180;
  const PASSIVE_CAP = Object.freeze({ capture: true, passive: true });
  const OFF_PREFIX = 'html[data-ag-cs-style][data-ag-cs-motion="off"] :is(';
  const OFF_PSEUDO = '[data-testid="status-loading-spinner"],[data-testid="input-cancel-button"],[data-ag-cs-row-running="1"],[data-ag-sub-running="1"],[data-ag-overview-running="1"],[data-ag-sp-running="1"],[data-ag-cs-caustic="1"],[data-ag-cs-fiber-camp],[data-ag-cs-thought-streaming="1"],.ag-cs-sidebar-glide-pill,.agy-scroll-bottom)';

  // motionLevel="off" 精准作用域禁用规则（零全树 * 通配符）
  const MOTION_OFF_SCOPED_CSS =
    OFF_PREFIX + 'button,[role="button"],[role="menuitem"],[role="option"],[role="tab"],[role="switch"],div[role="dialog"],.agy-overlay,.agy-overlay-item,.agy-fastpick,.agy-scroll-bottom,.agy-selection-pill,.agy-toast,.surface-composer-card,.agy-composer-footer,.ag-cs-home-panel,.ag-cs-ctx-menu,.ag-cs-ctx-toast,.ag-cs-model-glyph,.ag-cs-thinking-spark,.ag-cs-smooth-caret,.ag-cs-stream-chunk,.ag-cs-thought-chunk,.ag-cs-code-scan,.ag-prism-thought-chunk,.ag-cs-liftoff-veil,.ag-cs-liftoff-ring,.ag-cs-sidebar-glide-pill,[data-testid="status-loading-spinner"],[data-testid="conversation-row-sidebar"],[data-testid="conversation-row-history"],[data-testid="step-plan"],[data-testid="step-plan-item"],[data-testid="queued-messages-card"],[data-testid="interaction-takeover-card"],[data-ag-cs-overview-shell="1"],[data-ag-row-stagger="1"],[data-ag-cs-sonar="1"],[data-ag-cs-caustic="1"],[data-ag-cs-fiber-camp],[data-ag-cs-thought-streaming="1"],[data-ag-cs-row-running="1"],[data-ag-sub-running="1"],[data-ag-overview-running="1"],[data-ag-sp-running="1"]),' +
    OFF_PREFIX + OFF_PSEUDO + '::before,' +
    OFF_PREFIX + OFF_PSEUDO + '::after{animation:none!important;transition:none!important}';

  const PERF_CAPS_TABLE = Object.freeze({
    performance: Object.freeze({ mode: 'performance', maxFps: 60, minFrameGapMs: 15.2, maxDpr: 1, disableHeavyBlur: true, lowPriorityThrottleMs: 200, chunkBudgetMs: 2.5 }),
    balanced: Object.freeze({ mode: 'balanced', maxFps: 180, minFrameGapMs: 0, maxDpr: 1.5, disableHeavyBlur: false, lowPriorityThrottleMs: 180, chunkBudgetMs: 3.5 }),
    quality: Object.freeze({ mode: 'quality', maxFps: 0, minFrameGapMs: 0, maxDpr: 2, disableHeavyBlur: false, lowPriorityThrottleMs: 160, chunkBudgetMs: 4.5 }),
  });

  function normalizePerformanceMode(raw) {
    if (typeof raw !== 'string') return 'balanced';
    const low = raw.trim().toLowerCase();
    return low === 'performance' || low === 'eco' ? 'performance' : low === 'quality' ? 'quality' : 'balanced';
  }

  const nowMs = () => (typeof performance !== 'undefined' && performance && typeof performance.now === 'function' ? performance.now() : Date.now());

  function createDomBus(envDoc, envWin) {
    let boundDoc = envDoc || null, boundWin = envWin || null;
    let rootObserver = null, observedTarget = null, observedKey = '', subSeq = 0;
    const subscribers = new Map(), measureQueue = new Map(), mutateQueue = new Map();
    let batchKeySeq = 0, batchScheduled = false, batchRafId = 0, batchTimerId = 0, flushingBatch = false;
    let scrollBusy = false, scrollHoldTimer = 0, streamBusy = false, manualBusyUntil = 0, manualBusyTimer = 0;
    let listenersAttached = false, currentPerfMode = '', activeChunkEpoch = 0, msgChannel = null;
    const pendingMcResolvers = [];

    const getDoc = (o) => o || boundDoc || (typeof document !== 'undefined' ? document : null);
    const getWin = (o, d) => o || boundWin || (d && d.defaultView) || (typeof window !== 'undefined' ? window : G);
    const getHtml = (o) => { const d = getDoc(o); return d && d.documentElement ? d.documentElement : null; };
    const setAttr = (h, k, v) => {
      if (!h) return;
      try { if (typeof h.setAttribute === 'function' && (typeof h.getAttribute !== 'function' || h.getAttribute(k) !== v)) h.setAttribute(k, v); } catch {}
    };
    const rmAttr = (h, k) => {
      if (!h) return;
      try { if (typeof h.removeAttribute === 'function' && (typeof h.hasAttribute !== 'function' || h.hasAttribute(k))) h.removeAttribute(k); } catch {}
    };
    const cancelBatchRaf = (winOverride) => {
      if (!batchRafId) return;
      const w = getWin(winOverride);
      const cRaf = (w && typeof w.cancelAnimationFrame === 'function' && w.cancelAnimationFrame) ||
        (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null);
      try { if (cRaf) cRaf(batchRafId); } catch {}
      batchRafId = 0;
    };

    function isStreamingActive(docOverride) {
      if (streamBusy) return true;
      const h = getHtml(docOverride);
      try { return Boolean(h && typeof h.getAttribute === 'function' && h.getAttribute(STREAM_ATTR) === '1'); } catch { return false; }
    }

    function syncBusyAttr(docOverride) {
      const h = getHtml(docOverride);
      if (!h) return;
      if (scrollBusy || streamBusy || manualBusyUntil > nowMs()) setAttr(h, BUSY_ATTR, '1');
      else rmAttr(h, BUSY_ATTR);
    }

    function bumpScrollBusy(holdMs) {
      const delay = typeof holdMs === 'number' && holdMs >= 0 ? holdMs : SCROLL_HOLD_MS;
      scrollBusy = true;
      syncBusyAttr();
      if (scrollHoldTimer) clearTimeout(scrollHoldTimer);
      scrollHoldTimer = setTimeout(() => { scrollHoldTimer = 0; scrollBusy = false; syncBusyAttr(); }, delay);
    }

    const onPassiveScrollOrWheel = () => bumpScrollBusy(SCROLL_HOLD_MS);

    function toggleListeners(on, docOverride, winOverride) {
      if (on) { if (docOverride) boundDoc = docOverride; if (winOverride) boundWin = winOverride; }
      if (on === listenersAttached) return;
      const d = getDoc(), w = getWin(null, d), fnName = on ? 'addEventListener' : 'removeEventListener';
      const target = w && typeof w[fnName] === 'function' ? w : d;
      if (!target || typeof target[fnName] !== 'function') { if (!on) listenersAttached = false; return; }
      try {
        target[fnName]('scroll', onPassiveScrollOrWheel, PASSIVE_CAP);
        target[fnName]('wheel', onPassiveScrollOrWheel, PASSIVE_CAP);
        listenersAttached = on;
      } catch { if (!on) listenersAttached = false; }
    }
    const attachListeners = (d, w) => toggleListeners(true, d, w);
    const detachListeners = () => toggleListeners(false);

    function setStreaming(active) { streamBusy = Boolean(active); syncBusyAttr(); }

    function bumpBusy(holdMs) {
      const ms = typeof holdMs === 'number' && holdMs > 0 ? holdMs : SCROLL_HOLD_MS;
      const until = nowMs() + ms;
      if (until > manualBusyUntil) manualBusyUntil = until;
      syncBusyAttr();
      if (manualBusyTimer) clearTimeout(manualBusyTimer);
      manualBusyTimer = setTimeout(() => {
        manualBusyTimer = 0;
        if (nowMs() >= manualBusyUntil) { manualBusyUntil = 0; syncBusyAttr(); }
      }, ms + 4);
    }

    const isBusy = () => scrollBusy || isStreamingActive() || manualBusyUntil > nowMs();

    // Single Root MutationObserver + 订阅路由
    function computeObserveOptions() {
      let childList = false, subtree = false, attributes = false, characterData = false, allFiltered = true;
      const attrSet = new Set();
      for (const sub of subscribers.values()) {
        const o = sub.observeOptions;
        if (o.childList !== false) childList = true;
        if (o.subtree !== false) subtree = true;
        if (o.attributes) {
          attributes = true;
          if (Array.isArray(o.attributeFilter) && o.attributeFilter.length > 0) {
            for (let i = 0; i < o.attributeFilter.length; i++) attrSet.add(o.attributeFilter[i]);
          } else allFiltered = false;
        }
        if (o.characterData) characterData = true;
      }
      const merged = { childList, subtree };
      if (attributes) { merged.attributes = true; if (allFiltered && attrSet.size > 0) merged.attributeFilter = Array.from(attrSet).sort(); }
      if (characterData) merged.characterData = true;
      return merged;
    }

    function flushSubPending(sub) {
      if (sub.timer) { clearTimeout(sub.timer); sub.timer = 0; }
      if (!sub.pending.length) return;
      const batch = sub.pending.splice(0, sub.pending.length);
      sub.lastRunAt = nowMs();
      try { sub.handler(batch); } catch {}
    }

    function dispatchMutations(mutations) {
      if (!mutations || !mutations.length || subscribers.size === 0) return;
      const highLoad = isStreamingActive() || scrollBusy, caps = getPerfCaps(), now = nowMs();
      for (const sub of subscribers.values()) {
        const matched = sub.filter ? mutations.filter(sub.filter) : mutations;
        if (!matched.length) continue;
        if (sub.priority === 'low' && (highLoad || sub.throttleMs > 0)) {
          const waitMs = highLoad ? Math.max(sub.throttleMs || 0, caps.lowPriorityThrottleMs || LOW_STREAM_THROTTLE_MS) : sub.throttleMs;
          for (let i = 0; i < matched.length; i++) sub.pending.push(matched[i]);
          const elapsed = now - sub.lastRunAt;
          if (elapsed >= waitMs && !sub.timer) flushSubPending(sub);
          else if (!sub.timer) sub.timer = setTimeout(() => flushSubPending(sub), Math.max(16, waitMs - elapsed));
          continue;
        }
        if (sub.pending.length) {
          for (let i = 0; i < matched.length; i++) sub.pending.push(matched[i]);
          flushSubPending(sub);
        } else {
          sub.lastRunAt = now;
          try { sub.handler(matched); } catch {}
        }
      }
    }

    function reconcileObserver() {
      if (subscribers.size === 0) {
        if (rootObserver) { try { rootObserver.disconnect(); } catch {} rootObserver = null; }
        observedTarget = null; observedKey = '';
        return;
      }
      const d = getDoc(), w = getWin(null, d), target = getHtml(d) || (d && d.body) || null;
      const MO = (w && w.MutationObserver) || (typeof MutationObserver === 'function' ? MutationObserver : null);
      if (!target || typeof MO !== 'function') return;
      const opts = computeObserveOptions(), key = JSON.stringify(opts);
      if (rootObserver && observedTarget === target && observedKey === key) return;
      if (rootObserver) { try { rootObserver.disconnect(); } catch {} }
      rootObserver = new MO(dispatchMutations);
      observedTarget = target; observedKey = key;
      try { rootObserver.observe(target, opts); } catch {}
    }

    function subscribe(arg1, arg2, arg3) {
      let id = '', handler = null, opts = {};
      if (typeof arg1 === 'function') { handler = arg1; opts = arg2 && typeof arg2 === 'object' ? arg2 : {}; }
      else if (typeof arg1 === 'string' && typeof arg2 === 'function') { id = arg1; handler = arg2; opts = arg3 && typeof arg3 === 'object' ? arg3 : {}; }
      else if (arg1 && typeof arg1 === 'object' && typeof arg2 === 'function') { opts = arg1; handler = arg2; }
      if (typeof handler !== 'function') return () => {};
      id = id || opts.id || 'sub-' + ++subSeq;
      if (opts.doc) boundDoc = opts.doc;
      if (opts.win) boundWin = opts.win;
      const prev = subscribers.get(id);
      if (prev && prev.timer) clearTimeout(prev.timer);
      const entry = {
        id, handler,
        priority: opts.priority === 'high' || opts.priority === 'low' ? opts.priority : 'normal',
        filter: typeof opts.filter === 'function' ? opts.filter : null,
        throttleMs: typeof opts.throttleMs === 'number' && opts.throttleMs > 0 ? opts.throttleMs : 0,
        observeOptions: opts.observeOptions && typeof opts.observeOptions === 'object'
          ? opts.observeOptions
          : { childList: true, subtree: true, attributes: Boolean(opts.attributes), attributeFilter: opts.attributeFilter },
        pending: [], timer: 0, lastRunAt: 0,
      };
      subscribers.set(id, entry);
      attachListeners();
      reconcileObserver();
      return () => {
        const cur = subscribers.get(id);
        if (cur !== entry) return;
        if (cur.timer) { clearTimeout(cur.timer); cur.timer = 0; }
        cur.pending.length = 0;
        subscribers.delete(id);
        reconcileObserver();
      };
    }

    // 双拍 Read/Write Batcher（先全量 measure 读几何，再统一 mutate 写 DOM）
    function flushBatch() {
      batchScheduled = false; batchRafId = 0; batchTimerId = 0;
      if (flushingBatch) return;
      flushingBatch = true;
      try {
        const reads = Array.from(measureQueue.values()); measureQueue.clear();
        for (let i = 0; i < reads.length; i++) { try { reads[i](); } catch {} }
        const writes = Array.from(mutateQueue.values()); mutateQueue.clear();
        for (let i = 0; i < writes.length; i++) { try { writes[i](); } catch {} }
      } finally {
        flushingBatch = false;
        if (measureQueue.size > 0 || mutateQueue.size > 0) scheduleBatch();
      }
    }

    function scheduleBatch() {
      if (batchScheduled) return;
      batchScheduled = true;
      const w = getWin();
      const raf = (w && typeof w.requestAnimationFrame === 'function' && w.requestAnimationFrame) ||
        (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null);
      if (raf) batchRafId = raf(() => flushBatch());
      else batchTimerId = setTimeout(() => flushBatch(), 0);
    }

    function enqueuePhase(queue, prefix, key, fn) {
      const cb = typeof key === 'function' ? key : fn;
      const k = typeof key === 'function' || key === null || key === undefined || key === '' ? prefix + ++batchKeySeq : key;
      if (typeof cb !== 'function') return;
      queue.set(k, cb);
      scheduleBatch();
    }

    const measure = (key, fn) => enqueuePhase(measureQueue, '__m_', key, fn);
    const mutate = (key, fn) => enqueuePhase(mutateQueue, '__w_', key, fn);

    function flushNow() {
      cancelBatchRaf();
      if (batchTimerId) { clearTimeout(batchTimerId); batchTimerId = 0; }
      flushBatch();
    }

    // 时间切片 runChunked：scheduler.yield -> MessageChannel -> setTimeout(0)
    function yieldSlice() {
      const w = getWin();
      const sched = (w && w.scheduler) || (typeof scheduler !== 'undefined' ? scheduler : null);
      if (sched && typeof sched.yield === 'function') { try { return sched.yield(); } catch {} }
      const MC = (w && w.MessageChannel) || (typeof MessageChannel === 'function' ? MessageChannel : null);
      if (MC) {
        try {
          if (!msgChannel) {
            msgChannel = new MC();
            msgChannel.port1.onmessage = () => { const fn = pendingMcResolvers.shift(); if (fn) fn(); };
          }
          return new Promise((resolve) => { pendingMcResolvers.push(resolve); msgChannel.port2.postMessage(null); });
        } catch {}
      }
      return new Promise((resolve) => setTimeout(resolve, 0));
    }

    async function runChunked(items, fn, opts) {
      const list = items ? (Array.isArray(items) ? items : Array.from(items)) : [];
      if (!list.length || typeof fn !== 'function') return { processed: 0, slices: 0, aborted: false };
      const cfg = opts && typeof opts === 'object' ? opts : {};
      const budgetMs = typeof cfg.budgetMs === 'number' && cfg.budgetMs > 0 ? cfg.budgetMs : getPerfCaps().chunkBudgetMs || 3.5;
      const signal = cfg.signal || null, myEpoch = activeChunkEpoch;
      let processed = 0, slices = 1, sliceStart = nowMs();
      for (let i = 0; i < list.length; i++) {
        if (myEpoch !== activeChunkEpoch || (signal && signal.aborted)) return { processed, slices, aborted: true };
        fn(list[i], i);
        processed++;
        if (i + 1 < list.length && nowMs() - sliceStart >= budgetMs) {
          await yieldSlice();
          if (myEpoch !== activeChunkEpoch || (signal && signal.aborted)) return { processed, slices, aborted: true };
          slices++; sliceStart = nowMs();
        }
      }
      return { processed, slices, aborted: false };
    }

    // 无损 performanceMode（仅写 data-ag-cs-perf-mode，绝不改写视觉配置项）
    function applyPerformanceMode(mode, docOverride, winOverride) {
      const norm = normalizePerformanceMode(mode);
      const d = getDoc(docOverride), w = getWin(winOverride, d), h = getHtml(d);
      const prev = currentPerfMode || (h && h.getAttribute?.(PERF_MODE_ATTR)) || '';
      currentPerfMode = norm;
      if (h) {
        try { if (h.dataset) h.dataset.agCsPerfMode = norm; } catch {}
        setAttr(h, PERF_MODE_ATTR, norm);
      }
      if (prev && prev !== norm && w && typeof w.dispatchEvent === 'function') {
        try {
          const CE = w.CustomEvent || (typeof CustomEvent === 'function' ? CustomEvent : null);
          const detail = { mode: norm, caps: PERF_CAPS_TABLE[norm] };
          w.dispatchEvent(CE ? new CE(PERF_CHANGE_EVENT, { detail }) : { type: PERF_CHANGE_EVENT, detail });
        } catch {}
      }
      return norm;
    }

    function getPerfCaps(modeOverride, docOverride) {
      if (typeof modeOverride === 'string' && modeOverride) return PERF_CAPS_TABLE[normalizePerformanceMode(modeOverride)];
      const h = getHtml(docOverride);
      let raw = '';
      if (h) {
        try { raw = (h.dataset && h.dataset.agCsPerfMode) || (typeof h.getAttribute === 'function' ? h.getAttribute(PERF_MODE_ATTR) : '') || ''; } catch {}
      }
      return PERF_CAPS_TABLE[normalizePerformanceMode(raw || currentPerfMode || 'balanced')];
    }

    function dispose(docOverride, winOverride) {
      activeChunkEpoch++;
      for (const sub of subscribers.values()) { if (sub.timer) clearTimeout(sub.timer); sub.pending.length = 0; }
      subscribers.clear();
      if (rootObserver) { try { rootObserver.disconnect(); } catch {} rootObserver = null; }
      observedTarget = null; observedKey = '';
      cancelBatchRaf(winOverride);
      if (batchTimerId) { clearTimeout(batchTimerId); batchTimerId = 0; }
      batchScheduled = false; measureQueue.clear(); mutateQueue.clear();
      if (scrollHoldTimer) { clearTimeout(scrollHoldTimer); scrollHoldTimer = 0; }
      if (manualBusyTimer) { clearTimeout(manualBusyTimer); manualBusyTimer = 0; }
      scrollBusy = false; streamBusy = false; manualBusyUntil = 0; currentPerfMode = '';
      detachListeners();
      while (pendingMcResolvers.length) { try { pendingMcResolvers.shift()(); } catch {} }
      if (msgChannel) {
        try { msgChannel.port1.onmessage = null; msgChannel.port1.close?.(); msgChannel.port2.close?.(); } catch {}
        msgChannel = null;
      }
      const h = getHtml(docOverride);
      if (h) {
        rmAttr(h, BUSY_ATTR); rmAttr(h, PERF_MODE_ATTR);
        try { if (h.dataset && 'agCsPerfMode' in h.dataset) delete h.dataset.agCsPerfMode; } catch {}
      }
    }

    return {
      BUSY_ATTR, PERF_MODE_ATTR, STREAM_ATTR, MOTION_OFF_SCOPED_CSS, PERF_CAPS_TABLE,
      attach: attachListeners, subscribe, measure, mutate, flushNow, runChunked,
      setStreaming, bumpBusy, bumpScrollBusy, isBusy, isStreaming: isStreamingActive,
      normalizePerformanceMode, applyPerformanceMode, getPerfCaps,
      getDebugState: () => ({
        subscriberCount: subscribers.size, observing: Boolean(rootObserver), listenersAttached,
        scrollBusy, streamBusy, busy: isBusy(), perfMode: getPerfCaps().mode,
        pendingMeasures: measureQueue.size, pendingMutates: mutateQueue.size,
      }),
      dispose, createInstance: createDomBus,
    };
  }

  return createDomBus(null, null);
});
