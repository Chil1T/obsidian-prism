// Wave 5 B 专项回归单测：Issue #112 Diff 视图误翻隔离 + 非 Git 安全快照 + v2.35.2 Fiber 补丁提取 + Agent 审阅卡片
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

import { readSafeInlineDiff } from '../src/daemon/inline-diff-service.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const hostI18n = require(path.join(ROOT, 'vendor', 'host-i18n', 'host-i18n-runtime.js'));
const hostDict = require(path.join(ROOT, 'vendor', 'host-i18n', 'zh-CN.json'));
const inlineDiff = require(path.join(ROOT, 'vendor', 'inline-diff', 'inline-diff-client.js'));
const cdp = require(path.join(ROOT, 'cdp.js'));

function createI18nMiniEnv() {
  const makeText = (val) => ({
    nodeType: 3,
    nodeValue: String(val),
    parentElement: null,
    parentNode: null,
    isConnected: true,
    get textContent() { return this.nodeValue; },
    set textContent(v) { this.nodeValue = String(v); },
    get nextSibling() {
      if (!this.parentNode) return null;
      const list = this.parentNode.childNodes;
      const idx = list.indexOf(this);
      return idx >= 0 ? list[idx + 1] || null : null;
    },
  });

  const makeEl = (tag, opts = {}) => {
    const attrs = new Map(Object.entries(opts.attrs || {}));
    const classes = new Set(String(opts.className || '').split(/\s+/).filter(Boolean));
    const childNodes = [];
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      id: opts.id || attrs.get('id') || '',
      isContentEditable: false,
      parentElement: null,
      parentNode: null,
      isConnected: true,
      childNodes,
      style: { setProperty() {}, removeProperty() {} },
      classList: {
        contains: (c) => classes.has(c),
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
      },
      get className() { return Array.from(classes).join(' '); },
      set className(v) { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
      get children() { return childNodes.filter((c) => c.nodeType === 1); },
      get firstChild() { return childNodes[0] || null; },
      get firstElementChild() { return this.children[0] || null; },
      get lastElementChild() { const ch = this.children; return ch[ch.length - 1] || null; },
      get nextSibling() {
        if (!this.parentNode) return null;
        const list = this.parentNode.childNodes;
        const idx = list.indexOf(this);
        return idx >= 0 ? list[idx + 1] || null : null;
      },
      get textContent() { return childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join(''); },
      append(...nodes) {
        for (const n of nodes) {
          const item = typeof n === 'string' ? makeText(n) : n;
          item.parentElement = this;
          item.parentNode = this;
          childNodes.push(item);
        }
        return this;
      },
      appendChild(n) { return this.append(n); },
      setAttribute(k, v) { attrs.set(k, String(v)); if (k === 'id') this.id = String(v); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      addEventListener() {},
      removeEventListener() {},
      closest() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
    };
    if (opts.text !== undefined) el.append(makeText(opts.text));
    return el;
  };

  const html = makeEl('html');
  const body = makeEl('body');
  html.append(body);
  const doc = {
    readyState: 'complete',
    hidden: false,
    documentElement: html,
    body,
    createElement: (t) => makeEl(t),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  const win = {
    document: doc,
    location: { href: 'vscode-file://vscode-app/workbench.html' },
    addEventListener() {},
    removeEventListener() {},
  };
  return { win, doc, body, makeEl };
}

function createDiffClientMiniDom(lang = 'zh-CN') {
  const makeNode = (tag, attrs = {}) => {
    const am = new Map(Object.entries(attrs));
    const kids = [];
    const cls = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
    const elListeners = new Map();
    const n = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      children: kids,
      childNodes: kids,
      parentNode: null,
      parentElement: null,
      isConnected: true,
      _txt: '',
      style: {
        display: '',
        setProperty(k, v) { this[k] = String(v); },
        removeProperty(k) { delete this[k]; },
        getPropertyValue(k) { return this[k] || ''; },
      },
      get id() { return am.get('id') || ''; },
      set id(v) { if (v) am.set('id', String(v)); else am.delete('id'); },
      get className() { return [...cls].join(' '); },
      set className(v) {
        cls.clear();
        String(v || '').split(/\s+/).filter(Boolean).forEach((c) => cls.add(c));
        if (cls.size) am.set('class', [...cls].join(' '));
        else am.delete('class');
      },
      classList: {
        add: (...c) => c.forEach((x) => cls.add(x)),
        remove: (...c) => c.forEach((x) => cls.delete(x)),
        contains: (c) => cls.has(c),
      },
      get firstChild() { return kids[0] || null; },
      get textContent() { return kids.length && !n._txt ? kids.map((c) => c.textContent).join('') : n._txt; },
      set textContent(v) { kids.length = 0; n._txt = String(v ?? ''); },
      setAttribute(k, v) { am.set(k, String(v)); if (k === 'class') n.className = v; },
      getAttribute(k) { return am.has(k) ? am.get(k) : null; },
      hasAttribute(k) { return am.has(k); },
      removeAttribute(k) { am.delete(k); if (k === 'class') cls.clear(); },
      appendChild(c) { c.parentNode = c.parentElement = n; kids.push(c); return c; },
      insertBefore(c, ref) {
        c.parentNode = c.parentElement = n;
        const i = ref ? kids.indexOf(ref) : -1;
        if (i >= 0) kids.splice(i, 0, c);
        else kids.push(c);
        return c;
      },
      removeChild(c) {
        const i = kids.indexOf(c);
        if (i >= 0) kids.splice(i, 1);
        c.parentNode = c.parentElement = null;
        return c;
      },
      remove() { n.parentNode?.removeChild(n); },
      addEventListener(t, fn) { if (!elListeners.has(t)) elListeners.set(t, new Set()); elListeners.get(t).add(fn); },
      removeEventListener(t, fn) { elListeners.get(t)?.delete(fn); },
      dispatchEvent(ev) {
        const e = { target: n, preventDefault() {}, stopPropagation() {}, ...ev };
        for (const fn of elListeners.get(e.type) || []) fn(e);
      },
      click() { n.dispatchEvent({ type: 'click' }); },
      get nextElementSibling() {
        if (!n.parentNode) return null;
        const i = n.parentNode.children.indexOf(n);
        return i >= 0 ? n.parentNode.children[i + 1] || null : null;
      },
      matches(sel) {
        return String(sel || '').split(',').map((p) => p.trim()).some((part) => {
          if (!part) return false;
          if (part.startsWith('.')) return cls.has(part.slice(1));
          if (part.startsWith('#')) return am.get('id') === part.slice(1);
          const m = /^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/.exec(part);
          if (m) return m[2] === undefined ? am.has(m[1]) : am.get(m[1]) === m[2];
          return n.tagName === part.toUpperCase();
        });
      },
      closest(s) { let p = n; while (p) { if (p.matches?.(s)) return p; p = p.parentElement; } return null; },
      querySelector(s) { return n.querySelectorAll(s)[0] || null; },
      querySelectorAll(s) {
        const out = [];
        const walk = (x) => { for (const k of x.children) { if (k.matches?.(s)) out.push(k); walk(k); } };
        walk(n);
        return out;
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 28 }),
    };
    return n;
  };

  const html = makeNode('html', { 'data-ag-cs-lang': lang });
  const head = makeNode('head');
  const body = makeNode('body');
  html.appendChild(head);
  html.appendChild(body);
  const doc = {
    documentElement: html,
    head,
    body,
    readyState: 'complete',
    createElement: (t) => makeNode(t),
    createElementNS: (_ns, t) => makeNode(t),
    getElementById: (id) => html.querySelector(`#${id}`),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener() {},
    removeEventListener() {},
  };
  const win = {
    document: doc,
    innerWidth: 1280,
    innerHeight: 800,
    getComputedStyle: (el) => ({ display: 'flex', flexDirection: el?.className?.includes('flex-col') ? 'column' : 'row' }),
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: (fn) => { fn(16); return 1; },
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
  };
  return { win, doc, body, makeNode };
}

