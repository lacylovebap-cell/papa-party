// Granular permissions are checked in addition to the established actor/room ACL.
// Unknown manager operations require the full permission set, so a new endpoint
// cannot accidentally become available to a narrowly delegated account.
const songs=new Set(['songSearch','catalogTemplates','catalogConfirmed','catalogCandidates','catalogCandidate','catalogReview','catalogAction','catalogLink','catalogUnlink','catalogReport','catalogLyrics','lyrics','songLyrics','newPracticePage','favoriteAudience']);
const reports=new Set(['events','activityPage','listeningHistoryPage']);
const accountOnly=new Set(['deviceRegister','deviceRefresh','deviceLogout','deviceSwitchSpace','deviceSpacePreferences','nativePushRegister','nativePushDisable','changeManagerPassword','platformManagementSession','platformManagementDetail','platformManageSpace','platformManagementDirectory','platformManagementDependencies','platformStreamerSave','platformDirectory','spaces','spaceResolve','spaceEntry','publicHallTheme','hallThemeEdit','hallThemeSave']);
const songActions=new Set(['song','songsBulk','restoreSongEdits','lyrics','newPracticeSet','newPracticeOrder','songOrder','wishAdmin']);
const queueActions=new Set(['queue','onBehalf','streamerDraw','queueOrder']);
const playerActions=new Set(['player','ledger','allocate','extraQuota','crown','card']);
export function managerPermissionRequirement(body){
 const op=body?.op;
 if(accountOnly.has(op)||typeof op==='string'&&/^(chat|board|notice|notification)/i.test(op))return null;
 if(op==='publicRouteSettings'||op==='publicRouteCheck'||op==='publicRouteSave')return 'all';
 if(songs.has(op)||typeof op==='string'&&op.startsWith('catalog'))return 'songs';
 if(reports.has(op))return 'reports';
 if(op==='achievementCollection')return null;
 if(typeof op==='string'&&/^(achievement|medal)/.test(op))return 'players';
 if(op==='playerManagementPage'||op==='playerProvision'||op==='playersArchive'||op==='playerArchive')return 'players';
 if(op==='mutate'){
  const type=body.action?.type;
  if(songActions.has(type))return 'songs';
  if(queueActions.has(type))return 'queue';
  if(playerActions.has(type))return 'players';
  if(type==='settings')return 'all';
  if(type==='streamer')return 'streamers';
 }
 return 'all';
}
