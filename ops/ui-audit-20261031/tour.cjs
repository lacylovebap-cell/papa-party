// Usage: node tour.cjs <outDir> [label]
// Visits PA Party pages in preview mode at 320/390/768/1280, runs the layout scan,
// saves screenshots and a JSON report.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const out = process.argv[2], tag = process.argv[3] || 'run';
const scanSrc = fs.readFileSync(path.join(__dirname, 'scan.js'), 'utf8');
const medalFx = JSON.parse(fs.readFileSync(process.env.FX || path.join(__dirname, 'medal-fixtures.json'), 'utf8'));
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const WIDTHS = [320, 390, 768, 1280];
const shotWidths = new Set((process.env.SHOTS || '390,1280').split(',').map(Number));
fs.mkdirSync(out, { recursive: true });

async function seed(p) {
  await p.goto(BASE + 'preview.html'); await p.waitForTimeout(1200);
  await p.evaluate(async () => {
    const v = [...document.querySelectorAll('script[type=module]')].map(s => s.src).find(s => s.includes('app.js')).split('?v=')[1].split('&')[0];
    const core = await import('/src/core.js?v=' + (window.__coreV || '10.29-BANNER.1'));
    let s = JSON.parse(localStorage.getItem('papa-v2-preview-demo'));
    if (s.__seeded) return;
    const T = core.stamp(Date.now() - 120000), A = { role: 'admin' };
    const run = (type, data, who = A) => { s = core.mutate(s, { type, data, streamer: 'papa' }, who, T); };
    run('player', { name: '霖', ids: ['lin'], balance: 8 }); const pid = s.players.at(-1).playerId;
    run('player', { name: '小怕粉長長的名字測試', ids: ['fan'], balance: 3 }); const pid2 = s.players.at(-1).playerId;
    const songs = s.songs.filter(x => !x.hidden && !x.deleted).slice(0, 6); for (const x of songs) x.lyrics = '第一行歌詞\n第二行歌詞';
    const ids = songs.map(x => x.songId), W = { role: 'admin', playerId: pid }, W2 = { role: 'admin', playerId: pid2 };
    run('request', { songId: ids[0], kind: 'saved', requestNote: '生日快樂想聽這首～' }, W); run('queue', { id: s.queue.at(-1).id, operation: 'acknowledge', preparationMinutes: 0 });
    run('request', { songId: ids[1], kind: 'saved', requestNote: '今天加班好累，想聽妳唱這首給我打氣一下謝謝' }, W2);
    run('request', { songId: ids[2], kind: 'live', giftConfirmed: true, source: 'draw', selfProvided: true }, W2);
    run('request', { songId: ids[3], kind: 'saved' }, W); const c = s.queue.at(-1).id; run('queue', { id: c, operation: 'acknowledge', preparationMinutes: 0 }); run('queue', { id: c, operation: 'complete' });
    run('request', { songId: ids[4], kind: 'saved' }, W); run('queue', { id: s.queue.at(-1).id, operation: 'cancel' });
    run('wish', { title: '想聽的新歌', artist: '某歌手', note: '拜託' }, { role: 'player', playerId: pid });
    s.__seeded = true;
    localStorage.setItem('papa-v2-preview-demo', JSON.stringify(s)); localStorage.setItem('__pid', pid);
  });
}
const settle = p => p.waitForTimeout(700);
async function dismiss(p) { await p.evaluate(() => { document.querySelector('#toast')?.remove(); const d = document.querySelector('#dialog'); if (d?.open) d.close(); }); }
async function adminOn(p, on) { await p.evaluate(on => { if (on) localStorage.setItem('papa-v2-preview-admin', JSON.stringify({ role: 'admin' })); else localStorage.removeItem('papa-v2-preview-admin'); }, on); }
async function go(p, hash) { await p.goto(BASE + 'preview.html' + hash); await p.waitForTimeout(1500); if (await p.$('#modal-form [type=submit]') && hash.startsWith('#admin')) { await p.click('#modal-form [type=submit]'); await p.waitForTimeout(1200); } await p.evaluate(() => document.querySelector('#toast')?.remove()); }
async function click(p, selector, filter) {
  return p.evaluate(([selector, filter]) => { const el = [...document.querySelectorAll(selector)].find(e => !filter || e.textContent.includes(filter)); if (!el) return false; el.click(); return true; }, [selector, filter]);
}
async function scan(p, root) { await p.addScriptTag({ content: scanSrc }); return p.evaluate(r => window.__papaScan(r), root || null); }

