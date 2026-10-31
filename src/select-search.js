// Every <select> on the site gets type-to-search without changing its size or layout:
// the select itself stays exactly where it is; tapping it opens a small panel with a
// search box and the options instead of the browser's own list. Picking an option
// sets the select's value and fires input/change, so forms and handlers are unchanged.
// Pure client-side: no request, no storage. Opt out with data-no-search.
const textOf=o=>String(o?.textContent||'').replace(/\s+/g,' ').trim();
const usable=select=>[...select.options].filter(o=>!o.hidden&&!o.disabled);
const eligible=el=>el instanceof HTMLSelectElement&&!el.multiple&&!(el.size>1)&&!el.disabled&&el.dataset.noSearch===undefined&&!el.closest('[data-no-search]');
let panel=null,owner=null;
function close(focus=false){if(!panel)return;const s=owner;panel.remove();panel=null;owner=null;removeEventListener('resize',onMove);removeEventListener('scroll',onMove,true);if(focus)s?.focus({preventScroll:true});}
function onMove(e){if(panel&&!panel.contains(e.target))close();}
function choose(select,option){close(true);if(!option||select.value===option.value)return;select.value=option.value;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
function place(select){
 const r=select.getBoundingClientRect(),vh=innerHeight,vw=innerWidth,width=Math.min(Math.max(r.width,220),vw-16),left=Math.min(Math.max(8,r.left),vw-width-8);
 const below=vh-r.bottom,above=r.top,maxH=Math.max(180,Math.min(360,Math.max(below,above)-12));
 Object.assign(panel.style,{left:left+'px',width:width+'px',maxHeight:maxH+'px'});
 if(below>=Math.min(maxH,240)||below>=above)Object.assign(panel.style,{top:(r.bottom+4)+'px',bottom:''});else Object.assign(panel.style,{top:'',bottom:(vh-r.top+4)+'px'});
}
function open(select){
 close();owner=select;
 panel=document.createElement('div');panel.className='ss-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label',select.getAttribute('aria-label')||'搜尋或選擇');
 panel.innerHTML='<input type="search" class="ss-search" autocomplete="off" enterkeyhint="search" placeholder="🔍 搜尋…"><div class="ss-options" role="listbox"></div>';
 const search=panel.querySelector('input'),list=panel.querySelector('.ss-options');
 const render=()=>{const q=search.value.trim().toLowerCase(),opts=usable(select).filter(o=>!q||textOf(o).toLowerCase().includes(q));
  list.replaceChildren(...opts.map(o=>{const b=document.createElement('button');b.type='button';b.className='ss-option'+(o.selected?' selected':'');b.setAttribute('role','option');b.setAttribute('aria-selected',String(o.selected));b.textContent=textOf(o)||'（空白）';b.addEventListener('click',()=>choose(select,o));return b;}));
  if(!opts.length){const p=document.createElement('p');p.className='ss-empty';p.textContent='找不到符合的選項';list.append(p);}};
 search.addEventListener('input',render);
 search.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Escape'){e.preventDefault();close(true);}else if(e.key==='Enter'){e.preventDefault();const first=list.querySelector('.ss-option');if(first)first.click();}else if(e.key==='ArrowDown'){e.preventDefault();list.querySelector('.ss-option')?.focus();}});
 list.addEventListener('keydown',e=>{const items=[...list.querySelectorAll('.ss-option')],i=items.indexOf(document.activeElement);if(e.key==='ArrowDown'&&i>=0){e.preventDefault();items[Math.min(items.length-1,i+1)].focus();}else if(e.key==='ArrowUp'&&i>=0){e.preventDefault();(i?items[i-1]:search).focus();}else if(e.key==='Escape'){e.preventDefault();close(true);}});
 (select.closest('dialog[open]')||document.body).append(panel);render();place(select);
 list.querySelector('.ss-option.selected')?.scrollIntoView({block:'nearest'});
 addEventListener('resize',onMove);addEventListener('scroll',onMove,true);
 // Long lists get the keyboard right away; short ones avoid popping the phone keyboard.
 if(usable(select).length>8||!matchMedia('(pointer:coarse)').matches)search.focus({preventScroll:true});
}
export function installSelectSearch(target=document){
 const root=target?.ownerDocument&&target!==target.ownerDocument?target.ownerDocument:target;
 if(!root||root.__selectSearch)return;root.__selectSearch=true;
 root.addEventListener('pointerdown',e=>{
  if(panel&&!panel.contains(e.target)&&e.target!==owner)close();
  const s=e.target.closest?.('select');if(!eligible(s)||e.button>0)return;
  e.preventDefault();if(owner===s){close(true);return;}s.focus({preventScroll:true});open(s);
 },true);
 root.addEventListener('keydown',e=>{const s=e.target;if(!eligible(s)||e.isComposing)return;
  if(e.key==='Enter'||e.key===' '||e.key==='F4'||(e.altKey&&e.key==='ArrowDown')){e.preventDefault();open(s);}},true);
 // A select whose page is re-rendered under the panel takes the panel with it.
 new MutationObserver(()=>{if(panel&&owner&&!owner.isConnected)close();}).observe(root.body||root,{childList:true,subtree:true});
}
