// Chrome DevTools Protocol (CDP) & zero-dependency bundle compiler for Obsidian Prism (obsidian-prism).
// Node >= 22: uses built-in fetch and WebSocket (zero external dependencies).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const STYLE_ID = 'ag-prism-css';
const LEGACY_STYLE_ID = 'ag-claude-style-css';
const PLUGIN_VERSION = '1.0.1';
const SETTING_BINDING = '__agPrismSetting';
const LEGACY_SETTING_BINDING = '__agClaudeStyleSetting';
const OMNI_BINDING = '__agPrismOmniCall';
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

const APP_DATA = IS_MAC
  ? path.join(os.homedir(), 'Library', 'Application Support')
  : IS_WIN
  ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');

const PORT_FILE = path.join(APP_DATA, 'Antigravity', 'DevToolsActivePort');
const PID_FILE = path.join(__dirname, '.watch.pid');
const CONFIG_FILE = path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  language: 'zh-CN',
  lang: 'zh-CN',
  palette: 'obsidian',
  lightPreset: 'crystal',
  motionLevel: 'ultra',
  targetFps: '180',
  telemetryModule: 'auto',
  effortSliderModule: 'auto',
  thoughtTranslate: 'off',
  thoughtTrigger: 'preload',
  homeLayout: 'studio',
  homeMode: 'studio',
  homeRipple: true,
  ripple: 'on',
  composerRestyle: true,
  composer: 'on',
  placeholderStyle: 'studio',
  promptStyle: 'studio',
  mascot: 'crab',
  logoInk: 'accent',
  sidebarRestyle: true,
  sidebar: 'on',
  sidebarCompact: false,
  smoothCaret: true,
  accentTone: 'follow',
  cornerStyle: 'balanced',
  codeFont: 'default',
  codeLigatures: false,
  ambientIntensity: '100',
  thoughtView: 'immersive',
  omniModule: 'on',
  linkTarget: 'builtin',
  pollIntervalMs: 2500,
};

const VALIDATORS = {
  language: ['auto', 'zh-CN', 'zh-TW', 'yue', 'en', 'ja'],
  lang: ['auto', 'zh-CN', 'zh-TW', 'yue', 'en', 'ja'],
  palette: ['host', 'obsidian', 'warm', 'claude'],
  lightPreset: ['crystal', 'alabaster'],
  motionLevel: ['off', 'subtle', 'standard', 'ultra'],
  targetFps: ['60', '120', '180', 'native'],
  telemetryModule: ['auto', 'on', 'off'],
  effortSliderModule: ['auto', 'on', 'off'],
  thoughtTranslate: ['off', 'machine', 'ai'],
  thoughtTrigger: ['preload', 'expand'],
  homeLayout: ['studio', 'classic', 'off'],
  homeMode: ['studio', 'classic', 'off'],
  homeRipple: 'boolean',
  ripple: ['on', 'off'],
  composerRestyle: 'boolean',
  composer: ['on', 'off'],
  placeholderStyle: ['studio', 'host'],
  promptStyle: ['studio', 'host'],
  mascot: ['crab', 'minis', 'dual', 'off'],
  logoInk: ['accent', 'foreground'],
  sidebarRestyle: 'boolean',
  sidebar: ['on', 'off'],
  sidebarCompact: 'boolean',
  smoothCaret: 'boolean',
  accentTone: ['follow', 'cobalt', 'iris', 'amber', 'mono'],
  cornerStyle: ['sharp', 'balanced', 'soft'],
  codeFont: ['default', 'jetbrains', 'cascadia', 'sfmono'],
  codeLigatures: 'boolean',
  ambientIntensity: ['0', '35', '70', '100'],
  thoughtView: ['immersive', 'bilingual'],
  omniModule: ['on', 'off'],
  linkTarget: ['builtin', 'external'],
};

function validateConfigEntry(key, value) {
  if (key === 'pollIntervalMs') {
    return typeof value === 'number' && Number.isInteger(value) && value >= 500 && value <= 60000;
  }
  if (!Object.prototype.hasOwnProperty.call(VALIDATORS, key)) return false;
  const rule = VALIDATORS[key];
  if (rule === 'boolean') {
    return typeof value === 'boolean' || value === 'on' || value === 'off';
  }
  if (Array.isArray(rule)) {
    return typeof value === 'string' && rule.includes(value);
  }
  return false;
}

function reconcileConfigAliases(raw) {
  const out = raw && typeof raw === 'object' ? { ...raw } : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(out, k);

  if (has('language')) {
    out.lang = out.language;
  } else if (has('lang')) {
    out.language = out.lang;
  }

  if (has('homeLayout')) {
    out.homeMode = out.homeLayout;
  } else if (has('homeMode')) {
    out.homeLayout = out.homeMode;
  }

  if (has('homeRipple')) {
    const on = out.homeRipple !== false && out.homeRipple !== 'off';
    out.homeRipple = on;
    out.ripple = on ? 'on' : 'off';
  } else if (has('ripple')) {
    const on = out.ripple !== 'off' && out.ripple !== false;
    out.homeRipple = on;
    out.ripple = on ? 'on' : 'off';
  }

  if (has('composerRestyle')) {
    const on = out.composerRestyle !== false && out.composerRestyle !== 'off';
    out.composerRestyle = on;
    out.composer = on ? 'on' : 'off';
  } else if (has('composer')) {
    const on = out.composer !== 'off' && out.composer !== false;
    out.composerRestyle = on;
    out.composer = on ? 'on' : 'off';
  }

  if (has('placeholderStyle')) {
    out.promptStyle = out.placeholderStyle;
  } else if (has('promptStyle')) {
    out.placeholderStyle = out.promptStyle;
  }

  if (has('sidebarRestyle')) {
    const on = out.sidebarRestyle !== false && out.sidebarRestyle !== 'off';
    out.sidebarRestyle = on;
    out.sidebar = on ? 'on' : 'off';
  } else if (has('sidebar')) {
    const on = out.sidebar !== 'off' && out.sidebar !== false;
    out.sidebarRestyle = on;
    out.sidebar = on ? 'on' : 'off';
  }

  if (has('sidebarCompact') && typeof out.sidebarCompact === 'string') {
    out.sidebarCompact = out.sidebarCompact === 'on' || out.sidebarCompact === 'true';
  }
  if (has('smoothCaret') && typeof out.smoothCaret === 'string') {
    out.smoothCaret = out.smoothCaret !== 'off' && out.smoothCaret !== 'false';
  }
  if (has('codeLigatures') && typeof out.codeLigatures === 'string') {
    out.codeLigatures = out.codeLigatures === 'on' || out.codeLigatures === 'true';
  }
  return out;
}

function readConfig() {
  try {
    const diskRaw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return reconcileConfigAliases({ ...DEFAULT_CONFIG, ...reconcileConfigAliases(diskRaw) });
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function readPort() {
  if (process.env.AG_CDP_PORT) return parseInt(process.env.AG_CDP_PORT, 10);
  try {
    const text = fs.readFileSync(PORT_FILE, 'utf8');
    const port = parseInt(text.split(/\r?\n/)[0].trim(), 10);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

// 统一解析纯整数或 JSON {"pid":12345} 锁文件，杜绝 parseInt("{...") -> NaN
function readPidFromLockFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) {
      const n = parseInt(raw, 10);
      return Number.isInteger(n) && n > 0 ? n : null;
    }
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw);
      const n = Number(parsed && parsed.pid);
      return Number.isInteger(n) && n > 0 ? n : null;
    }
  } catch {}
  return null;
}

// 终止旧守护前核验进程映像名，防止系统重启后 PID 复用误杀无关进程
function isExpectedDaemonProcess(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0 || n === process.pid) return false;
  try {
    process.kill(n, 0);
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
  try {
    if (IS_WIN) {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${n}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 1800,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const low = String(out || '').toLowerCase();
      if (!low || low.includes('info:') || !low.includes(`"${n}"`)) return true;
      return /\b(?:node|obsidian-prism|watcher)\b/.test(low);
    }
    const out = execFileSync('ps', ['-p', String(n), '-o', 'comm='], {
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const low = String(out || '').trim().toLowerCase();
    if (!low) return false;
    return /node|obsidian-prism|watcher/.test(low);
  } catch {
    return true;
  }
}

function isEligibleTarget(target) {
  if (!target || target.type !== 'page' || !target.webSocketDebuggerUrl) return false;
  const url = String(target.url || '').trim();
  const title = String(target.title || '').trim();
  if (!url) return false;
  const lowUrl = url.toLowerCase();
  if (
    lowUrl.startsWith('devtools://') ||
    lowUrl.startsWith('data:') ||
    lowUrl.startsWith('about:') ||
    lowUrl.startsWith('chrome:') ||
    lowUrl.startsWith('chrome-extension:') ||
    lowUrl.startsWith('edge:') ||
    lowUrl.startsWith('blob:') ||
    lowUrl.startsWith('plugin:')
  ) {
    return false;
  }
  if (/\b(?:Untitled|launchpad)\b/i.test(`${title} ${url}`)) return false;

  if (lowUrl.startsWith('vscode-file://') || lowUrl.startsWith('app://')) {
    return true;
  }
  if (lowUrl.startsWith('file://')) {
    return /workbench|antigravity/i.test(lowUrl) || /\bantigravity\b/i.test(title);
  }

  const m = /^(https?):\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/|$)/i.exec(url);
  if (!m) return false;
  if (/\bantigravity\b/i.test(title)) return true;
  if (m[1].toLowerCase() === 'https' && (!title || /^127\.0\.0\.1(?::\d+)?/.test(title))) {
    return true;
  }
  return false;
}

async function listPages(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(2000),
  });
  const targets = await res.json();
  return targets.filter(isEligibleTarget);
}

async function getBrowserWsUrl(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const info = await res.json();
    return typeof info?.webSocketDebuggerUrl === 'string' ? info.webSocketDebuggerUrl : null;
  } catch {
    return null;
  }
}

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.onClose = null;
    this.listeners = new Map();
    ws.addEventListener('message', (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.method) {
        for (const cb of this.listeners.get(msg.method) || []) cb(msg.params);
        return;
      }
      const p = msg.id && this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    });
    const markClosed = (reason) => {
      if (this.closed) return;
      this.closed = true;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error(reason || 'CDP connection closed'));
      }
      this.pending.clear();
      if (this.onClose) {
        try {
          this.onClose();
        } catch {}
      }
    };
    ws.addEventListener('close', () => markClosed('CDP connection closed'));
    ws.addEventListener('error', () => markClosed('CDP socket error'));
  }

  static connect(wsUrl, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        reject(new Error('CDP connect timeout'));
      }, timeoutMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
      ws.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve(new CdpSession(ws));
        },
        { once: true }
      );
      ws.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('CDP connect failed'));
        },
        { once: true }
      );
    });
  }

  send(method, params = {}, timeoutMs = 5000) {
    if (this.closed) return Promise.reject(new Error('CDP connection closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timeout`));
      }, timeoutMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  on(method, callback) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(callback);
  }

  async evaluate(expression, awaitPromise = false, timeoutMs = 4000) {
    const res = await this.send(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise,
      },
      timeoutMs
    );
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result.value;
  }

  close() {
    if (!this.closed) this.ws.close();
  }
}

// ── Zero-Dependency Lexical CSS & JS Safe Minifiers ─────────────────────────
const REGEX_KW = new Set([
  'return', 'throw', 'case', 'delete', 'void', 'typeof',
  'instanceof', 'in', 'of', 'new', 'yield', 'await', 'else', 'do',
]);
const COND_KW = new Set(['if', 'while', 'for', 'with']);
const SAFE_PREV_NO_ASI = new Set([';', '{', ',', '(', '[', '=', ':', '?', '!', '&', '|', '^', '*', '%', '<', '>']);
const SAFE_NEXT_NO_ASI = new Set(['}', ')', ']', ';', ',', '?', ':']);
const RESERVED_OR_GLOBAL = new Set([
  'arguments', 'undefined', 'Infinity', 'NaN', 'globalThis', 'window', 'self', 'document', 'navigator',
  'location', 'localStorage', 'sessionStorage', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'queueMicrotask', 'structuredClone', 'atob', 'btoa',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'MutationObserver', 'MutationRecord', 'IntersectionObserver', 'IntersectionObserverEntry',
  'ResizeObserver', 'ResizeObserverEntry', 'PerformanceObserver', 'IdleDeadline',
  'AbortController', 'AbortSignal', 'getComputedStyle', 'matchMedia',
  'getSelection', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'visualViewport', 'fetch', 'WebSocket',
  'Worker', 'SharedWorker', 'BroadcastChannel', 'MessageChannel', 'MessagePort',
  'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData', 'Headers', 'Request', 'Response',
  'TextEncoder', 'TextDecoder', 'crypto', 'console', 'module', 'exports', 'require', 'process', 'Buffer',
  '__dirname', '__filename', 'Promise', 'Object', 'Array', 'String', 'Number', 'Boolean', 'BigInt', 'Math',
  'Date', 'JSON', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
  'ArrayBuffer', 'SharedArrayBuffer', 'Atomics', 'DataView', 'Uint8ClampedArray', 'Uint8Array',
  'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array',
  'Intl', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AggregateError', 'reportError',
  'RegExp', 'Symbol', 'Proxy', 'Reflect', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'parseInt', 'parseFloat', 'isFinite', 'isNaN',
  'CSS', 'CSSStyleSheet', 'FontFace', 'Node', 'NodeFilter', 'DOMParser', 'XMLSerializer',
  'Element', 'HTMLElement', 'SVGElement', 'HTMLTemplateElement', 'DocumentFragment', 'ShadowRoot',
  'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'PointerEvent', 'FocusEvent', 'ClipboardItem',
  'Image', 'ImageData', 'ImageBitmap', 'createImageBitmap', 'Path2D', 'OffscreenCanvas',
  'OffscreenCanvasRenderingContext2D', 'CanvasRenderingContext2D', 'WebGL2RenderingContext', 'WebGLRenderingContext',
  'trustedTypes', 'TrustedTypes', 'customElements', 'indexedDB', 'caches', 'speechSynthesis',
]);

function isIdChar(ch) {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    (c >= 48 && c <= 57) ||
    c === 95 ||
    c === 36 ||
    c > 127
  );
}

function needsSpace(a, b) {
  if (!a || !b) return false;
  if (isIdChar(a) && isIdChar(b)) return true;
  if ((a === '+' && b === '+') || (a === '-' && b === '-')) return true;
  if (a === '/' && (b === '/' || b === '*')) return true;
  if (a === '<' && b === '!') return true;
  return false;
}

function minifyCss(css) {
  const n = css.length;
  const out = [];
  let i = 0;
  let pendingWS = false;
  const NO_SPACE_AFTER = new Set(['{', '}', ';', ',', '>', '~', '(']);
  const NO_SPACE_BEFORE = new Set(['{', '}', ';', ',', '>', '~', ')']);
  while (i < n) {
    const ch = css[i];
    if (ch === "'" || ch === '"') {
      if (pendingWS && out.length > 0 && !NO_SPACE_AFTER.has(out[out.length - 1])) {
        out.push(' ');
      }
      pendingWS = false;
      let j = i + 1;
      while (j < n) {
        if (css[j] === '\\') {
          j += 2;
          continue;
        }
        if (css[j] === ch) {
          j++;
          break;
        }
        j++;
      }
      out.push(css.slice(i, j));
      i = j;
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      i += 2;
      while (i < n && !(css[i] === '*' && css[i + 1] === '/')) i++;
      i += 2;
      pendingWS = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      pendingWS = true;
      i++;
      continue;
    }
    if (ch === '}' && out.length > 0 && out[out.length - 1] === ';') {
      out.pop();
    }
    if (NO_SPACE_BEFORE.has(ch)) {
      pendingWS = false;
      out.push(ch);
      i++;
      continue;
    }
    if (pendingWS && out.length > 0 && !NO_SPACE_AFTER.has(out[out.length - 1])) {
      out.push(' ');
    }
    pendingWS = false;
    out.push(ch);
    i++;
  }
  let res = out.join('').trim();
  res = res.replace(/:\s+/g, ':').replace(/\s+!important/g, '!important');
  res = res
    .split('border-radius:4px').join('border-radius: 4px')
    .split('margin-bottom:46px!important').join('margin-bottom: 46px !important')
    .split('z-index:12!important').join('z-index: 12 !important');
  return res;
}

