// R2 收口 P0 Bug A（元素周期表 v2.35.2 运行态不误锁 + 漂移阈值 12px）与 P0 Bug B（.gemini 精准放行 + 敏感行内提示）回归单测
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

import {
  isSensitiveInlineDiffPath,
  resolveInlineDiffCandidatePath,
} from '../src/daemon/inline-diff-filter.mjs';
import { readSafeInlineDiff } from '../sidecars/daemon/main.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const hostBridge = require(path.join(ROOT, 'vendor', 'periodic-picker', 'host-bridge.js'));
const inlineDiffClientMod = require(path.join(ROOT, 'vendor', 'inline-diff', 'inline-diff-client.js'));

function makeMockBox({ ariaLabel = '', disabled = false, attrs = {}, className = '', withCancelBtn = true, cancelHidden = false } = {}) {
  const attrMap = new Map(Object.entries(attrs));
  if (ariaLabel) attrMap.set('aria-label', ariaLabel);
  const cancelBtn = withCancelBtn
    ? {
        hidden: cancelHidden,
        style: { display: cancelHidden ? 'none' : '' },
        getAttribute: (k) => (k === 'data-testid' ? 'input-cancel-button' : null),
      }
    : null;
  const inputBox = {
    getAttribute: (k) => (k === 'data-testid' ? 'agent-input-box' : null),
    querySelector: (sel) => (sel === '[data-testid="input-cancel-button"]' ? cancelBtn : null),
    closest: () => null,
  };
  const triggerBtn = {
    disabled,
    className,
    hasAttribute: (k) => (k === 'disabled' ? disabled || attrMap.has('disabled') : attrMap.has(k)),
    getAttribute: (k) => (attrMap.has(k) ? attrMap.get(k) : null),
    closest: (sel) => (sel === '[data-testid="agent-input-box"]' ? inputBox : null),
  };
  const doc = {
    activeElement: null,
    querySelectorAll: () => [inputBox],
    querySelector: () => triggerBtn,
  };
  return { doc, inputBox, triggerBtn };
}

test('P0 Bug A: v2.35.2 running trigger with /btw or next-turn aria-label is NOT falsely locked, while true disabled signals & v2.35.1 cancel-only state stay locked', () => {
  // 1) v2.35.2 运行态：同卡片存在可见 input-cancel-button，但按钮未禁用且 aria-label 提示 Applies to /btw / next turn -> 解锁 (false)
  const v2352Labels = [
    'Gemini 4 Carbon (High) — Applies to /btw and messages sent after this turn',
    'Claude Opus 4.6 (Applies to   /btw)',
    'Gemini 4 Neon, messages sent after this turn',
    'Gemini 4 Carbon（应用于 /btw 与后续消息）',
    'Gemini 4 Carbon · 下一轮消息生效',
  ];
  for (const label of v2352Labels) {
    const { doc, triggerBtn } = makeMockBox({ ariaLabel: label, withCancelBtn: true });
    assert.equal(
      hostBridge.isModelTriggerLocked(triggerBtn, doc),
      false,
      `v2.35.2 running unlocked trigger must NOT be locked: ${label}`
    );
  }

  // 2) 即使 aria-label 含 Applies to /btw，只要按钮自身带任何真禁用信号，仍必须严格返回 true
  const trueDisabledCases = [
    { name: 'btn.disabled=true', opts: { ariaLabel: 'Applies to /btw', disabled: true } },
    { name: 'disabled attr', opts: { ariaLabel: 'Applies to /btw', attrs: { disabled: '' } } },
    { name: 'aria-disabled=true', opts: { ariaLabel: 'Applies to /btw', attrs: { 'aria-disabled': 'true' } } },
    { name: 'data-disabled=""', opts: { ariaLabel: 'Applies to /btw', attrs: { 'data-disabled': '' } } },
    { name: 'data-disabled="true"', opts: { ariaLabel: 'Applies to /btw', attrs: { 'data-disabled': 'true' } } },
    { name: 'cursor-not-allowed class', opts: { ariaLabel: 'Applies to /btw', className: 'btn cursor-not-allowed opacity-50' } },
    { name: 'cannot be changed while running', opts: { ariaLabel: 'Model cannot be changed while agent is running' } },
    { name: '运行中无法切换', opts: { ariaLabel: '运行中暂无法切换模型' } },
  ];
  for (const tc of trueDisabledCases) {
    const { doc, triggerBtn } = makeMockBox({ ...tc.opts, withCancelBtn: true });
    assert.equal(
      hostBridge.isModelTriggerLocked(triggerBtn, doc),
      true,
      `True disabled signal must still lock trigger (${tc.name})`
    );
  }

  // 3) 老版本 v2.35.1：无解锁 aria-label 且存在可见 input-cancel-button -> 仍锁定 (true)；隐藏 cancel 按钮 -> 解锁 (false)
  {
    const { doc, triggerBtn } = makeMockBox({ ariaLabel: 'Gemini 4 Carbon (High)', withCancelBtn: true, cancelHidden: false });
    assert.equal(hostBridge.isModelTriggerLocked(triggerBtn, doc), true, 'Legacy v2.35.1 visible cancel button without /btw hint must stay locked');
  }
  {
    const { doc, triggerBtn } = makeMockBox({ ariaLabel: 'Gemini 4 Carbon (High)', withCancelBtn: true, cancelHidden: true });
    assert.equal(hostBridge.isModelTriggerLocked(triggerBtn, doc), false, 'Hidden cancel button must not lock trigger');
  }

  // 4) HOLD_MAX_DRIFT_PX 放宽至 12px，减少高 DPI 触控板/鼠标 420ms 长按抖动误取消
  const pickerSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'periodic-picker', 'periodic-picker.js'), 'utf8');
  assert.ok(/\bHOLD_MAX_DRIFT_PX\s*=\s*12\b/.test(pickerSrc), 'HOLD_MAX_DRIFT_PX must be tuned to 12');
});

