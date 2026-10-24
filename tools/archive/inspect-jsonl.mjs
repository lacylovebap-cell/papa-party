#!/usr/bin/env node
/**
 * PA Party local event archive inspector.
 * Read-only: accepts a local newline-delimited JSON file, optionally gzip.
 * Never sends data over the network, never writes to the database.
 *
 * node tools/archive/inspect-jsonl.mjs --file "C:\path\events.jsonl.gz" \
 *   --expected-rows 256876 --manifest-output "./manifest.json"
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const columns = [
  'id', 'streamer_id', 'entity_kind', 'entity_id', 'action',
  'actor_role', 'actor_player_id', 'created_at', 'effective_at',
  'before_data', 'after_data', 'hour_bucket', 'actor_account_id',
  'actor_streamer_id', 'actor_display_name_snapshot', 'target_player_id',
  'target_player_name_snapshot', 'space_id'
];

function options(argv) {
  const result = {};
  for (let i=0; i<argv.length; i+=2) {
    const key=argv[i];
    if (!key?.startsWith('--') || !argv[i+1]) throw Error('使用方式：--file 路徑 [--expected-rows 數字] [--expected-sha256 64位] [--manifest-output 路徑]');
    result[key.slice(2)]=argv[i+1];
  }
  if (!result.file) throw Error('缺少 --file');
  if (result['expected-rows'] && !/^\d+$/.test(result['expected-rows'])) throw Error('expected-rows 必須是非負整數');
  if (result['expected-sha256'] && !/^[a-f\d]{64}$/i.test(result['expected-sha256'])) throw Error('expected-sha256 必須是 SHA-256 十六進位');
  return result;
}

function eventId(value) {
  if (typeof value==='string' && /^\d+$/.test(value)) return BigInt(value).toString();
  if (typeof value==='number' && Number.isSafeInteger(value) && value>=0) return String(value);
  throw Error('事件 id 不正確或超過 JavaScript 安全整數範圍');
}

async function digestFile(filepath) {
  const digest=crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filepath), async function* (chunks) {
    for await (const chunk of chunks) digest.update(chunk);
  });
  return digest.digest('hex');
}

async function inspect(filepath) {
  const input=fs.createReadStream(filepath);
  const stream=/\.gz$/i.test(filepath) ? input.pipe(createGunzip()) : input;
  const lines=readline.createInterface({input:stream,crlfDelay:Infinity});
  const ids=new Set();
  const idHash=crypto.createHash('sha256');
  let count=0, minId=null, maxId=null, ordered=true, prev=null;
  let lineNo=0;
  for await (const line of lines) {
    lineNo+=1;
    if (!line.trim()) continue;
    let row;
    try { row=JSON.parse(line); } catch { throw Error('第 '+lineNo+' 行不是有效的 JSON'); }
    if (!row || typeof row!=='object' || Array.isArray(row)) throw Error('第 '+lineNo+' 行不是事件物件');
    if (columns.some(k=>!Object.prototype.hasOwnProperty.call(row,k))) throw Error('第 '+lineNo+' 行缺少原始 18 欄，不能認定為無損事件封存');
    const id=eventId(row.id);
    if (ids.has(id)) throw Error('第 '+lineNo+' 行存在重複事件 ID：'+id);
    ids.add(id);
    const bigint=BigInt(id);
    if (minId===null || bigint<minId) minId=bigint;
    if (maxId===null || bigint>maxId) maxId=bigint;
    if (prev!==null && bigint<=prev) ordered=false;
    prev=bigint;
    if (typeof row.created_at!=='string' || !row.created_at) throw Error('第 '+lineNo+' 行缺少原始時間文字');
    idHash.update(id+'\n','utf8');
    count+=1;
  }
  if (!count) throw Error('檔案沒有事件紀錄');
  return {rows:count,min_event_id:minId.toString(),max_event_id:maxId.toString(),ascending_ids:ordered,ordered_event_ids_sha256:idHash.digest('hex'),columns};
}

async function main() {
  const cfg=options(process.argv.slice(2));
  const absolute=path.resolve(cfg.file);
  const stat=fs.statSync(absolute);
  if (!stat.isFile()) throw Error('必須提供檔案而不是資料夾');
  const file_sha256=await digestFile(absolute);
  const inspection=await inspect(absolute);
  if (cfg['expected-rows'] && inspection.rows!==Number(cfg['expected-rows'])) throw Error('筆數校驗失敗：實際 '+inspection.rows+' 筆；預期 '+cfg['expected-rows']+' 筆');
  if (cfg['expected-sha256'] && file_sha256!==cfg['expected-sha256'].toLowerCase()) throw Error('檔案 SHA-256 與原始來源不相同');
  const manifest={
    manifest_version:1,
    type:'papa_events_archive_inspection',
    file_name:path.basename(absolute),
    file_size_bytes:stat.size,
    file_sha256,
    inspected_at:new Date().toISOString(),
    ...inspection,
    checks:{
      readable:true,
      valid_jsonl:true,
      complete_columns:true,
      no_duplicate_event_ids:true,
      externally_expected_rows_verified:Boolean(cfg['expected-rows']),
      externally_expected_sha256_verified:Boolean(cfg['expected-sha256']),
      original_database_contents_verified:false,
      restore_test_passed:false
    },
    warning:'此工具只能證明本機檔案自身可讀及指定校驗符合，不代表曾完整備份正式資料庫。不得因此自動刪除或回填正式資料。'
  };
  if (cfg['manifest-output']) {
    const output=path.resolve(cfg['manifest-output']);
    if (fs.existsSync(output)) throw Error('manifest 已存在，拒絕覆寫');
    fs.writeFileSync(output,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  }
  console.log(JSON.stringify(manifest,null,2));
}
main().catch(err=>{console.error('封存驗證失敗：'+err.message);process.exitCode=1;});
