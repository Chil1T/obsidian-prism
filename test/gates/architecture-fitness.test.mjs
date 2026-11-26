import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { execFileSync } from 'node:child_process';
import { assertCssHygiene } from '../helpers/mini-dom.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

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

function resolveLocalSpecifier(fromRel, spec) {
  if (!spec || !spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(path.join(ROOT, fromRel)), spec);
  for (const cand of [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, 'index.js'),
    path.join(base, 'index.mjs'),
  ]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      return path.relative(ROOT, cand).replace(/\\/g, '/');
    }
  }
  return null;
}

// Legacy monolith ratchet (Constitution Law 2):
// Any file NOT in this table MUST stay <= 800 lines AND <= 40,960 bytes (40 KB).
// Legacy files listed here may shrink or stay flat, NEVER grow above baseline.
// (+16 B byte-tolerance solely accommodates future SemVer string length variance like beta.10; line counts are strictly 0-growth.)
const NEW_FILE_MAX_LINES = 800;
const NEW_FILE_MAX_BYTES = 40960;
const VERSION_LEN_SLACK_BYTES = 16;

const LEGACY_SIZE_RATCHET = Object.freeze({
  'cdp.js': { maxLines: 12699, maxBytes: 488431 },
  'conv-aura.js': { maxLines: 1269, maxBytes: 49696 },
  'crystal-prism-core.js': { maxLines: 1203, maxBytes: 46570 },
  'dual-mascot-rig.js': { maxLines: 5460, maxBytes: 230380 },
  'home-ripple-host.js': { maxLines: 851, maxBytes: 33715 },
  'home-studio-panel.js': { maxLines: 1112, maxBytes: 63268 },
  'host-workbench-enhancer.js': { maxLines: 2136, maxBytes: 84614 },
  'i18n-locales.js': { maxLines: 1890, maxBytes: 125941 },
  'inject.js': { maxLines: 1359, maxBytes: 63566 },
  'installer/common/CdpClient.cs': { maxLines: 4819, maxBytes: 230283 },
  'installer/macos/Common/CdpClient.swift': { maxLines: 2418, maxBytes: 121111 },
  'installer/macos/Setup/main.swift': { maxLines: 3216, maxBytes: 154603 },
  'installer/macos/Watcher/main.swift': { maxLines: 1556, maxBytes: 73129 },
  'installer/setup/Program.cs': { maxLines: 3787, maxBytes: 185248 },
  'installer/watcher/Program.cs': { maxLines: 1843, maxBytes: 99905 },
  'ripple-core.js': { maxLines: 2540, maxBytes: 110141 },
  'settings-panel.js': { maxLines: 3709, maxBytes: 187138 },
  'sidecars/daemon/addon-registry.mjs': { maxLines: 1247, maxBytes: 44160 },
  'sidecars/daemon/conversation-archive.mjs': { maxLines: 3618, maxBytes: 139431 },
  'sidecars/daemon/main.mjs': { maxLines: 12094, maxBytes: 518718 },
  'sidecars/daemon/update-service.mjs': { maxLines: 821, maxBytes: 27675 },
  'stream-choreography.js': { maxLines: 1775, maxBytes: 67500 },
  'style.css': { maxLines: 860, maxBytes: 209554 },
  'tools/install-plugin.cjs': { maxLines: 2395, maxBytes: 91058 },
  'tools/patch-asar.cjs': { maxLines: 1402, maxBytes: 44329 },
  'ui-runtime.js': { maxLines: 3125, maxBytes: 151637 },
  'usage-core.js': { maxLines: 832, maxBytes: 38862 },
  'vendor/clawd-mascot/octopath-stage-webgl.js': { maxLines: 1920, maxBytes: 83926 },
  'vendor/clawd-mascot/tavern-atlas-data.js': { maxLines: 39, maxBytes: 236452 },
  'vendor/effort-slider/upstream-client.js': { maxLines: 2525, maxBytes: 139337 },
  'vendor/host-i18n/host-i18n-runtime.js': { maxLines: 4060, maxBytes: 141820 },
  'vendor/host-i18n/swarm-i18n-runtime.js': { maxLines: 1117, maxBytes: 35924 },
  'vendor/inline-diff/inline-diff-client.js': { maxLines: 1460, maxBytes: 69394 },
  'vendor/omni-viewer/omni-client.js': { maxLines: 3240, maxBytes: 133430 },
  'vendor/omni-viewer/omni-server.mjs': { maxLines: 1413, maxBytes: 52674 },
  'vendor/omni-viewer/workbench-page.mjs': { maxLines: 2937, maxBytes: 117057 },
  'vendor/periodic-picker/bento-ui.js': { maxLines: 3138, maxBytes: 194699 },
  'vendor/periodic-picker/host-bridge.js': { maxLines: 1761, maxBytes: 72885 },
  'vendor/periodic-picker/keyboard-3d-gl.js': { maxLines: 12818, maxBytes: 578998 },
  'vendor/periodic-picker/model-catalog.js': { maxLines: 1796, maxBytes: 70612 },
  'vendor/periodic-picker/oled-cyber-screen.js': { maxLines: 3174, maxBytes: 124737 },
  'vendor/periodic-picker/pbr-grain-assets.js': { maxLines: 138, maxBytes: 304988 },
  'vendor/periodic-picker/periodic-picker.js': { maxLines: 6914, maxBytes: 317665 },
  'vendor/prompt-suggester/suggester-client.js': { maxLines: 1409, maxBytes: 53927 },
  'vendor/prompt-suggester/suggester-service.mjs': { maxLines: 1005, maxBytes: 36688 },
  'vendor/prompt-suggester/suggester-settings-ui.js': { maxLines: 1062, maxBytes: 50170 },
  'vendor/pulse-dashboard/compat/inline-widget.cjs': { maxLines: 1547, maxBytes: 142214 },
  'vendor/pulse-dashboard/compat/usage-ui.cjs': { maxLines: 400, maxBytes: 60734 },
  'vendor/pulse-dashboard/inline-fallback.js': { maxLines: 1317, maxBytes: 59912 },
  'vendor/pulse-dashboard/sidecars/panel/renderer-rpc-adapter.mjs': { maxLines: 1495, maxBytes: 75285 },
  'vendor/pulse-dashboard/sidecars/panel/usage.mjs': { maxLines: 806, maxBytes: 62178 },
  'vendor/sidebar-studio/sidebar-client.js': { maxLines: 5620, maxBytes: 290544 },
  'vendor/sidebar-studio/sidebar-service.mjs': { maxLines: 4294, maxBytes: 168999 },
  'vendor/sidebar-studio/state-machine.mjs': { maxLines: 2896, maxBytes: 104931 },
  'vendor/thought-translator/thought-client.js': { maxLines: 4314, maxBytes: 165338 },
  'vendor/thought-translator/thought-settings-ui.js': { maxLines: 2224, maxBytes: 110194 },
  'vendor/thought-translator/translator-service.mjs': { maxLines: 4453, maxBytes: 176883 },
  'vendor/wallpaper/wallpaper-client.js': { maxLines: 855, maxBytes: 36850 },
  'vendor/wallpaper/wallpaper-service.mjs': { maxLines: 1791, maxBytes: 58950 },
  'vial-core.js': { maxLines: 1776, maxBytes: 74852 },
  'workbench/app.js': { maxLines: 4832, maxBytes: 224677 },
  'workbench/replica.js': { maxLines: 1803, maxBytes: 95421 },
  'workbench/server.cjs': { maxLines: 924, maxBytes: 32965 },
  'workbench/studio.js': { maxLines: 3175, maxBytes: 136197 },
  'workbench/styles/studio-preview.css': { maxLines: 2555, maxBytes: 67388 },
  'workbench/styles/v2-components.css': { maxLines: 4319, maxBytes: 111849 },
  'workbench/styles/workbench-shell.css': { maxLines: 940, maxBytes: 21186 },
});

