// PA Party theme engine (pure, no DOM, no network).
// Shared by the browser editor, page renderer and the Edge reducer bundle, so
// every top-level name is prefixed to avoid clashes inside the Edge bundle.
// A theme is one compact JSON object. Images are stored as Storage paths only;
// opacity, focus and masks are numbers rendered by CSS, never baked into files.

export const THEME_VERSION=1;
export const THEME_COLOR_KEYS=['background','nav','logo','panel','line','button','button2','buttonText','title','text','accent'];
export const THEME_COLOR_LABELS={background:'頁面底色',nav:'頂部導覽列',logo:'Logo 區底色',panel:'卡片底色',line:'邊框顏色',button:'按鈕主色',button2:'按鈕漸層第二色',buttonText:'按鈕文字',title:'標題文字',text:'一般說明文字',accent:'強調色'};
export const THEME_TEMPLATES=[
 {id:'violet-night',name:'紫夜',base:'#8b5cf6',mode:'dark'},
 {id:'peach',name:'蜜桃',base:'#ff8a7a',mode:'light'},
 {id:'mint',name:'薄荷',base:'#2fbf8f',mode:'light'},
 {id:'star-blue',name:'星藍',base:'#3b82f6',mode:'dark'},
 {id:'milk-tea',name:'奶茶',base:'#b98b62',mode:'light'}
];
// Thirty coordinated gradients: the editor applies a whole palette, not just a background image.
export const THEME_GRADIENTS=[
 {"id":"violet-dream","name":"紫藤夢境","colors":["#7546b8","#b16fb9","#df9cae"]},
 {"id":"lavender-moon","name":"薰衣草月光","colors":["#494b86","#9983c4","#d0b5d9"]},
 {"id":"rose-mist","name":"玫瑰薄霧","colors":["#a14a6c","#d08c9d","#efc6b7"]},
 {"id":"peach-cloud","name":"蜜桃雲朵","colors":["#ef947f","#f4c6ac","#e8c4dc"]},
 {"id":"sakura","name":"櫻花奶霜","colors":["#d98ba6","#f1c7d5","#f5dfca"]},
 {"id":"berry","name":"莓果微醺","colors":["#6c284f","#a84e75","#d597a2"]},
 {"id":"midnight","name":"午夜星河","colors":["#142951","#493c82","#926b9c"]},
 {"id":"blue-hour","name":"藍調時刻","colors":["#173b62","#396a9c","#7b9ab6"]},
 {"id":"aurora","name":"極光漫遊","colors":["#164e54","#477794","#8764a4"]},
 {"id":"ocean","name":"深海珍珠","colors":["#124454","#318c94","#a1c7bc"]},
 {"id":"glacier","name":"冰川晨曦","colors":["#547e9c","#9bc1ce","#d3dfde"]},
 {"id":"rain","name":"雨後天空","colors":["#507b92","#92b6ba","#d0d6c1"]},
 {"id":"mint","name":"薄荷森林","colors":["#296b59","#70a68c","#c5d5ad"]},
 {"id":"jade","name":"翡翠湖畔","colors":["#185d55","#3a8f7c","#9ac0a3"]},
 {"id":"moss","name":"苔蘚微光","colors":["#4c674b","#8b9c69","#c9c39a"]},
 {"id":"spring","name":"春日茶園","colors":["#6a8d55","#b0bc86","#e1d7ad"]},
 {"id":"matcha","name":"抹茶奶綠","colors":["#7d9067","#b7bf96","#e5ddbd"]},
 {"id":"olive","name":"橄欖暮色","colors":["#4e5944","#8d895c","#c6ad7f"]},
 {"id":"sunset","name":"夕陽橘光","colors":["#b75a53","#e99868","#f2c481"]},
 {"id":"apricot","name":"杏桃奶油","colors":["#d49b6f","#efc79c","#f2e0b9"]},
 {"id":"coral","name":"珊瑚海岸","colors":["#cc777d","#dfab94","#9dbfb6"]},
 {"id":"honey","name":"蜂蜜琥珀","colors":["#946337","#c99958","#e9cc8c"]},
 {"id":"maple","name":"楓葉午後","colors":["#864d43","#b97b56","#d5ac7c"]},
 {"id":"sand","name":"沙丘暖陽","colors":["#a18469","#c7ad8e","#e2cfb0"]},
 {"id":"tea","name":"奶茶絲絨","colors":["#897064","#b59a8b","#d9c6b7"]},
 {"id":"cocoa","name":"可可摩卡","colors":["#4d3c3b","#856962","#b89b85"]},
 {"id":"champagne","name":"香檳玫瑰","colors":["#ad8d86","#d0b7a0","#e7d9bd"]},
 {"id":"pearl","name":"珍珠霧灰","colors":["#77808b","#abb1ba","#d4cbd5"]},
 {"id":"obsidian","name":"黑曜流光","colors":["#242733","#49485d","#786779"]},
 {"id":"neon","name":"霓虹夜遊","colors":["#343175","#854782","#bd6d8f"]}
];
/* Curated theme recipes. Each gradient has its own button pair and accent.
   The existing eleven theme colour keys remain unchanged, so saved themes,
   Cloud's editor, drafts, hall themes and API validation stay compatible. */
