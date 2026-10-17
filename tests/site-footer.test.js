import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mountSiteFooter,siteFooterHtml,SITE_FOOTER_LINKS} from '../src/site-footer.js';

test('footer reads the existing release manifest and mounts once without a backend request',async()=>{
 const node={textContent:''},root={innerHTML:'',querySelector:()=>node},calls=[];
 const options={releaseUrl:new URL('https://fixture.test/app/release.json'),fetchVersion:async(url,init)=>{
  calls.push({url:String(url),init});return {ok:true,json:async()=>({version:'99.3-QA.8',backendVersion:'different-backend'})};
 }};
 const first=mountSiteFooter(root,options),second=mountSiteFooter(root,options);
 assert.equal(first,second);await first;
 assert.equal(node.textContent,'v99.3-QA.8');assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://fixture.test/app/release.json');assert.equal(calls[0].init.cache,'no-cache');
 assert.equal((root.innerHTML.match(/Made with/g)||[]).length,1);
});

test('missing legal pages stay plain text and cannot turn into guessed or unsafe links',()=>{
 assert.deepEqual(SITE_FOOTER_LINKS,{privacy:null,terms:null,contact:null});
 const empty=siteFooterHtml();assert.equal(empty.includes('<a '),false);
 assert.equal(/href=["'](?:#|\/privacy|\/terms|\/contact)/.test(empty),false);
 const supplied=siteFooterHtml({baseUrl:'https://fixture.test/app/',links:{privacy:'javascript:alert(1)',terms:'#',contact:'https://fixture.test/actual-contact?x="&y=2'}});
 assert.equal((supplied.match(/<a /g)||[]).length,1);assert.equal(supplied.includes('javascript:'),false);
 assert.ok(supplied.includes('actual-contact?x=%22&amp;y=2'));
});

test('unavailable or malformed release data never shows a guessed, backend or injected version',async()=>{
 for(const response of [{ok:false},{ok:true,json:async()=>({backendVersion:'10-guess'})},{ok:true,json:async()=>({version:'<img src=x>'})},{ok:true,json:async()=>({version:'1\nprivate'})},null]){
  const node={textContent:''},root={innerHTML:'',querySelector:()=>node};let requests=0;
  await mountSiteFooter(root,{fetchVersion:async()=>{requests++;if(response===null)throw Error('private response');return response;}});
  assert.equal(node.textContent,'版本暫不可用');assert.equal(requests,1);
  assert.equal(root.innerHTML.includes('private response'),false);
 }
});

test('main, preview and lobby use the same single footer outside the changing app content',()=>{
 const version=JSON.parse(fs.readFileSync('release.json','utf8')).version;
 for(const page of ['index.html','preview.html','lobby.html']){
  const html=fs.readFileSync(page,'utf8');
  assert.equal((html.match(/id="site-footer"/g)||[]).length,1,page);
  assert.ok(html.indexOf('id="site-footer"')>html.indexOf('</main>'),page);
  for(const asset of ['src/site-footer.css','src/site-footer.js'])assert.ok(html.includes(asset+'?v='+version),page+' '+asset);
 }
});
