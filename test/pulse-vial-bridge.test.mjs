import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const BRIDGE_PATH = path.join(ROOT_DIR, 'pulse-vial-bridge.js');

const bridgeMod = require(BRIDGE_PATH);
const vialCore = require(path.join(ROOT_DIR, 'vial-core.js'));

function createPulseMockEnv({ cascadeId = '6546d8a7-52c2-42df-82c0-85aa82cedf9c' } = {}) {
  const winListeners = new Map();
  const docListeners = new Map();
  const storageData = new Map();
  const rafQueue = new Map();
  let nextRafId = 1;

  function createStyleObj(owner) {
    const props = new Map();
    const syncAttr = () => {
      const css = [...props.entries()].map(([k, v]) => `${k}:${v}`).join(';');
      if (css) owner._attrs.set('style', css);
      else owner._attrs.delete('style');
    };
    return new Proxy(
      {
        setProperty(k, v) {
          props.set(k, String(v));
          syncAttr();
        },
        getPropertyValue(k) {
          return props.get(k) || '';
        },
        removeProperty(k) {
          props.delete(k);
          syncAttr();
        },
      },
      {
        get(target, prop) {
          if (prop in target) return target[prop];
          if (typeof prop === 'string') return props.get(prop) || '';
          return undefined;
        },
        set(target, prop, value) {
          if (typeof prop === 'string') {
            if (value === '' || value == null) props.delete(prop);
            else props.set(prop, String(value));
            syncAttr();
          }
          return true;
        },
      }
    );
  }

  function matchSingleToken(el, token) {
    if (!token || !el._attrs) return false;
    let rest = token.trim();
    if (!rest) return false;
    if (rest.includes('>') || rest.includes(' ')) return false;

    const tagMatch = rest.match(/^[a-zA-Z0-9-]+/);
    if (tagMatch) {
      if (el.tagName !== tagMatch[0].toUpperCase()) return false;
      rest = rest.slice(tagMatch[0].length);
    }

    const idMatches = [...rest.matchAll(/#([a-zA-Z0-9_-]+)/g)];
    for (const m of idMatches) {
      if (el.getAttribute('id') !== m[1]) return false;
    }

    const clsMatches = [...rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)];
    if (clsMatches.length) {
      const list = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
      for (const m of clsMatches) {
        if (!list.includes(m[1])) return false;
      }
    }

    const attrMatches = [...rest.matchAll(/\[([a-zA-Z0-9_-]+)(?:=["']?([^"'\]\s]+)["']?)?\]/g)];
    for (const m of attrMatches) {
      if (!el.hasAttribute(m[1])) return false;
      if (m[2] !== undefined && el.getAttribute(m[1]) !== m[2]) return false;
    }

    return true;
  }

  function matchesSelector(el, selector) {
    return String(selector)
      .split(',')
      .some((part) => matchSingleToken(el, part.trim()));
  }

  function walkTree(rootNode, cb) {
    for (const child of rootNode.children || []) {
      cb(child);
      walkTree(child, cb);
    }
  }

  function createNode(tagName, attrs = {}) {
    const _attrs = new Map();
    const listeners = new Map();
    const el = {
      tagName: String(tagName).toUpperCase(),
      _attrs,
      children: [],
      parentNode: null,
      parentElement: null,
      shadowRoot: null,
      isConnected: true,
      textContent: '',
      hidden: false,
      get id() {
        return _attrs.get('id') || '';
      },
      set id(v) {
        _attrs.set('id', String(v));
      },
      get className() {
        return _attrs.get('class') || '';
      },
      set className(v) {
        _attrs.set('class', String(v));
      },
      get firstChild() {
        return el.children[0] || null;
      },
      get nextSibling() {
        if (!el.parentNode) return null;
        const idx = el.parentNode.children.indexOf(el);
        return idx >= 0 && idx + 1 < el.parentNode.children.length ? el.parentNode.children[idx + 1] : null;
      },
      dataset: new Proxy(
        {},
        {
          get(_, prop) {
            const k = 'data-' + String(prop).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
            return _attrs.get(k);
          },
          set(_, prop, val) {
            const k = 'data-' + String(prop).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
            _attrs.set(k, String(val));
            return true;
          },
        }
      ),
      setAttribute(k, v) {
        if (k === 'hidden') el.hidden = true;
        _attrs.set(k, String(v));
      },
      getAttribute(k) {
        return _attrs.has(k) ? _attrs.get(k) : null;
      },
      hasAttribute(k) {
        return _attrs.has(k);
      },
      removeAttribute(k) {
        if (k === 'hidden') el.hidden = false;
        _attrs.delete(k);
      },
      appendChild(child) {
        if (child.parentNode) child.remove();
        child.parentNode = el;
        child.parentElement = el.tagName === '#SHADOW-ROOT' ? null : el;
        child.isConnected = el.isConnected;
        el.children.push(child);
        return child;
      },
      insertBefore(child, ref) {
        if (!ref) return el.appendChild(child);
        const idx = el.children.indexOf(ref);
        if (idx < 0) return el.appendChild(child);
        if (child.parentNode) child.remove();
        child.parentNode = el;
        child.parentElement = el.tagName === '#SHADOW-ROOT' ? null : el;
        child.isConnected = el.isConnected;
        el.children.splice(idx, 0, child);
        return child;
      },
      removeChild(child) {
        const idx = el.children.indexOf(child);
        if (idx >= 0) {
          el.children.splice(idx, 1);
          child.parentNode = null;
          child.parentElement = null;
          child.isConnected = false;
        }
        return child;
      },
      remove() {
        if (el.parentNode) el.parentNode.removeChild(el);
      },
      attachShadow({ mode }) {
        const sr = createNode('#shadow-root');
        sr.mode = mode;
        sr.host = el;
        sr.isConnected = el.isConnected;
        el.shadowRoot = sr;
        return sr;
      },
      getElementById(targetId) {
        let hit = null;
        walkTree(el, (n) => {
          if (!hit && n.getAttribute('id') === targetId) hit = n;
        });
        return hit;
      },
      querySelector(sel) {
        return el.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const res = [];
        walkTree(el, (n) => {
          if (matchesSelector(n, sel)) res.push(n);
        });
        return res;
      },
      matches(sel) {
        return matchesSelector(el, sel);
      },
      closest(sel) {
        let cur = el;
        while (cur) {
          if (cur.matches && cur.matches(sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        listeners.get(type)?.delete(fn);
      },
      dispatchEvent(evt) {
        const e = {
          target: el,
          preventDefault() {},
          stopPropagation() {},
          ...evt,
        };
        for (const fn of [...(listeners.get(e.type) || [])]) fn(e);
      },
      getContext(kind) {
        if (kind !== '2d') return null;
        return {
          save() {},
          restore() {},
          setTransform() {},
          clearRect() {},
          beginPath() {},
          moveTo() {},
          lineTo() {},
          arcTo() {},
          closePath() {},
          fill() {},
          stroke() {},
          translate() {},
          rotate() {},
          ellipse() {},
          fillRect() {},
          fillText() {},
          drawImage() {},
          createLinearGradient() {
            return { addColorStop() {} };
          },
        };
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: Number(_attrs.get('width')) || 96, height: Number(_attrs.get('height')) || 220 };
      },
    };
    el.style = createStyleObj(el);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') el.textContent = String(v);
      else el.setAttribute(k, v);
    }
    return el;
  }

  const docRoot = createNode('html');
  const body = createNode('body', { class: 'theme-dark' });
  docRoot.appendChild(body);

  const cascadeWrap = createNode('div', cascadeId ? { 'data-cascade-id': cascadeId } : {});
  body.appendChild(cascadeWrap);

  function buildPulseStatusBar() {
    const barHost = createNode('div', { id: 'ag-pulse-status-bar' });
    const sr = barHost.attachShadow({ mode: 'open' });

    const bar = createNode('div', { class: 'bar' });
    const speedChip = createNode('button', { class: 'chip', 'data-card': 'speed' });
    speedChip.appendChild(createNode('svg'));
    speedChip.appendChild(createNode('span', { class: 'rounds dim', id: 'rounds', text: '3r' }));
    speedChip.appendChild(createNode('strong', { id: 'tps', text: '42.0' }));
    speedChip.appendChild(createNode('span', { text: 'tok/s' }));
    const cacheChip = createNode('button', { class: 'chip', 'data-card': 'cache' });
    cacheChip.appendChild(createNode('svg'));
    cacheChip.appendChild(createNode('span', { class: 'cache-total', id: 'cache-total', text: '181.3M tok' }));
    cacheChip.appendChild(createNode('span', { class: 'dim', text: '·' }));
    cacheChip.appendChild(createNode('span', { 'data-i18n': 'cache', text: '缓存命中' }));
    cacheChip.appendChild(createNode('strong', { id: 'cache-rate', text: '86.9%' }));
    const ctxChip = createNode('button', { class: 'chip', 'data-card': 'context' });
    ctxChip.appendChild(createNode('span', { class: 'context-ring', id: 'context-ring' }));
    ctxChip.appendChild(createNode('span', { class: 'context-label', 'data-i18n': 'contextShort', text: 'Ctx' }));
    ctxChip.appendChild(createNode('strong', { id: 'context-percent', text: '46%' }));
    bar.appendChild(speedChip);
    bar.appendChild(cacheChip);
    bar.appendChild(ctxChip);
    sr.appendChild(bar);

    const speedCard = createNode('section', { class: 'card', id: 'speed-card', hidden: '' });
    speedCard.appendChild(createNode('dd', { id: 'ttft', text: '0.92s' }));
    speedCard.appendChild(createNode('dd', { id: 'latest-rate', text: '55.2 tok/s' }));
    sr.appendChild(speedCard);

    const ctxCard = createNode('section', { class: 'card context-card', id: 'context-card' });
    ctxCard.hidden = false;
    ctxCard.style.left = '980px';
    const heading = createNode('div', { class: 'heading' });
    const titleSpan = createNode('span', { text: 'Context window' });
    heading.appendChild(titleSpan);
    ctxCard.appendChild(heading);
    ctxCard.appendChild(createNode('strong', { id: 'context-summary', text: '46% used · 54% left' }));
    ctxCard.appendChild(createNode('p', { id: 'context-tokens', text: '118K / 256K tok' }));
    const track = createNode('div', { class: 'track', id: 'context-track' });
    const fill = createNode('i', { id: 'context-fill' });
    fill.style.width = '46%';
    track.appendChild(fill);
    ctxCard.appendChild(track);
    const dl = createNode('dl');
    dl.appendChild(createNode('dd', { id: 'context-model', text: 'Gemini 4 Carbon High' }));
    ctxCard.appendChild(dl);
    ctxCard.appendChild(createNode('p', { class: 'footnote', id: 'context-note', text: 'Latest request estimate' }));
    sr.appendChild(ctxCard);

    return barHost;
  }

  let pulseHostEl = buildPulseStatusBar();
  cascadeWrap.appendChild(pulseHostEl);

  const doc = {
    hidden: false,
    documentElement: docRoot,
    body,
    createElement: (tag) => createNode(tag),
    getElementById(id) {
      return docRoot.getElementById(id);
    },
    querySelector(sel) {
      return docRoot.querySelector(sel);
    },
    querySelectorAll(sel) {
      return docRoot.querySelectorAll(sel);
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      docListeners.get(type)?.delete(fn);
    },
    dispatchDocEvent(evt) {
      for (const fn of [...(docListeners.get(evt.type) || [])]) fn(evt);
    },
  };

  const storage = {
    getItem: (k) => (storageData.has(k) ? storageData.get(k) : null),
    setItem: (k, v) => storageData.set(k, String(v)),
    removeItem: (k) => storageData.delete(k),
  };

  let schemeOverride = 'dark';
  const win = {
    document: doc,
    localStorage: storage,
    innerWidth: 1280,
    devicePixelRatio: 1,
    __agPulseRuntimeVersion: 'pulse-runtime-v083-intact',
    __agVialCore: vialCore,
    location: { pathname: `/c/${cascadeId}` },
    setScheme(s) {
      schemeOverride = s;
    },
    getComputedStyle() {
      return {
        colorScheme: schemeOverride || '',
        getPropertyValue: (p) => (p === '--pulse-scheme' ? schemeOverride : ''),
      };
    },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame(cb) {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) {
      rafQueue.delete(id);
    },
    stepRaf(nowMs) {
      const entries = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of entries) cb(nowMs);
      return entries.length;
    },
    getPendingRafCount: () => rafQueue.size,
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      winListeners.get(type)?.delete(fn);
    },
    dispatchWindowEvent(evt) {
      for (const fn of [...(winListeners.get(evt.type) || [])]) fn(evt);
    },
  };

  return {
    win,
    doc,
    storage,
    cascadeWrap,
    buildPulseStatusBar,
    getPulseHost: () => pulseHostEl,
    replacePulseHost() {
      pulseHostEl.remove();
      pulseHostEl.isConnected = false;
      pulseHostEl = buildPulseStatusBar();
      cascadeWrap.appendChild(pulseHostEl);
      return pulseHostEl;
    },
  };
}

