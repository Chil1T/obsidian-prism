import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  WALLPAPER_CONFIG_FILENAME,
  DEFAULT_WALLPAPER_CONFIG,
  MAX_BLOB_FALLBACK_BYTES,
  resolveWallpaperConfigPath,
  validateWallpaperMediaPath,
  verifyMediaMagicBytes,
  createWallpaperService,
} from '../vendor/wallpaper/wallpaper-service.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const cdp = require(path.join(ROOT, 'cdp.js'));
const wallpaperClientMod = require(path.join(ROOT, 'vendor', 'wallpaper', 'wallpaper-client.js'));
const wallpaperSettingsUiMod = require(path.join(ROOT, 'vendor', 'wallpaper', 'wallpaper-settings-ui.js'));
const settingsPanelMod = require(path.join(ROOT, 'settings-panel.js'));

const NO_TR_ATTRS = [
  ['translate', 'no'],
  ['data-no-translate', 'true'],
  ['data-ag-localization-skip', 'true'],
  ['data-agy-no-translate', 'true'],
  ['data-antigravity-zh-skip', '1'],
  ['data-ag-no-i18n', ''],
];

function mkTempDir(prefix = 'prism-wp-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeValidPngBuffer(extraBytes = 16) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, Buffer.alloc(extraBytes, 0x41)]);
}

function makeValidJpegBuffer() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
}

function makeValidGifBuffer() {
  return Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,', 'binary');
}

function makeValidWebpBuffer() {
  const b = Buffer.alloc(20, 0);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(12, 4);
  b.write('WEBP', 8, 'ascii');
  b.write('VP8 ', 12, 'ascii');
  return b;
}

function makeValidAvifBuffer() {
  const b = Buffer.alloc(24, 0);
  b.writeUInt32BE(24, 0);
  b.write('ftyp', 4, 'ascii');
  b.write('avif', 8, 'ascii');
  b.write('mif1', 16, 'ascii');
  b.write('avif', 20, 'ascii');
  return b;
}

function makeValidMp4Buffer(payloadLen = 128) {
  const head = Buffer.alloc(24, 0);
  head.writeUInt32BE(24, 0);
  head.write('ftyp', 4, 'ascii');
  head.write('isom', 8, 'ascii');
  head.writeUInt32BE(0x200, 12);
  head.write('isom', 16, 'ascii');
  head.write('mp41', 20, 'ascii');
  const body = Buffer.alloc(payloadLen);
  for (let i = 0; i < payloadLen; i++) body[i] = i & 0xff;
  return Buffer.concat([head, body]);
}

function makeValidWebmBuffer() {
  return Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01]);
}

