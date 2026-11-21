import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const cdp = require(path.join(ROOT, 'cdp.js'));
const runtime = require(path.join(ROOT, 'vendor', 'host-i18n', 'host-i18n-runtime.js'));
const settingsPanel = require(path.join(ROOT, 'settings-panel.js'));
const i18nLocales = require(path.join(ROOT, 'i18n-locales.js'));
const i18nCore = require(path.join(ROOT, 'i18n-core.js'));

function createTestEnv(initialTime = 1000) {
  let now = initialTime;
  let nextTimerId = 1;
  const timers = new Map();
  let observerInstances = [];
  const docListeners = new Map();
  const winListeners = new Map();

  function makeText(val) {
    const node = {
      nodeType: 3,
      _nodeValue: String(val),
      parentElement: null,
      parentNode: null,
      isConnected: true,
      get nodeValue() {
        return this._nodeValue;
      },
      set nodeValue(v) {
        const next = String(v);
        if (this._nodeValue === next) return;
        this._nodeValue = next;
        notifyObservers({ type: 'characterData', target: this });
      },
      get textContent() {
        return this._nodeValue;
      },
      set textContent(v) {
        this.nodeValue = v;
      },
      get previousSibling() {
        if (!this.parentNode) return null;
        const list = this.parentNode.childNodes;
        const idx = list.indexOf(this);
        return idx > 0 ? list[idx - 1] : null;
      },
      get nextSibling() {
        if (!this.parentNode) return null;
        const list = this.parentNode.childNodes;
        const idx = list.indexOf(this);
        return idx >= 0 && idx + 1 < list.length ? list[idx + 1] : null;
      },
    };
    return node;
  }

  function makeEl(tag, opts = {}) {
    const attrs = new Map(Object.entries(opts.attrs || {}));
    const classes = new Set((opts.className || '').split(/\s+/).filter(Boolean));
    const childNodes = [];
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      id: opts.id || attrs.get('id') || '',
      isContentEditable: Boolean(opts.isContentEditable || attrs.get('contenteditable') === 'true'),
      parentElement: null,
      parentNode: null,
      isConnected: true,
      childNodes,
      style: {
        _props: {},
        setProperty(k, v) { this._props[k] = String(v); },
        removeProperty(k) { delete this._props[k]; },
      },
      classList: {
        contains: (c) => classes.has(c),
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
      },
      get className() {
        return Array.from(classes).join(' ');
      },
      set className(v) {
        classes.clear();
        String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
      },
      get children() {
        return childNodes.filter((c) => c.nodeType === 1);
      },
      get firstChild() {
        return childNodes[0] || null;
      },
      get lastElementChild() {
        const ch = this.children;
        return ch[ch.length - 1] || null;
      },
      get previousSibling() {
        if (!this.parentNode) return null;
        const list = this.parentNode.childNodes;
        const idx = list.indexOf(this);
        return idx > 0 ? list[idx - 1] : null;
      },
      get previousElementSibling() {
        if (!this.parentNode) return null;
        const list = this.parentNode.children;
        const idx = list.indexOf(this);
        return idx > 0 ? list[idx - 1] : null;
      },
      get nextSibling() {
        if (!this.parentNode) return null;
        const list = this.parentNode.childNodes;
        const idx = list.indexOf(this);
        return idx >= 0 && idx + 1 < list.length ? list[idx + 1] : null;
      },
      get textContent() {
        return childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join('');
      },
      set textContent(v) {
        childNodes.length = 0;
        const txt = makeText(v);
        txt.parentElement = this;
        txt.parentNode = this;
        childNodes.push(txt);
        notifyObservers({ type: 'childList', target: this, addedNodes: [txt], removedNodes: [] });
      },
      append(...nodes) {
        for (const n of nodes) {
          const item = typeof n === 'string' ? makeText(n) : n;
          item.parentElement = this;
          item.parentNode = this;
          childNodes.push(item);
          notifyObservers({ type: 'childList', target: this, addedNodes: [item], removedNodes: [] });
        }
        return this;
      },
      appendChild(n) {
        return this.append(n);
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'id') this.id = String(v);
        if (k === 'contenteditable') this.isContentEditable = String(v) === 'true';
      },
      getAttribute(k) {
        return attrs.has(k) ? attrs.get(k) : null;
      },
      hasAttribute(k) {
        return attrs.has(k);
      },
      removeAttribute(k) {
        attrs.delete(k);
      },
      toggleAttribute(k, force) {
        const on = force === undefined ? !attrs.has(k) : Boolean(force);
        if (on) attrs.set(k, '');
        else attrs.delete(k);
        return on;
      },
      addEventListener() {},
      removeEventListener() {},
      closest(sel) {
        let cur = this;
        while (cur) {
          if (this._matchSelector && this._matchSelector(cur, sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      _matchSimple(node, simple) {
        if (!node || node.nodeType !== 1) return false;
        let rest = simple;
        const tagM = /^[a-zA-Z0-9_-]+/.exec(rest);
        if (tagM) {
          if (node.tagName !== tagM[0].toUpperCase()) return false;
          rest = rest.slice(tagM[0].length);
        }
        while (rest) {
          if (rest[0] === '#') {
            const m = /^#([a-zA-Z0-9_-]+)/.exec(rest);
            if (!m || node.id !== m[1]) return false;
            rest = rest.slice(m[0].length);
          } else if (rest[0] === '.') {
            const m = /^\.([a-zA-Z0-9_-]+)/.exec(rest);
            if (!m || !node.classList.contains(m[1])) return false;
            rest = rest.slice(m[0].length);
          } else if (rest[0] === '[') {
            const m = /^\[([^\]=]+)(?:="([^"]*)")?\]/.exec(rest);
            if (!m) return false;
            const ok = m[2] === undefined ? node.hasAttribute(m[1]) : node.getAttribute(m[1]) === m[2];
            if (!ok) return false;
            rest = rest.slice(m[0].length);
          } else {
            return false;
          }
        }
        return true;
      },
      _matchSelector(node, sel) {
        return sel.split(',').map((s) => s.trim()).filter(Boolean).some((part) => {
          const tokens = part.split(/\s+/).filter(Boolean);
          if (tokens.length === 0) return false;
          if (!this._matchSimple(node, tokens[tokens.length - 1])) return false;
          let cur = node.parentElement;
          for (let ti = tokens.length - 2; ti >= 0; ti--) {
            while (cur && !this._matchSimple(cur, tokens[ti])) {
              cur = cur.parentElement;
            }
            if (!cur) return false;
            cur = cur.parentElement;
          }
          return true;
        });
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.children) {
            if (this._matchSelector(c, sel)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
    };
    if (opts.text !== undefined) {
      const txt = makeText(opts.text);
      txt.parentElement = el;
      txt.parentNode = el;
      childNodes.push(txt);
    }
    return el;
  }

  function notifyObservers(mutation) {
    for (const obs of observerInstances) {
      if (!obs.connected) continue;
      obs.queue.push(mutation);
    }
  }

  function flushObservers() {
    for (const obs of observerInstances) {
      if (!obs.connected || obs.queue.length === 0) continue;
      const batch = obs.queue.splice(0);
      obs.cb(batch);
    }
  }

  class MockMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.connected = false;
      this.options = null;
      this.queue = [];
      observerInstances.push(this);
    }
    observe(_target, options) {
      this.connected = true;
      this.options = options;
    }
    disconnect() {
      this.connected = false;
    }
  }

  const html = makeEl('html');
  const head = makeEl('head');
  const body = makeEl('body');
  html.append(head, body);

  const doc = {
    readyState: 'complete',
    hidden: false,
    documentElement: html,
    head,
    body,
    createElement: (t) => makeEl(t),
    getElementById(id) {
      return html.querySelector('#' + id);
    },
    querySelector(s) {
      return html.querySelector(s);
    },
    querySelectorAll(s) {
      return html.querySelectorAll(s);
    },
    addEventListener(ev, fn, opts) {
      const key = `${ev}:${Boolean(opts && (opts === true || opts.capture))}`;
      if (!docListeners.has(key)) docListeners.set(key, new Set());
      docListeners.get(key).add(fn);
    },
    removeEventListener(ev, fn, opts) {
      const key = `${ev}:${Boolean(opts && (opts === true || opts.capture))}`;
      docListeners.get(key)?.delete(fn);
    },
    dispatchEvent(ev) {
      for (const cap of [true, false]) {
        const key = `${ev.type}:${cap}`;
        for (const fn of [...(docListeners.get(key) || [])]) fn(ev);
      }
    },
  };

  const win = {
    document: doc,
    location: { href: 'vscode-file://vscode-app/workbench.html' },
    MutationObserver: MockMutationObserver,
    addEventListener(ev, fn, opts) {
      const key = `${ev}:${Boolean(opts && (opts === true || opts.capture))}`;
      if (!winListeners.has(key)) winListeners.set(key, new Set());
      winListeners.get(key).add(fn);
    },
    removeEventListener(ev, fn, opts) {
      const key = `${ev}:${Boolean(opts && (opts === true || opts.capture))}`;
      winListeners.get(key)?.delete(fn);
    },
    dispatchEvent(ev) {
      for (const cap of [true, false]) {
        const key = `${ev.type}:${cap}`;
        for (const fn of [...(winListeners.get(key) || [])]) fn(ev);
      }
    },
  };

  function setTimeoutFn(fn, ms = 0) {
    const id = nextTimerId++;
    timers.set(id, { fn, runAt: now + ms, isRaf: false });
    return id;
  }
  function clearTimeoutFn(id) {
    timers.delete(id);
  }
  function rafFn(fn) {
    const id = nextTimerId++;
    timers.set(id, { fn, runAt: now + 16, isRaf: true });
    return id;
  }
  function cancelRafFn(id) {
    timers.delete(id);
  }
  function advanceTime(ms) {
    const targetTime = now + ms;
    while (true) {
      flushObservers();
      let earliest = null;
      for (const [id, entry] of timers.entries()) {
        if (entry.runAt <= targetTime && (!earliest || entry.runAt < earliest.entry.runAt)) {
          earliest = { id, entry };
        }
      }
      if (!earliest) break;
      now = Math.max(now, earliest.entry.runAt);
      timers.delete(earliest.id);
      earliest.entry.fn();
    }
    now = targetTime;
    flushObservers();
  }
  function flushRafOnly() {
    flushObservers();
    const rafEntries = [];
    for (const [id, entry] of timers.entries()) {
      if (entry.isRaf) rafEntries.push({ id, entry });
    }
    for (const item of rafEntries) {
      timers.delete(item.id);
      item.entry.fn();
    }
    flushObservers();
  }

  return {
    win,
    doc,
    makeEl,
    makeText,
    timers,
    observerInstances,
    docListeners,
    winListeners,
    nowFn: () => now,
    setNow: (v) => { now = v; },
    setTimeoutFn,
    clearTimeoutFn,
    rafFn,
    cancelRafFn,
    advanceTime,
    flushObservers,
    flushRafOnly,
  };
}

test('dictionary hygiene: vendor/host-i18n/zh-CN.json has 3361 exact + 327 patterns, zero private terms, compact JSON, and safe regexes', () => {
  const dictPath = path.join(ROOT, 'vendor', 'host-i18n', 'zh-CN.json');
  const raw = fs.readFileSync(dictPath, 'utf8');
  assert.equal(raw.includes('\n  '), false, 'zh-CN.json must be compact JSON without pretty-print indentation');

  const dict = JSON.parse(raw);
  const exactKeys = Object.keys(dict.exact || {});
  assert.equal(exactKeys.length, 3361);
  assert.equal((dict.patterns || []).length, 327);

  const privRe = /ema-persona|emoji_emma|C:\\Users\\Administrator|\/Users\/|\/home\/|\.hermes|obsidian-prism/i;
  for (const k of exactKeys) {
    assert.equal(privRe.test(k) || privRe.test(dict.exact[k]), false, `Private term leaked in exact: ${k}`);
  }
  const nestedRe = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/;
  for (const p of dict.patterns) {
    assert.equal(privRe.test(p.regex) || privRe.test(p.replacement), false, `Private term in pattern: ${p.regex}`);
    assert.equal(nestedRe.test(p.regex), false, `Nested quantifier ReDoS risk: ${p.regex}`);
    assert.doesNotThrow(() => new RegExp(p.regex));
  }
});

test('runtime translates exact, pattern, attributes, multi-text merge, inline reorder, and destroy() restores 100% losslessly with zero DOM pollution', () => {
  const env = createTestEnv();
  const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor', 'host-i18n', 'zh-CN.json'), 'utf8'));

  const navBtn = env.makeEl('button', {
    text: 'Settings',
    attrs: { title: 'Open Settings', 'aria-label': 'Settings', 'data-tooltip': 'Settings' },
  });
  const patternDiv = env.makeEl('div', { text: '5 minutes ago' });
  const multiTextDiv = env.makeEl('div');
  const t1 = env.makeText('All ');
  const t2 = env.makeText('3');
  const t3 = env.makeText('s run as Flash.');
  multiTextDiv.append(t1, t2, t3);

  const inlineWrap = env.makeEl('div');
  const i1 = env.makeText('Also includes');
  const iSpan = env.makeEl('span', { text: 'Global Permissions' });
  const i2 = env.makeText('when working in this project.');
  inlineWrap.append(i1, iSpan, i2);

  env.doc.body.append(navBtn, patternDiv, multiTextDiv, inlineWrap);

  const inst = runtime.mountHostI18n({
    root: env.win,
    doc: env.doc,
    dict,
    mode: 'auto',
    nowFn: env.nowFn,
    setTimeoutFn: env.setTimeoutFn,
    clearTimeoutFn: env.clearTimeoutFn,
    rafFn: env.rafFn,
    cancelRafFn: env.cancelRafFn,
  });

  const st = inst.getStatus();
  assert.equal(st.active, true);
  assert.equal(st.status, 'active');
  assert.equal(st.yielded, false);
  assert.ok(st.translatedCount >= 5);
  assert.equal(env.doc.documentElement.getAttribute('data-ag-prism-host-i18n'), 'active');

  assert.equal(navBtn.textContent, '设置');
  assert.equal(navBtn.getAttribute('aria-label'), '设置');
  assert.equal(navBtn.getAttribute('data-tooltip'), '设置');
  assert.equal(patternDiv.textContent, '5 分钟前');
  assert.notEqual(multiTextDiv.textContent, 'All 3s run as Flash.');
  assert.equal(i1.nodeValue, '在此项目中工作时，也包含');
  assert.equal(i2.nodeValue, '。');

  // Verify zero private property pollution on DOM nodes
  for (const key of Object.keys(navBtn)) {
    assert.equal(key.startsWith('_agy'), false, `DOM pollution found: ${key}`);
  }
  for (const key of Object.keys(t1)) {
    assert.equal(key.startsWith('_agy'), false, `TextNode pollution found: ${key}`);
  }

  assert.ok((env.docListeners.get('pointerenter:true')?.size || 0) >= 1, 'capture pointerenter must be registered');
  assert.ok((env.winListeners.get('blur:false')?.size || 0) >= 1, 'blur listener must be registered');

  // Verify 100% lossless restore on destroy()
  inst.destroy();
  const after = inst.getStatus();
  assert.equal(after.active, false);
  assert.equal(after.status, 'off');
  assert.equal(after.translatedCount, 0);
  assert.equal(env.doc.documentElement.getAttribute('data-ag-prism-host-i18n'), 'off');

  assert.equal(navBtn.textContent, 'Settings');
  assert.equal(navBtn.getAttribute('aria-label'), 'Settings');
  assert.equal(navBtn.getAttribute('data-tooltip'), 'Settings');
  assert.equal(patternDiv.textContent, '5 minutes ago');
  assert.equal(t1.nodeValue, 'All ');
  assert.equal(t2.nodeValue, '3');
  assert.equal(t3.nodeValue, 's run as Flash.');
  assert.equal(i1.nodeValue, 'Also includes');
  assert.equal(i2.nodeValue, 'when working in this project.');
  assert.equal(env.timers.size, 0, 'All timers/rAF must be cleared after destroy()');
  assert.equal(env.docListeners.get('pointerenter:true')?.size || 0, 0);
  assert.equal(env.winListeners.get('blur:false')?.size || 0, 0);
});

test('Layer 1 auto-yield: known global flags, root attributes, and html[lang="zh-CN"]', () => {
  const dict = { exact: { Settings: '设置' }, patterns: [] };

  for (const flag of ['__AGY_I18N_INITIALIZED__', '__ANTIGRAVITY_CN__', '__I18N_PATCHED__']) {
    const env = createTestEnv();
    env.win[flag] = true;
    const btn = env.makeEl('button', { text: 'Settings' });
    env.doc.body.append(btn);

    const inst = runtime.mountHostI18n({
      root: env.win,
      doc: env.doc,
      dict,
      mode: 'auto',
      nowFn: env.nowFn,
      setTimeoutFn: env.setTimeoutFn,
      clearTimeoutFn: env.clearTimeoutFn,
      rafFn: env.rafFn,
      cancelRafFn: env.cancelRafFn,
    });
    assert.equal(inst.getStatus().status, 'yielded');
    assert.equal(inst.getStatus().yielded, true);
    assert.equal(inst.getStatus().reason, 'external-ui-zh');
    assert.equal(env.observerInstances.length, 0, 'Must NOT mount MutationObserver when Layer 1 yields');
    assert.equal(btn.textContent, 'Settings');
    assert.equal(env.doc.documentElement.getAttribute('data-ag-prism-host-i18n'), 'yielded');
  }

  // html[lang="zh-CN"]
  const envLang = createTestEnv();
  envLang.doc.documentElement.setAttribute('lang', 'zh-CN');
  const btnLang = envLang.makeEl('button', { text: 'Settings' });
  envLang.doc.body.append(btnLang);
  const instLang = runtime.mountHostI18n({
    root: envLang.win,
    doc: envLang.doc,
    dict,
    mode: 'auto',
  });
  assert.equal(instLang.getStatus().status, 'yielded');
  assert.equal(instLang.getStatus().reason, 'external-ui-zh');
  assert.equal(envLang.observerInstances.length, 0);
});

test('Layer 2 zero-signature unknown external plugin auto-yield via Chrome UI sampling & anchor words', () => {
  const dict = { exact: { Settings: '设置', Cancel: '取消', Save: '保存' }, patterns: [] };

  // Case A: >= 3 Chrome UI controls in zh and >= 25% ratio (no global flags, no html[lang])
  const envA = createTestEnv();
  const nav = envA.makeEl('nav');
  nav.append(
    envA.makeEl('button', { text: '偏好设置' }),
    envA.makeEl('button', { text: '新建对话' }),
    envA.makeEl('button', { text: '扩展管理' }),
    envA.makeEl('button', { text: 'Save' }),
    envA.makeEl('button', { text: 'Cancel' })
  );
  // Put English inside conversation-view so chat messages don't pollute Chrome sampling
  const chat = envA.makeEl('div', { attrs: { 'data-testid': 'conversation-view' } });
  for (let i = 0; i < 20; i++) {
    chat.append(envA.makeEl('button', { text: `Message action ${i}` }));
  }
  envA.doc.body.append(nav, chat);

  const instA = runtime.mountHostI18n({
    root: envA.win,
    doc: envA.doc,
    dict,
    mode: 'auto',
    nowFn: envA.nowFn,
    setTimeoutFn: envA.setTimeoutFn,
    clearTimeoutFn: envA.clearTimeoutFn,
  });
  assert.equal(instA.getStatus().status, 'yielded');
  assert.equal(instA.getStatus().reason, 'external-ui-zh');
  assert.equal(envA.observerInstances.length, 0);

  // Case B: >= 2 anchor words hit directly even with many English buttons
  const envB = createTestEnv();
  const aside = envB.makeEl('aside');
  aside.append(envB.makeEl('button', { text: '设置' }), envB.makeEl('button', { text: '工作区' }));
  for (let i = 0; i < 12; i++) {
    aside.append(envB.makeEl('button', { text: `Workspace Item ${i}` }));
  }
  envB.doc.body.append(aside);
  const instB = runtime.mountHostI18n({ root: envB.win, doc: envB.doc, dict, mode: 'auto' });
  assert.equal(instB.getStatus().status, 'yielded');
  assert.equal(instB.getStatus().reason, 'external-ui-zh');

  // Case C: Only 1 Chinese user-name button & rest English -> must NOT false-trigger yield
  const envC = createTestEnv();
  const header = envC.makeEl('header');
  header.append(
    envC.makeEl('button', { text: '张三' }),
    envC.makeEl('button', { text: 'Settings' }),
    envC.makeEl('button', { text: 'Save' }),
    envC.makeEl('button', { text: 'Cancel' })
  );
  envC.doc.body.append(header);
  const instC = runtime.mountHostI18n({
    root: envC.win,
    doc: envC.doc,
    dict,
    mode: 'auto',
    nowFn: envC.nowFn,
    setTimeoutFn: envC.setTimeoutFn,
    clearTimeoutFn: envC.clearTimeoutFn,
    rafFn: envC.rafFn,
    cancelRafFn: envC.cancelRafFn,
  });
  assert.equal(instC.getStatus().status, 'active');
  assert.equal(header.children[1].textContent, '设置');
  instC.destroy();
});

test('Layer 2b delayed external plugin within 1200ms triggers auto-yield and lossless rollback', () => {
  const env = createTestEnv(1000);
  const dict = { exact: { Settings: '设置', Save: '保存' }, patterns: [] };

  const btn1 = env.makeEl('button', { text: 'Settings' });
  const btn2 = env.makeEl('button', { text: 'File' });
  const btn3 = env.makeEl('button', { text: 'Edit' });
  env.doc.body.append(btn1, btn2, btn3);

  const inst = runtime.mountHostI18n({
    root: env.win,
    doc: env.doc,
    dict,
    mode: 'auto',
    nowFn: env.nowFn,
    setTimeoutFn: env.setTimeoutFn,
    clearTimeoutFn: env.clearTimeoutFn,
    rafFn: env.rafFn,
    cancelRafFn: env.cancelRafFn,
  });
  assert.equal(inst.getStatus().status, 'active');
  assert.equal(btn1.textContent, '设置');

  // External plugin boots 300ms later and writes Chinese to host chrome nodes
  env.advanceTime(300);
  btn2.firstChild.nodeValue = '文件';
  btn3.firstChild.nodeValue = '编辑';
  env.flushObservers();

  const st = inst.getStatus();
  assert.equal(st.status, 'yielded');
  assert.equal(st.reason, 'external-ui-zh');
  assert.equal(st.active, false);
  // Our translated btn1 must be rolled back to its original English!
  assert.equal(btn1.textContent, 'Settings');
  // External plugin's nodes remain untouched
  assert.equal(btn2.textContent, '文件');
  assert.equal(btn3.textContent, '编辑');
});

test('Layer 3 Ping-Pong Circuit Breaker: single-node >= 3 conflicts exempts node; global >= 5 nodes triggers conflict-breaker destroy()', () => {
  const env = createTestEnv(5000);
  const dict = {
    exact: {
      Settings: '设置',
      Save: '保存',
      Cancel: '取消',
      Open: '打开',
      Close: '关闭',
      Copy: '复制',
      Delete: '删除',
    },
    patterns: [],
  };

  // Use mode:'on' to verify breaker still works even when initial auto-yield is skipped!
  const nodes = ['Settings', 'Save', 'Cancel', 'Open', 'Close', 'Copy', 'Delete'].map((t) =>
    env.makeEl('button', { text: t })
  );
  env.doc.body.append(...nodes);

  const inst = runtime.mountHostI18n({
    root: env.win,
    doc: env.doc,
    dict,
    mode: 'on',
    nowFn: env.nowFn,
    setTimeoutFn: env.setTimeoutFn,
    clearTimeoutFn: env.clearTimeoutFn,
    rafFn: env.rafFn,
    cancelRafFn: env.cancelRafFn,
  });
  assert.equal(inst.getStatus().status, 'active');
  assert.equal(nodes[0].textContent, '设置');

  // Normal React update (Settings -> Saved? use Cancel) must NOT count as conflict
  nodes[6].firstChild.nodeValue = 'Save';
  env.advanceTime(50);
  assert.equal(nodes[6].textContent, '保存');
  assert.equal(inst.getStatus().status, 'active');

  // Single-node ping-pong 3 times on nodes[0]: external keeps reverting '设置' -> 'Settings'
  for (let i = 0; i < 3; i++) {
    nodes[0].firstChild.nodeValue = 'Settings';
    env.advanceTime(100);
  }
  assert.equal(inst.getStatus().status, 'active', '1 conflicted node must not trip global 5-node breaker');
  assert.equal(nodes[0].textContent, 'Settings', 'Conflicted node must be exempted and stop fighting');

  // Now 4 more distinct nodes enter genuine ping-pong (>= 2 reverts within 3000ms, total 5 conflicted nodes)
  const origWords = ['Save', 'Cancel', 'Open', 'Close'];
  for (let round = 0; round < 2; round++) {
    for (let idx = 1; idx <= 4; idx++) {
      nodes[idx].firstChild.nodeValue = origWords[idx - 1];
      env.advanceTime(50);
    }
  }

  const finalSt = inst.getStatus();
  assert.equal(finalSt.status, 'yielded');
  assert.equal(finalSt.reason, 'conflict-breaker');
  assert.equal(finalSt.active, false);
  assert.equal(env.doc.documentElement.getAttribute('data-ag-prism-host-i18n'), 'yielded');
  // Remaining unaffected nodes like nodes[5] ('Copy' -> '复制') must be cleanly restored to original!
  assert.equal(nodes[5].textContent, 'Copy');
});

test('strict isolation boundaries: Prism UI, code/editors, inputs, model selector, and chat prose remain untouched', () => {
  const env = createTestEnv();
  const dict = { exact: { Settings: '设置', Save: '保存', Auto: '自动', Copy: '复制' }, patterns: [] };

  const prismSec = env.makeEl('div', { id: 'ag-cs-settings-sec' });
  prismSec.append(env.makeEl('button', { text: 'Settings' }));
  const prismCls = env.makeEl('div', { className: 'ag-prism-sidebar-studio' });
  prismCls.append(env.makeEl('span', { text: 'Save' }));
  const prismAttr = env.makeEl('div', { attrs: { 'data-ag-prism-ui': '1' } });
  prismAttr.append(env.makeEl('span', { text: 'Copy' }));

  const codeEl = env.makeEl('code', { text: 'Settings' });
  const preEl = env.makeEl('pre', { text: 'Save' });
  const monacoEl = env.makeEl('div', { className: 'monaco-editor' });
  monacoEl.append(env.makeEl('span', { text: 'Copy' }));
  const inputEl = env.makeEl('input', { attrs: { value: 'Settings' } });
  const editableEl = env.makeEl('div', { attrs: { contenteditable: 'true' }, text: 'Settings' });

  const modelTrigger = env.makeEl('button', { attrs: { 'data-testid': 'model-selector-trigger' }, text: 'Auto' });
  const modelPanel = env.makeEl('div', { attrs: { 'data-testid': 'model-selector-panel' } });
  modelPanel.append(env.makeEl('span', { text: 'Auto' }));
  const effortEl = env.makeEl('div', { attrs: { 'data-effort': 'high' }, text: 'Settings' });

  const chatProse = env.makeEl('div', { attrs: { 'data-markdown-root': 'true' } });
  chatProse.append(env.makeEl('p', { text: 'Settings' }));
  const convView = env.makeEl('div', { attrs: { 'data-testid': 'conversation-view' } });
  const chatPara = env.makeEl('p', { text: 'Settings' });
  const chatBtn = env.makeEl('button', { text: 'Copy' });
  convView.append(chatPara, chatBtn);

  env.doc.body.append(
    prismSec,
    prismCls,
    prismAttr,
    codeEl,
    preEl,
    monacoEl,
    inputEl,
    editableEl,
    modelTrigger,
    modelPanel,
    effortEl,
    chatProse,
    convView
  );

  const inst = runtime.mountHostI18n({ root: env.win, doc: env.doc, dict, mode: 'on' });
  assert.equal(prismSec.textContent, 'Settings');
  assert.equal(prismCls.textContent, 'Save');
  assert.equal(prismAttr.textContent, 'Copy');
  assert.equal(codeEl.textContent, 'Settings');
  assert.equal(preEl.textContent, 'Save');
  assert.equal(monacoEl.textContent, 'Copy');
  assert.equal(editableEl.textContent, 'Settings');
  assert.equal(modelTrigger.textContent, 'Auto');
  assert.equal(modelPanel.textContent, 'Auto');
  assert.equal(effortEl.textContent, 'Settings');
  assert.equal(chatProse.textContent, 'Settings');
  assert.equal(chatPara.textContent, 'Settings');
  assert.equal(chatBtn.textContent, '复制', 'Interactive host action button in conversation chrome still translates');

  inst.destroy();
  assert.equal(chatBtn.textContent, 'Copy');
});

test('0fps hibernation on document.hidden / window blur and resume scan on focus', () => {
  const env = createTestEnv(1000);
  const dict = { exact: { Settings: '设置', Save: '保存' }, patterns: [] };

  const btn1 = env.makeEl('button', { text: 'Settings' });
  env.doc.body.append(btn1);

  const inst = runtime.mountHostI18n({
    root: env.win,
    doc: env.doc,
    dict,
    mode: 'on',
    nowFn: env.nowFn,
    setTimeoutFn: env.setTimeoutFn,
    clearTimeoutFn: env.clearTimeoutFn,
    rafFn: env.rafFn,
    cancelRafFn: env.cancelRafFn,
  });
  assert.equal(btn1.textContent, '设置');

  // Hide document -> subsequent mutations must NOT schedule rAF
  env.doc.hidden = true;
  env.doc.dispatchEvent({ type: 'visibilitychange' });
  const btn2 = env.makeEl('button', { text: 'Save' });
  env.doc.body.append(btn2);
  env.advanceTime(100);
  assert.equal(btn2.textContent, 'Save', 'Must not translate while hidden (0fps sleep)');

  // Restore visibility -> automatically catches up
  env.doc.hidden = false;
  env.doc.dispatchEvent({ type: 'visibilitychange' });
  assert.equal(btn2.textContent, '保存');

  // Window blur -> pause, focus -> resume
  env.win.dispatchEvent({ type: 'blur' });
  const btn3 = env.makeEl('button', { text: 'Settings' });
  env.doc.body.append(btn3);
  env.advanceTime(100);
  assert.equal(btn3.textContent, 'Settings');
  env.win.dispatchEvent({ type: 'focus' });
  assert.equal(btn3.textContent, '设置');

  inst.destroy();
});

test('Channel 4 isolation: main bundle < 690 KiB without dict, shouldEnableHostI18n gating, and off mode 0 B fail-closed', () => {
  const mainExpr = cdp.buildInjectExpression(cdp.DEFAULT_CONFIG);
  const mainBytes = Buffer.byteLength(mainExpr, 'utf8');
  assert.ok(mainBytes <= 704000, `Main bundle must stay <= 704,000 B, got ${mainBytes}`);
  assert.ok(mainBytes < 690 * 1024, `Main bundle must stay < 690 KiB, got ${mainBytes}`);
  assert.equal(mainExpr.includes('mountHostI18n'), false, 'Main bundle must NOT contain Channel 4 runtime');
  assert.equal(mainExpr.includes('浏览器子智能体已被您的管理员禁用'), false, 'Main bundle must NOT contain zh-CN.json entries');

  assert.equal(cdp.DEFAULT_CONFIG.hostLocalization, 'auto');
  assert.deepEqual(cdp.VALIDATORS.hostLocalization, ['auto', 'on', 'off']);

  assert.equal(cdp.shouldEnableHostI18n({ hostLocalization: 'off', language: 'zh-CN' }), false);
  assert.equal(cdp.shouldEnableHostI18n({ hostLocalization: 'on', language: 'en' }), true);
  assert.equal(cdp.shouldEnableHostI18n({ hostLocalization: 'auto', language: 'zh-CN' }), true);
  assert.equal(cdp.shouldEnableHostI18n({ hostLocalization: 'auto', language: 'en' }), false);
  assert.equal(cdp.shouldEnableHostI18n({ hostLocalization: 'auto', language: 'zh-TW' }), false);
  assert.equal(cdp.shouldEnableHostI18n({ hostLocalization: 'auto', language: 'auto' }, 'zh-CN'), true);
  assert.equal(cdp.shouldEnableHostI18n({ hostLocalization: 'auto', language: 'auto' }, 'en-US'), false);

  assert.equal(cdp.buildHostI18nExpression({ hostLocalization: 'off', language: 'zh-CN' }), '');
  assert.equal(cdp.buildHostI18nExpression({ hostLocalization: 'auto', language: 'en' }), '');

  const ch4Expr = cdp.buildHostI18nExpression({ hostLocalization: 'auto', language: 'zh-CN' });
  assert.ok(Buffer.byteLength(ch4Expr, 'utf8') > 100000);
  assert.doesNotThrow(() => new vm.Script(ch4Expr));
  assert.doesNotThrow(() => new vm.Script(cdp.HOST_I18N_REMOVE_EXPRESSION));
  assert.ok(cdp.REMOVE_EXPRESSION.includes('__agPrismHostI18n'));

  // Execute Channel 4 expression end-to-end inside isolated VM
  const env = createTestEnv();
  const btn = env.makeEl('button', { text: 'Settings' });
  env.doc.body.append(btn);
  const sandbox = {
    window: env.win,
    globalThis: env.win,
    document: env.doc,
    MutationObserver: env.win.MutationObserver,
    setTimeout: env.setTimeoutFn,
    clearTimeout: env.clearTimeoutFn,
  };
  env.win.window = env.win;
  env.win.globalThis = env.win;
  const res = vm.runInNewContext(ch4Expr, sandbox);
  assert.equal(res.ok, true);
  assert.equal(res.status, 'active');
  assert.equal(btn.textContent, '设置');

  // Remove expression restores DOM cleanly
  vm.runInNewContext(cdp.HOST_I18N_REMOVE_EXPRESSION, sandbox);
  assert.equal(btn.textContent, 'Settings');
});

test('settings-panel renders hostLocalization 3-state control and displays yielded hint when data-ag-prism-host-i18n="yielded"', () => {
  const env = createTestEnv();
  const dialog = env.makeEl('div', { attrs: { role: 'dialog' } });
  const panel = env.makeEl('div', { className: 'p-6' });
  const h2 = env.makeEl('h2', { text: 'Appearance' });
  const anchor = env.makeEl('div', { className: 'space-y-2' });
  panel.append(h2, anchor);
  dialog.append(panel);
  env.doc.body.append(dialog);
  env.doc.documentElement.setAttribute('data-ag-prism-host-i18n', 'yielded');

  const saved = [];
  const origDoc = globalThis.document;
  globalThis.document = env.doc;
  try {
    settingsPanel.mountOrSyncSettingsSection({
      version: '1.0.4',
      getLang: () => 'zh-CN',
      uiText: (l) => i18nLocales.getUiStrings(l),
      isZh: () => true,
      i18nCore,
      formatSettingsSummary: () => 'Obsidian · 白昼冷晶 · 完整',
      resolveSettingRowActiveValue: (k) => (k === 'hostLocalization' ? 'auto' : undefined),
      isSettingButtonMatch: (k, vJson, cur) => vJson === JSON.stringify(cur),
      saveSetting: (k, v) => saved.push([k, v]),
      saveSettingsBatch: () => {},
      getThoughtTranslateMode: () => 'off',
      handledGroupClicks: new WeakSet(),
      runSettingsGroupGlide: () => {},
      runGuardedMut: (fn) => fn(),
    });
  } finally {
    globalThis.document = origDoc;
  }

  const row = env.doc.querySelector('[data-ag-cs-row="hostLocalization"]');
  assert.ok(row, 'hostLocalization row must be rendered in settings-panel');
  const desc = row.querySelector('[data-k="d"]');
  assert.equal(desc.textContent, '已检测外部汉化并自动礼让', `Expected yielded hint, got: ${desc.textContent}`);
  const buttons = row.querySelectorAll('button[data-ag-cs-key="hostLocalization"]');
  assert.equal(buttons.length, 3);
  assert.deepEqual(
    buttons.map((b) => JSON.parse(b.getAttribute('data-ag-cs-val'))),
    ['auto', 'on', 'off']
  );
  assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
});


test('[P0-1] shouldEnableHostI18n resolves LANG=zh_CN.UTF-8 and skips LC_ALL=C.UTF-8 / POSIX fallback', () => {
  const prevLcAll = process.env.LC_ALL;
  const prevLcMsg = process.env.LC_MESSAGES;
  const prevLang = process.env.LANG;
  try {
    process.env.LC_ALL = '';
    process.env.LC_MESSAGES = '';
    process.env.LANG = 'zh_CN.UTF-8';
    assert.equal(cdp.shouldEnableHostI18n({ hostLocalization: 'auto', language: 'auto' }), true);

    process.env.LANG = 'zh_CN.utf8@hans';
    assert.equal(cdp.shouldEnableHostI18n({ hostLocalization: 'auto', language: 'auto' }), true);

    process.env.LANG = 'en_US.UTF-8';
    assert.equal(cdp.shouldEnableHostI18n({ hostLocalization: 'auto', language: 'auto' }), false);

    // LC_ALL=C.UTF-8 must be ignored so Intl fallback or LANG isn't poisoned by POSIX C locale
    const origIntl = Intl.DateTimeFormat;
    Intl.DateTimeFormat = function () {
      return { resolvedOptions: () => ({ locale: 'zh-CN' }) };
    };
    try {
      process.env.LC_ALL = 'C.UTF-8';
      process.env.LC_MESSAGES = 'POSIX';
      process.env.LANG = 'C';
      assert.equal(cdp.shouldEnableHostI18n({ hostLocalization: 'auto', language: 'auto' }), true);
    } finally {
      Intl.DateTimeFormat = origIntl;
    }

    assert.equal(cdp.shouldEnableHostI18n({ hostLocalization: 'auto', language: 'auto' }, 'zh_CN.UTF-8'), true);
    assert.equal(cdp.shouldEnableHostI18n({ hostLocalization: 'auto', language: 'auto' }, 'C.UTF-8'), false);
  } finally {
    if (prevLcAll === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = prevLcAll;
    if (prevLcMsg === undefined) delete process.env.LC_MESSAGES; else process.env.LC_MESSAGES = prevLcMsg;
    if (prevLang === undefined) delete process.env.LANG; else process.env.LANG = prevLang;
  }
});

test('[P0-2 & P1-2] buildHostI18nExpression skips subframes, foreign http localhost without DOM markers, and live localStorage English override', () => {
  const ch4Expr = cdp.buildHostI18nExpression({ hostLocalization: 'auto', language: 'zh-CN' });

  // Subframe guard: window.self !== window.top
  const subEnv = createTestEnv();
  const subWin = { ...subEnv.win, top: {} };
  subWin.self = subWin;
  subWin.window = subWin;
  const subRes = vm.runInNewContext(ch4Expr, {
    window: subWin,
    globalThis: subWin,
    document: subEnv.doc,
    MutationObserver: subEnv.win.MutationObserver,
    setTimeout: subEnv.setTimeoutFn,
    clearTimeout: subEnv.clearTimeoutFn,
  });
  assert.equal(subRes.ok, false);
  assert.equal(subRes.status, 'skipped-subframe');

  // Foreign localhost app without DOM workbench markers
  const foreignEnv = createTestEnv();
  foreignEnv.win.location.href = 'http://127.0.0.1:3000/';
  foreignEnv.win.window = foreignEnv.win;
  foreignEnv.win.globalThis = foreignEnv.win;
  foreignEnv.win.self = foreignEnv.win;
  foreignEnv.win.top = foreignEnv.win;
  const foreignRes = vm.runInNewContext(ch4Expr, {
    window: foreignEnv.win,
    globalThis: foreignEnv.win,
    document: foreignEnv.doc,
    MutationObserver: foreignEnv.win.MutationObserver,
    setTimeout: foreignEnv.setTimeoutFn,
    clearTimeout: foreignEnv.clearTimeoutFn,
  });
  assert.equal(foreignRes.ok, false);
  assert.equal(foreignRes.status, 'skipped-non-host');

  // Live frontend cfg override (disk zh-CN vs frontend localStorage language='en')
  const liveEnEnv = createTestEnv();
  const btn = liveEnEnv.makeEl('button', { text: 'Settings' });
  liveEnEnv.doc.body.append(btn);
  liveEnEnv.win.window = liveEnEnv.win;
  liveEnEnv.win.globalThis = liveEnEnv.win;
  liveEnEnv.win.self = liveEnEnv.win;
  liveEnEnv.win.top = liveEnEnv.win;
  liveEnEnv.win.__agPrism = { getState: () => ({ cfg: { hostLocalization: 'auto', language: 'en' } }) };
  const enRes = vm.runInNewContext(ch4Expr, {
    window: liveEnEnv.win,
    globalThis: liveEnEnv.win,
    document: liveEnEnv.doc,
    MutationObserver: liveEnEnv.win.MutationObserver,
    setTimeout: liveEnEnv.setTimeoutFn,
    clearTimeout: liveEnEnv.clearTimeoutFn,
  });
  assert.equal(enRes.status, 'off');
  assert.equal(enRes.skippedByLiveCfg, true);
  assert.equal(btn.textContent, 'Settings');

  // HOST_I18N_REMOVE_EXPRESSION cleans attribute & factory
  liveEnEnv.doc.documentElement.setAttribute('data-ag-prism-host-i18n', 'active');
  liveEnEnv.win.__agPrismHostI18nFactory = {};
  vm.runInNewContext(cdp.HOST_I18N_REMOVE_EXPRESSION, {
    window: liveEnEnv.win,
    globalThis: liveEnEnv.win,
    document: liveEnEnv.doc,
  });
  assert.equal(liveEnEnv.doc.documentElement.getAttribute('data-ag-prism-host-i18n'), null);
  assert.equal(liveEnEnv.win.__agPrismHostI18nFactory, undefined);

  // buildConfigRefreshExpression includes immediate __agPrismHostI18n destroy on off
  const refreshExpr = cdp.buildConfigRefreshExpression({ hostLocalization: 'off', language: 'zh-CN' });
  assert.ok(refreshExpr.includes('__agPrismHostI18n'));
});

test('[P0-3] sidebar Chinese history titles, project names, editor tabs, title tag, and sidebar-split do NOT false-yield Layer 2a/2b', () => {
  const env = createTestEnv(1000);
  const dict = { exact: { Settings: '设置', Save: '保存', Cancel: '取消' }, patterns: [] };

  const titleEl = env.makeEl('title', { text: '修复前端架构问题 - Antigravity' });
  env.doc.head.append(titleEl);

  const split = env.makeEl('div', { attrs: { 'data-testid': 'sidebar-split' } });
  const sidebar = env.makeEl('aside');
  const projBtn = env.makeEl('button', { attrs: { 'data-testid': 'project-header' }, text: '我的中文项目' });
  const wsSwitch = env.makeEl('button', { attrs: { 'data-testid': 'workspace-switcher' }, text: '测试工作区' });
  const convList = env.makeEl('div', { attrs: { 'data-testid': 'conversation-list-sidebar' } });
  for (const t of ['修复登录逻辑', '优化构建性能', '重构路由系统', '自动模型测试', '账号权限校验']) {
    convList.append(env.makeEl('button', { attrs: { 'data-testid': 'conversation-row-sidebar' }, text: t }));
  }
  const navBtn = env.makeEl('button', { text: 'Settings' });
  const saveBtn = env.makeEl('button', { text: 'Save' });
  const cancelBtn = env.makeEl('button', { text: 'Cancel' });
  // Generic Chinese words containing "模型"/"自动"/"账号" must not trigger exact anchor false-positives
  const userTagBtn = env.makeEl('button', { text: '模型测试记录' });
  const userAutoBtn = env.makeEl('button', { text: '自动生成的标题' });
  sidebar.append(projBtn, wsSwitch, convList, navBtn, saveBtn, cancelBtn, userTagBtn, userAutoBtn);

  const tabs = env.makeEl('div', { className: 'tabs-container' });
  tabs.append(env.makeEl('div', { className: 'tab-label', text: '设计文档.md' }));
  tabs.append(env.makeEl('div', { className: 'tab-label', text: '架构说明.md' }));

  split.append(sidebar, tabs);
  env.doc.body.append(split);

  const inst = runtime.mountHostI18n({
    root: env.win,
    doc: env.doc,
    dict,
    mode: 'auto',
    nowFn: env.nowFn,
    setTimeoutFn: env.setTimeoutFn,
    clearTimeoutFn: env.clearTimeoutFn,
    rafFn: env.rafFn,
    cancelRafFn: env.cancelRafFn,
  });

  assert.equal(inst.getStatus().status, 'active', 'Must NOT yield due to Chinese sidebar/project/tabs');
  assert.equal(navBtn.textContent, '设置');
  assert.equal(saveBtn.textContent, '保存');
  assert.equal(projBtn.textContent, '我的中文项目');
  assert.equal(titleEl.textContent, '修复前端架构问题 - Antigravity');

  // Layer 2b: async loaded Chinese conversation rows within 1200ms must NOT trigger yield!
  env.advanceTime(250);
  const asyncRow1 = env.makeEl('button', { attrs: { 'data-testid': 'conversation-row-sidebar' }, text: '异步加载的中文历史会话一' });
  const asyncRow2 = env.makeEl('button', { attrs: { 'data-testid': 'conversation-row-sidebar' }, text: '异步加载的中文历史会话二' });
  convList.append(asyncRow1, asyncRow2);
  env.advanceTime(100);
  assert.equal(inst.getStatus().status, 'active', 'Layer 2b must ignore async conversation rows');

  inst.destroy();
});

test('[P0-4] detached nodes are pruned from WeakRef trackers and excluded from translatedCount', () => {
  const env = createTestEnv(1000);
  const dict = { exact: { Settings: '设置', Save: '保存', Cancel: '取消' }, patterns: [] };

  const buttons = [];
  for (let i = 0; i < 10; i++) {
    const b = env.makeEl('button', { text: 'Settings' });
    buttons.push(b);
    env.doc.body.append(b);
  }

  const inst = runtime.mountHostI18n({
    root: env.win,
    doc: env.doc,
    dict,
    mode: 'on',
    nowFn: env.nowFn,
    setTimeoutFn: env.setTimeoutFn,
    clearTimeoutFn: env.clearTimeoutFn,
    rafFn: env.rafFn,
    cancelRafFn: env.cancelRafFn,
  });
  assert.equal(inst.getStatus().translatedCount, 10);

  // Detach 6 buttons (SPA route unmount)
  for (let i = 0; i < 6; i++) {
    buttons[i].isConnected = false;
    buttons[i].firstChild.isConnected = false;
  }
  assert.equal(inst.getStatus().translatedCount, 4, 'translatedCount must only count connected nodes');

  // Append disconnected node via mutation -> must not be translated
  const detachedBtn = env.makeEl('button', { text: 'Save' });
  detachedBtn.isConnected = false;
  detachedBtn.firstChild.isConnected = false;
  const liveBtn = env.makeEl('button', { text: 'Cancel' });
  env.doc.body.append(detachedBtn, liveBtn);
  env.advanceTime(50);
  assert.equal(detachedBtn.textContent, 'Save');
  assert.equal(liveBtn.textContent, '取消');
  assert.equal(inst.getStatus().translatedCount, 5);

  inst.destroy();
});

test('[P0-5] React 19 multi-HostText interpolation updates cleanly without tearing sibling text nodes', () => {
  const env = createTestEnv(1000);
  const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor', 'host-i18n', 'zh-CN.json'), 'utf8'));

  // Sibling interpolation: "All " + "3" + "s run as Flash."
  const flashDiv = env.makeEl('div');
  const f1 = env.makeText('All ');
  const f2 = env.makeText('3');
  const f3 = env.makeText('s run as Flash.');
  flashDiv.append(f1, f2, f3);

  // Countdown interpolation: "Resets in " + "5" + " minutes"
  const resetDiv = env.makeEl('div');
  const r1 = env.makeText('Resets in ');
  const r2 = env.makeText('5');
  const r3 = env.makeText(' minutes');
  resetDiv.append(r1, r2, r3);

  env.doc.body.append(flashDiv, resetDiv);

  const inst = runtime.mountHostI18n({
    root: env.win,
    doc: env.doc,
    dict,
    mode: 'on',
    nowFn: env.nowFn,
    setTimeoutFn: env.setTimeoutFn,
    clearTimeoutFn: env.clearTimeoutFn,
    rafFn: env.rafFn,
    cancelRafFn: env.cancelRafFn,
  });

  // f2 & r2 must NOT be cleared to ''
  assert.equal(f2.nodeValue, '3');
  assert.equal(r2.nodeValue, '5');

  // Simulate React updating interpolated numeric HostText nodes
  f2.nodeValue = '5';
  r2.nodeValue = '4';
  env.advanceTime(50);

  assert.equal(f2.nodeValue, '5');
  assert.equal(r2.nodeValue, '4');
  assert.ok(flashDiv.textContent.includes('5'), `Expected 5 in ${flashDiv.textContent}`);
  assert.ok(!resetDiv.textContent.includes('5 分钟后重置4'), `Must not tear into "5 分钟后重置4", got: ${resetDiv.textContent}`);

  inst.destroy();
  assert.equal(f1.nodeValue, 'All ');
  assert.equal(f2.nodeValue, '5');
  assert.equal(f3.nodeValue, 's run as Flash.');
});

test('[P1-A] Layer 3 handles childList (textContent) ping-pong and ignores single 5-button React refresh', () => {
  const env = createTestEnv(5000);
  const dict = {
    exact: { Settings: '设置', Save: '保存', Cancel: '取消', Open: '打开', Close: '关闭', Copy: '复制' },
    patterns: [],
  };

  const buttons = ['Settings', 'Save', 'Cancel', 'Open', 'Close', 'Copy'].map((t) => env.makeEl('button', { text: t }));
  env.doc.body.append(...buttons);

  const inst = runtime.mountHostI18n({
    root: env.win,
    doc: env.doc,
    dict,
    mode: 'on',
    nowFn: env.nowFn,
    setTimeoutFn: env.setTimeoutFn,
    clearTimeoutFn: env.clearTimeoutFn,
    rafFn: env.rafFn,
    cancelRafFn: env.cancelRafFn,
  });

  // Single refresh of 5 buttons (recent.length === 1) must NOT trip global conflict-breaker
  const words = ['Settings', 'Save', 'Cancel', 'Open', 'Close'];
  for (let i = 0; i < 5; i++) {
    buttons[i].textContent = words[i];
  }
  env.advanceTime(50);
  assert.equal(inst.getStatus().status, 'active', 'Single refresh of 5 buttons must NOT trip conflict-breaker');
  assert.equal(buttons[0].textContent, '设置');

  // Genuine childList (textContent) ping-pong 3 times on buttons[0] -> exempts buttons[0] without killing others
  for (let r = 0; r < 2; r++) {
    buttons[0].textContent = 'Settings';
    env.advanceTime(50);
  }
  assert.equal(inst.getStatus().status, 'active');
  assert.equal(buttons[0].textContent, 'Settings', '3-time childList ping-pong must exempt element');
  assert.equal(buttons[5].textContent, '复制');

  inst.destroy();
});

test('[P1-B] expanded safety boundaries block pills, thinking trigger, orchestrator selector, ces-/ag-anim-, and deep >128 trees', () => {
  const env = createTestEnv();
  const dict = { exact: { Settings: '设置', Save: '保存', Copy: '复制', Auto: '自动' }, patterns: [] };

  const convView = env.makeEl('div', { attrs: { 'data-testid': 'conversation-view' } });
  const pillBtn = env.makeEl('button', { attrs: { 'data-testid': 'entity-pill' }, text: 'Settings' });
  const thinkTrigger = env.makeEl('button', { attrs: { 'data-testid': 'thinking-collapsible-trigger' }, text: 'Save' });
  const msgBubble = env.makeEl('div', { attrs: { 'data-testid': 'user-message-bubble' } });
  msgBubble.append(env.makeEl('button', { text: 'Settings' }));
  const realChromeBtn = env.makeEl('button', { text: 'Copy' });
  convView.append(pillBtn, thinkTrigger, msgBubble, realChromeBtn);

  const orchSel = env.makeEl('button', { attrs: { 'data-testid': 'model-selector-orchestrator' }, text: 'Auto' });
  const cesBox = env.makeEl('div', { className: 'ces-panel' });
  cesBox.append(env.makeEl('span', { text: 'Settings' }));
  const animBox = env.makeEl('div', { className: 'ag-anim-badge' });
  animBox.append(env.makeEl('span', { text: 'Save' }));

  // Deep >128-level tree -> Fail-Closed
  let deepRoot = env.makeEl('div');
  let cur = deepRoot;
  for (let i = 0; i < 132; i++) {
    const nxt = env.makeEl('div');
    cur.append(nxt);
    cur = nxt;
  }
  const deepLeaf = env.makeEl('span', { text: 'Settings' });
  cur.append(deepLeaf);

  env.doc.body.append(convView, orchSel, cesBox, animBox, deepRoot);

  const inst = runtime.mountHostI18n({ root: env.win, doc: env.doc, dict, mode: 'on' });
  assert.equal(pillBtn.textContent, 'Settings');
  assert.equal(thinkTrigger.textContent, 'Save');
  assert.equal(msgBubble.textContent, 'Settings');
  assert.equal(orchSel.textContent, 'Auto');
  assert.equal(cesBox.textContent, 'Settings');
  assert.equal(animBox.textContent, 'Save');
  assert.equal(deepLeaf.textContent, 'Settings', '>128 depth must Fail-Closed');
  assert.equal(realChromeBtn.textContent, '复制');

  inst.destroy();
});

test('[P1-C, P1-D, P1-E, P1-F] hover trailing tooltip, post-1200ms observer hibernation, yielded destroy(), and attribute dynamic switch', () => {
  const env = createTestEnv(1000);
  const dict = { exact: { Settings: '设置', Save: '保存', Expand: '展开', Collapse: '收起', Copy: '复制' }, patterns: [] };

  const rootApp = env.makeEl('div', { id: 'root' });
  const bigParent = env.makeEl('div');
  for (let i = 0; i < 10; i++) bigParent.append(env.makeEl('span', { text: `Item ${i}` }));
  const hoverBtn = env.makeEl('button', { text: 'Settings', attrs: { 'aria-label': 'Expand' } });
  bigParent.append(hoverBtn);
  rootApp.append(bigParent);
  env.doc.body.append(rootApp);

  const inst = runtime.mountHostI18n({
    root: env.win,
    doc: env.doc,
    dict,
    mode: 'on',
    nowFn: env.nowFn,
    setTimeoutFn: env.setTimeoutFn,
    clearTimeoutFn: env.clearTimeoutFn,
    rafFn: env.rafFn,
    cancelRafFn: env.cancelRafFn,
  });

  // [P1-F] Host dynamically changes attribute from 'Expand' (translated '展开') to 'Collapse' -> '收起'
  hoverBtn.setAttribute('aria-label', 'Collapse');
  inst.scan();
  assert.equal(hoverBtn.getAttribute('aria-label'), '收起');

  // [P1-C] Rapid hover within 120ms schedules trailing timer for delayed tooltip
  env.doc.dispatchEvent({ type: 'pointerenter', target: hoverBtn });
  env.advanceTime(30);
  const tooltip = env.makeEl('div', { attrs: { role: 'tooltip' }, text: 'Copy' });
  env.doc.body.append(tooltip);
  env.doc.dispatchEvent({ type: 'pointerenter', target: hoverBtn });
  env.advanceTime(200);
  assert.equal(tooltip.textContent, '复制', 'Trailing hover timer must translate delayed tooltip');

  // [P1-D] After 1200ms Layer 2b window, blur disconnects MutationObserver completely
  env.advanceTime(1500);
  env.win.dispatchEvent({ type: 'blur' });
  assert.equal(env.observerInstances[0].connected, false, 'Observer must disconnect on blur after Layer 2b window');
  const hiddenBtn = env.makeEl('button', { text: 'Save' });
  env.doc.body.append(hiddenBtn);
  env.advanceTime(100);
  assert.equal(hiddenBtn.textContent, 'Save');
  env.win.dispatchEvent({ type: 'focus' });
  assert.equal(env.observerInstances[0].connected, true, 'Observer must reconnect on focus');
  assert.equal(hiddenBtn.textContent, '保存');

  // [P1-F] destroy() restores dynamic attribute to 'Collapse', NOT stale 'Expand'
  inst.destroy();
  assert.equal(hoverBtn.getAttribute('aria-label'), 'Collapse');

  // [P1-E] yielded state destroy() resets status and root attribute to 'off'
  const yEnv = createTestEnv();
  yEnv.win.__AGY_I18N_INITIALIZED__ = true;
  const yInst = runtime.mountHostI18n({ root: yEnv.win, doc: yEnv.doc, dict, mode: 'auto' });
  assert.equal(yInst.getStatus().status, 'yielded');
  assert.equal(yEnv.doc.documentElement.getAttribute('data-ag-prism-host-i18n'), 'yielded');
  yInst.destroy();
  assert.equal(yInst.getStatus().status, 'off');
  assert.equal(yInst.getStatus().yielded, false);
  assert.equal(yEnv.doc.documentElement.getAttribute('data-ag-prism-host-i18n'), 'off');

  // Re-mounting over existing instance destroys old instance cleanly
  const yInst2 = runtime.mountHostI18n({ root: yEnv.win, doc: yEnv.doc, dict, mode: 'on' });
  assert.equal(yInst2.getStatus().status, 'active');
  yInst2.destroy();
});

test('[P1-1 & P2-1] settings-panel shows yield hint only when mode=auto, and daemon verifyAndHealEntry heals missing hostI18nScriptId & checks evalRes.ok', () => {
  const env = createTestEnv();
  const dialog = env.makeEl('div', { attrs: { role: 'dialog' } });
  const panel = env.makeEl('div', { className: 'p-6' });
  panel.append(env.makeEl('h2', { text: 'Appearance' }), env.makeEl('div', { className: 'space-y-2' }));
  dialog.append(panel);
  env.doc.body.append(dialog);
  env.doc.documentElement.setAttribute('data-ag-prism-host-i18n', 'yielded');

  const origDoc = globalThis.document;
  globalThis.document = env.doc;
  try {
    settingsPanel.mountOrSyncSettingsSection({
      version: '1.0.4',
      getLang: () => 'zh-CN',
      uiText: (l) => i18nLocales.getUiStrings(l),
      isZh: () => true,
      i18nCore,
      formatSettingsSummary: () => 'Obsidian · 白昼冷晶 · 完整',
      resolveSettingRowActiveValue: (k) => (k === 'hostLocalization' ? 'off' : undefined),
      isSettingButtonMatch: (k, vJson, cur) => vJson === JSON.stringify(cur),
      saveSetting: () => {},
      saveSettingsBatch: () => {},
      getThoughtTranslateMode: () => 'off',
      handledGroupClicks: new WeakSet(),
      runSettingsGroupGlide: () => {},
      runGuardedMut: (fn) => fn(),
    });
  } finally {
    globalThis.document = origDoc;
  }

  const descOff = env.doc.querySelector('[data-ag-cs-row="hostLocalization"] [data-k="d"]').textContent;
  assert.equal(descOff.includes('自动礼让'), false, 'Yield hint must NOT appear when hostLocalization=off');

  const daemonSrc = fs.readFileSync(path.join(ROOT, 'sidecars', 'daemon', 'main.mjs'), 'utf8');
  assert.ok(daemonSrc.includes('!probe.hasHostI18n || !entry.hostI18nScriptId'));
  assert.ok(daemonSrc.includes('if (evalRes && evalRes.ok)'));
});

test('[P2-2 & P2-4] ReDoS patterns complete in linear time, English sentences are uncorrupted, and __proto__ text is safe', () => {
  const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor', 'host-i18n', 'zh-CN.json'), 'utf8'));
  const engine = runtime.createHostI18nEngine(dict);

  // Ordinary English sentences must not be partially corrupted by anchored patterns #52-#56, #79, #142, #143
  assert.equal(engine.translate('Build takes 5 minutes to finish'), null);
  assert.equal(engine.translate('My task finished'), null);
  assert.equal(engine.translate('When ready, It requires Docker to be installed.'), null);
  assert.equal(engine.translate('5 minutes'), '5 分钟');
  assert.equal(engine.translate('Timer has expired'), '定时器已到期');
  assert.equal(engine.translate('It requires Docker Desktop to be installed.'), '需要安装 Docker Desktop 才能运行。');

  // ReDoS adversarial input stress test (< 50ms)
  const t0 = performance.now();
  assert.equal(engine.translate(' '.repeat(30000) + 'X'), null);
  assert.equal(engine.translate('It requires ' + 'a '.repeat(5000) + 'X'), null);
  assert.equal(engine.translate('Save ' + 'a '.repeat(5000) + 'Ctrl+S'), null);
  assert.equal(engine.translate('Settings' + ' '.repeat(600)), null);
  for (const idx of [52, 53, 54, 55, 56, 79, 83, 142, 143]) {
    const re = new RegExp(dict.patterns[idx].regex);
    re.test(' '.repeat(30000) + 'finished');
    re.test('It requires ' + 'a '.repeat(2000) + '!');
  }
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 100, `ReDoS stress test took too long: ${elapsed.toFixed(2)}ms`);

  // __proto__ text must not crash or misbehave in Layer 2 or engine
  const env = createTestEnv();
  const nav = env.makeEl('nav');
  nav.append(env.makeEl('button', { text: '__proto__' }), env.makeEl('button', { text: 'constructor' }));
  env.doc.body.append(nav);
  const inst = runtime.mountHostI18n({ root: env.win, doc: env.doc, dict, mode: 'auto' });
  assert.equal(inst.getStatus().status, 'active');
  assert.equal(engine.translate('__proto__'), null);
  inst.destroy();
});
