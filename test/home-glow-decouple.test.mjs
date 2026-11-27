import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const cdp = require(path.join(ROOT, 'cdp.js'));
const { createConfigStore } = require(path.join(ROOT, 'src/config/store.cjs'));
const homeRippleHost = require(path.join(ROOT, 'home-ripple-host.js'));

const CJK_RE = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

function makeMiniEl(tag, doc) {
  const attrs = new Map();
  const listeners = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    style: {},
    dataset: {},
    clientWidth: 960,
    clientHeight: 600,
    width: 0,
    height: 0,
    parentNode: null,
    parentElement: null,
    children: [],
    ownerDocument: doc,
    get firstChild() { return this.children[0] || null; },
    get isConnected() {
      let cur = this;
      while (cur) {
        if (cur === doc.body || cur === doc.documentElement) return true;
        cur = cur.parentNode;
      }
      return false;
    },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
    hasAttribute(k) { return attrs.has(k); },
    removeAttribute(k) { attrs.delete(k); },
    appendChild(child) {
      if (child.parentNode) child.remove();
      child.parentNode = this;
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    insertBefore(child, ref) {
      if (child.parentNode) child.remove();
      child.parentNode = this;
      child.parentElement = this;
      const idx = ref ? this.children.indexOf(ref) : -1;
      if (idx >= 0) this.children.splice(idx, 0, child);
      else this.children.push(child);
      return child;
    },
    remove() {
      if (!this.parentNode) return;
      const idx = this.parentNode.children.indexOf(this);
      if (idx >= 0) this.parentNode.children.splice(idx, 1);
      this.parentNode = null;
      this.parentElement = null;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: this.clientWidth || 960, height: this.clientHeight || 600 };
    },
    querySelector(sel) {
      if (sel === '.agy-home' && this.className.includes('agy-home')) return this;
      for (const ch of this.children) {
        const hit = ch.querySelector(sel);
        if (hit) return hit;
      }
      return null;
    },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains(node) {
      let cur = node;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
    },
    getContext() { return null; },
  };
  return el;
}

function createHomeEnv() {
  const doc = {
    hidden: false,
    documentElement: null,
    body: null,
    listeners: new Map(),
    createElement(tag) { return makeMiniEl(tag, doc); },
    addEventListener(t, fn) { if (!this.listeners.has(t)) this.listeners.set(t, new Set()); this.listeners.get(t).add(fn); },
    removeEventListener(t, fn) { this.listeners.get(t)?.delete(fn); },
    querySelector(sel) { return this.body.querySelector(sel); },
    querySelectorAll() { return []; },
  };
  doc.documentElement = makeMiniEl('html', doc);
  doc.body = makeMiniEl('body', doc);
  doc.documentElement.appendChild(doc.body);
  const home = makeMiniEl('div', doc);
  home.className = 'agy-home';
  doc.body.appendChild(home);
  return { doc, home };
}

