import {canonicalPublicHome} from './public-route-location.js';
import {PUBLIC_SITE_ORIGIN} from './public-links.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reasonText=reason=>({invalid_code:'請使用 1～40 個英文字母、數字或中間連字號，不能使用系統保留名稱。',space_not_configured:'請先由總裁設定所屬空間的網址代碼。',reserved_history_or_in_use:'這個網址已被使用或保留給原來的主播，請換一個代碼。'}[reason]||'這個網址目前無法使用。');
const key=value=>JSON.stringify([value?.actorKey,value?.role,value?.spaceId,value?.streamerId]);

export function createPublicLinkSettings({api,context,modal,toast=()=>{},share,onSaved=()=>{},document=globalThis.document,navigator=globalThis.navigator}={}){
 let generation=0;
 async function open(override={}){
  const initial=context(),actor=key(initial),turn=++generation;
  if(!['streamer_admin','super_admin'].includes(initial?.role)||initial.role==='streamer_admin'&&(!initial.spaceId||!initial.streamerId))throw Error('請先以主播或總裁身分登入');
  if(Object.keys(override).some(k=>!['kind','spaceId','streamerId'].includes(k)))throw Error('網址設定範圍不正確');
  if(initial.role!=='super_admin'&&Object.keys(override).length)throw Error('只能設定自己的主播網址');
  const kind=override.kind||'streamer',target={kind,spaceId:override.spaceId||initial.spaceId,streamerId:kind==='hall'?null:override.streamerId||initial.streamerId};
  if(!['hall','streamer'].includes(kind)||typeof target.spaceId!=='string'||!target.spaceId||kind==='streamer'&&(typeof target.streamerId!=='string'||!target.streamerId))throw Error('網址設定範圍不正確');
  const stillCurrent=()=>turn===generation&&key(context())===actor;
  let value=await api({op:'publicRouteSettings',...target,management:true});
  if(!stillCurrent())return;
  function verified(row){if(row?.version!==1||row.spaceId!==target.spaceId||(row.streamerId??null)!==target.streamerId||row.kind!==kind||typeof row.configured!=='boolean'||!Number.isSafeInteger(row.revision)||row.revision<0||row.configured&&!row.canonicalPath&&!(kind==='hall'&&row.layout==='independent')||row.canonicalPath!==null&&!canonicalPublicHome(PUBLIC_SITE_ORIGIN,row.canonicalPath))throw Error('網址設定範圍尚未確認');return row;}
  value=verified(value);
  const editableLayout=initial.role==='super_admin'&&kind==='hall'&&target.spaceId!=='space-001';
  const currentUrl=()=>value.canonicalPath?canonicalPublicHome(PUBLIC_SITE_ORIGIN,value.canonicalPath):'';
  modal(kind==='hall'?'大廳專屬網址與 QR Code':'專屬網址與 QR Code',`<form class="public-link-settings" data-public-link-form><label>目前公開網址<input data-public-current readonly value="${escape(currentUrl())}" placeholder="尚未啟用"></label><p class="muted" data-public-scope>所屬 Space 代碼：${escape(value.spaceCode||'尚未設定')}</p>${editableLayout?'<label>空間類型<select name="layout"><option value="hall" '+(value.layout==='hall'?'selected':'')+'>大廳</option><option value="independent" '+(value.layout==='independent'?'selected':'')+'>獨立主播（固定 pa.主播ID）</option></select></label>':''}<label>${kind==='hall'?'大廳網址代碼':'主播自訂代碼'}<input name="code" value="${escape(value.code||'')}" maxlength="40" required pattern="[A-Za-z0-9]([A-Za-z0-9-]{0,38}[A-Za-z0-9])?" autocomplete="off" spellcheck="false"></label><p class="muted">使用英文字母、數字或中間連字號。英文大小寫視為相同；改名後，已使用的舊網址及子分頁仍保留。</p><div class="actions"><button type="button" data-public-check>檢查網址</button><button class="primary" type="submit">儲存設定</button></div><p class="error" data-public-error role="status"></p><p data-public-status role="status" aria-live="polite"></p><div class="actions"><button type="button" data-public-copy ${currentUrl()?'':'disabled'}>複製網址</button><button type="button" data-public-preview ${currentUrl()?'':'disabled'}>預覽 QR Code／分享</button><button type="button" data-public-reload>重新讀取</button></div></form>`);
  const form=document.querySelector('[data-public-link-form]'),dialog=document.querySelector('#dialog');let saving=false;
  const active=()=>stillCurrent()&&form?.isConnected!==false&&document.querySelector('[data-public-link-form]')===form&&dialog?.open!==false;
  const get=s=>form.querySelector(s),error=get('[data-public-error]'),status=get('[data-public-status]');
  const changed=()=>{if(active()){status.textContent='';error.textContent='';}};
  const selectedLayout=()=>value.configured?value.layout:get('[name=layout]')?.value;
  const body=()=>({...target,code:editableLayout&&selectedLayout()==='independent'?'pa':get('[name=code]').value,...(editableLayout?{layout:selectedLayout()}:{}),management:true});
  function lock(on){saving=on;for(const button of form.querySelectorAll('button'))button.disabled=on;get('[name=code]').disabled=on;const layout=get('[name=layout]');if(layout)layout.disabled=on||value.configured;if(!on)for(const selector of ['[data-public-copy]','[data-public-preview]'])get(selector).disabled=!currentUrl();}
  function refreshFields(){get('[data-public-current]').value=currentUrl();get('[name=code]').value=value.code||'';get('[data-public-scope]').textContent='所屬 Space 代碼：'+(value.spaceCode||'尚未設定');if(editableLayout){get('[name=layout]').value=value.layout||'hall';get('[name=code]').readOnly=value.layout==='independent';if(value.layout!=='independent')hallCode=value.code||'';}}
  async function run(action){if(saving||!active())return;lock(true);error.textContent='';status.textContent='';try{await action();}catch(e){if(active())error.textContent=e.message;}finally{if(active())lock(false);}}
  form.oninput=changed;
  let hallCode=value.layout==='independent'?'':value.code||'';
  if(editableLayout){get('[name=code]').readOnly=value.layout==='independent';get('[name=layout]').disabled=value.configured;}
  form.onchange=()=>{if(editableLayout){const code=get('[name=code]'),independent=selectedLayout()==='independent';if(independent){if(!code.readOnly)hallCode=code.value;code.value='pa';}else if(code.readOnly)code.value=hallCode;code.readOnly=independent;}changed();};
  get('[data-public-check]').onclick=()=>run(async()=>{const requested=body(),result=verified(await api({op:'publicRouteCheck',...requested})),proposal=result.available&&canonicalPublicHome(PUBLIC_SITE_ORIGIN,result.proposedPath),noHall=kind==='hall'&&(requested.layout||result.layout)==='independent';if(typeof result.available!=='boolean'||result.available&&!proposal&&!noHall)throw Error('網址檢查結果尚未確認');if(active())status.textContent=result.available?(noHall?'此設定可以使用：獨立主播網址固定使用 /pa.主播ID，沒有大廳首頁。':'此網址可以使用：'+proposal):reasonText(result.reason);});
  get('[data-public-reload]').onclick=()=>run(async()=>{const result=verified(await api({op:'publicRouteSettings',...target,management:true}));if(active()){value=result;refreshFields();status.textContent='已讀取最新設定';}});
  get('[data-public-copy]').onclick=()=>run(async()=>{let copied=false;try{await navigator.clipboard.writeText(currentUrl());copied=true;}catch{const input=get('[data-public-current]');input.focus();input.select();try{copied=document.execCommand?.('copy')===true;}catch{}}if(active())status.textContent=copied?'已複製':'請選取上方網址複製';});
  get('[data-public-preview]').onclick=()=>{if(!saving&&active()&&currentUrl())return share.open({name:kind==='hall'?(target.spaceId===initial.spaceId?initial.spaceName||'':''):(target.streamerId===initial.streamerId?initial.name||'主播':value.streamerSlug||'主播'),url:currentUrl(),kind}).catch(e=>toast(e.message));};
  form.onsubmit=event=>{event.preventDefault();if(event.isComposing||!form.reportValidity())return;run(async()=>{
   const requested=body(),result=verified(await api({op:'publicRouteSave',...requested,revision:value.revision}));
   if(typeof result.changed!=='boolean')throw Error('網址儲存結果尚未確認');
   if(active()){value=result;refreshFields();try{await onSaved(result);}catch{if(active())error.textContent='網址已儲存，畫面更新未完成，請重新讀取。';return;}if(active()){status.textContent=result.changed?'已儲存，舊網址仍有效。':'網址設定沒有變更。';toast(result.changed?'專屬網址已更新':'網址設定沒有變更');}}
  });};
  return {target,...value};
 }
 return {open,dispose(){generation++;}};
}
