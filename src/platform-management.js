import {groupManagementRoles,managementRoleLabel} from './management-role-groups.js?v=10.25-ADMIN.2';
import {pricingEditorHtml,pricingBasicsHtml,pricingDraft,readPricingForm,changePricingDraft,forSave} from './space-pricing-editor.js?v=10.29-SPACE.1';
// The management centre uses the existing Account, Space and streamer registry.
// No operational player or accounting snapshots are downloaded here.
const sections=[['all-spaces','全部空間'],['hall-spaces','廳'],['independent-spaces','獨立主播'],['overview','總覽'],['halls','廳與租戶管理'],['streamers','主播管理'],['accounts','管理帳號'],['cleanup','停用與清理']];
const mainAreas=new Set(['all-spaces','hall-spaces','independent-spaces','accounts']);
const spaceCategories={'all-spaces':'all','hall-spaces':'hall','independent-spaces':'independent'};
const capabilitySection=id=>Object.hasOwn(spaceCategories,id)?'halls':id;
const permissions=[['songs','歌曲'],['queue','待播'],['players','玩家'],['announcements','公告'],['streamers','主播'],['reports','報表'],['administrators','管理員']];
const accountKinds={president:'平台總裁',streamer:'主播登入帳號',player:'玩家帳號',account:'管理帳號'};
const roleNames={space_admin:'廳管理員',streamer_admin:'主播'};
const initial=()=>({section:'all-spaces',spaceId:null,q:'',page:1,pages:1,total:0,rows:[],summary:null,registryRevision:null,loaded:false,loading:false,saving:false,error:'',editor:null,accountTarget:null});
const validPage=r=>r&&Array.isArray(r.rows)&&r.rows.length<=20&&Number.isSafeInteger(r.total)&&r.total>=r.rows.length&&Number.isSafeInteger(r.page)&&Number.isSafeInteger(r.pages)&&r.page>=1&&r.pages>=r.page;
const slugRule='小寫英文、數字或減號，最多 40 字，開頭需為英數';
export function createPlatformManagement({api,identity,escape:h,changed,capabilities,confirm=globalThis.confirm,uuid=()=>crypto.randomUUID(),openStreamerAdmin=null,streamerHome=null}){
 let model=initial(),owner=null,generation=0,detailGeneration=0,lookupGeneration=0,writeKey=null,dialog=null,dialogMarkup='',dialogKey='',returnFocus=null,lastDialogError='';
 // Omitted capabilities preserve the original president-only integration.
 // An explicit empty/pending session is denied until the server verifies it.
 const caps=()=>capabilities===undefined?{allowed:true,president:true}:typeof capabilities==='function'?capabilities()||{}:capabilities||{};
 const allowed=()=>!!identity()&&caps().president===true;
 const president=()=>allowed()&&caps().president===true;
 const can=name=>allowed()&&(president()||caps().permissions?.[name]===true);
 const visibleSections=()=>sections.filter(([id])=>allowed()&&(Object.hasOwn(spaceCategories,id)||id==='overview'||id==='halls'&&(can('streamers')||can('administrators'))||['streamers','cleanup'].includes(id)&&can('streamers')||id==='accounts'&&can('administrators'))&&(!Array.isArray(caps().sections)||caps().sections.includes(capabilitySection(id))));
 const current=(actor,ticket)=>identity()===actor&&generation===ticket&&allowed();
 const canEditSpace=detail=>president()||detail?.canEditSpace===true;
 const canManageMembers=detail=>can('administrators')&&detail?.canManageMemberships===true;
 const canMutate=(name)=>president()||name==='edit'&&canEditSpace(model.editor?.detail)||name==='membership'&&canManageMembers(model.editor?.detail)||['archive_streamer','restore_streamer'].includes(name)&&can('streamers');
 const notify=()=>changed();
 const clear=()=>{model=initial();owner=null;generation++;detailGeneration++;lookupGeneration++;writeKey=null;removeDialog();};
 const operationFor=fingerprint=>{if(!writeKey||writeKey.fingerprint!==fingerprint)writeKey={fingerprint,id:uuid()};return writeKey.id;};
 async function load({section=model.section,q=model.q,page=model.page,accountTarget=null,spaceId=model.spaceId}={}){
  if(!visibleSections().some(([key])=>key===section)||typeof q!=='string'||q.length>100||!Number.isSafeInteger(page)||page<1)return;
  const actor=identity(),ticket=++generation;owner=actor;detailGeneration++;
  model={...model,section,q,page,spaceId,rows:[],loading:true,loaded:false,saving:false,error:'',editor:null,accountTarget};notify();
  try{if(!actor)throw Error('請先登入管理帳號');let result;if(Object.hasOwn(spaceCategories,section)){result=await api({op:'platformSpaceDirectory',management:true,category:spaceCategories[section],q,page,spaceId});}else if(section==='accounts'&&president()){result=await api({op:'platformAccounts',management:true,q,page});}else result=await api({op:'platformManagementDirectory',management:true,section,q,page});if(!current(actor,ticket))return;if(!validPage(result))throw Error('管理清單資料尚未確認');model={...model,...result,loaded:true,loading:false};}
  catch(error){if(!current(actor,ticket))return;model={...model,loading:false,error:error.message};}notify();
 }
 async function openDetail(row,extra={}){
  if(!row||model.saving||!identity()||!allowed())return;const accountTarget=model.accountTarget;model.accountTarget=null;
  const actor=identity(),ticket=++detailGeneration;owner=actor;model={...model,error:'',editor:{type:'detail',row,loading:true}};notify();
  try{const detail=await api({op:'platformManagementDetail',management:true,spaceId:row.spaceId||row.id,streamerId:row.spaceId?row.id:null,q:'',page:1});if(identity()!==actor||ticket!==detailGeneration||!allowed())return;
   if(!detail?.space||detail.space.id!==(row.spaceId||row.id)||!Array.isArray(detail.memberships)||(detail.membershipPageUnit==='account'?new Set(detail.memberships.map(m=>m.accountId)).size>20||detail.memberships.length>2000:detail.memberships.length>20))throw Error('管理範圍尚未確認');
   const target=accountTarget||extra.account;
   const bindRole=row.spaceId?'streamer_admin':'space_admin';
   const preset=canManageMembers(detail)&&(target||extra.bind)?{binding:!!extra.bind,member:{...(target?{accountId:target.id,name:target.name}:{}),role:bindRole,streamerId:row.spaceId?row.id:undefined,permissions:[]},
    draft:{...(target?{accountId:target.id,accountName:accountName(target.managerKey,target.name)}:{}),role:bindRole,status:'active',permissions:rolePermissions(bindRole)}}:{};
   model.editor={type:'detail',row,detail,loading:false,...preset};
  }catch(error){if(identity()!==actor||ticket!==detailGeneration||!allowed())return;model.error=error.message;model.editor=null;}notify();
 }
 async function mutate(action,payload){
  if(model.saving||!identity()||!canMutate(action))return false;
  const actor=identity(),ticket=generation,id=operationFor(JSON.stringify({action,payload}));
  model={...model,saving:true,error:''};notify();
  try{await api({op:'platformManageSpace',management:true,operationId:id,action,payload});if(!current(actor,ticket))return false;writeKey=null;model.saving=false;await load();return true;}
  catch(error){if(!current(actor,ticket))return false;model={...model,saving:false,error:error.message};notify();return false;}
 }
 // One server operation per confirmed form. The same operation ID is reused for
 // an uncertain retry with identical input; a changed form gets a new ID.
 async function write(body,onSuccess){
  if(model.saving||!identity()||!president())return null;
  const actor=identity(),ticket=generation,detailTicket=detailGeneration,id=operationFor(JSON.stringify(body));
  model={...model,saving:true,error:''};notify();
  try{const result=await api({...body,management:true,operationId:id});if(!current(actor,ticket)||detailTicket!==detailGeneration)return null;writeKey=null;model.saving=false;onSuccess?.(result);notify();void refresh();return result;}
  catch(error){if(current(actor,ticket)&&detailTicket===detailGeneration){model={...model,saving:false,error:error.message};notify();}return null;}
 }
 // Refresh the list behind an open dialog without closing it.
 async function refresh(){
  const actor=identity(),ticket=generation,section=model.section;
  try{const result=Object.hasOwn(spaceCategories,section)?await api({op:'platformSpaceDirectory',management:true,category:spaceCategories[section],q:model.q,page:model.page,spaceId:model.spaceId}):section==='accounts'&&president()?await api({op:'platformAccounts',management:true,q:model.q,page:model.page}):null;
   if(result&&current(actor,ticket)&&validPage(result)){model={...model,...result,loaded:true};notify();}}catch{}
 }
 async function openLogin(row){
  if(!row||model.saving||!identity()||!president())return;model.accountTarget=null;const actor=identity(),ticket=++detailGeneration;owner=actor;model={...model,error:'',editor:{type:'credentials',row,loading:true}};notify();
  try{const value=await api({op:'platformStreamerLoginStatus',management:true,spaceId:row.spaceId,streamerId:row.id});if(identity()!==actor||ticket!==detailGeneration||!allowed())return;
   if(typeof value?.exists!=='boolean'||typeof value?.enabled!=='boolean')throw Error('主播登入狀態尚未確認');model.editor={type:'credentials',row,credentials:value,draft:{enabled:value.exists?value.enabled:true}};
  }catch(error){if(identity()!==actor||ticket!==detailGeneration||!allowed())return;model.error=error.message;model.editor=null;}notify();
 }
 async function openReadiness(row){
  if(!row||model.saving||!identity()||!president())return;const actor=identity(),ticket=++detailGeneration;owner=actor;model={...model,error:'',editor:{type:'readiness',row,loading:true}};notify();
  try{const value=await api({op:'platformSpaceReadiness',management:true,spaceId:row.id});if(identity()!==actor||ticket!==detailGeneration||!allowed())return;
   if(!Array.isArray(value?.items))throw Error('營運設定狀態尚未確認');model.editor={type:'readiness',row,readiness:value};
  }catch(error){if(identity()!==actor||ticket!==detailGeneration||!allowed())return;model.error=error.message;model.editor=null;}notify();
 }
 // 價目設定: one record per Space; the editor opens on the revision it read.
 async function openPricing(target){
  if(!target?.id||model.saving||!identity()||!president())return;model.accountTarget=null;const actor=identity(),ticket=++detailGeneration;owner=actor;writeKey=null;
  model={...model,error:'',editor:{type:'pricing',row:target,loading:true}};notify();
  try{const value=await api({op:'platformSpacePricing',management:true,spaceId:target.id});if(identity()!==actor||ticket!==detailGeneration||!allowed())return;
   if(value?.spaceId!==target.id||!value.pricing||!Number.isSafeInteger(value.revision)||!Number.isInteger(value.rolloverHour))throw Error('價目設定尚未確認');
   model.editor={type:'pricing',row:{...target,name:value.name||target.name},info:{spaceId:value.spaceId,name:value.name||target.name,kind:value.kind,revision:value.revision,stored:value.stored===true},draft:pricingDraft(value.pricing,value.rolloverHour),preview:false};
  }catch(error){if(identity()!==actor||ticket!==detailGeneration||!allowed())return;model.error=error.message;model.editor=null;}notify();
 }
 async function openDelete(row){
  if(!row||model.saving||!identity()||!president())return;const actor=identity(),ticket=++detailGeneration;owner=actor;model={...model,error:'',editor:{type:'delete',row,loading:true}};notify();
  try{const report=await api({op:'platformDeleteReview',management:true,spaceId:row.spaceId||row.id,streamerId:row.spaceId?row.id:null});if(identity()!==actor||ticket!==detailGeneration||!allowed())return;
   if(!report?.target||!Array.isArray(report.blockers)||!Array.isArray(report.removes)||typeof report.safeToDelete!=='boolean'||!/^[a-f0-9]{32}$/.test(report.confirmationToken||''))throw Error('刪除檢查結果尚未確認');
   model.editor={type:'delete',row,report};
  }catch(error){if(identity()!==actor||ticket!==detailGeneration||!allowed())return;model.error=error.message;model.editor=null;}notify();
 }
 async function lookupAccounts(target,{q='',page=1}={}){
  if(!model.editor||!can('administrators')||!['ownerAccountId','accountId'].includes(target)||typeof q!=='string'||q.length>100||!Number.isSafeInteger(page)||page<1)return;
  const actor=identity(),ticket=++lookupGeneration,detailTicket=detailGeneration,pageTicket=generation;
  model.editor={...model.editor,lookup:{target,q,page,rows:[],loading:true,total:0,pages:1}};notify();
  try{const result=await api(president()?{op:'platformAccounts',management:true,q,page}:{op:'platformManagementDirectory',management:true,section:'accounts',q,page});if(!current(actor,pageTicket)||ticket!==lookupGeneration||detailTicket!==detailGeneration||!model.editor)return;
   if(!validPage(result))throw Error('帳號搜尋結果尚未確認');model.editor={...model.editor,lookup:{...result,target,q,loading:false}};
  }catch(error){if(!current(actor,pageTicket)||ticket!==lookupGeneration||detailTicket!==detailGeneration||!model.editor)return;model.editor={...model.editor,lookup:{...model.editor.lookup,loading:false,error:error.message}};}notify();
 }
 const rolePermissions=role=>role==='streamer_admin'?['songs','queue','players','announcements','reports']:permissions.map(([id])=>id);
 const memberPermissions=member=>member?.id?(member.permissionsExplicit===false?member.effectivePermissions||[]:member.permissions||[]):rolePermissions(draft('role',member?.role||'space_admin'));
 const draft=(name,value)=>Object.hasOwn(model.editor?.draft||{},name)?model.editor.draft[name]:value;
 const field=(name,label,value='',extra='')=>`<label>${label}<input name="${name}" value="${h(draft(name,value)??'')}" ${extra}></label>`;
 const secret=(name,label,extra='')=>`<label>${label}<input name="${name}" type="password" minlength="4" maxlength="72" autocomplete="new-password" ${extra}></label>`;
 const check=(name,label,value)=>`<label class="pm-check"><input type="checkbox" name="${name}" ${draft(name,value)?'checked':''}>${label}</label>`;
 const select=(name,label,values,value)=>`<label>${label}<select name="${name}" ${name==='role'?'data-prior-role="'+h(draft(name,value))+'"':''}>${values.map(([key,text])=>`<option value="${h(key)}" ${key===draft(name,value)?'selected':''}>${text}</option>`).join('')}</select></label>`;
 function captureDraft(form,f){if(form?.dataset?.pmForm==='pricing'){if(model.editor?.type==='pricing'&&model.editor.draft)model.editor={...model.editor,draft:readPricingForm(form,model.editor.draft)};return;}const values=Object.fromEntries([...f].filter(([key])=>!['password','passwordConfirm'].includes(key)));for(const input of form.querySelectorAll('input[type="checkbox"]'))values[input.name]=input.name==='permissions'?f.getAll(input.name):f.has(input.name);if(model.editor)model.editor={...model.editor,draft:{...(model.editor.draft?.ownerAccountName?{ownerAccountName:model.editor.draft.ownerAccountName}:{}),...(model.editor.draft?.accountName?{accountName:model.editor.draft.accountName}:{}),...values}};}
 const action=(name,label,id='',extra='')=>`<button type="button" data-pm-action="${name}" data-pm-id="${h(id)}" ${model.saving||/\bdisabled\b/.test(extra)?'disabled':''} ${extra.replace(/\bdisabled\b/g,'')}>${label}</button>`;
 const danger=(name,label,id='')=>action(name,label,id,'class="pm-danger"');
 const accountLookupButton=target=>action('lookup-accounts','搜尋管理帳號',target);
 const hidden=(name,value)=>`<input type="hidden" name="${name}" value="${h(draft(name,value)??'')}">`;
 const publicLabel=row=>row?.displayNumber||row?.publicCode||row?.accountNumber||'';
 const accountName=(value,name)=>[name,value].find(candidate=>typeof candidate==='string'&&candidate.trim()&&!/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(candidate))||'未命名管理帳號';
 const selectedAccount=(name,label,value,display)=>`<div class="pm-selected-account"><span>${label}</span><strong>${h(!draft(name,value)?'尚未選擇':accountName('',display))}</strong>${hidden(name,value)}</div>`;
 const formActions=(label='儲存')=>`<div class="pm-actions"><button type="button" data-pm-action="close-editor" ${model.saving?'disabled':''}>取消</button><button type="submit" ${model.saving?'disabled':''}>${model.saving?'處理中…':label}</button></div>`;
 const kindLabel=kind=>kind==='hall'?'廳':kind==='independent'?'獨立主播空間':'待確認類型';
 const loginPassword=(required)=>`<fieldset class="pm-login"><legend>登入帳號</legend>${secret('password',required?'登入密碼':'登入密碼（留空則先不建立登入）',required?'required':'')}${secret('passwordConfirm','再次輸入密碼',required?'required':'')}${check('loginEnabled','允許使用此帳號登入後台',true)}<p class="muted">登入代碼與密碼使用平台原有的主播登入機制，密碼不會顯示或保存在操作紀錄中。</p></fieldset>`;
 const rowsWithHosts=()=>model.rows.flatMap(r=>[r,...(r.hosts||[])]);
 function successHtml(e){const s=e.success,row=s.row;return `<div class="pm-editor pm-success" role="status"><p class="pm-success-title">✓ ${h(s.title)}</p>${s.lines.map(line=>`<p>${line}</p>`).join('')}${row&&!row.operational||s.space&&s.space.id!=='space-001'?'<p class="muted">此空間的營運功能（歌本、點歌、存歌、帳務）屬第 2 批開放項目，開放前不會與聲瑪資料混用。</p>':''}<div class="pm-actions">${row&&row.operational&&openStreamerAdmin?action('enter-admin','進入管理後台',row.id):''}${s.space&&president()?action('pricing-new','繼續設定價目',s.space.id):''}${action('close-editor','完成')}</div></div>`;}
 function dependencyHtml(report){const counts=report.entityCounts||report,labels=[['songs','歌曲'],['queue','待播／演唱紀錄'],['ledger','存歌／帳務'],['crowns','冠歌'],['cards','卡片'],['wishes','許願']];const unchecked={
 'shared catalog and version links':'共同曲庫與版本關聯','global player and favorite JSON references':'玩家與收藏關聯','medal grants and evidence':'勳章與取得紀錄','messages and notification receipts':'私訊與通知紀錄','payments and settlement links':'付款與結算關聯','device sessions and push subscriptions':'裝置登入與推播','release backups and historical JSON references':'備份與歷史關聯','indirect or unknown future relations':'其他間接關聯'};return `<div class="pm-editor">${action('close-dependencies','← 返回主播設定')}<p class="notice">${report.safeToDelete===true?'已完成資料依賴檢查；永久刪除仍需確認適用範圍。':'目前不能直接永久刪除。封存只隱藏入口，不代表歷史或關聯資料已經清空。'}</p><dl class="pm-dependency-list">${labels.map(([key,label])=>`<div><dt>${label}</dt><dd>${counts[key]??'未確認'}</dd></div>`).join('')}<div><dt>後台人員關聯</dt><dd>${report.memberships??'未確認'}</dd></div><div><dt>操作歷史</dt><dd>${report.auditPresent===true?'有，須保留':report.auditPresent===false?'本次檢查未發現':'未確認'}</dd></div><div><dt>已分享網址</dt><dd>${report.routeAliases??'未確認'}</dd></div></dl>${Array.isArray(report.unchecked)&&report.unchecked.length?`<h3>仍需確認</h3><ul>${report.unchecked.map(key=>`<li>${h(unchecked[key]||'其他資料關聯')}</li>`).join('')}</ul>`:''}<p class="muted">帳務、真實演唱與操作歷史需完整保留。檢查通過與永久刪除是分開的操作，本次檢查不會更改資料。</p></div>`;}
 const countText=item=>`${Number(item.count)||0}${item.capped?'+':''} 筆`;
 function deleteHtml(e){const r=e.report,t=r.target,isSpace=t.kind==='space';
  const list=(items,cls)=>items.length?`<ul class="pm-delete-list ${cls}">${items.map(item=>`<li><span>${h(item.label)}</span><b>${countText(item)}</b></li>`).join('')}</ul>`:'';
  if(!r.safeToDelete)return `<div class="pm-editor pm-delete"><p class="notice">${isSpace?'這個空間':'這位主播'}目前不能永久刪除，原因如下。系統不會連帶刪除其他主播、共用玩家帳號或共同曲庫。</p>${list(r.blockers,'pm-blockers')}
   ${Array.isArray(r.affectedStreamers)&&r.affectedStreamers.length?`<p class="muted">會受影響的主播：${r.affectedStreamers.map(s=>h(s.name)).join('、')}。請先在各主播卡片逐一刪除或移出，再回來刪除此廳。</p>`:''}
   <h3>可以先這樣處理</h3><ul class="pm-delete-help">${isSpace?'<li>停用空間：所有入口立即關閉，資料完整保留，之後仍可恢復。</li>':'<li>停用並封存：主播首頁與登入入口關閉、從一般清單隱藏，玩家存歌、帳務、演唱、勳章完整保留，之後可還原。</li>'}<li>含正式業務資料的永久刪除，需先完成「資料備份 → 驗證可還原 → 相依資料處理 → 再次確認」；這套備份驗證流程排在後續批次，屆時這裡會直接提供。</li></ul>
   <div class="pm-actions">${action('close-editor','關閉')}${isSpace?(e.row.status==='active'?action('delete-suspend','停用空間',e.row.id):''):e.row.archivedAt?'':action('delete-archive','停用並封存',e.row.id)}</div></div>`;
  return `<div class="pm-editor pm-delete"><form data-pm-form="delete"><p class="notice">已完成資料檢查：沒有玩家存歌、帳務、演唱、勳章或其他重要資料。確認後將<b>永久刪除</b>，無法從介面還原。</p>
   ${r.alsoRemovesStreamer?`<p>獨立主播空間會連同主播「${h(r.alsoRemovesStreamer.name)}」一起刪除。</p>`:''}
   <h3>將移除</h3>${list(r.removes,'pm-removes')}${r.keeps.length?`<h3>會保留（供追查，不可再使用）</h3>${list(r.keeps,'pm-keeps')}`:''}
   <label>請輸入「${h(t.name)}」確認刪除<input name="confirmedName" autocomplete="off" required maxlength="100" value="${h(draft('confirmedName',''))}"></label>
   <div class="pm-actions"><button type="button" data-pm-action="close-editor" ${model.saving?'disabled':''}>取消</button><button type="submit" class="pm-danger" ${model.saving?'disabled':''}>${model.saving?'刪除中…':'永久刪除'}</button></div></form></div>`;}
 function readinessHtml(e){const r=e.readiness;return `<div class="pm-editor pm-readiness"><p class="pm-context">${h(r.name)} · ${kindLabel(r.kind)} · ${r.status==='active'?'使用中':'尚未開放營運'}</p><ul class="pm-checklist">${r.items.map(item=>`<li class="${item.done?'done':'todo'}"><b>${item.done?'✓':'○'} ${h(item.label)}</b><small>${h(item.detail)}</small></li>`).join('')}</ul>
  <div class="pm-actions">${r.canActivate?action('activate-space','開放營運',r.spaceId,'class="pm-primary"'):''}${r.items.some(item=>item.code==='pricing'&&!item.done)?action('pricing','填寫價目',r.spaceId):''}${!r.hosts.length?action(r.kind==='independent'?'add-first-host':'add-hall-host',r.kind==='independent'?'建立主播資料與登入帳號':'＋新增廳內主播',r.spaceId):''}${r.hosts.filter(x=>!x.login).map(x=>action('credentials-by-id','建立「'+h(x.name)+'」的登入帳號',x.id)).join('')}${action('close-editor','關閉')}</div>
  <p class="muted">${r.canActivate?'開放營運後，主播可以登入後台、建立歌本與玩家，玩家用主播給的登入代碼登入點歌；之後可在「編輯管理權限」裡停用。':'系統只會自動完成可以安全處理的設定；不會為了移除提示而略過會員方案或權限，也不會開通未授權的功能。'}</p></div>`;}
 function credentialsHtml(e){const c=e.credentials,row=e.row;return `<div class="pm-editor"><p class="pm-context">主播：${h(row.name||row.slug||'主播')}<br>登入代碼：<b>${h(c.slug||row.slug||'尚未設定')}</b><br>目前狀態：${c.exists?(c.enabled?'已有登入帳號，可登入':'已有登入帳號，暫停登入'):'尚未建立登入帳號'}</p><form data-pm-form="credentials">${secret('password',c.exists?'設定新密碼（不更改請留空）':'登入密碼',c.exists?'':'required')}${secret('passwordConfirm','再次輸入密碼',c.exists?'':'required')}${check('enabled','允許此主播登入後台',c.exists?c.enabled:true)}<p class="muted">${c.exists?'儲存後，這位主播原本的後台登入會失效，需用新設定重新登入。':'建立後會同時建立此主播的管理帳號與授權，並可在「管理帳號」頁看到。'}只調整登入，不影響歌曲或玩家資料。</p>${formActions(c.exists?'儲存':'建立登入帳號')}</form></div>`;}
 function streamerFormHtml(e){const r=e.row||{},d=r.descriptor||{},editing=!!r.id;const spaceName=r.spaceName||'';
  return `<div class="pm-editor"><form data-pm-form="streamer"><p class="pm-context">${r.spaceKind==='independent'?'獨立主播空間':'所屬廳'}：${h(spaceName||'—')}</p>${hidden('spaceId',r.spaceId||'')}${field('display_name','主播名稱',d.display_name||r.name||(r.spaceKind==='independent'?spaceName:''),'required maxlength="100"')}${field('slug','登入代碼',d.slug||r.slug||'','required maxlength="40" pattern="[a-z0-9][a-z0-9-]{0,39}" autocapitalize="none" autocomplete="off"')}<p class="muted">登入代碼：${slugRule}。主播用它加上密碼登入後台；公開網址另由「專屬網址」設定。</p>${field('home_title','首頁名稱',d.home_title||'')}${field('subtitle','副標題',d.subtitle||'')}${check('active','開放主播首頁',d.active!==false)}${editing?'':loginPassword(false)}${formActions(editing?'儲存':'建立主播')}</form></div>`;}
 function createSpaceHtml(){const kind=draft('kind','hall');return `<div class="pm-editor"><form data-pm-form="create-space">${field('name',kind==='independent'?'獨立主播名稱':'廳名稱','','required maxlength="100"')}${select('kind','類型',[['hall','廳'],['independent','獨立主播']],'hall')}${kind==='independent'?`<p class="muted">獨立主播不需要選擇所屬廳。建立時會同時建立主播資料與專屬登入帳號。</p>${field('slug','登入代碼','','required maxlength="40" pattern="[a-z0-9][a-z0-9-]{0,39}" autocapitalize="none" autocomplete="off"')}<p class="muted">登入代碼：${slugRule}。</p>${loginPassword(true)}`:`<p class="muted">建立廳後，可在廳卡片直接「＋新增廳內主播」並同時建立主播帳號。</p><details><summary>現在指定負責人（選填）</summary>${selectedAccount('ownerAccountId','廳主／負責人','',''+(model.editor?.draft?.ownerAccountName||''))}${accountLookupButton('ownerAccountId')}</details>`}${pricingBasicsHtml(createBasics(),{h,legend:'價目基本設定'})}<p class="muted">每首價格、存歌方案與冠歌卡，建立後可在卡片的「價目設定」填寫。新空間會先保持「尚未開放營運」；營運功能開放前不會與聲瑪資料混用。</p>${formActions('建立')}</form></div>`;}
 // The create form keeps its typed values flat in the generic draft.
 function createBasics(){return {mode:draft('mode','double'),singleFee:draft('singleFee','host'),names:{singer:draft('names.singer','主播'),host:draft('names.host','主持'),hall:draft('names.hall','廳主號')},unit:draft('unit',''),rolloverHour:Number(draft('rolloverHour',19))||0};}
 function editorTitle(){const e=model.editor;if(!e)return '';if(e.success)return e.success.heading||'完成';if(e.dependencies)return `${e.row?.name||'主播'} · 資料檢查`;if(e.lookup)return '選擇管理帳號';if(e.loading)return '讀取中';if(e.type==='create-space')return '建立新廳／獨立主播';if(e.type==='pricing')return '價目設定 · '+(e.row?.name||'');if(e.type==='streamer')return e.row?.id?'編輯主播資料':'新增主播';if(e.type==='delete')return '刪除 · '+(e.row?.name||'');if(e.type==='readiness')return '營運啟用設定 · '+(e.row?.name||'');if(e.binding)return '綁定已有帳號 · '+(e.row?.name||'');if(e.member)return '編輯權限 · '+(e.member.name||'管理帳號');if(e.type==='credentials')return `${e.row.name||e.row.slug||'主播'} · ${e.credentials?.exists?'登入設定':'建立登入帳號'}`;if(e.type==='space-name')return '編輯資料 · '+(e.row?.name||'');return e.detail?.space?.name||'管理設定';}
 function memberFormHtml(e,d){const permissionOptions=Array.isArray(d.grantablePermissions)?permissions.filter(([id])=>d.grantablePermissions.includes(id)||e.member?.permissions?.includes(id)):permissions;const forStreamer=!!(e.member?.streamerId||d.streamer?.descriptor);
  return `<form data-pm-form="membership"><h3>${e.member?.id?'調整管理人員':e.binding?'選擇要綁定的帳號':'加入廳管理員／主播'}</h3>${selectedAccount('accountId','選擇帳號',e.member?.accountId||'',e.draft?.accountName||e.member?.name||e.member?.managerKey)}${accountLookupButton('accountId')}${select('role','身分',forStreamer?[['streamer_admin','主播'],['space_admin','廳管理員']]:[['space_admin','廳管理員']],e.member?.role||(forStreamer?'streamer_admin':'space_admin'))}${hidden('streamerId',e.member?.streamerId||d.streamer?.descriptor?.id||'')}${forStreamer?`<p class="muted">指定主播：${h(d.streamer?.descriptor?.display_name||e.row.name||'原有主播')}</p>`:'<p class="muted">若要加入主播身分，請從該主播卡片按「綁定已有帳號」。</p>'}${select('status','使用狀態',[['active','啟用'],['suspended','停用']],e.member?.status||'active')}<p class="muted">同一個帳號可以綁定多個空間，每個空間的權限分開設定。</p><details class="pm-advanced"><summary>進階：可操作的功能</summary><p class="muted">只勾選這位人員需要使用的項目。這不會授予平台總裁權限。</p><fieldset><legend>可使用功能</legend>${permissionOptions.map(([id,label])=>`<label class="pm-check"><input type="checkbox" name="permissions" value="${id}" ${draft('permissions',memberPermissions(e.member)).includes(id)?'checked':''}>${label}</label>`).join('')}</fieldset></details>${formActions(e.binding?'綁定':'儲存')}</form>`;}
 function editorHtml(){const e=model.editor;if(!e)return '';if(e.success)return successHtml(e);if(e.dependencies)return dependencyHtml(e.dependencies);if(e.loading)return '<div class="pm-editor" role="status">讀取詳細資料中…</div>';
  if(e.type==='create-space'&&president())return createSpaceHtml();
  if(e.type==='streamer'&&president())return streamerFormHtml(e);
  if(e.type==='credentials'&&president())return credentialsHtml(e);
  if(e.type==='delete'&&president())return deleteHtml(e);
  if(e.type==='readiness'&&president())return readinessHtml(e);
  if(e.type==='pricing'&&president()&&e.draft)return pricingEditorHtml(e,{h,button:action,saving:model.saving});
  if(e.type==='space-name'&&president())return `<div class="pm-editor"><form data-pm-form="edit-space-name">${field('name','廳／獨立主播名稱',e.row.name,'required maxlength="100"')}${formActions()}</form></div>`;
  const d=e.detail;if(!d)return '';const s=d.space,memberships=d.memberships||[];const canMembers=canManageMembers(d);const canSpace=canEditSpace(d);
  if(e.member&&canMembers)return `<div class="pm-editor">${e.binding?'':action('back-members','← 返回管理人員')}${memberFormHtml(e,d)}</div>`;
  return `<div class="pm-editor">${canSpace?`<form data-pm-form="edit-space">${field('name','廳／獨立主播名稱',s.name,'required maxlength="100"')}<div class="pm-actions"><button type="submit" ${model.saving?'disabled':''}>儲存名稱</button>${president()&&!s.provisioningPending?action(s.status==='active'?'suspend':'restore',s.status==='active'?'停用此廳':'恢復啟用'):''}</div></form>`:''}${s.provisioningPending?`<p class="muted">此空間尚未開放營運。${action('readiness-from-detail','查看營運啟用設定',s.id)}</p>`:''}<h3>廳主、廳管理員與主播</h3><p class="muted">相同帳號的職務集中在同一頁，每項職務分別管理。</p><p class="muted">廳主負責自己的廳；廳管理員協助管理該廳；主播只操作被指定的主播後台。這些身分都不會取得總裁權限。</p>${groupManagementRoles(memberships).map(group=>`<article class="pm-member"><b>${h(accountName(group.managerKey,group.name))}</b><small>${h(group.memberships.map(m=>managementRoleLabel(m,{ownerAccountId:s.ownerAccountId,spaceName:s.name})).join('、'))} · ${h(group.status==='active'?'使用中':group.status==='mixed'?'部分職務停用':'已停用')}</small>${publicLabel(group)?`<small>編號 ${h(publicLabel(group))}</small>`:''}${canMembers?`<details><summary>編輯權限</summary>${group.memberships.map(m=>`<div>${h(managementRoleLabel(m,{ownerAccountId:s.ownerAccountId,spaceName:s.name}))} · ${h(m.status==='active'?'使用中':'已停用')}${m.accountId===s.ownerAccountId&&m.role==='space_admin'?'<small>此廳負責人</small>':action('edit-membership','調整此職務',m.id)}</div>`).join('')}</details>`:''}</article>`).join('')||'<p>尚未設定管理人員。</p>'}<p>第 ${d.page||1} 頁／共 ${d.pages||1} 頁 · 共 ${d.total??memberships.length} ${d.membershipPageUnit==='account'?'位帳號':'筆職務'}</p>${d.pages>1?`<form data-pm-form="members-page">${field('page','頁碼',d.page,'type="number" min="1" max="'+d.pages+'" required')}<button type="submit">跳頁</button></form>`:''}${canMembers?memberFormHtml(e,d):''}${d.streamer&&can('streamers')?`<h3>停用與封存</h3><p>封存會從一般主播清單隱藏，資料與歷史仍保留；還原後不會自動啟用入口。</p>${action(d.streamer.archivedAt?'restore-streamer':'archive-streamer',d.streamer.archivedAt?'還原封存':'封存已停用主播')}`:''}</div>`;
 }
 function lookupHtml(){const lookup=model.editor?.lookup;if(!lookup)return '';return `<div class="pm-editor pm-account-picker" aria-label="搜尋管理帳號"><div class="pm-editor-heading">${action('close-lookup','← 返回設定')}</div><form data-pm-form="account-search">${field('accountQuery','搜尋帳號名稱、登入代碼或空間',lookup.q,'maxlength="100"')}<button type="submit">搜尋</button></form>${lookup.error?`<p class="error" role="alert">${h(lookup.error)}</p>`:''}${lookup.loading?'<p role="status">搜尋中…</p>':lookup.rows.map(row=>`<article class="pm-row"><div><b>${h(accountName(row.managerKey,row.name))}</b>${row.loginCode?`<small>登入代碼 ${h(row.loginCode)}</small>`:''}${row.kind?`<small>${h(accountKinds[row.kind]||'管理帳號')}</small>`:''}${publicLabel(row)?`<small>編號 ${h(publicLabel(row))}</small>`:''}${row.disabledAt?'<small>已停用帳號</small>':''}</div>${row.disabledAt?'':action('select-account','選擇',row.id)}</article>`).join('')||'<p>沒有符合條件的管理帳號。</p>'}<form class="pm-page" data-pm-form="account-page">${action('account-previous','上一頁','',lookup.loading||lookup.page<=1?'disabled':'')}<label>第 <input name="page" type="number" min="1" max="${lookup.pages}" value="${lookup.page}" required> 頁／共 ${lookup.pages} 頁</label><button type="submit" ${lookup.loading?'disabled':''}>跳頁</button>${action('account-next','下一頁','',lookup.loading||lookup.page>=lookup.pages?'disabled':'')}</form><p class="muted">列出全部空間的管理帳號。需要全新帳號時：主播請在主播卡片按「建立登入帳號」；全新的廳管理員專屬登入帳號屬第 3 批開放項目，目前可先綁定主播帳號擔任廳管理員。</p></div>`;}
 const homeButton=r=>r.operational===false?'':r.homePath?`<a class="pm-link-button" href="${h(r.homePath)}" target="_blank" rel="noopener">查看專屬首頁</a>`:streamerHome&&r.slug?action('view-home','查看專屬首頁',r.id):'';
 const adminButton=r=>openStreamerAdmin&&r.operational!==false&&r.loginEnabled!==undefined?action('enter-admin','進入管理後台',r.id):'';
 function spaceCard(r){if(r.kind==='streamer')return hostCard(r);const independent=r.kind==='independent',hosts=r.hosts||[];
  return `<article class="pm-space-card"><header><div><h2>${h(r.name)}</h2><small>${h(kindLabel(r.kind))} · ${r.status==='active'?'使用中':r.provisioningPending?'尚未開放營運':'已停用'}</small><small>管理帳號 ${Number(r.managerCount)||0} 位</small>${(r.managers||[]).length?`<p class="pm-manager-names">${r.managers.map(m=>h(accountName('',m.name))).join('、')}${r.managerCount>r.managers.length?` · 另 ${r.managerCount-r.managers.length} 位`:``}</p>`:''}</div></header>
   <div class="pm-space-hosts">${hosts.map(hostCard).join('')||`<p class="muted">${independent?'尚未建立主播資料與登入帳號。':'尚未建立主播。'}</p>`}</div>
   <div class="pm-actions pm-card-actions">${independent&&!hosts.length?action('add-first-host','建立主播資料與登入帳號',r.id):''}${!independent&&president()?action('add-hall-host','＋新增廳內主播',r.id):''}${!independent?action('bind-account','綁定已有帳號',r.id):''}${president()?action('edit-space-name','編輯資料',r.id):''}${president()?action('pricing','價目設定',r.id):''}${action('detail','編輯管理權限',r.id)}${president()&&r.operational===false?action('readiness','營運啟用設定',r.id):''}${homeButton(r)}${r.hostCount>hosts.length?action('hall-hosts','查看全部主播（'+r.hostCount+'）',r.id):''}${president()&&r.id!=='space-001'?danger('delete',independent?'刪除獨立主播':'刪除廳',r.id):''}</div></article>`;}
 function hostCard(r){const login=r.loginEnabled?'已有登入帳號':r.loginExists?'登入已暫停':'尚未建立登入帳號';
  return `<article class="pm-host-card"><div><b>${h(r.name)}</b><small>${h(r.spaceName||'')} · ${r.archivedAt?'已封存':r.active?'首頁開放':'首頁停用'} · ${login}${r.slug?' · 登入代碼 '+h(r.slug):''}</small>${r.operational===false?'<small>營運功能尚未開放</small>':''}</div>
   <div class="pm-actions pm-card-actions">${president()?action('credentials',r.loginExists?'登入設定':'建立登入帳號',r.id):''}${action('bind-account','綁定已有帳號',r.id)}${president()?action('edit-streamer','編輯資料',r.id):''}${action('detail','編輯管理權限',r.id)}${adminButton(r)}${homeButton(r)}${president()&&r.id!=='papa'?danger('delete','刪除',r.id):''}</div></article>`;}
 function accountRow(r){const roles=(r.roles||[]).map(x=>`${h(x.spaceName||'')}${x.streamerName?'・'+h(x.streamerName):''}（${h(roleNames[x.role]||x.role)}${x.status==='active'?'':'，已停用'}）`);
  return `<article class="pm-row"><div><h2>${h(accountName(r.managerKey,r.name))}</h2><small>${h(accountKinds[r.kind]||'管理帳號')}${r.loginCode?' · 登入代碼 '+h(r.loginCode):''} · ${r.disabledAt?'已停用':'有效帳號'}</small>${roles.length?`<small>授權：${roles.join('、')}${r.roleCount>roles.length?' 等 '+r.roleCount+' 項':''}</small>`:r.kind==='president'?'<small>可管理全部廳及主播</small>':'<small>尚未綁定任何空間</small>'}${publicLabel(r)?`<small>編號 ${h(publicLabel(r))}</small>`:''}</div>${r.kind==='president'||r.disabledAt?'':action('account-memberships','綁定到空間',r.id)}</article>`;}
 function rowHtml(r){if(Object.hasOwn(spaceCategories,model.section))return spaceCard(r);if(model.section==='halls')return `<article class="pm-row"><div><h2>${h(r.name)}</h2><small>${h(kindLabel(r.kind))} · ${r.status==='active'?'使用中':'已停用'}</small>${publicLabel(r)?`<small>編號 ${h(publicLabel(r))}</small>`:''}</div>${action('detail','編輯廳／管理人員',r.id)}</article>`;
  if(model.section==='accounts')return president()&&r.kind?accountRow(r):`<article class="pm-row"><div><h2>${h(accountName(r.managerKey,r.name))}</h2>${publicLabel(r)?`<small>編號 ${h(publicLabel(r))}</small>`:''}<small>${r.disabledAt?'已停用':'有效帳號'}${r.managerKey?' · '+h(r.managerKey):''}</small></div>${action('account-memberships','設定所屬廳與身分',r.id)}</article>`;
  return `<article class="pm-row"><div><h2>${h(r.name||r.slug||'主播')}</h2><small>${h(r.spaceName)} · ${r.archivedAt?'已封存':r.active?'入口啟用':'入口停用'}</small>${publicLabel(r)?`<small>編號 ${h(publicLabel(r))}</small>`:''}</div><div class="pm-actions">${president()?action('edit-streamer','編輯',r.id)+action('credentials','登入設定',r.id):''}${action('detail','管理人員與資料',r.id)}</div></article>`;
 }
 function html(){if(!allowed())return '<section class="card platform-management"><h1>平台管理中心</h1><p role="status">此平台管理中心僅供總裁帳號使用。</p></section>';const summary=model.summary||{};return `<section class="card platform-management"><h1>平台管理中心</h1><nav class="tabs pm-tabs" aria-label="平台管理分頁">${visibleSections().filter(([id])=>mainAreas.has(id)).map(([id,label])=>action('section',label,id,`aria-current="${model.section===id?'page':'false'}"`)).join('')}</nav>${model.section==='accounts'?'':`<div class="pm-summary">${[['halls','廳總數'],['streamerSpaces','主播空間總數'],['pendingSetup','待完成設定']].map(([key,label])=>`<div><span>${label}</span><strong>${summary[key]??'—'}</strong></div>`).join('')}</div>`}<div class="pm-actions">${action('create-space','＋建立新廳／主播')}${model.spaceId?action('all-spaces','← 全部空間'):''}</div>${model.section==='overview'?`<div class="pm-summary">${[['spaces','廳／空間'],['independent','獨立主播'],['activeStreamers','啟用主播'],['inactiveStreamers','已停用主播'],['archivedStreamers','已封存主播'],['enabledStreamerLogins','可登入主播後台']].map(([id,name])=>`<div><span>${name}</span><strong>${summary[id]??'—'}</strong></div>`).join('')}</div><p>這裡是總裁專用的平台管理中心。「啟用主播」是目前開放的主播首頁；「可登入主播後台」是允許登入的帳號，首頁停用時仍可能保留登入，兩者數量可能不同。</p>`:`<form class="pm-search" data-pm-form="search">${field('q',model.section==='accounts'?'搜尋帳號名稱、登入代碼或空間':'搜尋名稱／公開代碼',model.q,'maxlength="100"')}<button type="submit">搜尋</button>${president()&&model.section==='halls'?action('create-space','新增廳／獨立主播空間'):''}</form>`}${model.accountTarget?`<p class="notice">為「${h(accountName(model.accountTarget.managerKey,model.accountTarget.name))}」選擇要綁定的空間或主播，再按卡片上的「綁定已有帳號」。${action('cancel-account-target','取消')}</p>`:''}${model.error&&!model.editor?`<p role="alert" class="error">${h(model.error)}</p>`:''}${model.loading?'<p role="status">讀取中…</p>':model.section==='overview'?'':model.rows.map(rowHtml).join('')||'<p>沒有符合條件的資料。</p>'}${model.section!=='overview'?`<form class="pm-page" data-pm-form="page">${action('previous','上一頁','',model.page<=1?'disabled':'')}<label>第 <input name="page" type="number" min="1" max="${model.pages}" value="${model.page}" required> 頁／共 ${model.pages} 頁</label><button type="submit">跳頁</button>${action('next','下一頁','',model.page>=model.pages?'disabled':'')}</form>`:''}${model.editor?`<template data-pm-dialog-content><header class="pm-dialog-header"><h2 id="pm-dialog-title">${h(editorTitle())}</h2>${action('close-editor','×','','aria-label="關閉視窗"')}</header><div class="pm-dialog-body">${model.error?`<p role="alert" class="error pm-dialog-error">${h(model.error)}</p>`:''}${model.editor.lookup?lookupHtml():editorHtml()}</div></template>`:''}</section>`;}
 const successFor=(result,{title,heading,row})=>({heading,title,row:row?{...row,operational:row.operational!==false&&result.spaceId==='space-001'||row.operational===true,id:result.streamerId||row.id}:null,
  lines:[...(result.slug?[`登入代碼：<b>${h(result.slug)}</b>`]:[]),...(result.loginExists?[!result.loginEnabled?'登入帳號已建立，目前暫停登入。':row&&(row.operational===false||result.spaceId!=='space-001'&&row.operational!==true)?'登入帳號已建立；此空間營運功能開放後，即可用這組登入代碼與密碼登入。':'已可使用此登入代碼與密碼登入後台。']:[]),...(result.accountId?['管理帳號已建立並完成授權，可在「管理帳號」頁查看。']:[])]});
 async function click(button){
  const actionName=button.dataset.pmAction,id=button.dataset.pmId,row=rowsWithHosts().find(r=>r.id===id),e=model.editor;
  if(model.saving||!allowed())return;
  if(!model.editor&&button.isConnected)returnFocus=button;
  if(actionName==='lookup-accounts'&&e){const form=button.closest('form');if(form)captureDraft(form,new FormData(form));return lookupAccounts(id);}
  if(actionName==='close-lookup'&&e){lookupGeneration++;model.editor={...e,lookup:null};notify();return;}
  if(['account-previous','account-next'].includes(actionName)&&e?.lookup&&!e.lookup.loading)return lookupAccounts(e.lookup.target,{q:e.lookup.q,page:e.lookup.page+(actionName==='account-next'?1:-1)});
  if(actionName==='select-account'&&e?.lookup&&!e.lookup.loading){const selected=e.lookup.rows.find(row=>row.id===id&&!row.disabledAt);if(!selected)return;const target=e.lookup.target;lookupGeneration++;const role=e.draft?.role||e.member?.role||'space_admin';model.editor={...e,lookup:null,draft:{...e.draft,[target]:selected.id,[target==='accountId'?'accountName':'ownerAccountName']:accountName(selected.managerKey,selected.name),...(target==='accountId'?{permissions:rolePermissions(role),status:'active',role}:{})},...(target==='accountId'?{member:{...(e.member||{}),accountId:selected.id,name:accountName(selected.managerKey,selected.name),role,permissions:[]}}:{})};notify();return;}
  if(actionName==='pricing'&&row&&!row.spaceId)return openPricing(row);
  if(actionName==='pricing-new'&&e?.success?.space)return openPricing(e.success.space);
  if(actionName.startsWith('pricing-')&&e?.type==='pricing'&&e.draft){const form=button.closest('form')||dialog?.querySelector('[data-pm-form="pricing"]'),current=form?readPricingForm(form,e.draft):e.draft;
   model.editor=actionName==='pricing-preview'?{...e,draft:current,preview:!e.preview}:{...e,draft:changePricingDraft(current,actionName.slice(8),id)};notify();return;}
  if(actionName==='section')return load({section:id,q:'',page:1,spaceId:null});if(actionName==='previous'||actionName==='next')return load({page:model.page+(actionName==='next'?1:-1)});
  if(actionName==='hall-hosts'&&row)return load({spaceId:row.id,page:1,q:''});
  if(actionName==='all-spaces')return load({spaceId:null,page:1,q:''});
  if(actionName==='cancel-account-target'){model.accountTarget=null;notify();return;}
  if(['add-hall-host','add-first-host'].includes(actionName)&&president()){const space=row||model.rows.find(r=>r.id===(e?.readiness?.spaceId||id));if(!space)return;detailGeneration++;writeKey=null;model.editor={type:'streamer',row:{spaceId:space.id,spaceName:space.name,spaceKind:space.kind||e?.readiness?.kind,operational:space.operational},draft:actionName==='add-first-host'?{display_name:space.name,loginEnabled:true}:{loginEnabled:true}};model.error='';notify();return;}
  if(actionName==='back-members'&&e){model.editor={...e,member:null,draft:undefined,binding:false};notify();return;}
  if(actionName==='close-editor'){closeEditor();return;}
  if(actionName==='create-space'&&president()){detailGeneration++;writeKey=null;model.accountTarget=null;model.editor={type:'create-space',draft:{kind:'hall',loginEnabled:true}};notify();return;}
  if((actionName==='create-streamer'||actionName==='edit-streamer')&&president()){detailGeneration++;writeKey=null;model.accountTarget=null;model.editor={type:'streamer',row:row||{}};notify();return;}
  if(actionName==='edit-space-name'&&president()&&row){detailGeneration++;writeKey=null;model.editor={type:'space-name',row};notify();return;}
  if(actionName==='credentials'){writeKey=null;return openLogin(row);}
  if(actionName==='credentials-by-id'&&e?.readiness){const host=e.readiness.hosts.find(x=>x.id===id);const space=model.rows.find(r=>r.id===e.readiness.spaceId);if(!host)return;writeKey=null;return openLogin({id:host.id,name:host.name,slug:host.slug,spaceId:e.readiness.spaceId,spaceName:e.readiness.name,operational:e.readiness.operational,...(space?{spaceKind:space.kind}:{})});}
  if(actionName==='readiness'&&row)return openReadiness(row);
  if(actionName==='activate-space'&&president()&&e?.readiness?.canActivate){const r=e.readiness;if(!confirm('確定開放「'+r.name+'」營運？'))return;
   if(await mutate('restore',{spaceId:r.spaceId,revision:r.revision})){model.editor={type:'done',row:null,success:{heading:'已開放營運',title:`「${r.name}」已開放營運`,
    lines:['主播現在可以登入後台，建立歌本、價目與玩家。','玩家用主播給的登入代碼與密碼登入；官網「管理登入／玩家登入」也會出現這個'+(r.kind==='independent'?'獨立主播':'廳')+'。'],row:null}};notify();}return;}
  if(actionName==='readiness-from-detail'&&e?.detail){const space=model.rows.find(r=>r.id===id)||{id,name:e.detail.space.name};return openReadiness(space);}
  if(actionName==='delete'&&row){writeKey=null;return openDelete(row);}
  if(actionName==='delete-archive'&&e?.type==='delete')return archiveFromDelete(e);
  if(actionName==='delete-suspend'&&e?.type==='delete'){if(!confirm('確認停用此空間？資料會完整保留，之後可恢復。'))return;const s=model.rows.find(r=>r.id===id);if(!s)return;if(await mutate('suspend',{spaceId:s.id,revision:s.revision}))closeEditor();return;}
  if(actionName==='enter-admin'&&openStreamerAdmin){const target=row||e?.success?.row;if(target)openStreamerAdmin(target);return;}
  if(actionName==='view-home'&&streamerHome&&row){streamerHome(row);return;}
  if(actionName==='close-dependencies'&&e){model.editor={...e,dependencies:null};notify();return;}
  if(actionName==='detail')return openDetail(row);
  if(actionName==='bind-account'&&row)return openDetail(row,{bind:true});
  if(actionName==='account-memberships'&&can('administrators')&&row){return load({section:'all-spaces',q:'',page:1,accountTarget:row});}
  if(actionName==='edit-membership'&&canManageMembers(e?.detail)){const member=e.detail.memberships.find(m=>m.id===id);if(!member||member.accountId===e.detail.space.ownerAccountId&&member.role==='space_admin')return;model.editor={...e,member,draft:undefined};notify();return;}
  if(['suspend','restore','archive-streamer','restore-streamer'].includes(actionName)&&canMutate(actionName.replace('-','_'))&&e?.detail){const s=e.detail.space;if(!confirm('確認'+button.textContent+'？'))return;return mutate(actionName.replace('-','_'),{spaceId:s.id,revision:s.revision,...(actionName.includes('streamer')?{streamerId:e.row.id}:{})});}
 }
 // Archive keeps every business row. A visible streamer is first closed through
 // the same registry edit, then archived with the existing management action.
 async function archiveFromDelete(e){
  const r=e.row;if(!r?.spaceId||!confirm('確認停用並封存「'+(r.name||'主播')+'」？首頁與登入入口會關閉，所有資料保留，之後可還原。'))return;
  if(r.active!==false){const done=await write({op:'platformProvisionStreamer',mode:'streamer',spaceId:r.spaceId,descriptor:{id:r.id,display_name:r.name,slug:r.slug,home_title:r.descriptor?.home_title||r.name,subtitle:r.descriptor?.subtitle||'',active:false}});if(!done)return;}
  const actor=identity(),ticket=generation;
  try{const detail=await api({op:'platformManagementDetail',management:true,spaceId:r.spaceId,streamerId:r.id,q:'',page:1});if(!current(actor,ticket))return;
   writeKey=null;if(await mutate('archive_streamer',{spaceId:r.spaceId,revision:detail.space.revision,streamerId:r.id})){model.editor={type:'done',row:r,success:{heading:'已封存',title:`「${r.name}」已停用並封存`,lines:['首頁與登入入口已關閉，玩家存歌、帳務、演唱與勳章資料完整保留。'],row:null}};notify();}
  }catch(error){if(current(actor,ticket)){model.error=error.message;notify();}}
 }
 async function submit(form){
  if(model.saving||!allowed())return;const f=new FormData(form),type=form.dataset.pmForm,e=model.editor;if(!['search','page','members-page','account-search','account-page'].includes(type))captureDraft(form,f);
  if(type==='account-search'&&e?.lookup)return lookupAccounts(e.lookup.target,{q:String(f.get('accountQuery')||''),page:1});if(type==='account-page'&&e?.lookup){const page=Number(f.get('page'));if(Number.isSafeInteger(page)&&page>=1&&page<=e.lookup.pages)return lookupAccounts(e.lookup.target,{q:e.lookup.q,page});return;}
  if(type==='search')return load({q:String(f.get('q')||''),page:1});if(type==='page'){const p=Number(f.get('page'));if(Number.isInteger(p)&&p>=1&&p<=model.pages)return load({page:p});return;}
  if(type==='membership'&&!f.get('accountId'))throw Error('請先搜尋並選擇管理人員帳號');
  const password=String(f.get('password')||''),confirmPassword=String(f.get('passwordConfirm')||'');
  if(['create-space','streamer','credentials'].includes(type)&&password!==confirmPassword)throw Error('兩次輸入的密碼不一致');
  if(type==='create-space'){
   // Check the pricing basics before anything is created, then create the Space
   // and save its blank pricing with the chosen names, unit, mode and rollover.
   const basics=createBasics(),pricing=forSave({...basics,policy:'auto',perUnit:{singer:'0',host:'0',hall:'0'},plans:[],tiers:[]}),name=String(f.get('name')||'').trim(),actor=identity(),ticket=generation;
   const finish=async(spaceId,success)=>{let line='已套用價目基本設定：稱呼、禮物單位、計費方式與每日換場時間。';
    // Keep the form locked so the Space cannot be created twice meanwhile.
    model.saving=true;notify();
    try{await api({op:'platformSpacePricingSave',management:true,operationId:uuid(),spaceId,expectedRevision:0,rolloverHour:basics.rolloverHour,pricing});}
    catch(error){line='價目基本設定尚未儲存（'+h(error.message)+'），請按「繼續設定價目」再填一次。';}
    model.saving=false;if(!current(actor,ticket))return;model.editor={...model.editor,success:{...success,lines:[...success.lines,line],space:{id:spaceId,name,kind:f.get('kind')==='independent'?'independent':'hall'}}};notify();};
   if(f.get('kind')==='independent'){
    const result=await write({op:'platformProvisionStreamer',mode:'independent',spaceName:name,descriptor:{display_name:name,slug:String(f.get('slug')||'').trim()},password,loginEnabled:f.has('loginEnabled')});
    if(result)await finish(result.spaceId,successFor(result,{heading:'已建立獨立主播',title:`「${name}」與專屬登入帳號已建立`,row:{name,slug:result.slug,spaceId:result.spaceId,operational:false}}));return;}
   const created=await write({op:'platformManageSpace',action:'create',payload:{name,kind:'hall',...(f.get('ownerAccountId')?{ownerAccountId:f.get('ownerAccountId')}:{})}});
   if(created?.id)await finish(created.id,{heading:'已建立廳',title:`「${name}」已建立`,lines:['可在廳卡片「＋新增廳內主播」並同時建立主播帳號。'],row:null});return;
  }
  if(type==='pricing'&&president()&&model.editor?.type==='pricing'){const ed=model.editor,pricing=forSave(ed.draft);
   return write({op:'platformSpacePricingSave',spaceId:ed.info.spaceId,expectedRevision:ed.info.revision,rolloverHour:Number(ed.draft.rolloverHour)||0,pricing},result=>{model.editor={...model.editor,success:{heading:'價目已儲存',title:`「${ed.info.name}」的價目已更新（第 ${result.revision} 版）`,lines:['新的點歌一律用這份價目計算；之前的點歌紀錄維持原本的金額。',(ed.info.kind==='independent'?'主播':'同廳主播')+'與玩家的畫面會在下次讀取時更新，最晚約 5 分鐘。'],row:null}};});}
  if(type==='edit-space'||type==='edit-space-name'){const s=e.detail?.space||e.row;const ok=await mutate('edit',{spaceId:s.id,revision:s.revision,name:f.get('name')});if(ok&&type==='edit-space-name')closeEditor();return;}
  if(type==='membership')return mutate('membership',{spaceId:e.detail.space.id,revision:e.detail.space.revision,accountId:f.get('accountId'),role:f.get('role'),...(f.get('role')==='streamer_admin'?{streamerId:f.get('streamerId')}:{}),status:f.get('status'),permissions:f.getAll('permissions')});
  if(type==='streamer'){const r=e.row||{},editing=!!r.id;
   const descriptor={...(editing?{id:r.id}:{}),display_name:String(f.get('display_name')||''),slug:String(f.get('slug')||'').trim(),home_title:String(f.get('home_title')||''),subtitle:String(f.get('subtitle')||''),active:f.has('active')};
   const body={op:'platformProvisionStreamer',mode:'streamer',spaceId:String(f.get('spaceId')||r.spaceId||''),descriptor,...(!editing&&password?{password,loginEnabled:f.has('loginEnabled')}:{})};
   return write(body,result=>{model.editor={...model.editor,success:successFor(result,{heading:editing?'已儲存':'已新增主播',title:editing?`「${descriptor.display_name}」的資料已更新`:`「${descriptor.display_name}」已建立${result.loginExists?'，登入帳號也已建立':''}`,row:{name:descriptor.display_name,slug:result.slug,spaceId:result.spaceId,operational:r.operational}})};});}
  if(type==='credentials'&&president()&&e?.type==='credentials'){const r=e.row;
   return write({op:'platformStreamerLogin',spaceId:r.spaceId,streamerId:r.id,password,enabled:f.has('enabled')},result=>{model.editor={...model.editor,success:successFor(result,{heading:e.credentials.exists?'登入設定已儲存':'已建立登入帳號',title:e.credentials.exists?`「${r.name}」的登入設定已更新`:`「${r.name}」的登入帳號已建立`,row:{...r,operational:r.operational}})};});}
  if(type==='delete'&&president()&&e?.type==='delete'){const t=e.report.target;
   return write({op:'platformDelete',spaceId:t.spaceId,...(t.streamerId?{streamerId:t.streamerId}:{}),confirmationToken:e.report.confirmationToken,confirmedName:String(f.get('confirmedName')||'')},()=>{model.editor={type:'done',row:e.row,success:{heading:'已刪除',title:`「${t.name}」已永久刪除`,lines:['已從清單、登入及網址移除；其他主播、共用玩家帳號與共同曲庫未受影響。','操作紀錄已保留供追查。'],row:null}};});}
  if(type==='members-page'&&e?.detail){const page=Number(f.get('page'));if(!Number.isInteger(page)||page<1||page>e.detail.pages)return;const actor=identity(),ticket=++detailGeneration;try{const detail=await api({op:'platformManagementDetail',management:true,spaceId:e.detail.space.id,streamerId:e.row.spaceId?e.row.id:null,q:'',page});if(identity()===actor&&ticket===detailGeneration&&allowed()){model.editor={...e,detail};notify();}}catch(error){if(identity()===actor&&ticket===detailGeneration&&allowed()){model.error=error.message;notify();}}}
 }
 function closeEditor(){if(model.saving)return;detailGeneration++;lookupGeneration++;writeKey=null;model.editor=null;model.accountTarget=null;model.error='';notify();}
 function removeDialog(){const restore=returnFocus;returnFocus=null;const old=dialog;dialog=null;dialogMarkup='';dialogKey='';lastDialogError='';if(old){old.onclose=null;old.remove();}if(restore){const target=restore.isConnected?restore:restore.dataset?.pmAction?document.querySelector(`[data-pm-action="${CSS.escape(restore.dataset.pmAction)}"][data-pm-id="${CSS.escape(restore.dataset.pmId||'')}"]`):null;target?.focus({preventScroll:true});}}
 function bindEvents(root){root.onclick=event=>{const button=event.target.closest('[data-pm-action]');if(button&&root.contains(button)){const actor=identity(),ticket=generation;void click(button).catch(error=>{if(current(actor,ticket)){model.error=error.message;notify();}});}};root.onsubmit=event=>{if(!event.target.matches('[data-pm-form]'))return;event.preventDefault();const actor=identity(),ticket=generation;void submit(event.target).catch(error=>{if(current(actor,ticket)){model.error=error.message;notify();}});};}
 function bind(root){bindEvents(root);const template=root.querySelector('[data-pm-dialog-content]');if(!template||!model.editor||!allowed()){removeDialog();return;}
  if(!dialog){dialog=document.createElement('dialog');dialog.className='platform-management pm-dialog';dialog.dataset.pmDialog='';dialog.setAttribute('aria-labelledby','pm-dialog-title');document.body.append(dialog);bindEvents(dialog);dialog.oncancel=event=>{event.preventDefault();closeEditor();};dialog.onclose=()=>{if(dialog&&model.editor)closeEditor();};dialog.addEventListener('input',event=>{const form=event.target.closest('[data-pm-form]');if(form&&!['account-search','account-page','members-page'].includes(form.dataset.pmForm))captureDraft(form,new FormData(form));});dialog.addEventListener('change',event=>{const form=event.target.closest('[data-pm-form]');if(form&&!['account-search','account-page','members-page'].includes(form.dataset.pmForm)){if(event.target.name==='role'&&event.target.dataset.priorRole!==event.target.value){const preset=rolePermissions(event.target.value);for(const box of form.querySelectorAll('[name=permissions]'))box.checked=preset.includes(box.value);event.target.dataset.priorRole=event.target.value;}captureDraft(form,new FormData(form));if(['kind','mode','singleFee'].includes(event.target.name))notify();}});}
  const markup=template.innerHTML,key=model.editor.type+':'+(model.editor.row?.id||'')+':'+(model.editor.lookup?.target||'')+':'+(model.editor.dependencies?'dependencies':'')+':'+(model.editor.success?'success':'');
  if(markup!==dialogMarkup){const active=document.activeElement,inside=dialog.contains(active),focusName=inside?active.name:null,focusAction=inside?active.dataset.pmAction:null,formName=inside?active.closest('[data-pm-form]')?.dataset.pmForm:null,selection=inside&&typeof active.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null,scroll=dialog.querySelector('.pm-dialog-body')?.scrollTop||0;const same=key===dialogKey;
   // Typed passwords are never placed in markup; keep them across re-renders of the same form.
   const secrets=same?[...dialog.querySelectorAll('input[type=password]')].map(input=>[input.name,input.value]):[];
   dialog.innerHTML=markup;dialogMarkup=markup;dialogKey=key;
   for(const [name,value] of secrets){const input=dialog.querySelector(`input[type=password][name="${CSS.escape(name)}"]`);if(input)input.value=value;}
   if(same){const body=dialog.querySelector('.pm-dialog-body');if(body)body.scrollTop=scroll;let target;if(focusName){const form=formName?dialog.querySelector(`[data-pm-form="${CSS.escape(formName)}"]`):dialog;target=form?.querySelector(`[name="${CSS.escape(focusName)}"]`);}else if(focusAction)target=dialog.querySelector(`[data-pm-action="${CSS.escape(focusAction)}"]`);if(target&&!target.disabled){target.focus({preventScroll:true});if(selection&&target.setSelectionRange)try{target.setSelectionRange(...selection);}catch{}}}
   if(model.error&&lastDialogError!==model.error){const body=dialog.querySelector('.pm-dialog-body');if(body)body.scrollTop=0;}lastDialogError=model.error;
  }
  if(!dialog.open)dialog.showModal();template.remove();
 }

 return {load,clear,html,bind,mutate,openDetail,openDelete,openLogin,openReadiness,state:()=>model,sync:()=>{if(owner&&(owner!==identity()||!visibleSections().some(([id])=>id===model.section)))clear();}};
}
