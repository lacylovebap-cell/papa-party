// Visual page rotation only. The caller owns its existing bounded page cache.
export function createLobbyRoomRotation({snapshot,advance,setTimer=setTimeout,clearTimer=clearTimeout,interval=8000}){
 let timer=null,busy=false,stopped=false;const pauses=new Set();
 function clear(){if(timer!==null){clearTimer(timer);timer=null;}}
 function sync(){
  clear();const view=snapshot();
  if(stopped||busy||pauses.size||view.loading||view.error||view.total<=view.pageSize)return;
  timer=setTimer(async()=>{timer=null;if(stopped||pauses.size)return;busy=true;
   try{await advance();}catch{pauses.add('error');}finally{busy=false;sync();}
  },interval);
 }
 return {sync,pause(reason,active=true){if(active)pauses.add(reason);else pauses.delete(reason);sync();},stop(){stopped=true;clear();}};
}
export function installLobbyRoomRotation({document,window,region,rotation}){
 const enter=()=>rotation.pause('hover'),leave=()=>rotation.pause('hover',false);
 const focus=()=>rotation.pause('focus'),blur=e=>{if(!region.contains(e.relatedTarget))rotation.pause('focus',false);};
 const touch=()=>rotation.pause('touch'),release=()=>rotation.pause('touch',false);
 const visibility=()=>rotation.pause('hidden',document.hidden),hide=()=>rotation.pause('pagehide'),show=()=>rotation.pause('pagehide',false);
 const motion=window.matchMedia('(prefers-reduced-motion: reduce)'),preference=()=>rotation.pause('motion',motion.matches);
 region.addEventListener('pointerenter',enter);region.addEventListener('pointerleave',leave);region.addEventListener('focusin',focus);region.addEventListener('focusout',blur);
 region.addEventListener('pointerdown',touch);window.addEventListener('pointerup',release);window.addEventListener('pointercancel',release);
 document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);motion.addEventListener('change',preference);
 visibility();preference();
 return ()=>{rotation.stop();region.removeEventListener('pointerenter',enter);region.removeEventListener('pointerleave',leave);region.removeEventListener('focusin',focus);region.removeEventListener('focusout',blur);region.removeEventListener('pointerdown',touch);window.removeEventListener('pointerup',release);window.removeEventListener('pointercancel',release);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);motion.removeEventListener('change',preference);};
}
