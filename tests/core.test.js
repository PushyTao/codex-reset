import test from 'node:test';
import assert from 'node:assert/strict';

const core = await import('../server/store.js').catch(() => ({}));
const validation = await import('../server/validation.js').catch(() => ({}));
const event = { source_id: '2114588174249071102', source_url: 'https://x.com/thsottiaux/status/2114588174249071102', occurred_at: '2026-10-26T07:00:00.000Z', text: 'A reset announcement', summary: '额度重置公告', kind: 'regular', origin: 'codex-resets' };

test('first sync imports history without queuing emails; later duplicate imports stay silent', () => {
  assert.equal(typeof core.createStore, 'function', 'persistent store must exist');
  const store = core.createStore(':memory:');
  try {
    store.addRecipient({email:'reader@example.com',name:'Reader'});
    assert.deepEqual(store.ingest([event], true), {added:1,queued:0,baseline:true});
    assert.deepEqual(store.ingest([event], true), {added:0,queued:0,baseline:false});
    const newer = {...event, source_id:'2114588174249071103', source_url:'https://x.com/thsottiaux/status/2114588174249071103',occurred_at:'2026-10-27T07:00:00.000Z'};
    assert.equal(store.ingest([newer], true).queued, 1);
    assert.equal(store.ingest([newer], true).queued, 0);
    assert.equal(store.publicEvents().length,2);
  } finally {store.close();}
});

test('archived events stay private and historical backfills do not trigger reminders', () => {
  assert.equal(typeof core.createStore, 'function');
  const store=core.createStore(':memory:');
  try {
    store.addRecipient({email:'reader@example.com'});
    store.ingest([event],true);
    const old={...event,source_id:'2000000000000000001',source_url:'https://x.com/thsottiaux/status/2000000000000000001',occurred_at:'2026-01-01T00:00:00.000Z'};
    assert.equal(store.ingest([old],true).queued,0);
    store.archiveEvent(store.publicEvents()[0].id);
    store.ingest([event],true);
    assert.equal(store.publicEvents().length,1);
  }finally{store.close();}
});

test('legacy numeric IDs reconcile in place and retain delivery history',()=>{
  const store=core.createStore(':memory:');
  try{
    store.addRecipient({email:'reader@example.com'});
    store.set('sourceInitialized',true);
    assert.equal(store.ingest([event],true).queued,1);
    const original=store.allEvents()[0];
    store.db.prepare("UPDATE deliveries SET status='sent',attempts=1,sent_at=? WHERE event_id=?").run('2026-10-26T07:01:00.000Z',original.id);
    const delivery={...store.deliveries()[0]};
    const stable={...event,source_id:'observed-2114588174249071102',source_type:'observed',source_url:'https://codex-resets.com/'};
    assert.deepEqual(store.ingest([stable],true),{added:0,queued:0,baseline:false});
    assert.equal(store.allEvents().length,1);
    assert.equal(store.allEvents()[0].id,original.id);
    assert.equal(store.allEvents()[0].source_id,'observed-2114588174249071102');
    assert.deepEqual({...store.deliveries()[0]},delivery);
    const newer={...event,source_id:'observed-2114588174249071103',source_url:'https://x.com/thsottiaux/status/2114588174249071103',occurred_at:'2026-10-27T07:00:00.000Z'};
    assert.equal(store.ingest([newer],true).queued,1);
    assert.equal(store.ingest([newer],true).queued,0);
    assert.equal(store.deliveries().length,2);
  }finally{store.close();}
});

test('verified post URLs reconcile legacy aliases even when upstream time and ID have changed',()=>{
  const store=core.createStore(':memory:');
  try{
    store.ingest([event],false);
    const original=store.allEvents()[0];store.archiveEvent(original.id);
    const stable={...event,source_id:'observed-upstream-stable',occurred_at:'2026-10-26T07:05:00.000Z',source_type:'observed'};
    assert.equal(store.ingest([stable],true).added,0);
    assert.equal(store.allEvents().length,1);
    assert.equal(store.allEvents()[0].id,original.id);
    assert.equal(store.allEvents()[0].status,'archived');
    assert.equal(store.allEvents()[0].source_id,'observed-upstream-stable');
    assert.equal(store.allEvents()[0].occurred_at,'2026-10-26T07:05:00.000Z');
  }finally{store.close();}
});

