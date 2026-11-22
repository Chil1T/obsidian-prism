// Obsidian Prism — Channel 7 Local Static/Dynamic Wallpaper Service (Zero-Dependency Node ESM)
// - Persists config atomically (0o600, symlink-safe) to ~/.gemini/config/obsidian-prism-wallpaper.json
// - Enforces strict path security (realpathSync, no UNC/device paths, no sensitive dirs, extension + magic bytes)
// - Lazily runs an isolated 127.0.0.1:0 read-only HTTP media server with 256-bit random token & HTTP 206 Range streaming
// - Supports <= 8 MB static image Blob fallback (get-media-blob) and parameterized native OS file picker (pick-media)

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const WALLPAPER_CONFIG_FILENAME = 'obsidian-prism-wallpaper.json';
export const MAX_BLOB_FALLBACK_BYTES = 8 * 1024 * 1024; // 8 MiB
export const MAX_IMAGE_FILE_BYTES = 64 * 1024 * 1024; // 64 MiB
export const MAX_VIDEO_FILE_BYTES = 512 * 1024 * 1024; // 512 MiB
const MAX_CONFIG_FILE_BYTES = 64 * 1024;

export const DEFAULT_WALLPAPER_CONFIG = Object.freeze({
  version: 1,
  enabled: false,
  mediaPath: '',
  mediaType: '',
  opacity: 0.28,
  blurPx: 4,
  dimOverlay: 0.45,
  fit: 'cover',
  pauseOnBlur: true,
});

export const ALLOWED_MEDIA_EXTENSIONS = Object.freeze({
  '.jpg': Object.freeze({ mediaType: 'image', mimeType: 'image/jpeg' }),
  '.jpeg': Object.freeze({ mediaType: 'image', mimeType: 'image/jpeg' }),
  '.png': Object.freeze({ mediaType: 'image', mimeType: 'image/png' }),
  '.webp': Object.freeze({ mediaType: 'image', mimeType: 'image/webp' }),
  '.gif': Object.freeze({ mediaType: 'image', mimeType: 'image/gif' }),
  '.avif': Object.freeze({ mediaType: 'image', mimeType: 'image/avif' }),
  '.mp4': Object.freeze({ mediaType: 'video', mimeType: 'video/mp4' }),
  '.webm': Object.freeze({ mediaType: 'video', mimeType: 'video/webm' }),
});

const BLOCKED_DIR_SEGMENTS = new Set([
  '.ssh',
  '.aws',
  '.azure',
  '.kube',
  '.gnupg',
  '.gpg',
  '.docker',
  '.gemini',
  '.antigravity',
  '.claude',
  '.codex',
  '.cursor',
  '.vscode-server',
  'keychains',
  '1password',
  'bitwarden',
]);

const BLOCKED_SUBPATHS = [
  '/.config/gcloud',
  '/.config/gh',
  '/.config/op',
  '/.config/aws',
  '/.config/antigravity',
  '/.config/code',
  '/appdata/roaming/gnupg',
  '/appdata/roaming/microsoft/protect',
  '/appdata/roaming/microsoft/credentials',
  '/appdata/local/microsoft/credentials',
  '/appdata/roaming/antigravity',
  '/library/keychains',
  '/library/application support/antigravity',
];

const WIN_RESERVED_DEVICE_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const ALLOWED_ORIGIN_RE =
  /^(?:https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?|vscode-file:\/\/[a-z0-9._-]+|app:\/\/[a-z0-9._-]+)$/i;

const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'avc1',
  'mp41',
  'mp42',
  'M4V ',
  'M4A ',
  'f4v ',
  'qt  ',
  'dash',
  'msdh',
  'msix',
  'av01',
  'hev1',
  'hvc1',
  '3gp4',
  '3gp5',
  '3gp6',
]);

const AVIF_BRANDS = new Set(['avif', 'avis']);

// 固定无插值 PowerShell 文件选择脚本（通过 -EncodedCommand 执行，杜绝任何 shell 拼接）
const WIN_PICK_MEDIA_PS = [
  '$ErrorActionPreference = "Stop"',
  '$ProgressPreference = "SilentlyContinue"',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$owner = New-Object System.Windows.Forms.Form',
  '$owner.TopMost = $true',
  '$owner.ShowInTaskbar = $false',
  '$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
  '$owner.Opacity = 0',
  '$owner.Width = 1',
  '$owner.Height = 1',
  '$dlg = New-Object System.Windows.Forms.OpenFileDialog',
  '$dlg.Title = "Select Wallpaper (Image / Video)"',
  '$dlg.Filter = "Wallpapers (*.jpg;*.jpeg;*.png;*.webp;*.gif;*.avif;*.mp4;*.webm)|*.jpg;*.jpeg;*.png;*.webp;*.gif;*.avif;*.mp4;*.webm|Images (*.jpg;*.jpeg;*.png;*.webp;*.gif;*.avif)|*.jpg;*.jpeg;*.png;*.webp;*.gif;*.avif|Videos (*.mp4;*.webm)|*.mp4;*.webm"',
  '$dlg.CheckFileExists = $true',
  '$dlg.Multiselect = $false',
  '$dlg.DereferenceLinks = $false',
  '$dlg.RestoreDirectory = $true',
  'try {',
  '  $owner.Show()',
  '  $res = $dlg.ShowDialog($owner)',
  '  if ($res -eq [System.Windows.Forms.DialogResult]::OK -and $dlg.FileName) {',
  '    [Console]::Out.Write($dlg.FileName)',
  '  }',
  '} finally {',
  '  try { $dlg.Dispose() } catch {}',
  '  try { $owner.Close(); $owner.Dispose() } catch {}',
  '}',
].join('\n');

