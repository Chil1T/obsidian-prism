(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    const api = factory(root);
    root.__agPrismTelemetry = api;
    if (typeof window !== 'undefined') window.__agPrismTelemetry = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function (globalRoot) {
  'use strict';

  const BAR_ID = 'ag-pulse-status-bar';
  const FALLBACK_ATTR = 'data-ag-prism-fallback';
  const HIDDEN_BY_PRISM_ATTR = 'data-ag-prism-hidden';
  const METRICS_BINDING = '__agPrismMetricsCall';
  const DEFAULT_WAIT_MS = 1500;
  const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const FALLBACK_SHADOW_CSS = [
    ':host{display:inline-flex;align-items:center;position:relative;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:11px;line-height:16px;color:var(--foreground,#dae2f0);user-select:none;z-index:20}',
    ':host([hidden]){display:none!important}',
    '.bar{display:inline-flex;align-items:center;gap:3px}',
    '.chip{display:inline-flex;align-items:center;gap:3.5px;height:24px;padding:0 6px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer;font-variant-numeric:tabular-nums;transition:background .15s,color .15s}',
    '.chip:hover,.chip[aria-expanded="true"]{background:rgba(128,138,158,.12)}',
    '.chip svg{width:12px;height:12px;stroke:currentColor;stroke-width:1.5;fill:none;opacity:.75;flex:none}',
    '.dim{opacity:.64;font-size:10px}',
    '.context-ring{width:11px;height:11px;border-radius:50%;background:conic-gradient(var(--pv-tint,#3186ff) var(--used-angle,36deg),rgba(148,163,184,.28) 0);display:inline-block;position:relative;flex:none}',
    '.context-ring::after{content:"";position:absolute;inset:2.2px;border-radius:50%;background:var(--card,#141720)}',
    '.card{position:fixed;right:18px;bottom:68px;width:min(320px,calc(100vw - 24px));padding:13px 14px 12px;border-radius:10px;border:1px solid rgba(148,163,184,.22);background:var(--card,#12151ef5);color:var(--foreground,#eef1f7);box-shadow:0 16px 40px rgba(0,0,0,.36);z-index:9999}',
    '.card[hidden]{display:none!important}',
    '.heading{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;font-weight:600;margin-bottom:6px}',
    '#context-summary{display:block;font-size:13px;font-weight:600;margin-bottom:2px}',
    '#context-tokens{margin:0 0 8px;font-size:11px;opacity:.76}',
    '.track{height:5px;border-radius:999px;background:rgba(148,163,184,.18);overflow:hidden;margin:6px 0 10px}',
    '.track>i{display:block;height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#2563eb,#38bdf8)}',
    'dl{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin:8px 0;font-size:11px}',
    'dt{opacity:.64}dd{margin:0;text-align:right;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.footnote{margin:6px 0 0;font-size:10px;opacity:.58}',
  ].join('');

  function createTelemetryController(envOpts) {
    const getWin = () => (envOpts && envOpts.window) || (typeof window !== 'undefined' ? window : globalRoot);
    const getDoc = () => (envOpts && envOpts.document) || getWin()?.document || null;

    let currentMode = 'auto';
    let waitTimer = null;
    let rescueTimer = null;
    let pollTimer = null;
    let fallbackHostEl = null;
    let shadowRoot = null;
    let installedHostBridge = false;
    let yieldedToExternal = false;
    let lastExternalSig = '';
    let externalDetachedAt = 0;
    const EXTERNAL_RESCUE_GRACE_MS = 3500;
    let reqSeq = 0;
    const pendingReqs = new Map();
    let docClickCleanup = null;

    function resolveMetricsBindingHook() {
      const win = getWin();
      if (!win) return;
      if (!win.__agPrismMetricsResolve) {
        win.__agPrismMetricsResolve = function (id, payload) {
          const item = pendingReqs.get(id);
          if (!item) return;
          clearTimeout(item.timer);
          pendingReqs.delete(id);
          item.resolve(payload);
        };
      }
    }

    function clearWaitTimer() {
      if (waitTimer !== null) {
        clearTimeout(waitTimer);
        waitTimer = null;
      }
      if (rescueTimer !== null) {
        clearTimeout(rescueTimer);
        rescueTimer = null;
      }
    }

    function clearPollTimer() {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function findExistingBar(doc) {
      if (!doc) return null;
      if (typeof doc.querySelectorAll === 'function') {
        const all = doc.querySelectorAll('#' + BAR_ID);
        for (let i = 0; i < all.length; i++) {
          if (all[i].getAttribute?.(FALLBACK_ATTR) !== '1') return all[i];
        }
        if (all.length > 0) return all[0];
      }
      if (typeof doc.getElementById === 'function') return doc.getElementById(BAR_ID);
      return null;
    }

    function purgeOrphanFallbacks(doc, keepEl = null) {
      if (!doc || typeof doc.querySelectorAll !== 'function') return;
      const orphans = doc.querySelectorAll('[' + FALLBACK_ATTR + '="1"]');
      for (let i = 0; i < orphans.length; i++) {
        if (orphans[i] !== keepEl) {
          try {
            orphans[i].remove();
          } catch {}
        }
      }
    }

    function isNodeConnected(doc, el) {
      if (!el) return false;
      if (el.isConnected === false) return false;
      if (el.isConnected === true) return true;
      if (!el.parentNode && !el.parentElement) return false;
      if (doc && typeof doc.getElementById === 'function' && el.id && typeof doc.querySelectorAll !== 'function') {
        const byId = doc.getElementById(el.id);
        if (byId && byId !== el) return false;
      }
      return true;
    }

    function hasExternalPulse() {
      const win = getWin();
      const doc = getDoc();
      if (!win || !doc) return false;
      const existing = findExistingBar(doc);
      if (existing && existing.getAttribute(FALLBACK_ATTR) !== '1' && isNodeConnected(doc, existing)) {
        externalDetachedAt = 0;
        return true;
      }
      const extSig = [
        win.__agPulseRuntimeOwner ? String(win.__agPulseRuntimeOwner) : '',
        win.__agPulseInlineInstalled ? '1' : '',
        win.agPulseHost && !win.agPulseHost.__prismFallback ? 'host' : '',
      ].join('|');
      if (extSig !== '||') {
        const now = Date.now();
        if (extSig !== lastExternalSig) {
          lastExternalSig = extSig;
          externalDetachedAt = now;
          return true;
        }
        if (!externalDetachedAt) externalDetachedAt = now;
        if (now - externalDetachedAt < EXTERNAL_RESCUE_GRACE_MS) {
          return true;
        }
        // External globals lingered >3.5s without any connected #ag-pulse-status-bar (e.g. detached by React route switch):
        // allow Prism's built-in Dashboard to self-heal and rescue the toolbar!
        return false;
      }
      lastExternalSig = '';
      externalDetachedAt = 0;
      return false;
    }

    function restoreExternalVisibility() {
      const doc = getDoc();
      const existing = findExistingBar(doc);
      if (existing && existing.getAttribute(HIDDEN_BY_PRISM_ATTR) === '1') {
        existing.removeAttribute(HIDDEN_BY_PRISM_ATTR);
        if (existing.style && typeof existing.style.removeProperty === 'function') {
          existing.style.removeProperty('display');
        }
      }
    }

    function hideExternalBarIfPresent() {
      const doc = getDoc();
      const existing = findExistingBar(doc);
      if (existing && existing.getAttribute(FALLBACK_ATTR) !== '1') {
        existing.setAttribute(HIDDEN_BY_PRISM_ATTR, '1');
        if (existing.style && typeof existing.style.setProperty === 'function') {
          existing.style.setProperty('display', 'none', 'important');
        }
      }
    }

    function unmountFallback() {
      clearWaitTimer();
      clearPollTimer();
      if (docClickCleanup) {
        try { docClickCleanup(); } catch {}
        docClickCleanup = null;
      }
      for (const item of pendingReqs.values()) {
        clearTimeout(item.timer);
        item.resolve(null);
      }
      pendingReqs.clear();

      const win = getWin();
      if (installedHostBridge && win && win.agPulseHost && win.agPulseHost.__prismFallback) {
        delete win.agPulseHost;
      }
      installedHostBridge = false;

      if (fallbackHostEl) {
        try {
          win?.__agPulseExternalBridge?.({ event: 'dispose' });
        } catch {}
        try {
          fallbackHostEl.remove();
        } catch {}
      }
      purgeOrphanFallbacks(getDoc(), null);
      fallbackHostEl = null;
      shadowRoot = null;
    }

    function mk(doc, tag, attrs, children) {
      const el = doc.createElement(tag);
      if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
          if (v === undefined || v === null) continue;
          if (k === 'text') el.textContent = String(v);
          else if (k === 'className') el.className = String(v);
          else if (k === 'hidden') el.hidden = Boolean(v);
          else el.setAttribute(k, String(v));
        }
      }
      if (Array.isArray(children)) {
        for (const ch of children) {
          if (ch) el.appendChild(ch);
        }
      }
      return el;
    }

    function detectConversationId(hostNode) {
      const win = getWin();
      try {
        const cascadeEl = hostNode?.closest?.('[data-cascade-id]');
        const cid = cascadeEl?.getAttribute?.('data-cascade-id');
        if (cid && GUID_RE.test(cid)) return cid;
        const m = win?.location?.pathname?.match?.(/\/c\/([0-9a-f-]{36})/i);
        return m ? m[1] : null;
      } catch {
        return null;
      }
    }

    let cachedLocalSnap = null;
    let cachedLocalSnapAt = 0;

    function estimateLocalSnapshot() {
      const now = Date.now();
      if (cachedLocalSnap && now - cachedLocalSnapAt < 5000) {
        return cachedLocalSnap;
      }
      const doc = getDoc();
      let model = 'Gemini 4';
      let charCount = 0;
      try {
        const trigger = doc?.querySelector?.('[data-testid="model-selector-trigger"]');
        const label = trigger?.getAttribute?.('aria-label') || trigger?.textContent?.trim();
        if (label) model = label;
        const view = doc?.querySelector?.('[data-testid="conversation-view"]');
        if (view && typeof view.querySelectorAll === 'function') {
          const turns = view.querySelectorAll('[data-testid="planner-response-text"], [data-testid="user-message-bubble"]');
          if (turns && turns.length > 0) {
            const sampleCount = Math.min(4, turns.length);
            let sampleChars = 0;
            for (let i = turns.length - sampleCount; i < turns.length; i++) {
              sampleChars += (turns[i].textContent || '').length;
            }
            charCount = Math.round((sampleChars / sampleCount) * turns.length);
          }
        } else if (view && typeof view.textContent === 'string') {
          charCount = view.textContent.length;
        }
      } catch {}
      const maxTokens = 512000;
      const usedTokens = Math.max(4200, Math.min(maxTokens, Math.round(charCount / 3.2) + 8400));
      const usedFraction = Math.min(0.98, usedTokens / maxTokens);
      cachedLocalSnapAt = now;
      cachedLocalSnap = {
        connection: 'local-estimate',
        speed: {
          model,
          tps: null,
          latestTps: null,
          ttftSeconds: null,
          rounds: 0,
          cacheHitRate: null,
          totalTokens: usedTokens,
          context: {
            model,
            usedTokens,
            maxTokens,
            usedFraction,
            sampledAt: now,
          },
        },
        groups: [],
      };
      return cachedLocalSnap;
    }

    function requestMetricsSnapshot(input) {
      const win = getWin();
      resolveMetricsBindingHook();
      if (win && typeof win[METRICS_BINDING] === 'function') {
        return new Promise((resolve) => {
          if (pendingReqs.size >= 6) {
            resolve(estimateLocalSnapshot());
            return;
          }
          const id = ++reqSeq;
          const timer = setTimeout(() => {
            pendingReqs.delete(id);
            resolve(estimateLocalSnapshot());
          }, 3500);
          pendingReqs.set(id, { resolve, timer });
          try {
            win[METRICS_BINDING](JSON.stringify({ id, input: input || {} }));
          } catch {
            clearTimeout(timer);
            pendingReqs.delete(id);
            resolve(estimateLocalSnapshot());
          }
        });
      }
      return Promise.resolve(estimateLocalSnapshot());
    }

    function fmtTok(n) {
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '—';
      if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
      if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
      return String(Math.round(n));
    }

    function applySnapshotToDom(snap) {
      if (!shadowRoot || !fallbackHostEl) return;
      const sp = snap?.speed || {};
      const ctx = sp.context || {};
      const maxTok = ctx.maxTokens > 0 ? ctx.maxTokens : 512000;
      const usedFrac =
        typeof ctx.usedFraction === 'number' && Number.isFinite(ctx.usedFraction)
          ? Math.max(0, Math.min(1, ctx.usedFraction))
          : 0.04;
      const usedTok =
        typeof ctx.usedTokens === 'number' && Number.isFinite(ctx.usedTokens)
          ? ctx.usedTokens
          : Math.round(usedFrac * maxTok);
      const pct = Math.round(usedFrac * 100);
      const remPct = Math.max(0, 100 - pct);
      const model = ctx.model || sp.model || 'Antigravity Model';

      const setTxt = (id, val) => {
        const el = shadowRoot.getElementById(id);
        if (el && el.textContent !== String(val)) el.textContent = String(val);
      };

      setTxt('rounds', sp.rounds > 0 ? `${sp.rounds}r` : '—');
      setTxt('tps', typeof sp.tps === 'number' && sp.tps > 0 ? sp.tps.toFixed(1) : '—');
      setTxt('cache-total', sp.totalTokens > 0 ? `${fmtTok(sp.totalTokens)} tok` : `${fmtTok(usedTok)} tok`);
      setTxt(
        'cache-rate',
        typeof sp.cacheHitRate === 'number' && Number.isFinite(sp.cacheHitRate)
          ? `${(sp.cacheHitRate * 100).toFixed(1)}%`
          : '—'
      );
      setTxt('context-percent', `${pct}%`);
      setTxt('ttft', typeof sp.ttftSeconds === 'number' ? `${sp.ttftSeconds.toFixed(2)}s` : '—');
      setTxt('latest-rate', typeof sp.latestTps === 'number' ? `${sp.latestTps.toFixed(1)} tok/s` : '—');
      setTxt('context-summary', `${pct}% 已用 · ${remPct}% 剩余`);
      setTxt('context-tokens', `${fmtTok(usedTok)} / ${fmtTok(maxTok)} tok`);
      setTxt('context-model', model);
      setTxt('context-note', snap?.connection === 'local-estimate' ? 'Prism 本地上下文估算' : 'Prism 实时遥测同步');

      const fillEl = shadowRoot.getElementById('context-fill');
      if (fillEl && fillEl.style) fillEl.style.width = `${pct}%`;
      const ringEl = shadowRoot.getElementById('context-ring');
      if (ringEl && ringEl.style) {
        ringEl.style.setProperty('--used-angle', `${Math.round(usedFrac * 360)}deg`);
      }

      try {
        getWin()?.__agPulseExternalBridge?.({ event: 'render', data: snap });
      } catch {}
    }

    async function refreshMetrics() {
      const doc = getDoc();
      if (currentMode === 'auto' && hasExternalPulse()) {
        yieldedToExternal = true;
        unmountFallback();
        return null;
      }
      if (currentMode !== 'off' && fallbackHostEl) {
        if (!isNodeConnected(doc, fallbackHostEl)) {
          const anchor = doc ? findMountAnchor(doc) : null;
          if (anchor) {
            try { anchor.appendChild(fallbackHostEl); } catch {}
          }
        } else if (doc) {
          const preferred = findPreferredToolbarAnchor(doc);
          if (preferred && fallbackHostEl.parentElement !== preferred) {
            try { preferred.appendChild(fallbackHostEl); } catch {}
          }
        }
      }
      if (!fallbackHostEl || !isNodeConnected(doc, fallbackHostEl)) {
        if (currentMode !== 'off' && !hasExternalPulse() && waitTimer === null) {
          mountFallbackNow();
        }
        if (!fallbackHostEl) return null;
      }
      const cid = detectConversationId(fallbackHostEl);
      const snap = await requestMetricsSnapshot({ conversationId: cid, force: false });
      applySnapshotToDom(snap);
      return snap;
    }

    function findPreferredToolbarAnchor(doc) {
      const footer = doc?.querySelector?.('.agy-composer-footer, [data-testid="input-box-bottom-toolbar"]');
      if (footer) return footer;
      const modelBtn = doc?.querySelector?.('[data-testid="model-selector-trigger"]');
      return modelBtn && modelBtn.parentElement ? modelBtn.parentElement : null;
    }

    function findMountAnchor(doc) {
      const toolbar = findPreferredToolbarAnchor(doc);
      if (toolbar) return toolbar;
      const composer = doc.querySelector?.('.surface-composer-card, [data-testid="agent-input-box"]');
      if (composer) return composer;
      const cascade = doc.querySelector?.('[data-cascade-id]');
      if (cascade) return cascade;
      return doc.body || doc.documentElement;
    }

    function ensureFallbackSeated(doc) {
      if (!fallbackHostEl || !doc) return false;
      const preferred = findPreferredToolbarAnchor(doc);
      if (!isNodeConnected(doc, fallbackHostEl)) {
        const anchor = preferred || findMountAnchor(doc);
        if (!anchor) return false;
        try {
          anchor.appendChild(fallbackHostEl);
          return true;
        } catch {
          return false;
        }
      }
      if (preferred && fallbackHostEl.parentElement !== preferred) {
        try {
          preferred.appendChild(fallbackHostEl);
        } catch {}
      }
      return true;
    }

    function mountFallbackNow() {
      const win = getWin();
      const doc = getDoc();
      if (!win || !doc || typeof doc.attachShadow === 'undefined' && typeof doc.createElement !== 'function') return false;
      if (currentMode === 'off') return false;
      if (hasExternalPulse()) {
        yieldedToExternal = true;
        return false;
      }
      if (fallbackHostEl && ensureFallbackSeated(doc)) return true;

      const anchor = findMountAnchor(doc);
      if (!anchor) return false;

      const host = mk(doc, 'div', { id: BAR_ID, [FALLBACK_ATTR]: '1' });
      if (typeof host.attachShadow !== 'function') return false;
      const sr = host.attachShadow({ mode: 'open' });
      sr.appendChild(mk(doc, 'style', { text: FALLBACK_SHADOW_CSS }));

      const speedChip = mk(doc, 'button', { type: 'button', className: 'chip', 'data-card': 'speed' }, [
        mk(doc, 'span', { className: 'rounds dim', id: 'rounds', text: '—' }),
        mk(doc, 'strong', { id: 'tps', text: '—' }),
        mk(doc, 'span', { className: 'dim', text: 'tok/s' }),
      ]);
      const cacheChip = mk(doc, 'button', { type: 'button', className: 'chip', 'data-card': 'cache' }, [
        mk(doc, 'span', { className: 'cache-total', id: 'cache-total', text: '—' }),
        mk(doc, 'span', { className: 'dim', text: '·' }),
        mk(doc, 'span', { 'data-i18n': 'cache', text: '缓存' }),
        mk(doc, 'strong', { id: 'cache-rate', text: '—' }),
      ]);
      const ctxChip = mk(
        doc,
        'button',
        { type: 'button', className: 'chip', 'data-card': 'context', 'aria-expanded': 'false' },
        [
          mk(doc, 'span', { className: 'context-ring', id: 'context-ring' }),
          mk(doc, 'span', { className: 'context-label dim', 'data-i18n': 'contextShort', text: 'Ctx' }),
          mk(doc, 'strong', { id: 'context-percent', text: '0%' }),
        ]
      );

      const bar = mk(doc, 'div', { className: 'bar' }, [speedChip, cacheChip, ctxChip]);
      const speedCard = mk(doc, 'section', { className: 'card', id: 'speed-card', hidden: true }, [
        mk(doc, 'div', { className: 'heading' }, [mk(doc, 'span', { text: '吞吐速率' })]),
        mk(doc, 'dl', null, [
          mk(doc, 'dt', { text: '首字延迟' }),
          mk(doc, 'dd', { id: 'ttft', text: '—' }),
          mk(doc, 'dt', { text: '最近速率' }),
          mk(doc, 'dd', { id: 'latest-rate', text: '—' }),
        ]),
      ]);

      const fillEl = mk(doc, 'i', { id: 'context-fill' });
      const trackEl = mk(doc, 'div', { className: 'track', id: 'context-track' }, [fillEl]);
      const ctxCard = mk(doc, 'section', { className: 'card context-card', id: 'context-card', hidden: true }, [
        mk(doc, 'div', { className: 'heading' }, [mk(doc, 'span', { text: '上下文窗口与 512K 试管' })]),
        mk(doc, 'strong', { id: 'context-summary', text: '0% 已用 · 100% 剩余' }),
        mk(doc, 'p', { id: 'context-tokens', text: '— / 512K tok' }),
        trackEl,
        mk(doc, 'dl', null, [
          mk(doc, 'dt', { text: '当前模型' }),
          mk(doc, 'dd', { id: 'context-model', text: '—' }),
        ]),
        mk(doc, 'p', { className: 'footnote', id: 'context-note', text: 'Prism 实时遥测同步' }),
      ]);

      sr.appendChild(bar);
      sr.appendChild(speedCard);
      sr.appendChild(ctxCard);

      const toggleCard = (targetCard, triggerBtn) => {
        const nextOpen = Boolean(targetCard.hidden);
        speedCard.hidden = true;
        ctxCard.hidden = true;
        speedChip.setAttribute('aria-expanded', 'false');
        ctxChip.setAttribute('aria-expanded', 'false');
        targetCard.hidden = !nextOpen;
        triggerBtn.setAttribute('aria-expanded', String(nextOpen));
        if (nextOpen) void refreshMetrics();
        try {
          win.__agPulseExternalBridge?.({ event: 'card' });
        } catch {}
      };

      ctxChip.addEventListener('click', (e) => {
        e?.stopPropagation?.();
        toggleCard(ctxCard, ctxChip);
      });
      speedChip.addEventListener('click', (e) => {
        e?.stopPropagation?.();
        toggleCard(speedCard, speedChip);
      });

      if (typeof doc.addEventListener === 'function') {
        const onDocClick = (ev) => {
          if (ev?.target === host || host.contains?.(ev?.target)) return;
          if (!ctxCard.hidden || !speedCard.hidden) {
            ctxCard.hidden = true;
            speedCard.hidden = true;
            ctxChip.setAttribute('aria-expanded', 'false');
            speedChip.setAttribute('aria-expanded', 'false');
            try { win.__agPulseExternalBridge?.({ event: 'card' }); } catch {}
          }
        };
        doc.addEventListener('click', onDocClick);
        docClickCleanup = () => doc.removeEventListener('click', onDocClick);
      }

      purgeOrphanFallbacks(doc, null);
      anchor.appendChild(host);
      fallbackHostEl = host;
      shadowRoot = sr;
      yieldedToExternal = false;

      if (!win.agPulseHost) {
        win.agPulseHost = {
          __prismFallback: true,
          getMetrics: (input) => requestMetricsSnapshot(input),
          getPreferences: () => Promise.resolve({ language: 'zh-CN' }),
          setPreferences: (v) => Promise.resolve(v || {}),
          report: () => {},
        };
        installedHostBridge = true;
      }

      void refreshMetrics();
      clearPollTimer();
      pollTimer = setInterval(() => {
        if (doc.hidden) return;
        void refreshMetrics();
      }, 4000);
      if (pollTimer && typeof pollTimer.unref === 'function') pollTimer.unref();

      return true;
    }

    function sync(cfg) {
      const raw = cfg && cfg.telemetryModule;
      currentMode = raw === 'on' || raw === 'off' ? raw : 'auto';

      if (currentMode === 'off') {
        yieldedToExternal = false;
        unmountFallback();
        hideExternalBarIfPresent();
        return getState();
      }

      restoreExternalVisibility();

      if (hasExternalPulse()) {
        yieldedToExternal = true;
        unmountFallback();
        if (externalDetachedAt > 0 && rescueTimer === null) {
          rescueTimer = setTimeout(() => {
            rescueTimer = null;
            if (currentMode === 'off') return;
            if (!hasExternalPulse()) {
              mountFallbackNow();
            }
          }, EXTERNAL_RESCUE_GRACE_MS + 60);
          if (rescueTimer && typeof rescueTimer.unref === 'function') rescueTimer.unref();
        }
        return getState();
      }

      if (currentMode === 'on') {
        clearWaitTimer();
        mountFallbackNow();
        return getState();
      }

      // currentMode === 'auto': wait 1500ms politely for external Pulse plugin before fallback mount
      const doc = getDoc();
      if (fallbackHostEl) {
        if (ensureFallbackSeated(doc)) {
          return getState();
        }
      }
      if (waitTimer === null) {
        const waitMs =
          typeof cfg?.__fallbackDelayMs === 'number' && cfg.__fallbackDelayMs >= 0
            ? cfg.__fallbackDelayMs
            : DEFAULT_WAIT_MS;
        waitTimer = setTimeout(() => {
          waitTimer = null;
          if (currentMode !== 'auto') return;
          if (hasExternalPulse()) {
            yieldedToExternal = true;
            unmountFallback();
            return;
          }
          mountFallbackNow();
        }, waitMs);
        if (waitTimer && typeof waitTimer.unref === 'function') waitTimer.unref();
      }
      return getState();
    }

    function destroy() {
      clearWaitTimer();
      unmountFallback();
      restoreExternalVisibility();
      yieldedToExternal = false;
      lastExternalSig = '';
      externalDetachedAt = 0;
    }

    function getState() {
      return {
        mode: currentMode,
        mountedFallback: Boolean(fallbackHostEl && isNodeConnected(getDoc(), fallbackHostEl)),
        waitingForExternal: waitTimer !== null,
        yieldedToExternal: Boolean(yieldedToExternal || (currentMode !== 'off' && hasExternalPulse())),
        hasExternal: hasExternalPulse(),
      };
    }

    return {
      BAR_ID,
      FALLBACK_ATTR,
      METRICS_BINDING,
      sync,
      destroy,
      refresh: refreshMetrics,
      getState,
      createTelemetryController,
    };
  }

  return createTelemetryController();
});
