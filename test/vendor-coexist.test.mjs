import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PrismDaemon, REPO_BINDING, METRICS_BINDING, THOUGHT_BINDING, OMNI_BINDING } from '../sidecars/daemon/main.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const cdp = require(path.join(ROOT_DIR, 'cdp.js'));
const locales = require(path.join(ROOT_DIR, 'i18n-locales.js'));
const telemetryMod = require(path.join(ROOT_DIR, 'vendor', 'pulse-dashboard', 'inline-fallback.js'));
const sliderMod = require(path.join(ROOT_DIR, 'vendor', 'effort-slider', 'slider-coexist.js'));
const installPluginTool = require(path.join(ROOT_DIR, 'tools', 'install-plugin.cjs'));

function createLightweightDom() {
  function makeEl(tag) {
    const attrs = new Map();
    const listeners = new Map();
    const styleProps = new Map();
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      children: [],
      parentNode: null,
      parentElement: null,
      shadowRoot: null,
      isConnected: true,
      hidden: false,
      textContent: '',
      className: '',
      style: {
        setProperty(k, v) { styleProps.set(k, String(v)); },
        getPropertyValue(k) { return styleProps.get(k) || ''; },
        removeProperty(k) { styleProps.delete(k); },
        get display() { return styleProps.get('display') || ''; },
        set display(v) { if (v) styleProps.set('display', String(v)); else styleProps.delete('display'); },
        get width() { return styleProps.get('width') || ''; },
        set width(v) { styleProps.set('width', String(v)); },
      },
      get id() { return attrs.get('id') || ''; },
      set id(v) { attrs.set(kOrId('id'), String(v)); },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(child) {
        if (child.parentNode) child.remove();
        child.parentNode = el;
        child.parentElement = el.tagName === '#SHADOW-ROOT' ? null : el;
        child.isConnected = el.isConnected;
        el.children.push(child);
        return child;
      },
      insertBefore(child, ref) {
        const idx = ref ? el.children.indexOf(ref) : -1;
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
        const sr = makeEl('#shadow-root');
        sr.mode = mode;
        sr.host = el;
        el.shadowRoot = sr;
        return sr;
      },
      getElementById(id) {
        let found = null;
        const walk = (n) => {
          for (const c of n.children || []) {
            if (!found && c.id === id) found = c;
            if (!found) walk(c);
          }
        };
        walk(el);
        return found;
      },
      querySelector(sel) {
        return el.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const out = [];
        const parts = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
        const matchesOne = (node, p) => {
          if (p.startsWith('#')) {
            const idPart = p.slice(1).split('[')[0];
            if (node.id !== idPart) return false;
            const attrMatch = p.match(/\[([a-zA-Z0-9_-]+)="([^"]+)"\]/);
            if (attrMatch && node.getAttribute(attrMatch[1]) !== attrMatch[2]) return false;
            return true;
          }
          if (p.startsWith('.')) {
            const cls = p.slice(1);
            return String(node.className || '').split(/\s+/).includes(cls);
          }
          const attrMatch = p.match(/^\[([a-zA-Z0-9_-]+)(?:="([^"]+)")?\]$/);
          if (attrMatch) {
            if (!node.hasAttribute(attrMatch[1])) return false;
            if (attrMatch[2] !== undefined && node.getAttribute(attrMatch[1]) !== attrMatch[2]) return false;
            return true;
          }
          return node.tagName === p.toUpperCase();
        };
        const walk = (n) => {
          for (const c of n.children || []) {
            if (parts.some((p) => matchesOne(c, p))) out.push(c);
            walk(c);
          }
        };
        walk(el);
        return out;
      },
      closest(sel) {
        let cur = el;
        while (cur) {
          if (sel === '[data-cascade-id]' && cur.hasAttribute?.('data-cascade-id')) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      contains(other) {
        let cur = other;
        while (cur) {
          if (cur === el) return true;
          cur = cur.parentNode;
        }
        return false;
      },
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      removeEventListener(ev, fn) {
        const arr = listeners.get(ev);
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      },
      dispatch(ev, detail = {}) {
        for (const fn of [...(listeners.get(ev) || [])]) {
          fn({ target: el, stopPropagation() {}, preventDefault() {}, ...detail });
        }
      },
    };
    function kOrId(k) { return k; }
    return el;
  }

  const documentElement = makeEl('html');
  const head = makeEl('head');
  const body = makeEl('body');
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  const cascade = makeEl('div');
  cascade.setAttribute('data-cascade-id', '11111111-2222-3333-4444-555555555555');
  const composerToolbar = makeEl('div');
  const modelBtn = makeEl('button');
  modelBtn.setAttribute('data-testid', 'model-selector-trigger');
  modelBtn.setAttribute('aria-label', 'Gemini 4 Carbon High');
  composerToolbar.appendChild(modelBtn);
  cascade.appendChild(composerToolbar);
  body.appendChild(cascade);

  const observers = [];
  class FakeMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.observed = [];
      this.disconnected = false;
      observers.push(this);
    }
    observe(target, options) {
      this.observed.push({ target, options });
    }
    disconnect() {
      this.disconnected = true;
    }
    trigger(records) {
      if (!this.disconnected) this.cb(records, this);
    }
  }

  const doc = {
    hidden: false,
    readyState: 'complete',
    documentElement,
    head,
    body,
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => documentElement.getElementById(id),
    querySelector: (sel) => documentElement.querySelector(sel),
    querySelectorAll: (sel) => documentElement.querySelectorAll(sel),
    addEventListener(ev, fn) { body.addEventListener(ev, fn); },
    removeEventListener(ev, fn) { body.removeEventListener(ev, fn); },
  };

  const win = {
    document: doc,
    location: { pathname: '/c/11111111-2222-3333-4444-555555555555' },
    MutationObserver: FakeMutationObserver,
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    removeEventListener() {},
  };

  return { win, doc, makeEl, observers, composerToolbar };
}

