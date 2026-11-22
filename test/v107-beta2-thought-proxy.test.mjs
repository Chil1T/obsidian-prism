import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  ThoughtTranslatorService,
  parseProxyUrl,
  validateProxyUrl,
  maskProxyUrl,
  parseWindowsRegProxyOutput,
  parseMacScutilProxyOutput,
  resolveSystemProxy,
  isAlreadyTargetLang,
  splitOversizedThought,
  protectToolSummaryIdentifiers,
  restoreToolSummaryIdentifiers,
  isToolSummaryTranslatable,
  redactSecrets,
} from '../vendor/thought-translator/translator-service.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// ── Lightweight DOM mock (supports MutationObserver, visibilitychange, classList, nextElementSibling) ──
function createMockDomEnv(extraGlobals = {}) {
  const listenersByNode = new WeakMap();
  const docListeners = new Map();
  const observers = [];
  let doc = null;

  const notifyObservers = (target, type, extra = {}) => {
    for (const obs of observers) {
      if (!obs.active || !obs.target) continue;
      let cur = target;
      let hit = false;
      while (cur) {
        if (cur === obs.target) {
          hit = true;
          break;
        }
        if (!obs.opts?.subtree) break;
        cur = cur.parentElement;
      }
      if (!hit) continue;
      if (type === 'attributes' && !obs.opts?.attributes) continue;
      if (type === 'attributes' && obs.opts?.attributeFilter && !obs.opts.attributeFilter.includes(extra.attributeName)) continue;
      if (type === 'characterData' && !obs.opts?.characterData) continue;
      if (type === 'childList' && !obs.opts?.childList) continue;
      obs.cb([{ type, target, ...extra }]);
    }
  };

  class MockMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.target = null;
      this.opts = null;
      this.active = false;
      observers.push(this);
    }
    observe(target, opts = {}) {
      this.target = target;
      this.opts = opts;
      this.active = true;
    }
    disconnect() {
      this.active = false;
      this.target = null;
    }
  }

  function makeClassList(el) {
    const getList = () => String(el.className || '').split(/\s+/).filter(Boolean);
    return {
      contains: (c) => getList().includes(c),
      add: (...cs) => {
        const s = new Set(getList());
        cs.forEach((c) => c && s.add(c));
        el.className = Array.from(s).join(' ');
        notifyObservers(el, 'attributes', { attributeName: 'class' });
      },
      remove: (...cs) => {
        const s = new Set(getList());
        cs.forEach((c) => s.delete(c));
        el.className = Array.from(s).join(' ');
        notifyObservers(el, 'attributes', { attributeName: 'class' });
      },
    };
  }

  function matchSimpleSelector(el, sel) {
    if (!el || el.nodeType !== 1) return false;
    const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      let ok = true;
      let rest = part;
      const tagM = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(rest);
      if (tagM) {
        if (String(el.tagName || '').toUpperCase() !== tagM[1].toUpperCase()) ok = false;
        rest = rest.slice(tagM[0].length);
      }
      const clsMatches = rest.match(/\.[A-Za-z0-9_-]+/g) || [];
      for (const cm of clsMatches) {
        if (!el.classList.contains(cm.slice(1))) ok = false;
      }
      const attrRe = /\[([a-zA-Z0-9_-]+)(?:(\*?=)"([^"]*)")?\]/g;
      let am;
      while ((am = attrRe.exec(rest)) !== null) {
        const val = el.getAttribute(am[1]);
        if (am[2] === '=') {
          if (val !== am[3]) ok = false;
        } else if (am[2] === '*=') {
          if (!String(val || '').includes(am[3])) ok = false;
        } else if (val === null) {
          ok = false;
        }
      }
      if (ok) return true;
    }
    return false;
  }

  function createTextNode(str) {
    let val = String(str ?? '');
    const tn = {
      nodeType: 3,
      parentElement: null,
      ownerDocument: null,
      get isConnected() {
        let cur = tn.parentElement;
        while (cur) {
          if (cur === rootBody || cur === docEl) return true;
          cur = cur.parentElement;
        }
        return false;
      },
      get nodeValue() {
        return val;
      },
      set nodeValue(v) {
        val = String(v ?? '');
        notifyObservers(tn, 'characterData');
      },
      get textContent() {
        return val;
      },
      set textContent(v) {
        val = String(v ?? '');
        notifyObservers(tn, 'characterData');
      },
      appendData(d) {
        val += String(d ?? '');
        notifyObservers(tn, 'characterData');
      },
    };
    return tn;
  }

  function createElement(tag, initAttrs = {}) {
    const attrs = new Map();
    const childNodes = [];
    let classNameVal = '';
    const styleObj = {
      removeProperty(k) {
        delete this[k];
        if (k === 'min-height') delete this.minHeight;
      },
    };

    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      parentElement: null,
      ownerDocument: null,
      childNodes,
      style: styleObj,
      hidden: false,
      disabled: false,
      value: '',
      title: '',
      placeholder: '',
      type: '',
      scrollTop: 0,
      offsetHeight: 40,
      get children() {
        return childNodes.filter((n) => n.nodeType === 1);
      },
      get firstChild() {
        return childNodes[0] || null;
      },
      get nextElementSibling() {
        const p = el.parentElement;
        if (!p) return null;
        const sibs = p.children;
        const idx = sibs.indexOf(el);
        return idx >= 0 && idx + 1 < sibs.length ? sibs[idx + 1] : null;
      },
      get previousElementSibling() {
        const p = el.parentElement;
        if (!p) return null;
        const sibs = p.children;
        const idx = sibs.indexOf(el);
        return idx > 0 ? sibs[idx - 1] : null;
      },
      get isConnected() {
        if (el === rootBody || el === docEl) return true;
        let cur = el.parentElement;
        while (cur) {
          if (cur === rootBody || cur === docEl) return true;
          cur = cur.parentElement;
        }
        return false;
      },
      get className() {
        return classNameVal;
      },
      set className(v) {
        classNameVal = String(v || '');
        attrs.set('class', classNameVal);
        notifyObservers(el, 'attributes', { attributeName: 'class' });
      },
      get textContent() {
        return childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join('');
      },
      set textContent(v) {
        childNodes.length = 0;
        if (v !== '' && v !== null && v !== undefined) {
          const tn = createTextNode(v);
          tn.parentElement = el;
          tn.ownerDocument = doc;
          childNodes.push(tn);
        }
        notifyObservers(el, 'childList');
      },
      getAttribute(k) {
        if (k === 'class') return attrs.has('class') ? attrs.get('class') : classNameVal || null;
        return attrs.has(k) ? attrs.get(k) : null;
      },
      setAttribute(k, v) {
        const sv = String(v);
        attrs.set(k, sv);
        if (k === 'class') classNameVal = sv;
        notifyObservers(el, 'attributes', { attributeName: k });
      },
      removeAttribute(k) {
        attrs.delete(k);
        if (k === 'class') classNameVal = '';
        notifyObservers(el, 'attributes', { attributeName: k });
      },
      hasAttribute(k) {
        return attrs.has(k);
      },
      toggleAttribute(k, force) {
        const next = force !== undefined ? Boolean(force) : !attrs.has(k);
        if (next) el.setAttribute(k, '');
        else el.removeAttribute(k);
        return next;
      },
      appendChild(child) {
        if (!child) return child;
        if (child.parentElement && child.parentElement !== el) {
          child.parentElement.removeChild(child);
        } else if (child.parentElement === el) {
          const idx = childNodes.indexOf(child);
          if (idx >= 0) childNodes.splice(idx, 1);
        }
        child.parentElement = el;
        child.ownerDocument = doc;
        childNodes.push(child);
        notifyObservers(el, 'childList');
        return child;
      },
      insertBefore(child, ref) {
        if (!child) return child;
        if (child.parentElement) child.parentElement.removeChild(child);
        child.parentElement = el;
        child.ownerDocument = doc;
        const idx = ref ? childNodes.indexOf(ref) : -1;
        if (idx >= 0) childNodes.splice(idx, 0, child);
        else childNodes.push(child);
        notifyObservers(el, 'childList');
        return child;
      },
      removeChild(child) {
        const idx = childNodes.indexOf(child);
        if (idx >= 0) {
          childNodes.splice(idx, 1);
          child.parentElement = null;
          notifyObservers(el, 'childList');
        }
        return child;
      },
      remove() {
        if (el.parentElement) el.parentElement.removeChild(el);
      },
      addEventListener(ev, fn) {
        let mp = listenersByNode.get(el);
        if (!mp) listenersByNode.set(el, (mp = new Map()));
        if (!mp.has(ev)) mp.set(ev, []);
        mp.get(ev).push(fn);
      },
      removeEventListener(ev, fn) {
        const arr = listenersByNode.get(el)?.get(ev);
        if (!arr) return;
        const idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
      },
      dispatch(ev, payload = {}) {
        const arr = listenersByNode.get(el)?.get(ev) || [];
        const eventObj = {
          type: ev,
          target: el,
          preventDefault() {},
          stopPropagation() {},
          ...payload,
        };
        for (const fn of Array.from(arr)) fn(eventObj);
      },
      click() {
        el.dispatch('click');
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.children || []) {
            if (matchSimpleSelector(c, sel)) out.push(c);
            walk(c);
          }
        };
        walk(el);
        return out;
      },
      querySelector(sel) {
        return el.querySelectorAll(sel)[0] || null;
      },
      closest(sel) {
        let cur = el;
        while (cur && cur.nodeType === 1) {
          if (matchSimpleSelector(cur, sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      getBoundingClientRect() {
        return el._boundingRect || { top: 80, bottom: 160, left: 20, right: 620, width: 600, height: 80 };
      },
    };
    el.classList = makeClassList(el);
    for (const [k, v] of Object.entries(initAttrs)) el.setAttribute(k, v);
    return el;
  }

  const docEl = createElement('html');
  docEl.clientHeight = 900;
  docEl.clientWidth = 1440;
  const rootBody = createElement('body');
  docEl.appendChild(rootBody);

  const storageMap = new Map();
  const localStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
    clear: () => storageMap.clear(),
  };

  doc = {
    documentElement: docEl,
    body: rootBody,
    hidden: false,
    visibilityState: 'visible',
    createElement: (tag, attrs) => {
      const e = createElement(tag, attrs);
      e.ownerDocument = doc;
      return e;
    },
    createTextNode: (str) => {
      const tn = createTextNode(str);
      tn.ownerDocument = doc;
      return tn;
    },
    querySelectorAll: (sel) => docEl.querySelectorAll(sel),
    querySelector: (sel) => docEl.querySelector(sel),
    addEventListener(ev, fn) {
      if (!docListeners.has(ev)) docListeners.set(ev, []);
      docListeners.get(ev).push(fn);
    },
    removeEventListener(ev, fn) {
      const arr = docListeners.get(ev);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    dispatchDocEvent(ev) {
      for (const fn of Array.from(docListeners.get(ev) || [])) fn({ type: ev });
    },
  };
  docEl.ownerDocument = doc;
  rootBody.ownerDocument = doc;

  const sandbox = {
    document: doc,
    localStorage,
    innerHeight: 900,
    innerWidth: 1440,
    console,
    URL,
    Date,
    Math,
    Set,
    Map,
    WeakMap,
    RegExp,
    JSON,
    Promise,
    Number,
    String,
    Boolean,
    Array,
    Object,
    setTimeout,
    clearTimeout,
    MutationObserver: MockMutationObserver,
    ...extraGlobals,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return { doc, docEl, rootBody, sandbox, observers };
}

// ── Local RFC 1928 + RFC 1929 SOCKS5 mock server (pure node:net) ──
function createMockSocks5Server({ requireAuth = null, routeMap, onConnectEvent = null, onTlsPeek = null }) {
  const activeSockets = new Set();
  const track = (s) => {
    activeSockets.add(s);
    s.once('close', () => activeSockets.delete(s));
  };

  const server = net.createServer((clientSock) => {
    track(clientSock);
    let stage = 'greeting';
    let buf = Buffer.alloc(0);
    let authUser = '';

    const closeClient = () => {
      clientSock.on('error', () => {});
      try {
        clientSock.destroy();
      } catch {}
    };

    const onData = (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
      while (true) {
        if (stage === 'greeting') {
          if (buf.length < 2) return;
          const ver = buf[0];
          const nMethods = buf[1];
          if (buf.length < 2 + nMethods) return;
          const methods = Array.from(buf.subarray(2, 2 + nMethods));
          buf = buf.subarray(2 + nMethods);
          if (ver !== 0x05) return closeClient();
          if (requireAuth) {
            if (!methods.includes(0x02)) {
              clientSock.write(Buffer.from([0x05, 0xff]));
              return closeClient();
            }
            stage = 'auth';
            clientSock.write(Buffer.from([0x05, 0x02]));
          } else {
            if (!methods.includes(0x00)) {
              clientSock.write(Buffer.from([0x05, 0xff]));
              return closeClient();
            }
            stage = 'request';
            clientSock.write(Buffer.from([0x05, 0x00]));
          }
        } else if (stage === 'auth') {
          if (buf.length < 2) return;
          const aVer = buf[0];
          const uLen = buf[1];
          if (buf.length < 2 + uLen + 1) return;
          const user = buf.subarray(2, 2 + uLen).toString('utf8');
          const pLen = buf[2 + uLen];
          if (buf.length < 2 + uLen + 1 + pLen) return;
          const pass = buf.subarray(3 + uLen, 3 + uLen + pLen).toString('utf8');
          buf = buf.subarray(3 + uLen + pLen);
          if (aVer !== 0x01 || user !== requireAuth.username || pass !== requireAuth.password) {
            clientSock.write(Buffer.from([0x01, 0x01]));
            return closeClient();
          }
          authUser = user;
          stage = 'request';
          clientSock.write(Buffer.from([0x01, 0x00]));
        } else if (stage === 'request') {
          if (buf.length < 4) return;
          const ver = buf[0];
          const cmd = buf[1];
          const atyp = buf[3];
          if (ver !== 0x05 || cmd !== 0x01) {
            clientSock.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            return closeClient();
          }
          let host = '';
          let headerLen = 0;
          if (atyp === 0x01) {
            if (buf.length < 10) return;
            host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
            headerLen = 10;
          } else if (atyp === 0x03) {
            if (buf.length < 5) return;
            const dLen = buf[4];
            if (buf.length < 5 + dLen + 2) return;
            host = buf.subarray(5, 5 + dLen).toString('utf8');
            headerLen = 5 + dLen + 2;
          } else if (atyp === 0x04) {
            if (buf.length < 22) return;
            host = '::1';
            headerLen = 22;
          } else {
            clientSock.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            return closeClient();
          }
          const port = buf.readUInt16BE(headerLen - 2);
          const remainder = buf.subarray(headerLen);
          buf = Buffer.alloc(0);

          if (onConnectEvent) onConnectEvent({ atyp, host, port, authUser });

          const route = routeMap(host, port);
          if (!route) {
            clientSock.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            return closeClient();
          }

          clientSock.removeListener('data', onData);
          if (route.mode === 'tls-peek') {
            clientSock.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]));
            const handlePeek = (firstChunk) => {
              if (onTlsPeek) onTlsPeek(Buffer.from(firstChunk));
              closeClient();
            };
            if (remainder.length > 0) handlePeek(remainder);
            else clientSock.once('data', handlePeek);
            return;
          }

          const upstream = net.connect({ host: route.host, port: route.port }, () => {
            clientSock.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]));
            if (remainder.length > 0) upstream.write(remainder);
            clientSock.pipe(upstream);
            upstream.pipe(clientSock);
          });
          track(upstream);
          upstream.on('error', () => {
            try {
              clientSock.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            } catch {}
            closeClient();
          });
          clientSock.on('close', () => {
            if (!upstream.destroyed) upstream.destroy();
          });
          upstream.on('close', () => {
            if (!clientSock.destroyed) clientSock.destroy();
          });
          return;
        }
      }
    };

    clientSock.on('data', onData);
    clientSock.on('error', () => {});
  });

  return { server, activeSockets };
}

