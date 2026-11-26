import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PP_DIR = path.join(ROOT_DIR, 'vendor', 'periodic-picker');
const GRAIN_FILE = path.join(PP_DIR, 'pbr-grain-assets.js');
const KB3D_FILE = path.join(PP_DIR, 'keyboard-3d-gl.js');
const OLED_FILE = path.join(PP_DIR, 'oled-cyber-screen.js');
const PICKER_FILE = path.join(PP_DIR, 'periodic-picker.js');

const require = createRequire(import.meta.url);
const cdp = require(path.join(ROOT_DIR, 'cdp.js'));

function createMock2DCtx(counters) {
  const noop = () => {};
  const grad = () => ({ addColorStop: noop });
  return {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    font: '12px sans-serif', textAlign: 'left', textBaseline: 'alphabetic',
    globalAlpha: 1, globalCompositeOperation: 'source-over', shadowBlur: 0, shadowColor: '',
    shadowOffsetX: 0, shadowOffsetY: 0, filter: 'none', imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop, clip: noop,
    clearRect: noop, fillRect: noop, strokeRect: noop, setLineDash: noop, fillText: noop, strokeText: noop,
    measureText(s) {
      if (counters) counters.measureText += 1;
      const m = /(\d+(?:\.\d+)?)px/.exec(this.font || '');
      return { width: String(s || '').length * (m ? Number(m[1]) : 16) * 0.58 };
    },
    createLinearGradient: grad, createRadialGradient: grad,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
    rect: noop, roundRect: noop, ellipse: noop, arc: noop, arcTo: noop, fill: noop, stroke: noop, drawImage: noop,
  };
}

function createMockWebGL2() {
  let nextId = 1;
  const noop = () => {};
  const makeObj = () => ({ id: nextId++ });
  const anisoValues = [];
  const uniformValues = new Map();
  const rgb8Uploads = [];
  const anisoExt = { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff, TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe };
  return {
    VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, UNIFORM_BUFFER: 0x8a11,
    STATIC_DRAW: 0x88e4, DYNAMIC_DRAW: 0x88e8, FLOAT: 0x1406, UNSIGNED_SHORT: 0x1403, UNSIGNED_INT: 0x1405,
    TEXTURE_2D: 0x0de1, TEXTURE0: 0x84c0, RGBA: 0x1908, RGB: 0x1907, RGB8: 0x8051, RG: 0x8227, RG8: 0x822b,
    DEPTH_COMPONENT: 0x1902, DEPTH_COMPONENT24: 0x81a6, DEPTH_COMPONENT16: 0x81a5, UNSIGNED_BYTE: 0x1401,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601, NEAREST: 0x2600, LINEAR_MIPMAP_LINEAR: 0x2703, CLAMP_TO_EDGE: 0x812f, REPEAT: 0x2901,
    UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_ALIGNMENT: 0x0cf5, DEPTH_TEST: 0x0b71, LEQUAL: 0x0203,
    CULL_FACE: 0x0b44, BACK: 0x0405, BLEND: 0x0be2, SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303,
    ONE: 1, NONE: 0, COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x0100, POLYGON_OFFSET_FILL: 0x8037,
    FRAMEBUFFER: 0x8d40, DEPTH_ATTACHMENT: 0x8d00, FRAMEBUFFER_COMPLETE: 0x8cd5, TRIANGLES: 0x0004,
    createShader: makeObj, shaderSource: noop, compileShader: noop, deleteShader: noop,
    createProgram: makeObj, attachShader: noop, linkProgram: noop, deleteProgram: noop,
    getProgramParameter: () => true, getShaderParameter: () => true, useProgram: noop,
    getUniformLocation: (_p, name) => ({ name }), getUniformBlockIndex: () => 0, uniformBlockBinding: noop,
    bindBufferBase: noop, createBuffer: makeObj, bindBuffer: noop, bufferData: noop, bufferSubData: noop,
    deleteBuffer: noop, createVertexArray: makeObj, bindVertexArray: noop, deleteVertexArray: noop,
    enableVertexAttribArray: noop, vertexAttribPointer: noop, vertexAttribDivisor: noop,
    createTexture: makeObj, bindTexture: noop, activeTexture: noop, deleteTexture: noop,
    pixelStorei: noop, generateMipmap: noop, texParameteri: noop, texSubImage2D: noop,
    texParameterf(_t, p, v) { if (p === anisoExt.TEXTURE_MAX_ANISOTROPY_EXT) anisoValues.push(v); },
    texImage2D(_t, _l, fmt, w, h, _b, _f, _ty, d) {
      if (fmt === 0x8051) rgb8Uploads.push({ width: w, height: h, byteLength: d ? d.byteLength : 0 });
    },
    createFramebuffer: makeObj, bindFramebuffer: noop, framebufferTexture2D: noop, drawBuffers: noop,
    readBuffer: noop, checkFramebufferStatus: () => 0x8cd5, deleteFramebuffer: noop,
    getExtension: (n) => (n === 'EXT_texture_filter_anisotropic' ? anisoExt : (n === 'WEBGL_lose_context' ? { loseContext: noop } : null)),
    getParameter: (p) => (p === anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT ? 16 : 0),
    uniform1i: noop, uniform1f: noop, uniform3f: noop, uniform3fv: noop, uniform4f: noop, uniformMatrix4fv: noop,
    uniform4fv(loc, val) { if (loc && loc.name) uniformValues.set(loc.name, Array.from(val)); },
    enable: noop, disable: noop, depthFunc: noop, depthMask: noop, cullFace: noop, blendFuncSeparate: noop,
    polygonOffset: noop, viewport: noop, clearColor: noop, clear: noop, drawElements: noop, drawElementsInstanced: noop,
    isContextLost: () => false,
    _inspect: () => ({ anisoValues, uniformValues, rgb8Uploads }),
  };
}