test('Obsidian Prism brand compliance, GPL-3.0 LICENSE, NOTICE, CITATION.cff, THIRD_PARTY_NOTICES.md, plugin.json, and sidecar.json contract', () => {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  assert.equal(pkgJson.name, 'obsidian-prism');
  assert.equal(pkgJson.version, '1.0.1');
  assert.equal(pkgJson.license, 'GPL-3.0-only');

  const pluginJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'plugin.json'), 'utf8'));
  assert.deepEqual(Object.keys(pluginJson).sort(), ['description', 'displayName', 'logo', 'name', 'version']);
  assert.equal(pluginJson.name, 'obsidian-prism');
  assert.equal(pluginJson.displayName, 'Obsidian Prism');
  assert.equal(pluginJson.version, '1.0.1');
  assert.equal(pluginJson.logo, 'assets/logo.svg');
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'assets', 'logo.svg')));

  const sidecarJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'sidecars', 'daemon', 'sidecar.json'), 'utf8'));
  assert.equal(sidecarJson.command, 'node');
  assert.deepEqual(sidecarJson.args, ['main.mjs']);
  assert.equal(sidecarJson.restart_policy, 'always');
  assert.equal(sidecarJson.display_name, 'Obsidian Prism Daemon');
  assert.equal(sidecarJson.has_web_ui, false);

  // Verify GPL-3.0 LICENSE, NOTICE, CITATION.cff & upstream MIT credits + non-affiliation disclaimer
  const licenseTxt = fs.readFileSync(path.join(ROOT_DIR, 'LICENSE'), 'utf8');
  assert.ok(licenseTxt.includes('GNU GENERAL PUBLIC LICENSE'));
  assert.ok(licenseTxt.includes('Version 3, 29 June 2007'));

  const extractGithubRepoSlugs = (docText) => {
    const slugs = new Set();
    for (const m of docText.matchAll(/https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g)) {
      slugs.add(m[1].replace(/\.git$/, ''));
    }
    return slugs;
  };

  const noticeFileTxt = fs.readFileSync(path.join(ROOT_DIR, 'NOTICE'), 'utf8');
  assert.ok(noticeFileTxt.includes('RMvdesi'));
  assert.ok(extractGithubRepoSlugs(noticeFileTxt).has('RMvdesi/obsidian-prism'));
  assert.ok(noticeFileTxt.includes('GPL-3.0'));

  const citationTxt = fs.readFileSync(path.join(ROOT_DIR, 'CITATION.cff'), 'utf8');
  assert.ok(citationTxt.includes('title: "Obsidian Prism"'));
  assert.ok(citationTxt.includes('license: GPL-3.0-only'));

  const noticesTxt = fs.readFileSync(path.join(ROOT_DIR, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.ok(noticesTxt.includes('0DNANCY'));
  assert.ok(noticesTxt.includes('AG Pulse contributors'));
  assert.ok(noticesTxt.includes('LLYSH-HANNARI'));
  const readmeTxt = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf8');
  const disclaimer = 'Obsidian Prism is an independent open-source project and is not affiliated with or endorsed by Google LLC.';
  assert.ok(noticesTxt.includes(disclaimer));
  assert.ok(readmeTxt.includes(disclaimer));

  const noticeSlugs = extractGithubRepoSlugs(noticesTxt);
  const readmeSlugs = extractGithubRepoSlugs(readmeTxt);
  const sevenUpstreamSlugs = [
    '0DNANCY/agy-claude-style',
    'ATtacK030130/antigrative-dashboard',
    'LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider',
    'Nwflower/dsh-claude-style',
    'Microqian2th/dsh-codex-effort-slider',
    'mobius/dsh-performance-slider',
    'claudenoshujin/claude-web',
  ];
  for (const slug of sevenUpstreamSlugs) {
    assert.ok(noticeSlugs.has(slug), `THIRD_PARTY_NOTICES.md must credit ${slug}`);
    assert.ok(readmeSlugs.has(slug), `README.md must credit ${slug}`);
  }

  // Verify absorbed upstream sources exist in vendor/
  const requiredVendorFiles = [
    'vendor/pulse-dashboard/compat/runtime-ui.mjs',
    'vendor/pulse-dashboard/compat/inline-widget.cjs',
    'vendor/pulse-dashboard/sidecars/panel/store.mjs',
    'vendor/pulse-dashboard/sidecars/panel/usage.mjs',
    'vendor/pulse-dashboard/sidecars/panel/metrics.mjs',
    'vendor/pulse-dashboard/sidecars/panel/discovery.mjs',
    'vendor/pulse-dashboard/sidecars/panel/context.mjs',
    'vendor/pulse-dashboard/sidecars/panel/rate-quality.mjs',
    'vendor/pulse-dashboard/sidecars/panel/format.mjs',
    'vendor/pulse-dashboard/inline-fallback.js',
    'vendor/effort-slider/upstream-client.js',
    'vendor/effort-slider/slider-coexist.js',
  ];
  for (const rel of requiredVendorFiles) {
    assert.ok(fs.existsSync(path.join(ROOT_DIR, rel)), `Missing absorbed vendor file: ${rel}`);
  }
});

test('i18n-locales.js covers all 5 languages (zh-CN, zh-TW, yue, en, ja) with Obsidian Prism brand, fold hints, coexistence & About keys', () => {
  const langs = ['zh-CN', 'zh-TW', 'yue', 'en', 'ja'];
  const requiredKeys = [
    'sectionTitle',
    'sectionSubtitle',
    'foldExpandHint',
    'foldCollapseHint',
    'optClaude',
    'optWarm',
    'setLightPresetTitle',
    'setLightPresetDesc',
    'optLightCrystal',
    'optLightAlabaster',
    'groupModules',
    'setTelemetryTitle',
    'setTelemetryDesc',
    'setEffortSliderTitle',
    'setEffortSliderDesc',
    'optAutoCoexist',
    'aboutGroupTitle',
    'aboutRepoSyncTitle',
    'aboutRepoSyncBtn',
    'aboutRepoChecking',
    'aboutRepoUpToDate',
    'aboutRepoUpdated',
    'aboutRepoNoRemote',
    'aboutCreditsTitle',
    'aboutLicenseTitle',
    'aboutDisclaimer',
  ];

  for (const lang of langs) {
    const ui = locales.getUiStrings(lang);
    for (const k of requiredKeys) {
      assert.ok(typeof ui[k] === 'string' && ui[k].length > 0, `Missing ${k} for ${lang}`);
    }
  }
  const zh = locales.getUiStrings('zh-CN');
  assert.equal(zh.sectionTitle, 'Obsidian Prism · 黑曜棱镜');
  assert.equal(zh.optWarm, 'Alabaster 暖岩');
  assert.equal(zh.optClaude, 'Alabaster 暖岩');
  assert.equal(zh.setLightPresetTitle, '浅色表面质感');
  assert.equal(zh.optLightCrystal, '白昼冷晶');
  assert.equal(zh.optLightAlabaster, '暖白画册');
  assert.equal(zh.groupModules, '吸收集成模块（智能共存让位）');
  assert.equal(zh.optAutoCoexist, '智能共存');
  assert.ok(zh.aboutDisclaimer.includes('Google LLC'));
});

