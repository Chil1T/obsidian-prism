const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const WORKBENCH_DIR = __dirname;
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TOKENS_PATH = path.join(WORKBENCH_DIR, 'design-tokens.json');

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
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const LOOPBACK_HOST_RE = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;

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

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(err.code === 'ENOENT' ? 'Not Found' : 'Internal Server Error');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
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
          if (total > 65536) {
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

    serveFile(res, resolved);
  });

  const origClose = server.close.bind(server);
  server.close = (cb) => {
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
    return origClose(cb);
  };

  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4321);
  const host = process.env.HOST || '127.0.0.1';
  const server = createWorkbenchServer();
  server.listen(port, host, () => {
    const addr = server.address();
    console.log(`Obsidian Prism v1.0 Workbench listening on http://${host}:${addr.port}`);
  });
}

module.exports = {
  DEFAULT_TOKENS,
  validateAndNormalizeTokens,
  createWorkbenchServer,
};
