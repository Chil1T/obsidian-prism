// Channel 6 Inline Diff Client (vendor/inline-diff/inline-diff-client.js)
(function (root) {
'use strict';
const G = root || (typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : null);
if (!G) return;

const INLINE_DIFF_STYLE_ID = 'ag-prism-inline-diff-css';
const MAX_PENDING = 32, TIMEOUT_MS = 5500, CACHE_MAX = 32, CACHE_TTL = 15000, NEG_TTL = 8000, MAX_BYTES = 131072, MAX_LINE_CHARS = 240;
const DET_ERR_RE = /^(?:not_found|blocked|outside_git_repo|invalid_uri|not_a_file|binary)/i;

// Strictly pure ASCII, 0 :has(), balanced braces, zero pseudo-elements inside :is()
const INLINE_DIFF_CSS = [
'@keyframes ag-cs-diff-unfold{from{opacity:0;transform:translate3d(0,-5px,0) scaleY(.97);}to{opacity:1;transform:translate3d(0,0,0) scaleY(1);}}',
'@keyframes ag-cs-diff-fold{from{opacity:1;transform:translate3d(0,0,0) scaleY(1);}to{opacity:0;transform:translate3d(0,-4px,0) scaleY(.97);}}',
'@keyframes ag-cs-diff-pulse{0%,100%{opacity:.45;}50%{opacity:.95;}}',
'@keyframes ag-cs-diff-in{from{opacity:0;transform:translate3d(0,-3px,0);}to{opacity:1;transform:translate3d(0,0,0);}}',
'$H{',
'& $Cbody{&::-webkit-scrollbar{width:4px;height:4px;display:block;}&::-webkit-scrollbar-track{background:transparent;}&::-webkit-scrollbar-thumb{background:transparent;border-radius:999px;}&:hover::-webkit-scrollbar-thumb{background:var(--_s8,$W.18));&:hover{background:var(--_s9,$W.32));}}}',
'& [data-testid="autoscroll-viewport"] .bleed-contain $Cbody{margin-right:14px$I;padding-right:8px$I;overscroll-behavior-y:auto$I;}',
'& [data-testid="autoscroll-viewport"] .bleed-contain .overflow-y-auto $Cbody{margin-right:12px$I;overscroll-behavior-y:auto$I;}',
'& [data-ag-diff-chip-row="1"]{overflow-y:visible$I;}',
'& [data-ag-diff-chip="1"]{display:inline-flex$I;align-items:center$I;gap:7px$I;min-height:22px$I;padding:1px 5px$I;margin:0 -2px$I;border-radius:4px$I;background:transparent$I;border:1px solid transparent$I;box-shadow:none$I;cursor:pointer$I;overflow:visible$I;transition:background-color 130ms ease,box-shadow 130ms ease$I;&:hover{background-color:$W.048)$I;& [data-ag-diff-chip-file="1"]{text-decoration-color:$W.36)$I;}}&[data-ag-inline-diff-open="1"]{background-color:$W.065)$I;box-shadow:inset 0 -1px 0 $W.22)$I;& [data-ag-diff-chip-file="1"]{text-decoration-color:transparent$I;}}& [data-ag-diff-chip-file="1"],& [data-ag-diff-chip-file="1"] :is([data-testid="entity-pill"],.inline-pill){background:transparent$I;border-color:transparent$I;box-shadow:none$I;padding:0$I;margin:0$I;color:var(--foreground)$I;font-weight:500;}& [data-ag-diff-chip-file="1"]{text-decoration:underline;text-decoration-color:$W.16);text-underline-offset:3px;text-decoration-thickness:1px;transition:text-decoration-color 130ms ease;}& [data-testid="diff-line-count"]{background:transparent$I;border:0$I;box-shadow:none$I;padding:0$I;margin:0$I;gap:5px$I;font-size:11.5px$I;font-weight:500;&::before{display:none$I;}}}',
'& [data-testid="diff-line-count"]{display:inline-flex;align-items:center;gap:4px;border-radius:var(--ag-cs-r-sm)$I;border:1px solid transparent;padding:1px 5px$I;font-family:var(--ag-cs-mono-stack);font-size:11px;font-variant-numeric:tabular-nums;transition:background-color 130ms ease,border-color 130ms ease,color 130ms ease$I;& [data-ag-diff-stat="add"]{color:#5CE68B$I;text-shadow:0 0 9px rgba(74,222,128,.42);}& [data-ag-diff-stat="del"]{color:#FF857D$I;text-shadow:0 0 9px rgba(248,113,113,.40);}& [data-ag-diff-stat="zero"]{color:$W.28)$I;text-shadow:none$I;}}',
'& $Cbox{display:block;box-sizing:border-box;width:100%;max-width:100%;align-self:stretch;margin:0;padding:0;transform-origin:50% 0%;contain:layout style;&[data-ag-diff-anim="1"]{will-change:transform,opacity;animation:ag-cs-diff-unfold 150ms var(--ag-ease-out,cubic-bezier(.16,1,.3,1)) both;}&[data-ag-diff-state="closing"]{will-change:transform,opacity;pointer-events:none;animation:ag-cs-diff-fold 120ms cubic-bezier(.32,0,.67,0) forwards;}}',
'& $Ccard{position:relative;margin:6px 0 12px;padding:0;border-radius:10px;border:1px solid $W.10);background-color:rgba(11,13,17,.94);background-image:linear-gradient(180deg,$W.028) 0%,transparent 34px);box-shadow:inset 0 1px 0 $W.08),0 12px 30px -12px rgba(0,0,0,.64);overflow:hidden;}',
'& $Cbar{display:flex;align-items:center;justify-content:space-between;gap:8px;height:30px;padding:0 8px 0 11px;border-bottom:1px solid $W.075);background-color:$W.026);user-select:none;}',
'& $Cmeta{display:flex;align-items:center;gap:7px;min-width:0;flex:1 1 auto;}& $Cfile{font-family:var(--ag-cs-mono-stack);font-size:11.5px;font-weight:500;color:var(--foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em;}',
'& $Cstats{display:inline-flex;align-items:center;gap:4px;flex-shrink:0;padding:1px 6px;border-radius:999px;background:$W.045);border:1px solid $W.075);font-family:var(--ag-cs-mono-stack);font-size:10.5px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.35;}& $Cst-add{color:#4ADE80;}& $Cst-del{color:#F87171;}',
'& $Csrc{display:inline-flex;align-items:center;flex-shrink:0;height:17px;padding:0 6px;border-radius:4px;font-family:var(--font-sans);font-size:10px;font-weight:500;background:rgba(148,163,184,.12);border:1px solid rgba(148,163,184,.22);color:rgba(226,232,240,.84);&[data-ag-diff-src="step-patch"]{background:rgba(56,189,248,.12);border-color:rgba(56,189,248,.28);color:#7DD3FC;}&[data-ag-diff-src="git-diff"]{background:rgba(74,222,128,.10);border-color:rgba(74,222,128,.24);color:#86EFAC;}&[data-ag-diff-src="snapshot"]{background:rgba(251,191,36,.10);border-color:rgba(251,191,36,.24);color:#FDE68A;}}',
'& $Cacts{display:inline-flex;align-items:center;gap:2px;flex-shrink:0;}& $Cact-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--muted-foreground);cursor:pointer;transition:background-color 110ms ease,color 110ms ease;& svg{width:12px;height:12px;}&:hover{background-color:$W.09);color:var(--foreground);}}',
'& $Cbody{max-height:360px;overflow:auto;padding:4px 0;font-family:var(--ag-cs-mono-stack);font-size:12px;line-height:1.62;tab-size:2;scroll-behavior:smooth;}',
'& $Cnote{padding:4px 12px 6px;margin-bottom:4px;border-bottom:1px solid $W.06);font-family:var(--font-sans);font-size:11px;line-height:1.45;color:var(--muted-foreground);opacity:.82;}',
'& $Cwrap-tag{display:inline-flex;align-items:center;height:15px;padding:0 5px;margin:auto 12px auto 4px;border-radius:3px;background:$W.05);border:1px solid $W.09);color:var(--muted-foreground);font-family:var(--font-sans);font-size:10px;line-height:1;flex-shrink:0;}',
'& $Cmore-bar{appearance:none;display:flex;align-items:center;justify-content:center;width:100%;padding:6px 12px 3px;margin-top:4px;border:0;border-top:1px solid $W.06);background:transparent;color:var(--muted-foreground);font-family:var(--font-sans);font-size:11px;cursor:pointer;transition:color 120ms ease;&:hover{color:var(--foreground);}}',
'& $Cline{display:flex;align-items:stretch;min-width:100%;width:max-content;box-sizing:border-box;white-space:pre;color:color-mix(in srgb,var(--secondary-foreground) 88%,transparent);&:is(.is-add,.is-del) $Csign{font-weight:600;opacity:1;&.is-cont{opacity:.42;font-weight:400;text-shadow:none$I;}}&.is-add{background:linear-gradient(90deg,rgba(46,160,67,.16) 0%,rgba(46,160,67,.10) 45%,rgba(46,160,67,.05) 100%)$I;color:var(--foreground);& $Cln{background-color:rgba(22,52,32,.96);color:rgba(134,239,172,.90);box-shadow:inset 2px 0 0 #3FB950;}& $Csign{color:#56D364$I;}}&.is-del{background:linear-gradient(90deg,rgba(248,81,73,.15) 0%,rgba(248,81,73,.09) 45%,rgba(248,81,73,.045) 100%)$I;color:color-mix(in srgb,var(--foreground) 92%,transparent);& $Cln{background-color:rgba(56,22,26,.96);color:rgba(252,165,165,.90);box-shadow:inset 2px 0 0 #F85149;}& $Csign{color:#FF7B72$I;}}&.is-hunk{align-items:center;height:21px;margin:2px 0;background-color:rgba(96,165,250,.085);border-top:1px solid rgba(147,197,253,.14);border-bottom:1px solid rgba(147,197,253,.14);& $Cln{height:100%;display:inline-flex;align-items:center;justify-content:center;background-color:rgba(20,28,42,.96);color:rgba(147,197,253,.78);padding:0 8px;}}}',
'& $Cgap-rule{flex:1 1 auto;height:1px;margin:0 14px;background:linear-gradient(90deg,rgba(147,197,253,.24),rgba(147,197,253,.04));pointer-events:none;}',
'& $Cln{position:sticky;left:0;z-index:1;flex:none;width:48px;box-sizing:border-box;padding:0 10px 0 8px;text-align:right;background-color:rgba(13,15,20,.97);border-right:1px solid $W.075);color:rgba(148,163,184,.52);user-select:none;font-variant-numeric:tabular-nums;font-size:11px;}',
'& $Csign{flex:none;width:20px;text-align:center;user-select:none;opacity:.78;}& $Ccode{flex:1 1 auto;min-width:0;padding:0 16px 0 3px;}',
'& $Cloading{display:flex;align-items:center;gap:10px;height:30px;padding:0 14px;font-family:var(--font-sans);font-size:11.5px;color:var(--muted-foreground);&::before{content:"";width:38px;height:2.5px;border-radius:999px;background:color-mix(in srgb,var(--primary) 46%,var(--ag-cs-border-2));animation:ag-cs-diff-pulse 1.2s ease-in-out infinite;}}',
'& $Cempty{padding:10px 14px;font-family:var(--font-sans);font-size:12px;line-height:1.5;color:var(--muted-foreground);}',
'& .ag-cs-diff-ctx-menu{position:fixed;z-index:9999;min-width:184px;padding:4px;border-radius:10px;background-color:rgba(14,16,22,.96);background-image:linear-gradient(rgba(164,196,255,.05) 0%,transparent 44%);backdrop-filter:blur(16px) saturate(140%);border:1px solid rgba(214,226,255,.12);box-shadow:inset 0 1px 0 rgba(232,240,255,.12),0 18px 40px -10px rgba(0,0,0,.64);display:flex;flex-direction:column;gap:2px;animation:ag-cs-diff-in 110ms var(--ag-ease-out,ease-out);}',
'& .ag-cs-diff-ctx-item{appearance:none;width:100%;height:28px;padding:0 9px;border:0;border-radius:7px;background:transparent;color:var(--secondary-foreground);font-family:var(--font-sans);font-size:12px;font-weight:450;display:flex;align-items:center;gap:8px;cursor:pointer;text-align:left;white-space:nowrap;transition:background-color 110ms ease,color 110ms ease;& svg{width:13px;height:13px;flex-shrink:0;opacity:.78;}&:hover{background-color:rgba(164,196,255,.09);color:var(--foreground);& svg{opacity:1;}}}',
'}',
'$H[data-ag-cs-theme="light"],$H>body:is(.theme-light,.light-theme,.light){',
'& [data-ag-diff-chip="1"]{background:transparent$I;border-color:transparent$I;box-shadow:none$I;& [data-ag-diff-chip-file="1"]{text-decoration-color:$L.20);}&:hover{background-color:$L.048)$I;& [data-ag-diff-chip-file="1"]{text-decoration-color:$L.42)$I;}}&[data-ag-inline-diff-open="1"]{background-color:$L.068)$I;box-shadow:inset 0 -1px 0 $L.24)$I;}}',
'& [data-testid="diff-line-count"]{& [data-ag-diff-stat="add"]{color:#15803D$I;text-shadow:none;}& [data-ag-diff-stat="del"]{color:#B91C1C$I;text-shadow:none;}& [data-ag-diff-stat="zero"]{color:$L.34)$I;text-shadow:none;}}',
'& $Ccard{background:#FAFBFD;border-color:$L.12);box-shadow:0 8px 22px -10px $L.12);}& $Cbar{background-color:$L.032);border-bottom-color:$L.08);}',
'& $Cstats{background:$L.045);border-color:$L.09);}& $Cst-add{color:#15803D;}& $Cst-del{color:#B91C1C;}',
'& $Csrc{background:rgba(100,116,139,.10);border-color:rgba(100,116,139,.22);color:#334155;&[data-ag-diff-src="step-patch"]{background:rgba(2,132,199,.10);border-color:rgba(2,132,199,.24);color:#0369A1;}&[data-ag-diff-src="git-diff"]{background:rgba(22,163,74,.10);border-color:rgba(22,163,74,.24);color:#15803D;}&[data-ag-diff-src="snapshot"]{background:rgba(217,119,6,.10);border-color:rgba(217,119,6,.24);color:#B45309;}}',
'& $Cact-btn:hover{background-color:$L.08);}& $Cmore-bar{border-top-color:$L.08);}& $Cwrap-tag{background:$L.045);border-color:$L.10);}& $Cln{background-color:#F3F5F9;border-right-color:$L.09);color:rgba(71,85,105,.68);}',
'& .ag-cs-diff-ctx-menu{background:rgba(252,253,255,.96);border-color:$L.12);box-shadow:0 12px 30px -8px $L.16),0 0 0 1px $L.06);& .ag-cs-diff-ctx-item:hover{background-color:rgba(37,99,235,.07);}}',
'& $Cline{&:is(.is-add,.is-del) $Csign{font-weight:600;opacity:1;text-shadow:none;&.is-cont{opacity:.38;font-weight:400;}}&.is-add{background:rgba(22,163,74,.10)$I;& $Cln{background-color:#E6F6EC;color:#15803D;box-shadow:inset 2px 0 0 #16A34A;}& $Csign{color:#15803D$I;}}&.is-del{background:rgba(220,38,38,.09)$I;& $Cln{background-color:#FDECEC;color:#B91C1C;box-shadow:inset 2px 0 0 #DC2626;}& $Csign{color:#B91C1C$I;}}}',
'& $Cline.is-hunk{background-color:rgba(59,130,246,.075);border-color:rgba(59,130,246,.16);& $Cln{background-color:#EBF2FE;color:#3B82F6;}}& $Cgap-rule{background:linear-gradient(90deg,rgba(59,130,246,.26),rgba(59,130,246,.05));}',
'}',
'@media (prefers-reduced-motion:reduce){:root:not([data-ag-cs-ignore-rm="1"]) :is($Cloading::before,.ag-cs-diff-ctx-menu){animation:none$I;}:root:not([data-ag-cs-ignore-rm="1"]) .ag-cs-diff-ctx-menu{backdrop-filter:none$I;}$H:not([data-ag-cs-ignore-rm="1"]):not([data-ag-cs-motion="ultra"]):not([data-ag-cs-motion="standard"]) $Cbox{animation:none$I;filter:none$I;}}',
'$H[data-ag-cs-win-blur="1"] $Cloading::before{animation-play-state:paused$I;}',
'$H[data-ag-cs-motion="off"] $Cbox,$H[data-ag-cs-motion="off"] $Cloading::before,$H[data-ag-cs-motion="off"] .ag-cs-diff-ctx-menu{animation:none$I;transition:none$I;}',
'$H:is([data-ag-cs-win-blur="1"],[data-ag-cs-motion="off"]) .ag-cs-diff-ctx-menu{backdrop-filter:none$I;}',
].join('\n').replace(/\$C/g, '.ag-cs-inline-diff-').replace(/\$W/g, 'rgba(255,255,255,').replace(/\$L/g, 'rgba(15,23,42,').replace(/\$I/g, ' !important').replace(/\$H/g, 'html[data-ag-cs-style]');
const _C = '.ag-cs-inline-diff-';

const NO_TR_ATTRS = [['translate', 'no'], ['data-no-translate', 'true'], ['data-ag-localization-skip', 'true'], ['data-agy-no-translate', 'true'], ['data-antigravity-zh-skip', '1'], ['data-ag-no-i18n', '']];
const S_CNT = '[data-testid="diff-line-count"]', S_CHG = '[data-testid="changed-files-card"]', P = 'ag-cs-inline-diff-';
const ga = (e, k) => e?.getAttribute?.(k), sa = (e, k, v) => e?.setAttribute?.(k, String(v)), ra = (e, k) => e?.removeAttribute?.(k);
const qs = (e, s) => e?.querySelector?.(s) || null, qa = (e, s) => e?.querySelectorAll?.(s) || [], cl = (e, s) => e?.closest?.(s) || null;
const tagU = (e) => String(e?.tagName || '').toUpperCase(), isEl = (n) => Boolean(n && (n.nodeType === 1 || (n.nodeType === undefined && typeof n.tagName === 'string')));
const trunc = (s) => { const v = String(s ?? ''); return v.length > MAX_LINE_CHARS ? v.slice(0, MAX_LINE_CHARS - 1) + '…' : v; };

function markNoTrOwned(el) {
if (el && typeof el.setAttribute === 'function') {
for (let i = 0; i < NO_TR_ATTRS.length; i++) el.setAttribute(NO_TR_ATTRS[i][0], NO_TR_ATTRS[i][1]);
el.setAttribute('data-ag-owned', '1');
}
return el;
}

function basenameFromUri(uri) {
const parts = String(uri || '').replace(/\\/g, '/').replace(/^file:\/\/\/?/i, '').split(/[?#]/, 1)[0].split('/').filter(Boolean);
return parts.length ? parts[parts.length - 1] : '';
}

function isLikelyUnifiedDiff(raw) {
if (typeof raw !== 'string') return false;
const s = raw.trim();
if (s.length < 4 || s.length > MAX_BYTES) return false;
if (/^@@\s+-\d+/m.test(s) || /^diff --git /m.test(s) || /^---\s+\S+\r?\n\+\+\+\s+\S+/m.test(s)) return true;
const ls = s.split(/\r?\n/);
return ls.length >= 2 && ls.some((l) => l[0] === '+' || l[0] === '-') && ls.every((l) => !l || l[0] === '+' || l[0] === '-' || l[0] === ' ' || l.startsWith('@@') || l[0] === '\\');
}

function parseUnifiedDiffLines(rawText, maxLines = 160) {
const raw = String(rawText || '');
if (raw.length > MAX_BYTES) return [];
const ls = raw.replace(/\r\n/g, '\n').split('\n'), out = [];
let oldLn = 1, newLn = 1;
for (let i = 0; i < ls.length && out.length < maxLines; i++) {
const l = ls[i];
if (/^(?:diff --git|index |--- |\+\+\+ |\\ No newline)/.test(l)) continue;
const hm = l.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/);
if (hm) { oldLn = Number(hm[1]) || 1; newLn = Number(hm[2]) || 1; out.push({ kind: 'hunk', ln: '', sign: '@@', text: trunc(l) }); continue; }
if (l[0] === '+') out.push({ kind: 'add', ln: String(newLn++), sign: '+', text: trunc(l.slice(1)) });
else if (l[0] === '-') out.push({ kind: 'del', ln: String(oldLn++), sign: '-', text: trunc(l.slice(1)) });
else if (l.length || out.length) { out.push({ kind: 'ctx', ln: String(newLn++), sign: ' ', text: trunc(l[0] === ' ' ? l.slice(1) : l) }); oldLn++; }
}
return out;
}

function splitDiffLines(str) {
if (!str) return [];
const arr = str.replace(/\r\n/g, '\n').split('\n');
if (arr.length > 1 && arr[arr.length - 1] === '') arr.pop();
return arr;
}

function buildPairDiffLines(oldText, newText, startLine = 1, maxLines = 160) {
const sO = String(oldText || ''), sN = String(newText || '');
if (sO === sN || sO.length + sN.length > MAX_BYTES) return [];
const base = Math.max(1, Number(startLine) || 1), a = splitDiffLines(sO), b = splitDiffLines(sN), out = [];
let p = 0;
while (p < a.length && p < b.length && a[p] === b[p]) p++;
let saI = a.length - 1, sbI = b.length - 1;
while (saI >= p && sbI >= p && a[saI] === b[sbI]) { saI--; sbI--; }
const m = saI >= p ? saI - p + 1 : 0, n = sbI >= p ? sbI - p + 1 : 0;
if (!m && !n) return [];
const push = (kind, ln, sign, text) => { if (out.length < maxLines) out.push({ kind, ln: String(ln), sign, text: trunc(text) }); };
if (m > 0 && n > 0 && m * n <= 160000) {
const cols = n + 1, dp = new Int32Array((m + 1) * cols);
for (let i = m - 1; i >= 0; i--) {
const ai = a[p + i], r = i * cols, nr = (i + 1) * cols;
for (let j = n - 1; j >= 0; j--) dp[r + j] = ai === b[p + j] ? dp[nr + j + 1] + 1 : Math.max(dp[nr + j], dp[r + j + 1]);
}
const ops = [];
for (let i = Math.max(0, p - 2); i < p; i++) ops.push({ kind: 'ctx', ln: base + i, sign: ' ', text: a[i] });
let i = 0, j = 0;
while (i < m && j < n) {
if (a[p + i] === b[p + j]) { ops.push({ kind: 'ctx', ln: base + p + j, sign: ' ', text: b[p + j] }); i++; j++; }
else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) ops.push({ kind: 'del', ln: base + p + i, sign: '-', text: a[p + i++] });
else ops.push({ kind: 'add', ln: base + p + j, sign: '+', text: b[p + j++] });
}
while (i < m) ops.push({ kind: 'del', ln: base + p + i, sign: '-', text: a[p + i++] });
while (j < n) ops.push({ kind: 'add', ln: base + p + j, sign: '+', text: b[p + j++] });
for (let k = sbI + 1, te = Math.min(b.length, sbI + 3); k < te; k++) ops.push({ kind: 'ctx', ln: base + k, sign: ' ', text: b[k] });
for (let x = 0; x < ops.length && out.length < maxLines;) {
if (ops[x].kind !== 'ctx') { const r = ops[x++]; push(r.kind, r.ln, r.sign, r.text); continue; }
let e = x;
while (e < ops.length && ops[e].kind === 'ctx') e++;
if (x > 0 && e < ops.length && e - x > 5) {
for (let k = x; k < x + 2; k++) push('ctx', ops[k].ln, ' ', ops[k].text);
if (out.length < maxLines) out.push({ kind: 'hunk', ln: '', sign: '@@', text: `@@ -${ops[e - 2].ln} +${ops[e - 2].ln} @@` });
for (let k = e - 2; k < e; k++) push('ctx', ops[k].ln, ' ', ops[k].text);
} else for (let k = x; k < e; k++) push('ctx', ops[k].ln, ' ', ops[k].text);
x = e;
}
return out;
}
for (let i = Math.max(0, p - 2); i < p; i++) push('ctx', base + i, ' ', a[i]);
for (let i = p; i <= saI; i++) push('del', base + i, '-', a[i]);
for (let i = p; i <= sbI; i++) push('add', base + i, '+', b[i]);
for (let i = sbI + 1, te = Math.min(b.length, sbI + 3); i < te; i++) push('ctx', base + i, ' ', b[i]);
return out;
}

function normLines(arr) {
const out = [];
for (let i = 0; i < arr.length && out.length < 160; i++) {
const it = arr[i];
if (!it || typeof it !== 'object') continue;
const rk = String(it.kind || it.type || '').toLowerCase();
const kind = /^(?:add|added|insert|insertion)$/.test(rk) ? 'add' : /^(?:del|deleted|remove|removed|deletion)$/.test(rk) ? 'del' : /^(?:hunk|header)$/.test(rk) ? 'hunk' : 'ctx';
out.push({ kind, ln: String(it.ln ?? it.lineNumber ?? it.newLine ?? it.oldLine ?? ''), sign: String(it.sign ?? (kind === 'add' ? '+' : kind === 'del' ? '-' : kind === 'hunk' ? '@@' : ' ')), text: trunc(it.text ?? it.content ?? it.value ?? it.line ?? '') });
}
return out;
}

function parseHunks(hunks, maxLines = 160) {
const out = [];
for (let i = 0; i < hunks.length && out.length < maxLines; i++) {
const h = hunks[i];
if (!h || typeof h !== 'object' || !Array.isArray(h.lines)) continue;
let oLn = Number(h.oldStart ?? h.oldLineStart ?? 1) || 1, nLn = Number(h.newStart ?? h.newLineStart ?? oLn) || 1;
if (out.length > 0 || h.header) out.push({ kind: 'hunk', ln: '', sign: '@@', text: trunc(h.header || `@@ -${oLn} +${nLn} @@`) });
for (let j = 0; j < h.lines.length && out.length < maxLines; j++) {
const ln = h.lines[j];
if (typeof ln === 'string') {
if (ln[0] === '+') out.push({ kind: 'add', ln: String(nLn++), sign: '+', text: trunc(ln.slice(1)) });
else if (ln[0] === '-') out.push({ kind: 'del', ln: String(oLn++), sign: '-', text: trunc(ln.slice(1)) });
else { out.push({ kind: 'ctx', ln: String(nLn++), sign: ' ', text: trunc(ln[0] === ' ' ? ln.slice(1) : ln) }); oLn++; }
} else if (ln && typeof ln === 'object') { const nm = normLines([ln]); if (nm.length) out.push(nm[0]); }
}
}
return out;
}

const PAIR_KEYS = [['TargetContent', 'ReplacementContent'], ['targetContent', 'replacementContent'], ['target_content', 'replacement_content'], ['Target', 'Replacement'], ['oldText', 'newText'], ['old_text', 'new_text'], ['oldString', 'newString'], ['old_string', 'new_string'], ['oldStr', 'newStr'], ['before', 'after'], ['beforeText', 'afterText'], ['beforeContent', 'afterContent'], ['original', 'modified'], ['originalText', 'modifiedText'], ['originalContent', 'modifiedContent'], ['originalCode', 'modifiedCode']];
const DIFF_STR_KEYS = ['unifiedDiff', 'unified_diff', 'unified', 'diff', 'patch', 'diffText', 'rawDiff', 'gitDiff', 'codeDiff'];
const CHUNK_KEYS = ['ReplacementChunks', 'replacementChunks', 'replacement_chunks', 'edits', 'chunks', 'changes'];
const URI_KEYS = ['uri', 'fileUri', 'filePath', 'TargetFile', 'targetFile', 'target_file', 'AbsolutePath', 'absolutePath', 'path', 'Path'];
const SKIP_KEYS = new Set(['return', 'child', 'sibling', 'alternate', 'stateNode', '_owner', 'ownerDocument', 'parentNode', 'parentElement', 'children', 'props']);

function extractPair(obj, maxLines = 160) {
if (!obj || typeof obj !== 'object') return [];
const sl = Number(obj.StartLine ?? obj.startLine ?? obj.start_line ?? obj.lineNumber ?? obj.oldStart) || 1;
for (let i = 0; i < PAIR_KEYS.length; i++) {
const ov = obj[PAIR_KEYS[i][0]], nv = obj[PAIR_KEYS[i][1]];
if ((typeof ov === 'string' || typeof nv === 'string') && (ov || nv) && ov !== nv) {
const built = buildPairDiffLines(typeof ov === 'string' ? ov : '', typeof nv === 'string' ? nv : '', sl, maxLines);
if (built.length) return built;
}
}
return [];
}

function extractChunks(chunks, maxLines = 160) {
if (!Array.isArray(chunks) || !chunks.length) return [];
const out = [];
for (let i = 0; i < chunks.length && out.length < maxLines; i++) {
const ch = chunks[i];
if (!ch || typeof ch !== 'object') continue;
const seg = typeof ch.unifiedDiff === 'string' && isLikelyUnifiedDiff(ch.unifiedDiff) ? parseUnifiedDiffLines(ch.unifiedDiff, maxLines - out.length) : typeof ch.diff === 'string' && isLikelyUnifiedDiff(ch.diff) ? parseUnifiedDiffLines(ch.diff, maxLines - out.length) : extractPair(ch, maxLines - out.length);
if (seg.length) {
if (out.length > 0 && out.length < maxLines) out.push({ kind: 'hunk', ln: '', sign: '@@', text: `@@ -${Number(ch.StartLine ?? ch.startLine ?? 1) || 1} @@` });
for (let j = 0; j < seg.length && out.length < maxLines; j++) out.push(seg[j]);
}
}
if (out.length) return out;
return chunks.some((c) => c && typeof c === 'object' && (c.kind || c.type) && (c.text !== undefined || c.content !== undefined || c.value !== undefined || c.line !== undefined)) ? normLines(chunks) : [];
}

const isPathStr = (v) => typeof v === 'string' && Boolean(v.trim()) && v.length <= 1024 && (v.trim().startsWith('file:') || v.includes('/') || v.includes('\\') || /^[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,8}$/.test(v.trim()));

function scanObj(rootObj, st) {
if (!rootObj || typeof rootObj !== 'object') return;
const q = [{ obj: rootObj, d: 0 }];
while (q.length && st.nodes < 96) {
const { obj, d } = q.shift();
if (!obj || typeof obj !== 'object' || st.visited.has(obj) || obj.nodeType === 1 || obj.nodeType === 9 || typeof obj.addEventListener === 'function') continue;
st.visited.add(obj); st.nodes++;
if (!st.uri) for (let i = 0; i < URI_KEYS.length; i++) { const v = obj[URI_KEYS[i]]; if (isPathStr(v)) { st.uri = v.trim(); if (!st.fileName) st.fileName = basenameFromUri(st.uri); break; } }
if (!st.fileName && isPathStr(obj.file)) st.fileName = basenameFromUri(obj.file);
if (!st.stepCtx && obj.diffContext && typeof obj.diffContext === 'object') st.stepCtx = obj.diffContext;
const ds = obj.diffStats || obj.stats || obj;
if (ds && typeof ds === 'object') {
const a = Number(ds.additions ?? ds.linesAdded), dl = Number(ds.deletions ?? ds.linesRemoved);
if (!st.additions && Number.isFinite(a) && a > 0) st.additions = Math.trunc(a);
if (!st.deletions && Number.isFinite(dl) && dl > 0) st.deletions = Math.trunc(dl);
}
if (!st.lines.length) for (let i = 0; i < DIFF_STR_KEYS.length; i++) { const dv = obj[DIFF_STR_KEYS[i]]; if (typeof dv === 'string' && isLikelyUnifiedDiff(dv)) { const ps = parseUnifiedDiffLines(dv); if (ps.length) { st.lines = ps; break; } } }
if (!st.lines.length && Array.isArray(obj.hunks) && obj.hunks.length) st.lines = parseHunks(obj.hunks);
if (!st.lines.length) for (let i = 0; i < CHUNK_KEYS.length; i++) if (Array.isArray(obj[CHUNK_KEYS[i]]) && obj[CHUNK_KEYS[i]].length) { const ex = extractChunks(obj[CHUNK_KEYS[i]]); if (ex.length) { st.lines = ex; break; } }
if (!st.lines.length) { const pl = extractPair(obj); if (pl.length) st.lines = pl; }
if (st.lines.length && st.uri) return;
if (d >= 5) continue;
if (Array.isArray(obj)) { for (let i = 0; i < Math.min(obj.length, 8); i++) if (obj[i] && typeof obj[i] === 'object') q.push({ obj: obj[i], d: d + 1 }); }
else { const ks = Object.keys(obj); for (let i = 0; i < Math.min(ks.length, 28); i++) { const k = ks[i]; if (!SKIP_KEYS.has(k) && !k.startsWith('__react') && obj[k] && typeof obj[k] === 'object') q.push({ obj: obj[k], d: d + 1 }); } }
}
}

function extractInlineDiffPayload(badgeEl, rowEl, winRef) {
let uri = '', fileName = '', additions = 0, deletions = 0, lines = [], source = '';
const uAttr = ga(badgeEl, 'data-ag-diff-uri') || ga(rowEl, 'data-ag-diff-uri');
if (typeof uAttr === 'string' && uAttr.trim()) { uri = uAttr.trim(); fileName = basenameFromUri(uri); }
const rawJson = ga(badgeEl, 'data-ag-diff-json') || ga(rowEl, 'data-ag-diff-json');
if (rawJson && rawJson.length <= MAX_BYTES) {
try {
const p = JSON.parse(rawJson);
if (p && typeof p === 'object') {
if (!uri) { const c = p.uri || p.filePath || p.path; if (typeof c === 'string' && c.trim()) uri = c.trim(); }
if (typeof p.file === 'string') fileName = basenameFromUri(p.file);
if (!fileName && uri) fileName = basenameFromUri(uri);
if (typeof p.additions === 'number') additions = p.additions;
if (typeof p.deletions === 'number') deletions = p.deletions;
if (Array.isArray(p.lines)) lines = normLines(p.lines);
else if (typeof p.unified === 'string' || typeof p.unifiedDiff === 'string') lines = parseUnifiedDiffLines(p.unified || p.unifiedDiff);
else lines = extractPair(p);
if (lines.length) source = 'step-patch';
}
} catch {}
}
if ((!lines.length || !uri) && (badgeEl || rowEl)) {
try {
const st = { uri, fileName, additions, deletions, lines, stepCtx: null, visited: new WeakSet(), nodes: 0 };
const scanNode = (el, maxUp) => {
if (!el) return;
const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
for (let d = 0, f = fk ? el[fk] : null; d < maxUp && f; d++, f = f.return) {
if (f.memoizedProps && typeof f.memoizedProps === 'object') scanObj(f.memoizedProps, st);
if (!st.lines.length && f.memoizedState && typeof f.memoizedState === 'object') {
for (let hs = 0, h = f.memoizedState; hs < 10 && h && typeof h === 'object'; hs++, h = h.next) {
if (h.memoizedState && typeof h.memoizedState === 'object') scanObj(h.memoizedState, st);
if (st.lines.length && st.uri) break;
}
}
if (st.lines.length && st.uri) break;
}
};
scanNode(badgeEl, 28);
if (!st.lines.length || !st.uri) scanNode(rowEl, 16);
uri = st.uri || uri; fileName = st.fileName || fileName; additions = st.additions || additions; deletions = st.deletions || deletions;
if (st.lines.length) { lines = st.lines; source = 'step-patch'; }
const W = winRef || (typeof window !== 'undefined' ? window : G);
if (!lines.length && typeof W?.__agPrismResolveInlineDiff === 'function') {
const ext = W.__agPrismResolveInlineDiff({ uri, fileName, additions, deletions, diffContext: st.stepCtx, badgeEl, rowEl });
if (Array.isArray(ext?.lines)) lines = normLines(ext.lines);
else if (typeof ext?.unified === 'string') lines = parseUnifiedDiffLines(ext.unified);
if (lines.length) source = 'step-patch';
}
} catch {}
}
if (!additions && !deletions) {
const txt = String(badgeEl?.textContent || ''), am = txt.match(/\+(\d+)/), dm = txt.match(/-(\d+)/);
if (am) additions = Number(am[1]) || 0;
if (dm) deletions = Number(dm[1]) || 0;
}
if (lines.length && !additions && !deletions) for (let i = 0; i < lines.length; i++) { if (lines[i].kind === 'add') additions++; else if (lines[i].kind === 'del') deletions++; }
if (!fileName && uri) fileName = basenameFromUri(uri);
if (!fileName && rowEl) { const fm = String(rowEl.textContent || '').trim().match(/([A-Za-z0-9._-]+\.[A-Za-z0-9]{1,8})/); if (fm) fileName = fm[1]; }
return { uri, fileName: fileName || 'Diff Preview', additions, deletions, lines, source };
}

const DIFF_FALLBACK = {
inlineDiffOpenSidebar:{'zh-CN':'在侧栏打开完整对比','zh-TW':'在側欄開啟完整對比',en:'Open full diff in Sidebar',ja:'サイドバーで完全な差分を開く',ko:'사이드바에서 전체 차이 열기',es:'Abrir diff completo en la barra lateral',fr:'Ouvrir le diff complet dans la barre latérale',de:'Vollständigen Diff in Seitenleiste öffnen',tr:'Tam diff’i kenar çubuğunda aç'},
inlineDiffCollapse:{'zh-CN':'收起','zh-TW':'收合',en:'Collapse',ja:'閉じる',ko:'접기',es:'Contraer',fr:'Réduire',de:'Einklappen',tr:'Daralt'},
inlineDiffLoading:{'zh-CN':'正在读取差异...','zh-TW':'正在讀取差異...',en:'Loading diff...',ja:'差分を読み込み中...',ko:'차이점 불러오는 중...',es:'Cargando diff...',fr:'Chargement du diff...',de:'Diff wird geladen...',tr:'Diff yükleniyor...'},
inlineDiffBinary:{'zh-CN':'二进制文件暂不支持行内预览，请右键在侧栏打开。','zh-TW':'二進位檔案暫不支援行內預覽，請右鍵在側欄開啟。',en:'Binary file cannot be previewed inline. Right-click to open in Sidebar.',ja:'バイナリファイルはインライン表示できません。右クリックでサイドバーから開けます。',ko:'바이너리 파일은 인라인으로 미리 볼 수 없습니다. 우클릭하여 사이드바에서 여세요.',es:'Los archivos binarios no tienen vista previa en línea. Haz clic derecho para abrir en la barra lateral.',fr:'Les fichiers binaires ne peuvent pas être prévisualisés en ligne. Clic droit pour ouvrir dans la barre latérale.',de:'Binärdateien können nicht inline angezeigt werden. Rechtsklick zum Öffnen in der Seitenleiste.',tr:'İkili dosya satır içi önizlenemez. Kenar çubuğunda açmak için sağ tıklayın.'},
inlineDiffNoPreview:{'zh-CN':'当前步骤暂无行内差异，请右键在侧栏打开。','zh-TW':'目前步驟暫無行內差異，請右鍵在側欄開啟。',en:'Inline diff is unavailable for this step. Right-click to open in Sidebar.',ja:'このステップには差分テキストがありません。右クリックでサイドバーから開けます。',ko:'이 단계에는 인라인 차이가 없습니다. 우클릭하여 사이드바에서 여세요.',es:'El diff en línea no está disponible para este paso. Haz clic derecho para abrir en la barra lateral.',fr:'Le diff en ligne est indisponible pour cette étape. Clic droit pour ouvrir dans la barre latérale.',de:'Inline-Diff ist für diesen Schritt nicht verfügbar. Rechtsklick zum Öffnen in der Seitenleiste.',tr:'Bu adım için satır içi diff kullanılamıyor. Kenar çubuğunda açmak için sağ tıklayın.'},
inlineDiffSensitive:{'zh-CN':'该文件受隐私安全规则保护，已跳过行内预览（可右键在侧栏查看）','zh-TW':'該檔案受隱私安全規則保護，已略過行內預覽（可右鍵在側欄檢視）',en:'Protected by privacy rules; inline preview skipped (right-click to view in Sidebar).',ja:'プライバシー保護ルールによりインライン表示をスキップしました（右クリックでサイドバー表示）',ko:'개인정보 보호 규칙으로 인라인 미리보기를 건너뛰었습니다(우클릭하여 사이드바에서 보기).',es:'Protegido por reglas de privacidad; vista previa en línea omitida (clic derecho para ver en la barra lateral).',fr:'Protégé par les règles de confidentialité ; aperçu en ligne ignoré (clic droit pour voir dans la barre latérale).',de:'Durch Datenschutzregeln geschützt; Inline-Vorschau übersprungen (Rechtsklick für Seitenleiste).',tr:'Gizlilik kurallarıyla korunuyor; satır içi önizleme atlandı (kenar çubuğunda açmak için sağ tıklayın).'},
inlineDiffSnapshotNotice:{'zh-CN':'未受 Git 追踪 · 预览当前文件内容（右键可在侧栏打开完整对比）','zh-TW':'未受 Git 追蹤 · 預覽目前檔案內容（右鍵可在側欄開啟完整對比）',en:'Not tracked by Git · previewing current file (right-click to open full diff in Sidebar)',ja:'Git 未追跡 · 現在のファイルを表示中（右クリックでサイドバーで完全な差分を開く）',ko:'Git 추적 안 됨 · 현재 파일 미리보기(우클릭하여 사이드바에서 전체 차이 열기)',es:'No rastreado por Git · vista previa del archivo actual (clic derecho para abrir diff completo)',fr:'Non suivi par Git · aperçu du fichier actuel (clic droit pour ouvrir le diff complet)',de:'Nicht von Git verfolgt · Vorschau der aktuellen Datei (Rechtsklick für vollständigen Diff)',tr:'Git tarafından izlenmiyor · geçerli dosya önizleniyor (tam diff’i kenar çubuğunda açmak için sağ tıklayın)'},
inlineDiffLongLinesTag:{'zh-CN':'单行长改','zh-TW':'單行長改',en:'long line',ja:'長行',ko:'긴 줄',es:'línea larga',fr:'ligne longue',de:'lange Zeile',tr:'uzun satır'},
inlineDiffMenuExpand:{'zh-CN':'展开行内对比','zh-TW':'展開行內對比',en:'Expand inline diff',ja:'インライン差分を展開',ko:'인라인 차이 펼치기',es:'Expandir diff en línea',fr:'Déplier le diff en ligne',de:'Inline-Diff ausklappen',tr:'Satır içi diff’i genişlet'},
inlineDiffMenuCollapse:{'zh-CN':'收起行内对比','zh-TW':'收合行內對比',en:'Collapse inline diff',ja:'インライン差分を閉じる',ko:'인라인 차이 접기',es:'Contraer diff en línea',fr:'Replier le diff en ligne',de:'Inline-Diff einklappen',tr:'Satır içi diff’i daralt'},
inlineDiffMenuCopyPath:{'zh-CN':'复制文件路径','zh-TW':'複製檔案路徑',en:'Copy file path',ja:'ファイルパスをコピー',ko:'파일 경로 복사',es:'Copiar ruta del archivo',fr:'Copier le chemin du fichier',de:'Dateipfad kopieren',tr:'Dosya yolunu kopyala'},
inlineDiffLargeExpandBtn:{'zh-CN':'⋯ 大文件仅节选关键片段 · 点击在右侧栏查看完整对比','zh-TW':'⋯ 大檔案僅節選關鍵片段 · 點擊在右側欄檢視完整對比',en:'⋯ Showing key hunks · Click to open full diff in Sidebar',ja:'⋯ 大きなファイルのため一部のみ表示 · クリックしてサイドバーで全体を見る',ko:'⋯ 대용량 파일 주요 변경만 표시 · 클릭하여 사이드바에서 전체 보기',es:'⋯ Mostrando fragmentos clave · Haz clic para abrir el diff completo',fr:'⋯ Extraits clés affichés · Cliquer pour ouvrir le diff complet',de:'⋯ Wichtige Bereiche angezeigt · Klicken für vollständigen Diff',tr:'⋯ Önemli bölümler gösteriliyor · Tam diff’i kenar çubuğunda açmak için tıklayın'},
inlineDiffSrcPatch:{'zh-CN':'步骤补丁','zh-TW':'步驟修補',en:'Step patch',ja:'ステップ差分',ko:'단계 패치',es:'Parche del paso',fr:'Correctif',de:'Schritt-Patch',tr:'Adım yaması'},
inlineDiffSrcGit:{'zh-CN':'Git 差异','zh-TW':'Git 差異',en:'Git diff',ja:'Git 差分',ko:'Git 차이',es:'Diff de Git',fr:'Diff Git',de:'Git-Diff',tr:'Git diff'},
inlineDiffSrcSnapshot:{'zh-CN':'当前快照','zh-TW':'目前快照',en:'Snapshot',ja:'スナップショット',ko:'스냅샷',es:'Instantánea',fr:'Instantané',de:'Schnappschuss',tr:'Anlık görüntü'},
};

function createInlineDiffClient(options = {}) {
const doc = options.doc || options.document || (typeof document !== 'undefined' ? document : null);
const win = options.win || options.window || (typeof window !== 'undefined' ? window : G);
let cfg = options.config && typeof options.config === 'object' ? { ...options.config } : {};
const extGetCfg = typeof options.getConfig === 'function' ? options.getConfig : null;
const getCfg = () => { const e = extGetCfg ? extGetCfg() : null; return e && typeof e === 'object' ? { ...cfg, ...e } : cfg; };

const baseGetLang = typeof options.getLang === 'function' ? options.getLang : null;
const baseT = typeof options.t === 'function' ? options.t : null;
const baseMut = typeof options.runGuardedMut === 'function' ? options.runGuardedMut : null;
const baseSetA = typeof options.setAttrIfChanged === 'function' ? options.setAttrIfChanged : null;
let hookGetLang = baseGetLang, hookT = baseT, hookMut = baseMut, hookSetA = baseSetA;

const normLang = (raw) => {
let v = String(raw || '').trim();
if (!v || v.toLowerCase() === 'auto') v = String(((win && 'navigator' in win ? win.navigator : typeof navigator !== 'undefined' ? navigator : null)?.language) || '').trim();
const s = v.toLowerCase().replace(/_/g, '-');
if (!s || s === 'auto') return 'en';
if (s === 'yue' || s.startsWith('yue-') || s === 'zh-yue' || s.includes('cantonese')) return 'zh-CN';
if (/^zh-(tw|hant|hk|mo)/.test(s) || s === 'tw' || s === 'hant') return 'zh-TW';
if (/^zh/.test(s)) return 'zh-CN';
if (/^(ja|jp)/.test(s) || s === 'japanese') return 'ja';
if (/^(ko|kr)/.test(s) || s === 'korean') return 'ko';
if (/^es/.test(s) || s === 'spanish') return 'es';
if (/^fr/.test(s) || s === 'french') return 'fr';
if (/^de/.test(s) || s === 'german') return 'de';
if (/^tr/.test(s) || s === 'turkish' || s === 'türkçe' || s === 'turkce') return 'tr';
return 'en';
};
const getLang = () => {
if (typeof hookGetLang === 'function') { try { const v = String(hookGetLang() || '').trim(); if (v && v !== 'auto') return normLang(v); } catch {} }
const clg = String(cfg.language || cfg.lang || '').trim();
return clg && clg !== 'auto' ? normLang(clg) : normLang(String(doc?.documentElement?.getAttribute?.('data-ag-cs-lang') || '').trim());
};
const mut = (fn) => (typeof hookMut === 'function' ? hookMut(fn) : fn());
const setA = (el, n, v) => (typeof hookSetA === 'function' ? hookSetA(el, n, v) : (el && ga(el, n) !== v && sa(el, n, v)));
const extDead = typeof options.isDestroyed === 'function' ? options.isDestroyed : () => false;
let dead = false;
const isDead = () => dead || extDead();

const pending = new Map(), cache = new Map(), inflight = new Map(), animTimers = new Set();
let hoverTmr = 0, syncTmr = 0, reqSeq = 1, allowNative = false, ctxMenu = null, styleEl = null, selfApi = null;
const stats = { inlineDiffToggleCount: 0 };
const mk = (t, c, x, ...ks) => { const e = doc.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; for (const k of ks) if (k) e.appendChild(k); return e; };

function getUiText(key, fb) {
if (typeof hookT === 'function') { try { const v = hookT(key); if (typeof v === 'string' && v && v !== key) return v; } catch {} }
const lang = getLang();
try { const ui = (win?.__agCsLocales || G.__agCsLocales)?.getUiStrings?.(lang); if (ui && typeof ui[key] === 'string' && ui[key]) return ui[key]; } catch {}
const row = DIFF_FALLBACK[key];
return (row && (row[lang] || row.en)) || fb || key;
}

function mkSvg(kind, size = 14) {
const NS = 'http://www.w3.org/2000/svg';
if (!doc || typeof doc.createElementNS !== 'function') { const sp = doc.createElement('span'); sp.setAttribute('aria-hidden', 'true'); return sp; }
const svg = doc.createElementNS(NS, 'svg');
for (const [k, v] of [['width', size], ['height', size], ['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.6'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']]) svg.setAttribute(k, String(v));
const add = (tag, attrs) => { const n = doc.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.appendChild(n); };
if (kind === 'external') { add('path', { d: 'M15 3h6v6' }); add('path', { d: 'M10 14L21 3' }); add('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }); }
else if (kind === 'close') { add('path', { d: 'M18 6L6 18' }); add('path', { d: 'M6 6l12 12' }); }
else if (kind === 'chevDown') add('polyline', { points: '6 9 12 15 18 9' });
else if (kind === 'moreDots') for (const cx of ['6', '12', '18']) add('circle', { cx, cy: '12', r: '1.2', fill: 'currentColor', stroke: 'none' });
return svg;
}

function ensureStyle() {
if (isDead() || !doc || typeof doc.createElement !== 'function') return null;
if (styleEl && styleEl.isConnected !== false && (typeof doc.getElementById !== 'function' || doc.getElementById(INLINE_DIFF_STYLE_ID) === styleEl)) return styleEl;
const ex = typeof doc.getElementById === 'function' ? doc.getElementById(INLINE_DIFF_STYLE_ID) : null;
if (ex) { if (ex.textContent !== INLINE_DIFF_CSS) mut(() => { ex.textContent = INLINE_DIFF_CSS; }); markNoTrOwned(ex); return (styleEl = ex); }
const tgt = doc.head || doc.documentElement || doc.body;
if (!tgt || typeof tgt.appendChild !== 'function') return null;
let cr = null;
mut(() => { cr = doc.createElement('style'); cr.id = INLINE_DIFF_STYLE_ID; markNoTrOwned(cr); cr.textContent = INLINE_DIFF_CSS; tgt.appendChild(cr); });
return (styleEl = cr);
}

function onResolve(reqId, resp) {
const e = pending.get(reqId);
if (!e) return;
pending.delete(reqId);
if (e.timer) clearTimeout(e.timer);
try { e.resolve(resp || null); } catch {}
}
if (win) { try { win.__agPrismInlineDiffResolve = onResolve; } catch {} }

function findHostRow(badgeEl) {
if (!badgeEl) return null;
const exp = cl(badgeEl, '[data-testid="tool-call-row"], [data-ag-tool-row="1"]');
if (exp) return exp;
let cur = badgeEl, spanHost = null;
const cands = [];
for (let i = 0; i < 16 && cur?.parentElement; i++, cur = cur.parentElement) {
const p = cur.parentElement;
if (p === doc?.documentElement || cur === doc?.body || cur === doc?.documentElement) break;
const tid = ga(cur, 'data-testid') || '';
if (tid === 'conversation-view' || tid === 'autoscroll-viewport' || qa(cur, S_CNT).length > 1 || (cur.classList?.contains?.('flex-col') && (cur.children?.length || 0) > 1)) break;
const pt = tagU(p);
if (pt === 'SPAN' || pt === 'BUTTON' || pt === 'A') continue;
let disp = '', dir = '';
try { const cs = win?.getComputedStyle?.(p); if (cs) { disp = String(cs.display || cs.getPropertyValue?.('display') || '').toLowerCase(); dir = String(cs.flexDirection || cs.getPropertyValue?.('flex-direction') || '').toLowerCase(); } } catch {}
if (!(disp ? (disp === 'flex' && dir === 'column') || disp === 'block' || disp === 'grid' : Boolean(p.classList?.contains?.('flex-col')))) continue;
if (tagU(cur) === 'SPAN') { if (!spanHost) spanHost = cur; continue; }
cands.push(cur);
}
if (cands.length) {
let best = cands[cands.length - 1], bw = -1;
for (let i = 0; i < cands.length; i++) {
const c = cands[i], w = Math.round(Number(c.getBoundingClientRect?.()?.width) || 0);
if (w > bw || (w === bw && (Boolean(c.classList?.contains?.('w-full')) || i > 0))) { bw = w; best = c; }
}
return bw === 0 ? cands.find((c) => c.classList?.contains?.('w-full')) || best : best;
}
return spanHost || cl(badgeEl, 'button, [role="button"]') || badgeEl.parentElement || null;
}

function requestDaemon(uri, hints) {
if (isDead() || !uri || typeof win?.__agPrismInlineDiffCall !== 'function') return null;
const key = `${uri}|${Number(hints?.additions) || 0}:${Number(hints?.deletions) || 0}`, hit = cache.get(key);
if (hit) { if (Date.now() - hit.at <= (hit.ttl || CACHE_TTL)) return { reqId: reqSeq++, cached: hit.resp, promise: Promise.resolve(hit.resp) }; cache.delete(key); }
const ex = inflight.get(key);
if (ex) return { reqId: reqSeq++, promise: ex };
try { win.__agPrismInlineDiffResolve = onResolve; } catch {}
while (pending.size >= MAX_PENDING) { const ok = pending.keys().next().value, o = pending.get(ok); pending.delete(ok); if (o?.timer) clearTimeout(o.timer); try { o?.resolve?.({ ok: false, error: 'evicted' }); } catch {} }
const reqId = reqSeq++, ch = hints && (hints.additions > 0 || hints.deletions > 0) ? { additions: Math.max(0, Math.trunc(Number(hints.additions) || 0)), deletions: Math.max(0, Math.trunc(Number(hints.deletions) || 0)) } : undefined;
const promise = new Promise((resolve) => {
const timer = setTimeout(() => { if (!pending.delete(reqId)) return; inflight.delete(key); resolve({ ok: false, error: 'timeout' }); }, TIMEOUT_MS);
pending.set(reqId, {
resolve: (resp) => {
inflight.delete(key);
if (resp && typeof resp === 'object') {
const neg = (!resp.ok && DET_ERR_RE.test(String(resp.error || resp.reason || ''))) || (resp.ok && resp.mode === 'binary');
if (resp.ok || neg) {
while (cache.size >= CACHE_MAX) { const ok = cache.keys().next().value; if (ok === undefined) break; cache.delete(ok); }
cache.set(key, { at: Date.now(), ttl: neg ? NEG_TTL : CACHE_TTL, resp });
}
}
resolve(resp);
},
timer,
});
try { win.__agPrismInlineDiffCall(JSON.stringify(ch ? { id: reqId, action: 'readInlineDiff', uri, hints: ch } : { id: reqId, action: 'readInlineDiff', uri })); }
catch { const r = pending.get(reqId); if (r) { pending.delete(reqId); if (r.timer) clearTimeout(r.timer); } inflight.delete(key); resolve({ ok: false, error: 'rpc-error' }); }
});
if (inflight.size < 16) inflight.set(key, promise);
return { reqId, promise };
}

function createTopBar(fileName, stepStats, srcMode, onOpenSb, onCollapse) {
const fileEl = mk('span', P + 'file', fileName || 'Diff Preview'), statsEl = mk('span', P + 'stats'), srcEl = mk('span', P + 'src');
const mkBtn = (act, ic, lbl, fn) => {
const b = mk('button', P + 'act-btn', null, mkSvg(ic, 12));
b.type = 'button'; sa(b, 'data-ag-diff-act', act); sa(b, 'title', lbl); sa(b, 'aria-label', lbl);
b.addEventListener('click', (ev) => { ev.preventDefault?.(); ev.stopPropagation?.(); fn(); });
return b;
};
const barEl = mk('div', P + 'bar', null, mk('div', P + 'meta', null, fileEl, statsEl, srcEl), mk('div', P + 'acts', null, mkBtn('sidebar', 'external', getUiText('inlineDiffOpenSidebar'), onOpenSb), mkBtn('collapse', 'close', getUiText('inlineDiffCollapse'), onCollapse)));
const update = (nf, na, nd, nm) => {
if (nf) fileEl.textContent = nf;
while (statsEl.firstChild) statsEl.removeChild(statsEl.firstChild);
const a = Math.max(0, Number(na) || 0), d = Math.max(0, Number(nd) || 0);
if (a > 0 || d > 0) { statsEl.appendChild(mk('span', P + 'st-add', `+${a}`)); statsEl.appendChild(mk('span', P + 'st-del', `-${d}`)); if (statsEl.style) statsEl.style.display = ''; }
else if (statsEl.style) statsEl.style.display = 'none';
const bdg = nm === 'step-patch' ? ['step-patch', getUiText('inlineDiffSrcPatch', 'Step patch')] : (nm === 'git-diff' || nm === 'new-file') ? ['git-diff', getUiText('inlineDiffSrcGit', 'Git diff')] : nm === 'snapshot' ? ['snapshot', getUiText('inlineDiffSrcSnapshot', 'Snapshot')] : null;
if (bdg) { srcEl.textContent = bdg[1]; sa(srcEl, 'data-ag-diff-src', bdg[0]); if (srcEl.style) srcEl.style.display = ''; }
else { srcEl.textContent = ''; ra(srcEl, 'data-ag-diff-src'); if (srcEl.style) srcEl.style.display = 'none'; }
};
update(fileName, stepStats?.additions, stepStats?.deletions, srcMode);
return { barEl, update };
}

function renderBody(bodyEl, lines, stateKind, metaMode, _stepStats, totalStats, onOpenSb) {
if (!doc || !bodyEl) return;
while (bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild);
if (Array.isArray(lines) && lines.length > 0) {
if (metaMode === 'snapshot') bodyEl.appendChild(mk('div', P + 'note', getUiText('inlineDiffSnapshotNotice')));
const rows = [];
let seen = false, gap = false, gapTitle = '';
for (let i = 0; i < Math.min(lines.length, 160); i++) {
const r = lines[i];
if (!r || typeof r !== 'object') continue;
const kind = r.kind === 'add' || r.kind === 'del' || r.kind === 'hunk' ? r.kind : 'ctx';
if (kind === 'hunk') { if (seen) { gap = true; gapTitle = String(r.text || ''); } continue; }
if (gap) { gap = false; rows.push({ kind: 'hunk', ln: '⋯', sign: '', text: gapTitle }); gapTitle = ''; }
seen = true;
rows.push({ kind, ln: String(r.ln ?? ''), sign: String(r.sign ?? (kind === 'add' ? '+' : kind === 'del' ? '-' : ' ')), text: trunc(r.text ?? '') });
}
const llbl = getUiText('inlineDiffLongLinesTag', 'long line');
for (let i = 0; i < rows.length; i++) {
const r = rows[i];
if (r.kind === 'hunk') { const hl = mk('div', P + 'line is-hunk', null, mk('span', P + 'ln', '⋯'), mk('span', P + 'gap-rule')); if (r.text) sa(hl, 'title', r.text); bodyEl.appendChild(hl); continue; }
const chg = r.kind === 'add' || r.kind === 'del', pSame = chg && i > 0 && rows[i - 1].kind === r.kind, nSame = chg && i + 1 < rows.length && rows[i + 1].kind === r.kind;
const gc = chg && (pSame || nSame) ? (!pSame ? ' is-grp-start' : !nSame ? ' is-grp-end' : ' is-grp-mid') : '';
bodyEl.appendChild(mk('div', `${P}line is-${r.kind}${gc}`, null, mk('span', P + 'ln', r.ln), mk('span', pSame ? P + 'sign is-cont' : P + 'sign', pSame ? '┆' : r.sign), mk('span', P + 'code', r.text), r.text.endsWith('…') ? mk('span', P + 'wrap-tag', llbl) : null));
}
if (totalStats?.truncated && typeof onOpenSb === 'function') {
const mb = mk('button', P + 'more-bar', getUiText('inlineDiffLargeExpandBtn'));
mb.type = 'button'; mb.addEventListener('click', (ev) => { ev.preventDefault?.(); ev.stopPropagation?.(); onOpenSb(); });
bodyEl.appendChild(mb);
}
return;
}
if (stateKind === 'loading') { bodyEl.appendChild(mk('div', P + 'loading', getUiText('inlineDiffLoading', 'Loading diff...'))); return; }
bodyEl.appendChild(mk('div', P + 'empty', stateKind === 'binary' ? getUiText('inlineDiffBinary') : stateKind === 'sensitive' ? getUiText('inlineDiffSensitive') : getUiText('inlineDiffNoPreview')));
}

function findChipWrap(badgeEl) {
if (!badgeEl) return null;
for (let d = 0, cur = badgeEl.parentElement; d < 4 && cur; d++, cur = cur.parentElement) {
const tag = tagU(cur);
if (tag === 'BODY' || tag === 'MAIN' || (cur.classList?.contains?.('group') && cur.classList?.contains?.('w-full')) || ga(cur, 'data-testid') === 'tool-call-row') break;
if (Array.from(cur.childNodes || []).some((n) => n?.nodeType === 3 && String(n.nodeValue || '').trim().length > 0)) continue;
const kids = Array.from(cur.children || []).filter(isEl);
if (kids.length === 2) {
const other = kids.find((k) => k !== badgeEl && !k.contains?.(badgeEl)), txt = String(other?.textContent || '').trim();
const isVerb = Boolean(other && !other.querySelector?.('[data-testid="entity-pill"], .inline-pill, svg, img') && txt && !txt.includes('.') && !txt.includes('/') && !txt.includes('\\') && /^(?:created|edited|updated|deleted|modified|wrote|renamed|added|removed)$/i.test(txt));
if (other && !isVerb) return cur;
}
}
return null;
}

function syncChips() {
if (isDead() || !doc?.querySelectorAll) return;
const badges = qa(doc, S_CNT);
if (!badges.length) return;
mut(() => {
for (const b of badges) {
if (!b || cl(b, S_CHG)) continue;
const bTxt = String(b.textContent || ''), pc = b._agSyncedChip;
if (b._agSyncedTxt === bTxt && !ga(b, 'data-tooltip-id') && (!pc || (pc.isConnected !== false && ga(pc, 'data-ag-diff-chip') === '1'))) continue;
const tip = ga(b, 'data-tooltip-id');
if (tip) { b._agOrigTooltipId = tip; ra(b, 'data-tooltip-id'); }
for (const sp of b.children || []) {
if (!isEl(sp)) continue;
const st = String(sp.textContent || '').trim();
if (/^\+[1-9]\d*/.test(st)) setA(sp, 'data-ag-diff-stat', 'add');
else if (/^-[1-9]\d*/.test(st)) setA(sp, 'data-ag-diff-stat', 'del');
else if (/^[+-]?0$/.test(st)) setA(sp, 'data-ag-diff-stat', 'zero');
}
const chip = findChipWrap(b);
b._agSyncedTxt = bTxt; b._agSyncedChip = chip || null;
if (!chip) continue;
setA(chip, 'data-ag-diff-chip', '1');
for (let k = 0, anc = chip.parentElement; k < 3 && anc; k++, anc = anc.parentElement) {
if (anc.classList?.contains?.('w-full')) break;
const cls = String(anc.className || '');
if (cls.includes('overflow-hidden') || cls.includes('truncate')) setA(anc, 'data-ag-diff-chip-row', '1');
}
for (const ch of chip.children || []) {
if (!isEl(ch) || ch === b || ch.contains?.(b)) continue;
setA(ch, 'data-ag-diff-chip-file', '1');
const ct = ga(ch, 'data-tooltip-id');
if (ct) { ch._agOrigTooltipId = ct; ra(ch, 'data-tooltip-id'); }
}
}
});
}

function closeCtxMenu() {
if (!ctxMenu) return false;
const el = ctxMenu; ctxMenu = null;
mut(() => { try { el.remove(); } catch {} });
return true;
}

function openCtxMenu(ev, badgeEl) {
if (isDead() || !doc?.body || !badgeEl) return false;
closeCtxMenu();
if (win && typeof win.dispatchEvent === 'function') {
try { const C = win.CustomEvent || (typeof CustomEvent === 'function' ? CustomEvent : null); win.dispatchEvent(C ? new C('ag-prism:ctx-open', { detail: { source: 'inline-diff' } }) : { type: 'ag-prism:ctx-open', detail: { source: 'inline-diff' } }); } catch {}
}
const rowEl = findHostRow(badgeEl), isOpen = ga(badgeEl, 'data-ag-inline-diff-open') === '1', payload = extractInlineDiffPayload(badgeEl, rowEl, win);
const menu = markNoTrOwned(mk('div', 'ag-cs-diff-ctx-menu'));
sa(menu, 'role', 'menu');
const addItem = (ic, lbl, fn) => {
const b = mk('button', 'ag-cs-diff-ctx-item', null, mkSvg(ic, 13), mk('span', '', lbl));
b.type = 'button'; sa(b, 'role', 'menuitem');
b.addEventListener('click', (e) => { e.preventDefault?.(); e.stopPropagation?.(); closeCtxMenu(); fn(); });
menu.appendChild(b);
};
addItem(isOpen ? 'close' : 'chevDown', isOpen ? getUiText('inlineDiffMenuCollapse') : getUiText('inlineDiffMenuExpand'), () => toggleInlineDiffPreview(badgeEl));
addItem('external', getUiText('inlineDiffOpenSidebar'), () => { allowNative = true; try { badgeEl.click?.(); } finally { allowNative = false; } });
if (payload.uri) addItem('moreDots', getUiText('inlineDiffMenuCopyPath'), () => { try { win?.navigator?.clipboard?.writeText?.(String(payload.uri).replace(/^file:\/\/\/?/i, '')); } catch {} });
const vw = Number(win?.innerWidth) || 1280, vh = Number(win?.innerHeight) || 800;
if (menu.style) { menu.style.left = `${Math.max(8, Math.min(vw - 208, Math.round(Number(ev?.clientX) || 0)))}px`; menu.style.top = `${Math.max(8, Math.min(vh - 124, Math.round(Number(ev?.clientY) || 0)))}px`; }
mut(() => doc.body.appendChild(menu));
ctxMenu = menu;
return true;
}

function shouldAnim() {
if (!win?.requestAnimationFrame || !doc?.getElementById) return false;
if (!doc.getElementById(INLINE_DIFF_STYLE_ID) && !doc.getElementById('ag-prism-css') && !doc.getElementById('prism-style')) return false;
if ((getCfg() || {}).motionLevel === 'off' || ga(doc.documentElement, 'data-ag-cs-motion') === 'off') return false;
if (typeof win.__agPrismReducedMotion === 'function') return !win.__agPrismReducedMotion(doc, win);
return ga(doc.documentElement, 'data-ag-cs-ignore-rm') === '1' || !win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function clearBoxTimers(b) { if (b) for (const k of ['_agCloseTimer', '_agSettleTimer']) if (b[k]) { clearTimeout(b[k]); animTimers.delete(b[k]); b[k] = 0; } }

function toggleInlineDiffPreview(chipOrBadge, opts = null) {
if (isDead() || !doc || !chipOrBadge) return false;
const badgeEl = ga(chipOrBadge, 'data-testid') === 'diff-line-count' ? chipOrBadge : qs(chipOrBadge, S_CNT) || chipOrBadge;
if (!badgeEl) return false;
const rowEl = findHostRow(badgeEl);
if (!rowEl?.parentNode) return false;
const chipEl = cl(badgeEl, '[data-ag-diff-chip="1"]') || findChipWrap(badgeEl);
const AO = 'data-ag-inline-diff-open', AH = 'data-ag-inline-diff-host', AA = 'data-ag-diff-anim', AS = 'data-ag-diff-state', BC = P + 'box';
const nextSib = rowEl.nextElementSibling, noAnim = Boolean(opts && opts.noAnim === true), allowAnim = !noAnim && shouldAnim();
const schedSettle = (b, chk) => {
const tid = setTimeout(() => { animTimers.delete(tid); b._agSettleTimer = 0; if (!isDead() && b.isConnected !== false && (!chk || ga(b, AS) === 'open')) mut(() => ra(b, AA)); }, 165);
b._agSettleTimer = tid; animTimers.add(tid);
};
if (nextSib?.classList?.contains(BC) && nextSib._agDiffBadge === badgeEl) {
if ((ga(nextSib, AS) || 'open') === 'closing') {
if (opts && opts.closeOnly) return true;
clearBoxTimers(nextSib);
mut(() => { if (allowAnim) sa(nextSib, AA, '1'); sa(nextSib, AS, 'open'); sa(badgeEl, AO, '1'); if (chipEl) sa(chipEl, AO, '1'); sa(rowEl, AH, '1'); });
if (allowAnim) schedSettle(nextSib, false);
stats.inlineDiffToggleCount++;
return true;
}
if (opts && opts.openOnly) return true;
clearBoxTimers(nextSib);
nextSib._agDiffReqId = 0;
if (allowAnim) {
mut(() => { ra(badgeEl, AO); if (chipEl) ra(chipEl, AO); sa(nextSib, AA, '1'); sa(nextSib, AS, 'closing'); });
const tid = setTimeout(() => { animTimers.delete(tid); nextSib._agCloseTimer = 0; if (!isDead()) mut(() => { if (nextSib.parentNode) nextSib.remove(); if (!rowEl.nextElementSibling?.classList?.contains(BC)) ra(rowEl, AH); }); }, 130);
nextSib._agCloseTimer = tid; animTimers.add(tid);
} else mut(() => { nextSib.remove(); ra(badgeEl, AO); if (chipEl) ra(chipEl, AO); ra(rowEl, AH); });
stats.inlineDiffToggleCount++;
return true;
}
if (opts && opts.closeOnly) return false;
const payload = extractInlineDiffPayload(badgeEl, rowEl, win);
if (!payload.lines.length && !(payload.uri && typeof win?.__agPrismInlineDiffCall === 'function')) return false;
const stepStats = { additions: payload.additions || 0, deletions: payload.deletions || 0 };
const openSb = () => { allowNative = true; try { badgeEl.click?.(); } finally { allowNative = false; } };
const topBar = createTopBar(payload.fileName, stepStats, payload.lines.length ? payload.source || 'step-patch' : '', openSb, () => toggleInlineDiffPreview(badgeEl, { closeOnly: true, noAnim }));
const body = mk('div', P + 'body'), box = markNoTrOwned(mk('div', BC, null, mk('div', P + 'card', null, topBar.barEl, body)));
sa(box, 'data-ag-cs-inline-diff', '1'); box._agDiffBadge = badgeEl; box._agDiffReqId = 0;
const applyResp = (resp) => {
if (resp?.ok && Array.isArray(resp.lines) && resp.lines.length > 0) {
const a = resp.mode === 'snapshot' ? stepStats.additions : (resp.additions || stepStats.additions);
const d = resp.mode === 'snapshot' ? stepStats.deletions : (resp.deletions || stepStats.deletions);
topBar.update(resp.fileName || payload.fileName, a, d, resp.mode || 'git-diff');
renderBody(body, resp.lines, 'lines', resp.mode, stepStats, resp, openSb);
} else {
topBar.update(resp?.fileName || payload.fileName, stepStats.additions, stepStats.deletions, '');
renderBody(body, [], resp?.mode === 'binary' ? 'binary' : resp?.error === 'blocked_sensitive' ? 'sensitive' : 'empty');
}
};
let pendingRpc = null;
if (payload.lines.length) renderBody(body, payload.lines, 'lines', payload.source || 'step-patch', stepStats, null, openSb);
else {
pendingRpc = requestDaemon(payload.uri, stepStats);
if (pendingRpc?.cached) { applyResp(pendingRpc.cached); pendingRpc = null; }
else { renderBody(body, [], 'loading'); if (pendingRpc) box._agDiffReqId = pendingRpc.reqId; }
}
sa(box, AS, 'open');
if (allowAnim) sa(box, AA, '1');
mut(() => {
if (nextSib?.classList?.contains(BC)) { clearBoxTimers(nextSib); nextSib._agDiffReqId = 0; nextSib.remove(); }
rowEl.parentNode.insertBefore(box, rowEl.nextElementSibling || null);
sa(badgeEl, AO, '1'); if (chipEl) sa(chipEl, AO, '1'); sa(rowEl, AH, '1');
});
if (allowAnim) schedSettle(box, true);
if (pendingRpc) { const eid = pendingRpc.reqId; pendingRpc.promise.then((r) => { if (!isDead() && box.isConnected !== false && box._agDiffReqId === eid) mut(() => applyResp(r)); }); }
stats.inlineDiffToggleCount++;
return true;
}

function resolveBadge(t) {
if (!t?.closest) return null;
const d = cl(t, S_CNT);
if (d && !cl(d, S_CHG)) return d;
const b = qs(cl(t, '[data-ag-diff-chip="1"]'), S_CNT);
return b && !cl(b, S_CHG) ? b : cl(t, _C + 'box')?._agDiffBadge || null;
}
const clearHover = () => { if (hoverTmr) { clearTimeout(hoverTmr); hoverTmr = 0; } };
const onClick = (ev) => {
try {
const t = ev?.target;
if (isDead() || !t?.closest) return;
if (ctxMenu && !cl(t, '.ag-cs-diff-ctx-menu')) closeCtxMenu();
if (!allowNative && !cl(t, _C + 'box')) { const db = resolveBadge(t); if (db) { if (toggleInlineDiffPreview(db)) { ev.preventDefault?.(); ev.stopPropagation?.(); } return; } }
if (cl(t, 'button, [role="button"]')) { if (syncTmr) clearTimeout(syncTmr); syncTmr = setTimeout(() => { syncTmr = 0; if (!isDead()) syncChips(); }, 24); }
} catch {}
};
const onPtrDown = (ev) => { try { if (!isDead() && ctxMenu && (!ev?.target?.closest || !cl(ev.target, '.ag-cs-diff-ctx-menu'))) closeCtxMenu(); } catch {} };
const onCtxMenu = (ev) => {
try {
if (isDead() || !ev?.target?.closest) return;
const t = ev.target, db = resolveBadge(t);
if (!db || ev.shiftKey) { closeCtxMenu(); return; }
if (cl(t, _C + 'box') && String(win?.getSelection?.() || '').trim().length > 0) { closeCtxMenu(); return; }
if (openCtxMenu(ev, db)) { ev.preventDefault?.(); ev.stopPropagation?.(); }
} catch {}
};
const onKeyDown = (ev) => { try { if (!isDead() && ev?.key === 'Escape' && ctxMenu && closeCtxMenu()) { ev.preventDefault?.(); ev.stopPropagation?.(); } } catch {} };
const onPtrOver = (ev) => {
try {
const t = ev?.target;
if (isDead() || !t?.closest) return;
if (typeof win?.__agPrismInlineDiffCall !== 'function') { clearHover(); return; }
const hit = cl(t, `${_C}box, ${S_CNT}, [data-ag-diff-chip="1"]`);
if (!hit || hit.classList?.contains?.(P + 'box') || cl(hit, S_CHG)) { clearHover(); return; }
const db = ga(hit, 'data-testid') === 'diff-line-count' ? hit : qs(hit, S_CNT);
if (!db || ga(db, 'data-ag-inline-diff-open') === '1') { clearHover(); return; }
clearHover();
hoverTmr = setTimeout(() => {
hoverTmr = 0;
if (isDead() || db.isConnected === false) return;
const p = extractInlineDiffPayload(db, null, win);
if (p.uri && !p.lines.length) requestDaemon(p.uri, { additions: p.additions || 0, deletions: p.deletions || 0 });
}, 110);
} catch {}
};
const onPtrOut = (ev) => { try { if (hoverTmr && (!ev?.relatedTarget?.closest || !resolveBadge(ev.relatedTarget))) clearHover(); } catch {} };
const onScroll = (ev) => { try { if (ctxMenu && !(ev?.target && ctxMenu.contains?.(ev.target))) closeCtxMenu(); } catch {} };
const onBlur = () => { try { if (ctxMenu) closeCtxMenu(); } catch {} };
const onBus = (ev) => { try { if (ev?.detail?.source !== 'inline-diff') closeCtxMenu(); } catch {} };
const EVS = [['click', onClick, true], ['pointerdown', onPtrDown, true], ['contextmenu', onCtxMenu, true], ['keydown', onKeyDown, true], ['pointerover', onPtrOver, { passive: true }], ['pointerout', onPtrOut, { passive: true }], ['scroll', onScroll, { capture: true, passive: true }], ['blur', onBlur, false], ['resize', onBlur, false], ['ag-prism:ctx-open', onBus, false]];
if (win && typeof win.addEventListener === 'function') for (const [t, fn, o] of EVS) win.addEventListener(t, fn, o);
ensureStyle();

function unbindHooks() { hookT = baseT; hookGetLang = baseGetLang; hookMut = baseMut; hookSetA = baseSetA; }
function sync(nextCfg, hooks) {
if (isDead()) return;
if (nextCfg && typeof nextCfg === 'object') cfg = { ...cfg, ...nextCfg };
if (hooks && typeof hooks === 'object') {
if (typeof hooks.t === 'function') hookT = hooks.t;
if (typeof hooks.getLang === 'function') hookGetLang = hooks.getLang;
if (typeof hooks.runGuardedMut === 'function') hookMut = hooks.runGuardedMut;
if (typeof hooks.setAttrIfChanged === 'function') hookSetA = hooks.setAttrIfChanged;
}
ensureStyle(); syncChips();
}
function destroy() {
if (dead) return;
dead = true;
for (const tid of animTimers) clearTimeout(tid);
animTimers.clear(); clearHover();
if (syncTmr) { clearTimeout(syncTmr); syncTmr = 0; }
closeCtxMenu();
for (const e of pending.values()) { if (e?.timer) clearTimeout(e.timer); try { e?.resolve?.(null); } catch {} }
pending.clear(); inflight.clear(); cache.clear();
if (win && win.__agPrismInlineDiffResolve === onResolve) { try { delete win.__agPrismInlineDiffResolve; } catch {} }
if (win && typeof win.removeEventListener === 'function') for (const [t, fn, o] of EVS) { try { win.removeEventListener(t, fn, o); } catch {} }
if (doc && typeof doc.querySelectorAll === 'function') {
mut(() => {
for (const s of [_C + 'box', '.ag-cs-diff-ctx-menu']) qa(doc, s).forEach((n) => n.remove());
qa(doc, `${S_CNT}, [data-ag-diff-chip-file="1"]`).forEach((el) => {
if (el._agOrigTooltipId) { sa(el, 'data-tooltip-id', el._agOrigTooltipId); delete el._agOrigTooltipId; }
delete el._agSyncedTxt; delete el._agSyncedChip;
});
for (const k of 'diff-chip|diff-chip-file|diff-chip-row|diff-stat|inline-diff-open|inline-diff-host|diff-anim|diff-state|cs-inline-diff'.split('|')) qa(doc, `[data-ag-${k}]`).forEach((el) => ra(el, 'data-ag-' + k));
});
}
mut(() => { try { ((typeof doc?.getElementById === 'function' ? doc.getElementById(INLINE_DIFF_STYLE_ID) : null) || styleEl)?.remove?.(); } catch {} });
styleEl = null; unbindHooks();
if (win && win.__agPrismInlineDiff === selfApi) { try { delete win.__agPrismInlineDiff; } catch {} }
if (G && G.__agPrismInlineDiff === selfApi) { try { delete G.__agPrismInlineDiff; } catch {} }
}

selfApi = {
sync, unbindHooks, toggleInlineDiffPreview, closeMenuIfOpen: closeCtxMenu,
getDebugState: () => ({ inlineDiffToggleCount: stats.inlineDiffToggleCount, cacheSize: cache.size, pendingSize: pending.size, menuOpen: Boolean(ctxMenu), styleMounted: Boolean(doc?.getElementById?.(INLINE_DIFF_STYLE_ID)), destroyed: Boolean(dead) }),
destroy, extractInlineDiffPayload: (b, r) => extractInlineDiffPayload(b, r, win),
};
return selfApi;
}

const W = typeof window !== 'undefined' ? window : G, D = typeof document !== 'undefined' ? document : W?.document || null;
if (W) { try { W.__agPrismInlineDiffFactory = createInlineDiffClient; } catch {} }
if (G && G !== W) { try { G.__agPrismInlineDiffFactory = createInlineDiffClient; } catch {} }
if (W && D && typeof D.createElement === 'function') {
try { W.__agPrismInlineDiff?.destroy?.(); } catch {}
try { const inst = createInlineDiffClient({ win: W, doc: D }); W.__agPrismInlineDiff = inst; if (G && G !== W) G.__agPrismInlineDiff = inst; inst.sync(); } catch {}
}
if (typeof module === 'object' && module.exports) {
module.exports = { STYLE_ID: INLINE_DIFF_STYLE_ID, INLINE_DIFF_CSS, parseUnifiedDiffLines, buildPairDiffLines, extractInlineDiffPayload, createInlineDiffClient };
}
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