test('pulse-vial-bridge stays strictly under 19,500 bytes budget, avoids innerHTML, and supports browser UMD + CJS', () => {
  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  const byteSize = Buffer.byteLength(src.replace(/\r\n/g, '\n'), 'utf8');
  assert.ok(byteSize < 19500, `Expected < 19500 bytes, got ${byteSize}`);
  assert.equal(src.includes('.innerHTML'), false, 'Bridge must use TrustedHTML-safe DOM creation without innerHTML');

  assert.equal(bridgeMod.STORAGE_KEY, 'agCs.pulseVialMode.v1');
  assert.equal(bridgeMod.HOST_ID, 'ag-pulse-status-bar');
  assert.equal(typeof bridgeMod.mountPulseVialBridge, 'function');

  const sandbox = { window: {} };
  sandbox.globalThis = sandbox.window;
  vm.runInNewContext(src, sandbox);
  assert.equal(typeof sandbox.window.__agCsPulseVialBridge?.mountPulseVialBridge, 'function');
});

test('peaceful coexistence: preserves #ag-pulse-status-bar, __agPulseRuntimeVersion, and all 8 original render IDs', async () => {
  const env = createPulseMockEnv();
  const originalHost = env.getPulseHost();
  const sr = originalHost.shadowRoot;

  let lastInput = null;
  env.win.agPulseHost = {
    getMetrics: async (input) => {
      lastInput = input;
      return {
        connection: 'live',
        speed: {
          tps: 58.6,
          latestTps: 64.2,
          ttftSeconds: 0.76,
          modelSeconds: 4.2,
          toolSeconds: 1.4,
          rounds: 3,
          context: {
            usedTokens: 133120,
            maxTokens: 256000,
            remainingTokens: 122880,
            usedFraction: 0.52,
            remainingFraction: 0.48,
            model: 'Claude Opus 4.6',
            sampledAt: new Date().toISOString(),
            source: 'rpc',
          },
        },
      };
    },
  };

  const prevDoc = globalThis.document;
  globalThis.document = env.doc;
  let bridge;
  try {
    bridge = bridgeMod.mountPulseVialBridge({
      win: env.win,
      doc: env.doc,
      storage: env.storage,
      vialCore,
      autoPoll: false,
      allowMultiple: true,
    });
    const st = await bridge.sync();

    assert.equal(env.getPulseHost(), originalHost, 'Host #ag-pulse-status-bar node must not be replaced');
    assert.equal(env.win.__agPulseRuntimeVersion, 'pulse-runtime-v083-intact', 'Runtime version must remain untouched');
    assert.equal(lastInput?.conversationId, '6546d8a7-52c2-42df-82c0-85aa82cedf9c', 'Must pass valid conversationId GUID');

    const requiredIds = [
      'context-percent',
      'context-ring',
      'context-summary',
      'context-tokens',
      'context-model',
      'context-note',
      'context-fill',
      'context-track',
    ];
    for (const id of requiredIds) {
      const node = sr.getElementById(id);
      assert.ok(node, `Original #${id} must never be deleted from shadowRoot`);
      node.textContent = node.textContent;
      node.style.setProperty('--test-noop', '1');
    }

    assert.equal(st.attached, true);
    assert.equal(st.mode, 'vial');
    assert.equal(st.vialMounted, true);
    assert.equal(st.camp, 'claude');
    assert.equal(st.critical, false);
    assert.equal(st.streaming, true);
    assert.ok(Math.abs(st.ratios[0] + st.ratios[1] + st.ratios[2] - 0.52) < 1e-6);

    const styleEl = sr.querySelector('style[data-ag-cs-pulse-style="1"]');
    assert.ok(styleEl && styleEl.textContent.includes('#context-track'), 'Must inject smooth CSS hiding style');
    assert.equal(styleEl.textContent.includes('Consolas'), false, 'Must replace legacy Consolas with modern UI sans + tabular-nums');
    assert.ok(styleEl.textContent.includes('rgba(255,255,255,.06)'), 'Rail must use subtle 1px divider');
    assert.ok(styleEl.textContent.includes('box-shadow:none'), 'Vial well must float cleanly without dark pit shadow in dark mode');
    assert.ok(styleEl.textContent.includes('.pv-btn::before') && styleEl.textContent.includes('.card-language'));
    assert.equal(originalHost.style.getPropertyValue('--pv-tint'), '#3186ff');
    assert.equal(st.vialDebug.fallingCount, 0);
    const segColors = [...sr.querySelectorAll('[data-layer-slice]')].map((n) => n.style.getPropertyValue('--sc'));
    assert.deepEqual(segColors, ['#1b49b2', '#3186ff', '#5cc6fc']);
    const card = sr.getElementById('context-card');
    assert.equal(card.getAttribute('data-ag-pulse-vial-mode'), 'vial');
    assert.equal(card.getAttribute('data-ag-pulse-card-width'), '408');
    assert.equal(card.style.getPropertyValue('--pv-cx'), '-120px');

    const toggleBtn = sr.querySelector('[data-ag-pulse-vial-toggle="1"]');
    assert.equal(toggleBtn?.textContent, '实体试管');
    const canvas = sr.querySelector('canvas[data-vial-canvas="true"]');
    assert.ok(canvas);

    const heading = card.querySelector('.heading');
    heading.dispatchEvent({ type: 'pointerdown', clientX: 200 });
    env.win.dispatchWindowEvent({ type: 'pointermove', clientX: 226 });
    env.win.dispatchWindowEvent({ type: 'pointerup', clientX: 226 });
    const afterDrag = bridge.getDebugState();
    assert.ok(afterDrag.vialDebug.waveEnergy > 0.5);
  } finally {
    bridge?.destroy();
    globalThis.document = prevDoc;
  }
});

