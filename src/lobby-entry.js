import {appStartButton,updateAppStart} from './pwa-start-ui.js?v=10.20-PWA.1';
import {createLobbyRoomRotation,installLobbyRoomRotation} from './lobby-room-rotation.js?v=10.20-WEB.1';
import {API,PUBLISHABLE_KEY} from './config.js?v=10.20-WEB.1';
import {createPublicLobby,installPublicLobbyLifecycle,lobbyRoomsHtml,lobbySongsHtml,LOBBY_VERSIONS} from './public-lobby.js?v=10.20-WEB.1';
import {createPublicShare} from './share-dialog.js';
import {createPublicLinkClient,readPublicRouteContext} from './public-links.js';
import {installLobbyTheme} from './lobby-theme.js?v=10.28-THEME.1';
import {lobbyPublicScope,lobbyLoginLocation,lobbyLoginIntent,lobbyLoginPrompt,openLobbyPublicShare} from './lobby-public-share.js';
const $=s=>document.querySelector(s),escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mountUrl=new URL('../',import.meta.url),context=readPublicRouteContext({document,href:location.href,mountUrl});
const scope=lobbyPublicScope({context,href:location.href,mountUrl});
if(scope.supported)startLobbyPage();
else{
 document.title='PA Party｜大廳尚未開放';
 $('main').innerHTML='<section class="card"><h1>此廳目前尚未開放</h1><p class="muted">請回官網選擇已開放的大廳。</p></section>';
 for(const selector of ['#lobby-player-login','#lobby-admin-login']){const link=$(selector);link.removeAttribute('href');link.setAttribute('aria-disabled','true');}
 $('#lobby-share').disabled=true;
}
function startLobbyPage(){
const notify=message=>{$('#lobby-entry-status').textContent=message;};
let loginMode=lobbyLoginIntent(location.href);
function showLoginPrompt(kind){
 loginMode=kind;
 const target=lobbyLoginLocation(location.href,kind);
 history.replaceState(history.state,'',target);
 for(const link of document.querySelectorAll('#rooms-results a,#songs-results a')){const url=new URL(link.href);url.searchParams.set('portalLogin',kind);link.href=url.href;}
 const loginPrompt=lobbyLoginPrompt(target,scope.name);
 const dialog=$('#dialog');
 dialog.innerHTML='<div class="dialog-head"><h2 id="lobby-login-title">請先選擇主播</h2></div><div class="dialog-body"><p>'+escape(loginPrompt)+'</p><button type="button" data-login-confirm autofocus>確認</button></div>';
 dialog.setAttribute('aria-labelledby','lobby-login-title');
 dialog.querySelector('[data-login-confirm]').onclick=()=>{dialog.close();$('#lobby-room-q').focus();};
 dialog.addEventListener('close',()=>dialog.removeAttribute('aria-labelledby'),{once:true});
 dialog.showModal();
}
$('#lobby-player-login').href=lobbyLoginLocation(location.href,'player');
$('#lobby-admin-login').href=lobbyLoginLocation(location.href,'admin');
for(const kind of ['player','admin'])$('#lobby-'+kind+'-login').onclick=event=>{event.preventDefault();showLoginPrompt(kind);};
const api=async body=>{
 const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json',apikey:PUBLISHABLE_KEY},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)}),value=await response.json();
 if(!response.ok||value.error)throw Error(value.error||'連線暫時無法使用，請稍後重試');return value;
};
installLobbyTheme({api,spaceId:scope.spaceId,document,hallName:scope.name}).catch(()=>{});
const links=createPublicLinkClient({api}),share=createPublicShare({modal:(title,body)=>{
 const dialog=$('#dialog');dialog.innerHTML='<div class="dialog-head"><h2>'+escape(title)+'</h2><button type="button" aria-label="關閉" data-share-close>✕</button></div><div class="dialog-body">'+body+'</div>';
 dialog.querySelector('[data-share-close]').onclick=()=>dialog.close();if(!dialog.open)dialog.showModal();
},toast:notify});
$('#lobby-share').onclick=async()=>{
 const button=$('#lobby-share');if(button.disabled)return;button.disabled=true;
 try{await openLobbyPublicShare({scope,links,share});}catch(error){notify(error.message||'大廳專屬網址尚未啟用');}finally{button.disabled=false;}
};
let composing=false;const timers={rooms:null,songs:null};
function optionList(input,rows,selected,defaultLabel){
 const choices=[...new Set((rows||[]).filter(x=>typeof x==='string'&&x&&x.length<=100))];
 if(selected&&!choices.includes(selected))choices.push(selected);
 input.innerHTML='<option value="">'+defaultLabel+'</option>'+choices.map(x=>'<option value="'+escape(x)+'" '+(x===selected?'selected':'')+'>'+escape(x)+'</option>').join('');
}
let roomRotation;
const lobby=createPublicLobby({roomPageSize:3,href:location.href,replaceLocation:url=>history.replaceState(null,'',loginMode?lobbyLoginLocation(url,loginMode):url),api,render:(kind,value,q)=>{
 $('#'+kind+'-results').innerHTML=kind==='rooms'?lobbyRoomsHtml(value,location.href):lobbySongsHtml(value,location.href);
 if(kind==='rooms')roomRotation?.sync();
 if(kind==='songs'){
  optionList($('#lobby-language'),value.filters?.languages,q.language,'全部語言');
  optionList($('#lobby-performer'),value.filters?.performerTypes,q.performerType,'全部類型');
  for(const b of document.querySelectorAll('[data-lobby-sort]'))b.setAttribute('aria-pressed',String(b.dataset.lobbySort===q.sort));
 }
}});
const initial=lobby.state();$('#lobby-q').value=initial.q;$('#lobby-room-q').value=initial.roomQ;
$('#lobby-version').innerHTML=LOBBY_VERSIONS.map(([key,label])=>'<option value="'+key+'" '+(initial.versionKind===key?'selected':'')+'>'+label+'</option>').join('');
const search=kind=>{clearTimeout(timers[kind]);return lobby.update(kind==='rooms'?{roomQ:$('#lobby-room-q').value}:{q:$('#lobby-q').value});};
document.addEventListener('submit',e=>{const kind=e.target.dataset.lobbySearch;if(kind){e.preventDefault();if(!composing)search(kind);}});
document.addEventListener('compositionstart',()=>{composing=true;});
document.addEventListener('compositionend',e=>{composing=false;if(e.target.id==='lobby-q'||e.target.id==='lobby-room-q'){const kind=e.target.id==='lobby-q'?'songs':'rooms';clearTimeout(timers[kind]);timers[kind]=setTimeout(()=>search(kind),400);}});
document.addEventListener('input',e=>{if(composing||e.isComposing)return;const kind=e.target.id==='lobby-q'?'songs':e.target.id==='lobby-room-q'?'rooms':null;if(kind){clearTimeout(timers[kind]);timers[kind]=setTimeout(()=>search(kind),400);}});
document.addEventListener('change',e=>{const key=({'lobby-language':'language','lobby-performer':'performerType','lobby-version':'versionKind'})[e.target.id];if(key){clearTimeout(timers.songs);lobby.update({[key]:e.target.value,q:$('#lobby-q').value});}});
function jump(kind){const input=document.querySelector('[data-lobby-jump="'+kind+'"]'),n=Number(input?.value),max=Number(input?.max);if(!Number.isInteger(n)||n<1||n>max){input?.reportValidity();return;}lobby.update({[kind==='rooms'?'roomPage':'page']:n-1});}
document.addEventListener('click',e=>{const button=e.target.closest('button');if(!button)return;
 if(button.dataset.lobbyPage)lobby.update({[button.dataset.lobbyPage==='rooms'?'roomPage':'page']:Number(button.dataset.page)});
 if(button.dataset.lobbyJumpButton)jump(button.dataset.lobbyJumpButton);
 if(button.dataset.lobbyRetry)lobby.retry(button.dataset.lobbyRetry);
 if(button.dataset.lobbySort){clearTimeout(timers.songs);lobby.update({sort:button.dataset.lobbySort,q:$('#lobby-q').value});}
});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&e.target.dataset.lobbyJump){e.preventDefault();jump(e.target.dataset.lobbyJump);}});
installPublicLobbyLifecycle({lobby,cancelSearch:()=>{Object.values(timers).forEach(clearTimeout);share.dispose();}});
roomRotation=createLobbyRoomRotation({snapshot:()=>({...lobby.roomSnapshot(),...(lobby.state().roomQ?{total:0}:{})}),advance:()=>lobby.rotateRooms()});
installLobbyRoomRotation({document,window,region:document.querySelector('[data-lobby-room-section]'),rotation:roomRotation});
lobby.start();
document.querySelector('header .header-inner')?.insertAdjacentHTML('beforeend',appStartButton());
updateAppStart(null,new URL('lobby.html',mountUrl).href,{source:{v:1,kind:'hall',spaceId:scope.spaceId,streamerId:null},name:scope.name,spaceName:scope.name});
}
