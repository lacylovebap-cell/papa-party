import {medalEvidenceHtml} from './medal-evidence.js?v=10.18-WEB.1';
import {achievementPanelHtml,achievementDetailsHtml,achievementHoldingState} from './achievements-view.js?v=10.18-WEB.1';
const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const modes={public:'公開',condition_hidden:'隱藏條件',hidden:'完全隱藏',after_award:'取得後公開'};
export function medalManagementPager(kind,total,page){
 const max=Math.max(1,Math.ceil(total/20)),unit=/^(rooms|evidence):/.test(kind)?'筆':'位';
 return '<div class="pagination" data-total-pages="'+max+'"><button type="button" data-medal-list="'+kind+'" data-page="'+Math.max(0,page-1)+'" '+(page?'':'disabled')+'>上一頁</button><span>第 '+(page+1)+' / 共 '+max+' 頁 · '+total+' '+unit+'</span><input type="number" data-medal-jump="'+kind+'" aria-label="勳章名單頁碼" min="1" max="'+max+'" value="'+(page+1)+'"><button type="button" data-medal-jump-button="'+kind+'">跳頁</button><button type="button" data-medal-list="'+kind+'" data-page="'+(page+1)+'" '+(page+1<max?'':'disabled')+'>下一頁</button></div>';
}
export function medalGrantHtml(row,player=null){
 if(row.scope==='global'&&row.manualAllowed!==true)return '<p class="subtle">全站勳章由系統統一管理，不開放主播授予。</p>';
 if(player&&!row.revoked&& (row.qualified||row.recorded))return '<p>此玩家已獲得，無須重複授予。</p>';
 return '<section class="medal-grant"><h3>手動授予勳章</h3>'+(player?'<p>目前玩家：'+h(player.name)+'</p>':'<button type="button" data-medal-list="candidates" data-page="0">選擇玩家</button><div data-medal-list-panel="candidates"></div>')+
  (row.lifetime==='show'?'<label>取得所屬場次<input type="date" data-medal-show-day required></label>':'')+
  '<label>原達成時間（台灣時間，選填）<input type="datetime-local" data-medal-certified-at></label><small>補認證以前已達成；有效期限及目前持有條件沿用原規則。不確定時間可留空，記錄本次認證時間。</small><label>授予原因／依據<textarea data-medal-grant-reason minlength="4" maxlength="500" placeholder="核對以前達成的紀錄"></textarea></label><button type="button" class="primary" data-medal-grant '+(!player?'disabled':'')+'>'+(player?'授予'+h(player.name)+'此勳章':'授予選取玩家（0 位）')+'</button><p data-medal-grant-status role="status"></p></section>';
}
export function createMedalManagement({api,context,root=document,modal,toast,onChange=()=>{},confirmGrant=null}){
 let rows=[],stamp='',cacheAt=0,generation=0,dialog=null,category='all',catalogPending=null;
 let baseKey='',isSuper=false,rooms=[],chosenRoom=null,targetScope='streamer';
 const identity=()=>{const c=context();return c.active?JSON.stringify([c.spaceId,c.room,c.actorKey]):'';};
 const home=()=>({id:context().room,spaceId:context().spaceId,name:rooms.find(r=>r.id===context().room&&r.spaceId===context().spaceId)?.name||'目前主播'});
 const target=()=>chosenRoom||home();
 const targetKey=()=>JSON.stringify([target().spaceId,target().id,targetScope]);
 const requestTarget=t=>({spaceId:t.spaceId,streamer:t.id});
 const active=d=>!!d&&dialog===d&&d.identity===identity()&&root.querySelector('#dialog')?.open
  &&d.node&&root.querySelector('[data-medal-management-body]')===d.node
  &&(d.player?context().playerId===d.player.id:targetKey()===d.targetKey);
 const error=e=>toast(e.message);
 function closeDialog(){if(dialog&&root.querySelector('[data-medal-management-body]')===dialog.node)root.querySelector('#dialog')?.close?.();dialog=null;}
 async function load(force=false){
  const key=identity();
  if(baseKey!==key){closeDialog();baseKey=key;chosenRoom=null;isSuper=false;rooms=[];targetScope='streamer';stamp='';}
  if(dialog&&!active(dialog))closeDialog();
  const panel=root.querySelector('#medal-management');if(!panel)return;
  if(!key){panel.textContent='請先登入管理';return;}
  const t=target(),tk=targetKey(),rev=key+'|'+tk+'|'+context().revision;
  if(!force&&stamp===rev&&Date.now()-cacheAt<60000){paint(panel);return;}
  if(!force&&catalogPending?.key===rev)return catalogPending.promise;
  const g=++generation;panel.textContent='讀取勳章管理中…';
  const promise=(async()=>{try{
   const result=await api({op:'achievementManagement',view:'catalog',...requestTarget(t)});
   if(g!==generation||key!==identity()||tk!==targetKey())return;
   if(result?.version!==1||result.scope?.spaceId!==t.spaceId||result.scope?.streamerId!==t.id||!Array.isArray(result.rows)||result.rows.length>100)throw Error('勳章管理範圍尚未確認');
   rows=result.rows;isSuper=result.isSuper===true;rooms=Array.isArray(result.rooms)?result.rooms:[];
   if(active(dialog)&&!dialog.player){const latest=rows.find(r=>r.code===dialog.row.code);if(latest){dialog.row={...dialog.row,recipientCount:latest.recipientCount};const count=root.querySelector('[data-medal-recipient-total]');if(count)count.textContent=String(latest.recipientCount||0);}}
   stamp=rev;cacheAt=Date.now();paint(root.querySelector('#medal-management'));
  }catch(e){if(g===generation&&key===identity()&&tk===targetKey()&&root.querySelector('#medal-management'))root.querySelector('#medal-management').textContent=e.message;}
  finally{if(catalogPending?.generation===g)catalogPending=null;}})();
  catalogPending={key:rev,generation:g,promise};return promise;
 }
 function paint(panel){
  if(!panel)return;const t=target();
  const toolbar=isSuper?'<div class="medal-filters medal-management-target"><label>授予範圍<select data-medal-target-scope>'+Object.entries({streamer:'指定主播勳章',global:'全站勳章',radio:'電台勳章（待補）'}).map(([key,name])=>'<option value="'+key+'" '+(targetScope===key?'selected':'')+'>'+name+'</option>').join('')+'</select></label>'+(targetScope==='streamer'?'<label>主播<select data-medal-target-room>'+rooms.map((r,i)=>'<option value="'+i+'" '+(r.id===t.id&&r.spaceId===t.spaceId?'selected':'')+'>'+h(r.name)+'</option>').join('')+'</select></label>':'')+'</div>':'<p class="subtle">目前主播：'+h(t.name)+' · 僅管理本主播勳章</p>';
  panel.innerHTML=toolbar+(isSuper&&targetScope==='streamer'?'<p class="subtle">獲得者彙整全部主播；授予僅作用於選定的主播。</p>':'')+achievementPanelHtml(rows,{manager:true,managementCatalog:true,category,scope:targetScope,hideScopeFilter:true});
 }
 function selection(){const d=dialog;if(!active(d)||d.player)return;d.confirmation=null;
  const b=root.querySelector('[data-medal-grant]');if(b){b.disabled=!d.selected.size||d.saving;b.textContent='授予選取玩家（'+d.selected.size+' 位）';}
  const count=root.querySelector('[data-medal-selected-count]');if(count)count.textContent='已選 '+d.selected.size+' 位';
 }
 function validList(result,t,page){if(result?.version!==1||result.scope?.spaceId!==t.spaceId||result.scope?.streamerId!==t.id||!Array.isArray(result.rows)||result.rows.length>20||!Number.isSafeInteger(result.total)||result.total<0||result.page!==page)throw Error('勳章名單尚未確認');}
 async function list(kind,page=0){
  if(kind.startsWith('rooms:'))return roomList(kind.slice(6),page);
  if(kind.startsWith('evidence:'))return evidenceList(kind.slice(9),page);
  const d=dialog;if(!active(d)||d.player||!['recipients','candidates'].includes(kind))return;
  const panel=root.querySelector('[data-medal-list-panel="'+kind+'"]');if(!panel)return;
  const g=++d.generations[kind],query=d.queries[kind]||'';panel.textContent='讀取中…';
  try{
   const result=await api({op:'achievementManagement',view:kind,code:d.row.code,query,page,...requestTarget(d.target)});
   if(!active(d)||g!==d.generations[kind])return;validList(result,d.target,page);
   const max=Math.max(1,Math.ceil(result.total/20));if(page>=max)return list(kind,max-1);
   d.pages[kind]=page;
   if(kind==='candidates'){d.candidates=result.rows;for(const p of result.rows)if(p.earned)d.selected.delete(p.playerId);}
   panel.innerHTML='<div class="medal-list-search"><input type="search" data-medal-query="'+kind+'" maxlength="100" value="'+h(query)+'" placeholder="'+(kind==='candidates'?'名稱、常用名稱、公開玩家 ID':'搜尋玩家暱稱')+'"><button type="button" data-medal-search="'+kind+'">搜尋</button></div>'+
    (kind==='candidates'?'<div class="medal-selection"><button type="button" data-medal-select-page>本頁全選</button><button type="button" data-medal-clear-selection>取消全選</button><span data-medal-selected-count>已選 '+d.selected.size+' 位</span><small>每批最多 50 位；跨頁保留勾選</small></div>':'')+
    result.rows.map(p=>'<div class="medal-recipient">'+(kind==='candidates'?'<input type="checkbox" data-medal-pick="'+h(p.playerId)+'" data-name="'+h(p.name)+'" aria-label="選取'+h(p.name)+'" '+(p.earned?'disabled':d.selected.has(p.playerId)?'checked':'')+'>':'')+'<div><strong>'+h(p.name)+'</strong><small>'+(p.revoked?'已摘除':p.earned?'已獲得':'未獲得')+(kind==='recipients'?' · '+h(p.source)+(p.canViewRooms?'':dateAndState(p)):'')+'</small>'+(kind==='candidates'&&p.publicIds?.length?'<small>'+h(p.publicIds.slice(0,3).join(' · '))+'</small>':'')+(kind==='recipients'&&p.canViewRooms?'<button type="button" data-medal-expand="'+h(p.playerKey)+'">查看主播 &gt;</button><div data-medal-rooms="'+h(p.playerKey)+'" hidden></div>':'')+(kind==='recipients'&&!p.canViewRooms?evidenceButton(p.playerKey):'')+'</div></div>').join('')+(result.rows.length?'':'<p>尚無符合的玩家</p>')+medalManagementPager(kind,result.total,page);
   if(kind==='candidates')selection();
  }catch(e){if(active(d)&&g===d.generations[kind])panel.textContent=e.message;}
 }
 function dateAndState(p){return (p.acquiredAt?' · '+h(new Date(p.acquiredAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})):' · 取得時間無紀錄')+' · '+achievementHoldingState(p);}
 async function roomList(key,page=0){
  const d=dialog;if(!active(d)||!isSuper||!/^[a-f0-9]{32}$/.test(key))return;
  const panel=root.querySelector('[data-medal-rooms="'+key+'"]');if(!panel)return;
  const generation=(d.roomGenerations[key]||0)+1;d.roomGenerations[key]=generation;panel.hidden=false;panel.textContent='讀取主播紀錄中…';
  try{
   const cacheKey=key+'|'+page,result=d.roomCache.get(cacheKey)||await api({op:'achievementManagement',view:'recipientRooms',code:d.row.code,playerKey:key,page,...requestTarget(d.target)});
   if(!active(d)||d.roomGenerations[key]!==generation)return;validList(result,d.target,page);
   const max=Math.max(1,Math.ceil(result.total/20));if(page>=max)return roomList(key,max-1);d.roomCache.set(cacheKey,result);
   panel.innerHTML=result.rows.map(r=>'<div class="medal-room-record"><strong>'+h(r.name)+'</strong><small>'+h(r.source)+dateAndState(r)+'</small>'+(r.evidenceKey?evidenceButton(key,r.evidenceKey):'')+'</div>').join('')+(result.rows.length?'':'<p>尚無主播紀錄</p>')+medalManagementPager('rooms:'+key,result.total,page);
  }catch(e){if(active(d)&&d.roomGenerations[key]===generation)panel.textContent=e.message;}
 }
 function evidenceButton(player,key='all'){
  if(!/^[a-f0-9]{32}$/.test(player)||!(/^[a-f0-9]{32}$/.test(key)||key==='all'))return '';
  const token=player+':'+key;
  return '<button type="button" data-medal-evidence="'+token+'">查看判定細項</button><div data-medal-evidence-panel="'+token+'" hidden></div>';
 }
 async function evidenceList(token,page=0){
  const d=dialog;if(!active(d)||!/^[a-f0-9]{32}:(all|[a-f0-9]{32})$/.test(token))return;
  const panel=root.querySelector('[data-medal-evidence-panel="'+token+'"]');if(!panel)return;
  const epoch=d.evidenceEpoch,g=(d.evidenceGenerations[token]||0)+1;d.evidenceGenerations[token]=g;panel.hidden=false;panel.textContent='讀取判定依據中…';
  try{const [playerKey,evidenceKey]=token.split(':'),cacheKey=token+'|'+page;
   const request=()=>{const pending=api({op:'achievementManagement',view:'evidence',code:d.row.code,playerKey,...(evidenceKey==='all'?{}:{evidenceKey}),page,...requestTarget(d.target)}).finally(()=>{if(d.evidencePending.get(cacheKey)===pending)d.evidencePending.delete(cacheKey);});d.evidencePending.set(cacheKey,pending);return pending;};
   const result=d.evidenceCache.get(cacheKey)||await(d.evidencePending.get(cacheKey)||request());
   if(!active(d)||d.evidenceEpoch!==epoch||d.evidenceGenerations[token]!==g)return;validList(result,d.target,page);
   const max=Math.max(1,Math.ceil(result.total/20));if(page>=max)return evidenceList(token,max-1);d.evidenceCache.set(cacheKey,result);
   for(const r of result.rows)if(/^[a-f0-9]{32}$/.test(r.awardKey||''))d.awards.set(r.awardKey,{row:r,token,page});
   panel.innerHTML=medalEvidenceHtml(result.rows,{canRevoke:d.row.scope!=='global'||d.row.manualAllowed===true})+(result.rows.length?'':'<p>目前沒有可查看的判定紀錄。</p>')+medalManagementPager('evidence:'+token,result.total,page);
  }catch(e){if(active(d)&&d.evidenceGenerations[token]===g)panel.textContent=e.message;}
 }
 async function revoke(awardKey){
  const d=dialog;if(!active(d)||d.saving||d.row.scope==='global'&&d.row.manualAllowed!==true)return;
  const entry=d.awards.get(awardKey);if(!entry||entry.row.revokedAt)return;
  const reason=root.querySelector('[data-medal-revoke-reason="'+awardKey+'"]')?.value.trim()||'';
  const status=root.querySelector('[data-medal-revoke-status="'+awardKey+'"]'),button=root.querySelector('[data-medal-revoke="'+awardKey+'"]');
  if(!status||!button)return;if(reason.length<4||reason.length>500){status.textContent='請填寫 4～500 字的摘除原因';return;}
  const r=entry.row,confirmation=JSON.stringify([d.identity,d.targetKey,d.row.code,awardKey,reason]);
  if(d.revokeConfirm.get(awardKey)!==confirmation){d.revokeConfirm.set(awardKey,confirmation);button.textContent='確認摘除此筆勳章';status.textContent='玩家：'+(d.player?.name||r.playerName||'目前玩家')+'\n勳章：'+r.name+'\n範圍：'+r.streamerName+'\n取得時間：'+new Date(r.acquiredAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})+'\n摘除原因：'+reason+'\n保留原紀錄與稽核；請核對後再次確認。';return;}
  d.saving=true;button.disabled=true;
  try{const result=await api({op:'achievementRevoke',...requestTarget(d.target),code:d.row.code,awardKey,reason});
   if(!active(d))return;if(result?.ok!==true||typeof result.alreadyRevoked!=='boolean')throw Error('摘除結果尚未確認');
   d.revokeConfirm.clear();d.awards.clear();d.roomCache.clear();d.evidenceEpoch++;d.evidenceCache.clear();d.evidencePending.clear();d.selected.clear();
   await evidenceList(entry.token,entry.page);const updated=await onChange();
   if(active(d)&&d.player){const latest=updated?.manager&&updated.rows?.find(x=>x.code===d.row.code);if(latest){d.row=latest;const details=root.querySelector('[data-medal-management-body] .medal-details');if(details)details.outerHTML=achievementDetailsHtml(latest,{manager:true});}const grant=root.querySelector('[data-medal-grant]');if(grant)grant.disabled=true;}
   await load(true);toast(result.alreadyRevoked?'此筆已摘除，沒有重複操作':'此筆勳章已摘除，原紀錄與稽核已保留');
  }catch(e){if(active(d)){status.textContent=e.message;d.revokeConfirm.delete(awardKey);button.textContent='摘除此筆勳章';}}
  finally{d.saving=false;if(active(d))button.disabled=false;}
 }
 function open(row,player=null){
  if(!identity()||!row)return;const t=player?home():target();
  dialog={identity:identity(),target:{...t},targetKey:targetKey(),row,player,selected:new Map(),queries:{},pages:{},generations:{recipients:0,candidates:0},roomGenerations:{},roomCache:new Map(),evidenceGenerations:{},evidenceEpoch:0,evidenceCache:new Map(),evidencePending:new Map(),awards:new Map(),revokeConfirm:new Map(),saving:false};
  modal(player?'玩家勳章':'勳章詳細管理','<div data-medal-management-body><p>授予範圍：'+h(row.scope==='global'?'全站勳章':t.name)+'</p>'+(player?'<p>目前玩家：'+h(player.name)+'</p>':'')+achievementDetailsHtml(row,{manager:true,managementCatalog:!player})+'<p>顯示方式：'+h(modes[row.visibility])+'</p>'+
   (player||row.scope==='global'&&!isSuper?'':'<section><h3>已獲得此勳章的玩家</h3><div data-medal-list-panel="recipients"></div></section>')+(player&&(row.scope!=='global'||row.manualAllowed===true)&&row.managementKey&&row.managementEvidenceKey?evidenceButton(row.managementKey,row.managementEvidenceKey):'')+medalGrantHtml(row,player)+'</div>');
  dialog.node=root.querySelector('[data-medal-management-body]');
  if(!player&&(row.scope!=='global'||isSuper))list('recipients');
 }
 async function grant(){
  const d=dialog;if(!active(d)||d.row.scope==='global'&&d.row.manualAllowed!==true||d.saving||d.player&&!d.row.revoked&&(d.row.qualified||d.row.recorded))return;
  const players=d.player?[d.player.id]:[...d.selected.keys()];
  if(players.length<1||players.length>50)throw Error('請選擇 1～50 位玩家');
  const reason=root.querySelector('[data-medal-grant-reason]')?.value.trim()||'',showDay=root.querySelector('[data-medal-show-day]')?.value;
  if(reason.length<4||reason.length>500)throw Error('請填寫 4～500 字的授予依據');
  if(d.row.lifetime==='show'&&!showDay)throw Error('請填取得所屬場次');
  const atInput=root.querySelector('[data-medal-certified-at]')?.value,atMs=atInput?Date.parse(atInput+'+08:00'):null;
  if(atInput&&(!Number.isFinite(atMs)||atMs>Date.now()))throw Error('原達成時間不可填未來或無效時間');
  const certificationAt=atMs===null?null:new Date(atMs).toISOString();
  const confirmation=JSON.stringify([d.identity,d.targetKey,d.row.code,players.slice().sort(),reason,showDay||'',certificationAt]);
  const summary='勳章：'+d.row.name+'\n授予範圍：'+(d.row.scope==='global'?'全站勳章':d.target.name)+'\n選取人數：'+players.length+' 位'+(d.player?'（'+d.player.name+'）':'')+'\n授予原因：'+reason+'\n原達成時間：'+(atInput?atInput.replace('T',' ')+'（台灣時間）':'未提供；記錄本次認證時間')+(showDay?'\n所屬場次：'+showDay:'');
  if(confirmGrant){if(!confirmGrant(summary))return;}
  else if(d.confirmation!==confirmation){d.confirmation=confirmation;root.querySelector('[data-medal-grant]').textContent='確認授予 '+players.length+' 位玩家';root.querySelector('[data-medal-grant-status]').textContent=summary+'\n請核對後，再按「確認授予」。';return;}
  if(!active(d))return;d.saving=true;const button=root.querySelector('[data-medal-grant]');button.disabled=true;
  try{
   const result=await api({op:d.player?'achievementManualGrant':'achievementManualGrantBatch',...requestTarget(d.target),
    ...(d.player?{playerId:d.player.id}:{playerIds:players}),code:d.row.code,reason,...(showDay?{showDay}:{}),...(certificationAt?{certificationAt}:{})});
   if(!active(d))return;if(result?.ok!==true)throw Error('授予結果尚未確認');
   d.confirmation=null;d.selected.clear();d.roomCache.clear();d.evidenceEpoch++;d.evidenceCache.clear();d.evidencePending.clear();root.querySelector('[data-medal-grant-status]').textContent=d.player?(result.alreadyRecorded?'已有紀錄，未重複授予':'已授予此玩家'):'已授予 '+result.granted+' 位；已有紀錄 '+result.alreadyRecorded+' 位';
   if(d.player){d.row={...d.row,qualified:true,recorded:true,revoked:false,revokedAt:null,manualVerified:!result.alreadyRecorded||d.row.manualVerified,currentActive:d.row.lifetime==='permanent'?true:null};button.textContent='此玩家已獲得';}
   else{await list('recipients',d.pages.recipients||0);if(root.querySelector('[data-medal-list-panel="candidates"]')?.textContent)await list('candidates',d.pages.candidates||0);selection();}
   const updated=await onChange();
   if(active(d)&&d.player){const latest=updated?.manager&&updated.rows?.find(r=>r.code===d.row.code&&(r.qualified||r.recorded));if(latest)d.row=latest;const details=root.querySelector('[data-medal-management-body] .medal-details');if(details)details.outerHTML=achievementDetailsHtml(d.row,{manager:true});}
   await load(true);
  }finally{d.saving=false;if(active(d))button.disabled=!!d.player||!d.selected.size;}
 }
 root.addEventListener('change',async e=>{
  const t=e.target;
  if(t.matches('[data-medal-target-scope], [data-medal-target-room]')){
   e.stopImmediatePropagation();if(!isSuper||dialog?.saving)return;closeDialog();
   if(t.matches('[data-medal-target-scope]')){if(!['global','streamer','radio'].includes(t.value))return;targetScope=t.value;paint(root.querySelector('#medal-management'));}
   else{const room=rooms[Number(t.value)];if(!room)return;chosenRoom={...room};await load();}return;
  }
  if(t.matches('#medal-management [data-medal-filter]')){e.stopImmediatePropagation();category=t.value;paint(root.querySelector('#medal-management'));return;}
  if(t.matches('#medal-management [data-achievement-code]')){
   e.stopImmediatePropagation();const key=identity(),tk=targetKey(),r={...target()};t.disabled=true;try{await api({op:'achievementVisibility',code:t.dataset.achievementCode,visibility:t.value,...requestTarget(r)});if(key!==identity()||tk!==targetKey())return;await onChange();await load(true);}catch(e){error(e);await load(true);}finally{t.disabled=false;}return;
  }
  if(t.matches('[data-medal-pick]')&&active(dialog)&&!dialog.saving){
   if(t.checked){if(dialog.selected.size>=50){t.checked=false;toast('每批最多 50 位，請分批操作');return;}dialog.selected.set(t.dataset.medalPick,t.dataset.name);}else dialog.selected.delete(t.dataset.medalPick);selection();
  }
 });
 function syncChecks(){root.querySelectorAll?.('[data-medal-pick]').forEach(t=>{t.checked=dialog.selected.has(t.dataset.medalPick);});selection();}
 root.addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.matches('#medal-management [data-medal-detail]')){e.preventDefault();e.stopImmediatePropagation();open(rows[Number(t.dataset.medalDetail)]);return;}
  if(t.hasAttribute('data-medal-select-page')||t.hasAttribute('data-medal-clear-selection')){e.preventDefault();if(!active(dialog)||dialog.saving)return;
   if(t.hasAttribute('data-medal-clear-selection'))dialog.selected.clear();else{const additions=(dialog.candidates||[]).filter(p=>!p.earned&&!dialog.selected.has(p.playerId));if(dialog.selected.size+additions.length>50){toast('每批最多 50 位，請分批操作');return;}for(const p of additions)dialog.selected.set(p.playerId,p.name);}syncChecks();return;
  }
  if(t.dataset.medalRevoke){e.preventDefault();revoke(t.dataset.medalRevoke).catch(error);return;}
  if(t.dataset.medalEvidence){e.preventDefault();const panel=root.querySelector('[data-medal-evidence-panel="'+t.dataset.medalEvidence+'"]');if(panel){if(!panel.hidden)panel.hidden=true;else evidenceList(t.dataset.medalEvidence);}return;}
  if(t.dataset.medalExpand){e.preventDefault();const panel=root.querySelector('[data-medal-rooms="'+t.dataset.medalExpand+'"]');if(panel){if(!panel.hidden)panel.hidden=true;else roomList(t.dataset.medalExpand);}return;}
  if(t.dataset.medalList){e.preventDefault();list(t.dataset.medalList,Number(t.dataset.page)||0);return;}
  if(t.dataset.medalSearch){e.preventDefault();if(!active(dialog))return;const k=t.dataset.medalSearch;dialog.queries[k]=root.querySelector('[data-medal-query="'+k+'"]').value;list(k);return;}
  if(t.dataset.medalJumpButton){e.preventDefault();jump(t.dataset.medalJumpButton);return;}
  if(t.hasAttribute('data-medal-grant')){e.preventDefault();grant().catch(error);}
 });
 function jump(kind){const input=root.querySelector('[data-medal-jump="'+kind+'"]');if(input)list(kind,Math.max(0,Math.min(Number(input.max)-1,Math.floor(Number(input.value)||1)-1)));}
 root.addEventListener('keydown',e=>{if(e.key!=='Enter'||e.isComposing)return;const t=e.target;if(t.dataset.medalJump){e.preventDefault();jump(t.dataset.medalJump);}if(t.dataset.medalQuery){e.preventDefault();if(active(dialog)){dialog.queries[t.dataset.medalQuery]=t.value;list(t.dataset.medalQuery);}}});
 return {load,openPlayer:(row,player)=>open(row,player)};
}
