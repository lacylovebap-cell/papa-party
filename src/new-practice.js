const NEW_PRACTICE_GAP=1024;
const NEW_PRACTICE_RENUMBER_LIMIT=2000;
const NEW_PRACTICE_ORDER_MAX=Math.floor(Number.MAX_SAFE_INTEGER/NEW_PRACTICE_GAP);

export function newPracticeRank(value){return typeof value==='number'&&Number.isSafeInteger(value)?value:null;}
function newPracticeOrder(value){
 return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=NEW_PRACTICE_ORDER_MAX?value:null;
}
function newPracticeIdCompare(a,b){return a<b?-1:a>b?1:0;}
function newPracticeEntries(songs){
 if(!Array.isArray(songs))throw Error('新練歌單資料不正確');
 const entries=songs.map((song,index)=>({song,index,order:newPracticeOrder(song?._order),id:String(song?.songId??'')}));
 const canonical=[...entries].sort((a,b)=>(a.order??0)-(b.order??0)||newPracticeIdCompare(a.id,b.id));
 canonical.forEach((entry,index)=>{entry.rank=newPracticeRank(entry.song.sort_order)??(entry.order===null?index:entry.order)*NEW_PRACTICE_GAP;});
 return entries.filter(entry=>entry.song?.new===true).sort((a,b)=>a.rank-b.rank||(a.order??0)-(b.order??0)||newPracticeIdCompare(a.id,b.id));
}

// Pass the full scoped room, including old/hidden songs; filter public visibility after sorting.
export function newPracticeSongs(songs){return newPracticeEntries(songs).map(entry=>entry.song);}
export function newPracticeRanks(songs){return new Map(newPracticeEntries(songs).map(entry=>[entry.id,entry.rank]));}

// Adjacent anchors are resolved against the complete canonical room list, never a UI page.
export function newPracticeReorder(songs,payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length!==3||!Object.keys(payload).every(key=>['songId','targetId','position'].includes(key)))throw Error('新練歌曲排序資料不正確');
 for(const key of ['songId','targetId'])if(typeof payload[key]!=='string'||!payload[key].trim()||payload[key].length>128)throw Error('新練歌曲編號不正確');
 if(!['before','after'].includes(payload.position))throw Error('新練歌曲排序位置不正確');
 const entries=newPracticeEntries(songs),known=new Set();
 for(const entry of entries){if(!entry.id||known.has(entry.id))throw Error('新練歌單包含不明或重複歌曲');known.add(entry.id);}
 const moved=entries.find(entry=>entry.id===payload.songId),target=entries.find(entry=>entry.id===payload.targetId);
 if(!moved||!target)throw Error('找不到目前主播的新練歌曲');
 if((moved.song.streamer_id??null)!==(target.song.streamer_id??null))throw Error('新練歌曲必須屬於同一位主播');
 const sameRoom=entries.filter(entry=>(entry.song.streamer_id??null)===(moved.song.streamer_id??null));
 const result={songs:[...songs],changes:[],renumbered:false};
 if(moved===target)return result;
 const ordered=sameRoom.filter(entry=>entry!==moved),targetIndex=ordered.indexOf(target);
 ordered.splice(targetIndex+(payload.position==='after'?1:0),0,moved);
 if(ordered.every((entry,index)=>entry===sameRoom[index]))return result;
 const at=ordered.indexOf(moved),left=ordered[at-1]?.rank,right=ordered[at+1]?.rank;
 let rank;
 if(left===undefined){rank=right-NEW_PRACTICE_GAP;if(!Number.isSafeInteger(rank))rank=right-1;}
 else if(right===undefined){rank=left+NEW_PRACTICE_GAP;if(!Number.isSafeInteger(rank))rank=left+1;}
 else rank=Math.trunc(left/2+right/2);
 const fits=Number.isSafeInteger(rank)&&(left===undefined||rank>left)&&(right===undefined||rank<right);
 const ranks=fits?[[moved,rank]]:ordered.map((entry,index)=>[entry,index*NEW_PRACTICE_GAP]);
 if(!fits){
  if(songs.length>NEW_PRACTICE_RENUMBER_LIMIT)throw Error('排序間隔不足，歌單超過安全整理上限');
  result.renumbered=true;
 }
 for(const [entry,nextRank] of ranks){
  if(entry.rank===nextRank)continue;
  result.songs[entry.index]={...entry.song,sort_order:nextRank};
  result.changes.push({songId:entry.id,sort_order:nextRank});
 }
 return result;
}
