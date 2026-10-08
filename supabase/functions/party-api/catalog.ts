// Catalog endpoints use targeted service-role queries. Never call load() or add
// catalog/lyrics rows to the generic platform snapshot or ordinary read view.
const CATALOG_OPS=new Set(['catalogCandidateEdit','catalogLyricSources','catalogLyricAdopt','catalogRooms','catalogSearch','catalogSuggestions','catalogVariantInfo','catalogMergeSame','catalogScan','catalogReviewList','catalogReview','catalogGovernance','catalogLanguageFilter','catalogLanguageFilterSave','catalogTemplates','catalogTemplateChange','catalogLyrics','catalogLyricSave','catalogLyricChoice','catalogBatchAdd','songSearchRoom','catalogLinkSong','catalogLinkInfo','catalogFamilySingers','catalogImportMatches','catalogImportLink','catalogIssueReport','catalogIssues','catalogIssueStatus','catalogSongbook']);
const catalogUuid=(v:any)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const catalogPage=(b:any)=>({limit:Math.max(1,Math.min(50,Math.floor(Number(b.limit)||20))),offset:Math.max(0,Math.min(10000,Math.floor(Number(b.offset)||0)))});
const catalogActor=(who:any)=>isSuper(who)?'president':who?.role==='streamer_admin'?'streamer:'+who.streamer_id:'player:'+String(who?.playerId||'anonymous');
const CATALOG_COMMON_FIELDS=['title','artist','cat','artistType','version','catalogVariantId'];
function catalogMetadataView(view:any,rows:any[],management=false){
 const byId=new Map(rows.map((r:any)=>[r.songId,r]));
 return {...view,songs:view.songs.map((song:any)=>{const common=byId.get(song.songId);return common?{...song,...Object.fromEntries([...CATALOG_COMMON_FIELDS,'hasLyrics','lyricsMode',...(management?['catalogStatus','catalogFamilyId']:[])].filter(k=>common[k]!=null).map(k=>[k,common[k]]))}:song;})};
}
// A local tag/note edit must not persist the displayed shared metadata into the
// original song. Explicitly changed common fields still become new candidates.
function catalogPreserveSource(action:any,state:any,room:string,rows:any[]){
 if(action?.type!=='song'||!action.data?.songId||action.data.remove)return action;
 const source=state.songs.find((s:any)=>s.songId===action.data.songId&&s.streamer_id===room),common=rows.find((s:any)=>s.songId===action.data.songId);
 if(!source||!common)return action;
 const data={...action.data};
 for(const field of CATALOG_COMMON_FIELDS)if(field!=='catalogVariantId'&&data[field]===common[field]){
  if(Object.hasOwn(source,field))data[field]=source[field];else delete data[field];
 }
 return {...action,data};
}

async function catalogRoom(who:any,requested:any,allowInactive=false){
 const rooms=await api('/rest/v1/rpc/papa_streamer_directory',{});
 const room=rooms.find((r:any)=>r.id===requested||r.slug===requested);
 if(!room)throw Error('找不到主播');
 requireRoom(who,room.id);
 if(!room.active&&!allowInactive&&!isManager(who))throw Error('主播頁暫未開放');
 return room;
}

