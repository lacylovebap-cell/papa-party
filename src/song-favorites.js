const SONG_FAVORITES_PAGE_LIMIT=20,SONG_FAVORITES_FLAGS_LIMIT=50;
function songFavoritesId(value){
 if(typeof value!=='string'||!value.trim()||value.length>128)throw Error('收藏歌曲編號不正確');
 return value;
}
function songFavoritesStrings(value,max=100){
 if(value==null)return [];
 if(!Array.isArray(value)||value.length>max)throw Error('收藏歌曲資料不正確');
 return Array.from(value,item=>{if(typeof item!=='string'||!item.trim()||item.length>1000)throw Error('收藏歌曲資料不正確');return item;});
}
function songFavoritesPage(response,roomId){
 if(!response||!Array.isArray(response.rows)||response.rows.length>SONG_FAVORITES_PAGE_LIMIT||!Number.isSafeInteger(response.total)||response.total<response.rows.length)throw Error('收藏歌單資料不正確');
 const ids=new Set(),rows=Array.from(response.rows,row=>{
  if(!row||typeof row!=='object'||Array.isArray(row))throw Error('收藏歌曲資料不正確');
  const songId=songFavoritesId(row.songId);
  if(ids.has(songId)||typeof row.title!=='string'||!row.title.trim()||row.title.length>1000||row.hidden===true||(row.streamer_id!==undefined&&row.streamer_id!==roomId)||(row.favorite!==undefined&&row.favorite!==true))throw Error('收藏歌曲資料不正確');
  ids.add(songId);
  const out={songId,title:row.title,artist:row.artist??'',tags:songFavoritesStrings(row.tags),favorite:true};
  for(const key of ['streamer_id','cat','artistType','murmur','shortMode','catalogVariantId','lyricsMode','version','favoritedAt'])if(row[key]!==undefined)out[key]=row[key];
  for(const key of ['artist','streamer_id','cat','artistType','murmur','shortMode','catalogVariantId','lyricsMode','version'])if(out[key]!==undefined&&(typeof out[key]!=='string'||out[key].length>1000))throw Error('收藏歌曲資料不正確');
  for(const key of ['new','hidden','hasLyrics','hasSharedLyrics','hasCustomLyrics'])if(row[key]!==undefined){if(typeof row[key]!=='boolean')throw Error('收藏歌曲資料不正確');out[key]=row[key];}
  if(row.pairSongIds!==undefined)out.pairSongIds=songFavoritesStrings(row.pairSongIds).map(songFavoritesId);
  if(row.creditCost!==undefined){if(typeof row.creditCost!=='number'||!Number.isFinite(row.creditCost)||!Number.isSafeInteger(row.creditCost*2)||row.creditCost<0.5||row.creditCost>=1000000)throw Error('收藏歌曲資料不正確');out.creditCost=row.creditCost;}
  if(row.plays!==undefined){if(!Number.isSafeInteger(row.plays)||row.plays<0)throw Error('收藏歌曲資料不正確');out.plays=row.plays;}
  if(out.favoritedAt!==undefined&&(typeof out.favoritedAt!=='string'||out.favoritedAt.length>100||!Number.isFinite(Date.parse(out.favoritedAt))))throw Error('收藏歌曲資料不正確');
  return out;
 });
 return {rows,total:response.total};
}
function songFavoritesFreeze(value){
 if(value&&typeof value==='object'){for(const child of Object.values(value))songFavoritesFreeze(child);Object.freeze(value);}
 return value;
}

