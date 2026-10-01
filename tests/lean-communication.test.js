import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';

function edge(){
 execFileSync(process.execPath,['build-edge.mjs'],{cwd:new URL('../',import.meta.url)});
 const source=fs.readFileSync(new URL('../deploy-function.txt',import.meta.url),'utf8').replace(/^import webpush .*;\r?\n/m,'const webpush={};');
 const context=vm.createContext({URL,crypto,structuredClone,TextEncoder,console,Date,Response,Deno:{env:{get:()=>''},serve:()=>{}},EdgeRuntime:{waitUntil:()=>{}},fetch:()=>{throw Error('Unexpected network request');}});
 vm.runInContext(stripTypeScriptTypes(source),context);
 return context;
}

test('chat refresh reads only the authenticated room and requested player profile',async()=>{
 const context=edge();
 vm.runInContext(`
  var requests=[];
  api=async(path,body)=>{
   requests.push(path);
   if(path.includes('papa_v2_entities'))return [{id:'P1',name:'Alice'}];
   if(path.includes('papa_chat_messages'))return [{id:'m',seq:1,sender_side:'player',body:'hello',created_at:'2026-10-01T00:00:00Z'}];
   if(path.includes('papa_chat_reads'))return [];
   throw Error('Unexpected path '+path);
  };
 `,context);
 const result=await vm.runInContext("chatOperation({op:'chatMessages',streamer:'papa',playerId:'P1'},{role:'player',playerId:'P1'},upgradePlatform(empty()))",context);
 assert.equal(result.playerName,'Alice');
 assert.equal(result.rows.length,1);
 const paths=vm.runInContext('requests',context);
 assert.ok(paths.some(p=>p.includes('kind=eq.players&id=in.(P1)')));
 assert.ok(paths.filter(p=>p.includes('papa_v2_entities')).every(p=>p.endsWith('&select=id,name:data->>name')),'chat resolves names without passwords, notes or other profile fields');
 assert.ok(paths.every(p=>!p.includes('papa_v2_snapshot')));
 const count=paths.length;
 await assert.rejects(vm.runInContext("chatOperation({op:'chatMessages',streamer:'papa',playerId:'P2'},{role:'player',playerId:'P1'},upgradePlatform(empty()))",context),/無法查看/);
 assert.equal(paths.length,count,'cross-player denial precedes all database reads');
});

test('board feed resolves only visible authors and preserves anonymity',async()=>{
 const context=edge();
 vm.runInContext(`
  var requests=[];
  var post={id:'bd310611-7792-45f6-810f-1ea9bd75a014',seq:1,scope:'streamer',streamer_id:'papa',author_key:'player:A',root_id:null,visibility:'include',targets:['player:B'],anonymous:true,body:'private',deleted:false,version:1};
  api=async(path,body)=>{
   requests.push(path);
   if(path.includes('papa_board_blocks'))return [];
   if(path.includes('papa_board_posts'))return [post];
   if(path.includes('papa_v2_entities'))return [{id:'A',name:'Alice'}];
   throw Error('Unexpected path '+path);
  };
 `,context);
 const hidden=await vm.runInContext("boardOperation({op:'boardList',streamer:'papa'},{role:'player',playerId:'C'},upgradePlatform(empty()))",context);
 assert.equal(hidden.rows.length,0);
 assert.equal(vm.runInContext("requests.filter(p=>p.includes('papa_v2_entities')).length",context),0,'hidden author is not fetched');
 const visible=await vm.runInContext("boardOperation({op:'boardList',streamer:'papa'},{role:'player',playerId:'B'},upgradePlatform(empty()))",context);
 assert.equal(visible.rows.length,1);
 assert.equal(visible.rows[0].author,'匿名使用者');
 assert.equal(visible.rows[0].managedAuthor,undefined);
 assert.equal(visible.rows[0].author_key,undefined);
 assert.equal(vm.runInContext("requests.filter(p=>p.includes('papa_v2_entities')).length",context),0,'anonymous identity is not fetched for ordinary readers');
 const moderator=await vm.runInContext("boardOperation({op:'boardList',streamer:'papa'},{role:'streamer_admin',streamer_id:'papa'},upgradePlatform(empty()))",context);
 assert.equal(moderator.rows[0].managedAuthor,'Alice','room moderator retains anonymous-author review');
 assert.ok(vm.runInContext("requests.every(p=>!p.includes('papa_v2_snapshot'))",context));
 assert.ok(vm.runInContext("requests.some(p=>p.includes('select=id,seq,scope'))",context));
 assert.ok(vm.runInContext("requests.filter(p=>p.includes('papa_v2_entities')).every(p=>p.endsWith('&select=id,name:data->>name'))",context),'board resolves public names without transferring full player profiles');
});

