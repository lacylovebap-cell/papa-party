const routes=new Set(['home','book','common-book','center','gallery','admin']);
const playerTabs=new Set(['overview','favorites','ledger','queue','achievements','crowns','cards','wishes']);
const adminTabs=new Set(['queue','songs','players','ledger','crowns','cards','wishes','stats','events','medals','settings','activity','catalog']);
export function pageLocation(href,fallbackTab='queue'){
 const url=new URL(href),route=routes.has(url.hash.slice(1))?url.hash.slice(1):'home';
 const requested=url.searchParams.get('adminTab'),tab=adminTabs.has(requested)?requested:adminTabs.has(fallbackTab)?fallbackTab:'queue';
 const selectedPlayer=route==='admin'&&tab==='players'?url.searchParams.get('player'):null;
 return {route,tab,subtab:playerTabs.has(url.searchParams.get('tab'))?url.searchParams.get('tab'):'overview',selectedPlayer,queueHistory:url.searchParams.get('queue')==='history'};
}
export function pageDestination(href,{route,tab,subtab,selectedPlayer,queueHistory}={}){
 const url=new URL(href);url.hash=routes.has(route)?route:'home';
 // A consumed notification must not pull a later page reload back to its target.
 for(const key of ['entityType','entityId','notificationId'])url.searchParams.delete(key);
 const profile=route==='center'||route==='admin'&&tab==='players'&&selectedPlayer;
 for(const [key,value] of [['adminTab',route==='admin'&&adminTabs.has(tab)?tab:null],['tab',profile&&playerTabs.has(subtab)?subtab:null],['player',route==='admin'&&tab==='players'?selectedPlayer:null],['queue',route==='admin'&&tab==='queue'&&queueHistory?'history':null]]){
  if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);
 }
 return url.href;
}
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
