import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const usageCore = require('../usage-core.js');

test('formatCompactTokens matches expected units and rounding', () => {
  assert.equal(usageCore.formatCompactTokens(0), '0');
  assert.equal(usageCore.formatCompactTokens(949), '949');
  assert.equal(usageCore.formatCompactTokens(1540), '1.5k');
  assert.equal(usageCore.formatCompactTokens(999990), '1M');
  assert.equal(usageCore.formatCompactTokens(647800000), '647.8M');
  assert.equal(usageCore.formatCompactTokens(2500000000), '2.5B');
});

test('formatHomeHour formats AM/PM in zh and en', () => {
  assert.equal(usageCore.formatHomeHour(0, true), '上午 12 点');
  assert.equal(usageCore.formatHomeHour(12, true), '下午 12 点');
  assert.equal(usageCore.formatHomeHour(15, true), '下午 3 点');
  assert.equal(usageCore.formatHomeHour(0, false), '12 AM');
  assert.equal(usageCore.formatHomeHour(14, false), '2 PM');
});

test('analyzeTrajectoryForUsage extracts calls, days, hours, models, and retryInfos fallback', () => {
  const t0 = Math.floor(new Date(2026, 10, 10, 14, 15, 0).getTime() / 1000);
  const t1 = Math.floor(new Date(2026, 10, 11, 9, 30, 0).getTime() / 1000);
  const traj = {
    trajectory: {
      steps: [
        { metadata: { createdAt: { seconds: String(t0), nanos: 0 } } },
        { metadata: { createdAt: { seconds: String(t1), nanos: 0 } } },
      ],
      generatorMetadata: [
        {
          stepIndices: [0],
          metadata: {
            value: {
              modelDisplayName: 'Gemini 4 Argon (High)',
              usage: { inputTokens: '1000', cacheReadTokens: '4000', outputTokens: '500' },
            },
          },
        },
        {
          stepIndices: [1],
          metadata: {
            value: {
              responseModel: 'claude-opus-5.5',
              retryInfos: [
                { usage: { inputTokens: '100', outputTokens: '10' } },
                { usage: { inputTokens: '2000', cacheReadTokens: '8000', cacheWriteTokens: '500', outputTokens: '1000' } },
              ],
            },
          },
        },
      ],
    },
  };
  const rec = usageCore.analyzeTrajectoryForUsage(traj, { stepCount: 2, lastModifiedTime: { seconds: String(t1) } }, 'c1');
  assert.equal(rec.cascadeId, 'c1');
  assert.equal(rec.subagent, false);
  assert.equal(rec.calls, 2);
  assert.equal(rec.days['2026-11-10'].total, 5500);
  assert.equal(rec.days['2026-11-10'].hours[14], 1);
  assert.equal(rec.days['2026-11-11'].total, 11500);
  assert.equal(rec.days['2026-11-11'].hours[9], 1);
  assert.equal(rec.days['2026-11-11'].models['claude-opus-5.5'].total, 11500);
});

test('aggregateUsageRollup excludes subagents from sessions, filters ranges, and picks book yardstick', () => {
  const now = new Date(2026, 10, 14, 12, 0, 0);
  const dToday = usageCore.homeDayKey(now);
  const d10 = usageCore.homeDayKey(new Date(2026, 10, 4, 12, 0, 0));
  const d45 = usageCore.homeDayKey(new Date(2026, 8, 25, 12, 0, 0));

  const records = [
    {
      cascadeId: 'main-1',
      subagent: false,
      days: {
        [dToday]: {
          calls: 3,
          input: 10000,
          output: 2000,
          cacheRead: 30000,
          cacheWrite: 0,
          total: 42000,
          hours: (() => { const a = new Array(24).fill(0); a[15] = 3; return a; })(),
          models: { 'Gemini 4 Argon': { input: 10000, output: 2000, cacheRead: 30000, cacheWrite: 0, total: 42000, calls: 3 } },
        },
        [d45]: {
          calls: 1,
          input: 5000,
          output: 1000,
          cacheRead: 0,
          cacheWrite: 0,
          total: 6000,
          hours: (() => { const a = new Array(24).fill(0); a[8] = 1; return a; })(),
          models: { 'Claude Opus': { input: 5000, output: 1000, cacheRead: 0, cacheWrite: 0, total: 6000, calls: 1 } },
        },
      },
    },
    {
      cascadeId: 'sub-1',
      subagent: true,
      days: {
        [d10]: {
          calls: 2,
          input: 8000,
          output: 2000,
          cacheRead: 0,
          cacheWrite: 0,
          total: 10000,
          hours: (() => { const a = new Array(24).fill(0); a[15] = 2; return a; })(),
          models: { 'Gemini 4 Argon': { input: 8000, output: 2000, cacheRead: 0, cacheWrite: 0, total: 10000, calls: 2 } },
        },
      },
    },
  ];

  const all = usageCore.aggregateUsageRollup(records, 'all', 0.0, true, now);
  assert.equal(all.sessions, 1); // sub-1 excluded!
  assert.equal(all.calls, 6);
  assert.equal(all.tokens, 58000);
  assert.equal(all.activeDays, 3);
  assert.equal(all.peakHour, '下午 3 点');
  assert.equal(all.model, 'Gemini 4 Argon');
  assert.match(all.funBook, /《道德经》/);

  const seven = usageCore.aggregateUsageRollup(records, '7d', 0.0, true, now);
  assert.equal(seven.sessions, 1);
  assert.equal(seven.calls, 3);
  assert.equal(seven.tokens, 42000);
  assert.equal(seven.activeDays, 1);

  const thirty = usageCore.aggregateUsageRollup(records, '30d', 0.0, false, now);
  assert.equal(thirty.tokens, 52000);
  assert.equal(thirty.activeDays, 2);
});

test('homeHeatGrid produces Sunday-aligned 26+ week cells with levels 0..5', () => {
  const now = new Date(2026, 10, 14, 12, 0, 0); // Saturday
  const dToday = usageCore.homeDayKey(now);
  const dPrev = usageCore.homeDayKey(new Date(2026, 10, 13, 12, 0, 0));
  const grid = usageCore.homeHeatGrid({ [dToday]: 10000, [dPrev]: 1500 }, now);
  assert.ok(grid.cells.length >= 26 * 7);
  assert.equal(grid.cells[0].date.length, 10);
  const last = grid.cells[grid.cells.length - 1];
  assert.equal(last.date, dToday);
  assert.equal(last.level, 5);
  const prevCell = grid.cells.find((c) => c.date === dPrev);
  assert.equal(prevCell.level, 1);
});

test('homeChartTicks never produce overlapping labels', () => {
  const widths = new Array(30).fill(42);
  const ticks = usageCore.homeChartTicks(widths, 420, 8, 2);
  assert.ok(ticks.length >= 1);
  assert.equal(ticks[ticks.length - 1].index, 29);
  for (let i = 1; i < ticks.length; i++) {
    assert.ok(ticks[i - 1].left + widths[ticks[i - 1].index] + 8 <= ticks[i].left);
  }
});

