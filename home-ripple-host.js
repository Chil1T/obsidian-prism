// Obsidian Prism — Home & Conv Ripple Host
(function (root) {
  'use strict';
  const M = Math, { max, min, floor, round, ceil, abs, hypot, pow } = M, G = root || (typeof globalThis !== 'undefined' ? globalThis : window);
  if (!G) return;

  const INTRO_MS = 1600, IDLE_MS = 1200, RZ_MS = 120, RZ_WIN = 180;
  const HA = 'data-has-browser-hole', DHA = 'data-has-drawer-browser-hole', PMA = 'data-ag-cs-perf-mode', RZA = 'data-ag-cs-resizing';
  const CA = 'data-ag-cs-conv-ripple', HHA = 'data-ag-cs-conv-ripple-host', LA = 'data-conv-level', WB = 'data-ag-cs-win-blur';
  const PP_OPEN = 'data-ag-pp-open';
  const SB = 'aside,[data-side-panel-body]', GCLS = 'ag-cs-brand-glow', GTID = 'onboarding-brand-glow', RCLS = 'ag-cs-ripple-canvas';
  const CP = { subtle: [0.6, 0.4, 0.45, 0.55, 32, 340, 72, 196, 0.62, 0.28, 0.72], medium: [0.85, 0.75, 0.75, 0.82, 22, 270, 54, 215, 0.85, 0.34, 0.88], full: [1, 1, 1, 1, 16, 220, 42, 230, 1, 0.4, 1] };
  const isF = (v) => typeof v === 'function', isFin = Number.isFinite, ga = (e, k) => e?.getAttribute?.(k), T = (f) => { try { return f(); } catch {} }, gbr = (e) => e?.getBoundingClientRect?.();
  const ra = (e, k) => { if (e?.hasAttribute?.(k)) e.removeAttribute(k); }, hasH = (e) => ga(e, HA) === 'true' || ga(e, DHA) === 'true';
  const docOf = () => (typeof document !== 'undefined' ? document : null), winOf = () => (typeof window !== 'undefined' ? window : null);
  const nowOf = () => performance.now(), cl = (v, a, b) => max(a, min(b, v));
  const hasRaf = () => typeof requestAnimationFrame === 'function', cAF = (id) => { if (id && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); return 0; };
  const rAF = (fn) => (hasRaf() ? requestAnimationFrame(fn) : 0), cT = (id) => { if (id) clearTimeout(id); return 0; }, ST = (fn, ms) => setTimeout(fn, ms);
  const N = () => {}, NF = () => false, isST = () => typeof setTimeout === 'function';
  const NOOP_F = { mode: 'none', dispose: N, invalidate: N, draw: N, needsDraw: NF, busy: NF };
  const NOOP_G = { mode: 'none', resize: N, draw: N, clear: N, dispose: N };
  const NOOP_W = { active: NF, disturb: N, advance: N };
  const pAmb = (r) => G.__agPrismRipple?.parseAmbientScale ? G.__agPrismRipple.parseAmbientScale(r) : r == null || r === '' ? 1 : cl(+r > 1 ? +r / 100 : isFin(+r) ? +r : 1, 0, 1);

  function createHomeRippleController({ rippleCore: rc, isDestroyed: isD, isAllowed, isGlowAllowed, isConvAllowed, getConvLevel, isConvRunning, isDarkTheme, motionReduced: mRed, getMinFrameGapMs, getAmbientIntensity, getAccentTone, setAttrIfChanged: sa, onPointerPressMascot }) {
  let rm = null, cHost = null, timer = 0, rRaf = 0, recT = 0, recRaf = 0, rzT = 0, mAt = 0, tideAt = 0, ro = null, unWin = null, syncMFn = null, strChk = null, refLv = null;
  const html = () => docOf()?.documentElement || null, rw = () => G.__agPrismRippleWorker || null, gH = (k) => ga(html(), k);
  const fAll = () => !!isAllowed(), gAll = () => (isF(isGlowAllowed) ? !!isGlowAllowed() : fAll());
  const pMode = () => String(html()?.dataset?.agCsPerfMode || gH(PMA) || '').trim().toLowerCase();
  const setCS = (on, el) => { const h = html(); if (h) on ? sa(h, CA, '1') : ra(h, CA); if (cHost && cHost !== el) ra(cHost, HHA); cHost = on && el ? el : null; if (cHost) sa(cHost, HHA, '1'); };
  let hAt = -1, hV = false;
  const HS = `[${HA}="true"],[${DHA}="true"]`;
  const isCB = (f) => {
    const d = docOf(), h = html();
    if (mRed() || ga(h, 'data-ag-cs-motion') === 'off' || ga(h, 'data-ag-prism-wallpaper') === 'on' || hasH(h) || hasH(d?.body)) return true;
    const n = nowOf();
    if (!f && hAt >= 0 && abs(n - hAt) < 250) return hV;
    hAt = n;
    return (hV = !!(d?.querySelector?.(HS)));
  };
  const convLv = () => { if (isF(isConvAllowed) && !isConvAllowed()) return 'off'; if (isF(getConvLevel)) { const v = getConvLevel(); return v === true || v === 'true' || v === 'on' ? 'medium' : v === 'subtle' || v === 'medium' || v === 'full' ? v : 'off'; } return isF(isConvAllowed) && isConvAllowed() ? 'medium' : 'off'; };

  function resolveTarget() {
    const d = docOf();
    if (!d) return null;
    const home = d.querySelector('.agy-home');
    if (home) { const wf = fAll(), wg = gAll(); return wf || wg ? { mode: 'home', root: home, level: 'off', wf, wg } : null; }
    const lv = convLv();
    if (lv === 'off' || isCB(true) || !isF(d.querySelectorAll)) return null;
    const vs = Array.from(d.querySelectorAll('[data-testid="conversation-view"]')).filter((v) => !v.hidden && v.style?.display !== 'none' && v.style?.visibility !== 'hidden' && !v.closest?.('[data-testid="subagent-tab-conversation"]'));
    if (!vs.length) return null;
    const ok = (el) => !!(el && el !== d.documentElement && el !== d.body && ga(el, 'data-testid') !== 'conversation-view' && !hasH(el) && !el.closest?.(SB) && !el.querySelector?.(SB + ',[data-testid="sidebar-split"]>div:first-child') && vs.every((v) => !isF(el.contains) || el.contains(v)));
    const v0 = vs[0];
    for (const s of ['[data-main-content-body]', '.agy-sheet', '[data-split-panes]', '.agy-inset-shell']) {
      const c = v0.closest?.(s);
      if (ok(c)) return { mode: 'conv', root: c, level: lv, wf: true, wg: false };
    }
    let p = v0.parentElement;
    if (vs.length > 1) { while (p && p !== d.body && p !== d.documentElement && !vs.every((v) => p.contains?.(v))) p = p.parentElement; }
    else if (p && (ga(p, 'data-ag-cs-conv-seat') === '1' || p.hasAttribute?.('data-tiling-pane')) && ok(p.parentElement)) p = p.parentElement;
    return ok(p) ? { mode: 'conv', root: p, level: lv, wf: true, wg: false } : null;
  }

  const ambScale = () => pAmb(isF(getAmbientIntensity) ? getAmbientIntensity() : gH('data-ag-cs-ambient'));
  function specMode(dark) {
    const t = (isF(getAccentTone) ? getAccentTone() : null) || gH('data-ag-cs-accent') || 'follow';
    if (t === 'mono' || t === 'cobalt' || t === 'iris' || t === 'amber') return t;
    const pal = gH('data-ag-cs-palette') || 'obsidian';
    return pal === 'warm' || pal === 'claude' || (!dark && pal === 'obsidian' && gH('data-ag-cs-light-preset') === 'alabaster') ? 'warm' : 'default';
  }

  const defTok = (dark, sp) => ({ ink: dark ? [146, 148, 156] : [104, 114, 134], wave: dark ? [214, 218, 228] : sp === 'mono' ? [51, 65, 85] : sp === 'iris' ? [124, 58, 237] : sp === 'amber' ? [217, 119, 6] : sp === 'warm' ? [194, 89, 52] : [37, 99, 235], dark, fontFamily: 'ui-monospace, Consolas, monospace' });
  function sampleTok(el) {
    const cs = el && typeof getComputedStyle === 'function' ? getComputedStyle(el) : null, dk = isDarkTheme(), t = defTok(dk, specMode(dk));
    if (!cs) return t;
    t.ink = rc.parseCssColorToRgb(cs.getPropertyValue('--ag-cs-ripple-ink')) || t.ink;
    t.wave = rc.parseCssColorToRgb(cs.getPropertyValue('--ag-cs-ripple-wave')) || t.wave;
    t.fontFamily = cs.getPropertyValue('--font-mono').trim() || t.fontFamily;
    return t;
  }
  const aB = { x: 0, y: 0, radius: 230, strength: 0, active: false };
  function buildPal(tok, as, now, aRaw, sp, mode, lv) {
    const t = tok || defTok(isDarkTheme(), sp), amb = cl(isFin(aRaw) ? aRaw : 1, 0, 1);
    const c = mode === 'conv', cp = c ? CP[lv] || CP.medium : null, fd = as?.f ?? 1, on = !!(as?.active && fd > 0.005 && !mRed() && amb > 0.001);
    aB.x = on ? as.x : 0; aB.y = on ? as.y : 0; aB.radius = cp ? cp[7] : 230; aB.strength = on ? amb * (cp ? cp[3] : 1) * fd : 0; aB.active = on;
    return {
      ink: t.ink, wave: t.wave, dark: t.dark, fontFamily: t.fontFamily, conv: c,
      alphaScale: cp ? (amb <= 0.001 ? 0 : cp[0]) : 1, nebulaLiftScale: cp ? cp[1] : 1, auraLiftScale: cp ? cp[2] : 1,
      prismStrength: amb * (sp === 'mono' ? 0.45 : 1) * (cp ? cp[8] : 1), ambientIntensity: amb, spectrum: sp, nebula: amb <= 0.001 ? false : undefined,
      aura: aB, auraPhase: (now || 0) * (cp ? 0.00045 + 0.00015 * cp[3] : 0.0006),
    };
  }
  const bindR = (el, m, add) => { const fn = add ? 'addEventListener' : 'removeEventListener', o = add ? { passive: true } : undefined; el[fn]('pointerdown', m.onPress, o); m.onMove && el[fn]('pointermove', m.onMove, o); m.onLeave && el[fn]('pointerleave', m.onLeave, o); };
  const stopT = (m) => { timer = cT(timer); m.rafId = cAF(m.rafId); rRaf = cAF(rRaf); };
  const clrRec = () => { recT = cT(recT); recRaf = cAF(recRaf); };
  const detR = (m) => { if (m?.root) { bindR(m.root, m, false); m.root = null; } };
  const stopM = (m) => { stopT(m); clrRec(); rzT = cT(rzT); ro?.disconnect(); };

  function parkRipple() {
    hAt = -1; setCS(false, null);
    if (!rm) return;
    stopM(rm); detR(rm); rm.host.remove(); rm.reclaim?.(); rm.sleeping = rm.parked = true;
  }
  function unmountRipple() {
    hAt = -1; setCS(false, null);
    if (!rm) return;
    const m = rm; stopM(m); unWin?.(); detR(m);
    m.field?.dispose?.(); m.glow?.dispose?.(); m.host.remove();
    rm = ro = unWin = syncMFn = strChk = refLv = null;
  }
  function isIgnC(t, press) {
    if (!t?.closest) return false;
    if (t.closest(SB + ',.agy-overlay,.aux-drawer-popup')) return true;
    const role = ga(t.closest('[role]'), 'role') || '';
    if (role === 'dialog') return true;
    return !!(press && (/^(?:button|textbox|menu|listbox|menuitem|tab|switch)$/.test(role) || t.closest('button,a,input,textarea,select,label,summary,[contenteditable="true"],[data-testid="agent-input-box"],.surface-composer-card,.monaco-editor')));
  }
  function mountR(m, mode, tr) {
    m.root = tr; m.parked = false; mAt = nowOf();
    setCS(mode === 'conv', tr); tr.insertBefore(m.host, tr.firstChild); bindR(tr, m, true); ro?.observe(tr);
  }

  function syncRipple() {
    if (!rc) return;
    if (!fAll() && !gAll() && convLv() === 'off') return unmountRipple();
    const tgt = resolveTarget();
    if (!tgt) { setCS(false, null); if (rm && !rm.parked) parkRipple(); return; }
    const mode = tgt.mode, tr = tgt.root, wf = tgt.wf, wg = tgt.wg, lv = tgt.level || 'off';
    if (rm) {
      const mc = rm.mode !== mode, lc = rm.convLevel !== lv, sc = rm._f !== wf || rm._g !== wg;
      if (rm.parked || rm.root !== tr || !rm.host.isConnected || mc || sc) {
        ro?.disconnect(); detR(rm);
        rm.convLevel = lv; sa(rm.host, LA, lv); rm._f = wf; rm._g = wg;
        if (mc || sc) { rm.mode = mode; sa(rm.host, 'data-ripple-mode', mode); syncMFn?.(mode, wf, wg); }
        mountR(rm, mode, tr); rm.reattach?.();
      } else {
        setCS(mode === 'conv', tr);
        if (lc) { rm.convLevel = lv; sa(rm.host, LA, lv); refLv?.(); } else if (mode === 'conv') strChk?.();
      }
      return;
    }

    const d = docOf(), mkEl = (tag, cls) => { const el = d.createElement(tag); el.className = cls; sa(el, 'aria-hidden', 'true'); return el; };
    const host = mkEl('div', 'ag-cs-ripple-host');
    sa(host, 'data-ripple-mode', mode); sa(host, LA, lv);
    let cv = null, gc = null, fl = NOOP_F, gl = null, wv = NOOP_W, sw0 = -1, sh0 = -1, slp = false, rid = 0;
    const as = { x: 0, y: 0, active: false };
    mAt = nowOf(); tideAt = 0;
    let lx = null, ly = null, lsa = 0, lcma = 0, carry = 0, tok = null, cRect = null, cRectAt = 0;
    let prev = mAt, lastDraw = 0, lastTs = 0, wanted = false, drawn = false, f1 = true, gZero = false;
    let wb = false, pw = 0, ph = 0, shrunk = false, fLost = false, gLost = false, recN = 0, aT = null, wSlp = 0, aWk = 0;
    let rzPend = false, lastLayAt = -1, lastPM = pMode(), wFail = false, fWFail = false;

    const st = { mode, convLevel: lv, _f: wf, _g: wg, root: tr, host, glowCanvas: null, canvas: null, width: -1, height: -1, dpr: 0, sleeping: false, parked: false, aura: { reach: 0.47, strength: 1.0 }, waves: wv, glow: null, field: fl, rafId: 0 };
    const au = st.aura, setCv = (v) => (cv = st.canvas = v), setGc = (v) => (gc = st.glowCanvas = v), setF = (v) => (fl = st.field = v), setG = (v) => (gl = st.glow = v), setW = (v) => (wv = st.waves = v);
    const setSlp = (v) => (slp = st.sleeping = !!v), setRid = (v) => (rid = st.rafId = v), setDim = (w, h) => { sw0 = st.width = w; sh0 = st.height = h; };
    const { cellWidth: CW, cellHeight: CH } = rc.RIPPLE;
    const dead = () => isD() || st.parked, hasDim = () => sw0 > 0 && sh0 > 0, isPerf = (m = pMode()) => m === 'performance' || m === 'eco', isC = () => st.mode === 'conv';
    const isAB = () => gH(WB) === '1', isPp = () => gH(PP_OPEN) === '1' && (!isC() || isPerf()), isRz = () => gH(RZA) === '1';
    const isStr = () => isC() && isF(isConvRunning) && !!isConvRunning(true), hP = () => !!(d.hidden || wb || isAB() || isPp() || (isC() && isCB()));
    const hasSz = (c) => !!(c && c.width > 0 && c.height > 0), mOf = (i) => i?.mode, isW = (i) => mOf(i) === 'worker-webgl2', isNo = (i) => mOf(i) === 'none';
    const hasBuf = (c, i) => !!(c && (isW(i) ? i.getBufferSize?.().width > 0 && i.getBufferSize?.().height > 0 : hasSz(c)));
    const hasFSz = () => hasBuf(cv, fl), hasGSz = () => hasBuf(gc, gl), hasAnySz = () => hasFSz() || hasGSz();
    const invAll = () => { fl?.invalidate?.(); gl?.invalidate?.(); }, setV = (el, on) => { if (el?.style) el.style.display = on ? '' : 'none'; };
    const isLost = (c, i) => !!(i?.isContextLost?.() || (mOf(i) !== '2d' && !isW(i) && c?.getContext?.('webgl2')?.isContextLost?.()));
    const hasG = isF(rc.mountBrandHorizonGlow), rawDpr = () => winOf()?.devicePixelRatio || 1, gridOf = (w = sw0, h = sh0) => [ceil(w / CW), ceil(h / CH)];
    const rDpr = () => { const r = rawDpr(), m = pMode(), b = rw()?.resolveRippleDpr?.(r, d) ?? min(r, isPerf(m) ? 1 : m === 'balanced' ? 1.5 : 2); return isC() ? min(b, 1.25) : b; };
    const gDpr = () => { const r = rawDpr(), m = pMode(); return rw()?.resolveGlowDpr?.(r, d, 0.7) ?? (isPerf(m) ? 0.55 : m === 'balanced' ? 0.7 : m === 'quality' ? min(r, 2) : 0.6); };
    const pGap = () => { const g = rw()?.getPerfMinGapMs?.(d); return g > 0 ? g * 0.88 : isPerf() ? 14.5 : 0; };

    function swapCv(o, cls, tid, bf) {
      const n = mkEl('canvas', cls);
      if (tid) sa(n, 'data-testid', tid);
      o?.replaceWith ? o.replaceWith(n) : o?.parentNode?.replaceChild ? o.parentNode.replaceChild(n, o) : (o?.remove?.(), bf && host.insertBefore ? host.insertBefore(n, cv) : host.appendChild(n));
      return n;
    }
    const swG = () => setGc(swapCv(gc, GCLS, GTID, 1)), swF = () => setCv(swapCv(cv, RCLS));
    const lostG = () => onLost(0), lostF = () => onLost(1);
    const setCvSz = (cols, rows, skip) => { if (!skip && !isW(fl)) { cv.width = pw; cv.height = ph; } cv.style.width = `${cols * CW}px`; cv.style.height = `${rows * CH}px`; };
    const resyncG = () => { if (hasDim()) { syncG(sw0, sh0); wake(true); } };

    function onLost(isF0) {
      if (dead()) return;
      if (isF0) { fLost = true; setV(cv, 0); } else { gLost = true; setV(gc, 0); }
      if (recN >= 3 || recT || recRaf) return;
      const run = () => { recT = recRaf = 0; recoverLost(); }, tid = isST() ? ST(run, 32) : 0;
      if (tid) recT = tid; else if (hasRaf()) recRaf = rAF(run); else run();
    }

    function mountGlow(p2d, sw) {
      if (!gc) return;
      if (sw) { T(() => gl?.dispose?.(true)); swG(); }
      const pf = isPerf();
      if (pf && p2d) { setG(NOOP_G); gLost = false; setV(gc, 0); return; }
      const wm = rw();
      let g = hasG && wm?.mountManagedGlow ? wm.mountManagedGlow({
        getCanvas: () => gc, swapCanvas: swG, rippleCore: rc, doc: d, prefer2D: !!p2d, allowWorker: !wFail, onContextLost: lostG,
        onFallbackDone: () => { wFail = true; if (!dead() && gc) { T(() => gl?.dispose?.()); mountGlow(0, 1); resyncG(); } },
        onUpgradeReady: () => { if (!dead() && !wFail && !isC() && mOf(gl) === 'webgl2') { mountGlow(0, 1); resyncG(); } },
      }) : null;
      if (!g) {
        const mk = (u) => (hasG ? rc.mountBrandHorizonGlow(gc, { prefer2D: !!u, width: 0, height: 0, onContextLost: lostG }) : NOOP_G);
        g = mk(p2d);
        if (hasG && isNo(g) && !p2d && !pf) { T(() => g.dispose?.(true)); swG(); g = mk(1); }
      }
      setG(g); gLost = false; setV(gc, !hasG || !isNo(g));
    }

    const remountF = () => { setF(mountField(...gridOf(), 0, 1)); tok = sampleTok(cv); cRect = null; updateCalm(); f1 = true; wake(true); return fl; };
    function mountField(cols, rows, p2d, sw) {
      if (sw) swF();
      const pf = isPerf();
      if (pf && p2d) { fLost = false; setV(cv, 0); return NOOP_F; }
      const wm = rw();
      let f = null;
      if (cols > 0 && rows > 0 && wm?.mountManagedField && !p2d && !fWFail) {
        setCvSz(cols, rows, 1);
        f = wm.mountManagedField({
          getCanvas: () => cv, swapCanvas: () => { swF(); setCvSz(cols, rows, 0); return cv; },
          cols, rows, dpr: st.dpr || rDpr(), waves: wv, rippleCore: rc, doc: d, prefer2D: false, allowWorker: !fWFail, onContextLost: lostF,
          onFallbackDone: () => { fWFail = true; if (dead()) return null; T(() => fl?.dispose?.()); return remountF(); },
          onUpgradeReady: () => { if (!dead() && !fWFail && mOf(fl) === 'webgl2' && hasDim()) { T(() => fl.dispose?.()); remountF(); } },
        });
        if (f && !isW(f)) setCvSz(cols, rows, 0);
      } else {
        setCvSz(cols, rows, 0);
        const mk = (u) => rc.createGlyphField(cv, cols, rows, wv, { prefer2D: !!u, onContextLost: lostF });
        f = mk(p2d);
        if (cols > 0 && rows > 0 && isNo(f) && !p2d && !pf) { T(() => f.dispose?.(true)); swF(); setCvSz(cols, rows, 0); f = mk(1); }
      }
      fLost = false; setV(cv, cols <= 0 || rows <= 0 || !isNo(f));
      return f;
    }

    function recoverLost() {
      if (dead() || (!fLost && !gLost)) return;
      if (d.hidden) return reclaim();
      const nf = fLost, ng = gLost; fLost = gLost = false;
      const p2d = ++recN >= 2;
      if (nf && cv && hasDim()) { T(() => fl?.dispose?.(true)); setF(mountField(...gridOf(), p2d, 1)); tok = sampleTok(cv); cRect = null; updateCalm(); }
      if (ng && gc && !isC()) { mountGlow(p2d, 1); if (hasDim() && !isNo(gl)) gl?.resize?.(sw0, sh0, gDpr()); }
      f1 = true; drawn = false; invAll(); wake(true);
    }

    syncMFn = (nm, wf0, wg0) => {
      const needF = nm === 'conv' || !!wf0, needG = nm === 'home' && !!wg0;
      if (!needF) { fLost = false; T(() => fl?.dispose?.(true)); setF(NOOP_F); setW(NOOP_W); cv?.remove?.(); setCv(null); cRect = null; }
      else if (!cv) { host.appendChild(setCv(mkEl('canvas', RCLS))); setDim(-1, sh0); }
      if (!needG) { gLost = false; T(() => gl?.dispose?.()); setG(null); gc?.remove?.(); setGc(null); tideAt = 0; }
      else if (!gc) { const g0 = mkEl('canvas', GCLS); sa(g0, 'data-testid', GTID); cv && host.insertBefore ? host.insertBefore(g0, cv) : host.appendChild(g0); setGc(g0); mountGlow(0, 0); }
      gZero = false;
    };
    syncMFn(mode, wf, wg);

    function syncG(w, h) {
      if (!gc || w <= 0 || h <= 0) return;
      if (gLost || isLost(gc, gl)) mountGlow(recN >= 2, 1);
      if (!gc || (hasG && isNo(gl))) return;
      const gd = gDpr();
      gl?.resize?.(w, h, gd);
      if (!isW(gl) && (!gc.width || !gc.height)) { gc.width = max(1, round(w * gd)); gc.height = max(1, round(h * gd)); }
    }

    const reclaim = () => {
      rzT = cT(rzT); rzPend = false; enterIdleSleep();
      if (shrunk && !hasFSz() && !hasGSz()) return;
      T(() => gl?.releaseBackingStore?.()); T(() => fl?.releaseBackingStore?.());
      if (cv && !isW(fl)) cv.width = cv.height = 0;
      if (gc && !isW(gl)) gc.width = gc.height = 0;
      shrunk = f1 = true; drawn = false;
    };

    function updateCalm() {
      const cur = st.root;
      if (!cur || !cv || !fl?.setCalmZones) return;
      const gr = !isC() ? cur.querySelector('[data-testid="home-greeting"]') : null;
      if (!gr) return fl.setCalmZones([]);
      const c = gbr(cv); cRect = c; cRectAt = nowOf();
      const g = gbr(gr);
      if (c.width && g.width) fl.setCalmZones([{ x: g.left - c.left - 28, y: g.top - c.top - 14, w: g.width + 56, h: g.height + 28 }]);
    }

    function layout() {
      const cur = st.root;
      if (!cur) return;
      if (d.hidden) return reclaim();
      const w = max(0, +cur.clientWidth || 0), h = max(0, +cur.clientHeight || 0);
      const dpr = rDpr(), pm = pMode(), lostF = !!cv && (fLost || isLost(cv, fl)), pChg = pm !== lastPM;
      lastPM = pm;
      if (w === sw0 && h === sh0 && dpr === st.dpr && !lostF && !pChg) {
        cRect = null;
        if (shrunk || gLost || isLost(gc, gl) || (cv && pw > 0 && ph > 0 && !hasFSz()) || (gc && !hasGSz())) {
          shrunk = drawn = false; f1 = true;
          if (cv) { if (isW(fl)) fl.resize(...gridOf(w, h), wv, dpr); else { cv.width = pw; cv.height = ph; } }
          syncG(w, h); invAll();
        }
        return;
      }
      const [cols, rows] = gridOf(w, h), pf = isPerf(pm), was2d = mOf(fl) === '2d', drop2d = pChg && pf && was2d;
      const inPlace = !!cv && !lostF && !drop2d && cols > 0 && rows > 0 && !isNo(fl) && isF(fl?.resize);
      setDim(w, h); st.dpr = dpr; pw = cv ? round(cols * CW * dpr) : 0; ph = cv ? round(rows * CH * dpr) : 0;
      shrunk = drawn = false; f1 = true;
      if (pChg && gc && ((pf && mOf(gl) === '2d') || (!pf && isNo(gl)))) mountGlow(0, 1);
      syncG(w, h);
      if (cv) {
        setW(rc.createWaveField(cols, rows));
        if (inPlace) { setCvSz(cols, rows); fl.resize(cols, rows, wv, dpr); }
        else { fl.dispose(true); setF(mountField(cols, rows, was2d && !lostF && !pf, lostF || isW(fl) || drop2d)); }
      }
      tok = sampleTok(cv || gc || host); cRect = null; if (cv) updateCalm();
    }

    const SL = 'data-ripple-sleep';
    function enterIdleSleep() {
      if (slp && !rid && !timer && !wanted && ga(host, SL) === '1') return;
      stopT(st); rid = 0; wanted = false; wSlp = 1; setSlp(1); gl?.setPaused?.(true); sa(host, SL, '1');
    }

    const noRen = () => (!cv || isNo(fl)) && (!gc || isNo(gl));
    function wake(imm = false) {
      timer = cT(timer);
      if (dead()) return;
      if (d.hidden) return reclaim();
      if (isC() && isCB()) return parkRipple();
      if (shrunk) layout();
      if (noRen()) return enterIdleSleep();
      if (hP() || isStr()) { if ((!drawn || f1) && hasAnySz()) drawFrame(nowOf()); return enterIdleSleep(); }
      if (slp) { setSlp(0); ra(host, SL); }
      if (imm) { setRid(cAF(rid)); wanted = false; f1 = true; return drawFrame(nowOf()); }
      if (wanted) return;
      wanted = true; setRid(rAF(drawFrame));
    }
    strChk = () => { if (isStr()) { as.active = false; if (!slp) enterIdleSleep(); } };

    function drawFrame(now) {
      setRid(0); wanted = false;
      if (dead() || (rm !== st && rm !== null)) return;
      if (d.hidden) return reclaim();
      if (isC() && isCB()) return parkRipple();
      const str = isStr();
      if (str) as.active = false;
      const still = mRed() || str, vsDt = lastTs > 0 && now > lastTs ? now - lastTs : now - lastDraw;
      lastTs = now;
      const rawGap = max(pGap(), +(getMinFrameGapMs?.() || 0) || 0);
      const minGap = (!isC() || st.convLevel === 'full') && (wv?.active?.() || (as.active && lsa > 0 && now - lsa < 650) || (tideAt > 0 && now - tideAt < 480)) ? (isC() ? max(16, rawGap) : rawGap) : max(33, rawGap);
      if (!still && drawn && !f1 && minGap > 0 && lastDraw > 0 && now - lastDraw < minGap && !hP()) {
        const rem = minGap - (now - lastDraw);
        if (isST() && rem > max(8, vsDt + 2)) { timer = cT(timer); timer = ST(() => { timer = 0; wake(); }, max(4, ceil(rem))); } else wake();
        return;
      }
      lastDraw = now;
      const dt = still ? 0 : wSlp ? min(16, max(0, now - prev)) : cl(now - prev, 0, 50);
      aT = aT === null ? now : aT + dt; wSlp = 0;
      if (cv) wv.advance(still ? 0 : cl(dt / 1000, 0, 0.05), 12);
      prev = now;
      const te = !isC() && tideAt > 0 ? now - tideAt : -1, inT = !still && te >= 0 && te < 480;
      if (tideAt > 0 && !inT) { tideAt = 0; au.reach = 0.47; au.strength = 1.0; f1 = true; }
      else if (inT) { const e = 1 - pow(1 - cl(te / 480, 0, 1), 2.2); au.reach = +(0.2 + 0.27 * e).toFixed(4); au.strength = +(0.32 + 0.68 * e).toFixed(4); }

      const amb = ambScale();
      if (amb <= 0.001 && as.active) as.active = false;
      let aSet = 0;
      if (!str && amb > 0.001 && as.active && lsa > 0) {
        const age = max(0, now - lsa);
        if (age >= IDLE_MS) { as.active = false; as.f = 0; aSet = 1; }
        else { const u = age <= 750 ? 1 : (IDLE_MS - age) / 450; as.f = u * u * (3 - 2 * u) * (aWk && now - aWk < 180 ? cl((now - aWk) / 180, 0.12, 1) : 1); }
      }
      const aRec = !str && amb > 0.001 && as.active && lsa > 0 && now - lsa < IDLE_MS;
      const inI = !isC() && !still && amb > 0.001 && now - mAt < INTRO_MS;
      const busy = !str && !!fl?.busy?.();
      const need = f1 || !drawn || aSet || (!!gc && amb <= 0.001 && !gZero) || inT || inI || aRec || (!str && !!fl?.needsDraw(aT, still));

      if (hasAnySz() && need) {
        f1 = false;
        if (!tok) tok = sampleTok(cv || gc || host);
        const sp = specMode(tok.dark), pal = buildPal(tok, as, aT, amb, sp, st.mode, st.convLevel);
        if (hasGSz()) {
          if (amb <= 0.001) { if (!gZero) { gl?.clear?.(); gZero = true; } }
          else { gZero = false; gl?.draw?.(aT, { dark: pal.dark, still, strength: inT ? au.strength : 1, reach: au.reach, ambientIntensity: amb, spectrum: sp }); }
        }
        if (cv && hasFSz()) fl.draw(aT, pal, still);
        drawn = true;
      }
      if (isD() || hP() || still || noRen() || !(inT || busy || inI || aRec)) enterIdleSleep(); else wake();
    }

    st.wake = wake; st.reclaim = reclaim;
    refLv = () => { f1 = true; invAll(); d.hidden ? reclaim() : wake(); };
    st.reattach = () => {
      timer = cT(timer); clrRec(); rzT = cT(rzT); rzPend = false; fLost = gLost = false; recN = 0; prev = nowOf(); wSlp = 1; aWk = 0; wanted = false; f1 = true; as.active = false; lx = ly = null; carry = 0;
      const runRe = () => { if (dead()) return; const pw0 = sw0, ph0 = sh0; layout(); if (cv && (sw0 !== pw0 || sh0 !== ph0 || isC())) updateCalm(); invAll(); wake(true); };
      if (!shrunk && hasDim() && !d.hidden && hasRaf()) { setRid(cAF(rid)); setRid(rAF(() => { setRid(0); runRe(); })); } else runRe();
    };

    const invNG = () => { if (mOf(fl) !== 'webgl2' && !isW(fl)) fl?.invalidate?.(); };
    st.onMove = (ev) => {
      if (!cv || mRed()) return;
      if (!isAB()) wb = false;
      if (hP() || isStr()) return;
      const c = isC(), cp = c ? CP[st.convLevel] || CP.medium : null, nr = nowOf();
      if (c) { if ((lcma > 0 && nr - lcma < cp[4]) || isIgnC(ev.target, false)) return; lcma = nr; }
      if (!cRect || nr - cRectAt > 1500) { cRect = gbr(cv); cRectAt = nr; }
      const x = ev.clientX - cRect.left, y = ev.clientY - cRect.top;
      if (x < 0 || y < 0 || x > cRect.width || y > cRect.height) { lx = ly = null; carry = 0; if (as.active) { as.active = false; f1 = true; invNG(); wake(); } return; }
      const now = nowOf();
      if (lx !== null && ly !== null) {
        const dist = hypot(x - lx, y - ly), spd = dist / max(0.004, (now - lsa) / 1000), ms = cp ? cp[5] : 220, cs = cp ? cp[6] : 42;
        if (spd >= ms) { carry += dist; if (carry >= cs) { carry = min(20, carry - cs); wv.skimmer?.(floor(x / CW), floor(y / CH), cl((spd - ms) / 1800, 0.05, 1) * (cp ? cp[3] : 1)); } }
        else carry *= 0.85;
      }
      lx = x; ly = y; lsa = now;
      if (ambScale() > 0.001) { if (!as.active || slp) aWk = now; as.x = x; as.y = y; as.active = true; if (slp) prev = now; invNG(); wake(); }
      else if (wv.active()) { if (slp) prev = now; fl.invalidate(); wake(); }
    };
    st.onLeave = () => { lx = ly = null; carry = 0; if (as.active) { as.active = false; f1 = true; invNG(); wake(); } };
    st.onPress = (ev) => {
      if (ev.button !== 0 || mRed() || ambScale() <= 0.001 || hP() || isStr()) return;
      const c = isC();
      if (c && isIgnC(ev.target, true)) return;
      if (!cv) { if (!c) onPointerPressMascot?.(ev.clientX); return; }
      const cp = c ? CP[st.convLevel] || CP.medium : null, r = gbr(cv);
      cRect = r; cRectAt = nowOf();
      if (slp) prev = cRectAt;
      wv.disturb(floor((ev.clientX - r.left) / CW), floor((ev.clientY - r.top) / CH), cp && st.convLevel !== 'full' ? { amplitudeScale: cp[3], radiusScale: 0.72 + 0.28 * cp[3], duration: cp[9], loadWeight: cp[10] } : undefined);
      fl.invalidate(); wake();
      if (!c) onPointerPressMascot?.(ev.clientX);
    };

    const onVis = () => {
      if (d.hidden) return reclaim();
      if (isC() || convLv() !== 'off') { if (isCB(true)) { if (!st.parked) parkRipple(); return; } if (st.parked) return syncRipple(); }
      if (st.parked) return;
      const s = shrunk, pChg = pMode() !== lastPM;
      if (s || pChg || !hasAnySz()) layout();
      const ok = (s || pChg) && hasAnySz();
      if (!hP() && !isStr()) { prev = nowOf(); f1 = true; ok ? drawFrame(prev) : wake(); }
      else if (ok && !drawn) drawFrame(nowOf());
      else enterIdleSleep();
    };
    const onBlur = () => { wb = true; enterIdleSleep(); }, onFocus = () => { wb = false; onVis(); };
    const wRef = winOf(), wEv = (add) => { const m = add ? 'addEventListener' : 'removeEventListener'; d[m]('visibilitychange', onVis); wRef?.[m]?.('blur', onBlur); wRef?.[m]?.('focus', onFocus); };
    wEv(1);
    const mos = [], unsubs = [], hA = [WB, PP_OPEN, PMA, 'data-ag-prism-wallpaper', HA, DHA, 'data-ag-cs-motion'];
    const onAttr = () => { if (!isAB()) wb = false; onVis(); };
    const dBus = wRef && (wRef.__agDomBus || wRef.__agPrismDomBus);
    if (dBus?.subscribe) T(() => unsubs.push(dBus.subscribe('home-ripple-root', onAttr, { priority: 'high', observeBody: true, observeOptions: { childList: false, subtree: false, attributes: true, attributeFilter: hA } })));
    if (!unsubs.length && typeof MutationObserver === 'function') for (const [el, af] of [[html(), hA], [d.body, [HA, DHA]]]) if (el) T(() => { const mo = new MutationObserver(onAttr); mo.observe(el, { attributes: true, attributeFilter: af }); mos.push(mo); });
    unWin = () => { rRaf = cAF(rRaf); rzT = cT(rzT); rzPend = false; wEv(0); unsubs.forEach((u) => u?.()); mos.forEach((mo) => mo.disconnect()); };

    if (typeof ResizeObserver === 'function') {
      const applyLay = (wakeIdle) => { const ow = sw0, oh = sh0; layout(); lastLayAt = nowOf(); if (sw0 !== ow || sh0 !== oh || !drawn) wake(true); else if (wakeIdle) wake(); };
      const flushLay = () => { rzT = 0; if (dead()) return; if (d.hidden) { rzPend = false; return reclaim(); } if (isRz()) { rzT = ST(flushLay, RZ_MS); return; } if (!rzPend) return; rzPend = false; applyLay(0); };
      const doLay = () => { rRaf = 0; if (!dead()) d.hidden ? reclaim() : applyLay(1); };
      ro = new ResizeObserver(() => {
        if (d.hidden) { rzT = cT(rzT); rzPend = false; return reclaim(); }
        const now = nowOf(), live = !shrunk && hasDim() && (!cv || (hasFSz() && !fLost && !isLost(cv, st.field))) && (!gc || (hasGSz() && !gLost && !isLost(gc, gl)));
        if (live && (isRz() || rzPend || (lastLayAt >= 0 && now > lastLayAt && now - lastLayAt <= RZ_WIN))) { rRaf = cAF(rRaf); rzPend = true; rzT = cT(rzT); rzT = ST(flushLay, RZ_MS); return; }
        !hasRaf() ? doLay() : !rRaf && (rRaf = rAF(doLay));
      });
    }
    mountR(st, mode, tr); rm = st; layout();
    st.refreshTheme = () => { if (pMode() !== lastPM) layout(); tok = sampleTok(cv || gc || host); f1 = true; invAll(); d.hidden ? reclaim() : wake(); };
    wake();
  }

  function refreshTheme() { rm?.refreshTheme?.(); }
  function triggerLiftoffBurst(cr) {
    if (!rm || rm.mode !== 'home' || !isF(rm.field?.triggerLiftoffBurst)) return;
    const r = gbr(rm.canvas), ok = cr && r?.width > 0 && r?.height > 0;
    const nx = ok ? cl((cr.left + cr.width * 0.5 - r.left) / r.width, 0.05, 0.95) : 0.5, ny = ok ? cl((cr.top + cr.height * 0.5 - r.top) / r.height, 0.05, 0.95) : 0.62;
    T(() => { rm.field.triggerLiftoffBurst(nx, ny); rm.field.invalidate?.(); rm.wake?.(); });
  }
  function triggerTideSwell() {
    if (!rm) syncRipple();
    if (!rm || rm.mode !== 'home') return;
    tideAt = nowOf(); rm.aura.reach = 0.2; rm.aura.strength = 0.32;
    T(() => { rm.field?.triggerTideSwell?.(); rm.field?.invalidate?.(); rm.wake?.(); });
  }
  return { sync: syncRipple, park: parkRipple, unmount: unmountRipple, refreshTheme, triggerLiftoffBurst, triggerTideSwell, getMount: () => rm };
  }
  const api = { createHomeRippleController };
  if (typeof module === 'object' && module.exports) module.exports = api;
  G.__agPrismHomeRippleHost = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
