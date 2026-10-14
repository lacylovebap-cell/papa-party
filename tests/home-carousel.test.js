import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const controller=app.slice(app.indexOf('let photoCarouselTimer='),app.indexOf('function fateResultHtml('));
const eventStart=app.indexOf("document.addEventListener('play',");
const events=app.slice(eventStart,app.indexOf('\nsyncPhotoCarousel();',eventStart));

function fixture(slides=['image','video','image']){
 let now=0,next=0,node,modal=null;const timers=new Map(),listeners=new Map();
 const document={hidden:false,addEventListener(type,listener){const rows=listeners.get(type)||[];rows.push(listener);listeners.set(type,rows);}};
 const context=vm.createContext({document,route:'home',photoIndex:0,$:selector=>selector==='#photo-carousel'?node:null,
  setTimeout(fn,delay){const id=++next;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),
  queueMicrotask:fn=>fn(),syncRecovery:{flushRender(){},resume(){}},photoCarousel:()=>slides[(context.photoIndex+slides.length)%slides.length]});
 const fire=(type,target)=>{for(const listener of listeners.get(type)||[])listener({target,type});};
 const video=(where='inline')=>({tagName:'VIDEO',dataset:where==='modal'?{homeCardVideo:'1'}:{},isConnected:true,paused:true,ended:false,error:null,
  closest(selector){return selector==='#photo-carousel'&&where==='inline'?node:selector==='#dialog'&&where==='modal'?modal:null;},
  pause(){if(!this.paused){this.paused=true;if(this.isConnected)fire('pause',this);}}});
 const photo=()=>({dataset:{carouselCard:'card-'+(context.photoIndex%slides.length)}});
 const mount=()=>{if(node?.video)node.video.isConnected=false;node={video:slides[context.photoIndex]==='video'?video():null,photo:photo(),
  querySelector(selector){return selector==='video'?this.video:selector==='.photo'?this.photo:null;},
  set innerHTML(kind){if(this.video)this.video.isConnected=false;this.video=kind==='video'?video():null;this.photo=photo();}};};
 mount();vm.runInContext(controller+'\n'+events,context);
 const sync=restart=>context.syncPhotoCarousel(restart);
 const advance=ms=>{const end=now+ms;while(true){const due=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;timers.delete(due[0]);now=due[1].at;due[1].fn();}now=end;};
 return {context,document,timers,fire,sync,advance,get video(){return node.video;},get index(){return context.photoIndex;},
  manual(index){context.photoIndex=index;node.innerHTML=context.photoCarousel();sync(true);},
  rerender(){mount();sync();},
  popup(){modal={open:true};return video('modal');},close(){modal.open=false;fire('close',modal);}};
}

test('home images stay eight seconds and videos eleven seconds with one timer',()=>{
 const f=fixture();f.sync();for(let i=0;i<10;i++)f.sync();assert.equal(f.timers.size,1);
 f.advance(7999);assert.equal(f.index,0);f.advance(1);assert.equal(f.index,1);
 f.advance(10999);assert.equal(f.index,1);f.advance(1);assert.equal(f.index,2);
 f.advance(8000);assert.equal(f.index,3);assert.equal(f.timers.size,1);
});

test('play stops rotation immediately; manual pause stays held; ending resumes once',()=>{
 const f=fixture(['video','image']);f.sync();const v=f.video;v.paused=false;f.fire('play',v);
 assert.equal(f.timers.size,0);f.advance(60000);assert.equal(f.index,0);
 v.pause();assert.equal(v.dataset.cardPlaying,'1','background renders must preserve the paused home video');
 f.advance(60000);assert.equal(f.index,0);assert.equal(f.timers.size,0);
 v.paused=false;f.fire('play',v);v.ended=true;v.paused=true;f.fire('pause',v);f.fire('ended',v);
 assert.equal(f.timers.size,1);assert.equal(v.dataset.cardPlaying,undefined);
 f.advance(11000);assert.equal(f.index,1);assert.equal(f.timers.size,1);
});

test('native playback starts before the play event cannot race a due slide change',()=>{
 const f=fixture(['video','image']);f.sync();f.advance(10999);f.video.paused=false;
 f.advance(1);assert.equal(f.index,0);assert.equal(f.timers.size,0);
});

test('ordinary home rerenders keep the remaining dwell time instead of stalling a slide',()=>{
 const f=fixture();f.sync();f.advance(7000);f.rerender();f.rerender();
 assert.equal(f.timers.size,1);f.advance(1000);assert.equal(f.index,1);
});

test('closing a home video popup, manual navigation and source exit release the hold',()=>{
 const f=fixture(['video','image']);f.sync();const popup=f.popup();popup.paused=false;f.fire('play',popup);
 popup.pause();assert.equal(f.timers.size,0);f.close();assert.equal(f.timers.size,1);assert.equal(popup.dataset.cardPlaying,undefined);
 f.video.paused=false;f.fire('play',f.video);f.manual(1);assert.equal(f.timers.size,1);
 f.advance(8000);assert.equal(f.index,2);
 const v=f.video;v.paused=false;f.fire('play',v);v.paused=true;f.fire('emptied',v);
 assert.equal(f.timers.size,1);assert.equal(v.dataset.cardPlaying,undefined);
});

test('hidden pages, removed carousel nodes and other-page videos do not cause duplicate timers',()=>{
 const f=fixture(['video','image']);f.sync();f.rerender();f.rerender();assert.equal(f.timers.size,1);
 f.document.hidden=true;f.sync();assert.equal(f.timers.size,0);f.advance(50000);assert.equal(f.index,0);
 f.document.hidden=false;f.sync();assert.equal(f.timers.size,1);
 const unrelated={tagName:'VIDEO',dataset:{},paused:false,ended:false,closest:()=>null};
 f.fire('play',unrelated);f.fire('pause',unrelated);assert.equal(f.timers.size,1);assert.equal(unrelated.dataset.cardPlaying,undefined);
 f.context.route='gallery';f.sync();assert.equal(f.timers.size,0);f.advance(50000);assert.equal(f.index,0);
 f.context.route='home';f.sync();assert.equal(f.timers.size,1);
});

test('only the home heading changes; gallery media markup and no-query timing stay unchanged',()=>{
 assert.match(app,/const cards=card\('🖼️ 展示牆'/);
 assert.match(app,/function renderGallery\(\).*card\('🖼️ 卡片牆'/);
 assert.doesNotMatch(controller,/api\(|fetch\(|setInterval\(/);
 assert.match(app,/renderNoticeLanding\(landing\);syncPhotoCarousel\(\)/);
});
