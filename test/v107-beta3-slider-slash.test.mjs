import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');

globalThis.__agCodexEffortSliderDisableAutoBoot = true;
const ctxMenuMod = require(path.join(ROOT, 'context-menu-btw.js'));
const upstreamLib = require(path.join(ROOT, 'vendor', 'effort-slider', 'upstream-client.js'));
const sliderCoexist = require(path.join(ROOT, 'vendor', 'effort-slider', 'slider-coexist.js'));
const mgcMod = require(path.join(ROOT, 'model-glyph-crystal.js'));
const cdp = require(path.join(ROOT, 'cdp.js'));

// ── Lightweight Deterministic DOM Harness ───────────────────────────────────
function matchesSingle(el, rawSel) {
  if (!el || el.nodeType !== 1) return false;
  const sel = rawSel.trim();
  if (!sel) return false;
  if (sel.includes(' ')) {
    const parts = sel.split(/\s+/).filter(Boolean);
    if (!matchesSingle(el, parts[parts.length - 1])) return false;
    let cur = el.parentElement;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (cur && !matchesSingle(cur, parts[i])) cur = cur.parentElement;
      if (!cur) return false;
      cur = cur.parentElement;
    }
    return true;
  }
  let rem = sel;
  for (const nm of rem.matchAll(/:not\(\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]\)/g)) {
    if (nm[2] !== undefined) { if (el.getAttribute(nm[1]) === nm[2]) return false; }
    else if (el.hasAttribute(nm[1])) return false;
  }
  rem = rem.replace(/:not\(\[[a-zA-Z0-9_-]+(?:="[^"]*")?\]\)/g, '');
  const tagM = rem.match(/^[a-zA-Z0-9-]+/);
  if (tagM) {
    if (el.tagName.toLowerCase() !== tagM[0].toLowerCase()) return false;
    rem = rem.slice(tagM[0].length);
  }
  const idM = rem.match(/#([a-zA-Z0-9_\\.-]+)/);
  if (idM) {
    if (el.id !== idM[1].replace(/\\/g, '')) return false;
    rem = rem.replace(idM[0], '');
  }
  for (const cm of rem.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
    if (!el.classList.contains(cm[1])) return false;
  }
  rem = rem.replace(/\.[a-zA-Z0-9_-]+/g, '');
  for (const am of rem.matchAll(/\[([a-zA-Z0-9_-]+)(?:(\^?=)"([^"]*)")?\]/g)) {
    if (!el.hasAttribute(am[1])) return false;
    if (am[3] !== undefined) {
      const val = el.getAttribute(am[1]) || '';
      if (am[2] === '^=') { if (!val.startsWith(am[3])) return false; }
      else if (val !== am[3]) return false;
    }
  }
  return true;
}

function matchesAny(el, selList) {
  for (const part of String(selList || '').split(',')) {
    if (part.trim() && matchesSingle(el, part.trim())) return true;
  }
  return false;
}

function createDomEnv(opts = {}) {
  let fakeNow = opts.startNow || 1000;
  let rafSeq = 0;
  const rafs = new Map();
  const winListeners = new Map();
  const docListeners = new Map();
  const winDispatched = [];
  const observers = [];

  function makeEl(tag, init = {}) {
    const attrs = new Map();
    const classes = new Set();
    const styleProps = new Map();
    const listeners = { capture: new Map(), bubble: new Map() };
    const children = [];
    let _text = init.text || '';
    let _rect = { left: 0, top: 0, width: 220, height: 28, right: 220, bottom: 28, ...(init.rect || {}) };
    const el = {
      nodeType: 1,
      tagName: String(tag || 'div').toUpperCase(),
      parentElement: null,
      parentNode: null,
      children,
      childNodes: children,
      isConnected: false,
      disabled: Boolean(init.disabled),
      value: init.value || '',
      _rectReads: 0,
      _offsetWidthReads: 0,
      _qsCalls: 0,
      _qsaCalls: 0,
      _styleSets: [],
      _dispatched: [],
      get _rect() { return _rect; },
      set _rect(v) { _rect = { ..._rect, ...v }; },
      get offsetWidth() { el._offsetWidthReads += 1; return _rect.width; },
      get clientWidth() { return _rect.width; },
      get offsetLeft() { return _rect.left; },
      style: {
        display: '',
        width: '',
        left: '',
        transform: '',
        opacity: '',
        color: '',
        background: '',
        fontWeight: '',
        animationDuration: '',
        animationDelay: '',
        setProperty(k, v) {
          styleProps.set(k, String(v));
          el._styleSets.push({ k, v: String(v) });
          this[k] = String(v);
        },
        getPropertyValue(k) { return styleProps.get(k) || ''; },
        removeProperty(k) { styleProps.delete(k); delete this[k]; },
      },
      classList: {
        add(...cs) { cs.forEach((c) => c && classes.add(c)); attrs.set('class', [...classes].join(' ')); },
        remove(...cs) { cs.forEach((c) => classes.delete(c)); attrs.set('class', [...classes].join(' ')); },
        contains: (c) => classes.has(c),
        toggle(c, force) {
          const on = force === undefined ? !classes.has(c) : Boolean(force);
          if (on) classes.add(c); else classes.delete(c);
          attrs.set('class', [...classes].join(' '));
          return on;
        },
      },
      get id() { return attrs.get('id') || ''; },
      set id(v) { if (v) attrs.set('id', String(v)); else attrs.delete('id'); },
      get className() { return [...classes].join(' '); },
      set className(v) {
        classes.clear();
        String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
        if (classes.size) attrs.set('class', [...classes].join(' '));
        else attrs.delete('class');
      },
      get firstChild() { return children[0] || null; },
      get firstElementChild() { return children[0] || null; },
      get nextSibling() {
        if (!el.parentElement) return null;
        const idx = el.parentElement.children.indexOf(el);
        return idx >= 0 ? el.parentElement.children[idx + 1] || null : null;
      },
      get nextElementSibling() { return el.nextSibling; },
      get textContent() {
        if (children.length && !_text) return children.map((c) => c.textContent).join('');
        return _text;
      },
      set textContent(v) {
        children.length = 0;
        _text = String(v ?? '');
      },
      get innerHTML() { return el._innerHTML || ''; },
      set innerHTML(v) {
        el._innerHTML = String(v || '');
        if (!v) { children.length = 0; _text = ''; }
      },
      setAttribute(k, v) { attrs.set(k, String(v)); if (k === 'class') el.className = String(v); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); if (k === 'class') el.className = ''; },
      appendChild(ch) {
        if (ch.parentElement) ch.parentElement.removeChild(ch);
        ch.parentElement = ch.parentNode = el;
        children.push(ch);
        const mark = (n, val) => { n.isConnected = val; for (const c of n.children || []) mark(c, val); };
        if (el.isConnected) mark(ch, true);
        return ch;
      },
      insertBefore(ch, ref) {
        if (!ref) return el.appendChild(ch);
        if (ch.parentElement) ch.parentElement.removeChild(ch);
        ch.parentElement = ch.parentNode = el;
        const idx = children.indexOf(ref);
        if (idx >= 0) children.splice(idx, 0, ch); else children.push(ch);
        const mark = (n, val) => { n.isConnected = val; for (const c of n.children || []) mark(c, val); };
        if (el.isConnected) mark(ch, true);
        return ch;
      },
      removeChild(ch) {
        const idx = children.indexOf(ch);
        if (idx >= 0) children.splice(idx, 1);
        ch.parentElement = ch.parentNode = null;
        const mark = (n) => { n.isConnected = false; for (const c of n.children || []) mark(c); };
        mark(ch);
        return ch;
      },
      remove() { if (el.parentElement) el.parentElement.removeChild(el); else el.isConnected = false; },
      contains(other) {
        let cur = other;
        while (cur) { if (cur === el) return true; cur = cur.parentElement; }
        return false;
      },
      closest(sel) {
        let cur = el;
        while (cur) { if (matchesAny(cur, sel)) return cur; cur = cur.parentElement; }
        return null;
      },
      querySelectorAll(sel) {
        el._qsaCalls += 1;
        const out = [];
        const walk = (n) => { for (const c of n.children) { if (matchesAny(c, sel)) out.push(c); walk(c); } };
        walk(el);
        return out;
      },
      querySelector(sel) { el._qsCalls += 1; return el.querySelectorAll(sel)[0] || null; },
      getBoundingClientRect() { el._rectReads += 1; return { ..._rect }; },
      addEventListener(type, fn, cap) {
        const b = cap === true || cap?.capture ? listeners.capture : listeners.bubble;
        if (!b.has(type)) b.set(type, []);
        b.get(type).push(fn);
      },
      removeEventListener(type, fn, cap) {
        const b = cap === true || cap?.capture ? listeners.capture : listeners.bubble;
        const arr = b.get(type);
        if (!arr) return;
        const idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
      },
      dispatchEvent(ev) {
        el._dispatched.push(ev);
        ev.target = ev.target || el;
        ev.preventDefault = ev.preventDefault || (() => { ev.defaultPrevented = true; });
        ev.stopPropagation = ev.stopPropagation || (() => { ev._stopped = true; });
        ev.stopImmediatePropagation = ev.stopImmediatePropagation || (() => { ev._stopped = ev._imm = true; });
        for (const fn of [...(listeners.capture.get(ev.type) || [])]) fn(ev);
        for (const fn of [...(listeners.bubble.get(ev.type) || [])]) fn(ev);
        return !ev.defaultPrevented;
      },
      click() { el.dispatchEvent({ type: 'click' }); },
      focus() { el._focused = (el._focused || 0) + 1; },
      blur() {},
    };
    if (init.id) el.id = init.id;
    if (init.className) el.className = init.className;
    if (init.attrs) for (const [k, v] of Object.entries(init.attrs)) el.setAttribute(k, v);
    return el;
  }

  const html = makeEl('html', { attrs: { 'data-ag-cs-theme': 'dark', 'data-ag-cs-lang': 'zh-CN', 'data-ag-cs-motion': 'ultra' } });
  html.isConnected = true;
  const head = makeEl('head');
  const body = makeEl('body');
  html.appendChild(head);
  html.appendChild(body);

  class FakeMO {
    constructor(cb) { this.cb = cb; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
    takeRecords() { return []; }
    trigger(recs) { if (!this.disconnected) this.cb(recs, this); }
  }

  let execCommandHandler = opts.execCommand || (() => false);
  const execCalls = [];
  const doc = {
    hidden: false,
    documentElement: html,
    head,
    body,
    createElement: (tag) => makeEl(tag),
    createElementNS: (_ns, tag) => makeEl(tag),
    getElementById: (id) => html.querySelector(`#${id}`),
    querySelector: (sel) => html.querySelector(sel),
    querySelectorAll: (sel) => html.querySelectorAll(sel),
    addEventListener(t, fn) { if (!docListeners.has(t)) docListeners.set(t, []); docListeners.get(t).push(fn); },
    removeEventListener(t, fn) { const a = docListeners.get(t); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
    getSelection: () => ({ isCollapsed: true, toString: () => '', removeAllRanges() {}, addRange() {} }),
    createRange: () => ({ selectNodeContents() {}, collapse() {} }),
    execCommand(cmd, ui, val) { execCalls.push({ cmd, ui, val }); return execCommandHandler(cmd, val); },
  };

  const win = {
    document: doc,
    location: { pathname: '/c/test-conv-beta3' },
    navigator: { language: 'zh-CN' },
    performance: { now: () => fakeNow },
    MutationObserver: FakeMO,
    Event: class FakeEvent { constructor(t) { this.type = t; } },
    CustomEvent: class FakeCustomEvent { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    getComputedStyle: () => ({ backgroundColor: 'rgb(14, 14, 18)' }),
    matchMedia: () => ({ matches: false }),
    setTimeout,
    clearTimeout,
    requestAnimationFrame(cb) {
      const id = ++rafSeq;
      rafs.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) {
      rafs.delete(id);
    },
    addEventListener(t, fn) { if (!winListeners.has(t)) winListeners.set(t, []); winListeners.get(t).push(fn); },
    removeEventListener(t, fn) { const a = winListeners.get(t); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
    dispatchEvent(ev) {
      winDispatched.push(ev?.type || '');
      for (const fn of [...(winListeners.get(ev?.type) || [])]) fn(ev);
      return true;
    },
  };

  function flushRafs(dtMs = 16.67) {
    fakeNow += dtMs;
    const batch = [...rafs.entries()];
    rafs.clear();
    for (const [, cb] of batch) cb(fakeNow);
    return batch.length;
  }

  return {
    html, head, body, doc, win, makeEl, rafs, observers, winDispatched, execCalls,
    setExecCommandHandler(fn) { execCommandHandler = fn; },
    getNow: () => fakeNow,
    advanceNow(ms) { fakeNow += ms; },
    flushRafs,
  };
}

// ── Test 1: Lexical async execCommand('insertText') single-path guard ───────
test('1. context-menu-btw: Lexical async execCommand("insertText") returning true writes /compact, /plan, /learn, /grill-me exactly once (zero double-write)', async () => {
  const env = createDomEnv();
  const box = env.makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } });
  const ed = env.makeEl('div', { attrs: { contenteditable: 'true' }, text: '' });
  const sendBtn = env.makeEl('button', { attrs: { 'data-testid': 'input-send-button' } });
  let sendClicks = 0;
  sendBtn.addEventListener('click', () => { sendClicks += 1; });
  box.appendChild(ed);
  box.appendChild(sendBtn);
  env.body.appendChild(box);

  // Simulate real Lexical controlled contenteditable:
  // execCommand('insertText', false, text) returns true immediately,
  // while DOM textContent is asynchronously updated in a microtask!
  env.setExecCommandHandler((cmd, val) => {
    if (cmd !== 'insertText') return false;
    queueMicrotask(() => {
      ed.textContent = String(ed.textContent || '') + String(val);
    });
    return true;
  });

  const ctl = ctxMenuMod.createContextMenuController({
    doc: env.doc, win: env.win, nav: env.win.navigator, loc: env.win.location, stepDelayMs: 5,
  });

  const cases = [
    ['/compact', '', '/compact'],
    ['/plan', 'Refactor OAuth token refresh', '/plan\nRefactor OAuth token refresh'],
    ['/learn', 'Cache trackRect during drag', '/learn\nCache trackRect during drag'],
    ['/grill-me', 'Choose storage layout', '/grill-me\nChoose storage layout'],
  ];

  for (const [cmd, sel, expected] of cases) {
    ed.textContent = '';
    ed._dispatched.length = 0;
    const beforeClicks = sendClicks;
    const res = await ctl.triggerSlashCommand(cmd, sel);
    assert.equal(res.ok, true, `${cmd} must succeed`);
    assert.equal(res.command, cmd);
    assert.equal(ed.textContent, expected, `${cmd} must write once without doubling (got ${JSON.stringify(ed.textContent)})`);
    assert.equal(
      ed._dispatched.filter((e) => e.type === 'input').length,
      0,
      `${cmd} must NOT dispatch synthetic InputEvent when execCommand returned true`
    );
    assert.equal(sendClicks, beforeClicks + 1, `${cmd} must click send button once`);
  }

  // Fallback path when execCommand returns false or throws: still writes textContent + dispatches InputEvent
  env.setExecCommandHandler(() => { throw new Error('execCommand blocked'); });
  ed.textContent = '';
  ed._dispatched.length = 0;
  const fbRes = await ctl.triggerSlashCommand('/compact', '');
  assert.equal(fbRes.ok, true);
  assert.equal(ed.textContent, '/compact');
  assert.equal(ed._dispatched.filter((e) => e.type === 'input').length, 1, 'fallback path must dispatch InputEvent');

  ctl.destroy();
});

// ── Test 2: Pre-submit duplicate slash prefix guard ─────────────────────────
test('2. context-menu-btw: pre-submit duplicate slash guard aborts /compact/compact & /plan /plan without sending, while allowing valid quoted multiline text', async () => {
  const env = createDomEnv();
  const box = env.makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } });
  const ed = env.makeEl('div', { attrs: { contenteditable: 'true' }, text: '' });
  const sendBtn = env.makeEl('button', { attrs: { 'data-testid': 'input-send-button' } });
  let sendClicks = 0;
  sendBtn.addEventListener('click', () => { sendClicks += 1; });
  box.appendChild(ed);
  box.appendChild(sendBtn);
  env.body.appendChild(box);

  const ctl = ctxMenuMod.createContextMenuController({
    doc: env.doc, win: env.win, nav: env.win.navigator, loc: env.win.location, stepDelayMs: 5,
  });

  // Simulate broken host duplicating the inserted command into /compact/compact
  env.setExecCommandHandler((cmd, val) => {
    if (cmd !== 'insertText') return false;
    ed.textContent = String(ed.textContent || '') + String(val) + String(val);
    return true;
  });
  const dup1 = await ctl.triggerSlashCommand('/compact', '');
  assert.equal(dup1.ok, false);
  assert.equal(dup1.reason, 'duplicate-command');
  assert.equal(sendClicks, 0, 'duplicate /compact/compact must NEVER click send');
  assert.equal(ed._dispatched.some((e) => e.type === 'keydown' && e.key === 'Enter'), false);

  // Space-separated duplicate /plan /plan is also blocked
  ed.textContent = '';
  env.setExecCommandHandler((cmd, val) => {
    if (cmd !== 'insertText') return false;
    ed.textContent = val === '/plan' ? '/plan /plan' : ed.textContent + val;
    return true;
  });
  const dup2 = await ctl.triggerSlashCommand('/plan', 'some quote');
  assert.equal(dup2.ok, false);
  assert.equal(dup2.reason, 'duplicate-command');
  assert.equal(sendClicks, 0, 'duplicate /plan /plan must NEVER click send');

  // Valid multiline quote starting with /plan on line 2 must NOT be falsely blocked
  ed.textContent = '';
  env.setExecCommandHandler((cmd, val) => {
    if (cmd !== 'insertText') return false;
    ed.textContent = String(ed.textContent || '') + String(val);
    return true;
  });
  const validRes = await ctl.triggerSlashCommand('/plan', '/plan details on second line');
  assert.equal(validRes.ok, true);
  assert.equal(sendClicks, 1);

  ctl.destroy();
});

// ── Test 3: Dragging zero reflow + single-rAF coalescing + compositor knob + zero offsetWidth ──
test('3. upstream-client: drag caches trackRect (0 rect reads on move, invalidates on resize), coalesces pointermove into 1 rAF, uses knob transform, zero offsetWidth reflows, no container double-write', () => {
  const env = createDomEnv();
  const rowEl = env.makeEl('div', { className: 'ces-ag-effort-row' });
  const valEl = env.makeEl('span', { className: 'ces-ag-effort-value' });
  const container = env.makeEl('div', { className: 'ces-inline' });
  rowEl.appendChild(valEl);
  rowEl.appendChild(container);
  env.body.appendChild(rowEl);

  let official = 'low';
  const commits = [];
  const mount = upstreamLib.mountCodexEffortSlider({
    container,
    row: rowEl,
    valueElement: valEl,
    document: env.doc,
    window: env.win,
    seat: {
      isClaude: false,
      locked: false,
      effortLevels: [
        { effort: 'low', label: 'Low' },
        { effort: 'medium', label: 'Medium' },
        { effort: 'high', label: 'High' },
        { effort: 'xhigh', label: 'Extra' },
      ],
      get currentEffort() { return official; },
      selectEffort(item) {
        const eff = typeof item === 'string' ? item : item.effort;
        commits.push(eff);
        official = eff;
      },
    },
  });

  const track = container.querySelector('.ces-track');
  const knob = container.querySelector('.ces-knob');
  track._rect = { left: 0, top: 0, width: 220, height: 28, right: 220, bottom: 28 };
  track._rectReads = 0;
  valEl._offsetWidthReads = 0;

  // Container must NOT be double-written with data-energy / --ces-energy / data-theme
  assert.equal(container.hasAttribute('data-energy'), false, 'container must not be double-written with data-energy');
  assert.equal(container.hasAttribute('data-theme'), false, 'container must not be double-written with data-theme');
  assert.equal(container.style.getPropertyValue('--ces-energy'), '', 'container must not be double-written with --ces-energy');

  // Pointerdown caches trackRect exactly once
  track.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 14, pointerId: 1 });
  assert.equal(track._rectReads, 1, 'onPointerDown must read trackRect exactly once');

  // 25 rapid pointermove events within a single frame
  track._styleSets.length = 0;
  for (let i = 1; i <= 25; i++) {
    const cx = 14 + Math.round((192 * i) / 25);
    track.dispatchEvent({ type: 'pointermove', buttons: 1, clientX: cx, pointerId: 1 });
  }
  assert.equal(track._rectReads, 1, '25 pointermove events must perform 0 additional getBoundingClientRect() calls');
  const fillWritesBeforeRaf = track._styleSets.filter((s) => s.k === '--ces-fill').length;
  assert.equal(fillWritesBeforeRaf, 0, 'pointermove visual updates must be coalesced into rAF, not written synchronously per move');
  assert.equal(valEl.textContent, 'Extra', 'value label must still reflect tier jump immediately');
  assert.equal(valEl._offsetWidthReads, 0, 'rapid tier switches must trigger 0 synchronous offsetWidth forced reflows');

  // Single rAF flush paints visual exactly once and uses compositor transform on knob
  env.flushRafs(16.67);
  const fillWritesAfterRaf = track._styleSets.filter((s) => s.k === '--ces-fill').length;
  assert.equal(fillWritesAfterRaf, 1, '25 coalesced pointermove events must produce exactly 1 --ces-fill write per frame');
  assert.match(knob.style.transform, /^translate3d\([\d.]+px,0,0\)$/, 'knob must use compositor translate3d during drag');
  assert.equal(knob.style.left, '0px', 'knob must pin left:0px while translate3d is active');

  // Pointerup commits once and restores responsive CSS left positioning
  track.dispatchEvent({ type: 'pointerup', button: 0, clientX: 206, pointerId: 1 });
  assert.deepEqual(commits, ['xhigh']);
  assert.equal(knob.style.transform, '', 'knob transform must reset after pointerup');
  assert.equal(knob.style.left, '', 'knob left must reset to responsive CSS var(--ces-fill) after pointerup');
  assert.equal(valEl._offsetWidthReads, 0, 'triggerMaxEffects must also perform 0 synchronous offsetWidth forced reflows');

  // Resize invalidates cached rect on next drag
  track._rect = { left: 10, top: 0, width: 320, height: 28, right: 330, bottom: 28 };
  env.win.dispatchEvent(new env.win.Event('resize'));
  const readsBeforeSecondDrag = track._rectReads;
  track.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 24, pointerId: 2 });
  assert.equal(track._rectReads, readsBeforeSecondDrag + 1, 'resize must invalidate cached rect for next drag');
  track.dispatchEvent({ type: 'pointerup', button: 0, clientX: 24, pointerId: 2 });

  mount.unmount();
});

