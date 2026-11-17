import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const crystalCore = require('../crystal-prism-core.js');

test('crystal-prism-core computeProximityFactor enforces small 105px reaction radius and smooth falloff', () => {
  assert.equal(crystalCore.PROXIMITY_RADIUS_PX, 105);
  assert.ok(crystalCore.PROXIMITY_RADIUS_PX < 220, 'Crystal prism radius must be much smaller than input box 220px');

  const w = 248;
  const h = 28;

  // Inside the capsule -> 1.0
  assert.equal(crystalCore.computeProximityFactor(124, 14, w, h), 1);

  // Far away -> 0.0
  assert.equal(crystalCore.computeProximityFactor(124, 300, w, h), 0);
  assert.equal(crystalCore.computeProximityFactor(-9999, -9999, w, h), 0);

  // Mid-range 60px outside top edge (< 105px) -> strictly in (0, 1) and monotonic
  const f60 = crystalCore.computeProximityFactor(124, -60, w, h);
  const f30 = crystalCore.computeProximityFactor(124, -30, w, h);
  assert.ok(f60 > 0 && f60 < 1, `Expected 60px distance proximity in (0,1), got ${f60}`);
  assert.ok(f30 > f60 && f30 < 1, `Expected 30px proximity (${f30}) > 60px (${f60})`);
});

test('crystal-prism-core evaluateDeterministicGlints emits sparse stochastic sparkles and respects reduceMotion', () => {
  const reduced = crystalCore.evaluateDeterministicGlints(12.34, true);
  const reducedLater = crystalCore.evaluateDeterministicGlints(45.67, true);
  assert.deepEqual(reduced, reducedLater, 'reduceMotion glints must stay static over time');

  let activeSlotsPeak = 0;
  for (let i = 0; i < 60; i++) {
    const glints = crystalCore.evaluateDeterministicGlints(i * 0.25, false);
    assert.equal(glints.length, 4);
    const activeCount = glints.filter((g) => g.intensity > 0.15).length;
    if (activeCount > activeSlotsPeak) activeSlotsPeak = activeCount;
    assert.ok(activeCount <= 3, `Glints should stay sparse, not uniform sweep (${activeCount} active at step ${i})`);
  }
  assert.ok(activeSlotsPeak >= 1, 'Expected at least 1 pinpoint crystal glint over 15s window');
});
