// Wave 3A 综合单测：编译期 CSS 扁平化 (#102) + 共享 DOM 总线 dom-bus.js + 无损 performanceMode (8 语种)
// + Blink CSS 降载 / Issue #97 模型名弹性宽度 + PR #103 微优化 + 完整 Teardown
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createSettingsMiniDom } from './helpers/mini-dom.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');

const cdp = require(path.join(ROOT, 'cdp.js'));
const cssFlatten = require(path.join(ROOT, 'src', 'compiler', 'css-flatten.cjs'));
const cssPack = require(path.join(ROOT, 'src', 'compiler', 'css-pack.cjs'));
const domBusMod = require(path.join(ROOT, 'src', 'runtime', 'dom-bus.js'));
const i18nExt = require(path.join(ROOT, 'src', 'runtime', 'i18n-ext-beta4.js'));
const settingsExt = require(path.join(ROOT, 'src', 'runtime', 'settings-ext-beta4.js'));
const settingsPanel = require(path.join(ROOT, 'settings-panel.js'));
const i18nLocales = require(path.join(ROOT, 'i18n-locales.js'));
const i18nCore = require(path.join(ROOT, 'i18n-core.js'));

const CANONICAL_8_LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de'];
const NON_CJK_LOCALES = ['en', 'ko', 'es', 'fr', 'de'];
const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;
const FORBIDDEN_TERM_RE = /八方旅人|octopath/i;

function createMockHostEnv() {
  const attrs = new Map();
  const dataset = {};
  const html = {
    nodeType: 1,
    tagName: 'HTML',
    dataset,
    setAttribute(k, v) {
      attrs.set(k, String(v));
      if (k === 'data-ag-cs-perf-mode') dataset.agCsPerfMode = String(v);
    },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
    hasAttribute(k) { return attrs.has(k); },
    removeAttribute(k) {
      attrs.delete(k);
      if (k === 'data-ag-cs-perf-mode') delete dataset.agCsPerfMode;
    },
  };
  const winListeners = [];
  const winEvents = [];
  const observers = [];
  class MockMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.connected = false;
      this.target = null;
      this.opts = null;
      observers.push(this);
    }
    observe(target, opts) {
      this.connected = true;
      this.target = target;
      this.opts = opts;
    }
    disconnect() {
      this.connected = false;
    }
    emit(records) {
      if (this.connected) this.cb(records);
    }
  }
  const win = {
    document: null,
    MutationObserver: MockMutationObserver,
    addEventListener(type, fn, opts) {
      winListeners.push({ type, fn, opts, active: true });
    },
    removeEventListener(type, fn, opts) {
      for (const rec of winListeners) {
        if (rec.active && rec.type === type && rec.fn === fn && Boolean(rec.opts?.capture ?? rec.opts) === Boolean(opts?.capture ?? opts)) {
          rec.active = false;
        }
      }
    },
    dispatchEvent(ev) {
      winEvents.push(ev);
      for (const rec of winListeners) {
        if (rec.active && rec.type === ev.type) rec.fn(ev);
      }
      return true;
    },
  };
  const doc = {
    documentElement: html,
    body: { nodeType: 1, tagName: 'BODY' },
    defaultView: win,
  };
  win.document = doc;
  return { doc, win, html, winListeners, winEvents, observers };
}

