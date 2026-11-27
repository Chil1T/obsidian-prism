import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const cdp = require(path.join(ROOT, 'cdp.js'));
const partitionsFactory = require(path.join(ROOT, 'vendor', 'project-partitions', 'partitions-client.js'));
const partitionsHost = require(path.join(ROOT, 'vendor', 'project-partitions', 'partitions-host.js'));
const i18nExtBeta4 = require(path.join(ROOT, 'src', 'runtime', 'i18n-ext-beta4.js'));
const settingsExtBeta4 = require(path.join(ROOT, 'src', 'runtime', 'settings-ext-beta4.js'));

const CANONICAL_9_LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'tr'];
const NON_CJK_LOCALES = ['en', 'ko', 'es', 'fr', 'de', 'tr'];
const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;

function createPartitionsMiniDom({ projects = [], summaries = {} } = {}) {
  const listenersByNode = new WeakMap();
  const orderLog = [];

  const matchesSingle = (el, sel) => {
    const s = sel.trim();
    if (!s) return false;
    if (s.startsWith('#')) return el.id === s.slice(1);
    let rest = s;
    const tm = rest.match(/^[a-zA-Z0-9-]+/);
    if (tm) {
      if (el.tagName !== tm[0].toUpperCase()) return false;
      rest = rest.slice(tm[0].length);
    }
    for (const m of rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
      if (!el.classList.contains(m[1])) return false;
    }
    for (const m of rest.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)) {
      if (!el.hasAttribute(m[1])) return false;
      if (m[2] !== undefined && el.getAttribute(m[1]) !== m[2]) return false;
    }
    return true;
  };

  const matches = (el, selList) =>
    String(selList || '')
      .split(',')
      .some((part) => {
        const tokens = part.trim().split(/\s+/).filter(Boolean);
        if (!tokens.length || !matchesSingle(el, tokens[tokens.length - 1])) return false;
        let cur = el.parentElement;
        for (let i = tokens.length - 2; i >= 0; i--) {
          let found = false;
          while (cur) {
            if (matchesSingle(cur, tokens[i])) { found = true; cur = cur.parentElement; break; }
            cur = cur.parentElement;
          }
          if (!found) return false;
        }
        return true;
      });

  const walk = (root, out = []) => {
    for (const c of root.children) { out.push(c); walk(c, out); }
    return out;
  };

  const makeEl = (tag, doc) => {
    const attrs = new Map();
    const listeners = new Map();
    const el = {
      tagName: String(tag).toUpperCase(),
      nodeType: 1,
      id: '', type: '', value: '', placeholder: '', maxLength: 0, className: '', _text: '',
      ownerDocument: doc, parentElement: null, parentNode: null, children: [],
      style: { cssText: '', setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } },
      classList: {
        add(...cs) { const s = new Set(el.className.split(/\s+/).filter(Boolean)); cs.forEach((c) => c && s.add(c)); el.className = [...s].join(' '); },
        remove(...cs) { const d = new Set(cs); el.className = el.className.split(/\s+/).filter((x) => x && !d.has(x)).join(' '); },
        contains(c) { return el.className.split(/\s+/).includes(c); },
      },
      get isConnected() { let p = el; while (p) { if (p === doc.documentElement) return true; p = p.parentElement; } return false; },
      get firstElementChild() { return el.children[0] || null; },
      get firstChild() { return el.children[0] || null; },
      get textContent() { return el.children.length ? el._text + el.children.map((c) => c.textContent).join('') : el._text; },
      set textContent(v) { el._text = String(v ?? ''); el.children.length = 0; },
      setAttribute(k, v) { attrs.set(k, String(v)); if (k === 'id') el.id = String(v); if (k === 'class') el.className = String(v); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); if (k === 'id') el.id = ''; },
      appendChild(c) {
        if (el === doc.body && c.classList?.contains('ag-prism-part-popup')) orderLog.push('append-popup');
        if (c.parentElement) c.parentElement.removeChild(c);
        c.parentElement = c.parentNode = el;
        el.children.push(c);
        return c;
      },
      insertBefore(c, ref) {
        if (!ref) return el.appendChild(c);
        if (c.parentElement) c.parentElement.removeChild(c);
        const idx = el.children.indexOf(ref);
        c.parentElement = c.parentNode = el;
        if (idx < 0) el.children.push(c); else el.children.splice(idx, 0, c);
        return c;
      },
      replaceChildren(...nodes) {
        el._replaceCount = (el._replaceCount || 0) + 1;
        while (el.children.length) {
          const ch = el.children.pop();
          ch.parentElement = ch.parentNode = null;
        }
        for (const n of nodes) el.appendChild(n);
      },
      removeChild(c) { const idx = el.children.indexOf(c); if (idx >= 0) el.children.splice(idx, 1); c.parentElement = c.parentNode = null; return c; },
      remove() { if (el.parentElement) el.parentElement.removeChild(el); },
      contains(target) { let cur = target; while (cur) { if (cur === el) return true; cur = cur.parentElement; } return false; },
      matches(sel) { return matches(el, sel); },
      closest(sel) { let cur = el; while (cur) { if (matches(cur, sel)) return cur; cur = cur.parentElement; } return null; },
      querySelector(sel) { for (const n of walk(el)) if (matches(n, sel)) return n; return null; },
      querySelectorAll(sel) { return walk(el).filter((n) => matches(n, sel)); },
      getBoundingClientRect() {
        if (el.classList?.contains('ag-prism-part-menu-item') || el.classList?.contains('ag-prism-part-icon-btn')) {
          orderLog.push('read-anchor-rect');
        }
        return { left: 16, top: 40, right: 220, bottom: 70, width: 204, height: 30 };
      },
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      dispatchEvent(ev) {
        const event = ev && typeof ev === 'object' ? ev : { type: String(ev) };
        if (!event.target) event.target = el;
        event.preventDefault = event.preventDefault || (() => {});
        event.stopPropagation = event.stopPropagation || (() => { event._stopped = true; });
        let cur = el;
        while (cur) {
          const set = listenersByNode.get(cur)?.get(event.type);
          if (set) for (const fn of [...set]) fn(event);
          if (event._stopped || !event.bubbles) break;
          cur = cur.parentElement;
        }
        return true;
      },
      click() { el.dispatchEvent({ type: 'click', bubbles: true }); },
      focus() {},
      select() {},
    };
    listenersByNode.set(el, listeners);
    return el;
  };

  const docListeners = new Map();
  const doc = {
    documentElement: null, head: null, body: null,
    createElement(tag) { return makeEl(tag, doc); },
    createElementNS(_ns, tag) { return makeEl(tag, doc); },
    getElementById(id) { return walk(doc.documentElement).find((n) => n.id === id) || null; },
    querySelector(sel) { return doc.documentElement.querySelector(sel); },
    querySelectorAll(sel) { return doc.documentElement.querySelectorAll(sel); },
    addEventListener(type, fn) { if (!docListeners.has(type)) docListeners.set(type, new Set()); docListeners.get(type).add(fn); },
    removeEventListener(type, fn) { docListeners.get(type)?.delete(fn); },
    dispatchEvent(ev) { const set = docListeners.get(ev.type); if (set) for (const fn of [...set]) fn(ev); return true; },
  };
  doc.documentElement = makeEl('html', doc);
  doc.head = makeEl('head', doc);
  doc.body = makeEl('body', doc);
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);

  const rootEl = doc.createElement('div');
  rootEl.id = 'root';
  doc.body.appendChild(rootEl);

  const navCalls = [];
  let storeState = { trajectorySummaries: { summaries } };
  let projectsState = [...projects];
  const storeSubs = new Set();
  const store = {
    getState: () => storeState,
    subscribe: (fn) => { storeSubs.add(fn); return () => storeSubs.delete(fn); },
    notify: () => { for (const fn of [...storeSubs]) fn(); },
  };
  const services = { core: { projectManagementService: { projectsStateProvider: { getState: () => projectsState }, onDidAnyProjectChange: () => ({ dispose() {} }) } } };
  const router = { state: { location: { pathname: '/' } }, navigate: (arg) => { navCalls.push(arg); return true; } };
  rootEl.__reactContainer$test = {
    current: {
      memoizedProps: { value: { store } },
      child: { memoizedProps: { value: services }, sibling: { memoizedProps: { value: router } } },
    },
  };

  const sidebar = doc.createElement('div');
  sidebar.setAttribute('data-testid', 'conversation-list-sidebar');
  rootEl.appendChild(sidebar);

  const virtualInner = doc.createElement('div');
  virtualInner.className = 'w-full relative';
  virtualInner.style.height = '420px';
  sidebar.appendChild(virtualInner);

  const projectsHeader = doc.createElement('div');
  projectsHeader.setAttribute('data-testid', 'section-header');
  projectsHeader.setAttribute('data-title', 'Projects');
  projectsHeader.style.transform = 'translateY(0px)';
  virtualInner.appendChild(projectsHeader);

  const nativeProjectRows = [];
  projects.forEach((p, idx) => {
    const row = doc.createElement('div');
    row.setAttribute('data-sidebar-section-drop-id', p.id);
    row.style.transform = `translateY(${(idx + 1) * 33}px)`;
    const hdr = doc.createElement('button');
    hdr.setAttribute('data-testid', 'project-header');
    hdr.textContent = p.name;
    const moreBtn = doc.createElement('button');
    moreBtn.setAttribute('aria-haspopup', 'menu');
    moreBtn.__reactFiber$test = {
      memoizedProps: {},
      return: {
        memoizedProps: { onCopyClick: () => {}, onSettingsClick: () => {}, onRevealClick: () => {}, onDeleteClick: () => {} },
      },
    };
    row.appendChild(hdr);
    row.appendChild(moreBtn);
    virtualInner.appendChild(row);
    nativeProjectRows.push(row);
  });

  const convsHeader = doc.createElement('div');
  convsHeader.setAttribute('data-testid', 'section-header');
  convsHeader.setAttribute('data-title', 'Conversations');
  convsHeader.style.transform = `translateY(${(projects.length + 1) * 33}px)`;
  virtualInner.appendChild(convsHeader);

  const lsMap = new Map();
  const localStorage = {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => { lsMap.set(k, String(v)); },
    removeItem: (k) => { lsMap.delete(k); },
  };

  const winListeners = new Map();
  const win = {
    document: doc, localStorage, innerWidth: 1280, innerHeight: 800, location: { pathname: '/' },
    requestAnimationFrame: (fn) => { fn(); return 1; }, cancelAnimationFrame: () => {},
    addEventListener(type, fn) { if (!winListeners.has(type)) winListeners.set(type, new Set()); winListeners.get(type).add(fn); },
    removeEventListener(type, fn) { winListeners.get(type)?.delete(fn); },
    dispatchEvent(ev) { const set = winListeners.get(ev.type); if (set) for (const fn of [...set]) fn(ev); },
    KeyboardEvent: class KeyboardEvent { constructor(type, init = {}) { this.type = type; this.key = init.key || ''; this.bubbles = Boolean(init.bubbles); } },
    __agPrism: { getState: () => ({ cfg: { language: 'zh-CN', projectPartitions: 'on' } }) },
  };

  return {
    win, doc, sidebar, virtualInner, projectsHeader, convsHeader, nativeProjectRows, navCalls, orderLog, store,
    setProjects(next) { projectsState = [...next]; },
    setSummaries(next) { storeState = { trajectorySummaries: { summaries: next } }; },
  };
}

