import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  DEFAULT_WALLPAPER_CONFIG,
  createWallpaperService,
} from '../vendor/wallpaper/wallpaper-service.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const wallpaperClientMod = require(path.join(ROOT, 'vendor', 'wallpaper', 'wallpaper-client.js'));
const wallpaperSettingsUiMod = require(path.join(ROOT, 'vendor', 'wallpaper', 'wallpaper-settings-ui.js'));

const CANONICAL_9_LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'tr'];
const NON_CJK_LOCALES = ['en', 'ko', 'es', 'fr', 'de', 'tr'];
const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;

function makeValidMp4Buffer(payloadLen = 256) {
  const head = Buffer.alloc(24, 0);
  head.writeUInt32BE(24, 0);
  head.write('ftyp', 4, 'ascii');
  head.write('isom', 8, 'ascii');
  head.writeUInt32BE(0x200, 12);
  head.write('isom', 16, 'ascii');
  head.write('mp41', 20, 'ascii');
  const body = Buffer.alloc(payloadLen);
  for (let i = 0; i < payloadLen; i++) body[i] = (i * 7) & 0xff;
  return Buffer.concat([head, body]);
}

function makeValidPngBuffer(extraBytes = 32) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, Buffer.alloc(extraBytes, 0x5a)]);
}

function httpRequestRaw(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: opts.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function createMiniDom() {
  const mk = (tag, init = {}) => {
    const attrs = new Map(Object.entries(init).map(([k, v]) => [k, String(v)]));
    const listeners = new Map();
    const styles = new Map();
    const children = [];
    let text = '';
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      ownerDocument: null,
      parentElement: null,
      parentNode: null,
      children,
      childNodes: children,
      hidden: false,
      disabled: false,
      value: '',
      className: init.class || '',
      style: {
        display: '',
        setProperty(k, v) { styles.set(k, String(v)); this[k] = String(v); },
        getPropertyValue(k) { return styles.get(k) || ''; },
        removeProperty(k) { styles.delete(k); delete this[k]; },
      },
      get id() { return attrs.get('id') || ''; },
      set id(v) { if (v) attrs.set('id', String(v)); else attrs.delete('id'); },
      get firstChild() { return children[0] || null; },
      get isConnected() { let c = this; while (c.parentElement) c = c.parentElement; return c === html; },
      get textContent() { return children.length && !text ? children.map((c) => c.textContent).join('') : text; },
      set textContent(v) { children.length = 0; text = String(v ?? ''); },
      setAttribute(k, v) { attrs.set(k, String(v)); if (k === 'class') this.className = String(v); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(c) { if (c.parentElement) c.remove(); c.parentElement = c.parentNode = this; c.ownerDocument = doc; children.push(c); return c; },
      insertBefore(c, ref) { if (c.parentElement) c.remove(); c.parentElement = c.parentNode = this; c.ownerDocument = doc; const i = ref ? children.indexOf(ref) : -1; if (i >= 0) children.splice(i, 0, c); else children.push(c); return c; },
      removeChild(c) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); c.parentElement = c.parentNode = null; return c; },
      remove() { if (this.parentElement) this.parentElement.removeChild(this); },
      addEventListener(t, f) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); },
      removeEventListener(t, f) { listeners.get(t)?.delete(f); },
      dispatchEvent(ev) { const e = typeof ev === 'string' ? { type: ev } : { ...ev }; e.target = this; for (const f of [...(listeners.get(e.type) || [])]) f(e); },
      querySelector(sel) {
        const walk = (n) => {
          for (const ch of n.children) {
            if (sel.startsWith('[data-testid="') && ch.getAttribute('data-testid') === sel.slice(14, -2)) return ch;
            if (sel.startsWith('.') && String(ch.className || '').split(/\s+/).includes(sel.slice(1))) return ch;
            const r = walk(ch);
            if (r) return r;
          }
          return null;
        };
        return walk(this);
      },
      querySelectorAll() { return []; },
    };
    return el;
  };
  const html = mk('html', { 'data-ag-cs-theme': 'dark' });
  const head = mk('head');
  const body = mk('body');
  const doc = {
    documentElement: html,
    head,
    body,
    hidden: false,
    activeElement: null,
    createElement: (t) => mk(t),
    getElementById: (id) => {
      const walk = (n) => { if (n.id === id) return n; for (const c of n.children) { const r = walk(c); if (r) return r; } return null; };
      return walk(html);
    },
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  html.appendChild(head);
  html.appendChild(body);
  const win = { document: doc, navigator: { language: 'zh-CN' }, addEventListener() {}, removeEventListener() {} };
  return { win, doc, html, body, mk };
}

