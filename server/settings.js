export const defaults={syncEnabled:true,pollMinutes:5,notificationsEnabled:false,smtp:{host:'',port:587,secure:false,user:'',password:'',from:'',fromName:'Codex Reset'}};
export function settings(store){const saved=store.get('config',{});return {...defaults,...saved,smtp:{...defaults.smtp,...saved.smtp}};}
export function publicSettings(store){const config=settings(store);const {password,...smtp}=config.smtp;return {...config,smtp:{...smtp,hasPassword:!!password}};}
