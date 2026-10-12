import {accountingDay} from '../../../src/accounting.js';
import {applyPlayerRequestBatch,validateRequestBatch,applyOwnQueueBatch,validateOwnQueueBatch} from '../../../src/player-bulk-tools.js';
import {isSuper,isManager,coreActor,requireRoom,authorizeManagerOperation,managementView,noticeIdentity,validNoticeAudio,prepareManagerAction} from '../../../src/access-policy.js';
import {stateChanges,scopedOperationalAction,scopedRoomMutationAction} from '../../../src/state-patch.js';
import {applyRoomImport} from '../../../src/room-import.js';
import {createRoomDraft,validateRoomDraft,replayRoomDraft} from '../../../src/room-draft.js';
// No browser access to tables or VAPID secrets. All recipient keys come from actor().
import webpush from 'npm:web-push@3.6.7';
import {NOTICE_TYPES,cleanNoticePrefs,noticeChannels,validPushSubscription,canonicalNoticeLink,webNoticePath} from '../../../src/notification-rules.js';

async function noticeKeys(){
 let rows=await api('/rest/v1/papa_notice_config?id=eq.vapid');
 if(!rows.length){const key=webpush.generateVAPIDKeys();const r=await fetch(SB_URL+'/rest/v1/papa_notice_config',{method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({id:'vapid',value:key})});if(!r.ok)throw Error('推播設定暫時無法建立');rows=await api('/rest/v1/papa_notice_config?id=eq.vapid');}
 return rows[0].value;
}
async function notificationOperation(b:any,who:any,s:any){
 if(!who)throw Error('請先登入');
 const source=scopeState(s,b.streamer||'papa').currentStreamer,sourceRoom=source.id,{room,recipient}=noticeIdentity(who,sourceRoom);
 if(!recipient)throw Error('請先登入');
 if(['messageCenter','messageCenterCounts','messageCenterRead','messageCenterPreferences'].includes(b.op))return messageCenterOperation(b,who,source);
 if(b.op==='noticeTarget')return noticeTarget(b,who,source);
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
import {empty,TABLES,mutate,publicView,migrateLegacy,previewImport,applyImport,playerSearch,upgradePlatform,scopeState,searchAcrossStreamers,balance,reservedCredits,usedHour,reservedHour,quoteSong,hourKey,canRequestSaved,ownQueueReplacementQuote} from '../../../src/core.js';
import {venuePolicySavedSnapshot} from '../../../src/venue-policy.js';
import {buildNativePlayerBindings} from '../../../src/native-player-bindings.js';
import {chatAccess} from '../../../src/chat-policy.js';
import {boardActor,boardThreadVisible,boardUuid} from '../../../src/board-policy.js';
const SB_URL=Deno.env.get('SUPABASE_URL')!,KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,ADMIN=Deno.env.get('PAPA_ADMIN_USER_ID');
const headers={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,authorization,apikey','Access-Control-Allow-Methods':'POST, OPTIONS'};
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const revisionConflictMessage='資料剛更新了，請重新整理後再試一次';
const revisionConflictCommits=new Set(['papa_v2_commit','papa_release_b_commit','papa_room_operational_commit','papa_room_admin_commit','papa_room_admin_commit_with_player_bindings','papa_streamer_registry_commit','papa_manage_player_extra_quota','papa_player_archive','papa_players_archive']);
function revisionConflictError(){return Object.assign(Error(revisionConflictMessage),{code:'VERSION_CONFLICT',notCommitted:true});}
// Only a known atomic write RPC's actual SQL rejection proves that write was
// rolled back. A failed fetch/5xx or a later projection cannot provide proof.
function rejectedRevisionConflict(path:string,status:number,detail:any){
 const rpc=/^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(path)?.[1];
 return status>=400&&status<500&&revisionConflictCommits.has(rpc||'')&&detail?.message==='VERSION_CONFLICT'&&['PT409','40001','P0001'].includes(detail.code);
}
function unknownOperationOutcome(error:any){return Object.assign(error instanceof Error?error:Error('資料讀取失敗'),{notCommitted:false,outcome:'unknown'});}
function operationErrorResponse(error:any){
 if(error?.code==='NOTICE_SNAPSHOT_INVALID')return {error:error.message,code:'NOTICE_SNAPSHOT_INVALID'};
 const definite=error?.code==='VERSION_CONFLICT'&&error.notCommitted===true&&error.outcome!=='unknown';
 return {error:error?.message||'操作失敗',...(definite?{code:'VERSION_CONFLICT',notCommitted:true}:{outcome:'unknown'})};
}
function missingRoomSyncHead(path:string,status:number,detail:any){
 return path==='/rest/v1/rpc/papa_room_sync_head'&&status===404&&detail?.code==='PGRST202'
  &&typeof detail.message==='string'&&/^Could not find the function public\.papa_room_sync_head(?:\(|\s|$)/.test(detail.message);
}
async function api(path:string,body?:unknown,method?:string){
 let r:any,text:string;try{r=await fetch(SB_URL+path,{method:method||(body?'POST':'GET'),headers,body:body?JSON.stringify(body):undefined});text=await r.text();}catch(error){throw unknownOperationOutcome(error);}
 if(!r.ok){
  const messages:any={DEVICE_SWITCH_SPACE_INVALID:'找不到可使用的空間',DEVICE_SWITCH_ROOM_INVALID:'此登入不適用選擇的主播',DEVICE_SWITCH_MEMBERSHIP_REQUIRED:'你沒有此空間的使用權限',DEVICE_SWITCH_PROFILE_REQUIRED:'此空間的玩家資料尚未建立',DEVICE_SWITCH_IDENTITY_INVALID:'裝置登入已到期，請重新登入',DEVICE_SWITCH_INSTALLATION_INVALID:'裝置登入已到期，請重新登入',DEVICE_SWITCH_INVALID:'裝置資訊不正確',ACCOUNT_DISABLED:'登入已到期，請重新登入',MEMBERSHIP_REQUIRED:'登入已到期，請重新登入',MEMBERSHIP_SUSPENDED:'登入已到期，請重新登入',SESSION_ACCOUNT_MISMATCH:'登入已到期，請重新登入',DEVICE_IDENTITY_MISMATCH:'登入已到期，請重新登入',BOARD_MODERATED:'此留言由管理者隱藏，請聯絡管理者恢復',BOARD_RATE_LIMIT:'留言送得太快，請稍候三秒再試',BOARD_RETRY_CHANGED:'重試內容不同，請重新開啟留言板',CHAT_RATE_LIMIT:'訊息送得太快，請稍候再送',CHAT_REQUEST_REUSED:'訊息重試內容不同，請重新開啟私訊',PLAYER_ARCHIVE_PENDING_QUEUE:'此玩家仍有待播歌曲，請先完成或取消後再封存',PLAYER_ARCHIVE_TARGET_INVALID:'找不到此空間的玩家',PLAYER_ARCHIVE_ACTOR_INVALID:'只有 PA Party總裁可以封存或恢復玩家',VERSION_CONFLICT:'資料剛更新了，請重新整理後再試一次',CATALOG_SELECTION_STALE:'共同資料剛更新，請重新選取後再操作',CATALOG_SOURCE_STALE:'原歌曲剛更新，請重新選取後再審核',CATALOG_CANDIDATE_STALE:'候選歌曲剛更新，請重新選取後再審核',CATALOG_TEMPLATE_MISSING:'這個模板已停用或不存在，請重新選擇',CATALOG_ALREADY_LINKED:'歌曲已建立共同關聯，請重新整理',CATALOG_AMBIGUOUS_TARGET:'存在多筆同版本共同歌曲，請選擇既有目標後再連結',CATALOG_BATCH_DIFFERENT_VERSIONS:'所選歌曲屬於不同版本，請分批處理'};
  Object.assign(messages,{LISTENING_HISTORY_SCOPE_INVALID:'找不到主播的常聽歌單',LISTENING_HISTORY_ACTOR_INVALID:'無法查看其他玩家的常聽歌單',LISTENING_HISTORY_PLAYER_INVALID:'找不到此玩家',LISTENING_HISTORY_PAGE_INVALID:'常聽歌單分頁資料不正確',SONG_FAVORITES_SCOPE_INVALID:'找不到可收藏的主播空間',SONG_FAVORITES_ACTOR_INVALID:'登入已到期，請重新登入',SONG_FAVORITES_SONG_INVALID:'歌曲已隱藏或更新，請重新選擇',SONG_FAVORITES_INPUT_INVALID:'收藏資料不正確',SONG_FAVORITES_PAGE_INVALID:'收藏分頁資料不正確',NEW_PRACTICE_SCOPE_INVALID:'找不到主播的新練歌曲',NEW_PRACTICE_PAGE_INVALID:'新練歌曲分頁資料不正確',STREAMER_REGISTRY_DUPLICATE:'主播網址已使用',STREAMER_REGISTRY_ACTOR_INVALID:'總裁登入已到期，請重新登入',
   STREAMER_REGISTRY_SCOPE_INVALID:'請切換到該主播空間再編輯',STREAMER_REGISTRY_ROOM_INVALID:'找不到主播',
   STREAMER_REGISTRY_SPACE_INVALID:'找不到可使用的空間',STREAMER_REGISTRY_DESCRIPTOR_INVALID:'主播資料格式錯誤'});
  let rejected=false,conflict=false,headUnavailable=false,snapshotInvalid=false;try{const detail=JSON.parse(text);rejected=path.startsWith('/rest/v1/rpc/')&&r.status<500&&typeof detail?.code==='string'&&/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(detail.code);conflict=rejectedRevisionConflict(path,r.status,detail);headUnavailable=missingRoomSyncHead(path,r.status,detail);snapshotInvalid=path==='/rest/v1/rpc/papa_notice_category_page'&&r.status>=400&&r.status<500&&detail.code==='P0001'&&detail.message==='NOTICE_SNAPSHOT_INVALID';}catch{}
  if(snapshotInvalid)throw Object.assign(Error('通知列表已更新，請重新讀取第一頁'),{code:'NOTICE_SNAPSHOT_INVALID',rpcRejected:true});
  if(conflict)throw Object.assign(revisionConflictError(),{rpcRejected:rejected});
  throw Object.assign(Error(Object.entries(messages).find(([code])=>text.includes(code))?.[1]||'資料庫操作失敗'),{rpcRejected:rejected,roomSyncHeadUnavailable:headUnavailable});
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
 if(b.revision!==source.revision)throw revisionConflictError();
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
async function accountingSummary(room:any,day:string|null){
 const summary=await api('/rest/v1/rpc/papa_accounting_summary',{requested_space:room.spaceId||'space-001',requested_room:room.id,requested_day:day});
 if(!summary||summary.scope?.spaceId!==(room.spaceId||'space-001')||summary.scope?.roomId!==room.id||day!==null&&summary.day!==day||!/^\d{4}-\d{2}-\d{2}$/.test(summary.day)||!Number.isInteger(summary.rolloverHour)||summary.rolloverHour<0||summary.rolloverHour>23||summary.timezone!=='Asia/Taipei'
  ||['received','sung','saved','stored','reserved','available'].some(key=>typeof summary[key]!=='number'||!Number.isFinite(summary[key]))
  ||!Number.isSafeInteger(summary.revision)||summary.received<0||summary.stored<0||summary.sung<0||summary.reserved<0
  ||summary.available!==summary.saved-summary.reserved)throw Error('帳務摘要範圍或數量不正確');
 return summary;
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
 if(typeof token!=='string'||!/^(player|admin|streamer|device):/.test(token))return null;
 const sessionHash=await hash(token),r=await api('/rest/v1/rpc/papa_verified_session_actor',{session_hash:sessionHash,requested_room:requestedRoom});
 const record=(value:any)=>!!value&&typeof value==='object'&&!Array.isArray(value);
 const id=(value:any)=>typeof value==='string'&&value.length>0&&value.length<=200&&value.trim()===value&&!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value);
 const account=(value:any)=>typeof value==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
 if(!record(r))return null;
 const device=token.startsWith('device:');
 const expectedRole=device?r.role:token.startsWith('admin:')?'super_admin':token.startsWith('streamer:')?'streamer_admin':'player';
 if(r.role!==expectedRole||!['super_admin','streamer_admin','player'].includes(r.role))return null;
 if(r.role==='super_admin'&&(r.spaceId!=null||r.streamerId!=null||r.playerId!=null)
  ||r.role==='streamer_admin'&&(!id(r.spaceId)||!id(r.streamerId)||r.playerId!=null)
  ||r.role==='player'&&(!id(r.spaceId)||!id(r.playerId)||r.streamerId!=null))return null;
 if(r.accountId==null){
  if(device||r.deviceSessionId!=null||r.role==='player'&&r.spaceId!=='space-001')return null;
  // The binder locks this verified token and preserves any existing Account.
  // Its role/scope must agree with the original requested-room authorization.
  const bound=await api('/rest/v1/rpc/papa_bind_verified_legacy_session',{session_hash:sessionHash});
  if(!record(bound)||!account(bound.accountId)||bound.role!==(r.role==='super_admin'?'president':r.role)
   ||bound.spaceId!==(r.role==='super_admin'?null:r.spaceId)
   ||(bound.streamerId??null)!==(r.role==='streamer_admin'?r.streamerId:null)
   ||bound.playerId!=null&&bound.playerId!==(r.role==='player'?r.playerId:null))return null;
  r.accountId=bound.accountId;
 }
 if(!account(r.accountId))return null;
 if(r.role==='super_admin')return {role:'super_admin',accountId:r.accountId,deviceSessionId:r.deviceSessionId};
 if(r.role==='streamer_admin')return {role:'streamer_admin',streamer_id:r.streamerId,spaceId:r.spaceId,accountId:r.accountId,deviceSessionId:r.deviceSessionId};
 return {role:'player',playerId:r.playerId,loginId:r.loginId,spaceId:r.spaceId,accountId:r.accountId,deviceSessionId:r.deviceSessionId};
}
function sessionIdentity(who:any){
 return {role:who.role,accountId:who.accountId,spaceId:who.role==='super_admin'?null:who.spaceId,
  playerId:who.role==='player'?who.playerId:null,streamerId:who.role==='streamer_admin'?who.streamer_id:null};
}
async function roomSyncHead(b:any,who:any){
 // Initial aggregate heads are manager-only. Player-private heads and private
 // channel authorization are separate capabilities, not inferred from counters.
 if(!isManager(who)||!who.accountId)throw Error('請先登入管理');
 const valid=(value:any)=>typeof value==='string'&&value.length>0&&value.length<=200&&value.trim()===value&&!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value);
 if(!valid(b.streamer)||!valid(b.spaceId))throw Error('同步空間資料不正確');
 requireRoom(who,b.streamer);
 if(!isSuper(who)&&who.spaceId!==b.spaceId)throw Error('找不到主播');
 const capabilities={scopedRevision:false,authoritative:false,delta:false,realtime:false};
 let head:any;
 try{head=await api('/rest/v1/rpc/papa_room_sync_head',{requested_room:b.streamer,requested_space:b.spaceId});}
 catch(error:any){if(error?.roomSyncHeadUnavailable===true)return {supported:false,reason:'migration_unavailable',capabilities};throw error;}
 const record=(value:any)=>!!value&&typeof value==='object'&&!Array.isArray(value);
 if(!record(head)||head.version!==1||head.spaceId!==b.spaceId||head.streamerId!==b.streamer
  ||head.capabilities?.scopedRevision!==true||head.capabilities?.authoritative!==false
  ||head.capabilities?.delta!==false||head.capabilities?.realtime!==false
  ||!Number.isSafeInteger(head.globalRevision)||head.globalRevision<0)throw Error('同步摘要資料不正確');
 const counters=(value:any,domains:string[])=>{
  if(!record(value))throw Error('同步摘要資料不正確');
  return Object.fromEntries(domains.map(domain=>{const revision=value[domain]??0;
   if(!Number.isSafeInteger(revision)||revision<0)throw Error('同步摘要資料不正確');
   return [domain,revision];}));
 };
 // Projection remains a bounded diagnostic head. It cannot advance write CAS,
 // suppress a snapshot, supply record authority or advertise a live channel.
 return {supported:true,head:{version:1,spaceId:b.spaceId,streamerId:b.streamer,
  room:counters(head.room,['songs','queue','ledger','crowns','cards','wishes','settings']),
  space:counters(head.space,['players','settings','directory','metadata','catalog_relations']),
  catalog:counters(head.catalog,['shared_catalog']),globalRevision:head.globalRevision,
  capabilities:{...capabilities,scopedRevision:true}}};
}
async function messageCenterOperation(b:any,who:any,room:any){
 if(!who?.accountId)throw Error('請重新登入');
 const spaceId=room.spaceId||'space-001',scopeMode=b.scopeMode??'room';
 if(b.spaceId!==undefined&&b.spaceId!==spaceId||!['room','space'].includes(scopeMode)
  ||scopeMode==='space'&&!isSuper(who))throw Error('通知空間資料不正確');
 const common={requested_space:spaceId,requested_room:room.id,scope_mode:scopeMode,
  actor_context:{role:who.role,account_id:who.accountId,space_id:spaceId,
   player_id:who.role==='player'?who.playerId:null,actor_streamer_id:who.role==='streamer_admin'?who.streamerId:null}};
 const expectedScope={spaceId,streamerId:scopeMode==='room'?room.id:null,mode:scopeMode};
 const checkScope=(value:any)=>{
  if(value?.version!==1||value.scope?.spaceId!==expectedScope.spaceId||value.scope?.streamerId!==expectedScope.streamerId||value.scope?.mode!==expectedScope.mode)throw Error('通知空間資料不正確');
 };
 if(b.op==='messageCenterPreferences'){
  const settings=b.settings??null;
  if(settings!==null&&(!settings||typeof settings!=='object'||Array.isArray(settings)||Object.keys(settings).some(k=>k!=='types')||!settings.types||typeof settings.types!=='object'||Array.isArray(settings.types)||Object.entries(settings.types).some(([type,value]:any)=>!Object.hasOwn(NOTICE_TYPES,type)||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['center','badge'].includes(k))||typeof value.center!=='boolean'||typeof value.badge!=='boolean')))throw Error('訊息顯示設定不正確');
  const result=await api('/rest/v1/rpc/papa_notice_center_preferences_set',{...common,display_settings:settings});checkScope(result);
  if(!result.settings?.types||typeof result.settings.types!=='object'||Array.isArray(result.settings.types))throw Error('訊息顯示設定未確認');
  const types=Object.fromEntries(Object.keys(NOTICE_TYPES).map(type=>{const value=result.settings.types[type];if(typeof value?.center!=='boolean'||typeof value?.badge!=='boolean')throw Error('訊息顯示設定未確認');return [type,{center:value.center,badge:value.badge}];}));
  return {version:1,scope:expectedScope,settings:{types}};
 }
 const category=b.category;
 if(!['messageCenterCounts','messageCenterPreferences'].includes(b.op)&&!['system','message','board'].includes(category))throw Error('通知分類不正確');
 if(b.op==='messageCenter'){
  const page=b.page??0,snapshotAt=b.snapshotAt??null,snapshotId=b.snapshotId??null;
  if(!Number.isSafeInteger(page)||page<0||page>100000||snapshotAt!==null&&(typeof snapshotAt!=='string'||snapshotAt.length>40||!/^\d{4}-\d{2}-\d{2}T/.test(snapshotAt)||!Number.isFinite(Date.parse(snapshotAt))))throw Error('通知分頁資料不正確');
  if(snapshotId!==null&&!boardUuid(snapshotId))throw Error('通知分頁資料不正確');
  const result=await api('/rest/v1/rpc/papa_notice_category_page',{...common,category_filter:category,page_number:page,snapshot_at:snapshotAt,snapshot_id:snapshotId});
  checkScope(result);
  if(result.category!==category||result.page!==page||result.pageSize!==50||!Number.isSafeInteger(result.total)||result.total<0
   ||typeof result.snapshotAt!=='string'||!Number.isFinite(Date.parse(result.snapshotAt))||!boardUuid(result.snapshotId)
   ||snapshotId!==null&&result.snapshotId!==snapshotId||typeof result.hasMore!=='boolean'
   ||!Array.isArray(result.rows)||result.rows.length>50)throw Error('通知分頁資料不正確');
  const recipient=noticeIdentity(who,room.id).recipient,ids=new Set();
  const rows=result.rows.map((row:any)=>{
   if(!row||!boardUuid(row.id)||ids.has(row.id)||row.space_id!==spaceId||scopeMode==='room'&&row.streamer_id!==room.id
    ||row.recipient!==recipient||typeof row.type!=='string'||row.type.length>100||typeof row.body!=='string'
    ||row.body.length>10000||typeof row.created_at!=='string'||!Number.isFinite(Date.parse(row.created_at))
    ||row.read_at!==null&&(typeof row.read_at!=='string'||!Number.isFinite(Date.parse(row.read_at)))
    ||!Number.isSafeInteger(row.level)||row.level<1||row.level>2
    ||(row.type==='message'?'message':['comment','announcement'].includes(row.type)?'board':'system')!==category)throw Error('通知分頁資料不正確');
   ids.add(row.id);
   return {id:row.id,space_id:spaceId,streamer_id:row.streamer_id,streamer_name:String(row.streamer_name||'').slice(0,200),
    type:row.type,level:row.level,body:row.body,entity_id:typeof row.entity_id==='string'?row.entity_id.slice(0,200):null,
    created_at:row.created_at,read_at:row.read_at};
  });
  return {version:1,scope:expectedScope,category,page,pageSize:50,total:result.total,snapshotAt:result.snapshotAt,snapshotId:result.snapshotId,hasMore:result.hasMore,rows};
 }
 if(b.op==='messageCenterRead'){
  const ids=b.ids??null;
  if(ids===null&&b.all!==true||ids!==null&&(b.all===true||!Array.isArray(ids)||ids.length>50||ids.some((id:any)=>!boardUuid(id))||new Set(ids).size!==ids.length))throw Error('通知編號不正確');
  const result=await api('/rest/v1/rpc/papa_notice_category_read',{...common,category_filter:category,notice_ids:ids});
  checkScope(result);
  if(result.category!==category||!Number.isSafeInteger(result.marked)||result.marked<0)throw Error('通知已讀結果不正確');
  return {version:1,scope:expectedScope,category,marked:result.marked};
 }
 const result=await api('/rest/v1/rpc/papa_notice_category_counts',common);checkScope(result);
 const counts=(value:any,types=false)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>100)throw Error('通知計數不正確');
  const entries=Object.entries(value);
  if(entries.some(([key,count])=>typeof count!=='number'||!Number.isSafeInteger(count)||count<0||key.length>100||!types&&!['system','message','board'].includes(key)))throw Error('通知計數不正確');
  return Object.fromEntries(entries);
 };
 return {version:1,scope:expectedScope,totalsByCategory:counts(result.totalsByCategory),unreadByCategory:counts(result.unreadByCategory),
  unreadByType:counts(result.unreadByType,true),badgeUnreadByCategory:counts(result.badgeUnreadByCategory)};
}

