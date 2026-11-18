import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = import.meta.dirname;

const enhancerMod = require(path.join(__dirname, '..', 'host-workbench-enhancer.js'));
const streamMod = require(path.join(__dirname, '..', 'stream-choreography.js'));

// ── Lightweight Deterministic DOM Harness (Zero External Dependencies) ─────
function createClassList(el) {
  const set = new Set();
  const syncAttr = () => {
    const str = Array.from(set).join(' ');
    if (str) el._attrs.set('class', str);
    else el._attrs.delete('class');
  };
  return {
    _syncFromString(str) {
      set.clear();
      for (const tok of String(str || '').split(/\s+/).filter(Boolean)) set.add(tok);
    },
    add(...tokens) {
      for (const t of tokens) if (t) set.add(t);
      syncAttr();
    },
    remove(...tokens) {
      for (const t of tokens) set.delete(t);
      syncAttr();
    },
    contains(t) {
      return set.has(t);
    },
    toString() {
      return Array.from(set).join(' ');
    },
  };
}

function matchesSimpleSelector(el, rawSel) {
  if (!el || el.nodeType !== 1) return false;
  const sel = rawSel.trim();
  if (!sel) return false;

  // Descendant combinator support (e.g. '[data-testid="planner-response-text"] pre')
  if (sel.includes(' ')) {
    const parts = sel.split(/\s+/).filter(Boolean);
    if (!matchesSimpleSelector(el, parts[parts.length - 1])) return false;
    let cur = el.parentElement;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (cur && !matchesSimpleSelector(cur, parts[i])) {
        cur = cur.parentElement;
      }
      if (!cur) return false;
      cur = cur.parentElement;
    }
    return true;
  }

  let rem = sel;
  const tagMatch = rem.match(/^[a-zA-Z0-9-]+/);
  if (tagMatch) {
    if (el.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) return false;
    rem = rem.slice(tagMatch[0].length);
  }

  for (const cm of rem.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
    if (!el.classList.contains(cm[1])) return false;
  }
  rem = rem.replace(/\.[a-zA-Z0-9_-]+/g, '');

  for (const am of rem.matchAll(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g)) {
    const attrName = am[1];
    const expectedVal = am[2];
    if (!el.hasAttribute(attrName)) return false;
    if (expectedVal !== undefined && el.getAttribute(attrName) !== expectedVal) return false;
  }
  return true;
}

function matchesAnySelector(el, selectorList) {
  const parts = String(selectorList || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    if (matchesSimpleSelector(el, p)) return true;
  }
  return false;
}

