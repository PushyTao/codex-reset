import {DatabaseSync} from 'node:sqlite';
import {emailAddress, InputError} from './validation.js';

function verifiedPostId(value){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||!['x.com','twitter.com','www.x.com','www.twitter.com'].includes(url.hostname)||url.username||url.password||url.port)return null;
    return url.pathname.match(/^\/thsottiaux\/status\/(\d{10,25})\/?$/i)?.[1]||null;
  }catch{return null;}
}
function sourceAliases(value){
  const numeric=value.match(/^(?:observed-)?(\d{10,25})$/)?.[1];
  return numeric?[numeric,`observed-${numeric}`]:[value];
}

export function createStore(path) {
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recipients(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,source_id TEXT UNIQUE NOT NULL,source_url TEXT NOT NULL,occurred_at TEXT NOT NULL,text TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL CHECK(kind IN ('regular','banked')),origin TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'published',created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS deliveries(id INTEGER PRIMARY KEY,event_id INTEGER NOT NULL REFERENCES events(id),recipient_id INTEGER NOT NULL REFERENCES recipients(id),status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,error TEXT,sent_at TEXT,UNIQUE(event_id,recipient_id));
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS event_time ON events(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS delivery_pending ON deliveries(status,next_attempt);
  `);
  if(!db.prepare('PRAGMA table_info(events)').all().some(c=>c.name==='source_type'))db.exec("ALTER TABLE events ADD COLUMN source_type TEXT NOT NULL DEFAULT 'x_post'");
  if(!db.prepare('PRAGMA table_info(events)').all().some(c=>c.name==='phase'))db.exec("ALTER TABLE events ADD COLUMN phase TEXT NOT NULL DEFAULT 'reset' CHECK(phase IN ('reset','scheduled'))");
  if(!db.prepare('PRAGMA table_info(events)').all().some(c=>c.name==='scheduled_for'))db.exec('ALTER TABLE events ADD COLUMN scheduled_for TEXT');
  const get=(key,fallback=null)=>{const row=db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(row.value):fallback;};
  const set=(key,value)=>db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
  const insert=db.prepare('INSERT OR IGNORE INTO events(source_id,source_url,occurred_at,text,summary,kind,origin,source_type) VALUES (?,?,?,?,?,?,?,?)');
  const bySource=db.prepare("SELECT * FROM events WHERE source_id=? AND phase='reset'");
  const byKind=db.prepare("SELECT * FROM events WHERE kind=? AND phase='reset' AND origin IN ('codex-resets','manual')");
  const refresh=db.prepare('UPDATE events SET source_id=?,source_url=?,occurred_at=?,text=?,summary=?,kind=?,origin=?,source_type=? WHERE id=?');
  const queue=db.prepare('INSERT OR IGNORE INTO deliveries(event_id,recipient_id) SELECT ?,id FROM recipients WHERE enabled=1');
  const scheduledBySource=db.prepare("SELECT * FROM events WHERE source_id=? AND phase='scheduled'");
  const scheduledByKind=db.prepare("SELECT * FROM events WHERE kind=? AND phase='scheduled'");
  const scheduledKey=event=>`scheduled:${event.kind}:${event.source_id}`;
  const latestResetTime=kind=>byKind.all(kind).reduce((time,row)=>row.occurred_at>time?row.occurred_at:time,'');
  function findScheduled(event){
    const exact=scheduledBySource.get(scheduledKey(event));
    if(exact)return exact;
    for(const source_id of sourceAliases(event.source_id)){
      const alias=scheduledBySource.get(scheduledKey({...event,source_id}));
      if(alias)return alias;
    }
    const postId=verifiedPostId(event.source_url);
    const matches=postId?scheduledByKind.all(event.kind).filter(row=>verifiedPostId(row.source_url)===postId):[];
    if(matches.length===1)return matches[0];
    // Multiple posts may describe one planned reset. Only group a known ETA
    // within the same reset cycle, so a new post after completion stays new.
    if(event.announced_at&&event.occurred_at){
      const completedAt=latestResetTime(event.kind);
      return scheduledByKind.all(event.kind).find(row=>row.scheduled_for===event.occurred_at&&row.occurred_at>=completedAt&&row.status!=='superseded')||null;
    }
    return null;
  }
  function hasCompleted(event){
    for(const source_id of sourceAliases(event.source_id))if(bySource.get(source_id)?.kind===event.kind)return true;
    const postId=verifiedPostId(event.source_url);
    return !!postId&&byKind.all(event.kind).some(row=>verifiedPostId(row.source_url)===postId)
      ||!!event.announced_at&&latestResetTime(event.kind)>event.announced_at;
  }
  function cancelScheduled(id,reason){
    db.prepare("UPDATE deliveries SET status='cancelled',error=? WHERE event_id=? AND status IN ('pending','failed')").run(reason,id);
  }
  function clearCompletedSchedule(){
    for(const row of db.prepare("SELECT * FROM events WHERE phase='scheduled' AND status='scheduled'").all()){
      const event={...row,source_id:row.source_id.replace(/^scheduled:(regular|banked):/,''),announced_at:row.occurred_at};
      if(hasCompleted(event)){
        db.prepare("UPDATE events SET status='superseded' WHERE id=?").run(row.id);
        cancelScheduled(row.id,'已有同类型的正式重置，取消旧预告');
      }
    }
    const active=get('scheduled');
    if(active&&hasCompleted(active))set('scheduled',null);
  }
  function existingEvent(event){
    const exact=bySource.get(event.source_id);
    if(exact)return exact;
    if(event.origin==='codex-resets'){
      // Older imports used the X post's numeric ID. Reconcile only a proven alias.
      for(const source_id of sourceAliases(event.source_id)){
        const alias=bySource.get(source_id);
        if(alias?.origin==='codex-resets'&&alias.kind===event.kind&&alias.occurred_at===event.occurred_at)return alias;
      }
    }
    if(!['codex-resets','manual'].includes(event.origin))return null;
    const postId=verifiedPostId(event.source_url);
    if(!postId)return null;
    const matches=byKind.all(event.kind).filter(row=>
      verifiedPostId(row.source_url)===postId&&
      (event.origin==='manual'||row.origin==='manual'||/^\d{10,25}$/.test(row.source_id)||/^\d{10,25}$/.test(event.source_id))
    );
    // Do not guess which row owns an alias if historical data is already ambiguous.
    return matches.length===1?matches[0]:null;
  }
  function addEvent(event,notify=false){
    const announcement=findScheduled(event);
    if(announcement){
      db.prepare("UPDATE events SET status='superseded' WHERE id=?").run(announcement.id);
      cancelScheduled(announcement.id,'重置已确认，取消尚未发送的预告');
    }
    const existing=existingEvent(event);
    if(existing){
      if(event.origin==='codex-resets')refresh.run(event.source_id,event.source_url,event.occurred_at,event.text,event.summary||'',event.kind,event.origin,event.source_type||'x_post',existing.id);
      clearCompletedSchedule();
      return {added:0,queued:0};
    }
    const result=insert.run(event.source_id,event.source_url,event.occurred_at,event.text,event.summary||'',event.kind,event.origin,event.source_type||'x_post');
    if(!result.changes)return {added:0,queued:0};
    let queued=0;
    if(notify)queued=Number(queue.run(result.lastInsertRowid).changes);
    clearCompletedSchedule();
    return {added:1,queued};
  }
  // Reconcile persisted tasks before the startup mail worker can claim them.
  db.exec('BEGIN IMMEDIATE');
  try{clearCompletedSchedule();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  return {
    db,get,set,close:()=>db.close(),
    publicEvents:()=>db.prepare("SELECT id,source_id,source_url,occurred_at,text,summary,kind,origin,source_type FROM events WHERE status='published' AND phase='reset' ORDER BY occurred_at DESC LIMIT 2000").all(),
    allEvents:()=>db.prepare("SELECT * FROM events WHERE phase='reset' ORDER BY occurred_at DESC LIMIT 2000").all(),
    recipients:()=>db.prepare('SELECT * FROM recipients ORDER BY created_at DESC,id DESC').all(),
    addRecipient(input){
      const email=emailAddress(input.email);const name=String(input.name||'').trim().slice(0,80);
      if(db.prepare('SELECT id FROM recipients WHERE email=?').get(email))throw new InputError('这个邮箱已经存在，可在列表中重新启用');
      return Number(db.prepare('INSERT INTO recipients(email,name) VALUES (?,?)').run(email,name).lastInsertRowid);
    },
    updateRecipient(id,enabled){if(typeof enabled!=='boolean')throw new InputError('状态无效');if(!db.prepare('UPDATE recipients SET enabled=? WHERE id=?').run(enabled?1:0,id).changes)throw new InputError('邮箱不存在',404);},
    addEvent,
    ingest(events,notify,{partial=false,baseline=!get('sourceInitialized',false)}={}){
      const historyWatermark=get('sourceWatermark','');
      const watermark=partial?[historyWatermark,get('statusWatermark','')].sort().at(-1):historyWatermark;let added=0,queued=0;
      db.exec('BEGIN IMMEDIATE');
      try{
        for(const event of [...events].sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at))){
          const result=addEvent(event,notify&&(!!findScheduled(event)||(!baseline&&event.occurred_at>watermark)));
          added+=result.added;queued+=result.queued;
        }
        const max=events.reduce((v,e)=>e.occurred_at>v?e.occurred_at:v,watermark);
        // A status snapshot cannot establish a complete baseline or skip unseen history.
        if(!partial){set('sourceWatermark',max);set('sourceInitialized',true);}
        else{set('statusWatermark',max);set('statusInitialized',true);}
        db.exec('COMMIT');
        return {added,queued,baseline};
      }catch(error){db.exec('ROLLBACK');throw error;}
    },
    updateScheduled(scheduled,notify){
      db.exec('BEGIN IMMEDIATE');
      try{
        let active=null,queued=0;
        if(scheduled&&!hasCompleted(scheduled)){
          const existing=findScheduled(scheduled);
          const summary=scheduled.kind==='banked'?'备用额度重置预告':'Codex 额度重置预告';
          if(existing){
            db.prepare("UPDATE events SET source_url=?,occurred_at=?,text=?,summary=?,source_type=?,scheduled_for=?,status='scheduled' WHERE id=?").run(scheduled.source_url,scheduled.announced_at,scheduled.text,summary,scheduled.source_type,scheduled.occurred_at,existing.id);
            active=existing.id;
          }else{
            active=Number(db.prepare("INSERT INTO events(source_id,source_url,occurred_at,text,summary,kind,origin,source_type,phase,status,scheduled_for) VALUES(?,?,?,?,?,?,?,?,'scheduled','scheduled',?)").run(scheduledKey(scheduled),scheduled.source_url,scheduled.announced_at,scheduled.text,summary,scheduled.kind,scheduled.origin,scheduled.source_type,scheduled.occurred_at).lastInsertRowid);
            if(notify)queued=Number(queue.run(active).changes);
          }
        }
        for(const old of db.prepare("SELECT id FROM events WHERE phase='scheduled' AND status='scheduled' AND id!=?").all(active||0)){
          db.prepare("UPDATE events SET status='withdrawn' WHERE id=?").run(old.id);
          cancelScheduled(old.id,'预告已撤下或被新公告替代');
        }
        set('scheduled',active?scheduled:null);db.exec('COMMIT');
        return queued;
      }catch(error){db.exec('ROLLBACK');throw error;}
    },
    archiveEvent(id){
      if(!db.prepare("UPDATE events SET status='archived' WHERE id=?").run(id).changes)throw new InputError('记录不存在',404);
      db.prepare("UPDATE deliveries SET status='cancelled',error='记录已归档' WHERE event_id=? AND status IN ('pending','failed')").run(id);
    },
    deliveries:()=>db.prepare('SELECT d.*,r.email,e.summary,e.kind,e.occurred_at,e.phase,e.scheduled_for FROM deliveries d JOIN recipients r ON r.id=d.recipient_id JOIN events e ON e.id=d.event_id ORDER BY d.id DESC LIMIT 100').all(),
  };
}
