import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSettings, validateSubscription, isDue, deviceId, pushRoute, deliverReminders } from '../sync-worker/reminders.mjs';
import worker from '../sync-worker/index.mjs';
import * as webpush from '../sync-worker/node_modules/web-push/src/index.js';
const valid = {time:'20:00', timezone:'Asia/Taipei', preset:'daily'};
const reply = (status, body) => ({status, body});
test('presets, custom text, time and timezone validation', () => {
  assert.match(validateSettings(valid).body, /10 題/);
  assert.equal(validateSettings({...valid, preset:'custom', title:'我的提醒', body:'背 10 個單字'}).title,'我的提醒');
  for (const changed of [{time:'25:00'},{timezone:'invalid'},{preset:'custom', title:'', body:'x'}, {preset:'custom',title:'x', body:'x'.repeat(161)}, {preset:'__proto__'}]) {
    assert.throws(()=>validateSettings({...valid,...changed}));
  }
});
test('local-day scheduling, duplicate suppression, late window and DST', () => {
  const row={...valid,last_sent:''};
  assert.equal(isDue(row,new Date('2026-11-25T12:00Z')), '2026-11-25');
  assert.equal(isDue({...row,last_sent:'2026-11-25'},new Date('2026-11-25T12:00Z')),null);
  assert.equal(isDue(row,new Date('2026-11-25T11:59Z')),null);
  assert.equal(isDue(row,new Date('2026-11-25T12:14Z')),'2026-11-25');
  assert.equal(isDue(row,new Date('2026-11-25T12:15Z')),null);
  assert.equal(isDue({time:'01:30',timezone:'America/New_York',last_sent:'2026-11-01'},new Date('2026-11-01T06:30Z')),null);
});
test('push destinations reject private hosts, redirects and invalid keys', () => {
  const sub={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:'A'.repeat(87),auth:'a'.repeat(22)}};
  assert.equal(validateSubscription(sub).endpoint,sub.endpoint);
  for(const endpoint of ['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://fcm.googleapis.com.evil.test/x','https://user@fcm.googleapis.com/x']) {
    assert.throws(()=>validateSubscription({...sub,endpoint}));
  }
});
test('API rejects incorrect device ownership and reports missing VAPID config', async () => {
  const token='a'.repeat(64), id=await deviceId(token);
  assert.equal((await pushRoute(new Request('https://test/push/'+id),{},reply,'/push/'+id)).status,401);
  assert.equal((await pushRoute(new Request('https://test/push/'+id,{method:'PUT',headers:{Authorization:'Bearer '+token}}),{},reply,'/push/'+id)).status,503);
  assert.equal((await pushRoute(new Request('https://test/push/config'),{},reply,'/push/config')).body.ready,false);
  assert.equal((await worker.fetch(new Request('https://test/push/config',{headers:{Origin:'https://evil.example'}}),{})).status,403);
  assert.equal((await worker.fetch(new Request('https://test/push/config',{method:'OPTIONS',headers:{Origin:'https://jianningg.github.io'}}),{})).status,204);
});
test('scheduled delivery encrypts message, claims date, and removes expired subscriptions', async () => {
  const keys=webpush.generateVAPIDKeys();
  const recipient=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const publicKey=Buffer.from(await crypto.subtle.exportKey('raw',recipient.publicKey)).toString('base64url');
  const row={id:'b'.repeat(64),...valid,title:'測試',body:'今天練習',last_sent:'',subscription:JSON.stringify({endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:publicKey,auth:Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url')}})};
  let deleted=false, delivered=0, status=201;
  const env={VAPID_PUBLIC:keys.publicKey,VAPID_PRIVATE:keys.privateKey,VAPID_SUBJECT:'https://jianningg.github.io/toeic-practice/', DB:{prepare(sql){return {bind(...args){return {
    async all(){return {results:args[0]===''&&!deleted?[row]:[]};},
    async run(){if(sql.startsWith('DELETE')){deleted=true;return {meta:{changes:1}};} const changed=row.last_sent!==args[2];row.last_sent=args[0];return {meta:{changes:Number(changed)}};}
  };}};}}};
  const original=globalThis.fetch;
  globalThis.fetch=async (url,options)=>{delivered++;assert.equal(new URL(url).hostname,'fcm.googleapis.com');assert.equal(options.redirect,'error');assert.equal(options.headers['Content-Encoding']||options.headers['content-encoding'],'aes128gcm');assert.ok(options.body.byteLength>0);return new Response(null,{status});};
  try {
    await deliverReminders(env,new Date('2026-11-25T12:00Z'));
    await deliverReminders(env,new Date('2026-11-25T12:01Z'));
    assert.equal(delivered,1);
    status=410;
    await deliverReminders(env,new Date('2026-11-26T12:00Z'));
    assert.equal(deleted,true);
  } finally {globalThis.fetch=original;}
});

test('service worker displays custom message and only opens the app question page', async () => {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const handlers = {}; let notification, opened;
  const scope='https://jianningg.github.io/toeic-practice/';
  runInNewContext(readFileSync(new URL('../sw.js',import.meta.url),'utf8'), {
    URL, self: {registration: {scope, showNotification:async(title, options)=>{notification={title,...options};}},addEventListener:(name,fn)=>{handlers[name]=fn;}},
    clients:{matchAll:async()=>[],openWindow:async url=>{opened=url;}}
  });
  let pending;
  handlers.push({data:{json:()=>({title:'自訂提醒',body:'練 20 題',url:'https://evil.example'})},waitUntil:p=>{pending=p;}});
  await pending;assert.equal(notification.title,'自訂提醒');assert.equal(notification.body,'練 20 題');
  handlers.notificationclick({notification:{close(){}},waitUntil:p=>{pending=p;}});
  await pending;assert.equal(opened,scope+'#units');
  handlers.push({data:{json:()=>{throw new Error();}},waitUntil:p=>{pending=p;}});
  await pending;assert.equal(notification.title,'多益每日練習');
});