const WIN_PICK_MEDIA_B64 = Buffer.from(WIN_PICK_MEDIA_PS, 'utf16le').toString('base64');

const MAC_PICK_MEDIA_SCRIPT =
  'POSIX path of (choose file with prompt "Select Wallpaper" of type {"public.jpeg", "public.png", "public.webp", "com.compuserve.gif", "public.avif", "public.mpeg-4", "org.webmproject.webm"})';

function clampNumber(val, min, max, fallback, decimals = 2) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(max, Math.max(min, n));
  if (decimals <= 0) return Math.round(clamped);
  const factor = 10 ** decimals;
  return Math.round(clamped * factor) / factor;
}

export function resolveWallpaperConfigPath(opts = {}) {
  if (opts && typeof opts.configPath === 'string' && opts.configPath.trim()) {
    return path.resolve(opts.configPath.trim());
  }
  const envPath = String(process.env.PRISM_WALLPAPER_CONFIG_PATH || '').trim();
  if (envPath) {
    return path.resolve(envPath);
  }
  return path.join(os.homedir(), '.gemini', 'config', WALLPAPER_CONFIG_FILENAME);
}

function isSymlinkPathSync(targetPath) {
  try {
    return fs.lstatSync(targetPath).isSymbolicLink();
  } catch {
    return false;
  }
}

function isUncOrDevicePath(rawStr) {
  const s = String(rawStr || '');
  if (!s) return false;
  // UNC (\\server\share, //server/share), extended/device prefixes (\\?\, \\.\, //?/, //./)
  if (s.startsWith('\\\\') || s.startsWith('//')) return true;
  if (/^[\\/]{2}[?.][\\/]/.test(s)) return true;
  // Windows 保留设备名检查
  const parts = s.split(/[\\/]+/).filter(Boolean);
  for (const part of parts) {
    const base = part.split('.')[0];
    if (WIN_RESERVED_DEVICE_RE.test(base)) return true;
  }
  return false;
}

function normalizePosixLower(p) {
  return String(p || '').replace(/\\/g, '/').toLowerCase();
}

function isSensitiveSystemOrCredentialPath(candidatePath, opts = {}) {
  const norm = normalizePosixLower(candidatePath).replace(/\/+/g, '/');
  if (!norm) return true;

  // 系统根目录前缀检查（Windows 与 POSIX 跨平台一致拦截）
  if (/^[a-z]:\/(?:windows|programdata|system volume information|\$recycle\.bin)(?:\/|$)/.test(norm)) {
    return true;
  }
  if (/^\/(?:etc|proc|sys|dev|boot|root|sbin|usr\/sbin|var\/run|run|private\/etc|private\/var\/db|system\/library)(?:\/|$)/.test(norm)) {
    return true;
  }
  // 兼容 Windows 上解析 /etc/... -> c:/etc/... 的路径形态
  if (/^[a-z]:\/(?:etc|proc|sys|dev|boot|root)(?:\/|$)/.test(norm)) {
    return true;
  }

  for (const envVar of [process.env.SystemRoot, process.env.WINDIR]) {
    if (!envVar) continue;
    const envNorm = normalizePosixLower(envVar).replace(/\/+$/, '');
    if (envNorm && (norm === envNorm || norm.startsWith(`${envNorm}/`))) {
      return true;
    }
  }

  if (Array.isArray(opts.extraBlockedDirs)) {
    for (const dir of opts.extraBlockedDirs) {
      if (typeof dir !== 'string' || !dir.trim()) continue;
      const dNorm = normalizePosixLower(path.resolve(dir)).replace(/\/+$/, '');
      if (dNorm && (norm === dNorm || norm.startsWith(`${dNorm}/`))) {
        return true;
      }
    }
  }

  // 仅取目录部分检查敏感目录段（避免误伤文件名如 my-windows-wall.png）
  const lastSlash = norm.lastIndexOf('/');
  const dirPart = lastSlash >= 0 ? norm.slice(0, lastSlash) : '';
  const dirSegments = dirPart.split('/').filter(Boolean);
  for (const seg of dirSegments) {
    if (BLOCKED_DIR_SEGMENTS.has(seg)) {
      return true;
    }
  }

  const paddedDir = `${dirPart}/`;
  for (const sub of BLOCKED_SUBPATHS) {
    if (paddedDir.includes(`${sub}/`)) {
      return true;
    }
  }

  return false;
}