test('vendor/pulse-dashboard/inline-fallback.js politely yields to external Pulse plugin and mounts 8+ native IDs when standalone', async () => {
  const envExt = createLightweightDom();
  envExt.win.__agPulseRuntimeOwner = 'external-pulse-owner-token';
  const extBar = envExt.makeEl('div');
  extBar.id = 'ag-pulse-status-bar';
  envExt.composerToolbar.appendChild(extBar);

  const ctlExt = telemetryMod.createTelemetryController({ window: envExt.win, document: envExt.doc });
  const stAuto = ctlExt.sync({ telemetryModule: 'auto', __fallbackDelayMs: 10 });
  assert.equal(stAuto.yieldedToExternal, true);
  assert.equal(stAuto.mountedFallback, false);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(envExt.doc.querySelectorAll('#ag-pulse-status-bar').length, 1);
  assert.equal(extBar.getAttribute('data-ag-prism-fallback'), null);

  ctlExt.sync({ telemetryModule: 'off' });
  assert.equal(extBar.style.display, 'none');
  ctlExt.sync({ telemetryModule: 'auto' });
  assert.equal(extBar.style.display, '');
  ctlExt.destroy();

  const envSolo = createLightweightDom();
  envSolo.win.__agPrismMetricsCall = (payloadStr) => {
    const req = JSON.parse(payloadStr);
    setTimeout(() => {
      envSolo.win.__agPrismMetricsResolve(req.id, {
        connection: 'ok',
        speed: {
          model: 'Gemini 4 Carbon High',
          tps: 68.4,
          latestTps: 74.2,
          ttftSeconds: 0.64,
          rounds: 5,
          cacheHitRate: 0.912,
          totalTokens: 245000,
          context: {
            model: 'Gemini 4 Carbon High',
            usedTokens: 128000,
            maxTokens: 512000,
            usedFraction: 0.25,
            sampledAt: Date.now(),
          },
        },
      });
    }, 5);
  };

  const ctlSolo = telemetryMod.createTelemetryController({ window: envSolo.win, document: envSolo.doc });
  const stWait = ctlSolo.sync({ telemetryModule: 'auto', __fallbackDelayMs: 25 });
  assert.equal(stWait.waitingForExternal, true);
  assert.equal(stWait.mountedFallback, false);

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 30));
    const el = envSolo.doc.getElementById('ag-pulse-status-bar');
    if (el && el.shadowRoot && el.shadowRoot.getElementById('context-percent')?.textContent === '25%') break;
  }
  assert.equal(ctlSolo.getState().mountedFallback, true);

  const barEl = envSolo.doc.getElementById('ag-pulse-status-bar');
  assert.ok(barEl);
  assert.equal(barEl.getAttribute('data-ag-prism-fallback'), '1');
  assert.ok(barEl.shadowRoot);

  const nativeIds = [
    'context-card',
    'context-ring',
    'context-percent',
    'context-summary',
    'context-tokens',
    'context-track',
    'context-fill',
    'context-model',
    'tps',
    'ttft',
    'latest-rate',
  ];
  for (const id of nativeIds) {
    assert.ok(barEl.shadowRoot.getElementById(id), `Expected native ID #${id} in fallback ShadowRoot`);
  }
  assert.equal(barEl.shadowRoot.getElementById('context-percent').textContent, '25%');
  assert.equal(barEl.shadowRoot.getElementById('tps').textContent, '68.4');

  envSolo.win.__agPulseRuntimeOwner = 'late-arriving-external-pulse';
  await ctlSolo.refresh();
  assert.equal(ctlSolo.getState().mountedFallback, false);
  assert.equal(ctlSolo.getState().yieldedToExternal, true);
  assert.equal(envSolo.doc.getElementById('ag-pulse-status-bar'), null);
  ctlSolo.destroy();

  // Regression guard: on Customizations / Installed Plugins page (no composer, but sidebar has pinned [data-cascade-id] rows),
  // fallback Dashboard MUST NOT mount into sidebar rows or document.body!
  const envPluginsPage = createLightweightDom();
  while (envPluginsPage.doc.body.children.length > 0) {
    envPluginsPage.doc.body.children[0].remove();
  }
  const pinnedRow = envPluginsPage.makeEl('div');
  pinnedRow.setAttribute('data-testid', 'conversation-row-sidebar');
  pinnedRow.setAttribute('data-cascade-id', '31a09976-b7b4-4ba3-8b33-a14727fad7f5');
  envPluginsPage.doc.body.appendChild(pinnedRow);
  const ctlPlugins = telemetryMod.createTelemetryController({ window: envPluginsPage.win, document: envPluginsPage.doc });
  ctlPlugins.sync({ telemetryModule: 'on' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ctlPlugins.getState().mountedFallback, false);
  assert.equal(envPluginsPage.doc.getElementById('ag-pulse-status-bar'), null);
  assert.equal(pinnedRow.children.length, 0);
  ctlPlugins.destroy();

  // Regression guard 2: even when telemetryModule === 'on', if external #ag-pulse-status-bar mounts later,
  // refresh() must immediately yield & unmount fallback so bars never stack or duplicate!
  const envOnMode = createLightweightDom();
  const ctlOnMode = telemetryMod.createTelemetryController({ window: envOnMode.win, document: envOnMode.doc });
  ctlOnMode.sync({ telemetryModule: 'on' });
  assert.equal(ctlOnMode.getState().mountedFallback, true);
  const extRealBar = envOnMode.makeEl('div');
  extRealBar.id = 'ag-pulse-status-bar';
  envOnMode.composerToolbar.appendChild(extRealBar);
  await ctlOnMode.refresh();
  assert.equal(ctlOnMode.getState().mountedFallback, false);
  assert.equal(ctlOnMode.getState().yieldedToExternal, true);
  assert.equal(envOnMode.doc.querySelectorAll('#ag-pulse-status-bar').length, 1);
  ctlOnMode.destroy();

  // Regression guard 3: during active agent turns, [data-testid="model-selector-trigger"] moves inside a top-left
  // block <div class="min-w-0">; fallback MUST NOT append there and stack vertically!
  const envActiveTurn = createLightweightDom();
  envActiveTurn.composerToolbar.className = 'min-w-0';
  const ctlActiveTurn = telemetryMod.createTelemetryController({ window: envActiveTurn.win, document: envActiveTurn.doc });
  ctlActiveTurn.sync({ telemetryModule: 'on' });
  assert.equal(ctlActiveTurn.getState().mountedFallback, false);
  const bottomFooter = envActiveTurn.makeEl('div');
  bottomFooter.className = 'agy-composer-footer flex w-full items-center';
  envActiveTurn.doc.body.appendChild(bottomFooter);
  await ctlActiveTurn.refresh();
  assert.equal(ctlActiveTurn.getState().mountedFallback, true);
  assert.equal(bottomFooter.children.length, 1);
  assert.equal(envActiveTurn.composerToolbar.children.length, 1, 'Top-left min-w-0 wrapper must contain only the model button');
  ctlActiveTurn.destroy();
});