test('Wallpaper HTTP server allows no-cors video/image cross-site & loopback HTTPS origins while preserving Host, Origin, fetch-site and 256-bit token guards', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-wp-sec-'));
  const mp4Buf = makeValidMp4Buffer(256);
  const mp4Path = path.join(tmpDir, 'loop.mp4');
  const pngPath = path.join(tmpDir, 'bg.png');
  fs.writeFileSync(mp4Path, mp4Buf);
  fs.writeFileSync(pngPath, makeValidPngBuffer(32));

  const svc = createWallpaperService({ configPath: path.join(tmpDir, 'wp.json') });
  try {
    const saved = await svc.handleAction('save-config', { enabled: true, mediaPath: mp4Path });
    assert.equal(saved.ok, true);
    const url = saved.config.mediaUrl;
    assert.ok(url.startsWith('http://127.0.0.1:'));

    // 1) Chromium <video> no-cors request: Sec-Fetch-Site: cross-site + Sec-Fetch-Dest: video (no Origin) + Range -> 206 Partial Content
    const rVideoRange = await httpRequestRaw(url, {
      headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'video', Range: 'bytes=0-63' },
    });
    assert.equal(rVideoRange.statusCode, 206, 'no-cors <video> Range request must return 206 Partial Content');
    assert.equal(rVideoRange.headers['content-type'], 'video/mp4');
    assert.equal(rVideoRange.headers['content-range'], `bytes 0-63/${mp4Buf.length}`);
    assert.deepEqual(rVideoRange.body, mp4Buf.subarray(0, 64));

    // 2) Electron / host HTTPS loopback Origin (schemeful cross-site) -> 200 + exact ACAO (never *)
    const rLoopbackHttps = await httpRequestRaw(url, {
      headers: { Origin: 'https://127.0.0.1:8798', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'video' },
    });
    assert.equal(rLoopbackHttps.statusCode, 200);
    assert.equal(rLoopbackHttps.headers['access-control-allow-origin'], 'https://127.0.0.1:8798');

    const rLocalhost = await httpRequestRaw(url, {
      headers: { Origin: 'http://localhost:5173', 'Sec-Fetch-Site': 'cross-site' },
    });
    assert.equal(rLocalhost.statusCode, 200);
    assert.equal(rLocalhost.headers['access-control-allow-origin'], 'http://localhost:5173');

    // 3) Security invariants MUST hold:
    // 3a) External untrusted Origin even with Sec-Fetch-Dest: video -> 403 Forbidden origin
    const rEvilOrigin = await httpRequestRaw(url, {
      headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'video' },
    });
    assert.equal(rEvilOrigin.statusCode, 403, 'Untrusted external Origin must be blocked even with Sec-Fetch-Dest: video');

    // 3b) Origin: null -> 403
    const rNullOrigin = await httpRequestRaw(url, {
      headers: { Origin: 'null', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'video' },
    });
    assert.equal(rNullOrigin.statusCode, 403);

    // 3c) cross-site non-media fetch (empty/document/missing dest) without trusted Origin -> 403
    for (const dest of ['', 'empty', 'document', 'script']) {
      const hdrs = { 'Sec-Fetch-Site': 'cross-site' };
      if (dest) hdrs['Sec-Fetch-Dest'] = dest;
      const rNonMedia = await httpRequestRaw(url, { headers: hdrs });
      assert.equal(rNonMedia.statusCode, 403, `cross-site non-media dest="${dest}" without Origin must return 403`);
    }

    // 3d) Invalid token with valid Sec-Fetch-Dest: video -> 403 Forbidden
    const badTokenUrl = url.replace(/\/wallpaper\/[a-f0-9]+\//, `/wallpaper/${'0'.repeat(64)}/`);
    const rBadToken = await httpRequestRaw(badTokenUrl, {
      headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'video' },
    });
    assert.equal(rBadToken.statusCode, 403, 'Wrong 256-bit token must always return 403');

    // 3e) Host header mismatch (DNS rebinding) -> 403 Forbidden host
    const rBadHost = await httpRequestRaw(url, {
      headers: { Host: 'evil.example:80', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'video' },
    });
    assert.equal(rBadHost.statusCode, 403, 'Host header mismatch must return 403');

    // 4) Static image no-cors cross-site with Sec-Fetch-Dest: image -> 200
    const savedImg = await svc.handleAction('save-config', { enabled: true, mediaPath: pngPath });
    assert.equal(savedImg.ok, true);
    const rImg = await httpRequestRaw(savedImg.config.mediaUrl, {
      headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'image' },
    });
    assert.equal(rImg.statusCode, 200);
    assert.equal(rImg.headers['content-type'], 'image/png');
  } finally {
    await svc.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Wallpaper conversation scrim (convOverlay): default preserves 52%/66% theme fallbacks, supports 0% transparent, 0 html.style writes, and 9-locale UI', async () => {
  assert.equal(DEFAULT_WALLPAPER_CONFIG.convOverlay, null, 'Default convOverlay must be null to preserve legacy 52%/66% theme fallbacks');

  // 1) Service persistence: legacy config without convOverlay -> null; explicit 0 preserved (not coerced to fallback); clamping 0..1; null reset
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-wp-scrim-'));
  const cfgPath = path.join(tmpDir, 'wp.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ version: 1, enabled: false, opacity: 0.3, blurPx: 4, dimOverlay: 0.45, fit: 'cover' }), 'utf8');
  const svc = createWallpaperService({ configPath: cfgPath });
  try {
    assert.equal(svc.getConfigSync().convOverlay, null);

    const rZero = await svc.handleAction('save-config', { convOverlay: 0 });
    assert.equal(rZero.ok, true);
    assert.equal(rZero.config.convOverlay, 0, 'convOverlay: 0 must be persisted as numeric 0');

    const rMid = await svc.handleAction('save-config', { convOverlay: 0.25 });
    assert.equal(rMid.config.convOverlay, 0.25);

    const rOver = await svc.handleAction('save-config', { convOverlay: 1.8 });
    assert.equal(rOver.config.convOverlay, 1);

    const rUnder = await svc.handleAction('save-config', { convOverlay: -0.5 });
    assert.equal(rUnder.config.convOverlay, 0);

    const rReset = await svc.handleAction('save-config', { convOverlay: null });
    assert.equal(rReset.config.convOverlay, null);
  } finally {
    await svc.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 2) Client CSS & runtime variable sinking (0 html.style writes, clean unset when null, exact 0% when 0)
  const css = wallpaperClientMod.WALLPAPER_CSS;
  assert.equal(/[^\x00-\x7f]/.test(css), false, 'WALLPAPER_CSS must stay pure ASCII');
  assert.equal(css.includes(':has('), false, 'WALLPAPER_CSS must stay 0 :has(');
  assert.equal(/@property\s+--ag-prism-wp-conv-scrim\b/.test(css), false, 'Do not register @property on --ag-prism-wp-conv-scrim so dark 52%/light 66% fallbacks both work');
  assert.ok(css.includes('var(--ag-prism-wp-conv-scrim,52%)'));
  assert.ok(css.includes('var(--ag-prism-wp-conv-scrim,66%)'));

  const env = createMiniDom();
  const client = wallpaperClientMod.createWallpaperClient({ window: env.win, document: env.doc });
  client.applyConfig({
    enabled: true,
    mediaPath: 'C:/wp.png',
    mediaType: 'image',
    mediaUrl: 'http://127.0.0.1:45555/wallpaper/aa/1',
    opacity: 0.35,
    blurPx: 4,
    dimOverlay: 0.45,
    convOverlay: null,
    fit: 'cover',
    rev: 1,
  });
  assert.equal(env.html.style.getPropertyValue('--ag-prism-wp-conv-scrim'), '', 'Must NEVER write --ag-prism-wp-conv-scrim onto html.style');
  assert.equal(env.body.style.getPropertyValue('--ag-prism-wp-conv-scrim'), '', 'Default null convOverlay must leave --ag-prism-wp-conv-scrim unset so CSS defaults 52%/66% apply');

  client.previewVisualVars({ convOverlay: 0 });
  assert.equal(env.body.style.getPropertyValue('--ag-prism-wp-conv-scrim'), '0%', 'Setting convOverlay=0 must set --ag-prism-wp-conv-scrim to 0%');
  assert.equal(env.html.style.getPropertyValue('--ag-prism-wp-conv-scrim'), '');

  client.applyConfig({ enabled: true, mediaPath: 'C:/wp.png', mediaType: 'image', mediaUrl: 'http://127.0.0.1:45555/wallpaper/aa/1', convOverlay: 0.18, rev: 1 });
  assert.equal(env.body.style.getPropertyValue('--ag-prism-wp-conv-scrim'), '18%');

  // 3) Settings UI 9-locale completeness (0 CJK in non-CJK locales) + slider interaction to 0%
  for (const loc of CANONICAL_9_LOCALES) {
    const pack = wallpaperSettingsUiMod.WALLPAPER_I18N[loc];
    assert.ok(pack && typeof pack.convOverlayLabel === 'string' && pack.convOverlayLabel.length > 0, `Missing convOverlayLabel in locale ${loc}`);
    if (NON_CJK_LOCALES.includes(loc)) {
      assert.equal(CJK_RE.test(pack.convOverlayLabel), false, `Non-CJK locale ${loc} convOverlayLabel must have 0 CJK: ${pack.convOverlayLabel}`);
    }
  }

  const savedPatches = [];
  env.win.__agPrismWallpaper = client;
  env.win.__agPrismWallpaperCall = (raw) => {
    const req = JSON.parse(raw);
    if (req.action === 'save-config') savedPatches.push(req.payload);
    setTimeout(() => {
      env.win.__agPrismWallpaperResolve(req.id, {
        ok: true,
        config: { ...client.getState(), ...(req.payload || {}) },
      });
    }, 0);
  };
  const slot = env.mk('div', { 'data-testid': 'prism-wallpaper-slot' });
  env.body.appendChild(slot);
  const ui = wallpaperSettingsUiMod.mountWallpaperUi(slot, { window: env.win, document: env.doc, lang: 'zh-CN' });
  const slider = ui.root.querySelector('[data-testid="prism-wp-conv-overlay"]');
  assert.ok(slider, 'Wallpaper settings UI must render prism-wp-conv-overlay slider');
  assert.equal(slider.min, '0');
  assert.equal(slider.max, '1');
  slider.value = '0';
  slider.dispatchEvent('input');
  assert.equal(env.body.style.getPropertyValue('--ag-prism-wp-conv-scrim'), '0%', 'Dragging slider to 0 must preview 0% immediately');
  slider.dispatchEvent('change');
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(savedPatches.some((p) => p.convOverlay === 0), 'Releasing slider at 0 must persist convOverlay: 0');

  ui.destroy();
  client.destroy();
  assert.equal(env.body.style.getPropertyValue('--ag-prism-wp-conv-scrim'), '', 'destroy() must remove --ag-prism-wp-conv-scrim from body.style');
});