async function catalogOperation(b:any,who:any){
 const page=catalogPage(b),op=b.op;
 if(op==='catalogSongbook'){
  const q=String(b.q||'').trim();
  if(q.length>100)return {rows:[],total:0,hasMore:false};
  return await api('/rest/v1/rpc/papa_catalog_public_page',{query_text:q,page_limit:Math.min(page.limit,20),page_offset:page.offset});
 }
 if(op==='catalogLinkInfo'){
  if(!isManager(who))throw Error('請先登入主播管理');
  const room=await catalogRoom(who,b.streamer||who.streamer_id,true);
  if(typeof b.songId!=='string'||!b.songId||b.songId.length>200)throw Error('請選擇歌曲');
  return await api('/rest/v1/rpc/papa_catalog_link_info',{room_id:room.id,song_id:b.songId});
 }
 if(op==='catalogFamilySingers'){
  if(!isManager(who)||!catalogUuid(b.familyId))throw Error('請先登入主播管理');
  return await api('/rest/v1/rpc/papa_catalog_family_singers',{chosen_family:b.familyId});
 }
 if(op==='catalogImportMatches'){
  if(!isManager(who)||!Array.isArray(b.rows)||b.rows.length>100)throw Error('匯入資料過多');
  const rows=b.rows.map((r:any)=>({line:Number(r.line),title:String(r.title||'').slice(0,300),artist:String(r.artist||'').slice(0,300),cat:String(r.cat||'').slice(0,100)}));
  if(rows.some((r:any)=>!Number.isInteger(r.line)||r.line<1||!r.title||!r.artist))throw Error('匯入歌曲不完整');
  return await api('/rest/v1/rpc/papa_catalog_import_matches',{import_rows:rows});
 }
 if(op==='catalogImportLink'){
  if(!isManager(who)||!Array.isArray(b.selections)||b.selections.length>100)throw Error('匯入關聯過多');
  const room=await catalogRoom(who,b.streamer||who.streamer_id,true);
  const selections=b.selections.map((x:any)=>({songId:x.songId,variantId:x.variantId,title:x.title,artist:x.artist}));
  if(selections.some((x:any)=>!catalogUuid(x.variantId)||typeof x.songId!=='string'||x.songId.length>200||typeof x.title!=='string'||typeof x.artist!=='string'))throw Error('匯入關聯不正確');
  return await api('/rest/v1/rpc/papa_catalog_import_link_batch',{room_id:room.id,selections,actor_id:catalogActor(who)});
 }
 if(op==='catalogLinkSong'){
  if(!isManager(who))throw Error('請先登入主播管理');
  const room=await catalogRoom(who,b.streamer||who.streamer_id,true);
  if(!catalogUuid(b.variantId)||b.expectedVariant!=null&&!catalogUuid(b.expectedVariant)||
   typeof b.songId!=='string'||!b.songId||b.songId.length>200||
   typeof b.expectedSource!=='string'||!/^[a-f0-9]{32}$/.test(b.expectedSource))throw Error('共同歌曲關聯已更新，請重新選擇');
  return await api('/rest/v1/rpc/papa_catalog_link_room_song',{room_id:room.id,song_id:b.songId,
   target_variant:b.variantId,expected_source:b.expectedSource,expected_variant:b.expectedVariant||null,
   actor_id:catalogActor(who),require_same_family:b.sameFamilyOnly===true});
 }
 if(op==='catalogIssueReport'){
  if(!isManager(who))throw Error('請先登入主播管理');
  const room=await catalogRoom(who,b.streamer||who.streamer_id,true);
  if(!catalogUuid(b.familyId)||b.variantId!=null&&!catalogUuid(b.variantId))throw Error('請先選擇共同歌曲');
  return await api('/rest/v1/rpc/papa_catalog_report_issue',{room_id:room.id,family_id:b.familyId,
   variant_id:b.variantId||null,issue_type:b.issueType,description:String(b.description||'').slice(0,3000),
   suggestion:String(b.suggestion||'').slice(0,3000)});
 }
 if(op==='catalogIssues'){
  if(!isManager(who))throw Error('請先登入主播管理');
  const r=await api('/rest/v1/rpc/papa_catalog_issue_page',{room_id:who?.role==='streamer_admin'?who.streamer_id:null,
   report_status:['all','pending','processing','fixed','declined'].includes(b.status)?b.status:'pending',
   page_limit:page.limit,page_offset:page.offset});
  return {items:r.rows||[],total:r.total||0,hasMore:!!r.hasMore};
 }
 if(op==='catalogIssueStatus'){
  if(!isSuper(who)||!catalogUuid(b.issueId))throw Error('僅限 PA Party總裁');
  return await api('/rest/v1/rpc/papa_catalog_issue_set_status',{issue_id:b.issueId,next_status:b.status,actor_id:catalogActor(who)});
 }
 if(op==='catalogCandidateEdit'||op==='catalogLyricSources'||op==='catalogLyricAdopt'){
  if(!isSuper(who))throw Error('僅限 PA Party總裁');
  if(op==='catalogCandidateEdit'){
   if(!catalogUuid(b.candidateId)||!/^[a-f0-9]{32}$/.test(b.expectedSource||''))throw Error('候選資料已更新');
   return await api('/rest/v1/rpc/papa_catalog_candidate_edit',{candidate_id:b.candidateId,expected_source:b.expectedSource,metadata:b.metadata||{},actor_id:catalogActor(who)});
  }
  if(!catalogUuid(b.variantId))throw Error('共同版本不正確');
  if(op==='catalogLyricSources')return await api('/rest/v1/rpc/papa_catalog_lyric_sources',{chosen_variant:b.variantId,page_limit:Math.min(page.limit,3),page_offset:page.offset});
  if(typeof b.streamerSongId!=='string'||typeof b.sourceStreamer!=='string'||!Number.isFinite(Date.parse(b.expectedUpdated)))throw Error('歌詞來源已更新');
  return await api('/rest/v1/rpc/papa_catalog_adopt_lyric',{chosen_variant:b.variantId,room_id:b.sourceStreamer,song_id:b.streamerSongId,actor_id:catalogActor(who),skip:b.skip===true,expected_updated:b.expectedUpdated});
 }
 if(op==='catalogRooms'){
  if(!isManager(who))throw Error('請先登入主播管理');if(!catalogUuid(b.variantId))throw Error('共同版本不正確');
  return await api('/rest/v1/rpc/papa_catalog_variant_rooms_v2',{chosen_variant:b.variantId,page_limit:page.limit,page_offset:page.offset});
 }
 if(op==='catalogScan'){
  if(!isSuper(who))throw Error('僅限 PA Party總裁');
  const cursor=String(b.afterSongId||'');if(cursor.length>200)throw Error('掃描位置不正確');
  return await api('/rest/v1/rpc/papa_catalog_reconcile_songs',{after_song_id:cursor,page_limit:Math.max(1,Math.min(100,Math.floor(Number(b.limit)||50)))});
 }
 if(op==='songSearchRoom'){
  const room=await catalogRoom(who,b.streamer||'papa');
  const q=String(b.q||'').trim().replaceAll('國語','華語');if(q.length>100)throw Error('搜尋文字過長');
  const tags=Array.isArray(b.tags)?b.tags.filter((x:any)=>typeof x==='string'&&x.length<=50).slice(0,20):[];
  const language=b.language==null?null:String(b.language).replaceAll('國語','華語');if(language&&language.length>100)throw Error('語言名稱過長');
  return await api('/rest/v1/rpc/papa_song_search_room_v2',{room_id:room.id,query_text:q,tags,page_limit:page.limit,page_offset:page.offset,language_name:language||null,include_hidden:isManager(who)});
 }
 if(op==='catalogLanguageFilter'||op==='catalogLanguageFilterSave'){
  if(op==='catalogLanguageFilterSave'&&!isManager(who))throw Error('請先登入主播管理');
  const room=await catalogRoom(who,b.streamer||who?.streamer_id||'papa');
  if(op==='catalogLanguageFilter')return await api('/rest/v1/rpc/papa_catalog_language_filter',{room_id:room.id});
  if(!['auto','custom'].includes(b.mode)||!Array.isArray(b.languageIds)||b.languageIds.length>100||b.languageIds.some((id:any)=>typeof id!=='string'||!/^[a-z0-9_-]{1,100}$/.test(id))||new Set(b.languageIds).size!==b.languageIds.length)throw Error('請選擇有效語言');
  return await api('/rest/v1/rpc/papa_catalog_language_filter_save',{room_id:room.id,mode:b.mode,language_ids:b.languageIds,actor_id:catalogActor(who)});
 }
 if(op==='catalogMergeSame'){
  if(!isSuper(who))throw Error('僅限 PA Party總裁');const ids=b.variantIds,versions=b.expectedVersions;
  if(!Array.isArray(ids)||ids.length<2||ids.length>50||ids.some((id:any)=>!catalogUuid(id))||new Set(ids).size!==ids.length||!ids.includes(b.targetVariant)||!versions||ids.some((id:any)=>typeof versions[id]!=='string'||!Number.isFinite(Date.parse(versions[id]))))throw Error('請選擇有效共同版本');
  return await api('/rest/v1/rpc/papa_catalog_merge_same_versions',{variant_ids:ids,target_variant:b.targetVariant,expected_versions:Object.fromEntries(ids.map((id:any)=>[id,versions[id]])),actor_id:catalogActor(who)});
 }
 if(op==='catalogGovernance'){

  if(!isSuper(who))throw Error('僅限 PA Party總裁');
  if(!['update_variant','merge_family','split_variant'].includes(b.action))throw Error('共同曲庫管理操作不正確');
  const ids=b.variantIds,candidates=b.candidateIds||[],versions=b.expectedVersions,sources=b.expectedSources||{};
  if(!Array.isArray(ids)||!ids.length||ids.length>50||ids.some((id:any)=>!catalogUuid(id))||new Set(ids).size!==ids.length||b.action!=='merge_family'&&ids.length!==1)throw Error('請選擇有效共同版本（最多 50 個）');
  if(!versions||typeof versions!=='object'||Array.isArray(versions)||ids.some((id:any)=>typeof versions[id]!=='string'||versions[id].length>50||!Number.isFinite(Date.parse(versions[id]))))throw Error('共同版本已更新，請重新選取');
  if(!Array.isArray(candidates)||candidates.length>50||candidates.some((id:any)=>!catalogUuid(id))||new Set(candidates).size!==candidates.length||b.action==='split_variant'&&!candidates.length)throw Error('請選擇有效來源歌曲');
  if(!sources||typeof sources!=='object'||Array.isArray(sources)||candidates.some((id:any)=>typeof sources[id]!=='string'||!/^[a-f0-9]{32}$/.test(sources[id])))throw Error('來源歌曲已更新，請重新選取');
  if(b.action==='merge_family'&&!catalogUuid(b.targetFamilyId))throw Error('請選擇有效歌曲家族');
  const metadata=b.metadata||{},allowed=['title','artist','languageId','performerTypeId','versionLabel','active'];
  if(typeof metadata!=='object'||Array.isArray(metadata)||Object.keys(metadata).some(k=>!allowed.includes(k)))throw Error('共同歌曲欄位不正確');
  for(const [key,value] of Object.entries(metadata)){
   if(key==='active'){if(typeof value!=='boolean')throw Error('歌曲狀態不正確');}
   else if(key==='languageId'||key==='performerTypeId'){if(value!=null&&(typeof value!=='string'||!/^[a-z0-9_-]{1,100}$/.test(value)))throw Error('歌曲模板不正確');}
   else if(typeof value!=='string'||value.length>(key==='versionLabel'?120:300)||key==='title'&&!value.trim())throw Error('共同歌曲內容不正確');
  }
  if(b.action==='update_variant'&&b.details){
   const details=b.details;
   if(typeof details!=='object'||Array.isArray(details)||Object.entries(details).some(([key,value])=>
    !['versionKind','performerDetail','versionNote'].includes(key)||typeof value!=='string'||value.length>(key==='versionNote'?500:key==='versionKind'?80:300)))throw Error('版本說明內容不正確');
   return await api('/rest/v1/rpc/papa_catalog_update_variant_full',{chosen_variant:ids[0],metadata,
    details,expected_version:versions[ids[0]],actor_id:catalogActor(who)});
  }
  return await api('/rest/v1/rpc/papa_catalog_governance',{action:b.action,variant_ids:ids,candidate_ids:candidates,target_family:b.action==='merge_family'?b.targetFamilyId:null,metadata,expected_versions:Object.fromEntries(ids.map((id:any)=>[id,versions[id]])),expected_sources:Object.fromEntries(candidates.map((id:any)=>[id,sources[id]])),actor_id:catalogActor(who)});
 }
 if(op==='catalogSuggestions'){
  if(!isSuper(who)||!catalogUuid(b.candidateId))throw Error('僅限 PA Party總裁查看候選');
  return await api('/rest/v1/rpc/papa_catalog_suggest_variants',{chosen_candidate:b.candidateId,page_limit:8});
 }
 if(op==='catalogVariantInfo'){
  if(!isSuper(who)||!catalogUuid(b.variantId))throw Error('僅限 PA Party總裁');
  return await api('/rest/v1/rpc/papa_catalog_variant_info',{chosen_variant:b.variantId});
 }
 if(op==='catalogSearch'){
  if(!isManager(who))throw Error('請先登入管理');
  const room=who?.role==='streamer_admin'||b.streamer?await catalogRoom(who,b.streamer||who.streamer_id,true):null;
  const q=String(b.q||'').trim();if(q.length>100)throw Error('搜尋文字過長');
  if(b.inactive&&!isSuper(who))throw Error('僅限 PA Party總裁');
  if(!['metadata','lyrics'].includes(b.searchMode||'metadata')||String(b.language||'').length>100||String(b.performerType||'').length>100)throw Error('共同曲庫篩選不正確');
  const r=await api('/rest/v1/rpc/'+(b.inactive?'papa_catalog_inactive_search':'papa_catalog_search_filtered'),{query_text:q,page_limit:page.limit,page_offset:page.offset,room_id:room?.id||null,...(b.inactive?{}:{language_filter:b.language||null,performer_filter:b.performerType||null,search_mode:b.searchMode||'metadata'})});
  return {items:(r.rows||[]).map((x:any)=>({...x,variantId:x.id})),total:r.total||0,hasMore:!!r.hasMore};
 }
 if(op==='catalogReviewList'){
  if(b.status==='families'){
   if(!isManager(who))throw Error('請先登入主播管理');
   const r=await api('/rest/v1/rpc/papa_catalog_families_page_v2',{query_text:String(b.q||'').slice(0,100),
    lyrics_filter:['all','with','without','proposals'].includes(b.lyricsFilter)?b.lyricsFilter:'all',
    page_limit:page.limit,page_offset:page.offset});
   return {items:r.rows||[],total:r.total||0,hasMore:!!r.hasMore};
  }
  if(!isSuper(who))throw Error('僅限 PA Party總裁');
  if(['singles','duplicates','families'].includes(b.status)){
   const r=await api('/rest/v1/rpc/papa_catalog_review_page',{section:b.status,query_text:String(b.q||'').slice(0,100),language_name:String(b.language||'').slice(0,100),page_limit:page.limit,page_offset:page.offset,chosen_group:b.groupId||null});
   return {items:r.rows||[],total:r.total||0,hasMore:!!r.hasMore,counts:r.counts};
  }
  const status=['pending','approved','rejected','removed','history'].includes(b.status)?b.status:'pending';
  if(status==='history'){const r=await api('/rest/v1/rpc/papa_event_page_v2',{room_id:'__global__',page_number:Math.floor(page.offset/50),include_global:true,module_filter:'shared_catalog',page_limit:page.limit,page_offset:page.offset});return {items:r.rows.map((x:any)=>({...x,actorId:x.actor_role,createdAt:x.created_at,title:x.after_data?.titles?.join('、')||x.after_data?.details?.title,details:x.after_data})),total:r.total||0,hasMore:r.hasMore};}
  const r=await api('/rest/v1/rpc/papa_catalog_review_feed',{status,query_text:String(b.q||'').trim().slice(0,100),page_limit:page.limit,page_offset:page.offset});
  return {items:r.rows||[],total:r.total||0,hasMore:!!r.hasMore};
 }
 if(op==='catalogReview'){
  if(!isSuper(who))throw Error('僅限 PA Party總裁');
  const decisions=['confirm_same','different_versions','independent','approve_new','link_variant','create_variant','reject','remove','unlink'];
  if(!decisions.includes(b.decision))throw Error('此審核操作尚未開放');
  const ids=Array.isArray(b.candidateIds)?[...new Set(b.candidateIds)].filter(catalogUuid).slice(0,50):[];
  if(!ids.length||ids.length!==b.candidateIds?.length)throw Error('請選擇有效候選歌曲（最多 50 首）');
  const sources=b.expectedSources;
  if(!sources||typeof sources!=='object'||Array.isArray(sources)||ids.some((id:any)=>typeof sources[id]!=='string'||!/^[a-f0-9]{32}$/.test(sources[id])))throw Error('候選資料已更新，請重新選取後審核');
  const targetVariant=b.variantId==null?null:catalogUuid(b.variantId)?b.variantId:null;
  const targetFamily=b.familyId==null?null:catalogUuid(b.familyId)?b.familyId:null;
  if(b.variantId!=null&&!targetVariant||b.familyId!=null&&!targetFamily)throw Error('共同歌曲識別碼錯誤');
  if(b.lyricsSource!=null&&(!catalogUuid(b.lyricsSource)||!ids.includes(b.lyricsSource))||b.sharedBody!=null&&(typeof b.sharedBody!=='string'||b.sharedBody.length>100000))throw Error('歌詞來源不正確');
  if(b.decision==='confirm_same'&&b.variantDetails){
   if(typeof b.variantDetails!=='object'||Array.isArray(b.variantDetails)||Object.entries(b.variantDetails).some(([key,value])=>
    !['versionKind','performerDetail','versionNote'].includes(key)||typeof value!=='string'||value.length>(key==='versionNote'?500:key==='versionKind'?80:300)))throw Error('版本資料不正確');
   return await api('/rest/v1/rpc/papa_catalog_review_same_full',{candidate_ids:ids,
    expected_sources:Object.fromEntries(ids.map((id:any)=>[id,sources[id]])),actor_id:catalogActor(who),
    common_metadata:b.commonMetadata||{},variant_details:b.variantDetails,lyrics_source:b.lyricsSource||null,shared_body:b.sharedBody??null});
  }
  if(b.decision==='different_versions'&&b.variantMetadata){
   if(!b.variantMetadata||typeof b.variantMetadata!=='object'||Array.isArray(b.variantMetadata)||
    Object.keys(b.variantMetadata).some(id=>!ids.includes(id)))throw Error('版本資料不正確');
   return await api('/rest/v1/rpc/papa_catalog_review_versions',{candidate_ids:ids,
    expected_sources:Object.fromEntries(ids.map((id:any)=>[id,sources[id]])),actor_id:catalogActor(who),
    common_metadata:b.commonMetadata||{},variant_metadata:b.variantMetadata,target_family:targetFamily});
  }
  if(!['reject','remove','unlink'].includes(b.decision))return await api('/rest/v1/rpc/papa_catalog_review_selected',{decision:b.decision,candidate_ids:ids,expected_sources:Object.fromEntries(ids.map((id:any)=>[id,sources[id]])),actor_id:catalogActor(who),target_family:targetFamily,target_variant:targetVariant,common_metadata:{...(b.commonMetadata||{}),...(b.variantLabel?{versionLabel:String(b.variantLabel).slice(0,100)}:{})},lyrics_source:b.lyricsSource||null,shared_body:b.sharedBody??null,version_labels:b.versionLabels||{}});
  return await api('/rest/v1/rpc/papa_catalog_review_v2',{decision:b.decision,candidate_ids:ids,target_variant:targetVariant,target_family:targetFamily,version_label:String(b.variantLabel||'').slice(0,100),actor_id:catalogActor(who),expected_sources:Object.fromEntries(ids.map((id:any)=>[id,sources[id]])),common_metadata:b.commonMetadata||{}});
 }
 if(op==='catalogTemplates'){
  if(!isManager(who))throw Error('請先登入管理');
  const [languages,performerTypes]=await Promise.all([
   api('/rest/v1/papa_catalog_languages?select=id,name,sort_order,active&order=sort_order.asc,id.asc&limit=100'),
   api('/rest/v1/papa_catalog_performer_types?select=id,name,sort_order,active&order=sort_order.asc,id.asc&limit=100')
  ]);
  return {languages:languages.filter((x:any)=>!x.name.startsWith('已合併至華語')),performerTypes};
 }
 if(op==='catalogTemplateChange'){
  if(!isSuper(who))throw Error('僅限 PA Party總裁');
  const actions:any={create:'create',update:'update',rename:'update',reorder:'update',enable:'activate',disable:'deactivate'};
  if(!['language','performerType'].includes(b.kind)||!actions[b.action])throw Error('模板操作不正確');
  const id=b.action==='create'?'custom_'+crypto.randomUUID().replaceAll('-',''):String(b.id||'');
  if(!/^[a-z0-9_-]{1,100}$/.test(id)||b.name!=null&&(typeof b.name!=='string'||b.name.length>100)||b.sortOrder!=null&&!Number.isInteger(b.sortOrder))throw Error('模板內容不正確');
  return await api('/rest/v1/rpc/papa_catalog_template_change',{kind:b.kind==='performerType'?'performer_type':'language',action:actions[b.action],template_id:id,template_name:b.name==='國語'?'華語':b.name||null,sort_order:b.sortOrder??null,active:b.active??null,actor_id:catalogActor(who)});
 }
 if(op==='catalogLyrics'){
  if(!isManager(who))throw Error('歌詞僅供主播與總裁查看');
  if(b.includeHistory&&!isSuper(who))throw Error('僅限 PA Party總裁查看共同歌詞歷史');
  const room=who?.role==='streamer_admin'?await catalogRoom(who,b.streamer||who.streamer_id,true):b.streamer?await catalogRoom(who,b.streamer,true):null;
  if(who?.role==='streamer_admin'&&!b.streamerSongId)throw Error('請先選擇自己的歌曲');
  // The RPC resolves a room song against its current source hash. Do not trust
  // a raw link (or caller-supplied variant) after a local metadata edit.
  const roomSong=room&&typeof b.streamerSongId==='string'&&b.streamerSongId.length>0&&b.streamerSongId.length<=200;
  const variantId=roomSong?null:b.variantId;
  if(variantId&&!catalogUuid(variantId)||!variantId&&!roomSong)throw Error('共同版本識別碼錯誤');
  const r=await api('/rest/v1/rpc/papa_catalog_get_lyrics',{variant_id:variantId||null,room_id:room?.id||null,song_id:b.streamerSongId||null});
  const resolvedVariant=r.variantId||null;
  if(b.sharedOnly){if(!roomSong||!resolvedVariant)throw Error('這首尚未連結共同歌詞');return {...await api('/rest/v1/rpc/papa_catalog_get_lyrics',{variant_id:resolvedVariant,room_id:null,song_id:null}),linked:true,variantId:resolvedVariant};}
  if(b.includeHistory){if(!resolvedVariant)throw Error('這首尚未連結共同歌詞');const history=await api('/rest/v1/rpc/papa_catalog_lyric_history',{variant_id:resolvedVariant,page_limit:page.limit,page_offset:page.offset});return {...r,linked:true,variantId:resolvedVariant,history:history.rows||[],historyTotal:history.total||0,historyHasMore:!!history.hasMore};}
  return {...r,linked:!!resolvedVariant,variantId:resolvedVariant};
 }
 if(op==='catalogLyricSave'){
  if(!isSuper(who))throw Error('僅限 PA Party總裁');
  if(!catalogUuid(b.variantId)||typeof b.body!=='string'||b.body.length>100000)throw Error('歌詞內容不正確');
  return await api('/rest/v1/rpc/papa_catalog_save_lyric',{variant_id:b.variantId,body:b.body,actor_id:catalogActor(who),active:b.active!==false});
 }
 if(op==='catalogLyricChoice'){
  if(!isManager(who))throw Error('請先登入主播管理');
  const room=await catalogRoom(who,b.streamer||who.streamer_id,true);
  if(!['shared','copy','own'].includes(b.mode)||typeof b.streamerSongId!=='string'||!b.streamerSongId)throw Error('歌詞模式或歌曲錯誤');
  if(typeof b.body!=='string'&&b.body!=null||String(b.body||'').length>100000||String(b.privateNote||'').length>5000)throw Error('歌詞或註記過長');
  return await api('/rest/v1/rpc/papa_catalog_lyric_choice',{room_id:room.id,song_id:b.streamerSongId,mode:b.mode,body:b.body??null,private_note:b.privateNote??null,actor_id:catalogActor(who)});
 }
 if(op==='catalogBatchAdd'){
  if(!isManager(who))throw Error('請先登入主播管理');
  const room=await catalogRoom(who,b.streamer||who.streamer_id,true);
  const ids=Array.isArray(b.variantIds)?[...new Set(b.variantIds)].filter(catalogUuid).slice(0,50):[];
  if(!ids.length||ids.length!==b.variantIds?.length||!['shared','copy','own'].includes(b.lyricsMode))throw Error('請選擇有效歌曲與歌詞模式（最多 50 首）');
  return await api('/rest/v1/rpc/papa_catalog_batch_add',{room_id:room.id,variant_ids:ids,lyrics_mode:b.lyricsMode,actor_id:catalogActor(who)});
 }
 throw Error('未知共同曲庫操作');
}
