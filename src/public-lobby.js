// Public discovery has no player/manager identity, balances, lyrics or writes.
export const LOBBY_VERSIONS=[['','全部版本'],['original','原版（原唱）'],['cover','翻唱'],['dj','DJ版'],['live','LIVE版'],['remix','改編版'],['other','其他']];
const loginIntent=href=>{const p=new URL(href).searchParams;return p.getAll('portalLogin').length===1&&['player','admin'].includes(p.get('portalLogin'))?p.get('portalLogin'):null;};
const lobbySlug=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(v);
const lobbyText=(v,max=100)=>typeof v==='string'?v.trim().slice(0,max):'';
const lobbyPage=v=>Number.isSafeInteger(Number(v))&&Number(v)>=0?Math.min(833,Number(v)):0;
export function lobbyQuery(href){
 const p=new URL(href).searchParams;
 return {q:lobbyText(p.get('q')),language:lobbyText(p.get('language')),performerType:lobbyText(p.get('performerType')),
  versionKind:LOBBY_VERSIONS.some(([v])=>v===p.get('versionKind'))?p.get('versionKind'):'',
  sort:p.get('sort')==='oldest'?'oldest':'newest',page:lobbyPage(Number(p.get('page')||1)-1),roomQ:lobbyText(p.get('roomQ')),roomPage:Math.min(500,lobbyPage(Number(p.get('roomPage')||1)-1))};
}
export function lobbyLocation(href,query){
 const u=new URL(href),intent=loginIntent(href);u.search='';u.hash='';if(intent)u.searchParams.set('portalLogin',intent);
 for(const key of ['q','language','performerType','versionKind','roomQ'])if(query[key])u.searchParams.set(key,lobbyText(query[key]));
 if(query.sort==='oldest')u.searchParams.set('sort','oldest');
 for(const key of ['page','roomPage'])if(query[key]>0)u.searchParams.set(key,String(query[key]+1));
 return u.href;
}
export function lobbyRoomDestination(base,room,songId,kind){
 if(!lobbySlug(room?.slug))throw Error('主播入口尚未確認');
 if(songId!==undefined&&(typeof songId!=='string'||!songId||songId.length>200||!['live','saved'].includes(kind)))throw Error('歌曲入口尚未確認');
 const mount=new URL('../',import.meta.url),source=new URL(base),root=source.pathname.endsWith('/lobby.html')?new URL('./',source):source.origin===mount.origin?new URL(mount.pathname,source):new URL('/',source);const u=new URL('v2.html',root),intent=loginIntent(base);u.search='';u.hash=songId?'book':'home';u.searchParams.set('streamer',room.slug);if(intent)u.searchParams.set('portalLogin',intent);
 if(songId){u.searchParams.set('commonRequest',songId);u.searchParams.set('commonKind',kind);}
 return u.href;
}
const lobbyEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function lobbyPager(kind,total,page,size){
 const max=Math.max(1,Math.ceil(total/size)),e=lobbyEscape;
 return '<div class="pagination" data-lobby-pagination="'+kind+'"><button type="button" data-lobby-page="'+kind+'" data-page="'+(page-1)+'" '+(page?'':'disabled')+'>上一頁</button><label class="page-jump">第 <input type="number" min="1" max="'+max+'" value="'+(page+1)+'" data-lobby-jump="'+e(kind)+'" aria-label="'+(kind==='rooms'?'主播':'歌曲')+'頁碼"> 頁 / 共 '+max+' 頁</label><button type="button" data-lobby-jump-button="'+kind+'">跳頁</button><button type="button" data-lobby-page="'+kind+'" data-page="'+(page+1)+'" '+(page+1<max?'':'disabled')+'>下一頁</button></div>';
}
export function lobbyImageUrl(value){try{if(value==='assets/papa-singer-hero.jpg')return value;const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.href.length<=2048?u.href:'';}catch{return '';}}
export function lobbyRoomsHtml(value,base){
 const e=lobbyEscape;
 if(value.loading)return '<p role="status">讀取主播中…</p>';
 if(value.error)return '<p class="error" role="status">'+e(value.error)+'</p><button type="button" data-lobby-retry="rooms">重新讀取</button>';
 return '<div class="lobby-rooms">'+value.rows.map(r=>'<a class="lobby-room" href="'+e(lobbyRoomDestination(base,r))+'">'+(lobbyImageUrl(r.heroImage)?'<img class="lobby-room-image" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="'+e(lobbyImageUrl(r.heroImage))+'">':'')+'<span aria-hidden="true">🎤</span><strong>'+e(r.display_name)+'</strong><small>進入主播首頁 →</small></a>').join('')+'</div>'+(value.rows.length?'':'<p class="empty">沒有符合的聲瑪主播</p>')+lobbyPager('rooms',value.total,value.page,value.pageSize||20);
}
export function lobbySongsHtml(value,base){
 const e=lobbyEscape;
 if(value.loading)return '<p role="status">搜尋歌曲中…</p>';
 if(value.error)return '<p class="error" role="status">'+e(value.error)+'</p><button type="button" data-lobby-retry="songs">重新讀取</button>';
 return value.rows.map(f=>'<article class="common-family"><h3>《'+e(f.title)+'》</h3>'+(f.variants||[]).map(v=>'<section class="common-variant"><h4>'+e(v.artist)+' · '+e(v.versionLabel||'原版')+'</h4><p class="muted">'+e([v.language,v.performerType].filter(Boolean).join(' · '))+'</p>'+(v.streamers||[]).map(r=>'<div class="common-streamer"><a href="'+e(lobbyRoomDestination(base,r))+'">'+e(r.name)+'</a><div class="actions"><a class="lobby-button" href="'+e(lobbyRoomDestination(base,r,r.songId,'live'))+'">現點</a><a class="lobby-button" href="'+e(lobbyRoomDestination(base,r,r.songId,'saved'))+'">提歌</a></div></div>').join('')+'</section>').join('')+'</article>').join('')+(value.rows.length?'':'<p class="empty">沒有符合的廳內共同歌曲</p>')+lobbyPager('songs',value.total,value.page,12);
}
function lobbyResponse(value,kind){
 const limit=kind==='rooms'?20:12;
 if(!value||!Array.isArray(value.rows)||value.rows.length>limit||!Number.isSafeInteger(value.total)||value.total<0)throw Error('公開資料尚未確認，請重新讀取');
 if(kind==='rooms'){
  if(value.rows.some(r=>!lobbySlug(r?.slug)||typeof r.id!=='string'||!r.id||typeof r.display_name!=='string'))throw Error('主播資料尚未確認');
 }else if(value.rows.some(f=>typeof f?.title!=='string'||!Array.isArray(f.variants)||f.variants.some(v=>typeof v.artist!=='string'||!Array.isArray(v.streamers)||v.streamers.some(r=>!lobbySlug(r?.slug)||typeof r.name!=='string'||typeof r.songId!=='string'||!r.songId||r.songId.length>200))))throw Error('歌曲資料尚未確認');
 return value;
}
export function createPublicLobby({api,href,replaceLocation=()=>{},render,now=Date.now,roomPageSize=20}){
 if(!Number.isInteger(roomPageSize)||roomPageSize<1||roomPageSize>20)throw Error('主播分頁大小不正確');
 let query=lobbyQuery(href),closed=false;
 const generations={rooms:0,songs:0},cache=new Map(),pending=new Map(),rotationCache=new Map();
 const values={rooms:{rows:[],total:0,page:query.roomPage,loading:false,error:''},songs:{rows:[],total:0,page:query.page,loading:false,error:'',filters:{}}};
 const paint=kind=>{if(!closed)render(kind,{...values[kind],...(kind==='rooms'?{pageSize:roomPageSize}:{})}, {...query});};
 async function load(kind,force=false,automatic=false){
  if(closed)return;
  const page=kind==='rooms'?query.roomPage:query.page,g=++generations[kind];
  const body=kind==='rooms'?{op:'publicLobbyRooms',q:query.roomQ,page,...(roomPageSize===20?{}:{limit:roomPageSize})}:{op:'publicLobbySongs',q:query.q,language:query.language,performerType:query.performerType,versionKind:query.versionKind,sort:query.sort,limit:12,offset:page*12};
  const key=JSON.stringify(body);values[kind]={...values[kind],loading:true,error:'',page};paint(kind);
  try{
   const hit=(automatic?rotationCache.get(key):null)||cache.get(key),request=()=>{if(!pending.has(key))pending.set(key,Promise.resolve().then(()=>api(body)).finally(()=>pending.delete(key)));return pending.get(key);};
   const cached=!force&&hit&&(automatic||now()-hit.at<60000);
   const value=lobbyResponse(cached?hit.value:await request(),kind);
   if(closed||generations[kind]!==g)return;
   const max=Math.max(1,Math.ceil(value.total/(kind==='rooms'?roomPageSize:12)));
   if(page>=max){query={...query,[kind==='rooms'?'roomPage':'page']:max-1};replaceLocation(lobbyLocation(href,query));return load(kind,false,automatic);}
   if(!cached)cache.set(key,{value,at:now()});if(kind==='rooms'&&page<12)rotationCache.set(key,{value,at:hit&&cached?hit.at:now()});if(cache.size>12)cache.delete(cache.keys().next().value);
   values[kind]={...value,page,loading:false,error:''};paint(kind);
  }catch(error){if(!closed&&generations[kind]===g){values[kind]={...values[kind],rows:[],loading:false,error:error.message};paint(kind);}}
 }
 function update(changes){
  const next=lobbyQuery(lobbyLocation(href,{...query,...changes})),roomKeys=['roomQ','roomPage'],songKeys=['q','language','performerType','versionKind','sort','page'];
  if(['q','language','performerType','versionKind','sort'].some(k=>next[k]!==query[k]))next.page=0;
  if(next.roomQ!==query.roomQ){next.roomPage=0;rotationCache.clear();}
  const rooms=roomKeys.some(k=>next[k]!==query[k]),songs=songKeys.some(k=>next[k]!==query[k]);query=next;replaceLocation(lobbyLocation(href,query));
  return Promise.all([...(rooms?[load('rooms')]:[]),...(songs?[load('songs')]:[])]);
 }
 return {start:()=>Promise.all([load('rooms'),load('songs')]),update,retry:kind=>load(kind,true),state:()=>({...query}),roomSnapshot:()=>({...values.rooms,pageSize:roomPageSize}),async rotateRooms(){if(closed||values.rooms.loading||values.rooms.error||query.roomQ)return;const total=Math.max(1,Math.ceil(values.rooms.total/roomPageSize)),next=(query.roomPage+1)%Math.min(total,12);query={...query,roomPage:next};replaceLocation(lobbyLocation(href,query));return load('rooms',false,true);},stop(){closed=true;generations.rooms++;generations.songs++;}};
}

export function installPublicLobbyLifecycle({target=window,lobby,cancelSearch=()=>{}}){
 const hide=event=>{cancelSearch();if(!event.persisted)lobby.stop();};
 const show=event=>{if(event.persisted)lobby.start();};
 target.addEventListener('pagehide',hide);target.addEventListener('pageshow',show);
 return ()=>{target.removeEventListener('pagehide',hide);target.removeEventListener('pageshow',show);lobby.stop();};
}