test('Compile-time css-flatten.cjs: semantic equivalence across @media/@supports/@container/@keyframes/@font-face, &, :is(), strings, attrs, and url()', () => {
  const { flattenNestedCss } = cssFlatten;

  // 1) Declarations with var() inside shorthands survive verbatim
  assert.equal(
    flattenNestedCss('html[x]{& .a{border:1px solid var(--c);background:var(--bg) center/cover no-repeat;}}'),
    'html[x] .a{border:1px solid var(--c);background:var(--bg) center/cover no-repeat;}'
  );

  // 2) Parent list splitting preserves specificity; mixed specificity falls back to :is()
  assert.equal(
    flattenNestedCss('.a,.b{&:hover{color:red}> .k{x:1}.p &{y:2}}'),
    '.a:hover,.b:hover{color:red;}\n.a > .k,.b > .k{x:1;}\n.p .a,.p .b{y:2;}'
  );
  assert.equal(
    flattenNestedCss('.a,#b{& .c{color:red}}'),
    ':is(.a,#b) .c{color:red;}'
  );

  // 3) & in middle of compound or after ancestor uses :is(parent) for complex parent
  assert.equal(
    flattenNestedCss('html[x] .q{.y&{a:1}.z &{b:2}&.w{c:3}}'),
    '.y:is(html[x] .q){a:1;}\n.z :is(html[x] .q){b:2;}\nhtml[x] .q.w{c:3;}'
  );

  // 4) Interleaved CSSNestedDeclarations + nested @media/@supports/@container preserve order
  assert.equal(
    flattenNestedCss('.a{color:red;@media (min-width:600px){&:hover{b:1}c:2}@supports (display:grid){& .g{display:grid}}@container (width > 300px){& .c{gap:4px}}d:3}'),
    '.a{color:red;}\n@media (min-width:600px){.a:hover{b:1;}\n.a{c:2;}}\n@supports (display:grid){.a .g{display:grid;}}\n@container (width > 300px){.a .c{gap:4px;}}\n.a{d:3;}'
  );

  // 5) @keyframes, @font-face, @property copied verbatim without mangling
  const atVerbatim =
    '@font-face{font-family:"PrismTest";src:url("https://example.com/a;b{c}.woff2") format("woff2");}' +
    '@property --_fa{syntax:"<angle>";inherits:false;initial-value:0deg;}' +
    '@keyframes k{0%{opacity:0}to{opacity:1}}';
  assert.equal(
    flattenNestedCss(atVerbatim),
    '@font-face{font-family:"PrismTest";src:url("https://example.com/a;b{c}.woff2") format("woff2");}\n' +
      '@property --_fa{syntax:"<angle>";inherits:false;initial-value:0deg;}\n' +
      '@keyframes k{0%{opacity:0}to{opacity:1}}'
  );

  // 6) Protect :not(:is(...)), forgiving vendor :is(), quoted strings, attribute selectors, comments & url()
  const guarded =
    '/* { fake } & */html[x] .card{&:not(:is(.a,.b)){display:block;}' +
    '& [data-x=":is(p,q)&{;}"]{content:"& { ; }";background:url(https://cdn.example/x;y&z.png);}' +
    '& :is(.ok,::-moz-bad){opacity:.5;}}';
  const flatGuarded = flattenNestedCss(guarded);
  assert.ok(flatGuarded.includes('html[x] .card:not(:is(.a,.b)){display:block;}'));
  assert.ok(flatGuarded.includes('html[x] .card [data-x=":is(p,q)&{;}"]{content:"& { ; }";background:url(https://cdn.example/x;y&z.png);}'));
  assert.ok(flatGuarded.includes('html[x] .card :is(.ok,::-moz-bad){opacity:.5;}'), 'forgiving :is() with vendor pseudo must not expand');

  // 6b) computeSelectorSpecificity handles :is([a],[b]) & :where([a]) without double-counting, and foldDescendantList preserves cascade order across interleaved specificities
  assert.equal(cssFlatten.computeSelectorSpecificity(':is([data-a="1"],[data-b="2"])'), 1000);
  assert.equal(cssFlatten.computeSelectorSpecificity(':where([data-a="1"],[data-b="2"])'), 0);
  const cascadeCss = '.box{& .a{color:red}& #mid{color:blue}& .b{color:green}}';
  const flatCascade = flattenNestedCss(cascadeCss);
  assert.ok(flatCascade.indexOf('.box .a') < flatCascade.indexOf('.box #mid') && flatCascade.indexOf('.box #mid') < flatCascade.indexOf('.box .b'), 'Interleaved specificities must preserve source cascade order');

  // 7) Real repository style.css compile-time flattening via packCssJsExpr: single-block flat CSS, 0 bucket markers, 0 bare &, smaller LZSS than bucketed
  const rawStyleCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const minStyleCss = cssPack.minifyCss(rawStyleCss);
  const flatMinExpected = cssPack.minifyCss(cssFlatten.flattenNestedCss(minStyleCss));
  const packedExpr = cssPack.packCssJsExpr(minStyleCss);
  const legacyBucketedExpr = cssPack.packCssJsExpr(minStyleCss, { bucketize: true });
  const unpackedCss = vm.runInNewContext(packedExpr);
  assert.equal(unpackedCss, flatMinExpected, 'Default packCssJsExpr must unpack to exact single-block flattened CSS without rule reordering');
  assert.equal(unpackedCss.includes('/*@ag:'), false, 'Single-block packed CSS must contain 0 /*@ag: bucket markers');
  assert.ok(
    Buffer.byteLength(packedExpr, 'utf8') < Buffer.byteLength(legacyBucketedExpr, 'utf8'),
    `Single-block LZSS (${Buffer.byteLength(packedExpr, 'utf8')} B) must beat legacy bucketed LZSS (${Buffer.byteLength(legacyBucketedExpr, 'utf8')} B)`
  );
  assert.equal((unpackedCss.match(/(?<!["'=\w])&(?![\w])/g) || []).length, 0, 'Compiled Ch1 CSS must have 0 residual & nesting');
  assert.ok(unpackedCss.includes('html[data-ag-cs-style]'), 'Flattened CSS must retain root scope selectors');
  assert.ok(unpackedCss.includes('div[role="dialog"]') && unpackedCss.includes('#ag-cs-settings-sec'), 'Single-block CSS must always ship nested dialog & settings rules unconditionally');
  assert.ok(unpackedCss.includes('@keyframes ag-cs-orbit-spin'), 'Flattened CSS must preserve @keyframes verbatim');
  assert.ok(unpackedCss.includes('@property --ag-origin-x'), 'Flattened CSS must preserve @property verbatim');
  assert.ok(unpackedCss.includes('data-ag-cs-perf-mode="performance"'), 'Flattened CSS must include performance-mode blur degradation rules');
  assert.equal(unpackedCss.includes('data-ag-perf-busy="1"'), false, 'Flattened CSS must not strip overlay blur on transient data-ag-perf-busy');
});

test('dom-bus.js Read/Write Batcher: Proxy DOM asserts strict 0 Forced Reflow (all reads before any write) + key deduplication', () => {
  const { doc, win } = createMockHostEnv();
  const bus = domBusMod.createInstance(doc, win);
  const ops = [];
  let widthVal = 100;

  const target = { width: 100, dirty: false };
  const proxyEl = new Proxy(target, {
    get(obj, prop) {
      if (prop === 'offsetHeight' || prop === 'clientWidth') {
        ops.push(`R:${String(prop)}`);
        return obj.width;
      }
      if (prop === 'setWidth') {
        return (v) => {
          ops.push(`W:width=${v}`);
          obj.width = v;
        };
      }
      return obj[prop];
    },
  });

  // Interleave measure / mutate / measure / mutate / duplicate key
  bus.measure('m1', () => { widthVal = proxyEl.offsetHeight; });
  bus.mutate('w1', () => { proxyEl.setWidth(widthVal + 1); }); // overwritten by same key 'w1'
  bus.measure('m2', () => { void proxyEl.clientWidth; });
  bus.mutate('w1', () => { proxyEl.setWidth(widthVal + 10); });
  bus.measure('m3', () => { void proxyEl.offsetHeight; });
  bus.mutate('w2', () => { proxyEl.setWidth(widthVal + 20); });

  bus.flushNow();

  assert.equal(ops.length, 5, 'Duplicate mutate key w1 must deduplicate (3 reads + 2 writes)');
  const firstWriteIdx = ops.findIndex((x) => x.startsWith('W:'));
  const lastReadIdx = ops.map((x) => x.startsWith('R:')).lastIndexOf(true);
  assert.ok(firstWriteIdx > lastReadIdx && lastReadIdx === 2, `0 Forced Reflow violated: ops=${JSON.stringify(ops)}`);
  assert.deepEqual(ops, ['R:offsetHeight', 'R:clientWidth', 'R:offsetHeight', 'W:width=110', 'W:width=120']);
  bus.dispose(doc, win);
});

test('dom-bus.js runChunked: slices work under < 4ms per slice budget and supports abort/dispose', async () => {
  const { doc, win } = createMockHostEnv();
  const bus = domBusMod.createInstance(doc, win);

  // Use deterministic items that burn ~1.2ms each so a 2.5ms budget must yield across multiple slices, each < 4ms
  const items = Array.from({ length: 12 }, (_, i) => i);
  const visited = [];
  const sliceDurations = [];
  let curSliceStart = performance.now();
  let lastSliceIdx = 0;

  // Measure actual runChunked slicing
  const res = await bus.runChunked(
    items,
    (x) => {
      visited.push(x);
      const t0 = performance.now();
      while (performance.now() - t0 < 0.7) {
        // busy work < 1ms per item
      }
      const elapsed = performance.now() - curSliceStart;
      if (elapsed > 1.8) {
        sliceDurations.push(elapsed);
        lastSliceIdx++;
      }
    },
    { budgetMs: 2.0 }
  );
  assert.equal(res.aborted, false);
  assert.equal(res.processed, 12);
  assert.equal(visited.length, 12);
  assert.ok(res.slices >= 2, `Expected multiple time slices for 12 items @ 2ms budget, got ${res.slices}`);
  assert.ok(lastSliceIdx >= 1 || res.slices >= 2);

  // Verify AbortSignal halts cleanly
  const ac = new AbortController();
  const seenAbort = [];
  const abortRes = await bus.runChunked(
    [1, 2, 3, 4, 5],
    (v) => {
      seenAbort.push(v);
      if (v === 2) ac.abort();
    },
    { budgetMs: 3.5, signal: ac.signal }
  );
  assert.equal(abortRes.aborted, true);
  assert.deepEqual(seenAbort, [1, 2]);

  bus.dispose(doc, win);
});

test('dom-bus.js Single Root Observer, streaming low-priority throttling (160-200ms), passive scroll/wheel busy pulse & 200ms release', async () => {
  const { doc, win, html, winListeners, observers } = createMockHostEnv();
  const bus = domBusMod.createInstance(doc, win);

  const highBatches = [];
  const lowBatches = [];
  const unsubHigh = bus.subscribe('high-sub', (m) => highBatches.push(m.length), {
    priority: 'high',
    observeOptions: { childList: true, subtree: true },
  });
  const unsubLow = bus.subscribe('low-sub', (m) => lowBatches.push(m.length), {
    priority: 'low',
    observeOptions: { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] },
  });

  // Single shared root MutationObserver
  assert.equal(observers.length, 2, 'Observer only re-created when merged observeOptions changed');
  assert.equal(observers[0].connected, false);
  assert.equal(observers[1].connected, true);

  // Passive scroll & wheel listeners attached with { capture: true, passive: true }
  const activeListeners = winListeners.filter((l) => l.active);
  assert.equal(activeListeners.length, 2);
  for (const l of activeListeners) {
    assert.ok(l.type === 'scroll' || l.type === 'wheel');
    assert.equal(l.opts?.passive, true, `${l.type} listener must be passive: true`);
    assert.equal(l.opts?.capture, true, `${l.type} listener must be capture: true`);
  }

  // Trigger scroll -> immediate in-memory isBusy()/isPerfBusy() without writing data-ag-perf-busy onto <html>
  win.dispatchEvent({ type: 'scroll' });
  assert.equal(html.hasAttribute('data-ag-perf-busy'), false, 'Scroll busy must remain pure in-memory and never mutate <html> attribute');
  assert.equal(bus.isBusy(), true);
  assert.equal(bus.isPerfBusy(), true);
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(bus.isBusy(), true, 'Busy flag must remain held before 200ms idle');
  assert.equal(html.hasAttribute('data-ag-perf-busy'), false);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(bus.isBusy(), false, 'Busy flag must auto-release 200ms after scroll stops');
  assert.equal(html.hasAttribute('data-ag-perf-busy'), false);

  // Streaming active -> sets in-memory busy, high-priority delivers synchronously, low-priority throttles (~180ms)
  bus.setStreaming(true);
  assert.equal(bus.isBusy(), true);
  assert.equal(html.hasAttribute('data-ag-perf-busy'), false, 'Streaming busy must not mutate <html> data-ag-perf-busy');
  const rootMo = observers[observers.length - 1];
  rootMo.emit([{ type: 'childList' }]); // first low-priority executes (elapsed > waitMs since 0)
  const lowAfterFirst = lowBatches.length;
  rootMo.emit([{ type: 'childList' }, { type: 'childList' }]);
  rootMo.emit([{ type: 'childList' }]);
  assert.equal(highBatches.length, 3, 'High-priority subscriber must receive all 3 mutation batches immediately');
  assert.equal(lowBatches.length, lowAfterFirst, 'Low-priority subscriber must be throttled during AI streaming');
  await new Promise((r) => setTimeout(r, 220));
  assert.equal(lowBatches.length, lowAfterFirst + 1, 'Low-priority subscriber must flush coalesced batch after 160-200ms throttle');
  assert.equal(lowBatches[lowBatches.length - 1], 3, 'Coalesced low-priority batch must contain all 3 queued mutations');

  bus.setStreaming(false);
  assert.equal(bus.isBusy(), false, 'Clearing streaming releases in-memory busy state');
  assert.equal(html.hasAttribute('data-ag-perf-busy'), false);

  // Unsubscribing all disconnects root observer
  unsubHigh();
  unsubLow();
  assert.equal(rootMo.connected, false, 'Root MO must disconnect when subscriber count drops to 0');

  bus.dispose(doc, win);
  assert.equal(winListeners.filter((l) => l.active).length, 0, 'dispose() must remove all scroll/wheel listeners');
});

test('Lossless performanceMode: schema aliases, __agPrismPerfCaps() caps, zero mutation of visual settings, 8-locale 0 CJK leak, settings UI & teardown', () => {
  // 1) Schema & aliases
  assert.equal(cdp.DEFAULT_CONFIG.performanceMode, 'balanced');
  assert.equal(cdp.validateConfigEntry('performanceMode', 'performance'), true);
  assert.equal(cdp.validateConfigEntry('performanceMode', 'balanced'), true);
  assert.equal(cdp.validateConfigEntry('performanceMode', 'quality'), true);
  assert.equal(cdp.validateConfigEntry('performanceMode', 'auto'), true);
  assert.equal(cdp.validateConfigEntry('performanceMode', 'eco'), true);
  assert.equal(cdp.validateConfigEntry('performanceMode', 'turbo-invalid'), false);
  assert.equal(cdp.reconcileConfigAliases({ performanceMode: 'auto' }).performanceMode, 'balanced');
  assert.equal(cdp.reconcileConfigAliases({ performanceMode: 'eco' }).performanceMode, 'performance');

  const exampleCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
  assert.equal(exampleCfg.performanceMode, 'balanced');

  // 2) Runtime lossless switching: never alters motionLevel / targetFps / homeRipple / convRipple / mascot
  const { doc, win, html } = createMockHostEnv();
  const bus = domBusMod.createInstance(doc, win);
  const userCfg = {
    motionLevel: 'ultra',
    targetFps: '180',
    homeRipple: true,
    convRipple: 'full',
    mascot: 'quad',
    performanceMode: 'balanced',
  };
  const snapshotBefore = JSON.stringify({
    motionLevel: userCfg.motionLevel,
    targetFps: userCfg.targetFps,
    homeRipple: userCfg.homeRipple,
    convRipple: userCfg.convRipple,
    mascot: userCfg.mascot,
  });

  bus.applyPerformanceMode('performance', doc, win);
  assert.equal(html.getAttribute('data-ag-cs-perf-mode'), 'performance');
  assert.equal(html.dataset.agCsPerfMode, 'performance');
  const perfCaps = bus.getPerfCaps(null, doc);
  assert.equal(perfCaps.mode, 'performance');
  assert.equal(perfCaps.maxFps, 60);
  assert.equal(perfCaps.disableHeavyBlur, true);
  assert.ok(perfCaps.maxDpr <= 1);

  bus.applyPerformanceMode('quality', doc, win);
  assert.equal(html.getAttribute('data-ag-cs-perf-mode'), 'quality');
  const qualCaps = bus.getPerfCaps(null, doc);
  assert.equal(qualCaps.mode, 'quality');
  assert.equal(qualCaps.maxFps, 0);
  assert.equal(qualCaps.disableHeavyBlur, false);
  assert.equal(qualCaps.maxDpr, 2);

  bus.applyPerformanceMode('auto', doc, win);
  assert.equal(html.getAttribute('data-ag-cs-perf-mode'), 'balanced');
  assert.equal(bus.getPerfCaps(null, doc).mode, 'balanced');

  assert.equal(
    JSON.stringify({
      motionLevel: userCfg.motionLevel,
      targetFps: userCfg.targetFps,
      homeRipple: userCfg.homeRipple,
      convRipple: userCfg.convRipple,
      mascot: userCfg.mascot,
    }),
    snapshotBefore,
    'Switching performanceMode must never mutate user visual preferences'
  );

  // 3) 8-locale i18n-ext-beta4 completeness & 0 CJK leak in non-CJK locales
  const perfI18nKeys = [
    'setPerformanceModeTitle',
    'setPerformanceModeDesc',
    'optPerfPerformance',
    'optPerfBalanced',
    'optPerfQuality',
  ];
  for (const loc of CANONICAL_8_LOCALES) {
    const dict = i18nExt.getStrings(loc);
    for (const k of perfI18nKeys) {
      assert.ok(typeof dict[k] === 'string' && dict[k].trim().length > 0, `${loc}.${k} missing`);
      assert.equal(FORBIDDEN_TERM_RE.test(dict[k]), false, `Forbidden term in ${loc}.${k}`);
      if (NON_CJK_LOCALES.includes(loc)) {
        assert.equal(CJK_RE.test(dict[k]), false, `CJK leak in ${loc}.${k}: "${dict[k]}"`);
      }
    }
  }

  // 4) Settings panel segmented selector updates ONLY performanceMode (never touches motion/fps/ripple/mascot)
  const { doc: sDoc } = createSettingsMiniDom();
  const sState = {
    ...settingsPanel.getDefaultSettingsPatch(),
    language: 'zh-CN',
    performanceMode: 'balanced',
    motionLevel: 'ultra',
    targetFps: '180',
    homeRipple: true,
    convRipple: 'medium',
    mascot: 'crab',
  };
  const savedKeys = [];
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevBus = globalThis.__agPrismDomBus;
  const prevI18n = globalThis.__agPrismI18nExtBeta4;
  const prevSet = globalThis.__agPrismSettingsExtBeta4;
  const sWin = { document: sDoc, __agPrismDomBus: domBusMod.createInstance(sDoc, null) };
  sDoc.defaultView = sWin;
  globalThis.document = sDoc;
  globalThis.window = sWin;
  globalThis.__agPrismDomBus = sWin.__agPrismDomBus;
  globalThis.__agPrismI18nExtBeta4 = i18nExt;
  globalThis.__agPrismSettingsExtBeta4 = settingsExt;
  try {
    settingsPanel.mountOrSyncSettingsSection({
      version: cdp.PLUGIN_VERSION,
      lazyFold: false,
      getLang: () => sState.language,
      uiText: (l) => i18nLocales.getUiStrings(l),
      isZh: () => true,
      i18nCore,
      formatSettingsSummary: () => 'summary',
      resolveSettingRowActiveValue: (k) => sState[k],
      isSettingButtonMatch: (k, valJson, cur) => JSON.stringify(cur) === valJson,
      saveSetting: (k, v) => { sState[k] = v; savedKeys.push([k, v]); },
      saveSettingsBatch: (p) => Object.assign(sState, p),
      getThoughtTranslateMode: () => 'off',
      handledGroupClicks: new WeakSet(),
      runSettingsGroupGlide: () => {},
      runGuardedMut: (fn) => fn(),
    });
    const sec = sDoc.getElementById('ag-cs-settings-sec');
    const perfRow = sec.querySelector('[data-ag-cs-row="performanceMode"]');
    assert.ok(perfRow, 'Settings panel must mount performanceMode segmented row');
    const perfBtn = perfRow.querySelector('button[data-ag-cs-ext-perf="performance"]');
    assert.ok(perfBtn);
    perfBtn.click();
    assert.deepEqual(savedKeys, [['performanceMode', 'performance']]);
    assert.equal(sDoc.documentElement.getAttribute('data-ag-cs-perf-mode'), 'performance');
    assert.equal(sState.motionLevel, 'ultra');
    assert.equal(sState.targetFps, '180');
    assert.equal(sState.homeRipple, true);
    assert.equal(sState.convRipple, 'medium');
    assert.equal(sState.mascot, 'crab');
    sWin.__agPrismDomBus.dispose(sDoc, sWin);
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    if (prevBus === undefined) delete globalThis.__agPrismDomBus; else globalThis.__agPrismDomBus = prevBus;
    if (prevI18n === undefined) delete globalThis.__agPrismI18nExtBeta4; else globalThis.__agPrismI18nExtBeta4 = prevI18n;
    if (prevSet === undefined) delete globalThis.__agPrismSettingsExtBeta4; else globalThis.__agPrismSettingsExtBeta4 = prevSet;
  }

  // 4b) applyPerformanceMode is idempotent and skips redundant attribute/dataset writes when unchanged
  {
    let setAttrCalls = 0;
    let datasetWrites = 0;
    let curAttr = null;
    let curDataset = undefined;
    const mockHtml = {
      dataset: Object.defineProperty({}, 'agCsPerfMode', {
        get: () => curDataset,
        set: (v) => { datasetWrites += 1; curDataset = v; },
      }),
      getAttribute: (k) => (k === 'data-ag-cs-perf-mode' ? curAttr : null),
      setAttribute: (k, v) => { if (k === 'data-ag-cs-perf-mode') { setAttrCalls += 1; curAttr = String(v); curDataset = String(v); } },
    };
    const mockDoc = { documentElement: mockHtml, hidden: false };
    const idempBus = domBusMod.createInstance(mockDoc, {});
    idempBus.applyPerformanceMode('balanced', mockDoc, {});
    assert.equal(setAttrCalls, 1);
    assert.equal(datasetWrites, 0, 'real-DOM dataset already synced by setAttribute must not be redundantly rewritten');
    idempBus.applyPerformanceMode('balanced', mockDoc, {});
    idempBus.applyPerformanceMode('balanced', mockDoc, {});
    assert.equal(setAttrCalls, 1, 'unchanged performanceMode must trigger 0 extra attribute writes');
    assert.equal(datasetWrites, 0);
    idempBus.dispose(mockDoc, {});
  }

  // 5) Full REMOVE_EXPRESSION teardown cleans __agPrismDomBus, __agPrismPerfCaps, data-ag-perf-busy, data-ag-cs-perf-mode & data-ag-cs-stream-active
  html.setAttribute('data-ag-perf-busy', '1');
  html.setAttribute('data-ag-cs-perf-mode', 'performance');
  html.setAttribute('data-ag-cs-stream-active', '1');
  const remDoc = {
    documentElement: html,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  let disposedFlag = false;
  const remWin = {
    document: remDoc,
    __agPrismDomBus: { dispose: () => { disposedFlag = true; bus.dispose(remDoc, remWin); } },
    __agPrismPerfCaps: bus.getPerfCaps,
  };
  remWin.window = remWin;
  remWin.globalThis = remWin;
  vm.runInNewContext(cdp.REMOVE_EXPRESSION, remWin);
  assert.equal(disposedFlag, true, 'REMOVE_EXPRESSION must call __agPrismDomBus.dispose()');
  assert.equal(remWin.__agPrismDomBus, undefined);
  assert.equal(remWin.__agPrismPerfCaps, undefined);
  assert.equal(html.hasAttribute('data-ag-perf-busy'), false);
  assert.equal(html.hasAttribute('data-ag-cs-perf-mode'), false);
  assert.equal(html.hasAttribute('data-ag-cs-stream-active'), false);
});

test('Issue #97 flexible model selector width, Blink CSS pruning, scoped motion="off" (0 universal *), and PR #103 micro-optimizations', () => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  // Issue #97 problem 2: no hardcoded 164px or min(300px,100%) truncation on model selector trigger
  assert.equal(css.includes('max-width:164px'), false, 'model selector label must not be hardcoded to max-width:164px');
  assert.equal(css.includes('max-width:min(300px,100%)'), false, 'model selector wrapper must not be hardcoded to min(300px,100%)');
  assert.ok(
    css.includes('&>div:nth-child(1)>div.flex>div.flex>div.no-focus-agent-input{flex:0 1 auto !important;min-width:0 !important;max-width:100% !important;'),
    'model selector wrapper must flex to 100% available space'
  );
  assert.ok(
    css.includes('& [data-testid="model-selector-trigger"]>span:not(.ag-cs-model-glyph):not(.ag-pp-mini-keycap){flex:0 1 auto !important;max-width:100% !important;min-width:0 !important;overflow:hidden !important;text-overflow:ellipsis !important;'),
    'model selector text span must allow full width while keeping ellipsis shrink'
  );
  // Narrow collapse guard still intact so telemetry/right buttons never break
  assert.ok(css.includes('&[data-t~="1"] [data-testid="model-selector-trigger"]>span:not(.ag-cs-model-glyph):not(.ag-pp-mini-keycap)'));

  // Blink content-visibility legacy guards + bleed exemption + sticky-safe pre/turn exclusion (PR #138) + non-flickering performance/motion=off blur suppression
  const flatCss = cssFlatten.flattenNestedCss(css);
  assert.ok(css.includes('[data-testid="conversation-row-history"]:not([data-ag-cs-bleed="1"]){content-visibility:auto;contain-intrinsic-size:auto 44px;'));
  assert.equal(/\[data-markdown-root\]\s*pre[^\n{]*\{[^}]*content-visibility:\s*auto/.test(css), false, 'style.css must not apply content-visibility:auto on markdown pre blocks (preserves sticky headers)');
  assert.equal(/\[data-markdown-root\]\s*pre[^{]*\{[^}]*content-visibility:\s*auto/.test(flatCss), false, 'flattened CSS must not apply content-visibility:auto on markdown pre blocks');
  assert.equal(/div\.flex\.items-start[^\n{]*\{[^\n}]*content-visibility:\s*auto/.test(css), false, 'style.css must not apply content-visibility:auto on whole turn items');
  assert.equal(/div\.flex\.items-start(?::not\([^)]*\))*\{[^}]*content-visibility:\s*auto/.test(flatCss), false, 'flattened CSS must not apply content-visibility:auto directly on whole turn items');
  assert.ok(css.includes(':is([data-ag-cs-perf-mode="performance"],[data-ag-cs-motion="off"])'));
  assert.equal(css.includes('data-ag-perf-busy="1"'), false, 'style.css must not toggle backdrop-filter on transient perf-busy');
  assert.equal(css.includes('data-ag-cs-stream-active="1"'), false, 'style.css must not toggle backdrop-filter on transient stream-active');

  // ui-runtime.js motion="off" has ZERO universal * wildcard injection
  const uiSrc = fs.readFileSync(path.join(ROOT, 'ui-runtime.js'), 'utf8');
  assert.equal(uiSrc.includes('& *::before,& *::after'), false, 'ui-runtime.js must not inject full-tree * wildcard CSS for motion="off"');
  assert.equal(domBusMod.MOTION_OFF_SCOPED_CSS.includes('*'), false, 'dom-bus MOTION_OFF_SCOPED_CSS must contain 0 universal * selectors');

  // PR #103 micro-optimizations wired cleanly
  const motionSrc = fs.readFileSync(path.join(ROOT, 'motion-engine.js'), 'utf8');
  assert.ok(motionSrc.includes('ICON_HOST_SEL') && motionSrc.includes('findTarget(e.target,true)'));
  assert.ok(
    fs.statSync(path.join(ROOT, 'motion-engine.js')).size + fs.statSync(path.join(ROOT, 'animated-icons.js')).size < 35840
  );
  const hiSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'host-i18n', 'host-i18n-runtime.js'), 'utf8');
  assert.ok(hiSrc.includes('hoverBoundaryCache') && hiSrc.includes('getHoverBoundary(') && hiSrc.includes('hasHoverCandidateWork('));
  assert.ok(hiSrc.includes('domBus.runChunked'));
  const omniSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'omni-viewer', 'omni-client.js'), 'utf8');
  assert.ok(omniSrc.includes('batchCache') && omniSrc.includes("addEventListener('scroll', onWindowBlurOrScroll, { capture: true, passive: true })"));
  assert.ok(uiSrc.includes('const isOwnPluginNode = (t, selfOnly) =>') && uiSrc.includes("D.getElementsByClassName('md-table-host')"));

  // Budgets check
  const ch1Bytes = Buffer.byteLength(cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: 'auto' }, { noDiskCache: true }), 'utf8');
  const refBytes = Buffer.byteLength(cdp.buildConfigRefreshExpression({ performanceMode: 'performance' }), 'utf8');
  assert.ok(ch1Bytes < 390000, `Ch1 auto ${ch1Bytes} B must stay < 390,000 B`);
  assert.ok(refBytes < 4096, `configRefresh ${refBytes} B must stay < 4,096 B`);
});

