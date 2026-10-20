import {HOME_KEY,normalizeHome,readHome,readLegacyHome,saveHome} from './pwa-start.js?v=10.20-PWA.1';
import {decodeInstallSource} from './pwa-install-source.js?v=10.20-PWA.1';

const text=(v,max=200)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const slug=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(v);
const scopeKey=home=>JSON.stringify(normalizeHome(home));
const reserved=new Set(['index.html','v2.html','lobby.html','app.html','manifest.webmanifest','api','src','assets','admin','login','settings','solo','pa.']);

// Server destination metadata is still checked at the browser boundary. No
// URL supplied by localStorage, a query token or a player is navigated directly.
export function publicHomeRow(value,mount){
 const home=normalizeHome(value);if(!home||value.active!==true||!text(value.name)||!text(value.spaceName)||typeof value.homePath!=='string'||value.homePath.length>1024||!value.homePath.startsWith('/')||value.homePath.startsWith('//')||/[\\\u0000-\u0020\u007f]/.test(value.homePath))throw Error('首頁資訊尚未確認，請重新讀取');
 const base=new URL(mount),u=new URL(value.homePath,base);
 if(u.origin!==base.origin||u.username||u.password)throw Error('首頁資訊尚未確認，請重新讀取');
 const canonical=value.canonicalPath??null;
 if(canonical!==null){
  if(typeof canonical!=='string'||!/^\/[A-Za-z0-9][A-Za-z0-9.-]{0,80}$/.test(canonical)||reserved.has(canonical.slice(1).toLowerCase())||u.pathname!==canonical||u.search||u.hash)throw Error('首頁資訊尚未確認，請重新讀取');
 }else if(home.kind==='streamer'){
  if(!slug(value.streamerSlug)||u.pathname!==new URL('v2.html',base).pathname||u.hash!=='#home'||u.searchParams.getAll('streamer').length!==1||u.searchParams.get('streamer')!==value.streamerSlug||[...u.searchParams.keys()].some(k=>!['streamer','spaceId'].includes(k))||u.searchParams.getAll('spaceId').length>1||u.searchParams.has('spaceId')&&u.searchParams.get('spaceId')!==home.spaceId||home.spaceId!=='space-001'&&u.searchParams.get('spaceId')!==home.spaceId)throw Error('首頁資訊尚未確認，請重新讀取');
 }else if(home.spaceId!=='space-001'||u.pathname!==new URL('lobby.html',base).pathname||u.search||u.hash)throw Error('首頁資訊尚未確認，請重新讀取');
 if(home.kind==='streamer'&&!slug(value.streamerSlug)||home.kind==='hall'&&value.streamerSlug!=null)throw Error('首頁資訊尚未確認，請重新讀取');
 return {...home,name:value.name,spaceName:value.spaceName,streamerSlug:value.streamerSlug??null,canonicalPath:canonical,homePath:u.pathname+u.search+u.hash,active:true};
}

function installFromHref(href){
 try{const query=new URL(href).searchParams;return query.getAll('install').length===1?decodeInstallSource(query.get('install')):null;}catch{return null;}
}
const copy=value=>JSON.parse(JSON.stringify(value));

export function createPwaLauncher({api,storage,mount,href=new URL('app.html',mount).href,navigate=()=>{},render=()=>{}}){
 if(typeof api!=='function')throw Error('APP 首頁連線尚未就緒');
 let state={phase:'idle',message:'',home:readHome(storage),items:[],q:'',kind:'all',page:1,pageSize:12,total:0,totalPages:1,busy:false},generation=0,lastAction=null,closed=false,selecting=false;
 const publish=changes=>{if(closed)return;state={...state,...changes};render(copy(state));};
 const resolve=async input=>{const home=normalizeHome(input);if(!home)throw Error('請選擇已開放的廳或主播');const value=await api({op:'publicAppHome',...home});if(value===null)return null;const row=publicHomeRow(value,mount);if(scopeKey(row)!==scopeKey(home))throw Error('首頁範圍已變更，請重新選擇');return row;};
 async function search({q=state.q,kind=state.kind,page=state.page}={}){
  if(closed||selecting)return;const query=typeof q==='string'?q.trim():null;
  if(query===null||query.length>100||!['all','streamer','hall'].includes(kind)||!Number.isSafeInteger(page)||page<1||page>10000)throw Error('搜尋內容或頁碼不正確');
  const turn=++generation;lastAction=()=>search({q:query,kind,page});publish({phase:'chooser',q:query,kind,page,busy:true,message:'',retryable:false});
  try{const result=await api({op:'publicAppHomes',q:query,kind,page,pageSize:12});if(closed||turn!==generation)return;
   if(!result||!Array.isArray(result.items)||result.items.length>12||result.pageSize!==12||!Number.isSafeInteger(result.total)||result.total<0||result.total>120000||result.totalPages!==Math.max(1,Math.ceil(result.total/12))||result.page!==Math.min(page,result.totalPages))throw Error('首頁清單尚未確認，請重新讀取');
   const items=result.items.map(value=>publicHomeRow(value,mount));
   if(new Set(items.map(scopeKey)).size!==items.length||items.some(row=>kind!=='all'&&row.kind!==kind)||result.total<items.length)throw Error('首頁清單尚未確認，請重新讀取');
   publish({items,page:result.page,total:result.total,totalPages:result.totalPages,busy:false,message:items.length?'':'沒有符合的公開廳或主播。'});
  }catch(error){if(!closed&&turn===generation)publish({phase:'chooser',busy:false,items:[],message:error.message||'連線暫時無法使用，請重試。',retryable:true});}
 }
 async function start({choose=false}={}){
  if(closed||selecting)return;const turn=++generation;lastAction=()=>start({choose});
  const existing=readHome(storage);publish({phase:'loading',home:existing,busy:true,message:'正在確認預設首頁…',retryable:false});
  if(choose)return search({q:'',kind:'all',page:1});
  let home=existing,source=null;
  if(!home){
   let hasRecord=false;try{hasRecord=storage?.getItem(HOME_KEY)!=null;}catch{}
   if(hasRecord)return search({q:'',kind:'all',page:1});
   const legacy=readLegacyHome(storage,mount);
   if(legacy?.requiresChoice)return search({q:'',kind:'all',page:1});
   if(legacy?.home){home=legacy.home;source='legacy';}
   else{home=installFromHref(href);source='install';}
  }
  if(!home)return search({q:'',kind:'all',page:1});
  try{const row=await resolve(home);if(closed||turn!==generation)return;
   if(!row){await search({q:'',kind:'all',page:1});if(!closed)publish({message:'原本的首頁目前無法使用，請選擇其他廳或主播。'});return;}
   if(source)saveHome(storage,row,{source});
   publish({phase:'ready',busy:false,home:readHome(storage)||row,message:''});navigate(new URL(row.homePath,mount).href);
  }catch(error){if(!closed&&turn===generation)publish({phase:'error',busy:false,home:existing||home,message:error.message||'目前無法連線，請稍後重試。',retryable:true});}
 }
 async function select(value,{enter=true}={}){
  if(closed||selecting)return false;const home=normalizeHome(value);if(!home)throw Error('請選擇已開放的廳或主播');
  selecting=true;const turn=++generation;lastAction=()=>select(home,{enter});publish({busy:true,message:'正在儲存預設首頁…',retryable:false});
  try{const row=await resolve(home);if(closed||turn!==generation)return false;if(!row)throw Error('此首頁目前無法使用，請選擇其他廳或主播');
   const record=saveHome(storage,row,{source:'user'});publish({phase:'ready',home:record,busy:false,message:'已更新預設首頁'});if(enter)navigate(new URL(row.homePath,mount).href);return true;
  }catch(error){if(!closed&&turn===generation)publish({phase:'chooser',busy:false,message:error.message||'無法儲存，請重試。',retryable:true});return false;}
  finally{selecting=false;}
 }
 return {start,search,select,retry:()=>lastAction?.(),snapshot:()=>copy(state),close(){closed=true;generation++;}};
}

