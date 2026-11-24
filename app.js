const $ = id => document.getElementById(id);
const form = $('reminder');
const field = name => form.elements.namedItem(name);
const key = 'lily-calendar-v1';
const state = JSON.parse(localStorage.getItem(key) || '{"rules":[],"tasks":{}}');
const deviceIdKey = 'lily-calendar-push-device';
const deviceId = localStorage.getItem(deviceIdKey) || crypto.randomUUID();
localStorage.setItem(deviceIdKey, deviceId);
const names = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const dateKey = d => [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
const localDate = s => new Date(s + 'T12:00:00');
const weekday = d => (d.getDay()+6)%7;
const format = (d, options) => d.toLocaleDateString('en-IN',options);
const persist = () => localStorage.setItem(key,JSON.stringify(state));
let pushSubscription;
const pushPayload = () => ({id:deviceId,rules:state.rules,tasks:state.tasks});
async function syncPush(){
  if(!pushSubscription) return;
  try{ await fetch('./api/push/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(pushPayload())}); }
  catch(error){ console.warn('Could not sync push schedule',error); }
}
async function enablePush(){
  const status=$('pushStatus');
  if(!('serviceWorker' in navigator)||!('PushManager' in window)){status.textContent='This browser does not support lock-screen alerts.';return;}
  try{
    const permission=await Notification.requestPermission();
    if(permission!=='granted'){status.textContent='Allow notifications in Safari settings to enable lock-screen alerts.';return;}
    const registration=await navigator.serviceWorker.ready;
    const keyResponse=await fetch('./api/vapid-public-key');
    const {publicKey}=await keyResponse.json();
    if(!publicKey) throw new Error('Push service is not configured on the server.');
    const padding='='.repeat((4-publicKey.length%4)%4);
    const raw=atob((publicKey+padding).replace(/-/g,'+').replace(/_/g,'/'));
    pushSubscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))});
    const response=await fetch('./api/push/subscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...pushPayload(),subscription:pushSubscription.toJSON()})});
    if(!response.ok) throw new Error('The server rejected this subscription.');
    $('enablePush').textContent='Lock-screen alerts enabled'; $('enablePush').disabled=true; status.textContent='Lock-screen alerts are enabled for this iPhone.';
  }catch(error){status.textContent=`Could not enable lock-screen alerts: ${error.message}`;}
}
let selected = dateKey(new Date());
let month = localDate(selected);
let editing;
function button(label, action) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  el.onclick = action;
  return el;
}
function line(tag,text,cls) {
  const el = document.createElement(tag);
  el.textContent = text;
  if(cls) el.className = cls;
  return el;
}
function schedule(date) {
  return state.rules.filter(rule => date >= rule.date && (
    rule.repeat === 'daily' || (rule.repeat === 'once' && date === rule.date) ||
    (rule.repeat === 'weekly' && rule.days.includes(weekday(localDate(date))))
  )).sort((a,b) => a.time.localeCompare(b.time));
}
function taskKey(rule,date) { return rule.id + '/' + date; }
function timeOf(rule,date) { return new Date(date + 'T' + rule.time).getTime(); }
function showTime(ms) { return new Date(ms).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'}); }
function changeTask(rule,date,done) {
  const now = Date.now();
  state.tasks[taskKey(rule,date)] = done
    ? {done:now,title:rule.title,category:rule.category}
    : {next:now + rule.interval * 60000};
  persist();
  syncPush();
  render();
  tick();
}
function render() {
  $('month').textContent = format(month,{month:'long',year:'numeric'});
  const first = new Date(month.getFullYear(),month.getMonth(),1);
  const count = new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  const days = $('days');
  days.replaceChildren(...Array.from({length:weekday(first)}, () => line('span','')));
  for(let n=1;n<=count;n++){
    const date = dateKey(new Date(month.getFullYear(),month.getMonth(),n));
    const el = button(n,() => { selected=date; render(); });
    el.setAttribute('aria-pressed',String(date===selected));
    el.setAttribute('aria-label',format(localDate(date),{dateStyle:'full'}));
    el.dataset.dot = String(schedule(date).length>0);
    if(date===dateKey(new Date())) el.classList.add('current');
    days.append(el);
  }
  $('dayTitle').textContent = selected===dateKey(new Date()) ? 'Today’s care' : format(localDate(selected),{weekday:'short',day:'numeric',month:'short'});
  const items = $('items');
  items.replaceChildren();
  for(const rule of schedule(selected)){
    const date = selected;
    const task = state.tasks[taskKey(rule,date)];
    const card = line('article','','card');
    card.append(line('div',rule.category + ' · ' + showTime(timeOf(rule,date)),'tag'),line('p',rule.title));
    if(rule.notes) card.append(line('p',rule.notes));
    const actions = line('div','','actions');
    if(task?.done) actions.append(line('span','Done at ' + showTime(task.done),'tag'));
    else {
      actions.append(button('Done',()=>changeTask(rule,date,true)));
      if(timeOf(rule,date)<=Date.now()) actions.append(button('Snooze ' + rule.interval + ' min',()=>changeTask(rule,date,false)));
    }
    actions.append(button('Edit',()=>openEditor(rule)));
    card.append(actions);
    items.append(card);
  }
  if(!items.children.length) items.append(line('p','No reminders scheduled for this day.','empty'));
}
for(const [index,name] of names.entries()){
  const label = line('label',name);
  const checkbox = document.createElement('input');
  checkbox.type='checkbox'; checkbox.name='weekday'; checkbox.value=index;
  label.prepend(checkbox);
  document.querySelector('.checks').append(label);
}
field('repeat').onchange=()=>{ $('weekdays').hidden=field('repeat').value!=='weekly'; };
function openEditor(rule) {
  editing=rule;
  form.reset();
  $('editorTitle').textContent=rule?'Edit schedule':'Add reminder';
  for(const [name,value] of Object.entries(rule || {date:selected,time:'09:00'})){
    const el=field(name);
    if(el) el.value=value;
  }
  for(const checkbox of form.querySelectorAll('[name=weekday]')) checkbox.checked=rule?.days.includes(Number(checkbox.value)) || false;
  field('repeat').onchange();
  $('remove').hidden=!rule;
  $('editor').showModal();
}
form.onsubmit=event=>{
  event.preventDefault();
  const values=Object.fromEntries(new FormData(form));
  const days=new FormData(form).getAll('weekday').map(Number);
  const title=values.title.trim();
  if(!title){ alert('Enter a reminder name.'); return; }
  if(values.repeat==='weekly' && !days.length){ alert('Select at least one weekday.'); return; }
  const {category,date,time,repeat,interval,notes}=values;
  const rule={id:editing?.id || crypto.randomUUID(),title,category,date,time,repeat,interval:Number(interval),notes:notes.trim(),days};
  state.rules=state.rules.filter(item=>item.id!==rule.id);
  state.rules.push(rule);
  if(editing) for(const id of Object.keys(state.tasks)){
    if(id.startsWith(rule.id+'/') && !state.tasks[id].done) delete state.tasks[id];
  }
  selected=date;
  month=localDate(date);
  persist();
  syncPush();
  $('editor').close();
  render();
  tick();
};
$('remove').onclick=()=>{
  if(!editing || !confirm('Delete this reminder schedule?')) return;
  state.rules=state.rules.filter(item=>item.id!==editing.id);
  for(const id of Object.keys(state.tasks)){
    if(id.startsWith(editing.id+'/') && !state.tasks[id].done) delete state.tasks[id];
  }
  persist(); syncPush(); $('editor').close(); render(); tick();
};
$('add').onclick=()=>openEditor();
for(const node of document.querySelectorAll('[data-close]')) node.onclick=() => $(node.dataset.close).close();
$('today').onclick=()=>{ month=new Date(); selected=dateKey(month); render(); };
$('prev').onclick=()=>{ month=new Date(month.getFullYear(),month.getMonth()-1,1); render(); };
$('next').onclick=()=>{ month=new Date(month.getFullYear(),month.getMonth()+1,1); render(); };
$('history').onclick=()=>{
  const entries=Object.values(state.tasks).filter(task=>task.done).sort((a,b)=>b.done-a.done);
  $('entries').replaceChildren(...entries.map(task=>line('p',task.title+' · '+task.category+' · '+new Date(task.done).toLocaleString('en-IN'),'card')));
  if(!entries.length) $('entries').append(line('p','Completed reminders will appear here.','empty'));
  $('log').showModal();
};
const visibleAlerts=new Map();
function tick(){
  const now=Date.now();
  const today=dateKey(new Date(now));
  const dueIds=new Set();
  const dates=new Set([today]);
  for(const [id,task] of Object.entries(state.tasks)) if(task.next && !task.done) dates.add(id.split('/')[1]);
  for(const date of dates) for(const rule of schedule(date)){
    const id=taskKey(rule,date);
    const task=state.tasks[id];
    if(task?.done) continue;
    const next=task?.next ?? timeOf(rule,date);
    if(next>now){ if(visibleAlerts.has(id)) dueIds.add(id); continue; }
    dueIds.add(id);
    if(!visibleAlerts.has(id)){
      const card=line('article','');
      card.append(line('p',rule.category+' · '+rule.title),button('Done',()=>changeTask(rule,date,true)),document.createTextNode(' '),button('Snooze '+rule.interval+' min',()=>{
        card.remove(); visibleAlerts.delete(id); changeTask(rule,date,false);
      }));
      visibleAlerts.set(id,card);
      $('alerts').append(card);
    } else {
      const card=visibleAlerts.get(id);
      card.querySelector('p').textContent = 'Reminder ' + showTime(now) + ' · ' + rule.title;
      $('alerts').append(card);
    }
    state.tasks[id]={next:now+rule.interval*60000};
    persist();
  }
  for(const [id,card] of visibleAlerts) if(!dueIds.has(id)){card.remove(); visibleAlerts.delete(id);}
}
render();
tick();
setInterval(tick,1000);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) tick(); });
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
$('enablePush').onclick=enablePush;
navigator.serviceWorker?.ready.then(async registration=>{
  pushSubscription=await registration.pushManager.getSubscription();
  if(pushSubscription){$('enablePush').textContent='Lock-screen alerts enabled';$('enablePush').disabled=true;$('pushStatus').textContent='Lock-screen alerts are enabled for this iPhone.';syncPush();}
});