// Legacy CSS --_* and <=4-char short variables in style.css (Constitution Law 6: strictly non-growing).
const LEGACY_SHORT_OR_UNDERSCORE_CSS_VARS = new Set([
  '--_ab', '--_al', '--_aw', '--_aw2', '--_ax', '--_bg2', '--_bs', '--_cb', '--_cg', '--_cm',
  '--_cp', '--_cs', '--_cv', '--_cw', '--_cx', '--_d0', '--_d1', '--_d2', '--_d3', '--_d4',
  '--_d5', '--_d6', '--_d7', '--_d8', '--_d9', '--_db', '--_di', '--_dl', '--_dw2', '--_fa',
  '--_ffs', '--_fh', '--_fh2', '--_fl', '--_fr', '--_fs', '--_fs2', '--_fvl', '--_fw', '--_g0',
  '--_g1', '--_g2', '--_g3', '--_g4', '--_g5', '--_gs', '--_h1', '--_h2', '--_he', '--_k0',
  '--_k1', '--_k2', '--_kb', '--_kc', '--_kd', '--_kh', '--_ks', '--_ks2', '--_kw', '--_lm',
  '--_m', '--_ma', '--_na', '--_nd', '--_ng', '--_pd', '--_ps', '--_q0', '--_q5', '--_rb',
  '--_ro', '--_rr', '--_rs', '--_s1', '--_s2', '--_s3', '--_s8', '--_s9', '--_sa', '--_sb',
  '--_sb2', '--_sc', '--_sg', '--_sh', '--_sh2', '--_si', '--_sp', '--_sr', '--_ss', '--_st',
  '--_sv', '--_sy', '--_t1', '--_t2', '--_t3', '--_t4', '--_ta', '--_tb', '--_tc', '--_td',
  '--_tf', '--_tg', '--_ts', '--_tw', '--_wh', '--_x0', '--_x1', '--_x2', '--_x3', '--_x4',
  '--card', '--link',
]);

