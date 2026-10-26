export class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function emailAddress(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email)) throw new InputError('请输入有效的邮箱地址');
  return email;
}
export function cleanText(value, max, label) {
  const text = String(value || '').trim();
  if (!text || text.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new InputError(`${label}不能为空，且最多 ${max} 个字符`);
  return text;
}
export function validateEvent(input) {
  let url;
  try { url = new URL(input.source_url); } catch { throw new InputError('请填写 Tibo 的 X 原帖链接'); }
  const match = url.pathname.match(/^\/thsottiaux\/status\/(\d{10,25})\/?$/i);
  if (url.protocol !== 'https:' || !['x.com','twitter.com','www.x.com','www.twitter.com'].includes(url.hostname) || url.username || url.password || url.port || !match) throw new InputError('仅接受 https://x.com/thsottiaux/status/… 原帖链接');
  const date = new Date(input.occurred_at);
  if (!Number.isFinite(date.getTime()) || date.getTime() < Date.UTC(2025,0,1) || date.getTime() > Date.now() + 86400000) throw new InputError('公告时间无效或超出允许范围');
  if (!['regular','banked'].includes(input.kind)) throw new InputError('重置类型无效');
  return {source_id:match[1],source_url:`https://x.com/thsottiaux/status/${match[1]}`,occurred_at:date.toISOString(),text:cleanText(input.text,16000,'公告原文'),summary:String(input.summary||'').trim().slice(0,500),kind:input.kind,origin:input.origin==='codex-resets'?'codex-resets':'manual'};
}

export function validateSettings(input, previous) {
  const smtp=input.smtp||{};
  const port=Number(smtp.port||587);
  if(!Number.isInteger(port)||port<1||port>65535) throw new InputError('SMTP 端口必须在 1–65535 之间');
  const host=String(smtp.host||'').trim();
  if(host && !/^[a-zA-Z0-9.-]{1,253}$/.test(host)) throw new InputError('SMTP 主机名无效');
  const from=String(smtp.from||'').trim();
  if(from) emailAddress(from);
  const user=String(smtp.user||'').trim();
  if(user.length>254 || /[\r\n]/.test(user)) throw new InputError('SMTP 用户名无效');
  const interval=Number(input.pollMinutes||5);
  if(!Number.isInteger(interval)||interval<1||interval>1440) throw new InputError('同步间隔为 1–1440 分钟');
  if(input.notificationsEnabled && (!host||!from)) throw new InputError('启用提醒前请配置 SMTP 主机和发件邮箱');
  return {pollMinutes:interval,syncEnabled:!!input.syncEnabled,notificationsEnabled:!!input.notificationsEnabled,smtp:{host,port,secure:!!smtp.secure,user,from,fromName:String(smtp.fromName||'Codex Reset').replace(/[\r\n]/g,'').slice(0,60),password:previous.smtp.password}};
}
