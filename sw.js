// Push only: no cached API responses, login tokens, or offline business mutations.
// This classic worker cannot import ESM. Keep its transport validation in parity
// with notification-target.js; tests exercise both with the same target vectors.
const noticeTargetTypes=new Set(['live','saved','cancel','ready','call','accepted','completed','credit','status','failed','message','comment','announcement','achievement','wish','system','delivery']);
const noticeSecretFields=new Set(['token','access_token','refresh_token','password','apikey','api_key','authorization','auth','sessiontoken','credential']);
const noticeInvalidCharacters=/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
function noticeTargetString(value,max,nullable=false){if(value==null)return nullable?null:undefined;return typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value&&!noticeInvalidCharacters.test(value)?value:undefined;}
function noticeTarget(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1)return null;
 const target={version:1,spaceId:noticeTargetString(value.spaceId,128,true),streamerId:noticeTargetString(value.streamerId,128),streamerSlug:noticeTargetString(value.streamerSlug,128),section:value.section,entityType:noticeTargetString(value.entityType,32),entityId:noticeTargetString(value.entityId,256,true),notificationId:noticeTargetString(value.notificationId,128,true)};
 return Object.values(target).includes(undefined)||!['admin','center'].includes(target.section)||!noticeTargetTypes.has(target.entityType)?null:target;
}
function noticeTargetPath(target){
 const pairs=[['streamer',target.streamerSlug],['streamerId',target.streamerId],['spaceId',target.spaceId],['entityType',target.entityType],['entityId',target.entityId],['notificationId',target.notificationId]];
 return './?'+pairs.filter(([,value])=>value!==null).map(([key,value])=>key+'='+encodeURIComponent(value)).join('&')+'#'+target.section;
}
function boundedNoticeUrl(input){
 try{
  if(typeof input!=='string'||input.length>4096||noticeInvalidCharacters.test(input)||input.includes('\\'))return null;
  const base=new URL(self.registration.scope),url=new URL(input,base),directory=base.pathname.endsWith('/')?base.pathname:base.pathname+'/';
  if(!['https:','http:'].includes(base.protocol)||url.origin!==base.origin||url.username||url.password||!url.pathname.startsWith(directory)||/%(?:2f|5c)/i.test(url.pathname))return null;
  if([...url.searchParams.keys()].some(key=>noticeSecretFields.has(key.toLowerCase())))return null;
  if(url.hash&&!['#admin','#center','#home'].includes(url.hash))return null;
  return url.href;
 }catch{return null;}
}
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{event.waitUntil((async()=>{
 let data;try{data=event.data?.json();}catch{return;}
 if(typeof data?.id!=='string'||!data.id||data.id.length>128||typeof data.body!=='string'||!data.body||data.body.length>4096)return;
 if(data.expiresAt!=null&&(!Number.isFinite(data.expiresAt)||Date.now()>=data.expiresAt))return;
 // Existing Edge payloads already send a canonical link. Prefer it so old
 // abbreviated Web URLs gain entity identity without a backend deployment.
 const target=data.link==null?null:noticeTarget(data.link);if(data.link!=null&&!target)return;
 const url=boundedNoticeUrl(target?noticeTargetPath(target):data.url||'./');if(!url)return;
 const existing=await self.registration.getNotifications({tag:data.id});if(existing.length)return;
 await self.registration.showNotification(typeof data.title==='string'?data.title.slice(0,160):'PA Party',{body:data.body,tag:data.id,data:{url},icon:'./assets/app-icon-192.png',badge:'./assets/app-icon-192.png'});
})());});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{
 const url=boundedNoticeUrl(event.notification.data?.url||'./');if(!url)return;
 const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true}),tab=clients.find(client=>client.url===url);
 if(tab){await tab.focus();return;}await self.clients.openWindow(url);
})());});