// Runtime innerHTML / outerHTML / insertAdjacentHTML write ratchet: permanently locked to 0 (Trusted Types safe).
const LEGACY_NON_EMPTY_HTML_WRITES = Object.freeze({});
const LEGACY_EMPTY_HTML_CLEARS = Object.freeze({});

const ROOT_NODE_SCRIPTS = new Set(['cdp.js', 'inject.js', 'remove.js']);

function isBrowserOnlyModule(rel) {
  if (!rel.includes('/') && rel.endsWith('.js') && !ROOT_NODE_SCRIPTS.has(rel)) return true;
  if (/^vendor\/.*(?:-client|-settings-ui)\.js$/.test(rel)) return true;
  if (/^vendor\/(?:host-i18n|clawd-mascot|periodic-picker)\/.*\.js$/.test(rel)) return true;
  if (rel === 'vendor/pulse-dashboard/inline-fallback.js') return true;
  return false;
}

const ALL_FILES = listRepoFiles();

test('Law 1: Zero external runtime node_modules dependencies, 0 static/Worker cycles, and strict L0->L4 DAG layering', () => {
  // 1) Zero runtime dependencies in package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0, 'package.json must declare 0 runtime dependencies');

  // 2) Build full static dependency graph (import / export-from / require / dynamic import / new Worker(new URL(...)))
  const codeFiles = ALL_FILES.filter((f) => /\.(?:mjs|cjs|js)$/.test(f) && !f.startsWith('test/'));
  const importRe =
    /(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+(?:[\s\S]*?\s+from\s+)?|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;
  const workerRe = /new\s+Worker\s*\(\s*new\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;

  const graph = new Map();
  const externalDeps = [];
  const layerViolations = [];

  for (const f of codeFiles) {
    const clean = stripJsComments(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const deps = new Set();
    const browserOnly = isBrowserOnlyModule(f);

    for (const m of clean.matchAll(importRe)) {
      const spec = m[1];
      if (spec.startsWith('.')) {
        const target = resolveLocalSpecifier(f, spec);
        if (target) {
          deps.add(target);
          if (browserOnly && target.startsWith('sidecars/')) {
            layerViolations.push(`${f} (browser) -> ${target} (sidecars/)`);
          }
          if (f.startsWith('sidecars/') && /^(?:scripts|workbench|installer)\//.test(target)) {
            layerViolations.push(`${f} (L3 sidecar) -> ${target} (L4)`);
          }
          if (f.startsWith('tools/') && target.startsWith('workbench/')) {
            layerViolations.push(`${f} (tools) -> ${target} (workbench)`);
          }
        }
      } else if (BUILTINS.has(spec)) {
        if (browserOnly) {
          layerViolations.push(`${f} (browser) imports Node builtin "${spec}"`);
        }
      } else if (spec.startsWith('/') && f.startsWith('workbench/')) {
        // Browser HTTP ESM route served by workbench/server.cjs (e.g. /shared/sidebar-state-machine.mjs)
      } else if (spec === 'electron' && f === 'tools/patch-asar.cjs') {
        // Legacy Electron host-internal snippet string inside tools/patch-asar.cjs --clean-legacy
      } else if (!spec.includes('${') && !spec.startsWith('http://') && !spec.startsWith('https://')) {
        // Guard against real third-party npm imports
        const barePkg = spec.split('/')[0];
        if (!BUILTINS.has(barePkg) && !spec.startsWith('file:')) {
          externalDeps.push(`${f} -> "${spec}"`);
        }
      }
    }

    for (const m of clean.matchAll(workerRe)) {
      const target = resolveLocalSpecifier(f, m[1]);
      if (target) deps.add(target);
    }

    graph.set(f, [...deps]);
  }

  assert.deepEqual(externalDeps, [], `Forbidden external runtime package imports detected:\n${externalDeps.join('\n')}`);
  assert.deepEqual(layerViolations, [], `L0->L4 layering violations detected:\n${layerViolations.join('\n')}`);

  // 3) Cycle detection via DFS (including Worker edges)
  const visited = new Set();
  const onStack = new Set();
  const stack = [];
  const cycles = [];

  function dfs(node) {
    visited.add(node);
    onStack.add(node);
    stack.push(node);
    for (const next of graph.get(node) || []) {
      if (!visited.has(next)) {
        dfs(next);
      } else if (onStack.has(next)) {
        cycles.push([...stack.slice(stack.indexOf(next)), next].join(' -> '));
      }
    }
    stack.pop();
    onStack.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) dfs(node);
  }
  assert.deepEqual(cycles, [], `Static/Worker circular dependencies detected:\n${cycles.join('\n')}`);
});

test('Law 2: Module size & monolith ratchet (new files <= 800 lines / 40 KB; legacy monoliths non-growing)', () => {
  const violations = [];
  for (const f of ALL_FILES) {
    if (!/\.(?:mjs|cjs|js|css|cs|swift)$/.test(f) || f.startsWith('test/')) continue;
    const buf = fs.readFileSync(path.join(ROOT, f));
    const lines = buf.toString('utf8').split(/\r?\n/).length;
    const bytes = buf.length;
    const baseline = LEGACY_SIZE_RATCHET[f];

    if (baseline) {
      if (lines > baseline.maxLines) {
        violations.push(`${f}: grew from ${baseline.maxLines} -> ${lines} lines (legacy monolith must not grow)`);
      }
      if (bytes > baseline.maxBytes + VERSION_LEN_SLACK_BYTES) {
        violations.push(`${f}: grew from ${baseline.maxBytes} -> ${bytes} bytes (legacy monolith must not grow)`);
      }
    } else {
      if (lines > NEW_FILE_MAX_LINES || bytes > NEW_FILE_MAX_BYTES) {
        violations.push(
          `${f}: ${lines} lines / ${bytes} B exceeds new-module cap (${NEW_FILE_MAX_LINES} lines / ${NEW_FILE_MAX_BYTES} B)`
        );
      }
    }
  }
  assert.deepEqual(violations, [], `File size ratchet violations:\n${violations.join('\n')}`);
});

test('Law 6a: style.css anti-rot gate (0 :has(, 100% ASCII, balanced delimiters, non-growing --_* / short CSS vars)', () => {
  const cssPath = path.join(ROOT, 'style.css');
  assertCssHygiene(cssPath);

  const cssText = fs.readFileSync(cssPath, 'utf8');
  const declaredVars = new Set([...cssText.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((m) => m[1]));
  const badNewVars = [];
  for (const v of declaredVars) {
    const isUnderscore = v.startsWith('--_');
    const isTooShort = v.length - 2 <= 4;
    if ((isUnderscore || isTooShort) && !LEGACY_SHORT_OR_UNDERSCORE_CSS_VARS.has(v)) {
      badNewVars.push(v);
    }
  }
  assert.deepEqual(
    badNewVars,
    [],
    `Forbidden new --_* or <=4-char CSS custom properties in style.css (use --ag-prism-*): ${badNewVars.join(', ')}`
  );
});

test('Law 6b: Runtime innerHTML / outerHTML / insertAdjacentHTML write ratchet permanently locked to 0', () => {
  const violations = [];
  let coreNonEmptyTotal = 0;

  for (const f of ALL_FILES) {
    if (!/\.(?:mjs|cjs|js)$/.test(f)) continue;
    if (f.startsWith('test/') || f.startsWith('workbench/')) continue;
    const clean = stripJsComments(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    let nonEmptyCount = 0;
    let emptyCount = 0;

    for (const line of clean.split(/\r?\n/)) {
      if (/\.\s*(?:innerHTML|outerHTML)\s*=\s*(?:''|"")\s*[;,]?/.test(line)) {
        emptyCount += 1;
      } else if (/\.\s*(?:innerHTML|outerHTML)\s*[+]?=(?!=)|\.\s*insertAdjacentHTML\s*\(/.test(line)) {
        nonEmptyCount += 1;
      }
    }

    const allowedNonEmpty = LEGACY_NON_EMPTY_HTML_WRITES[f] || 0;
    if (nonEmptyCount > allowedNonEmpty) {
      violations.push(`${f}: ${nonEmptyCount} non-empty innerHTML/outerHTML/insertAdjacentHTML write(s) (allowed <= ${allowedNonEmpty})`);
    }
    coreNonEmptyTotal += nonEmptyCount;

    const allowedEmpty = LEGACY_EMPTY_HTML_CLEARS[f] || 0;
    if (emptyCount > allowedEmpty) {
      violations.push(`${f}: ${emptyCount} empty innerHTML clear(s) (allowed <= ${allowedEmpty}; prefer replaceChildren())`);
    }
  }

  assert.equal(coreNonEmptyTotal, 0, `Runtime non-empty innerHTML writes must be 0 (got ${coreNonEmptyTotal})`);
  assert.deepEqual(violations, [], `Runtime HTML-sink ratchet violations:\n${violations.join('\n')}`);
});
