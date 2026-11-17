// Obsidian Prism — 4-State Conversation Horizon Aura Controller (.ag-cs-conv-aura-host)
// Extracted from ui-runtime.js: 32% viewport bottom clipping + 0.72x resolution + 0fps sleep in subtle/off/hidden.

(function (root) {
  'use strict';
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : window);
  if (!G) return;

  const CONV_AURA_HEIGHT_RATIO = 0.32;
  const CONV_AURA_START_MS = 1150;
  const CONV_AURA_COMPLETE_MS = 1400;

  function scaleConvReach(fullViewportReach) {
    return Math.max(0.08, Math.min(0.98, +(fullViewportReach / CONV_AURA_HEIGHT_RATIO).toFixed(4)));
  }

  function isVisibleAuraNode(el) {
    if (!el || el.hidden === true || el.isConnected === false) return false;
    const st = el.style;
    if (st && (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0')) return false;
    if (typeof getComputedStyle === 'function') {
      try {
        const cs = getComputedStyle(el);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')) return false;
      } catch {}
    }
    if (typeof el.getBoundingClientRect === 'function') {
      const r = el.getBoundingClientRect();
      if (r && (r.width <= 0 || r.height <= 0)) return false;
    }
    return true;
  }

  let cachedRunningVal = false;
  let cachedRunningAt = -1;

  function isConvRunning() {
    if (typeof document === 'undefined') return false;
    const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    if (cachedRunningAt >= 0 && Math.abs(now - cachedRunningAt) < 200) {
      return cachedRunningVal;
    }
    const nodes = document.querySelectorAll(
      '[data-testid="input-cancel-button"], [data-testid="stop-button"], [data-testid="cancel-button"], [data-testid="agent-loading"], [data-testid="thinking-collapsible-trigger"][data-op-thought-state="streaming"]'
    );
    let running = false;
    for (const n of nodes) {
      if (n.closest?.('[data-testid="subagent-tab-conversation"]')) continue;
      if (isVisibleAuraNode(n)) {
        running = true;
        break;
      }
    }
    cachedRunningVal = running;
    cachedRunningAt = now;
    return running;
  }

  function computeConvAuraOptics(phase, phaseAt, now, dark, wasRunning) {
    const idleStr = dark ? 0.21 : 0.52;
    const runBase = dark ? 0.31 : 0.64;
    const idlePrism = dark ? 0.14 : 0.26;
    if (phase === 'start') {
      const p = Math.max(0, Math.min(1, (now - phaseAt) / CONV_AURA_START_MS));
      const s = Math.sin(p * Math.PI);
      const peakStr = dark ? 0.46 : 0.78;
      const endStr = wasRunning ? runBase : idleStr;
      const endFullReach = wasRunning ? 0.22 : 0.16;
      const rawReach = p <= 0.5 ? 0.16 + (0.26 - 0.16) * s : endFullReach + (0.26 - endFullReach) * s;
      const endPrism = wasRunning ? 0.70 : idlePrism;
      const settleEase = Math.pow(p, 2.4);
      const endSpeed = wasRunning ? 1.45 : 0.72;
      return {
        strength: p <= 0.5 ? idleStr + (peakStr - idleStr) * s : endStr + (peakStr - endStr) * s,
        reach: scaleConvReach(rawReach),
        prism: p <= 0.5 ? idlePrism + (0.74 - idlePrism) * s : endPrism + (0.74 - endPrism) * s,
        surge: Number((0.50 * (1 - 0.32 * settleEase)).toFixed(4)),
        speed: Number((1.95 - (1.95 - endSpeed) * settleEase).toFixed(4)),
        frameMs: 22,
      };
    }
    if (phase === 'running') {
      return {
        strength: runBase + (dark ? 0.035 : 0.045) * Math.sin(now * 0.0021),
        reach: scaleConvReach(0.22),
        prism: 0.70,
        surge: 0.06 * Math.sin(now * 0.0024),
        speed: 1.45,
        frameMs: 32,
      };
    }
    if (phase === 'complete') {
      const p = Math.max(0, Math.min(1, (now - phaseAt) / CONV_AURA_COMPLETE_MS));
      const ease = 1 - Math.pow(1 - p, 2.1);
      const startStr = dark ? 0.38 : 0.70;
      const rawReach = 0.24 + (0.16 - 0.24) * ease;
      return {
        strength: startStr + (idleStr - startStr) * ease,
        reach: scaleConvReach(rawReach),
        prism: 0.76 + (idlePrism - 0.76) * ease,
        surge: -0.36 * (1 - ease * 0.85),
        speed: 1.45 + (0.72 - 1.45) * ease,
        frameMs: 28,
      };
    }
    return {
      strength: idleStr + (dark ? 0.024 : 0.038) * Math.sin(now * 0.0018),
      reach: scaleConvReach(0.16),
      prism: idlePrism,
      surge: 0,
      speed: 0.72,
      frameMs: 110,
    };
  }

  function invokeConvGlowDraw(glow, now, dark, still, opt) {
    if (!glow) return;
    try {
      if (still && typeof glow.drawStaticSnapshot === 'function') {
        glow.drawStaticSnapshot(now, dark, opt.strength, {
          reach: opt.reach,
          prism: opt.prism,
          surge: opt.surge,
          speed: opt.speed,
          still: true,
        });
        return;
      }
      if (typeof glow.draw === 'function') {
        glow.draw(now, dark, opt.strength, {
          reach: opt.reach,
          prism: opt.prism,
          surge: opt.surge,
          speed: opt.speed,
          still,
        });
      }
    } catch {}
  }

  function createConvAuraController({
    isDestroyed,
    isHomeRippleEnabled,
    isMotionStandardOrUltra,
    isDarkTheme,
    rippleCore,
    setAttrIfChanged,
    runGuardedMut,
  }) {
    let convAura = null;

    function findConvAuraView() {
      if (typeof document === 'undefined' || !isHomeRippleEnabled() || document.querySelector('.agy-home')) return null;
      const views = document.querySelectorAll('[data-testid="conversation-view"]');
      for (const cv of views) {
        if (cv.closest?.('.agy-home') || cv.closest?.('[data-testid="subagent-tab-conversation"]')) continue;
        return cv;
      }
      return null;
    }

    function advancePhase(now = performance.now()) {
      if (!convAura || !convAura.host || !convAura.host.isConnected) return 'off';
      const runningNow = isConvRunning();
      if (runningNow && !convAura.wasRunning) {
        convAura.wasRunning = true;
        if (convAura.phase !== 'start') {
          convAura.phase = 'start';
          convAura.phaseAt = now;
        }
      } else if (!runningNow && convAura.wasRunning) {
        convAura.wasRunning = false;
        convAura.phase = 'complete';
        convAura.phaseAt = now;
      }

      if (convAura.phase === 'start' && now - convAura.phaseAt >= CONV_AURA_START_MS) {
        convAura.phase = convAura.wasRunning ? 'running' : 'idle';
        convAura.phaseAt = now;
      } else if (convAura.phase === 'complete' && now - convAura.phaseAt >= CONV_AURA_COMPLETE_MS) {
        convAura.phase = 'idle';
        convAura.phaseAt = now;
      }

      if (convAura.host.getAttribute('data-aura-phase') !== convAura.phase) {
        runGuardedMut(() => {
          convAura.host.setAttribute('data-aura-phase', convAura.phase);
        });
      }
      return convAura.phase;
    }

    function unmount() {
      if (!convAura) return;
      if (convAura.timer) clearTimeout(convAura.timer);
      if (convAura.rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(convAura.rafId);
      if (convAura.ro) convAura.ro.disconnect();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', convAura.onVis);
      if (convAura.glow && typeof convAura.glow.dispose === 'function') {
        try {
          convAura.glow.dispose();
        } catch {}
      }
      if (convAura.host) convAura.host.remove();
      convAura = null;
    }

    function sync() {
      cachedRunningAt = -1;
      const convView = findConvAuraView();
      const seatParent = convView ? convView.parentElement || convView : null;
      if (convAura && (convAura.seatParent !== seatParent || !convAura.host.isConnected || !convAura.canvas.isConnected)) {
        unmount();
      }
      if (!convView || !seatParent || typeof document === 'undefined') return;

      if (convAura) {
        const prevPhase = convAura.phase;
        const nextPhase = advancePhase(performance.now());
        if (nextPhase !== prevPhase || (isMotionStandardOrUltra() && !document.hidden && convAura.sleeping)) {
          convAura.wake(true);
        }
        return;
      }

      const host = document.createElement('div');
      host.className = 'ag-cs-conv-aura-host';
      host.setAttribute('data-ag-no-i18n', '');
      host.setAttribute('aria-hidden', 'true');
      host.style.setProperty('top', 'auto', 'important');
      host.style.setProperty('bottom', '0', 'important');
      host.style.setProperty('left', '0', 'important');
      host.style.setProperty('right', '0', 'important');
      host.style.setProperty('height', '32%', 'important');

      const glowCanvas = document.createElement('canvas');
      glowCanvas.className = 'ag-cs-conv-glow';
      host.appendChild(glowCanvas);
      seatParent.insertBefore(host, seatParent.firstChild);

      const initNow = performance.now();
      const initRunning = isConvRunning();
      const initPhase = initRunning ? 'running' : 'idle';
      host.setAttribute('data-aura-phase', initPhase);

      const state = {
        seatParent,
        convView,
        host,
        canvas: glowCanvas,
        width: -1,
        height: -1,
        dpr: 0,
        phase: initPhase,
        phaseAt: initNow,
        liftoffAt: 0,
        sleeping: false,
        drawCount: 0,
        lastOptics: null,
        wasRunning: initRunning,
        glow:
          rippleCore && typeof rippleCore.mountBrandHorizonGlow === 'function'
            ? rippleCore.mountBrandHorizonGlow(glowCanvas)
            : { mode: 'none', resize() {}, draw() {}, dispose() {} },
        timer: 0,
        rafId: 0,
        ro: null,
        onVis: null,
        wake: null,
        refreshTheme: null,
      };

      let frameWanted = false;
      let drawnOnce = false;

      function applySize(w, parentH) {
        const h = parentH > 0 ? Math.max(1, Math.round(parentH * CONV_AURA_HEIGHT_RATIO)) : 0;
        const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1) * 0.72;
        if (w === state.width && h === state.height && dpr === state.dpr) return;
        state.width = w;
        state.height = h;
        state.dpr = dpr;
        if (state.glow && typeof state.glow.resize === 'function' && w > 0 && h > 0) {
          try {
            state.glow.resize(w, h, dpr);
          } catch {}
        }
        drawnOnce = false;
      }

      function layout(forceRead = false) {
        if (!forceRead && state.ro && state.width > 0 && state.height > 0) return;
        const w = seatParent.clientWidth || convView.clientWidth || 0;
        const parentH = seatParent.clientHeight || convView.clientHeight || 0;
        applySize(w, parentH);
      }

      function enterAuraSleep() {
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = 0;
        }
        if (state.rafId && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(state.rafId);
          state.rafId = 0;
        }
        frameWanted = false;
        state.sleeping = true;
        setAttrIfChanged(host, 'data-aura-sleep', '1');
      }

      function drawNow(now) {
        state.rafId = 0;
        frameWanted = false;
        if (isDestroyed() || convAura !== state) return;
        layout();
        const phase = advancePhase(now);
        const allowLivingFlow = isMotionStandardOrUltra() && !document.hidden;
        const still = !allowLivingFlow;
        const dark = isDarkTheme();
        let opt = computeConvAuraOptics(phase, state.phaseAt, now, dark, state.wasRunning);
        const liftElapsed = state.liftoffAt > 0 ? now - state.liftoffAt : -1;
        const inLiftoffEbb = allowLivingFlow && liftElapsed >= 0 && liftElapsed < 520;
        if (state.liftoffAt > 0 && !inLiftoffEbb) {
          state.liftoffAt = 0;
        } else if (inLiftoffEbb) {
          const p = Math.max(0, Math.min(1, liftElapsed / 520));
          const ease = 1 - Math.pow(1 - p, 2.25);
          const endStr = dark ? 0.31 : 0.64;
          opt = {
            strength: 0.92 + (endStr - 0.92) * ease,
            reach: scaleConvReach(0.31 + (0.22 - 0.31) * ease),
            prism: 0.78 + (0.70 - 0.78) * ease,
            surge: 0.38 * (1 - ease),
            speed: 1.65 + (1.45 - 1.65) * ease,
            frameMs: 16,
          };
        }
        state.lastOptics = opt;

        if (state.width > 0 && state.height > 0) {
          if (still && state.glow && typeof state.glow.invalidate === 'function') {
            state.glow.invalidate();
          }
          invokeConvGlowDraw(state.glow, now, dark, still, opt);
          state.drawCount += 1;
          drawnOnce = true;
        }

        if (isDestroyed() || !allowLivingFlow || (phase === 'idle' && !inLiftoffEbb && now - state.phaseAt >= 4800)) {
          enterAuraSleep();
          return;
        }

        state.sleeping = false;
        if (host.hasAttribute('data-aura-sleep')) host.removeAttribute('data-aura-sleep');

        let nextDelay = opt.frameMs || 50;
        if (inLiftoffEbb) {
          nextDelay = Math.min(16, Math.max(8, 520 - liftElapsed + 4));
        } else if (phase === 'start') {
          nextDelay = Math.min(nextDelay, Math.max(16, CONV_AURA_START_MS - (now - state.phaseAt) + 4));
        } else if (phase === 'complete') {
          nextDelay = Math.min(nextDelay, Math.max(16, CONV_AURA_COMPLETE_MS - (now - state.phaseAt) + 4));
        }
        clearTimeout(state.timer);
        state.timer = setTimeout(() => wake(false), nextDelay);
      }

      function wake(immediate = false) {
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = 0;
        }
        if (isDestroyed() || convAura !== state) return;
        if (document.hidden) {
          if (!drawnOnce) drawNow(performance.now());
          enterAuraSleep();
          return;
        }
        if (immediate) {
          if (state.rafId && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(state.rafId);
            state.rafId = 0;
          }
          frameWanted = false;
          drawNow(performance.now());
          return;
        }
        if (frameWanted) return;
        frameWanted = true;
        if (typeof requestAnimationFrame === 'function') {
          state.rafId = requestAnimationFrame(drawNow);
        } else {
          drawNow(performance.now());
        }
      }

      state.wake = wake;
      state.refreshTheme = () => {
        if (state.glow && typeof state.glow.invalidate === 'function') state.glow.invalidate();
        wake(true);
      };
      state.onVis = () => {
        if (!document.hidden) wake(true);
        else enterAuraSleep();
      };
      document.addEventListener('visibilitychange', state.onVis);

      if (typeof ResizeObserver === 'function') {
        state.ro = new ResizeObserver((entries) => {
          const prevW = state.width;
          const prevH = state.height;
          const cr = entries && entries[0] && entries[0].contentRect;
          if (cr && cr.width > 0 && cr.height > 0) {
            applySize(Math.round(cr.width), Math.round(cr.height));
          } else {
            layout(true);
          }
          if (state.width !== prevW || state.height !== prevH) wake(false);
        });
        state.ro.observe(seatParent);
      }

      convAura = state;
      layout(true);
      wake(true);
    }

    function triggerStart() {
      if (isDestroyed() || !isHomeRippleEnabled()) return;
      if (!convAura) sync();
      if (!convAura) return;
      const now = performance.now();
      if (convAura.phase !== 'start' || now - convAura.phaseAt > 240) {
        convAura.phase = 'start';
        convAura.phaseAt = now;
        setAttrIfChanged(convAura.host, 'data-aura-phase', 'start');
      }
      convAura.wake(true);
    }

    function triggerLiftoffEbb(now = performance.now()) {
      if (!convAura) sync();
      if (convAura) {
        convAura.liftoffAt = now;
        convAura.wake(true);
      }
    }

    function refreshTheme() {
      if (convAura && typeof convAura.refreshTheme === 'function') convAura.refreshTheme();
    }

    function getInstance() {
      return convAura;
    }

    return {
      sync,
      unmount,
      triggerStart,
      triggerLiftoffEbb,
      advancePhase,
      refreshTheme,
      getInstance,
    };
  }

  G.__agPrismConvAura = {
    CONV_AURA_HEIGHT_RATIO,
    isConvRunning,
    createConvAuraController,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
