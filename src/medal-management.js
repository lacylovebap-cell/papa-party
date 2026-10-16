import {achievementPanelHtml,achievementDetailsHtml} from './achievements-view.js?v=10.16-WEB.3';
const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const modes={public:'公開',condition_hidden:'隱藏條件',hidden:'完全隱藏',after_award:'取得後公開'};
export function medalManagementPager(kind,total,page){
 const max=Math.max(1,Math.ceil(total/20));
 return '<div class="pagination" data-total-pages="'+max+'"><button type="button" data-medal-list="'+kind+'" data-page="'+Math.max(0,page-1)+'" '+(page?'':'disabled')+'>上一頁</button><span>第 '+(page+1)+' / 共 '+max+' 頁 · '+total+' 位</span><input type="number" data-medal-jump="'+kind+'" aria-label="勳章名單頁碼" min="1" max="'+max+'" value="'+(page+1)+'"><button type="button" data-medal-jump-button="'+kind+'">跳頁</button><button type="button" data-medal-list="'+kind+'" data-page="'+(page+1)+'" '+(page+1<max?'':'disabled')+'>下一頁</button></div>';
}
export function medalGrantHtml(row,player=null){
 if(row.scope==='global')return '<p class="subtle">全站勳章由系統統一管理，不開放主播授予。</p>';
 if(!['permanent','show'].includes(row.lifetime))return '<p class="subtle">此勳章的手動授予到期規則尚待確認。</p>';
 if(player&& (row.qualified||row.recorded))return '<p>此玩家已獲得，無須重複授予。</p>';
 return '<section class="medal-grant"><h3>手動授予勳章</h3>'+(player?'<p>目前玩家：'+h(player.name)+'</p>':'<button type="button" data-medal-list="candidates" data-page="0">選擇玩家</button><div data-medal-list-panel="candidates"></div>')+
  (row.lifetime==='show'?'<label>取得所屬場次<input type="date" data-medal-show-day required></label>':'')+
  '<label>授予原因／依據<textarea data-medal-grant-reason minlength="4" maxlength="500" placeholder="核對以前達成的紀錄"></textarea></label><button type="button" class="primary" data-medal-grant '+(!player?'disabled':'')+'>'+(player?'授予'+h(player.name)+'此勳章':'授予選取玩家（0 位）')+'</button><p data-medal-grant-status role="status"></p></section>';
}
export function createMedalManagement({api,context,root=document,modal,toast,onChange=()=>{},confirmGrant=null}){
 let rows=[],stamp='',cacheAt=0,generation=0,dialog=null,category='all',scope='all',catalogPending=null;
 const identity=()=>{const c=context();return c.active?JSON.stringify([c.spaceId,c.room,c.actorKey]):'';};
 const active=d=>dialog===d&&d.identity===identity()&&root.querySelector('#dialog')?.open
  &&d.node&&root.querySelector('[data-medal-management-body]')===d.node
  &&(!d.player||context().playerId===d.player.id);
 const error=e=>toast(e.message);
 async function load(force=false){
  if(dialog&&(dialog.identity!==identity()||dialog.player&&context().playerId!==dialog.player.id)){
   if(root.querySelector('[data-medal-management-body]')===dialog.node)root.querySelector('#dialog')?.close?.();
   dialog=null;
  }
  const panel=root.querySelector('#medal-management');if(!panel)return;
  const key=identity();if(!key){panel.textContent='請先登入管理';return;}
  const rev=key+'|'+context().revision;
  if(!force&&stamp===rev&&Date.now()-cacheAt<60000){paint(panel);return;}
  if(!force&&catalogPending?.key===rev)return catalogPending.promise;
  const g=++generation;panel.textContent='讀取勳章管理中…';
  const promise=(async()=>{try{
   const result=await api({op:'achievementManagement',view:'catalog'});
   if(g!==generation||key!==identity())return;
   if(result?.version!==1||result.scope?.spaceId!==context().spaceId||result.scope?.streamerId!==context().room||!Array.isArray(result.rows)||result.rows.length>100)throw Error('勳章管理範圍尚未確認');
   rows=result.rows;stamp=rev;cacheAt=Date.now();paint(root.querySelector('#medal-management'));
  }catch(e){if(g===generation&&key===identity()&&root.querySelector('#medal-management'))root.querySelector('#medal-management').textContent=e.message;}
  finally{if(catalogPending?.generation===g)catalogPending=null;}})();
  catalogPending={key:rev,generation:g,promise};return promise;
 }
 function paint(panel){if(panel)panel.innerHTML=achievementPanelHtml(rows,{manager:true,managementCatalog:true,category,scope});}
 async function list(kind,page=0){
  const d=dialog;if(!active(d)||d.player)return;
  const panel=root.querySelector('[data-medal-list-panel="'+kind+'"]');if(!panel)return;
  const g=++d.generations[kind],query=d.queries[kind]||'';panel.textContent='讀取中…';
  try{
   const result=await api({op:'achievementManagement',view:kind,code:d.row.code,query,page});
   if(!active(d)||g!==d.generations[kind])return;
   if(result?.version!==1||result.scope?.spaceId!==context().spaceId||result.scope?.streamerId!==context().room||!Array.isArray(result.rows)||result.rows.length>20||!Number.isSafeInteger(result.total)||result.total<0||result.page!==page)throw Error('勳章名單尚未確認');
   const max=Math.max(1,Math.ceil(result.total/20));if(page>=max)return list(kind,max-1);
   d.pages[kind]=page;if(kind==='recipients'){d.row.recipientCount=result.total;const total=root.querySelector('[data-medal-recipient-total]');if(total)total.textContent=String(result.total);}
   panel.innerHTML='<div class="medal-list-search"><input type="search" data-medal-query="'+kind+'" maxlength="100" value="'+h(query)+'" placeholder="搜尋玩家暱稱"><button type="button" data-medal-search="'+kind+'">搜尋</button></div>'+result.rows.map(p=>'<div class="medal-recipient">'+(kind==='candidates'?'<input type="checkbox" data-medal-pick="'+h(p.playerId)+'" data-name="'+h(p.name)+'" aria-label="選取'+h(p.name)+'" '+(p.earned?'disabled':d.selected.has(p.playerId)?'checked':'')+'>':'')+'<div><strong>'+h(p.name)+'</strong><small>'+(p.earned?'已獲得':'未獲得')+(kind==='recipients'?' · '+h(p.source)+(p.acquiredAt?' · '+h(new Date(p.acquiredAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})):' · 取得時間無紀錄')+' · '+(p.currentActive==null?'狀態待核對':p.currentActive?'目前有效':'目前未生效'):'')+'</small></div></div>').join('')+(result.rows.length?'':'<p>尚無符合的玩家</p>')+medalManagementPager(kind,result.total,page);
  }catch(e){if(active(d)&&g===d.generations[kind])panel.textContent=e.message;}
 }
 function open(row,player=null){
  if(!identity())return;
  dialog={identity:identity(),row,player,selected:new Map(),queries:{},pages:{},generations:{recipients:0,candidates:0},saving:false};
  modal(player?'玩家勳章':'勳章詳細管理','<div data-medal-management-body>'+(player?'<p>目前玩家：'+h(player.name)+'</p>':'')+achievementDetailsHtml(row,{manager:true,managementCatalog:!player})+'<p>顯示方式：'+h(modes[row.visibility])+'</p>'+
   (player||row.scope==='global'?'':'<section><h3>已獲得此勳章的玩家</h3><div data-medal-list-panel="recipients"></div></section>')+medalGrantHtml(row,player)+'</div>');
  dialog.node=root.querySelector('[data-medal-management-body]');
  if(!player&&row.scope!=='global')list('recipients');
 }
 async function grant(){
  const d=dialog;if(!active(d)||d.row.scope==='global'||d.saving||d.player&&(d.row.qualified||d.row.recorded))return;
  const players=d.player?[d.player.id]:[...d.selected.keys()];
  if(players.length<1||players.length>50)throw Error('請選擇 1～50 位玩家');
  const reason=root.querySelector('[data-medal-grant-reason]')?.value.trim()||'',showDay=root.querySelector('[data-medal-show-day]')?.value;
  if(reason.length<4||reason.length>500)throw Error('請填寫 4～500 字的授予依據');
  if(d.row.lifetime==='show'&&!showDay)throw Error('請填取得所屬場次');
  const confirmation=JSON.stringify([d.identity,d.row.code,players.slice().sort(),reason,showDay||'']);
  if(confirmGrant){if(!confirmGrant('確認將「'+d.row.name+'」授予 '+players.length+' 位玩家？'))return;}
  else if(d.confirmation!==confirmation){
   d.confirmation=confirmation;root.querySelector('[data-medal-grant]').textContent='確認授予 '+players.length+' 位玩家';
   root.querySelector('[data-medal-grant-status]').textContent='請確認勳章、'+(d.player?d.player.name:players.length+' 位選取玩家')+'及授予依據，再按確認授予。';return;
  }
  if(!active(d))return;const beforeRevision=context().revision;d.saving=true;const button=root.querySelector('[data-medal-grant]');button.disabled=true;
  try{
   const result=await api({op:d.player?'achievementManualGrant':'achievementManualGrantBatch',
    ...(d.player?{playerId:d.player.id}:{playerIds:players}),code:d.row.code,reason,...(showDay?{showDay}:{})});
   if(!active(d))return;if(result?.ok!==true)throw Error('授予結果尚未確認');
   d.confirmation=null;d.selected.clear();root.querySelector('[data-medal-grant-status]').textContent=d.player?(result.alreadyRecorded?'已有紀錄，未重複授予':'已授予此玩家'):'已授予 '+result.granted+' 位；已有紀錄 '+result.alreadyRecorded+' 位';
   if(d.player){d.row={...d.row,qualified:true,recorded:true,manualVerified:!result.alreadyRecorded||d.row.manualVerified,currentActive:d.row.lifetime==='permanent'?true:null};button.textContent='此玩家已獲得';}
   else{button.textContent='授予選取玩家（0 位）';await list('recipients',d.pages.recipients||0);if(root.querySelector('[data-medal-list-panel="candidates"]')?.textContent)await list('candidates',d.pages.candidates||0);}
   const updated=await onChange();
   if(active(d)&&d.player){
    const latest=updated?.manager&&updated.rows?.find(r=>r.code===d.row.code&&(r.qualified||r.recorded));if(latest)d.row=latest;
    const details=root.querySelector('[data-medal-management-body] .medal-details');if(details)details.outerHTML=achievementDetailsHtml(d.row,{manager:true});
   }
   await load(context().revision===beforeRevision);
  }finally{d.saving=false;if(active(d))button.disabled=!!d.player||!d.selected.size;}
 }
 root.addEventListener('change',async e=>{
  const t=e.target;
  if(t.matches('#medal-management [data-medal-filter]')){e.stopImmediatePropagation();if(t.dataset.medalFilter==='scope')scope=t.value;else category=t.value;paint(root.querySelector('#medal-management'));return;}
  if(t.matches('#medal-management [data-achievement-code]')){
   e.stopImmediatePropagation();const key=identity(),beforeRevision=context().revision;t.disabled=true;try{await api({op:'achievementVisibility',code:t.dataset.achievementCode,visibility:t.value});if(key!==identity())return;await onChange();await load(context().revision===beforeRevision);}catch(e){error(e);await load(true);}finally{t.disabled=false;}return;
  }
  if(t.matches('[data-medal-pick]')&&active(dialog)&&!dialog.saving){
   if(t.checked){if(dialog.selected.size>=50){t.checked=false;toast('每批最多 50 位');return;}dialog.selected.set(t.dataset.medalPick,t.dataset.name);}else dialog.selected.delete(t.dataset.medalPick);
   const b=root.querySelector('[data-medal-grant]');b.disabled=!dialog.selected.size;b.textContent='授予選取玩家（'+dialog.selected.size+' 位）';
  }
 });
 root.addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.matches('#medal-management [data-medal-detail]')){e.preventDefault();e.stopImmediatePropagation();open(rows[Number(t.dataset.medalDetail)]);return;}
  if(t.dataset.medalList){e.preventDefault();list(t.dataset.medalList,Number(t.dataset.page)||0);return;}
  if(t.dataset.medalSearch){e.preventDefault();if(!active(dialog))return;const k=t.dataset.medalSearch;dialog.queries[k]=root.querySelector('[data-medal-query="'+k+'"]').value;list(k);return;}
  if(t.dataset.medalJumpButton){e.preventDefault();jump(t.dataset.medalJumpButton);return;}
  if(t.hasAttribute('data-medal-grant')){e.preventDefault();grant().catch(error);}
 });
 function jump(kind){const input=root.querySelector('[data-medal-jump="'+kind+'"]');if(input)list(kind,Math.max(0,Math.min(Number(input.max)-1,Math.floor(Number(input.value)||1)-1)));}
 root.addEventListener('keydown',e=>{if(e.key!=='Enter'||e.isComposing)return;const t=e.target;if(t.dataset.medalJump){e.preventDefault();jump(t.dataset.medalJump);}if(t.dataset.medalQuery){e.preventDefault();if(active(dialog)){dialog.queries[t.dataset.medalQuery]=t.value;list(t.dataset.medalQuery);}}});
 return {load,openPlayer:(row,player)=>open(row,player)};
}
