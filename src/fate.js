import {newPracticeSongTags} from './new-practice.js?v=10.19-WEB.1';

// The catalog and the songs share one tag vocabulary; there is no separate draw category list.
export function fateCategories(settings,songs){
 return [...new Set([...(settings.tags||[]),...songs.flatMap(newPracticeSongTags)].map(x=>String(x).trim()).filter(Boolean))];
}
const DRAW_TTL=3600000,DRAW_KEY='papa-recent-draws';
function recentRead(){try{if(typeof localStorage==='undefined')return {};const m=JSON.parse(localStorage.getItem(DRAW_KEY)||'{}'),n=Date.now();return Object.fromEntries(Object.entries(m).filter(([,v])=>n-v<DRAW_TTL));}catch{return {};}}
function recentNote(id){try{if(typeof localStorage==='undefined')return;const m=recentRead();m[id]=Date.now();localStorage.setItem(DRAW_KEY,JSON.stringify(m));}catch{}}
export function drawSong(songs,category,seen=[],previous=null,random=Math.random){seen=[...new Set([...seen,...Object.keys(recentRead())])];
 const selected=Array.isArray(category)?category:[category];
 const tags=new Set(selected.filter(value=>typeof value==='string'&&value.startsWith('tag:')).map(value=>value.slice(4)).filter(Boolean));
 const all=Array.isArray(category)?selected.length===0||selected.includes('all'):tags.size===0;
 const candidates=songs.filter(s=>!s.hidden&&!s.deleted&&!s.disabled&&s.active!==false&&s.available!==false&&(all||tags.size>0&&[...tags].every(tag=>newPracticeSongTags(s).includes(tag))));
 if(!candidates.length)return {song:null,seen:[]};
 let history=seen.filter(id=>candidates.some(s=>s.songId===id)),pool=candidates.filter(s=>!history.includes(s.songId));
 if(!pool.length){history=[];pool=candidates.filter(s=>s.songId!==previous);if(!pool.length)pool=candidates;}
 const song=pool[Math.min(pool.length-1,Math.floor(Math.max(0,random())*pool.length))];
 recentNote(song.songId);
 return {song,seen:[...history,song.songId]};
}