function createPerfSandbox({ withPath2D = false } = {}) {
  let nowMs = 100, nextRafId = 1, path2dConstructs = 0, rectCalls = 0;
  const rafQueue = new Map();
  const contextCalls = [];
  const measureCounters = { measureText: 0 };
  const attrs = new Map();
  const docEl = { getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null), setAttribute: (k, v) => attrs.set(k, String(v)) };
  const doc = {
    hidden: false, visibilityState: 'visible', documentElement: docEl,
    addEventListener() {}, removeEventListener() {},
    createElement(tag) {
      if (String(tag).toLowerCase() !== 'canvas') return {};
      const ctx2d = createMock2DCtx(measureCounters);
      return { width: 0, height: 0, getContext: (t) => (t === '2d' ? ctx2d : null) };
    },
  };
  const win = {
    document: doc, devicePixelRatio: 1.5, performance: { now: () => nowMs },
    requestAnimationFrame(cb) { const id = nextRafId++; rafQueue.set(id, cb); return id; },
    cancelAnimationFrame(id) { rafQueue.delete(id); },
    matchMedia: () => ({ matches: false }),
    atob: (b64) => Buffer.from(String(b64), 'base64').toString('binary'),
  };
  const sandbox = {
    window: win, document: doc, globalThis: win, console, Math, Number, String, Boolean, Array, Object,
    Map, Set, WeakMap, Uint8Array, Float32Array, Float64Array, Uint16Array, Date, RegExp, JSON, atob: win.atob,
  };
  if (withPath2D) {
    sandbox.Path2D = class MockPath2D { constructor(d) { this.d = d; path2dConstructs += 1; } };
    win.Path2D = sandbox.Path2D;
  }
  const ctx = vm.createContext(sandbox);
  return {
    win, doc, measureCounters,
    loadFile: (fp) => vm.runInContext(fs.readFileSync(fp, 'utf8'), ctx, { filename: fp }),
    makeCanvas(w = 960, h = 552) {
      const gl = createMockWebGL2();
      return {
        width: w, height: h, _gl: gl, addEventListener() {}, removeEventListener() {},
        getBoundingClientRect() { rectCalls += 1; return { left: 0, top: 0, width: w, height: h, right: w, bottom: h }; },
        getContext(type, opts) {
          contextCalls.push({ type, opts });
          return type === 'webgl2' ? gl : (type === '2d' ? createMock2DCtx(measureCounters) : null);
        },
      };
    },
    flushRafAt(targetMs) {
      nowMs = targetMs;
      const batch = Array.from(rafQueue.entries());
      rafQueue.clear();
      for (const [, cb] of batch) cb(nowMs);
    },
    getRafSize: () => rafQueue.size,
    getPath2DCount: () => path2dConstructs,
    getRectCalls: () => rectCalls,
    getContextCalls: () => contextCalls,
  };
}

