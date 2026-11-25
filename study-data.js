"use strict";

window.createStudyData = (questions, getState, apply, notify) => {
  const configKey = "toeic-sync-v1";
  const sizeLimit = 1024 * 1024;
  const rates = [.5, .75, 1, 1.25, 1.5];
  const counts = [0, 10, 20];
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const codePattern = /^[a-f0-9]{64}$/;
  let config = {};
  let timer;
  let inFlight = false;
  let applying = false;
  let message = "";
  try {
    const stored = JSON.parse(localStorage.getItem(configKey));
    if (stored && codePattern.test(stored.code)) config = { code: stored.code, endpoint: endpoint(stored.endpoint) };
  } catch { /* Local storage is optional. */ }

  function normalize(data) {
    if (!data || !Array.isArray(data.attempts) || !data.wrong || typeof data.wrong !== "object") throw new Error("備份格式無效。");
    const attempts = new Map();
    for (const entry of data.attempts) {
      if (!entry || typeof entry.id !== "string" || !/^[a-f0-9-]{10,64}$/i.test(entry.id) ||
          typeof entry.title !== "string" || !Number.isFinite(entry.ended) || Math.abs(entry.ended) > 8.64e15 ||
          !Array.isArray(entry.ids)) continue;
      const ids = [...new Set(entry.ids.filter(id => questions.has(id)))];
      if (!ids.length) continue;
      const answers = Object.fromEntries(ids.flatMap(id => {
        const letter = entry.answers?.[id];
        return questions.get(id).choices.some(choice => choice[0] === letter) ? [[id, letter]] : [];
      }));
      attempts.set(entry.id, { id: entry.id, title: entry.title.slice(0, 160), ended: entry.ended, ids, answers });
    }
    const wrong = {};
    for (const [id, row] of Object.entries(data.wrong)) {
      if (questions.has(id) && row && Number.isSafeInteger(row.count) && row.count > 0 && Number.isFinite(row.last)) {
        wrong[id] = { count: row.count, corrected: row.corrected === true, last: row.last };
      }
    }
    return { attempts: [...attempts.values()].sort((a, b) => a.ended - b.ended || a.id.localeCompare(b.id)),
      wrong: Object.fromEntries(Object.entries(wrong).sort(([a], [b]) => a.localeCompare(b))),
      auto: data.auto !== false, rate: rates.includes(data.rate) ? data.rate : 1,
      unitCount: counts.includes(data.unitCount) ? data.unitCount : 10,
      preferenceAt: Number.isFinite(data.preferenceAt) ? data.preferenceAt : 0 };
  }
  function merge(local, other) {
    const preference = other.preferenceAt > local.preferenceAt ? other : local;
    const wrong = { ...local.wrong };
    for (const [id, entry] of Object.entries(other.wrong)) {
      const current = wrong[id];
      if (!current) wrong[id] = entry;
      else {
        const latest = entry.last > current.last || (entry.last === current.last && !entry.corrected) ? entry : current;
        wrong[id] = { ...latest, count: Math.max(current.count, entry.count) };
      }
    }
    const attempts = new Map([...other.attempts, ...local.attempts].map(row => [row.id, row]));
    return normalize({ ...preference, attempts: [...attempts.values()], wrong });
  }
  function applyMerged(data) {
    const local = normalize(getState());
    const merged = merge(local, data);
    if (JSON.stringify(merged) !== JSON.stringify(local)) {
      applying = true;
      try { apply(merged); } finally { applying = false; }
    }
    return merged;
  }
  function download() {
    const backup = { format: "toeic-study", version: 1, ...normalize(getState()) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "toeic-study-" + new Date().toISOString().slice(0, 10) + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(file) {
    if (!file) return;
    let result;
    try {
      if (file.size > sizeLimit * 2) throw new Error("備份檔太大。");
      const data = JSON.parse(await file.text());
      if (data.format !== "toeic-study" || data.version !== 1) throw new Error("請選擇多益練習室匯出的備份。");
      applyMerged(normalize(data));
      queue();
      result = "已合併備份。";
    } catch (error) { result = error instanceof SyntaxError ? "這個檔案不是有效的 JSON。" : error.message; }
    const status = document.querySelector("#backup-status");
    if (status) status.textContent = result;
  }

  const hex = value => Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, "0")).join("");
  const hash = value => crypto.subtle.digest("SHA-256", encoder.encode(value));
  const base64 = value => {
    const bytes = new Uint8Array(value);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  };
  const binary = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
  async function credentials(code) {
    const bearer = hex(await hash("toeic-auth:" + code));
    return {
      bearer, id: hex(await hash(bearer)),
      key: await crypto.subtle.importKey("raw", await hash("toeic-data:" + code), "AES-GCM", false, ["encrypt", "decrypt"])
    };
  }
  function endpoint(value) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("請輸入有效的 HTTPS 同步服務網址。");
    return url.href.replace(/\/+$/, "");
  }
  function report(text) { message = text; notify(text); }
  async function request(url, bearer, options) {
    return fetch(url, { ...options, credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { Authorization: "Bearer " + bearer, ...options?.headers } });
  }
  async function transfer(connection) {
    const access = await credentials(connection.code);
    const url = connection.endpoint + "/v1/" + access.id;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await request(url, access.bearer);
      if (!response.ok && response.status !== 404) throw new Error("同步服務暫時無法讀取。");
      const local = normalize(getState());
      let merged = local;
      let version = "0";
      if (response.ok) {
        const stored = await response.json();
        version = String(stored.version);
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: binary(stored.iv) }, access.key, binary(stored.data));
        const remote = normalize(JSON.parse(decoder.decode(plain)));
        merged = merge(local, remote);
        if (JSON.stringify(merged) === JSON.stringify(remote)) return merged;
      } else if (connection.join) {
        throw new Error("找不到這組同步碼。請在原裝置完成第一次同步後再試。");
      }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, access.key, encoder.encode(JSON.stringify(merged)));
      const body = JSON.stringify({ iv: base64(iv), data: base64(data) });
      if (body.length > sizeLimit) throw new Error("紀錄超過同步容量，請先匯出備份。");
      const saved = await request(url, access.bearer, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": version }, body });
      if (saved.ok) return merged;
      if (saved.status !== 409) throw new Error("同步服務暫時無法寫入。");
    }
    throw new Error("另一台裝置正在更新，請稍後再試。");
  }
  function persist(connection) {
    localStorage.setItem(configKey, JSON.stringify(connection));
    config = connection;
  }
  async function sync(connection = config, first = false) {
    if (!connection.code || inFlight) return;
    clearTimeout(timer);
    inFlight = true;
    report("正在同步…");
    try {
      const remote = await transfer(connection);
      if (first) persist({ endpoint: connection.endpoint, code: connection.code });
      if (config.code !== connection.code) return;
      applyMerged(remote);
      report("已同步 · " + new Intl.DateTimeFormat("zh-TW", { timeStyle: "short" }).format(new Date()));
      if (first) window.dispatchEvent(new Event("toeic-sync-connected"));
      if (JSON.stringify(normalize(getState())) !== JSON.stringify(remote)) queue();
    } catch (error) {
      report(error instanceof TypeError || error.name === "TimeoutError" ? "目前連不上同步服務。紀錄已留在本機。" : error.message);
    } finally { inFlight = false; }
  }
  function queue(delay = 5000) {
    if (!config.code || applying) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (inFlight) queue();
      else void sync();
    }, delay);
  }
  async function connect() {
    if (inFlight || config.code) return;
    try {
      const server = window.TOEIC_SYNC_URL || document.querySelector("#sync-endpoint").value.trim();
      const code = document.querySelector("#sync-code").value.trim().toLowerCase();
      if (code && !codePattern.test(code)) throw new Error("請輸入完整的同步碼。");
      await sync({ endpoint: endpoint(server), code: code || hex(crypto.getRandomValues(new Uint8Array(32))), join: !!code }, true);
    } catch (error) { report(error instanceof TypeError ? "請輸入有效的 HTTPS 同步服務網址。" : error.message); }
  }
  function disconnect() {
    if (inFlight || !window.confirm("停止這台裝置的同步？本機紀錄與雲端備份會保留。")) return;
    try { persist({}); clearTimeout(timer); report("這台裝置已停止同步。"); }
    catch { report("目前無法更改同步設定。"); }
  }
  async function copyCode() {
    if (!config.code) return;
    try { await navigator.clipboard.writeText(config.code); report("同步碼已複製。"); }
    catch { report("無法自動複製。請選取同步碼欄位手動複製。"); }
  }
  function controls() {
    const status = '<p id="sync-status" class="small muted spaced" role="status"></p>';
    if (config.code) {
      return '<div class="actions spaced"><label class="setting-control">同步碼 <input type="text" readonly value="' + config.code +
        '"></label><button data-action="sync-copy">複製</button><button data-action="sync-now">立即同步</button>' +
        '<button data-action="sync-stop">停止這台裝置同步</button></div>' + status;
    }
    return '<div class="actions spaced">' + (window.TOEIC_SYNC_URL ? "" :
      '<p class="muted small">雲端同步需要已部署的同步服務。也可以用下方的 JSON 備份搬移紀錄。</p><label class="setting-control">同步服務網址 <input type="url" id="sync-endpoint" placeholder="https://" autocomplete="off"></label>') +
      '<label class="setting-control">同步碼 <input type="text" id="sync-code" placeholder="首次啟用可留空" autocomplete="off" spellcheck="false"></label>' +
      '<button class="primary" data-action="sync-start">啟用同步</button></div>' + status;
  }
  const renderStatus = () => { if (message) notify(message); };
  queue();
  setInterval(() => { if (!document.hidden) queue(250); }, 45000);
  return { download, importFile, controls, queue, sync, connect, disconnect, copyCode, renderStatus };
};
