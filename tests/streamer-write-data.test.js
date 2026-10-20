import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {streamerWriteData} from '../src/streamer-write-data.js';

test('deactivation payload satisfies the actual Edge whitelist without read-only metadata', () => {
  const edge = fs.readFileSync('supabase/functions/party-api/index.ts','utf8');
  const fn = edge.slice(edge.indexOf('async function mutateStreamerRegistry('));
  const allowed = [...fn.match(/Object.keys\(data\).some\(key=>!\[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
  const row = {id:'stable-room',slug:'room',display_name:'主播',active:true,spaceId:'space-a',created_at:'old',updated_at:'now',privateDescriptor:'private'};
  assert.ok(Object.keys(row).some(key=>!allowed.includes(key)), 'old spread payload reproduces rejection');
  const result = streamerWriteData(row,{active:false});
  assert.ok(Object.keys(result).every(key=>allowed.includes(key)));
  assert.deepEqual(result,{id:'stable-room',slug:'room',display_name:'主播',active:false});
  assert.equal(row.active,true);
});

test('editable profile fields survive deactivation and timestamps cannot be injected', () => {
  const row = {id:'a',slug:'a',display_name:'A',home_title:'Home',subtitle:'Sub',description:'Text',avatar_url:'avatar',banner_url:'banner',active:true};
  assert.deepEqual(streamerWriteData(row,{active:false,spaceId:'other',created_at:'new'}),{...row,active:false});
});

test('admin deactivation uses projected payload and skips already inactive entries', () => {
  const app=fs.readFileSync('src/app.js','utf8');
  const action=app.slice(app.indexOf("case 'archiveStreamer':"),app.indexOf("case '",app.indexOf("case 'archiveStreamer':")+6));
  assert.match(action,/row.active===false/);
  assert.match(action,/streamerWriteData\(row,\{active:false\}\)/);
  assert.match(action,/isSuperAdmin/);
  assert.doesNotMatch(action,/\.\.\.row/);
});
