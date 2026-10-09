import test from 'node:test';
import assert from 'node:assert/strict';
import {venuePolicySettings,venuePolicyRequestVenue,venuePolicyHistoryVenue,venuePolicyLedgerPool,venuePolicyConsumedPool,venuePolicyQueueSnapshot,venuePolicyBalance,venuePolicyReservedCredits,venuePolicyAvailableCredits,venuePolicySavedSnapshot} from '../src/venue-policy.js';
import {balance,reservedCredits,quoteSong,savedQuota,canRequestSaved} from '../src/core.js';

const playerId='player',now='2026-10-09T12:30:00Z';
const ledger=(amount,storage_pool,extra={})=>({playerId,amount,...(storage_pool===undefined?{}:{storage_pool}),...extra});
const queue=(creditCost,consumed_storage_pool,extra={})=>({id:'request',playerId,kind:'saved',status:'waiting',at:now,...(creditCost===undefined?{}:{creditCost}),...(consumed_storage_pool===undefined?{}:{consumed_storage_pool}),...extra});
const room=(extra={})=>({settings:{hourlyLimit:2},ledger:[],queue:[],songs:[],crowns:[],...extra});
const radio=extra=>room({settings:{hourlyLimit:2,radio_enabled:true,current_space:'radio'},...extra});

test('legacy settings and balances keep the original shengma defaults',()=>{
 const state=room({ledger:[ledger(5),ledger(-1),ledger(50,'shengma',{playerId:'other'})],queue:[queue(),queue(2,undefined,{id:'second'})]});
 assert.deepEqual(venuePolicySettings(),{radio_enabled:false,current_space:'shengma'});
 assert.equal(venuePolicyRequestVenue(state),'shengma');
 assert.equal(venuePolicyLedgerPool({}),'shengma');assert.equal(venuePolicyConsumedPool({}),'shengma');
 assert.equal(venuePolicyLedgerPool({storage_pool:null}),'shengma');assert.equal(venuePolicyConsumedPool({consumed_storage_pool:null}),'shengma');
 assert.equal(venuePolicyBalance(state,playerId),balance(state,playerId));
 assert.equal(venuePolicyReservedCredits(state,playerId),reservedCredits(state,playerId));
 assert.equal(venuePolicyAvailableCredits(state,playerId),1);
 assert.deepEqual(venuePolicySavedSnapshot(state,playerId,1),{venue:'shengma',consumed_storage_pool:'shengma'});
});

test('pool balances project the same ledger while reservations use consumed source',()=>{
 const state=radio({ledger:[ledger(7),ledger(-2),ledger(4,'radio'),ledger(-0.5,'radio'),ledger(100,'radio',{playerId:'other'})],queue:[queue(2,'shengma',{venue:'radio'}),queue(1,'radio',{id:'radio',venue:'radio',status:'pending'}),queue(undefined,undefined,{id:'legacy',venue:'radio'}),queue(20,'radio',{id:'other',playerId:'other'})]});
 assert.equal(venuePolicyBalance(state,playerId,'shengma'),5);assert.equal(venuePolicyBalance(state,playerId,'radio'),3.5);
 assert.equal(venuePolicyBalance(state,playerId,'shengma'),balance(state,playerId,'shengma'));assert.equal(venuePolicyBalance(state,playerId,'radio'),balance(state,playerId));
 assert.equal(venuePolicyReservedCredits(state,playerId,'shengma'),3);assert.equal(venuePolicyReservedCredits(state,playerId,'radio'),1);
 assert.equal(venuePolicyReservedCredits(state,playerId,'shengma'),reservedCredits(state,playerId,'shengma'));assert.equal(venuePolicyReservedCredits(state,playerId,'radio'),reservedCredits(state,playerId));
 assert.equal(venuePolicyAvailableCredits(state,playerId,'shengma'),2);assert.equal(venuePolicyAvailableCredits(state,playerId,'radio'),2.5);
});

test('cancelled, completed, stored and live rows do not reserve either pool',()=>{
 const state=radio({ledger:[ledger(5,'radio')],queue:[queue(2,'radio'),...['cancelled','completed','stored','deleted'].map(status=>queue(4,'radio',{id:status,status})),queue(4,'radio',{id:'live',kind:'live'}),queue(4,'radio',{id:'self',kind:'self'})]});
 const before=structuredClone(state);
 assert.equal(venuePolicyReservedCredits(state,playerId,'radio'),2);
 assert.equal(venuePolicyReservedCredits(state,playerId,'radio',{excludeQueueId:'request'}),0);
 assert.equal(venuePolicyAvailableCredits(state,playerId,'radio',{excludeQueueId:'request'}),5);
 assert.equal(venuePolicyAvailableCredits(state,playerId,'radio',{excludeQueueId:'missing'}),3);
 assert.deepEqual(state,before);
 state.queue[0].status='cancelled';assert.equal(venuePolicyAvailableCredits(state,playerId,'radio'),5);
});

