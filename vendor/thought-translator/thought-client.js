// Obsidian Prism — Unified Thought Translator & Polisher Client Runtime (v1.1 Stabilized)
// Incorporates proven anti-jank & anti-retranslate safeguards:
// 1. Rendered-signature idempotence (`data-op-zh-sig` + `data-raw-zh`) -> 0 redundant DOM rebuilds on cache hit;
// 2. Global `inflightBySig` flight pool across React panel remounts + pre-commit source-hash verification -> 0 duplicate requests & 0 misplacement;
// 3. Monotonic `minHeight` lock during streaming + `scrollTop` preservation + non-regressive pending state -> 0 height collapse jank;
// 4. Clean AST-like text collector skipping BUTTON / SVG / STYLE / SCRIPT & overlays + exponential failure backoff (15s -> 45s -> 120s);
// 5. O(1) fast-skip on collapsed & already-settled historical panels for instant performance in long conversations.

(function (root) {
  'use strict';
  const W = root || (typeof window !== 'undefined' ? window : globalThis);
  if (!W) return;

  const OWNER_ID = 'obsidian-prism-thought';
  const LOCAL_CACHE_KEY = 'ag_prism_thought_zh_cache_v1';
  const MEM_CACHE_LIMIT = 1500;
  const STORAGE_CACHE_LIMIT = 500;
  const STREAM_FLUSH_MS = 55;
  const FINISH_GATE_MS = 450;
  const QUIET_GATE_MS = 900;

  const BLOCK_TAGS = {
    P: 1, DIV: 1, LI: 1, UL: 1, OL: 1, PRE: 1, BLOCKQUOTE: 1,
    H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, TR: 1, HR: 1,
    SECTION: 1, ARTICLE: 1,
  };
  const SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, BUTTON: 1, SVG: 1, NOSCRIPT: 1,
  };

  let currentMode = 'off'; // 'off' | 'machine' | 'ai'
  let triggerTiming = 'preload'; // 'preload' | 'expand'
  let activeStyleTag = ''; // e.g. 'ai_technical' | 'ai_concise' | 'ai_custom_<hash>'
  let cacheWarmed = false;
  let localCacheLoaded = false;
  let scanTimer = null;

  const memCache = new Map();
  const failedSigs = new Map();
  const inflightBySig = new Map();
  const panelMeta = new WeakMap();
  const waitTimers = new WeakMap();
  const lockedHeights = new WeakMap();

  function normalizeTextKey(str) {
    return String(str || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  function canonicalizeSkeleton(str) {
    return String(str || '')
      .replace(/\r\n/g, '\n')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, '')
      .toLowerCase();
  }

  function hashKey(rawText, prefix) {
    const norm = normalizeTextKey(rawText);
    if (!norm) return '';
    const skel = canonicalizeSkeleton(norm) || norm;
    let h = 2166136261;
    for (let i = 0; i < skel.length; i++) {
      h ^= skel.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `${prefix}_v3_${(h >>> 0).toString(36)}_${skel.length}`;
  }

  function isMostlyZh(text) {
    const norm = normalizeTextKey(text);
    if (!norm || norm.length < 10 || norm.length > 48000) return true;
    const prose = norm
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`\n]+`/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[A-Za-z]:[\\/][^\s"'<>|]+/g, ' ')
      .replace(/(?:\/[A-Za-z0-9._-]+){2,}/g, ' ');
    const cjk = (prose.match(/[\u4e00-\u9fa5]/g) || []).length;
    const latin = (prose.match(/[A-Za-z]/g) || []).length;
    if (cjk >= 24 && cjk / Math.max(1, cjk + latin) >= 0.18) return true;
    if (latin < 12) return true;
    return cjk / Math.max(1, cjk + latin) >= 0.28;
  }

  function loadLocalStorageCache() {
    if (localCacheLoaded) return;
    localCacheLoaded = true;
    try {
      const store = W.localStorage;
      if (!store) return;
      const raw = store.getItem(LOCAL_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (k && typeof v === 'string' && v.trim()) memCache.set(k, v);
        }
      }
    } catch (_) {}
  }

  function persistLocalStorageCache() {
    try {
      const store = W.localStorage;
      if (!store) return;
      const entries = Array.from(memCache.entries());
      const slice = entries.slice(Math.max(0, entries.length - STORAGE_CACHE_LIMIT));
      const obj = {};
      for (const [k, v] of slice) obj[k] = v;
      store.setItem(LOCAL_CACHE_KEY, JSON.stringify(obj));
    } catch (_) {}
  }

  function putMemCache(key, val, persist = true) {
    if (!key || typeof val !== 'string' || !val.trim()) return;
    const trimmed = val.trim();
    if (memCache.has(key)) memCache.delete(key);
    while (memCache.size >= MEM_CACHE_LIMIT) {
      const oldest = memCache.keys().next().value;
      if (oldest === undefined) break;
      memCache.delete(oldest);
    }
    memCache.set(key, trimmed);
    if (persist) persistLocalStorageCache();
  }

  function isSigInCooldown(sig) {
    const rec = failedSigs.get(sig);
    if (!rec) return false;
    if (Date.now() >= rec.retryAfter) {
      failedSigs.delete(sig);
      return false;
    }
    return true;
  }

  function recordSigFailure(sig) {
    if (!sig) return;
    const prev = failedSigs.get(sig);
    const count = prev ? prev.count + 1 : 1;
    const delayMs = count === 1 ? 15000 : count === 2 ? 45000 : 120000;
    failedSigs.set(sig, { count, retryAfter: Date.now() + delayMs });
  }

  function getBridge() {
    return W.__agPrismThoughtBridge || null;
  }

  function ensureInitialized() {
    loadLocalStorageCache();
    try {
      const docEl = typeof document !== 'undefined' && document.documentElement;
      if (docEl && docEl.getAttribute('data-ag-prism-thought-owner') !== OWNER_ID) {
        docEl.setAttribute('data-ag-prism-thought-owner', OWNER_ID);
      }
    } catch (_) {}

    if (cacheWarmed) return;
    cacheWarmed = true;
    const br = getBridge();
    if (br && typeof br.call === 'function') {
      br.call({ action: 'get-cache' })
        .then((res) => {
          const nextTag = res?.styleTag || (res?.stylePreset ? `ai_${res.stylePreset}` : '');
          if (nextTag && nextTag !== activeStyleTag) {
            activeStyleTag = nextTag;
          }
          if (res && res.entries && typeof res.entries === 'object') {
            let added = 0;
            for (const [k, v] of Object.entries(res.entries)) {
              if (k && typeof v === 'string' && v.trim()) {
                putMemCache(k, v, false);
                added++;
              }
            }
            if (added > 0) {
              persistLocalStorageCache();
            }
          }
          scheduleScan(20);
        })
        .catch(() => {});
    }
  }

  function releasePrismOverlays() {
    for (const entry of inflightBySig.values()) {
      if (entry.flushTimer) clearTimeout(entry.flushTimer);
    }
    inflightBySig.clear();
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.ag-prism-thought-overlay[data-op-thought="1"]').forEach((ov) => {
      const panel = ov.parentElement;
      ov.remove();
      if (panel) {
        panel.removeAttribute('data-op-zh-ready');
        panel.removeAttribute('data-op-zh-pending');
        panel.removeAttribute('data-op-zh-sig');
        panel.removeAttribute('data-op-show-raw');
        panel.removeAttribute('data-op-thought-panel');
        if (panel.style) panel.style.removeProperty('min-height');
      }
    });
    try {
      document.documentElement?.removeAttribute?.('data-ag-prism-thought-owner');
    } catch (_) {}
  }

  function isTriggerStreaming(btn) {
    if (!btn) return false;
    if (btn.getAttribute('data-op-thought-state') === 'streaming') return true;
    if (btn.getAttribute('data-ag-cs-spark-streaming') === '1') return true;
    try {
      if (
        btn.querySelector(
          '.animate-shimmer-text, .animate-spin, .animate-pulse, [class*="animate-shimmer"], .ag-cs-thinking-spark[data-state="streaming"]'
        )
      ) {
        return true;
      }
    } catch (_) {}
    const txt = (btn.textContent || '').trim();
    if (!txt) return false;
    if (/已思考|Thought\s+for|Thought\s+process/i.test(txt)) return false;
    if (/thinking|正在思考|思考中|推演中|諗緊/i.test(txt) && !/\d+\s*(s|sec|秒|m|min|分)/i.test(txt)) {
      return true;
    }
    return false;
  }

  function isOverlayOrIgnoredElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute && (el.hasAttribute('data-op-thought') || el.hasAttribute('data-prism-ignore'))) return true;
    const cls = String((el.getAttribute && el.getAttribute('class')) || el.className || '');
    return cls.includes('ag-prism-thought-overlay') || cls.includes('-zh-overlay');
  }

  function collectCleanText(node, chunks) {
    if (!node) return;
    const nt = node.nodeType;
    if (nt === 3) {
      if (node.nodeValue) chunks.push(node.nodeValue);
      return;
    }
    if (nt !== 1 || isOverlayOrIgnoredElement(node)) return;
    const tag = node.tagName ? String(node.tagName).toUpperCase() : '';
    if (SKIP_TAGS[tag]) return;
    if (tag === 'BR') {
      chunks.push('\n');
      return;
    }
    const isBlock = Boolean(BLOCK_TAGS[tag]);
    if (isBlock) chunks.push('\n');
    const children = node.childNodes;
    if (children && children.length) {
      for (let i = 0; i < children.length; i++) {
        collectCleanText(children[i], chunks);
      }
    } else if (typeof node.textContent === 'string' && (!node.children || node.children.length === 0)) {
      chunks.push(node.textContent);
    }
    if (isBlock) chunks.push('\n');
  }

  function extractRawEnglishText(panel) {
    if (!panel || !panel.childNodes) return '';
    const chunks = [];
    for (let i = 0; i < panel.childNodes.length; i++) {
      collectCleanText(panel.childNodes[i], chunks);
    }
    return normalizeTextKey(chunks.join(''));
  }

  // Fast O(1) fingerprint of non-overlay children count + edge lengths to avoid full tree walk on unchanged ready panels
  function quickPanelStamp(panel) {
    if (!panel || !panel.childNodes) return '';
    const nodes = panel.childNodes;
    let count = 0;
    let firstLen = 0;
    let lastLen = 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.nodeType === 1 && isOverlayOrIgnoredElement(n)) continue;
      count++;
      const l = n.nodeType === 3 ? (n.nodeValue || '').length : (n.textContent || '').length;
      if (count === 1) firstLen = l;
      lastLen = l;
    }
    return `${count}:${firstLen}:${lastLen}`;
  }

  function appendInlineFormatted(parent, lineText, doc) {
    const tokenRe = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
    let lastIdx = 0;
    let m;
    while ((m = tokenRe.exec(lineText)) !== null) {
      if (m.index > lastIdx) {
        parent.appendChild(doc.createTextNode(lineText.slice(lastIdx, m.index)));
      }
      const tok = m[0];
      if (tok.startsWith('`') && tok.endsWith('`')) {
        const code = doc.createElement('code');
        code.className = 'ag-prism-thought-code';
        code.textContent = tok.slice(1, -1);
        parent.appendChild(code);
      } else if (tok.startsWith('**') && tok.endsWith('**')) {
        const strong = doc.createElement('strong');
        strong.textContent = tok.slice(2, -2);
        parent.appendChild(strong);
      }
      lastIdx = m.index + tok.length;
    }
    if (lastIdx < lineText.length) {
      parent.appendChild(doc.createTextNode(lineText.slice(lastIdx)));
    }
  }

  function renderSafeMarkdownDom(container, markdownText) {
    const hasStreamChild = Boolean(container.querySelector && container.querySelector('.ag-prism-thought-stream'));
    if (!hasStreamChild && container.getAttribute && container.getAttribute('data-raw-zh') === markdownText) {
      return;
    }
    const doc = container.ownerDocument || document;
    while (container.firstChild) container.removeChild(container.firstChild);
    if (container.setAttribute) container.setAttribute('data-raw-zh', markdownText);

    const lines = String(markdownText || '').replace(/\r\n/g, '\n').split('\n');
    let inFence = false;
    let fenceLines = [];
    let listEl = null;
    let listType = '';

    const flushList = () => {
      if (listEl) {
        container.appendChild(listEl);
        listEl = null;
        listType = '';
      }
    };

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (trimmed.startsWith('```')) {
        flushList();
        if (!inFence) {
          inFence = true;
          fenceLines = [];
        } else {
          const pre = doc.createElement('pre');
          pre.className = 'ag-prism-thought-pre';
          pre.textContent = fenceLines.join('\n');
          container.appendChild(pre);
          inFence = false;
          fenceLines = [];
        }
        continue;
      }
      if (inFence) {
        fenceLines.push(rawLine);
        continue;
      }
      if (!trimmed) {
        flushList();
        continue;
      }

      const ulMatch = /^[-*•]\s+(.+)$/.exec(trimmed);
      const olMatch = /^\d+[.)]\s+(.+)$/.exec(trimmed);
      if (ulMatch || olMatch) {
        const nextType = ulMatch ? 'ul' : 'ol';
        if (!listEl || listType !== nextType) {
          flushList();
          listEl = doc.createElement(nextType);
          listEl.className = nextType === 'ul' ? 'ag-prism-thought-ul' : 'ag-prism-thought-ol';
          listType = nextType;
        }
        const li = doc.createElement('li');
        li.className = 'ag-prism-thought-li';
        appendInlineFormatted(li, (ulMatch || olMatch)[1], doc);
        listEl.appendChild(li);
        continue;
      }

      flushList();
      const p = doc.createElement('p');
      p.className = 'ag-prism-thought-p';
      appendInlineFormatted(p, trimmed.replace(/^#{1,4}\s+/, ''), doc);
      container.appendChild(p);
    }

    if (inFence && fenceLines.length) {
      const pre = doc.createElement('pre');
      pre.className = 'ag-prism-thought-pre';
      pre.textContent = fenceLines.join('\n');
      container.appendChild(pre);
    }
    flushList();
  }

  function findDirectOverlay(panel) {
    if (!panel || !panel.children) return null;
    for (let i = 0; i < panel.children.length; i++) {
      const ch = panel.children[i];
      if (ch && ch.classList && ch.classList.contains('ag-prism-thought-overlay')) {
        return ch;
      }
    }
    return null;
  }

  function ensureOverlayShell(panel) {
    const doc = panel.ownerDocument || document;
    let ov = findDirectOverlay(panel);
    if (ov) return ov;

    ov = doc.createElement('div');
    ov.className = 'ag-prism-thought-overlay';
    ov.setAttribute('data-op-thought', '1');
    ov.setAttribute('data-prism-ignore', '1');
    ov.setAttribute('data-ag-no-i18n', '');

    const body = doc.createElement('span');
    body.className = 'ag-prism-thought-body';
    ov.appendChild(body);

    const toggleBtn = doc.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'ag-prism-thought-raw-toggle';
    toggleBtn.setAttribute('data-no-press-spring', '1');
    const showingRaw = panel.getAttribute('data-op-show-raw') === '1';
    toggleBtn.setAttribute('aria-pressed', String(showingRaw));
    toggleBtn.textContent = showingRaw ? '收起原文' : '原文';
    toggleBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const nextRaw = panel.getAttribute('data-op-show-raw') !== '1';
      if (nextRaw) panel.setAttribute('data-op-show-raw', '1');
      else panel.removeAttribute('data-op-show-raw');
      toggleBtn.setAttribute('aria-pressed', String(nextRaw));
      toggleBtn.textContent = nextRaw ? '收起原文' : '原文';
    });
    ov.appendChild(toggleBtn);

    panel.setAttribute('data-op-thought-panel', '1');
    panel.insertBefore(ov, panel.firstChild);
    return ov;
  }

  function renderPendingState(panel, message) {
    if (!panel) return;
    // Never regress an already-rendered panel back to a tiny pending pill (prevents height collapse jank!)
    const existingOv = findDirectOverlay(panel);
    if (panel.getAttribute('data-op-zh-ready') === '1' && existingOv && existingOv.getAttribute('data-pending') !== '1') {
      return;
    }
    const ov = ensureOverlayShell(panel);
    ov.setAttribute('data-pending', '1');
    const body = ov.querySelector('.ag-prism-thought-body');
    if (body) {
      if (body.removeAttribute) body.removeAttribute('data-raw-zh');
      let hint = body.querySelector('.ag-prism-thought-pending-hint');
      if (!hint) {
        while (body.firstChild) body.removeChild(body.firstChild);
        hint = (panel.ownerDocument || document).createElement('span');
        hint.className = 'ag-prism-thought-pending-hint';
        body.appendChild(hint);
      }
      if (hint.textContent !== message) {
        hint.textContent = message;
      }
    }
    if (panel.getAttribute('data-op-zh-pending') !== '1') {
      panel.setAttribute('data-op-zh-pending', '1');
    }
    panel.removeAttribute('data-op-zh-ready');
  }

  function clearPendingKeepRaw(panel) {
    if (!panel || panel.getAttribute('data-op-zh-ready') === '1') return;
    lockedHeights.delete(panel);
    if (panel.style) panel.style.removeProperty('min-height');
    panel.removeAttribute('data-op-zh-pending');
    const ov = findDirectOverlay(panel);
    if (ov && ov.getAttribute('data-pending') === '1') {
      ov.remove();
    }
  }

  function renderTranslatedText(panel, text, isPartial, sig) {
    if (!panel || typeof text !== 'string' || !text) return;
    const ov = ensureOverlayShell(panel);
    ov.removeAttribute('data-pending');
    const body = ov.querySelector('.ag-prism-thought-body');
    if (!body) return;

    if (isPartial) {
      let streamEl = body.querySelector('.ag-prism-thought-stream');
      if (
        streamEl &&
        streamEl.textContent === text &&
        panel.getAttribute('data-op-zh-ready') === '1'
      ) {
        return;
      }
      const curH = panel.offsetHeight || 0;
      const nextMinH = Math.max(lockedHeights.get(panel) || 0, curH);
      if (nextMinH > 0 && panel.style) {
        lockedHeights.set(panel, nextMinH);
        panel.style.minHeight = `${nextMinH}px`;
      }
      if (body.removeAttribute) body.removeAttribute('data-raw-zh');
      if (!streamEl) {
        while (body.firstChild) body.removeChild(body.firstChild);
        streamEl = (panel.ownerDocument || document).createElement('p');
        streamEl.className = 'ag-prism-thought-stream';
        body.appendChild(streamEl);
      }
      if (streamEl.textContent !== text) {
        streamEl.textContent = text;
      }
    } else {
      const prevScrollTop = typeof panel.scrollTop === 'number' ? panel.scrollTop : 0;
      renderSafeMarkdownDom(body, text);
      lockedHeights.delete(panel);
      if (panel.style) panel.style.removeProperty('min-height');
      if (prevScrollTop > 0 && typeof panel.scrollTop === 'number') {
        panel.scrollTop = prevScrollTop;
      }
      if (sig) {
        panel.setAttribute('data-op-zh-sig', sig);
        const meta = panelMeta.get(panel) || {};
        meta.doneSig = sig;
        meta.readyStamp = quickPanelStamp(panel);
        panelMeta.set(panel, meta);
      }
    }

    panel.removeAttribute('data-op-zh-pending');
    if (panel.getAttribute('data-op-zh-ready') !== '1') {
      panel.setAttribute('data-op-zh-ready', '1');
    }
  }

  function computeSig(rawText, mode) {
    const presetTag = mode === 'machine' ? 'mt' : activeStyleTag || 'ai_pending';
    return `${presetTag}:${hashKey(rawText, 'sig')}`;
  }

  function findCachedTranslation(rawText, mode) {
    if (mode === 'machine') {
      return memCache.get(hashKey(rawText, 'mt')) || '';
    }
    if (!activeStyleTag) return '';
    return memCache.get(hashKey(rawText, activeStyleTag)) || '';
  }

  function bindPanelToInflight(entry, panel, expanded) {
    if (panel && !entry.panels.includes(panel)) {
      entry.panels.push(panel);
    }
    if (panel && expanded) {
      if (entry.lastPartial) {
        renderTranslatedText(panel, entry.lastPartial, true, null);
      } else {
        renderPendingState(
          panel,
          entry.mode === 'machine' ? '正在极速机翻思考过程…' : '正在通过 AI 转译并润色思考过程…'
        );
      }
    }
  }

  function startOrJoinTranslation(panel, rawText, mode, sig, srcSkelHash, expanded) {
    const cached = findCachedTranslation(rawText, mode);
    if (cached) {
      if (panel && expanded) {
        renderTranslatedText(panel, cached, false, sig);
      }
      return;
    }

    if (isSigInCooldown(sig)) {
      if (panel && expanded) clearPendingKeepRaw(panel);
      return;
    }

    const existing = inflightBySig.get(sig);
    if (existing && Date.now() - existing.startedAt <= 75000) {
      bindPanelToInflight(existing, panel, expanded);
      return;
    }
    if (existing) {
      if (existing.flushTimer) clearTimeout(existing.flushTimer);
      inflightBySig.delete(sig);
    }

    const br = getBridge();
    if (!br || typeof br.translateStream !== 'function') return;

    const entry = {
      sig,
      srcSkelHash,
      mode,
      startedAt: Date.now(),
      lastPartial: '',
      lastFlushAt: 0,
      pendingPartial: '',
      flushTimer: null,
      panels: panel ? [panel] : [],
    };
    inflightBySig.set(sig, entry);

    if (panel && expanded) {
      renderPendingState(
        panel,
        mode === 'machine' ? '正在极速机翻思考过程…' : '正在通过 AI 转译并润色思考过程…'
      );
    }

    const flushPartialToPanels = (partialStr) => {
      const trimmed = String(partialStr || '').trimStart();
      if (!trimmed) return;
      entry.lastPartial = trimmed;
      entry.lastFlushAt = Date.now();
      entry.pendingPartial = '';
      for (const p of entry.panels) {
        if (!p || !p.isConnected) continue;
        // Verify panel still holds the same thought skeleton (prevents misplacement if React recycled the DOM node!)
        const curRaw = extractRawEnglishText(p);
        if (curRaw && hashKey(curRaw, 'sig') !== entry.srcSkelHash) continue;
        renderTranslatedText(p, trimmed, true, null);
      }
    };

    br.translateStream(
      { text: rawText, mode },
      (partial) => {
        if (currentMode === 'off' || typeof partial !== 'string' || !partial.trim()) return;
        const now = Date.now();
        if (entry.lastFlushAt === 0 || now - entry.lastFlushAt >= STREAM_FLUSH_MS) {
          if (entry.flushTimer) {
            clearTimeout(entry.flushTimer);
            entry.flushTimer = null;
          }
          flushPartialToPanels(partial);
        } else {
          entry.pendingPartial = partial;
          if (!entry.flushTimer) {
            const delay = Math.max(12, STREAM_FLUSH_MS - (now - entry.lastFlushAt));
            entry.flushTimer = setTimeout(() => {
              entry.flushTimer = null;
              if (currentMode !== 'off' && entry.pendingPartial) {
                flushPartialToPanels(entry.pendingPartial);
              }
            }, delay);
          }
        }
      }
    )
      .then((res) => {
        if (entry.flushTimer) {
          clearTimeout(entry.flushTimer);
          entry.flushTimer = null;
        }
        if (inflightBySig.get(sig) === entry) {
          inflightBySig.delete(sig);
        }
        if (currentMode === 'off') return;

        if (res && res.ok && typeof res.text === 'string' && res.text.trim()) {
          const finalZh = res.text.trim();
          failedSigs.delete(sig);
          const fallbackCacheKey = hashKey(rawText, mode === 'machine' ? 'mt' : activeStyleTag || 'ai_technical');
          putMemCache(res.key || fallbackCacheKey, finalZh, true);

          for (const p of entry.panels) {
            if (!p || !p.isConnected) continue;
            const curRaw = extractRawEnglishText(p);
            if (curRaw && hashKey(curRaw, 'sig') !== entry.srcSkelHash) continue;
            renderTranslatedText(p, finalZh, false, sig);
          }
          // Rescan once in case user expanded a matching collapsed panel while request was in flight
          scheduleScan(30);
        } else {
          recordSigFailure(sig);
          for (const p of entry.panels) {
            if (p && p.isConnected) clearPendingKeepRaw(p);
          }
        }
      })
      .catch(() => {
        if (entry.flushTimer) {
          clearTimeout(entry.flushTimer);
          entry.flushTimer = null;
        }
        if (inflightBySig.get(sig) === entry) {
          inflightBySig.delete(sig);
        }
        recordSigFailure(sig);
        for (const p of entry.panels) {
          if (p && p.isConnected) clearPendingKeepRaw(p);
        }
      });
  }

  function processSingleTrigger(btn, allowPreloadCollapsed) {
    if (!btn) return;
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    if (!expanded && !allowPreloadCollapsed) return;

    const panel = btn.nextElementSibling;
    if (!panel || String(panel.tagName || '').toUpperCase() !== 'DIV') return;

    const streaming = isTriggerStreaming(btn);

    // O(1) fast-path: if panel is already rendered for current mode, not streaming, and child stamp unchanged -> skip!
    if (expanded && !streaming && panel.getAttribute('data-op-zh-ready') === '1') {
      const existingMeta = panelMeta.get(panel);
      const curStamp = quickPanelStamp(panel);
      if (
        existingMeta &&
        existingMeta.readyStamp === curStamp &&
        existingMeta.doneSig &&
        existingMeta.doneSig === panel.getAttribute('data-op-zh-sig')
      ) {
        return;
      }
    }

    const rawText = extractRawEnglishText(panel);
    if (!rawText || isMostlyZh(rawText)) {
      if (panel.getAttribute('data-op-zh-pending') === '1') clearPendingKeepRaw(panel);
      return;
    }

    const srcSkelHash = hashKey(rawText, 'sig');
    const sig = computeSig(rawText, currentMode);

    // Exact signature idempotence check: never rebuild DOM if already rendered with identical signature!
    if (expanded && !streaming && panel.getAttribute('data-op-zh-ready') === '1' && panel.getAttribute('data-op-zh-sig') === sig) {
      const meta = panelMeta.get(panel) || {};
      meta.doneSig = sig;
      meta.readyStamp = quickPanelStamp(panel);
      panelMeta.set(panel, meta);
      return;
    }

    const now = Date.now();
    let meta = panelMeta.get(panel);
    if (!meta) {
      meta = {
        lastSkelHash: srcSkelHash,
        lastChangeAt: now,
        sawStreaming: streaming,
        mutated: streaming,
        finishedAt: streaming ? 0 : now - FINISH_GATE_MS,
        doneSig: '',
        readyStamp: '',
      };
    } else if (meta.lastSkelHash !== srcSkelHash) {
      meta.lastSkelHash = srcSkelHash;
      meta.lastChangeAt = now;
      meta.mutated = true;
    }

    if (streaming) {
      meta.sawStreaming = true;
      meta.mutated = true;
      meta.finishedAt = 0;
      panelMeta.set(panel, meta);
      const prevT = waitTimers.get(panel);
      if (prevT) {
        clearTimeout(prevT);
        waitTimers.delete(panel);
      }
      if (expanded) {
        renderPendingState(panel, '思考流式输出中，完结后自动转译…');
      }
      return;
    }

    if (meta.sawStreaming && !meta.finishedAt) {
      meta.sawStreaming = false;
      meta.finishedAt = now;
    } else if (!meta.finishedAt) {
      meta.finishedAt = now - FINISH_GATE_MS;
    }
    panelMeta.set(panel, meta);

    // Instant cache hit bypasses stability wait gates cleanly
    const cached = findCachedTranslation(rawText, currentMode);
    if (cached) {
      const prevT = waitTimers.get(panel);
      if (prevT) {
        clearTimeout(prevT);
        waitTimers.delete(panel);
      }
      if (expanded) {
        renderTranslatedText(panel, cached, false, sig);
      }
      return;
    }

    // Reattach immediately if an identical flight is already running (e.g. panel just remounted/expanded)
    const activeFlight = inflightBySig.get(sig);
    if (activeFlight && now - activeFlight.startedAt <= 75000) {
      bindPanelToInflight(activeFlight, panel, expanded);
      return;
    }

    const finishRem = meta.mutated ? Math.max(0, FINISH_GATE_MS - (now - meta.finishedAt)) : 0;
    const quietRem = meta.mutated ? Math.max(0, QUIET_GATE_MS - (now - meta.lastChangeAt)) : 0;
    const waitMs = Math.max(finishRem, quietRem);

    if (waitMs > 0) {
      if (expanded) {
        renderPendingState(panel, '正在收束思考上下文…');
      }
      const prevT = waitTimers.get(panel);
      if (prevT) clearTimeout(prevT);
      waitTimers.set(
        panel,
        setTimeout(() => {
          waitTimers.delete(panel);
          if (currentMode !== 'off' && btn.isConnected) {
            processSingleTrigger(btn, allowPreloadCollapsed);
          }
        }, waitMs + 25)
      );
      return;
    }

    startOrJoinTranslation(panel, rawText, currentMode, sig, srcSkelHash, expanded);
  }

  function scanNow() {
    scanTimer = null;
    if (currentMode === 'off' || typeof document === 'undefined') return;
    const triggers = document.querySelectorAll('button[data-testid="thinking-collapsible-trigger"]');
    if (!triggers.length) return;
    const lastIdx = triggers.length - 1;
    for (let i = 0; i <= lastIdx; i++) {
      const allowPreload = triggerTiming === 'preload' && i === lastIdx;
      const btn = triggers[i];
      if (!allowPreload && btn.getAttribute('aria-expanded') !== 'true') continue;
      processSingleTrigger(btn, allowPreload);
    }
  }

  function scheduleScan(delayMs = 55) {
    if (currentMode === 'off') return;
    if (scanTimer) return;
    scanTimer = setTimeout(scanNow, delayMs);
  }

  const api = {
    sync(cfg = {}) {
      const nextMode =
        cfg.thoughtTranslate === 'machine' || cfg.thoughtTranslate === 'ai' ? cfg.thoughtTranslate : 'off';
      triggerTiming = cfg.thoughtTrigger === 'expand' ? 'expand' : 'preload';

      if (nextMode === 'off') {
        if (currentMode !== 'off') {
          currentMode = 'off';
          if (scanTimer) {
            clearTimeout(scanTimer);
            scanTimer = null;
          }
          releasePrismOverlays();
        }
        return;
      }

      const changed = currentMode !== nextMode;
      currentMode = nextMode;
      ensureInitialized();
      if (changed && typeof document !== 'undefined') {
        document
          .querySelectorAll('button[data-testid="thinking-collapsible-trigger"][aria-expanded="true"]')
          .forEach((b) => {
            const p = b.nextElementSibling;
            if (p) {
              p.removeAttribute('data-op-zh-sig');
              panelMeta.delete(p);
            }
          });
      }
      scheduleScan(25);
    },
    scan() {
      scheduleScan(45);
    },
    scanImmediate() {
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
      }
      scanNow();
    },
    getConfig() {
      const br = getBridge();
      if (!br) return Promise.resolve({ ok: false, offline: true });
      return br.call({ action: 'get-config' }).then((res) => {
        const nextTag = res?.styleTag || (res?.stylePreset ? `ai_${res.stylePreset}` : '');
        if (nextTag) activeStyleTag = nextTag;
        return res;
      });
    },
    saveConfig(input) {
      const br = getBridge();
      if (!br) return Promise.resolve({ ok: false, offline: true });
      return br.call({ action: 'save-config', ...input }).then((res) => {
        const nextTag = res?.styleTag || (res?.stylePreset ? `ai_${res.stylePreset}` : '');
        if (nextTag && nextTag !== activeStyleTag) {
          activeStyleTag = nextTag;
          if (typeof document !== 'undefined') {
            document
              .querySelectorAll('button[data-testid="thinking-collapsible-trigger"]')
              .forEach((b) => {
                const p = b.nextElementSibling;
                if (p) {
                  p.removeAttribute('data-op-zh-sig');
                  panelMeta.delete(p);
                }
              });
          }
          scheduleScan(25);
        }
        return res;
      });
    },
    fetchModels(input) {
      const br = getBridge();
      return br ? br.call({ action: 'fetch-models', ...input }) : Promise.resolve({ ok: false, offline: true });
    },
    testConnection(input) {
      const br = getBridge();
      return br ? br.call({ action: 'test-connection', ...input }) : Promise.resolve({ ok: false, offline: true });
    },
    destroy() {
      currentMode = 'off';
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
      }
      releasePrismOverlays();
    },
  };

  W.__agPrismThought = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
