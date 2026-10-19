// Isolated UI fixture. All API requests stop at this local server; no proxy or credentials.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {empty,upgradePlatform,publicView,stamp} from '../src/core.js';
import {accountingDay} from '../src/accounting.js';
const root=fileURLToPath(new URL('../',import.meta.url)),port=8863,requests=[];
const state=upgradePlatform(empty());state.streamers[0].spaceId='space-001';
const route=(kind='streamer')=>({version:1,kind,spaceId:'space-001',streamerId:kind==='hall'?null:'papa',streamerSlug:kind==='hall'?null:'papa',canonicalPath:kind==='hall'?'/sm':'/pa',code:kind==='hall'?'sm':'pa',spaceCode:'sm',layout:'flat',configured:true,revision:0});
const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:'+port);
 try{
  if(url.pathname==='/fixture-api'&&req.method==='POST'){
   let text='';for await(const chunk of req)text+=chunk;if(text.length>10000)return json(res,{error:'fixture request too large'},400);
   const body=JSON.parse(text);requests.push({op:body.op,streamer:body.streamer});
   if(body.op==='publicRouteResolve'){const kind=body.path.toLowerCase()==='/sm'?'hall':'streamer';return json(res,['/sm','/pa','/papa-old'].includes(body.path.toLowerCase())?{...route(kind),matchedPath:body.path,isAlias:body.path.toLowerCase()==='/papa-old'}:null);}
   if(body.op==='publicRouteInfo'||body.op==='publicRouteSettings')return json(res,route(body.kind));
   if(body.op==='publicLobbyRooms')return json(res,{version:1,rows:[{id:'papa',slug:'papa',display_name:'怕怕（本機假資料）',heroImage:'assets/papa-singer-hero.jpg'}],total:1,page:0,pageSize:3});
   if(body.op==='publicLobbySongs')return json(res,{rows:[],total:0,filters:{languages:[],performerTypes:[]}});
   if(body.op==='read'){const view=publicView(state,null,stamp(),'papa');view.summary={...view.summary,day:accountingDay(stamp(),19),rolloverHour:19};return json(res,{state:{...view,currentStreamer:state.streamers[0]},ready:true,now:stamp(),signatures:{}});}
   if(body.op==='catalogLanguageFilter')return json(res,{mode:'auto',languages:[]});
   if(body.op==='catalogSongbook')return json(res,{rows:[],total:0,filters:{languages:[],performerTypes:[]}});
   if(body.op==='newPracticePage')return json(res,{rows:[],total:0,pageLimit:20,pageOffset:0});
   if(body.op==='bookSearch')return json(res,{rows:[],songs:[],total:0});
   return json(res,{error:'LOCAL_FIXTURE_UNSUPPORTED:'+body.op},400);
  }
  if(url.pathname==='/fixture-requests')return json(res,requests);
  if(url.pathname==='/src/config.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end('export const API="http://127.0.0.1:'+port+'/fixture-api";export const PUBLISHABLE_KEY="local-fixture-only";');return;}
  let relative=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';
  const absolute=path.resolve(root,relative);if(!absolute.startsWith(root))return json(res,{error:'outside fixture'},403);
  let bytes,extension=path.extname(absolute),status=200;
  try{bytes=await fs.readFile(absolute);}catch{bytes=await fs.readFile(path.join(root,'404.html'));extension='.html';status=404;}
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
  res.writeHead(status,{'Content-Type':types[extension]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
 }catch(error){json(res,{error:error.message},500);}
}).listen(port,'127.0.0.1',()=>console.log('Local fixture only: http://127.0.0.1:'+port+'/sm'));
