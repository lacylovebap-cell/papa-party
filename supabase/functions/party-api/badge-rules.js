import {BADGE_CATALOG} from './badge-catalog.js';

const HOUR=3600000,DAY=24*HOUR,TAIPEI=8*HOUR;
export const badgeKey=value=>String(value??'').trim().toLowerCase();
const ms=value=>typeof value==='number'?value:Date.parse(value);
const iso=value=>new Date(value).toISOString();
export const badgeDay=value=>Math.floor((ms(value)+TAIPEI)/DAY);
export const badgeShow=value=>Math.floor((ms(value)+TAIPEI-19*HOUR)/DAY);
const showEnd=show=>(show+1)*DAY-TAIPEI+19*HOUR;
const dayEnd=day=>(day+1)*DAY-TAIPEI;
const hour=value=>Math.floor((ms(value)+TAIPEI)/HOUR)%24;
const ordinary=f=>f.source==='manual';
const dice=f=>['draw','cross_draw','proxy_draw','streamer_draw'].includes(f.source);
const random=f=>dice(f)||['self','cross_self'].includes(f.source);
const valid=f=>f.valid!==false&&!f.test&&!f.voided&&!f.duplicateOf&&f.player;
const byRequest=(a,b)=>a.requestAt-b.requestAt||String(a.eventKey).localeCompare(String(b.eventKey));
const byComplete=(a,b)=>a.completedAt-b.completedAt||byRequest(a,b);
const group=(rows,key)=>{const map=new Map();for(const row of rows){const k=key(row);if(!map.has(k))map.set(k,[]);map.get(k).push(row);}return [...map.values()];};
const unique=(rows,key)=>new Set(rows.map(key)).size;
const common=(rows,key)=>rows.length?[...new Set(rows[0][key]||[])].filter(k=>rows.every(r=>r[key]?.includes(k))):[];
const stamp=f=>f.completedAt||f.requestAt;

/**
 * Server-only deterministic replay. Inputs are verified, normalized facts, never
 * caller-supplied eligibility flags. Historical replay never creates random wins.
 * A fact represents one requested song/performance unit; eventKey is stable on
 * redelivery. credit facts carry quantity, failure facts carry a verified hour.
 * Scope is a canonical account identity; room includes space + streamer.
 */
