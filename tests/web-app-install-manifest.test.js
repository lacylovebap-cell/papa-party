import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../',import.meta.url);
test('install manifest preserves application identity and supplies real correctly sized PNGs',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('manifest.webmanifest',root),'utf8'));
 assert.equal(manifest.id,'./');assert.equal(manifest.start_url,'./app.html');assert.equal(manifest.scope,'./');
 assert.equal(manifest.name,'PA Party');assert.equal(manifest.short_name,'PA Party');assert.equal(manifest.display,'standalone');
 for(const size of [192,512])assert.ok(manifest.icons.some(icon=>icon.sizes===`${size}x${size}`&&icon.purpose==='any'));
 assert.ok(manifest.icons.some(icon=>icon.purpose==='maskable'&&icon.sizes==='512x512'));
 for(const icon of manifest.icons){
  const bytes=fs.readFileSync(new URL(icon.src,root)),[width,height]=icon.sizes.split('x').map(Number);
  assert.equal(icon.type,'image/png');assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(bytes.toString('ascii',12,16),'IHDR');assert.equal(bytes.readUInt32BE(16),width);assert.equal(bytes.readUInt32BE(20),height);
 }
 for(const page of ['index.html','preview.html','v2.html','app.html']){
  const html=fs.readFileSync(new URL(page,root),'utf8');
  assert.match(html,/<link rel="manifest" href="manifest.webmanifest">/);
  assert.match(html,/<link rel="apple-touch-icon" href="assets\/apple-touch-icon.png">/);
 }
 const apple=fs.readFileSync(new URL('assets/apple-touch-icon.png',root));assert.equal(apple.readUInt32BE(16),180);assert.equal(apple.readUInt32BE(20),180);
});