// ── Test 4: Dragging zero 500-layer Fiber walk & full-menu QSA + zero mount resize storm ──
test('4. upstream-client: mounting emits 0 global window resize events; dragging executes 0 Fiber walks, 0 panel QSA scans, and defers heavy _syncAgDom to pointerup', () => {
  const env = createDomEnv();
  const optLow = { label: 'Gemini 4 Carbon (Low)', modelId: 'c-low', value: 1 };
  const optMed = { label: 'Gemini 4 Carbon (Medium)', modelId: 'c-med', value: 2 };
  const optHigh = { label: 'Gemini 4 Carbon (High)', modelId: 'c-high', value: 3 };
  let selected = optLow;
  let commitCalls = 0;

  const panel = env.makeEl('div', { attrs: { 'data-testid': 'model-selector-panel' } });
  const listWrap = env.makeEl('div');
  const rowItem = env.makeEl('div', { attrs: { role: 'menuitem' } });
  const grpSpan = env.makeEl('span', { attrs: { 'data-testid': 'model-selector-effort-group', 'data-model-base': 'Gemini 4 Carbon' }, text: 'Gemini 4 Carbon' });
  const effSpan = env.makeEl('span', { text: 'Low' });
  rowItem.appendChild(grpSpan);
  rowItem.appendChild(effSpan);
  listWrap.appendChild(rowItem);
  panel.appendChild(listWrap);
  env.body.appendChild(panel);

  // Build 120-layer Fiber chain with access counter
  let fiberWalkSteps = 0;
  const providerVal = {
    effortIndex: new Map([['Gemini 4 Carbon', new Map([['low', optLow], ['medium', optMed], ['high', optHigh]])]]),
    modelOptions: [optLow, optMed, optHigh],
    get selectedModel() { return selected; },
    setModelConfigByLabelForConversation(lbl) {
      commitCalls += 1;
      selected = [optLow, optMed, optHigh].find((o) => o.label === lbl) || selected;
    },
  };
  let cur = { memoizedProps: { value: providerVal }, return: null };
  for (let i = 0; i < 120; i++) {
    const parent = cur;
    cur = {
      get memoizedProps() { fiberWalkSteps += 1; return {}; },
      return: parent,
    };
  }
  panel.__reactFiber$beta3 = cur;

  env.winDispatched.length = 0;
  const inst = upstreamLib.installCodexEffortSlider({
    document: env.doc,
    window: env.win,
    skipGenericMenuObserver: true,
  });

  // 1) Mounting MUST emit ZERO global window resize events
  assert.equal(
    env.winDispatched.filter((t) => t === 'resize').length,
    0,
    'Mounting effort slider must NEVER dispatch global window resize event'
  );

  const track = panel.querySelector('.ces-track');
  const valEl = panel.querySelector('.ces-ag-effort-value');
  assert.ok(track && valEl);

  // Start drag
  track.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 14, pointerId: 1 });
  const fiberAfterDown = fiberWalkSteps;
  const qsaAfterDown = panel._qsaCalls;

  // 20 rapid pointermove events (both intra-tier micro-moves & cross-tier jumps) + rAF flushes
  for (let i = 1; i <= 20; i++) {
    track.dispatchEvent({ type: 'pointermove', buttons: 1, clientX: 14 + i * 9, pointerId: 1 });
    if (i % 5 === 0) env.flushRafs(16.67);
  }
  assert.equal(fiberWalkSteps, fiberAfterDown, 'Dragging (pointermove + rAF visual) must perform 0 React Fiber walks');
  assert.equal(panel._qsaCalls, qsaAfterDown, 'Dragging must perform 0 full-panel querySelectorAll scans');
  assert.equal(commitCalls, 0, 'Dragging must not commit before pointerup');
  assert.equal(valEl.textContent, 'High', 'Lightweight value label must update across tier jumps during drag');

  // Pointerup triggers single commit & deferred heavy _syncAgDom
  track.dispatchEvent({ type: 'pointerup', button: 0, clientX: 206, pointerId: 1 });
  assert.equal(commitCalls, 1, 'pointerup must commit once');
  assert.equal(selected, optHigh);
  assert.equal(effSpan.textContent, 'High', 'Heavy _syncAgDom must sync menu row effort label on pointerup');

  inst.stop();
});

