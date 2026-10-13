export function checkedPage(value,max=500001){
 const page=Number(value);
 if(!Number.isSafeInteger(page)||page<1||page>max)throw Error('請輸入 1 到 '+max+' 的頁碼');
 return page-1;
}

export function installPageJumps({root=document,onJump,onError=()=>{}}){
 const totalLabel=nav=>{
  const input=nav.querySelector('input[type="number"]'),max=Number(nav.dataset.totalPages||input?.max);
  if(!Number.isSafeInteger(max)||max<1||input?.dataset.unknownPages)return;
  let label=nav.querySelector('.pagination-total-pages');if(!label&&/共\s*\d+\s*頁/.test(nav.textContent))return;
  if(!label){label=document.createElement('small');label.className='pagination-total-pages';nav.insertBefore(label,nav.querySelector('label')||nav.lastElementChild);}
  const text='共 '+max+' 頁';if(label.textContent!==text)label.textContent=text;
 };
 const update=()=>{
  for(const nav of root.querySelectorAll('.pagination')){
   totalLabel(nav);
   if(nav.dataset.jumpReady||nav.querySelector('[data-page-key]'))continue;
   const catalog=nav.querySelector('[data-catalog-page]');
   if(catalog){const button=document.createElement('button');button.type='button';button.textContent='跳頁';button.dataset.remoteJump=catalog.dataset.catalogPage;const label=catalog.closest('label');label.classList.add('page-jump');label.append(button);nav.dataset.jumpReady='true';continue;}
   const previous=nav.querySelector('[data-act]');if(!previous)continue;
   const page=Number(nav.textContent.match(/第\s*(\d+)\s*頁/)?.[1]);if(!page)continue;
   const label=document.createElement('label');label.className='page-jump';label.textContent='頁碼';
   const sizes={favoritesPage:20,listeningPage:20,playersPage:20,playerArchivesPage:20,newPracticePage:20,commonBookPage:12,roomSearchPage:20,entryPage:50,nativePlayerPage:20,crossSummaryPage:20,crossSongPage:20,catalogProposalPage:3};
   const count=nav.textContent.match(/共\s*(\d+)\s*(?:首|位|筆)/),size=sizes[previous.dataset.act]||20;
   const input=document.createElement('input');input.type='number';input.min='1';input.max=String(nav.dataset.totalPages||(count?Math.max(1,Math.ceil(Number(count[1])/size)):Math.floor(10000000/size)+1));if(!nav.dataset.totalPages&&!count)input.dataset.unknownPages='true';input.value=String(page);input.setAttribute('aria-label','跳至頁碼');input.dataset.remotePage=previous.dataset.act;input.dataset.targetId=previous.dataset.id||'';label.append(input);
   const button=document.createElement('button');button.type='button';button.textContent='跳頁';button.dataset.remoteJump=previous.dataset.act;label.append(button);const next=[...nav.querySelectorAll('[data-act]')].find(control=>control!==previous&&control.textContent.includes('下一頁'));if(next)nav.insertBefore(label,next);else nav.append(label);nav.dataset.jumpReady='true';
  }
 };
 const jump=async button=>{try{const nav=button.closest('.pagination'),input=nav.querySelector('[data-remote-page],[data-catalog-page]');if(!input)return;const page=checkedPage(input.value,Number(input.max)||500001);await onJump(button.dataset.remoteJump||input.dataset.remotePage,page,input.dataset.targetId);}catch(error){onError(error.message);}};
 root.addEventListener('click',event=>{const button=event.target.closest('[data-remote-jump]');if(button){event.preventDefault();jump(button);}});
 root.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&event.target.matches('[data-remote-page],[data-catalog-page]')){event.preventDefault();jump(event.target.closest('.pagination').querySelector('[data-remote-jump]'));}});
 const observer=new MutationObserver(update);observer.observe(root.body||root,{childList:true,subtree:true});update();return ()=>observer.disconnect();
}