test('W5-1 (Issue #112): host-i18n skips all Monaco/Diff/Code viewer containers 100% while translating normal nav buttons', () => {
  const env = createI18nMiniEnv();
  const codeWords = ['System', 'Edit', 'Delete', 'View', 'Run'];

  // Confirm all test words really exist in zh-CN exact dictionary (so skipping proves boundary protection)
  for (const w of codeWords) {
    assert.ok(hostDict.exact[w] && hostDict.exact[w] !== w, `Expected "${w}" to have a zh-CN translation`);
  }

  const protectedContainers = [
    env.makeEl('div', { className: 'monaco-diff-editor' }),
    env.makeEl('div', { className: 'monaco-editor' }),
    env.makeEl('div', { className: 'diffOverview' }),
    env.makeEl('div', { className: 'view-lines' }),
    env.makeEl('div', { className: 'cdr' }),
    env.makeEl('div', { className: 'line-insert' }),
    env.makeEl('div', { className: 'line-delete' }),
    env.makeEl('div', { attrs: { 'data-testid': 'diff-editor' } }),
    env.makeEl('div', { attrs: { 'data-testid': 'diff-view' } }),
    env.makeEl('div', { attrs: { 'data-testid': 'diff-viewer' } }),
    env.makeEl('div', { attrs: { 'data-testid': 'diff-line' } }),
    env.makeEl('div', { attrs: { 'data-testid': 'diff-content' } }),
    env.makeEl('div', { attrs: { 'data-testid': 'diff-panel' } }),
    env.makeEl('div', { attrs: { 'data-testid': 'review-diff-pane' } }),
    env.makeEl('div', { attrs: { 'data-testid': 'code-viewer-panel' } }),
    env.makeEl('div', { attrs: { 'data-testid': 'file-viewer-root' } }),
    env.makeEl('div', { className: 'ag-cs-inline-diff-box' }),
    env.makeEl('div', { className: 'ag-cs-inline-diff-card' }),
    env.makeEl('div', { attrs: { 'data-ag-cs-inline-diff': '1' } }),
    env.makeEl('div', { className: 'sidebar-diff-editor_a1b2' }),
    env.makeEl('div', { className: 'custom-diff-view-wrapper' }),
    env.makeEl('div', { className: 'code-diff-line-item' }),
    env.makeEl('div', { className: 'diff-hunk-section' }),
    env.makeEl('div', { className: 'cm-editor' }),
    env.makeEl('div', { className: 'shiki-themes' }),
    env.makeEl('div', { className: 'hljs-keyword' }),
  ];

  const protectedSpans = [];
  for (const box of protectedContainers) {
    for (const w of codeWords) {
      const sp = env.makeEl('span', { text: w });
      box.append(sp);
      protectedSpans.push({ box, sp, orig: w });
    }
    // Even an interactive button nested inside a diff viewer must remain untouched
    const innerBtn = env.makeEl('button', { text: 'System' });
    box.append(innerBtn);
    protectedSpans.push({ box, sp: innerBtn, orig: 'System' });
    env.body.append(box);
  }

  // Normal host navigation buttons outside diff containers must still be translated
  const nav = env.makeEl('nav');
  const navBtns = codeWords.map((w) => {
    const b = env.makeEl('button', { text: w });
    nav.append(b);
    return { b, orig: w };
  });
  env.body.append(nav);

  const inst = hostI18n.mountHostI18n({
    root: env.win,
    doc: env.doc,
    mode: 'on',
    dict: hostDict,
    rafFn: (fn) => { fn(16); return 1; },
    cancelRafFn() {},
    setTimeoutFn: (fn) => { fn(); return 1; },
    clearTimeoutFn() {},
  });

  try {
    inst.scan();
    for (const { box, sp, orig } of protectedSpans) {
      assert.equal(
        hostI18n.isIgnoredBoundary(sp),
        true,
        `Node inside ${box.className || box.getAttribute('data-testid') || 'diff-attr'} must be ignored`
      );
      assert.equal(
        sp.textContent,
        orig,
        `Issue #112 regression: "${orig}" inside ${box.className || box.getAttribute('data-testid')} must NEVER be translated (got "${sp.textContent}")`
      );
    }
    for (const { b, orig } of navBtns) {
      assert.equal(hostI18n.isIgnoredBoundary(b), false, `Normal nav button "${orig}" must not be blocked`);
      assert.equal(b.textContent, hostDict.exact[orig], `Normal nav button "${orig}" must translate to "${hostDict.exact[orig]}"`);
    }
  } finally {
    inst.destroy();
  }
});