test('W5-Perf #7: pbr-grain-assets 64x32 METAL_ENV downsample, atob/Buffer parity & Ch8 budget slimming', () => {
  const grainBytes = fs.statSync(GRAIN_FILE).size;
  assert.ok(grainBytes < 285000, `pbr-grain-assets.js should shrink >20KB from 304,988B, got ${grainBytes}B`);

  const nodeApi = require(GRAIN_FILE);
  assert.equal(nodeApi.ENV_W, 64);
  assert.equal(nodeApi.ENV_H, 32);
  assert.equal(nodeApi.METAL_ENV_WIDTH, 64);
  assert.equal(nodeApi.METAL_ENV_HEIGHT, 32);
  const nodeTex = nodeApi.getGrainTextures();
  assert.equal(nodeTex.envW, 64);
  assert.equal(nodeTex.envH, 32);
  assert.equal(nodeTex.metalEnvRGB.length, 64 * 32 * 3);
  assert.ok(nodeTex.metalEnvRGB.some((v) => v > 0), 'metalEnvRGB must be non-zero');
  assert.equal(nodeTex.combinedRG.length, 128 * 128 * 2);

  // 校验浏览器 atob 解码路径与 Node Buffer 解码字节 100% 一致
  const env = createPerfSandbox();
  env.loadFile(GRAIN_FILE);
  const browserTex = env.win.__agPrismGrainAssets.getGrainTextures();
  assert.equal(browserTex.metalEnvRGB.length, 6144);
  assert.deepEqual(Array.from(browserTex.metalEnvRGB), Array.from(nodeTex.metalEnvRGB));

  // 校验 Channel 8 编译产物预算净瘦身
  const rep = cdp.getChannelBudgetReport({ ...cdp.DEFAULT_CONFIG, periodicModelPicker: 'on' }, { noDiskCache: true });
  const ch8 = rep.channels.find((c) => c.id === 'periodicPicker');
  assert.ok(ch8 && ch8.bytes < 830000 && ch8.bytes <= ch8.budgetBytes, `Ch8 should stay well under budget (got ${ch8?.bytes})`);
});

