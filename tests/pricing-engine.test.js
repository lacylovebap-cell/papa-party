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
 assert.match(quoteSummary(shengma,quoteLive(shengma,{units:4})),/自動套用最優惠方案：一般 3 首 ＋ 一般 1 首/);
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