test('true 0fps sleep & 0ms wake: pauses requestAnimationFrame when vial.isSettled() === true and wakes immediately on pointer/data/poll activity', async () => {
  const env = createPulseMockEnv();
  // 静态非流式快照（sampledAt 为旧时间戳，latestTps = 0 => streaming = false）
  env.win.agPulseHost = {
    getMetrics: async () => ({
      connection: 'live',
      speed: {
        tps: 44.0,
        latestTps: 0,
        ttftSeconds: 0.55,
        rounds: 2,
        context: {
          usedTokens: 128000,
          maxTokens: 512000,
          usedFraction: 0.25,
          model: 'Gemini 4 Carbon',
          sampledAt: '2020-01-01T00:00:00Z',
        },
      },
    }),
  };

  const prevDoc = globalThis.document;
  delete globalThis.document;
  let bridge;
  try {
    bridge = bridgeMod.mountPulseVialBridge({
      win: env.win,
      doc: env.doc,
      storage: env.storage,
      vialCore,
      autoPoll: true,
      pollIntervalMs: 1200,
      allowMultiple: true,
    });
    await bridge.sync();

    // 初始入场未满 1.1s，rAF 活跃运行
    assert.equal(bridge.getDebugState().rafActive, true, 'rAF must run during initial entry convergence');

    // 推进帧跨过 1.1s 静止收敛窗口（每次 +45ms，跑 35 帧 = 1.57s）
    let tNow = 1000;
    for (let i = 0; i < 40 && env.win.getPendingRafCount() > 0; i++) {
      tNow += 45;
      env.win.stepRaf(tNow);
    }

    const slept = bridge.getDebugState();
    assert.equal(slept.vialSettled, true, 'Vial must settle once calm and >=1.1s');
    assert.equal(slept.rafActive, false, 'tickR must stop scheduling rAF (0fps true sleep!)');
    assert.equal(env.win.getPendingRafCount(), 0, 'Pending rAF queue must be completely empty (0fps)');

    // 鼠标划入卡片 -> 0ms 立即唤醒 tickR！
    const card = env.getPulseHost().shadowRoot.getElementById('context-card');
    card.dispatchEvent({ type: 'pointerenter' });
    assert.equal(bridge.getDebugState().rafActive, true, 'Pointer enter on card must wake tickR in 0ms');

    // 验证卡片关闭且无活动时轮询自动拉长至 3000ms，且 document.hidden / telemetry="off" 时 100% 挂起
    card.hidden = true;
    env.win.__agPulseExternalBridge({ event: 'card' });
    assert.equal(bridge.getDebugState().rafActive, false, 'Closing card must immediately stop rAF');
    assert.equal(bridge.getDebugState().pollIntervalMs, 3000, 'Closed idle card must stretch poll interval to 3000ms');

    env.doc.hidden = true;
    env.doc.dispatchDocEvent({ type: 'visibilitychange' });
    assert.equal(bridge.getDebugState().pollSuspended, true, 'document.hidden must suspend background polling completely');
    assert.equal(bridge.getDebugState().pollIntervalMs, 0);

    env.doc.hidden = false;
    env.doc.documentElement.setAttribute('data-ag-cs-telemetry', 'off');
    await bridge.sync();
    assert.equal(bridge.getDebugState().pollSuspended, true, 'data-ag-cs-telemetry="off" must suspend polling & rAF');
  } finally {
    bridge?.destroy();
    if (prevDoc !== undefined) globalThis.document = prevDoc;
  }
});

