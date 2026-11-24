import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import webpush from 'web-push';

async function start(dir) {
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir,VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:''},stdio:['ignore','pipe','pipe']});
  const url=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill();reject(new Error('Server startup timeout'));},10000);
    child.once('error',error=>{clearTimeout(timeout);reject(error);});
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Server exited: '+code));});
    child.stdout.on('data',chunk=>{
      const match=String(chunk).match(/ready on port (\d+)/);
      if(match){clearTimeout(timeout);resolve('http://127.0.0.1:'+match[1]);}
    });
  });
  return {url,stop:async()=>{const exited=once(child,'exit');child.kill();await exited;}};
}

test('hosting: public assets only, subscription sync persists and survives restart',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'lily-test-'));
  let instance;
  try {
    instance=await start(dir);
    const get=path=>fetch(instance.url+path);
    assert.equal((await get('/')).status,200);
    assert.equal((await get('/healthz')).status,200);
    for(const route of ['/server.js','/.git/config','/push-data.json','/.data/vapid.json']) assert.equal((await get(route)).status,404,route);
    const key=await (await get('/api/vapid-public-key')).json();
    assert.equal(key.publicKey.length,87);
    const id=randomUUID();
    const now=new Date(); now.setDate(now.getDate()+1);
    const date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
    const input={id,rules:[{id:randomUUID(),title:'Test',category:'Food',date,time:'12:00',repeat:'daily',interval:10,days:[]}],tasks:{},subscription:{endpoint:'https://web.push.apple.com/test-not-real',keys:{p256dh:webpush.generateVAPIDKeys().publicKey,auth:'AAAAAAAAAAAAAAAAAAAAAA'}}};
    const post=(route,value)=>fetch(instance.url+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
    assert.equal((await post('/api/push/subscribe',input)).status,200);
    // This used to crash JSON.stringify on the live timer.
    assert.equal((await post('/api/push/sync',input)).status,200);
    const saved=JSON.parse(await readFile(path.join(dir,'push-data.json'),'utf8'));
    assert.equal(saved.devices[id].timer,undefined);
    assert.equal(saved.devices[id].rules.length,1);
    const bad={...input,subscription:{...input.subscription,endpoint:'https://127.0.0.1/private'}};
    assert.equal((await post('/api/push/subscribe',bad)).status,400);
    await instance.stop(); instance=null;
    instance=await start(dir);
    assert.deepEqual(await (await get('/api/vapid-public-key')).json(),key);
    assert.equal((await post('/api/push/sync',input)).status,200);
  } finally {
    if(instance) await instance.stop();
    // Only the explicit test-owned directory created by mkdtemp is removed.
    await rm(dir,{recursive:true,force:true});
  }
});
