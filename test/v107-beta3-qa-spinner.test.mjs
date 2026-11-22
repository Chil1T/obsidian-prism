import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const cdp = require(path.join(ROOT, 'cdp.js'));

function createMiniDom({ hasLayout = false } = {}) {
  const makeEl = (tag, opts = {}) => {
    const attrs = new Map(Object.entries(opts.attrs || {}));
    if (opts.id) attrs.set('id', opts.id);
    if (opts.className) attrs.set('class', opts.className);
    const styles = new Map();
    const children = [];
    const node = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      parentElement: null,
      children,
      childNodes: children,
      _text: opts.text || '',
      _rect: opts.rect || null,
      _offsetHeight: opts.offsetHeight,
      _checkVis: opts.checkVisibility,
      get id() { return attrs.get('id') || ''; },
      set id(v) { attrs.set('id', String(v)); },
      get className() { return attrs.get('class') || ''; },
      set className(v) { attrs.set('class', String(v)); },
      get hidden() { return attrs.has('hidden'); },
      set hidden(v) { if (v) attrs.set('hidden', ''); else attrs.delete('hidden'); },
      get childElementCount() { return children.length; },
      get firstElementChild() { return children[0] || null; },
      get offsetHeight() {
        if (typeof this._offsetHeight === 'number') return this._offsetHeight;
        if (this._rect) return this._rect.height;
        return hasLayout ? 40 : 0;
      },
      get textContent() {
        return this._text + children.map((c) => c.textContent).join('');
      },
      set textContent(v) {
        this._text = String(v);
        children.length = 0;
      },
      get isConnected() {
        let cur = this;
        while (cur) {
          if (cur === html) return true;
          cur = cur.parentElement;
        }
        return false;
      },
      classList: {
        contains: (c) => (attrs.get('class') || '').split(/\s+/).filter(Boolean).includes(c),
        add: (...cs) => {
          const set = new Set((attrs.get('class') || '').split(/\s+/).filter(Boolean));
          cs.forEach((c) => set.add(c));
          attrs.set('class', [...set].join(' '));
        },
        remove: (...cs) => {
          const set = new Set((attrs.get('class') || '').split(/\s+/).filter(Boolean));
          cs.forEach((c) => set.delete(c));
          attrs.set('class', [...set].join(' '));
        },
      },
      style: {
        get display() { return styles.get('display') || ''; },
        set display(v) { if (v) styles.set('display', String(v)); else styles.delete('display'); },
        get visibility() { return styles.get('visibility') || ''; },
        set visibility(v) { if (v) styles.set('visibility', String(v)); else styles.delete('visibility'); },
        setProperty(k, v) { styles.set(String(k), String(v)); },
        getPropertyValue(k) { return styles.get(String(k)) || ''; },
        removeProperty(k) { styles.delete(String(k)); },
      },
      getBoundingClientRect() {
        if (this._rect) return { left: 0, top: 0, width: 320, height: 40, ...this._rect };
        if (hasLayout) return { left: 0, top: 0, width: 320, height: 40, right: 320, bottom: 40 };
        return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
      },
      checkVisibility() {
        if (typeof this._checkVis === 'function') return this._checkVis();
        if (typeof this._checkVis === 'boolean') return this._checkVis;
        return !this.hidden && styles.get('display') !== 'none' && styles.get('visibility') !== 'hidden';
      },
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      setAttribute: (k, v) => attrs.set(k, String(v)),
      hasAttribute: (k) => attrs.has(k),
      removeAttribute: (k) => attrs.delete(k),
      appendChild(child) {
        if (child.parentElement) child.remove();
        child.parentElement = this;
        children.push(child);
        return child;
      },
      insertBefore(child, ref) {
        if (child.parentElement) child.remove();
        child.parentElement = this;
        const idx = children.indexOf(ref);
        if (idx >= 0) children.splice(idx, 0, child);
        else children.push(child);
        return child;
      },
      remove() {
        if (!this.parentElement) return;
        const arr = this.parentElement.children;
        const idx = arr.indexOf(this);
        if (idx >= 0) arr.splice(idx, 1);
        this.parentElement = null;
      },
      matches(sel) {
        return String(sel).split(',').map((s) => s.trim()).filter(Boolean).some((s) => {
          const parts = s.trim().split(/\s+/);
          const leaf = parts[parts.length - 1];
          if (leaf.startsWith('#')) return this.id === leaf.slice(1).replace(/\\/g, '');
          if (leaf.startsWith('.')) return this.classList.contains(leaf.slice(1));
          const am = leaf.match(/^([a-zA-Z0-9_-]*)\[([^=\]]+)(?:="([^"]*)")?\]$/);
          if (am) {
            if (am[1] && this.tagName !== am[1].toUpperCase()) return false;
            if (am[3] !== undefined) return this.getAttribute(am[2]) === am[3];
            return this.hasAttribute(am[2]);
          }
          return this.tagName === leaf.toUpperCase();
        });
      },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (cur.matches(sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.children) {
            if (c.matches(sel)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
      },
      addEventListener() {},
      removeEventListener() {},
    };
    return node;
  };

  const html = makeEl('html');
  const head = makeEl('head');
  const body = makeEl('body', { className: 'theme-dark' });
  html.appendChild(head);
  html.appendChild(body);

  const observers = [];
  const rafQueue = [];
  const timers = new Set();

  const doc = {
    documentElement: html,
    head,
    body,
    hidden: false,
    readyState: 'complete',
    createElement: (t) => makeEl(t),
    getElementById: (id) => {
      const find = (n) => (n.id === id ? n : n.children.map(find).find(Boolean) || null);
      return find(html);
    },
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener() {},
    removeEventListener() {},
  };

  const sandbox = {
    window: null,
    globalThis: null,
    document: doc,
    navigator: { language: 'zh-CN' },
    location: { pathname: '/' },
    localStorage: {
      _m: {},
      getItem(k) { return this._m[k] || null; },
      setItem(k, v) { this._m[k] = String(v); },
      removeItem(k) { delete this._m[k]; },
    },
    getComputedStyle: (el) => ({
      display: el?.style?.display || '',
      visibility: el?.style?.visibility || '',
      getPropertyValue: (k) => el?.style?.getPropertyValue?.(k) || '',
    }),
    matchMedia: () => ({ matches: false }),
    MutationObserver: class {
      constructor(cb) { this.cb = cb; this.opts = null; observers.push(this); }
      observe(_t, opts) { this.opts = opts; }
      disconnect() {}
      takeRecords() { return []; }
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
    cancelAnimationFrame: () => {},
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.add(id); return id; },
    clearTimeout: (id) => { timers.delete(id); clearTimeout(id); },
    setInterval: () => 1,
    clearInterval: () => {},
    performance: { now: () => Date.now() },
    Math, Date, JSON, Map, Set, Array, Object, String, Number, Boolean, Promise, Uint8Array, Float32Array, Intl,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const flushRaf = () => {
    while (rafQueue.length) {
      const fn = rafQueue.shift();
      fn(Date.now());
    }
  };
  const cleanupTimers = () => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };

  return { makeEl, html, head, body, doc, sandbox, observers, flushRaf, cleanupTimers };
}

test('Task 1: syncCrabClearance ignores hidden/collapsed/zero-height/decor beforeShell nodes and keeps ask_question takeover card raised & unoccluded', () => {
  const { makeEl, html, body, sandbox, observers, flushRaf, cleanupTimers } = createMiniDom({ hasLayout: true });

  const convView = makeEl('div', { attrs: { 'data-testid': 'conversation-view' } });
  const rtcWrap = makeEl('div', { className: 'relative z-10 flex flex-col gap-1 min-h-0' });
  const takeoverWrap = makeEl('div', { className: 'relative z-[1] mb-1 flex flex-col min-h-0' });
  const takeoverCard = makeEl('div', { className: 'agy-takeover-frame', attrs: { 'data-testid': 'interaction-takeover-card' } });
  takeoverWrap.appendChild(takeoverCard);

  const contentsWrap = makeEl('div', { className: 'contents' });
  const inputBox = makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } });

  // Various false-positive lower clearance nodes before composerShell
  const emptyShellWrap = makeEl('div', { className: 'flex flex-col' });
  emptyShellWrap.appendChild(makeEl('div', { rect: { height: 0, width: 320 } }));

  const hiddenWrap = makeEl('div');
  const hiddenChild = makeEl('div', { text: 'stale hidden banner' });
  hiddenChild.hidden = true;
  hiddenWrap.appendChild(hiddenChild);

  const ariaHiddenWrap = makeEl('div', { attrs: { 'aria-hidden': 'true' }, text: 'sr status' });
  const dispNoneWrap = makeEl('div', { text: 'display none' });
  dispNoneWrap.style.display = 'none';

  const collapsedWrap = makeEl('div', { className: 'grid grid-rows-[0fr]' });
  collapsedWrap.appendChild(makeEl('div', { text: 'collapsed drawer text' }));

  const prismDecorWrap = makeEl('div', { className: 'ag-cs-prism-rim-cv', text: 'decor' });
  const zeroHeightWrap = makeEl('div', { text: 'zero height css box', rect: { height: 0, width: 320 }, offsetHeight: 0 });

  const composerShell = makeEl('div', { id: 'antigravity.agentSidePanelInputBox', className: 'surface-composer' });
  const card = makeEl('div', { className: 'surface-composer-card', rect: { height: 96, width: 640 }, offsetHeight: 96 });
  card.appendChild(makeEl('div', { className: 'agy-composer-footer' }));
  composerShell.appendChild(card);

  for (const n of [emptyShellWrap, hiddenWrap, ariaHiddenWrap, dispNoneWrap, collapsedWrap, prismDecorWrap, zeroHeightWrap, composerShell]) {
    inputBox.appendChild(n);
  }
  contentsWrap.appendChild(inputBox);
  rtcWrap.appendChild(takeoverWrap);
  rtcWrap.appendChild(contentsWrap);
  convView.appendChild(rtcWrap);

  // Also mount a subagent tab with its own composer & takeover card (must never steal or clear primary takeover)
  const subTab = makeEl('div', { attrs: { 'data-testid': 'subagent-tab-conversation' } });
  const subTakeover = makeEl('div', { attrs: { 'data-testid': 'interaction-takeover-card' } });
  const subInputBox = makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } });
  const subCard = makeEl('div', { className: 'surface-composer-card', rect: { height: 80, width: 400 }, offsetHeight: 80 });
  subInputBox.appendChild(subCard);
  subTab.appendChild(subTakeover);
  subTab.appendChild(subInputBox);
  body.appendChild(convView);
  body.appendChild(subTab);

  try {
    const res = vm.runInNewContext(cdp.buildInjectExpression(cdp.DEFAULT_CONFIG), sandbox);
    assert.equal(res.status, 'ok');

    // None of the hidden/empty/collapsed/zero-height/decor nodes may steal data-ag-cs-queued
    for (const fake of [emptyShellWrap, hiddenWrap, ariaHiddenWrap, dispNoneWrap, collapsedWrap, prismDecorWrap, zeroHeightWrap]) {
      assert.equal(fake.hasAttribute('data-ag-cs-queued'), false, 'Non-visible/decor beforeShell node must not steal lower clearance');
    }

    // Primary takeover card wrapper gets clearance and html marks takeover-open so mascot yields z-index & pointer-events
    assert.equal(takeoverWrap.getAttribute('data-ag-cs-takeover'), '1');
    assert.equal(takeoverWrap.style.getPropertyValue('margin-bottom'), '46px');
    assert.equal(html.getAttribute('data-ag-cs-takeover-open'), '1');

    // Subagent tab takeover card stays completely untouched
    assert.equal(subTakeover.hasAttribute('data-ag-cs-takeover'), false);

    // Chat mode cleanly strips both data-ag-cs-takeover and html[data-ag-cs-takeover-open]
    const mainMo = observers.find((o) => Array.isArray(o.opts?.attributeFilter) && o.opts.attributeFilter.includes('data-ag-prism-mode'));
    assert.ok(mainMo, 'Main MutationObserver must be registered');
    html.setAttribute('data-ag-prism-mode', 'chat');
    mainMo.cb([{ type: 'attributes', target: html, attributeName: 'data-ag-prism-mode' }]);
    flushRaf();
    assert.equal(takeoverWrap.hasAttribute('data-ag-cs-takeover'), false);
    assert.equal(html.hasAttribute('data-ag-cs-takeover-open'), false);

    // Returning to code mode restores clearance & takeover-open
    html.setAttribute('data-ag-prism-mode', 'code');
    mainMo.cb([{ type: 'attributes', target: html, attributeName: 'data-ag-prism-mode' }]);
    flushRaf();
    assert.equal(takeoverWrap.getAttribute('data-ag-cs-takeover'), '1');
    assert.equal(html.getAttribute('data-ag-cs-takeover-open'), '1');

    // Hiding takeoverCard via class="hidden" triggers MO attribute sync and clears takeover-open cleanly
    takeoverCard.classList.add('hidden');
    mainMo.cb([{ type: 'attributes', target: takeoverCard, attributeName: 'class' }]);
    flushRaf();
    assert.equal(takeoverWrap.hasAttribute('data-ag-cs-takeover'), false);
    assert.equal(html.hasAttribute('data-ag-cs-takeover-open'), false);

    // Unhiding restores it
    takeoverCard.classList.remove('hidden');
    mainMo.cb([{ type: 'attributes', target: takeoverCard, attributeName: 'class' }]);
    flushRaf();
    assert.equal(takeoverWrap.getAttribute('data-ag-cs-takeover'), '1');
    assert.equal(html.getAttribute('data-ag-cs-takeover-open'), '1');

    // REMOVE_EXPRESSION strips takeover attributes cleanly
    vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
    assert.equal(takeoverWrap.hasAttribute('data-ag-cs-takeover'), false);
    assert.equal(takeoverWrap.style.getPropertyValue('margin-bottom'), '');
    assert.equal(html.hasAttribute('data-ag-cs-takeover-open'), false);
  } finally {
    cleanupTimers();
  }
});

