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

const motionEngine = require(path.join(ROOT_DIR, 'motion-engine.js'));
const animatedIcons = require(path.join(ROOT_DIR, 'animated-icons.js'));
const i18nLocales = require(path.join(ROOT_DIR, 'i18n-locales.js'));
void animatedIcons;

function createTestElement(tagName = 'div', attrs = {}, rect = { left: 0, top: 0, width: 88, height: 30 }) {
  const attrMap = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
  const children = [];
  const listeners = new Map();
  const animateCalls = [];
  let attrWrites = 0;

  const el = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    style: {},
    disabled: attrMap.has('disabled'),
    isContentEditable: attrMap.get('contenteditable') === 'true' || attrMap.get('contenteditable') === '',
    children,
    parentElement: null,
    parentNode: null,
    animateCalls,
    get attrWrites() {
      return attrWrites;
    },
    get className() {
      return attrMap.get('class') || '';
    },
    set className(v) {
      attrWrites++;
      if (v) attrMap.set('class', String(v));
      else attrMap.delete('class');
    },
    get id() {
      return attrMap.get('id') || '';
    },
    setAttribute(k, v) {
      attrWrites++;
      attrMap.set(k, String(v));
      if (k === 'disabled') el.disabled = true;
    },
    getAttribute(k) {
      return attrMap.has(k) ? attrMap.get(k) : null;
    },
    hasAttribute(k) {
      return attrMap.has(k);
    },
    removeAttribute(k) {
      attrWrites++;
      attrMap.delete(k);
      if (k === 'disabled') el.disabled = false;
    },
    appendChild(child) {
      child.parentElement = el;
      child.parentNode = el;
      children.push(child);
      return child;
    },
    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === el) return true;
        cur = cur.parentElement;
      }
      return false;
    },
    getBoundingClientRect() {
      return { ...rect };
    },
    matches(selector) {
      if (selector === ':focus-visible') return true;
      return String(selector)
        .split(',')
        .map((s) => s.trim())
        .some((tok) => {
          if (!tok) return false;
          if (tok === el.tagName.toLowerCase()) return true;
          if (tok === '[data-anim-icon]' && attrMap.has('data-anim-icon')) return true;
          if (tok === '[role="button"]' && attrMap.get('role') === 'button') return true;
          if (tok === '[role="textbox"]' && attrMap.get('role') === 'textbox') return true;
          if (tok === '[contenteditable="true"]' && attrMap.get('contenteditable') === 'true') return true;
          if (tok.startsWith('.')) {
            return (attrMap.get('class') || '').split(/\s+/).includes(tok.slice(1));
          }
          return false;
        });
    },
    closest(selector) {
      let cur = el;
      while (cur) {
        if (cur.matches && cur.matches(selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    querySelectorAll(selector) {
      const out = [];
      const walk = (n) => {
        for (const ch of n.children || []) {
          if (ch.matches && ch.matches(selector)) out.push(ch);
          walk(ch);
        }
      };
      walk(el);
      return out;
    },
    querySelector(selector) {
      return el.querySelectorAll(selector)[0] || null;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type, init = {}) {
      for (const fn of [...(listeners.get(type) || [])]) {
        fn({ type, button: 0, target: el, ...init });
      }
    },
    animate(keyframes, options) {
      let cancelled = false;
      const anim = {
        keyframes,
        options,
        get cancelled() {
          return cancelled;
        },
        finished: Promise.resolve(),
        cancel() {
          cancelled = true;
        },
        commitStyles() {},
      };
      animateCalls.push(anim);
      return anim;
    },
  };
  return el;
}

test('getMotionTier resolves data-ag-cs-motion 4 tiers and prefers-reduced-motion override', () => {
  const prevDoc = globalThis.document;
  const prevMatch = globalThis.matchMedia;
  const html = createTestElement('html');
  globalThis.document = { documentElement: html };
  globalThis.matchMedia = () => ({ matches: false });

  try {
    assert.equal(motionEngine.getMotionTier(), 'ultra');
    for (const tier of ['off', 'subtle', 'standard', 'ultra']) {
      html.setAttribute('data-ag-cs-motion', tier);
      assert.equal(motionEngine.getMotionTier(), tier);
    }
    html.setAttribute('data-ag-cs-motion', 'unknown-value');
    assert.equal(motionEngine.getMotionTier(), 'ultra');

    assert.equal(motionEngine.getMotionTier('subtle'), 'subtle');
    assert.equal(motionEngine.getMotionTier(true), 'off');

    globalThis.matchMedia = () => ({ matches: true });
    html.setAttribute('data-ag-cs-motion', 'ultra');
    assert.equal(motionEngine.getMotionTier(), 'off');
    assert.equal(motionEngine.getMotionTier(false), 'ultra');
  } finally {
    globalThis.document = prevDoc;
    globalThis.matchMedia = prevMatch;
  }
});

test('spring, stagger, glideIndicator, drawStroke, and triggerIcon adapt across off / subtle / standard / ultra', () => {
  const prevDoc = globalThis.document;
  const prevMatch = globalThis.matchMedia;
  const html = createTestElement('html');
  globalThis.document = { documentElement: html };
  globalThis.matchMedia = () => ({ matches: false });

  try {
    html.setAttribute('data-ag-cs-motion', 'off');
    const offEl = createTestElement('div');
    const offRes = motionEngine.spring(
      offEl,
      [{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'scale(1)' }],
      { fill: 'forwards' }
    );
    assert.equal(offRes.durationMs, 0);
    assert.equal(offEl.animateCalls.length, 0);
    assert.equal(offEl.style.opacity, '1');

    const offPath = createTestElement('path', { 'data-path-length': '20' });
    motionEngine.drawStroke(offPath);
    assert.equal(offPath.style.strokeDashoffset, '0');
    assert.equal(offPath.animateCalls.length, 0);

    html.setAttribute('data-ag-cs-motion', 'subtle');
    const subEl = createTestElement('div');
    const subRes = motionEngine.spring(subEl, [
      { transform: 'scale(0.84)' },
      { transform: 'scale(1.12)' },
      { transform: 'scale(1)' },
    ]);
    assert.equal(subRes.durationMs, 120);
    assert.equal(subRes.easing, 'ease-out');
    assert.equal(subEl.animateCalls.length, 1);
    assert.equal(subEl.animateCalls[0].keyframes.length, 2, 'Subtle tier must strip overshoot middle keyframes');
    assert.equal(subEl.animateCalls[0].options.duration, 120);
    assert.equal(subEl.animateCalls[0].options.easing, 'ease-out');

    const btn = createTestElement('button');
    const svg = createTestElement('svg', { 'data-anim-icon': 'copy-check', class: 'ag-anim-icon' });
    const cp = createTestElement('g', { class: 'ai-part-copy' });
    const ck = createTestElement('path', { class: 'ai-part-check', 'data-path-length': '22' });
    svg.appendChild(cp);
    svg.appendChild(ck);
    btn.appendChild(svg);

    const hoverSub = motionEngine.triggerIcon(btn, 'hover');
    assert.equal(hoverSub.handles.length, 0, 'Subtle tier must suppress exaggerated hover bounce on icons');

    const checkSub = motionEngine.triggerIcon(btn, 'check');
    assert.equal(cp.style.opacity, '0');
    assert.equal(ck.style.opacity, '1');
    assert.ok(checkSub.handles.length >= 1);
    assert.equal(ck.animateCalls[0].options.duration, 120);
    assert.equal(ck.animateCalls[0].options.easing, 'ease-out');

    html.setAttribute('data-ag-cs-motion', 'standard');
    const prevBtn = createTestElement('button', {}, { left: 20, top: 10, width: 64, height: 26 });
    const nextBtn = createTestElement('button', {}, { left: 96, top: 10, width: 80, height: 26 });
    const glideRes = motionEngine.glideIndicator(prevBtn, nextBtn);
    assert.ok(glideRes.durationMs > 120);
    assert.equal(prevBtn.animateCalls.length, 0);
    assert.equal(nextBtn.animateCalls.length, 1);
    assert.match(nextBtn.animateCalls[0].keyframes[0].transform, /translate3d\(-76\.00px, 0\.00px, 0\)/);
  } finally {
    globalThis.document = prevDoc;
    globalThis.matchMedia = prevMatch;
  }
});

test('bindMicroInteractions explicitly skips .ag-prism-thought-raw-toggle and .ag-prism-thought-overlay with 0 animations and 0 attribute mutations', () => {
  const prevDoc = globalThis.document;
  const prevMatch = globalThis.matchMedia;
  const html = createTestElement('html', { 'data-ag-cs-motion': 'ultra' });
  globalThis.document = { documentElement: html };
  globalThis.matchMedia = () => ({ matches: false });

  const root = createTestElement('div');
  const normalBtn = createTestElement('button');
  const roleBtn = createTestElement('div', { role: 'button' });
  const iconBtn = createTestElement('button');
  const iconSvg = createTestElement('svg', { 'data-anim-icon': 'plus-spin', class: 'ag-anim-icon' });
  iconBtn.appendChild(iconSvg);

  // 中文思考转译组件「原文」按钮与浮层树
  const thoughtOverlay = createTestElement('div', { class: 'ag-prism-thought-overlay' });
  const thoughtRawBtn = createTestElement('button', { class: 'ag-prism-thought-raw-toggle' });
  const thoughtInnerSvg = createTestElement('svg', { 'data-anim-icon': 'sparkles-pen' });
  thoughtRawBtn.appendChild(thoughtInnerSvg);
  thoughtOverlay.appendChild(thoughtRawBtn);
  const standaloneRawBtn = createTestElement('button', { class: 'btn ag-prism-thought-raw-toggle secondary' });

  const disabledBtn = createTestElement('button', { disabled: 'true' });
  const ariaDisabledBtn = createTestElement('div', { role: 'button', 'aria-disabled': 'true' });
  const noSpringBtn = createTestElement('button', { 'data-no-press-spring': '1' });
  const editableInBtn = createTestElement('div', { contenteditable: 'true' });
  const wrapperRoleBtn = createTestElement('div', { role: 'button' });
  wrapperRoleBtn.appendChild(editableInBtn);
  const composerBox = createTestElement('div', { role: 'button', 'data-testid': 'agent-input-box' });
  const hugeContainer = createTestElement('div', { role: 'button' }, { left: 0, top: 0, width: 640, height: 180 });

  for (const n of [
    normalBtn,
    roleBtn,
    iconBtn,
    thoughtOverlay,
    standaloneRawBtn,
    disabledBtn,
    ariaDisabledBtn,
    noSpringBtn,
    wrapperRoleBtn,
    composerBox,
    hugeContainer,
  ]) {
    root.appendChild(n);
  }

  const binding = motionEngine.bindMicroInteractions(root);
  try {
    root.dispatch('pointerdown', { target: normalBtn });
    assert.equal(normalBtn.animateCalls.length, 1);
    assert.deepEqual(normalBtn.animateCalls[0].keyframes[1], { transform: 'scale(0.965)' });

    root.dispatch('pointerdown', { target: roleBtn });
    assert.equal(roleBtn.animateCalls.length, 1);

    root.dispatch('pointerdown', { target: iconSvg });
    assert.equal(iconSvg.animateCalls.length, 1);
    assert.equal(iconBtn.animateCalls.length, 1);

    // 验证 .ag-prism-thought-raw-toggle 及其子节点在所有事件与显式调用下 0 动画、0 属性改写
    for (const thoughtTarget of [thoughtRawBtn, thoughtInnerSvg, thoughtOverlay, standaloneRawBtn]) {
      root.dispatch('pointerover', { target: thoughtTarget, relatedTarget: root });
      root.dispatch('focusin', { target: thoughtTarget });
      root.dispatch('pointerdown', { target: thoughtTarget });
    }
    motionEngine.spring(thoughtRawBtn, [{ transform: 'scale(0.9)' }, { transform: 'scale(1)' }]);
    motionEngine.triggerIcon(thoughtRawBtn, 'hover');

    assert.equal(thoughtRawBtn.animateCalls.length, 0, '.ag-prism-thought-raw-toggle must never receive WAAPI animations');
    assert.equal(thoughtInnerSvg.animateCalls.length, 0, 'Icons inside .ag-prism-thought-raw-toggle must never animate');
    assert.equal(standaloneRawBtn.animateCalls.length, 0, 'Standalone .ag-prism-thought-raw-toggle must never animate');
    assert.equal(thoughtRawBtn.attrWrites, 0, '.ag-prism-thought-raw-toggle must have 0 attribute mutations');
    assert.deepEqual(thoughtRawBtn.style, {}, '.ag-prism-thought-raw-toggle inline style must remain completely untouched');

    for (const excluded of [disabledBtn, ariaDisabledBtn, noSpringBtn, editableInBtn, wrapperRoleBtn, composerBox, hugeContainer]) {
      root.dispatch('pointerdown', { target: excluded });
    }
    assert.equal(disabledBtn.animateCalls.length, 0);
    assert.equal(ariaDisabledBtn.animateCalls.length, 0);
    assert.equal(noSpringBtn.animateCalls.length, 0);
    assert.equal(wrapperRoleBtn.animateCalls.length, 0);
    assert.equal(composerBox.animateCalls.length, 0);
    assert.equal(hugeContainer.animateCalls.length, 0);

    html.setAttribute('data-ag-cs-motion', 'subtle');
    root.dispatch('pointerdown', { target: normalBtn });
    assert.equal(normalBtn.animateCalls.length, 1);
  } finally {
    binding.unbind();
    globalThis.document = prevDoc;
    globalThis.matchMedia = prevMatch;
  }
});

test('i18n-locales UI_TABLE defines all 6 motionLevel keys across all 5 languages', () => {
  const requiredKeys = [
    'setMotionLevelTitle',
    'setMotionLevelDesc',
    'optMotionOff',
    'optMotionSubtle',
    'optMotionStandard',
    'optMotionUltra',
  ];
  for (const lang of ['zh-CN', 'zh-TW', 'yue', 'en', 'ja']) {
    const ui = i18nLocales.getUiStrings(lang);
    for (const k of requiredKeys) {
      assert.ok(typeof ui[k] === 'string' && ui[k].length > 0, `Missing ${k} for ${lang}`);
    }
  }
});

test('cdp.REMOVE_EXPRESSION cleanly unwraps stream chunks without losing text, restores injected host icons, and purges transient attributes when cdp.js is present', (t) => {
  const cdpPath = path.join(ROOT_DIR, 'cdp.js');
  if (!fs.existsSync(cdpPath)) {
    t.skip('cdp.js not yet generated by prism-repo');
    return;
  }
  const cdp = require(cdpPath);

  function makeNode(tag, attrs = {}) {
    const attrMap = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
    const childNodes = [];
    const node = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      hidden: attrMap.has('hidden'),
      style: { removeProperty() {} },
      childNodes,
      parentNode: null,
      get firstChild() {
        return childNodes[0] || null;
      },
      get attributes() {
        return [...attrMap.keys()].map((name) => ({ name, value: attrMap.get(name) }));
      },
      classList: {
        remove(...cls) {
          const set = new Set((attrMap.get('class') || '').split(/\s+/).filter(Boolean));
          for (const c of cls) set.delete(c);
          const next = [...set].join(' ');
          if (next) attrMap.set('class', next);
          else attrMap.delete('class');
        },
        get length() {
          return (attrMap.get('class') || '').split(/\s+/).filter(Boolean).length;
        },
      },
      setAttribute(k, v) {
        attrMap.set(k, String(v));
        if (k === 'hidden') node.hidden = true;
      },
      getAttribute(k) {
        return attrMap.has(k) ? attrMap.get(k) : null;
      },
      hasAttribute(k) {
        return attrMap.has(k);
      },
      removeAttribute(k) {
        attrMap.delete(k);
        if (k === 'hidden') node.hidden = false;
      },
      appendChild(ch) {
        if (ch.parentNode) ch.remove();
        ch.parentNode = node;
        childNodes.push(ch);
        return ch;
      },
      insertBefore(ch, ref) {
        const idx = childNodes.indexOf(ref);
        if (idx < 0) return node.appendChild(ch);
        if (ch.parentNode) ch.remove();
        ch.parentNode = node;
        childNodes.splice(idx, 0, ch);
        return ch;
      },
      remove() {
        if (!node.parentNode) return;
        const idx = node.parentNode.childNodes.indexOf(node);
        if (idx >= 0) node.parentNode.childNodes.splice(idx, 1);
        node.parentNode = null;
      },
      normalize() {
        for (let i = 0; i < childNodes.length - 1; ) {
          if (childNodes[i].nodeType === 3 && childNodes[i + 1].nodeType === 3) {
            childNodes[i].textContent += childNodes[i + 1].textContent;
            childNodes.splice(i + 1, 1);
          } else {
            i++;
          }
        }
      },
      get textContent() {
        return childNodes.map((c) => c.textContent).join('');
      },
      matches(sel) {
        return String(sel)
          .split(',')
          .map((s) => s.trim())
          .some((tok) => {
            if (!tok) return false;
            if (tok.startsWith('style#')) return node.tagName === 'STYLE' && attrMap.get('id') === tok.slice(6);
            if (tok.startsWith('#')) return attrMap.get('id') === tok.slice(1);
            if (tok.startsWith('.')) return (attrMap.get('class') || '').split(/\s+/).includes(tok.slice(1));
            const m = /^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/.exec(tok);
            if (m) return m[2] === undefined ? attrMap.has(m[1]) : attrMap.get(m[1]) === m[2];
            return false;
          });
      },
      querySelectorAll(sel) {
        const res = [];
        const walk = (n) => {
          for (const ch of n.childNodes || []) {
            if (ch.nodeType === 1) {
              if (ch.matches(sel)) res.push(ch);
              walk(ch);
            }
          }
        };
        walk(node);
        return res;
      },
      getElementById(id) {
        return node.querySelectorAll('#' + id)[0] || null;
      },
    };
    return node;
  }

  const makeText = (txt) => {
    const tn = {
      nodeType: 3,
      textContent: txt,
      parentNode: null,
      remove() {
        if (!tn.parentNode) return;
        const idx = tn.parentNode.childNodes.indexOf(tn);
        if (idx >= 0) tn.parentNode.childNodes.splice(idx, 1);
        tn.parentNode = null;
      },
    };
    return tn;
  };

  const root = makeNode('html', { 'data-ag-cs-motion': 'ultra', 'data-ag-cs-lang': 'zh-CN', 'data-ag-prism': '1.0.0' });
  const body = makeNode('body');
  root.appendChild(body);

  const para = makeNode('p', {
    'data-ag-cs-sonar': '1',
    'data-ag-cs-liftoff-bubble': '1',
  });
  para.appendChild(makeText('Hello '));
  const chunk1 = makeNode('span', { class: 'ag-cs-stream-chunk' });
  chunk1.appendChild(makeText('Antigravity '));
  const chunk2 = makeNode('span', { class: 'ag-cs-thought-chunk' });
  chunk2.appendChild(makeText('Prism!'));
  para.appendChild(chunk1);
  para.appendChild(chunk2);
  body.appendChild(para);

  const copyBtn = makeNode('button', { 'data-ag-cs-icon-injected': 'copy-check' });
  const origSvg = makeNode('svg', { hidden: '', 'data-ag-cs-orig-svg': '1' });
  const animSvg = makeNode('svg', { class: 'ag-anim-icon ag-icon-copy-check' });
  copyBtn.appendChild(origSvg);
  copyBtn.appendChild(animSvg);
  body.appendChild(copyBtn);

  const documentMock = {
    documentElement: root,
    body,
    querySelector: (s) => root.querySelectorAll(s)[0] || null,
    querySelectorAll: (s) => root.querySelectorAll(s),
    getElementById: (id) => root.getElementById(id),
  };
  const sandbox = {
    document: documentMock,
    window: {},
    globalThis: {},
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
  assert.equal(root.hasAttribute('data-ag-cs-motion'), false);
  assert.equal(para.textContent, 'Hello Antigravity Prism!');
  assert.equal(para.childNodes.length, 1);
  assert.equal(copyBtn.hasAttribute('data-ag-cs-icon-injected'), false);
  assert.equal(origSvg.hidden, false);
  assert.equal(animSvg.parentNode, null);
});
