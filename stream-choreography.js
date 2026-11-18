// Obsidian Prism — Hero A~E Route Choreography, Dual-Track Streaming, Collapsible Auto-Unfold & Lens Module (stream-choreography.js)
// Extracted from ui-runtime.js: manages living thinking sparks, smart 2-tier auto-unfold, Hero A~E transitions,
// React-Fiber-safe dual-track streaming tags, and cryo-lens overlay origins.

(function (root) {
  'use strict';
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : window);
  if (!G) return;

  const STREAM_BATCH_MS = 52;
  const TABLE_TAGS = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD']);
  const CODE_OR_TABLE_TAGS = new Set(['PRE', 'CODE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD']);

  function isElementLike(n) {
    return Boolean(n && (n.nodeType === 1 || (n.nodeType === undefined && typeof n.tagName === 'string')));
  }

  function createStreamChoreographyController({
    motionEngine,
    isDestroyed,
    isComposerRestyleEnabled,
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
    let deferredHydrateRaf = 0;
    let deferredSparkQueue = [];
    let deferredIconQueue = [];

    let workedForClickTimer = 0;
    let deferredConvEntryTimer = 0;
    const transientTimers = new Set();

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
      pendingModelShiftNotify: false,
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

    let streamObserver = null;
    let streamObservedRoot = null;
    let streamMutating = false;
    let lastProseWrapAt = -1000;
    let lastThoughtWrapAt = -1000;
    let lastCodeScanAt = -1000;
    let scannedStreamNodes = new WeakSet();

    // Coalesced transient class expiry queue (eliminates per-span setTimeout storms during Swarm code streaming)
    const expirableClassEntries = new Map();
    let classSweepTimer = 0;

    function flushExpiredClasses() {
      classSweepTimer = 0;
      if (expirableClassEntries.size === 0) return;
      const now = Date.now();
      let nextDue = Infinity;
      runGuardedMut(() => {
        for (const [el, map] of expirableClassEntries.entries()) {
          for (const [cls, expAt] of map.entries()) {
            if (now >= expAt - 2) {
              el.classList?.remove?.(cls);
              map.delete(cls);
            } else if (expAt < nextDue) {
              nextDue = expAt;
            }
          }
          if (map.size === 0) expirableClassEntries.delete(el);
        }
      });
      if (!isDestroyed() && expirableClassEntries.size > 0 && Number.isFinite(nextDue)) {
        const waitMs = Math.max(16, Math.ceil(nextDue - Date.now()));
        classSweepTimer = setTimeout(flushExpiredClasses, waitMs);
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
      if (deferredConvEntryTimer) {
        clearTimeout(deferredConvEntryTimer);
        deferredConvEntryTimer = 0;
      }
      if (workedForClickTimer) {
        clearTimeout(workedForClickTimer);
        workedForClickTimer = 0;
      }
      if (classSweepTimer) {
        clearTimeout(classSweepTimer);
        classSweepTimer = 0;
      }
      expirableClassEntries.clear();
      for (const id of transientTimers) clearTimeout(id);
      transientTimers.clear();
    }

    function cancelDeferredHydration() {
      if (deferredHydrateRaf && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(deferredHydrateRaf);
      }
      deferredHydrateRaf = 0;
      deferredSparkQueue = [];
      deferredIconQueue = [];
    }

    function applySingleSparkUpdate(trig, brand, st) {
      if (!trig || trig.isConnected === false) return;
      if (st === 'streaming') {
        setAttrIfChanged(trig, 'data-ag-cs-spark-streaming', '1');
      } else if (trig.hasAttribute('data-ag-cs-spark-streaming')) {
        trig.removeAttribute('data-ag-cs-spark-streaming');
      }
      let spark = trig.firstElementChild?.classList?.contains('ag-cs-thinking-spark')
        ? trig.firstElementChild
        : trig.querySelector('.ag-cs-thinking-spark');
      if (!spark) {
        spark = document.createElement('span');
        spark.className = 'ag-cs-thinking-spark';
        spark.setAttribute('aria-hidden', 'true');
        spark.setAttribute('data-ag-no-i18n', '');
        trig.insertBefore(spark, trig.firstChild);
      }
      const isMono =
        typeof document !== 'undefined' && document.documentElement?.getAttribute?.('data-ag-cs-accent') === 'mono';
      const monoVal = isMono ? '1' : '0';
      if (
        spark.getAttribute('data-brand') !== brand ||
        spark.getAttribute('data-state') !== st ||
        spark.getAttribute('data-mono') !== monoVal
      ) {
        spark.setAttribute('data-brand', brand);
        spark.setAttribute('data-state', st);
        spark.setAttribute('data-mono', monoVal);
        const key = `spark:${brand}:${monoVal}`;
        const svgStr = buildBrandMarkSvg(brand, 13, 'auto', isMono);
        const cloned = cloneCachedSvgElement(key, svgStr);
        if (cloned && typeof spark.replaceChildren === 'function') {
          spark.replaceChildren(cloned);
        } else {
          spark.innerHTML = svgStr;
        }
      }
    }

    function stepDeferredHydration() {
      deferredHydrateRaf = 0;
      if (isDestroyed()) return;
      runGuardedMut(() => {
        let budget = 18;
        while (budget > 0 && deferredSparkQueue.length > 0) {
          const item = deferredSparkQueue.pop();
          applySingleSparkUpdate(item.trig, item.brand, item.st);
          budget--;
        }
        while (budget > 0 && deferredIconQueue.length > 0) {
          const item = deferredIconQueue.pop();
          if (!item.btn.getAttribute('data-ag-cs-icon-injected')) {
            applySingleHostIcon(item.btn, item.iconName, item.origSvg, item.size);
          }
          budget--;
        }
      });
      if ((deferredSparkQueue.length > 0 || deferredIconQueue.length > 0) && typeof requestAnimationFrame === 'function') {
        deferredHydrateRaf = requestAnimationFrame(stepDeferredHydration);
      }
    }

    function scheduleDeferredHydration() {
      if (isDestroyed() || deferredHydrateRaf || typeof requestAnimationFrame !== 'function') return;
      deferredHydrateRaf = requestAnimationFrame(stepDeferredHydration);
    }

    function enqueueDeferredIcons(items) {
      deferredIconQueue = items;
      scheduleDeferredHydration();
    }

    function syncThinkingSparks(primaryModelInfo) {
      if (isDestroyed() || typeof document === 'undefined') return;
      const triggers = document.querySelectorAll('[data-testid="thinking-collapsible-trigger"]');
      const brand = primaryModelInfo?.brand || 'gemini';
      const monoVal = document.documentElement?.getAttribute?.('data-ag-cs-accent') === 'mono' ? '1' : '0';
      const len = triggers.length;
      const pending = [];
      for (let i = 0; i < len; i++) {
        const trig = triggers[i];
        const spark = trig.firstElementChild?.classList?.contains('ag-cs-thinking-spark')
          ? trig.firstElementChild
          : trig.querySelector('.ag-cs-thinking-spark');
        if (
          i < len - 2 &&
          spark &&
          spark.getAttribute('data-state') === 'done' &&
          spark.getAttribute('data-brand') === brand &&
          spark.getAttribute('data-mono') === monoVal &&
          !trig.hasAttribute('data-ag-cs-spark-streaming')
        ) {
          continue;
        }
        const txt = String(trig.textContent || '');
        const st = /\.\.\.|…|正在|思考中|thinking/i.test(txt) ? 'streaming' : 'done';
        if (
          spark &&
          spark.getAttribute('data-brand') === brand &&
          spark.getAttribute('data-state') === st &&
          spark.getAttribute('data-mono') === monoVal &&
          Boolean(st === 'streaming') === trig.hasAttribute('data-ag-cs-spark-streaming')
        ) {
          continue;
        }
        pending.push({ trig, brand, st });
      }
      if (pending.length <= 16 || typeof requestAnimationFrame !== 'function') {
        for (let i = 0; i < pending.length; i++) {
          applySingleSparkUpdate(pending[i].trig, pending[i].brand, pending[i].st);
        }
      } else {
        const syncStart = pending.length - 12;
        for (let i = syncStart; i < pending.length; i++) {
          applySingleSparkUpdate(pending[i].trig, pending[i].brand, pending[i].st);
        }
        deferredSparkQueue = pending.slice(0, syncStart);
        scheduleDeferredHydration();
      }
    }

    function clearWorkedForAutoUnfoldAttrs() {
      document.querySelectorAll('[data-ag-cs-auto-unfolded]').forEach((el) => el.removeAttribute('data-ag-cs-auto-unfolded'));
      document.querySelectorAll('[data-ag-cs-outer-open]').forEach((el) => el.removeAttribute('data-ag-cs-outer-open'));
    }

    function processSingleWorkedForOuter(btn) {
      if (!btn || btn.isConnected === false) return;
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      let scope = btn.nextElementSibling;
      if (!scope) {
        let sib = btn.nextSibling;
        while (sib && sib.nodeType && sib.nodeType !== 1) sib = sib.nextSibling;
        scope = sib || null;
      }
      if (!scope) scope = btn.parentElement;
      const innerBtns = scope ? scope.querySelectorAll('[data-testid="tool-group-collapsible"]') : [];
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

    function syncWorkedForAutoUnfold(dirtyTargets = null) {
      if (isDestroyed()) {
        clearWorkedForAutoUnfoldAttrs();
        return;
      }
      if (dirtyTargets && dirtyTargets.size > 0) {
        const outers = new Set();
        for (const node of dirtyTargets) {
          if (!node || node.isConnected === false) continue;
          if (node.getAttribute?.('data-testid') === 'worked-for-collapsible') {
            outers.add(node);
            continue;
          }
          const prevOuter = node.previousElementSibling;
          if (prevOuter && prevOuter.getAttribute?.('data-testid') === 'worked-for-collapsible') {
            outers.add(prevOuter);
          }
          if (typeof node.querySelectorAll === 'function') {
            node.querySelectorAll('[data-testid="worked-for-collapsible"]').forEach((b) => outers.add(b));
          }
          let cur = node.parentElement;
          while (cur && cur !== document.body) {
            const sib = cur.previousElementSibling;
            if (sib && sib.getAttribute?.('data-testid') === 'worked-for-collapsible') {
              outers.add(sib);
              break;
            }
            cur = cur.parentElement;
          }
        }
        for (const btn of outers) processSingleWorkedForOuter(btn);
        return;
      }
      const outers = document.querySelectorAll('[data-testid="worked-for-collapsible"]');
      for (const btn of outers) processSingleWorkedForOuter(btn);
    }

    function scheduleWorkedForClickSync() {
      if (isDestroyed()) return;
      if (workedForClickTimer) clearTimeout(workedForClickTimer);
      workedForClickTimer = setTimeout(() => {
        workedForClickTimer = 0;
        if (!isDestroyed()) syncWorkedForAutoUnfold();
      }, 28);
    }

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
      if (!isMotionUltra() || !rippleCtl) return;
      rippleCtl.triggerLiftoffBurst(rect);
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
      if (rippleCtl) rippleCtl.triggerTideSwell();
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
              { durationMs: 220, delayStep: 24, stepMs: 24, stiffness: 360, damping: 30, slot: 'home-return' }
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
      const rowRunStates = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (selIdx < 0 && r.getAttribute('data-selected') === 'true') {
          selIdx = i;
          selRow = r;
        }
        rowRunStates.push({ row: r, running: Boolean(r.querySelector?.('[data-testid="status-loading-spinner"]')) });
      }
      if (!selRow) return { empty: false, selIdx: -1, selRow: null, curSnap: null, listRect: null, scrollTop: 0, rowRunStates };
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
      return { empty: false, selIdx, selRow, curSnap, listRect, scrollTop, rowRunStates };
    }

    function syncSidebarSelectionGlide(measuredSidebar) {
      if (!measuredSidebar) return;
      const sidebarOff =
        typeof document !== 'undefined' && document.documentElement?.getAttribute?.('data-ag-cs-sidebar') === 'off';
      if (sidebarOff) {
        document.querySelectorAll('.ag-cs-sidebar-glide-pill').forEach((n) => n.remove());
        if (measuredSidebar.rowRunStates) {
          for (let i = 0; i < measuredSidebar.rowRunStates.length; i++) {
            const { row } = measuredSidebar.rowRunStates[i];
            if (row?.hasAttribute?.('data-ag-cs-row-running')) row.removeAttribute('data-ag-cs-row-running');
          }
        }
        heroState.sidebarInitialized = false;
        heroState.sidebarIndex = -1;
        heroState.sidebarRow = null;
        heroState.sidebarRect = null;
        return;
      }
      const snap = measuredSidebar;
      if (snap.rowRunStates) {
        for (let i = 0; i < snap.rowRunStates.length; i++) {
          const { row, running } = snap.rowRunStates[i];
          if (running) setAttrIfChanged(row, 'data-ag-cs-row-running', '1');
          else if (row.hasAttribute?.('data-ag-cs-row-running')) row.removeAttribute('data-ag-cs-row-running');
        }
      }
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
        notifyMascot('files-changed');
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
        const auraPhase = convAuraCtl?.getInstance?.()?.phase || '';
        const errDom =
          typeof document !== 'undefined' &&
          typeof document.querySelector === 'function' &&
          document.querySelector(
            '[data-testid="conversation-view"] [data-testid="agent-error-banner"], [data-testid="conversation-view"] [data-testid="error-message"]'
          );
        const haltedByError = auraPhase === 'error-halted' || Boolean(errDom);
        if (haltedByError) {
          convAuraCtl?.triggerErrorHalted?.(now);
          notifyMascot('streamDone', { error: true, durationMs: elapsed });
        } else {
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
          if (elapsed >= 15000) {
            convAuraCtl?.triggerLongTaskComplete?.(now);
          }
          notifyMascot('complete', { durationMs: elapsed });
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
      const conv = navTurn.closest?.('[data-testid="conversation-view"]') || findFormalConvView();
      if (!conv) return;
      let turns = conv.querySelectorAll('[data-testid="user-input-step"]');
      if (!turns || turns.length === 0) turns = conv.querySelectorAll('[data-testid="conversation-turn"]');
      if (!turns || turns.length === 0) turns = conv.querySelectorAll('[data-testid="user-message-bubble"]');
      if (!turns || turns.length === 0) return;

      let idx = -1;
      const rawAttr = navTurn.getAttribute?.('data-turn-index') ?? navTurn.getAttribute?.('data-index');
      if (rawAttr !== null && rawAttr !== undefined && /^\d+$/.test(String(rawAttr).trim())) {
        idx = parseInt(String(rawAttr).trim(), 10);
      } else if (navTurn.getAttribute?.('data-testid') === 'conversation-navigator-group') {
        idx = 0;
      } else {
        const navRoot = navTurn.closest?.('[data-testid="conversation-navigator"]') || navTurn.parentElement;
        if (navRoot) {
          const sibs = Array.from(navRoot.querySelectorAll('[data-testid="conversation-navigator-turn"]'));
          const relIdx = sibs.indexOf(navTurn);
          if (relIdx >= 0) {
            const offset = Math.max(0, turns.length - sibs.length);
            idx = Math.min(turns.length - 1, offset + relIdx);
          }
        }
      }
      if (idx < 0 || idx >= turns.length) return;
      const target = turns[idx];
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

      if (inHome) {
        const homeEl = document.querySelector('.agy-home');
        const sheet = homeEl?.closest?.('.agy-sheet');
        if (sheet) setAttrIfChanged(sheet, 'data-ag-cs-home-sheet', '1');
      }
      if (formalConv) {
        const seat = formalConv.parentElement;
        if (seat && String(seat.tagName || '').toUpperCase() === 'DIV') {
          setAttrIfChanged(seat, 'data-ag-cs-conv-seat', '1');
        }
        const vp = formalConv.querySelector?.('[data-testid="autoscroll-viewport"]');
        if (vp && vp.parentElement && vp.parentElement !== formalConv) {
          setAttrIfChanged(vp.parentElement, 'data-ag-cs-vp-wrap', '1');
        }
      }

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

      if (measured && measured.sidebarSnap) {
        syncSidebarSelectionGlide(measured.sidebarSnap);
      }
      if (!measured || measured.checkCaustics !== false) {
        syncHeroCCaustics(measured?.visibleChangedHeaders);
      }
    }

    function isBlockCodeElement(el, stopAt) {
      if (!isElementLike(el)) return false;
      const tag = String(el.tagName || '').toUpperCase();
      if (tag === 'PRE') return true;
      const cls = el.classList;
      if (cls && (cls.contains('code-block') || cls.contains('code-line'))) return true;
      if (tag === 'CODE') {
        let p = el.parentElement;
        while (p && p !== stopAt) {
          const pt = String(p.tagName || '').toUpperCase();
          if (pt === 'PRE' || p.classList?.contains?.('code-block')) return true;
          p = p.parentElement;
        }
        return false;
      }
      return false;
    }

    function isInsideCodeOrTable(node, stopAt) {
      let cur = isElementLike(node) ? node : node?.parentElement;
      while (cur && cur !== stopAt) {
        const tag = String(cur.tagName || '').toUpperCase();
        if (TABLE_TAGS.has(tag)) return cur;
        if (isBlockCodeElement(cur, stopAt)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }

    function findTableRowAncestor(node, stopAt) {
      let cur = isElementLike(node) ? node : node?.parentElement;
      while (cur && cur !== stopAt) {
        if (String(cur.tagName || '').toUpperCase() === 'TR') return cur;
        cur = cur.parentElement;
      }
      return null;
    }

    function flushAllStreamArtifacts() {
      if (classSweepTimer) {
        clearTimeout(classSweepTimer);
        classSweepTimer = 0;
      }
      scannedStreamNodes = new WeakSet();
      runGuardedMut(() => {
        for (const [el, map] of expirableClassEntries.entries()) {
          for (const cls of map.keys()) {
            el.classList?.remove?.(cls);
          }
        }
        expirableClassEntries.clear();
        if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
        document.querySelectorAll('.ag-cs-stream-chunk').forEach((el) => el.classList?.remove?.('ag-cs-stream-chunk'));
        document.querySelectorAll('.ag-cs-thought-chunk').forEach((el) => el.classList?.remove?.('ag-cs-thought-chunk'));
        document.querySelectorAll('.ag-cs-code-scan').forEach((el) => el.classList?.remove?.('ag-cs-code-scan'));
        document
          .querySelectorAll('[data-ag-cs-thought-streaming]')
          .forEach((el) => el.removeAttribute('data-ag-cs-thought-streaming'));
        if (!isMotionUltra()) {
          document.querySelectorAll('.ag-cs-liftoff-veil').forEach((el) => el.remove());
          document.querySelectorAll('[data-ag-cs-liftoff-bubble]').forEach((el) => el.removeAttribute('data-ag-cs-liftoff-bubble'));
          document.querySelectorAll('[data-ag-cs-caustic]').forEach((el) => el.removeAttribute('data-ag-cs-caustic'));
          document.querySelectorAll('[data-ag-cs-fiber-camp]').forEach((el) => el.removeAttribute('data-ag-cs-fiber-camp'));
          document.querySelectorAll('[data-ag-cs-stage-glide]').forEach((el) => el.removeAttribute('data-ag-cs-stage-glide'));
          document.querySelectorAll('[data-ag-cs-sonar]').forEach((el) => el.removeAttribute('data-ag-cs-sonar'));
        }
        if (!isMotionStandardOrUltra()) {
          document.querySelectorAll('.ag-cs-sidebar-glide-pill').forEach((el) => el.remove());
        }
      });
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
      runGuardedMut(() => {
        el.classList.add(clsName);
      });
      const expAt = Date.now() + durationMs;
      let map = expirableClassEntries.get(el);
      if (!map) {
        map = new Map();
        expirableClassEntries.set(el, map);
      }
      map.set(clsName, expAt);
      if (!classSweepTimer) {
        classSweepTimer = setTimeout(flushExpiredClasses, durationMs);
      }
      return true;
    }

    function markCodeScanElement(el) {
      markTransientStreamClass(el, 'ag-cs-code-scan', 240);
    }

    function onStreamMutations(mutations) {
      if (isDestroyed() || streamMutating || !isMotionUltra()) return;
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
          const ctxTag = String(codeCtx.tagName || '').toUpperCase();
          if (TABLE_TAGS.has(ctxTag)) {
            for (const added of m.addedNodes) {
              if (!isElementLike(added)) continue;
              const addTag = String(added.tagName || '').toUpperCase();
              const trEl = addTag === 'TR' ? added : findTableRowAncestor(added, proseRoot) || findTableRowAncestor(codeCtx, proseRoot);
              if (trEl && !scannedStreamNodes.has(trEl) && now - lastCodeScanAt >= STREAM_BATCH_MS) {
                scannedStreamNodes.add(trEl);
                lastCodeScanAt = now;
                markCodeScanElement(trEl);
              }
            }
            continue;
          }

          // Block code context: never re-animate outer <pre>/.code-block on plain TextNode appends!
          for (const added of m.addedNodes) {
            if (!isElementLike(added)) continue;
            const addTag = String(added.tagName || '').toUpperCase();
            if (addTag === 'PRE' || added.classList?.contains?.('code-block')) {
              if (!scannedStreamNodes.has(added)) {
                scannedStreamNodes.add(added);
                lastCodeScanAt = now;
                markCodeScanElement(added);
              }
              continue;
            }
            const lineEl = added.classList?.contains?.('code-line') ? added : added.closest?.('.code-line') || added;
            if (
              lineEl &&
              lineEl !== proseRoot &&
              String(lineEl.tagName || '').toUpperCase() !== 'PRE' &&
              !lineEl.classList?.contains?.('code-block') &&
              !scannedStreamNodes.has(lineEl) &&
              now - lastCodeScanAt >= STREAM_BATCH_MS
            ) {
              scannedStreamNodes.add(lineEl);
              lastCodeScanAt = now;
              markCodeScanElement(lineEl);
            }
          }
          continue;
        }

        for (const added of m.addedNodes) {
          if (!isElementLike(added)) continue;
          const tag = String(added.tagName || '').toUpperCase();
          const cls = added.classList;
          const isBlockCodeOrTable =
            tag === 'PRE' ||
            tag === 'TABLE' ||
            Boolean(cls && (cls.contains('code-block') || cls.contains('md-table-host') || cls.contains('md-table-frame'))) ||
            Boolean(added.querySelector?.('pre, table, .code-block, .md-table-frame'));
          if (isBlockCodeOrTable) {
            if (!scannedStreamNodes.has(added) && now - lastCodeScanAt >= STREAM_BATCH_MS) {
              scannedStreamNodes.add(added);
              lastCodeScanAt = now;
              markCodeScanElement(added);
            }
            continue;
          }
          // Skip inline leaf tokens inside an already-rendered paragraph
          if (tag === 'CODE' && baseEl !== proseRoot) {
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

    function measureNewLensOverlays() {
      if (!isMotionStandardOrUltra()) return [];
      const candidates = new Set();
      document.querySelectorAll('.agy-overlay, .agy-fastpick').forEach((el) => candidates.add(el));
      document.querySelectorAll('div[role="dialog"]').forEach((el) => candidates.add(el));
      document
        .querySelectorAll('[data-testid="context-menu-popup"], [data-testid="context-menu-submenu-popup"]')
        .forEach((el) => candidates.add(el));
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
      document.querySelectorAll('[data-testid="overview-panel"]').forEach((el) => {
        if (el.parentElement && String(el.parentElement.tagName || '').toUpperCase() === 'DIV') {
          setAttrIfChanged(el.parentElement, 'data-ag-cs-overview-shell', '1');
        }
      });
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
          if (
            role === 'option' ||
            role === 'menuitem' ||
            tid.startsWith('overview-panel-row-') ||
            tid === 'subagent-node' ||
            tid === 'artifact-row'
          ) {
            rowNodes.push(item);
            if (rowNodes.length >= 12) break;
          }
        }
        for (let i = 0; i < rowNodes.length; i++) {
          rowNodes[i].style?.setProperty?.('--ag-row-i', String(i));
        }
      }
    }

    function scheduleDeferredConvEntry(fn, delayMs = 65) {
      if (deferredConvEntryTimer) clearTimeout(deferredConvEntryTimer);
      deferredConvEntryTimer = setTimeout(() => {
        deferredConvEntryTimer = 0;
        if (!isDestroyed()) fn();
      }, delayMs);
    }

    function disconnectStreamObserver() {
      if (streamObserver) {
        try {
          streamObserver.disconnect();
        } catch {}
        streamObserver = null;
        streamObservedRoot = null;
      }
      flushAllStreamArtifacts();
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
      hasStreamObserver: () => Boolean(streamObserver && streamObservedRoot),
    };
  }

  const api = { STREAM_BATCH_MS, createStreamChoreographyController };
  if (typeof module === 'object' && module.exports) module.exports = api;
  G.__agPrismStreamChoreography = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