test('Issue #149 schema, config.example.json, registry, and legacy config migration for homeGlow', () => {
  assert.ok(cdp.CONFIG_SCHEMA.homeGlow, 'CONFIG_SCHEMA must define homeGlow');
  assert.equal(cdp.CONFIG_SCHEMA.homeGlow.type, 'boolean');
  assert.equal(cdp.CONFIG_SCHEMA.homeGlow.default, true);
  assert.equal(cdp.DEFAULT_CONFIG.homeGlow, true);

  const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
  assert.equal(example.homeGlow, true, 'config.example.json must expose homeGlow: true');

  const chSettings = cdp.findChannel('settings');
  assert.ok(chSettings.configKeys.includes('homeGlow'), 'Ch9 settings channel must watch homeGlow');

  // Legacy migration in store.cjs readConfig()
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-homeglow-'));
  const cfgPath = path.join(tmpDir, 'config.json');
  const store = createConfigStore({ configFile: cfgPath });
  try {
    // 1) Legacy config with homeRipple: false and missing homeGlow -> migrates homeGlow to false
    fs.writeFileSync(cfgPath, JSON.stringify({ homeRipple: false }), 'utf8');
    store.invalidateConfigCache();
    const migrated1 = store.readConfig();
    assert.equal(migrated1.homeRipple, false);
    assert.equal(migrated1.homeGlow, false);

    // 2) Legacy config with ripple: "off" and missing homeGlow -> migrates homeGlow to false
    fs.writeFileSync(cfgPath, JSON.stringify({ ripple: 'off' }), 'utf8');
    store.invalidateConfigCache();
    const migrated2 = store.readConfig();
    assert.equal(migrated2.homeRipple, false);
    assert.equal(migrated2.homeGlow, false);

    // 3) Explicit homeRipple: false + homeGlow: true -> preserves independent glow!
    fs.writeFileSync(cfgPath, JSON.stringify({ homeRipple: false, homeGlow: true }), 'utf8');
    store.invalidateConfigCache();
    const explicit = store.readConfig();
    assert.equal(explicit.homeRipple, false);
    assert.equal(explicit.homeGlow, true);

    // 4) Explicit homeRipple: true + homeGlow: false -> preserves ripple-only!
    fs.writeFileSync(cfgPath, JSON.stringify({ homeRipple: true, homeGlow: false }), 'utf8');
    store.invalidateConfigCache();
    const rippleOnly = store.readConfig();
    assert.equal(rippleOnly.homeRipple, true);
    assert.equal(rippleOnly.homeGlow, false);

    // 5) Single-key reconcileConfigAliases({ homeRipple: false }) must NOT fabricate homeGlow: false
    const patchReconciled = cdp.reconcileConfigAliases({ homeRipple: false });
    assert.equal(Object.prototype.hasOwnProperty.call(patchReconciled, 'homeGlow'), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Issue #149 home-ripple-host independently controls homeGlow and homeRipple with zero idle/worker overhead', () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCaf = globalThis.cancelAnimationFrame;
  const prevRO = globalThis.ResizeObserver;
  const prevMO = globalThis.MutationObserver;
  const prevPerf = globalThis.performance;
  const prevWorker = globalThis.__agPrismRippleWorker;

  const { doc } = createHomeEnv();
  let nowMs = 1000;
  let rafSeq = 0;
  const rafQueue = [];
  const flushRaf = (ts = nowMs) => {
    const batch = rafQueue.splice(0, rafQueue.length);
    for (const item of batch) if (!item.cancelled) item.fn(ts);
  };

  const counts = {
    createWaveField: 0,
    createGlyphField: 0,
    mountManagedField: 0,
    mountBrandHorizonGlow: 0,
    mountManagedGlow: 0,
    fieldDraws: 0,
    fieldDisposes: 0,
    glowDraws: 0,
    glowDisposes: 0,
    mascotPresses: 0,
  };

  const mockCore = {
    RIPPLE: { cellWidth: 20, cellHeight: 20 },
    parseCssColorToRgb: () => null,
    createWaveField() {
      counts.createWaveField += 1;
      return { active: () => false, disturb() {}, advance() {}, skimmer() {} };
    },
    createGlyphField() {
      counts.createGlyphField += 1;
      return {
        mode: '2d',
        draw() { counts.fieldDraws += 1; },
        invalidate() {},
        needsDraw: () => false,
        busy: () => false,
        dispose() { counts.fieldDisposes += 1; },
        resize() {},
        setCalmZones() {},
      };
    },
    mountBrandHorizonGlow(canvas) {
      counts.mountBrandHorizonGlow += 1;
      return {
        mode: '2d',
        resize(w, h) { canvas.width = Math.max(1, Math.round(w)); canvas.height = Math.max(1, Math.round(h)); },
        draw() { counts.glowDraws += 1; },
        clear() {},
        invalidate() {},
        setPaused() {},
        dispose() { counts.glowDisposes += 1; },
      };
    },
  };

  globalThis.__agPrismRippleWorker = {
    mountManagedField() {
      counts.mountManagedField += 1;
      return mockCore.createGlyphField();
    },
    mountManagedGlow(opts) {
      counts.mountManagedGlow += 1;
      return mockCore.mountBrandHorizonGlow(opts.getCanvas());
    },
  };

  globalThis.document = doc;
  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  globalThis.requestAnimationFrame = (fn) => { const id = ++rafSeq; rafQueue.push({ id, fn, cancelled: false }); return id; };
  globalThis.cancelAnimationFrame = (id) => { const it = rafQueue.find((x) => x.id === id); if (it) it.cancelled = true; };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.performance = { now: () => nowMs };

  let allowRipple = false;
  let allowGlow = true;
  let ctl = null;
  try {
    ctl = homeRippleHost.createHomeRippleController({
      rippleCore: mockCore,
      isDestroyed: () => false,
      isAllowed: () => allowRipple,
      isGlowAllowed: () => allowGlow,
      isConvAllowed: () => false,
      getConvLevel: () => 'off',
      isDarkTheme: () => true,
      motionReduced: () => false,
      getMinFrameGapMs: () => 0,
      getAmbientIntensity: () => 1,
      getAccentTone: () => 'follow',
      setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
      onPointerPressMascot: () => { counts.mascotPresses += 1; },
    });

    // Mode 1: glow-only (homeRipple=false, homeGlow=true)
    ctl.sync();
    let rm = ctl.getMount();
    assert.ok(rm, 'glow-only must mount host');
    assert.equal(rm.canvas, null, 'glow-only must NOT create ripple canvas');
    assert.ok(rm.glowCanvas, 'glow-only must create brand-glow canvas');
    assert.equal(counts.createWaveField, 0, 'glow-only must NOT create wave field');
    assert.equal(counts.createGlyphField, 0, 'glow-only must NOT create glyph field');
    assert.equal(counts.mountManagedField, 0, 'glow-only must NOT start glyph worker');
    assert.equal(counts.mountManagedGlow, 1, 'glow-only mounts glow');

    flushRaf(nowMs);
    assert.ok(counts.glowDraws >= 1, 'glow-only must render bottom glow');
    assert.equal(counts.fieldDraws, 0, 'glow-only must never draw glyph field');

    // Settle past INTRO_MS -> sleeps cleanly and mouse move causes zero rAF wakeups
    nowMs += 2000;
    flushRaf(nowMs);
    assert.equal(rm.sleeping, true, 'glow-only must enter idle sleep after intro');
    const rafBeforeMove = rafSeq;
    rm.onMove({ clientX: 200, clientY: 200, target: rm.root });
    assert.equal(rafSeq, rafBeforeMove, 'glow-only mousemove must not schedule rAF');
    rm.onPress({ button: 0, clientX: 220, clientY: 220, target: rm.root });
    assert.equal(counts.mascotPresses, 1, 'glow-only click still notifies mascot');

    // Mode 2: hot toggle to ripple-only (homeRipple=true, homeGlow=false)
    allowRipple = true;
    allowGlow = false;
    ctl.sync();
    flushRaf(nowMs);
    rm = ctl.getMount();
    assert.ok(rm.canvas, 'ripple-only must create ripple canvas');
    assert.equal(rm.glowCanvas, null, 'ripple-only must remove brand-glow canvas');
    assert.equal(counts.glowDisposes, 1, 'ripple-only must dispose previous glow');
    assert.equal(counts.createWaveField, 1, 'ripple-only creates wave field');
    assert.equal(counts.createGlyphField, 1, 'ripple-only creates glyph field');
    flushRaf(nowMs + 40);
    assert.ok(counts.fieldDraws >= 1, 'ripple-only must render glyph field');

    // Mode 3: hot toggle to both on (homeRipple=true, homeGlow=true)
    allowRipple = true;
    allowGlow = true;
    ctl.sync();
    flushRaf(nowMs + 80);
    rm = ctl.getMount();
    assert.ok(rm.canvas && rm.glowCanvas, 'both-on must have both canvases');
    assert.equal(counts.mountManagedGlow, 2, 'both-on remounts glow');

    // Mode 4: both off -> complete unmount (0 DOM, 0 resources)
    allowRipple = false;
    allowGlow = false;
    ctl.sync();
    assert.equal(ctl.getMount(), null, 'both-off must completely unmount');
    assert.equal(doc.querySelector('.ag-cs-ripple-host'), null, 'both-off removes host DOM');

    // Backward compat: omitting isGlowAllowed follows isAllowed
    let legacyOn = true;
    const legacyCtl = homeRippleHost.createHomeRippleController({
      rippleCore: mockCore,
      isDestroyed: () => false,
      isAllowed: () => legacyOn,
      isConvAllowed: () => false,
      getConvLevel: () => 'off',
      isDarkTheme: () => true,
      motionReduced: () => false,
      getMinFrameGapMs: () => 0,
      getAmbientIntensity: () => 1,
      getAccentTone: () => 'follow',
      setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    });
    legacyCtl.sync();
    assert.ok(legacyCtl.getMount()?.canvas && legacyCtl.getMount()?.glowCanvas, 'omitted isGlowAllowed follows isAllowed=true');
    legacyOn = false;
    legacyCtl.sync();
    assert.equal(legacyCtl.getMount(), null, 'omitted isGlowAllowed unmounts when isAllowed=false');
    legacyCtl.unmount();
  } finally {
    ctl?.unmount();
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCaf;
    globalThis.ResizeObserver = prevRO;
    globalThis.MutationObserver = prevMO;
    globalThis.performance = prevPerf;
    if (prevWorker === undefined) delete globalThis.__agPrismRippleWorker;
    else globalThis.__agPrismRippleWorker = prevWorker;
  }
});

test('Issue #149 9-locale i18n copy (0 CJK in non-CJK) and settings-ext-beta4 homeGlow toggle row', () => {
  const i18nSrc = fs.readFileSync(path.join(ROOT, 'src/runtime/i18n-ext-beta4.js'), 'utf8');
  const sb = { globalThis: null };
  sb.globalThis = sb;
  sb.window = sb;
  vm.runInNewContext(i18nSrc, sb);

  const ext = sb.__agPrismI18nExtBeta4;
  assert.ok(ext, 'i18n-ext-beta4 must register __agPrismI18nExtBeta4');
  const langs = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'tr'];
  const nonCjk = new Set(['en', 'ko', 'es', 'fr', 'de', 'tr']);
  for (const lang of langs) {
    const s = ext.getStrings(lang);
    assert.ok(s?.setHomeGlowTitle, `${lang} missing setHomeGlowTitle`);
    assert.ok(s?.setHomeGlowDesc, `${lang} missing setHomeGlowDesc`);
    if (nonCjk.has(lang)) {
      assert.equal(CJK_RE.test(s.setHomeGlowTitle), false, `${lang} title must have 0 CJK`);
      assert.equal(CJK_RE.test(s.setHomeGlowDesc), false, `${lang} desc must have 0 CJK`);
    }
  }

  // Verify settings-panel presets & ui-runtime integration
  const spSrc = fs.readFileSync(path.join(ROOT, 'settings-panel.js'), 'utf8');
  assert.ok(spSrc.includes('homeGlow: S_T'), 'settings-panel.js schema must include homeGlow: S_T');
  const uiSrc = fs.readFileSync(path.join(ROOT, 'ui-runtime.js'), 'utf8');
  assert.ok(uiSrc.includes("'homeGlow'"), 'ui-runtime.js must include homeGlow in BT_KEYS');
  assert.ok(uiSrc.includes('isGlowAllowed:'), 'ui-runtime.js must pass isGlowAllowed to home-ripple-host');

  // Verify settings-ext-beta4 renders homeGlow row directly after homeRipple and persists changes
  const extUiSrc = fs.readFileSync(path.join(ROOT, 'src/runtime/settings-ext-beta4.js'), 'utf8');
  const uiSb = { globalThis: null, __agPrismI18nExtBeta4: ext };
  uiSb.globalThis = uiSb;
  uiSb.window = uiSb;
  vm.runInNewContext(extUiSrc, uiSb);

  const saved = [];
  const makeNode = (tag) => {
    const attrs = new Map();
    const cls = new Set();
    const evs = new Map();
    const n = {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      type: '',
      style: {},
      disabled: false,
      parentElement: null,
      children: [],
      classList: {
        add(c) { cls.add(c); },
        remove(c) { cls.delete(c); },
        toggle(c, on) { if (on) cls.add(c); else cls.delete(c); },
        contains(c) { return cls.has(c); },
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(ch) { ch.parentElement = this; this.children.push(ch); return ch; },
      insertBefore(ch, ref) {
        ch.parentElement = this;
        const i = ref ? this.children.indexOf(ref) : -1;
        if (i >= 0) this.children.splice(i, 0, ch);
        else this.children.push(ch);
        return ch;
      },
      get nextSibling() {
        if (!this.parentElement) return null;
        const i = this.parentElement.children.indexOf(this);
        return i >= 0 ? this.parentElement.children[i + 1] || null : null;
      },
      addEventListener(t, fn) { evs.set(t, fn); },
      click() { evs.get('click')?.({ stopPropagation() {} }); },
      _matches(sel) {
        const mTagAttr = sel.match(/^([a-z]+)\[([^=]+)="([^"]+)"\]$/i);
        if (mTagAttr) return this.tagName === mTagAttr[1].toUpperCase() && this.getAttribute(mTagAttr[2]) === mTagAttr[3];
        const mAttr = sel.match(/^\[([^=]+)="([^"]+)"\]$/);
        if (mAttr) return this.getAttribute(mAttr[1]) === mAttr[2];
        const mTag = sel.match(/^([a-z]+)\.([a-z0-9_-]+)$/i);
        if (mTag) return this.tagName === mTag[1].toUpperCase() && this.className.split(/\s+/).includes(mTag[2]);
        if (sel.startsWith('.')) return this.className.split(/\s+/).includes(sel.slice(1));
        return false;
      },
      querySelector(sel) {
        for (const ch of this.children) {
          if (ch._matches(sel)) return ch;
          const sub = ch.querySelector(sel);
          if (sub) return sub;
        }
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        for (const ch of this.children) {
          if (ch._matches(sel)) out.push(ch);
          out.push(...ch.querySelectorAll(sel));
        }
        return out;
      },
    };
    return n;
  };

  const doc = { createElement: (t) => makeNode(t), head: makeNode('head'), getElementById: () => null };
  const panel = makeNode('div');
  panel.setAttribute('data-body-built', '1');
  const card = makeNode('div');
  const rippleRow = makeNode('div');
  rippleRow.setAttribute('data-ag-cs-row', 'homeRipple');
  card.appendChild(rippleRow);
  panel.appendChild(card);

  const cfg = { homeRipple: true, homeGlow: true, motionLevel: 'ultra', homeLayout: 'studio', language: 'en' };
  const ctx = {
    doc,
    win: {},
    lang: 'en',
    effVal: (k) => cfg[k],
    saveSetting: (k, v) => { cfg[k] = v; saved.push([k, v]); },
  };
  uiSb.__agPrismSettingsExtBeta4.sync(panel, ctx);

  assert.equal(card.children.length, 2, 'homeGlow row must be inserted into the same card');
  const glowRow = card.children[1];
  assert.equal(glowRow.getAttribute('data-ag-cs-row'), 'homeGlow');
  const grp = glowRow.querySelector('.ag-cs-seg-group');
  assert.equal(grp.getAttribute('data-switch-on'), '1');
  const offBtn = glowRow.querySelector('button[data-ag-cs-ext-role="off"]');
  assert.ok(offBtn, 'homeGlow row must expose off switch button');

  // Toggle off
  offBtn.click();
  assert.deepEqual(saved, [['homeGlow', false]]);

  // Re-sync with motionLevel=off -> dimmed
  cfg.motionLevel = 'off';
  uiSb.__agPrismSettingsExtBeta4.sync(panel, ctx);
  assert.equal(glowRow.getAttribute('data-ag-cs-dimmed'), '1');
  assert.equal(glowRow.style.opacity, '0.55');
});
