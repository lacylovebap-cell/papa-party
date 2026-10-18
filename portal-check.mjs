import assert from 'node:assert/strict';
import {legacyPortalDestination as route} from './src/portal-routing.js';
for(const h of ['', '#features','#experience','#audience','#plans'])assert.equal(route('https://paparty.app/'+h),null);
for(const tail of ['?streamer=papa#home','?space=room-a&spaceId=abc#admin','?streamer=papa&notificationId=xyz#center','?demo','#book','#home']){
 const got=new URL(route('https://paparty.app/'+tail)),before=new URL('https://paparty.app/'+tail);
 assert.equal(got.pathname,'/v2.html');assert.equal(got.search,before.search);assert.equal(got.hash,before.hash);
}
assert.equal(route('https://paparty.app/index.html?streamer=papa#home'),'https://paparty.app/v2.html?streamer=papa#home');
assert.equal(route('https://example.com/mount/?space=a'),'https://example.com/mount/v2.html?space=a');
console.log('Portal route checks passed');
