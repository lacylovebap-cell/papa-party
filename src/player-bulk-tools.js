import {mutate} from './core.js?v=10.12-WEB.1';
import {REQUEST_SOURCES} from './request-source.js?v=10.12-WEB.1';

export function validateRequestBatch(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>50)throw Error('一次請選 1 到 50 首歌曲');
 const ids=new Set();
 return rows.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!['songId','kind','pairSongId','giftConfirmed','selfProvided','source','requestNote'].includes(k))||typeof row.songId!=='string'||!row.songId||row.songId.length>128||ids.has(row.songId)||!['saved','live'].includes(row.kind)||row.selfProvided!==undefined&&typeof row.selfProvided!=='boolean'||row.source!==undefined&&!REQUEST_SOURCES.has(row.source)||row.giftConfirmed!==undefined&&typeof row.giftConfirmed!=='boolean'||row.pairSongId!==undefined&&(typeof row.pairSongId!=='string'||row.pairSongId.length>128)||row.requestNote!==undefined&&(typeof row.requestNote!=='string'||[...row.requestNote].length>30))throw Error('批次點歌資料不正確');
  ids.add(row.songId);return {...row};
 });
}

// Sequential Core validation includes reservations made by earlier rows. The caller
// commits the returned state once, so a rejected row cannot leave a partial batch.
export function applyPlayerRequestBatch(source,rows,actor,time,streamer){
 if(actor?.role!=='player'||!actor.playerId)throw Error('請先登入玩家');
 let next=source;
 for(const data of validateRequestBatch(rows))next=mutate(next,{type:'request',data,streamer},actor,time);
 return next;
}
