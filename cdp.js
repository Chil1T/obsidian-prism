// Chrome DevTools Protocol (CDP) & zero-dependency bundle compiler for Obsidian Prism (obsidian-prism).
// Node >= 22: uses built-in fetch and WebSocket (zero external dependencies).
const fs = require('fs');
const os = require('os');
const path = require('path');

const STYLE_ID = 'ag-prism-css';
const LEGACY_STYLE_ID = 'ag-claude-style-css';
const PLUGIN_VERSION = '1.0.0';
const SETTING_BINDING = '__agPrismSetting';
const LEGACY_SETTING_BINDING = '__agClaudeStyleSetting';
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
  lang: 'auto',
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
  ringMode: 'context',
  effortSliderStyle: 'claude',
  effortAccent: true,
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
  ringMode: ['context', 'quota'],
  effortSliderStyle: ['claude', 'chatgpt', 'liangwufeng'],
  effortAccent: 'boolean',
};

function validateConfigEntry(key, value) {
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

function readConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
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

async function listPages(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(2000),
  });
  const targets = await res.json();
  return targets.filter(
    (t) =>
      t.type === 'page' &&
      t.webSocketDebuggerUrl &&
      !t.url.startsWith('devtools://') &&
      !t.url.startsWith('data:')
  );
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
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('CDP connection closed'));
      }
      this.pending.clear();
      if (this.onClose) this.onClose();
    });
  }

  static connect(wsUrl, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('CDP connect timeout'));
      }, timeoutMs);
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
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
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
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'MutationObserver', 'IntersectionObserver',
  'ResizeObserver', 'PerformanceObserver', 'AbortController', 'AbortSignal', 'getComputedStyle', 'matchMedia',
  'getSelection', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'visualViewport', 'fetch', 'WebSocket',
  'Worker', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData', 'Headers', 'Request', 'Response',
  'TextEncoder', 'TextDecoder', 'crypto', 'console', 'module', 'exports', 'require', 'Promise', 'Object',
  'Array', 'String', 'Number', 'Boolean', 'BigInt', 'Math', 'Date', 'JSON', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'ArrayBuffer', 'DataView', 'Uint8ClampedArray', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array',
  'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'Intl', 'Error', 'TypeError', 'RangeError',
  'SyntaxError', 'RegExp', 'Symbol', 'Proxy', 'Reflect', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'parseInt', 'parseFloat', 'isFinite', 'isNaN', 'CSS', 'Node', 'NodeFilter',
  'Element', 'HTMLElement', 'SVGElement', 'DocumentFragment', 'ShadowRoot', 'Event', 'CustomEvent',
  'MouseEvent', 'KeyboardEvent', 'PointerEvent', 'Image', 'ImageData', 'OffscreenCanvas',
  'CanvasRenderingContext2D', 'WebGL2RenderingContext', 'WebGLRenderingContext',
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

