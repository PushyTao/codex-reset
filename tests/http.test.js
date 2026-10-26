import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../server/store.js';
import {createVault} from '../server/security.js';
const appModule=await import('../server/app.js').catch(()=>({}));

test('admin endpoints enforce login, CSRF and redact stored SMTP passwords',async()=>{
  assert.equal(typeof appModule.createApp,'function','HTTP application must exist');
  const store=createStore(':memory:');const vault=createVault(Buffer.alloc(32,4));
  const app=appModule.createApp({store,vault,password:'test-admin-password',sync:async()=>({added:0}),sendTest:async()=>({sent:true})});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(path,body,cookie='',csrf=''){
    return fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie,'X-CSRF-Token':csrf},...(body?{body:JSON.stringify(body)}:{})});
  }
  try{
    assert.equal((await call('/api/admin/state')).status,401);
    assert.equal((await call('/api/admin/login',{password:'wrong'})).status,401);
    const login=await call('/api/admin/login',{password:'test-admin-password'});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];const {csrf}=await login.json();
    assert.match(login.headers.get('set-cookie'),/HttpOnly/);
    assert.equal((await call('/api/admin/recipients',{email:'reader@example.com'},cookie)).status,403);
    assert.equal((await call('/api/admin/recipients',{email:'reader@example.com'},cookie,csrf)).status,201);
    const settings={syncEnabled:true,notificationsEnabled:true,pollMinutes:5,smtp:{host:'smtp.example.com',port:587,secure:false,user:'sender@example.com',from:'sender@example.com',password:'private-password'}};
    assert.equal((await call('/api/admin/settings',settings,cookie,csrf)).status,200);
    const state=await (await call('/api/admin/state',null,cookie)).json();
    assert.equal(state.recipients[0].email,'reader@example.com');
    assert.equal(state.settings.smtp.hasPassword,true);
    assert.ok(!JSON.stringify(state).includes('private-password'));
    assert.ok(!JSON.stringify(store.get('config')).includes('private-password'));
    const publicState=await (await call('/api/status')).json();
    assert.ok(!JSON.stringify(publicState).includes('reader@example.com'));
    assert.ok(!JSON.stringify(publicState).includes('smtp.example.com'));
    const csrfAttack=await fetch(base+'/api/admin/settings',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example',Cookie:cookie,'X-CSRF-Token':csrf},body:JSON.stringify(settings)});
    assert.equal(csrfAttack.status,403);
    await call('/api/admin/logout',{},cookie,csrf);
    assert.equal((await call('/api/admin/state',null,cookie)).status,401);
  }finally{await new Promise(r=>server.close(r));store.close();}
});
