// Obsidian Prism — Unified Thought Translator & Polisher Client Runtime
// - Zero extra document-wide MutationObserver: driven by Obsidian Prism's incremental scheduler
// - Dual-gate stability (450ms finish + 850ms quiet), minHeight anti-jank lock, and zero-XSS pure DOM Markdown renderer

(function (root) {
  'use strict';
  const W = root || (typeof window !== 'undefined' ? window : globalThis);
  if (!W) return;

  const OWNER_ID = 'obsidian-prism-thought';
  const STREAM_FLUSH_MS = 55;
  const FINISH_GATE_MS = 450;
  const QUIET_GATE_MS = 850;

  let currentMode = 'off'; // 'off' | 'machine' | 'ai'
  let triggerTiming = 'preload'; // 'preload' | 'expand'
  let activeStylePreset = ''; // '' | 'technical' | 'concise' | 'custom'
  let cacheWarmed = false;
  let scanTimer = null;

  const memCache = new Map();
  const panelMeta = new WeakMap();
  const waitTimers = new WeakMap();
  const flushTimers = new WeakMap();
  const lockedHeights = new WeakMap();

  function canonicalizeSkeleton(str) {
    return String(str || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, '')
      .toLowerCase();
  }

  function hashKey(rawText, prefix) {
    const norm = String(rawText || '').trim();
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
    const s = String(text || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
    if (!s.trim()) return true;
    const cjk = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
    const latin = (s.match(/[A-Za-z]{3,}/g) || []).length;
    if (cjk >= 24 && cjk > latin * 0.85) return true;
    if (latin <= 2 && cjk >= 4) return true;
    return false;
  }

  function getBridge() {
    return W.__agPrismThoughtBridge || null;
  }

  function ensureInitialized() {
    try {
      const docEl = typeof document !== 'undefined' && document.documentElement;
      if (docEl) {
        docEl.setAttribute('data-ag-prism-thought-owner', OWNER_ID);
      }
    } catch (_) {}

    if (cacheWarmed) return;
    cacheWarmed = true;
    const br = getBridge();
    if (br && typeof br.call === 'function') {
      br.call({ action: 'get-cache' })
        .then((res) => {
          if (res && res.stylePreset) activeStylePreset = res.stylePreset;
          if (res && res.entries && typeof res.entries === 'object') {
            for (const [k, v] of Object.entries(res.entries)) {
              if (k && typeof v === 'string') memCache.set(k, v);
            }
          }
        })
        .catch(() => {});
    }
  }

  function releasePrismOverlays() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.ag-prism-thought-overlay[data-op-thought="1"]').forEach((ov) => {
      const panel = ov.parentElement;
      ov.remove();
      if (panel) {
        panel.removeAttribute('data-op-zh-ready');
        panel.removeAttribute('data-op-zh-pending');
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
    try {
      if (
        btn.querySelector(
          '.animate-shimmer-text, .animate-spin, .animate-pulse, .ag-cs-thinking-spark[data-state="streaming"]'
        )
      ) {
        return true;
      }
    } catch (_) {}
    const txt = (btn.textContent || '').trim();
    if (/thinking|思考中|推演中|諗緊/i.test(txt) && !/\d+\s*(s|sec|秒|m|min|分)/i.test(txt)) {
      return true;
    }
    return false;
  }

  function extractRawEnglishText(panel) {
    if (!panel) return '';
    const parts = [];
    for (const child of Array.from(panel.childNodes)) {
      if (child.nodeType === 1 && child.classList && child.classList.contains('ag-prism-thought-overlay')) {
        continue;
      }
      const t = (child.textContent || '').trim();
      if (t) parts.push(t);
    }
    return parts.join('\n\n').trim();
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
    const doc = container.ownerDocument || document;
    while (container.firstChild) container.removeChild(container.firstChild);

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

  function ensureOverlayShell(panel) {
    const doc = panel.ownerDocument || document;
    let ov = panel.querySelector(':scope > .ag-prism-thought-overlay');
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
    const ov = ensureOverlayShell(panel);
    const body = ov.querySelector('.ag-prism-thought-body');
    if (body) {
      while (body.firstChild) body.removeChild(body.firstChild);
      const hint = (panel.ownerDocument || document).createElement('span');
      hint.className = 'ag-prism-thought-pending-hint';
      hint.textContent = message;
      body.appendChild(hint);
    }
    panel.setAttribute('data-op-zh-pending', '1');
    panel.removeAttribute('data-op-zh-ready');
  }

  function renderTranslatedText(panel, text, isPartial) {
    const ov = ensureOverlayShell(panel);
    const body = ov.querySelector('.ag-prism-thought-body');
    if (!body) return;

    if (isPartial) {
      let streamEl = body.querySelector('.ag-prism-thought-stream');
      if (!streamEl) {
        while (body.firstChild) body.removeChild(body.firstChild);
        streamEl = (panel.ownerDocument || document).createElement('p');
        streamEl.className = 'ag-prism-thought-stream';
        body.appendChild(streamEl);
      }
      streamEl.textContent = text;
      const curH = panel.offsetHeight || 0;
      const nextMinH = Math.max(lockedHeights.get(panel) || 0, curH);
      if (nextMinH > 0 && panel.style) {
        lockedHeights.set(panel, nextMinH);
        panel.style.minHeight = `${nextMinH}px`;
      }
    } else {
      renderSafeMarkdownDom(body, text);
      lockedHeights.delete(panel);
      if (panel.style) panel.style.removeProperty('min-height');
    }

    panel.removeAttribute('data-op-zh-pending');
    panel.setAttribute('data-op-zh-ready', '1');
  }

  function findCachedTranslation(rawText, mode) {
    if (mode === 'machine') {
      return memCache.get(hashKey(rawText, 'mt')) || '';
    }
    if (activeStylePreset) {
      const kExact = hashKey(rawText, `ai_${activeStylePreset}`);
      if (memCache.has(kExact)) return memCache.get(kExact) || '';
      return '';
    }
    const kCustom = hashKey(rawText, 'ai_custom');
    const kTech = hashKey(rawText, 'ai_technical');
    const kConcise = hashKey(rawText, 'ai_concise');
    return memCache.get(kCustom) || memCache.get(kTech) || memCache.get(kConcise) || '';
  }

  function triggerPanelTranslation(panel, rawText, mode) {
    const cached = findCachedTranslation(rawText, mode);
    if (cached) {
      renderTranslatedText(panel, cached, false);
      return;
    }

    const br = getBridge();
    if (!br || typeof br.translateStream !== 'function') return;

    const meta = panelMeta.get(panel) || {};
    const sig = `${mode}:${hashKey(rawText, 'sig')}`;
    if (meta.inflightSig === sig || meta.doneSig === sig) return;

    meta.inflightSig = sig;
    panelMeta.set(panel, meta);

    renderPendingState(
      panel,
      mode === 'machine' ? '正在极速机翻思考过程…' : '正在通过 AI 转译并润色思考过程…'
    );

    let pendingPartial = '';
    const flushPartial = () => {
      flushTimers.delete(panel);
      if (!panel.isConnected || !pendingPartial) return;
      renderTranslatedText(panel, pendingPartial, true);
    };

    br.translateStream(
      { text: rawText, mode },
      (partial) => {
        if (!panel.isConnected || typeof partial !== 'string' || !partial) return;
        pendingPartial = partial;
        if (!flushTimers.has(panel)) {
          flushTimers.set(panel, setTimeout(flushPartial, STREAM_FLUSH_MS));
        }
      }
    )
      .then((res) => {
        const ft = flushTimers.get(panel);
        if (ft) {
          clearTimeout(ft);
          flushTimers.delete(panel);
        }
        const curMeta = panelMeta.get(panel) || {};
        curMeta.inflightSig = '';
        if (!panel.isConnected) return;

        if (res && res.ok && res.text) {
          curMeta.doneSig = sig;
          panelMeta.set(panel, curMeta);
          if (res.key) memCache.set(res.key, res.text);
          else memCache.set(hashKey(rawText, mode === 'machine' ? 'mt' : 'ai_technical'), res.text);
          renderTranslatedText(panel, res.text, false);
        } else {
          panelMeta.set(panel, curMeta);
          const ov = panel.querySelector(':scope > .ag-prism-thought-overlay[data-op-thought="1"]');
          if (ov) ov.remove();
          panel.removeAttribute('data-op-zh-pending');
          panel.removeAttribute('data-op-zh-ready');
          if (panel.style) panel.style.removeProperty('min-height');
        }
      })
      .catch(() => {
        const curMeta = panelMeta.get(panel) || {};
        curMeta.inflightSig = '';
        panelMeta.set(panel, curMeta);
      });
  }

  function processSingleTrigger(btn, allowPreloadCollapsed) {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    if (!expanded && !allowPreloadCollapsed) return;

    const panel = btn.nextElementSibling;
    if (!panel || panel.tagName !== 'DIV') return;

    const now = Date.now();
    const streaming = isTriggerStreaming(btn);
    const rawText = extractRawEnglishText(panel);
    if (!rawText || isMostlyZh(rawText)) return;

    const meta = panelMeta.get(panel) || {
      lastRaw: '',
      lastChangeAt: now,
      finishedAt: streaming ? 0 : now - FINISH_GATE_MS,
      inflightSig: '',
      doneSig: '',
    };

    if (meta.lastRaw !== rawText) {
      meta.lastRaw = rawText;
      meta.lastChangeAt = now;
    }
    if (streaming) {
      meta.finishedAt = 0;
      panelMeta.set(panel, meta);
      if (expanded) {
        renderPendingState(panel, '思考流式输出中，完结后自动转译…');
      }
      return;
    }

    if (!meta.finishedAt) {
      meta.finishedAt = now;
    }
    panelMeta.set(panel, meta);

    const cached = findCachedTranslation(rawText, currentMode);
    if (cached) {
      if (expanded) renderTranslatedText(panel, cached, false);
      return;
    }

    const finishRem = Math.max(0, FINISH_GATE_MS - (now - meta.finishedAt));
    const quietRem = Math.max(0, QUIET_GATE_MS - (now - meta.lastChangeAt));
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

    if (expanded) {
      triggerPanelTranslation(panel, rawText, currentMode);
    } else if (allowPreloadCollapsed) {
      const br = getBridge();
      if (br && typeof br.translateStream === 'function') {
        const sig = `${currentMode}:${hashKey(rawText, 'sig')}`;
        if (meta.inflightSig !== sig && meta.doneSig !== sig) {
          meta.inflightSig = sig;
          panelMeta.set(panel, meta);
          br.translateStream({ text: rawText, mode: currentMode }, null)
            .then((res) => {
              meta.inflightSig = '';
              if (res && res.ok && res.text) {
                meta.doneSig = sig;
                if (res.key) memCache.set(res.key, res.text);
              }
            })
            .catch(() => {
              meta.inflightSig = '';
            });
        }
      }
    }
  }

  function scanNow() {
    scanTimer = null;
    if (currentMode === 'off' || typeof document === 'undefined') return;
    const triggers = document.querySelectorAll('button[data-testid="thinking-collapsible-trigger"]');
    if (!triggers.length) return;
    const lastIdx = triggers.length - 1;
    for (let i = 0; i <= lastIdx; i++) {
      const allowPreload = triggerTiming === 'preload' && i === lastIdx;
      processSingleTrigger(triggers[i], allowPreload);
    }
  }

  function scheduleScan(delayMs = 40) {
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
            if (p) panelMeta.delete(p);
          });
      }
      scheduleScan(20);
    },
    scan() {
      scheduleScan(30);
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
        if (res && res.stylePreset) activeStylePreset = res.stylePreset;
        return res;
      });
    },
    saveConfig(input) {
      const br = getBridge();
      if (!br) return Promise.resolve({ ok: false, offline: true });
      return br.call({ action: 'save-config', ...input }).then((res) => {
        if (res && res.stylePreset) activeStylePreset = res.stylePreset;
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
