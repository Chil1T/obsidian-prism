// 模块域单测：Wave P3-C 运行时总线零放大、PR #120 同步回流清除、alert.css RTL :has 剥离、thought-client 切页零同步批测与 Worker 零 MSAA 守护
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const domBusMod = require(path.join(ROOT, 'src', 'runtime', 'dom-bus.js'));
const rippleWorkerMod = require(path.join(ROOT, 'src', 'runtime', 'ripple-worker.js'));
const homeRippleMod = require(path.join(ROOT, 'home-ripple-host.js'));
const streamChoreoMod = require(path.join(ROOT, 'stream-choreography.js'));
const cdp = require(path.join(ROOT, 'cdp.js'));

const HAS_TOK = ':h' + 'as(';

function createRichMockDom() {
  let now = 1000;
  let nextTimerId = 1;
  let nextRafId = 1;
  const timers = new Map();
  const rafs = new Map();
  const mos = [];
  const ios = [];
  const winListeners = new Map();
  const docListeners = new Map();

  function matchesSimple(el, rawSel) {
    if (!el || el.nodeType !== 1) return false;
    const parts = String(rawSel || '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const tokens = part.split(/\s+/).filter(Boolean);
      const matchAtom = (node, atom) => {
        if (!node || node.nodeType !== 1) return false;
        let rest = atom;
        const tagM = rest.match(/^[a-zA-Z0-9_-]+/);
        if (tagM) {
          if (node.tagName !== tagM[0].toUpperCase()) return false;
          rest = rest.slice(tagM[0].length);
        }
        const notMatches = [...rest.matchAll(/:not\(([^)]+)\)/g)];
        rest = rest.replace(/:not\([^)]+\)/g, '');
        for (const nm of notMatches) {
          if (matchAtom(node, nm[1])) return false;
        }
        const idM = rest.match(/#([a-zA-Z0-9_-]+)/);
        if (idM && node.id !== idM[1]) return false;
        for (const cm of rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
          if (!node.classList.contains(cm[1])) return false;
        }
        for (const am of rest.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)) {
          const k = am[1].trim();
          if (am[2] !== undefined) {
            if (node.getAttribute(k) !== am[2]) return false;
          } else if (!node.hasAttribute(k)) return false;
        }
        return true;
      };
      if (tokens.length === 1) {
        if (matchAtom(el, tokens[0])) return true;
      } else if (tokens.length >= 2) {
        if (!matchAtom(el, tokens[tokens.length - 1])) continue;
        let cur = el.parentElement;
        let ti = tokens.length - 2;
        while (cur && ti >= 0) {
          if (matchAtom(cur, tokens[ti])) ti -= 1;
          cur = cur.parentElement;
        }
        if (ti < 0) return true;
      }
    }
    return false;
  }

  function makeText(v) {
    return {
      nodeType: 3,
      nodeValue: String(v ?? ''),
      get data() { return this.nodeValue; },
      set data(x) { this.nodeValue = String(x ?? ''); },
      isConnected: true,
      parentElement: null,
      parentNode: null,
    };
  }

  function makeEl(tag = 'div', attrs = {}) {
    const attrMap = new Map();
    const styleProps = new Map();
    const children = [];
    const listeners = new Map();
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      id: '',
      className: '',
      dir: '',
      hidden: false,
      disabled: false,
      media: '',
      decoding: '',
      loading: '',
      isConnected: true,
      clientWidth: 900,
      clientHeight: 600,
      offsetHeight: 40,
      scrollTop: 0,
      width: 0,
      height: 0,
      dataset: {},
      sheet: { disabled: false },
      parentElement: null,
      parentNode: null,
      ownerDocument: null,
      children,
      childNodes: children,
      classList: {
        add(...cs) {
          const s = new Set(String(el.className || '').split(/\s+/).filter(Boolean));
          for (const c of cs) if (c) s.add(c);
          el.className = [...s].join(' ');
          attrMap.set('class', el.className);
        },
        remove(...cs) {
          const s = new Set(String(el.className || '').split(/\s+/).filter(Boolean));
          for (const c of cs) s.delete(c);
          el.className = [...s].join(' ');
          attrMap.set('class', el.className);
        },
        contains(c) { return String(el.className || '').split(/\s+/).includes(c); },
      },
      style: {
        cssText: '',
        display: '',
        visibility: '',
        position: '',
        width: '',
        height: '',
        setProperty(k, v) { styleProps.set(k, String(v)); },
        removeProperty(k) { styleProps.delete(k); },
        getPropertyValue(k) { return styleProps.get(k) || ''; },
      },
      get textContent() {
        if (this._rawText !== undefined) return this._rawText;
        return children.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join('');
      },
      set textContent(v) {
        this._rawText = undefined;
        children.length = 0;
        const s = String(v ?? '');
        if (s) {
          const tn = makeText(s);
          tn.parentElement = this;
          tn.parentNode = this;
          children.push(tn);
        }
      },
      get firstChild() { return children[0] || null; },
      get firstElementChild() { return children.find((c) => c.nodeType === 1) || null; },
      get lastElementChild() {
        for (let i = children.length - 1; i >= 0; i -= 1) if (children[i].nodeType === 1) return children[i];
        return null;
      },
      get nextSibling() {
        const p = this.parentElement;
        if (!p) return null;
        const idx = p.childNodes.indexOf(this);
        return idx >= 0 ? p.childNodes[idx + 1] || null : null;
      },
      get nextElementSibling() {
        const p = this.parentElement;
        if (!p) return null;
        const idx = p.childNodes.indexOf(this);
        for (let i = idx + 1; i < p.childNodes.length; i += 1) if (p.childNodes[i].nodeType === 1) return p.childNodes[i];
        return null;
      },
      get previousElementSibling() {
        const p = this.parentElement;
        if (!p) return null;
        const idx = p.childNodes.indexOf(this);
        for (let i = idx - 1; i >= 0; i -= 1) if (p.childNodes[i].nodeType === 1) return p.childNodes[i];
        return null;
      },
      getAttribute(k) { return attrMap.has(k) ? attrMap.get(k) : null; },
      setAttribute(k, v) {
        const sv = String(v);
        attrMap.set(k, sv);
        if (k === 'id') this.id = sv;
        if (k === 'class') this.className = sv;
        if (k === 'dir') this.dir = sv;
        if (k === 'media') this.media = sv;
      },
      hasAttribute(k) { return attrMap.has(k); },
      removeAttribute(k) {
        attrMap.delete(k);
        if (k === 'dir') this.dir = '';
        if (k === 'media') this.media = '';
      },
      appendChild(c) {
        if (!c) return c;
        if (c.parentNode && c.parentNode !== this) c.parentNode.removeChild?.(c);
        c.parentElement = this;
        c.parentNode = this;
        children.push(c);
        return c;
      },
      insertBefore(c, ref) {
        if (!c) return c;
        if (c.parentNode) c.parentNode.removeChild?.(c);
        c.parentElement = this;
        c.parentNode = this;
        const idx = ref ? children.indexOf(ref) : -1;
        if (idx >= 0) children.splice(idx, 0, c);
        else children.push(c);
        return c;
      },
      removeChild(c) {
        const idx = children.indexOf(c);
        if (idx >= 0) {
          children.splice(idx, 1);
          c.parentElement = null;
          c.parentNode = null;
        }
        return c;
      },
      remove() { this.parentNode?.removeChild?.(this); },
      contains(other) {
        for (let cur = other; cur; cur = cur.parentElement || cur.parentNode) if (cur === this) return true;
        return false;
      },
      matches(sel) { return matchesSimple(this, sel); },
      closest(sel) {
        for (let cur = this; cur; cur = cur.parentElement) if (matchesSimple(cur, sel)) return cur;
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (node) => {
          for (const ch of node.children || []) {
            if (ch.nodeType !== 1) continue;
            if (matchesSimple(ch, sel)) out.push(ch);
            walk(ch);
          }
        };
        walk(this);
        return out;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      getElementsByTagName(t) {
        const up = String(t).toUpperCase();
        const out = [];
        const walk = (node) => {
          for (const ch of node.children || []) {
            if (ch.nodeType !== 1) continue;
            if (up === '*' || ch.tagName === up) out.push(ch);
            walk(ch);
          }
        };
        walk(this);
        return out;
      },
      getBoundingClientRect() { return { left: 10, top: 20, width: 240, height: 48, right: 250, bottom: 68 }; },
      checkVisibility() { return !this.hidden && this.style.display !== 'none'; },
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, new Set());
        listeners.get(ev).add(fn);
      },
      removeEventListener(ev, fn) { listeners.get(ev)?.delete(fn); },
      dispatchEvent(ev) { for (const fn of listeners.get(ev?.type) || []) fn(ev); },
      getContext() { return null; },
    };
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') el.textContent = v;
      else if (k === 'className') el.setAttribute('class', v);
      else el.setAttribute(k, v);
    }
    return el;
  }

  const html = makeEl('html');
  const head = makeEl('head');
  const body = makeEl('body');
  html.appendChild(head);
  html.appendChild(body);

  const doc = {
    nodeType: 9,
    documentElement: html,
    head,
    body,
    hidden: false,
    activeElement: null,
    hasFocus: () => true,
    createElement: (t) => { const e = makeEl(t); e.ownerDocument = doc; return e; },
    createElementNS: (_ns, t) => { const e = makeEl(t); e.ownerDocument = doc; return e; },
    createTextNode: makeText,
    getElementById: (id) => html.querySelector(`#${id}`),
    querySelector: (sel) => html.querySelector(sel),
    querySelectorAll: (sel) => html.querySelectorAll(sel),
    getElementsByClassName: (cls) => html.querySelectorAll(`.${cls}`),
    addEventListener(ev, fn) {
      if (!docListeners.has(ev)) docListeners.set(ev, new Set());
      docListeners.get(ev).add(fn);
    },
    removeEventListener(ev, fn) { docListeners.get(ev)?.delete(fn); },
    dispatchEvent(ev) { for (const fn of docListeners.get(ev?.type) || []) fn(ev); },
  };
  html.ownerDocument = head.ownerDocument = body.ownerDocument = doc;

  class MockMO {
    constructor(cb) { this.cb = cb; this.active = false; this.target = null; this.opts = null; mos.push(this); }
    observe(target, opts) { this.active = true; this.target = target; this.opts = opts; }
    disconnect() { this.active = false; }
    takeRecords() { return []; }
    emit(recs) { if (this.active) this.cb(recs); }
  }

  class MockIO {
    constructor(cb, opts) { this.cb = cb; this.opts = opts || {}; this.observed = new Set(); this.active = true; ios.push(this); }
    observe(el) { this.observed.add(el); }
    unobserve(el) { this.observed.delete(el); }
    disconnect() { this.observed.clear(); this.active = false; }
    emit(entries) { if (this.active) this.cb(entries); }
  }

  const perfObj = { now: () => now };
  const setTimerFn = (fn, ms = 0) => {
    const id = nextTimerId++;
    timers.set(id, { fn, due: now + Math.max(0, Number(ms) || 0) });
    return id;
  };
  const clearTimerFn = (id) => { timers.delete(id); };
  const rafFn = (fn) => {
    const id = nextRafId++;
    rafs.set(id, fn);
    return id;
  };
  const cafFn = (id) => { rafs.delete(id); };

  const lsMap = new Map();
  const win = {
    document: doc,
    performance: perfObj,
    navigator: { language: 'zh-CN', languages: ['zh-CN'] },
    location: { pathname: '/c/11111111-1111-1111-1111-111111111111', href: 'http://localhost/' },
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 2,
    MutationObserver: MockMO,
    IntersectionObserver: MockIO,
    CSS: { supports: () => true },
    Event: class MockEvent { constructor(type) { this.type = type; } },
    CustomEvent: class MockCustomEvent { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    localStorage: {
      getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
      setItem: (k, v) => lsMap.set(k, String(v)),
      removeItem: (k) => lsMap.delete(k),
    },
    getComputedStyle: () => ({ getPropertyValue: () => '', display: 'block', visibility: 'visible', position: 'static' }),
    setTimeout: setTimerFn,
    clearTimeout: clearTimerFn,
    setInterval: () => 1,
    clearInterval: () => {},
    requestAnimationFrame: rafFn,
    cancelAnimationFrame: cafFn,
    addEventListener(ev, fn) {
      if (!winListeners.has(ev)) winListeners.set(ev, new Set());
      winListeners.get(ev).add(fn);
    },
    removeEventListener(ev, fn) { winListeners.get(ev)?.delete(fn); },
    dispatchEvent(ev) { for (const fn of winListeners.get(ev?.type) || []) fn(ev); },
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;
  doc.defaultView = win;

  const flushRafs = (stepMs = 16) => {
    now += stepMs;
    const batch = [...rafs.entries()];
    rafs.clear();
    for (const [, fn] of batch) fn(now);
  };
  const advance = (ms) => {
    const target = now + ms;
    while (true) {
      let earliestId = null;
      let earliest = null;
      for (const [id, t] of timers.entries()) {
        if (t.due <= target && (!earliest || t.due < earliest.due)) { earliestId = id; earliest = t; }
      }
      if (!earliest) break;
      timers.delete(earliestId);
      now = Math.max(now, earliest.due);
      earliest.fn();
    }
    now = target;
  };

  return { win, doc, html, head, body, makeEl, makeText, mos, ios, flushRafs, advance, getNow: () => now, setNow: (v) => { now = v; } };
}

// ── 1) ui-runtime: isConvRunning(true) 透传 + onRootMutations 批量上限保护 (bS >= 40) + 编辑器光标保护 ──
test('1) ui-runtime: forwards skipSyncVis=true to convAuraMod.isConvRunning on hot paths & caps bulk mutation classification at 40 while preserving inEditor caretDirty', () => {
  const env = createRichMockDom();
  const uiSrc = fs.readFileSync(path.join(ROOT, 'ui-runtime.js'), 'utf8');

  const convRunCalls = [];
  const caretQueueCalls = [];
  env.win.__agPrismConvAura = {
    isConvRunning(skipSyncVis, view) {
      convRunCalls.push({ skipSyncVis, view });
      return false;
    },
    createConvAuraController: () => ({
      sync() {}, refreshTheme() {}, unmount() {}, getInstance: () => null,
      setActiveView() {}, setSemanticState() {}, prime() {}, wake() {}, triggerStart() {}, advancePhase: () => 'off',
    }),
  };
  env.win.__agPrismSmoothCaret = {
    createSmoothCaretController: () => ({
      queue(...args) { caretQueueCalls.push(args); },
      sync() {}, applyMutations() {}, measureSnapshot: () => null,
      bumpMetricsEpoch() {}, invalidateSelection() {}, teardown() {},
    }),
  };

  const conv = env.makeEl('div', { 'data-testid': 'conversation-view', 'data-cascade-id': 'cid-1' });
  const msgList = env.makeEl('div', { 'data-testid': 'autoscroll-viewport' });
  const inputBox = env.makeEl('div', { 'data-testid': 'agent-input-box' });
  const card = env.makeEl('div', { className: 'surface-composer-card' });
  const editor = env.makeEl('div', { contenteditable: 'true' });
  card.appendChild(editor);
  inputBox.appendChild(card);
  conv.appendChild(msgList);
  conv.appendChild(inputBox);
  env.body.appendChild(conv);

  const scSrc = fs.readFileSync(path.join(ROOT, 'stream-choreography.js'), 'utf8');
  vm.runInNewContext(scSrc, env.win);
  vm.runInNewContext(uiSrc, env.win);
  env.win.__agCsUiMain({ ...cdp.DEFAULT_CONFIG, mascot: 'off', smoothCaret: true });
  env.flushRafs(16);
  env.advance(50);

  // 校验所有增量热路径（scheduleSync / runSync / scheduleHostEnhancerSync）调用 isConvRunning 均传递 skipSyncVis === true（0 同步 checkVisibility 风险）
  const rootMo = env.mos.find((m) => m.active && m.target === env.html);
  assert.ok(rootMo, 'ui-runtime root MutationObserver must be active');

  // 触发非 full 的 low-pri 变更（flags.l）以及主题属性变更（flags.t），覆盖 scheduleSync + runSync + scheduleHostEnhancerSync 三处热路径
  const preBlock = env.makeEl('pre', { text: 'console.log(1)' });
  msgList.appendChild(preBlock);
  rootMo.emit([{ type: 'childList', target: msgList, addedNodes: [preBlock], removedNodes: [] }]);
  env.flushRafs(16);
  env.advance(50);
  rootMo.emit([{ type: 'attributes', target: env.body, attributeName: 'class' }]);
  env.flushRafs(16);
  env.advance(50);

  assert.ok(convRunCalls.length >= 2, `ui-runtime must invoke convAuraMod.isConvRunning on incremental scheduleSync/runSync/enhancer paths (got ${convRunCalls.length})`);
  assert.ok(convRunCalls.every((c) => c.skipSyncVis === true), `Every hot-path isConvRunning call must pass skipSyncVis=true, got ${JSON.stringify(convRunCalls)}`);

  // 校验 onRootMutations 批量上限保护：一次切页挂入 80 个复杂子树时，bS >= 40 后短路不再逐节点跑 classifyDirtySubtree
  let qsCount = 0;
  const bulkNodes = [];
  for (let i = 0; i < 80; i += 1) {
    const n = env.makeEl('div', { className: 'turn-block' });
    n.appendChild(env.makeEl('span', { text: `msg-${i}` }));
    const origQs = n.querySelector.bind(n);
    n.querySelector = (s) => { qsCount += 1; return origQs(s); };
    msgList.appendChild(n);
    bulkNodes.push(n);
  }
  const syncBefore = env.win.__agPrism.getState().perf.syncCount;
  rootMo.emit([{ type: 'childList', target: msgList, addedNodes: bulkNodes, removedNodes: [] }]);
  assert.ok(qsCount <= 40 * 3, `Bulk mutation cap (bS>=40) must cap subtree querySelector probes (got ${qsCount} for 80 nodes)`);

  env.flushRafs(16);
  env.advance(120);
  env.flushRafs(16);
  assert.ok(env.win.__agPrism.getState().perf.syncCount > syncBefore, 'Bulk mutation short-circuit must still schedule a sync');
  assert.ok(convRunCalls.every((c) => c.skipSyncVis === true), 'Post-mutation scheduleSync/runSync must still pass skipSyncVis=true');

  // 校验编辑器内打字增删节点保持 caretDirty（平滑光标正常排队），且绝不误置 dirtyFlags.c 导致全量 sync
  caretQueueCalls.length = 0;
  const syncBeforeType = env.win.__agPrism.getState().perf.syncCount;
  const typedSpan = env.makeEl('span', { text: 'a' });
  editor.appendChild(typedSpan);
  rootMo.emit([{ type: 'childList', target: editor, addedNodes: [typedSpan], removedNodes: [] }]);
  assert.ok(caretQueueCalls.length >= 1, 'inEditor DOM mutation must still queue smoothCaretCtl');
  env.flushRafs(16);
  env.advance(120);
  env.flushRafs(16);
  assert.equal(env.win.__agPrism.getState().perf.syncCount, syncBeforeType, 'inEditor plain text/span mutation must NOT dirty composer sync');

  env.win.__agPrism.destroy();
});

// ── 2) stream-choreography: veil & sidebar glide pill 迁入 #ag-prism-overlay-portal + isConvRunning(true) ──
test('2) stream-choreography: mounts liftoff veil & sidebar glide pill inside #ag-prism-overlay-portal (0 body direct append) and calls isConvRunning(true)', () => {
  const env = createRichMockDom();
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevPerf = globalThis.performance;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCaf = globalThis.cancelAnimationFrame;
  globalThis.document = env.doc;
  globalThis.window = env.win;
  globalThis.performance = env.win.performance;
  globalThis.requestAnimationFrame = env.win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = env.win.cancelAnimationFrame;

  try {
    const runningArgs = [];
    const ctl = streamChoreoMod.createStreamChoreographyController({
      motionEngine: { spring() {}, stagger() {}, glideIndicator() {} },
      isDestroyed: () => false,
      isMotionStandardOrUltra: () => true,
      isMotionUltra: () => true,
      isConvRunning: (skip) => { runningArgs.push(skip); return false; },
      isThoughtIsolatedNode: () => false,
      isThoughtMutationRecord: () => false,
      isManagedThoughtPanel: () => false,
      setAttrIfChanged: (el, k, v) => { if (el && el.getAttribute(k) !== v) el.setAttribute(k, v); },
      runGuardedMut: (fn) => fn(),
      cloneCachedSvgElement: () => null,
      buildBrandMarkSvg: () => '',
      applySingleHostIcon: () => {},
      rippleCtl: null,
      convAuraCtl: null,
      notifyMascot: () => {},
    });

    // 1. Home -> FormalConv 触发 liftoff veil
    const home = env.makeEl('div', { className: 'agy-home' });
    const homeIb = env.makeEl('div', { 'data-testid': 'agent-input-box' });
    home.appendChild(homeIb);
    env.body.appendChild(home);
    ctl.syncHeroRouteChoreography({ inHome: true, formalConv: null, checkCaustics: false });

    home.remove();
    const conv = env.makeEl('div', { 'data-testid': 'conversation-view', 'data-cascade-id': 'cid-2' });
    const convIb = env.makeEl('div', { 'data-testid': 'agent-input-box' });
    conv.appendChild(convIb);
    env.body.appendChild(conv);
    ctl.syncHeroRouteChoreography({ inHome: false, formalConv: conv, checkCaustics: false });

    const portal = env.doc.getElementById('ag-prism-overlay-portal');
    assert.ok(portal, '#ag-prism-overlay-portal must be created lazily');
    assert.equal(portal.getAttribute('data-ag-owned'), '1');
    assert.ok(portal.style.cssText.includes('contain:layout style'), 'Portal must enable contain:layout style');
    const veil = env.doc.querySelector('.ag-cs-liftoff-veil');
    assert.ok(veil && veil.parentElement === portal, 'Liftoff veil must mount inside #ag-prism-overlay-portal, NOT document.body');

    // 2. 侧边栏切换触发 sidebar glide pill
    const list = env.makeEl('div', { 'data-testid': 'conversation-list-sidebar' });
    const row1 = env.makeEl('div', { 'data-testid': 'conversation-row-sidebar', 'data-cascade-id': 'c1', 'data-selected': 'true' });
    const row2 = env.makeEl('div', { 'data-testid': 'conversation-row-sidebar', 'data-cascade-id': 'c2', 'data-selected': 'false' });
    list.appendChild(row1);
    list.appendChild(row2);
    env.body.appendChild(list);

    const snap1 = ctl.measureSidebarSelectionSnapshot();
    ctl.syncSidebarSelectionGlide(snap1);
    row1.setAttribute('data-selected', 'false');
    row2.setAttribute('data-selected', 'true');
    const snap2 = ctl.measureSidebarSelectionSnapshot();
    ctl.syncSidebarSelectionGlide(snap2);

    const pill = env.doc.querySelector('.ag-cs-sidebar-glide-pill');
    assert.ok(pill && pill.parentElement === portal, 'Sidebar glide pill must mount inside #ag-prism-overlay-portal, NOT document.body');
    assert.equal(env.body.children.filter((c) => c.classList.contains('ag-cs-liftoff-veil') || c.classList.contains('ag-cs-sidebar-glide-pill')).length, 0, '0 direct veil/pill children on document.body');

    // 3. syncHeroCCaustics + syncDualStreamEngine 均传 isConvRunning(true)
    runningArgs.length = 0;
    ctl.syncHeroCCaustics([]);
    ctl.syncDualStreamEngine();
    assert.ok(runningArgs.length >= 2, 'Both syncHeroCCaustics and syncDualStreamEngine must call isConvRunning');
    assert.ok(runningArgs.every((a) => a === true), `stream-choreography must always pass skipSyncVis=true to isConvRunning, got ${JSON.stringify(runningArgs)}`);

    ctl.clearTransientTimers();
    ctl.disconnectStreamObserver();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.performance = prevPerf;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCaf;
  }
});

// ── 3) home-ripple-host: isCB() 250ms 缓存 + isConvRunning(true) + conv DPR<=1.25 + conv minGap>=16ms + noRen() ──
test('3) home-ripple-host: caches isCB() within 250ms, passes isConvRunning(true), caps conv DPR<=1.25 & cadence>=16ms while keeping home crisp, and preserves noRen()', () => {
  const env = createRichMockDom();
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevPerf = globalThis.performance;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCaf = globalThis.cancelAnimationFrame;
  const prevSt = globalThis.setTimeout;
  const prevCt = globalThis.clearTimeout;
  globalThis.document = env.doc;
  globalThis.window = env.win;
  globalThis.performance = env.win.performance;
  globalThis.requestAnimationFrame = env.win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = env.win.cancelAnimationFrame;
  globalThis.setTimeout = env.win.setTimeout;
  globalThis.clearTimeout = env.win.clearTimeout;

  try {
    env.html.setAttribute('data-ag-cs-perf-mode', 'quality');
    const mainBody = env.makeEl('div', { 'data-main-content-body': '1' });
    const conv = env.makeEl('div', { 'data-testid': 'conversation-view' });
    mainBody.appendChild(conv);
    env.body.appendChild(mainBody);

    let holeQsCount = 0;
    const origDocQs = env.doc.querySelector.bind(env.doc);
    env.doc.querySelector = (sel) => {
      if (String(sel).includes('data-has-browser-hole')) holeQsCount += 1;
      return origDocQs(sel);
    };

    const runArgs = [];
    let drawCalls = 0;
    const mockRc = {
      RIPPLE: { cellWidth: 7, cellHeight: 15 },
      parseCssColorToRgb: () => null,
      createWaveField: () => ({ active: () => true, disturb() {}, advance() {}, skimmer() {} }),
      createGlyphField: () => ({
        mode: 'webgl2',
        draw() { drawCalls += 1; },
        resize() {},
        dispose() {},
        invalidate() {},
        setCalmZones() {},
        needsDraw: () => true,
        busy: () => true,
      }),
    };

    const ctl = homeRippleMod.createHomeRippleController({
      rippleCore: mockRc,
      isDestroyed: () => false,
      isAllowed: () => true,
      isConvAllowed: () => true,
      getConvLevel: () => 'full',
      isConvRunning: (skip) => { runArgs.push(skip); return false; },
      isDarkTheme: () => true,
      motionReduced: () => false,
      getMinFrameGapMs: () => 0,
      getAmbientIntensity: () => 1,
      getAccentTone: () => 'follow',
      setAttrIfChanged: (el, k, v) => { if (el && el.getAttribute(k) !== v) el.setAttribute(k, v); },
    });

    ctl.sync();
    const mount = ctl.getMount();
    assert.ok(mount && mount.mode === 'conv', 'Should mount in conv mode');
    assert.ok(mount.dpr <= 1.25, `conv mode DPR must be capped <= 1.25 even on DPR=2 quality mode (got ${mount.dpr})`);

    // 多次热帧和 pointermove（在 250ms 窗口内）应命中 isCB() 缓存（0 次额外 browser-hole querySelector）
    const holeAfterMount = holeQsCount;
    for (let i = 0; i < 6; i += 1) {
      env.flushRafs(4); // 仅前进 4ms（< 16ms conv 封顶，同时 < 250ms 缓存窗口）
      mount.onMove({ clientX: 50 + i * 5, clientY: 60 });
    }
    assert.equal(holeQsCount, holeAfterMount, `isCB() must stay cached within 250ms window (extra queries: ${holeQsCount - holeAfterMount})`);
    assert.ok(runArgs.length > 0 && runArgs.every((a) => a === true), `home-ripple-host must always pass skipSyncVis=true to isConvRunning, got ${JSON.stringify(runArgs)}`);

    // 在 24ms 窗口内（6x 4ms），由于 conv minGap >= 16ms，实际重绘次数必须受限（不会每 4ms 重绘一次）
    assert.ok(drawCalls <= 3, `conv active frame cadence must be capped >= 16ms (got ${drawCalls} draws in 24ms)`);

    // 切回 home 模式时恢复完整 DPR (2.0 in quality)
    mainBody.remove();
    const home = env.makeEl('div', { className: 'agy-home' });
    env.body.appendChild(home);
    ctl.sync();
    env.flushRafs(16);
    assert.equal(ctl.getMount().mode, 'home');
    assert.equal(ctl.getMount().dpr, 2, 'home mode must keep full quality DPR=2.0 without degradation');
    ctl.unmount();

    // 验证 noRen() 完整保留：当 WebGL2/2D 都返回 mode:'none' 时立刻进入 sleeping
    const noneCtl = homeRippleMod.createHomeRippleController({
      rippleCore: {
        ...mockRc,
        createGlyphField: () => ({ mode: 'none', draw() {}, resize() {}, dispose() {}, invalidate() {}, setCalmZones() {}, needsDraw: () => true, busy: () => true }),
      },
      isDestroyed: () => false,
      isAllowed: () => true,
      isConvAllowed: () => false,
      getConvLevel: () => 'off',
      isConvRunning: () => false,
      isDarkTheme: () => true,
      motionReduced: () => false,
      getMinFrameGapMs: () => 0,
      getAmbientIntensity: () => 1,
      getAccentTone: () => 'follow',
      setAttrIfChanged: (el, k, v) => { if (el && el.getAttribute(k) !== v) el.setAttribute(k, v); },
    });
    noneCtl.sync();
    assert.equal(noneCtl.getMount().sleeping, true, 'noRen() must immediately put ripple host into idle sleep');
    noneCtl.unmount();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.performance = prevPerf;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCaf;
    globalThis.setTimeout = prevSt;
    globalThis.clearTimeout = prevCt;
  }
});

// ── 4) ui-runtime: #ag-prism-host-alert-css 在 LTR 默认页彻底剥离 6 条 RTL-has 规则，插入 RTL 时按需恢复，destroy 完整复原 ──
test('4) ui-runtime: strips all 6 RTL-has rules from #ag-prism-host-alert-css on LTR pages, lazily restores on RTL insertion/attr, and restores original CSS on destroy', () => {
  const env = createRichMockDom();
  const uiSrc = fs.readFileSync(path.join(ROOT, 'ui-runtime.js'), 'utf8');

  const alertCssWith6Rtl = [
    '/* remark-github-blockquote-alert/alert.css */',
    '.markdown-alert{padding:8px;border-left:4px solid currentColor}',
    `.markdown-alert-note${HAS_TOK}:dir(rtl)){border-left:none;border-right:4px solid blue}`,
    `:is(.markdown-alert-tip,.markdown-alert-important)${HAS_TOK}:dir(rtl)){border-left:none;border-right:4px solid green}`,
    `.keep-ltr, .markdown-alert-warning${HAS_TOK}:dir(rtl)){color:orange}`,
    `@layer components{ .markdown-alert-caution${HAS_TOK}:dir(rtl)){border-right:4px solid red} }`,
    `:is(.markdown-alert)${HAS_TOK}:is(p,div):dir(rtl)){text-align:right}`,
    `.markdown-alert-title${HAS_TOK}:dir(rtl)){flex-direction:row-reverse}`,
  ].join('\n');

  const hostSt1 = env.makeEl('style', { text: alertCssWith6Rtl });
  const hostSt2 = env.makeEl('style', { text: alertCssWith6Rtl });
  env.body.appendChild(hostSt1);
  env.body.appendChild(hostSt2);

  vm.runInNewContext(uiSrc, env.win);
  env.win.__agCsUiMain({ ...cdp.DEFAULT_CONFIG, mascot: 'off', smoothCaret: false });

  const singleton = env.doc.getElementById('ag-prism-host-alert-css');
  assert.ok(singleton, 'Singleton #ag-prism-host-alert-css must exist');
  assert.equal(singleton.textContent.includes(HAS_TOK), false, `Default LTR singleton must contain 0 ${HAS_TOK} rules, got:\n${singleton.textContent}`);
  assert.ok(singleton.textContent.includes('.markdown-alert{padding:8px;border-left:4px solid currentColor}'), 'Normal LTR alert rules must remain intact');
  assert.ok(singleton.textContent.includes('.keep-ltr{color:orange}'), 'Mixed selector rule must retain its non-RTL selector .keep-ltr');
  assert.equal(/^\s*\//.test(singleton.textContent.replace(/\/\*[\s\S]*?\*\//g, '')), false, 'Leading CSS comment must NOT leave dangling "/" corruption');

  // 动态插入带 dir="rtl" 的内容后，按需恢复完整 RTL alert.css
  const rootMo = env.mos.find((m) => m.active && m.target === env.html);
  const rtlDiv = env.makeEl('div', { dir: 'rtl', text: 'مرحبا' });
  env.body.appendChild(rtlDiv);
  rootMo.emit([{ type: 'childList', target: env.body, addedNodes: [rtlDiv], removedNodes: [] }]);
  env.flushRafs(16);
  env.advance(120);
  env.flushRafs(16);
  assert.equal(singleton.textContent, alertCssWith6Rtl, 'Singleton must lazily restore full alert.css once an RTL element enters DOM');

  // destroy() 必须把原始完整 CSS 复原回全部被去重的宿主 <style>
  env.win.__agPrism.destroy();
  assert.equal(env.doc.getElementById('ag-prism-host-alert-css'), null);
  assert.equal(hostSt1.textContent, alertCssWith6Rtl);
  assert.equal(hostSt2.textContent, alertCssWith6Rtl);

  // 初始 LTR -> 属性变更 dir="rtl" 也必须触发恢复
  const env2 = createRichMockDom();
  const stOnly = env2.makeEl('style', { text: alertCssWith6Rtl });
  env2.body.appendChild(stOnly);
  vm.runInNewContext(uiSrc, env2.win);
  env2.win.__agCsUiMain({ ...cdp.DEFAULT_CONFIG, mascot: 'off', smoothCaret: false });
  const s2 = env2.doc.getElementById('ag-prism-host-alert-css');
  assert.equal(s2.textContent.includes(HAS_TOK), false);
  const mo2 = env2.mos.find((m) => m.active && m.target === env2.html);
  env2.html.setAttribute('dir', 'rtl');
  mo2.emit([{ type: 'attributes', target: env2.html, attributeName: 'dir' }]);
  env2.flushRafs(16);
  env2.advance(120);
  env2.flushRafs(16);
  assert.equal(s2.textContent, alertCssWith6Rtl, 'Attribute mutation dir="rtl" must lazily restore full alert.css');
  env2.win.__agPrism.destroy();
});

// ── 5) dom-bus: 全局 characterData 变更零广播放大（非 characterData 订阅者 0 回调、0 filter 扫描、混合批次剔除 characterData） ──
test('5) dom-bus: prevents characterData broadcast amplification to non-characterData subscribers on pure & mixed batches', () => {
  const env = createRichMockDom();
  const bus = domBusMod.createInstance(env.doc, env.win);

  const i18nBatches = [];
  const uiBatches = [];
  const enhBatches = [];
  let enhFilterCalls = 0;

  const u1 = bus.subscribe('host-i18n-dom', (m) => i18nBatches.push(m), {
    doc: env.doc, win: env.win,
    observeOptions: { childList: true, subtree: true, characterData: true },
  });
  const u2 = bus.subscribe('ui-runtime-root', (m) => uiBatches.push(m), {
    doc: env.doc, win: env.win, priority: 'high',
    observeOptions: { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'dir'] },
  });
  const u3 = bus.subscribe('host-workbench-enhancer', (m) => enhBatches.push(m), {
    doc: env.doc, win: env.win,
    observeOptions: { childList: true, subtree: true },
    filter: (m) => { enhFilterCalls += 1; return m.type === 'childList'; },
  });

  const rootMo = env.mos.find((m) => m.active && m.target === env.html);
  assert.ok(rootMo && rootMo.opts.characterData === true, 'rootMo must enable characterData for host-i18n-dom');

  // 1. 纯流式吐字 characterData 洪峰（50 条）：ui-runtime 与 enhancer 必须 0 回调、0 filter 调用
  const cdBurst = Array.from({ length: 50 }, (_, i) => ({ type: 'characterData', target: env.makeText(`tok-${i}`) }));
  rootMo.emit(cdBurst);
  assert.equal(i18nBatches.length, 1);
  assert.equal(i18nBatches[0].length, 50);
  assert.equal(uiBatches.length, 0, 'ui-runtime-root must NOT be woken by pure characterData streaming burst');
  assert.equal(enhBatches.length, 0, 'host-workbench-enhancer must NOT be woken by pure characterData streaming burst');
  assert.equal(enhFilterCalls, 0, 'Non-characterData subscriber filter must NOT be evaluated on pure characterData burst');

  // 2. 混合批次（characterData + childList + attributes）：非 characterData 订阅者严禁收到任何 characterData 记录
  const dummyDiv = env.makeEl('div');
  rootMo.emit([
    { type: 'characterData', target: env.makeText('stream-1') },
    { type: 'characterData', target: env.makeText('stream-2') },
    { type: 'childList', target: env.body, addedNodes: [dummyDiv], removedNodes: [] },
    { type: 'attributes', target: dummyDiv, attributeName: 'class' },
  ]);
  assert.equal(uiBatches.length, 1);
  assert.equal(uiBatches[0].length, 2, 'ui-runtime-root must receive only childList + matching attribute');
  assert.equal(uiBatches[0].some((r) => r.type === 'characterData'), false, 'ui-runtime-root must NEVER receive characterData records');
  assert.equal(enhBatches.length, 1);
  assert.equal(enhBatches[0].length, 1, 'host-workbench-enhancer must receive only childList');
  assert.equal(enhFilterCalls, 1, 'enhancer filter must only inspect the 1 childList record (characterData & attributes skipped)');

  u1(); u2(); u3();
  bus.dispose(env.doc, env.win);
});

// ── 6) thought-client: 切页首帧 hasVisIo() 下 0 同步 getBoundingClientRect / checkVisibility 批测 + 无 IO 回退单批上限 32 ──
test('6) thought-client: defers unobserved page-switch targets to shared IO (0 sync getBoundingClientRect/checkVisibility) and caps sync probe fallback at 32', async () => {
  const env = createRichMockDom();
  const bus = domBusMod.createInstance(env.doc, env.win);
  env.win.__agDomBus = env.win.__agPrismDomBus = bus;

  const thoughtSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'thought-translator', 'thought-client.js'), 'utf8');
  const conv = env.makeEl('div', { 'data-testid': 'conversation-view', 'data-cascade-id': 'long-conv' });
  const sidebar = env.makeEl('div', { 'data-testid': 'conversation-list-sidebar' });
  env.body.appendChild(sidebar);
  env.body.appendChild(conv);

  let rectCount = 0;
  let visCount = 0;
  const instrument = (el) => {
    const origRect = el.getBoundingClientRect.bind(el);
    const origVis = el.checkVisibility.bind(el);
    el.getBoundingClientRect = () => { rectCount += 1; return origRect(); };
    el.checkVisibility = () => { visCount += 1; return origVis(); };
    return el;
  };

  // 构造 10 个历史展开思考块 + 1 个最新思考块（仅最新块允许即时处理，历史块须交给 IO 零同步回流）
  const histPanels = [];
  for (let i = 0; i < 10; i += 1) {
    const wrap = env.makeEl('div');
    const trig = instrument(env.makeEl('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true', text: `Thought for ${i + 1}s` }));
    const body = instrument(env.makeEl('div', { text: `Analyzing module ${i} architecture and verifying layout boundaries carefully.` }));
    wrap.appendChild(trig);
    wrap.appendChild(body);
    conv.appendChild(wrap);
    histPanels.push(body);
  }
  // 1 个最新块（未展开不阻塞）
  const latestWrap = env.makeEl('div');
  latestWrap.appendChild(env.makeEl('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'false', text: 'Thought for 2s' }));
  latestWrap.appendChild(env.makeEl('div', { text: 'Latest thought body.' }));
  conv.appendChild(latestWrap);

  // 构造 8 个展开工具组（内含嵌套 tool-call-row）
  const toolBodies = [];
  const nestedRows = [];
  for (let i = 0; i < 8; i += 1) {
    const grp = env.makeEl('div');
    const tBtn = env.makeEl('button', { 'data-testid': 'tool-group-collapsible', 'aria-expanded': 'true', text: `Ran ${i + 1} tools` });
    const tBody = instrument(env.makeEl('div'));
    const row = instrument(env.makeEl('div', { 'data-testid': 'tool-call-row', text: `Searched files in workspace directory ${i}` }));
    tBody.appendChild(row);
    grp.appendChild(tBtn);
    grp.appendChild(tBody);
    conv.appendChild(grp);
    toolBodies.push(tBody);
    nestedRows.push(row);
  }

  // 构造 8 条侧边栏标题
  const titleRows = [];
  for (let i = 0; i < 8; i += 1) {
    const r = instrument(env.makeEl('div', { 'data-testid': 'conversation-row-sidebar', text: `Refactor runtime bus ${i}` }));
    sidebar.appendChild(r);
    titleRows.push(r);
  }

  // mock fetch 拦截翻译请求（本地零外网）
  const fetchedTexts = [];
  env.win.fetch = async (_url, init) => {
    const bodyObj = JSON.parse(String(init?.body || '{}'));
    const arr = Array.isArray(bodyObj.texts) ? bodyObj.texts : [bodyObj.text || ''];
    fetchedTexts.push(...arr);
    return { ok: true, json: async () => ({ ok: true, translations: arr.map((t) => `[译]${t}`), text: `[译]${arr[0] || ''}` }) };
  };

  vm.runInNewContext(thoughtSrc, env.win);
  assert.ok(env.win.__agPrismThought, 'thought-client must mount global API');
  env.win.__agPrismThought.sync({
    thoughtTranslate: 'machine',
    thoughtTrigger: 'expand',
    thoughtView: 'immersive',
    language: 'zh-CN',
  });
  env.win.__agPrismThought.setTranslateTitles?.(true);
  env.win.__agPrismThought.setTranslateToolSummaries?.(true);

  rectCount = 0;
  visCount = 0;
  env.win.__agPrismThought.scanImmediate?.();
  env.advance(100);
  env.flushRafs(16);

  // 首帧扫描：所有未观测的历史思考块/工具容器/嵌套工具行/侧边栏标题均 0 同步 getBoundingClientRect & 0 checkVisibility
  assert.equal(rectCount, 0, `First-frame page-switch scan with hasVisIo() must execute 0 sync getBoundingClientRect on unobserved targets (got ${rectCount})`);
  assert.equal(visCount, 0, `First-frame page-switch scan with hasVisIo() must execute 0 sync checkVisibility on unobserved targets (got ${visCount})`);

  // 校验 IO 已注册历史思考块与工具容器，且未重复观测工具容器内部的嵌套 tool-call-row
  const io = env.ios.find((x) => x.active);
  assert.ok(io, 'Shared IntersectionObserver must be active');
  assert.ok(io.observed.has(histPanels[0]), 'Historical thought panel must be registered on shared IO');
  assert.ok(io.observed.has(toolBodies[0]), 'Tool group container must be registered on shared IO');
  assert.equal(io.observed.has(nestedRows[0]), false, 'Nested tool-call-row inside observed tool container must NOT be double-observed');

  // 触发 IO 首回调：仅目标进入视口后按需处理，且仍为 0 同步 getBoundingClientRect
  io.emit([
    { target: histPanels[0], isIntersecting: true },
    { target: toolBodies[0], isIntersecting: true },
    { target: titleRows[0], isIntersecting: true },
  ]);
  env.advance(50);
  env.flushRafs(16);
  assert.equal(rectCount, 0, `IO visibility callback path must also avoid sync getBoundingClientRect (got ${rectCount})`);

  env.win.__agPrismThought.destroy();
  bus.dispose(env.doc, env.win);

  // 无 IO 环境降级校验：单批同步 rect 探测上限严格 <= 32
  const envNoIo = createRichMockDom();
  delete envNoIo.win.IntersectionObserver;
  const conv2 = envNoIo.makeEl('div', { 'data-testid': 'conversation-view', 'data-cascade-id': 'no-io-conv' });
  envNoIo.body.appendChild(conv2);
  let noIoRects = 0;
  for (let i = 0; i < 60; i += 1) {
    const w = envNoIo.makeEl('div');
    const b = envNoIo.makeEl('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true', text: `Thought ${i}` });
    const p = envNoIo.makeEl('div', { text: `Long fallback thought block number ${i} checking batch cap.` });
    p.getBoundingClientRect = () => { noIoRects += 1; return { left: 0, top: 5000, width: 200, height: 40, right: 200, bottom: 5040 }; };
    w.appendChild(b); w.appendChild(p); conv2.appendChild(w);
  }
  envNoIo.win.fetch = async () => ({ ok: true, json: async () => ({ ok: true, translations: [] }) });
  vm.runInNewContext(thoughtSrc, envNoIo.win);
  envNoIo.win.__agPrismThought.sync({ thoughtTranslate: 'machine', thoughtTrigger: 'expand', language: 'zh-CN' });
  noIoRects = 0;
  envNoIo.win.__agPrismThought.scanImmediate?.();
  assert.ok(noIoRects > 0 && noIoRects <= 32, `Without IO, sync getBoundingClientRect probes per scan must be capped at 32 (got ${noIoRects})`);
  envNoIo.win.__agPrismThought.destroy();
});