export const THEME_GRADIENT_DESIGNS=Object.freeze(Object.fromEntries([
 ["violet-dream","dark","#9a6bce","#9659c7","#d78bac","#e6b7e9"],
 ["lavender-moon","dark","#8989c8","#6764b3","#bb8bcb","#d7c5ff"],
 ["rose-mist","light","#b95178","#a43e69","#d7778c","#972d5d"],
 ["peach-cloud","light","#e5876e","#be625d","#ed9c76","#9b4a44"],
 ["sakura","light","#cc7e9e","#b45b86","#df91aa","#a04276"],
 ["berry","dark","#a64e75","#a0467f","#dd78a2","#f6acd2"],
 ["midnight","dark","#4c4ca5","#424ba5","#8274c2","#b4b9ff"],
 ["blue-hour","dark","#4776a8","#376baf","#699bc8","#b7d6ff"],
 ["aurora","dark","#368e91","#248f88","#6b77b8","#99ede5"],
 ["ocean","dark","#318c94","#247e87","#64b2ac","#9df3e8"],
 ["glacier","light","#6dabc6","#347c9e","#69a4bd","#2c6d89"],
 ["rain","light","#7f9fb2","#497d94","#86aab7","#346c80"],
 ["mint","light","#65a68a","#287f70","#74ad8d","#236958"],
 ["jade","dark","#2c8f7b","#217d6d","#58a99b","#a3edcf"],
 ["moss","dark","#80996b","#62824e","#aab47e","#cce3b1"],
 ["spring","light","#91ae67","#63894d","#a2b874","#4f7440"],
 ["matcha","light","#9da86f","#74824d","#a9b982","#617044"],
 ["olive","dark","#8c926a","#747c4c","#b1a16a","#d2dbaa"],
 ["sunset","dark","#dc7858","#bc514b","#f09c66","#ffd0a7"],
 ["apricot","light","#d8a26f","#a66e4c","#d99e65","#925834"],
 ["coral","light","#d1847f","#af5b70","#e1a47e","#935361"],
 ["honey","dark","#c99958","#ab732c","#dca65c","#ffda92"],
 ["maple","dark","#ae7453","#944d44","#c1875c","#f5b68c"],
 ["sand","light","#b99a7a","#8e6c4f","#bd9673","#74563e"],
 ["tea","light","#b59a8b","#977269","#c4a08d","#77564c"],
 ["cocoa","dark","#906b64","#94625e","#b49378","#eac4b6"],
 ["champagne","light","#c2a18a","#9b746c","#caa896","#87645f"],
 ["pearl","light","#a0a7b5","#66788e","#a8a2c4","#55667b"],
 ["obsidian","dark","#737188","#595575","#8f7897","#d3c7dc"],
 ["neon","dark","#854782","#7d48ba","#d16ba3","#f1a1df"]
].map(([id,mode,base,button,button2,accent])=>[id,{mode,base,button,button2,accent}])));

