import express from 'express';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {hash,randomToken,passwordVerifier,cookieToken,sameOrigin} from './security.js';
import {InputError,validateEvent,validateSettings} from './validation.js';
import {settings,publicSettings} from './settings.js';

const publicPath=fileURLToPath(new URL('../public/',import.meta.url));
export function createApp({store,vault,password,appUrl='',secureCookie=false,trustProxy=0,sync,sendTest}){
  const app=express();app.disable('x-powered-by');app.set('trust proxy',trustProxy);
  const verifyPassword=passwordVerifier(password);const attempts=new Map();
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});
    if(req.path.startsWith('/api/')||req.path.startsWith('/admin'))res.set('Cache-Control','no-store');
    if(req.path.startsWith('/admin'))res.set('X-Robots-Tag','noindex, nofollow');
    next();
  });
  app.use(express.json({limit:'48kb'}));
  app.get('/healthz',(_req,res)=>res.json({ok:true}));
  app.get('/robots.txt',(_req,res)=>res.type('text').send('User-agent: *\nDisallow: /admin\nDisallow: /api/admin/\n'));
  app.get('/api/status',(_req,res)=>{
    const syncState=store.get('syncState',{});
    res.json({events:store.publicEvents(),source:'https://codex-resets.com/',scheduled:store.get('scheduled',null),sync:{lastSuccess:syncState.lastSuccess||null,lastAttempt:syncState.lastAttempt||null,healthy:!syncState.error,enabled:settings(store).syncEnabled},now:new Date().toISOString()});
  });
  app.post('/api/admin/login',(req,res)=>{
    sameOrigin(req,appUrl);
    const now=Date.now();for(const [key,value]of attempts)if(value.until<now)attempts.delete(key);
    const ip=req.ip;const entry=attempts.get(ip)||{count:0,until:now+15*60000};
    if(entry.count>=8)throw new InputError('尝试次数过多，请 15 分钟后再试',429);
    entry.count++;if(attempts.size<10000)attempts.set(ip,entry);
    if(!verifyPassword(req.body.password))throw new InputError('管理员密码不正确',401);
    attempts.delete(ip);const token=randomToken(),csrf=randomToken();
    store.db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
    store.db.prepare('INSERT INTO sessions(token,csrf,expires) VALUES (?,?,?)').run(hash(token),csrf,now+12*3600000);
    res.cookie('reset_session',token,{httpOnly:true,sameSite:'strict',secure:secureCookie,path:'/api/admin',maxAge:12*3600000});
    res.json({csrf});
  });
  app.use('/api/admin',(req,res,next)=>{
    const session=store.db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(hash(cookieToken(req)),Date.now());
    if(!session)return res.status(401).json({error:'请先登录后台'});
    if(!['GET','HEAD'].includes(req.method)){
      sameOrigin(req,appUrl);
      if(req.headers['x-csrf-token']!==session.csrf)throw new InputError('页面会话已更新，请刷新后重试',403);
    }
    req.session=session;next();
  });
  app.get('/api/admin/state',(req,res)=>res.json({csrf:req.session.csrf,settings:publicSettings(store),recipients:store.recipients(),events:store.allEvents(),deliveries:store.deliveries(),sync:store.get('syncState',{}),test:store.get('lastTest',null)}));
  app.post('/api/admin/logout',(req,res)=>{
    store.db.prepare('DELETE FROM sessions WHERE token=?').run(req.session.token);
    res.clearCookie('reset_session',{path:'/api/admin',httpOnly:true,sameSite:'strict',secure:secureCookie});res.json({ok:true});
  });
  app.post('/api/admin/settings',(req,res)=>{
    const config=validateSettings(req.body,settings(store));const secret=req.body.smtp?.password;
    if(typeof secret==='string'&&secret.length>1000)throw new InputError('SMTP 密码过长');
    if(secret)config.smtp.password=vault.encrypt(secret);
    if(req.body.smtp?.clearPassword===true)config.smtp.password='';
    store.set('config',config);res.json({ok:true,settings:publicSettings(store)});
  });
  app.post('/api/admin/recipients',(req,res)=>res.status(201).json({id:store.addRecipient(req.body)}));
  app.post('/api/admin/recipients/:id',(req,res)=>{store.updateRecipient(Number(req.params.id),req.body.enabled);res.json({ok:true});});
  app.post('/api/admin/events',(req,res)=>{
    const event=validateEvent(req.body);event.origin='manual';
    const result=store.addEvent(event,req.body.notify===true&&settings(store).notificationsEnabled);
    if(!result.added)throw new InputError('这条原帖已经收录，请勿重复添加',409);
    res.status(201).json(result);
  });
  app.post('/api/admin/events/:id/archive',(req,res)=>{store.archiveEvent(Number(req.params.id));res.json({ok:true});});
  app.post('/api/admin/sync',async(_req,res)=>res.json(await sync()));
  let lastTestAt=0;
  app.post('/api/admin/test-email',async(req,res)=>{
    if(Date.now()-lastTestAt<10000)throw new InputError('请等待 10 秒后再发送测试',429);
    const recipient=store.recipients().find(r=>r.id===Number(req.body.recipientId)&&r.enabled);
    if(!recipient)throw new InputError('请选择一个启用的收件邮箱');
    lastTestAt=Date.now();
    await sendTest(recipient);res.json({ok:true,message:'SMTP 服务器已接受测试邮件，请检查收件箱'});
  });
  app.get(['/admin','/admin/'],(_req,res)=>res.sendFile(resolve(publicPath,'admin.html')));
  app.use(express.static(publicPath,{dotfiles:'deny',index:'index.html',maxAge:0}));
  app.use((_req,res)=>res.status(404).type('text').send('页面不存在'));
  app.use((error,_req,res,_next)=>{
    const status=error.status||500;
    if(status>=500)console.error('Request failed:',error.code||error.name);
    res.status(status).json({error:status>=500?'操作未完成，请稍后重试或检查服务配置':error.message});
  });
  return app;
}