async function noticeTarget(b:any,who:any,room:any){
 if(!who?.accountId)throw Error('請先登入');
 const notificationId=boardUuid(b.notificationId),space=room.spaceId||'space-001';
 const {recipient}=noticeIdentity(who,room.id);
 if(!isSuper(who)&&who.spaceId!==space)throw Error('通知目前無法查看');
 const notices=await api('/rest/v1/papa_notifications?id=eq.'+notificationId
  +'&space_id=eq.'+encodeURIComponent(space)+'&streamer_id=eq.'+encodeURIComponent(room.id)
  +'&recipient=eq.'+encodeURIComponent(recipient)+'&select=id,type,entity_id,streamer_id,space_id,recipient&limit=1');
 const notice=Array.isArray(notices)&&notices.length===1?notices[0]:null;
 if(!notice||notice.id!==notificationId||notice.space_id!==space||notice.streamer_id!==room.id||notice.recipient!==recipient)return {found:false,kind:'generic'};
 const kind=notice.type==='message'?'chat':['comment','announcement'].includes(notice.type)?'board':'generic';
 const unavailable={found:false,kind};
 if(kind==='generic'||typeof notice.entity_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(notice.entity_id))return unavailable;
 if(kind==='chat'){
  // Player equality is part of the query before any conversation locator can
  // leave the server. Notice entity/type fields always come from its own row.
  const access=chatAccess(who,room),rows=await api('/rest/v1/papa_chat_messages?id=eq.'+notice.entity_id
   +'&streamer_id=eq.'+encodeURIComponent(room.id)+(access.manager?'':'&player_id=eq.'+encodeURIComponent(access.player))
   +'&select=id,seq,player_id,streamer_id&limit=1');
  const message=Array.isArray(rows)&&rows.length===1?rows[0]:null;
  if(!message||message.id!==notice.entity_id||message.streamer_id!==room.id
   ||!access.manager&&message.player_id!==who.playerId||!Number.isSafeInteger(message.seq)||message.seq<1)return unavailable;
  try{chatAccess(who,room,message.player_id);}catch{return unavailable;}
  return {found:true,kind,spaceId:space,streamerId:room.id,playerId:message.player_id,messageId:message.id,seq:message.seq};
 }
 const actor=boardActor(who);
 if(!room.active&&actor.role!=='super')return unavailable;
 const namespace=space==='space-001'?'':'space:'+Array.from(new TextEncoder().encode(space),value=>value.toString(16).padStart(2,'0')).join('')+':';
 const globalRoom=space==='space-001'?'__global__':'__global__:'+namespace.slice(6,-1);
 const stored=(key:string)=>namespace+key,local=(key:any)=>typeof key==='string'&&key.startsWith(namespace)?key.slice(namespace.length):null;
 const fields='id,seq,scope,streamer_id,origin_room,root_id,author_key,anonymous,visibility,targets,deleted,moderated,space_id';
 const getPost=async(id:string)=>{
  const rows=await api('/rest/v1/papa_board_posts?id=eq.'+boardUuid(id)+'&space_id=eq.'+encodeURIComponent(space)+'&select='+fields+'&limit=1');
  const post=Array.isArray(rows)&&rows.length===1?rows[0]:null;
  if(!post||post.id!==id||post.space_id!==space||!['global','streamer'].includes(post.scope)
   ||post.streamer_id!==(post.scope==='global'?globalRoom:room.id)||post.scope==='streamer'&&post.origin_room!==room.id
   ||!Number.isSafeInteger(post.seq)||post.seq<1||!Array.isArray(post.targets)||post.targets.length>50)return null;
  const author=local(post.author_key),targets=post.targets.map(local);
  if(!author||targets.some((key:any)=>key===null))return null;
  return {...post,author_key:author,targets};
 };
 const post=await getPost(notice.entity_id);if(!post)return unavailable;
 let root=post;
 if(post.root_id){
  if(typeof post.root_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(post.root_id))return unavailable;
  root=await getPost(post.root_id);
 }
 if(!root||root.root_id||root.scope!==post.scope||root.streamer_id!==post.streamer_id||root.origin_room!==post.origin_room)return unavailable;
 // Only two necessary nonanonymous author block keys are queried together.
 // An anonymous locator never returns or resolves its hidden author identity.
 const keys=[...new Set<string>([post,root].filter(item=>!item.anonymous).map(item=>stored(item.author_key)))];
 const quoted=(value:string)=>encodeURIComponent('"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"');
 const blocks=keys.length?await api('/rest/v1/papa_board_blocks?space_id=eq.'+encodeURIComponent(space)
  +'&owner_key=eq.'+encodeURIComponent(stored(actor.key))+'&target_key=in.('+keys.map(quoted).join(',')+')&select=target_key&limit=2'):[];
 const blocked=Array.isArray(blocks)?blocks.map((row:any)=>local(row.target_key)).filter((key:any)=>key!==null):[];
 if(!boardThreadVisible(actor,post,root,blocked))return unavailable;
 return {found:true,kind,spaceId:space,streamerId:room.id,scope:post.scope,rootId:root.id,postId:post.id,seq:post.seq,canReply:!root.deleted&&!root.moderated};
}
function managerPasswordError(result:any,kind:string){
 const messages:any={expired:'登入已到期，請重新登入',rate_limit:'嘗試過多，請 15 分鐘後再試',invalid_current:'目前密碼不正確',weak_password:kind==='president'?'總裁新密碼請使用至少 8 字、72 位元組以內':'主播新密碼請使用至少 4 字、72 位元組以內',same_password:'新密碼不能與目前密碼相同',same_as_president:'主播密碼不能與 PA Party總裁密碼相同',same_as_streamer:'總裁密碼不能與任一主播密碼相同',password_required:'請先設定主播密碼'};
 if(!result?.ok)throw Error(messages[result?.reason]||'密碼設定未完成，請重新登入後再試');
}