export function themeGradientPalette(id,requestedMode){
 const preset=THEME_GRADIENTS.find(x=>x.id===id),design=THEME_GRADIENT_DESIGNS[id];
 if(!preset||!design)return null;
 const mode=requestedMode==='dark'||requestedMode==='light'?requestedMode:design.mode;
 const dark=mode==='dark',original=themeSmartPalette(design.base,mode),p={...original};
 // Individually curated stops softly tint the UI surfaces, not just the page.
 p.background=themeMix(original.background,preset.colors[0],dark?.14:.075);
 p.nav=themeMix(original.nav,preset.colors[1],dark?.08:.045);
 p.logo=themeMix(original.logo,preset.colors[0],dark?.12:.05);
 p.panel=themeMix(original.panel,preset.colors[2],dark?.10:.05);
 p.line=themeMix(original.line,preset.colors[1],dark?.35:.24);
 Object.assign(p,themeFitButtons(design.button,design.button2));
 p.accent=themeEnsureContrast(design.accent,p.panel,3);
 p.title=themeEnsureContrast(themeEnsureContrast(original.title,p.panel,7),p.background,7);
 p.text=themeEnsureContrast(themeEnsureContrast(original.text,p.panel,4.5),p.background,4.5);
 return {base:design.base,mode,colors:p};
}

export function themeGradientColors(theme){
 const t=themeNormalize(theme),preset=THEME_GRADIENTS.find(p=>p.id===t.gradient);
 if(!preset)return [];
 // Blend into the existing background to preserve the chosen dark/light palette.
 return preset.colors.map(color=>{
  let amount=t.mode==='light'?.28:.43;
  const readable=bg=>['text','title'].every(k=>themeContrast(t.colors[k],bg)>=4.5);
  while(amount>0&&!readable(themeMix(t.colors.background,color,amount)))amount=Math.max(0,amount-.01);
  return themeMix(t.colors.background,color,amount);
 });
}
export function themeGradientFill(theme){
 const colors=themeGradientColors(theme);
 return colors.length?`linear-gradient(135deg,${colors.join(',')})`:'';
}
export const THEME_SWATCHES=['#ff0000','#ff4d8d','#ff8a7a','#f59e0b','#facc15','#84cc16','#2fbf8f','#14b8a6','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#a855f7','#d946ef','#b98b62','#64748b'];
// Recommended source sizes and compression targets per image role.
export const THEME_IMAGE_ROLES={
 background:{label:'整頁背景圖片',max:2000,targetKB:350,source:'2000 × 2000 px'},
 banner:{label:'首頁橫幅',max:1600,targetKB:300,source:'1600 × 800 px'},
 card:{label:'統一卡片底圖',max:1200,targetKB:200,source:'1200 × 800 px'},
 decor:{label:'裝飾圖片',max:800,targetKB:150,source:'800 × 800 px'}
};
export const THEME_DECOR_LIMIT=6;
// How a decoration moves. All of them run in the browser only: no extra
// download, no database write while scrolling or tapping.
export const THEME_DECOR_MOTIONS={none:'不動',fixed:'固定在螢幕上',follow:'捲動時慢慢跟上',tap:'點擊位置冒出來',float:'原地輕輕浮動'};
export const THEME_MAX_BYTES=8192;
const themeHexPattern=/^#[0-9a-f]{6}$/i;
// Only the platform's own content-addressed theme objects are accepted.
const themeAssetPattern=/^https:\/\/[a-z0-9.-]+\/storage\/v1\/object\/public\/papa-photos\/themes\/(s|h)\/([A-Za-z0-9_-]{1,200})\/([a-f0-9]{64})\.webp$/;
// The hall card default (22%) matches how the hall page already shows streamer images.
// Thin line above the hourly quota inside the homepage banner. No colour means
// it follows the border colour; length is a percentage of the text column.
export const THEME_DIVIDER_DEFAULTS={length:100,thickness:1,opacity:55};
const themeDividerRanges={length:[0,100],thickness:[1,6],opacity:[0,100]};
export const THEME_IMAGE_DEFAULTS={
 background:{x:50,y:50,opacity:100,mask:35},
 banner:{x:60,y:35,opacity:100,mask:85,maskWidth:45,maskPosition:20,maskFeather:55,hallX:50,hallY:35,hallOpacity:22},
 card:{x:50,y:50,opacity:100,mask:65}
};
const themeImageRanges={x:[0,100],y:[0,100],opacity:[0,100],mask:[0,95],maskWidth:[0,100],maskPosition:[0,100],maskFeather:[0,100],hallX:[0,100],hallY:[0,100],hallOpacity:[0,100]};

