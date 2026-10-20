import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {installed,pagePreference,readPreference,launchPlan,PREFERENCE_KEY,HOME_KEY,normalizeHome,readHome,saveHome,readLegacyHome} from '../src/pwa-start.js';
const mount='https://paparty.app/',room={id:'r1',slug:'papa',spaceId:'space-001',active:true};
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),values};};
const pref=pagePreference(mount+'v2.html?streamer=papa#book',mount,room);
const plan=(tail,extra={})=>launchPlan({href:mount+tail,mount,standalone:true,preference:pref,...extra});
test('Android and iOS installed modes only; normal browser unaffected',()=>{
 assert.equal(installed({navigator:{standalone:true}}),true);assert.equal(installed({matchMedia:()=>({matches:true})}),true);assert.equal(installed({navigator:{}}),false);assert.equal(plan('?appLaunch=1',{standalone:false}),null);
});
test('old and new APP launch markers always enter APP shell rather than official sales root',()=>{
 for(const entry of ['','index.html','?appLaunch=1','#home','index.html?appLaunch=1'])for(const preference of [null,pref,{version:1,kind:'portal',path:'/'}])assert.deepEqual(plan(entry,{preference}),{target:mount+'app.html',portal:false});
 for(const navigationType of ['reload','back_forward'])assert.equal(plan('#home',{navigationType}).target,mount+'app.html');
});
test('explicit shared/push/login/deep links and external legacy home links are preserved',()=>{
 for(const tail of ['#features','?streamer=papa#book','?notificationId=n#center','?entryLogin=player','?appLaunch=1&notificationId=n','?appLaunch=1&appLaunch=1','v2.html?streamer=papa#home','pa','pa/book','sm'])assert.equal(plan(tail),null);
 assert.equal(plan('',{referrer:mount+'sm'}),null);assert.equal(plan('',{referrer:'https://messenger.example/chat'}),null);
 assert.equal(plan('#home',{referrer:'https://messenger.example/chat'}),null);assert.equal(plan('#home',{referrer:mount+'lobby.html'}).target,mount+'app.html');
});
test('legacy v1 API continues to validate confirmed rooms and strip credentials',()=>{
 assert.equal(pagePreference(mount+'v2.html?streamer=papa#book',mount),null);assert.equal(pagePreference(mount+'v2.html?streamer=papa#book',mount,{...room,active:false}),null);assert.equal(pagePreference('https://evil.test/v2.html?streamer=papa#book',mount,room),null);
 const p=pagePreference(mount+'v2.html?streamer=papa&token=secret&player=private&notificationId=x&adminTab=queue#admin',mount,room);assert.equal(p.path,'/v2.html?streamer=papa&adminTab=queue#admin');assert.equal(p.streamerId,'r1');assert.deepEqual(readPreference({getItem:()=>JSON.stringify(pref)},mount),pref);
});
test('v2 stores only stable scope and public names, keeps old and unrelated storage intact',()=>{
 const s=storage();s.setItem(PREFERENCE_KEY,JSON.stringify(pref));s.setItem('papa.session','private');const value=saveHome(s,{kind:'streamer',spaceId:'space-001',streamerId:'r1',name:'怕怕',spaceName:'聲瑪',path:'/pa/admin',token:'secret',playerId:'private'},{source:'user'});
 assert.deepEqual(value,{v:2,kind:'streamer',spaceId:'space-001',streamerId:'r1',name:'怕怕',spaceName:'聲瑪',source:'user'});assert.deepEqual(readHome(s),value);assert.equal(s.getItem(PREFERENCE_KEY),JSON.stringify(pref));assert.equal(s.getItem('papa.session'),'private');assert.doesNotMatch(s.getItem(HOME_KEY),/secret|private|admin/);
});
test('bad identities, records and unavailable storage do not create valid homes',()=>{
 for(const value of [{kind:'portal',spaceId:'x'},{kind:'streamer',spaceId:'x',streamerId:'bad id'},{kind:'hall',spaceId:'x',streamerId:'r1'}])assert.equal(normalizeHome(value),null);
 for(const raw of [null,'{',JSON.stringify({v:2,kind:'hall',spaceId:'x',source:'unknown'}),JSON.stringify({version:1,kind:'hall',spaceId:'x'})])assert.equal(readHome({getItem:()=>raw}),null);
 assert.throws(()=>saveHome(null,{kind:'hall',spaceId:'x'}),/儲存/);
});
test('legacy migration distinguishes portal and hall and drops old subpage purpose',()=>{
 const source=readLegacyHome({getItem:()=>JSON.stringify(pref)},mount);assert.deepEqual(source,{home:{v:1,kind:'streamer',spaceId:'space-001',streamerId:'r1'},requiresChoice:false});assert.deepEqual(readLegacyHome({getItem:()=>JSON.stringify({version:1,kind:'portal',path:'/'})},mount),{home:null,requiresChoice:true});assert.equal(readLegacyHome({getItem:()=>JSON.stringify({...pref,path:'https://evil.test/'})},mount),null);
});
test('generic installed manifest keeps one stable APP identity and launcher entry',()=>{
 const m=JSON.parse(fs.readFileSync('manifest.webmanifest','utf8'));assert.equal(m.id,'./');assert.equal(m.scope,'./');assert.equal(m.start_url,'./app.html');
});
