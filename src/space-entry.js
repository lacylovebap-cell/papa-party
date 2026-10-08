import {streamerDestination} from './streamer-navigation.js';

const validSlug=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
export function requiresSpaceEntry(url,mountUrl){
 const params=new URL(url).searchParams;
 if(params.has('space')||params.has('spaceId')||!params.has('streamer'))return true;
 // A dedicated path must be verified even when a legacy room hint is present.
 // Invalid paths also go through entry validation rather than loading a room.
 try{return requestedSpace(url,mountUrl)!==null;}catch{return true;}
}
// URL hints identify a destination, never a permission or a player profile.
export function requestedSpace(url,mountUrl){
 const current=new URL(url),mount=new URL(mountUrl),base=mount.pathname.replace(/\/$/,'');
 if(current.origin!==mount.origin)throw Error('空間網址不正確');
 const explicit=current.searchParams.get('space');
 if(explicit!==null){if(!validSlug(explicit))throw Error('空間網址不正確');return explicit;}
 if(current.origin!==mount.origin||!current.pathname.startsWith(base+'/'))throw Error('空間網址不正確');
 const rest=current.pathname.slice(base.length+1).replace(/\/$/,'');
 if(!rest||['index.html','v2.html','preview.html'].includes(rest))return null;
 if(!validSlug(rest))throw Error('空間網址不正確');return rest;
}

// Only the verified server entry result supplies this list. Public preferences
// are considered only when their identifier is still in that permitted result.
export function chooseSpaceEntry(result,identity,slug=null){
 const rows=Array.isArray(result?.spaces)?result.spaces:[],total=Number(result?.total);
 const spaces=rows.filter(row=>row&&typeof row.id==='string'&&row.id&&validSlug(row.slug)
  &&typeof row.streamerId==='string'&&row.streamerId&&validSlug(row.streamerSlug));
 if(slug){const space=spaces.find(row=>row.slug===slug);return space?{kind:'destination',space}:{kind:'denied',spaces:[]};}
 for(const preference of [identity?.homeSpace,identity?.lastSpace]){
  const space=spaces.find(row=>row.id===preference?.id&&row.slug===preference?.slug);
  if(space)return {kind:'destination',space};
 }
 if(total===1&&spaces.length===1&&!result?.hasMore)return {kind:'destination',space:spaces[0]};
 return {kind:spaces.length?'choice':'denied',spaces,total:Number.isFinite(total)?total:0,hasMore:!!result?.hasMore};
}

export function spaceDestination(url,mountUrl,space,{page='home',path=false}={}){
 if(!space||!validSlug(space.slug)||!validSlug(space.streamerSlug)||typeof space.id!=='string'||!space.id)throw Error('空間網址不正確');
 const current=new URL(streamerDestination(url,space.streamerSlug)),mount=new URL(mountUrl);
 if(current.origin!==mount.origin)throw Error('空間網址不正確');
 current.pathname=path?mount.pathname.replace(/\/$/,'')+'/'+space.slug:mount.pathname;
 current.searchParams.set('space',space.slug);current.searchParams.set('spaceId',space.id);
 for(const key of ['commonRequest','commonKind','player','adminTab','tab'])current.searchParams.delete(key);
 current.hash=page==='admin'?'admin':'home';return current.href;
}