test('W5-2: v2.35.2 React Fiber patch extraction (TargetContent/ReplacementContent, oldString/newString, unifiedDiff, multi-chunk & LCS) + Agent review topbar', async () => {
  const { win, doc, body, makeNode } = createDiffClientMiniDom('zh-CN');

  // 2a) TargetContent / ReplacementContent nested inside Fiber memoizedProps (v2.35.2 style)
  const badge1 = makeNode('span', { 'data-testid': 'diff-line-count' });
  badge1.textContent = '+2 -1';
  badge1.__reactFiber$v2352 = {
    memoizedProps: {},
    return: {
      memoizedProps: {
        step: {
          toolCall: {
            args: {
              TargetFile: 'C:\\Users\\Administrator\\.gemini\\config\\skills\\t3code-dispatcher\\SKILL.md',
              StartLine: 10,
              TargetContent: 'alpha\noldLine\ngamma\n',
              ReplacementContent: 'alpha\nnewLineA\nnewLineB\ngamma\n',
            },
          },
        },
      },
      return: null,
    },
  };
  const p1 = inlineDiff.extractInlineDiffPayload(badge1, null, win);
  assert.equal(p1.source, 'step-patch');
  assert.equal(p1.fileName, 'SKILL.md');
  assert.ok(p1.lines.some((l) => l.kind === 'del' && l.ln === '11' && l.text === 'oldLine'));
  assert.ok(p1.lines.some((l) => l.kind === 'add' && l.ln === '11' && l.text === 'newLineA'));
  assert.ok(p1.lines.some((l) => l.kind === 'add' && l.ln === '12' && l.text === 'newLineB'));

  // 2b) oldString / newString inside Fiber memoizedState hook chain (non-contiguous LCS folds unchanged middle)
  const unchangedMid = Array.from({ length: 8 }, (_, i) => `keep_${i}`);
  const oldDoc = ['head', 'old_top', ...unchangedMid, 'old_bot', 'tail'].join('\n');
  const newDoc = ['head', 'new_top', ...unchangedMid, 'new_bot', 'tail'].join('\n');
  const badge2 = makeNode('span', { 'data-testid': 'diff-line-count' });
  badge2.__reactFiber$hook = {
    memoizedProps: {},
    memoizedState: {
      memoizedState: {
        filePath: '/repo/src/engine.mjs',
        edit: { oldString: oldDoc, newString: newDoc, startLine: 1 },
      },
      next: null,
    },
    return: null,
  };
  const p2 = inlineDiff.extractInlineDiffPayload(badge2, null, win);
  assert.equal(p2.source, 'step-patch');
  assert.equal(p2.fileName, 'engine.mjs');
  assert.equal(p2.additions, 2, 'LCS must isolate only the 2 modified additions');
  assert.equal(p2.deletions, 2, 'LCS must isolate only the 2 modified deletions');
  assert.ok(p2.lines.some((l) => l.kind === 'hunk'), 'LCS must fold long unchanged middle run into hunk separator');
  assert.equal(p2.lines.some((l) => l.kind === 'del' && l.text === 'keep_3'), false, 'Unchanged middle lines must not be marked deleted');

  // 2c) unifiedDiff & replacementChunks extraction
  const badge3 = makeNode('span', { 'data-testid': 'diff-line-count' });
  badge3.__reactFiber$uni = {
    memoizedProps: {
      fileDiff: {
        uri: 'file:///C:/repo/patch-demo.ts',
        unifiedDiff: '@@ -5,2 +5,2 @@\n-const v = 1;\n+const v = 2;\n export { v };',
      },
    },
    return: null,
  };
  const p3 = inlineDiff.extractInlineDiffPayload(badge3, null, win);
  assert.equal(p3.source, 'step-patch');
  assert.equal(p3.fileName, 'patch-demo.ts');
  assert.ok(p3.lines.some((l) => l.kind === 'del' && l.ln === '5' && l.text === 'const v = 1;'));
  assert.ok(p3.lines.some((l) => l.kind === 'add' && l.ln === '5' && l.text === 'const v = 2;'));

  const badge4 = makeNode('span', { 'data-testid': 'diff-line-count' });
  badge4.__reactFiber$chunks = {
    memoizedProps: {
      payload: {
        path: 'C:\\repo\\multi.js',
        replacementChunks: [
          { startLine: 3, targetContent: 'a = 1', replacementContent: 'a = 2' },
          { startLine: 40, before: 'b = 10', after: 'b = 20' },
        ],
      },
    },
    return: null,
  };
  const p4 = inlineDiff.extractInlineDiffPayload(badge4, null, win);
  assert.equal(p4.source, 'step-patch');
  assert.equal(p4.additions, 2);
  assert.equal(p4.deletions, 2);
  assert.ok(p4.lines.some((l) => l.kind === 'hunk'), 'Multiple replacementChunks must be separated by hunk divider');

  // 2d) Agent-grade review card topbar: filename + +/- chips + source badge + sidebar/collapse icon buttons
  let nativeClicks = 0;
  badge1.addEventListener('click', () => { nativeClicks++; });
  const col = makeNode('div', { class: 'flex flex-col' });
  const row = makeNode('div', { class: 'group flex w-full', 'data-testid': 'tool-call-row' });
  row.appendChild(badge1);
  col.appendChild(row);
  body.appendChild(col);

  const client = inlineDiff.createInlineDiffClient({ win, doc, getLang: () => 'zh-CN' });
  try {
    assert.equal(client.toggleInlineDiffPreview(badge1, { noAnim: true }), true);
    const box = col.querySelector('.ag-cs-inline-diff-box');
    assert.ok(box, 'Diff box must mount');
    assert.equal(box.querySelector('.ag-cs-inline-diff-head'), null, 'Must preserve D12 compatibility (no legacy .ag-cs-inline-diff-head)');
    const bar = box.querySelector('.ag-cs-inline-diff-bar');
    assert.ok(bar, 'Must render clean single-row .ag-cs-inline-diff-bar');
    assert.equal(bar.querySelector('.ag-cs-inline-diff-file')?.textContent, 'SKILL.md');
    assert.equal(bar.querySelector('.ag-cs-inline-diff-st-add')?.textContent, '+2');
    assert.equal(bar.querySelector('.ag-cs-inline-diff-st-del')?.textContent, '-1');
    const srcBadge = bar.querySelector('.ag-cs-inline-diff-src');
    assert.equal(srcBadge?.getAttribute('data-ag-diff-src'), 'step-patch');
    assert.equal(srcBadge?.textContent, '步骤补丁');

    const openSbBtn = bar.querySelector('[data-ag-diff-act="sidebar"]');
    const collapseBtn = bar.querySelector('[data-ag-diff-act="collapse"]');
    assert.ok(openSbBtn && collapseBtn, 'Topbar must provide minimal sidebar & collapse icon buttons');
    openSbBtn.click();
    assert.equal(nativeClicks, 1, 'Sidebar icon button must trigger native sidebar diff click');
    collapseBtn.click();
    assert.equal(Boolean(col.querySelector('.ag-cs-inline-diff-box')), false, 'Collapse icon button must close inline diff card');

    // RPC snapshot updates topbar badge to 当前快照
    const rpcRow = makeNode('div', { class: 'group flex w-full', 'data-testid': 'tool-call-row', 'data-ag-diff-uri': 'file:///C:/non-git/SKILL.md' });
    const rpcBadge = makeNode('span', { 'data-testid': 'diff-line-count' });
    rpcBadge.textContent = '+5 -0';
    rpcRow.appendChild(rpcBadge);
    col.appendChild(rpcRow);
    win.__agPrismInlineDiffCall = (raw) => {
      const req = JSON.parse(raw);
      queueMicrotask(() => win.__agPrismInlineDiffResolve?.(req.id, {
        ok: true,
        mode: 'snapshot',
        fileName: 'SKILL.md',
        additions: 0,
        deletions: 0,
        truncated: false,
        lines: [{ kind: 'ctx', ln: '1', sign: ' ', text: '# Skill Doc' }],
      }));
    };
    assert.equal(client.toggleInlineDiffPreview(rpcBadge, { noAnim: true }), true);
    await new Promise((r) => setTimeout(r, 20));
    const snapBox = rpcRow.nextElementSibling;
    assert.equal(snapBox?.querySelector('.ag-cs-inline-diff-src')?.getAttribute('data-ag-diff-src'), 'snapshot');
    assert.equal(snapBox?.querySelector('.ag-cs-inline-diff-src')?.textContent, '当前快照');
  } finally {
    client.destroy();
  }
});

