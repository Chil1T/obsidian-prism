// Obsidian Prism 共享 DOM 观察总线、三档任务调度器、零回流尺寸/可见性观察与双拍 Batcher
// 暴露 window.__agDomBus / window.__agPrismDomBus 与 window.__agPrismPerfCaps()，零外部依赖，支持完整 dispose()/destroy()
(function (root, factory) {
  const api = factory(root);
  if (root) { root.__agPrismDomBus = root.__agDomBus = api; root.__agPrismPerfCaps = api.getPerfCaps; }
  if (typeof window !== 'undefined' && window && window !== root) {
    window.__agPrismDomBus = window.__agDomBus = api;
    window.__agPrismPerfCaps = api.getPerfCaps;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function (G) {
  'use strict';

  const BUSY_ATTR = 'data-ag-perf-busy', PERF_MODE_ATTR = 'data-ag-cs-perf-mode', STREAM_ATTR = 'data-ag-cs-stream-active';
  const PERF_CHANGE_EVENT = 'ag-prism-perf-mode-change', SCROLL_HOLD_MS = 200, LOW_STREAM_THROTTLE_MS = 180, DEFAULT_IO_MARGIN = '250px 0px';
  const PASSIVE_CAP = Object.freeze({ capture: true, passive: true });
  const OFF_PREFIX = 'html[data-ag-cs-style][data-ag-cs-motion="off"] :is(';
  const OFF_PSEUDO = '[data-testid="status-loading-spinner"],[data-testid="input-cancel-button"],[data-ag-cs-row-running="1"],[data-ag-sub-running="1"],[data-ag-overview-running="1"],[data-ag-sp-running="1"],[data-ag-cs-caustic="1"],[data-ag-cs-fiber-camp],[data-ag-cs-thought-streaming="1"],.ag-cs-sidebar-glide-pill,.agy-scroll-bottom)';
  const MOTION_OFF_SCOPED_CSS =
    OFF_PREFIX + 'button,[role="button"],[role="menuitem"],[role="option"],[role="tab"],[role="switch"],div[role="dialog"],.agy-overlay,.agy-overlay-item,.agy-fastpick,.agy-scroll-bottom,.agy-selection-pill,.agy-toast,.surface-composer-card,.agy-composer-footer,.ag-cs-home-panel,.ag-cs-ctx-menu,.ag-cs-ctx-toast,.ag-cs-model-glyph,.ag-cs-thinking-spark,.ag-cs-smooth-caret,.ag-cs-stream-chunk,.ag-cs-thought-chunk,.ag-cs-code-scan,.ag-prism-thought-chunk,.ag-cs-liftoff-veil,.ag-cs-liftoff-ring,.ag-cs-sidebar-glide-pill,[data-testid="status-loading-spinner"],[data-testid="conversation-row-sidebar"],[data-testid="conversation-row-history"],[data-testid="step-plan"],[data-testid="step-plan-item"],[data-testid="queued-messages-card"],[data-testid="interaction-takeover-card"],[data-ag-cs-overview-shell="1"],[data-ag-row-stagger="1"],[data-ag-cs-sonar="1"],[data-ag-cs-caustic="1"],[data-ag-cs-fiber-camp],[data-ag-cs-thought-streaming="1"],[data-ag-cs-row-running="1"],[data-ag-sub-running="1"],[data-ag-overview-running="1"],[data-ag-sp-running="1"]),' +
    OFF_PREFIX + OFF_PSEUDO + '::before,' + OFF_PREFIX + OFF_PSEUDO + '::after{animation:none!important;transition:none!important}';

  const PERF_CAPS_TABLE = Object.freeze({
    performance: Object.freeze({ mode: 'performance', maxFps: 60, minFrameGapMs: 15.2, maxDpr: 1, disableHeavyBlur: true, lowPriorityThrottleMs: 200, chunkBudgetMs: 2.5 }),
    balanced: Object.freeze({ mode: 'balanced', maxFps: 180, minFrameGapMs: 0, maxDpr: 1.5, disableHeavyBlur: false, lowPriorityThrottleMs: 180, chunkBudgetMs: 3.5 }),
    quality: Object.freeze({ mode: 'quality', maxFps: 0, minFrameGapMs: 0, maxDpr: 2, disableHeavyBlur: false, lowPriorityThrottleMs: 160, chunkBudgetMs: 4.5 }),
  });

  const normalizePerformanceMode = (raw) => {
    if (typeof raw !== 'string') return 'balanced';
    const low = raw.trim().toLowerCase();
    return low === 'performance' || low === 'eco' ? 'performance' : low === 'quality' ? 'quality' : 'balanced';
  };
  const normPriority = (p) => (p === 'user-blocking' || p === 'background' ? p : 'user-visible');
  const nowMs = () => (typeof performance !== 'undefined' && performance && typeof performance.now === 'function' ? performance.now() : Date.now());

  function readBoxSize(entry) {
    if (!entry) return null;
    const bb = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : entry.borderBoxSize;
    if (bb && Number.isFinite(bb.inlineSize) && Number.isFinite(bb.blockSize)) return { width: bb.inlineSize, height: bb.blockSize, source: 'borderBoxSize', entry };
    const cb = Array.isArray(entry.contentBoxSize) ? entry.contentBoxSize[0] : entry.contentBoxSize;
    if (cb && Number.isFinite(cb.inlineSize) && Number.isFinite(cb.blockSize)) return { width: cb.inlineSize, height: cb.blockSize, source: 'contentBoxSize', entry };
    const cr = entry.contentRect;
    return cr && Number.isFinite(cr.width) && Number.isFinite(cr.height) ? { width: cr.width, height: cr.height, source: 'contentRect', entry } : null;
  }

  function createDomBus(envDoc, envWin) {
    let boundDoc = envDoc || null, boundWin = envWin || null;
    let rootObserver = null, observedTarget = null, observedKey = '', subSeq = 0;
    const subscribers = new Map(), measureQueue = new Map(), mutateQueue = new Map();
    const scheduledTasks = new Map(), sizeCbs = new Map(), visEntries = new Map(), ioPools = new Map();
    let sizeCache = new WeakMap(), skippedEls = new WeakSet(), ioSkippedEls = new WeakSet();
    let sizeObserver = null, docVisAttached = false, docVisTarget = null, lastVisEv = null;
    let batchKeySeq = 0, taskKeySeq = 0, batchScheduled = false, batchRafId = 0, batchTimerId = 0, flushingBatch = false;
    let scrollBusy = false, scrollHoldTimer = 0, streamBusy = false, manualBusyUntil = 0, manualBusyTimer = 0;
    let listenersAttached = false, currentPerfMode = '', activeChunkEpoch = 0, msgChannel = null;
    const pendingMcResolvers = [];

    const getDoc = (o) => o || boundDoc || (typeof document !== 'undefined' ? document : null);
    const getWin = (o, d) => o || boundWin || (d && d.defaultView) || (typeof window !== 'undefined' ? window : G);
    const getHtml = (o) => { const d = getDoc(o); return d && d.documentElement ? d.documentElement : null; };
    const setAttr = (h, k, v) => { if (h) try { if (typeof h.setAttribute === 'function' && (typeof h.getAttribute !== 'function' || h.getAttribute(k) !== v)) h.setAttribute(k, v); } catch {} };
    const rmAttr = (h, k) => { if (h) try { if (typeof h.removeAttribute === 'function' && (typeof h.hasAttribute !== 'function' || h.hasAttribute(k))) h.removeAttribute(k); } catch {} };
    const cancelBatchRaf = (winOverride) => {
      if (!batchRafId) return;
      const w = getWin(winOverride), cRaf = (w && typeof w.cancelAnimationFrame === 'function' && w.cancelAnimationFrame) || (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null);
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
      if (scrollBusy || streamBusy || manualBusyUntil > nowMs()) setAttr(h, BUSY_ATTR, '1'); else rmAttr(h, BUSY_ATTR);
    }
    function bumpScrollBusy(holdMs) {
      const delay = typeof holdMs === 'number' && holdMs >= 0 ? holdMs : SCROLL_HOLD_MS;
      scrollBusy = true; syncBusyAttr();
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
      try { target[fnName]('scroll', onPassiveScrollOrWheel, PASSIVE_CAP); target[fnName]('wheel', onPassiveScrollOrWheel, PASSIVE_CAP); listenersAttached = on; }
      catch { if (!on) listenersAttached = false; }
    }
    const attachListeners = (d, w) => { toggleListeners(true, d, w); attachDocVisListeners(d); };
    const detachListeners = () => { toggleListeners(false); detachDocVisListeners(); };
    const setStreaming = (active) => { streamBusy = Boolean(active); syncBusyAttr(); };

    function bumpBusy(holdMs) {
      const ms = typeof holdMs === 'number' && holdMs > 0 ? holdMs : SCROLL_HOLD_MS;
      const until = nowMs() + ms;
      if (until > manualBusyUntil) manualBusyUntil = until;
      syncBusyAttr();
      if (manualBusyTimer) clearTimeout(manualBusyTimer);
      manualBusyTimer = setTimeout(() => { manualBusyTimer = 0; if (nowMs() >= manualBusyUntil) { manualBusyUntil = 0; syncBusyAttr(); } }, ms + 4);
    }
    const isBusy = () => scrollBusy || isStreamingActive() || manualBusyUntil > nowMs();

    // Single Root MutationObserver + 按订阅过滤路由（0 冗余跨界回调）
    function computeObserveOptions() {
      let childList = false, subtree = false, attributes = false, characterData = false, allFiltered = true;
      const attrSet = new Set();
      for (const sub of subscribers.values()) {
        const o = sub.observeOptions;
        if (o.childList !== false) childList = true;
        if (o.subtree !== false) subtree = true;
        if (o.attributes) {
          attributes = true;
          if (Array.isArray(o.attributeFilter) && o.attributeFilter.length > 0) for (let i = 0; i < o.attributeFilter.length; i++) attrSet.add(o.attributeFilter[i]);
          else allFiltered = false;
        }
        if (o.characterData) characterData = true;
      }
      const merged = { childList, subtree };
      if (attributes) { merged.attributes = true; if (allFiltered && attrSet.size > 0) merged.attributeFilter = Array.from(attrSet).sort(); }
      if (characterData) merged.characterData = true;
      return merged;
    }

    function matchSubRecord(sub, m) {
      if (!m) return false;
      const t = m.type;
      if (t === 'childList') { if (!sub.wantChildList) return false; }
      else if (t === 'characterData') { if (!sub.wantCharacterData) return false; }
      else if (t === 'attributes') { if (!sub.wantAttributes || (sub.attrSet && m.attributeName && !sub.attrSet.has(m.attributeName))) return false; }
      if (sub.rootOnly && m.target && observedTarget && m.target !== observedTarget) return false;
      return sub.filter ? Boolean(sub.filter(m)) : true;
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
        let matched = null;
        if (sub.passAll) matched = mutations;
        else {
          for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];
            if (matchSubRecord(sub, m)) { if (!matched) matched = []; matched.push(m); }
          }
        }
        if (!matched || !matched.length) continue;
        if (sub.priority === 'low' && (highLoad || sub.throttleMs > 0)) {
          const waitMs = highLoad ? Math.max(sub.throttleMs || 0, caps.lowPriorityThrottleMs || LOW_STREAM_THROTTLE_MS) : sub.throttleMs;
          for (let i = 0; i < matched.length; i++) sub.pending.push(matched[i]);
          const elapsed = now - sub.lastRunAt;
          if (elapsed >= waitMs && !sub.timer) flushSubPending(sub);
          else if (!sub.timer) sub.timer = setTimeout(() => flushSubPending(sub), Math.max(16, waitMs - elapsed));
          continue;
        }
        if (sub.pending.length) { for (let i = 0; i < matched.length; i++) sub.pending.push(matched[i]); flushSubPending(sub); }
        else { sub.lastRunAt = now; try { sub.handler(matched); } catch {} }
      }
    }

    function drainMutations() {
      if (!rootObserver || typeof rootObserver.takeRecords !== 'function') return [];
      let recs = [];
      try { recs = rootObserver.takeRecords() || []; } catch { return []; }
      if (recs.length) dispatchMutations(recs);
      return recs;
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
      const o = opts.observeOptions && typeof opts.observeOptions === 'object'
        ? opts.observeOptions
        : { childList: true, subtree: true, attributes: Boolean(opts.attributes), attributeFilter: opts.attributeFilter };
      const wantChildList = o.childList !== false, wantCharacterData = Boolean(o.characterData), wantAttributes = Boolean(o.attributes);
      const attrSet = wantAttributes && Array.isArray(o.attributeFilter) && o.attributeFilter.length > 0 ? new Set(o.attributeFilter) : null;
      const rootOnly = o.subtree === false, filterFn = typeof opts.filter === 'function' ? opts.filter : null;
      const entry = {
        id, handler, priority: opts.priority === 'high' || opts.priority === 'low' ? opts.priority : 'normal',
        filter: filterFn, throttleMs: typeof opts.throttleMs === 'number' && opts.throttleMs > 0 ? opts.throttleMs : 0,
        observeOptions: o, wantChildList, wantCharacterData, wantAttributes, attrSet, rootOnly,
        passAll: !filterFn && !rootOnly && wantChildList && wantCharacterData && wantAttributes && !attrSet,
        pending: [], timer: 0, lastRunAt: 0,
      };
      subscribers.set(id, entry);
      attachListeners(); reconcileObserver();
      return () => {
        const cur = subscribers.get(id);
        if (cur !== entry) return;
        if (cur.timer) { clearTimeout(cur.timer); cur.timer = 0; }
        cur.pending.length = 0; subscribers.delete(id); reconcileObserver();
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
      const w = getWin(), raf = (w && typeof w.requestAnimationFrame === 'function' && w.requestAnimationFrame) || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null);
      if (raf) batchRafId = raf(() => flushBatch()); else batchTimerId = setTimeout(() => flushBatch(), 0);
    }
    function enqueuePhase(queue, prefix, key, fn) {
      const cb = typeof key === 'function' ? key : fn;
      const k = typeof key === 'function' || key === null || key === undefined || key === '' ? prefix + ++batchKeySeq : key;
      if (typeof cb !== 'function') return;
      queue.set(k, cb); scheduleBatch();
    }
    const measure = (key, fn) => enqueuePhase(measureQueue, '__m_', key, fn);
    const mutate = (key, fn) => enqueuePhase(mutateQueue, '__w_', key, fn);
    function flushNow() { cancelBatchRaf(); if (batchTimerId) { clearTimeout(batchTimerId); batchTimerId = 0; } flushBatch(); }

    // MessageChannel 微调度 + scheduler.yield()
    function postMc(cb) {
      const w = getWin(), MC = (w && w.MessageChannel) || (typeof MessageChannel === 'function' ? MessageChannel : null);
      if (!MC) return false;
      try {
        if (!msgChannel) { msgChannel = new MC(); msgChannel.port1.onmessage = () => { const fn = pendingMcResolvers.shift(); if (fn) fn(); }; }
        pendingMcResolvers.push(cb); msgChannel.port2.postMessage(null); return true;
      } catch { return false; }
    }
    function yieldSlice() {
      const w = getWin(), sched = (w && w.scheduler) || (typeof scheduler !== 'undefined' ? scheduler : null);
      if (sched && typeof sched.yield === 'function') { try { return sched.yield(); } catch {} }
      return new Promise((resolve) => { if (!postMc(resolve)) setTimeout(resolve, 0); });
    }

    // 浏览器级三档调度器：scheduler.postTask + TaskController（支持 abort/setPriority）+ rIC/MessageChannel 降级
    function clearFallbackHandles(rec) {
      if (rec.timerId) { clearTimeout(rec.timerId); rec.timerId = 0; }
      if (rec.idleId) {
        const w = getWin(), cIc = (w && typeof w.cancelIdleCallback === 'function' && w.cancelIdleCallback) || (typeof cancelIdleCallback === 'function' ? cancelIdleCallback : null);
        try { if (cIc) cIc(rec.idleId); } catch {}
        rec.idleId = 0;
      }
      rec.mcGen++;
    }
    const finishTask = (rec) => { if (scheduledTasks.get(rec.key) === rec) scheduledTasks.delete(rec.key); rec.done = true; };
    function runFallbackTask(rec) {
      if (rec.cancelled || rec.done || rec.controller?.signal?.aborted) { finishTask(rec); rec.resolve(undefined); return; }
      finishTask(rec);
      try { rec.resolve(rec.fn()); } catch (err) { rec.reject(err); }
    }
    function armFallbackTask(rec, delayMs) {
      clearFallbackHandles(rec);
      if (rec.cancelled || rec.done) return;
      if (delayMs > 0) { rec.timerId = setTimeout(() => { rec.timerId = 0; armFallbackTask(rec, 0); }, delayMs); rec.timerId?.unref?.(); return; }
      const gen = rec.mcGen;
      if (rec.priority === 'user-blocking') {
        if (!postMc(() => { if (rec.mcGen === gen) runFallbackTask(rec); })) { rec.timerId = setTimeout(() => { rec.timerId = 0; runFallbackTask(rec); }, 0); rec.timerId?.unref?.(); }
      } else if (rec.priority === 'background') {
        const w = getWin(), rIc = (w && typeof w.requestIdleCallback === 'function' && w.requestIdleCallback) || (typeof requestIdleCallback === 'function' ? requestIdleCallback : null);
        if (rIc) { try { rec.idleId = rIc(() => { rec.idleId = 0; runFallbackTask(rec); }, { timeout: 250 }); return; } catch {} }
        rec.timerId = setTimeout(() => { rec.timerId = 0; runFallbackTask(rec); }, 16); rec.timerId?.unref?.();
      } else {
        rec.timerId = setTimeout(() => { rec.timerId = 0; runFallbackTask(rec); }, 0); rec.timerId?.unref?.();
      }
    }
    function cancelTask(key) {
      const rec = scheduledTasks.get(key);
      if (!rec) return false;
      rec.cancelled = true; finishTask(rec); clearFallbackHandles(rec);
      try { rec.controller?.abort?.(); } catch {}
      try { rec.resolve?.(undefined); } catch {}
      return true;
    }
    function cancelGroup(prefix) {
      if (typeof prefix !== 'string' || !prefix) return 0;
      const keys = [];
      for (const k of scheduledTasks.keys()) if (k === prefix || k.startsWith(prefix)) keys.push(k);
      for (let i = 0; i < keys.length; i++) cancelTask(keys[i]);
      return keys.length;
    }
    function reprioritizeTask(key, nextPriority) {
      const rec = scheduledTasks.get(key);
      if (!rec || rec.cancelled || rec.done) return false;
      const norm = normPriority(nextPriority);
      rec.priority = norm;
      if (rec.controller && typeof rec.controller.setPriority === 'function') { try { rec.controller.setPriority(norm); return true; } catch {} }
      if (rec.mode === 'fallback') { armFallbackTask(rec, 0); return true; }
      return false;
    }
    function scheduleTask(arg1, arg2, arg3) {
      let key = '', fn = null, opts = {};
      if (typeof arg1 === 'function') { fn = arg1; opts = arg2 && typeof arg2 === 'object' ? arg2 : {}; }
      else { key = String(arg1 || ''); fn = arg2; opts = arg3 && typeof arg3 === 'object' ? arg3 : {}; }
      if (typeof fn !== 'function') return Promise.resolve(undefined);
      key = key || 'task-' + ++taskKeySeq;
      cancelTask(key);
      const priority = normPriority(opts.priority), delay = typeof opts.delay === 'number' && opts.delay > 0 ? opts.delay : 0;
      const w = getWin(), sched = (w && w.scheduler) || (typeof scheduler !== 'undefined' ? scheduler : null);
      const TC = (w && typeof w.TaskController === 'function' && w.TaskController) || (typeof TaskController === 'function' ? TaskController : null);
      const AC = (w && typeof w.AbortController === 'function' && w.AbortController) || (typeof AbortController === 'function' ? AbortController : null);
      let resFn = null, rejFn = null;
      const outPromise = new Promise((res, rej) => { resFn = res; rejFn = rej; });
      const rec = { key, fn, priority, delay, cancelled: false, done: false, mode: 'fallback', controller: null, timerId: 0, idleId: 0, mcGen: 0, resolve: resFn, reject: rejFn };
      scheduledTasks.set(key, rec);
      if (sched && typeof sched.postTask === 'function') {
        try {
          rec.mode = 'native';
          let postOpts;
          if (TC) { rec.controller = new TC({ priority }); postOpts = delay > 0 ? { signal: rec.controller.signal, delay } : { signal: rec.controller.signal }; }
          else if (AC) { rec.controller = new AC(); postOpts = delay > 0 ? { signal: rec.controller.signal, priority, delay } : { signal: rec.controller.signal, priority }; }
          else postOpts = delay > 0 ? { priority, delay } : { priority };
          Promise.resolve(sched.postTask(() => {
            if (rec.cancelled || rec.done || rec.controller?.signal?.aborted) { finishTask(rec); return undefined; }
            finishTask(rec); return rec.fn();
          }, postOpts)).then(
            (v) => { finishTask(rec); resFn(v); },
            (err) => { finishTask(rec); if (rec.cancelled || rec.controller?.signal?.aborted || (err && err.name === 'AbortError')) resFn(undefined); else rejFn(err); }
          );
          outPromise.cancel = () => cancelTask(key); outPromise.reprioritize = (p) => reprioritizeTask(key, p);
          return outPromise;
        } catch { rec.mode = 'fallback'; }
      }
      rec.controller = AC ? new AC() : { signal: { aborted: false }, abort() { this.signal.aborted = true; } };
      armFallbackTask(rec, delay);
      outPromise.cancel = () => cancelTask(key); outPromise.reprioritize = (p) => reprioritizeTask(key, p);
      return outPromise;
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
        fn(list[i], i); processed++;
        if (i + 1 < list.length && nowMs() - sliceStart >= budgetMs) {
          await yieldSlice();
          if (myEpoch !== activeChunkEpoch || (signal && signal.aborted)) return { processed, slices, aborted: true };
          slices++; sliceStart = nowMs();
        }
      }
      return { processed, slices, aborted: false };
    }

    // 零回流尺寸观察：共享 ResizeObserver，优先读 entry.borderBoxSize[0]
    function ensureSizeObserver() {
      if (sizeObserver) return sizeObserver;
      const w = getWin(), RO = (w && typeof w.ResizeObserver === 'function' && w.ResizeObserver) || (typeof ResizeObserver === 'function' ? ResizeObserver : null);
      if (!RO) return null;
      try {
        sizeObserver = new RO((entries) => {
          for (let i = 0; entries && i < entries.length; i++) {
            const en = entries[i], el = en && en.target, sz = el ? readBoxSize(en) : null;
            if (!sz) continue;
            sizeCache.set(el, sz);
            const set = sizeCbs.get(el);
            if (set) for (const cb of set) { try { cb(sz, en); } catch {} }
          }
        });
      } catch { sizeObserver = null; }
      return sizeObserver;
    }
    function observeSize(el, cb) {
      if (!el || typeof cb !== 'function') return () => {};
      let set = sizeCbs.get(el);
      const isNew = !set;
      if (!set) { set = new Set(); sizeCbs.set(el, set); }
      set.add(cb);
      const ro = ensureSizeObserver();
      if (ro && isNew) { try { ro.observe(el); } catch {} }
      return () => {
        const cur = sizeCbs.get(el);
        if (!cur) return;
        cur.delete(cb);
        if (cur.size === 0) {
          sizeCbs.delete(el);
          if (sizeObserver) {
            try { sizeObserver.unobserve(el); } catch {}
            if (sizeCbs.size === 0) { try { sizeObserver.disconnect(); } catch {} sizeObserver = null; }
          }
        }
      };
    }
    const getSize = (el) => (el ? sizeCache.get(el) || null : null);

    // 可见性观察 + content-visibility:auto 屏外跳过标记 + beforematch 补扫兜底 + 共享 IO(250px)
    function emitVisibility(el, visible, source, detail) {
      const rec = visEntries.get(el);
      if (!rec || !rec.cbs.size) return;
      const info = { visible: Boolean(visible), skipped: !visible, isIntersecting: Boolean(visible), source, detail };
      for (const cb of rec.cbs) { try { cb(info); } catch {} }
    }
    const onContentVisChange = (ev) => {
      if (ev && ev === lastVisEv) return;
      lastVisEv = ev || null;
      const t = ev && ev.target;
      if (!t || (t.nodeType !== undefined && t.nodeType !== 1)) return;
      const skipped = Boolean(ev.skipped);
      if (skipped) skippedEls.add(t); else skippedEls.delete(t);
      emitVisibility(t, !skipped, 'content-visibility', ev);
    };
    const onBeforeMatch = (ev) => {
      if (ev && ev === lastVisEv) return;
      lastVisEv = ev || null;
      const t = ev && ev.target;
      if (!t || (t.nodeType !== undefined && t.nodeType !== 1)) return;
      skippedEls.delete(t); ioSkippedEls.delete(t);
      emitVisibility(t, true, 'beforematch', ev);
    };
    function attachDocVisListeners(docOverride) {
      if (docVisAttached) return;
      const d = getDoc(docOverride);
      if (!d || typeof d.addEventListener !== 'function') return;
      try {
        d.addEventListener('contentvisibilityautostatechange', onContentVisChange, PASSIVE_CAP);
        d.addEventListener('beforematch', onBeforeMatch, PASSIVE_CAP);
        docVisAttached = true; docVisTarget = d;
      } catch {}
    }
    function detachDocVisListeners() {
      if (!docVisAttached) return;
      const d = docVisTarget || getDoc();
      if (d && typeof d.removeEventListener === 'function') {
        try { d.removeEventListener('contentvisibilityautostatechange', onContentVisChange, PASSIVE_CAP); d.removeEventListener('beforematch', onBeforeMatch, PASSIVE_CAP); } catch {}
      }
      docVisAttached = false; docVisTarget = null;
    }
    function ensureIoPool(rootMargin) {
      const key = typeof rootMargin === 'string' && rootMargin ? rootMargin : DEFAULT_IO_MARGIN;
      let pool = ioPools.get(key);
      if (pool) return pool;
      const w = getWin(), IO = (w && typeof w.IntersectionObserver === 'function' && w.IntersectionObserver) || (typeof IntersectionObserver === 'function' ? IntersectionObserver : null);
      if (!IO) return null;
      try {
        const io = new IO((entries) => {
          for (let i = 0; entries && i < entries.length; i++) {
            const en = entries[i], t = en && en.target;
            if (!t) continue;
            if (en.isIntersecting) ioSkippedEls.delete(t); else ioSkippedEls.add(t);
            emitVisibility(t, Boolean(en.isIntersecting) && !skippedEls.has(t), 'io', en);
          }
        }, { rootMargin: key });
        pool = { io, els: new Set(), key }; ioPools.set(key, pool);
        return pool;
      } catch { return null; }
    }
    function observeVisibility(el, cb, opts) {
      if (!el || typeof cb !== 'function') return () => {};
      const cfg = opts && typeof opts === 'object' ? opts : {};
      attachDocVisListeners(cfg.doc);
      let rec = visEntries.get(el);
      if (!rec) {
        const rm = typeof cfg.rootMargin === 'string' && cfg.rootMargin ? cfg.rootMargin : DEFAULT_IO_MARGIN;
        let unbindEl = null;
        if (typeof el.addEventListener === 'function') {
          const onElCv = (ev) => onContentVisChange(ev && ev.target ? ev : { target: el, skipped: Boolean(ev && ev.skipped) });
          const onElBm = (ev) => onBeforeMatch(ev && ev.target ? ev : { target: el });
          try {
            el.addEventListener('contentvisibilityautostatechange', onElCv, { passive: true });
            el.addEventListener('beforematch', onElBm, { passive: true });
            unbindEl = () => { try { el.removeEventListener('contentvisibilityautostatechange', onElCv, { passive: true }); el.removeEventListener('beforematch', onElBm, { passive: true }); } catch {} };
          } catch {}
        }
        let pool = null;
        if (cfg.io !== false) { pool = ensureIoPool(rm); if (pool) { try { pool.io.observe(el); pool.els.add(el); } catch { pool = null; } } }
        rec = { cbs: new Set(), unbindEl, pool }; visEntries.set(el, rec);
      }
      rec.cbs.add(cb);
      return () => {
        const cur = visEntries.get(el);
        if (!cur) return;
        cur.cbs.delete(cb);
        if (cur.cbs.size === 0) {
          visEntries.delete(el);
          if (cur.unbindEl) { try { cur.unbindEl(); } catch {} }
          if (cur.pool) {
            try { cur.pool.io.unobserve(el); } catch {}
            cur.pool.els.delete(el);
            if (cur.pool.els.size === 0) { try { cur.pool.io.disconnect(); } catch {} ioPools.delete(cur.pool.key); }
          }
          ioSkippedEls.delete(el);
        }
      };
    }
    function isSkipped(el) {
      if (!el) return false;
      if (ioSkippedEls.has(el) || skippedEls.has(el)) return true;
      for (let cur = el.parentElement, hops = 0; cur && hops < 12; cur = cur.parentElement, hops++) if (skippedEls.has(cur)) return true;
      return false;
    }

    // 无损 performanceMode（仅写 data-ag-cs-perf-mode，绝不改写视觉配置项）
    function applyPerformanceMode(mode, docOverride, winOverride) {
      const norm = normalizePerformanceMode(mode), d = getDoc(docOverride), w = getWin(winOverride, d), h = getHtml(d);
      const prev = currentPerfMode || (h && h.getAttribute?.(PERF_MODE_ATTR)) || '';
      currentPerfMode = norm;
      if (h) { try { if (h.dataset) h.dataset.agCsPerfMode = norm; } catch {} setAttr(h, PERF_MODE_ATTR, norm); }
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
      if (h) { try { raw = (h.dataset && h.dataset.agCsPerfMode) || (typeof h.getAttribute === 'function' ? h.getAttribute(PERF_MODE_ATTR) : '') || ''; } catch {} }
      return PERF_CAPS_TABLE[normalizePerformanceMode(raw || currentPerfMode || 'balanced')];
    }

    function dispose(docOverride, winOverride) {
      activeChunkEpoch++;
      for (const key of Array.from(scheduledTasks.keys())) cancelTask(key);
      scheduledTasks.clear();
      for (const sub of subscribers.values()) { if (sub.timer) clearTimeout(sub.timer); sub.pending.length = 0; }
      subscribers.clear();
      if (rootObserver) { try { rootObserver.disconnect(); } catch {} rootObserver = null; }
      observedTarget = null; observedKey = '';
      if (sizeObserver) { try { sizeObserver.disconnect(); } catch {} sizeObserver = null; }
      sizeCbs.clear(); sizeCache = new WeakMap();
      for (const rec of visEntries.values()) if (rec.unbindEl) { try { rec.unbindEl(); } catch {} }
      visEntries.clear();
      for (const pool of ioPools.values()) { try { pool.io.disconnect(); } catch {} pool.els.clear(); }
      ioPools.clear();
      skippedEls = new WeakSet(); ioSkippedEls = new WeakSet(); lastVisEv = null;
      cancelBatchRaf(winOverride);
      if (batchTimerId) { clearTimeout(batchTimerId); batchTimerId = 0; }
      batchScheduled = false; measureQueue.clear(); mutateQueue.clear();
      if (scrollHoldTimer) { clearTimeout(scrollHoldTimer); scrollHoldTimer = 0; }
      if (manualBusyTimer) { clearTimeout(manualBusyTimer); manualBusyTimer = 0; }
      scrollBusy = false; streamBusy = false; manualBusyUntil = 0; currentPerfMode = '';
      detachListeners();
      while (pendingMcResolvers.length) { try { pendingMcResolvers.shift()(); } catch {} }
      if (msgChannel) { try { msgChannel.port1.onmessage = null; msgChannel.port1.close?.(); msgChannel.port2.close?.(); } catch {} msgChannel = null; }
      const h = getHtml(docOverride);
      if (h) { rmAttr(h, BUSY_ATTR); rmAttr(h, PERF_MODE_ATTR); try { if (h.dataset && 'agCsPerfMode' in h.dataset) delete h.dataset.agCsPerfMode; } catch {} }
    }

    return {
      BUSY_ATTR, PERF_MODE_ATTR, STREAM_ATTR, MOTION_OFF_SCOPED_CSS, PERF_CAPS_TABLE,
      attach: attachListeners, subscribe, drainMutations, measure, mutate, flushNow,
      scheduleTask, cancelTask, cancelGroup, reprioritizeTask, yieldSlice, runChunked,
      observeSize, getSize, readBoxSize, observeVisibility, isSkipped,
      setStreaming, bumpBusy, bumpScrollBusy, isBusy, isStreaming: isStreamingActive,
      normalizePerformanceMode, applyPerformanceMode, getPerfCaps,
      getDebugState: () => ({
        subscriberCount: subscribers.size, observing: Boolean(rootObserver), listenersAttached,
        scrollBusy, streamBusy, busy: isBusy(), perfMode: getPerfCaps().mode,
        pendingMeasures: measureQueue.size, pendingMutates: mutateQueue.size,
        pendingTasks: scheduledTasks.size, sizeObservedCount: sizeCbs.size, visibilityObservedCount: visEntries.size,
      }),
      dispose, destroy: dispose, createInstance: createDomBus,
    };
  }

  return createDomBus(null, null);
});
