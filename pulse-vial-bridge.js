(function(r,f){if(typeof module==='object'&&module.exports)module.exports=f(r);else r.__agCsPulseVialBridge=f(r);})(typeof globalThis!=='undefined'?globalThis:window,function(G){
'use strict';
const D='data-',SK='agCs.pulseVialMode.v1',BK='__agCsPulseBridgeInst',HID='ag-pulse-status-bar',P=D+'ag-pulse-',SA=D+'ag-cs-pulse-style',IA=D+'ag-cs-pulse-injected',AC=P+'vial-mode',AH=D+'pv-mode',AM=D+'pv-motion',AL=D+'pv-light',AP=D+'pv-preset',AR=D+'pv-crit',MO=D+'ag-cs-motion',LP=D+'ag-cs-light-preset',TL=D+'ag-cs-telemetry',C='#context-card['+AC,M=':host(['+AH;
const GUID=/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i,LRE=/(?:^|\s)(?:theme-light|light-theme|light)(?:\s|$)/;
const PV='foreground:--f,chip:--ch,muted:--mu,subtle:--mu,label:--lb,hover:--hv,hover-text:--f,accent:--ac,emphasis:--em,border:--b,separator:--d,track:--t,control:--ct,control-text:--ch,menu:--mn,selected:--sl,ring:--ac,ring-track:--rt'.replace(/([a-z-]+):([-\w]+)/g,'--pulse-$1:var($2)!;');
const MD=('Sbox-shadow:inset 0 1px 0 var(--sp)|Bborder:1px solid var(--b)|Rborder-radius:|Fdisplay:flex;|Aalign-items:center|Gbackground:var(|Ybackground:|Qbox-shadow:|Xposition:|Zfont-size:|Wfont-weight:|Ppointer-events:none|Ooverflow:hidden|Llinear-gradient(|H:host(:not(.icons-only))|K.bar .chip|N:not([hidden])|T.language-options|E'+C+']|UtranslateX(var(--pv-cx,0px))|V:host(['+AM+'="|z:host(['+AL+'="1"]|5['+AP+'="alabaster"])|oopacity:|hheight:|wwidth:|mmin-width:|dpadding:|ccolor:var(--|ttransition:|xtransform:|ffilter:|ydisplay:|p:host([data-pv-|iinset 0 1px |vvar(--|acalc(100vw - 24px)|eease-in|gease-out|jscale(0.95);filter:blur(4px)|kscale(1);filter:blur(0)|qallow-discrete|rflex-direction:column|sfont-variant-numeric:tabular-nums|urgba(255,255,255,.|lrgba(37,99,235,.|4rgba(30,41,59,.|7rgba(15,23,42,.|8rgba(42,32,20,.|90 2px 6px |0,0 0 0 1px |1#3186ff|2#5cc6fc|3#f59e0b').split('|').reduce((a,s)=>(a[s[0]]=s.slice(1),a),{});
const CSS=(`:host{--ez:cubic-bezier(.22,1,.36,1);--ls:cubic-bezier(.22,1.22,.36,1);--ui:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;--bf:blur(22px) saturate(145%);--c:$L160deg,#11131af2,#0b0c11fa);--b:#ffffff16;--sp:#ffffff1a;--s:0 18px 44px #0009;--f:#eef1f7;--t:#ffffff11;--d:$u06);--ch:#dae2f0db;--mu:#94a0b6b8;--lb:#b0baccd1;--hv:#ffffff12;--ct:#ffffff0d;--ac:$1;--em:$2;--g0:#1b49b2;--wn:$3;--mn:#0e1016f8;--sl:$129;--rt:#94a3b838;${PV}}@supports(animation-timing-function:linear(0,1)){:host{--ls:linear(0,.38,.82,1.01,1.028,1.008,1)}}$z){--bf:none;--c:#FFFFFF;--b:$7135);--sp:#fff;--s:$9$707),0 14px 34px -6px rgba(30,58,138,.14)$0$706);--f:#0f172a;--t:$7085);--d:$71);--ch:#1e293b;--mu:#475569;--lb:#334155;--hv:$l08);--ct:#f4f7fb;--ac:#2563eb;--em:#0284c7;--g0:#1d4ed8;--wn:#ea580c;--mn:#FFFFFF;--sl:$l12);--rt:$422)}$z$5{--c:#FFFFFF;--b:$814);--s:$9$807),0 14px 32px -6px rgba(68,52,32,.14)$0$806);--f:#1c1917;--t:$8085);--d:$81);--ch:#292524;--mu:#57534e;--lb:#44403c;--ct:#f6f4ee;--rt:$822)}:host,.bar,.card,.pv-hd,.pv-tl,.pv-ft{font-family:$vui);$s}.pv-cb,.pv-cb>i,.pv-btn,.track,.track>i,$T,$T .language-button,.pv-trk,.pv-seg{$R999px}.bar{gap:2px;$A}$K{$Ytransparent!;border:0!;$Qnone!;$h24px;$d0 5px;$R5px;line-$h16px;$Z11px;$cch);gap:3.5px;overflow:visible!;$s;$tbackground .15s,color .15s}$K:is(:hover,[aria-expanded="true"]){$Y$u05)!;$cf)}$z) $K:is(:hover,[aria-expanded="true"]){$Y$705)!}$K strong{$W600}$K .dim{$cmu);$o.66;$Z9.5px}$K [data-i18n="cache"]{$o.62}$K[data-card="speed"]>span:last-child{$o.66;$Z10px}$H :is(.chip[data-card="speed"]>:is(svg,.rounds),.chip[data-card="cache"]>:is(svg,.cache-total,.dim),.chip[data-card="context"]>.context-label),${M}="bar"]) #context-ring,$E #context-track,${C}="bar"]>.pv-rail,.pv-bw[hidden]{$ynone!}$H $K$N~.chip$N{$Xrelative;margin-left:6px}$H $K$N~.chip$N::before{content:"·";$Xabsolute;left:-4px;top:50%;$xtranslate(-50%,-50%);$cmu);$o.32;$P}:host(.narrow) .bar{gap:1px}:host(.narrow) $K{$d0 4px;$Z10px}:host(.icons-only) .bar{gap:3px}:host(.icons-only) $K{$w22px;$m22px;$h22px;$d0;justify-content:center;$O!}${M}]) #context-ring{$Yconic-gradient($vpv-tint,$1) $vused-angle,0deg),$vrt) 0)}.pv-cb{$ynone;$w18px;$h5px;$O;$G--t);$Q$i1.5px #0006;$P;flex:none}${M}="bar"]) .pv-cb,${M}="bar"].icons-only) .chip>.pv-cb{$yinline-flex!}.pv-cb>i{$yblock;$h100%;$w$vpv-pct,0%);$m1.5px;$Y$L90deg,$vg0),$vpv-tint,$1))}$pcrit="1"]) #context-percent,.pv-hd strong[data-warn="1"]{$cwn)}.card,$E,.group-menu,.language-guide{$G--c)!;backdrop-$f$vbf);$B!;$S,$vs)!;$cf)}.card,$E{$R10px!}@keyframes pv-in{0%{$o0;$x$U $j}100%{$o1;$x$U $k}}@keyframes pv-sub{0%{$o0}100%{$o1}}$E{transform-origin:calc(100% - 28px) 0%;$x$U;$twidth .2s $vez),padding-left .2s $vez),opacity .14s $e,transform .14s $e,filter .14s $e,display .14s $q}$E$N{animation:pv-in .22s $vls) backwards}$E[hidden]{$o0;$x$U $j}$Vsubtle"]) $E{$fnone;$x$U;$topacity 120ms $g,display 120ms $q}$Vsubtle"]) $E$N{animation:pv-sub 120ms $g backwards}$Vsubtle"]) $E[hidden]{$o0;$x$U;$fnone}$Voff"]) $E,$Voff"]) .pv-seg,$Voff"]) $K{animation:none!;transition-duration:0ms!;$fnone!}${C}="vial"]{$wmin(408px,$a)!;$d13px 14px 12px 124px!;min-$h290px}${C}="bar"]{$wmin(316px,$a)!;$d13px 14px 12px!}$E>.heading:first-of-type{cursor:grab;user-select:none;gap:8px}$E>.heading:first-of-type[data-dragging="1"]{cursor:grabbing}.pv-btn{$h20px;$d0 8px 0 6.5px;gap:5px;$B;$G--ct);$S;$cf);$o.9;font:500 10px/1 $vui);$yinline-flex;$A;cursor:pointer;white-space:nowrap}.pv-btn::before{content:"";$w5px;$h5px;$R50%;$G--em);$Q0 0 6px $2b8;flex:none}.pv-btn[data-mode="bar"]::before{$G--ac);$Q0 0 5px $199}.pv-btn:hover,.pv-btn[data-mode="bar"]{$o1;border-color:$252;$Y$11f}.track{$h4.5px;$G--t);$Q$i1.5px #0005,inset 0 0 0 .5px $vb)}.track>i{$Y$L90deg,$vg0),$vac) 58%,$vem))!}.group-trigger,select{$R6px;$B;$G--ct);$S;$d3px 7px}.group-trigger:hover,select:hover{border-color:$247;$G--hv)}.group-menu,.language-guide{$R8px!}.group-menu button{$R5px;$Z11px}.card-language{border-top:1px solid $vd);$d8px 0 0;margin-top:10px}$T{$d2px;$G--t);$B}$T .language-button{$d2px 7px;$Z10px}$T .language-button[aria-pressed=true]{$Y$12e;$cf);$S}.pv-rail{$Xabsolute;left:10px;top:12px;bottom:12px;$w104px;$d0 8px 0 0;border-right:1px solid $vd);$F$A}.pv-well{$w100%;$d2px 0;$Y0 0;border:0;$Qnone;$F$r;$A;gap:3px}$z) .pv-well{$Y#EEF3FA;border:1px solid rgba(30,64,175,.11);$R8px;$d4px 2px;$Q$i2px $705)}$z$5 .pv-well{$Y#F2EFE7;border-color:rgba(68,52,32,.13)}.pv-hd,.pv-tl,.pv-ft{$Z10px;$W500;line-$h1.2}.pv-hd,.pv-tl{$w100%;$Falign-items:baseline;justify-content:space-between}.pv-hd{$d0 5px}.pv-hd span{$Z9px;$W600;letter-spacing:.06em;$o.52}.pv-hd strong{$Z11px;$W600}.pv-slot,.pv-cv{$w96px;$h220px;$yblock}.pv-cv{cursor:pointer}.pv-ft{$Z9.5px;$o.64}$z) :is(.pv-hd span,.pv-ft){color:$462);$o1}.pv-bw{$F$r;gap:5px;margin:6px 0 10px}.pv-trk{$Xrelative;$h6.5px;$d1px;$Fgap:1.5px;$O;$G--t);$Q$i2px #0006,inset 0 0 0 .5px $vb)}.pv-bw[data-warn="1"] .pv-trk{$Qinset 0 0 0 .85px $38f}.pv-seg{$h100%;$Y$L#fff4,transparent 78%) $vsc,$1);$twidth .22s $vez)}.pv-seg[data-active="1"]{min-$w2.5px}.pv-th{$Xabsolute;left:85%;top:1px;bottom:1px;$w1px;$Y$38c;$P}.pv-tl{$o.78;gap:6px}$z) .pv-tl{$o.92}`).replace(/\$([A-Za-z0-9])|!/g,(m,k)=>m==='!'?'!important':MD[k]);
const clp=(v,a,b)=>Math.max(a,Math.min(b,v)),safe=f=>{try{return f();}catch{}},ok=(n,lo=0)=>typeof n==='number'&&Number.isFinite(n)&&n>=lo,tokS=n=>!ok(n)?'—':n>=1e6?`${(n/1e6).toFixed(1).replace(/\.0$/,'')}M`:n>=1e3?`${(n/1e3).toFixed(1).replace(/\.0$/,'')}k`:''+Math.round(n),fmtS=s=>ok(s)?`${s.toFixed(s<10?2:1)}s`:'—',fmtR=r=>ok(r,1e-6)?`${r.toFixed(1)} tok/s`:'—',camp=m=>/claude|anthropic/i.test(m||'')?'claude':'gemini';
function calcR(uf,mx,sp){const t=clp(+uf||0,0,1);if(!t)return[0,0,0];const s=Math.min(t*.34,clp(14e3/(mx>0?mx:512e3),.02,.12)),r=Math.max(0,t-s),ms=+sp?.modelSeconds||0,ts=+sp?.toolSeconds||0,l=r*(ms+ts>.05?clp(ts/(ms+ts),.16,.42):.24);return[s,Math.max(0,r-l),l];}
function h(d,t,a,k){const e=d.createElement(t);if(a)for(const p in a)if(a[p]!=null){if(p==='text')e.textContent=''+a[p];else if(p==='cls')e.className=''+a[p];else e.setAttribute(p,''+a[p]);}if(k)for(const c of k)if(c)e.appendChild(c);return e;}
const sa=(e,m)=>{if(e)for(const k in m){const v=''+m[k];ga(e,k)!==v&&e.setAttribute(k,v);}},ra=(e,...ks)=>{if(e)for(const k of ks)e.removeAttribute(k);},ga=(e,k)=>e?.getAttribute?.(k),sp=(e,k,v)=>{e&&e.style.getPropertyValue(k)!==v&&e.style.setProperty(k,v);},rp=(e,...ks)=>{if(e)for(const k of ks)e.style.removeProperty(k);},tx=(e,v)=>v===void 0?e?.textContent:(e&&e.textContent!==v&&(e.textContent=v)),qs=(e,s)=>e?.querySelector?.(s),gi=(e,i)=>e?.getElementById?e.getElementById(i):qs(e,'#'+i),lbl=v=>v?'实体试管':'极简长条',cln=r=>{if(r)for(const e of r.querySelectorAll(`[${SA}="1"],[${IA}="1"],.pv-btn,.pv-rail,.pv-bw,.pv-cb`))e.remove();};
let i0=null;
function mountPulseVialBridge(o={}){
const W=o.win||G;if(!o.allowMultiple){if(i0){void i0.sync();return i0;}[W,G].map(x=>safe(()=>x?.[BK]?.destroy?.()));}
const doc=o.doc||W.document,de=()=>doc?.documentElement,ms=Math.max(250,+o.pollIntervalMs||1500),iMs=Math.max(ms,3e3),rAF=W.requestAnimationFrame?.bind(W),H=(t,a,k)=>h(doc,t,a,k),v0=safe(()=>(o.storage||W.localStorage)?.getItem(SK));
const gM=()=>{if(safe(()=>W.matchMedia?.('(prefers-reduced-motion:reduce)')?.matches))return'off';const m=ga(de(),MO);return m==='off'||m==='subtle'||m==='standard'?m:'ultra';};
const gP=()=>ga(de(),LP)==='alabaster'?'alabaster':'crystal',tOff=()=>ga(de(),TL)==='off',vOk=()=>!!safe(()=>vl?.isSettled?.());
let md=v0==='bar'||v0==='vial'?v0:o.defaultMode==='bar'?'bar':'vial',dd=!1,pd=null,rf=0,t0=0,tm=null,cMs=0,aT=0,ho=null,sr=null,cd=null,hd=null,bt=null,pE=null,rE=null,sl=null,bw=null,tL=null,tR=null,sg=[],ob=null,o1=[],o2=[],vl=null;
const st={d:!0,p:'crystal',c:'gemini',cr:!1,sr:!1,f:0,u:null,mx:512e3,m:'',t:null,l:null,tf:null,at:null,rt:[0,0,0],g:''};
const op=()=>!!(cd&&!cd.hidden),bI=i=>gi(sr,i),on=(e,v,f,c,a=o1)=>{if(e?.addEventListener){e.addEventListener(v,f,c);a.push(()=>e.removeEventListener(v,f,c));}},xR=()=>{if(rf)safe(()=>W.cancelAnimationFrame?.(rf));rf=t0=0;},xP=()=>{if(tm!==null){clearTimeout(tm);tm=null;}cMs=0;};
const yH=()=>{if(ho)sa(ho,{[AH]:md,[AM]:gM(),[AL]:st.d?0:1,[AP]:gP()});};
const kR=n=>{rf=0;if(dd||md!=='vial'||!vl||!op()||doc?.hidden||tOff()){t0=0;return;}const dt=t0>0?clp((n-t0)/1e3,.004,.05):.016;t0=n;safe(()=>vl.step(dt));if(rAF&&!vOk())rf=rAF(kR);else t0=0;};
const yR=w=>{if(dd||md!=='vial'||!vl||!op()||doc?.hidden||tOff()){xR();return;}if(w)safe(()=>vl.wake?.());if(!rf&&rAF&&(w||!vOk()))rf=rAF(kR);};
const sP=()=>{xP();if(dd||o.autoPoll===!1||doc?.hidden||tOff())return;cMs=op()||st.sr||Date.now()-aT<4e3?ms:iMs;tm=setTimeout(async()=>{tm=null;if(!dd&&!doc?.hidden&&!tOff())await sync();sP();},cMs);tm?.unref?.();};
const dV=()=>{xR();if(vl){safe(()=>vl.dispose());vl=null;}if(sl)while(sl.firstChild)sl.removeChild(sl.firstChild);};
const mV=()=>{
if(dd||md!=='vial'||!sl){dV();return;}if(vl&&qs(sl,'canvas['+D+'vial-canvas="true"]')){yR(0);return;}
dV();const cv=H('canvas',{cls:'pv-cv',[D+'vial-canvas']:'true',width:96,height:220});sl.appendChild(cv);
const cr=o.vialCore||W.__agVialCore||G.__agVialCore;
if(cr?.mountPhysicalWaterVial)vl=cr.mountPhysicalWaterVial(cv,{fill:clp(st.f||.08,.06,.95),isDark:st.d,streaming:st.sr,reduceMotion:gM()==='off',onWake:()=>yR(0),getState:()=>({isDark:st.d,lightPreset:st.p,camp:st.c,critical:st.cr,fill:clp(st.f||.06,.06,.95),maxTokens:st.mx,hoveredSlice:-1,streaming:st.sr,ratios:st.rt})});
yR(0);
};
const cX=()=>{
if(!cd||cd.hidden){if(cd?.style.getPropertyValue('--pv-cx'))rp(cd,'--pv-cx');return;}
safe(()=>{const vw=+W.innerWidth||0,lx=parseFloat(cd.style.left);if(vw>0&&Number.isFinite(lx)){const tw=Math.min(md==='vial'?408:316,vw-24),v=`${Math.round(lx+tw>vw-12?vw-12-lx-tw:lx<12?12-lx:0)}px`;if(cd.style.getPropertyValue('--pv-cx')!==v)sp(cd,'--pv-cx',v);}});
};
const pt=()=>{
if(dd||!ho||!sr||!cd)return;
st.d=safe(()=>{const a=ga(ho,D+'pulse-theme')||(ho.style?.getPropertyValue?.('--pulse-scheme')||'').trim();return a==='light'?!1:a==='dark'?!0:!LRE.test((ga(doc?.body,'class')||'')+' '+(ga(de(),'class')||''));})??!0;
st.p=gP();const pc=Math.round(clp(st.f,0,9.99)*100),w=st.cr?'1':'0',rt=st.l??st.t,vb=md==='vial';
sa(ho,{[AH]:md,[AM]:gM(),[AL]:st.d?0:1,[AP]:st.p,[AR]:w});sp(ho,'--pv-tint',st.cr?(st.d?'#f59e0b':'#ea580c'):st.d?'#3186ff':'#2563eb');sp(ho,'--pv-pct',`${clp(st.f*100,0,100).toFixed(1)}%`);
sa(cd,{[AC]:md,[P+'card-width']:vb?408:316});if(bt){tx(bt,lbl(vb));sa(bt,{[D+'mode']:md,'aria-pressed':vb});}
tx(pE,`${pc}%`);sa(pE,{[D+'warn']:w});tx(rE,fmtR(rt));if(bw){bw.hidden=vb;sa(bw,{[D+'warn']:w,[D+'camp']:st.c});}
const cs=st.cr?(st.d?['#c75714','#f59e0b','#ffdb47']:['#7c3aed','#ea580c','#f59e0b']):(st.d?['#1b49b2','#3186ff','#5cc6fc']:['#1d4ed8','#2563eb','#0284c7']);
for(let i=0;i<3;i++)if(sg[i]){const r=st.rt[i]||0;sg[i].style.width=`${(r*100).toFixed(2)}%`;sp(sg[i],'--sc',cs[i]);sa(sg[i],{[D+'active']:r>.002?1:0});}
tx(tL,`TTFT ${fmtS(st.tf)} · TPS ${fmtR(rt)}`);tx(tR,`${st.u!==null?tokS(st.u):`${pc}%`} / ${tokS(st.mx||512e3)}`);
mV();if(op()&&vl&&!rf&&!vOk())safe(()=>vl.step(.016));yR(0);cX();
};
const ig=pl=>{
const s0=pl?.speed||null,cx=s0?.context||null,re=/(\d+(?:\.\d+)?)\s*%/,pm=(tx(bI('context-percent'))||'').match(re)||(bI('context-fill')?.style?.width||'').match(re),m1=cx?.model,m2=tx(bI('context-model'))?.trim(),mb=qs(doc,'['+D+'testid="model-selector-trigger"]'),nm=i=>{const m=(tx(bI(i))||'').match(/(\d+(?:\.\d+)?)/);return m?+m[1]:null;};
const hF=ok(cx?.usedFraction),uf=hF?cx.usedFraction:pm?+pm[1]/100:st.f,ml=(m1&&m1!=='—'?m1:'')||s0?.model||(m2&&m2!=='—'?m2:'')||ga(mb,'aria-label')||tx(mb)?.trim()||st.m||'',mx=cx?.maxTokens>0?cx.maxTokens:512e3,u=ok(cx?.usedTokens)?cx.usedTokens:hF?Math.round(uf*mx):null,t=ok(s0?.tps)?s0.tps:nm('tps'),l=ok(s0?.latestTps)?s0.latestTps:(nm('latest-rate')??t),tf=ok(s0?.ttftSeconds)?s0.ttftSeconds:nm('ttft');
const at=cx?.sampledAt||s0?.savedAt||null, g0=`${at||''}|${u??''}|${s0?.rounds??''}|${uf.toFixed(4)}`,cg=!!(st.g&&st.g!==g0),wC=st.cr;st.g=g0;if(cg)aT=Date.now();
const ts=at?(typeof at==='number'?at:Date.parse(at)):NaN,rc=Number.isFinite(ts)&&Math.abs(Date.now()-ts)<=12e3,sp0=['stop','cancel','input-cancel'].some(k=>qs(doc,`[${D}testid="${k}-button"]`));
Object.assign(st,{f:uf,u,mx,m:ml,c:camp(ml),cr:uf>=.85,t,l,tf,at,sr:!!((l>0&&(rc||cg))||sp0),rt:calcR(uf,mx,s0)});
pt();if(vl){if(st.sr&&cg){safe(()=>vl.impulse(.22));yR(0);}else if(!wC&&st.cr){safe(()=>vl.impulse(.85));yR(0);}else if(cg)yR(1);}
};
const dt=()=>{
dV();if(ob){ob.disconnect();ob=null;}while(o1.length)safe(o1.pop());cln(sr);
ra(hd,D+'dragging');ra(cd,AC,P+'card-width');rp(cd,'--pv-cx');ra(ho,AH,AM,AL,AP,AR);rp(ho,'--pv-tint','--pv-pct');
ho=sr=cd=hd=bt=pE=rE=sl=bw=tL=tR=null;sg=[];
};
const at=()=>{
if(dd||!doc)return!1;const f0=gi(doc,HID);if(!f0?.shadowRoot){if(ho)dt();return!1;}
if(f0===ho&&sr===f0.shadowRoot&&cd?.isConnected!==!1)return!0;
dt();const rt=f0.shadowRoot,c=gi(rt,'context-card');if(!c)return!1;
cln(rt);ho=f0;sr=rt;cd=c;hd=qs(c,'.heading');rt.appendChild(H('style',{[SA]:1,text:CSS}));
on(c,'pointerenter',()=>{if(vl&&op()){safe(()=>vl.impulse(.08));yR(1);}});
const cp=qs(rt,'['+D+'card="context"]');
if(cp){cp.insertBefore(H('span',{cls:'pv-cb',[P+'chip-minibar']:1,[IA]:1,'aria-hidden':'true'},[H('i')]),bI('context-ring')?.nextSibling||cp.firstChild);const eg=()=>{aT=Date.now();void sync();};['pointerenter','click'].map(k=>on(cp,k,eg));}
if(hd){
bt=H('button',{type:'button',cls:'pv-btn',[P+'vial-toggle']:1,[IA]:1,[D+'mode']:md,'aria-pressed':md==='vial',text:lbl(md==='vial')});
on(bt,'click',e=>{e.preventDefault();e.stopPropagation();setV(md!=='vial');});hd.appendChild(bt);
let dg=!1,lx=0;
on(hd,'pointerdown',e=>{if(md==='vial'&&!e.target?.closest?.('button,a,select,input')){dg=!0;lx=+e.clientX||0;sa(hd,{[D+'dragging']:1});yR(1);}});
on(W,'pointermove',e=>{if(!dg)return;const cx=+e.clientX||0,dx=cx-lx;lx=cx;if(Math.abs(dx)>=1&&vl){vl.impulse(clp(dx*.16,-3.2,3.2));if(!rf)safe(()=>vl.step(.016));yR(0);}},!0);
const up=()=>{if(dg){dg=!1;ra(hd,D+'dragging');}};['pointerup','pointercancel'].map(k=>on(W,k,up,!0));
}
pE=H('strong',{[P+'vial-pct']:1,text:'0%'});sl=H('div',{cls:'pv-slot'});rE=H('div',{cls:'pv-ft',[P+'vial-rate']:1,text:'—'});
c.insertBefore(H('aside',{cls:'pv-rail',[P+'vial-rail']:1,[IA]:1},[H('div',{cls:'pv-well'},[H('div',{cls:'pv-hd'},[H('span',{text:'CTX'}),pE]),sl,rE])]),c.firstChild);
sg=[0,1,2].map(i=>H('span',{cls:'pv-seg',[D+'layer-slice']:i}));tL=H('span',{[P+'telemetry']:1,text:'TTFT — · TPS —'});tR=H('span',{[P+'capacity']:1,text:'— / 512k'});
bw=H('div',{cls:'pv-bw',[P+'minibar']:1,[IA]:1},[H('div',{cls:'pv-trk'},[...sg,H('i',{cls:'pv-th',[P+'threshold']:85,'aria-hidden':'true'})]),H('div',{cls:'pv-tl'},[tL,tR])]);
const tr=bI('context-track');if(tr?.parentNode===c)c.insertBefore(bw,tr.nextSibling);else c.appendChild(bw);
if(W.MutationObserver){let ws=op(),wO=tOff();ob=new W.MutationObserver(()=>{if(tOff()){xR();xP();wO=!0;return;}pt();const nw=op();if((nw&&!ws)||wO){aT=Date.now();yR(1);void sync();}else yR(0);ws=nw;wO=!1;sP();});ob.observe(c,{attributes:!0,attributeFilter:['hidden','style']});de()&&safe(()=>ob.observe(de(),{attributes:!0,attributeFilter:[MO,LP,TL,'class']}));doc.body&&safe(()=>ob.observe(doc.body,{attributes:!0,attributeFilter:['class']}));}
pt();return!0;
};
async function sync(){
if(dd||tOff()){xR();xP();return dbg();}if(!at())return dbg();if(pd)return pd;const ah=W.agPulseHost;if(!ah?.getMetrics){ig(null);return dbg();}
const cid=safe(()=>{const id=ga(ho?.closest?.('['+D+'cascade-id]'),D+'cascade-id');return id&&GUID.test(id)?id:W.location?.pathname?.match?.(/\/c\/([\da-f-]{36})/i)?.[1]||null;})||null;
return(pd=(async()=>{let r=null;try{try{r=await ah.getMetrics({conversationId:cid,force:!1});}catch{r=await ah.getMetrics();}}catch{}if(!dd&&ho&&!tOff())ig(r||null);pd=null;return dbg();})());
}
function setV(v){if(!dd){md=v?'vial':'bar';safe(()=>(o.storage||W.localStorage)?.setItem(SK,md));at();pt();if(v)yR(1);safe(()=>o.onModeChange?.(md));}}
const dbg=()=>({attached:!!(ho&&sr&&ho.isConnected!==!1),mode:md,motionTier:gM(),lightPreset:gP(),vialMounted:!!vl,vialSettled:vOk(),rafActive:!!rf,pollSuspended:!!(doc?.hidden||tOff()||o.autoPoll===!1),pollIntervalMs:cMs,cardOpen:op(),camp:st.c,critical:st.cr,streaming:st.sr,usedFraction:st.f,usedTokens:st.u,maxTokens:st.mx,model:st.m,tps:st.t,latestTps:st.l,ttftSeconds:st.tf,ratios:st.rt.slice(),vialDebug:vl?.getDebugState?.()||null});
on(doc,'visibilitychange',()=>{if(dd)return;if(doc?.hidden){xR();xP();}else if(!tOff()){aT=Date.now();if(op())yR(1);void sync();sP();}},!1,o2);
on(doc,'keydown',()=>{aT=Date.now();},!0,o2);
const pH=W.__agPulseExternalBridge,xH=e=>{safe(()=>pH?.(e));if(!dd&&e&&!tOff()){if(e.event==='mount'||e.event==='render'){aT=Date.now();at();ig(e.data||null);}else if(e.event==='card'){yH();yR(op()?1:0);cX();sP();}else if(e.event==='dispose')dt();}};
safe(()=>{W.__agPulseExternalBridge=xH;});
function destroy(){if(dd)return;dd=!0;xP();while(o2.length)safe(o2.pop());safe(()=>{if(W.__agPulseExternalBridge===xH){if(pH)W.__agPulseExternalBridge=pH;else delete W.__agPulseExternalBridge;}[W,G].map(x=>{if(x?.[BK]===api)delete x[BK];});});dt();if(i0===api)i0=null;}
const api={sync,setVialEnabled:setV,getDebugState:dbg,destroy};if(!o.allowMultiple){i0=api;safe(()=>{W[BK]=G[BK]=api;});}if(!tOff())void sync();sP();
return api;}
return{STORAGE_KEY:SK,HOST_ID:HID,computeLayerRatios:calcR,detectCamp:camp,mountPulseVialBridge};
});
