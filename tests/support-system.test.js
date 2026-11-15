import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {supportSummary,orderDraft,validAmount,supportNickname,supportLimits,formatNT,SUPPORT_COUNTED,SUPPORT_STATUSES} from '../src/support-rules.js';
import {dockAllowed,supportPageUrl,supportDockElement} from '../src/support-widget.js';

const SHELLS=['index.html','app.html','lobby.html','v2.html','preview.html'];

test('沒有資料時每個數字都是 0，不產生假資料',()=>{
 const s=supportSummary(null);
 for(const key of ['goal','received','fees','refunded','expenses','usable','remaining','percent','count'])assert.equal(s[key],0,key);
 assert.equal(s.gatewayLive,false,'金流預設未啟用');
 assert.equal(s.month,'');
});

test('摘要照規格算：收到 2500、手續費 75、支出 2000 → 可用 2425、結餘 425',()=>{
 const s=supportSummary({month:'2026-11',goal:2500,received:2500,fees:75,expenses:2000,count:7});
 assert.equal(s.usable,2425);assert.equal(s.remaining,425);assert.equal(s.percent,100);
 assert.equal(formatNT(s.usable),'NT$2,425');
});

test('退款從可用金額扣除，且不會讓可用金額變負數',()=>{
 assert.equal(supportSummary({received:500,fees:15,refunded:500}).usable,0);
 assert.equal(supportSummary({received:1000,fees:30,refunded:200}).usable,770);
});

test('支出大於可用金額時結餘為負，照實顯示',()=>{
 assert.equal(supportSummary({received:1000,fees:30,expenses:1500}).remaining,-530);
});

test('只有 paid 計入贊助總額；待付款、失敗、取消、逾時、退款都不算',()=>{
 assert.deepEqual([...SUPPORT_COUNTED],['paid']);
 for(const status of ['pending','failed','cancelled','expired','refunded'])
  assert.ok(!SUPPORT_COUNTED.includes(status),status+' 不可計入');
 assert.ok(SUPPORT_STATUSES.includes('refunded'));
});

test('自訂金額必須是正整數且落在金流商限制內',()=>{
 assert.equal(validAmount('300'),300);
 assert.equal(validAmount(30),30);
 assert.equal(validAmount(20000),20000);
 for(const bad of ['29',29,0,-100,'1e3','3.5',3.5,'abc','','  ',20001,null,undefined,NaN,Infinity])
  assert.equal(validAmount(bad),null,String(bad)+' 應被拒絕');
});

test('後端可以覆寫金額上下限，壞值則退回預設',()=>{
 assert.deepEqual({...supportLimits({min:5,max:50000})},{min:5,max:50000});
 assert.equal(validAmount(5,{min:5,max:50000}),5);
 assert.deepEqual({...supportLimits({min:0,max:10})},{min:30,max:20000});
 assert.deepEqual({...supportLimits({min:900,max:100})},{min:30,max:20000});
});

test('匿名贊助不帶出任何暱稱',()=>{
 assert.equal(supportNickname('怕怕',true),'');
 assert.equal(supportNickname('  怕怕  ',false),'怕怕');
 assert.equal(supportNickname('a'.repeat(50),false).length,24);
 const draft=orderDraft({amount:500,anonymous:true,nickname:'怕怕'});
 assert.deepEqual(draft,{ok:true,amount:500,anonymous:true,nickname:''});
});

test('訂單草稿會擋下不合法金額並說明原因',()=>{
 const bad=orderDraft({amount:'0'});
 assert.equal(bad.ok,false);
 assert.match(bad.reason,/NT\$30.*NT\$20000/);
});

test('浮動入口出現在一般頁面，不出現在支持頁、404 與金流回傳頁',()=>{
 for(const href of ['https://paparty.app/','https://paparty.app/v2.html','https://paparty.app/lobby.html','https://paparty.app/app.html','https://paparty.app/shuer'])
  assert.equal(dockAllowed(new URL(href)),true,href);
 for(const href of ['https://paparty.app/support.html','https://paparty.app/support','https://paparty.app/404.html','https://paparty.app/payment','https://paparty.app/v2.html?MerchantTradeNo=PA1','https://paparty.app/v2.html?CheckMacValue=x','https://paparty.app/v2.html?RtnCode=1'])
  assert.equal(dockAllowed(new URL(href)),false,href);
});

test('被嵌在 iframe 時不掛載，避免干擾外部付款頁',()=>{
 assert.equal(dockAllowed(new URL('https://paparty.app/v2.html'),{inFrame:true}),false);
});

test('入口連到站內 support.html，不是外部網址',()=>{
 const href=supportPageUrl('https://paparty.app/src/support-widget.js');
 assert.equal(href,'https://paparty.app/support.html');
 assert.equal(new URL(href).origin,'https://paparty.app');
});

test('收合後只留愛心，展開狀態帶完整標籤',()=>{
 const make=html=>{const el={children:[],attrs:{},dataset:{},classList:{},append(...n){this.children.push(...n)},setAttribute(k,v){this.attrs[k]=v},get textContent(){return this.children.map(c=>c.textContent||'').join('')},set textContent(v){this._t=v}};return el;};
 const doc={createElement:()=>{const node={children:[],dataset:{},attrs:{},_text:'',
  append(...n){this.children.push(...n)},setAttribute(k,v){this.attrs[k]=v},
  set textContent(v){this._text=v},get textContent(){return this._text+this.children.map(c=>c.textContent).join('')}};return node;}};
 const open=supportDockElement(doc,{href:'https://paparty.app/support.html',collapsed:false});
 assert.equal(open.dataset.collapsed,'false');
 assert.match(open.textContent,/支持 PA Party/);
 const shut=supportDockElement(doc,{href:'https://paparty.app/support.html',collapsed:true});
 assert.equal(shut.dataset.collapsed,'true');
});

test('每個站台殼層都載入同一份共用元件，沒有人自己複製一份',()=>{
 for(const shell of SHELLS){
  const html=fs.readFileSync(new URL('../'+shell,import.meta.url),'utf8');
  const hits=html.match(/src\/support-widget\.js\?v=[^"]+/g)||[];
  assert.equal(hits.length,1,shell+' 應剛好載入一次浮動入口');
 }
 assert.ok(!fs.readFileSync(new URL('../404.html',import.meta.url),'utf8').includes('support-widget'),'404 轉址頁不掛入口');
});

test('support.html 不顯示任何預設金額數字，所有數字由後端填入',()=>{
 const html=fs.readFileSync(new URL('../support.html',import.meta.url),'utf8');
 for(const field of ['goal','received','percent','expenses','remaining','lreceived','lfees','lusable','lexpenses','lremaining'])
  assert.ok(html.includes('data-figure="'+field+'"'),'缺少 '+field);
 for(const [,value] of html.matchAll(/data-figure="[a-z]+">([^<]*)</g))
  assert.ok(['NT$0','0%'].includes(value),'預設顯示值必須是 0，實際為 '+value);
 const presets=[...html.matchAll(/data-preset="(\d+)"/g)].map(m=>Number(m[1]));
 assert.deepEqual(presets,[100,300,500],'建議金額為 100／300／500');
 assert.match(html,/disabled/,'付款鈕預設為停用');
 assert.match(html,/金流審核中，尚未開放付款/);
});

test('support 已列為系統保留路徑，不會被當成主播專屬網址',()=>{
 const src=fs.readFileSync(new URL('../src/public-route-location.js',import.meta.url),'utf8');
 assert.match(src,/'support','support\.html'/);
});
