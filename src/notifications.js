import {createNoticeDelta} from './notification-delta.js?v=10.31-NOTICE.1';
import {createNotificationDevicePreferences} from './notification-device-preferences.js?v=10.25-NOTICE.1';
import {messageCenterHtml,messageCenterSettingsHtml} from './message-center-view.js?v=10.19-WEB.1';
import {createMessageCenter,MESSAGE_CATEGORIES} from './message-center.js?v=10.19-WEB.1';
import {canReplaceSound,isSuper} from './access-policy.js?v=10.28-CANCEL.1';
import {communicationIdentity} from './communication-context.js?v=10.19-WEB.1';
import {NOTICE_TYPES,cleanNoticePrefs,noticeChannels,deriveNotices} from './notification-rules.js?v=10.31-CALL.1';
import {createWebNotificationHealth} from './web-notification-health.js?v=10.19-WEB.1';
export function createNotifications({api,context,toast,onUpdate,onNavigate,onOpenCategory,apiUrl,apiKey,messageCenterV2=false,companion=()=>null,companionApi=null}){
 let deviceStorage;try{deviceStorage=globalThis.localStorage;}catch{}
 const devicePrefs=createNotificationDevicePreferences(deviceStorage);
 const delta=createNoticeDelta();let deltaBacklog=false;
 let automaticActivationKey='',pushSettingDirty=false,companionBound='',companionBinding='';let bindingFailures=0,bindingRetryAt=0;
 const bindingFailed=()=>{bindingFailures++;bindingRetryAt=Date.now()+Math.min(300000,5000*2**Math.min(bindingFailures-1,6));};
 const bindingRecovered=()=>{bindingFailures=0;bindingRetryAt=0;};
 const permission=()=>globalThis.Notification?.permission||'unsupported';
 const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let key='',contextKey='',rows=[],prefs=cleanNoticePrefs(),counts={},page=0,more=false,topic='',socket,heartbeat,reconnect,lastRealtimeAt=0,loading=false,refreshPending=false,view='',generation=0,dialogRevision=0,seen=new Set(),primed=false,mutedAudio,playerSoundVersion='',boundDevice='',bindingDevice='',pushActivation=null,pushDeactivation=null,pushPermissionPending=null,pushActionRevision=0,pushWriteTail=Promise.resolve();
 const dialog=document.createElement('dialog');dialog.id='notification-dialog';dialog.className='notice-dialog';document.body.append(dialog);
 const health=createWebNotificationHealth({registrationUrl:new URL('../',import.meta.url),onChange:renderHealth});
 const sound=new Audio(new URL('../assets/notification.m4a',import.meta.url));sound.preload='none';let unlocked=false;
 const storageKey=k=>'pa-notice-'+key+'-'+k;
 const read=(k,fallback)=>{try{return JSON.parse(localStorage.getItem(storageKey(k)))??fallback;}catch{return fallback;}};
 const write=(k,v)=>{try{localStorage.setItem(storageKey(k),JSON.stringify(v));}catch{throw Error('裝置儲存空間不足，請使用較小音效');}};
 const pushDisableKey=c=>'push-disabled:'+String(c.deviceSessionId||'legacy');
 const pushDisabled=c=>read(pushDisableKey(c),false)===true;
 function setPushDisabled(c,disabled){try{localStorage.setItem(storageKey(pushDisableKey(c)),JSON.stringify(disabled));}catch{throw Error('無法保存這台裝置的推播選擇，請確認瀏覽器儲存空間後重試');}}
 function stop(){clearInterval(heartbeat);clearTimeout(reconnect);if(socket){socket.onclose=null;socket.close();socket=null;}topic='';lastRealtimeAt=0;}
 const contextStamp=c=>JSON.stringify([c.spaceId||'space-001',c.streamer||'',c.recipient||'',c.role||'',c.deviceSessionId||'',Boolean(c.demo),...(messageCenterV2?[c.accountId,c.selectedStreamer,c.streamerId]:[])]);
 const centerEnabled=()=>messageCenterV2&&!context().demo;
 const centerContext=()=>({...context(),streamer:context().selectedStreamer||context().streamer,streamerName:context().selectedStreamerName||context().streamerName});
 const center=createMessageCenter({api,context:centerContext,canUseSpace:isSuper,identity:()=>{const c=centerContext();return JSON.stringify([c.accountId||c.deviceSessionId,c.role,c.recipient,c.spaceId||'space-001',c.streamer,c.streamerId,c.demo]);},onChange:()=>{updateButton();if(view==='inbox'&&dialog.open&&centerEnabled())renderCenterInbox();}});
 function identity(){const c=context(),next=c.recipient?communicationIdentity(c,`${c.demo?'demo:':''}${c.streamer}:${c.recipient}`):'',stamp=contextStamp(c);if(key===next&&contextKey===stamp)return c;key=next;contextKey=stamp;generation++;automaticActivationKey='';boundDevice='';bindingDevice='';bindingRecovered();pushSettingDirty=false;delta.reset();deltaBacklog=false;dialogRevision++;stop();rows=[];counts={};page=0;seen=new Set();primed=false;view='';dialog.close();prefs=cleanNoticePrefs();health.reset();sound.pause();playerSoundVersion='';sound.src=(key&&canReplaceSound(c)?read('sound',null):null)||new URL('../assets/notification.m4a',import.meta.url).href;return c;}
 function operationSnapshot(settings=false){const c=identity(),g=generation,stamp=contextStamp(c),revision=dialogRevision;const valid=()=>g===generation&&contextStamp(context())===stamp&&(!settings||(view==='settings'&&dialog.open&&dialogRevision===revision));return {c,g,valid,assert(){if(!valid())throw Object.assign(Error('登入或主播已變更，請重新操作'),{staleNotice:true});}};}
 function pushOperation(settings){const base=operationSnapshot(settings),revision=++pushActionRevision,valid=()=>base.valid()&&revision===pushActionRevision;return {...base,valid,assert(){if(!valid())throw Object.assign(Error('裝置推播操作已變更，請重新操作'),{staleNotice:true});}};}
 function writePush(body,valid){
  // Serialize route writes on this page: an older account's in-flight bind
  // must finish before a later disable/replacement-account bind takes effect.
  const run=pushWriteTail.catch(()=>{}).then(()=>{if(!valid())throw Object.assign(Error('裝置推播操作已變更'),{staleNotice:true});return api(body);});pushWriteTail=run;return run;
 }
 function pushPermission(){
  if(Notification.permission==='granted')return Promise.resolve('granted');
  if(pushPermissionPending)return pushPermissionPending;
  // The first request remains synchronous inside an explicit click. A newly
  // opened form may reuse the same origin permission prompt, not its old bind.
  const requested=Notification.requestPermission(),result=Promise.resolve(requested).finally(()=>{if(pushPermissionPending===result)pushPermissionPending=null;});pushPermissionPending=result;return result;
 }
 function button(compact=false){identity();const setup=devicePrefs.needsSetup(permission())?'<span class="notice-first-setup" role="status"><button type="button" data-notice="initialSetup">開啟音效與通知</button><button type="button" data-notice="skipSetup">稍後</button></span>':'';const legacyTotal=Object.entries(counts).reduce((n,[t,c])=>n+(noticeChannels(prefs,t).badge?c:0),0);const total=centerEnabled()?(center.snapshot().countsReady?Object.values(center.snapshot().badges).reduce((n,v)=>n+v,0):0):legacyTotal;return (key?`<button type="button" data-notice="open"${compact?` class="notice-bell" aria-label="訊息中心${total?'，'+total+' 則未讀':''}" title="訊息中心"`:''}>${compact?'<span aria-hidden="true">🔔</span>':'🔔 '+(centerEnabled()?'訊息中心':'訊息')}${total?` <span class="notice-count">${total>99?'99+':total}</span>`:''}</button>`: '')+setup;}
 function systemUnread(){identity();return centerEnabled()?(center.snapshot().countsReady?Number(center.snapshot().badges.system||0):0):Object.entries(counts).reduce((n,[type,count])=>n+(!['message','comment','announcement'].includes(type)&&noticeChannels(prefs,type).badge?count:0),0);}
 function audioButton(){return '';}
 function updateButton(){for(const el of document.querySelectorAll('header [data-notice="open"]')){const wrapper=document.createElement('div');wrapper.innerHTML=button(el.classList?.contains('notice-bell')===true);el.replaceWith(wrapper.firstElementChild);}for(const dot of document.querySelectorAll('[data-admin-more-alert]'))dot.hidden=!(Number(dot.dataset.localPending)||systemUnread());if(unlocked)document.querySelectorAll('header [data-notice=enableAudio]').forEach(el=>el.remove());}
 function connect(ch){if(ch===topic&&socket)return;stop();topic=ch;const myGeneration=generation;const start=()=>{if(myGeneration!==generation)return;socket=new WebSocket(apiUrl.replace(/^https:/,'wss:').replace(/\/functions\/v1\/.*$/,'/realtime/v1/websocket')+'?apikey='+encodeURIComponent(apiKey)+'&vsn=1.0.0');let ref=1;const send=(event,payload,channel='realtime:papa-notice:'+ch)=>socket?.readyState===1&&socket.send(JSON.stringify({topic:channel,event,payload,ref:String(ref++),join_ref:'1'}));socket.onopen=()=>{lastRealtimeAt=Date.now();send('phx_join',{config:{broadcast:{ack:false,self:false},presence:{enabled:false},private:false}});heartbeat=setInterval(()=>send('heartbeat',{},'phoenix'),25000);refresh();};socket.onmessage=e=>{lastRealtimeAt=Date.now();try{const m=JSON.parse(e.data);if(m.event==='broadcast')refresh();}catch{}};socket.onclose=()=>{lastRealtimeAt=0;clearInterval(heartbeat);reconnect=setTimeout(start,10000);};};start();}
 async function play(){if(!unlocked||!devicePrefs.soundEnabled())return false;try{sound.currentTime=0;await sound.play();return true;}catch{unlocked=false;return false;}}
 async function unlock(){if(!devicePrefs.soundEnabled())return;try{sound.muted=true;await sound.play();sound.pause();sound.currentTime=0;sound.muted=false;unlocked=true;}catch{sound.muted=false;}}
 const restoreAudio=()=>{if(!unlocked&&devicePrefs.soundEnabled())void unlock();};
 document.addEventListener('pointerdown',restoreAudio,{passive:true});
 document.addEventListener('keydown',e=>{if(!e.repeat&&!e.ctrlKey&&!e.metaKey&&!e.altKey)restoreAudio();},{passive:true});
 async function refresh(){const c=identity();if(!key)return;if(loading){refreshPending=true;return;}const g=generation;loading=true;try{const data=c.demo?read('data',{rows:[],preferences:{},unread:{}}):await api({op:'notifications',page,soundVersion:playerSoundVersion});if(g!==generation||contextStamp(c)!==contextStamp(context())){identity();return;}const latestPage=page>0&&!c.demo?await api({op:'notifications',page:0,soundVersion:data.playerSoundVersion??playerSoundVersion}):data;if(g!==generation||contextStamp(c)!==contextStamp(context())){identity();return;}const previous=primed;let recovered=[];if(!c.demo&&latestPage.deltaSupported&&previous&&(deltaBacklog||(latestPage.rows||[]).some(n=>!seen.has(n.id)))){const catchup=await delta.read(api,()=>g===generation&&contextStamp(c)===contextStamp(context()));if(g!==generation||contextStamp(c)!==contextStamp(context())){identity();return;}recovered=catchup.rows;deltaBacklog=catchup.more;if(deltaBacklog)refreshPending=true;}if(!previous)delta.seed(latestPage.rows||[]);let fresh=[];const latest=c.demo?(data.rows||[]).slice(page*50,page*50+51):(data.rows||[]);prefs=cleanNoticePrefs(latestPage.preferences);const activationKey=key+':'+c.deviceSessionId;if(!c.demo&&!pushDisabled(c)&&devicePrefs.canAutoEnable(permission(),latestPage.preferences)&&automaticActivationKey!==activationKey&&Date.now()>=bindingRetryAt){automaticActivationKey=activationKey;void pushOn(false).catch(()=>{if(g===generation){automaticActivationKey='';bindingFailed();}});}if(!canReplaceSound(c)){
  // The server may omit unchanged base64 audio. Keep the loaded sound until
  // its version changes; the old unversioned API still works during rollout.
  if(Object.hasOwn(latestPage,'playerSoundVersion')){
   const nextVersion=latestPage.playerSoundVersion||'';
   if(nextVersion!==playerSoundVersion){const samePageVersion=nextVersion===data.playerSoundVersion,source=(samePageVersion?(latestPage.playerSound??data.playerSound):latestPage.playerSound)||new URL('../assets/notification.m4a',import.meta.url).href;sound.src=source;playerSoundVersion=nextVersion;}
  }else{const source=latestPage.playerSound||new URL('../assets/notification.m4a',import.meta.url).href;if(sound.src!==source)sound.src=source;}
 }counts=latestPage.unread||{};more=latest.length>50;rows=latest.slice(0,50);{const arrivals=[...new Map([...recovered,...(latestPage.rows||[]).slice(0,50)].map(n=>[n.id,n])).values()];fresh=arrivals.filter(n=>!seen.has(n.id)&&!n.read_at);for(const n of arrivals)seen.add(n.id);if(previous){const active=fresh.filter(n=>Date.now()-Date.parse(n.created_at)<120000);const pop=active.find(n=>noticeChannels(prefs,n.type).popup);if(pop&&!document.hidden)toast(pop.body);const audible=active.find(n=>noticeChannels(prefs,n.type).sound);if(audible&&!document.hidden){const ring=async()=>{if(read('lastSound',null)===audible.id)return;if(await play())write('lastSound',audible.id);};if(navigator.locks)await navigator.locks.request(storageKey('audio-lock'),ring);else await ring();}}primed=true;}if(!c.demo&&data.topic)connect(data.topic);bindRememberedPush(c,g).catch(()=>{}).finally(()=>{const t=setTimeout(()=>void reportPushState(c,g),8000);t?.unref?.();});bindCompanionPush().catch(()=>{});if(centerEnabled())await center.refreshCounts();if(g!==generation||contextStamp(c)!==contextStamp(context()))return;updateButton();renderHealth();if(view==='inbox')showInbox(false);if(previous&&fresh.length)onUpdate?.(fresh);}finally{loading=false;if(refreshPending){refreshPending=false;queueMicrotask(()=>refresh().catch(()=>{}));}}}
 function shell(title,html){dialogRevision++;dialog.innerHTML=`<div class="dialog-head"><h2>${escape(title)}</h2><button type="button" data-notice="close" aria-label="關閉通知">✕</button></div><div class="dialog-body${view==='settings'||view==='centerSettings'?' notice-settings-body':centerEnabled()&&view==='inbox'?' notice-center-body':''}">${html}${view==='settings'||view==='centerSettings'||centerEnabled()&&view==='inbox'?'':'<p class="error" id="notice-error" role="status"></p>'}</div>`;if(!dialog.open)dialog.showModal();}
 function devicePushStatus(){const h=health.snapshot();if(pushDisabled(context())||devicePrefs.read().pushAllowed===false)return '使用者已在這台裝置停用';if(permission()!=='granted')return '尚未取得瀏覽器授權';if(!prefs.pushEnabled)return '帳號未允許推播（保留既有設定）';if(h.binding.inFlight||pushActivation)return '正在自動修復';if(h.error||h.binding.error)return '綁定失敗，將自動重試';if(boundDevice===key+':'+context().deviceSessionId&&h.worker==='ready'&&h.subscription==='present')return '已啟用並綁定成功';return '正在檢查／等待自動修復';}
 function healthHtml(){const h=health.snapshot(),labels={unknown:'尚未檢查',unsupported:'不支援',ready:'已找到',missing:'尚未建立',present:'已建立',error:'無法讀取'},permission={default:'尚未允許',granted:'已允許',denied:'已拒絕',unsupported:'不支援'},time=value=>value===null?'尚無紀錄':new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'});return `<dl class="notice-health-summary"><div><dt>瀏覽器</dt><dd>${h.secure?'安全連線':'需要 HTTPS'} · ${h.notificationSupported&&h.pushSupported?'支援推播':'未提供推播功能'}</dd></div><div><dt>通知權限</dt><dd>${permission[h.permission]||'尚未檢查'}</dd></div><div><dt>此主播裝置推播</dt><dd>${escape(devicePushStatus())}</dd></div><div><dt>服務／訂閱</dt><dd>${labels[h.worker]}／${labels[h.subscription]}</dd></div><div><dt>最近綁定嘗試</dt><dd>${escape(time(h.binding.attemptAt))}${h.binding.inFlight?' · 處理中':''}</dd></div><div><dt>最近綁定成功</dt><dd>${escape(time(h.binding.successAt))}</dd></div></dl>${h.error||h.binding.error?`<p class="error">${escape(h.error||h.binding.error)}</p>`:''}<p class="subtle">${h.checking?'正在檢查本機狀態。':'僅顯示這次登入於本機觀察的結果；通知是否送達需另外測試。'}${h.permission==='denied'?' 權限已拒絕，請到瀏覽器設定允許通知後再啟用。':''}</p>`;}
 function renderHealth(){if(contextKey!==contextStamp(context())){identity();return;}if(view!=='settings')return;const input=dialog.querySelector?.('[name="pushEnabled"]');if(input&&!pushSettingDirty)input.checked=prefs.pushEnabled;const target=dialog.querySelector?.('[data-notice-health]');if(target)target.innerHTML=healthHtml();const button=dialog.querySelector?.('[data-notice="health"]');if(button)button.disabled=health.snapshot().checking;}
 function centerScopeLabel(){const c=centerContext();return center.snapshot().scopeMode==='space'?'目前空間 · 全部主播':'此主播 · '+(c.streamerName||'目前主播');}
 function renderCenterInbox(){view='inbox';shell('🔔 訊息中心',messageCenterHtml(center.snapshot(),{scopeLabel:centerScopeLabel(),canUseSpace:isSuper(context()),canNavigate:!!onNavigate,canOpenCategory:!!onOpenCategory}));}
 async function showCenterSettings(){
  center.cancelPending();view='centerSettings';shell('訊息顯示設定','<p role="status">讀取顯示設定中…</p><p class="error" id="notice-error"></p>');const attempt=operationSnapshot(),revision=dialogRevision;
  const active=()=>attempt.valid()&&view==='centerSettings'&&dialog.open&&dialogRevision===revision;try{const settings=await center.preferences();if(!active())return;shell('訊息顯示設定',messageCenterSettingsHtml(settings,NOTICE_TYPES,centerScopeLabel()));}catch(error){if(active())throw error;}
 }
 function showInbox(open=true){view='inbox';if(centerEnabled()){renderCenterInbox();return;}const visible=rows.filter(n=>noticeChannels(prefs,n.type).center);shell('🔔 系統通知',`<div class="actions"><button data-notice="settings">⚙️ 通知設定</button><button data-notice="mute">${prefs.muteAll?'🔔 恢復通知':'🔕 暫停通知'}</button><button data-notice="readPage">本頁全部已讀</button></div><p class="subtle">${escape(context().streamerName||'目前主播')} · 最新在上${prefs.muteAll?' · 已靜音，紀錄仍保留':''}</p>${visible.map(n=>`<article class="notice-item ${n.read_at?'':'unread'}"><small>${n.level===2?'🔴 即時重要':'🟠 一般異動'} · ${escape(n.streamer_name)} · ${escape(new Date(n.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}))}</small><p>${escape(n.body)}</p><div class="actions">${onNavigate&&(n.entity_id||Object.hasOwn(NOTICE_TYPES,n.type))?`<button type="button" data-notice="view" data-notice-id="${escape(n.id)}">查看</button>`:''}${n.read_at?'<small>已讀</small>':`<button type="button" data-notice="read" data-notice-id="${escape(n.id)}">標為已讀</button>`}</div></article>`).join('')||'<div class="empty">目前沒有通知 ♡</div>'}<div class="pagination"><button data-notice="prev" ${page?'':'disabled'}>上一頁</button><span>第 ${page+1} 頁</span><label class="page-jump">頁碼<input type="number" min="1" max="201" value="${page+1}" data-unknown-pages="true" data-notice-page aria-label="通知頁碼"></label><button data-notice="jump">跳頁</button><button data-notice="next" ${more?'':'disabled'}>下一頁</button></div>`);}
 function showSettings(){view='settings';pushSettingDirty=false;const checkbox=(name,on,label)=>`<label class="check-row"><input type="checkbox" name="${name}" ${on?'checked':''}>${label}</label>`;shell('⚙️ 通知設定',`<form id="notice-settings"><div class="notice-settings-fields"><p>${isSuper(context())?'設定套用於全部主播的管理通知。':'設定只套用在你於此主播的通知。'}關閉提醒仍保留事件紀錄。</p>${checkbox('muteAll',prefs.muteAll,'🔕 暫停所有畫面、音效與推播提醒')}${checkbox('muteSound',prefs.muteSound||!devicePrefs.soundEnabled(),'關閉所有音效')}${checkbox('pushEnabled',prefs.pushEnabled,'帳號允許系統推播（裝置狀態另列於下方）')}<section class="notice-health" aria-labelledby="notice-health-title"><h3 id="notice-health-title">本機推播檢查</h3><div data-notice-health aria-live="polite">${healthHtml()}</div><button type="button" data-notice="health">重新檢查</button></section><div class="actions"><button type="button" data-notice="enablePush">啟用這台裝置推播</button><button type="button" data-notice="disablePush">停用這台裝置推播</button><button type="button" data-notice="sound">試聽音效</button><button type="button" data-notice="testPush">發送測試通知</button></div>${canReplaceSound(context())?'<label>本裝置管理音效（最多 256 KB）<input type="file" id="notice-sound-file" accept="audio/*"></label><button type="button" data-notice="resetSound">恢復管理預設音效</button>':'<p>玩家音效由PA Party總裁統一設定。</p>'}${isSuper(context())?'<label>全站玩家音效（最多 256 KB）<input type="file" id="notice-player-sound" accept="audio/*"></label><button type="button" data-notice="resetPlayerSound">恢復全站玩家預設音效</button>':''}<p class="subtle">自訂音效在網頁開啟時播放。背景／鎖屏聲音由裝置控制。iPhone 若無法啟用，請先將網站加入主畫面並從主畫面開啟。</p><details class="notice-type-details"><summary>各類通知提醒設定</summary><div class="notice-settings-grid">${Object.entries(NOTICE_TYPES).map(([type,[name]])=>`<fieldset><legend>${name}</legend>${[['center','訊息中心'],['popup','畫面提醒'],['sound','音效'],['push','Push'],['badge','紅點']].map(([k,label])=>checkbox(type+'.'+k,prefs.types[type][k],label)).join('')}</fieldset>`).join('')}</div></details></div><div class="notice-settings-footer"><p class="error" id="notice-error" role="status"></p><div class="actions"><button type="button" data-notice="open">返回通知</button><button class="primary" type="submit">儲存設定</button></div></div></form>`);health.check().catch(()=>{});}
 async function save(p,attempt=operationSnapshot()){attempt.assert();if(attempt.c.demo){const d=read('data',{rows:[],unread:{}});d.preferences=cleanNoticePrefs(p);write('data',d);}else await api({op:'noticePreferences',preferences:p});attempt.assert();prefs=cleanNoticePrefs(p);await refresh();attempt.assert();}
 async function mark(ids){if(context().demo){const d=read('data',{rows:[],preferences:{}});for(const n of d.rows)if(ids.includes(n.id))n.read_at=new Date().toISOString();d.unread=countUnread(d.rows);write('data',d);}else await api({op:'noticeRead',ids});await refresh();}
 const countUnread=items=>items.filter(n=>!n.read_at).reduce((a,n)=>(a[n.type]=(a[n.type]||0)+1,a),{});
 async function registration(){if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw Error('此瀏覽器尚不支援推播，通知中心仍可使用');return navigator.serviceWorker.register(new URL('../sw.js',import.meta.url));}
 async function bindRememberedPush(c,g){
  const device=c.deviceSessionId,identityKey=key,bindingKey=identityKey+':'+device,stamp=contextStamp(c);if(c.demo||permission()!=='granted'||devicePrefs.read().pushAllowed===false||!c.recipient||pushDisabled(c)||!prefs.pushEnabled||boundDevice===bindingKey||bindingDevice===bindingKey||!navigator.serviceWorker||Date.now()<bindingRetryAt)return;
  const currentBinding=()=>{const current=context();return g===generation&&key===identityKey&&contextStamp(current)===stamp&&!current.demo&&current.deviceSessionId===device&&current.recipient&&communicationIdentity(current,`${current.streamer}:${current.recipient}`)===identityKey&&!pushDisabled(current);};
  bindingDevice=bindingKey;try{
   // Reuse a permission/subscription the player already granted. Never prompt,
   // create a second subscription, or rebind on each short access rotation.
   const reg=await navigator.serviceWorker.getRegistration(new URL('../',import.meta.url)),sub=await reg?.pushManager.getSubscription();
   if(!currentBinding())return;
   if(!sub){boundDevice='';if(typeof navigator.serviceWorker.register==='function'&&automaticActivationKey!==bindingKey){automaticActivationKey=bindingKey;void pushOn(false).catch(()=>{if(currentBinding()){automaticActivationKey='';bindingFailed();}});}return;}
   health.recordBinding('attempt');await writePush({op:'pushSubscribe',subscription:sub.toJSON(),...(device?{expectedDeviceSessionId:device}:{})},currentBinding);
   // A missing registration/subscription or failed upsert must remain retryable
   // on the next lifecycle refresh. Only this successfully bound identity is done.
   if(currentBinding()){boundDevice=bindingKey;bindingRecovered();health.recordBinding('success');await health.check();}
  }catch(error){if(currentBinding()){bindingFailed();health.recordBinding('error',error);}throw error;}finally{if(bindingDevice===bindingKey)bindingDevice='';}
 }
 // A second signed-in identity on this browser (e.g. a player who is also
 // logged in as president). The message centre follows one identity, but the
 // other must still receive Web Push on the same, already-granted browser
 // subscription. Never prompts, never creates a subscription, never overrides
 // an explicit off, and never shares one (room, endpoint) row with the manager.
 async function bindCompanionPush(){
  const c=companion?.();
  if(!c||!companionApi||c.demo||!c.recipient||permission()!=='granted'||devicePrefs.read().pushAllowed===false||!navigator.serviceWorker?.getRegistration)return;
  const main=context();if(main.recipient&&main.recipient===c.recipient)return;
  if(main.role==='streamer_admin'&&main.streamer===c.streamer)return;
  const k=communicationIdentity(c,`${c.streamer}:${c.recipient}`),bindingKey=k+':'+c.deviceSessionId;
  let disabled=false;try{disabled=JSON.parse(localStorage.getItem('pa-notice-'+k+'-'+pushDisableKey(c)))===true;}catch{}
  if(disabled||companionBound===bindingKey||companionBinding===bindingKey)return;
  const still=()=>{const now=companion?.();return !!now&&now.recipient===c.recipient&&now.streamer===c.streamer&&now.deviceSessionId===c.deviceSessionId;};
  companionBinding=bindingKey;try{
   const reg=await navigator.serviceWorker.getRegistration(new URL('../',import.meta.url)),sub=await reg?.pushManager.getSubscription();
   if(!sub||!still())return;
   const inbox=await companionApi({op:'notifications',page:0});if(!still())return;
   const raw=inbox?.preferences||{};if(raw.pushEnabled===false){companionBound=bindingKey;return;}
   await companionApi({op:'pushSubscribe',subscription:sub.toJSON(),...(c.deviceSessionId?{expectedDeviceSessionId:c.deviceSessionId}:{})});
   if(raw.pushEnabled!==true&&still())await companionApi({op:'noticePreferences',preferences:{...cleanNoticePrefs(raw),pushEnabled:true}});
   if(still())companionBound=bindingKey;
  }finally{if(companionBinding===bindingKey)companionBinding='';}
 }
 // One small, privacy-safe status line per identity/device every 6 hours so a
 // device that never binds (no permission, LINE in-app, iPhone not on Home
 // Screen) is visible in Edge logs. No table, no polling, no endpoint secrets.
 async function reportPushState(c,g){
  try{
   if(c.demo||!c.recipient||g!==generation)return;
   const mark='pa-push-diag:'+key+':'+(c.deviceSessionId||'legacy');let last=0;try{last=Number(localStorage.getItem(mark))||0;}catch{}
   if(Date.now()-last<21600000)return;
   const ua=String(navigator.userAgent||''),supported='serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
   let subscription='none',endpointHost=null,worker='none';
   try{const reg=await navigator.serviceWorker?.getRegistration(new URL('../',import.meta.url));worker=reg?.active?'active':reg?'installing':'none';const sub=await reg?.pushManager?.getSubscription();if(sub){subscription='present';try{endpointHost=new URL(sub.endpoint||sub.toJSON?.().endpoint).host;}catch{}}}catch{subscription='error';}
   if(g!==generation)return;
   const diagnostic={permission:permission(),supported,standalone:!!(globalThis.matchMedia?.('(display-mode: standalone)')?.matches||navigator.standalone),ios:/iPhone|iPad|iPod/.test(ua),inApp:/\bLine\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(ua)?'yes':'no',subscription,endpointHost,bound:boundDevice===key+':'+c.deviceSessionId,pushEnabled:!!prefs.pushEnabled,worker,error:(()=>{const h=health.snapshot();return String(h.binding?.error||h.error||'').slice(0,80)||null;})(),app:'10.31-PUSH.1'};
   await api({op:'pushDiagnostic',diagnostic});try{localStorage.setItem(mark,String(Date.now()));}catch{}
  }catch{}
 }
 function pushOn(settings=true){
  if(pushActivation?.attempt.valid())return pushActivation.promise;
  const attempt=pushOperation(settings),c=attempt.c;attempt.assert();
  if(c.demo)throw Error('預覽模式不訂閱正式推播');
  if(globalThis.isSecureContext===false)throw Error('請使用 HTTPS 安全連線啟用推播');
  if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw Error('此瀏覽器尚不支援推播，通知中心仍可使用');
  if(Notification.permission==='denied')throw Error('通知權限已拒絕，請在瀏覽器設定允許後再啟用');
  // Request synchronously inside this explicit click. Granted permission is
  // reused; denied permission is never prompted repeatedly.
  const permissionRequest=pushPermission();
  if(Notification.permission!=='granted')toast('請在瀏覽器的通知權限提示中選擇允許');
  const run=(async()=>{let bindingAttempted=false,bindingSucceeded=false;
   try{
    const permission=await permissionRequest;attempt.assert();
    if(permission!=='granted')throw Error('通知未獲允許，請在瀏覽器設定開啟');
    const registered=await registration();attempt.assert();
    const reg=registered?.active?registered:await navigator.serviceWorker.ready;attempt.assert();
    const {publicKey}=await api({op:'pushKey'});attempt.assert();
    const decoded=atob(publicKey.replace(/-/g,'+').replace(/_/g,'/'));
    let sub=await reg.pushManager.getSubscription();attempt.assert();
    if(!sub){sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(decoded,c=>c.charCodeAt(0))});attempt.assert();}
    health.recordBinding('attempt');bindingAttempted=true;await writePush({op:'pushSubscribe',subscription:sub.toJSON(),...(c.deviceSessionId?{expectedDeviceSessionId:c.deviceSessionId}:{})},attempt.valid);attempt.assert();
    health.recordBinding('success');bindingSucceeded=true;boundDevice=key+':'+c.deviceSessionId;
    await save({...prefs,pushEnabled:true},attempt);attempt.assert();setPushDisabled(c,false);devicePrefs.save({setupDone:true,pushAllowed:true});bindingRecovered();await health.check();attempt.assert();renderHealth();if(settings)showSettings();toast('此裝置推播已啟用；可另行發送測試通知確認');
   }catch(error){if(bindingAttempted&&!bindingSucceeded&&attempt.valid()&&!error.staleNotice)health.recordBinding('error',error);throw error;}
  })();
  const result=run.finally(()=>{if(pushActivation?.promise===result)pushActivation=null;renderHealth();});pushActivation={promise:result,attempt};return result;
 }
 function pushOff(){
  if(pushDeactivation?.attempt.valid())return pushDeactivation.promise;
  const attempt=pushOperation(false),c=attempt.c;attempt.assert();if(c.demo)throw Error('預覽模式不修改正式推播');
  // This origin-local choice is scoped by Space/room/recipient and device. It
  // survives reload without disabling another room, device, or global prefs.
  setPushDisabled(c,true);boundDevice='';health.recordBinding('idle');renderHealth();
  const run=(async()=>{
   if('serviceWorker'in navigator){
    const reg=await navigator.serviceWorker.getRegistration(new URL('../',import.meta.url));attempt.assert();
    const sub=await reg?.pushManager.getSubscription();attempt.assert();
    if(sub)await writePush({op:'pushUnsubscribe',endpoint:sub.endpoint},attempt.valid);attempt.assert();
   }
   renderHealth();toast('已停用此主播在本裝置的推播');
  })();
  const result=run.finally(()=>{if(pushDeactivation?.promise===result)pushDeactivation=null;});pushDeactivation={promise:result,attempt};return result;
 }
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-notice]');if(!b)return;e.preventDefault();const click=operationSnapshot();try{switch(b.dataset.notice){case'skipSetup':devicePrefs.save({setupDone:true});document.querySelectorAll('.notice-first-setup').forEach(el=>el.remove());break;case'initialSetup':{devicePrefs.save({setupDone:true,soundEnabled:true,pushAllowed:true});document.querySelectorAll('.notice-first-setup').forEach(el=>el.remove());void unlock();if(permission()==='denied'){toast('通知權限已拒絕，請至瀏覽器設定手動開啟');break;}if(permission()==='unsupported'){toast('此瀏覽器不支援系統通知，音效仍可使用');break;}if(key&&!context().demo)await pushOn(false);else await pushPermission();break;}case'open':if(centerEnabled()){view='inbox';renderCenterInbox();await center.open();click.assert();}else{page=0;await refresh();click.assert();showInbox();}break;case'close':center.cancelPending();view='';dialog.close();break;case'settings':center.cancelPending();showSettings();break;case'centerCategory':await center.setCategory(b.dataset.category);break;case'centerScope':await center.setScope(b.dataset.scope);break;case'centerRefresh':await center.open();break;case'centerSettings':await showCenterSettings();break;case'centerReadAll':await center.mark(null,true);break;case'centerConversation':{const category=center.snapshot().category;center.cancelPending();view='';dialog.close();await onOpenCategory?.(category);break;}case'health':await health.check();break;case'view':{const notice=(centerEnabled()?center.snapshot().rows:rows).find(n=>n.id===b.dataset.noticeId);if(!notice||!onNavigate||!(notice.entity_id||Object.hasOwn(NOTICE_TYPES,notice.type)))break;click.assert();view='';dialog.close();await onNavigate({...notice});break;}case'mute':await save({...prefs,muteAll:!prefs.muteAll});break;case'read':if(centerEnabled())await center.mark([b.dataset.noticeId]);else await mark([b.dataset.noticeId]);break;case'readPage':if(centerEnabled())await center.mark(center.snapshot().rows.filter(n=>!n.read_at).map(n=>n.id));else await mark(rows.map(n=>n.id));break;case'jump':{if(centerEnabled()){const v=center.snapshot(),chosen=Number(dialog.querySelector('[data-notice-page]').value),max=Math.max(1,Math.ceil(v.total/50));if(!Number.isSafeInteger(chosen)||chosen<1||chosen>max)throw Error('請輸入 1 到 '+max+' 的頁碼');await center.loadPage(chosen-1);break;}const chosen=Number(dialog.querySelector('[data-notice-page]').value);if(!Number.isSafeInteger(chosen)||chosen<1||chosen>201)throw Error('請輸入 1 到 201 的頁碼');page=chosen-1;await refresh();break;}case'prev':if(centerEnabled())await center.loadPage(Math.max(0,center.snapshot().page-1));else{page=Math.max(0,page-1);await refresh();}break;case'next':if(centerEnabled())await center.loadPage(Math.min(center.snapshot().page+1,Math.max(0,Math.ceil(center.snapshot().total/50)-1)));else{page++;await refresh();}break;case'enablePush':if(!('Notification'in window))throw Error('此瀏覽器不支援推播');await pushOn();break;case'disablePush':await pushOff();break;case'testPush':if(context().demo)throw Error('請在正式登入後測試推播');await api({op:'noticeTest'});await refresh();toast('測試通知已送出');break;case'enableAudio':case'sound':devicePrefs.save({soundEnabled:true});unlocked=true;if(!await play())throw Error('音效無法播放，請再按一次試聽');updateButton();break;case'resetPlayerSound':if(!isSuper(context()))throw Error('僅限PA Party總裁');await api({op:'noticeSound',data:null});toast('已恢復全站玩家預設音效');break;case'resetSound':if(!canReplaceSound(context()))throw Error('玩家音效由PA Party總裁設定');write('sound',null);sound.src=new URL('../assets/notification.m4a',import.meta.url).href;toast('已恢復你提供的預設音效');break;}}catch(err){if(err.staleNotice||!click.valid())return;const target=dialog.open?dialog.querySelector('#notice-error'):null;if(target)target.textContent=err.message;else toast(err.message);}});
 dialog.addEventListener('close',()=>{if(dialog.open)return;center.cancelPending();view='';dialogRevision++;});
 dialog.addEventListener('submit',async e=>{
  if(e.target.id!=='notice-center-settings')return;e.preventDefault();const attempt=operationSnapshot(),form=e.target,revision=dialogRevision,submit=form.querySelector('[type=submit]'),active=()=>attempt.valid()&&dialog.open&&view==='centerSettings'&&dialogRevision===revision&&dialog.querySelector('#notice-center-settings')===form;
  if(submit.disabled||!active())return;submit.disabled=true;const f=new FormData(form),settings={types:Object.fromEntries(Object.keys(NOTICE_TYPES).map(type=>[type,{center:f.has(type+'.center'),badge:f.has(type+'.badge')}]))};
  try{await center.preferences(settings);if(!active())return;toast('顯示設定已儲存');view='inbox';renderCenterInbox();await center.open();}catch(error){if(active())dialog.querySelector('#notice-error').textContent=error.message;}finally{if(active())submit.disabled=false;}
 });
 dialog.addEventListener('submit',async e=>{if(e.target.id!=='notice-settings')return;e.preventDefault();const attempt=operationSnapshot(true),form=e.target,submit=form.querySelector('[type=submit]');if(submit?.disabled)return;if(submit)submit.disabled=true;const f=new FormData(form),p=cleanNoticePrefs();for(const k of ['muteAll','muteSound'])p[k]=f.has(k);p.pushEnabled=pushSettingDirty?f.has('pushEnabled'):prefs.pushEnabled;for(const type of Object.keys(NOTICE_TYPES))for(const k of Object.keys(p.types[type]))p.types[type][k]=f.has(type+'.'+k);try{await save(p,attempt);attempt.assert();devicePrefs.save({soundEnabled:!p.muteSound,setupDone:true,...(pushSettingDirty?{pushAllowed:p.pushEnabled}:{})});toast('通知設定已儲存');showInbox();}catch(err){if(!attempt.valid()||err.staleNotice)return;const target=dialog.querySelector('#notice-error');if(target)target.textContent=err.message;}finally{if(submit)submit.disabled=false;}});
 dialog.addEventListener('change',async e=>{if(e.target.name==='pushEnabled'){pushSettingDirty=true;pushActionRevision++;return;}if(!['notice-sound-file','notice-player-sound'].includes(e.target.id))return;if(!canReplaceSound(context()))return;const globalSound=e.target.id==='notice-player-sound';if(globalSound&&!isSuper(context()))return;const file=e.target.files[0];if(!file)return;try{if(!file.type.startsWith('audio/')||file.size>262144)throw Error('請選擇 256 KB 以下的音效檔');const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});const probe=new Audio(data);await new Promise((resolve,reject)=>{probe.onloadedmetadata=resolve;probe.onerror=()=>reject(Error('此瀏覽器無法播放這個音效格式'));});if(globalSound){if(context().demo)throw Error('請在正式PA Party總裁設定');await api({op:'noticeSound',data});toast('全站玩家音效已更新');}else{write('sound',data);sound.src=data;toast('本裝置管理音效已替換');}}catch(err){dialog.querySelector('#notice-error').textContent=err.message;}});
 // Realtime already refreshes on each change. Poll only as a bounded
 // fallback while its socket is disconnected, never both transports at once.
 setInterval(()=>{if(document.hidden)return;if(socket?.readyState===1&&Date.now()-lastRealtimeAt<60000)return;
  if(socket?.readyState===1)socket.close();refresh().catch(()=>{});},30000);
 async function resumePush(){const c=identity(),g=generation;if(boundDevice&&!pushDisabled(c)&&permission()==='granted'){const h=await health.check();if(g!==generation)return;if(h.worker==='missing'||h.subscription==='missing'){boundDevice='';automaticActivationKey='';}}await refresh();}
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)resumePush().catch(()=>{});});
 window.addEventListener('online',()=>resumePush().catch(()=>{}));
 window.addEventListener('hashchange',()=>{identity();refresh().catch(()=>{});});
 document.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&e.target.matches('[data-notice-page]')){e.preventDefault();e.target.closest('.pagination').querySelector('[data-notice=jump]').click();}});
 return {button,audioButton,systemUnread,refresh,realtimeAvailable:()=>socket?.readyState===1&&Date.now()-lastRealtimeAt<60000,
  localChange(before,after,action,actor){identity();const c=context(),slug=action.streamer||c.streamer;const all=deriveNotices(before,after,{streamer_id:after.streamers.find(x=>x.slug===slug)?.id||slug,role:actor?.role},new Date().toISOString());all.push(...all.filter(n=>n.recipient==='__admin__').map(n=>({...n,id:n.id+':super',recipient:'__super__'})));for(const recipient of new Set(all.map(n=>n.recipient))){const k=`pa-notice-demo:${recipient==='__super__'?'__global__':slug}:${recipient}-data`;let d;try{d=JSON.parse(localStorage.getItem(k));}catch{}d||={rows:[],preferences:{}};d.rows.unshift(...all.filter(n=>n.recipient===recipient));d.unread=countUnread(d.rows);localStorage.setItem(k,JSON.stringify(d));}refresh().catch(()=>{});}};
}

