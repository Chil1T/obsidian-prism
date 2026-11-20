const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const WORKBENCH_DIR = __dirname;
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TOKENS_PATH = path.join(WORKBENCH_DIR, 'design-tokens.json');
const SIDEBAR_STATE_MACHINE_PATH = path.join(REPO_ROOT, 'vendor', 'sidebar-studio', 'state-machine.mjs');
const SIDEBAR_SERVICE_PATH = path.join(REPO_ROOT, 'vendor', 'sidebar-studio', 'sidebar-service.mjs');

const DEFAULT_TOKENS = {
  palette: 'obsidian',
  theme: 'dark',
  lightPreset: 'crystal',
  radiusBase: 6,
  specularAlpha: 0.095,
  borderAlpha: 0.115,
  glassBlur: 20,
  proseLineHeight: 1.7,
  editorialSerif: true,
  grainAlpha: 0.022,
  prismStrength: 1,
};

const VENDOR_SLIDER_PATH = path.join(REPO_ROOT, 'vendor', 'effort-slider', 'upstream-client.js');

const SHARED_MODULE_MAP = {
  '/shared/ripple-core.js': path.join(REPO_ROOT, 'ripple-core.js'),
  '/shared/motion-engine.js': path.join(REPO_ROOT, 'motion-engine.js'),
  '/shared/animated-icons.js': path.join(REPO_ROOT, 'animated-icons.js'),
  '/shared/dual-mascot-rig.js': path.join(REPO_ROOT, 'dual-mascot-rig.js'),
  '/shared/vial-core.js': path.join(REPO_ROOT, 'vial-core.js'),
  '/shared/crystal-prism-core.js': path.join(REPO_ROOT, 'crystal-prism-core.js'),
  '/shared/effort-slider-client.js': VENDOR_SLIDER_PATH,
  '/shared/sidebar-state-machine.mjs': SIDEBAR_STATE_MACHINE_PATH,
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const LOOPBACK_HOST_RE = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;
const MAX_BODY_BYTES = 65536;

function isLoopbackOriginAllowed(req) {
  const host = String(req.headers.host || '').trim();
  if (host && !LOOPBACK_HOST_RE.test(host)) return false;
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return LOOPBACK_HOST_RE.test(parsed.host);
  } catch {
    return false;
  }
}

function getAllowedStudioHosts(server) {
  const addr = server && typeof server.address === 'function' ? server.address() : null;
  const port = addr && typeof addr === 'object' && addr.port ? String(addr.port) : '';
  const hosts = new Set();
  const baseNames = ['127.0.0.1', 'localhost', '[::1]'];
  if (addr && typeof addr === 'object' && addr.address) {
    const rawAddr = String(addr.address);
    const formatted = rawAddr.includes(':') ? `[${rawAddr}]` : rawAddr;
    if (LOOPBACK_HOST_RE.test(formatted)) baseNames.push(formatted);
  }
  for (const name of baseNames) {
    if (port) hosts.add(`${name}:${port}`.toLowerCase());
    else hosts.add(name.toLowerCase());
  }
  return hosts;
}

function verifyLoopbackHostAndOrigin(req, server, { requireOrigin = false } = {}) {
  const remoteAddr = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddr)) {
    return { ok: false, status: 403, error: 'Workbench is local only' };
  }
  const rawHost = String(req.headers.host || '').trim().toLowerCase();
  if (!rawHost || !LOOPBACK_HOST_RE.test(rawHost)) {
    return { ok: false, status: 403, error: 'Forbidden host' };
  }
  const allowedHosts = getAllowedStudioHosts(server);
  if (allowedHosts.size > 0 && !allowedHosts.has(rawHost)) {
    return { ok: false, status: 403, error: 'Host does not match bound loopback address' };
  }

  const secFetchSite = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    return { ok: false, status: 403, error: 'Forbidden cross-site request' };
  }

  const rawOrigin = String(req.headers.origin || '').trim();
  if (!rawOrigin) {
    if (requireOrigin) {
      return { ok: false, status: 403, error: 'Missing Origin header' };
    }
    return { ok: true };
  }
  try {
    const parsed = new URL(rawOrigin);
    if (parsed.protocol !== 'http:' || parsed.origin.toLowerCase() !== rawOrigin.toLowerCase() || parsed.host.toLowerCase() !== rawHost) {
      return { ok: false, status: 403, error: 'Origin mismatch' };
    }
  } catch {
    return { ok: false, status: 403, error: 'Malformed Origin header' };
  }
  return { ok: true };
}

