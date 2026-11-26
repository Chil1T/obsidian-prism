import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const inlineMod = require(path.join(ROOT, 'vendor', 'pulse-dashboard', 'inline-fallback.js'));
const domBusMod = require(path.join(ROOT, 'src', 'runtime', 'dom-bus.js'));

const CID_A = 'aaaaaaaa-1111-4222-8333-444444444444';
const CID_B = 'bbbbbbbb-1111-4222-8333-444444444444';
const CID_C = 'cccccccc-1111-4222-8333-444444444444';

function createSwitchMockEnv({ initialCid = CID_A, withDomBus = false } = {}) {
  const winListeners = new Map();
  const docListeners = new Map();
  const mos = [];
  const ros = [];

  function addL(map, type, fn) {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add(fn);
  }
  function remL(map, type, fn) {
    map.get(type)?.delete(fn);
  }
  function emitL(map, type, ev = {}) {
    for (const fn of [...(map.get(type) || [])]) fn({ type, ...ev });
  }

  function matchTok(el, sel) {
    let rest = sel.trim();
    if (!rest || rest.includes(' ') || rest.includes('>')) return false;
    const tagM = rest.match(/^[a-zA-Z0-9-]+/);
    if (tagM) {
      if (el.tagName !== tagM[0].toUpperCase()) return false;
      rest = rest.slice(tagM[0].length);
    }
    for (const m of rest.matchAll(/#([a-zA-Z0-9_-]+)/g)) {
      if (el.getAttribute('id') !== m[1]) return false;
    }
    for (const m of rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
      const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
      if (!cls.includes(m[1])) return false;
    }
    for (const m of rest.matchAll(/\[([a-zA-Z0-9_-]+)(?:=["']?([^"'\]\s]+)["']?)?\]/g)) {
      if (!el.hasAttribute(m[1])) return false;
      if (m[2] !== undefined && el.getAttribute(m[1]) !== m[2]) return false;
    }
    return true;
  }

  function matchesSel(el, selector) {
    return String(selector).split(',').some((p) => matchTok(el, p.trim()));
  }

  function walk(root, cb) {
    for (const c of root.children || []) {
      cb(c);
      walk(c, cb);
    }
  }

  function mkNode(tag) {
    const attrs = new Map();
    const listeners = new Map();
    const styleProps = new Map();
    const style = {
      setProperty(k, v) { styleProps.set(k, String(v)); this[k] = String(v); },
      getPropertyValue(k) { return styleProps.get(k) || ''; },
      removeProperty(k) { styleProps.delete(k); delete this[k]; },
    };
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      children: [],
      parentNode: null,
      parentElement: null,
      shadowRoot: null,
      isConnected: true,
      textContent: '',
      hidden: false,
      style,
      get id() { return attrs.get('id') || ''; },
      set id(v) { if (v) attrs.set('id', String(v)); else attrs.delete('id'); },
      get className() { return attrs.get('class') || ''; },
      set className(v) { attrs.set('class', String(v || '')); },
      get firstChild() { return el.children[0] || null; },
      get firstElementChild() { return el.children[0] || null; },
      setAttribute(k, v) {
        if (k === 'hidden') el.hidden = true;
        attrs.set(k, String(v));
      },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) {
        if (k === 'hidden') el.hidden = false;
        attrs.delete(k);
      },
      appendChild(c) {
        if (c.parentNode) c.remove();
        c.parentNode = el;
        c.parentElement = el.tagName === '#SHADOW-ROOT' ? null : el;
        c.isConnected = el.isConnected;
        el.children.push(c);
        return c;
      },
      insertBefore(c, ref) {
        if (!ref) return el.appendChild(c);
        const i = el.children.indexOf(ref);
        if (i < 0) return el.appendChild(c);
        if (c.parentNode) c.remove();
        c.parentNode = el;
        c.parentElement = el.tagName === '#SHADOW-ROOT' ? null : el;
        c.isConnected = el.isConnected;
        el.children.splice(i, 0, c);
        return c;
      },
      removeChild(c) {
        const i = el.children.indexOf(c);
        if (i >= 0) {
          el.children.splice(i, 1);
          c.parentNode = c.parentElement = null;
          c.isConnected = false;
        }
        return c;
      },
      remove() { if (el.parentNode) el.parentNode.removeChild(el); },
      attachShadow({ mode }) {
        const sr = mkNode('#shadow-root');
        sr.mode = mode;
        sr.host = el;
        el.shadowRoot = sr;
        return sr;
      },
      getElementById(id) {
        let hit = null;
        walk(el, (n) => { if (!hit && n.getAttribute('id') === id) hit = n; });
        return hit;
      },
      querySelectorAll(sel) {
        const out = [];
        walk(el, (n) => { if (matchesSel(n, sel)) out.push(n); });
        return out;
      },
      querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
      matches(sel) { return matchesSel(el, sel); },
      closest(sel) {
        let cur = el;
        while (cur && cur.tagName !== '#SHADOW-ROOT') {
          if (matchesSel(cur, sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      contains(other) {
        let cur = other;
        while (cur) {
          if (cur === el) return true;
          cur = cur.parentNode;
        }
        return false;
      },
      getBoundingClientRect() { return { left: 0, top: 0, width: 720, height: 32, right: 720, bottom: 32 }; },
      addEventListener(type, fn) { addL(listeners, type, fn); },
      removeEventListener(type, fn) { remL(listeners, type, fn); },
      dispatchEvent(ev) {
        emitL(listeners, ev.type, { stopPropagation() {}, preventDefault() {}, target: el, ...ev });
        return true;
      },
    };
    return el;
  }

  const html = mkNode('html');
  const body = mkNode('body');
  html.appendChild(body);

  const convView = mkNode('div');
  convView.setAttribute('data-testid', 'conversation-view');
  convView.setAttribute('data-cascade-id', initialCid);

  const inputBox = mkNode('div');
  inputBox.setAttribute('data-testid', 'agent-input-box');
  const footer = mkNode('div');
  footer.className = 'agy-composer-footer flex items-center';
  footer.appendChild(mkNode('div'));
  footer.appendChild(mkNode('button'));
  inputBox.appendChild(footer);
  convView.appendChild(inputBox);
  body.appendChild(convView);

  const doc = {
    hidden: false,
    documentElement: html,
    body,
    activeElement: body,
    createElement: (t) => mkNode(t),
    getElementById: (id) => html.getElementById(id),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener: (t, fn) => addL(docListeners, t, fn),
    removeEventListener: (t, fn) => remL(docListeners, t, fn),
    dispatchEvent: (ev) => emitL(docListeners, ev.type, ev),
  };

  class MockMO {
    constructor(cb) { this.cb = cb; this.connected = false; this.target = null; this.opts = null; mos.push(this); }
    observe(t, o) { this.connected = true; this.target = t; this.opts = o || {}; }
    disconnect() { this.connected = false; }
    emit(recs) { if (this.connected) this.cb(recs); }
  }
  class MockRO {
    constructor(cb) { this.cb = cb; this.connected = true; ros.push(this); }
    observe() {}
    unobserve() {}
    disconnect() { this.connected = false; }
  }

  const location = {
    pathname: `/c/${initialCid}`,
    href: `https://antigravity.local/c/${initialCid}`,
    hash: '',
  };

  const origPushState = function pushState(_st, _title, url) {
    if (typeof url === 'string') {
      location.pathname = url.startsWith('http') ? new URL(url).pathname : url;
      location.href = url.startsWith('http') ? url : `https://antigravity.local${url}`;
    }
  };
  const origReplaceState = function replaceState(_st, _title, url) {
    if (typeof url === 'string') {
      location.pathname = url.startsWith('http') ? new URL(url).pathname : url;
      location.href = url.startsWith('http') ? url : `https://antigravity.local${url}`;
    }
  };

  const win = {
    document: doc,
    location,
    history: { pushState: origPushState, replaceState: origReplaceState },
    navigator: { language: 'zh-CN' },
    MutationObserver: MockMO,
    ResizeObserver: MockRO,
    requestAnimationFrame: (fn) => { fn(16); return 1; },
    cancelAnimationFrame() {},
    addEventListener: (t, fn) => addL(winListeners, t, fn),
    removeEventListener: (t, fn) => remL(winListeners, t, fn),
    dispatchEvent: (ev) => emitL(winListeners, ev.type, ev),
  };

  let bus = null;
  if (withDomBus) {
    bus = domBusMod.createInstance(doc, win);
    win.__agPrismDomBus = bus;
    win.__agDomBus = bus;
  }

  return {
    win, doc, html, body, convView, footer, location,
    origPushState, origReplaceState, mos, ros, bus,
    winListenerCount: (type) => (winListeners.get(type) || new Set()).size,
    docListenerCount: (type) => (docListeners.get(type) || new Set()).size,
  };
}

function makeSnap({ model = 'Gemini 4 Carbon', usedFraction = 0.25, tps = 58.4, groups = null } = {}) {
  const maxTokens = 512000;
  const usedTokens = Math.round(maxTokens * usedFraction);
  return {
    connection: 'live',
    speed: {
      model,
      tps,
      latestTps: tps,
      ttftSeconds: 0.65,
      cacheHitRate: 0.91,
      rounds: 3,
      context: { model, usedFraction, usedTokens, maxTokens, sampledAt: Date.now() },
    },
    groups: groups || [
      {
        id: 'gemini',
        name: 'Gemini',
        windows: {
          '5h': { available: true, remaining: 0.88, resetAt: Date.now() + 90 * 60 * 1000 },
          weekly: { available: true, remaining: 0.62, resetAt: Date.now() + 2 * 86400 * 1000 },
        },
      },
      {
        id: 'claude',
        name: 'Claude / GPT',
        windows: {
          '5h': { available: true, remaining: 0.30, resetAt: Date.now() + 50 * 60 * 1000 },
          weekly: { available: true, remaining: 0.12, resetAt: Date.now() + 4 * 86400 * 1000 },
        },
      },
    ],
  };
}

test('W5-1 (PR #115 + beta.4 cold-start): standalone chooseQuotaGroupFallback works without __agCsUsageCore, renders 5h/weekly chips, warns <=35%/<=15%, and opens context card', async () => {
  const groups = [
    {
      id: 'gemini-argon',
      name: 'Gemini (Argon)',
      windows: {
        '5h': { available: true, remaining: 0.77, resetAt: Date.now() + 3600 * 1000 },
        weekly: { available: true, remaining: 0.55, resetAt: Date.now() + 3 * 86400 * 1000 },
      },
    },
    {
      id: 'gemini',
      name: 'Gemini',
      windows: {
        '5h': { available: true, remaining: 0.91, resetAt: Date.now() + 2 * 3600 * 1000 },
        weekly: { available: true, remaining: 0.33, resetAt: Date.now() + 2 * 86400 * 1000 },
      },
    },
    {
      id: 'claude',
      name: 'Claude / GPT',
      windows: {
        '5h': { available: true, remaining: 0.14, resetAt: Date.now() + 1800 * 1000 },
        weekly: { available: false, reason: 'unavailable' },
      },
    },
  ];

  // Direct unit check on standalone fallback matcher (beta.4 Ch12 homeStudio unloaded)
  assert.equal(inlineMod.chooseQuotaGroupFallback(groups, 'Gemini 4 Argon')?.id, 'gemini-argon');
  assert.equal(inlineMod.chooseQuotaGroupFallback(groups, 'Gemini 4 Carbon (High)')?.id, 'gemini');
  assert.equal(inlineMod.chooseQuotaGroupFallback(groups, 'Claude Sonnet 5.5')?.id, 'claude');
  assert.equal(inlineMod.chooseQuotaGroupFallback(groups, 'GPT-5.2 Codex')?.id, 'claude');
  assert.equal(inlineMod.chooseQuotaGroupFallback(groups, 'Unknown Model')?.id, 'gemini-argon', 'unknown model falls back to first available quota group');

  const env = createSwitchMockEnv({ initialCid: CID_A });
  assert.equal(env.win.__agCsUsageCore, undefined, 'conversation cold start must have no __agCsUsageCore loaded');

  let activeModel = 'Gemini 4 Carbon';
  env.win.__agPrismMetricsCall = (payloadStr) => {
    const req = JSON.parse(payloadStr);
    env.win.__agPrismMetricsResolve?.(req.id, makeSnap({ model: activeModel, usedFraction: 0.42, groups }));
  };

  const ctrl = inlineMod.createTelemetryController({ window: env.win, document: env.doc });
  try {
    ctrl.sync({ telemetryModule: 'on', language: 'en' });
    await ctrl.refresh();

    const bar = env.doc.getElementById('ag-prism-pulse-bar');
    const sr = bar.shadowRoot;
    const fChip = sr.querySelector('[data-card="five"]');
    const wChip = sr.querySelector('[data-card="week"]');
    const sChip = sr.querySelector('[data-card="speed"]');
    const kids = sr.querySelector('.bar').children;

    assert.equal(kids[0], fChip, '5h chip must be leftmost in .bar');
    assert.equal(kids[1], wChip, 'weekly chip must sit second in .bar');
    assert.equal(kids[2], sChip, 'speed chip follows weekly chip');

    assert.equal(fChip.hidden, false);
    assert.equal(sr.getElementById('five-balance').textContent, '91%');
    assert.equal(fChip.getAttribute('data-warn'), null);
    assert.ok((fChip.getAttribute('title') || '').includes('Gemini · 5h 91%'));

    assert.equal(wChip.hidden, false);
    assert.equal(sr.getElementById('week-balance').textContent, '33%');
    assert.equal(wChip.getAttribute('data-warn'), '1', '<=35% must set data-warn="1"');
    assert.ok((wChip.getAttribute('title') || '').includes('Wk 33%'));

    // Click 5h chip -> opens #context-card
    const xCard = sr.getElementById('context-card');
    assert.equal(xCard.hidden, true);
    fChip.dispatchEvent({ type: 'click' });
    assert.equal(xCard.hidden, false);
    assert.equal(fChip.getAttribute('aria-expanded'), 'true');
    assert.equal(wChip.getAttribute('aria-expanded'), 'false');

    // Switch to Claude without __agCsUsageCore -> critical 14% warn="2", unavailable weekly hidden
    activeModel = 'Claude Opus 5.5';
    await ctrl.refresh();
    assert.equal(sr.getElementById('five-balance').textContent, '14%');
    assert.equal(fChip.getAttribute('data-warn'), '2', '<=15% must set data-warn="2"');
    assert.equal(wChip.hidden, true);

    // When __agCsUsageCore IS loaded later, delegate to it first
    let usageCoreCalls = 0;
    env.win.__agCsUsageCore = {
      chooseQuotaGroup(gs, m) {
        usageCoreCalls += 1;
        return gs.find((g) => g.id === 'gemini-argon');
      },
    };
    await ctrl.refresh();
    assert.ok(usageCoreCalls >= 1, 'must prefer __agCsUsageCore.chooseQuotaGroup when available');
    assert.equal(sr.getElementById('five-balance').textContent, '77%');
  } finally {
    ctrl.destroy();
  }
});

test('W5-2 (Zero-latency switch): A -> B shows cached B in 0ms, bypasses 4s poll via ~30ms single-flight refresh, drops stale A reply, and cleans up 100% on destroy()', async () => {
  const env = createSwitchMockEnv({ initialCid: CID_A });
  const rpcCalls = [];
  const deferredByCid = new Map();
  const bridgeEvents = [];
  env.win.__agPulseExternalBridge = (ev) => bridgeEvents.push(ev);

  const serverSnaps = new Map([
    [CID_A, makeSnap({ model: 'Gemini 4 Carbon', usedFraction: 0.22, tps: 44.0 })],
    [CID_B, makeSnap({ model: 'Claude Opus 5.5', usedFraction: 0.74, tps: 71.5 })],
    [CID_C, makeSnap({ model: 'Gemini 4 Hydrogen', usedFraction: 0.51, tps: 120.0 })],
  ]);

  let deferCids = new Set();
  env.win.__agPrismMetricsCall = (payloadStr) => {
    const req = JSON.parse(payloadStr);
    const cid = req.input?.conversationId || null;
    rpcCalls.push({ id: req.id, cid, at: Date.now() });
    if (deferCids.has(cid)) {
      deferredByCid.set(cid, {
        id: req.id,
        resolveWith: (snap) => env.win.__agPrismMetricsResolve?.(req.id, snap),
      });
      return;
    }
    env.win.__agPrismMetricsResolve?.(req.id, serverSnaps.get(cid) || makeSnap());
  };

  const ctrl = inlineMod.createTelemetryController({ window: env.win, document: env.doc });
  try {
    // 1) Warm LRU cache for CID_A (22%) and CID_B (74%), then settle back on CID_A
    ctrl.sync({ telemetryModule: 'on', language: 'zh-CN' });
    await ctrl.refresh();
    const sr = env.doc.getElementById('ag-prism-pulse-bar').shadowRoot;
    assert.equal(sr.getElementById('context-percent').textContent, '22%');

    env.convView.setAttribute('data-cascade-id', CID_B);
    env.win.history.pushState({}, '', `/c/${CID_B}`);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(sr.getElementById('context-percent').textContent, '74%');
    assert.equal(sr.getElementById('context-model').textContent, 'Claude Opus 5.5');

    // Return to CID_A
    env.convView.setAttribute('data-cascade-id', CID_A);
    env.win.history.pushState({}, '', `/c/${CID_A}`);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(sr.getElementById('context-percent').textContent, '22%');

    // 2) Switch A -> B with fresh backend value (81%): must show cached 74% at 0ms synchronously,
    //    then auto-refresh to 81% in <120ms (never waiting 4000ms poll!)
    serverSnaps.set(CID_B, makeSnap({ model: 'Claude Opus 5.5', usedFraction: 0.81, tps: 88.2 }));
    const callsBeforeSwitch = rpcCalls.length;
    const t0 = Date.now();
    bridgeEvents.length = 0;

    env.convView.setAttribute('data-cascade-id', CID_B);
    env.win.history.pushState({}, '', `/c/${CID_B}`);

    // SYNCHRONOUS 0ms assertion — zero await, zero timer wait!
    assert.equal(sr.getElementById('context-percent').textContent, '74%', '0ms LRU instant render must display cached B (74%) immediately');
    assert.equal(sr.getElementById('context-model').textContent, 'Claude Opus 5.5', '0ms LRU instant render must display B model');
    assert.ok(
      bridgeEvents.some((e) => e.event === 'render' && e.conversationId === CID_B),
      '0ms instant render must also notify pulse-vial-bridge immediately'
    );

    // Wait ~70ms (well under 4000ms poll): debounced single-flight refresh must land fresh 81%
    await new Promise((r) => setTimeout(r, 90));
    const bCalls = rpcCalls.slice(callsBeforeSwitch).filter((c) => c.cid === CID_B);
    assert.equal(bCalls.length, 1, '30ms debounced single-flight switch must issue exactly 1 RPC for CID_B');
    assert.ok(bCalls[0].at - t0 < 250, 'switch refresh must bypass 4000ms poll interval');
    assert.equal(sr.getElementById('context-percent').textContent, '81%', 'fresh B telemetry must update UI');

    // 3) Rapid A -> B -> C burst within 30ms debounce coalesces to C only
    const callsBeforeBurst = rpcCalls.length;
    env.convView.setAttribute('data-cascade-id', CID_A);
    env.win.history.pushState({}, '', `/c/${CID_A}`);
    assert.equal(sr.getElementById('context-percent').textContent, '22%', 'rapid switch to A still shows A LRU at 0ms');
    env.convView.setAttribute('data-cascade-id', CID_B);
    env.win.history.pushState({}, '', `/c/${CID_B}`);
    assert.equal(sr.getElementById('context-percent').textContent, '81%', 'rapid switch to B still shows updated B LRU at 0ms');
    env.convView.setAttribute('data-cascade-id', CID_C);
    env.win.history.pushState({}, '', `/c/${CID_C}`);
    await new Promise((r) => setTimeout(r, 90));
    const burstCalls = rpcCalls.slice(callsBeforeBurst);
    assert.equal(burstCalls.length, 1, 'rapid A->B->C switch burst must coalesce into a single RPC');
    assert.equal(burstCalls[0].cid, CID_C, 'coalesced RPC must target final conversation C');
    assert.equal(sr.getElementById('context-percent').textContent, '51%');

    // 4) Stale in-flight reply protection: slow CID_A reply arrives AFTER user switched to CID_B
    deferCids = new Set([CID_A]);
    env.convView.setAttribute('data-cascade-id', CID_A);
    env.win.history.pushState({}, '', `/c/${CID_A}`);
    const inflightA = ctrl.refresh({ immediate: true, cascadeId: CID_A });
    assert.ok(deferredByCid.has(CID_A), 'CID_A request must be in-flight');

    // User immediately switches to CID_B while CID_A is still pending
    serverSnaps.set(CID_B, makeSnap({ model: 'Claude Opus 5.5', usedFraction: 0.68, tps: 65.0 }));
    env.convView.setAttribute('data-cascade-id', CID_B);
    env.win.history.pushState({}, '', `/c/${CID_B}`);
    await new Promise((r) => setTimeout(r, 90));
    assert.equal(sr.getElementById('context-percent').textContent, '68%');

    // Now the stale CID_A response (93%) finally resolves -> MUST NOT overwrite B's UI (68%)!
    deferredByCid.get(CID_A).resolveWith(makeSnap({ model: 'Gemini 4 Carbon', usedFraction: 0.93, tps: 31.0 }));
    await inflightA;
    assert.equal(sr.getElementById('context-percent').textContent, '68%', 'stale CID_A response must be dropped and never clobber CID_B UI');
    assert.equal(sr.getElementById('context-model').textContent, 'Claude Opus 5.5');
    assert.equal(ctrl.getLatestSnapshot()?.speed?.context?.usedFraction, 0.68, 'lastSnap must stay on active CID_B');

    // Yet when user later switches back to CID_A, cached fresh 93% is available at 0ms!
    deferCids.clear();
    env.convView.setAttribute('data-cascade-id', CID_A);
    env.win.history.pushState({}, '', `/c/${CID_A}`);
    assert.equal(sr.getElementById('context-percent').textContent, '93%', 'silently cached stale A reply is ready at 0ms when returning to A');
  } finally {
    ctrl.destroy();
  }

  // 5) destroy() 100% cleanup: history restored, listeners removed, observers disconnected, caches cleared
  assert.equal(env.win.history.pushState, env.origPushState, 'destroy() must restore original history.pushState');
  assert.equal(env.win.history.replaceState, env.origReplaceState, 'destroy() must restore original history.replaceState');
  assert.equal(env.winListenerCount('popstate'), 0, 'destroy() must remove popstate listener');
  assert.equal(env.winListenerCount('hashchange'), 0, 'destroy() must remove hashchange listener');
  assert.equal(env.winListenerCount('resize'), 0, 'destroy() must remove resize listener');
  assert.equal(env.winListenerCount('blur'), 0, 'destroy() must remove blur listener');
  assert.equal(env.winListenerCount('focus'), 0, 'destroy() must remove focus listener');
  assert.equal(env.docListenerCount('click'), 0, 'destroy() must remove document click listener');
  assert.equal(env.docListenerCount('visibilitychange'), 0, 'destroy() must remove visibilitychange listener');
  assert.ok(env.mos.every((m) => !m.connected), 'destroy() must disconnect all MutationObservers');
  assert.ok(env.ros.every((r) => !r.connected), 'destroy() must disconnect all ResizeObservers');
  assert.equal(env.win.__agPrismMetricsBridge, undefined);
  assert.equal(env.win.__agPrismMetricsResolve, undefined);
  assert.equal(ctrl.getLatestSnapshot(), null);
});

test('W5-3 (domBus attribute switch + LRU 32 cap): detects data-cascade-id mutation via domBus and evicts oldest entries past 32', async () => {
  const env = createSwitchMockEnv({ initialCid: CID_A, withDomBus: true });
  const snapMap = new Map();
  env.win.__agPrismMetricsCall = (payloadStr) => {
    const req = JSON.parse(payloadStr);
    const cid = req.input?.conversationId;
    env.win.__agPrismMetricsResolve?.(req.id, snapMap.get(cid) || makeSnap({ usedFraction: 0.15 }));
  };

  const ctrl = inlineMod.createTelemetryController({ window: env.win, document: env.doc });
  try {
    snapMap.set(CID_A, makeSnap({ usedFraction: 0.19, model: 'Gemini 4 Carbon' }));
    snapMap.set(CID_B, makeSnap({ usedFraction: 0.63, model: 'Claude Sonnet 5.5' }));
    ctrl.sync({ telemetryModule: 'on', language: 'zh-CN' });
    await ctrl.refresh();

    // Pre-populate CID_B into cache via immediate refresh
    await ctrl.refresh({ immediate: true, cascadeId: CID_B });
    await ctrl.refresh({ immediate: true, cascadeId: CID_A });
    const sr = env.doc.getElementById('ag-prism-pulse-bar').shadowRoot;
    assert.equal(sr.getElementById('context-percent').textContent, '19%');

    // Simulate React in-place data-cascade-id mutation without URL change, notified via domBus
    snapMap.set(CID_B, makeSnap({ usedFraction: 0.66, model: 'Claude Sonnet 5.5' }));
    env.convView.setAttribute('data-cascade-id', CID_B);
    for (const mo of env.mos) {
      if (mo.connected) mo.emit([{ type: 'attributes', target: env.convView, attributeName: 'data-cascade-id' }]);
    }
    assert.equal(sr.getElementById('context-percent').textContent, '63%', 'domBus attribute change must 0ms render cached CID_B');
    await new Promise((r) => setTimeout(r, 90));
    assert.equal(sr.getElementById('context-percent').textContent, '66%', 'domBus switch must follow up with debounced live refresh');

    // Verify LRU 32 cap: insert 35 distinct cascadeIds -> oldest 3 evicted, newest 32 retained
    const ids = [];
    for (let i = 0; i < 35; i++) {
      const hex = i.toString(16).padStart(12, '0');
      const cid = `00000000-0000-4000-8000-${hex}`;
      ids.push(cid);
      snapMap.set(cid, makeSnap({ usedFraction: (i + 1) / 100 }));
      env.convView.setAttribute('data-cascade-id', cid);
      await ctrl.refresh({ immediate: true, cascadeId: cid });
    }
    // Oldest entry (ids[0]) must have been evicted (falls back to lastSnap = ids[34], NOT 0.01)
    assert.notEqual(ctrl.getSnapshotForBar(ids[0])?.speed?.context?.usedFraction, 0.01, 'LRU cap 32 must evict oldest entry');
    // Entry 3 (32nd from end) and entry 34 (newest) must still be retained
    assert.equal(ctrl.getSnapshotForBar(ids[3])?.speed?.context?.usedFraction, 0.04, '32nd newest entry must remain in LRU');
    assert.equal(ctrl.getSnapshotForBar(ids[34])?.speed?.context?.usedFraction, 0.35, 'newest entry must remain in LRU');
  } finally {
    ctrl.destroy();
    env.bus?.dispose?.();
  }
});

test('W5-4 (Issue #110 i18n): periodic-picker 8-locale tierNonPlanner & unrelNonPlanner clearly guide unlocking #0 Orch with 0 CJK leaks in non-CJK locales', () => {
  const pickerSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'periodic-picker', 'periodic-picker.js'), 'utf8');
  const startIdx = pickerSrc.indexOf('var PP_I18N = {');
  assert.ok(startIdx >= 0, 'PP_I18N dictionary must exist in periodic-picker.js');
  const endIdx = pickerSrc.indexOf('function getPpI18nPack', startIdx);
  assert.ok(endIdx > startIdx);
  const block = pickerSrc.slice(startIdx, endIdx);
  const PP_I18N = new Function(`${block}; return PP_I18N;`)();

  const CANONICAL_9 = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'tr'];
  const NON_CJK = new Set(['en', 'ko', 'es', 'fr', 'de', 'tr']);
  const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;

  for (const loc of CANONICAL_9) {
    const pack = PP_I18N[loc];
    assert.ok(pack, `PP_I18N missing locale ${loc}`);
    for (const key of ['tierNonPlanner', 'unrelNonPlanner']) {
      const val = pack[key];
      assert.equal(typeof val, 'string');
      assert.ok(val.includes('#0'), `PP_I18N[${loc}].${key} must mention #0 unlock hint (got "${val}")`);
      assert.ok(/orch/i.test(val), `PP_I18N[${loc}].${key} must mention Orch (got "${val}")`);
      assert.equal(/NON-PLANNER/i.test(val), false, `PP_I18N[${loc}].${key} should replace cryptic NON-PLANNER label (got "${val}")`);
      if (NON_CJK.has(loc)) {
        assert.equal(CJK_RE.test(val), false, `PP_I18N[${loc}].${key} must have 0 CJK chars (got "${val}")`);
      }
    }
  }
});
