import {installed,normalizeHome,readHome,saveHome} from './pwa-start.js?v=10.20-PWA.1';
import {prepareInstallManifest,normalizeInstallSource} from './pwa-install-source.js?v=10.20-PWA.1';
import {API,PUBLISHABLE_KEY} from './config.js';
const mount=new URL('../',import.meta.url);
const safeStorage=environment=>{try{return environment.localStorage;}catch{return null;}};
const sameHome=(a,b)=>a?.kind===b?.kind&&a?.spaceId===b?.spaceId&&(a?.streamerId||null)===(b?.streamerId||null);
const title=row=>row?([row.spaceName,row.name].filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i).join(' · ')||'已指定首頁'):'尚未設定';
export function currentAppHome(room,{source=null,name='',spaceName='',enabled=true}={}){
 if(!enabled||room?.active===false)return null;
 const identity=normalizeInstallSource(source||{v:1,kind:'streamer',spaceId:room?.spaceId,streamerId:room?.id});
 return identity?{...identity,name:String(name||room?.display_name||room?.name||'').slice(0,120),spaceName:String(spaceName||'').slice(0,120)}:null;
}
/** Preparing an install source never changes the user's saved homepage. */
export function createAppHomeSettings({environment=globalThis,document=environment.document,storage=safeStorage(environment),mountUrl=mount,prepareManifest=prepareInstallManifest,api=async body=>{
 const response=await fetch(API,{method:'POST',headers:{'content-type':'application/json',apikey:PUBLISHABLE_KEY},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const value=await response.json();if(!response.ok||value?.error)throw Error(value?.error||'暫時無法連線，請稍後再試。');return value;
}}={}){
 let current=null,dialog=null,generation=0;
 const button=()=>installed(environment)?'<button type="button" data-pwa-start>預設開啟首頁</button>':'';
 const update=(room=null,href=environment.location?.href,options={})=>{
  current=currentAppHome(room,options);if(typeof options.prepareSource==='function')options.prepareSource(current);else prepareManifest({document,source:current,mountUrl});
  if(installed(environment)&&href){const url=new URL(environment.location.href);if(url.searchParams.has('pwaDefault')&&current){url.searchParams.delete('pwaDefault');environment.history?.replaceState(environment.history.state,'',url.href);}}
  return current;
 };
 async function show(){
  if(!installed(environment)||dialog?.open)return;
  const opened=++generation,active=()=>opened===generation&&dialog?.open;
  dialog=document.createElement('dialog');dialog.setAttribute('aria-label','預設開啟首頁');
  dialog.style.cssText='width:min(540px,94vw);max-height:90dvh;box-sizing:border-box;border:1px solid #857291;border-radius:16px;padding:0;background:var(--panel,#211b2b);color:var(--text,#f3edf8)';
  const el=(tag,text='',parent=dialog)=>{const n=document.createElement(tag);if(text)n.textContent=text;parent.append(n);return n;};
  const head=el('div');head.style.cssText='display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #ffffff20';
  el('h3','預設開啟首頁',head).style.cssText='margin:0;flex:1;font-size:1.05rem';
  const close=el('button','×',head);close.type='button';close.setAttribute('aria-label','關閉預設首頁設定');close.onclick=()=>dialog.close();
  const body=el('div');body.style.cssText='padding:16px 18px;max-height:calc(90dvh - 70px);overflow:auto';
  const currentLabel=el('p','目前設定：'+title(readHome(storage,mountUrl)),body),status=el('p','',body);status.setAttribute('role','status');status.style.cssText='font-size:.9rem;min-height:1.4em';
  const form=el('form','',body);form.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
  const kind=el('select','',form);kind.setAttribute('aria-label','首頁類型');for(const [value,label] of [['all','全部'],['streamer','主播'],['hall','廳']]){const option=el('option',label,kind);option.value=value;}
  const q=el('input','',form);q.type='search';q.maxLength=100;q.placeholder='搜尋主播或廳名稱';q.setAttribute('aria-label','搜尋預設首頁');q.style.cssText='min-width:0;flex:1;width:140px';
  const submit=el('button','搜尋',form);submit.type='submit';
  const useCurrent=el('button','選擇目前瀏覽的首頁',body);useCurrent.type='button';useCurrent.disabled=!current;useCurrent.style.marginTop='12px';
  const results=el('div','',body);results.style.cssText='display:grid;gap:8px;margin:12px 0';
  const pager=el('div','',body);pager.style.cssText='display:flex;align-items:center;gap:6px;flex-wrap:wrap';
  const previous=el('button','上一頁',pager),pages=el('span','第 1 頁／共 1 頁',pager),pageInput=el('input','',pager),jump=el('button','跳頁',pager),next=el('button','下一頁',pager);
  pageInput.type='number';pageInput.min='1';pageInput.max='1';pageInput.value='1';pageInput.style.width='54px';pageInput.setAttribute('aria-label','預設首頁結果頁碼');
  const selection=el('p','尚未選擇新首頁',body),save=el('button','儲存預設首頁',body);save.type='button';save.disabled=true;save.className='primary';
  el('p','儲存後，下次開啟 APP 會進入選定首頁。帳號與歌曲紀錄會保留。',body).style.cssText='font-size:.85rem;line-height:1.6;color:var(--muted,#bbb2c5)';
  let selected=null,page=1,totalPages=1,request=0,saving=false;
  const choose=row=>{selected=normalizeHome(row)?row:null;selection.textContent=selected?'將設為：'+title(selected):'尚未選擇新首頁';save.disabled=!selected||saving;};useCurrent.onclick=()=>choose(current);
  async function load(wanted=1){
   const attempt=++request;submit.disabled=true;status.textContent='搜尋中…';
   try{const value=await api({op:'publicAppHomes',q:q.value.trim(),kind:kind.value,page:wanted,pageSize:12});if(!active()||attempt!==request)return;
    if(!Array.isArray(value?.items)||!Number.isInteger(value.totalPages)||!Number.isInteger(value.page))throw Error('首頁清單暫時無法使用。');
    page=value.page;totalPages=Math.max(1,value.totalPages);results.replaceChildren();
    for(const row of value.items){if(row?.active!==true||!normalizeHome(row))continue;const item=el('button',title(row)+' · '+(row.kind==='hall'?'廳':'主播'),results);item.type='button';item.style.cssText='text-align:left;white-space:normal;padding:12px';item.onclick=()=>choose(row);}
    status.textContent=value.items.length?'':'沒有符合的公開首頁。';pages.textContent='第 '+page+' 頁／共 '+totalPages+' 頁';pageInput.value=String(page);pageInput.max=String(totalPages);previous.disabled=page<=1;next.disabled=page>=totalPages;
   }catch(error){if(active()&&attempt===request)status.textContent=error.message||'暫時無法搜尋，請重試。';}finally{if(active()&&attempt===request)submit.disabled=false;}
  }
  form.onsubmit=event=>{event.preventDefault();load(1);};kind.onchange=()=>load(1);previous.onclick=()=>load(Math.max(1,page-1));next.onclick=()=>load(Math.min(totalPages,page+1));
  const go=()=>{const n=Number(pageInput.value);if(!Number.isInteger(n)||n<1||n>totalPages){pageInput.reportValidity();return;}load(n);};jump.onclick=go;pageInput.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();go();}};
  save.onclick=async()=>{
   if(!selected||saving)return;saving=true;save.disabled=true;const target=normalizeHome(selected);
   try{const resolved=await api({op:'publicAppHome',...target});if(!active())return;if(resolved?.active!==true||!sameHome(resolved,target)||!normalizeHome(resolved))throw Error('此首頁目前無法使用，請重新選擇。');saveHome(storage,resolved,{source:'user'});currentLabel.textContent='目前設定：'+title(resolved);status.textContent='已儲存，下次開啟 APP 將使用此首頁。';}
   catch(error){if(active())status.textContent=error.message||'裝置目前無法儲存設定。';}finally{saving=false;if(active())save.disabled=!selected;}
  };
  dialog.addEventListener('close',()=>{generation++;dialog.remove();},{once:true});document.body.append(dialog);dialog.showModal();
  const pref=readHome(storage,mountUrl);if(pref)api({op:'publicAppHome',...normalizeHome(pref)}).then(row=>{if(active())currentLabel.textContent=row?.active===true?'目前設定：'+title(row):'原預設首頁目前無法使用，請重新選擇。';}).catch(()=>{if(active())currentLabel.textContent='目前設定：'+title(pref)+'（暫時無法確認狀態）';});
  await load(1);
 }
 return {button,update,show};
}
const controller=globalThis.document&&globalThis.window?createAppHomeSettings({environment:window}):null;
if(controller)document.addEventListener('click',event=>{if(event.target.closest('[data-pwa-start]'))controller.show();});
export function appStartButton(){return controller?.button()||'';}
export function updateAppStart(room=null,href=globalThis.location?.href,options={}){return controller?.update(room,href,options);}
