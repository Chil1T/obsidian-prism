// Obsidian Prism — Zero-StyleRecalc 300Hz GPU Canvas Prism Rim & Orchestrator Rim Module (prism-rim-canvas.js)
// Extracted from ui-runtime.js: manages ResizeObserver geometry caching and 2D radial gradient rim rendering.

(function (root) {
  'use strict';
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : window);
  if (!G) return;

  const RIM_PALETTES = {
    default: {
      dark: [
        [0, 'rgba(255,255,255,0.96)'],
        [0.24, '#4285F4'],
        [0.50, '#9B72CB'],
        [0.74, '#EA4335'],
        [0.92, '#FBBC04'],
        [1, 'rgba(251,188,4,0)'],
      ],
      light: [
        [0, '#2563EB'],
        [0.32, '#7C3AED'],
        [0.64, '#EA4335'],
        [0.88, '#D97706'],
        [1, 'rgba(217,119,6,0)'],
      ],
    },
    warm: {
      dark: [
        [0, 'rgba(255,246,238,0.95)'],
        [0.26, '#F6BD60'],
        [0.54, '#F0A37E'],
        [0.82, '#D97757'],
        [1, 'rgba(217,119,87,0)'],
      ],
      light: [
        [0, '#9A3412'],
        [0.34, '#C25934'],
        [0.68, '#D97757'],
        [0.90, '#D97706'],
        [1, 'rgba(217,119,6,0)'],
      ],
    },
    cobalt: {
      dark: [
        [0, 'rgba(240,249,255,0.96)'],
        [0.26, '#7CE2FF'],
        [0.56, '#4285F4'],
        [0.86, '#1B49B2'],
        [1, 'rgba(27,73,178,0)'],
      ],
      light: [
        [0, '#1D4ED8'],
        [0.35, '#2563EB'],
        [0.70, '#0284C7'],
        [0.92, '#38BDF8'],
        [1, 'rgba(56,189,248,0)'],
      ],
    },
    iris: {
      dark: [
        [0, 'rgba(245,243,255,0.95)'],
        [0.26, '#DDD6FE'],
        [0.56, '#A58AF8'],
        [0.86, '#6D28D9'],
        [1, 'rgba(109,40,217,0)'],
      ],
      light: [
        [0, '#5B21B6'],
        [0.36, '#7C3AED'],
        [0.70, '#8B5CF6'],
        [0.92, '#A855F7'],
        [1, 'rgba(168,85,247,0)'],
      ],
    },
    amber: {
      dark: [
        [0, 'rgba(255,251,235,0.95)'],
        [0.26, '#FDE68A'],
        [0.56, '#F2B84B'],
        [0.86, '#D97706'],
        [1, 'rgba(217,119,6,0)'],
      ],
      light: [
        [0, '#92400E'],
        [0.36, '#B45309'],
        [0.70, '#D97706'],
        [0.92, '#F59E0B'],
        [1, 'rgba(245,158,11,0)'],
      ],
    },
    mono: {
      dark: [
        [0, 'rgba(248,250,252,0.92)'],
        [0.28, '#E2E8F0'],
        [0.60, '#94A3B8'],
        [0.88, '#64748B'],
        [1, 'rgba(100,116,139,0)'],
      ],
      light: [
        [0, '#1E293B'],
        [0.36, '#334155'],
        [0.70, '#64748B'],
        [0.92, '#94A3B8'],
        [1, 'rgba(148,163,184,0)'],
      ],
    },
  };

  const parseAmbientScale = (raw) =>
    G.__agPrismRipple?.parseAmbientScale
      ? G.__agPrismRipple.parseAmbientScale(raw)
      : raw === null || raw === undefined || raw === ''
      ? 1
      : Math.max(0, Math.min(1, Number(raw) > 1 ? Number(raw) / 100 : Number.isFinite(Number(raw)) ? Number(raw) : 1));

  function createPrismRimCanvasController({
    isDestroyed,
    isDarkTheme,
    motionReduced,
    getMinFrameGapMs,
    getAmbientIntensity,
    getAccentTone,
    canMountRealCanvas,
    setAttrIfChanged,
    runGuardedMut,
    getActiveCrystalTrack,
    setCrystalPointerClient,
    onPointerActivity,
  }) {
    const lastPointerPos = { x: -9999, y: -9999 };
    let prismRaf = 0;
    let lastPrismDrawAt = 0;
    let prismBoxCacheDirty = true;
    let prismBoxCacheAt = 0;
    let lastPrismRectReadAt = 0;
    let cachedPrismBoxes = [];
    let cachedOrchEntry = null;
    let prismBoxRo = null;
    const observedPrismSet = new Set();

    function getRootHtml() {
      return typeof document !== 'undefined' ? document.documentElement : null;
    }

    function readAmbientScale() {
      if (typeof getAmbientIntensity === 'function') {
        return parseAmbientScale(getAmbientIntensity());
      }
      const html = getRootHtml();
      return parseAmbientScale(html?.getAttribute?.('data-ag-cs-ambient'));
    }

    function resolveRimToneKey(dark) {
      const html = getRootHtml();
      const rawTone =
        (typeof getAccentTone === 'function' ? getAccentTone() : null) ||
        html?.getAttribute?.('data-ag-cs-accent') ||
        'follow';
      if (rawTone === 'mono' || rawTone === 'cobalt' || rawTone === 'iris' || rawTone === 'amber') {
        return rawTone;
      }
      const pal = html?.getAttribute?.('data-ag-cs-palette') || 'obsidian';
      if (pal === 'warm' || pal === 'claude') return 'warm';
      if (!dark && html?.getAttribute?.('data-ag-cs-light-preset') === 'alabaster') return 'warm';
      return 'default';
    }

    function isRimMotionDisabled() {
      if (motionReduced && motionReduced()) return true;
      const mv = getRootHtml()?.getAttribute?.('data-ag-cs-motion') || '';
      return mv === 'off' || mv === 'subtle';
    }

    function clearRimEntry(entry) {
      if (!entry) return;
      if (entry.ctx && entry.cv && entry.cv.width > 0 && entry.cv.height > 0 && !entry.wasCleared) {
        try {
          entry.ctx.clearRect(0, 0, entry.cv.width, entry.cv.height);
        } catch {}
        entry.wasCleared = true;
      }
    }

    function clearAllRimCanvases() {
      for (let i = 0; i < cachedPrismBoxes.length; i++) {
        clearRimEntry(cachedPrismBoxes[i]);
      }
      if (cachedOrchEntry) {
        clearRimEntry(cachedOrchEntry);
      }
      if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
        document.querySelectorAll('.ag-cs-prism-rim-cv').forEach((cv) => {
          try {
            const ctx = typeof cv.getContext === 'function' ? cv.getContext('2d') : null;
            if (ctx && cv.width > 0 && cv.height > 0) ctx.clearRect(0, 0, cv.width, cv.height);
          } catch {}
        });
      }
    }

    const trackedRimCanvases = new Set();

    function removeSingleRimCanvas(cv) {
      if (!cv) return;
      trackedRimCanvases.delete(cv);
      const host = cv.parentElement;
      try {
        const ctx = typeof cv.getContext === 'function' ? cv.getContext('2d') : null;
        if (ctx && cv.width > 0 && cv.height > 0) ctx.clearRect(0, 0, cv.width, cv.height);
      } catch {}
      cv.remove?.();
      if (host?.hasAttribute?.('data-ag-cs-prism-cv')) {
        host.removeAttribute('data-ag-cs-prism-cv');
      }
    }

    function pruneOrphanRimCanvases(fullScan = true) {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
      const activeTrack = getActiveCrystalTrack ? getActiveCrystalTrack() : null;
      if (!fullScan) {
        // Fast O(k) sweep over tracked canvases during high-frequency markDirty() calls (0 full-DOM querySelectorAll)
        for (const cv of trackedRimCanvases) {
          const host = cv.parentElement;
          const keep =
            Boolean(host) &&
            cv.isConnected !== false &&
            (host.getAttribute?.('data-ag-cs-prism-box') === '1' || (activeTrack && host === activeTrack));
          if (!keep) removeSingleRimCanvas(cv);
        }
        return;
      }
      for (const cv of trackedRimCanvases) {
        if (!cv || cv.isConnected === false) trackedRimCanvases.delete(cv);
      }
      const cvs = document.querySelectorAll('.ag-cs-prism-rim-cv');
      cvs.forEach((cv) => {
        const host = cv.parentElement;
        const keep =
          Boolean(host) &&
          (host.getAttribute?.('data-ag-cs-prism-box') === '1' || (activeTrack && host === activeTrack));
        if (!keep) {
          removeSingleRimCanvas(cv);
        } else {
          trackedRimCanvases.add(cv);
        }
      });
      document.querySelectorAll('[data-ag-cs-prism-cv]').forEach((host) => {
        const keep =
          host.getAttribute?.('data-ag-cs-prism-box') === '1' || (activeTrack && host === activeTrack);
        if (!keep || !host.querySelector?.('.ag-cs-prism-rim-cv')) {
          host.removeAttribute('data-ag-cs-prism-cv');
        }
      });
    }

    function ensurePrismRimCanvas(hostEl) {
      if (!hostEl || !canMountRealCanvas(hostEl)) return null;
      let cv = null;
      for (let c = hostEl.firstElementChild; c; c = c.nextElementSibling) {
        if (c.classList?.contains('ag-cs-prism-rim-cv')) {
          cv = c;
          break;
        }
      }
      if (!cv) {
        cv = document.createElement('canvas');
        cv.className = 'ag-cs-prism-rim-cv';
        cv.setAttribute('aria-hidden', 'true');
        cv.setAttribute('data-ag-no-i18n', '');
        hostEl.appendChild(cv);
      }
      trackedRimCanvases.add(cv);
      const ctx = typeof cv.getContext === 'function' ? cv.getContext('2d') : null;
      if (!ctx || typeof ctx.createRadialGradient !== 'function') {
        cv.remove();
        return null;
      }
      setAttrIfChanged(hostEl, 'data-ag-cs-prism-cv', '1');
      return { cv, ctx };
    }

    function strokeRoundedRectPath(ctx, x, y, w, h, r) {
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, w, h, r);
        return;
      }
      const cr = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
      ctx.moveTo(x + cr, y);
      ctx.arcTo(x + w, y, x + w, y + h, cr);
      ctx.arcTo(x + w, y + h, x, y + h, cr);
      ctx.arcTo(x, y + h, x, y, cr);
      ctx.arcTo(x, y, x + w, y, cr);
      ctx.closePath();
    }

    function paintPrismRimCanvas(entry, active, localX, localY, radius, dark, toneKey = 'default', ambientScale = 1) {
      if (!entry || !entry.ctx || !entry.cv || !entry.rect) return false;
      if (!active || ambientScale <= 0.001) {
        if (!entry.wasCleared) {
          if (entry.cv.width > 0 && entry.cv.height > 0) {
            entry.ctx.clearRect(0, 0, entry.cv.width, entry.cv.height);
          }
          entry.wasCleared = true;
        }
        return true;
      }
      const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
      const w = Math.max(4, Math.round((entry.rect.width + (entry.insetPad || 0)) * dpr));
      const h = Math.max(4, Math.round((entry.rect.height + (entry.insetPad || 0)) * dpr));
      if (entry.cv.width !== w || entry.cv.height !== h) {
        entry.cv.width = w;
        entry.cv.height = h;
      }
      entry.wasCleared = false;
      const ctx = entry.ctx;
      ctx.clearRect(0, 0, w, h);
      const padOffset = entry.insetPad ? entry.insetPad * 0.5 : 0;
      const gx = (localX + padOffset) * dpr;
      const gy = (localY + padOffset) * dpr;
      const gr = radius * dpr;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      const pal = RIM_PALETTES[toneKey] || RIM_PALETTES.default;
      const stops = dark ? pal.dark : pal.light;
      for (let i = 0; i < stops.length; i++) {
        g.addColorStop(stops[i][0], stops[i][1]);
      }
      const strokeInset = (entry.insetPad ? 1.0 : 0.7) * dpr;
      const rw = Math.max(2, w - strokeInset * 2);
      const rh = Math.max(2, h - strokeInset * 2);
      const cssRadius = entry.borderRadius > 0 ? entry.borderRadius : 10;
      const rr = Math.min(rw * 0.5, rh * 0.5, cssRadius * dpr);
      const prevAlpha = ctx.globalAlpha;
      const effAlpha = Math.max(0, Math.min(1, ambientScale * (toneKey === 'mono' ? 0.58 : 1)));
      ctx.globalAlpha = effAlpha;
      strokeRoundedRectPath(ctx, strokeInset, strokeInset, rw, rh, rr);
      ctx.lineWidth = 1.45 * dpr;
      ctx.strokeStyle = g;
      ctx.stroke();
      ctx.globalAlpha = prevAlpha !== undefined ? prevAlpha : 1;
      return true;
    }

    function ensurePrismBoxRo() {
      if (prismBoxRo || typeof ResizeObserver !== 'function') return prismBoxRo;
      prismBoxRo = new ResizeObserver(() => {
        prismBoxCacheDirty = true;
      });
      return prismBoxRo;
    }

    function readBoxBorderRadius(el, fallbackPx) {
      if (!el || typeof getComputedStyle !== 'function') return fallbackPx;
      try {
        const v = parseFloat(getComputedStyle(el).borderTopLeftRadius || '');
        return Number.isFinite(v) && v >= 0 ? v : fallbackPx;
      } catch {
        return fallbackPx;
      }
    }

    function refreshPrismBoxRectCache(now, allowReadRect) {
      const boxes = document.querySelectorAll('[data-ag-cs-prism-box="1"]');
      const ro = ensurePrismBoxRo();
      const prevMap = new Map();
      for (let i = 0; i < cachedPrismBoxes.length; i++) {
        prevMap.set(cachedPrismBoxes[i].box, cachedPrismBoxes[i]);
      }
      const nextObserved = new Set();
      const next = [];
      const trackEl = getActiveCrystalTrack ? getActiveCrystalTrack() : null;
      let nextOrch = null;

      // Phase A: Batch all layout/style reads BEFORE DOM mutations to prevent forced write->read reflows!
      const boxList = Array.from(boxes);
      const preMeasured = boxList.map((box) => {
        const prev = prevMap.get(box);
        return {
          box,
          prev,
          borderRadius: prev && prev.borderRadius >= 0 ? prev.borderRadius : readBoxBorderRadius(box, 10),
          rect: allowReadRect && typeof box.getBoundingClientRect === 'function' ? box.getBoundingClientRect() : null,
        };
      });
      const orchRect =
        trackEl && allowReadRect && typeof trackEl.getBoundingClientRect === 'function'
          ? trackEl.getBoundingClientRect()
          : null;

      // Phase B: Batch all DOM mutations (canvas mounts, ResizeObserver bindings, orphan prune) after reads!
      runGuardedMut(() => {
        for (let i = 0; i < preMeasured.length; i++) {
          const { box, prev, borderRadius, rect } = preMeasured[i];
          nextObserved.add(box);
          if (ro && !observedPrismSet.has(box)) {
            try {
              ro.observe(box);
              observedPrismSet.add(box);
            } catch {}
          }
          const rim = prev && prev.cv && prev.cv.isConnected ? { cv: prev.cv, ctx: prev.ctx } : ensurePrismRimCanvas(box);
          next.push({
            box,
            rect,
            cv: rim ? rim.cv : null,
            ctx: rim ? rim.ctx : null,
            insetPad: 2,
            borderRadius,
            wasCleared: prev ? prev.wasCleared : false,
            pxStr: prev ? prev.pxStr : '',
            pyStr: prev ? prev.pyStr : '',
          });
        }

        if (trackEl) {
          nextObserved.add(trackEl);
          if (ro && !observedPrismSet.has(trackEl)) {
            try {
              ro.observe(trackEl);
              observedPrismSet.add(trackEl);
            } catch {}
          }
          const prevOrch = cachedOrchEntry && cachedOrchEntry.box === trackEl ? cachedOrchEntry : null;
          const rim = prevOrch && prevOrch.cv && prevOrch.cv.isConnected ? { cv: prevOrch.cv, ctx: prevOrch.ctx } : ensurePrismRimCanvas(trackEl);
          nextOrch = {
            box: trackEl,
            rect: orchRect,
            cv: rim ? rim.cv : null,
            ctx: rim ? rim.ctx : null,
            insetPad: 0,
            borderRadius: 999,
            wasCleared: prevOrch ? prevOrch.wasCleared : false,
            pxStr: prevOrch ? prevOrch.pxStr : '',
            pyStr: prevOrch ? prevOrch.pyStr : '',
          };
        }

        if (ro) {
          for (const oldEl of Array.from(observedPrismSet)) {
            if (!nextObserved.has(oldEl)) {
              try {
                ro.unobserve(oldEl);
              } catch {}
              observedPrismSet.delete(oldEl);
            }
          }
        }
        pruneOrphanRimCanvases();
      });

      cachedPrismBoxes = next;
      cachedOrchEntry = nextOrch;
      prismBoxCacheDirty = false;
      prismBoxCacheAt = now;
    }

    function flushPrismPointer(rafNow) {
      prismRaf = 0;
      if (isDestroyed()) return;
      const disabled = isRimMotionDisabled();
      const ambientScale = readAmbientScale();
      if (disabled || ambientScale <= 0.001) {
        runGuardedMut(() => {
          pruneOrphanRimCanvases();
          clearAllRimCanvases();
        });
        return;
      }
      const now = typeof rafNow === 'number' && rafNow > 0 ? rafNow : performance.now();
      const minGap = getMinFrameGapMs();
      if (minGap > 0 && lastPrismDrawAt > 0 && now - lastPrismDrawAt < minGap) {
        if (typeof requestAnimationFrame === 'function') {
          prismRaf = requestAnimationFrame(flushPrismPointer);
        }
        return;
      }
      lastPrismDrawAt = now;
      const { x, y } = lastPointerPos;
      const allowReadRect = x >= -1000;

      const activeTrack = getActiveCrystalTrack ? getActiveCrystalTrack() : null;
      if (
        prismBoxCacheDirty ||
        cachedPrismBoxes.length === 0 ||
        (!prismBoxRo && now - prismBoxCacheAt > 2500) ||
        now - prismBoxCacheAt > 8000 ||
        activeTrack !== (cachedOrchEntry ? cachedOrchEntry.box : null) ||
        cachedPrismBoxes.some((e) => e.box.isConnected === false || e.borderRadius < 0 || (allowReadRect && !e.rect))
      ) {
        refreshPrismBoxRectCache(now, allowReadRect);
        lastPrismRectReadAt = now;
      } else if (allowReadRect && now - lastPrismRectReadAt >= (prismBoxRo ? 1500 : 250)) {
        lastPrismRectReadAt = now;
        for (let i = 0; i < cachedPrismBoxes.length; i++) {
          const b = cachedPrismBoxes[i].box;
          if (b && typeof b.getBoundingClientRect === 'function') cachedPrismBoxes[i].rect = b.getBoundingClientRect();
        }
        if (cachedOrchEntry && cachedOrchEntry.box && typeof cachedOrchEntry.box.getBoundingClientRect === 'function') {
          cachedOrchEntry.rect = cachedOrchEntry.box.getBoundingClientRect();
        }
      }

      const dark = isDarkTheme();
      const toneKey = resolveRimToneKey(dark);
      runGuardedMut(() => {
        for (let i = 0; i < cachedPrismBoxes.length; i++) {
          const entry = cachedPrismBoxes[i];
          const r = allowReadRect ? entry.rect : null;
          let inRange = false;
          let lx = -9999;
          let ly = -9999;
          if (r) {
            const maxRange = 280;
            if (x >= r.left - maxRange && x <= r.right + maxRange && y >= r.top - maxRange && y <= r.bottom + maxRange) {
              inRange = true;
              lx = x - r.left;
              ly = y - r.top;
            }
          }
          if (entry.ctx && paintPrismRimCanvas(entry, inRange, lx, ly, 240, dark, toneKey, ambientScale)) {
            continue;
          }
          const nextPx = inRange ? `${lx.toFixed(1)}px` : '-9999px';
          const nextPy = inRange ? `${ly.toFixed(1)}px` : '-9999px';
          if (entry.pxStr !== nextPx) {
            entry.pxStr = nextPx;
            entry.box.style.setProperty('--ag-px', nextPx);
          }
          if (entry.pyStr !== nextPy) {
            entry.pyStr = nextPy;
            entry.box.style.setProperty('--ag-py', nextPy);
          }
        }

        if (cachedOrchEntry) {
          const r = allowReadRect ? cachedOrchEntry.rect : null;
          let inRange = false;
          let lx = -9999;
          let ly = -9999;
          if (r && r.width >= 10) {
            const maxRange = 120;
            if (x >= r.left - maxRange && x <= r.right + maxRange && y >= r.top - maxRange && y <= r.bottom + maxRange) {
              inRange = true;
              lx = x - r.left;
              ly = y - r.top;
            }
          }
          if (!(cachedOrchEntry.ctx && paintPrismRimCanvas(cachedOrchEntry, inRange, lx, ly, 96, dark, toneKey, ambientScale))) {
            const nextOx = inRange ? `${lx.toFixed(1)}px` : '-9999px';
            const nextOy = inRange ? `${ly.toFixed(1)}px` : '-9999px';
            if (cachedOrchEntry.pxStr !== nextOx) {
              cachedOrchEntry.pxStr = nextOx;
              cachedOrchEntry.box.style.setProperty('--orch-px', nextOx);
            }
            if (cachedOrchEntry.pyStr !== nextOy) {
              cachedOrchEntry.pyStr = nextOy;
              cachedOrchEntry.box.style.setProperty('--orch-py', nextOy);
            }
          }
          if (typeof setCrystalPointerClient === 'function') {
            setCrystalPointerClient(x, y);
          }
        }
      });
    }

    function onPointerMove(ev) {
      if (isDestroyed()) return;
      const x = Number(ev.clientX), y = Number(ev.clientY);
      lastPointerPos.x = x;
      lastPointerPos.y = y;
      const now = performance.now();
      if (!isRimMotionDisabled() && readAmbientScale() > 0.001 && !prismRaf && typeof requestAnimationFrame === 'function') {
        const far = (e, d) => {
          const r = e.rect;
          return e.wasCleared && r && (x < r.left - d || x > r.right + d || y < r.top - d || y > r.bottom + d);
        };
        const farIdle =
          !prismBoxCacheDirty &&
          cachedPrismBoxes.length > 0 &&
          now - prismBoxCacheAt <= 6000 &&
          now - lastPrismRectReadAt < 1500 &&
          cachedPrismBoxes.every((e) => far(e, 360)) &&
          (!cachedOrchEntry || far(cachedOrchEntry, 200));
        if (!farIdle) prismRaf = requestAnimationFrame(flushPrismPointer);
      }
      if (typeof onPointerActivity === 'function') {
        onPointerActivity(now);
      }
    }

    function cancelPendingRaf() {
      if (prismRaf) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(prismRaf);
        prismRaf = 0;
      }
    }

    function invalidateMetrics() {
      prismBoxCacheDirty = true;
      for (let i = 0; i < cachedPrismBoxes.length; i++) {
        cachedPrismBoxes[i].borderRadius = -1;
      }
      if (isDestroyed()) return;
      runGuardedMut(() => {
        pruneOrphanRimCanvases();
        if (isRimMotionDisabled() || readAmbientScale() <= 0.001) {
          cancelPendingRaf();
          clearAllRimCanvases();
        } else if (lastPointerPos.x >= -1000 && !prismRaf && typeof requestAnimationFrame === 'function') {
          lastPrismDrawAt = 0;
          prismRaf = requestAnimationFrame(flushPrismPointer);
        }
      });
    }

    function markDirty() {
      prismBoxCacheDirty = true;
      if (isDestroyed()) return;
      runGuardedMut(() => {
        pruneOrphanRimCanvases(false);
        if (isRimMotionDisabled() || readAmbientScale() <= 0.001) {
          cancelPendingRaf();
          clearAllRimCanvases();
        }
      });
    }

    function teardownDynPointerRules() {
      cancelPendingRaf();
      trackedRimCanvases.clear();
      if (prismBoxRo) {
        try {
          prismBoxRo.disconnect();
        } catch {}
        prismBoxRo = null;
      }
      observedPrismSet.clear();
      if (typeof document !== 'undefined') {
        document.getElementById('ag-prism-dyn-vars')?.remove?.();
        document.querySelectorAll('.ag-cs-prism-rim-cv').forEach((n) => n.remove());
        document.querySelectorAll('[data-ag-cs-prism-cv]').forEach((el) => el.removeAttribute('data-ag-cs-prism-cv'));
      }
      cachedPrismBoxes = [];
      cachedOrchEntry = null;
    }

    return {
      onPointerMove,
      cancelPendingRaf,
      teardown: teardownDynPointerRules,
      markDirty,
      invalidateMetrics,
      getLastPointerPos: () => lastPointerPos,
    };
  }

  const api = { createPrismRimCanvasController };
  if (typeof module === 'object' && module.exports) module.exports = api;
  G.__agPrismRimCanvas = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
