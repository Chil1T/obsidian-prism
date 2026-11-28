// P0/P1 regression suite: Ch18 anti-lockout companion UI, CSS Syntax L3 @import scanner, concurrent config/CSS race, bare-template cascade & preset WCAG AA contrast
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { assertCssHygiene, assertFileHygiene } from './helpers/mini-dom.mjs';
import { PrismDaemon } from '../src/daemon/index.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');

const cdp = require(path.join(ROOT, 'cdp.js'));
const customCssLoader = require(path.join(ROOT, 'src', 'channels', 'custom-css-loader.cjs'));
const customStyleClient = require(path.join(ROOT, 'vendor', 'custom-style', 'custom-style-client.js'));

const FORBIDDEN_TERM_RE = /八方旅人|octopath/i;
const PRESET_FILES = [
  '01-coding-minimal.css',
  '02-editorial-longform.css',
  '03-modern-briefing.css',
  '04-chinese-editorial.css',
];
const LIGHT_SELECTOR_061 = 'html:root[data-ag-cs-style][data-ag-cs-style][data-ag-cs-style][data-ag-cs-style][data-ag-cs-theme="light"]';

const mkTempDir = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

function assertBalancedDelimiters(text, label) {
  let b = 0; let p = 0; let k = 0;
  for (const ch of text.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (ch === '{') b++; else if (ch === '}') b--;
    else if (ch === '(') p++; else if (ch === ')') p--;
    else if (ch === '[') k++; else if (ch === ']') k--;
    assert.ok(b >= 0 && p >= 0 && k >= 0, `${label}: unmatched closing delimiter`);
  }
  assert.equal(b, 0, `${label}: unbalanced {}`);
  assert.equal(p, 0, `${label}: unbalanced ()`);
  assert.equal(k, 0, `${label}: unbalanced []`);
}

function parseHexColor(raw) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(raw || '').trim());
  assert.ok(m, `Expected 6-digit hex color, got: ${raw}`);
  const hex = m[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function relativeLuminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function wcagContrast(hexA, hexB) {
  const l1 = relativeLuminance(parseHexColor(hexA));
  const l2 = relativeLuminance(parseHexColor(hexB));
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function extractBlockTokens(css, startMarker) {
  const idx = css.indexOf(startMarker);
  assert.ok(idx >= 0, `Missing block marker: ${startMarker}`);
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  assert.ok(open >= 0 && close > open, `Malformed CSS block after ${startMarker}`);
  const body = css.slice(open + 1, close);
  const tokens = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;!}]+)/gi)) {
    tokens[m[1].trim()] = m[2].trim();
  }
  return tokens;
}

