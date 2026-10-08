import {previewImport,applyImport,scopeState} from './core.js';

const MAX_ROWS=2000;
const CHOICES=new Set(['add','update','skip']);

export function applyRoomImport(state,kind,text,choices,actor,time,streamer='papa'){
 if(!['songs','crowns'].includes(kind))throw Error('目前主播只能匯入歌曲或冠歌');
 if(typeof text!=='string'||!text.trim())throw Error('請填匯入資料');
 // Preview may include one header row; bound the work before matching source rows.
 if(text.trim().split(/\r?\n/).filter(Boolean).length>MAX_ROWS+1)throw Error('一次最多匯入 2000 行');
 if(!Array.isArray(choices)||choices.length>MAX_ROWS||!Array.from(choices).every(choice=>CHOICES.has(choice)))throw Error('匯入選項不正確');
 const room=scopeState(state,streamer),rows=previewImport(room,kind,text);
 if(!rows.length)throw Error('請填匯入資料');
 if(rows.length>MAX_ROWS)throw Error('一次最多匯入 2000 行');
 if(choices.length!==rows.length)throw Error('匯入選項與資料行數不符');
 const next=applyImport(state,kind,rows,choices,actor,time,room.currentStreamer.id);
 if(kind==='songs'){
  const omittedLyrics=new Set(room.songs.filter(song=>!Object.hasOwn(song,'lyrics')).map(song=>song.songId));
  // Scoped source rows omit private bodies. Do not turn that omission into a deletion on merge.
  for(const song of next.songs)if(song.streamer_id===room.currentStreamer.id&&omittedLyrics.has(song.songId)&&song.lyrics==='')delete song.lyrics;
 }
 return next;
}
