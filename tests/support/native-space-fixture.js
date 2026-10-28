// A full-schema database seeded like production's first Space (聲瑪) plus helpers
// that create new Spaces through the real president operations of the Edge.
import {randomUUID} from 'node:crypto';
import {createFullSchemaDb} from './full-schema-db.js';
import {loadEdge} from './edge-harness.js';
import {empty,mutate,upgradePlatform} from '../../src/core.js';
import {stateEntries} from '../../src/state-patch.js';

export const PRESIDENT_PASSWORD='president-secret-2026';
const at='2026-10-28T01:00:00Z';

export async function nativeFixture(t,{log=null}={}){
 const f=await createFullSchemaDb(t,{president_password:PRESIDENT_PASSWORD});
 let state=mutate(empty(),{type:'song',data:{title:'聲瑪的歌',artist:'Artist'}},{role:'admin'},at);
 state.players=[{playerId:'P1',name:'聲瑪玩家',ids:['sm-1'],password:'p1-pass'}];
 state=upgradePlatform(state);
 for(const entry of stateEntries(state))await f.q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[entry.kind,entry.id,entry.data]);
 const edge=loadEdge(f.db,{adminUser:null,log});
 const call=(body,token)=>edge.call(token?{...body,token}:body);
 const login=await call({op:'adminLogin',password:PRESIDENT_PASSWORD});
 if(login.status!==200)throw Error('president login failed: '+JSON.stringify(login.body));
 const president={token:login.body.token,accountId:(await f.q("select account_id from papa_manager_account_links where manager_key='president'"))[0].account_id};
 const settings=()=>edge.context&&null;
 const provision=async({name,slug,password,mode='independent',spaceId=null,loginEnabled=true})=>{
  const result=await call({op:'platformProvisionStreamer',operationId:randomUUID(),mode,...(mode==='independent'?{spaceName:name}:{spaceId}),
   descriptor:{display_name:name,slug},password,loginEnabled},president.token);
  if(result.status!==200)throw Error('provision failed: '+JSON.stringify(result.body));
  return result.body;
 };
 const spaceRow=async id=>(await f.q('select * from papa_spaces where id=$1',[id]))[0];
 const setSpaceStatus=async(spaceId,action)=>call({op:'platformManageSpace',operationId:randomUUID(),action,payload:{spaceId,revision:Number((await spaceRow(spaceId)).management_revision)}},president.token);
 // 聲瑪's own business rows plus its entries in the shared registry row.
 const shengma=async()=>JSON.stringify([
  await f.q(`select kind,id,space_id,md5(data::text) h from papa_v2_entities where kind not in ('meta') and coalesce(space_id,'space-001')='space-001' order by kind,id`),
  await f.q(`select md5(coalesce(jsonb_agg(room order by room->>'id'),'[]')::text) rooms,md5((data->'streamerSettings'->'papa')::text) papa from papa_v2_entities cross join lateral jsonb_array_elements(data->'streamers') room where kind='meta' and id='1' and room->>'id' in (select streamer_id from papa_space_streamers where space_id='space-001') group by data`)]);
 const fingerprint=async()=>shengma();
 return {...f,edge,call,president,provision,spaceRow,setSpaceStatus,fingerprint};
}
