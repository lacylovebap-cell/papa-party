// Origin-local intent survives logout and room changes. Browser permission and
// audio activation are deliberately not persisted as if they were guarantees.
export function createNotificationDevicePreferences(storage){
 const key='pa-notice-device-preferences-v1';let fallback={};
 function read(){try{return {...fallback,...JSON.parse(storage.getItem(key)||'{}')};}catch{return {...fallback};}}
 function save(patch){fallback={...read(),...patch};try{storage.setItem(key,JSON.stringify(fallback));return true;}catch{return false;}}
 return {read,save,soundEnabled:()=>read().soundEnabled!==false,
  needsSetup:permission=>{if(['granted','denied'].includes(permission)){if(!read().setupDone)save({setupDone:true});return false;}return !read().setupDone;},
  canAutoEnable:(permission,preferences={})=>permission==='granted'&&read().pushAllowed!==false&&preferences.pushEnabled==null};
}
