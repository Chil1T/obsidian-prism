import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cdp = require('../cdp.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('step-plan checklist card and home-panel align with Obsidian Prism floating overview-shell optics across light and dark themes', () => {
  const rawBuf = fs.readFileSync(path.join(ROOT, 'style.css'));
  assert.equal(rawBuf[0] === 0xef && rawBuf[1] === 0xbb && rawBuf[2] === 0xbf, false, 'style.css must have 0 UTF-8 BOM');
  const css = rawBuf.toString('utf8');
  assert.equal(css.includes('\r'), false, 'style.css must have 0 CRLF');

  const lightBlockIdx = css.indexOf('html[data-ag-cs-style][data-ag-cs-theme="light"]');
  assert.ok(lightBlockIdx > 0, 'style.css must contain light-theme override block');

  const baseSection = css.slice(0, lightBlockIdx);
  const lightSection = css.slice(lightBlockIdx);

  const spLine = css.split('\n').find((l) => l.includes('[data-testid="step-plan-item"]{')) || '';
  assert.ok(spLine.length > 0, 'must style step-plan-item');

  // PR #43 local-variable architecture + floating overview-shell material on step-plan
  assert.ok(spLine.includes('& [data-testid="step-plan"]{'), 'must style step-plan card');
  assert.ok(spLine.includes('border-radius:13px !important;'), 'step-plan must match overview-shell 13px radius');
  assert.ok(spLine.includes('var(--ag-cs-menu-bg,var(--ag-cs-panel-bg,rgba(14,16,22,.94)))'), 'step-plan must share overview-shell dark obsidian surface');
  assert.ok(spLine.includes('var(--ag-cs-menu-sheen)'), 'step-plan must share overview-shell top-light micro-prism sheen');
  assert.ok(spLine.includes('var(--ag-cs-menu-bd)'), 'step-plan must share overview-shell 1px stepped border');
  assert.ok(spLine.includes('inset 0 1px 0 rgba(235,243,255,.115)'), 'step-plan must share overview-shell top specular highlight');
  assert.ok(spLine.includes('& [data-testid="step-plan-chip"]{'), 'must style step-plan-chip');
  assert.ok(spLine.includes('&[data-status="in_progress"]{--_sc:var(--warning);') && spLine.includes('&>svg{'), 'must differentiate paused in_progress svg with static amber ring');
  assert.ok(spLine.includes('&[data-status="done"]{'), 'must style done state');
  assert.ok(spLine.includes('&[data-status="pending"]{'), 'must style pending state');
  assert.ok(spLine.includes('&[data-status="failed"]{'), 'must style failed state');
  assert.ok(spLine.includes('&[data-status="skipped"]{'), 'must style skipped state');
  assert.ok(spLine.includes('translate:-50% -50%;') && !spLine.includes('transform:translate('), 'pseudo-element centering must use individual translate before individual rotate');
  assert.equal(spLine.includes('opacity:'), false, 'step-plan-item text must not stack low opacity over --muted-foreground');

  // State transition keyframe, reduced-motion (--_sa:none), and Windows High Contrast fallback
  const kfLine = css.split('\n').find((l) => l.includes('@keyframes ag-sp-in{')) || '';
  assert.ok(kfLine.length > 0, 'must define restrained ag-sp-in transition keyframe');
  assert.equal(kfLine.includes('scale(1.08)'), false, 'step-plan transition must avoid bounce overshoot');
  assert.ok(baseSection.includes('@media (forced-colors:active){[data-testid="step-plan-item"]>:first-child{&>svg{display:block !important;}'), 'forced-colors must restore native SVG icons');
  assert.ok(baseSection.includes('--ag-spring-sidebar:linear;--_sa:none;'), 'motion="off" must disable step-plan state animations via --_sa:none');
  assert.ok(baseSection.includes('@media (prefers-reduced-motion:reduce){html[data-ag-cs-style]{--_sa:none;}'), 'prefers-reduced-motion must disable step-plan state animations via --_sa:none');
  assert.ok(baseSection.includes('--ag-cs-run-core:#FFFFFF;--_si:#000;'), 'light theme must flip inner glyph tint polarity via --_si:#000');

  // Home panel upgraded to floating overview-shell material while preserving backdrop-filter:none & zero blur(
  const homePanelLine = css.split('\n').find((l) => l.startsWith('.ag-cs-home-panel{')) || '';
  assert.ok(homePanelLine.includes('border-radius:13px;'), '.ag-cs-home-panel must share overview-shell 13px radius');
  assert.ok(homePanelLine.includes('var(--ag-cs-menu-bg,'), '.ag-cs-home-panel must share overview-shell obsidian surface');
  assert.ok(homePanelLine.includes('var(--ag-cs-menu-sheen)'), '.ag-cs-home-panel must share overview-shell top-light sheen');
  assert.ok(homePanelLine.includes('backdrop-filter:none') && !homePanelLine.includes('blur('), '.ag-cs-home-panel must keep backdrop-filter:none with zero blur(');

  // Shared inset:0 prism-rim canvas positioning for overview-shell, step-plan, and home-panel
  assert.ok(baseSection.includes('[data-ag-cs-prism-mirror="1"]>.ag-cs-prism-rim-cv,& [data-testid="step-plan"]>.ag-cs-prism-rim-cv,& .ag-cs-home-panel>.ag-cs-prism-rim-cv{'), 'step-plan and home-panel must mount inset:0 prism-rim canvas');

  // Light theme crystal floating surface alignment
  assert.ok(lightSection.includes('& [data-testid="step-plan"]{background-color:var(--ag-cs-menu-bg-l,'), 'light theme must align step-plan with crystal overview-shell');
  assert.ok(lightSection.includes('& .ag-cs-home-panel{background-color:var(--ag-cs-menu-bg-l,'), 'light theme must align home-panel with crystal overview-shell');

  // CSS hygiene & brace balance & Channel 1 budget
  assert.equal(/:has\(/.test(css), false, 'style.css must have 0 :has() selectors');
  assert.equal(/[^\x00-\x7F]/.test(css), false, 'style.css must remain pure ASCII');
  let depth = 0;
  for (const ch of css) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    assert.ok(depth >= 0, 'style.css must never close unopened brace');
  }
  assert.equal(depth, 0, 'style.css braces must be balanced');

  const minified = cdp.minifyCss(css);
  assert.ok(minified.includes('[data-testid="step-plan"]'), 'minified CSS must retain step-plan rules');
  assert.ok(minified.includes('[data-testid="step-plan-item"]'), 'minified CSS must retain step-plan-item rules');
  for (const lang of ['auto', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de']) {
    const ch1Bytes = Buffer.byteLength(cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: lang }, { bundleCachePath: '' }), 'utf8');
    assert.ok(ch1Bytes < 549500, `Channel 1 (${lang}) bundle (${ch1Bytes} B) must stay < 549,500 B`);
  }
});