function createTinyDoc(htmlAttrs = {}) {
  const mk = (tag) => {
    const attrs = new Map();
    const kids = [];
    const el = {
      tagName: tag.toUpperCase(), id: '', textContent: '', children: kids, parentNode: null,
      get lastElementChild() { return kids[kids.length - 1] || null; },
      setAttribute(k, v) { attrs.set(k, String(v)); if (k === 'id') el.id = String(v); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(c) {
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = el;
        kids.push(c);
        return c;
      },
      removeChild(c) {
        const i = kids.indexOf(c);
        if (i >= 0) kids.splice(i, 1);
        c.parentNode = null;
        return c;
      },
      remove() { if (el.parentNode) el.parentNode.removeChild(el); },
      querySelector(sel) {
        if (sel.startsWith('#')) {
          const target = sel.slice(1);
          const find = (n) => {
            for (const c of n.children || []) {
              if (c.id === target) return c;
              const hit = find(c);
              if (hit) return hit;
            }
            return null;
          };
          return find(el);
        }
        return null;
      },
      querySelectorAll() { return []; },
    };
    return el;
  };
  const html = mk('html');
  const head = mk('head');
  const body = mk('body');
  for (const [k, v] of Object.entries(htmlAttrs)) html.setAttribute(k, v);
  html.appendChild(head);
  html.appendChild(body);
  return {
    doc: {
      documentElement: html, head, body,
      createElement: (t) => mk(t),
      getElementById: (id) => html.querySelector('#' + id),
      querySelector: (s) => html.querySelector(s),
      querySelectorAll: () => [],
    },
    html,
    head,
    body,
  };
}

function writeIsoDaemonCdpShim(tmpDir) {
  const shimPath = path.join(tmpDir, 'cdp.js');
  fs.writeFileSync(
    shimPath,
    [
      "'use strict';",
      `const r = require(${JSON.stringify(path.join(ROOT, 'cdp.js'))});`,
      `const { createConfigStore } = require(${JSON.stringify(path.join(ROOT, 'src', 'config', 'store.cjs'))});`,
      `const { createCustomStyleChannelBuilders } = require(${JSON.stringify(path.join(ROOT, 'src', 'channels', 'builders-custom-style.cjs'))});`,
      'const st = createConfigStore({ rootDir: __dirname }), mem = new Map();',
      'const cs = createCustomStyleChannelBuilders({ rootDir: __dirname, readConfig: st.readConfig, bundleCache: { getChannelMemCache: (k) => mem.get(k) || null, resolveChannelAssetsWithDiskCache: ({ channelName, sig, compileFn }) => { const v = { sig, ...compileFn() }; mem.set(channelName, v); return v; } } });',
      'let ch1Builds = 0;',
      "module.exports = { ...r, CONFIG_PATH: st.CONFIG_PATH, readConfig: st.readConfig, writeConfig: st.writeConfig, invalidateConfigCache: st.invalidateConfigCache, shouldEnableCustomStyle: cs.shouldEnableCustomStyle, buildCustomStyleChannelExpression: cs.buildCustomStyleChannelExpression, buildCustomStyleSettingsUiExpression: cs.buildCustomStyleSettingsUiExpression, buildCustomStyleSettingsMetaSyncExpression: cs.buildCustomStyleSettingsMetaSyncExpression, buildInjectExpression: (...a) => { ch1Builds += 1; return r.buildInjectExpression(...a); }, findChannel: (id) => { const b = r.findChannel(id); return id === 'customStyle' && b ? Object.freeze({ ...b, shouldEnable: cs.shouldEnableCustomStyle, build: cs.buildCustomStyleChannelExpression }) : b; }, __getCh1Builds: () => ch1Builds };",
    ].join('\n'),
    'utf8'
  );
  return shimPath;
}

test('P0 #1 regression: Ch18 stays 0 B when off+default, while deliverSettingsChannelToEntry delivers companion UI and refreshCustomStyleChannel meta-syncs open Settings', async () => {
  const tmpDir = mkTempDir('prism-p0-1-companion-');
  const tmpCdpPath = writeIsoDaemonCdpShim(tmpDir);
  let daemon = null;
  try {
    fs.cpSync(path.join(ROOT, 'vendor', 'custom-style'), path.join(tmpDir, 'vendor', 'custom-style'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({ ...cdp.DEFAULT_CONFIG, customCss: 'off', uiFont: 'default' }, null, 2) + '\n',
      'utf8'
    );

    daemon = new PrismDaemon({
      rootDir: tmpDir, bundleCachePath: false, portFile: path.join(tmpDir, 'no.port'),
      pollIntervalMs: 60000, enableAutoUpdateTimer: false, enableStorageGuardTimer: false, silent: true,
    });
    daemon.rebuildBundle();

    // 1) Ch18 boot expression MUST remain 0 B when customCss==='off' && uiFont==='default'
    assert.equal(daemon.channelOrchestrator.getChannelExpr('customStyle'), '');

    const sentEvals = [];
    const directEvals = [];
    const mockEntry = {
      wsUrl: 'ws://127.0.0.1:9222/page/p0-1',
      pageId: 'page-p0-1',
      mainFrameId: 'F1',
      contextFrames: new Map([[1, { frameId: 'F1', isDefault: true, type: 'default', docGen: 0 }]]),
      session: {
        closed: false,
        async send(method, params) {
          if (method === 'Runtime.evaluate') {
            sentEvals.push(params.expression);
            return { result: { value: { ok: true, status: 'mounted' } } };
          }
          return {};
        },
        async evaluate(expr) {
          directEvals.push(expr);
          return { ok: true, status: 'synced' };
        },
      },
    };
    daemon.sessionRegistry.sessions.set(mockEntry.wsUrl, mockEntry);

    // 2) Opening Settings delivers Ch9 AND companion customStyleSettingsUi immediately (prevents GUI self-lockout)
    const delivered = await daemon.channelOrchestrator.deliverSettingsChannelToEntry(mockEntry, 1);
    assert.equal(delivered, true);
    assert.equal(mockEntry.settingsChannelDelivered, true);
    assert.equal(sentEvals.length, 2, 'deliverSettingsChannelToEntry must deliver Ch9 followed by customStyleSettingsUi companion');
    assert.ok(sentEvals[1].includes('__agPrismCustomStyleSettingsUi'), 'Second eval must mount Settings UI companion');
    assert.ok(sentEvals[1].includes('setCustomCssMeta'), 'Companion must seed custom.css metadata');

    // 3) While Ch18 is off & Settings is open, refreshCustomStyleChannel() sends lightweight meta-sync (without mounting Ch18 client)
    fs.writeFileSync(path.join(tmpDir, 'custom.css'), ':root { --ag-prism-ui-font: "Inter"; }\n', 'utf8');
    const syncRes = await daemon.channelOrchestrator.refreshCustomStyleChannel({ forceEval: true });
    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.enabled, false);
    assert.equal(daemon.channelOrchestrator.getChannelExpr('customStyle'), '', 'Ch18 must stay 0 B while off+default');
    assert.ok(directEvals.length >= 1, 'refreshCustomStyleChannel must evaluate meta-sync when Settings is open');
    assert.ok(directEvals.at(-1).includes('setCustomCssMeta') && directEvals.at(-1).includes('"status":"active"'));
  } finally {
    if (daemon) await daemon.stop(false, { skipAutoArchive: true });
    delete require.cache[tmpCdpPath];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('P0 #2 regression: CSS Syntax L3 scanner blocks all backslash/CRLF/multiline @import bypasses, preserves strings/comments & blocks directory template creation', () => {
  const bypasses = [
    '@\\import url("https://evil.example/b1.css");',
    '@\\i\\m\\p\\o\\r\\t "https://evil.example/b2.css";',
    '@impor\\t "https://evil.example/b3.css";',
    '@\\I\\M\\P\\O\\R\\T "https://evil.example/b4.css";',
    '@\\69\r\nmport "https://evil.example/b5.css";',
    '@\\000069mport url("https://evil.example/b6.css");',
    '@\\000049\\00004d\\000050\\00004f\\000052\\000054 url("https://evil.example/b7.css");',
    '@import url(\n  "https://evil.example/b8.css"\n);',
    '@import "https://evil.example/b9-unclosed.css\n.after { color: green; }',
    '@\\69\fmport "https://evil.example/b10-ff.css";',
  ];
  const safeSnippets = [
    '/* comment @import url("https://safe.example/c.css"); */',
    '.a::before { content: "@import url(https://safe.example/dq.css);"; }',
    ".b::after { content: '@import \"https://safe.example/sq.css\";'; }",
    '@media (prefers-color-scheme: dark) { :root { --ag-prism-ok: 1; } }',
  ];

  // Safe snippets alone -> 0 blockedImports and preserved byte-identically (normalized LF)
  const safeRes = customCssLoader.sanitizeCustomCssContent(safeSnippets.join('\n'));
  assert.equal(safeRes.blockedImports, 0);
  assert.equal(safeRes.css, safeSnippets.join('\n'));

  // Every obfuscated @import variant MUST be blocked individually and together
  for (const payload of bypasses) {
    const one = customCssLoader.sanitizeCustomCssContent(payload);
    assert.equal(one.blockedImports, 1, `Expected @import blocked for: ${JSON.stringify(payload)}`);
    assert.equal(one.css.includes('evil.example'), false, `URL leaked for: ${JSON.stringify(payload)}`);
  }
  const combined = customCssLoader.sanitizeCustomCssContent([...safeSnippets, ...bypasses].join('\n'));
  assert.equal(combined.blockedImports, bypasses.length);
  assert.equal(combined.css.includes('evil.example'), false);
  for (const safe of safeSnippets) {
    assert.ok(combined.css.includes(safe), `Safe snippet corrupted: ${safe}`);
  }

  // Directory at custom.css path -> createDefaultCustomCssTemplate must return { ok: false, status: 'rejected-non-file' }
  const dirRoot = mkTempDir('prism-p0-2-dir-');
  try {
    fs.mkdirSync(path.join(dirRoot, 'custom.css'));
    const res = customCssLoader.createDefaultCustomCssTemplate(dirRoot);
    assert.deepEqual({ ok: res.ok, created: res.created, exists: res.exists, status: res.status },
      { ok: false, created: false, exists: true, status: 'rejected-non-file' });
  } finally {
    fs.rmSync(dirRoot, { recursive: true, force: true });
  }
});

test('P1 #3 regression: concurrent custom.css + config.json race flushes disk config, fresh bootCfg beats stale liveCfg, and configRefresh syncs Ch18', async () => {
  const tmpDir = mkTempDir('prism-p1-3-race-');
  const tmpCdpPath = writeIsoDaemonCdpShim(tmpDir);
  let daemon = null;
  try {
    fs.cpSync(path.join(ROOT, 'vendor', 'custom-style'), path.join(tmpDir, 'vendor', 'custom-style'), { recursive: true });
    const cfgPath = path.join(tmpDir, 'config.json');
    const cssPath = path.join(tmpDir, 'custom.css');
    fs.writeFileSync(cfgPath, JSON.stringify({ ...cdp.DEFAULT_CONFIG, customCss: 'on', uiFont: 'default', uiFontCustom: '' }, null, 2) + '\n', 'utf8');
    fs.writeFileSync(cssPath, ':root { --ag-prism-race: 1; }\n', 'utf8');

    daemon = new PrismDaemon({
      rootDir: tmpDir, bundleCachePath: false, portFile: path.join(tmpDir, 'no.port'),
      pollIntervalMs: 60000, enableAutoUpdateTimer: false, enableStorageGuardTimer: false, silent: true,
    });
    daemon.rebuildBundle();
    daemon.channelOrchestrator.syncConfigFingerprintFromDisk(cfgPath);

    // Prepare mock in-page VM holding STALE liveCfg (uiFont:'default') while daemon sees fresh disk config
    const { doc, html } = createTinyDoc({ 'data-ag-cs-style': '1' });
    let liveInPageCfg = { ...cdp.DEFAULT_CONFIG, customCss: 'on', uiFont: 'default', uiFontCustom: '' };
    const vmWin = {
      location: { href: 'vscode-file://vscode-app/index.html' },
      document: doc,
      __agPrism: {
        version: cdp.PLUGIN_VERSION,
        codeHash: daemon.channelOrchestrator.codeHash,
        getState: () => ({ cfg: liveInPageCfg }),
        refreshConfig: (next) => { liveInPageCfg = next; return true; },
      },
    };
    vmWin.window = vmWin.globalThis = vmWin.self = vmWin.top = vmWin;

    let scriptSeq = 1;
    let lastEvalRes = null;
    const mockEntry = {
      wsUrl: 'ws://127.0.0.1:9222/page/race',
      pageId: 'page-race',
      mainFrameId: 'F1',
      contextFrames: new Map([[1, { frameId: 'F1', isDefault: true, type: 'default', docGen: 0 }]]),
      session: {
        closed: false,
        async send(method) {
          if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: `race-${scriptSeq++}` };
          return { result: { value: { ok: true } } };
        },
        async evaluate(expr) {
          lastEvalRes = vm.runInNewContext(expr, vmWin);
          return lastEvalRes;
        },
      },
    };
    daemon.sessionRegistry.sessions.set(mockEntry.wsUrl, mockEntry);

    // Simulate concurrent ~1ms custom.css unlink + external config.json update (uiFont:'custom', uiFontCustom:'Verdana')
    fs.unlinkSync(cssPath);
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ ...cdp.DEFAULT_CONFIG, customCss: 'on', uiFont: 'custom', uiFontCustom: 'Verdana' }, null, 2) + '\n',
      'utf8'
    );

    // Trigger refreshCustomStyleChannel directly (before config watcher runs) -> flushes pending external config.json
    const res = await daemon.channelOrchestrator.refreshCustomStyleChannel({ forceEval: true });
    assert.equal(res.ok, true);
    assert.equal(res.enabled, true);
    assert.equal(lastEvalRes?.ok, true);

    // Even though window.__agPrism.getState().cfg was STALE (uiFont:'default'), fresh bootCfg MUST win!
    assert.equal(html.getAttribute('data-ag-cs-ui-font'), 'custom');
    assert.ok(doc.getElementById('ag-prism-ui-font-style')?.textContent.includes('"Verdana"'));
    assert.equal(doc.getElementById('ag-prism-user-custom-css'), null, 'Unlinked custom.css must remove user style node');

    // Follow-up custom.css-only edit (config.json unchanged) must refresh Ch18 with strictly 0 Ch1 rebuilds
    const ch1AfterRace = daemon.channelOrchestrator.getCdp().__getCh1Builds();
    fs.writeFileSync(cssPath, ':root { --ag-prism-ui-font: "Inter"; }\n', 'utf8');
    const resCssOnly = await daemon.channelOrchestrator.refreshCustomStyleChannel({ forceEval: true });
    assert.equal(resCssOnly.ok, true);
    assert.equal(daemon.channelOrchestrator.getCdp().__getCh1Builds(), ch1AfterRace, 'custom.css-only refresh with unchanged config.json must do 0 Ch1 rebuilds');
    assert.ok(doc.getElementById('ag-prism-user-custom-css')?.textContent.includes('--ag-prism-ui-font: "Inter"'));

    // Verify incremental configRefresh expression calls __agPrismCustomStyle.sync(nextCfg, null, document)
    const syncCalls = [];
    vmWin.__agPrismCustomStyle = { sync: (cfg, payload, d) => syncCalls.push({ cfg, payload, d }) };
    const refreshExpr = cdp.buildConfigRefreshExpression({ uiFont: 'harmony', customCss: 'on' });
    assert.ok(Buffer.byteLength(refreshExpr, 'utf8') < 4096);
    const refOut = vm.runInNewContext(refreshExpr, vmWin);
    assert.equal(refOut.refreshed, true);
    assert.equal(syncCalls.length, 1);
    assert.equal(syncCalls[0].cfg.uiFont, 'harmony');
  } finally {
    if (daemon) await daemon.stop(false, { skipAutoArchive: true });
    delete require.cache[tmpCdpPath];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('P1 #4 regression: bare DEFAULT_CUSTOM_CSS_TEMPLATE Example 1 with all dropdowns at default overrides L1 (buttons & --ag-sb-font-display), L2 prose descendants, and L3 code', () => {
  // Uncomment Example 1 from DEFAULT_CUSTOM_CSS_TEMPLATE
  const m = /\/\* Example 1:[\s\S]*?(:root\s*\{[\s\S]*?\})\s*\*\//.exec(customCssLoader.DEFAULT_CUSTOM_CSS_TEMPLATE);
  assert.ok(m && m[1], 'DEFAULT_CUSTOM_CSS_TEMPLATE must contain Example 1 :root block');
  const bareExample1 = m[1] + '\n';
  const san = customCssLoader.sanitizeCustomCssContent(bareExample1);
  assert.equal(san.blockedImports, 0);

  const { doc, head } = createTinyDoc({ 'data-ag-cs-style': '1' });
  const r = customStyleClient.sync(
    { uiFont: 'default', uiFontCustom: '', chatFont: 'default', chatFontCustom: '', codeFont: 'default', codeFontCustom: '', customCss: 'on' },
    { status: 'active', css: san.css, bytes: Buffer.byteLength(san.css, 'utf8'), blockedImports: 0 },
    doc
  );
  assert.equal(r.uiFontActive, false);
  assert.equal(r.customCssActive, true);
  assert.equal(head.lastElementChild?.id, customStyleClient.USER_CSS_STYLE_ID);

  const bridgeCss = doc.getElementById(customStyleClient.UI_FONT_STYLE_ID).textContent;
  for (const required of [
    '--ag-sb-font-display:var(--ag-prism-ui-font,',
    '--font-sans:var(--ag-prism-ui-font,',
    '[data-testid="overview-panel-host"]',
    '.ag-cs-ctx-menu',
    '.ag-cs-ctx-toast',
    '.ag-prism-thought-overlay',
    ':where(button,input,select,textarea):where(:not(.codicon):not([class*="codicon-"]):not(.octicon):not([data-icon-font])){font-family:var(--ag-prism-ui-font,inherit);}',
    '--font-sans:var(--ag-prism-chat-font,var(--ag-prism-ui-font-resolved))',
    ':is(p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th,dt,dd,a,strong,em){font-family:var(--ag-prism-chat-font,var(--ag-prism-ui-font,var(--font-sans)));}',
    '--ag-cs-mono-stack:var(--ag-prism-code-font,',
    'font-family:var(--ag-prism-code-font,var(--ag-cs-mono-stack)) !important;',
    'html:root[data-ag-cs-style] :is(.codicon,[class*="codicon-"]){font-family:codicon !important;}',
    'html:root[data-ag-cs-style] .octicon{font-family:octicons !important;}',
  ]) {
    assert.ok(bridgeCss.includes(required), `Bare custom.css bridge missing rule: ${required}`);
  }

  // Also verify --ag-sb-font-display in explicit uiFont branch
  customStyleClient.sync(
    { uiFont: 'inter', uiFontCustom: '', chatFont: 'default', chatFontCustom: '', codeFont: 'default', codeFontCustom: '', customCss: 'on' },
    { status: 'missing', css: '', bytes: 0, blockedImports: 0 },
    doc
  );
  const uiBranchCss = doc.getElementById(customStyleClient.UI_FONT_STYLE_ID).textContent;
  assert.ok(uiBranchCss.includes('--ag-sb-font-display:var(--ag-prism-ui-font-resolved) !important;'));
  customStyleClient.destroy(doc);
});

test('P1 #5 regression: all 4 CSS presets satisfy hygiene, (0,6,1)/(0,6,2) Light specificity, >= 4.5:1 WCAG AA contrast & accurate SPEC.md @import note', () => {
  const presetsDir = path.join(ROOT, 'docs', 'custom-css-examples');
  const specPath = path.join(presetsDir, 'SPEC.md');
  assertFileHygiene([specPath]);
  const specText = fs.readFileSync(specPath, 'utf8');
  assert.ok(specText.includes(LIGHT_SELECTOR_061), 'SPEC.md must document (0,6,1) Light selector');
  assert.ok(
    /block comment|\/\* \.\.\. \*\//i.test(specText) && !/even inside CSS comments/i.test(specText),
    'SPEC.md must accurately note block comments do not trigger @import blocking'
  );

  for (const name of PRESET_FILES) {
    const fp = path.join(presetsDir, name);
    assert.equal(fs.existsSync(fp), true, `Preset missing: ${name}`);
    assertFileHygiene([fp]);

    const buf = fs.readFileSync(fp);
    const css = buf.toString('utf8');
    assert.ok(buf.length <= 40960, `${name}: ${buf.length} B exceeds 40 KB cap`);
    assert.ok(css.split('\n').length <= 800, `${name}: exceeds 800-line cap`);
    assertCssHygiene(css, name);
    assertBalancedDelimiters(css, name);

    assert.equal(customCssLoader.sanitizeCustomCssContent(css).blockedImports, 0, `${name}: 0 @import`);
    assert.equal(/https?:\/\//i.test(css), false, `${name}: 0 http(s)://`);
    assert.equal(/data:image\//i.test(css), false, `${name}: 0 data:image/`);
    assert.equal(/\bsteps\s*\(/i.test(css), false, `${name}: 0 steps()`);
    assert.equal(/content-visibility\s*:\s*auto/i.test(css), false, `${name}: 0 content-visibility: auto`);
    assert.equal(FORBIDDEN_TERM_RE.test(css), false, `${name}: 0 forbidden terms`);

    // Dual Dark + (0,6,1)/(0,6,2) Light token selectors & 3-tier font vars
    const darkMarker = 'html:root[data-ag-cs-style][data-ag-cs-style]:not([data-ag-cs-theme="light"])';
    assert.ok(css.includes(darkMarker), `${name}: missing Dark token selector`);
    assert.ok(css.includes(`${LIGHT_SELECTOR_061},`) && css.includes(`${LIGHT_SELECTOR_061} > body`), `${name}: missing (0,6,1)/(0,6,2) Light token selectors`);
    for (const v of ['--ag-prism-ui-font', '--ag-prism-chat-font', '--ag-prism-code-font']) {
      assert.ok(css.includes(v), `${name}: missing ${v}`);
    }

    // Real WCAG 2.1 AA (>= 4.5:1) verification on primary/body/secondary/muted color pairs in Dark & Light
    for (const [mode, marker] of [['Dark', darkMarker], ['Light', LIGHT_SELECTOR_061]]) {
      const t = extractBlockTokens(css, marker);
      const pairs = [
        ['foreground/background', t['--foreground'], t['--background']],
        ['foreground/card', t['--foreground'], t['--card']],
        ['foreground/sidebar', t['--foreground'], t['--sidebar']],
        ['secondary-fg/background', t['--secondary-foreground'], t['--background']],
        ['secondary-fg/card', t['--secondary-foreground'], t['--card']],
        ['muted-fg/background', t['--muted-foreground'], t['--background']],
        ['muted-fg/card', t['--muted-foreground'], t['--card']],
        ['muted-fg/sidebar', t['--muted-foreground'], t['--sidebar']],
        ['primary-fg/primary', t['--primary-foreground'], t['--primary']],
      ];
      for (const [label, fg, bg] of pairs) {
        const ratio = wcagContrast(fg, bg);
        assert.ok(ratio >= 4.5, `${name} [${mode}] ${label} (${fg} on ${bg}) contrast ${ratio.toFixed(2)}:1 < 4.5:1 AA`);
      }
    }
  }
});
