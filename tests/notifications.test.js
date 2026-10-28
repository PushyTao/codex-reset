import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createStore} from '../server/store.js';
import {createSyncService,normalizeReset} from '../server/source.js';
import {createMailer} from '../server/mail.js';
import {createVault} from '../server/security.js';

const history={id:'observed-2114588174249071102',reset_type:'regular',announced_at:'2026-10-26T07:00:00.000Z',text:'Limits have been reset.',source:{type:'observed',url:'https://x.com/thsottiaux/status/2114588174249071102'}};
const announcement={id:'2115273253711409208',status:'scheduled',reset_type:'regular',announced_at:'2026-10-28T02:43:38.000Z',scheduled_for:'2026-10-28T07:00:00.000Z',text:'Lands by midnight PST.',source:{type:'x_post',author:'thsottiaux',url:'https://x.com/thsottiaux/status/2115273253711409208'}};
const completed={...announcement,status:'completed',text:'Codex limits have now been reset.'};
const config={notificationsEnabled:true,smtp:{host:'smtp.example.com',from:'sender@example.com',fromName:'Reset'}};
const vault=createVault(Buffer.alloc(32,7));
function upstream(){
  return {
    records:[history],scheduled:announcement,latest:history,historyError:null,statusError:null,
    async request(url){
      if(new URL(url).pathname==='/api/v1/status'){
        if(this.statusError)throw this.statusError;
        return {data:{latest_reset:this.latest,scheduled_reset:this.scheduled,active_watch:null,stats:{total:this.records.length}},meta:{api_version:'v1'}};
      }
      if(this.historyError)throw this.historyError;
      return {data:this.records,pagination:{has_more:false,next_cursor:null},meta:{api_version:'v1'}};
    }
  };
}
function services(store,api,messages){
  return {
    sync:createSyncService(store,{requestJson:api.request.bind(api)}),
    mail:createMailer(store,vault,{send:async message=>{messages.push(message);}})
  };
}
function setup(store){store.set('config',config);store.addRecipient({email:'reader@example.com'});}

test('first sync emails the active announcement once per enabled recipient without mailing history',async()=>{
  const store=createStore(':memory:');
  try{
    setup(store);store.addRecipient({email:'second@example.com'});
    const disabled=store.addRecipient({email:'disabled@example.com'});store.updateRecipient(disabled,false);
    const api=upstream(),messages=[];const {sync,mail}=services(store,api,messages);
    await sync();await Promise.all([mail.drain(),mail.drain()]);await sync();await mail.drain();
    assert.equal(messages.length,2);
    assert.deepEqual(messages.map(m=>m.to).sort(),['reader@example.com','second@example.com']);
    for(const message of messages){
      assert.match(message.subject,/预告/);assert.match(message.text,/尚未确认/);
      assert.match(message.text,/15:00:00/);assert.match(message.text,/2115273253711409208/);
      assert.equal(message.headers['X-Codex-Reset-Phase'],'scheduled');
    }
    assert.equal(store.publicEvents().length,1);assert.equal(store.allEvents().length,1);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM events WHERE status='published'").get().n,1,'Older releases must not display announcements as completed resets');
    assert.equal(store.get('scheduled').source_id,announcement.id);
    assert.equal(store.deliveries().filter(d=>d.phase==='scheduled'&&d.status==='sent').length,2);
  }finally{store.close();}
});

