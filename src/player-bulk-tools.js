import {mutate} from './core.js?v=10.14-WEB.1';
import {REQUEST_SOURCES} from './request-source.js?v=10.14-WEB.1';

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

export function validateOwnQueueBatch(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>50)throw Error('一次請選 1 到 50 筆自己的待播');
 const ids=new Set();
 return rows.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!['id','operation','songId','pairSongId','giftConfirmed'].includes(k))||typeof row.id!=='string'||!row.id||row.id.length>128||ids.has(row.id)||!['cancel','replace'].includes(row.operation)||row.operation==='cancel'&&Object.keys(row).some(k=>!['id','operation'].includes(k))||row.operation==='replace'&&(typeof row.songId!=='string'||!row.songId||row.songId.length>128||row.pairSongId!==undefined&&(typeof row.pairSongId!=='string'||row.pairSongId.length>128)||row.giftConfirmed!==undefined&&typeof row.giftConfirmed!=='boolean'))throw Error('自己的待播操作資料不正確');
  ids.add(row.id);return {...row};
 });
}
export function applyOwnQueueBatch(source,rows,actor,time,streamer){
 if(actor?.role!=='player'||!actor.playerId)throw Error('請先登入玩家');
 let next=source;
 for(const {operation,...data} of validateOwnQueueBatch(rows))next=mutate(next,{type:operation==='cancel'?'cancelOwn':'replaceOwn',data,streamer},actor,time);
 return next;
}