export function evaluateBadgeRules({facts,player,room,asOf,manualAwards=[],randomWins=[]}){
 const now=ms(asOf);if(!Number.isFinite(now))throw Error('BADGE_TIME_INVALID');
 const seen=new Set();
 const all=facts.filter(valid).map(f=>({...f,requestAt:ms(f.requestAt),completedAt:f.completedAt?ms(f.completedAt):null,
  title:badgeKey(f.title),keywords:[...new Set((f.keywords||[]).map(badgeKey).filter(Boolean))],
  performers:[...new Set((f.performers||[]).map(badgeKey).filter(Boolean))]}))
  .filter(f=>Number.isFinite(f.requestAt)&&f.requestAt<=now&&(!f.completedAt||Number.isFinite(f.completedAt)))
  .sort(byRequest).filter(f=>{const k=f.room+'|'+f.eventKey;if(seen.has(k))return false;seen.add(k);return true;});
 const own=all.filter(f=>f.player===player),inRoom=all.filter(f=>f.room===room),mine=own.filter(f=>f.room===room);
 const requests=inRoom.filter(f=>['live','saved','self'].includes(f.kind));
 const myRequests=mine.filter(f=>['live','saved','self'].includes(f.kind));
 const complete=rows=>rows.filter(f=>f.completedAt&&f.completedAt<=now).sort(byComplete);
 const normalDone=complete(myRequests.filter(ordinary));
 const roomDone=complete(requests.filter(ordinary));
 const sameShow=f=>badgeShow(f.requestAt)===badgeShow(f.completedAt);
 const awards=new Map();
 const award=(id,at,eventKey,context={})=>{
  const catalog=BADGE_CATALOG.find(r=>r.id===id);if(!catalog||catalog.retired||!Number.isFinite(at)||at>now)return;
  const period=context.period??(catalog.lifetime==='show'?String(badgeShow(at)):catalog.lifetime==='day'?String(badgeDay(at)):'lifetime');
  const expiresAt=catalog.lifetime==='24h'?at+DAY:catalog.lifetime==='7d'?at+7*DAY:catalog.lifetime==='30d'?at+30*DAY:
   catalog.lifetime==='show'?showEnd(Number(period)):catalog.lifetime==='day'?dayEnd(Number(period)):null;
  const key=id+'|'+period,prior=awards.get(key);
  if(!prior||at>prior.at)awards.set(key,{id,code:catalog.code,scope:catalog.scope,room:catalog.scope==='global'?null:room,
   period,at,acquiredAt:iso(at),expiresAt:expiresAt===null?null:iso(expiresAt),active:expiresAt===null||expiresAt>now,eventKey,...context});
 };
 const threshold=(id,rows,n)=>{if(rows.length>=n){const f=rows[n-1];award(id,stamp(f),f.eventKey);}};
 const recurring=(id,rows,n,options={})=>{for(let i=n-1;i<rows.length;i+=n){const set=rows.slice(i-n+1,i+1);if(!options.test||options.test(set))award(id,Math.max(...set.map(stamp)),set.at(-1).eventKey,options.context?.(set)||{});}};
 // First requester keeps the reservation even if another request completes first.
 for(const dayRows of group(inRoom.filter(f=>ordinary(f)&&['live','credit'].includes(f.kind)),f=>badgeDay(f.requestAt))){
  const f=dayRows[0];if(f.player===player&&f.completedAt&&f.completedAt<=now)award('P01',f.completedAt,f.eventKey);
 }
 for(const rows of group(complete(myRequests.filter(f=>ordinary(f)&&f.kind==='live'&&(hour(f.requestAt)>=23||hour(f.requestAt)<5)))
  .filter(f=>Math.floor((f.requestAt+TAIPEI-23*HOUR)/DAY)===Math.floor((f.completedAt+TAIPEI-23*HOUR)/DAY)&&(hour(f.completedAt)>=23||hour(f.completedAt)<5)),
  f=>Math.floor((f.requestAt+TAIPEI-23*HOUR)/DAY)))
  recurring('P02',rows,5);
 const liveCredits=mine.filter(f=>ordinary(f)&&(f.kind==='live'||f.kind==='credit'));
 for(const rows of group(liveCredits.filter(f=>hour(f.requestAt)>=1&&hour(f.requestAt)<5),f=>badgeDay(f.requestAt))){
  let n=0;for(const f of rows){const before=n;n+=f.quantity||1;if(Math.floor(n/5)>Math.floor(before/5))award('P03',f.requestAt,f.eventKey);}
 }
 let creditStart=0,creditTotal=0;
 for(let i=0;i<liveCredits.length;i++){
  creditTotal+=liveCredits[i].quantity||1;
  while(creditStart<i&&badgeDay(liveCredits[creditStart].requestAt)<badgeDay(liveCredits[i].requestAt)-2)creditTotal-=liveCredits[creditStart++].quantity||1;
  if(creditTotal>=100){award('P04',liveCredits[i].requestAt,liveCredits[i].eventKey);break;}
 }
 const daily=(rows,at)=>new Set(rows.filter(f=>badgeDay(f.requestAt)>=badgeDay(at)-29&&f.requestAt<=at).map(f=>badgeDay(f.requestAt)));
 const dynamic=(id,rows,n)=>{if(daily(rows,now).size>=n){const times=rows.map(stamp).filter(t=>t<=now).sort((a,b)=>a-b);const at=times.find(t=>daily(rows.filter(f=>stamp(f)<=t),t).size>=n);if(at!==undefined)award(id,at,'dynamic');}};
 dynamic('P05',normalDone.filter(f=>f.kind==='live'),15);
 dynamic('P31',normalDone,15);
 const ownLive=myRequests.filter(f=>ordinary(f)&&f.kind==='live');
 const liveSequence=mine.filter(f=>ordinary(f)&&['live','credit'].includes(f.kind));
 for(let i=2;i<liveSequence.length;i++){
  const set=liveSequence.slice(i-2,i+1);
  if(set[2].requestAt-set[0].requestAt<=30*60000&&set.every(f=>f.completedAt&&f.completedAt<=now))
   award('P06',Math.max(...set.map(f=>f.completedAt)),set[2].eventKey);
 }
 const tagCount=(id,rows,n,show=false)=>{
  for(const set of show?group(rows,f=>badgeShow(f.requestAt)):[rows]){
   const tags=new Set();for(const f of set){for(const tag of f.keywords)tags.add(tag);
    if(tags.size>=n){award(id,f.completedAt,f.eventKey);if(show)tags.clear();else break;}}
  }
 };
 const roomTagDone=complete([...normalDone,...mine.filter(f=>f.kind==='tag_completion'&&ordinary(f))]);
 tagCount('P07',roomTagDone,10);
 tagCount('P27',roomTagDone.filter(sameShow),4,true);
 tagCount('P28',complete(own.filter(f=>ordinary(f)&&['live','saved','tag_completion'].includes(f.kind))),20);
 for(const rows of group(liveSequence,f=>badgeShow(f.requestAt))){
  for(let i=4;i<rows.length;i++){const set=rows.slice(i-4,i+1);
   if(common(set,'keywords').length&&set.every(f=>f.completedAt&&f.completedAt<=now&&sameShow(f)))
    award('P08',Math.max(...set.map(f=>f.completedAt)),set[4].eventKey);
  }
 }
 // Cold songs use prior actual completions, including other players.
 const allRoomDone=complete(requests),completedByTitle=new Map(group(allRoomDone,f=>f.title).map(rows=>[rows[0].title,rows]));
 for(const f of normalDone.filter(f=>f.title)){
  const history=completedByTitle.get(f.title)||[];let lo=0,hi=history.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(history[mid].completedAt<f.completedAt)lo=mid+1;else hi=mid;}
  const prior=history[lo-1];
  if(prior){if(f.completedAt-prior.completedAt>30*DAY)award('P11',f.completedAt,f.eventKey);
   if(f.completedAt-prior.completedAt>90*DAY)award('P23',f.completedAt,f.eventKey);}
 }
 const normalShowRequests=requests.filter(ordinary);
 for(const showRows of group(normalShowRequests,f=>badgeShow(f.requestAt))){
  const show=badgeShow(showRows[0].requestAt),end=showEnd(show),done=complete(showRows).filter(sameShow);
  const songs=group(showRows.filter(f=>f.title),f=>f.title),most=Math.max(...songs.map(rows=>unique(rows,f=>f.player)));
  if(end<=now&&most>=2)for(const rows of songs.filter(rows=>unique(rows,f=>f.player)===most)){
   const f=rows.filter(r=>r.completedAt&&r.completedAt<end).at(-1);
   if(f?.player===player)award('P12',end,f.eventKey,{period:String(show+1)});
  }
  for(const rows of group(done.filter(f=>f.title),f=>f.title))for(const [id,n] of [['P13',2],['P34',5]]){
   const people=new Set();let start=null;
   for(const f of rows){people.add(f.player);if(people.size>=n){start=f.completedAt;break;}}
   if(start!==null)for(const f of rows.filter(f=>f.player===player))award(id,Math.max(start,f.completedAt),f.eventKey,{period:String(show)});
  }
  const distinct=[];for(const f of showRows.filter(f=>f.kind==='live'))if(!distinct.some(r=>r.player===f.player))distinct.push(f);
  const third=distinct[2];if(third?.player===player&&third.completedAt&&third.completedAt<end&&third.completedAt<=now)award('P35',third.completedAt,third.eventKey);
  const byUser=done.filter(f=>f.player===player);
  const slots=new Set();for(const f of byUser){const at=ms(f.slotAt||f.requestAt),h=hour(at);if([19,20,21,22,23,0].includes(h)&&badgeShow(at)===show){slots.add(h);if(slots.size===6){award('P18',f.completedAt,f.eventKey);slots.clear();}}}
  recurring('R04',byUser.filter(f=>f.kind==='saved'),10);
  for(const rows of group(byUser.filter(f=>f.title),f=>f.title))threshold('C04',rows,3);
  if(done[6]?.player===player)award('C05',done[6].completedAt,done[6].eventKey);
  if(end<=now){
   if(done.length>=3&&byUser.length>done.length/2)award('H06',end,'show:'+show);
   if(done.at(-1)?.player===player)award('H07',end,done.at(-1).eventKey);
   const prior=requests.filter(f=>ordinary(f)&&badgeShow(f.requestAt)===show-1).at(-1),first=showRows.find(f=>f.completedAt&&f.completedAt<end);
   if(prior?.completedAt&&badgeShow(prior.completedAt)===show-1&&first?.player===player&&first.title&&first.title===prior.title)
    award('H04',end,first.eventKey);
  }
  // A sequence has a common performer across its entire segment.
  const runs=new Map();
  for(const f of showRows){
   for(const artist of runs.keys())if(!f.performers.includes(artist))runs.delete(artist);
   for(const artist of f.performers){
    const run=runs.get(artist)||{leaders:[]};runs.set(artist,run);
    if(run.leaders.length<3&&!run.leaders.some(r=>r.player===f.player))run.leaders.push(f);
    const leaders=run.leaders;
    if(leaders.length<3||!leaders.every(r=>r.completedAt&&r.completedAt<end&&r.completedAt<=now))continue;
    const ready=Math.max(...leaders.map(r=>r.completedAt)),thirdAt=leaders[2].requestAt,r=f;
    if(r.player!==player||r.requestAt<thirdAt||!r.completedAt||r.completedAt>=end||r.completedAt>now)continue;
    // First two may qualify only through a NEW request after threshold exists.
    if(leaders.slice(0,2).some(p=>p.player===r.player)&&r.requestAt<ready)continue;
    award('P33',Math.max(ready,r.completedAt),r.eventKey,{period:String(show)});
   }
  }
 }
 threshold('P14',complete(myRequests.filter(dice)),20);
 for(const rows of group(complete(myRequests.filter(f=>dice(f)&&f.title)),f=>f.title))for(let i=3;i<rows.length;i++){
  const set=rows.slice(i-3,i+1),latest=rows[i].completedAt,firstDay=badgeDay(Math.min(...set.map(f=>f.requestAt)));
  if(badgeDay(latest)-firstDay<=2)award('P15',latest,rows[i].eventKey);
 }
 const dates=group(normalDone,f=>badgeDay(f.requestAt)).map(rows=>({day:badgeDay(rows[0].requestAt),at:Math.min(...rows.map(f=>f.completedAt)),eventKey:rows[0].eventKey})).sort((a,b)=>a.day-b.day);
 let streak=[];for(const date of dates){if(streak.length&&date.day!==streak.at(-1).day+1)streak=[];streak.push(date);
  for(const [id,n] of [['P16',7],['P17',15]])if(streak.length>=n){const set=streak.slice(-n);award(id,Math.max(...set.map(d=>d.at)),date.eventKey);}}
 const globalDone=complete(own.filter(f=>ordinary(f)&&['live','saved'].includes(f.kind)));
 for(const rows of group(globalDone.filter(f=>f.title),f=>f.title))for(const [id,n] of [['P19',15],['P20',30],['H05',50]])threshold(id,rows,n);
 const explorer=complete(myRequests.filter(f=>f.title)),known=new Set();for(const f of explorer){known.add(f.title);if(known.size>=50){award('P21',f.completedAt,f.eventKey);break;}}
 for(const f of complete(myRequests.filter(f=>dice(f)&&f.title)))if(!requests.some(r=>r.title===f.title&&byRequest(r,f)<0))award('P22',f.completedAt,f.eventKey);
 // A return show follows fourteen completely inactive calendar days.
 const activity=mine.filter(f=>ordinary(f)&&['live','saved','credit'].includes(f.kind));
 for(const rows of group(ownLive,f=>badgeShow(f.requestAt))){
  const first=activity.find(f=>badgeShow(f.requestAt)===badgeShow(rows[0].requestAt));if(!first)continue;
  const prior=activity.filter(f=>byRequest(f,first)<0).at(-1);
  if(prior&&badgeDay(first.requestAt)-badgeDay(prior.requestAt)<=14)continue;
  if(rows[0].eventKey!==first.eventKey)continue;
  threshold('P29',complete(rows).filter(sameShow),5);
 }
 for(const f of liveCredits)if(daily(liveCredits,f.requestAt).size===30){award('P30',f.requestAt,f.eventKey);break;}
 const popularCounts=new Map();let popularCursor=0,popularMax=0;
 for(const f of normalDone.filter(f=>f.title).toSorted(byRequest)){
  while(popularCursor<roomDone.length&&roomDone[popularCursor].completedAt<f.requestAt){
   const row=roomDone[popularCursor++];if(!row.title)continue;
   const n=(popularCounts.get(row.title)||0)+1;popularCounts.set(row.title,n);popularMax=Math.max(popularMax,n);
  }
  if(popularMax>0&&popularCounts.get(f.title)===popularMax)award('P32',f.completedAt,f.eventKey);
 }
 const balance=mine.filter(f=>f.kind==='balance').sort(byRequest).at(-1);
 if(balance)for(const [id,n] of [['S01',50],['S02',100],['S03',500],['S04',1000]])if(balance.quantity>=n)award(id,balance.requestAt,balance.eventKey);
 for(const [id,n] of [['R01',50],['R02',100],['R03',500]])threshold(id,normalDone.filter(f=>f.kind==='saved'),n);
 const failures=mine.filter(f=>f.kind==='failure'&&f.failureVerified===true),hours=new Set(),failed=[];
 for(const f of failures){const key=Math.floor(f.requestAt/HOUR);if(hours.has(key))continue;hours.add(key);failed.push(f);}
 for(const [id,n] of [['R05',1],['R06',10],['R07',50]])threshold(id,failed,n);
 for(const f of normalDone.filter(f=>f.kind==='saved'&&f.title))if(badgeDay(f.completedAt)===badgeDay(f.requestAt)&&failed.some(r=>r.title===f.title&&badgeDay(r.requestAt)+1===badgeDay(f.requestAt)))award('R08',f.completedAt,f.eventKey);
 for(const rows of group(roomDone,f=>badgeDay(f.completedAt))){const f=rows[0];if(f.player===player)award('C01',f.completedAt,f.eventKey);}
 threshold('C02',normalDone,100);threshold('C03',normalDone,500);
 const late=liveSequence.filter(f=>hour(f.requestAt)>=1&&hour(f.requestAt)<7);
 for(const f of group(late,r=>badgeDay(r.requestAt)).map(rows=>rows[0]))if(daily(late,f.requestAt).size>=5)award('H01',f.requestAt,f.eventKey);
 const destinyCounts=new Map();let destinyCursor=0,destinyMax=0;
 for(const f of complete(myRequests.filter(f=>random(f)&&f.title)).toSorted(byRequest)){
  while(destinyCursor<normalDone.length&&normalDone[destinyCursor].completedAt<f.requestAt){
   const row=normalDone[destinyCursor++];if(!row.title)continue;
   const n=(destinyCounts.get(row.title)||0)+1;destinyCounts.set(row.title,n);destinyMax=Math.max(destinyMax,n);
  }
  if(destinyMax>=10&&destinyCounts.get(f.title)===destinyMax)award('H02',f.completedAt,f.eventKey);
 }
 const ownRandom=myRequests.filter(random);for(let i=2;i<ownRandom.length;i++){const set=ownRandom.slice(i-2,i+1);
  if(common(set,'performers').length&&set.every(f=>f.completedAt&&f.completedAt<=now))award('H03',Math.max(...set.map(f=>f.completedAt)),set[2].eventKey);}
 for(const win of randomWins)if(win.player===player&&win.room===room&&['L01','L02','L03'].includes(win.id))award(win.id,ms(win.at),win.eventKey);
 for(const manual of manualAwards)if(manual.player===player&&(manual.scope==='global'||manual.room===room)){
  const catalog=BADGE_CATALOG.find(c=>c.id===manual.id);if(!catalog||catalog.retired)continue;
  const at=ms(manual.acquiredAt);if(!Number.isFinite(at)||at>now)continue;
  awards.set(manual.id+'|manual',{...manual,code:catalog.code,manualVerified:true,active:manual.active,at});
 }
 return [...awards.values()].map(({at,...row})=>row).sort((a,b)=>a.id.localeCompare(b.id)||a.period?.localeCompare(b.period||'')||0);
}

export function songLeaderboard(facts,{room=null}={}){
 const seen=new Set(),counts=new Map();
 for(const f of facts){if(!valid(f)||!ordinary(f)||!f.completedAt||room!==null&&f.room!==room)continue;
  const event=f.room+'|'+f.eventKey;if(seen.has(event))continue;seen.add(event);
  const title=badgeKey(f.title),artist=badgeKey(f.artist);if(!title)continue;
  const key=JSON.stringify([title,artist]),row=counts.get(key)||{title,artist,total:0};row.total++;counts.set(key,row);}
 return competitionRanks([...counts.values()]);
}
export function competitionRanks(rows){
 const ordered=rows.toSorted((a,b)=>b.total-a.total||JSON.stringify(a).localeCompare(JSON.stringify(b)));
 let rank=0,prior=null;return ordered.map((row,i)=>{if(row.total!==prior)rank=i+1;prior=row.total;return {...row,rank};});
}