// ── Test 5: Claude dither canvas fillRect + fixed backing store + idle throttle + motion=off 0fps ──
test('5. upstream-client: Claude paintDither uses fillRect (0 quadraticCurveTo) + precomputed light LUT; stepClaudeCanvas keeps fixed trackW backing store, throttles when idle, and enforces 0fps in motion=off', () => {
  const env = createDomEnv();
  let fillRectCalls = 0;
  let bezierCalls = 0;
  let clipCalls = 0;
  let widthWrites = 0;
  const lightFillStyles = new Set();
  const darkFillStyles = new Set();

  const makeMockCtx = (styleBag) => ({
    globalAlpha: 1,
    _fs: '',
    get fillStyle() { return this._fs; },
    set fillStyle(v) { this._fs = String(v); styleBag.add(this._fs); },
    clearRect() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect(_x, _y, w, h) { if (w < 20 && h < 20) fillRectCalls += 1; },
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() { clipCalls += 1; },
    quadraticCurveTo() { bezierCalls += 1; },
  });

  // 1) Direct paintDither verification (dark & light)
  const darkCtx = makeMockCtx(darkFillStyles);
  upstreamLib.paintDither(darkCtx, 220, 28, true, 1, 0.5, 1);
  assert.ok(fillRectCalls > 100, `Expected >100 fillRect cells in dark mode, got ${fillRectCalls}`);
  assert.equal(bezierCalls, 0, 'paintDither must use fillRect instead of quadraticCurveTo bezier paths');
  assert.ok(darkFillStyles.has('rgb(208,192,246)') && darkFillStyles.has('rgb(220, 204, 255)'));

  const beforeLight = fillRectCalls;
  const lightCtx = makeMockCtx(lightFillStyles);
  upstreamLib.paintDither(lightCtx, 220, 28, false, 1, 0.5, 1);
  assert.ok(fillRectCalls - beforeLight > 50, 'Light mode paintDither must paint cells via fillRect');
  assert.equal(bezierCalls, 0);
  assert.ok([...lightFillStyles].some((s) => /^rgb\(\d+,\d+,\d+\)$/.test(s)), 'Light mode must paint via precomputed rgb LUT');

  // 2) Fixed backing store on drag + idle throttling + motion=off 0fps
  const origCreateEl = env.doc.createElement;
  let canvasCtx = null;
  let canvasEl = null;
  env.doc.createElement = (tag) => {
    const node = origCreateEl(tag);
    if (String(tag).toLowerCase() === 'canvas') {
      let _w = 280;
      let _h = 28;
      Object.defineProperty(node, 'width', {
        get() { return _w; },
        set(v) { widthWrites += 1; _w = v; },
      });
      Object.defineProperty(node, 'height', {
        get() { return _h; },
        set(v) { _h = v; },
      });
      canvasCtx = makeMockCtx(darkFillStyles);
      node.getContext = () => canvasCtx;
      canvasEl = node;
    }
    return node;
  };

  const container = env.makeEl('div', { className: 'ces-inline' });
  env.body.appendChild(container);
  const mount = upstreamLib.mountCodexEffortSlider({
    container,
    document: env.doc,
    window: env.win,
    seat: {
      isClaude: true,
      theme: 'claude',
      locked: false,
      effortLevels: [
        { effort: 'low', label: 'Low' },
        { effort: 'medium', label: 'Medium' },
        { effort: 'high', label: 'High' },
      ],
      currentEffort: 'high',
      selectEffort() {},
    },
  });

  const track = container.querySelector('.ces-track');
  track._rect = { left: 0, top: 0, width: 220, height: 28, right: 220, bottom: 28 };
  widthWrites = 0;
  clipCalls = 0;

  // Initial paint sets backing store width once to trackW (220)
  env.flushRafs(20);
  assert.equal(canvasEl.width, 220, 'Canvas backing store width must match fixed trackW');
  assert.equal(widthWrites, 1, 'Canvas backing store should allocate width once');

  // Dragging across 10 positions must perform 0 backing store width reallocations and use clip
  track.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 160, pointerId: 1 });
  for (let i = 0; i < 10; i++) {
    track.dispatchEvent({ type: 'pointermove', buttons: 1, clientX: 110 + i * 8, pointerId: 1 });
    env.flushRafs(20);
  }
  assert.equal(widthWrites, 1, 'Dragging must NOT reallocate canvas.width on every pixel move');
  assert.ok(clipCalls >= 5, 'Partial-width draw must clip cleanly on fixed backing store');
  track.dispatchEvent({ type: 'pointerup', button: 0, clientX: 206, pointerId: 1 });

  // After sweep finishes (progress >= 1) and idle at high tier, ~30fps throttle skips 18ms frames
  env.advanceNow(2000);
  env.flushRafs(40);
  const paintsAtIdle = fillRectCalls;
  env.flushRafs(18);
  assert.equal(fillRectCalls, paintsAtIdle, 'Idle high-tier Claude canvas must throttle below 60fps (skip 18ms tick)');
  env.flushRafs(20);
  assert.ok(fillRectCalls > paintsAtIdle, 'Idle high-tier Claude canvas must resume painting past 32ms gap');

  // motion="off" enforces strict 0fps halt
  env.html.setAttribute('data-ag-cs-motion', 'off');
  const paintsBeforeOff = fillRectCalls;
  env.flushRafs(60);
  assert.equal(fillRectCalls, paintsBeforeOff, 'motion="off" must paint 0 frames');
  assert.equal(env.rafs.size, 0, 'motion="off" must leave 0 pending Claude canvas rAFs');

  mount.unmount();
});

