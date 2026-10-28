const form=document.querySelector('#subscribe-form');
const submit=document.querySelector('#subscribe-submit');
const feedback=document.querySelector('#subscribe-feedback');
const success=document.querySelector('#subscribe-success');
let submitting=false;
form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(submitting||!form.reportValidity())return;
  submitting=true;submit.disabled=true;form.setAttribute('aria-busy','true');feedback.hidden=true;
  const label=submit.querySelector('span');label.textContent='正在提交…';
  try{
    const data=new FormData(form);
    const response=await fetch('/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify({name:data.get('name'),email:data.get('email'),consent:data.get('consent')==='on'})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'订阅未完成，请稍后重试');
    document.querySelector('#subscribe-success-message').textContent=result.message;
    form.hidden=true;success.hidden=false;success.focus();
  }catch(error){
    feedback.textContent=error.name==='TimeoutError'?'请求超时，请稍后重试。':error instanceof TypeError||error instanceof SyntaxError?'暂时无法连接服务，请稍后重试。':error.message;
    feedback.hidden=false;
  }finally{
    submitting=false;submit.disabled=false;form.removeAttribute('aria-busy');label.textContent='订阅邮件提醒';
  }
});