test('W5-Perf #1: native 300Hz caps transient @120fps, drops steady zeroG to @60fps, 2.5px debounce & 0.85s hover linger', () => {
  const { ELEMENTS_90 } = require(PICKER_FILE);
  const env = createPerfSandbox();
  env.loadFile(GRAIN_FILE);
  env.loadFile(KB3D_FILE);
  const avail = new Map([[1, { slotZ: 1 }], [6, { slotZ: 6 }], [10, { slotZ: 10 }], [18, { slotZ: 18 }]]);
  const r = env.win.__agPrismKeyboard3D.createKeyboard3DRenderer({
    canvas: env.makeCanvas(960, 552), doc: env.doc, root: env.win, slots: ELEMENTS_90, targetFps: 'native',
  });

  // 1) 切键瞬态动画在 300Hz (3.33ms) 节拍下封顶 120fps (7.6ms)
  r.setState({ availableByZ: avail, selectedZ: 6 });
  r.setState({ selectedZ: 10 });
  assert.equal(r.isIdle(), false, 'selecting new key must wake spring transient');
  env.flushRafAt(200);
  const d0 = r.getPerfStats().frameDraws;
  env.flushRafAt(203.33);
  env.flushRafAt(206.66);
  assert.equal(r.getPerfStats().frameDraws, d0, 'native transient must skip sub-7.6ms 300Hz ticks (120fps cap)');
  env.flushRafAt(208.2);
  assert.equal(r.getPerfStats().frameDraws, d0 + 1, 'native transient must draw once >= 7.6ms elapsed');

  // 2) 物理弹簧收敛后仅余 zeroGRemainSec 悬浮余韵时，native 自动降频至 60fps (15.5ms)
  for (let i = 0; i < 65; i += 1) r.step(0.016); // ~1.04s: 键帽/磁浮弹簧已收敛，zeroGRemainSec 仍余 ~1.4s
  assert.equal(r.isIdle(), false, 'zeroGRemainSec should still linger after ~1s');
  env.flushRafAt(500);
  const dSteady = r.getPerfStats().frameDraws;
  env.flushRafAt(510); // 10ms > 7.6ms 且 < 15.5ms，60fps 稳态门限应跳过
  assert.equal(r.getPerfStats().frameDraws, dSteady, 'steady zeroG-only native mode must throttle to 60fps (skip 10ms tick)');
  env.flushRafAt(516.5);
  assert.equal(r.getPerfStats().frameDraws, dSteady + 1, 'steady zeroG-only native mode must draw after >= 15.5ms');

  // 3) 显式 targetFps='180' 仍放开高刷 (5.3ms >= 4.9ms)
  r.setState({ targetFps: '180', selectedZ: 18 });
  env.flushRafAt(600);
  const d180 = r.getPerfStats().frameDraws;
  env.flushRafAt(605.3);
  assert.equal(r.getPerfStats().frameDraws, d180 + 1, 'explicit 180fps must allow >= 4.9ms frame interval');
  r.setState({ targetFps: 'native' });

  // 4) 扫键悬停余韵从 1.65s 收紧至 0.85s，停手迅速进入 0fps 休眠
  for (let i = 0; i < 200 && !r.isIdle(); i += 1) r.step(0.016);
  assert.equal(r.isIdle(), true);
  r.setState({ hoveredZ: 6 });
  let hoverSteps = 0;
  for (; hoverSteps < 75 && !r.isIdle(); hoverSteps += 1) r.step(0.016);
  assert.equal(r.isIdle(), true, `hover linger must converge to 0fps well under 1.2s (took ${hoverSteps} steps)`);
  assert.ok(hoverSteps <= 62, `0.85s hover linger should settle in <=62 frames, took ${hoverSteps}`);

  // 5) setPointerClient 亚像素抖动 (<=2.5px) 不得无限续期 zeroGRemainSec
  const k18 = r.getInteractiveProjectedRects().keys.find((k) => k.slotZ === 18);
  assert.ok(k18);
  r.setPointerClient(k18.cx + 18, k18.cy + 12, true);
  assert.equal(r.isIdle(), false);
  let jitterSettled = false;
  for (let j = 0; j < 190; j += 1) {
    const off = (j % 2) * 0.9; // 位移 ~1.27px <= 2.5px
    r.setPointerClient(k18.cx + 18 + off, k18.cy + 12 + off, true);
    r.step(0.016);
    if (r.isIdle()) { jitterSettled = true; break; }
  }
  assert.equal(jitterSettled, true, 'sub-2.5px pointer micro-jitter must not infinitely renew zeroGRemainSec');
  r.setPointerClient(k18.cx + 35, k18.cy + 12, true);
  assert.equal(r.isIdle(), false, 'pointer move > 2.5px must wake near-field tracking');
  r.dispose();
});

