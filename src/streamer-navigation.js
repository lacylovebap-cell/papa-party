const routes=new Set(['home','book','center','gallery','admin']);
const playerTabs=new Set(['overview','ledger','queue','crowns','cards','wishes']);
export const streamerName=room=>room?.display_name||'主播';
export const streamerText=(text,room)=>String(text||'').replace(/\{streamer\}|怕怕|帕帕/g,()=>streamerName(room));
export function streamerDestination(href,slug,{role,managedSlug,subtab,adminTab}={}){
 const url=new URL(href),route=url.hash.slice(1);url.searchParams.set('streamer',slug);
 url.hash=routes.has(route)?route:'home';
 if(route==='admin'&&role==='streamer_admin'&&slug!==managedSlug)url.hash='home';
 if(url.hash==='#center'&&playerTabs.has(subtab))url.searchParams.set('tab',subtab);else url.searchParams.delete('tab');
 if(url.hash==='#admin'&&adminTab)url.searchParams.set('adminTab',adminTab);else{url.searchParams.delete('adminTab');url.searchParams.delete('player');}
 return url.href;
}
