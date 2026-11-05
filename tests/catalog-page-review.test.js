import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
test('preview writes only confirmed page rows and retries only the unfinished batch',async()=>{
 const items=Array.from({length:56},(_,i)=>({id:String(i),title:'Song '+i,sourceHash:'hash',updatedAt:'version',defaultTarget:i<52?'variant-a':null}));
 const calls=[];let submit,reloads=0,failed=false;
 const catalogView={items,loaded:true,section:'duplicates',page:1,selected:new Set(['offpage',...items.slice(0,55).map(row=>row.id)]),selectedRows:new Map(),selectedSources:new Map(),selectedVariants:new Map()};
 const ctx=vm.createContext({catalogView,admin:{},state:{currentStreamer:{id:'room'}},tab:'catalog',demo:false,draft:false,isSuperAdmin:()=>true,h:String,modal:(_title,_body,fn)=>{submit=fn;},$:()=>({}),invalidateCatalogTabs(){},loadCatalogReview:async()=>{reloads++;},toast(){},api:async request=>{calls.push(request);if(request.candidateIds[0]==='50'&&!failed){failed=true;throw Error('failed');}}});
 vm.runInContext(source.slice(source.indexOf('const catalogPageChoices='),source.indexOf('function catalogReviewHtml()'))+"\ncatalogPageChoices.set('51','independent');catalogPageChoices.set('52','later'); const plan={decision:'different_versions',ids:['53','54'],payload:{variantMetadata:{53:{versionLabel:'原版'},54:{versionLabel:'現場版'}}},versions:{53:'version',54:'version'}}; catalogPageChoices.set('53',plan);catalogPageChoices.set('54',plan);previewCatalogPage();",ctx);
 assert.equal(calls.length,0);
 await assert.rejects(submit(),/failed/);
 assert.equal(reloads,0);
 await submit();
 assert.deepEqual(calls.map(x=>Array.from(x.candidateIds).join(',')).slice(1),['50','50','51','53,54']);
 assert.equal(calls[0].candidateIds.length,50);
 assert.equal(calls.at(-2).decision,'independent');
 assert.equal(calls.at(-1).decision,'different_versions');
 assert.equal(reloads,1);
});

test('linked candidate shows only fields that differ from the original variant',()=>{
 const body=source.slice(source.indexOf('function catalogPreviousVariantHtml('),source.indexOf('function catalogPageRowActions('));
 const render=vm.runInNewContext(body+'\ncatalogPreviousVariantHtml',{h:String});
 assert.equal(render({artist:'新歌手'}),'');
 const html=render({title:'同一首',artist:'新歌手',language:'華語',previousVariant:{title:'同一首',artist:'舊歌手',language:'華語'}});
 assert.match(html,/歌手 舊歌手 → 新歌手/);
 assert.doesNotMatch(html,/<li>歌名|<li>語言/);
});

test('multiple suggested versions explain manual selection and show spelling differences',()=>{
 const body=source.slice(source.indexOf('function catalogMatchPercent('),source.indexOf('function previewCatalogPage('));
 const render=vm.runInNewContext(body+'\ncatalogGroupMatches',{h:String,button:()=>''});
 const html=render({rows:[{title:'不痛',artist:'張韶涵'}],matches:[{title:'不痛',artist:'張紹涵',score:0.786,versionKind:'original'},{title:'不痛',artist:'張韶涵',score:1,versionLabel:'現場版'}]});
 assert.doesNotMatch(html,/張紹涵|有多個比對候選/);
 assert.match(html,/現場版/);
 const onlyApproximate=render({rows:[{title:'不痛',artist:'張韶涵'}],matches:[{title:'不痛',artist:'張紹涵',score:0.786,versionKind:'original'},{title:'另一首',artist:'張韶涵',score:0.995,versionLabel:'現場版'}]});
 assert.match(onlyApproximate,/有多個比對候選/);
 assert.match(onlyApproximate,/張韶涵 → 張紹涵/);
 assert.match(onlyApproximate,/原版 · 相似候選（79%）/);
});

