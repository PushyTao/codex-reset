import nodemailer from 'nodemailer';
import {settings} from './settings.js';
import {InputError} from './validation.js';

const escape=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeFailure(error){
  return ({EAUTH:'SMTP 登录失败，请检查用户名与授权码',ECONNECTION:'无法连接 SMTP 服务器',ETIMEDOUT:'SMTP 连接超时',ESOCKET:'SMTP TLS 或连接异常',EENVELOPE:'SMTP 拒绝发件人或收件人',EMESSAGE:'SMTP 拒绝邮件内容'})[error.code]||'邮件未获 SMTP 服务器确认，请检查设置后重试';
}
export function createMailer(store,vault,{allowInsecureLocal=false,send}={}){
  let draining=null;
  store.db.prepare("UPDATE deliveries SET status='failed',error='上次进程中断，将重新尝试',next_attempt=? WHERE status='sending'").run(Date.now()+60000);
  async function deliver(recipient,event,test=false){
    const config=settings(store).smtp;
    if(!config.host||!config.from)throw new InputError('请先保存 SMTP 主机与发件邮箱');
    const subject=test?'[Codex Reset] 邮件提醒测试':`[Codex Reset] ${event.kind==='banked'?'新增备用重置额度':'额度重置公告'}`;
    const description=test?'这是一封测试邮件。收到它说明 SMTP 发信路径可以使用。':`${event.summary}\n公告时间：${new Date(event.occurred_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（北京时间）\n来源类型：${event.source_type==='observed'?'社区观测':'Tibo 原帖公告'}\n\n${event.text}\n\n查看来源：${event.source_url}`;
    const text=`${subject}\n\n${description}\n\n数据来自 Codex Resets：https://codex-resets.com/\n这是由网站管理员为此邮箱设置的提醒。如需停用，请联系管理员。`;
    const html=`<div style="font-family:Arial,sans-serif;max-width:600px;padding:32px;background:#f3f0e8;color:#171916"><p style="font-size:12px;letter-spacing:2px;color:#237b53">CODEX RESET</p><h1 style="font-size:28px">${escape(subject.replace('[Codex Reset] ',''))}</h1><p style="line-height:1.8;white-space:pre-wrap">${escape(description)}</p><hr><p>数据来自 <a href="https://codex-resets.com/">Codex Resets</a>。如需停用提醒，请联系网站管理员。</p></div>`;
    const message={from:{name:config.fromName,address:config.from},to:recipient.email,subject,text,html,headers:{'X-Codex-Reset-Type':test?'test':event.kind},...(test?{}:{messageId:`<reset-${event.id}-${recipient.id}@${config.from.split('@')[1]}>`})};
    if(send)return send(message);
    const transport=nodemailer.createTransport({host:config.host,port:config.port,secure:config.secure,requireTLS:!config.secure&&!(allowInsecureLocal&&['127.0.0.1','localhost','::1'].includes(config.host)),auth:config.user?{user:config.user,pass:vault.decrypt(config.password)}:undefined,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,disableFileAccess:true,disableUrlAccess:true,tls:{minVersion:'TLSv1.2'}});
    try{
      const result=await transport.sendMail(message);
      if(!result.accepted?.length)throw new Error('SMTP did not accept the message');
      return result;
    }finally{transport.close();}
  }
  return {
    async sendTest(recipient){
      try{await deliver(recipient,null,true);store.set('lastTest',{at:new Date().toISOString(),email:recipient.email,ok:true});}
      catch(error){const message=error instanceof InputError?error.message:safeFailure(error);store.set('lastTest',{at:new Date().toISOString(),email:recipient.email,ok:false,error:message});throw new InputError(message,400);}
    },
    drain(){
      if(draining)return draining;
      draining=(async()=>{
        if(!settings(store).notificationsEnabled)return;
        const queue=store.db.prepare("SELECT d.id AS delivery_id,d.recipient_id,e.* FROM deliveries d JOIN recipients r ON r.id=d.recipient_id JOIN events e ON e.id=d.event_id WHERE d.status IN ('pending','failed') AND d.attempts<5 AND d.next_attempt<=? AND r.enabled=1 AND e.status='published' ORDER BY d.id LIMIT 30").all(Date.now());
        for(const event of queue){
          if(!settings(store).notificationsEnabled)break;
          const recipient=store.recipients().find(r=>r.id===event.recipient_id&&r.enabled);
          if(!recipient)continue;
          const claimed=store.db.prepare("UPDATE deliveries SET status='sending',attempts=attempts+1 WHERE id=? AND status IN ('pending','failed')").run(event.delivery_id);
          if(!claimed.changes)continue;
          try{await deliver(recipient,event);store.db.prepare("UPDATE deliveries SET status='sent',sent_at=?,error=NULL WHERE id=?").run(new Date().toISOString(),event.delivery_id);}
          catch(error){const attempts=store.db.prepare('SELECT attempts FROM deliveries WHERE id=?').get(event.delivery_id).attempts;store.db.prepare("UPDATE deliveries SET status='failed',error=?,next_attempt=? WHERE id=?").run(safeFailure(error),Date.now()+Math.min(3600000,60000*2**(attempts-1)),event.delivery_id);}
        }
      })().finally(()=>{draining=null;});
      return draining;
    }
  };
}
