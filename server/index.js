import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createStore} from './store.js';
import {createVault} from './security.js';
import {createSyncService} from './source.js';
import {createMailer} from './mail.js';
import {settings} from './settings.js';
import {createApp} from './app.js';

const dataDir=resolve(process.env.DATA_DIR||'data');
mkdirSync(dataDir,{recursive:true,mode:0o700});
const keyPath=resolve(dataDir,'secret.key');
if(!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});
const vault=createVault(readFileSync(keyPath));
let password=process.env.ADMIN_PASSWORD;
if(!password){
  const passwordPath=resolve(dataDir,'admin-password.txt');
  if(!existsSync(passwordPath))writeFileSync(passwordPath,randomBytes(24).toString('base64url'),{mode:0o600,flag:'wx'});
  password=readFileSync(passwordPath,'utf8').trim();
  console.log(`管理员初始密码文件：${passwordPath}`);
}
if(password.length<12||password.length>512)throw new Error('ADMIN_PASSWORD 必须为 12–512 个字符');
const appUrl=process.env.APP_URL||'';
if(appUrl&&!/^https?:$/.test(new URL(appUrl).protocol))throw new Error('APP_URL 必须使用 http 或 https');
const secureCookie=process.env.SECURE_COOKIE?process.env.SECURE_COOKIE==='true':appUrl.startsWith('https:');
const trustProxy=Number(process.env.TRUST_PROXY||0);
if(!Number.isInteger(trustProxy)||trustProxy<0||trustProxy>5)throw new Error('TRUST_PROXY 应为 0–5 的代理层数');
const store=createStore(resolve(dataDir,'reset.sqlite'));
// Existing sessions never survive a process restart/password rotation.
store.db.exec('DELETE FROM sessions');
const sync=createSyncService(store);const mailer=createMailer(store,vault);
const app=createApp({store,vault,password,appUrl,secureCookie,trustProxy,sync,sendTest:mailer.sendTest});
const port=Number(process.env.PORT||3000);const host=process.env.HOST||'127.0.0.1';
const server=app.listen(port,host,()=>console.log(`Codex Reset: http://${host==='0.0.0.0'?'localhost':host}:${port}\n后台路径：/admin`));
server.requestTimeout=30000;server.headersTimeout=15000;
const active=new Set();let stopping=false,lastCheck=0;
function track(promise){active.add(promise);promise.catch(()=>{}).finally(()=>active.delete(promise));}
function tick(){
  if(stopping)return;
  const config=settings(store);
  if(config.syncEnabled&&Date.now()-lastCheck>=config.pollMinutes*60000){
    lastCheck=Date.now();
    track(sync().then(result=>console.log(`同步完成：${result.count} 条记录，新增 ${result.added}，提醒 ${result.queued}`)).catch(error=>console.warn('同步状态：',error.message)));
  }
  track(mailer.drain());
}
const interval=setInterval(tick,15000);interval.unref();tick();
async function stop(){
  if(stopping)return;stopping=true;clearInterval(interval);
  await new Promise(resolve=>server.close(resolve));
  await Promise.allSettled([...active]);
  store.close();
}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
