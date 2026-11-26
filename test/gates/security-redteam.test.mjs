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

test('Law 7c: Repo-wide AV redline gate (including vendor/, src/, installer/ and scripts/win/) locked to strict 0 debt', () => {
  // Permanently locked to 0 across the entire repository (Phase 1A zero-AV clearance).
  const RULES = [
    {
      id: 'encodedCmd',
      re: /['"]-(?:EncodedCommand|enc)['"]|\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*-(?:EncodedCommand|enc)\b|-EncodedCommand\b/gi,
    },
    { id: 'hiddenPs', re: /-WindowStyle(?:\s+|['"]\s*,\s*['"])Hidden\b/gi },
    { id: 'addType', re: /\bAdd-Type\b/gi },
    { id: 'wmi', re: /\b(?:Win32_Process|Get-CimInstance|Get-WmiObject)\b/gi },
    { id: 'getNetTcp', re: /\bGet-NetTCPConnection\b/gi },
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

    for (const rule of RULES) {
      const count = [...text.matchAll(rule.re)].length;
      if (count > 0) {
        violations.push(`${rel}: AV redline "${rule.id}" count=${count} (must be 0)`);
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
    if (nonReadOnlyOpenProc > 0) {
      violations.push(`${rel}: non-allowlisted OpenProcess count=${nonReadOnlyOpenProc} (must be 0)`);
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

test('Law 7e: Windows PE metadata, watcher app.manifest, SignPath two-step hooks, and trust/security docs exist', () => {
  const buildInstallerSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'build-installer.mjs'), 'utf8');
  for (const requiredToken of [
    'AssemblyTitle',
    'AssemblyDescription',
    'AssemblyCompany',
    'AssemblyProduct',
    'AssemblyCopyright',
    'AssemblyVersion',
    'AssemblyFileVersion',
    'AssemblyInformationalVersion',
    '--watcher-only',
    '--prebuilt-watcher',
  ]) {
    assert.ok(
      buildInstallerSrc.includes(requiredToken),
      `scripts/build-installer.mjs must include PE metadata / SignPath token: ${requiredToken}`
    );
  }

  const watcherManifestPath = path.join(ROOT, 'installer', 'watcher', 'app.manifest');
  assert.equal(fs.existsSync(watcherManifestPath), true, 'installer/watcher/app.manifest must exist');
  const watcherManifest = fs.readFileSync(watcherManifestPath, 'utf8');
  assert.ok(watcherManifest.includes('level="asInvoker"'), 'watcher/app.manifest must declare asInvoker');
  assert.ok(
    watcherManifest.includes('{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}'),
    'watcher/app.manifest must declare Win10/11 compatibility GUID'
  );

  const signingPolicyPath = path.join(ROOT, 'docs', 'CODE_SIGNING_POLICY.md');
  assert.equal(fs.existsSync(signingPolicyPath), true, 'docs/CODE_SIGNING_POLICY.md must exist');
  const signingPolicy = fs.readFileSync(signingPolicyPath, 'utf8');
  assert.ok(signingPolicy.includes('SignPath'), 'docs/CODE_SIGNING_POLICY.md must document SignPath Foundation');
  assert.ok(signingPolicy.includes('GPL-3.0'), 'docs/CODE_SIGNING_POLICY.md must declare GPL-3.0 license');
  assert.ok(signingPolicy.includes('SHA256SUMS.txt'), 'docs/CODE_SIGNING_POLICY.md must document SHA256SUMS.txt verification');

  const securityMdPath = path.join(ROOT, '.github', 'SECURITY.md');
  assert.equal(fs.existsSync(securityMdPath), true, '.github/SECURITY.md must exist');
  const securityMd = fs.readFileSync(securityMdPath, 'utf8');
  for (const needle of ['app.asar', '127.0.0.1', 'Sec-Fetch-Site', 'SSRF', '0o600', '<USER_HOME>']) {
    assert.ok(securityMd.includes(needle), `.github/SECURITY.md must document security boundary: ${needle}`);
  }
});
