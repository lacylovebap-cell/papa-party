import {API,PUBLISHABLE_KEY} from './config.js?v=10.17-WEB.1';
import {createPublicLobby,installPublicLobbyLifecycle,lobbyRoomsHtml,lobbySongsHtml,LOBBY_VERSIONS} from './public-lobby.js?v=10.17-WEB.1';
const $=s=>document.querySelector(s),escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let composing=false;const timers={rooms:null,songs:null};
function optionList(input,rows,selected,defaultLabel){
 const choices=[...new Set((rows||[]).filter(x=>typeof x==='string'&&x&&x.length<=100))];
 if(selected&&!choices.includes(selected))choices.push(selected);
 input.innerHTML='<option value="">'+defaultLabel+'</option>'+choices.map(x=>'<option value="'+escape(x)+'" '+(x===selected?'selected':'')+'>'+escape(x)+'</option>').join('');
}
const lobby=createPublicLobby({href:location.href,replaceLocation:url=>history.replaceState(null,'',url),api:async body=>{
 const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json',apikey:PUBLISHABLE_KEY},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)}),value=await response.json();
 if(!response.ok||value.error)throw Error(value.error||'連線暫時無法使用，請稍後重試');return value;
},render:(kind,value,q)=>{
 $('#'+kind+'-results').innerHTML=kind==='rooms'?lobbyRoomsHtml(value,location.href):lobbySongsHtml(value,location.href);
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
installPublicLobbyLifecycle({lobby,cancelSearch:()=>Object.values(timers).forEach(clearTimeout)});
lobby.start();
