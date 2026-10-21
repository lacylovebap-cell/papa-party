import {installCompactMenu} from './compact-menu.js?v=1021-menu-3';
import {readPublicRouteContext} from './public-links.js';
import {streamerAdminDestination} from './streamer-admin-route.js';

const mountUrl=new URL('../',import.meta.url).href;
const header=document.getElementById('header');
if(header){
 const decorate=()=>{
  const menu=header.querySelector('.header-menu');if(!menu)return;
  if(!menu.classList.contains('compact-main-menu'))installCompactMenu({document,window,route:location.hash.slice(1)});
  // Native navigation works even when app.js is an older cached version.
  // Keep platformOpen untouched and use the original admin button visibility.
  const buttons=[...menu.querySelectorAll('button[data-act="admin"]')];
  // A player login must not hide the ordinary manager login door. Access to
  // the destination still uses the existing authenticated manager checks.
  if(!buttons.length&&!menu.querySelector('a[data-streamer-admin]')){
   const account=[...menu.querySelectorAll('section')].find(section=>section.querySelector('h3')?.textContent==='帳號與管理')?.querySelector('.compact-menu-items');
   if(account){const button=document.createElement('button');button.className='tiny';account.append(button);buttons.push(button);}
  }
  for(const button of buttons){
   const link=document.createElement('a');link.className=button.className;
   link.dataset.streamerAdmin='';link.textContent='主播後台';
   link.href=streamerAdminDestination(location.href,{mountUrl,context:readPublicRouteContext({document,href:location.href,mountUrl})});
   button.replaceWith(link);
  }
  const style=document.getElementById('compact-menu-styles'),href=new URL('./compact-menu.css?v=1021-menu-3',import.meta.url).href;
  if(style&&style.href!==href)style.href=href;
 };
 const observer=new MutationObserver(decorate);
 observer.observe(header,{childList:true});
 decorate();
}
