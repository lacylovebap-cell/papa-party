import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20261101130000_catalog_master_sync.sql',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../supabase/functions/party-api/catalog.ts',import.meta.url),'utf8');
const bundle=fs.readFileSync(new URL('../ops/edge-release/party-api-11.01-CATALOG.1.js',import.meta.url),'utf8');
const deployed=fs.readFileSync(new URL('../ops/edge-release/party-api-10.31-NOTICE.4.js',import.meta.url),'utf8');

test('editing a shared master goes through the synced wrapper, with or without version details',()=>{
 for(const text of [source,bundle.split('\n').slice(1).join('\n')]){
  assert.equal((text.match(/papa_catalog_update_variant_synced/g)||[]).length,2);
  assert.doesNotMatch(text,/rpc\/papa_catalog_update_variant_full/);
 }
});

test('the bundle equals deployed NOTICE.4 apart from the two synced calls and releaseInfo',()=>{
 const a=bundle.split('\n').slice(1),b=new Set(deployed.split('\n'));
 const added=a.filter(line=>!b.has(line));
 assert.equal(added.length,4,added.join('\n'));
 assert.ok(added.every(line=>/papa_catalog_update_variant_synced|update_variant"\)$|11\.01-CATALOG\.1/.test(line)));
});

test('sync writes songs only through the room commit, only changed fields, keeps the link approved',()=>{
 assert.match(sql,/perform papa_room_admin_commit\(rev,/);
 assert.doesNotMatch(sql,/update papa_v2_entities/i,'never bypasses the songbook commit');
 assert.match(sql,/if after_row\.title is distinct from before_row\.title then fields=fields\|\|'title'/);
 assert.match(sql,/if after_row\.artist is distinct from before_row\.artist then fields=fields\|\|'artist'/);
 assert.match(sql,/set status='approved'[^;]*c\.status='pending'/s);
 assert.match(sql,/conflicts=conflicts\+1/,'same title+artist already in that room is skipped, not overwritten');
 assert.match(sql,/exception when others then\s+failed=failed\+1/);
 assert.match(sql,/revoke all on function public\.papa_catalog_sync_linked_songs[^;]*from public,anon,authenticated/);
 assert.match(sql,/revoke all on function public\.papa_catalog_update_variant_synced[^;]*from public,anon,authenticated/);
});
