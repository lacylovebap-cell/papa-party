// A small PostgREST stand-in for tests: it answers the Edge function's own fetch()
// calls from a real PostgreSQL connection, so the real handler and the real
// migrations run together. Supports named-argument RPC calls and simple table
// reads/writes (select, eq/neq/gt/gte/lt/lte/is/in/like filters, order, limit).
const IDENT=/^[a-z_][a-z0-9_]*$/;
const status=code=>{
 if(/^PT\d{3}$/.test(code||''))return Number(code.slice(2));
 if(code==='23505')return 409;if(code==='42501')return 403;if(code==='42883')return 404;
 return /^(XX|53|57|58)/.test(code||'')?500:400;
};
const literal=(value,type)=>{
 if(value===null||value===undefined)return null;
 if(/^(jsonb?)$/.test(type))return JSON.stringify(value);
 if(type.endsWith('[]')&&Array.isArray(value))return '{'+value.map(item=>item===null?'NULL':'"'+String(item).replace(/(["\\])/g,'\\$1')+'"').join(',')+'}';
 return typeof value==='object'?JSON.stringify(value):String(value);
};

export function createPostgrestFetch(db,{baseUrl='https://example.supabase.co',log=null,passthrough=async()=>({ok:false,status:404,text:async()=>''})}={}){
 const catalog=new Map();
 async function overloads(name){
  if(catalog.has(name))return catalog.get(name);
  const rows=(await db.query(`select p.oid::int oid,p.proargnames names,p.proargmodes modes,p.pronargdefaults defaults,p.proretset retset,
    format_type(p.prorettype,null) ret,
    (select coalesce(array_agg(format_type(o,null) order by ord),'{}') from unnest(p.proargtypes::oid[]) with ordinality u(o,ord)) types
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`,[name])).rows;
  const list=rows.map(row=>{
   const modes=row.modes,names=(row.names||[]).filter((_,index)=>!modes||['i','b','v'].includes(modes[index]));
   return {...row,inputs:names,required:names.slice(0,Math.max(0,names.length-row.defaults))};
  });
  catalog.set(name,list);return list;
 }
 async function rpc(name,body){
  if(!IDENT.test(name))return {status:404,json:{code:'PGRST202',message:'function not found'}};
  const args=body&&typeof body==='object'&&!Array.isArray(body)?body:{},keys=Object.keys(args);
  const candidates=(await overloads(name)).filter(fn=>keys.every(key=>fn.inputs.includes(key))&&fn.required.every(key=>keys.includes(key)))
   .sort((a,b)=>a.inputs.length-b.inputs.length);
  const fn=candidates[0];
  if(!fn)return {status:404,json:{code:'PGRST202',message:`Could not find the function public.${name}(${keys.join(', ')}) in the schema cache`,details:null,hint:null}};
  const params=[],parts=keys.map(key=>{
   const type=fn.types[fn.inputs.indexOf(key)];params.push(literal(args[key],type));
   return `"${key}" => $${params.length}::${type}`;
  });
  const call=`public.${name}(${parts.join(', ')})`;
  let sql;
  if(fn.ret==='void')sql=`select null::jsonb j from (select ${call}) s`;
  else if(fn.retset)sql=`select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) j from ${call} r`;
  else sql=`select to_jsonb(x) j from (select ${call} x) s`;
  const result=await db.query(sql,params);
  return {status:200,json:result.rows[0]?.j??null,empty:fn.ret==='void'};
 }
 function filters(url,params){
  const where=[];
  for(const [key,raw] of url.searchParams){
   if(['select','order','limit','offset','on_conflict','columns'].includes(key))continue;
   if(!IDENT.test(key))throw Object.assign(Error('bad column'),{code:'PGRST100'});
   let op=raw,negate=false;if(op.startsWith('not.')){negate=true;op=op.slice(4);}
   const dot=op.indexOf('.'),name=op.slice(0,dot),value=op.slice(dot+1);let clause;
   if(name==='is'){clause=`"${key}" is ${value==='null'?'null':value==='true'?'true':'false'}`;}
   else if(name==='in'){const items=value.replace(/^\(|\)$/g,'').split(',').map(item=>item.replace(/^"|"$/g,''));params.push(items);clause=`"${key}"::text = any($${params.length}::text[])`;}
   else if(name==='like'||name==='ilike'){params.push(value.replace(/\*/g,'%'));clause=`"${key}"::text ${name} $${params.length}`;}
   else{const sym={eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='}[name];if(!sym)throw Object.assign(Error('bad operator'),{code:'PGRST100'});params.push(value);clause=`"${key}" ${sym} $${params.length}`;}
   where.push(negate?`not (${clause})`:clause);
  }
  return where.length?' where '+where.join(' and '):'';
 }
 function columns(select){
  if(!select||select==='*')return '*';
  return select.split(',').map(part=>{
   const [alias,expr]=part.includes(':')?part.split(':'):[null,part];
   const json=expr.match(/^([a-z_][a-z0-9_]*)(->>?)([a-z_][a-z0-9_]*)$/);
   if(json)return `(${json[1]}${json[2]}'${json[3]}') as "${alias||json[3]}"`;
   if(!IDENT.test(expr))throw Object.assign(Error('bad column'),{code:'PGRST100'});
   return alias?`"${expr}" as "${alias}"`:`"${expr}"`;
  }).join(',');
 }
 async function table(name,method,url,text){
  if(!IDENT.test(name))return {status:404,json:{code:'PGRST205',message:'table not found'}};
  const params=[],where=filters(url,params);
  if(method==='GET'){
   const order=url.searchParams.get('order'),limit=url.searchParams.get('limit'),offset=url.searchParams.get('offset');
   const orderSql=order?' order by '+order.split(',').map(part=>{const [col,dir='asc']=part.split('.');if(!IDENT.test(col))throw Object.assign(Error('bad order'),{code:'PGRST100'});return `"${col}" ${dir==='desc'?'desc':'asc'}`;}).join(','):'';
   const sql=`select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) j from (select ${columns(url.searchParams.get('select'))} from public."${name}"${where}${orderSql}${limit?' limit '+Number(limit):''}${offset?' offset '+Number(offset):''}) t`;
   return {status:200,json:(await db.query(sql,params)).rows[0].j};
  }
  const body=text?JSON.parse(text):null;
  if(method==='POST'){
   const rows=Array.isArray(body)?body:[body];
   for(const row of rows){
    const keys=Object.keys(row);for(const key of keys)if(!IDENT.test(key))throw Object.assign(Error('bad column'),{code:'PGRST100'});
    await db.query(`insert into public."${name}"(${keys.map(key=>`"${key}"`).join(',')}) select ${keys.map(key=>`x."${key}"`).join(',')} from jsonb_populate_record(null::public."${name}",$1::jsonb) x`,[JSON.stringify(row)]);
   }
   return {status:201,empty:true};
  }
  if(method==='PATCH'){
   const keys=Object.keys(body||{});for(const key of keys)if(!IDENT.test(key))throw Object.assign(Error('bad column'),{code:'PGRST100'});
   const offset=params.length;params.push(JSON.stringify(body));
   await db.query(`update public."${name}" t set ${keys.map(key=>`"${key}"=x."${key}"`).join(',')} from jsonb_populate_record(null::public."${name}",$${offset+1}::jsonb) x${where.replace(/"([a-z_][a-z0-9_]*)" /g,'t."$1" ')}`,params);
   return {status:204,empty:true};
  }
  if(method==='DELETE'){await db.query(`delete from public."${name}"${where}`,params);return {status:204,empty:true};}
  return {status:405,json:{code:'PGRST117',message:'method not allowed'}};
 }
 return async function postgrestFetch(input,init={}){
  const href=String(input);
  if(!href.startsWith(baseUrl+'/rest/v1/'))return passthrough(href,init);
  const url=new URL(href),method=(init.method||'GET').toUpperCase(),path=url.pathname.slice('/rest/v1/'.length);
  let result;
  try{
   if(log)log({method,path:path+url.search,body:init.body});
   result=path.startsWith('rpc/')?await rpc(path.slice(4),init.body?JSON.parse(init.body):{}):await table(path,method,url,init.body);
  }catch(error){
   const code=error.code||'P0001';
   result={status:status(code),json:{code,message:error.message,details:error.detail??null,hint:error.hint??null}};
  }
  const text=result.empty?'':JSON.stringify(result.json);
  if(log&&result.status>=400)log({error:true,status:result.status,path:path+url.search,detail:result.json});
  return {ok:result.status>=200&&result.status<300,status:result.status,url:href,headers:{get:()=>'application/json'},text:async()=>text,json:async()=>JSON.parse(text)};
 };
}
