import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS} from '../src/core.js';
import {pricingFromSettings,normalizePricing,pricingProblems,quoteLive,quoteLines,quoteSummary,shownParties,PRICING_NOTE,SHENGMA_NAMES} from '../src/pricing-engine.js';

const shengma=pricingFromSettings(DEFAULTS);
const three=q=>[q.singer,q.host,q.hall,q.total];

test('聲瑪 current settings convert without loss: names, unit, per-song values and four plans',()=>{
 assert.deepEqual({...shengma.names},{...SHENGMA_NAMES});
 assert.equal(shengma.unit,'探鑽');assert.equal(shengma.mode,'double');
 assert.deepEqual({...shengma.perUnit},{singer:2990,host:500,hall:500});
 assert.deepEqual(shengma.plans.map(p=>[p.name,p.units,p.singer,p.host,p.hall]),
  [['一般 2 首',2,5555,990,990],['一般 3 首',3,7299,1399,1399],['一般 6 首',6,13999,2799,2799],['🏅 金牌歌單',10,22887,4200,4200]]);
});

test('ordinary live price multiplies all three parties by the slots the song occupies (spec 4)',()=>{
 const fixed=normalizePricing({...shengma,policy:'fixed'});
 assert.deepEqual(three(quoteLive(fixed,{units:1})),[2990,500,500,3990]);
 assert.deepEqual(three(quoteLive(fixed,{units:2})),[5980,1000,1000,7980]);
 assert.deepEqual(three(quoteLive(fixed,{units:3})),[8970,1500,1500,11970]);
 assert.deepEqual(three(quoteLive(fixed,{units:4})),[11960,2000,2000,15960]);
});

test('聲瑪 automatically picks the cheapest legal plan combination by the three-party total (spec 5.3)',()=>{
 const cases=[[1,[2990,500,500,3990],[]],[2,[5555,990,990,7535],['一般 2 首']],[3,[7299,1399,1399,10097],['一般 3 首']],
  [4,[10289,1899,1899,14087],['一般 3 首','一般 1 首']],[5,[12854,2389,2389,17632],['一般 3 首','一般 2 首']],
  [6,[13999,2799,2799,19597],['一般 6 首']],[10,[22887,4200,4200,31287],['🏅 金牌歌單']]];
 for(const [units,values,names] of cases){
  const q=quoteLive(shengma,{units});
  assert.deepEqual(three(q),values,units+' 首');
  assert.deepEqual(q.pieces.map(p=>p.kind==='plan'?p.name:'一般 '+p.units+' 首'),names,units+' 首');
 }
 // A plan's own values are never multiplied again (spec 5.2).
 assert.equal(quoteLive(shengma,{units:2}).host,990);
 assert.match(quoteSummary(shengma,quoteLive(shengma,{units:4})),/自動套用最優惠方案：3 首 ＋ 一般 1 首/);
});

test('a crowned song: other players pay the crown price for the singer, host and hall stay at the normal per-slot values, no discounts (spec 7.4)',()=>{
 const crown={playerId:'owner',price:4200};
 assert.deepEqual(three(quoteLive(shengma,{units:1,crown,playerId:'other'})),[4200,500,500,5200]);
 const two=quoteLive(shengma,{units:2,crown,playerId:'other'});
 assert.deepEqual(three(two),[8400,1000,1000,10400]);assert.equal(two.source,'crown');assert.deepEqual(two.pieces,[]);
 // The crown owner keeps ordinary pricing, plans included.
 assert.deepEqual(three(quoteLive(shengma,{units:2,crown,playerId:'owner'})),[5555,990,990,7535]);
 // A card never lowers a crowned price.
 assert.deepEqual(three(quoteLive(shengma,{units:1,crown,playerId:'other',card:{name:'VIP',perUnit:{singer:100}}})),[4200,500,500,5200]);
});

test('card holder per-slot prices: blank inherits, an explicit 0 means no fee, and plans still compete (spec 8.2, 8.3)',()=>{
 const vip={name:'VIP 卡',perUnit:{singer:2000,host:'',hall:0}};
 const one=quoteLive(shengma,{units:1,card:vip});
 assert.deepEqual(three(one),[2000,500,0,2500]);assert.equal(one.source,'card');
 const two=quoteLive(shengma,{units:2,card:vip});
 assert.deepEqual(three(two),[4000,1000,0,5000],'per-slot VIP beats the 2-song plan here');
 const pricey=quoteLive(shengma,{units:2,card:{name:'金卡',perUnit:{singer:3500}}});
 assert.deepEqual(three(pricey),[5555,990,990,7535],'the cheaper legal plan wins over a dearer card price');
 assert.equal(pricey.source,'card+plan');
});

