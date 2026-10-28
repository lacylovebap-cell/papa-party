// End to end: the real Edge handler and the real database schema price a 聲瑪
// live request with the shared pricing engine and refuse a lone half song.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFullSchemaDb} from './support/full-schema-db.js';
import {loadEdge} from './support/edge-harness.js';
import {empty,mutate,upgradePlatform} from '../src/core.js';
import {stateEntries} from '../src/state-patch.js';

const at='2026-10-28T01:00:00Z',admin={role:'admin'};
async function fixture(t){
 const f=await createFullSchemaDb(t);
 let s=empty();const run=(type,data)=>s=mutate(s,{type,data},admin,at);
 run('player',{name:'玩家甲',ids:['a1'],password:'pw-1234',balance:5});
 run('song',{title:'長歌',artist:'歌手',creditCost:2});
 run('song',{title:'半首歌',artist:'歌手',creditCost:0.5,shortMode:'repeat'});
 s=upgradePlatform(s);
 for(const entry of stateEntries(s))await f.q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[entry.kind,entry.id,entry.data]);
 const edge=loadEdge(f.db,{adminUser:null});
 const login=await edge.call({op:'login',streamer:'papa',playerId:s.players[0].playerId,password:'pw-1234',loginId:'a1'});
 assert.equal(login.status,200,JSON.stringify(login.body));
 const token=login.body.token;
 const revision=async()=>(await edge.call({op:'read',streamer:'papa',token})).body.state.revision;
 const request=async(song,extra={})=>edge.call({op:'mutate',streamer:'papa',token,revision:await revision(),operationId:randomUUID(),
  action:{type:'request',data:{songId:song.songId,kind:'live',giftConfirmed:true,expectedSong:{title:song.title,artist:song.artist},...extra}}});
 const queue=async()=>(await f.q("select data from papa_v2_entities where kind='queue' order by data->>'at'")).map(r=>r.data);
 return {f,s,request,queue};
}

test('a 2-slot live request is priced by the cheapest legal plan for all three parties and stored with its fees',async t=>{
 const {s,request,queue}=await fixture(t);
 const r=await request(s.songs[0]);assert.equal(r.status,200,JSON.stringify(r.body));
 const [q]=await queue();
 assert.equal(q.creditCost,2);assert.equal(q.price,5555);assert.equal(q.double,990);
 assert.deepEqual([q.fees.singer,q.fees.host,q.fees.hall,q.fees.source],[5555,990,990,'plan']);
 assert.deepEqual(q.fees.plans.map(p=>p.name),['一般 2 首']);
});

test('a lone half song is refused by the server; sung twice it is one slot at the ordinary price',async t=>{
 const {s,request,queue}=await fixture(t);
 const half=s.songs[1];
 const refused=await request(half);
 assert.equal(refused.status,400);assert.match(refused.body.error,/半首歌不能單獨點/);
 assert.equal((await queue()).length,0);
 const twice=await request(half,{pairSongId:half.songId,expectedPair:{title:half.title,artist:half.artist}});
 assert.equal(twice.status,200,JSON.stringify(twice.body));
 const [q]=await queue();
 assert.equal(q.creditCost,1);assert.equal(q.items[0].performances,2);
 assert.deepEqual([q.price,q.fees.host,q.fees.hall],[2990,500,500]);
});