Deno.serve(async req=>{if(req.method==='OPTIONS')return new Response(null,{headers:cors});const respond=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});try{if(req.method!=='POST')return respond({error:'Method not allowed'},405);const b=await req.json();if(b.op==='releaseInfo')return respond({version:'10.13-WEB.2',messageCenterV2:true,scopedRealtimeV2:false,nativeApps:false});const credentialOperation=['deviceRefresh','deviceLogout','deviceSwitchSpace','deviceSpacePreferences'].includes(b.op),who=credentialOperation?null:await actor(b.token||'',['spaces','spaceResolve','spaceEntry'].includes(b.op)?null:b.streamer||'papa'),t=new Date().toISOString();
 if(b.op==='roomSyncHead')return respond(await roomSyncHead(b,who));
 if(b.op==='entryLegacyRooms'){
  const rooms=await api('/rest/v1/rpc/papa_streamer_directory_in_space',{chosen_space:'space-001'});
  return respond({rooms:rooms.map((room:any)=>({id:room.id,slug:room.slug,display_name:room.display_name}))});
 }
 if(b.op==='spaceEntry'){
  if(!who?.accountId)throw Error('請先重新登入');
  if(b.slug!=null&&(typeof b.slug!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(b.slug))
   ||b.hostname!=null&&(typeof b.hostname!=='string'||b.hostname.length>253||!/^[a-z0-9][a-z0-9.-]*$/.test(b.hostname)))
   throw Error('空間網址不正確');
  const entry=await api('/rest/v1/rpc/papa_account_space_entry',{
   subject:who.accountId,actor_role:isSuper(who)?'president':who.role,
   chosen_streamer:who.role==='streamer_admin'?who.streamer_id:typeof b.streamer==='string'&&b.streamer.length<=200?b.streamer:null,
   requested_slug:b.slug||null,requested_hostname:b.hostname||null,
   page_limit:Math.max(1,Math.min(100,Math.floor(Number(b.limit)||50))),
   page_offset:Math.max(0,Math.min(10000,Math.floor(Number(b.offset)||0)))});
  return respond({...entry,sessionIdentity:sessionIdentity(who)});
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
 if(['favoritesPage','favoriteSet','favoriteFlags','favoritesSetBatch'].includes(b.op)){
  if(b.token&&!who)throw Error('登入已到期，請重新登入');
  if(who?.role!=='player'||!who.playerId||!who.accountId)throw Error('請先登入玩家');
  const room=await catalogRoom(who,b.streamer||'papa');
  if((room.spaceId||'space-001')!=='space-001')throw Error('此 Space 的資料頁尚未開放');
  const context={role:'player',account_id:who.accountId,player_id:who.playerId,space_id:room.spaceId||'space-001',streamer_id:room.id};
  const common={requested_space:room.spaceId||'space-001',requested_room:room.id,actor_context:context};
  if(b.op==='favoritesSetBatch'){if(!Array.isArray(b.songIds)||!b.songIds.length||b.songIds.length>50||new Set(b.songIds).size!==b.songIds.length||b.songIds.some((id:any)=>typeof id!=='string'||!id||id.length>128)||typeof b.favorite!=='boolean')throw Error('收藏歌曲清單不正確');return respond(await api('/rest/v1/rpc/papa_song_favorites_set_batch',{...common,song_ids:b.songIds,requested_favorite:b.favorite}));}
  if(b.op==='favoriteSet'){
   if(typeof b.songId!=='string'||!b.songId||b.songId.length>128||typeof b.favorite!=='boolean')throw Error('收藏資料不正確');
   return respond(await api('/rest/v1/rpc/papa_song_favorite_set',{...common,requested_song:b.songId,requested_favorite:b.favorite}));
  }
  if(b.op==='favoriteFlags'){
   if(!Array.isArray(b.songIds)||b.songIds.length>50||new Set(b.songIds).size!==b.songIds.length||b.songIds.some((id:any)=>typeof id!=='string'||!id||id.length>128))throw Error('收藏歌曲清單不正確');
   return respond(await api('/rest/v1/rpc/papa_song_favorite_flags',{...common,song_ids:b.songIds}));
  }
  const page=b.page??0,limit=b.limit??20;
  if(!Number.isSafeInteger(page)||page<0||!Number.isSafeInteger(limit)||limit<1||limit>50||page*limit>10000000)throw Error('收藏分頁資料不正確');
  return respond(await api('/rest/v1/rpc/papa_song_favorites_page',{...common,page_limit:limit,page_offset:page*limit}));
 }
 if(b.op==='playerStreamerSummary'||b.op==='playerSongChoices'||b.op==='ownQueuePage'){
  if(who?.role!=='player'||!who.playerId||!who.accountId)throw Error('請先登入玩家');
  const room=await catalogRoom(who,b.streamer||'papa');if((room.spaceId||'space-001')!=='space-001')throw Error('此 Space 的資料頁尚未開放');
  const page=b.page??0,limit=b.limit??20;if(!Number.isSafeInteger(page)||page<0||!Number.isSafeInteger(limit)||limit<1||limit>50||page*limit>10000000)throw Error('分頁資料不正確');
  const context={role:'player',account_id:who.accountId,player_id:who.playerId,space_id:room.spaceId||'space-001',streamer_id:room.id};
  if(b.op==='playerStreamerSummary')return respond(await api('/rest/v1/rpc/papa_player_streamer_summary',{requested_space:room.spaceId||'space-001',actor_context:context,page_limit:limit,page_offset:page*limit}));
  if(b.op==='ownQueuePage'){if(limit>20||!['newest','oldest'].includes(b.sort??'newest'))throw Error('待播分頁資料不正確');return respond(await api('/rest/v1/rpc/papa_player_queue_page',{requested_space:room.spaceId||'space-001',actor_context:context,requested_sort:b.sort??'newest',page_limit:limit,page_offset:page*limit}));}
  const q=b.q??'',tags=b.tags??[];if(typeof q!=='string'||q.length>100||!Array.isArray(tags)||tags.length>20||tags.some((t:any)=>typeof t!=='string'||!t||t.length>50)||b.random!==undefined&&typeof b.random!=='boolean')throw Error('歌曲篩選不正確');
  return respond(await api('/rest/v1/rpc/papa_player_song_choices',{requested_space:room.spaceId||'space-001',requested_room:room.id,actor_context:context,query_text:q.trim(),tags,page_limit:b.random?1:Math.min(limit,20),page_offset:b.random?0:page*Math.min(limit,20),random_choice:b.random===true}));
 }
 if(b.op==='ownQueueQuote'){
  if(who?.role!=='player'||!who.playerId||!who.accountId)throw Error('請先登入玩家');
  validateOwnQueueBatch([{...b.choice,operation:'replace'}]);
  const room=await catalogRoom(who,b.streamer||'papa');if((room.spaceId||'space-001')!=='space-001')throw Error('此 Space 的資料頁尚未開放');
  const source=await load(true,room.id,room.spaceId||'space-001',null,who.playerId),scoped=scopeState(source,room.id),quote=ownQueueReplacementQuote(scoped,b.choice,coreActor(who),t);
  return respond({revision:source.revision,quote:{songId:quote.songId,title:quote.title,artist:quote.artist,kind:quote.kind,creditCost:quote.creditCost,price:quote.price,double:quote.double,items:quote.items}});
 }
 if(b.op==='ownQueueBatch'){
  if(who?.role!=='player'||!who.playerId||!who.accountId)throw Error('請先登入玩家');
  if(!Number.isSafeInteger(b.revision)||b.revision<0||!Array.isArray(b.jobs)||!b.jobs.length||b.jobs.length>10||new Set(b.jobs.map((j:any)=>j?.streamer)).size!==b.jobs.length||b.jobs.some((j:any)=>!j||typeof j.streamer!=='string'||!j.streamer||j.streamer.length>200)||b.jobs.reduce((n:number,j:any)=>n+(j.rows?.length||0),0)>50)throw Error('待播批次資料不正確');
  for(const job of b.jobs)validateOwnQueueBatch(job.rows);
  const results:any[]=[],resolvedRooms=new Set<string>();let checkedRevision=false;
  for(const job of b.jobs){let commitStarted=false;try{
   const room=await catalogRoom(who,job.streamer,true);if((room.spaceId||'space-001')!=='space-001'||(room.spaceId||'space-001')!==(who.spaceId||'space-001'))throw Error('主播不屬於目前空間');
   if(resolvedRooms.has(room.id))throw Error('同一批不能重複指定同一位主播');resolvedRooms.add(room.id);
   const source=await load(true,room.id,room.spaceId||'space-001',null,who.playerId);
   if(!checkedRevision){if(source.revision!==b.revision)throw revisionConflictError();checkedRevision=true;}
   const next=applyOwnQueueBatch(source,job.rows,coreActor(who),t,room.id);
   commitStarted=true;const committed=await commit(source,next,{role:'player',account_id:who.accountId,player_id:who.playerId,space_id:room.spaceId||'space-001',actor_streamer_id:null,streamer_id:room.id,roomScoped:true,action:'ownQueueBatch'});
   results.push({streamer:job.streamer,ok:true,count:job.rows.length,revision:committed.revision});
  }catch(error){const unknown=commitStarted&&error.rpcRejected!==true;results.push({streamer:job.streamer,ok:false,...(unknown?{unknown:true}:{}),error:unknown?'結果待確認，請先查看待播，避免重複送出':error.message||'操作失敗'});}}
  return respond({results});
 }
 if(b.op==='requestsBatch'){
  if(who?.role!=='player'||!who.playerId||!who.accountId)throw Error('請先登入玩家');
  if(!Number.isSafeInteger(b.revision)||b.revision<0||!Array.isArray(b.jobs)||!b.jobs.length||b.jobs.length>10||new Set(b.jobs.map((j:any)=>j?.streamer)).size!==b.jobs.length||b.jobs.some((j:any)=>!j||typeof j.streamer!=='string'||!j.streamer||j.streamer.length>200)||b.jobs.reduce((n:number,j:any)=>n+(j.rows?.length||0),0)>50)throw Error('批次點歌資料不正確');
  for(const job of b.jobs)validateRequestBatch(job.rows);
  const results:any[]=[],resolvedRooms=new Set<string>();let checkedRevision=false;
  for(const job of b.jobs){let commitStarted=false;try{
   const room=await catalogRoom(who,job.streamer);if((room.spaceId||'space-001')!==(who.spaceId||'space-001'))throw Error('主播不屬於目前空間');
   if(resolvedRooms.has(room.id))throw Error('同一批不能重複指定同一位主播');resolvedRooms.add(room.id);
   const source=await load(true,room.id,room.spaceId||'space-001',null,who.playerId);
   if(!checkedRevision){if(source.revision!==b.revision)throw revisionConflictError();checkedRevision=true;}
   const next=applyPlayerRequestBatch(source,job.rows,coreActor(who),t,room.id);
   commitStarted=true;const committed=await commit(source,next,{role:'player',account_id:who.accountId,player_id:who.playerId,space_id:room.spaceId||'space-001',actor_streamer_id:null,streamer_id:room.id,roomScoped:true,action:'requestBatch'});
   results.push({streamer:job.streamer,ok:true,count:job.rows.length,revision:committed.revision});
  }catch(error){const unknown=commitStarted&&error.rpcRejected!==true;results.push({streamer:job.streamer,ok:false,...(unknown?{unknown:true}:{}),error:unknown?'結果待確認，請先查看待播，避免重複送出':error.message||'點歌失敗'});}}
  return respond({results});
 }
 if(b.op==='listeningHistoryPage'){
  if(b.token&&!who)throw Error('登入已到期，請重新登入');
  if(!who?.accountId||who.role!=='player'&&!isManager(who))throw Error('請先登入');
  const management=isManager(who),room=await catalogRoom(who,b.streamer||'papa',management);
  if((room.spaceId||'space-001')!=='space-001')throw Error('此 Space 的資料頁尚未開放');
  const playerId=management?b.playerId:who.playerId,page=b.page??0,limit=b.limit??20;
  if(typeof playerId!=='string'||!playerId||playerId.length>128||!Number.isSafeInteger(page)||page<0||!Number.isSafeInteger(limit)||limit<1||limit>50||page*limit>10000000)throw Error('常聽歌單分頁資料不正確');
  const context={role:who.role,account_id:who.accountId,player_id:who.playerId||null,actor_streamer_id:who.streamer_id||null,space_id:room.spaceId||'space-001',streamer_id:room.id};
  return respond(await api('/rest/v1/rpc/papa_listening_history_page',{requested_space:room.spaceId||'space-001',requested_room:room.id,requested_player:playerId,actor_context:context,page_limit:limit,page_offset:page*limit}));
 }
 if(b.op==='newPracticePage'){
  const management=b.management===true;
  if(b.management!==undefined&&typeof b.management!=='boolean'||management&&!isManager(who))throw Error('請先登入管理');
  const room=await catalogRoom(who,b.streamer||'papa',management);
  if((room.spaceId||'space-001')!=='space-001')throw Error('此 Space 的資料頁尚未開放');
  const page=b.page??0,limit=b.limit??20;
  if(!Number.isSafeInteger(page)||page<0||!Number.isSafeInteger(limit)||limit<1||limit>50||page*limit>10000000)throw Error('新練歌曲分頁資料不正確');
  return respond(await api('/rest/v1/rpc/papa_new_practice_page',{requested_space:room.spaceId||'space-001',requested_room:room.id,management,page_limit:limit,page_offset:page*limit}));
 }
 if(b.op==='nativePlayerEligibility'){
  if(!isSuper(who)||!who?.accountId)throw Error('僅限 PA Party總裁');
  const space=b.spaceId,page=b.page??0,limit=b.limit??20,query=b.query??'';
  if(typeof space!=='string'||!space||space==='space-001'||space.length>200||!Number.isSafeInteger(page)||page<0||!Number.isSafeInteger(limit)||limit<1||limit>50||page*limit>10000000||typeof query!=='string'||query.length>100)throw Error('新空間玩家搜尋資料不正確');
  return respond(await api('/rest/v1/rpc/papa_native_player_eligibility_page',{requested_space:space,actor_context:{role:who.role,account_id:who.accountId,space_id:space,streamer_id:null},query_text:query.trim(),page_limit:limit,page_offset:page*limit}));
 }
 if(b.op==='nativePlayerProvision'){
  if(!isSuper(who)||!who?.accountId)throw Error('僅限 PA Party總裁');
  if(typeof b.streamer!=='string'||!b.streamer||b.streamer.length>200||typeof b.spaceId!=='string'||!b.spaceId||b.spaceId==='space-001'||!Number.isSafeInteger(b.revision)||b.revision<0||!Array.isArray(b.rows)||!b.rows.length||b.rows.length>100)throw Error('新空間玩家資料不正確');
  const fields=['accountId','membershipId','name','ids','names','certification','note'];
  if(b.rows.some((row:any)=>!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!fields.includes(key))||typeof row.name!=='string'||!row.name.trim()||row.name.length>200||['ids','names','certification','note'].some(key=>row[key]!==undefined&&(typeof row[key]!=='string'||row[key].length>1000))))throw Error('新空間玩家欄位不正確');
  const snapshot=await api('/rest/v1/rpc/papa_streamer_registry_snapshot',{requested_room:b.streamer,subject:who.accountId});
  const source=snapshotState(snapshot),space=snapshot.canonicalSpace?.id,room=snapshot.canonicalRoom;
  if(!space||space==='space-001'||space!==b.spaceId||!room)throw Error('玩家資料不屬於所選空間');
  if(source.revision!==b.revision)throw revisionConflictError();
  let next=source;const selections:any[]=[];
  for(const row of b.rows){
   next=mutate(next,{type:'player',streamer:room,data:{name:row.name,ids:row.ids||'',names:row.names||'',certification:row.certification||'',note:row.note||''}},coreActor(who),t);
   selections.push({playerId:next.players[next.players.length-1].playerId,accountId:row.accountId,membershipId:row.membershipId});
  }
  const bindings=buildNativePlayerBindings({spaceId:space,source:scopeState(source,room),changes:stateChanges(source,next,{preserveOrder:true}).changes,eligible:b.rows.map((row:any)=>({accountId:row.accountId,membershipId:row.membershipId,spaceId:space})),selections});
  next=await commit(source,next,{role:who.role,account_id:who.accountId,space_id:space,streamer_id:room,roomWriteScoped:true,action:'playerProvision',player_bindings:bindings});
  return respond({revision:next.revision,created:selections.map(row=>({playerId:row.playerId,name:next.players.find((p:any)=>p.playerId===row.playerId)?.name||''}))});
 }
 if(b.op==='playerArchive'||b.op==='playersArchive'){

  if(!isSuper(who)||!who?.accountId)throw Error('只有 PA Party總裁可以封存或恢復玩家');
  const room=await catalogRoom(who,b.streamer||'papa',true);
  if((room.spaceId||'space-001')!=='space-001')throw Error('此 Space 的資料頁尚未開放');
  if(b.op==='playersArchive'){if(!Array.isArray(b.playerIds)||!b.playerIds.length||b.playerIds.length>100||new Set(b.playerIds).size!==b.playerIds.length||b.playerIds.some((id:any)=>typeof id!=='string'||!id||id.length>128)||typeof b.archived!=='boolean'||!Number.isSafeInteger(b.revision)||b.revision<0)throw Error('批次封存資料不正確');return respond(await api('/rest/v1/rpc/papa_players_archive',{requested_space:room.spaceId||'space-001',requested_players:b.playerIds,expected_revision:b.revision,actor_context:{role:'super_admin',account_id:who.accountId,space_id:room.spaceId||'space-001',streamer_id:null,action:b.archived?'playersArchive':'playersRestore'},requested_archived:b.archived}));}
  if(typeof b.playerId!=='string'||!b.playerId||b.playerId.length>128||typeof b.archived!=='boolean'||!Number.isSafeInteger(b.revision)||b.revision<0)throw Error('玩家封存資料不正確');
  const context={role:'super_admin',account_id:who.accountId,space_id:room.spaceId||'space-001',streamer_id:null,action:b.archived?'playerArchive':'playerRestore'};
  return respond(await api('/rest/v1/rpc/papa_player_archive',{requested_space:room.spaceId||'space-001',requested_player:b.playerId,expected_revision:b.revision,actor_context:context,requested_archived:b.archived}));
 }
 if(b.op==='playerManagementPage'){
  if(b.archived!==undefined&&typeof b.archived!=='boolean'||b.archived===true&&!isSuper(who))throw Error('只有 PA Party總裁可以查看已封存玩家');
  if(!isManager(who))throw Error('請先登入管理');
  const room=await catalogRoom(who,b.streamer||'papa',true);
  if((room.spaceId||'space-001')!=='space-001')throw Error('此 Space 的資料頁尚未開放');
  const page=b.page??0,limit=b.limit??20,query=b.query??'';
  if(!Number.isSafeInteger(page)||page<0||!Number.isSafeInteger(limit)||limit<1||limit>50||page*limit>10000000||typeof query!=='string'||query.length>100||!['stored','all'].includes(b.mode))throw Error('玩家搜尋或分頁資料不正確');
  return respond(await api('/rest/v1/rpc/papa_player_management_page_v3',{requested_space:room.spaceId||'space-001',requested_room:room.id,list_mode:b.mode,query_text:query.trim(),page_limit:limit,page_offset:page*limit,archived_filter:b.archived===true,sort_order:checkedListSort(b.sort)}));
 }
 if(b.op==='events'){if(!isManager(who))throw new Error('請先登入管理');const room=await catalogRoom(who,b.streamer||'papa',true),page=Math.max(0,Math.min(200,Math.floor(Number(b.page)||0)));return respond(await api('/rest/v1/rpc/papa_event_page_v2',{room_id:room.id,page_number:page,include_global:isSuper(who),module_filter:null,page_limit:50,page_offset:page*50}));}
 if(b.op==='pushWorker'){const [config]=await api('/rest/v1/papa_notice_config?id=eq.worker');if(!b.secret||await hash(b.secret)!==await hash(config?.value?.secret||''))throw Error('驗證失敗');await deliverPush();return respond({ok:true});}
 if(CATALOG_OPS.has(b.op))return respond(await catalogOperation(b,who));
 if(['boardRooms','boardDirectory','boardBlocks','boardUnblock','boardBlock','boardList','boardCreate','boardChange'].includes(b.op))return respond(await boardOperation(b,who,await loadCommunicationState(isSuper(who)?null:who?.spaceId||'space-001',b.streamer||'papa')));
 if(['messageCenter','messageCenterCounts','messageCenterRead','messageCenterPreferences','noticeSound','notifications','noticeTest','noticeRead','noticePreferences','noticeTarget','pushKey','pushSubscribe','pushUnsubscribe','chatInbox','chatMessages','chatSend','chatRead'].includes(b.op)){
  const comm=await loadCommunicationState(isSuper(who)?null:who?.spaceId||'space-001',b.streamer||'papa');
  if(who?.role==='streamer_admin')requireRoom(who,scopeState(comm,b.streamer||'papa').currentStreamer.id);
  if(['chatInbox','chatMessages','chatSend','chatRead'].includes(b.op))return respond(await chatOperation(b,who,comm));
  return respond(await notificationOperation(b,who,comm));
 }
 // Most 30-second reads are unchanged. Check the tiny revision row first and
 // retain a periodic forced read on the client for time-dependent displays.
 if(b.op==='read'&&b.token&&!who)throw Error('登入已到期，請重新登入');
 if(b.op==='read'&&(b.accountingDay===undefined||b.accountingDay===accountingDay(t,Number.isInteger(b.accountingRolloverHour)&&b.accountingRolloverHour>=0&&b.accountingRolloverHour<24?b.accountingRolloverHour:19))&&Number.isInteger(b.revision)&&b.revision>=0&&b.signatures&&typeof b.signatures==='object'&&!Array.isArray(b.signatures)&&Object.keys(b.signatures).length){
  const [row]=await api('/rest/v1/papa_v2_revision?id=eq.1&select=revision&limit=1');
  if(row&&Number(row.revision)===b.revision){
   const comm=await loadCommunicationState(isSuper(who)?null:who?.spaceId||'space-001',b.streamer||'papa').catch(()=>null);
   if(comm){const room=scopeState(comm,b.streamer||'papa').currentStreamer;requireRoom(who,room.id);if(!room.active&&!isManager(who))throw Error('主播頁暫未開放');return respond({state:{},now:t,ready:true});}
  }
 }
 if(b.op==='accountingSummary'){
  const room=await managerRoom(who,b.streamer||'papa');
  if(typeof b.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.day))throw Error('帳務日期不正確');
  return respond({summary:await accountingSummary(room,b.day)});
 }
 if(b.op==='mutate'&&!who)throw Error('請先登入');
 if(b.op==='mutate'&&who?.role==='player'&&!['request','wish','self','cancelOwn','replaceOwn'].includes(b.action?.type))throw Error('請先登入管理');
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
 const actionPlayer=b.op==='mutate'&&(b.action?.data?.player_id??b.action?.data?.playerId);
 const quotaPlayer=who?.role==='player'?who.playerId:isManager(who)?typeof actionPlayer==='string'?actionPlayer:typeof b.profilePlayerId==='string'?b.profilePlayerId:null:null;
 const s=await load(['read','failedRequest','search','login'].includes(b.op)||roomScoped||draftOperation,draftScope?.id||b.streamer||'papa',draftScope?.spaceId||who?.spaceId||'space-001',roomWriteScoped&&!draftOperation?selectedWriteSongs:null,quotaPlayer);
 if(b.op==='draftStart')return respond({draft:{state:s,journal:createRoomDraft(s,draftScope.id),baseRevision:s.revision},now:t});
 if(b.op==='failedRequest'){if(who?.role!=='player')throw new Error('請先登入玩家');const room=scopeState(s,b.streamer||'papa'),p=room.players.find((p:any)=>p.playerId===who.playerId);if(!room.currentStreamer.active||!p)throw new Error('找不到玩家');if(p.archived)return respond({counted:false});const quote=quoteSong(room,b.songId,b,who.playerId,t),full=!canRequestSaved(room,t,quote.creditCost,who.playerId);if(!full)return respond({counted:false});try{venuePolicySavedSnapshot(room,who.playerId,quote.creditCost);}catch{return respond({counted:false});}const counted=await api('/rest/v1/rpc/papa_record_failed_request',{room_id:room.currentStreamer.id,player_id:who.playerId,song_id:b.songId,bucket:hourKey(t)});schedulePush(room.currentStreamer.id,['__admin__',who.playerId]);return respond({counted});}if(b.op==='login'){if(who?.playerId)throw new Error('請先登出再登入');const p=s.players.find((p:any)=>p.playerId===b.playerId);if(!p||String(p.password||'')!==String(b.password||''))throw new Error('玩家密碼不正確');const token='player:'+crypto.randomUUID()+crypto.randomUUID(),sessionHash=await hash(token);await api('/rest/v1/papa_v2_sessions',{token_hash:sessionHash,player_id:p.playerId,login_id:p.ids.includes(b.loginId)?b.loginId:'',expires_at:new Date(Date.now()+30*86400000).toISOString()});const identity=await api('/rest/v1/rpc/papa_bind_verified_legacy_session',{session_hash:sessionHash});if(identity?.role!=='player'||identity?.spaceId!=='space-001')throw new Error('玩家登入身分尚未完成設定');return respond({token});}
 if(b.op==='search'){return respond({players:b.query?.trim()?playerSearch(s,b.query,true).slice(0,20).map((p:any)=>({playerId:p.playerId,name:p.name,ids:p.ids,hasPassword:!!p.password})):[]});}
 const project=async(value:any)=>{try{const base=leanSongView(managementView(publicView(value,coreActor(who),t,b.streamer||'papa'),who)),rows=await api('/rest/v1/rpc/papa_catalog_song_metadata_in_space',{room_id:base.currentStreamer.id}),view={...catalogMetadataView(base,rows,isManager(who)),summary:await accountingSummary(base.currentStreamer,null)},signatures:any={},delta:any={};for(const [key,v] of Object.entries(view)){signatures[key]=await hash(JSON.stringify(v));if(b.signatures?.[key]!==signatures[key])delta[key]=v;}return {state:delta,signatures,now:t,ready:value.schemaVersion>=3,...(who?.accountId?{sessionIdentity:sessionIdentity(who)}:{})};}catch(error){throw unknownOperationOutcome(error);}};
 if(b.op==='mutate'&&b.action?.type==='extraQuota'){
  if(!isManager(who))throw Error('請先登入管理');
  if(b.revision!==s.revision)throw revisionConflictError();
  const room=scopeState(s,b.streamer||'papa').currentStreamer;requireRoom(who,room.id);
  const next=mutate(s,{...b.action,streamer:room.id},coreActor(who),t),p=b.action.data;
  const quotaProof=who.accountId?{actor_context:{role:who.role,account_id:who.accountId,
   space_id:room.spaceId||who.spaceId||'space-001',streamer_id:room.id,actor_streamer_id:who.role==='streamer_admin'?who.streamer_id:null}}
   :(room.spaceId||'space-001')==='space-001'?{session_hash:await hash(b.token)}:null;
  if(!quotaProof)throw Error('請先登入管理');
  next.revision=await api('/rest/v1/rpc/papa_manage_player_extra_quota',{expected:s.revision,requested_room:room.id,target_player:p.player_id,
   requested_extra:Number(p.extra_quota),requested_enabled:p.enabled,...quotaProof});
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
 if(b.revision!==s.revision)throw revisionConflictError();
 let next;
 if(b.op==='import')next=applyRoomImport(s,b.kind,b.text,b.choices,coreActor(who),t,b.streamer||'papa');
 else if(b.op==='publish'){
  if(b.baseRevision!==s.revision)throw new Error('正式資料已有更新，請先下載草稿備份再重新建立');
  const rows=b.journal.actions.some((entry:any)=>entry.kind==='mutate'&&entry.action?.type==='song'&&entry.action.data?.songId&&!entry.action.data.remove)?await api('/rest/v1/rpc/papa_catalog_song_metadata_in_space',{room_id:draftScope.id}):[];
  next=replayRoomDraft(s,b.journal,coreActor(who),t,(action:any,current:any,room:string)=>catalogPreserveSource(prepareManagerAction(who,action,current),current,room,rows));
  next.extraQuotas=s.extraQuotas;next.extraQuotaRights=s.extraQuotaRights;
  if(!b.journal.actions.length)return respond(await project(s));
 }else {let action=prepareManagerAction(who,b.action,s);const actionSpace=scopeState(s,b.streamer||'papa').currentStreamer.spaceId||who?.spaceId||'space-001';if(actionSpace!=='space-001'&&['player','self'].includes(action?.type)&&['password','token','refreshToken','accessToken'].some(key=>Object.hasOwn(b.action?.data||{},key)))throw Error('登入資料由帳號管理，不能寫入玩家資料');if(isManager(who)&&action?.type==='song'&&action.data?.songId&&!action.data.remove){const room=scopeState(s,b.streamer||'papa').currentStreamer.id;action=catalogPreserveSource(action,s,room,await api('/rest/v1/rpc/papa_catalog_song_metadata_in_space',{room_id:room}));}next=mutate(s,{...action,streamer:b.streamer||'papa'},coreActor(who),t);}
 const targetSpace=scopeState(s,b.streamer||'papa').currentStreamer.spaceId||who?.spaceId||'space-001';
 if(b.playerBindings!==undefined&&(targetSpace==='space-001'||!Array.isArray(b.playerBindings)||!roomWriteScoped))throw Error('玩家帳號綁定格式不正確');
 return respond(await project(await commit(s,next,{role:who?.role||'unknown',player_id:who?.playerId||null,
  account_id:who?.accountId||null,space_id:targetSpace,player_bindings:b.playerBindings||[],
  actor_streamer_id:who?.role==='streamer_admin'?who.streamer_id:null,
  streamer_id:scopeState(s,b.streamer||'papa').currentStreamer.id,
  roomScoped,roomWriteScoped,action:b.op==='mutate'?b.action?.type+(b.action?.data?.operation?':'+b.action.data.operation:''):b.op})));
 }catch(e){return respond(operationErrorResponse(e),400);}});

function checkedListSort(value:any){if(value===undefined)return 'default';if(!['default','newest','oldest'].includes(value))throw Error('排序不正確');return value;}
