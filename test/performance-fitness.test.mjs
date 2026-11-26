import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');

function makeClock(startNow = 1000) {
  let now = startNow;
  let seq = 1;
  const timers = new Map();
  const rafs = new Map();
  return {
    get now() { return now; },
    set now(v) { now = v; },
    timers,
    rafs,
    performance: { now: () => now },
    setTimeout(fn, ms = 0) {
      const id = seq++;
      const delay = Math.max(0, Number(ms) || 0);
      timers.set(id, { fn, ms: delay, due: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) {
      const id = seq++;
      rafs.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) { rafs.delete(id); },
    flushRafs(stepMs = 16) {
      now += stepMs;
      const list = [...rafs.entries()];
      rafs.clear();
      for (const [, fn] of list) fn(now);
      return list.length;
    },
    advance(deltaMs, tickMs = 16) {
      const end = now + deltaMs;
      while (now < end) {
        let nextTimer = null;
        for (const [id, t] of timers.entries()) {
          if (t.due <= end && (!nextTimer || t.due < nextTimer.t.due)) nextTimer = { id, t };
        }
        const nextRafTime = rafs.size > 0 ? Math.min(end, now + tickMs) : Infinity;
        if (nextTimer && nextTimer.t.due <= nextRafTime) {
          now = nextTimer.t.due;
          timers.delete(nextTimer.id);
          nextTimer.t.fn();
        } else if (nextRafTime < Infinity) {
          now = nextRafTime;
          const list = [...rafs.entries()];
          rafs.clear();
          for (const [, fn] of list) fn(now);
        } else {
          now = end;
        }
      }
    },
  };
}

function makeBus() {
  const m = new Map();
  return {
    add(t, fn) { if (!m.has(t)) m.set(t, new Set()); m.get(t).add(fn); },
    remove(t, fn) { m.get(t)?.delete(fn); },
    dispatch(t, ev = {}) { for (const fn of [...(m.get(t) || [])]) fn(ev); },
    count(t) { return (m.get(t) || new Set()).size; },
  };
}

function createTrackingWebGL2() {
  const stats = {
    createProgram: 0,
    deleteProgram: 0,
    compileShader: 0,
    texStorage2D: 0,
    texImage2D: 0,
    texSubImage2D: 0,
    drawArrays: 0,
    loseContext: 0,
    lost: false,
    shaderSources: [],
  };
  const gl = {
    VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88e4, FLOAT: 0x1406, COLOR_BUFFER_BIT: 0x4000,
    TRIANGLES: 0x0004, TRIANGLE_STRIP: 0x0005, TEXTURE_2D: 0x0de1, TEXTURE0: 0x84c0, TEXTURE1: 0x84c1,
    RGBA: 0x1908, RGBA8: 0x8058, UNSIGNED_BYTE: 0x1401, NEAREST: 0x2600, LINEAR: 0x2601, CLAMP_TO_EDGE: 0x812f,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
    isContextLost: () => stats.lost,
    createShader: (type) => ({ type }),
    shaderSource: (_s, src) => { stats.shaderSources.push(src); },
    compileShader: () => { stats.compileShader += 1; },
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    deleteShader() {},
    createProgram: () => { stats.createProgram += 1; return { id: stats.createProgram }; },
    attachShader() {},
    linkProgram() {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    useProgram() {},
    deleteProgram: () => { stats.deleteProgram += 1; },
    createBuffer: () => ({}),
    bindBuffer() {},
    bufferData() {},
    deleteBuffer() {},
    getAttribLocation: () => 0,
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    getUniformLocation: (_p, n) => ({ n }),
    createTexture: () => ({}),
    deleteTexture() {},
    activeTexture() {},
    bindTexture() {},
    texParameteri() {},
    texStorage2D: () => { stats.texStorage2D += 1; },
    texImage2D: () => { stats.texImage2D += 1; },
    texSubImage2D: () => { stats.texSubImage2D += 1; },
    viewport() {},
    clearColor() {},
    clear() {},
    uniform1i() {},
    uniform1f() {},
    uniform2f() {},
    uniform3f() {},
    uniform4f() {},
    uniform1fv() {},
    uniform2fv() {},
    uniform3fv() {},
    uniform4fv() {},
    drawArrays: () => { stats.drawArrays += 1; },
    getExtension: (n) => (n === 'WEBGL_lose_context' ? { loseContext() { stats.loseContext += 1; } } : null),
  };
  return { gl, stats };
}

function makeFakeElement(tag, docRef, opts = {}) {
  const attrs = new Map();
  const bus = makeBus();
  const kids = [];
  let ctxCache = null;
  let glTracker = null;
  const el = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    className: '',
    dataset: {},
    width: tag === 'canvas' ? 300 : undefined,
    height: tag === 'canvas' ? 150 : undefined,
    clientWidth: opts.w ?? 1200,
    clientHeight: opts.h ?? 720,
    hidden: false,
    isConnected: true,
    parentNode: null,
    parentElement: null,
    ownerDocument: docRef,
    children: kids,
    style: { setProperty(k, v) { this[k] = String(v); }, removeProperty(k) { delete this[k]; } },
    get firstChild() { return kids[0] || null; },
    setAttribute(k, v) {
      attrs.set(k, String(v));
      if (k === 'data-ag-cs-perf-mode') el.dataset.agCsPerfMode = String(v);
    },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
    hasAttribute(k) { return attrs.has(k); },
    removeAttribute(k) {
      attrs.delete(k);
      if (k === 'data-ag-cs-perf-mode') delete el.dataset.agCsPerfMode;
    },
    appendChild(c) { c.parentNode = c.parentElement = el; c.isConnected = true; kids.push(c); return c; },
    insertBefore(c, ref) {
      c.parentNode = c.parentElement = el; c.isConnected = true;
      const idx = ref ? kids.indexOf(ref) : -1;
      if (idx >= 0) kids.splice(idx, 0, c); else kids.unshift(c);
      return c;
    },
    replaceChild(next, old) {
      const idx = kids.indexOf(old);
      if (idx >= 0) kids.splice(idx, 1, next); else kids.push(next);
      old.parentNode = old.parentElement = null; old.isConnected = false;
      next.parentNode = next.parentElement = el; next.isConnected = true;
      return old;
    },
    replaceWith(next) { if (el.parentNode) el.parentNode.replaceChild(next, el); },
    remove() {
      if (el.parentNode) {
        const i = el.parentNode.children.indexOf(el);
        if (i >= 0) el.parentNode.children.splice(i, 1);
        el.parentNode = el.parentElement = null;
      }
      el.isConnected = false;
    },
    matches: (sel) => Boolean(el.getAttribute('data-testid') && sel.includes(`"${el.getAttribute('data-testid')}"`)),
    closest: () => null,
    contains: (other) => { let c = other; while (c) { if (c === el) return true; c = c.parentNode; } return false; },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (t, fn) => bus.add(t, fn),
    removeEventListener: (t, fn) => bus.remove(t, fn),
    dispatch: (t, ev = {}) => bus.dispatch(t, { preventDefault() {}, ...ev }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: el.clientWidth, height: el.clientHeight }),
    getContext(kind, ctxOpts) {
      if (tag !== 'canvas') return null;
      if (opts.onGetContext) opts.onGetContext(el, kind, ctxOpts);
      if (kind === 'webgl2') {
        if (opts.failWebGL2) return null;
        if (!glTracker) glTracker = createTrackingWebGL2();
        el._glStats = glTracker.stats;
        return glTracker.gl;
      }
      if (kind === '2d') {
        if (!ctxCache) {
          ctxCache = {
            font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '',
            save() {}, restore() {}, setTransform() {}, clearRect() {}, fillRect() {}, fillText() {},
            beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, closePath() {}, fill() {}, stroke() {},
            translate() {}, rotate() {}, ellipse() {}, arc() {}, roundRect() {}, clip() {},
            drawImage() { el._drawImageCalls = (el._drawImageCalls || 0) + 1; },
            createLinearGradient: () => ({ addColorStop() {} }),
            createRadialGradient: () => ({ addColorStop() {} }),
            getImageData: (_x, _y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(4, w * h * 4)) }),
            createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(4, w * h * 4)) }),
            putImageData() {},
          };
        }
        return ctxCache;
      }
      return null;
    },
  };
  return el;
}

