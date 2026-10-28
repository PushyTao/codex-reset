import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../server/store.js';
import {createVault} from '../server/security.js';
import {createApp} from '../server/app.js';

async function setup(t){
  const store=createStore(':memory:');
  const app=createApp({store,vault:createVault(Buffer.alloc(32,9)),password:'subscription-test-password',sync:async()=>({added:0}),sendTest:async()=>{throw new Error('Subscriptions must not send test mail');}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(body,headers={})=>fetch(base+'/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...headers},body:JSON.stringify(body)});
  return {store,base,post};
}
const subscriber={name:'小林',email:'reader@example.test',consent:true};
const event={source_id:'2115297093879472332',source_url:'https://x.com/thsottiaux/status/2115297093879472332',occurred_at:'2026-10-28T04:18:22.000Z',text:'Reset completed.',summary:'额度重置',kind:'regular',origin:'codex-resets'};

test('subscription page is accessible directly, excluded from indexing and absent from home navigation',async t=>{
  const {base}=await setup(t);
  for(const path of ['/subscribe','/subscribe/','/subscribe.html']){
    const response=await fetch(base+path);assert.equal(response.status,200,path);
    assert.match(response.headers.get('content-type'),/text\/html/);
    assert.match(response.headers.get('x-robots-tag'),/noindex/);
  }
  assert.doesNotMatch(await (await fetch(base+'/')).text(),/href\s*=\s*["']\/subscribe/i);
  assert.match(await (await fetch(base+'/robots.txt')).text(),/Disallow: \/subscribe/);
});

test('public subscription stores a normalized recipient and queues only future reset notifications',async t=>{
  const {store,base,post}=await setup(t);
  store.ingest([event],false);
  const response=await post({...subscriber,name:'  小林  ',email:'  Reader@Example.Test  ',enabled:false});
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  const result=await response.json();assert.equal(result.ok,true);assert.equal(typeof result.message,'string');
  const [recipient]=store.recipients();
  assert.equal(recipient.name,'小林');assert.equal(recipient.email,'reader@example.test');assert.equal(recipient.enabled,1);
  assert.equal(store.deliveries().length,0);
  assert.equal(store.ingest([{...event,source_id:'2115297093879472333',source_url:'https://x.com/thsottiaux/status/2115297093879472333',occurred_at:'2026-10-29T04:18:22.000Z'}],true).queued,1);
  assert.equal(store.deliveries()[0].recipient_id,recipient.id);
  const publicState=await (await fetch(base+'/api/status')).text();
  assert.ok(!publicState.includes(recipient.email));assert.ok(!publicState.includes(recipient.name));
  assert.equal((await fetch(base+'/api/admin/state')).status,401);
  assert.equal((await fetch(base+'/api/subscribe')).status,404);
});

test('repeat subscriptions neither overwrite names nor reactivate disabled recipients or reveal membership',async t=>{
  const {store,post}=await setup(t);
  const fresh=await post(subscriber);assert.equal(fresh.status,200);const expected=await fresh.json();
  const original={...store.recipients()[0]};
  const duplicate=await post({...subscriber,name:'别人',email:'READER@example.test'});
  assert.equal(duplicate.status,200);assert.deepEqual(await duplicate.json(),expected);
  assert.deepEqual({...store.recipients()[0]},original);assert.equal(store.recipients().length,1);
  store.updateRecipient(original.id,false);
  const disabled=await post({...subscriber,name:'重新启用',enabled:true});
  assert.equal(disabled.status,200);assert.deepEqual(await disabled.json(),expected);
  assert.equal(store.recipients()[0].enabled,0);assert.equal(store.recipients()[0].name,'小林');
  assert.equal(store.deliveries().length,0);
});

test('subscription rejects malformed email, missing consent and invalid names before saving',async t=>{
  const {store,post}=await setup(t);
  for(const input of [
    {...subscriber,email:'reader@example.test\r\nBcc: other@example.test'},
    {...subscriber,name:'   '},
    {...subscriber,name:'字'.repeat(81)},
    {...subscriber,name:'first\nsecond'},
    {...subscriber,consent:false},
  ])assert.equal((await post(input)).status,400);
  assert.equal(store.recipients().length,0);
});

test('subscription rejects malformed JSON shapes instead of coercing them into recipient data',async t=>{
  const {store,post}=await setup(t);
  for(const input of [[],{}, {...subscriber,name:['a']},{...subscriber,email:['reader@example.test']},{...subscriber,consent:'true'}]){
    assert.equal((await post(input)).status,400);
  }
  assert.equal(store.recipients().length,0);
});

test('subscription requires same-origin JSON requests without requiring an admin session',async t=>{
  const {store,base,post}=await setup(t);
  assert.equal((await post(subscriber,{Origin:'https://unrelated.example'})).status,403);
  assert.equal((await post(subscriber,{'Sec-Fetch-Site':'cross-site'})).status,403);
  const missingOrigin=await fetch(base+'/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(subscriber)});
  assert.equal(missingOrigin.status,403);
  assert.equal((await post(subscriber,{'Content-Type':'text/plain'})).status,415);
  assert.equal(store.recipients().length,0);
  assert.equal((await post(subscriber)).status,200);
});

test('public subscription limits repeated submissions and ignores untrusted forwarded IPs',async t=>{
  const {store,post}=await setup(t);
  for(let i=0;i<5;i++)assert.equal((await post({...subscriber,email:`reader${i}@example.test`},{'X-Forwarded-For':`198.51.100.${i+1}`})).status,200);
  const limited=await post({...subscriber,email:'overflow@example.test'},{'X-Forwarded-For':'203.0.113.1'});
  assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
  assert.equal(store.recipients().length,5);assert.equal(store.deliveries().length,0);
});
