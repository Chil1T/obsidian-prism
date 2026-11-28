// Module-domain test suite: Global 3-Tier Fonts, Channel 18 (customStyle), custom.css loader, Ch9 UI, daemon hot-reload & presets
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { assertFileHygiene } from './helpers/mini-dom.mjs';
import { PrismDaemon } from '../src/daemon/index.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');

const cdp = require(path.join(ROOT, 'cdp.js'));
const customCssLoader = require(path.join(ROOT, 'src', 'channels', 'custom-css-loader.cjs'));
const { createCustomStyleChannelBuilders } = require(path.join(ROOT, 'src', 'channels', 'builders-custom-style.cjs'));
const { PROTECTED_USER_PATHS, USER_OWNED_ASSET_PATHS } = require(path.join(ROOT, 'src', 'platform', 'install-manifest.cjs'));
const fontCustomizer = require(path.join(ROOT, 'src', 'runtime', 'font-customizer.js'));
const customStyleI18n = require(path.join(ROOT, 'vendor', 'custom-style', 'custom-style-i18n.js'));
const customStyleClient = require(path.join(ROOT, 'vendor', 'custom-style', 'custom-style-client.js'));
const customStyleSettingsUi = require(path.join(ROOT, 'vendor', 'custom-style', 'custom-style-settings-ui.js'));

const CANONICAL_9_LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'tr'];
const NON_CJK_LOCALES = ['en', 'ko', 'es', 'fr', 'de', 'tr'];
const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;
const FORBIDDEN_TERM_RE = /八方旅人|octopath/i;

const mkTempDir = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const stripJsComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
const extractTargetHash = (expr) => (typeof expr === 'string' && expr.match(/const targetHash = "([^"]+)";/)?.[1]) || '';

async function waitUntil(pred, timeoutMs = 3500, stepMs = 35) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return Boolean(await pred());
}

function createDomWithTraps(initialHtmlAttrs = {}) {
  let innerHtmlWrites = 0;
  const matches = (n, selList) =>
    String(selList || '').split(',').some((raw) => {
      const s = raw.trim();
      if (!s) return false;
      if (s.startsWith('#')) return n.id === s.slice(1);
      let rest = s;
      const tm = rest.match(/^[a-zA-Z0-9-]+/);
      if (tm) { if (n.tagName !== tm[0].toUpperCase()) return false; rest = rest.slice(tm[0].length); }
      for (const m of rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)) if (!n.classList.contains(m[1])) return false;
      for (const m of rest.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)) {
        if (!n.hasAttribute(m[1])) return false;
        if (m[2] !== undefined && n.getAttribute(m[1]) !== m[2]) return false;
      }
      return true;
    });

  const makeEl = (tag, doc) => {
    const attrs = new Map(), listeners = new Map(), kids = [];
    const el = {
      nodeType: 1, tagName: String(tag).toUpperCase(), id: '', className: '', textContent: '', value: '',
      hidden: false, disabled: false, tabIndex: 0, ownerDocument: doc, children: kids, parentNode: null, parentElement: null,
      style: { setProperty(k, v) { this[k] = String(v); }, removeProperty(k) { delete this[k]; } },
      classList: {
        add(c) { if (!el.className.split(/\s+/).includes(c)) el.className = `${el.className} ${c}`.trim(); },
        remove(c) { el.className = el.className.split(/\s+/).filter((x) => x !== c).join(' '); },
        contains(c) { return el.className.split(/\s+/).includes(c); },
      },
      get firstChild() { return kids[0] || null; },
      get lastElementChild() { return kids[kids.length - 1] || null; },
      get nextSibling() { const p = el.parentNode, i = p ? p.children.indexOf(el) : -1; return i >= 0 ? p.children[i + 1] || null : null; },
      setAttribute(k, v) { attrs.set(k, String(v)); if (k === 'id') el.id = String(v); if (k === 'hidden') el.hidden = true; },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); if (k === 'hidden') el.hidden = false; },
      appendChild(c) {
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = c.parentElement = el; kids.push(c);
        if (el.tagName === 'SELECT' && c.tagName === 'OPTION' && !el.value) el.value = c.value;
        return c;
      },
      insertBefore(c, ref) {
        if (c.parentNode) c.parentNode.removeChild(c);
        const i = ref ? kids.indexOf(ref) : -1;
        c.parentNode = c.parentElement = el;
        if (i < 0) kids.push(c); else kids.splice(i, 0, c);
        return c;
      },
      removeChild(c) { const i = kids.indexOf(c); if (i >= 0) kids.splice(i, 1); c.parentNode = c.parentElement = null; return c; },
      remove() { if (el.parentNode) el.parentNode.removeChild(el); },
      addEventListener(t, fn) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(fn); },
      removeEventListener(t, fn) { listeners.get(t)?.delete(fn); },
      dispatchEvent(ev) { for (const fn of [...(listeners.get(ev.type) || [])]) fn(ev); return true; },
      click() { if (!el.disabled) el.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} }); },
      querySelectorAll(sel) { const out = []; const w = (n) => { for (const ch of n.children || []) { if (matches(ch, sel)) out.push(ch); w(ch); } }; w(el); return out; },
      querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
    };
    Object.defineProperty(el, 'innerHTML', { configurable: true, get: () => '', set: () => { innerHtmlWrites += 1; } });
    return el;
  };

  const doc = {
    activeElement: null, defaultView: null, documentElement: null, head: null, body: null,
    createElement: (t) => makeEl(t, doc),
    getElementById: (id) => doc.documentElement.querySelector('#' + id),
    querySelector: (s) => doc.documentElement.querySelector(s),
    querySelectorAll: (s) => doc.documentElement.querySelectorAll(s),
  };
  doc.documentElement = makeEl('html', doc);
  doc.head = makeEl('head', doc);
  doc.body = makeEl('body', doc);
  for (const [k, v] of Object.entries(initialHtmlAttrs)) doc.documentElement.setAttribute(k, v);
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  return { doc, html: doc.documentElement, head: doc.head, body: doc.body, getInnerHtmlWrites: () => innerHtmlWrites };
}

