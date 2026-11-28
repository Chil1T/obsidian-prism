// Local custom.css safe loader, @import blocker, SHA-256 fingerprint & template creator (L1, zero external deps)
'use strict';

const fs = require('fs');
const path = require('path');
const { sha256Text } = require('../utils/fs-safe.cjs');

const CUSTOM_CSS_FILENAME = 'custom.css';
const MAX_CUSTOM_CSS_BYTES = 256 * 1024; // 256 KiB hard safety cap (Issue #85)

// CSS Syntax Level 3 comment/string/escape-aware @import blocker (prevents remote URL exfiltration & backslash-escape bypasses while preserving comments and string literals)
const HEX_DIGIT_RE = /^[0-9a-fA-F]$/;
const CSS_IDENT_CHAR_RE = /^[A-Za-z0-9_-]$/;

function isCssIdentChar(ch) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return code >= 0x80 || CSS_IDENT_CHAR_RE.test(ch);
}

function decodeCssEscape(src, pos) {
  const n = src.length;
  if (pos + 1 >= n || src[pos + 1] === '\n') return null;
  let j = pos + 1;
  if (HEX_DIGIT_RE.test(src[j])) {
    let hex = '';
    while (j < n && hex.length < 6 && HEX_DIGIT_RE.test(src[j])) {
      hex += src[j++];
    }
    let consumedWs = false;
    if (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n')) {
      j += 1;
      consumedWs = true;
    }
    const cp = Number.parseInt(hex, 16);
    const ch = cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '\uFFFD' : String.fromCodePoint(cp);
    return { ch, next: j, consumedWs };
  }
  return { ch: src[j], next: j + 1, consumedWs: false };
}

function readCssAtKeyword(src, atPos) {
  const n = src.length;
  let i = atPos + 1;
  let ident = '';
  while (i < n) {
    const ch = src[i];
    if (ch === '\\') {
      const dec = decodeCssEscape(src, i);
      if (!dec) break;
      ident += dec.ch;
      i = dec.next;
      if (dec.consumedWs && ident.toLowerCase() === 'import') break;
    } else if (isCssIdentChar(ch)) {
      ident += ch;
      i += 1;
    } else {
      break;
    }
  }
  return { ident, next: i };
}

function skipCssComment(src, start) {
  const end = src.indexOf('*/', start + 2);
  return end === -1 ? src.length : end + 2;
}

function skipCssString(src, start) {
  const q = src[start];
  const n = src.length;
  let i = start + 1;
  while (i < n) {
    const ch = src[i];
    if (ch === '\\') {
      i += i + 1 < n ? 2 : 1;
    } else if (ch === q) {
      return i + 1;
    } else if (ch === '\n') {
      return i;
    } else {
      i += 1;
    }
  }
  return n;
}

function consumeAtImportStatement(src, start) {
  const n = src.length;
  let i = start;
  let parenDepth = 0;
  while (i < n) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '*') {
      i = skipCssComment(src, i);
    } else if (ch === '"' || ch === "'") {
      i = skipCssString(src, i);
    } else if (ch === '\\') {
      i += i + 1 < n ? 2 : 1;
    } else if (ch === '(') {
      parenDepth += 1;
      i += 1;
    } else if (ch === ')') {
      if (parenDepth > 0) parenDepth -= 1;
      i += 1;
    } else if (ch === ';' && parenDepth === 0) {
      return i + 1;
    } else if ((ch === '{' || ch === '}') && parenDepth === 0) {
      return i;
    } else {
      i += 1;
    }
  }
  return n;
}

const DEFAULT_CUSTOM_CSS_TEMPLATE = [
  '/* Obsidian Prism - User Custom CSS (custom.css)',
  ' *',
  ' * Saved changes hot-reload automatically (no Antigravity restart required).',
  ' * Preserved across plugin upgrades and reinstalls. Max size: 256 KB.',
  ' * Security: local CSS only (@import rules are blocked automatically).',
  ' *',
  ' * Priority order: custom.css (highest) > Code Font > Chat Font > UI Font.',
  ' * Override font variables below without needing !important everywhere:',
  ' */',
  '',
  '/* Example 1: Override global UI / Chat / Code font stacks',
  ':root {',
  '  --ag-prism-ui-font: "Inter", "PingFang SC", "Microsoft YaHei UI", sans-serif;',
  '  --ag-prism-chat-font: "Noto Serif SC", "Georgia", serif;',
  '  --ag-prism-code-font: "Maple Mono", "JetBrains Mono", ui-monospace, monospace;',
  '}',
  '*/',
  '',
  '/* Example 2: Comfortable chat reading line-height',
  'html[data-ag-cs-style] [data-testid="planner-response-text"] {',
  '  line-height: 1.72;',
  '}',
  '*/',
  '',
].join('\n');

function isPathStrictlyInside(rootReal, targetReal) {
  const rel = path.relative(rootReal, targetReal);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function sanitizeCustomCssContent(rawCss) {
  if (typeof rawCss !== 'string') return { css: '', blockedImports: 0 };
  const src = rawCss.replace(/^\uFEFF/, '').replace(/\0/g, '').replace(/\r\n?|\f/g, '\n');
  const n = src.length;
  let out = '';
  let chunkStart = 0;
  let i = 0;
  let blockedImports = 0;
  while (i < n) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '*') {
      i = skipCssComment(src, i);
    } else if (ch === '"' || ch === "'") {
      i = skipCssString(src, i);
    } else if (ch === '\\') {
      i += i + 1 < n ? 2 : 1;
    } else if (ch === '@') {
      const { ident, next } = readCssAtKeyword(src, i);
      if (ident.toLowerCase() === 'import') {
        out += src.slice(chunkStart, i) + '/* [obsidian-prism] blocked @import */';
        blockedImports += 1;
        i = consumeAtImportStatement(src, next);
        chunkStart = i;
      } else {
        i = next > i ? next : i + 1;
      }
    } else {
      i += 1;
    }
  }
  if (blockedImports === 0) return { css: src, blockedImports: 0 };
  out += src.slice(chunkStart);
  return { css: out, blockedImports };
}

