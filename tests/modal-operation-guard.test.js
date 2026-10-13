import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8').split(/\r?\n/).find(line=>line.startsWith('function modal('));
function fixture(){
 let form,closed=0;const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;closed++;},set innerHTML(value){const submit={disabled:false,textContent:'儲存'},error={textContent:''};form={note:'保留的輸入',submit,error,querySelector:()=>submit};}};
 const context=vm.createContext({h:x=>x,button:()=>'',FormData:class {},$:s=>s==='#dialog'?dialog:s==='#modal-form'?form:form.error});
 vm.runInContext(code,context);return {modal:(...args)=>context.modal(...args),get form(){return form;},get closed(){return closed;},submit:(target=form)=>target.onsubmit({preventDefault(){},currentTarget:target})};
}
test('generic modal coalesces repeated Enter/click and latches an uncertain operation without erasing inputs',async()=>{
 const f=fixture();let reject,calls=0;f.modal('收歌','',()=>{calls++;return new Promise((_yes,no)=>reject=no);});
 const form=f.form,pending=f.submit();await f.submit();assert.equal(calls,1);
 reject(Object.assign(Error('請先確認結果'),{outcomeUnknown:true}));await pending;
 assert.equal(form.submit.disabled,true);assert.equal(form.submit.textContent,'請先確認最新紀錄');assert.equal(form.note,'保留的輸入');
 await f.submit();assert.equal(calls,1);assert.equal(f.closed,0);
});
test('definite validation failure remains editable and an old completion cannot close a replacement form',async()=>{
 const f=fixture();let calls=0;f.modal('收歌','',async()=>{if(++calls===1)throw Error('首數不正確');});
 await f.submit();assert.equal(f.form.submit.disabled,false);await f.submit();assert.equal(calls,2);assert.equal(f.closed,1);
 let resolve;f.modal('舊表單','',()=>new Promise(yes=>resolve=yes));const old=f.form,pending=f.submit();f.modal('新表單','',async()=>{});const current=f.form;
 resolve();await pending;assert.equal(f.form,current);assert.equal(f.closed,1);assert.equal(current.note,'保留的輸入');assert.equal(old.submit.disabled,false);
});
