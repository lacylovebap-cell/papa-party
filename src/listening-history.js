// Completion snapshots count performances; credit prices and favorite flags do not.
export function listenedSongs(scopedState,playerId){
 if(typeof playerId!=='string'||!playerId)return [];
 const songs=scopedState?.songs||[],queue=scopedState?.queue||[],roomId=scopedState?.currentStreamer?.id;
 if(!Array.isArray(songs)||!Array.isArray(queue))throw Error('演唱歷史資料不正確');
 if(!roomId&&(scopedState?.schemaVersion>=3||new Set(queue.map(row=>row.streamer_id).filter(Boolean)).size>1))throw Error('演唱歷史需要目前主播的資料');
 const sameRoom=row=>!roomId||!row.streamer_id||row.streamer_id===roomId;
 const catalog=new Map(songs.filter(sameRoom).map(song=>[song.songId,song])),history=new Map();
 const text=(value,fallback='')=>typeof value==='string'&&value?value:fallback;
 const completedTime=q=>{
  for(const field of ['history_effective_at','completedAt','effective_at','at']){const time=typeof q[field]==='string'?Date.parse(q[field]):NaN;if(Number.isFinite(time))return time;}
  return -Infinity;
 };
 const later=(a,b)=>!b||a.time>b.time||a.time===b.time&&(a.queueId>b.queueId||a.queueId===b.queueId&&(a.ordinal>b.ordinal||a.ordinal===b.ordinal&&(a.title>b.title||a.title===b.title&&a.artist>b.artist)));
 function add(songId,performances,item,q,ordinal=0){
  if(typeof songId!=='string'||!songId||!Number.isSafeInteger(performances)||performances<1)return;
  const current=history.get(songId),listenedCount=(current?.listenedCount||0)+performances;
  if(!Number.isSafeInteger(listenedCount))throw Error('演唱歷史次數不正確');
  const primary=songId===q.songId,snapshot={time:completedTime(q),queueId:text(q.id),ordinal,title:text(item?.title,primary?text(q.title,'歌曲'):'歌曲'),artist:text(item?.artist,primary?text(q.artist):'')};
  history.set(songId,{songId,listenedCount,snapshot:later(snapshot,current?.snapshot)?snapshot:current.snapshot});
 }
 for(const q of queue){
  if(q.playerId!==playerId||q.status!=='completed'||q.test||q.selfProvided||q.kind==='self'||!sameRoom(q))continue;
  if(Array.isArray(q.items)){q.items.forEach((item,ordinal)=>{if(item&&typeof item==='object')add(item.songId,item.performances,item,q,ordinal);});}
  else add(q.songId,1,null,q);
 }
 return [...history.values()].map(({songId,listenedCount,snapshot})=>{
  const song=catalog.get(songId);
  return {songId,title:text(song?.title,snapshot.title),artist:typeof song?.artist==='string'?song.artist:snapshot.artist,listenedCount,requestable:!!song&&!song.hidden&&!song.deleted&&song.active!==false&&!song.disabled&&song.available!==false};
 }).sort((a,b)=>b.listenedCount-a.listenedCount||(a.songId<b.songId?-1:a.songId>b.songId?1:0));
}
