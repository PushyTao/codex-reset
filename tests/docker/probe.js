import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const base='http://127.0.0.1:3000',origin='http://127.0.0.1:3100';
const password=readFileSync('/app/data/admin-password.txt','utf8').trim();
let cookie='',csrf='';
const hashFile=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
async function request(path,body,extra={}){
  const res=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf,...extra},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
  const text=await res.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  return {status:res.status,headers:res.headers,data};
}
async function ok(path,body){const res=await request(path,body);assert.ok(res.status>=200&&res.status<300,`${path}: HTTP ${res.status} ${JSON.stringify(res.data)}`);return res.data;}
async function login(){const res=await request('/api/admin/login',{password});assert.equal(res.status,200);cookie=res.headers.get('set-cookie').split(';')[0];csrf=res.data.csrf;assert.match(res.headers.get('set-cookie'),/HttpOnly/);}
async function messages(){return (await fetch('http://smtp:8025/messages')).json();}
async function waitFor(predicate,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){const value=await predicate();if(value)return value;await new Promise(r=>setTimeout(r,500));}throw new Error('Timed out waiting for application worker');}
const smtp=(port,secure)=>({host:'smtp',port,secure,user:'qa-user',password:'qa-password',from:'sender@example.com',fromName:'Docker verification'});
async function config(port,secure,notificationsEnabled=true){return ok('/api/admin/settings',{syncEnabled:false,pollMinutes:5,notificationsEnabled,smtp:smtp(port,secure)});}
const mode=process.argv[2]||'initial';
assert.notEqual(process.getuid(),0,'application must run without root');
assert.equal(statSync('/app/data/secret.key').mode&0o777,0o600);
assert.equal(statSync('/app/data/admin-password.txt').mode&0o777,0o600);
assert.equal((await request('/api/admin/state')).status,401);

