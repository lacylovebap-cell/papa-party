// Hall pricing record (pricing spec batch 2): the Edge module, the two SQL
// functions on the real schema, and the real Edge pricing a request from it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFullSchemaDb} from './support/full-schema-db.js';
import {loadEdge} from './support/edge-harness.js';
import {createSpacePricing} from '../supabase/functions/party-api/space-pricing.js';
import {DEFAULTS,empty,mutate,upgradePlatform,publicView,roomPricing} from '../src/core.js';
import {stateEntries} from '../src/state-patch.js';
import {legacyHallPricing,blankHallPricing,hallPricingInput} from '../src/pricing-engine.js';

const president={role:'super_admin',accountId:'0f4c1a52-6a1d-4d8e-9a4b-1b2c3d4e5f60'};
const shengma=()=>legacyHallPricing(DEFAULTS);

test('Edge module: president only, validated before any write, 聲瑪 editor starts from today\'s numbers, other Spaces start blank',async()=>{
 const calls=[];let stored=null;
 const api=async(path,body)=>{calls.push({path,body});
  if(path.startsWith('/rest/v1/papa_space_policies'))return stored?[{value:stored,revision:3}]:[];
  if(path==='/rest/v1/rpc/papa_management_space_pricing')return {spaceId:body.requested_space,name:'廳',kind:'hall',status:'active',rolloverHour:19,pricing:stored,revision:stored?3:0};
  if(path.startsWith('/rest/v1/papa_v2_entities'))return [{s:DEFAULTS}];
  return {saved:true};};
 const m=createSpacePricing({api});
 for(const who of [null,{role:'streamer_admin',accountId:president.accountId},{role:'super_admin'}]){
  await assert.rejects(m.read({spaceId:'space-001'},who),/僅限平台總裁/);
  await assert.rejects(m.save({spaceId:'space-001'},who),/僅限平台總裁/);
 }
 assert.equal(calls.length,0);
 assert.equal(await m.forSpace('space-001'),null,'no record: legacy prices apply');
 const first=await m.read({spaceId:'space-001'},president);
 assert.equal(first.stored,false);assert.deepEqual(first.pricing,shengma());
 const other=await m.read({spaceId:'space-abc'},president);
 assert.deepEqual(other.pricing,blankHallPricing());
 const op=randomUUID();
 await assert.rejects(m.save({operationId:op,spaceId:'space-001',expectedRevision:0,rolloverHour:24,pricing:shengma()},president),/0～23/);
 await assert.rejects(m.save({operationId:op,spaceId:'space-001',expectedRevision:0,rolloverHour:19,pricing:{...shengma(),mode:'single',singleFee:'host'}},president),/單費模式只收2號位主持費/);
 await assert.rejects(m.save({operationId:'x',spaceId:'space-001',expectedRevision:0,rolloverHour:19,pricing:shengma()},president),/格式/);
 const before=calls.length;
 await m.save({operationId:op,spaceId:'space-001',expectedRevision:0,rolloverHour:19,pricing:{...shengma(),perUnit:{singer:'3000',host:500,hall:500}}},president);
 assert.equal(calls.length,before+1);const sent=calls.at(-1);
 assert.equal(sent.path,'/rest/v1/rpc/papa_management_space_pricing_save');
 assert.deepEqual(Object.keys(sent.body),['subject','operation','payload']);assert.equal(sent.body.subject,president.accountId);
 assert.equal(sent.body.payload.pricing.perUnit.singer,3000,'canonical numbers are stored');
 stored=shengma();assert.deepEqual(await m.forSpace('space-001'),shengma());
 stored={...shengma(),mode:'broken'};assert.equal(await m.forSpace('space-001'),null,'an unreadable record is never half-used');
});

async function schema(t){
 const f=await createFullSchemaDb(t);
 const account=async()=>(await f.q('insert into papa_accounts default values returning id'))[0].id;
 const boss=await account(),outsider=await account();
 await f.q("insert into papa_platform_roles(account_id,role) values($1,'president')",[boss]);
 await f.q("insert into papa_manager_account_links(manager_key,account_id) values('president',$1)",[boss]);
 const read=(who,space)=>f.rpc('papa_management_space_pricing',[who,space]);
 const save=(who,payload,op=randomUUID())=>f.rpc('papa_management_space_pricing_save',[who,op,payload]);
 return {...f,boss,outsider,read,save};
}