const steps = [
  ['官網入口（index）', async p => { await p.goto(BASE + 'index.html'); await p.waitForTimeout(1500); }],
  ['聲瑪大廳（lobby）', async p => { await p.goto(BASE + 'lobby.html'); await p.waitForTimeout(1800); }],
  ['首頁（玩家）', async p => { await adminOn(p, false); await go(p, ''); }],
  ['歌本', async p => { await go(p, '#book'); }],
  ['☰ 選單', async p => { await go(p, ''); await click(p, '.header-menu>summary,[data-act=menu],.compact-menu summary,.application-menu summary,button[aria-label*="選單"]'); await settle(p); }, 'menu'],
  ['玩家登入彈窗', async p => { await go(p, ''); await click(p, 'button', '玩家登入'); await settle(p); }, '#dialog'],
  ['主播登入彈窗', async p => { await adminOn(p, false); await p.goto(BASE + 'preview.html#admin'); await p.waitForTimeout(1800); }, '#dialog'],
  ['後台・待播', async p => { await adminOn(p, true); await go(p, '#admin'); await click(p, '[data-act=adminTab][data-id=queue]'); await settle(p); }],
  ['後台・待播「更多」', async p => { await p.evaluate(() => { const d = document.querySelector('.queue-more'); if (d) d.open = true; }); await settle(p); }],
  ['後台・待播批次操作', async p => { await p.evaluate(() => { document.querySelectorAll('.queue-more').forEach(d => d.open = false); const d = [...document.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent.includes('批次')); if (d) d.open = true; }); await settle(p); }],
  ['後台・待播歷史', async p => { await click(p, '[data-act=queueMode]', '歷史'); await settle(p); }],
  ['加入待播歌曲彈窗', async p => { await click(p, '[data-act=onBehalf]'); await settle(p); }, '#dialog'],
  ['編輯換歌彈窗', async p => { await dismiss(p); await click(p, '[data-act=queueMode]', '待播'); await settle(p); await click(p, '[data-act=editQueue]'); await settle(p); }, '#dialog'],
  ['後台・歌本', async p => { await dismiss(p); await click(p, '[data-act=adminTab][data-id=songs]'); await settle(p); }],
  ['後台・玩家', async p => { await click(p, '[data-act=adminTab][data-id=players]'); await settle(p); }],
  ['後台・玩家詳情', async p => { await p.evaluate(() => [...document.querySelectorAll('[data-act=playerDetail]')].find(b => /霖/.test(b.closest('article,.song,tr,div')?.innerText || ''))?.click()); await settle(p); }],
  ['後台・玩家點歌歷史', async p => { await click(p, '[data-act=subtab][data-id=queue]'); await settle(p); }],
  ['後台・存歌', async p => { await click(p, '[data-act=adminTab][data-id=ledger]'); await settle(p); }],
  ['後台・共同曲庫', async p => { await click(p, '[data-act=adminTab][data-id=catalog]'); await settle(p); }],
  ['後台・冠歌', async p => { await click(p, '[data-act=adminTab][data-id=crowns]'); await settle(p); }],
  ['後台・卡片', async p => { await click(p, '[data-act=adminTab][data-id=cards]'); await settle(p); }],
  ['後台・許願池', async p => { await click(p, '[data-act=adminTab][data-id=wishes]'); await settle(p); }],
  ['後台・統計', async p => { await click(p, '[data-act=adminTab][data-id=stats]'); await settle(p); }],
  ['後台・勳章管理', async p => { await click(p, '[data-act=adminTab][data-id=medals]'); await settle(p); }],
  ['後台・設定', async p => { await click(p, '[data-act=adminTab][data-id=settings]'); await settle(p); }],
  ['設定・首頁主題設計', async p => { await click(p, '[data-act=themeStudio]'); await p.waitForTimeout(2500); }, null],
  ['勳章・我的勳章（目前／其他主播）', async p => { await injectMedal(p, 'mine'); }, '#achievement-panel'],
  ['勳章・主播勳章榜', async p => { await injectMedal(p, 'room'); }, '#achievement-panel'],
  ['勳章・全站：擁有最多位主播', async p => { await injectMedal(p, 'global_streamers'); }, '#achievement-panel'],
  ['勳章・全站：跨主播累積勳章', async p => { await injectMedal(p, 'global_total'); }, '#achievement-panel'],
  ['勳章彈窗・各主播勳章', async p => { await injectDialog(p, 'rooms'); }, '#dialog'],
  ['勳章彈窗・公開勳章', async p => { await injectDialog(p, 'gallery'); }, '#dialog'],
];
async function injectMedal(p, key) {
  await dismiss(p);
  await p.evaluate(html => { let host = document.querySelector('#achievement-panel'); if (!host) { host = document.createElement('div'); host.id = 'achievement-panel'; host.className = 'achievement-panel'; const app = document.querySelector('#app .card') || document.querySelector('#app'); app.innerHTML = '<h2>🏅 勳章</h2>'; app.append(host); } host.innerHTML = html; window.scrollTo(0, 0); }, medalFx[key]);
  await settle(p);
}
async function injectDialog(p, key) {
  await p.evaluate(([title, html]) => { const d = document.querySelector('#dialog'); d.innerHTML = '<div class="dialog-head"><h2>' + title + '</h2><button data-act="close" aria-label="關閉">✕</button></div><div class="dialog-body">' + html + '<p class="error" id="dialog-error"></p></div>'; if (!d.open) d.showModal(); }, [key === 'rooms' ? '各主播勳章' : '公開勳章', medalFx['dialog_' + key]]);
  await settle(p);
}
(async () => {
  const b = await chromium.launch();
  const report = [];
  for (const w of WIDTHS) {
    const ctx = await b.newContext({ viewport: { width: w, height: w < 700 ? 860 : 900 } });
    const p = await ctx.newPage(); const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await seed(p);
    let i = 0;
    for (const [name, run, root] of steps) {
      i++;
      try { await run(p); } catch (e) { report.push({ w, name, error: e.message }); continue; }
      const res = await scan(p, root === 'menu' ? null : root);
      report.push({ w, name, ...res });
      if (shotWidths.has(w)) {
        const file = `${String(i).padStart(2, '0')}-${w}-${name.replace(/[\/\s「」（）・：]/g, '_')}.png`;
        await p.screenshot({ path: path.join(out, file), fullPage: !root || root === 'menu' ? true : false });
      }
    }
    if (errors.length) report.push({ w, name: 'pageerror', errors: [...new Set(errors)] });
    await ctx.close();
  }
  fs.writeFileSync(path.join(out, `report-${tag}.json`), JSON.stringify(report, null, 1));
  await b.close();
})();
