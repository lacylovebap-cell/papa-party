// Native modal dialogs paint above ordinary z-index layers. Keep the shared
// status message in that same top layer without opening another modal or
// moving keyboard focus away from the user's current field.
export function installOverlayFeedback({document,window,duration=4500}={document:globalThis.document,window:globalThis.window}) {
 const previous=window.__paOverlayFeedback;
 if(previous?.element?.isConnected)return previous;
 previous?.destroy();
 const element=document.getElementById('toast')||document.createElement('div');
 element.id='toast';element.dataset.overlayFeedback='';
 element.setAttribute('role','status');element.setAttribute('aria-live','polite');element.setAttribute('aria-atomic','true');
 if(!element.isConnected)document.body.append(element);
 if(!document.getElementById('overlay-feedback-styles')){
  const link=document.createElement('link');link.id='overlay-feedback-styles';link.rel='stylesheet';
  link.href=new URL('./overlay-feedback.css?v=1021-feedback-1',import.meta.url).href;document.head.append(link);
 }
 let disposed=false,visible=false,timer=null,sequence=0,promotedFor=null;
 const openOrder=[];
 let popover=typeof element.showPopover==='function'&&typeof element.hidePopover==='function';
 if(popover)element.setAttribute('popover','manual');
 function modalDialogs(){
  const open=[...document.querySelectorAll('dialog[open]')];
  // :modal excludes non-modal dialog.show() windows when supported.
  try{return open.filter(dialog=>dialog.matches(':modal'));}catch{return open;}
 }
 function latestDialog(records=[]){
  const open=modalDialogs();
  for(let index=openOrder.length-1;index>=0;index--)if(!open.includes(openOrder[index]))openOrder.splice(index,1);
  for(const dialog of open)if(!openOrder.includes(dialog))openOrder.push(dialog);
  for(const record of records){
   if(record.type!=='attributes'||!open.includes(record.target))continue;
   const index=openOrder.indexOf(record.target);if(index>=0)openOrder.splice(index,1);openOrder.push(record.target);
  }
  return openOrder.at(-1)||null;
 }
 function closePopover(){try{if(element.matches(':popover-open'))element.hidePopover();}catch{}}
 function reconcile(records=[]){
  if(!visible||disposed)return;
  const dialog=latestDialog(records);
  // Keep the live region inside the active modal as well: a body sibling
  // remains inert (and inaccessible to assistive technology) even if painted
  // in the popover top layer.
  const parent=dialog||document.body;
  if(element.parentElement!==parent){closePopover();parent.append(element);}
  if(popover){
   try{
    // A dialog opened after a status message would otherwise paint above it.
    // Reinsert the status into the top layer only when the top modal changes.
    if(promotedFor!==dialog){closePopover();promotedFor=dialog;}
    if(!element.matches(':popover-open'))element.showPopover();
    return;
   }catch{popover=false;closePopover();element.removeAttribute('popover');}
  }
  // Browsers without Popover support still need the message inside the active
  // modal's subtree, where it cannot be made inert behind that modal.
  promotedFor=dialog;
 }
 const observer=window.MutationObserver?new window.MutationObserver(reconcile):null;
 observer?.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
 function hide(){
  visible=false;sequence++;window.clearTimeout(timer);timer=null;closePopover();
  delete element.dataset.visible;element.classList.remove('show');
  if(element.parentElement!==document.body)document.body.append(element);
  promotedFor=null;
 }
 function notify(text){
  if(disposed)return;
  window.clearTimeout(timer);const current=++sequence;
  // Use textContent: messages may include song titles or server error text.
  element.textContent=String(text??'');element.dataset.visible='true';element.classList.add('show');visible=true;
  reconcile(observer?.takeRecords());
  timer=window.setTimeout(()=>{if(current===sequence)hide();},duration);
 }
 function destroy(){if(disposed)return;hide();disposed=true;observer?.disconnect();if(window.__paOverlayFeedback===api)delete window.__paOverlayFeedback;}
 const api={element,notify,hide,destroy};window.__paOverlayFeedback=api;return api;
}
