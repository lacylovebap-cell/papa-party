import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DEFAULTS} from '../src/core.js';
import {pricingFromSettings,normalizePricing,quoteLive} from '../src/pricing-engine.js';
import {feeColumns,giftReveal,priceGuide,crownGuide} from '../src/pricing-ui.js';

const shengma=pricingFromSettings(DEFAULTS);
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();

test('聲瑪 shows one 雙費 figure explained once; single-fee and singer-only halls show only what they collect',()=>{
 assert.deepEqual(feeColumns(shengma).columns.map(c=>c.label),['歌手','雙費']);
 assert.equal(feeColumns(shengma).explain,'雙費：2號位主持、聲瑪樂團各一份');
 const single=normalizePricing({mode:'single',singleFee:'host',names:{singer:'主播',host:'主持'},perUnit:{singer:800,host:100}});
 assert.deepEqual(feeColumns(single).columns.map(c=>c.label),['主播','單費']);assert.equal(feeColumns(single).explain,'單費：給主持');
 assert.deepEqual(feeColumns(normalizePricing({mode:'none',perUnit:{singer:800}})).columns.map(c=>c.label),['主播']);
 const uneven=normalizePricing({mode:'double',names:{host:'主持人',hall:'廳主'},perUnit:{singer:800,host:100,hall:50}});
 assert.deepEqual(feeColumns(uneven).columns.map(c=>c.label),['主播','主持人','廳主']);
});

test('gift values stay folded until the player opens 查看禮物值, and carry the reference note',()=>{
 const html=giftReveal(shengma,quoteLive(shengma,{units:2}));
 assert.match(html,/^<details class="pf-reveal">/);assert.doesNotMatch(html,/<details[^>]* open/);
 assert.match(text(html),/查看禮物值 已套用優惠 自動套用最優惠方案：一般 2 首 歌手 5,555 雙費 990 雙費：2號位主持、聲瑪樂團各 990/);
 assert.match(text(html),/單位：探鑽。以上數值僅供參考，最終以實際狀況為主。/);
 assert.match(giftReveal(shengma,quoteLive(shengma,{units:1}),{open:true}),/<details class="pf-reveal" open>/);
 assert.match(text(giftReveal(shengma,quoteLive(shengma,{units:1,crown:{playerId:'x',price:4200}}))),/冠歌價格 冠歌價格 歌手 4,200 雙費 500/);
});

test('price guide and crown guide are short: per-slot slip, plan list, and plain rules',()=>{
 const guide=text(priceGuide(shengma));
 assert.match(guide,/一般現點，每 1 首 歌手 2,990 雙費 500/);
 assert.match(guide,/2 首 一般 2 首 歌手 5,555 雙費 990/);assert.match(guide,/半首歌要「唱兩次」或「搭配另一首半首歌」/);
 const crown=text(crownGuide(shengma,DEFAULTS.tiers,{openingExtra:18188}));
 assert.match(crown,/👑 金卡 1 個月 辦卡 歌手 55,599 雙費 18,188 冠後每首 歌手 4,200 雙費 500/);
 assert.match(crown,/👑 至尊卡 永久/);
 assert.match(crown,/只能現點：不能提歌、不能用存歌，現場點、現場唱/);
 assert.doesNotMatch(crown,/給2號位主持 18,188/,'no per-party wording in every row');
});

test('no gift-price checkbox remains anywhere players request songs; requests still carry giftConfirmed',()=>{
 const app=fs.readFileSync('src/app.js','utf8');
 assert.doesNotMatch(app,/我已確認禮物價格|我已確認換歌後的現點禮物價格|已了解每首現點需等待主播確認禮物|已了解每位主播的現點需等待確認禮物/);
 assert.doesNotMatch(app,/f\.has\('gift'\)|data\.has\('gift'\)|f\.has\('giftConfirmed'\)/);
 assert.ok((app.match(/giftConfirmed:true/g)||[]).length>=4);
});