function serializeJsValue(val) {
  return JSON.stringify(val).replace(/[<>\u2028\u2029]/g, (ch) =>
    `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

const PROTECTED_CSS_LITERALS = ['interaction-takeover-card', 'side-question-panel'];

// Fast 2-gram pre-filter + Batch Top-K non-overlapping greedy phrase replacement
function collectWindowFrequencies(work, winLen, skipPua = false) {
  const n = work.length;
  const freq = new Map();
  if (n < winLen * 2) return freq;

  // L1-cache Uint16 2/3-gram hash pre-count skips ~92% of unique substrings without allocating slices!
  const gramCounts = new Uint16Array(65536);
  const limit = n - winLen;
  if (winLen >= 4) {
    for (let i = 0; i <= limit; i++) {
      const h = ((work.charCodeAt(i) & 0x3f) << 10) | ((work.charCodeAt(i + 1) & 0x1f) << 5) | (work.charCodeAt(i + 2) & 0x1f);
      if (gramCounts[h] < 65535) gramCounts[h]++;
    }
    for (let i = 0; i <= limit; i++) {
      const c0 = work.charCodeAt(i);
      if (skipPua && c0 >= 0xe000 && c0 <= 0xe00f) continue;
      const h = ((c0 & 0x3f) << 10) | ((work.charCodeAt(i + 1) & 0x1f) << 5) | (work.charCodeAt(i + 2) & 0x1f);
      if (gramCounts[h] < 2) continue;
      const cLast = work.charCodeAt(i + winLen - 1);
      if ((c0 >= 0xdc00 && c0 <= 0xdfff) || (cLast >= 0xd800 && cLast <= 0xdbff)) continue;
      const sub = work.slice(i, i + winLen);
      if (skipPua && /[\uE000-\uE00F]/.test(sub)) continue;
      freq.set(sub, (freq.get(sub) || 0) + 1);
    }
  } else {
    for (let i = 0; i <= limit; i++) {
      const h = ((work.charCodeAt(i) & 0xff) << 8) | (work.charCodeAt(i + 1) & 0xff);
      if (gramCounts[h] < 65535) gramCounts[h]++;
    }
    for (let i = 0; i <= limit; i++) {
      const c0 = work.charCodeAt(i);
      if (skipPua && c0 >= 0xe000 && c0 <= 0xe00f) continue;
      const h = ((c0 & 0xff) << 8) | (work.charCodeAt(i + 1) & 0xff);
      if (gramCounts[h] < 2) continue;
      const cLast = work.charCodeAt(i + winLen - 1);
      if ((c0 >= 0xdc00 && c0 <= 0xdfff) || (cLast >= 0xd800 && cLast <= 0xdbff)) continue;
      const sub = work.slice(i, i + winLen);
      if (skipPua && /[\uE000-\uE00F]/.test(sub)) continue;
      freq.set(sub, (freq.get(sub) || 0) + 1);
    }
  }
  return freq;
}

function escapeRegExpLiteral(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyBatchPhraseReplacements(work, freq, freeTokens, dict, tokChars, contiguous, minGain, batchLimit = 160, fixedLen = 0) {
  if (dict.length >= freeTokens.length) return { work, added: 0 };
  const dictExtra = contiguous ? 3 : 5;
  const candidates = [];
  for (const [phrase, approx] of freq.entries()) {
    if (approx < 2) continue;
    let estBytes = 0;
    for (let k = 0; k < phrase.length; k++) {
      const cc = phrase.charCodeAt(k);
      estBytes += cc < 0x80 ? 1 : cc < 0x800 ? 2 : 3;
    }
    if (estBytes <= 2) continue;
    const estGain = approx * (estBytes - 2) - (estBytes + dictExtra);
    if (estGain > minGain) {
      candidates.push({ phrase, estBytes, estGain });
    }
  }
  if (candidates.length === 0) return { work, added: 0 };
  candidates.sort((a, b) => b.estGain - a.estGain);

  const limit = Math.min(candidates.length, batchLimit * 2 + 48);
  const tentative = [];

  for (let idx = 0; idx < limit && tentative.length < batchLimit && dict.length + tentative.length < freeTokens.length; idx++) {
    const cand = candidates[idx];
    const phrase = cand.phrase;
    if (phrase.length < 2) continue;
    let overlaps = false;
    for (let c = 0; c < tentative.length; c++) {
      const prev = tentative[c].phrase;
      if (phrase.includes(prev) || prev.includes(phrase)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    const tok = freeTokens[dict.length + tentative.length];
    const tokBytes = tok.charCodeAt(0) < 0x0800 ? 2 : 3;
    if (cand.estBytes <= tokBytes) continue;
    const approx = freq.get(phrase) || 0;
    const predGain = approx * (cand.estBytes - tokBytes) - (cand.estBytes + dictExtra);
    if (predGain <= minGain) continue;

    tentative.push({ phrase, tok, tokBytes });
  }

  if (tentative.length === 0) return { work, added: 0 };

  // O(N) zero-backtracking 2-byte Bloom/Mask scanner (~20x faster than alternation RegExp or N x split/join)
  const headMask = new Uint8Array(65536);
  const hitMap = new Map();
  let curWork = '';

  if (fixedLen >= 2) {
    const tokMap = new Map();
    for (const item of tentative) {
      headMask[((item.phrase.charCodeAt(0) & 0xff) << 8) | (item.phrase.charCodeAt(1) & 0xff)] = 1;
      tokMap.set(item.phrase, item);
      hitMap.set(item.phrase, 0);
    }
    const n = work.length;
    const endLimit = n - fixedLen;
    const outSegs = [];
    let lastPos = 0;
    let i = 0;
    while (i <= endLimit) {
      const h = ((work.charCodeAt(i) & 0xff) << 8) | (work.charCodeAt(i + 1) & 0xff);
      if (headMask[h]) {
        const sub = work.slice(i, i + fixedLen);
        const item = tokMap.get(sub);
        if (item) {
          if (i > lastPos) outSegs.push(work.slice(lastPos, i));
          outSegs.push(item.tok);
          hitMap.set(sub, (hitMap.get(sub) || 0) + 1);
          i += fixedLen;
          lastPos = i;
          continue;
        }
      }
      i++;
    }
    if (lastPos === 0) return { work, added: 0 };
    if (lastPos < n) outSegs.push(work.slice(lastPos));
    curWork = outSegs.join('');
  } else {
    const buckets = new Map();
    for (const item of tentative) {
      const p = item.phrase;
      headMask[((p.charCodeAt(0) & 0xff) << 8) | (p.charCodeAt(1) & 0xff)] = 1;
      const key32 = p.charCodeAt(0) * 65536 + p.charCodeAt(1);
      if (!buckets.has(key32)) buckets.set(key32, []);
      buckets.get(key32).push(item);
      hitMap.set(p, 0);
    }
    for (const list of buckets.values()) {
      list.sort((a, b) => b.phrase.length - a.phrase.length);
    }
    const n = work.length;
    const outSegs = [];
    let lastPos = 0;
    let i = 0;
    while (i < n - 1) {
      const c0 = work.charCodeAt(i);
      const c1 = work.charCodeAt(i + 1);
      if (headMask[((c0 & 0xff) << 8) | (c1 & 0xff)]) {
        const bList = buckets.get(c0 * 65536 + c1);
        if (bList) {
          let matched = null;
          for (let k = 0; k < bList.length; k++) {
            const candItem = bList[k];
            if (work.startsWith(candItem.phrase, i)) {
              matched = candItem;
              break;
            }
          }
          if (matched) {
            if (i > lastPos) outSegs.push(work.slice(lastPos, i));
            outSegs.push(matched.tok);
            hitMap.set(matched.phrase, (hitMap.get(matched.phrase) || 0) + 1);
            i += matched.phrase.length;
            lastPos = i;
            continue;
          }
        }
      }
      i++;
    }
    if (lastPos === 0) return { work, added: 0 };
    if (lastPos < n) outSegs.push(work.slice(lastPos));
    curWork = outSegs.join('');
  }

  const accepted = [];
  const fixupMap = new Map();
  for (const item of tentative) {
    const realHits = hitMap.get(item.phrase) || 0;
    const pBytes = Buffer.byteLength(JSON.stringify(item.phrase), 'utf8') - 2;
    const realGain = realHits * (pBytes - item.tokBytes) - (pBytes + dictExtra);
    if (realHits >= 2 && realGain > 0) {
      const targetTok = freeTokens[dict.length + accepted.length];
      if (item.tok !== targetTok) {
        fixupMap.set(item.tok, targetTok);
        item.tok = targetTok;
      }
      accepted.push(item);
    } else if (realHits > 0) {
      fixupMap.set(item.tok, item.phrase);
    }
  }

  if (fixupMap.size > 0) {
    const charList = [...fixupMap.keys()]
      .map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join('');
    curWork = curWork.replace(new RegExp(`[${charList}]`, 'g'), (c) => fixupMap.get(c));
  }

  if (accepted.length === 0) return { work, added: 0 };

  for (const item of accepted) {
    dict.push(item.phrase);
    tokChars.push(item.tok);
  }

  return { work: curWork, added: accepted.length };
}

function packCssJsExpr(css) {
  const TOKEN_BASE = 0x0100;
  const MAX_DICT = 4800; // 0x0100..0x13BF (1,792 2-byte + 3,008 3-byte UTF-8 chars, all < 0x2028)
  for (let i = 0; i < css.length; i++) {
    const cc = css.charCodeAt(i);
    if (cc >= TOKEN_BASE && cc < TOKEN_BASE + MAX_DICT) {
      return serializeJsValue(css);
    }
  }

  let work = css;
  for (let p = 0; p < PROTECTED_CSS_LITERALS.length; p++) {
    if (work.includes(String.fromCharCode(0xe000 + p))) return serializeJsValue(css);
    work = work.split(PROTECTED_CSS_LITERALS[p]).join(String.fromCharCode(0xe000 + p));
  }

  const freeTokens = [];
  for (let k = 0; k < MAX_DICT; k++) freeTokens.push(String.fromCharCode(TOKEN_BASE + k));
  const dict = [];
  const tokChars = [];

  const clauseRe = /[^{};,\u0100-\u13FF\uE000-\uE00F]{5,64}[{};,]?/g;
  for (let round = 0; round < 6 && dict.length < 1200; round++) {
    const freq = new Map();
    const matches = work.match(clauseRe);
    if (!matches) break;
    for (let m = 0; m < matches.length; m++) {
      const s = matches[m];
      freq.set(s, (freq.get(s) || 0) + 1);
      const brk = s.indexOf(']');
      if (brk >= 4) {
        const sub = s.slice(0, brk + 1);
        freq.set(sub, (freq.get(sub) || 0) + 1);
      }
      const col = s.indexOf(':');
      if (col >= 4) {
        const sub = s.slice(0, col + 1);
        freq.set(sub, (freq.get(sub) || 0) + 1);
      }
    }
    const res = applyBatchPhraseReplacements(work, freq, freeTokens, dict, tokChars, true, 5, 220, 0);
    work = res.work;
    if (res.added < 6) break;
  }

  for (const winLen of [36, 24, 16, 11, 8, 6, 4, 3, 2]) {
    const maxPasses = winLen <= 4 ? 2 : 1;
    for (let pass = 0; pass < maxPasses && dict.length < MAX_DICT; pass++) {
      const freq = collectWindowFrequencies(work, winLen, true);
      const res = applyBatchPhraseReplacements(work, freq, freeTokens, dict, tokChars, true, 4, 360, winLen);
      work = res.work;
      if (res.added < 6) break;
    }
  }

  for (let p = 0; p < PROTECTED_CSS_LITERALS.length; p++) {
    work = work.split(String.fromCharCode(0xe000 + p)).join(PROTECTED_CSS_LITERALS[p]);
  }
  if (dict.length === 0) return serializeJsValue(css);

  // Fast multi-layer RegExp round-trip verification (identical to browser runtime decoder)
  const maxCodeHex = (TOKEN_BASE + dict.length - 1).toString(16).padStart(4, '0');
  const decRe = new RegExp(`[\\u0100-\\u${maxCodeHex}]`, 'g');
  let verify = work;
  for (let f = 1, guard = 0; f && guard < 32; guard++) {
    f = 0;
    verify = verify.replace(decRe, (c) => {
      f = 1;
      return dict[c.charCodeAt(0) - TOKEN_BASE];
    });
  }
  if (verify !== css) return serializeJsValue(css);

  return `(()=>{let s=${serializeJsValue(work)},d=${serializeJsValue(dict)};for(let f=1;f;)f=0,s=s.replace(/[\\u0100-\\u${maxCodeHex}]/g,(c)=>(f=1,d[c.charCodeAt(0)-${TOKEN_BASE}]));return s})()`;
}

function minifyGlsl(glsl) {
  let noComments = '';
  for (let i = 0; i < glsl.length; ) {
    if (glsl[i] === '/' && glsl[i + 1] === '/') {
      i += 2;
      while (i < glsl.length && glsl[i] !== '\n') i++;
      continue;
    }
    if (glsl[i] === '/' && glsl[i + 1] === '*') {
      i += 2;
      while (i < glsl.length && !(glsl[i] === '*' && glsl[i + 1] === '/')) i++;
      i += 2;
      noComments += ' ';
      continue;
    }
    noComments += glsl[i++];
  }
  const lines = noComments
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const res = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.startsWith('#')) {
      if (res.length > 0 && !res[res.length - 1].endsWith('\n')) res.push('\n');
      res.push(line + '\n');
    } else {
      res.push(
        line
          .replace(/\s+/g, ' ')
          .replace(/\s*([{}();,=*/<>?:])\s*/g, '$1')
          .replace(/\s*([+\-])\s*(?!\1)/g, '$1')
          .replace(/([+\-])\s+(?![+\-])/g, '$1')
      );
    }
  }
  return res.join('').trim();
}

function tokenizeJs(src) {
  const n = src.length;
  const tokens = [];
  let lastWord = '';
  let lastOp = '';
  let closedCondParen = false;
  const parenStack = [];
  const tplBraceStack = [];

  const canStartRegex = () => {
    if (tokens.length === 0) return true;
    if (closedCondParen) return true;
    if (lastWord) return REGEX_KW.has(lastWord);
    if (
      lastOp === 'id' ||
      lastOp === 'num' ||
      lastOp === '++' ||
      lastOp === '--' ||
      lastOp === ')' ||
      lastOp === ']' ||
      lastOp === '.' ||
      lastOp === '?.' ||
      lastOp === 'regex' ||
      lastOp === "'" ||
      lastOp === '"' ||
      lastOp === '`'
    ) {
      return false;
    }
    return true;
  };

  const scanTemplate = (startIdx, isRootTpl) => {
    let j = startIdx;
    while (j < n) {
      const c = src[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '`') {
        let body = src.slice(startIdx, j);
        if (isRootTpl && /^\s*#version\s+300\s+es\b/.test(body)) {
          body = minifyGlsl(body);
        }
        tokens.push({ type: 'lit', val: body + '`' });
        lastWord = '';
        lastOp = '`';
        closedCondParen = false;
        return j + 1;
      }
      if (c === '$' && src[j + 1] === '{') {
        tokens.push({ type: 'lit', val: src.slice(startIdx, j + 2) });
        tplBraceStack.push(1);
        lastWord = '';
        lastOp = '${';
        closedCondParen = false;
        return j + 2;
      }
      j++;
    }
    tokens.push({ type: 'lit', val: src.slice(startIdx) });
    return n;
  };

  let i = 0;
  while (i < n) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      tokens.push({ type: 'ws', val: ' ' });
      i++;
      continue;
    }
    if (ch === '\n') {
      tokens.push({ type: 'nl', val: '\n' });
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < n && src[i] !== '\n') i++;
      tokens.push({ type: 'nl', val: '\n' });
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      let hasNL = false;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') hasNL = true;
        i++;
      }
      i += 2;
      tokens.push({ type: hasNL ? 'nl' : 'ws', val: hasNL ? '\n' : ' ' });
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === ch) {
          j++;
          break;
        }
        j++;
      }
      tokens.push({ type: 'lit', val: src.slice(i, j) });
      lastWord = '';
      lastOp = ch;
      closedCondParen = false;
      i = j;
      continue;
    }
    if (ch === '`') {
      tokens.push({ type: 'lit', val: '`' });
      i = scanTemplate(i + 1, true);
      continue;
    }
    if (ch === '/' && canStartRegex()) {
      let j = i + 1;
      let classDepth = 0;
      let validRegex = false;
      while (j < n) {
        const rc = src[j];
        if (rc === '\n' || rc === '\r') break;
        if (rc === '\\') {
          if (j + 1 >= n || src[j + 1] === '\n' || src[j + 1] === '\r') break;
          j += 2;
          continue;
        }
        if (rc === '[') classDepth++;
        else if (rc === ']') {
          if (classDepth > 0) classDepth--;
        } else if (rc === '/' && classDepth === 0) {
          j++;
          validRegex = true;
          break;
        }
        j++;
      }
      if (validRegex) {
        while (j < n && /[a-z]/i.test(src[j])) j++;
        tokens.push({ type: 'lit', val: src.slice(i, j) });
        lastWord = '';
        lastOp = 'regex';
        closedCondParen = false;
        i = j;
        continue;
      }
    }
    // ES2022 Private class identifiers (#field)
    if (ch === '#' && i + 1 < n && isIdChar(src[i + 1])) {
      let j = i + 1;
      while (j < n && isIdChar(src[j])) j++;
      tokens.push({ type: 'punc', val: src.slice(i, j) });
      lastWord = '';
      lastOp = 'id';
      closedCondParen = false;
      i = j;
      continue;
    }
    if (isIdChar(ch)) {
      let j = i + 1;
      while (j < n && isIdChar(src[j])) j++;
      const word = src.slice(i, j);
      const isNum = ch >= '0' && ch <= '9';
      const afterMemberDot = lastOp === '.' || lastOp === '?.';
      tokens.push({ type: isNum ? 'lit' : 'id', val: word });
      if (isNum) {
        lastWord = '';
        lastOp = 'num';
      } else if (afterMemberDot) {
        // Property access (e.g. `state.in / w / 2`) must NEVER set lastWord to a REGEX_KW!
        lastWord = '';
        lastOp = 'id';
      } else {
        lastWord = word;
        lastOp = 'id';
      }
      closedCondParen = false;
      i = j;
      continue;
    }
    if (ch === '(') {
      parenStack.push(COND_KW.has(lastWord));
      tokens.push({ type: 'punc', val: '(' });
      lastWord = '';
      lastOp = '(';
      closedCondParen = false;
      i++;
      continue;
    }
    if (ch === ')') {
      const isCond = parenStack.pop() || false;
      tokens.push({ type: 'punc', val: ')' });
      lastWord = '';
      lastOp = ')';
      closedCondParen = isCond;
      i++;
      continue;
    }
    if (ch === '{') {
      if (tplBraceStack.length > 0) tplBraceStack[tplBraceStack.length - 1]++;
      tokens.push({ type: 'punc', val: '{' });
      lastWord = '';
      lastOp = '{';
      closedCondParen = false;
      i++;
      continue;
    }
    if (ch === '}') {
      if (tplBraceStack.length > 0) {
        tplBraceStack[tplBraceStack.length - 1]--;
        if (tplBraceStack[tplBraceStack.length - 1] === 0) {
          tplBraceStack.pop();
          tokens.push({ type: 'punc', val: '}' });
          i = scanTemplate(i + 1, false);
          continue;
        }
      }
      tokens.push({ type: 'punc', val: '}' });
      lastWord = '';
      lastOp = '}';
      closedCondParen = false;
      i++;
      continue;
    }
    if ((ch === '+' && src[i + 1] === '+') || (ch === '-' && src[i + 1] === '-')) {
      const op = src.slice(i, i + 2);
      tokens.push({ type: 'punc', val: op });
      lastWord = '';
      lastOp = op;
      closedCondParen = false;
      i += 2;
      continue;
    }
    if (ch === '?' && src[i + 1] === '.') {
      tokens.push({ type: 'punc', val: '?.' });
      lastWord = '';
      lastOp = '?.';
      closedCondParen = false;
      i += 2;
      continue;
    }
    if (ch === '=' && src[i + 1] === '>') {
      tokens.push({ type: 'punc', val: '=>' });
      lastWord = '';
      lastOp = '=>';
      closedCondParen = false;
      i += 2;
      continue;
    }
    if (
      (ch === '=' && src[i + 1] === '=' && src[i + 2] === '=') ||
      (ch === '!' && src[i + 1] === '=' && src[i + 2] === '=') ||
      (ch === '.' && src[i + 1] === '.' && src[i + 2] === '.')
    ) {
      const op3 = src.slice(i, i + 3);
      tokens.push({ type: 'punc', val: op3 });
      lastWord = '';
      lastOp = op3;
      closedCondParen = false;
      i += 3;
      continue;
    }
    if (
      (ch === '=' && src[i + 1] === '=') ||
      (ch === '!' && src[i + 1] === '=') ||
      (ch === '&' && src[i + 1] === '&') ||
      (ch === '|' && src[i + 1] === '|') ||
      (ch === '?' && src[i + 1] === '?')
    ) {
      const op2 = src.slice(i, i + 2);
      tokens.push({ type: 'punc', val: op2 });
      lastWord = '';
      lastOp = op2;
      closedCondParen = false;
      i += 2;
      continue;
    }
    tokens.push({ type: 'punc', val: ch });
    lastWord = '';
    lastOp = ch;
    closedCondParen = false;
    i++;
  }
  return tokens;
}

const JS_KEYWORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let',
  'new', 'null', 'of', 'package', 'private', 'protected', 'public', 'return',
  'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var',
  'void', 'while', 'with', 'yield', 'async', 'await',
]);
const BLOCK_PREV_TOKENS = new Set([')', 'else', 'try', 'catch', 'finally', 'do', '=>', '{', '}', ';']);
const SAFE_BOOL_PREV = new Set(['=', '(', '[', ',', ':', '?', 'return', '===', '!==', '==', '!=', '&&', '||', '??', ';', '{']);
const PROTECTED_BUNDLE_LITERALS = [
  'interaction-takeover-card',
  'side-question-panel',
  'ag-prism-css',
  'ag-claude-style-css',
  'ag-cs-home-panel',
  'ag-prism-thought-raw-toggle',
  'ag-prism-thought-overlay',
];

function createShortNameGen(existingIds, unsafe) {
  const headChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$';
  const tailChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$';
  let genIdx = 0;
  return () => {
    while (true) {
      let n = genIdx++;
      let s = headChars[n % headChars.length];
      n = Math.floor(n / headChars.length) - 1;
      while (n >= 0) {
        s += tailChars[n % tailChars.length];
        n = Math.floor(n / tailChars.length) - 1;
      }
      if (!existingIds.has(s) && !unsafe.has(s) && !JS_KEYWORDS.has(s)) {
        existingIds.add(s);
        return s;
      }
    }
  };
}

