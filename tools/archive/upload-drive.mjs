#!/usr/bin/env node
/**
 * PA Party encrypted-only Google Drive uploader.
 * Usage: node tools/archive/upload-drive.mjs --file backup.jsonl.gz.enc --folder-id FOLDER_ID --upload
 * Without --upload, runs locally in dry-run mode.
 * Server-side Google OAuth env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.
 * Alternative one-shot env: GOOGLE_DRIVE_ACCESS_TOKEN.
 * Minimum Drive OAuth scope: https://www.googleapis.com/auth/drive.file.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function args(argv) {
  const conf={};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--upload'){conf.upload=true;continue;}
    if(!argv[i]?.startsWith('--') || !argv[i+1]) throw Error('用法：--file 加密檔 --folder-id 私人資料夾ID [--upload]');
    conf[argv[i].slice(2)]=argv[++i];
  }
  if(!conf.file||!conf['folder-id']) throw Error('請指定 --file 與 --folder-id');
  if(!/^[\w-]+$/.test(conf['folder-id'])) throw Error('folder-id 格式不正確');
  if(!conf.file.endsWith('.enc')) throw Error('禁止將未加密的封存原文直接上傳');
  return conf;
}
async function checksum(file) {
  const sha=crypto.createHash('sha256'),md5=crypto.createHash('md5');
  for await(const part of fs.createReadStream(file)){sha.update(part);md5.update(part);}
  return {sha256:sha.digest('hex'),md5:md5.digest('hex')};
}
async function token() {
  if(process.env.GOOGLE_DRIVE_ACCESS_TOKEN) return process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
  const {GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,GOOGLE_REFRESH_TOKEN}=process.env;
  if(!GOOGLE_CLIENT_ID||!GOOGLE_CLIENT_SECRET||!GOOGLE_REFRESH_TOKEN) throw Error('尚未完成網站端 Google OAuth 授權；請在安全環境設定 CLIENT_ID、CLIENT_SECRET、REFRESH_TOKEN');
  const r=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:GOOGLE_CLIENT_ID,client_secret:GOOGLE_CLIENT_SECRET,refresh_token:GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})
  });
  if(!r.ok) throw Error('Google OAuth 授權更新失敗（HTTP '+r.status+'）');
  const json=await r.json();
  if(!json.access_token) throw Error('Google 沒有提供 access token');
  return json.access_token;
}
async function driveJson(url,access,more={}) {
  const r=await fetch(url,{...more,headers:{Authorization:'Bearer '+access,...more.headers}});
  if(!r.ok) throw Error('Google Drive API 失敗（HTTP '+r.status+'）');
  return r.json();
}
function quote(s){return s.replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
async function upload(file,folder,access,length,hash) {
  const name=path.basename(file);
  const list=new URL('https://www.googleapis.com/drive/v3/files');
  list.searchParams.set('q',"'"+quote(folder)+"' in parents and name = '"+quote(name)+"' and trashed = false");
  list.searchParams.set('fields','nextPageToken,files(id,size,md5Checksum)');
  const existing=(await driveJson(list.toString(),access)).files||[];
  if(existing.length){
    const same=existing.length===1 && existing[0].md5Checksum===hash.md5 && Number(existing[0].size)===length;
    if(same) return {id:existing[0].id,reused:true};
    throw Error('Drive 已有同名不同內容檔案，拒絕覆寫');
  }
  const start=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,md5Checksum',{
    method:'POST',
    headers:{Authorization:'Bearer '+access,'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':'application/octet-stream','X-Upload-Content-Length':String(length)},
    body:JSON.stringify({name,parents:[folder],mimeType:'application/octet-stream',properties:{pa_party_archive:'v1',sha256:hash.sha256}})
  });
  if(!start.ok) throw Error('Drive 上傳啟動失敗（HTTP '+start.status+'）');
  const session=start.headers.get('location');
  if(!session||!session.startsWith('https://')) throw Error('Drive 續傳工作階段不正確');
  const fh=await fs.promises.open(file,'r');
  let position=0,complete=null;
  try{
    while(position<length){
      const size=Math.min(8*1024*1024,length-position);
      const bytes=Buffer.alloc(size);
      let read=0;
      while(read<size){
        const part=await fh.read(bytes,read,size-read,position+read);
        if(!part.bytesRead) throw Error('本機封存檔讀取中斷');
        read+=part.bytesRead;
      }
      let r;
      try{
        r=await fetch(session,{method:'PUT',redirect:'manual',headers:{
          Authorization:'Bearer '+access,
          'Content-Type':'application/octet-stream',
          'Content-Range':'bytes '+position+'-'+(position+size-1)+'/'+length
        },body:bytes});
      }catch{throw Error('Drive 網路中斷，未確認上傳成功；原始檔未刪除');}
      if(r.status===308){
        const match=/bytes=0-(\d+)/.exec(r.headers.get('range')||'');
        const next=match?Number(match[1])+1:0;
        if(next<=position||next>length) throw Error('Drive 回報無效的續傳位置，請手動檢查雲端是否完成');
        position=next;
        continue;
      }
      if(r.status===200||r.status===201){complete=await r.json();break;}
      throw Error('Drive 上傳失敗（HTTP '+r.status+'）');
    }
  }finally{await fh.close();}
  if(!complete?.id) throw Error('Drive 尚未回報完成');
  const remote=await driveJson('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(complete.id)+'?fields=id,name,size,md5Checksum',access);
  if(Number(remote.size)!==length||remote.md5Checksum!==hash.md5) throw Error('Drive 檔案長度或 MD5 校驗失敗');
  return {id:remote.id,reused:false};
}
async function main(){
  const conf=args(process.argv.slice(2));
  const file=path.resolve(conf.file),stats=await fs.promises.stat(file);
  if(!stats.isFile()||stats.size===0) throw Error('無效或空白的封存檔');
  const hashes=await checksum(file);
  if(!conf.upload){
    console.log(JSON.stringify({mode:'dry-run',file_name:path.basename(file),file_bytes:stats.size,encrypted:true,sha256:hashes.sha256,uploaded:false},null,2));
    return;
  }
  const access=await token();
  const result=await upload(file,conf['folder-id'],access,stats.size,hashes);
  console.log(JSON.stringify({uploaded:true,drive_file_id:result.id,reused_identical_file:result.reused,encrypted_file_sha256:hashes.sha256,remote_size_md5_verified:true,deleted_source:false},null,2));
}
main().catch(e=>{console.error('Drive 上傳未完成：'+e.message);process.exitCode=1;});