// ── 1 & 2: Issue #97 主页闪烁修复 + 原地 resize 不销毁重建 WebGL2 + 0fps 休眠 ──
test('Performance Fitness 1 & 2: home-ripple-host 120ms resize debounce, in-place WebGL2 resize (0 program rebuild), sync wake(true) anti-flicker, and strict 0fps sleep', () => {
  const rippleCoreSrc = fs.readFileSync(path.join(ROOT, 'ripple-core.js'), 'utf8');
  const hostSrc = fs.readFileSync(path.join(ROOT, 'home-ripple-host.js'), 'utf8');
  const workerSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'ripple-worker.js'), 'utf8');
  const clock = makeClock(1000);
  const docBus = makeBus();
  const winBus = makeBus();
  let roCb = null;
  const mos = [];

  const doc = { hidden: false };
  const html = makeFakeElement('html', doc);
  html.setAttribute('data-ag-cs-palette', 'obsidian');
  html.setAttribute('data-ag-cs-ambient', '1');
  const body = makeFakeElement('body', doc);
  const home = makeFakeElement('div', doc, { w: 1200, h: 720 });
  doc.documentElement = html;
  doc.body = body;
  doc.createElement = (tag) => makeFakeElement(tag, doc);
  doc.querySelector = (sel) => (sel === '.agy-home' ? home : null);
  doc.querySelectorAll = () => [];
  doc.addEventListener = (t, fn) => docBus.add(t, fn);
  doc.removeEventListener = (t, fn) => docBus.remove(t, fn);

  const sb = {
    document: doc,
    devicePixelRatio: 2,
    performance: clock.performance,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    ResizeObserver: class { constructor(cb) { roCb = cb; } observe() {} disconnect() {} },
    MutationObserver: class { constructor(cb) { this.cb = cb; mos.push(this); } observe() {} disconnect() {} },
    addEventListener: (t, fn) => winBus.add(t, fn),
    removeEventListener: (t, fn) => winBus.remove(t, fn),
    Float32Array, Uint8Array, Uint32Array, Uint8ClampedArray, Map, Set, WeakMap, WeakSet,
    Math, Number, String, Boolean, Array, Object, Date, Promise, RegExp, Error,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(workerSrc, sb);
  vm.runInNewContext(rippleCoreSrc, sb);
  vm.runInNewContext(hostSrc, sb);

  const ctl = sb.__agPrismHomeRippleHost.createHomeRippleController({
    rippleCore: sb.__agCsRippleCore,
    isDestroyed: () => false,
    isAllowed: () => true,
    isDarkTheme: () => true,
    motionReduced: () => false,
    getMinFrameGapMs: () => 0,
    getAmbientIntensity: () => 1,
    getAccentTone: () => 'follow',
    setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
  });

  ctl.sync();
  clock.flushRafs(16);
  const m = ctl.getMount();
  assert.equal(m.field.mode, 'webgl2');
  assert.equal(m.glow.mode, 'webgl2');
  // balanced 默认档（2x DPR）: ripple 封顶 1.5x, glow 低 DPR (<=1.25)
  assert.equal(m.dpr, 1.5, 'balanced perf mode must cap ripple DPR at 1.5 on 2x screen');
  const fieldGl = m.canvas._glStats;
  const glowGl = m.glowCanvas._glStats;
  assert.equal(fieldGl.createProgram, 1);
  assert.equal(fieldGl.texImage2D, 1, 'GlyphAtlas uploaded once');
  const initFieldDraws = fieldGl.drawArrays;
  const initGlowDraws = glowGl.drawArrays;
  assert.ok(initFieldDraws >= 1 && initGlowDraws >= 1);

  // Issue #97 核心验证：侧边栏打开设置 data-ag-cs-resizing="1"，连续 20 帧宽度变化期间 0 重建、0 尺寸重设、0 闪烁
  html.setAttribute('data-ag-cs-resizing', '1');
  const widthBeforeDrag = m.canvas.width;
  const drawsBeforeDrag = fieldGl.drawArrays;
  for (let i = 1; i <= 20; i++) {
    clock.now += 16;
    home.clientWidth = 1200 - i * 16;
    roCb([]);
  }
  assert.equal(m.canvas.width, widthBeforeDrag, 'During data-ag-cs-resizing="1", canvas backing buffer must stay intact for CSS stretch');
  assert.equal(fieldGl.deleteProgram, 0, 'Must NEVER dispose WebGL2 program during sidebar resize');
  assert.equal(fieldGl.createProgram, 1, 'Must NEVER recreate WebGL2 program during sidebar resize');

  // 释放 resizing，120ms 防抖到期 -> 原地 resize + 同帧同步 wake(true) 绘制（无需等下一次 rAF！）
  html.removeAttribute('data-ag-cs-resizing');
  const fieldDrawsPreFlush = fieldGl.drawArrays;
  const glowDrawsPreFlush = glowGl.drawArrays;
  clock.advance(125, 16);
  assert.equal(m.width, 880, 'Final settled width applied once after 120ms debounce');
  assert.equal(fieldGl.createProgram, 1, 'In-place resize must reuse WebGL2 program (0 recompile)');
  assert.equal(fieldGl.deleteProgram, 0, 'In-place resize must not delete WebGL2 program');
  assert.equal(fieldGl.texImage2D, 1, 'In-place resize at unchanged DPR must reuse GlyphAtlas (0 re-upload)');
  assert.ok(fieldGl.drawArrays > fieldDrawsPreFlush, 'Sync wake(true) must repaint glyph field in same frame after canvas.width reset (anti-#97 flicker)');
  assert.ok(glowGl.drawArrays > glowDrawsPreFlush, 'Sync wake(true) must repaint brand glow in same frame after resize');

  // 严格 0fps 休眠：隐藏 / 失焦 / 周期表开启 / 静置 >1200ms
  clock.advance(1800, 32);
  assert.equal(m.sleeping, true, 'Idle home ripple must settle to 0fps sleep after intro');
  assert.equal(clock.rafs.size, 0, '0 rAF scheduled in idle sleep');
  assert.equal(clock.timers.size, 0, '0 timers scheduled in idle sleep');

  // 模拟窗口失焦 -> 0fps
  m.onMove({ clientX: 200, clientY: 200 });
  assert.equal(clock.rafs.size, 1);
  winBus.dispatch('blur');
  assert.equal(m.sleeping, true);
  assert.equal(clock.rafs.size, 0, 'window.blur must immediately cancel rAF to 0fps');

  // 周期表打开 -> 0fps
  winBus.dispatch('focus');
  html.setAttribute('data-ag-pp-open', '1');
  for (const mo of mos) mo.cb([]);
  assert.equal(m.sleeping, true);
  assert.equal(clock.rafs.size, 0, 'data-ag-pp-open="1" must enforce 0fps sleep');

  // document.hidden -> 0x0 VRAM 回收 + 0fps
  html.removeAttribute('data-ag-pp-open');
  doc.hidden = true;
  docBus.dispatch('visibilitychange');
  assert.equal(m.canvas.width, 0);
  assert.equal(m.glowCanvas.width, 0);
  assert.equal(clock.rafs.size, 0);

  ctl.unmount();
  assert.equal(clock.rafs.size, 0);
  assert.equal(clock.timers.size, 0);
});

