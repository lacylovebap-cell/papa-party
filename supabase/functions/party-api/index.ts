import {isSuper,isManager,coreActor,requireRoom,authorizeManagerOperation,managementView,noticeIdentity,validNoticeAudio,prepareManagerAction} from '../../../src/access-policy.js';
import {stateChanges,scopedOperationalAction,scopedRoomMutationAction} from '../../../src/state-patch.js';
import {applyRoomImport} from '../../../src/room-import.js';
import {createRoomDraft,validateRoomDraft,replayRoomDraft} from '../../../src/room-draft.js';
// No browser access to tables or VAPID secrets. All recipient keys come from actor().
import webpush from 'npm:web-push@3.6.7';
import {cleanNoticePrefs,noticeChannels,validPushSubscription,canonicalNoticeLink,webNoticePath} from '../../../src/notification-rules.js';

async function noticeKeys(){
 let rows=await api('/rest/v1/papa_notice_config?id=eq.vapid');
 if(!rows.length){const key=webpush.generateVAPIDKeys();const r=await fetch(SB_URL+'/rest/v1/papa_notice_config',{method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({id:'vapid',value:key})});if(!r.ok)throw Error('推播設定暫時無法建立');rows=await api('/rest/v1/papa_notice_config?id=eq.vapid');}
 return rows[0].value;
}
async function notificationOperation(b:any,who:any,s:any){
 if(!who)throw Error('請先登入');
 const sourceRoom=scopeState(s,b.streamer||'papa').currentStreamer.id,{room,recipient}=noticeIdentity(who,sourceRoom);
 if(!recipient)throw Error('請先登入');
 const filter='streamer_id=eq.'+encodeURIComponent(room)+'&recipient=eq.'+encodeURIComponent(recipient),noticeFilter=(room==='__global__'?'':('streamer_id=eq.'+encodeURIComponent(room)+'&'))+'recipient=eq.'+encodeURIComponent(recipient);
 if(b.op==='notifications'){
  const inbox=await api('/rest/v1/rpc/papa_notice_inbox',{room,owner_id:recipient,page_number:Math.max(0,Math.min(100000,Math.floor(Number(b.page)||0)))});
  if(isManager(who))return {...inbox,playerSoundVersion:null};
  const playerSoundVersion=await api('/rest/v1/rpc/papa_notice_sound_version',{});
  if(b.soundVersion===playerSoundVersion)return {...inbox,playerSoundVersion};
  const [audio]=await api('/rest/v1/papa_notice_config?id=eq.player_sound&select=value&limit=1');
  return {...inbox,playerSoundVersion,playerSound:audio?.value?.data||null};
 }
 if(b.op==='noticeSound'){if(!isSuper(who))throw Error('只有PA Party總裁可設定玩家音效');if(b.data!==null&&!validNoticeAudio(b.data))throw Error('請選擇 256 KB 以下的支援音效');const r=await fetch(SB_URL+'/rest/v1/papa_notice_config?on_conflict=id',{method:'POST',headers:{...headers,Prefer:'resolution=merge-duplicates'},body:JSON.stringify({id:'player_sound',value:{data:b.data}})});if(!r.ok)throw Error('音效儲存失敗');return {ok:true};}
 if(b.op==='noticeRead'){
  const ids=Array.isArray(b.ids)?b.ids.filter((id:any)=>/^[a-f0-9-]{36}$/.test(String(id))).slice(0,50):[];
  if(ids.length)await api('/rest/v1/papa_notifications?'+noticeFilter+'&id=in.('+ids.join(',')+')',{read_at:new Date().toISOString()},'PATCH');
  return {ok:true};
 }
 if(b.op==='noticePreferences'){
  const preferences=cleanNoticePrefs(b.preferences);
  await api('/rest/v1/rpc/papa_notice_inbox',{room,owner_id:recipient,page_number:0});
  await api('/rest/v1/papa_notice_preferences?'+filter,{preferences},'PATCH');
  return {preferences};
 }
 if(b.op==='noticeTest'){
  const [recent]=await api('/rest/v1/papa_notifications?'+noticeFilter+'&entity_id=eq.notification-test&created_at=gt.'+encodeURIComponent(new Date(Date.now()-30000).toISOString())+'&limit=1');
  if(recent)throw Error('測試通知已送出，請稍候 30 秒再試');
  const source=scopeState(s,b.streamer||'papa').currentStreamer.display_name||'主播';
  await api('/rest/v1/papa_notifications',{streamer_id:sourceRoom,streamer_name:source,recipient,type:'system',level:2,entity_id:'notification-test',body:source+'｜通知測試成功 ♡'});
  schedulePush(sourceRoom,[recipient]);return {ok:true};
 }
 if(b.op==='pushKey')return {publicKey:(await noticeKeys()).publicKey};
 if(b.op==='pushSubscribe'){
  if(b.expectedDeviceSessionId&&b.expectedDeviceSessionId!==who.deviceSessionId)throw Error('登入身分已變更，請重新啟用推播');
  if(!validPushSubscription(b.subscription))throw Error('推播訂閱格式不正確或此瀏覽器尚不支援');
  const endpoint=b.subscription.endpoint;
  if(!/^(player|admin|streamer|device):/.test(b.token)){
   const claims=JSON.parse(atob(b.token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
   const expires=new Date(Math.min(Number(claims.exp)*1000,Date.now()+43200000));
   if(!Number.isFinite(expires.getTime()))throw Error('請重新登入管理');
   await fetch(SB_URL+'/rest/v1/papa_v2_sessions?on_conflict=token_hash',{method:'POST',headers:{...headers,Prefer:'resolution=merge-duplicates'},body:JSON.stringify({token_hash:await hash(b.token),player_id:'__admin__',login_id:'',expires_at:expires.toISOString()})});
  }
  const r=await fetch(SB_URL+'/rest/v1/papa_push_subscriptions?on_conflict=streamer_id,endpoint',{method:'POST',headers:{...headers,Prefer:'resolution=merge-duplicates'},body:JSON.stringify({streamer_id:room,recipient,endpoint,subscription:{endpoint,keys:b.subscription.keys},session_hash:await hash(b.token),device_session_id:who.deviceSessionId||null})});
  if(!r.ok)throw Error('推播訂閱儲存失敗');return {ok:true};
 }
 if(b.op==='pushUnsubscribe'){
  if(typeof b.endpoint==='string')await api('/rest/v1/papa_push_subscriptions?'+filter+'&endpoint=eq.'+encodeURIComponent(b.endpoint),undefined,'DELETE');return {ok:true};
 }
 throw Error('未知通知操作');
}
async function deliverPush(){
 const jobs=await api('/rest/v1/rpc/papa_claim_push',{});if(!jobs.length)return;
 const keys=await noticeKeys();
 const streamers=await api('/rest/v1/rpc/papa_streamer_directory',{});
 const slugByRoom=new Map((Array.isArray(streamers)?streamers:[]).map((room:any)=>[room.id,room.slug]));
 await Promise.allSettled(jobs.map(async(job:any)=>{
  const jobFilter='id=eq.'+job.id+'&lease=eq.'+job.lease;
  try{
   const [n]=await api('/rest/v1/papa_notifications?id=eq.'+job.notice_id),[sub]=await api('/rest/v1/papa_push_subscriptions?id=eq.'+job.subscription_id);
   if(!n||!sub){await api('/rest/v1/papa_push_jobs?'+jobFilter,{status:'skipped'},'PATCH');return;}
   const preferenceRoom=n.recipient==='__super__'?'__global__':n.streamer_id;const [prefs]=await api('/rest/v1/papa_notice_preferences?streamer_id=eq.'+encodeURIComponent(preferenceRoom)+'&recipient=eq.'+encodeURIComponent(n.recipient));
   const sess=sub.device_session_id?null:await api('/rest/v1/rpc/papa_verified_session_actor',{session_hash:sub.session_hash,requested_room:null});
   const sessionAllowed=sub.device_session_id?await api('/rest/v1/rpc/papa_device_push_recipient',{chosen_device:sub.device_session_id,chosen_room:n.streamer_id,chosen_recipient:sub.recipient}):sess&&(sub.recipient==='__super__'?sess.role==='super_admin':sub.recipient==='__admin__'?sess.role==='streamer_admin'&&sess.streamerId===n.streamer_id:sess.role==='player'&&sess.playerId===sub.recipient);if(!sessionAllowed||n.recipient!==sub.recipient||sub.streamer_id!==preferenceRoom||n.read_at||!noticeChannels(prefs?.preferences,n.type).push){await api('/rest/v1/papa_push_jobs?'+jobFilter,{status:'skipped'},'PATCH');return;}
   const slug=slugByRoom.get(n.streamer_id)||'papa';
   const link=canonicalNoticeLink(n,slug);
   const payload=JSON.stringify({id:n.id,title:'PA • PARTY · '+n.streamer_name,
    body:n.body,url:webNoticePath(link),link,recipient:n.recipient});
   const details=webpush.generateRequestDetails(sub.subscription,payload,{vapidDetails:{subject:'https://lacylovebap-cell.github.io/papa-party/',publicKey:keys.publicKey,privateKey:keys.privateKey},TTL:3600});
   const response=await fetch(details.endpoint,{method:'POST',headers:details.headers,body:details.body,redirect:'error',signal:AbortSignal.timeout(12000)});
   if(response.status===404||response.status===410){await api('/rest/v1/papa_push_subscriptions?id=eq.'+sub.id,undefined,'DELETE');return;}
   if(!response.ok)throw Error('HTTP '+response.status);
   await api('/rest/v1/papa_push_jobs?'+jobFilter,{status:'sent',last_error:null},'PATCH');
  }catch(e){
   const failed=job.attempts>=5;
   await api('/rest/v1/papa_push_jobs?'+jobFilter,{status:failed?'failed':'pending',available_at:new Date(Date.now()+Math.min(3600,30*2**job.attempts)*1000).toISOString(),last_error:'推播服務暫時無法送達'},'PATCH');
   if(failed){const [n]=await api('/rest/v1/papa_notifications?id=eq.'+job.notice_id);if(n&&n.type!=='delivery')await api('/rest/v1/papa_notifications',{streamer_id:n.streamer_id,streamer_name:n.streamer_name,recipient:'__admin__',type:'delivery',level:1,body:n.streamer_name+'｜有一則推播重試後仍無法送達；通知中心紀錄保留',entity_id:n.id});}
  }
 }));
}
async function signalNotices(room:string,recipients:string[]){
 const prefs=await api('/rest/v1/papa_notice_preferences?or=(streamer_id.eq.'+encodeURIComponent(room)+',streamer_id.eq.__global__)&select=recipient,topic');if(recipients.includes('__admin__'))recipients=[...recipients,'__super__'];
 const messages=prefs.filter((p:any)=>recipients.includes(p.recipient)).map((p:any)=>({topic:'papa-notice:'+p.topic,event:'changed',payload:{},private:false}));
 if(messages.length)await fetch(SB_URL+'/realtime/v1/api/broadcast',{method:'POST',headers,body:JSON.stringify({messages})});
}
function schedulePush(room?:string,recipients:string[]=[]){EdgeRuntime.waitUntil(Promise.allSettled([room?signalNotices(room,recipients):Promise.resolve(),deliverPush()]));}

import {deriveNotices} from '../../../src/notification-rules.js';
// Authentication is checked here for every operation; no browser service key.
import {empty,TABLES,mutate,publicView,migrateLegacy,previewImport,applyImport,playerSearch,upgradePlatform,scopeState,searchAcrossStreamers,balance,reservedCredits,usedHour,reservedHour,quoteSong,hourKey,canRequestSaved} from '../../../src/core.js';
const SB_URL=Deno.env.get('SUPABASE_URL')!,KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,ADMIN=Deno.env.get('PAPA_ADMIN_USER_ID');
const headers={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,authorization,apikey','Access-Control-Allow-Methods':'POST, OPTIONS'};
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
async function api(path:string,body?:unknown,method?:string){
 const r=await fetch(SB_URL+path,{method:method||(body?'POST':'GET'),headers,body:body?JSON.stringify(body):undefined}),text=await r.text();
 if(!r.ok){
  const messages:any={DEVICE_SWITCH_SPACE_INVALID:'找不到可使用的空間',DEVICE_SWITCH_ROOM_INVALID:'此登入不適用選擇的主播',DEVICE_SWITCH_MEMBERSHIP_REQUIRED:'你沒有此空間的使用權限',DEVICE_SWITCH_PROFILE_REQUIRED:'此空間的玩家資料尚未建立',DEVICE_SWITCH_IDENTITY_INVALID:'裝置登入已到期，請重新登入',DEVICE_SWITCH_INSTALLATION_INVALID:'裝置登入已到期，請重新登入',DEVICE_SWITCH_INVALID:'裝置資訊不正確',ACCOUNT_DISABLED:'登入已到期，請重新登入',MEMBERSHIP_REQUIRED:'登入已到期，請重新登入',MEMBERSHIP_SUSPENDED:'登入已到期，請重新登入',SESSION_ACCOUNT_MISMATCH:'登入已到期，請重新登入',DEVICE_IDENTITY_MISMATCH:'登入已到期，請重新登入',BOARD_MODERATED:'此留言由管理者隱藏，請聯絡管理者恢復',BOARD_RATE_LIMIT:'留言送得太快，請稍候三秒再試',BOARD_RETRY_CHANGED:'重試內容不同，請重新開啟留言板',CHAT_RATE_LIMIT:'訊息送得太快，請稍候再送',CHAT_REQUEST_REUSED:'訊息重試內容不同，請重新開啟私訊',VERSION_CONFLICT:'資料剛更新了，請重新整理後再試一次',CATALOG_SELECTION_STALE:'共同資料剛更新，請重新選取後再操作',CATALOG_SOURCE_STALE:'原歌曲剛更新，請重新選取後再審核',CATALOG_CANDIDATE_STALE:'候選歌曲剛更新，請重新選取後再審核',CATALOG_TEMPLATE_MISSING:'這個模板已停用或不存在，請重新選擇',CATALOG_ALREADY_LINKED:'歌曲已建立共同關聯，請重新整理',CATALOG_AMBIGUOUS_TARGET:'存在多筆同版本共同歌曲，請選擇既有目標後再連結',CATALOG_BATCH_DIFFERENT_VERSIONS:'所選歌曲屬於不同版本，請分批處理'};
  Object.assign(messages,{STREAMER_REGISTRY_DUPLICATE:'主播網址已使用',STREAMER_REGISTRY_ACTOR_INVALID:'總裁登入已到期，請重新登入',
   STREAMER_REGISTRY_SCOPE_INVALID:'請切換到該主播空間再編輯',STREAMER_REGISTRY_ROOM_INVALID:'找不到主播',
   STREAMER_REGISTRY_SPACE_INVALID:'找不到可使用的空間',STREAMER_REGISTRY_DESCRIPTOR_INVALID:'主播資料格式錯誤'});
  throw Error(Object.entries(messages).find(([code])=>text.includes(code))?.[1]||'資料庫操作失敗');
 }
 return text?JSON.parse(text):null;
}
function snapshotState(snap:any){const s=empty();s.revision=snap.revision;s.extraQuotas=snap.extraQuotas||[];s.extraQuotaRights=snap.extraQuotaRights||{};for(const r of snap.rows){if(r.kind==='settings')s.settings=r.data;else if(r.kind==='meta')Object.assign(s,r.data);else if(TABLES.includes(r.kind))s[r.kind].push(r.data);}for(const k of TABLES)s[k].sort((a:any,b:any)=>(a._order||0)-(b._order||0));return upgradePlatform(s);}
async function load(lean=false,requestedRoom='papa',allowedSpace='space-001',writeSongs:string[]|null=null,quotaPlayer:string|null=null){const snap=await api('/rest/v1/rpc/'+(writeSongs?(quotaPlayer?'papa_v2_room_write_snapshot_with_quota':'papa_v2_room_write_snapshot_in_space'):lean?(quotaPlayer?'papa_v2_scoped_read_snapshot_with_quota':'papa_v2_scoped_read_snapshot_in_space'):'papa_v2_snapshot'),writeSongs?{requested_room:requestedRoom,selected_song_ids:writeSongs,allowed_space:allowedSpace,...(quotaPlayer?{quota_player:quotaPlayer}:{})}:lean?{requested_room:requestedRoom,allowed_space:allowedSpace,...(quotaPlayer?{quota_player:quotaPlayer}:{})}:{});return snapshotState(snap);}
async function mutateStreamerRegistry(b:any,who:any,t:string){
 if(!isSuper(who)||!who.accountId)throw Error('僅限 PA Party總裁');
 const data=b.action?.data;
 if(!data||typeof data!=='object'||Array.isArray(data)
  ||Object.keys(data).some(key=>!['id','slug','display_name','home_title','subtitle','description','avatar_url','banner_url','active'].includes(key))
  ||Object.hasOwn(data,'active')&&typeof data.active!=='boolean')throw Error('主播資料格式錯誤');
 const snapshot=await api('/rest/v1/rpc/papa_streamer_registry_snapshot',{requested_room:b.streamer||'papa',subject:who.accountId});
 const source=snapshotState(snapshot),space=snapshot.canonicalSpace?.id,room=snapshot.canonicalRoom;
 if(!space||!room)throw Error('找不到主播空間');
 if(b.revision!==source.revision)throw Error('資料剛更新了，請重新整理後再試一次');
 const previous=data.id?source.streamers.find((r:any)=>r.id===data.id):null;
 if(data.id&&!previous||previous&&previous.spaceId!==space)throw Error('請切換到該主播空間再編輯');
 const next=mutate(source,{...b.action,streamer:room},coreActor(who),t);
 const replacement=previous?next.streamers.find((r:any)=>r.id===previous.id):next.streamers.find((r:any)=>!source.streamers.some((old:any)=>old.id===r.id));
 if(!replacement)throw Error('主播資料格式錯誤');
 replacement.spaceId=space;
 next.revision=await api('/rest/v1/rpc/papa_streamer_registry_commit',{expected:source.revision,requested_space:space,
  replacement_room:replacement,room_settings:next.streamerSettings[replacement.id]||{},
  actor_context:{role:who.role,account_id:who.accountId,space_id:space,streamer_id:replacement.id,action:'streamer'}});
 const fields=['id','slug','display_name','home_title','subtitle','description','avatar_url','banner_url','active','created_at','updated_at','spaceId'];
 const rows=next.streamers.filter((r:any)=>r.spaceId===space).map((r:any)=>Object.fromEntries(fields.filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]])));
 return {state:{revision:next.revision,schemaVersion:3,streamers:rows,currentStreamer:rows.find((r:any)=>r.id===room)},now:t,ready:true};
}
// Chat, board and notices need room metadata, not the full song/history snapshot.
async function loadCommunicationState(allowedSpace:string|null='space-001',requestedRoom:string|null=null){
 let streamers=await api('/rest/v1/rpc/'+(allowedSpace===null?'papa_streamer_directory':'papa_streamer_directory_in_space'),allowedSpace===null?{}:{chosen_space:allowedSpace});
 if(!Array.isArray(streamers))throw Error('找不到主播設定');
 if(requestedRoom){
  const room=streamers.find((r:any)=>r.id===requestedRoom||r.slug===requestedRoom);
  if(!room)throw Error('找不到主播');
  const roomSpace=room.spaceId||'space-001';
  if(allowedSpace!==null&&roomSpace!==allowedSpace)throw Error('找不到主播');
  // Selected-Space metadata is ready, but activation awaits all downstream paths.
  if(roomSpace!=='space-001')throw Error('此 Space 的資料頁尚未開放');
  streamers=streamers.filter((r:any)=>(r.spaceId||'space-001')===roomSpace);
 }
 return {...empty(),schemaVersion:3,streamers,streamerSettings:{}};
}
async function managerRoom(who:any,requestedRoom:string){
 if(!isManager(who))throw Error('請先登入管理');
 const snapshot=await loadCommunicationState(isSuper(who)?null:who.spaceId||'space-001');
 const room=scopeState(snapshot,requestedRoom).currentStreamer;requireRoom(who,room.id);
 if(!isSuper(who)&&(room.spaceId||'space-001')!==(who.spaceId||'space-001'))throw Error('找不到主播');
 // Canonical routing is ready; keep native business activation closed until
 // the remaining original release phases are integrated and verified.
 if((room.spaceId||'space-001')!=='space-001')throw Error('此 Space 的資料頁尚未開放');
 return room;
}
// Private exports are explicit. Ordinary views and draft sources omit lyric bodies.
function leanSongView(view:any){return {...view,songs:view.songs.map(({lyrics,lyricNotes,privateNote,privateNotes,lyricHistory,lyricsHistory,...song}:any)=>song)};}
async function commit(before:any,after:any,context:any={}){
 const scoped=!!(context.roomScoped||context.roomWriteScoped),native=scoped&&context.space_id&&context.space_id!=='space-001';
 // Core's legacy platform settings alias points to papa. Native room writes
 // retain their own settings; credentials belong to Account, not this profile.
 if(native)after.settings=after.streamerSettings?.[context.streamer_id]||before.settings;
 const patch=stateChanges(before,after,{preserveOrder:scoped}),notices=deriveNotices(before,after,context);
 const changes=native?patch.changes.map((row:any)=>{
  if(row.kind!=='players'||row.data?.password!=='')return row;
  const {password,...data}=row.data;return {...row,data};
 }):patch.changes;
 const provision=native&&Array.isArray(context.player_bindings)&&context.player_bindings.length>0;
 const {player_bindings,...actorContext}=context;
 after.revision=await api('/rest/v1/rpc/'+(provision?'papa_room_admin_commit_with_player_bindings':context.roomScoped?'papa_room_operational_commit':context.roomWriteScoped?'papa_room_admin_commit':'papa_release_b_commit'),{expected:before.revision,changes,removed:patch.removed,actor_context:actorContext,notices,...(scoped?{requested_room:context.streamer_id}:{}),...(provision?{player_bindings:player_bindings}:{})});
 schedulePush(context.streamer_id,[...new Set(notices.map((n:any)=>n.recipient))]);return after;
}
async function actor(token:string,requestedRoom:string|null=null){
 if(!/^(player|admin|streamer|device):/.test(token||''))return null;
 const r=await api('/rest/v1/rpc/papa_verified_session_actor',{session_hash:await hash(token),requested_room:requestedRoom});
 if(!r)return null;
 const device=token.startsWith('device:');
 if((device||token.startsWith('admin:'))&&r.role==='super_admin')return {role:'super_admin',accountId:r.accountId,deviceSessionId:r.deviceSessionId};
 if((device||token.startsWith('streamer:'))&&r.role==='streamer_admin')return {role:'streamer_admin',streamer_id:r.streamerId,spaceId:r.spaceId,accountId:r.accountId,deviceSessionId:r.deviceSessionId};
 return (device||token.startsWith('player:'))&&r.role==='player'?{role:'player',playerId:r.playerId,loginId:r.loginId,spaceId:r.spaceId,accountId:r.accountId,deviceSessionId:r.deviceSessionId}:null;
}
function managerPasswordError(result:any,kind:string){
 const messages:any={expired:'登入已到期，請重新登入',rate_limit:'嘗試過多，請 15 分鐘後再試',invalid_current:'目前密碼不正確',weak_password:kind==='president'?'總裁新密碼請使用至少 8 字、72 位元組以內':'主播新密碼請使用至少 4 字、72 位元組以內',same_password:'新密碼不能與目前密碼相同',same_as_president:'主播密碼不能與 PA Party總裁密碼相同',same_as_streamer:'總裁密碼不能與任一主播密碼相同',password_required:'請先設定主播密碼'};
 if(!result?.ok)throw Error(messages[result?.reason]||'密碼設定未完成，請重新登入後再試');
}

