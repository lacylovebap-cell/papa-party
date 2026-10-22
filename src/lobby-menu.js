// Header tools only: retain the existing share and device-local PWA handlers.
const header=document.querySelector('.lobby-page header .header-inner');
const menu=header?.querySelector('.lobby-tools');
if(menu){
 const panel=menu.querySelector('.lobby-tools-panel'),summary=menu.querySelector('summary');
 const moveStartButton=()=>{
  for(const button of header.querySelectorAll(':scope > [data-pwa-start]'))panel.append(button);
 };
 // PWA settings are appended later by the existing lobby entry module.
 new MutationObserver(moveStartButton).observe(header,{childList:true});
 moveStartButton();
 const close=()=>{menu.open=false;summary.setAttribute('aria-expanded','false');};
 menu.addEventListener('toggle',()=>summary.setAttribute('aria-expanded',String(menu.open)));
 panel.addEventListener('click',event=>{if(event.target.closest('button,a'))close();});
 document.addEventListener('pointerdown',event=>{if(menu.open&&!menu.contains(event.target))close();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){event.preventDefault();close();summary.focus();}});
}
