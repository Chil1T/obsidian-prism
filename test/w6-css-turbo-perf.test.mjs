import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const CSS_PATH = path.join(ROOT, 'style.css');
const { minifyCss, flattenNestedCss, splitCssIntoBuckets } = require(path.join(ROOT, 'src', 'compiler', 'css-pack.cjs'));
const cdp = require(path.join(ROOT, 'cdp.js'));

const rawBuf = fs.readFileSync(CSS_PATH);
const rawCss = rawBuf.toString('utf8');
const cssLines = rawCss.split('\n');
const flatCss = minifyCss(flattenNestedCss(minifyCss(rawCss)));

function extractRulesForSelector(cssText, token) {
  const matched = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cssText.length; i++) {
    const ch = cssText[i];
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const rule = cssText.slice(start, i + 1);
        const braceIdx = rule.indexOf('{');
        if (braceIdx > 0 && rule.slice(0, braceIdx).includes(token)) {
          matched.push({ selector: rule.slice(0, braceIdx), body: rule.slice(braceIdx + 1, -1), raw: rule });
        }
        start = i + 1;
      }
    }
  }
  return matched;
}

test('W6-1: 5 large overlays purge real-time backdrop-filter blur while preserving lightweight menu blur', () => {
  const purgedLargeTokens = [
    '[data-ag-cs-overview-shell="1"]',
    '.animate-overview-panel',
    '.aux-drawer-popup',
    '.agy-toast',
    '.toast-root',
    '.ag-cs-nav-outline-popover',
    '[data-testid="side-question-panel"]',
    '.agy-fastpick',
    '[data-testid="fastpick"]',
    '[data-testid="slash-command-menu"]',
    '.quick-input-widget',
    '[data-peek-surface]',
    '.floating-comment-card',
  ];

  for (const token of purgedLargeTokens) {
    const rules = extractRulesForSelector(flatCss, token);
    assert.ok(rules.length > 0, `flattened CSS must still style ${token}`);
    for (const rule of rules) {
      assert.equal(
        /backdrop-filter\s*:\s*blur\(/i.test(rule.body),
        false,
        `large overlay ${token} must not apply backdrop-filter:blur() in rule: ${rule.raw.slice(0, 200)}`
      );
    }
    assert.ok(
      rules.some((r) => /backdrop-filter\s*:\s*none/i.test(r.body)),
      `large overlay ${token} must explicitly disable backdrop-filter:none`
    );
  }

  // Heavy overlay group must use dense opaque dark surface & light override
  const heavyOverlayLine = cssLines.find(
    (l) => l.includes('[data-ag-cs-overview-shell="1"]') && l.includes('.animate-overview-panel') && l.includes('backdrop-filter:none')
  );
  assert.ok(heavyOverlayLine, 'overview-shell / animate-overview-panel / aux-drawer-popup / toast must have dedicated non-blur rule');
  assert.ok(
    heavyOverlayLine.includes('.965') && heavyOverlayLine.includes('var(--ag-cs-menu-sheen)'),
    'heavy overlay rule must use high-opacity dark surface (.965) with top optical sheen'
  );

  // Required lightweight menus retain blur(16px)
  const ctxMenuRules = extractRulesForSelector(flatCss, '.ag-cs-ctx-menu');
  assert.ok(
    ctxMenuRules.some((r) => r.body.includes('backdrop-filter:blur(16px) saturate(140%)')),
    '.ag-cs-ctx-menu must preserve backdrop-filter:blur(16px) saturate(140%)'
  );
  const lightMenuRules = extractRulesForSelector(flatCss, '[data-testid="context-menu-popup"]');
  assert.ok(
    lightMenuRules.some((r) => r.body.includes('backdrop-filter:blur(16px)')),
    'lightweight context-menu-popup group must preserve backdrop-filter:blur(16px)'
  );

  // Small selection pill suppresses blur in win-blur / performance / stream-active modes
  const blurSuppressLine = cssLines.find(
    (l) => l.includes('[data-ag-cs-win-blur="1"]') && l.includes('.agy-selection-pill') && l.includes('backdrop-filter:none')
  );
  assert.ok(blurSuppressLine, '.agy-selection-pill must suppress backdrop-filter under win-blur / performance / stream-active');
});

test('W6-2: 300Hz infinite @keyframes use steps() throttling and win-blur freezes host + plugin animations', () => {
  // ag-ov-br uses steps(24) and is disabled in performance mode
  const ovBrLine = cssLines.find((l) => l.includes('ag-ov-br 4s'));
  assert.ok(ovBrLine, 'style.css must define ag-ov-br 4s breathing animation');
  assert.ok(ovBrLine.includes('steps(24)'), 'ag-ov-br 4s infinite must step-throttle with steps(24)');

  const perfModeLine = cssLines.find((l) => l.includes('[data-ag-cs-perf-mode="performance"]') && l.includes('[data-ag-overview-running="1"]'));
  assert.ok(perfModeLine, 'performance mode must explicitly configure running overlays & spinners');
  assert.ok(
    perfModeLine.includes('[data-ag-overview-running="1"]') &&
      perfModeLine.includes('[data-ag-sp-running="1"]') &&
      perfModeLine.includes('animation:none!important'),
    'performance mode must disable ag-ov-br breathing animation on overview & step-plan'
  );
  assert.ok(
    perfModeLine.includes('[data-testid="input-cancel-button"]') &&
      perfModeLine.includes('[data-testid="status-loading-spinner"]') &&
      /steps\(1[0-6]\)/.test(perfModeLine),
    'performance mode must tighten spinner & cancel-button steps()'
  );

  // sub-running::before & skeleton ag-cs-pulse use steps(16)
  const pulseUsages = cssLines.filter((l) => l.includes('animation:ag-cs-pulse'));
  assert.ok(pulseUsages.length >= 3, 'style.css must have sub-running & skeleton ag-cs-pulse animations');
  for (const line of pulseUsages) {
    assert.ok(line.includes('steps(16)'), `ag-cs-pulse must use steps(16) throttling: ${line.slice(0, 140)}`);
  }

  // [data-ag-cs-win-blur="1"] freezes both native host and plugin animations
  const winBlurLine = cssLines.find(
    (l) => l.includes('[data-ag-cs-win-blur="1"]') && l.includes('animation-play-state:paused')
  );
  assert.ok(winBlurLine, 'style.css must define [data-ag-cs-win-blur="1"] animation-play-state:paused rule');
  const requiredPausedSelectors = [
    '.shimmer-text-mask',
    '.shimmer-text-content',
    '[class*="animate-spin"]',
    '[class*="animate-pulse"]',
    '[class*="animate-bounce"]',
    '[class*="agentStateCaret"]',
    '[data-ag-cs-sonar="1"]',
    '[data-ag-overview-running="1"]::after',
    '[data-ag-sp-running="1"]::after',
    '[data-ag-sub-running="1"]::before',
    '[data-testid="status-loading-spinner"]::before',
  ];
  for (const sel of requiredPausedSelectors) {
    assert.ok(winBlurLine.includes(sel), `win-blur freeze rule must pause ${sel}`);
  }
  assert.equal(
    /:is\([^)]*::(?:before|after)/.test(rawCss),
    false,
    'style.css must never put ::before or ::after inside :is(...)'
  );
});

test('W6-3: long-conversation offscreen virtualization applies content-visibility:auto safely with bleed & tail guards', () => {
  const cvLines = cssLines.filter((l) => l.includes('content-visibility:auto'));
  assert.ok(cvLines.length >= 2, 'style.css must contain content-visibility:auto rules');

  // Every content-visibility:auto line must exclude bleed-marked tables
  for (const line of cvLines) {
    assert.ok(
      line.includes(':not([data-ag-cs-bleed="1"])'),
      `every content-visibility:auto line must exclude [data-ag-cs-bleed="1"]: ${line.slice(0, 180)}`
    );
  }

  // Sidebar conversation rows must NEVER have content-visibility
  const sidebarCvLines = cssLines.filter(
    (l) => l.includes('conversation-row-sidebar') && l.includes('content-visibility')
  );
  assert.equal(sidebarCvLines.length, 0, 'conversation-row-sidebar must have 0 content-visibility rules');

  // Long conversation non-tail turns & pre blocks
  const turnLine = cssLines.find(
    (l) =>
      l.includes('[data-testid="conversation-view"] [data-testid="autoscroll-viewport"]') &&
      l.includes('[data-testid="agent-response"]') &&
      l.includes('[data-testid="user-message"]') &&
      l.includes('[data-testid="turn-cards-container"]')
  );
  assert.ok(turnLine, 'must define content-visibility:auto for non-tail conversation turns');
  assert.ok(
    turnLine.includes(':not(:last-child):not([data-ag-cs-bleed="1"])') &&
      turnLine.includes('content-visibility:auto') &&
      turnLine.includes('contain-intrinsic-block-size:auto 220px'),
    'conversation turn virtualization must guard :not(:last-child):not([data-ag-cs-bleed="1"]) with 220px intrinsic block size'
  );

  const preLine = cssLines.find(
    (l) =>
      l.includes('[data-testid="conversation-view"] [data-testid="autoscroll-viewport"] pre:not(:last-child):not([data-ag-cs-bleed="1"])')
  );
  assert.ok(preLine, 'must define content-visibility:auto for non-tail conversation pre blocks');
  assert.ok(
    preLine.includes('content-visibility:auto') && preLine.includes('contain-intrinsic-block-size:auto 180px'),
    'conversation pre virtualization must use contain-intrinsic-block-size:auto 180px'
  );

  // Preserve legacy history & markdown pre contracts
  assert.ok(
    rawCss.includes('[data-testid="conversation-row-history"]:not([data-ag-cs-bleed="1"]){content-visibility:auto;contain-intrinsic-size:auto 44px;'),
    'must preserve legacy conversation-row-history content-visibility rule'
  );
  assert.ok(rawCss.includes('contain-intrinsic-size:auto 26px'), 'must preserve legacy 26px intrinsic size contract');
});

test('W6-4: style.css hygiene (0 BOM/CRLF/:has/non-ASCII, balanced braces) and tight darkChatActive + Ch1 budgets', () => {
  // Hygiene invariants
  assert.equal(rawBuf[0] === 0xef && rawBuf[1] === 0xbb && rawBuf[2] === 0xbf, false, 'style.css must have 0 UTF-8 BOM');
  assert.equal(/\r\n/.test(rawCss), false, 'style.css must use LF only (0 CRLF)');
  assert.equal(/:has\(/.test(rawCss), false, 'style.css must have 0 :has() selectors');
  assert.equal(/[^\x00-\x7f]/.test(rawCss), false, 'style.css must be 100% pure ASCII');

  // Balanced braces
  let balance = 0;
  for (let i = 0; i < rawCss.length; i++) {
    if (rawCss[i] === '{') balance++;
    else if (rawCss[i] === '}') balance--;
    assert.ok(balance >= 0, `unmatched closing brace at offset ${i}`);
  }
  assert.equal(balance, 0, 'style.css braces must be strictly balanced');

  // Flattened CSS has zero residual CSS Nesting &
  assert.equal(/(?:^|[\s,{])&/.test(flatCss), false, 'flattened CSS must contain 0 residual & selectors');

  // Size & line budgets
  const lineCount = rawCss.split(/\r?\n/).length;
  assert.ok(rawBuf.length <= 208800, `style.css raw size ${rawBuf.length} B exceeds 208,800 B target`);
  assert.ok(lineCount <= 860, `style.css line count ${lineCount} exceeds Law 2 limit 860`);

  const buckets = splitCssIntoBuckets(flatCss);
  const darkChatActive = Buffer.byteLength(buckets.core + buckets.viewSidebar + buckets.motionFull, 'utf8');
  assert.ok(darkChatActive < 184320, `darkChatActive ${darkChatActive} B exceeds 184,320 B hard redline`);
  assert.ok(darkChatActive <= 183800, `darkChatActive ${darkChatActive} B exceeds 183,800 B W6 target`);

  const ch1AutoBytes = Buffer.byteLength(cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: 'auto' }), 'utf8');
  assert.ok(ch1AutoBytes < 389500, `Ch1[auto] ${ch1AutoBytes} B exceeds 389,500 B W6 guard`);
  assert.ok(ch1AutoBytes <= 389200, `Ch1[auto] ${ch1AutoBytes} B exceeds 389,200 B W6 target`);
});