Deno.serve(async req=>{if(req.method==='OPTIONS')return new Response(null,{headers:cors});const respond=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});try{if(req.method!=='POST')return respond({error:'Method not allowed'},405);const b=await req.json(),credentialOperation=['deviceRefresh','deviceLogout','deviceSwitchSpace','deviceSpacePreferences'].includes(b.op),who=credentialOperation?null:await actor(b.token||'',['spaces','spaceResolve','spaceEntry'].includes(b.op)?null:b.streamer||'papa'),t=new Date().toISOString();
 if(b.op==='entryLegacyRooms'){
  const rooms=await api('/rest/v1/rpc/papa_streamer_directory_in_space',{chosen_space:'space-001'});
  return respond({rooms:rooms.map((room:any)=>({id:room.id,slug:room.slug,display_name:room.display_name}))});
 }
 if(b.op==='spaceEntry'){
  if(!who?.accountId)throw Error('請先重新登入');
  if(b.slug!=null&&(typeof b.slug!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(b.slug))
   ||b.hostname!=null&&(typeof b.hostname!=='string'||b.hostname.length>253||!/^[a-z0-9][a-z0-9.-]*$/.test(b.hostname)))
   throw Error('空間網址不正確');
  return respond(await api('/rest/v1/rpc/papa_account_space_entry',{
   subject:who.accountId,actor_role:isSuper(who)?'president':who.role,
   chosen_streamer:who.role==='streamer_admin'?who.streamer_id:typeof b.streamer==='string'&&b.streamer.length<=200?b.streamer:null,
   requested_slug:b.slug||null,requested_hostname:b.hostname||null,
   page_limit:Math.max(1,Math.min(100,Math.floor(Number(b.limit)||50))),
   page_offset:Math.max(0,Math.min(10000,Math.floor(Number(b.offset)||0)))}));
 }
 if(b.op==='spaces'||b.op==='spaceResolve'){
  if(!who?.accountId)throw Error('請先重新登入');
  if(b.op==='spaces')return respond({spaces:await api('/rest/v1/rpc/papa_account_space_list',{subject:who.accountId})});
  if(typeof b.slug!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(b.slug))throw Error('找不到可使用的空間');
  const space=await api('/rest/v1/rpc/papa_account_space_by_slug',{subject:who.accountId,requested_slug:b.slug});
  if(!space)throw Error('找不到可使用的空間');return respond({space});
 }
 if(b.op==='deviceStart'){
  if(!who?.accountId)throw Error('請先重新登入，才能記住此裝置');
  if(typeof b.installationId!=='string'||!/^[a-f0-9-]{36}$/i.test(b.installationId)
   ||!['web','android','desktop','ios'].includes(b.platform))throw Error('裝置資訊不正確');
  const refreshToken='refresh:'+crypto.randomUUID()+crypto.randomUUID();
  const role=who.role==='super_admin'?'president':who.role;
  const registration=await api('/rest/v1/rpc/papa_start_device_session',{
   subject:who.accountId,chosen_installation:b.installationId,chosen_platform:b.platform,
   chosen_version:String(b.appVersion||'').slice(0,64),chosen_role:role,
   chosen_space:who.spaceId||null,chosen_streamer:who.streamer_id||null,
   new_refresh_hash:await hash(refreshToken),chosen_login_id:who.loginId||''});
  if(!registration?.sessionId)throw Error('裝置登入尚未完成');
  return respond({...registration,refreshToken,...(who.role==='player'?{playerId:who.playerId,loginId:who.loginId||''}:{})});
 }
 if(b.op==='deviceSwitchSpace'||b.op==='deviceSpacePreferences'){
  if(typeof b.sessionId!=='string'||!/^[a-f0-9-]{36}$/i.test(b.sessionId)
   ||typeof b.refreshToken!=='string'||!b.refreshToken.startsWith('refresh:')||b.refreshToken.length>200)
   throw Error('裝置登入已到期，請重新登入');
  const current_refresh_hash=await hash(b.refreshToken);
  if(b.op==='deviceSpacePreferences'){
   const preferences=await api('/rest/v1/rpc/papa_read_device_space_preferences',{chosen_session:b.sessionId,current_refresh_hash});
   if(!preferences)throw Error('裝置登入已到期，請重新登入');
   return respond(preferences);
  }
  if(typeof b.slug!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(b.slug)
   ||b.streamer!=null&&(typeof b.streamer!=='string'||!b.streamer.trim()||b.streamer.length>200))
   throw Error('找不到可使用的空間');
  const refreshToken='refresh:'+crypto.randomUUID()+crypto.randomUUID();
  const switched=await api('/rest/v1/rpc/papa_switch_device_space',{
   chosen_session:b.sessionId,current_refresh_hash,requested_slug:b.slug,
   requested_streamer:b.streamer||null,new_refresh_hash:await hash(refreshToken)});
  if(!switched?.sessionId)throw Error('裝置登入已到期，請重新登入');
  return respond({sessionId:switched.sessionId,refreshToken,
   role:switched.role==='president'?'super_admin':switched.role,
   spaceId:switched.spaceId||null,streamerId:switched.streamerId||null,
   spaceSlug:switched.spaceSlug,selectedSpace:switched.selectedSpace,
   selectedStreamerId:switched.selectedStreamerId||null,
   homeSpace:switched.homeSpace||null,lastSpace:switched.lastSpace||null,
   ...(switched.role==='player'?{playerId:switched.playerId,loginId:switched.loginId||''}:{})});
 }
 if(b.op==='deviceRefresh'){
  if(typeof b.sessionId!=='string'||!/^[a-f0-9-]{36}$/i.test(b.sessionId)
   ||typeof b.refreshToken!=='string'||!b.refreshToken.startsWith('refresh:'))
   throw Error('裝置登入已到期，請重新登入');
  const token='device:'+crypto.randomUUID()+crypto.randomUUID(),refreshToken='refresh:'+crypto.randomUUID()+crypto.randomUUID();
  const refreshed=await api('/rest/v1/rpc/papa_refresh_device_access',{
   chosen_session:b.sessionId,old_refresh_hash:await hash(b.refreshToken),
   new_refresh_hash:await hash(refreshToken),new_access_hash:await hash(token)});
  if(!refreshed)throw Error('裝置登入已到期，請重新登入');
  return respond({token,refreshToken,sessionId:refreshed.sessionId,
   role:refreshed.role==='president'?'super_admin':refreshed.role,
   streamerId:refreshed.streamerId,spaceId:refreshed.spaceId,
   ...(Object.hasOwn(refreshed,'homeSpace')?{homeSpace:refreshed.homeSpace,lastSpace:refreshed.lastSpace,
    selectedSpace:refreshed.selectedSpace,selectedStreamerId:refreshed.selectedStreamerId,spaceSlug:refreshed.spaceSlug}:{}),
   ...(refreshed.role==='player'?{playerId:refreshed.playerId,loginId:refreshed.loginId||''}:{}),expiresIn:43200});
 }
 if(b.op==='deviceLogout'){
  if(typeof b.sessionId!=='string'||!/^[a-f0-9-]{36}$/i.test(b.sessionId)
   ||typeof b.refreshToken!=='string'||!b.refreshToken.startsWith('refresh:'))
   throw Error('裝置資訊不正確');
  const revoked=await api('/rest/v1/rpc/papa_revoke_device_with_refresh',{
   chosen_session:b.sessionId,current_refresh_hash:await hash(b.refreshToken)});
  if(!revoked)throw Error('裝置登入已到期，請重新登入');
  return respond({ok:true});
 }
 if(b.op==='logout'){
  if(String(b.token||'').startsWith('device:'))throw Error('請使用裝置登出');
  if(who)await api('/rest/v1/papa_push_subscriptions?session_hash=eq.'+await hash(b.token),undefined,'DELETE');
  if(/^(player|admin|streamer):/.test(b.token||''))
   await api('/rest/v1/papa_v2_sessions?token_hash=eq.'+await hash(b.token),undefined,'DELETE');
  return respond({ok:true});
 }
 if(b.op==='backup'){
  if(!isSuper(who)||!who.accountId)throw Error('僅限 PA Party總裁備份');
  const snapshot=await api('/rest/v1/rpc/papa_president_full_backup',{subject:who.accountId});
  if(snapshot.architecture?.formatVersion!==1)throw Error('備份資料格式錯誤');
  return respond({backup:{...snapshotState(snapshot),architecture:snapshot.architecture},now:t});
 }
 // The legacy business snapshot is still a Space 001 compatibility path.
 // Do not expose a second Space through it before scoped reads/writes ship.
 if(who?.spaceId&&who.spaceId!=='space-001')
  throw Error('此 Space 的資料頁尚未開放');
 if(b.op==='streamerLogin'){
  const snapshot=await loadCommunicationState(),r=scopeState(snapshot,b.streamer).currentStreamer,token='streamer:'+crypto.randomUUID()+crypto.randomUUID();
  const sessionHash=await hash(token);
  if(typeof b.password!=='string'||!await api('/rest/v1/rpc/papa_manager_login',{kind:'streamer',room:r.id,password:b.password,auth_user:ADMIN||null,session_hash:sessionHash}))throw Error('主播密碼不正確、尚未啟用或嘗試過多，請稍後再試');
  const identity=await api('/rest/v1/rpc/papa_bind_verified_legacy_session',{session_hash:sessionHash});
  if(identity?.role!=='streamer_admin'||identity?.streamerId!==r.id)throw Error('主播登入身分尚未完成設定');
  return respond({token,role:'streamer_admin',streamerId:r.id,streamerSlug:r.slug,expiresIn:43200,legacy:true});
 }
 if(b.op==='streamerAccounts'){if(!isSuper(who))throw Error('僅限 PA Party總裁');return respond({accounts:await api('/rest/v1/papa_streamer_accounts?select=streamer_id,enabled,updated_at')});}
 if(b.op==='setStreamerAccount'){
  if(!isSuper(who))throw Error('僅限 PA Party總裁');const room=(await managerRoom(who,b.streamer||'papa')).id;
  if(b.password!=null&&typeof b.password!=='string')throw Error('密碼格式不正確');
  const result=await api('/rest/v1/rpc/papa_manage_streamer_login',{room,password:b.password||null,active:b.enabled===true,auth_user:ADMIN||null});managerPasswordError(result,'streamer');return respond({ok:true});
 }
 if(b.op==='adminLogin'){
  const token='admin:'+crypto.randomUUID()+crypto.randomUUID();
  const sessionHash=await hash(token);
  if(typeof b.password!=='string'||!await api('/rest/v1/rpc/papa_manager_login',{kind:'president',room:null,password:b.password,auth_user:ADMIN||null,session_hash:sessionHash}))throw Error('總裁密碼不正確或嘗試過多，請稍後再試');
  const identity=await api('/rest/v1/rpc/papa_bind_verified_legacy_session',{session_hash:sessionHash});
  if(identity?.role!=='president')throw Error('總裁登入身分尚未完成設定');
  return respond({token,role:'super_admin',expiresIn:43200,legacy:true});
 }
 if(b.op==='refreshAdmin')throw Error('請使用總裁密碼重新登入');
 if(b.op==='changeManagerPassword'){
  if(!isManager(who))throw Error('請先登入管理');
  if(typeof b.currentPassword!=='string'||typeof b.newPassword!=='string')throw Error('請填寫目前密碼及新密碼');
  const kind=isSuper(who)?'president':'streamer',room=isSuper(who)?null:who.streamer_id;
  const result=await api('/rest/v1/rpc/papa_change_manager_password',{kind,room,current_password:b.currentPassword,new_password:b.newPassword,auth_user:ADMIN||null,session_hash:await hash(b.token)});
  managerPasswordError(result,kind);return respond({ok:true,signOut:true});
 }
 if(b.op==='upload'){if(!isManager(who))throw new Error('只有管理員能上傳');await managerRoom(who,b.streamer||'papa');const binary=Uint8Array.from(atob(b.image),c=>c.charCodeAt(0));if(binary.length>3145728||b.mime!=='image/webp')throw new Error('請使用壓縮後圖片');const path=crypto.randomUUID()+'.webp',r=await fetch(SB_URL+'/storage/v1/object/papa-photos/'+path,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'image/webp'},body:binary});if(!r.ok)throw new Error('圖片上傳失敗');return respond({url:SB_URL+'/storage/v1/object/public/papa-photos/'+path});}
 if(b.op==='events'){if(!isManager(who))throw new Error('請先登入管理');const room=await catalogRoom(who,b.streamer||'papa',true),page=Math.max(0,Math.min(200,Math.floor(Number(b.page)||0)));return respond(await api('/rest/v1/rpc/papa_event_page_v2',{room_id:room.id,page_number:page,include_global:isSuper(who),module_filter:null,page_limit:50,page_offset:page*50}));}
 if(b.op==='pushWorker'){const [config]=await api('/rest/v1/papa_notice_config?id=eq.worker');if(!b.secret||await hash(b.secret)!==await hash(config?.value?.secret||''))throw Error('驗證失敗');await deliverPush();return respond({ok:true});}
 if(CATALOG_OPS.has(b.op))return respond(await catalogOperation(b,who));
 if(['boardRooms','boardDirectory','boardBlocks','boardUnblock','boardBlock','boardList','boardCreate','boardChange'].includes(b.op))return respond(await boardOperation(b,who,await loadCommunicationState(isSuper(who)?null:who?.spaceId||'space-001',b.streamer||'papa')));
 if(['noticeSound','notifications','noticeTest','noticeRead','noticePreferences','pushKey','pushSubscribe','pushUnsubscribe','chatInbox','chatMessages','chatSend','chatRead'].includes(b.op)){
  const comm=await loadCommunicationState(isSuper(who)?null:who?.spaceId||'space-001',b.streamer||'papa');
  if(who?.role==='streamer_admin')requireRoom(who,scopeState(comm,b.streamer||'papa').currentStreamer.id);
  if(['chatInbox','chatMessages','chatSend','chatRead'].includes(b.op))return respond(await chatOperation(b,who,comm));
  return respond(await notificationOperation(b,who,comm));
 }
 // Most 30-second reads are unchanged. Check the tiny revision row first and
 // retain a periodic forced read on the client for time-dependent displays.
 if(b.op==='read'&&b.token&&!who)throw Error('登入已到期，請重新登入');
 if(b.op==='read'&&Number.isInteger(b.revision)&&b.revision>=0&&b.signatures&&typeof b.signatures==='object'&&!Array.isArray(b.signatures)&&Object.keys(b.signatures).length){
  const [row]=await api('/rest/v1/papa_v2_revision?id=eq.1&select=revision&limit=1');
  if(row&&Number(row.revision)===b.revision){
   const comm=await loadCommunicationState(isSuper(who)?null:who?.spaceId||'space-001',b.streamer||'papa').catch(()=>null);
   if(comm){const room=scopeState(comm,b.streamer||'papa').currentStreamer;requireRoom(who,room.id);if(!room.active&&!isManager(who))throw Error('主播頁暫未開放');return respond({state:{},now:t,ready:true});}
  }
 }
 if(b.op==='mutate'&&!who)throw Error('請先登入');
 if(b.op==='mutate'&&who?.role==='player'&&!['request','wish','self','cancelOwn'].includes(b.action?.type))throw Error('請先登入管理');
 if(b.op==='mutate'&&b.action?.type==='streamer')return respond(await mutateStreamerRegistry(b,who,t));
 if(b.op==='songSearch'){const room=await catalogRoom(who,b.streamer||'papa',true);if((room.spaceId||'space-001')!=='space-001')throw Error('此 Space 的資料頁尚未開放');const query=String(b.query||'').trim();if(query.length>100)throw Error('搜尋文字過長');return respond({songs:query?await api('/rest/v1/rpc/papa_song_search_in_space',{query_text:query,requested_space:room.spaceId||'space-001',page_limit:100}):[]});}
 const roomScoped=b.op==='mutate'&&scopedOperationalAction(b.action);
 if(b.op==='import'&&(!isManager(who)||!['players','songs','crowns'].includes(b.kind)))throw Error('匯入類型或權限不正確');
 if(b.op==='migrate'&&(!isSuper(who)||!who.accountId||(b.streamer||'papa')!=='papa'))throw Error('僅限總裁在原始主播空間移轉舊資料');
 const draftOperation=['draftStart','publish'].includes(b.op);
 let draftScope:any=null;
 if(draftOperation){
  if(!isSuper(who)||!who.accountId)throw Error('僅限 PA Party總裁');
  draftScope=await catalogRoom(who,b.streamer||'papa',true);
  if((draftScope.spaceId||'space-001')!=='space-001')throw Error('此 Space 的資料頁尚未開放');
  if(b.op==='publish')validateRoomDraft(b.journal,{spaceId:draftScope.spaceId||'space-001',streamerId:draftScope.id},b.baseRevision);
 }
 const roomImport=b.op==='import';
 const roomWriteScoped=roomImport||b.op==='publish'||b.op==='mutate'&&!roomScoped&&scopedRoomMutationAction(b.action);
 const selectedWriteSongs=roomWriteScoped&&b.action?.type==='song'&&typeof b.action?.data?.songId==='string'&&!b.action.data.remove?[b.action.data.songId]:[];
 const s=await load(['read','failedRequest','search','login'].includes(b.op)||roomScoped||draftOperation,draftScope?.id||b.streamer||'papa',draftScope?.spaceId||who?.spaceId||'space-001',roomWriteScoped&&!draftOperation?selectedWriteSongs:null,who?.role==='player'?typeof b.profilePlayerId==='string'?who.playerId:null:isManager(who)?typeof b.profilePlayerId==='string'?b.profilePlayerId:b.action?.type==='extraQuota'?b.action?.data?.player_id:null:null);
 if(b.op==='draftStart')return respond({draft:{state:s,journal:createRoomDraft(s,draftScope.id),baseRevision:s.revision},now:t});
 if(b.op==='failedRequest'){if(who?.role!=='player')throw new Error('請先登入玩家');const room=scopeState(s,b.streamer||'papa'),p=room.players.find((p:any)=>p.playerId===who.playerId);if(!room.currentStreamer.active||!p)throw new Error('找不到玩家');const quote=quoteSong(room,b.songId,b,who.playerId,t),available=balance(room,who.playerId)-reservedCredits(room,who.playerId),full=!canRequestSaved(room,t,quote.creditCost,who.playerId);if(available<quote.creditCost||!full)return respond({counted:false});const counted=await api('/rest/v1/rpc/papa_record_failed_request',{room_id:room.currentStreamer.id,player_id:who.playerId,song_id:b.songId,bucket:hourKey(t)});schedulePush(room.currentStreamer.id,['__admin__',who.playerId]);return respond({counted});}if(b.op==='login'){if(who?.playerId)throw new Error('請先登出再登入');const p=s.players.find((p:any)=>p.playerId===b.playerId);if(!p||String(p.password||'')!==String(b.password||''))throw new Error('玩家密碼不正確');const token='player:'+crypto.randomUUID()+crypto.randomUUID(),sessionHash=await hash(token);await api('/rest/v1/papa_v2_sessions',{token_hash:sessionHash,player_id:p.playerId,login_id:p.ids.includes(b.loginId)?b.loginId:'',expires_at:new Date(Date.now()+30*86400000).toISOString()});const identity=await api('/rest/v1/rpc/papa_bind_verified_legacy_session',{session_hash:sessionHash});if(identity?.role!=='player'||identity?.spaceId!=='space-001')throw new Error('玩家登入身分尚未完成設定');return respond({token});}
 if(b.op==='search'){return respond({players:b.query?.trim()?playerSearch(s,b.query).slice(0,20).map((p:any)=>({playerId:p.playerId,name:p.name,ids:p.ids,hasPassword:!!p.password})):[]});}
 const project=async(value:any)=>{const base=leanSongView(managementView(publicView(value,coreActor(who),t,b.streamer||'papa'),who)),rows=await api('/rest/v1/rpc/papa_catalog_song_metadata_in_space',{room_id:base.currentStreamer.id}),view=catalogMetadataView(base,rows,isManager(who)),signatures:any={},delta:any={};for(const [key,v] of Object.entries(view)){signatures[key]=await hash(JSON.stringify(v));if(b.signatures?.[key]!==signatures[key])delta[key]=v;}return {state:delta,signatures,now:t,ready:value.schemaVersion>=3};};
 if(b.op==='mutate'&&b.action?.type==='extraQuota'){
  if(!isManager(who))throw Error('請先登入管理');
  if(b.revision!==s.revision)throw Error('資料剛更新了，請重新整理後再試一次');
  const room=scopeState(s,b.streamer||'papa').currentStreamer;requireRoom(who,room.id);
  const next=mutate(s,{...b.action,streamer:room.id},coreActor(who),t),p=b.action.data;
  next.revision=await api('/rest/v1/rpc/papa_manage_player_extra_quota',{expected:s.revision,requested_room:room.id,target_player:p.player_id,
   requested_extra:Number(p.extra_quota),requested_enabled:p.enabled,actor_context:{role:who.role,account_id:who.accountId,
    space_id:room.spaceId||who.spaceId||'space-001',streamer_id:room.id,actor_streamer_id:who.role==='streamer_admin'?who.streamer_id:null}});
  return respond(await project(next));
 }
 if(b.op==='read'){if(b.token&&!who)throw new Error('登入已到期，請重新登入');return respond(await project(s));}
 if(!isManager(who)&&(b.op!=='mutate'||!['request','wish','self','cancelOwn'].includes(b.action?.type)))throw new Error('請先登入管理');
 if(isManager(who))authorizeManagerOperation(who,b,scopeState(s,b.streamer||'papa').currentStreamer.id);
 if(b.op==='migrate'){
  if(TABLES.some(kind=>s[kind].length)||s.streamers.some((room:any)=>room.id!=='papa'||(room.spaceId||'space-001')!=='space-001'))throw Error('已有正式資料或其他主播，不能重複移轉');
  const rows=await api('/rest/v1/party_state?id=eq.1&select=data&limit=1'),old=rows[0]?.data;if(!old)throw Error('找不到 V1 資料');
  const sourceHash=await hash(JSON.stringify(old)),migrated=migrateLegacy(old);
  if(!b.confirm)return respond({issues:migrated.migrationIssues,counts:Object.fromEntries(TABLES.map(k=>[k,migrated[k].length])),backup:old,baseRevision:s.revision,sourceHash});
  if(b.revision!==s.revision||b.sourceHash!==sourceHash)throw Error('移轉來源已更新，請重新核對並保存備份');
  return respond({state:publicView(await commit(s,upgradePlatform(migrated),{role:who.role,account_id:who.accountId,space_id:'space-001',streamer_id:'papa',action:'migrate'}),coreActor(who),t,'papa'),now:t});
 }
 if(b.revision!==s.revision)throw new Error('資料剛更新了，請重新整理後再試一次');
 let next;
 if(b.op==='import')next=applyRoomImport(s,b.kind,b.text,b.choices,coreActor(who),t,b.streamer||'papa');
 else if(b.op==='publish'){
  if(b.baseRevision!==s.revision)throw new Error('正式資料已有更新，請先下載草稿備份再重新建立');
  const rows=b.journal.actions.some((entry:any)=>entry.kind==='mutate'&&entry.action?.type==='song'&&entry.action.data?.songId&&!entry.action.data.remove)?await api('/rest/v1/rpc/papa_catalog_song_metadata_in_space',{room_id:draftScope.id}):[];
  next=replayRoomDraft(s,b.journal,coreActor(who),t,(action:any,current:any,room:string)=>catalogPreserveSource(prepareManagerAction(who,action,current),current,room,rows));
  if(!b.journal.actions.length)return respond(await project(s));
 }else {let action=prepareManagerAction(who,b.action,s);const actionSpace=scopeState(s,b.streamer||'papa').currentStreamer.spaceId||who?.spaceId||'space-001';if(actionSpace!=='space-001'&&['player','self'].includes(action?.type)&&['password','token','refreshToken','accessToken'].some(key=>Object.hasOwn(b.action?.data||{},key)))throw Error('登入資料由帳號管理，不能寫入玩家資料');if(isManager(who)&&action?.type==='song'&&action.data?.songId&&!action.data.remove){const room=scopeState(s,b.streamer||'papa').currentStreamer.id;action=catalogPreserveSource(action,s,room,await api('/rest/v1/rpc/papa_catalog_song_metadata_in_space',{room_id:room}));}next=mutate(s,{...action,streamer:b.streamer||'papa'},coreActor(who),t);}
 const targetSpace=scopeState(s,b.streamer||'papa').currentStreamer.spaceId||who?.spaceId||'space-001';
 if(b.playerBindings!==undefined&&(targetSpace==='space-001'||!Array.isArray(b.playerBindings)||!roomWriteScoped))throw Error('玩家帳號綁定格式不正確');
 return respond(await project(await commit(s,next,{role:who?.role||'unknown',player_id:who?.playerId||null,
  account_id:who?.accountId||null,space_id:targetSpace,player_bindings:b.playerBindings||[],
  actor_streamer_id:who?.role==='streamer_admin'?who.streamer_id:null,
  streamer_id:scopeState(s,b.streamer||'papa').currentStreamer.id,
  roomScoped,roomWriteScoped,action:b.op==='mutate'?b.action?.type+(b.action?.data?.operation?':'+b.action.data.operation:''):b.op})));
 }catch(e){return respond({error:e.message||'操作失敗'},400);}});