test('dual daylight presets: syncs data-ag-cs-light-preset="crystal|alabaster" to ShadowHost with #FFFFFF card & recessed porcelain/linen well', async () => {
  const env = createPulseMockEnv();
  const observerRecords = [];
  env.win.MutationObserver = class {
    constructor(cb) {
      this.cb = cb;
      observerRecords.push(this);
    }
    observe() {}
    disconnect() {}
  };

  env.win.setScheme('light');
  env.doc.body.className = 'theme-light';
  const host = env.getPulseHost();
  const sr = host.shadowRoot;

  const prevDoc = globalThis.document;
  delete globalThis.document;
  const bridge = bridgeMod.mountPulseVialBridge({
    win: env.win,
    doc: env.doc,
    storage: env.storage,
    vialCore,
    autoPoll: false,
    allowMultiple: true,
  });

  try {
    await bridge.sync();
    const css = sr.querySelector('style[data-ag-cs-pulse-style="1"]')?.textContent || '';
    assert.equal(css.includes('undefined'), false, 'Macro expansion must not emit undefined');
    assert.equal(css.includes('$'), false, 'All $ macros must be fully expanded');

    // 默认浅色预设为 crystal，纯白 #FFFFFF 底色 + 微凹冷瓷底衬 #EEF3FA + 暖白亚麻底衬 #F2EFE7 + 刻度 rgba(30,41,59,.62)
    assert.equal(host.getAttribute('data-pv-light'), '1');
    assert.equal(host.getAttribute('data-pv-preset'), 'crystal');
    assert.ok(css.includes('--c:#FFFFFF'), 'Light mode card must use crisp pure white #FFFFFF background');
    assert.ok(css.includes('#EEF3FA'), 'Daylight Crystal well must feature #EEF3FA cold porcelain recess');
    assert.ok(css.includes('#F2EFE7'), 'Warm Alabaster well must feature #F2EFE7 warm linen recess');
    assert.ok(css.includes('rgba(30,41,59,.62)'), 'Light mode telemetry/scale text must use crisp slate rgba(30,41,59,.62)');

    // 切换至 alabaster 暖白画册
    env.doc.documentElement.setAttribute('data-ag-cs-light-preset', 'alabaster');
    for (const rec of observerRecords) rec.cb([]);
    assert.equal(host.getAttribute('data-pv-preset'), 'alabaster');
    assert.equal(bridge.getDebugState().lightPreset, 'alabaster');

    // 切回 crystal
    env.doc.documentElement.setAttribute('data-ag-cs-light-preset', 'crystal');
    for (const rec of observerRecords) rec.cb([]);
    assert.equal(host.getAttribute('data-pv-preset'), 'crystal');

    bridge.destroy();
    assert.equal(host.hasAttribute('data-pv-preset'), false, 'destroy() must remove data-pv-preset cleanly');
  } finally {
    bridge.destroy();
    if (prevDoc !== undefined) globalThis.document = prevDoc;
  }
});

