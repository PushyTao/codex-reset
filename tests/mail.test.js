import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createStore} from '../server/store.js';
import {createVault} from '../server/security.js';
const mail=await import('../server/mail.js').catch(()=>({}));
const event={source_id:'2114588174249071102',source_url:'https://x.com/thsottiaux/status/2114588174249071102',occurred_at:'2026-10-26T07:00:00.000Z',text:'Reset is ready.',summary:'额度已重置',kind:'regular',origin:'codex-resets'};

test('SMTP delivery is addressed individually, persisted, and not repeated by subsequent workers',async()=>{
  assert.equal(typeof mail.createMailer,'function');
  const messages=[];
  const smtp=net.createServer(socket=>{
    socket.setEncoding('utf8');socket.write('220 localhost SMTP test\r\n');let buffer='',dataMode=false,body='',recipient='';
    socket.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+2);
      if(dataMode){if(line==='.'){messages.push({recipient,body});dataMode=false;body='';socket.write('250 queued\r\n');}else body+=line+'\r\n';continue;}
      if(/^EHLO|^HELO/.test(line))socket.write('250-localhost\r\n250 PIPELINING\r\n');
      else if(/^RCPT TO:/.test(line)){recipient=line;socket.write('250 OK\r\n');}
      else if(line==='DATA'){dataMode=true;socket.write('354 End with dot\r\n');}
      else if(line==='QUIT'){socket.end('221 bye\r\n');}
      else socket.write('250 OK\r\n');
    }});
  });
  smtp.listen(0,'127.0.0.1');await new Promise(r=>smtp.once('listening',r));
  const store=createStore(':memory:');const vault=createVault(Buffer.alloc(32,7));
  try{
    store.set('config',{notificationsEnabled:true,smtp:{host:'127.0.0.1',port:smtp.address().port,secure:false,user:'',password:'',from:'sender@example.com',fromName:'Reset'}});
    store.addRecipient({email:'one@example.com'});store.addRecipient({email:'two@example.com'});store.addEvent(event,true);
    const service=mail.createMailer(store,vault,{allowInsecureLocal:true});
    await Promise.all([service.drain(),service.drain()]);await service.drain();
    assert.equal(messages.length,2);assert.equal(store.deliveries().filter(d=>d.status==='sent').length,2);
    assert.match(messages[0].recipient,/one@example.com/);assert.ok(!messages[0].body.includes('two@example.com'));
    assert.match(messages[0].body,/codex-resets\.com/);
    assert.match(messages[0].body,/2114588174249071102/);
  }finally{store.close();await new Promise(r=>smtp.close(r));}
});

test('failed delivery stays retryable without claiming sent; paused recipients are not contacted',async()=>{
  assert.equal(typeof mail.createMailer,'function');
  const store=createStore(':memory:');const vault=createVault(Buffer.alloc(32,7));
  try{
    store.set('config',{notificationsEnabled:true,smtp:{host:'smtp.invalid',port:587,from:'sender@example.com'}});
    const id=store.addRecipient({email:'one@example.com'});store.addEvent(event,true);
    const service=mail.createMailer(store,vault,{send:async()=>{throw new Error('private-password should not leak');}});
    await service.drain();const row=store.deliveries()[0];assert.equal(row.status,'failed');assert.equal(row.attempts,1);assert.equal(row.sent_at,null);assert.ok(!row.error.includes('private-password'));
    store.updateRecipient(id,false);store.db.prepare('UPDATE deliveries SET next_attempt=0').run();
    await service.drain();assert.equal(store.deliveries()[0].attempts,1);
  }finally{store.close();}
});
