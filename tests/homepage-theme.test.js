import test from 'node:test';
import assert from 'node:assert/strict';
import {themeSmartPalette,themeContrast,themeNormalize,themeValidate,themeBannerMask,themeCssVariables,themeLayeredBackground,themeImageUrls,themeSame,themeAsset,THEME_TEMPLATES,THEME_COLOR_KEYS,THEME_MAX_BYTES} from '../src/theme-engine.js';
import {themePlanFeatures,themePlanInput,themeSaveRequirements,THEME_STREAMER_FEATURES,THEME_LOCKED_MESSAGE} from '../src/theme-access.js';
import {mutate,publicView,scopeState,empty,upgradePlatform} from '../src/core.js';
import {createThemeApi} from '../supabase/functions/party-api/theme-api.js';
import {lobbyImageProjectionPath,lobbyHeroImage,lobbyHeroFocus,createLobbyImageReader} from '../supabase/functions/party-api/lobby-images.js';
import {lobbyFocusStyle} from '../src/public-lobby.js';

const SB='https://db.example.co';
const asset=(owner='papa',kind='s',n='a')=>`${SB}/storage/v1/object/public/papa-photos/themes/${kind}/${owner}/${n.repeat(64)}.webp`;

test('any main colour yields a full palette that keeps text readable in both modes',()=>{
 for(const base of ['#ff0000','#ff8a7a','#2fbf8f','#3b82f6','#8b5cf6','#facc15','#000000','#ffffff','#7f7f7f'])for(const mode of ['dark','light']){
  const p=themeSmartPalette(base,mode);
  assert.deepEqual(Object.keys(p).sort(),[...THEME_COLOR_KEYS].sort());
  assert.ok(themeContrast(p.title,p.panel)>=4.5,base+mode+' title');
  assert.ok(themeContrast(p.text,p.panel)>=4.5,base+mode+' text');
  assert.ok(themeContrast(p.text,p.background)>=4.5,base+mode+' text on page');
  assert.ok(Math.min(themeContrast(p.buttonText,p.button),themeContrast(p.buttonText,p.button2))>=4.5,base+mode+' button');
 }
 assert.equal(themeSmartPalette('#ff0000','dark').button,'#ff0000','the chosen red stays the button colour');
 assert.equal(THEME_TEMPLATES.map(t=>t.name).join(),'紫夜,蜜桃,薄荷,星藍,奶茶');
 const a=themeSmartPalette('#123456','dark');a.title='#000000';assert.notEqual(themeSmartPalette('#123456','dark').title,'#000000','cached result is not shared by reference');
});

test('normalised themes omit defaults, keep manual exceptions and stay compact',()=>{
 const t=themeNormalize({base:'#FF0000',mode:'light',manual:['logo','nope'],colors:{logo:'#111111'},images:{card:{url:asset(),opacity:100,mask:65},background:{opacity:40}}});
 assert.equal(t.base,'#ff0000');assert.deepEqual(t.manual,['logo']);assert.equal(t.colors.logo,'#111111');
 assert.deepEqual(t.images.card,{url:asset()},'default numbers are not stored');
 assert.equal(t.images.background,undefined,'no picture means no background layer record');
 const full=themeNormalize({base:'#8b5cf6',images:{background:{url:asset('papa','s','b'),x:10,y:90,opacity:30,mask:60},banner:{url:asset('papa','s','c'),x:5,maskWidth:70,maskPosition:80,maskFeather:10,hallX:20,hallOpacity:90},card:{url:asset('papa','s','d'),opacity:50}},decor:Array.from({length:6},(_,i)=>({url:asset('papa','s',String(i)),x:i*10,y:50,size:20,opacity:80}))});
 assert.ok(JSON.stringify(full).length<2500,'a fully used theme stays a few KB: '+JSON.stringify(full).length);
 assert.ok(JSON.stringify(full).length<THEME_MAX_BYTES);
});

