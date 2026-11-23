import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const cdp = require(path.join(ROOT, 'cdp.js'));
const locales = require(path.join(ROOT, 'i18n-locales.js'));
const sliderCoexist = require(path.join(ROOT, 'vendor', 'effort-slider', 'slider-coexist.js'));
const upstreamSlider = require(path.join(ROOT, 'vendor', 'effort-slider', 'upstream-client.js'));
const hostI18nFactory = require(path.join(ROOT, 'vendor', 'host-i18n', 'host-i18n-runtime.js'));
const dualMascotRig = require(path.join(ROOT, 'dual-mascot-rig.js'));

function createFakeDom() {
  const attrsMap = new WeakMap();
  class FakeNode {
    constructor(nodeType, tagName = '') {
      this.nodeType = nodeType;
      this.tagName = tagName ? tagName.toUpperCase() : '';
      this.childNodes = [];
      this.parentNode = null;
      this.ownerDocument = null;
      this._listeners = new Map();
      this.dataset = {};
      this.style = {
        _props: new Map(),
        setProperty(k, v) { this._props.set(k, String(v)); },
        getPropertyValue(k) { return this._props.get(k) || ''; },
        removeProperty(k) { this._props.delete(k); },
      };
      this.classList = {
        _set: new Set(),
        add: (...cs) => cs.forEach((c) => { if (c) this.classList._set.add(c); this._syncClass(); }),
        remove: (...cs) => cs.forEach((c) => { this.classList._set.delete(c); this._syncClass(); }),
        toggle: (c, f) => {
          const on = f === undefined ? !this.classList._set.has(c) : Boolean(f);
          if (on) this.classList._set.add(c); else this.classList._set.delete(c);
          this._syncClass();
          return on;
        },
        contains: (c) => this.classList._set.has(c),
      };
      attrsMap.set(this, new Map());
    }
    _syncClass() {
      attrsMap.get(this).set('class', [...this.classList._set].join(' '));
    }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
    get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
    get firstChild() { return this.childNodes[0] || null; }
    get firstElementChild() { return this.children[0] || null; }
    get nextSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.childNodes.indexOf(this);
      return idx >= 0 ? this.parentNode.childNodes[idx + 1] || null : null;
    }
    get nextElementSibling() {
      let cur = this.nextSibling;
      while (cur && cur.nodeType !== 1) cur = cur.nextSibling;
      return cur || null;
    }
    get isConnected() {
      let cur = this;
      while (cur) {
        if (cur === doc.documentElement) return true;
        cur = cur.parentNode;
      }
      return false;
    }
    get className() { return this.getAttribute('class') || ''; }
    set className(v) {
      this.classList._set.clear();
      String(v || '').split(/\s+/).filter(Boolean).forEach((c) => this.classList._set.add(c));
      this._syncClass();
    }
    get id() { return this.getAttribute('id') || ''; }
    set id(v) { this.setAttribute('id', v); }
    get textContent() {
      if (this.nodeType === 3) return this.nodeValue || '';
      return this.childNodes.map((c) => c.textContent).join('');
    }
    set textContent(v) {
      if (this.nodeType === 3) { this.nodeValue = String(v ?? ''); return; }
      for (const c of this.childNodes) c.parentNode = null;
      this.childNodes = [];
      const s = String(v ?? '');
      if (s) this.appendChild(doc.createTextNode(s));
    }
    setAttribute(k, v) {
      const val = String(v);
      attrsMap.get(this).set(k, val);
      if (k === 'class') {
        this.classList._set.clear();
        val.split(/\s+/).filter(Boolean).forEach((c) => this.classList._set.add(c));
      }
    }
    getAttribute(k) { const m = attrsMap.get(this); return m.has(k) ? m.get(k) : null; }
    hasAttribute(k) { return attrsMap.get(this).has(k); }
    removeAttribute(k) { attrsMap.get(this).delete(k); }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      child.ownerDocument = doc;
      this.childNodes.push(child);
      return child;
    }
    insertBefore(child, ref) {
      if (!ref) return this.appendChild(child);
      if (child.parentNode) child.parentNode.removeChild(child);
      const idx = this.childNodes.indexOf(ref);
      child.parentNode = this;
      child.ownerDocument = doc;
      if (idx < 0) this.childNodes.push(child);
      else this.childNodes.splice(idx, 0, child);
      return child;
    }
    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx >= 0) { this.childNodes.splice(idx, 1); child.parentNode = null; }
      return child;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    contains(other) {
      let cur = other;
      while (cur) { if (cur === this) return true; cur = cur.parentNode; }
      return false;
    }
    addEventListener(type, fn, capture = false) {
      const key = `${type}:${capture ? 1 : 0}`;
      if (!this._listeners.has(key)) this._listeners.set(key, []);
      this._listeners.get(key).push(fn);
    }
    removeEventListener(type, fn, capture = false) {
      const key = `${type}:${capture ? 1 : 0}`;
      const arr = this._listeners.get(key);
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    }
    dispatchEvent(ev) {
      ev.target = ev.target || this;
      const pathNodes = [];
      let cur = this;
      while (cur) { pathNodes.push(cur); cur = cur.parentNode; }
      pathNodes.push(doc);
      // capture
      for (let i = pathNodes.length - 1; i >= 0; i--) {
        const arr = (pathNodes[i]._listeners.get(`${ev.type}:1`) || []).slice();
        for (const fn of arr) fn.call(pathNodes[i], ev);
      }
      // bubble
      for (let i = 0; i < pathNodes.length; i++) {
        const arr = (pathNodes[i]._listeners.get(`${ev.type}:0`) || []).slice();
        for (const fn of arr) fn.call(pathNodes[i], ev);
      }
      return !ev.defaultPrevented;
    }
    matches(sel) { return matchesSelector(this, sel); }
    closest(sel) {
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (matchesSelector(cur, sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 1) {
            if (matchesSelector(c, sel)) out.push(c);
            walk(c);
          }
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 80, right: 400, bottom: 80 }; }
    getContext() {
      return {
        clearRect() {}, fillRect() {}, save() {}, restore() {}, translate() {}, scale() {},
        beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, rect() {}, clip() {}, fill() {}, stroke() {},
        setTransform() {}, createLinearGradient() { return { addColorStop() {} }; },
      };
    }
  }

  function matchSingle(el, raw) {
    const s = raw.trim();
    if (!s) return false;
    if (s.includes(' ')) {
      const parts = s.split(/\s+/);
      if (!matchSingle(el, parts[parts.length - 1])) return false;
      let cur = el.parentElement;
      for (let i = parts.length - 2; i >= 0; i--) {
        let found = false;
        while (cur) {
          if (matchSingle(cur, parts[i])) { found = true; cur = cur.parentElement; break; }
          cur = cur.parentElement;
        }
        if (!found) return false;
      }
      return true;
    }
    let rest = s;
    const tagMatch = /^[a-zA-Z0-9-]+/.exec(rest);
    if (tagMatch) {
      if (el.tagName !== tagMatch[0].toUpperCase()) return false;
      rest = rest.slice(tagMatch[0].length);
    }
    while (rest) {
      if (rest[0] === '.') {
        const m = /^\.([a-zA-Z0-9_-]+)/.exec(rest);
        if (!m || !el.classList.contains(m[1])) return false;
        rest = rest.slice(m[0].length);
      } else if (rest[0] === '#') {
        const m = /^#([a-zA-Z0-9_-]+)/.exec(rest);
        if (!m || el.id !== m[1]) return false;
        rest = rest.slice(m[0].length);
      } else if (rest[0] === '[') {
        const m = /^\[([a-zA-Z0-9_-]+)(?:(\^=|=)["']?([^\]"']*)["']?)?\]/.exec(rest);
        if (!m) return false;
        const [, ak, op, av] = m;
        const cur = el.getAttribute(ak);
        if (!op) { if (!el.hasAttribute(ak)) return false; }
        else if (op === '=') { if (cur !== av) return false; }
        else if (op === '^=') { if (!cur || !cur.startsWith(av)) return false; }
        rest = rest.slice(m[0].length);
      } else {
        return false;
      }
    }
    return true;
  }
  function matchesSelector(el, sel) {
    if (!el || el.nodeType !== 1) return false;
    return String(sel || '').split(',').some((part) => matchSingle(el, part));
  }

  const doc = {
    nodeType: 9,
    readyState: 'complete',
    hidden: false,
    _listeners: new Map(),
    createElement(tag) {
      const n = new FakeNode(1, tag);
      n.ownerDocument = doc;
      return n;
    },
    createTextNode(txt) {
      const n = new FakeNode(3);
      n.nodeValue = String(txt ?? '');
      n.ownerDocument = doc;
      return n;
    },
    getElementById(id) { return doc.documentElement.querySelector(`#${id}`); },
    querySelector(sel) { return doc.documentElement.querySelector(sel); },
    querySelectorAll(sel) { return doc.documentElement.querySelectorAll(sel); },
    addEventListener(type, fn, capture = false) {
      const key = `${type}:${capture ? 1 : 0}`;
      if (!this._listeners.has(key)) this._listeners.set(key, []);
      this._listeners.get(key).push(fn);
    },
    removeEventListener(type, fn, capture = false) {
      const key = `${type}:${capture ? 1 : 0}`;
      const arr = this._listeners.get(key);
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
  };
  doc.documentElement = doc.createElement('html');
  doc.head = doc.createElement('head');
  doc.body = doc.createElement('body');
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  const store = new Map();
  const win = {
    document: doc,
    innerWidth: 1200,
    innerHeight: 800,
    devicePixelRatio: 1,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    addEventListener() {},
    removeEventListener() {},
    AntigravityCodexEffortSlider: upstreamSlider,
  };
  doc.defaultView = win;
  return { doc, win, store };
}