function checkBalancedBraces(css) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '\\' && (inSingle || inDouble)) {
      i += 1;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && !inSingle && !inDouble;
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
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function createDomSandbox() {
  const docListeners = new Map();
  const winListeners = new Map();
  const observers = [];
  const createdUrls = [];
  const revokedUrls = [];
  let urlSeq = 1;
  let doc = null;

  function notifyObservers(target, attrName) {
    for (const obs of observers) {
      if (!obs.active || obs.target !== target) continue;
      if (Array.isArray(obs.filter) && !obs.filter.includes(attrName)) continue;
      obs.cb([{ type: 'attributes', target, attributeName: attrName }]);
    }
  }

  class MockMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.active = false;
      this.target = null;
      this.filter = null;
      observers.push(this);
    }
    observe(target, opts = {}) {
      this.active = true;
      this.target = target;
      this.filter = opts.attributeFilter || null;
    }
    disconnect() {
      this.active = false;
    }
  }

  function makeNode(tag, initAttrs = {}) {
    const attrs = new Map(Object.entries(initAttrs).map(([k, v]) => [k, String(v)]));
    const cls = new Set(String(initAttrs.class || '').split(/\s+/).filter(Boolean));
    const elListeners = new Map();
    const children = [];
    const styleProps = new Map();
    let _text = '';
    let _src = '';

    const node = {
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
      muted: false,
      loop: false,
      playsInline: false,
      paused: true,
      _playCalls: 0,
      _pauseCalls: 0,
      _loadCalls: 0,
      _ops: [],
      style: {
        display: '',
        setProperty(k, v) {
          styleProps.set(k, String(v));
          this[k] = String(v);
        },
        getPropertyValue(k) {
          return styleProps.get(k) || '';
        },
        removeProperty(k) {
          styleProps.delete(k);
          delete this[k];
        },
      },
      classList: {
        add(...cs) {
          for (const c of cs) if (c) cls.add(c);
          attrs.set('class', [...cls].join(' '));
        },
        remove(...cs) {
          for (const c of cs) cls.delete(c);
          attrs.set('class', [...cls].join(' '));
        },
        contains(c) {
          return cls.has(c);
        },
      },
      get id() {
        return attrs.get('id') || '';
      },
      set id(v) {
        if (v) attrs.set('id', String(v));
        else attrs.delete('id');
      },
      get className() {
        return [...cls].join(' ');
      },
      set className(v) {
        cls.clear();
        String(v || '')
          .split(/\s+/)
          .filter(Boolean)
          .forEach((c) => cls.add(c));
        if (cls.size) attrs.set('class', [...cls].join(' '));
        else attrs.delete('class');
      },
      get src() {
        return _src;
      },
      set src(v) {
        _src = String(v || '');
        if (_src) attrs.set('src', _src);
        node._ops.push(`src=${_src}`);
      },
      get isConnected() {
        let cur = this;
        while (cur.parentElement) cur = cur.parentElement;
        return cur === html;
      },
      get firstChild() {
        return children[0] || null;
      },
      get textContent() {
        return children.length && !_text ? children.map((c) => c.textContent).join('') : _text;
      },
      set textContent(v) {
        children.length = 0;
        _text = String(v ?? '');
      },
      setAttribute(k, v) {
        const key = String(k);
        const val = String(v);
        attrs.set(key, val);
        if (key === 'class') this.className = val;
        if (key === 'id') attrs.set('id', val);
        if (key === 'hidden') this.hidden = true;
        if (key === 'src') _src = val;
        notifyObservers(this, key);
      },
      getAttribute(k) {
        return attrs.has(String(k)) ? attrs.get(String(k)) : null;
      },
      hasAttribute(k) {
        return attrs.has(String(k));
      },
      removeAttribute(k) {
        const key = String(k);
        attrs.delete(key);
        if (key === 'hidden') this.hidden = false;
        if (key === 'src') {
          _src = '';
          this._ops.push('removeAttribute:src');
        }
        notifyObservers(this, key);
      },
      appendChild(ch) {
        if (ch.parentElement) ch.remove();
        ch.parentElement = this;
        ch.parentNode = this;
        ch.ownerDocument = doc;
        children.push(ch);
        return ch;
      },
      insertBefore(ch, ref) {
        if (ch.parentElement) ch.remove();
        ch.parentElement = this;
        ch.parentNode = this;
        ch.ownerDocument = doc;
        const idx = ref ? children.indexOf(ref) : -1;
        if (idx >= 0) children.splice(idx, 0, ch);
        else children.push(ch);
        return ch;
      },
      removeChild(ch) {
        const idx = children.indexOf(ch);
        if (idx >= 0) children.splice(idx, 1);
        ch.parentElement = null;
        ch.parentNode = null;
        return ch;
      },
      remove() {
        if (this.parentElement) this.parentElement.removeChild(this);
      },
      addEventListener(type, fn) {
        if (!elListeners.has(type)) elListeners.set(type, new Set());
        elListeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        elListeners.get(type)?.delete(fn);
      },
      dispatchEvent(ev) {
        const e = typeof ev === 'string' ? { type: ev } : { ...ev };
        e.target = this;
        e.preventDefault = e.preventDefault || (() => {});
        e.stopPropagation = e.stopPropagation || (() => {});
        for (const fn of [...(elListeners.get(e.type) || [])]) fn(e);
      },
      click() {
        this.dispatchEvent({ type: 'click' });
      },
      focus() {
        doc.activeElement = this;
      },
      play() {
        this.paused = false;
        this._playCalls += 1;
        this._ops.push('play');
        return Promise.resolve();
      },
      pause() {
        this.paused = true;
        this._pauseCalls += 1;
        this._ops.push('pause');
      },
      load() {
        this._loadCalls += 1;
        this._ops.push('load');
      },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (matchesSelector(cur, sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const ch of n.children) {
            if (matchesSelector(ch, sel)) out.push(ch);
            walk(ch);
          }
        };
        walk(this);
        return out;
      },
    };
    return node;
  }

  function matchSingleToken(el, token) {
    let rem = token.trim();
    if (!rem) return false;
    const tagM = /^[a-zA-Z0-9_-]+/.exec(rem);
    if (tagM) {
      if (el.tagName !== tagM[0].toUpperCase()) return false;
      rem = rem.slice(tagM[0].length);
    }
    while (rem.length > 0) {
      if (rem[0] === '#') {
        const m = /^#([a-zA-Z0-9_-]+)/.exec(rem);
        if (!m || el.id !== m[1]) return false;
        rem = rem.slice(m[0].length);
      } else if (rem[0] === '.') {
        const m = /^\.([a-zA-Z0-9_-]+)/.exec(rem);
        if (!m || !el.classList.contains(m[1])) return false;
        rem = rem.slice(m[0].length);
      } else if (rem[0] === '[') {
        const m = /^\[([^\]=]+)(?:="([^"]*)")?\]/.exec(rem);
        if (!m) return false;
        const ok = m[2] === undefined ? el.hasAttribute(m[1]) : el.getAttribute(m[1]) === m[2];
        if (!ok) return false;
        rem = rem.slice(m[0].length);
      } else {
        return false;
      }
    }
    return true;
  }

  function matchesSelector(el, selector) {
    return String(selector || '')
      .split(',')
      .some((part) => {
        const tokens = part.trim().split(/\s+/).filter(Boolean);
        if (!tokens.length) return false;
        if (!matchSingleToken(el, tokens[tokens.length - 1])) return false;
        let cur = el.parentElement;
        let idx = tokens.length - 2;
        while (cur && idx >= 0) {
          if (matchSingleToken(cur, tokens[idx])) idx -= 1;
          cur = cur.parentElement;
        }
        return idx < 0;
      });
  }

  const html = makeNode('html');
  const head = makeNode('head');
  const body = makeNode('body', { class: 'monaco-workbench' });
  html.appendChild(head);
  html.appendChild(body);

  doc = {
    readyState: 'complete',
    hidden: false,
    activeElement: null,
    documentElement: html,
    head,
    body,
    createElement: (t) => {
      const n = makeNode(t);
      n.ownerDocument = doc;
      return n;
    },
    getElementById: (id) => html.querySelector(`#${id}`),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener(t, fn) {
      if (!docListeners.has(t)) docListeners.set(t, new Set());
      docListeners.get(t).add(fn);
    },
    removeEventListener(t, fn) {
      docListeners.get(t)?.delete(fn);
    },
    dispatchEvent(ev) {
      const e = typeof ev === 'string' ? { type: ev } : ev;
      for (const fn of [...(docListeners.get(e.type) || [])]) fn(e);
    },
  };
  html.ownerDocument = doc;
  head.ownerDocument = doc;
  body.ownerDocument = doc;

  class MockBlob {
    constructor(parts, opts = {}) {
      this.parts = parts;
      this.type = opts.type || '';
    }
  }

  const mockURL = {
    createObjectURL(blob) {
      const u = `blob:obsidian-prism/${urlSeq++}`;
      createdUrls.push({ url: u, type: blob?.type || '' });
      return u;
    },
    revokeObjectURL(u) {
      revokedUrls.push(u);
    },
  };

  const sandbox = {
    window: null,
    globalThis: null,
    self: null,
    top: null,
    document: doc,
    location: { href: 'vscode-file://vscode-app/workbench.html' },
    MutationObserver: MockMutationObserver,
    Blob: MockBlob,
    URL: mockURL,
    Buffer,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    addEventListener(t, fn) {
      if (!winListeners.has(t)) winListeners.set(t, new Set());
      winListeners.get(t).add(fn);
    },
    removeEventListener(t, fn) {
      winListeners.get(t)?.delete(fn);
    },
    dispatchEvent(ev) {
      const e = typeof ev === 'string' ? { type: ev } : ev;
      for (const fn of [...(winListeners.get(e.type) || [])]) fn(e);
    },
    setTimeout,
    clearTimeout,
    Math,
    Date,
    JSON,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Promise,
    RegExp,
    Error,
    Uint8Array,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;

  return {
    sandbox,
    html,
    head,
    body,
    doc,
    makeNode,
    docListeners,
    winListeners,
    observers,
    createdUrls,
    revokedUrls,
  };
}

// ── 1. Security Path & Magic Bytes Validation ───────────────────────────────