if(mode==='initial'){
  assert.equal((await request('/healthz')).status,200);
  const home=await request('/');assert.equal(home.status,200);assert.ok(!/href=["'][^"']*\/admin/.test(home.data));
  assert.equal((await request('/admin')).headers.get('x-robots-tag'),'noindex, nofollow');
  assert.equal((await request('/.env')).status,404);assert.equal((await request('/data/secret.key')).status,404);
  await login();
  const before=await ok('/api/admin/state');
  let live=before.sync;
  if(!live.lastSuccess){await request('/api/admin/sync',{});live=(await ok('/api/admin/state')).sync;}
  console.log(JSON.stringify({check:'live-source',success:!!live.lastSuccess,count:live.count||0,error:live.error||null}));
  const recipient=await ok('/api/admin/recipients',{email:'docker-qa@example.com',name:'isolated fixture'});
  assert.equal((await request('/api/admin/recipients',{email:'blocked@example.com'},{'X-CSRF-Token':''})).status,403);
  assert.equal((await request('/api/admin/recipients',{email:'blocked@example.com'},{Origin:'https://untrusted.example'})).status,403);
  await config(2465,true);
  await ok('/api/admin/test-email',{recipientId:recipient.id});
  let inbox=await messages();assert.equal(inbox.length,1);assert.ok(inbox[0].encrypted&&inbox[0].authenticated);
  // A real application queue item, delivered by the production 15-second scheduler.
  const event={source_url:'https://x.com/thsottiaux/status/9999999999999999991',occurred_at:new Date().toISOString(),text:'Docker verification reset; no real announcement.',summary:'Isolated verification only',kind:'regular',notify:true};
  assert.equal((await ok('/api/admin/events',event)).queued,1);
  assert.equal((await request('/api/admin/events',event)).status,409);
  await waitFor(async()=>{const s=await ok('/api/admin/state');return s.deliveries.some(d=>d.status==='sent');});
  inbox=await messages();assert.equal(inbox.length,2);assert.match(inbox[1].body,/9999999999999999991/);
  assert.equal(inbox[1].to,'<docker-qa@example.com>');assert.ok(inbox[1].encrypted&&inbox[1].authenticated);
  const state=await ok('/api/admin/state');assert.equal(state.settings.smtp.hasPassword,true);assert.ok(!JSON.stringify(state).includes('qa-password'));
  const publicData=await ok('/api/status');assert.ok(!JSON.stringify(publicData).includes('docker-qa@example.com'));
  const db=new DatabaseSync('/app/data/reset.sqlite',{readOnly:true});const saved=db.prepare("SELECT value FROM settings WHERE key='config'").get();assert.ok(!saved.value.includes('qa-password'));db.close();
  writeFileSync('/app/data/qa-snapshot.json',JSON.stringify({cookie,csrf,recipientId:recipient.id,secret:hashFile('/app/data/secret.key'),password:hashFile('/app/data/admin-password.txt'),eventCount:state.events.length,messageCount:inbox.length}),{mode:0o600});
  console.log('PASS initial: HTTP/auth/CSRF/privacy, encrypted credentials, SMTPS test mail, scheduler delivery, duplicate rejection.');
}else if(mode==='restarted'){
  const snapshot=JSON.parse(readFileSync('/app/data/qa-snapshot.json','utf8'));
  cookie=snapshot.cookie;csrf=snapshot.csrf;assert.equal((await request('/api/admin/state')).status,401,'restart invalidates old sessions');
  assert.equal(hashFile('/app/data/secret.key'),snapshot.secret);assert.equal(hashFile('/app/data/admin-password.txt'),snapshot.password);
  await login();const state=await ok('/api/admin/state');assert.equal(state.events.length,snapshot.eventCount);assert.ok(state.recipients.some(r=>r.id===snapshot.recipientId));assert.equal(state.settings.smtp.hasPassword,true);
  await new Promise(r=>setTimeout(r,16000));assert.equal((await messages()).length,snapshot.messageCount,'restart must not resend delivered messages');
  // Blank password retains the original encrypted secret, proving it decrypts after restart.
  await ok('/api/admin/settings',{...state.settings,smtp:{...state.settings.smtp,password:'',port:2587,secure:false}});
  await ok('/api/admin/test-email',{recipientId:snapshot.recipientId});
  let inbox=await messages();assert.equal(inbox.length,snapshot.messageCount+1);assert.ok(inbox.at(-1).encrypted&&inbox.at(-1).authenticated);
  console.log('PASS restarted: SQLite, secret key, password, recipient/settings persistence, session invalidation, no duplicate sends, STARTTLS authenticated delivery.');
}else if(mode==='verify-restarted'){
  // Read-only postconditions, safe to repeat after the STARTTLS test has completed.
  const snapshot=JSON.parse(readFileSync('/app/data/qa-snapshot.json','utf8'));
  cookie=snapshot.cookie;csrf=snapshot.csrf;assert.equal((await request('/api/admin/state')).status,401);
  assert.equal(hashFile('/app/data/secret.key'),snapshot.secret);assert.equal(hashFile('/app/data/admin-password.txt'),snapshot.password);
  await login();const state=await ok('/api/admin/state');
  assert.equal(state.events.length,snapshot.eventCount);assert.ok(state.recipients.some(r=>r.id===snapshot.recipientId));
  assert.equal(state.settings.smtp.hasPassword,true);assert.equal(state.settings.smtp.port,2587);
  assert.equal(state.settings.smtp.secure,false);
  const inbox=await messages();assert.equal(inbox.length,snapshot.messageCount+1);
  assert.ok(inbox.every(message=>message.encrypted&&message.authenticated));
  assert.equal(state.deliveries.filter(delivery=>delivery.status==='sent').length,1);
  console.log('PASS verify-restarted: persisted data/keys, invalidated old session, STARTTLS configuration, three authenticated TLS messages and no duplicate queue delivery.');
}else if(mode==='negative'){
  const snapshot=JSON.parse(readFileSync('/app/data/qa-snapshot.json','utf8'));await login();
  await config(2525,false);let before=(await messages()).length;
  const plaintext=await request('/api/admin/test-email',{recipientId:snapshot.recipientId});assert.equal(plaintext.status,400);assert.equal((await messages()).length,before);
  await new Promise(r=>setTimeout(r,10500));
  await config(2465,true);await fetch('http://smtp:8025/reject-next',{method:'POST'});
  const event={source_url:'https://x.com/thsottiaux/status/9999999999999999992',occurred_at:new Date().toISOString(),text:'Docker retry verification only.',summary:'Retry fixture',kind:'banked',notify:true};
  await ok('/api/admin/events',event);
  const failed=await waitFor(async()=>{const s=await ok('/api/admin/state');return s.deliveries.find(d=>d.summary==='Retry fixture'&&d.status==='failed');});
  assert.equal(failed.attempts,1);assert.equal(failed.sent_at,null);assert.equal((await messages()).length,before);
  console.log('PASS negative: plaintext SMTP rejected; temporary SMTP error recorded without false success.');
  const sent=await waitFor(async()=>{const s=await ok('/api/admin/state');return s.deliveries.find(d=>d.id===failed.id&&d.status==='sent');},90000);
  assert.equal(sent.attempts,2);const inbox=await messages();assert.equal(inbox.length,before+1);assert.ok(inbox.at(-1).encrypted);
  await config(2465,true,false);
  console.log('PASS retry: real scheduler retried after backoff, exactly one accepted mail, attempts=2; notifications disabled for teardown.');
}else if(mode==='live'){
  await login();
  const result=await ok('/api/admin/sync',{});
  assert.ok(result.count>0);
  const state=await ok('/api/admin/state');assert.ok(state.sync.lastSuccess);assert.equal(state.sync.error,null);
  console.log(JSON.stringify({check:'live-source',success:true,count:result.count,added:result.added,queued:result.queued,baseline:result.baseline}));
}else throw new Error('Unknown probe mode');