test('vendor/effort-slider/slider-coexist.js yields 100% to external __agCodexEffortSliderInstance and throttles built-in observer (120ms + skip non-menu mutations)', async () => {
  const envExt = createLightweightDom();
  let extStopCalled = false;
  envExt.win.__agCodexEffortSliderInstance = {
    stop() { extStopCalled = true; },
    rescan() {},
  };

  const ctlExt = sliderMod.createEffortSliderController({ window: envExt.win, document: envExt.doc });
  const stExt = ctlExt.sync({ effortSliderModule: 'auto' });
  assert.equal(stExt.yieldedToExternal, true);
  assert.equal(stExt.mountedPrism, false);
  assert.equal(envExt.observers.length, 0, 'Must create ZERO duplicate body MutationObservers when external slider exists');
  assert.equal(extStopCalled, false);
  ctlExt.destroy();

  const envSolo = createLightweightDom();
  const ctlSolo = sliderMod.createEffortSliderController({ window: envSolo.win, document: envSolo.doc });
  const stSolo = ctlSolo.sync({ effortSliderModule: 'auto' });
  assert.equal(stSolo.mountedPrism, true);
  assert.equal(envSolo.win.__agCodexEffortSliderInstance.__prismOwned, true);
  assert.ok(envSolo.observers.length >= 1);

  const chatDiv = envSolo.makeEl('div');
  envSolo.doc.body.appendChild(chatDiv);
  for (let i = 0; i < 20; i++) {
    envSolo.observers[0].trigger([{ target: chatDiv, addedNodes: [] }]);
  }
  assert.equal(ctlSolo.getState().perfStats.executedScans, 0);

  const modelBtn = envSolo.doc.querySelector('[data-testid="model-selector-trigger"]');
  for (let i = 0; i < 10; i++) {
    envSolo.observers[0].trigger([{ target: modelBtn, addedNodes: [] }]);
  }
  assert.equal(ctlSolo.getState().perfStats.executedScans, 1);
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(ctlSolo.getState().perfStats.executedScans <= 2);

  ctlSolo.destroy();
  assert.equal(envSolo.win.__agCodexEffortSliderInstance, undefined);
});