test('Task 1 fallback: v2.34 non-sibling interaction-takeover-card inside outer flex-col gets direct 52px clearance on delayed mount (layout-less fake DOM)', () => {
  const { makeEl, html, body, sandbox, observers, flushRaf, cleanupTimers } = createMiniDom({ hasLayout: false });

  const convView = makeEl('div', { attrs: { 'data-testid': 'conversation-view' } });
  // v2.34 layout where interaction-takeover-card sits in an outer flex-col, NOT a direct sibling of inputBox's wrapper
  const outerCol = makeEl('div', { className: 'flex flex-col w-full gap-2 min-h-0' });
  const inputOuter = makeEl('div', { className: 'w-full' }); // NOT .contents!
  const inputBox = makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } });
  const composerShell = makeEl('div', { id: 'antigravity.agentSidePanelInputBox', className: 'surface-composer' });
  const card = makeEl('div', { className: 'surface-composer-card' });
  card.appendChild(makeEl('div', { className: 'agy-composer-footer' }));
  composerShell.appendChild(card);
  inputBox.appendChild(composerShell);
  inputOuter.appendChild(inputBox);
  outerCol.appendChild(inputOuter);
  convView.appendChild(outerCol);
  body.appendChild(convView);

  try {
    const res = vm.runInNewContext(cdp.buildInjectExpression(cdp.DEFAULT_CONFIG), sandbox);
    assert.equal(res.status, 'ok');
    assert.equal(html.hasAttribute('data-ag-cs-takeover-open'), false);

    // Delayed mount of interaction-takeover-card directly inside outerCol (shared with inputOuter, so target is card itself -> 52px!)
    const mainMo = observers.find((o) => Array.isArray(o.opts?.attributeFilter) && o.opts.attributeFilter.includes('data-cascade-id'));
    assert.ok(mainMo);
    const directTakeover = makeEl('div', { className: 'agy-takeover-frame', attrs: { 'data-testid': 'interaction-takeover-card' } });
    outerCol.insertBefore(directTakeover, inputOuter);
    mainMo.cb([{ type: 'childList', target: outerCol, addedNodes: [directTakeover], removedNodes: [] }]);
    flushRaf();

    assert.equal(directTakeover.getAttribute('data-ag-cs-takeover'), '1');
    assert.equal(directTakeover.style.getPropertyValue('margin-bottom'), '52px');
    assert.equal(outerCol.hasAttribute('data-ag-cs-takeover'), false, 'Shared parent containing agent-input-box must NEVER receive takeover clearance');
    assert.equal(html.getAttribute('data-ag-cs-takeover-open'), '1');

    // Removing the card clears html[data-ag-cs-takeover-open]
    directTakeover.remove();
    mainMo.cb([{ type: 'childList', target: outerCol, addedNodes: [], removedNodes: [directTakeover] }]);
    flushRaf();
    assert.equal(html.hasAttribute('data-ag-cs-takeover-open'), false);
  } finally {
    cleanupTimers();
  }
});