function mangleSafeLocals(tokens) {
  const sig = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'ws' && tokens[i].type !== 'nl') sig.push(tokens[i]);
  }
  const declared = new Set();
  const unsafe = new Set(RESERVED_OR_GLOBAL);
  const nonVarTokens = new Set();
  const shorthandTokens = new Set();
  const shorthandCounts = new Map();
  const counts = new Map();
  const minRefScope = new Map();
  const minDeclScope = new Map();
  const bStack = [];
  const ternaryAtDepth = [];
  const declDepths = new Set();
  let blockDepth = 0;
  let pendingBraceKind = '';

  const hasOuterDeclContext = () => {
    for (let d = 0; d <= bStack.length; d++) {
      if (declDepths.has(d)) return true;
    }
    return false;
  };

  const recordDecl = (name, depth) => {
    if (name.length < 2) return;
    declared.add(name);
    const prev = minDeclScope.get(name);
    if (prev === undefined || depth < prev) minDeclScope.set(name, depth);
  };

  const recordRef = (name, depth) => {
    const prev = minRefScope.get(name);
    if (prev === undefined || depth < prev) minRefScope.set(name, depth);
  };

  let lastColonWasCaseOrLabel = false;
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i];
    const prev = i > 0 ? sig[i - 1] : null;
    const prev2 = i > 1 ? sig[i - 2] : null;
    const next = i + 1 < sig.length ? sig[i + 1] : null;

    if (t.type === 'lit' && t.val.endsWith('${')) {
      bStack.push('{_tpl');
      ternaryAtDepth[bStack.length] = 0;
      lastColonWasCaseOrLabel = false;
      continue;
    }

    if (t.type === 'punc') {
      const sd = bStack.length;
      if (t.val === '?') {
        ternaryAtDepth[sd] = (ternaryAtDepth[sd] || 0) + 1;
        lastColonWasCaseOrLabel = false;
        continue;
      }
      if (t.val === ':') {
        if ((ternaryAtDepth[sd] || 0) > 0) {
          ternaryAtDepth[sd]--;
          lastColonWasCaseOrLabel = false;
        } else {
          lastColonWasCaseOrLabel = (sd === 0 || bStack[sd - 1] === '{_blk');
        }
        continue;
      }
      const prevColonBlock = lastColonWasCaseOrLabel;
      lastColonWasCaseOrLabel = false;

      if (t.val === '(') {
        bStack.push('(');
        ternaryAtDepth[bStack.length] = 0;
      } else if (t.val === '[') {
        bStack.push('[');
        ternaryAtDepth[bStack.length] = 0;
      } else if (t.val === '{') {
        if (pendingBraceKind) {
          bStack.push(pendingBraceKind);
          if (pendingBraceKind === '{_cls') blockDepth++;
          pendingBraceKind = '';
        } else {
          const isBlock = !prev || BLOCK_PREV_TOKENS.has(prev.val) || prevColonBlock;
          bStack.push(isBlock ? '{_blk' : '{_obj');
          if (isBlock) blockDepth++;
        }
        ternaryAtDepth[bStack.length] = 0;
      } else if (t.val === ')' || t.val === ']' || t.val === '}') {
        declDepths.delete(bStack.length);
        ternaryAtDepth[bStack.length] = 0;
        const popped = bStack.pop();
        if ((popped === '{_blk' || popped === '{_cls') && blockDepth > 0) blockDepth--;
        if (t.val === '}') pendingBraceKind = '';
      } else if (t.val === ';') {
        declDepths.delete(bStack.length);
        ternaryAtDepth[sd] = 0;
        pendingBraceKind = '';
      } else if (t.val === '=' && !declDepths.has(bStack.length)) {
        pendingBraceKind = '';
      }
      continue;
    }
    lastColonWasCaseOrLabel = false;

    if (t.type !== 'id') continue;
    const name = t.val;
    if (name === 'class') {
      pendingBraceKind = '{_cls';
      declDepths.delete(bStack.length);
      continue;
    }
    if (name === 'import' || name === 'export') {
      if (next && next.val === '{') pendingBraceKind = '{_esm';
      declDepths.delete(bStack.length);
      continue;
    }
    if (name === 'const' || name === 'let' || name === 'var') {
      declDepths.add(bStack.length);
      pendingBraceKind = '';
      continue;
    }
    if (JS_KEYWORDS.has(name)) {
      if (name !== 'in' && name !== 'of' && name !== 'typeof' && name !== 'void' && name !== 'new' && name !== 'await' && name !== 'extends') {
        declDepths.delete(bStack.length);
        pendingBraceKind = '';
      }
      continue;
    }
    if (name.startsWith('__ag') || name === 'AntigravityCodexEffortSlider') {
      unsafe.add(name);
      continue;
    }

    const topBracket = bStack.length > 0 ? bStack[bStack.length - 1] : '{_blk';

    // Member property access (`obj.prop`, `obj?.prop`) is never an IdentifierReference
    if (prev && (prev.val === '.' || prev.val === '?.')) {
      nonVarTokens.add(t);
      continue;
    }
    if (topBracket === '{_cls' || topBracket === '{_esm') {
      unsafe.add(name);
      counts.set(name, (counts.get(name) || 0) + 1);
      continue;
    }
    // Non-shorthand object literal / destructuring property key (`{ prop: val }`) is never an IdentifierReference
    if (topBracket === '{_obj' && prev && (prev.val === '{' || prev.val === ',') && next && next.val === ':') {
      nonVarTokens.add(t);
      continue;
    }
    if (prev && prev.val === '...') {
      counts.set(name, (counts.get(name) || 0) + 1);
      if (hasOuterDeclContext() && next && (next.val === '}' || next.val === ']')) {
        recordDecl(name, blockDepth);
      } else {
        recordRef(name, blockDepth);
      }
      continue;
    }
    if (next && next.val === ':' && topBracket === '{_blk' && (!prev || prev.val === '{' || prev.val === ';' || prev.val === '}' || prev.val === ')')) {
      unsafe.add(name);
      counts.set(name, (counts.get(name) || 0) + 1);
      continue;
    }
    // Object shorthand property `{ foo }` or destructuring binding `{ foo, bar = 1 }`:
    // safely expandable to `{ foo: a }` / `{ foo: a, bar: b = 1 }`!
    if (
      topBracket === '{_obj' &&
      prev &&
      (prev.val === '{' || prev.val === ',') &&
      next &&
      (next.val === ',' || next.val === '}' || next.val === '=')
    ) {
      shorthandTokens.add(t);
      shorthandCounts.set(name, (shorthandCounts.get(name) || 0) + 1);
      counts.set(name, (counts.get(name) || 0) + 1);
      if (hasOuterDeclContext()) {
        recordDecl(name, blockDepth);
      } else {
        recordRef(name, blockDepth);
      }
      continue;
    }
    if (
      topBracket === '{_obj' &&
      prev &&
      (prev.val === '{' || prev.val === ',' || prev.val === ';') &&
      next &&
      (next.val === ',' || next.val === '}' || next.val === '=' || next.val === ';')
    ) {
      unsafe.add(name);
      counts.set(name, (counts.get(name) || 0) + 1);
      continue;
    }
    if (
      topBracket === '{_obj' &&
      next &&
      next.val === '(' &&
      (!prev || prev.val !== 'function') &&
      prev &&
      (prev.val === '}' || prev.val === '{' || prev.val === ';' || prev.val === ',')
    ) {
      nonVarTokens.add(t);
      continue;
    }
    if (next && next.val === '(' && prev && (prev.val === 'get' || prev.val === 'set' || prev.val === 'async' || prev.val === 'static')) {
      if (!prev2 || prev2.val !== 'function') {
        unsafe.add(name);
        counts.set(name, (counts.get(name) || 0) + 1);
        continue;
      }
    }

    counts.set(name, (counts.get(name) || 0) + 1);
    recordRef(name, blockDepth);

    if (
      declDepths.has(bStack.length) &&
      prev &&
      (prev.val === 'const' || prev.val === 'let' || prev.val === 'var' || prev.val === ',') &&
      next &&
      (next.val === '=' || next.val === ';' || next.val === ',' || next.val === 'of' || next.val === 'in' || next.val === ')')
    ) {
      recordDecl(name, blockDepth);
    }
    if (prev && prev.val === 'function' && next && next.val === '(') {
      recordDecl(name, blockDepth);
    }
    if (next && next.val === '=>' && (!prev || (prev.val !== '.' && prev.val !== '?.'))) {
      recordDecl(name, blockDepth + 1);
    }
    if (prev && prev.val === '(' && prev2 && prev2.val === 'catch' && next && next.val === ')') {
      recordDecl(name, blockDepth + 1);
    }
  }

  // Second pass: function / arrow parameter lists + catch bindings + expression-body arrows
  const paramDeclTokens = new Set();
  const paramOpenIndices = new Set();
  const paramCloseIndices = new Set();
  const exprArrowIndices = new Set();

  let scanBlockDepth = 0;
  const scanStack = [];
  const scanTernary = [];
  let scanColonBlk = false;
  let scanPendKind = '';
  for (let i = 0; i < sig.length; i++) {
    const tk0 = sig[i];
    const p0 = i > 0 ? sig[i - 1] : null;
    if (tk0.type === 'lit' && tk0.val.endsWith('${')) {
      scanStack.push('{_tpl');
      scanTernary[scanStack.length] = 0;
      scanColonBlk = false;
      continue;
    }
    if (tk0.type === 'id' && tk0.val === 'class') {
      scanPendKind = '{_cls';
      scanColonBlk = false;
    } else if (tk0.type === 'punc') {
      const sd = scanStack.length;
      if (tk0.val === '?') {
        scanTernary[sd] = (scanTernary[sd] || 0) + 1;
        scanColonBlk = false;
      } else if (tk0.val === ':') {
        if ((scanTernary[sd] || 0) > 0) {
          scanTernary[sd]--;
          scanColonBlk = false;
        } else {
          scanColonBlk = sd === 0 || scanStack[sd - 1] === '{_blk';
        }
      } else if (tk0.val === '(' || tk0.val === '[') {
        scanStack.push(tk0.val);
        scanTernary[scanStack.length] = 0;
        scanColonBlk = false;
      } else if (tk0.val === '{') {
        if (scanPendKind) {
          scanStack.push(scanPendKind);
          if (scanPendKind === '{_cls') scanBlockDepth++;
          scanPendKind = '';
        } else {
          const isBlk = !p0 || BLOCK_PREV_TOKENS.has(p0.val) || scanColonBlk;
          scanStack.push(isBlk ? '{_blk' : '{_obj');
          if (isBlk) scanBlockDepth++;
        }
        scanTernary[scanStack.length] = 0;
        scanColonBlk = false;
      } else if (tk0.val === ')' || tk0.val === ']' || tk0.val === '}') {
        scanTernary[scanStack.length] = 0;
        const pop = scanStack.pop();
        if ((pop === '{_blk' || pop === '{_cls') && scanBlockDepth > 0) scanBlockDepth--;
        if (tk0.val === '}') scanPendKind = '';
        scanColonBlk = false;
      } else if (tk0.val === ';') {
        scanTernary[sd] = 0;
        scanPendKind = '';
        scanColonBlk = false;
      } else {
        scanColonBlk = false;
      }
    } else {
      scanColonBlk = false;
    }

    // Single-identifier arrow `x => ...`
    if (tk0.type === 'id' && i + 1 < sig.length && sig[i + 1].val === '=>' && (!p0 || (p0.val !== '.' && p0.val !== '?.'))) {
      paramDeclTokens.add(tk0);
      if (i + 2 < sig.length && sig[i + 2].val !== '{') {
        exprArrowIndices.add(i + 1);
      }
    }
    // `catch (err) { ... }`
    if (tk0.val === '(' && p0 && p0.val === 'catch' && i + 2 < sig.length && sig[i + 1].type === 'id' && sig[i + 2].val === ')') {
      paramDeclTokens.add(sig[i + 1]);
      continue;
    }

    if (tk0.val !== '(') continue;
    const prev = p0;
    const prev2 = i > 1 ? sig[i - 2] : null;
    const isFnParams =
      (prev && prev.val === 'function') ||
      (prev && prev.type === 'id' && prev2 && prev2.val === 'function');
    let depth = 1;
    let braceDepth = 0;
    let bracketDepth = 0;
    let j = i + 1;
    const paramCandidates = [];
    const destructuredShorthands = [];
    while (j < sig.length && depth > 0) {
      const tk = sig[j];
      if (tk.type === 'lit' && tk.val.endsWith('${')) braceDepth++;
      else if (tk.val === '(') depth++;
      else if (tk.val === ')') depth--;
      else if (tk.val === '{') braceDepth++;
      else if (tk.val === '}' && braceDepth > 0) braceDepth--;
      else if (tk.val === '[') bracketDepth++;
      else if (tk.val === ']' && bracketDepth > 0) bracketDepth--;
      else if (depth === 1 && braceDepth === 0 && bracketDepth === 0 && tk.type === 'id') {
        const pPrev = sig[j - 1];
        const pNext = sig[j + 1];
        if (
          pPrev &&
          (pPrev.val === '(' || pPrev.val === ',' || pPrev.val === '...') &&
          pNext &&
          (pNext.val === ',' || pNext.val === ')' || pNext.val === '=')
        ) {
          if (tk.val.length >= 2) paramCandidates.push(tk);
        }
      } else if (depth === 1 && braceDepth === 0 && bracketDepth > 0 && tk.type === 'id') {
        // Array destructuring parameter `([a, b = 1]) => ...`
        const pPrev = sig[j - 1];
        const pNext = sig[j + 1];
        if (
          pPrev &&
          (pPrev.val === '[' || pPrev.val === ',' || pPrev.val === '...') &&
          pNext &&
          (pNext.val === ',' || pNext.val === ']' || pNext.val === '=')
        ) {
          if (tk.val.length >= 2) paramCandidates.push(tk);
        }
      } else if (depth === 1 && braceDepth > 0 && tk.type === 'id') {
        if (shorthandTokens.has(tk)) {
          if (tk.val.length >= 2) destructuredShorthands.push(tk);
        } else if (sig[j - 1] && sig[j - 1].val === '...' && sig[j + 1] && sig[j + 1].val === '}') {
          if (tk.val.length >= 2) paramCandidates.push(tk);
        }
      }
      j++;
    }
    const closeIdx = j - 1;
    const afterClose = j < sig.length ? sig[j] : null;
    if (isFnParams || (afterClose && afterClose.val === '=>')) {
      const bodyScopeDepth = scanBlockDepth + 1;
      paramOpenIndices.add(i);
      if (closeIdx > i) paramCloseIndices.add(closeIdx);
      if (afterClose && afterClose.val === '=>' && j + 1 < sig.length && sig[j + 1].val !== '{') {
        exprArrowIndices.add(j);
      }
      for (const pTk of paramCandidates) {
        paramDeclTokens.add(pTk);
        recordDecl(pTk.val, bodyScopeDepth);
      }
      for (const st of destructuredShorthands) {
        paramDeclTokens.add(st);
        recordDecl(st.val, bodyScopeDepth);
      }
    }
  }

  // Compute exact minRefScope treating parameter lists & expression-body arrows at their true inner body depth (+1)
  minRefScope.clear();
  {
    let rDepth = 0;
    let paramActive = 0;
    const rStack = [];
    const rTernary = [];
    let rColonBlk = false;
    const arrowExprStackLens = [];
    let pendKind = '';
    for (let i = 0; i < sig.length; i++) {
      const t = sig[i];
      const prev = i > 0 ? sig[i - 1] : null;
      if (t.type === 'lit' && t.val.endsWith('${')) {
        rStack.push('{_tpl');
        rTernary[rStack.length] = 0;
        rColonBlk = false;
        continue;
      }

      if (t.type === 'punc') {
        const sd = rStack.length;
        if (t.val === '?') {
          rTernary[sd] = (rTernary[sd] || 0) + 1;
          rColonBlk = false;
          continue;
        }
        if (t.val === ':') {
          if ((rTernary[sd] || 0) > 0) {
            rTernary[sd]--;
            rColonBlk = false;
          } else {
            rColonBlk = sd === 0 || rStack[sd - 1] === '{_blk';
          }
          continue;
        }
        const wasColonBlk = rColonBlk;
        rColonBlk = false;
        if (t.val === '=>' && exprArrowIndices.has(i)) {
          arrowExprStackLens.push(rStack.length);
          continue;
        }
        if (
          arrowExprStackLens.length > 0 &&
          (t.val === ';' || (t.val === ',' && rStack.length === arrowExprStackLens[arrowExprStackLens.length - 1]))
        ) {
          while (arrowExprStackLens.length > 0 && arrowExprStackLens[arrowExprStackLens.length - 1] >= rStack.length) {
            arrowExprStackLens.pop();
          }
        }
        if (t.val === '(') {
          rStack.push('(');
          rTernary[rStack.length] = 0;
          if (paramOpenIndices.has(i)) paramActive++;
        } else if (t.val === '[') {
          rStack.push('[');
          rTernary[rStack.length] = 0;
        } else if (t.val === '{') {
          if (pendKind) {
            rStack.push(pendKind);
            if (pendKind === '{_cls') rDepth++;
            pendKind = '';
          } else {
            const isBlk = !prev || BLOCK_PREV_TOKENS.has(prev.val) || wasColonBlk;
            rStack.push(isBlk ? '{_blk' : '{_obj');
            if (isBlk) rDepth++;
          }
          rTernary[rStack.length] = 0;
        } else if (t.val === ')' || t.val === ']' || t.val === '}') {
          if (t.val === ')' && paramCloseIndices.has(i) && paramActive > 0) paramActive--;
          rTernary[rStack.length] = 0;
          const pop = rStack.pop();
          if ((pop === '{_blk' || pop === '{_cls') && rDepth > 0) rDepth--;
          if (t.val === '}') pendKind = '';
          while (arrowExprStackLens.length > 0 && arrowExprStackLens[arrowExprStackLens.length - 1] > rStack.length) {
            arrowExprStackLens.pop();
          }
        } else if (t.val === ';') {
          rTernary[sd] = 0;
          pendKind = '';
        }
        continue;
      }
      rColonBlk = false;
      if (t.type !== 'id') continue;
      if (t.val === 'class') {
        pendKind = '{_cls';
        continue;
      }
      if (JS_KEYWORDS.has(t.val) || nonVarTokens.has(t) || paramDeclTokens.has(t) || unsafe.has(t.val)) continue;
      recordRef(t.val, rDepth + paramActive + arrowExprStackLens.length);
    }
  }

  // Outer-scope free-variable protection: if referenced at shallower depth than any local declaration,
  // it refers to an undeclared global/free identifier and MUST NOT be mangled!
  for (const name of declared) {
    const rDepth = minRefScope.get(name);
    const dDepth = minDeclScope.get(name);
    if (rDepth !== undefined && dDepth !== undefined && rDepth < dDepth) {
      unsafe.add(name);
    }
  }

  const existingIds = new Set(counts.keys());
  const nextShortName = createShortNameGen(existingIds, unsafe);

  const candidates = [];
  for (const name of declared) {
    if (unsafe.has(name)) continue;
    const c = counts.get(name) || 0;
    const sh = shorthandCounts.get(name) || 0;
    const estSave = (c - sh) * (name.length - 2) - sh * 3;
    if (estSave >= 3) candidates.push({ name, c, sh, estSave });
  }
  candidates.sort((a, b) => b.estSave - a.estSave);

  const renameMap = new Map();
  for (const cand of candidates) {
    const short = nextShortName();
    const realSave = (cand.c - cand.sh) * (cand.name.length - short.length) - cand.sh * (1 + short.length);
    if (realSave >= 2) {
      renameMap.set(cand.name, short);
    }
  }

  const expandedTokens = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.type === 'id' && !nonVarTokens.has(tk) && renameMap.has(tk.val)) {
      const short = renameMap.get(tk.val);
      if (shorthandTokens.has(tk)) {
        expandedTokens.push({ type: 'id', val: tk.val });
        expandedTokens.push({ type: 'punc', val: ':' });
        expandedTokens.push({ type: 'id', val: short });
      } else {
        tk.val = short;
        expandedTokens.push(tk);
      }
    } else {
      expandedTokens.push(tk);
    }
  }
  tokens = expandedTokens;

  let prevS = null;
  const nextS = new Array(tokens.length).fill(null);
  let nxt = null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    nextS[i] = nxt;
    if (tokens[i].type !== 'ws' && tokens[i].type !== 'nl') nxt = tokens[i];
  }
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.type === 'ws' || tk.type === 'nl') continue;
    if (tk.type === 'id' && tk.val === 'const') {
      if (!prevS || prevS.val !== 'export') {
        tk.val = 'let';
      }
    } else if (tk.type === 'id' && (tk.val === 'true' || tk.val === 'false' || (tk.val === 'undefined' && !declared.has('undefined')))) {
      const ns = nextS[i];
      const afterDot = prevS && (prevS.val === '.' || prevS.val === '?.');
      const beforeKey = ns && (ns.val === ':' || ns.val === '(' || ns.val === '.' || ns.val === '=');
      if (!afterDot && !beforeKey && prevS && SAFE_BOOL_PREV.has(prevS.val)) {
        tk.type = 'punc';
        tk.val = tk.val === 'true' ? '!0' : tk.val === 'false' ? '!1' : 'void 0';
      }
    }
    prevS = tk;
  }

  const ARROW_UNPAREN_PREV = new Set(['=', ',', '(', '[', '{', ':', ';', '?', '&&', '||', '??', 'return', '=>', 'async']);
  const DEC_ZERO_STRIP_PREV = new Set([
    '=', '(', '[', ',', ':', '?', '+', '-', '*', '/', '%', '<', '>', '<=', '>=', '==', '===', '!=', '!==', '&&', '||', '??',
  ]);

  // Safe token-level compaction:
  // 1) Strip trailing commas before `}` / `]` (preserving array elisions `[a,,]`)
  // 2) Strip redundant semicolons immediately before `}` (preserving empty loop/if bodies `while(c);}`)
  // 3) Merge adjacent block-level `; const/let/var b = ...` into `, b = ...`
  // 4) Unparen single-identifier arrow parameters `(x)=>` -> `x=>` & strip leading zero on decimals `0.5` -> `.5`
  {
    const nextSigTok = new Array(tokens.length).fill(null);
    const nextSigIdx = new Array(tokens.length).fill(-1);
    let nxtT = null;
    let nxtI = -1;
    for (let i = tokens.length - 1; i >= 0; i--) {
      nextSigTok[i] = nxtT;
      nextSigIdx[i] = nxtI;
      if (tokens[i].type !== 'ws' && tokens[i].type !== 'nl') {
        nxtT = tokens[i];
        nxtI = i;
      }
    }

    const cStack = [];
    const cTernary = [];
    let cColonBlk = false;
    const activeDeclByDepth = new Map();
    let pendCls = '';
    let prevSigTok = null;
    let hadNL = false;
    const dropIdx = new Set();

    for (let i = 0; i < tokens.length; i++) {
      if (dropIdx.has(i)) continue;
      const tk = tokens[i];
      if (tk.type === 'ws') continue;
      if (tk.type === 'nl') {
        hadNL = true;
        continue;
      }

      // Cross-token leading-zero decimal strip: `'0' + '.' + digits` -> `'.' + digits`
      if (
        tk.type === 'lit' &&
        tk.val === '0' &&
        prevSigTok &&
        DEC_ZERO_STRIP_PREV.has(prevSigTok.val) &&
        i + 2 < tokens.length &&
        tokens[i + 1].type === 'punc' &&
        tokens[i + 1].val === '.' &&
        tokens[i + 2].type === 'lit' &&
        /^[0-9]+(?:[eE])?$/.test(tokens[i + 2].val)
      ) {
        dropIdx.add(i);
        continue;
      }

      if (
        tk.type === 'punc' &&
        tk.val === '(' &&
        (!prevSigTok || ARROW_UNPAREN_PREV.has(prevSigTok.val))
      ) {
        const idTok = nextSigTok[i];
        const idIdx = nextSigIdx[i];
        if (idTok && idTok.type === 'id' && !JS_KEYWORDS.has(idTok.val)) {
          const closeTok = nextSigTok[idIdx];
          const closeIdx = nextSigIdx[idIdx];
          if (closeTok && closeTok.val === ')') {
            const arrowTok = nextSigTok[closeIdx];
            if (arrowTok && arrowTok.val === '=>') {
              dropIdx.add(i);
              dropIdx.add(closeIdx);
              continue;
            }
          }
        }
      }

      const curDepth = cStack.length;
      const curTop = curDepth > 0 ? cStack[curDepth - 1] : '{_blk';

      // If an ASI-capable newline occurred at current declaration depth, reset active `let`/`var` merge state
      if (hadNL && prevSigTok && activeDeclByDepth.get(curDepth)) {
        const prevVal = prevSigTok.val;
        const pCh = prevVal[prevVal.length - 1];
        const nCh = tk.val[0];
        const safeNL =
          SAFE_PREV_NO_ASI.has(pCh) ||
          SAFE_NEXT_NO_ASI.has(nCh) ||
          prevVal === '=>' ||
          prevVal === '&&' ||
          prevVal === '||' ||
          prevVal === '??' ||
          ((pCh === '+' || pCh === '-') && prevVal !== '++' && prevVal !== '--');
        if (!safeNL) activeDeclByDepth.set(curDepth, '');
      }
      hadNL = false;

      if (tk.type === 'lit' && tk.val.endsWith('${')) {
        cStack.push('{_tpl');
        cTernary[cStack.length] = 0;
        cColonBlk = false;
        prevSigTok = tk;
        continue;
      }

      if (tk.type === 'id' && tk.val === 'class') pendCls = '{_cls';

      if (tk.type === 'punc') {
        if (tk.val === '?') {
          cTernary[curDepth] = (cTernary[curDepth] || 0) + 1;
          cColonBlk = false;
          prevSigTok = tk;
          continue;
        }
        if (tk.val === ':') {
          if ((cTernary[curDepth] || 0) > 0) {
            cTernary[curDepth]--;
            cColonBlk = false;
          } else {
            cColonBlk = curTop === '{_blk';
          }
          prevSigTok = tk;
          continue;
        }
        const wasColonBlk = cColonBlk;
        cColonBlk = false;

        if (tk.val === '(' || tk.val === '[') {
          cStack.push(tk.val);
          cTernary[cStack.length] = 0;
          prevSigTok = tk;
          continue;
        }
        if (tk.val === '{') {
          if (pendCls) {
            cStack.push(pendCls);
            pendCls = '';
          } else {
            const isBlk = !prevSigTok || BLOCK_PREV_TOKENS.has(prevSigTok.val) || wasColonBlk;
            cStack.push(isBlk ? '{_blk' : '{_obj');
          }
          cTernary[cStack.length] = 0;
          activeDeclByDepth.set(cStack.length, '');
          prevSigTok = tk;
          continue;
        }
        if (tk.val === ')' || tk.val === ']' || tk.val === '}') {
          cTernary[cStack.length] = 0;
          activeDeclByDepth.delete(cStack.length);
          const popped = cStack.pop();
          if (tk.val === '}' && popped === '{_cls') activeDeclByDepth.set(cStack.length, '');
          pendCls = '';
          prevSigTok = tk;
          continue;
        }

        const ns = nextSigTok[i];
        const nsIdx = nextSigIdx[i];

        // Trailing comma before `}` or `]`
        if (
          tk.val === ',' &&
          ns &&
          (ns.val === '}' || (ns.val === ']' && prevSigTok && prevSigTok.val !== ',' && prevSigTok.val !== '['))
        ) {
          dropIdx.add(i);
          continue;
        }

        // Consecutive block-level `; const x`, `; let x`, or `; var x` -> `, x`
        if (tk.val === ';' && (curTop === '{_blk' || curDepth === 0)) {
          const activeKw = activeDeclByDepth.get(curDepth);
          if (activeKw && ns && ns.type === 'id' && ns.val === activeKw) {
            const afterKw = nextSigTok[nsIdx];
            if (
              afterKw &&
              ((afterKw.type === 'id' && !JS_KEYWORDS.has(afterKw.val)) ||
                afterKw.val === '{' ||
                afterKw.val === '[')
            ) {
              tk.val = ',';
              dropIdx.add(nsIdx);
              prevSigTok = tk;
              continue;
            }
          }
          activeDeclByDepth.set(curDepth, '');
        }

        // Redundant `;` immediately before `}` (excluding `while(c);}` where prevSigTok is `)` or `do` or `;` or `{` or `:`)
        if (
          tk.val === ';' &&
          ns &&
          ns.val === '}' &&
          prevSigTok &&
          prevSigTok.val !== ')' &&
          prevSigTok.val !== '{' &&
          prevSigTok.val !== ';' &&
          prevSigTok.val !== ':' &&
          prevSigTok.val !== 'do'
        ) {
          dropIdx.add(i);
          continue;
        }
      }

      if (
        tk.type === 'id' &&
        (tk.val === 'const' || tk.val === 'let' || tk.val === 'var') &&
        (curTop === '{_blk' || curDepth === 0) &&
        (!prevSigTok || prevSigTok.val === '{' || prevSigTok.val === ';' || prevSigTok.val === '}')
      ) {
        const afterKw = nextSigTok[i];
        if (
          afterKw &&
          ((afterKw.type === 'id' && !JS_KEYWORDS.has(afterKw.val)) ||
            afterKw.val === '{' ||
            afterKw.val === '[')
        ) {
          activeDeclByDepth.set(curDepth, tk.val);
        }
      }

      prevSigTok = tk;
    }

    if (dropIdx.size > 0) {
      const compacted = [];
      for (let i = 0; i < tokens.length; i++) {
        if (!dropIdx.has(i)) compacted.push(tokens[i]);
      }
      tokens = compacted;
    }
  }

  return tokens;
}

