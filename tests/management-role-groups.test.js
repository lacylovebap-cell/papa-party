import test from 'node:test';
import assert from 'node:assert/strict';
import {groupManagementRoles} from '../src/management-role-groups.js';
import {createPlatformManagement} from '../src/platform-management.js';
test('grouping preserves every original grant, never merges names or missing identity',()=>{
 const rows=[{id:'1',accountId:'a',name:'same',status:'active'},{id:'2',accountId:'a',status:'suspended'},{id:'3',accountId:'b',name:'same',status:'active'},{id:'4'},{id:'5'}];
 const groups=groupManagementRoles(rows);assert.equal(groups.length,4);assert.equal(groups[0].status,'mixed');assert.deepEqual(groups[0].memberships,[rows[0],rows[1]]);assert.equal(groups[0].memberships[1],rows[1]);
});
test('existing server page renders each Account once with separate grants and retains owner guard',async()=>{
 let calls=0;
 const memberships=[{id:'g1',accountId:'a',name:'<unsafe>',role:'space_admin',status:'active'},{id:'g2',accountId:'a',name:'<unsafe>',role:'streamer_admin',status:'active'},{id:'g3',accountId:'owner',name:'Owner',role:'space_admin',status:'active'}];
 const c=createPlatformManagement({api:async()=>{calls++;return {space:{id:'h',name:'聲瑪',ownerAccountId:'owner'},memberships,canManageMemberships:true,page:1,pages:2,total:21};},identity:()=> 'president',changed:()=>{},escape:v=>String(v??'').replaceAll('<','&lt;').replaceAll('>','&gt;')});
 await c.openDetail({id:'h'});const html=c.html();assert.equal(calls,1);assert.equal((html.match(/class="pm-member"/g)||[]).length,2);
 assert.ok(html.includes('data-pm-id="g1"'));assert.ok(html.includes('data-pm-id="g2"'));assert.ok(!html.includes('data-pm-id="g3"'));assert.ok(!html.includes('<unsafe>'));assert.ok(html.includes('共 21 筆職務'));assert.ok(html.includes('其他頁的職務仍保留'));
 assert.ok(!html.includes('會員方案'));assert.ok(!html.includes('功能開放設定'));
});
