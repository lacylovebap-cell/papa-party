// The catalog and the songs share one tag vocabulary; there is no separate draw category list.
export function fateCategories(settings,songs){
 return [...new Set([...(settings.tags||[]),...songs.flatMap(s=>s.tags||[])].map(x=>String(x).trim()).filter(Boolean))];
}
export function drawSong(songs,category,seen=[],previous=null,random=Math.random){
 const tag=category.startsWith('tag:')?category.slice(4):null;
 const candidates=songs.filter(s=>!tag||(s.tags||[]).includes(tag));
 if(!candidates.length)return {song:null,seen:[]};
 let history=seen.filter(id=>candidates.some(s=>s.songId===id)),pool=candidates.filter(s=>!history.includes(s.songId));
 if(!pool.length){history=[];pool=candidates.filter(s=>s.songId!==previous);if(!pool.length)pool=candidates;}
 const song=pool[Math.min(pool.length-1,Math.floor(Math.max(0,random())*pool.length))];
 return {song,seen:[...history,song.songId]};
}