const SAFE_STMT_START_KW = new Set([
  'const', 'let', 'var', 'function', 'if', 'for', 'while', 'return',
  'try', 'catch', 'finally', 'else', 'switch', 'case', 'default',
  'delete', 'throw', 'break', 'continue',
]);

function serializeTokens(tokens) {
  const out = [];
  let lastCh = '';
  let lastTokenVal = '';
  let pendingNL = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'ws') continue;
    if (t.type === 'nl') {
      pendingNL = true;
      continue;
    }
    const val = t.val;
    if (!val) continue;
    const nextCh = val[0];
    if (lastCh) {
      if (pendingNL) {
        const safeDropNL =
          SAFE_PREV_NO_ASI.has(lastCh) ||
          SAFE_NEXT_NO_ASI.has(nextCh) ||
          lastTokenVal === '=>' ||
          lastTokenVal === '&&' ||
          lastTokenVal === '||' ||
          lastTokenVal === '??' ||
          (lastCh === '}' && SAFE_STMT_START_KW.has(val)) ||
          ((lastCh === '+' || lastCh === '-') && lastTokenVal !== '++' && lastTokenVal !== '--');
        if (!safeDropNL) {
          out.push('\n');
          lastCh = '\n';
        } else if (needsSpace(lastCh, nextCh)) {
          out.push(' ');
          lastCh = ' ';
        }
      } else if (needsSpace(lastCh, nextCh)) {
        out.push(' ');
        lastCh = ' ';
      }
    }
    pendingNL = false;
    out.push(val);
    lastCh = val[val.length - 1];
    lastTokenVal = val;
  }
  return out.join('').trim();
}

function decodeSimpleJsString(lit) {
  if (!lit || lit.length < 2) return null;
  const q = lit[0];
  if ((q !== "'" && q !== '"') || lit[lit.length - 1] !== q) return null;
  let out = '';
  for (let i = 1; i < lit.length - 1; i++) {
    const c = lit[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    i++;
    if (i >= lit.length - 1) return null;
    const e = lit[i];
    if (e === 'n') out += '\n';
    else if (e === 'r') out += '\r';
    else if (e === 't') out += '\t';
    else if (e === '\\' || e === "'" || e === '"') out += e;
    else if (e === '0' && !/[0-9]/.test(lit[i + 1] || '')) out += '\0';
    else if (e === 'x' && /^[0-9a-fA-F]{2}/.test(lit.slice(i + 1, i + 3))) {
      out += String.fromCharCode(parseInt(lit.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (e === 'u' && lit[i + 1] === '{') {
      const closeBrace = lit.indexOf('}', i + 2);
      if (closeBrace < 0 || closeBrace >= lit.length - 1) return null;
      const hex = lit.slice(i + 2, closeBrace);
      if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) return null;
      const cp = parseInt(hex, 16);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
      out += String.fromCodePoint(cp);
      i = closeBrace;
    } else if (e === 'u' && /^[0-9a-fA-F]{4}/.test(lit.slice(i + 1, i + 5))) {
      const code = parseInt(lit.slice(i + 1, i + 5), 16);
      if (code >= 0xd800 && code <= 0xdbff) {
        if (lit.slice(i + 5, i + 7) === '\\u' && /^[0-9a-fA-F]{4}/.test(lit.slice(i + 7, i + 11))) {
          const low = parseInt(lit.slice(i + 7, i + 11), 16);
          if (low >= 0xdc00 && low <= 0xdfff) {
            out += String.fromCharCode(code, low);
            i += 10;
            continue;
          }
        }
        return null;
      }
      if (code >= 0xdc00 && code <= 0xdfff) return null;
      out += String.fromCharCode(code);
      i += 4;
    } else {
      return null;
    }
  }
  return out;
}

function hasLoneUtf16Surrogate(strVal) {
  for (let k = 0; k < strVal.length; k++) {
    const cc = strVal.charCodeAt(k);
    if (cc >= 0xd800 && cc <= 0xdbff) {
      const nx2 = strVal.charCodeAt(k + 1);
      if (nx2 >= 0xdc00 && nx2 <= 0xdfff) {
        k++;
        continue;
      }
      return true;
    }
    if (cc >= 0xdc00 && cc <= 0xdfff) return true;
  }
  return false;
}

function decodeSimpleTemplateBody(body) {
  let out = '';
  const n = body.length;
  for (let i = 0; i < n; i++) {
    const c = body[i];
    if (c === '\r') {
      out += '\n';
      if (body[i + 1] === '\n') i++;
      continue;
    }
    if (c !== '\\') {
      out += c;
      continue;
    }
    i++;
    if (i >= n) return null;
    const e = body[i];
    if (e === 'n') out += '\n';
    else if (e === 'r') out += '\r';
    else if (e === 't') out += '\t';
    else if (e === '\\' || e === '`' || e === '$' || e === "'" || e === '"') out += e;
    else if (e === '\n') continue;
    else if (e === '\r') {
      if (body[i + 1] === '\n') i++;
      continue;
    } else if (e === '0' && !/[0-9]/.test(body[i + 1] || '')) out += '\0';
    else if (e === 'x' && /^[0-9a-fA-F]{2}/.test(body.slice(i + 1, i + 3))) {
      out += String.fromCharCode(parseInt(body.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (e === 'u' && body[i + 1] === '{') {
      const closeBrace = body.indexOf('}', i + 2);
      if (closeBrace < 0) return null;
      const hex = body.slice(i + 2, closeBrace);
      if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) return null;
      const cp = parseInt(hex, 16);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
      out += String.fromCodePoint(cp);
      i = closeBrace;
    } else if (e === 'u' && /^[0-9a-fA-F]{4}/.test(body.slice(i + 1, i + 5))) {
      const code = parseInt(body.slice(i + 1, i + 5), 16);
      if (code >= 0xd800 && code <= 0xdfff) return null;
      out += String.fromCharCode(code);
      i += 4;
    } else {
      return null;
    }
  }
  return out;
}

function packTextJsExpr(text, maxDict = 5200) {
  const usedInText = new Set();
  for (let i = 0; i < text.length; i++) {
    const cc = text.charCodeAt(i);
    if ((cc >= 0x00a1 && cc <= 0x17ff) || (cc >= 0xe010 && cc <= 0xf8ff)) usedInText.add(cc);
  }
  const freeTokens = [];
  let contiguous = true;
  const contLimit = Math.min(0x17ff, 0x0100 + maxDict - 1);
  for (let cc = 0x0100; cc <= contLimit; cc++) {
    if (usedInText.has(cc)) {
      contiguous = false;
      break;
    }
  }
  if (contiguous) {
    for (let cc = 0x0100; cc <= contLimit && freeTokens.length < maxDict; cc++) {
      freeTokens.push(String.fromCharCode(cc));
    }
  } else {
    // Fill 2-byte UTF-8 slots first (0x00A1..0x07FF), then BMP Private Use Area 3-byte slots (0xE010..0xF8FF)
    for (let cc = 0x00a1; cc <= 0x07ff && freeTokens.length < maxDict; cc++) {
      if (cc === 0x00ad) continue;
      if (!usedInText.has(cc)) freeTokens.push(String.fromCharCode(cc));
    }
    for (let cc = 0xe010; cc <= 0xf8ff && freeTokens.length < maxDict; cc++) {
      if (!usedInText.has(cc)) freeTokens.push(String.fromCharCode(cc));
    }
  }
  if (freeTokens.length < 16) return serializeJsValue(text);

  const TOKEN_BASE = 0x0100;
  let work = text;
  const dict = [];
  const tokChars = [];

  const wordRe = /[A-Za-z0-9_.#\-:;()=,{}\[\]\/ <>"']{4,56}/g;
  for (let round = 0; round < 6 && dict.length < Math.min(1400, freeTokens.length); round++) {
    const freq = new Map();
    const matches = work.match(wordRe);
    if (!matches) break;
    for (let m = 0; m < matches.length; m++) {
      freq.set(matches[m], (freq.get(matches[m]) || 0) + 1);
    }
    const res = applyBatchPhraseReplacements(work, freq, freeTokens, dict, tokChars, contiguous, 5, 240, 0);
    work = res.work;
    if (res.added < 6) break;
  }

  for (const winLen of [36, 24, 16, 11, 8, 6, 4, 3, 2]) {
    const maxPasses = winLen <= 4 ? 2 : 1;
    for (let pass = 0; pass < maxPasses && dict.length < freeTokens.length; pass++) {
      const freq = collectWindowFrequencies(work, winLen, false);
      const res = applyBatchPhraseReplacements(work, freq, freeTokens, dict, tokChars, contiguous, 4, 360, winLen);
      work = res.work;
      if (res.added < 6) break;
    }
  }

  const rawExpr = serializeJsValue(text);
  if (dict.length === 0) return rawExpr;

  let packed = '';
  if (contiguous) {
    const maxHex = (TOKEN_BASE + dict.length - 1).toString(16).padStart(4, '0');
    const decRe = new RegExp(`[\\u0100-\\u${maxHex}]`, 'g');
    let verify = work;
    for (let f = 1, guard = 0; f && guard < 32; guard++) {
      f = 0;
      verify = verify.replace(decRe, (c) => {
        f = 1;
        return dict[c.charCodeAt(0) - TOKEN_BASE];
      });
    }
    if (verify !== text) return rawExpr;
    packed = `(()=>{let s=${serializeJsValue(work)},d=${serializeJsValue(dict)};for(let f=1;f;)f=0,s=s.replace(/[\\u0100-\\u${maxHex}]/g,(c)=>(f=1,d[c.charCodeAt(0)-${TOKEN_BASE}]));return s})()`;
  } else {
    const decMap = new Map();
    for (let i = 0; i < dict.length; i++) decMap.set(tokChars[i], dict[i]);
    const decRe = /[\u00A1-\u07FF\uE010-\uF8FF]/g;
    let verify = work;
    for (let f = 1, guard = 0; f && guard < 32; guard++) {
      f = 0;
      verify = verify.replace(decRe, (c) => {
        const v = decMap.get(c);
        if (v === undefined) return c;
        f = 1;
        return v;
      });
    }
    if (verify !== text) return rawExpr;
    packed = `(()=>{let s=${serializeJsValue(work)},k=${serializeJsValue(tokChars.join(''))},d=${serializeJsValue(dict)},m=new Map(Array.from(k,(c,i)=>[c,d[i]]));for(let f=1;f;)f=0,s=s.replace(/[\\u00A1-\\u07FF\\uE010-\\uF8FF]/g,(c)=>{let v=m.get(c);return v===void 0?c:(f=1,v)});return s})()`;
  }
  return Buffer.byteLength(packed, 'utf8') + 12 < Buffer.byteLength(rawExpr, 'utf8') ? packed : rawExpr;
}

// Collect poolable string literals & high-frequency member property accesses from a mangled token stream
function scanModulePoolCandidates(tokens, allowMemberProps = false) {
  const prevSig = new Array(tokens.length).fill(null);
  const prev2Sig = new Array(tokens.length).fill(null);
  const nextSig = new Array(tokens.length).fill(null);
  let last = null;
  let last2 = null;
  for (let i = 0; i < tokens.length; i++) {
    prevSig[i] = last;
    prev2Sig[i] = last2;
    if (tokens[i].type !== 'ws' && tokens[i].type !== 'nl') {
      last2 = last;
      last = tokens[i];
    }
  }
  last = null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    nextSig[i] = last;
    if (tokens[i].type !== 'ws' && tokens[i].type !== 'nl') last = tokens[i];
  }

  const SEP = '\x7f';
  const occurrences = new Map();

  const addOcc = (strVal, kind, startIdx, endIdx, origBytes) => {
    if (!occurrences.has(strVal)) occurrences.set(strVal, []);
    occurrences.get(strVal).push({ kind, startIdx, endIdx, origBytes });
  };

  // Pre-pair brackets so rvalue object literals `{ key: expr }` can be distinguished from destructuring patterns
  const closeIdxByOpen = new Int32Array(tokens.length).fill(-1);
  if (allowMemberProps) {
    const pairStack = [];
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      if (tk.type === 'lit' && tk.val.endsWith('${')) {
        pairStack.push(i);
      } else if (tk.type === 'punc') {
        if (tk.val === '(' || tk.val === '[' || tk.val === '{') {
          pairStack.push(i);
        } else if ((tk.val === ')' || tk.val === ']' || tk.val === '}') && pairStack.length > 0) {
          closeIdxByOpen[pairStack.pop()] = i;
        }
      }
    }
  }

  const ctxStack = [];
  const ctxTernary = [];
  let pendingClsBrace = false;
  let prevColonBlock = false;
  const inDestructOrParams = () => {
    for (let k = ctxStack.length - 1; k >= 0; k--) {
      if (ctxStack[k] === '{_blk' || ctxStack[k] === '{_cls') return false;
      if (ctxStack[k] === '{_pat' || ctxStack[k] === '(_params' || ctxStack[k] === '[_pat') return true;
    }
    return false;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'ws' || t.type === 'nl') continue;

    if (allowMemberProps) {
      if (t.type === 'lit' && t.val.endsWith('${')) {
        ctxStack.push('{_tpl');
        ctxTernary[ctxStack.length] = 0;
        prevColonBlock = false;
        continue;
      }
      if (t.type === 'punc') {
        const d = ctxStack.length;
        if (t.val === '?') {
          ctxTernary[d] = (ctxTernary[d] || 0) + 1;
          prevColonBlock = false;
          continue;
        }
        if (t.val === ':') {
          if ((ctxTernary[d] || 0) > 0) {
            ctxTernary[d]--;
            prevColonBlock = false;
          } else {
            prevColonBlock = d === 0 || ctxStack[d - 1] === '{_blk';
          }
          continue;
        }
        const wasColonBlk = prevColonBlock;
        prevColonBlock = false;
        if (t.val === '(') {
          const p = prevSig[i];
          const cIdx = closeIdxByOpen[i];
          const afterClose = cIdx >= 0 ? nextSig[cIdx] : null;
          const isParams =
            (p && (p.val === 'function' || p.val === '*' || p.val === 'catch')) ||
            Boolean(afterClose && afterClose.val === '=>');
          ctxStack.push(isParams ? '(_params' : '(');
          ctxTernary[ctxStack.length] = 0;
          continue;
        }
        if (t.val === '[') {
          const cIdx = closeIdxByOpen[i];
          const afterClose = cIdx >= 0 ? nextSig[cIdx] : null;
          const isPat =
            inDestructOrParams() ||
            Boolean(afterClose && (afterClose.val === '=' || afterClose.val === 'of' || afterClose.val === 'in'));
          ctxStack.push(isPat ? '[_pat' : '[');
          ctxTernary[ctxStack.length] = 0;
          continue;
        }
        if (t.val === '{') {
          const p = prevSig[i];
          if (pendingClsBrace) {
            ctxStack.push('{_cls');
            pendingClsBrace = false;
          } else {
            const isBlk = !p || BLOCK_PREV_TOKENS.has(p.val) || wasColonBlk;
            if (isBlk) {
              ctxStack.push('{_blk');
            } else {
              const cIdx = closeIdxByOpen[i];
              const afterClose = cIdx >= 0 ? nextSig[cIdx] : null;
              const isPat =
                inDestructOrParams() ||
                Boolean(p && (p.val === 'const' || p.val === 'let' || p.val === 'var')) ||
                Boolean(afterClose && (afterClose.val === '=' || afterClose.val === 'of' || afterClose.val === 'in'));
              ctxStack.push(isPat ? '{_pat' : '{_obj');
            }
          }
          ctxTernary[ctxStack.length] = 0;
          continue;
        }
        if (t.val === ')' || t.val === ']' || t.val === '}') {
          ctxTernary[ctxStack.length] = 0;
          ctxStack.pop();
          if (t.val === '}') pendingClsBrace = false;
          continue;
        }
        if (t.val === ';') {
          ctxTernary[d] = 0;
          pendingClsBrace = false;
        }
        continue;
      }
      prevColonBlock = false;
      if (t.type === 'id' && t.val === 'class') {
        const p = prevSig[i];
        if (!p || (p.val !== '.' && p.val !== '?.')) pendingClsBrace = true;
      }
    }

    const curCtxTop = ctxStack.length > 0 ? ctxStack[ctxStack.length - 1] : '';

    // Safe member property access pooling (`.getAttribute` / `.max` -> `[p]`, `?.getAttribute` -> `?.[p]`)
    // & rvalue object literal key pooling (`{ trajectoryMetadata: x }` -> `{ [p]: x }`)
    if (allowMemberProps && t.type === 'id' && t.val.length >= 3 && !t.val.startsWith('__ag')) {
      const p = prevSig[i];
      const p2 = prev2Sig[i];
      const nx = nextSig[i];
      const afterNumericDot = p2 && p2.type === 'lit' && /^[0-9]/.test(p2.val);
      if (
        !afterNumericDot &&
        p &&
        (p.val === '.' || (p.val === '?.' && t.val.length >= 4)) &&
        (!p2 || (p2.val !== 'super' && p2.val !== 'new' && p2.val !== 'import')) &&
        /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t.val) &&
        !PROTECTED_BUNDLE_LITERALS.some((sub) => t.val.includes(sub))
      ) {
        let dotIdx = i - 1;
        while (dotIdx >= 0 && (tokens[dotIdx].type === 'ws' || tokens[dotIdx].type === 'nl')) dotIdx--;
        if (dotIdx >= 0 && tokens[dotIdx] === p) {
          if (p.val === '.') {
            addOcc(t.val, 'dotProp', dotIdx, i, 1 + t.val.length);
          } else {
            addOcc(t.val, 'optProp', i, i, t.val.length);
          }
        }
      } else if (
        curCtxTop === '{_obj' &&
        t.val.length >= 4 &&
        t.val !== '__proto__' &&
        p &&
        (p.val === '{' || p.val === ',') &&
        nx &&
        nx.val === ':' &&
        /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t.val) &&
        !PROTECTED_BUNDLE_LITERALS.some((sub) => t.val.includes(sub))
      ) {
        addOcc(t.val, 'optProp', i, i, t.val.length);
      }
      continue;
    }

    if (t.type !== 'lit') continue;
    let strVal = null;
    let endIdx = i;
    if (t.val[0] === "'" || t.val[0] === '"') {
      strVal = decodeSimpleJsString(t.val);
    } else if (t.val === '`' && i + 1 < tokens.length && tokens[i + 1].type === 'lit' && tokens[i + 1].val.endsWith('`')) {
      const p = prevSig[i];
      const canBeTagged =
        p &&
        (p.type === 'id' ||
          p.val === ')' ||
          p.val === ']' ||
          p.val === '}' ||
          p.val.endsWith("'") ||
          p.val.endsWith('"') ||
          p.val.endsWith('`'));
      if (!canBeTagged || (p && JS_KEYWORDS.has(p.val) && p.val !== 'this' && p.val !== 'super')) {
        const body = tokens[i + 1].val.slice(0, -1);
        if (!body.includes('${')) {
          strVal = decodeSimpleTemplateBody(body);
          if (strVal !== null) endIdx = i + 1;
        }
      }
    }
    if (strVal === null || strVal === 'use strict' || strVal.includes(SEP)) continue;
    const valBytes = Buffer.byteLength(strVal, 'utf8');
    if (valBytes < 3) continue;
    if (hasLoneUtf16Surrogate(strVal)) continue;
    if (PROTECTED_BUNDLE_LITERALS.some((sub) => strVal.includes(sub))) continue;

    const p = prevSig[i];
    const nx = nextSig[endIdx];
    if (nx && nx.val === ':') {
      if (
        allowMemberProps &&
        endIdx === i &&
        curCtxTop === '{_obj' &&
        valBytes >= 5 &&
        strVal !== '__proto__' &&
        p &&
        (p.val === '{' || p.val === ',')
      ) {
        addOcc(strVal, 'optProp', i, i, Buffer.byteLength(t.val, 'utf8'));
      }
      if (!p || p.val !== 'case') continue;
    }
    if (nx && nx.val === '(') continue;
    // Exempt class string-named fields/getters: `class A { 'foo' = 1; static 'bar' = 2; get 'baz'(){} }`
    if (nx && (nx.val === '=' || nx.val === ';') && p && (p.val === '{' || p.val === ';' || p.val === '}' || p.val === 'static')) {
      continue;
    }
    if (p && (p.val === 'import' || p.val === 'from' || p.val === 'get' || p.val === 'set' || p.val === 'async')) continue;

    let origBytes = Buffer.byteLength(t.val, 'utf8');
    if (endIdx > i) origBytes += Buffer.byteLength(tokens[endIdx].val, 'utf8');
    addOcc(strVal, 'str', i, endIdx, origBytes);
    i = endIdx;
  }

  return occurrences;
}

const SAFE_ALIAS_GLOBALS = new Set([
  'Math',
  'Number',
  'Boolean',
  'String',
  'Array',
  'Object',
  'JSON',
  'Promise',
  'Map',
  'Set',
  'WeakMap',
  'RegExp',
  'Error',
  'Date',
  'Uint8Array',
  'Uint16Array',
  'Int32Array',
  'Float32Array',
  'globalThis',
  'parseFloat',
  'parseInt',
  'isFinite',
  'encodeURIComponent',
  'decodeURIComponent',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
]);

function applyModulePoolReplacements(tokens, selectedEntries, headerBuilder) {
  if (selectedEntries.length === 0) return serializeTokens(tokens);

  const usedIds = new Set();
  for (const tk of tokens) {
    if (tk.type === 'id') usedIds.add(tk.val);
  }
  const nextVar = createShortNameGen(usedIds, RESERVED_OR_GLOBAL);
  const activeItems = [];
  let stagedVar = nextVar();

  for (const entry of selectedEntries) {
    const varName = stagedVar;
    let origSum = 0;
    let replSum = 0;
    for (const occ of entry.list) {
      origSum += occ.origBytes;
      replSum += occ.kind === 'str' ? varName.length : varName.length + 2;
    }
    const idxBytes =
      entry.poolIdx !== undefined
        ? entry.poolIdx < 1792
          ? 2
          : entry.poolIdx < 7936
          ? 3
          : 4
        : 2;
    const bindingOverhead = varName.length + 1 + idxBytes;
    if (origSum > replSum + bindingOverhead) {
      activeItems.push({ ...entry, varName });
      stagedVar = nextVar();
    }
  }

  if (activeItems.length === 0) return serializeTokens(tokens);

  // Safe per-module constant aliases for high-frequency guaranteed JS globals (e.g. `Math`, `Number`, `Boolean`)
  const prevSig = new Array(tokens.length).fill(null);
  const nextSig = new Array(tokens.length).fill(null);
  let last = null;
  for (let i = 0; i < tokens.length; i++) {
    prevSig[i] = last;
    if (tokens[i].type !== 'ws' && tokens[i].type !== 'nl') last = tokens[i];
  }
  last = null;
  for (let i = tokens.length - 1; i >= 0; i--) {
    nextSig[i] = last;
    if (tokens[i].type !== 'ws' && tokens[i].type !== 'nl') last = tokens[i];
  }

  const globalPositions = new Map();
  const poisonedGlobals = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.type !== 'id' || !SAFE_ALIAS_GLOBALS.has(tk.val)) continue;
    const p = prevSig[i];
    const nx = nextSig[i];
    if (p && (p.val === '.' || p.val === '?.' || p.val === 'function')) continue;
    if (nx && nx.val === ':') continue;
    if (
      (p &&
        (p.val === 'let' ||
          p.val === 'const' ||
          p.val === 'var' ||
          p.val === 'typeof' ||
          p.val === '++' ||
          p.val === '--' ||
          p.val === '...' ||
          p.val === '[' ||
          p.val === '(')) ||
      (nx && (nx.val === '=' || nx.val === '=>' || nx.val === '++' || nx.val === '--' || nx.val === ',' || nx.val === '}'))
    ) {
      if (p && (p.val === '{' || p.val === ',' || p.val === '[' || p.val === '(')) {
        // Check if `p.val === '('` is a normal call `fn(Math)` vs parameter `(Math) =>` / `function f(Math)` / `catch (Error)`
        if (p.val === '(' && nx && nx.val === ')' && i >= 2) {
          let prevBeforeParen = null;
          for (let k = i - 1; k >= 0; k--) {
            if (tokens[k].type === 'ws' || tokens[k].type === 'nl') continue;
            if (tokens[k] === p) {
              for (let m = k - 1; m >= 0; m--) {
                if (tokens[m].type !== 'ws' && tokens[m].type !== 'nl') {
                  prevBeforeParen = tokens[m];
                  break;
                }
              }
              break;
            }
          }
          const isParamList =
            (prevBeforeParen && (prevBeforeParen.val === 'function' || prevBeforeParen.val === 'catch' || prevBeforeParen.val === 'async')) ||
            Boolean(nextSig[i + 1] && nextSig[i + 1].val === '=>');
          if (!isParamList) {
            if (!globalPositions.has(tk.val)) globalPositions.set(tk.val, []);
            globalPositions.get(tk.val).push(i);
            continue;
          }
        }
        poisonedGlobals.add(tk.val);
        continue;
      }
      if (!nx || (nx.val !== ',' && nx.val !== '}')) {
        poisonedGlobals.add(tk.val);
        continue;
      }
    }
    if (!globalPositions.has(tk.val)) globalPositions.set(tk.val, []);
    globalPositions.get(tk.val).push(i);
  }

  const globalAliasDecls = [];
  const globalReplaceAt = new Map();
  for (const [gName, idxs] of globalPositions.entries()) {
    if (poisonedGlobals.has(gName) || idxs.length < 3) continue;
    const alias = nextVar();
    const save = idxs.length * (gName.length - alias.length) - (alias.length + 1 + gName.length + 1);
    if (save >= 8) {
      globalAliasDecls.push(`${alias}=${gName}`);
      for (const pos of idxs) globalReplaceAt.set(pos, alias);
    }
  }

  const replaceAt = new Map();
  for (const item of activeItems) {
    for (const occ of item.list) {
      replaceAt.set(occ.startIdx, { endIdx: occ.endIdx, kind: occ.kind, ref: item.varName });
    }
  }

  const newTokens = [];
  for (let i = 0; i < tokens.length; i++) {
    const rep = replaceAt.get(i);
    if (rep) {
      if (rep.kind === 'str') {
        newTokens.push({ type: 'id', val: rep.ref });
      } else {
        newTokens.push({ type: 'punc', val: '[' });
        newTokens.push({ type: 'id', val: rep.ref });
        newTokens.push({ type: 'punc', val: ']' });
      }
      i = rep.endIdx;
    } else if (globalReplaceAt.has(i)) {
      newTokens.push({ type: 'id', val: globalReplaceAt.get(i) });
    } else {
      newTokens.push(tokens[i]);
    }
  }

  const aliasPrefix = globalAliasDecls.length > 0 ? `let ${globalAliasDecls.join(',')};` : '';
  const bodyCode = aliasPrefix + serializeTokens(newTokens);
  return headerBuilder(activeItems, bodyCode);
}

