import test from 'node:test';import assert from 'node:assert/strict';import {medalEvidenceHtml} from '../src/medal-evidence.js';
test('detail distinguishes original trigger, uncertain historical candidates, source mismatch and manual certification without leaking HTML',()=>{
 const base={name:'歌單清道夫',emoji:'🧹',streamerName:'怕怕',condition:'第一次點到並完成',sourceRule:'主播代骰不算',currentActive:false,acquiredAt:'2026-10-15T12:00:00Z'};
 const candidate=medalEvidenceHtml([{...base,evidenceType:'candidate',songs:[{title:'<script>private</script>',artist:'歌手',source:'proxy_draw',playerDice:false,recorded:false,earlierTitleRequests:2}]}]);
 assert.match(candidate,/相同完成時間的候選/);assert.match(candidate,/不代表已證實/);assert.match(candidate,/主播代骰/);assert.match(candidate,/此候選來源/);assert.match(candidate,/較早已有 2 筆/);assert.doesNotMatch(candidate,/<script>/);assert.match(candidate,/&lt;script&gt;/);
 assert.match(medalEvidenceHtml([{...base,evidenceType:'recorded',songs:[{title:'玩家骰歌',source:'draw',recorded:true,playerDice:true}]}]),/原始保存的觸發依據/);
 assert.match(medalEvidenceHtml([{...base,evidenceType:'manual',manualReason:'經本人核對',songs:[]}]),/管理者手動認證/);
 assert.match(medalEvidenceHtml([{...base,evidenceType:'unavailable',songs:[]}]),/不推測獲勳原因/);
 assert.match(medalEvidenceHtml([{...base,progressRecalculated:{current:25,target:50,unit:'首'},songs:[]}]),/回算結果，並非當時保存/);
});