function createMockEnv(initialVars = {}) {
  const computedVars = new Map(
    Object.entries({
      'color-scheme': 'dark',
      '--background': '#0B0B0E',
      '--content': '#0E0E11',
      '--sidebar': '#09090B',
      '--card': '#141418',
      '--card-border': 'rgba(255,255,255,0.088)',
      '--border': 'rgba(255,255,255,0.072)',
      '--secondary': '#1C1C22',
      '--secondary-foreground': '#C4C4CE',
      '--muted': '#141418',
      '--muted-foreground': '#8A8A98',
      '--foreground': '#F2F2F5',
      '--placeholder': '#626270',
      '--primary': '#669DF6',
      '--primary-foreground': '#FFFFFF',
      '--link': '#8AB4F8',
      '--error': '#E5534B',
      ...initialVars,
    })
  );

  let orderCounter = 0;

  function createElement(tag, attrs = {}) {
    const listeners = new Map();
    const el = {
      nodeType: 1,
      tagName: String(tag || 'div').toUpperCase(),
      ownerDocument: null,
      parentElement: null,
      parentNode: null,
      children: [],
      childNodes: [],
      isConnected: true,
      hidden: false,
      disabled: false,
      value: '',
      placeholder: '',
      scrollTop: 0,
      _text: '',
      _rect: { left: 0, top: 0, width: 600, height: 40, bottom: 40, right: 600 },
      _attrs: new Map(),
      _order: ++orderCounter,
      style: {
        _props: new Map(),
        setProperty(k, v) {
          this._props.set(k, String(v));
        },
        getPropertyValue(k) {
          return this._props.get(k) || '';
        },
        removeProperty(k) {
          this._props.delete(k);
        },
      },
      get className() {
        return this._attrs.get('class') || '';
      },
      set className(val) {
        const s = String(val || '');
        if (s) this._attrs.set('class', s);
        else this._attrs.delete('class');
        this.classList._syncFromString(s);
      },
      get textContent() {
        if (this.childNodes.length === 0) return this._text;
        return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join('');
      },
      set textContent(val) {
        this.children = [];
        this.childNodes = [];
        this._text = String(val ?? '');
      },
      get firstChild() {
        return this.childNodes[0] || null;
      },
      get firstElementChild() {
        return this.children[0] || null;
      },
      get lastElementChild() {
        return this.children[this.children.length - 1] || null;
      },
      get nextElementSibling() {
        if (!this.parentElement) return null;
        const idx = this.parentElement.children.indexOf(this);
        return idx >= 0 && idx + 1 < this.parentElement.children.length ? this.parentElement.children[idx + 1] : null;
      },
      get previousElementSibling() {
        if (!this.parentElement) return null;
        const idx = this.parentElement.children.indexOf(this);
        return idx > 0 ? this.parentElement.children[idx - 1] : null;
      },
      setAttribute(k, v) {
        const str = String(v);
        this._attrs.set(k, str);
        if (k === 'class') this.classList._syncFromString(str);
      },
      getAttribute(k) {
        return this._attrs.has(k) ? this._attrs.get(k) : null;
      },
      hasAttribute(k) {
        return this._attrs.has(k);
      },
      removeAttribute(k) {
        this._attrs.delete(k);
        if (k === 'class') this.classList._syncFromString('');
      },
      appendChild(child) {
        if (!child) return child;
        if (child.parentElement) child.remove();
        child.parentElement = this;
        child.parentNode = this;
        child.ownerDocument = this.ownerDocument;
        child._order = ++orderCounter;
        this.childNodes.push(child);
        if (child.nodeType === 1) this.children.push(child);
        return child;
      },
      insertBefore(child, ref) {
        if (!ref) return this.appendChild(child);
        if (child.parentElement) child.remove();
        child.parentElement = this;
        child.parentNode = this;
        child.ownerDocument = this.ownerDocument;
        child._order = ++orderCounter;
        const cnIdx = this.childNodes.indexOf(ref);
        if (cnIdx >= 0) this.childNodes.splice(cnIdx, 0, child);
        else this.childNodes.push(child);
        if (child.nodeType === 1) {
          const elIdx = this.children.indexOf(ref);
          if (elIdx >= 0) this.children.splice(elIdx, 0, child);
          else this.children.push(child);
        }
        return child;
      },
      removeChild(child) {
        const ci = this.childNodes.indexOf(child);
        if (ci >= 0) this.childNodes.splice(ci, 1);
        const ei = this.children.indexOf(child);
        if (ei >= 0) this.children.splice(ei, 1);
        child.parentElement = null;
        child.parentNode = null;
        return child;
      },
      remove() {
        if (this.parentElement) this.parentElement.removeChild(this);
      },
      contains(other) {
        let cur = other;
        while (cur) {
          if (cur === this) return true;
          cur = cur.parentElement;
        }
        return false;
      },
      compareDocumentPosition(other) {
        if (!other || other === this) return 0;
        return (other._order || 0) > (this._order || 0) ? 4 : 2;
      },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (matchesAnySelector(cur, sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (node) => {
          for (const ch of node.children) {
            if (matchesAnySelector(ch, sel)) out.push(ch);
            walk(ch);
          }
        };
        walk(this);
        return out;
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
      },
      getBoundingClientRect() {
        return { ...this._rect };
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        listeners.get(type)?.delete(fn);
      },
      dispatchEvent(ev) {
        const evt = ev || { type: 'unknown' };
        if (!evt.target) evt.target = this;
        const set = listeners.get(evt.type);
        if (set) {
          for (const fn of Array.from(set)) fn(evt);
        }
      },
      click() {
        this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} });
      },
    };
    el.classList = createClassList(el);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  function createTextNode(data) {
    return { nodeType: 3, data: String(data ?? ''), parentElement: null, parentNode: null };
  }

  const html = createElement('html', {
    'data-ag-cs-style': '1',
    'data-ag-cs-theme': 'dark',
    'data-ag-cs-palette': 'obsidian',
    'data-ag-cs-light-preset': 'crystal',
    'data-ag-cs-lang': 'zh-CN',
  });
  const body = createElement('body');
  html.appendChild(body);

  const winListeners = new Map();
  const win = {
    innerHeight: 960,
    getComputedStyle() {
      return {
        getPropertyValue(prop) {
          return computedVars.get(prop) || '';
        },
      };
    },
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      winListeners.get(type)?.delete(fn);
    },
    dispatchEvent(ev) {
      const set = winListeners.get(ev.type);
      if (set) {
        for (const fn of Array.from(set)) fn(ev);
      }
    },
  };

  const doc = {
    documentElement: html,
    body,
    activeElement: null,
    createElement: (t) => {
      const n = createElement(t);
      n.ownerDocument = doc;
      return n;
    },
    createTextNode,
    querySelectorAll: (sel) => html.querySelectorAll(sel),
    querySelector: (sel) => html.querySelector(sel),
  };
  html.ownerDocument = doc;
  body.ownerDocument = doc;

  return { doc, win, html, body, computedVars, createElement, createTextNode };
}

