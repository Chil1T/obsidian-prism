import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function listRepoFiles() {
  try {
    const tracked = execFileSync('git', ['ls-files'], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [...new Set([...tracked.split(/\r?\n/), ...untracked.split(/\r?\n/)])]
      .map((s) => s.trim())
      .filter((s) => s && fs.existsSync(path.join(ROOT, s)))
      .sort();
  } catch {
    const out = [];
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === '.git' || ent.name === 'node_modules' || ent.name === 'dist') continue;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(abs);
        else if (ent.isFile()) out.push(path.relative(ROOT, abs).replace(/\\/g, '/'));
      }
    };
    walk(ROOT);
    return out.sort();
  }
}

function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

const ALL_FILES = listRepoFiles();

test('Law 7a: CDP domain permanent allowlist (only Page.* / Runtime.* / Target.* / Browser.close)', () => {
  const FORBIDDEN_CDP_DOMAINS = [
    'Network',
    'Fetch',
    'Debugger',
    'Input',
    'Emulation',
    'DOM',
    'CSS',
    'Overlay',
    'Security',
    'Storage',
    'SystemInfo',
    'Memory',
    'HeapProfiler',
    'Profiler',
    'Tracing',
    'Inspector',
    'Performance',
  ];
  const cdpCallRe = /['"]([A-Z][A-Za-z]+\.[a-z][A-Za-z0-9]+)['"]/g;
  const knownDomains = new Set(['Page', 'Runtime', 'Target', 'Browser', ...FORBIDDEN_CDP_DOMAINS]);
  const violations = [];

  for (const rel of ALL_FILES) {
    if (rel.startsWith('test/') || !/\.(?:mjs|cjs|js|cs|swift)$/.test(rel)) continue;
    const clean = stripJsComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const m of clean.matchAll(cdpCallRe)) {
      const method = m[1];
      const domain = method.split('.')[0];
      if (!knownDomains.has(domain)) continue;
      const allowed =
        domain === 'Page' ||
        domain === 'Runtime' ||
        domain === 'Target' ||
        method === 'Browser.close';
      if (!allowed) {
        violations.push(`${rel}: forbidden CDP method "${method}"`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `CDP permanent allowlist violation (only Page.*/Runtime.*/Target.*/Browser.close permitted):\n${violations.join('\n')}`
  );
});

test('Law 7b: Host SQLite database physical isolation (never open state.vscdb or host conversations/*.db)', () => {
  const violations = [];
  for (const rel of ALL_FILES) {
    if (rel.startsWith('test/') || !/\.(?:mjs|cjs|js|cs|swift)$/.test(rel)) continue;
    const clean = stripJsComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

    if (/state\.vscdb/i.test(clean)) {
      violations.push(`${rel}: references forbidden host database state.vscdb`);
    }

    // Verify any DatabaseSync(...) call never targets host conversations/*.db or *.vscdb
    for (const m of clean.matchAll(/new\s+DatabaseSync\s*\(([^)]+)\)/g)) {
      const arg = m[1];
      if (/vscdb|conversations/i.test(arg)) {
        violations.push(`${rel}: DatabaseSync targets forbidden host DB path (${arg.trim()})`);
      }
    }
  }

  assert.deepEqual(violations, [], `Host database isolation violations:\n${violations.join('\n')}`);
});

test('Law 7c: Repo-wide AV redline gate (including vendor/ and scripts/win/) with explicit Phase 1 debt ratchet', () => {
  // TEMPORARY Phase 1 debt ratchet: remove each entry and lock to 0 once cleared in Phase 1!
  // No other file in the repository may introduce ANY of these patterns.
  const PHASE1_TEMP_DEBT = Object.freeze({
    'vendor/pulse-dashboard/sidecars/panel/discovery.mjs': {
      addType: 1,
      wmi: 2,
      openProcessNonReadOnly: 3,
    },
    'vendor/wallpaper/wallpaper-service.mjs': {
      addType: 1,
      hiddenPs: 1,
      encodedCmd: 1,
    },
    'vendor/sidebar-studio/sidebar-service.mjs': {
      addType: 1,
      encodedCmd: 1,
    },
    'scripts/win/watch.bat': {
      hiddenPs: 2,
    },
    'sidecars/daemon/main.mjs': {
      inlineNodeDashE: 1,
    },
  });

  const RULES = [
    {
      id: 'encodedCmd',
      re: /['"]-(?:EncodedCommand|enc)['"]|\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*-(?:EncodedCommand|enc)\b|-EncodedCommand\b/gi,
    },
    { id: 'hiddenPs', re: /-WindowStyle(?:\s+|['"]\s*,\s*['"])Hidden\b/gi },
    { id: 'addType', re: /\bAdd-Type\b/gi },
    { id: 'wmi', re: /\b(?:Win32_Process|Get-CimInstance|Get-WmiObject)\b/gi },
    { id: 'wscript', re: /\bWScript\.Shell\b/gi },
    { id: 'emptyWorkingSet', re: /\bEmptyWorkingSet\b/gi },
    { id: 'taskkill', re: /\b(?:taskkill|Stop-Process)\b/gi },
    { id: 'inlineNodeDashE', re: /\bspawnArgs\s*=\s*\[\s*['"]-e['"]/g },
  ];

  const violations = [];

  for (const rel of ALL_FILES) {
    if (rel.startsWith('test/') || rel.endsWith('.md') || rel.startsWith('.github/')) continue;
    if (!/\.(?:mjs|cjs|js|bat|sh|ps1|cs|swift|cmd)$/i.test(rel)) continue;
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const text = rel.endsWith('.bat') || rel.endsWith('.cmd') ? raw : stripJsComments(raw);
    const debt = PHASE1_TEMP_DEBT[rel] || {};

    for (const rule of RULES) {
      const count = [...text.matchAll(rule.re)].length;
      const allowed = debt[rule.id] || 0;
      if (count > allowed) {
        violations.push(`${rel}: AV redline "${rule.id}" count=${count} exceeds ratchet cap=${allowed}`);
      }
    }

    // OpenProcess: only permitted in installer/common/CdpClient.cs with PROCESS_QUERY_LIMITED_INFORMATION
    const openProcMatches = [...text.matchAll(/\bOpenProcess\s*\([^)]*\)/g)];
    let nonReadOnlyOpenProc = 0;
    for (const m of openProcMatches) {
      const expr = m[0];
      const isCdpReadOnly =
        rel === 'installer/common/CdpClient.cs' &&
        (expr.includes('PROCESS_QUERY_LIMITED_INFORMATION') || expr.includes('uint dwDesiredAccess'));
      if (!isCdpReadOnly) nonReadOnlyOpenProc += 1;
    }
    const allowedOpenProc = debt.openProcessNonReadOnly || 0;
    if (nonReadOnlyOpenProc > allowedOpenProc) {
      violations.push(
        `${rel}: non-allowlisted OpenProcess count=${nonReadOnlyOpenProc} exceeds cap=${allowedOpenProc}`
      );
    }
  }

  assert.deepEqual(violations, [], `Repo-wide AV redline violations:\n${violations.join('\n')}`);
});

test('Law 7d: Every local http.createServer must explicitly bind to 127.0.0.1 / localhost loopback', () => {
  const violations = [];
  let serverFilesFound = 0;

  for (const rel of ALL_FILES) {
    if (rel.startsWith('test/') || !/\.(?:mjs|cjs|js)$/.test(rel)) continue;
    const clean = stripJsComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    if (!/\bcreateServer\s*\(/.test(clean)) continue;
    serverFilesFound += 1;

    // Must not bind 0.0.0.0 or ::
    if (/\.listen\s*\([^)]*['"](?:0\.0\.0\.0|::)['"]/.test(clean)) {
      violations.push(`${rel}: HTTP server binds wildcard address (0.0.0.0 / ::)`);
    }

    // Every .listen(...) call must pass at least 2 args (port + host) and file must default host to 127.0.0.1 / localhost
    const listenCalls = [...clean.matchAll(/\.listen\s*\(([^)]+)\)/g)];
    assert.ok(listenCalls.length > 0, `${rel} calls createServer() without .listen()`);
    const hasLoopbackDefault = /['"](?:127\.0\.0\.1|localhost)['"]/.test(clean);
    if (!hasLoopbackDefault) {
      violations.push(`${rel}: HTTP server lacks explicit 127.0.0.1 / localhost loopback binding`);
    }
    for (const m of listenCalls) {
      const args = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      if (args.length < 2) {
        violations.push(`${rel}: .listen(${m[1].trim()}) omits explicit loopback host argument`);
      }
    }
  }

  assert.ok(serverFilesFound >= 3, `Expected at least 3 local HTTP server modules checked, found ${serverFilesFound}`);
  assert.deepEqual(violations, [], `Local HTTP loopback binding violations:\n${violations.join('\n')}`);
});