test('manual posts and later upstream records share one row and delivery',()=>{
  for(const manualFirst of [true,false]){
    const store=core.createStore(':memory:');
    try{
      store.addRecipient({email:'reader@example.com'});store.set('sourceInitialized',true);
      const manual={...event,origin:'manual'};
      const stable={...event,source_id:'observed-upstream-stable',source_type:'observed'};
      if(manualFirst){
        assert.equal(store.addEvent(manual,true).queued,1);
        assert.equal(store.ingest([stable],true).queued,0);
      }else{
        assert.equal(store.ingest([stable],true).queued,1);
        assert.equal(store.addEvent(manual,true).queued,0);
      }
      assert.equal(store.allEvents().length,1);
      assert.equal(store.allEvents()[0].source_id,'observed-upstream-stable');
      assert.equal(store.allEvents()[0].source_type,'observed');
      assert.equal(store.deliveries().length,1);
    }finally{store.close();}
  }
});

test('generic homepages and mismatched numeric timestamps do not merge unrelated resets',()=>{
  const store=core.createStore(':memory:');
  try{
    const legacy={...event,source_url:'https://codex-resets.com/'};
    store.ingest([legacy],false);
    const otherTime={...legacy,source_id:'observed-2114588174249071102',occurred_at:'2026-10-26T07:01:00.000Z'};
    const otherId={...legacy,source_id:'observed-2114588174249071103'};
    assert.equal(store.ingest([otherTime,otherId],false).added,2);
    assert.equal(store.allEvents().length,3);
  }finally{store.close();}
});

test('a numeric status ID reconciles an existing observed ID without a supporting URL',()=>{
  const store=core.createStore(':memory:');
  try{
    store.addRecipient({email:'reader@example.com'});store.set('sourceInitialized',true);
    const observed={...event,source_id:'observed-'+event.source_id,source_url:'https://codex-resets.com/',source_type:'observed'};
    assert.equal(store.ingest([observed],true).queued,1);
    assert.equal(store.ingest([event],true).added,0);
    assert.equal(store.publicEvents().length,1);assert.equal(store.deliveries().length,1);
  }finally{store.close();}
});

test('email normalization rejects headers, malformed addresses and duplicates',()=>{
  assert.equal(typeof validation.emailAddress,'function');
  assert.equal(validation.emailAddress(' Reader@Example.com '),'reader@example.com');
  for(const bad of ['a@b','a\r\nBcc:evil@example.com','x y@example.com','']) assert.throws(()=>validation.emailAddress(bad));
  const store=core.createStore(':memory:');
  try{store.addRecipient({email:'Reader@Example.com'});assert.throws(()=>store.addRecipient({email:'reader@example.com'}));}finally{store.close();}
});

test('manual event validation rejects unsafe URLs and impossible dates',()=>{
  assert.equal(typeof validation.validateEvent,'function');
  assert.equal(validation.validateEvent(event).source_id,event.source_id);
  for(const url of ['javascript:alert(1)','https://evil.example/thsottiaux/status/123','https://x.com/other/status/123']) assert.throws(()=>validation.validateEvent({...event,source_url:url}));
  assert.throws(()=>validation.validateEvent({...event,occurred_at:'not-a-date'}));
  assert.throws(()=>validation.validateEvent({...event,kind:'unknown'}));
});

test('SMTP secrets are authenticated and encrypted at rest',async()=>{
  const security=await import('../server/security.js').catch(()=>({}));
  assert.equal(typeof security.createVault,'function');
  const vault=security.createVault(Buffer.alloc(32,1));
  const encrypted=vault.encrypt('smtp-secret-value');
  assert.ok(!encrypted.includes('smtp-secret-value'));
  assert.equal(vault.decrypt(encrypted),'smtp-secret-value');
  assert.throws(()=>security.createVault(Buffer.alloc(32,2)).decrypt(encrypted));
});
