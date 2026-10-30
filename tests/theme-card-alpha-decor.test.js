import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {themeNormalize,themeValidate,themeCssVariables,themeDefault,THEME_CARD_ALPHA_DEFAULT} from '../src/theme-engine.js';

test('existing themes keep a fully opaque card (100%) and store nothing new',()=>{
 const t=themeNormalize(themeDefault());
 assert.equal(THEME_CARD_ALPHA_DEFAULT,100);assert.equal('cardAlpha' in t,false);
 assert.equal(themeCssVariables(t)['--theme-card-alpha'],'1');
 assert.equal('cardAlpha' in themeNormalize({...themeDefault(),cardAlpha:100}),false);
});

test('card transparency is an independent 0–100 setting that also works without a card image',()=>{
 for(const [input,stored,css] of [[75,75,'0.75'],[50,50,'0.5'],[25,25,'0.25'],[0,0,'0'],[-5,0,'0'],[140,undefined,'1'],['abc',undefined,'1']]){
  const t=themeNormalize({...themeDefault(),cardAlpha:input});
  assert.equal(t.cardAlpha,stored);assert.equal(themeCssVariables(t)['--theme-card-alpha'],css);
  assert.equal(t.images.card,undefined,'no card image needed');
 }
 const withImage=themeNormalize({...themeDefault(),cardAlpha:40,images:{card:{url:'https://x.supabase.co/storage/v1/object/public/papa-photos/themes/s/papa/'+'a'.repeat(64)+'.webp',opacity:70,mask:20}}});
 assert.equal(withImage.cardAlpha,40);assert.equal(withImage.images.card.opacity,70);assert.equal(withImage.images.card.mask,20);
});

test('validation keeps the value through save, mode switches and gradient presets',()=>{
 const saved=themeValidate({...themeDefault(),cardAlpha:35});assert.equal(saved.cardAlpha,35);
 assert.equal(themeNormalize({...saved,mode:'light'}).cardAlpha,35);
 assert.equal(themeNormalize(JSON.parse(JSON.stringify(saved))).cardAlpha,35);
});

test('only the card background layer fades; card content is never given opacity',()=>{
 const css=fs.readFileSync(new URL('../src/theme-v2.css',import.meta.url),'utf8');
 assert.match(css,/\[data-theme-card-alpha\] \.card::before\{[^}]*background:var\(--theme-card-fill\);opacity:var\(--theme-card-alpha,1\);z-index:-1/);
 assert.doesNotMatch(css,/\.card\{[^}]*opacity:var\(--theme-card-alpha/);
 const render=fs.readFileSync(new URL('../src/theme-render.js',import.meta.url),'utf8');
 assert.match(render,/root\.dataset\.themeCardAlpha=''/);assert.match(render,/delete root\.dataset\.themeCardAlpha/);
});

test('decorations follow the streamer theme on every page except platform management',()=>{
 const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8'),line=app.split(/\r?\n/).find(l=>l.startsWith('function syncThemeDecor('));
 assert.match(line,/theme&&!managementPage\(\)\?themeDecorHtml/);
 assert.doesNotMatch(line,/home&&theme\?themeDecorHtml/);
 assert.match(line,/querySelectorAll\(':scope>\.theme-decor-layer'\)\.forEach\(el=>el\.remove\(\)\)/,'old layers are removed before each render');
 assert.match(line,/themeDecorMotion\(document,html\?theme:null/,'motion is replaced, never stacked');
});