test('Task 2, 3, 4 & Invariants: Q&A selected contrast (.bg-secondary.border-border), subagent-only spinner dash, orbital dead-CSS cleanup, flattener & < 685KB budget', () => {
  const cssPath = path.join(ROOT, 'style.css');
  const uiPath = path.join(ROOT, 'ui-runtime.js');
  const cssBuf = fs.readFileSync(cssPath);
  const uiBuf = fs.readFileSync(uiPath);
  const css = cssBuf.toString('utf8');
  const ui = uiBuf.toString('utf8');

  // ── Global invariants ────────────────────────────────────────────────
  assert.equal((css.match(/:has\(/g) || []).length, 0, 'style.css must have zero :has() selectors');
  assert.equal([...css].filter((ch) => ch.charCodeAt(0) > 127).length, 0, 'style.css must be pure ASCII');
  let depth = 0;
  for (const ch of css) {
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      assert.ok(depth >= 0, 'style.css braces must never underflow');
    }
  }
  assert.equal(depth, 0, 'style.css braces must be completely balanced');
  assert.equal(cssBuf.includes(13), false, 'style.css must be pure LF');
  assert.equal(uiBuf.includes(13), false, 'ui-runtime.js must be pure LF');
  assert.equal(cssBuf[0] === 0xef && cssBuf[1] === 0xbb && cssBuf[2] === 0xbf, false, 'style.css must have no UTF-8 BOM');
  assert.equal(uiBuf[0] === 0xef && uiBuf[1] === 0xbb && uiBuf[2] === 0xbf, false, 'ui-runtime.js must have no UTF-8 BOM');

  const channel1 = cdp.buildInjectExpression(cdp.DEFAULT_CONFIG);
  const channel1Bytes = Buffer.byteLength(channel1, 'utf8');
  assert.ok(channel1Bytes < 685000, `Channel 1 bundle (${channel1Bytes} B) must stay strictly < 685,000 B`);

  // ── Task 1 CSS stacking & clearance contracts ────────────────────────
  assert.ok(
    css.includes('html[data-ag-cs-takeover-open="1"] .ag-cs-crab{z-index:8 !important;') &&
      css.includes('pointer-events:none !important;'),
    'Active takeover must drop mascot stage z-index to 8 (< interaction-takeover-card z-index 12) and neutralize pointer-events'
  );
  assert.equal(
    css.includes('[data-ag-cs-takeover="1"]){padding-bottom:14px !important;}'),
    false,
    'Takeover rule must not set conflicting padding-bottom:14px overridden by padding:0'
  );
  assert.ok(
    css.includes('& [data-ag-cs-takeover="1"] [data-testid="interaction-takeover-card"]{margin-bottom:6px !important;}') &&
      css.includes('& [data-testid="interaction-takeover-card"][data-ag-cs-takeover="1"]{margin-bottom:52px !important;}'),
    'Takeover card must receive 52px net bottom clearance in both wrapper and direct modes'
  );

  // ── Task 2: Q&A option selected state contrast (dark + light + write-in) ──
  const qaLines = css.split('\n').filter((l) => l.includes('[data-testid="ask-question-option"]'));
  assert.equal(qaLines.length, 2, 'style.css must have exactly 2 ask-question-option rules (dark base + light override)');
  const [darkQa, lightQa] = qaLines;
  assert.equal(css.includes('.agy-takeover-card [data-testid="ask-question-option"]'), false, 'Must preserve .agy-takeover-card liner contract');
  assert.ok(darkQa.includes('label[for$="-__write_in__"]'), 'Dark Q&A rule must style write-in label selection as well');
  assert.ok(lightQa.includes('label[for$="-__write_in__"]'), 'Light Q&A rule must override write-in label tokens as well');
  assert.ok(
    darkQa.includes('&:is(.bg-secondary.border-border,[aria-selected="true"],[aria-checked="true"],[data-selected="true"],[data-pressed])'),
    'Selected Q&A selector must match Antigravity v2.34 .bg-secondary.border-border along with ARIA/data attributes'
  );
  assert.ok(darkQa.includes('width:2.5px'), 'Selected Q&A option must render a prominent 2.5px glowing left indicator bar');
  assert.ok(darkQa.includes('[data-testid$="-shortcut-badge"]'), 'Q&A rule must highlight shortcut badge on selected options');
  assert.ok(darkQa.includes('[data-testid="ask-question-option-text"]'), 'Q&A rule must brighten selected option text vs dimmed unselected text');
  assert.ok(darkQa.includes('var(--primary,#669DF6)') && lightQa.includes('var(--primary,#2563EB)'), 'Q&A selected tokens must adapt to accent / --primary in dark & light themes');

  // ── Task 3: Subagent-only running spinner dash (primary stays 4x4 dot) ──
  const baseSpinnerLine = css.split('\n').find((l) => l.startsWith('html[data-ag-cs-style] [data-testid="status-loading-spinner"]{')) || '';
  assert.ok(
    baseSpinnerLine.includes('width:4px !important;height:4px !important;min-width:4px !important;min-height:4px !important;margin:0 !important;border-radius:999px !important;'),
    'Primary status-loading-spinner must keep its 4px x 4px glowing center dot untouched'
  );
  const subSpinnerLine =
    css.split('\n').find((l) => l.includes('[data-testid="subagent-node"]') && l.includes('[data-agent-state-dot]:first-child')) || '';
  assert.ok(subSpinnerLine, 'Must define dedicated subagent-only spinner core dash rule');
  assert.ok(
    subSpinnerLine.includes('[data-testid="subagent-node"]') &&
      subSpinnerLine.includes('[data-testid="running-row"]') &&
      subSpinnerLine.includes('[data-testid="background-task-row"]') &&
      subSpinnerLine.includes('[data-ag-sub-running="1"]'),
    'Subagent spinner dash rule must match subagent-node, running-row, background-task-row, and data-ag-sub-running="1"'
  );
  assert.ok(
    subSpinnerLine.includes('width:7px !important;height:2px !important;min-width:7px !important;min-height:2px !important;border-radius:999px !important;'),
    'Subagent spinner core must be a crisp centered 7px x 2px pill dash'
  );
  assert.equal(
    subSpinnerLine.includes('conversation-row-sidebar') || subSpinnerLine.includes('data-ag-cs-row-running'),
    false,
    'Subagent spinner dash rule must NEVER target primary conversation-row-sidebar rows'
  );

  // ── Task 4: Home Studio orbital dead CSS cleanup ─────────────────────
  for (const dead of ['.ag-cs-orbital-backdrop', '.ag-cs-orbit-arc', '.ag-cs-orbit-reticle', '.ag-cs-orbit-node']) {
    assert.equal(css.includes(dead), false, `Dead Home Studio orbital CSS selector ${dead} must be purged`);
  }
  assert.ok(
    css.includes('html[data-ag-cs-style][data-ag-cs-accent="mono"] :is(.ag-cs-settings-brand-svg,.ag-cs-settings-brand-mark svg){filter:grayscale(1);}'),
    'Mono accent grayscale rule for .ag-cs-settings-brand-svg and .ag-cs-settings-brand-mark svg must be preserved'
  );
  assert.ok(css.includes('.ag-cs-glyph-orbit') && css.includes('ag-cs-orbit-spin'), 'Active glyph/spinner orbit styles must remain intact');

  // ── Verify flattenMainStyleSheet expands both Task 2 and Task 3 rules cleanly ──
  const fnMatch = ui.match(/function flattenMainStyleSheet\(\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'flattenMainStyleSheet must exist in ui-runtime.js');
  const styleEl = {
    textContent: '',
    attrs: new Map([['data-ag-cs-css-hash', 'qa-test']]),
    getAttribute(k) { return this.attrs.get(k) || null; },
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    sheet: {
      cssRules: [
        {
          type: 1,
          selectorText: 'html[data-ag-cs-style]',
          style: { cssText: '' },
          cssRules: [
            {
              type: 1,
              selectorText: '& :is([data-testid="ask-question-option"],label[for$="-__write_in__"])',
              style: { cssText: 'position:relative;' },
              cssRules: [
                {
                  type: 1,
                  selectorText: '&:is(.bg-secondary.border-border,[aria-selected="true"])',
                  style: { cssText: 'background:var(--_q5) !important;' },
                  cssRules: [
                    {
                      type: 1,
                      selectorText: '& [data-testid$="-shortcut-badge"]',
                      style: { cssText: 'background:var(--_q0) !important;' },
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 1,
          selectorText: 'html[data-ag-cs-style] :is([data-testid="subagent-node"],[data-ag-sub-running="1"]) [data-testid="status-loading-spinner"] [data-agent-state-dot]:first-child',
          style: { cssText: 'width:7px !important;height:2px !important;' },
        },
      ],
    },
  };
  const sb = {
    CODE_HASH: 'qa-test',
    runGuardedMut: (fn) => fn(),
    document: { getElementById: (id) => (id === 'ag-prism-css' ? styleEl : null) },
  };
  vm.runInNewContext(`${fnMatch[0]}; flattenMainStyleSheet();`, sb);
  assert.ok(
    styleEl.textContent.includes('html[data-ag-cs-style] [data-testid="ask-question-option"].bg-secondary.border-border,') &&
      styleEl.textContent.includes('{background:var(--_q5) !important;}'),
    'Flattener must expand Q&A .bg-secondary.border-border selected rule'
  );
  assert.ok(
    styleEl.textContent.includes('html[data-ag-cs-style] label[for$="-__write_in__"].bg-secondary.border-border [data-testid$="-shortcut-badge"],') &&
      styleEl.textContent.includes('{background:var(--_q0) !important;}'),
    'Flattener must expand write-in selected shortcut badge rule'
  );
  assert.ok(
    styleEl.textContent.includes('html[data-ag-cs-style] [data-testid="subagent-node"] [data-testid="status-loading-spinner"] [data-agent-state-dot]:first-child,') &&
      styleEl.textContent.includes('html[data-ag-cs-style] [data-ag-sub-running="1"] [data-testid="status-loading-spinner"] [data-agent-state-dot]:first-child{width:7px !important;height:2px !important;}'),
    'Flattener must expand subagent-only spinner dash rule cleanly'
  );
});