test('announcement edits and process restarts stay silent; completion of the same source sends once more',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'reset-notifications-'));const path=join(directory,'reset.sqlite');
  let store=createStore(path);
  try{
    setup(store);const api=upstream(),messages=[];
    let service=services(store,api,messages);
    await service.sync();await service.mail.drain();assert.equal(messages.length,1);
    api.scheduled={...announcement,scheduled_for:'2026-10-28T08:00:00.000Z',text:'Time updated.'};
    await service.sync();await service.mail.drain();assert.equal(messages.length,1);
    store.close();store=createStore(path);service=services(store,api,messages);
    await service.sync();await service.mail.drain();assert.equal(messages.length,1);
    api.scheduled=null;api.records=[completed,history];api.latest=completed;
    await service.sync();await service.mail.drain();await service.sync();await service.mail.drain();
    assert.equal(messages.length,2);assert.match(messages[1].subject,/重置/);
    assert.doesNotMatch(messages[1].subject,/预告/);
    assert.equal(messages[1].headers['X-Codex-Reset-Phase'],'reset');
    assert.notEqual(messages[0].messageId,messages[1].messageId);
    assert.equal(store.publicEvents().length,2);assert.equal(store.get('scheduled'),null);
    store.close();store=createStore(path);service=services(store,api,messages);
    await service.sync();await service.mail.drain();assert.equal(messages.length,2);
    assert.equal(store.deliveries().filter(d=>d.status==='sent').length,2);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('status announcements and confirmed resets remain usable during a history outage',async()=>{
  const store=createStore(':memory:');
  try{
    setup(store);store.ingest([normalizeReset(history)],true);
    const api=upstream(),messages=[];api.historyError=new Error('数据源返回 HTTP 503');
    const service=services(store,api,messages);
    await assert.rejects(service.sync());await service.mail.drain();
    assert.equal(messages.length,1);assert.match(messages[0].subject,/预告/);
    api.latest=completed;api.scheduled=null;
    await assert.rejects(service.sync());await service.mail.drain();
    assert.equal(messages.length,2);assert.equal(messages[1].headers['X-Codex-Reset-Phase'],'reset');
    assert.equal(store.get('sourceWatermark'),history.announced_at);
    api.historyError=null;api.records=[completed,history];
    await service.sync();await service.mail.drain();assert.equal(messages.length,2);
    assert.equal(store.get('syncState').error,null);
  }finally{store.close();}
});

test('history notifications still work if the status endpoint is unavailable',async()=>{
  const store=createStore(':memory:');
  try{
    setup(store);store.ingest([normalizeReset(history)],true);
    const api=upstream(),messages=[];api.records=[completed,history];api.statusError=new Error('数据源返回 HTTP 503');
    const service=services(store,api,messages);
    await assert.rejects(service.sync());await service.mail.drain();
    assert.equal(messages.length,1);assert.equal(messages[0].headers['X-Codex-Reset-Phase'],'reset');
  }finally{store.close();}
});

test('history backoff does not stop status updates or create duplicate announcement deliveries',async()=>{
  const store=createStore(':memory:');
  try{
    setup(store);const api=upstream(),messages=[];
    api.historyError=Object.assign(new Error('数据源返回 HTTP 503'),{retryAfter:600});
    const service=services(store,api,messages);
    await assert.rejects(service.sync());await service.mail.drain();assert.equal(messages.length,1);
    const retryAt=store.get('syncState').historyNextAllowed;assert.ok(retryAt>Date.now());
    api.scheduled=null;api.latest=completed;
    await assert.rejects(service.sync());await service.mail.drain();assert.equal(messages.length,2);
    assert.equal(store.get('syncState').historyNextAllowed,retryAt);
    await assert.rejects(service.sync());await service.mail.drain();assert.equal(messages.length,2);
  }finally{store.close();}
});

test('a tracked announcement can be confirmed before the first complete history import',async()=>{
  const store=createStore(':memory:');
  try{
    setup(store);const api=upstream(),messages=[];api.historyError=new Error('数据源返回 HTTP 503');
    const service=services(store,api,messages);
    await assert.rejects(service.sync());await service.mail.drain();assert.equal(messages.length,1);
    assert.equal(store.get('sourceInitialized',false),false);
    api.scheduled=null;api.latest=completed;
    await assert.rejects(service.sync());await service.mail.drain();
    assert.equal(messages.length,2);assert.equal(messages[1].headers['X-Codex-Reset-Phase'],'reset');
    api.historyError=null;api.records=[completed,history];
    await service.sync();await service.mail.drain();assert.equal(messages.length,2);
  }finally{store.close();}
});

test('status tracks a new completion post even when initial history remains unavailable',async()=>{
  const store=createStore(':memory:');
  try{
    setup(store);const api=upstream(),messages=[];api.historyError=new Error('数据源返回 HTTP 503');
    const service=services(store,api,messages);
    await assert.rejects(service.sync());await service.mail.drain();assert.equal(messages.length,1);
    const newPost={...completed,id:'2115273253711409210',source:{...completed.source,url:'https://x.com/thsottiaux/status/2115273253711409210'}};
    api.scheduled=null;api.latest=newPost;
    await assert.rejects(service.sync());await service.mail.drain();
    assert.equal(messages.length,2);assert.match(messages[1].text,/2115273253711409210/);
    assert.equal(store.get('sourceInitialized',false),false);
    assert.equal(store.get('sourceWatermark'),null);
    api.historyError=null;api.records=[newPost,history];
    await service.sync();await service.mail.drain();assert.equal(messages.length,2);
  }finally{store.close();}
});

test('completion still notifies when its original announcement timestamp is behind the history watermark',async()=>{
  const store=createStore(':memory:');
  try{
    setup(store);const api=upstream(),messages=[];const service=services(store,api,messages);
    await service.sync();await service.mail.drain();
    const later={...history,id:'observed-another-reset',announced_at:'2026-10-28T03:00:00.000Z',source:{type:'observed'}};
    api.records=[later,history];api.latest=later;
    await service.sync();await service.mail.drain();assert.equal(messages.length,2);
    api.records=[later,completed,history];api.scheduled=null;
    await service.sync();await service.mail.drain();await service.sync();await service.mail.drain();
    assert.equal(messages.length,3);assert.match(messages[2].text,/2115273253711409208/);
    assert.equal(messages[2].headers['X-Codex-Reset-Phase'],'reset');
  }finally{store.close();}
});

test('history and status aliases for the same verified post produce only one completion email',async()=>{
  for(const observedFirst of [true,false]){
    const store=createStore(':memory:');
    try{
      setup(store);const api=upstream(),messages=[];const service=services(store,api,messages);
      await service.sync();await service.mail.drain();
      const observed={...completed,id:'observed-'+completed.id,source:{...completed.source,type:'observed'}};
      api.records=[observedFirst?observed:completed,history];api.latest=observedFirst?completed:observed;api.scheduled=null;
      await service.sync();await service.mail.drain();await service.sync();await service.mail.drain();
      assert.equal(messages.length,2);assert.equal(store.publicEvents().length,2);
      assert.equal(store.deliveries().filter(d=>d.phase==='reset').length,1);
    }finally{store.close();}
  }
});

test('observed and numeric announcement aliases without URLs share the same delivery history',async()=>{
  const store=createStore(':memory:');
  try{
    setup(store);const api=upstream(),messages=[];const service=services(store,api,messages);
    const observed={...announcement,id:'observed-'+announcement.id,source:{type:'observed'}};
    api.scheduled=observed;await service.sync();await service.mail.drain();
    api.scheduled={...observed,id:announcement.id};await service.sync();await service.mail.drain();
    assert.equal(messages.length,1);
    const reset={...completed,source:{type:'observed'}};
    api.records=[reset,history];api.latest=reset;api.scheduled=observed;
    await service.sync();await service.mail.drain();await service.sync();await service.mail.drain();
    assert.equal(messages.length,2);assert.equal(store.get('scheduled'),null);
  }finally{store.close();}
});

test('completion cancels unsent announcement mail and stale status cannot queue it again',async()=>{
  const store=createStore(':memory:');
  try{
    setup(store);const api=upstream(),messages=[];const service=services(store,api,messages);
    await service.sync();assert.equal(store.deliveries().length,1);
    api.records=[completed,history];api.latest=completed;
    await service.sync();await service.mail.drain();await service.sync();await service.mail.drain();
    assert.equal(messages.length,1);assert.equal(messages[0].headers['X-Codex-Reset-Phase'],'reset');
    assert.equal(store.get('scheduled'),null);
    assert.equal(store.deliveries().find(d=>d.phase==='scheduled').status,'cancelled');
  }finally{store.close();}
});

test('enriching an existing completed reset clears its cached announcement during a status outage',async()=>{
  const store=createStore(':memory:');
  try{
    setup(store);const api=upstream(),messages=[];
    const observed={...completed,id:'observed-stable-upstream',source:{type:'observed'}};
    api.records=[observed,history];api.latest=observed;
    const service=services(store,api,messages);
    await service.sync();assert.ok(store.get('scheduled'));
    api.records=[{...observed,source:{type:'observed',url:announcement.source.url}},history];
    api.statusError=new Error('数据源返回 HTTP 503');
    await assert.rejects(service.sync());
    assert.equal(store.get('scheduled'),null);await service.mail.drain();assert.equal(messages.length,0);
  }finally{store.close();}
});

test('announcement without an ETA is delivered once and a withdrawn announcement is not retried',async()=>{
  const store=createStore(':memory:');
  try{
    setup(store);const api=upstream(),messages=[];api.scheduled={...announcement,scheduled_for:null};
    const service=services(store,api,messages);
    await service.sync();await service.mail.drain();
    assert.equal(messages.length,1);assert.match(messages[0].text,/未公布/);assert.doesNotMatch(messages[0].text,/Invalid Date|1970/);
    api.scheduled={...announcement,id:'2115273253711409209',source:{...announcement.source,url:'https://x.com/thsottiaux/status/2115273253711409209'}};
    await service.sync();api.scheduled=null;await service.sync();await service.mail.drain();
    assert.equal(messages.length,1);assert.equal(store.deliveries().filter(d=>d.status==='cancelled').length,1);
  }finally{store.close();}
});

test('old databases retain accepted deliveries when notification phases are added',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'reset-migration-'));const path=join(directory,'reset.sqlite');
  const legacy=new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE events(id INTEGER PRIMARY KEY,source_id TEXT UNIQUE NOT NULL,source_url TEXT NOT NULL,occurred_at TEXT NOT NULL,text TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL,origin TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'published',created_at TEXT NOT NULL DEFAULT '2026-10-26T00:00:00Z',source_type TEXT NOT NULL DEFAULT 'x_post');
    CREATE TABLE recipients(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT '2026-10-26T00:00:00Z');
    CREATE TABLE deliveries(id INTEGER PRIMARY KEY,event_id INTEGER NOT NULL REFERENCES events(id),recipient_id INTEGER NOT NULL REFERENCES recipients(id),status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,error TEXT,sent_at TEXT,UNIQUE(event_id,recipient_id));
    INSERT INTO recipients(id,email) VALUES(1,'reader@example.com');
  `);
  legacy.prepare('INSERT INTO events(id,source_id,source_url,occurred_at,text,kind,origin,source_type) VALUES(1,?,?,?,?,?,?,?)').run(history.id,history.source.url,history.announced_at,history.text,'regular','codex-resets','observed');
  legacy.exec("INSERT INTO deliveries(id,event_id,recipient_id,status,attempts,sent_at) VALUES(1,1,1,'sent',1,'2026-10-26T07:01:00Z')");legacy.close();
  const store=createStore(path);
  try{
    store.set('config',config);store.set('sourceInitialized',true);store.set('sourceWatermark',history.announced_at);
    const api=upstream(),messages=[];const service=services(store,api,messages);
    await service.sync();await service.mail.drain();await service.sync();await service.mail.drain();
    assert.equal(messages.length,1);assert.equal(messages[0].headers['X-Codex-Reset-Phase'],'scheduled');
    const old=store.deliveries().find(d=>d.id===1);
    assert.equal(old.status,'sent');assert.equal(old.attempts,1);assert.equal(old.phase,'reset');
    assert.equal(old.sent_at,'2026-10-26T07:01:00Z');assert.equal(store.publicEvents().length,1);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

const originalAnnouncement={...announcement,id:'2115273064481218829',announced_at:'2026-10-28T02:42:53.000Z',text:'Day 23/ Today is a reset.',source:{...announcement.source,url:'https://x.com/thsottiaux/status/2115273064481218829'}};
const completionPost={...completed,id:'2115297093879472332',announced_at:'2026-10-28T04:18:22.000Z',text:'It has landed',source:{...completed.source,url:'https://x.com/thsottiaux/status/2115297093879472332'}};

test('an older announcement under another post ID stays silent after completion and restart',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'reset-stale-announcement-')),path=join(directory,'reset.sqlite');
  let store=createStore(path);
  try{
    setup(store);const api=upstream(),messages=[];let service=services(store,api,messages);
    await service.sync();await service.mail.drain();assert.equal(messages.length,1);
    api.records=[completionPost,history];api.latest=completionPost;api.scheduled=null;
    await service.sync();await service.mail.drain();assert.equal(messages.length,2);
    store.close();store=createStore(path);service=services(store,api,messages);
    api.scheduled=originalAnnouncement;
    await service.sync();await service.mail.drain();await service.sync();await service.mail.drain();
    assert.equal(messages.length,2,'Do not mail the earlier original post after the completion notice');
    assert.deepEqual(messages.map(m=>m.headers['X-Codex-Reset-Phase']),['scheduled','reset']);
    assert.equal(store.get('scheduled'),null);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('different announcement posts for the same type and ETA share one notification',async()=>{
  const store=createStore(':memory:');
  try{
    setup(store);const api=upstream(),messages=[];const service=services(store,api,messages);
    await service.sync();await service.mail.drain();
    api.scheduled=originalAnnouncement;await service.sync();await service.mail.drain();
    api.scheduled=announcement;await service.sync();await service.mail.drain();
    assert.equal(messages.length,1);
    assert.equal(store.deliveries().length,1);
    assert.equal(store.get('scheduled').source_id,announcement.id);
  }finally{store.close();}
});

test('startup cancels a legacy queued preview when a newer reset is already stored',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'reset-legacy-preview-')),path=join(directory,'reset.sqlite');
  let store=createStore(path);
  try{
    setup(store);const api=upstream(),messages=[];
    await services(store,api,messages).sync();
    // A previous release could store an unrelated completion ID without cancelling this preview.
    const event=normalizeReset(completionPost);
    store.db.prepare('INSERT INTO events(source_id,source_url,occurred_at,text,summary,kind,origin,source_type) VALUES(?,?,?,?,?,?,?,?)').run(event.source_id,event.source_url,event.occurred_at,event.text,event.summary,event.kind,event.origin,event.source_type);
    store.close();store=createStore(path);
    await services(store,api,messages).mail.drain();
    assert.equal(messages.length,0);
    assert.equal(store.deliveries()[0].status,'cancelled');
    assert.equal(store.get('scheduled'),null);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('a fresh announcement after completion is not merged into the old ETA cycle',async()=>{
  const store=createStore(':memory:');
  try{
    setup(store);const api=upstream(),messages=[];const service=services(store,api,messages);
    await service.sync();await service.mail.drain();
    api.records=[completionPost,history];api.latest=completionPost;api.scheduled=null;
    await service.sync();await service.mail.drain();
    api.scheduled={...originalAnnouncement,announced_at:'2026-10-28T05:00:00.000Z'};
    await service.sync();await service.mail.drain();
    assert.equal(messages.length,3);assert.equal(messages[2].headers['X-Codex-Reset-Phase'],'scheduled');
    assert.equal(store.get('scheduled').source_id,originalAnnouncement.id);
  }finally{store.close();}
});

test('a regular completion does not cancel a pending banked announcement',async()=>{
  const store=createStore(':memory:');
  try{
    setup(store);const api=upstream(),messages=[];const service=services(store,api,messages);
    api.scheduled={...announcement,reset_type:'banked'};
    await service.sync();
    api.records=[completionPost,history];api.latest=completionPost;
    await service.sync();await service.mail.drain();
    assert.equal(messages.length,2);
    assert.equal(messages[0].headers['X-Codex-Reset-Phase'],'scheduled');
    assert.equal(messages[0].headers['X-Codex-Reset-Type'],'banked');
    assert.equal(store.get('scheduled').kind,'banked');
  }finally{store.close();}
});

test('distinct dates and unknown ETAs are not grouped as one planned reset',async()=>{
  for(const eta of ['2026-10-29T07:00:00.000Z',null]){
    const store=createStore(':memory:');
    try{
      setup(store);const api=upstream(),messages=[];const service=services(store,api,messages);
      if(eta===null)api.scheduled={...announcement,scheduled_for:null};
      await service.sync();await service.mail.drain();
      api.scheduled={...originalAnnouncement,scheduled_for:eta};
      await service.sync();await service.mail.drain();
      assert.equal(messages.length,2);assert.equal(store.deliveries().length,2);
    }finally{store.close();}
  }
});