test('strict validation rejects foreign owners, hall/streamer mixups, raw images and oversize decor',()=>{
 assert.equal(themeValidate(null),null);
 assert.throws(()=>themeValidate({base:'red'}),/主色/);
 assert.throws(()=>themeValidate({base:'#ff0000',colors:{title:'#fff'}}),/六碼/);
 assert.throws(()=>themeValidate({base:'#ff0000',images:{card:{url:'https://evil.example/x.png'}}}),/上傳/);
 assert.throws(()=>themeValidate({base:'#ff0000',images:{card:{url:'data:image/png;base64,AAAA'}}}),/上傳/);
 assert.throws(()=>themeValidate({base:'#ff0000',images:{card:{url:asset('mimi')}}},{owner:'papa'}),/不屬於/);
 assert.throws(()=>themeValidate({base:'#ff0000',images:{card:{url:asset('space-001','h')}}},{owner:'space-001'}),/不屬於/);
 assert.ok(themeValidate({base:'#ff0000',images:{card:{url:asset('space-001','h')}}},{hall:true,owner:'space-001'}));
 assert.throws(()=>themeValidate({base:'#ff0000',decor:Array.from({length:7},()=>({url:asset()}))}),/最多/);
 assert.deepEqual(themeAsset(asset()),{kind:'s',owner:'papa',hash:'a'.repeat(64)});
});

