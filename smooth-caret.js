// Obsidian Prism — FastDOM Smooth Typing Caret Engine
// Extracted from ui-runtime.js: separates measure & mutate phases with zero forced layout reflow.

(function (root) {
  'use strict';
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : window);
  if (!G) return;

  function createSmoothCaretController({ isDestroyed, isEnabled, setAttrIfChanged, runGuardedMut }) {
    let caretTypingTimer = null;
    let caretRaf = 0;
    let pendingCaretTyping = false;
    let pendingCaretRefreshMetrics = false;
    let editorMetricsEpoch = 1;
    const editorMetricsCache = new WeakMap();
    const emptyCaretProbeCache = new WeakMap();
    const caretPrevState = new WeakMap();

    function teardown() {
      if (caretTypingTimer) {
        clearTimeout(caretTypingTimer);
        caretTypingTimer = null;
      }
      if (caretRaf && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(caretRaf);
        caretRaf = 0;
      }
      pendingCaretTyping = false;
      pendingCaretRefreshMetrics = false;
      if (typeof document === 'undefined') return;
      document.querySelectorAll('.ag-cs-smooth-caret').forEach((n) => n.remove());
      document.querySelectorAll('[data-ag-cs-smooth-caret]').forEach((n) => n.removeAttribute('data-ag-cs-smooth-caret'));
      document.querySelectorAll('[data-ag-cs-caret-host]').forEach((n) => n.removeAttribute('data-ag-cs-caret-host'));
    }

    function bumpMetricsEpoch() {
      editorMetricsEpoch += 1;
    }

    function getCachedEditorMetrics(ed, forceRefresh = false) {
      let rec = editorMetricsCache.get(ed);
      if (rec && !forceRefresh && rec.epoch === editorMetricsEpoch) return rec;
      const cs = typeof getComputedStyle === 'function' ? getComputedStyle(ed) : null;
      const padL = parseFloat(cs?.paddingLeft || '8') || 8;
      const padT = parseFloat(cs?.paddingTop || '8') || 8;
      const fontSize = parseFloat(cs?.fontSize || '14') || 14;
      const lineH = parseFloat(cs?.lineHeight || '22') || fontSize * 1.5 || 22;
      const estGlyphH = Math.max(16, Math.min(24, Math.round(fontSize * 1.28)));
      const defaultH = Math.max(16, Math.min(28, lineH));
      const estEmptyTopOffset = padT + Math.max(0, Math.round((defaultH - estGlyphH) / 2));
      rec = { padL, padT, fontSize, lineH, estGlyphH, defaultH, estEmptyTopOffset, epoch: editorMetricsEpoch };
      editorMetricsCache.set(ed, rec);
      return rec;
    }

    function measureEditorCaretBox(ed, refreshMetrics = false) {
      if (!ed) return null;
      const edRect = ed.getBoundingClientRect();
      const { padL, estGlyphH, estEmptyTopOffset } = getCachedEditorMetrics(ed, refreshMetrics);

      const checkScrollBounds = (box) => {
        if (!box || !box.collapsed) return box;
        if ((ed.scrollHeight || 0) > (ed.clientHeight || 0) + 2 && edRect.height > 0) {
          if (box.top < edRect.top - 4 || box.top + box.height > edRect.bottom + 6) {
            return { collapsed: false };
          }
        }
        return box;
      };

      const cacheEmptyProbe = (boxRect) => {
        if (boxRect && boxRect.height > 0 && boxRect.height < 36 && edRect.height > 0) {
          emptyCaretProbeCache.set(ed, {
            dx: boxRect.left - edRect.left,
            dy: boxRect.top - edRect.top,
            height: boxRect.height,
          });
        }
      };

      if (typeof document !== 'undefined' && typeof document.getSelection === 'function') {
        const sel = document.getSelection();
        if (sel && sel.rangeCount > 0) {
          if (!sel.isCollapsed) return { collapsed: false };
          const range = sel.getRangeAt(0);
          if (ed.contains && ed.contains(range.startContainer)) {
            const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : [];
            const r0 =
              rects && rects.length > 0
                ? rects[rects.length - 1]
                : typeof range.getBoundingClientRect === 'function'
                ? range.getBoundingClientRect()
                : null;
            if (r0 && r0.height > 0 && (r0.left > 0 || r0.top > 0)) {
              return checkScrollBounds({ collapsed: true, left: r0.left, top: r0.top, height: r0.height });
            }

            const sc = range.startContainer;
            const so = range.startOffset;
            if (sc?.nodeName === 'BR' && typeof sc.getBoundingClientRect === 'function') {
              const brRect = sc.getBoundingClientRect();
              if (brRect && brRect.height > 0 && (brRect.left > 0 || brRect.top > 0)) {
                if (!ed.textContent) cacheEmptyProbe(brRect);
                return checkScrollBounds({ collapsed: true, left: brRect.left, top: brRect.top, height: brRect.height });
              }
            }
            if (sc && sc.nodeType === 1) {
              const childAt = sc.childNodes?.[so];
              if (childAt?.nodeName === 'BR' && typeof childAt.getBoundingClientRect === 'function') {
                const brRect = childAt.getBoundingClientRect();
                if (brRect && brRect.height > 0 && (brRect.left > 0 || brRect.top > 0)) {
                  if (sc.childNodes.length <= 1 && !ed.textContent) cacheEmptyProbe(brRect);
                  return checkScrollBounds({ collapsed: true, left: brRect.left, top: brRect.top, height: brRect.height });
                }
              }
              const childPrev = so > 0 ? sc.childNodes?.[so - 1] : null;
              if (childPrev?.nodeName === 'BR' && typeof childPrev.getBoundingClientRect === 'function') {
                const brRect = childPrev.getBoundingClientRect();
                if (brRect && brRect.height > 0 && (brRect.left > 0 || brRect.top > 0)) {
                  const isManagedEmptyLine =
                    (typeof childPrev.hasAttribute === 'function' && childPrev.hasAttribute('data-lexical-managed-linebreak')) ||
                    sc.childNodes.length === 1;
                  const scRect = typeof sc.getBoundingClientRect === 'function' ? sc.getBoundingClientRect() : null;
                  const lineLeft = scRect && scRect.left > 0 ? scRect.left : brRect.left;
                  const lineTop = isManagedEmptyLine ? brRect.top : brRect.bottom;
                  const box = { collapsed: true, left: lineLeft, top: lineTop, height: brRect.height };
                  if (isManagedEmptyLine && sc.childNodes.length <= 1 && !ed.textContent) cacheEmptyProbe(box);
                  return checkScrollBounds(box);
                }
              }
              if (typeof sc.getBoundingClientRect === 'function' && sc !== ed) {
                const scRect = sc.getBoundingClientRect();
                if (scRect && (scRect.left > 0 || scRect.top > 0)) {
                  return checkScrollBounds({
                    collapsed: true,
                    left: scRect.left,
                    top: scRect.top,
                    height: Math.min(estGlyphH, scRect.height || estGlyphH),
                  });
                }
              }
            }
          }
        }
      }

      const cached = emptyCaretProbeCache.get(ed);
      if (cached) {
        return checkScrollBounds({
          collapsed: true,
          left: edRect.left + cached.dx,
          top: edRect.top + cached.dy,
          height: cached.height,
        });
      }

      return checkScrollBounds({
        collapsed: true,
        left: edRect.left + padL,
        top: edRect.top + estEmptyTopOffset,
        height: estGlyphH,
      });
    }

    function measureSnapshot(refreshMetrics = false) {
      if (isDestroyed() || !isEnabled() || typeof document === 'undefined') return null;
      const editors = document.querySelectorAll('[data-testid="agent-input-box"] [contenteditable="true"]');
      const activeEl = document.activeElement;
      const list = [];
      for (const ed of editors) {
        const host = ed.parentElement;
        if (!host) continue;
        const isFocused = activeEl === ed || Boolean(activeEl && ed.contains && ed.contains(activeEl));
        const measured = measureEditorCaretBox(ed, refreshMetrics);
        const hostRect = measured && measured.collapsed ? host.getBoundingClientRect() : null;
        const clientLeft = host.clientLeft || 0;
        const clientTop = host.clientTop || 0;
        const scrollLeft = host.scrollLeft || 0;
        const scrollTop = host.scrollTop || 0;
        const cleanText = (ed.textContent || '').replace(/\u200b/g, '');
        const isNowEmpty = cleanText.length === 0 && ed.querySelectorAll('p, div').length <= 1;
        list.push({
          ed,
          host,
          isFocused,
          measured,
          hostRect,
          clientLeft,
          clientTop,
          scrollLeft,
          scrollTop,
          isNowEmpty,
        });
      }
      return list;
    }

    function applyMutations(snapshotList, isTypingEvent = false) {
      if (isDestroyed() || !isEnabled()) {
        teardown();
        return;
      }
      if (!snapshotList || typeof document === 'undefined') return;
      runGuardedMut(() => {
        for (const item of snapshotList) {
          const { ed, host, isFocused, measured, hostRect, clientLeft, clientTop, scrollLeft, scrollTop, isNowEmpty } = item;
          setAttrIfChanged(host, 'data-ag-cs-caret-host', '1');
          let caret = host.querySelector('.ag-cs-smooth-caret');
          if (!caret) {
            caret = document.createElement('div');
            caret.className = 'ag-cs-smooth-caret';
            caret.setAttribute('aria-hidden', 'true');
            caret.setAttribute('data-ag-no-i18n', '');
            host.appendChild(caret);
          }

          if (!measured || !measured.collapsed || !hostRect) {
            if (caret.hasAttribute('data-ag-cs-caret-visible')) caret.removeAttribute('data-ag-cs-caret-visible');
            if (ed.hasAttribute('data-ag-cs-smooth-caret')) ed.removeAttribute('data-ag-cs-smooth-caret');
            continue;
          }

          const x = Math.round(measured.left - hostRect.left - clientLeft + scrollLeft);
          const y = Math.round(measured.top - hostRect.top - clientTop + scrollTop);
          const h = Math.max(15, Math.round(measured.height || 18));
          const wasVisible = caret.getAttribute('data-ag-cs-caret-visible') === '1';
          const prev = caretPrevState.get(caret);
          const clearedToEmpty = Boolean(prev && prev.empty === false && isNowEmpty);

          if ((isFocused && !wasVisible) || clearedToEmpty) {
            caret.style.transition = 'none';
            caret.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            caret.style.height = `${h}px`;
            if (typeof requestAnimationFrame === 'function') {
              requestAnimationFrame(() => {
                if (caret.isConnected) caret.style.transition = '';
              });
            } else {
              caret.style.transition = '';
            }
          } else {
            if (!prev || prev.x !== x || prev.y !== y) {
              caret.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            }
            if (!prev || prev.h !== h) {
              caret.style.height = `${h}px`;
            }
          }
          caretPrevState.set(caret, { x, y, h, empty: isNowEmpty });

          if (isFocused) {
            setAttrIfChanged(caret, 'data-ag-cs-caret-visible', '1');
            setAttrIfChanged(ed, 'data-ag-cs-smooth-caret', '1');
            if (isTypingEvent) {
              setAttrIfChanged(caret, 'data-ag-cs-caret-typing', '1');
              if (caretTypingTimer) clearTimeout(caretTypingTimer);
              caretTypingTimer = setTimeout(() => {
                caretTypingTimer = null;
                if (caret.isConnected) caret.removeAttribute('data-ag-cs-caret-typing');
              }, 420);
            } else if (prev && (prev.x !== x || prev.y !== y) && typeof caret.getAnimations === 'function') {
              for (const anim of caret.getAnimations()) {
                if (anim && anim.animationName === 'ag-cs-caret-blink') anim.currentTime = 0;
              }
            }
          } else {
            if (caret.hasAttribute('data-ag-cs-caret-visible')) caret.removeAttribute('data-ag-cs-caret-visible');
            if (ed.hasAttribute('data-ag-cs-smooth-caret')) ed.removeAttribute('data-ag-cs-smooth-caret');
          }
        }
      });
    }

    function sync(isTypingEvent = false, refreshMetrics = false) {
      if (isDestroyed() || !isEnabled()) {
        teardown();
        return;
      }
      const snap = measureSnapshot(refreshMetrics);
      applyMutations(snap, isTypingEvent);
    }

    function queue(isTyping = false, immediate = false, refreshMetrics = false) {
      if (isDestroyed() || !isEnabled()) return;
      if (isTyping) pendingCaretTyping = true;
      if (refreshMetrics) pendingCaretRefreshMetrics = true;
      if (immediate) {
        const typingNow = pendingCaretTyping || isTyping;
        const refreshNow = pendingCaretRefreshMetrics || refreshMetrics;
        pendingCaretTyping = false;
        pendingCaretRefreshMetrics = false;
        sync(typingNow, refreshNow);
      }
      if (caretRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(caretRaf);
      if (typeof requestAnimationFrame === 'function') {
        caretRaf = requestAnimationFrame(() => {
          caretRaf = 0;
          const typingNow = pendingCaretTyping;
          const refreshNow = pendingCaretRefreshMetrics;
          pendingCaretTyping = false;
          pendingCaretRefreshMetrics = false;
          sync(typingNow, refreshNow);
        });
      }
    }

    return {
      teardown,
      bumpMetricsEpoch,
      measureSnapshot,
      applyMutations,
      sync,
      queue,
    };
  }

  G.__agPrismSmoothCaret = { createSmoothCaretController };
})(typeof globalThis !== 'undefined' ? globalThis : window);