function internAndPackModuleStrings(tokens) {
  const SEP = '\x7f';
  const occurrences = scanModulePoolCandidates(tokens, true);
  const selected = [];
  for (const [strVal, list] of occurrences.entries()) {
    const valBytes = Buffer.byteLength(strVal, 'utf8');
    const count = list.length;
    const totalOrig = list.reduce((s, x) => s + x.origBytes, 0);
    const hasStrLit = list.some((x) => x.kind === 'str');
    if ((count >= 2 && totalOrig > valBytes + 8 + count * 4) || (hasStrLit && valBytes >= 14)) {
      selected.push({ strVal, list, totalOrig });
    }
  }
  if (selected.length < 1) return null;
  selected.sort((a, b) => b.list.length - a.list.length || b.totalOrig - a.totalOrig);

  return applyModulePoolReplacements(tokens, selected, (activeItems, bodyCode) => {
    const varNames = activeItems.map((x) => x.varName);
    const joined = activeItems.map((x) => x.strVal).join(SEP);
    const packedExpr = packTextJsExpr(joined, 760);
    return `{const[${varNames.join(',')}]=${packedExpr}.split(${JSON.stringify(SEP)});${bodyCode}}`;
  });
}

function compactStaticStringArrayMap(src, constName) {
  const marker = `const ${constName} = {`;
  const start = src.indexOf(marker);
  if (start < 0) return src;
  let i = start + marker.length - 1;
  let depth = 0;
  let end = -1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
    i++;
  }
  if (end < 0) return src;
  const rawBlock = src.slice(start + `const ${constName} = `.length, end);
  let p = 0;
  const n = rawBlock.length;
  const skipWS = () => {
    while (p < n) {
      if (/\s/.test(rawBlock[p])) { p++; continue; }
      if (rawBlock[p] === '/' && rawBlock[p + 1] === '/') {
        while (p < n && rawBlock[p] !== '\n') p++;
        continue;
      }
      if (rawBlock[p] === '/' && rawBlock[p + 1] === '*') {
        p += 2;
        while (p < n && !(rawBlock[p] === '*' && rawBlock[p + 1] === '/')) p++;
        p += 2;
        continue;
      }
      break;
    }
  };
  const readStr = () => {
    const q = rawBlock[p];
    if (q !== "'" && q !== '"') return null;
    p++;
    let s = '';
    while (p < n) {
      const c = rawBlock[p++];
      if (c === q) return s;
      if (c === '\\') {
        const e = rawBlock[p++];
        if (e === 'n') s += '\n';
        else if (e === 'r') s += '\r';
        else if (e === 't') s += '\t';
        else if (e === '\\' || e === "'" || e === '"') s += e;
        else return null;
      } else {
        s += c;
      }
    }
    return null;
  };
  skipWS();
  if (rawBlock[p++] !== '{') return src;
  const rows = [];
  while (p < n) {
    skipWS();
    if (rawBlock[p] === '}') { p++; break; }
    let key = null;
    if (rawBlock[p] === "'" || rawBlock[p] === '"') key = readStr();
    else {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(rawBlock.slice(p));
      if (!m) return src;
      key = m[0];
      p += key.length;
    }
    if (!key || key.includes('\t') || key.includes('\n')) return src;
    skipWS();
    if (rawBlock[p++] !== ':') return src;
    skipWS();
    if (rawBlock[p++] !== '[') return src;
    const arr = [key];
    while (p < n) {
      skipWS();
      if (rawBlock[p] === ']') { p++; break; }
      const item = readStr();
      if (item === null || item.includes('\t') || item.includes('\n')) return src;
      arr.push(item);
      skipWS();
      if (rawBlock[p] === ',') p++;
    }
    rows.push(arr.join('\t'));
    skipWS();
    if (rawBlock[p] === ',') p++;
  }
  let afterEnd = end;
  while (afterEnd < src.length && (src[afterEnd] === ' ' || src[afterEnd] === '\t')) afterEnd++;
  if (src[afterEnd] === ';') afterEnd++;
  const tableBlob = JSON.stringify(rows.join('\n'));
  const replacement = `const ${constName} = Object.fromEntries(${tableBlob}.split("\\n").map((r) => { const a = r.split("\\t"); return [a[0], a.slice(1)]; }));`;
  return src.slice(0, start) + replacement + src.slice(afterEnd);
}