test('radio prefers its own sufficient pool and falls back for an actual two-credit quote',()=>{
 const state=radio({ledger:[ledger(2,'radio'),ledger(3,'shengma')],songs:[{songId:'weighted',title:'長歌',artist:'歌手',creditCost:2}]});
 const quoted=quoteSong(state,'weighted',{},playerId,now);
 assert.equal(quoted.creditCost,2);
 assert.deepEqual(venuePolicySavedSnapshot(state,playerId,quoted.creditCost),{venue:'radio',consumed_storage_pool:'radio'});
 state.queue.push(queue(1,'radio'));
 const before=structuredClone(state),snapshot=venuePolicySavedSnapshot(state,playerId,quoted.creditCost);
 assert.deepEqual(snapshot,{venue:'radio',consumed_storage_pool:'shengma'});assert.deepEqual(state,before);
 state.queue.push(queue(quoted.creditCost,snapshot.consumed_storage_pool,{id:'fallback',...snapshot}));
 assert.equal(venuePolicyAvailableCredits(state,playerId,'radio'),1);assert.equal(venuePolicyAvailableCredits(state,playerId,'shengma'),1);
 state.ledger.push(ledger(-quoted.creditCost,snapshot.consumed_storage_pool));state.queue.at(-1).status='completed';
 assert.equal(venuePolicyBalance(state,playerId,'radio'),2);assert.equal(venuePolicyBalance(state,playerId,'shengma'),1);
});

test('radio uses shengma when empty but never combines insufficient pools or makes a negative pool',()=>{
 const state=radio({ledger:[ledger(2,'shengma')]});
 assert.deepEqual(venuePolicySavedSnapshot(state,playerId,2),{venue:'radio',consumed_storage_pool:'shengma'});
 for(const [radioBalance,shengmaBalance] of [[0,0],[1,1],[1.5,1.5],[0,1]]){
  const insufficient=radio({ledger:[ledger(radioBalance,'radio'),ledger(shengmaBalance,'shengma')]}),before=structuredClone(insufficient);
  assert.throws(()=>venuePolicySavedSnapshot(insufficient,playerId,2),/不足/);assert.deepEqual(insufficient,before);
  assert.equal(venuePolicyBalance(insufficient,playerId,'radio'),radioBalance);assert.equal(venuePolicyBalance(insufficient,playerId,'shengma'),shengmaBalance);
 }
});

test('shengma cannot use radio credits even when the radio feature is enabled',()=>{
 const state=room({settings:{radio_enabled:true,current_space:'shengma'},ledger:[ledger(20,'radio'),ledger(1,'shengma')]});
 assert.deepEqual(venuePolicySavedSnapshot(state,playerId,1),{venue:'shengma',consumed_storage_pool:'shengma'});
 assert.throws(()=>venuePolicySavedSnapshot(state,playerId,2),/不足/);
 assert.throws(()=>venuePolicyQueueSnapshot({venue:'shengma',consumed_storage_pool:'radio'}),/不能使用/);
});

test('new snapshots and saved sources stay immutable after venue switch or disabling radio',()=>{
 const state=radio({ledger:[ledger(3,'radio'),ledger(4,'shengma')]}),snapshot=venuePolicySavedSnapshot(state,playerId,2);
 assert.equal(Object.isFrozen(snapshot),true);assert.throws(()=>{snapshot.venue='shengma';},TypeError);
 state.queue.push(queue(2,snapshot.consumed_storage_pool,{...snapshot}));
 state.settings.current_space='shengma';state.settings.radio_enabled=false;
 assert.deepEqual(snapshot,{venue:'radio',consumed_storage_pool:'radio'});
 assert.equal(venuePolicyRequestVenue(state),'shengma');assert.equal(venuePolicyReservedCredits(state,playerId,'radio'),2);
 assert.equal(venuePolicyReservedCredits(state,playerId,'shengma'),0);
 assert.deepEqual(venuePolicyQueueSnapshot(state.queue[0]),snapshot);
 assert.deepEqual(venuePolicySavedSnapshot(state,playerId,2),{venue:'shengma',consumed_storage_pool:'shengma'});
});

test('historical absent venues remain unknown and absent consumed sources default only for saved rows',()=>{
 const legacy={kind:'saved'},before=structuredClone(legacy);
 assert.equal(venuePolicyHistoryVenue(legacy),null);assert.equal(venuePolicyHistoryVenue({venue:null}),null);
 assert.deepEqual(venuePolicyQueueSnapshot(legacy),{venue:null,consumed_storage_pool:'shengma'});
 assert.deepEqual(venuePolicyQueueSnapshot({kind:'live'}),{venue:null,consumed_storage_pool:null});
 assert.deepEqual(venuePolicyQueueSnapshot({kind:'saved',consumed_storage_pool:'radio'}),{venue:null,consumed_storage_pool:'radio'});
 assert.equal(Object.isFrozen(venuePolicyQueueSnapshot(legacy)),true);assert.deepEqual(legacy,before);
 assert.equal(venuePolicyHistoryVenue({venue:'radio'}),'radio');
});