function resolveCustomCssPath(rootDir) {
  return path.join(path.resolve(String(rootDir || '')), CUSTOM_CSS_FILENAME);
}

function readCustomCssSafe(rootDir) {
  if (typeof rootDir !== 'string' || !rootDir.trim()) {
    return {
      status: 'missing',
      css: '',
      bytes: 0,
      rawBytes: 0,
      maxBytes: MAX_CUSTOM_CSS_BYTES,
      sha256: '',
      blockedImports: 0,
      filePath: '',
    };
  }
  const absRoot = path.resolve(rootDir);
  const filePath = path.join(absRoot, CUSTOM_CSS_FILENAME);
  const emptyBase = {
    status: 'missing',
    css: '',
    bytes: 0,
    rawBytes: 0,
    maxBytes: MAX_CUSTOM_CSS_BYTES,
    sha256: '',
    blockedImports: 0,
    filePath,
  };

  let st;
  try {
    st = fs.lstatSync(filePath);
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return emptyBase;
    return { ...emptyBase, status: 'error' };
  }

  if (st.isSymbolicLink()) {
    return { ...emptyBase, status: 'rejected-symlink', rawBytes: Number(st.size) || 0 };
  }
  if (!st.isFile()) {
    return { ...emptyBase, status: 'rejected-non-file', rawBytes: Number(st.size) || 0 };
  }

  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync(absRoot);
    realFile = fs.realpathSync(filePath);
  } catch {
    return { ...emptyBase, status: 'error' };
  }

  if (!isPathStrictlyInside(realRoot, realFile) || path.basename(realFile).toLowerCase() !== CUSTOM_CSS_FILENAME) {
    return { ...emptyBase, status: 'rejected-symlink', rawBytes: Number(st.size) || 0 };
  }

  if (st.size > MAX_CUSTOM_CSS_BYTES) {
    return { ...emptyBase, status: 'rejected-too-large', rawBytes: st.size };
  }

  let raw;
  let rawBytes = 0;
  try {
    const buf = fs.readFileSync(realFile);
    rawBytes = buf.length;
    if (buf.length > MAX_CUSTOM_CSS_BYTES) {
      return { ...emptyBase, status: 'rejected-too-large', rawBytes: buf.length };
    }
    raw = buf.toString('utf8');
  } catch {
    return { ...emptyBase, status: 'error' };
  }

  const { css, blockedImports } = sanitizeCustomCssContent(raw);
  const hasExecutableCss = css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '').trim().length > 0;
  const bytes = Buffer.byteLength(css, 'utf8');
  const sha256 = sha256Text(css);

  return {
    status: hasExecutableCss ? 'active' : 'empty',
    css: hasExecutableCss ? css : '',
    bytes: hasExecutableCss ? bytes : 0,
    rawBytes,
    maxBytes: MAX_CUSTOM_CSS_BYTES,
    sha256,
    blockedImports,
    filePath,
  };
}

function createDefaultCustomCssTemplate(rootDir) {
  if (typeof rootDir !== 'string' || !rootDir.trim()) {
    return { ok: false, status: 'invalid-root', filePath: '' };
  }
  const absRoot = path.resolve(rootDir);
  const filePath = path.join(absRoot, CUSTOM_CSS_FILENAME);
  try {
    const rootStat = fs.lstatSync(absRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      return { ok: false, status: 'invalid-root', filePath };
    }
  } catch {
    return { ok: false, status: 'invalid-root', filePath };
  }

  try {
    const existing = fs.lstatSync(filePath);
    if (existing) {
      if (existing.isSymbolicLink()) {
        return { ok: false, created: false, exists: true, status: 'rejected-symlink', filePath };
      }
      if (!existing.isFile()) {
        return { ok: false, created: false, exists: true, status: 'rejected-non-file', filePath };
      }
      return { ok: true, created: false, exists: true, status: 'exists', filePath };
    }
  } catch (err) {
    if (!err || err.code !== 'ENOENT') {
      return { ok: false, status: 'error', filePath };
    }
  }

  try {
    fs.writeFileSync(filePath, DEFAULT_CUSTOM_CSS_TEMPLATE, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    return { ok: true, created: true, exists: true, status: 'created', filePath };
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      try {
        const st = fs.lstatSync(filePath);
        if (st.isSymbolicLink()) return { ok: false, created: false, exists: true, status: 'rejected-symlink', filePath };
        if (!st.isFile()) return { ok: false, created: false, exists: true, status: 'rejected-non-file', filePath };
      } catch {}
      return { ok: true, created: false, exists: true, status: 'exists', filePath };
    }
    return { ok: false, status: 'write-failed', filePath };
  }
}

module.exports = {
  CUSTOM_CSS_FILENAME,
  MAX_CUSTOM_CSS_BYTES,
  DEFAULT_CUSTOM_CSS_TEMPLATE,
  resolveCustomCssPath,
  sanitizeCustomCssContent,
  readCustomCssSafe,
  createDefaultCustomCssTemplate,
};
