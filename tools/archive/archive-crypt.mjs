#!/usr/bin/env node
/**
 * PA Party AES-256-GCM local archive file protection.
 * No dependencies, no database connection, no network.
 * Password only through PA_ARCHIVE_PASSPHRASE environment variable.
 *
 * Encrypt:
 *   node tools/archive/archive-crypt.mjs encrypt input.jsonl.gz output.jsonl.gz.enc
 * Decrypt:
 *   node tools/archive/archive-crypt.mjs decrypt output.jsonl.gz.enc recovered.jsonl.gz
 *
 * Encrypted format:
 *   8 ASCII bytes PAPAE001 | salt 16 bytes | nonce 12 bytes
 *   | AES-256-GCM ciphertext | tag 16 bytes
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const {open,stat,unlink}=fs.promises;
const MAGIC=Buffer.from('PAPAE001');
const HEADER_SIZE=36;
const TAG_SIZE=16;
const CHUNK_SIZE=2*1024*1024;

function passwordKey(salt) {
  const phrase=process.env.PA_ARCHIVE_PASSPHRASE;
  if (!phrase || phrase.length<20) throw Error('PA_ARCHIVE_PASSPHRASE 未設定或長度少於20。不可在命令列或 GitHub 提交密碼。');
  return crypto.scryptSync(phrase,salt,32,{maxmem:64*1024*1024});
}
async function writeAll(handle,data) {
  let offset=0;
  while (offset<data.length) {
    const {bytesWritten}=await handle.write(data,offset,data.length-offset);
    if (bytesWritten<=0) throw Error('寫入封存檔失敗');
    offset+=bytesWritten;
  }
}
async function hashFile(file) {
  const hash=crypto.createHash('sha256');
  for await (const block of fs.createReadStream(file)) hash.update(block);
  return hash.digest('hex');
}
async function encrypt(input,output) {
  const salt=crypto.randomBytes(16);
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',passwordKey(salt),iv);
  const dest=await open(output,'wx',0o600);
  let complete=false;
  try {
    await writeAll(dest,Buffer.concat([MAGIC,salt,iv]));
    for await(const block of fs.createReadStream(input,{highWaterMark:CHUNK_SIZE})) await writeAll(dest,cipher.update(block));
    await writeAll(dest,cipher.final());
    await writeAll(dest,cipher.getAuthTag());
    await dest.sync();
    complete=true;
  } finally {
    await dest.close();
    if (!complete) await unlink(output).catch(()=>{});
  }
}
async function decrypt(input,output) {
  const size=(await stat(input)).size;
  if(size<=HEADER_SIZE+TAG_SIZE) throw Error('加密封存檔長度不正確');
  const inFile=await open(input,'r');
  const header=Buffer.alloc(HEADER_SIZE),tag=Buffer.alloc(TAG_SIZE);
  try {
    await inFile.read(header,0,HEADER_SIZE,0);
    await inFile.read(tag,0,TAG_SIZE,size-TAG_SIZE);
  } finally { await inFile.close(); }
  if (!header.subarray(0,MAGIC.length).equals(MAGIC)) throw Error('不認識的封存加密格式');
  const key=passwordKey(header.subarray(8,24));
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,header.subarray(24,36));
  decipher.setAuthTag(tag);
  const dest=await open(output,'wx',0o600);
  let complete=false;
  try {
    for await(const block of fs.createReadStream(input,{start:HEADER_SIZE,end:size-TAG_SIZE-1,highWaterMark:CHUNK_SIZE})) {
      await writeAll(dest,decipher.update(block));
    }
    await writeAll(dest,decipher.final());
    await dest.sync();
    complete=true;
  } finally {
    await dest.close();
    if (!complete) await unlink(output).catch(()=>{});
  }
}
async function main() {
  const [mode,source,destination]=process.argv.slice(2);
  if(!['encrypt','decrypt'].includes(mode)||!source||!destination) {
    throw Error('用法：archive-crypt.mjs encrypt|decrypt 輸入檔案 輸出檔案');
  }
  const input=path.resolve(source),output=path.resolve(destination);
  if(input===output) throw Error('來源與目標不能相同');
  if((await stat(input)).size===0) throw Error('來源檔案是空的');
  if(mode==='encrypt') await encrypt(input,output); else await decrypt(input,output);
  console.log(JSON.stringify({
    operation:mode,
    output_name:path.basename(output),
    output_size_bytes:(await stat(output)).size,
    output_sha256:await hashFile(output),
    note:'未上傳雲端，請另存密碼於安全位置並至少留另一份獨立加密備份。'
  },null,2));
}
main().catch(error=>{console.error('封存保護失敗：'+error.message);process.exitCode=1;});
