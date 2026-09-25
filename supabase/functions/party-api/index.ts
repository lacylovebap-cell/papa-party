import {isSuper,isManager,coreActor,requireRoom,authorizeManagerOperation,managementView,noticeIdentity,validNoticeAudio} from '../../../src/access-policy.js';
// No browser access to tables or VAPID secrets. All recipient keys come from actor().
import webpush from 'npm:web-push@3.6.7';
import {cleanNoticePrefs,noticeChannels,validPushSubscription} from '../../../src/notification-rules.js';

async function noticeKeys(){
 let rows=await api('/rest/v1/papa_notice_config?id=eq.vapid');
 if(!rows.length){const key=webpush.generateVAPIDKeys();const r=await fetch(URL+'/rest/v1/papa_notice_config',{method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({id:'vapid',value:key})});if(!r.ok)throw Error('推播設定暫時無法建立');rows=await api('/rest/v1/papa_notice_config?id=eq.vapid');}
 return rows[0].value;
}
async function notificationOperation(b:any,who:any,s:any){
 if(!who)throw Error('請先登入');
 const sourceRoom=scopeState(s,b.streamer||'papa').currentStreamer.id,{room,recipient}=noticeIdentity(who,sourceRoom);
 if(!recipient)throw Error('請先登入');
 const filter='streamer_id=eq.'+encodeURIComponent(room)+'&recipient=eq.'+encodeURIComponent(recipient),noticeFilter=(room==='__global__'?'':('streamer_id=eq.'+encodeURIComponent(room)+'&'))+'recipient=eq.'+encodeURIComponent(recipient);
 if(b.op==='notifications'){const inbox=await api('/rest/v1/rpc/papa_notice_inbox',{room,owner_id:recipient,page_number:Math.max(0,Math.min(100000,Math.floor(Number(b.page)||0)))});const [audio]=await api('/rest/v1/papa_notice_config?id=eq.player_sound');return {...inbox,playerSound:audio?.value?.data||null};}
 if(b.op==='noticeSound'){if(!isSuper(who))throw Error('只有總管理可設定玩家音效');if(b.data!==null&&!validNoticeAudio(b.data))throw Error('請選擇 256 KB 以下的支援音效');const r=await fetch(URL+'/rest/v1/papa_notice_config?on_conflict=id',{method:'POST',headers:{...headers,Prefer:'resolution=merge-duplicates'},body:JSON.stringify({id:'player_sound',value:{data:b.data}})});if(!r.ok)throw Error('音效儲存失敗');return {ok:true};}
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
  if(!validPushSubscription(b.subscription))throw Error('推播訂閱格式不正確或此瀏覽器尚不支援');
  const endpoint=b.subscription.endpoint;
  if(!/^(player|admin|streamer):/.test(b.token)){
   const claims=JSON.parse(atob(b.token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
   const expires=new Date(Math.min(Number(claims.exp)*1000,Date.now()+43200000));
   if(!Number.isFinite(expires.getTime()))throw Error('請重新登入管理');
   await fetch(URL+'/rest/v1/papa_v2_sessions?on_conflict=token_hash',{method:'POST',headers:{...headers,Prefer:'resolution=merge-duplicates'},body:JSON.stringify({token_hash:await hash(b.token),player_id:'__admin__',login_id:'',expires_at:expires.toISOString()})});
  }
  const r=await fetch(URL+'/rest/v1/papa_push_subscriptions?on_conflict=streamer_id,endpoint',{method:'POST',headers:{...headers,Prefer:'resolution=merge-duplicates'},body:JSON.stringify({streamer_id:room,recipient,endpoint,subscription:{endpoint,keys:b.subscription.keys},session_hash:await hash(b.token)})});
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
 await Promise.allSettled(jobs.map(async(job:any)=>{
  const jobFilter='id=eq.'+job.id+'&lease=eq.'+job.lease;
  try{
   const [n]=await api('/rest/v1/papa_notifications?id=eq.'+job.notice_id),[sub]=await api('/rest/v1/papa_push_subscriptions?id=eq.'+job.subscription_id);
   if(!n||!sub){await api('/rest/v1/papa_push_jobs?'+jobFilter,{status:'skipped'},'PATCH');return;}
   const preferenceRoom=n.recipient==='__super__'?'__global__':n.streamer_id;const [prefs]=await api('/rest/v1/papa_notice_preferences?streamer_id=eq.'+encodeURIComponent(preferenceRoom)+'&recipient=eq.'+encodeURIComponent(n.recipient));
   const sessions=await api('/rest/v1/papa_v2_sessions?token_hash=eq.'+sub.session_hash+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString()));
   const sess=sessions[0];const sessionAllowed=sess&&(sub.recipient==='__super__'?sess.player_id==='__admin__'&&(!sess.role||sess.role==='super_admin'):sub.recipient==='__admin__'?sess.role==='streamer_admin'&&sess.streamer_id===n.streamer_id:sess.player_id===sub.recipient&&(!sess.role||sess.role==='player'));if(!sessionAllowed||n.recipient!==sub.recipient||sub.streamer_id!==preferenceRoom||n.read_at||!noticeChannels(prefs?.preferences,n.type).push){await api('/rest/v1/papa_push_jobs?'+jobFilter,{status:'skipped'},'PATCH');return;}
   const meta=await api('/rest/v1/papa_v2_entities?kind=eq.meta&id=eq.1&select=data'),slug=meta[0]?.data?.streamers?.find((r:any)=>r.id===n.streamer_id)?.slug||'papa';
   const payload=JSON.stringify({id:n.id,title:'PA • PARTY · '+n.streamer_name,body:n.body,url:'./?streamer='+encodeURIComponent(slug)+'#'+(['__admin__','__super__'].includes(n.recipient)?'admin':'center'),recipient:n.recipient});
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
 if(messages.length)await fetch(URL+'/realtime/v1/api/broadcast',{method:'POST',headers,body:JSON.stringify({messages})});
}
function schedulePush(room?:string,recipients:string[]=[]){EdgeRuntime.waitUntil(Promise.allSettled([room?signalNotices(room,recipients):Promise.resolve(),deliverPush()]));}

import {deriveNotices} from '../../../src/notification-rules.js';
// Authentication is checked here for every operation; no browser service key.
import {empty,TABLES,mutate,publicView,migrateLegacy,previewImport,applyImport,playerSearch,upgradePlatform,scopeState,searchAcrossStreamers,balance,reservedCredits,usedHour,reservedHour,quoteSong,hourKey} from '../../../src/core.js';
const URL=Deno.env.get('SUPABASE_URL')!,KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,ADMIN=Deno.env.get('PAPA_ADMIN_USER_ID');
const headers={apikey:KEY,Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'};
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,authorization,apikey','Access-Control-Allow-Methods':'POST, OPTIONS'};
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
async function api(path:string,body?:unknown,method?:string){const r=await fetch(URL+path,{method:method||(body?'POST':'GET'),headers,body:body?JSON.stringify(body):undefined});const text=await r.text();if(!r.ok)throw new Error(text.includes('VERSION_CONFLICT')?'資料剛更新了，請重新整理後再試一次':'資料庫操作失敗');return text?JSON.parse(text):null;}
async function load(){const snap=await api('/rest/v1/rpc/papa_v2_snapshot',{}),s=empty();s.revision=snap.revision;for(const r of snap.rows){if(r.kind==='settings')s.settings=r.data;else if(r.kind==='meta')Object.assign(s,r.data);else if(TABLES.includes(r.kind))s[r.kind].push(r.data);}for(const k of TABLES)s[k].sort((a:any,b:any)=>(a._order||0)-(b._order||0));return upgradePlatform(s);}
function entries(s:any){return [...TABLES.flatMap(k=>s[k].map((data:any,index:number)=>({kind:k,id:String(data.playerId&&k==='players'?data.playerId:data.songId&&k==='songs'?data.songId:data.id),data:{...data,_order:index}}))),{kind:'settings',id:'1',data:s.settings},{kind:'meta',id:'1',data:{schemaVersion:3,streamers:s.streamers,streamerSettings:s.streamerSettings,migrationIssues:s.migrationIssues||[]}}];}
async function commit(before:any,after:any,context:any={}){const old=new Map(entries(before).map(r=>[r.kind+':'+r.id,r])),next=entries(after),keys=new Set(next.map(r=>r.kind+':'+r.id));const changes=next.filter(r=>JSON.stringify(old.get(r.kind+':'+r.id)?.data)!==JSON.stringify(r.data)),removed=[...old.values()].filter(r=>!keys.has(r.kind+':'+r.id)).map(r=>({kind:r.kind,id:r.id}));const notices=deriveNotices(before,after,context);after.revision=await api('/rest/v1/rpc/papa_release_b_commit',{expected:before.revision,changes,removed,actor_context:context,notices});schedulePush(context.streamer_id,[...new Set(notices.map((n:any)=>n.recipient))]);return after;}
async function actor(token:string){if(!token)return null;if(/^(player|admin|streamer):/.test(token)){const rows=await api('/rest/v1/papa_v2_sessions?token_hash=eq.'+await hash(token)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())),r=rows[0];if(!r)return null;if(token.startsWith('admin:')&&r.player_id==='__admin__')return {role:'super_admin'};if(token.startsWith('streamer:')&&r.role==='streamer_admin'){const a=await api('/rest/v1/papa_streamer_accounts?streamer_id=eq.'+encodeURIComponent(r.streamer_id)+'&enabled=eq.true');return a.length?{role:'streamer_admin',streamer_id:r.streamer_id}:null;}return token.startsWith('player:')?{role:'player',playerId:r.player_id,loginId:r.login_id}:null;}const r=await fetch(URL+'/auth/v1/user',{headers:{apikey:KEY,Authorization:'Bearer '+token}});if(!r.ok)return null;const u=await r.json();return ADMIN&&u.id===ADMIN?{role:'super_admin'}:null;}

Deno.serve(async req=>{if(req.method==='OPTIONS')return new Response(null,{headers:cors});const respond=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});try{if(req.method!=='POST')return respond({error:'Method not allowed'},405);const b=await req.json(),who=await actor(b.token||''),t=new Date().toISOString();
 if(b.op==='streamerLogin'){const snapshot=await load(),r=scopeState(snapshot,b.streamer).currentStreamer;if(!await api('/rest/v1/rpc/papa_check_streamer_login',{room:r.id,password:String(b.password||'')}))throw Error('主播密碼不正確、尚未啟用或嘗試過多，請稍後再試');const token='streamer:'+crypto.randomUUID()+crypto.randomUUID();await api('/rest/v1/papa_v2_sessions',{token_hash:await hash(token),player_id:'__streamer__:'+r.id,login_id:'',role:'streamer_admin',streamer_id:r.id,expires_at:new Date(Date.now()+43200000).toISOString()});return respond({token,role:'streamer_admin',streamerId:r.id,streamerSlug:r.slug,expiresIn:43200,legacy:true});}
 if(b.op==='streamerAccounts'){if(!isSuper(who))throw Error('僅限總管理');return respond({accounts:await api('/rest/v1/papa_streamer_accounts?select=streamer_id,enabled,updated_at')});}
 if(b.op==='setStreamerAccount'){if(!isSuper(who))throw Error('僅限總管理');const snapshot=await load(),room=scopeState(snapshot,b.streamer).currentStreamer.id;await api('/rest/v1/rpc/papa_set_streamer_login',{room,password:b.password||null,active:b.enabled===true});return respond({ok:true});}
 if(b.op==='adminLogin'){if(!ADMIN){const old=await api('/rest/v1/party_state?id=eq.1&select=data'),password=old[0]?.data?.settings?.adminPassword;if(!password||!b.password||await hash(String(password))!==await hash(String(b.password)))throw new Error('管理密碼不正確');const token='admin:'+crypto.randomUUID()+crypto.randomUUID();await api('/rest/v1/papa_v2_sessions',{token_hash:await hash(token),player_id:'__admin__',login_id:'',expires_at:new Date(Date.now()+43200000).toISOString()});return respond({token,role:'super_admin',expiresIn:43200,legacy:true});}const r=await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers,body:JSON.stringify({email:b.email,password:b.password})}),v=await r.json();if(!r.ok||v.user?.id!==ADMIN)throw new Error('管理登入資料不正確');return respond({token:v.access_token,role:'super_admin',refreshToken:v.refresh_token,expiresIn:v.expires_in});}
 if(b.op==='refreshAdmin'){const r=await fetch(URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers,body:JSON.stringify({refresh_token:b.refreshToken})}),v=await r.json();if(!r.ok||v.user?.id!==ADMIN)throw new Error('請重新登入管理');return respond({token:v.access_token,role:'super_admin',refreshToken:v.refresh_token,expiresIn:v.expires_in});}
 if(b.op==='upload'){if(!isManager(who))throw new Error('只有管理員能上傳');const uploadRoom=scopeState(await load(),b.streamer||'papa').currentStreamer.id;requireRoom(who,uploadRoom);const binary=Uint8Array.from(atob(b.image),c=>c.charCodeAt(0));if(binary.length>3145728||b.mime!=='image/webp')throw new Error('請使用壓縮後圖片');const path=crypto.randomUUID()+'.webp',r=await fetch(URL+'/storage/v1/object/papa-photos/'+path,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'image/webp'},body:binary});if(!r.ok)throw new Error('圖片上傳失敗');return respond({url:URL+'/storage/v1/object/public/papa-photos/'+path});}
 if(b.op==='events'){if(!isManager(who))throw new Error('請先登入管理');const snapshot=await load(),room=scopeState(snapshot,b.streamer||'papa').currentStreamer.id,page=Math.max(0,Math.min(100000,Math.floor(Number(b.page)||0)));requireRoom(who,room);const rows=await api('/rest/v1/papa_events?streamer_id=eq.'+encodeURIComponent(room)+(isSuper(who)?'':'&entity_kind=not.in.(players,meta)')+'&order=created_at.desc,id.desc&limit=51&offset='+page*50);return respond({rows:rows.slice(0,50),hasMore:rows.length>50});}
 if(b.op==='pushWorker'){const [config]=await api('/rest/v1/papa_notice_config?id=eq.worker');if(!b.secret||await hash(b.secret)!==await hash(config?.value?.secret||''))throw Error('驗證失敗');await deliverPush();return respond({ok:true});}
 const s=await load();if(who?.role==='streamer_admin')requireRoom(who,scopeState(s,b.streamer||'papa').currentStreamer.id);if(['noticeSound','notifications','noticeTest','noticeRead','noticePreferences','pushKey','pushSubscribe','pushUnsubscribe'].includes(b.op))return respond(await notificationOperation(b,who,s));if(b.op==='failedRequest'){if(who?.role!=='player')throw new Error('請先登入玩家');const room=scopeState(s,b.streamer||'papa'),p=room.players.find((p:any)=>p.playerId===who.playerId);if(!room.currentStreamer.active||!p)throw new Error('找不到玩家');const quote=quoteSong(room,b.songId,b,who.playerId,t),available=balance(room,who.playerId)-reservedCredits(room,who.playerId),full=usedHour(room,t)+reservedHour(room,t)>=room.settings.hourlyLimit;if(available<quote.creditCost||!full)return respond({counted:false});const counted=await api('/rest/v1/rpc/papa_record_failed_request',{room_id:room.currentStreamer.id,player_id:who.playerId,song_id:b.songId,bucket:hourKey(t)});schedulePush(room.currentStreamer.id,['__admin__',who.playerId]);return respond({counted});}if(b.op==='login'){if(who?.playerId)throw new Error('請先登出再登入');const p=s.players.find((p:any)=>p.playerId===b.playerId);if(!p||String(p.password||'')!==String(b.password||''))throw new Error('玩家密碼不正確');const token='player:'+crypto.randomUUID()+crypto.randomUUID();await api('/rest/v1/papa_v2_sessions',{token_hash:await hash(token),player_id:p.playerId,login_id:p.ids.includes(b.loginId)?b.loginId:'',expires_at:new Date(Date.now()+30*86400000).toISOString()});return respond({token});}
 if(b.op==='logout'){if(who)await api('/rest/v1/papa_push_subscriptions?session_hash=eq.'+await hash(b.token),undefined,'DELETE');if(/^(player|admin|streamer):/.test(b.token||''))await api('/rest/v1/papa_v2_sessions?token_hash=eq.'+await hash(b.token),undefined,'DELETE');return respond({ok:true});}
 if(b.op==='songSearch'){return respond({songs:searchAcrossStreamers(s,b.query||'').slice(0,100)});}if(b.op==='search'){return respond({players:b.query?.trim()?playerSearch(s,b.query).slice(0,20).map((p:any)=>({playerId:p.playerId,name:p.name,ids:p.ids,hasPassword:!!p.password})):[]});}
 if(b.op==='backup'){if(!isSuper(who))throw new Error('僅限總管理備份');return respond({backup:s,now:t});}const project=async(value:any)=>{const view=managementView(publicView(value,coreActor(who),t,b.streamer||'papa'),who),signatures:any={},delta:any={};for(const [key,v] of Object.entries(view)){signatures[key]=await hash(JSON.stringify(v));if(b.signatures?.[key]!==signatures[key])delta[key]=v;}return {state:delta,signatures,now:t,ready:value.schemaVersion>=3};};
 if(b.op==='read'){if(b.token&&!who)throw new Error('登入已到期，請重新登入');return respond(await project(s));}
 if(!isManager(who)&&(b.op!=='mutate'||!['request','wish','self','cancelOwn'].includes(b.action?.type)))throw new Error('請先登入管理');
 if(isManager(who))authorizeManagerOperation(who,b,scopeState(s,b.streamer||'papa').currentStreamer.id);
 if(b.op==='migrate'){if(s.songs.length)throw new Error('已有 V2 資料，不能重複移轉');const rows=await api('/rest/v1/party_state?id=eq.1&select=data'),old=rows[0]?.data;if(!old)throw new Error('找不到 V1 資料');const migrated=migrateLegacy(old);if(!b.confirm)return respond({issues:migrated.migrationIssues,counts:Object.fromEntries(TABLES.map(k=>[k,migrated[k].length])),backup:old});return respond({state:publicView(await commit(s,upgradePlatform(migrated)),who,t,b.streamer||'papa'),now:t});}
 if(b.revision!==s.revision)throw new Error('資料剛更新了，請重新整理後再試一次');
 let next;if(b.op==='import'){const rows=previewImport(scopeState(s,b.streamer||'papa'),b.kind,b.text);next=applyImport(s,b.kind,rows,b.choices,coreActor(who),t,b.streamer||'papa');}else if(b.op==='publish'){if(b.baseRevision!==s.revision)throw new Error('正式資料已有更新，請重新建立草稿');if(b.state?.schemaVersion!==3)throw new Error('草稿格式錯誤');if(!b.state.streamerSettings)throw new Error('請先取得完整平台草稿');next=b.state;}else next=mutate(s,{...b.action,streamer:b.streamer||'papa'},coreActor(who),t);
 return respond(await project(await commit(s,next,{role:who?.role||'unknown',player_id:who?.playerId||null,streamer_id:scopeState(s,b.streamer||'papa').currentStreamer.id,action:b.op==='mutate'?b.action?.type+(b.action?.data?.operation?':'+b.action.data.operation:''):b.op})));
 }catch(e){return respond({error:e.message||'操作失敗'},400);}});
