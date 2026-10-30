// Builds medal panel/dialog HTML with the real app.js functions (extracted) and the
// real achievements-view.js, using fixture data. Usage: node medal-fixtures.mjs <repo> <out.json>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [repo, outFile] = process.argv.slice(2);
globalThis.window ??= globalThis; globalThis.matchMedia ??= () => ({ matches: false });
const view = await import(pathToFileURL(path.join(repo, 'src/achievements-view.js')).href);
const app = fs.readFileSync(path.join(repo, 'src/app.js'), 'utf8');
const lines = app.split(/\r?\n/);
const grab = (start, end) => { const i = app.indexOf(start); const j = app.indexOf(end, i); if (i < 0 || j < 0) throw Error('missing ' + start); return app.slice(i, j); };
const src = [
  lines.find(l => l.startsWith('function medalNav(')),
  lines.find(l => l.startsWith('function medalRoomSwitch(')) || '',
  lines.find(l => l.startsWith('function paintMedals(')),
  lines.find(l => l.startsWith('function medalPager(')),
  grab('function paintMedalCollection(', '\nasync function loadMedalCollection('),
  grab('async function showMedalPlayer(', '\nasync function showOwnMedalRoom('),
  grab('async function showOwnMedalRoom(', '\ndocument.addEventListener'),
].join('\n');
const h = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const button = (label, act, id = '', cls = 'tiny', extra = '') => `<button type="button" class="${cls}" data-act="${act}" data-id="${h(id)}" ${extra}>${label}</button>`;
const blank = (text = '還沒有紀錄') => `<div class="empty">${h(text)}</div>`;
const streamers = [['papa', '怕怕'], ['m1', '米雪'], ['m2', '咪醬'], ['m3', '風間駿'], ['m4', '樹兒'], ['m5', '小楓']].map(([id, display_name]) => ({ id, display_name, spaceId: 'space-001' }));
const roomRows = n => Array.from({ length: n }, (_, i) => ({ name: streamers[i % 6].display_name + (i===1?'（長名稱測試主播）':''), total: 30 - i * 3, streamer_id: streamers[i % 6].id }));
const rows = n => Array.from({ length: n }, (_, i) => ({ rank: i + 1, name: ['霖', '小怕粉長長的名字測試', '阿碧', '李小狼', '夜貓子', '星星'][i % 6], total: 30 - i * 3, player_key: 'k' + i, preview: ['🥇 今日第一麥', '🌙 夜貓點唱機', '🔥 嗨歌製造機'], bestrooms: [{ streamerId: 'papa' }, { streamerId: 'm1' }], streamer_id: streamers[i % 6].id }));
const medalRows = Array.from({ length: 6 }, (_, i) => ({ code: 'm' + i, name: ['今日第一麥', '夜貓點唱機', '嗨歌製造機', '失戀專業戶', '甜歌供應商', '這首是真愛'][i], icon: ['🥇', '🌙', '🔥', '💔', '🍬', '🔁'][i], category: 'request', visibility: 'public', lifetime: 'permanent', qualified: i < 4, recorded: i < 4, earned: i < 4, description: '說明文字', progress: { current: i, target: 5 } }));
function run(setup) {
  let out = '';
  const ctx = {
    h, button, blank, $: sel => sel === '#achievement-panel' ? { set innerHTML(v) { out = v; }, dataset: {} } : sel === '#dialog' ? { open: true, querySelector: () => null, querySelectorAll: () => [] } : null,
    modal: (title, body) => { out = body; }, state: { streamers, currentStreamer: streamers[0] }, session: { playerId: 'p' },
    achievementPanelHtml: view.achievementPanelHtml, achievementDetailsHtml: view.achievementDetailsHtml,
    medalFilters: { category: 'all', status: 'all' }, medalIdentity: () => 'x', api: async () => setup.api,
  };
  const names = Object.keys(ctx);
  const fn = new Function(...names, 'let medalMode,medalCollection,medalRanking,medalRoom="",medalQuery="",medalOther=false,medalOwnRoomId="",medalCollectionGeneration=0,medalPublicSelection=null,medalDisplay=null;' + src + '; return {set:(k,v)=>{eval(k+"=v")},paintMedalCollection,showMedalPlayer,showOwnMedalRoom,paintMedals};');
  const api = fn(...names.map(n => ctx[n]));
  return { api, get: () => out };
}
const result = {};
for (const [key, mode, ranking, n] of [['room', 'room', 'global_single', 6], ['global_streamers', 'global', 'global_streamers', 6], ['global_total', 'global', 'global_total', 6]]) {
  const r = run({}); r.api.set('medalMode', mode); r.api.set('medalRanking', ranking); r.api.set('medalCollection', { rows: rows(n), page: 0, total: 43 });
  r.api.paintMedalCollection(); result[key] = r.get();
}
{ // 我的勳章 → 其他主播 list (the “目前主播／其他主播” switch)
  const r = run({}); r.api.set('medalMode', 'mine'); r.api.set('medalCollection', { rows: roomRows(6), page: 0, total: 6 });
  r.api.paintMedalCollection(); result.mine = r.get();
}
{ const r = run({ api: { version: 1, rows: roomRows(6), total: 6 } }); await r.api.showMedalPlayer('k0', null, 0); result.dialog_rooms = r.get(); }
{ const r = run({ api: { version: 1, rows: medalRows, totalDefinitions: 6 } }); await r.api.showMedalPlayer('k0', 'papa', 0); result.dialog_gallery = r.get(); }
fs.writeFileSync(outFile, JSON.stringify(result));
console.log(Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.length])));