// This view contains only public, bounded discovery and the device preference.
// It does not log in, switch accounts, clear storage or mutate business data.
export function mountPwaLauncher({document,window,api,storage,mount=new URL('../',import.meta.url)}){
 const root=document.querySelector('[data-app-launcher]');if(!root)throw Error('APP 首頁選擇器尚未就緒');
 const status=root.querySelector('[data-app-status]'),results=root.querySelector('[data-app-results]'),pager=root.querySelector('[data-app-pager]'),form=root.querySelector('[data-app-search]'),query=form.querySelector('input'),kind=form.querySelector('select'),retry=root.querySelector('[data-app-retry]'),choose=root.querySelector('[data-app-choose]'),current=root.querySelector('[data-app-current]');
 let launcher;
 const button=(label,fn,disabled=false)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=disabled;b.onclick=fn;return b;};
 const render=state=>{
  status.textContent=state.message;root.setAttribute('aria-busy',String(state.busy));form.hidden=state.phase!=='chooser';retry.hidden=!state.retryable;choose.hidden=!['error','ready'].includes(state.phase);current.textContent=state.home?.name?'目前設定：'+[state.home.spaceName,state.home.name].filter((v,i,a)=>v&&a.indexOf(v)===i).join(' · '):'選擇後，下次開啟 APP 會直接進入這裡。';
  query.value=state.q;kind.value=state.kind;for(const control of form.elements)control.disabled=state.busy;results.replaceChildren();pager.replaceChildren();
  if(state.phase!=='chooser')return;
  for(const row of state.items){const card=button('',()=>launcher.select(row),state.busy);card.className='app-home-option';const title=document.createElement('strong'),detail=document.createElement('small');title.textContent=row.name;detail.textContent=row.kind==='hall'?'大廳':row.spaceName+' · 主播';card.append(title,detail);results.append(card);}
  const label=document.createElement('label'),input=document.createElement('input');label.className='page-jump';label.append('第 ');input.type='number';input.min='1';input.max=String(state.totalPages);input.value=String(state.page);input.setAttribute('aria-label','首頁清單頁碼');input.disabled=state.busy;label.append(input,' 頁 / 共 '+state.totalPages+' 頁');
  const jump=()=>{const page=Number(input.value);if(!Number.isSafeInteger(page)||page<1||page>state.totalPages){input.reportValidity();return;}launcher.search({page});};
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();jump();}});
  pager.append(button('上一頁',()=>launcher.search({page:state.page-1}),state.busy||state.page<=1),label,button('跳頁',jump,state.busy),button('下一頁',()=>launcher.search({page:state.page+1}),state.busy||state.page>=state.totalPages));
 };
 launcher=createPwaLauncher({api,storage,mount,href:window.location.href,navigate:url=>window.location.replace(url),render});
 form.addEventListener('submit',event=>{event.preventDefault();if(!event.isComposing)launcher.search({q:query.value,kind:kind.value,page:1});});
 kind.addEventListener('change',()=>launcher.search({q:query.value,kind:kind.value,page:1}));retry.onclick=()=>launcher.retry();choose.onclick=()=>launcher.search({q:'',kind:'all',page:1});
 launcher.start({choose:new URL(window.location.href).searchParams.get('choose')==='1'});
 window.addEventListener('pagehide',event=>{if(!event.persisted)launcher.close();},{once:true});
 return launcher;
}