test('a direct pick replaces the previous target for the same source',()=>{
 const body=source.slice(source.indexOf('function catalogMatchPercent('),source.indexOf('function catalogMatchRadio('));
 const choices=new Map(), row={id:'source',updatedAt:'v1'};
 const stage=vm.runInNewContext(body+'\nstageCatalogDirectMatch',{
  catalogView:{section:'duplicates',groups:[{rows:[row],matches:[{variantId:'a',score:.9},{variantId:'b',score:.8}]}]},
  catalogPageBusy:false,catalogPageCompleted:new Set(),catalogPageChoices:choices,isSuperAdmin:()=>true,render(){}
 });
 stage(row.id,'a');stage(row.id,'b');stage(row.id,'invalid');
 assert.equal(choices.size,1);
 assert.equal(choices.get(row.id).payload.variantId,'b');
 assert.equal(choices.get(row.id).versions.source,'v1');
});

test('only one exact candidate is suggested and linked drift still needs a choice',()=>{
 const body=source.slice(source.indexOf('function catalogSuggestedTarget('),source.indexOf('function catalogPageChoice('));
 const suggested=vm.runInNewContext(body+'\ncatalogSuggestedTarget',{catalogVisibleMatches:group=>{const exact=group.matches.filter(row=>row.score===1);return exact.length?exact:group.matches;},catalogView:{selected:new Set(['source'])}});
 const row={title:'同歌',artist:'歌手',versionLabel:''};
 const match={...row,score:1,variantId:'exact'};
 assert.equal(suggested(row,{matches:[match,{score:.34}]}),'exact');
 assert.equal(suggested(row,{matches:[match,{...match,variantId:'second'}]}),'');
 assert.equal(suggested({...row,previousVariant:{}},{matches:[match]}),'');
 const sourceRow={...row,id:'source',artist:'張韶涵'};
 const approximate={...match,artist:'張紹涵',score:.79};
 assert.equal(suggested(sourceRow,{rows:[sourceRow],matches:[approximate]}),'exact');
 assert.equal(suggested({...sourceRow,id:'unchecked'},{rows:[sourceRow],matches:[approximate]}),'');
 assert.equal(suggested({...sourceRow,artist:'不同歌手'},{rows:[sourceRow],matches:[approximate]}),'');

});

test('single-source match renders one candidate line with the radio before its text',()=>{
 const body=source.slice(source.indexOf('function catalogMatchPercent('),source.indexOf('function previewCatalogPage('));
 const render=vm.runInNewContext(body+'\ncatalogGroupMatches',{h:String,button:()=>'',catalogPageChoices:new Map(),catalogPageCompleted:new Set(),catalogSuggestedTarget:()=> 'match'});
 const html=render({rows:[{id:'source',title:'唯一歌名',artist:'歌手'}],matches:[{variantId:'match',title:'唯一歌名',artist:'歌手',score:.79}]});
 assert.equal(html.match(/唯一歌名/g).length,1);
 assert.match(html,/type="radio"[^>]*checked[^>]*><span>唯一歌名/);
});

test('inline independent and new version are mutually exclusive and retain the source revision',()=>{
 const body=source.slice(source.indexOf('function catalogMatchPercent('),source.indexOf('function catalogMatchRadio('));
 const choices=new Map(),row={id:'source',updatedAt:'v1'};
 const stage=vm.runInNewContext(body+'\nstageCatalogDirectMatch',{
  catalogView:{section:'duplicates',groups:[{rows:[row],matches:[{variantId:'a',familyId:'family',title:'作品',score:.9}]}]},
  catalogPageBusy:false,catalogPageCompleted:new Set(),catalogPageChoices:choices,
  isSuperAdmin:()=>true,render(){},prompt:()=> '現場版'
 });
 stage(row.id,'independent');
 assert.equal(choices.get(row.id).decision,'independent');
 stage(row.id,'new:family');
 assert.equal(choices.size,1);
 assert.equal(choices.get(row.id).decision,'create_variant');
 assert.equal(choices.get(row.id).payload.familyId,'family');
 assert.equal(choices.get(row.id).payload.variantLabel,'現場版');
 assert.equal(choices.get(row.id).versions.source,'v1');
});
