// The website's 管理登入／玩家登入 picker. Categories match the management
// centre (廳／獨立主播); the names are the open Spaces the server lists
// (portalDirectory: names and room slugs only). A choice only opens that Space's
// login form: membership and permissions stay server-verified.
import {API,PUBLISHABLE_KEY} from './config.js?v=10.20-WEB.1';

export const ENTRY_CATEGORIES=Object.freeze([['hall','廳'],['independent','獨立主播']].map(Object.freeze));
// 聲瑪 keeps its hall lobby as the login page, and stays available even when
// the list cannot be loaded.
const SHENGMA=Object.freeze({id:'space-001',kind:'hall',name:'聲瑪',page:'lobby.html'});
export const ENTRY_DESTINATIONS=Object.freeze([SHENGMA]);
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,39}$/.test(value);
const spaceId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value);

/** Turns the server list into picker rows; anything malformed is skipped. */
export function portalDestinations(spaces){
 const rows=(Array.isArray(spaces)?spaces:[]).flatMap(space=>{
  if(!space||!spaceId(space.id)||typeof space.name!=='string'||!space.name.trim()||!['hall','independent'].includes(space.kind))return [];
  if(space.id==='space-001')return [{...SHENGMA,name:space.name.trim()==='PA Party'?'聲瑪':space.name.trim()}];
  const room=(Array.isArray(space.streamers)?space.streamers:[]).find(r=>slug(r?.slug));
  return room?[{id:space.id,kind:space.kind,name:space.name.trim().slice(0,100),page:'v2.html',streamer:room.slug}]:[];
 });
 if(!rows.some(row=>row.id==='space-001'))rows.unshift(SHENGMA);
 return rows;
}
export function portalChoices(kind,destinations=ENTRY_DESTINATIONS){return destinations.filter(row=>row.kind===kind);}
export function portalEntryDestination(base,{kind,id,mode},destinations=ENTRY_DESTINATIONS){
 const row=portalChoices(kind,destinations).find(row=>row.id===id);
 if(!row||!['player','admin'].includes(mode))throw Error('請先選擇類別與名稱');
 const origin=new URL(base);if(!['https:','http:'].includes(origin.protocol)||origin.username||origin.password)throw Error('入口網址不正確');
 const url=new URL(row.page,origin);url.search='';url.hash='';
 if(row.streamer)url.searchParams.set('streamer',row.streamer);
 url.searchParams.set('portalLogin',mode);return url.href;
}
async function fetchDirectory(){
 const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json',apikey:PUBLISHABLE_KEY},body:JSON.stringify({op:'portalDirectory'})});
 const data=await r.json();if(!r.ok||data.error)throw Error(data.error||'名單讀取失敗');return data.spaces;
}
export function mountPortalEntryPicker({document,href,navigate,loadDirectory=fetchDirectory}){
 const dialog=document.querySelector('#portal-login-dialog');if(!dialog)return;
 const form=dialog.querySelector('form'),category=dialog.querySelector('[name=entryCategory]'),destination=dialog.querySelector('[name=entryDestination]'),hint=dialog.querySelector('[data-entry-hint]'),submit=dialog.querySelector('[type=submit]');
 let mode=null,destinations=ENTRY_DESTINATIONS,loading=null;
 category.innerHTML='<option value="">請選擇類別</option>'+ENTRY_CATEGORIES.map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join('');
 const reset=()=>{
  const rows=portalChoices(category.value,destinations),label=ENTRY_CATEGORIES.find(([key])=>key===category.value)?.[1];
  dialog.querySelector('[data-entry-name-label]').textContent=!label?'名稱':label==='廳'?'廳名':'主播名稱';
  destination.innerHTML='<option value="">'+(rows.length?'請選擇名稱':'尚無可選名稱')+'</option>'+rows.map(row=>'<option value="'+escape(row.id)+'">'+escape(row.name)+'</option>').join('');
  destination.disabled=!rows.length;submit.disabled=true;
  hint.textContent=!category.value?'選擇你的廳或獨立主播。':rows.length?'進入後，使用原本的方式登入。':loading?'名單讀取中…':'目前尚無已開放的'+label+'入口。';
 };
 // The list is read once, when someone first opens the picker.
 const refreshList=()=>{if(loading)return loading;loading=Promise.resolve().then(loadDirectory).then(spaces=>{destinations=portalDestinations(spaces);}).catch(()=>{}).finally(()=>{const value=destination.value;reset();if(portalChoices(category.value,destinations).some(row=>row.id===value)){destination.value=value;submit.disabled=false;}});return loading;};
 category.addEventListener('change',reset);
 destination.addEventListener('change',()=>{submit.disabled=!portalChoices(category.value,destinations).some(row=>row.id===destination.value);});
 const open=chosen=>{mode=chosen;category.value='';reset();dialog.querySelector('h2').textContent=mode==='admin'?'管理登入':'玩家登入';dialog.showModal();void refreshList();};
 document.addEventListener('click',event=>{
  const link=event.target.closest('[data-portal-login]');if(!link||!['player','admin'].includes(link.dataset.portalLogin))return;
  if(event.button>0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();open(link.dataset.portalLogin);
 });
 form.addEventListener('submit',event=>{event.preventDefault();if(submit.disabled)return;try{navigate(portalEntryDestination(href,{kind:category.value,id:destination.value,mode},destinations));}catch(error){hint.textContent=error.message;}});
 dialog.querySelector('[data-entry-close]').addEventListener('click',()=>dialog.close());
 reset();
 const query=new URL(href).searchParams;
 if(query.getAll('entryLogin').length===1&&['player','admin'].includes(query.get('entryLogin')))open(query.get('entryLogin'));
 return {ready:()=>loading||Promise.resolve()};
}
