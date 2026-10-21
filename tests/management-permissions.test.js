import test from 'node:test';
import assert from 'node:assert/strict';
import {managerPermissionRequirement as requirement} from '../src/management-permissions.js';
test('manager permissions cover writes, private reads and deny new operations by default',()=>{
 for(const type of ['song','songsBulk','lyrics','newPracticeSet'])assert.equal(requirement({op:'mutate',action:{type}}),'songs');
 for(const type of ['queue','onBehalf','streamerDraw'])assert.equal(requirement({op:'mutate',action:{type}}),'queue');
 for(const type of ['allocate','ledger','player','crown'])assert.equal(requirement({op:'mutate',action:{type}}),'players');
 assert.equal(requirement({op:'read'}),'all','legacy manager read includes multiple private modules');
 assert.equal(requirement({op:'futureUnsafeWrite'}),'all');assert.equal(requirement({op:'publicRouteSave'}),'all');
 for(const op of ['deviceLogout','platformManageSpace','boardThreads','chatSend'])assert.equal(requirement({op}),null);
});
