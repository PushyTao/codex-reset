import {DatabaseSync} from 'node:sqlite';
import {emailAddress, InputError} from './validation.js';

function verifiedPostId(value){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||!['x.com','twitter.com','www.x.com','www.twitter.com'].includes(url.hostname)||url.username||url.password||url.port)return null;
    return url.pathname.match(/^\/thsottiaux\/status\/(\d{10,25})\/?$/i)?.[1]||null;
  }catch{return null;}
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
  const get=(key,fallback=null)=>{const row=db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(row.value):fallback;};
  const set=(key,value)=>db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
  const insert=db.prepare('INSERT OR IGNORE INTO events(source_id,source_url,occurred_at,text,summary,kind,origin,source_type) VALUES (?,?,?,?,?,?,?,?)');
  const bySource=db.prepare('SELECT * FROM events WHERE source_id=?');
  const byKind=db.prepare("SELECT * FROM events WHERE kind=? AND origin IN ('codex-resets','manual')");
  const refresh=db.prepare('UPDATE events SET source_id=?,source_url=?,occurred_at=?,text=?,summary=?,kind=?,origin=?,source_type=? WHERE id=?');
  function existingEvent(event){
    const exact=bySource.get(event.source_id);
    if(exact)return exact;
    if(event.origin==='codex-resets'){
      // Older imports used the X post's numeric ID. Reconcile only a proven alias.
      const numeric=event.source_id.match(/(?:^|-)(\d{10,25})$/)?.[1];
      const legacy=numeric?bySource.get(numeric):null;
      if(legacy?.origin==='codex-resets'&&legacy.kind===event.kind&&legacy.occurred_at===event.occurred_at)return legacy;
    }
    if(!['codex-resets','manual'].includes(event.origin))return null;
    const postId=verifiedPostId(event.source_url);
    if(!postId)return null;
    const matches=byKind.all(event.kind).filter(row=>
      verifiedPostId(row.source_url)===postId&&
      (event.origin==='manual'||row.origin==='manual'||/^\d{10,25}$/.test(row.source_id))
    );
    // Do not guess which row owns an alias if historical data is already ambiguous.
    return matches.length===1?matches[0]:null;
  }
  function addEvent(event,notify=false){
    const existing=existingEvent(event);
    if(existing){
      if(event.origin==='codex-resets')refresh.run(event.source_id,event.source_url,event.occurred_at,event.text,event.summary||'',event.kind,event.origin,event.source_type||'x_post',existing.id);
      return {added:0,queued:0};
    }
    const result=insert.run(event.source_id,event.source_url,event.occurred_at,event.text,event.summary||'',event.kind,event.origin,event.source_type||'x_post');
    if(!result.changes)return {added:0,queued:0};
    let queued=0;
    if(notify)queued=Number(db.prepare('INSERT OR IGNORE INTO deliveries(event_id,recipient_id) SELECT ?,id FROM recipients WHERE enabled=1').run(result.lastInsertRowid).changes);
    return {added:1,queued};
  }
  return {
    db,get,set,close:()=>db.close(),
    publicEvents:()=>db.prepare("SELECT id,source_id,source_url,occurred_at,text,summary,kind,origin,source_type FROM events WHERE status='published' ORDER BY occurred_at DESC LIMIT 2000").all(),
    allEvents:()=>db.prepare('SELECT * FROM events ORDER BY occurred_at DESC LIMIT 2000').all(),
    recipients:()=>db.prepare('SELECT * FROM recipients ORDER BY created_at DESC,id DESC').all(),
    addRecipient(input){
      const email=emailAddress(input.email);const name=String(input.name||'').trim().slice(0,80);
      if(db.prepare('SELECT id FROM recipients WHERE email=?').get(email))throw new InputError('这个邮箱已经存在，可在列表中重新启用');
      return Number(db.prepare('INSERT INTO recipients(email,name) VALUES (?,?)').run(email,name).lastInsertRowid);
    },
    updateRecipient(id,enabled){if(typeof enabled!=='boolean')throw new InputError('状态无效');if(!db.prepare('UPDATE recipients SET enabled=? WHERE id=?').run(enabled?1:0,id).changes)throw new InputError('邮箱不存在',404);},
    addEvent,
    ingest(events,notify){
      const baseline=!get('sourceInitialized',false);const watermark=get('sourceWatermark','');let added=0,queued=0;
      db.exec('BEGIN IMMEDIATE');
      try{
        for(const event of [...events].sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at))){
          const result=addEvent(event,notify&&!baseline&&event.occurred_at>watermark);
          added+=result.added;queued+=result.queued;
        }
        const max=events.reduce((v,e)=>e.occurred_at>v?e.occurred_at:v,watermark);
        set('sourceWatermark',max);set('sourceInitialized',true);db.exec('COMMIT');
        return {added,queued,baseline};
      }catch(error){db.exec('ROLLBACK');throw error;}
    },
    archiveEvent(id){
      if(!db.prepare("UPDATE events SET status='archived' WHERE id=?").run(id).changes)throw new InputError('记录不存在',404);
      db.prepare("UPDATE deliveries SET status='cancelled',error='记录已归档' WHERE event_id=? AND status IN ('pending','failed')").run(id);
    },
    deliveries:()=>db.prepare('SELECT d.*,r.email,e.summary,e.kind,e.occurred_at FROM deliveries d JOIN recipients r ON r.id=d.recipient_id JOIN events e ON e.id=d.event_id ORDER BY d.id DESC LIMIT 100').all(),
  };
}