test('W5-3: non-Git normal source/SKILL.md returns safe bounded snapshot while sensitive files & symlinks stay 100% blocked_sensitive', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-w5-nongit-'));
  try {
    const skillDir = path.join(tmpDir, '.gemini', 'config', 'skills', 't3code-dispatcher');
    fs.mkdirSync(skillDir, { recursive: true });
    const skillFile = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(skillFile, '# T3 Dispatcher\nLine 2\nLine 3\n', 'utf8');

    // Even with hints { additions: 10, deletions: 0 }, non-Git file must return mode='snapshot', additions=0, deletions=0
    const skillRes = await readSafeInlineDiff(pathToFileURL(skillFile).href, { hints: { additions: 10, deletions: 0 } });
    assert.equal(skillRes.ok, true, `Expected non-Git SKILL.md allowed, got ${JSON.stringify(skillRes)}`);
    assert.equal(skillRes.mode, 'snapshot');
    assert.equal(skillRes.fileName, 'SKILL.md');
    assert.equal(skillRes.additions, 0);
    assert.equal(skillRes.deletions, 0);
    assert.equal(skillRes.truncated, false);
    assert.deepEqual(skillRes.lines, [
      { kind: 'ctx', ln: '1', sign: ' ', text: '# T3 Dispatcher' },
      { kind: 'ctx', ln: '2', sign: ' ', text: 'Line 2' },
      { kind: 'ctx', ln: '3', sign: ' ', text: 'Line 3' },
    ]);

    // Line & byte truncation enforcement in non-Git directory
    const longFile = path.join(skillDir, 'long-guide.md');
    fs.writeFileSync(longFile, Array.from({ length: 120 }, (_, i) => `row-${i + 1}`).join('\n') + '\n', 'utf8');
    const longRes = await readSafeInlineDiff(longFile);
    assert.equal(longRes.ok, true);
    assert.equal(longRes.mode, 'snapshot');
    assert.equal(longRes.truncated, true);
    assert.equal(longRes.lines.length, 80);

    // Binary file detection still works in non-Git directory
    const binFile = path.join(skillDir, 'icon.bin');
    fs.writeFileSync(binFile, Buffer.from([0x50, 0x4b, 0x00, 0x03]));
    const binRes = await readSafeInlineDiff(binFile);
    assert.equal(binRes.ok, true);
    assert.equal(binRes.mode, 'binary');
    assert.deepEqual(binRes.lines, []);

    // Sensitive files in non-Git directory remain 100% blocked_sensitive
    const sensitiveFiles = [
      path.join(skillDir, 'config.json'),
      path.join(skillDir, '.env'),
      path.join(tmpDir, '.gemini', 'config', 'obsidian-prism-thought.json'),
    ];
    for (const sf of sensitiveFiles) {
      fs.writeFileSync(sf, 'SECRET=1\n', 'utf8');
      const r = await readSafeInlineDiff(sf);
      assert.equal(r.ok, false, `Sensitive file must be blocked: ${sf}`);
      assert.equal(r.error, 'blocked_sensitive');
    }

    // Symlink with benign name pointing to .env -> blocked_sensitive after realpathSync
    const linkPath = path.join(skillDir, 'safe-looking.md');
    let linked = false;
    try {
      fs.symlinkSync(path.join(skillDir, '.env'), linkPath, 'file');
      linked = true;
    } catch {}
    if (linked) {
      const lr = await readSafeInlineDiff(linkPath);
      assert.equal(lr.ok, false, 'Symlink to .env in non-Git dir must be blocked_sensitive');
      assert.equal(lr.error, 'blocked_sensitive');
    }

    // Malformed .git pointer in directory still fails closed (outside_git_repo)
    const badGitDir = path.join(tmpDir, 'bad-git');
    fs.mkdirSync(badGitDir, { recursive: true });
    fs.writeFileSync(path.join(badGitDir, '.git'), 'gitdir: \\\\evil.invalid\\share\\x\n', 'utf8');
    const badTarget = path.join(badGitDir, 'a.js');
    fs.writeFileSync(badTarget, 'const x = 1;\n', 'utf8');
    const badRes = await readSafeInlineDiff(badTarget);
    assert.equal(badRes.ok, false);
    assert.equal(badRes.error, 'outside_git_repo');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('W5-4: 0 innerHTML, 0 :has(), pure ASCII CSS, 8-locale 0-CJK leak, 0 BOM/CRLF, and Channel 6 <= 57,344 B budget', () => {
  const targetFiles = [
    'src/daemon/inline-diff-service.mjs',
    'vendor/inline-diff/inline-diff-client.js',
    'vendor/host-i18n/host-i18n-runtime.js',
  ];
  for (const rel of targetFiles) {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    const txt = buf.toString('utf8');
    assert.equal(buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, false, `${rel} must have 0 UTF-8 BOM`);
    assert.equal(buf.includes(0x0d), false, `${rel} must have 0 CRLF`);
    assert.equal(/\.\s*(?:innerHTML|outerHTML)\s*[+]?=(?!=)|\.\s*insertAdjacentHTML\s*\(/.test(txt), false, `${rel} must have 0 innerHTML/outerHTML/insertAdjacentHTML writes`);
  }

  // CSS hygiene on INLINE_DIFF_CSS
  assert.equal(/:has\(/.test(inlineDiff.INLINE_DIFF_CSS), false, 'INLINE_DIFF_CSS must have 0 :has()');
  assert.equal(/[^\x00-\x7f]/.test(inlineDiff.INLINE_DIFF_CSS), false, 'INLINE_DIFF_CSS must be 100% pure ASCII');
  assert.equal(
    (inlineDiff.INLINE_DIFF_CSS.match(/\{/g) || []).length,
    (inlineDiff.INLINE_DIFF_CSS.match(/\}/g) || []).length,
    'INLINE_DIFF_CSS braces must balance'
  );

  // 9-locale completeness & 0 CJK in non-CJK locales for all DIFF_FALLBACK keys (including new source badges)
  const clientSrc = fs.readFileSync(path.join(ROOT, 'vendor/inline-diff/inline-diff-client.js'), 'utf8');
  const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;
  const LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'tr'];
  const NON_CJK = ['en', 'ko', 'es', 'fr', 'de', 'tr'];
  for (const key of [
    'inlineDiffOpenSidebar', 'inlineDiffCollapse', 'inlineDiffLoading', 'inlineDiffBinary',
    'inlineDiffNoPreview', 'inlineDiffSensitive', 'inlineDiffSnapshotNotice', 'inlineDiffLongLinesTag',
    'inlineDiffMenuExpand', 'inlineDiffMenuCollapse', 'inlineDiffMenuCopyPath', 'inlineDiffLargeExpandBtn',
    'inlineDiffSrcPatch', 'inlineDiffSrcGit', 'inlineDiffSrcSnapshot',
  ]) {
    const km = new RegExp(`${key}\\s*:\\s*\\{([^\\n]+)\\}`).exec(clientSrc);
    assert.ok(km, `DIFF_FALLBACK missing key ${key}`);
    for (const loc of LOCALES) {
      const lm = new RegExp(`['"]?${loc}['"]?\\s*:\\s*'([^']+)'`).exec(km[1]);
      assert.ok(lm && lm[1].length > 0, `DIFF_FALLBACK.${key}[${loc}] missing`);
      if (NON_CJK.includes(loc)) {
        assert.equal(CJK_RE.test(lm[1]), false, `DIFF_FALLBACK.${key}[${loc}] leaked CJK: ${lm[1]}`);
      }
    }
  }

  // Channel 6 compiled payload <= 57,344 B
  const report = cdp.getChannelBudgetReport(cdp.DEFAULT_CONFIG, { noDiskCache: true });
  const ch6 = report.channels.find((c) => c.id === 'inlineDiff');
  assert.ok(ch6 && ch6.bytes > 0 && ch6.bytes <= 57344, `inlineDiff compiled ${ch6?.bytes} B exceeds 57,344 B budget`);
});