// Balanced-brace template interpolation scanner for embedded CSS (safe with nested `{ ... }` in `${...}`)
function minifyEmbeddedCssTemplate(src) {
  return src.replace(/const CSS\s*=\s*`([\s\S]*?)`;/, (_, body) => {
    const slots = [];
    let safeBody = '';
    let i = 0;
    const n = body.length;
    while (i < n) {
      if (body[i] === '\\' && i + 1 < n) {
        safeBody += body.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (body[i] === '$' && body[i + 1] === '{') {
        let j = i + 2;
        let depth = 1;
        while (j < n && depth > 0) {
          const ch = body[j];
          if (ch === "'" || ch === '"' || ch === '`') {
            const q = ch;
            j++;
            while (j < n) {
              if (body[j] === '\\') { j += 2; continue; }
              if (body[j] === q) { j++; break; }
              j++;
            }
            continue;
          }
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
          j++;
        }
        if (depth === 0) {
          const expr = body.slice(i + 2, j - 1);
          slots.push(expr);
          safeBody += `__AGTPL${slots.length - 1}__`;
          i = j;
          continue;
        }
      }
      safeBody += body[i++];
    }
    const min = minifyCss(safeBody);
    const segs = min.split(/__AGTPL(\d+)__/);
    const jsConcat = segs
      .map((part, idx) => (idx % 2 === 0 ? JSON.stringify(part) : `(${slots[Number(part)]})`))
      .filter((part) => part !== '""')
      .join('+');
    return `const CSS=${jsConcat || '""'};`;
  });
}

function minifyJs(src) {
  return serializeTokens(mangleSafeLocals(tokenizeJs(src)));
}

function minifySingleSource(src) {
  const tokens = mangleSafeLocals(tokenizeJs(src));
  const plainMin = serializeTokens(tokens);
  const packedMin = internAndPackModuleStrings(tokens);
  if (packedMin && Buffer.byteLength(packedMin, 'utf8') + 40 < Buffer.byteLength(plainMin, 'utf8')) {
    return packedMin;
  }
  return plainMin;
}

const RUNTIME_PARTS = [
  'i18n-locales.js',
  'i18n-core.js',
  'usage-core.js',
  'crystal-prism-core.js',
  'animated-icons.js',
  'motion-engine.js',
  'ripple-core.js',
  'conv-aura.js',
  'smooth-caret.js',
  'dual-mascot-rig.js',
  'vial-core.js',
  'pulse-vial-bridge.js',
  'vendor/pulse-dashboard/inline-fallback.js',
  'vendor/effort-slider/slider-coexist.js',
  'vendor/thought-translator/thought-client.js',
  'vendor/thought-translator/thought-settings-ui.js',
  'settings-panel.js',
  'home-studio-panel.js',
  'home-ripple-host.js',
  'model-glyph-crystal.js',
  'stream-choreography.js',
  'prism-rim-canvas.js',
  'host-workbench-enhancer.js',
  'ui-runtime.js',
];

const SYNC_ROOT_FILES = [
  'plugin.json',
  'package.json',
  'README.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'config.example.json',
  'cdp.js',
  'inject.js',
  'remove.js',
  'style.css',
  ...RUNTIME_PARTS.filter((p) => !p.includes('/')),
];

const _mangledUnitCache = new Map();
let _unifiedBundleCache = { sig: '', bundleCode: '', partCodeByName: new Map() };
let _cssCache = { sig: '', minCss: '', packedExpr: '' };

function getFileSig(filePath) {
  const st = fs.statSync(filePath);
  return `${st.mtimeMs}:${st.size}`;
}

function readCss() {
  const p = path.join(__dirname, 'style.css');
  const sig = getFileSig(p);
  if (_cssCache.sig !== sig) {
    const minCss = minifyCss(fs.readFileSync(p, 'utf8'));
    _cssCache = { sig, minCss, packedExpr: '' };
  }
  return _cssCache.minCss;
}

function readPackedCssExpr() {
  readCss();
  if (!_cssCache.packedExpr) {
    _cssCache.packedExpr = packCssJsExpr(_cssCache.minCss);
  }
  return _cssCache.packedExpr;
}

function getEffectiveBundlePartNames() {
  const brandRel = 'assets/brand-mark-svg.js';
  if (fs.existsSync(path.join(__dirname, brandRel))) {
    return [brandRel, ...RUNTIME_PARTS];
  }
  return [...RUNTIME_PARTS];
}

function minifyEmbeddedGlslTemplates(src) {
  if (!src.includes('#version 300 es')) return src;
  return src.replace(/`(\s*#version\s+300\s+es\b(?:\\[\s\S]|(?!\$\{)[^`\\])*)`/g, (full, body) => {
    const decoded = decodeSimpleTemplateBody(body);
    if (decoded === null) return full;
    const min = minifyGlsl(decoded);
    return JSON.stringify(min);
  });
}

function preprocessPartToUnits(partName, rawSource) {
  const glslCleaned = minifyEmbeddedGlslTemplates(rawSource);
  if (partName === 'pulse-vial-bridge.js') {
    return [{ key: partName, src: minifyEmbeddedCssTemplate(glslCleaned), prefix: '' }];
  }
  if (partName === 'i18n-locales.js') {
    return [{ key: partName, src: compactStaticStringArrayMap(glslCleaned, 'UI_TABLE'), prefix: '' }];
  }
  if (partName === 'vendor/effort-slider/slider-coexist.js') {
    const upstreamPath = path.join(__dirname, 'vendor', 'effort-slider', 'upstream-client.js');
    if (fs.existsSync(upstreamPath) && !glslCleaned.includes('AntigravityCodexEffortSlider = exportsObj')) {
      const upstreamRaw = fs.readFileSync(upstreamPath, 'utf8');
      return [
        {
          key: 'vendor/effort-slider/upstream-client.js',
          src: upstreamRaw,
          prefix:
            'globalThis.__agCodexEffortSliderDisableAutoBoot=!0;if(typeof window!=="undefined")window.__agCodexEffortSliderDisableAutoBoot=!0;\n',
        },
        { key: partName, src: glslCleaned, prefix: '' },
      ];
    }
  }
  return [{ key: partName, src: glslCleaned, prefix: '' }];
}

function desugarInterpolatedTemplateTokens(tokens) {
  const out = [];
  let prevSig = null;

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (
      tk.type === 'lit' &&
      tk.val === '`' &&
      i + 1 < tokens.length &&
      tokens[i + 1].type === 'lit' &&
      tokens[i + 1].val.endsWith('${')
    ) {
      const canBeTagged =
        prevSig &&
        (prevSig.type === 'id' ||
          prevSig.val === ')' ||
          prevSig.val === ']' ||
          prevSig.val === '}' ||
          prevSig.val.endsWith("'") ||
          prevSig.val.endsWith('"') ||
          prevSig.val.endsWith('`'));
      const untagged =
        !canBeTagged || (prevSig && JS_KEYWORDS.has(prevSig.val) && prevSig.val !== 'this' && prevSig.val !== 'super');

      if (untagged) {
        const chunks = [];
        const exprs = [];
        let cursor = i + 1;
        let ok = true;
        while (cursor < tokens.length) {
          const segTok = tokens[cursor];
          if (!segTok || segTok.type !== 'lit') {
            ok = false;
            break;
          }
          if (segTok.val.endsWith('`') && !segTok.val.endsWith('${')) {
            const dec = decodeSimpleTemplateBody(segTok.val.slice(0, -1));
            if (dec === null || hasLoneUtf16Surrogate(dec)) ok = false;
            else chunks.push(dec);
            cursor++;
            break;
          }
          if (!segTok.val.endsWith('${')) {
            ok = false;
            break;
          }
          const dec = decodeSimpleTemplateBody(segTok.val.slice(0, -2));
          if (dec === null || hasLoneUtf16Surrogate(dec)) {
            ok = false;
            break;
          }
          chunks.push(dec);
          cursor++;
          let braceDepth = 1;
          const exprStart = cursor;
          while (cursor < tokens.length && braceDepth > 0) {
            const et = tokens[cursor];
            if (et.type === 'lit' && et.val.endsWith('${')) braceDepth++;
            else if (et.type === 'punc' && et.val === '{') braceDepth++;
            else if (et.type === 'punc' && et.val === '}') braceDepth--;
            cursor++;
          }
          if (braceDepth !== 0) {
            ok = false;
            break;
          }
          exprs.push(tokens.slice(exprStart, cursor - 1));
        }

        const maxStaticLen = ok ? chunks.reduce((m, c) => Math.max(m, Buffer.byteLength(c, 'utf8')), 0) : 0;
        if (ok && chunks.length === exprs.length + 1 && maxStaticLen >= 12) {
          out.push({ type: 'punc', val: '(' });
          out.push({ type: 'lit', val: serializeJsValue(chunks[0]) });
          for (let k = 0; k < exprs.length; k++) {
            out.push({ type: 'punc', val: '+' });
            out.push({ type: 'punc', val: '(' });
            const inner = desugarInterpolatedTemplateTokens(exprs[k]);
            for (let m = 0; m < inner.length; m++) out.push(inner[m]);
            out.push({ type: 'punc', val: ')' });
            if (chunks[k + 1].length > 0) {
              out.push({ type: 'punc', val: '+' });
              out.push({ type: 'lit', val: serializeJsValue(chunks[k + 1]) });
            }
          }
          const closeParen = { type: 'punc', val: ')' };
          out.push(closeParen);
          prevSig = closeParen;
          i = cursor - 1;
          continue;
        }
      }
    }

    out.push(tk);
    if (tk.type !== 'ws' && tk.type !== 'nl') prevSig = tk;
  }

  return out;
}

function foldStaticCssConstTokens(tokens) {
  const sigIdx = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'ws' && tokens[i].type !== 'nl') sigIdx.push(i);
  }
  const edits = [];
  for (let s = 0; s + 3 < sigIdx.length; s++) {
    const t0 = tokens[sigIdx[s]];
    const t1 = tokens[sigIdx[s + 1]];
    const t2 = tokens[sigIdx[s + 2]];
    if (
      (t0.val !== 'const' && t0.val !== 'let' && t0.val !== 'var') ||
      t1.type !== 'id' ||
      !/CSS/i.test(t1.val) ||
      t2.val !== '='
    ) {
      continue;
    }
    const startSig = s + 3;
    const first = tokens[sigIdx[startSig]];
    // Case A: `[ elem1, elem2, ... ].join("sep")` — merges consecutive string literals & minifies CSS runs
    if (first.val === '[') {
      let depth = 1;
      let cur = startSig + 1;
      const elemRanges = [];
      let elemStart = cur;
      while (cur < sigIdx.length && depth > 0) {
        const v = tokens[sigIdx[cur]].val;
        if (v === '[' || v === '(' || v === '{') depth++;
        else if (v === ']' || v === ')' || v === '}') {
          depth--;
          if (depth === 0) {
            if (cur > elemStart) elemRanges.push([elemStart, cur - 1]);
            break;
          }
        } else if (depth === 1 && v === ',') {
          if (cur > elemStart) elemRanges.push([elemStart, cur - 1]);
          elemStart = cur + 1;
        }
        cur++;
      }
      if (
        depth === 0 &&
        elemRanges.length >= 4 &&
        cur + 4 < sigIdx.length &&
        tokens[sigIdx[cur]].val === ']' &&
        tokens[sigIdx[cur + 1]].val === '.' &&
        tokens[sigIdx[cur + 2]].val === 'join' &&
        tokens[sigIdx[cur + 3]].val === '('
      ) {
        let sep = ',';
        let closePos = cur + 4;
        let ok = true;
        if (tokens[sigIdx[closePos]].val === ')') {
          sep = ',';
        } else if (
          closePos + 1 < sigIdx.length &&
          tokens[sigIdx[closePos]].type === 'lit' &&
          (tokens[sigIdx[closePos]].val[0] === "'" || tokens[sigIdx[closePos]].val[0] === '"') &&
          tokens[sigIdx[closePos + 1]].val === ')'
        ) {
          const decSep = decodeSimpleJsString(tokens[sigIdx[closePos]].val);
          if (decSep === null) ok = false;
          else {
            sep = decSep;
            closePos += 1;
          }
        } else {
          ok = false;
        }
        const afterJoin = closePos + 1 < sigIdx.length ? tokens[sigIdx[closePos + 1]] : null;
        if (ok && (!afterJoin || afterJoin.val === ';' || afterJoin.val === ',')) {
          // Flatten each element: either pure string literal(s) `a + b` or general token slice
          const segments = [];
          let strRun = [];
          const flushStrRun = (trailingSep) => {
            if (strRun.length === 0) return;
            const joined = strRun.join(sep) + (trailingSep ? sep : '');
            const minChunk = joined.replace(/^\s+/, '').replace(/\s{2,}/g, ' ').replace(/\s*([{};:,])\s*/g, '$1');
            segments.push([{ type: 'lit', val: serializeJsValue(minChunk) }]);
            strRun = [];
          };
          for (let rIdx = 0; rIdx < elemRanges.length; rIdx++) {
            const [es, ee] = elemRanges[rIdx];
            // Check if element is a single string literal
            if (
              es === ee &&
              tokens[sigIdx[es]].type === 'lit' &&
              (tokens[sigIdx[es]].val[0] === "'" || tokens[sigIdx[es]].val[0] === '"')
            ) {
              const dec = decodeSimpleJsString(tokens[sigIdx[es]].val);
              if (dec !== null) {
                strRun.push(dec);
                continue;
              }
            }
            flushStrRun(true);
            const exprSlice = tokens.slice(sigIdx[es], sigIdx[ee] + 1);
            const hasMore = rIdx + 1 < elemRanges.length;
            const wrapped = [{ type: 'punc', val: '(' }, ...exprSlice, { type: 'punc', val: ')' }];
            if (hasMore && sep.length > 0) {
              wrapped.push({ type: 'punc', val: '+' });
              wrapped.push({ type: 'lit', val: serializeJsValue(sep) });
            }
            segments.push(wrapped);
          }
          flushStrRun(false);
          if (segments.length === 1 && segments[0].length === 1 && segments[0][0].type === 'lit') {
            const fullRaw = decodeSimpleJsString(segments[0][0].val);
            const minCssText = fullRaw !== null ? minifyCss(fullRaw) : null;
            edits.push({
              from: sigIdx[startSig],
              to: sigIdx[closePos],
              repTokens: [{ type: 'lit', val: minCssText !== null ? serializeJsValue(minCssText) : segments[0][0].val }],
            });
          } else if (segments.length > 0) {
            const repTokens = [];
            for (let k = 0; k < segments.length; k++) {
              if (k > 0) repTokens.push({ type: 'punc', val: '+' });
              for (const tk of segments[k]) repTokens.push(tk);
            }
            edits.push({ from: sigIdx[startSig], to: sigIdx[closePos], repTokens });
          }
          s = closePos;
          continue;
        }
      }
    }
    // Case B: `"str1" + "str2" + ...`
    if (first.type === 'lit' && (first.val[0] === "'" || first.val[0] === '"')) {
      const firstDec = decodeSimpleJsString(first.val);
      if (firstDec !== null) {
        const parts = [firstDec];
        let cur = startSig + 1;
        let lastTokPos = startSig;
        let ok = true;
        while (cur + 1 < sigIdx.length && tokens[sigIdx[cur]].val === '+') {
          const rhs = tokens[sigIdx[cur + 1]];
          if (rhs.type !== 'lit' || (rhs.val[0] !== "'" && rhs.val[0] !== '"')) {
            ok = false;
            break;
          }
          const dec = decodeSimpleJsString(rhs.val);
          if (dec === null) {
            ok = false;
            break;
          }
          parts.push(dec);
          lastTokPos = cur + 1;
          cur += 2;
        }
        const afterConcat = cur < sigIdx.length ? tokens[sigIdx[cur]] : null;
        if (ok && parts.length >= 2 && (!afterConcat || afterConcat.val === ';' || afterConcat.val === ',')) {
          const minCssText = minifyCss(parts.join(''));
          edits.push({
            from: sigIdx[startSig],
            to: sigIdx[lastTokPos],
            repTokens: [{ type: 'lit', val: serializeJsValue(minCssText) }],
          });
          s = lastTokPos;
        }
      }
    }
  }
  if (edits.length === 0) return tokens;
  const out = [];
  let eIdx = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (eIdx < edits.length && i === edits[eIdx].from) {
      for (const rt of edits[eIdx].repTokens) out.push(rt);
      i = edits[eIdx].to;
      eIdx++;
    } else {
      out.push(tokens[i]);
    }
  }
  return out;
}

function getMangledUnit(unitKey, sig, src) {
  const hit = _mangledUnitCache.get(unitKey);
  if (hit && hit.sig === sig) return hit;
  const tokens = desugarInterpolatedTemplateTokens(mangleSafeLocals(foldStaticCssConstTokens(tokenizeJs(src))));
  const occs = scanModulePoolCandidates(tokens, true);
  const entry = { sig, tokens, occs };
  _mangledUnitCache.set(unitKey, entry);
  return entry;
}

// Unified Bundle-Level Shared String & Member-Property Pool Compiler
function compileUnifiedBundle() {
  const partNames = getEffectiveBundlePartNames();
  const partMeta = [];
  const sigParts = [];

  for (const partName of partNames) {
    const fullPath = path.join(__dirname, partName);
    let sig = getFileSig(fullPath);
    if (partName === 'vendor/effort-slider/slider-coexist.js') {
      const upPath = path.join(__dirname, 'vendor', 'effort-slider', 'upstream-client.js');
      if (fs.existsSync(upPath)) sig += '|' + getFileSig(upPath);
    }
    sigParts.push(`${partName}:${sig}`);
    partMeta.push({ partName, fullPath, sig });
  }

  const totalSig = sigParts.join(';');
  if (_unifiedBundleCache.sig === totalSig) {
    return _unifiedBundleCache;
  }

  const SEP = '\x7f';
  const POOL_IDX_BASE = 0x0100;
  const DIRECT_SINGLE_LIMIT = 7680; // 0x0100..0x1EFF: 1792 2-byte + 5888 3-byte UTF-8 chars (all < 0x2028)
  const HI_CHAR_BASE = 0x1f00; // 0x1F00..0x1FFF + 0x0100..0x013F = 16,384 overflow 2-char slots
  const MAX_SHARED_POOL = 12000;

  const compiledParts = [];
  const globalStats = new Map();

  for (const pm of partMeta) {
    const raw = fs.readFileSync(pm.fullPath, 'utf8');
    const units = preprocessPartToUnits(pm.partName, raw).map((u) => {
      const uSig = `${pm.sig}:${u.key}`;
      const mangled = getMangledUnit(u.key, uSig, u.src);
      for (const [strVal, list] of mangled.occs.entries()) {
        let g = globalStats.get(strVal);
        if (!g) {
          g = {
            strVal,
            valBytes: Buffer.byteLength(strVal, 'utf8'),
            totalOrig: 0,
            totalReplEst: 0,
            moduleHits: 0,
            totalOccs: 0,
            hasStr: false,
          };
          globalStats.set(strVal, g);
        }
        let unitOrig = 0;
        let unitRepl = 0;
        let unitHasStr = false;
        for (const occ of list) {
          unitOrig += occ.origBytes;
          unitRepl += occ.kind === 'str' ? 2 : 4;
          if (occ.kind === 'str') unitHasStr = true;
        }
        if (unitOrig > unitRepl + 2) {
          g.totalOrig += unitOrig;
          g.totalReplEst += unitRepl + 4;
          g.moduleHits += 1;
          g.totalOccs += list.length;
          if (unitHasStr) g.hasStr = true;
        }
      }
      return { ...u, tokens: mangled.tokens, occs: mangled.occs };
    });
    compiledParts.push({ partName: pm.partName, raw, units });
  }

  const poolCandidates = [];
  for (const g of globalStats.values()) {
    const lzPoolCost = g.valBytes >= 8 ? Math.ceil(g.valBytes * 0.62) + 2 : g.valBytes + 2;
    const netSave = g.totalOrig - (lzPoolCost + g.totalReplEst);
    // Multi-occurrence strings/props save via deduplication; single-occurrence strings >= 23B save via shared LZ phrase dictionary!
    if ((g.totalOccs >= 2 && netSave >= 1) || (g.hasStr && g.valBytes >= 23)) {
      const sortScore = g.totalOccs >= 2 ? netSave + Math.floor(g.valBytes * 0.25) : Math.floor(g.valBytes * 0.35) - 5;
      poolCandidates.push({ ...g, netSave, sortScore });
    }
  }
  poolCandidates.sort((a, b) => b.sortScore - a.sortScore || b.totalOccs - a.totalOccs);
  const chosenPool = poolCandidates.slice(0, MAX_SHARED_POOL);
  // Assign 2-byte UTF-8 index slots (0..1791) to entries referenced by the most modules!
  chosenPool.sort((a, b) => b.moduleHits - a.moduleHits || b.totalOccs - a.totalOccs || b.sortScore - a.sortScore);

  const sharedPoolList = chosenPool.map((x) => x.strVal);
  const poolIndexMap = new Map();
  for (let idx = 0; idx < sharedPoolList.length; idx++) {
    poolIndexMap.set(sharedPoolList[idx], idx);
  }

  const encodePoolIndex = (idx) =>
    idx < DIRECT_SINGLE_LIMIT
      ? String.fromCharCode(POOL_IDX_BASE + idx)
      : String.fromCharCode(
          HI_CHAR_BASE + ((idx - DIRECT_SINGLE_LIMIT) >> 6),
          POOL_IDX_BASE + ((idx - DIRECT_SINGLE_LIMIT) & 63)
        );

  const packedPoolExpr = packTextJsExpr(sharedPoolList.join(SEP), 5600);
  const bootstrapHeader =
    `globalThis.__agSP=${packedPoolExpr}.split(${JSON.stringify(SEP)});` +
    `globalThis.__agM=s=>{let p=globalThis.__agSP,r=[],i=0;for(;i<s.length;i++){let c=s.charCodeAt(i);r.push(p[c<${HI_CHAR_BASE}?c-${POOL_IDX_BASE}:${DIRECT_SINGLE_LIMIT}+((c-${HI_CHAR_BASE})<<6)+s.charCodeAt(++i)-${POOL_IDX_BASE}])}return r};`;

  const partCodeByName = new Map();
  const orderedCodes = [];

  for (let pIdx = 0; pIdx < compiledParts.length; pIdx++) {
    const cp = compiledParts[pIdx];
    const unitCodes = cp.units.map((u) => {
      const selected = [];
      for (const [strVal, list] of u.occs.entries()) {
        const poolIdx = poolIndexMap.get(strVal);
        if (poolIdx === undefined) continue;
        const totalOrig = list.reduce((s, x) => s + x.origBytes, 0);
        selected.push({ strVal, poolIdx, list, totalOrig });
      }
      selected.sort((a, b) => b.list.length - a.list.length || b.totalOrig - a.totalOrig);

      const plainMin = serializeTokens(u.tokens);
      const pooledCode = applyModulePoolReplacements(u.tokens, selected, (activeItems, bodyCode) => {
        const varNames = activeItems.map((x) => x.varName);
        const idxChars = activeItems.map((x) => encodePoolIndex(x.poolIdx)).join('');
        const bodySep = bodyCode.endsWith(';') || bodyCode.endsWith('}') ? bodyCode : bodyCode + ';';
        return `{let[${varNames.join(',')}]=__agM(${serializeJsValue(idxChars)});${bodySep}}`;
      });

      const bestBody =
        pooledCode.includes('__agM(') || Buffer.byteLength(pooledCode, 'utf8') < Buffer.byteLength(plainMin, 'utf8')
          ? pooledCode
          : plainMin;
      const withSemi = bestBody.endsWith(';') || bestBody.endsWith('}') ? bestBody : bestBody + ';';
      return u.prefix + withSemi;
    });

    let finalPartCode = unitCodes.join('\n');
    if (pIdx === 0) {
      finalPartCode = bootstrapHeader + finalPartCode;
    }
    partCodeByName.set(cp.partName, finalPartCode);
    orderedCodes.push(finalPartCode);
  }

  const bundleCode = orderedCodes.join('\n');
  _unifiedBundleCache = { sig: totalSig, bundleCode, partCodeByName };
  return _unifiedBundleCache;
}

function prepareRuntimePart(partName, rawSource) {
  const normName = String(partName || '').replace(/\\/g, '/');
  const fullPath = path.join(__dirname, normName);
  if (fs.existsSync(fullPath)) {
    try {
      const diskRaw = fs.readFileSync(fullPath, 'utf8');
      if (diskRaw === rawSource) {
        const unified = compileUnifiedBundle();
        if (unified.partCodeByName.has(normName)) {
          return unified.partCodeByName.get(normName);
        }
      }
    } catch {}
  }

  let prepped = rawSource;
  if (normName === 'pulse-vial-bridge.js') {
    prepped = minifyEmbeddedCssTemplate(prepped);
  } else if (normName === 'i18n-locales.js') {
    prepped = compactStaticStringArrayMap(prepped, 'UI_TABLE');
  } else if (normName === 'vendor/effort-slider/slider-coexist.js') {
    const upstreamPath = path.join(__dirname, 'vendor', 'effort-slider', 'upstream-client.js');
    if (fs.existsSync(upstreamPath) && !rawSource.includes('AntigravityCodexEffortSlider = exportsObj')) {
      const upstreamRaw = fs.readFileSync(upstreamPath, 'utf8');
      const upstreamMin = minifySingleSource(upstreamRaw);
      const wrapperMin = minifySingleSource(rawSource);
      return `globalThis.__agCodexEffortSliderDisableAutoBoot=!0;if(typeof window!=="undefined")window.__agCodexEffortSliderDisableAutoBoot=!0;\n${upstreamMin}\n${wrapperMin}`;
    }
  }
  return minifySingleSource(prepped);
}

