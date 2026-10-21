// This runs only inside the service adapter, after the Edge built RPC arguments
// from its verified actor. Caller request bodies never enter this function raw.
const guarded=new Set(['papa_catalog_import_link_batch','papa_catalog_link_room_song','papa_catalog_report_issue','papa_catalog_language_filter_save','papa_catalog_lyric_choice','papa_catalog_batch_add','papa_achievement_visibility_set','papa_achievement_manual_grant','papa_achievement_manual_grant_batch','papa_achievement_revoke','papa_manage_player_extra_quota','papa_public_route_save']);
export function managementRpcRequest(path,body,verifiedContext){
 const name=/^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(path)?.[1];
 if(!guarded.has(name))return {path,body};
 let context=verifiedContext||body?.actor_context;
 if(!context&&typeof body?.actor_id==='string'&&body.actor_id.startsWith('verified:')){
  try{context=JSON.parse(body.actor_id.slice(9));}catch{throw Error('管理登入身分尚未確認');}
 }
 if(context?.role!=='streamer_admin')return {path,body};
 if(!context.account_id||!context.actor_streamer_id||!context.space_id)throw Error('管理登入身分尚未確認');
 return {path:'/rest/v1/rpc/papa_management_guarded_rpc',body:{rpc_name:name,arguments:body,actor_context:context}};
}
