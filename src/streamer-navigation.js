const routes=new Set(['home','book','common-book','center','gallery','admin']);
const playerTabs=new Set(['overview','favorites','ledger','queue','achievements','crowns','cards','wishes']);
const adminTabs=new Set(['queue','songs','players','ledger','crowns','cards','wishes','stats','events','medals','settings','activity','catalog','platform']);
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

// A room from the current server-projected public directory can use the
// existing public room route. URL Space hints never establish this scope.
// Unknown/private Spaces retain the authenticated entry flow unchanged.
export function publicStreamerDestination(href,slug,{currentRoom,rooms,mountUrl,...navigation}={}){
 const url=new URL(streamerDestination(href,slug,navigation));
 for(const key of ['streamerId','entityType','entityId','notificationId','commonRequest','commonKind'])url.searchParams.delete(key);
 const target=Array.isArray(rooms)?rooms.find(room=>room?.slug===slug):null;
 if(!currentRoom?.id||!target?.id||target.active===false||currentRoom.spaceId!=='space-001'||target.spaceId!=='space-001'||!mountUrl)return url.href;
 const mount=new URL(mountUrl),source=new URL(href),base=mount.pathname.replace(/\/$/,'');
 if(source.origin!==mount.origin||source.searchParams.get('streamer')!==currentRoom.slug||!['/','/index.html','/v2.html','/preview.html'].some(file=>source.pathname===base+file)||source.searchParams.has('spaceId')&&source.searchParams.get('spaceId')!=='space-001')return url.href;
 url.searchParams.delete('space');url.searchParams.delete('spaceId');
 return url.href;
}
