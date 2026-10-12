import test from 'node:test';
import assert from 'node:assert/strict';
import {revisionConflictFailure,webApiFailure} from '../src/web-api-errors.js';
test('only a definite revision rejection requests recovery; ambiguous writes are never classified as retryable',()=>{
 assert.equal(revisionConflictFailure(409,{code:'VERSION_CONFLICT'}),true);
 assert.equal(revisionConflictFailure(400,{error:'資料剛更新了，請重新整理後再試一次'}),true);
 for(const [status,data] of [[200,{code:'VERSION_CONFLICT'}],[500,{error:'資料庫操作失敗'}],[408,{error:'timeout'}],[400,{error:'共同資料剛更新，請重新選取後再操作'}],[409,{error:'資料刚更新'}]])assert.equal(revisionConflictFailure(status,data),false);
});
test('conflict error retains transport evidence and asks for reconfirmation instead of replay',()=>{
 const error=webApiFailure(409,{code:'VERSION_CONFLICT',error:'rejected'});
 assert.equal(error.status,409);assert.equal(error.code,'VERSION_CONFLICT');assert.equal(error.staleRevision,true);
 assert.match(error.message,/原本內容已保留/);assert.match(error.message,/確認最新紀錄後再送出/);
 const ambiguous=webApiFailure(500,{error:'資料庫操作失敗'});assert.equal(ambiguous.staleRevision,false);assert.equal(ambiguous.message,'資料庫操作失敗');
});
