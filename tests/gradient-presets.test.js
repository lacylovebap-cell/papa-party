import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {
 THEME_GRADIENTS,THEME_GRADIENT_DESIGNS,THEME_COLOR_KEYS,
 themeGradientPalette,themeNormalize,themeValidate,themeContrast,
 themeCssVariables,themeGradientFill,themePageLayer
} from '../src/theme-engine.js';

const source=path=>readFileSync(resolve(fileURLToPath(new URL('.',import.meta.url)),'../',path),'utf8');
const paletteRatios=c=>({
 title:themeContrast(c.title,c.panel),
 text:themeContrast(c.text,c.panel),
 background:themeContrast(c.text,c.background),
 button:Math.min(themeContrast(c.buttonText,c.button),themeContrast(c.buttonText,c.button2)),
 accent:themeContrast(c.accent,c.panel)
});

test('all 30 gradients are complete palettes, not background-only images',()=>{
 assert.equal(THEME_GRADIENTS.length,30);
 assert.equal(Object.keys(THEME_GRADIENT_DESIGNS).length,30);
 assert.equal(new Set(THEME_GRADIENTS.map(g=>g.id)).size,30);
 for(const preset of THEME_GRADIENTS){
  const design=THEME_GRADIENT_DESIGNS[preset.id];
  assert.ok(design?.mode==='light'||design?.mode==='dark',preset.id);
  const initial=themeGradientPalette(preset.id);
  assert.equal(initial.mode,design.mode);
  for(const mode of ['light','dark']){
   const p=themeGradientPalette(preset.id,mode);
   assert.equal(p.mode,mode);
   assert.deepEqual(Object.keys(p.colors).sort(),[...THEME_COLOR_KEYS].sort(),preset.id);
   const t=themeValidate(themeNormalize({gradient:preset.id,...p}));
   assert.equal(t.gradient,preset.id);
   assert.ok(themeGradientFill(t).startsWith('linear-gradient('),preset.id);
   const variables=themeCssVariables(t);
   assert.equal(variables['--home-panel'],p.colors.panel);
   assert.equal(variables['--theme-nav'],p.colors.nav);
   assert.equal(variables['--theme-button-solid'],p.colors.button);
   for(const [surface,ratio] of Object.entries(paletteRatios(t.colors)))
    assert.ok(ratio>=(surface==='accent'?3:4.5),preset.id+'/'+mode+'/'+surface+' '+ratio);
  }
 }
});

test('a theme keeps user overrides, and mode switching supports recomputing non-manual colours',()=>{
 for(const preset of THEME_GRADIENTS){
  const dark=themeGradientPalette(preset.id,'dark');
  const changed=themeNormalize({gradient:preset.id,...dark,colors:{...dark.colors,panel:'#123456'},manual:['panel']});
  assert.equal(changed.colors.panel,'#123456');
  assert.deepEqual(changed.manual,['panel']);
  const light=themeGradientPalette(preset.id,'light');
  const switched=themeNormalize({...changed,mode:'light',colors:{...light.colors,panel:changed.colors.panel}});
  assert.equal(switched.colors.panel,'#123456');
  assert.equal(switched.mode,'light');
 }
});

test('uploaded background images remain visible with a gradient theme',()=>{
 const image='https://db.example.co/storage/v1/object/public/papa-photos/themes/s/papa/'+('a'.repeat(64))+'.webp';
 const preset=themeGradientPalette('violet-dream');
 const t=themeNormalize({...preset,gradient:'violet-dream',images:{background:{url:image}}});
 const layer=themePageLayer(t);
 assert.match(layer,/url\(/);
 assert.match(layer,/linear-gradient\(/);
 assert.ok(layer.includes(image));
});

test('studio uses one main-colour preset area, and medals replay with compact ▶ only',()=>{
 const studio=source('src/theme-studio.js');
 assert.match(studio,/data-gradient-toggle/);
 assert.match(studio,/data-gradient-choice/);
 assert.match(studio,/themeGradientPalette\(el\.dataset\.gradientChoice\)/);
 assert.doesNotMatch(studio,/背景漸層（選用）/);
 const medals=source('src/achievements-view.js');
 assert.match(medals,/data-medal-replay/);
 assert.match(medals,/▶<\/button>/);
 assert.doesNotMatch(medals,/>重播動畫<\/button>/);
 const css=source('src/theme.css');
 assert.match(css,/\.medal-row \.medal-replay\{right:41px/);
 assert.match(css,/block-size:28px!important/);
 // Card content starts below the icon row so ▶ / ! never cover the medal icon.
 assert.match(css,/\.medal-row\{position:relative;padding-top:40px\}/);
});

test('medal and theme modules load one consistent version (no stale duplicate instances)',()=>{
 for(const file of ['src/app.js','src/medal-management.js','src/medal-evidence.js','app.html','v2.html','lobby.html','preview.html'])
  assert.doesNotMatch(source(file),/(achievements-view|medal-management|medal-evidence|theme-engine|theme-render|theme-studio|theme-image)\.js\?v=10\.29-THEME\.1|theme\.css\?v=10\.29-THEME\.1/,file);
});
