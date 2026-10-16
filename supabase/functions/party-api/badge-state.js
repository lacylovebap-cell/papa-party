import {evaluateBadgeRules,badgeDay,badgeShow} from './badge-rules.js';

const valid=row=>!row.test&&!row.voided_at&&!row.voidedAt&&!row.performance_duplicate_of;
const splitArtists=value=>String(value||'').split(/[+＋&＆]/).map(s=>s.trim()).filter(Boolean);
/**
 * Reuses the already authorized room mutation snapshot. Does not read Audit,
 * download another room or include credentials/song notes in the badge payload.
 */
export function badgeFactsFromState(state,spaceId,roomId){
 const room=spaceId+'/'+roomId,players=new Set((state.players||[]).filter(p=>!p.test).map(p=>p.playerId));
 const facts=[],balance=new Map();
 for(const q of state.queue||[]){
  if(q.streamer_id!==roomId||!players.has(q.playerId)||!valid(q)||!['live','saved','self'].includes(q.kind))continue;
  if(!q.acceptedAt||!['waiting','completed','stored'].includes(q.status))continue;
  const source=q.selfProvided&&q.source==='manual'?'self':q.source||(q.selfProvided?'self':'manual');
  const items=q.items?.length?q.items:[{title:q.title,artist:q.artist,songId:q.songId,performances:1}];
  items.forEach((item,index)=>{
   const units=/^[0-9]{1,4}$/.test(String(item.performances??1))?Math.max(1,Math.min(1000,Number(item.performances??1))):1;
   for(let unit=0;unit<units;unit++)facts.push({room,player:q.playerId,eventKey:q.id+':'+index+':'+unit,queueId:q.id,
    kind:q.kind,source,title:item.title||(items.length===1?q.title:null),artist:item.artist||(items.length===1?q.artist:null),
    performers:item.achievement_performers||splitArtists(item.artist||(items.length===1?q.artist:null)),
    keywords:item.achievement_tags||(items.length===1?q.achievement_tags:[])||[],requestAt:q.at,
    completedAt:q.status==='completed'?q.completedAt:null,slotAt:q.quota_effective_at||q.at});
  });
  if(items.length>1&&q.status==='completed'&&q.achievement_tags?.length)
   facts.push({room,player:q.playerId,eventKey:q.id+':tags',kind:'tag_completion',source,keywords:q.achievement_tags,
    requestAt:q.at,completedAt:q.completedAt});
 }
 for(const row of state.ledger||[]){
  if(row.streamer_id!==roomId||!players.has(row.playerId)||row.test)continue;
  balance.set(row.playerId,(balance.get(row.playerId)||0)+Number(row.amount||0));
  // Converted requests already have a queue fact; opening/adjustment/reversal
  // rows establish balances but do not invent a new live request.
  if(valid(row)&&row.amount>0&&row.accounting_kind==='receipt'&&!row.conversion&&!row.excludeStats&&!row.openingBalance&&!row.accounting_adjustment)
   facts.push({room,player:row.playerId,eventKey:'credit:'+row.id,kind:'credit',source:'manual',requestAt:row.at,quantity:Number(row.receipt_quantity||row.amount)});
 }
 // Stock acquisition time is derived separately from actual threshold crossings.
 return {facts,balance,players};
}