test('1) cdp.js: merges PR #20 nav-outline-trigger cleanup, excludes thought from RUNTIME_PARTS, and aligns Channel 5 queued/streaming timeouts', () => {
  const cdp = require(path.join(ROOT_DIR, 'cdp.js'));

  assert.equal(
    cdp.RUNTIME_PARTS.some((p) => p.includes('thought-translator')),
    false,
    'Channel 1 RUNTIME_PARTS must never contain any thought-translator file'
  );
  assert.ok(
    cdp.REMOVE_EXPRESSION.includes('.ag-cs-nav-outline-trigger'),
    'REMOVE_EXPRESSION must clean up PR #20 .ag-cs-nav-outline-trigger'
  );
  assert.ok(
    cdp.REMOVE_EXPRESSION.includes('[data-testid="prism-thought-general-config"]'),
    'REMOVE_EXPRESSION must clean up machine-mode companion config card'
  );
  assert.ok(
    cdp.THOUGHT_REMOVE_EXPRESSION.includes('[data-testid="prism-thought-general-config"]'),
    'THOUGHT_REMOVE_EXPRESSION must clean up machine-mode companion config card'
  );

  // Verify dynamic queue timeout & onChunk timeout refresh inside compiled Channel 1 Thought Bridge
  const scheduledTimeouts = [];
  const clearedIds = [];
  let timerIdSeq = 0;
  const bindingPayloads = [];
  const { sandbox } = createMockDomEnv({
    __agPrismThoughtCall: (jsonStr) => {
      bindingPayloads.push(JSON.parse(jsonStr));
    },
    setTimeout: (fn, ms) => {
      const id = ++timerIdSeq;
      scheduledTimeouts.push({ id, ms, fn });
      return id;
    },
    clearTimeout: (id) => {
      if (id) clearedIds.push(id);
    },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    performance: { now: () => Date.now() },
  });

  // Extract ensureThoughtBridge via real buildInjectExpression
  const injectExpr = cdp.buildInjectExpression(cdp.DEFAULT_CONFIG);
  vm.runInNewContext(injectExpr, sandbox);
  const bridge = sandbox.window.__agPrismThoughtBridge;
  assert.ok(bridge && typeof bridge.translateStream === 'function', 'Channel 1 must mount __agPrismThoughtBridge');

  scheduledTimeouts.length = 0;
  clearedIds.length = 0;
  const partials = [];
  const p1 = bridge.translateStream({ text: 'Thought 1', mode: 'ai' }, (s) => partials.push(s));
  const p2 = bridge.translateStream({ text: 'Thought 2', mode: 'ai' }, () => {});
  const p3 = bridge.translateStream({ text: 'Thought 3', mode: 'ai' }, () => {});
  const p4 = bridge.translateStream({ text: 'Thought 4 (queued behind 3 slots)', mode: 'ai' }, () => {});

  const timeoutsFor4 = scheduledTimeouts.map((t) => t.ms);
  assert.ok(timeoutsFor4[0] >= 90000, `1st request timeout should be >= 90000ms, got ${timeoutsFor4[0]}`);
  assert.ok(
    timeoutsFor4[3] >= 120000,
    `4th queued request timeout must scale up (>= 120000ms) so MAX_CONCURRENCY=3 queue never falsely times out at 50s, got ${timeoutsFor4[3]}`
  );

  // Streaming chunk on req #1 must refresh timer (clear old timer & arm fresh 60s timer)
  const req1Id = bindingPayloads[0].id;
  const beforeChunkCount = scheduledTimeouts.length;
  bridge.onChunk(req1Id, '正在流式翻译…');
  assert.equal(partials[0], '正在流式翻译…');
  assert.ok(scheduledTimeouts.length > beforeChunkCount, 'onChunk progress must re-arm timeout timer');
  assert.equal(scheduledTimeouts[scheduledTimeouts.length - 1].ms, 60000, 'onChunk refresh timer should be 60000ms');

  bridge.dispose();
  assert.ok(p1 && p2 && p3 && p4);
});

