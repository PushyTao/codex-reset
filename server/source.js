import https from 'node:https';
import {validateEvent,cleanText,InputError} from './validation.js';
import {settings} from './settings.js';

const SOURCE='https://codex-resets.com';
export function requestJson(url){
  if(new URL(url).origin!==SOURCE)throw new Error('Unexpected source host');
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{family:Number(process.env.NETWORK_FAMILY||4),headers:{Accept:'application/json','User-Agent':'CodexResetWatch/1.0 (self-hosted community tracker)'}},res=>{
      let size=0;const chunks=[];
      res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)req.destroy(new Error('Response too large'));else chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>{
        if(res.statusCode!==200){const error=new Error(`数据源返回 HTTP ${res.statusCode}`);error.retryAfter=Math.min(14400,Math.max(60,Number(res.headers['retry-after'])||300));return reject(error);}
        try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new Error('数据源没有返回有效 JSON'));}
      });
    });
    const timer=setTimeout(()=>req.destroy(new Error('数据源连接超时')),25000);timer.unref();
    req.on('error',reject);req.on('close',()=>clearTimeout(timer));
  });
}
export function normalizeReset(item){
  if(!item||!['regular','banked'].includes(item.reset_type)||!['x_post','observed'].includes(item.source?.type))throw new Error('数据源记录格式已改变');
  if(item.source.type==='x_post'&&item.source.author!=='thsottiaux')throw new Error('Unexpected announcement author');
  if(typeof item.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(item.id))throw new Error('Invalid source ID');
  const date=new Date(item.announced_at);
  if(!Number.isFinite(date.getTime())||date.getTime()<Date.UTC(2025,0,1)||date.getTime()>Date.now()+86400000)throw new Error('Invalid source timestamp');
  const kind=item.reset_type;const summary=kind==='banked'?'新增备用重置额度':'Codex 用量额度重置';
  const event={source_id:item.id,source_url:item.source.url,occurred_at:date.toISOString(),text:cleanText(item.text,16000,'公告原文'),summary,kind,origin:'codex-resets',source_type:item.source.type};
  if(item.source.url){
    const validated=validateEvent(event);
    return {...validated,source_id:item.id,source_type:item.source.type};
  }
  if(item.source.type!=='observed')throw new Error('Missing X source');
  return {...event,source_url:SOURCE+'/'};
}
export function createSyncService(store,{requestJson:fetchJson=requestJson}={}){
  let running=null;
  async function history(){
    const items=[];let cursor=null;const seen=new Set();let complete=false;
    for(let page=0;page<20;page++){
      const url=new URL('/api/v1/resets',SOURCE);url.searchParams.set('limit','100');
      if(cursor)url.searchParams.set('cursor',cursor);
      const payload=await fetchJson(url.toString());
      if(!Array.isArray(payload.data)||typeof payload.pagination?.has_more!=='boolean')throw new Error('数据源记录格式已改变');
      if(payload.data.some(item=>item.status==='scheduled'))throw new Error('数据源历史包含未完成的预告');
      items.push(...payload.data.map(normalizeReset));
      if(!payload.pagination.has_more){complete=true;break;}
      cursor=payload.pagination.next_cursor;
      if(typeof cursor!=='string'||!cursor||cursor.length>1024||seen.has(cursor))throw new Error('数据源分页游标无效');
      seen.add(cursor);
    }
    if(!complete||!items.length)throw new Error('数据源未返回完整的历史记录');
    return items;
  }
  async function status(){
    const payload=await fetchJson(SOURCE+'/api/v1/status');
    if(!payload.data||!Object.hasOwn(payload.data,'scheduled_reset'))throw new Error('数据源状态格式已改变');
    let scheduled=null,latest=null;
    if(payload.data.latest_reset){
      if(payload.data.latest_reset.status==='scheduled')throw new Error('数据源最新重置尚未完成');
      latest=normalizeReset(payload.data.latest_reset);
    }
    if(payload.data.scheduled_reset){
      const raw=payload.data.scheduled_reset;
      if(raw.status!=='scheduled')throw new Error('Invalid scheduled status');
      const normalized=normalizeReset(raw);
      const at=raw.scheduled_for?new Date(raw.scheduled_for):null;
      if(at&&!Number.isFinite(at.getTime()))throw new Error('Invalid scheduled date');
      scheduled={...normalized,occurred_at:at?.toISOString()||null,announced_at:normalized.occurred_at};
    }
    return {scheduled,latest};
  }
  const requestWhenAllowed=(until,request)=>until>Date.now()
    ?Promise.reject(Object.assign(new Error('数据源请求受限，请稍后再同步'),{retryAt:until}))
    :request();
  const nextAllowed=result=>result.status==='fulfilled'?0:result.reason.retryAt||(result.reason.retryAfter?Date.now()+result.reason.retryAfter*1000:0);
  return function sync(){
    if(running)return running;
    const previous=store.get('syncState',{});
    if(previous.nextAllowed>Date.now())return Promise.reject(new InputError('数据源请求受限，请稍后再同步',429));
    running=(async()=>{
      const lastAttempt=new Date().toISOString();store.set('syncState',{...previous,lastAttempt});
      try{
        const initialized=store.get('sourceInitialized',false),statusInitialized=store.get('statusInitialized',false),notify=settings(store).notificationsEnabled;
        // Either endpoint can fail without discarding useful data from the other.
        const [historyResult,statusResult]=await Promise.allSettled([
          requestWhenAllowed(previous.historyNextAllowed,history),
          requestWhenAllowed(previous.statusNextAllowed,status)
        ]);
        const result={added:0,queued:0,baseline:!initialized};
        const collect=part=>{result.added+=part.added;result.queued+=part.queued;};
        if(historyResult.status==='fulfilled')collect(store.ingest(historyResult.value,notify));
        if(statusResult.status==='fulfilled'){
          const {latest,scheduled}=statusResult.value;
          if(latest)collect(store.ingest([latest],notify,{partial:true,baseline:!initialized&&!statusInitialized}));
          result.queued+=store.updateScheduled(scheduled,notify);
        }
        const failures=[historyResult,statusResult].filter(r=>r.status==='rejected');
        const historyNextAllowed=nextAllowed(historyResult),statusNextAllowed=nextAllowed(statusResult);
        const message=failures.map(r=>/数据源/.test(r.reason.message)?r.reason.message:'连接数据源失败，已有记录已保留').join('；')||null;
        const count=historyResult.status==='fulfilled'?historyResult.value.length:store.publicEvents().length;
        store.set('syncState',{...previous,lastAttempt,lastSuccess:failures.length?previous.lastSuccess||null:new Date().toISOString(),error:message,count,historyNextAllowed,statusNextAllowed,nextAllowed:Math.min(historyNextAllowed,statusNextAllowed),...result});
        if(failures.length)throw new InputError(message,502);
        return {...result,count};
      }catch(error){
        const message=/数据源/.test(error.message)?error.message:'连接数据源失败，已有记录已保留';
        store.set('syncState',{...store.get('syncState',previous),lastAttempt,error:message});
        throw new InputError(message,502);
      }
    })().finally(()=>{running=null;});
    return running;
  };
}
