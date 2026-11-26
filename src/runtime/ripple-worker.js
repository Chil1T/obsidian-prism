// Obsidian Prism — OffscreenCanvas WebGL2 后台 Worker 渲染器、1x1 CSP 探针与性能档位管理器
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.__agPrismRippleWorker = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function (G) {
  'use strict';
  const M = Math;
  const PROBE_TIMEOUT_MS = 120;
  const IDLE_SLEEP_MS = 1200;

  const PERF_PROFILES = Object.freeze({
    balanced: Object.freeze({ mode: 'balanced', glowDprScale: 0.7, rippleMaxDpr: 1.5, crystalMaxDpr: 1.5, vialMaxDpr: 1.5, maxFps: 0, minGapMs: 0, msaa: false }),
    performance: Object.freeze({ mode: 'performance', glowDprScale: 0.55, rippleMaxDpr: 1.0, crystalMaxDpr: 1.0, vialMaxDpr: 1.0, maxFps: 60, minGapMs: 16.67, msaa: false }),
    quality: Object.freeze({ mode: 'quality', glowDprScale: 1.0, rippleMaxDpr: 2.0, crystalMaxDpr: 1.5, vialMaxDpr: 2.0, maxFps: 0, minGapMs: 0, msaa: true }),
  });

  const activeSessions = new Set();
  let activeProbeWorker = null, activeProbeUrl = '', probeCache = null, probePending = null, totalFallbacks = 0;

  const cl = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? M.max(lo, M.min(hi, n)) : lo; };
  const getDoc = (doc) => doc || (typeof document !== 'undefined' ? document : null);

  function readRawPerfAttr(doc) {
    const h = getDoc(doc)?.documentElement;
    if (!h) return '';
    const ds = h.dataset && typeof h.dataset.agCsPerfMode === 'string' ? h.dataset.agCsPerfMode : '';
    const raw = ds || (typeof h.getAttribute === 'function' ? h.getAttribute('data-ag-cs-perf-mode') : '') || '';
    return String(raw).trim().toLowerCase();
  }

  function getPerfMode(doc) {
    const raw = readRawPerfAttr(doc);
    return raw === 'performance' || raw === 'quality' || raw === 'balanced' ? raw : 'balanced';
  }
  const getPerfProfile = (doc) => PERF_PROFILES[getPerfMode(doc)] || PERF_PROFILES.balanced;
  const getPerfMinGapMs = (doc) => getPerfProfile(doc).minGapMs;

  function resolveRippleDpr(rawDpr, doc) {
    const raw = Number.isFinite(Number(rawDpr)) && Number(rawDpr) > 0 ? Number(rawDpr) : 1;
    return M.min(raw, getPerfProfile(doc).rippleMaxDpr);
  }

  function resolveGlowDpr(rawDpr, doc, baseScale) {
    const raw = Number.isFinite(Number(rawDpr)) && Number(rawDpr) > 0 ? Number(rawDpr) : 1;
    const prof = getPerfProfile(doc);
    if (prof.mode === 'performance') return M.max(0.5, M.min(0.95, +(raw * 0.55).toFixed(3)));
    if (prof.mode === 'quality') return M.max(0.75, M.min(2.0, +(raw * (Number(baseScale) > 0 ? M.min(1, Number(baseScale)) : 1)).toFixed(3)));
    const sc = Number(baseScale) > 0 ? M.min(prof.glowDprScale, Number(baseScale)) : prof.glowDprScale;
    return raw <= 1 ? M.max(0.5, +(raw * sc).toFixed(3)) : M.max(0.7, M.min(1.25, +(raw * M.min(0.63, sc * 0.9)).toFixed(3)));
  }

  function isHostPaused(doc) {
    const d = getDoc(doc);
    if (!d) return false;
    if (d.hidden === true) return true;
    const h = d.documentElement;
    return Boolean(h && typeof h.getAttribute === 'function' && (h.getAttribute('data-ag-cs-win-blur') === '1' || h.getAttribute('data-ag-pp-open') === '1'));
  }

  // 1x1 探针 Worker：校验 blob: CSP 与 Worker 内 OffscreenCanvas WebGL2 可用性并即刻释放上下文
  const PROBE_WORKER_SRC = [
    "'use strict';self.onmessage=function(ev){var d=ev&&ev.data;if(!d||d.type!=='probe'||!d.canvas)return;try{",
    "var gl=d.canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:false});",
    "var ok=Boolean(gl&&(!gl.isContextLost||!gl.isContextLost()));",
    "if(gl){try{var ext=gl.getExtension('WEBGL_lose_context');if(ext)ext.loseContext();}catch(e){}}",
    "self.postMessage({type:'probe',ok:ok,reason:ok?'ok':'webgl2-null'});",
    "}catch(err){self.postMessage({type:'probe',ok:false,reason:String((err&&err.message)||err||'probe-err')});}};",
  ].join('');

  // 独立后台 WebGL2 极光渲染 Worker（复用主线程 GLOW_VERT_SHADER / HORIZON_FRAGMENT_SHADER 单一真相源）
  const RENDER_WORKER_SRC = [
    "'use strict';var cv=null,gl=null,prog=null,u={},rafId=0,paused=false,disposed=false,ready=false;",
    "var dpr=1,flowSec=0,lastClock=0,lastDrawAt=0,lastActAt=0,idleMs=1200,maxFps=0;",
    "var cur={dark:1,intensity:0.6,presence:1,reach:0.47,prism:0,surge:0,speed:1,spec:0,sem:0,still:1,anim:0,continuous:0,timeSec:12};",
    "function nowMs(){return typeof performance!=='undefined'&&performance.now?performance.now():Date.now();}",
    "function stopRaf(){if(rafId&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(rafId);rafId=0;}",
    "function freeGl(){if(gl&&prog){try{gl.deleteProgram(prog);}catch(e){}}prog=null;u={};}",
    "function compile(t,s){var sh=gl.createShader(t);gl.shaderSource(sh,s);gl.compileShader(sh);",
    "if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){var lg=gl.getShaderInfoLog(sh)||'shader';gl.deleteShader(sh);throw new Error(lg);}return sh;}",
    "function build(vsSrc,fsSrc){freeGl();var vs=compile(gl.VERTEX_SHADER,vsSrc),fs=compile(gl.FRAGMENT_SHADER,fsSrc);",
    "prog=gl.createProgram();gl.attachShader(prog,vs);gl.attachShader(prog,fs);gl.linkProgram(prog);gl.deleteShader(vs);gl.deleteShader(fs);",
    "if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(prog)||'link');gl.useProgram(prog);",
    "var ns=['uRes','uDpr','uTime','uDark','uReach','uIntensity','uStretch','uPresence','uPrism','uSurge','uSpeed','uSpectrum','uSemantic'];",
    "for(var i=0;i<ns.length;i++)u[ns[i]]=gl.getUniformLocation(prog,ns[i]);}",
    "function paint(tSec){if(!gl||!prog||!cv||cv.width<=0||cv.height<=0||(gl.isContextLost&&gl.isContextLost()))return;",
    "gl.viewport(0,0,cv.width,cv.height);gl.useProgram(prog);gl.uniform2f(u.uRes,cv.width,cv.height);gl.uniform1f(u.uDpr,dpr);",
    "gl.uniform1f(u.uTime,tSec);gl.uniform1f(u.uDark,cur.dark);gl.uniform1f(u.uReach,cur.reach);gl.uniform1f(u.uIntensity,cur.intensity);",
    "gl.uniform1f(u.uStretch,0.6);gl.uniform1f(u.uPresence,cur.presence);gl.uniform1f(u.uPrism,cur.prism);gl.uniform1f(u.uSurge,cur.surge);",
    "gl.uniform1f(u.uSpeed,cur.speed);if(u.uSpectrum)gl.uniform1f(u.uSpectrum,cur.spec);if(u.uSemantic)gl.uniform1f(u.uSemantic,cur.sem);",
    "gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);}",
    "function tick(ts){rafId=0;if(disposed||paused||!ready||!cur.anim||cur.still)return;var now=typeof ts==='number'?ts:nowMs();",
    "if(!cur.continuous&&idleMs>0&&lastActAt>0&&now-lastActAt>=idleMs){cur.anim=0;stopRaf();try{self.postMessage({type:'slept'});}catch(e){}return;}",
    "var gap=maxFps>0?(1000/maxFps):0;if(gap>0&&lastDrawAt>0&&now-lastDrawAt<gap-0.5){if(typeof requestAnimationFrame==='function')rafId=requestAnimationFrame(tick);return;}",
    "var dt=lastClock>0?Math.min(0.1,Math.max(0,(now-lastClock)/1000)):0.016;lastClock=now;lastDrawAt=now;flowSec+=dt*cur.speed;paint(12+flowSec);",
    "if(typeof requestAnimationFrame==='function')rafId=requestAnimationFrame(tick);}",
    "function armRaf(){if(!disposed&&!paused&&ready&&cur.anim&&!cur.still&&!rafId&&typeof requestAnimationFrame==='function')rafId=requestAnimationFrame(tick);}",
    "self.onmessage=function(ev){var m=ev&&ev.data;if(!m||disposed)return;",
    "if(m.type==='init'){try{cv=m.canvas;idleMs=Number(m.idleTimeoutMs)||1200;maxFps=Number(m.maxFps)||0;",
    "if(cv&&cv.addEventListener)cv.addEventListener('webglcontextlost',function(e){if(e&&e.preventDefault)e.preventDefault();stopRaf();ready=false;try{self.postMessage({type:'contextlost'});}catch(x){}});",
    "gl=cv&&cv.getContext?cv.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:false}):null;",
    "if(!gl||(gl.isContextLost&&gl.isContextLost()))throw new Error('webgl2-unavailable');build(m.vs,m.fs);",
    "if(m.pw>0&&m.ph>0){cv.width=m.pw;cv.height=m.ph;dpr=m.dpr||1;}ready=true;lastActAt=nowMs();self.postMessage({type:'ready'});",
    "}catch(err){stopRaf();freeGl();ready=false;try{self.postMessage({type:'error',reason:String((err&&err.message)||err||'init-err')});}catch(x){}}return;}",
    "if(m.type==='resize'){if(!cv)return;var nw=Math.max(0,m.pw|0),nh=Math.max(0,m.ph|0);dpr=m.dpr||dpr||1;",
    "if(cv.width!==nw||cv.height!==nh){cv.width=nw;cv.height=nh;}if(ready&&!paused&&nw>0&&nh>0&&m.syncDraw!==false)paint(cur.timeSec||(12+flowSec));return;}",
    "if(m.type==='draw'){paused=false;if(m.maxFps!==undefined)maxFps=Number(m.maxFps)||0;",
    "cur.dark=m.dark?1:0;cur.intensity=m.intensity;cur.presence=m.presence;cur.reach=m.reach;cur.prism=m.prism;cur.surge=m.surge;cur.speed=m.speed;",
    "cur.spec=m.spec||0;cur.sem=m.sem||0;cur.still=m.still?1:0;cur.anim=m.anim?1:0;cur.continuous=m.continuous?1:0;cur.timeSec=m.timeSec;",
    "flowSec=Math.max(0,(m.timeSec||12)-12);lastActAt=nowMs();lastClock=lastActAt;lastDrawAt=lastActAt;",
    "if(ready&&cv&&cv.width>0&&cv.height>0)paint(cur.timeSec);if(cur.anim&&!cur.still)armRaf();else stopRaf();return;}",
    "if(m.type==='clear'){stopRaf();paused=true;if(gl&&cv&&cv.width>0&&cv.height>0&&(!gl.isContextLost||!gl.isContextLost())){gl.viewport(0,0,cv.width,cv.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}return;}",
    "if(m.type==='sleep'){paused=true;cur.anim=0;stopRaf();return;}",
    "if(m.type==='release'){paused=true;cur.anim=0;stopRaf();if(cv){cv.width=0;cv.height=0;}return;}",
    "if(m.type==='dispose'){disposed=true;paused=true;stopRaf();freeGl();if(gl){try{var ext=gl.getExtension('WEBGL_lose_context');if(ext)ext.loseContext();}catch(e){}}gl=null;cv=null;try{self.close&&self.close();}catch(e){}}};",
  ].join('');

  function safeRevokeUrl(url) {
    if (!url) return;
    try {
      const U = (G && G.URL) || (typeof URL !== 'undefined' ? URL : null);
      if (U && typeof U.revokeObjectURL === 'function') U.revokeObjectURL(url);
    } catch {}
  }

  function createBlobWorker(src) {
    const B = (G && G.Blob) || (typeof Blob !== 'undefined' ? Blob : null);
    const U = (G && G.URL) || (typeof URL !== 'undefined' ? URL : null);
    const W = (G && G.Worker) || (typeof Worker !== 'undefined' ? Worker : null);
    if (!B || !U || typeof U.createObjectURL !== 'function' || !W) throw new Error('worker-api-unavailable');
    const url = U.createObjectURL(new B([src], { type: 'application/javascript' }));
    try {
      return { worker: new W(url), url };
    } catch (err) {
      safeRevokeUrl(url);
      throw err;
    }
  }

  function hasOffscreenApi() {
    const Off = (G && G.OffscreenCanvas) || (typeof OffscreenCanvas !== 'undefined' ? OffscreenCanvas : null);
    const W = (G && G.Worker) || (typeof Worker !== 'undefined' ? Worker : null);
    const B = (G && G.Blob) || (typeof Blob !== 'undefined' ? Blob : null);
    const U = (G && G.URL) || (typeof URL !== 'undefined' ? URL : null);
    return Boolean(Off && W && B && U && typeof U.createObjectURL === 'function');
  }

  function probeWorkerWebGL2(opts = {}) {
    if (!opts.force && probeCache) return Promise.resolve(probeCache);
    if (!opts.force && probePending) return probePending;
    if (!hasOffscreenApi()) {
      probeCache = Object.freeze({ ok: false, reason: 'unsupported', checkedAt: Date.now() });
      return Promise.resolve(probeCache);
    }
    const timeoutMs = M.max(10, Number(opts.timeoutMs) || PROBE_TIMEOUT_MS);
    probePending = new Promise((resolve) => {
      let settled = false, timer = 0, worker = null, url = '';
      const finish = (ok, reason) => {
        if (settled) return;
        settled = true;
        if (timer) { clearTimeout(timer); timer = 0; }
        if (worker) {
          try { worker.onmessage = null; worker.onerror = null; } catch {}
          try { worker.terminate(); } catch {}
          if (activeProbeWorker === worker) activeProbeWorker = null;
          worker = null;
        }
        if (url) { safeRevokeUrl(url); if (activeProbeUrl === url) activeProbeUrl = ''; url = ''; }
        probeCache = Object.freeze({ ok: Boolean(ok), reason: String(reason || (ok ? 'ok' : 'failed')), checkedAt: Date.now() });
        probePending = null;
        resolve(probeCache);
      };
      try {
        const Off = (G && G.OffscreenCanvas) || OffscreenCanvas;
        const probeCv = new Off(1, 1);
        const created = createBlobWorker(PROBE_WORKER_SRC);
        worker = activeProbeWorker = created.worker;
        url = activeProbeUrl = created.url;
        worker.onmessage = (ev) => {
          const d = ev && ev.data;
          if (d && d.type === 'probe') finish(Boolean(d.ok), d.reason || (d.ok ? 'ok' : 'webgl2-null'));
        };
        worker.onerror = (err) => finish(false, (err && err.message) || 'worker-error');
        timer = setTimeout(() => finish(false, 'timeout'), timeoutMs);
        worker.postMessage({ type: 'probe', canvas: probeCv }, [probeCv]);
      } catch (err) {
        finish(false, (err && err.message) || 'csp-blocked');
      }
    });
    return probePending;
  }

  const warmProbe = (opts) => { try { probeWorkerWebGL2(opts).catch(() => {}); } catch {} };
  const getProbeStatus = () => (probeCache ? { probed: true, ok: probeCache.ok, reason: probeCache.reason } : { probed: false, ok: false, reason: probePending ? 'probing' : 'unprobed' });

  function resetProbeCache() {
    if (activeProbeWorker) { try { activeProbeWorker.terminate(); } catch {} activeProbeWorker = null; }
    if (activeProbeUrl) { safeRevokeUrl(activeProbeUrl); activeProbeUrl = ''; }
    probeCache = null;
    probePending = null;
  }

  function resolveGlowShaders(rippleCore) {
    const core = rippleCore || (G && G.__agCsRippleCore) || null;
    const fs = core && (core.HORIZON_FRAGMENT_SHADER || core.GLOW_FRAG_SHADER);
    const vs = (core && core.GLOW_VERT_SHADER) || '#version 300 es\nvoid main(){vec2 corner=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(corner*2.0-1.0,0.0,1.0);}';
    return fs ? { vs, fs, core } : null;
  }

  function mountGlowWorker(canvas, options = {}) {
    if (!canvas || typeof canvas.transferControlToOffscreen !== 'function') return null;
    if (options.prefer2D || options.force2D || (G && G.__agRippleForce2D === true)) return null;
    const shaders = resolveGlowShaders(options.rippleCore);
    if (!shaders) return null;

    if (!probeCache) {
      warmProbe({ timeoutMs: options.probeTimeoutMs });
      if (typeof options.onProbeReady === 'function' && probePending) {
        probePending.then((res) => { if (res && res.ok) { try { options.onProbeReady(res); } catch {} } });
      }
      return null;
    }
    if (!probeCache.ok) return null;

    const doc = (canvas && canvas.ownerDocument) || getDoc(options.doc);
    const core = shaders.core;
    const defAura = (core && core.DEFAULT_HORIZON_AURA) || { reach: 0.47, prism: 0, surge: 0, speed: 1 };
    const idleTimeoutMs = M.max(200, Number(options.idleTimeoutMs) || IDLE_SLEEP_MS);
    const initTimeoutMs = M.max(20, Number(options.initTimeoutMs) || PROBE_TIMEOUT_MS);

    let offscreen = null, worker = null, blobUrl = '', initTimer = 0, postMessageCount = 0;
    let ready = false, failed = false, disposed = false, contextLost = false;
    let paused = false, sleeping = false, stale = true, clearedZero = false, fallbackNotified = false;
    let cssW = M.max(0, Number(options.width ?? 0)), cssH = M.max(0, Number(options.height ?? 0));
    let dpr = M.max(0.5, M.min(2.0, Number(options.dpr || 1)));
    let pw = cssW > 0 ? M.max(1, M.round(cssW * dpr)) : 0, ph = cssH > 0 ? M.max(1, M.round(cssH * dpr)) : 0;

    const baseAura = {
      reach: cl(options.reach ?? defAura.reach, 0.05, 1),
      prism: cl(options.prism ?? defAura.prism, 0, 1),
      surge: cl(options.surge ?? defAura.surge, -1, 1),
      speed: cl(options.speed ?? defAura.speed, 0, 3),
    };
    const activeAura = { ...baseAura };
    let baseSpectrum = options.spectrum !== undefined ? String(options.spectrum) : options.accent !== undefined ? String(options.accent) : null;
    let baseSemantic = options.semantic !== undefined ? String(options.semantic) : 'none';
    let baseAmbient = cl(options.ambientIntensity ?? 1, 0, 1);
    let activeSpectrum = baseSpectrum || 'default', activeSemantic = baseSemantic, activeAmbient = baseAmbient;
    let startMs = null, lastClockMs = null, flowSec = 0, semMix = 0, holdSem = 0;
    let pendingResize = null, pendingDraw = null;

    function post(msg, transfer) {
      if (!worker || disposed || failed) return false;
      try {
        transfer ? worker.postMessage(msg, transfer) : worker.postMessage(msg);
        postMessageCount += 1;
        return true;
      } catch (err) {
        failAndFallback('post-error', err);
        return false;
      }
    }

    function teardownWorker() {
      if (initTimer) { clearTimeout(initTimer); initTimer = 0; }
      if (worker) {
        try { worker.onmessage = null; worker.onerror = null; } catch {}
        try { worker.terminate(); } catch {}
        worker = null;
      }
      if (blobUrl) { safeRevokeUrl(blobUrl); blobUrl = ''; }
      activeSessions.delete(session);
    }

    function failAndFallback(reason, err) {
      if (failed || disposed) return;
      failed = true; ready = false; sleeping = true; paused = true;
      if (reason === 'contextlost') contextLost = true;
      totalFallbacks += 1;
      teardownWorker();
      if (!fallbackNotified) {
        fallbackNotified = true;
        try { options.onFallback?.(reason, err); } catch {}
        if (reason === 'contextlost') { try { options.onContextLost?.({ reason, fromWorker: true }); } catch {} }
      }
    }

    function resolveSpecCode(rawSpec, dark) {
      const fn = core && typeof core.resolveHorizonSpectrumCode === 'function' ? core.resolveHorizonSpectrumCode : null;
      if (rawSpec !== null && rawSpec !== undefined) return fn ? fn(rawSpec) : 0;
      const h = doc && doc.documentElement;
      if (!h || typeof h.getAttribute !== 'function') return 0;
      const ac = fn ? fn(h.getAttribute('data-ag-cs-accent')) : 0;
      if (ac) return ac;
      const pal = String(h.getAttribute('data-ag-cs-palette') || '').toLowerCase();
      if (pal === 'warm' || pal === 'claude') return 1;
      if (!dark && String(h.getAttribute('data-ag-cs-light-preset') || '').toLowerCase() === 'alabaster') return 1;
      return dark && h.getAttribute('data-ag-cs-dark-aura-style') === 'neon' ? 6 : 0;
    }

    const resolveSemCode = (rawSem) => (core && typeof core.resolveHorizonSemanticCode === 'function' ? core.resolveHorizonSemanticCode(rawSem) : 0);

    function setPaused(flag) {
      if (disposed || failed) return;
      if (flag) {
        if (!paused) { paused = true; sleeping = true; if (ready) post({ type: 'sleep' }); }
      } else paused = false;
    }

    function syncSize(w, h, nextDpr) {
      const nw = M.max(0, M.round(Number(w || 0))), nh = M.max(0, M.round(Number(h || 0)));
      const nd = M.max(0.5, M.min(2.0, Number(nextDpr || dpr || 1)));
      const npw = nw > 0 ? M.max(1, M.round(nw * nd)) : 0, nph = nh > 0 ? M.max(1, M.round(nh * nd)) : 0;
      if (nw !== cssW || nh !== cssH || nd !== dpr || npw !== pw || nph !== ph) {
        cssW = nw; cssH = nh; dpr = nd; pw = npw; ph = nph; clearedZero = false; stale = true;
        const msg = { type: 'resize', pw, ph, dpr, syncDraw: true };
        if (ready && !disposed && !failed) post(msg);
        else pendingResize = msg;
      }
    }

    function clearCanvas() {
      clearedZero = true; sleeping = true; paused = true;
      if (ready && !disposed && !failed) post({ type: 'clear' });
    }

    function releaseBackingStore() {
      pw = ph = 0; sleeping = true; paused = true; stale = true;
      pendingResize = pendingDraw = null;
      if (ready && !disposed && !failed) post({ type: 'release' });
    }

    function renderInternal(nowInput, isDarkOrOpts = {}, strengthArg, extraArg, forceStatic = false) {
      if (disposed || failed || pw <= 0 || ph <= 0 || isHostPaused(doc)) {
        if (isHostPaused(doc)) setPaused(true);
        return false;
      }
      if (forceStatic && nowInput && typeof nowInput === 'object') {
        extraArg = strengthArg; strengthArg = isDarkOrOpts; isDarkOrOpts = nowInput; nowInput = 0;
      }
      const isObj = typeof isDarkOrOpts === 'object' && isDarkOrOpts !== null;
      let still = forceStatic, dark = true, rawStrength = 1, extra = null;
      if (isObj) {
        still = forceStatic || Boolean(isDarkOrOpts.still || isDarkOrOpts.staticSnapshot);
        dark = isDarkOrOpts.dark !== false;
        rawStrength = isDarkOrOpts.strength ?? isDarkOrOpts.prismStrength ?? 1;
        const nested = strengthArg && typeof strengthArg === 'object' ? strengthArg : isDarkOrOpts.extra || null;
        extra = nested ? { ...isDarkOrOpts, ...nested } : isDarkOrOpts;
      } else {
        dark = isDarkOrOpts !== false; rawStrength = strengthArg ?? 1;
        extra = extraArg && typeof extraArg === 'object' ? extraArg : null;
        still = forceStatic || Boolean(extra && (extra.still || extra.staticSnapshot));
      }
      const ambient = extra && extra.ambientIntensity !== undefined ? cl(extra.ambientIntensity, 0, 1) : baseAmbient;
      activeAmbient = ambient;
      const strength = cl(rawStrength, 0, 1) * ambient;
      if (ambient <= 0 || (forceStatic && strength <= 0)) {
        if (!clearedZero) clearCanvas(); else sleeping = true;
        return false;
      }
      const reach = extra && extra.reach !== undefined ? cl(extra.reach, 0.05, 1) : baseAura.reach;
      const prism = extra && extra.prism !== undefined ? cl(extra.prism, 0, 1) : baseAura.prism;
      const surge = extra && extra.surge !== undefined ? cl(extra.surge, -1, 1) : baseAura.surge;
      const speed = extra && extra.speed !== undefined ? cl(extra.speed, 0, 3) : baseAura.speed;
      const rawSpec = extra && (extra.spectrum !== undefined || extra.accent !== undefined) ? extra.spectrum ?? extra.accent : baseSpectrum;
      const specCode = resolveSpecCode(rawSpec, dark);
      const rawSem = extra && extra.semantic !== undefined ? extra.semantic : baseSemantic;
      const semCode = resolveSemCode(rawSem);
      activeAura.reach = reach; activeAura.prism = prism; activeAura.surge = surge; activeAura.speed = speed;
      activeSpectrum = rawSpec || (specCode === 1 ? 'warm' : 'default'); activeSemantic = String(rawSem || 'none');

      const nowMs = Number(nowInput || 0);
      if (startMs === null) startMs = nowMs;
      let dtSec = 0;
      if (forceStatic) { if (flowSec === 0) flowSec = 2.4; lastClockMs = nowMs; sleeping = true; }
      else if (still) { lastClockMs = nowMs; sleeping = true; }
      else {
        sleeping = false; paused = false;
        if (lastClockMs === null || nowMs < lastClockMs) lastClockMs = nowMs;
        else { dtSec = M.min(0.35, M.max(0, (nowMs - lastClockMs) / 1000)); lastClockMs = nowMs; flowSec += dtSec * speed; }
      }
      if (semCode > 0) holdSem = semCode;
      if (forceStatic || still) semMix = semCode > 0 ? 1 : 0;
      else {
        const tgt = semCode > 0 ? 1 : 0;
        semMix += (tgt - semMix) * M.min(1, M.max(0.04, dtSec / 0.45));
        if (M.abs(tgt - semMix) < 0.01) semMix = tgt;
      }
      const effSem = holdSem > 0 && semMix > 0.005 ? holdSem + (1 - semMix) * 0.98 : 0;
      const breath = forceStatic ? 0.64 : still ? 0.58 : 0.46 + 0.24 * M.sin(flowSec * 1.15) + 0.06 * M.sin(flowSec * 2.05 + 0.9);
      const intensity = breath * (0.55 + 0.45 * strength);
      const presence = strength <= 0 ? 0 : strength >= 0.999 ? 1 : M.pow(strength, 0.78);
      const msg = {
        type: 'draw', dark: Boolean(dark), intensity, presence, reach, prism, surge, speed, spec: specCode, sem: effSem,
        timeSec: 12 + flowSec, still: Boolean(still), anim: Boolean(!still && options.workerAutoLoop === true),
        continuous: Boolean(extra && extra.continuous), maxFps: getPerfProfile(doc).maxFps,
      };
      if (ready) post(msg); else pendingDraw = msg;
      clearedZero = false; stale = false;
      return true;
    }

    const session = {
      mode: 'worker-webgl2',
      isContextLost: () => contextLost || failed,
      isSleeping: () => sleeping || paused,
      getBufferSize: () => ({ width: pw, height: ph, dpr }),
      resize: syncSize,
      invalidate() { stale = true; },
      clear: clearCanvas,
      releaseBackingStore,
      setPaused,
      setAuraParams(extra) {
        if (!extra || typeof extra !== 'object') {
          Object.assign(baseAura, defAura); baseSpectrum = null; baseSemantic = 'none'; baseAmbient = 1;
        } else {
          if (extra.reach !== undefined) baseAura.reach = cl(extra.reach, 0.05, 1);
          if (extra.prism !== undefined) baseAura.prism = cl(extra.prism, 0, 1);
          if (extra.surge !== undefined) baseAura.surge = cl(extra.surge, -1, 1);
          if (extra.speed !== undefined) baseAura.speed = cl(extra.speed, 0, 3);
          if (extra.spectrum !== undefined || extra.accent !== undefined) baseSpectrum = String(extra.spectrum ?? extra.accent);
          if (extra.semantic !== undefined) baseSemantic = String(extra.semantic);
          if (extra.ambientIntensity !== undefined) baseAmbient = cl(extra.ambientIntensity, 0, 1);
        }
        Object.assign(activeAura, baseAura); stale = true;
        return { ...activeAura };
      },
      getAuraParams: () => ({ ...activeAura }),
      getExtendedState: () => ({ ...activeAura, spectrum: activeSpectrum, semantic: activeSemantic, ambientIntensity: activeAmbient, sleeping }),
      draw: (n, d, s, e) => renderInternal(n, d, s, e, false),
      drawStaticSnapshot: (n, d, s, e) => { stale = true; return renderInternal(n, d, s, e, true); },
      getStats: () => ({ ready, failed, disposed, paused, sleeping, contextLost, postMessageCount }),
      dispose() {
        if (disposed) return;
        disposed = true; sleeping = true; paused = true;
        if (worker && !failed) { try { worker.postMessage({ type: 'dispose' }); } catch {} }
        teardownWorker();
      },
    };

    try {
      offscreen = canvas.transferControlToOffscreen();
      const created = createBlobWorker(RENDER_WORKER_SRC);
      worker = created.worker; blobUrl = created.url;
      activeSessions.add(session);
      worker.onmessage = (ev) => {
        const d = ev && ev.data;
        if (!d || disposed || failed) return;
        if (d.type === 'ready') {
          if (initTimer) { clearTimeout(initTimer); initTimer = 0; }
          ready = true;
          if (pendingResize) { post(pendingResize); pendingResize = null; }
          if (pendingDraw && !paused) { post(pendingDraw); pendingDraw = null; }
          if (paused) post({ type: 'sleep' });
        } else if (d.type === 'slept') sleeping = true;
        else if (d.type === 'contextlost' || d.type === 'error') failAndFallback(d.type === 'contextlost' ? 'contextlost' : d.reason || 'worker-error');
      };
      worker.onerror = (err) => failAndFallback('worker-onerror', err);
      initTimer = setTimeout(() => { if (!ready && !disposed && !failed) failAndFallback('init-timeout'); }, initTimeoutMs);
      post({ type: 'init', canvas: offscreen, vs: shaders.vs, fs: shaders.fs, pw, ph, dpr, idleTimeoutMs, maxFps: getPerfProfile(doc).maxFps }, [offscreen]);
      return session;
    } catch (err) {
      failAndFallback('transfer-or-construct-error', err);
      return null;
    }
  }

  async function mountGlowWorkerWithProbe(canvas, options = {}) {
    const res = await probeWorkerWebGL2({ timeoutMs: options.probeTimeoutMs, force: options.forceProbe });
    if (!res || !res.ok) {
      totalFallbacks += 1;
      try { options.onFallback?.(res ? res.reason : 'probe-failed'); } catch {}
      return null;
    }
    return mountGlowWorker(canvas, options);
  }

  // 通用安全挂载器：优先 OffscreenCanvas Worker（先 1x1 探针缓存），任何异常/丢失自动 swapCanvas 回退主线程
  function mountManagedGlow(cfg = {}) {
    const { getCanvas, swapCanvas, rippleCore, doc, prefer2D, allowWorker = true, onContextLost, onFallbackDone, onUpgradeReady } = cfg;
    const hasG = Boolean(rippleCore && typeof rippleCore.mountBrandHorizonGlow === 'function');
    const cv0 = typeof getCanvas === 'function' ? getCanvas() : null;
    if (!cv0 || !hasG) return { mode: 'none', resize() {}, clear() {}, draw() {}, drawStaticSnapshot() {}, dispose() {} };
    if (!prefer2D && allowWorker) {
      const w = mountGlowWorker(cv0, {
        rippleCore, doc, width: 0, height: 0,
        onContextLost,
        onFallback: (reason) => { try { onFallbackDone?.(reason); } catch {} },
        onProbeReady: (res) => { try { onUpgradeReady?.(res); } catch {} },
      });
      if (w) return w;
    }
    const mk = (u) => rippleCore.mountBrandHorizonGlow(getCanvas(), { prefer2D: !!u, width: 0, height: 0, onContextLost });
    let g = mk(prefer2D);
    if (g && g.mode === 'none' && !prefer2D && typeof swapCanvas === 'function') {
      try { g.dispose?.(true); } catch {}
      swapCanvas();
      g = mk(true);
    }
    return g;
  }

  function disposeAll() {
    for (const s of [...activeSessions]) { try { s.dispose(); } catch {} }
    activeSessions.clear();
    if (activeProbeWorker) { try { activeProbeWorker.terminate(); } catch {} activeProbeWorker = null; }
    if (activeProbeUrl) { safeRevokeUrl(activeProbeUrl); activeProbeUrl = ''; }
    probePending = null;
  }

  const getActiveWorkerCount = () => activeSessions.size + (activeProbeWorker ? 1 : 0);
  const getStats = () => ({ perfMode: getPerfMode(), probe: getProbeStatus(), activeWorkers: getActiveWorkerCount(), totalFallbacks });

  return {
    PROBE_TIMEOUT_MS, IDLE_SLEEP_MS, PERF_PROFILES, PROBE_WORKER_SRC, RENDER_WORKER_SRC,
    getPerfMode, getPerfProfile, getPerfMinGapMs, resolveRippleDpr, resolveGlowDpr, isHostPaused,
    probeWorkerWebGL2, warmProbe, getProbeStatus, resetProbeCache,
    mountGlowWorker, mountGlowWorkerWithProbe, mountManagedGlow, disposeAll, getActiveWorkerCount, getStats,
  };
});
