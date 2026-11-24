import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cdp = require('../cdp.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('step-plan checklist card and all item states share Obsidian Prism jewel styling across light and dark themes', () => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const lightBlockIdx = css.indexOf('html[data-ag-cs-style][data-ag-cs-theme="light"]');
  assert.ok(lightBlockIdx > 0, 'style.css must contain light-theme override block');

  const baseSection = css.slice(0, lightBlockIdx);
  const lightSection = css.slice(lightBlockIdx);

  // Base surface + chip + all 5 item states (in_progress paused svg, done, pending, failed, skipped)
  assert.ok(baseSection.includes('html[data-ag-cs-style] [data-testid="step-plan"]{'), 'must style step-plan card');
  assert.ok(baseSection.includes('html[data-ag-cs-style] [data-testid="step-plan-item"]{'), 'must style step-plan-item');
  assert.ok(baseSection.includes('html[data-ag-cs-style] [data-testid="step-plan-chip"]{'), 'must style step-plan-chip');
  assert.ok(baseSection.includes('&[data-status="in_progress"]{') && baseSection.includes('&>span:first-child>svg{'), 'must style paused in_progress svg with prismatic ring');
  assert.ok(baseSection.includes('var(--_rr) padding-box'), 'paused in_progress ring must reuse Obsidian Prism --_rr prismatic gradient at exact 1.75px ring thickness');
  assert.ok(baseSection.includes('&[data-status="done"]{'), 'must style done state');
  assert.ok(baseSection.includes('&[data-status="pending"]{'), 'must style pending state');
  assert.ok(baseSection.includes('&[data-status="failed"]{'), 'must style failed state');
  assert.ok(baseSection.includes('&[data-status="skipped"]{'), 'must style skipped state');

  // State transition keyframes & motion-off guard
  assert.ok(baseSection.includes('@keyframes ag-sp-pop{'), 'must define ag-sp-pop badge transition keyframe');
  assert.ok(baseSection.includes('@keyframes ag-sp-chk{'), 'must define ag-sp-chk checkmark reveal keyframe');
  assert.ok(baseSection.includes('@keyframes ag-sp-bar{'), 'must define ag-sp-bar pause-bars reveal keyframe');
  assert.ok(baseSection.includes('[data-testid="step-plan-item"] :is(span,svg,path)'), 'motion="off" must disable step-plan state animations');

  // Light theme overrides
  assert.ok(lightSection.includes('& [data-testid="step-plan"]{'), 'light theme must override step-plan card surface');
  assert.ok(lightSection.includes('& [data-testid="step-plan-item"]{'), 'light theme must override step-plan-item badges');
  assert.ok(lightSection.includes('&[data-status="done"]{--_sc:var(--success,#059669);'), 'light theme must tune done badge contrast');
  assert.ok(lightSection.includes('&[data-status="pending"]>span:first-child{'), 'light theme must tune pending badge contrast');
  assert.ok(lightSection.includes('&[data-status="failed"]{--_sc:var(--error,#DC2626);'), 'light theme must tune failed badge contrast');

  // CSS hygiene & budget checks
  assert.equal(/:has\(/.test(css), false, 'style.css must have 0 :has() selectors');
  assert.equal(/[^\x00-\x7F]/.test(css), false, 'style.css must remain pure ASCII');
  const minified = cdp.minifyCss(css);
  assert.ok(minified.includes('[data-testid="step-plan"]'), 'minified CSS must retain step-plan rules');
  assert.ok(minified.includes('[data-testid="step-plan-item"]'), 'minified CSS must retain step-plan-item rules');
});

test('model-selector trigger relaxes container cap to min(300px,100%) and excludes .ag-pp-mini-keycap badge from truncation/collapse', () => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  // 1) 外层容器允许在 300px 内完整展示模型名与 [10Ne] 徽章，超窄窗口按 flex:0 1 auto 等比收缩
  assert.ok(
    css.includes('div.no-focus-agent-input{flex:0 1 auto !important;min-width:0 !important;max-width:min(300px,100%) !important;overflow:hidden !important;}'),
    'no-focus-agent-input must use flex:0 1 auto and max-width:min(300px,100%)',
  );
  // 2) 常规与窄窗 data-t~="1" 折叠规则均排除 .ag-pp-mini-keycap，防止迷你快捷键徽章被截断或隐藏
  assert.ok(
    css.includes('& [data-testid="model-selector-trigger"]>span:not(.ag-cs-model-glyph):not(.ag-pp-mini-keycap){'),
    'normal model-selector label span rule must exclude .ag-pp-mini-keycap',
  );
  assert.ok(
    css.includes('&[data-t~="1"] [data-testid="model-selector-trigger"]>span:not(.ag-cs-model-glyph):not(.ag-pp-mini-keycap),&[data-t~="2"] [data-testid="permissions-selector-trigger"]>span{'),
    'compact data-t~="1" collapse rule must exclude .ag-pp-mini-keycap',
  );
});
