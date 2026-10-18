import fs from 'node:fs';
const root=new URL('./',import.meta.url),read=f=>fs.readFileSync(new URL(f,root),'utf8');
const accounting=read('src/accounting.js').replace(/^export /gm,'');
const cardMedia=read('src/card-media.js').replace(/^export /gm,'');
const requestSource=read('src/request-source.js').replace(/^export /gm,'');
const playerBulkTools=read('src/player-bulk-tools.js').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const core=read('src/core.js').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),rules=read('src/notification-rules.js').replace(/^export /gm,''),edge=read('supabase/functions/party-api/index.ts').replace(/^import .*from '\.\.\/.*;\r?\n/gm,'');
const nativePlayerBindings=read('src/native-player-bindings.js').replace(/^export /gm,'');const policy=read('src/access-policy.js').replace(/^export /gm,'');const home=read('src/home-settings.js').replace(/^export /gm,'');const newPractice=read('src/new-practice.js').replace(/^export /gm,'');const venuePolicy=read('src/venue-policy.js').replace(/^export /gm,'');const chatPolicy=read('src/chat-policy.js').replace(/^export /gm,'');const chatApi=read('supabase/functions/party-api/chat.ts').replace(/^import .*;\r?\n/gm,'');const boardPolicy=read('src/board-policy.js').replace(/^export /gm,'');const boardApi=read('supabase/functions/party-api/board.ts').replace(/^import .*;\r?\n/gm,'');const catalogApi=read('supabase/functions/party-api/catalog.ts').replace(/^import .*;\r?\n/gm,'');const roomImport=read('src/room-import.js').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');const roomDraft=read('src/room-draft.js').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');const patch=read('src/state-patch.js').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');const code=cardMedia+'\n'+accounting+'\n'+requestSource+'\n'+nativePlayerBindings+'\n'+boardPolicy+'\n'+boardApi+'\n'+chatPolicy+'\n'+chatApi+'\n'+home+'\n'+venuePolicy+'\n'+newPractice+'\n'+core+'\n'+playerBulkTools+'\n'+patch+'\n'+roomImport+'\n'+roomDraft+'\n'+rules+'\n'+policy+'\n'+catalogApi+'\n'+edge;
const badgeRead=f=>read('supabase/functions/party-api/'+f).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const badgeBundle='const badgeCatalogModule=(()=>{'+badgeRead('badge-catalog.js')+';return {BADGE_CATALOG};})();\n'
 +'const badgeRulesModule=(()=>{const {BADGE_CATALOG}=badgeCatalogModule;'+badgeRead('badge-rules.js')+';return {evaluateBadgeRules,badgeDay,badgeShow};})();\n'
 +'const {roomBadgeChanges}=(()=>{const {evaluateBadgeRules,badgeDay,badgeShow}=badgeRulesModule;'+badgeRead('badge-state.js')+';return {roomBadgeChanges};})();\n';
const lobbyImages=read('supabase/functions/party-api/lobby-images.js').replace(/^export /gm,'');
const bundled=badgeBundle+lobbyImages+'\n'+code.replace(/^import .*from '\.\/(?:badge-state|lobby-images).js';\r?\n/gm,'');
fs.writeFileSync(new URL('deploy-function.txt',root),bundled);
fs.writeFileSync(new URL('deploy-function.html',root),'<meta charset="utf-8"><pre>'+bundled.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</pre>');
console.log('Notification edge bundle created');
