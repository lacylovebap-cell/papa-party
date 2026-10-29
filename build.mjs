import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/,'$1'));
const out=path.join(root,'dist');fs.mkdirSync(out,{recursive:true});
execFileSync(process.execPath,['--check',path.join(root,'src/site-footer.js')]);
for(const name of ['src/overlay-feedback.js','src/management-entry.js','src/platform-management.js','src/hall-navigation.js','src/compact-menu.js','src/application-menu.js','src/application-menu-bootstrap.js','src/lobby-menu.js','src/management-permissions.js','src/pwa-start.js','src/pwa-start-ui.js','src/pwa-install-source.js','src/pwa-launcher.js','src/public-route-location.js','src/public-route-bootstrap.js','src/public-links.js','src/public-link-settings.js','src/branded-qr.js','src/share-dialog.js','src/lobby-public-share.js','src/vendor/qrcodegen.js','src/lobby-room-rotation.js','src/portal-entry-picker.js','src/public-lobby.js','src/lobby-entry.js','src/view-refresh.js','src/accounting.js','src/ui-page-jumps.js','src/player-bulk-tools.js','src/player-own-queue.js','src/message-center.js','src/message-center-view.js','src/catalog-tools.js','src/fate.js','src/board-feed.js','src/board.js','src/board-policy.js','src/chat.js','src/communication-target.js','src/chat-policy.js','src/app.js','src/device-session.js','src/web-credential-store.js','src/web-device-login.js','src/web-app-install.js','src/space-entry.js','src/web-space-entry.js','src/space-path-fallback.js','src/room-import.js','src/room-draft.js','src/state-patch.js','src/venue-policy.js','src/player-manager.js','src/native-player-bindings.js','src/native-player-provisioning.js','src/song-favorites.js','src/listening-history.js','src/new-practice.js','src/core.js','src/request-source.js','src/config.js','src/access-policy.js','src/streamer-navigation.js','src/home-settings.js','src/home-editor.js','src/theme-engine.js','src/theme-access.js','src/theme-render.js','src/theme-image.js','src/theme-studio.js','src/lobby-theme.js','src/notifications.js','src/notification-target.js','src/notification-landing.js','src/web-notification-health.js','src/web-sync-recovery.js','src/web-api-errors.js','src/operation-recovery.js','src/achievements-view.js','src/medal-management.js','src/medal-evidence.js','src/card-media.js','src/activity-view.js','src/notification-rules.js','sw.js'])execFileSync(process.execPath,['--check',path.join(root,name)]);
for(const folder of ['src','assets'])fs.cpSync(path.join(root,folder),path.join(out,folder),{recursive:true});
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
fs.writeFileSync(path.join(out,'index.html'),html);
const appHtml=fs.readFileSync(path.join(root,'v2.html'),'utf8');
for(const file of ['preview.html','v2.html'])fs.writeFileSync(path.join(out,file),appHtml);
fs.writeFileSync(path.join(out,'release.json'),JSON.stringify({version:'10.29-SPACE.2',backendVersion:'10.29-SPACE.2',builtAt:new Date().toISOString()}));
console.log('Build 10.29-SPACE.2 complete: static site in dist');

fs.copyFileSync(path.join(root,'lobby.html'),path.join(out,'lobby.html'));
for(const file of ['app.html','404.html','sw.js','manifest.webmanifest','CNAME'])fs.copyFileSync(path.join(root,file),path.join(out,file));

