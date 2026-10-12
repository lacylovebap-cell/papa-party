import test from 'node:test';
import assert from 'node:assert/strict';
import {NOTICE_TYPES,canonicalNoticeLink,webNoticePath} from '../src/notification-rules.js';
import {validateNotificationTarget,notificationTargetPath,parseNotificationTarget,notificationTargetView} from '../src/notification-target.js';
const mountUrl='https://example.test/papa-party/';
const link={version:1,spaceId:'space-001',streamerId:'room-1',streamerSlug:'mi chelle',section:'center',entityType:'completed',entityId:'queue:1',notificationId:'notice-1'};
test('notification URL round trip retains the legacy Space and exact entity identity',()=>{
 const path=notificationTargetPath(link);
 assert.equal(path,'./?streamer=mi%20chelle&streamerId=room-1&spaceId=space-001&entityType=completed&entityId=queue%3A1&notificationId=notice-1#center');
 assert.deepEqual(parseNotificationTarget(path,{mountUrl}),link);
 assert.deepEqual(parseNotificationTarget(new URL(path,mountUrl),{mountUrl}),link);
 assert.deepEqual(parseNotificationTarget(new URL(path,mountUrl).href,{baseUrl:mountUrl}),link);
});
test('notice rule serializer and platform-neutral target agree for every supported notice type',()=>{
 for(const type of Object.keys(NOTICE_TYPES))for(const recipient of ['__admin__','__super__','player-1']){
  const target=canonicalNoticeLink({id:'n1',space_id:'space-002',streamer_id:'room-2',recipient,type,entity_id:'e1'},'other-room');
  assert.equal(webNoticePath(target),notificationTargetPath(target));
  assert.deepEqual(parseNotificationTarget(webNoticePath(target),{mountUrl}),target);
 }
});
test('unknown fields and credentials never enter a validated target or generated URL',()=>{
 const input={...link,access_token:'private',password:'private',recipient:'another-player',body:'private note'};
 assert.deepEqual(validateNotificationTarget(input),link);
 assert.equal(notificationTargetPath(input),notificationTargetPath(link));
 for(const key of ['token','access_token','refresh_token','password','apikey','api_key','authorization','auth','sessionToken','credential']){
  const url=new URL(notificationTargetPath(link),mountUrl);url.searchParams.set(key,'private');
  assert.equal(parseNotificationTarget(url,{mountUrl}),null);
 }
});
test('view classification does not treat a song-failure or delivery notice as a queue entity',()=>{
 for(const type of ['live','saved','cancel','ready','accepted','completed','status'])assert.equal(notificationTargetView({...link,entityType:type}),'queue');
 assert.equal(notificationTargetView({...link,entityType:'credit'}),'credit');
 assert.equal(notificationTargetView({...link,entityType:'message'}),'chat');
 for(const type of ['comment','announcement'])assert.equal(notificationTargetView({...link,entityType:type}),'board');
 for(const type of ['failed','delivery','system','achievement'])assert.equal(notificationTargetView({...link,entityType:type}),'generic');
 assert.equal(notificationTargetView({...link,entityType:'queue'}),null);
});
test('nullable legacy Space and absent entity allow a generic notice without invented IDs',()=>{
 const target={...link,spaceId:null,entityType:'system',entityId:null,notificationId:null};
 assert.equal(notificationTargetPath(target),'./?streamer=mi%20chelle&streamerId=room-1&entityType=system#center');
 assert.deepEqual(parseNotificationTarget(notificationTargetPath(target),{mountUrl}),target);
 assert.equal(parseNotificationTarget('./?streamer=papa#center',{mountUrl}),null);
});
test('malformed, unsupported and oversized canonical target fields are rejected',()=>{
 for(const patch of [{version:2},{section:'home'},{section:'__admin__'},{entityType:'unsupported'},{streamerId:''},{streamerId:42},{streamerSlug:' padded '},{spaceId:''},{entityId:'\u0000bad'},{notificationId:'n'.repeat(129)},{entityId:'e'.repeat(257)},{spaceId:'s'.repeat(129)},{streamerSlug:'s'.repeat(129)}]){
  const target={...link,...patch};assert.equal(validateNotificationTarget(target),null);assert.equal(notificationTargetPath(target),null);
 }
 for(const value of [null,{},[],1,'target'])assert.equal(validateNotificationTarget(value),null);
});
test('parser rejects cross-origin, sibling mount, traversal, malformed URL and duplicate identities',()=>{
 const path=notificationTargetPath(link);
 for(const input of [new URL(path,'https://evil.test/papa-party/').href,new URL(path,'https://example.test/papa-party-other/').href,'../'+path.slice(2),'./%2f../?'+path.split('?')[1],'https://user:pass@example.test/papa-party/'+path.slice(2),'http://example.test/papa-party/'+path.slice(2),'./\\'+path.slice(2),path+'\n','https://[invalid/',path+'&'.repeat(4096)])assert.equal(parseNotificationTarget(input,{mountUrl}),null,input);
 for(const key of ['streamer','streamerId','spaceId','entityType','entityId','notificationId']){
  const url=new URL(path,mountUrl);url.searchParams.append(key,'different');assert.equal(parseNotificationTarget(url,{mountUrl}),null);
 }
 assert.equal(parseNotificationTarget(path),null,'URL acceptance requires an explicit mount/base boundary');
 assert.equal(parseNotificationTarget(path,{baseUrl:mountUrl,mountUrl:'https://evil.test/'}),null);
});