// ── 7) ripple-worker: Worker WebGL2 显式禁 MSAA/depth/stencil + quality 模式下柔和光晕 DPR<=1.5（同时保留主页点阵 2.0 锐利度） ──
test('7) ripple-worker: disables MSAA/depth/stencil on Worker WebGL2 contexts and caps quality glow DPR <= 1.5 while preserving crisp home ripple DPR 2.0', () => {
  const expectedGlOpts = 'antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false';
  assert.ok(rippleWorkerMod.PROBE_WORKER_SRC.includes(expectedGlOpts), 'PROBE_WORKER_SRC must explicitly disable MSAA/depth/stencil');
  assert.ok(rippleWorkerMod.RENDER_WORKER_SRC.includes(expectedGlOpts), 'RENDER_WORKER_SRC must explicitly disable MSAA/depth/stencil');

  const qualityDoc = {
    documentElement: {
      dataset: { agCsPerfMode: 'quality' },
      getAttribute: (k) => (k === 'data-ag-cs-perf-mode' ? 'quality' : null),
    },
  };
  const glowDprDefault = rippleWorkerMod.resolveGlowDpr(2, qualityDoc);
  const glowDprScaled = rippleWorkerMod.resolveGlowDpr(2, qualityDoc, 0.7);
  assert.ok(glowDprDefault > 0.75 && glowDprDefault <= 1.5, `quality glow DPR must be capped <= 1.5 (got ${glowDprDefault})`);
  assert.ok(glowDprScaled > 0.75 && glowDprScaled <= 1.5, `quality scaled glow DPR must be capped <= 1.5 (got ${glowDprScaled})`);
  assert.equal(rippleWorkerMod.resolveRippleDpr(2, qualityDoc), 2.0, 'quality home glyph field DPR must remain crisp at 2.0');
  assert.equal(rippleWorkerMod.getPerfProfile(qualityDoc).msaa, true, 'PERF_PROFILES.quality.msaa contract for 3D crystal must remain intact');
});