export function verifyMediaMagicBytes(ext, headerBuf, bytesRead = headerBuf?.length || 0) {
  if (!Buffer.isBuffer(headerBuf) || bytesRead < 4) return false;
  const e = String(ext || '').toLowerCase();

  if (e === '.jpg' || e === '.jpeg') {
    return bytesRead >= 3 && headerBuf[0] === 0xff && headerBuf[1] === 0xd8 && headerBuf[2] === 0xff;
  }
  if (e === '.png') {
    return (
      bytesRead >= 8 &&
      headerBuf[0] === 0x89 &&
      headerBuf[1] === 0x50 &&
      headerBuf[2] === 0x4e &&
      headerBuf[3] === 0x47 &&
      headerBuf[4] === 0x0d &&
      headerBuf[5] === 0x0a &&
      headerBuf[6] === 0x1a &&
      headerBuf[7] === 0x0a
    );
  }
  if (e === '.gif') {
    if (bytesRead < 6) return false;
    const sig = headerBuf.subarray(0, 6).toString('ascii');
    return sig === 'GIF87a' || sig === 'GIF89a';
  }
  if (e === '.webp') {
    if (bytesRead < 12) return false;
    return (
      headerBuf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      headerBuf.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (e === '.webm') {
    return (
      bytesRead >= 4 &&
      headerBuf[0] === 0x1a &&
      headerBuf[1] === 0x45 &&
      headerBuf[2] === 0xdf &&
      headerBuf[3] === 0xa3
    );
  }
  if (e === '.avif' || e === '.mp4') {
    if (bytesRead < 12) return false;
    if (headerBuf.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
    const boxSize = headerBuf.readUInt32BE(0);
    const limit = Math.min(bytesRead, boxSize >= 12 ? boxSize : bytesRead);
    const major = headerBuf.subarray(8, 12).toString('ascii');
    const compat = [];
    for (let off = 16; off + 4 <= limit; off += 4) {
      compat.push(headerBuf.subarray(off, off + 4).toString('ascii'));
    }
    if (e === '.avif') {
      return AVIF_BRANDS.has(major) || compat.some((b) => AVIF_BRANDS.has(b));
    }
    // .mp4: 拒绝纯 avif/avis 伪装，要求命中合法 MP4/ISO-BMFF 品牌
    if (AVIF_BRANDS.has(major) && !compat.some((b) => MP4_BRANDS.has(b))) {
      return false;
    }
    return MP4_BRANDS.has(major) || compat.some((b) => MP4_BRANDS.has(b));
  }
  return false;
}

function expandLeadingTilde(rawPath) {
  if (rawPath === '~') return os.homedir();
  if (rawPath.startsWith('~/') || rawPath.startsWith('~\\')) {
    return path.join(os.homedir(), rawPath.slice(2));
  }
  return rawPath;
}

export function validateWallpaperMediaPath(rawPath, opts = {}) {
  if (typeof rawPath !== 'string') {
    return { ok: false, code: 'invalid-path', error: 'Media path must be a non-empty string' };
  }
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.length > 4096) {
    return { ok: false, code: 'invalid-path', error: 'Media path is empty or too long' };
  }
  if (CONTROL_CHAR_RE.test(trimmed)) {
    return { ok: false, code: 'invalid-path', error: 'Media path contains illegal control characters' };
  }
  if (URL_SCHEME_RE.test(trimmed)) {
    return { ok: false, code: 'invalid-scheme', error: 'Only local file paths are allowed' };
  }
  if (isUncOrDevicePath(trimmed)) {
    return { ok: false, code: 'blocked-unc-or-device', error: 'UNC and NT device paths are not allowed' };
  }

  const expanded = expandLeadingTilde(trimmed);
  if (isUncOrDevicePath(expanded)) {
    return { ok: false, code: 'blocked-unc-or-device', error: 'UNC and NT device paths are not allowed' };
  }

  const rawExt = path.extname(expanded).toLowerCase();
  const rawSpec = Object.prototype.hasOwnProperty.call(ALLOWED_MEDIA_EXTENSIONS, rawExt)
    ? ALLOWED_MEDIA_EXTENSIONS[rawExt]
    : null;
  if (!rawSpec) {
    return {
      ok: false,
      code: 'unsupported-extension',
      error: `Unsupported wallpaper extension: ${rawExt || '(none)'}`,
    };
  }

  // 在访问文件系统之前先对原始与解析路径做敏感目录拦截
  if (isSensitiveSystemOrCredentialPath(trimmed, opts) || isSensitiveSystemOrCredentialPath(expanded, opts)) {
    return {
      ok: false,
      code: 'blocked-sensitive-path',
      error: 'Access to sensitive system or credential directories is forbidden',
    };
  }

  const resolved = path.resolve(expanded);
  if (isUncOrDevicePath(resolved)) {
    return { ok: false, code: 'blocked-unc-or-device', error: 'UNC and NT device paths are not allowed' };
  }
  if (isSensitiveSystemOrCredentialPath(resolved, opts)) {
    return {
      ok: false,
      code: 'blocked-sensitive-path',
      error: 'Access to sensitive system or credential directories is forbidden',
    };
  }

  let lstat;
  try {
    lstat = fs.lstatSync(resolved);
  } catch (err) {
    const code = err && err.code === 'ENOENT' ? 'file-not-found' : 'file-unreadable';
    return { ok: false, code, error: `Wallpaper file not accessible: ${code}` };
  }

  if (lstat.isSymbolicLink()) {
    return { ok: false, code: 'symlink-not-allowed', error: 'Symbolic link wallpaper files are not allowed' };
  }
  if (!lstat.isFile()) {
    return { ok: false, code: 'not-a-regular-file', error: 'Wallpaper path must point to a regular file' };
  }

  let realPath;
  try {
    realPath = fs.realpathSync(resolved);
  } catch {
    return { ok: false, code: 'file-unreadable', error: 'Failed to resolve canonical wallpaper path' };
  }

  if (isUncOrDevicePath(realPath)) {
    return { ok: false, code: 'blocked-unc-or-device', error: 'Resolved path points to UNC or device path' };
  }
  if (isSensitiveSystemOrCredentialPath(realPath, opts)) {
    return {
      ok: false,
      code: 'blocked-sensitive-path',
      error: 'Resolved path escapes into a sensitive system or credential directory',
    };
  }

  const realExt = path.extname(realPath).toLowerCase();
  const realSpec = Object.prototype.hasOwnProperty.call(ALLOWED_MEDIA_EXTENSIONS, realExt)
    ? ALLOWED_MEDIA_EXTENSIONS[realExt]
    : null;
  if (!realSpec || realExt !== rawExt) {
    return { ok: false, code: 'unsupported-extension', error: 'Canonical file extension does not match allowlist' };
  }

  let stat;
  try {
    stat = fs.statSync(realPath);
  } catch {
    return { ok: false, code: 'file-unreadable', error: 'Failed to stat canonical wallpaper file' };
  }
  if (!stat.isFile()) {
    return { ok: false, code: 'not-a-regular-file', error: 'Canonical wallpaper target is not a regular file' };
  }
  if (stat.size <= 0) {
    return { ok: false, code: 'empty-file', error: 'Wallpaper file is empty' };
  }
  const maxBytes = realSpec.mediaType === 'video' ? MAX_VIDEO_FILE_BYTES : MAX_IMAGE_FILE_BYTES;
  if (stat.size > maxBytes) {
    return { ok: false, code: 'file-too-large', error: `Wallpaper file exceeds max allowed size (${maxBytes} bytes)` };
  }

  // 二次魔数校验（读取头部最多 64 字节）
  const header = Buffer.alloc(64);
  let bytesRead = 0;
  let fd = null;
  try {
    fd = fs.openSync(realPath, 'r');
    bytesRead = fs.readSync(fd, header, 0, header.length, 0);
  } catch {
    return { ok: false, code: 'file-unreadable', error: 'Failed to read wallpaper file header' };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }

  if (!verifyMediaMagicBytes(realExt, header, bytesRead)) {
    return {
      ok: false,
      code: 'invalid-magic-bytes',
      error: `File signature does not match declared ${realExt} media format`,
    };
  }

  return {
    ok: true,
    realPath,
    ext: realExt,
    mediaType: realSpec.mediaType,
    mimeType: realSpec.mimeType,
    size: stat.size,
  };
}

function sanitizeStoredConfig(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const fit = src.fit === 'contain' ? 'contain' : 'cover';
  const mediaPath = typeof src.mediaPath === 'string' ? src.mediaPath.trim() : '';
  const mediaType =
    mediaPath && (src.mediaType === 'image' || src.mediaType === 'video') ? src.mediaType : '';
  return {
    version: 1,
    enabled: Boolean(src.enabled),
    mediaPath,
    mediaType,
    opacity: clampNumber(src.opacity, 0.05, 0.85, DEFAULT_WALLPAPER_CONFIG.opacity, 2),
    blurPx: clampNumber(src.blurPx, 0, 24, DEFAULT_WALLPAPER_CONFIG.blurPx, 0),
    dimOverlay: clampNumber(src.dimOverlay, 0, 0.85, DEFAULT_WALLPAPER_CONFIG.dimOverlay, 2),
    fit,
    pauseOnBlur: src.pauseOnBlur === undefined ? true : Boolean(src.pauseOnBlur),
  };
}

function readConfigFileSync(configPath) {
  try {
    const resolved = path.resolve(configPath);
    const dir = path.dirname(resolved);
    if (isSymlinkPathSync(dir) || isSymlinkPathSync(resolved)) {
      return { ...DEFAULT_WALLPAPER_CONFIG };
    }
    const lst = fs.lstatSync(resolved);
    if (!lst.isFile() || lst.isSymbolicLink() || lst.size > MAX_CONFIG_FILE_BYTES) {
      return { ...DEFAULT_WALLPAPER_CONFIG };
    }
    const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    return sanitizeStoredConfig(parsed);
  } catch {
    return { ...DEFAULT_WALLPAPER_CONFIG };
  }
}

function writeConfigFileAtomicSync(configPath, cfg) {
  const resolved = path.resolve(configPath);
  const dir = path.dirname(resolved);
  if (isSymlinkPathSync(dir) || isSymlinkPathSync(resolved)) {
    throw new Error(`Refusing symbolic link wallpaper config path: ${resolved}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  if (isSymlinkPathSync(dir) || isSymlinkPathSync(resolved)) {
    throw new Error(`Refusing symbolic link wallpaper config path: ${resolved}`);
  }
  const content = JSON.stringify(sanitizeStoredConfig(cfg), null, 2) + '\n';
  const tmpPath = path.join(dir, `.obsidian-prism-wallpaper.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let fd = null;
  try {
    fd = fs.openSync(tmpPath, 'wx', 0o600);
    fs.writeFileSync(fd, content, 'utf8');
    fs.closeSync(fd);
    fd = null;
    try {
      fs.chmodSync(tmpPath, 0o600);
    } catch {}
    let renamed = false;
    let lastErr = null;
    const isWin = process.platform === 'win32';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fs.renameSync(tmpPath, resolved);
        renamed = true;
        break;
      } catch (err) {
        lastErr = err;
        if (!isWin || !['EBUSY', 'EPERM', 'EACCES', 'EEXIST'].includes(err && err.code)) {
          throw err;
        }
      }
    }
    if (!renamed) {
      if (isWin && ['EBUSY', 'EPERM', 'EACCES', 'EEXIST'].includes(lastErr && lastErr.code)) {
        if (isSymlinkPathSync(dir) || isSymlinkPathSync(resolved)) {
          throw new Error(`Refusing symbolic link wallpaper config path: ${resolved}`);
        }
        fs.copyFileSync(tmpPath, resolved);
        try {
          fs.unlinkSync(tmpPath);
        } catch {}
      } else {
        throw lastErr;
      }
    }
    try {
      fs.chmodSync(resolved, 0o600);
    } catch {}
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}

function timingSafeStrEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function parseSingleByteRange(rangeHeader, fileSize) {
  if (typeof rangeHeader !== 'string') return null;
  const trimmed = rangeHeader.trim();
  const m = /^bytes=(\d*)-(\d*)$/i.exec(trimmed);
  if (!m) return { invalid: true };
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return { invalid: true };

  let start;
  let end;
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? fileSize - 1 : Number(rawEnd);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { invalid: true };
    if (start < 0 || start >= fileSize) return { invalid: true };
    if (end < start) return { invalid: true };
    if (end >= fileSize) end = fileSize - 1;
  }
  return { invalid: false, start, end };
}

function execFilePromise(file, args, options, execImpl = execFile) {
  return new Promise((resolve, reject) => {
    execImpl(file, args, options, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    });
  });
}

export function createWallpaperService(opts = {}) {
  const configPath = resolveWallpaperConfigPath(opts);
  const platform = opts.platform || process.platform;
  const execFileImpl = typeof opts.execFileImpl === 'function' ? opts.execFileImpl : execFile;
  const validateOpts = opts.extraBlockedDirs ? { extraBlockedDirs: opts.extraBlockedDirs } : {};

  let config = readConfigFileSync(configPath);
  let activeMedia = null; // { realPath, mediaType, mimeType, size }
  let mediaError = '';
  let token = '';
  let rev = 0;
  let server = null;
  let serverPort = 0;
  let serverStartingPromise = null;
  let disposed = false;
  const activeSockets = new Set();

  // 初始化时若配置中已有 mediaPath，同步校验其合法性（不启动 HTTP 服务器，保持懒启动）
  if (config.mediaPath) {
    const check = validateWallpaperMediaPath(config.mediaPath, validateOpts);
    if (check.ok) {
      activeMedia = check;
      config = { ...config, mediaPath: check.realPath, mediaType: check.mediaType };
    } else {
      activeMedia = null;
      mediaError = check.code || 'invalid-media';
    }
  }

  function buildMediaUrl() {
    if (!config.enabled || !activeMedia || !server || !serverPort || !token || rev <= 0) {
      return '';
    }
    return `http://127.0.0.1:${serverPort}/wallpaper/${token}/${rev}`;
  }

  function getConfigSync() {
    return {
      version: 1,
      enabled: Boolean(config.enabled),
      mediaPath: config.mediaPath || '',
      mediaType: activeMedia ? activeMedia.mediaType : config.mediaType || '',
      mediaUrl: buildMediaUrl(),
      opacity: config.opacity,
      blurPx: config.blurPx,
      dimOverlay: config.dimOverlay,
      fit: config.fit,
      pauseOnBlur: config.pauseOnBlur,
      rev,
      serverRunning: Boolean(server && serverPort > 0),
      mediaError,
    };
  }

  function isEnabledSync() {
    return Boolean(!disposed && config.enabled && activeMedia && config.mediaPath);
  }

  function stopServerSync() {
    const srv = server;
    server = null;
    serverPort = 0;
    token = '';
    serverStartingPromise = null;
    for (const sock of activeSockets) {
      try {
        sock.destroy();
      } catch {}
    }
    activeSockets.clear();
    if (!srv) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        srv.closeAllConnections?.();
      } catch {}
      try {
        srv.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  function handleHttpRequest(req, res) {
    const method = String(req.method || '').toUpperCase();
    const baseHeaders = {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
    };

    // 严格来源检查：绝不输出 Access-Control-Allow-Origin: *
    const reqOrigin = typeof req.headers?.origin === 'string' ? req.headers.origin.trim() : '';
    if (reqOrigin) {
      if (!ALLOWED_ORIGIN_RE.test(reqOrigin)) {
        res.writeHead(403, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden origin');
        return;
      }
      baseHeaders['Access-Control-Allow-Origin'] = reqOrigin;
      baseHeaders['Vary'] = 'Origin';
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { ...baseHeaders, Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    const rawUrl = String(req.url || '');
    if (rawUrl.includes('?') || rawUrl.includes('#') || rawUrl.includes('..') || rawUrl.includes('\\')) {
      res.writeHead(404, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const routeMatch = /^\/wallpaper\/([a-f0-9]{1,128})\/(\d{1,12})$/.exec(rawUrl);
    if (!routeMatch) {
      res.writeHead(404, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const [, reqToken, reqRev] = routeMatch;
    if (!token || !timingSafeStrEqual(reqToken, token) || reqRev !== String(rev)) {
      res.writeHead(403, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    if (!config.enabled || !activeMedia || !activeMedia.realPath) {
      res.writeHead(404, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No active wallpaper');
      return;
    }

    // 每次服务前实时验证目标文件未变成符号链接且仍为常规文件（防 TOCTOU）
    let stat;
    try {
      const lst = fs.lstatSync(activeMedia.realPath);
      if (lst.isSymbolicLink() || !lst.isFile()) {
        res.writeHead(403, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Invalid target');
        return;
      }
      stat = lst;
    } catch {
      res.writeHead(404, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const fileSize = stat.size;
    if (fileSize <= 0) {
      res.writeHead(404, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Empty file');
      return;
    }

    const rangeHeader = req.headers?.range;
    if (typeof rangeHeader === 'string' && rangeHeader.trim()) {
      const parsed = parseSingleByteRange(rangeHeader, fileSize);
      if (!parsed || parsed.invalid) {
        res.writeHead(416, {
          ...baseHeaders,
          'Content-Range': `bytes */${fileSize}`,
          'Content-Type': 'text/plain; charset=utf-8',
        });
        res.end('Range Not Satisfiable');
        return;
      }
      const { start, end } = parsed;
      const chunkLen = end - start + 1;
      res.writeHead(206, {
        ...baseHeaders,
        'Content-Type': activeMedia.mimeType,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': String(chunkLen),
      });
      if (method === 'HEAD') {
        res.end();
        return;
      }
      const stream = fs.createReadStream(activeMedia.realPath, { start, end });
      stream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
        }
        res.end();
      });
      res.on('close', () => {
        try {
          stream.destroy();
        } catch {}
      });
      stream.pipe(res);
      return;
    }

    res.writeHead(200, {
      ...baseHeaders,
      'Content-Type': activeMedia.mimeType,
      'Content-Length': String(fileSize),
    });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(activeMedia.realPath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end();
    });
    res.on('close', () => {
      try {
        stream.destroy();
      } catch {}
    });
    stream.pipe(res);
  }

  async function ensureMediaServer(rotateToken = false) {
    if (disposed) {
      await stopServerSync();
      return false;
    }
    if (!config.enabled || !activeMedia || !activeMedia.realPath) {
      await stopServerSync();
      return false;
    }
    if (rotateToken || !token) {
      token = crypto.randomBytes(32).toString('hex'); // 64-char hex (256-bit)
      rev += 1;
    }
    if (server && serverPort > 0) {
      return true;
    }
    if (serverStartingPromise) {
      return serverStartingPromise;
    }

    serverStartingPromise = new Promise((resolve, reject) => {
      const srv = http.createServer(handleHttpRequest);
      srv.on('connection', (sock) => {
        activeSockets.add(sock);
        sock.on('close', () => activeSockets.delete(sock));
      });
      srv.once('error', (err) => {
        serverStartingPromise = null;
        try {
          srv.close();
        } catch {}
        reject(err);
      });
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (disposed || !config.enabled || !activeMedia) {
          serverStartingPromise = null;
          try {
            srv.close();
          } catch {}
          resolve(false);
          return;
        }
        server = srv;
        serverPort = addr && typeof addr === 'object' ? addr.port : 0;
        serverStartingPromise = null;
        resolve(serverPort > 0);
      });
    });

    try {
      return await serverStartingPromise;
    } catch (err) {
      mediaError = 'server-start-failed';
      return false;
    }
  }

  async function savePatch(patch, { rotateOnPathChange = true } = {}) {
    const src = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    const nextCfg = { ...config };
    let nextActive = activeMedia;
    let pathChanged = false;

    if (Object.prototype.hasOwnProperty.call(src, 'opacity')) {
      nextCfg.opacity = clampNumber(src.opacity, 0.05, 0.85, nextCfg.opacity, 2);
    }
    if (Object.prototype.hasOwnProperty.call(src, 'blurPx')) {
      nextCfg.blurPx = clampNumber(src.blurPx, 0, 24, nextCfg.blurPx, 0);
    }
    if (Object.prototype.hasOwnProperty.call(src, 'dimOverlay')) {
      nextCfg.dimOverlay = clampNumber(src.dimOverlay, 0, 0.85, nextCfg.dimOverlay, 2);
    }
    if (Object.prototype.hasOwnProperty.call(src, 'fit')) {
      nextCfg.fit = src.fit === 'contain' ? 'contain' : 'cover';
    }
    if (Object.prototype.hasOwnProperty.call(src, 'pauseOnBlur')) {
      nextCfg.pauseOnBlur = Boolean(src.pauseOnBlur);
    }
    if (Object.prototype.hasOwnProperty.call(src, 'enabled')) {
      nextCfg.enabled = Boolean(src.enabled);
    }

    if (Object.prototype.hasOwnProperty.call(src, 'mediaPath')) {
      const rawMediaPath = typeof src.mediaPath === 'string' ? src.mediaPath.trim() : '';
      if (!rawMediaPath) {
        nextCfg.mediaPath = '';
        nextCfg.mediaType = '';
        nextActive = null;
        pathChanged = Boolean(config.mediaPath);
      } else {
        const checked = validateWallpaperMediaPath(rawMediaPath, validateOpts);
        if (!checked.ok) {
          return {
            ok: false,
            code: checked.code,
            error: checked.error,
            config: getConfigSync(),
          };
        }
        pathChanged = checked.realPath !== config.mediaPath;
        nextCfg.mediaPath = checked.realPath;
        nextCfg.mediaType = checked.mediaType;
        nextActive = checked;
      }
    } else if (nextCfg.enabled && nextCfg.mediaPath) {
      // 启用已有路径时复检一次安全性与文件存在性
      const checked = validateWallpaperMediaPath(nextCfg.mediaPath, validateOpts);
      if (!checked.ok) {
        activeMedia = null;
        mediaError = checked.code;
        await stopServerSync();
        return {
          ok: false,
          code: checked.code,
          error: checked.error,
          config: getConfigSync(),
        };
      }
      nextCfg.mediaPath = checked.realPath;
      nextCfg.mediaType = checked.mediaType;
      nextActive = checked;
    }

    writeConfigFileAtomicSync(configPath, nextCfg);
    config = nextCfg;
    activeMedia = nextActive;
    mediaError = '';

    if (config.enabled && activeMedia) {
      await ensureMediaServer(rotateOnPathChange && pathChanged);
    } else {
      await stopServerSync();
    }

    return {
      ok: true,
      config: getConfigSync(),
      serverRunning: Boolean(server && serverPort > 0),
    };
  }

  async function pickMediaNative(payload = {}) {
    if (typeof opts.pickMediaImpl === 'function') {
      const custom = await opts.pickMediaImpl(payload);
      if (!custom || custom.canceled) {
        return { ok: true, canceled: true, config: getConfigSync() };
      }
      if (custom.manualRequired) {
        return {
          ok: false,
          manualRequired: true,
          code: 'manual-input-required',
          error: 'manual-input-required',
          config: getConfigSync(),
        };
      }
      return finalizePickedPath(custom.path, payload);
    }

    if (platform === 'linux') {
      return {
        ok: false,
        manualRequired: true,
        code: 'manual-input-required',
        error: 'manual-input-required',
        config: getConfigSync(),
      };
    }

    let pickedRaw = '';
    if (platform === 'win32') {
      try {
        const { stdout } = await execFilePromise(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-EncodedCommand', WIN_PICK_MEDIA_B64],
          { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 },
          execFileImpl
        );
        pickedRaw = stdout.trim();
      } catch (err) {
        return {
          ok: false,
          code: 'picker-failed',
          error: String(err?.message || 'File dialog failed'),
          config: getConfigSync(),
        };
      }
    } else if (platform === 'darwin') {
      try {
        const { stdout } = await execFilePromise(
          'osascript',
          ['-e', MAC_PICK_MEDIA_SCRIPT],
          { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 },
          execFileImpl
        );
        pickedRaw = stdout.trim();
      } catch (err) {
        const msg = `${err?.stderr || ''} ${err?.message || ''}`;
        if (/-128\b|user canceled/i.test(msg)) {
          return { ok: true, canceled: true, config: getConfigSync() };
        }
        return {
          ok: false,
          code: 'picker-failed',
          error: String(err?.message || 'File dialog failed'),
          config: getConfigSync(),
        };
      }
    } else {
      return {
        ok: false,
        manualRequired: true,
        code: 'manual-input-required',
        error: 'manual-input-required',
        config: getConfigSync(),
      };
    }

    if (!pickedRaw) {
      return { ok: true, canceled: true, config: getConfigSync() };
    }
    return finalizePickedPath(pickedRaw, payload);
  }

  async function finalizePickedPath(pickedRaw, payload = {}) {
    const checked = validateWallpaperMediaPath(pickedRaw, validateOpts);
    if (!checked.ok) {
      return {
        ok: false,
        code: checked.code,
        error: checked.error,
        config: getConfigSync(),
      };
    }
    if (payload && payload.apply === false) {
      return {
        ok: true,
        canceled: false,
        path: checked.realPath,
        mediaType: checked.mediaType,
        mimeType: checked.mimeType,
        config: getConfigSync(),
      };
    }
    const enableOnPick = payload?.autoEnable !== false ? true : config.enabled;
    const saved = await savePatch({ mediaPath: checked.realPath, enabled: enableOnPick }, { rotateOnPathChange: true });
    return {
      ...saved,
      canceled: false,
      path: checked.realPath,
      mediaType: checked.mediaType,
      mimeType: checked.mimeType,
    };
  }

  async function getMediaBlob(payload = {}) {
    // 严格仅允许读取当前已保存配置的壁纸文件，杜绝通过 RPC 探测读取任意本地图片
    if (
      payload &&
      typeof payload.mediaPath === 'string' &&
      payload.mediaPath.trim() &&
      config.mediaPath &&
      path.resolve(payload.mediaPath.trim()) !== path.resolve(config.mediaPath)
    ) {
      return { ok: false, code: 'media-path-mismatch', error: 'Requested blob path does not match active wallpaper' };
    }
    const targetPath = config.mediaPath;
    if (!targetPath) {
      return { ok: false, code: 'no-media-configured', error: 'No wallpaper media configured' };
    }
    const checked = validateWallpaperMediaPath(targetPath, validateOpts);
    if (!checked.ok) {
      return { ok: false, code: checked.code, error: checked.error };
    }
    if (checked.mediaType !== 'image') {
      return {
        ok: false,
        code: 'blob-image-only',
        error: 'Blob fallback only supports static images <= 8 MB; use local HTTP stream for video',
      };
    }
    if (checked.size > MAX_BLOB_FALLBACK_BYTES) {
      return {
        ok: false,
        code: 'blob-size-limit-exceeded',
        maxBytes: MAX_BLOB_FALLBACK_BYTES,
        size: checked.size,
        error: `Image exceeds ${MAX_BLOB_FALLBACK_BYTES} bytes Blob fallback limit`,
      };
    }
    try {
      const buf = fs.readFileSync(checked.realPath);
      if (buf.length > MAX_BLOB_FALLBACK_BYTES) {
        return {
          ok: false,
          code: 'blob-size-limit-exceeded',
          maxBytes: MAX_BLOB_FALLBACK_BYTES,
          size: buf.length,
          error: `Image exceeds ${MAX_BLOB_FALLBACK_BYTES} bytes Blob fallback limit`,
        };
      }
      return {
        ok: true,
        mimeType: checked.mimeType,
        size: buf.length,
        base64: buf.toString('base64'),
        rev,
      };
    } catch {
      return { ok: false, code: 'file-unreadable', error: 'Failed to read wallpaper image' };
    }
  }

  async function handleAction(action, payload = {}) {
    if (disposed) {
      return { ok: false, code: 'service-disposed', error: 'Wallpaper service is disposed' };
    }
    const act = String(action || '').trim();
    const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};

    if (act === 'get-config') {
      if (config.enabled && config.mediaPath) {
        const checked = validateWallpaperMediaPath(config.mediaPath, validateOpts);
        if (checked.ok) {
          activeMedia = checked;
          mediaError = '';
          await ensureMediaServer(false);
        } else {
          activeMedia = null;
          mediaError = checked.code;
          await stopServerSync();
        }
      } else {
        await stopServerSync();
      }
      return {
        ok: true,
        config: getConfigSync(),
        serverRunning: Boolean(server && serverPort > 0),
      };
    }

    if (act === 'save-config') {
      return savePatch(input);
    }

    if (act === 'pick-media') {
      return pickMediaNative(input);
    }

    if (act === 'clear-media') {
      const nextCfg = { ...config, enabled: false, mediaPath: '', mediaType: '' };
      writeConfigFileAtomicSync(configPath, nextCfg);
      config = nextCfg;
      activeMedia = null;
      mediaError = '';
      await stopServerSync();
      return {
        ok: true,
        config: getConfigSync(),
        serverRunning: false,
      };
    }

    if (act === 'get-media-blob') {
      return getMediaBlob(input);
    }

    if (act === 'status') {
      const snap = getConfigSync();
      return {
        ok: true,
        enabled: snap.enabled,
        serverRunning: snap.serverRunning,
        mediaType: snap.mediaType,
        hasMedia: Boolean(activeMedia && snap.mediaPath),
        mediaUrl: snap.mediaUrl,
        rev: snap.rev,
        mediaError: snap.mediaError,
        config: snap,
      };
    }

    return { ok: false, code: 'unknown-action', error: `Unknown wallpaper action: ${act}` };
  }

  function dispose() {
    disposed = true;
    activeMedia = null;
    return stopServerSync();
  }

  return {
    handleAction,
    getConfigSync,
    isEnabledSync,
    dispose,
  };
}
