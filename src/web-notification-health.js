// Local, on-demand observations only. This does not query business data,
// request permission, register a worker, or claim that a push was delivered.
export function createWebNotificationHealth({environment=globalThis,registrationUrl,onChange,now=()=>Date.now()}={}){
 let epoch=0,pending=null;
 const capability=()=>{
  const browser=environment.window||environment,notification=environment.Notification||browser.Notification;
  const secure=environment.isSecureContext===true||browser.isSecureContext===true;
  const notificationSupported=Boolean(notification),pushSupported=Boolean(environment.navigator?.serviceWorker&&(environment.PushManager||browser.PushManager));
  return {secure,notificationSupported,pushSupported,permission:notificationSupported?(notification.permission||'default'):'unsupported'};
 };
 const empty=()=>({...capability(),checking:false,checkedAt:null,worker:'unknown',subscription:'unknown',error:'',binding:{attemptAt:null,successAt:null,error:'',inFlight:false}});
 let state=empty();
 const snapshot=()=>({...state,binding:{...state.binding}});
 const publish=()=>{try{onChange?.(snapshot());}catch{}};
 const message=error=>String(error?.message||'無法讀取裝置推播狀態').slice(0,200);
 return {
  snapshot,
  reset(){epoch++;pending=null;state=empty();publish();},
  recordBinding(stage,error){
   if(stage==='attempt')state.binding={...state.binding,attemptAt:now(),error:'',inFlight:true};
   else if(stage==='success')state.binding={...state.binding,successAt:now(),error:'',inFlight:false};
   else if(stage==='error')state.binding={...state.binding,error:message(error),inFlight:false};
   else if(stage==='idle')state.binding={...state.binding,inFlight:false};
   else return;
   publish();
  },
  check(){
   if(pending)return pending.promise;
   const token=epoch,attempt={promise:null},supported=capability();pending=attempt;
   state={...state,...supported,checking:true,error:''};
   attempt.promise=Promise.resolve().then(async()=>{
    const result={worker:'unsupported',subscription:'unsupported',error:''};
    try{
     if(token!==epoch)return snapshot();
     if(supported.secure&&supported.notificationSupported&&supported.pushSupported){
      const registration=await environment.navigator.serviceWorker.getRegistration(registrationUrl);
      if(token!==epoch)return snapshot();
      result.worker=registration?'ready':'missing';
      result.subscription=registration?(await registration.pushManager.getSubscription()?'present':'missing'):'missing';
     }
    }catch(error){if(result.worker!=='ready')result.worker='error';result.subscription='error';result.error=message(error);}
    if(token===epoch){state={...state,...capability(),...result,checking:false,checkedAt:now()};publish();}
    return snapshot();
   }).finally(()=>{if(pending===attempt)pending=null;});
   publish();
   return attempt.promise;
  }
 };
}