// Reads and writes are explicit; page data and the recent flag cache are bounded.
export function createSongFavorites({api,context,onChange=()=>{},maxAgeMs=30000,now=Date.now}){
 if(typeof api!=='function'||typeof context!=='function'||typeof onChange!=='function'||typeof now!=='function'||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1)throw Error('收藏控制器設定不正確');
 const fresh=page=>({page,rows:[],total:0,loading:false,error:null,dirty:false,key:null,pending:null,at:null});
 let view=fresh(0),scope=null,generation=0,pageGeneration=0,flagsGeneration=0,flagsPending=null,flagsKey=null,flagsAt=null,flagsLoading=false,flagsError=null,setError=null;
 const known=new Map(),writes=new Map();
 const isFresh=at=>{const age=at===null?null:now()-at;return age!==null&&age>=0&&age<maxAgeMs;};
 const remember=(id,favorite)=>{known.delete(id);known.set(id,{favorite,at:now()});while(known.size>SONG_FAVORITES_FLAGS_LIMIT)known.delete(known.keys().next().value);};
 const flag=(id,freshOnly=false)=>{
  const entry=known.get(id);
  if(entry&&(!freshOnly||isFresh(entry.at)))return entry.favorite;
  return (!freshOnly||isFresh(view.at))&&view.rows.some(row=>row.songId===id)?true:undefined;
 };
 const snapshot=()=>{
  const flags=Object.fromEntries([...new Set([...known.keys(),...view.rows.map(row=>row.songId)])].sort().map(id=>[id,flag(id)]));
  const {page,rows,total,loading,error,dirty}=view;
  return songFavoritesFreeze(structuredClone({page,rows,total,loading,error,dirty,flags,flagsLoading,flagsError,pendingSongIds:[...writes.keys()].sort(),setError}));
 };
 let notified=JSON.stringify(snapshot());
 function notify(){const next=snapshot(),key=JSON.stringify(next);if(key!==notified){notified=key;onChange(next);}}
 function reset(page=0){
  generation++;pageGeneration++;flagsGeneration++;view=fresh(page);known.clear();writes.clear();flagsPending=null;flagsKey=null;flagsAt=null;flagsLoading=false;flagsError=null;setError=null;
 }
 function syncContext(){
  const next=context();
  if(!next||![next.playerId,next.spaceId,next.roomId].every(value=>typeof value==='string'&&value)||!Number.isSafeInteger(next.revision)||next.revision<0||(next.accountId!=null&&typeof next.accountId!=='string')){if(scope){reset();scope=null;}throw Error('收藏登入空間資訊不正確');}
  const identity=JSON.stringify([next.accountId??null,next.playerId,next.spaceId,next.roomId]);
  if(!scope){scope={identity,revision:next.revision,roomId:next.roomId};return;}
  if(identity!==scope.identity||next.revision!==scope.revision){
   const page=identity===scope.identity?view.page:0;
   reset(page);
   scope={identity,revision:next.revision,roomId:next.roomId};
  }
 }
 const state=()=>{syncContext();return snapshot();};
 function setPage(page){
  syncContext();if(!Number.isSafeInteger(page)||page<0||page*SONG_FAVORITES_PAGE_LIMIT>10000000)throw Error('收藏歌單頁碼不正確');
  if(page!==view.page){pageGeneration++;view=fresh(page);}
  notify();return snapshot();
 }
 function load({force=false}={}){
  syncContext();if(typeof force!=='boolean')throw Error('收藏重新讀取設定不正確');
  const current=view,key=JSON.stringify([scope.identity,scope.revision,current.page]),requestGeneration=generation,requestPageGeneration=pageGeneration,roomId=scope.roomId;
  if(current.pending?.key===key)return current.pending.promise;
  if(!force&&isFresh(current.at)&&(current.key===key||current.dirty))return Promise.resolve(snapshot());
  const active=()=>{try{syncContext();return generation===requestGeneration&&pageGeneration===requestPageGeneration&&view===current;}catch{return false;}};
  const promise=Promise.resolve().then(()=>active()?api({op:'favoritesPage',page:current.page,limit:SONG_FAVORITES_PAGE_LIMIT}):null).then(response=>{
   if(!active())return snapshot();
   const data=songFavoritesPage(response,roomId);
   Object.assign(current,data,{loading:false,error:null,dirty:false,key,pending:null,at:now()});
   for(const row of data.rows)remember(row.songId,true);
   notify();return snapshot();
  }).catch(error=>{
   if(!active())return snapshot();
   Object.assign(current,{loading:false,error:String(error?.message||'收藏歌單讀取失敗').slice(0,500),key,pending:null,at:now()});notify();return snapshot();
  });
  current.pending={key,promise};current.loading=true;current.error=null;notify();return promise;
 }
 function loadFlags(songIds,{force=false}={}){
  syncContext();
  if(typeof force!=='boolean'||!Array.isArray(songIds)||songIds.length>SONG_FAVORITES_FLAGS_LIMIT)throw Error('一次最多查詢 50 首收藏狀態');
  const ids=[...new Set(Array.from(songIds,songFavoritesId))],requested=force?ids:ids.filter(id=>flag(id,true)===undefined);
  if(!requested.length)return Promise.resolve(snapshot());
  const key=JSON.stringify([scope.identity,scope.revision,[...requested].sort()]);
  if(flagsPending?.key===key)return flagsPending.promise;
  if(!force&&flagsKey===key&&isFresh(flagsAt))return Promise.resolve(snapshot());
  const requestGeneration=generation,requestFlagsGeneration=++flagsGeneration;
  const active=()=>{try{syncContext();return generation===requestGeneration&&flagsGeneration===requestFlagsGeneration;}catch{return false;}};
  const promise=Promise.resolve().then(()=>active()?api({op:'favoriteFlags',songIds:requested}):null).then(response=>{
   if(!active())return snapshot();
   if(!response||!Array.isArray(response.songIds)||response.songIds.length>requested.length)throw Error('收藏狀態資料不正確');
   const favorites=Array.from(response.songIds,songFavoritesId),unique=new Set(favorites);
   if(unique.size!==favorites.length||favorites.some(id=>!requested.includes(id)))throw Error('收藏狀態資料不正確');
   for(const id of requested)remember(id,unique.has(id));
   flagsPending=null;flagsLoading=false;flagsError=null;flagsKey=key;flagsAt=now();notify();return snapshot();
  }).catch(error=>{
   if(!active())return snapshot();
   flagsPending=null;flagsLoading=false;flagsError=String(error?.message||'收藏狀態讀取失敗').slice(0,500);flagsKey=key;flagsAt=now();notify();return snapshot();
  });
  flagsPending={key,promise};flagsLoading=true;flagsError=null;notify();return promise;
 }
 function setFavorite(songId,favorite){
  syncContext();songFavoritesId(songId);if(typeof favorite!=='boolean')throw Error('收藏設定不正確');
  const pending=writes.get(songId);
  if(pending){if(pending.favorite===favorite)return pending.promise;return Promise.reject(Error('這首歌曲正在更新收藏，請稍後再試'));}
  if(writes.size>=SONG_FAVORITES_FLAGS_LIMIT)return Promise.reject(Error('收藏更新忙碌中，請稍後再試'));
  const requestGeneration=generation,active=()=>{try{syncContext();return generation===requestGeneration;}catch{return false;}};
  const promise=Promise.resolve().then(()=>active()?api({op:'favoriteSet',songId,favorite}):null).then(response=>{
   if(!active())return null;
   if(!response||response.songId!==songId||response.favorite!==favorite||(response.changed!==undefined&&typeof response.changed!=='boolean'))throw Error('收藏更新回應不正確');
   writes.delete(songId);remember(songId,favorite);setError=null;
   if(!favorite&&view.rows.some(row=>row.songId===songId)){view.rows=view.rows.filter(row=>row.songId!==songId);view.total=Math.max(0,view.total-1);}
   pageGeneration++;view.pending=null;view.loading=false;view.dirty=true;view.at=now();
   flagsGeneration++;flagsPending=null;flagsLoading=false;
   notify();return {songId,favorite};
  }).catch(error=>{
   if(!active())return null;
   writes.delete(songId);setError=String(error?.message||'收藏更新失敗').slice(0,500);notify();throw error;
  });
  writes.set(songId,{favorite,promise});setError=null;notify();return promise;
 }
 return Object.freeze({state,setPage,load,loadFlags,setFavorite});
}