test('v1.0.7-beta.4: dual-mascot-rig peek mode enforces full pointer pass-through and zero interaction', () => {
  const { doc } = createFakeDom();
  const host = doc.createElement('div');
  host.className = 'ag-cs-crab ag-cs-dual-stage';
  doc.body.appendChild(host);

  const rig = dualMascotRig.mountDualMascotStage(host, { yieldMode: 'none', reducedMotion: true, miniPileEnabled: true });
  assert.ok(rig);
  assert.equal(host.getAttribute('data-ag-mascot-peek'), null);
  const actors = host.querySelectorAll('.ag-v2-mascot-actor');
  assert.equal(actors.length, 2);
  assert.equal(actors[0].getAttribute('tabindex'), '0');
  const miniCrabs = host.querySelectorAll('.ag-v2-mini-crab-canvas');
  assert.ok(miniCrabs.length > 0, 'mini-crabs must mount when miniPileEnabled is true');

  // Switch into peek mode
  rig.setState({ yieldMode: 'peek' });
  assert.equal(host.getAttribute('data-ag-mascot-peek'), '1');
  for (const a of actors) {
    assert.equal(a.getAttribute('tabindex'), '-1');
    assert.equal(a.getAttribute('aria-hidden'), 'true');
    assert.equal(a.style.pointerEvents, 'none');
    assert.equal(a.style.zIndex, '4');
  }
  for (const mc of miniCrabs) {
    assert.equal(mc.style.pointerEvents, 'none', 'mini-crabs must disable pointer events in peek mode');
  }

  // Dispatch pointerdown + contextmenu while peeking -> must NOT call preventDefault / stopPropagation
  let prevented = false;
  let stopped = false;
  const evDown = {
    type: 'pointerdown',
    button: 0,
    clientX: 10,
    clientY: 10,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; prevented = true; },
    stopPropagation() { stopped = true; },
  };
  actors[0].dispatchEvent(evDown);
  assert.equal(prevented, false, 'pointerdown in peek mode must pass through without preventDefault');
  assert.equal(stopped, false, 'pointerdown in peek mode must pass through without stopPropagation');

  const evCtx = {
    type: 'contextmenu',
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; prevented = true; },
    stopPropagation() { stopped = true; },
  };
  actors[0].dispatchEvent(evCtx);
  assert.equal(prevented, false, 'contextmenu in peek mode must pass through');

  // Return to normal mode
  rig.setState({ yieldMode: 'none' });
  assert.equal(host.getAttribute('data-ag-mascot-peek'), null);
  assert.equal(actors[0].getAttribute('tabindex'), '0');
  assert.equal(actors[0].style.pointerEvents, '');
  for (const mc of miniCrabs) {
    assert.equal(mc.style.pointerEvents, 'auto', 'mini-crabs must restore pointerEvents=auto after exiting peek');
  }

  rig.dispose();

  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.ok(css.includes('.ag-cs-crab[data-ag-mascot-peek="1"]'), 'style.css must style peek pass-through');
  assert.ok(!/:has\(/.test(css), 'style.css must stay 0 :has()');
});

