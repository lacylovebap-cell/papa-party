export const emptyBoardFeed=()=>({rows:[],olderNext:null,oldestScanned:null,headTop:null,gaps:[],initialized:false});
export const boardFeedCursor=feed=>feed.gaps[0]?.before??feed.olderNext;

function mergeGaps(gaps){
 const merged=[];
 for(const gap of gaps.filter(g=>g.before>g.until).sort((a,b)=>a.until-b.until)){
  const previous=merged.at(-1);
  if(previous&&gap.until<=previous.before)previous.before=Math.max(previous.before,gap.before);
  else merged.push({...gap});
 }
 return merged.reverse();
}
function subtractScan(gaps,lower,upper){
 return mergeGaps(gaps.flatMap(g=>{
  if(upper<=g.until||lower>=g.before)return [g];
  return [{until:g.until,before:Math.min(g.before,lower)},{until:Math.max(g.until,upper),before:g.before}];
 }));
}

// A scan covers raw rows, including rows omitted by the server's visibility rules.
// Only that interval is replaced; polling must not discard already loaded history.
export function mergeBoardFeed(feed,page,before=null){
 const incoming=page.rows||[],through=page.scannedThrough??(incoming.length?Math.min(...incoming.map(p=>p.seq)):null);
 const lower=page.next==null?0:through,upper=before??Infinity;
 if(lower==null)throw Error('留言分頁資料不完整，請重新整理');
 const byId=new Map(feed.rows.filter(p=>p.seq<lower||p.seq>=upper).map(p=>[p.id,p]));
 for(const p of incoming)byId.set(p.id,p);
 const result={...feed,rows:[...byId.values()].sort((a,b)=>b.seq-a.seq),gaps:feed.gaps.map(g=>({...g})),initialized:true};
 if(!feed.initialized){result.olderNext=page.next??null;result.oldestScanned=lower;}
 else {
  // A busy board can advance by a whole page between polls. Keep an explicit
  // cursor for the unscanned gap instead of silently jumping to older history.
  if(before==null&&lower>feed.headTop)result.gaps.push({until:feed.headTop,before:lower});
  if(lower<=feed.oldestScanned){result.olderNext=page.next??null;result.oldestScanned=lower;}
 }
 result.gaps=subtractScan(result.gaps,lower,upper);
 if(before==null)result.headTop=Math.max(through||0,...incoming.map(p=>p.seq));
 return result;
}