// ── Test 6: slider-coexist anti-self-MO + model-glyph-crystal knob rect cache + Channel 1 budget ──
test('6. slider-coexist skips self-injected glyphs/owned nodes in open menu, model-glyph-crystal caches knob rect, and Channel 1 stays < 685,000 B', () => {
  const env = createDomEnv();
  const panel = env.makeEl('div', { attrs: { 'data-testid': 'model-selector-panel' } });
  const row = env.makeEl('div', { attrs: { role: 'menuitem' } });
  const grp = env.makeEl('span', { attrs: { 'data-testid': 'model-selector-effort-group', 'data-model-base': 'Gemini 4 Carbon' }, text: 'Gemini 4 Carbon' });
  row.appendChild(grp);
  panel.appendChild(row);
  env.body.appendChild(panel);

  const ctl = sliderCoexist.createEffortSliderController({ window: env.win, document: env.doc });
  ctl.sync({ effortSliderModule: 'on' });
  const mo = env.observers[0];
  const baseScans = ctl.getState().perfStats.executedScans;

  // 1) Self-injected .ag-cs-panel-row-glyph & [data-ag-owned="1"] inserted into open menu row -> 0 rescans
  const glyph = env.makeEl('span', { className: 'ag-cs-model-glyph ag-cs-panel-row-glyph', attrs: { 'data-ag-owned': '1' } });
  const ownedBar = env.makeEl('div', { attrs: { 'data-ag-owned': '1' } });
  const cesSec = env.makeEl('div', { className: 'ces-ag-section' });
  const unrelatedDiv = env.makeEl('div');
  env.body.appendChild(unrelatedDiv);

  for (let i = 0; i < 20; i++) {
    mo.trigger([{ type: 'childList', target: row, addedNodes: [glyph], removedNodes: [] }]);
    mo.trigger([{ type: 'childList', target: panel, addedNodes: [ownedBar], removedNodes: [] }]);
    mo.trigger([{ type: 'childList', target: panel, addedNodes: [cesSec], removedNodes: [] }]);
    mo.trigger([{ type: 'childList', target: unrelatedDiv, addedNodes: [], removedNodes: [] }]);
  }
  assert.equal(ctl.getState().perfStats.executedScans, baseScans, 'Self-injected glyphs, ces-ag-section & unrelated nodes must trigger 0 rescans while menu is open');

  // Genuine submenu [role="menu"] insertion MUST still trigger immediate scan
  const subMenu = env.makeEl('div', { attrs: { role: 'menu' } });
  mo.trigger([{ type: 'childList', target: env.body, addedNodes: [subMenu], removedNodes: [] }]);
  assert.equal(ctl.getState().perfStats.executedScans, baseScans + 1, 'Genuine submenu insertion must still trigger scan');
  ctl.destroy();

  // 2) model-glyph-crystal caches knob getBoundingClientRect() during high-frequency pointer moves
  const mgcEnv = createDomEnv();
  mgcEnv.html.setAttribute('data-ag-cs-ambient', '1');
  const mPanel = mgcEnv.makeEl('div', { attrs: { 'data-testid': 'model-selector-panel', 'data-ces-orch-tunable': 'true' } });
  const orchRow = mgcEnv.makeEl('div', { attrs: { role: 'menuitem', 'data-testid': 'model-selector-orchestrator', 'data-ces-model-selected': 'true' }, text: 'Orchestrator' });
  const sec = mgcEnv.makeEl('div', { className: 'ces-ag-section' });
  const effRow = mgcEnv.makeEl('div', { className: 'ces-ag-effort-row' });
  const trk = mgcEnv.makeEl('div', { className: 'ces-track' });
  trk.style.setProperty('--ces-fill', 'calc(14px + (100% - 28px) * 0.5)');
  const knob = mgcEnv.makeEl('div', { className: 'ces-knob', rect: { left: 100, top: 100, width: 20, height: 20, right: 120, bottom: 120 } });
  trk.appendChild(knob);
  effRow.appendChild(trk);
  sec.appendChild(effRow);
  mPanel.appendChild(orchRow);
  mPanel.appendChild(sec);
  mgcEnv.body.appendChild(mPanel);

  const prevDoc = globalThis.document;
  const prevPerf = globalThis.performance;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCaf = globalThis.cancelAnimationFrame;
  globalThis.document = mgcEnv.doc;
  globalThis.performance = mgcEnv.win.performance;
  globalThis.requestAnimationFrame = mgcEnv.win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = mgcEnv.win.cancelAnimationFrame;
  try {
    const mCtl = mgcMod.createModelGlyphCrystalController({
      animatedIcons: null,
      crystalPrismCore: {
        mountCrystalPrismBar() {
          return { setReduceMotion() {}, setPointerClient() {}, wake() {}, step() {}, isIdle: () => true, dispose() {} };
        },
      },
      isDestroyed: () => false,
      isComposerRestyleEnabled: () => true,
      isZh: () => true,
      isDarkTheme: () => true,
      motionReduced: () => false,
      getMinFrameGapMs: () => 0,
      canMountRealCanvas: () => true,
      getLastPointerPos: () => ({ x: 110, y: 110 }),
      setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    });
    mCtl.syncModelSelectorPanel({ brand: 'antigravity', tier: 'auto', isOrchestrator: true });
    mgcEnv.flushRafs(16);
    const readsAfterMount = knob._rectReads;
    assert.equal(readsAfterMount, 1, 'Initial mount reads knob rect once');

    // 25 pointer moves within 100ms while --ces-fill is unchanged -> 0 additional rect reads
    for (let i = 0; i < 25; i++) {
      mgcEnv.advanceNow(3);
      mCtl.setCrystalPointerClient(105 + (i % 10), 108);
    }
    assert.equal(knob._rectReads, readsAfterMount, '25 pointer moves within 120ms TTL must hit cached knob rect (0 extra getBoundingClientRect)');

    // Updating --ces-fill invalidates knob rect cache immediately
    trk.style.setProperty('--ces-fill', 'calc(14px + (100% - 28px) * 1)');
    mCtl.setCrystalPointerClient(112, 112);
    assert.equal(knob._rectReads, readsAfterMount + 1, 'Changing --ces-fill must invalidate knob rect cache');
    mCtl.teardownCrystalMount();
  } finally {
    globalThis.document = prevDoc;
    globalThis.performance = prevPerf;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCaf;
  }

  // 3) Channel 1 bundle stays strictly < 685,000 B & parses cleanly
  const expr = cdp.buildInjectExpression(cdp.DEFAULT_CONFIG);
  const bytes = Buffer.byteLength(expr, 'utf8');
  assert.ok(bytes < 685000, `Channel 1 bundle must stay < 685,000 B, got ${bytes} B`);
  assert.doesNotThrow(() => new vm.Script(expr), 'Channel 1 bundle must parse cleanly');
});