test('prism-rim-canvas caps step-plan rims to newest 2 visible expanded cards, mounts/recycles home-panel rim, and honors pp-open & motion=off 0fps sleep', () => {
  const rimSrc = fs.readFileSync(path.join(ROOT, 'prism-rim-canvas.js'), 'utf8');
  let now = 1000;
  let rafSeq = 1;
  const rafs = new Map();
  let ioCb = null;
  const ioObserved = new Set();

  const makeEl = (tag, opts = {}) => {
    const attrs = new Map(Object.entries(opts.attrs || {}));
    const kids = [];
    const el = {
      tagName: tag.toUpperCase(),
      className: opts.className || '',
      isConnected: true,
      hidden: false,
      parentElement: null,
      style: {
        display: '',
        visibility: '',
        setProperty() {},
        removeProperty() {},
      },
      _rect: opts.rect || { left: 100, top: 100, right: 500, bottom: 260, width: 400, height: 160 },
      get children() { return kids; },
      get firstElementChild() { return kids[0] || null; },
      get nextElementSibling() {
        const p = this.parentElement;
        if (!p) return null;
        const idx = p.children.indexOf(this);
        return idx >= 0 ? p.children[idx + 1] || null : null;
      },
      classList: { contains: (c) => el.className.split(/\s+/).includes(c) },
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      setAttribute: (k, v) => attrs.set(k, String(v)),
      hasAttribute: (k) => attrs.has(k),
      removeAttribute: (k) => attrs.delete(k),
      appendChild(c) { c.parentElement = el; c.isConnected = true; kids.push(c); return c; },
      remove() {
        this.isConnected = false;
        if (this.parentElement) {
          const i = this.parentElement.children.indexOf(this);
          if (i >= 0) this.parentElement.children.splice(i, 1);
          this.parentElement = null;
        }
      },
      querySelector: (s) => (s === '.ag-cs-prism-rim-cv' ? kids.find((k) => k.classList.contains('ag-cs-prism-rim-cv')) || null : null),
      getBoundingClientRect: () => el._rect,
    };
    if (tag === 'canvas') {
      el.width = 0;
      el.height = 0;
      el.getContext = (t) => (t === '2d' ? {
        globalAlpha: 1,
        lineWidth: 1,
        strokeStyle: null,
        save() {},
        restore() {},
        translate() {},
        clearRect() {},
        beginPath() {},
        roundRect() {},
        stroke() {},
        createRadialGradient: () => ({ addColorStop() {} }),
      } : null);
    }
    return el;
  };

  // 4 step-plan cards: sp0 (oldest, visible), sp1 (visible), sp2 (newest visible), sp3 (offscreen below viewport)
  const sp0 = makeEl('div', { attrs: { 'data-testid': 'step-plan' }, rect: { left: 80, top: 60, right: 480, bottom: 180, width: 400, height: 120 } });
  const sp1 = makeEl('div', { attrs: { 'data-testid': 'step-plan' }, rect: { left: 80, top: 220, right: 480, bottom: 340, width: 400, height: 120 } });
  const sp2 = makeEl('div', { attrs: { 'data-testid': 'step-plan' }, rect: { left: 80, top: 380, right: 480, bottom: 500, width: 400, height: 120 } });
  const sp3 = makeEl('div', { attrs: { 'data-testid': 'step-plan' }, rect: { left: 80, top: 1200, right: 480, bottom: 1320, width: 400, height: 120 } });
  const homePanel = makeEl('section', { className: 'ag-cs-home-panel', attrs: { 'data-ag-cs-prism-box': '1' }, rect: { left: 120, top: 120, right: 640, bottom: 440, width: 520, height: 320 } });
  const allPlans = [sp0, sp1, sp2, sp3];
  const allHosts = () => [...allPlans, homePanel].filter((e) => e.isConnected);

  const htmlAttrs = new Map([['data-ag-cs-motion', 'standard'], ['data-ag-cs-ambient', '1']]);
  const htmlEl = {
    getAttribute: (k) => (htmlAttrs.has(k) ? htmlAttrs.get(k) : null),
    setAttribute: (k, v) => htmlAttrs.set(k, String(v)),
    removeAttribute: (k) => htmlAttrs.delete(k),
    addEventListener() {},
    removeEventListener() {},
  };

  const fakeDoc = {
    hidden: false,
    documentElement: htmlEl,
    createElement: (t) => makeEl(t),
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll(sel) {
      if (sel.includes('[data-testid="step-plan"]')) return allPlans.filter((e) => e.isConnected);
      if (sel.includes('[data-ag-cs-prism-box="1"]')) return allHosts().filter((e) => e.getAttribute('data-ag-cs-prism-box') === '1');
      if (sel.includes('.ag-cs-prism-rim-cv')) return allHosts().map((h) => h.querySelector('.ag-cs-prism-rim-cv')).filter(Boolean);
      if (sel.includes('[data-ag-cs-prism-cv]')) return allHosts().filter((h) => h.hasAttribute('data-ag-cs-prism-cv'));
      return [];
    },
  };

  const flushRaf = (dt = 16) => {
    now += dt;
    const list = [...rafs.values()];
    rafs.clear();
    list.forEach((fn) => fn(now));
  };

  const sb = {
    document: fakeDoc,
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 1,
    performance: { now: () => now },
    requestAnimationFrame: (fn) => { const id = rafSeq++; rafs.set(id, fn); return id; },
    cancelAnimationFrame: (id) => rafs.delete(id),
    setTimeout: () => 0,
    clearTimeout() {},
    getComputedStyle: () => ({ borderTopLeftRadius: '13px' }),
    IntersectionObserver: class {
      constructor(cb) { ioCb = cb; }
      observe(el) { ioObserved.add(el); }
      unobserve(el) { ioObserved.delete(el); }
      disconnect() { ioObserved.clear(); }
    },
    addEventListener() {},
    removeEventListener() {},
    Set, WeakSet, Map, Array, Math, Number, String, Boolean,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(rimSrc, sb);

  const ctl = sb.__agPrismRimCanvas.createPrismRimCanvasController({
    isDestroyed: () => false,
    isDarkTheme: () => true,
    motionReduced: () => false,
    getMinFrameGapMs: () => 0,
    getAmbientIntensity: () => 1,
    getAccentTone: () => 'follow',
    canMountRealCanvas: () => true,
    setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    runGuardedMut: (fn) => fn(),
  });

  // 1) Initial pointer move mounts ONLY newest 2 visible expanded step-plans (sp2, sp1) + homePanel
  ctl.onPointerMove({ clientX: 200, clientY: 300 });
  flushRaf();
  assert.equal(sp2.getAttribute('data-ag-cs-prism-box'), '1');
  assert.equal(sp1.getAttribute('data-ag-cs-prism-box'), '1');
  assert.equal(sp0.getAttribute('data-ag-cs-prism-box'), null, '3rd older step-plan must not mount rim canvas');
  assert.equal(sp3.getAttribute('data-ag-cs-prism-box'), null, 'offscreen step-plan must not mount rim canvas');
  assert.ok(sp2.querySelector('.ag-cs-prism-rim-cv'));
  assert.ok(sp1.querySelector('.ag-cs-prism-rim-cv'));
  assert.equal(sp0.querySelector('.ag-cs-prism-rim-cv'), null);
  const homeCv1 = homePanel.querySelector('.ag-cs-prism-rim-cv');
  assert.ok(homeCv1 && homeCv1.width === 520 && homeCv1.height === 320, 'home-panel rim canvas must mount at exact inset:0 bounds');

  // 2) Scrolling sp2 out of viewport via IntersectionObserver immediately unmounts & reclaims 0x0 VRAM, promoting sp0
  const sp2Cv = sp2.querySelector('.ag-cs-prism-rim-cv');
  ioCb([
    { target: sp0, isIntersecting: true, boundingClientRect: sp0._rect },
    { target: sp1, isIntersecting: true, boundingClientRect: sp1._rect },
    { target: sp2, isIntersecting: false, boundingClientRect: { left: 80, top: -200, right: 480, bottom: -80, width: 400, height: 120 } },
    { target: sp3, isIntersecting: false, boundingClientRect: sp3._rect },
  ]);
  assert.equal(sp2.getAttribute('data-ag-cs-prism-box'), null, 'scrolled-out step-plan must lose prism-box immediately');
  assert.equal(sp2.querySelector('.ag-cs-prism-rim-cv'), null, 'scrolled-out step-plan canvas must be removed immediately');
  assert.equal(sp2Cv.width, 0, 'scrolled-out step-plan canvas VRAM must shrink to 0x0');
  assert.equal(sp0.getAttribute('data-ag-cs-prism-box'), '1', 'visible expanded sp0 should be promoted into top-2 slot');

  // 3) Collapsing sp1 immediately unmounts its rim canvas on markDirty()
  const sp1Cv = sp1.querySelector('.ag-cs-prism-rim-cv');
  sp1.setAttribute('aria-expanded', 'false');
  ctl.markDirty();
  assert.equal(sp1.getAttribute('data-ag-cs-prism-box'), null, 'collapsed step-plan must lose prism-box immediately');
  assert.equal(sp1.querySelector('.ag-cs-prism-rim-cv'), null);
  assert.equal(sp1Cv.width, 0, 'collapsed step-plan canvas VRAM must shrink to 0x0');

  // 4) Periodic picker open (data-ag-pp-open="1") immediately sleeps 0fps & shrinks VRAM to 0x0
  ctl.onPointerMove({ clientX: 210, clientY: 140 });
  flushRaf();
  assert.ok(homePanel.querySelector('.ag-cs-prism-rim-cv').width > 0);
  htmlEl.setAttribute('data-ag-pp-open', '1');
  ctl.pauseForOverlay();
  assert.equal(homePanel.querySelector('.ag-cs-prism-rim-cv').width, 0, 'pp-open must reclaim rim canvas to 0x0');
  ctl.onPointerMove({ clientX: 220, clientY: 160 });
  assert.equal(rafs.size, 0, 'pp-open must stay 0fps on pointermove');
  htmlEl.removeAttribute('data-ag-pp-open');

  // 5) Home panel innerHTML reset (tab switch) self-heals rim canvas on next move, and detaching home-panel reclaims immediately
  homePanel.querySelector('.ag-cs-prism-rim-cv').remove();
  ctl.onPointerMove({ clientX: 240, clientY: 200 });
  flushRaf();
  const homeCv2 = homePanel.querySelector('.ag-cs-prism-rim-cv');
  assert.ok(homeCv2 && homeCv2 !== homeCv1 && homeCv2.width === 520, 'home-panel rim canvas must self-heal after tab re-render');

  homePanel.isConnected = false;
  ctl.markDirty();
  assert.equal(homeCv2.width, 0, 'leaving home view must immediately reclaim home-panel rim canvas to 0x0');

  // 6) motion="off" immediately reclaims all canvases to 0x0 & stops rAF
  htmlEl.setAttribute('data-ag-cs-motion', 'off');
  ctl.markDirty();
  assert.equal(sp0.querySelector('.ag-cs-prism-rim-cv'), null);
  ctl.onPointerMove({ clientX: 240, clientY: 100 });
  assert.equal(rafs.size, 0, 'motion=off must stay 0fps');

  ctl.teardown();
});

test('model-selector trigger relaxes container cap to min(300px,100%) and excludes .ag-pp-mini-keycap badge from truncation/collapse', () => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  // 1) 外层容器允许在 300px 内完整展示模型名与 [10Ne] 徽章，超窄窗口按 flex:0 1 auto 等比收缩
  assert.ok(
    css.includes('div.no-focus-agent-input{flex:0 1 auto !important;min-width:0 !important;max-width:min(300px,100%) !important;overflow:hidden !important;}'),
    'no-focus-agent-input must use flex:0 1 auto and max-width:min(300px,100%)',
  );
  // 2) 常规与窄窗 data-t~="1" 折叠规则均排除 .ag-pp-mini-keycap，防止迷你快捷键徽章被截断或隐藏
  assert.ok(
    css.includes('& [data-testid="model-selector-trigger"]>span:not(.ag-cs-model-glyph):not(.ag-pp-mini-keycap){'),
    'normal model-selector label span rule must exclude .ag-pp-mini-keycap',
  );
  assert.ok(
    css.includes('&[data-t~="1"] [data-testid="model-selector-trigger"]>span:not(.ag-cs-model-glyph):not(.ag-pp-mini-keycap),&[data-t~="2"] [data-testid="permissions-selector-trigger"]>span{'),
    'compact data-t~="1" collapse rule must exclude .ag-pp-mini-keycap',
  );
});