test('2) Native Node SOCKS5/SOCKS5H tunnel: RFC 1928 no-auth, RFC 1929 auth + remote DNS, TLS-over-SOCKS5, credential redaction & zero socket leaks', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-socks5-e2e-'));
  const targetSockets = new Set();
  const seenTargetHeaders = [];

  const targetServer = http.createServer((req, res) => {
    seenTargetHeaders.push({ url: req.url, headers: { ...req.headers } });
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'socks5-routed-model' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write('data: {"choices":[{"delta":{"content":"SOCKS5 "}}]}\n\n');
      setTimeout(() => {
        if (!res.writableEnded) {
          res.write('data: {"choices":[{"delta":{"content":"流式成功"}}]}\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        }
      }, 15);
      return;
    }
    if (req.url === '/hang') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('wait');
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  targetServer.on('connection', (s) => {
    targetSockets.add(s);
    s.once('close', () => targetSockets.delete(s));
  });
  await new Promise((r) => targetServer.listen(0, '127.0.0.1', r));
  const targetPort = targetServer.address().port;

  const noAuthConnects = [];
  const noAuthSocks = createMockSocks5Server({
    requireAuth: null,
    routeMap: (host) =>
      host === 'external.socks5-noauth.test' ? { host: '127.0.0.1', port: targetPort } : null,
    onConnectEvent: (e) => noAuthConnects.push(e),
  });
  await new Promise((r) => noAuthSocks.server.listen(0, '127.0.0.1', r));
  const noAuthPort = noAuthSocks.server.address().port;

  const secretUser = 'prismSocksUser';
  const secretPass = 'S3cr3t@Pass#99';
  const authConnects = [];
  const tlsHellos = [];
  const authSocks = createMockSocks5Server({
    requireAuth: { username: secretUser, password: secretPass },
    routeMap: (host) => {
      if (host === 'external.socks5-auth.test') return { host: '127.0.0.1', port: targetPort };
      if (host === 'external.socks5-tls.test') return { mode: 'tls-peek' };
      return null;
    },
    onConnectEvent: (e) => authConnects.push(e),
    onTlsPeek: (buf) => tlsHellos.push(buf),
  });
  await new Promise((r) => authSocks.server.listen(0, '127.0.0.1', r));
  const authPort = authSocks.server.address().port;

  try {
    // A) RFC 1928 no-auth SOCKS5 HTTP forwarding (no Proxy-Authorization leaked to target)
    const svcNoAuth = new ThoughtTranslatorService({ configDir: tmpDir, proxyEnv: {} });
    const saveNoAuth = svcNoAuth.saveConfig({
      customProxyUrl: `socks5://127.0.0.1:${noAuthPort}`,
      profiles: [{ id: 'default', name: 'S5', baseUrl: 'http://external.socks5-noauth.test/v1', apiKey: 'sk-s5-1', model: 'm1' }],
    });
    assert.equal(saveNoAuth.ok, true);
    const modelsRes = await svcNoAuth.fetchModels({});
    assert.equal(modelsRes.ok, true, `Expected SOCKS5 no-auth fetchModels ok, got ${modelsRes.error}`);
    assert.deepEqual(modelsRes.models, ['socks5-routed-model']);
    assert.equal(noAuthConnects[0].atyp, 0x03, 'Hostname must use ATYP=0x03 remote domain resolution');
    assert.equal(noAuthConnects[0].host, 'external.socks5-noauth.test');
    assert.equal(seenTargetHeaders[0].headers['proxy-authorization'], undefined, 'Must never leak Proxy-Authorization over SOCKS5');
    svcNoAuth.dispose();

    // B) RFC 1929 username/password auth SOCKS5H + SSE streaming + masked config round-trip
    const encodedPass = encodeURIComponent(secretPass);
    const rawAuthProxy = `socks5h://${secretUser}:${encodedPass}@127.0.0.1:${authPort}`;
    const svcAuth = new ThoughtTranslatorService({ configDir: tmpDir, proxyEnv: {} });
    const saveAuth = svcAuth.saveConfig({
      customProxyUrl: rawAuthProxy,
      profiles: [{ id: 'default', name: 'S5H', baseUrl: 'http://external.socks5-auth.test/v1', apiKey: 'sk-s5-2', model: 'm2' }],
    });
    assert.equal(saveAuth.ok, true);
    assert.equal(saveAuth.hasProxyCredentials, true);
    assert.equal(saveAuth.customProxyUrl.includes(secretPass), false, 'Sanitized config must never expose raw proxy password');
    assert.equal(saveAuth.customProxyUrl.includes(secretUser), false, 'Sanitized config must never expose raw proxy username');
    assert.ok(saveAuth.customProxyUrl.includes('••••@'), 'Sanitized config must return masked sentinel');

    // Saving back the masked sentinel must preserve real credentials seamlessly
    const roundTrip = svcAuth.saveConfig({ customProxyUrl: saveAuth.customProxyUrl });
    assert.equal(roundTrip.ok, true);
    assert.equal(roundTrip.hasProxyCredentials, true);

    const streamChunks = [];
    const trRes = await svcAuth.translateThought({
      text: 'Checking SOCKS5H authenticated streaming translation tunnel end to end.',
      mode: 'ai',
      onPartial: (p) => streamChunks.push(p),
    });
    assert.equal(trRes.ok, true, `Expected SOCKS5H SSE translation ok, got ${trRes.error}`);
    assert.equal(trRes.text, 'SOCKS5 流式成功');
    assert.equal(authConnects[0].authUser, secretUser);

    // C) TLS-over-SOCKS5H: verify real TLS ClientHello + SNI arrives inside authenticated SOCKS5 tunnel
    await assert.rejects(() =>
      svcAuth._request('https://external.socks5-tls.test/v1/models', { method: 'GET', redirect: 'error' })
    );
    assert.equal(tlsHellos.length, 1, 'Expected TLS ClientHello delivered inside SOCKS5H tunnel');
    assert.equal(tlsHellos[0][0], 0x16, 'First byte must be TLS Handshake record (0x16)');
    assert.equal(tlsHellos[0][1], 0x03, 'Second byte must be TLS version major (0x03)');
    assert.ok(
      tlsHellos[0].includes(Buffer.from('external.socks5-tls.test', 'ascii')),
      'TLS-over-SOCKS5 must send target domain in ClientHello SNI'
    );

    // D) AbortSignal cancels in-flight SOCKS5 tunnel cleanly (no leaked sockets)
    const ac = new AbortController();
    const hangPromise = svcAuth._request('http://external.socks5-auth.test/hang', {
      method: 'GET',
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 30);
    const hangRes = await hangPromise.catch((e) => ({ aborted: true, msg: e.message }));
    if (hangRes && !hangRes.aborted && hangRes.text) {
      await assert.rejects(() => hangRes.text());
    }
    svcAuth.dispose();

    // E) Wrong SOCKS5 credentials fail cleanly AND redact username/password from all error text
    const badPass = 'WrongTopSecret777';
    const svcBadAuth = new ThoughtTranslatorService({ configDir: tmpDir, proxyEnv: {} });
    svcBadAuth.saveConfig({
      customProxyUrl: `socks5h://${secretUser}:${badPass}@127.0.0.1:${authPort}`,
      profiles: [{ id: 'default', name: 'Bad', baseUrl: 'http://external.socks5-auth.test/v1', apiKey: 'sk-s5-3', model: 'm3' }],
    });
    const badRes = await svcBadAuth.fetchModels({});
    assert.equal(badRes.ok, false);
    assert.match(badRes.error, /SOCKS5 authentication failed/i);
    assert.equal(badRes.error.includes(secretUser), false, 'Error must redact SOCKS5 username');
    assert.equal(badRes.error.includes(badPass), false, 'Error must redact SOCKS5 password');
    assert.equal(
      redactSecrets(`failed via socks5h://${secretUser}:${badPass}@127.0.0.1:1080`).includes(badPass),
      false,
      'redactSecrets must scrub socks5h:// userinfo'
    );
    svcBadAuth.dispose();

    // F) Strict proxy URL security validation (rejects CRLF, control chars, encoded CRLF, SSRF, bad ports/schemes)
    for (const badProxy of [
      'http://127.0.0.1:7890\r\nX-Injected: 1',
      'socks5://127.0.0.1:1080\n',
      'socks5://user%0d%0a:pass@127.0.0.1:1080',
      'ftp://127.0.0.1:21',
      'socks4://127.0.0.1:1080',
      'socks5://127.0.0.1:0',
      'socks5://127.0.0.1:70000',
      'socks5://169.254.169.254:1080',
      'socks5://metadata.google.internal:1080',
      `socks5://${'a'.repeat(260)}:pass@127.0.0.1:1080`,
    ]) {
      assert.equal(validateProxyUrl(badProxy).ok, false, `Must reject unsafe/malformed proxy: ${JSON.stringify(badProxy)}`);
      assert.equal(parseProxyUrl(badProxy), null);
    }

    // Allow sockets to finish closing cleanly
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(noAuthSocks.activeSockets.size, 0, 'No-auth SOCKS5 server must have 0 leaked sockets');
    assert.equal(authSocks.activeSockets.size, 0, 'Auth SOCKS5 server must have 0 leaked sockets');
  } finally {
    for (const s of [...targetSockets, ...noAuthSocks.activeSockets, ...authSocks.activeSockets]) {
      try { s.destroy(); } catch {}
    }
    await Promise.all([
      new Promise((r) => targetServer.close(r)),
      new Promise((r) => noAuthSocks.server.close(r)),
      new Promise((r) => authSocks.server.close(r)),
    ]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('3) Custom proxy priority, proxyMode (auto/custom/direct), OS SOCKS5 detection, backward compat & instant proxy cache refresh', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-proxy-prio-'));
  try {
    // Legacy config without new fields loads cleanly with safe defaults
    const cfgPath = path.join(tmpDir, 'obsidian-prism-thought.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        version: 1,
        stylePreset: 'technical',
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Old', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' }],
      }),
      'utf8'
    );

    let osProbeCalls = 0;
    const svc = new ThoughtTranslatorService({
      configDir: tmpDir,
      proxyEnv: { ALL_PROXY: 'socks5h://127.0.0.1:10800' },
      proxyPlatform: 'win32',
      proxyExecFileSync: () => {
        osProbeCalls++;
        return '    ProxyEnable    REG_DWORD    0x1\r\n    ProxyServer    REG_SZ    http=127.0.0.1:7890\r\n';
      },
    });

    const initial = svc.getSanitizedConfig();
    assert.equal(initial.customProxyUrl, '');
    assert.equal(initial.proxyMode, 'auto');
    assert.equal(initial.translateToolSummaries, false, 'translateToolSummaries must default to false');

    // Empty customProxyUrl -> follows ALL_PROXY socks5h env var
    const pEnv = svc._resolveProxyForUrl('https://translate.googleapis.com/translate_a/single');
    assert.equal(pEnv?.protocol, 'socks5h:');
    assert.equal(pEnv?.port, 10800);

    // Custom proxy takes priority over env + OS proxy
    const saveCustom = svc.saveConfig({ customProxyUrl: 'socks5://127.0.0.1:10888' });
    assert.equal(saveCustom.ok, true);
    const pCustom = svc._resolveProxyForUrl('https://translate.googleapis.com/translate_a/single');
    assert.equal(pCustom?.protocol, 'socks5:');
    assert.equal(pCustom?.port, 10888);

    // Loopback ALWAYS bypasses custom proxy (local Ollama/LM Studio safety)
    assert.equal(svc._resolveProxyForUrl('http://127.0.0.1:11434/v1/models'), null);
    assert.equal(svc._resolveProxyForUrl('http://localhost:11434/v1/models'), null);

    // proxyMode='direct' bypasses custom + env + OS proxy
    svc.saveConfig({ proxyMode: 'direct' });
    assert.equal(svc._resolveProxyForUrl('https://translate.googleapis.com/translate_a/single'), null);

    // Clearing customProxyUrl + switching to auto immediately invalidates 30s OS cache
    const svcOs = new ThoughtTranslatorService({
      configDir: tmpDir,
      proxyEnv: {},
      proxyPlatform: 'win32',
      proxyExecFileSync: () => {
        osProbeCalls++;
        return `    ProxyEnable    REG_DWORD    0x1\r\n    ProxyServer    REG_SZ    http=127.0.0.1:${7890 + osProbeCalls}\r\n`;
      },
    });
    svcOs.saveConfig({ proxyMode: 'auto', customProxyUrl: '' });
    const firstOs = svcOs._resolveProxyForUrl('https://translate.googleapis.com/translate_a/single');
    const cachedOs = svcOs._resolveProxyForUrl('https://translate.googleapis.com/translate_a/single');
    assert.equal(firstOs.port, cachedOs.port, 'OS proxy should be cached within 30s');
    const beforeSaveCalls = osProbeCalls;
    // Saving config invalidates 30s OS proxy cache immediately
    svcOs.saveConfig({ customProxyUrl: 'http://127.0.0.1:9999' });
    assert.equal(svcOs._resolveProxyForUrl('https://translate.googleapis.com/translate_a/single')?.port, 9999);
    svcOs.saveConfig({ customProxyUrl: '' });
    const refreshedOs = svcOs._resolveProxyForUrl('https://translate.googleapis.com/translate_a/single');
    assert.ok(osProbeCalls > beforeSaveCalls, 'saveConfig must immediately refresh OS proxy cache');
    assert.notEqual(refreshedOs.port, firstOs.port);

    // macOS scutil SOCKS-only detection & Windows socks-only detection
    const macSocksOnly = parseMacScutilProxyOutput(
      '<dictionary> {\n  HTTPEnable : 0\n  HTTPSEnable : 0\n  SOCKSEnable : 1\n  SOCKSProxy : 127.0.0.1\n  SOCKSPort : 6154\n}\n'
    );
    assert.equal(macSocksOnly.enabled, true);
    assert.equal(macSocksOnly.socks?.protocol, 'socks5h:');
    assert.equal(macSocksOnly.socks?.port, 6154);
    const resolvedMac = resolveSystemProxy('https://translate.googleapis.com/translate_a/single', {
      env: {},
      osConfig: macSocksOnly,
    });
    assert.equal(resolvedMac?.protocol, 'socks5h:');
    assert.equal(resolvedMac?.port, 6154);

    const winSocksOnly = parseWindowsRegProxyOutput(
      '    ProxyEnable    REG_DWORD    0x1\r\n    ProxyServer    REG_SZ    socks=127.0.0.1:1080\r\n'
    );
    const resolvedWin = resolveSystemProxy('https://api.openai.com/v1/models', {
      env: {},
      osConfig: winSocksOnly,
    });
    assert.equal(resolvedWin?.protocol, 'socks5h:');
    assert.equal(resolvedWin?.port, 1080);

    // Invalid customProxyUrl rejected cleanly without corrupting existing saved config
    const badSave = svc.saveConfig({ customProxyUrl: 'http://127.0.0.1:7890\r\nBad: 1' });
    assert.equal(badSave.ok, false);
    assert.match(badSave.error, /control characters|Invalid proxy/i);

    assert.equal(maskProxyUrl('socks5h://bob:pw123@127.0.0.1:1080'), 'socks5h://••••@127.0.0.1:1080');
    svc.dispose();
    svcOs.dispose();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('4) Issue #27 five root-cause regressions: streaming wakeup without flags.l, quiet-gate flicker rescue, fine quickPanelStamp, >48k chunking/notice, and cooldown trigger-badge retry', async () => {
  const clientSrc = fs.readFileSync(path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-client.js'), 'utf8');

  // A) Backend >48k oversized thought language check & safe chunked translation (never silently skipped!)
  const oversizedText = Array.from({ length: 650 }, (_, i) =>
    `Paragraph ${i}: Investigating performance bottlenecks in the asynchronous proxy scheduler and verifying boundary conditions.`
  ).join('\n\n');
  assert.ok(oversizedText.length > 52000, `Expected >52k chars, got ${oversizedText.length}`);
  assert.equal(isAlreadyTargetLang(oversizedText, 'zh-CN'), false, '>48k English thought must NOT be falsely treated as already target language');
  const split = splitOversizedThought(oversizedText, 48000, 96000);
  assert.ok(split.chunks.length >= 2, 'Oversized >48k thought must split into safe chunks at paragraph boundaries');
  assert.equal(split.truncated, false);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-oversize-'));
  let gtxBatches = 0;
  const mockSvc = new ThoughtTranslatorService({
    configDir: tmpDir,
    fetchImpl: async (url) => {
      gtxBatches++;
      const q = new URL(String(url)).searchParams.get('q') || '';
      return new Response(JSON.stringify([[[`译:${q.slice(0, 24)}`, q]]]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  const bigRes = await mockSvc.translateThought({ text: oversizedText, mode: 'machine', targetLang: 'zh-CN' });
  assert.equal(bigRes.ok, true);
  assert.equal(bigRes.skipped, undefined, 'Oversized thought must NOT be silently skipped');
  assert.ok(gtxBatches >= 1);
  assert.ok(bigRes.text.includes('译:'));
  mockSvc.dispose();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // B) Frontend 5 root-cause E2E tests in mock DOM
  const translateCalls = [];
  let forceNextFail = null;
  const { doc, docEl, rootBody, sandbox } = createMockDomEnv({
    __agPrismThoughtBridge: {
      call: async ({ action }) =>
        action === 'get-cache' ? { ok: true, stylePreset: 'technical', translateToolSummaries: false, entries: {} } : { ok: true },
      translateStream: async (opts, onPartial) => {
        translateCalls.push({ ...opts });
        if (forceNextFail) {
          const errObj = forceNextFail;
          forceNextFail = null;
          return errObj;
        }
        const out = `已译(${opts.text.length}): ${opts.text.slice(0, 32)}`;
        if (onPartial) onPartial(out);
        return { ok: true, text: out, engine: opts.mode === 'machine' ? 'machine' : 'ai' };
      },
      cancelTranslate: async () => ({ ok: true }),
    },
  });
  docEl.setAttribute('data-ag-cs-lang', 'zh-CN');
  docEl.setAttribute('data-ag-cs-motion', 'off');
  vm.runInNewContext(clientSrc, sandbox);
  const api = sandbox.__agPrismThought;

  try {
    api.sync({ thoughtTranslate: 'machine', thoughtTrigger: 'expand' });
    await new Promise((r) => setTimeout(r, 40));

    // RC-1: Streaming ends via shimmer removal + text change WITHOUT anyone calling api.scan()
    const btn1 = doc.createElement('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' });
    const shimmer = doc.createElement('span', { class: 'animate-shimmer-text' });
    shimmer.textContent = 'Thinking';
    btn1.appendChild(shimmer);
    const panel1 = doc.createElement('div');
    const p1 = doc.createElement('p');
    p1.textContent = 'Analyzing streaming completion wakeup without structural childList addition.';
    panel1.appendChild(p1);
    rootBody.appendChild(btn1);
    rootBody.appendChild(panel1);

    api.scanImmediate();
    assert.equal(panel1.getAttribute('data-op-zh-pending'), '1', 'Streaming panel should show pending state');

    // Simulate host sleeping/hidden (0 polling while hidden), then waking + finishing shimmer without calling api.scan()
    doc.hidden = true;
    doc.visibilityState = 'hidden';
    doc.dispatchDocEvent('visibilitychange');
    doc.hidden = false;
    doc.visibilityState = 'visible';
    shimmer.classList.remove('animate-shimmer-text');
    shimmer.textContent = 'Thought for 4s';
    doc.dispatchDocEvent('visibilitychange');

    // Wait for streaming watcher + FINISH_GATE (450ms) + QUIET_GATE (900ms)
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(panel1.getAttribute('data-op-zh-ready'), '1', 'RC-1: Must auto-wake and translate after shimmer removal without external scan()');

    // RC-3a: Fine quickPanelStamp catches middle paragraph change (same length & last char)
    const btn2 = doc.createElement('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' });
    btn2.textContent = 'Thought for 2s';
    const panel2 = doc.createElement('div');
    const mp1 = doc.createElement('p');
    mp1.textContent = 'First unchanged paragraph stays identical.';
    const mp2 = doc.createElement('p');
    mp2.textContent = 'Middle English alpha reasoning step one.';
    const mp3 = doc.createElement('p');
    mp3.textContent = 'Final unchanged paragraph stays identical.';
    panel2.appendChild(mp1);
    panel2.appendChild(mp2);
    panel2.appendChild(mp3);
    rootBody.appendChild(btn2);
    rootBody.appendChild(panel2);

    api.scanImmediate();
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(panel2.getAttribute('data-op-zh-ready'), '1');
    const prevCalls = translateCalls.length;
    // Mutate ONLY middle paragraph to exact same length and same last char '.'
    mp2.textContent = 'Middle English bravo reasoning step two.';
    assert.equal(mp2.textContent.length, 'Middle English alpha reasoning step one.'.length);
    api.scanImmediate();
    await new Promise((r) => setTimeout(r, 1050));
    assert.ok(translateCalls.length > prevCalls, 'RC-3a: Fine quickPanelStamp must detect middle paragraph edits of equal length');

    // RC-2: Quiet-gate transient aria-expanded flicker rescues panel instead of silently abandoning
    const btn3 = doc.createElement('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' });
    btn3.textContent = 'Thought for 3s';
    const panel3 = doc.createElement('div');
    const fp = doc.createElement('p');
    fp.textContent = 'Initial draft English sentence to enter quiet gate.';
    panel3.appendChild(fp);
    rootBody.appendChild(btn3);
    rootBody.appendChild(panel3);
    api.scanImmediate();
    await new Promise((r) => setTimeout(r, 80));
    // Trigger quiet gate via content update
    fp.textContent = 'Updated final English sentence waiting through quiet gate flicker.';
    api.scanImmediate();
    // Brief React flicker: aria-expanded drops to false right around timer firing, then returns to true within 80ms
    setTimeout(() => btn3.setAttribute('aria-expanded', 'false'), 880);
    setTimeout(() => btn3.setAttribute('aria-expanded', 'true'), 970);
    await new Promise((r) => setTimeout(r, 1250));
    assert.ok(
      panel3.querySelector('.ag-prism-thought-body')?.textContent.includes('Updated final English'),
      'RC-2: Transient aria-expanded flicker during QUIET_GATE_MS must be rescued and translated'
    );

    // RC-3b: >48k oversized block translates safely and mounts truncation badge instead of silent skip
    const btnBig = doc.createElement('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' });
    btnBig.textContent = 'Thought for 9s';
    const panelBig = doc.createElement('div');
    const pBig = doc.createElement('p');
    pBig.textContent = oversizedText;
    panelBig.appendChild(pBig);
    rootBody.appendChild(btnBig);
    rootBody.appendChild(panelBig);
    api.scanImmediate();
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(panelBig.getAttribute('data-op-zh-ready'), '1', 'RC-3b: >48k thought block must translate instead of silent skip');
    const truncBadge = panelBig.querySelector('[data-testid="thought-truncated-badge"]');
    assert.ok(truncBadge && !truncBadge.hidden, 'RC-3b: >48k thought block must display clear truncation notice badge');
    assert.equal(truncBadge.getAttribute('translate'), 'no', 'Truncation badge must have anti-translation attrs');

    // RC-4 & RC-5: Proxy failure shows localized error reason + trigger header status badge; clicking badge clears cooldown & retries immediately!
    forceNextFail = {
      ok: false,
      error: 'SOCKS5 CONNECT rejected via socks5h://secretUser:secretPass@127.0.0.1:1080',
    };
    const btnFail = doc.createElement('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' });
    btnFail.textContent = 'Thought for 5s';
    const panelFail = doc.createElement('div');
    const pFail = doc.createElement('p');
    pFail.textContent = 'Evaluating proxy unreachable failure badge and manual cooldown bypass retry flow.';
    panelFail.appendChild(pFail);
    rootBody.appendChild(btnFail);
    rootBody.appendChild(panelFail);

    api.scanImmediate();
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(panelFail.getAttribute('data-op-zh-failed'), '1');
    const errBar = panelFail.querySelector('.ag-prism-thought-error-bar');
    assert.ok(errBar && errBar.textContent.includes('代理'), 'Error bar should classify proxy failure clearly');
    assert.equal(errBar.title.includes('secretPass'), false, 'Error tooltip must redact proxy credentials');

    const trigBadge = btnFail.querySelector('[data-testid="thought-trigger-status-badge"]');
    assert.ok(trigBadge, 'Failed/cooldown block must mount lightweight status badge on trigger header');
    assert.equal(trigBadge.getAttribute('data-fail-reason'), 'proxy');
    assert.equal(trigBadge.getAttribute('translate'), 'no', 'Trigger status badge must carry anti-translation attrs');
    assert.equal(btnFail.getAttribute('translate'), null, 'Host trigger button itself must NEVER receive anti-translation attrs');

    // Clicking trigger status badge bypasses cooldown immediately and recovers translation
    trigBadge.click();
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(panelFail.getAttribute('data-op-zh-ready'), '1', 'Manual click on trigger status badge must bypass cooldown & succeed');
    assert.equal(btnFail.querySelector('[data-testid="thought-trigger-status-badge"]'), null, 'Trigger status badge must clear after recovery');
  } finally {
    api.destroy();
  }
});

test('5) Issue #27 tool execution summaries: default OFF, merged single batch request, strict identifier protection, fail-closed integrity, and instant lossless restore on OFF', async () => {
  // A) Identifier protection & restoration unit checks
  const sample1 = 'Read A1_R1.log #L1-38 with --tail (Exited with code 0)';
  const p1 = protectToolSummaryIdentifiers(sample1);
  assert.ok(p1.tokens.includes('A1_R1.log'));
  assert.ok(p1.tokens.includes('#L1-38'));
  assert.ok(p1.tokens.includes('--tail'));
  assert.ok(p1.tokens.includes('Exited with code 0'));
  assert.equal(p1.masked.includes('A1_R1.log'), false);
  const r1 = restoreToolSummaryIdentifiers(
    p1.masked.replace('Read', '读取').replace('with', '使用'),
    p1.tokens
  );
  assert.equal(r1.ok, true);
  assert.ok(r1.text.includes('A1_R1.log') && r1.text.includes('#L1-38') && r1.text.includes('--tail') && r1.text.includes('Exited with code 0'));

  const sample2 = 'Inspect experiment plan xlsx and `git status --short` in vendor/thought-translator/thought-client.js#L1-38';
  const p2 = protectToolSummaryIdentifiers(sample2);
  assert.ok(p2.tokens.some((t) => t.toLowerCase() === 'xlsx'));
  assert.ok(p2.tokens.includes('`git status --short`'));
  assert.ok(p2.tokens.includes('vendor/thought-translator/thought-client.js#L1-38'));

  // Fail-closed check: corrupted/missing placeholder must fail restoration instead of mangling filename
  const corrupted = restoreToolSummaryIdentifiers('读取 被损坏的文本', p1.tokens);
  assert.equal(corrupted.ok, false);
  assert.ok(corrupted.missing.length > 0);

  // Pure identifier/exit-code lines are NOT translatable
  assert.equal(isToolSummaryTranslatable('A1_R1.log #L1-38', 'zh-CN'), false);
  assert.equal(isToolSummaryTranslatable('Exited with code 0', 'zh-CN'), false);
  assert.equal(isToolSummaryTranslatable('已运行 list workspace root directory', 'zh-CN'), true);
  assert.equal(isToolSummaryTranslatable('List key project directories finished', 'zh-CN'), true);

  // B) Backend + Frontend E2E merged batch translation + default OFF + lossless restore
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-tool-sum-'));
  let gtxCalls = 0;
  const svc = new ThoughtTranslatorService({
    configDir: tmpDir,
    fetchImpl: async (url) => {
      gtxCalls++;
      const q = new URL(String(url)).searchParams.get('q') || '';
      const out = q
        .replace(/list workspace root directory/gi, '列出工作区根目录')
        .replace(/List key project directories finished/gi, '列出关键项目目录 已完成')
        .replace(/\bRead\b/g, '读取')
        .replace(/\bwith\b/g, '使用')
        .replace(/Inspect experiment plan/gi, '检查实验计划');
      return new Response(JSON.stringify([[[out, q]]]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  // Verify fail-closed on backend when upstream drops a placeholder
  const svcCorrupt = new ThoughtTranslatorService({
    configDir: tmpDir,
    fetchImpl: async () =>
      new Response(JSON.stringify([[['[0] 读取 被破坏的占位符', '']]]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  const corruptRes = await svcCorrupt.translateToolSummariesBatch({
    items: ['Read A1_R1.log #L1-38'],
    mode: 'machine',
    targetLang: 'zh-CN',
  });
  assert.equal(corruptRes.ok, true);
  assert.equal(corruptRes.items[0], 'Read A1_R1.log #L1-38', 'Dropped placeholder must fail-closed to exact raw text');
  svcCorrupt.dispose();

  const clientSrc = fs.readFileSync(path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-client.js'), 'utf8');
  const batchRpcCalls = [];
  const { doc, docEl, rootBody, sandbox } = createMockDomEnv({
    __agPrismThoughtBridge: {
      call: async ({ action, ...rest }) => {
        if (action === 'get-cache') return svc.getWarmCacheSnapshot();
        if (action === 'get-config') return svc.getSanitizedConfig();
        if (action === 'save-config') return svc.saveConfig(rest);
        return { ok: true };
      },
      translateStream: async (opts) => {
        if (String(opts.mode || '').startsWith('tool-batch:')) batchRpcCalls.push(opts);
        return svc.translateThought(opts);
      },
      cancelTranslate: async () => ({ ok: true }),
    },
  });
  docEl.setAttribute('data-ag-cs-lang', 'zh-CN');
  vm.runInNewContext(clientSrc, sandbox);
  const api = sandbox.__agPrismThought;

  try {
    // Build realistic "正在探索" tool-group DOM
    const toolTrig = doc.createElement('button', { 'data-testid': 'tool-group-collapsible', 'aria-expanded': 'true' });
    toolTrig.textContent = '正在探索';
    const toolPanel = doc.createElement('div');
    const origRows = [
      '已运行 list workspace root directory',
      'List key project directories finished',
      'Read A1_R1.log #L1-38 with --tail (Exited with code 0)',
      'Inspect experiment plan xlsx',
    ];
    const rowSpans = origRows.map((txt) => {
      const row = doc.createElement('div', { class: 'flex flex-row' });
      const sp = doc.createElement('span');
      sp.textContent = txt;
      row.appendChild(sp);
      toolPanel.appendChild(row);
      return sp;
    });
    // Also include a file link inside the container that MUST stay untouched
    const fileAnchor = doc.createElement('a', { href: 'file:///workspace/A1_R1.log' });
    fileAnchor.textContent = 'A1_R1.log';
    toolPanel.appendChild(fileAnchor);

    rootBody.appendChild(toolTrig);
    rootBody.appendChild(toolPanel);

    // 1) Default OFF: 0 tool-batch RPC calls, all rows remain original
    api.sync({ thoughtTranslate: 'machine', thoughtTrigger: 'expand' });
    api.scanImmediate();
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(api.getTranslateToolSummaries(), false, 'translateToolSummaries must default to false');
    assert.equal(batchRpcCalls.length, 0, 'Default OFF must send 0 tool-summary batch requests');
    assert.deepEqual(rowSpans.map((s) => s.textContent), origRows);

    // 2) Turn ON: all 4 rows merge into ONE single batch RPC call & preserve every technical identifier!
    api.setTranslateToolSummaries(true);
    api.scanImmediate();
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(batchRpcCalls.length, 1, 'All 4 tool summary rows in one container must merge into 1 single batch request');
    assert.equal(gtxCalls, 1, 'Single merged batch must perform only 1 upstream GTX request');
    assert.equal(rowSpans[0].textContent, '已运行 列出工作区根目录');
    assert.equal(rowSpans[1].textContent, '列出关键项目目录 已完成');
    assert.ok(
      rowSpans[2].textContent.includes('读取') &&
        rowSpans[2].textContent.includes('A1_R1.log') &&
        rowSpans[2].textContent.includes('#L1-38') &&
        rowSpans[2].textContent.includes('--tail') &&
        rowSpans[2].textContent.includes('Exited with code 0'),
      `Identifiers must stay intact in translated tool row, got: ${rowSpans[2].textContent}`
    );
    assert.ok(
      rowSpans[3].textContent.includes('检查实验计划') && rowSpans[3].textContent.includes('xlsx'),
      `xlsx extension must stay intact, got: ${rowSpans[3].textContent}`
    );
    assert.equal(fileAnchor.textContent, 'A1_R1.log', 'Native file anchor must remain completely untouched');

    // 3) Turn OFF: instant lossless restoration of all 4 rows!
    api.setTranslateToolSummaries(false);
    assert.deepEqual(
      rowSpans.map((s) => s.textContent),
      origRows,
      'Turning translateToolSummaries off must immediately and losslessly restore exact raw text'
    );
  } finally {
    api.destroy();
    svc.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('6) thought-settings-ui.js: custom proxy URL live validation, 5-locale sync, tool-summaries default-off toggle, and machine-mode companion card', async () => {
  const settingsUiSrc = fs.readFileSync(
    path.join(ROOT_DIR, 'vendor', 'thought-translator', 'thought-settings-ui.js'),
    'utf8'
  );

  const savedPayloads = [];
  let toolSumState = false;
  const { doc, docEl, rootBody, sandbox } = createMockDomEnv({
    __agPrismThoughtBridge: {
      call: async () => ({ ok: true }),
      cacheStats: async () => ({ ok: true, entries: 0 }),
    },
    __agPrismThought: {
      getViewMode: () => 'immersive',
      setViewMode: () => {},
      getLocalCacheStats: () => ({ memEntries: 0 }),
      setTranslateToolSummaries: (v) => {
        toolSumState = Boolean(v);
      },
      getConfig: async () => ({
        ok: true,
        stylePreset: 'technical',
        viewMode: 'immersive',
        proxyMode: 'auto',
        customProxyUrl: '',
        hasProxyCredentials: false,
        translateToolSummaries: false,
        activeProfileId: 'default',
        profiles: [{ id: 'default', name: 'Primary', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hasApiKey: false }],
      }),
      saveConfig: async (payload) => {
        savedPayloads.push(payload);
        return {
          ok: true,
          stylePreset: payload.stylePreset || 'technical',
          viewMode: payload.viewMode || 'immersive',
          proxyMode: payload.proxyMode || 'auto',
          customProxyUrl: payload.customProxyUrl || '',
          hasProxyCredentials: false,
          translateToolSummaries: Boolean(payload.translateToolSummaries),
          activeProfileId: 'default',
          profiles: [{ id: 'default', name: 'Primary', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hasApiKey: false }],
        };
      },
      scan: () => {},
    },
  });

  docEl.setAttribute('data-ag-cs-lang', 'zh-CN');
  vm.runInNewContext(settingsUiSrc, sandbox);
  const hostCard = doc.createElement('div', { class: 'ag-cs-settings-card' });
  rootBody.appendChild(hostCard);

  const uiHandle = sandbox.__agPrismThoughtSettingsUi.createThoughtAiConfigBox({
    mkEl: (tag, cls) => {
      const e = doc.createElement(tag);
      if (cls) e.className = cls;
      return e;
    },
    btnClass: 'seg-btn',
    ui: {},
    getMode: () => 'ai',
    runGuardedMut: (fn) => fn(),
  });
  hostCard.appendChild(uiHandle.box);
  await new Promise((r) => setTimeout(r, 20));

  const proxyInput = uiHandle.box.querySelector('[data-testid="thought-custom-proxy-url"]');
  const proxyHint = uiHandle.box.querySelector('[data-testid="thought-custom-proxy-hint"]');
  const saveBtn = uiHandle.box.querySelector('[data-testid="thought-save-btn"]');
  const toolToggle = uiHandle.box.querySelector('[data-testid="thought-tool-summaries-toggle"]');
  assert.ok(proxyInput && proxyHint && saveBtn && toolToggle);

  // Default OFF for tool summaries toggle
  assert.equal(toolToggle.getAttribute('aria-checked'), 'false');
  toolToggle.click();
  assert.equal(toolToggle.getAttribute('aria-checked'), 'true');
  assert.equal(toolSumState, true);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(savedPayloads.some((p) => p.translateToolSummaries === true), true);

  // Real-time proxy URL validation: invalid blocks save, valid SOCKS5H saves
  const prevSaveCount = savedPayloads.length;
  proxyInput.value = 'ftp://invalid-scheme:21';
  proxyInput.dispatch('input');
  assert.equal(proxyHint.getAttribute('data-state'), 'err');
  saveBtn.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(savedPayloads.length, prevSaveCount, 'Invalid proxy URL must block save');

  proxyInput.value = 'socks5h://127.0.0.1:1080';
  proxyInput.dispatch('input');
  assert.equal(proxyHint.getAttribute('data-state'), 'ok');
  saveBtn.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(savedPayloads[savedPayloads.length - 1].customProxyUrl, 'socks5h://127.0.0.1:1080');

  // 5-locale sync check
  for (const [loc, expectProxyWord] of [
    ['zh-CN', '自定义代理地址'],
    ['zh-TW', '自訂代理位址'],
    ['yue', '自訂代理地址'],
    ['en', 'Custom Proxy URL'],
    ['ja', 'カスタムプロキシ URL'],
  ]) {
    docEl.setAttribute('data-ag-cs-lang', loc);
    uiHandle.onLanguageChanged(loc);
    assert.ok(
      uiHandle.box.textContent.includes(expectProxyWord),
      `Locale ${loc} must render proxy label "${expectProxyWord}"`
    );
  }

  // Machine mode keeps prism-thought-ai-config hidden while surfacing companion card with 5+1 anti-translation attrs
  uiHandle.onModeSwitched('machine');
  assert.equal(uiHandle.box.hidden, true, 'AI config box must remain hidden in machine mode');
  const genCard = hostCard.querySelector('[data-testid="prism-thought-general-config"]');
  assert.ok(genCard && !genCard.hidden, 'Machine mode must mount visible general config card for proxy & tool summaries');
  assert.equal(genCard.getAttribute('translate'), 'no');
  assert.equal(genCard.getAttribute('data-ag-no-i18n'), '');
  assert.ok(genCard.querySelector('[data-testid="thought-custom-proxy-url"]'));
  assert.ok(genCard.querySelector('[data-testid="thought-tool-summaries-toggle"]'));

  // Switch back to AI -> companion card removes cleanly and controls move back into AI box
  uiHandle.onModeSwitched('ai');
  assert.equal(uiHandle.box.hidden, false);
  assert.equal(hostCard.querySelector('[data-testid="prism-thought-general-config"]'), null);
  assert.ok(uiHandle.box.querySelector('[data-testid="thought-custom-proxy-url"]'));
});

test('7) Workspace cleanliness: zero .bundle-cache.json leftover in repository root', () => {
  assert.equal(
    fs.existsSync(path.join(ROOT_DIR, '.bundle-cache.json')),
    false,
    'Repository root must not contain leftover .bundle-cache.json'
  );
});
