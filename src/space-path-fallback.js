import {requestedSpace} from './space-entry.js?v=10.10-WEB.1';

// Pages serves 404.html for a dedicated Space path. Only that route shape may
// return to the app; the authenticated entry flow still verifies the Space.
export function spacePathFallback(url,mountUrl){
 try{
  const current=new URL(url),mount=new URL(mountUrl),pathOnly=new URL(current);
  pathOnly.search='';
  const slug=requestedSpace(pathOnly,mount);
  if(!slug||requestedSpace(current,mount)!==slug)return null;
  current.pathname=mount.pathname.replace(/\/$/,'')+'/';
  // Keep the original query encoding, duplicate values and hash intact.
  if(!current.searchParams.has('space'))current.search+=(current.search?'&':'?')+'space='+encodeURIComponent(slug);
  return current.href;
 }catch{return null;}
}