// ── 3: conv-aura PR #102 native VSync + performance 60fps 封顶 + Issue #97 同步重绘 + swapCv 自愈 ──
test('Performance Fitness 3: conv-aura native VSync pacing (~53-60fps), performance <=60fps cap, sync resize repaint, and webglcontextlost swapCv recovery', () => {
  const convAuraSrc = fs.readFileSync(path.join(ROOT, 'conv-aura.js'), 'utf8');
  const workerSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'ripple-worker.js'), 'utf8');
  const clock = makeClock(1000);
  const docBus = makeBus();
  const winBus = makeBus();
  let roCb = null;

  const doc = { hidden: false, hasFocus: () => true };
  const html = makeFakeElement('html', doc);
  const seat = makeFakeElement('div', doc, { w: 900, h: 600 });
  const convView = makeFakeElement('div', doc, { w: 900, h: 600 });
  convView.setAttribute('data-testid', 'conversation-view');
  const stopBtn = makeFakeElement('button', doc);
  stopBtn.setAttribute('data-testid', 'stop-button');
  seat.appendChild(convView);
  convView.appendChild(stopBtn);

  doc.documentElement = html;
  doc.createElement = (tag) => makeFakeElement(tag, doc);
  doc.querySelector = () => null;
  doc.querySelectorAll = (sel) => {
    if (sel.includes('conversation-view')) return [convView];
    if (sel.includes('stop-button')) return [stopBtn];
    return [];
  };
  doc.addEventListener = (t, fn) => docBus.add(t, fn);
  doc.removeEventListener = (t, fn) => docBus.remove(t, fn);

  const sb = {
    document: doc,
    devicePixelRatio: 2,
    performance: clock.performance,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    ResizeObserver: class { constructor(cb) { roCb = cb; } observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    addEventListener: (t, fn) => winBus.add(t, fn),
    removeEventListener: (t, fn) => winBus.remove(t, fn),
    WeakSet, Set, Map, Array, Object, Math, Number, String, Boolean, Date, Promise,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(workerSrc, sb);
  vm.runInNewContext(convAuraSrc, sb);

  let glowDraws = 0;
  let lastLostCb = null;
  const mountedCanvases = [];
  const mountedModes = [];
  const mockRippleCore = {
    resolveHorizonDpr: (raw, sc) => Math.min(raw, 2) * sc,
    mountBrandHorizonGlow(cv, opts) {
      mountedCanvases.push(cv);
      const mode = opts?.prefer2D ? '2d' : 'webgl2';
      mountedModes.push(mode);
      lastLostCb = opts?.onContextLost || null;
      return {
        mode,
        resize(w, h, dpr) { cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr)); },
        releaseBackingStore() { cv.width = cv.height = 0; },
        invalidate() {},
        clear() {},
        draw() { glowDraws += 1; },
        drawStaticSnapshot() { glowDraws += 1; },
        dispose() {},
      };
    },
  };

  const ctl = sb.__agPrismConvAura.createConvAuraController({
    isDestroyed: () => false,
    isHomeRippleEnabled: () => true,
    isMotionStandardOrUltra: () => true,
    isDarkTheme: () => true,
    getMinFrameGapMs: () => 0, // targetFps: 'native'
    getAmbientIntensity: () => 1,
    getSpectrumMode: () => 'default',
    isWindowFocused: () => true,
    rippleCore: mockRippleCore,
    setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    runGuardedMut: (fn) => fn(),
  });

  ctl.sync();
  const inst = ctl.getInstance();
  assert.equal(inst.phase, 'running');

  // 1) PR #102 native 160Hz (6.25ms/tick) VSync pacing: ~53.4fps (NOT ~26fps setTimeout!)
  const drawsBefore160 = glowDraws;
  clock.advance(1000, 6.25);
  const fps160 = glowDraws - drawsBefore160;
  assert.ok(fps160 >= 50 && fps160 <= 64, `PR #102 native 160Hz VSync expected 50..64 fps, got ${fps160}`);

  // 2) performance 档位下软封顶 <= 60fps
  html.setAttribute('data-ag-cs-perf-mode', 'performance');
  const drawsBeforePerf = glowDraws;
  clock.advance(1000, 3.333); // 300Hz
  const fpsPerf = glowDraws - drawsBeforePerf;
  assert.ok(fpsPerf <= 60, `performance mode must soft-cap FPS <= 60 on 300Hz, got ${fpsPerf}`);

  // 3) Issue #97: 单次缩放 & 120ms 防抖结算均同步 wake(true) 立即重绘（不留 1 帧透明微闪！）
  clock.now += 500;
  const drawsPreSingleResize = glowDraws;
  roCb([{ contentRect: { width: 760, height: 600 } }]);
  assert.equal(glowDraws, drawsPreSingleResize + 1, 'Single resize must synchronously repaint via wake(true) without waiting next rAF');

  html.setAttribute('data-ag-cs-resizing', '1');
  for (let i = 1; i <= 5; i++) {
    clock.now += 16;
    roCb([{ contentRect: { width: 760 - i * 20, height: 600 } }]);
  }
  html.removeAttribute('data-ag-cs-resizing');
  const drawsPreDebounceFlush = glowDraws;
  // 仅触发 120ms timer，不手动 flush rAF -> 必须已同步重绘！
  const nextDue = Math.min(...[...clock.timers.values()].map((t) => t.due));
  clock.now = nextDue;
  for (const [id, t] of [...clock.timers.entries()]) {
    if (t.due <= clock.now) { clock.timers.delete(id); t.fn(); }
  }
  assert.ok(glowDraws > drawsPreDebounceFlush, 'flushPendingResize must synchronously paint via wake(true) to eliminate 1-frame flicker');

  // 4) webglcontextlost -> swapCv() 替换画布并自愈（第 2 次降级 2D）
  const firstCanvas = inst.canvas;
  assert.equal(typeof lastLostCb, 'function');
  lastLostCb();
  clock.advance(40, 16);
  assert.notEqual(inst.canvas, firstCanvas, 'onContextLost must replace canvas via swapCv()');
  assert.equal(mountedCanvases.length, 2);
  // 再次 lost -> 第 2 次恢复降级 2D
  lastLostCb();
  clock.advance(40, 16);
  assert.equal(mountedModes[mountedModes.length - 1], '2d', 'Repeated context loss must degrade safely to 2D');

  ctl.unmount();
  assert.equal(clock.rafs.size, 0);
  assert.equal(clock.timers.size, 0);
});