function packCssJsExpr(css) {
  const TOKEN_BASE = 0x0100;
  const MAX_DICT = 820;
  for (let k = 0; k < MAX_DICT; k++) {
    if (css.includes(String.fromCharCode(TOKEN_BASE + k))) {
      return JSON.stringify(css);
    }
  }

  let work = css;
  for (let p = 0; p < PROTECTED_CSS_LITERALS.length; p++) {
    if (work.includes(String.fromCharCode(0xe000 + p))) return JSON.stringify(css);
    work = work.split(PROTECTED_CSS_LITERALS[p]).join(String.fromCharCode(0xe000 + p));
  }

  const dict = [];
  const pickBestAndReplace = (freq, minGain) => {
    const top = [];
    for (const [phrase, approxCount] of freq.entries()) {
      if (approxCount < 2) continue;
      const estBytes = phrase.length;
      const estGain = approxCount * (estBytes - 2) - (estBytes + 4);
      if (estGain <= minGain) continue;
      if (top.length < 6 || estGain > top[top.length - 1].estGain) {
        top.push({ phrase, estGain });
        top.sort((a, b) => b.estGain - a.estGain);
        if (top.length > 6) top.pop();
      }
    }
    let bestPhrase = '';
    let bestGain = minGain;
    for (let t = 0; t < top.length; t++) {
      const phrase = top[t].phrase;
      const realCount = work.split(phrase).length - 1;
      if (realCount < 2) continue;
      const pBytes = Buffer.byteLength(JSON.stringify(phrase), 'utf8') - 2;
      const gain = realCount * (pBytes - 2) - (pBytes + 3);
      if (gain > bestGain) {
        bestGain = gain;
        bestPhrase = phrase;
      }
    }
    if (!bestPhrase) return false;
    const tok = String.fromCharCode(TOKEN_BASE + dict.length);
    work = work.split(bestPhrase).join(tok);
    dict.push(bestPhrase);
    return true;
  };

  const clauseRe = /[^{};,\uE000-\uE00F]{5,56}[{};,]?/g;
  while (dict.length < 320) {
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
    if (!pickBestAndReplace(freq, 8)) break;
  }

  for (const winLen of [22, 14, 9, 6, 4, 3]) {
    while (dict.length < MAX_DICT) {
      const freq = new Map();
      for (let i = 0; i + winLen <= work.length; i++) {
        const sub = work.slice(i, i + winLen);
        if (sub.charCodeAt(0) >= 0xe000 && sub.charCodeAt(0) <= 0xe00f) continue;
        if (/[\uE000-\uE00F]/.test(sub)) continue;
        freq.set(sub, (freq.get(sub) || 0) + 1);
      }
      if (!pickBestAndReplace(freq, 6)) break;
    }
  }

  for (let p = 0; p < PROTECTED_CSS_LITERALS.length; p++) {
    work = work.split(String.fromCharCode(0xe000 + p)).join(PROTECTED_CSS_LITERALS[p]);
  }
  if (dict.length === 0) return serializeJsValue(css);
  return `(()=>{let s=${serializeJsValue(work)};const d=${serializeJsValue(dict)};for(let i=d.length-1;i>=0;i--)s=s.split(String.fromCharCode(${TOKEN_BASE}+i)).join(d[i]);return s})()`;
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
          .replace(/\s*([{}();,=+\-*/<>?:])\s*/g, '$1')
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
      lastOp === '++' ||
      lastOp === '--' ||
      lastOp === ')' ||
      lastOp === ']' ||
      lastOp === '.' ||
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
      let inClass = false;
      let validRegex = false;
      while (j < n) {
        const rc = src[j];
        if (rc === '\n' || rc === '\r') break;
        if (rc === '\\') {
          if (j + 1 >= n || src[j + 1] === '\n' || src[j + 1] === '\r') break;
          j += 2;
          continue;
        }
        if (rc === '[') inClass = true;
        else if (rc === ']') inClass = false;
        else if (rc === '/' && !inClass) {
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
    if (isIdChar(ch)) {
      let j = i + 1;
      while (j < n && isIdChar(src[j])) j++;
      const word = src.slice(i, j);
      const isNum = ch >= '0' && ch <= '9';
      tokens.push({ type: isNum ? 'lit' : 'id', val: word });
      lastWord = word;
      lastOp = '';
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
      lastOp = '.';
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
  const counts = new Map();
  const bStack = [];
  const declDepths = new Set();

  for (let i = 0; i < sig.length; i++) {
    const t = sig[i];
    const prev = i > 0 ? sig[i - 1] : null;
    const prev2 = i > 1 ? sig[i - 2] : null;
    const next = i + 1 < sig.length ? sig[i + 1] : null;

    if (t.type === 'punc') {
      if (t.val === '(') bStack.push('(');
      else if (t.val === '[') bStack.push('[');
      else if (t.val === '{') {
        const isBlock = !prev || BLOCK_PREV_TOKENS.has(prev.val);
        bStack.push(isBlock ? '{_blk' : '{_obj');
      } else if (t.val === ')' || t.val === ']' || t.val === '}') {
        declDepths.delete(bStack.length);
        bStack.pop();
      } else if (t.val === ';') {
        declDepths.delete(bStack.length);
      }
      continue;
    }

    if (t.type !== 'id') continue;
    const name = t.val;
    if (name === 'const' || name === 'let' || name === 'var') {
      declDepths.add(bStack.length);
      continue;
    }
    if (JS_KEYWORDS.has(name)) {
      if (name !== 'in' && name !== 'of' && name !== 'typeof' && name !== 'void' && name !== 'new' && name !== 'await') {
        declDepths.delete(bStack.length);
      }
      continue;
    }
    if (name.startsWith('__ag') || name === 'AntigravityCodexEffortSlider') {
      unsafe.add(name);
      continue;
    }
    counts.set(name, (counts.get(name) || 0) + 1);

    const topBracket = bStack.length > 0 ? bStack[bStack.length - 1] : '{_blk';

    if (prev && (prev.val === '.' || prev.val === '?.')) {
      unsafe.add(name);
      continue;
    }
    if (next && next.val === ':') {
      unsafe.add(name);
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
      continue;
    }
    if (
      next &&
      next.val === '(' &&
      (!prev || prev.val !== 'function') &&
      prev &&
      (prev.val === '}' || prev.val === '{' || prev.val === ';' || prev.val === ',') &&
      (topBracket === '{_obj' || prev.val === ',')
    ) {
      unsafe.add(name);
      continue;
    }
    if (next && next.val === '(' && prev && (prev.val === 'get' || prev.val === 'set' || prev.val === 'async')) {
      if (!prev2 || prev2.val !== 'function') {
        unsafe.add(name);
        continue;
      }
    }

    if (
      declDepths.has(bStack.length) &&
      prev &&
      (prev.val === 'const' || prev.val === 'let' || prev.val === 'var' || prev.val === ',') &&
      next &&
      (next.val === '=' || next.val === ';' || next.val === ',' || next.val === 'of' || next.val === 'in' || next.val === ')')
    ) {
      if (name.length >= 2) declared.add(name);
    }
    if (prev && prev.val === 'function' && next && next.val === '(') {
      if (name.length >= 2) declared.add(name);
    }
    if (next && next.val === '=>' && (!prev || (prev.val !== '.' && prev.val !== '?.'))) {
      if (name.length >= 2) declared.add(name);
    }
    if (prev && prev.val === '(' && prev2 && prev2.val === 'catch' && next && next.val === ')') {
      if (name.length >= 2) declared.add(name);
    }
  }

  for (let i = 0; i < sig.length; i++) {
    if (sig[i].val !== '(') continue;
    const prev = i > 0 ? sig[i - 1] : null;
    const prev2 = i > 1 ? sig[i - 2] : null;
    const isFnParams =
      (prev && prev.val === 'function') ||
      (prev && prev.type === 'id' && prev2 && prev2.val === 'function');
    let depth = 1;
    let j = i + 1;
    const paramCandidates = [];
    let simpleList = true;
    while (j < sig.length && depth > 0) {
      const tk = sig[j];
      if (tk.val === '(') depth++;
      else if (tk.val === ')') depth--;
      else if (depth === 1 && tk.type === 'id') {
        const pPrev = sig[j - 1];
        const pNext = sig[j + 1];
        if (
          pPrev &&
          (pPrev.val === '(' || pPrev.val === ',' || pPrev.val === '...') &&
          pNext &&
          (pNext.val === ',' || pNext.val === ')' || pNext.val === '=')
        ) {
          if (tk.val.length >= 2) paramCandidates.push(tk.val);
        }
      } else if (depth === 1 && (tk.val === '{' || tk.val === '[')) {
        simpleList = false;
      }
      j++;
    }
    const afterClose = j < sig.length ? sig[j] : null;
    if ((isFnParams || (afterClose && afterClose.val === '=>')) && simpleList) {
      for (const pn of paramCandidates) declared.add(pn);
    }
  }

  const existingIds = new Set(counts.keys());
  const nextShortName = createShortNameGen(existingIds, unsafe);

  const candidates = [];
  for (const name of declared) {
    if (unsafe.has(name)) continue;
    const c = counts.get(name) || 0;
    const estSave = c * (name.length - 2);
    if (estSave >= 3) candidates.push({ name, c, estSave });
  }
  candidates.sort((a, b) => b.estSave - a.estSave);

  const renameMap = new Map();
  for (const cand of candidates) {
    const short = nextShortName();
    if (cand.c * (cand.name.length - short.length) >= 2) {
      renameMap.set(cand.name, short);
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'id' && renameMap.has(tokens[i].val)) {
      tokens[i].val = renameMap.get(tokens[i].val);
    }
  }

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
    if (tk.type === 'id' && (tk.val === 'true' || tk.val === 'false')) {
      const ns = nextS[i];
      const afterDot = prevS && (prevS.val === '.' || prevS.val === '?.');
      const beforeKey = ns && (ns.val === ':' || ns.val === '(' || ns.val === '.');
      if (!afterDot && !beforeKey && prevS && SAFE_BOOL_PREV.has(prevS.val)) {
        tk.type = 'punc';
        tk.val = tk.val === 'true' ? '!0' : '!1';
      }
    }
    prevS = tk;
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
    } else if (e === 'u' && /^[0-9a-fA-F]{4}/.test(lit.slice(i + 1, i + 5))) {
      const code = parseInt(lit.slice(i + 1, i + 5), 16);
      if (code >= 0xd800 && code <= 0xdfff) return null;
      out += String.fromCharCode(code);
      i += 4;
    } else {
      return null;
    }
  }
  return out;
}

function packTextJsExpr(text, maxDict = 620) {
  const TOKEN_BASE = 0x0100;
  const usedInText = new Set();
  for (let i = 0; i < text.length; i++) {
    const cc = text.charCodeAt(i);
    if (cc >= 0x0100 && cc <= 0x07ff) usedInText.add(cc);
  }
  const freeTokens = [];
  for (let cc = 0x0100; cc <= 0x077f && freeTokens.length < maxDict; cc++) {
    if (!usedInText.has(cc)) freeTokens.push(String.fromCharCode(cc));
  }
  if (freeTokens.length < 16) return JSON.stringify(text);

  const contiguous = usedInText.size === 0;
  let work = text;
  const dict = [];
  const tokChars = [];

  const pickBest = (freq, minGain) => {
    if (dict.length >= freeTokens.length) return false;
    const top = [];
    for (const [phrase, approx] of freq.entries()) {
      if (approx < 2) continue;
      let estBytes = 0;
      for (let k = 0; k < phrase.length; k++) {
        const cc = phrase.charCodeAt(k);
        estBytes += cc < 0x80 ? 1 : cc < 0x800 ? 2 : 3;
      }
      const estGain = approx * (estBytes - 2) - (estBytes + 4);
      if (estGain <= minGain) continue;
      if (top.length < 6 || estGain > top[top.length - 1].estGain) {
        top.push({ phrase, estGain });
        top.sort((a, b) => b.estGain - a.estGain);
        if (top.length > 6) top.pop();
      }
    }
    let bestPhrase = '';
    let bestGain = minGain;
    for (let t = 0; t < top.length; t++) {
      const phrase = top[t].phrase;
      const realCount = work.split(phrase).length - 1;
      if (realCount < 2) continue;
      const pBytes = Buffer.byteLength(JSON.stringify(phrase), 'utf8') - 2;
      const dictExtra = contiguous ? 3 : 5;
      const gain = realCount * (pBytes - 2) - (pBytes + dictExtra);
      if (gain > bestGain) {
        bestGain = gain;
        bestPhrase = phrase;
      }
    }
    if (!bestPhrase) return false;
    const tok = freeTokens[dict.length];
    work = work.split(bestPhrase).join(tok);
    dict.push(bestPhrase);
    tokChars.push(tok);
    return true;
  };

  const wordRe = /[A-Za-z0-9_.#\-:;()=,{}\[\]\/ <>"']{4,36}/g;
  while (dict.length < Math.min(240, freeTokens.length)) {
    const freq = new Map();
    const matches = work.match(wordRe);
    if (!matches) break;
    for (let m = 0; m < matches.length; m++) {
      freq.set(matches[m], (freq.get(matches[m]) || 0) + 1);
    }
    if (!pickBest(freq, 7)) break;
  }

  for (const winLen of [18, 11, 7, 4, 3, 2]) {
    while (dict.length < freeTokens.length) {
      const freq = new Map();
      for (let i = 0; i + winLen <= work.length; i++) {
        const sub = work.slice(i, i + winLen);
        const c0 = sub.charCodeAt(0);
        const cLast = sub.charCodeAt(winLen - 1);
        if ((c0 >= 0xdc00 && c0 <= 0xdfff) || (cLast >= 0xd800 && cLast <= 0xdbff)) continue;
        freq.set(sub, (freq.get(sub) || 0) + 1);
      }
      if (!pickBest(freq, 6)) break;
    }
  }

  const rawExpr = serializeJsValue(text);
  if (dict.length === 0) return rawExpr;
  const packed = contiguous
    ? `(()=>{let s=${serializeJsValue(work)};const d=${serializeJsValue(dict)};for(let i=d.length-1;i>=0;i--)s=s.split(String.fromCharCode(${TOKEN_BASE}+i)).join(d[i]);return s})()`
    : `(()=>{let s=${serializeJsValue(work)};const k=${serializeJsValue(tokChars.join(''))},d=${serializeJsValue(dict)};for(let i=d.length-1;i>=0;i--)s=s.split(k[i]).join(d[i]);return s})()`;
  return Buffer.byteLength(packed, 'utf8') + 12 < Buffer.byteLength(rawExpr, 'utf8') ? packed : rawExpr;
}

function internAndPackModuleStrings(tokens) {
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

  const SEP = '\x7f';
  const occurrences = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
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
        if (!body.includes('\\') && !body.includes('${')) {
          strVal = body;
          endIdx = i + 1;
        }
      }
    }
    if (strVal === null || strVal === 'use strict' || strVal.includes(SEP)) continue;
    const valBytes = Buffer.byteLength(strVal, 'utf8');
    if (valBytes < 4) continue;
    let hasLoneSurrogate = false;
    for (let k = 0; k < strVal.length; k++) {
      const cc = strVal.charCodeAt(k);
      if (cc >= 0xd800 && cc <= 0xdbff) {
        const nx2 = strVal.charCodeAt(k + 1);
        if (nx2 >= 0xdc00 && nx2 <= 0xdfff) {
          k++;
          continue;
        }
        hasLoneSurrogate = true;
        break;
      }
      if (cc >= 0xdc00 && cc <= 0xdfff) {
        hasLoneSurrogate = true;
        break;
      }
    }
    if (hasLoneSurrogate) continue;
    if (PROTECTED_BUNDLE_LITERALS.some((sub) => strVal.includes(sub))) continue;

    const p = prevSig[i];
    const nx = nextSig[endIdx];
    if (nx && nx.val === ':' && (!p || p.val !== 'case')) continue;
    if (nx && nx.val === '(') continue;
    if (p && (p.val === 'import' || p.val === 'from')) continue;

    let origBytes = Buffer.byteLength(t.val, 'utf8');
    if (endIdx > i) origBytes += Buffer.byteLength(tokens[endIdx].val, 'utf8');
    if (!occurrences.has(strVal)) occurrences.set(strVal, []);
    occurrences.get(strVal).push({ startIdx: i, endIdx, origBytes });
    i = endIdx;
  }

  const selected = [];
  for (const [strVal, list] of occurrences.entries()) {
    const valBytes = Buffer.byteLength(strVal, 'utf8');
    const count = list.length;
    const totalOrig = list.reduce((s, x) => s + x.origBytes, 0);
    if ((count >= 2 && totalOrig > valBytes + 4 + count * 2) || valBytes >= 14) {
      selected.push({ strVal, list, totalOrig });
    }
  }
  if (selected.length < 1) return null;

  selected.sort((a, b) => b.list.length - a.list.length || b.totalOrig - a.totalOrig);

  const usedIds = new Set();
  for (const tk of tokens) {
    if (tk.type === 'id') usedIds.add(tk.val);
  }
  const nextVar = createShortNameGen(usedIds, RESERVED_OR_GLOBAL);
  const varNames = selected.map(() => nextVar());

  const joined = selected.map((x) => x.strVal).join(SEP);
  const packedExpr = packTextJsExpr(joined, 720);

  const replaceAt = new Map();
  selected.forEach((item, idx) => {
    const ref = varNames[idx];
    for (const occ of item.list) {
      replaceAt.set(occ.startIdx, { endIdx: occ.endIdx, ref });
    }
  });

  const newTokens = [];
  for (let i = 0; i < tokens.length; i++) {
    const rep = replaceAt.get(i);
    if (rep) {
      newTokens.push({ type: 'id', val: rep.ref });
      i = rep.endIdx;
    } else {
      newTokens.push(tokens[i]);
    }
  }

  const bodyCode = serializeTokens(newTokens);
  return `{const[${varNames.join(',')}]=${packedExpr}.split(${JSON.stringify(SEP)});${bodyCode}}`;
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

