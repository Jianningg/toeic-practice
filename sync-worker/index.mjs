import { pushRoute, deliverReminders } from "./reminders.mjs";
const origin = "https://jianningg.github.io";
const limit = 1024 * 1024;
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");

function reply(status, body) {
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Match",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin"
  };
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

async function readPayload(request) {
  if (Number(request.headers.get("Content-Length")) > limit || !request.body) throw new RangeError();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new RangeError();
    }
    chunks.push(value);
  }
  const text = await new Blob(chunks).text();
  const payload = JSON.parse(text);
  if (typeof payload?.iv !== "string" || !/^[A-Za-z0-9+/]{16}$/.test(payload.iv) ||
      typeof payload?.data !== "string" || payload.data.length < 24 || payload.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.data)) throw new SyntaxError();
  return payload;
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(deliverReminders(env, new Date(event.scheduledTime))); },
  async fetch(request, env) {
    const caller = request.headers.get("Origin");
    if (caller && caller !== origin) return reply(403, { error: "origin" });
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/health") return reply(200, { service: "toeic-sync", version: 1 });
    if (path.startsWith("/push/")) {
      try { return await pushRoute(request, env, reply, path); }
      catch { return reply(500, { error: "push_service" }); }
    }
    const id = /^\/v1\/([a-f0-9]{64})$/.exec(path)?.[1];
    if (!id) return reply(404, { error: "route" });
    if (request.method === "OPTIONS") return reply(204);
    const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("Authorization") || "")?.[1];
    if (!token || hex(await crypto.subtle.digest("SHA-256", encoder.encode(token))) !== id) return reply(401, { error: "access" });
    if (request.method === "GET") {
      const stored = await env.DB.prepare("SELECT version, iv, data FROM progress WHERE id = ?").bind(id).first();
      return stored ? reply(200, stored) : reply(404, { error: "snapshot" });
    }
    if (request.method !== "PUT") return reply(405, { error: "method" });
    const expected = request.headers.get("If-Match");
    if (!expected || !/^(0|[1-9][0-9]{0,11})$/.test(expected)) return reply(428, { error: "version" });
    let payload;
    try { payload = await readPayload(request); }
    catch (error) { return reply(error instanceof RangeError ? 413 : 400, { error: "payload" }); }
    const version = Number(expected);
    const result = version === 0
      ? await env.DB.prepare("INSERT INTO progress (id, version, iv, data) VALUES (?, 1, ?, ?) ON CONFLICT(id) DO NOTHING")
        .bind(id, payload.iv, payload.data).run()
      : await env.DB.prepare("UPDATE progress SET version = version + 1, iv = ?, data = ? WHERE id = ? AND version = ?")
        .bind(payload.iv, payload.data, id, version).run();
    return result.meta.changes === 1 ? reply(200, { version: version + 1 }) : reply(409, { error: "conflict" });
  }
};
