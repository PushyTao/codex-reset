'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const state = {events: [], sync: {}, loaded: false, failure: false, timezone: 'Asia/Shanghai', kind: 'all', search: '', date: '', limit: 6};
  try { const saved = localStorage.getItem('reset-timezone'); if (['Asia/Shanghai','America/Los_Angeles','local'].includes(saved)) state.timezone = saved; } catch {}
  $('timezone').value = state.timezone;
  const zone = () => state.timezone === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : state.timezone;
  const formatter = options => new Intl.DateTimeFormat('zh-CN', {timeZone: zone(), ...options});
  const dateKey = date => {
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:zone(),year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(date));
    return ['year','month','day'].map(type => parts.find(p => p.type === type).value).join('-');
  };
  const exact = date => formatter({year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(date));
  const relative = date => {
    const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return '刚刚';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
    return `${Math.floor(seconds / 86400)} 天前`;
  };
  const node = (tag, cls, text) => {const el = document.createElement(tag);if (cls) el.className = cls;if (text !== undefined) el.textContent = text;return el;};
  function safeLink(url) {try {const parsed = new URL(url);return parsed.protocol === 'https:' ? parsed.href : 'https://codex-resets.com/';} catch {return 'https://codex-resets.com/';}}
  function freshness() {
    const sync = state.sync;
    let text, tone;
    if (state.failure) {text = state.loaded ? '暂时无法刷新 · 正在显示已读取记录' : '无法读取数据 · 请稍后重试';tone = 'warning';}
    else if (!state.loaded) {text = '正在读取公开数据…';tone = '';}
    else if (!sync.enabled) {text = `自动同步已暂停${sync.lastSuccess ? ` · 最近同步 ${relative(sync.lastSuccess)}` : ' · 尚未同步'}`;tone = 'offline';}
    else if (!sync.lastSuccess) {text = '等待首次同步 · 暂无已验证的同步时间';tone = 'warning';}
    else if (!sync.healthy || Date.now() - new Date(sync.lastSuccess) > 15 * 60000) {text = `来源待更新 · 最近成功同步 ${relative(sync.lastSuccess)}`;tone = 'warning';}
    else {text = `来源同步正常 · ${relative(sync.lastSuccess)}更新`;tone = '';}
    $('source-status').textContent = text;$('source-dot').className = `live-dot ${tone}`;
  }
  function renderLatest() {
    const scheduled = state.scheduled;
    $('next-reset').textContent = scheduled ? scheduled.occurred_at && Number.isFinite(new Date(scheduled.occurred_at).getTime()) ? `来源公布：${exact(scheduled.occurred_at)}。实际额度以账户为准。` : '已公告，具体时间待确认' : '重置没有固定周期，暂不提供时间预测。';
    const latest = state.events[0];
    if (!latest) {
      $('latest-relative').textContent = state.loaded ? '等待首次记录' : state.failure ? '连接暂不可用' : '读取记录中';
      $('latest-exact').textContent = state.loaded ? '尚无公开重置记录可供展示' : state.failure ? '请点击下方「刷新数据」重试' : '等待数据源响应';
      $('latest-kind').textContent = state.loaded ? '等待观测' : state.failure ? '连接失败' : '正在连接';
      $('latest-source').textContent = '公开社区数据';return;
    }
    $('latest-relative').textContent = relative(latest.occurred_at);
    $('latest-exact').textContent = `${exact(latest.occurred_at)} · ${zone()}`;
    $('latest-kind').textContent = latest.kind === 'banked' ? '备用额度 / BANKED' : '常规重置 / REGULAR';
    $('latest-source').textContent = latest.source_type === 'x_post' ? 'Tibo · X 原帖记录' : latest.origin === 'manual' ? '管理员收录 · X 原帖' : 'Codex Resets · 社区观测';
    $('latest-link').href = safeLink(latest.source_url);
  }
  function renderCalendar() {
    const today = dateKey(new Date());
    const end = new Date(`${today}T12:00:00Z`);
    const start = new Date(end);start.setUTCDate(start.getUTCDate()-89);
    const counts = new Map();
    for (const event of state.events) {const key = dateKey(event.occurred_at);const entry = counts.get(key) || {total:0,banked:false};entry.total++;entry.banked ||= event.kind === 'banked';counts.set(key,entry);}
    const fragment = document.createDocumentFragment();
    for (let i=0;i<90;i++) {
      const date = new Date(start);date.setUTCDate(date.getUTCDate()+i);const key = date.toISOString().slice(0,10);const entry = counts.get(key);
      const cell = node('button',`calendar-cell${entry ? entry.banked ? ' banked' : ' regular' : ''}${key === state.date ? ' selected' : ''}${key === today ? ' today' : ''}`);
      cell.type='button';cell.textContent = date.getUTCDate() === 1 || i === 0 ? `${date.getUTCMonth()+1}月` : '';
      cell.title = `${key} · ${entry ? `${entry.total} 次重置${entry.banked ? '，含备用额度' : ''}` : '无记录'}`;cell.setAttribute('aria-label',cell.title);cell.setAttribute('aria-pressed',String(key === state.date));
      cell.addEventListener('click',() => {state.date=state.date===key?'':key;state.limit=6;renderCalendar();renderFeed();$('announcements').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});fragment.append(cell);
    }
    $('calendar').replaceChildren(fragment);
    $('calendar-range').textContent = `${start.toISOString().slice(0,10).replaceAll('-','.')} — ${today.replaceAll('-','.')}`;
    const recent = state.events.filter(e => {const key=dateKey(e.occurred_at);return key>=start.toISOString().slice(0,10)&&key<=today;});
    $('stat-total').textContent = state.loaded ? String(recent.length) : '—';$('stat-banked').textContent = state.loaded ? String(recent.filter(e=>e.kind==='banked').length) : '—';
    const days = recent.length > 1 ? (new Date(recent[0].occurred_at)-new Date(recent[recent.length-1].occurred_at))/(recent.length-1)/86400000 : null;
    $('stat-average').textContent = days === null ? '—' : days.toFixed(1);
  }
  function renderFeed() {
    const items = state.events.filter(event => (state.kind==='all'||event.kind===state.kind)&&(!state.date||dateKey(event.occurred_at)===state.date)&&(!state.search||`${event.text} ${event.summary}`.toLowerCase().includes(state.search)));
    $('date-filter').hidden = !state.date;$('date-filter').querySelector('span').textContent = `正在查看 ${state.date} 的记录`;
    const fragment = document.createDocumentFragment();
    if (!items.length) {
      const empty=node('div','empty-state',state.failure&&!state.loaded?'数据暂时无法读取':!state.loaded?'正在加载重置动态…':state.events.length?'没有符合筛选条件的记录':'等待下一次值得记录的重置。');
      if(state.loaded&&!state.events.length)empty.append(node('p','', '数据同步后，真实的重置记录会出现在这里。'));
      fragment.append(empty);
    }
    for (const event of items.slice(0,state.limit)) {
      const article=node('article','feed-item');
      const date=new Date(event.occurred_at), parts=formatter({month:'2-digit',day:'2-digit'}).formatToParts(date);
      const dateBox=node('div','feed-date');dateBox.append(node('strong','',`${parts.find(p=>p.type==='month').value}.${parts.find(p=>p.type==='day').value}`),node('span','',formatter({year:'numeric'}).format(date)));article.append(dateBox);
      const content=node('div','feed-content'),meta=node('div','feed-meta');
      meta.append(node('span',`tag tag-${event.kind}`,event.kind==='banked'?'备用额度':'常规重置'));
      const observed = event.source_type === 'observed' || event.origin === 'codex-resets' && event.source_type !== 'x_post';
      meta.append(node('span','',observed?'社区观测 · Codex Resets':'原帖公告 · Tibo @thsottiaux'));content.append(meta);
      const heading = event.summary || (event.kind==='banked'?'Codex 备用额度重置记录':'Codex 常规额度重置记录');
      content.append(node('h3','',heading),node('p','',event.text));
      const bottom=node('div','feed-bottom');bottom.append(node('span','mono',`${exact(event.occurred_at)} · ${zone()}`));
      const link=node('a','',observed?'查看观测来源 ↗':'查看 X 原帖 ↗');link.href=safeLink(event.source_url);link.target='_blank';link.rel='noopener noreferrer';bottom.append(link);content.append(bottom);article.append(content);fragment.append(article);
    }
    $('feed').replaceChildren(fragment);$('load-more').hidden=items.length<=state.limit;
  }
  async function refresh() {
    const button=$('refresh-button');button.disabled=true;button.textContent='读取中…';
    try {
      const response=await fetch('/api/status',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('status');const data=await response.json();
      state.events=(Array.isArray(data.events)?data.events:[]).filter(e=>e&&Number.isFinite(new Date(e.occurred_at).getTime())&&new Date(e.occurred_at)<=Date.now()).sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at));state.sync=data.sync||{};state.scheduled=data.scheduled||null;state.loaded=true;state.failure=false;
    } catch {state.failure=true;}
    finally {button.disabled=false;button.textContent='刷新数据 ↻';renderLatest();freshness();renderCalendar();renderFeed();}
  }
  $('timezone').addEventListener('change',event=>{state.timezone=event.target.value;try{localStorage.setItem('reset-timezone',state.timezone);}catch{}state.date='';renderLatest();renderCalendar();renderFeed();});
  document.querySelectorAll('[data-kind]').forEach(button=>button.addEventListener('click',()=>{state.kind=button.dataset.kind;state.limit=6;document.querySelectorAll('[data-kind]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));});renderFeed();}));
  $('search').addEventListener('input',event=>{state.search=event.target.value.trim().toLowerCase();state.limit=6;renderFeed();});
  $('clear-date').addEventListener('click',()=>{state.date='';renderCalendar();renderFeed();});$('load-more').addEventListener('click',()=>{state.limit+=6;renderFeed();});$('refresh-button').addEventListener('click',refresh);
  renderCalendar();refresh();setInterval(refresh,60000);setInterval(()=>{renderLatest();freshness();},1000);
})();