// ── 4: ripple-worker 1x1 探针通过、120ms 超时/CSP 失败、webglcontextlost 回退、0fps/0 IPC 与 0 泄漏 ──
test('Performance Fitness 4: ripple-worker 1x1 probe cache, 120ms timeout & CSP fallback, webglcontextlost swapCv recovery, 0 postMessage sleep, perf modes & disposeAll 0 leak', async () => {
  const workerSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'ripple-worker.js'), 'utf8');
  const rippleCore = require(path.join(ROOT, 'ripple-core.js'));

  function makeWorkerHarness({ mode = 'ok' } = {}) {
    let createdWorkers = 0;
    let terminatedWorkers = 0;
    let revokedUrls = 0;
    let urlSeq = 1;
    const workers = [];
    const doc = {
      hidden: false,
      documentElement: {
        dataset: {},
        _attrs: new Map(),
        setAttribute(k, v) { this._attrs.set(k, String(v)); if (k === 'data-ag-cs-perf-mode') this.dataset.agCsPerfMode = String(v); },
        getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
        removeAttribute(k) { this._attrs.delete(k); if (k === 'data-ag-cs-perf-mode') delete this.dataset.agCsPerfMode; },
      },
    };
    class MockOffscreenCanvas {
      constructor(w, h) { this.width = w; this.height = h; }
    }
    class MockWorker {
      constructor(url) {
        if (mode === 'csp-throw') throw new Error('SecurityError: CSP blocked blob: worker');
        this.url = url;
        this.terminated = false;
        this.sent = [];
        this.onmessage = null;
        this.onerror = null;
        createdWorkers += 1;
        workers.push(this);
      }
      postMessage(msg) {
        this.sent.push(msg);
        if (msg.type === 'probe') {
          if (mode === 'ok') {
            queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data: { type: 'probe', ok: true, reason: 'ok' } }); });
          } else if (mode === 'webgl-null') {
            queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data: { type: 'probe', ok: false, reason: 'webgl2-null' } }); });
          }
          // mode === 'timeout': intentionally never replies
        } else if (msg.type === 'init') {
          if (mode === 'ok') {
            queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data: { type: 'ready' } }); });
          }
        }
      }
      terminate() {
        if (!this.terminated) { this.terminated = true; terminatedWorkers += 1; }
      }
    }
    const sb = {
      document: doc,
      OffscreenCanvas: MockOffscreenCanvas,
      Worker: MockWorker,
      Blob: class { constructor(parts) { this.parts = parts; } },
      URL: {
        createObjectURL: () => `blob:prism-${urlSeq++}`,
        revokeObjectURL: () => { revokedUrls += 1; },
      },
      setTimeout, clearTimeout, queueMicrotask, Promise, Math, Number, String, Boolean, Array, Object, Date, Set, Map, Error,
    };
    sb.window = sb;
    sb.globalThis = sb;
    vm.runInNewContext(workerSrc, sb);
    return {
      api: sb.__agPrismRippleWorker,
      doc,
      workers,
      getCounts: () => ({ createdWorkers, terminatedWorkers, revokedUrls }),
    };
  }

  // 4a) 1x1 探针通过、缓存复用、transferControlToOffscreen 挂载、休眠 0 postMessage IPC 与 webglcontextlost 回退
  {
    const h = makeWorkerHarness({ mode: 'ok' });
    const p1 = await h.api.probeWorkerWebGL2({ timeoutMs: 80 });
    assert.equal(p1.ok, true);
    assert.equal(h.api.getActiveWorkerCount(), 0, 'Probe worker must terminate immediately after probe');
    const p2 = await h.api.probeWorkerWebGL2({ timeoutMs: 80 });
    assert.equal(p2.ok, true);
    assert.equal(h.getCounts().createdWorkers, 1, 'Probe result must be globally cached (no duplicate probe worker)');

    let transferred = 0;
    let fallbackReasons = [];
    const cv = {
      ownerDocument: h.doc,
      transferControlToOffscreen() { transferred += 1; return { width: 10, height: 10 }; },
    };
    const sess = h.api.mountGlowWorker(cv, {
      rippleCore, doc: h.doc, width: 600, height: 200, dpr: 1,
      onFallback: (r) => fallbackReasons.push(r),
    });
    assert.ok(sess && sess.mode === 'worker-webgl2');
    assert.equal(transferred, 1);
    assert.equal(h.api.getActiveWorkerCount(), 1);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(sess.getStats().ready, true);

    // 休眠后严格 0 postMessage IPC
    sess.setPaused(true);
    h.doc.hidden = true;
    const msgsAtSleep = sess.getStats().postMessageCount;
    for (let i = 0; i < 10; i++) sess.draw(1000 + i * 16, { dark: true, strength: 1 });
    assert.equal(sess.getStats().postMessageCount, msgsAtSleep, 'Hidden/paused worker must send 0 postMessage IPC');
    h.doc.hidden = false;

    // 模拟 Worker 内 webglcontextlost -> 立即终止 Worker 并触发 onFallback（供宿主 swapCv() 切回主线程）
    const activeW = h.workers[h.workers.length - 1];
    activeW.onmessage({ data: { type: 'contextlost' } });
    assert.equal(activeW.terminated, true, 'webglcontextlost must immediately terminate worker');
    assert.equal(h.api.getActiveWorkerCount(), 0, '0 zombie workers after contextlost');
    assert.deepEqual(fallbackReasons, ['contextlost']);
    assert.equal(sess.isContextLost(), true);
  }

  // 4b) 探针 120ms 超时保护 + 0 泄漏
  {
    const h = makeWorkerHarness({ mode: 'timeout' });
    const t0 = Date.now();
    const res = await h.api.probeWorkerWebGL2({ timeoutMs: 40 });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'timeout');
    assert.ok(Date.now() - t0 >= 30);
    assert.equal(h.api.getActiveWorkerCount(), 0, 'Timed-out probe worker must be terminated');
    assert.equal(h.getCounts().terminatedWorkers, 1);
    assert.equal(h.getCounts().revokedUrls, 1);
  }

  // 4c) CSP 拦截 blob: 构造抛 SecurityError -> 零未捕获异常 + 自动回退 + 0 泄漏
  {
    const h = makeWorkerHarness({ mode: 'csp-throw' });
    const fallbacks = [];
    const cv = { transferControlToOffscreen() { throw new Error('must not transfer before probe succeeds'); } };
    const sess = await h.api.mountGlowWorkerWithProbe(cv, { rippleCore, onFallback: (r) => fallbacks.push(r) });
    assert.equal(sess, null);
    assert.equal(fallbacks.length, 1);
    assert.equal(h.api.getActiveWorkerCount(), 0);
    assert.equal(h.getCounts().revokedUrls, 1, 'CSP failure must still revoke Blob URL');
  }

  // 4d) disposeAll() 彻底终止所有活跃 Worker + 三档性能模式校验
  {
    const h = makeWorkerHarness({ mode: 'ok' });
    await h.api.probeWorkerWebGL2();
    const mkCv = () => ({ ownerDocument: h.doc, transferControlToOffscreen: () => ({ width: 1, height: 1 }) });
    const s1 = h.api.mountGlowWorker(mkCv(), { rippleCore, doc: h.doc });
    const s2 = h.api.mountGlowWorker(mkCv(), { rippleCore, doc: h.doc });
    assert.ok(s1 && s2 && h.api.getActiveWorkerCount() === 2);
    h.api.disposeAll();
    assert.equal(h.api.getActiveWorkerCount(), 0, 'disposeAll() must terminate all workers with 0 leaks');

    // balanced / performance / quality 策略核验
    assert.equal(h.api.getPerfMode(h.doc), 'balanced');
    assert.equal(h.api.resolveRippleDpr(2, h.doc), 1.5);
    assert.ok(h.api.resolveGlowDpr(1, h.doc) === 0.7);
    h.doc.documentElement.setAttribute('data-ag-cs-perf-mode', 'performance');
    assert.equal(h.api.resolveRippleDpr(2, h.doc), 1.0);
    assert.equal(h.api.resolveGlowDpr(1, h.doc), 0.55);
    assert.ok(h.api.getPerfMinGapMs(h.doc) >= 16.6);
    h.doc.documentElement.setAttribute('data-ag-cs-perf-mode', 'quality');
    assert.equal(h.api.resolveRippleDpr(2, h.doc), 2.0);
    assert.equal(h.api.getPerfProfile(h.doc).msaa, true);
  }
});