test('wallpaper-service: blocks .svg, .html, scripts, UNC, NT device paths, sensitive dirs, symlinks, and spoofed magic bytes', () => {
  const tmpDir = mkTempDir('prism-wp-sec-');
  try {
    // 1) Disallowed extensions even when file exists
    const svgFile = path.join(tmpDir, 'xss.svg');
    const htmlFile = path.join(tmpDir, 'evil.html');
    const jsFile = path.join(tmpDir, 'payload.js');
    fs.writeFileSync(svgFile, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    fs.writeFileSync(htmlFile, '<html><script>alert(1)</script></html>');
    fs.writeFileSync(jsFile, 'alert(1)');

    assert.equal(validateWallpaperMediaPath(svgFile).code, 'unsupported-extension');
    assert.equal(validateWallpaperMediaPath(htmlFile).code, 'unsupported-extension');
    assert.equal(validateWallpaperMediaPath(jsFile).code, 'unsupported-extension');

    // 2) UNC / extended / NT device paths / URL schemes
    for (const bad of [
      '\\\\evil-server\\share\\wall.png',
      '//evil-server/share/wall.png',
      '\\\\?\\C:\\temp\\wall.png',
      '\\\\.\\PhysicalDrive0.png',
      'C:\\temp\\CON.png',
      'C:\\temp\\NUL.jpg',
      'file:///C:/temp/wall.png',
      'https://example.com/wall.png',
      'javascript:alert(1).png',
      'C:\\temp\\bad\x00.png',
    ]) {
      const r = validateWallpaperMediaPath(bad);
      assert.equal(r.ok, false, `Must reject dangerous path: ${bad}`);
    }

    // 3) Sensitive system and credential directories
    for (const sensitive of [
      path.join(tmpDir, '.ssh', 'id_rsa.png'),
      path.join(tmpDir, '.aws', 'credentials.png'),
      path.join(tmpDir, '.gemini', 'config', 'secret.png'),
      path.join(tmpDir, '.config', 'gcloud', 'adc.png'),
      'C:\\Windows\\Web\\Wallpaper\\img0.jpg',
      '/etc/passwd.png',
      '/proc/self/environ.png',
    ]) {
      const r = validateWallpaperMediaPath(sensitive);
      assert.equal(r.ok, false, `Must block sensitive path: ${sensitive}`);
      assert.equal(r.code, 'blocked-sensitive-path', `Expected blocked-sensitive-path for ${sensitive}, got ${r.code}`);
    }

    // 4) Symlink / junction escape blocking
    const validPng = path.join(tmpDir, 'valid.png');
    fs.writeFileSync(validPng, makeValidPngBuffer());
    const sensitiveSubDir = path.join(tmpDir, '.gemini');
    fs.mkdirSync(sensitiveSubDir, { recursive: true });
    const secretPng = path.join(sensitiveSubDir, 'token.png');
    fs.writeFileSync(secretPng, makeValidPngBuffer());

    // Directory junction/symlink escaping into .gemini must be caught by realpathSync
    const escapeLinkDir = path.join(tmpDir, 'innocent-dir');
    fs.symlinkSync(sensitiveSubDir, escapeLinkDir, process.platform === 'win32' ? 'junction' : 'dir');
    const escapedCheck = validateWallpaperMediaPath(path.join(escapeLinkDir, 'token.png'));
    assert.equal(escapedCheck.ok, false, 'Directory symlink escaping into .gemini must be rejected');
    assert.equal(escapedCheck.code, 'blocked-sensitive-path');

    // File symlink (when OS permits creating file symlinks)
    const fileLink = path.join(tmpDir, 'link.png');
    let createdFileLink = false;
    try {
      fs.symlinkSync(validPng, fileLink, 'file');
      createdFileLink = true;
    } catch {}
    if (createdFileLink) {
      const linkCheck = validateWallpaperMediaPath(fileLink);
      assert.equal(linkCheck.ok, false);
      assert.equal(linkCheck.code, 'symlink-not-allowed');
    }

    // 5) Spoofed magic bytes (HTML/SVG renamed to .png, PNG renamed to .mp4, AVIF renamed to .mp4)
    const spoofPng = path.join(tmpDir, 'spoof.png');
    fs.writeFileSync(spoofPng, '<svg>not a png</svg>');
    assert.equal(validateWallpaperMediaPath(spoofPng).code, 'invalid-magic-bytes');

    const spoofMp4 = path.join(tmpDir, 'spoof.mp4');
    fs.writeFileSync(spoofMp4, makeValidPngBuffer());
    assert.equal(validateWallpaperMediaPath(spoofMp4).code, 'invalid-magic-bytes');

    const avifAsMp4 = path.join(tmpDir, 'avif-as-mp4.mp4');
    fs.writeFileSync(avifAsMp4, makeValidAvifBuffer());
    assert.equal(validateWallpaperMediaPath(avifAsMp4).code, 'invalid-magic-bytes');

    // 6) All 8 allowed real media types pass with accurate mime/mediaType
    const samples = [
      ['a.jpg', makeValidJpegBuffer(), 'image', 'image/jpeg'],
      ['b.jpeg', makeValidJpegBuffer(), 'image', 'image/jpeg'],
      ['c.png', makeValidPngBuffer(), 'image', 'image/png'],
      ['d.webp', makeValidWebpBuffer(), 'image', 'image/webp'],
      ['e.gif', makeValidGifBuffer(), 'image', 'image/gif'],
      ['f.avif', makeValidAvifBuffer(), 'image', 'image/avif'],
      ['g.mp4', makeValidMp4Buffer(), 'video', 'video/mp4'],
      ['h.webm', makeValidWebmBuffer(), 'video', 'video/webm'],
    ];
    for (const [name, buf, expectedType, expectedMime] of samples) {
      const p = path.join(tmpDir, name);
      fs.writeFileSync(p, buf);
      const res = validateWallpaperMediaPath(p);
      assert.equal(res.ok, true, `Expected valid ${name} to pass, got ${res.code}: ${res.error}`);
      assert.equal(res.mediaType, expectedType);
      assert.equal(res.mimeType, expectedMime);
    }

    assert.equal(verifyMediaMagicBytes('.png', Buffer.from('not-png'), 7), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── 2. Config Persistence, Lazy 127.0.0.1 HTTP 206 Range Streaming & Security Headers ──

test('wallpaper-service: atomic config persistence, lazy 127.0.0.1 HTTP 206 Range streaming, token/CORS checks, and clean port release', async () => {
  const tmpDir = mkTempDir('prism-wp-http-');
  const cfgPath = path.join(tmpDir, WALLPAPER_CONFIG_FILENAME);
  const mp4Bytes = makeValidMp4Buffer(512);
  const mp4File = path.join(tmpDir, 'loop.mp4');
  fs.writeFileSync(mp4File, mp4Bytes);

  // Verify env override resolution
  const prevEnv = process.env.PRISM_WALLPAPER_CONFIG_PATH;
  process.env.PRISM_WALLPAPER_CONFIG_PATH = cfgPath;
  assert.equal(resolveWallpaperConfigPath(), path.resolve(cfgPath));
  if (prevEnv === undefined) delete process.env.PRISM_WALLPAPER_CONFIG_PATH;
  else process.env.PRISM_WALLPAPER_CONFIG_PATH = prevEnv;

  const svc = createWallpaperService({ configPath: cfgPath });
  try {
    // Initially disabled -> lazy server must NOT be started
    const initCfg = svc.getConfigSync();
    assert.equal(initCfg.version, 1);
    assert.equal(initCfg.enabled, false);
    assert.equal(initCfg.serverRunning, false);
    assert.equal(initCfg.mediaUrl, '');
    assert.equal(svc.isEnabledSync(), false);

    // Save config with out-of-range sliders -> clamped atomically + starts 127.0.0.1:0 server
    const saved = await svc.handleAction('save-config', {
      enabled: true,
      mediaPath: mp4File,
      opacity: 9.9,
      blurPx: 99,
      dimOverlay: -2,
      fit: 'contain',
      pauseOnBlur: false,
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.serverRunning, true);
    assert.equal(svc.isEnabledSync(), true);
    assert.equal(saved.config.opacity, 0.85);
    assert.equal(saved.config.blurPx, 24);
    assert.equal(saved.config.dimOverlay, 0);
    assert.equal(saved.config.fit, 'contain');
    assert.equal(saved.config.pauseOnBlur, false);
    assert.equal(saved.config.mediaType, 'video');
    assert.match(saved.config.mediaUrl, /^http:\/\/127\.0\.0\.1:\d+\/wallpaper\/[a-f0-9]{64}\/\d+$/);

    // Zero stray .tmp files after atomic write
    const filesInDir = fs.readdirSync(tmpDir);
    assert.equal(filesInDir.some((f) => f.endsWith('.tmp')), false);
    const persisted = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.equal(persisted.enabled, true);
    assert.equal(persisted.fit, 'contain');

    const mediaUrl = saved.config.mediaUrl;
    const parsedUrl = new URL(mediaUrl);

    // Full GET -> 200 + strict security headers (NO ACAO: *)
    const fullRes = await httpRequestRaw(mediaUrl);
    assert.equal(fullRes.statusCode, 200);
    assert.equal(fullRes.headers['content-type'], 'video/mp4');
    assert.match(String(fullRes.headers['cache-control']), /no-store/);
    assert.equal(fullRes.headers['x-content-type-options'], 'nosniff');
    assert.equal(fullRes.headers['accept-ranges'], 'bytes');
    assert.equal(fullRes.headers['access-control-allow-origin'], undefined);
    assert.deepEqual(fullRes.body, mp4Bytes);

    // Allowed local origin -> reflected explicitly (never *)
    const localOriginRes = await httpRequestRaw(mediaUrl, {
      method: 'HEAD',
      headers: { Origin: 'vscode-file://vscode-app' },
    });
    assert.equal(localOriginRes.statusCode, 200);
    assert.equal(localOriginRes.headers['access-control-allow-origin'], 'vscode-file://vscode-app');
    assert.notEqual(localOriginRes.headers['access-control-allow-origin'], '*');
    assert.equal(localOriginRes.body.length, 0);

    // Untrusted third-party Origin -> 403 Forbidden
    const evilOriginRes = await httpRequestRaw(mediaUrl, {
      headers: { Origin: 'https://evil.example.com' },
    });
    assert.equal(evilOriginRes.statusCode, 403);
    assert.equal(evilOriginRes.headers['access-control-allow-origin'], undefined);

    // HTTP 206 Range streaming (start-end, suffix, and invalid 416)
    const rangeRes = await httpRequestRaw(mediaUrl, { headers: { Range: 'bytes=10-49' } });
    assert.equal(rangeRes.statusCode, 206);
    assert.equal(rangeRes.headers['content-range'], `bytes 10-49/${mp4Bytes.length}`);
    assert.equal(Number(rangeRes.headers['content-length']), 40);
    assert.deepEqual(rangeRes.body, mp4Bytes.subarray(10, 50));

    const suffixRes = await httpRequestRaw(mediaUrl, { headers: { Range: 'bytes=-16' } });
    assert.equal(suffixRes.statusCode, 206);
    assert.equal(suffixRes.headers['content-range'], `bytes ${mp4Bytes.length - 16}-${mp4Bytes.length - 1}/${mp4Bytes.length}`);
    assert.deepEqual(suffixRes.body, mp4Bytes.subarray(mp4Bytes.length - 16));

    const badRangeRes = await httpRequestRaw(mediaUrl, { headers: { Range: 'bytes=999999-' } });
    assert.equal(badRangeRes.statusCode, 416);

    // Wrong token -> 403, wrong rev -> 403, wrong path -> 404, POST -> 405
    const wrongTokUrl = `http://127.0.0.1:${parsedUrl.port}/wallpaper/${'0'.repeat(64)}/1`;
    assert.equal((await httpRequestRaw(wrongTokUrl)).statusCode, 403);
    const wrongRevUrl = mediaUrl.replace(/\/\d+$/, '/999');
    assert.equal((await httpRequestRaw(wrongRevUrl)).statusCode, 403);
    assert.equal((await httpRequestRaw(`http://127.0.0.1:${parsedUrl.port}/other/path`)).statusCode, 404);
    assert.equal((await httpRequestRaw(`http://127.0.0.1:${parsedUrl.port}/wallpaper/../etc/passwd`)).statusCode, 404);
    assert.equal((await httpRequestRaw(mediaUrl, { method: 'POST' })).statusCode, 405);

    // Disabling immediately closes server & frees port
    const disabledRes = await svc.handleAction('save-config', { enabled: false });
    assert.equal(disabledRes.ok, true);
    assert.equal(disabledRes.serverRunning, false);
    await assert.rejects(() => httpRequestRaw(mediaUrl), /ECONNREFUSED|ECONNRESET|socket hang up/i);

    // Re-enable then dispose() releases port
    const reEnabled = await svc.handleAction('save-config', { enabled: true });
    assert.equal(reEnabled.serverRunning, true);
    const secondUrl = reEnabled.config.mediaUrl;
    await svc.dispose();
    await assert.rejects(() => httpRequestRaw(secondUrl), /ECONNREFUSED|ECONNRESET|socket hang up/i);
  } finally {
    await svc.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── 3. Blob Fallback Size Cap & Native Picker Parameterization ──────────────

test('wallpaper-service: get-media-blob supports <= 8 MB images, rejects > 8 MB images & videos, and pick-media uses safe parameterized execFile', async () => {
  const tmpDir = mkTempDir('prism-wp-blob-');
  const cfgPath = path.join(tmpDir, WALLPAPER_CONFIG_FILENAME);
  const smallPng = path.join(tmpDir, 'small.png');
  const hugePng = path.join(tmpDir, 'huge.png');
  const vidMp4 = path.join(tmpDir, 'clip.mp4');
  const badSvg = path.join(tmpDir, 'bad.svg');

  const smallBuf = makeValidPngBuffer(64);
  fs.writeFileSync(smallPng, smallBuf);
  fs.writeFileSync(hugePng, Buffer.concat([makeValidPngBuffer(0), Buffer.alloc(MAX_BLOB_FALLBACK_BYTES + 1024, 0x00)]));
  fs.writeFileSync(vidMp4, makeValidMp4Buffer(64));
  fs.writeFileSync(badSvg, '<svg/>');

  // Static security audit: zero shell execution in wallpaper-service.mjs
  const svcSource = fs.readFileSync(path.join(ROOT, 'vendor', 'wallpaper', 'wallpaper-service.mjs'), 'utf8');
  assert.equal(/(?<![.\w])execSync\s*\(|(?<![.\w])exec\s*\(|shell\s*:\s*true/.test(svcSource), false, 'Must never spawn a shell');
  assert.equal(/import\s*\{[^}]*\b(?:exec|execSync)\b[^}]*\}\s*from\s*['"]node:child_process['"]/.test(svcSource), false, 'Must only import execFile');

  const svc = createWallpaperService({ configPath: cfgPath });
  try {
    // <= 8 MB static image succeeds
    await svc.handleAction('save-config', { enabled: true, mediaPath: smallPng });
    const blobOk = await svc.handleAction('get-media-blob');
    assert.equal(blobOk.ok, true);
    assert.equal(blobOk.mimeType, 'image/png');
    assert.equal(blobOk.size, smallBuf.length);
    assert.deepEqual(Buffer.from(blobOk.base64, 'base64'), smallBuf);

    // > 8 MB static image rejected by cap
    await svc.handleAction('save-config', { enabled: true, mediaPath: hugePng });
    const blobTooBig = await svc.handleAction('get-media-blob');
    assert.equal(blobTooBig.ok, false);
    assert.equal(blobTooBig.code, 'blob-size-limit-exceeded');

    // Video rejected by Blob fallback (must use local stream)
    await svc.handleAction('save-config', { enabled: true, mediaPath: vidMp4 });
    const blobVid = await svc.handleAction('get-media-blob');
    assert.equal(blobVid.ok, false);
    assert.equal(blobVid.code, 'blob-image-only');

    // Clear media disables and empties config
    const cleared = await svc.handleAction('clear-media');
    assert.equal(cleared.ok, true);
    assert.equal(cleared.config.enabled, false);
    assert.equal(cleared.config.mediaPath, '');
    assert.equal(cleared.serverRunning, false);
  } finally {
    await svc.dispose();
  }

  // Native picker: Windows parameterized powershell.exe -EncodedCommand
  const winCalls = [];
  const winSvc = createWallpaperService({
    configPath: path.join(tmpDir, 'win.json'),
    platform: 'win32',
    execFileImpl(file, args, opts, cb) {
      winCalls.push({ file, args, opts });
      cb(null, `${smallPng}\r\n`, '');
    },
  });
  try {
    const picked = await winSvc.handleAction('pick-media');
    assert.equal(picked.ok, true);
    assert.equal(picked.config.enabled, true);
    assert.equal(picked.mediaType, 'image');
    assert.equal(winCalls.length, 1);
    assert.equal(winCalls[0].file, 'powershell.exe');
    assert.ok(winCalls[0].args.includes('-EncodedCommand'));
    assert.ok(winCalls[0].args.includes('-STA'));
  } finally {
    await winSvc.dispose();
  }

  // Native picker: Windows selecting disallowed .svg gets blocked by post-pick validation
  const winSvgSvc = createWallpaperService({
    configPath: path.join(tmpDir, 'winsvg.json'),
    platform: 'win32',
    execFileImpl(_file, _args, _opts, cb) {
      cb(null, badSvg, '');
    },
  });
  try {
    const pickedBad = await winSvgSvc.handleAction('pick-media');
    assert.equal(pickedBad.ok, false);
    assert.equal(pickedBad.code, 'unsupported-extension');
  } finally {
    await winSvgSvc.dispose();
  }

  // Native picker: macOS osascript cancel handling (-128)
  const macCalls = [];
  const macSvc = createWallpaperService({
    configPath: path.join(tmpDir, 'mac.json'),
    platform: 'darwin',
    execFileImpl(file, args, opts, cb) {
      macCalls.push({ file, args, opts });
      const err = new Error('User canceled (-128)');
      cb(err, '', 'execution error: User canceled. (-128)');
    },
  });
  try {
    const macRes = await macSvc.handleAction('pick-media');
    assert.equal(macRes.ok, true);
    assert.equal(macRes.canceled, true);
    assert.equal(macCalls[0].file, 'osascript');
  } finally {
    await macSvc.dispose();
  }

  // Native picker: Linux returns manual-input-required
  const linuxSvc = createWallpaperService({
    configPath: path.join(tmpDir, 'linux.json'),
    platform: 'linux',
  });
  try {
    const linuxRes = await linuxSvc.handleAction('pick-media');
    assert.equal(linuxRes.ok, false);
    assert.equal(linuxRes.manualRequired, true);
    assert.equal(linuxRes.code, 'manual-input-required');
  } finally {
    await linuxSvc.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── 4. Frontend Client Engine: Zero innerHTML, Browser Hole, 0fps Sleep, CSP Fallback & destroy() ──

test('wallpaper-client.js: 0 innerHTML, 0 :has(), balanced CSS, Browser Hole avoidance, 0fps video sleep, CSP Blob fallback, and full destroy()', async () => {
  const clientSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'wallpaper', 'wallpaper-client.js'), 'utf8');
  assert.equal(/\.innerHTML\s*=/.test(clientSrc), false, 'wallpaper-client.js must have 0 innerHTML assignments');
  assert.equal(wallpaperClientMod.WALLPAPER_CSS.includes(':has('), false, 'WALLPAPER_CSS must contain 0 :has()');
  assert.equal(checkBalancedBraces(wallpaperClientMod.WALLPAPER_CSS), true, 'WALLPAPER_CSS must have balanced braces');

  const env = createDomSandbox();
  const hostChild = env.makeNode('div', { class: 'agy-shell' });
  env.body.appendChild(hostChild);

  let blobCalls = 0;
  const smallPngB64 = makeValidPngBuffer(16).toString('base64');
  env.sandbox.__agPrismWallpaperCall = (rawJson) => {
    const req = JSON.parse(rawJson);
    if (req.action === 'get-media-blob') {
      blobCalls += 1;
      setTimeout(() => {
        env.sandbox.__agPrismWallpaperResolve(req.id, {
          ok: true,
          mimeType: 'image/png',
          size: 24,
          base64: smallPngB64,
          rev: req.payload?.rev || 1,
        });
      }, 0);
    }
  };

  const client = wallpaperClientMod.createWallpaperClient({ window: env.sandbox, document: env.doc });

  // Disabled state -> zero wallpaper root, zero html[data-ag-prism-wallpaper]
  assert.equal(env.doc.getElementById('ag-prism-wallpaper-root'), null);
  assert.equal(env.html.getAttribute('data-ag-prism-wallpaper'), null);

  // 1) Activate video wallpaper -> inserted beneath host content with 5+1 anti-translation attrs
  client.applyConfig({
    enabled: true,
    mediaPath: 'C:/wall/demo.mp4',
    mediaType: 'video',
    mediaUrl: 'http://127.0.0.1:45555/wallpaper/abc/1',
    opacity: 0.4,
    blurPx: 6,
    dimOverlay: 0.5,
    fit: 'cover',
    pauseOnBlur: true,
    rev: 1,
    serverRunning: true,
  });

  const wpRoot = env.doc.getElementById('ag-prism-wallpaper-root');
  assert.ok(wpRoot, 'Wallpaper root must be mounted when enabled');
  assert.equal(env.body.children[0], wpRoot, 'Wallpaper root must be first child at bottom of document.body');
  assert.equal(env.html.getAttribute('data-ag-prism-wallpaper'), 'on');
  for (const [k, v] of NO_TR_ATTRS) {
    assert.equal(wpRoot.getAttribute(k), v, `#ag-prism-wallpaper-root must stamp ${k}="${v}"`);
  }

  const videoEl = wpRoot.querySelector('video');
  assert.ok(videoEl, 'Must render <video> for video wallpaper');
  assert.equal(videoEl.muted, true);
  assert.equal(videoEl.loop, true);
  assert.equal(videoEl.playsInline, true);
  assert.equal(videoEl.getAttribute('preload'), 'metadata');
  assert.equal(videoEl.paused, false, 'Video should play while visible/focused/home/motion-on');

  // 2) 0fps sleep triggers: document.hidden, win-blur, chat mode, motion=off, browser hole
  env.doc.hidden = true;
  env.doc.dispatchEvent('visibilitychange');
  assert.equal(videoEl.paused, true, 'Video must pause on document.hidden');
  env.doc.hidden = false;
  env.doc.dispatchEvent('visibilitychange');
  assert.equal(videoEl.paused, false, 'Video must resume when document becomes visible');

  env.html.setAttribute('data-ag-cs-win-blur', '1');
  assert.equal(videoEl.paused, true, 'Video must pause on html[data-ag-cs-win-blur="1"]');
  env.html.removeAttribute('data-ag-cs-win-blur');
  assert.equal(videoEl.paused, false, 'Video must resume when win-blur clears');

  env.html.setAttribute('data-ag-prism-mode', 'chat');
  assert.equal(videoEl.paused, true, 'Video must pause in chat mode');
  env.html.setAttribute('data-ag-prism-mode', 'home');
  assert.equal(videoEl.paused, false, 'Video must resume leaving chat mode');

  env.html.setAttribute('data-ag-cs-motion', 'off');
  assert.equal(videoEl.paused, true, 'Video must pause on motion=off');
  env.html.setAttribute('data-ag-cs-motion', 'ultra');
  assert.equal(videoEl.paused, false, 'Video must resume when motion re-enabled');

  // 3) Browser Hole avoidance (main + drawer)
  env.body.setAttribute('data-has-browser-hole', 'true');
  assert.equal(wpRoot.hidden, true);
  assert.equal(env.html.getAttribute('data-ag-prism-wallpaper-hole'), '1');
  assert.equal(videoEl.paused, true, 'Video must pause during browser hole');
  env.body.removeAttribute('data-has-browser-hole');
  assert.equal(wpRoot.hidden, false);
  assert.equal(videoEl.paused, false);

  env.body.setAttribute('data-has-drawer-browser-hole', 'true');
  assert.equal(wpRoot.hidden, true);
  assert.equal(videoEl.paused, true);
  env.body.removeAttribute('data-has-drawer-browser-hole');
  assert.equal(wpRoot.hidden, false);

  // 4) Switch to static image -> old video must be properly released (pause -> removeAttribute('src') -> load)
  const prevVideoOps = videoEl._ops;
  client.applyConfig({
    enabled: true,
    mediaPath: 'C:/wall/photo.png',
    mediaType: 'image',
    mediaUrl: 'http://127.0.0.1:45555/wallpaper/def/2',
    rev: 2,
    serverRunning: true,
  });
  const pauseIdx = prevVideoOps.lastIndexOf('pause');
  const rmSrcIdx = prevVideoOps.lastIndexOf('removeAttribute:src');
  const loadIdx = prevVideoOps.lastIndexOf('load');
  assert.ok(pauseIdx >= 0 && rmSrcIdx > pauseIdx && loadIdx > rmSrcIdx, 'Video teardown must call pause -> removeAttribute(src) -> load');

  // 5) CSP <img> onerror triggers single get-media-blob -> Blob ObjectURL fallback
  const imgEl = wpRoot.querySelector('img');
  assert.ok(imgEl, 'Must render <img> for image wallpaper');
  imgEl.dispatchEvent('error');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(blobCalls, 1);
  assert.equal(env.createdUrls.length, 1);
  assert.equal(imgEl.src, env.createdUrls[0].url);
  assert.equal(client.getState().renderMode, 'blob-fallback');

  // 6) destroy() revokes ObjectURL, removes DOM + <style> + html attr + CSS vars + listeners
  client.destroy();
  assert.deepEqual(env.revokedUrls, [env.createdUrls[0].url], 'destroy() must revoke active ObjectURL');
  assert.equal(env.doc.getElementById('ag-prism-wallpaper-root'), null);
  assert.equal(env.doc.getElementById('ag-prism-wallpaper-css'), null);
  assert.equal(env.html.getAttribute('data-ag-prism-wallpaper'), null);
  assert.equal(env.html.style.getPropertyValue('--ag-prism-wp-opacity'), '');
  assert.equal(client.getDebugState().destroyed, true);
  assert.equal(env.observers.every((o) => !o.active), true, 'All MutationObservers must disconnect on destroy()');
  assert.equal(env.docListeners.get('visibilitychange')?.size || 0, 0);
  assert.equal(env.winListeners.get('blur')?.size || 0, 0);
  assert.equal(env.winListeners.get('focus')?.size || 0, 0);
});

// ── 5. Five-Locale Settings UI & settings-panel.js Minimal Slot Integration ──

test('wallpaper-settings-ui.js: 0 innerHTML, 5 locales, 5+1 anti-translation, and settings-panel.js appearance slot wiring', async () => {
  const uiSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'wallpaper', 'wallpaper-settings-ui.js'), 'utf8');
  assert.equal(/\.innerHTML\s*=/.test(uiSrc), false, 'wallpaper-settings-ui.js must have 0 innerHTML assignments');

  // Verify 5 locale packs exist and have distinct titles
  const locales = ['zh-CN', 'zh-TW', 'yue', 'en', 'ja'];
  const titles = new Set();
  for (const loc of locales) {
    const pack = wallpaperSettingsUiMod.WALLPAPER_I18N[loc];
    assert.ok(pack, `Locale pack ${loc} must exist`);
    assert.ok(pack.title && pack.pickBtn && pack.opacityLabel && pack.errUnsupportedExt);
    titles.add(pack.title);
  }
  assert.equal(titles.size, 5, 'All 5 locales must provide distinct localized titles');

  const env = createDomSandbox();
  const rpcLog = [];
  env.sandbox.__agPrismWallpaperCall = (raw) => {
    const req = JSON.parse(raw);
    rpcLog.push(req);
    const resp =
      req.action === 'pick-media'
        ? { ok: false, manualRequired: true, code: 'manual-input-required' }
        : req.action === 'clear-media'
        ? { ok: true, config: { ...DEFAULT_WALLPAPER_CONFIG, enabled: false, mediaPath: '' } }
        : {
            ok: true,
            config: {
              ...DEFAULT_WALLPAPER_CONFIG,
              ...req.payload,
              enabled: req.payload?.enabled ?? true,
              mediaPath: req.payload?.mediaPath ?? '/tmp/demo.png',
              mediaType: 'image',
              mediaUrl: 'http://127.0.0.1:41234/wallpaper/aa/1',
              rev: 1,
            },
          };
    setTimeout(() => env.sandbox.__agPrismWallpaperResolve(req.id, resp), 0);
  };

  const client = wallpaperClientMod.createWallpaperClient({ window: env.sandbox, document: env.doc });
  env.sandbox.__agPrismWallpaper = client;
  env.sandbox.__prismMountWallpaperUi = wallpaperSettingsUiMod.mountWallpaperUi;

  // Mount slot and test all 5 locales + interactions
  const slot = env.makeNode('div', { 'data-testid': 'prism-wallpaper-slot' });
  env.body.appendChild(slot);
  const handle = wallpaperSettingsUiMod.mountWallpaperUi(slot, {
    window: env.sandbox,
    document: env.doc,
    lang: 'zh-CN',
  });
  assert.ok(handle && handle.root);
  for (const [k, v] of NO_TR_ATTRS) {
    assert.equal(handle.root.getAttribute(k), v, `Wallpaper settings card must stamp ${k}="${v}"`);
  }

  for (const loc of locales) {
    handle.updateLang(loc);
    assert.equal(handle.root.getAttribute('data-ag-cs-lang'), loc);
    assert.equal(handle.root.querySelector('.ag-prism-wp-title').textContent, wallpaperSettingsUiMod.WALLPAPER_I18N[loc].title);
  }

  // Click pick button -> Linux manual input hint shown
  handle.updateLang('en');
  handle.root.querySelector('[data-testid="prism-wp-pick-btn"]').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(
    handle.root.querySelector('[data-testid="prism-wp-status"]').textContent,
    wallpaperSettingsUiMod.WALLPAPER_I18N.en.stManualLinux
  );

  // Slider preview + change persists via save-config
  const blurSlider = handle.root.querySelector('[data-testid="prism-wp-blur"]');
  blurSlider.value = '12';
  blurSlider.dispatchEvent('input');
  blurSlider.dispatchEvent('change');
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(rpcLog.some((r) => r.action === 'save-config' && r.payload.blurPx === 12));

  // Verify settings-panel.js mounts the slot inside Appearance group and invokes W.__prismMountWallpaperUi (including on lang switch)
  const dlg = env.makeNode('div', { role: 'dialog' });
  const panel = env.makeNode('div', { class: 'p-6 flex flex-col gap-4' });
  const h2 = env.makeNode('h2');
  h2.textContent = 'Appearance';
  const wrap = env.makeNode('div', { class: 'flex flex-col gap-8' });
  const anchorSec = env.makeNode('div', { class: 'space-y-2' });
  wrap.appendChild(anchorSec);
  panel.appendChild(h2);
  panel.appendChild(wrap);
  dlg.appendChild(panel);
  env.body.appendChild(dlg);

  let mountCalls = 0;
  let capturedSlot = null;
  let lastMountLang = '';
  let activeLang = 'en';
  globalThis.__prismMountWallpaperUi = (slotEl, ctx) => {
    mountCalls += 1;
    capturedSlot = slotEl;
    lastMountLang = ctx?.lang || '';
    return wallpaperSettingsUiMod.mountWallpaperUi(slotEl, { ...ctx, window: env.sandbox, document: env.doc });
  };
  try {
    const origDoc = globalThis.document;
    globalThis.document = env.doc;
    const mountPanel = () =>
      settingsPanelMod.mountOrSyncSettingsSection({
        version: '1.0.7-beta.1',
        lazyFold: false,
        getLang: () => activeLang,
        uiText: () => ({ grpAppearance: 'Appearance', sectionTitle: 'Obsidian Prism' }),
        isZh: () => activeLang.startsWith('zh'),
        resolveSettingRowActiveValue: (k) => cdp.DEFAULT_CONFIG[k],
        isSettingButtonMatch: (_k, vj, cur) => vj === JSON.stringify(cur),
        saveSetting: () => {},
        saveSettingsBatch: () => {},
        formatSettingsSummary: () => 'Obsidian',
        getThoughtTranslateMode: () => 'off',
        runGuardedMut: (fn) => fn(),
      });
    try {
      mountPanel();
      assert.ok(mountCalls >= 1, 'settings-panel.js must invoke __prismMountWallpaperUi');
      assert.ok(capturedSlot, 'settings-panel.js must pass [data-testid="prism-wallpaper-slot"]');
      assert.equal(capturedSlot.getAttribute('data-testid'), 'prism-wallpaper-slot');
      assert.ok(capturedSlot.closest('[data-ag-cs-group="appearance"]'), 'Slot must live inside Appearance group');
      assert.equal(lastMountLang, 'en');

      // Switch language en -> ja and verify wallpaper UI remounts/syncs with ja locale
      activeLang = 'ja';
      mountPanel();
      assert.equal(lastMountLang, 'ja');
      assert.equal(
        capturedSlot.querySelector('.ag-prism-wp-title').textContent,
        wallpaperSettingsUiMod.WALLPAPER_I18N.ja.title
      );
    } finally {
      globalThis.document = origDoc;
    }
  } finally {
    delete globalThis.__prismMountWallpaperUi;
    client.destroy();
  }
});

// ── 6. cdp.js Channel 7 Compilation, Isolation from RUNTIME_PARTS, Disk Cache & Removal ──

test('cdp.js Channel 7: WALLPAPER_BINDING, 0 in RUNTIME_PARTS, vm.Script parse, idempotent mount, disk cache hit, and full removal', () => {
  assert.equal(cdp.WALLPAPER_BINDING, '__agPrismWallpaperCall');
  assert.equal(
    cdp.RUNTIME_PARTS.some((p) => p.includes('wallpaper')),
    false,
    'vendor/wallpaper/* must NEVER enter Channel 1 RUNTIME_PARTS'
  );

  const expr = cdp.buildWallpaperExpression(cdp.DEFAULT_CONFIG);
  assert.ok(expr.length > 1000, 'Channel 7 expression must compile non-empty');
  assert.doesNotThrow(() => new vm.Script(expr));
  assert.doesNotThrow(() => new vm.Script(cdp.WALLPAPER_REMOVE_EXPRESSION));
  assert.doesNotThrow(() => new vm.Script(cdp.REMOVE_EXPRESSION));

  // Verify REMOVE_EXPRESSION cleans wallpaper artifacts
  for (const token of ['#ag-prism-wallpaper-root', '#ag-prism-wallpaper-css', 'data-ag-prism-wallpaper', '__agPrismWallpaper']) {
    assert.ok(cdp.REMOVE_EXPRESSION.includes(token), `REMOVE_EXPRESSION must clean ${token}`);
  }

  // Sandbox mount + idempotent reuse + WALLPAPER_REMOVE_EXPRESSION cleanup
  const env = createDomSandbox();
  const r1 = vm.runInNewContext(expr, env.sandbox);
  assert.equal(r1.ok, true);
  assert.equal(r1.status, 'mounted');
  assert.equal(typeof env.sandbox.__agPrismWallpaper, 'object');
  assert.equal(typeof env.sandbox.__prismMountWallpaperUi, 'function');
  assert.equal(typeof env.sandbox.__agPrismWallpaperResolve, 'function');
  assert.equal(typeof env.sandbox.__agPrismWallpaperBridge?.resolve, 'function');

  const r2 = vm.runInNewContext(expr, env.sandbox);
  assert.equal(r2.ok, true);
  assert.equal(r2.reused, true);

  // Verify minified Channel 7 __prismMountWallpaperUi renders cleanly across locales
  const packedSlot = env.makeNode('div', { 'data-testid': 'prism-wallpaper-slot' });
  env.body.appendChild(packedSlot);
  const packedUiHandle = env.sandbox.__prismMountWallpaperUi(packedSlot, { lang: 'zh-CN' });
  assert.ok(packedUiHandle && packedUiHandle.root);
  assert.equal(packedSlot.querySelector('.ag-prism-wp-title').textContent, wallpaperSettingsUiMod.WALLPAPER_I18N['zh-CN'].title);
  packedUiHandle.updateLang('ja');
  assert.equal(packedSlot.querySelector('.ag-prism-wp-title').textContent, wallpaperSettingsUiMod.WALLPAPER_I18N.ja.title);

  // Activate a video then run WALLPAPER_REMOVE_EXPRESSION
  env.sandbox.__agPrismWallpaper.applyConfig({
    enabled: true,
    mediaPath: 'C:/wall/v.mp4',
    mediaType: 'video',
    mediaUrl: 'http://127.0.0.1:49999/wallpaper/aa/1',
    rev: 1,
    serverRunning: true,
  });
  const vid = env.doc.querySelector('#ag-prism-wallpaper-root video');
  assert.ok(vid);

  const rmRes = vm.runInNewContext(cdp.WALLPAPER_REMOVE_EXPRESSION, env.sandbox);
  assert.equal(rmRes.ok, true);
  assert.equal(vid._pauseCalls >= 1, true);
  assert.equal(vid._loadCalls >= 1, true);
  assert.equal(env.doc.getElementById('ag-prism-wallpaper-root'), null);
  assert.equal(env.doc.getElementById('ag-prism-wallpaper-css'), null);
  assert.equal(env.html.getAttribute('data-ag-prism-wallpaper'), null);
  assert.equal(env.sandbox.__agPrismWallpaper, undefined);
  assert.equal(env.sandbox.__prismMountWallpaperUi, undefined);

  // Disk cache round-trip in isolated tmp dir (zero repo .bundle-cache.json leftover)
  const cacheDir = mkTempDir('prism-wp-cache-');
  const cachePath = path.join(cacheDir, '.bundle-cache.json');
  try {
    cdp.resetBundleCacheStats();
    const cold = cdp.buildWallpaperExpression(cdp.DEFAULT_CONFIG, { cachePath });
    assert.equal(fs.existsSync(cachePath), true);
    const cacheJson = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.ok(cacheJson.channels && cacheJson.channels.wallpaper, 'Wallpaper channel must be stored in disk cache');

    // Clear in-memory cache via fresh require and verify disk cache hit
    const resolvedCdp = require.resolve(path.join(ROOT, 'cdp.js'));
    delete require.cache[resolvedCdp];
    const freshCdp = require(resolvedCdp);
    const hit = freshCdp.buildWallpaperExpression(freshCdp.DEFAULT_CONFIG, { cachePath });
    assert.equal(hit, cold, 'Disk cache hit must be byte-identical to cold compile');
    assert.equal(freshCdp.getBundleCacheStats().channelHitsByName.wallpaper, 1);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
