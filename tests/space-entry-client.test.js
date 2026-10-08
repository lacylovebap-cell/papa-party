import test from 'node:test';
import assert from 'node:assert/strict';
import {requestedSpace,requiresSpaceEntry,chooseSpaceEntry,spaceDestination} from '../src/space-entry.js';

const mount='https://example.test/papa-party/',a={id:'space-001',slug:'papa-party',name:'PA Party',streamerId:'papa',streamerSlug:'papa'},b={id:'space-002',slug:'star',name:'Star',streamerId:'r2',streamerSlug:'lina'};
test('entry gates dedicated, invalid and root URLs before legacy room reads',()=>{
 for(const url of [mount,mount+'star/?streamer=papa',mount+'?streamer=papa&spaceId=forged',mount+'?space=star&streamer=papa',mount+'star/other?streamer=papa'])assert.equal(requiresSpaceEntry(url,mount),true);
 for(const url of [mount+'?streamer=michelle',mount+'index.html?streamer=papa'])assert.equal(requiresSpaceEntry(url,mount),false);
});
test('dedicated URL supports mounted or root deployments without treating streamer or Space ID as a grant',()=>{
 assert.equal(requestedSpace(mount+'star/?streamer=forged&spaceId=forged#admin',mount),'star');
 assert.equal(requestedSpace(mount+'?space=papa-party&streamer=other',mount),'papa-party');
 assert.equal(requestedSpace(mount+'index.html?streamer=michelle&spaceId=space-002',mount),null);
 assert.equal(requestedSpace('https://example.test/star','https://example.test/'),'star');
 for(const url of [mount+'?space=../../star',mount+'star/other','https://foreign.test/papa-party/star','https://foreign.test/papa-party/?space=star','https://example.test/not-mounted/star'])assert.throws(()=>requestedSpace(url,mount));
});
test('Home and Last destinations require a still-permitted result; one Space enters directly and multiple Spaces stay private choices',()=>{
 assert.equal(chooseSpaceEntry({spaces:[a],total:1},{},null).space,a);
 assert.equal(chooseSpaceEntry({spaces:[a,b],total:2},{homeSpace:b,lastSpace:a}).space,b);
 assert.equal(chooseSpaceEntry({spaces:[a],total:1},{homeSpace:b,lastSpace:a}).space,a);
 assert.equal(chooseSpaceEntry({spaces:[a,b],total:2},{homeSpace:{...b,slug:'forged'}}).kind,'choice');
 assert.equal(chooseSpaceEntry({spaces:[a],total:2,hasMore:true},{}).kind,'choice');
 assert.deepEqual(chooseSpaceEntry({spaces:[a],total:1},{homeSpace:b},'star'),{kind:'denied',spaces:[]});
 assert.equal(chooseSpaceEntry({spaces:[a,b],total:2},{homeSpace:a},'star').space,b);
 assert.equal(chooseSpaceEntry({spaces:[],total:0},{homeSpace:b}).kind,'denied');
});
test('destination keeps deployment/cache context and clears old room actions for a full page lifecycle reset',()=>{
 const old=mount+'?v=release&streamer=papa&player=old&commonRequest=old-song&commonKind=saved&tab=queue&adminTab=songs#admin';
 const next=new URL(spaceDestination(old,mount,b,{page:'admin'}));
 assert.equal(next.pathname,'/papa-party/');assert.equal(next.searchParams.get('v'),'release');assert.equal(next.searchParams.get('space'),'star');assert.equal(next.searchParams.get('spaceId'),'space-002');assert.equal(next.searchParams.get('streamer'),'lina');assert.equal(next.hash,'#admin');
 for(const key of ['player','commonRequest','commonKind','tab','adminTab'])assert.equal(next.searchParams.has(key),false);
 assert.equal(new URL(spaceDestination(old,mount,b,{path:true})).pathname,'/papa-party/star');
 assert.throws(()=>spaceDestination(old,mount,{...b,streamerSlug:'../wrong'}));
 assert.throws(()=>spaceDestination('https://foreign.test/',mount,b));
});
