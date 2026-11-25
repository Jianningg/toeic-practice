import * as webpush from 'web-push';

export const presets = {
  daily: { title: '多益每日練習', body: '每天進步一點，今天也來練習 10 題吧！' },
  listening: { title: '今天練聽力', body: '戴上耳機，花幾分鐘練習一組多益聽力。' },
  review: { title: '錯題複習時間', body: '回顧錯題、讀懂解析，把不熟的地方練熟。' }
};
const tokenPattern = /^[a-f0-9]{64}$/;
export async function deviceId(token) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), b => b.toString(16).padStart(2, '0')).join('');
}
export function validateSettings(data) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time)) throw new Error('time');
  if (typeof data.timezone !== 'string' || data.timezone.length > 80) throw new Error('timezone');
  new Intl.DateTimeFormat('en', { timeZone: data.timezone }).format();
  const message = Object.hasOwn(presets, data.preset) ? presets[data.preset] : data.preset === 'custom' ? data : null;
  if (!message || typeof message.title !== 'string' || !message.title.trim() || message.title.length > 40 ||
      typeof message.body !== 'string' || !message.body.trim() || message.body.length > 160) throw new Error('message');
  return { time: data.time, timezone: data.timezone, title: message.title.trim(), body: message.body.trim() };
}
export function validateSubscription(sub) {
  const url = new URL(sub?.endpoint);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
      !(url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' ||
        url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.push.apple.com') ||
        url.hostname === 'wns.windows.com' || url.hostname.endsWith('.notify.windows.com'))) throw new Error('endpoint');
  if (url.href.length > 2048 || !/^[\w-]{87}=?$/.test(sub.keys?.p256dh || '') || !/^[\w-]{22}={0,2}$/.test(sub.keys?.auth || '')) throw new Error('keys');
  return { endpoint: url.href, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}
export function localTime(now, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}
export function isDue(row, now) {
  const local = localTime(now, row.timezone);
  const [h, m] = row.time.split(':').map(Number);
  const delay = local.minute - (h * 60 + m);
  return row.last_sent !== local.date && delay >= 0 && delay < 15 ? local.date : null;
}
async function send(env, subscription, message) {
  const request = webpush.generateRequestDetails(validateSubscription(subscription), JSON.stringify(message), {
    vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE },
    TTL: 900, urgency: 'normal', contentEncoding: 'aes128gcm'
  });
  return fetch(request.endpoint, { method: 'POST', headers: request.headers, body: request.body, redirect: 'error', signal: AbortSignal.timeout(10000) });
}
export async function pushRoute(request, env, reply, path) {
  if (request.method === 'OPTIONS') return reply(204);
  if (path === '/push/config' && request.method === 'GET') {
    return reply(200, { publicKey: env.VAPID_PUBLIC || null, ready: !!(env.VAPID_PUBLIC && env.VAPID_PRIVATE && env.VAPID_SUBJECT) });
  }
  const id = /^\/push\/([a-f0-9]{64})(\/test)?$/.exec(path);
  if (!id) return reply(404, { error: 'route' });
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization') || '')?.[1];
  if (!tokenPattern.test(token || '') || await deviceId(token) !== id[1]) return reply(401, { error: 'access' });
  if (request.method === 'DELETE' && !id[2]) {
    await env.DB.prepare('DELETE FROM reminders WHERE id = ?').bind(id[1]).run();
    return reply(200, { enabled: false });
  }
  if (request.method === 'GET' && !id[2]) {
    const row = await env.DB.prepare('SELECT id FROM reminders WHERE id = ?').bind(id[1]).first();
    return reply(200, { enabled: !!row });
  }
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE || !env.VAPID_SUBJECT) return reply(503, { error: 'push_not_configured' });
  if (request.method === 'POST' && id[2]) {
    const row = await env.DB.prepare('SELECT * FROM reminders WHERE id = ?').bind(id[1]).first();
    if (!row) return reply(404, { error: 'not_subscribed' });
    // Also cap manual test delivery to once per minute per device.
    const changed = await env.DB.prepare('UPDATE reminders SET tested_at = ? WHERE id = ? AND tested_at < ?').bind(Date.now(), id[1], Date.now() - 60000).run();
    if (!changed.meta.changes) return reply(429, { error: 'test_rate' });
    const response = await send(env, JSON.parse(row.subscription), { title: row.title, body: row.body });
    if ([404, 410].includes(response.status)) await env.DB.prepare('DELETE FROM reminders WHERE id = ?').bind(id[1]).run();
    return reply(response.ok ? 200 : 502, { sent: response.ok });
  }
  if (request.method !== 'PUT' || id[2]) return reply(405, { error: 'method' });
  let data, settings, subscription;
  try {
    // Bounded read, independent of a possibly absent Content-Length header.
    if (!request.body) throw new Error();
    const reader = request.body.getReader(); const chunks = []; let size = 0;
    for (;;) { const {done, value} = await reader.read(); if (done) break; size += value.length;
      if (size > 8192) { await reader.cancel(); return reply(413, {error: 'size'}); } chunks.push(value); }
    data = JSON.parse(await new Blob(chunks).text());
    settings = validateSettings(data); subscription = validateSubscription(data.subscription);
  } catch { return reply(400, { error: 'settings' }); }
  await env.DB.prepare(`INSERT INTO reminders (id, subscription, time, timezone, title, body) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription, time=excluded.time, timezone=excluded.timezone, title=excluded.title, body=excluded.body`)
    .bind(id[1], JSON.stringify(subscription), settings.time, settings.timezone, settings.title, settings.body).run();
  return reply(200, { enabled: true });
}
export async function deliverReminders(env, now = new Date()) {
  if (!env.VAPID_PRIVATE || !env.VAPID_PUBLIC || !env.VAPID_SUBJECT) return;
  let cursor = '';
  for (;;) {
    const { results } = await env.DB.prepare('SELECT * FROM reminders WHERE id > ? ORDER BY id LIMIT 100').bind(cursor).all();
    if (!results.length) break;
    for (const row of results) {
      cursor = row.id;
      const date = isDue(row, now);
      if (!date) continue;
      const claim = await env.DB.prepare('UPDATE reminders SET last_sent = ? WHERE id = ? AND last_sent != ?').bind(date, row.id, date).run();
      if (!claim.meta.changes) continue;
      try {
        const response = await send(env, JSON.parse(row.subscription), {title: row.title, body: row.body});
        if ([404,410].includes(response.status)) { await env.DB.prepare('DELETE FROM reminders WHERE id = ?').bind(row.id).run(); continue; }
        if (!response.ok) throw new Error('push rejected');
      } catch {
        await env.DB.prepare('UPDATE reminders SET last_sent = ? WHERE id = ? AND last_sent = ?').bind(row.last_sent, row.id, date).run();
        console.warn('Reminder delivery failed; will retry within delivery window');
      }
    }
  }
}
