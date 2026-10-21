import {publicApplicationHref} from './public-links.js';

// A menu entry selects the existing authenticated streamer workflow, never
// supplies a role or changes the selected Space/streamer authority.
export function streamerAdminDestination(href,{mountUrl,context=null}={}){
 const source=new URL(href),mount=new URL(mountUrl||'/',source);
 if(!['http:','https:'].includes(source.protocol)||source.origin!==mount.origin||source.username||source.password)throw Error('主播後台網址不正確');
 const projected=new URL(publicApplicationHref(source.href,context,mount.href));
 const target=new URL(source.pathname===new URL('preview.html',mount).pathname?'preview.html':'v2.html',mount);
 for(const key of ['streamer','streamerId','space','spaceId','demo']){
  const value=projected.searchParams.get(key);if(value!==null)target.searchParams.set(key,value);
 }
 target.searchParams.set('adminTab','queue');
 target.searchParams.set('portalLogin','admin');
 target.hash='admin';
 return target.href;
}