test('custom-css-loader.cjs: status states, SHA-256, size/symlink guards, @import blocking & wx template', () => {
  const tmpDir = mkTempDir('prism-custom-css-loader-');
  const outsideDir = mkTempDir('prism-custom-css-outside-');
  try {
    // 1) Missing file & empty rootDir
    assert.equal(customCssLoader.readCustomCssSafe('   ').status, 'missing');
    const missing = customCssLoader.readCustomCssSafe(tmpDir);
    assert.deepEqual({ status: missing.status, css: missing.css, bytes: missing.bytes, sha256: missing.sha256, blockedImports: missing.blockedImports },
      { status: 'missing', css: '', bytes: 0, sha256: '', blockedImports: 0 });

    // 2) Empty & comment-only files -> 'empty'; DEFAULT_CUSTOM_CSS_TEMPLATE keeps comments with blockedImports===0
    const cssPath = path.join(tmpDir, 'custom.css');
    fs.writeFileSync(cssPath, '', 'utf8');
    assert.equal(customCssLoader.readCustomCssSafe(tmpDir).status, 'empty');
    fs.writeFileSync(cssPath, '  \n\t/* comment 1 */\n/* comment 2 */\n', 'utf8');
    const commentOnly = customCssLoader.readCustomCssSafe(tmpDir);
    assert.equal(commentOnly.status, 'empty');
    assert.equal(commentOnly.css, '');
    assert.equal(commentOnly.blockedImports, 0);

    const tplSan = customCssLoader.sanitizeCustomCssContent(customCssLoader.DEFAULT_CUSTOM_CSS_TEMPLATE);
    assert.equal(tplSan.blockedImports, 0);
    assert.equal(tplSan.css, customCssLoader.DEFAULT_CUSTOM_CSS_TEMPLATE);

    // 3) Active CSS + exact SHA-256 + BOM/NUL strip
    const activeBody = ':root { --ag-prism-ui-font: "Inter", sans-serif; }\n';
    fs.writeFileSync(cssPath, `\uFEFF${activeBody}\0`, 'utf8');
    const activeRes = customCssLoader.readCustomCssSafe(tmpDir);
    assert.equal(activeRes.status, 'active');
    assert.equal(activeRes.css, activeBody);
    assert.equal(activeRes.bytes, Buffer.byteLength(activeBody, 'utf8'));
    assert.equal(activeRes.sha256, crypto.createHash('sha256').update(activeBody, 'utf8').digest('hex'));
    assert.equal(activeRes.blockedImports, 0);

    // 4) Size cap: exact 256 KB accepted, 256 KB + 1 rejected
    const maxBytes = customCssLoader.MAX_CUSTOM_CSS_BYTES;
    assert.equal(maxBytes, 256 * 1024);
    const exactCss = ':root{--ag-prism-pad:"' + 'a'.repeat(maxBytes - 25) + '";}';
    assert.equal(Buffer.byteLength(exactCss, 'utf8'), maxBytes);
    fs.writeFileSync(cssPath, exactCss, 'utf8');
    assert.equal(customCssLoader.readCustomCssSafe(tmpDir).status, 'active');
    fs.writeFileSync(cssPath, exactCss + ' ', 'utf8');
    const tooLarge = customCssLoader.readCustomCssSafe(tmpDir);
    assert.equal(tooLarge.status, 'rejected-too-large');
    assert.equal(tooLarge.css, '');
    assert.equal(tooLarge.rawBytes, maxBytes + 1);
    fs.unlinkSync(cssPath);

    // 5) Non-regular-file (directory) & symlink rejection
    const nfDir = mkTempDir('prism-custom-css-nonfile-');
    const symDir = mkTempDir('prism-custom-css-symlink-');
    try {
      fs.mkdirSync(path.join(nfDir, 'custom.css'));
      assert.equal(customCssLoader.readCustomCssSafe(nfDir).status, 'rejected-non-file');

      const nfTpl = customCssLoader.createDefaultCustomCssTemplate(nfDir);
      assert.equal(nfTpl.ok, false);
      assert.equal(nfTpl.status, 'rejected-non-file');
      const outsideCss = path.join(outsideDir, 'escape.css');
      fs.writeFileSync(outsideCss, 'body { color: red; }\n', 'utf8');
      const linkPath = path.join(symDir, 'custom.css');
      try {
        fs.symlinkSync(outsideCss, linkPath, 'file');
      } catch (err) {
        if (process.platform === 'win32' && (err.code === 'EPERM' || err.code === 'EACCES')) {
          fs.symlinkSync(outsideDir, linkPath, 'junction');
        } else throw err;
      }
      assert.equal(customCssLoader.readCustomCssSafe(symDir).status, 'rejected-symlink');
      assert.equal(customCssLoader.createDefaultCustomCssTemplate(symDir).status, 'rejected-symlink');
    } finally {
      fs.rmSync(nfDir, { recursive: true, force: true });
      fs.rmSync(symDir, { recursive: true, force: true });
    }

    // 6) @import blocking (plain, multiline, case-insensitive, hex & non-hex backslash escapes) while keeping comments & CSS strings
    const importMix = [
      '/* Keep comment: @import url("https://example.com/in-comment.css"); */',
      '.keep-str::after { content: "@import url(https://example.com/in-string.css)"; }',
      '@import url("https://evil.example/plain.css");',
      "@import 'local-plain.css';",
      '@import\n  url(\n  "https://evil.example/multiline.css"\n);',
      '@IMPORT URL("https://evil.example/upper.css");',
      '@ImPoRt "https://evil.example/mixed.css";',
      '@\\import "https://evil.example/esc1.css";',
      '@\\i\\m\\p\\o\\r\\t "https://evil.example/esc2.css";',
      '@impor\\t "https://evil.example/esc3.css";',
      '@\\69\r\nmport url("https://evil.example/hex-crlf.css");',
      '@\\69\\6d\\70\\6f\\72\\74 "https://evil.example/hex-all.css";',
      '@\\000049\\00004d\\000050\\00004f\\000052\\000054 url("https://evil.example/hex6.css");',
      ':root { --ag-prism-safe: 1; }',
    ].join('\n');
    const san = customCssLoader.sanitizeCustomCssContent(importMix);
    assert.equal(san.blockedImports, 11);
    assert.ok(san.css.includes('/* Keep comment: @import url("https://example.com/in-comment.css"); */'));
    assert.ok(san.css.includes('content: "@import url(https://example.com/in-string.css)"'));
    assert.ok(san.css.includes(':root { --ag-prism-safe: 1; }'));
    assert.equal(san.css.includes('evil.example') || san.css.includes('local-plain.css'), false);

    // 7) createDefaultCustomCssTemplate wx non-overwriting behavior
    const tplDir = mkTempDir('prism-custom-css-tpl-');
    try {
      assert.equal(customCssLoader.createDefaultCustomCssTemplate(path.join(tplDir, 'missing')).status, 'invalid-root');
      const created = customCssLoader.createDefaultCustomCssTemplate(tplDir);
      assert.deepEqual({ ok: created.ok, created: created.created, exists: created.exists, status: created.status },
        { ok: true, created: true, exists: true, status: 'created' });
      assert.equal(fs.readFileSync(created.filePath, 'utf8'), customCssLoader.DEFAULT_CUSTOM_CSS_TEMPLATE);
      assert.equal(customCssLoader.readCustomCssSafe(tplDir).status, 'empty');

      const userCss = '/* user-authored */\n:root { --ag-prism-ui-font: "Inter"; }\n';
      fs.writeFileSync(created.filePath, userCss, 'utf8');
      const second = customCssLoader.createDefaultCustomCssTemplate(tplDir);
      assert.deepEqual({ ok: second.ok, created: second.created, exists: second.exists, status: second.status },
        { ok: true, created: false, exists: true, status: 'exists' });
      assert.equal(fs.readFileSync(created.filePath, 'utf8'), userCss);
    } finally {
      fs.rmSync(tplDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('Channel 18 (customStyle): gating matrix, 64 KB budget, targetHash sensitivity, companion UI & teardown split', () => {
  const ND = { noDiskCache: true };
  const ch18 = cdp.findChannel('customStyle');
  assert.ok(ch18 && ch18.channelNumber === 18 && ch18.budgetBytes === 64 * 1024);

  for (const [cfg, expected] of [
    [{ customCss: 'off', uiFont: 'default' }, false],
    [{ customCss: false, uiFont: 'default' }, false],
    [{ customCss: 'on', uiFont: 'default' }, true],
    [{ customCss: true, uiFont: 'default' }, true],
    [{ customCss: 'off', uiFont: 'inter' }, true],
    [{ customCss: 'off', uiFont: 'custom', uiFontCustom: 'Inter' }, true],
    [{ customCss: 'on', uiFont: 'harmony' }, true],
  ]) {
    assert.equal(cdp.shouldEnableCustomStyle(cfg), expected);
    assert.equal(ch18.shouldEnable(cfg), expected);
  }

  const offCfg = { ...cdp.DEFAULT_CONFIG, customCss: 'off', uiFont: 'default' };
  assert.equal(cdp.buildCustomStyleChannelExpression(offCfg, ND), '');
  assert.equal(cdp.getChannelCode('customStyle', offCfg, ND), '');
  // On-demand Settings UI companion & meta-sync remain available when Ch18 is off (prevents GUI lockout)
  const uiCompanionExpr = cdp.buildCustomStyleSettingsUiExpression(offCfg);
  const metaSyncExpr = cdp.buildCustomStyleSettingsMetaSyncExpression(offCfg);
  assert.ok(uiCompanionExpr.length > 0 && metaSyncExpr.length > 0 && Buffer.byteLength(metaSyncExpr, 'utf8') < 2048);
  assert.doesNotThrow(() => new vm.Script(uiCompanionExpr));
  assert.doesNotThrow(() => new vm.Script(metaSyncExpr));
  const refExpr = cdp.buildConfigRefreshExpression({ uiFont: 'inter', customCss: 'on' });
  assert.ok(refExpr.includes("P('CustomStyle')?.sync") && Buffer.byteLength(refExpr, 'utf8') < 4096);

  const enabledExpr = cdp.buildCustomStyleChannelExpression({ ...cdp.DEFAULT_CONFIG, customCss: 'on', uiFont: 'inter' }, ND);
  assert.ok(enabledExpr.length > 0 && Buffer.byteLength(enabledExpr, 'utf8') <= 64 * 1024);
  assert.ok(enabledExpr.includes('ch18BootPatch'));
  assert.doesNotThrow(() => new vm.Script(enabledExpr));

  // targetHash sensitivity across config keys + on-disk custom.css content/blockedImports
  const isoRoot = mkTempDir('prism-ch18-hash-');
  try {
    fs.cpSync(path.join(ROOT, 'vendor', 'custom-style'), path.join(isoRoot, 'vendor', 'custom-style'), { recursive: true });
    let memSlot = null;
    const builders = createCustomStyleChannelBuilders({
      rootDir: isoRoot,
      readConfig: () => ({ ...cdp.DEFAULT_CONFIG }),
      bundleCache: {
        getChannelMemCache: () => memSlot,
        resolveChannelAssetsWithDiskCache: ({ sig, compileFn }) => (memSlot = { sig, ...compileFn() }),
      },
    });
    const baseCfg = {
      ...cdp.DEFAULT_CONFIG, customCss: 'on', uiFont: 'default', uiFontCustom: '',
      chatFont: 'default', chatFontCustom: '', codeFont: 'default', codeFontCustom: '', language: 'en',
    };
    const hBase = extractTargetHash(builders.buildCustomStyleChannelExpression(baseCfg, ND));
    assert.ok(hBase.length > 0);
    for (const patch of [
      { uiFont: 'inter' }, { uiFont: 'custom', uiFontCustom: 'MiSans' }, { chatFont: 'harmony' },
      { chatFont: 'custom', chatFontCustom: 'Georgia' }, { codeFont: 'jetbrains' },
      { codeFont: 'custom', codeFontCustom: 'Maple Mono' }, { language: 'ja' }, { customCss: 'off', uiFont: 'inter' },
    ]) {
      assert.notEqual(extractTargetHash(builders.buildCustomStyleChannelExpression({ ...baseCfg, ...patch }, ND)), hBase);
    }

    const diskCss = path.join(isoRoot, 'custom.css');
    fs.writeFileSync(diskCss, ':root { --ag-prism-ui-font: "Inter"; }\n', 'utf8');
    const hCss1 = extractTargetHash(builders.buildCustomStyleChannelExpression(baseCfg, ND));
    assert.notEqual(hCss1, hBase);
    fs.writeFileSync(diskCss, '@import url("https://evil.example/x.css");\n:root { --ag-prism-ui-font: "Inter"; }\n', 'utf8');
    assert.notEqual(extractTargetHash(builders.buildCustomStyleChannelExpression(baseCfg, ND)), hCss1);

    // Split teardown contract: CUSTOM_STYLE_REMOVE_EXPRESSION cleans runtime client only (preserves Settings UI & calls syncIfPresent),
    // while SETTINGS_REMOVE_EXPRESSION & REMOVE_EXPRESSION dispose Settings UI; none delete disk custom.css
    const runTeardown = (expr) => {
      const { doc, html, head, body } = createDomWithTraps({
        'data-ag-cs-style': '1', 'data-ag-cs-ui-font': 'inter', 'data-ag-prism-custom-css': 'active',
      });
      for (const sid of ['ag-prism-ui-font-style', 'ag-prism-user-custom-css', 'ag-prism-custom-style-ui-css']) {
        const s = doc.createElement('style'); s.id = sid; head.appendChild(s);
      }
      const owned = doc.createElement('div');
      owned.setAttribute('data-ag-cs-custom-style-owned', '1');
      body.appendChild(owned);
      let destroyed = 0; let disposed = 0; let syncedUi = 0;
      const sandbox = {
        document: doc,
        __agPrismCustomStyle: { destroy() { destroyed += 1; } },
        __agPrismCustomStyleI18n: { LOCALES: CANONICAL_9_LOCALES },
        __agPrismCustomStyleSettingsUi: { dispose() { disposed += 1; }, syncIfPresent() { syncedUi += 1; } },
      };
      sandbox.window = sandbox.globalThis = sandbox;
      vm.runInNewContext(expr, sandbox);
      return { doc, html, sandbox, destroyed, disposed, syncedUi };
    };

    const rtOff = runTeardown(cdp.CUSTOM_STYLE_REMOVE_EXPRESSION);
    assert.deepEqual({ destroyed: rtOff.destroyed, disposed: rtOff.disposed, syncedUi: rtOff.syncedUi }, { destroyed: 1, disposed: 0, syncedUi: 1 });
    assert.equal(rtOff.doc.getElementById('ag-prism-ui-font-style'), null);
    assert.equal(rtOff.doc.getElementById('ag-prism-user-custom-css'), null);
    assert.ok(rtOff.doc.getElementById('ag-prism-custom-style-ui-css'), 'Ch17 off must keep Settings UI style alive');
    assert.ok(rtOff.doc.querySelector('[data-ag-cs-custom-style-owned="1"]'), 'Ch17 off must keep Settings UI rows alive');
    assert.equal(rtOff.html.hasAttribute('data-ag-cs-ui-font'), false);
    assert.equal(rtOff.html.hasAttribute('data-ag-prism-custom-css'), false);
    assert.equal(rtOff.sandbox.__agPrismCustomStyle, undefined);
    assert.ok(rtOff.sandbox.__agPrismCustomStyleSettingsUi && rtOff.sandbox.__agPrismCustomStyleI18n);

    const setOff = runTeardown(cdp.SETTINGS_REMOVE_EXPRESSION);
    assert.equal(setOff.disposed, 1);
    assert.equal(setOff.doc.getElementById('ag-prism-custom-style-ui-css'), null);
    assert.equal(setOff.doc.querySelector('[data-ag-cs-custom-style-owned="1"]'), null);
    assert.equal(setOff.sandbox.__agPrismCustomStyleSettingsUi, undefined);
    assert.equal(setOff.sandbox.__agPrismCustomStyleI18n, undefined);

    const fullOff = runTeardown(cdp.REMOVE_EXPRESSION);
    assert.equal(fullOff.destroyed, 1);
    assert.equal(fullOff.disposed, 1);
    for (const sid of ['ag-prism-ui-font-style', 'ag-prism-user-custom-css', 'ag-prism-custom-style-ui-css']) {
      assert.equal(fullOff.doc.getElementById(sid), null);
    }
    assert.equal(fullOff.doc.querySelector('[data-ag-cs-custom-style-owned="1"]'), null);
    assert.equal(fullOff.html.hasAttribute('data-ag-cs-ui-font'), false);
    assert.equal(fullOff.html.hasAttribute('data-ag-prism-custom-css'), false);
    for (const g of ['__agPrismCustomStyle', '__agPrismCustomStyleI18n', '__agPrismCustomStyleSettingsUi']) {
      assert.equal(fullOff.sandbox[g], undefined);
    }
    assert.equal(fs.existsSync(diskCss), true, 'Teardown must NEVER delete custom.css on disk');
    assert.equal(cdp.PURGE_DATA_FILES.includes('custom.css'), false);
    assert.equal(PROTECTED_USER_PATHS.includes('custom.css'), true);
    assert.equal(USER_OWNED_ASSET_PATHS.includes('custom.css'), true);
  } finally {
    fs.rmSync(isoRoot, { recursive: true, force: true });
  }
});

test('4-layer typography cascade, icon immunity, pinned-last custom.css & CSS var precedence', () => {
  const { doc, html, head } = createDomWithTraps({ 'data-ag-cs-style': '1' });
  const prevCs = globalThis.__agPrismCustomStyle;
  const prevFc = globalThis.__agPrismFontCustomizer;
  globalThis.__agPrismCustomStyle = customStyleClient;
  globalThis.__agPrismFontCustomizer = fontCustomizer;

  try {
    const r1 = customStyleClient.sync(
      { uiFont: 'inter', uiFontCustom: '', chatFont: 'default', chatFontCustom: '', codeFont: 'default', codeFontCustom: '', customCss: 'on' },
      { status: 'missing', css: '', bytes: 0, blockedImports: 0 }, doc
    );
    assert.deepEqual({ ok: r1.ok, uiFontActive: r1.uiFontActive, customCssActive: r1.customCssActive }, { ok: true, uiFontActive: true, customCssActive: false });
    assert.equal(html.getAttribute('data-ag-cs-ui-font'), 'inter');
    assert.equal(html.getAttribute('data-ag-prism-custom-css'), 'missing');

    const css1 = doc.getElementById(customStyleClient.UI_FONT_STYLE_ID).textContent;
    for (const tok of [
      '--ag-prism-ui-font-resolved:var(--ag-prism-ui-font,',
      ':where(button,input,select,textarea):where(:not(.codicon):not([class*="codicon-"]):not(.octicon):not([data-icon-font]))',
      'html:root[data-ag-cs-style] :is(.codicon,[class*="codicon-"]){font-family:codicon !important;}',
      'html:root[data-ag-cs-style] .octicon{font-family:octicons !important;}',
      'font-family:var(--ag-prism-chat-font,var(--ag-prism-ui-font-resolved)) !important;',
      'font-family:var(--ag-prism-code-font,var(--ag-cs-mono-stack)) !important;',
    ]) assert.ok(css1.includes(tok), `Missing L1 CSS token: ${tok}`);
    assert.equal(css1.includes(':has(') || css1.includes('*{') || css1.includes('* {'), false);

    const customUiStack = customStyleClient.resolveUiFontStack('custom', 'Evil; } body{display:none}, "MiSans", PingFang SC');
    assert.ok(customUiStack.startsWith('"MiSans", "PingFang SC", ') && !/Evil|display|;|\{|\}/.test(customUiStack));

    const userCss = ':root { --ag-prism-ui-font: "CustomUI", sans-serif; --ag-prism-chat-font: "CustomChat", serif; --ag-prism-code-font: "CustomMono", monospace; }\n';
    const multiCfg = { uiFont: 'inter', uiFontCustom: '', chatFont: 'custom', chatFontCustom: 'Georgia, Noto Serif SC', codeFont: 'custom', codeFontCustom: 'Maple Mono, JetBrains Mono', customCss: 'on' };
    assert.equal(customStyleClient.sync(multiCfg, { status: 'active', css: userCss, bytes: userCss.length, blockedImports: 0 }, doc).customCssActive, true);
    const css2 = doc.getElementById(customStyleClient.UI_FONT_STYLE_ID).textContent;
    assert.equal(css2.includes('var(--ag-prism-ui-font-resolved)) !important;'), false);
    assert.ok(css2.includes('[data-testid="side-question-panel"],[data-testid="subagent-tab-conversation"]') && css2.includes('var(--ag-prism-chat-font, "Georgia", "Noto Serif SC"'));

    const fcRes = fontCustomizer.applyCustomFonts(multiCfg, doc);
    assert.ok(fcRes.active && fcRes.css.includes('var(--ag-prism-chat-font,"Georgia", "Noto Serif SC"') && fcRes.css.includes('var(--ag-prism-code-font,"Maple Mono", "JetBrains Mono"') && fcRes.css.includes('font-variant-ligatures:var(--_fvl) !important'));
    assert.equal(head.lastElementChild?.id, customStyleClient.USER_CSS_STYLE_ID);

    fontCustomizer.applyCustomFonts({ ...multiCfg, chatFontCustom: 'Charter' }, doc);
    assert.equal(head.lastElementChild?.id, customStyleClient.USER_CSS_STYLE_ID);

    const r4 = customStyleClient.sync(
      { uiFont: 'default', uiFontCustom: '', chatFont: 'default', chatFontCustom: '', codeFont: 'default', codeFontCustom: '', customCss: 'on' },
      { status: 'active', css: userCss, bytes: userCss.length, blockedImports: 0 }, doc
    );
    assert.deepEqual({ uiFontActive: r4.uiFontActive, customCssActive: r4.customCssActive }, { uiFontActive: false, customCssActive: true });
    const css4 = doc.getElementById(customStyleClient.UI_FONT_STYLE_ID).textContent;
    assert.ok(css4.includes('--font-sans:var(--ag-prism-ui-font,') && css4.includes('var(--ag-prism-chat-font,var(--ag-prism-ui-font,var(--font-sans)))') && css4.includes('--ag-cs-mono-stack:var(--ag-prism-code-font,'));
    assert.equal(head.lastElementChild?.id, customStyleClient.USER_CSS_STYLE_ID);

    customStyleClient.destroy(doc);
    fontCustomizer.dispose(doc);
    assert.equal(doc.getElementById(customStyleClient.UI_FONT_STYLE_ID), null);
    assert.equal(doc.getElementById(customStyleClient.USER_CSS_STYLE_ID), null);
  } finally {
    if (prevCs === undefined) delete globalThis.__agPrismCustomStyle; else globalThis.__agPrismCustomStyle = prevCs;
    if (prevFc === undefined) delete globalThis.__agPrismFontCustomizer; else globalThis.__agPrismFontCustomizer = prevFc;
  }
});

test('Ch9 custom-style-settings-ui: 0 innerHTML, zero-timer trap, 0 leaked timers on dispose & valid SETTING_BINDING RPC payloads', () => {
  for (const name of ['custom-style-i18n.js', 'custom-style-client.js', 'custom-style-settings-ui.js']) {
    const fp = path.join(ROOT, 'vendor', 'custom-style', name);
    assertFileHygiene([fp]);
    const clean = stripJsComments(fs.readFileSync(fp, 'utf8'));
    assert.equal(/\.\s*(?:innerHTML|outerHTML)\s*[+]?=|\.\s*insertAdjacentHTML\s*\(/.test(clean), false, `${name}: 0 HTML sinks`);
    assert.equal(/:has\(/.test(clean), false, `${name}: 0 :has()`);
    assert.equal(/\bsetInterval\s*\(/.test(clean), false, `${name}: 0 setInterval`);
  }

  const { doc, head, body, getInnerHtmlWrites } = createDomWithTraps({ 'data-ag-cs-style': '1', 'data-ag-cs-lang': 'en' });
  const sec = doc.createElement('div');
  sec.id = 'ag-cs-settings-sec';
  sec.setAttribute('data-body-built', '1');
  sec.setAttribute('data-ag-cs-lang', 'en');
  const groupBody = doc.createElement('div');
  const rows = {};
  for (const r of ['chatFont', 'codeFont', 'codeLigatures']) {
    rows[r] = doc.createElement('div');
    rows[r].setAttribute('data-ag-cs-row', r);
    groupBody.appendChild(rows[r]);
  }
  sec.appendChild(groupBody);
  body.appendChild(sec);

  const rpcPayloads = [];
  const fakeWin = {
    document: doc,
    __agPrismSetting: (raw) => rpcPayloads.push(JSON.parse(raw)),
    __agPrismCustomStyle: customStyleClient,
    __agPrismCustomStyleI18n: customStyleI18n,
    __agPrismFontCustomizer: fontCustomizer,
  };
  doc.defaultView = fakeWin;

  const origSetTimeout = globalThis.setTimeout;
  const origClearTimeout = globalThis.clearTimeout;
  const origSetInterval = globalThis.setInterval;
  let intervalCalls = 0;
  const liveTimers = new Set();
  globalThis.setInterval = (...a) => { intervalCalls += 1; return origSetInterval(...a); };
  globalThis.setTimeout = (fn, ms, ...r) => {
    const id = origSetTimeout((...a) => { liveTimers.delete(id); return fn(...a); }, ms, ...r);
    liveTimers.add(id);
    return id;
  };
  globalThis.clearTimeout = (id) => { liveTimers.delete(id); return origClearTimeout(id); };

  try {
    customStyleClient.sync(
      { uiFont: 'default', uiFontCustom: '', customCss: 'on' },
      { status: 'active', css: ':root { --ag-prism-ui-font: "Inter"; }\n', bytes: 2048, blockedImports: 1 },
      doc
    );

    customStyleSettingsUi.install(doc, fakeWin);
    assert.equal(intervalCalls, 0);
    assert.equal(liveTimers.size, 0);

    let baseSyncCalls = 0;
    const origSync = () => { baseSyncCalls += 1; return true; };
    const mockBeta4 = { sync: origSync };
    fakeWin.__agPrismSettingsExtBeta4 = mockBeta4;
    assert.equal(mockBeta4.__agCustomStyleHooked, true);

    const uiRow = sec.querySelector('[data-ag-cs-row="uiFont"]');
    const cssRow = sec.querySelector('[data-ag-cs-row="customCss"]');
    assert.ok(uiRow && cssRow);
    assert.ok(groupBody.children.indexOf(uiRow) < groupBody.children.indexOf(rows.chatFont));
    assert.ok(groupBody.children.indexOf(cssRow) > groupBody.children.indexOf(rows.codeLigatures));
    assert.equal(head.lastElementChild?.id, customStyleClient.USER_CSS_STYLE_ID);
    assert.equal(getInnerHtmlWrites(), 0);

    const statusEl = cssRow.querySelector('[data-ag-cs-css-status="1"]');
    assert.equal(statusEl.getAttribute('data-tone'), 'warn');
    assert.ok(statusEl.textContent.includes('2.0 KB') && statusEl.textContent.includes('1'));

    customStyleSettingsUi.syncIfPresent(doc, fakeWin, { uiFont: 'harmony', customCss: 'off' });
    const sel = uiRow.querySelector('select[data-ag-cs-ext-select="uiFont"]');
    assert.equal(sel.value, 'harmony');
    assert.ok(statusEl.textContent.toLowerCase().includes('disabled'));

    sel.value = 'custom';
    sel.dispatchEvent({ type: 'change' });
    assert.deepEqual(rpcPayloads.at(-1), { key: 'uiFont', value: 'custom' });
    assert.equal(cdp.validateConfigEntry('uiFont', 'custom'), true);

    const inp = uiRow.querySelector('input[data-ag-cs-ext-input="uiFontCustom"]');
    inp.value = 'MiSans, Inter';
    inp.dispatchEvent({ type: 'change' });
    assert.deepEqual(rpcPayloads.at(-1), { key: 'uiFontCustom', value: 'MiSans, Inter' });
    assert.equal(cdp.validateConfigEntry('uiFontCustom', 'MiSans, Inter'), true);

    uiRow.querySelector('button[data-ag-cs-ext-action="reset-ui-font"]').click();
    assert.deepEqual(rpcPayloads.at(-1), { action: 'patch-batch', entries: { uiFont: 'default', uiFontCustom: '' } });

    cssRow.querySelector('button[data-ag-cs-ext-role="off"]').click();
    assert.deepEqual(rpcPayloads.at(-1), { key: 'customCss', value: 'off' });
    assert.equal(cdp.validateConfigEntry('customCss', 'off'), true);

    cssRow.querySelector('button[data-ag-cs-ext-action="create-custom-css-template"]').click();
    assert.deepEqual(rpcPayloads.at(-1), { action: 'custom-css-create-template' });

    cssRow.querySelector('button[data-ag-cs-ext-action="reload-custom-css"]').click();
    assert.deepEqual(rpcPayloads.at(-1), { action: 'custom-css-reload' });

    // Schedule debounced timer, then dispose -> 0 leaked timers, hook & trap restored
    inp.value = 'Inter';
    inp.dispatchEvent({ type: 'input' });
    assert.equal(liveTimers.size, 1);

    customStyleSettingsUi.dispose(doc);
    assert.equal(liveTimers.size, 0, 'dispose() must leak 0 timers');
    assert.equal(intervalCalls, 0);
    assert.equal(doc.getElementById(customStyleSettingsUi.UI_STYLE_ID), null);
    assert.equal(sec.querySelector('[data-ag-cs-custom-style-owned="1"]'), null);
    assert.equal(mockBeta4.sync, origSync);
    assert.equal(mockBeta4.__agCustomStyleHooked, undefined);
    assert.equal(typeof Object.getOwnPropertyDescriptor(fakeWin, '__agPrismSettingsExtBeta4').get, 'undefined');
    assert.equal(getInnerHtmlWrites(), 0);
    mockBeta4.sync();
    assert.equal(baseSyncCalls, 1);
  } finally {
    customStyleSettingsUi.dispose(doc);
    customStyleClient.destroy(doc);
    globalThis.setTimeout = origSetTimeout;
    globalThis.clearTimeout = origClearTimeout;
    globalThis.setInterval = origSetInterval;
  }
});

test('custom-style-i18n.js: all 9 canonical locales complete, identical keysets, 0 CJK in non-CJK, 0 yue', () => {
  assert.deepEqual([...customStyleI18n.LOCALES], CANONICAL_9_LOCALES);
  assert.equal(customStyleI18n.LOCALES.includes('yue'), false);
  const tableKeys = Object.keys(customStyleI18n.TABLE).sort();
  assert.ok(tableKeys.length >= 16);
  for (const k of tableKeys) assert.equal(customStyleI18n.TABLE[k].length, 9);

  for (const loc of CANONICAL_9_LOCALES) {
    const dict = customStyleI18n.getStrings(loc);
    assert.deepEqual(Object.keys(dict).sort(), tableKeys);
    for (const k of tableKeys) {
      assert.ok(typeof dict[k] === 'string' && dict[k].trim().length > 0, `Empty ${loc}.${k}`);
      assert.equal(FORBIDDEN_TERM_RE.test(dict[k]), false, `Forbidden term in ${loc}.${k}`);
      if (NON_CJK_LOCALES.includes(loc)) assert.equal(CJK_RE.test(dict[k]), false, `CJK in ${loc}.${k}`);
    }
  }
  for (const [raw, norm] of [
    ['yue', 'zh-CN'], ['yue-HK', 'zh-CN'], ['zh-yue', 'zh-CN'], ['cantonese', 'zh-CN'],
    ['zh-HK', 'zh-TW'], ['zh-hk-Hant', 'zh-TW'], ['tr-TR', 'tr'], ['auto', 'en'],
  ]) {
    assert.equal(customStyleI18n.normalizeLocale(raw), norm);
  }
});

test('Daemon hot-reload & RPC: create-template (non-overwriting), custom-css-reload, and watched custom.css rebuilds Ch18 with 0 Ch1 rebuilds', async () => {
  const tmpDir = mkTempDir('prism-daemon-custom-css-');
  const tmpCdpPath = path.join(tmpDir, 'cdp.js');
  let daemon = null;

  try {
    fs.cpSync(path.join(ROOT, 'vendor', 'custom-style'), path.join(tmpDir, 'vendor', 'custom-style'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({ ...cdp.DEFAULT_CONFIG, customCss: 'on', uiFont: 'default' }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      tmpCdpPath,
      [
        "'use strict';",
        `const r = require(${JSON.stringify(path.join(ROOT, 'cdp.js'))});`,
        `const { createConfigStore } = require(${JSON.stringify(path.join(ROOT, 'src', 'config', 'store.cjs'))});`,
        `const { createCustomStyleChannelBuilders } = require(${JSON.stringify(path.join(ROOT, 'src', 'channels', 'builders-custom-style.cjs'))});`,
        'const st = createConfigStore({ rootDir: __dirname }), mem = new Map();',
        'const cs = createCustomStyleChannelBuilders({ rootDir: __dirname, readConfig: st.readConfig, bundleCache: { getChannelMemCache: (k) => mem.get(k) || null, resolveChannelAssetsWithDiskCache: ({ channelName, sig, compileFn }) => { const v = { sig, ...compileFn() }; mem.set(channelName, v); return v; } } });',
        'let ch1Builds = 0, ch18Builds = 0;',
        'const buildCs = (...a) => { ch18Builds += 1; return cs.buildCustomStyleChannelExpression(...a); };',
        "module.exports = { ...r, CONFIG_PATH: st.CONFIG_PATH, readConfig: st.readConfig, writeConfig: st.writeConfig, invalidateConfigCache: st.invalidateConfigCache, shouldEnableCustomStyle: cs.shouldEnableCustomStyle, buildCustomStyleChannelExpression: buildCs, buildInjectExpression: (...a) => { ch1Builds += 1; return r.buildInjectExpression(...a); }, findChannel: (id) => { const b = r.findChannel(id); return id === 'customStyle' && b ? Object.freeze({ ...b, shouldEnable: cs.shouldEnableCustomStyle, build: buildCs }) : b; }, __getCounters: () => ({ ch1Builds, ch18Builds }) };",
      ].join('\n'),
      'utf8'
    );

    daemon = new PrismDaemon({
      rootDir: tmpDir, bundleCachePath: false, portFile: path.join(tmpDir, 'nonexistent.port'),
      pollIntervalMs: 60000, enableAutoUpdateTimer: false, enableStorageGuardTimer: false, silent: true,
    });
    daemon.tick = async () => ({ attached: daemon.sessionRegistry.sessions.size });

    let nextScriptId = 1;
    const evalExprs = [];
    const addedScripts = [];
    const mockEntry = {
      wsUrl: 'ws://127.0.0.1:9222/page/custom-css-test',
      pageId: 'page-custom-css',
      mainFrameId: 'F-MAIN',
      contextFrames: new Map([[1, { frameId: 'F-MAIN', isDefault: true, type: 'default', docGen: 0 }]]),
      session: {
        closed: false,
        async send(method, params) {
          if (method === 'Page.addScriptToEvaluateOnNewDocument') {
            const id = `cs-script-${nextScriptId++}`;
            addedScripts.push({ id, source: params.source });
            return { identifier: id };
          }
          return method === 'Page.removeScriptToEvaluateOnNewDocument' ? {} : { result: { value: { ok: true } } };
        },
        async evaluate(expr) {
          evalExprs.push(expr);
          return { ok: true, status: 'mounted', codeHash: extractTargetHash(expr) };
        },
      },
    };
    daemon.sessionRegistry.sessions.set(mockEntry.wsUrl, mockEntry);

    daemon.start({ claimPid: false, watchFiles: true });
    const counters = () => daemon.channelOrchestrator.getCdp().__getCounters();
    const ch1Baseline = counters().ch1Builds;
    const customCssPath = path.join(tmpDir, 'custom.css');

    const sendRpc = (action) => daemon.handleBindingCall(mockEntry, { name: cdp.SETTING_BINDING, payload: JSON.stringify({ action }), executionContextId: 1 });
    await sendRpc('custom-css-create-template');
    assert.equal(fs.readFileSync(customCssPath, 'utf8'), customCssLoader.DEFAULT_CUSTOM_CSS_TEMPLATE);
    assert.equal(counters().ch1Builds, ch1Baseline);
    assert.ok(evalExprs.length >= 1 && addedScripts.length >= 1);

    const userV1 = '/* user-preserved-v1 */\n:root { --ag-prism-ui-font: "Inter", sans-serif; }\n';
    fs.writeFileSync(customCssPath, userV1, 'utf8');
    await sendRpc('custom-css-create-template');
    assert.equal(fs.readFileSync(customCssPath, 'utf8'), userV1);
    assert.equal(counters().ch1Builds, ch1Baseline);

    fs.writeFileSync(customCssPath, '/* rpc-reload-v2 */\n:root { --ag-prism-chat-font: "Georgia", serif; }\n', 'utf8');
    const evalsBeforeReload = evalExprs.length;
    await sendRpc('custom-css-reload');
    assert.ok(evalExprs.length > evalsBeforeReload && evalExprs.at(-1).includes('rpc-reload-v2'));
    assert.equal(counters().ch1Builds, ch1Baseline);

    // 4) Watched custom.css change triggers fs.watch -> Ch18 rebuild only (0 Ch1 rebuilds)
    const hashBeforeWatch = daemon.channelOrchestrator.getChannelHash('customStyle');
    const evalsBeforeWatch = evalExprs.length;
    fs.writeFileSync(customCssPath, '/* watched-hot-reload-v3 */\n:root { --ag-prism-code-font: "Maple Mono", monospace; }\n', 'utf8');
    const hotReloaded = await waitUntil(
      () =>
        daemon.channelOrchestrator.getChannelHash('customStyle') !== hashBeforeWatch &&
        evalExprs.length > evalsBeforeWatch &&
        evalExprs.at(-1).includes('watched-hot-reload-v3')
    );
    assert.equal(hotReloaded, true, 'fs.watch on custom.css must hot-reload Ch18');
    assert.ok(daemon.channelOrchestrator.getChannelExpr('customStyle').includes('watched-hot-reload-v3'));
    assert.equal(counters().ch1Builds, ch1Baseline);
  } finally {
    if (daemon) await daemon.stop(false, { skipAutoArchive: true });
    delete require.cache[tmpCdpPath];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