// ── Test 1: Sidecar (`plugin://*`) 4-Theme PostMessage Bridge & 0fps Dedup ─
test('Sidecar 4-theme bridge pushes computed tokens to Swarm/Pulse iframes, deduplicates at 0fps, and re-pushes on load/theme shift', () => {
  const env = createMockEnv();
  const messagesA = [];
  const messagesB = [];

  const swarmFrame = env.createElement('iframe', {
    'data-testid': 'sidecar-iframe',
    src: 'plugin://swarm--swarm_board-13791/?token=abc',
  });
  swarmFrame.contentWindow = { postMessage: (msg, targetOrigin) => messagesA.push({ msg, targetOrigin }) };

  const slotDiv = env.createElement('div', { 'data-testid': 'sidecar-iframe-slot' });
  const pulseFrame = env.createElement('iframe', { src: 'plugin://antigravity-pulse--panel-13794/' });
  pulseFrame.contentWindow = { postMessage: (msg, targetOrigin) => messagesB.push({ msg, targetOrigin }) };
  slotDiv.appendChild(pulseFrame);

  env.body.appendChild(swarmFrame);
  env.body.appendChild(slotDiv);

  const ctl = enhancerMod.createHostEnhancerController({
    doc: env.doc,
    win: env.win,
    getLang: () => 'zh-CN',
  });

  ctl.sync();
  assert.equal(messagesA.length, 1, 'Swarm iframe should receive initial theme-change');
  assert.equal(messagesB.length, 1, 'Slot iframe should receive initial theme-change');
  assert.equal(messagesA[0].targetOrigin, '*');
  assert.equal(messagesA[0].msg.type, 'theme-change');
  assert.equal(messagesA[0].msg.payload.themeType, 'dark');
  assert.equal(messagesA[0].msg.payload.cssVariables['--background'], '#0B0B0E');
  assert.equal(messagesA[0].msg.payload.cssVariables['--accent'], '#669DF6');

  // Repeated sync() while idle must perform ZERO postMessage and ZERO extra getComputedStyle calls (0fps idle!)
  const sampleCountBefore = ctl.getDebugState().themeSampleCount;
  ctl.sync();
  ctl.sync();
  assert.equal(messagesA.length, 1, 'Idle sync() must not spam postMessage');
  assert.equal(ctl.getDebugState().themeSampleCount, sampleCountBefore, 'Idle sync() must skip getComputedStyle');

  // Switch to Warm Alabaster Light theme -> onThemeChange() must broadcast warm light tokens
  env.html.setAttribute('data-ag-cs-theme', 'light');
  env.html.setAttribute('data-ag-cs-palette', 'warm');
  env.html.setAttribute('data-ag-cs-light-preset', 'alabaster');
  env.computedVars.set('color-scheme', 'light');
  env.computedVars.set('--background', '#F6F4EE');
  env.computedVars.set('--primary', '#C25934');

  ctl.onThemeChange();
  assert.equal(messagesA.length, 2);
  assert.equal(messagesA[1].msg.payload.themeType, 'light');
  assert.equal(messagesA[1].msg.payload.cssVariables['--background'], '#F6F4EE');
  assert.equal(messagesA[1].msg.payload.cssVariables['--primary'], '#C25934');

  // Simulate late iframe reload -> load listener must immediately re-hydrate tokens
  swarmFrame.dispatchEvent({ type: 'load' });
  assert.equal(messagesA.length, 3, 'Iframe load event must re-push latest theme');

  ctl.destroy();
  swarmFrame.dispatchEvent({ type: 'load' });
  assert.equal(messagesA.length, 3, 'Destroyed controller must detach iframe load listeners');
});

// ── Test 2: Code Block Sticky Header + Manual Fold (>=48 Lines) + Scroll Anchor ─
test('Code block enhancer marks sticky header, never auto-folds, protects active streaming block, and anchors scrollTop on manual fold', () => {
  const env = createMockEnv();
  let running = true;

  const convView = env.createElement('div', { 'data-testid': 'conversation-view' });
  const viewport = env.createElement('div', { 'data-testid': 'autoscroll-viewport' });
  viewport._rect = { left: 0, top: 100, width: 800, height: 600, bottom: 700, right: 800 };
  viewport.scrollTop = 900;
  convView.appendChild(viewport);

  const prose = env.createElement('div', { 'data-testid': 'planner-response-text' });
  viewport.appendChild(prose);

  function buildHostCodeBlock(lineCount, rectTop = 120) {
    const pre = env.createElement('pre');
    const card = env.createElement('div', { class: 'relative my-2 rounded-xl bg-muted border' });
    card._rect = { left: 20, top: rectTop, width: 720, height: 1200, bottom: rectTop + 1200, right: 740 };
    const header = env.createElement('div', { class: 'min-h-7 relative flex items-center justify-between border-b px-2' });
    const langLabel = env.createElement('div');
    langLabel.textContent = 'typescript';
    const actions = env.createElement('div', { class: 'flex items-center gap-2' });
    const copyBtn = env.createElement('button', { 'aria-label': 'Copy code' });
    actions.appendChild(copyBtn);
    header.appendChild(langLabel);
    header.appendChild(actions);

    const bodyWrap = env.createElement('div', { class: 'p-3' });
    const codeBlock = env.createElement('div', { class: 'code-block' });
    for (let i = 0; i < lineCount; i++) {
      const ln = env.createElement('div', { class: 'code-line' });
      ln.textContent = `const line_${i} = ${i};`;
      codeBlock.appendChild(ln);
    }
    bodyWrap.appendChild(codeBlock);
    card.appendChild(header);
    card.appendChild(bodyWrap);
    pre.appendChild(card);
    return { pre, card, header, actions };
  }

  // 1) Short block (20 lines) -> sticky attr set, NO fold button
  const shortBlk = buildHostCodeBlock(20, 140);
  prose.appendChild(shortBlk.pre);

  // 2) Completed 64-line block (followed by another block) -> gets manual fold button, NOT auto-folded
  const tallDoneBlk = buildHostCodeBlock(64, -350); // top (-350) is scrolled 450px above viewport top (100)!
  prose.appendChild(tallDoneBlk.pre);

  // 3) Trailing active streaming 80-line block -> protected while running === true
  const streamingBlk = buildHostCodeBlock(80, 400);
  prose.appendChild(streamingBlk.pre);

  env.body.appendChild(convView);

  const ctl = enhancerMod.createHostEnhancerController({
    doc: env.doc,
    win: env.win,
    getLang: () => 'zh-CN',
    isConvRunning: () => running,
  });

  ctl.sync();

  assert.equal(shortBlk.header.getAttribute('data-ag-cs-code-sticky'), '1');
  assert.equal(shortBlk.header.querySelector('.ag-cs-code-fold-btn'), null, 'Short block (<48L) must not show fold button');

  const foldBtn = tallDoneBlk.header.querySelector('.ag-cs-code-fold-btn');
  assert.ok(foldBtn, 'Completed >=48L block must mount manual fold button');
  assert.equal(foldBtn.textContent, '折叠 (64行)');
  assert.equal(tallDoneBlk.card.hasAttribute('data-ag-cs-code-folded'), false, 'Must NEVER auto-fold code blocks');

  assert.equal(
    streamingBlk.header.querySelector('.ag-cs-code-fold-btn'),
    null,
    'Actively streaming trailing block must not mount fold button prematurely'
  );

  // Finish streaming -> trailing 80-line block now receives manual fold button
  running = false;
  ctl.sync();
  assert.ok(streamingBlk.header.querySelector('.ag-cs-code-fold-btn'), 'Finished block mounts fold button after stream ends');

  // Click manual fold on tallDoneBlk whose header is above viewport -> folds AND compensates viewport.scrollTop!
  foldBtn.click();
  assert.equal(tallDoneBlk.card.getAttribute('data-ag-cs-code-folded'), '1');
  assert.equal(foldBtn.getAttribute('aria-expanded'), 'false');
  assert.equal(foldBtn.textContent, '展开 (64行)');
  // Initial scrollTop 900 + (-350 - 100 - 12) = 438
  assert.equal(viewport.scrollTop, 438, 'Manual fold must anchor scrollTop back to block header');

  // Click again -> expands cleanly
  foldBtn.click();
  assert.equal(tallDoneBlk.card.hasAttribute('data-ag-cs-code-folded'), false);
  assert.equal(foldBtn.textContent, '折叠 (64行)');

  ctl.destroy();
  assert.equal(env.doc.querySelectorAll('.ag-cs-code-fold-btn').length, 0);
});