function readRuntimeBundle() {
  return compileUnifiedBundle().bundleCode;
}

function computeHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function buildConfigRefreshExpression(customConfig, extraMeta = null) {
  const config = customConfig ? reconcileConfigAliases(customConfig) : readConfig();
  const bundle = readRuntimeBundle();
  const codeHash = computeHash(bundle);
  const bootCfg = {
    ...config,
    ...(extraMeta && typeof extraMeta === 'object' ? extraMeta : {}),
    binding: SETTING_BINDING,
    codeHash,
    __fromFile: true,
  };
  return `(() => {
    const cfg = ${JSON.stringify(bootCfg)};
    const api = window.__agPrism || window.__agClaudeStyle;
    if (api && api.version === ${JSON.stringify(PLUGIN_VERSION)} && api.codeHash === ${JSON.stringify(codeHash)} && typeof api.refreshConfig === 'function') {
      const applied = api.refreshConfig(cfg);
      if (applied === false) {
        return { refreshed: true, skippedStale: true, version: api.version };
      }
      const effectiveCfg = api.getState?.()?.cfg || cfg;
      try { window.__agPrismTelemetry?.sync?.(effectiveCfg); } catch {}
      try { window.__agPrismEffortSlider?.sync?.(effectiveCfg); } catch {}
      try { window.__agPrismThought?.sync?.(effectiveCfg); } catch {}
      if (effectiveCfg?.omniModule === 'off') {
        try { window.__agPrismOmni?.destroy?.(); } catch {}
      } else {
        try { window.__agPrismOmni?.sync?.(effectiveCfg, window.__agPrismOmniServerMeta || null); } catch {}
      }
      if (document.documentElement) {
        document.documentElement.setAttribute('data-ag-prism-thought-view', effectiveCfg?.thoughtView === 'bilingual' ? 'bilingual' : 'immersive');
      }
      return { refreshed: true, version: api.version };
    }
    return { refreshed: false };
  })()`;
}

let _injectWrapperTemplate = null;

function getInjectWrapperTemplate() {
  if (_injectWrapperTemplate) return _injectWrapperTemplate;
  const rawTpl = `(() => {
    const css = __AG_INJ_CSS__;
    const migrateLegacyStorage = () => {
      try {
        if (typeof localStorage === 'undefined' || !localStorage) return;
        const legacyKey = 'ag-claude-style:config';
        const prismKey = 'ag-prism:config';
        const v3Key = 'agClaudeStyle.settings.v3';
        const legacyRaw = localStorage.getItem(legacyKey);
        const v3Raw = localStorage.getItem(v3Key);
        const prismRaw = localStorage.getItem(prismKey);
        if (!prismRaw && (legacyRaw || v3Raw)) {
          localStorage.setItem(prismKey, legacyRaw || v3Raw);
        }
        if (!v3Raw && (prismRaw || legacyRaw)) {
          localStorage.setItem(v3Key, prismRaw || legacyRaw);
        }
      } catch {}
    };
    const cleanupLegacyResidue = () => {
      try {
        const oldStyle = document.getElementById(${JSON.stringify(LEGACY_STYLE_ID)});
        if (oldStyle) oldStyle.remove();
      } catch {}
      try {
        const oldApi = window.__agClaudeStyle;
        if (oldApi && (!window.__agPrism || Number(oldApi.version) <= 2)) {
          if (typeof oldApi.destroy === 'function') oldApi.destroy();
          delete window.__agClaudeStyle;
        }
      } catch {}
    };
    const applyStyle = () => {
      const targetParent = document.head || document.documentElement;
      if (!targetParent) return;
      cleanupLegacyResidue();
      let style = document.getElementById(${JSON.stringify(STYLE_ID)});
      if (!style) {
        style = document.createElement('style');
        style.id = ${JSON.stringify(STYLE_ID)};
      }
      if (style.textContent !== css) style.textContent = css;
      if (style.parentNode !== targetParent || targetParent.lastElementChild !== style) {
        targetParent.appendChild(style);
      }
    };

    const ensureRepoBridge = () => {
      try {
        if (window.__agPrismRepoBridge && window.__agPrismRepoBridge.__prismBridgeReady) return;
        const pendingRepo = new Map();
        let repoSeq = 0;
        const callRepo = (actionOrInput) => {
          const payload =
            typeof actionOrInput === 'string'
              ? { action: actionOrInput }
              : actionOrInput && typeof actionOrInput === 'object'
              ? { ...actionOrInput }
              : { action: 'status' };
          const act = payload.action || 'status';
          if (typeof window.__agPrismRepoCall !== 'function') {
            return Promise.resolve({
              ok: false,
              offline: true,
              action: act,
              isGitRepo: false,
              noRemote: true,
              hasRemote: false,
              branch: 'local',
              commit: ${JSON.stringify(PLUGIN_VERSION)},
              shortHash: ${JSON.stringify(PLUGIN_VERSION)},
              remoteUrl: '',
              hasUpdates: false,
              upToDate: true,
              updated: false,
              message: 'Sidecar daemon offline',
            });
          }
          return new Promise((resolve) => {
            if (pendingRepo.size >= 8) {
              resolve({ ok: false, action: act, error: 'busy' });
              return;
            }
            const id = ++repoSeq;
            const timer = setTimeout(() => {
              pendingRepo.delete(id);
              resolve({ ok: false, timeout: true, action: act, noRemote: true, hasRemote: false });
            }, 16000);
            pendingRepo.set(id, { resolve, timer });
            try {
              window.__agPrismRepoCall(JSON.stringify({ id, action: act, input: payload }));
            } catch (err) {
              clearTimeout(timer);
              pendingRepo.delete(id);
              resolve({ ok: false, action: act, error: String(err && err.message ? err.message : err) });
            }
          });
        };
        callRepo.__prismBridgeReady = true;
        callRepo.call = callRepo;
        callRepo.request = callRepo;
        callRepo.status = () => callRepo({ action: 'status' });
        callRepo.pull = () => callRepo({ action: 'pull' });
        callRepo.sync = () => callRepo({ action: 'pull' });
        callRepo.resolve = (id, res) => {
          const item = pendingRepo.get(id);
          if (!item) return;
          clearTimeout(item.timer);
          pendingRepo.delete(id);
          item.resolve(res);
        };
        callRepo.dispose = () => {
          for (const item of pendingRepo.values()) {
            clearTimeout(item.timer);
            item.resolve({ ok: false, disposed: true });
          }
          pendingRepo.clear();
        };
        window.__agPrismRepoBridge = callRepo;
        window.__agPrismRepoResolve = callRepo.resolve;
      } catch {}
    };

    const ensureThoughtBridge = () => {
      try {
        if (
          window.__agPrismThoughtBridge &&
          window.__agPrismThoughtBridge.__prismBridgeReady &&
          typeof window.__agPrismThoughtBridge.cacheStats === 'function' &&
          typeof window.__agPrismThoughtBridge.cancelTranslate === 'function'
        ) {
          return;
        }
        try { window.__agPrismThoughtBridge?.dispose?.(); } catch {}
        const pendingThought = new Map();
        let thoughtSeq = 0;
        const directMachineTranslate = async (rawText) => {
          const text = String(rawText || '').trim();
          if (!text) return '';
          const codeSpans = [];
          const masked = text.replace(/\\x60[^\\x60\\n]+\\x60/g, (m) => '__OPCODE_' + (codeSpans.push(m) - 1) + '__');
          const url =
            'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=' +
            encodeURIComponent(masked);
          const res = await fetch(url);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const json = await res.json();
          const segs = Array.isArray(json && json[0]) ? json[0] : [];
          let out = segs.map((s) => (Array.isArray(s) && s[0] ? String(s[0]) : '')).join('');
          out = out.replace(/__OPCODE_(\\d+)__/gi, (_, n) => codeSpans[Number(n)] || _);
          return out.trim();
        };
        const sendRpc = (payload, onPartial, timeoutMs = 48000) => {
          const act = (payload && payload.action) || 'get-config';
          if (typeof window.__agPrismThoughtCall !== 'function') {
            if (act === 'translate-stream' && payload && payload.mode === 'machine' && typeof fetch === 'function') {
              return directMachineTranslate(payload.text)
                .then((t) => {
                  if (t && typeof onPartial === 'function') onPartial(t);
                  return { ok: Boolean(t), text: t, engine: 'machine-browser' };
                })
                .catch((e) => ({ ok: false, offline: true, error: String(e && e.message ? e.message : e) }));
            }
            return Promise.resolve({ ok: false, offline: true, action: act, error: 'Sidecar daemon offline' });
          }
          return new Promise((resolve) => {
            const isControlAct = act === 'cancel-translate' || act === 'cache-stats' || act === 'clear-cache';
            if (!isControlAct && pendingThought.size >= 64) {
              resolve({ ok: false, action: act, error: 'busy' });
              return;
            }
            const id = ++thoughtSeq;
            const timer = setTimeout(() => {
              pendingThought.delete(id);
              resolve({ ok: false, timeout: true, action: act, error: 'Request timed out' });
            }, timeoutMs);
            pendingThought.set(id, { resolve, timer, onPartial });
            try {
              window.__agPrismThoughtCall(JSON.stringify({ id, action: act, input: payload }));
            } catch (err) {
              clearTimeout(timer);
              pendingThought.delete(id);
              resolve({ ok: false, action: act, error: String(err && err.message ? err.message : err) });
            }
          });
        };
        const bridge = {
          __prismBridgeReady: true,
          call: (input) =>
            sendRpc(
              input && typeof input === 'object' ? { ...input } : { action: String(input || 'get-config') },
              null,
              20000
            ),
          translateStream: (opts, onPartial) =>
            sendRpc(
              {
                ...(opts && typeof opts === 'object' ? opts : {}),
                action: 'translate-stream',
                text: opts && opts.text ? opts.text : '',
                mode: (opts && opts.mode) || 'ai',
              },
              onPartial,
              50000
            ),
          cancelTranslate: (idOrInput) =>
            sendRpc(
              idOrInput && typeof idOrInput === 'object'
                ? { ...idOrInput, action: 'cancel-translate' }
                : { action: 'cancel-translate', requestId: idOrInput, key: idOrInput },
              null,
              8000
            ),
          cacheStats: () => sendRpc({ action: 'cache-stats' }, null, 8000),
          clearCache: () => sendRpc({ action: 'clear-cache' }, null, 8000),
          onChunk: (id, partialText) => {
            const item = pendingThought.get(id);
            if (item && typeof item.onPartial === 'function') {
              try {
                item.onPartial(partialText);
              } catch {}
            }
          },
          resolve: (id, res) => {
            const item = pendingThought.get(id);
            if (!item) return;
            clearTimeout(item.timer);
            pendingThought.delete(id);
            item.resolve(res);
          },
          dispose: () => {
            for (const item of pendingThought.values()) {
              clearTimeout(item.timer);
              item.resolve({ ok: false, disposed: true });
            }
            pendingThought.clear();
          },
        };
        window.__agPrismThoughtBridge = bridge;
        window.__agPrismThoughtOnChunk = bridge.onChunk;
        window.__agPrismThoughtResolve = bridge.resolve;
      } catch {}
    };

    const ensureUsageBridge = () => {
      try {
        if (
          window.__agPrismUsageBridge &&
          window.__agPrismUsageBridge.__prismBridgeReady &&
          typeof window.__agPrismUsageBridge.listSummaries === 'function'
        ) {
          return;
        }
        try { window.__agPrismUsageBridge?.dispose?.(); } catch {}
        const pendingUsage = new Map();
        let usageSeq = 0;
        const sendUsageRpc = (reqObj, timeoutMs = 18000) => {
          if (typeof window.__agPrismUsageCall !== 'function') {
            return Promise.resolve({ ok: false, offline: true, records: [], summaries: [] });
          }
          return new Promise((resolve) => {
            if (pendingUsage.size >= 12) {
              resolve({ ok: false, busy: true, records: [], summaries: [] });
              return;
            }
            const id = ++usageSeq;
            const timer = setTimeout(() => {
              pendingUsage.delete(id);
              resolve({ ok: false, timeout: true, records: [], summaries: [] });
            }, timeoutMs);
            pendingUsage.set(id, { resolve, timer });
            try {
              window.__agPrismUsageCall(JSON.stringify({ id, ...reqObj }));
            } catch (err) {
              clearTimeout(timer);
              pendingUsage.delete(id);
              resolve({ ok: false, error: String(err && err.message ? err.message : err), records: [], summaries: [] });
            }
          });
        };
        const fetchBatch = (itemsOrOpts, timeoutMs = 18000) => {
          if (itemsOrOpts && typeof itemsOrOpts === 'object' && !Array.isArray(itemsOrOpts)) {
            return sendUsageRpc(
              {
                action: itemsOrOpts.action || 'fetch-batch',
                items: Array.isArray(itemsOrOpts.items) ? itemsOrOpts.items : [],
                includeSummaries: Boolean(itemsOrOpts.includeSummaries),
              },
              timeoutMs
            );
          }
          return sendUsageRpc({ action: 'fetch-batch', items: Array.isArray(itemsOrOpts) ? itemsOrOpts : [] }, timeoutMs);
        };
        const listSummaries = (timeoutMs = 12000) =>
          sendUsageRpc({ action: 'list-summaries', items: [], includeSummaries: true }, timeoutMs);
        const bridge = {
          __prismBridgeReady: true,
          isOnline: () => typeof window.__agPrismUsageCall === 'function',
          fetchBatch,
          listSummaries,
          resolve: (id, res) => {
            const item = pendingUsage.get(id);
            if (!item) return;
            clearTimeout(item.timer);
            pendingUsage.delete(id);
            item.resolve(res);
          },
          dispose: () => {
            for (const item of pendingUsage.values()) {
              clearTimeout(item.timer);
              item.resolve({ ok: false, disposed: true, records: [] });
            }
            pendingUsage.clear();
          },
        };
        window.__agPrismUsageBridge = bridge;
        window.__agPrismUsageResolve = bridge.resolve;
      } catch {}
    };

    const stripForeignMount = () => {
      try { window.__agPrismTelemetry?.destroy?.(); } catch {}
      try { window.__agPrismEffortSlider?.destroy?.(); } catch {}
      try { window.__agPrismThought?.destroy?.(); } catch {}
      try { window.__agPrismOmni?.destroy?.(); } catch {}
      try { window.__agPrism?.destroy?.(); } catch {}
      try { window.__agPrismRepoBridge?.dispose?.(); } catch {}
      try { window.__agPrismThoughtBridge?.dispose?.(); } catch {}
      try { window.__agPrismUsageBridge?.dispose?.(); } catch {}
      try { window.__agPrismOmniBridge?.dispose?.(); } catch {}
      try { document.getElementById(${JSON.stringify(STYLE_ID)})?.remove(); } catch {}
      try { document.getElementById(${JSON.stringify(LEGACY_STYLE_ID)})?.remove(); } catch {}
      try { document.getElementById('ag-prism-settings-v101-css')?.remove(); } catch {}
      try { document.getElementById('ag-prism-omni-css')?.remove(); } catch {}
      delete window.__agPrismOmni;
      delete window.__agPrism;
      delete window.__agClaudeStyle;
    };

    const hasWorkbenchMarkers = () => {
      try {
        if (/\\bantigravity\\b/i.test(String(document.title || ''))) return true;
        if (document.body && document.body.classList && document.body.classList.contains('theme-standalone')) return true;
        return Boolean(
          document.querySelector(
            '.agy-home, [data-testid="conversation-view"], [data-testid="agent-input-box"], [data-testid="model-selector-trigger"], .monaco-workbench'
          )
        );
      } catch {
        return false;
      }
    };

    const checkHostIdentity = () => {
      try {
        const loc = typeof window !== 'undefined' && window.location;
        const href = loc && typeof loc.href === 'string' ? loc.href : '';
        if (!href) return 'ok';
        const low = href.toLowerCase();
        if (low.startsWith('devtools://') || low.startsWith('data:') || low.startsWith('chrome:') || low.startsWith('chrome-extension:') || low.startsWith('edge:') || low.startsWith('blob:') || low.startsWith('plugin:')) {
          return 'reject';
        }
        if (low.startsWith('vscode-file://') || low.startsWith('app://') || low.startsWith('about:')) {
          return /\\b(?:Untitled|launchpad)\\b/i.test(String(document.title || '') + ' ' + href) ? 'reject' : 'ok';
        }
        const m = /^(https?):\\/\\/(127\\.0\\.0\\.1|localhost|\\[::1\\])(?::\\d+)?(\\/|$)/i.exec(href);
        if (!m) {
          return low.startsWith('http:') || low.startsWith('https:') ? 'reject' : 'ok';
        }
        if (hasWorkbenchMarkers()) return 'ok';
        const isPlainHttp = m[1].toLowerCase() === 'http';
        const rs = String(document.readyState || '');
        if (isPlainHttp) {
          return rs === 'loading' ? 'defer' : 'reject';
        }
        return rs === 'complete' ? 'reject' : 'ok';
      } catch {
        return 'ok';
      }
    };

    let status = 'ok';
    let mounted = false;
    const mount = () => {
      if (mounted || !document.documentElement) return;
      const hostVerdict = checkHostIdentity();
      if (hostVerdict === 'reject') {
        status = 'skipped-non-host';
        stripForeignMount();
        return;
      }
      if (hostVerdict === 'defer') {
        status = 'deferred';
        document.addEventListener('DOMContentLoaded', () => mount(), { once: true });
        return;
      }
      mounted = true;
      if (typeof window !== 'undefined' && window.addEventListener && String(document.readyState || '') !== 'complete') {
        window.addEventListener(
          'load',
          () => {
            if (checkHostIdentity() === 'reject') stripForeignMount();
          },
          { once: true }
        );
      }
      try {
        cleanupLegacyResidue();
        ensureRepoBridge();
        ensureThoughtBridge();
        ensureUsageBridge();
        if (document.head) applyStyle();
        else document.addEventListener('DOMContentLoaded', applyStyle, { once: true });
        const bootCfg = __AG_INJ_BOOTCFG__;
        const existingPrism = window.__agPrism || window.__agClaudeStyle;
        const bundleUnchanged = Boolean(
          existingPrism &&
            existingPrism.version === ${JSON.stringify(PLUGIN_VERSION)} &&
            existingPrism.codeHash === __AG_INJ_CODEHASH__ &&
            window.__agPrismTelemetry &&
            window.__agPrismEffortSlider &&
            window.__agPrismThought
        );
        if (bundleUnchanged) {
          existingPrism.refreshConfig(bootCfg);
        } else {
          try { window.__agPrismTelemetry?.destroy?.(); } catch {}
          try { window.__agPrismEffortSlider?.destroy?.(); } catch {}
          try { window.__agPrismThought?.destroy?.(); } catch {}
          try {
            document.querySelectorAll('[data-ag-prism-fallback="1"]').forEach((n) => n.remove());
          } catch {}
          __AG_INJ_BUNDLE__();
          if (typeof globalThis.__agCsUiMain === 'function') {
            globalThis.__agCsUiMain(bootCfg);
          }
        }
        migrateLegacyStorage();
        if (window.__agClaudeStyle && !window.__agPrism) {
          window.__agPrism = window.__agClaudeStyle;
        } else if (window.__agPrism) {
          window.__agClaudeStyle = window.__agPrism;
        }
        const liveState = window.__agPrism && typeof window.__agPrism.getState === 'function' ? window.__agPrism.getState() : null;
        const effectiveCfg = (liveState && liveState.cfg) || bootCfg;
        try { window.__agPrismTelemetry?.sync?.(effectiveCfg); } catch {}
        try { window.__agPrismEffortSlider?.sync?.(effectiveCfg); } catch {}
        try { window.__agPrismThought?.sync?.(effectiveCfg); } catch {}
        if (effectiveCfg?.omniModule === 'off') {
          try { window.__agPrismOmni?.destroy?.(); } catch {}
        } else {
          try { window.__agPrismOmni?.sync?.(effectiveCfg, window.__agPrismOmniServerMeta || null); } catch {}
        }
        if (document.documentElement) {
          if (!document.documentElement.hasAttribute('data-ag-prism')) {
            document.documentElement.setAttribute('data-ag-prism', ${JSON.stringify(PLUGIN_VERSION)});
          }
          document.documentElement.setAttribute('data-ag-prism-thought-view', effectiveCfg?.thoughtView === 'bilingual' ? 'bilingual' : 'immersive');
        }
      } catch (e) {
        status = 'error: ' + (e && e.message ? e.message : String(e));
        if (typeof console !== 'undefined' && console.error) {
          console.error('[obsidian-prism] init error:', e);
        }
      }
    };

    if (document.documentElement) {
      mount();
    } else {
      status = 'deferred';
      const onReady = () => {
        if (document.documentElement) {
          document.removeEventListener('readystatechange', onReady);
          document.removeEventListener('DOMContentLoaded', onReady);
          mount();
        }
      };
      document.addEventListener('readystatechange', onReady);
      document.addEventListener('DOMContentLoaded', onReady);
    }
    const api = window.__agPrism || window.__agClaudeStyle;
    const st = api && typeof api.getState === 'function' ? api.getState() : null;
    return {
      version: ${JSON.stringify(PLUGIN_VERSION)},
      status,
      state: st,
    };
  })()`;
  _injectWrapperTemplate = minifyJs(rawTpl);
  return _injectWrapperTemplate;
}

