import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyBoardFeed,boardFeedCursor,mergeBoardFeed} from '../src/board-feed.js';
const row=(seq,body='old')=>({id:'post-'+seq,seq,body});
const page=(rows,scannedThrough,next)=>({rows,scannedThrough,next});
const ids=feed=>feed.rows.map(p=>p.seq);

test('newest polling preserves loaded older pages and their pagination cursor',()=>{
 let feed=mergeBoardFeed(emptyBoardFeed(),page([row(300),row(220)],201,201));
 feed=mergeBoardFeed(feed,page([row(190),row(110)],101,101),201);
 feed=mergeBoardFeed(feed,page([row(310),row(300,'edited'),row(220)],211,211));
 assert.deepEqual(ids(feed),[310,300,220,190,110]);
 assert.equal(feed.rows.find(p=>p.seq===300).body,'edited');
 assert.equal(boardFeedCursor(feed),101);
});
test('reading the final older page does not lose history on the next poll',()=>{
 let feed=mergeBoardFeed(emptyBoardFeed(),page([row(200)],101,101));
 feed=mergeBoardFeed(feed,page([row(80),row(2)],2,null),101);
 feed=mergeBoardFeed(feed,page([row(210),row(200)],111,111));
 assert.deepEqual(ids(feed),[210,200,80,2]);
 assert.equal(boardFeedCursor(feed),null);
});
test('hidden-only scans still advance pagination without dropping unscanned older posts',()=>{
 let feed=mergeBoardFeed(emptyBoardFeed(),page([],301,301));
 assert.equal(boardFeedCursor(feed),301);
 feed=mergeBoardFeed(feed,page([row(270)],201,201),301);
 feed=mergeBoardFeed(feed,page([],401,401));
 assert.deepEqual(ids(feed),[270]);
 assert.equal(boardFeedCursor(feed),401);
 feed=mergeBoardFeed(feed,page([],301,301),401);
 assert.equal(boardFeedCursor(feed),201);
 assert.deepEqual(ids(feed),[270]);
});
test('fresh scans remove omitted rows within the scanned interval and replace moderated rows',()=>{
 let feed=mergeBoardFeed(emptyBoardFeed(),page([row(300),row(290),row(210)],201,201));
 feed=mergeBoardFeed(feed,page([row(150)],101,101),201);
 feed=mergeBoardFeed(feed,page([{...row(300,''),deleted:true},row(210)],201,201));
 assert.deepEqual(ids(feed),[300,210,150]);
 assert.equal(feed.rows[0].deleted,true);
 assert.equal(feed.rows[0].body,'');
});
test('a complete empty scan clears previously visible rows',()=>{
 const feed=mergeBoardFeed(mergeBoardFeed(emptyBoardFeed(),page([row(5)],5,null)),page([],null,null));
 assert.deepEqual(feed.rows,[]);assert.equal(boardFeedCursor(feed),null);
});
test('more than a page of new posts creates a bridge cursor without discarding old rows',()=>{
 let feed=mergeBoardFeed(emptyBoardFeed(),page([row(300),row(210)],201,201));
 feed=mergeBoardFeed(feed,page([row(180)],101,101),201);
 feed=mergeBoardFeed(feed,page([row(600),row(510)],501,501));
 assert.deepEqual(ids(feed),[600,510,300,210,180]);assert.equal(boardFeedCursor(feed),501);
 feed=mergeBoardFeed(feed,page([row(490)],401,401),501);
 assert.equal(boardFeedCursor(feed),401);
 feed=mergeBoardFeed(feed,page([row(610),row(600),row(510)],511,511));
 assert.equal(boardFeedCursor(feed),401,'same newest window must not restart bridge paging');
 feed=mergeBoardFeed(feed,page([row(390),row(300,'updated')],299,299),401);
 assert.equal(boardFeedCursor(feed),101);
 assert.deepEqual(ids(feed),[610,600,510,490,390,300,210,180]);
 assert.equal(feed.rows.find(p=>p.seq===300).body,'updated');
});
test('several disconnected newest batches keep every required bridge',()=>{
 let feed=mergeBoardFeed(emptyBoardFeed(),page([row(100)],1,1));
 feed=mergeBoardFeed(feed,page([row(400)],301,301));
 feed=mergeBoardFeed(feed,page([row(700)],601,601));
 assert.equal(boardFeedCursor(feed),601);
 feed=mergeBoardFeed(feed,page([row(500),row(400)],400,400),601);
 assert.equal(boardFeedCursor(feed),301);
 feed=mergeBoardFeed(feed,page([row(200),row(100)],100,100),301);
 assert.equal(boardFeedCursor(feed),1);
 assert.deepEqual(ids(feed),[700,500,400,200,100]);
});
test('resetting the feed starts a new room or changed block list without stale rows',()=>{
 let feed=mergeBoardFeed(emptyBoardFeed(),page([row(500)],401,401));
 feed=emptyBoardFeed();
 feed=mergeBoardFeed(feed,page([row(20)],20,null));
 assert.deepEqual(ids(feed),[20]);assert.equal(boardFeedCursor(feed),null);
});
