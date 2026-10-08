// Shared client lifecycle. Storage/locking are platform adapters; the server
// chooses account, role and Space. No polling or background refresh timer.
const roles=new Set(['player','streamer_admin','super_admin']);
const roleKey=role=>role==='player'?'player':'manager';
export function createDeviceSessions({transport,store,lock,installationId,platform,appVersion,now=Date.now}){
 const access=new Map();
 const validRole=role=>{if(!roles.has(role))throw Error('登入身分不正確');return roleKey(role);};
 const usable=record=>record&&typeof record.sessionId==='string'&&record.sessionId.length>0&&typeof record.refreshToken==='string'&&record.refreshToken.startsWith('refresh:')&&roles.has(record.role);
 async function revoke(record){if(usable(record))await transport({op:'deviceLogout',sessionId:record.sessionId,refreshToken:record.refreshToken}).catch(()=>{});}
 const expires=result=>now()+Math.min(43200,Math.max(0,Number(result.expiresIn)||0))*1000;
 function verified(result,expected){
  if(typeof result?.token!=='string'||!result.token.startsWith('device:')||typeof result.refreshToken!=='string'||!result.refreshToken.startsWith('refresh:')||result.sessionId!==expected.sessionId||result.role!==expected.role||
   (expected.spaceId&&result.spaceId!==expected.spaceId)||(expected.streamerId&&result.streamerId!==expected.streamerId)||!Number.isFinite(Number(result.expiresIn))||Number(result.expiresIn)<=0)
   throw Error('裝置登入身分不一致，請重新登入');
  return {sessionId:result.sessionId,refreshToken:result.refreshToken,role:result.role,spaceId:result.spaceId||null,streamerId:result.streamerId||null};
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
    const record={sessionId:start.sessionId,refreshToken:start.refreshToken,role,spaceId:start.spaceId||null,streamerId:start.streamerId||null};
    try{await store.set(key,record);}catch(error){await revoke(record);throw error;}
    try{return await refresh(key,record);}catch(error){error.deviceRegistered=true;throw error;}
   });
  },
  async token(role,scope={}){
   const key=validRole(role);return lock(key,async()=>{
    const record=await store.get(key);if(!record){access.delete(key);return null;}
    if(!usable(record)){access.delete(key);await store.remove(key);throw Error('裝置登入資料不完整，請重新登入');}
    if(record.role!==role||(scope.spaceId&&record.spaceId!==scope.spaceId)||(scope.streamerId&&record.streamerId!==scope.streamerId))throw Error('此登入不適用目前頁面');
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
  async identity(role){const key=validRole(role);return lock(key,async()=>{const record=await store.get(key);if(!usable(record)||record.role!==role)return null;const {sessionId,role:kind,spaceId,streamerId}=record;return {sessionId,role:kind,spaceId,streamerId};});},
  forgetAccess(){access.clear();}
 };
}
