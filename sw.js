// Push only: no cached API responses, login tokens, or offline business mutations.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{event.waitUntil((async()=>{
 let data;try{data=event.data.json();}catch{return;}
 if(!data?.id||!data.body)return;
 const existing=await self.registration.getNotifications({tag:data.id});if(existing.length)return;
 await self.registration.showNotification(data.title||'PA • PARTY',{body:data.body,tag:data.id,data:{url:data.url},icon:'./assets/app-icon.svg',badge:'./assets/app-icon.svg'});
})());});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const base=new URL(self.registration.scope),url=new URL(event.notification.data?.url||'./',base);if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return;const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});const tab=clients.find(c=>c.url===url.href);if(tab){await tab.focus();return;}await self.clients.openWindow(url.href);})());});
