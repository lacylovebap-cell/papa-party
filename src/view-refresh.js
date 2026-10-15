// Preserve the viewport and open disclosures only for a background refresh of
// the same view. Route changes retain their normal navigation behavior.
const views=new WeakMap();
export function rememberView(document,key){const root=document.querySelector('#app');if(root)views.set(root,key);}
export function refreshView(render,{document,window,viewKey}){
 const key=viewKey(),sameView=views.get(document.querySelector('#app'))===key,x=window.scrollX,y=window.scrollY;
 const disclosureKey=node=>{
  const row=node.closest('[data-queue-id],[data-ledger-id],[data-wish-id],[data-song-id]');
  if(!row&&node.closest('.song'))return null;
  return JSON.stringify([row?.dataset||null,node.id,node.querySelector('summary')?.textContent?.trim()]);
 };
 const open=new Set(sameView?[...document.querySelectorAll('#app details[open],#header details[open]')].map(disclosureKey).filter(Boolean):[]);
 render();
 if(!sameView||key!==viewKey())return;
 for(const node of document.querySelectorAll('#app details,#header details'))if(open.has(disclosureKey(node)))node.open=true;
 window.scrollTo({left:x,top:y,behavior:'instant'});
}