test('v1.0.7-beta.4: effortMemory guard remembers per-model & Orchestrator effort when slider is off', async () => {
  const { doc, win } = createFakeDom();
  const argonLow = { label: 'Gemini 4 Argon (Low)', value: 101 };
  const argonMed = { label: 'Gemini 4 Argon (Medium)', value: 102 };
  const argonHigh = { label: 'Gemini 4 Argon (High)', value: 103 };
  const neonMed = { label: 'Gemini 4 Neon (Medium)', value: 201 };
  const neonHigh = { label: 'Gemini 4 Neon (High)', value: 202 };
  const orchOpt = { label: 'Orchestrator', modelId: 'gemini-pro-orchestrator', value: 300 };
  const opusLow = { label: 'Claude Opus 5.5 (Low)', value: 401 };
  const opusMed = { label: 'Claude Opus 5.5 (Medium)', value: 402 };
  const opusHigh = { label: 'Claude Opus 5.5 (High)', value: 403 };

  const effortIndex = new Map([
    ['Gemini 4 Argon', new Map([['low', argonLow], ['medium', argonMed], ['high', argonHigh]])],
    ['Gemini 4 Neon', new Map([['medium', neonMed], ['high', neonHigh]])],
  ]);
  const orchIdx = new Map([
    ['Claude Opus 5.5', new Map([['low', opusLow], ['medium', opusMed], ['high', opusHigh]])],
  ]);

  let selectedModel = argonHigh;
  let orchModelVal = opusLow.value;
  let setIsOpenCalls = 0;
  const committedModels = [];
  const committedKeepOpenArgs = [];
  const committedOrch = [];
  const allModelOpts = [argonLow, argonMed, argonHigh, neonMed, neonHigh, orchOpt];

  const fiberProps = {
    selectedModel,
    modelOptions: allModelOpts,
    effortIndex,
    orchestratorPlanners: [opusLow, opusMed, opusHigh],
    orchestratorPlannerIndex: orchIdx,
    orchestratorDefaultPlanner: opusMed,
    orchestratorPick: {
      model: orchModelVal,
      select(v) {
        orchModelVal = v;
        fiberProps.orchestratorPick.model = v;
        committedOrch.push(v);
      },
    },
    setModelConfigByLabelForConversation(lbl, _cid, keepOpen) {
      const hit = allModelOpts.find((o) => o.label === lbl);
      if (hit) {
        selectedModel = hit;
        fiberProps.selectedModel = hit;
      }
      committedModels.push(lbl);
      committedKeepOpenArgs.push(keepOpen);
    },
    setSelectedModel(opt) {
      selectedModel = opt;
      fiberProps.selectedModel = opt;
      committedModels.push(opt.label);
    },
    setIsOpen() { setIsOpenCalls += 1; },
  };

  const trig = doc.createElement('button');
  trig.setAttribute('data-testid', 'model-selector-trigger');
  const providerFiber = { memoizedProps: { value: fiberProps }, return: null };
  trig.__reactFiber$test = { memoizedProps: fiberProps, return: providerFiber };
  doc.body.appendChild(trig);

  const ctl = sliderCoexist.createEffortSliderController({ window: win, document: doc });
  const st1 = ctl.sync({ effortSliderModule: 'off', effortMemory: 'on' });
  assert.equal(st1.mountedPrism, false);
  assert.equal(st1.memoryGuardActive, true);
  assert.equal(doc.getElementById('ag-codex-effort-slider-styles'), null, 'slider CSS must not mount when slider is off');

  // Switch host selection to Neon Medium, then open native panel
  fiberProps.selectedModel = neonMed;
  const panel = doc.createElement('div');
  panel.setAttribute('data-testid', 'model-selector-panel');
  panel.__reactFiber$test = { memoizedProps: fiberProps, return: providerFiber };

  const argonItem = doc.createElement('div');
  argonItem.setAttribute('role', 'menuitem');
  const argonGrp = doc.createElement('span');
  argonGrp.setAttribute('data-testid', 'model-selector-effort-group');
  argonGrp.setAttribute('data-model-base', 'Gemini 4 Argon');
  argonGrp.textContent = 'Gemini 4 Argon';
  const argonSib = doc.createElement('span');
  argonSib.textContent = 'Medium';
  argonItem.appendChild(argonGrp);
  argonItem.appendChild(argonSib);
  panel.appendChild(argonItem);
  doc.body.appendChild(panel);

  ctl.sync({ effortSliderModule: 'off', effortMemory: 'on' });
  assert.equal(argonSib.textContent, 'High', 'non-selected model row should display remembered High instead of Medium');

  // Click Argon main row (simulates native onDesktopClick switching to Medium, guard restores High in microtask)
  argonItem.dispatchEvent({ type: 'click', target: argonGrp });
  fiberProps.selectedModel = argonMed; // native click selects Medium
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(fiberProps.selectedModel.label, 'Gemini 4 Argon (High)');
  assert.equal(setIsOpenCalls, 0, 'memory guard must NOT force menu open');
  assert.deepEqual(committedKeepOpenArgs, [false], 'setModelConfigByLabelForConversation must receive keepOpen=false in memory-only mode');

  // Explicit click inside Thinking effort submenu for Medium must NOT be overridden
  const subOpt = doc.createElement('span');
  subOpt.setAttribute('data-testid', 'model-selector-effort-option');
  subOpt.setAttribute('data-effort', 'medium');
  subOpt.textContent = 'Medium';
  doc.body.appendChild(subOpt);
  committedModels.length = 0;
  subOpt.dispatchEvent({ type: 'click', target: subOpt });
  fiberProps.selectedModel = argonMed;
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(committedModels.length, 0, 'explicit submenu click must not be overridden');

  // Record Orchestrator Opus Low, switch away to Neon, then click Orchestrator L2 row -> restores Low
  fiberProps.selectedModel = orchOpt;
  fiberProps.orchestratorPick.model = opusLow.value;
  ctl.sync({ effortSliderModule: 'off', effortMemory: 'on' });

  fiberProps.selectedModel = neonMed;
  const orchL2Row = doc.createElement('div');
  orchL2Row.setAttribute('data-testid', 'orchestrator-picker-row');
  orchL2Row.setAttribute('data-model-base', 'Claude Opus 5.5');
  const orchL2Eff = doc.createElement('span');
  orchL2Eff.className = 'shrink-0 opacity-70';
  orchL2Eff.textContent = 'Medium';
  orchL2Row.appendChild(orchL2Eff);
  doc.body.appendChild(orchL2Row);

  ctl.sync({ effortSliderModule: 'off', effortMemory: 'on' });
  assert.equal(orchL2Eff.textContent, 'Low', 'Orchestrator L2 row should display remembered Low');

  committedOrch.length = 0;
  orchL2Row.dispatchEvent({ type: 'click', target: orchL2Row });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(committedOrch, [opusLow.value]);

  // Fallback non-testid Orchestrator L2 submenu click must ALSO restore remembered Low, while L3 explicit click must NOT override
  const nonTestIdSub = doc.createElement('div');
  nonTestIdSub.setAttribute('role', 'menu');
  const subPlanItem = doc.createElement('div');
  subPlanItem.setAttribute('role', 'menuitem');
  subPlanItem.textContent = 'Claude Opus 5.5';
  nonTestIdSub.appendChild(subPlanItem);
  doc.body.appendChild(nonTestIdSub);

  committedOrch.length = 0;
  subPlanItem.dispatchEvent({ type: 'click', target: subPlanItem });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(committedOrch, [opusLow.value], 'non-testid Orchestrator L2 fallback must restore remembered Low');

  const nonTestIdL3 = doc.createElement('div');
  nonTestIdL3.setAttribute('role', 'menu');
  const l3Med = doc.createElement('div');
  l3Med.setAttribute('role', 'menuitem');
  l3Med.textContent = 'Medium';
  nonTestIdL3.appendChild(l3Med);
  doc.body.appendChild(nonTestIdL3);

  committedOrch.length = 0;
  l3Med.dispatchEvent({ type: 'click', target: l3Med });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(committedOrch, [], 'explicit L3 effort click must NOT be overridden');

  // Turning effortMemory off stops guard completely
  const stOff = ctl.sync({ effortSliderModule: 'off', effortMemory: 'off' });
  assert.equal(stOff.memoryGuardActive, false);
  ctl.destroy();
});

