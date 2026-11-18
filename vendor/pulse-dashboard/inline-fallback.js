(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    try { root.__agPrismTelemetry?.destroy?.(); } catch {}
    if (typeof window !== 'undefined' && window !== root) {
      try { window.__agPrismTelemetry?.destroy?.(); } catch {}
    }
    const api = factory(root);
    root.__agPrismTelemetry = api;
    if (typeof window !== 'undefined') window.__agPrismTelemetry = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function (globalRoot) {
  'use strict';

  const BAR_ID = 'ag-pulse-status-bar';
  const PRISM_BAR_ID = 'ag-prism-pulse-bar';
  const PRISM_BAR_ATTR = 'data-ag-prism-pulse-bar';
  const FALLBACK_ATTR = 'data-ag-prism-fallback';
  const HID_ATTR = 'data-ag-prism-hidden';
  const METRICS_BINDING = '__agPrismMetricsCall';
  const WAIT_MS = 1500;
  const GRACE_MS = 3500;
  const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const SHADOW_CSS = [
    ':host,.bar,.chip{display:inline-flex;align-items:center}',
    ':host{flex:0 0 auto;position:relative;font:11px/16px Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--foreground,#dae2f0);user-select:none;z-index:28}',
    ':host([hidden]),.sub-badge[hidden],.card[hidden],:host([data-layout="blocked"])>.bar{display:none!important}',
    ':host([data-layout="blocked"]){position:fixed!important;left:-9999px!important;top:-9999px!important;width:0!important;height:0!important;margin:0!important;padding:0!important;overflow:hidden!important;visibility:hidden!important;pointer-events:none!important}',
    '.bar{gap:3px}',
    '.chip{gap:3.5px;height:24px;padding:0 6px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer;font-variant-numeric:tabular-nums;transition:background .15s,color .15s}',
    '.chip:hover,.chip[aria-expanded="true"]{background:rgba(128,138,158,.12)}',
    '.chip svg{width:12px;height:12px;stroke:currentColor;stroke-width:1.5;fill:none;opacity:.75;flex:none}',
    '.dim{opacity:.64;font-size:10px}',
    '.sub-badge{font-size:10px;opacity:.78;color:var(--primary,#38bdf8);font-weight:500}',
    '.context-ring{width:11px;height:11px;border-radius:50%;background:conic-gradient(var(--pv-tint,#3186ff) var(--used-angle,36deg),rgba(148,163,184,.28) 0);display:inline-block;position:relative;flex:none}',
    '.context-ring::after{content:"";position:absolute;inset:2.2px;border-radius:50%;background:var(--card,#141720)}',
    '.card{position:fixed;right:18px;bottom:68px;width:min(320px,calc(100vw - 24px));padding:13px 14px 12px;border-radius:10px;border:1px solid rgba(148,163,184,.22);background:var(--card,#12151ef5);color:var(--foreground,#eef1f7);box-shadow:0 16px 40px rgba(0,0,0,.36);z-index:9999}',
    '.heading{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;font-weight:600;margin-bottom:6px}',
    '#context-summary{display:block;font-size:13px;font-weight:600;margin-bottom:2px}',
    '#context-tokens{margin:0 0 8px;font-size:11px;opacity:.76}',
    '.track{height:5px;border-radius:999px;background:rgba(148,163,184,.18);overflow:hidden;margin:6px 0 10px}',
    '.track>i{display:block;height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#2563eb,#38bdf8)}',
    'dl{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin:8px 0;font-size:11px}',
    'dt{opacity:.64}dd{margin:0;text-align:right;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.footnote{margin:6px 0 0;font-size:10px;opacity:.58}',
  ].join('');

  const isFin = (v) => typeof v === 'number' && Number.isFinite(v);
  const FB_ROWS = {
    'zh-CN': '缓存|吞吐速率|首字延迟|最近速率|上下文窗口用量|当前模型|Prism 实时遥测同步|Prism 实时遥测同步 · 后台统计整编中|Prism 本地上下文估算|已用|剩余|代理',
    'zh-TW': '快取|吞吐速率|首字延遲|最近速率|上下文視窗用量|目前模型|Prism 即時遙測同步|Prism 即時遙測同步 · 背景統計彙整中|Prism 本機上下文估算|已用|剩餘|代理',
    yue: '快取|吞吐速率|首字延遲|最近速率|上下文視窗用量|目前模型|Prism 即時遙測同步|Prism 即時遙測同步 · 背景統計整理中|Prism 本機上下文估算|已用|剩低|代理',
    en: 'Cache|Throughput|TTFT|Latest Rate|Context Window|Active Model|Prism live telemetry|Prism live telemetry · Indexing usage|Prism local context estimate|used|free| sub',
    ja: 'キャッシュ|スループット|初回応答|最新速度|コンテキスト使用量|現在のモデル|Prism リアルタイム同期|Prism 同期中 · バックグラウンド集計中|Prism ローカル推定|使用|残り| sub',
  };
  const FB_I18N = Object.fromEntries(
    Object.entries(FB_ROWS).map(([lk, s]) => {
      const r = s.split('|');
      return [
        lk,
        {
          cache: r[0], speedHeading: r[1], ttft: r[2], latestRate: r[3],
          ctxHeading: r[4], curModel: r[5], noteSync: r[6], noteProc: r[7], noteLocal: r[8],
          summary: (p, rem) => `${p}% ${r[9]} · ${rem}% ${r[10]}`,
          agents: (n) => `· ${n}${r[11]}`,
        },
      ];
    })
  );

  function fmtTok(n) {
    if (!isFin(n) || n < 0) return '—';
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
    return String(Math.round(n));
  }

  function mk(doc, tag, attrs, kids) {
    const el = doc.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        if (k === 'text') el.textContent = String(v);
        else if (k === 'cls') el.className = String(v);
        else if (k === 'hidden') el.hidden = Boolean(v);
        else el.setAttribute(k, String(v));
      }
    }
    if (kids) for (const c of kids) if (c) el.appendChild(c);
    return el;
  }

  let reqSeq = 0;

  function createTelemetryController(envOpts) {
    const gW = () => (envOpts && envOpts.window) || (typeof window !== 'undefined' ? window : globalRoot);
    const gD = () => (envOpts && envOpts.document) || gW()?.document || null;

    let mode = 'auto', waitTm = null, rescTm = null, pollTm = null, fbEl = null, srEl = null;
    let hasHost = false, yielded = false, lastSig = '', detAt = 0;
    let docOff = null, lastSnap = null, mApi = null, mRes = null, seatObs = null, healTm = null;
    let locSnap = null, locAt = 0, expLang = '';
    const pend = new Map();

    const bindHook = () => {
      const w = gW();
      if (!w) return;
      if (!mRes) {
        mRes = (id, pl) => {
          const it = pend.get(id);
          if (!it) return;
          clearTimeout(it.timer);
          pend.delete(id);
          it.resolve(pl);
        };
      }
      if (w.__agPrismMetricsResolve !== mRes) w.__agPrismMetricsResolve = mRes;
    };

    const clrWait = () => {
      if (waitTm !== null) { clearTimeout(waitTm); waitTm = null; }
      if (rescTm !== null) { clearTimeout(rescTm); rescTm = null; }
    };
    const clrPoll = () => {
      if (pollTm !== null) { clearInterval(pollTm); pollTm = null; }
    };
    const clrSeat = () => {
      if (healTm !== null) { clearTimeout(healTm); healTm = null; }
      if (seatObs) { try { seatObs.disconnect(); } catch {} seatObs = null; }
    };

    const findExtBars = (doc) => {
      if (!doc) return [];
      const seen = new Set(), out = [], add = (el) => { if (el && !seen.has(el)) { seen.add(el); out.push(el); } };
      if (typeof doc.querySelectorAll === 'function') {
        try {
          const s = doc.querySelectorAll('#' + BAR_ID + ', [data-ag-pulse-bar="true"]');
          for (let i = 0; i < s.length; i++) add(s[i]);
          const ds = doc.querySelectorAll('div');
          for (let i = 0; i < ds.length; i++) {
            const id = String(ds[i]?.getAttribute?.('id') || ds[i]?.id || '');
            if (id.startsWith(BAR_ID)) add(ds[i]);
          }
        } catch {}
      }
      if (typeof doc.getElementById === 'function') add(doc.getElementById(BAR_ID));
      return out;
    };

    const purgeOrphans = (doc, keep = null) => {
      if (!doc || typeof doc.querySelectorAll !== 'function') return;
      const list = doc.querySelectorAll('[' + FALLBACK_ATTR + '="1"], #' + PRISM_BAR_ID + ', [' + PRISM_BAR_ATTR + '="true"]');
      for (let i = 0; i < list.length; i++) {
        if (list[i] !== keep) try { list[i].remove(); } catch {}
      }
    };

    const isConn = (doc, el) => {
      if (!el || el.isConnected === false) return false;
      if (el.isConnected === true) return true;
      if (!el.parentNode && !el.parentElement) return false;
      if (doc && typeof doc.getElementById === 'function' && el.id && typeof doc.querySelectorAll !== 'function') {
        const b = doc.getElementById(el.id);
        if (b && b !== el) return false;
      }
      return true;
    };

    const usableExt = (doc, b) => {
      if (!b || b.getAttribute?.(FALLBACK_ATTR) === '1' || !isConn(doc, b)) return false;
      if (b.getAttribute?.(HID_ATTR) === '1' || b.getAttribute?.('data-layout') === 'blocked' || b.hidden === true) return false;
      if (b.style && b.style.display === 'none') return false;
      if (doc && doc.body && (b.parentElement === doc.body || b.parentNode === doc.body)) return false;
      return true;
    };

    const hasExt = () => {
      const w = gW(), doc = gD();
      if (!w || !doc) return false;
      const bars = findExtBars(doc);
      let sawDead = false;
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        if (!b || b.getAttribute?.(FALLBACK_ATTR) === '1' || !isConn(doc, b) || b.getAttribute?.(HID_ATTR) === '1') continue;
        if (usableExt(doc, b)) { detAt = 0; return true; }
        sawDead = true;
      }
      if (sawDead) return false;
      const sig = [
        w.__agPulseRuntimeOwner ? String(w.__agPulseRuntimeOwner) : '',
        w.__agPulseRuntimeBridge ? 'b' : '',
        w.__agPulseInlineInstalled ? '1' : '',
        w.agPulseHost && !w.agPulseHost.__prismFallback ? 'h' : '',
      ].join('|');
      if (sig !== '|||') {
        const now = Date.now();
        if (sig !== lastSig) { lastSig = sig; detAt = now; return true; }
        if (!detAt) detAt = now;
        return now - detAt < GRACE_MS;
      }
      lastSig = '';
      detAt = 0;
      return false;
    };

    const showExt = () => {
      const bars = findExtBars(gD());
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        if (b && b.getAttribute?.(HID_ATTR) === '1') {
          b.removeAttribute(HID_ATTR);
          b.style?.removeProperty?.('display');
        }
      }
    };

    const hideExt = () => {
      const bars = findExtBars(gD());
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        if (b && b.getAttribute?.(FALLBACK_ATTR) !== '1') {
          b.setAttribute(HID_ATTR, '1');
          b.style?.setProperty?.('display', 'none', 'important');
        }
      }
    };

    const ensBridge = () => {
      const w = gW();
      if (!w) return;
      bindHook();
      if (!mApi) {
        mApi = { __prismOwned: true, getMetrics: (inp) => reqSnap(inp), getLatestSnapshot: () => lastSnap };
      }
      w.__agPrismMetricsBridge = mApi;
    };

    const rmHost = () => {
      const w = gW();
      if (hasHost && w?.agPulseHost?.__prismFallback) delete w.agPulseHost;
      hasHost = false;
    };

    const ensHost = () => {
      const w = gW();
      if (!w) return;
      ensBridge();
      if (!w.agPulseHost || typeof w.agPulseHost.getMetrics !== 'function') {
        w.agPulseHost = {
          __prismFallback: true,
          getMetrics: (inp) => reqSnap(inp),
          getLatestSnapshot: () => lastSnap,
          getPreferences: () => Promise.resolve({ language: 'zh-CN' }),
          setPreferences: (v) => Promise.resolve(v || {}),
          report: () => {},
        };
        hasHost = true;
      }
    };

    const unmountFb = (keepBridge = false) => {
      clrWait();
      clrPoll();
      clrSeat();
      if (docOff) { try { docOff(); } catch {} docOff = null; }
      if (!keepBridge) {
        for (const it of pend.values()) { clearTimeout(it.timer); it.resolve(null); }
        pend.clear();
        rmHost();
      }
      if (fbEl) {
        try { gW()?.__agPulseExternalBridge?.({ event: 'dispose' }); } catch {}
        try { fbEl.remove(); } catch {}
      }
      purgeOrphans(gD(), null);
      fbEl = null;
      srEl = null;
    };

    const detCid = (node) => {
      try {
        const cid = node?.closest?.('[data-cascade-id]')?.getAttribute?.('data-cascade-id');
        if (cid && GUID_RE.test(cid)) return cid;
        const m = gW()?.location?.pathname?.match?.(/\/c\/([0-9a-f-]{36})/i);
        return m ? m[1] : null;
      } catch { return null; }
    };

    const estSnap = () => {
      const now = Date.now();
      if (locSnap && now - locAt < 5000) return locSnap;
      const doc = gD();
      let model = 'Gemini 4', chars = 0;
      try {
        const tr = doc?.querySelector?.('[data-testid="model-selector-trigger"]');
        const lb = tr?.getAttribute?.('aria-label') || tr?.textContent?.trim();
        if (lb) model = lb;
        const vw = doc?.querySelector?.('[data-testid="conversation-view"]');
        if (vw && typeof vw.querySelectorAll === 'function') {
          const ts = vw.querySelectorAll('[data-testid="planner-response-text"], [data-testid="user-message-bubble"]');
          if (ts?.length > 0) {
            const n = Math.min(4, ts.length);
            let s = 0;
            for (let i = ts.length - n; i < ts.length; i++) s += (ts[i].textContent || '').length;
            chars = Math.round((s / n) * ts.length);
          }
        } else if (typeof vw?.textContent === 'string') chars = vw.textContent.length;
      } catch {}
      const maxTokens = 512000, usedTokens = Math.max(4200, Math.min(maxTokens, Math.round(chars / 3.2) + 8400));
      const usedFraction = Math.min(0.98, usedTokens / maxTokens);
      locAt = now;
      locSnap = {
        connection: 'local-estimate',
        speed: { model, tps: null, latestTps: null, ttftSeconds: null, rounds: 0, cacheHitRate: null, totalTokens: usedTokens, context: { model, usedTokens, maxTokens, usedFraction, sampledAt: now } },
        groups: [],
      };
      return locSnap;
    };

    const reqSnap = (inp) => {
      const w = gW();
      bindHook();
      const si = inp && typeof inp === 'object' ? { ...inp } : {};
      if (si.usageSync) delete si.usageSync;
      if (w && typeof w[METRICS_BINDING] === 'function') {
        return new Promise((resolve) => {
          if (pend.size >= 6) { resolve(lastSnap || estSnap()); return; }
          const id = ++reqSeq;
          const timer = setTimeout(() => { pend.delete(id); resolve(lastSnap || estSnap()); }, 3500);
          pend.set(id, { resolve, timer });
          try {
            w[METRICS_BINDING](JSON.stringify({ id, input: si }));
          } catch {
            clearTimeout(timer);
            pend.delete(id);
            resolve(lastSnap || estSnap());
          }
        });
      }
      return Promise.resolve(estSnap());
    };

    const gStr = () => FB_I18N[gD()?.documentElement?.getAttribute?.('data-ag-cs-lang') || expLang || 'zh-CN'] || FB_I18N['zh-CN'];
    const syncLbls = () => {
      if (!srEl) return;
      const t = gStr(), ns = srEl.querySelectorAll?.('[data-fb-i18n]') || [];
      for (let i = 0; i < ns.length; i++) {
        const k = ns[i].getAttribute('data-fb-i18n');
        if (k && typeof t[k] === 'string' && ns[i].textContent !== t[k]) ns[i].textContent = t[k];
      }
    };

    const applySnap = (snap) => {
      if (snap && typeof snap === 'object') lastSnap = snap;
      if (!srEl || !fbEl) return;
      const sp = snap?.speed || {}, ctx = sp.context || {};
      const maxTok = ctx.maxTokens > 0 ? ctx.maxTokens : 512000;
      const uf = isFin(ctx.usedFraction) ? Math.max(0, Math.min(1, ctx.usedFraction)) : 0.04;
      const uTok = isFin(ctx.usedTokens) ? ctx.usedTokens : Math.round(uf * maxTok);
      const pct = Math.round(uf * 100), rem = Math.max(0, 100 - pct);
      const model = ctx.model || sp.model || 'Antigravity Model';
      const tot = sp.taskUsage?.total?.totalTokens ?? sp.tokens?.totalTokens ?? sp.cache?.totalTokens ?? sp.totalTokens ?? 0;
      const hit = isFin(sp.cache?.hitRate) ? sp.cache.hitRate : sp.cacheHitRate;
      const subs = Number(sp.taskUsage?.subagents || 0);
      const proc = snap?.collection?.state === 'processing';

      if (proc) fbEl.setAttribute('data-collection', 'processing');
      else fbEl.removeAttribute('data-collection');

      const t = gStr();
      syncLbls();
      const sT = (id, v) => { const e = srEl.getElementById(id), s = String(v); if (e && e.textContent !== s) e.textContent = s; };
      sT('rounds', sp.rounds > 0 ? `${sp.rounds}r` : '—');
      sT('tps', isFin(sp.tps) && sp.tps > 0 ? sp.tps.toFixed(1) : '—');
      sT('cache-total', `${fmtTok(tot > 0 ? tot : uTok)} tok`);
      sT('cache-rate', isFin(hit) ? `${(hit * 100).toFixed(1)}%` : '—');

      const sb = srEl.getElementById('subagent-badge');
      if (sb) {
        if (subs > 0) {
          sb.hidden = false;
          const bt = t.agents(subs);
          if (sb.textContent !== bt) sb.textContent = bt;
        } else sb.hidden = true;
      }

      sT('context-percent', `${pct}%`);
      sT('ttft', typeof sp.ttftSeconds === 'number' ? `${sp.ttftSeconds.toFixed(2)}s` : '—');
      sT('latest-rate', typeof sp.latestTps === 'number' ? `${sp.latestTps.toFixed(1)} tok/s` : '—');
      sT('context-summary', t.summary(pct, rem));
      sT('context-tokens', `${fmtTok(uTok)} / ${fmtTok(maxTok)} tok`);
      sT('context-model', model);
      sT('context-note', snap?.connection === 'local-estimate' ? t.noteLocal : proc ? t.noteProc : t.noteSync);

      const fl = srEl.getElementById('context-fill');
      if (fl?.style) fl.style.width = `${pct}%`;
      const rg = srEl.getElementById('context-ring');
      rg?.style?.setProperty?.('--used-angle', `${Math.round(uf * 360)}deg`);
      try { gW()?.__agPulseExternalBridge?.({ event: 'render', data: snap }); } catch {}
    };

    const isHidAnc = (el) => !el || el.hidden === true || Boolean(el.closest?.('aside, [data-testid="conversation-list-sidebar"], [data-testid="conversation-row-sidebar"], [hidden], [inert]'));
    const isTopWrap = (p) => {
      if (!p) return true;
      const c = String(p.className || '').trim();
      return Boolean(c && /\bmin-w-0\b/.test(c) && !/\b(?:flex|inline-flex|agy-composer-footer)\b/.test(c));
    };
    const findAnchor = (doc) => {
      if (!doc) return null;
      const ft = doc.querySelector?.('.agy-composer-footer, [data-testid="input-box-bottom-toolbar"]');
      if (ft && !isHidAnc(ft)) return ft;
      const mb = doc.querySelector?.('[data-testid="model-selector-trigger"]');
      return mb?.parentElement && !isHidAnc(mb) && !isTopWrap(mb.parentElement) ? mb.parentElement : null;
    };

    const seatIn = (anc, el) => {
      if (!anc || !el) return false;
      const kids = anc.children || [];
      if (/\bagy-composer-footer\b/.test(String(anc.className || '')) && kids.length >= 2 && typeof anc.insertBefore === 'function') {
        const last = kids[kids.length - 1];
        if (last && last !== el) { anc.insertBefore(el, last); return true; }
      }
      anc.appendChild(el);
      return true;
    };

    const seatFb = (doc) => {
      if (!fbEl || !doc) return false;
      const anc = findAnchor(doc);
      if (!anc) { try { fbEl.remove(); } catch {} return false; }
      if (!isConn(doc, fbEl) || fbEl.parentElement !== anc) {
        try { seatIn(anc, fbEl); } catch { return false; }
      }
      return true;
    };

    async function refresh() {
      const w = gW(), doc = gD();
      if (!envOpts && w?.__agPrismTelemetry && w.__agPrismTelemetry !== api) { unmountFb(); return null; }
      if (mode === 'on') hideExt();
      else if (hasExt()) { yielded = true; unmountFb(true); return null; }
      if (mode !== 'off' && fbEl) {
        purgeOrphans(doc, fbEl);
        if (!seatFb(doc)) return null;
      }
      if (!fbEl || !isConn(doc, fbEl)) {
        if (mode !== 'off' && (mode === 'on' || !hasExt()) && waitTm === null && findAnchor(doc)) mountFb();
        if (!fbEl || !isConn(doc, fbEl)) return null;
      }
      const snap = await reqSnap({ conversationId: detCid(fbEl), force: false });
      applySnap(snap);
      return snap;
    }

    function mountFb() {
      const w = gW(), doc = gD();
      if (!w || !doc || (typeof doc.attachShadow === 'undefined' && typeof doc.createElement !== 'function')) return false;
      if (!envOpts && w.__agPrismTelemetry && w.__agPrismTelemetry !== api) { unmountFb(); return false; }
      if (mode === 'off') return false;
      if (mode === 'on') hideExt();
      else if (hasExt()) { yielded = true; unmountFb(true); return false; }
      if (fbEl && seatFb(doc)) { purgeOrphans(doc, fbEl); return true; }

      const anc = findAnchor(doc);
      if (!anc) return false;
      const E = (t, a, k) => mk(doc, t, a, k);
      const host = E('div', { id: PRISM_BAR_ID, [FALLBACK_ATTR]: '1', [PRISM_BAR_ATTR]: 'true' });
      if (typeof host.attachShadow !== 'function') return false;
      const sr = host.attachShadow({ mode: 'open' });
      sr.appendChild(E('style', { text: SHADOW_CSS }));

      const t0 = gStr();
      const sChip = E('button', { type: 'button', cls: 'chip', 'data-card': 'speed' }, [
        E('span', { cls: 'rounds dim', id: 'rounds', text: '—' }),
        E('strong', { id: 'tps', text: '—' }),
        E('span', { cls: 'dim', text: 'tok/s' }),
      ]);
      const cChip = E('button', { type: 'button', cls: 'chip', 'data-card': 'cache' }, [
        E('span', { cls: 'cache-total', id: 'cache-total', text: '—' }),
        E('span', { cls: 'sub-badge', id: 'subagent-badge', hidden: true, text: '' }),
        E('span', { cls: 'dim', text: '·' }),
        E('span', { 'data-i18n': 'cache', 'data-fb-i18n': 'cache', text: t0.cache }),
        E('strong', { id: 'cache-rate', text: '—' }),
      ]);
      const xChip = E('button', { type: 'button', cls: 'chip', 'data-card': 'context', 'aria-expanded': 'false' }, [
        E('span', { cls: 'context-ring', id: 'context-ring' }),
        E('span', { cls: 'context-label dim', 'data-i18n': 'contextShort', text: 'Ctx' }),
        E('strong', { id: 'context-percent', text: '0%' }),
      ]);
      const sCard = E('section', { cls: 'card', id: 'speed-card', hidden: true }, [
        E('div', { cls: 'heading' }, [E('span', { 'data-fb-i18n': 'speedHeading', text: t0.speedHeading })]),
        E('dl', null, [
          E('dt', { 'data-fb-i18n': 'ttft', text: t0.ttft }),
          E('dd', { id: 'ttft', text: '—' }),
          E('dt', { 'data-fb-i18n': 'latestRate', text: t0.latestRate }),
          E('dd', { id: 'latest-rate', text: '—' }),
        ]),
      ]);
      const xCard = E('section', { cls: 'card context-card', id: 'context-card', hidden: true }, [
        E('div', { cls: 'heading' }, [E('span', { 'data-fb-i18n': 'ctxHeading', text: t0.ctxHeading })]),
        E('strong', { id: 'context-summary', text: t0.summary(0, 100) }),
        E('p', { id: 'context-tokens', text: '— / 512K tok' }),
        E('div', { cls: 'track', id: 'context-track' }, [E('i', { id: 'context-fill' })]),
        E('dl', null, [
          E('dt', { 'data-fb-i18n': 'curModel', text: t0.curModel }),
          E('dd', { id: 'context-model', text: '—' }),
        ]),
        E('p', { cls: 'footnote', id: 'context-note', text: t0.noteSync }),
      ]);

      sr.appendChild(E('div', { cls: 'bar' }, [sChip, cChip, xChip]));
      sr.appendChild(sCard);
      sr.appendChild(xCard);

      const tog = (card, btn) => {
        const nx = Boolean(card.hidden);
        sCard.hidden = xCard.hidden = true;
        sChip.setAttribute('aria-expanded', 'false');
        xChip.setAttribute('aria-expanded', 'false');
        card.hidden = !nx;
        btn.setAttribute('aria-expanded', String(nx));
        if (nx) void refresh();
        try { w.__agPulseExternalBridge?.({ event: 'card' }); } catch {}
      };
      xChip.addEventListener('click', (e) => { e?.stopPropagation?.(); tog(xCard, xChip); });
      sChip.addEventListener('click', (e) => { e?.stopPropagation?.(); tog(sCard, sChip); });

      if (typeof doc.addEventListener === 'function') {
        const onDoc = (ev) => {
          if (ev?.target === host || host.contains?.(ev?.target)) return;
          if (!xCard.hidden || !sCard.hidden) {
            xCard.hidden = sCard.hidden = true;
            xChip.setAttribute('aria-expanded', 'false');
            sChip.setAttribute('aria-expanded', 'false');
            try { w.__agPulseExternalBridge?.({ event: 'card' }); } catch {}
          }
        };
        doc.addEventListener('click', onDoc);
        docOff = () => doc.removeEventListener('click', onDoc);
      }

      purgeOrphans(doc, null);
      seatIn(anc, host);
      fbEl = host;
      srEl = sr;
      yielded = false;

      clrSeat();
      if (typeof w.MutationObserver === 'function') {
        seatObs = new w.MutationObserver(() => {
          if (mode === 'off' || !fbEl || healTm !== null) return;
          const det = !isConn(doc, fbEl);
          const unh = mode === 'on' && findExtBars(doc).some((b) => b && b.getAttribute?.(FALLBACK_ATTR) !== '1' && b.getAttribute?.(HID_ATTR) !== '1');
          if (!det && !unh) return;
          healTm = setTimeout(() => {
            healTm = null;
            if (mode === 'off' || !fbEl) return;
            if (mode === 'on') hideExt();
            else if (hasExt()) return;
            if (!isConn(doc, fbEl) && seatFb(doc)) {
              try { w.__agPulseExternalBridge?.({ event: 'mount' }); } catch {}
            }
          }, 45);
          healTm?.unref?.();
        });
        try { seatObs.observe(doc.body || anc, { childList: true, subtree: Boolean(doc.body) }); } catch {}
      }

      ensHost();
      try { w.__agPulseExternalBridge?.({ event: 'mount' }); } catch {}
      void refresh();
      clrPoll();
      pollTm = setInterval(() => { if (!doc.hidden) void refresh(); }, 4000);
      pollTm?.unref?.();
      return true;
    }

    const getState = () => ({
      mode,
      mountedFallback: Boolean(fbEl && isConn(gD(), fbEl)),
      waitingForExternal: waitTm !== null,
      yieldedToExternal: Boolean(mode === 'auto' && (yielded || hasExt())),
      hasExternal: hasExt(),
    });

    function sync(cfg) {
      if (cfg && typeof cfg.language === 'string' && cfg.language) expLang = cfg.language;
      const raw = cfg && cfg.telemetryModule;
      mode = raw === 'on' || raw === 'off' ? raw : 'auto';
      if (srEl && mode !== 'off') {
        syncLbls();
        if (lastSnap) applySnap(lastSnap);
      }
      if (mode === 'off') {
        yielded = false;
        unmountFb();
        hideExt();
        return getState();
      }
      ensBridge();
      if (mode === 'on') {
        yielded = false;
        clrWait();
        hideExt();
        ensHost();
        mountFb();
        return getState();
      }
      showExt();
      if (hasExt()) {
        yielded = true;
        unmountFb(true);
        ensHost();
        if (detAt > 0 && rescTm === null) {
          rescTm = setTimeout(() => {
            rescTm = null;
            if (mode !== 'off' && !hasExt()) mountFb();
          }, GRACE_MS + 60);
          rescTm?.unref?.();
        }
        return getState();
      }
      const doc = gD();
      if (fbEl && seatFb(doc)) return getState();
      if (findExtBars(doc).some((b) => b && b.getAttribute?.(FALLBACK_ATTR) !== '1' && isConn(doc, b) && !usableExt(doc, b))) {
        clrWait();
        mountFb();
        return getState();
      }
      if (waitTm === null) {
        const ms = isFin(cfg?.__fallbackDelayMs) && cfg.__fallbackDelayMs >= 0 ? cfg.__fallbackDelayMs : WAIT_MS;
        waitTm = setTimeout(() => {
          waitTm = null;
          if (mode !== 'auto') return;
          if (hasExt()) { yielded = true; unmountFb(true); ensHost(); return; }
          mountFb();
        }, ms);
        waitTm?.unref?.();
      }
      return getState();
    }

    function destroy() {
      clrWait();
      unmountFb();
      showExt();
      const w = gW();
      if (w) {
        if (mApi && w.__agPrismMetricsBridge === mApi) delete w.__agPrismMetricsBridge;
        if (mRes && w.__agPrismMetricsResolve === mRes) delete w.__agPrismMetricsResolve;
      }
      yielded = false;
      lastSig = '';
      detAt = 0;
    }

    const api = {
      BAR_ID,
      PRISM_BAR_ID,
      PRISM_BAR_ATTR,
      FALLBACK_ATTR,
      METRICS_BINDING,
      sync,
      destroy,
      refresh,
      getLatestSnapshot: () => lastSnap,
      getState,
      createTelemetryController,
    };
    return api;
  }

  return createTelemetryController();
});