test('billing modes: single collects host or hall only, none collects the singer only (spec 2.3)',()=>{
 const single=normalizePricing({mode:'single',singleFee:'hall',perUnit:{singer:1000,host:300,hall:200},names:{singer:'歌姬'},unit:'鑽'});
 assert.deepEqual(three(quoteLive(single,{units:2})),[2000,0,400,2400]);
 assert.deepEqual(shownParties(single),['singer','hall']);
 const none=normalizePricing({mode:'none',perUnit:{singer:1000,host:300,hall:200}});
 assert.deepEqual(three(quoteLive(none,{units:1})),[1000,0,0,1000]);assert.deepEqual(shownParties(none),['singer']);
 assert.deepEqual(pricingProblems({mode:'single',perUnit:{singer:1,host:1,hall:1}}),['一般每首：單費模式只能收主持或廳主號其中一項']);
 assert.deepEqual(pricingProblems({mode:'none',perUnit:{singer:1,host:0,hall:5}}),['一般每首：無雙費模式不收主持或廳主號費']);
 assert.deepEqual(pricingProblems({mode:'double',perUnit:{singer:1,host:0,hall:0},plans:[{name:'只收單費',host:5,hall:0}]}),[]);
});

test('a Space with its own pricing uses its own names and unit; lines show only the parties it collects',()=>{
 const hall=pricingFromSettings({pricing:{mode:'double',names:{singer:'歌姬',host:'主持人',hall:'廳主'},unit:'星鑽',perUnit:{singer:800,host:100,hall:50},plans:[],policy:'fixed'}},{shengma:false});
 const q=quoteLive(hall,{units:1});
 assert.deepEqual(quoteLines(hall,q).map(l=>l.text),['給歌姬 800 星鑽','給主持人 100 星鑽','給廳主 50 星鑽']);
 const blank=pricingFromSettings({livePrice:0,liveDouble:0,plans:[]},{shengma:false});
 assert.deepEqual({...blank.names},{singer:'主播',host:'主持',hall:'廳主號'});assert.equal(blank.unit,'');
 assert.deepEqual(three(quoteLive(blank,{units:1})),[0,0,0,0]);
 assert.match(PRICING_NOTE,/僅供參考/);
});

test('policy: fixed never uses plans; streamer choice follows the room switch (spec 5.5)',()=>{
 assert.equal(quoteLive(normalizePricing({...shengma,policy:'fixed'}),{units:2}).total,7980);
 assert.equal(quoteLive(normalizePricing({...shengma,policy:'streamer',streamerUsesPlans:false}),{units:2}).total,7980);
 assert.equal(quoteLive(normalizePricing({...shengma,policy:'streamer',streamerUsesPlans:true}),{units:2}).total,7535);
 assert.throws(()=>quoteLive(shengma,{units:0.3}),/0.5 的倍數/);
});

// ---- Hall pricing (batch 2) ----
import {hallPricingInput,legacyHallPricing,blankHallPricing,HALL_PRICING_VERSION} from '../src/pricing-engine.js';

const shengmaHall=()=>legacyHallPricing(DEFAULTS);

test('聲瑪 as a hall record: same names, unit, per-song fees, four plans, five crown cards by level with 18,188 opening fees',()=>{
 const hall=shengmaHall();
 assert.equal(hall.v,HALL_PRICING_VERSION);assert.equal(hall.mode,'double');assert.equal(hall.policy,'auto');
 assert.deepEqual(hall.names,{singer:'歌手',host:'2號位主持',hall:'聲瑪樂團'});assert.equal(hall.unit,'探鑽');
 assert.deepEqual(hall.perUnit,{singer:2990,host:500,hall:500});
 assert.deepEqual(hall.plans.map(p=>[p.id,p.name,p.units,p.singer,p.host,p.hall,p.live,p.enabled]),
  [['plan-1','一般 2 首',2,5555,990,990,true,true],['plan-2','一般 3 首',3,7299,1399,1399,true,true],['plan-3','一般 6 首',6,13999,2799,2799,true,true],['plan-4','🏅 金牌歌單',10,22887,4200,4200,true,true]]);
 assert.deepEqual(hall.tiers.map(t=>[t.name,t.fee,t.price,t.host,t.hall,t.months]),
  [['至尊卡',925000,55599,18188,18188,0],['黑卡',500000,27999,18188,18188,3],['鑽石卡',375000,18188,18188,18188,1],['鉑金卡',125000,9999,18188,18188,1],['金卡',55599,4200,18188,18188,1]],
  'level 1 (至尊卡) first, as spec 13.3');
 assert.deepEqual(hallPricingInput(JSON.parse(JSON.stringify(hall))),hall,'a stored record round-trips unchanged');
});