test('SQL: the president saves a Space\'s pricing and rollover in one step, with revision checks, retries and Audit',async t=>{
 const f=await schema(t);
 const start=await f.read(f.boss,'space-001');
 assert.deepEqual([start.spaceId,start.pricing,start.revision,start.rolloverHour],['space-001',null,0,19]);
 const payload={spaceId:'space-001',expectedRevision:0,rolloverHour:19,pricing:shengma()},op=randomUUID();
 const saved=await f.save(f.boss,payload,op);
 assert.deepEqual(saved,{saved:true,spaceId:'space-001',revision:1,rolloverHour:19});
 assert.deepEqual(await f.save(f.boss,payload,op),saved,'a retried operation returns the first result');
 await assert.rejects(f.save(f.boss,{...payload,rolloverHour:20},op),/OPERATION_CONFLICT/);
 await assert.rejects(f.save(f.boss,payload),/MANAGEMENT_VERSION_CONFLICT/,'the editor must reopen after someone else saved');
 const after=await f.read(f.boss,'space-001');
 assert.deepEqual(after.pricing,shengma());assert.equal(after.revision,1);
 // Second save changes the rollover hour too, atomically.
 const second=await f.save(f.boss,{...payload,expectedRevision:1,rolloverHour:20,pricing:{...shengma(),unit:'鑽'}});
 assert.deepEqual([second.revision,second.rolloverHour],[2,20]);
 assert.equal((await f.q("select accounting_rollover_hour h from papa_spaces where id='space-001'"))[0].h,20);
 const audit=await f.q("select action,before_data,after_data from papa_management_audit where space_id='space-001' and action='space_pricing' order by created_at");
 assert.equal(audit.length,2);assert.equal(audit[0].before_data.pricing,null);assert.equal(audit[1].before_data.pricing.unit,'探鑽');
 await assert.rejects(f.q("update papa_management_audit set action='x' where action='space_pricing'"),/./,'Audit stays immutable');
});

test('SQL: refuses non-presidents, deleted or unknown Spaces and malformed payloads; touches nothing else',async t=>{
 const f=await schema(t);
 const payload={spaceId:'space-001',expectedRevision:0,rolloverHour:19,pricing:shengma()};
 await assert.rejects(f.save(f.outsider,payload),/MANAGEMENT_ACCESS_DENIED/);
 await assert.rejects(f.read(f.outsider,'space-001'),/MANAGEMENT_ACCESS_DENIED/);
 await assert.rejects(f.save(f.boss,{...payload,spaceId:'space-nope'}),/SPACE_NOT_FOUND/);
 for(const bad of [{...payload,extra:1},{...payload,rolloverHour:24},{...payload,rolloverHour:'19'},{...payload,expectedRevision:-1},
  {...payload,pricing:{...shengma(),v:2}},{...payload,pricing:{...shengma(),mode:'triple'}},{...payload,pricing:{...shengma(),plans:{}}},
  {...payload,pricing:{...shengma(),tiers:Array.from({length:11},(_,i)=>({id:'t'+i}))}}])
  await assert.rejects(f.save(f.boss,bad),/MANAGEMENT_PAYLOAD_INVALID/,JSON.stringify(bad).slice(0,80));
 const hall=(await f.rpc('papa_manage_space',[f.boss,randomUUID(),'create',{name:'測試廳',kind:'hall'}])).id;
 const blank=await f.read(f.boss,hall);assert.deepEqual([blank.kind,blank.status,blank.rolloverHour,blank.pricing],['hall','suspended',0,null]);
 await f.save(f.boss,{spaceId:hall,expectedRevision:0,rolloverHour:3,pricing:blankHallPricing({names:{singer:'歌姬'},unit:'星鑽'})});
 assert.equal((await f.read(f.boss,hall)).pricing.names.singer,'歌姬');
 assert.equal((await f.q("select count(*)::int n from papa_space_policies where space_id='space-001'"))[0].n,0,'other Spaces untouched');
 await f.q("update papa_spaces set deleted_at=now(),status='suspended' where id=$1",[hall]);
 await assert.rejects(f.read(f.boss,hall),/SPACE_NOT_FOUND/);
 await assert.rejects(f.save(f.boss,{spaceId:hall,expectedRevision:1,rolloverHour:3,pricing:blankHallPricing()}),/SPACE_NOT_FOUND/);
});

const at='2026-10-28T01:00:00Z',admin={role:'admin'};
async function live(t){
 const f=await createFullSchemaDb(t);
 let s=empty();const run=(type,data)=>s=mutate(s,{type,data},admin,at);
 run('player',{name:'玩家甲',ids:['a1'],password:'pw-1234',balance:5});
 run('song',{title:'長歌',artist:'歌手',creditCost:2});
 s=upgradePlatform(s);
 for(const entry of stateEntries(s))await f.q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[entry.kind,entry.id,entry.data]);
 const edge=loadEdge(f.db,{adminUser:null});
 const login=await edge.call({op:'login',streamer:'papa',playerId:s.players[0].playerId,password:'pw-1234',loginId:'a1'});
 assert.equal(login.status,200,JSON.stringify(login.body));
 const token=login.body.token;
 const read=async()=>(await edge.call({op:'read',streamer:'papa',token,revision:-1,signatures:{}})).body;
 const request=async()=>{const song=s.songs[0];return edge.call({op:'mutate',streamer:'papa',token,revision:(await read()).state.revision,operationId:randomUUID(),
  action:{type:'request',data:{songId:song.songId,kind:'live',giftConfirmed:true,expectedSong:{title:song.title,artist:song.artist}}}});};
 const last=async()=>(await f.q("select data from papa_v2_entities where kind='queue' order by data->>'at' desc limit 1"))[0]?.data;
 return {f,s,read,request,last};
}