test('banner mask is a relative band whose width, position, feather and darkness are independent of focus',()=>{
 const base={base:'#000000',mode:'dark',images:{banner:{maskWidth:40,maskPosition:50,maskFeather:0,mask:80}}};
 const mask=themeBannerMask(base);
 assert.match(mask,/^linear-gradient\(90deg,/);assert.match(mask,/rgba\(\d+,\d+,\d+,0\.8\) 30%/);assert.match(mask,/rgba\(\d+,\d+,\d+,0\.8\) 70%/);
 assert.doesNotMatch(mask,/px/,'percentages only, so phone and desktop scale the same');
 const moved={...base,images:{banner:{...base.images.banner,x:5,y:95}}};
 assert.equal(themeBannerMask(moved),mask,'moving the picture never moves the mask');
 assert.notEqual(themeBannerMask({...base,images:{banner:{...base.images.banner,maskFeather:80}}}),mask);
 assert.equal(themeBannerMask({...base,images:{banner:{mask:0}}}),'none');
});

test('image opacity and mask are CSS layers; colours and buttons never become transparent',()=>{
 const fill=themeLayeredBackground('#202020',{url:asset(),opacity:40,mask:20,x:10,y:80},'card');
 const mask=fill.indexOf('rgba(32,32,32,0.2)'),veil=fill.indexOf('rgba(32,32,32,0.6)'),pic=fill.indexOf('url(');
 assert.ok(mask>=0&&veil>mask&&pic>veil,'mask, then 60% veil (= 40% picture), then picture');
 assert.match(fill,/url\("https:\/\/db\.example\.co\/.*"\) 10% 80%\/cover no-repeat/);
 assert.match(fill,/,#202020$/);
 const vars=themeCssVariables({base:'#ff0000',button:'solid'});
 assert.equal(vars['--home-button'],vars['--theme-button-solid'],'solid buttons use one colour');
 assert.match(themeCssVariables({base:'#ff0000'})['--home-button'],/^linear-gradient\(135deg,/);
 assert.equal(themeCssVariables({base:'#ff0000'})['--theme-card-fill'],themeNormalize({base:'#ff0000'}).colors.panel,'no card picture = plain colour');
});

test('six plans map to theme features without prices; plan 4/6 need manual ticks; expiry closes access',()=>{
 for(const plan of ['lifetime_free_full','founding','founding_lifetime','general_full'])assert.deepEqual(themePlanFeatures({plan,status:'active'}),THEME_STREAMER_FEATURES);
 assert.deepEqual(themePlanFeatures({plan:'free_songbook',status:'active'}),[]);
 assert.deepEqual(themePlanFeatures({plan:'basic_plus_single',status:'active',features:['theme_streamer_basic','theme_hall_basic']}),['theme_streamer_basic']);
 assert.deepEqual(themePlanFeatures({plan:'founding',status:'active',valid_until:'2026-01-01T00:00:00Z'},Date.parse('2026-02-01')),[]);
 assert.deepEqual(themePlanFeatures({plan:'general_full',status:'suspended'}),[]);
 assert.deepEqual(themePlanFeatures(null),[],'no plan row (e.g. a copied streamer) gets nothing');
 assert.throws(()=>themePlanInput({plan:'gold',status:'active'}),/方案/);
 assert.equal(themePlanInput({plan:'founding',status:'active',validUntil:'2027-01-31'}).valid_until,'2027-01-31T23:59:59+08:00');
 assert.deepEqual(themeSaveRequirements({theme:true,images:true},['theme_streamer_basic']).sort(),['theme_streamer_images','theme_streamer_publish']);
 assert.deepEqual(themeSaveRequirements({theme:true,images:false},THEME_STREAMER_FEATURES),[]);
 assert.match(THEME_LOCKED_MESSAGE,/^此功能尚未開放，目前會員方案不包含此功能。如需使用，請聯絡平台管理員。$/);
});

function room(){
 const s=upgradePlatform(empty());
 return mutate(s,{type:'streamer',data:{slug:'mimi',display_name:'咪醬'}},{role:'admin'},'2026-10-28T00:00:00.000Z');
}
test('settings reducer validates themes server-side, drafts stay away from players, other settings survive',()=>{
 let s=room();const t='2026-10-28T00:00:00.000Z',admin={role:'admin'};
 const theme={base:'#ff0000',images:{banner:{url:asset('papa'),maskWidth:60}}};
 s=mutate(s,{type:'settings',streamer:'papa',data:{themeDraft:theme}},admin,t);
 assert.equal(scopeState(s,'papa').settings.themeDraft.base,'#ff0000');
 assert.equal(publicView(s,{role:'player',playerId:'P1'},t,'papa').settings.themeDraft,undefined,'players never receive drafts');
 assert.equal(publicView(s,admin,t,'papa').settings.themeDraft.base,'#ff0000');
 assert.throws(()=>mutate(s,{type:'settings',streamer:'mimi',data:{theme}},admin,t),/不屬於/,'a streamer cannot publish another streamer\'s files');
 s=mutate(s,{type:'settings',streamer:'papa',data:{theme,themeDraft:null}},admin,t);
 const live=scopeState(s,'papa').settings;
 assert.equal(live.theme.images.banner.maskWidth,60);assert.equal(Object.hasOwn(live,'themeDraft'),false);
 assert.equal(scopeState(s,'mimi').settings.theme,undefined,'other streamer untouched');
 s=mutate(s,{type:'settings',streamer:'papa',data:{hourlyLimit:3}},admin,t);
 assert.equal(scopeState(s,'papa').settings.theme.base,'#ff0000','unrelated settings saves keep the theme');
 s=mutate(s,{type:'settings',streamer:'papa',data:{theme:null}},admin,t);
 assert.equal(scopeState(s,'papa').settings.theme,undefined,'restore default');
 assert.equal(scopeState(s,'papa').settings.hourlyLimit,3);
});

function fakeEdge({plan=null,hall=[],membership=false,storageFiles=[],settings={}}={}){
 const calls=[],stored=[];
 const api=async(path,body,method)=>{calls.push({path,body,method});
  if(path.startsWith('/rest/v1/papa_streamer_plans'))return plan?[plan]:[];
  if(path.startsWith('/rest/v1/papa_space_entitlements'))return hall.map(feature_key=>({feature_key}));
  if(path.startsWith('/rest/v1/papa_space_memberships'))return membership?[{id:'m'}]:[];
  if(path.startsWith('/rest/v1/papa_space_policies'))return [];
  if(path.startsWith('/rest/v1/papa_v2_entities'))return [{t:settings.theme||null,d:settings.themeDraft||null}];
  if(path==='/rest/v1/rpc/papa_theme_assets_in_use')return (body.asset_hashes||[]).filter(h=>(settings.inUseElsewhere||[]).includes(h));
  if(path.startsWith('/rest/v1/rpc/'))return 1;
  throw Error('unexpected '+path);};
 const storage=async(path,init)=>{stored.push({path,init});
  if(path.includes('/object/list/'))return new Response(JSON.stringify(storageFiles),{status:200});
  return new Response('{}',{status:200});};
 const managerRoom=async(who,id)=>{if(who.role==='streamer_admin'&&who.streamer_id!==id)throw Error('只能管理自己的主播空間');return {id,spaceId:'space-001'};};
 const isSuper=w=>['admin','super_admin'].includes(w?.role),isManager=w=>isSuper(w)||w?.role==='streamer_admin';
 return {calls,stored,themes:createThemeApi({api,storage,publicBase:SB,isSuper,isManager,managerRoom,now:()=>Date.parse('2026-10-28T00:00:00Z')})};
}
const webp=n=>{const b=new Uint8Array(n);b.set([82,73,70,70],0);b.set([87,69,66,80],8);return Buffer.from(b).toString('base64');};
const streamerAdmin={role:'streamer_admin',streamer_id:'papa',accountId:'11111111-1111-4111-8111-111111111111'};

test('backend: free songbook cannot save themes, full plan can, president bypasses, images need the images feature',async()=>{
 const before={},payload={themeDraft:{base:'#ff0000'}};
 await assert.rejects(fakeEdge({plan:{plan:'free_songbook',status:'active'}}).themes.authorizeStreamerSettings(streamerAdmin,{id:'papa'},before,payload),/尚未開放/);
 await fakeEdge({plan:{plan:'lifetime_free_full',status:'active'}}).themes.authorizeStreamerSettings(streamerAdmin,{id:'papa'},before,payload);
 await fakeEdge().themes.authorizeStreamerSettings({role:'super_admin',accountId:'x'},{id:'papa'},before,payload);
 const basicOnly=fakeEdge({plan:{plan:'basic_plus_single',status:'active',features:['theme_streamer_basic','theme_streamer_publish']}});
 await basicOnly.themes.authorizeStreamerSettings(streamerAdmin,{id:'papa'},before,payload);
 await assert.rejects(basicOnly.themes.authorizeStreamerSettings(streamerAdmin,{id:'papa'},before,{themeDraft:{base:'#ff0000',images:{card:{url:asset()}}}}),/尚未開放/);
 // Re-sending unchanged theme keys (e.g. a whole settings object) needs no theme rights.
 await fakeEdge({plan:{plan:'free_songbook',status:'active'}}).themes.authorizeStreamerSettings(streamerAdmin,{id:'papa'},{theme:{base:'#ff0000'}},{theme:{base:'#ff0000'},hourlyLimit:3});
 await assert.rejects(fakeEdge({plan:{plan:'general_full',status:'active'}}).themes.authorizeStreamerSettings(streamerAdmin,{id:'papa'},before,{theme:{base:'#ff0000',images:{card:{url:asset().replace(SB,'https://other.example')}}}}),/上傳/,'files must be this project\'s own storage');
});

test('backend upload: content-addressed WebP, owner path, size ceilings, duplicate reuse, no plan → locked',async()=>{
 const full=fakeEdge({plan:{plan:'general_full',status:'active'}});
 const r=await full.themes.upload(streamerAdmin,{streamer:'papa',role:'card',image:webp(2000),mime:'image/webp'});
 assert.match(r.url,new RegExp('^'+SB+'/storage/v1/object/public/papa-photos/themes/s/papa/[a-f0-9]{64}\\.webp$'));
 assert.equal(full.stored[0].init.headers['cache-control'],'max-age=31536000');assert.equal(full.stored[0].init.headers['x-upsert'],'false');
 const again=await full.themes.upload(streamerAdmin,{streamer:'papa',role:'card',image:webp(2000),mime:'image/webp'});assert.equal(again.url,r.url,'same picture → same path');
 await assert.rejects(full.themes.upload(streamerAdmin,{streamer:'papa',role:'decor',image:webp(600*1024),mime:'image/webp'}),/過大|壓縮/);
 await assert.rejects(full.themes.upload(streamerAdmin,{streamer:'papa',role:'card',image:Buffer.from('not an image').toString('base64'),mime:'image/webp'}),/壓縮/);
 await assert.rejects(full.themes.upload(streamerAdmin,{streamer:'mimi',role:'card',image:webp(20),mime:'image/webp'}),/自己的主播/);
 await assert.rejects(fakeEdge({plan:{plan:'free_songbook',status:'active'}}).themes.upload(streamerAdmin,{streamer:'papa',role:'card',image:webp(20),mime:'image/webp'}),/尚未開放/);
 await assert.rejects(full.themes.upload(streamerAdmin,{target:'hall',spaceId:'space-001',role:'card',image:webp(20),mime:'image/webp'}),/廳管理員/,'a streamer admin is not a hall admin');
});

test('backend hall themes: separate from streamer plans, publish clears draft in one RPC, public read is published only',async()=>{
 const hallAdmin={role:'player',accountId:'22222222-2222-4222-8222-222222222222'};
 const edge=fakeEdge({membership:true,hall:['theme_hall_basic','theme_hall_publish']});
 await edge.themes.hallSave(hallAdmin,{spaceId:'space-001',mode:'publish',theme:{base:'#3b82f6'}});
 const rpc=edge.calls.find(c=>c.path==='/rest/v1/rpc/papa_theme_hall_save');assert.equal(rpc.body.save_mode,'publish');assert.equal(rpc.body.theme_value.base,'#3b82f6');
 await assert.rejects(edge.themes.hallSave(hallAdmin,{spaceId:'space-001',mode:'draft',theme:{base:'#3b82f6',images:{card:{url:asset('space-001','h')}}}}),/尚未開放/);
 await assert.rejects(fakeEdge({membership:false}).themes.hallSave(hallAdmin,{spaceId:'space-001',mode:'draft',theme:{base:'#000000'}}),/廳管理員/);
 await assert.rejects(edge.themes.hallSave(hallAdmin,{spaceId:'space-001',mode:'draft',theme:{base:'#000000',images:{card:{url:asset('papa','s')}}}}),/不屬於/);
 assert.deepEqual(await fakeEdge().themes.hallPublic({spaceId:'space-001'}),{theme:null,revision:0});
});

test('backend cleanup only removes files referenced by neither the published theme nor the draft, after 24 hours',async()=>{
 const used=asset('papa','s','a'),draft=asset('papa','s','b'),old=asset('papa','s','c'),fresh=asset('papa','s','d');
 const name=u=>u.split('/').pop();
 const files=[[used,'2026-10-01'],[draft,'2026-10-01'],[old,'2026-10-01'],[fresh,'2026-10-27T23:00:00Z']].map(([u,at])=>({name:name(u),created_at:at,metadata:{size:1000}}));
 const edge=fakeEdge({plan:{plan:'general_full',status:'active'},storageFiles:files,settings:{theme:{base:'#000000',images:{banner:{url:used}}},themeDraft:{base:'#000000',decor:[{url:draft}]}}});
 assert.deepEqual(await edge.themes.cleanup(streamerAdmin,{streamer:'papa'}),{total:4,referenced:3,removable:1,bytes:1000},'dry run by default');
 assert.equal(edge.stored.some(s=>s.init.method==='DELETE'),false);
 assert.deepEqual(await edge.themes.cleanup(streamerAdmin,{streamer:'papa',dryRun:false}),{total:4,removed:1});
 const del=edge.stored.find(s=>s.init.method==='DELETE');assert.deepEqual(JSON.parse(del.init.body).prefixes,['themes/s/papa/'+name(old)]);
 const copied=fakeEdge({plan:{plan:'general_full',status:'active'},storageFiles:files,settings:{theme:{base:'#000000',images:{banner:{url:used}}},themeDraft:{base:'#000000',decor:[{url:draft}]},inUseElsewhere:['c'.repeat(64)]}});
 assert.equal((await copied.themes.cleanup(streamerAdmin,{streamer:'papa'})).removable,0,'a copy of this streamer still uses the old file, so it stays');
});

test('hall cards read the streamer\'s own banner crop as scalars; old rooms keep their look',async()=>{
 const fields=new URL(lobbyImageProjectionPath(['papa']),'https://db.example').searchParams.get('select').split(',');
 assert.ok(fields.includes('i0_tu:data->streamerSettings->"papa"->theme->images->banner->>url'));
 assert.ok(fields.includes('i0_to:data->streamerSettings->"papa"->theme->images->banner->>hallOpacity'));
 assert.equal(fields.some(f=>/->theme$|->banner$/.test(f)),false,'never a whole JSON object');
 const r={id:'papa',slug:'papa',banner_url:'https://img.example/old.webp'};
 assert.equal(lobbyHeroImage(r,{mode:'none',themeUrl:asset()}),asset(),'a published theme banner wins');
 assert.equal(lobbyHeroFocus({mode:'default'}),null);
 assert.deepEqual(lobbyHeroFocus({themeUrl:asset(),hallX:'12',hallY:null,hallOpacity:'80'}),{x:12,y:35,opacity:80});
 assert.equal(lobbyFocusStyle({x:12,y:35,opacity:80}),' style="object-position:12% 35%;opacity:0.8"');
 assert.equal(lobbyFocusStyle({x:'1;background:url(x)',y:1,opacity:1}),'');
 const read=createLobbyImageReader({api:async()=>[{kind:'meta',i0_mode:null,i0_tu:asset(),i0_tx:'20',i0_ty:'30',i0_to:null}]});
 assert.deepEqual((await read([r]))[0],{id:'papa',slug:'papa',display_name:undefined,heroImage:asset(),heroFocus:{x:20,y:30,opacity:22}});
});

test('theme comparisons and image reference sets',()=>{
 assert.ok(themeSame({base:'#FF0000'},{base:'#ff0000',mode:'dark'}));
 assert.ok(!themeSame(null,{base:'#ff0000'}));
 assert.deepEqual(themeImageUrls({base:'#000000',images:{card:{url:asset()}},decor:[{url:asset('papa','s','e')}]}),[asset(),asset('papa','s','e')]);
});

test('quota divider: length, thickness, colour and opacity are stored compactly and survive the server reducer',async()=>{
 const {themeDividerVariables,themeDividerValue}=await import('../src/theme-engine.js');
 const t=themeNormalize({base:'#ff0000',divider:{color:'#FFFFFF',length:40,thickness:9,opacity:-5,junk:1}});
 assert.deepEqual(t.divider,{color:'#ffffff',length:40,thickness:6,opacity:0},'clamped, lower-cased, unknown keys dropped');
 assert.equal(themeNormalize({base:'#ff0000',divider:{length:100,thickness:1,opacity:55}}).divider,undefined,'defaults are not stored');
 assert.deepEqual(themeDividerVariables(t),{'--theme-divider-color':'rgba(255,255,255,0)','--theme-divider-length':'40%','--theme-divider-size':'6px'});
 assert.equal(themeDividerValue({base:'#ff0000'}).color,themeNormalize({base:'#ff0000'}).colors.line,'no colour follows the border colour');
 let s=room();s=mutate(s,{type:'settings',streamer:'papa',data:{theme:{base:'#ff0000',divider:{length:30,opacity:80}}}},{role:'admin'},'2026-10-28T00:00:00.000Z');
 assert.deepEqual(scopeState(s,'papa').settings.theme.divider,{length:30,opacity:80});
});

test('form fields use an opaque background so the browser dropdown list stays dark',()=>{
 for(const base of ['#8b5cf6','#ff0000','#000000'])for(const mode of ['dark','light'])
  assert.match(themeCssVariables({base,mode})['--theme-input'],/^#[0-9a-f]{6}$/,base+mode);
});

test('buttons follow the theme: toggles get an opaque tint of the button colour',()=>{
 const v=themeCssVariables({base:'#8b5cf6',mode:'dark',colors:{button:'#6a4f7d',button2:'#070317',buttonText:'#fafafa'}});
 assert.match(v['--theme-button-soft'],/^#[0-9a-f]{6}$/);
 assert.equal(v['--home-button'],'linear-gradient(135deg,#6a4f7d,#070317)');
});

test('decoration motion is one optional word per decoration and survives the server reducer',async()=>{
 const {THEME_DECOR_MOTIONS}=await import('../src/theme-engine.js');
 assert.deepEqual(Object.keys(THEME_DECOR_MOTIONS),['none','fixed','follow','tap','float']);
 const n=themeNormalize({base:'#000000',decor:[{url:asset(),motion:'tap'},{url:asset('papa','s','b'),motion:'none'},{url:asset('papa','s','c'),motion:'teleport'}]});
 assert.equal(n.decor[0].motion,'tap');assert.equal('motion' in n.decor[1],false);assert.equal('motion' in n.decor[2],false);
 let s=room();s=mutate(s,{type:'settings',streamer:'papa',data:{theme:{base:'#000000',decor:[{url:asset(),motion:'follow',x:10,y:90}]}}},{role:'admin'},'2026-10-28T00:00:00.000Z');
 assert.equal(scopeState(s,'papa').settings.theme.decor[0].motion,'follow');
});
