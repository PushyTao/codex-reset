import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../server/store.js';
const source=await import('../server/source.js').catch(()=>({}));
const sample={id:'observed-2114588174249071102',reset_type:'regular',announced_at:'2026-10-26T07:00:00.000Z',text:'Codex usage limits have been reset. Check your limits.',source:{type:'observed',url:'https://x.com/thsottiaux/status/2114588174249071102'}};
test('public API records retain observation attribution and unsafe source links are rejected',()=>{
  assert.equal(typeof source.normalizeReset,'function');
  const result=source.normalizeReset(sample);assert.equal(result.source_type,'observed');assert.equal(result.source_id,'observed-2114588174249071102');
  assert.equal(result.kind,'regular');
  assert.throws(()=>source.normalizeReset({...sample,source:{type:'x_post',author:'other',url:sample.source.url}}));
  assert.throws(()=>source.normalizeReset({...sample,source:{type:'observed',url:'javascript:alert(1)'}}));
  assert.equal(source.normalizeReset({...sample,id:'observed-manual-one',source:{type:'observed'}}).source_url,'https://codex-resets.com/');
});
test('an observation keeps its upstream identity when a link is added or changed',()=>{
  for(const url of [undefined,sample.source.url,'https://x.com/thsottiaux/status/2114588174249071103']){
    assert.equal(source.normalizeReset({...sample,source:{type:'observed',url}}).source_id,'observed-2114588174249071102');
  }
});
test('sync enriches an observation without duplicating its row or notifications and preserves its archive',async()=>{
  const store=createStore(':memory:');
  try{
    store.addRecipient({email:'reader@example.com'});
    store.set('config',{notificationsEnabled:true});
    store.set('sourceInitialized',true);
    let current={...sample,source:{type:'observed'}};
    const sync=source.createSyncService(store,{requestJson:async url=>url.includes('/status')?{data:{scheduled_reset:null}}:{data:[current],pagination:{has_more:false,next_cursor:null}}});
    assert.equal((await sync()).queued,1);
    const original=store.allEvents()[0];
    current={...sample,text:'The observation now has a supporting post.'};
    assert.deepEqual(await sync(),{added:0,queued:0,baseline:false,count:1});
    assert.equal(store.allEvents().length,1);
    assert.equal(store.allEvents()[0].id,original.id);
    assert.equal(store.allEvents()[0].source_url,sample.source.url);
    assert.equal(store.allEvents()[0].text,'The observation now has a supporting post.');
    store.archiveEvent(original.id);
    current={...current,text:'Confirmed announcement.',source:{...sample.source,type:'x_post',author:'thsottiaux'}};
    assert.equal((await sync()).added,0);
    assert.equal(store.publicEvents().length,0);
    assert.equal(store.allEvents()[0].source_type,'x_post');
    assert.equal(store.allEvents()[0].text,'Confirmed announcement.');
    assert.equal(store.deliveries().length,1);
    assert.equal(store.deliveries()[0].status,'cancelled');
  }finally{store.close();}
});
test('sync follows every cursor and does not commit partial data after a later page fails',async()=>{
  assert.equal(typeof source.createSyncService,'function');
  const store=createStore(':memory:');
  try{
    let broken=true;
    const requestJson=async url=>{
      if(url.includes('/status'))return {data:{scheduled_reset:null},meta:{api_version:'v1'}};
      if(url.includes('cursor=')){if(broken)throw new Error('Upstream unavailable');return {data:[{...sample,id:'observed-2114588174249071103',source:{...sample.source,url:'https://x.com/thsottiaux/status/2114588174249071103'}}],pagination:{has_more:false,next_cursor:null}};}
      return {data:[sample],pagination:{has_more:true,next_cursor:'next_page'}};
    };
    const sync=source.createSyncService(store,{requestJson});
    await assert.rejects(sync());assert.equal(store.publicEvents().length,0);assert.equal(store.get('sourceInitialized'),null);
    broken=false;const result=await sync();assert.equal(result.added,2);assert.equal(result.baseline,true);assert.equal(store.publicEvents().length,2);
  }finally{store.close();}
});
test('scheduled resets are kept separate from executed history',async()=>{
  assert.equal(typeof source.createSyncService,'function');
  const store=createStore(':memory:');
  try{
    const scheduled={...sample,id:'2114588174249071103',status:'scheduled',scheduled_for:'2026-10-27T07:00:00.000Z',source:{type:'x_post',author:'thsottiaux',url:'https://x.com/thsottiaux/status/2114588174249071103'}};
    const sync=source.createSyncService(store,{requestJson:async url=>url.includes('/status')?{data:{scheduled_reset:scheduled}}:{data:[sample],pagination:{has_more:false,next_cursor:null}}});
    await sync();assert.equal(store.publicEvents().length,1);assert.equal(store.get('scheduled').source_url,scheduled.source.url);
  }finally{store.close();}
});