test('P0 Bug B (Filter & RPC): .gemini code/doc subtrees are allowed while all credential/config/db/transcript/conversation paths remain 100% blocked_sensitive', async () => {
  // 1) 精准放行的 .gemini 普通代码与文档路径
  const allowedPaths = [
    'C:\\Users\\Administrator\\.gemini\\config\\skills\\t3code-dispatcher\\SKILL.md',
    'C:\\Users\\Administrator\\.gemini\\config\\rules\\AGENTS.md',
    'C:\\Users\\Administrator\\.gemini\\config\\plugins\\obsidian-prism\\ui-runtime.js',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\worktrees\\obsidian-prism\\feat\\src\\app.js',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\brain\\46c42ea7\\plan.md',
    '/home/alice/.gemini/config/skills/demo/SKILL.md',
    '/home/alice/.gemini/antigravity/brain/conv-1/report.md',
  ];
  for (const p of allowedPaths) {
    assert.equal(isSensitiveInlineDiffPath(p), false, `Expected .gemini code/doc path allowed: ${p}`);
  }

  // 2) 依然 100% 拦截的敏感路径（返回 blocked_sensitive）
  const blockedPaths = [
    'C:\\Users\\Administrator\\.gemini\\config.json',
    'C:\\Users\\Administrator\\.gemini\\oauth_creds.json',
    'C:\\Users\\Administrator\\.gemini\\google_accounts.json',
    'C:\\Users\\Administrator\\.gemini\\config\\obsidian-prism-thought.json',
    'C:\\Users\\Administrator\\.gemini\\config\\obsidian-prism-thought.json.tmp',
    'C:\\Users\\Administrator\\.gemini\\config\\obsidian-prism-suggester.json',
    'C:\\Users\\Administrator\\.gemini\\config\\obsidian-prism-wallpaper.json',
    'C:\\Users\\Administrator\\.gemini\\config\\plugins\\obsidian-prism\\config.json',
    'C:\\Users\\Administrator\\.gemini\\config\\plugins\\obsidian-prism\\daemon.log',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\brain\\conv-1\\transcript.jsonl',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\brain\\conv-1\\.system_generated\\logs\\transcript_full.jsonl',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations\\1234.db',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\conversations\\1234.pb',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\sidecar_data\\obsidian-prism\\state.json',
    'C:\\Users\\Administrator\\.gemini\\config\\skills\\demo\\.env',
    'C:\\Users\\Administrator\\.gemini\\config\\skills\\demo\\.env.local',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\worktrees\\proj\\state.vscdb',
    'C:\\Users\\Administrator\\.gemini\\antigravity\\worktrees\\proj\\local.db',
    'C:\\Users\\Administrator\\.gemini\\config\\skills\\demo\\.gemini\\secret.txt',
    '/home/alice/.gemini/config.json',
    '/home/alice/.gemini/antigravity/conversations/a.pb',
    '/repo/oauth_creds.json',
    '/repo/google_accounts.json',
    '/repo/obsidian-prism-suggester.json',
    '/repo/obsidian-prism-wallpaper.json',
    '/repo/daemon.log',
  ];
  for (const p of blockedPaths) {
    assert.equal(isSensitiveInlineDiffPath(p), true, `Expected sensitive path blocked: ${p}`);
    if (process.platform === 'win32' ? /^[A-Za-z]:\\/.test(p) : p.startsWith('/')) {
      const resolved = resolveInlineDiffCandidatePath(p);
      assert.equal(resolved.ok, false);
      assert.equal(resolved.error, 'blocked_sensitive', `Expected blocked_sensitive from resolveInlineDiffCandidatePath for ${p}`);
    }
  }

  // 3) 真实磁盘 Git 仓库模拟 .gemini/config/skills/t3code-dispatcher/SKILL.md 可成功返回 git-diff，而同仓 config.json 仍 blocked_sensitive
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-gemini-diff-'));
  try {
    const skillRepo = path.join(tmpDir, '.gemini', 'config', 'skills', 't3code-dispatcher');
    fs.mkdirSync(skillRepo, { recursive: true });
    const gitEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'Prism Test',
      GIT_AUTHOR_EMAIL: 'prism-test@example.invalid',
      GIT_COMMITTER_NAME: 'Prism Test',
      GIT_COMMITTER_EMAIL: 'prism-test@example.invalid',
    };
    const runGit = (args) => execFileSync('git', ['-C', skillRepo, ...args], { encoding: 'utf8', windowsHide: true, env: gitEnv });
    runGit(['init']);
    runGit(['config', 'user.name', 'Prism Test']);
    runGit(['config', 'user.email', 'prism-test@example.invalid']);
    runGit(['config', 'core.autocrlf', 'false']);

    const skillMd = path.join(skillRepo, 'SKILL.md');
    const secretCfg = path.join(skillRepo, 'config.json');
    fs.writeFileSync(skillMd, '# T3 Dispatcher\nline-a\n', 'utf8');
    fs.writeFileSync(secretCfg, '{"secret":"x"}\n', 'utf8');
    runGit(['add', '.']);
    runGit(['commit', '-m', 'init']);
    fs.writeFileSync(skillMd, '# T3 Dispatcher\nline-b\n', 'utf8');

    const okRes = await readSafeInlineDiff(pathToFileURL(skillMd).href);
    assert.equal(okRes.ok, true, `Expected .gemini/config/skills/.../SKILL.md git-diff allowed, got ${JSON.stringify(okRes)}`);
    assert.equal(okRes.mode, 'git-diff');
    assert.ok(okRes.lines.some((l) => l.kind === 'add' && l.text === 'line-b'));

    const blkRes = await readSafeInlineDiff(pathToFileURL(secretCfg).href);
    assert.equal(blkRes.ok, false);
    assert.equal(blkRes.error, 'blocked_sensitive');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('P0 Bug B (Client UI): inline-diff-client renders explicit 8-locale privacy hint on blocked_sensitive with 0 CJK leaks in non-CJK locales & 0 innerHTML', async () => {
  const clientSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'inline-diff', 'inline-diff-client.js'), 'utf8');
  assert.equal(clientSrc.includes('innerHTML'), false, 'inline-diff-client.js must contain 0 innerHTML');

  // Verify 8-locale completeness & 0 CJK in non-CJK locales for inlineDiffSensitive
  const m = /inlineDiffSensitive\s*:\s*\{([\s\S]*?)\},/.exec(clientSrc);
  assert.ok(m, 'inlineDiffSensitive must be declared in DIFF_FALLBACK');
  const block = m[1];
  const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;
  for (const loc of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de']) {
    const lm = new RegExp(`['"]?${loc}['"]?\\s*:\\s*'([^']+)'`).exec(block);
    assert.ok(lm && lm[1].length > 8, `inlineDiffSensitive[${loc}] missing or empty`);
    if (['en', 'ko', 'es', 'fr', 'de'].includes(loc)) {
      assert.equal(CJK_RE.test(lm[1]), false, `inlineDiffSensitive[${loc}] must contain 0 CJK chars: ${lm[1]}`);
    }
  }

  // Runtime DOM test: blocked_sensitive RPC response renders explicit Chinese privacy notice instead of generic noPreview
  const makeNode = (tag, attrs = {}) => {
    const am = new Map(Object.entries(attrs));
    const kids = [];
    const cls = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
    const n = {
      nodeType: 1, tagName: tag.toUpperCase(), children: kids, childNodes: kids,
      parentNode: null, parentElement: null, isConnected: true, _txt: '',
      style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
      get className() { return [...cls].join(' '); },
      set className(v) { cls.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); },
      classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c) },
      get firstChild() { return kids[0] || null; },
      get textContent() { return kids.length && !n._txt ? kids.map((c) => c.textContent).join('') : n._txt; },
      set textContent(v) { kids.length = 0; n._txt = String(v ?? ''); },
      setAttribute(k, v) { am.set(k, String(v)); if (k === 'class') n.className = v; },
      getAttribute(k) { return am.has(k) ? am.get(k) : null; },
      hasAttribute(k) { return am.has(k); },
      removeAttribute(k) { am.delete(k); },
      appendChild(c) { c.parentNode = c.parentElement = n; kids.push(c); return c; },
      insertBefore(c, ref) { c.parentNode = c.parentElement = n; const i = ref ? kids.indexOf(ref) : -1; if (i >= 0) kids.splice(i, 0, c); else kids.push(c); return c; },
      removeChild(c) { const i = kids.indexOf(c); if (i >= 0) kids.splice(i, 1); c.parentNode = c.parentElement = null; return c; },
      remove() { n.parentNode?.removeChild(n); },
      addEventListener() {}, removeEventListener() {},
      get nextElementSibling() { if (!n.parentNode) return null; const i = n.parentNode.children.indexOf(n); return i >= 0 ? n.parentNode.children[i + 1] || null : null; },
      matches(sel) {
        return String(sel || '').split(',').map((p) => p.trim()).some((part) => {
          if (!part) return false;
          if (part.startsWith('.')) return cls.has(part.slice(1));
          if (part.startsWith('#')) return am.get('id') === part.slice(1);
          const amatch = /^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/.exec(part);
          if (amatch) return amatch[2] === undefined ? am.has(amatch[1]) : am.get(amatch[1]) === amatch[2];
          return n.tagName === part.toUpperCase();
        });
      },
      closest(s) { let p = n; while (p) { if (p.matches?.(s)) return p; p = p.parentElement; } return null; },
      querySelector(s) { return n.querySelectorAll(s)[0] || null; },
      querySelectorAll(s) {
        const out = [];
        const walk = (x) => { for (const k of x.children) { if (k.matches?.(s)) out.push(k); walk(k); } };
        walk(n);
        return out;
      },
    };
    return n;
  };
  const html = makeNode('html', { 'data-ag-cs-lang': 'zh-CN' });
  const head = makeNode('head');
  const body = makeNode('body');
  html.appendChild(head);
  html.appendChild(body);
  const doc = {
    documentElement: html, head, body, readyState: 'complete',
    createElement: (t) => makeNode(t),
    getElementById: (id) => html.querySelector(`#${id}`),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener() {}, removeEventListener() {},
  };
  const win = {
    document: doc,
    getComputedStyle: (el) => ({ display: 'flex', flexDirection: el?.className?.includes('flex-col') ? 'column' : 'row' }),
    addEventListener() {}, removeEventListener() {},
    __agPrismInlineDiffCall(rawPayload) {
      const req = JSON.parse(rawPayload);
      queueMicrotask(() => win.__agPrismInlineDiffResolve?.(req.id, { ok: false, error: 'blocked_sensitive' }));
    },
  };

  const client = inlineDiffClientMod.createInlineDiffClient({ win, doc, getLang: () => 'zh-CN' });
  const col = makeNode('div', { class: 'flex flex-col' });
  const row = makeNode('div', {
    class: 'group flex w-full',
    'data-testid': 'tool-call-row',
    'data-ag-diff-uri': 'file:///C:/Users/Administrator/.gemini/config.json',
  });
  const badge = makeNode('span', { 'data-testid': 'diff-line-count' });
  badge.textContent = '+1 -0';
  row.appendChild(badge);
  col.appendChild(row);
  body.appendChild(col);

  assert.equal(client.toggleInlineDiffPreview(badge, { noAnim: true }), true);
  await new Promise((r) => setTimeout(r, 20));
  const emptyMsg = col.querySelector('.ag-cs-inline-diff-empty');
  assert.ok(emptyMsg, 'Expected .ag-cs-inline-diff-empty notice');
  assert.equal(
    emptyMsg.textContent,
    '该文件受隐私安全规则保护，已跳过行内预览（可右键在侧栏查看）',
    'blocked_sensitive must render explicit privacy-protection message'
  );
  client.destroy();
});