test('W5-Perf #6: zero-GC _spOut springs, 3x FNV-1a numeric signatures & Path2D legend cache', () => {
  const kbSrc = fs.readFileSync(KB3D_FILE, 'utf8');
  assert.ok(kbSrc.includes('var _spOut = new Float64Array(3);'), 'must preallocate module-level _spOut Float64Array(3)');
  const spFnSlice = kbSrc.slice(kbSrc.indexOf('function stepExactSecondOrderSpring('), kbSrc.indexOf('function stepExactSecondOrderSpring(') + 1200);
  assert.ok(spFnSlice.includes('return _spOut;') && !spFnSlice.includes('return [nextCur'));

  const sigSlice = kbSrc.slice(kbSrc.indexOf('function computeShadowGeomSignature('), kbSrc.indexOf('function renderWebGL2Frame('));
  assert.ok(sigSlice.includes('2166136261') && sigSlice.includes('fnvMixInt'), 'signatures must use 32-bit FNV-1a');
  assert.equal(sigSlice.includes(".join('|')"), false, 'signatures must eliminate per-frame array/string .join("|")');

  const { ELEMENTS_90 } = require(PICKER_FILE);
  const env = createPerfSandbox({ withPath2D: true });
  env.loadFile(GRAIN_FILE);
  env.loadFile(KB3D_FILE);
  const r1 = env.win.__agPrismKeyboard3D.createKeyboard3DRenderer({
    canvas: env.makeCanvas(960, 552), doc: env.doc, root: env.win, slots: ELEMENTS_90,
  });
  const countAfterFirst = env.getPath2DCount();
  assert.ok(countAfterFirst > 0, 'first legend atlas build compiles novelty Path2Ds');
  r1.dispose();
  env.win.__agPrismKeyboard3D.evictLegendAtlasCache(env.doc);
  const r2 = env.win.__agPrismKeyboard3D.createKeyboard3DRenderer({
    canvas: env.makeCanvas(960, 552), doc: env.doc, root: env.win, slots: ELEMENTS_90,
  });
  assert.equal(env.getPath2DCount(), countAfterFirst, 'second legend atlas build must hit Path2D cache (0 new Path2D)');
  r2.dispose();
});

