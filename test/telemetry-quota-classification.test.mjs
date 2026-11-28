import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const usageCore = require(path.join(ROOT, 'usage-core.js'));
const inlineMod = require(path.join(ROOT, 'vendor', 'pulse-dashboard', 'inline-fallback.js'));

const UNIFIED_GEMINI_POOL = {
  id: 'gemini',
  name: 'Gemini Models',
  description:
    'Models within this group: Gemini 4 Neon, Gemini 4 Carbon, Gemini 4 Argon, Gemini 4 Hydrogen, Orchestrator (Neon), Orchestrator (Carbon), Orchestrator (Argon), Gemini 3.8 Flash',
  windows: {
    '5h': { available: true, id: 'gemini-5h', remaining: 0.78, resetAt: '2026-11-28T18:00:00.000Z' },
    weekly: { available: true, id: 'gemini-weekly', remaining: 0.64, resetAt: '2026-12-03T00:00:00.000Z' },
  },
};

const DEDICATED_ARGON_POOL = {
  id: 'gemini-argon-wtu',
  name: 'Gemini (Argon)',
  description: 'Models within this group: Gemini 4 Argon',
  windows: {
    '5h': { available: false },
    weekly: { available: true, id: 'gemini-argon-wtu-weekly', remaining: 0.35, resetAt: '2026-12-03T00:00:00.000Z' },
  },
};

const CLAUDE_POOL = {
  id: 'claude',
  name: 'Claude / GPT',
  description: 'Models within this group: Claude Opus 4.6, Claude Sonnet 4.6, GPT-OSS',
  windows: {
    '5h': { available: true, id: 'claude-5h', remaining: 0.91, resetAt: '2026-11-28T18:00:00.000Z' },
    weekly: { available: true, id: 'claude-weekly', remaining: 0.88, resetAt: '2026-12-03T00:00:00.000Z' },
  },
};

test('quotaGroupKind & qKind classify Antigravity v2.35.2 unified Gemini Models pool as gemini despite Argon in description', () => {
  assert.equal(usageCore.quotaGroupKind(UNIFIED_GEMINI_POOL), 'gemini');
  assert.equal(usageCore.quotaGroupLabel(UNIFIED_GEMINI_POOL, 'en'), 'Gemini');
  assert.equal(usageCore.quotaGroupLabel(UNIFIED_GEMINI_POOL, 'zh-CN'), 'Gemini');
  assert.equal(inlineMod.qKind(UNIFIED_GEMINI_POOL), 'gemini');

  // Split Gemini Pro / Gemini Flash pools whose descriptions mention Argon remain gemini
  const geminiPro = {
    id: 'gemini-pro',
    name: 'Gemini Pro',
    description: 'Models within this group: Gemini 4 Carbon, Gemini 4 Argon',
    windows: { '5h': { available: true, id: 'gemini-pro-5h', remaining: 0.5 } },
  };
  const geminiFlash = {
    groupId: 'gemini-flash',
    label: 'Gemini Flash',
    description: 'Models within this group: Gemini 3.8 Flash',
    fiveHour: { available: true, id: 'gemini-flash-5h', remaining: 0.9 },
  };
  assert.equal(usageCore.quotaGroupKind(geminiPro), 'gemini');
  assert.equal(usageCore.quotaGroupLabel(geminiPro, 'en'), 'Gemini');
  assert.equal(inlineMod.qKind(geminiPro), 'gemini');
  assert.equal(usageCore.quotaGroupKind(geminiFlash), 'gemini');
  assert.equal(inlineMod.qKind(geminiFlash), 'gemini');
});

test('quotaGroupKind & qKind preserve dedicated Argon/WTU and Claude pools across id/groupId/name/label/window.id variants', () => {
  assert.equal(usageCore.quotaGroupKind(DEDICATED_ARGON_POOL), 'gemini-argon');
  assert.equal(usageCore.quotaGroupLabel(DEDICATED_ARGON_POOL, 'en'), 'Gemini (Argon)');
  assert.equal(inlineMod.qKind(DEDICATED_ARGON_POOL), 'argon');

  assert.equal(usageCore.quotaGroupKind(CLAUDE_POOL), 'claude');
  assert.equal(usageCore.quotaGroupLabel(CLAUDE_POOL, 'en'), 'Claude / GPT');
  assert.equal(inlineMod.qKind(CLAUDE_POOL), 'claude');

  // Explicit identification via groupId / label / displayName / fiveHour.id / weekly.id
  const argonByWindow = {
    id: 'group-2',
    name: 'Quota Group 3',
    windows: { weekly: { available: true, id: 'gemini-argon-wtu-weekly', remaining: 0.4 } },
  };
  const argonByLabel = {
    groupId: 'pool-a',
    label: 'Gemini (Argon)',
    fiveHour: { available: true, id: 'pool-a-5h', remaining: 0.6 },
  };
  const claudeByDisplayName = {
    id: 'pool-b',
    displayName: 'Anthropic Claude',
  };
  assert.equal(usageCore.quotaGroupKind(argonByWindow), 'gemini-argon');
  assert.equal(inlineMod.qKind(argonByWindow), 'argon');
  assert.equal(usageCore.quotaGroupKind(argonByLabel), 'gemini-argon');
  assert.equal(inlineMod.qKind(argonByLabel), 'argon');
  assert.equal(usageCore.quotaGroupKind(claudeByDisplayName), 'claude');
  assert.equal(inlineMod.qKind(claudeByDisplayName), 'claude');
});

