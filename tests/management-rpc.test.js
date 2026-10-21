import test from 'node:test';
import assert from 'node:assert/strict';
import {managementRpcRequest} from '../supabase/functions/party-api/management-rpc.js';
const ctx={role:'streamer_admin',account_id:'a',space_id:'h',actor_streamer_id:'r'};
test('delegated writes use atomic guard without changing original RPC arguments',()=>{
 for(const name of ['papa_achievement_manual_grant','papa_achievement_visibility_set','papa_manage_player_extra_quota','papa_public_route_save']){
  const body={actor_context:ctx,requested_room:'r',requested_space:'h'};
  const result=managementRpcRequest('/rest/v1/rpc/'+name,body);
  assert.equal(result.path,'/rest/v1/rpc/papa_management_guarded_rpc');assert.equal(result.body.arguments,body);assert.equal(result.body.actor_context,ctx);
 }
 const actor_id='verified:'+JSON.stringify(ctx),body={actor_id,room_id:'r'};
 assert.deepEqual(managementRpcRequest('/rest/v1/rpc/papa_catalog_batch_add',body).body.actor_context,ctx);
 const report={room_id:'r'};assert.equal(managementRpcRequest('/rest/v1/rpc/papa_catalog_report_issue',report,ctx).body.arguments,report);
});
test('read and president/player calls retain established paths; malformed delegated context fails closed',()=>{
 for(const role of ['super_admin','player']){const body={actor_context:{...ctx,role}};assert.equal(managementRpcRequest('/rest/v1/rpc/papa_achievement_manual_grant',body).body,body);}
 assert.equal(managementRpcRequest('/rest/v1/rpc/papa_management_directory',{}).path,'/rest/v1/rpc/papa_management_directory');
 assert.throws(()=>managementRpcRequest('/rest/v1/rpc/papa_catalog_batch_add',{actor_id:'verified:bad'}),/尚未確認/);
 assert.throws(()=>managementRpcRequest('/rest/v1/rpc/papa_achievement_manual_grant',{actor_context:{role:'streamer_admin'}}),/尚未確認/);
});