// ── 5: ripple-core PR #103 + mediump/highp/ign | vial-core 双 Canvas 零 drawImage | crystal-prism-core DPR/MSAA ──
test('Performance Fitness 5: ripple-core fbm3/mediump/ign, vial-core layered zero-copy Canvas (0 drawImage), and crystal-prism-core MSAA/DPR caps', () => {
  // 5a) ripple-core shader 精度与 PR #103 fbm3 / early-out / halftone guard
  const rippleCore = require(path.join(ROOT, 'ripple-core.js'));
  const hFrag = rippleCore.HORIZON_FRAGMENT_SHADER;
  assert.ok(hFrag.includes('precision mediump float;'), 'HORIZON_FRAGMENT_SHADER must use precision mediump float');
  assert.ok(hFrag.includes('uniform highp vec2 uRes;') && hFrag.includes('float ign(highp vec2 p)'), 'Must preserve highp vec2 coords & ign() anti-banding dither');
  assert.ok(hFrag.includes('float fbm3(') && hFrag.includes('0.0625'), 'Must include PR #103 midpoint-preserving 3-octave fbm3');
  assert.ok(hFrag.includes('glow * topFeather < 0.0008'), 'Must include PR #103 transparent fragment early-out');
  assert.ok(hFrag.includes('dotMsk > 0.001 ? halftone('), 'Must guard halftone() with dotMsk > 0.001');

  const rawRipple = fs.readFileSync(path.join(ROOT, 'ripple-core.js'), 'utf8');
  assert.ok(rawRipple.includes('const FRAGMENT_SHADER = `#version 300 es\nprecision mediump float;'), 'ASCII FRAGMENT_SHADER must use precision mediump float');
  assert.ok(rawRipple.includes('uniform highp vec2 size;'), 'ASCII FRAGMENT_SHADER must keep highp vec2 coords');

  // 5b) vial-core 双叠层 Canvas：DOM 挂载态严格 0 次 ctx2d.drawImage(glCanvas) 跨上下文拷贝
  const vialCore = require(path.join(ROOT, 'vial-core.js'));
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const doc = { hidden: false };
  const html = makeFakeElement('html', doc);
  doc.documentElement = html;
  const created = [];
  doc.createElement = (tag) => { const n = makeFakeElement(tag, doc); created.push(n); return n; };
  globalThis.document = doc;
  globalThis.window = { devicePixelRatio: 2 };
  try {
    const slot = makeFakeElement('div', doc);
    const topCanvas = makeFakeElement('canvas', doc);
    slot.appendChild(topCanvas);
    const vial = vialCore.mountPhysicalWaterVial(topCanvas, {
      fill: 0.48,
      streaming: true,
      getState: () => ({ isDark: true, camp: 'gemini', critical: false, fill: 0.48, maxTokens: 512000, hoveredSlice: -1, streaming: true }),
    });
    assert.equal(vial.getDebugState().rendererMode, 'webgl2');
    assert.equal(vial.getDebugState().zeroCopy, true, 'Mounted vial must activate layered zero-copy WebGL2 canvas');
    assert.equal(slot.children.length, 2, 'Parent slot must contain bottom glCanvas + top 2D scale canvas');
    const glCanvas = slot.children[0];
    assert.equal(glCanvas.getAttribute('data-ag-vial-gl'), '1');

    for (let i = 0; i < 20; i++) vial.step(0.016);
    assert.equal(topCanvas._drawImageCalls || 0, 0, 'Layered dual-canvas vial must execute strictly 0 ctx2d.drawImage(glCanvas) cross-context blits');
    assert.ok(glCanvas._glStats.drawArrays >= 20, 'Bottom WebGL2 canvas renders directly every frame');

    // contextlost 隐藏底层 glCanvas 并自动退回 2D 不黑屏
    glCanvas.dispatch('webglcontextlost');
    assert.equal(glCanvas.style.display, 'none');
    vial.step(0.016);
    assert.equal(vial.getDebugState().rendererMode, '2d');

    vial.dispose();
    assert.equal(slot.children.length, 1, 'dispose() must remove injected bottom glCanvas cleanly');
  } finally {
    if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
    if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin;
  }

  // 5c) crystal-prism-core 默认关闭冗余 MSAA（仅 quality 开启）且 DPR 封顶 <=1.5（performance <=1.0）
  const crystalCore = require(path.join(ROOT, 'crystal-prism-core.js'));
  const capturedGlOpts = [];
  const prevDoc2 = globalThis.document;
  const prevWin2 = globalThis.window;
  const doc2 = { hidden: false };
  const html2 = makeFakeElement('html', doc2);
  doc2.documentElement = html2;
  globalThis.document = doc2;
  globalThis.window = { devicePixelRatio: 3 };
  try {
    // 默认 balanced 档：antialias=false, DPR 封顶 1.5
    const cv1 = makeFakeElement('canvas', doc2, { w: 200, h: 28, onGetContext: (_el, k, o) => { if (k === 'webgl2') capturedGlOpts.push(o); } });
    const bar1 = crystalCore.mountCrystalPrismBar(cv1, { getState: () => ({ isDark: true, prismStrength: 1 }) });
    bar1.step(0.016);
    assert.equal(capturedGlOpts[0]?.antialias, false, 'Default balanced mode must disable redundant MSAA on crystal-prism-core');
    assert.equal(cv1.width, Math.round(200 * 1.5), 'Default balanced mode must cap crystal DPR at 1.5 on 3x screen');
    bar1.dispose();

    // performance 档：antialias=false, DPR 封顶 1.0
    html2.setAttribute('data-ag-cs-perf-mode', 'performance');
    const cv2 = makeFakeElement('canvas', doc2, { w: 200, h: 28, onGetContext: (_el, k, o) => { if (k === 'webgl2') capturedGlOpts.push(o); } });
    const bar2 = crystalCore.mountCrystalPrismBar(cv2, { getState: () => ({ isDark: true, prismStrength: 1 }) });
    bar2.step(0.016);
    assert.equal(capturedGlOpts[1]?.antialias, false);
    assert.equal(cv2.width, 200, 'performance mode must cap crystal DPR at 1.0 on 3x screen');
    bar2.dispose();

    // quality 档：仅此档允许开启 MSAA，DPR 仍封顶 <= 1.5
    html2.setAttribute('data-ag-cs-perf-mode', 'quality');
    const cv3 = makeFakeElement('canvas', doc2, { w: 200, h: 28, onGetContext: (_el, k, o) => { if (k === 'webgl2') capturedGlOpts.push(o); } });
    const bar3 = crystalCore.mountCrystalPrismBar(cv3, { getState: () => ({ isDark: true, prismStrength: 1 }) });
    bar3.step(0.016);
    assert.equal(capturedGlOpts[2]?.antialias, true, 'quality mode may enable MSAA');
    assert.equal(cv3.width, Math.round(200 * 1.5), 'crystal DPR remains capped <= 1.5');
    bar3.dispose();
  } finally {
    if (prevDoc2 === undefined) delete globalThis.document; else globalThis.document = prevDoc2;
    if (prevWin2 === undefined) delete globalThis.window; else globalThis.window = prevWin2;
  }
});

