import {createCipheriv,createDecipheriv,randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {InputError} from './validation.js';

export const hash=value=>createHash('sha256').update(value).digest('hex');
export const randomToken=()=>randomBytes(32).toString('base64url');
export function createVault(key){
  if(key.length!==32)throw new Error('Encryption key must be 32 bytes');
  return {
    encrypt(value){if(!value)return '';const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return [iv.toString('base64'),cipher.getAuthTag().toString('base64'),bytes.toString('base64')].join('.');},
    decrypt(value){if(!value)return '';const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64'));const cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAuthTag(tag);return Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8');}
  };
}
export function passwordVerifier(password){
  const salt=randomBytes(16);const expected=scryptSync(password,salt,64);
  return candidate=>{if(typeof candidate!=='string'||candidate.length>512)return false;return timingSafeEqual(scryptSync(candidate,salt,64),expected);};
}
export function cookieToken(req){const part=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('reset_session='));return part?.slice(14)||'';}
export function sameOrigin(req,appUrl){
  const origin=req.headers.origin;
  if(req.headers['sec-fetch-site']==='cross-site')throw new InputError('请求来源无效',403);
  if(!origin)throw new InputError('请求缺少来源信息',403);
  const expected=appUrl?new URL(appUrl).origin:`${req.protocol}://${req.get('host')}`;
  if(origin!==expected)throw new InputError('请求来源无效',403);
  if(!req.is('application/json'))throw new InputError('请求格式必须为 JSON',415);
}
