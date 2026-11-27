// Obsidian Prism — FastDOM Smooth Typing Caret Engine
// Extracted from ui-runtime.js: separates measure & mutate phases with zero forced layout reflow.

(function (root) {
  'use strict';
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : window);
  if (!G) return;

  function snapDevicePx(value, dpr = 1) {
    const v = Number(value) || 0;
    const d = Number.isFinite(Number(dpr)) && Number(dpr) > 0 ? Math.min(4, Number(dpr)) : 1;
    return +(Math.round(v * d) / d).toFixed(3);
  }

  function createSmoothCaretController({ isDestroyed, isEnabled, setAttrIfChanged, runGuardedMut }) {
    let caretTypingTimer = null, caretRaf = 0, lastBlinkHoldAt = 0;
    let pendingCaretTyping = false, pendingCaretRefreshMetrics = false, pendingCaretScroll = false;
    let editorMetricsEpoch = 1, cachedEditors = [], lastEditorScanAt = 0;
    const editorMetricsCache = new WeakMap(), caretPrevState = new WeakMap(), caretNodeCache = new WeakMap(), selectionSigCache = new WeakMap();
    let emptyCaretProbeCache = new WeakMap();

    const isBlankTxt = (n) => { const v = n.data ?? n.nodeValue ?? ''; return !v.length || (v.length === 1 && v.charCodeAt(0) === 0x200b); };
    const isEditorQuickEmpty = (ed, fn) => {
      if (!ed) return true;
      const ch = ed.children, cns = ed.childNodes;
      if ((ch && ch.length > 1) || (fn?.nodeType === 3 && !isBlankTxt(fn))) return false;
      if (!ch && !cns) return !(ed.textContent && ed.textContent.replace(/\u200b/g, '').length);
      if (cns && cns.length > 1) return false;
      let cur = (ch && ch[0]) || ed.firstChild || (cns && cns[0]) || null;
      for (let d = 0; d < 3; d++) {
        if (!cur || cur.nodeName === 'BR') return true;
        if (cur.nodeType === 3) return isBlankTxt(cur);
        const k = cur.childNodes;
        if (!k || !k.length) return d < 2;
        if (k.length > 1) return false;
        cur = k[0];
      }
      return false;
    };

    function teardown() {
      if (caretTypingTimer) { clearTimeout(caretTypingTimer); caretTypingTimer = null; }
      if (caretRaf && typeof cancelAnimationFrame === 'function') { cancelAnimationFrame(caretRaf); caretRaf = 0; }
      lastBlinkHoldAt = 0;
      pendingCaretTyping = false;
      pendingCaretRefreshMetrics = false;
      pendingCaretScroll = false;
      cachedEditors = [];
      lastEditorScanAt = 0;
      if (typeof document === 'undefined') return;
      document.querySelectorAll('.ag-cs-smooth-caret').forEach((n) => n.remove());
      document.querySelectorAll('[data-ag-cs-smooth-caret]').forEach((n) => n.removeAttribute('data-ag-cs-smooth-caret'));
      document.querySelectorAll('[data-ag-cs-caret-host]').forEach((n) => n.removeAttribute('data-ag-cs-caret-host'));
    }

    function bumpMetricsEpoch() {
      editorMetricsEpoch += 1;
      lastEditorScanAt = 0;
      emptyCaretProbeCache = new WeakMap();
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
            epoch: editorMetricsEpoch,
          });
        }
      };

      const okR = (r) => !!(r && r.height > 0 && (r.left > 0 || r.top > 0));
      if (typeof document !== 'undefined' && typeof document.getSelection === 'function') {
        const sel = document.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = typeof sel.getRangeAt === 'function' ? sel.getRangeAt(0) : null;
          const isCol0 = range && typeof range.collapsed === 'boolean' ? range.collapsed : Boolean(sel.isCollapsed);
          if (!isCol0) return { collapsed: false };
          if (range && ed.contains && ed.contains(range.startContainer)) {
            const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : [];
            const r0 = rects && rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect?.() || null;
            if (okR(r0)) return checkScrollBounds({ collapsed: true, left: r0.left, top: r0.top, height: r0.height });
            const sc = range.startContainer, so = range.startOffset;
            const brBox = (n, chkSingle) => {
              const r = n?.nodeName === 'BR' ? n.getBoundingClientRect?.() : null;
              if (!okR(r)) return null;
              if ((!chkSingle || sc.childNodes.length <= 1) && isEditorQuickEmpty(ed, sc)) cacheEmptyProbe(r);
              return checkScrollBounds({ collapsed: true, left: r.left, top: r.top, height: r.height });
            };
            const b0 = brBox(sc, false);
            if (b0) return b0;
            if (sc && sc.nodeType === 1) {
              const b1 = brBox(sc.childNodes?.[so], true);
              if (b1) return b1;
              const cp = so > 0 ? sc.childNodes?.[so - 1] : null, br = cp?.nodeName === 'BR' ? cp.getBoundingClientRect?.() : null;
              if (okR(br)) {
                const mg = cp.hasAttribute?.('data-lexical-managed-linebreak') || sc.childNodes.length === 1;
                const sr = sc.getBoundingClientRect?.();
                const box = { collapsed: true, left: sr && sr.left > 0 ? sr.left : br.left, top: mg ? br.top : br.bottom, height: br.height };
                if (mg && sc.childNodes.length <= 1 && isEditorQuickEmpty(ed, sc)) cacheEmptyProbe(box);
                return checkScrollBounds(box);
              }
              if (sc !== ed) {
                const sr = sc.getBoundingClientRect?.();
                if (sr && (sr.left > 0 || sr.top > 0)) return checkScrollBounds({ collapsed: true, left: sr.left, top: sr.top, height: Math.min(estGlyphH, sr.height || estGlyphH) });
              }
            }
          }
        }
      }

      const cached = emptyCaretProbeCache.get(ed);
      if (cached && cached.epoch === editorMetricsEpoch) {
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

    function resolveComposerEditors(activeEl, refreshMetrics) {
      const now = Date.now();
      const activeIsEditable = Boolean(
        activeEl && (activeEl.isContentEditable || activeEl.getAttribute?.('contenteditable') === 'true')
      );
      const cacheValid =
        !refreshMetrics &&
        cachedEditors.length > 0 &&
        now - lastEditorScanAt < 1200 &&
        cachedEditors.every((e) => e && e.isConnected !== false) &&
        (!activeIsEditable || cachedEditors.includes(activeEl));
      if (cacheValid) return cachedEditors;
      cachedEditors = Array.from(document.querySelectorAll('[data-testid="agent-input-box"] [contenteditable="true"]'));
      lastEditorScanAt = now;
      return cachedEditors;
    }

    function measureSnapshot(refreshMetrics = false, checkScroll = true) {
      if (isDestroyed() || !isEnabled() || typeof document === 'undefined') return null;
      const activeEl = document.activeElement;
      const editors = resolveComposerEditors(activeEl, refreshMetrics);
      if (editors.length === 0) return null;
      const sel = typeof document.getSelection === 'function' ? document.getSelection() : null;
      const list = [];
      for (const ed of editors) {
        const host = ed.parentElement;
        if (!host) continue;
        const isFocused = activeEl === ed || Boolean(activeEl && ed.contains && ed.contains(activeEl));
        if (!isFocused) {
          selectionSigCache.delete(ed);
          const cachedCaret = caretNodeCache.get(host);
          const caretVis = cachedCaret && cachedCaret.isConnected !== false
            ? cachedCaret.getAttribute?.('data-ag-cs-caret-visible') === '1'
            : Boolean(host.querySelector?.('.ag-cs-smooth-caret[data-ag-cs-caret-visible="1"]'));
          if (!host.hasAttribute?.('data-ag-cs-caret-host') || ed.hasAttribute?.('data-ag-cs-smooth-caret') || caretVis) {
            list.push({ ed, host, isFocused: false, measured: null, hostRect: null, clientLeft: 0, clientTop: 0, scrollLeft: 0, scrollTop: 0, isNowEmpty: true });
          }
          continue;
        }
        let scrolledOnly = false;
        const rc = sel ? sel.rangeCount || 0 : 0;
        const r0 = rc > 0 && typeof sel.getRangeAt === 'function' ? sel.getRangeAt(0) : null;
        const isCol = r0 && typeof r0.collapsed === 'boolean' ? r0.collapsed : rc > 0 ? Boolean(sel.isCollapsed) : true;
        const fNode = r0 && r0.endContainer !== undefined ? r0.endContainer : rc > 0 ? sel.focusNode : null;
        const fOff = r0 && typeof r0.endOffset === 'number' ? r0.endOffset : rc > 0 ? sel.focusOffset : -1;
        const childCnt = ed.children ? ed.children.length : (ed.childNodes ? ed.childNodes.length : 0);
        const textSig =
          fNode && typeof fNode.nodeValue === 'string'
            ? fNode.nodeValue.length
            : fNode && fNode.childNodes
            ? fNode.childNodes.length
            : (ed.childNodes ? ed.childNodes.length : 0);
        const prevSig = selectionSigCache.get(ed);
        const alreadySynced = Boolean(prevSig) && (ed.hasAttribute?.('data-ag-cs-smooth-caret') || prevSig.hidden);
        let sameSelection = false;
        if (!refreshMetrics && alreadySynced) {
          sameSelection =
            prevSig.epoch === editorMetricsEpoch &&
            prevSig.rc === rc &&
            prevSig.isCollapsed === isCol &&
            prevSig.focusNode === fNode &&
            prevSig.focusOffset === fOff &&
            prevSig.childCnt === childCnt &&
            prevSig.textSig === textSig;
          // Zero forced-reflow fast path: skip scrollLeft/scrollTop DOM layout reads unless scroll was flagged or selection actually changed!
          if (sameSelection && !checkScroll) continue;
        }
        const edScrollLeft = ed.scrollLeft || 0;
        const edScrollTop = ed.scrollTop || 0;
        const hostScrollLeft = host.scrollLeft || 0;
        const hostScrollTop = host.scrollTop || 0;
        if (!refreshMetrics && alreadySynced && sameSelection) {
          const sameScroll =
            prevSig.edScrollLeft === edScrollLeft &&
            prevSig.edScrollTop === edScrollTop &&
            prevSig.hostScrollLeft === hostScrollLeft &&
            prevSig.hostScrollTop === hostScrollTop;
          if (sameScroll) continue;
          scrolledOnly = true;
        }
        const measured = measureEditorCaretBox(ed, refreshMetrics);
        const hostRect = measured && measured.collapsed ? host.getBoundingClientRect() : null;
        selectionSigCache.set(ed, {
          epoch: editorMetricsEpoch,
          rc,
          isCollapsed: isCol,
          focusNode: fNode,
          focusOffset: fOff,
          childCnt,
          textSig,
          edScrollLeft,
          edScrollTop,
          hostScrollLeft,
          hostScrollTop,
          hidden: !(measured && measured.collapsed && hostRect),
        });
        const clientLeft = host.clientLeft || 0;
        const clientTop = host.clientTop || 0;
        const isNowEmpty = isEditorQuickEmpty(ed, fNode);
        list.push({
          ed,
          host,
          isFocused,
          measured,
          hostRect,
          clientLeft,
          clientTop,
          scrollLeft: hostScrollLeft,
          scrollTop: hostScrollTop,
          isNowEmpty,
          scrolledOnly,
        });
      }
      return list;
    }

    function applyMutations(snapshotList, isTypingEvent = false) {
      if (isDestroyed() || !isEnabled()) {
        teardown();
        return;
      }
      if (!snapshotList || snapshotList.length === 0 || typeof document === 'undefined') return;
      runGuardedMut(() => {
        for (const item of snapshotList) {
          const { ed, host, isFocused, measured, hostRect, clientLeft, clientTop, scrollLeft, scrollTop, isNowEmpty, scrolledOnly } = item;
          setAttrIfChanged(host, 'data-ag-cs-caret-host', '1');
          let caret = caretNodeCache.get(host);
          if (!caret || caret.parentElement !== host) caret = host.querySelector('.ag-cs-smooth-caret');
          if (!caret) {
            caret = document.createElement('div');
            caret.className = 'ag-cs-smooth-caret';
            caret.setAttribute('aria-hidden', 'true');
            caret.setAttribute('data-ag-no-i18n', '');
            host.appendChild(caret);
          }
          caretNodeCache.set(host, caret);

          if (!measured || !measured.collapsed || !hostRect) {
            if (caret.hasAttribute('data-ag-cs-caret-visible')) caret.removeAttribute('data-ag-cs-caret-visible');
            if (ed.hasAttribute('data-ag-cs-smooth-caret')) ed.removeAttribute('data-ag-cs-smooth-caret');
            continue;
          }

          const rawDpr = (typeof window !== 'undefined' && Number(window.devicePixelRatio)) || 1;
          const x = snapDevicePx(measured.left - hostRect.left - clientLeft + scrollLeft, rawDpr);
          const y = snapDevicePx(measured.top - hostRect.top - clientTop + scrollTop, rawDpr);
          const h = Math.max(15, snapDevicePx(measured.height || 18, rawDpr));
          const wasVisible = caret.getAttribute('data-ag-cs-caret-visible') === '1';
          const prev = caretPrevState.get(caret);
          const clearedToEmpty = Boolean(prev && prev.empty === false && isNowEmpty);

          if ((isFocused && !wasVisible) || clearedToEmpty || scrolledOnly) {
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
            const armTypingHold = (ms) => {
              lastBlinkHoldAt = Date.now();
              setAttrIfChanged(caret, 'data-ag-cs-caret-typing', '1');
              if (caretTypingTimer) clearTimeout(caretTypingTimer);
              caretTypingTimer = setTimeout(() => { caretTypingTimer = null; if (caret.isConnected) caret.removeAttribute('data-ag-cs-caret-typing'); }, ms);
            };
            if (isTypingEvent) armTypingHold(420);
            else if (prev && (prev.x !== x || prev.y !== y) && Date.now() - lastBlinkHoldAt >= 60) armTypingHold(220);
          } else {
            if (caret.hasAttribute('data-ag-cs-caret-visible')) caret.removeAttribute('data-ag-cs-caret-visible');
            if (ed.hasAttribute('data-ag-cs-smooth-caret')) ed.removeAttribute('data-ag-cs-smooth-caret');
          }
        }
      });
    }

    function sync(isTypingEvent = false, refreshMetrics = false, checkScroll = true) {
      if (isDestroyed() || !isEnabled()) {
        teardown();
        return;
      }
      const snap = measureSnapshot(refreshMetrics, checkScroll);
      applyMutations(snap, isTypingEvent);
    }

    function queue(isTyping = false, immediate = false, refreshMetrics = false, isScroll = false) {
      if (isDestroyed() || !isEnabled()) return;
      if (isTyping) pendingCaretTyping = true;
      if (refreshMetrics) pendingCaretRefreshMetrics = true;
      if (isScroll) pendingCaretScroll = true;
      if (immediate) {
        if (caretRaf && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(caretRaf);
          caretRaf = 0;
        }
        const typingNow = pendingCaretTyping || isTyping;
        const refreshNow = pendingCaretRefreshMetrics || refreshMetrics;
        const scrollNow = pendingCaretScroll || isScroll;
        pendingCaretTyping = false;
        pendingCaretRefreshMetrics = false;
        pendingCaretScroll = false;
        sync(typingNow, refreshNow, scrollNow);
        return;
      }
      if (caretRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(caretRaf);
      if (typeof requestAnimationFrame === 'function') {
        caretRaf = requestAnimationFrame(() => {
          caretRaf = 0;
          const typingNow = pendingCaretTyping;
          const refreshNow = pendingCaretRefreshMetrics;
          const scrollNow = pendingCaretScroll;
          pendingCaretTyping = false;
          pendingCaretRefreshMetrics = false;
          pendingCaretScroll = false;
          sync(typingNow, refreshNow, scrollNow);
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

  const api = { createSmoothCaretController, snapDevicePx };
  if (typeof module === 'object' && module.exports) module.exports = api;
  G.__agPrismSmoothCaret = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
