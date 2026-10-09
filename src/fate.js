// The catalog and the songs share one tag vocabulary; there is no separate draw category list.
export function fateCategories(settings,songs){
 return [...new Set([...(settings.tags||[]),...songs.flatMap(s=>s.tags||[])].map(x=>String(x).trim()).filter(Boolean))];
}
export function drawSong(songs,category,seen=[],previous=null,random=Math.random){
 const selected=Array.isArray(category)?category:[category];
 const tags=new Set(selected.filter(value=>typeof value==='string'&&value.startsWith('tag:')).map(value=>value.slice(4)).filter(Boolean));
 const all=Array.isArray(category)?selected.length===0||selected.includes('all'):tags.size===0;
 const candidates=songs.filter(s=>all||(s.tags||[]).some(tag=>tags.has(tag)));
 if(!candidates.length)return {song:null,seen:[]};
 let history=seen.filter(id=>candidates.some(s=>s.songId===id)),pool=candidates.filter(s=>!history.includes(s.songId));
 if(!pool.length){history=[];pool=candidates.filter(s=>s.songId!==previous);if(!pool.length)pool=candidates;}
 const song=pool[Math.min(pool.length-1,Math.floor(Math.max(0,random())*pool.length))];
 return {song,seen:[...history,song.songId]};
}