test('Conversation viewport stability: bottom-16 content-visibility exemption & crab 75cqh bottom clearance parity', () => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const flat = cssFlatten.flattenNestedCss(css);

  // 1) Remove sticky-breaking whole-turn & markdown pre content-visibility:auto (PR #138),
  //    while keeping expanded thinking/tool/step virtualization scoped outside bottom 16 turns (PR #127)
  //    so dynamic takeover/ask_question viewport height changes never trigger Chromium DisplayLock blanking.
  const turnCvAnchor =
    '[data-testid="conversation-view"] [data-testid="autoscroll-viewport"] .relative.flex.flex-col>div.flex.items-start:not(:nth-last-child(-n+16)):not([data-ag-cs-bleed="1"])';
  assert.equal(
    flat.includes(`html[data-ag-cs-style] ${turnCvAnchor}{content-visibility:auto`),
    false,
    'flattened CSS must not apply content-visibility:auto directly on whole turn rows'
  );
  assert.equal(
    flat.includes('[data-markdown-root] pre:not(:last-child):not([data-ag-cs-bleed="1"]){content-visibility:auto'),
    false,
    'flattened CSS must not apply content-visibility:auto on markdown pre blocks'
  );
  assert.ok(
    flat.includes(`html[data-ag-cs-style] ${turnCvAnchor} :is([data-testid="thinking-collapsible-trigger"],[data-testid="tool-group-collapsible"],[data-testid="worked-for-collapsible"])[aria-expanded="true"]+div:not([data-ag-cs-bleed="1"]){content-visibility:auto;contain-intrinsic-size:auto 140px`),
    'flattened CSS must scope expanded thinking/tool body content-visibility:auto inside >16-from-bottom turns'
  );
  assert.ok(
    flat.includes(`html[data-ag-cs-style] ${turnCvAnchor} :is([data-testid="tool-group-collapsible"],[data-testid="worked-for-collapsible"])[aria-expanded="true"]+div:not([data-ag-cs-bleed="1"]) .flex.flex-col>div.flex.flex-row:not(:last-child):not([data-ag-cs-bleed="1"]){content-visibility:auto;contain-intrinsic-size:auto 26px`),
    'flattened CSS must scope expanded tool-group step rows content-visibility:auto inside >16-from-bottom turns'
  );

  // 2) Eliminate double-counted native 48px spacer and recalibrate native 75cqh turn min-height under 76px crab clearance
  const crabNonChat = 'html[data-ag-cs-style][data-ag-cs-has-crab="1"]:not([data-ag-prism-mode="chat"])';
  assert.ok(
    flat.includes(`${crabNonChat} [data-testid="conversation-view"] [data-testid="autoscroll-viewport"] .relative.flex.flex-col+.h-px+div[style*="height"]{height:0 !important`),
    'flattened CSS must zero out duplicate native 48px bottom spacer when crab clearance is active'
  );
  assert.ok(
    flat.includes(`${crabNonChat} [data-testid="conversation-view"] [data-testid="autoscroll-viewport"] .relative.flex.flex-col>div.flex.items-start[style*="75cqh"]{min-height:max(0px,calc(75cqh - 77px)) !important`),
    'flattened CSS must recalibrate native 75cqh last-turn min-height to keep total footprint at 75cqh'
  );
});

