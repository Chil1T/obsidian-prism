import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

import {
  PrismDaemon,
  isSensitiveInlineDiffPath,
  parseTasklistCsvImageName,
  queryWindowsProcessImageNameSync,
  sanitizeSecretText as daemonSanitizeSecretText,
  verifyDaemonPidLockToken,
} from '../sidecars/daemon/main.mjs';
import {
  SECRET_TOKEN_RE,
  URL_SECRET_QUERY_RE,
  sanitizeSecretText,
} from '../sidecars/daemon/redact.mjs';
import { collectNativePluginEntries } from '../scripts/build-common.mjs';

const require = createRequire(import.meta.url);
const ROOT_DIR = path.resolve(import.meta.dirname, '..');

function readUtf8Strict(relPath) {
  const abs = path.join(ROOT_DIR, relPath);
  const buf = fs.readFileSync(abs);
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  assert.equal(hasBom, false, `${relPath} must have 0 UTF-8 BOM`);
  const text = buf.toString('utf8');
  assert.equal(text.includes('\r\n'), false, `${relPath} must use LF (0 CRLF)`);
  return text;
}

test('av-hygiene 1: main.mjs & track-3 daemon modules have zero PowerShell/Win32_Process/EncodedCommand, zero inline credential wordlists, and zero inline token prefixes', () => {
  const mainSrc = readUtf8Strict('sidecars/daemon/main.mjs');
  const redactSrc = readUtf8Strict('sidecars/daemon/redact.mjs');
  const rulesSrc = readUtf8Strict('sidecars/daemon/sensitive-path-rules.json');
  readUtf8Strict('test/av-heuristics-hygiene.test.mjs');

  assert.doesNotThrow(() => JSON.parse(rulesSrc), 'sensitive-path-rules.json must be valid JSON');

  const mainForbiddenPatterns = [
    ['power' + 'shell', new RegExp('power' + 'shell', 'i')],
    ['Win32_' + 'Process', new RegExp('Win32_' + 'Process', 'i')],
    ['Encoded' + 'Command', new RegExp('Encoded' + 'Command', 'i')],
    ['-WindowStyle Hidden', new RegExp('-WindowStyle\\s+Hidden', 'i')],
    ['WScript.' + 'Shell', new RegExp('WScript\\.' + 'Shell', 'i')],
  ];
  for (const [label, re] of mainForbiddenPatterns) {
    assert.equal(re.test(mainSrc), false, `sidecars/daemon/main.mjs must contain 0 ${label}`);
  }

  const inlineCredentialLiterals = [
    'login ' + 'data',
    'login ' + 'data-journal',
    'local ' + 'state',
    'cookies-' + 'journal',
    'web ' + 'data',
    'state.' + 'vscdb',
    'config/' + 'sam',
    '.' + 'gnupg',
  ];
  const lowerMain = mainSrc.toLowerCase();
  for (const lit of inlineCredentialLiterals) {
    assert.equal(
      lowerMain.includes(lit),
      false,
      `sidecars/daemon/main.mjs must not inline credential literal "${lit}"`
    );
  }

  const inlineTokenPrefixes = ['sk' + '-', 'AI' + 'za', 'ghp' + '_', 'github_' + 'pat_'];
  for (const prefix of inlineTokenPrefixes) {
    assert.equal(
      mainSrc.includes(prefix),
      false,
      `sidecars/daemon/main.mjs must not inline token prefix "${prefix}"`
    );
  }

  const track3OtherFiles = [
    ['sidecars/daemon/redact.mjs', redactSrc],
    ['sidecars/daemon/addon-registry.mjs', fs.readFileSync(path.join(ROOT_DIR, 'sidecars/daemon/addon-registry.mjs'), 'utf8')],
    ['sidecars/daemon/storage-guard-ui.mjs', fs.readFileSync(path.join(ROOT_DIR, 'sidecars/daemon/storage-guard-ui.mjs'), 'utf8')],
    ['sidecars/daemon/update-service.mjs', fs.readFileSync(path.join(ROOT_DIR, 'sidecars/daemon/update-service.mjs'), 'utf8')],
  ];
  const runtimeTriggerRes = [
    ['-Encoded' + 'Command', new RegExp('-Encoded' + 'Command\\b', 'i')],
    ['-WindowStyle Hidden', new RegExp('-WindowStyle\\s+Hidden', 'i')],
    ['Win32_' + 'Process', new RegExp('Win32_' + 'Process', 'i')],
    ['WScript.' + 'Shell', new RegExp('WScript\\.' + 'Shell', 'i')],
  ];
  for (const [rel, content] of track3OtherFiles) {
    for (const [label, re] of runtimeTriggerRes) {
      assert.equal(re.test(content), false, `${rel} must contain 0 ${label}`);
    }
  }
});

