// Obsidian Prism — FastDOM Smooth Typing Caret Engine
// Separates measure & mutate phases with zero forced layout reflow.

(function (root) {
  'use strict';
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : window);
  if (!G) return;

  const BLOCK_RE = /^(P|DIV|BLOCKQUOTE|UL|OL|LI|PRE|H[1-6]|HR)$/i;
  const ZWSP_RE = /^[\u200b\ufeff]*$/;
  const A_CARET = 'data-ag-cs-smooth-caret';
  const A_HOST = 'data-ag-cs-caret-host';
  const A_VIS = 'data-ag-cs-caret-visible';
  const A_TYP = 'data-ag-cs-caret-typing';
  const S_CARET = '.ag-cs-smooth-caret';
  const isFn = (v) => typeof v === 'function';
  const rectOf = (n) => (n && isFn(n.getBoundingClientRect) ? n.getBoundingClientRect() : null);
  const rmAttr = (el, k) => { if (el?.hasAttribute?.(k)) el.removeAttribute(k); };
  const isBlockEl = (n) => !!(n && n.nodeType === 1 && BLOCK_RE.test(n.nodeName || n.tagName || ''));
  const isDecoEl = (n) => !!(n && n.nodeType === 1 && n.nodeName !== 'BR' && (n.getAttribute?.('contenteditable') === 'false' || n.hasAttribute?.('data-lexical-decorator')));
  const isBlankTxt = (n) => ZWSP_RE.test(n.data ?? n.nodeValue ?? '');
  const prevSib = (n) => {
    if (!n) return null;
    if (n.previousSibling !== undefined) return n.previousSibling;
    const kids = n.parentNode?.childNodes;
    if (!kids) return null;
    for (let i = kids.length; --i > 0;) if (kids[i] === n) return kids[i - 1];
    return null;
  };

  function snapDevicePx(value, dpr = 1) {
    const v = Number(value) || 0;
    const d = Number.isFinite(Number(dpr)) && Number(dpr) > 0 ? Math.min(4, Number(dpr)) : 1;
    return +(Math.round(v * d) / d).toFixed(3);
  }

  function createSmoothCaretController({ isDestroyed, isEnabled, setAttrIfChanged, runGuardedMut }) {
    let tm = null, raf = 0, blinkAt = 0;
    let pTyp = false, pRef = false, pScr = false;
    let mEpoch = 1, sEpoch = 1, edList = [], scanAt = 0;
    const mCache = new WeakMap(), prevSt = new WeakMap(), cNode = new WeakMap(), sigCache = new WeakMap();
    let eCache = new WeakMap();

    const isQuickEmpty = (ed, fn) => {
      if (!ed) return true;
      const ch = ed.children, cns = ed.childNodes;
      if ((ch && ch.length > 1) || (fn?.nodeType === 3 && !isBlankTxt(fn))) return false;
      if (!ch && !cns) return !(ed.textContent && !ZWSP_RE.test(ed.textContent));
      if (cns && cns.length > 1) return false;
      let cur = (ch && ch[0]) || ed.firstChild || (cns && cns[0]) || null;
      for (let d = 0; d < 3; d++) {
        if (!cur || cur.nodeName === 'BR') return true;
        if (cur.nodeType === 3) return isBlankTxt(cur);
        if (isDecoEl(cur)) return false;
        const k = cur.childNodes;
        if (!k || !k.length) return d < 2;
        if (k.length > 1) return false;
        cur = k[0];
      }
      return false;
    };

    const hasContent = (ed) => {
      if (!ed) return false;
      if (!ed.childNodes) return !!(ed.textContent && !ZWSP_RE.test(ed.textContent));
      const st = [ed];
      for (let seen = 0; st.length && seen < 64;) {
        const list = st.pop().childNodes;
        for (let i = list ? list.length : 0; i--;) {
          const ch = list[i];
          if (!ch) continue;
          if (++seen >= 64) return true;
          if (ch.nodeType === 3) { if (!isBlankTxt(ch)) return true; }
          else if (ch.nodeType === 1) {
            if (isDecoEl(ch)) return true;
            if (ch.childNodes?.length) st.push(ch);
          }
        }
      }
      return false;
    };

    function teardown() {
      if (tm) { clearTimeout(tm); tm = null; }
      if (raf && isFn(cancelAnimationFrame)) { cancelAnimationFrame(raf); raf = 0; }
      blinkAt = scanAt = 0;
      pTyp = pRef = pScr = false;
      edList = [];
      if (typeof document === 'undefined') return;
      document.querySelectorAll(S_CARET).forEach((n) => n.remove());
      for (const a of [A_CARET, A_HOST]) document.querySelectorAll(`[${a}]`).forEach((n) => n.removeAttribute(a));
    }

    function bumpMetricsEpoch() {
      mEpoch += 1;
      scanAt = 0;
      eCache = new WeakMap();
    }

    function invalidateSelection() {
      sEpoch += 1;
    }

    function getMetrics(ed, force = false) {
      let rec = mCache.get(ed);
      if (rec && !force && rec[3] === mEpoch) return rec;
      const cs = isFn(getComputedStyle) ? getComputedStyle(ed) : null;
      const padL = parseFloat(cs?.paddingLeft || '8') || 8;
      const padT = parseFloat(cs?.paddingTop || '8') || 8;
      const fs = parseFloat(cs?.fontSize || '14') || 14;
      const lh = parseFloat(cs?.lineHeight || '22') || fs * 1.5 || 22;
      const gh = Math.max(16, Math.min(24, Math.round(fs * 1.28)));
      const dh = Math.max(16, Math.min(28, lh));
      rec = [padL, gh, padT + Math.max(0, Math.round((dh - gh) / 2)), mEpoch];
      mCache.set(ed, rec);
      return rec;
    }

    function measureBox(ed, refresh = false) {
      if (!ed) return null;
      const edR = ed.getBoundingClientRect();
      const [padL, gh, emptyTop] = getMetrics(ed, refresh);
      const NO_BOX = { collapsed: false };
      const mkBox = (left, top, height) => {
        if ((ed.scrollHeight || 0) > (ed.clientHeight || 0) + 2 && edR.height > 0) {
          if (top < edR.top - 4 || top + height > edR.bottom + 6) return NO_BOX;
        }
        return { collapsed: true, left, top, height };
      };

      const saveProbe = (r) => {
        if (r && r.height > 0 && r.height < 36 && edR.height > 0) {
          eCache.set(ed, [r.left - edR.left, r.top - edR.top, r.height, mEpoch]);
        }
      };

      const okR = (r) => !!(r && r.height > 0 && (r.left > 0 || r.top > 0));
      if (typeof document !== 'undefined' && isFn(document.getSelection)) {
        const sel = document.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = isFn(sel.getRangeAt) ? sel.getRangeAt(0) : null;
          const isCol0 = range && typeof range.collapsed === 'boolean' ? range.collapsed : Boolean(sel.isCollapsed);
          if (!isCol0) return NO_BOX;
          if (range && ed.contains && ed.contains(range.startContainer)) {
            const rects = isFn(range.getClientRects) ? range.getClientRects() : [];
            const r0 = rects && rects.length > 0 ? rects[rects.length - 1] : rectOf(range);
            if (okR(r0)) return mkBox(r0.left, r0.top, r0.height);
            const sc = range.startContainer, so = range.startOffset;
            const brBox = (n, chkSingle) => {
              const r = n?.nodeName === 'BR' ? rectOf(n) : null;
              if (!okR(r)) return null;
              if ((!chkSingle || sc.childNodes.length <= 1) && isQuickEmpty(ed, sc)) saveProbe(r);
              return mkBox(r.left, r.top, r.height);
            };
            const b0 = brBox(sc, false);
            if (b0) return b0;
            const inlineRight = (el) => {
              if (!el || el.nodeType !== 1 || el.nodeName === 'BR' || isBlockEl(el)) return null;
              const pr = rectOf(el);
              if (!pr || !(pr.height > 0 && pr.right > 0)) return null;
              const hasW = typeof pr.width === 'number' ? pr.width > 0 : typeof pr.left === 'number' ? pr.right > pr.left : true;
              if (!hasW && !isDecoEl(el)) return null;
              return mkBox(pr.right, pr.top, Math.min(gh, pr.height || gh));
            };
            const walkPrev = (start, inc) => {
              for (let cur = start, chk = inc, s = 0; cur && cur !== ed && s < 24; s++) {
                if (chk) {
                  chk = false;
                  if (cur.nodeType === 3) { if (!isBlankTxt(cur)) return null; }
                  else if (cur.nodeType === 1) {
                    if (cur.nodeName === 'BR' || isBlockEl(cur)) return null;
                    const box = inlineRight(cur);
                    if (box) return box;
                    if (isDecoEl(cur)) return null;
                  }
                }
                const prev = prevSib(cur);
                if (prev) { cur = prev; chk = true; continue; }
                const p = cur.parentNode;
                if (!p || p === ed || isBlockEl(p)) return null;
                cur = p;
              }
              return null;
            };
            if (sc?.nodeType === 1) {
              const b1 = brBox(sc.childNodes?.[so], true);
              if (b1) return b1;
              const cp = so > 0 ? sc.childNodes?.[so - 1] : null, br = cp?.nodeName === 'BR' ? rectOf(cp) : null;
              if (okR(br)) {
                const mg = cp.hasAttribute?.('data-lexical-managed-linebreak') || sc.childNodes.length === 1;
                const sr = rectOf(sc);
                const left = sr && sr.left > 0 ? sr.left : br.left, top = mg ? br.top : br.bottom;
                if (mg && sc.childNodes.length <= 1 && isQuickEmpty(ed, sc)) saveProbe({ left, top, height: br.height });
                return mkBox(left, top, br.height);
              }
              if (cp) {
                const ib = walkPrev(cp, true);
                if (ib) return ib;
              }
              if (sc !== ed && so === 0) {
                const sr = rectOf(sc);
                if (sr && (sr.left > 0 || sr.top > 0)) return mkBox(sr.left, sr.top, Math.min(gh, sr.height || gh));
              }
            } else if (sc?.nodeType === 3 && isBlankTxt(sc)) {
              const ib = walkPrev(sc, false);
              if (ib) return ib;
            }
          }
        }
      }

      if (hasContent(ed)) return NO_BOX;

      const cached = eCache.get(ed);
      if (cached && cached[3] === mEpoch) return mkBox(edR.left + cached[0], edR.top + cached[1], cached[2]);
      return mkBox(edR.left + padL, edR.top + emptyTop, gh);
    }

    function resolveEditors(ae, refresh) {
      const now = Date.now();
      const aeEdit = Boolean(ae && (ae.isContentEditable || ae.getAttribute?.('contenteditable') === 'true'));
      if (!refresh && edList.length > 0 && now - scanAt < 1200 && edList.every((e) => e && e.isConnected !== false) && (!aeEdit || edList.includes(ae))) {
        return edList;
      }
      edList = Array.from(document.querySelectorAll('[data-testid="agent-input-box"] [contenteditable="true"]'));
      scanAt = now;
      return edList;
    }

    function measureSnapshot(refresh = false, checkScroll = true) {
      if (isDestroyed() || !isEnabled() || typeof document === 'undefined') return null;
      const ae = document.activeElement;
      const editors = resolveEditors(ae, refresh);
      if (editors.length === 0) return null;
      const sel = isFn(document.getSelection) ? document.getSelection() : null;
      const list = [];
      for (const ed of editors) {
        const host = ed.parentElement;
        if (!host) continue;
        const focused = ae === ed || Boolean(ae && ed.contains && ed.contains(ae));
        if (!focused) {
          sigCache.delete(ed);
          const cc = cNode.get(host);
          const vis = cc && cc.isConnected !== false
            ? cc.getAttribute?.(A_VIS) === '1'
            : Boolean(host.querySelector?.(`${S_CARET}[${A_VIS}="1"]`));
          if (!host.hasAttribute?.(A_HOST) || ed.hasAttribute?.(A_CARET) || vis) {
            list.push([ed, host, false, null, null, 0, 0, 0, 0, true, false]);
          }
          continue;
        }
        let scrolledOnly = false;
        const rc = sel ? sel.rangeCount || 0 : 0;
        const r0 = rc > 0 && isFn(sel.getRangeAt) ? sel.getRangeAt(0) : null;
        const col = r0 && typeof r0.collapsed === 'boolean' ? r0.collapsed : rc > 0 ? Boolean(sel.isCollapsed) : true;
        const fn = r0 && r0.endContainer !== undefined ? r0.endContainer : rc > 0 ? sel.focusNode : null;
        const fo = r0 && typeof r0.endOffset === 'number' ? r0.endOffset : rc > 0 ? sel.focusOffset : -1;
        const cc = ed.children ? ed.children.length : (ed.childNodes ? ed.childNodes.length : 0);
        const fp = fn && fn !== ed ? fn.parentNode : null;
        const gp = fp && fp !== ed ? fp.parentNode : null;
        const lLen = fn && typeof fn.nodeValue === 'string' ? fn.nodeValue.length : fn?.childNodes ? fn.childNodes.length : cc;
        let pn = null;
        if (fn && fn !== ed) {
          pn = fn.nodeType === 1 && fo > 0 ? fn.childNodes?.[fo - 1] || null : prevSib(fn) || (fp && !isBlockEl(fp) ? prevSib(fp) : null);
        }
        const pSig =
          pn && pn !== ed
            ? pn.nodeType === 3
              ? (pn.data ?? pn.nodeValue ?? '').length
              : `${pn.childNodes ? pn.childNodes.length : 0}:${!isBlockEl(pn) && (isDecoEl(pn) || !pn.childNodes || pn.childNodes.length <= 8) && typeof pn.textContent === 'string' ? pn.textContent.length : 0}`
            : -1;
        const sigStr = `${mEpoch}:${sEpoch}:${rc}:${col ? 1 : 0}:${fo}:${cc}:${lLen}:${fp?.childNodes ? fp.childNodes.length : -1}:${gp?.childNodes ? gp.childNodes.length : -1}:${pSig}`;
        const prev = sigCache.get(ed);
        const synced = Boolean(prev) && (ed.hasAttribute?.(A_CARET) || prev[7]);
        const same = !refresh && synced && prev[0] === sigStr && prev[1] === fn && prev[2] === pn;
        if (same && !checkScroll) continue;
        const esl = ed.scrollLeft || 0, est = ed.scrollTop || 0, hsl = host.scrollLeft || 0, hst = host.scrollTop || 0;
        if (same) {
          if (prev[3] === esl && prev[4] === est && prev[5] === hsl && prev[6] === hst) continue;
          scrolledOnly = true;
        }
        const measured = measureBox(ed, refresh);
        const hostRect = measured && measured.collapsed ? host.getBoundingClientRect() : null;
        sigCache.set(ed, [sigStr, fn, pn, esl, est, hsl, hst, !(measured && measured.collapsed && hostRect)]);
        list.push([ed, host, focused, measured, hostRect, host.clientLeft || 0, host.clientTop || 0, hsl, hst, isQuickEmpty(ed, fn), scrolledOnly]);
      }
      return list;
    }

    function applyMutations(snapList, isTyping = false) {
      if (isDestroyed() || !isEnabled()) { teardown(); return; }
      if (!snapList || snapList.length === 0 || typeof document === 'undefined') return;
      runGuardedMut(() => {
        const dpr = (typeof window !== 'undefined' && Number(window.devicePixelRatio)) || 1;
        for (const [ed, host, focused, measured, hostRect, cl, ct, sl, st, empty, scrolledOnly] of snapList) {
          setAttrIfChanged(host, A_HOST, '1');
          let caret = cNode.get(host);
          if (!caret || caret.parentElement !== host) caret = host.querySelector(S_CARET);
          if (!caret) {
            caret = document.createElement('div');
            caret.className = 'ag-cs-smooth-caret';
            caret.setAttribute('aria-hidden', 'true');
            caret.setAttribute('data-ag-no-i18n', '');
            host.appendChild(caret);
          }
          cNode.set(host, caret);

          if (!focused || !measured || !measured.collapsed || !hostRect) {
            rmAttr(caret, A_VIS);
            rmAttr(ed, A_CARET);
            continue;
          }

          const x = snapDevicePx(measured.left - hostRect.left - cl + sl, dpr);
          const y = snapDevicePx(measured.top - hostRect.top - ct + st, dpr);
          const h = Math.max(15, snapDevicePx(measured.height || 18, dpr));
          const wasVis = caret.getAttribute(A_VIS) === '1';
          const prev = prevSt.get(caret);
          const cs = caret.style, tr = `translate3d(${x}px, ${y}px, 0)`, hs = `${h}px`;

          if (!wasVis || Boolean(prev && prev[3] === false && empty) || scrolledOnly) {
            cs.transition = 'none';
            cs.transform = tr;
            cs.height = hs;
            if (isFn(requestAnimationFrame)) requestAnimationFrame(() => { if (caret.isConnected) cs.transition = ''; });
            else cs.transition = '';
          } else {
            if (!prev || prev[0] !== x || prev[1] !== y) cs.transform = tr;
            if (!prev || prev[2] !== h) cs.height = hs;
          }
          prevSt.set(caret, [x, y, h, empty]);
          setAttrIfChanged(caret, A_VIS, '1');
          setAttrIfChanged(ed, A_CARET, '1');
          const hold = (ms) => {
            blinkAt = Date.now();
            setAttrIfChanged(caret, A_TYP, '1');
            if (tm) clearTimeout(tm);
            tm = setTimeout(() => { tm = null; if (caret.isConnected) caret.removeAttribute(A_TYP); }, ms);
          };
          if (isTyping) hold(420);
          else if (prev && (prev[0] !== x || prev[1] !== y) && Date.now() - blinkAt >= 60) hold(220);
        }
      });
    }

    function sync(isTyping = false, refresh = false, checkScroll = true) {
      if (isDestroyed() || !isEnabled()) { teardown(); return; }
      applyMutations(measureSnapshot(refresh, checkScroll), isTyping);
    }

    function flush(typ, ref, scr) {
      const t = pTyp || typ, r = pRef || ref, s = pScr || scr;
      pTyp = pRef = pScr = false;
      sync(t, r, s);
    }

    function queue(isTyping = false, immediate = false, refresh = false, isScroll = false) {
      if (isDestroyed() || !isEnabled()) return;
      if (isTyping) pTyp = true;
      if (refresh) pRef = true;
      if (isScroll) pScr = true;
      if (raf && isFn(cancelAnimationFrame)) { cancelAnimationFrame(raf); raf = 0; }
      if (immediate) { flush(isTyping, refresh, isScroll); return; }
      if (isFn(requestAnimationFrame)) {
        raf = requestAnimationFrame(() => { raf = 0; flush(false, false, false); });
      }
    }

    return { teardown, bumpMetricsEpoch, invalidateSelection, measureSnapshot, applyMutations, sync, queue };
  }

  const api = { createSmoothCaretController, snapDevicePx };
  if (typeof module === 'object' && module.exports) module.exports = api;
  G.__agPrismSmoothCaret = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