test('manual venue overrides require a server-authorized manager and enabled radio',()=>{
 const enabled=radio({ledger:[ledger(3,'shengma'),ledger(3,'radio')]}),disabled=room({settings:{radio_enabled:false,current_space:'radio'},ledger:[ledger(3,'radio')]});
 assert.deepEqual(venuePolicySettings(disabled.settings),{radio_enabled:false,current_space:'shengma'});
 for(const venue of ['shengma','radio'])assert.throws(()=>venuePolicySavedSnapshot(enabled,playerId,1,{venue}),/不能自行/);
 assert.throws(()=>venuePolicyRequestVenue(enabled,{venue:'radio',allowOverride:'true'}),/不能自行/);
 assert.equal(venuePolicyRequestVenue(enabled,{venue:'shengma',allowOverride:true}),'shengma');
 assert.deepEqual(venuePolicySavedSnapshot(enabled,playerId,2,{venue:'shengma',allowOverride:true}),{venue:'shengma',consumed_storage_pool:'shengma'});
 assert.throws(()=>venuePolicyRequestVenue(disabled,{venue:'radio',allowOverride:true}),/尚未啟用/);
 assert.throws(()=>venuePolicySavedSnapshot(disabled,playerId,1),/不足/);
});

test('settings, snapshot sources and actual quoted costs reject malformed values',()=>{
 for(const radio_enabled of ['true',1,null])assert.throws(()=>venuePolicySettings({radio_enabled}),/啟用/);
 for(const current_space of ['space-001','papa','',null])assert.throws(()=>venuePolicySettings({radio_enabled:true,current_space}),/不正確/);
 assert.deepEqual(venuePolicySettings({radio_enabled:true}),{radio_enabled:true,current_space:'shengma'});
 const state=radio({ledger:[ledger(10,'radio')]});
 for(const cost of [0,-1,0.25,NaN,Infinity,1000000,'2',null,undefined])assert.throws(()=>venuePolicySavedSnapshot(state,playerId,cost),/首數/);
 for(const pool of ['space-001','papa','',null]){
  assert.throws(()=>venuePolicyBalance(state,playerId,pool),/不正確/);
  if(pool!==null)assert.throws(()=>venuePolicyLedgerPool({storage_pool:pool}),/不正確/);
 }
 assert.throws(()=>venuePolicyQueueSnapshot({venue:'radio',consumed_storage_pool:'unknown'}),/不正確/);
 assert.throws(()=>venuePolicyHistoryVenue({venue:'unknown'}),/不正確/);
});

test('weighted and paired-half quotes share the existing hourly quota across venues',()=>{
 const state=radio({ledger:[ledger(5,'radio'),ledger(5,'shengma')],songs:[{songId:'long',title:'長歌',artist:'歌手',creditCost:2},{songId:'half-a',title:'半首甲',artist:'歌手',creditCost:0.5,shortMode:'both',pairSongIds:['half-b']},{songId:'half-b',title:'半首乙',artist:'歌手',creditCost:0.5}]});
 for(const payload of [{},{pairSongId:'half-b'}]){
  const quoted=quoteSong(state,'half-a',payload,playerId,now);assert.equal(quoted.creditCost,1);
  const snapshot=venuePolicySavedSnapshot(state,playerId,quoted.creditCost);
  assert.deepEqual(snapshot,{venue:state.settings.current_space,consumed_storage_pool:state.settings.current_space});
  state.queue.push(queue(quoted.creditCost,snapshot.consumed_storage_pool,{id:'half-'+state.queue.length,...snapshot}));
  state.settings.current_space='shengma';
 }
 const before=structuredClone(state),quota=savedQuota(state,now,playerId);
 assert.equal(quota.reserved,2);assert.equal(quota.totalRemaining,0);assert.equal(canRequestSaved(state,now,1,playerId),false);
 state.settings.current_space='radio';assert.deepEqual(savedQuota(state,now,playerId),quota);
 state.settings.current_space='shengma';assert.deepEqual(state,before);
 const long=quoteSong(state,'long',{},playerId,now);assert.equal(long.creditCost,2);
 assert.deepEqual(venuePolicySavedSnapshot(state,playerId,long.creditCost),{venue:'shengma',consumed_storage_pool:'shengma'});
 assert.equal(canRequestSaved(state,now,long.creditCost,playerId),false);
 assert.deepEqual(state,before);
});