function verifyStudioRequestSecurity(req, server, studioToken, requireWriteAuth) {
  const baseCheck = verifyLoopbackHostAndOrigin(req, server, { requireOrigin: Boolean(requireWriteAuth) });
  if (!baseCheck.ok) return baseCheck;
  if (!requireWriteAuth) return { ok: true };

  const presented = String(req.headers['x-studio-token'] || '');
  const expectedBuf = Buffer.from(studioToken, 'utf8');
  const actualBuf = Buffer.from(presented, 'utf8');
  if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
    return { ok: false, status: 403, error: 'Invalid or missing X-Studio-Token' };
  }

  const ctype = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (ctype !== 'application/json') {
    return { ok: false, status: 400, error: 'Content-Type must be application/json' };
  }

  return { ok: true };
}

function mapStudioErrorStatus(result) {
  if (result && result.ok) return 200;
  const code = String(result && result.error && result.error.code ? result.error.code : '');
  if (code === 'INVALID_ARGUMENT' || code === 'UNSUPPORTED_SCHEMA') return 400;
  if (code === 'NOT_FOUND') return 404;
  if (
    code === 'STALE_STATE' ||
    code === 'STALE_NAVIGATION' ||
    code === 'STALE_DRAFT' ||
    code === 'BADGE_STALE' ||
    code === 'BUSY' ||
    code === 'IDEMPOTENCY_CONFLICT' ||
    code === 'PROJECT_SCOPE_CONFLICT' ||
    code === 'NEEDS_RECONCILIATION' ||
    code === 'LIMIT_EXCEEDED'
  ) {
    return 409;
  }
  if (code === 'CAPABILITY_UNAVAILABLE' || code === 'PERSISTENCE_FAILED' || code === 'MIGRATION_FAILED') {
    return 503;
  }
  return 400;
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        const err = new Error('Payload too large');
        err.statusCode = 413;
        chunks.length = 0;
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        const err = new Error('Malformed JSON payload');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num * 1000) / 1000));
}

function validateAndNormalizeTokens(raw, current = DEFAULT_TOKENS) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Tokens payload must be a plain JSON object');
  }
  const palette = raw.palette !== undefined ? raw.palette : current.palette;
  if (palette !== 'obsidian' && palette !== 'titanium' && palette !== 'warm') {
    throw new Error('palette must be "obsidian", "titanium", or "warm"');
  }
  const theme = raw.theme !== undefined ? raw.theme : current.theme;
  if (theme !== 'dark' && theme !== 'light') {
    throw new Error('theme must be "dark" or "light"');
  }
  const lightPreset = raw.lightPreset !== undefined ? raw.lightPreset : current.lightPreset || 'crystal';
  if (lightPreset !== 'crystal' && lightPreset !== 'alabaster') {
    throw new Error('lightPreset must be "crystal" or "alabaster"');
  }
  const editorialSerif =
    raw.editorialSerif !== undefined ? Boolean(raw.editorialSerif) : Boolean(current.editorialSerif);

  return {
    palette,
    theme,
    lightPreset,
    radiusBase: clampNumber(raw.radiusBase ?? current.radiusBase, 0, 14, DEFAULT_TOKENS.radiusBase),
    specularAlpha: clampNumber(raw.specularAlpha ?? current.specularAlpha, 0, 0.25, DEFAULT_TOKENS.specularAlpha),
    borderAlpha: clampNumber(raw.borderAlpha ?? current.borderAlpha, 0.02, 0.25, DEFAULT_TOKENS.borderAlpha),
    glassBlur: clampNumber(raw.glassBlur ?? current.glassBlur, 0, 36, DEFAULT_TOKENS.glassBlur),
    proseLineHeight: clampNumber(raw.proseLineHeight ?? current.proseLineHeight, 1.35, 2.0, DEFAULT_TOKENS.proseLineHeight),
    editorialSerif,
    grainAlpha: clampNumber(raw.grainAlpha ?? current.grainAlpha, 0, 0.08, DEFAULT_TOKENS.grainAlpha),
    prismStrength: clampNumber(raw.prismStrength ?? current.prismStrength, 0, 1, DEFAULT_TOKENS.prismStrength),
  };
}

