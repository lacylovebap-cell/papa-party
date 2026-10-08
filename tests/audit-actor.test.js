import test from 'node:test';
import assert from 'node:assert/strict';
import {eventDescription} from '../src/catalog-tools.js';

const names={playerName:id=>({target:'霖',intruder:'一般玩家'}[id]||''),roomName:id=>({papa:'怕怕',michelle:'米雪'}[id]||'')};

test('audit descriptions never mistake the target player for a manager actor',()=>{
 const event={entity_kind:'queue',streamer_id:'papa',actor_role:'streamer_admin',
  actor_player_id:'intruder',action:'queue:complete',after_data:{playerId:'target',title:'All For You',status:'completed'}};
 const label=eventDescription(event,names);
 assert.match(label,/怕怕為霖的《All For You》完成演唱/);
 assert.doesNotMatch(label,/一般玩家/);
 assert.match(eventDescription({...event,actor_role:'legacy-server'},names),/^舊紀錄／操作者未知為霖/);
 assert.match(eventDescription({...event,actor_role:'system'},names),/^系統為霖/);
});

test('player actions and saved-song targets use their own identity fields',()=>{
 assert.match(eventDescription({entity_kind:'queue',streamer_id:'michelle',actor_role:'player',
  actor_player_id:'intruder',after_data:{playerId:'target',title:'歌',status:'pending'}},names),/^一般玩家為霖/);
 assert.match(eventDescription({entity_kind:'ledger',streamer_id:'michelle',actor_role:'super_admin',
  actor_player_id:'intruder',after_data:{playerId:'target',amount:2}},names),/^PA Party總裁調整霖的存歌紀錄/);
});
