// Hall homepage theme. One small public read, cached on the device for five
// minutes so repeated visits reuse it; no polling and no Realtime channel.
import {themeNormalize} from './theme-engine.js?v=10.28-THEME.1';
import {themeApply,themeClear,themeBannerImageStyle,themeDecorHtml} from './theme-render.js?v=10.28-THEME.1';

const LOBBY_THEME_TTL=5*60*1000;
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderLobbyTheme(document,theme,{hallName=''}={}){
 const root=document.documentElement,main=document.querySelector('main'),intro=document.querySelector('.lobby-intro');
 document.querySelector('.theme-hall-banner')?.remove();main?.querySelector(':scope>.theme-decor-layer')?.remove();
 if(intro)intro.hidden=false;
 if(!theme){themeClear(root);delete root.dataset.homeTheme;main?.classList.remove('theme-home-host');return;}
 const t=themeNormalize(theme,{hall:true});themeApply(root,t,{hall:true});
 const banner=t.images.banner?.url;
 if(banner&&intro){
  const title=intro.querySelector('h1')?.textContent||hallName,lead=intro.querySelector('p.muted')?.textContent||'';
  intro.insertAdjacentHTML('beforebegin','<section class="theme-hall-banner"><img src="'+escape(banner)+'" alt="" fetchpriority="high" decoding="async" style="'+themeBannerImageStyle(t)+'"><div class="theme-hall-banner-text"><h1>'+escape(title)+'</h1>'+(lead?'<p class="muted">'+escape(lead)+'</p>':'')+'</div></section>');
  // The status line stays in place; only the duplicated title block is hidden.
  intro.querySelector('h1')?.setAttribute('hidden','');intro.querySelector('p.muted')?.setAttribute('hidden','');
 }else intro?.querySelectorAll('[hidden]').forEach(el=>el.removeAttribute('hidden'));
 const decor=themeDecorHtml(t,{escape});
 main?.classList.toggle('theme-home-host',!!decor);if(decor)main.insertAdjacentHTML('beforeend',decor);
}
export async function installLobbyTheme({api,spaceId,document,storage=globalThis.localStorage,now=()=>Date.now(),hallName=''}){
 const key='pa-hall-theme:'+spaceId;let cached=null;
 try{cached=JSON.parse(storage?.getItem(key)||'null');}catch{}
 if(cached&&typeof cached==='object')renderLobbyTheme(document,cached.theme||null,{hallName});
 if(cached&&now()-Number(cached.at)<LOBBY_THEME_TTL)return cached.theme||null;
 try{
  const r=await api({op:'publicHallTheme',spaceId});
  const changed=!cached||cached.revision!==r.revision||JSON.stringify(cached.theme||null)!==JSON.stringify(r.theme||null);
  try{storage?.setItem(key,JSON.stringify({at:now(),revision:r.revision,theme:r.theme||null}));}catch{}
  if(changed)renderLobbyTheme(document,r.theme||null,{hallName});
  return r.theme||null;
 }catch{return cached?.theme||null;/* The default hall look is always a safe fallback. */}
}
