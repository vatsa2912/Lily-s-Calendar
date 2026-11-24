import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';
import { nextReminder } from './scheduler.js';

// This deployment schedules wall-clock times in India; keep the client informed.
process.env.TZ ||= 'Asia/Kolkata';
const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root,'.data'));
await fs.mkdir(dataDir,{recursive:true});
const dataFile = path.join(dataDir,'push-data.json');
const keysFile = path.join(dataDir,'vapid.json');
let vapid;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  vapid = {publicKey:process.env.VAPID_PUBLIC_KEY,privateKey:process.env.VAPID_PRIVATE_KEY};
} else {
  try { vapid=JSON.parse(await fs.readFile(keysFile,'utf8')); }
  catch(error) {
    if(error.code!=='ENOENT') throw error;
    vapid=webpush.generateVAPIDKeys();
    await fs.writeFile(keysFile,JSON.stringify(vapid),{mode:0o600,flag:'wx'});
  }
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://github.com/vatsa2912/Lily-s-Calendar',vapid.publicKey,vapid.privateKey);
let data={devices:{}};
try { data=JSON.parse(await fs.readFile(dataFile,'utf8')); }
catch(error) { if(error.code!=='ENOENT') throw error; }
const timers=new Map();
let writes=Promise.resolve();
function save() {
  const snapshot=JSON.stringify(data);
  const write=writes.then(async()=>{
    await fs.writeFile(dataFile+'.tmp',snapshot,{mode:0o600});
    await fs.rename(dataFile+'.tmp',dataFile);
  });
  writes=write.catch(()=>{});
  return write;
}
function scheduleDevice(device) {
  clearTimeout(timers.get(device.id));
  timers.delete(device.id);
  if(data.devices[device.id]!==device) return;
  const pending=nextReminder(device);
  if(!pending) return;
  // Node timers overflow after ~24.8 days; re-evaluate far-future events daily.
  timers.set(device.id,setTimeout(async()=>{
    if(data.devices[device.id]!==device) return;
    if(pending.due>Date.now()){scheduleDevice(device);return;}
    try {
      await webpush.sendNotification(device.subscription,JSON.stringify({
        title:pending.rule.category+' · '+pending.rule.title,
        body:'It is time for Lily’s care. Tap to mark done or snooze.',
        tag:pending.key,url:'./'
      }),{TTL:3600,urgency:'high',timeout:15000});
      // A sync may have completed while the network request was in flight.
      if(data.devices[device.id]!==device) return;
      device.tasks[pending.key]={...device.tasks[pending.key],next:Date.now()+pending.rule.interval*60000};
      await save();
    } catch(error) {
      if(data.devices[device.id]!==device) return;
      if([404,410].includes(error.statusCode)) {
        delete data.devices[device.id];
        await save();
        return;
      }
      console.error('Push delivery/storage failed:',error.statusCode || error.code || 'unknown');
      // Back off transient failures without losing the occurrence.
      timers.set(device.id,setTimeout(()=>scheduleDevice(device),60000));
      return;
    }
    scheduleDevice(device);
  },Math.max(500,Math.min(86400000,pending.due-Date.now()))));
}
const json=(res,status,value)=>{
  res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(value));
};
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
async function readBody(req) {
  if(!req.headers['content-type']?.startsWith('application/json')) throw fail('Use application/json.',415);
  const chunks=[]; let size=0;
  for await(const chunk of req) {
    size+=chunk.length;
    if(size>512000) throw fail('Request too large.',413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw fail('Invalid JSON.'); }
}
function validate(input,subscriptionRequired) {
  if(!input || !/^[a-f0-9-]{36}$/i.test(input.id || '')) throw fail('Invalid device ID.');
  if(!Array.isArray(input.rules) || input.rules.length>100) throw fail('Maximum 100 schedules.');
  for(const rule of input.rules) {
    if(!rule || !/^[a-f0-9-]{36}$/i.test(rule.id || '') ||
      typeof rule.title!=='string' || !rule.title.trim() || rule.title.length>100 ||
      !['Food','Medicine','Treat'].includes(rule.category) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(rule.date || '') ||
      !Number.isFinite(new Date(rule.date+'T12:00:00').getTime()) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rule.time || '') ||
      !['once','daily','weekly'].includes(rule.repeat) ||
      !Number.isInteger(rule.interval) || rule.interval<1 || rule.interval>1440 ||
      !Array.isArray(rule.days) || rule.days.some(d=>!Number.isInteger(d)||d<0||d>6) ||
      (rule.repeat==='weekly' && !rule.days.length)) throw fail('Invalid reminder.');
  }
  if(!input.tasks || Array.isArray(input.tasks) || typeof input.tasks!=='object' || Object.keys(input.tasks).length>10000) throw fail('Invalid task history.');
  for(const [key,task] of Object.entries(input.tasks)) {
    if(!/^[a-f0-9-]{36}\/\d{4}-\d{2}-\d{2}$/i.test(key) || !task || typeof task!=='object') throw fail('Invalid task.');
    for(const prop of ['done','next','updated']) {
      if(task[prop]!==undefined && (!Number.isFinite(task[prop]) || task[prop]<0 || task[prop]>8640000000000000)) throw fail('Invalid task time.');
    }
  }
  if(subscriptionRequired) {
    let endpoint;
    try { endpoint=new URL(input.subscription.endpoint); } catch { throw fail('Invalid subscription.'); }
    const host=endpoint.hostname;
    const allowed=host==='fcm.googleapis.com' || host==='updates.push.services.mozilla.com' ||
      host==='web.push.apple.com' || host.endsWith('.push.apple.com');
    if(endpoint.protocol!=='https:' || endpoint.port || endpoint.username || endpoint.password || !allowed ||
      !/^[A-Za-z0-9_-]{87}=?$/.test(input.subscription.keys?.p256dh || '') ||
      !/^[A-Za-z0-9_-]{22}={0,2}$/.test(input.subscription.keys?.auth || '')) throw fail('Unsupported push subscription.');
  }
}
async function api(req,res,pathname) {
  if(req.method==='GET' && pathname==='/api/vapid-public-key') return json(res,200,{publicKey:vapid.publicKey,timeZone:process.env.TZ});
  if(req.method==='POST' && ['/api/push/subscribe','/api/push/sync'].includes(pathname)) {
    const input=await readBody(req);
    const subscribing=pathname.endsWith('/subscribe');
    validate(input,subscribing);
    const existing=data.devices[input.id];
    if(!existing && !subscribing) return json(res,404,{error:'Enable notifications again.'});
    const tasks={};
    // Server follow-up times win over stale automatic in-app alert times.
    // Explicit Done/Snooze actions carry a newer timestamp and replace them.
    for(const [key,task] of Object.entries(input.tasks)) tasks[key]=task;
    for(const [key,task] of Object.entries(existing?.tasks || {})) {
      const ruleId=key.split('/')[0];
      const oldRule=existing.rules.find(r=>r.id===ruleId);
      const newRule=input.rules.find(r=>r.id===ruleId);
      if(!newRule) continue;
      if(JSON.stringify(oldRule)!==JSON.stringify(newRule) && !task.done) continue;
      if((tasks[key]?.updated || 0)<=(task.updated || 0)) tasks[key]=task;
    }
    const device={id:input.id,subscription:subscribing?input.subscription:existing.subscription,rules:input.rules,tasks};
    data.devices[input.id]=device;
    await save();
    scheduleDevice(device);
    return json(res,200,{ok:true});
  }
  return json(res,404,{error:'Not found.'});
}
const publicFiles=new Set(['index.html','app.js','style.css','sw.js','manifest.webmanifest','icon-192.png','icon-512.png']);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png'};
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  try {
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/healthz') return json(res,200,{ok:true});
    if(pathname.startsWith('/api/')) return await api(req,res,pathname);
    if(!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'Method not allowed.'});
    const name=pathname==='/'?'index.html':pathname.slice(1);
    if(!publicFiles.has(name)) return json(res,404,{error:'Not found.'});
    const content=await fs.readFile(path.join(root,name));
    res.writeHead(200,{'content-type':mime[path.extname(name)],'cache-control':'no-cache'});
    res.end(req.method==='HEAD'?undefined:content);
  } catch(error) {
    if(!error.status) console.error('Request failed:',error.code || 'internal error');
    json(res,error.status || 500,{error:error.status?error.message:'Server error.'});
  }
});
for(const device of Object.values(data.devices)) scheduleDevice(device);
server.listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.log('Lily Calendar ready on port '+server.address().port+'; timezone: '+process.env.TZ));