test('W5-Perf #2/#4/#5: static widgetsGpu (0 rebuilds), 66ms drag shadow throttle, maxAniso<=4, ultrawide DPR 1.35 & preserveDrawingBuffer:false', () => {
  const { ELEMENTS_90 } = require(PICKER_FILE);
  const env = createPerfSandbox();
  env.loadFile(GRAIN_FILE);
  env.loadFile(KB3D_FILE);
  const canvas = env.makeCanvas(960, 552);
  const avail = new Map([[1, { slotZ: 1 }], [6, { slotZ: 6 }], [10, { slotZ: 10 }], [18, { slotZ: 18 }]]);
  const r = env.win.__agPrismKeyboard3D.createKeyboard3DRenderer({
    canvas, doc: env.doc, root: env.win, slots: ELEMENTS_90,
  });

  const glCall = env.getContextCalls().find((c) => c.type === 'webgl2');
  assert.ok(glCall && glCall.opts && glCall.opts.preserveDrawingBuffer === false, 'preserveDrawingBuffer must stay false');
  const glInfo = canvas._gl._inspect();
  assert.ok(glInfo.anisoValues.length > 0 && glInfo.anisoValues.every((v) => v <= 4), `maxAniso must cap <=4, got ${glInfo.anisoValues}`);
  assert.ok(glInfo.rgb8Uploads.some((u) => u.width === 64 && u.height === 32 && u.byteLength === 6144), 'metalEnvTex must upload 64x32 RGB8');

  r.setState({ availableByZ: avail, selectedZ: 10 });
  for (let i = 0; i < 160 && !r.isIdle(); i += 1) r.step(0.016);

  // 静态 widgetsGpu：旋钮转动 + 按钮 hover/press 不触发 CPU 网格重建，仅更新 u_hwDyn0/1/2
  const rebuildsBefore = r.getPerfStats().dynMeshRebuilds;
  const knobAngleBefore = (glInfo.uniformValues.get('u_hwDyn0') || [])[3];
  r.rotateKnobStep(2);
  r.setHardwareState({ hoveredControl: 'prism-wave', pressedControl: 'close' });
  r.triggerControlPress('reset-view');
  for (let i = 0; i < 20; i += 1) r.step(0.016);
  assert.equal(r.getPerfStats().dynMeshRebuilds, rebuildsBefore, 'widgetsGpu must NOT rebuild on knobAngle / hover / press');
  assert.notEqual((glInfo.uniformValues.get('u_hwDyn0') || [])[3], knobAngleBefore, 'u_hwDyn0.w must transmit live knobAngle');
  assert.ok((glInfo.uniformValues.get('u_hwDyn2') || [])[0] < -0.01, 'u_hwDyn2.x must transmit close button press displacement');

  // ShadowMap 拖拽期 66ms 节流 (15Hz) + 松手停稳补高精度阴影
  for (let i = 0; i < 160 && !r.isIdle(); i += 1) r.step(0.016);
  r.dragChassisOrbitDelta(0.08, 0.12);
  r.step(0.016);
  const shAfterFirstDrag = r.getPerfStats().shadowDraws;
  const skipsBeforeDrag = r.getPerfStats().shadowSkips;
  for (let i = 0; i < 3; i += 1) { r.dragChassisOrbitDelta(0.03, 0.04); r.step(0.016); }
  assert.equal(r.getPerfStats().shadowDraws, shAfterFirstDrag, 'orbit drag within 66ms must throttle ShadowMap draws');
  assert.ok(r.getPerfStats().shadowSkips >= skipsBeforeDrag + 3, 'orbit drag sub-66ms ticks must increment shadowSkips');
  r.dragChassisOrbitDelta(0.04, 0.05);
  r.step(0.025);
  assert.equal(r.getPerfStats().shadowDraws, shAfterFirstDrag + 1, 'orbit drag crossing 66ms must draw throttled shadow');
  r.endChassisOrbitDrag(0, 0);
  const shBeforeSettle = r.getPerfStats().shadowDraws;
  for (let i = 0; i < 160 && !r.isIdle(); i += 1) r.step(0.016);
  assert.equal(r.isIdle(), true);
  assert.ok(r.getPerfStats().shadowDraws >= shBeforeSettle);

  // 超宽视口 (cssWidth*dpr > 1800) 静态 DPR 封顶 1.35，常规视口保持 1.5
  r.resize(960, 552, 2.0);
  assert.equal(r.getPerfStats().dpr, 1.5);
  r.resize(1600, 900, 2.0);
  assert.equal(r.getPerfStats().dpr, 1.35, 'ultrawide (cssWidth*dpr > 1800) must clamp dpr to 1.35');

  const kbSrc = fs.readFileSync(KB3D_FILE, 'utf8');
  assert.ok(kbSrc.includes('baseN.y>.45'), 'SOLID_FS must restrict grain normal gradient to top faces');
  const vogelSlice = kbSrc.slice(kbSrc.indexOf('float sampleVogelShadow('), kbSrc.indexOf('float sampleVogelShadow(') + 1600);
  assert.ok(vogelSlice.includes('rot8[8]') && vogelSlice.includes('vogel4[4]') && vogelSlice.includes('vogel6[6]') && !vogelSlice.includes('cos(ign)'));
  r.dispose();
});