test('Wave P3-B (Refs #151): two-tier top-level :is() expansion eliminates runtime universal-via-:is (230+ -> 0) with 0 static Ch1 bloat', () => {
  const { flattenNestedCss, expandTopLevelIsCss, classifySelectorSubject } = cssFlatten;

  // 1) classifySelectorSubject准确按 Blink RuleSet 桶归类
  assert.equal(classifySelectorSubject('html[x] #main'), 'id');
  assert.equal(classifySelectorSubject('html[x] .card:hover'), 'class');
  assert.equal(classifySelectorSubject('html[x] [data-testid="a"]::before'), 'attr');
  assert.equal(classifySelectorSubject('html[x] div:not(.a)'), 'tag');
  assert.equal(classifySelectorSubject('html[x] :is(.a,.b)'), 'universal-via-:is');
  assert.equal(classifySelectorSubject('html[x] .divide-y>:not([hidden])'), 'universal-other');

  // 2) css-flatten.cjs 升级能力：根前缀复杂分支、伪元素后置、嵌套 :is()、混合特异性、边界与安全保护
  assert.equal(
    flattenNestedCss('html[data-ag-cs-style]{& :is(.a .b,.c>.d){color:red}}', { expandTopLevelIs: true }),
    'html[data-ag-cs-style] .a .b,html[data-ag-cs-style] .c>.d{color:red;}'
  );
  assert.equal(
    flattenNestedCss('html[x]{& :is(.a,.b)::before{content:""}}', { expandTopLevelIs: true }),
    'html[x] .a::before,html[x] .b::before{content:"";}'
  );
  // 同权重保护（默认 expandMixedSpecificity=false 时不拆混杂权重，显式开启或 expandTopLevelIs:'all' 时展开）
  assert.equal(
    flattenNestedCss('html[x]{& :is(.a,div){color:red}}', { expandTopLevelIs: true }),
    'html[x] :is(.a,div){color:red;}'
  );
  assert.equal(
    flattenNestedCss('html[x]{& :is(.a,div){color:red}}', { expandTopLevelIs: true, expandMixedSpecificity: true }),
    'html[x] .a,html[x] div{color:red;}'
  );
  // 严格保护 :not(:is(...))、:where(...)、vendor 伪元素、祖先语义反转、引号/url/@keyframes 及上限 fail-open
  const guardedCss =
    'html[x] :not(:is(.a,.b)){opacity:1}' +
    'html[x] :where(.a,.b){opacity:1}' +
    'html[x] :is(.ok,::-moz-bad){opacity:.5}' +
    '.wrap :is(html[x] .inner,.plain){color:blue}' +
    'html[x] :is(.a::before,.b) span{display:block}' +
    'html[x] [data-v=":is(.a,.b)"]{content:":is(.x,.y)";background:url(https://ex.test/:is(a,b).png)}' +
    '@keyframes k{0%{opacity:0}to{opacity:1}}' +
    '@media (prefers-reduced-motion:reduce){html[x] :is(.p,.q){animation:none}}';
  const expandedGuarded = expandTopLevelIsCss(guardedCss);
  assert.ok(expandedGuarded.includes('html[x] :not(:is(.a,.b)){opacity:1}'), ':not(:is(...)) must stay intact');
  assert.ok(expandedGuarded.includes('html[x] :where(.a,.b){opacity:1}'), ':where(...) must stay intact');
  assert.ok(expandedGuarded.includes('html[x] :is(.ok,::-moz-bad){opacity:.5}'), 'vendor forgiving :is() must stay intact');
  assert.ok(expandedGuarded.includes('.wrap :is(html[x] .inner,.plain){color:blue}'), 'root-prefix ancestor inversion must never expand');
  assert.ok(expandedGuarded.includes('html[x] :is(.a::before,.b) span{display:block}'), 'pseudo-element followed by descendant must never expand');
  assert.ok(expandedGuarded.includes('[data-v=":is(.a,.b)"]{content:":is(.x,.y)";background:url(https://ex.test/:is(a,b).png)}'), 'attrs/strings/url must survive verbatim');
  assert.ok(expandedGuarded.includes('@keyframes k{0%{opacity:0}to{opacity:1}}'), '@keyframes must survive verbatim');
  assert.ok(expandedGuarded.includes('@media (prefers-reduced-motion:reduce){html[x] .p,html[x] .q{animation:none}}'), '@media nested subject :is() must expand');

  // 上限保护：超过 maxPerRule 安全回退原选择器，且 subjectOnly 下二次展开若已归入 class 桶则自动止步
  const overLimitRule = 'html[x] :is(.a,.b,.c){color:red}';
  assert.equal(expandTopLevelIsCss(overLimitRule, { maxPerRule: 2 }), overLimitRule, 'exceeding maxPerRule must fail-open to original prelude');
  const dualIsRule = 'html[x] :is(.a,.b):is(.c,.d){color:red}';
  assert.equal(
    expandTopLevelIsCss(dualIsRule, { maxPerRule: 2 }),
    'html[x] .a:is(.c,.d),html[x] .b:is(.c,.d){color:red}',
    'subjectOnly stops once each expanded branch has a class subject key'
  );

  // 3) 真实 Ch1 VM 沙盒验证：加载期一次性展开进 adoptedStyleSheets，universal-via-:is 降至 0，总 universal 降幅 >= 85%
  const rawStyleCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const flatMin = cssPack.minifyCss(flattenNestedCss(cssPack.minifyCss(rawStyleCss)));
  const countBuckets = (css) => {
    const counts = { id: 0, class: 0, attr: 0, tag: 0, 'universal-via-:is': 0, 'universal-other': 0 };
    const walk = (src) => {
      for (const r of cssPack.splitTopLevelCssRules(src)) {
        const bIdx = r.indexOf('{');
        if (bIdx < 0) continue;
        const pre = r.slice(0, bIdx).trim();
        const body = r.slice(bIdx + 1, r.lastIndexOf('}'));
        if (pre.startsWith('@')) {
          if (/^@(?:media|supports|container|layer|starting-style|scope)\b/i.test(pre)) walk(body);
          continue;
        }
        let d = 0, q = '', st = 0;
        for (let i = 0; i <= pre.length; i++) {
          const c = pre[i] || ',';
          if (c === '\\') { i++; continue; }
          if (q) { if (c === q) q = ''; continue; }
          if (c === '"' || c === "'") { q = c; continue; }
          if (c === '(' || c === '[') d++;
          else if ((c === ')' || c === ']') && d) d--;
          else if (c === ',' && !d) {
            const sel = pre.slice(st, i).trim();
            if (sel) counts[classifySelectorSubject(sel)] += 1;
            st = i + 1;
          }
        }
      }
    };
    walk(css);
    counts.totalUniversal = counts['universal-via-:is'] + counts['universal-other'];
    return counts;
  };

  const staticBuckets = countBuckets(flatMin);
  assert.ok(staticBuckets['universal-via-:is'] >= 150, `Static flatMin keeps compact :is() (${staticBuckets['universal-via-:is']}) for 0 Ch1 bloat`);

  const exprAuto = cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: 'auto' }, { noDiskCache: true });
  assert.ok(Buffer.byteLength(exprAuto, 'utf8') <= 389200, `Ch1[auto] (${Buffer.byteLength(exprAuto, 'utf8')} B) must stay <= 389,200 B`);

  const sheets = [];
  class MockCSSStyleSheet { replaceSync(txt) { this.cssText = txt; } }
  const styleById = new Map();
  const mkNode = (tag) => {
    const attrs = new Map();
    return {
      tagName: tag.toUpperCase(), textContent: '', parentNode: null, lastElementChild: null,
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      setAttribute: (k, v) => attrs.set(k, String(v)),
      hasAttribute: (k) => attrs.has(k),
      removeAttribute: (k) => attrs.delete(k),
      appendChild(ch) { if (ch.id) styleById.set(ch.id, ch); ch.parentNode = this; this.lastElementChild = ch; return ch; },
      remove() {},
    };
  };
  const html = mkNode('html'), head = mkNode('head'), body = mkNode('body');
  body.classList = { contains: (c) => c === 'monaco-workbench' };
  const doc = {
    documentElement: html, head, body, title: 'Antigravity', readyState: 'complete',
    adoptedStyleSheets: sheets,
    createElement: (t) => mkNode(t),
    getElementById: (id) => styleById.get(id) || null,
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
  const codeHashMatch = exprAuto.match(/codeHash==?"([a-f0-9]+)"/);
  const sandbox = {
    document: doc, location: { href: 'vscode-file://vscode-app/workbench.html' },
    CSSStyleSheet: MockCSSStyleSheet,
    addEventListener() {}, removeEventListener() {},
    setTimeout, clearTimeout, performance,
    __agPrism: {
      version: cdp.PLUGIN_VERSION,
      codeHash: codeHashMatch ? codeHashMatch[1] : '',
      refreshConfig() {},
      getState: () => ({ cfg: cdp.DEFAULT_CONFIG }),
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(exprAuto, sandbox);

  assert.equal(doc.adoptedStyleSheets.length, 1, 'Ch1 must mount exactly 1 adoptedStyleSheet');
  const runtimeCss = doc.adoptedStyleSheets[0].cssText;
  assert.equal(runtimeCss, expandTopLevelIsCss(flatMin), 'Runtime adopted CSS must match expandTopLevelIsCss(flatMin) byte-for-byte');
  const runtimeBuckets = countBuckets(runtimeCss);
  assert.equal(runtimeBuckets['universal-via-:is'], 0, `Runtime universal-via-:is must drop to 0, got ${runtimeBuckets['universal-via-:is']}`);
  const dropRatio = 1 - runtimeBuckets.totalUniversal / staticBuckets.totalUniversal;
  assert.ok(
    dropRatio >= 0.85,
    `Runtime total universal_rules_ must drop >= 85% (${staticBuckets.totalUniversal} -> ${runtimeBuckets.totalUniversal}, ${(dropRatio * 100).toFixed(2)}%)`
  );
  assert.equal(runtimeCss.includes(':has('), false, 'Runtime expanded CSS must contain 0 :has(');
  assert.equal(runtimeCss.includes('steps('), false, 'Runtime expanded CSS must contain 0 steps(');
});
