import {prepareInstallManifest} from './pwa-install-source.js';
const INSTALL_ERROR='目前無法開啟安裝視窗，請使用瀏覽器選單加入主畫面。';

// The browser supplies one install opportunity. Nothing is prompted, stored or
// requested until the caller invokes prompt() from a user gesture.
export function createWebAppInstall({environment=globalThis,target=environment,onChange,source,mountUrl}={}){
 // Callers prepare the current verified public scope before the browser creates
 // its install event. No storage, source lookup, or permission request is needed.
 let manifestHref=null;
 let media=null;
 try{media=environment?.matchMedia?.('(display-mode: standalone)')||null;}catch{}
 const isStandalone=()=>{
  try{return Boolean(media?.matches||environment?.navigator?.standalone===true);}catch{return false;}
 };
 let installed=isStandalone(),deferred=null,pending=null,destroyed=false,error='';
 const listeners=new Set(typeof onChange==='function'?[onChange]:[]);
 const snapshot=()=>({installed,canPrompt:!destroyed&&!installed&&!pending&&Boolean(deferred),prompting:Boolean(pending),error});
 const publish=()=>{
  if(destroyed)return;
  for(const listener of [...listeners])try{listener(snapshot());}catch{}
 };
 const finish=(attempt,result)=>{
  if(attempt.finished)return;
  attempt.finished=true;
  if(pending===attempt){pending=null;error=result.outcome==='error'?INSTALL_ERROR:'';publish();}
  attempt.resolve(result);
 };
 const confirmInstalled=()=>{
  if(destroyed||installed)return;
  installed=true;deferred=null;error='';
  const attempt=pending;pending=null;
  if(attempt)finish(attempt,{outcome:'installed'});
  publish();
 };
 const beforeInstall=event=>{
  if(destroyed||installed||event?.type!=='beforeinstallprompt'||event.isTrusted===false||typeof event.preventDefault!=='function'||typeof event.prompt!=='function'||!('userChoice' in event))return;
  event.preventDefault();
  if(deferred||pending)return;
  deferred=event;error='';publish();
 };
 const mediaChange=()=>{if(isStandalone())confirmInstalled();};
 const prepareSource=value=>{
  if(destroyed||pending)return null;
  const href=prepareInstallManifest({document:environment?.document,source:value,mountUrl:mountUrl||environment?.location?.origin+'/'});
  if(href&&href!==manifestHref){
   // A held install event may describe the preceding page's manifest. Reusing
   // it after visiting a different host could bind the wrong initial home.
   manifestHref=href;const hadEvent=Boolean(deferred);deferred=null;error='';if(hadEvent)publish();
  }
  return href;
 };
 if(source!==undefined)prepareSource(source);
 target?.addEventListener?.('beforeinstallprompt',beforeInstall);
 target?.addEventListener?.('appinstalled',confirmInstalled);
 if(typeof media?.addEventListener==='function')media.addEventListener('change',mediaChange);
 else media?.addListener?.(mediaChange);

 return {
  snapshot,
  prepareSource,
  subscribe(listener){
   if(destroyed||typeof listener!=='function')return ()=>{};
   listeners.add(listener);try{listener(snapshot());}catch{}
   return ()=>listeners.delete(listener);
  },
  prompt(){
   if(destroyed)return Promise.resolve({outcome:'unavailable'});
   if(installed)return Promise.resolve({outcome:'installed'});
   if(pending)return pending.promise;
   if(!deferred)return Promise.resolve({outcome:'unavailable'});
   const event=deferred;deferred=null;error='';
   let resolve;
   const promise=new Promise(done=>{resolve=done;});
   const attempt={promise,resolve,finished:false};pending=attempt;publish();
   if(destroyed||installed){finish(attempt,{outcome:installed?'installed':'unavailable'});return promise;}
   try{
    // Keep this call synchronous: awaiting anything first loses the gesture.
    const prompted=event.prompt();
    Promise.all([Promise.resolve(prompted),Promise.resolve(event.userChoice)]).then(([,choice])=>{
     if(attempt.finished)return;
     if(choice?.outcome!=='accepted'&&choice?.outcome!=='dismissed')throw Error('Invalid install choice');
     finish(attempt,{outcome:choice.outcome});
    }).catch(()=>finish(attempt,{outcome:'error',error:INSTALL_ERROR}));
   }catch{
    // Some implementations also reject userChoice when prompt() throws.
    try{Promise.resolve(event.userChoice).catch(()=>{});}catch{}
    finish(attempt,{outcome:'error',error:INSTALL_ERROR});
   }
   return promise;
  },
  destroy(){
   if(destroyed)return;
   destroyed=true;deferred=null;error='';
   const attempt=pending;pending=null;
   if(attempt)finish(attempt,{outcome:'unavailable'});
   target?.removeEventListener?.('beforeinstallprompt',beforeInstall);
   target?.removeEventListener?.('appinstalled',confirmInstalled);
   if(typeof media?.removeEventListener==='function')media.removeEventListener('change',mediaChange);
   else media?.removeListener?.(mediaChange);
   listeners.clear();
  }
 };
}
