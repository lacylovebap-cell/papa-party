// Applies a theme to a document root (real pages) or to the preview iframe.
// Pure CSS: colours, image opacity and masks change custom properties only, so
// slider moves never re-request an image or touch the network.
import {themeNormalize,themeCssVariables,themePageLayer,themeImageValue} from './theme-engine.js?v=10.28-UI.2';

const themeVarNames=new Set();
export function themeApply(root,theme,{resolve=u=>u,hall=false}={}){
 if(!root)return;
 if(!theme){themeClear(root);return;}
 const t=themeNormalize(theme,{hall}),vars={...themeCssVariables(t,{resolve}),'--theme-page-layer':themePageLayer(t,{resolve})||'none'};
 root.dataset.themeV2=t.mode;root.dataset.homeTheme='custom';
 for(const [k,v] of Object.entries(vars)){themeVarNames.add(k);if(root.style.getPropertyValue(k)!==v)root.style.setProperty(k,v);}
 const doc=root.ownerDocument,body=doc.body;
 if(!body)return;
 let layer=body.querySelector(':scope>.theme-page-layer');
 // A background image is a separate fixed layer, so it never fades content.
 if(vars['--theme-page-layer']!=='none'){if(!layer){layer=doc.createElement('div');layer.className='theme-page-layer';layer.setAttribute('aria-hidden','true');body.prepend(layer);}}
 else layer?.remove();
}
export function themeClear(root){
 if(!root)return;
 delete root.dataset.themeV2;
 for(const k of themeVarNames)root.style.removeProperty(k);
 root.ownerDocument?.body?.querySelector(':scope>.theme-page-layer')?.remove();
}
// Inline style for a banner <img>: focus and opacity of the shared banner file.
export function themeBannerImageStyle(theme,{hallCard=false}={}){
 if(!theme)return '';
 const b=themeImageValue(themeNormalize(theme).images.banner,'banner');
 return hallCard?`object-position:${b.hallX}% ${b.hallY}%;opacity:${b.hallOpacity/100}`:`object-position:${b.x}% ${b.y}%;opacity:${b.opacity/100}`;
}
export function themeBannerUrl(theme){return theme?themeNormalize(theme).images.banner?.url||'':'';}
// Decorations sit above the content but never take a click or a tap.
// Static and floating ones scroll with the page; "fixed" and "follow" ones live
// in a viewport layer; "tap" ones are not drawn until the viewer taps.
const themeDecorImg=(d,i,resolve,escape,extra='')=>'<img class="theme-decor'+(d.motion==='float'?' theme-decor-float':'')+extra+'" data-decor-index="'+i+'" data-motion="'+(d.motion||'none')+'" alt="" decoding="async" draggable="false" src="'+escape(resolve(d.url))+'" style="left:'+d.x+'%;top:'+d.y+'%;width:'+themeDecorWidth(d)+';opacity:'+d.opacity/100+(d.motion==='float'?';animation-delay:-'+(i*0.7).toFixed(1)+'s':'')+'">';
export const themeDecorWidth=d=>'clamp(36px,'+d.size+'%,'+Math.round(d.size*9)+'px)';
export function themeDecorHtml(theme,{resolve=u=>u,editable=false,escape=v=>String(v)}={}){
 if(!theme)return '';
 const items=themeNormalize(theme).decor;
 if(!items.length)return '';
 const page=[],screen=[],cls=editable?' editable':'';
 items.forEach((d,i)=>{if(d.motion==='tap')return;(d.motion==='fixed'||d.motion==='follow'?screen:page).push(themeDecorImg(d,i,resolve,escape));});
 return (page.length?'<div class="theme-decor-layer'+cls+'" aria-hidden="true">'+page.join('')+'</div>':'')
  +(screen.length?'<div class="theme-decor-layer theme-decor-screen'+cls+'" aria-hidden="true">'+screen.join('')+'</div>':'')
  +(items.some(d=>d.motion==='tap')?'<div class="theme-decor-layer theme-decor-screen theme-decor-taps" aria-hidden="true"></div>':'');
}
// Runs the "follow" and "tap" motions for one document. Calling it again
// replaces the previous run, so re-renders never stack listeners.
export function themeDecorMotion(doc,theme,{resolve=u=>u,host=doc}={}){
 const win=doc.defaultView,prev=win.__themeDecorMotion;if(prev)prev();win.__themeDecorMotion=null;
 const items=theme?themeNormalize(theme).decor:[];
 const follow=[...host.querySelectorAll('.theme-decor[data-motion=follow]')],taps=items.filter(d=>d.motion==='tap'),layer=host.querySelector('.theme-decor-taps');
 if(!follow.length&&!(taps.length&&layer))return ()=>{};
 const reduced=win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 let lastY=win.scrollY,offset=0,frame=0,turn=0;
 const paint=()=>{offset*=.88;if(Math.abs(offset)<.5)offset=0;for(const el of follow)el.style.translate='0 '+offset.toFixed(1)+'px';frame=offset?win.requestAnimationFrame(paint):0;};
 // The page moves under the decoration first, then it eases back into place.
 const onScroll=()=>{const y=win.scrollY;offset=Math.max(-140,Math.min(140,offset-(y-lastY)));lastY=y;if(!frame)frame=win.requestAnimationFrame(paint);};
 const onTap=e=>{
  if(!e.isPrimary||layer.childElementCount>=6)return;
  const d=taps[turn++%taps.length],img=doc.createElement('img');
  img.className='theme-decor theme-decor-pop';img.alt='';img.decoding='async';img.draggable=false;img.src=resolve(d.url);
  img.style.cssText='left:'+e.clientX+'px;top:'+e.clientY+'px;width:'+themeDecorWidth(d)+';--decor-opacity:'+d.opacity/100;
  img.addEventListener('animationend',()=>img.remove(),{once:true});setTimeout(()=>img.remove(),1600);
  layer.append(img);
 };
 if(follow.length&&!reduced)win.addEventListener('scroll',onScroll,{passive:true});
 if(taps.length&&layer&&!reduced){
  win.addEventListener('pointerdown',onTap,{passive:true,capture:true});
  // Warm the browser cache once so the first tap shows at once (same single download).
  for(const d of taps){const im=new win.Image();im.decoding='async';im.src=resolve(d.url);}
 }
 const stop=()=>{win.removeEventListener('scroll',onScroll);win.removeEventListener('pointerdown',onTap,{capture:true});if(frame)win.cancelAnimationFrame(frame);frame=0;for(const el of follow)el.style.translate='';};
 win.__themeDecorMotion=stop;return stop;
}