test('manager chat inbox resolves only its visible page, including duplicate player names once',async()=>{
 const context=edge();
 vm.runInContext(`
  var requests=[];
  api=async(path,body)=>{
   requests.push({path,body});
   if(path.includes('papa_chat_inbox'))return Array.from({length:51},(_,i)=>({player_id:i===0?'P1':'P'+i,body:'message '+i,seq:i+1}));
   if(path.includes('papa_v2_entities'))return Array.from({length:49},(_,i)=>({id:'P'+(i+1),name:'Player '+(i+1)}));
   throw Error('Unexpected path '+path);
  };
 `,context);
 const result=await vm.runInContext("chatOperation({op:'chatInbox',streamer:'papa',page:2},{role:'streamer_admin',streamer_id:'papa'},upgradePlatform(empty()))",context);
 assert.equal(result.rows.length,50);assert.equal(result.hasMore,true);assert.equal(result.rows[0].player_name,'Player 1');
 const requests=vm.runInContext('requests',context),inbox=requests.find(r=>r.path.includes('papa_chat_inbox')),profiles=requests.filter(r=>r.path.includes('papa_v2_entities'));
 assert.equal(inbox.body.room,'papa');assert.equal(inbox.body.page_number,2);assert.equal(inbox.body.reader_key,'streamer');
 assert.equal(profiles.length,1);assert.equal(profiles[0].path.includes('P50'),false,'pagination sentinel is not an onscreen player');
 assert.equal((profiles[0].path.match(/\bP1\b/g)||[]).length,1,'repeated player identities use one lookup');
 assert.ok(profiles[0].path.endsWith('&select=id,name:data->>name'));
});

test('board target lookup refuses nonexistent players before creating a post',async()=>{
 const context=edge();
 vm.runInContext(`
  var requests=[];
  api=async(path,body)=>{
   requests.push(path);
   if(path.includes('papa_board_blocks'))return [];
   if(path.includes('papa_v2_entities'))return [];
   throw Error('Unexpected path '+path);
  };
 `,context);
 await assert.rejects(vm.runInContext("boardOperation({op:'boardCreate',streamer:'papa',visibility:'include',targets:['player:Missing'],body:'Hello',clientId:'bd310611-7792-45f6-810f-1ea9bd75a014'},{role:'player',playerId:'A'},upgradePlatform(empty()))",context),/名單含不存在/);
 assert.ok(vm.runInContext("requests.every(p=>!p.includes('papa_board_create'))",context));
});

test('board directory delegates player substring search to bounded RPC',async()=>{
 const context=edge();
 vm.runInContext(`
  var requests=[];
  api=async(path,body)=>{
   requests.push({path,body});
   if(path.includes('papa_board_blocks'))return [];
   if(path.includes('papa_board_directory'))return [{player_id:'P1',player_name:'Alice'}];
   throw Error('Unexpected path '+path);
  };
 `,context);
 const result=await vm.runInContext("boardOperation({op:'boardDirectory',streamer:'papa',query:'ali'},{role:'player',playerId:'P2'},upgradePlatform(empty()))",context);
 assert.equal(result.rows[0].key,'player:P1');
 assert.equal(result.rows[0].name,'Alice');
 const requests=vm.runInContext('requests',context);
 assert.equal(requests.find(r=>r.path.includes('papa_board_directory')).body.search_text,'ali');
 assert.ok(requests.every(r=>!r.path.includes('papa_v2_snapshot')&&!r.path.includes('papa_v2_entities')));
});
