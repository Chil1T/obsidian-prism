import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const cdp = require(path.join(ROOT, 'cdp.js'));

const CH1_HARD_LIMIT = 549500;
const BRIDGE_HARD_LIMIT = 31000;
const CONFIG_REFRESH_HARD_LIMIT = 4096;
const TARGET_LOCALES = ['auto', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de'];

function listTrackedFiles() {
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
      .filter((s) => s && fs.existsSync(path.join(ROOT, s)));
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
    return out;
  }
}

test('Law 4: Channel 1 (auto + 8 locales) < 549,500 B, pulse-vial-bridge.js < 31,000 B, incremental configRefresh < 4,096 B', () => {
  const summary = [];
  for (const locale of TARGET_LOCALES) {
    const expr = cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: locale });
    const bytes = Buffer.byteLength(expr, 'utf8');
    summary.push(`${locale}=${bytes}B`);
    assert.ok(
      bytes < CH1_HARD_LIMIT,
      `Channel 1 [${locale}] payload ${bytes} B exceeds hard limit ${CH1_HARD_LIMIT} B`
    );
  }

  const bridgeBytes = fs.statSync(path.join(ROOT, 'pulse-vial-bridge.js')).size;
  assert.ok(
    bridgeBytes < BRIDGE_HARD_LIMIT,
    `pulse-vial-bridge.js ${bridgeBytes} B exceeds hard limit ${BRIDGE_HARD_LIMIT} B`
  );

  // Incremental configRefresh without language-slice rebuild must stay lightweight (< 4 KiB)
  const refreshExpr = cdp.buildConfigRefreshExpression({ palette: 'warm' });
  const refreshBytes = Buffer.byteLength(refreshExpr, 'utf8');
  assert.ok(
    refreshBytes < CONFIG_REFRESH_HARD_LIMIT,
    `Incremental configRefresh payload ${refreshBytes} B exceeds hard limit ${CONFIG_REFRESH_HARD_LIMIT} B`
  );

  console.log(
    `[bundle-budget] Ch1: ${summary.join(', ')} | pulse-vial-bridge.js=${bridgeBytes}B | configRefresh=${refreshBytes}B`
  );
});

test('Law 10: Tracked core text files enforce strict 0 UTF-8 BOM and 0 CRLF line endings', () => {
  const tracked = listTrackedFiles();
  const coreTextRe = /\.(?:mjs|cjs|js|css|json|md|yml|yaml|cff|manifest|cs|swift|html|svg|txt)$/i;
  const bomViolations = [];
  const crlfViolations = [];

  for (const rel of tracked) {
    if (!coreTextRe.test(rel)) continue;
    const buf = fs.readFileSync(path.join(ROOT, rel));
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      bomViolations.push(rel);
    }
    if (buf.includes(0x0d)) {
      crlfViolations.push(rel);
    }
  }

  assert.deepEqual(bomViolations, [], `UTF-8 BOM detected in tracked text file(s): ${bomViolations.join(', ')}`);
  assert.deepEqual(crlfViolations, [], `CRLF line endings detected in tracked text file(s): ${crlfViolations.join(', ')}`);
});