test('PrismDaemon & install-plugin.cjs: obsidian-prism target, legacy antigravity-prism cleanup, and __agPrismRepoCall Git status + pull --ff-only hot-reload', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-prism-plugin-e2e-'));
  const pluginsRoot = path.join(workDir, 'plugins');
  const legacyPluginDir = path.join(pluginsRoot, 'antigravity-prism');
  const targetPluginDir = path.join(pluginsRoot, 'obsidian-prism');

  // Create mock Git remote & working clone to test executeRepoAction('status' & 'pull')
  const remoteGitDir = path.join(workDir, 'remote-origin.git');
  const localGitRepo = path.join(workDir, 'local-repo');
  execFileSync('git', ['init', '--bare', remoteGitDir], { stdio: 'ignore' });
  execFileSync('git', ['init', localGitRepo], { stdio: 'ignore' });
  execFileSync('git', ['-C', localGitRepo, 'config', 'user.email', 'test@obsidian-prism.local'], { stdio: 'ignore' });
  execFileSync('git', ['-C', localGitRepo, 'config', 'user.name', 'Obsidian Prism Test'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(localGitRepo, 'README.md'), '# v1\n', 'utf8');
  execFileSync('git', ['-C', localGitRepo, 'add', 'README.md'], { stdio: 'ignore' });
  execFileSync('git', ['-C', localGitRepo, 'commit', '-m', 'init commit'], { stdio: 'ignore' });
  const branchName = execFileSync('git', ['-C', localGitRepo, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();

  // Seed legacy antigravity-prism sibling with user config to test migration + auto-removal
  fs.mkdirSync(legacyPluginDir, { recursive: true });
  fs.writeFileSync(path.join(legacyPluginDir, 'config.json'), '{"palette":"warm","lightPreset":"alabaster"}\n', 'utf8');

  const sockets = new Set();
  const cdpCalls = [];
  let wsServerConn = null;
  let lastRepoResolveExpr = null;
  let metricsResolveExpr = null;
  let lastOmniResolveExpr = null;

  function sendWs(sock, obj) {
    if (sock.destroyed) return;
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    let hdr;
    if (payload.length < 126) {
      hdr = Buffer.from([0x81, payload.length]);
    } else if (payload.length < 65536) {
      hdr = Buffer.alloc(4);
      hdr[0] = 0x81;
      hdr[1] = 126;
      hdr.writeUInt16BE(payload.length, 2);
    } else {
      hdr = Buffer.alloc(10);
      hdr[0] = 0x81;
      hdr[1] = 127;
      hdr.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    sock.write(Buffer.concat([hdr, payload]));
  }

  const server = http.createServer((req, res) => {
    if (req.url === '/json/list') {
      const p = server.address().port;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify([
          {
            id: 'HANG_LP',
            type: 'page',
            title: 'Untitled - launchpad',
            url: 'vscode-file://vscode-app/launchpad.html',
            webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/page/HANG_LP`,
          },
          {
            id: 'USER_DEV_PREVIEW',
            type: 'page',
            title: 'AI Rap Video Generator',
            url: 'http://127.0.0.1:3115/',
            webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/page/USER_DEV_PREVIEW`,
          },
          {
            id: 'EXTERNAL_SPOOF',
            type: 'page',
            title: 'Antigravity',
            url: 'https://example.com/app',
            webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/page/EXTERNAL_SPOOF`,
          },
          {
            id: 'MAIN_WB',
            type: 'page',
            title: 'Workspace - Antigravity',
            url: 'vscode-file://vscode-app/workbench.html',
            webSocketDebuggerUrl: `ws://127.0.0.1:${p}/devtools/page/MAIN_WB`,
          },
        ])
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  let touchedLaunchpad = false;
  let touchedForeignPreview = false;

  server.on('upgrade', (req, socket) => {
    if (req.url.includes('HANG_LP')) {
      touchedLaunchpad = true;
      socket.destroy();
      return;
    }
    if (req.url.includes('USER_DEV_PREVIEW') || req.url.includes('EXTERNAL_SPOOF')) {
      touchedForeignPreview = true;
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    sockets.add(socket);
    wsServerConn = socket;
    socket.on('close', () => sockets.delete(socket));

    let buf = Buffer.alloc(0);
    let frags = [];
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const fin = (buf[0] & 0x80) !== 0;
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        const mLen = masked ? 4 : 0;
        if (buf.length < off + mLen + len) return;
        let data = Buffer.from(buf.subarray(off + mLen, off + mLen + len));
        if (masked) {
          const m = buf.subarray(off, off + 4);
          for (let i = 0; i < data.length; i++) data[i] ^= m[i & 3];
        }
        buf = buf.subarray(off + mLen + len);
        if (opcode === 0x8) { socket.end(); return; }
        if (opcode === 0x1 || opcode === 0x0) {
          frags.push(data);
          if (fin) {
            const msg = JSON.parse(Buffer.concat(frags).toString('utf8'));
            frags = [];
            cdpCalls.push({ method: msg.method, params: msg.params });
            if (msg.method === 'Page.addScriptToEvaluateOnNewDocument') {
              sendWs(socket, { id: msg.id, result: { identifier: 'doc-script-1' } });
            } else if (msg.method === 'Runtime.evaluate') {
              const expr = String(msg.params?.expression || '');
              if (expr.includes('__agPrismMetricsResolve')) {
                metricsResolveExpr = expr;
              } else if (expr.includes('__agPrismRepoBridge')) {
                if (expr.includes('.resolve(')) lastRepoResolveExpr = expr;
              } else if (expr.includes('__agPrismOmniBridge') && expr.includes('b.resolve(')) {
                lastOmniResolveExpr = expr;
              }
              sendWs(socket, {
                id: msg.id,
                result: {
                  result: {
                    type: 'object',
                    value: {
                      ready: true,
                      hasPrism: true,
                      hasRepoBridge: true,
                      prismAttr: '1.0.1',
                      hasStyle: true,
                      version: '1.0.1',
                      status: 'ok',
                    },
                  },
                },
              });
            } else {
              sendWs(socket, { id: msg.id, result: {} });
            }
          }
        }
      }
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  let daemon = null;
  try {
    assert.ok(installPluginTool.getDefaultPluginTargetDir().endsWith('obsidian-prism'));

    const installRes = await installPluginTool.installPlugin({
      sourceDir: ROOT_DIR,
      targetDir: targetPluginDir,
      startDaemon: false,
    });
    assert.equal(installRes.ok, true);
    assert.equal(installRes.cleanedLegacyPluginDir, true, 'Must clean legacy antigravity-prism sibling directory');
    assert.equal(fs.existsSync(legacyPluginDir), false);
    assert.equal(installRes.preservedConfig, true, 'Must migrate config.json from legacy antigravity-prism');
    assert.equal(JSON.parse(fs.readFileSync(path.join(targetPluginDir, 'config.json'), 'utf8')).lightPreset, 'alabaster');
    assert.ok(fs.existsSync(path.join(targetPluginDir, 'THIRD_PARTY_NOTICES.md')));
    assert.ok(fs.existsSync(path.join(targetPluginDir, 'repo-meta.json')));

    // Start PrismDaemon linked to localGitRepo
    let lazyCollectorInvoked = 0;
    daemon = new PrismDaemon({
      rootDir: targetPluginDir,
      gitRepoDir: localGitRepo,
      overridePort: port,
      pollIntervalMs: 500,
      silent: true,
      metricsProvider: async (input) => {
        lazyCollectorInvoked += 1;
        return { connection: 'ok', speed: { tps: 88.8, conversationId: input?.conversationId || null }, groups: [] };
      },
    });
    daemon.claimOwnership();
    daemon.running = true;
    const tickRes = await daemon.tick();
    assert.equal(tickRes.attached, 1);
    assert.equal(touchedLaunchpad, false);
    assert.equal(lazyCollectorInvoked, 0);

    assert.ok(cdpCalls.some((c) => c.method === 'Runtime.addBinding' && c.params?.name === METRICS_BINDING));
    assert.ok(cdpCalls.some((c) => c.method === 'Runtime.addBinding' && c.params?.name === REPO_BINDING));
    assert.ok(cdpCalls.some((c) => c.method === 'Runtime.addBinding' && c.params?.name === OMNI_BINDING));
    assert.equal(Boolean(daemon.omniServer && daemon.omniServer.running), true, 'PrismDaemon must auto-start OmniServer on 127.0.0.1');
    const omniPortBeforeStop = daemon.omniServer.port;
    assert.ok(omniPortBeforeStop > 0);

    // Test 1: Git status without remote -> noRemote: true
    const noRemoteStatus = await daemon.executeRepoAction({ action: 'status' });
    assert.equal(noRemoteStatus.ok, true);
    assert.equal(noRemoteStatus.isGitRepo, true);
    assert.equal(noRemoteStatus.noRemote, true);
    assert.equal(noRemoteStatus.branch, branchName);
    assert.ok(noRemoteStatus.commit.length >= 6);

    // Test 2: Link remote, push an upstream commit from another clone, test status & pull --ff-only over CDP binding!
    execFileSync('git', ['-C', localGitRepo, 'remote', 'add', 'origin', remoteGitDir], { stdio: 'ignore' });
    execFileSync('git', ['-C', localGitRepo, 'push', '-u', 'origin', branchName], { stdio: 'ignore' });

    const pusherClone = path.join(workDir, 'pusher-clone');
    execFileSync('git', ['clone', remoteGitDir, pusherClone], { stdio: 'ignore' });
    execFileSync('git', ['-C', pusherClone, 'config', 'user.email', 'bot@obsidian-prism.local'], { stdio: 'ignore' });
    execFileSync('git', ['-C', pusherClone, 'config', 'user.name', 'Upstream Bot'], { stdio: 'ignore' });
    fs.writeFileSync(path.join(pusherClone, 'README.md'), '# v1.1 upstream update\n', 'utf8');
    execFileSync('git', ['-C', pusherClone, 'add', 'README.md'], { stdio: 'ignore' });
    execFileSync('git', ['-C', pusherClone, 'commit', '-m', 'feat: upstream update'], { stdio: 'ignore' });
    const upstreamHash = execFileSync('git', ['-C', pusherClone, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    execFileSync('git', ['-C', pusherClone, 'push', 'origin', branchName], { stdio: 'ignore' });

    const remoteStatus = await daemon.executeRepoAction({ action: 'status' });
    assert.equal(remoteStatus.hasRemote, true);
    assert.equal(remoteStatus.behind, 1);
    assert.equal(remoteStatus.hasUpdates, true);
    assert.equal(remoteStatus.upToDate, false);

    const beforeDocScripts = cdpCalls.filter((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument').length;
    sendWs(wsServerConn, {
      method: 'Runtime.bindingCalled',
      params: {
        name: REPO_BINDING,
        payload: JSON.stringify({ id: 42, action: 'pull' }),
      },
    });

    for (let i = 0; i < 40 && !lastRepoResolveExpr; i++) {
      await new Promise((r) => setTimeout(r, 60));
    }
    assert.ok(lastRepoResolveExpr, 'Expected __agPrismRepoBridge.resolve callback via CDP');
    assert.ok(lastRepoResolveExpr.includes(upstreamHash));
    assert.ok(lastRepoResolveExpr.includes('"updated":true'));
    assert.ok(lastRepoResolveExpr.includes('"hotReloaded":true'));

    const afterDocScripts = cdpCalls.filter((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument').length;
    assert.ok(afterDocScripts > beforeDocScripts, 'Pulling new commits must immediately hot-push updated bundle to CDP windows');

    // Trigger batch setting update (`patch-batch`) over SETTING_BINDING -> writes config.json once & fast-refreshes
    sendWs(wsServerConn, {
      method: 'Runtime.bindingCalled',
      params: {
        name: '__agPrismSetting',
        payload: JSON.stringify({
          action: 'patch-batch',
          entries: { palette: 'warm', motionLevel: 'subtle', targetFps: '120', homeRipple: false, language: 'ja' },
        }),
      },
    });
    await new Promise((r) => setTimeout(r, 90));
    const savedCfgAfterBatch = JSON.parse(fs.readFileSync(path.join(targetPluginDir, 'config.json'), 'utf8'));
    assert.equal(savedCfgAfterBatch.palette, 'warm');
    assert.equal(savedCfgAfterBatch.motionLevel, 'subtle');
    assert.equal(savedCfgAfterBatch.targetFps, '120');
    assert.equal(savedCfgAfterBatch.homeRipple, false);
    assert.equal(savedCfgAfterBatch.ripple, 'off', 'Expected legacy twin key ripple synced on disk');
    assert.equal(savedCfgAfterBatch.language, 'ja');
    assert.equal(savedCfgAfterBatch.lang, 'ja', 'Expected legacy twin key lang synced on disk');
    assert.equal(touchedForeignPreview, false, 'PrismDaemon must never connect or expose RPC bindings to non-host preview pages');

    // Trigger on-demand metrics request as well
    sendWs(wsServerConn, {
      method: 'Runtime.bindingCalled',
      params: {
        name: METRICS_BINDING,
        payload: JSON.stringify({ id: 7, input: { conversationId: '11111111-2222-3333-4444-555555555555' } }),
      },
    });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(lazyCollectorInvoked, 1);
    assert.ok(metricsResolveExpr && metricsResolveExpr.includes('88.8'));

    // Trigger OMNI_BINDING RPC over CDP -> resolves path & returns via __agPrismOmniBridge.resolve
    sendWs(wsServerConn, {
      method: 'Runtime.bindingCalled',
      params: {
        name: OMNI_BINDING,
        payload: JSON.stringify({
          id: 99,
          action: 'resolvePath',
          rawPath: '@README.md#L1-L2',
          workspaceHint: targetPluginDir,
        }),
      },
    });
    for (let i = 0; i < 30 && !lastOmniResolveExpr; i++) {
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.ok(lastOmniResolveExpr, 'Expected __agPrismOmniBridge.resolve callback via CDP');
    assert.ok(lastOmniResolveExpr.includes('"exists":true'));
    assert.ok(lastOmniResolveExpr.includes('"line":1'));

    await daemon.stop(false);
    assert.equal(daemon.omniServer, null, 'PrismDaemon.stop() must tear down OmniServer cleanly');
    daemon = null;

    const uninst = await installPluginTool.uninstallPlugin({ targetDir: targetPluginDir, noCdp: true });
    assert.equal(uninst.ok, true);
    assert.equal(fs.existsSync(targetPluginDir), false);
  } finally {
    if (daemon) await daemon.stop(false).catch(() => {});
    await installPluginTool.uninstallPlugin({ targetDir: targetPluginDir, noCdp: true }).catch(() => {});
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('PrismDaemon HS-1 & SEC-2: 68 rapid-fire setting updates, multi-window cross-sync & reload epoch reset suffer 0 rebound & 0 script leaks; child iframe bindings are rejected & stop() disposes lazy services', async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-hs1-sec2-'));
  const targetPluginDir = path.join(workDir, 'obsidian-prism');
  await installPluginTool.installPlugin({ targetDir: targetPluginDir, noCdp: true, skipHostConfig: true, startDaemon: false });

  const sockets = new Set();
  const pageConns = new Map();
  let scriptSeq = 0;
  const activeScripts = new Map(); // id -> source
  let totalAddScriptCalls = 0;

  function createWindowVm(pageId) {
    const storeMap = new Map();
    const localStorageMock = {
      getItem: (k) => (storeMap.has(k) ? storeMap.get(k) : null),
      setItem: (k, v) => storeMap.set(k, String(v)),
      removeItem: (k) => storeMap.delete(k),
    };
    const rootAttrs = new Map();
    const docEl = {
      setAttribute: (k, v) => rootAttrs.set(k, String(v)),
      getAttribute: (k) => rootAttrs.get(k) || null,
      hasAttribute: (k) => rootAttrs.has(k),
      removeAttribute: (k) => rootAttrs.delete(k),
      style: { setProperty() {}, removeProperty() {} },
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    };
    const vmDoc = {
      title: `Obsidian Prism - Antigravity (${pageId})`,
      readyState: 'complete',
      hidden: false,
      documentElement: docEl,
      head: { appendChild() {}, lastElementChild: null },
      body: { appendChild() {}, classList: { contains: (c) => c === 'monaco-workbench' } },
      createElement: () => ({
        id: '',
        style: {},
        setAttribute() {},
        appendChild() {},
        remove() {},
        addEventListener() {},
        classList: { add() {}, remove() {}, contains: () => false },
      }),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
    };
    const vmWin = {
      location: { href: 'vscode-file://vscode-app/workbench.html' },
      document: vmDoc,
      localStorage: localStorageMock,
      navigator: { language: 'zh-CN', clipboard: { writeText: async () => {} } },
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
      MutationObserver: class { observe() {} disconnect() {} },
      ResizeObserver: class { observe() {} disconnect() {} },
      IntersectionObserver: class { observe() {} disconnect() {} },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame() {},
      performance: { now: () => Date.now() },
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      CSS: {},
      setTimeout,
      clearTimeout,
      setInterval: () => ({ unref() {} }),
      clearInterval() {},
      addEventListener() {},
      removeEventListener() {},
      __agPrismSetting: (payload) => {
        const sock = pageConns.get(pageId);
        if (sock) {
          sendWs(sock, {
            method: 'Runtime.bindingCalled',
            params: { name: '__agPrismSetting', payload, executionContextId: pageState.get(pageId).mainCtxId },
          });
        }
      },
    };
    vmWin.window = vmWin;
    vmWin.globalThis = vmWin;
    return { vmWin, vmCtx: vm.createContext(vmWin) };
  }

  const pageState = new Map([
    ['page-a', { ...createWindowVm('page-a'), mainCtxId: 1, scripts: new Map() }],
    ['page-b', { ...createWindowVm('page-b'), mainCtxId: 1, scripts: new Map() }],
  ]);

  function sendWs(socket, obj) {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    let hdr;
    if (payload.length < 126) {
      hdr = Buffer.from([0x81, payload.length]);
    } else if (payload.length < 65536) {
      hdr = Buffer.alloc(4);
      hdr[0] = 0x81;
      hdr[1] = 126;
      hdr.writeUInt16BE(payload.length, 2);
    } else {
      hdr = Buffer.alloc(10);
      hdr[0] = 0x81;
      hdr[1] = 127;
      hdr.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    socket.write(Buffer.concat([hdr, payload]));
  }

  const server = http.createServer((req, res) => {
    if (req.url === '/json/list') {
      const addr = server.address();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify([
          {
            id: 'page-a',
            type: 'page',
            title: 'Obsidian Prism - Antigravity (A)',
            url: 'vscode-file://vscode-app/workbench.html',
            webSocketDebuggerUrl: `ws://127.0.0.1:${addr.port}/devtools/page/page-a`,
          },
          {
            id: 'page-b',
            type: 'page',
            title: 'Obsidian Prism - Antigravity (B)',
            url: 'vscode-file://vscode-app/workbench.html',
            webSocketDebuggerUrl: `ws://127.0.0.1:${addr.port}/devtools/page/page-b`,
          },
        ])
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', (req, socket) => {
    const pageId = req.url?.endsWith('/page-b') ? 'page-b' : 'page-a';
    const topFrameId = `TOP_MAIN_FRAME_${pageId}`;
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
      if (pageConns.get(pageId) === socket) pageConns.delete(pageId);
    });
    const accept = crypto
      .createHash('sha1')
      .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
        accept +
        '\r\n\r\n'
    );
    pageConns.set(pageId, socket);

    let buf = Buffer.alloc(0);
    let frags = [];
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const fin = (buf[0] & 0x80) !== 0;
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        const mLen = masked ? 4 : 0;
        if (buf.length < off + mLen + len) return;
        let data = Buffer.from(buf.subarray(off + mLen, off + mLen + len));
        if (masked) {
          const mask = buf.subarray(off, off + 4);
          for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
        }
        buf = buf.subarray(off + mLen + len);
        if (opcode === 0x8) {
          socket.end();
          return;
        }
        if (opcode !== 0x1 && opcode !== 0x0) continue;
        frags.push(data);
        if (!fin) continue;
        let msg;
        try {
          msg = JSON.parse(Buffer.concat(frags).toString('utf8'));
          frags = [];
        } catch {
          frags = [];
          continue;
        }
        const st = pageState.get(pageId);
        if (msg.method === 'Page.getFrameTree') {
          sendWs(socket, { id: msg.id, result: { frameTree: { frame: { id: topFrameId } } } });
        } else if (msg.method === 'Runtime.enable') {
          sendWs(socket, { id: msg.id, result: {} });
          sendWs(socket, {
            method: 'Runtime.executionContextCreated',
            params: { context: { id: 1, auxData: { frameId: topFrameId, isDefault: true, type: 'default' } } },
          });
          sendWs(socket, {
            method: 'Runtime.executionContextCreated',
            params: { context: { id: 2, auxData: { frameId: 'UNTRUSTED_CHILD_IFRAME', isDefault: true, type: 'default' } } },
          });
          sendWs(socket, {
            method: 'Runtime.executionContextCreated',
            params: { context: { id: 3, auxData: { frameId: topFrameId, isDefault: false, type: 'isolated' } } },
          });
        } else if (msg.method === 'Page.addScriptToEvaluateOnNewDocument') {
          const src = msg.params?.source || '';
          setTimeout(() => {
            const id = `sc-${++scriptSeq}`;
            totalAddScriptCalls += 1;
            activeScripts.set(id, src);
            st.scripts.set(id, src);
            if (!socket.destroyed) sendWs(socket, { id: msg.id, result: { identifier: id } });
          }, 12);
        } else if (msg.method === 'Page.removeScriptToEvaluateOnNewDocument') {
          const rmId = msg.params?.identifier;
          activeScripts.delete(rmId);
          st.scripts.delete(rmId);
          sendWs(socket, { id: msg.id, result: {} });
        } else if (msg.method === 'Runtime.evaluate') {
          let val = { ok: true };
          try {
            val = vm.runInContext(msg.params.expression, st.vmCtx);
          } catch {}
          sendWs(socket, { id: msg.id, result: { result: { type: 'object', value: val } } });
        } else {
          sendWs(socket, { id: msg.id, result: {} });
        }
      }
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const waitBroadcastDrain = async (daemonInst) => {
    for (let w = 0; w < 60; w++) {
      await new Promise((r) => setTimeout(r, 25));
      if (!daemonInst._broadcastRunning && !daemonInst._broadcastPending) break;
    }
    await new Promise((r) => setTimeout(r, 40));
  };

  let thoughtDisposed = 0;
  let thoughtGetConfigCalls = 0;
  let daemon = null;
  try {
    daemon = new PrismDaemon({
      rootDir: targetPluginDir,
      overridePort: port,
      pollIntervalMs: 1000,
      silent: true,
      thoughtService: {
        getSanitizedConfig: () => {
          thoughtGetConfigCalls += 1;
          return { ok: true };
        },
        dispose: () => {
          thoughtDisposed += 1;
        },
      },
    });
    daemon.claimOwnership();
    daemon.running = true;
    const tickRes = await daemon.tick();
    assert.equal(tickRes.attached, 2, 'Expected both Window A and Window B attached');
    const stA = pageState.get('page-a');
    const stB = pageState.get('page-b');
    assert.ok(stA.vmWin.__agPrism && stB.vmWin.__agPrism, 'Expected ui-runtime mounted inside both VM windows');

    // SEC-2 Test: Child iframe (ctx 2) and isolated world (ctx 3) binding calls MUST be silently rejected!
    const sockA = pageConns.get('page-a');
    sendWs(sockA, {
      method: 'Runtime.bindingCalled',
      params: {
        name: '__agPrismSetting',
        payload: JSON.stringify({ key: 'palette', value: 'claude' }),
        executionContextId: 2,
      },
    });
    sendWs(sockA, {
      method: 'Runtime.bindingCalled',
      params: {
        name: THOUGHT_BINDING,
        payload: JSON.stringify({ id: 1, action: 'get-config' }),
        executionContextId: 2,
      },
    });
    sendWs(sockA, {
      method: 'Runtime.bindingCalled',
      params: {
        name: THOUGHT_BINDING,
        payload: JSON.stringify({ id: 2, action: 'get-config' }),
        executionContextId: 3,
      },
    });
    await new Promise((r) => setTimeout(r, 60));
    const cfgAfterUntrusted = JSON.parse(fs.readFileSync(path.join(targetPluginDir, 'config.json'), 'utf8'));
    assert.equal(cfgAfterUntrusted.palette, 'obsidian', 'SEC-2: Child iframe binding must never mutate config.json');
    assert.equal(thoughtGetConfigCalls, 0, 'SEC-2: Child iframe & isolated world must never invoke THOUGHT_BINDING');

    // Main frame (ctx 1) binding call succeeds
    sendWs(sockA, {
      method: 'Runtime.bindingCalled',
      params: {
        name: THOUGHT_BINDING,
        payload: JSON.stringify({ id: 3, action: 'get-config' }),
        executionContextId: 1,
      },
    });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(thoughtGetConfigCalls, 1, 'Top-level main frame context must be permitted');

    // Phase A (HS-1): Fire 68 rapid-fire setting updates from Window A (localWriteEpoch reaches 68)
    const palettes = ['obsidian', 'claude', 'warm'];
    const accents = ['follow', 'amber', 'iris', 'cobalt', 'mono'];
    const motions = ['off', 'subtle', 'standard', 'ultra'];
    for (let i = 1; i <= 68; i++) {
      const patch =
        i === 68
          ? { palette: 'warm', accentTone: 'cobalt', motionLevel: 'subtle', omniModule: 'on' }
          : {
              palette: palettes[i % palettes.length],
              accentTone: accents[i % accents.length],
              motionLevel: motions[i % motions.length],
              omniModule: i % 2 === 0 ? 'on' : 'off',
            };
      stA.vmWin.__agPrism.saveSettingsBatch(patch);
    }
    await waitBroadcastDrain(daemon);

    assert.equal(stA.vmWin.__agPrism.getState().cfg.palette, 'warm');
    assert.equal(stA.vmWin.__agPrism.getState().cfg.accentTone, 'cobalt');
    assert.equal(stB.vmWin.__agPrism.getState().cfg.palette, 'warm', 'Window B must receive Window A cross-window sync');
    assert.equal(stB.vmWin.__agPrism.getState().cfg.accentTone, 'cobalt');
    assert.ok(
      totalAddScriptCalls <= 20,
      `HS-1: Single-flight coalescing should collapse 68 rapid clicks across 2 windows (got ${totalAddScriptCalls})`
    );

    // Phase B (Cross-window epoch isolation): Window B (localWriteEpoch 1..12 << Window A's 68!) rapid-fires 12 updates
    for (let j = 1; j <= 12; j++) {
      const patch =
        j === 12
          ? { palette: 'claude', accentTone: 'amber', motionLevel: 'ultra', omniModule: 'off' }
          : {
              palette: palettes[j % palettes.length],
              accentTone: accents[j % accents.length],
              motionLevel: motions[j % motions.length],
              omniModule: j % 2 === 0 ? 'on' : 'off',
            };
      stB.vmWin.__agPrism.saveSettingsBatch(patch);
    }
    await waitBroadcastDrain(daemon);

    assert.equal(stB.vmWin.__agPrism.getState().cfg.palette, 'claude', 'Window B must not suffer stale rebound');
    assert.equal(stB.vmWin.__agPrism.getState().cfg.accentTone, 'amber');
    assert.equal(
      stA.vmWin.__agPrism.getState().cfg.palette,
      'claude',
      'Window A (with localWriteEpoch=68) must never drop sibling Window B updates (baseRefreshExpr omits __ackEpoch)'
    );
    assert.equal(stA.vmWin.__agPrism.getState().cfg.accentTone, 'amber');

    // Phase C (Ctrl+Shift+R reload reset): Window A reloads (localWriteEpoch resets to 0) and rapid-fires 10 updates
    sendWs(sockA, { method: 'Runtime.executionContextsCleared', params: {} });
    sendWs(sockA, { method: 'Page.frameNavigated', params: { frame: { id: 'TOP_MAIN_FRAME_page-a_v2' } } });
    const freshA = createWindowVm('page-a');
    stA.vmWin = freshA.vmWin;
    stA.vmCtx = freshA.vmCtx;
    stA.mainCtxId = 10;
    sendWs(sockA, {
      method: 'Runtime.executionContextCreated',
      params: { context: { id: 10, auxData: { frameId: 'TOP_MAIN_FRAME_page-a_v2', isDefault: true, type: 'default' } } },
    });
    for (const src of stA.scripts.values()) {
      try {
        vm.runInContext(src, stA.vmCtx);
      } catch {}
    }
    assert.ok(stA.vmWin.__agPrism, 'Expected NewDocument scripts to mount Prism cleanly after simulated reload');

    for (let k = 1; k <= 10; k++) {
      const patch =
        k === 10
          ? { palette: 'obsidian', accentTone: 'iris', motionLevel: 'off', omniModule: 'on' }
          : {
              palette: palettes[k % palettes.length],
              accentTone: accents[k % accents.length],
              motionLevel: motions[k % motions.length],
              omniModule: k % 2 === 0 ? 'on' : 'off',
            };
      stA.vmWin.__agPrism.saveSettingsBatch(patch);
    }
    await waitBroadcastDrain(daemon);

    const finalDiskCfg = JSON.parse(fs.readFileSync(path.join(targetPluginDir, 'config.json'), 'utf8'));
    assert.equal(finalDiskCfg.palette, 'obsidian');
    assert.equal(finalDiskCfg.accentTone, 'iris');
    assert.equal(finalDiskCfg.motionLevel, 'off');
    assert.equal(finalDiskCfg.omniModule, 'on');

    assert.equal(stA.vmWin.__agPrism.getState().cfg.palette, 'obsidian', 'Reloaded Window A must lock onto 10th update with 0 rebound');
    assert.equal(stA.vmWin.__agPrism.getState().cfg.accentTone, 'iris');
    assert.equal(stB.vmWin.__agPrism.getState().cfg.palette, 'obsidian', 'Window B must sync with reloaded Window A');
    assert.equal(stB.vmWin.__agPrism.getState().cfg.accentTone, 'iris');
    assert.ok(
      activeScripts.size <= 4,
      `HS-1: Active NewDocument script handles across 2 windows must never leak (got ${activeScripts.size})`
    );

    await daemon.stop(false);
    assert.equal(thoughtDisposed, 1, 'CP-C: PrismDaemon.stop() must dispose lazy services');
    daemon = null;
  } finally {
    if (daemon) await daemon.stop(false).catch(() => {});
    await installPluginTool.uninstallPlugin({ targetDir: targetPluginDir, noCdp: true }).catch(() => {});
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
