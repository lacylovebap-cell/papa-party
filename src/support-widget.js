// 全站共用浮動贊助入口。每個頁面只掛載一次，不改動任何既有導覽或按鈕。
// 這個模組只做三件事：載入自己的樣式、插入右下角入口、記住收合狀態。
const VERSION='11.15-SUPPORT.1';
const STORE='papa-support-dock';
const LABEL='支持 PA Party';

// 付款處理頁與回傳頁不顯示入口，避免干擾金流流程。
// 已經在支持頁、付款處理頁或回傳頁時不顯示入口。
const BLOCKED_PATH=/(?:^|\/)(?:404\.html|support\.html|support|support-return|support-result)(?:$|[/?#])|\/payment(?:$|[/?#])/i;
const BLOCKED_PARAM=['MerchantTradeNo','CheckMacValue','RtnCode','paymentReturn'];

export function supportPageUrl(baseUrl=import.meta.url){
 return new URL('../support.html',baseUrl).href;
}

export function dockAllowed(location,{inFrame=false}={}){
 if(inFrame)return false;
 let url;
 try{url=new URL(location.href);}catch{return false;}
 if(BLOCKED_PATH.test(url.pathname))return false;
 for(const key of BLOCKED_PARAM)if(url.searchParams.has(key))return false;
 return true;
}

function readCollapsed(){
 try{return localStorage.getItem(STORE)==='collapsed';}catch{return false;}
}
function writeCollapsed(value){
 try{value?localStorage.setItem(STORE,'collapsed'):localStorage.removeItem(STORE);}catch{/* 無痕視窗或封鎖儲存時忽略 */}
}

export function supportDockElement(doc,{href,collapsed=false}={}){
 const dock=doc.createElement('div');
 dock.className='pa-support-dock';
 dock.dataset.collapsed=collapsed?'true':'false';
 dock.setAttribute('aria-label','支持 PA Party');
 const open=doc.createElement('a');
 open.className='pa-support-open';
 open.href=href;
 open.dataset.supportOpen='1';
 open.title=LABEL;
 open.setAttribute('aria-label',LABEL);
 const heart=doc.createElement('span');
 heart.className='pa-support-heart';heart.setAttribute('aria-hidden','true');heart.textContent='♡';
 const label=doc.createElement('span');
 label.className='pa-support-label';label.textContent=LABEL;
 open.append(heart,label);
 const toggle=doc.createElement('button');
 toggle.type='button';
 toggle.className='pa-support-collapse';
 toggle.dataset.supportCollapse='1';
 toggle.textContent='×';
 toggle.title='收合支持入口';
 toggle.setAttribute('aria-label','收合支持入口');
 dock.append(open,toggle);
 return dock;
}

export function mountSupportDock(doc=document,win=window){
 if(!doc?.body||doc.querySelector('.pa-support-dock'))return null;
 if(!dockAllowed(win.location,{inFrame:win.top!==win.self}))return null;
 const dock=supportDockElement(doc,{href:supportPageUrl(),collapsed:readCollapsed()});
 dock.addEventListener('click',event=>{
  const collapse=event.target.closest?.('[data-support-collapse]');
  if(collapse){event.preventDefault();dock.dataset.collapsed='true';writeCollapsed(true);return;}
  if(dock.dataset.collapsed==='true'&&event.target.closest?.('[data-support-open]')){
   event.preventDefault();dock.dataset.collapsed='false';writeCollapsed(false);
  }
 });
 doc.body.append(dock);
 return dock;
}

function loadStyle(doc){
 const href=new URL('./support-widget.css?v='+VERSION,import.meta.url).href;
 if(doc.querySelector('link[data-support-widget]'))return;
 const link=doc.createElement('link');
 link.rel='stylesheet';link.href=href;link.dataset.supportWidget='1';
 doc.head.append(link);
}

if(typeof document!=='undefined'&&typeof window!=='undefined'){
 const start=()=>{loadStyle(document);mountSupportDock(document,window);};
 document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start,{once:true}):start();
}