test('quotaGroupKind & qKind fall back to description only when explicit identifiers are missing or generic', () => {
  // Generic group with unified Gemini+Argon roster in description resolves to gemini (not gemini-argon)
  const genericUnified = {
    id: 'group-0',
    name: 'Quota Group 1',
    description: 'Models within this group: Gemini 4 Carbon, Gemini 4 Argon, Gemini 3.8 Flash',
  };
  assert.equal(usageCore.quotaGroupKind(genericUnified), 'gemini');
  assert.equal(usageCore.quotaGroupLabel(genericUnified, 'en'), 'Gemini');
  assert.equal(inlineMod.qKind(genericUnified), 'gemini');

  // Generic 3P pool identified only through description resolves to claude
  const generic3p = {
    id: '3p',
    name: 'Third-party Models',
    description: 'Models within this group: Claude Sonnet 4.6, GPT-5.2',
  };
  assert.equal(usageCore.quotaGroupKind(generic3p), 'claude');
  assert.equal(inlineMod.qKind(generic3p), 'claude');

  // Generic pool with Argon-only WTU description still resolves to gemini-argon / argon
  const genericArgonOnly = {
    id: 'group-9',
    name: 'Special Pool',
    description: 'Weekly WTU allowance for Argon preview',
  };
  assert.equal(usageCore.quotaGroupKind(genericArgonOnly), 'gemini-argon');
  assert.equal(inlineMod.qKind(genericArgonOnly), 'argon');

  // Empty / non-object inputs stay safe and return other
  assert.equal(usageCore.quotaGroupKind(null), 'other');
  assert.equal(usageCore.quotaGroupKind({ id: 'custom-pool', name: 'Custom Pool' }), 'other');
  assert.equal(inlineMod.qKind(null), 'other');
  assert.equal(inlineMod.qKind({ id: 'custom-pool', name: 'Custom Pool' }), 'other');
});

test('chooseQuotaGroup & chooseQuotaGroupFallback select unified Gemini or dedicated Argon pool accurately', () => {
  // 1) Unified Gemini Models + Claude (Antigravity v2.35.2 layout)
  const unifiedGroups = [CLAUDE_POOL, UNIFIED_GEMINI_POOL];
  assert.equal(usageCore.chooseQuotaGroup(unifiedGroups, 'Gemini 4 Carbon (High)')?.id, 'gemini');
  assert.equal(usageCore.chooseQuotaGroup(unifiedGroups, 'Gemini 4 Argon (High)')?.id, 'gemini');
  assert.equal(usageCore.chooseQuotaGroup(unifiedGroups, 'Claude Opus 4.6')?.id, 'claude');
  assert.equal(inlineMod.chooseQuotaGroupFallback(unifiedGroups, 'Gemini 4 Carbon (High)')?.id, 'gemini');
  assert.equal(inlineMod.chooseQuotaGroupFallback(unifiedGroups, 'Gemini 4 Argon (High)')?.id, 'gemini');
  assert.equal(inlineMod.chooseQuotaGroupFallback(unifiedGroups, 'Claude Opus 4.6')?.id, 'claude');

  // 2) Legacy split layout: dedicated Argon + unified/standard Gemini (even if Gemini description mentions Argon) + Claude
  const splitGroups = [DEDICATED_ARGON_POOL, UNIFIED_GEMINI_POOL, CLAUDE_POOL];
  assert.equal(usageCore.chooseQuotaGroup(splitGroups, 'Gemini 4 Carbon (High)')?.id, 'gemini');
  assert.equal(usageCore.chooseQuotaGroup(splitGroups, 'Gemini 4 Argon (High)')?.id, 'gemini-argon-wtu');
  assert.equal(usageCore.chooseQuotaGroup(splitGroups, 'Claude Sonnet 4.6')?.id, 'claude');
  assert.equal(inlineMod.chooseQuotaGroupFallback(splitGroups, 'Gemini 4 Carbon (High)')?.id, 'gemini');
  assert.equal(inlineMod.chooseQuotaGroupFallback(splitGroups, 'Gemini 4 Argon (High)')?.id, 'gemini-argon-wtu');
  assert.equal(inlineMod.chooseQuotaGroupFallback(splitGroups, 'Claude Sonnet 4.6')?.id, 'claude');
});

test('inline-fallback preserves Wave P3-D delta cache markers alongside quota classification fix', () => {
  const src = fs.readFileSync(path.join(ROOT, 'vendor', 'pulse-dashboard', 'inline-fallback.js'), 'utf8');
  assert.ok(src.includes('__agPrismMetricsLast'), 'Wave P3-D __agPrismMetricsLast delta cache must remain intact');
  assert.ok(src.includes('unchanged'), 'Wave P3-D unchanged short-circuit must remain intact');
  assert.equal(/\.\s*innerHTML\s*=/.test(src), false, 'inline-fallback.js must keep 0 innerHTML writes');
  assert.equal(/:has\(/.test(src), false, 'inline-fallback.js must keep 0 :has() selectors');
});