// ── Test 3: Navigator Rail Outline, Filter, Fold Historical Steps & Alt+Up/Down ─
test('Navigator rail outline indexes chapters + prompts without permanent bottom clutter, folds historical steps preserving latest turn, and jumps via Alt+Up/Down', () => {
  const env = createMockEnv();
  const convView = env.createElement('div', { 'data-testid': 'conversation-view' });
  const navRail = env.createElement('nav', { 'data-testid': 'conversation-navigator' });

  let chapterClicked = 0;
  const chBtn = env.createElement('button', {
    'data-testid': 'conversation-navigator-group',
    'data-group-key': 'chapter:0',
    'aria-label': '11月16日 · 69 turns',
  });
  chBtn.addEventListener('click', () => {
    chapterClicked += 1;
  });
  navRail.appendChild(chBtn);

  for (let t = 70; t <= 72; t++) {
    navRail.appendChild(
      env.createElement('button', {
        'data-testid': 'conversation-navigator-turn',
        'aria-label': `Turn ${t} of 72`,
      })
    );
  }
  convView.appendChild(navRail);

  const vp = env.createElement('div', { 'data-testid': 'autoscroll-viewport' });
  vp._rect = { left: 0, top: 0, width: 900, height: 500, bottom: 500, right: 900 };
  vp.scrollTop = 600;
  convView.appendChild(vp);

  function addTurn(promptText, topY) {
    const step = env.createElement('div', { 'data-testid': 'user-input-step' });
    step._rect = { left: 40, top: topY, width: 700, height: 60, bottom: topY + 60, right: 740 };
    const msg = env.createElement('div', { 'data-testid': 'user-message-content' });
    msg.textContent = promptText;
    step.appendChild(msg);
    vp.appendChild(step);

    const resp = env.createElement('div', { 'data-testid': 'agent-response' });
    const wf = env.createElement('button', { 'data-testid': 'worked-for-collapsible', 'aria-expanded': 'true' });
    wf.addEventListener('click', () => {
      wf.setAttribute('aria-expanded', wf.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
    });
    const th = env.createElement('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' });
    th.addEventListener('click', () => {
      th.setAttribute('aria-expanded', th.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
    });
    resp.appendChild(wf);
    resp.appendChild(th);
    vp.appendChild(resp);
    return { step, wf, th };
  }

  const t70 = addTurn('排查 Swarm 面板白屏原因', -420);
  const t71 = addTurn('修复代码块双重边框与吸顶', 80);
  const t72 = addTurn('补充全量单测与体积校验', 410);
  env.body.appendChild(convView);

  const ctl = enhancerMod.createHostEnhancerController({
    doc: env.doc,
    win: env.win,
    getLang: () => 'zh-CN',
  });
  ctl.sync();

  // Zero permanent clutter before hover!
  assert.equal(env.doc.querySelector('.ag-cs-nav-outline-popover'), null, 'No DOM popover mounted before rail interaction');

  // Hover left rail -> opens outline popover with chapter + turns #70..#72
  navRail.dispatchEvent({ type: 'pointerenter' });
  const pop = env.doc.querySelector('.ag-cs-nav-outline-popover');
  assert.ok(pop && !pop.hidden, 'Hovering rail opens outline popover');
  assert.equal(pop.querySelector('.ag-cs-nav-outline-title')?.textContent, '提问导航 · 72 轮');
  assert.equal(pop.querySelectorAll('.ag-cs-nav-outline-chapter').length, 1);
  assert.equal(pop.querySelectorAll('.ag-cs-nav-outline-item').length, 3);
  assert.equal(pop.querySelector('.ag-cs-nav-outline-item')?.getAttribute('data-turn-num'), '70');

  // Chapter click delegates cleanly to host native button
  pop.querySelector('.ag-cs-nav-outline-chapter').click();
  assert.equal(chapterClicked, 1);

  // Filter input narrows items in real time
  const search = pop.querySelector('.ag-cs-nav-outline-search');
  search.value = '吸顶';
  search.dispatchEvent({ type: 'input' });
  const filteredItems = pop.querySelectorAll('.ag-cs-nav-outline-item');
  assert.equal(filteredItems.length, 1);
  assert.equal(filteredItems[0].getAttribute('data-turn-num'), '71');

  // Fold historical steps: collapses t70 & t71, strictly preserves latest turn t72!
  pop.querySelector('.ag-cs-nav-fold-steps-btn').click();
  assert.equal(t70.wf.getAttribute('aria-expanded'), 'false');
  assert.equal(t70.th.getAttribute('aria-expanded'), 'false');
  assert.equal(t71.wf.getAttribute('aria-expanded'), 'false');
  assert.equal(t72.wf.getAttribute('aria-expanded'), 'true', 'Latest turn worked-for must stay expanded');
  assert.equal(t72.th.getAttribute('aria-expanded'), 'true', 'Latest turn thinking must stay expanded');

  // Alt+ArrowUp jumps to previous turn above viewport (t70 at -420) and triggers sonar
  let prevented = false;
  env.win.dispatchEvent({
    type: 'keydown',
    key: 'ArrowUp',
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: env.body,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(t70.step.getAttribute('data-ag-cs-sonar'), '1');

  // Alt+ArrowDown inside an editable input must NOT be hijacked
  const editor = env.createElement('div', { contenteditable: 'true' });
  env.body.appendChild(editor);
  let hijackedInEditor = false;
  env.win.dispatchEvent({
    type: 'keydown',
    key: 'ArrowDown',
    altKey: true,
    target: editor,
    preventDefault() {
      hijackedInEditor = true;
    },
  });
  assert.equal(hijackedInEditor, false, 'Must never hijack Alt+Arrow inside editable composer/inputs');

  ctl.destroy();
});

// ── Test 4: Stream Choreography Edge-Case Anti-Flicker Guards ─────────────
test('stream-choreography prevents outer <pre> flicker on TextNode appends, keeps inline <code> paragraphs vertical, and coalesces table scans per <tr>', () => {
  const env = createMockEnv();
  const prevDoc = globalThis.document;
  globalThis.document = env.doc;

  try {
    const conv = env.createElement('div', { 'data-testid': 'conversation-view' });
    const prose = env.createElement('div', { 'data-testid': 'planner-response-text' });
    conv.appendChild(prose);
    env.body.appendChild(conv);

    const pre = env.createElement('pre');
    const codeBlock = env.createElement('div', { class: 'code-block' });
    const line1 = env.createElement('div', { class: 'code-line' });
    codeBlock.appendChild(line1);
    pre.appendChild(codeBlock);
    prose.appendChild(pre);

    const table = env.createElement('table');
    const tbody = env.createElement('tbody');
    const tr = env.createElement('tr');
    tbody.appendChild(tr);
    table.appendChild(tbody);
    prose.appendChild(table);

    const streamCtl = streamMod.createStreamChoreographyController({
      motionEngine: null,
      isDestroyed: () => false,
      isComposerRestyleEnabled: () => true,
      isMotionStandardOrUltra: () => true,
      isMotionUltra: () => true,
      isConvRunning: () => true,
      isThoughtIsolatedNode: () => false,
      isThoughtMutationRecord: () => false,
      isManagedThoughtPanel: () => false,
      setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
      runGuardedMut: (fn) => fn(),
      cloneCachedSvgElement: () => null,
      buildBrandMarkSvg: () => '',
      applySingleHostIcon: () => {},
      rippleCtl: null,
      convAuraCtl: { triggerLiftoffEbb() {} },
      notifyMascot: () => {},
    });

    // 1) Appending plain TextNode inside <pre>/code-line must NOT slap .ag-cs-code-scan onto outer <pre> or .code-block
    const txt = env.createTextNode('const x = 42;');
    line1.appendChild(txt);
    streamCtl.onStreamMutations([{ type: 'childList', target: line1, addedNodes: [txt] }]);
    assert.equal(pre.classList.contains('ag-cs-code-scan'), false, 'Outer <pre> must never flicker on TextNode append');
    assert.equal(codeBlock.classList.contains('ag-cs-code-scan'), false);

    // 2) Paragraph containing inline <code> must receive vertical .ag-cs-stream-chunk, NOT horizontal .ag-cs-code-scan
    const para = env.createElement('p');
    const inlineCode = env.createElement('code');
    inlineCode.textContent = 'style.css';
    para.appendChild(inlineCode);
    prose.appendChild(para);
    streamCtl.onStreamMutations([{ type: 'childList', target: prose, addedNodes: [para] }]);
    assert.equal(para.classList.contains('ag-cs-stream-chunk'), true, 'Paragraph with inline <code> should use vertical stream-chunk');
    assert.equal(para.classList.contains('ag-cs-code-scan'), false, 'Paragraph with inline <code> must not use horizontal code-scan');

    // 3) Appending multiple <td> cells into a <tr> coalesces onto the parent <tr> once, never per-cell
    const td1 = env.createElement('td');
    const td2 = env.createElement('td');
    tr.appendChild(td1);
    tr.appendChild(td2);
    streamCtl.onStreamMutations([{ type: 'childList', target: tr, addedNodes: [td1, td2] }]);
    assert.equal(tr.classList.contains('ag-cs-code-scan'), true, 'Parent <tr> receives coalesced scan');
    assert.equal(td1.classList.contains('ag-cs-code-scan'), false, 'Individual <td> must not animate separately');
    assert.equal(td2.classList.contains('ag-cs-code-scan'), false);

    streamCtl.clearTransientTimers();
  } finally {
    globalThis.document = prevDoc;
  }
});

// ── Test 5: style.css Wave 2 Optical, Surface, Schema & Thought Contracts ─
test('style.css covers all 6 Wave-2 config hooks, eliminates double borders & entity-pill underline, purges warm-theme cold-blue leaks, and styles thought-translator V2 tokens', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

  let depth = 0;
  for (const ch of css) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    assert.ok(depth >= 0, 'Unbalanced closing brace in style.css');
  }
  assert.equal(depth, 0, 'Curly braces in style.css must be 100% balanced');

  // 1) All 6 new schema hooks
  for (const hook of [
    'data-ag-cs-accent="cobalt"',
    'data-ag-cs-accent="iris"',
    'data-ag-cs-accent="amber"',
    'data-ag-cs-accent="mono"',
    'data-ag-cs-corners="sharp"',
    'data-ag-cs-corners="balanced"',
    'data-ag-cs-corners="soft"',
    'data-ag-cs-code-font="jetbrains"',
    'data-ag-cs-code-font="cascadia"',
    'data-ag-cs-code-font="sfmono"',
    'data-ag-cs-ligatures="1"',
    'data-ag-cs-ambient="0"',
    'data-ag-cs-ambient="0.35"',
    'data-ag-cs-ambient="0.7"',
    'data-ag-prism-thought-view="bilingual"',
    'data-ag-cs-cjk="1"',
  ]) {
    assert.ok(css.includes(hook), `Expected style.css to implement Wave 2 attribute hook: ${hook}`);
  }

  // 2) Host deep-surface fixes (code sticky, manual fold, table frame, entity-pill exclusion, console well, sidecar slot, navigator group)
  for (const selector of [
    '[data-testid="sidecar-iframe-slot"]',
    'pre>div:is(.border,.bg-muted)',
    'position:sticky;top:0;z-index:3',
    '.ag-cs-code-fold-btn',
    'data-ag-cs-code-folded="1"',
    '.agy-md-table.md-table-frame',
    ':not([data-testid="entity-pill"])',
    '[data-testid="running-items-card"]',
    '[data-testid="background-task-command"]',
    '[data-testid="subagent-node"]',
    '[data-testid="artifact-row"]',
    '[data-testid="artifact-view"]',
    '[data-testid="aux-pane-split"]',
    '[data-testid="conversation-navigator-group"]',
    '.ag-cs-nav-outline-popover',
    '--glass-highlight:var(--ag-cs-specular) !important',
    '::selection',
  ]) {
    assert.ok(css.includes(selector), `Expected style.css to include deep-surface rule: ${selector}`);
  }

  // 3) Thought translator Wave-1 (#123) 6 semantic selectors
  for (const thoughtSel of [
    '.ag-prism-thought-file-pill',
    '.ag-prism-thought-fallback-badge',
    '.ag-prism-thought-retranslate-btn',
    '.ag-prism-thought-error-bar',
    '.ag-prism-thought-retry-btn',
    '.ag-cs-thought-cache-badge',
    'data-op-zh-failed="1"',
  ]) {
    assert.ok(css.includes(thoughtSel), `Expected style.css to style thought-translator selector: ${thoughtSel}`);
  }

  // 4) Bug-hunt #153 optical, gating & corner parity contracts
  for (const contract of [
    '--ag-ambient-mul:1;--ag-accent-prism-mul:1',
    '[data-ag-cs-accent="cobalt"]>body',
    '[data-ag-cs-accent="mono"]>body',
    '[data-ag-cs-palette="host"]>body',
    '[data-ag-cs-telemetry="off"] :is(#ag-pulse-status-bar,[data-ag-pulse-bar="true"]){display:none !important;}',
    '[data-ag-cs-composer="on"]:not([data-ag-cs-telemetry="off"]) .agy-composer-footer>#ag-pulse-status-bar',
    ':is(.agy-composer-footer,[data-testid="input-box-bottom-toolbar"]){position:relative !important;z-index:26 !important;}',
    ':is(#ag-prism-pulse-bar,[data-ag-prism-pulse-bar],#ag-pulse-status-bar):not([data-layout="blocked"]){z-index:28 !important;}',
    '[data-ag-cs-composer="off"] .surface-composer-card>.ag-cs-prism-rim-cv{display:none !important;',
    '&:not([data-ag-cs-home="off"]) .agy-home{',
    '[data-ag-cs-sidebar="on"][data-ag-cs-sidebar-compact="on"]',
    '[data-ag-cs-sidebar="on"][data-ag-cs-sidebar-collapsed="1"]',
    '[data-testid="conversation-navigator"]{pointer-events:auto !important;}',
    '.ag-cs-nav-outline-popover::before',
    '.code-line,kbd,[data-lexical-editor="true"] code,.cm-content,.monaco-editor .view-lines,.xterm,.xterm-rows',
    '[data-ag-cs-logo-ink="foreground"]',
    '.ag-cs-settings-brand-svg',
  ]) {
    assert.ok(css.includes(contract), `Expected style.css to enforce #153 fix contract: ${contract}`);
  }

  const jbLine = css.split('\n').find((l) => l.includes('[data-ag-cs-code-font="jetbrains"]')) || '';
  assert.equal(
    jbLine.includes('Google Sans Code'),
    false,
    'jetbrains stack must fallback to Cascadia/Fira/Consolas rather than identical Google Sans Code'
  );
});

// ── Test 6: #153 Cantonese (`yue`) Live Refresh, Warm-Light Sidecar Parity, Mid-History Turn Math & Group-Card Yield ─
test('Host enhancer supports Cantonese (yue) + live language switch, aligns warm-light sidecar to prism-alabaster, resolves mid-history turn numbers, and yields to host group-card', () => {
  const env = createMockEnv();
  let curLang = 'yue';

  // Sidecar warm-light parity check (palette=warm + lightPreset=crystal in light mode -> prism-alabaster)
  env.html.setAttribute('data-ag-cs-theme', 'light');
  env.html.setAttribute('data-ag-cs-palette', 'warm');
  env.html.setAttribute('data-ag-cs-light-preset', 'crystal');
  env.computedVars.set('color-scheme', 'light');

  const pushed = [];
  const sideFrame = env.createElement('iframe', { 'data-testid': 'sidecar-iframe', src: 'plugin://swarm--board/' });
  sideFrame.contentWindow = { postMessage: (msg) => pushed.push(msg) };
  env.body.appendChild(sideFrame);

  // Conversation with 100 total turns scrolled to mid-history (#27, #28 active, #29)
  const convView = env.createElement('div', { 'data-testid': 'conversation-view' });
  const navRail = env.createElement('nav', { 'data-testid': 'conversation-navigator' });
  const grpBtn = env.createElement('button', {
    'data-testid': 'conversation-navigator-group',
    'aria-label': 'Earlier turns',
  });
  navRail.appendChild(grpBtn);
  for (let t = 1; t <= 100; t++) {
    const dot = env.createElement('button', {
      'data-testid': 'conversation-navigator-turn',
      'aria-label': `Turn ${t} of 100`,
    });
    if (t === 28) dot.setAttribute('aria-current', 'true');
    navRail.appendChild(dot);
  }
  convView.appendChild(navRail);

  const vp = env.createElement('div', { 'data-testid': 'autoscroll-viewport' });
  vp._rect = { left: 0, top: 0, width: 900, height: 600, bottom: 600, right: 900 };
  convView.appendChild(vp);

  const prose = env.createElement('div', { 'data-testid': 'planner-response-text' });
  const pre = env.createElement('pre');
  const card = env.createElement('div', { class: 'bg-muted border' });
  const hdr = env.createElement('div', { class: 'border-b justify-between' });
  const bodyWrap = env.createElement('div');
  for (let i = 0; i < 52; i++) {
    const ln = env.createElement('div', { class: 'code-line' });
    ln.textContent = `line ${i}`;
    bodyWrap.appendChild(ln);
  }
  card.appendChild(hdr);
  card.appendChild(bodyWrap);
  pre.appendChild(card);
  prose.appendChild(pre);
  vp.appendChild(prose);

  function addMidTurn(txt, topY) {
    const step = env.createElement('div', { 'data-testid': 'user-input-step' });
    step._rect = { left: 40, top: topY, width: 700, height: 50, bottom: topY + 50, right: 740 };
    step.textContent = txt;
    vp.appendChild(step);
    return step;
  }
  addMidTurn('Mid turn A', -120);
  addMidTurn('Mid turn B (active in viewport)', 150);
  addMidTurn('Mid turn C', 460);
  env.body.appendChild(convView);

  const ctl = enhancerMod.createHostEnhancerController({
    doc: env.doc,
    win: env.win,
    getLang: () => curLang,
    isConvRunning: () => false,
  });

  ctl.sync();

  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].payload.theme, 'prism-alabaster', 'Light + warm palette must push prism-alabaster');

  const foldBtn = hdr.querySelector('.ag-cs-code-fold-btn');
  assert.ok(foldBtn);
  assert.equal(foldBtn.textContent, '摺埋 (52行)', 'Cantonese (yue) must use Cantonese label instead of English fallback');

  // Open outline -> verify Cantonese texts and mid-history turn numbers (#27, #28, #29)
  navRail.dispatchEvent({ type: 'pointerenter', target: navRail });
  const pop = env.doc.querySelector('.ag-cs-nav-outline-popover');
  assert.ok(pop && !pop.hidden);
  assert.equal(pop.querySelector('.ag-cs-nav-fold-steps-btn')?.textContent, '收埋步驟');
  const turnNums = pop.querySelectorAll('.ag-cs-nav-outline-item').map((n) => n.getAttribute('data-turn-num'));
  assert.deepEqual(turnNums, ['27', '28', '29'], 'Mid-history virtualized slice must anchor to active turn dot #28');

  // Switch language to English dynamically -> sync()/onThemeChange(false) refreshes fold button & open outline immediately
  curLang = 'en';
  ctl.onThemeChange(false);
  assert.equal(foldBtn.textContent, 'Fold (52L)');
  assert.equal(pop.querySelector('.ag-cs-nav-fold-steps-btn')?.textContent, 'Fold Steps');

  // Hovering a group chapter dot or presence of host native group-card yields cleanly without overlapping
  navRail.dispatchEvent({ type: 'pointerover', target: grpBtn });
  assert.equal(pop.hidden, true, 'Hovering group dot must yield to host native chapter preview card');

  const hostGroupCard = env.createElement('div', { 'data-testid': 'conversation-navigator-group-card' });
  convView.appendChild(hostGroupCard);
  assert.equal(ctl.openNavOutline(navRail), false, 'Must not open outline while host group-card is visible');

  ctl.destroy();
});