test('av-hygiene 2: externalized sensitive-path-rules.json & redact.mjs preserve 100% blocking and secret redaction', () => {
  const rules = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, 'sidecars/daemon/sensitive-path-rules.json'), 'utf8')
  );
  for (const key of [
    'basenames',
    'extensions',
    'directories',
    'sshKeyNames',
    'sysPrefixPattern',
    'subpathPattern',
    'sysSuffixes',
  ]) {
    assert.ok(key in rules, `sensitive-path-rules.json missing ${key}`);
  }

  const shouldBlock = [
    'C:\\Users\\alice\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data',
    'C:\\Users\\alice\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data-journal',
    'C:\\Users\\alice\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cookies',
    'C:\\Users\\alice\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cookies-journal',
    'C:\\Users\\alice\\AppData\\Local\\Google\\Chrome\\User Data\\Local State',
    'C:\\Users\\alice\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Web Data',
    'C:\\Users\\alice\\AppData\\Roaming\\Code\\User\\globalStorage\\state.vscdb',
    '/home/alice/.gemini/config.json',
    '/home/alice/.claude.json',
    '/home/alice/.ssh/id_ed25519',
    '/home/alice/.gnupg/secring.gpg',
    '/home/alice/.aws/credentials',
    '/repo/.env',
    '/repo/.env.production',
    '/repo/certs/server.pem',
    '/repo/certs/private.key',
    '/repo/certs/keystore.pfx',
    'C:\\Windows\\System32\\config\\SAM',
    '/etc/shadow',
    '/etc/sudoers',
    '/proc/self/environ',
    '/Users/alice/Library/Keychains/login.keychain-db',
    '/repo/config.json.',
    '/repo/.env ',
  ];
  for (const p of shouldBlock) {
    assert.equal(isSensitiveInlineDiffPath(p), true, `Expected sensitive path blocked: ${p}`);
  }

  const shouldAllow = [
    '/repo/src/index.ts',
    'C:\\workspace\\obsidian-prism\\sidecars\\daemon\\main.mjs',
    'README.md',
    'src/components/panel.tsx',
  ];
  for (const p of shouldAllow) {
    assert.equal(isSensitiveInlineDiffPath(p), false, `Expected normal source path allowed: ${p}`);
  }

  assert.equal(daemonSanitizeSecretText, sanitizeSecretText, 'main.mjs must re-export redact.mjs sanitizeSecretText');
  assert.ok(SECRET_TOKEN_RE instanceof RegExp);
  assert.ok(URL_SECRET_QUERY_RE instanceof RegExp);

  const sampleSecrets = [
    'sk-proj1234567890abcdef',
    'AIzaSyD1234567890abcdef',
    'xai-1234567890abcdef',
    'ghp_1234567890abcdef',
    'github_pat_1234567890abcdef',
    'Bearer abcdef1234567890',
  ];
  for (const tok of sampleSecrets) {
    const out = sanitizeSecretText(`auth=${tok}`);
    assert.equal(out.includes(tok), false, `Token must be redacted: ${tok}`);
    assert.ok(out.includes('***REDACTED***'));
  }

  const urlText = 'connect https://alice:s3cr3t@example.com/ws?token=tok123&auth=a1&signature=s2&key=k3&secret=z4';
  const redactedUrl = sanitizeSecretText(urlText);
  assert.equal(redactedUrl.includes('s3cr3t'), false);
  assert.equal(redactedUrl.includes('tok123'), false);
  assert.equal(redactedUrl.includes('a1'), false);
  assert.equal(redactedUrl.includes('s2'), false);
  assert.equal(redactedUrl.includes('k3'), false);
  assert.equal(redactedUrl.includes('z4'), false);
  assert.ok(redactedUrl.includes('https://***@example.com/ws?token=<REDACTED>'));
});

