// Service RPC adapter. All authority comes from the already verified actor;
// body.actor_context, role, Account and claimed source scope are never copied.
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=200&&value.trim()===value&&!/[\u0000-\u0020\u007f-\u009f]/u.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
const route=value=>typeof value==='string'&&value.length<=123&&/^\/[A-Za-z0-9][A-Za-z0-9.-]{0,80}(\/[A-Za-z0-9][A-Za-z0-9-]{0,39})?$/.test(value);
const kinds=new Set(['hall','streamer']),layouts=new Set(['flat','hall','independent']);

function target(body){
 if(!object(body)||!identity(body.spaceId))throw Error('專屬網址範圍不正確');
 // Existing transport may attach `streamer` as a navigation slug. It is never
 // a stable target ID and must not override an explicit hall/null target.
 const kind=body.kind??'streamer',room=body.streamerId??null;
 if(!kinds.has(kind)||(kind==='hall')!==(room===null)||room!==null&&!identity(room))throw Error('專屬網址範圍不正確');
 return {requested_space:body.spaceId,requested_room:room,requested_kind:kind};
}
function actor(who){
 if(!object(who)||!['super_admin','streamer_admin'].includes(who.role))throw Error('請先以主播或總裁身分登入');
 const account=who.accountId,space=who.spaceId??null,room=who.streamer_id??null;
 if(!uuid(account)||who.role==='streamer_admin'&&(!identity(space)||!identity(room)))throw Error('登入身分尚未確認');
 return {role:who.role,account_id:account,space_id:space,actor_streamer_id:room};
}
function change(body){
 if(typeof body.code!=='string'||body.code.length>40||body.layout!==undefined&&!layouts.has(body.layout))throw Error('請輸入正確的網址代碼');
 return {desired_code:body.code,requested_layout:body.layout??null};
}
// Whitelist responses, even if future database metadata includes private fields.
function projection(value,{nullable=false,availability=false,mutation=false,scope=null}={}){
 if(value===null&&nullable)return null;
 if(!object(value)||value.version!==1||!identity(value.spaceId)||!kinds.has(value.kind)
  ||(value.kind==='hall')!==(value.streamerId===null)||value.streamerId!==null&&!identity(value.streamerId)
  ||typeof value.configured!=='boolean'||!Number.isSafeInteger(value.revision)||value.revision<0
  ||value.layout!==null&&!layouts.has(value.layout)||value.canonicalPath!==null&&!route(value.canonicalPath)
  ||value.streamerSlug!==null&&!identity(value.streamerSlug)||value.code!==null&&(typeof value.code!=='string'||value.code.length>40)
  ||value.spaceCode!==null&&(typeof value.spaceCode!=='string'||value.spaceCode.length>40)
  ||scope&&(value.spaceId!==scope.requested_space||value.streamerId!==scope.requested_room||value.kind!==scope.requested_kind))throw Error('專屬網址資料尚未確認');
 const result={version:1,spaceId:value.spaceId,streamerId:value.streamerId,streamerSlug:value.streamerSlug,kind:value.kind,
  configured:value.configured,layout:value.layout,spaceCode:value.spaceCode,code:value.code,revision:value.revision,canonicalPath:value.canonicalPath};
 if(value.matchedPath!==undefined){if(!route(value.matchedPath)||typeof value.isAlias!=='boolean')throw Error('專屬網址資料尚未確認');result.matchedPath=value.matchedPath;result.isAlias=value.isAlias;}
 if(availability){if(typeof value.available!=='boolean'||value.reason!==null&&!['invalid_code','space_not_configured','reserved_history_or_in_use'].includes(value.reason)
   ||value.proposedPath!==undefined&&value.proposedPath!==null&&!route(value.proposedPath))throw Error('網址檢查結果尚未確認');
  result.available=value.available;result.reason=value.reason;if(value.proposedPath!==undefined)result.proposedPath=value.proposedPath;}
 if(mutation){if(typeof value.changed!=='boolean')throw Error('網址儲存結果尚未確認');result.changed=value.changed;}
 return result;
}

export function createPublicRoutes({api}){
 const rpc=(name,args)=>api('/rest/v1/rpc/papa_public_route_'+name,args);
 const management=(who,body)=>({...target(body),actor_context:actor(who)});
 return {
  async resolve(path){if(!route(path))return null;return projection(await rpc('resolve',{requested_path:path}),{nullable:true});},
  async info(body){const args=target(body);return projection(await rpc('info',args),{nullable:true,scope:args});},
  async settings(who,body){const args=management(who,body);return projection(await rpc('settings',args),{scope:args});},
  async check(who,body){const args={...management(who,body),...change(body)};return projection(await rpc('check',args),{availability:true,scope:args});},
  async save(who,body){const args={...management(who,body),...change(body)};
   if(!Number.isSafeInteger(body.revision)||body.revision<0)throw Error('網址版本已變更，請重新讀取');
   return projection(await rpc('save',{...args,expected_revision:body.revision}),{mutation:true,scope:args});}
 };
}
