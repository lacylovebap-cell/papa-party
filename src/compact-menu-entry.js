import {installCompactMenu} from './compact-menu.js?v=1021-menu-3';

// Load independently of app.js so an older cached app can rebuild the header
// without reverting the menu. Watch only replacement of the header's children;
// regrouping menu items cannot recursively trigger this observer.
const header=document.getElementById('header');
if(header){
 const decorate=()=>{
  const menu=header.querySelector('.header-menu');if(!menu)return;
  if(!menu.classList.contains('compact-main-menu'))installCompactMenu({document,window,route:location.hash.slice(1)});
  const style=document.getElementById('compact-menu-styles'),href=new URL('./compact-menu.css?v=1021-menu-3',import.meta.url).href;
  if(style&&style.href!==href)style.href=href;
 };
 const observer=new MutationObserver(decorate);
 observer.observe(header,{childList:true});
 decorate();
}
