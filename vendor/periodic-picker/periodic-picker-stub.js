// Periodic Picker Stub (<2KB)
((G)=>{
'use strict';
const T='model-selector-trigger',S=`[data-testid="${T}"]`,K='__agPrismPeriodicStub',L='__agPeriodicFullLoaded',P='__agPeriodicPendingOpen';
const trig=n=>{if(!n||typeof n!=='object')return null;if(n.closest)try{return n.closest(S);}catch{}for(let i=0;n&&i<16;i++,n=n.parentNode)if(n.getAttribute?.('data-testid')===T)return n;return null;};
const req=(r,x)=>{const f=r?.__agPrismSetting||r?.__agClaudeStyleSetting;if(typeof f==='function')try{f(JSON.stringify({action:'request-periodic-picker',reason:x}));}catch{}};
const mountPeriodicPickerStub=(o={})=>{
const r=o.root||G,d=o.doc||r?.document,z=()=>{},mk=(status,mode)=>({destroy:z,getStatus:()=>({status,mode})});
if(!r||!d?.addEventListener)return mk('off','off');
if(r[L]===true)return mk('upgraded','on');
try{r[K]?.destroy?.();}catch{}
let dead=0,warm=0,cnt=0;
const alive=()=>!dead&&(r[L]!==true||(destroy(),false));
const onE=e=>{if(!alive()||!trig(e?.target))return;const t=Date.now();if(warm&&t-warm<2500)return;warm=t;cnt++;req(r,'prewarm');};
const onD=e=>{if(!alive()||(e&&((e.button!=null&&e.button!==0)||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey)))return;const el=trig(e?.target);if(!el)return;r[P]={trigger:el,pointerDownAt:Date.now(),autoOpen:true,releasedAt:0};cnt++;req(r,'pointerdown');};
const onU=()=>{const p=r[P];if(!dead&&p&&!p.releasedAt)p.releasedAt=Date.now();};
const bind=m=>[['mouseenter',onE],['pointerdown',onD],['pointerup',onU],['pointercancel',onU]].forEach(([k,h])=>{try{d[m+'EventListener'](k,h,true);}catch{}});
const destroy=()=>{if(dead)return;dead=1;bind('remove');if(r[K]===inst)try{delete r[K];}catch{}};
bind('add');
const inst={destroy,getStatus:()=>({status:dead?'destroyed':'stub',mode:dead?'off':'stub',prewarmed:warm>0,requestedCount:cnt})};
return(r[K]=inst);};
const api={TRIGGER_SELECTOR:S,mountPeriodicPickerStub};
if(typeof module<'u'&&module.exports)module.exports=api;
G.__agPrismPeriodicStubFactory=api;
})(typeof window<'u'?window:globalThis);
