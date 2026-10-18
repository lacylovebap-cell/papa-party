// Public destinations only. These names/links grant no Account/Space access.
// Add a group/individual only after its owner and canonical route are confirmed.
export const ENTRY_CATEGORIES=Object.freeze([['group','團體主播'],['individual','個體主播'],['hall','廳名']].map(Object.freeze));
export const ENTRY_DESTINATIONS=Object.freeze([Object.freeze({id:'shengma',kind:'hall',name:'聲瑪',page:'lobby.html'})]);
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function portalChoices(kind){return ENTRY_DESTINATIONS.filter(row=>row.kind===kind);}
export function portalEntryDestination(base,{kind,id,mode}){
 const row=portalChoices(kind).find(row=>row.id===id);
 if(!row||!['player','admin'].includes(mode))throw Error('請先選擇類別與名稱');
 const origin=new URL(base);if(!['https:','http:'].includes(origin.protocol)||origin.username||origin.password)throw Error('入口網址不正確');
 const url=new URL(row.page,origin);url.search='';url.hash='';url.searchParams.set('portalLogin',mode);return url.href;
}
export function mountPortalEntryPicker({document,href,navigate}){
 const dialog=document.querySelector('#portal-login-dialog');if(!dialog)return;
 const form=dialog.querySelector('form'),category=dialog.querySelector('[name=entryCategory]'),destination=dialog.querySelector('[name=entryDestination]'),hint=dialog.querySelector('[data-entry-hint]'),submit=dialog.querySelector('[type=submit]');
 let mode=null;
 category.innerHTML='<option value="">請選擇類別</option>'+ENTRY_CATEGORIES.map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join('');
 const reset=()=>{
  const rows=portalChoices(category.value),label=ENTRY_CATEGORIES.find(([key])=>key===category.value)?.[1];
  dialog.querySelector('[data-entry-name-label]').textContent=!label?'名稱':label==='廳名'?'廳名':label==='團體主播'?'團體名稱':'主播名稱';
  destination.innerHTML='<option value="">'+(rows.length?'請選擇名稱':'尚無可選名稱')+'</option>'+rows.map(row=>'<option value="'+escape(row.id)+'">'+escape(row.name)+'</option>').join('');
  destination.disabled=!rows.length;submit.disabled=true;
  hint.textContent=!category.value?'選擇你的廳、團體或主播。':rows.length?'進入後，使用原本的方式登入。':'目前尚無已開放的'+label+'入口。';
 };
 category.addEventListener('change',reset);
 destination.addEventListener('change',()=>{submit.disabled=!portalChoices(category.value).some(row=>row.id===destination.value);});
 const open=chosen=>{mode=chosen;category.value='';reset();dialog.querySelector('h2').textContent=mode==='admin'?'管理登入':'玩家登入';dialog.showModal();};
 document.addEventListener('click',event=>{
  const link=event.target.closest('[data-portal-login]');if(!link||!['player','admin'].includes(link.dataset.portalLogin))return;
  if(event.button>0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();open(link.dataset.portalLogin);
 });
 form.addEventListener('submit',event=>{event.preventDefault();if(submit.disabled)return;try{navigate(portalEntryDestination(href,{kind:category.value,id:destination.value,mode}));}catch(error){hint.textContent=error.message;}});
 dialog.querySelector('[data-entry-close]').addEventListener('click',()=>dialog.close());
 reset();
 const query=new URL(href).searchParams;
 if(query.getAll('entryLogin').length===1&&['player','admin'].includes(query.get('entryLogin')))open(query.get('entryLogin'));
}
