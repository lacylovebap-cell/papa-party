// /support 平台營運支持頁。資料一律來自後端；後端還沒資料就顯示 0。
import {API,PUBLISHABLE_KEY} from './config.js?v=11.15-SUPPORT.1';
import {SUPPORT_PRESETS,supportSummary,orderDraft,validAmount,formatNT} from './support-rules.js?v=11.15-SUPPORT.1';

const $=sel=>document.querySelector(sel);
const state={summary:supportSummary(null),amount:SUPPORT_PRESETS[1],custom:'',anonymous:false,nickname:'',busy:false};

async function call(op,body={}){
 const res=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json',apikey:PUBLISHABLE_KEY,Authorization:'Bearer '+PUBLISHABLE_KEY},body:JSON.stringify({op,...body})});
 const data=await res.json().catch(()=>null);
 if(!res.ok||data?.error)throw Error(data?.error||'連線失敗');
 return data;
}

function renderGoal(){
 const s=state.summary;
 $('#support-bar>span').style.width=s.percent+'%';
 $('#support-progress').setAttribute('aria-valuenow',String(s.percent));
 const figures={goal:s.goal,received:s.received,percent:s.percent,expenses:s.expenses,remaining:s.remaining};
 for(const [key,value] of Object.entries(figures)){
  const node=$('[data-figure='+key+']');
  if(node)node.textContent=key==='percent'?s.percent+'%':formatNT(value);
 }
 const ledger={lreceived:s.received,lfees:s.fees,lusable:s.usable,lexpenses:s.expenses,lremaining:s.remaining};
 for(const [key,value] of Object.entries(ledger)){
  const node=$('[data-figure='+key+']');
  if(node)node.textContent=formatNT(value);
 }
 const month=$('#support-month');
 if(month)month.textContent=s.month?s.month.replace('-','年')+'月':'本月';
}

function renderAmounts(){
 for(const button of document.querySelectorAll('[data-preset]')){
  const value=Number(button.dataset.preset);
  button.setAttribute('aria-pressed',String(!state.custom&&state.amount===value));
 }
 const custom=$('#support-custom-input');
 if(custom&&custom.value!==state.custom)custom.value=state.custom;
 $('#support-nickname').hidden=state.anonymous;
 const submit=$('#support-submit');
 const chosen=state.custom?validAmount(state.custom,state.summary.limits):state.amount;
 const live=state.summary.gatewayLive;
 submit.disabled=state.busy||!live||chosen===null;
 submit.textContent=live
  ?(chosen===null?'請先選擇金額':'前往付款　'+formatNT(chosen))
  :'金流審核中，尚未開放付款';
 const status=$('#support-status');
 if(!live){
  status.dataset.tone='plain';
  status.textContent='付款功能尚在金流商審核階段，目前無法完成交易。金額與匿名設定可以先預覽，審核通過後才會開放收款。';
 }else if(state.custom&&chosen===null){
  status.dataset.tone='gold';
  status.textContent='金額需為 NT$'+state.summary.limits.min+' 至 NT$'+state.summary.limits.max+' 之間的整數。';
 }else{
  status.dataset.tone='plain';status.textContent='';
 }
}

function render(){renderGoal();renderAmounts();}

function bind(){
 document.addEventListener('click',event=>{
  const preset=event.target.closest?.('[data-preset]');
  if(preset){state.amount=Number(preset.dataset.preset);state.custom='';renderAmounts();}
 });
 $('#support-custom-input').addEventListener('input',event=>{
  state.custom=event.target.value.trim();renderAmounts();
 });
 $('#support-anon').addEventListener('change',event=>{
  state.anonymous=event.target.checked;renderAmounts();
 });
 $('#support-nickname-input').addEventListener('input',event=>{
  state.nickname=event.target.value;
 });
 $('#support-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!state.summary.gatewayLive)return;
  const draft=orderDraft({amount:state.custom||state.amount,anonymous:state.anonymous,nickname:state.nickname},state.summary.limits);
  if(!draft.ok){$('#support-status').dataset.tone='gold';$('#support-status').textContent=draft.reason;return;}
  state.busy=true;renderAmounts();
  try{
   const order=await call('supportOrderCreate',draft);
   if(typeof order?.paymentUrl==='string'&&/^https:\/\//.test(order.paymentUrl))location.href=order.paymentUrl;
   else throw Error('付款連結尚未建立');
  }catch(error){
   $('#support-status').dataset.tone='gold';
   $('#support-status').textContent=String(error.message||error);
  }finally{state.busy=false;renderAmounts();}
 });
}

async function load(){
 try{state.summary=supportSummary(await call('supportPublic'));}
 catch{/* 後端尚未提供時維持全 0，不顯示假資料 */}
 render();
}

bind();render();load();
