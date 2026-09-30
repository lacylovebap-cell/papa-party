// Pure candidate preparation. Never creates a family, variant, or song link.
// A server integration must authorize the president and persist audit/review
// decisions separately. This module is not connected to production yet.
export const CANDIDATE_ALGORITHM = 'catalog-candidates-v1';

// Conservative orthographic variants only. Comprehensive Simplified/Traditional
// conversion must be supplied via a reviewed dictionary in the server caller.
const ORTHOGRAPHY = new Map([['臺','台'],['裡','裡'],['裏','裡']]);
export function catalogNormalize(value, folds = {}) {
  const text = String(value ?? '').normalize('NFKC').toLowerCase();
  return [...text].map(c => Object.hasOwn(folds,c) ? String(folds[c]) : (ORTHOGRAPHY.get(c) ?? c))
    .join('').replace(/[\p{P}\p{Z}\p{S}\s]/gu, '');
}

function canonical(value, aliases, folds) {
  const normalized = catalogNormalize(value, folds);
  // One-step aliases avoid cycles and never alter the source spelling.
  return Object.hasOwn(aliases, normalized) ? catalogNormalize(aliases[normalized], folds) : normalized;
}

export function catalogSongIndex(songs, {folds = {}, titleAliases = {}, artistAliases = {}, languageAliases = {華語:'國語',中文:'國語'}} = {}) {
  if (!Array.isArray(songs)) throw Error('歌曲清單格式錯誤');
  const seen = new Set();
  return songs.map(song => {
    if (typeof song.songId !== 'string' || !song.songId || typeof song.streamer_id !== 'string' || !song.streamer_id) throw Error('缺少歌曲或主播識別碼');
    const key = JSON.stringify([song.streamer_id, song.songId]);
    if (seen.has(key)) throw Error('重複歌曲識別碼');
    seen.add(key);
    // Explicit whitelist: no lyrics, notes, tags, balances or other private data.
    const title = String(song.title ?? ''), artist = String(song.artist ?? '');
    const language = String(song.cat ?? ''), version = String(song.version ?? '');
    return {sourceKey:key, songId:song.songId, streamerId:song.streamer_id, title, artist, language,
      performerType:String(song.artistType ?? ''), version,
      titleKey:canonical(title,titleAliases,folds), artistKey:canonical(artist,artistAliases,folds),
      languageKey:canonical(language,languageAliases,folds), versionKey:catalogNormalize(version,folds)};
  }).sort((a,b) => a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0);
}

function bigrams(text) {
  const chars = [...text], result = new Set();
  for (let i=1; i<chars.length; i++) result.add(chars[i-1]+chars[i]);
  return result;
}
function titleSimilarity(a,b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const left=bigrams(a), right=bigrams(b);
  if (!left.size || !right.size) return 0;
  let shared=0; for (const part of left) if (right.has(part)) shared++;
  return 2*shared/(left.size+right.size);
}

export function compareCatalogCandidates(a,b) {
  if (a.sourceKey === b.sourceKey || !a.titleKey || !b.titleKey) return null;
  const sameTitle=a.titleKey===b.titleKey;
  const sameArtist=!!a.artistKey && a.artistKey===b.artistKey;
  const similarity=titleSimilarity(a.titleKey,b.titleKey);
  // Fuzzy titles require the same nonempty artist; short unrelated titles are
  // not grouped just because they share a single character.
  if (!sameTitle && (!sameArtist || similarity<0.6)) return null;
  const languageDiff=!!a.languageKey && !!b.languageKey && a.languageKey!==b.languageKey;
  const versionDiff=a.versionKey!==b.versionKey;
  const kind=!sameArtist?'same_title':languageDiff||versionDiff||!sameTitle?'possible_version':'possible_same';
  const reasons=[sameTitle?'normalized_title':'similar_title',sameArtist?'normalized_artist':'different_or_missing_artist'];
  if(languageDiff) reasons.push('different_language');
  if(versionDiff) reasons.push('different_version');
  return {id:JSON.stringify([a.sourceKey,b.sourceKey].sort()),sourceKeys:[a.sourceKey,b.sourceKey].sort(),
    kind,reasons,similarity,status:'pending',algorithm:CANDIDATE_ALGORITHM};
}

// This intentionally bounds comparison work, not only returned matches.
// Bind the cursor to an immutable scan snapshot ID (including dictionary
// configuration) when integrating with the database. Do not use live rows.
export function scanCatalogCandidatePage(index, {snapshotId,cursor=null,maxComparisons=500} = {}) {
  if (typeof snapshotId!=='string' || !snapshotId) throw Error('需要固定掃描快照');
  if (!Number.isInteger(maxComparisons) || maxComparisons<1 || maxComparisons>5000) throw Error('掃描批次超出限制');
  if (cursor && (cursor.snapshotId!==snapshotId || cursor.algorithm!==CANDIDATE_ALGORITHM)) throw Error('掃描快照已改變，請重新開始');
  let left=cursor?.left??0, right=cursor?.right??1;
  if (!Number.isInteger(left)||!Number.isInteger(right)||left<0||right<=left || (index.length>1 && (left>=index.length-1||right>=index.length))) throw Error('掃描游標錯誤');
  const candidates=[]; let comparisons=0;
  while(left<index.length-1 && comparisons<maxComparisons) {
    const candidate=compareCatalogCandidates(index[left],index[right]);
    if(candidate)candidates.push(candidate);
    comparisons++; right++;
    if(right>=index.length){left++;right=left+1;}
  }
  return {candidates,comparisons,nextCursor:left<index.length-1?{snapshotId,algorithm:CANDIDATE_ALGORITHM,left,right}:null};
}
