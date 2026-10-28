// Runs the real bundled Edge function in a VM against a real database through the
// PostgREST stand-in. `call(body)` behaves like one HTTP request to party-api.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import {createPostgrestFetch} from './postgrest-fetch.js';

let cached=null;
function bundleSource(){
 if(cached)return cached;
 const out=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'papa-edge-')),'bundle.txt');
 execFileSync(process.execPath,['build-edge.mjs'],{env:{...process.env,PAPA_EDGE_BUNDLE_OUT:out},stdio:'ignore'});
 cached=stripTypeScriptTypes(fs.readFileSync(out,'utf8').replace(/^import webpush .*;\r?\n/m,'const webpush={sendNotification(){}};'));
 return cached;
}

export function loadEdge(db,{adminUser='admin-user',log=null}={}){
 let handler;
 const baseUrl='https://example.supabase.co';
 const context=vm.createContext({URL,crypto,structuredClone,TextEncoder,TextDecoder,console,Date,Response,Promise,setTimeout,clearTimeout,atob,btoa,
  fetch:createPostgrestFetch(db,{baseUrl,log}),
  EdgeRuntime:{waitUntil:promise=>{Promise.resolve(promise).catch(()=>{});}},
  Deno:{env:{get:key=>({SUPABASE_URL:baseUrl,PAPA_ADMIN_USER_ID:adminUser,SUPABASE_SERVICE_ROLE_KEY:'service-key'})[key]??undefined},serve:h=>{handler=h;}}});
 vm.runInContext(bundleSource(),context);
 const call=async body=>{
  const response=await handler({method:'POST',headers:{get:()=>null},json:async()=>body});
  const text=await response.text();let parsed=null;try{parsed=JSON.parse(text);}catch{parsed=text;}
  return {status:response.status,body:parsed};
 };
 return {call,context};
}
