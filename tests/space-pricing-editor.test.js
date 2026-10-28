import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS} from '../src/core.js';
import {legacyHallPricing,blankHallPricing} from '../src/pricing-engine.js';
import {pricingDraft,forSave,changePricingDraft,pricingEditorHtml,pricingBasicsHtml,pricingParties} from '../src/space-pricing-editor.js';

const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(name,label,id='',extra='')=>`<button data-pm-action="${name}" data-pm-id="${h(id)}" ${extra}>${label}</button>`;
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();

test('the editor round-trips 聲瑪 unchanged, and a mode change drops only what that mode does not collect',()=>{
 const stored=legacyHallPricing(DEFAULTS),draft=pricingDraft(stored,19);
 assert.deepEqual(forSave(draft),stored,'opening and saving changes nothing');
 const single={...draft,mode:'single',singleFee:'hall'};
 const saved=forSave(single);
 assert.deepEqual([saved.perUnit.host,saved.perUnit.hall,saved.plans[0].host,saved.plans[0].hall,saved.tiers[0].host],[0,500,0,990,0]);
 assert.deepEqual(forSave({...single,mode:'double'}),stored,'switching back keeps the typed values');
 assert.deepEqual(pricingParties({mode:'none'}),['singer']);
});

test('plans and crown cards can be added, moved and removed; new ones open for editing',()=>{
 let d=pricingDraft(legacyHallPricing(DEFAULTS),19);
 d=changePricingDraft(d,'add-plan');assert.equal(d.plans.length,5);assert.match(d.plans[4].id,/^plan-[a-z0-9]+$/);assert.ok(d.open.includes(d.plans[4].id));
 d=changePricingDraft(d,'plan-up',4);assert.equal(d.plans[3].name,'');
 d=changePricingDraft(d,'remove-plan',3);assert.deepEqual(d.plans.map(p=>p.name),['一般 2 首','一般 3 首','一般 6 首','🏅 金牌歌單']);
 d=changePricingDraft(d,'tier-down',0);assert.deepEqual(d.tiers.slice(0,2).map(t=>t.name),['黑卡','至尊卡']);
 d=changePricingDraft(d,'tier-up',0);assert.equal(d.tiers[0].name,'黑卡','already first: no change');
 d=changePricingDraft(d,'add-tier');assert.throws(()=>forSave(d),/冠歌卡第 6 張的名稱/);
});

test('the form shows folded summaries in the hall\'s words, blank Spaces say so, and the basics show only the names a mode needs',()=>{
 const e={info:{spaceId:'space-001',name:'聲瑪',kind:'hall',revision:0,stored:false},draft:pricingDraft(legacyHallPricing(DEFAULTS),19),preview:false};
 const html=pricingEditorHtml(e,{h,button});
 assert.match(text(html),/聲瑪還沒有廳級價目/);
 assert.match(text(html),/一般 2 首 2 首 歌手 5,555＋雙費 990/);
 assert.match(text(html),/至尊卡 永久 辦卡 歌手 925,000＋雙費 18,188｜冠後每首 55,599/);
 assert.equal((html.match(/<details class="pp-item"[^>]*open/g)||[]).length,0,'folded by default');
 const blank={info:{spaceId:'space-x',name:'新廳',kind:'hall',revision:0,stored:false},draft:pricingDraft(blankHallPricing(),0),preview:true};
 const blankHtml=text(pricingEditorHtml(blank,{h,button}));
 assert.match(blankHtml,/還沒有價目，請從空白開始/);assert.match(blankHtml,/還沒有存歌方案/);assert.match(blankHtml,/這個廳目前沒有開放冠歌卡/);
 assert.doesNotMatch(pricingBasicsHtml({...blank.draft,mode:'none'},{h}),/names\.host/);
 assert.match(pricingBasicsHtml({...blank.draft,mode:'single',singleFee:'hall'},{h}),/name="singleFee" value="hall" checked/);
 const stored={...e,info:{...e.info,stored:true,revision:3}};assert.match(text(pricingEditorHtml(stored,{h,button})),/目前生效的是第 3 版/);
});
