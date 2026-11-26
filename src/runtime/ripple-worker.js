// Obsidian Prism — OffscreenCanvas WebGL2 Worker (glow & field) + 1x1 Probe + Perf Profiles
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.__agPrismRippleWorker = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function (G) {
  'use strict';
  const M = Math, PROBE_TIMEOUT_MS = 600, INIT_TIMEOUT_MS = 800, PROBE_RETRY_DELAY_MS = 1500, IDLE_SLEEP_MS = 1200;
  const PERF_PROFILES = Object.freeze({
    balanced: Object.freeze({ mode: 'balanced', glowDprScale: 0.7, rippleMaxDpr: 1.5, crystalMaxDpr: 1.5, vialMaxDpr: 1.5, maxFps: 0, minGapMs: 0, msaa: false }),
    performance: Object.freeze({ mode: 'performance', glowDprScale: 0.55, rippleMaxDpr: 1.0, crystalMaxDpr: 1.0, vialMaxDpr: 1.0, maxFps: 60, minGapMs: 16.67, msaa: false }),
    quality: Object.freeze({ mode: 'quality', glowDprScale: 1.0, rippleMaxDpr: 2.0, crystalMaxDpr: 1.5, vialMaxDpr: 2.0, maxFps: 0, minGapMs: 0, msaa: true }),
  });

  const activeSessions = new Set(), probeRetryCbs = new Set();
  let activeProbeWorker = null, activeProbeUrl = '', probeCache = null, probePending = null, totalFallbacks = 0;
  let probeTimeoutRetries = 0, probeRetryAfter = 0, probeRetryTimer = 0, managedGlowDepth = 0, lastNestedGlow = null;

  const cl = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? M.max(lo, M.min(hi, n)) : lo; };
  const getDoc = (doc) => doc || (typeof document !== 'undefined' ? document : null);
  const readRawPerfAttr = (doc) => {
    const h = getDoc(doc)?.documentElement;
    if (!h) return '';
    return String((h.dataset && typeof h.dataset.agCsPerfMode === 'string' ? h.dataset.agCsPerfMode : '') || (typeof h.getAttribute === 'function' ? h.getAttribute('data-ag-cs-perf-mode') : '') || '').trim().toLowerCase();
  };
  const getPerfMode = (doc) => { const r = readRawPerfAttr(doc); return r === 'performance' || r === 'quality' || r === 'balanced' ? r : 'balanced'; };
  const getPerfProfile = (doc) => PERF_PROFILES[getPerfMode(doc)] || PERF_PROFILES.balanced;
  const getPerfMinGapMs = (doc) => getPerfProfile(doc).minGapMs;
  const resolveRippleDpr = (rawDpr, doc) => M.min(Number.isFinite(Number(rawDpr)) && Number(rawDpr) > 0 ? Number(rawDpr) : 1, getPerfProfile(doc).rippleMaxDpr);
  function resolveGlowDpr(rawDpr, doc, baseScale) {
    const raw = Number.isFinite(Number(rawDpr)) && Number(rawDpr) > 0 ? Number(rawDpr) : 1, prof = getPerfProfile(doc);
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

  const PROBE_WORKER_SRC = [
    "'use strict';self.onmessage=function(ev){var d=ev&&ev.data;if(!d||d.type!=='probe'||!d.canvas)return;try{",
    "var gl=d.canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:false});",
    "var ok=Boolean(gl&&(!gl.isContextLost||!gl.isContextLost()));",
    "if(gl){try{var ext=gl.getExtension('WEBGL_lose_context');if(ext)ext.loseContext();}catch(e){}}",
    "self.postMessage({type:'probe',ok:ok,reason:ok?'ok':'webgl2-null'});",
    "}catch(err){self.postMessage({type:'probe',ok:false,reason:String((err&&err.message)||err||'probe-err')});}};",
  ].join('');

  const RENDER_WORKER_SRC = [
    "'use strict';var mode='glow',cv,gl,prog,u={},raf=0,paused=0,dead=0,rdy=0,dpr=1,fSec=0,lClk=0,lDraw=0,lAct=0,idleMs=1200,maxFps=0;",
    "var fc=0,fr=0,fw=7,fh=15,fsz=10,fg='',cTex,aTex,aCv,aCtx,aKey='';",
    "var cur={dark:1,intensity:.6,presence:1,reach:.47,prism:0,surge:0,speed:1,spec:0,sem:0,still:1,anim:0,continuous:0,timeSec:12,hu:null};",
    "function now(){return typeof performance!=='undefined'&&performance.now?performance.now():Date.now();}",
    "function sRaf(){if(raf&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(raf);raf=0;}",
    "function free(){if(gl){try{if(prog)gl.deleteProgram(prog);if(cTex)gl.deleteTexture(cTex);if(aTex)gl.deleteTexture(aTex);}catch(e){}}prog=cTex=aTex=null;u={};aKey='';}",
    "function cmp(t,s){var h=gl.createShader(t);gl.shaderSource(h,s);gl.compileShader(h);if(!gl.getShaderParameter(h,gl.COMPILE_STATUS)){var l=gl.getShaderInfoLog(h)||'sh';gl.deleteShader(h);throw new Error(l);}return h;}",
    "function mT(un,fl){var t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+un);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,fl);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,fl);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;}",
    "function aCell(){if(cTex)gl.deleteTexture(cTex);cTex=mT(0,gl.NEAREST);if(fc>0&&fr>0)gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,fc,fr);}",
    "function bld(vs,fs,ns){free();var v=cmp(gl.VERTEX_SHADER,vs),f=cmp(gl.FRAGMENT_SHADER,fs);prog=gl.createProgram();gl.attachShader(prog,v);gl.attachShader(prog,f);gl.linkProgram(prog);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(prog)||'link');gl.useProgram(prog);ns=ns.split(',');for(var i=0;i<ns.length;i++)u[ns[i]]=gl.getUniformLocation(prog,ns[i]);}",
    "function u1(l,v){if(l)gl.uniform1f(l,v);}function u3(l,v){if(l&&v)gl.uniform3f(l,v[0],v[1],v[2]);}function u4(l,v){if(l&&v)gl.uniform4f(l,v[0],v[1],v[2],v[3]);}",
    "function bAtl(fn,d){var k=fn+'|'+d;if(k===aKey)return;if(!aCv){if(typeof OffscreenCanvas!=='function')throw new Error('no-offscreen');aCv=new OffscreenCanvas(1,1);aCtx=aCv.getContext('2d');if(!aCtx)throw new Error('no-2d');}var w=Math.ceil(fw*d),h=Math.ceil(fh*d);aCv.width=w*fg.length;aCv.height=h;aCtx.setTransform(w/fw,0,0,h/fh,0,0);aCtx.clearRect(0,0,fw*fg.length,fh);aCtx.font=fsz+'px '+fn;aCtx.textBaseline='middle';aCtx.textAlign='center';aCtx.fillStyle='#fff';for(var i=0;i<fg.length;i++)aCtx.fillText(fg[i],i*fw+fw/2,fh/2);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,aTex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,aCv);gl.uniform2f(u.atlasCell,w,h);u1(u.glyphCount,fg.length);aKey=k;}",
    "function pGlow(t){if(!gl||!prog||!cv||cv.width<=0||cv.height<=0||(gl.isContextLost&&gl.isContextLost()))return;gl.viewport(0,0,cv.width,cv.height);gl.useProgram(prog);gl.uniform2f(u.uRes,cv.width,cv.height);u1(u.uDpr,dpr);u1(u.uTime,t);u1(u.uDark,cur.dark);u1(u.uReach,cur.reach);u1(u.uIntensity,cur.intensity);u1(u.uPresence,cur.presence);u1(u.uPrism,cur.prism);u1(u.uSurge,cur.surge);u1(u.uSpeed,cur.speed);u1(u.uSpectrum,cur.spec);u1(u.uSemantic,cur.sem);var h=cur.hu;if(h){u4(u.uPre0,h.pre0);u4(u.uPre1,h.pre1);u4(u.uSpecModes,h.modes);u3(u.uBaseA,h.baseA);u3(u.uBaseB,h.baseB);u3(u.uPrismA,h.prismA);u3(u.uPrismB,h.prismB);u3(u.uLightA,h.lightA);u3(u.uLightB,h.lightB);u3(u.uSurgeLead,h.surgeLead);u3(u.uChimeLead,h.chimeLead);u3(u.uHotAnchor,h.hotAnchor);u3(u.uSemA,h.semA);u3(u.uSemB,h.semB);}gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);}",
    "function pField(p,b){if(!gl||!prog||!cv||cv.width<=0||cv.height<=0||fc<=0||fr<=0||(gl.isContextLost&&gl.isContextLost()))return;gl.useProgram(prog);bAtl(p.font,p.dpr);gl.viewport(0,0,cv.width,cv.height);gl.uniform2f(u.size,cv.width,cv.height);gl.uniform2f(u.grid,fc,fr);gl.uniform2f(u.cellPixels,fw*p.dpr,fh*p.dpr);u3(u.ink,p.ink);u3(u.wave,p.wave);u4(u.aura,p.aura);u4(u.optics,p.optics);u1(u.auraLift,p.auraLift);u1(u.auraPhase,p.auraPhase);u1(u.lightMode,p.lightMode);u3(u.uSpec0,p.sp0);u3(u.uSpec1,p.sp1);u3(u.uSpec2,p.sp2);u3(u.uSpec3,p.sp3);u4(u.uIdleParams,p.idle);u4(u.neb0,p.n0);u4(u.neb1,p.n1);u4(u.neb2,p.n2);u4(u.nebOpt,p.nOpt);u1(u.nebulaLift,p.nLift);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,cTex);if(b)gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,fc,fr,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(b));gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);}",
    "function tick(ts){raf=0;if(dead||paused||!rdy||mode!=='glow'||!cur.anim||cur.still)return;var n=typeof ts==='number'?ts:now();if(!cur.continuous&&idleMs>0&&lAct>0&&n-lAct>=idleMs){cur.anim=0;sRaf();try{self.postMessage({type:'slept'});}catch(e){}return;}var g=maxFps>0?1000/maxFps:0;if(g>0&&lDraw>0&&n-lDraw<g-.5){if(typeof requestAnimationFrame==='function')raf=requestAnimationFrame(tick);return;}var dt=lClk>0?Math.min(.1,Math.max(0,(n-lClk)/1000)):.016;lClk=lDraw=n;fSec+=dt*cur.speed;pGlow(12+fSec);if(typeof requestAnimationFrame==='function')raf=requestAnimationFrame(tick);}",
    "function arm(){if(!dead&&!paused&&rdy&&mode==='glow'&&cur.anim&&!cur.still&&!raf&&typeof requestAnimationFrame==='function')raf=requestAnimationFrame(tick);}",
    "self.onmessage=function(ev){var m=ev&&ev.data;if(!m||dead)return;",
    "if(m.type==='init'){try{mode=m.mode||'glow';cv=m.canvas;idleMs=Number(m.idleTimeoutMs)||1200;maxFps=Number(m.maxFps)||0;if(cv&&cv.addEventListener)cv.addEventListener('webglcontextlost',function(e){if(e&&e.preventDefault)e.preventDefault();sRaf();rdy=0;try{self.postMessage({type:'contextlost'});}catch(x){}});gl=cv&&cv.getContext?cv.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:false}):null;if(!gl||(gl.isContextLost&&gl.isContextLost()))throw new Error('webgl2-unavailable');if(mode==='field'){fc=m.cols|0;fr=m.rows|0;fw=m.cellW||7;fh=m.cellH||15;fsz=m.fontSize||10;fg=m.glyphs||'';bld(m.vs,m.fs,'cells,atlas,size,grid,cellPixels,atlasCell,glyphCount,ink,wave,aura,optics,auraLift,auraPhase,lightMode,neb0,neb1,neb2,nebOpt,nebulaLift,uSpec0,uSpec1,uSpec2,uSpec3,uIdleParams,uIdleMetrics');aCell();aTex=mT(1,gl.LINEAR);gl.uniform1i(u.cells,0);gl.uniform1i(u.atlas,1);u4(u.uIdleMetrics,[fw,fh,1/(m.cloudScale||100),1/(m.breathScale||280)]);}else{bld(m.vs,m.fs,'uRes,uDpr,uTime,uDark,uReach,uIntensity,uPresence,uPrism,uSurge,uSpeed,uSpectrum,uSemantic,uPre0,uPre1,uSpecModes,uBaseA,uBaseB,uPrismA,uPrismB,uLightA,uLightB,uSurgeLead,uChimeLead,uHotAnchor,uSemA,uSemB');}if(m.pw>0&&m.ph>0){cv.width=m.pw;cv.height=m.ph;dpr=m.dpr||1;}rdy=1;lAct=now();self.postMessage({type:'ready'});}catch(err){sRaf();free();rdy=0;try{self.postMessage({type:'error',reason:String((err&&err.message)||err||'init-err')});}catch(x){}}return;}",
    "if(m.type==='resize'){if(!cv)return;var nw=Math.max(0,m.pw|0),nh=Math.max(0,m.ph|0);dpr=m.dpr||dpr||1;if(cv.width!==nw||cv.height!==nh){cv.width=nw;cv.height=nh;}if(mode==='field'){var nc=Math.max(0,m.cols|0),nr=Math.max(0,m.rows|0);if(rdy&&(nc!==fc||nr!==fr)){fc=nc;fr=nr;aCell();}}else if(rdy&&!paused&&nw>0&&nh>0&&m.syncDraw!==false)pGlow(cur.timeSec||(12+fSec));return;}",
    "if(m.type==='draw'){if(mode==='field'){paused=0;if(rdy)try{pField(m.params,m.cellsBuf);}catch(e){try{self.postMessage({type:'error',reason:String((e&&e.message)||e||'field-draw')});}catch(x){}}return;}paused=0;if(m.maxFps!==undefined)maxFps=Number(m.maxFps)||0;cur.dark=m.dark?1:0;cur.intensity=m.intensity;cur.presence=m.presence;cur.reach=m.reach;cur.prism=m.prism;cur.surge=m.surge;cur.speed=m.speed;cur.spec=m.spec||0;cur.sem=m.sem||0;cur.hu=m.hu||null;cur.still=m.still?1:0;cur.anim=m.anim?1:0;cur.continuous=m.continuous?1:0;cur.timeSec=m.timeSec;fSec=Math.max(0,(m.timeSec||12)-12);lAct=lClk=lDraw=now();if(rdy&&cv&&cv.width>0&&cv.height>0)pGlow(cur.timeSec);if(cur.anim&&!cur.still)arm();else sRaf();return;}",
    "if(m.type==='clear'){sRaf();paused=1;if(gl&&cv&&cv.width>0&&cv.height>0&&(!gl.isContextLost||!gl.isContextLost())){gl.viewport(0,0,cv.width,cv.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}return;}",
    "if(m.type==='sleep'){paused=1;cur.anim=0;sRaf();return;}",
    "if(m.type==='release'){paused=1;cur.anim=0;sRaf();if(cv){cv.width=0;cv.height=0;}return;}",
    "if(m.type==='dispose'){dead=1;paused=1;sRaf();free();if(gl){try{var ext=gl.getExtension('WEBGL_lose_context');if(ext)ext.loseContext();}catch(e){}}gl=cv=aCv=aCtx=null;try{self.close&&self.close();}catch(e){}}};",
  ].join('');

  const safeRevokeUrl = (u) => { if (!u) return; try { ((G && G.URL) || (typeof URL !== 'undefined' ? URL : null))?.revokeObjectURL?.(u); } catch {} };
  const apiOf = (k, g) => (G && G[k]) || (typeof g !== 'undefined' ? g : null);
  function createBlobWorker(src) {
    const B = apiOf('Blob', typeof Blob !== 'undefined' ? Blob : undefined), U = apiOf('URL', typeof URL !== 'undefined' ? URL : undefined), W = apiOf('Worker', typeof Worker !== 'undefined' ? Worker : undefined);
    if (!B || !U?.createObjectURL || !W) throw new Error('worker-api-unavailable');
    const url = U.createObjectURL(new B([src], { type: 'application/javascript' }));
    try { return { worker: new W(url), url }; } catch (err) { safeRevokeUrl(url); throw err; }
  }
  const hasOffscreenApi = () => Boolean(apiOf('OffscreenCanvas', typeof OffscreenCanvas !== 'undefined' ? OffscreenCanvas : undefined) && apiOf('Worker', typeof Worker !== 'undefined' ? Worker : undefined) && apiOf('Blob', typeof Blob !== 'undefined' ? Blob : undefined) && apiOf('URL', typeof URL !== 'undefined' ? URL : undefined)?.createObjectURL);
  const clearProbeRetry = () => { if (probeRetryTimer) { clearTimeout(probeRetryTimer); probeRetryTimer = 0; } probeRetryCbs.clear(); };
  function scheduleProbeRetry(opts = {}, onReady) {
    if (typeof onReady === 'function') probeRetryCbs.add(onReady);
    if (probeRetryTimer || !probeCache || probeCache.ok || !probeCache.retryable) return;
    const waitMs = opts.retryDelayMs !== undefined ? M.max(0, Number(opts.retryDelayMs)) : M.max(0, probeRetryAfter - Date.now());
    probeRetryTimer = setTimeout(() => {
      probeRetryTimer = 0;
      const cbs = [...probeRetryCbs]; probeRetryCbs.clear();
      if (!probeCache || probeCache.ok || !probeCache.retryable) return;
      probeWorkerWebGL2({ force: true, timeoutMs: opts.timeoutMs }).then((res) => {
        if (res && res.ok) for (const cb of cbs) { try { cb(res); } catch {} }
      }).catch(() => {});
    }, waitMs);
  }
  function probeWorkerWebGL2(opts = {}) {
    const canRetryTimeout = Boolean(probeCache && !probeCache.ok && probeCache.retryable && Date.now() >= probeRetryAfter);
    if (!opts.force && probeCache && !canRetryTimeout) return Promise.resolve(probeCache);
    if (!opts.force && probePending) return probePending;
    if (!hasOffscreenApi()) {
      probeCache = Object.freeze({ ok: false, reason: 'unsupported', retryable: false, checkedAt: Date.now() });
      return Promise.resolve(probeCache);
    }
    const timeoutMs = M.max(10, Number(opts.timeoutMs) || PROBE_TIMEOUT_MS);
    const retryDelayMs = M.max(0, opts.retryDelayMs !== undefined ? Number(opts.retryDelayMs) : PROBE_RETRY_DELAY_MS);
    probePending = new Promise((resolve) => {
      let settled = false, timer = 0, worker = null, url = '';
      const finish = (ok, reason) => {
        if (settled) return;
        settled = true;
        if (timer) { clearTimeout(timer); timer = 0; }
        if (worker) {
          try { worker.onmessage = worker.onerror = null; worker.terminate(); } catch {}
          if (activeProbeWorker === worker) activeProbeWorker = null;
          worker = null;
        }
        if (url) { safeRevokeUrl(url); if (activeProbeUrl === url) activeProbeUrl = ''; url = ''; }
        const finalReason = String(reason || (ok ? 'ok' : 'failed'));
        const isFirstTimeout = !ok && finalReason === 'timeout' && probeTimeoutRetries < 1;
        if (isFirstTimeout) { probeTimeoutRetries += 1; probeRetryAfter = Date.now() + retryDelayMs; }
        else { if (ok) probeTimeoutRetries = 0; probeRetryAfter = 0; }
        probeCache = Object.freeze({ ok: Boolean(ok), reason: finalReason, retryable: isFirstTimeout, checkedAt: Date.now() });
        probePending = null;
        resolve(probeCache);
      };
      try {
        const Off = (G && G.OffscreenCanvas) || OffscreenCanvas, probeCv = new Off(1, 1);
        const created = createBlobWorker(PROBE_WORKER_SRC);
        worker = activeProbeWorker = created.worker; url = activeProbeUrl = created.url;
        worker.onmessage = (ev) => { const d = ev && ev.data; if (d && d.type === 'probe') finish(Boolean(d.ok), d.reason || (d.ok ? 'ok' : 'webgl2-null')); };
        worker.onerror = (err) => finish(false, (err && err.message) || 'worker-error');
        timer = setTimeout(() => finish(false, 'timeout'), timeoutMs);
        worker.postMessage({ type: 'probe', canvas: probeCv }, [probeCv]);
      } catch (err) { finish(false, (err && err.message) || 'csp-blocked'); }
    });
    return probePending;
  }
  const warmProbe = (opts) => { try { probeWorkerWebGL2(opts).catch(() => {}); } catch {} };
  const getProbeStatus = () => (probeCache ? { probed: true, ok: probeCache.ok, reason: probeCache.reason } : { probed: false, ok: false, reason: probePending ? 'probing' : 'unprobed' });
  function resetProbeCache() {
    clearProbeRetry();
    if (activeProbeWorker) { try { activeProbeWorker.terminate(); } catch {} activeProbeWorker = null; }
    if (activeProbeUrl) { safeRevokeUrl(activeProbeUrl); activeProbeUrl = ''; }
    probeCache = probePending = null; probeTimeoutRetries = probeRetryAfter = 0;
  }
  function checkWorkerProbe(options) {
    const needs = !probeCache || (!probeCache.ok && probeCache.retryable && Date.now() >= probeRetryAfter);
    const ro = { timeoutMs: options.probeTimeoutMs, retryDelayMs: options.probeRetryDelayMs };
    if (needs) {
      warmProbe(ro);
      if (typeof options.onProbeReady === 'function' && probePending) {
        probePending.then((res) => {
          if (res && res.ok) { try { options.onProbeReady(res); } catch {} }
          else if (res && res.retryable) scheduleProbeRetry(ro, options.onProbeReady);
        });
      }
      return false;
    }
    if (!probeCache.ok) {
      if (probeCache.retryable && typeof options.onProbeReady === 'function') scheduleProbeRetry(ro, options.onProbeReady);
      return false;
    }
    return true;
  }
  function createWorkerChannel(sessionRef, options, hooks) {
    const initTimeoutMs = M.max(20, Number(options.initTimeoutMs) || INIT_TIMEOUT_MS);
    let worker = null, blobUrl = '', initTimer = 0, ready = false, failed = false, disposed = false, contextLost = false, fallbackNotified = false, postCount = 0;
    const teardown = () => {
      if (initTimer) { clearTimeout(initTimer); initTimer = 0; }
      if (worker) { try { worker.onmessage = worker.onerror = null; worker.terminate(); } catch {} worker = null; }
      if (blobUrl) { safeRevokeUrl(blobUrl); blobUrl = ''; }
      activeSessions.delete(sessionRef);
    };
    const fail = (reason, err) => {
      if (failed || disposed) return;
      failed = true; ready = false; if (reason === 'contextlost') contextLost = true;
      totalFallbacks += 1; teardown(); hooks.onFail?.(reason);
      if (!fallbackNotified) {
        fallbackNotified = true;
        try { options.onFallback?.(reason, err); } catch {}
        if (reason === 'contextlost') { try { options.onContextLost?.({ reason, fromWorker: true }); } catch {} }
      }
    };
    const post = (msg, xfer) => {
      if (!worker || disposed || failed) return false;
      try { xfer ? worker.postMessage(msg, xfer) : worker.postMessage(msg); postCount += 1; return true; }
      catch (err) { fail('post-error', err); return false; }
    };
    const start = (canvas, initMsg) => {
      try {
        const off = canvas.transferControlToOffscreen(), created = createBlobWorker(RENDER_WORKER_SRC);
        worker = created.worker; blobUrl = created.url; activeSessions.add(sessionRef);
        worker.onmessage = (ev) => {
          const d = ev && ev.data;
          if (!d || disposed || failed) return;
          if (d.type === 'ready') { if (initTimer) { clearTimeout(initTimer); initTimer = 0; } ready = true; hooks.onReady?.(); }
          else if (d.type === 'slept') hooks.onSlept?.();
          else if (d.type === 'contextlost' || d.type === 'error') fail(d.type === 'contextlost' ? 'contextlost' : d.reason || 'worker-error');
        };
        worker.onerror = (err) => fail('worker-onerror', err);
        initTimer = setTimeout(() => { if (!ready && !disposed && !failed) fail('init-timeout'); }, initTimeoutMs);
        post({ ...initMsg, canvas: off }, [off]);
        return true;
      } catch (err) { fail('transfer-or-construct-error', err); return false; }
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      if (worker && !failed) { try { worker.postMessage({ type: 'dispose' }); } catch {} }
      teardown();
    };
    return { start, post, fail, dispose, state: () => ({ ready, failed, disposed, contextLost, postMessageCount: postCount }) };
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
    if (!shaders || !checkWorkerProbe(options)) return null;

    const doc = (canvas && canvas.ownerDocument) || getDoc(options.doc), core = shaders.core;
    const defAura = (core && core.DEFAULT_HORIZON_AURA) || { reach: 0.47, prism: 0, surge: 0, speed: 1 };
    const idleTimeoutMs = M.max(200, Number(options.idleTimeoutMs) || IDLE_SLEEP_MS);
    let paused = false, sleeping = false, stale = true, clearedZero = false;
    let cssW = M.max(0, Number(options.width ?? 0)), cssH = M.max(0, Number(options.height ?? 0));
    let dpr = cl(options.dpr || 1, 0.5, 2), pw = cssW > 0 ? M.max(1, M.round(cssW * dpr)) : 0, ph = cssH > 0 ? M.max(1, M.round(cssH * dpr)) : 0;
    const baseAura = { reach: cl(options.reach ?? defAura.reach, 0.05, 1), prism: cl(options.prism ?? defAura.prism, 0, 1), surge: cl(options.surge ?? defAura.surge, -1, 1), speed: cl(options.speed ?? defAura.speed, 0, 3) };
    const activeAura = { ...baseAura };
    let baseSpectrum = options.spectrum !== undefined ? String(options.spectrum) : options.accent !== undefined ? String(options.accent) : null;
    let baseSemantic = options.semantic !== undefined ? String(options.semantic) : 'none', baseAmbient = cl(options.ambientIntensity ?? 1, 0, 1);
    let activeSpectrum = baseSpectrum || 'default', activeSemantic = baseSemantic, activeAmbient = baseAmbient;
    let startMs = null, lastClockMs = null, flowSec = 0, semMix = 0, holdSem = 0, pendingResize = null, pendingDraw = null;

    function resolveSpecCode(rawSpec, dark) {
      const fn = core?.resolveHorizonSpectrumCode;
      if (rawSpec != null) return fn ? fn(rawSpec) : 0;
      const h = doc?.documentElement;
      if (!h?.getAttribute) return 0;
      const ac = fn ? fn(h.getAttribute('data-ag-cs-accent')) : 0;
      if (ac) return ac;
      const pal = String(h.getAttribute('data-ag-cs-palette') || '').toLowerCase();
      if (pal === 'warm' || pal === 'claude') return 1;
      if (!dark && String(h.getAttribute('data-ag-cs-light-preset') || '').toLowerCase() === 'alabaster') return 1;
      return dark && h.getAttribute('data-ag-cs-dark-aura-style') === 'neon' ? 6 : 0;
    }
    const resolveSemCode = (s) => (core?.resolveHorizonSemanticCode ? core.resolveHorizonSemanticCode(s) : 0);

    const session = { mode: 'worker-webgl2' };
    const ch = createWorkerChannel(session, options, {
      onFail: () => { sleeping = paused = true; },
      onSlept: () => { sleeping = true; },
      onReady: () => {
        if (pendingResize) { ch.post(pendingResize); pendingResize = null; }
        if (pendingDraw && !paused) { ch.post(pendingDraw); pendingDraw = null; }
        if (paused) ch.post({ type: 'sleep' });
      },
    });
    const setPaused = (flag) => {
      const st = ch.state();
      if (st.disposed || st.failed) return;
      if (flag) { if (!paused) { paused = sleeping = true; if (st.ready) ch.post({ type: 'sleep' }); } }
      else paused = false;
    };
    const syncSize = (w, h, nextDpr) => {
      const nw = M.max(0, M.round(Number(w || 0))), nh = M.max(0, M.round(Number(h || 0))), nd = cl(nextDpr || dpr || 1, 0.5, 2);
      const npw = nw > 0 ? M.max(1, M.round(nw * nd)) : 0, nph = nh > 0 ? M.max(1, M.round(nh * nd)) : 0;
      if (nw !== cssW || nh !== cssH || nd !== dpr || npw !== pw || nph !== ph) {
        cssW = nw; cssH = nh; dpr = nd; pw = npw; ph = nph; clearedZero = false; stale = true;
        const msg = { type: 'resize', pw, ph, dpr, syncDraw: true }, st = ch.state();
        if (st.ready && !st.disposed && !st.failed) ch.post(msg); else pendingResize = msg;
      }
    };
    const clearCanvas = () => { clearedZero = sleeping = paused = true; const st = ch.state(); if (st.ready && !st.disposed && !st.failed) ch.post({ type: 'clear' }); };
    const releaseBackingStore = () => { pw = ph = 0; sleeping = paused = stale = true; pendingResize = pendingDraw = null; const st = ch.state(); if (st.ready && !st.disposed && !st.failed) ch.post({ type: 'release' }); };

    function renderInternal(nowInput, isDarkOrOpts = {}, strengthArg, extraArg, forceStatic = false) {
      const st = ch.state();
      if (st.disposed || st.failed || pw <= 0 || ph <= 0 || isHostPaused(doc)) { if (isHostPaused(doc)) setPaused(true); return false; }
      if (forceStatic && nowInput && typeof nowInput === 'object') { extraArg = strengthArg; strengthArg = isDarkOrOpts; isDarkOrOpts = nowInput; nowInput = 0; }
      const isObj = typeof isDarkOrOpts === 'object' && isDarkOrOpts !== null;
      let still = forceStatic, dark = true, rawStrength = 1, extra = null;
      if (isObj) {
        still = forceStatic || Boolean(isDarkOrOpts.still || isDarkOrOpts.staticSnapshot);
        dark = isDarkOrOpts.dark !== false; rawStrength = isDarkOrOpts.strength ?? isDarkOrOpts.prismStrength ?? 1;
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
      if (ambient <= 0 || (forceStatic && strength <= 0)) { if (!clearedZero) clearCanvas(); else sleeping = true; return false; }
      const reach = extra?.reach !== undefined ? cl(extra.reach, 0.05, 1) : baseAura.reach;
      const prism = extra?.prism !== undefined ? cl(extra.prism, 0, 1) : baseAura.prism;
      const surge = extra?.surge !== undefined ? cl(extra.surge, -1, 1) : baseAura.surge;
      const speed = extra?.speed !== undefined ? cl(extra.speed, 0, 3) : baseAura.speed;
      const rawSpec = extra && (extra.spectrum !== undefined || extra.accent !== undefined) ? extra.spectrum ?? extra.accent : baseSpectrum;
      const specCode = resolveSpecCode(rawSpec, dark), rawSem = extra?.semantic !== undefined ? extra.semantic : baseSemantic, semCode = resolveSemCode(rawSem);
      activeAura.reach = reach; activeAura.prism = prism; activeAura.surge = surge; activeAura.speed = speed;
      activeSpectrum = rawSpec || (specCode === 1 ? 'warm' : 'default'); activeSemantic = String(rawSem || 'none');

      const nowMs = Number(nowInput || 0);
      if (startMs === null) startMs = nowMs;
      let dtSec = 0;
      if (forceStatic) { if (flowSec === 0) flowSec = 2.4; lastClockMs = nowMs; sleeping = true; }
      else if (still) { lastClockMs = nowMs; sleeping = true; }
      else {
        sleeping = paused = false;
        if (lastClockMs === null || nowMs < lastClockMs) lastClockMs = nowMs;
        else { dtSec = M.min(0.35, M.max(0, (nowMs - lastClockMs) / 1000)); lastClockMs = nowMs; flowSec += dtSec * speed; }
      }
      if (semCode > 0) holdSem = semCode;
      if (forceStatic || still) semMix = semCode > 0 ? 1 : 0;
      else { const tgt = semCode > 0 ? 1 : 0; semMix += (tgt - semMix) * M.min(1, M.max(0.04, dtSec / 0.45)); if (M.abs(tgt - semMix) < 0.01) semMix = tgt; }
      const effSem = holdSem > 0 && semMix > 0.005 ? holdSem + (1 - semMix) * 0.98 : 0;
      const breath = forceStatic ? 0.64 : still ? 0.58 : 0.46 + 0.24 * M.sin(flowSec * 1.15) + 0.06 * M.sin(flowSec * 2.05 + 0.9);
      const intensity = breath * (0.55 + 0.45 * strength), presence = strength <= 0 ? 0 : strength >= 0.999 ? 1 : M.pow(strength, 0.78);
      const hu = core?.computeHorizonUniforms ? core.computeHorizonUniforms(Boolean(dark), presence, prism, surge, speed, specCode, effSem) : null;
      const msg = { type: 'draw', dark: Boolean(dark), intensity, presence, reach, prism, surge, speed, spec: specCode, sem: effSem, hu, timeSec: 12 + flowSec, still: Boolean(still), anim: Boolean(!still && options.workerAutoLoop === true), continuous: Boolean(extra?.continuous), maxFps: getPerfProfile(doc).maxFps };
      if (st.ready) ch.post(msg); else pendingDraw = msg;
      clearedZero = stale = false;
      return true;
    }

    Object.assign(session, {
      isContextLost: () => { const s = ch.state(); return s.contextLost || s.failed; },
      isSleeping: () => sleeping || paused, getBufferSize: () => ({ width: pw, height: ph, dpr }),
      resize: syncSize, invalidate() { stale = true; }, clear: clearCanvas, releaseBackingStore, setPaused,
      setAuraParams(ex) {
        if (!ex || typeof ex !== 'object') { Object.assign(baseAura, defAura); baseSpectrum = null; baseSemantic = 'none'; baseAmbient = 1; }
        else {
          if (ex.reach !== undefined) baseAura.reach = cl(ex.reach, 0.05, 1);
          if (ex.prism !== undefined) baseAura.prism = cl(ex.prism, 0, 1);
          if (ex.surge !== undefined) baseAura.surge = cl(ex.surge, -1, 1);
          if (ex.speed !== undefined) baseAura.speed = cl(ex.speed, 0, 3);
          if (ex.spectrum !== undefined || ex.accent !== undefined) baseSpectrum = String(ex.spectrum ?? ex.accent);
          if (ex.semantic !== undefined) baseSemantic = String(ex.semantic);
          if (ex.ambientIntensity !== undefined) baseAmbient = cl(ex.ambientIntensity, 0, 1);
        }
        Object.assign(activeAura, baseAura); stale = true; return { ...activeAura };
      },
      getAuraParams: () => ({ ...activeAura }),
      getExtendedState: () => ({ ...activeAura, spectrum: activeSpectrum, semantic: activeSemantic, ambientIntensity: activeAmbient, sleeping }),
      draw: (n, d, s, e) => renderInternal(n, d, s, e, false),
      drawStaticSnapshot: (n, d, s, e) => { stale = true; return renderInternal(n, d, s, e, true); },
      getStats: () => ({ ...ch.state(), paused, sleeping }),
      dispose() { sleeping = paused = true; ch.dispose(); },
    });
    return ch.start(canvas, { type: 'init', mode: 'glow', vs: shaders.vs, fs: shaders.fs, pw, ph, dpr, idleTimeoutMs, maxFps: getPerfProfile(doc).maxFps }) ? session : null;
  }

  async function mountGlowWorkerWithProbe(canvas, options = {}) {
    const res = await probeWorkerWebGL2({ timeoutMs: options.probeTimeoutMs, force: options.forceProbe });
    if (!res || !res.ok) { totalFallbacks += 1; try { options.onFallback?.(res ? res.reason : 'probe-failed'); } catch {} return null; }
    return mountGlowWorker(canvas, options);
  }

  function mountManagedGlow(cfg = {}) {
    const { getCanvas, swapCanvas, rippleCore, doc, prefer2D, allowWorker = true, onContextLost, onFallbackDone, onUpgradeReady } = cfg;
    const hasG = Boolean(rippleCore?.mountBrandHorizonGlow), cv0 = typeof getCanvas === 'function' ? getCanvas() : null;
    const noopGlow = { mode: 'none', resize() {}, clear() {}, draw() {}, drawStaticSnapshot() {}, dispose() {} };
    if (!cv0 || !hasG) return noopGlow;
    managedGlowDepth += 1;
    try {
      if (!prefer2D && allowWorker) {
        let inSync = true, syncFb = false, syncRet = null;
        const prevNested = lastNestedGlow; lastNestedGlow = null;
        const w = mountGlowWorker(cv0, {
          rippleCore, doc, width: 0, height: 0, probeTimeoutMs: cfg.probeTimeoutMs, probeRetryDelayMs: cfg.probeRetryDelayMs, initTimeoutMs: cfg.initTimeoutMs, onContextLost,
          onFallback: (reason) => { if (inSync && typeof onFallbackDone === 'function') syncFb = true; try { syncRet = onFallbackDone?.(reason); } catch {} },
          onProbeReady: (res) => { try { onUpgradeReady?.(res); } catch {} },
        });
        inSync = false;
        const inner = lastNestedGlow; lastNestedGlow = prevNested;
        if (w) return w;
        if (syncFb) {
          const resolved = inner || (syncRet && typeof syncRet === 'object' ? syncRet : noopGlow);
          if (managedGlowDepth > 1) lastNestedGlow = resolved;
          return resolved;
        }
      }
      const mk = (u) => rippleCore.mountBrandHorizonGlow(getCanvas(), { prefer2D: !!u, width: 0, height: 0, onContextLost });
      let g = mk(prefer2D);
      if (g && g.mode === 'none' && !prefer2D && typeof swapCanvas === 'function') { try { g.dispose?.(true); } catch {} swapCanvas(); g = mk(true); }
      if (managedGlowDepth > 1) lastNestedGlow = g;
      return g;
    } finally { managedGlowDepth -= 1; }
  }

  function mountFieldWorker(canvas, cols, rows, waves, options = {}) {
    if (!canvas || typeof canvas.transferControlToOffscreen !== 'function' || cols <= 0 || rows <= 0) return null;
    if (options.prefer2D || options.force2D || (G && G.__agRippleForce2D === true)) return null;
    const core = options.rippleCore || (G && G.__agCsRippleCore) || null;
    if (!core?.VERTEX_SHADER || !core?.FRAGMENT_SHADER || typeof core.createGlyphField !== 'function' || !checkWorkerProbe(options)) return null;
    const R = core.RIPPLE;
    let cN = cols, rN = rows, dpr = cl(options.dpr || 1, 0.5, 2), pw = M.round(cN * R.cellWidth * dpr), ph = M.round(rN * R.cellHeight * dpr);
    let data = new Uint8Array(cN * rN * 4), pendResize = null, pendDraw = null;
    const extRen = { mode: 'worker-webgl2', gpuIdleMod: true, data };
    const ch = createWorkerChannel(extRen, options, {
      onReady: () => {
        if (pendResize) { ch.post(pendResize); pendResize = null; }
        if (pendDraw) { const b = pendDraw.cellsBuf; ch.post(pendDraw, b ? [b] : undefined); pendDraw = null; }
      },
    });
    Object.assign(extRen, {
      isContextLost: () => { const s = ch.state(); return s.contextLost || s.failed; },
      getBufferSize: () => ({ width: pw, height: ph, dpr }),
      releaseBackingStore() { pw = ph = 0; pendResize = pendDraw = null; if (ch.state().ready) ch.post({ type: 'release' }); },
      resize(nc, nr, nd) {
        const s = ch.state();
        if (s.disposed || s.failed || nc <= 0 || nr <= 0) return false;
        cN = nc; rN = nr; if (nd > 0) dpr = cl(nd, 0.5, 2);
        pw = M.round(cN * R.cellWidth * dpr); ph = M.round(rN * R.cellHeight * dpr);
        data = new Uint8Array(cN * rN * 4); extRen.data = data;
        const msg = { type: 'resize', cols: cN, rows: rN, pw, ph, dpr };
        if (s.ready) ch.post(msg); else pendResize = msg;
        return true;
      },
      draw(pal, d, upload) {
        const s = ch.state();
        if (s.disposed || s.failed || pw <= 0 || ph <= 0) return;
        const rd = d > 0 ? d : dpr, amb = cl(pal.ambientIntensity ?? 1, 0, 1), sc = Number(pal.spectrumCode ?? 0);
        const st = core.getGlyphSpectrumStops ? core.getGlyphSpectrumStops(pal.dark, sc) : [[66, 133, 244], [155, 114, 203], [234, 67, 53], [251, 188, 4]];
        const au = pal.aura?.active ? pal.aura : null, neb = pal.nebula, nL = pal.nebulaLiftScale ?? 1;
        const mkN = (b) => (b ? [b.x * rd, b.y * rd, b.radius * rd, b.strength * amb] : [0, 0, 1, 0]);
        const n255 = (c) => [c[0] / 255, c[1] / 255, c[2] / 255];
        const params = {
          font: pal.fontFamily || 'monospace', dpr: rd, lightMode: pal.dark === false ? 1 : 0, ink: n255(pal.ink), wave: n255(pal.wave),
          aura: au ? [au.x * rd, au.y * rd, M.max(1, au.radius || 230) * rd, cl(au.strength ?? 1, 0, 1) * amb] : [0, 0, 230 * rd, 0],
          optics: [R.auraTint * (sc === 5 ? 0.55 : 1), R.prismTint * (sc === 5 ? 0.45 : 1), R.prismCap, pal.prismStrength],
          auraLift: R.auraLift * amb * (pal.auraLiftScale ?? 1), auraPhase: pal.auraPhase || 0,
          sp0: n255(st[0]), sp1: n255(st[1]), sp2: n255(st[2]), sp3: n255(st[3]),
          idle: [pal.cloudDriftPx || 0, pal.breathSinW || 0, pal.breathCosW ?? 1, 1],
          n0: mkN(neb?.[0]), n1: mkN(neb?.[1]), n2: mkN(neb?.[2]),
          nOpt: [neb?.[0]?.hue || 0, neb?.[1]?.hue || 0, neb?.[2]?.hue || 0, R.nebulaTint * amb * (sc === 5 ? 0.45 : 1) * (0.35 + 0.65 * nL)],
          nLift: R.nebulaLift * amb * nL,
        };
        const buf = upload !== false ? data.slice().buffer : null, msg = { type: 'draw', params, cellsBuf: buf };
        if (s.ready) ch.post(msg, buf ? [buf] : undefined); else pendDraw = msg;
      },
      dispose() { ch.dispose(); },
    });
    if (!ch.start(canvas, { type: 'init', mode: 'field', vs: core.VERTEX_SHADER, fs: core.FRAGMENT_SHADER, cols: cN, rows: rN, pw, ph, dpr, cellW: R.cellWidth, cellH: R.cellHeight, fontSize: R.fontSize, glyphs: core.GLYPHS, cloudScale: R.cloudScale, breathScale: R.breathScale })) return null;
    return core.createGlyphField(canvas, cN, rN, waves, { externalRenderer: extRen, calmZones: options.calmZones, onContextLost: options.onContextLost });
  }

  function mountManagedField(cfg = {}) {
    const { getCanvas, swapCanvas, cols, rows, dpr, waves, rippleCore, prefer2D, allowWorker = true, onContextLost, onFallbackDone, onUpgradeReady } = cfg;
    const cv0 = typeof getCanvas === 'function' ? getCanvas() : null;
    if (!cv0 || !rippleCore?.createGlyphField || cols <= 0 || rows <= 0) return rippleCore?.createGlyphField ? rippleCore.createGlyphField(cv0, cols, rows, waves, { prefer2D: !!prefer2D, onContextLost }) : { mode: 'none', dispose() {}, invalidate() {}, draw() {}, needsDraw: () => false, busy: () => false };
    if (!prefer2D && allowWorker) {
      let syncFb = false, syncRet = null;
      const w = mountFieldWorker(cv0, cols, rows, waves, { rippleCore, dpr, onContextLost, onFallback: (r) => { syncFb = true; try { syncRet = onFallbackDone?.(r); } catch {} }, onProbeReady: (r) => { try { onUpgradeReady?.(r); } catch {} } });
      if (w) return w;
      if (syncFb && syncRet && typeof syncRet === 'object') return syncRet;
    }
    const mk = (u) => rippleCore.createGlyphField(getCanvas(), cols, rows, waves, { prefer2D: !!u, onContextLost });
    let f = mk(prefer2D);
    if (f && f.mode === 'none' && !prefer2D && typeof swapCanvas === 'function') { try { f.dispose?.(true); } catch {} swapCanvas(); f = mk(true); }
    return f;
  }

  function disposeAll() {
    clearProbeRetry();
    for (const s of [...activeSessions]) { try { s.dispose(); } catch {} }
    activeSessions.clear();
    if (activeProbeWorker) { try { activeProbeWorker.terminate(); } catch {} activeProbeWorker = null; }
    if (activeProbeUrl) { safeRevokeUrl(activeProbeUrl); activeProbeUrl = ''; }
    probePending = null;
  }
  const getActiveWorkerCount = () => activeSessions.size + (activeProbeWorker ? 1 : 0);
  const getStats = () => ({ perfMode: getPerfMode(), probe: getProbeStatus(), activeWorkers: getActiveWorkerCount(), totalFallbacks });
  return {
    PROBE_TIMEOUT_MS, INIT_TIMEOUT_MS, PROBE_RETRY_DELAY_MS, IDLE_SLEEP_MS, PERF_PROFILES, PROBE_WORKER_SRC, RENDER_WORKER_SRC,
    getPerfMode, getPerfProfile, getPerfMinGapMs, resolveRippleDpr, resolveGlowDpr, isHostPaused, probeWorkerWebGL2, warmProbe, getProbeStatus, resetProbeCache,
    mountGlowWorker, mountGlowWorkerWithProbe, mountManagedGlow, mountFieldWorker, mountManagedField, disposeAll, getActiveWorkerCount, getStats,
  };
});