test('dual-mode toggle, DOM fallback, __agPulseExternalBridge hook, borderless stream, and cryo-lens motion tiers remain 100% intact', async () => {
  const env = createPulseMockEnv();
  const observerRecords = [];
  env.win.MutationObserver = class {
    constructor(cb) {
      this.cb = cb;
      observerRecords.push(this);
    }
    observe() {}
    disconnect() {}
  };
  let prevCalled = 0;
  const priorHook = () => {
    prevCalled++;
  };
  env.win.__agPulseExternalBridge = priorHook;

  const host = env.getPulseHost();
  const sr = host.shadowRoot;
  sr.getElementById('context-percent').textContent = '88%';
  sr.getElementById('context-model').textContent = 'Gemini 4 Carbon High';

  const prevDoc = globalThis.document;
  delete globalThis.document;
  const bridge = bridgeMod.mountPulseVialBridge({
    win: env.win,
    doc: env.doc,
    storage: env.storage,
    vialCore,
    autoPoll: false,
    allowMultiple: true,
  });

  try {
    const stCrit = await bridge.sync();
    assert.equal(stCrit.critical, true);
    assert.equal(stCrit.maxTokens, 512000);

    const css = sr.querySelector('style[data-ag-cs-pulse-style="1"]')?.textContent || '';
    assert.ok(css.includes('background:transparent!important'));
    assert.ok(css.includes(':host(:not(.icons-only))'));
    assert.ok(css.includes('transform-origin:calc(100% - 28px) 0%'));
    assert.ok(css.includes(':host([data-pv-motion="subtle"])'));
    assert.ok(css.includes(':host([data-pv-motion="off"])'));

    for (const tier of ['subtle', 'off', 'standard', 'ultra']) {
      env.doc.documentElement.setAttribute('data-ag-cs-motion', tier);
      for (const rec of observerRecords) rec.cb([]);
      assert.equal(host.getAttribute('data-pv-motion'), tier);
    }

    const toggleBtn = sr.querySelector('[data-ag-pulse-vial-toggle="1"]');
    toggleBtn.dispatchEvent({ type: 'click' });
    assert.equal(env.storage.getItem('agCs.pulseVialMode.v1'), 'bar');
    assert.equal(sr.querySelector('canvas[data-vial-canvas="true"]'), null);

    env.win.__agPulseExternalBridge({
      event: 'render',
      data: {
        speed: {
          tps: 72.4,
          latestTps: 80.1,
          ttftSeconds: 0.61,
          context: { usedTokens: 192000, maxTokens: 256000, usedFraction: 0.75, model: 'Claude Sonnet 4.6', sampledAt: new Date().toISOString() },
        },
      },
    });
    assert.equal(prevCalled, 1);
    assert.equal(bridge.getDebugState().camp, 'claude');

    bridge.destroy();
    assert.equal(env.win.__agPulseExternalBridge, priorHook);
    assert.equal(sr.querySelector('[data-ag-cs-pulse-style="1"]'), null);
    assert.equal(host.hasAttribute('data-pv-mode'), false);
  } finally {
    bridge.destroy();
    if (prevDoc !== undefined) globalThis.document = prevDoc;
  }
});