function readTokensFile(tokensPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    return validateAndNormalizeTokens(raw, DEFAULT_TOKENS);
  } catch {
    return { ...DEFAULT_TOKENS };
  }
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function serveFile(res, filePath, extraHeaders = {}, allowedRoot = null) {
  let targetPath = filePath;
  if (allowedRoot) {
    try {
      const realRoot = fs.realpathSync(allowedRoot);
      const realFile = fs.realpathSync(filePath);
      if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) {
        res.writeHead(403, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end('Forbidden');
        return;
      }
      targetPath = realFile;
    } catch (err) {
      const isNotFound = err && (err.code === 'ENOENT' || err.code === 'ENOTDIR');
      res.writeHead(isNotFound ? 404 : 500, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(isNotFound ? 'Not Found' : 'Internal Server Error');
      return;
    }
  }
  fs.readFile(targetPath, (err, buf) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(err.code === 'ENOENT' ? 'Not Found' : 'Internal Server Error');
      return;
    }
    const ext = path.extname(targetPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    });
    res.end(buf);
  });
}

function createWorkbenchServer(options = {}) {
  const tokensPath = options.tokensPath || DEFAULT_TOKENS_PATH;
  const enableWatch = options.watch !== false;
  const sseClients = new Set();
  let watcher = null;
  let reloadTimer = null;

  // 每实例独立随机 Token 与严格 mkdtemp 私有沙盒（绝不触碰 ~/.gemini/config）
  const studioToken = crypto.randomBytes(24).toString('hex');
  let studioSandboxRoot = null;
  let studioService = null;
  let studioServicePromise = null;
  let closing = false;

  const ensureStudioService = () => {
    if (closing) {
      return Promise.reject(Object.assign(new Error('Studio server is closing'), { statusCode: 503 }));
    }
    if (studioService) return Promise.resolve(studioService);
    if (!studioServicePromise) {
      studioServicePromise = (async () => {
        const mod = await import(pathToFileURL(SIDEBAR_SERVICE_PATH).href);
        const factory = mod.createStudioSandboxService;
        if (typeof factory !== 'function') {
          throw new Error('createStudioSandboxService export not found');
        }
        let tmpRoot = null;
        try {
          tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-studio-'));
          const svc = factory({ sandboxRoot: tmpRoot });
          if (closing) {
            await svc.dispose();
            throw Object.assign(new Error('Studio server closed during init'), { statusCode: 503 });
          }
          studioSandboxRoot = tmpRoot;
          studioService = svc;
          return svc;
        } catch (initErr) {
          if (tmpRoot) {
            try {
              fs.rmSync(tmpRoot, { recursive: true, force: true });
            } catch {
              // 忽略临时目录清理异常
            }
          }
          throw initErr;
        }
      })().catch((err) => {
        studioServicePromise = null;
        throw err;
      });
    }
    return studioServicePromise;
  };

  const buildStudioEnvelope = (svc, payload) => {
    const audit = typeof svc.getPermissionAudit === 'function' ? svc.getPermissionAudit() : null;
    const catalog =
      svc.hostAdapter && typeof svc.hostAdapter.getCatalog === 'function'
        ? svc.hostAdapter.getCatalog()
        : null;
    return {
      ...payload,
      audit,
      catalog,
    };
  };

  const broadcastReload = () => {
    for (const client of sseClients) {
      try {
        client.write('event: reload\ndata: {"ts":' + Date.now() + '}\n\n');
      } catch {
        sseClients.delete(client);
      }
    }
  };

  if (enableWatch) {
    try {
      watcher = fs.watch(WORKBENCH_DIR, { recursive: true }, (_evt, filename) => {
        if (!filename || filename.endsWith('design-tokens.json')) return;
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(broadcastReload, 120);
      });
    } catch {
      watcher = null;
    }
  }

  const server = http.createServer((req, res) => {
    let pathname;
    try {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      pathname = decodeURIComponent(reqUrl.pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    if (!isLoopbackOriginAllowed(req)) {
      sendJson(res, 403, { ok: false, error: 'Forbidden origin or host' });
      return;
    }

    // ── Studio API 路由（独立回环校验 + 每实例 Token + 隔离沙盒服务） ──
    if (pathname.startsWith('/api/studio/')) {
      const isWrite = req.method === 'POST';
      const sec = verifyStudioRequestSecurity(req, server, studioToken, isWrite);
      if (!sec.ok) {
        sendJson(res, sec.status, { ok: false, error: { code: 'FORBIDDEN', message: sec.error, retryable: false } });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/studio/state') {
        void ensureStudioService()
          .then((svc) => {
            const stateRes = svc.getState();
            const status = stateRes.ok ? 200 : mapStudioErrorStatus(stateRes);
            sendJson(res, status, buildStudioEnvelope(svc, stateRes), {
              'X-Studio-Token': studioToken,
            });
          })
          .catch((err) => {
            sendJson(res, 503, {
              ok: false,
              error: { code: 'PERSISTENCE_FAILED', message: 'Studio sandbox unavailable', retryable: true },
            });
          });
        return;
      }

      if (req.method === 'POST' && (
        pathname === '/api/studio/rpc' ||
        pathname === '/api/studio/fixture' ||
        pathname === '/api/studio/reset' ||
        pathname === '/api/studio/wsl-challenge'
      )) {
        void Promise.all([ensureStudioService(), readJsonBody(req, MAX_BODY_BYTES)])
          .then(async ([svc, body]) => {
            if (pathname === '/api/studio/rpc') {
              const rpcRes = await svc.handleRpc(body);
              sendJson(res, mapStudioErrorStatus(rpcRes), buildStudioEnvelope(svc, rpcRes));
              return;
            }
            if (pathname === '/api/studio/fixture') {
              const fixRes = await svc.applyFixture(body);
              sendJson(res, mapStudioErrorStatus(fixRes), buildStudioEnvelope(svc, fixRes));
              return;
            }
            if (pathname === '/api/studio/reset') {
              const rstRes = await svc.resetSandbox();
              sendJson(res, mapStudioErrorStatus(rstRes), buildStudioEnvelope(svc, rstRes));
              return;
            }
            // 可信弹窗模拟专用：按 operationId 读取一次性 WSL challenge
            const opId = body && typeof body.operationId === 'string' ? body.operationId.trim() : '';
            if (!opId) {
              sendJson(res, 400, { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Missing operationId', retryable: false } });
              return;
            }
            const info = typeof svc.getTrustedWslChallenge === 'function' ? svc.getTrustedWslChallenge(opId) : null;
            if (!info) {
              sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'No active WSL challenge for operation', retryable: false } });
              return;
            }
            sendJson(res, 200, { ok: true, challenge: info });
          })
          .catch((err) => {
            const st = err && (err.statusCode === 413 || err.statusCode === 400) ? err.statusCode : 503;
            const safeMsg =
              st === 413
                ? 'Payload too large'
                : st === 400
                  ? 'Malformed JSON payload'
                  : 'Studio sandbox unavailable';
            sendJson(res, st, {
              ok: false,
              error: {
                code: st === 413 ? 'LIMIT_EXCEEDED' : st === 400 ? 'INVALID_ARGUMENT' : 'PERSISTENCE_FAILED',
                message: safeMsg,
                retryable: st >= 500,
              },
            });
          });
        return;
      }

      sendJson(res, req.method === 'GET' || req.method === 'POST' ? 404 : 405, {
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Studio route not found', retryable: false },
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (pathname === '/api/tokens') {
      if (req.method === 'GET') {
        sendJson(res, 200, readTokensFile(tokensPath));
        return;
      }
      if (req.method === 'POST') {
        const sec = verifyLoopbackHostAndOrigin(req, server, { requireOrigin: false });
        if (!sec.ok) {
          sendJson(res, sec.status, { ok: false, error: sec.error });
          return;
        }
        const ctype = String(req.headers['content-type'] || '').toLowerCase();
        if (ctype && !ctype.includes('application/json')) {
          sendJson(res, 415, { ok: false, error: 'Content-Type must be application/json' });
          return;
        }
        const chunks = [];
        let total = 0;
        let aborted = false;
        req.on('data', (chunk) => {
          total += chunk.length;
          if (total > MAX_BODY_BYTES) {
            aborted = true;
            sendJson(res, 413, { ok: false, error: 'Payload too large' });
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => {
          if (aborted) return;
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const current = readTokensFile(tokensPath);
            const normalized = validateAndNormalizeTokens(parsed, current);
            fs.mkdirSync(path.dirname(tokensPath), { recursive: true });
            fs.writeFileSync(tokensPath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
            sendJson(res, 200, { ok: true, tokens: normalized });
          } catch (err) {
            sendJson(res, 400, { ok: false, error: err && err.message ? err.message : 'Invalid tokens' });
          }
        });
        return;
      }
      sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    if (pathname === '/studio' || pathname === '/studio/') {
      const sec = verifyStudioRequestSecurity(req, server, studioToken, false);
      if (!sec.ok) {
        sendJson(res, sec.status, { ok: false, error: sec.error });
        return;
      }
      serveFile(res, path.join(WORKBENCH_DIR, 'studio.html'), { 'X-Studio-Token': studioToken }, WORKBENCH_DIR);
      return;
    }

    if (SHARED_MODULE_MAP[pathname]) {
      serveFile(res, SHARED_MODULE_MAP[pathname]);
      return;
    }

    const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const resolved = path.resolve(WORKBENCH_DIR, relPath);
    if (resolved !== WORKBENCH_DIR && !resolved.startsWith(WORKBENCH_DIR + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    serveFile(res, resolved, {}, WORKBENCH_DIR);
  });

  server.getStudioToken = () => studioToken;
  server.getStudioSandboxRoot = () => studioSandboxRoot;

  const origClose = server.close.bind(server);
  server.close = (cb) => {
    closing = true;
    clearTimeout(reloadTimer);
    if (watcher) {
      try {
        watcher.close();
      } catch {}
      watcher = null;
    }
    for (const client of sseClients) {
      try {
        client.end();
      } catch {}
    }
    sseClients.clear();

    const cleanupStudio = async () => {
      try {
        if (studioServicePromise) {
          const svc = await studioServicePromise.catch(() => null);
          if (svc && typeof svc.dispose === 'function') {
            await svc.dispose();
          }
        } else if (studioService && typeof studioService.dispose === 'function') {
          await studioService.dispose();
        }
      } catch {
        // 忽略关闭期间排空异常
      }
      if (studioSandboxRoot) {
        const rootToClean = studioSandboxRoot;
        studioSandboxRoot = null;
        try {
          fs.rmSync(rootToClean, { recursive: true, force: true });
        } catch {
          // 忽略临时目录清理异常
        }
      }
    };

    return origClose((closeErr) => {
      void cleanupStudio().finally(() => {
        if (typeof cb === 'function') cb(closeErr);
      });
    });
  };

  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4321);
  const host = process.env.HOST || '127.0.0.1';
  const server = createWorkbenchServer();
  server.listen(port, host, () => {
    const addr = server.address();
    console.log(`Obsidian Prism v1.0.2 Workbench listening on http://${host}:${addr.port}`);
    console.log(`  · Optical Workbench: http://${host}:${addr.port}/`);
    console.log(`  · Bipolar Studio:    http://${host}:${addr.port}/studio`);
  });
}

module.exports = {
  DEFAULT_TOKENS,
  validateAndNormalizeTokens,
  createWorkbenchServer,
};