// ── 6: profile-live-perf.mjs CLI --help 冒烟 + 打包/同步/清理覆盖验证 ──
test('Performance Fitness 6: profile-live-perf CLI --help smoke, expression safety, and packaging/sync/teardown coverage of src/runtime/ripple-worker.js', async () => {
  // 6a) CLI --help 冒烟
  const helpOut = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'profile-live-perf.mjs'), '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.ok(helpOut.includes('profile-live-perf') && helpOut.includes('--duration') && helpOut.includes('Runtime.evaluate'));

  // 6b) 只读表达式在沙盒内可干净执行且无副作用
  const profMod = await import('../scripts/profile-live-perf.mjs');
  const expr = profMod.buildPerfSampleExpression(500);
  const sample = await vm.runInNewContext(expr, {
    performance: { now: () => 1000, memory: { usedJSHeapSize: 104857600, totalJSHeapSize: 157286400, jsHeapSizeLimit: 2147483648 } },
    document: { hidden: false, documentElement: { dataset: { agCsPerfMode: 'balanced' }, getAttribute: () => 'standard' }, querySelector: () => null, querySelectorAll: () => [] },
    window: {},
    setTimeout, clearTimeout, Promise, Math, Number, String, Boolean, Array, Object, Date,
  });
  assert.equal(sample.dom.perfMode, 'balanced');
  assert.equal(sample.memory.usedJSHeapMB, 100);
  assert.ok(profMod.formatPerfReport({ ...sample, port: 9222, status: 'HEALTHY', warnings: [] }).includes('Live Performance Profile'));

  // 6c) Ch1 RUNTIME_PARTS、teardown.cjs、Windows/macOS/Linux 打包脚本与 repo-sync.cjs 全链路覆盖
  const cdp = require(path.join(ROOT, 'cdp.js'));
  assert.ok(cdp.RUNTIME_PARTS.includes('src/runtime/ripple-worker.js'), 'RUNTIME_PARTS must include src/runtime/ripple-worker.js');
  assert.ok(cdp.REMOVE_EXPRESSION.includes('__agPrismRippleWorker') && cdp.REMOVE_EXPRESSION.includes('disposeAll'), 'REMOVE_EXPRESSION must dispose and delete __agPrismRippleWorker');

  const { collectNativePluginEntries } = await import('../scripts/build-common.mjs');
  const entries = new Set(collectNativePluginEntries(path.join(ROOT, 'config.example.json')).map((e) => e.name));
  assert.ok(entries.has('native-plugin/src/runtime/ripple-worker.js'), 'Win/macOS/Linux collectNativePluginEntries must auto-include src/runtime/ripple-worker.js');

  const { copyUpdatedRuntimeFromRepo } = require(path.join(ROOT, 'src', 'platform', 'repo-sync.cjs'));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-sync-rw-'));
  try {
    copyUpdatedRuntimeFromRepo(ROOT, tmpDir);
    assert.equal(fs.existsSync(path.join(tmpDir, 'src', 'runtime', 'ripple-worker.js')), true, 'repo-sync.cjs must auto-sync src/runtime/ripple-worker.js');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