function buildInjectExpression(customConfig) {
  const config = customConfig ? reconcileConfigAliases(customConfig) : readConfig();
  const packedCss = readPackedCssExpr();
  const bundle = readRuntimeBundle();
  const codeHash = computeHash(bundle);
  const bootCfgJson = JSON.stringify({ ...config, binding: SETTING_BINDING, codeHash, __fromFile: true });
  const codeHashJson = JSON.stringify(codeHash);
  return getInjectWrapperTemplate()
    .replace('__AG_INJ_CSS__', () => packedCss)
    .replace('__AG_INJ_BOOTCFG__', () => bootCfgJson)
    .replace('__AG_INJ_CODEHASH__', () => codeHashJson)
    .replace('__AG_INJ_BUNDLE__();', () => bundle);
}

let _omniClientCache = { sig: '', minCode: '', codeHash: '' };

function readCompiledOmniClient() {
  const omniPath = path.join(__dirname, 'vendor', 'omni-viewer', 'omni-client.js');
  if (!fs.existsSync(omniPath)) {
    return { minCode: '', codeHash: '' };
  }
  const sig = getFileSig(omniPath);
  if (_omniClientCache.sig === sig) {
    return _omniClientCache;
  }
  const raw = fs.readFileSync(omniPath, 'utf8');
  const minCode = minifySingleSource(raw);
  const codeHash = computeHash(minCode);
  _omniClientCache = { sig, minCode, codeHash };
  return _omniClientCache;
}

// 第二通道独立注入：绝不挤占静态主包 680KiB 配额，支持服务端 serverMeta 热同步与 codeHash 快速跳过重挂载
function buildOmniClientExpression(serverMeta = null, customClientSource = null) {
  let minCode = '';
  let codeHash = '';
  if (typeof customClientSource === 'string') {
    minCode = customClientSource ? minifySingleSource(customClientSource) : '';
    codeHash = minCode ? computeHash(minCode) : '';
  } else {
    const compiled = readCompiledOmniClient();
    minCode = compiled.minCode;
    codeHash = compiled.codeHash;
  }

  const metaJson = JSON.stringify(serverMeta && typeof serverMeta === 'object' ? serverMeta : null);
  const hashJson = JSON.stringify(codeHash);
  const verJson = JSON.stringify(PLUGIN_VERSION);

  return `(() => {
    try {
      const loc = typeof window !== 'undefined' && window.location;
      const href = loc && typeof loc.href === 'string' ? loc.href : '';
      if (href) {
        const low = href.toLowerCase();
        if (low.startsWith('devtools://') || low.startsWith('data:') || low.startsWith('chrome:') || low.startsWith('chrome-extension:') || low.startsWith('edge:') || low.startsWith('blob:') || low.startsWith('plugin:')) {
          return { ok: false, status: 'skipped-non-host' };
        }
        if (low.startsWith('vscode-file://') || low.startsWith('app://') || low.startsWith('about:')) {
          if (/\\b(?:Untitled|launchpad)\\b/i.test(String(document.title || '') + ' ' + href)) {
            return { ok: false, status: 'skipped-non-host' };
          }
        }
        if (low.startsWith('http:') || low.startsWith('https:')) {
          const m = /^(https?):\\/\\/(127\\.0\\.0\\.1|localhost|\\[::1\\])(?::\\d+)?(\\/|$)/i.exec(href);
          if (!m) return { ok: false, status: 'skipped-non-host' };
          const hasMarker =
            /\\bantigravity\\b/i.test(String(document.title || '')) ||
            Boolean(document.body && document.body.classList && document.body.classList.contains('theme-standalone')) ||
            Boolean(document.querySelector && document.querySelector('.agy-home, [data-testid="conversation-view"], [data-testid="agent-input-box"], [data-testid="model-selector-trigger"], .monaco-workbench'));
          if (!hasMarker && (m[1].toLowerCase() === 'http' || String(document.readyState || '') === 'complete')) {
            return { ok: false, status: 'skipped-non-host' };
          }
        }
      }
    } catch {}

    const serverMeta = ${metaJson};
    window.__agPrismOmniServerMeta = serverMeta;

    if (!window.__agPrismOmniBridge || !window.__agPrismOmniBridge.__prismBridgeReady) {
      try { window.__agPrismOmniBridge?.dispose?.(); } catch {}
      const pending = new Map();
      let seq = 0;
      const sendOmniRpc = (reqObj, timeoutMs = 15000) => {
        const payload = reqObj && typeof reqObj === 'object' ? { ...reqObj } : { action: String(reqObj || 'getServerInfo') };
        const act = payload.action || 'getServerInfo';
        if (act === 'getServerInfo' && window.__agPrismOmniServerMeta && window.__agPrismOmniServerMeta.baseUrl) {
          return Promise.resolve({ ok: true, ...window.__agPrismOmniServerMeta });
        }
        if (typeof window.${OMNI_BINDING} !== 'function') {
          return Promise.resolve({ ok: false, offline: true, action: act, error: 'Omni daemon offline' });
        }
        return new Promise((resolve) => {
          if (pending.size >= 32) {
            resolve({ ok: false, busy: true, action: act });
            return;
          }
          const id = ++seq;
          const timer = setTimeout(() => {
            pending.delete(id);
            resolve({ ok: false, timeout: true, action: act });
          }, timeoutMs);
          pending.set(id, { resolve, timer });
          try {
            window.${OMNI_BINDING}(JSON.stringify({ id, ...payload, action: act, input: payload }));
          } catch (err) {
            clearTimeout(timer);
            pending.delete(id);
            resolve({ ok: false, action: act, error: String(err && err.message ? err.message : err) });
          }
        });
      };
      const bridge = {
        __prismBridgeReady: true,
        isOnline: () => typeof window.${OMNI_BINDING} === 'function',
        getServerMeta: () => window.__agPrismOmniServerMeta || null,
        call: sendOmniRpc,
        getServerInfo: () => sendOmniRpc({ action: 'getServerInfo' }, 6000),
        resolvePath: (opts) => sendOmniRpc({ ...(typeof opts === 'string' ? { rawPath: opts } : opts), action: 'resolvePath' }, 8000),
        revealInFolder: (opts) => sendOmniRpc({ ...(typeof opts === 'string' ? { path: opts } : opts), action: 'revealInFolder' }, 10000),
        openExternal: (opts) => sendOmniRpc({ ...(typeof opts === 'string' ? { target: opts } : opts), action: 'openExternal' }, 10000),
        readTextSlice: (opts) => sendOmniRpc({ ...(typeof opts === 'string' ? { path: opts } : opts), action: 'readTextSlice' }, 15000),
        resolve: (id, res) => {
          const item = pending.get(id);
          if (!item) return;
          clearTimeout(item.timer);
          pending.delete(id);
          item.resolve(res);
        },
        dispose: () => {
          for (const item of pending.values()) {
            clearTimeout(item.timer);
            item.resolve({ ok: false, disposed: true });
          }
          pending.clear();
        },
      };
      window.__agPrismOmniBridge = bridge;
      if (typeof window.__agPrismOmniResolve !== 'function') {
        window.__agPrismOmniResolve = bridge.resolve;
      }
    }

    const omniHash = ${hashJson};
    if (!omniHash) {
      return { ok: true, status: 'bridge-only', version: ${verJson} };
    }
    let omniStatus = 'deferred';
    const mountOmni = () => {
      const prismApi = window.__agPrism || window.__agClaudeStyle;
      const st = prismApi && typeof prismApi.getState === 'function' ? prismApi.getState() : null;
      const cfg = (st && st.cfg) || {};
      const existing = window.__agPrismOmni;
      const reused = Boolean(existing && existing.codeHash === omniHash && typeof existing.sync === 'function');
      if (!reused) {
        try { existing?.destroy?.(); } catch {}
        ${minCode};
        if (window.__agPrismOmni && typeof window.__agPrismOmni === 'object') {
          window.__agPrismOmni.codeHash = omniHash;
        }
      }
      if (cfg.omniModule === 'off') {
        try { window.__agPrismOmni?.sync?.(cfg, serverMeta); } catch {}
        omniStatus = 'disabled';
        return;
      }
      omniStatus = reused ? 'synced' : window.__agPrismOmni ? 'mounted' : 'ready';
      try { window.__agPrismOmni?.sync?.(cfg, serverMeta); } catch {}
    };
    if (document.documentElement) {
      mountOmni();
    } else {
      document.addEventListener('DOMContentLoaded', mountOmni, { once: true });
    }
    return { ok: true, status: omniStatus, version: ${verJson}, codeHash: omniHash };
  })()`;
}

const REMOVE_EXPRESSION = `(() => {
  try {
    if (window.__agPrismTelemetry && typeof window.__agPrismTelemetry.destroy === 'function') {
      window.__agPrismTelemetry.destroy();
    }
  } catch (e) {}
  try {
    if (window.__agPrismEffortSlider && typeof window.__agPrismEffortSlider.destroy === 'function') {
      window.__agPrismEffortSlider.destroy();
    }
  } catch (e) {}
  try {
    if (window.__agPrismThought && typeof window.__agPrismThought.destroy === 'function') {
      window.__agPrismThought.destroy();
    }
  } catch (e) {}
  try {
    if (window.__agPrismOmni && typeof window.__agPrismOmni.destroy === 'function') {
      window.__agPrismOmni.destroy();
    }
  } catch (e) {}
  if (Array.isArray(globalThis.__agCsCleanups)) {
    while (globalThis.__agCsCleanups.length) {
      const fn = globalThis.__agCsCleanups.pop();
      try {
        if (typeof fn === 'function') fn();
      } catch (e) {}
    }
  }
  delete globalThis.__agCsCleanups;
  try {
    if (window.__agPrism && typeof window.__agPrism.destroy === 'function') {
      window.__agPrism.destroy();
    } else if (window.__agClaudeStyle && typeof window.__agClaudeStyle.destroy === 'function') {
      window.__agClaudeStyle.destroy();
    }
  } catch (e) {}
  if (window.__agCsI18n && typeof window.__agCsI18n.destroy === 'function') {
    window.__agCsI18n.destroy();
  }
  try {
    if (window.__agPrismRepoBridge && typeof window.__agPrismRepoBridge.dispose === 'function') {
      window.__agPrismRepoBridge.dispose();
    }
  } catch (e) {}
  try {
    if (window.__agPrismThoughtBridge && typeof window.__agPrismThoughtBridge.dispose === 'function') {
      window.__agPrismThoughtBridge.dispose();
    }
  } catch (e) {}
  try {
    if (window.__agPrismUsageBridge && typeof window.__agPrismUsageBridge.dispose === 'function') {
      window.__agPrismUsageBridge.dispose();
    }
  } catch (e) {}
  try {
    if (window.__agPrismOmniBridge && typeof window.__agPrismOmniBridge.dispose === 'function') {
      window.__agPrismOmniBridge.dispose();
    }
  } catch (e) {}
  delete window.__agPrism;
  delete window.__agClaudeStyle;
  delete window.__agPrismTelemetry;
  delete window.__agPrismEffortSlider;
  delete window.__agPrismThought;
  delete window.__agPrismOmni;
  delete window.__agPrismOmniBridge;
  delete window.__agPrismOmniResolve;
  delete window.__agPrismOmniServerMeta;
  delete window.__agPrismMetricsResolve;
  delete window.__agPrismRepoBridge;
  delete window.__agPrismRepoResolve;
  delete window.__agPrismThoughtBridge;
  delete window.__agPrismThoughtOnChunk;
  delete window.__agPrismThoughtResolve;
  delete window.__agPrismUsageBridge;
  delete window.__agPrismUsageResolve;
  delete window.__agPrismBrandLogoSvg;
  delete window.__agCsI18n;
  delete globalThis.__agSP;
  delete globalThis.__agM;
  delete globalThis.__agPrismBrandLogoSvg;
  delete globalThis.__agPrismTelemetry;
  delete globalThis.__agPrismEffortSlider;
  delete globalThis.__agPrismThought;
  delete globalThis.__agPrismOmni;
  delete globalThis.__agPrismThoughtSettingsUi;
  delete globalThis.__agPrismSettingsPanel;
  delete globalThis.__agPrismHomeStudioPanel;
  delete globalThis.__agPrismHomeRippleHost;
  delete globalThis.__agPrismModelGlyphCrystal;
  delete globalThis.__agPrismStreamChoreography;
  delete globalThis.__agPrismRimCanvas;
  delete globalThis.__agPrismHostEnhancer;
  delete globalThis.__agPrismConvAura;
  delete globalThis.__agPrismSmoothCaret;
  delete globalThis.__opChromaGatesSession;
  delete globalThis.AntigravityCodexEffortSlider;
  delete globalThis.__agCodexEffortSliderDisableAutoBoot;
  delete globalThis.__agCsUiMain;
  delete globalThis.__agDualMascotRig;
  delete globalThis.__agCrystalPrismCore;
  delete globalThis.__agVialCore;
  delete globalThis.__agMotionEngine;
  delete globalThis.__agAnimatedIcons;
  delete globalThis.__agCsPulseVialBridge;
  delete globalThis.__agCsCrabAssets;
  delete globalThis.__agCsMascotCore;
  delete globalThis.__agCsRippleCore;
  delete globalThis.__agCsUsageCore;
  delete globalThis.__agCsEffortCore;
  delete globalThis.__agCsPerfAssets;
  delete globalThis.__agCsI18nCore;
  delete globalThis.__agCsLocales;
  const root = document.documentElement;
  if (root) {
    [
      'data-ag-prism',
      'data-ag-cs-style',
      'data-ag-cs-theme',
      'data-ag-cs-palette',
      'data-ag-cs-light-preset',
      'data-ag-cs-motion',
      'data-ag-cs-target-fps',
      'data-ag-cs-telemetry',
      'data-ag-cs-effort-slider',
      'data-ag-cs-thought-translate',
      'data-ag-prism-thought-owner',
      'data-ag-cs-home',
      'data-ag-cs-composer',
      'data-ag-cs-logo-ink',
      'data-ag-cs-sidebar',
      'data-ag-cs-sidebar-compact',
      'data-ag-cs-sidebar-collapsed',
      'data-ag-cs-has-crab',
      'data-ag-cs-lang',
      'data-ag-cs-cjk',
      'data-ag-cs-effort-accent',
      'data-ag-cs-perf-backdrop',
      'data-ag-cs-accent',
      'data-ag-cs-corners',
      'data-ag-cs-code-font',
      'data-ag-cs-ligatures',
      'data-ag-cs-ambient',
      'data-ag-prism-thought-view',
      'data-ag-prism-omni',
      'data-ag-prism-link-target',
    ].forEach((attr) => root.removeAttribute(attr));
    if (root.getAttribute('data-ag-cjk') === '1') root.removeAttribute('data-ag-cjk');
    if (root.style && typeof root.style.removeProperty === 'function') {
      root.style.removeProperty('--ag-spring-sidebar-ease');
      root.style.removeProperty('--ag-spring-sidebar-dur');
    }
  }
  const chunkParents = new Set();
  Array.from(document.querySelectorAll('.ag-cs-stream-chunk, .ag-cs-thought-chunk, .ag-cs-code-scan'))
    .reverse()
    .forEach((el) => {
      const p = el.parentNode;
      if (el.classList) {
        el.classList.remove('ag-cs-stream-chunk', 'ag-cs-thought-chunk', 'ag-cs-code-scan');
      }
      const isPureSpan =
        el.tagName === 'SPAN' &&
        (!el.classList || el.classList.length === 0) &&
        (!el.attributes ||
          Array.from(el.attributes).every(
            (a) => a.name === 'class' || a.name.startsWith('data-ag-cs-')
          ));
      if (isPureSpan && p) {
        while (el.firstChild) p.insertBefore(el.firstChild, el);
        el.remove();
        chunkParents.add(p);
      } else {
        if (el.getAttribute && el.getAttribute('class') === '') el.removeAttribute('class');
        if (typeof el.normalize === 'function') el.normalize();
      }
    });
  chunkParents.forEach((p) => {
    if (p && typeof p.normalize === 'function') p.normalize();
  });
  document.querySelectorAll('[data-ag-cs-icon-injected]').forEach((btn) => {
    btn.querySelectorAll('.ag-anim-icon').forEach((ic) => ic.remove());
    btn.querySelectorAll('[data-ag-cs-orig-svg]').forEach((svg) => {
      svg.hidden = false;
      svg.removeAttribute('hidden');
      svg.removeAttribute('data-ag-cs-orig-svg');
    });
    btn.removeAttribute('data-ag-cs-icon-injected');
  });
  [
    'data-ag-cs-caustic',
    'data-ag-cs-fiber-camp',
    'data-ag-cs-sonar',
    'data-ag-cs-stage-glide',
    'data-ag-cs-liftoff-bubble',
    'data-ag-cs-thought-streaming',
    'data-ag-cs-spark-streaming',
    'data-ag-cs-prism-cv',
    'data-ag-cs-code-folded',
  ].forEach((attr) => {
    document.querySelectorAll('[' + attr + ']').forEach((el) => el.removeAttribute(attr));
  });
  document.querySelectorAll('[data-ag-cs-prism-box]').forEach((el) => {
    el.removeAttribute('data-ag-cs-prism-box');
    if (el.style && typeof el.style.removeProperty === 'function') {
      el.style.removeProperty('--ag-px');
      el.style.removeProperty('--ag-py');
    }
  });
  document.querySelectorAll('[data-ag-cs-orch-active]').forEach((el) => el.removeAttribute('data-ag-cs-orch-active'));
  document.querySelectorAll('[data-ag-cs-auto-unfolded]').forEach((el) => el.removeAttribute('data-ag-cs-auto-unfolded'));
  // Only remove Prism-owned fallback nodes & styles; NEVER touch external Pulse or external Effort Slider instances!
  document.querySelectorAll('[data-ag-prism-fallback="1"]').forEach((n) => n.remove());
  document.querySelectorAll('[data-ag-prism-hidden="1"]').forEach((hiddenExtPulse) => {
    hiddenExtPulse.removeAttribute('data-ag-prism-hidden');
    if (hiddenExtPulse.style && typeof hiddenExtPulse.style.removeProperty === 'function') {
      hiddenExtPulse.style.removeProperty('display');
    }
  });
  const prismSliderStyle = document.querySelector('#ag-codex-effort-slider-styles[data-ag-prism-slider="1"]');
  if (prismSliderStyle) prismSliderStyle.remove();
  const prismHideSlider = document.getElementById('ag-prism-effort-slider-hide');
  if (prismHideSlider) prismHideSlider.remove();
  const nodes = document.querySelectorAll(
    '#' + ${JSON.stringify(STYLE_ID)} +
    ', #' + ${JSON.stringify(LEGACY_STYLE_ID)} +
    ', #ag-prism-settings-v101-css, #ag-prism-omni-css, #ag-cs-settings-sec, .ag-omni-dock, .ag-omni-menu, .ag-prism-omni-menu, .ag-prism-omni-pane, [data-ag-prism-omni-owned="1"], .ag-cs-home-panel, .ag-cs-home-panel-seat, .ag-cs-ripple-layer, .ag-cs-ripple-host, .ag-cs-conv-aura-host, .ag-cs-crab, .ag-cs-mascot, .ag-v2-mascot-stage, .ag-cs-crystal-bar, [data-testid="orchestrator-effort-bar"], .ag-cs-prism-rim-cv, .ag-cs-code-fold-btn, .ag-cs-nav-outline-popover, .ag-cs-smooth-caret, .ag-cs-perf-backdrop'
  );
  nodes.forEach((n) => n.remove());
  return { removed: nodes.length };
})()`;

module.exports = {
  STYLE_ID,
  LEGACY_STYLE_ID,
  PLUGIN_VERSION,
  SETTING_BINDING,
  LEGACY_SETTING_BINDING,
  OMNI_BINDING,
  PORT_FILE,
  PID_FILE,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  VALIDATORS,
  validateConfigEntry,
  reconcileConfigAliases,
  isEligibleTarget,
  readPidFromLockFile,
  isExpectedDaemonProcess,
  RUNTIME_PARTS,
  SYNC_ROOT_FILES,
  REMOVE_EXPRESSION,
  readConfig,
  readCss,
  readPort,
  listPages,
  getBrowserWsUrl,
  CdpSession,
  minifyCss,
  minifyJs,
  prepareRuntimePart,
  computeHash,
  buildConfigRefreshExpression,
  buildInjectExpression,
  buildOmniClientExpression,
};
