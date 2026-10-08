import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
import * as chatPolicy from '../src/chat-policy.js';
import * as boardPolicy from '../src/board-policy.js';

const read=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const migration='202610080012_communication_space.sql';
test('scoped communication preserves legacy rows and separates native ownership, transactions and audit snapshots',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args)=>(await q(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));
 create table papa_release_backups(release text primary key,snapshot jsonb);
 create function papa_v2_snapshot() returns jsonb language sql as $$select '{}'::jsonb$$;
 create table papa_events(id bigserial primary key,streamer_id text not null,entity_kind text not null,entity_id text not null,
  action text not null,actor_role text,actor_player_id text,created_at timestamptz not null default now(),effective_at text,before_data jsonb,after_data jsonb);
 create table papa_notifications(id uuid primary key default gen_random_uuid(),streamer_id text not null,streamer_name text not null,
  recipient text not null,type text not null,level smallint not null,body text not null,entity_id text,created_at timestamptz not null default now(),read_at timestamptz);
 create table papa_manager_account_links(manager_key text primary key,account_id uuid not null);
 create function papa_audit_redact(value jsonb) returns jsonb language sql immutable as $$select value$$;
 insert into papa_v2_entities values('meta','1','{"streamers":[{"id":"papa","slug":"papa","display_name":"Legacy Room","active":true},{"id":"michelle","slug":"michelle","display_name":"Other legacy room","active":true}]}'),
  ('players','P1','{"playerId":"P1","name":"Legacy name","ids":["legacy"]}'),('players','P2','{"playerId":"P2","name":"Legacy target"}');`);
 for(const name of ['202609250002_private_chat.sql','202609260001_board.sql','202609260002_board_integrity.sql'])await db.exec(read(name));
 const old=(await q(`insert into papa_board_posts(scope,streamer_id,origin_room,author_key,visibility,body,client_id)
  values('global','__global__','papa','player:P1','public','old body',gen_random_uuid()) returning *`))[0];
 await q("insert into papa_board_blocks(owner_key,target_key) values('player:P1','player:P2')");
 await q("insert into papa_board_history(post_id,actor_key,action,before_data) values($1,'player:P1','old',$2)",[old.id,{original:'untouched'}]);
 await db.exec(read('202610070001_space_foundation.sql'));
 await db.exec(`create function papa_streamer_directory() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(room||jsonb_build_object('spaceId',m.space_id)),'[]'::jsonb) from papa_v2_entities e
  cross join lateral jsonb_array_elements(e.data->'streamers') room join papa_space_streamers m on m.streamer_id=room->>'id' where e.kind='meta'$$;`);
 await db.exec(read('202610070004_audit_actor_snapshots.sql'));
 await db.exec(read('202610070007_notification_space_scope.sql'));
 // Only the existing bounded directory procedure is needed from this migration.
 const directory=read('202610010002_egress_board_directory.sql').match(/create or replace function public\.papa_board_directory\(search_text text\)[\s\S]*?\$\$;/)[0];
 await db.exec(directory);
 await db.exec(read('202610070013_space_player_profiles.sql'));
 await q("insert into papa_spaces(id,slug,display_name) values('space-002','other','Other')");
 await q("insert into papa_space_streamers(streamer_id,space_id) values('room-002','space-002')");
 await q(`update papa_v2_entities set data=jsonb_set(data,'{streamers}',data->'streamers'||
  '[{"id":"room-002","slug":"room-002","display_name":"Native Room","active":true}]') where kind='meta'`);
 const nativeId='原生,玩家)&id=neq.P1'+ '𝄞'.repeat(100);
 const addPlayer=async(id,name)=>{
  const account=(await q('insert into papa_accounts default values returning id'))[0].id;
  const member=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-002','player') returning id",[account]))[0].id;
  await q("insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values('space-002',$1,$2,$3,$4)",[id,account,member,{playerId:id,name,ids:['native-search']}]);
  return {account,member};
 };
 const player=await addPlayer('P1','Native name'),peer=await addPlayer(nativeId,'Native exact target');
 const manager=(await q('insert into papa_accounts default values returning id'))[0].id;
 await q("insert into papa_manager_account_links values('streamer:room-002',$1)",[manager]);
 await q("insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,'space-002','streamer_admin','room-002')",[manager]);
 const president=(await q('insert into papa_accounts default values returning id'))[0].id;
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 const historicalMeta={privatePlatformField:'historical audit remains unchanged',streamers:[{id:'papa'}]};
 await q("insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,after_data) values('room-002','meta','old-native-meta','old','system',$1)",[historicalMeta]);
 await db.exec(read(migration));
 assert.deepEqual((await q("select after_data from papa_events where entity_id='old-native-meta'"))[0].after_data,historicalMeta);
 assert.deepEqual((await q('select id,seq,scope,streamer_id,origin_room,author_key,body,client_id,created_at,updated_at from papa_board_posts where id=$1',[old.id]))[0],
  Object.fromEntries(['id','seq','scope','streamer_id','origin_room','author_key','body','client_id','created_at','updated_at'].map(k=>[k,old[k]])));
 const history=(await q('select space_id,actor_account_id,actor_display_name_snapshot,before_data from papa_board_history'))[0];
 assert.equal(history.space_id,'space-001');assert.equal(history.actor_account_id,null);assert.equal(history.actor_display_name_snapshot,null);assert.deepEqual(history.before_data,{original:'untouched'});
 const names=(await q('select * from papa_communication_player_names($1,$2)',['space-002',['P1',nativeId,'P2']])).sort((a,b)=>a.player_id.localeCompare(b.player_id));
 assert.equal(names.length,2);assert.ok(names.some(r=>r.player_id==='P1'&&r.player_name==='Native name'));
 assert.ok(names.some(r=>r.player_id===nativeId&&r.player_name==='Native exact target'));
 assert.ok((await q("select * from papa_board_directory_in_space('space-002','legacy')")).length===0);
 assert.equal((await q("select * from papa_board_directory_in_space('space-002','native-search')")).length,2);
 await assert.rejects(q('select * from papa_communication_player_names($1,$2)',['space-002',Array(102).fill('P1')]),/COMMUNICATION_SCOPE_INVALID/);
 const actor={role:'player',account_id:player.account,space_id:'space-002',player_id:'P1',streamer_id:'room-002'};
 const host={role:'streamer_admin',account_id:manager,space_id:'space-002',actor_streamer_id:'room-002',streamer_id:'room-002'};
 const superActor={role:'super_admin',account_id:president,streamer_id:'room-002'};
 const key=local=>'space:'+Buffer.from('space-002').toString('hex')+':'+local;
 const roomKey='__global__:'+Buffer.from('space-002').toString('hex');
 const request=crypto.randomUUID();
 const sent=await rpc('papa_chat_send_in_space',['room-002',nativeId,'manager','streamer:room-002','hello',request,'Native Room','wrong caller name','space-002',host]);
 assert.equal((await rpc('papa_chat_send_in_space',['room-002',nativeId,'manager','streamer:room-002','hello',request,'Native Room','ignored','space-002',host])).id,sent.id);
 await assert.rejects(rpc('papa_chat_send_in_space',['room-002',nativeId,'manager','streamer:room-002','changed retry',request,'Native Room','ignored','space-002',host]),/CHAT_REQUEST_REUSED/);
 await assert.rejects(rpc('papa_chat_send_in_space',['room-002',nativeId,'manager','streamer:room-002','too fast',crypto.randomUUID(),'Native Room','ignored','space-002',host]),/CHAT_RATE_LIMIT/);
 const event=(await q('select actor_role,actor_account_id,actor_display_name_snapshot,target_player_name_snapshot,space_id from papa_events where entity_id=$1',[sent.id]))[0];
 assert.deepEqual(event,{actor_role:'streamer_admin',actor_account_id:manager,actor_display_name_snapshot:'Native Room',target_player_name_snapshot:'Native exact target',space_id:'space-002'});
 await assert.rejects(rpc('papa_chat_send_in_space',['papa','P1','player','P1','bad',crypto.randomUUID(),'Legacy Room','Legacy name','space-002',actor]),/COMMUNICATION_SCOPE_INVALID/);
 await assert.rejects(rpc('papa_chat_send_in_space',['room-002','P1','manager','super','bad',crypto.randomUUID(),'Native Room','Native name','space-002',actor]),/COMMUNICATION_ACTOR_INVALID/);
 const page=await rpc('papa_chat_page_in_space',['room-002',nativeId,null,0,'space-002',host]);
 assert.equal(page.rows[0].id,sent.id);assert.equal(page.rows.length,1);
 await rpc('papa_chat_read_in_space',['room-002',nativeId,'player',sent.seq,'space-002',{...actor,account_id:peer.account,player_id:nativeId}]);
 assert.equal((await q('select read_at is not null marked from papa_notifications where entity_id=$1',[sent.id]))[0].marked,true);
 const counts=async()=>({messages:await q('select count(*)::int n from papa_chat_messages'),
  posts:await q('select count(*)::int n from papa_board_posts'),history:await q('select count(*)::int n from papa_board_history'),
  events:await q('select count(*)::int n from papa_events'),notices:await q('select count(*)::int n from papa_notifications')});
 await q("update papa_chat_messages set created_at=now()-interval '10 seconds' where id=$1",[sent.id]);
 const chatBefore=await counts(),chatRetry=crypto.randomUUID();
 await assert.rejects(rpc('papa_chat_send_in_space',['room-002',nativeId,'manager','streamer:room-002','atomic retry',chatRetry,null,'ignored','space-002',host]),/not-null|null value/);
 assert.deepEqual(await counts(),chatBefore,'a failed notification rolls back the message and audit write');
 const retrySent=await rpc('papa_chat_send_in_space',['room-002',nativeId,'manager','streamer:room-002','atomic retry',chatRetry,'Native Room','ignored','space-002',host]);
 await q(`insert into papa_chat_messages(streamer_id,player_id,sender_side,sender_id,body,client_id)
  select 'room-002',$1,'player','bulk fixture','message '||n,gen_random_uuid() from generate_series(1,120) n`,[nativeId]);
 const burst=await q("select seq from papa_chat_messages where sender_id='bulk fixture' order by seq");
 const firstDelta=await rpc('papa_chat_page_in_space',['room-002',nativeId,null,retrySent.seq,'space-002',host]);
 assert.equal(firstDelta.rows.length,51);assert.equal(firstDelta.rows[0].seq,burst[0].seq);assert.equal(firstDelta.rows[50].seq,burst[50].seq);
 const secondDelta=await rpc('papa_chat_page_in_space',['room-002',nativeId,null,firstDelta.rows[49].seq,'space-002',host]);
 assert.equal(secondDelta.rows[0].seq,burst[50].seq,'the pagination sentinel is returned on the next bounded delta');
 const initialPage=await rpc('papa_chat_page_in_space',['room-002',nativeId,null,null,'space-002',host]);
 assert.equal(initialPage.rows.length,51);assert.equal(initialPage.rows[0].seq,burst.at(-1).seq);
 const olderPage=await rpc('papa_chat_page_in_space',['room-002',nativeId,initialPage.rows[49].seq,null,'space-002',host]);
 assert.equal(olderPage.rows[0].seq,burst[69].seq);
 const client=crypto.randomUUID(),payload={scope:'global',space_id:'space-002',streamer_id:roomKey,origin_room:'room-002',root_id:null,
  author_key:key('player:P1'),anonymous:false,visibility:'include',targets:[key('player:'+nativeId)],body:'native root',client_id:client};
 const created=await rpc('papa_board_create_in_space',[payload,[{room:'room-002',name:'Native Room',recipient:nativeId,body:'new post'}],'space-002',actor]);
 assert.equal((await rpc('papa_board_create_in_space',[payload,[],'space-002',actor])).id,created.id);
 await assert.rejects(rpc('papa_board_create_in_space',[{...payload,body:'changed retry'},[],'space-002',actor]),/BOARD_RETRY_CHANGED/);
 await assert.rejects(rpc('papa_board_create_in_space',[{...payload,client_id:crypto.randomUUID()},[],'space-002',actor]),/BOARD_RATE_LIMIT/);
 const audit=(await q('select actor_account_id,actor_display_name_snapshot,target_player_name_snapshot,space_id from papa_board_history where post_id=$1',[created.id]))[0];
 assert.deepEqual(audit,{actor_account_id:player.account,actor_display_name_snapshot:'Native name',target_player_name_snapshot:'Native name',space_id:'space-002'});
 assert.equal((await q("select count(*)::int n from papa_board_posts where streamer_id='__global__'"))[0].n,1);
 assert.equal((await q('select count(*)::int n from papa_board_posts where streamer_id=$1',[roomKey]))[0].n,1);
 await q('insert into papa_board_blocks(space_id,owner_key,target_key) values($1,$2,$3)',['space-002',key('player:P1'),key('player:'+nativeId)]);
 assert.equal((await q('select count(*)::int n from papa_board_blocks'))[0].n,2);
 await assert.rejects(q('insert into papa_board_blocks(space_id,owner_key,target_key) values($1,$2,$3)',['space-002','player:P1','player:P2']),/BOARD_SPACE_MISMATCH/);
 assert.deepEqual(await rpc('papa_board_participants_in_space',[created.id,'space-002']),[key('player:P1')]);
 await assert.rejects(rpc('papa_board_participants_in_space',[old.id,'space-002']),/BOARD_SPACE_MISMATCH/);
 await assert.rejects(rpc('papa_board_create_in_space',[{...payload,client_id:crypto.randomUUID(),root_id:old.id},[],'space-002',actor]),/BOARD_SPACE_MISMATCH/);
 await assert.rejects(rpc('papa_board_create_in_space',[{...payload,client_id:crypto.randomUUID()},[{room:'papa',name:'Legacy Room',recipient:'P1',body:'wrong space'}],'space-002',actor]),/BOARD_SPACE_MISMATCH/);
 await rpc('papa_board_change_in_space',[created.id,1,key('super'),'remove',null,'space-002',superActor]);
 await assert.rejects(rpc('papa_board_change_in_space',[created.id,2,key('player:P1'),'restore',null,'space-002',actor]),/BOARD_MODERATED/);
 await rpc('papa_board_change_in_space',[created.id,2,key('super'),'restore',null,'space-002',superActor]);
 await assert.rejects(rpc('papa_board_change_in_space',[created.id,2,key('super'),'remove',null,'space-002',superActor]),/VERSION_CONFLICT/);
 const boardBefore=await counts(),boardRetry={...payload,author_key:key('super'),body:'atomic board retry',client_id:crypto.randomUUID()};
 await assert.rejects(rpc('papa_board_create_in_space',[boardRetry,[{room:'room-002',name:'Native Room',recipient:nativeId}],'space-002',superActor]),/not-null|null value/);
 assert.deepEqual(await counts(),boardBefore,'a failed notification rolls back the post and history');
 await rpc('papa_board_create_in_space',[boardRetry,[],'space-002',superActor]);
 const verified='verified:'+JSON.stringify(actor);
 await q("select set_config('papa.actor_context','{}',false)");
 await q("insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role) values('__global__','shared_catalog','native-catalog','add',$1)",[verified]);
 const catalog=(await q("select actor_role,actor_player_id,actor_account_id,actor_display_name_snapshot,space_id from papa_events where entity_id='native-catalog'"))[0];
 assert.deepEqual(catalog,{actor_role:'player',actor_player_id:'P1',actor_account_id:player.account,actor_display_name_snapshot:'Native name',space_id:null});
 await assert.rejects(q("insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role) values('__global__','shared_catalog','invalid','add','verified:{}')"),/COMMUNICATION_ACTOR_INVALID/);
 // Exercise the actual native settings wrapper and original A/B transaction.
 // Preserved global metadata must not enter its native room audit snapshots.
 const statement=(sql,name)=>{const start=sql.indexOf('function public.'+name+'(');assert.ok(start>=0);return sql.slice(sql.lastIndexOf('create ',start),sql.indexOf('$$;',start)+3);};
 await db.exec('create table papa_v2_revision(id int primary key,revision bigint not null);insert into papa_v2_revision values(1,0)');
 await db.exec(statement(read('202609170001_party_v2.sql'),'papa_v2_commit'));
 await db.exec(read('202609240001_release_a.sql'));
 await db.exec(statement(read('202609240003_notifications.sql'),'papa_release_b_commit'));
 for(const name of ['202610070011_room_operational_commit.sql','202610070015_room_admin_commit.sql','202610080013_native_room_transactions.sql'])await db.exec(read(name));
 const sourceMeta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 sourceMeta.privatePlatformField='other Space platform secret';sourceMeta.migrationIssues=['other Space migration secret'];
 sourceMeta.streamerSettings={papa:{manual:'other Space room secret'},michelle:{manual:'another Space room secret'},'room-002':{status:'ready',manual:'selected room instructions'}};
 sourceMeta.streamers.find(r=>r.id==='papa').description='other Space streamer secret';
 sourceMeta.streamers.find(r=>r.id==='room-002').privateMetadata='selected room hidden descriptor';
 await q("update papa_v2_entities set data=$1 where kind='meta' and id='1'",[sourceMeta]);
 assert.equal(Number(await rpc('papa_room_admin_commit',[0,[{kind:'settings',id:'1',data:{status:'busy',manual:'selected room instructions'}}],[],{...host,action:'settings'},[],'room-002'])),1);
 const sourceAfter=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 assert.deepEqual(sourceAfter,{...sourceMeta,streamerSettings:{...sourceMeta.streamerSettings,'room-002':{status:'busy',manual:'selected room instructions'}}},'only the selected stored settings change; full preserved source stays intact');
 const metaEvent=(await q("select before_data,after_data from papa_events where streamer_id='room-002' and entity_kind='meta' and action='settings' order by id desc limit 1"))[0];
 for(const value of [metaEvent.before_data,metaEvent.after_data]){
  assert.deepEqual(Object.keys(value).sort(),['streamerSettings','streamers']);
  assert.deepEqual(Object.keys(value.streamerSettings),['room-002']);assert.equal(value.streamers.length,1);assert.equal(value.streamers[0].id,'room-002');
  assert.equal(JSON.stringify(value).includes('other Space'),false);assert.equal(JSON.stringify(value).includes('another Space'),false);
  assert.equal(JSON.stringify(value).includes('hidden descriptor'),false);assert.equal(value.migrationIssues,undefined);
 }
 assert.equal(metaEvent.before_data.streamerSettings['room-002'].status,'ready');assert.equal(metaEvent.after_data.streamerSettings['room-002'].status,'busy');
 assert.equal((await q("select provolatile from pg_proc where proname='papa_native_meta_audit_projection'"))[0].provolatile,'i');
 const captured=structuredClone(metaEvent);
 await q("update papa_v2_entities set data=jsonb_set(data,'{streamerSettings,room-002,status}','\"later\"') where kind='meta' and id='1'");
 assert.deepEqual((await q("select before_data,after_data from papa_events where streamer_id='room-002' and entity_kind='meta' and action='settings' order by id desc limit 1"))[0],captured,'audit projection uses supplied historic values, not live metadata');
 assert.deepEqual((await q("select after_data from papa_events where entity_id='old-native-meta'"))[0].after_data,historicalMeta);
 // The original Space 001 procedure's side effects and cross-room board use remain valid.
 const legacy=await rpc('papa_chat_send_in_space',['papa','P1','player','P1','legacy hello',crypto.randomUUID(),'Legacy Room','ignored','space-001',{role:'player',space_id:'space-001',player_id:'P1'}]);
 assert.equal((await q('select actor_display_name_snapshot,space_id from papa_events where entity_id=$1',[legacy.id]))[0].actor_display_name_snapshot,'Legacy name');
 const legacyBoard={scope:'streamer',space_id:'space-001',streamer_id:'michelle',origin_room:'michelle',root_id:null,author_key:'streamer:papa',anonymous:false,visibility:'public',targets:[],body:'other legacy room',client_id:crypto.randomUUID()};
 await rpc('papa_board_create_in_space',[legacyBoard,[],'space-001',{role:'streamer_admin',space_id:'space-001',actor_streamer_id:'papa',streamer_id:'michelle'}]);
 await q("update papa_space_memberships set status='suspended' where id=$1",[player.member]);
 await assert.rejects(rpc('papa_board_change_in_space',[created.id,3,key('player:P1'),'edit','denied','space-002',actor]),/COMMUNICATION_ACTOR_INVALID/);
 await db.exec('set role anon');
 await assert.rejects(q("select * from papa_communication_player_names('space-002',array['P1'])"),/permission denied/);
 await assert.rejects(q("select papa_board_participants_in_space($1,'space-002')",[created.id]),/permission denied/);
 await db.exec('reset role');
});

function backend(file,handler){
 const requests=[];
 const context=vm.createContext({...chatPolicy,...boardPolicy,TextEncoder,crypto,console,
  scopeState:(s,id)=>({currentStreamer:s.streamers.find(r=>r.id===id||r.slug===id)}),schedulePush(){},
  api:async(path,body)=>{requests.push({path,body});return handler(path,body);}});
 vm.runInContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/party-api/'+file,'utf8').replace(/^import .*;\r?\n/gm,'')),context);
 const state={streamers:[{id:'room-002',slug:'room-002',display_name:'Native Room',active:true,spaceId:'space-002'}]};
 return {requests,request:async(body,who)=>{context.body=body;context.who=who;context.state=state;return vm.runInContext((file==='chat.ts'?'chatOperation':'boardOperation')+'(body,who,state)',context);}};
}
test('native chat uses exact bounded RPC parameters and rejects forged player/Space before metadata reads',async()=>{
 const id='原生,玩家)&id=neq.P1'+'𝄞'.repeat(100),who={role:'player',playerId:id,spaceId:'space-002',accountId:crypto.randomUUID()};
 const edge=backend('chat.ts',(path,body)=>{
  if(path.endsWith('papa_communication_player_names'))return [{player_id:id,player_name:'Native player'}];
  if(path.endsWith('papa_chat_page_in_space'))return {rows:[{id:'m',seq:5,body:'hello'}],receipts:[{reader:'streamer',last_seq:5}]};
  if(path.endsWith('papa_chat_send_in_space'))return {id:'sent',seq:6};
  throw Error('Unexpected path '+path);
 });
 const result=await edge.request({op:'chatMessages',streamer:'room-002',after:0},who);
 assert.equal(result.playerName,'Native player');assert.equal(result.recipientRead,5);
 assert.equal(edge.requests.length,2);assert.deepEqual([...edge.requests[0].body.chosen_players],[id]);
 assert.equal(edge.requests[1].body.player,id);assert.equal(edge.requests[1].body.after_seq,0);
 assert.ok(edge.requests.every(r=>!r.path.includes('papa_v2_entities')&&!r.path.includes('snapshot')&&!r.path.includes(id)));
 const count=edge.requests.length;
 await assert.rejects(edge.request({op:'chatMessages',streamer:'room-002',playerId:'P1'},who),/無法查看/);
 await assert.rejects(edge.request({op:'chatMessages',streamer:'room-002'},{...who,spaceId:'space-001'}),/無法查看/);
 assert.equal(edge.requests.length,count);
 await edge.request({op:'chatSend',streamer:'room-002',body:'message',clientId:crypto.randomUUID()},who);
 assert.equal(edge.requests.at(-1).body.actor_context.account_id,who.accountId);
 assert.equal(edge.requests.at(-1).body.sender,id);
});
test('native board qualifies stored global ownership and targets while preserving local audience and anonymous projection',async()=>{
 const namespace='space:'+Buffer.from('space-002').toString('hex')+':',roomKey='__global__:'+Buffer.from('space-002').toString('hex');
 const id='原生,玩家)&id=neq.P1',postId=crypto.randomUUID(),requests=[];
 const post={id:postId,seq:1,scope:'global',space_id:'space-002',streamer_id:roomKey,origin_room:'room-002',root_id:null,author_key:namespace+'player:'+id,
  anonymous:true,visibility:'include',targets:[namespace+'player:P1'],body:'private',deleted:false,version:1};
 const edge=backend('board.ts',(path,body)=>{
  requests.push({path,body});
  if(path.includes('papa_board_blocks'))return [];
  if(path.includes('papa_board_posts'))return [post];
  if(path.endsWith('papa_communication_player_names'))return [{player_id:id,player_name:'Native target'}];
  if(path.endsWith('papa_board_recipient_blocks_in_space'))return [];
  if(path.endsWith('papa_board_create_in_space'))return {id:crypto.randomUUID(),seq:2};
  throw Error('Unexpected path '+path);
 });
 const who={role:'player',playerId:'P1',spaceId:'space-002',accountId:crypto.randomUUID()};
 const visible=await edge.request({op:'boardList',streamer:'room-002',scope:'global'},who);
 assert.equal(visible.rows[0].author,'匿名使用者');assert.equal(visible.rows[0].author_key,undefined);
 assert.equal(edge.requests.filter(r=>r.path.endsWith('papa_communication_player_names')).length,0);
 assert.ok(edge.requests.find(r=>r.path.includes('papa_board_posts')).path.includes('space_id=eq.space-002'));
 await edge.request({op:'boardCreate',streamer:'room-002',scope:'global',visibility:'include',targets:['player:'+id],body:'hello',clientId:crypto.randomUUID()},who);
 const create=edge.requests.at(-1).body;
 assert.equal(create.payload.streamer_id,roomKey);assert.equal(create.payload.author_key,namespace+'player:P1');
 assert.deepEqual([...create.payload.targets],[namespace+'player:'+id]);assert.equal(create.notices.find(n=>n.recipient===id).room,'room-002');
 const count=edge.requests.length;
 await assert.rejects(edge.request({op:'boardList',streamer:'room-002',scope:'global'},{...who,spaceId:'space-001'}),/無權查看/);
 assert.equal(edge.requests.length,count);
});