// ── Test 7: #153 Stream Choreography Decoupled Composer Gate, Mono Sparks & Motion-Tier Cleanup ─
test('stream-choreography keeps sparks/auto-unfold independent of composerRestyle, supports mono sparks, and purges transient classes on motion downgrade', () => {
  const env = createMockEnv();
  const prevDoc = globalThis.document;
  globalThis.document = env.doc;

  try {
    let motionUltra = true;
    const conv = env.createElement('div', { 'data-testid': 'conversation-view' });
    const trig = env.createElement('button', { 'data-testid': 'thinking-collapsible-trigger' });
    trig.textContent = 'Thinking...';
    conv.appendChild(trig);

    const outerWf = env.createElement('button', { 'data-testid': 'worked-for-collapsible', 'aria-expanded': 'true' });
    const wfBody = env.createElement('div');
    let innerClicked = 0;
    const innerTg = env.createElement('button', { 'data-testid': 'tool-group-collapsible', 'aria-expanded': 'false' });
    innerTg.addEventListener('click', () => {
      innerClicked += 1;
      innerTg.setAttribute('aria-expanded', 'true');
    });
    wfBody.appendChild(innerTg);
    conv.appendChild(outerWf);
    conv.appendChild(wfBody);

    const prose = env.createElement('div', { 'data-testid': 'planner-response-text' });
    const p = env.createElement('p');
    prose.appendChild(p);
    conv.appendChild(prose);
    env.body.appendChild(conv);

    const monoCalls = [];
    const streamCtl = streamMod.createStreamChoreographyController({
      motionEngine: null,
      isDestroyed: () => false,
      isComposerRestyleEnabled: () => false, // composerRestyle OFF must NOT kill conversation sparks/unfold!
      isMotionStandardOrUltra: () => motionUltra,
      isMotionUltra: () => motionUltra,
      isConvRunning: () => true,
      isThoughtIsolatedNode: () => false,
      isThoughtMutationRecord: () => false,
      isManagedThoughtPanel: () => false,
      setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
      runGuardedMut: (fn) => fn(),
      cloneCachedSvgElement: () => null,
      buildBrandMarkSvg: (_brand, _sz, _tier, mono) => {
        monoCalls.push(mono);
        return '<svg></svg>';
      },
      applySingleHostIcon: () => {},
      rippleCtl: null,
      convAuraCtl: { triggerLiftoffEbb() {} },
      notifyMascot: () => {},
    });

    env.html.setAttribute('data-ag-cs-accent', 'mono');
    streamCtl.syncThinkingSparks({ brand: 'antigravity' });
    assert.ok(trig.querySelector('.ag-cs-thinking-spark'), 'Thinking spark must mount even when composerRestyle is false');
    assert.equal(monoCalls[monoCalls.length - 1], true, 'accent="mono" must request monochrome spark SVG');

    streamCtl.syncWorkedForAutoUnfold();
    assert.equal(innerClicked, 1, 'Tool-group auto-unfold must remain active when composerRestyle is false');

    streamCtl.onStreamMutations([{ type: 'childList', target: prose, addedNodes: [p] }]);
    assert.equal(p.classList.contains('ag-cs-stream-chunk'), true);

    // Downgrade motionLevel from ultra -> off: disconnectStreamObserver must purge transient classes immediately
    motionUltra = false;
    streamCtl.disconnectStreamObserver();
    assert.equal(p.classList.contains('ag-cs-stream-chunk'), false, 'Transient stream-chunk must be cleared on motion downgrade');

    streamCtl.clearTransientTimers();
  } finally {
    globalThis.document = prevDoc;
  }
});
