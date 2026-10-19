import {installed,pagePreference,readPreference,PREFERENCE_KEY,PROMPT_KEY} from './pwa-start.js';
const mount=new URL('../',import.meta.url);
let current=null,dialog=null;
const targetedEntry=['notificationId','entityId','commonRequest','portalLogin'].some(key=>new URL(location.href).searchParams.has(key));
const storage=()=>{try{return localStorage;}catch{return null;}};
export function appStartButton(){return installed(window)?'<button type="button" data-pwa-start>APP 開啟位置</button>':'';}
function show(offer=false){
 if(!installed(window)||dialog?.open)return;
 const chosen=current;
 dialog=document.createElement('dialog');dialog.setAttribute('aria-label','APP 開啟位置');
 dialog.style.cssText='max-width:min(420px,90vw);box-sizing:border-box;border:1px solid #857291;border-radius:16px;padding:22px;background:var(--panel,#211b2b);color:var(--text,#f3edf8)';
 const title=document.createElement('h3');title.textContent=offer?'要將此頁設定為每次開啟 APP 的預設位置嗎？':'APP 開啟位置';dialog.append(title);
 const info=document.createElement('p');info.style.overflowWrap='anywhere';info.textContent='目前設定：'+(readPreference(storage(),mount)?.path||'PA Party 官方首頁');dialog.append(info);
 const add=(label,fn,disabled=false)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=disabled;b.style.cssText='margin:6px;padding:9px;border:1px solid #857291;border-radius:8px;color:inherit;background:transparent';b.onclick=fn;dialog.append(b);};
 const save=value=>{try{if(!value)throw Error();storage().setItem(PREFERENCE_KEY,JSON.stringify(value));storage().setItem(PROMPT_KEY,'1');dialog.close();}catch{info.textContent='裝置目前無法儲存設定，請稍後再試。';}};
 add(offer?'設為預設首頁':'將目前頁面設為預設開啟位置',()=>save(chosen),!chosen);
 if(!offer)add('恢復為 PA Party 官方首頁',()=>save({version:1,kind:'portal',path:mount.pathname}));
 add(offer?'稍後再說':'關閉',()=>dialog.close());
 dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
document.addEventListener('click',event=>{if(event.target.closest('[data-pwa-start]'))show();});
export function updateAppStart(room=null){
 if(!installed(window))return;
 current=pagePreference(location.href,mount,room);
 const u=new URL(location.href);
 if(u.searchParams.has('pwaDefault')){
  const pref=readPreference(storage(),mount);
  if(!current||pref?.streamerId!==room?.id||pref?.spaceId!==room?.spaceId){location.replace(mount.href);return;}
  u.searchParams.delete('pwaDefault');history.replaceState(history.state,'',u.href);
 }
 if(!current||current.kind==='portal'||targetedEntry||document.querySelector('dialog[open]'))return;
 try{if(storage()?.getItem(PROMPT_KEY)||readPreference(storage(),mount))return;storage().setItem(PROMPT_KEY,'1');}catch{return;}
 show(true);
}
