import test from 'node:test';
import assert from 'node:assert/strict';
import {communicationTarget} from '../src/communication-target.js';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const context={spaceId:'S',streamerId:'R',streamer:'room',playerId:'P',manager:false};
const target={found:true,kind:'chat',spaceId:'S',streamerId:'R',playerId:'P',messageId:uuid(1),seq:22};
test('authenticated communication locator stays bound to exact Space, Room and player',()=>{
 assert.deepEqual(communicationTarget(target,context,'chat'),{playerId:'P',messageId:uuid(1),seq:22});
 for(const patch of [{found:false},{spaceId:'other'},{streamerId:'room'},{playerId:'other'},{messageId:'P'},{seq:0},{seq:999999999999999},{kind:'board'}])assert.equal(communicationTarget({...target,...patch},context,'chat'),null);
 assert.equal(communicationTarget(target,{...context,demo:true},'chat'),null);
 assert.ok(communicationTarget({...target,playerId:'other'},{...context,manager:true},'chat'));
});
test('board locators require actual root and reply UUIDs with a bounded anchor',()=>{
 const board={...target,kind:'board',scope:'global',rootId:uuid(2),postId:uuid(3),canReply:false};
 assert.deepEqual(communicationTarget(board,context,'board'),{scope:'global',rootId:uuid(2),postId:uuid(3),seq:22,canReply:false});
 for(const patch of [{scope:'private'},{rootId:'room'},{postId:'P'},{spaceId:'other'},{streamerId:'other'}])assert.equal(communicationTarget({...board,...patch},context,'board'),null);
});
