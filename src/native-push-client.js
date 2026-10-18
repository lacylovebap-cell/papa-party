// Unconnected native adapter: the host supplies its OS push token and an
// authenticated transport. Nothing is stored, polled, or sent on construction.
// Pin expectedDeviceSessionId when subscribing to OS token/permission events.
// Call invalidate(role) before logout/Space switch; never rebind an old event to
// the replacement identity. The server remains the authorization authority.
const roles=new Set(['player','streamer_admin','super_admin']);
const permissions=new Set(['granted','prompt','denied','unsupported']);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const errors={input:'原生推播資料不完整或不正確',identity:'登入身分已變更，請重新啟用推播',failed:'原生推播設定未完成，請稍後再試',result:'原生推播設定尚未確認'};
const failure=code=>Object.assign(new Error(errors[code]),{code:'NATIVE_PUSH_'+code.toUpperCase()});
const scopeFields=['spaceId','streamerId','playerId'];
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=200&&value.trim()===value&&!/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const sameIdentity=(a,b)=>a.sessionId===b.sessionId&&a.role===b.role&&scopeFields.every(field=>a[field]===b[field]);

export function createNativePushClient({sessions,transport,platform}={}){
 const pushTransport=platform==='android'?'fcm':platform==='desktop'?'desktop_os':null;
 if(!pushTransport||typeof transport!=='function'||typeof sessions?.token!=='function'||typeof sessions?.identity!=='function')throw failure('input');
 const makeSlot=()=>({generation:0,tail:Promise.resolve(),pending:new Map(),lastKey:null,lastTask:null});
 const slots={player:makeSlot(),manager:makeSlot()};
 const slotFor=role=>{if(!roles.has(role))throw failure('input');return slots[role==='player'?'player':'manager'];};
 const assertCurrent=(slot,generation)=>{if(slot.generation!==generation)throw failure('identity');};
 function requestFor(op,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!uuid(input.expectedDeviceSessionId))throw failure('input');
  const given=input.scope??{};
  if(!given||typeof given!=='object'||Array.isArray(given)||Object.keys(given).some(key=>!['sessionId',...scopeFields].includes(key)))throw failure('input');
  if(given.sessionId!==undefined&&given.sessionId!==input.expectedDeviceSessionId)throw failure('identity');
  const scope={sessionId:input.expectedDeviceSessionId};
  for(const field of scopeFields)if(given[field]!==undefined){if(given[field]!==null&&!validId(given[field]))throw failure('input');scope[field]=given[field];}
  if(op==='nativePushDisable'){
   if(!uuid(input.registrationId))throw failure('input');
   return {op,scope,registrationId:input.registrationId};
  }
  const permission=input.permission===undefined?'granted':input.permission;
  // All four permission states use the existing server contract: a real token
  // is required. A host without a token must defer; do not invent a destination.
  if(!permissions.has(permission)||typeof input.destination!=='string'||input.destination.length<8||input.destination.length>4096||/[\s\u0000-\u001f\u007f-\u009f]/u.test(input.destination))throw failure('input');
  return {op,scope,destination:input.destination,permission};
 }
 async function identity(role,scope,slot,generation,token){
  let value;
  try{value=await sessions.identity(role,{...scope,...(token?{token}:{})});}catch{throw failure('identity');}
  assertCurrent(slot,generation);
  if(!value||value.role!==role||!uuid(value.sessionId)||value.sessionId!==scope.sessionId)throw failure('identity');
  const result={sessionId:value.sessionId,role};
  for(const field of scopeFields){
   const current=value[field]??null;
   if(current!==null&&!validId(current)||Object.hasOwn(scope,field)&&scope[field]!==current)throw failure('identity');
   result[field]=current;
  }
  return result;
 }
 function publicResult(value,request){
  if(!value||!uuid(value.registrationId)||!permissions.has(value.permission)||typeof value.enabled!=='boolean'||typeof value.changed!=='boolean'||
   (request.op==='nativePushDisable'?(value.registrationId!==request.registrationId||value.enabled):
    (value.permission!==request.permission||value.enabled!==(request.permission==='granted'))))throw failure('result');
  return {registrationId:value.registrationId,permission:value.permission,enabled:value.enabled,changed:value.changed};
 }
 function schedule(op,role,input){
  let slot,request;
  try{slot=slotFor(role);request=requestFor(op,input);}catch(error){return Promise.reject(error);}
  const generation=slot.generation,key=JSON.stringify([generation,role,request]);
  // Only consecutive duplicates coalesce. A -> B -> A must end at A, rather
  // than joining the first A and silently leaving the later B in effect.
  if(slot.lastKey===key&&slot.pending.has(key))return slot.pending.get(key);
  // Capture now, before waiting behind a previous token update. Pinning the
  // session also prevents a queued old event from targeting a new login.
  const captured=identity(role,request.scope,slot,generation).then(value=>({value}),()=>({error:true}));
  const task=slot.tail.then(async()=>{
   assertCurrent(slot,generation);
   const snapshot=await captured;
   assertCurrent(slot,generation);
   if(snapshot.error)throw failure('identity');
   const pinned={sessionId:snapshot.value.sessionId,...Object.fromEntries(scopeFields.map(field=>[field,snapshot.value[field]]))};
   let token;
   try{token=await sessions.token(role,pinned);}catch{throw failure('identity');}
   assertCurrent(slot,generation);
   if(typeof token!=='string'||!/^device:\S+$/u.test(token))throw failure('identity');
   const before=await identity(role,pinned,slot,generation,token);
   if(!sameIdentity(before,snapshot.value))throw failure('identity');
   const body={op:request.op,token,expectedDeviceSessionId:pinned.sessionId,transport:pushTransport,
    ...(request.op==='nativePushRegister'?{destination:request.destination,permission:request.permission}:{registrationId:request.registrationId})};
   let response;
   try{response=await transport(body);}catch{assertCurrent(slot,generation);throw failure('failed');}
   assertCurrent(slot,generation);
   const after=await identity(role,pinned,slot,generation);
   if(!sameIdentity(after,snapshot.value))throw failure('identity');
   return publicResult(response,request);
  });
  slot.pending.set(key,task);
  slot.lastKey=key;slot.lastTask=task;
  slot.tail=task.then(()=>{},()=>{});
  const clear=()=>{if(slot.pending.get(key)===task)slot.pending.delete(key);if(slot.lastTask===task){slot.lastKey=null;slot.lastTask=null;}};
  task.then(clear,clear);
  return task;
 }
 return {
  register:(role,input)=>schedule('nativePushRegister',role,input),
  disable:(role,input)=>schedule('nativePushDisable',role,input),
  invalidate(role){
   const chosen=role===undefined?Object.values(slots):[slotFor(role)];
   for(const slot of chosen){slot.generation++;slot.pending.clear();slot.lastKey=null;slot.lastTask=null;slot.tail=Promise.resolve();}
  }
 };
}
