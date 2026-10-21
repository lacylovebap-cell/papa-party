// Decorates only the application menu. Existing action nodes retain their handlers.
export function installCompactMenu({document,window,route,hallNavigation,spaceId}) {
 const menu=document.querySelector('.header-menu'),panel=menu?.querySelector('.header-actions');if(!panel)return;
 window.__paMenuCleanup?.();
 menu.classList.add('compact-main-menu');menu.open=false;
 const summary=menu.querySelector('summary');summary.setAttribute('aria-label','開啟選單');
 const icon=document.createElement('span');icon.className='compact-menu-icon';icon.setAttribute('aria-hidden','true');
 for(let i=0;i<3;i++)icon.append(document.createElement('span'));
 summary.replaceChildren(icon);summary.setAttribute('aria-expanded','false');
 // A same-header reinstall should regroup the original action nodes rather
 // than nesting the previous sections inside the tools section.
 const originals=[...panel.children].flatMap(node=>node.matches('section')?[...node.querySelectorAll('.compact-menu-items')].flatMap(items=>[...items.children]):[node]);panel.replaceChildren(...originals);
 for(const node of [...panel.children])if(node.dataset.act===route&&['home','book','common-book','center','admin'].includes(route))node.remove();
 const groups=[['主要導覽','[data-act="home"],[data-act="book"],[data-act="common-book"],.lobby-button,[data-act="center"]'],['互動功能','[data-open-chat],[data-open-board],[data-act="publicShare"]'],['帳號與管理','[data-act="login"],[data-act="logout"],[data-act="admin"],[data-act="switchSpace"]']];
 const sections=[];let navigationSection=null;
 for(const [label,selector] of groups){const nodes=[...panel.children].filter(n=>n.matches(selector));if(!nodes.length)continue;const section=document.createElement('section'),heading=document.createElement('h3'),items=document.createElement('div');heading.textContent=label;items.className='compact-menu-items';items.append(...nodes);section.append(heading,items);sections.push(section);if(label==='主要導覽')navigationSection=items;}
 const remaining=[...panel.children];if(remaining.length){const section=document.createElement('section'),heading=document.createElement('h3'),items=document.createElement('div');heading.textContent='設定與工具';items.className='compact-menu-items';items.append(...remaining);section.append(heading,items);sections.splice(Math.min(2,sections.length),0,section);}
 panel.replaceChildren(...sections);
 let watcher=null,disposed=false,hallRequested=false;
 const close=()=>{menu.open=false;watcher?.destroy();watcher=null;summary.setAttribute('aria-expanded','false');summary.setAttribute('aria-label','開啟選單');};
 async function loadHall(){
  if(hallRequested||!hallNavigation||!spaceId)return;hallRequested=true;
  try{const hall=await hallNavigation.get(spaceId);if(disposed||!menu.isConnected||!hall)return;
   if(!navigationSection){const section=document.createElement('section'),heading=document.createElement('h3');heading.textContent='主要導覽';navigationSection=document.createElement('div');navigationSection.className='compact-menu-items';section.append(heading,navigationSection);panel.prepend(section);}
   const link=document.createElement('a');link.className='lobby-button';link.href=hall.url;link.textContent=hall.name.endsWith('大廳')?hall.name:hall.name+'大廳';navigationSection.querySelector('.lobby-button')?.remove();navigationSection.append(link);
  }catch{hallRequested=false;}
 }
 const toggle=()=>{summary.setAttribute('aria-expanded',String(menu.open));summary.setAttribute('aria-label',menu.open?'關閉選單':'開啟選單');if(menu.open){document.querySelectorAll('.compact-main-menu[open]').forEach(other=>{if(other!==menu)other.open=false;});if(!watcher&&window.CloseWatcher){try{watcher=new window.CloseWatcher();watcher.addEventListener('close',close);}catch{watcher=null;}}resize();loadHall();}else{watcher?.destroy();watcher=null;}};
 const outside=e=>{if(menu.open&&!menu.contains(e.target))close();};
 const key=e=>{if(e.key==='Escape'&&menu.open){e.preventDefault();close();summary.focus();}};
 const resize=()=>{const top=summary.getBoundingClientRect().bottom;panel.style.maxHeight=Math.max(44,(window.visualViewport?.height||window.innerHeight)-top-24)+'px';};
 const click=e=>{if(e.target.closest?.('a[href]'))close();};
 // A successful action may open a dialog without changing the route. Observe
 // only that state transition, so scrolling/selecting within the menu is safe.
 const dialogObserver=window.MutationObserver?new window.MutationObserver(records=>{if(menu.open&&records.some(record=>record.type==='attributes'&&record.target.matches?.('dialog[open]')||record.type==='childList'&&[...record.addedNodes].some(node=>node.matches?.('dialog[open]')||node.querySelector?.('dialog[open]'))))close();}):null;
 dialogObserver?.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
 menu.addEventListener('toggle',toggle);menu.addEventListener('click',click);document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);window.addEventListener('popstate',close);window.addEventListener('hashchange',close);window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);resize();
 window.__paMenuCleanup=()=>{disposed=true;close();dialogObserver?.disconnect();menu.removeEventListener('toggle',toggle);menu.removeEventListener('click',click);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);window.removeEventListener('popstate',close);window.removeEventListener('hashchange',close);window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);};
 if(!document.querySelector('#compact-menu-styles')){const link=document.createElement('link');link.id='compact-menu-styles';link.rel='stylesheet';link.href=new URL('./compact-menu.css?v=1021-menu-2',import.meta.url).href;document.head.append(link);}
}