export function stockBadgeCandidates(state,spaceId,roomId,asOf){
 const players=new Set((state.players||[]).filter(p=>!p.test).map(p=>p.playerId)),balances=new Map(),earned=new Map();
 const thresholds=[['S01','stock50',50],['S02','stock100',100],['S03','stock500',500],['S04','stock1000',1000]];
 const ledger=(state.ledger||[]).filter(row=>row.streamer_id===roomId&&players.has(row.playerId)&&!row.test&&Number.isFinite(Date.parse(row.at))&&Date.parse(row.at)<=Date.parse(asOf))
  .toSorted((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id));
 for(const row of ledger){
  const before=balances.get(row.playerId)||0,after=before+Number(row.amount||0);balances.set(row.playerId,after);
  for(const [id,code,n] of thresholds)if(before<n&&after>=n)earned.set(row.playerId+'|'+id,{id,code,playerId:row.playerId,scope:'streamer',
   period:'lifetime',acquiredAt:new Date(row.at).toISOString(),expiresAt:null,active:true,eventKey:'balance:'+row.id});
 }
 return [...earned.values()].filter(row=>(balances.get(row.playerId)||0)>=thresholds.find(t=>t[0]===row.id)[2]);
}
const latest=rows=>{
 const map=new Map();
 for(const row of rows){if(row.scope==='global'||row.id.startsWith('R')&&['R05','R06','R07','R08'].includes(row.id)||row.id.startsWith('L'))continue;
  const key=row.id+'|'+row.period,old=map.get(key);if(!old||row.acquiredAt>old.acquiredAt)map.set(key,row);}
 return map;
};
export function roomBadgeChanges(before,after,{spaceId,roomId,asOf}){
 const old=badgeFactsFromState(before,spaceId,roomId),next=badgeFactsFromState(after,spaceId,roomId),room=spaceId+'/'+roomId;
 const changes=[];
 const oldFacts=new Map(old.facts.map(f=>[f.eventKey,f])),newFacts=new Map(next.facts.map(f=>[f.eventKey,f]));
 const touched=[],targets=new Set(),days=new Set(),shows=new Set();
 for(const key of new Set([...oldFacts.keys(),...newFacts.keys()]))if(JSON.stringify(oldFacts.get(key))!==JSON.stringify(newFacts.get(key))){
  for(const fact of [oldFacts.get(key),newFacts.get(key)].filter(Boolean)){touched.push(fact);targets.add(fact.player);
   days.add(badgeDay(fact.requestAt));shows.add(badgeShow(fact.requestAt));shows.add(badgeShow(fact.requestAt)+1);
   if(fact.completedAt){days.add(badgeDay(fact.completedAt));shows.add(badgeShow(fact.completedAt));}}
 }
 const backdated=touched.filter(f=>f.completedAt&&Date.parse(f.completedAt)<Date.parse(asOf)-300000).map(f=>Date.parse(f.completedAt));
 const correctionStart=backdated.length?Math.min(...backdated):Infinity;
 for(const fact of [...old.facts,...next.facts])if(days.has(badgeDay(fact.requestAt))||shows.has(badgeShow(fact.requestAt))||
  fact.completedAt&&days.has(badgeDay(fact.completedAt))||Date.parse(fact.requestAt)>=correctionStart||
  fact.completedAt&&Date.parse(fact.completedAt)>=correctionStart)targets.add(fact.player);
 for(const player of targets){
  const a=latest(evaluateBadgeRules({facts:old.facts,player,room,asOf})),b=latest(evaluateBadgeRules({facts:next.facts,player,room,asOf}));
  for(const key of new Set([...a.keys(),...b.keys()])){
   const prior=a.get(key),row=b.get(key);
   if(JSON.stringify(prior)===JSON.stringify(row))continue;
   const award=row||prior,fact=newFacts.get(award.eventKey)||oldFacts.get(award.eventKey);
   const evidence=fact?.queueId?{queueId:fact.queueId,eventKey:fact.eventKey,title:fact.title||'',artist:fact.artist||'',source:fact.source,
    kind:fact.kind,requestAt:fact.requestAt,completedAt:fact.completedAt}:null;
   changes.push({...award,playerId:player,active:row?.active===true,...(evidence?{evidence}:{})});
  }
 }
 const oldStock=new Map(stockBadgeCandidates(before,spaceId,roomId,asOf).map(row=>[row.playerId+'|'+row.id,row]));
 const nextStock=new Map(stockBadgeCandidates(after,spaceId,roomId,asOf).map(row=>[row.playerId+'|'+row.id,row]));
 for(const key of new Set([...oldStock.keys(),...nextStock.keys()]))if(JSON.stringify(oldStock.get(key))!==JSON.stringify(nextStock.get(key)))
  changes.push({...nextStock.get(key)||oldStock.get(key),active:nextStock.has(key)});
 return changes;
}