test('microkernel channel: projectPartitions defaults to off (0 B), builds with disk cache, handles liveCfg & configRefresh, and tears down cleanly', async () => {
  assert.equal(cdp.DEFAULT_CONFIG.projectPartitions, 'off');
  assert.equal(cdp.validateConfigEntry('projectPartitions', 'off'), true);
  assert.equal(cdp.validateConfigEntry('projectPartitions', 'on'), true);
  assert.equal(cdp.validateConfigEntry('projectPartitions', 'invalid'), false);
  assert.equal(cdp.reconcileConfigAliases({ projectPartitions: true }).projectPartitions, 'on');
  assert.equal(cdp.reconcileConfigAliases({ projectPartitions: false }).projectPartitions, 'off');

  const ch = cdp.findChannel('projectPartitions');
  assert.ok(ch, 'CHANNEL_REGISTRY must register projectPartitions');
  assert.equal(ch.shouldEnable({}), false);
  assert.equal(ch.shouldEnable({ projectPartitions: 'off' }), false);
  assert.equal(ch.shouldEnable({ projectPartitions: 'on' }), true);
  assert.equal(ch.shouldEnable({ projectPartitions: true }), true);
  assert.equal(cdp.buildProjectPartitionsExpression({ projectPartitions: 'off' }), '');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-part-cache-'));
  const cachePath = path.join(tmpDir, '.bundle-cache.json');
  try {
    cdp.resetBundleCacheStats();
    const expr1 = cdp.buildProjectPartitionsExpression({ projectPartitions: 'on' }, { cachePath });
    assert.ok(expr1.length > 5000, 'compiled channel expression should be non-empty');
    assert.ok(Buffer.byteLength(expr1, 'utf8') <= ch.budgetBytes, 'compiled channel expression must stay within budget');
    assert.doesNotThrow(() => new vm.Script(expr1), 'compiled channel expression must parse cleanly');
    assert.match(expr1, /__agPrismProjectPartitions/);
    assert.match(expr1, /liveCfg\.projectPartitions\s*!==\s*undefined/, 'must guard against partial hot-reload liveCfg missing projectPartitions');

    cdp.resetBundleCacheStats();
    const expr2 = cdp.buildProjectPartitionsExpression({ projectPartitions: 'on' }, { cachePath });
    assert.equal(expr2, expr1, 'cached channel expression must match cold build');
    const stats = cdp.getBundleCacheStats();
    assert.ok((stats.channelHitsByName.projectPartitions || 0) >= 1, 'should record channel cache hit');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  for (const token of [
    '__agPrismProjectPartitions',
    '__agPrismProjectPartitionsFactory',
    '__agPrismProjectPartitionsUi',
    '__agPrismProjectPartitionsHost',
    'ag-prism-project-partitions-css',
    'ag-prism-part-hide-css',
    'ag-prism-partitions-root',
    'data-ag-prism-project-partitions',
  ]) {
    assert.ok(cdp.PROJECT_PARTITIONS_REMOVE_EXPRESSION.includes(token), `PROJECT_PARTITIONS_REMOVE_EXPRESSION missing ${token}`);
    assert.ok(cdp.REMOVE_EXPRESSION.includes(token), `REMOVE_EXPRESSION missing ${token}`);
  }

  // Real VM verification of configRefresh calling sync on 'on' and destroy on 'off'
  const runRefreshCheck = (mode) => {
    const calls = [];
    const expr = cdp.buildConfigRefreshExpression({ projectPartitions: mode });
    const codeHash = cdp.resolveCurrentBundleCodeHash ? cdp.resolveCurrentBundleCodeHash() : JSON.parse(expr.match(/codeHash":"([^"]+)"/)?.[0]?.split(':')[1] || '""');
    const win = {
      __agPrism: {
        version: cdp.PLUGIN_VERSION,
        codeHash,
        refreshConfig: () => true,
        getState: () => ({ cfg: { projectPartitions: mode } }),
      },
      __agPrismProjectPartitions: {
        sync: (c) => calls.push(['sync', c.projectPartitions]),
        destroy: () => calls.push(['destroy']),
      },
    };
    const sandbox = { window: win, globalThis: win, document: { documentElement: null, querySelectorAll: () => [] } };
    vm.runInNewContext(expr, sandbox);
    return calls;
  };
  assert.deepEqual(runRefreshCheck('on'), [['sync', 'on']]);
  assert.deepEqual(runRefreshCheck('off'), [['destroy']]);

  assert.ok(cdp.CHANNEL_CACHE_NAMES.includes('projectPartitions'));
  const { PAGE_HEALTH_PROBE_EXPRESSION } = await import('../src/daemon/session-heal-channels.mjs');
  assert.ok(PAGE_HEALTH_PROBE_EXPRESSION.includes('hasProjectPartitions:'));
  assert.ok(PAGE_HEALTH_PROBE_EXPRESSION.includes('projectPartitionsCodeHash:'));
});

test('hygiene & 9 locales: pure ASCII CSS, 0 :has(, 0 backdrop-filter, 9 locales with tr and 0 standalone yue', () => {
  const css = partitionsFactory.PARTITIONS_CSS;
  assert.ok(css.length > 500);
  assert.equal(/[^\x00-\x7F]/.test(css), false, 'PARTITIONS_CSS must be pure ASCII');
  assert.equal(/:has\s*\(/.test(css), false, 'PARTITIONS_CSS must not use :has(');
  assert.equal(/backdrop-filter/i.test(css), false, 'PARTITIONS_CSS must avoid GPU backdrop-filter');
  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length, 'PARTITIONS_CSS braces must be balanced');

  assert.deepEqual(Object.keys(partitionsFactory.I18N).sort(), [...CANONICAL_9_LOCALES].sort());
  assert.equal(partitionsFactory.I18N.yue, undefined);
  assert.equal(partitionsFactory.resolveLang('yue'), 'zh-CN');
  assert.equal(partitionsFactory.resolveLang('zh-yue'), 'zh-CN');
  assert.equal(partitionsFactory.resolveLang('tr-TR'), 'tr');
  for (const loc of CANONICAL_9_LOCALES) {
    const dict = partitionsFactory.I18N[loc];
    for (const [k, v] of Object.entries(dict)) {
      assert.ok(typeof v === 'string' && v.length > 0, `partitions I18N[${loc}].${k} must be non-empty`);
      if (NON_CJK_LOCALES.includes(loc)) {
        assert.equal(CJK_RE.test(v), false, `partitions I18N[${loc}].${k} leaked CJK: "${v}"`);
      }
    }
  }

  for (const key of ['setProjectPartitionsLabel', 'setProjectPartitionsDesc']) {
    const row = i18nExtBeta4.TABLE[key];
    assert.ok(Array.isArray(row) && row.length === CANONICAL_9_LOCALES.length, `i18n-ext-beta4.${key} must have 9 locales`);
    CANONICAL_9_LOCALES.forEach((loc, i) => {
      assert.ok(typeof row[i] === 'string' && row[i].length > 0);
      if (NON_CJK_LOCALES.includes(loc)) {
        assert.equal(CJK_RE.test(row[i]), false, `i18n-ext-beta4.${key}[${loc}] leaked CJK: "${row[i]}"`);
      }
    });
  }
});

test('settings-ext-beta4: mounts projectPartitions toggle after sidebarNavFold and persists on/off', () => {
  const dom = createPartitionsMiniDom();
  const sec = dom.doc.createElement('div');
  sec.setAttribute('data-body-built', '1');
  const grpWrap = dom.doc.createElement('div');
  const navFoldRow = dom.doc.createElement('div');
  navFoldRow.setAttribute('data-ag-cs-row', 'sidebarNavFold');
  grpWrap.appendChild(navFoldRow);
  sec.appendChild(grpWrap);
  dom.doc.body.appendChild(sec);

  const saved = [];
  const cfgState = { sidebarNavFold: 'off', projectPartitions: 'off', language: 'tr' };
  const origI18nExt = globalThis.__agPrismI18nExtBeta4;
  globalThis.__agPrismI18nExtBeta4 = i18nExtBeta4;
  try {
    settingsExtBeta4.sync(sec, {
      doc: dom.doc,
      win: dom.win,
      lang: cfgState.language,
      ui: { onLabel: 'Açık', offLabel: 'Kapalı' },
      effVal: (k) => cfgState[k],
      saveSetting: (k, v) => { cfgState[k] = v; saved.push([k, v]); },
      runGuardedMut: (fn) => fn(),
    });

    const row = sec.querySelector('[data-ag-cs-row="projectPartitions"]');
    assert.ok(row, 'settings-ext-beta4 must mount projectPartitions row after sidebarNavFold');
    assert.equal(row.querySelector('[data-k="t"]').textContent, 'Proje Bölümleri');
    const onBtn = row.querySelector('button[data-ag-cs-ext-key="projectPartitions"][data-ag-cs-ext-role="on"]');
    const offBtn = row.querySelector('button[data-ag-cs-ext-key="projectPartitions"][data-ag-cs-ext-role="off"]');
    assert.ok(onBtn && offBtn, 'projectPartitions switch must render On and Off buttons');
    assert.equal(offBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(onBtn.getAttribute('aria-pressed'), 'false');

    onBtn.click();
    assert.deepEqual(saved, [['projectPartitions', 'on']]);
    assert.equal(onBtn.getAttribute('aria-pressed'), 'true');
  } finally {
    if (origI18nExt === undefined) delete globalThis.__agPrismI18nExtBeta4;
    else globalThis.__agPrismI18nExtBeta4 = origI18nExt;
  }
});

test('controller: 3-level hierarchy, CRUD, P1-1 partial catalog preservation, and Wave P3 renderSig/domBus/read-then-write', () => {
  const projects = [
    {
      id: 'proj-alpha',
      name: 'AlphaApp',
      projectResources: { resources: [{ type: { case: 'folderUri', value: 'file:///d%3A/Work/AlphaApp' } }] },
    },
    {
      id: 'proj-beta',
      name: 'BetaTool',
      projectResources: { resources: [{ type: { case: 'gitFolder', value: { folderUri: 'file:///D:/Work/BetaTool/' } } }] },
    },
  ];
  const summaries = {
    'conv-1': {
      trajectoryType: 4, summary: 'Recent main chat', lastModifiedTime: { seconds: 1700000200n },
      workspaces: [{ workspaceFolderAbsoluteUri: 'file:///D:/Work/AlphaApp' }],
    },
    'conv-2': {
      trajectoryType: 4, summary: 'Pinned older chat', annotations: { pinned: true },
      lastModifiedTime: { seconds: 1700000100n }, status: 2,
      workspaces: [{ workspaceFolderAbsoluteUri: 'file:///d%3A/Work/AlphaApp/' }],
    },
    'conv-side': {
      trajectoryType: 2, summary: 'Side question excluded', lastModifiedTime: { seconds: 1700000500n },
      workspaces: [{ workspaceFolderAbsoluteUri: 'file:///D:/Work/AlphaApp' }],
    },
    'conv-archived': {
      trajectoryType: 4, archived: true, summary: 'Archived excluded', lastModifiedTime: { seconds: 1700000600n },
      workspaces: [{ workspaceFolderAbsoluteUri: 'file:///D:/Work/AlphaApp' }],
    },
    'conv-fork': {
      trajectoryType: 4, forkParentConversationId: 'conv-1', summary: 'Fork excluded', lastModifiedTime: { seconds: 1700000700n },
      workspaces: [{ workspaceFolderAbsoluteUri: 'file:///D:/Work/AlphaApp' }],
    },
  };

  const dom = createPartitionsMiniDom({ projects, summaries });
  let domBusSubCalls = 0;
  let domBusUnsubCalls = 0;
  let rawMoCreated = 0;
  dom.win.__agPrismDomBus = {
    subscribe(id, _handler, cfg) {
      domBusSubCalls += 1;
      assert.equal(id, 'project-partitions');
      assert.equal(cfg?.observeOptions?.characterData, undefined);
      return () => { domBusUnsubCalls += 1; };
    },
  };
  dom.win.MutationObserver = class FakeMo { constructor() { rawMoCreated += 1; } observe() {} disconnect() {} };

  const origWindow = globalThis.window;
  const origDoc = globalThis.document;
  globalThis.window = dom.win;
  globalThis.document = dom.doc;
  try {
    const ctrl = partitionsFactory.mountProjectPartitions({
      root: dom.win,
      doc: dom.doc,
      config: { projectPartitions: 'on', language: 'zh-CN' },
    });

    assert.equal(domBusSubCalls, 1, 'must subscribe via __agPrismDomBus when available');
    assert.equal(rawMoCreated, 0, 'must NOT create standalone document.body MutationObserver when domBus is present');
    assert.equal(ctrl.getStatus().status, 'active');
    assert.equal(dom.doc.documentElement.getAttribute('data-ag-prism-project-partitions'), '1');
    assert.ok(dom.doc.getElementById('ag-prism-project-partitions-css'));

    assert.equal(ctrl.createPartition('   ').ok, false);
    const devRes = ctrl.createPartition('Develop');
    assert.equal(devRes.ok, true);
    assert.equal(ctrl.createPartition('develop').ok, false);
    const toolsRes = ctrl.createPartition('Tools');
    assert.equal(toolsRes.ok, true);

    assert.equal(ctrl.renamePartition(toolsRes.partition.id, 'DevTools').ok, true);
    ctrl.movePartition(toolsRes.partition.id, -1);
    assert.deepEqual(ctrl.getState().partitions.map((p) => p.name), ['DevTools', 'Develop']);

    ctrl.assignProjectToPartition('proj-alpha', devRes.partition.id);
    ctrl.toggleProjectExpanded('proj-alpha', true);
    ctrl.renderPartitions();

    const rootNode = dom.sidebar.querySelector('.ag-prism-partitions-root');
    assert.ok(rootNode);
    assert.equal(rootNode.parentElement, dom.sidebar);
    assert.equal(rootNode.querySelectorAll('.ag-prism-part-section').length, 2);

    // Wave P3 renderSig short-circuit: repeated renderPartitions with unchanged state skips replaceChildren
    const countBefore = rootNode._replaceCount || 0;
    ctrl.renderPartitions();
    ctrl.renderPartitions();
    assert.equal(rootNode._replaceCount || 0, countBefore, 'renderSig must short-circuit redundant replaceChildren rebuilds');

    const level2Rows = rootNode.querySelectorAll('.ag-prism-part-project');
    assert.equal(level2Rows.length, 1);
    assert.equal(level2Rows[0].getAttribute('data-project-id'), 'proj-alpha');

    const level3Rows = rootNode.querySelectorAll('.ag-prism-part-conv-row');
    assert.equal(level3Rows.length, 2);
    assert.equal(level3Rows[0].getAttribute('data-cascade-id'), 'conv-2');
    assert.equal(level3Rows[1].getAttribute('data-cascade-id'), 'conv-1');

    level3Rows[0].click();
    assert.equal(dom.navCalls.length, 1);
    assert.deepEqual(dom.navCalls[0], { to: '/c/$cascadeId', params: { cascadeId: 'conv-2' } });

    const hideCss = dom.doc.getElementById('ag-prism-part-hide-css');
    assert.ok(hideCss);
    assert.match(hideCss.textContent, /data-sidebar-section-drop-id="proj-alpha"/);
    assert.match(hideCss.textContent, /data-sidebar-section-id="proj-alpha"/);
    assert.match(hideCss.textContent, /height:\s*0\s*!important/);
    assert.equal(dom.virtualInner.style.height, '420px');
    assert.equal(dom.projectsHeader.style.transform, 'translateY(0px)');
    assert.equal(dom.convsHeader.style.transform, 'translateY(99px)');

    // Native project `...` menu injection + Read-then-Write submenu check
    const moreBtn = dom.nativeProjectRows[1].querySelector('button[aria-haspopup="menu"]');
    ctrl.recordProjectTriggerFromEvent(moreBtn);
    const nativeMenu = dom.doc.createElement('div');
    nativeMenu.setAttribute('role', 'menu');
    const nativeItem = dom.doc.createElement('div');
    nativeItem.setAttribute('role', 'menuitem');
    nativeItem.textContent = 'Delete project';
    nativeMenu.appendChild(nativeItem);
    dom.doc.body.appendChild(nativeMenu);

    assert.equal(ctrl.tryInjectIntoNativeMenu(nativeMenu), true);
    const partMenuItem = nativeMenu.querySelector('.ag-prism-part-menu-item');
    assert.ok(partMenuItem);
    dom.orderLog.length = 0;
    partMenuItem.click();
    assert.deepEqual(dom.orderLog.slice(0, 2), ['read-anchor-rect', 'append-popup'], 'openPartitionSubmenu must read anchor rect before appendChild');

    const submenu = dom.doc.querySelector('.ag-prism-part-popup');
    assert.ok(submenu);
    const submenuItems = submenu.querySelectorAll('.ag-prism-part-popup-item');
    assert.ok(submenuItems.length >= 2);
    submenuItems[0].click();
    assert.equal(ctrl.getState().projectToPartition['proj-beta'], toolsRes.partition.id);

    ctrl.deletePartition(toolsRes.partition.id);
    assert.equal(ctrl.getState().projectToPartition['proj-beta'], undefined);

    // P1-1: partial/shrunk host catalog must NEVER auto-delete existing projectToPartition or expandedProjects
    dom.setProjects([projects[1]]);
    ctrl.renderPartitions();
    assert.equal(ctrl.getState().projectToPartition['proj-alpha'], devRes.partition.id, 'P1-1: partial catalog must preserve existing partition mapping');
    assert.equal(ctrl.getState().expandedProjects['proj-alpha'], true, 'P1-1: partial catalog must preserve expanded state');

    // Only explicit unassign removes mapping
    ctrl.assignProjectToPartition('proj-alpha', null);
    assert.equal(ctrl.getState().projectToPartition['proj-alpha'], undefined);

    ctrl.destroy();
    assert.equal(domBusUnsubCalls, 1, 'destroy() must unsubscribe from __agPrismDomBus');
    assert.equal(ctrl.getStatus().status, 'destroyed');
    assert.equal(dom.doc.documentElement.getAttribute('data-ag-prism-project-partitions'), null);
    assert.equal(dom.doc.getElementById('ag-prism-project-partitions-css'), null);
    assert.equal(dom.doc.getElementById('ag-prism-part-hide-css'), null);
    assert.equal(dom.doc.querySelector('.ag-prism-partitions-root'), null);
    assert.equal(dom.doc.querySelector('.ag-prism-part-popup'), null);
  } finally {
    globalThis.window = origWindow;
    globalThis.document = origDoc;
  }
});

test('Wave P3 partitions-host: store.subscribe skips unchanged snapshot refs and coalesces rapid bursts', async () => {
  let summariesRef = { c1: { trajectoryType: 4, summary: 'A' } };
  let projectsRef = [{ id: 'p1', name: 'P1' }];
  let storeState = { trajectorySummaries: { summaries: summariesRef }, unrelatedSlice: 0 };
  const subs = new Set();
  const store = {
    getState: () => storeState,
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
  const services = {
    core: {
      projectManagementService: {
        projectsStateProvider: { getState: () => projectsRef },
        onDidAnyProjectChange: () => ({ dispose() {} }),
      },
    },
  };
  const win = { location: { pathname: '/' } };
  let changeCalls = 0;
  const bridge = partitionsHost.createHostBridge({
    win,
    doc: null,
    hostStore: store,
    hostServices: services,
    hostRouter: { navigate: () => {} },
    onHostChange: () => { changeCalls += 1; },
  });
  bridge.probe();

  // Unrelated slice dispatch (same summaries/projects/pathname refs) -> 0 callbacks
  storeState = { trajectorySummaries: { summaries: summariesRef }, unrelatedSlice: 1 };
  for (const fn of subs) fn();
  storeState = { trajectorySummaries: { summaries: summariesRef }, unrelatedSlice: 2 };
  for (const fn of subs) fn();
  assert.equal(changeCalls, 0, 'unchanged summaries/projects/pathname references must not trigger onHostChange');

  // Burst of 5 real changes within 160ms -> leading edge fires once, trailing coalesces to 1
  for (let i = 0; i < 5; i++) {
    summariesRef = { c1: { trajectoryType: 4, summary: `B${i}` } };
    storeState = { trajectorySummaries: { summaries: summariesRef } };
    for (const fn of subs) fn();
  }
  assert.equal(changeCalls, 1, 'rapid burst should coalesce via leading+trailing 160ms throttle');
  await new Promise((r) => setTimeout(r, 210));
  assert.equal(changeCalls, 2, 'trailing edge should flush once after throttle window');
  bridge.dispose();
});

test('persistence: project-partitions.json atomic store, PROTECTED_USER_PATHS, and controller cross-port restore & migration', () => {
  const { PROTECTED_USER_PATHS } = require(path.join(ROOT, 'src', 'platform', 'install-manifest.cjs'));
  assert.ok(PROTECTED_USER_PATHS.includes('project-partitions.json'), 'project-partitions.json must be protected across upgrades');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-part-store-'));
  const filePath = path.join(tmpDir, 'project-partitions.json');
  try {
    const emptyRes = cdp.readProjectPartitionsData(filePath);
    assert.equal(emptyRes.exists, false);
    assert.equal(Object.getPrototypeOf(emptyRes.data.projectToPartition), null);
    assert.equal(Object.getPrototypeOf(emptyRes.data.expandedProjects), null);
    assert.deepEqual(JSON.parse(JSON.stringify(emptyRes.data)), { version: 1, partitions: [], projectToPartition: {}, expandedProjects: {} });

    const written = cdp.writeProjectPartitionsData(
      {
        partitions: [
          { id: 'part-1', name: '  Develop  ', collapsed: 1 },
          { id: 'part-1', name: 'Duplicate ID ignored' },
          { id: '', name: 'Empty ID ignored' },
        ],
        projectToPartition: { 'proj-alpha': 'part-1', 'proj-bad': 'nonexistent' },
        expandedProjects: { 'proj-alpha': 1, 'proj-false': false },
      },
      filePath
    );
    assert.equal(Object.getPrototypeOf(written.projectToPartition), null);
    assert.equal(Object.getPrototypeOf(written.expandedProjects), null);
    assert.deepEqual(JSON.parse(JSON.stringify(written)), {
      version: 1,
      partitions: [{ id: 'part-1', name: 'Develop', collapsed: true }],
      projectToPartition: { 'proj-alpha': 'part-1' },
      expandedProjects: { 'proj-alpha': true },
    });

    const readBack = cdp.readProjectPartitionsData(filePath);
    assert.equal(readBack.exists, true);
    assert.deepEqual(readBack.data, written);

    fs.writeFileSync(filePath, '{corrupt', 'utf8');
    assert.equal(cdp.readProjectPartitionsData(filePath).exists, false);

    const dom = createPartitionsMiniDom({ projects: [], summaries: {} });
    const bindingPayloads = [];
    dom.win[cdp.PARTITIONS_BINDING] = (raw) => bindingPayloads.push(JSON.parse(raw));
    const origW = globalThis.window;
    const origD = globalThis.document;
    globalThis.window = dom.win;
    globalThis.document = dom.doc;
    try {
      const ctrl = partitionsFactory.mountProjectPartitions({
        root: dom.win,
        doc: dom.doc,
        config: { projectPartitions: 'on', language: 'en' },
        initialState: written,
        hasPersistedState: true,
        persistBinding: cdp.PARTITIONS_BINDING,
      });
      assert.deepEqual(ctrl.getState().partitions, written.partitions);
      assert.equal(ctrl.getState().projectToPartition['proj-alpha'], 'part-1');
      assert.equal(bindingPayloads[0]?.action, 'load', 'init should request freshest disk state');

      const added = ctrl.createPartition('Tools');
      assert.equal(added.ok, true);
      const saveCall = bindingPayloads.find((p) => p.action === 'save');
      assert.ok(saveCall, 'mutations must call persistBinding save');
      assert.deepEqual(saveCall.data.partitions.map((p) => p.name), ['Develop', 'Tools']);

      dom.win.localStorage.removeItem(partitionsFactory.STORAGE_KEY);
      ctrl.applyPersistedState(written, true);
      assert.deepEqual(ctrl.getState().partitions.map((p) => p.name), ['Develop']);
      assert.ok(dom.win.localStorage.getItem(partitionsFactory.STORAGE_KEY).includes('Develop'));

      bindingPayloads.length = 0;
      ctrl.applyPersistedState(null, false);
      assert.equal(bindingPayloads.length, 1);
      assert.equal(bindingPayloads[0].action, 'save');
      assert.deepEqual(bindingPayloads[0].data.partitions.map((p) => p.name), ['Develop']);

      ctrl.destroy();
    } finally {
      globalThis.window = origW;
      globalThis.document = origD;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('RpcDispatcher: PARTITIONS_BINDING enforces trusted context, feature gate, 64KB cap, disk save/load, and peer broadcast', async () => {
  const { RpcDispatcher } = await import('../src/daemon/rpc-dispatcher.mjs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-part-rpc-'));
  const filePath = path.join(tmpDir, 'project-partitions.json');
  try {
    let featureEnabled = true;
    const fakeCdp = {
      SETTING_BINDING: cdp.SETTING_BINDING,
      LEGACY_SETTING_BINDING: cdp.LEGACY_SETTING_BINDING,
      PARTITIONS_BINDING: cdp.PARTITIONS_BINDING,
      readConfig: () => ({ projectPartitions: featureEnabled ? 'on' : 'off' }),
      shouldEnableProjectPartitions: (cfg) => cfg?.projectPartitions === 'on',
      readProjectPartitionsData: () => cdp.readProjectPartitionsData(filePath),
      writeProjectPartitionsData: (raw) => cdp.writeProjectPartitionsData(raw, filePath),
    };

    const makeEntry = (id, { trusted = true } = {}) => {
      const evals = [];
      const ctxMeta = { frameId: 'main-frame', isDefault: true, type: 'default', docGen: 1 };
      return {
        id,
        evals,
        sidebarHostVerified: trusted,
        sidebarDocument: 1,
        sidebarVerifiedDocument: 1,
        sidebarHostContextId: 10,
        mainFrameId: 'main-frame',
        hasFrameTree: true,
        contextFrames: new Map([
          [10, ctxMeta],
          [99, { frameId: 'child-iframe', isDefault: true, type: 'default', docGen: 1 }],
        ]),
        session: {
          closed: false,
          async send(method, params) {
            if (method === 'Runtime.evaluate') evals.push(params);
            return {};
          },
        },
      };
    };

    const entryA = makeEntry('A', { trusted: true });
    const entryB = makeEntry('B', { trusted: true });
    const entryUntrusted = makeEntry('C', { trusted: false });
    const sessions = new Map([['a', entryA], ['b', entryB], ['c', entryUntrusted]]);

    const rpc = new RpcDispatcher({
      getCdp: () => fakeCdp,
      sessionRegistry: { sessions },
      channelOrchestrator: { isRunning: () => true },
    });

    await rpc.handleBindingCall(entryA, {
      name: cdp.PARTITIONS_BINDING,
      payload: JSON.stringify({ action: 'save', data: { partitions: [{ id: 'p1', name: 'Evil' }] } }),
      executionContextId: 99,
    });
    assert.equal(fs.existsSync(filePath), false, 'iframe context must be rejected fail-closed');

    await rpc.handleBindingCall(entryA, {
      name: cdp.PARTITIONS_BINDING,
      payload: JSON.stringify({ action: 'save', pad: 'x'.repeat(70000) }),
      executionContextId: 10,
    });
    assert.equal(fs.existsSync(filePath), false, 'oversized payload must be rejected');

    featureEnabled = false;
    await rpc.handleBindingCall(entryA, {
      name: cdp.PARTITIONS_BINDING,
      payload: JSON.stringify({ action: 'save', data: { partitions: [{ id: 'p1', name: 'Disabled' }] } }),
      executionContextId: 10,
    });
    assert.equal(fs.existsSync(filePath), false, 'save must be rejected when projectPartitions is off');

    featureEnabled = true;
    const saveRes = await rpc.handleBindingCall(entryA, {
      name: cdp.PARTITIONS_BINDING,
      payload: JSON.stringify({
        action: 'save',
        data: { partitions: [{ id: 'p1', name: 'Develop', collapsed: false }], projectToPartition: { 'proj-1': 'p1' }, expandedProjects: {} },
      }),
      executionContextId: 10,
    });
    assert.equal(saveRes.ok, true);
    assert.equal(cdp.readProjectPartitionsData(filePath).data.partitions[0].name, 'Develop');
    assert.equal(entryA.evals.length, 0);
    assert.equal(entryB.evals.length, 1);
    assert.match(entryB.evals[0].expression, /applyPersistedState/);
    assert.match(entryB.evals[0].expression, /Develop/);
    assert.equal(entryUntrusted.evals.length, 0, 'untrusted peer must not receive broadcast');

    const loadRes = await rpc.handleBindingCall(entryA, {
      name: cdp.PARTITIONS_BINDING,
      payload: JSON.stringify({ action: 'load' }),
      executionContextId: 10,
    });
    assert.equal(loadRes.ok, true);
    assert.equal(loadRes.exists, true);
    assert.equal(entryA.evals.length, 1);
    assert.match(entryA.evals[0].expression, /applyPersistedState/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('inject.js P0-3 partitions-binding helper: enforces sidebarHostVerified, docGen, removeBinding, and fail-closed peer broadcast', async () => {
  const helper = require(path.join(ROOT, 'src', 'cdp', 'partitions-binding.cjs'));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-part-inj-'));
  const filePath = path.join(tmpDir, 'project-partitions.json');
  try {
    const callsA = [];
    const callsB = [];
    const callsBad = [];
    const mkSess = (log) => ({
      closed: false,
      async send(method, params) { log.push([method, params]); return {}; },
    });
    const entryA = {
      session: mkSess(callsA),
      sidebarHostVerified: false,
      projectPartitionsBindingAdded: false,
      projectPartitionsBindingPending: null,
      mainFrameId: 'main-A',
      docGen: 2,
      contextFrames: new Map([[11, { frameId: 'main-A', isDefault: true, type: 'default', docGen: 2 }]]),
    };
    const entryB = {
      session: mkSess(callsB),
      sidebarHostVerified: true,
      mainFrameId: 'main-B',
      docGen: 3,
      contextFrames: new Map([[22, { frameId: 'main-B', isDefault: true, type: 'default', docGen: 3 }]]),
    };
    const entryStale = {
      session: mkSess(callsBad),
      sidebarHostVerified: true,
      mainFrameId: 'main-C',
      docGen: 4,
      contextFrames: new Map([[33, { frameId: 'main-C', isDefault: true, type: 'default', docGen: 3 }]]),
    };
    const attached = new Map([['a', entryA], ['b', entryB], ['c', entryStale]]);

    // Unverified host must not register binding
    assert.equal(await helper.ensurePartitionsBinding(entryA.session, entryA, { projectPartitions: 'on' }, cdp.PARTITIONS_BINDING), false);
    assert.equal(callsA.length, 0);

    // Verified host registers binding once & removes symmetrically when toggled off
    entryA.sidebarHostVerified = true;
    assert.equal(await helper.ensurePartitionsBinding(entryA.session, entryA, { projectPartitions: 'on' }, cdp.PARTITIONS_BINDING), true);
    assert.equal(callsA[0][0], 'Runtime.addBinding');
    assert.equal(await helper.ensurePartitionsBinding(entryA.session, entryA, { projectPartitions: 'off' }, cdp.PARTITIONS_BINDING), false);
    assert.equal(callsA[1][0], 'Runtime.removeBinding');
    assert.equal(entryA.projectPartitionsBindingAdded, false);

    // Save broadcasts ONLY to verified peer B with matching docGen contextId=22 (skips stale docGen peer C)
    callsA.length = 0;
    const ok = await helper.handlePartitionsBindingCall({
      session: entryA.session,
      entry: entryA,
      payload: JSON.stringify({ action: 'save', data: { partitions: [{ id: 'p1', name: 'Core' }] } }),
      executionContextId: 11,
      attached,
      isTrustedMainFrameContext: (e, cid) => e.contextFrames.has(cid),
      readConfig: () => ({ projectPartitions: 'on' }),
      readProjectPartitionsData: () => cdp.readProjectPartitionsData(filePath),
      writeProjectPartitionsData: (d) => cdp.writeProjectPartitionsData(d, filePath),
    });
    assert.equal(ok, true);
    assert.equal(callsB.length, 1);
    assert.equal(callsB[0][1].contextId, 22);
    assert.equal(callsBad.length, 0, 'peer with mismatched docGen must be skipped fail-closed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('hardening: prototype-key injection (__proto__/constructor/prototype/valueOf), 500/128 caps, and win.cancelAnimationFrame', () => {
  const maliciousPayload = JSON.parse(
    '{"partitions":[{"id":"p1","name":"Core","collapsed":false}],"projectToPartition":{"__proto__":"p1","constructor":"p1","prototype":"p1","valueOf":"p1","safe-proj":"p1"},"expandedProjects":{"__proto__":true,"constructor":true,"prototype":true,"toString":true}}'
  );

  // 1) Backend store normalizer: null-prototype maps + forbidden keys stripped
  const storeNorm = cdp.normalizeProjectPartitionsData(maliciousPayload);
  assert.equal(Object.getPrototypeOf(storeNorm.projectToPartition), null, 'store projectToPartition must use null prototype');
  assert.equal(Object.getPrototypeOf(storeNorm.expandedProjects), null, 'store expandedProjects must use null prototype');
  assert.equal(Object.prototype.hasOwnProperty.call(storeNorm.projectToPartition, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(storeNorm.projectToPartition, 'constructor'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(storeNorm.projectToPartition, 'prototype'), false);
  assert.equal(storeNorm.projectToPartition['toString'], undefined, 'unassigned Object.prototype key must not collide');
  assert.equal(storeNorm.projectToPartition['valueOf'], 'p1');
  assert.equal(storeNorm.projectToPartition['safe-proj'], 'p1');
  assert.equal(Object.prototype.hasOwnProperty.call(storeNorm.expandedProjects, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(storeNorm.expandedProjects, 'constructor'), false);
  assert.equal(storeNorm.expandedProjects['valueOf'], undefined);
  assert.equal(storeNorm.expandedProjects['toString'], true);

  // 2) Host normalizer: null-prototype maps + forbidden keys stripped + 500 entries / 128-char key cap aligned with store
  const hostNorm = partitionsHost.normalizePartitionsState(maliciousPayload);
  assert.equal(Object.getPrototypeOf(hostNorm.projectToPartition), null, 'host projectToPartition must use null prototype');
  assert.equal(Object.getPrototypeOf(hostNorm.expandedProjects), null, 'host expandedProjects must use null prototype');
  assert.equal(Object.prototype.hasOwnProperty.call(hostNorm.projectToPartition, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(hostNorm.projectToPartition, 'constructor'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(hostNorm.projectToPartition, 'prototype'), false);
  assert.equal(hostNorm.projectToPartition['toString'], undefined);
  assert.equal(hostNorm.projectToPartition['valueOf'], 'p1');

  const bigP2p = {};
  const bigExp = {};
  for (let i = 0; i < 620; i++) {
    const k = `proj-${i}-${'a'.repeat(140)}`;
    bigP2p[k] = 'p1';
    bigExp[k] = true;
  }
  const capped = partitionsHost.normalizePartitionsState({
    partitions: [{ id: 'p1', name: 'Cap' }],
    projectToPartition: bigP2p,
    expandedProjects: bigExp,
  });
  const cappedP2pKeys = Object.keys(capped.projectToPartition);
  const cappedExpKeys = Object.keys(capped.expandedProjects);
  assert.equal(cappedP2pKeys.length, 500, 'host projectToPartition must cap at 500 entries');
  assert.equal(cappedExpKeys.length, 500, 'host expandedProjects must cap at 500 entries');
  assert.ok(cappedP2pKeys.every((k) => k.length <= 128), 'host projectToPartition keys must cap at 128 chars');
  assert.ok(cappedExpKeys.every((k) => k.length <= 128), 'host expandedProjects keys must cap at 128 chars');

  // 3) Controller: blocks __proto__/constructor/prototype mutations, safely handles valueOf/toString project IDs, and uses win.cancelAnimationFrame
  const projects = [
    { id: 'valueOf', name: 'ValueOfRepo', projectResources: { resources: [] } },
    { id: 'toString', name: 'ToStringRepo', projectResources: { resources: [] } },
  ];
  const dom = createPartitionsMiniDom({ projects, summaries: {} });
  let cancelledRafIds = [];
  let rafSeq = 100;
  dom.win.requestAnimationFrame = () => ++rafSeq;
  dom.win.cancelAnimationFrame = function cancelSpy(id) {
    assert.equal(this, dom.win, 'win.cancelAnimationFrame must preserve win receiver binding');
    cancelledRafIds.push(id);
  };
  const origW = globalThis.window;
  const origD = globalThis.document;
  globalThis.window = dom.win;
  globalThis.document = dom.doc;
  try {
    const ctrl = partitionsFactory.mountProjectPartitions({
      root: dom.win,
      doc: dom.doc,
      config: { projectPartitions: 'on', language: 'en' },
    });
    const part = ctrl.createPartition('SafeGroup').partition;
    ctrl.assignProjectToPartition('__proto__', part.id);
    ctrl.assignProjectToPartition('constructor', part.id);
    ctrl.assignProjectToPartition('prototype', part.id);
    ctrl.toggleProjectExpanded('__proto__', true);
    ctrl.toggleProjectExpanded('constructor', true);
    const st1 = ctrl.getState();
    assert.deepEqual(Object.keys(st1.projectToPartition), [], 'dangerous prototype keys must never be assigned');
    assert.deepEqual(Object.keys(st1.expandedProjects), [], 'dangerous prototype keys must never be expanded');

    // Unassigned valueOf/toString must NOT appear assigned/expanded; explicit assign works safely
    ctrl.renderPartitions();
    assert.equal(dom.sidebar.querySelectorAll('.ag-prism-part-project').length, 0);
    ctrl.assignProjectToPartition('valueOf', part.id);
    ctrl.renderPartitions();
    const rows = dom.sidebar.querySelectorAll('.ag-prism-part-project');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].getAttribute('data-project-id'), 'valueOf');

    // Toggle schedules deferred rAF, then destroy cancels it via win.cancelAnimationFrame
    ctrl.toggleProjectExpanded('valueOf', true);
    ctrl.destroy();
    assert.ok(cancelledRafIds.length >= 1, 'destroy() must cancel pending rAF via win.cancelAnimationFrame');
  } finally {
    globalThis.window = origW;
    globalThis.document = origD;
  }
});

test('hardening: Ch17 tracksSkippedNonHost removes PARTITIONS_BINDING on skipped-non-host, keeps off=0B/0-binding, and exposes manifest partitionsBinding', async () => {
  const { recordTrackableSkipOutcome, applyAllChannelsToEntry } = await import('../src/daemon/channel-sync-engine.mjs');
  const { createManifest } = await import('../scripts/build-common.mjs');
  const { PrismDaemon } = await import('../sidecars/daemon/main.mjs');

  // 1) Registry metadata + manifest symmetry
  const spec = cdp.findChannel('projectPartitions');
  assert.equal(spec.tracksSkippedNonHost, true, 'projectPartitions must declare tracksSkippedNonHost=true');
  assert.equal(spec.fields.skippedField, 'projectPartitionsSkipped', 'projectPartitions must declare skippedField');
  const manifest = createManifest();
  assert.equal(manifest.partitionsBinding, cdp.PARTITIONS_BINDING, 'createManifest() must expose partitionsBinding');

  // 2) skipped-non-host marks projectPartitionsSkipped=true and immediately calls Runtime.removeBinding
  const sent = [];
  const entry = {
    projectPartitionsMounted: false,
    projectPartitionsSkipped: false,
    projectPartitionsBindingAdded: true,
    projectPartitionsScriptId: 'scr-17',
    lastProjectPartitionsSig: '',
    session: {
      closed: false,
      async send(method, params) {
        sent.push([method, params]);
        return {};
      },
    },
  };
  await recordTrackableSkipOutcome({ getCdp: () => cdp }, entry, spec, { ok: false, status: 'skipped-non-host' }, 'hash17');
  assert.equal(entry.projectPartitionsMounted, false);
  assert.equal(entry.projectPartitionsSkipped, true, 'skipped-non-host must mark projectPartitionsSkipped=true');
  assert.equal(entry.projectPartitionsBindingAdded, false, 'skipped-non-host must clear projectPartitionsBindingAdded');
  assert.equal(
    sent.some(([m, p]) => m === 'Runtime.removeBinding' && p?.name === cdp.PARTITIONS_BINDING),
    true,
    'skipped-non-host must immediately revoke PARTITIONS_BINDING'
  );

  // 3) Default off config must still perform 0 compile and 0 Runtime.addBinding for projectPartitions
  const daemon = new PrismDaemon({
    rootDir: ROOT,
    bundleCachePath: false,
    silent: true,
    enableAutoUpdateTimer: false,
    enableStorageGuardTimer: false,
  });
  try {
    daemon._cdp = { ...cdp, readConfig: () => ({ ...cdp.DEFAULT_CONFIG, projectPartitions: 'off' }) };
    daemon.channelOrchestrator.ensureOmniServer = async () => null;
    daemon.rebuildBundle();
    assert.equal(daemon.channelOrchestrator.getChannelExpr('projectPartitions'), '', 'projectPartitions=off must compile to empty string');
    const applySends = [];
    const offEntry = {
      sidebarDocument: 0,
      contextFrames: new Map(),
      session: {
        closed: false,
        async send(method, params) {
          applySends.push([method, params]);
          return method === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: 'id-1' } : {};
        },
        async evaluate() {
          return { status: 'ok', ok: true };
        },
      },
    };
    await applyAllChannelsToEntry(daemon.channelOrchestrator, offEntry);
    assert.equal(offEntry.projectPartitionsSkipped, false);
    assert.equal(
      applySends.some(([m, p]) => m === 'Runtime.addBinding' && p?.name === cdp.PARTITIONS_BINDING),
      false,
      'projectPartitions=off must never call Runtime.addBinding for PARTITIONS_BINDING'
    );
  } finally {
    await daemon.stop(false, { skipAutoArchive: true });
  }
});