test('cross-closure hot re-injection idempotence: purges legacy legacy-style orphan nodes and hands off __agCsPulseBridgeInst cleanly without duplicating .pv-btn', async () => {
  const env = createPulseMockEnv();
  const host = env.getPulseHost();
  const sr = host.shadowRoot;
  const card = sr.getElementById('context-card');
  const heading = card.querySelector('.heading');

  // 1. 模拟旧版 legacy-style 遗留在 shadowRoot 里的孤儿 style、.pv-btn 与 .pv-rail（无当前闭包句柄）
  const legacyStyle = env.doc.createElement('style');
  legacyStyle.setAttribute('data-ag-cs-pulse-style', '1');
  sr.appendChild(legacyStyle);
  const legacyBtn = env.doc.createElement('button');
  legacyBtn.className = 'pv-btn';
  legacyBtn.setAttribute('data-ag-pulse-vial-toggle', '1');
  legacyBtn.setAttribute('data-ag-cs-pulse-injected', '1');
  heading.appendChild(legacyBtn);
  const legacyRail = env.doc.createElement('aside');
  legacyRail.className = 'pv-rail';
  legacyRail.setAttribute('data-ag-cs-pulse-injected', '1');
  card.insertBefore(legacyRail, card.firstChild);

  const src = fs.readFileSync(BRIDGE_PATH, 'utf8');
  const sandbox = {
    window: env.win,
    globalThis: env.win,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Number,
  };

  const prevDoc = globalThis.document;
  delete globalThis.document;
  let lastInst = null;
  try {
    // 2. 连续 3 次在全新 IIFE 闭包中重跑脚本并挂载单例（模拟真机热更新 / 多次注入）
    for (let run = 0; run < 3; run++) {
      vm.runInNewContext(src, sandbox);
      lastInst = env.win.__agCsPulseVialBridge.mountPulseVialBridge({
        win: env.win,
        doc: env.doc,
        storage: env.storage,
        vialCore,
        autoPoll: false,
      });
      await lastInst.sync();

      assert.equal(sr.querySelectorAll('.pv-btn').length, 1, `Run #${run + 1}: .pv-btn count must be strictly 1`);
      assert.equal(sr.querySelectorAll('style[data-ag-cs-pulse-style="1"]').length, 1, `Run #${run + 1}: style count must be strictly 1`);
      assert.equal(sr.querySelectorAll('.pv-rail').length, 1, `Run #${run + 1}: .pv-rail count must be strictly 1`);
      assert.equal(sr.querySelectorAll('.pv-cb').length, 1, `Run #${run + 1}: .pv-cb count must be strictly 1`);
      assert.equal(sr.querySelectorAll('.pv-bw').length, 1, `Run #${run + 1}: .pv-bw count must be strictly 1`);
      assert.equal(env.win.__agCsPulseBridgeInst, lastInst, 'Singleton handle must point to latest instance');
    }

    lastInst.destroy();
    assert.equal(env.win.__agCsPulseBridgeInst, undefined, 'destroy() must clear __agCsPulseBridgeInst reference');
    assert.equal(sr.querySelectorAll('.pv-btn').length, 0);
  } finally {
    lastInst?.destroy?.();
    if (prevDoc !== undefined) globalThis.document = prevDoc;
  }
});
