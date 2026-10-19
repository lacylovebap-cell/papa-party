import {pageDestination} from './streamer-navigation.js?v=10.19-WEB.2';

const sections=new Set(['home','book','common-book','center','gallery','admin']);
const pageQuery=new Set(['adminTab','tab','player','queue']);
const systemRoots=new Set(['index.html','v2.html','preview.html','404.html','api','assets','src','tests','ops','supabase','node_modules','.well-known','solo','login','logout','auth','oauth','callback','admin','home','book','common-book','center','gallery','catalog','shared','songs','player','players','queue','history','cards','wall','wishes','achievements','medals','lobby','settings','share','notifications','favicon.ico','robots.txt','sitemap.xml','release.json','manifest','index','preview','404','sw','favicon','robots','sitemap','manifest.json','manifest.webmanifest','sw.js','service-worker.js']);
const segment=/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/;
const dotted=part=>{const parts=part.split('.');return parts.length===2&&parts.every(value=>segment.test(value));};
const invalid=reason=>({eligible:false,candidates:[],reason});

// Inspect the original spelling before URL normalizes traversal or backslashes.
function unsafeSpelling(input){
 const raw=String(input||'').split(/[?#]/,1)[0];
 return /[\\\s\u0000-\u001f\u007f]/.test(raw)||/%/i.test(raw)||/(?:^|\/)\.{1,2}(?:\/|$)/.test(raw);
}
function pathSegments(path){
 if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||unsafeSpelling(path)||path.includes('//'))return null;
 const value=path.endsWith('/')?path.slice(0,-1):path;
 if(!value||value==='/')return [];
 const parts=value.slice(1).split('/');
 if(parts.some((part,index)=>!(segment.test(part)||index===0&&dotted(part))))return null;
 return parts;
}
function validHome(parts){
 return parts.length>=1&&parts.length<=2&&!systemRoots.has(parts[0].toLowerCase())&&!(parts.length===2&&dotted(parts[0]));
}

/** Candidate paths contain public aliases only. The server resolves stable IDs. */
export function parsePublicRoutePath(input,{mountUrl}={}){
 if(unsafeSpelling(input))return invalid('invalid-path');
 let url,mount;
 try{url=new URL(input,mountUrl);mount=new URL(mountUrl||'/',url);}catch{return invalid('invalid-url');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.origin!==mount.origin)return invalid('invalid-origin');
 const base=mount.pathname.replace(/\/$/,'');
 if(base&&url.pathname!==base&&!url.pathname.startsWith(base+'/'))return invalid('outside-mount');
 const pathname=base?url.pathname.slice(base.length)||'/':url.pathname;
 if(pathname.includes('//'))return invalid('invalid-path');
 const trimmed=pathname.endsWith('/')?pathname.slice(0,-1):pathname;
 const parts=(trimmed||'/').slice(1).split('/').filter(Boolean);
 if(!parts.length||systemRoots.has(parts[0].toLowerCase()))return invalid('system-path');
 if(parts.length>3)return invalid('invalid-path');
 const candidates=[];
 if(validHome(parts)&&pathSegments('/'+parts.join('/')))candidates.push({homepagePath:'/'+parts.join('/'),section:'home'});
 const tail=parts.at(-1),home=parts.slice(0,-1);
 if(parts.length>1&&sections.has(tail)&&validHome(home)&&pathSegments('/'+home.join('/')))candidates.push({homepagePath:'/'+home.join('/'),section:tail});
 return candidates.length?{eligible:true,candidates,reason:null}:invalid('invalid-path');
}

/** A share target never carries login tokens, management state or notices. */
export function canonicalPublicHome(origin,path){
 let base;
 try{base=new URL(origin);}catch{return null;}
 if(!['https:','http:'].includes(base.protocol)||base.username||base.password)return null;
 if(typeof path!=='string'||/[?#]/.test(path))return null;
 const parts=pathSegments(path);
 if(!parts||!validHome(parts))return null;
 return base.origin+'/'+parts.join('/');
}

/** Keep existing subview semantics while replacing only the public alias prefix. */
export function publicPageDestination(href,canonicalHome,view={}){
 if(unsafeSpelling(canonicalHome))return null;
 let current,home,existing;
 try{current=new URL(href);home=new URL(canonicalHome);existing=new URL(pageDestination(href,view));}catch{return null;}
 const clean=canonicalPublicHome(home.origin,home.pathname);
 if(!clean||current.origin!==home.origin||home.username||home.password||home.search||home.hash)return null;
 const url=new URL(clean),route=sections.has(view.route)?view.route:'home';
 if(route!=='home')url.pathname+='/'+route;
 for(const [key,value] of existing.searchParams)if(pageQuery.has(key))url.searchParams.append(key,value);
 return url.href;
}