test('v1.0.7-beta.4: host-i18n rollbackAllSnapshots restores detached-then-reattached nodes without leaks', () => {
  const { doc, win } = createFakeDom();
  const btn = doc.createElement('button');
  btn.setAttribute('aria-label', 'Settings');
  const txt = doc.createTextNode('Settings');
  btn.appendChild(txt);
  doc.body.appendChild(btn);

  const inst = hostI18nFactory.mountHostI18n({
    root: win,
    doc,
    mode: 'on',
    dict: { exact: { Settings: '设置' } },
  });
  assert.equal(txt.nodeValue, '设置');
  assert.equal(btn.getAttribute('aria-label'), '设置');

  // Simulate React temporarily detaching node while tracker prunes, then reattaching same node
  doc.body.removeChild(btn);
  inst.getStatus(); // triggers countTranslatedUnits -> prune()
  doc.body.appendChild(btn);

  // Destroy must STILL roll back both text and aria-label!
  inst.destroy();
  assert.equal(txt.nodeValue, 'Settings');
  assert.equal(btn.getAttribute('aria-label'), 'Settings');
});

test('v1.0.7-beta.4: effort slider settings popup & new i18n keys have complete English translations', () => {
  const { doc, win } = createFakeDom();
  doc.documentElement.setAttribute('data-ag-cs-lang', 'en');
  const close = upstreamSlider.openSettingsPanel({ document: doc, window: win });
  const dlg = doc.querySelector('.ces-set');
  assert.ok(dlg);
  assert.ok(!/[\u4e00-\u9fff]/.test(dlg.textContent), `English slider settings popup leaked Chinese: ${dlg.textContent}`);
  assert.ok(dlg.textContent.includes('Effort Slider'));
  assert.ok(dlg.textContent.includes('Animation'));
  assert.ok(dlg.textContent.includes('Close'));
  close();

  for (const lang of ['zh-CN', 'zh-TW', 'yue', 'en', 'ja']) {
    const ui = locales.getUiStrings(lang);
    assert.ok(ui.setEffortMemoryTitle, `missing setEffortMemoryTitle for ${lang}`);
    assert.ok(ui.setEffortMemoryDesc, `missing setEffortMemoryDesc for ${lang}`);
    assert.ok(ui.hostI18nOffExtHint, `missing hostI18nOffExtHint for ${lang}`);
  }
  const enUi = locales.getUiStrings('en');
  assert.ok(!/[\u4e00-\u9fff]/.test(enUi.setEffortMemoryTitle + enUi.setEffortMemoryDesc + enUi.hostI18nOffExtHint));
});