test('W5-Perf #3: setHardwareState({ deferRender: true }), resize zero-reflow & getInteractiveProjectedRects({ includeKeys: false })', () => {
  const { ELEMENTS_90 } = require(PICKER_FILE);
  const env = createPerfSandbox();
  env.loadFile(GRAIN_FILE);
  env.loadFile(KB3D_FILE);
  const r = env.win.__agPrismKeyboard3D.createKeyboard3DRenderer({
    canvas: env.makeCanvas(960, 552), doc: env.doc, root: env.win, slots: ELEMENTS_90,
  });

  const drawsBeforeHw = r.getPerfStats().frameDraws;
  r.setHardwareState({ hoveredControl: 'mute' }, { deferRender: true });
  assert.equal(r.getPerfStats().frameDraws, drawsBeforeHw, 'setHardwareState({ deferRender: true }) must not render synchronously');
  assert.ok(env.getRafSize() >= 1);
  env.flushRafAt(300);
  assert.ok(r.getPerfStats().frameDraws > drawsBeforeHw);

  const rectsBefore = env.getRectCalls();
  const drawsBeforeResize = r.getPerfStats().frameDraws;
  r.resize(1100, 580, 1.5, null, { deferRender: true });
  assert.equal(env.getRectCalls(), rectsBefore, 'resize() must reuse cachedCanvasRect without getBoundingClientRect()');
  assert.equal(r.getPerfStats().frameDraws, drawsBeforeResize, 'resize(..., { deferRender: true }) must coalesce into rAF');
  env.flushRafAt(330);
  assert.ok(r.getPerfStats().frameDraws > drawsBeforeResize);

  const liteRects = r.getInteractiveProjectedRects({ includeKeys: false });
  assert.equal(liteRects.keys.length, 0);
  assert.equal(liteRects.availableKeys.length, 0);
  assert.equal(liteRects.auxKeys.length, 0);
  assert.equal(liteRects.controlList.length, 4);
  assert.ok(liteRects.chassis.width > 10 && liteRects.deck.width > 10);
  assert.equal(r.getInteractiveProjectedRects().keys.length, ELEMENTS_90.length);
  r.dispose();
});

test('W5-Perf #6-OLED: oled-cyber-screen.js 16-entry text measurement LRU cache cuts repeat measureText calls', () => {
  const env = createPerfSandbox();
  env.loadFile(GRAIN_FILE);
  env.loadFile(OLED_FILE);
  const painter = env.win.__agPrismOledScreen.createOledScreenPainter({
    width: 800, height: 240, doc: env.doc, root: env.win, lazyWallpapers: true,
  });
  const makeDeck = (z, sym, title) => ({
    z, numLabel: String(z), symbol: sym, title, subtitle: 'Flagship reasoning core',
    chemLabel: `${z} ${sym} · Element`, isAvailable: true, effortTitle: 'Thinking',
    levels: [{ effort: 'low', label: 'Low', active: false }, { effort: 'medium', label: 'Medium', active: true }, { effort: 'high', label: 'High', active: false }],
  });
  const theme = { id: 'obsidian-dark', isLight: false, isMono: false, ambientMul: 0.7, primaryHex: '#669DF6' };

  env.measureCounters.measureText = 0;
  painter.render({ deckInfo: makeDeck(6, 'C', 'Gemini 4 Carbon Pro'), themeProfile: theme, nowMs: 100 });
  painter.render({ deckInfo: makeDeck(10, 'Ne', 'Gemini 4 Neon Ultra'), themeProfile: theme, nowMs: 400 });
  const coldMeasures = env.measureCounters.measureText;
  assert.ok(coldMeasures >= 8, `expected cold pass to measure text, got ${coldMeasures}`);

  env.measureCounters.measureText = 0;
  painter.render({ deckInfo: makeDeck(6, 'C', 'Gemini 4 Carbon Pro'), themeProfile: theme, nowMs: 700 });
  painter.render({ deckInfo: makeDeck(10, 'Ne', 'Gemini 4 Neon Ultra'), themeProfile: theme, nowMs: 1000 });
  const warmMeasures = env.measureCounters.measureText;
  assert.ok(warmMeasures < coldMeasures * 0.6, `text LRU cache must cut repeat measureText calls (cold=${coldMeasures}, warm=${warmMeasures})`);
  painter.dispose();
});