test('a hall record prices exactly like the legacy settings it replaces, for every slot count and for crowned songs',()=>{
 const legacy=pricingFromSettings(DEFAULTS),hall=pricingFromSettings({livePrice:1,liveDouble:1,plans:[],tiers:[]},{hall:shengmaHall()});
 for(let half=1;half<=40;half++){const units=half/2;assert.deepEqual(quoteLive(hall,{units}),quoteLive(legacy,{units}),units+' 首');}
 const crown={playerId:'owner',price:4200};
 assert.deepEqual(quoteLive(hall,{units:2,crown,playerId:'other'}),quoteLive(legacy,{units:2,crown,playerId:'other'}));
 assert.deepEqual(hall.tiers,legacy.tiers);assert.deepEqual(hall.names,legacy.names);assert.equal(hall.unit,legacy.unit);
});

test('the hall record wins over a streamer\'s own legacy price fields; without one the legacy fields still apply',()=>{
 const own={...DEFAULTS,livePrice:9999};
 const hall={...blankHallPricing({names:{singer:'歌姬'},unit:'星鑽'}),perUnit:{singer:800,host:100,hall:50}};
 const q=quoteLive(pricingFromSettings(own,{hall:hallPricingInput(hall)}),{units:1});
 assert.deepEqual([q.singer,q.host,q.hall],[800,100,50]);
 assert.equal(quoteLive(pricingFromSettings(own,{hall:null}),{units:1}).singer,9999);
});

test('a new hall starts blank and the form refuses what a hall cannot charge, in plain words',()=>{
 const blank=blankHallPricing();
 assert.deepEqual([blank.names,blank.unit,blank.perUnit,blank.plans,blank.tiers],[{singer:'主播',host:'主持',hall:'廳主號'},'',{singer:0,host:0,hall:0},[],[]]);
 const base=()=>JSON.parse(JSON.stringify(blank));
 const reject=(change,pattern)=>{const v=base();change(v);assert.throws(()=>hallPricingInput(v),pattern);};
 reject(v=>{v.mode='single';delete v.singleFee;v.singleFee='x';},/單費模式請選擇收給誰/);
 reject(v=>{v.mode='single';v.singleFee='host';v.perUnit={singer:1,host:1,hall:1};},/一般每首：單費模式只收主持費/);
 reject(v=>{v.mode='none';v.perUnit={singer:1,host:0,hall:5};},/無雙費模式不收主持或廳主號費/);
 reject(v=>{v.perUnit.singer=-1;},/一般每首的主播請填 0 以上的整數/);
 reject(v=>{v.perUnit.singer=1.5;},/整數/);
 reject(v=>{v.names.singer='  ';},/請填主播稱呼/);
 reject(v=>{v.names.host='一二三四五六七八九十一';},/主持稱呼最多 10 個字/);
 reject(v=>{v.plans=[{id:'p1',name:'兩首',units:0,singer:1,host:0,hall:0}];},/「兩首」的首數請填 1～100 的整數/);
 reject(v=>{v.plans=[{id:'p1',name:'a',units:2,singer:1},{id:'p1',name:'b',units:3,singer:1}];},/識別碼不正確/);
 reject(v=>{v.tiers=[{id:'t1',name:'金卡',fee:1,price:1,months:1},{id:'t2',name:'金卡',fee:1,price:1,months:1}];},/冠歌卡名稱「金卡」重複了/);
 reject(v=>{v.tiers=[{id:'t1',name:'金卡',fee:1,price:1,months:121}];},/期限請填 0～120 個月/);
 reject(v=>{v.extra=true;},/價目設定格式不正確/);
 reject(v=>{v.v=2;},/版本不正確/);
 // A double-fee hall may still have a plan that collects one extra fee or none (spec 2.3).
 const ok=base();ok.plans=[{id:'p1',name:'只收主持',units:2,singer:10,host:5,hall:0}];
 assert.equal(hallPricingInput(ok).plans[0].hall,0);
 // Text numbers from a form are accepted when they are whole numbers.
 const typed=base();typed.perUnit={singer:'2990',host:'500',hall:'500'};
 assert.deepEqual(hallPricingInput(typed).perUnit,{singer:2990,host:500,hall:500});
});
