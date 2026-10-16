import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BADGE_CATALOG} from '../supabase/functions/party-api/badge-catalog.js';
import {evaluateBadgeRules,songLeaderboard,badgeDay,badgeShow} from '../supabase/functions/party-api/badge-rules.js';
const time=(day='15',hour='20:00')=>Date.parse('2026-10-'+day+'T'+hour+':00+08:00');
const room='space-001/papa',player='account-a';
const song=(key,extra={})=>({eventKey:key,room,player,kind:'live',source:'manual',title:'愛你',artist:'甲',performers:['甲'],keywords:[],
 requestAt:time(),completedAt:time()+60000,...extra});
const run=(facts,extra={})=>evaluateBadgeRules({facts,player,room,asOf:time('17','22:00'),...extra});
const get=(facts,id,extra={})=>run(facts,extra).find(r=>r.id===id&&r.active);

test('catalog keeps all 62 stable identities, exact Emoji and final global scope',()=>{
 assert.equal(BADGE_CATALOG.length,62);
 assert.equal(BADGE_CATALOG.filter(r=>!r.retired).length,57);
 assert.deepEqual(BADGE_CATALOG.filter(r=>r.scope==='global').map(r=>r.id),['P19','P20','P28','H05']);
 assert.deepEqual(BADGE_CATALOG.filter(r=>r.retired).map(r=>r.id),['P09','P10','P24','P25','P26']);
 assert.deepEqual([...BADGE_CATALOG.find(r=>r.id==='S03').emoji].map(c=>c.codePointAt(0)),[0x1f6ce]);
 for(const c of BADGE_CATALOG.filter(c=>!c.retired))assert.ok(c.emoji,c.id);
 assert.equal(BADGE_CATALOG.find(r=>r.id==='C04').code,'repeat_show');
 assert.equal(BADGE_CATALOG.find(r=>r.id==='P34').code,'five_players');
});
test('P28 uses 20 distinct normalized keywords across streamers; no fixed list or 20-song minimum',()=>{
 const tags=Array.from({length:19},(_,i)=>'keyword'+i);
 const a=song('a',{keywords:tags}),b=song('b',{room:'space-002/other',keywords:[' keyword0 ','KEYWORD1']});
 assert.equal(get([a,b],'P28'),undefined);
 b.keywords.push('keyword19');assert.ok(get([a,b],'P28'));
 assert.ok(get([song('one',{keywords:[...tags,'keyword19']})],'P28'));
 assert.equal(get([song('dice',{source:'draw',keywords:[...tags,'keyword19']})],'P28'),undefined);
 assert.equal(get([{...a,keywords:['only']},b],'P07'),undefined,'P07 does not merge other streamers');
});
test('same-title global medals merge artists/streamers; exact 50th event can be backfilled at 60',()=>{
 const rows=Array.from({length:60},(_,i)=>song(String(i),{room:i%2?room:'space-002/b',title:i%2?' 愛你 ':'愛你',artist:i%2?'甲':'乙',
  requestAt:time()+i*60000,completedAt:time()+i*60000+30000}));
 for(const [id,n] of [['P19',15],['P20',30],['H05',50]])assert.equal(get(rows,id).acquiredAt,new Date(rows[n-1].completedAt).toISOString());
 assert.equal(get(rows,'C02'),undefined);
 assert.equal(get(rows.map(r=>({...r,source:'draw'})),'P19'),undefined);
});
test('first live requester retains reservation, and calendar date differs from show',()=>{
 const first=song('a',{requestAt:time('15','00:05'),completedAt:time('15','10:00')});
 const other=song('b',{player:'b',requestAt:time('15','00:06'),completedAt:time('15','01:00')});
 assert.equal(get([first,other],'P01',{asOf:time('15','02:00')}),undefined);
 assert.equal(get([first,other],'P01',{asOf:time('15','11:00')}).eventKey,'a');
 assert.notEqual(badgeDay(first.requestAt),badgeShow(first.requestAt));
});
test('P06 keeps own unfinished or stored records in sequence and allows later completion',()=>{
 const rows=[0,1,2].map(i=>song(String(i),{requestAt:time()+i*10*60000,completedAt:time('16','01:00')+i*60000}));
 assert.ok(get(rows,'P06',{asOf:time('16','02:00')}));
 assert.ok(get([...rows,song('other',{player:'b',requestAt:time()+5000})],'P06',{asOf:time('16','02:00')}));
 assert.equal(get([...rows,song('gap',{requestAt:time()+5000,completedAt:null})],'P06',{asOf:time('16','02:00')}),undefined);
});
test('P08 requires same show completion and a tag common to all five songs',()=>{
 const rows=Array.from({length:5},(_,i)=>song(String(i),{requestAt:time()+i*60000,completedAt:time()+i*60000+30000,keywords:['共同','額外'+i]}));
 assert.ok(get(rows,'P08',{asOf:time()+HOUR}));
 rows[2].keywords=['別的'];assert.equal(get(rows,'P08',{asOf:time()+HOUR}),undefined);
 rows[2].keywords=['共同'];rows[4].completedAt=time('16','19:01');assert.equal(get(rows,'P08'),undefined);
});
const HOUR=3600000;
test('P12 settles at 19:00, awards tied titles independently, walks back incomplete last request and expires next show',()=>{
 const rows=[song('a1',{player:'a',title:'A'}),song('a2',{title:'A',requestAt:time()+60000}),
  song('a3',{title:'A',player:'b',requestAt:time()+120000,completedAt:null}),
  song('b1',{title:'B',player:'b'}),song('b2',{title:'B',requestAt:time()+60000}),
  song('b3',{title:'B',player:'a',requestAt:time()+120000,completedAt:null})];
 const result=get(rows,'P12',{asOf:time('16','19:01')});
 assert.equal(result.acquiredAt,new Date(time('16','19:00')).toISOString());
 assert.equal(result.expiresAt,new Date(time('17','19:00')).toISOString());
 assert.equal(run(rows,{asOf:time('16','18:59')}).some(r=>r.id==='P12'),false);
 assert.equal(get(rows,'P12',{asOf:time('17','19:00')}),undefined);
 assert.equal(run(rows,{asOf:time('16','19:01')}).filter(r=>r.id==='P12').length,1,'same player and medal counts once despite two tied titles');
});
test('P13 and P34 start only after 2 / 5 different people finish, then include later people',()=>{
 const rows=Array.from({length:6},(_,i)=>song(String(i),{player:i===0?player:'p'+i,completedAt:time()+(i+1)*60000}));
 assert.equal(get(rows,'P13',{asOf:time()+90000}),undefined);
 assert.equal(get(rows,'P13',{asOf:time()+150000}).acquiredAt,new Date(rows[1].completedAt).toISOString());
 assert.equal(get(rows,'P34',{asOf:time()+4*60000}),undefined);
 assert.equal(get(rows,'P34',{asOf:time()+7*60000}).acquiredAt,new Date(rows[4].completedAt).toISOString());
});
test('cold badges use same streamer prior completion, not uncompleted requests, and exclude never completed songs',()=>{
 const first=song('old',{player:'b',requestAt:time('01'),completedAt:time('01')});
 const current=song('new',{requestAt:Date.parse('2027-02-01T20:00:00+08:00'),completedAt:Date.parse('2027-02-01T21:00:00+08:00')});
 assert.equal(get([current],'P11',{asOf:current.completedAt}),undefined);
 const waiting=song('waiting',{player:'b',requestAt:current.requestAt-60000,completedAt:null});
 assert.ok(get([first,waiting,current],'P23',{asOf:current.completedAt}));
 assert.equal(get([{...first,room:'other'},current],'P11',{asOf:current.completedAt}),undefined);
});
test('P22 permits actual dice only and any prior request disqualifies even if uncompleted',()=>{
 const row=song('dice',{source:'draw'});
 for(const source of ['draw','cross_draw'])for(const kind of ['live','saved'])assert.ok(get([{...row,source,kind}],'P22'),source+' '+kind);
 for(const source of ['manual','self','cross_self','proxy_draw','streamer_draw'])assert.equal(get([{...row,source}],'P22'),undefined,source+' must not qualify');
 assert.equal(get([{...row,kind:'self'}],'P22'),undefined);
 assert.equal(get([{...row,player:null,source:'streamer_draw',kind:'self'}],'P22'),undefined);
 assert.equal(get([{...row,completedAt:null}],'P22'),undefined);
 assert.equal(get([{...row,completedAt:time('18')}],'P22'),undefined);
 assert.equal(get([song('old',{player:'b',requestAt:time()-60000,completedAt:null}),row],'P22'),undefined);
 assert.ok(get([song('old',{player:'b',room:'space-002/other',requestAt:time()-60000,completedAt:null}),row],'P22'));
});
test('P16 request dates count only when completed; absent calendar days break streak',()=>{
 const rows=Array.from({length:7},(_,i)=>song(String(i),{kind:'saved',requestAt:time(String(8+i).padStart(2,'0'),'23:50'),completedAt:time(String(9+i).padStart(2,'0'),'00:10')}));
 assert.ok(get(rows,'P16'));
 assert.equal(get(rows.filter((_,i)=>i!==3),'P16'),undefined);
 assert.equal(get(rows,'P16',{asOf:time('14','23:59')}),undefined);
 assert.equal(get(rows,'P16').expiresAt,new Date(rows[6].completedAt+7*24*HOUR).toISOString());
});
test('P18 takes corrected hour slot, allows completion after 01, and does not cross show',()=>{
 const slots=['19:30','20:30','21:30','22:30','23:30','00:50'];
 const rows=slots.map((h,i)=>song(String(i),{kind:'saved',requestAt:time(i===5?'16':'15',h),completedAt:time('16','01:10')+i*60000}));
 const asOf=time('16','02:00');
 assert.ok(get(rows,'P18',{asOf}));
 rows[0].slotAt=time('15','20:05');assert.equal(get(rows,'P18',{asOf}),undefined);
 rows[0].slotAt=time('15','19:30');assert.ok(get(rows,'P18',{asOf}));
});
test('H03 requires one performer common to whole sequence, ordinary requests do not interrupt',()=>{
 const rows=[song('a',{source:'draw',performers:['甲','乙']}),song('b',{source:'cross_draw',performers:['乙','丙']}),song('c',{source:'draw',performers:['丙']})];
 assert.equal(get(rows,'H03'),undefined);rows[2].performers=['乙','丙'];
 assert.ok(get([...rows,song('manual',{requestAt:time()+1,performers:['丁']})],'H03'));
});
test('P32 and H02 freeze before request, counting completions only and accepting tied firsts',()=>{
 const old=Array.from({length:10},(_,i)=>song('h'+i,{requestAt:time('14')+i*60000,completedAt:time('14')+i*60000+30000}));
 const current=song('new',{source:'draw'});
 const asOf=time()+HOUR;
 assert.ok(get([...old,current],'H02',{asOf}));assert.equal(get([...old,current],'P32',{asOf}),undefined);
 assert.ok(get([...old,{...current,source:'manual'}],'P32',{asOf}));
 assert.equal(get([...old.map(r=>({...r,source:'self'})),current],'H02',{asOf}),undefined);
});
test('H04 waits settlement, skips incomplete current first, does not skip incomplete previous last',()=>{
 const previous=song('prev',{player:'b',requestAt:time('14'),completedAt:time('14')+60000});
 const pending=song('pending',{player:'b',title:'X',completedAt:null,requestAt:time()-60000});
 const current=song('current');
 assert.equal(get([previous,pending,current],'H04',{asOf:time('16','18:59')}),undefined);
 assert.ok(get([previous,pending,current],'H04',{asOf:time('16','19:01')}));
 const last=song('tail',{requestAt:time('15','18:00'),completedAt:null});
 assert.equal(get([previous,last,pending,current],'H04',{asOf:time('16','19:01')}),undefined);
});
test('H06 needs at least three room performances and strict majority; H07 uses completion order',()=>{
 assert.equal(get([song('one')],'H06',{asOf:time('16','19:01')}),undefined);
 const rows=[song('one'),song('two'),song('three',{player:'b',completedAt:time()+120000})];
 assert.ok(get(rows,'H06',{asOf:time('16','19:01')}));
 assert.equal(get(rows,'H07',{asOf:time('16','19:01')}),undefined);
 rows[2].player=player;assert.ok(get(rows,'H07',{asOf:time('16','19:01')}));
});
test('S01–S04 simultaneously use unconsumed balance and drop dynamically',()=>{
 const balance={eventKey:'balance',player,room,kind:'balance',source:'manual',requestAt:time(),quantity:1000};
 assert.deepEqual(run([balance]).filter(r=>r.id.startsWith('S')).map(r=>r.id),['S01','S02','S03','S04']);
 assert.equal(run([{...balance,quantity:49}]).filter(r=>r.id.startsWith('S')).length,0);
});
test('effective failures deduplicate by hour; R08 must finish same next calendar day',()=>{
 const failures=[0,1,2].map(i=>({eventKey:'f'+i,player,room,kind:'failure',source:'manual',title:'愛你',requestAt:time('14')+i*60000,failureVerified:true}));
 assert.ok(get(failures,'R05'));assert.equal(get(failures,'R06'),undefined);
 assert.ok(get([...failures,song('saved',{kind:'saved'})],'R08'));
 assert.equal(get([...failures,song('saved',{kind:'saved',completedAt:time('16','00:01')})],'R08'),undefined);
});
test('replay is non-mutating, deduplicated and does not draw random awards or reset historical TTL',()=>{
 const row=song('one'),rows=[row,{...row}],before=structuredClone(rows);
 assert.equal(run(rows).some(r=>r.id.startsWith('L')),false);
 const wins=[{eventKey:'one',player,room,id:'L01',at:row.requestAt}];
 assert.equal(get(rows,'L01',{randomWins:wins}),undefined,'old win expired');
 assert.ok(get(rows,'L01',{randomWins:wins,asOf:row.requestAt+HOUR}));
 assert.deepEqual(rows,before);
});
test('song leaderboard groups title plus artist, excludes all dice/self, uses competition ranks and event deduplication',()=>{
 const rows=[song('a'),song('b',{title:' 愛你 ',artist:'乙'}),song('c',{title:'Third',artist:'乙'}),
  song('d',{source:'draw'}),song('e',{source:'self'}),song('f',{source:'cross_self'}),song('g',{source:'cross_draw'})];
 const result=songLeaderboard([...rows,{...rows[0]}]);
 assert.equal(result.length,3);assert.deepEqual(result.map(r=>r.rank),[1,1,1]);
 rows.push(song('h'));assert.deepEqual(songLeaderboard(rows).map(r=>r.rank),[1,2,2]);
 rows.push(song('i',{title:' 愛你 ',artist:'乙'}));assert.deepEqual(songLeaderboard(rows).map(r=>r.rank),[1,1,3]);
});
test('night completion must stay inside 23–05 and H01 does not renew on another request on an already qualified date',()=>{
 const rows=Array.from({length:5},(_,i)=>song('night'+i,{requestAt:time('15','23:00')+i*60000,completedAt:time('16','04:50')+i*60000}));
 assert.ok(get(rows,'P02',{asOf:time('16','06:00')}));
 rows[4].completedAt=time('16','05:01');assert.equal(get(rows,'P02',{asOf:time('16','06:00')}),undefined);
 const late=Array.from({length:5},(_,i)=>song('late'+i,{requestAt:time(String(10+i),'02:00'),completedAt:null}));
 const extra=song('same-day',{requestAt:time('14','03:00'),completedAt:null});
 assert.equal(get([...late,extra],'H01').acquiredAt,new Date(time('14','02:00')).toISOString());
});
test('P33 follows each common performer run, including a shorter overlapping duet run',()=>{
 const rows=[song('a',{player:'never-finished',performers:['甲'],completedAt:null}),
  song('b',{player:'b',performers:['甲','乙'],requestAt:time()+60000}),
  song('c',{player:'c',performers:['甲','乙'],requestAt:time()+120000}),
  song('d',{performers:['甲','乙'],requestAt:time()+180000,completedAt:time()+240000})];
 assert.ok(get(rows,'P33',{asOf:time()+360000}),'B→C→D shares 乙, despite preceding unfinished 甲-only request');
});
test('missing historical title does not erase generic completed-song counts or create false same-song badges',()=>{
 const rows=Array.from({length:100},(_,i)=>song('unknown'+i,{title:null,requestAt:time()+i*60000,completedAt:time()+i*60000+30000}));
 assert.ok(get(rows,'C02'));
 for(const id of ['P19','P20','H05','C04','P13','P34','P32'])assert.equal(get(rows,id),undefined,id);
});

test('all five dice-dependent medals require player draws and reject manager proxy, streamer, ordinary self and wrong kind',()=>{
 const at=time(),old=Array.from({length:10},(_,i)=>song('history'+i,{requestAt:at-86400000+i*60000,completedAt:at-86400000+i*60000+30000}));
 for(const source of ['draw','cross_draw','proxy_draw','streamer_draw','self','cross_self','manual']){
  const rows=Array.from({length:20},(_,i)=>song('draw'+i,{source,selfProvided:true,performers:['歌手'],requestAt:at+i*60000,completedAt:at+i*60000+30000}));
  const approved=['draw','cross_draw'].includes(source);
  for(const id of ['P14','P15','H03'])assert.equal(!!get(rows,id,{asOf:at+2*HOUR}),approved,source+' '+id);
  assert.equal(!!get([...old,...rows],'H02',{asOf:at+2*HOUR}),approved,source+' H02');
  if(approved)for(const id of ['P14','P15','P22','H02','H03'])assert.equal(get(rows.map(r=>({...r,kind:'self'})),id,{asOf:at+2*HOUR}),undefined,'wrong kind '+id);
 }
});
