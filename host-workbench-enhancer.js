// Obsidian Prism — Host Workbench Deep-Surface Enhancer (host-workbench-enhancer.js)
// 1. Cross-origin zero-intrusion Sidecar UI (`plugin://*` Swarm / Pulse) 4-theme postMessage bridge (0fps idle).
// 2. Code block glass sticky header companion + manual [Fold (N lines)] / [Expand] toggle (>= 48 lines, scrollTop anchored, zero auto-fold).
// 3. Long-conversation rail (`[data-testid="conversation-navigator"]`) hover outline popover (prompt filter, chapter delegation, fold historical steps) + Alt+Up/Down instant turn jump.

(function (root) {
  'use strict';
  const G = root || (typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : null);
  if (!G) return;

  const MIN_CODE_FOLD_LINES = 48;
  const SONAR_DURATION_MS = 720;
  const OUTLINE_HIDE_DELAY_MS = 220;
  function markNoTr(e) {
    if (e && e.setAttribute) for (const s of 'translate=no,data-no-translate=true,data-ag-localization-skip=true,data-agy-no-translate=true,data-antigravity-zh-skip=1'.split(',')) { const p = s.split('='); e.setAttribute(p[0], p[1]); }
    return e;
  }

  const SIDECAR_THEME_VARS = [
    '--background',
    '--content',
    '--shell',
    '--body-background',
    '--sidebar',
    '--sidebar-muted',
    '--sidebar-secondary',
    '--card',
    '--card-border',
    '--border',
    '--secondary',
    '--secondary-foreground',
    '--muted',
    '--muted-foreground',
    '--foreground',
    '--placeholder',
    '--primary',
    '--primary-foreground',
    '--accent',
    '--link',
    '--error',
    '--warning',
    '--success',
    '--scrim',
  ];

  const UI_STRINGS = {
    zh: {
      foldCode: (n) => `折叠 (${n}行)`,
      expandCode: (n) => `展开 (${n}行)`,
      outlineTitle: (n) => `提问导航 · ${n} 轮`,
      foldSteps: '收起步骤',
      foldedFeedback: (n) => (n > 0 ? `已收起 ${n} 项` : '已是最简'),
      searchPlaceholder: '过滤本会话提问...',
      emptyMatch: '无匹配提问',
      chapterBadge: '章节',
    },
    'zh-TW': {
      foldCode: (n) => `摺疊 (${n}行)`,
      expandCode: (n) => `展開 (${n}行)`,
      outlineTitle: (n) => `提問導覽 · ${n} 輪`,
      foldSteps: '收起步驟',
      foldedFeedback: (n) => (n > 0 ? `已收起 ${n} 項` : '已是最簡'),
      searchPlaceholder: '過濾本會話提問...',
      emptyMatch: '無匹配提問',
      chapterBadge: '章節',
    },
    yue: {
      foldCode: (n) => `摺埋 (${n}行)`,
      expandCode: (n) => `展開 (${n}行)`,
      outlineTitle: (n) => `提問導覽 · ${n} 輪`,
      foldSteps: '收埋步驟',
      foldedFeedback: (n) => (n > 0 ? `已收埋 ${n} 項` : '已係最簡'),
      searchPlaceholder: '篩選呢個對話嘅提問...',
      emptyMatch: '冇符合嘅提問',
      chapterBadge: '章節',
    },
    ja: {
      foldCode: (n) => `折りたたむ (${n}行)`,
      expandCode: (n) => `展開 (${n}行)`,
      outlineTitle: (n) => `プロンプト目次 · ${n}`,
      foldSteps: '手順を畳む',
      foldedFeedback: (n) => (n > 0 ? `${n}件畳みました` : '完了'),
      searchPlaceholder: '質問を絞り込む...',
      emptyMatch: '一致なし',
      chapterBadge: '章',
    },
    ko: {
      foldCode: (n) => `접기 (${n}줄)`,
      expandCode: (n) => `펼치기 (${n}줄)`,
      outlineTitle: (n) => `질문 목차 · ${n}`,
      foldSteps: '단계 접기',
      foldedFeedback: (n) => (n > 0 ? `${n}개 접힘` : '완료'),
      searchPlaceholder: '질문 검색...',
      emptyMatch: '일치 항목 없음',
      chapterBadge: '챕터',
    },
    en: {
      foldCode: (n) => `Fold (${n}L)`,
      expandCode: (n) => `Expand (${n}L)`,
      outlineTitle: (n) => `Prompts · ${n} turns`,
      foldSteps: 'Fold Steps',
      foldedFeedback: (n) => (n > 0 ? `Folded ${n}` : 'All clean'),
      searchPlaceholder: 'Filter prompts...',
      emptyMatch: 'No matching prompts',
      chapterBadge: 'Chapter',
    },
  };

  function isElementLike(n) {
    return Boolean(n && (n.nodeType === 1 || (n.nodeType === undefined && typeof n.tagName === 'string')));
  }

  function resolveLocalePack(langRaw) {
    const l = String(langRaw || '').trim();
    if (/^yue\b|^zh[-_](hk|mo)/i.test(l)) return UI_STRINGS.yue;
    if (/^zh[-_](tw|hant)/i.test(l)) return UI_STRINGS['zh-TW'];
    if (/^zh/i.test(l)) return UI_STRINGS.zh;
    if (/^ja/i.test(l)) return UI_STRINGS.ja;
    if (/^ko/i.test(l)) return UI_STRINGS.ko;
    return UI_STRINGS.en;
  }

  function isEditableElement(el) {
    if (!el) return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.getAttribute?.('contenteditable') === 'true' || el.isContentEditable === true) return true;
    if (el.closest?.('[contenteditable="true"], input, textarea, select, [role="textbox"]')) return true;
    return false;
  }

  function createHostEnhancerController(options = {}) {
    const doc = options.doc || (typeof document !== 'undefined' ? document : null);
    const win = options.win || (typeof window !== 'undefined' ? window : null);
    const getLang =
      typeof options.getLang === 'function'
        ? options.getLang
        : () => doc?.documentElement?.getAttribute?.('data-ag-cs-lang') || 'en';
    const getConfig = typeof options.getConfig === 'function' ? options.getConfig : () => ({});
    const extIsDestroyed = typeof options.isDestroyed === 'function' ? options.isDestroyed : () => false;
    const extIsConvRunning = typeof options.isConvRunning === 'function' ? options.isConvRunning : null;
    const runGuardedMut = typeof options.runGuardedMut === 'function' ? options.runGuardedMut : (fn) => fn();
    const setAttrIfChanged =
      typeof options.setAttrIfChanged === 'function'
        ? options.setAttrIfChanged
        : (el, name, val) => {
            if (el && el.getAttribute?.(name) !== val) el.setAttribute?.(name, val);
          };

    let localDestroyed = false;
    const isDead = () => localDestroyed || extIsDestroyed();

    // ── Internal State & Cleanups ──────────────────────────────────────────
    let cachedAttrKey = '';
    let cachedThemeSample = null;
    let lastSyncedLang = '';
    let iframePushedSig = new WeakMap();
    let iframeSizeCache = new WeakMap();
    const boundIframes = new WeakSet();
    const iframeUnsubscribers = [];
    let iframeRo = null;

    const pruneUnsubs = (list, all, boundSet) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const rec = list[i];
        if (all || (rec && rec.el && rec.el.isConnected === false)) {
          list.splice(i, 1);
          if (rec?.el && boundSet) boundSet.delete(rec.el);
          try { (typeof rec === 'function' ? rec : rec?.unsub)?.(); } catch {}
        }
      }
    };

    const codeLineCache = new WeakMap();
    const preSyncCache = new WeakMap();
    let cachedConvView = null;
    let lastOutlineStreamSyncAt = 0;

    const boundNavRails = new WeakSet();
    const navRailUnsubscribers = [];
    let activeNavRail = null;
    let outlinePopover = null;
    let outlineSearchInput = null;
    let outlineListEl = null;
    let outlineTitleEl = null;
    let outlineFoldBtn = null;
    let outlineFilterText = '';
    let outlineOpen = false;
    let lastOutlineStructSig = '';
    let lastOutlineActiveIdx = -1;
    let activeOutlineBtn = null;
    const outlineItemBtnByIdx = new Map();
    let hideOutlineTimer = 0;
    let foldFeedbackTimer = 0;
    const sonarTimers = new Set();

    const stats = {
      postMessageCount: 0,
      themeSampleCount: 0,
      foldedCodeBlocks: 0,
      jumpCount: 0,
      foldedStepsLastRun: 0,
    };

    function getStrings() {
      return resolveLocalePack(getLang());
    }

    function checkConvRunning() {
      if (extIsConvRunning) return Boolean(extIsConvRunning());
      if (!doc || typeof doc.querySelector !== 'function') return false;
      return Boolean(
        doc.querySelector(
          '[data-testid="agent-input-box"] [data-testid="input-cancel-button"], [data-testid="agent-input-box"] [data-testid="stop-button"]'
        )
      );
    }

    function findPrimaryConvView() {
      if (
        cachedConvView &&
        cachedConvView.isConnected !== false &&
        !cachedConvView.closest?.('[data-testid="subagent-tab-conversation"]') &&
        !cachedConvView.closest?.('.agy-home') &&
        !cachedConvView.querySelector?.('.agy-home')
      ) {
        return cachedConvView;
      }
      if (!doc || typeof doc.querySelectorAll !== 'function') return null;
      const views = doc.querySelectorAll('[data-testid="conversation-view"]');
      for (let i = 0; i < views.length; i++) {
        const cv = views[i];
        if (cv.closest?.('[data-testid="subagent-tab-conversation"]')) continue;
        if (cv.closest?.('.agy-home') || cv.querySelector?.('.agy-home')) continue;
        cachedConvView = cv;
        return cv;
      }
      cachedConvView = views.length > 0 ? views[0] : null;
      return cachedConvView;
    }

    function findScrollViewport(startEl) {
      if (startEl?.closest) {
        const vp = startEl.closest('[data-testid="autoscroll-viewport"]');
        if (vp) return vp;
      }
      const cv = findPrimaryConvView();
      if (cv?.querySelector) {
        const vp = cv.querySelector('[data-testid="autoscroll-viewport"]');
        if (vp) return vp;
      }
      return doc?.querySelector?.('[data-testid="autoscroll-viewport"]') || null;
    }

    // ── 1. Sidecar (`plugin://*`) 4-Theme PostMessage Bridge ───────────────
    function readRootAttrKey() {
      const html = doc?.documentElement;
      if (!html) return '';
      const cfg = getConfig() || {};
      return [
        html.getAttribute?.('data-ag-cs-style') || '',
        html.getAttribute?.('data-ag-cs-theme') || '',
        html.getAttribute?.('data-ag-cs-palette') || '',
        html.getAttribute?.('data-ag-cs-light-preset') || '',
        html.getAttribute?.('data-ag-cs-accent') || '',
        html.getAttribute?.('data-ag-cs-corners') || '',
        html.getAttribute?.('data-ag-cs-code-font') || '',
        String(html.getAttribute?.('style') || '').slice(0, 180),
        String(doc?.body?.className || ''),
        cfg.palette || '',
        cfg.lightPreset || '',
        cfg.accentTone || '',
      ].join('|');
    }

    function sampleRootTheme(force = false) {
      const html = doc?.documentElement;
      if (!html || !win || typeof win.getComputedStyle !== 'function') return null;
      const nextAttrKey = readRootAttrKey();
      if (!force && cachedThemeSample && cachedAttrKey === nextAttrKey) {
        return cachedThemeSample;
      }

      stats.themeSampleCount += 1;
      const cs = win.getComputedStyle(html);
      const vars = {};
      const sigParts = [];
      for (let i = 0; i < SIDECAR_THEME_VARS.length; i++) {
        const key = SIDECAR_THEME_VARS[i];
        const val = String(cs.getPropertyValue(key) || '').trim();
        if (val) {
          vars[key] = val;
          sigParts.push(`${key}:${val}`);
        }
      }
      if (!vars['--accent'] && vars['--primary']) {
        vars['--accent'] = vars['--primary'];
        sigParts.push(`--accent:${vars['--accent']}`);
      }

      const explicitTheme = html.getAttribute?.('data-ag-cs-theme');
      const bodyCls = String(doc?.body?.className || '');
      const scheme = String(cs.getPropertyValue('color-scheme') || '').toLowerCase();
      const isLight =
        explicitTheme === 'light' ||
        /\b(?:theme-light|light-theme|light)\b/.test(bodyCls) ||
        (explicitTheme !== 'dark' && scheme.includes('light') && !scheme.includes('dark'));
      const themeType = isLight ? 'light' : 'dark';
      const pal = html.getAttribute?.('data-ag-cs-palette') || 'obsidian';
      const lp = html.getAttribute?.('data-ag-cs-light-preset') || 'crystal';
      const effectiveLp = pal === 'warm' || pal === 'claude' ? 'alabaster' : lp;
      const themeLabel = isLight ? (pal === 'host' ? 'prism-host-light' : `prism-${effectiveLp}`) : `prism-${pal}`;
      const sig = `${themeType}|${themeLabel}|${sigParts.join(';')}`;

      cachedAttrKey = nextAttrKey;
      cachedThemeSample = { themeType, themeLabel, vars, sig };
      return cachedThemeSample;
    }

    function resolveIframeTargetOrigin(iframe) {
      const raw = String(iframe?.getAttribute?.('src') ?? iframe?.src ?? '').trim();
      if (!raw) return null;
      const low = raw.toLowerCase();
      if (low.startsWith('plugin://') || low.startsWith('vscode-webview://')) return '*';
      if (/^https?:\/\//i.test(raw)) {
        const m = /^(https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)(?:[/?#]|$)/i.exec(raw);
        if (!m) return null;
        if (typeof URL === 'function') {
          try {
            const u = new URL(raw);
            const h = u.hostname.toLowerCase();
            return h === '127.0.0.1' || h === 'localhost' ? u.origin : null;
          } catch {
            return null;
          }
        }
        return m[1].toLowerCase();
      }
      if (raw.startsWith('//') || raw.startsWith('\\') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
      const lo = win?.location?.origin;
      return lo && /^https?:\/\//i.test(lo) ? lo : '*';
    }

    function pushThemeToIframe(iframe, sample, force = false) {
      if (!iframe || !sample) return false;
      if (!force && iframePushedSig.get(iframe) === sample.sig) return false;
      const targetOrigin = resolveIframeTargetOrigin(iframe);
      if (!targetOrigin) return false;
      const cw = iframe.contentWindow;
      if (!cw || typeof cw.postMessage !== 'function') return false;
      try {
        cw.postMessage(
          {
            type: 'theme-change',
            payload: {
              theme: sample.themeLabel,
              themeType: sample.themeType,
              cssVariables: { ...sample.vars },
            },
          },
          targetOrigin
        );
        iframePushedSig.set(iframe, sample.sig);
        stats.postMessageCount += 1;
        return true;
      } catch {
        return false;
      }
    }

    function querySidecarIframes() {
      if (!doc || typeof doc.querySelectorAll !== 'function') return [];
      const set = new Set();
      doc.querySelectorAll('iframe[data-testid="sidecar-iframe"]').forEach((f) => set.add(f));
      doc.querySelectorAll('[data-testid="sidecar-iframe-slot"] iframe').forEach((f) => set.add(f));
      return Array.from(set);
    }

    function isIframeHidden(f, rectHint = null) {
      if (!f || f.hidden === true || f.getAttribute?.('aria-hidden') === 'true') return true;
      const cached =
        rectHint && (rectHint.width !== undefined || rectHint.height !== undefined)
          ? rectHint
          : iframeSizeCache.get(f);
      const r = cached || f.getBoundingClientRect?.();
      return Boolean(r && r.width <= 0 && r.height <= 0);
    }

    function pushIfVis(f, force, rectHint = null) {
      if (isDead() || isIframeHidden(f, rectHint)) return;
      const s = sampleRootTheme(false);
      if (s) pushThemeToIframe(f, s, force);
    }

    function syncSidecarThemeBridge(forceSample = false) {
      if (isDead() || !doc) return;
      const iframes = querySidecarIframes();
      if (!iframes.length) {
        if (forceSample) sampleRootTheme(true);
        return;
      }
      pruneUnsubs(iframeUnsubscribers, false, boundIframes);
      if (!iframeRo && win?.ResizeObserver) {
        iframeRo = new win.ResizeObserver((es) => {
          if (isDead()) return;
          for (const e of es || []) {
            const f = e?.target;
            if (!f) continue;
            const cr = e?.contentRect;
            if (cr && (cr.width !== undefined || cr.height !== undefined)) {
              iframeSizeCache.set(f, { width: cr.width, height: cr.height });
              if (cr.width > 0 || cr.height > 0) pushIfVis(f, false, cr);
            } else {
              iframeSizeCache.delete(f);
              pushIfVis(f, false);
            }
          }
        });
      }
      const vis = [];
      for (const frame of iframes) {
        if (!boundIframes.has(frame) && frame.addEventListener) {
          boundIframes.add(frame);
          const onLoad = () => { iframePushedSig.delete(frame); pushIfVis(frame, true); };
          frame.addEventListener('load', onLoad);
          try { iframeRo?.observe?.(frame); } catch {}
          iframeUnsubscribers.push({
            el: frame,
            unsub: () => {
              iframeSizeCache.delete(frame);
              try { frame.removeEventListener('load', onLoad); } catch {}
              try { iframeRo?.unobserve?.(frame); } catch {}
            },
          });
        }
        if (!isIframeHidden(frame)) vis.push(frame);
      }
      if (!vis.length) {
        if (forceSample) sampleRootTheme(true);
        return;
      }
      const need =
        forceSample ||
        !cachedThemeSample ||
        cachedAttrKey !== readRootAttrKey() ||
        vis.some((f) => iframePushedSig.get(f) !== cachedThemeSample.sig);
      const sample = need ? sampleRootTheme(forceSample) : cachedThemeSample;
      if (sample) for (const f of vis) pushThemeToIframe(f, sample, false);
    }

    function refreshOutlineLocaleTexts() {
      const ui = getStrings();
      runGuardedMut(() => {
        if (outlineSearchInput) outlineSearchInput.placeholder = ui.searchPlaceholder;
        if (outlineFoldBtn && !foldFeedbackTimer) outlineFoldBtn.textContent = ui.foldSteps;
      });
      if (outlineOpen) {
        renderOutlinePopover();
      } else if (outlinePopover && outlineListEl) {
        renderOutlineListOnly();
      }
    }

    function onThemeChange(force = true) {
      if (isDead()) return;
      lastSyncedLang = String(getLang() || '');
      if (force) iframePushedSig = new WeakMap();
      syncSidecarThemeBridge(Boolean(force));
      refreshCodeFoldLabels();
      refreshOutlineLocaleTexts();
    }

    // ── 2. Code Block Sticky Header & Manual Fold (>= 48 Lines) ────────────
    function resolveCodeCardParts(pre) {
      if (!isElementLike(pre)) return null;
      const card = pre.firstElementChild;
      if (!isElementLike(card) || String(card.tagName || '').toUpperCase() !== 'DIV') return null;
      const kids = card.children;
      if (!kids || kids.length < 2) return null;
      const header = kids[0];
      const body = kids[1];
      if (!isElementLike(header) || !isElementLike(body)) return null;
      const hdrCls = String(header.className || '');
      const hasHeaderShape =
        hdrCls.includes('border-b') ||
        hdrCls.includes('justify-between') ||
        Boolean(header.querySelector?.('button'));
      if (!hasHeaderShape) return null;
      return { card, header, body };
    }

    function countCodeLines(bodyEl) {
      if (!bodyEl) return 0;
      if (typeof bodyEl.querySelectorAll === 'function') {
        const lineNodes = bodyEl.querySelectorAll('.code-line');
        if (lineNodes && lineNodes.length > 0) return lineNodes.length;
      }
      const rawText = String(bodyEl.textContent || '');
      const len = rawText.length;
      const cached = codeLineCache.get(bodyEl);
      if (cached && cached.textLen === len) return cached.lineCount;
      let count = 0;
      const end = len > 0 && rawText.charCodeAt(len - 1) === 10 ? len - 1 : len;
      if (end > 0) {
        count = 1;
        let pos = 0;
        while ((pos = rawText.indexOf('\n', pos)) !== -1 && pos < end) {
          count += 1;
          pos += 1;
        }
      }
      codeLineCache.set(bodyEl, { textLen: len, lineCount: count });
      return count;
    }

    function formatFoldBtnLabel(folded, lineCount) {
      const ui = getStrings();
      return folded ? ui.expandCode(lineCount) : ui.foldCode(lineCount);
    }

    function toggleCodeCardFold(card, btn) {
      if (!card || !btn) return;
      const lineCount = parseInt(btn.getAttribute('data-lines') || '0', 10) || MIN_CODE_FOLD_LINES;
      const isCurrentlyFolded = card.getAttribute('data-ag-cs-code-folded') === '1';

      if (!isCurrentlyFolded) {
        const vp = findScrollViewport(card);
        const cardRect = typeof card.getBoundingClientRect === 'function' ? card.getBoundingClientRect() : null;
        const vpRect = vp && typeof vp.getBoundingClientRect === 'function' ? vp.getBoundingClientRect() : null;

        runGuardedMut(() => {
          card.setAttribute('data-ag-cs-code-folded', '1');
          btn.setAttribute('aria-expanded', 'false');
          btn.textContent = formatFoldBtnLabel(true, lineCount);
        });
        stats.foldedCodeBlocks += 1;

        // Anchor scrollTop back to block top when collapsing a tall block whose header scrolled above viewport
        if (vp && cardRect && vpRect && cardRect.top < vpRect.top) {
          const delta = Math.round(cardRect.top - vpRect.top - 12);
          vp.scrollTop = Math.max(0, (vp.scrollTop || 0) + delta);
        }
      } else {
        runGuardedMut(() => {
          card.removeAttribute('data-ag-cs-code-folded');
          btn.setAttribute('aria-expanded', 'true');
          btn.textContent = formatFoldBtnLabel(false, lineCount);
        });
      }
    }

    function getPreBodyStamp(body) {
      if (!body) return '';
      const ch = body.children;
      const cLen = ch ? ch.length : 0;
      if (cLen > 1) {
        const first = ch[0];
        const firstSub = first?.children;
        const firstSig = firstSub && firstSub.length > 0 ? `n${firstSub.length}` : String(first?.textContent || '').length;
        const last = ch[cLen - 1];
        return `c:${cLen}:${firstSig}:${String(last?.textContent || '').length}`;
      }
      const target = cLen === 1 ? ch[0] : body;
      const sub = target.children;
      if (sub && sub.length > 1) {
        return `s:${sub.length}:${String(sub[sub.length - 1]?.textContent || '').length}`;
      }
      return `t:${String(target.textContent || '').length}`;
    }

    function hasFollowingSiblingInResp(pre, resp) {
      if (!pre || !resp) return false;
      let cur = pre;
      while (cur && cur !== resp) {
        if (cur.nextElementSibling) return true;
        cur = cur.parentElement;
      }
      return false;
    }

    function syncCodeBlocks() {
      if (isDead() || !doc || typeof doc.querySelectorAll !== 'function') return;
      const conv = findPrimaryConvView();
      const responses =
        conv && typeof conv.querySelectorAll === 'function'
          ? conv.querySelectorAll('[data-testid="planner-response-text"], [data-testid="agent-response"]')
          : null;
      const lastResp = responses && responses.length > 0 ? responses[responses.length - 1] : null;
      const isRunning = checkConvRunning();
      let streamingPre = null;
      if (isRunning && lastResp) {
        const rPres = lastResp.querySelectorAll?.('pre');
        const tailPre = rPres && rPres.length > 0 ? rPres[rPres.length - 1] : null;
        if (tailPre && !hasFollowingSiblingInResp(tailPre, lastResp)) streamingPre = tailPre;
      }

      const pres = doc.querySelectorAll(
        '[data-testid="planner-response-text"] pre, [data-testid="agent-response"] pre, [data-testid="artifact-view"] pre'
      );
      if (!pres || pres.length === 0) return;
      const curLang = lastSyncedLang || String(getLang() || '');

      runGuardedMut(() => {
        for (let i = 0; i < pres.length; i++) {
          const pre = pres[i];
          if (pre === streamingPre) {
            // 流式尾块提前短路，仅首帧保留单边框属性避免双重边框闪烁
            if (
              pre.getAttribute?.('data-ag-cs-rich-pre') !== '1' &&
              String(pre.firstElementChild?.tagName || '').toUpperCase() === 'DIV'
            ) {
              setAttrIfChanged(pre, 'data-ag-cs-rich-pre', '1');
            }
            continue;
          }
          const prevRec = preSyncCache.get(pre);
          const recValid =
            prevRec &&
            prevRec.lang === curLang &&
            prevRec.header?.getAttribute?.('data-ag-cs-code-sticky') === '1' &&
            (prevRec.lineCount < MIN_CODE_FOLD_LINES || (prevRec.btn && prevRec.btn.isConnected !== false && prevRec.btn.parentElement));
          if (recValid && prevRec.sealed) continue;
          let hasDirectDiv = false;
          const chs = pre.children;
          if (chs) {
            for (let ci = 0; ci < chs.length; ci++) {
              if (String(chs[ci]?.tagName || '').toUpperCase() === 'DIV') { hasDirectDiv = true; break; }
            }
          }
          if (hasDirectDiv) setAttrIfChanged(pre, 'data-ag-cs-rich-pre', '1');
          else if (pre.hasAttribute?.('data-ag-cs-rich-pre')) pre.removeAttribute('data-ag-cs-rich-pre');
          const canSeal = Boolean(
            lastResp &&
              !pre.closest?.('[data-testid="artifact-view"]') &&
              (!lastResp.contains?.(pre) || hasFollowingSiblingInResp(pre, lastResp))
          );
          if (recValid && prevRec.stamp === getPreBodyStamp(prevRec.body)) {
            if (canSeal) prevRec.sealed = true;
            continue;
          }

          const parts = resolveCodeCardParts(pre);
          if (!parts) continue;
          const { card, header, body } = parts;
          setAttrIfChanged(header, 'data-ag-cs-code-sticky', '1');

          const lineCount = countCodeLines(body);
          let btn = prevRec?.btn && prevRec.btn.parentElement ? prevRec.btn : header.querySelector?.('.ag-cs-code-fold-btn');
          if (lineCount < MIN_CODE_FOLD_LINES) {
            if (btn) btn.remove();
            if (card.hasAttribute?.('data-ag-cs-code-folded')) {
              card.removeAttribute('data-ag-cs-code-folded');
            }
            preSyncCache.set(pre, {
              header,
              body,
              btn: null,
              lineCount,
              lang: curLang,
              stamp: getPreBodyStamp(body),
              sealed: canSeal,
            });
            continue;
          }

          const folded = card.getAttribute('data-ag-cs-code-folded') === '1';
          if (btn) {
            setAttrIfChanged(btn, 'data-lines', String(lineCount));
            setAttrIfChanged(btn, 'aria-expanded', folded ? 'false' : 'true');
            const expectedText = formatFoldBtnLabel(folded, lineCount);
            if (btn.textContent !== expectedText) btn.textContent = expectedText;
          } else {
            btn = markNoTr(doc.createElement('button'));
            btn.type = 'button';
            btn.className = 'ag-cs-code-fold-btn';
            btn.setAttribute('data-ag-no-i18n', '');
            btn.setAttribute('data-ag-owned', '1');
            btn.setAttribute('data-no-press-spring', '1');
            btn.setAttribute('data-lines', String(lineCount));
            btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
            btn.textContent = formatFoldBtnLabel(folded, lineCount);
            btn.addEventListener('click', (ev) => {
              ev?.preventDefault?.();
              ev?.stopPropagation?.();
              toggleCodeCardFold(card, btn);
            });

            const actionSlot =
              header.lastElementChild &&
              header.lastElementChild !== header.firstElementChild &&
              String(header.lastElementChild.tagName || '').toUpperCase() === 'DIV'
                ? header.lastElementChild
                : header;
            if (actionSlot === header) {
              header.appendChild(btn);
            } else {
              actionSlot.insertBefore(btn, actionSlot.firstChild);
            }
          }
          preSyncCache.set(pre, {
            header,
            body,
            btn,
            lineCount,
            lang: curLang,
            stamp: getPreBodyStamp(body),
            sealed: canSeal,
          });
        }
      });
    }

    function refreshCodeFoldLabels() {
      if (!doc || typeof doc.querySelectorAll !== 'function') return;
      const btns = doc.querySelectorAll('.ag-cs-code-fold-btn');
      if (!btns || btns.length === 0) return;
      runGuardedMut(() => {
        for (let i = 0; i < btns.length; i++) {
          const btn = btns[i];
          const n = parseInt(btn.getAttribute('data-lines') || '0', 10) || MIN_CODE_FOLD_LINES;
          const folded = btn.getAttribute('aria-expanded') === 'false';
          btn.textContent = formatFoldBtnLabel(folded, n);
        }
      });
    }

    // ── 3. Long-Conversation Navigator Outline, Step Folding & Alt+Up/Down ─
    function pulseSonarOnElement(target) {
      if (!target) return;
      runGuardedMut(() => {
        target.setAttribute('data-ag-cs-sonar', '1');
      });
      const tid = setTimeout(() => {
        sonarTimers.delete(tid);
        if (!isDead() && target.isConnected !== false) {
          runGuardedMut(() => {
            target.removeAttribute('data-ag-cs-sonar');
          });
        }
      }, SONAR_DURATION_MS);
      sonarTimers.add(tid);
    }

    function scrollElementToTopInViewport(target) {
      if (!target) return;
      const vp = findScrollViewport(target);
      if (vp && typeof target.getBoundingClientRect === 'function' && typeof vp.getBoundingClientRect === 'function') {
        const tr = target.getBoundingClientRect();
        const vr = vp.getBoundingClientRect();
        if (vr.height > 0) {
          const nextTop = Math.max(0, Math.round((vp.scrollTop || 0) + (tr.top - vr.top) - 16));
          if (typeof vp.scrollTo === 'function') {
            vp.scrollTo({ top: nextTop, behavior: 'smooth' });
          } else {
            vp.scrollTop = nextTop;
          }
          return;
        }
      }
      if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    }

    function getMountedUserTurns(convView) {
      const root = convView || findPrimaryConvView();
      if (!root || typeof root.querySelectorAll !== 'function') return [];
      let steps = Array.from(root.querySelectorAll('[data-testid="user-input-step"]'));
      if (steps.length === 0) {
        steps = Array.from(root.querySelectorAll('[data-testid="user-message-bubble"]'));
      }
      return steps;
    }

    function jumpUserTurn(delta) {
      if (isDead() || !delta) return false;
      const conv = findPrimaryConvView();
      const turns = getMountedUserTurns(conv);
      if (turns.length === 0) return false;

      const vp = findScrollViewport(conv);
      const vr = vp && typeof vp.getBoundingClientRect === 'function' ? vp.getBoundingClientRect() : null;
      const anchorY = vr && vr.height > 0 ? vr.top + 36 : 80;

      let targetIdx = -1;
      if (delta < 0) {
        for (let i = turns.length - 1; i >= 0; i--) {
          const r = typeof turns[i].getBoundingClientRect === 'function' ? turns[i].getBoundingClientRect() : null;
          if (r && r.top < anchorY - 8) {
            targetIdx = i;
            break;
          }
        }
        if (targetIdx < 0) targetIdx = 0;
      } else {
        for (let i = 0; i < turns.length; i++) {
          const r = typeof turns[i].getBoundingClientRect === 'function' ? turns[i].getBoundingClientRect() : null;
          if (r && r.top > anchorY + 8) {
            targetIdx = i;
            break;
          }
        }
        if (targetIdx < 0) targetIdx = turns.length - 1;
      }

      const target = turns[targetIdx];
      if (!target) return false;
      scrollElementToTopInViewport(target);
      pulseSonarOnElement(target);
      stats.jumpCount += 1;
      return true;
    }

    let foldRafId = 0;
    function cancelFoldRaf() {
      if (foldRafId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(foldRafId);
      }
      foldRafId = 0;
    }

    function foldHistoricalSteps() {
      if (isDead() || !doc) return 0;
      cancelFoldRaf();
      const conv = findPrimaryConvView();
      if (!conv || typeof conv.querySelectorAll !== 'function') return 0;

      // Preserve collapsibles belonging to the latest turn (everything after the last user-input-step, or last agent-response)
      const userSteps = getMountedUserTurns(conv);
      const lastUserStep = userSteps.length > 0 ? userSteps[userSteps.length - 1] : null;
      const agentResponses = Array.from(conv.querySelectorAll('[data-testid="agent-response"]'));
      const latestAgentResp = agentResponses.length > 0 ? agentResponses[agentResponses.length - 1] : null;

      function isInsideLatestTurn(el) {
        if (latestAgentResp && latestAgentResp.contains?.(el)) return true;
        if (lastUserStep && typeof lastUserStep.compareDocumentPosition === 'function') {
          const pos = lastUserStep.compareDocumentPosition(el);
          if (pos & 4) return true; // DOCUMENT_POSITION_FOLLOWING
        }
        return false;
      }

      const collapsibles = Array.from(
        conv.querySelectorAll(
          '[data-testid="worked-for-collapsible"][aria-expanded="true"], [data-testid="thinking-collapsible-trigger"][aria-expanded="true"]'
        )
      );

      const targets = [];
      for (let i = 0; i < collapsibles.length; i++) {
        const btn = collapsibles[i];
        // When there is only 1 turn total, do not fold the active latest turn; when >=2 turns, fold all prior turns
        if ((agentResponses.length >= 2 || userSteps.length >= 2) && isInsideLatestTurn(btn)) {
          continue;
        }
        if (agentResponses.length < 2 && userSteps.length < 2 && i === collapsibles.length - 1) {
          continue;
        }
        if (btn.getAttribute('aria-expanded') === 'true' && typeof btn.click === 'function') {
          targets.push(btn);
        }
      }

      const clickPair = (start) => {
        for (let k = start; k < Math.min(targets.length, start + 2); k++) {
          const b = targets[k];
          if (b && b.isConnected !== false && b.getAttribute('aria-expanded') === 'true') {
            try { b.click(); } catch {}
          }
        }
      };

      const total = targets.length;
      stats.foldedStepsLastRun = total;
      if (total <= 4 || typeof requestAnimationFrame !== 'function') {
        for (let i = 0; i < total; i += 2) clickPair(i);
        return total;
      }

      clickPair(0);
      let cursor = 2;
      const stepFold = () => {
        foldRafId = 0;
        if (isDead()) return;
        clickPair(cursor);
        cursor += 2;
        if (cursor < targets.length) foldRafId = requestAnimationFrame(stepFold);
      };
      foldRafId = requestAnimationFrame(stepFold);
      return total;
    }

    function extractPromptSnippet(stepEl) {
      if (!stepEl) return '';
      const contentEl =
        stepEl.querySelector?.('[data-testid="user-message-content"]') ||
        stepEl.querySelector?.('[data-testid="user-message-bubble"]') ||
        stepEl;
      const raw = String(contentEl.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      return raw.length > 68 ? `${raw.slice(0, 66)}…` : raw || '(Prompt)';
    }

    function parseTurnDotMeta(dot) {
      const aria = String(dot?.getAttribute?.('aria-label') || '');
      const m = aria.match(/(\d+)\s*(?:of|\/)\s*(\d+)/i);
      if (m) {
        return { turn: parseInt(m[1], 10) || 0, total: parseInt(m[2], 10) || 0 };
      }
      const tail = aria.match(/(?:of|\/)\s*(\d+)/i);
      const lead = aria.match(/(\d+)/);
      return {
        turn: lead ? parseInt(lead[1], 10) || 0 : 0,
        total: tail ? parseInt(tail[1], 10) || 0 : 0,
      };
    }

    function isTurnDotActive(dot) {
      if (!dot) return false;
      if (
        dot.getAttribute?.('aria-current') === 'true' ||
        dot.getAttribute?.('data-active') === 'true' ||
        dot.getAttribute?.('data-selected') === 'true' ||
        dot.getAttribute?.('data-state') === 'active'
      ) {
        return true;
      }
      return Boolean(dot.querySelector?.('[data-active="true"], .bg-primary, .bg-foreground'));
    }

    function isHostGroupCardVisible() {
      if (!doc || typeof doc.querySelectorAll !== 'function') return false;
      const cards = doc.querySelectorAll('[data-testid="conversation-navigator-group-card"]');
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        if (!c || c.hidden || c.isConnected === false) continue;
        const disp = c.style?.getPropertyValue ? c.style.getPropertyValue('display') : c.style?.display;
        if (disp === 'none') continue;
        return true;
      }
      return false;
    }

    function collectOutlineModel(navRail) {
      const conv = navRail?.closest?.('[data-testid="conversation-view"]') || findPrimaryConvView();
      const chapters = navRail
        ? Array.from(navRail.querySelectorAll('[data-testid="conversation-navigator-group"]')).map((btn) => ({
            btn,
            label: String(btn.getAttribute('aria-label') || btn.getAttribute('data-group-key') || '').trim(),
          }))
        : [];

      const turnDots = navRail ? Array.from(navRail.querySelectorAll('[data-testid="conversation-navigator-turn"]')) : [];
      const parsedDots = turnDots.map(parseTurnDotMeta);
      let totalTurns = 0;
      let activeDotTurn = 0;
      for (let i = 0; i < turnDots.length; i++) {
        if (parsedDots[i].total > totalTurns) totalTurns = parsedDots[i].total;
        if (!activeDotTurn && parsedDots[i].turn > 0 && isTurnDotActive(turnDots[i])) {
          activeDotTurn = parsedDots[i].turn;
        }
      }

      const mountedSteps = getMountedUserTurns(conv);
      if (!totalTurns) totalTurns = mountedSteps.length;

      const vp = findScrollViewport(conv);
      const vr = vp && typeof vp.getBoundingClientRect === 'function' ? vp.getBoundingClientRect() : null;
      const midY = vr && vr.height > 0 ? vr.top + vr.height * 0.35 : 240;

      let activeIdx = mountedSteps.length - 1;
      for (let i = 0; i < mountedSteps.length; i++) {
        const r = typeof mountedSteps[i].getBoundingClientRect === 'function' ? mountedSteps[i].getBoundingClientRect() : null;
        if (r && r.top <= midY) activeIdx = i;
      }

      const exactDotMatch =
        mountedSteps.length > 0 &&
        parsedDots.length === mountedSteps.length &&
        parsedDots.every((d) => d.turn > 0);
      let startTurnNum = Math.max(1, totalTurns - mountedSteps.length + 1);
      if (!exactDotMatch && activeDotTurn > 0 && activeIdx >= 0 && mountedSteps.length > 0) {
        const maxStart = Math.max(1, totalTurns - mountedSteps.length + 1);
        startTurnNum = Math.max(1, Math.min(maxStart, activeDotTurn - activeIdx));
      }

      const items = mountedSteps.map((el, idx) => ({
        el,
        turnNum: exactDotMatch ? parsedDots[idx].turn : startTurnNum + idx,
        text: extractPromptSnippet(el),
        active: idx === activeIdx,
      }));

      return { totalTurns: Math.max(totalTurns, items.length), chapters, items };
    }

    function cancelHideOutlineTimer() {
      if (hideOutlineTimer) {
        clearTimeout(hideOutlineTimer);
        hideOutlineTimer = 0;
      }
    }

    function scheduleHideOutline() {
      cancelHideOutlineTimer();
      hideOutlineTimer = setTimeout(() => {
        hideOutlineTimer = 0;
        closeNavOutline();
      }, OUTLINE_HIDE_DELAY_MS);
    }

    function ensureOutlinePopover(hostParent) {
      if (outlinePopover && outlinePopover.parentElement === hostParent) return outlinePopover;
      if (outlinePopover) outlinePopover.remove();
      if (!doc || !hostParent) return null;

      const ui = getStrings();
      const pop = markNoTr(doc.createElement('div'));
      pop.className = 'ag-cs-nav-outline-popover';
      pop.setAttribute('role', 'region');
      pop.setAttribute('data-ag-no-i18n', '');
      pop.setAttribute('data-ag-owned', '1');
      pop.hidden = true;

      const head = doc.createElement('div');
      head.className = 'ag-cs-nav-outline-head';

      const title = doc.createElement('span');
      title.className = 'ag-cs-nav-outline-title';
      head.appendChild(title);

      const foldBtn = doc.createElement('button');
      foldBtn.type = 'button';
      foldBtn.className = 'ag-cs-nav-fold-steps-btn';
      foldBtn.setAttribute('data-no-press-spring', '1');
      foldBtn.textContent = ui.foldSteps;
      foldBtn.addEventListener('click', (ev) => {
        ev?.preventDefault?.();
        ev?.stopPropagation?.();
        const count = foldHistoricalSteps();
        const latestUi = getStrings();
        foldBtn.textContent = latestUi.foldedFeedback(count);
        if (foldFeedbackTimer) clearTimeout(foldFeedbackTimer);
        foldFeedbackTimer = setTimeout(() => {
          foldFeedbackTimer = 0;
          if (!isDead() && outlineFoldBtn) outlineFoldBtn.textContent = getStrings().foldSteps;
        }, 1200);
      });
      head.appendChild(foldBtn);
      pop.appendChild(head);

      const searchWrap = doc.createElement('div');
      searchWrap.className = 'ag-cs-nav-outline-search-wrap';
      const search = doc.createElement('input');
      search.type = 'search';
      search.className = 'ag-cs-nav-outline-search';
      search.placeholder = ui.searchPlaceholder;
      search.addEventListener('input', () => {
        outlineFilterText = String(search.value || '').trim().toLowerCase();
        renderOutlineListOnly();
      });
      search.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
          ev.stopPropagation();
          closeNavOutline();
        } else if (ev.key === 'Enter') {
          const firstBtn = outlineListEl?.querySelector?.('button.ag-cs-nav-outline-item, button.ag-cs-nav-outline-chapter');
          if (firstBtn && typeof firstBtn.click === 'function') firstBtn.click();
        }
      });
      searchWrap.appendChild(search);
      pop.appendChild(searchWrap);

      const list = doc.createElement('div');
      list.className = 'ag-cs-nav-outline-list';
      pop.appendChild(list);

      pop.addEventListener('pointerenter', cancelHideOutlineTimer);
      pop.addEventListener('pointerleave', () => {
        if (doc.activeElement !== search) scheduleHideOutline();
      });

      hostParent.appendChild(pop);
      outlinePopover = pop;
      outlineTitleEl = title;
      outlineFoldBtn = foldBtn;
      outlineSearchInput = search;
      outlineListEl = list;
      lastOutlineStructSig = '';
      lastOutlineActiveIdx = -1;
      activeOutlineBtn = null;
      outlineItemBtnByIdx.clear();
      return pop;
    }

    function renderOutlineListOnly(forceRebuild = false) {
      if (!outlineListEl || !doc) return;
      const ui = getStrings();
      const model = collectOutlineModel(activeNavRail);
      const q = outlineFilterText;
      const structParts = [lastSyncedLang, model.totalTurns, q, model.chapters.length, model.items.length];
      for (let i = 0; i < model.chapters.length; i++) structParts.push(model.chapters[i].label);
      let activeIdx = -1;
      for (let i = 0; i < model.items.length; i++) {
        const it = model.items[i];
        if (it.active) activeIdx = i;
        structParts.push(`${it.turnNum}:${it.text}`);
      }
      const nextStructSig = structParts.join('\x1f');
      if (!forceRebuild && nextStructSig === lastOutlineStructSig && outlineListEl.firstChild) {
        // 结构未变：仅刷新目标元素引用并按需切换旧/新按钮的 data-active="1"，零 DOM 重建
        for (let i = 0; i < model.items.length; i++) {
          const btn = outlineItemBtnByIdx.get(i);
          if (btn) btn.__agTurnEl = model.items[i].el;
        }
        if (activeIdx !== lastOutlineActiveIdx) {
          const nextBtn = activeIdx >= 0 ? outlineItemBtnByIdx.get(activeIdx) || null : null;
          runGuardedMut(() => {
            if (activeOutlineBtn && activeOutlineBtn !== nextBtn) {
              activeOutlineBtn.removeAttribute('data-active');
            }
            if (nextBtn) setAttrIfChanged(nextBtn, 'data-active', '1');
          });
          activeOutlineBtn = nextBtn;
          lastOutlineActiveIdx = activeIdx;
        }
        return;
      }
      lastOutlineStructSig = nextStructSig;
      lastOutlineActiveIdx = activeIdx;
      activeOutlineBtn = null;
      outlineItemBtnByIdx.clear();
      if (outlineTitleEl) outlineTitleEl.textContent = ui.outlineTitle(model.totalTurns);

      runGuardedMut(() => {
        while (outlineListEl.firstChild) outlineListEl.removeChild(outlineListEl.firstChild);

        let renderedCount = 0;

        for (let i = 0; i < model.chapters.length; i++) {
          const ch = model.chapters[i];
          if (q && !ch.label.toLowerCase().includes(q)) continue;
          const row = doc.createElement('button');
          row.type = 'button';
          row.className = 'ag-cs-nav-outline-chapter';
          row.setAttribute('data-no-press-spring', '1');

          const badge = doc.createElement('span');
          badge.className = 'ag-cs-nav-outline-badge';
          badge.textContent = ui.chapterBadge;
          row.appendChild(badge);

          const txt = doc.createElement('span');
          txt.className = 'ag-cs-nav-outline-text';
          txt.textContent = ch.label;
          row.appendChild(txt);

          row.addEventListener('click', (ev) => {
            ev?.preventDefault?.();
            ev?.stopPropagation?.();
            try {
              ch.btn.click?.();
            } catch {}
          });
          outlineListEl.appendChild(row);
          renderedCount += 1;
        }

        for (let i = 0; i < model.items.length; i++) {
          const it = model.items[i];
          const numStr = `#${it.turnNum}`;
          if (q && !it.text.toLowerCase().includes(q) && !numStr.includes(q)) continue;

          const row = doc.createElement('button');
          row.type = 'button';
          row.className = 'ag-cs-nav-outline-item';
          row.setAttribute('data-no-press-spring', '1');
          row.setAttribute('data-turn-num', String(it.turnNum));
          row.__agTurnEl = it.el;
          if (it.active) {
            row.setAttribute('data-active', '1');
            activeOutlineBtn = row;
          }
          outlineItemBtnByIdx.set(i, row);

          const idxSpan = doc.createElement('span');
          idxSpan.className = 'ag-cs-nav-outline-num';
          idxSpan.textContent = numStr;
          row.appendChild(idxSpan);

          const txtSpan = doc.createElement('span');
          txtSpan.className = 'ag-cs-nav-outline-text';
          txtSpan.textContent = it.text;
          row.appendChild(txtSpan);

          row.addEventListener('click', (ev) => {
            ev?.preventDefault?.();
            ev?.stopPropagation?.();
            const targetEl = row.__agTurnEl || it.el;
            scrollElementToTopInViewport(targetEl);
            pulseSonarOnElement(targetEl);
            stats.jumpCount += 1;
          });
          outlineListEl.appendChild(row);
          renderedCount += 1;
        }

        if (renderedCount === 0) {
          const empty = doc.createElement('div');
          empty.className = 'ag-cs-nav-outline-empty';
          empty.textContent = ui.emptyMatch;
          outlineListEl.appendChild(empty);
        }
      });
    }

    function renderOutlinePopover() {
      const navRail = activeNavRail || doc?.querySelector?.('[data-testid="conversation-navigator"]');
      if (!navRail) return null;
      activeNavRail = navRail;
      const hostParent = navRail.closest?.('[data-testid="conversation-view"]') || navRail.parentElement || doc?.body;
      if (!hostParent) return null;

      let pop = null;
      runGuardedMut(() => {
        pop = ensureOutlinePopover(hostParent);
        if (!pop) return;
        const ui = getStrings();
        if (outlineSearchInput) outlineSearchInput.placeholder = ui.searchPlaceholder;
        if (outlineFoldBtn && !foldFeedbackTimer) outlineFoldBtn.textContent = ui.foldSteps;
      });
      if (!pop) return null;
      renderOutlineListOnly();
      return pop;
    }

    function openNavOutline(railOverride = null) {
      if (isDead() || !doc || isHostGroupCardVisible()) return false;
      cancelHideOutlineTimer();
      const navRail = railOverride || doc.querySelector?.('[data-testid="conversation-navigator"]');
      if (!navRail) return false;
      activeNavRail = navRail;
      const pop = renderOutlinePopover();
      if (!pop) return false;
      outlineOpen = true;
      runGuardedMut(() => {
        pop.hidden = false;
        pop.setAttribute('data-open', '1');
      });
      return true;
    }

    function closeNavOutline() {
      cancelHideOutlineTimer();
      outlineOpen = false;
      if (!outlinePopover) return;
      runGuardedMut(() => {
        outlinePopover.removeAttribute('data-open');
        outlinePopover.hidden = true;
      });
    }

    function syncNavRails() {
      if (isDead() || !doc || typeof doc.querySelectorAll !== 'function') return;
      pruneUnsubs(navRailUnsubscribers, false, boundNavRails);
      const rails = doc.querySelectorAll('[data-testid="conversation-navigator"]');
      const PASSIVE_OPT = { passive: true };
      for (let i = 0; i < rails.length; i++) {
        const rail = rails[i];
        if (boundNavRails.has(rail) || typeof rail.addEventListener !== 'function') continue;
        boundNavRails.add(rail);
        let lastHoverTarget = null;
        let lastHoverAt = 0;
        const onPointerHover = (ev) => {
          const tgt = ev?.target || null;
          const onGroupBtn = Boolean(tgt?.closest?.('[data-testid="conversation-navigator-group"]'));
          if (onGroupBtn) {
            lastHoverTarget = tgt;
            if (outlineOpen && doc.activeElement !== outlineSearchInput) {
              closeNavOutline();
            }
            return;
          }
          // 轻量短路前置到 isHostGroupCardVisible() 之前：大纲已展开且悬停在同轨上直接续期
          if (outlineOpen && activeNavRail === rail && outlinePopover && outlinePopover.isConnected !== false) {
            cancelHideOutlineTimer();
            lastHoverTarget = tgt;
            return;
          }
          // 同帧 pointerenter + pointerover 双触发防重复查询
          const now = Date.now();
          if (tgt && tgt === lastHoverTarget && now - lastHoverAt < 24) return;
          lastHoverTarget = tgt;
          lastHoverAt = now;
          if (isHostGroupCardVisible()) return;
          openNavOutline(rail);
        };
        const onLeave = () => {
          lastHoverTarget = null;
          scheduleHideOutline();
        };
        rail.addEventListener('pointerenter', onPointerHover, PASSIVE_OPT);
        rail.addEventListener('pointerover', onPointerHover, PASSIVE_OPT);
        rail.addEventListener('pointerleave', onLeave, PASSIVE_OPT);
        navRailUnsubscribers.push({
          el: rail,
          unsub: () => {
            try {
              rail.removeEventListener('pointerenter', onPointerHover, PASSIVE_OPT);
              rail.removeEventListener('pointerover', onPointerHover, PASSIVE_OPT);
              rail.removeEventListener('pointerleave', onLeave, PASSIVE_OPT);
            } catch {}
          },
        });
      }
      if (outlineOpen && outlinePopover && outlinePopover.isConnected !== false) {
        if (isHostGroupCardVisible() && doc.activeElement !== outlineSearchInput) {
          closeNavOutline();
        } else {
          const now = Date.now();
          if (!checkConvRunning() || now - lastOutlineStreamSyncAt >= 200) {
            lastOutlineStreamSyncAt = now;
            renderOutlineListOnly();
          }
        }
      }
    }

    function onWinKeyDown(ev) {
      if (isDead() || !ev) return;
      if (ev.key === 'Escape' && outlineOpen) {
        closeNavOutline();
        return;
      }
      if (
        ev.altKey &&
        !ev.ctrlKey &&
        !ev.metaKey &&
        !ev.shiftKey &&
        (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') &&
        !isEditableElement(ev.target)
      ) {
        const jumped = jumpUserTurn(ev.key === 'ArrowUp' ? -1 : 1);
        if (jumped) ev.preventDefault?.();
      }
    }

    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('keydown', onWinKeyDown);
    }

    // ── Public Lifecycle API ───────────────────────────────────────────────
    function sync() {
      if (isDead()) return;
      const curLang = String(getLang() || '');
      const langChanged = Boolean(lastSyncedLang && curLang !== lastSyncedLang);
      lastSyncedLang = curLang;
      syncSidecarThemeBridge(false);
      syncCodeBlocks();
      syncNavRails();
      if (langChanged) {
        refreshCodeFoldLabels();
        refreshOutlineLocaleTexts();
      }
    }

    function destroy() {
      if (localDestroyed) return;
      localDestroyed = true;
      cancelFoldRaf();
      cancelHideOutlineTimer();
      if (foldFeedbackTimer) {
        clearTimeout(foldFeedbackTimer);
        foldFeedbackTimer = 0;
      }
      for (const tid of sonarTimers) clearTimeout(tid);
      sonarTimers.clear();

      if (win && typeof win.removeEventListener === 'function') {
        try {
          win.removeEventListener('keydown', onWinKeyDown);
        } catch {}
      }
      pruneUnsubs(iframeUnsubscribers, true, boundIframes);
      iframeSizeCache = new WeakMap();
      try { iframeRo?.disconnect?.(); } catch {}
      iframeRo = null;
      pruneUnsubs(navRailUnsubscribers, true, boundNavRails);
      lastOutlineStructSig = '';
      lastOutlineActiveIdx = -1;
      activeOutlineBtn = null;
      outlineItemBtnByIdx.clear();

      if (doc && typeof doc.querySelectorAll === 'function') {
        runGuardedMut(() => {
          doc.querySelectorAll('.ag-cs-code-fold-btn').forEach((n) => n.remove());
          doc.querySelectorAll('[data-ag-cs-code-folded]').forEach((el) => el.removeAttribute('data-ag-cs-code-folded'));
          doc.querySelectorAll('[data-ag-cs-code-sticky]').forEach((el) => el.removeAttribute('data-ag-cs-code-sticky'));
          doc.querySelectorAll('.ag-cs-nav-outline-popover').forEach((n) => n.remove());
        });
      }
      outlinePopover = null;
      outlineSearchInput = null;
      outlineListEl = null;
      outlineTitleEl = null;
      outlineFoldBtn = null;
      activeNavRail = null;
      cachedConvView = null;
      outlineOpen = false;
      cachedThemeSample = null;
      cachedAttrKey = '';
    }

    return {
      sync,
      onThemeChange,
      jumpUserTurn,
      foldHistoricalSteps,
      openNavOutline,
      closeNavOutline,
      getDebugState: () => ({
        ...stats,
        outlineOpen,
        cachedThemeSig: cachedThemeSample?.sig || null,
      }),
      destroy,
    };
  }

  const api = {
    MIN_CODE_FOLD_LINES,
    SIDECAR_THEME_VARS,
    createHostEnhancerController,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  G.__agPrismHostEnhancer = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
