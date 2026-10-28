// Runs only in the isolated notifications.compose.yaml project; never sends real mail.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {createStore} from '/app/server/store.js';
import {createVault} from '/app/server/security.js';
import {createSyncService,normalizeReset} from '/app/server/source.js';

const stage=process.argv[2];
const store=createStore('/app/data/reset.sqlite');
const historical={id:'observed-2114588174249071102',reset_type:'regular',announced_at:'2026-10-26T07:00:00.000Z',text:'Fixture historical reset.',source:{type:'observed',url:'https://x.com/thsottiaux/status/2114588174249071102'}};
const announcement={id:'2115273253711409208',status:'scheduled',reset_type:'regular',announced_at:'2026-10-28T02:43:38.000Z',scheduled_for:'2026-10-28T07:00:00.000Z',text:'Fixture reset announcement.',source:{type:'x_post',author:'thsottiaux',url:'https://x.com/thsottiaux/status/2115273253711409208'}};
const completed={...announcement,status:'completed',text:'Fixture reset completed.'};
const inbox=async()=>{
  const response=await fetch('http://smtp:8025/messages');assert.equal(response.status,200);return response.json();
};
async function waitFor(check,timeout=45000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await check())return;await delay(1000);}
  throw new Error('Timed out waiting for the real application scheduler');
}
async function sync(scheduled,done=false){
  const observed={...completed,id:'observed-'+completed.id,source:{type:'observed',url:completed.source.url}};
  return createSyncService(store,{requestJson:async url=>url.includes('/status')
    ?{data:{scheduled_reset:scheduled,latest_reset:done?completed:historical}}
    :{data:done?[observed,historical]:[historical],pagination:{has_more:false,next_cursor:null}}})();
}
async function adminState(){
  const origin='http://127.0.0.1:3000';
  const login=await fetch(origin+'/api/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'notification-test-only-password'})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const response=await fetch(origin+'/api/admin/state',{headers:{Cookie:cookie}});
  assert.equal(response.status,200);return response.json();
}
try{
  assert.equal(process.getuid(),1000);
  if(stage==='seed'){
    assert.equal(store.get('qaNotifications'),null,'Use a fresh isolated validation volume');
    const key=randomBytes(32);writeFileSync('/app/data/secret.key',key,{mode:0o600,flag:'wx'});
    const vault=createVault(key);
    store.set('config',{syncEnabled:false,notificationsEnabled:true,pollMinutes:5,smtp:{host:'smtp',port:2465,secure:true,user:'qa-user',password:vault.encrypt('qa-password'),from:'sender@example.test',fromName:'QA Reset'}});
    store.addRecipient({email:'reader@example.test'});
    store.ingest([normalizeReset(historical)],false);store.set('qaNotifications',{seeded:true});
    console.log('PASS: isolated baseline, credentials and recipient seeded; live upstream disabled.');
  }else if(stage==='announce'){
    assert.equal((await inbox()).length,0);assert.equal((await sync(announcement)).queued,1);
    await waitFor(async()=>(await inbox()).length===1);
    const messages=await inbox();assert.match(messages[0].body,/X-Codex-Reset-Phase: scheduled/i);
    assert.equal(messages[0].encrypted,true);assert.equal(messages[0].authenticated,true);
    assert.equal(store.publicEvents().length,1);
    const state=await adminState();assert.equal(state.deliveries[0].phase,'scheduled');assert.equal(state.deliveries[0].status,'sent');
    store.set('qaKeyFingerprint',readFileSync('/app/data/secret.key').toString('hex'));
    console.log('PASS: actual scheduler sent one authenticated SMTPS announcement; public history stayed unchanged.');
  }else if(stage==='restart'){
    assert.equal(readFileSync('/app/data/secret.key').toString('hex'),store.get('qaKeyFingerprint'));
    assert.equal((await sync({...announcement,text:'Fixture edited announcement.'})).queued,0);
    await delay(16000);assert.equal((await inbox()).length,1);
    assert.equal(store.deliveries().filter(d=>d.status==='sent').length,1);
    console.log('PASS: container recreation retained secrets and delivery ledger; announcement edit was not resent.');
  }else if(stage==='complete'){
    const config=store.get('config');config.smtp.port=2587;config.smtp.secure=false;store.set('config',config);
    assert.equal((await sync(null,true)).queued,1);
    await waitFor(async()=>(await inbox()).length===2);
    const messages=await inbox();assert.match(messages[1].body,/X-Codex-Reset-Phase: reset/i);
    assert.equal(messages[1].encrypted,true);assert.equal(messages[1].authenticated,true);
    const ids=messages.map(m=>m.body.match(/^Message-ID: (.+)$/im)?.[1]);assert.ok(ids.every(Boolean));assert.notEqual(ids[0],ids[1]);
    assert.equal((await sync(null,true)).queued,0);assert.equal(store.publicEvents().length,2);
    assert.equal(store.get('scheduled'),null);
    console.log('PASS: same-source completion sent once using authenticated STARTTLS; history/status aliases did not duplicate it.');
  }else if(stage==='verify'){
    assert.equal((await sync(null,true)).queued,0);await delay(16000);
    assert.equal((await inbox()).length,2);
    const state=await adminState();assert.deepEqual(state.deliveries.map(d=>d.phase).sort(),['reset','scheduled']);
    assert.ok(state.deliveries.every(d=>d.status==='sent'));
    assert.equal(state.settings.smtp.hasPassword,true);assert.equal(state.settings.smtp.password,undefined);
    console.log('PASS: both phases survived another container recreation and stayed silent on repeat synchronization.');
  }else if(stage==='retry'){
    await fetch('http://smtp:8025/reject-next',{method:'POST'});
    const next={...announcement,id:'2115273253711409209',source:{...announcement.source,url:'https://x.com/thsottiaux/status/2115273253711409209'}};
    assert.equal((await sync(next,true)).queued,1);
    await waitFor(()=>store.deliveries().some(d=>d.status==='failed'&&d.attempts===1));
    assert.equal((await inbox()).length,2);console.log('PASS: explicit SMTP 451 rejection recorded; waiting for real retry backoff.');
    await waitFor(async()=>(await inbox()).length===3,100000);
    const row=store.deliveries()[0];assert.equal(row.status,'sent');assert.equal(row.attempts,2);
    assert.equal((await sync(next,true)).queued,0);
    await delay(16000);assert.equal((await inbox()).length,3);
    console.log('PASS: real retry produced exactly one accepted email, then stopped.');
  }else throw new Error('Unknown stage');
}finally{store.close();}
