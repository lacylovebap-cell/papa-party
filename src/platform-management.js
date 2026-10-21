// The management centre uses the existing Account, Space and streamer registry.
// No operational player or accounting snapshots are downloaded here.
const sections=[['overview','總覽'],['halls','廳管理'],['streamers','主播管理'],['accounts','帳號與權限'],['cleanup','停用與清理']];
const permissions=[['songs','歌曲'],['queue','待播'],['players','玩家'],['announcements','公告'],['streamers','主播'],['reports','報表'],['administrators','管理員']];
const initial=()=>({section:'overview',q:'',page:1,pages:1,total:0,rows:[],summary:null,registryRevision:null,loaded:false,loading:false,saving:false,error:'',editor:null});
const validPage=r=>r&&Array.isArray(r.rows)&&r.rows.length<=20&&Number.isSafeInteger(r.total)&&r.total>=r.rows.length&&Number.isSafeInteger(r.page)&&Number.isSafeInteger(r.pages)&&r.page>=1&&r.pages>=r.page;
export function createPlatformManagement({api,identity,escape:h,changed,confirm=globalThis.confirm,uuid=()=>crypto.randomUUID()}){
 let model=initial(),owner=null,generation=0,detailGeneration=0,writeKey=null;
 const current=(actor,ticket)=>identity()===actor&&generation===ticket;
 const notify=()=>changed();
 const clear=()=>{model=initial();owner=null;generation++;detailGeneration++;writeKey=null;};
 async function load({section=model.section,q=model.q,page=model.page}={}){
  if(!sections.some(([key])=>key===section)||typeof q!=='string'||q.length>100||!Number.isSafeInteger(page)||page<1)return;
  const actor=identity(),ticket=++generation;owner=actor;detailGeneration++;
  model={...model,section,q,page,rows:[],loading:true,loaded:false,error:'',editor:null};notify();
  try{if(!actor)throw Error('請先登入平台總裁');const result=await api({op:'platformManagementDirectory',management:true,section,q,page});if(!current(actor,ticket))return;if(!validPage(result))throw Error('管理清單資料尚未確認');model={...model,...result,loaded:true,loading:false};}
  catch(error){if(!current(actor,ticket))return;model={...model,loading:false,error:error.message};}notify();
 }
 async function openDetail(row){
  const actor=identity(),ticket=++detailGeneration;owner=actor;model={...model,error:'',editor:{type:'detail',row,loading:true}};notify();
  try{const detail=await api({op:'platformManagementDetail',management:true,spaceId:row.spaceId||row.id,streamerId:row.spaceId?row.id:null,q:'',page:1});if(identity()!==actor||ticket!==detailGeneration)return;
   if(!detail?.space||detail.space.id!==(row.spaceId||row.id)||!Array.isArray(detail.memberships)||detail.memberships.length>20)throw Error('管理範圍尚未確認');model.editor={type:'detail',row,detail,loading:false,...(model.accountTarget?{member:{accountId:model.accountTarget.id,role:'space_admin',permissions:[]}}:{})};
  }catch(error){if(identity()!==actor||ticket!==detailGeneration)return;model.error=error.message;model.editor=null;}notify();
 }
 async function mutate(action,payload){
  if(model.saving||!identity())return false;
  const actor=identity(),ticket=generation,fingerprint=JSON.stringify({action,payload});if(!writeKey||writeKey.fingerprint!==fingerprint)writeKey={fingerprint,id:uuid()};
  const key=writeKey;model={...model,saving:true,error:''};notify();
  try{await api({op:'platformManageSpace',management:true,operationId:key.id,action,payload});if(!current(actor,ticket))return false;writeKey=null;model.saving=false;await load();return true;}
  catch(error){if(!current(actor,ticket))return false;model={...model,saving:false,error:error.message};notify();return false;}
 }
 async function saveStreamer(data){
  if(model.saving||!identity())return;const actor=identity(),ticket=generation,revision=model.registryRevision;model={...model,saving:true,error:''};notify();
  try{await api({op:'platformStreamerSave',management:true,spaceId:data.spaceId,revision,descriptor:data.descriptor,anchorStreamer:data.anchorStreamer});if(!current(actor,ticket))return;model.saving=false;await load();}
  catch(error){if(!current(actor,ticket))return;model={...model,saving:false,error:error.message};notify();}
 }
 async function openCredentials(row){
  if(!row)return;const actor=identity(),ticket=++detailGeneration;owner=actor;model={...model,error:'',editor:{type:'credentials',row,loading:true}};notify();
  try{const value=await api({op:'platformStreamerCredentials',management:true,spaceId:row.spaceId,streamerId:row.id});if(identity()!==actor||ticket!==detailGeneration)return;
   if(typeof value?.exists!=='boolean'||typeof value?.enabled!=='boolean')throw Error('主播登入狀態尚未確認');model.editor={type:'credentials',row,credentials:value};
  }catch(error){if(identity()!==actor||ticket!==detailGeneration)return;model.error=error.message;model.editor=null;}notify();
 }
 const draft=(name,value)=>Object.hasOwn(model.editor?.draft||{},name)?model.editor.draft[name]:value;
 const field=(name,label,value='',extra='')=>`<label>${label}<input name="${name}" value="${h(draft(name,value)??'')}" ${extra}></label>`;
 const select=(name,label,values,value)=>`<label>${label}<select name="${name}">${values.map(([key,text])=>`<option value="${h(key)}" ${key===draft(name,value)?'selected':''}>${text}</option>`).join('')}</select></label>`;
 function captureDraft(form,f){const values=Object.fromEntries(f);for(const input of form.querySelectorAll('input[type="checkbox"]'))values[input.name]=input.name==='permissions'?f.getAll(input.name):f.has(input.name);if(model.editor)model.editor={...model.editor,draft:values};}
 const action=(name,label,id='',extra='')=>`<button type="button" data-pm-action="${name}" data-pm-id="${h(id)}" ${model.saving?'disabled':''} ${extra}>${label}</button>`;
 const formActions=()=>`<div class="pm-actions"><button type="button" data-pm-action="close-editor">取消</button><button type="submit" ${model.saving?'disabled':''}>${model.saving?'儲存中…':'儲存'}</button></div>`;
 function editorHtml(){const e=model.editor;if(!e)return '';if(e.loading)return '<aside class="pm-editor" role="status">讀取詳細資料中…</aside>';if(e.type==='create-space')return `<aside class="pm-editor"><h2>新增廳／獨立主播空間</h2><form data-pm-form="create-space">${field('name','名稱','','required maxlength="100"')}${select('kind','類型',[['hall','廳'],['independent','獨立主播']],'hall')}${field('ownerAccountId','負責人帳號 ID','','required')}<p class="muted">新增後先保持停用；完成入口與資料隔離檢查後才啟用。</p>${formActions()}</form></aside>`;
  if(e.type==='streamer'){const r=e.row||{},d=r.descriptor||{};return `<aside class="pm-editor"><h2>${r.id?'編輯主播':'新增主播'}</h2><form data-pm-form="streamer">${field('spaceId','所屬空間 ID',r.spaceId||'','required '+(r.id?'readonly':''))}${field('anchorStreamer','同空間既有主播 ID',r.anchorStreamer||r.id||'','required')}${field('display_name','主播名稱',d.display_name||r.name||'','required maxlength="100"')}${field('slug','登入識別代碼',d.slug||r.slug||'','required maxlength="64"')}${field('home_title','首頁名稱',d.home_title||'')}${field('subtitle','副標題',d.subtitle||'')}<label class="pm-check"><input type="checkbox" name="active" ${draft('active',d.active!==false)?'checked':''}>啟用主播入口</label><p class="muted">既有主播保留所屬廳。公開網址與歷史轉址由原有專屬網址設定管理。</p>${formActions()}</form></aside>`;}
  if(e.type==='credentials')return `<aside class="pm-editor"><h2>${h(e.row.name)} · 登入設定</h2><form data-pm-form="credentials">${field('password','新密碼（留空保留）','','type="password" minlength="4" maxlength="72" autocomplete="new-password"')}<label class="pm-check"><input name="enabled" type="checkbox" ${draft('enabled',e.credentials.enabled)?'checked':''}>啟用管理登入</label><p>儲存後既有主播管理登入會失效，需要重新登入。</p>${formActions()}</form></aside>`;
  const d=e.detail,s=d.space,memberships=d.memberships||[];
  return `<aside class="pm-editor"><div class="pm-editor-heading"><h2>${h(s.name)}</h2>${action('close-editor','關閉')}</div><p class="pm-id">${h(s.id)}</p><form data-pm-form="edit-space">${field('name','廳／空間名稱',s.name,'required maxlength="100"')}<div class="pm-actions"><button type="submit" ${model.saving?'disabled':''}>儲存名稱</button>${action(s.status==='active'?'suspend':'restore',s.status==='active'?'停用此廳':'恢復啟用')}</div></form>${s.provisioningPending?'<p class="muted">此空間尚需完成營運啟用檢查。</p>':''}<h3>管理帳號與權限</h3>${memberships.map(m=>`<article class="pm-member"><b>${h(m.name||m.managerKey||m.accountId)}</b><small>${h(m.role==='space_admin'?'廳管理員':'主播管理員')} · ${h(m.status==='active'?'使用中':'已撤銷')}</small><small class="pm-id">${h(m.accountId)}</small><small>${h((m.permissions||[]).map(v=>permissions.find(([id])=>id===v)?.[1]||v).join('、'))}</small>${m.accountId===s.ownerAccountId?'<small>負責人</small>':action('edit-membership','編輯授權',m.id)}</article>`).join('')||'<p>尚未設定管理員。</p>'}<p>第 ${d.page||1} 頁／共 ${d.pages||1} 頁 · 共 ${d.total??memberships.length} 位</p>${d.pages>1?`<form data-pm-form="members-page">${field('page','頁碼',d.page,'type="number" min="1" max="'+d.pages+'" required')}<button type="submit">跳頁</button></form>`:''}${d.canManageMemberships?`<form data-pm-form="membership"><h3>${model.editor.member?'修改管理員':'建立／綁定管理授權'}</h3>${field('accountId','已驗證帳號 ID',e.member?.accountId||'','required')}${select('role','角色',[['space_admin','廳管理員'],['streamer_admin','主播管理員']],e.member?.role||'space_admin')}${field('streamerId','主播 ID（主播管理員必填）',e.member?.streamerId||d.streamer?.descriptor?.id||'')}${select('status','狀態',[['active','任命／啟用'],['suspended','撤銷／停用']],e.member?.status||'active')}<fieldset><legend>授權功能</legend>${permissions.map(([id,label])=>`<label class="pm-check"><input type="checkbox" name="permissions" value="${id}" ${draft('permissions',e.member?.permissionsExplicit===false?e.member.effectivePermissions||[]:e.member?.permissions||[]).includes(id)?'checked':''}>${label}</label>`).join('')}</fieldset>${formActions()}</form>`:''}${d.streamer?`<h3>主播封存</h3><p>封存只隱藏一般管理清單；還原封存後不會自動啟用入口。</p>${action(d.streamer.archivedAt?'restore-streamer':'archive-streamer',d.streamer.archivedAt?'還原封存':'封存已停用主播')}${action('dependencies','檢查資料依賴')}<div class="pm-dependencies">${e.dependencies?`<h3>資料依賴</h3><pre>${h(JSON.stringify(e.dependencies,null,2))}</pre><p>保留正式資料與 Audit；永久刪除仍須另行核准。</p>`:''}</div>`:''}</aside>`;
 }
 function rowHtml(r){if(model.section==='halls')return `<article class="pm-row"><div><h2>${h(r.name)}</h2><small>${h(r.kind==='hall'?'廳':r.kind==='independent'?'獨立主播空間':'尚待確認類型')} · ${r.status==='active'?'使用中':'已停用'}</small><small class="pm-id">${h(r.id)}</small></div>${action('detail','詳細管理',r.id)}</article>`;
  if(model.section==='accounts')return `<article class="pm-row"><div><h2>${h(r.name||r.managerKey||'管理帳號')}</h2><small class="pm-id">${h(r.id)}</small><small>${r.disabledAt?'已停用':'有效帳號'}${r.managerKey?' · '+h(r.managerKey):''}</small></div>${action('account-memberships','管理授權',r.id)}</article>`;
  return `<article class="pm-row"><div><h2>${h(r.name||r.slug||r.id)}</h2><small>${h(r.spaceName)} · ${r.archivedAt?'已封存':r.active?'入口啟用':'入口停用'}</small><small class="pm-id">${h(r.id)}</small></div><div class="pm-actions">${action('edit-streamer','編輯',r.id)}${action('credentials','登入設定',r.id)}${action('detail','權限／封存',r.id)}</div></article>`;
 }
 function html(){const summary=model.summary||{};return `<section class="card platform-management"><h1>平台管理中心</h1><nav class="tabs pm-tabs" aria-label="平台管理分頁">${sections.map(([id,label])=>action('section',label,id,`aria-current="${model.section===id?'page':'false'}"`)).join('')}</nav>${model.section==='overview'?`<div class="pm-summary">${[['halls','廳'],['independent','獨立主播空間'],['streamers','主播'],['managers','有效管理帳號'],['unclassified','待確認分類']].map(([id,name])=>`<div><span>${name}</span><strong>${summary[id]??'—'}</strong></div>`).join('')}</div><p>廳、主播與管理帳號分別管理。尚未確認類型的空間先保留現況。</p>`:`<form class="pm-search" data-pm-form="search">${field('q','搜尋名稱／ID',model.q,'maxlength="100"')}<button type="submit">搜尋</button>${model.section==='halls'?action('create-space','新增廳／獨立主播空間'):model.section==='streamers'?action('create-streamer','新增主播'):''}</form>`}${model.accountTarget?`<p class="notice">選擇要授權的廳：${h(model.accountTarget.name||model.accountTarget.id)}</p>`:''}${model.error?`<p role="alert" class="error">${h(model.error)}</p>`:''}${model.loading?'<p role="status">讀取中…</p>':model.section==='overview'?'':model.rows.map(rowHtml).join('')||'<p>沒有符合條件的資料。</p>'}${model.section!=='overview'?`<form class="pm-page" data-pm-form="page">${action('previous','上一頁','',model.page<=1?'disabled':'')}<label>第 <input name="page" type="number" min="1" max="${model.pages}" value="${model.page}" required> 頁／共 ${model.pages} 頁</label><button type="submit">跳頁</button>${action('next','下一頁','',model.page>=model.pages?'disabled':'')}</form>`:''}${editorHtml()}</section>`;}
 async function click(button){
  const actionName=button.dataset.pmAction,id=button.dataset.pmId,row=model.rows.find(r=>r.id===id),e=model.editor;
  if(model.saving)return;
  if(actionName==='section')return load({section:id,q:'',page:1});if(actionName==='previous'||actionName==='next')return load({page:model.page+(actionName==='next'?1:-1)});
  if(actionName==='close-editor'){detailGeneration++;model.editor=null;notify();return;}
  if(actionName==='create-space'){model.editor={type:'create-space'};notify();return;}
  if(actionName==='create-streamer'||actionName==='edit-streamer'){model.editor={type:'streamer',row:row||{}};notify();return;}
  if(actionName==='credentials')return openCredentials(row);
  if(actionName==='detail')return openDetail(row);
  if(actionName==='account-memberships'){model.accountTarget=row;return load({section:'halls',q:'',page:1});}
  if(actionName==='edit-membership'){const member=e.detail.memberships.find(m=>m.id===id);model.editor={...e,member,draft:undefined};notify();return;}
  if(['suspend','restore','archive-streamer','restore-streamer'].includes(actionName)){const s=e.detail.space;if(!confirm('確認'+button.textContent+'？'))return;return mutate(actionName.replace('-','_'),{spaceId:s.id,revision:s.revision,...(actionName.includes('streamer')?{streamerId:e.row.id}:{})});}
  if(actionName==='dependencies'){const actor=identity(),ticket=generation,detailTicket=detailGeneration;model.saving=true;notify();try{const result=await api({op:'platformManagementDependencies',management:true,spaceId:e.detail.space.id,streamerId:e.row.id});if(!current(actor,ticket)||detailTicket!==detailGeneration)return;e.dependencies=result;model.editor=e;}catch(error){if(current(actor,ticket)&&detailTicket===detailGeneration)model.error=error.message;}finally{if(current(actor,ticket)&&detailTicket===detailGeneration){model.saving=false;notify();}}}
 }
 async function submit(form){
  if(model.saving)return;const f=new FormData(form),type=form.dataset.pmForm,e=model.editor;if(!['search','page','members-page'].includes(type))captureDraft(form,f);
  if(type==='search')return load({q:String(f.get('q')||''),page:1});if(type==='page'){const p=Number(f.get('page'));if(Number.isInteger(p)&&p>=1&&p<=model.pages)return load({page:p});return;}
  if(type==='create-space')return mutate('create',{name:f.get('name'),kind:f.get('kind'),ownerAccountId:f.get('ownerAccountId')});
  if(type==='edit-space')return mutate('edit',{spaceId:e.detail.space.id,revision:e.detail.space.revision,name:f.get('name')});
  if(type==='membership')return mutate('membership',{spaceId:e.detail.space.id,revision:e.detail.space.revision,accountId:f.get('accountId'),role:f.get('role'),...(f.get('role')==='streamer_admin'?{streamerId:f.get('streamerId')}:{}),status:f.get('status'),permissions:f.getAll('permissions')});
  if(type==='streamer')return saveStreamer({spaceId:f.get('spaceId'),anchorStreamer:f.get('anchorStreamer'),descriptor:{...(e.row.id?{id:e.row.id}:{}),display_name:f.get('display_name'),slug:f.get('slug'),home_title:f.get('home_title'),subtitle:f.get('subtitle'),active:f.has('active')}});
  if(type==='credentials'){const actor=identity(),ticket=generation;model.saving=true;notify();try{await api({op:'setStreamerAccount',management:true,streamer:e.row.slug,password:f.get('password'),enabled:f.has('enabled')});if(current(actor,ticket)){model.saving=false;await load();}}catch(error){if(current(actor,ticket)){model.saving=false;model.error=error.message;notify();}}}
  if(type==='members-page'){const actor=identity(),ticket=++detailGeneration,page=Number(f.get('page'));if(!Number.isInteger(page)||page<1||page>e.detail.pages)return;try{const detail=await api({op:'platformManagementDetail',management:true,spaceId:e.detail.space.id,streamerId:e.row.spaceId?e.row.id:null,q:'',page});if(identity()===actor&&ticket===detailGeneration){model.editor={...e,detail};notify();}}catch(error){if(identity()===actor&&ticket===detailGeneration){model.error=error.message;notify();}}}
 }
 function bind(root){root.onclick=event=>{const button=event.target.closest('[data-pm-action]');if(button&&root.contains(button)){const actor=identity(),ticket=generation;void click(button).catch(error=>{if(current(actor,ticket)){model.error=error.message;notify();}});}};root.onsubmit=event=>{if(!event.target.matches('[data-pm-form]'))return;event.preventDefault();const actor=identity(),ticket=generation;void submit(event.target).catch(error=>{if(current(actor,ticket)){model.error=error.message;notify();}});};}
 return {load,clear,html,bind,mutate,openDetail,state:()=>model,sync:()=>{if(owner&&owner!==identity())clear();}};
}
