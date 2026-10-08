// Shared client lifecycle. Storage/locking are platform adapters; the server
// chooses account, role and Space. No polling or background refresh timer.
const roles=new Set(['player','streamer_admin','super_admin']);
const roleKey=role=>role==='player'?'player':'manager';
export function createDeviceSessions({transport,store,lock,installationId,platform,appVersion,now=Date.now}){
 const access=new Map();
 const validRole=role=>{if(!roles.has(role))throw Error('登入身分不正確');return roleKey(role);};
 const usable=record=>record&&typeof record.sessionId==='string'&&record.sessionId.length>0&&typeof record.refreshToken==='string'&&record.refreshToken.startsWith('refresh:')&&roles.has(record.role);
 const text=value=>typeof value==='string'&&value.length>0;
 function scopeMetadata(result){
  const metadata={};
  for(const field of ['selectedSpace','homeSpace','lastSpace'])if(result[field]!==undefined){
   const space=result[field];
   if(space===null){metadata[field]=null;continue;}
   if(!space||typeof space!=='object'||!text(space.id)||!text(space.slug)||
    space.name!==undefined&&typeof space.name!=='string'||space.streamerId!=null&&!text(space.streamerId))throw Error('裝置登入身分不一致，請重新登入');
   metadata[field]={id:space.id,slug:space.slug,...(space.name!==undefined?{name:space.name}:{}),
    ...(space.streamerId!==undefined?{streamerId:space.streamerId}: {})};
  }
  if(result.spaceSlug!==undefined){if(result.spaceSlug!==null&&!text(result.spaceSlug))throw Error('裝置登入身分不一致，請重新登入');metadata.spaceSlug=result.spaceSlug;}
  if(result.selectedStreamerId!==undefined){if(result.selectedStreamerId!==null&&!text(result.selectedStreamerId))throw Error('裝置登入身分不一致，請重新登入');metadata.selectedStreamerId=result.selectedStreamerId;}
  return metadata;
 }
 const registration=(result,role)=>({sessionId:result.sessionId,refreshToken:result.refreshToken,role,
  spaceId:result.spaceId||null,streamerId:result.streamerId||null,
  ...(role==='player'&&result.playerId?{playerId:result.playerId,loginId:result.loginId||''}:{}),...scopeMetadata(result)});
 const matches=(record,role,scope)=>record.role===role&&
  (!scope.sessionId||record.sessionId===scope.sessionId)&&(!scope.spaceId||record.spaceId===scope.spaceId)&&
  (!scope.streamerId||record.streamerId===scope.streamerId)&&(!scope.playerId||!record.playerId||record.playerId===scope.playerId);
 const publicIdentity=record=>{const {sessionId,role,spaceId,streamerId,playerId,loginId}=record;return {sessionId,role,spaceId,streamerId,
  ...(playerId?{playerId,loginId}: {}),...scopeMetadata(record)};};
 async function revoke(record){if(usable(record))await transport({op:'deviceLogout',sessionId:record.sessionId,refreshToken:record.refreshToken}).catch(()=>{});}
 const expires=result=>now()+Math.min(43200,Math.max(0,Number(result.expiresIn)||0))*1000;
 function verified(result,expected){
  if(typeof result?.token!=='string'||!result.token.startsWith('device:')||typeof result.refreshToken!=='string'||!result.refreshToken.startsWith('refresh:')||result.sessionId!==expected.sessionId||result.role!==expected.role||
   (result.spaceId||null)!==(expected.spaceId||null)||(result.streamerId||null)!==(expected.streamerId||null)||(expected.playerId&&result.playerId!==expected.playerId)||!Number.isFinite(Number(result.expiresIn))||Number(result.expiresIn)<=0)
   throw Error('裝置登入身分不一致，請重新登入');
  return {...registration(result,result.role),...scopeMetadata(expected),...scopeMetadata(result)};
 }
 async function refresh(key,record){
  let result;
  try{result=await transport({op:'deviceRefresh',sessionId:record.sessionId,refreshToken:record.refreshToken});}
  catch(error){
   // Network errors do not erase a still-valid long-lived credential.
   if(error?.authExpired){await store.remove(key);access.delete(key);}throw error;
  }
  let next;
  try{next=verified(result,record);}catch(error){access.delete(key);await store.remove(key).catch(()=>{});await revoke({...result,role:record.role});throw error;}
  // Persist the rotated credential before making the new access token usable.
  // A storage failure must not leave another tab using the spent refresh token.
  try{await store.set(key,next);}catch(error){access.delete(key);await store.remove(key).catch(()=>{});await revoke(next);throw error;}
  access.set(key,{token:result.token,until:expires(result),record:next});return result.token;
 }
 return {
  async remember(role,token,scope={}){
   const key=validRole(role);return lock(key,async()=>{
    if(await store.get(key))throw Error('請先登出目前裝置身分');
    const start=await transport({op:'deviceStart',token,installationId,platform,appVersion,streamer:scope.streamer});
    const serverRole=start.role==='president'?'super_admin':start.role;
    if(serverRole!==role||typeof start.sessionId!=='string'||!start.sessionId||typeof start.refreshToken!=='string'||!start.refreshToken.startsWith('refresh:')){await revoke({...start,role:serverRole});throw Error('裝置登入身分不一致，請重新登入');}
    let record;try{record=registration(start,role);}catch(error){await revoke({...start,role});throw error;}
    try{await store.set(key,record);}catch(error){await revoke(record);throw error;}
    try{return await refresh(key,record);}catch(error){error.deviceRegistered=true;throw error;}
   });
  },
  async switchSpace(role,scope={},expected={}){
   const key=validRole(role),slug=typeof scope.slug==='string'?scope.slug.trim():'';
   if(!slug||slug.length>100||scope.streamer!==undefined&&(!text(scope.streamer)||scope.streamer.length>200))throw Error('請選擇有效 Space');
   return lock(key,async()=>{
    const record=await store.get(key);
    if(!record){access.delete(key);throw Error('請先登入裝置');}
    if(!usable(record)){access.delete(key);await store.remove(key);throw Error('裝置登入資料不完整，請重新登入');}
    if(!matches(record,role,expected))throw Error('此登入不適用目前頁面');
    let start;
    try{start=await transport({op:'deviceSwitchSpace',sessionId:record.sessionId,refreshToken:record.refreshToken,slug,
     ...(scope.streamer!==undefined?{streamer:scope.streamer}: {})});}
    catch(error){if(error?.authExpired){access.delete(key);await store.remove(key).catch(()=>{});}throw error;}
    let next;
    try{
     const serverRole=start?.role==='president'?'super_admin':start?.role;
     if(!usable({...start,role:serverRole})||serverRole!==role||start.sessionId===record.sessionId||start.refreshToken===record.refreshToken||
      start.spaceSlug!==slug||start.selectedSpace?.slug!==slug||!text(start.selectedSpace?.id)||
      (role==='super_admin'?(start.spaceId!=null||start.streamerId!=null):start.spaceId!==start.selectedSpace.id)||
      (role==='player'&&(!text(start.playerId)||start.streamerId!=null))||
      (role==='streamer_admin'&&(!text(start.streamerId)||start.streamerId!==record.streamerId))||
      (scope.streamer!==undefined&&!text(start.selectedStreamerId)))throw Error('裝置登入身分不一致，請重新登入');
     next=registration(start,role);
    }catch(error){access.delete(key);await store.remove(key).catch(()=>{});await revoke({...start,role});throw error;}
    access.delete(key);
    try{await store.set(key,next);}catch(error){await store.remove(key).catch(()=>{});await revoke(next);throw error;}
    try{return await refresh(key,next);}catch(error){error.deviceRegistered=true;error.deviceIdentity=publicIdentity(next);throw error;}
   });
  },
  async token(role,scope={}){
   const key=validRole(role);return lock(key,async()=>{
    const record=await store.get(key);if(!record){access.delete(key);return null;}
    if(!usable(record)){access.delete(key);await store.remove(key);throw Error('裝置登入資料不完整，請重新登入');}
    if(!matches(record,role,scope))throw Error('此登入不適用目前頁面');
    const cached=access.get(key);
    // Other tabs may rotate the refresh credential; issued access tokens remain
    // valid until expiry or server-side revocation. Do not rotate just because
    // a different tab refreshed this same device session.
    if(cached?.record.sessionId===record.sessionId&&cached.until>now()+30000)return cached.token;
    return refresh(key,record);
   });
  },
  async logout(role){
   const key=validRole(role);return lock(key,async()=>{
    const record=await store.get(key);
    if(record){try{await transport({op:'deviceLogout',sessionId:record.sessionId,refreshToken:record.refreshToken});}catch(error){if(!error?.authExpired)throw error;}}
    await store.remove(key);access.delete(key);
   });
  },
  async identity(role,scope={}){const key=validRole(role);return lock(key,async()=>{const record=await store.get(key);if(!usable(record)||!matches(record,role,scope))return null;
   const cached=access.get(key);if(scope.token&&(cached?.token!==scope.token||cached.record.sessionId!==record.sessionId))return null;
   return publicIdentity(record);
  });},
  forgetAccess(){access.clear();}
 };
}