// ---------- colour maths ----------
export function themeRgb(hex){const v=String(hex).replace('#','');return [0,2,4].map(i=>parseInt(v.slice(i,i+2),16));}
export function themeHex(rgb){return '#'+rgb.map(n=>Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,'0')).join('');}
export function themeHsl(hex){
 const [r,g,b]=themeRgb(hex).map(n=>n/255),max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;
 if(max===min)return [0,0,l];
 const d=max-min,s=l>.5?d/(2-max-min):d/(max+min);
 const h=max===r?((g-b)/d+(g<b?6:0)):max===g?((b-r)/d+2):((r-g)/d+4);
 return [h*60,s,l];
}
export function themeFromHsl(h,s,l){
 h=((h%360)+360)%360;s=Math.max(0,Math.min(1,s));l=Math.max(0,Math.min(1,l));
 const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;
 const [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
 return themeHex([(r+m)*255,(g+m)*255,(b+m)*255]);
}
export function themeLuminance(hex){return themeRgb(hex).map(n=>{n/=255;return n<=.03928?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);}
export function themeContrast(a,b){const x=themeLuminance(a),y=themeLuminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
// Moves only the lightness of fg until it reaches the target contrast on bg.
export function themeEnsureContrast(fg,bg,target){
 if(themeContrast(fg,bg)>=target)return fg;
 const [h,s,l]=themeHsl(fg),lighter=themeLuminance(bg)<.4;
 for(let step=1;step<=40;step++){const next=themeFromHsl(h,s,lighter?Math.min(1,l+step*.025):Math.max(0,l-step*.025));if(themeContrast(next,bg)>=target)return next;}
 return lighter?'#ffffff':'#111111';
}
export function themeMix(hex,over,amount){const a=themeRgb(hex),b=themeRgb(over);return themeHex(a.map((n,i)=>n*(1-amount)+b[i]*amount));}
export function themeShade(hex,delta){const [h,s,l]=themeHsl(hex);return themeFromHsl(h,s,l+delta);}
export function themeAlpha(hex,alpha){const [r,g,b]=themeRgb(hex);return `rgba(${r},${g},${b},${Math.max(0,Math.min(1,alpha)).toFixed(3).replace(/\.?0+$/,'')||'0'})`;}

// ---------- smart palette ----------
const themePaletteCache=new Map();
export function themeSmartPalette(base,mode='dark'){
 const color=themeHexPattern.test(base||'')?base.toLowerCase():'#8b5cf6',key=color+mode;
 if(themePaletteCache.has(key))return {...themePaletteCache.get(key)};
 const [h,rawS,rawL]=themeHsl(color),s=rawS<.08?0:Math.max(.45,rawS),tint=rawS<.08?0:1,keepL=Math.max(.32,Math.min(.68,rawL)),bs=rawS<.08?0:rawS;
 let p;
 if(mode==='light'){
  p={background:themeFromHsl(h,.55*tint,.965),nav:themeFromHsl(h,.5*tint,.985),logo:themeFromHsl(h,.4*tint,.15),panel:themeFromHsl(h,.6*tint,.995),line:themeFromHsl(h,.35*tint,.84),
   button:themeFromHsl(h,bs,keepL),button2:themeFromHsl(h+24,bs,Math.min(.78,keepL+.06)),accent:themeFromHsl(h,Math.max(.6,s)*tint,.4),title:themeFromHsl(h,.45*tint,.15),text:themeFromHsl(h,.15*tint,.33)};
 }else{
  p={background:themeFromHsl(h,.35*tint,.07),nav:themeFromHsl(h,.35*tint,.085),logo:themeFromHsl(h,.4*tint,.13),panel:themeFromHsl(h,.3*tint,.12),line:themeFromHsl(h,.35*tint,.27),
   button:themeFromHsl(h,bs,keepL),button2:themeFromHsl(h+24,bs,Math.min(.78,keepL+.06)),accent:themeFromHsl(h,Math.max(.55,s)*tint,.74),title:themeFromHsl(h,.45*tint,.95),text:themeFromHsl(h,.18*tint,.8)};
 }
 p.title=themeEnsureContrast(themeEnsureContrast(p.title,p.panel,7),p.background,7);
 p.text=themeEnsureContrast(themeEnsureContrast(p.text,p.panel,4.5),p.background,4.5);
 p.accent=themeEnsureContrast(p.accent,p.panel,3);
 Object.assign(p,themeFitButtons(p.button,p.button2));
 themePaletteCache.set(key,p);if(themePaletteCache.size>64)themePaletteCache.delete(themePaletteCache.keys().next().value);
 return {...p};
}
// Picks white or dark button text, nudging the button pair the fewest steps
// (darker for white text, lighter for dark text) until both ends reach 4.5:1.
export function themeFitButtons(button,button2){
 let best=null;
 for(const [text,delta] of [['#ffffff',-.02],['#17121f',.02]]){
  let a=button,b=button2,steps=0;
  while(Math.min(themeContrast(text,a),themeContrast(text,b))<4.5&&steps<30){a=themeShade(a,delta);b=themeShade(b,delta);steps++;}
  // White text is the house style; dark text wins only when clearly cheaper.
  if(!best||steps+3<best.steps)best={steps,button:a,button2:b,buttonText:text};
 }
 return {button:best.button,button2:best.button2,buttonText:best.buttonText};
}
// Button text must stay readable on both gradient ends.
export function themeButtonText(button,button2=button){
 const candidates=['#ffffff','#17121f'],score=c=>Math.min(themeContrast(c,button),themeContrast(c,button2));
 return candidates.sort((a,b)=>score(b)-score(a))[0];
}
export function themeContrastReport(theme){
 const c=themeNormalize(theme).colors,rows=[
  ['標題文字／卡片',themeContrast(c.title,c.panel),4.5],['說明文字／卡片',themeContrast(c.text,c.panel),4.5],['說明文字／頁面',themeContrast(c.text,c.background),4.5],
  ['按鈕文字／按鈕',Math.min(themeContrast(c.buttonText,c.button),themeContrast(c.buttonText,c.button2)),4.5],['強調色／卡片',themeContrast(c.accent,c.panel),3]];
 return rows.map(([label,ratio,need])=>({label,ratio:Math.round(ratio*10)/10,ok:ratio>=need,need}));
}

// ---------- schema ----------
export function themeDividerValue(theme){const t=themeNormalize(theme);return {...THEME_DIVIDER_DEFAULTS,...(t.divider||{}),color:t.divider?.color||t.colors.line,follows:!t.divider?.color};}
export function themeDividerVariables(theme){const d=themeDividerValue(theme);return {'--theme-divider-color':themeAlpha(d.color,d.opacity/100),'--theme-divider-length':d.length+'%','--theme-divider-size':d.thickness+'px'};}
export function themeDefault(){return {v:THEME_VERSION,base:'#8b5cf6',mode:'dark',button:'gradient',colors:themeSmartPalette('#8b5cf6','dark'),images:{},decor:[]};}
export function themeAsset(url){const m=typeof url==='string'&&url.length<=600?url.match(themeAssetPattern):null;return m?{kind:m[1],owner:m[2],hash:m[3]}:null;}
const themeNumber=(value,[min,max],fallback)=>{const n=Number(value);return Number.isFinite(n)?Math.round(Math.max(min,Math.min(max,n))):fallback;};
function themeImage(role,input,hall){
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const defaults=THEME_IMAGE_DEFAULTS[role],out={},url=themeAsset(input.url)?input.url:'';
 if(url)out.url=url;
 for(const key of Object.keys(defaults)){if(hall&&key.startsWith('hall'))continue;const v=themeNumber(input[key],themeImageRanges[key],defaults[key]);if(v!==defaults[key])out[key]=v;}
 // Background and card layers exist only with an uploaded image; banner settings
 // also shape the original banner image, so they are kept without a new upload.
 if(!url&&role!=='banner')return null;
 return Object.keys(out).length?out:null;
}
// Lenient: turns anything into a safe, complete-enough theme (defaults omitted).
export function themeNormalize(input,{hall=false}={}){
 const v=input&&typeof input==='object'&&!Array.isArray(input)?input:{},base=themeHexPattern.test(v.base||'')?v.base.toLowerCase():'#8b5cf6',mode=v.mode==='light'?'light':'dark';
 const auto=(v.gradient?themeGradientPalette(v.gradient,mode):null)?.colors||themeSmartPalette(base,mode),colors={};
 for(const key of THEME_COLOR_KEYS)colors[key]=themeHexPattern.test(v.colors?.[key]||'')?v.colors[key].toLowerCase():auto[key];
 const images={};
 for(const role of ['background','banner','card']){const image=themeImage(role,v.images?.[role],hall);if(image)images[role]=image;}
 const decor=(Array.isArray(v.decor)?v.decor:[]).filter(d=>d&&themeAsset(d.url)).slice(0,THEME_DECOR_LIMIT).map(d=>({url:d.url,x:themeNumber(d.x,[0,100],50),y:themeNumber(d.y,[0,100],20),size:themeNumber(d.size,[4,60],18),opacity:themeNumber(d.opacity,[0,100],100),...(Object.hasOwn(THEME_DECOR_MOTIONS,d.motion)&&d.motion!=='none'?{motion:d.motion}:{})}));
 // Colours the user tuned by hand survive a base/mode change until the next one-click palette.
 const manual=[...new Set((Array.isArray(v.manual)?v.manual:[]).filter(k=>THEME_COLOR_KEYS.includes(k)))];
 const divider={},dv=v.divider&&typeof v.divider==='object'&&!Array.isArray(v.divider)?v.divider:{};
 if(themeHexPattern.test(dv.color||''))divider.color=dv.color.toLowerCase();
 for(const [k,range] of Object.entries(themeDividerRanges)){const n=themeNumber(dv[k],range,THEME_DIVIDER_DEFAULTS[k]);if(n!==THEME_DIVIDER_DEFAULTS[k])divider[k]=n;}
 return {...(THEME_GRADIENTS.some(p=>p.id===v.gradient)?{gradient:v.gradient}:{}),v:THEME_VERSION,base,mode,button:v.button==='solid'?'solid':'gradient',colors,images,decor,...(Object.keys(divider).length?{divider}:{}),...(manual.length?{manual}:{})};
}
// Strict, used before any save: rejects malformed input instead of guessing.
export function themeValidate(value,{hall=false,owner=null}={}){
 if(value===null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('主題設定格式不正確');
 if(value.gradient!==undefined&&!THEME_GRADIENTS.some(p=>p.id===value.gradient))throw Error('請選有效的漸層配色');
 if(!themeHexPattern.test(value.base||''))throw Error('請選有效的主色');
 if(value.colors!==undefined&&(!value.colors||typeof value.colors!=='object'||Array.isArray(value.colors)||Object.entries(value.colors).some(([k,c])=>!THEME_COLOR_KEYS.includes(k)||!themeHexPattern.test(c))))throw Error('配色請使用有效的六碼色彩');
 const urls=[...['background','banner','card'].map(r=>value.images?.[r]?.url).filter(Boolean),...(Array.isArray(value.decor)?value.decor.map(d=>d?.url):[])];
 if(Array.isArray(value.decor)&&value.decor.length>THEME_DECOR_LIMIT)throw Error('裝飾圖片最多 '+THEME_DECOR_LIMIT+' 張');
 for(const url of urls){const asset=themeAsset(url);if(!asset)throw Error('圖片尚未上傳完成，請重新選擇圖片');if(asset.kind!==(hall?'h':'s')||owner!==null&&asset.owner!==owner)throw Error('圖片不屬於目前的主播或廳，請重新上傳');}
 const theme=themeNormalize(value,{hall});
 if(JSON.stringify(theme).length>THEME_MAX_BYTES)throw Error('主題設定過大');
 return theme;
}
export function themeImageUrls(theme){if(!theme)return [];const t=themeNormalize(theme);return [...Object.values(t.images).map(i=>i.url).filter(Boolean),...t.decor.map(d=>d.url)];}
export function themeChangedImages(before,after){const a=new Set(themeImageUrls(before)),b=themeImageUrls(after);return b.some(u=>!a.has(u))||a.size!==new Set(b).size;}
export function themeSame(a,b){return JSON.stringify(a?themeNormalize(a):null)===JSON.stringify(b?themeNormalize(b):null);}

// ---------- rendering helpers (strings only) ----------
export function themeImageValue(image,role){return {...THEME_IMAGE_DEFAULTS[role],...(image||{})};}
// Band mask: solid between the band edges, feathered ramps outside them.
export function themeBannerMask(theme,banner){
 const t=themeNormalize(theme),b=themeImageValue(banner??t.images.banner,'banner'),color=t.colors.background,alpha=b.mask/100;
 if(alpha<=0||b.maskWidth<=0)return 'none';
 const half=b.maskWidth/2,ramp=b.maskFeather/100*35,p=b.maskPosition;
 const stops=[[p-half-ramp,0],[p-half,alpha],[p+half,alpha],[p+half+ramp,0]].map(([at,a])=>`${themeAlpha(color,a)} ${Math.round(at*10)/10}%`);
 return `linear-gradient(90deg,${stops.join(',')})`;
}
const themeCssUrl=url=>/^(https:|blob:|data:image\/)/.test(url)&&!/["\\\n\r]/.test(url)?`url("${url}")`:'none';
// One background shorthand that keeps text crisp: image opacity is simulated by
// a translucent panel-coloured veil, so only the picture appears to fade.
export function themeLayeredBackground(color,image,role,urlOverride){
 const img=themeImageValue(image,role),url=urlOverride||img.url;
 if(!url)return color;
 const veil=themeAlpha(color,1-img.opacity/100),layers=[];
 if(img.mask>0)layers.push(`linear-gradient(${themeAlpha(color,img.mask/100)},${themeAlpha(color,img.mask/100)})`);
 if(img.opacity<100)layers.push(`linear-gradient(${veil},${veil})`);
 layers.push(`${themeCssUrl(url)} ${img.x}% ${img.y}%/cover no-repeat`);
 return layers.join(',')+','+color;
}
export function themeButtonFill(theme){const t=themeNormalize(theme);return t.button==='solid'?t.colors.button:`linear-gradient(135deg,${t.colors.button},${t.colors.button2})`;}
// CSS custom properties applied to :root (real pages) or a preview container.
export function themeCssVariables(theme,{resolve=u=>u}={}){
 const t=themeNormalize(theme),c=t.colors,card=t.images.card;
 return {
  '--home-background':c.background,'--home-panel':c.panel,'--home-line':c.line,'--home-button':themeButtonFill(t),'--home-buttonText':c.buttonText,
  '--home-accent':c.accent,'--home-secondary':c.button2,'--home-glow':themeAlpha(c.accent,.14),'--home-text':c.text,'--home-panelText':c.text,
  '--theme-title':c.title,'--theme-nav':c.nav,
  // The logo area stays transparent unless the streamer picked a colour by hand.
  '--theme-logo':(t.manual||[]).includes('logo')?c.logo:'transparent','--theme-button-solid':c.button,'--theme-muted':themeAlpha(c.text,.78),
  // Opaque on purpose: the browser's own dropdown list cannot show a see-through colour
  // and falls back to a light grey, so this is the panel colour pre-darkened by 28%.
  '--theme-input':t.mode==='light'?'#ffffff':themeMix(c.panel,'#000000',.28),'--theme-soft':themeAlpha(c.line,t.mode==='light'?.35:.4),
  // Unselected toggles: a light tint of the chosen button colour on the card colour.
  '--theme-button-soft':themeMix(c.panel,c.button,t.mode==='light'?.16:.3),
  '--theme-card-fill':card?.url?themeLayeredBackground(c.panel,card,'card',resolve(card.url)):c.panel,
  '--theme-banner-mask':themeBannerMask(t),
  ...themeDividerVariables(t),
  '--theme-scheme':t.mode
 };
}
export function themePageLayer(theme,{resolve=u=>u}={}){
 const t=themeNormalize(theme),bg=t.images.background;
 if(t.gradient)return themeGradientFill(t);
 return bg?.url?themeLayeredBackground(t.colors.background,bg,'background',resolve(bg.url)):'';
}
