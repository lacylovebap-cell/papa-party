const NATIVE_BINDING_BATCH_LIMIT=2000;
const NATIVE_BINDING_CREDENTIAL_KEYS=new Set(['password','currentpassword','token','refreshtoken','accesstoken','secret']);
const NATIVE_BINDING_IDENTITY_KEYS=new Set(['accountid','account_id','membershipid','membership_id','spaceid','space_id']);
const nativeBindingObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
function nativeBindingRequire(ok,message='玩家帳號綁定資料不正確'){if(!ok)throw Error(message);}
function nativeBindingId(value){
 nativeBindingRequire(typeof value==='string'&&value.length>0&&value.length<=200&&value.trim()===value&&!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value));
 return value;
}
function nativeBindingUuid(value){
 nativeBindingRequire(typeof value==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value));
 return value.toLowerCase();
}
function nativeBindingBatch(value){
 nativeBindingRequire(Array.isArray(value)&&value.length<=NATIVE_BINDING_BATCH_LIMIT,'玩家帳號綁定每批最多 2000 筆');
 return value;
}
function nativeBindingProfileSafe(data){
 let nodes=0;
 function visit(value,depth){
  nativeBindingRequire(depth<=20&&++nodes<=10000,'玩家資料層級或大小超出綁定檢查上限');
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'){nativeBindingRequire(Number.isFinite(value));return;}
  nativeBindingRequire(value&&typeof value==='object','玩家資料必須是可儲存的純資料');
  if(Array.isArray(value)){for(const item of value)visit(item,depth+1);return;}
  for(const [key,item] of Object.entries(value)){
   const name=key.toLowerCase();
   // Core's exact empty scaffold is removed by the existing native commit.
   if(depth===0&&key==='password'&&item==='')continue;
   nativeBindingRequire(!NATIVE_BINDING_CREDENTIAL_KEYS.has(name)&&!NATIVE_BINDING_IDENTITY_KEYS.has(name),'登入與帳號身分資料不能寫入玩家資料');
   visit(item,depth+1);
  }
 }
 visit(data,0);
}

// This checks explicit mappings, not eligibility or authority. The existing SQL
// commit still verifies the current Account, Membership, profile and revision.
export function buildNativePlayerBindings(options){
 nativeBindingRequire(nativeBindingObject(options));
 const {source,changes,eligible=[],selections=[]}=options,spaceId=nativeBindingId(options.spaceId);
 nativeBindingRequire(spaceId!=='space-001'&&nativeBindingObject(source)&&source.currentStreamer?.spaceId===spaceId&&Array.isArray(source.players),'玩家帳號綁定不屬於目前 Space');
 nativeBindingBatch(changes);nativeBindingBatch(eligible);nativeBindingBatch(selections);
 const existing=new Set();
 for(const profile of source.players){
  nativeBindingRequire(nativeBindingObject(profile));const id=nativeBindingId(profile.playerId);
  nativeBindingRequire(!existing.has(id));
  nativeBindingRequire((profile.spaceId===undefined||profile.spaceId===spaceId)&&(profile.space_id===undefined||profile.space_id===spaceId),'玩家資料不屬於目前 Space');
  existing.add(id);
 }
 const changed=new Set(),newIds=[];
 for(const patch of changes){
  nativeBindingRequire(nativeBindingObject(patch)&&typeof patch.kind==='string');
  if(patch.kind!=='players')continue;
  const id=nativeBindingId(patch.id);
  nativeBindingRequire(!changed.has(id)&&nativeBindingObject(patch.data)&&patch.data.playerId===id);
  nativeBindingProfileSafe(patch.data);changed.add(id);
  if(!existing.has(id))newIds.push(id);
 }
 const eligiblePairs=new Set(),eligibleAccounts=new Set(),eligibleMemberships=new Set();
 for(const choice of eligible){
  nativeBindingRequire(nativeBindingObject(choice)&&choice.spaceId===spaceId,'可綁定帳號不屬於目前 Space');
  const account=nativeBindingUuid(choice.accountId),membership=nativeBindingUuid(choice.membershipId);
  nativeBindingRequire(!eligibleAccounts.has(account)&&!eligibleMemberships.has(membership));
  eligibleAccounts.add(account);eligibleMemberships.add(membership);eligiblePairs.add(account+':'+membership);
 }
 const added=new Set(newIds),selected=new Map(),accounts=new Set(),memberships=new Set();
 for(const choice of selections){
  nativeBindingRequire(nativeBindingObject(choice));
  const id=nativeBindingId(choice.playerId),account=nativeBindingUuid(choice.accountId),membership=nativeBindingUuid(choice.membershipId);
  nativeBindingRequire(added.has(id)&&!selected.has(id)&&!accounts.has(account)&&!memberships.has(membership),'新增玩家必須各自選擇唯一帳號綁定');
  nativeBindingRequire(eligiblePairs.has(account+':'+membership),'請重新選擇目前 Space 已核對的玩家帳號');
  selected.set(id,Object.freeze({player_id:id,account_id:account,membership_id:membership}));accounts.add(account);memberships.add(membership);
 }
 nativeBindingRequire(selected.size===newIds.length,'每位新增玩家都必須明確選擇帳號綁定');
 return Object.freeze(newIds.map(id=>selected.get(id)));
}