test('v1.0.7-beta.4: Issue #38 macOS relaunch normalizes .app bundle, strips ELECTRON_RUN_AS_NODE, waits for Helpers & SingletonLock, uses open -na', () => {
  assert.equal(
    cdp.normalizeMacAppBundlePath('/Applications/Antigravity.app/Contents/MacOS/Antigravity'),
    '/Applications/Antigravity.app'
  );
  assert.equal(
    cdp.normalizeMacAppBundlePath('/Users/alice/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper.app'),
    '/Users/alice/Applications/Antigravity.app'
  );
  assert.equal(cdp.normalizeMacAppBundlePath(''), '/Applications/Antigravity.app');

  const sh = cdp.MAC_DETACHED_RELAUNCH_SH;
  assert.ok(sh.includes('unset ELECTRON_RUN_AS_NODE'));
  assert.ok(sh.includes('SingletonLock'));
  assert.ok(sh.includes('Contents/MacOS/'));
  assert.ok(sh.includes('open -na "$app_path" --args --remote-debugging-port=0'));
  assert.ok(sh.includes('on run argv'), 'AppleScript quit must use argv instead of string interpolation');
});

test('v1.0.7-beta.4: ui-runtime immediately destroys host-i18n on off/en, shows external zh hint, and toggles mascot peek on takeover/queued/model-menu', () => {
  const vm = require('node:vm');
  const { doc, win } = createFakeDom();
  doc.documentElement.setAttribute('data-ag-prism-host-i18n', 'active');

  let hostI18nDestroyed = 0;
  let hostI18nModes = [];
  win.__agPrismHostI18n = {
    destroy() { hostI18nDestroyed += 1; },
    setMode(m) { hostI18nModes.push(m); },
  };
  win.performance = { now: () => Date.now() };
  win.requestAnimationFrame = () => 0;
  win.cancelAnimationFrame = () => {};
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  win.setInterval = () => 0;
  win.clearInterval = () => {};
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  win.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1', position: 'static', getPropertyValue: () => '' });
  win.ResizeObserver = class { observe() {} disconnect() {} };
  win.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  win.HTMLElement = Object;
  win.Element = Object;
  win.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
  win.navigator = { language: 'zh-CN' };

  // Build composer + model-selector + takeover card + settings panel with external zh marker
  const conv = doc.createElement('div');
  conv.setAttribute('data-testid', 'conversation-view');
  const inputBox = doc.createElement('div');
  inputBox.setAttribute('data-testid', 'agent-input-box');
  const card = doc.createElement('div');
  card.className = 'surface-composer-card';
  const trig = doc.createElement('button');
  trig.setAttribute('data-testid', 'model-selector-trigger');
  trig.textContent = 'Gemini 4 Argon Medium';
  card.appendChild(trig);
  inputBox.appendChild(card);
  conv.appendChild(inputBox);
  doc.body.appendChild(conv);

  const extBadge = doc.createElement('div');
  extBadge.setAttribute('data-agy-hans-ui', '1');
  doc.body.appendChild(extBadge);

  const sandbox = {
    window: null,
    globalThis: null,
    document: doc,
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    performance: win.performance,
    navigator: win.navigator,
    location: { href: 'https://127.0.0.1:7020/c/11111111-1111-1111-1111-111111111111', pathname: '/c/11111111-1111-1111-1111-111111111111' },
    localStorage: win.localStorage,
    requestAnimationFrame: win.requestAnimationFrame,
    cancelAnimationFrame: win.cancelAnimationFrame,
    matchMedia: win.matchMedia,
    getComputedStyle: win.getComputedStyle,
    ResizeObserver: win.ResizeObserver,
    MutationObserver: win.MutationObserver,
    HTMLElement: win.HTMLElement,
    Element: win.Element,
    Node: win.Node,
    __agPrismHostI18n: win.__agPrismHostI18n,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  doc.defaultView = sandbox;

  const expr = cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, hostLocalization: 'on', language: 'zh-CN' });
  const res = vm.runInNewContext(expr, sandbox);
  assert.equal(res.status, 'ok');
  try {
    // Initially no popup/card -> mascot NOT peeking
    const crab = card.querySelector('.ag-cs-crab');
    assert.ok(crab);
    assert.equal(crab.getAttribute('data-ag-mascot-peek'), null);

    // Add visible Q&A takeover card -> mascot enters peek mode
    const tk = doc.createElement('div');
    tk.setAttribute('data-testid', 'interaction-takeover-card');
    tk.textContent = 'Question?';
    conv.insertBefore(tk, inputBox);
    sandbox.__agPrism.sync();
    assert.equal(crab.getAttribute('data-ag-mascot-peek'), '1', 'takeover card must trigger peek');

    // Remove takeover card, open model menu -> mascot stays in peek mode
    tk.remove();
    const mdl = doc.createElement('div');
    mdl.setAttribute('data-testid', 'model-selector-panel');
    doc.body.appendChild(mdl);
    sandbox.__agPrism.sync();
    assert.equal(crab.getAttribute('data-ag-mascot-peek'), '1', 'model menu must trigger peek');

    // Remove model menu -> mascot leaves peek mode
    mdl.remove();
    sandbox.__agPrism.sync();
    assert.equal(crab.getAttribute('data-ag-mascot-peek'), null, 'closing overlays must exit peek');

    // Toggle hostLocalization to 'off' -> immediately calls window.__agPrismHostI18n.destroy()
    const beforeDestroy = hostI18nDestroyed;
    sandbox.__agPrism.saveSettingsBatch({ hostLocalization: 'off' });
    sandbox.__agPrism.sync();
    assert.ok(hostI18nDestroyed > beforeDestroy, 'switching hostLocalization to off must immediately call destroy()');
    assert.equal(doc.documentElement.getAttribute('data-ag-prism-host-i18n'), null);

    // Settings panel in hostLocalization === 'off' with [data-agy-hans-ui] shows external localization notice
    const dlg = doc.createElement('div');
    dlg.setAttribute('role', 'dialog');
    const pane = doc.createElement('div');
    pane.className = 'p-6';
    const h2 = doc.createElement('h2');
    h2.textContent = 'Appearance';
    pane.appendChild(h2);
    const nativeSec = doc.createElement('div');
    nativeSec.className = 'space-y-2';
    pane.appendChild(nativeSec);
    dlg.appendChild(pane);
    doc.body.appendChild(dlg);
    sandbox.__agPrism.sync();

    const sec = doc.getElementById('ag-cs-settings-sec');
    assert.ok(sec);
    const toggleBtn = sec.querySelector('button[aria-expanded]');
    if (toggleBtn && toggleBtn.getAttribute('aria-expanded') === 'false') {
      toggleBtn.dispatchEvent({ type: 'click', target: toggleBtn });
    }
    sandbox.__agPrism.sync();
    const hiDesc = sec.querySelector('[data-ag-cs-row="hostLocalization"] [data-k="d"]');
    assert.ok(hiDesc);
    assert.equal(hiDesc.textContent, locales.getUiStrings('zh-CN').hostI18nOffExtHint);
    assert.equal(hiDesc.getAttribute('data-ag-cs-hi-warn'), 'ext');

    // Switching to auto + English while external zh patch is active must ALSO show the external-i18n warning pill
    sandbox.__agPrism.saveSettingsBatch({ hostLocalization: 'auto', language: 'en' });
    sandbox.__agPrism.sync();
    const secEn = doc.getElementById('ag-cs-settings-sec');
    const toggleBtnEn = secEn?.querySelector('button[aria-expanded]');
    if (toggleBtnEn && toggleBtnEn.getAttribute('aria-expanded') === 'false') {
      toggleBtnEn.dispatchEvent({ type: 'click', target: toggleBtnEn });
    }
    sandbox.__agPrism.sync();
    const hiDescEn = secEn?.querySelector('[data-ag-cs-row="hostLocalization"] [data-k="d"]');
    assert.ok(hiDescEn);
    assert.equal(hiDescEn.textContent, locales.getUiStrings('en').hostI18nOffExtHint);
    assert.equal(hiDescEn.getAttribute('data-ag-cs-hi-warn'), 'ext');
  } finally {
    sandbox.__agPrism?.destroy?.();
  }
});