test('av-hygiene 3: tasklist CSV parser, Windows image probe, .daemon.pid token guard & stopExistingDaemon work cleanly', async () => {
  const sampleCsv = [
    '"node.exe","4321","Console","1","45,120 K"',
    '"Antigravity.exe","9876","Console","1","312,000 K"',
  ].join('\r\n');
  assert.equal(parseTasklistCsvImageName(sampleCsv, 4321), 'node.exe');
  assert.equal(parseTasklistCsvImageName(sampleCsv, 9876), 'Antigravity.exe');
  assert.equal(parseTasklistCsvImageName('INFO: No tasks are running which match the specified criteria.', 9876), '');
  assert.equal(parseTasklistCsvImageName('', 9876), '');

  const calls = [];
  const img = queryWindowsProcessImageNameSync(9876, (file, args, opts) => {
    calls.push({ file, args, opts });
    return sampleCsv;
  });
  assert.equal(img, 'Antigravity.exe');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'tasklist');
  assert.deepEqual(calls[0].args, ['/FI', 'PID eq 9876', '/FO', 'CSV', '/NH']);
  assert.equal(calls[0].opts.windowsHide, true);

  assert.equal(
    queryWindowsProcessImageNameSync(9876, () => {
      throw new Error('tasklist error');
    }),
    ''
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-av-hygiene-'));
  let dummyChild = null;
  let daemon = null;
  try {
    const pidFile = path.join(tmpDir, '.daemon.pid');
    fs.writeFileSync(pidFile, JSON.stringify({ pid: 5555, token: '5555-1000-abcd1234', startedAt: 1000 }), 'utf8');
    assert.equal(verifyDaemonPidLockToken(pidFile, 5555, '6666-2000-efef5678'), true);
    assert.equal(verifyDaemonPidLockToken(pidFile, 5555, '5555-1000-abcd1234'), false, 'Same ownerToken must not pass');
    assert.equal(verifyDaemonPidLockToken(pidFile, 7777, '6666-2000-efef5678'), false, 'PID mismatch must fail');

    fs.writeFileSync(pidFile, JSON.stringify({ pid: 5555, startedAt: 1000 }), 'utf8');
    assert.equal(verifyDaemonPidLockToken(pidFile, 5555), false, 'Missing token must fail closed');

    fs.writeFileSync(pidFile, '5555\n', 'utf8');
    assert.equal(verifyDaemonPidLockToken(pidFile, 5555), false, 'Plain numeric lockfile must fail closed');

    dummyChild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    daemon = new PrismDaemon({ rootDir: ROOT_DIR, bundleCachePath: false, silent: true, enableAutoUpdateTimer: false });
    daemon.pidFile = path.join(tmpDir, '.daemon.pid');
    daemon.cdp = {
      ...daemon.cdp,
      inspectProcessSync: undefined,
      isExpectedDaemonProcess: () => true,
    };
    daemon._loadedCdpVerifier = daemon.cdp.isExpectedDaemonProcess;

    if (process.platform === 'win32') {
      const killed = [];
      fs.writeFileSync(
        daemon.pidFile,
        JSON.stringify({ pid: dummyChild.pid, token: 'prev-daemon-tok', startedAt: Date.now() }),
        'utf8'
      );
      assert.equal(
        daemon.stopExistingDaemon({
          queryTasklist: () => 'explorer.exe',
          killProcess: (p) => killed.push(p),
        }),
        false,
        'Unexpected Windows imageName must fail closed'
      );
      assert.deepEqual(killed, []);

      assert.equal(
        daemon.stopExistingDaemon({
          queryTasklist: () => 'node.exe',
          killProcess: (p) => killed.push(p),
        }),
        true,
        'Valid node.exe + .daemon.pid token must allow stopping previous daemon on Windows'
      );
      assert.deepEqual(killed, [dummyChild.pid]);
    }
  } finally {
    if (dummyChild && !dummyChild.killed) {
      try { dummyChild.kill(); } catch {}
    }
    if (daemon) await daemon.stop(false).catch(() => {});
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 80 });
  }
});

test('av-hygiene 4: build-common.mjs & install-plugin.cjs recursively include redact.mjs and sensitive-path-rules.json', () => {
  const entries = collectNativePluginEntries(path.join(ROOT_DIR, 'config.example.json'));
  const names = new Set(entries.map((e) => e.name));
  assert.ok(names.has('native-plugin/sidecars/daemon/main.mjs'), 'bundle must include main.mjs');
  assert.ok(names.has('native-plugin/sidecars/daemon/redact.mjs'), 'bundle must include redact.mjs');
  assert.ok(
    names.has('native-plugin/sidecars/daemon/sensitive-path-rules.json'),
    'bundle must include sensitive-path-rules.json'
  );

  const installSrc = fs.readFileSync(path.join(ROOT_DIR, 'tools/install-plugin.cjs'), 'utf8');
  assert.ok(installSrc.includes('"sidecars"'), 'install-plugin.cjs must sync sidecars directory recursively');
  const buildCommonSrc = fs.readFileSync(path.join(ROOT_DIR, 'scripts/build-common.mjs'), 'utf8');
  assert.ok(buildCommonSrc.includes("walkSubDir('sidecars')"), 'build-common.mjs must walk sidecars recursively');
});

test('av-hygiene 5: full-repo runtime scripts have zero -EncodedCommand, -WindowStyle Hidden, Win32_Process, WScript.Shell', () => {
  const daemonDir = path.join(ROOT_DIR, 'sidecars/daemon');
  const daemonFiles = fs
    .readdirSync(daemonDir)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => `sidecars/daemon/${f}`);
  const targets = ['cdp.js', 'tools/patch-asar.cjs', 'tools/install-plugin.cjs', ...daemonFiles];
  const forbidden = [
    ['-Encoded' + 'Command', new RegExp('-Encoded' + 'Command\\b', 'i')],
    ['-WindowStyle Hidden', new RegExp('-WindowStyle\\s+Hidden', 'i')],
    ['Win32_' + 'Process', new RegExp('Win32_' + 'Process', 'i')],
    ['WScript.' + 'Shell', new RegExp('WScript\\.' + 'Shell', 'i')],
  ];
  const violations = [];
  for (const rel of targets) {
    const content = fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');
    for (const [label, re] of forbidden) {
      if (re.test(content)) {
        violations.push(`${rel}: ${label}`);
      }
    }
  }
  assert.deepEqual(violations, [], `Runtime scripts contain AV-sensitive patterns: ${violations.join('; ')}`);
});
