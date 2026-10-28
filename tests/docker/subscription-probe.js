// Isolated Docker validation only: all recipients are example.test addresses.
import assert from 'node:assert/strict';
const base='http://127.0.0.1:3000';
const stage=process.argv[2];
async function post(path,body,origin=base){
  return fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
}
async function state(){
  const login=await post('/api/admin/login',{password:'notification-test-only-password'});
  assert.equal(login.status,200);
  const response=await fetch(base+'/api/admin/state',{headers:{Cookie:login.headers.get('set-cookie').split(';')[0]}});
  assert.equal(response.status,200);return response.json();
}
const subscription={name:'订阅验收用户',email:' Reader@Example.Test ',consent:true};
function checkRecipients(current){
  assert.equal(current.recipients.length,2);
  const old=current.recipients.find(r=>r.email==='existing@example.test');
  assert.equal(old.name,'Existing recipient');assert.equal(old.enabled,0);
  const added=current.recipients.find(r=>r.email==='reader@example.test');
  assert.equal(added.name,'订阅验收用户');assert.equal(added.enabled,1);
  assert.equal(current.settings.smtp.hasPassword,true);assert.equal(current.settings.notificationsEnabled,true);
  assert.equal(current.settings.syncEnabled,false);
  assert.ok(!JSON.stringify(current).includes('qa-password'));
}
if(stage==='initial'){
  const before=await state();assert.equal(before.recipients.length,1);
  assert.equal(before.recipients[0].email,'existing@example.test');assert.equal(before.recipients[0].enabled,0);
  assert.equal(before.events.length,1);assert.equal(before.deliveries.length,0);
  for(const path of ['/subscribe','/subscribe/','/subscribe.html']){
    const response=await fetch(base+path);assert.equal(response.status,200);assert.match(response.headers.get('x-robots-tag'),/noindex/);
  }
  const home=await (await fetch(base+'/')).text();assert.doesNotMatch(home,/href\s*=\s*["']\/subscribe/i);
  const created=await post('/api/subscribe',subscription);assert.equal(created.status,200);const expected=await created.json();
  assert.equal(expected.ok,true);assert.equal(expected.id,undefined);
  const duplicate=await post('/api/subscribe',{...subscription,name:'Must not overwrite'});
  assert.equal(duplicate.status,200);assert.deepEqual(await duplicate.json(),expected);
  const paused=await post('/api/subscribe',{...subscription,email:'existing@example.test'});
  assert.equal(paused.status,200);assert.deepEqual(await paused.json(),expected);
  assert.equal((await post('/api/subscribe',{...subscription,consent:false})).status,400);
  assert.equal((await post('/api/subscribe',subscription,'https://unrelated.example')).status,403);
  const current=await state();checkRecipients(current);assert.equal(current.deliveries.length,0);
  const publicState=await (await fetch(base+'/api/status')).text();
  assert.ok(!publicState.includes('reader@example.test'));assert.ok(!publicState.includes('订阅验收用户'));
  assert.equal((await (await fetch('http://smtp:8025/messages')).json()).length,0);
  console.log('PASS: upgraded 1.1.2 data retained disabled recipient and SMTP settings; public subscription added a named enabled recipient, preserved duplicates/paused status, rejected invalid consent/origin, and sent no historical mail.');
}else if(stage==='restarted'){
  checkRecipients(await state());
  const response=await post('/api/subscribe',{...subscription,name:'Must stay unchanged after restart'});
  assert.equal(response.status,200);checkRecipients(await state());
  console.log('PASS: public subscriber name, email and enabled state persisted through container recreation; duplicate submission preserved the original record.');
}else throw new Error('Unknown subscription validation stage');