function minifyEmbeddedCssTemplate(src) {
  return src.replace(/const CSS\s*=\s*`([\s\S]*?)`;/, (_, body) => {
    const slots = [];
    const safeBody = body.replace(/\$\{([^}]+)\}/g, (_m, expr) => {
      slots.push(expr);
      return `__AGTPL${slots.length - 1}__`;
    });
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

function prepareRuntimePart(partName, rawSource) {
  let prepped = rawSource;
  if (partName === 'pulse-vial-bridge.js') {
    prepped = minifyEmbeddedCssTemplate(prepped);
  } else if (partName === 'i18n-locales.js') {
    prepped = compactStaticStringArrayMap(prepped, 'UI_TABLE');
  } else if (partName === 'vendor/effort-slider/slider-coexist.js') {
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

const _partCache = new Map();
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

function readRuntimeBundle() {
  const brandMarkPath = path.join(__dirname, 'assets', 'brand-mark-svg.js');
  let prefixCode = '';
  if (fs.existsSync(brandMarkPath)) {
    const bSig = getFileSig(brandMarkPath);
    const bHit = _partCache.get('assets/brand-mark-svg.js');
    if (bHit && bHit.sig === bSig) {
      prefixCode = bHit.code + '\n';
    } else {
      const bCode = minifySingleSource(fs.readFileSync(brandMarkPath, 'utf8'));
      _partCache.set('assets/brand-mark-svg.js', { sig: bSig, code: bCode });
      prefixCode = bCode + '\n';
    }
  }
  return prefixCode + RUNTIME_PARTS.map((f) => {
    const p = path.join(__dirname, f);
    let extraSig = '';
    if (f === 'vendor/effort-slider/slider-coexist.js') {
      const up = path.join(__dirname, 'vendor', 'effort-slider', 'upstream-client.js');
      if (fs.existsSync(up)) extraSig = '|' + getFileSig(up);
    }
    const sig = getFileSig(p) + extraSig;
    const hit = _partCache.get(f);
    if (hit && hit.sig === sig) return hit.code;
    const code = prepareRuntimePart(f, fs.readFileSync(p, 'utf8'));
    _partCache.set(f, { sig, code });
    return code;
  }).join('\n');
}

function computeHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function buildInjectExpression(customConfig) {
  const config = customConfig || readConfig();
  const packedCss = readPackedCssExpr();
  const bundle = readRuntimeBundle();
  const codeHash = computeHash(bundle);
  return `(() => {
    const css = ${packedCss};
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
        if (window.__agPrismThoughtBridge && window.__agPrismThoughtBridge.__prismBridgeReady) return;
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
            if (pendingThought.size >= 16) {
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
                action: 'translate-stream',
                text: opts && opts.text ? opts.text : '',
                mode: (opts && opts.mode) || 'ai',
              },
              onPartial,
              50000
            ),
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
        if (window.__agPrismUsageBridge && window.__agPrismUsageBridge.__prismBridgeReady) return;
        const pendingUsage = new Map();
        let usageSeq = 0;
        const fetchBatch = (items, timeoutMs = 18000) => {
          if (typeof window.__agPrismUsageCall !== 'function') {
            return Promise.resolve({ ok: false, offline: true, records: [] });
          }
          return new Promise((resolve) => {
            if (pendingUsage.size >= 8) {
              resolve({ ok: false, busy: true, records: [] });
              return;
            }
            const id = ++usageSeq;
            const timer = setTimeout(() => {
              pendingUsage.delete(id);
              resolve({ ok: false, timeout: true, records: [] });
            }, timeoutMs);
            pendingUsage.set(id, { resolve, timer });
            try {
              window.__agPrismUsageCall(JSON.stringify({ id, items: Array.isArray(items) ? items : [] }));
            } catch (err) {
              clearTimeout(timer);
              pendingUsage.delete(id);
              resolve({ ok: false, error: String(err && err.message ? err.message : err), records: [] });
            }
          });
        };
        const bridge = {
          __prismBridgeReady: true,
          isOnline: () => typeof window.__agPrismUsageCall === 'function',
          fetchBatch,
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

    let status = 'ok';
    let mounted = false;
    const mount = () => {
      if (mounted || !document.documentElement) return;
      mounted = true;
      try {
        cleanupLegacyResidue();
        ensureRepoBridge();
        ensureThoughtBridge();
        ensureUsageBridge();
        if (document.head) applyStyle();
        else document.addEventListener('DOMContentLoaded', applyStyle, { once: true });
        ${bundle}
        const bootCfg = ${JSON.stringify({ ...config, binding: SETTING_BINDING, codeHash })};
        if (typeof globalThis.__agCsUiMain === 'function') {
          globalThis.__agCsUiMain(bootCfg);
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
        if (document.documentElement && !document.documentElement.hasAttribute('data-ag-prism')) {
          document.documentElement.setAttribute('data-ag-prism', ${JSON.stringify(PLUGIN_VERSION)});
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
  delete window.__agPrism;
  delete window.__agClaudeStyle;
  delete window.__agPrismTelemetry;
  delete window.__agPrismEffortSlider;
  delete window.__agPrismThought;
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
  delete globalThis.__agPrismBrandLogoSvg;
  delete globalThis.__agPrismTelemetry;
  delete globalThis.__agPrismEffortSlider;
  delete globalThis.__agPrismThought;
  delete globalThis.__agPrismThoughtSettingsUi;
  delete globalThis.__agPrismSettingsPanel;
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
      'data-ag-cs-palette',
      'data-ag-cs-light-preset',
      'data-ag-cs-motion',
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
  const fallbackPulse = document.querySelector('#ag-pulse-status-bar[data-ag-prism-fallback="1"]');
  if (fallbackPulse) fallbackPulse.remove();
  const hiddenExtPulse = document.querySelector('#ag-pulse-status-bar[data-ag-prism-hidden="1"]');
  if (hiddenExtPulse) {
    hiddenExtPulse.removeAttribute('data-ag-prism-hidden');
    if (hiddenExtPulse.style && typeof hiddenExtPulse.style.removeProperty === 'function') {
      hiddenExtPulse.style.removeProperty('display');
    }
  }
  const prismSliderStyle = document.querySelector('#ag-codex-effort-slider-styles[data-ag-prism-slider="1"]');
  if (prismSliderStyle) prismSliderStyle.remove();
  const prismHideSlider = document.getElementById('ag-prism-effort-slider-hide');
  if (prismHideSlider) prismHideSlider.remove();
  const nodes = document.querySelectorAll(
    '#' + ${JSON.stringify(STYLE_ID)} +
    ', #' + ${JSON.stringify(LEGACY_STYLE_ID)} +
    ', #ag-token-hud-style, #ag-cs-settings-sec, .ag-cs-home-panel, .ag-cs-ripple-layer, .ag-cs-conv-aura-host, .ag-cs-mascot, .ag-v2-mascot-stage, .ag-cs-crystal-bar, .ag-cs-smooth-caret, .ag-cs-inline-stats, .ag-cs-context-ring, .ag-cs-hud-top-bar, .ag-cs-hud-bottom-bar, .ag-cs-hud-rim-progress, .ag-cs-hud-footer-chip, .ag-cs-turn-bar, .ag-cs-effort-popover, .ag-cs-ctx-popover, .ag-cs-perf-backdrop, .ag-th-top-bar, .ag-th-bottom-bar, .ag-th-rim-progress, .ag-th-footer-chip, .ag-th-popover, .ag-th-turn-bar, .ag-th-reopen-pill'
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
  PORT_FILE,
  PID_FILE,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  VALIDATORS,
  validateConfigEntry,
  RUNTIME_PARTS,
  SYNC_ROOT_FILES,
  REMOVE_EXPRESSION,
  readConfig,
  readCss,
  readPort,
  listPages,
  CdpSession,
  minifyCss,
  minifyJs,
  prepareRuntimePart,
  computeHash,
  buildInjectExpression,
};