test('Edge: a request is priced from the hall record when there is one, and from the legacy fields when there is none',async t=>{
 const {f,read,request,last}=await live(t);
 assert.equal((await read()).state.hallPricing,null,'no record yet');
 let r=await request();assert.equal(r.status,200,JSON.stringify(r.body));
 assert.deepEqual([(await last()).fees.singer,(await last()).fees.host],[5555,990],'legacy 聲瑪 numbers');
 const hall=hallPricingInput({...shengma(),unit:'星鑽',perUnit:{singer:3000,host:600,hall:400},plans:[]});
 await f.q("insert into papa_space_policies(space_id,policy_key,value) values('space-001','pricing',$1)",[hall]);
 const view=(await read()).state;
 assert.deepEqual(view.hallPricing,hall,'players receive the hall record with the room view');
 r=await request();assert.equal(r.status,200,JSON.stringify(r.body));
 const q=await last();
 assert.deepEqual([q.price,q.double,q.fees.singer,q.fees.host,q.fees.hall,q.fees.source],[6000,1200,6000,1200,800,'base']);
});

test('core: crown cards come from the hall record; the room view carries it for players and managers',()=>{
 let s=upgradePlatform(empty());
 s=mutate(s,{type:'player',data:{name:'甲',ids:[]}},admin,at);s=mutate(s,{type:'song',data:{title:'歌',artist:'人'}},admin,at);
 s.hallPricing=hallPricingInput({...blankHallPricing(),mode:'single',singleFee:'hall',perUnit:{singer:800,host:0,hall:100},
  tiers:[{id:'t1',name:'皇冠',fee:9000,price:1600,host:0,hall:700,months:2}]});
 assert.throws(()=>mutate(s,{type:'crown',data:{playerId:s.players[0].playerId,songId:s.songs[0].songId,tier:'金卡'}},admin,at),/請選卡別/);
 const next=mutate(s,{type:'crown',data:{playerId:s.players[0].playerId,songId:s.songs[0].songId,tier:'皇冠'}},admin,at);
 assert.deepEqual([next.crowns[0].fee,next.crowns[0].price,next.crowns[0].double,next.crowns[0].months],[9000,1600,700,2]);
 assert.deepEqual(publicView(next,{role:'player',playerId:s.players[0].playerId},at).hallPricing,s.hallPricing);
 assert.deepEqual(publicView(next,admin,at).hallPricing,s.hallPricing);
 assert.equal(roomPricing(publicView(next,{role:'player'},at)).names.singer,'主播');
 const legacy=upgradePlatform(empty());assert.equal(publicView(legacy,admin,at).hallPricing,null);
});

test('release seed: writes 聲瑪 today\'s numbers once, refuses to run if any 聲瑪 streamer\'s prices changed',async t=>{
 const fs=await import('node:fs');
 const f=await createFullSchemaDb(t);
 const boss='b778a393-d405-4349-a377-34855fb2cdfe';
 await f.q('insert into papa_accounts(id) values($1)',[boss]);
 await f.q("insert into papa_platform_roles(account_id,role) values($1,'president')",[boss]);
 await f.q("insert into papa_manager_account_links(manager_key,account_id) values('president',$1)",[boss]);
 let s=upgradePlatform(empty());
 s=mutate(s,{type:'streamer',data:{slug:'mimi',display_name:'咪醬'}},admin,at);
 for(const entry of stateEntries(s))await f.q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3) on conflict do nothing',[entry.kind,entry.id,entry.data]);
 for(const room of s.streamers)await f.q("insert into papa_space_streamers(streamer_id,space_id) values($1,'space-001') on conflict do nothing",[room.id]);
 const seed=fs.readFileSync('ops/space-pricing-shengma-seed-20261029.sql','utf8');
 // A changed streamer blocks the seed.
 const other=s.streamers.find(r=>r.slug==='mimi').id;
 await f.q("update papa_v2_entities set data=jsonb_set(data,array['streamerSettings',$1,'livePrice'],'3000') where kind='meta' and id='1'",[other]);
 await assert.rejects(f.db.exec(seed),/SHENGMA_SETTINGS_CHANGED/);
 await f.db.exec('rollback').catch(()=>{});
 await f.q("update papa_v2_entities set data=jsonb_set(data,array['streamerSettings',$1,'livePrice'],'2990') where kind='meta' and id='1'",[other]);
 await f.db.exec(seed);
 const [row]=await f.q("select value,revision from papa_space_policies where space_id='space-001' and policy_key='pricing'");
 assert.deepEqual(row.value,shengma());assert.equal(Number(row.revision),1);
 assert.equal((await f.q("select count(*)::int n from papa_management_audit where action='space_pricing'"))[0].n,1);
 await assert.rejects(f.db.exec(seed),/SHENGMA_PRICING_ALREADY_EXISTS/,'runs once');
});
