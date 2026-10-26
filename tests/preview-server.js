// Isolated browser QA server: no real recipients or external email delivery.
import {readFileSync} from 'node:fs';
import {createStore} from '../server/store.js';
import {createVault} from '../server/security.js';
import {createApp} from '../server/app.js';
import {normalizeReset} from '../server/source.js';
import {InputError} from '../server/validation.js';
const store=createStore(':memory:');
if(process.argv[2]==='--scheduled-only')store.set('scheduled',{occurred_at:null,text:'已公告的重置，具体时间待确认。',kind:'regular',source_url:'https://x.com/thsottiaux/status/2114588174249071102'});
else if(process.argv[2])store.ingest(JSON.parse(readFileSync(process.argv[2],'utf8')).data.map(normalizeReset),false);
store.set('config',{syncEnabled:false,notificationsEnabled:false});
const app=createApp({store,vault:createVault(Buffer.alloc(32,8)),password:'local-browser-qa-only',sync:async()=>({added:0,queued:0}),sendTest:async()=>{throw new InputError('测试环境未配置 SMTP，不会发送真实邮件');}});
const server=app.listen(3001,'127.0.0.1',()=>console.log('Isolated browser QA at http://127.0.0.1:3001'));
process.on('SIGINT',()=>server.close(()=>store.close()));
