// Notification links select a view. The receiving view must still use the
// current authenticated identity and its ordinary server-side access checks.
const targetTypes=new Set(['live','saved','cancel','ready','call','accepted','completed','credit','status','failed','message','comment','announcement','achievement','wish','system','delivery']);
const queryFields=['streamer','streamerId','spaceId','entityType','entityId','notificationId'];
const secretFields=new Set(['token','access_token','refresh_token','password','apikey','api_key','authorization','auth','sessiontoken','credential']);
const invalidCharacters=/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
function targetString(value,max,nullable=false){
 if(value==null)return nullable?null:undefined;
 return typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value&&!invalidCharacters.test(value)?value:undefined;
}
export function validateNotificationTarget(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1)return null;
 const target={version:1,spaceId:targetString(value.spaceId,128,true),streamerId:targetString(value.streamerId,128),streamerSlug:targetString(value.streamerSlug,128),section:value.section,entityType:targetString(value.entityType,32),entityId:targetString(value.entityId,256,true),notificationId:targetString(value.notificationId,128,true)};
 if(Object.values(target).includes(undefined)||!['admin','center'].includes(target.section)||!targetTypes.has(target.entityType))return null;
 return target;
}
export function notificationTargetView(value){
 const target=validateNotificationTarget(value);if(!target)return null;
 if(['live','saved','cancel','ready','call','accepted','completed','status'].includes(target.entityType))return 'queue';
 if(target.entityType==='credit')return 'credit';
 if(target.entityType==='wish')return 'wish';
 if(target.entityType==='message')return 'chat';
 if(['comment','announcement'].includes(target.entityType))return 'board';
 return 'generic';
}
export function notificationTargetPath(value){
 const target=validateNotificationTarget(value);if(!target)return null;
 const pairs=[['streamer',target.streamerSlug],['streamerId',target.streamerId],['spaceId',target.spaceId],['entityType',target.entityType],['entityId',target.entityId],['notificationId',target.notificationId]];
 return './?'+pairs.filter(([,v])=>v!==null).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&')+'#'+target.section;
}
export function parseNotificationTarget(input,{baseUrl,mountUrl}={}){
 try{
  if(typeof input!=='string'&&!(input instanceof URL))return null;
  const raw=String(input);if(raw.length>4096||invalidCharacters.test(raw)||raw.includes('\\'))return null;
  const base=new URL(baseUrl||mountUrl),mount=new URL(mountUrl||'./',base),url=new URL(raw,base);
  if(!['https:','http:'].includes(base.protocol)||mount.origin!==base.origin||url.origin!==base.origin||url.username||url.password)return null;
  const directory=mount.pathname.endsWith('/')?mount.pathname:mount.pathname+'/';
  if(!url.pathname.startsWith(directory)||/%(?:2f|5c)/i.test(url.pathname))return null;
  if([...url.searchParams.keys()].some(k=>secretFields.has(k.toLowerCase())))return null;
  if(queryFields.some(k=>url.searchParams.getAll(k).length>1))return null;
  return validateNotificationTarget({version:1,spaceId:url.searchParams.get('spaceId'),streamerId:url.searchParams.get('streamerId'),streamerSlug:url.searchParams.get('streamer'),section:url.hash.slice(1),entityType:url.searchParams.get('entityType'),entityId:url.searchParams.get('entityId'),notificationId:url.searchParams.get('notificationId')});
 }catch{return null;}
}
