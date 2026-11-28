(function(root,factory){
if(typeof module==='object'&&module.exports){module.exports=factory(root);}else{
try{root.__agPrismTelemetry?.destroy?.();}catch{}
if(typeof window!=='undefined'&&window!==root)try{window.__agPrismTelemetry?.destroy?.();}catch{}
const api=factory(root);root.__agPrismTelemetry=api;if(typeof window!=='undefined')window.__agPrismTelemetry=api;
}
})(typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:this,function(globalRoot){
'use strict';
const isFn=v=>typeof v==='function',isStr=v=>typeof v==='string',isFin=v=>typeof v==='number'&&Number.isFinite(v);
const gA=(e,k)=>e?.getAttribute?.(k),sA=(e,k,v)=>e?.setAttribute?.(k,v),rA=(e,k)=>e?.removeAttribute?.(k);
const qS=(e,s)=>e?.querySelector?.(s),qA=(e,s)=>e?.querySelectorAll?.(s);
const emitB=(w,p)=>{try{w?.__agPulseExternalBridge?.(p);}catch{}};
const TI=s=>`[data-testid="${s}"]`,TIs=s=>s.split('|').map(TI).join(','),cT=t=>(t!==null&&clearTimeout(t),null),stTm=(fn,ms)=>{const t=setTimeout(fn,ms);t?.unref?.();return t;},on=(e,t,f,c)=>(e?.addEventListener?.(t,f,c),()=>e?.removeEventListener?.(t,f,c)),setIf=(e,k,v)=>{if(gA(e,k)!==v)sA(e,k,v);},qAll=(d,s)=>{let r=isFn(d?.querySelectorAll)?Array.from(d.querySelectorAll(s)):[];if(!r.length&&isFn(d?.querySelector)){const o=d.querySelector(s);if(o)r=[o];}return r;},mkTier=(anc,host)=>({anc,host,ro:null,raf:0,curFtTier:0,curBarTier:0,pendW:0,hasPendW:false,lastW:0,lastFtTv:'',lastBarTv:'',lastWide:false});

const BI='ag-pulse-status-bar',PI='ag-prism-pulse-bar',PA='data-ag-prism-pulse-bar',FA='data-ag-prism-fallback',HA='data-ag-prism-hidden',MB='__agPrismMetricsCall';
const WM=1500,GM=3500,SWM=30,HOM=180,HCM=220,LMX=32,GRE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,URE=/\/c\/([0-9a-f-]{36})/i;
const TA='data-t',TSA='data-pt',TVS=['0','1','1 2','1 2 3','1 2 3 4','1 2 3 4 5'],FVS=['0','1','1 2'],N0=Date.now,mx=Math.max,mn=Math.min,rd=Math.round;
const CID_A='data-cascade-id',CID_S='['+CID_A+']',CV_S=TI('conversation-view'),AE_A='aria-expanded',IB_S=TI('agent-input-box'),MS_S=TI('model-selector-trigger');
const LE='local-estimate',RP='renderer-proxy',AG='data-ag-cs-',PV='data-pv-',DW='data-warn',CK='conversationId',IK='includeConversations';
const expCss=s=>{
const k='pqrstuvwxyz0123456789abcdefghijklmno',t=[':host([data-no-q="1"][data-t~="','.bar>$2context"]','color:var(--','::before','transparent)',':is(.bar,.bar *)','font-variant-numeric:tabular-nums','position:relative','flex:none','justify-content:','align-items:center','var(--e)',':host([data-t~="','[data-card="','color-mix(in srgb,var(--pt-c) ','overflow:hidden;white-space:nowrap;','transform:scale(.9) translateX(4px);pointer-events:none!important','border-radius:','background:','rgba(148,163,184,.',':host([data-pv-resizing="1"])',':host([data-pv-light="1"])',':is(:hover,[aria-expanded="true"])','transition:','font-size:','opacity:','position:absolute;','flex-shrink:','max-width:','margin:','padding:','.bar .chip',':host(:not(.icons-only))','font-weight:','display:none!','pointer-events:none'];
for(let i=0;i<t.length;i++)s=s.split('$'+k[i]).join(t[i]);
return s.replace(/!(?!important)/g,'!important');
};
const TIER_CSS=expCss('[hidden]{$n}:host{--e:cubic-bezier(.22,1,.36,1);--pt-c:var(--pv-tint,var(--pulse-ring,#3186ff))}.bar{$cgap .28s $0}.bar>:is(.chip,.dot){$4max-width:132px;$e1;transform-origin:right;$cmax-width .28s $0,opacity .17s ease-out,padding .28s $0,margin .28s $0,gap .28s $0,transform .28s $0,background .16s,border-color .22s,box-shadow .22s}.bar>[data-card="cache"]{max-width:240px}$q{$h136px}.bar>.dot{$h16px}:where(.bar>.chip>*:not(.context-ring):not(svg)){$4max-width:108px;flex-shrink:0;$e1;transform-origin:right;$cmax-width .28s $0,opacity .17s ease-out,margin .28s $0,padding .28s $0,transform .28s $0}.context-ring{$ctransform .28s $0}.context-ring[data-anim="1"]{will-change:transform}$11"]) :is(.cache-total,.sub-badge,$2cache"] .dim,.countdown),$14"]) $2context"] .context-label,$15"]) $2context"]>:not(.context-ring){max-width:0!important;flex-shrink:1!important;$e0!;$i0!;$j0!;$5}$11"]) .bar>:is($2speed"],.dot),$12"]) .bar>$2cache"],$13"]) .bar>:is($2week"],$2five"]){$h0!;min-width:0!;$g1!;$e0!;$j0!;$i0!;gap:0!;border:0!;$5}$11"]) .bar>$2speed"]$s,$12"]) .bar>$2cache"]$s,$13"]) .bar>$2week"]$s,$13"]) .bar>$2five"]$s,$13"]) $q$s,$p1"]) .bar>$2cache"]$s,$p2"]) $q$s{$e0!;content:none!}$13"]) $q,$p1"]) .bar>$2cache"],$p2"]) $q{margin-left:0!}$13"]) .bar{gap:0}$15"]) $2context"]{width:28px!;min-width:28px!;height:28px!;$j0!;gap:0!;$6999px!;$ycenter!;$7$39%,$t;border:1px solid $328%,$828))}$15"]) $2context"]$b{$7$317%,$t;border-color:$348%,$84));box-shadow:0 0 10px -2px $345%,$t}$15"]) .context-ring{transform:scale(1.27)}:host([data-pv-motion="off"]) $u,$9 $u{$cnone!}@media (prefers-reduced-motion:reduce){:host(:not([data-pv-ignore-rm="1"])) $u{$cnone!}}');
const SHADOW_CSS=expCss(':host,*,::before,::after{box-sizing:border-box}:host,.bar,.chip{display:inline-flex;$z}:host{--ch:#dae2f0db;--mu:#94a0b6b8;--f:#eef1f7;--pv-tint:#3186ff;flex:0 0 auto;$w;font:11px/16px Inter,system-ui,-apple-system,"Segoe UI",sans-serif;$v;$rch);user-select:none;z-index:20}$a{--ch:#1e293b;--mu:#475569;--f:#0f172a;--pv-tint:#2563eb;--pv-w1:#d97706;--pv-w2:#dc2626}:host([hidden]),.sub-badge[hidden],:host(:not([data-wide="1"])) .sub-badge,.card[hidden],.footnote[hidden],.footnote:empty,:host([data-layout="blocked"])>.bar{$n}:host([data-layout="blocked"]){position:fixed!;left:-9999px!;top:-9999px!;width:0!;height:0!;$i0!;$j0!;overflow:hidden!;visibility:hidden!;$o!}.bar{gap:2px;$x}$k{$x;white-space:nowrap;gap:3.5px;height:24px;$j0 5px;border:0;$65px;$7transparent;$rch);font:inherit;line-height:16px;$d11px;cursor:pointer;overflow:visible;$v;$cbackground .15s,color .15s}$k$b{$7rgba(255,255,255,.05);$rf)}$a $k$b{$7rgba(15,23,42,.05)}$k strong{$m600}$k[data-warn="1"] strong,dd[data-warn="1"]{$rpv-w1,#f59e0b)}$k[data-warn="2"] strong,dd[data-warn="2"]{$rpv-w2,#f87171)}.chip svg{width:12px;height:12px;stroke:currentColor;stroke-width:1.5;fill:none;$e.75;$x}$k .dim{$rmu);$e.66;$d9.5px}$k :is([data-i18n="cache"],[data-i18n="five"],[data-i18n="week"]){$e.62}$k[data-card="speed"]>span:last-child{$e.66;$d10px}$l :is(.chip[data-card="speed"]>:is(svg,.rounds),.chip[data-card="cache"]>:is(svg:first-child,.cache-total,.dim),.chip[data-card="context"]>.context-label){$n}$l $k:not([hidden])~.chip:not([hidden]){$w;margin-left:6px}$l $k:not([hidden])~.chip:not([hidden])$s{content:"·";$fleft:-4px;top:50%;transform:translate(-50%,-50%);$rmu);$e.32;$o}.sub-badge{$d10px;$e.82;$rprimary,#38bdf8);$m500;margin-right:2px}.context-ring{width:11px;height:11px;$650%;$7conic-gradient(var(--pv-tint,#3186ff) var(--used-angle,36deg),$828) 0);display:inline-block;$w;$x}.context-ring::after{content:"";$finset:2.2px;$650%;$7var(--card,#141720)}$a .context-ring::after{$7var(--card,#f8fafc)}.card{$fright:0;left:auto;bottom:calc(100% + 10px);width:min(304px,calc(100vw - 24px));$j12px 13px;$610px;border:1px solid $822);$7var(--card,#12151ef5);$rforeground,#eef1f7);box-shadow:0 16px 40px rgba(0,0,0,.36);z-index:9999}.card::after{content:"";$fleft:0;right:0;top:100%;height:12px}$14"]) .card{right:-84px;width:min(296px,calc(100vw - 32px))}.heading{display:flex;$z;$yspace-between;gap:6px;$d11px;$m600;margin-bottom:6px}.heading>span:first-child{white-space:nowrap}#context-summary{display:block;$d13px;$m600;margin-bottom:2px}#context-tokens{$i0 0 8px;$d11px;$e.76}.track{height:5px;$6999px;$7$818);overflow:hidden;$i6px 0 10px}.track>i{display:block;height:100%;width:0%;$6999px;$7linear-gradient(90deg,#2563eb,#38bdf8)}dl{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;$i8px 0;$d11px}dt{$e.64}dd{$i0;text-align:right;$m500;$4text-overflow:ellipsis}.footnote{$i6px 0 0;$d10px;$e.58}')+TIER_CSS;

const FB_ROWS={
'zh-CN':'缓存|吞吐速率|首字延迟|最近速率|上下文窗口|当前模型|已用|剩余|代理|5h|周|5h 配额|周配额',
'zh-TW':'快取|吞吐速率|首字延遲|最近速率|上下文視窗|目前模型|已用|剩餘|代理|5h|週|5h 額度|週額度',
en:'Cache|Throughput|TTFT|Latest Rate|Context Window|Active Model|used|free| sub|5h|Wk|5h Quota|Weekly Quota',
ja:'キャッシュ|スループット|初回応答|最新速度|コンテキスト|現在のモデル|使用|残り| サブ|5h|週|5h 枠|週間枠',
ko:'캐시|처리 속도|첫 토큰 지연|최근 속도|컨텍스트 창|현재 모델|사용|여유| 서브|5h|주|5h 할당|주간 할당',
es:'Caché|Rendimiento|TTFT|Velocidad rec.|Ventana de ctx|Modelo activo|usado|libre| sub|5h|Sem|Cuota 5h|Cuota sem.',
fr:'Cache|Débit|TTFT|Dernier débit|Fenêtre ctx|Modèle actif|utilisé|libre| sous|5h|Heb|Quota 5h|Quota hebdo',
de:'Cache|Durchsatz|TTFT|Akt. Rate|Kontextfenster|Aktives Modell|belegt|frei| Sub|5h|W|5h-Kontingent|Wochenkontingent',
tr:'Önbellek|Verim|TTFT|Son Hız|Bağlam|Aktif Model|dolu|boş| alt|5h|Hf|5s Kota|Haftalık Kota',
};
const LANG_M=[[/^(?:yue(?:-|$)|zh-yue|.*cantonese)/,'zh-CN'],[/^(?:zh-(?:tw|hant|hk|mo)|tw$|hant$)/,'zh-TW'],[/^zh/,'zh-CN'],[/^(?:ja|jp|japanese$)/,'ja'],[/^(?:ko|kr|korean$)/,'ko'],[/^(?:es|spanish$)/,'es'],[/^(?:fr|french$)/,'fr'],[/^(?:de|german$)/,'de'],[/^(?:tr|turkish$|türkçe$|turkce$)/,'tr']];
function normFbLang(raw,win){
let v=String(raw||'').trim();
if(!v||v.toLowerCase()==='auto'){const nv=win&&'navigator'in win?win.navigator:(typeof navigator!=='undefined'?navigator:null);v=String(nv?.languages?.[0]||nv?.language||'').trim();}
const s=v.toLowerCase().replace(/_/g,'-');
if(!s||s==='auto')return 'en';
for(const[re,code]of LANG_M)if(re.test(s))return code;
return 'en';
}
const FB_I18N=Object.fromEntries(Object.entries(FB_ROWS).map(([lk,s])=>{
const r=s.split('|');
return[lk,{cache:r[0],speedHeading:r[1],ttft:r[2],latestRate:r[3],ctxHeading:r[4],curModel:r[5],fiveShort:r[9],weekShort:r[10],fiveQuota:r[11],weekQuota:r[12],summary:(p,rem)=>`${p}% ${r[6]} · ${rem}% ${r[7]}`,agents:n=>`${n}${r[8]}`}];
}));

const qEta=r=>{
const ms=typeof r==='number'?(r>1e11?r:r*1e3):Date.parse(r||''),d0=ms-Date.now();
if(!isFin(d0)||d0<=0)return '';
const s=Math.max(1,Math.round(d0/1e3)),d=(s/86400)|0,h=((s%86400)/3600)|0;
return d?`${d}d${h}h`:h?`${h}h${((s%3600)/60)|0}m`:`${Math.max(1,(s/60)|0)}m`;
};
const qWin=b=>{
if(!b||typeof b!=='object'||b.available===false||b.disabled)return null;
if(b.expired)return{r:1,t:b.resetAt??b.resetTime};
const n=+(b.remaining??b.remainingFraction);
return isFin(n)?{r:Math.max(0,Math.min(1,n)),t:b.resetAt??b.resetTime}:null;
};
const hasAvailQWin=g=>!!(qWin(g?.windows?.['5h']||g?.fiveHour)||qWin(g?.windows?.weekly||g?.weekly));
const Q_AR=/argon|wtu/i,Q_CL=/claude|anthropic|gpt|openai/i,Q_GM=/gemini|google/i;
const qKind=g=>{
if(!g||typeof g!=='object')return 'other';
const w=g.windows,m=(s,fb)=>(!fb&&Q_AR.test(s)?'argon':Q_CL.test(s)?'claude':Q_GM.test(s)?'gemini':fb&&Q_AR.test(s)?'argon':'');
return m([g.id,g.groupId,g.name,g.label,g.displayName,w?.['5h']?.id||g.fiveHour?.id,w?.weekly?.id||g.weekly?.id].join(' '))||(g.description&&m(g.description,1))||'other';
};
function chooseQuotaGroupFallback(groups,model){
const list=Array.isArray(groups)?groups.filter(g=>g&&typeof g==='object'):[];
if(!list.length)return null;
const byK=k=>list.find(g=>qKind(g)===k),ms=String(model||'').toLowerCase();
const pick=/argon/.test(ms)?byK('argon')||byK('gemini'):/claude|anthropic|sonnet|opus|haiku|gpt|openai|\bo[134]\b/.test(ms)?byK('claude'):/gemini|carbon|hydrogen|neon|pro|flash/.test(ms)?byK('gemini')||byK('argon'):null;
return pick||list.find(hasAvailQWin)||byK('gemini')||list[0];
}
const qGrp=(gs,m,w)=>{
if(!Array.isArray(gs)||!gs.length)return null;
const uc=w?.__agCsUsageCore;
if(uc?.chooseQuotaGroup)try{const hit=uc.chooseQuotaGroup(gs,m);if(hit)return hit;}catch{}
return chooseQuotaGroupFallback(gs,m);
};

const histHooks=new WeakMap();
function subHistory(w,fn){
const h=w?.history;
if(!h||(!isFn(h.pushState)&&!isFn(h.replaceState)))return null;
let rec=histHooks.get(h);
if(!rec){
const oP=isFn(h.pushState)?h.pushState:null,oR=isFn(h.replaceState)?h.replaceState:null;
rec={oP,oR,wP:null,wR:null,cbs:new Set()};
const emit=()=>{for(const cb of [...rec.cbs])try{cb();}catch{}};
try{
if(oP){rec.wP=function(){const r=oP.apply(this,arguments);emit();return r;};h.pushState=rec.wP;}
if(oR){rec.wR=function(){const r=oR.apply(this,arguments);emit();return r;};h.replaceState=rec.wR;}
}catch{return null;}
histHooks.set(h,rec);
}
rec.cbs.add(fn);
return()=>{
rec.cbs.delete(fn);
if(rec.cbs.size===0){
try{if(rec.oP&&h.pushState===rec.wP)h.pushState=rec.oP;if(rec.oR&&h.replaceState===rec.wR)h.replaceState=rec.oR;}catch{}
histHooks.delete(h);
}
};
}

const fmtTok=n=>!isFin(n)||n<0?'—':n>=1e6?`${(n/1e6).toFixed(1).replace(/\.0$/,'')}M`:n>=1e3?`${Math.round(n/1e3)}K`:String(Math.round(n));
function mk(doc,tag,attrs,kids){
const el=doc.createElement(tag);
if(attrs)for(const[k,v]of Object.entries(attrs)){
if(v==null)continue;
if(k==='text')el.textContent=String(v);else if(k==='cls')el.className=String(v);else if(k==='hidden')el.hidden=!!v;else el.setAttribute(k,String(v));
}
if(kids)for(const c of kids)if(c)el.appendChild(c);
return el;
}

const HOST_ATTRS=Object.freeze({[FA]:'1',[PA]:'true','data-ag-owned':'1','data-ag-no-i18n':'',translate:'no','data-no-translate':'true','data-ag-localization-skip':'true','data-agy-no-translate':'true','data-antigravity-zh-skip':'1'});
const HIDE_PROPS='position:fixed|left:-9999px|top:-9999px|width:1px|height:1px|opacity:0|pointer-events:none|visibility:hidden|overflow:hidden'.split('|').map(s=>s.split(':'));
const FTC=[440,360],BRC=[680,620,530,440,360],BRB=[720,650,560,440,360],WDC=1080,FT_S='.agy-composer-footer,'+TI('input-box-bottom-toolbar'),HC_A='data-hover-card-popup',QMA='data-ag-cs-telemetry-quota';
const stpT=(c,w,cs)=>{let t=c;while(t<cs.length&&w<cs[t])t++;while(t>0&&w>=cs[t-1]+12)t--;return t;};
const SB_S='aside,'+TI('sidebar-split')+'>div:first-child,'+TIs('conversation-row-sidebar|project-header')+',['+HC_A+']';
const IGN_S=TIs('autoscroll-viewport|planner-response-text|agent-response|background-task-command|running-items-card')+',[data-markdown-root],'+SB_S+',[data-op-thought="1"],.ag-prism-thought-overlay,.ag-cs-conv-aura-host,.ag-cs-crab,.ag-cs-prism-rim-cv,.ag-anim-icon,.ag-cs-thinking-spark,[data-agy-hans-ui],#agy-theme-switcher,#agy-theme-menu,#antigravity-quota-widget,#antigravity-translation-audit,#ag-usage-monitor-capsule,#ag-usage-monitor-portal';
const BST=[450,700,900,1100,1400,1800,2200,2500],BSY_S=TIs('input-cancel-button|stop-button|cancel-button|stop-generation-button'),SND_S=TIs('input-send-button|send-button')+','+IB_S+' button[type="submit"]',SLO_S='[id^="typeahead-item-"][role="option"],'+TI('slash-command-menu')+' [role="option"],[role="listbox"] [role="option"]',PT_S=TIs('agy-context-ring-trigger|agy-speed-stats-trigger'),UM_S='#ag-usage-monitor-capsule',CMP_RE=/^\/compact(?:\s|$)/i;
let reqSeq=0;

function createTelemetryController(envOpts){
const gW=()=>(envOpts&&envOpts.window)||(typeof window!=='undefined'?window:globalRoot);
const gD=()=>(envOpts&&envOpts.document)||gW()?.document||null;

let md='auto',qm='compact',wTm=null,rTm=null,pTm=null,swTm=null,bTm=null,bIdx=0,bGen=0,bBase=null,bCid=null,cOff=null,pCmpAt=0,wBsy=false,pxM=false;
let hHost=false,yld=false,lSg='',dAt=0,lHlAt=0;
let dOff=null,pOff=null,wrOff=null,lS=null,mApi=null,mRes=null,sObs=null,hTm=null;
let eLng='',aH=null,wBl=false,pSp=false,bOff=null,bObs=null,eGH=false,lHr='',lUC='';
const PD=new Map(),IF=new Map(),LM=new Map(),IS=new Map(),IH=new WeakMap(),ET=new Map(),SC=new Map(),LS=new WeakMap();

const rRK=w=>{const l=w?.location;return l?`${l.href||''}|${l.pathname||''}|${l.hash||''}`:'';};
const eUC=w=>{const l=w?.location,m=(isStr(l?.pathname)&&l.pathname.match(URE))||(isStr(l?.href)&&l.href.match(URE));return m?m[1]:null;};
const cTs=s=>{const v=s?.speed?.context?.sampledAt;if(isFin(v))return v;const t=Date.parse(v||'');return isFin(t)?t:NaN;};
const pCS=(c,s)=>{
if(!c||!s||typeof s!=='object')return;
const p=SC.get(c);
if(s.connection===LE&&p&&p.connection!==LE)return;
if(p&&p.connection!==LE&&s.connection!==LE){const pt=cTs(p),nt=cTs(s);if(isFin(pt)&&isFin(nt)&&nt<pt)return;}
SC.delete(c);SC.set(c,s);
if(SC.size>LMX)SC.delete(SC.keys().next().value);
};
const gCS=c=>{if(!c||!SC.has(c))return null;const v=SC.get(c);SC.delete(c);SC.set(c,v);return v;};
const iC=(d,e)=>{
if(!e||e.isConnected===false)return false;
if(e.isConnected===true)return true;
if(!e.parentNode&&!e.parentElement)return false;
if(d&&isFn(d.getElementById)&&e.id&&!isFn(d.querySelectorAll)){const b=d.getElementById(e.id);if(b&&b!==e)return false;}
return true;
};
const gPI=()=>{const d=gD();let f=null;for(const it of IS.values()){if(!iC(d,it.host))continue;if(!f)f=it;if(it.host.id===PI)return it;}return f;};
const iCO=it=>!!(it&&((it.xCard&&!it.xCard.hidden)||(it.sCard&&!it.sCard.hidden)));
const actIn=()=>{
const d=gD();
for(const it of IS.values())if(iC(d,it.host)&&iCO(it))return it;
if(aH&&iC(d,aH)){const h=IH.get(aH);if(h)return h;}
const cv=d?.activeElement?.closest?.(CV_S+','+IB_S);
if(cv)for(const it of IS.values())if(iC(d,it.host)&&(cv===it.anc||cv.contains?.(it.anc)))return it;
return gPI();
};
const syPI=()=>{
const d=gD();let p=null;
for(const it of IS.values()){if(!iC(d,it.host))continue;if(!p)p=it;if(it.host.id===PI){p=it;break;}}
for(const it of IS.values()){
if(it===p){if(it.host.id!==PI)sA(it.host,'id',PI);}
else if(it.host.id){rA(it.host,'id');if(it.host.id)it.host.id='';}
}
};

const syH=h=>{
const de=gD()?.documentElement;if(!h||!de)return;
const th=gA(de,AG+'theme');
if(th==='light')setIf(h,PV+'light','1');else if(th==='dark'&&gA(h,PV+'light')==='1')rA(h,PV+'light');
for(const k of['resizing','ignore-rm'])gA(de,AG+k)==='1'?setIf(h,PV+k,'1'):gA(h,PV+k)!==null&&rA(h,PV+k);
};
const syAH=()=>{for(const it of IS.values())syH(it.host);for(const b of fEB(gD()))syH(b);};
const pRA=rec=>{const r=rec?.sr?.getElementById?.('context-ring');if(!r)return;rec.ringTm=cT(rec.ringTm);setIf(r,'data-anim','1');rec.ringTm=stTm(()=>{rec.ringTm=null;rA(r,'data-anim');},320);};
const clrCF=c=>{const s=c?.style;if(s?.removeProperty){s.removeProperty('margin-right');s.removeProperty('max-width');}else if(s){s.marginRight='';s.maxWidth='';}};
const fitC=(it,c)=>{
const s=c?.style;if(!it||!c||c.hidden||!it.host||!s?.setProperty)return;
const hr=it.host.getBoundingClientRect?.();if(!hr||(!hr.width&&!hr.left&&!hr.right))return;
const mr=parseFloat(s.getPropertyValue?.('margin-right'))||0,be=it.host.closest?.(CV_S+',[data-main-content-body],[data-side-panel-body],.surface-composer-card')||it.anc,br=be?.getBoundingClientRect?.();
const w=gW(),vw=Number(w?.innerWidth)||0,hb=!!(br&&br.width>0),minL=mx(8,(hb?br.left:0)+8),maxR=mn(vw>0?vw-8:9e4,(hb?br.right:(vw||9e4))-8);
if(maxR<=minL)return;
const av=rd(mx(200,maxR-minL));s.setProperty('max-width',av+'px','important');
const cr=c.getBoundingClientRect?.(),cw=cr&&cr.width>0?mn(cr.width,av):mn(304,av);
const nL=cr&&cr.width>0?cr.left+mr:hr.right-cw,tL=mx(minL,mn(nL,maxR-cw)),wM=rd(nL-tL);
if(Math.abs(wM)>1)s.setProperty('margin-right',wM+'px','important');else s.removeProperty?.('margin-right');
};
const apT=(rec,force=false)=>{
rec.raf=0;
const d=gD(),ft=md!=='off'&&rec.anc&&iC(d,rec.anc)?rec.anc:null,w=rec.hasPendW?rec.pendW:ft?.getBoundingClientRect?.().width;
rec.pendW=0;rec.hasPendW=false;
if(!ft||!isFin(w)||w<=0)return;
rec.lastW=w;
const pB=rec.lastBarTv,fT=FVS[(rec.curFtTier=stpT(rec.curFtTier,w,FTC))]||'0',bT=TVS[(rec.curBarTier=stpT(rec.curBarTier,w,qm==='both'?BRB:BRC))]||'0',iW=w>=WDC;
if(!force&&fT===rec.lastFtTv&&gA(ft,TA)===fT&&bT===rec.lastBarTv&&iW===rec.lastWide)return;
rec.lastFtTv=fT;rec.lastBarTv=bT;rec.lastWide=iW;setIf(ft,TA,fT);
if(rec.host){
if(gA(rec.host,HA)!=='1'){setIf(rec.host,TA,bT);if(pB&&pB.includes('5')!==bT.includes('5'))pRA(rec);if(iW)setIf(rec.host,'data-wide','1');else if(gA(rec.host,'data-wide')!==null)rA(rec.host,'data-wide');if(rec.xCard&&!rec.xCard.hidden)fitC(rec,rec.xCard);if(rec.sCard&&!rec.sCard.hidden)fitC(rec,rec.sCard);}
return;
}
const ex=fEB(d),lc=ex.filter(b=>b&&(ft.contains?.(b)||b.parentElement===ft));
for(const b of(lc.length?lc:ET.size<=1?ex:[])){
if(!b||gA(b,HA)==='1')continue;
setIf(b,TA,bT);syH(b);
if(b.shadowRoot&&!qS(b.shadowRoot,`style[${TSA}="1"]`))try{const st=d.createElement('style');sA(st,TSA,'1');st.textContent=TIER_CSS;b.shadowRoot.appendChild(st);}catch{}
}
};
const gBus=()=>{const w=gW();return w?.__agDomBus||w?.__agPrismDomBus||null;};
const subMo=(id,root,opt,fn,pri)=>{
const b=gBus(),w=gW();
if(b?.subscribe)return{disconnect:b.subscribe(id,fn,{doc:gD(),win:w,priority:pri,observeOptions:opt})};
if(!isFn(w?.MutationObserver)||!root)return null;
const mo=new w.MutationObserver(fn);try{mo.observe(root,opt);}catch{}return mo;
};
const rEW=e=>(Array.isArray(e?.borderBoxSize)?e.borderBoxSize[0]:e?.borderBoxSize)?.inlineSize??(Array.isArray(e?.contentBoxSize)?e.contentBoxSize[0]:e?.contentBoxSize)?.inlineSize??e?.contentRect?.width;
const scT=(rec,es)=>{
if(es&&typeof es.length==='number'){
let rw=NaN;for(let i=es.length-1;i>=0;i--){const w0=rEW(es[i]);if(isFin(w0)&&w0>=0){rw=w0;break;}}
if(isFin(rw)){rec.pendW=rw;rec.hasPendW=true;}
}else rec.hasPendW=false;
if(!rec.raf&&md!=='off'){const w=gW();if(w?.requestAnimationFrame){let rn=false;const id=w.requestAnimationFrame(()=>{rn=true;apT(rec,false);});rec.raf=rn?0:id;}else apT(rec,false);}
};
const eWR=()=>{const w=gW();if(!wrOff&&w&&isFn(w.addEventListener))wrOff=on(w,'resize',()=>{for(const it of IS.values())scT(it,null);for(const et of ET.values())scT(et,null);},{passive:true});};
const atT=rec=>{
const w=gW();if(!w||!rec?.anc||md==='off')return;
if(!rec.ro){
const b=gBus();
if(b?.observeSize)try{rec.ro={disconnect:b.observeSize(rec.anc,(sz,en)=>scT(rec,[en||{borderBoxSize:[{inlineSize:sz.width}]}]))};}catch{}
else if(isFn(w.ResizeObserver))try{rec.ro=new w.ResizeObserver(es=>scT(rec,es));rec.ro.observe(rec.anc);}catch{}
}
eWR();if(!rec.lastBarTv||!rec.ro)apT(rec,true);
};
const dtT=rec=>{
if(!rec)return;
try{if(rec.raf)gW()?.cancelAnimationFrame?.(rec.raf);rec.ringTm=cT(rec.ringTm);rec.ro?.disconnect?.();rA(rec.anc,TA);if(rec.host)rA(rec.host,'data-wide');}catch{}
Object.assign(rec,{raf:0,ro:null,curFtTier:0,curBarTier:0,pendW:0,hasPendW:false,lastW:0,lastFtTv:'',lastBarTv:'',lastWide:false});
};
const reT=()=>{for(const r of[...IS.values(),...ET.values()]){r.curBarTier=0;if(r.lastW>0){r.pendW=r.lastW;r.hasPendW=true;}apT(r,true);}};
const cET=()=>{for(const et of ET.values())dtT(et);ET.clear();};
const cTr=()=>{
for(const it of IS.values())dtT(it);
cET();try{wrOff?.();}catch{}wrOff=null;
for(const b of qA(gD(),`#${PI},[${PA}],#${BI},[id^="${BI}"],[data-ag-pulse-bar]`)||[])try{rA(b,TA);rA(b,'data-wide');qS(b.shadowRoot,`style[${TSA}="1"]`)?.remove?.();}catch{}
};
const eTO=()=>{
const d=gD();if(!d||md==='off')return;
if(IS.size>0){cET();for(const it of IS.values())atT(it);return;}
const fts=fAn(d,true),fs=new Set(fts);
for(const[anc,et]of ET)if(!fs.has(anc)||!iC(d,anc)){dtT(et);ET.delete(anc);}
for(const ft of fts){let et=ET.get(ft);if(!et)ET.set(ft,et=mkTier(ft,null));atT(et);}
};

const gLm=()=>{const w=gW();return w?(w.__agPrismMetricsLast||=new Map()):LM;};
const pLm=(cid,sn,inc,sig,tr)=>{
if(!sn||typeof sn!=='object'||sn.connection===LE)return;
const tr0=tr||sn.transport||(sn.connection===RP?RP:'');
if(tr0===RP)pxM=true;else if(sn.connection==='live'&&!tr0)pxM=false;
const lm=gLm(),ck=cid||'';lm.delete(ck);
lm.set(ck,{at:N0(),snap:sn,inc:!!inc,sig:isStr(sig)?sig:(isStr(sn.sig)?sn.sig:''),tr:tr0});
if(lm.size>16)lm.delete(lm.keys().next().value);
};
const bHk=()=>{
const w=gW();if(!w)return;
if(!mRes){
mRes=(id,pl)=>{
const it=PD.get(id);if(!it)return;
cT(it.timer);PD.delete(id);
let sy=pl,uc=false;
if(pl&&pl.unchanged===true){
if(pl.transport===RP)pxM=true;
const lm=gLm(),ck=it.cid||'',rc=lm.get(ck),pv=rc?.snap||(it.cid&&SC.get(it.cid))||(!it.cid?lS:null);
if(pv){
uc=true;sy=pv;
if(rc){rc.at=N0();if(isStr(pl.sig)&&pl.sig)rc.sig=pl.sig;}else pLm(it.cid,pv,it.inc,pl.sig,pl.transport);
if(it.cid)pCS(it.cid,sy);
if(!lS||!it.cid||actIn()?.cid===it.cid)lS=sy;
}else sy=gFb(it.cid,null);
}
if(!uc){
if(sy&&sy.connection!==LE&&sy.groups?.length>0){
const pv=(it.cid&&SC.get(it.cid))||(!it.cid?lS:null);
const ks=!sy.speed&&pv?.speed,kc=!sy.conversations?.length&&pv?.conversations?.length;
sy=ks||kc?{...sy,...(ks?{speed:pv.speed}:{}),...(kc?{conversations:pv.conversations}:{})}:sy;
if(it.cid)pCS(it.cid,sy);
if(!lS||!it.cid||actIn()?.cid===it.cid)lS=sy;
}
if(sy&&sy.connection!==LE)pLm(it.cid,sy,it.inc,pl?.sig,pl?.transport);
}
if((it.syncUi||uc)&&sy&&sy.connection!==LE&&sy.speed?.context&&IS.size>0){
const d=gD(),ml=IS.size>1,nAt=String(sy.speed.context.sampledAt||'');
for(const ins of IS.values()){
if(!iC(d,ins.host))continue;
const lc=dCd(ins.host,ml),oAt=String(ins.snap?.speed?.context?.sampledAt||'');
if((it.cid?(ins.cid===it.cid&&(!lc||lc===it.cid)):(!ml&&!ins.cid))&&ins.snap!==sy&&(ins.snap?.connection===LE||!oAt||!nAt||nAt>=oAt))apSn(ins,sy);
}
}
it.onSettle?.();it.resolve(sy);
};
}
if(w.__agPrismMetricsResolve!==mRes)w.__agPrismMetricsResolve=mRes;
};
const cWt=()=>{wTm=cT(wTm);rTm=cT(rTm);};
const cSw=()=>{swTm=cT(swTm);};
const cBs=()=>{bGen++;bTm=cT(bTm);bIdx=0;bBase=bCid=null;};
const cPl=()=>{pTm=cT(pTm);};
const clCW=()=>{try{cOff?.();}catch{}cOff=null;pCmpAt=0;wBsy=false;};
const iBl=()=>{const d=gD();return!!(d?.hidden||gA(d?.documentElement,AG+'win-blur')==='1'||wBl);};
const rdQm=()=>{const a=gA(gD()?.documentElement,QMA);return a==='both'?'both':a==='compact'?'compact':'';};
const cBl=()=>{try{bOff?.();bObs?.disconnect?.();}catch{}bOff=bObs=null;wBl=pSp=false;};
const aOp=()=>{for(const it of IS.values())if(iCO(it))return true;return false;};
const gPM=()=>(aOp()||hBs(gD()))?2800:(pxM?6000:5000);
const sPl=()=>{
cPl();if(IS.size===0||md==='off')return;
if(iBl()){pSp=true;return;}
pSp=false;pTm=stTm(()=>{pTm=null;if(IS.size===0||md==='off')return;if(iBl()){pSp=true;return;}void refresh({poll:true}).finally(()=>{if(IS.size&&md!=='off'&&!iBl()&&pTm===null)sPl();});},gPM());
};
const syBl=r=>{
if(IS.size===0||md==='off'){cPl();cBs();pSp=false;return;}
if(iBl()){pSp=true;cPl();cBs();return;}
const w=pSp;pSp=false;if(pTm===null)sPl();if(w&&r)void refresh();
};
const eBl=()=>{
const w=gW(),d=gD();if(!w||!d)return;
if(!bOff&&isFn(w.addEventListener)){
const u=[on(w,'blur',()=>{wBl=true;syBl(false);}),on(w,'focus',()=>{wBl=false;syBl(true);}),on(d,'visibilitychange',()=>{if(!gD()?.hidden)wBl=false;syBl(!gD()?.hidden);})];
bOff=()=>{for(const f of u)f();};
}
if(!bObs&&d.documentElement)try{bObs=subMo('pulse-blur',d.documentElement,{childList:false,subtree:false,attributes:true,attributeFilter:[AG+'win-blur',QMA,AG+'theme',AG+'resizing',AG+'ignore-rm']},()=>{const b=gA(gD()?.documentElement,AG+'win-blur')==='1';if(!b)wBl=false;syBl(!b);syAH();const q=rdQm();if(q&&q!==qm){qm=q;for(const it of IS.values())if(it.snap||lS)apSn(it,it.snap||lS);reT();}},'high');}catch{}
};
const cSt=()=>{cSw();hTm=cT(hTm);try{sObs?.disconnect?.();pOff?.();}catch{}sObs=pOff=null;cTr();};
const isVisH=e=>{for(let c=e;c&&(c.nodeType==null||c.nodeType===1);c=c.parentElement)if(c.hidden||c.inert||c.hasAttribute?.('hidden')||c.hasAttribute?.('inert')||gA(c,'aria-hidden')==='true'||c.style?.display==='none'||c.style?.visibility==='hidden')return false;return!!e;};
const HS='.agy-home,'+TI('home-greeting'),isConv=(d,w,anc)=>{
if(!d||anc?.closest?.('.agy-home'))return false;
const h=qS(d,HS);if(h&&(isVisH(h)||[...qA(d,HS)||[]].some(e=>e!==h&&isVisH(e))))return false;
const pn=w?.location?.pathname;
return!(isStr(pn)&&pn&&!/\/c\/[0-9a-f-]{8,}/i.test(pn)&&!qS(d,CV_S)&&!anc?.closest?.(CID_S)&&!qS(d,CID_S));
};
const fEB=d=>{
if(!d)return[];
const s=new Set(),a=e=>{if(e&&(e.id===BI||String(e.id||'').startsWith(BI)||gA(e,'data-ag-pulse-bar')==='true'))s.add(e);};
try{for(const e of qA(d,`#${BI},[id^="${BI}"],[data-ag-pulse-bar="true"]`)||[])a(e);}catch{}
a(d.getElementById?.(BI));return[...s];
};
const pOr=d=>{
const lv=new Set();for(const it of IS.values())lv.add(it.host);
for(const e of qA(d,`[${FA}="1"],#${PI},[${PA}]`)||[])if(!lv.has(e))try{e.remove();}catch{}
};
const uEx=(d,b,aB=false)=>!!(b&&gA(b,FA)!=='1'&&iC(d,b)&&gA(b,HA)!=='1'&&gA(b,'data-layout')!=='blocked'&&b.hidden!==true&&b.style?.display!=='none'&&(aB||!d?.body||(b.parentElement!==d.body&&b.parentNode!==d.body))&&!b.closest?.('.agy-home'));
const hEx=(bs,kC=false)=>{
const w=gW(),d=gD();if(!w||!d||(!kC&&!isConv(d,w)))return false;
let sD=false;
for(const b of bs||fEB(d)){
if(!b||gA(b,FA)==='1'||!iC(d,b)||gA(b,HA)==='1')continue;
if(uEx(d,b)){dAt=0;return true;}
sD=true;
}
for(const e of qAll(d,PT_S))if(uEx(d,e)){dAt=0;return true;}
for(const e of qAll(d,UM_S))if(uEx(d,e,true)){dAt=0;return true;}
if(sD)return false;
const sg=[w.__agPulseRuntimeOwner?String(w.__agPulseRuntimeOwner):'',w.__agPulseRuntimeBridge?'b':'',w.__agPulseInlineInstalled&&!eGH?'1':'',w.agPulseHost&&!w.agPulseHost.__prismFallback?'h':''].join('|');
if(sg!=='|||'){const nw=N0();if(sg!==lSg){lSg=sg;dAt=nw;return true;}if(!dAt)dAt=nw;return nw-dAt<GM;}
lSg='';dAt=0;return false;
};
const sEx=()=>{
if(eGH){eGH=false;const w=gW();if(w&&!w.__agPulseDispose)w.__agPulseInlineInstalled=false;}
for(const b of fEB(gD()))if(b&&gA(b,HA)==='1'){
rA(b,HA);const s=b.style;
if(s){if(isFn(s.removeProperty)){s.removeProperty('display');for(const[p]of HIDE_PROPS)s.removeProperty(p);}else s.opacity=s.position=s.pointerEvents='';}
}
};
const hdEx=(dE=false)=>{
if(dE){const w=gW();if(w){try{w.__agPulseDispose?.();}catch{}w.__agPulseInlineInstalled=true;eGH=true;}}
for(const b of fEB(gD()))if(b&&gA(b,FA)!=='1'){
sA(b,HA,'1');const s=b.style;
if(s){s.removeProperty?.('display');if(isFn(s.setProperty))for(const[p,v]of HIDE_PROPS)s.setProperty(p,v,'important');else Object.assign(s,{position:'fixed',left:'-9999px',opacity:'0',pointerEvents:'none'});}
}
};
const eBr=()=>{const w=gW();if(!w)return;bHk();if(!mApi)mApi={__prismOwned:true,getMetrics:i=>rSF(i?.conversationId||'__bridge',i,null,true),getLatestSnapshot:()=>lS};w.__agPrismMetricsBridge=mApi;};
const rmH=()=>{const w=gW();if(hHost&&w?.agPulseHost?.__prismFallback)delete w.agPulseHost;hHost=false;};
const eHs=()=>{
const w=gW();if(!w)return;eBr();
if(!w.agPulseHost||!isFn(w.agPulseHost.getMetrics)){
w.agPulseHost={__prismFallback:true,getMetrics:i=>rSF(i?.conversationId||'__host',i,null,true),getLatestSnapshot:()=>lS,getPreferences:()=>Promise.resolve({language:rCL()}),setPreferences:v=>Promise.resolve(v||{}),report:()=>{}};
hHost=true;
}
};
const cHv=it=>{if(it){it.hOpenTm=cT(it.hOpenTm);it.hCloseTm=cT(it.hCloseTm);}};
const dIn=(it,nb=true)=>{
if(!it)return;cHv(it);it.pinned=null;it.hoverOpen=false;dtT(it);
try{if(it.xCard)it.xCard.hidden=true;if(it.sCard)it.sCard.hidden=true;if(nb)emitB(gW(),{event:'dispose',host:it.host});}catch{}
try{it.host.remove();}catch{}
if(aH===it.host)aH=null;
IH.delete(it.host);IS.delete(it.anc);
};
const uFb=(kB=false)=>{
cWt();cSw();cBs();cPl();clCW();cBl();
if(dOff){try{dOff();}catch{}dOff=null;}
if(!kB){cSt();for(const it of PD.values()){cT(it.timer);it.onSettle?.();it.resolve(null);}PD.clear();IF.clear();rmH();}
const n=IS.size;for(const it of[...IS.values()])dIn(it,false);
if(n)emitB(gW(),{event:'dispose'});
pOr(gD());aH=null;
};

const dCd=(n,ml=false)=>{
try{
const c=gA(n?.closest?.(CID_S),CID_A);if(c&&GRE.test(c))return c;
const cv=n?.closest?.(CV_S),cc=gA(cv,CID_A)||gA(qS(cv,CID_S),CID_A);if(cc&&GRE.test(cc))return cc;
if(!ml){const u=eUC(gW());if(u)return u;}
return null;
}catch{return null;}
};
const eSn=(n=null)=>{
const d=gD(),sc=n?.closest?.(CV_S)||d,nw=N0(),c=sc?LS.get(sc):null;
if(c&&nw-c.at<5000)return c.snap;
let model='Gemini 4',ch=0;
try{
const tr=qS(sc,MS_S)||qS(d,MS_S),lb=gA(tr,'aria-label')||tr?.textContent?.trim();if(lb)model=lb;
const vw=sc&&sc!==d?sc:qS(d,CV_S),ts=qA(vw,'[data-testid="planner-response-text"],[data-testid="agent-response"],[data-testid="user-message-bubble"]');
if(ts?.length>0){const k=mn(4,ts.length);let s=0;for(let i=ts.length-k;i<ts.length;i++)s+=(ts[i].textContent||'').length;ch=rd((s/k)*ts.length);}
else if(isStr(vw?.textContent))ch=vw.textContent.length;
}catch{}
const maxTokens=512000,usedTokens=mx(4200,mn(maxTokens,rd(ch/3.2)+8400));
const snap={connection:LE,speed:{model,tps:null,latestTps:null,ttftSeconds:null,rounds:0,cacheHitRate:null,totalTokens:usedTokens,context:{model,usedTokens,maxTokens,usedFraction:mn(.98,usedTokens/maxTokens),sampledAt:nw}},groups:[]};
if(sc)LS.set(sc,{at:nw,snap});
return snap;
};
const gFb=(c,sc)=>(c&&SC.get(c))||(!c&&lS)||eSn(sc);
const rSn=(inp,scN=null,onS=null,sUi=false)=>{
const w=gW();bHk();
const si=inp&&typeof inp==='object'?{...inp}:{};if(si.usageSync)delete si.usageSync;if('maxAgeMs'in si)delete si.maxAgeMs;
const cid=isStr(si[CK])?si[CK]:null,inc=si[IK]!==false,fb=()=>gFb(cid,scN);
if(!si.force&&!si.freshContext&&!si.quotaRefresh&&!si.includeUsage&&!isStr(si.lastSig)){
const lr=gLm().get(cid||'');
si.lastSig=lr&&lr.sig&&lr.snap&&(!inc||lr.inc)?lr.sig:'';
}
if(w&&isFn(w[MB])){
return new Promise(resolve=>{
if(PD.size>=mx(8,IS.size*3)){onS?.();resolve(fb());return;}
const id=++reqSeq,timer=setTimeout(()=>{PD.delete(id);onS?.();resolve(fb());},si.force||si.quotaRefresh?10000:4500);
PD.set(id,{resolve,timer,cid,onSettle:onS,syncUi:sUi,inc});
try{w[MB](JSON.stringify({id,input:si}));}
catch{cT(timer);PD.delete(id);onS?.();resolve(fb());}
});
}
onS?.();return Promise.resolve(eSn(scN));
};
const gSf=()=>{const w=gW();return w?(w.__agPrismMetricsInflight||=new Map()):IF;};
const rSF=(key,inp,scN,sUi=false)=>{
const by=!!(inp?.force||inp?.freshContext||inp?.quotaRefresh),sf=gSf(),cid=isStr(inp?.[CK])?inp[CK]:'',inc=inp?.[IK]!==false;
const k0=cid+':0',k1=cid+':1',rk=cid?(inc?k1:k0):`${key}:${inc?1:0}`;
if(!by){
const mA=isFin(inp?.maxAgeMs)&&inp.maxAgeMs>0?inp.maxAgeMs:0;
if(mA){const lr=gLm().get(cid||'');if(lr&&lr.snap&&lr.snap.connection!==LE&&(!inc||lr.inc)&&N0()-lr.at<mA)return Promise.resolve(lr.snap);}
const hk=sf.has(k1)?k1:(!inc&&sf.has(k0))?k0:sf.has(rk)?rk:'',h=hk&&sf.get(hk);
if(h)return new Promise(r=>{
let d=0,tm=null,fin=(v,dl)=>{if(d)return;d=1;cT(tm);if(dl&&sf.get(hk)===h)sf.delete(hk);r(v||gFb(cid,scN));};
tm=stTm(()=>fin(0,1),4600);
Promise.resolve(h).then(v=>fin(v,!v),()=>fin(0,1));
});
}
let st=false,p=null;
const dn=()=>{if(st)return;st=true;if(p&&sf.get(rk)===p)sf.delete(rk);};
p=rSn(inp,scN,dn,sUi);
if(!st){sf.set(rk,p);p.finally(dn);}
return p;
};

const rCL=()=>{const a=gA(gD()?.documentElement,AG+'lang');return normFbLang((a&&a!=='auto'?a:'')||(eLng&&eLng!=='auto'?eLng:''),gW());};
const gStr=()=>FB_I18N[rCL()]||FB_I18N.en;
const sLb=sr=>{
if(!sr)return;const t=gStr(),ns=qA(sr,'[data-fb-i18n]')||[];
for(let i=0;i<ns.length;i++){const k=gA(ns[i],'data-fb-i18n');if(k&&isStr(t[k])&&ns[i].textContent!==t[k])ns[i].textContent=t[k];}
};
const apSn=(it,sn)=>{
if(!it?.sr||!it.host)return;
it.pAt=N0();
if(sn&&typeof sn==='object'){
it.snap=sn;if(it.cid)pCS(it.cid,sn);
const act=actIn();if(!lS||!act||act===it)lS=sn;
}
const sr=it.sr,fbEl=it.host,sp=sn?.speed||{},ctx=sp.context||{},gE=id=>sr.getElementById(id),sT=(id,v)=>{const e=gE(id),s=String(v);if(e&&e.textContent!==s)e.textContent=s;},wLvl=(e,r)=>{r<=.15?sA(e,DW,'2'):r<=.35?sA(e,DW,'1'):rA(e,DW);};
const mT=ctx.maxTokens>0?ctx.maxTokens:512000,uf=isFin(ctx.usedFraction)?mx(0,mn(1,ctx.usedFraction)):.04,uT=isFin(ctx.usedTokens)?ctx.usedTokens:rd(uf*mT),pct=rd(uf*100);
const model=ctx.model||sp.model||'Antigravity Model',tot=sp.taskUsage?.total?.totalTokens??sp.tokens?.totalTokens??sp.cache?.totalTokens??sp.totalTokens??0,hit=isFin(sp.cache?.hitRate)?sp.cache.hitRate:sp.cacheHitRate,subs=Number(sp.taskUsage?.subagents||0);
if(sn?.collection?.state==='processing')sA(fbEl,'data-collection','processing');else rA(fbEl,'data-collection');
const t=gStr();sLb(sr);
sT('rounds',sp.rounds>0?`${sp.rounds}r`:'—');sT('tps',isFin(sp.tps)&&sp.tps>0?sp.tps.toFixed(1):'—');
sT('cache-total',`${fmtTok(tot>0?tot:uT)} tok`);sT('cache-rate',isFin(hit)?`${(hit*100).toFixed(1)}%`:'—');
const sb=gE('subagent-badge');if(sb){if(subs>0){sb.hidden=false;const bt=t.agents(subs);if(sb.textContent!==bt)sb.textContent=bt;}else sb.hidden=true;}
sT('context-percent',`${pct}%`);sT('ttft',isFin(sp.ttftSeconds)?`${sp.ttftSeconds.toFixed(2)}s`:'—');
sT('latest-rate',isFin(sp.latestTps)?`${sp.latestTps.toFixed(1)} tok/s`:'—');
sT('context-summary',t.summary(pct,mx(0,100-pct)));sT('context-tokens',`${fmtTok(uT)} / ${fmtTok(mT)} tok`);sT('context-model',model);
const nE=gE('context-note');if(nE){nE.hidden=true;if(nE.textContent)nE.textContent='';}
const fl=gE('context-fill');if(fl?.style)fl.style.width=`${pct}%`;
gE('context-ring')?.style?.setProperty?.('--used-angle',`${rd(uf*360)}deg`);
const qGs=Array.isArray(sn?.groups)&&(sn.groups.length||sn.connection!==LE)?(it.lastGroups=sn.groups):it.lastGroups;
const g=qGrp(qGs,model,gW()),gn=g?.name||g?.id||'',w5=qWin(g?.windows?.['5h']||g?.fiveHour),wW=qWin(g?.windows?.weekly||g?.weekly);
let s5=!!w5,sW=!!wW;if(qm!=='both'&&w5&&wW){if(wW.r<w5.r)s5=false;else sW=false;}
const setQ=(chip,id,w0,lbl,vis)=>{
if(!chip)return;
if(!w0){chip.hidden=true;rA(chip,DW);rA(chip,'title');sT(id,'—');return;}
const p=rd(w0.r*100),e=qEta(w0.t);
chip.hidden=!vis;sT(id,`${p}%`);wLvl(chip,w0.r);sA(chip,'title',`${gn?gn+' · ':''}${lbl} ${p}%${e?` (${e})`:''}`);
};
setQ(it.fChip,'five-balance',w5,t.fiveShort,s5);setQ(it.wChip,'week-balance',wW,t.weekShort,sW);
if(!s5&&!sW)sA(fbEl,'data-no-q','1');else rA(fbEl,'data-no-q');
sA(fbEl,'data-quota-mode',qm);
for(const[id,w0]of[['context-five-quota',w5],['context-week-quota',wW]]){
const el=gE(id);if(!el)continue;
if(!w0){if(el.textContent!=='—')el.textContent='—';rA(el,DW);continue;}
const p=rd(w0.r*100),e=qEta(w0.t),txt=`${p}%${e?` · ${e}`:''}`;
if(el.textContent!==txt)el.textContent=txt;wLvl(el,w0.r);
}
const sR=isFin(sp.tps)&&sp.tps>0?`${sp.tps.toFixed(1)} tok/s`:isFin(sp.latestTps)&&sp.latestTps>0?`${sp.latestTps.toFixed(1)} tok/s`:'',sF=isFin(sp.ttftSeconds)?`TTFT ${sp.ttftSeconds.toFixed(2)}s`:'';
sT('context-speed',sR&&sF?`${sR} · ${sF}`:sR||sF||'—');
const cH=isFin(hit)?`${(hit*100).toFixed(1)}%`:'',cS=subs>0?t.agents(subs):'';
sT('context-cache',cH&&cS?`${cH} · ${cS}`:cH||cS||'—');
emitB(gW(),{event:'render',data:sn,host:fbEl,[CK]:it.cid});
};

const HA_S='.agy-home,aside,'+TI('conversation-list-sidebar')+','+TI('conversation-row-sidebar')+',[hidden],[inert]';
const iHA=e=>!e||e.hidden===true||e.style?.display==='none'||!!e.closest?.(HA_S);
const iTW=p=>{if(!p)return true;const c=String(p.className||'').trim();return!!(c&&/\bmin-w-0\b/.test(c)&&!/\b(?:flex|inline-flex|agy-composer-footer)\b/.test(c));};
const fAn=(d,kC=false)=>{
if(!d)return[];const w=gW();if(!kC&&!isConv(d,w))return[];
const out=[],sn=new Set(),bm=new Map(),iF=e=>/\bagy-composer-footer\b/.test(String(e.className||''));
for(const ft of qAll(d,FT_S)){
if(!ft||sn.has(ft)||iHA(ft)||(!kC&&!isConv(d,w,ft)))continue;
const bx=ft.closest?.(IB_S)||null;
if(bx){const pv=bm.get(bx);if(pv){if(iF(ft)&&!iF(pv)){const i=out.indexOf(pv);if(i>=0)out[i]=ft;sn.delete(pv);sn.add(ft);bm.set(bx,ft);}continue;}bm.set(bx,ft);}
sn.add(ft);out.push(ft);
}
if(out.length)return out;
for(const mb of qAll(d,MS_S)){const a=mb?.parentElement;if(a&&!sn.has(a)&&!iHA(mb)&&!iTW(a)&&(kC||isConv(d,w,mb))){sn.add(a);out.push(a);}}
return out;
};
const hAA=(d,kC=false)=>{
if(!d)return false;const w=gW();if(!kC&&!isConv(d,w))return false;
const ft=qS(d,FT_S);if(ft&&!iHA(ft)&&(kC||isConv(d,w,ft)))return true;
const mb=qS(d,MS_S),a=mb?.parentElement;return!!(a&&!iHA(mb)&&!iTW(a)&&(kC||isConv(d,w,mb)));
};
const sIn=(anc,el)=>{
if(!anc||!el)return false;const k=anc.children||[];
if(/\bagy-composer-footer\b/.test(String(anc.className||''))&&k.length>=2&&isFn(anc.insertBefore)){const l=k[k.length-1];if(l&&l!==el){anc.insertBefore(el,l);return true;}}
anc.appendChild(el);return true;
};

const aCh=it=>[it.fChip,it.wChip,it.cChip,it.sChip,it.xChip];
const clC=(it,nt=false)=>{
if(!it)return false;cHv(it);it.pinned=null;it.hoverOpen=false;
if((!it.xCard||it.xCard.hidden)&&(!it.sCard||it.sCard.hidden))return false;
if(it.xCard){it.xCard.hidden=true;clrCF(it.xCard);}if(it.sCard){it.sCard.hidden=true;clrCF(it.sCard);}
for(const c of aCh(it))sA(c,AE_A,'false');
if(nt)emitB(gW(),{event:'card',host:it.host,open:false});
if(pTm!==null)sPl();
return true;
};
const opC=(it,cd,b,pn)=>{
if(!it||!cd)return;cHv(it);aH=it.host;
for(const o of IS.values())if(o!==it)clC(o,false);
it.sCard.hidden=it.xCard.hidden=true;
for(const c of aCh(it))sA(c,AE_A,'false');
cd.hidden=false;if(b)sA(b,AE_A,'true');
it.pinned=pn?cd:null;it.hoverOpen=!pn;fitC(it,cd);void rIn(it);
emitB(gW(),{event:'card',host:it.host,open:true,data:it.snap||lS});
const rf=gW()?.requestAnimationFrame;isFn(rf)?rf(()=>fitC(it,cd)):stTm(()=>fitC(it,cd),0);
if(pTm!==null)sPl();
};
const eDC=d=>{if(!dOff&&d&&isFn(d.addEventListener))dOff=on(d,'click',ev=>{for(const it of IS.values())if(ev?.target!==it.host&&!it.host.contains?.(ev?.target))clC(it,true);});};
const iSR=(it,rC,rG,ml)=>{
if(IS.get(it.anc)!==it||!iC(gD(),it.host)||rG!==it.reqGen)return true;
if(rC&&it.cid&&it.cid!==rC)return true;
const lc=dCd(it.host,ml);return!!(rC&&lc&&lc!==rC);
};
const rIn=async it=>{
const d=gD();if(!it||!d||!iC(d,it.host)||md==='off')return null;
const ml=IS.size>1,cid=dCd(it.host,ml);
if(cid!==it.cid){it.cid=cid;it.reqGen++;}
const rg=it.reqGen,sn=await rSF(cid||`__inst_${rg}`,{[CK]:cid,force:false,[IK]:iCO(it)},it.host);
if(!iSR(it,cid,rg,ml)&&!(sn&&sn===it.snap&&it.pAt&&N0()-it.pAt<30000))apSn(it,sn);
return sn;
};

const cBI=(d,anc)=>{
const E=(t,a,k)=>mk(d,t,a,k),host=E('div',HOST_ATTRS);
if(!isFn(host.attachShadow))return null;
const sr=host.attachShadow({mode:'open'});sr.appendChild(E('style',{text:SHADOW_CSS}));
const t0=gStr(),btn=(c,k,ex)=>E('button',{type:'button',cls:'chip','data-card':c,...ex},k),dl=rows=>E('dl',null,rows.flatMap(([k,id])=>[E('dt',{'data-fb-i18n':k,text:t0[k]}),E('dd',{id,text:'—'})]));
const qChip=(k,k2,id)=>btn(k,[E('span',{'data-i18n':k,'data-fb-i18n':k2,text:t0[k2]}),E('strong',{id,text:'—'})],{[AE_A]:'false',hidden:true});
const fChip=qChip('five','fiveShort','five-balance'),wChip=qChip('week','weekShort','week-balance'),
sChip=btn('speed',[E('span',{cls:'rounds dim',id:'rounds',text:'—'}),E('strong',{id:'tps',text:'—'}),E('span',{cls:'dim',text:'tok/s'})]),
cChip=btn('cache',[E('span',{cls:'cache-total',id:'cache-total',text:'—'}),E('span',{cls:'sub-badge',id:'subagent-badge',hidden:true,text:''}),E('span',{cls:'dim',text:'·'}),E('span',{'data-i18n':'cache','data-fb-i18n':'cache',text:t0.cache}),E('strong',{id:'cache-rate',text:'—'})],{[AE_A]:'false'}),
xChip=btn('context',[E('span',{cls:'context-ring',id:'context-ring'}),E('span',{cls:'context-label dim','data-i18n':'contextShort',text:'Ctx'}),E('strong',{id:'context-percent',text:'0%'})],{[AE_A]:'false'}),
sCard=E('section',{cls:'card',id:'speed-card',hidden:true},[E('div',{cls:'heading'},[E('span',{'data-fb-i18n':'speedHeading',text:t0.speedHeading})]),dl([['ttft','ttft'],['latestRate','latest-rate']])]),
xCard=E('section',{cls:'card context-card',id:'context-card',hidden:true},[E('div',{cls:'heading'},[E('span',{'data-fb-i18n':'ctxHeading',text:t0.ctxHeading})]),E('strong',{id:'context-summary',text:t0.summary(0,100)}),E('p',{id:'context-tokens',text:'— / 512K tok'}),E('div',{cls:'track',id:'context-track'},[E('i',{id:'context-fill'})]),dl([['curModel','context-model'],['fiveQuota','context-five-quota'],['weekQuota','context-week-quota'],['speedHeading','context-speed'],['cache','context-cache']]),E('p',{cls:'footnote',id:'context-note',hidden:true,text:''})]);
sr.appendChild(E('div',{cls:'bar'},[fChip,wChip,sChip,cChip,xChip]));sr.appendChild(sCard);sr.appendChild(xCard);

const it={...mkTier(anc,host),sr,fChip,wChip,sChip,cChip,xChip,sCard,xCard,pinned:null,hoverOpen:false,hOpenTm:null,hCloseTm:null,cid:null,snap:null,lastGroups:null,reqGen:0};
const mA=()=>{aH=host;};on(host,'pointerdown',mA);on(host,'focusin',mA);
const tg=(cd,b)=>{if(!cd.hidden&&it.pinned===cd)clC(it,true);else opC(it,cd,b,true);};
const oE=b=>{it.hCloseTm=cT(it.hCloseTm);if(!it.pinned&&xCard.hidden&&it.hOpenTm===null&&md!=='off')it.hOpenTm=stTm(()=>{it.hOpenTm=null;if(md!=='off'&&iC(gD(),it.host)&&!it.pinned&&xCard.hidden)opC(it,xCard,b,false);},HOM);};
const oL=()=>{it.hOpenTm=cT(it.hOpenTm);if(!it.pinned&&it.hoverOpen&&!xCard.hidden&&it.hCloseTm===null)it.hCloseTm=stTm(()=>{it.hCloseTm=null;if(!it.pinned&&it.hoverOpen&&!xCard.hidden)clC(it,true);},HCM);};
const oCE=()=>{it.hCloseTm=cT(it.hCloseTm);};
const oCD=()=>{if(it.hoverOpen&&!xCard.hidden){cHv(it);it.pinned=xCard;it.hoverOpen=false;}};
for(const c of aCh(it)){for(const ev of['pointerenter','mouseenter'])on(c,ev,()=>oE(c));for(const ev of['pointerleave','mouseleave'])on(c,ev,oL);on(c,'click',e=>{e?.stopPropagation?.();tg(c===sChip?sCard:xCard,c);});}
for(const ev of['pointerenter','mouseenter'])on(xCard,ev,oCE);for(const ev of['pointerleave','mouseleave'])on(xCard,ev,oL);on(xCard,'pointerdown',oCD);on(xCard,'click',()=>stTm(()=>fitC(it,xCard),0));

sIn(anc,host);IS.set(anc,it);IH.set(host,it);syH(host);atT(it);
const iCid=dCd(host,IS.size>1);
if(iCid){it.cid=iCid;const c=gCS(iCid);if(c)apSn(it,c);}
return it;
};

const recB=d=>{
const w=gW();if(!d||!w)return{mounted:false,added:[],reseated:[]};
const ancs=fAn(d,true),aS=new Set(ancs);
for(const[a,it]of[...IS.entries()])if(!aS.has(a)||!iC(d,a))dIn(it,true);
const added=[],reseated=[];
for(const a of ancs){
const ex=IS.get(a);
if(ex){if(!iC(d,ex.host)||ex.host.parentElement!==a)try{sIn(a,ex.host);reseated.push(ex);}catch{}atT(ex);}
else{const cr=cBI(d,a);if(cr)added.push(cr);}
}
syPI();pOr(d);
if(IS.size){cET();eDC(d);enCW(d);yld=false;}else{if(dOff){try{dOff();}catch{}dOff=null;}clCW();cBs();cPl();}
for(const x of added)emitB(w,{event:'mount',host:x.host});
for(const x of reseated)emitB(w,{event:'mount',host:x.host});
return{mounted:IS.size>0,added,reseated};
};

const iHP=e=>{
if(!e||e.tagName==='BODY'||e.tagName==='HTML')return false;
const h=(n,k)=>!!n?.hasAttribute?.(k),f=e.firstElementChild;
return h(e,HC_A)||h(f,HC_A)||h(f?.firstElementChild,HC_A)||(h(e,'data-base-ui-portal')&&!!qS(e,'['+HC_A+']'));
};
const ignNd=t=>{const e=t?.nodeType===1?t:t?.parentElement;return!!(e&&(iHP(e)||(e.closest&&!e.closest(FT_S)&&e.closest(IGN_S))));};
const aChg=d=>{
const a=fAn(d,true);if(a.length!==IS.size)return true;
for(const x of a){const it=IS.get(x);if(!it||!iC(d,it.host)||it.host.parentElement!==x)return true;}
return false;
};

const rBT=n=>{const b=n?.closest?.(IB_S),ed=(b&&qS(b,'[contenteditable="true"],textarea,input'))||n;return String(ed?.value??ed?.innerText??ed?.textContent??'').replace(/\u200B/g,'').trim();};
const hBs=d=>{const e=qS(d,BSY_S);return!!(e&&e.hidden!==true&&e.style?.display!=='none');};
const iCD=(b,s)=>{
const x=s?.speed?.context;if(!x||s?.connection===LE)return false;
const u=isFin(x.usedTokens)?x.usedTokens:null,f=isFin(x.usedFraction)?x.usedFraction:null,c=!!(x.compacted||x.estimatedAfterCompaction);
return(c&&(!b||!b.c||(u!==null&&b.u!==null&&u<b.u*.85)))||(b&&b.u>0&&u!==null&&u<b.u*.72)||!!(b&&b.f>.15&&f!==null&&f<b.f-.12);
};
const armB=(sc=null,cH=null,ds=null)=>{
if(md==='off'||iBl()||!IS.size)return false;
const b=sc?gBV(sc):null,ins=(b&&IH.get(b))||actIn();
const cid=(isStr(cH)&&GRE.test(cH)?cH:null)||dCd(sc||ins?.host,IS.size>1)||ins?.cid||null;
const p=ins?.snap?.speed?.context||(cid&&SC.get(cid)?.speed?.context)||lS?.speed?.context,sq=ds?.length?ds:BST;
cBs();const gn=bGen;bCid=cid;
bBase=p?{u:isFin(p.usedTokens)?p.usedTokens:null,f:isFin(p.usedFraction)?p.usedFraction:null,c:!!(p.compacted||p.estimatedAfterCompaction)}:null;
const tk=()=>{
if(gn!==bGen)return;
bTm=null;if(md==='off'||iBl()||!IS.size)return cBs();
const tg=bCid;
void refresh({immediate:true,freshContext:true,cascadeId:tg}).then(s=>{
if(gn!==bGen||bCid!==tg)return;
if(iCD(bBase,s)||bIdx>=sq.length)return cBs();
bTm=stTm(tk,sq[bIdx++]);
}).catch(()=>{if(gn===bGen)cBs();});
};
bTm=stTm(tk,sq[bIdx++]);return true;
};
const enCW=d=>{
const w=gW();if(cOff||!d||md==='off')return;
wBsy=hBs(d);
const hP=()=>pCmpAt&&N0()-pCmpAt<4000;
const u=[
on(d,'keydown',ev=>{if(md!=='off'&&ev?.key==='Enter'&&!ev.shiftKey&&!ev.ctrlKey&&!ev.altKey&&!ev.metaKey&&!ev.isComposing){const t=ev.target;if(t?.closest?.(IB_S+',[contenteditable="true"],textarea')){const x=rBT(t);if(CMP_RE.test(x)||(hP()&&(!x||CMP_RE.test(x)))){pCmpAt=0;armB(t);}}}},true),
on(d,'click',ev=>{const t=ev?.target;if(md==='off'||!t?.closest)return;const o=t.closest(SLO_S);if(o&&/^\s*\/?compact(?:\s|$)/i.test(String(o.textContent||''))){pCmpAt=N0();armB(t,null,[700,1100,1500,2000]);return;}const b=t.closest(SND_S);if(b&&(CMP_RE.test(rBT(b))||hP())){pCmpAt=0;armB(b);}},true),
on(w,'ag-prism:compact',ev=>{if(md!=='off')armB(null,ev?.detail?.conversationId||null,ev?.detail?.delays||null);}),
];
cOff=()=>{for(const f of u)f();};
};

const sSR=tC=>{cPl();cSw();cBs();swTm=stTm(()=>{swTm=null;if(md!=='off'&&IS.size)void refresh({immediate:true,cascadeId:tC}).finally(()=>{if(IS.size&&md!=='off'&&!iBl())sPl();});},SWM);};
const chkSw=(d,w,fR=false)=>{
const cH=rRK(w),uC=cH!==lHr,cU=eUC(w),uU=!!(cU&&cU!==lUC);
if(uC)lHr=cH;if(cU)lUC=cU;
if(!IS.size)return false;
const ml=IS.size>1;let sw=false,tC=null;
for(const it of IS.values()){
if(!iC(d,it.host))continue;
const nC=!ml&&(fR||uU)&&cU?cU:dCd(it.host,ml);
if(nC!==it.cid){sw=true;tC=nC;it.cid=nC;it.reqGen++;const c=nC?gCS(nC):null;if(c)apSn(it,c);}
else if(fR&&uC){sw=true;tC=nC;it.reqGen++;}
}
if(sw)sSR(tC);
return sw;
};

const clrH=(f,u)=>{yld=false;if(u||IS.size)uFb(true);if(md==='auto')sEx();else if(md!=='off')hdEx(f);};
const eSO=()=>{
const w=gW(),d=gD();if(!w||!d||md==='off')return;
if(!lHr)lHr=rRK(w);if(!lUC)lUC=eUC(w)||'';
const rH=()=>{
hTm=null;lHlAt=N0();if(md==='off')return;
const dc=gD(),wn=gW();if(!dc||!wn)return;
if(!isConv(dc,wn)){clrH(false,0);return;}
if(md==='on')hdEx(true);else{sEx();if(hEx(null,true)){yld=true;if(IS.size)uFb(true);eTO();return;}}
if(IS.size){const r=recB(dc),sw=chkSw(dc,wn,false);if(r.added.length&&!sw)void refresh();else if(IS.size)eTO();}
else if((md==='on'||wTm===null)&&fAn(dc,true).length)mFb();
};
const sH=(f=false)=>{if(md!=='off'&&hTm===null)hTm=stTm(rH,f||N0()-lHlAt>=180?45:180);};
if(!sObs&&(d.body||d.documentElement)){
sObs=subMo('pulse-seat',d.body||d.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:[CID_A]},rs=>{
if(md==='off')return;
if(Array.isArray(rs)&&rs.length){
const iA=l=>{if(l)for(let j=0;j<l.length;j++)if(!ignNd(l[j]))return false;return true;};
let rl=false;
for(const r of rs){const a=r?.addedNodes,rm=r?.removedNodes;if(r?.type==='attributes'&&r?.attributeName===CID_A){rl=true;break;}if(ignNd(r?.target)||(((a?.length||0)+(rm?.length||0))&&iA(a)&&iA(rm)))continue;rl=true;break;}
if(!rl)return;
}
const inC=isConv(d,w);let bs=null;
const gB=()=>bs||(bs=fEB(d)),vB=b=>b&&gA(b,HA)!=='1';
if(!inC){if(IS.size||gB().some(md==='auto'?b=>b&&gA(b,HA)==='1':vB))sH(true);return;}
if(IS.size){
if(md==='auto'&&hEx(gB(),true)){sH(true);return;}
const nB=hBs(d);
if(wBsy&&!nB){wBsy=false;armB(null,null,[180,650,1100]);}else wBsy=nB;
const sw=chkSw(d,w,false);if(aChg(d)){sH(sw);return;}if(sw)return;
}else if(wTm===null&&!hEx(gB(),true)&&hAA(d,true)){sH(true);return;}
if(hTm!==null)return;
const eMT=gB().some(b=>vB(b)&&b.shadowRoot&&!qS(b.shadowRoot,`style[${TSA}="1"]`));
let dE=false;for(const a of ET.keys())if(!iC(d,a)){dE=true;break;}
if(dE||eMT||(md==='on'&&gB().some(b=>vB(b)&&gA(b,FA)!=='1')))sH(false);
},'low');
}
if(!pOff){
const oR=()=>{if(md==='off')return;const dc=gD(),wn=gW();if(!dc||!wn)return;if(!isConv(dc,wn)||!IS.size){sH(true);return;}chkSw(dc,wn,true);if(aChg(dc))sH(true);};
const os=[isFn(w.addEventListener)?on(w,'popstate',oR):null,isFn(w.addEventListener)?on(w,'hashchange',oR):null,subHistory(w,oR)].filter(Boolean);
if(os.length)pOff=()=>{for(const f of os)try{f();}catch{}};
}
};

async function refresh(opts){
const w=gW(),d=gD();
if(!envOpts&&w?.__agPrismTelemetry&&w.__agPrismTelemetry!==api){uFb();return null;}
if(!isConv(d,w)){clrH(false,1);return null;}
if(md==='on')hdEx(true);else{sEx();if(hEx(null,true)){yld=true;uFb(true);eTO();return null;}}
if(md!=='off'&&(IS.size||((md==='on'||!hEx(null,true))&&wTm===null&&fAn(d,true).length)))recB(d);
if(!IS.size)return null;
if(opts?.immediate)cSw();
eTO();
const lv=[...IS.values()].filter(it=>iC(d,it.host));if(!lv.length)return null;
wBsy=hBs(d);
const ml=lv.length>1,fc0=!!opts?.force,fc=!!opts?.freshContext,iP=!!opts?.poll,hC=!ml&&isStr(opts?.cascadeId)&&GRE.test(opts.cascadeId)?opts.cascadeId:null;
const rBK=new Map(),pl=[];
for(let i=0;i<lv.length;i++){
const it=lv[i],nC=hC||dCd(it.host,ml);
if(nC!==it.cid){it.cid=nC;it.reqGen++;const c=nC?gCS(nC):null;if(c)apSn(it,c);}
else if(fc)it.reqGen++;
const key=it.cid||`__pane_${i}`,op=iCO(it);
pl.push({it,rC:it.cid,rG:it.reqGen,key});
if(!rBK.has(key))rBK.set(key,rSF(key,{[CK]:it.cid,force:fc0,[IK]:op,...(fc?{freshContext:true}:{}),...(iP&&!fc0&&!fc?{maxAgeMs:(op||wBsy)?2400:4500}:{})},it.host));
}
const sns=new Map();
await Promise.all([...rBK.entries()].map(async([k,p])=>{sns.set(k,await p);}));
let aS=null;const act=actIn();
for(let i=0;i<pl.length;i++){
const{it,rC,rG,key}=pl[i],sn=sns.get(key)||null;
if(iSR(it,rC,rG,ml))continue;
if(!(sn&&sn===it.snap&&it.pAt&&N0()-it.pAt<30000))apSn(it,sn);
if(it===act||(!act&&i===0))aS=sn;
}
return aS??lS;
}

function mFb(){
const w=gW(),d=gD();
if(!w||!d||(typeof d.attachShadow==='undefined'&&!isFn(d.createElement)))return false;
if(!envOpts&&w.__agPrismTelemetry&&w.__agPrismTelemetry!==api){uFb();return false;}
if(md==='off')return false;
if(!isConv(d,w)){clrH(false,1);eSO();return false;}
if(md==='on')hdEx(true);else if(hEx(null,true)){yld=true;uFb(true);eSO();return false;}
const r=recB(d);eSO();if(!r.mounted)return false;
eHs();eTO();eBl();lHr=rRK(w);lUC=eUC(w)||'';
if(r.added.length||pTm===null){void refresh();sPl();}
return true;
}

const getBars=()=>{const d=gD(),o=[];for(const it of IS.values())if(iC(d,it.host))o.push(it.host);return o;};
const gBV=n=>{
const d=gD();if(!n||!d)return null;
const x=IH.get(n);if(x&&iC(d,x.host))return x.host;
const s=CV_S+','+IB_S+',.agy-composer-footer',cv=n.matches?.(s)?n:n.closest?.(s);
if(cv){
for(const it of IS.values())if(iC(d,it.host)&&(cv===it.anc||cv.contains?.(it.anc)||it.anc.contains?.(cv)))return it.host;
const ex=qS(cv,`#${BI},[data-ag-pulse-bar="true"]`);if(ex&&uEx(d,ex))return ex;
}
return null;
};
const setActiveBar=t=>{
const d=gD();if(!t){aH=null;return null;}
const h=IH.has(t)?t:gBV(t);if(!h||!iC(d,h))return null;
aH=h;emitB(gW(),{event:'focus',host:h,data:IH.get(h)?.snap||lS});return h;
};
const getSnapshotForBar=x=>{
if(!x)return actIn()?.snap||lS;
if(isStr(x))return SC.get(x)||lS;
const it=IH.get(x)||IH.get(gBV(x));
return it?.snap||(it?.cid&&SC.get(it.cid))||lS;
};
const getState=()=>{
const d=gD();let n=0;for(const it of IS.values())if(iC(d,it.host))n++;
const m=n>0,bl=iBl();if(m&&bl&&pTm!==null){pSp=true;cPl();}
return{mode:md,quotaMode:qm,mountedFallback:m,mountedCount:n,waitingForExternal:wTm!==null,yieldedToExternal:!!(md==='auto'&&(yld||hEx())),hasExternal:hEx(),pollSuspended:!!(m&&(pSp||bl)),pollIntervalMs:m&&pTm!==null?gPM():0};
};

function sync(cfg){
if(cfg&&isStr(cfg.language)&&cfg.language)eLng=cfg.language.trim().toLowerCase()==='auto'?'':normFbLang(cfg.language,gW());
const pQm=qm;
if(cfg&&Object.hasOwn(cfg,'telemetryQuotaMode'))qm=cfg.telemetryQuotaMode==='both'?'both':'compact';
else{const a=rdQm();if(a)qm=a;}
const raw=cfg?.telemetryModule;md=raw==='on'||raw==='off'?raw:'auto';
if(IS.size&&md!=='off')for(const it of IS.values()){sLb(it.sr);if(it.snap||lS)apSn(it,it.snap||lS);}
if(qm!==pQm&&md!=='off'&&(IS.size||ET.size))reT();
if(md==='off'){yld=false;uFb();hdEx();return getState();}
eBr();eSO();
const d=gD(),w=gW();
if(!isConv(d,w)){clrH(false,1);eHs();return getState();}
if(md==='on'){yld=false;cWt();hdEx(true);eHs();mFb();return getState();}
sEx();
if(hEx()){
yld=true;uFb(true);eHs();eTO();
if(dAt>0&&rTm===null)rTm=stTm(()=>{rTm=null;if(md!=='off'&&!hEx())mFb();},GM+60);
return getState();
}
if(IS.size){recB(d);if(IS.size)return getState();}
if(fEB(d).some(b=>b&&gA(b,FA)!=='1'&&iC(d,b)&&!uEx(d,b))){cWt();mFb();return getState();}
if(wTm===null)wTm=stTm(wTD,isFin(cfg?.__fallbackDelayMs)&&cfg.__fallbackDelayMs>=0?cfg.__fallbackDelayMs:WM);
return getState();
}
function wTD(){
wTm=null;if(md!=='auto')return;
if(!isConv(gD(),gW())){clrH(false,1);return;}
if(hEx()){yld=true;uFb(true);eHs();eTO();return;}
mFb();
}
function destroy(){
cWt();cSw();cBs();clCW();cSt();uFb();sEx();SC.clear();IF.clear();LM.clear();
const w=gW();if(w){w.__agPrismMetricsLast?.clear?.();if(mApi&&w.__agPrismMetricsBridge===mApi)delete w.__agPrismMetricsBridge;if(mRes&&w.__agPrismMetricsResolve===mRes)delete w.__agPrismMetricsResolve;}
yld=false;lSg='';dAt=0;lS=null;lHr='';lUC='';pxM=false;
}

const notifyCompact=(cid=null,delays=null)=>armB(null,cid,delays);
const api={BAR_ID:BI,PRISM_BAR_ID:PI,PRISM_BAR_ATTR:PA,FALLBACK_ATTR:FA,METRICS_BINDING:MB,sync,destroy,refresh,notifyCompact,qKind,chooseQuotaGroupFallback,getLatestSnapshot:()=>actIn()?.snap||lS,getSnapshotForBar,getBars,getPrimaryBar:()=>gPI()?.host||null,getActiveBar:()=>actIn()?.host||null,setActiveBar,getBarForView:gBV,getState,createTelemetryController};
return api;
}

return createTelemetryController();
});
