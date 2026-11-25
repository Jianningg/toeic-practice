"use strict";

const profileCodePattern = /^[a-f0-9]{64}$/;
const syncConfigKey = "toeic-sync-v1";
const toHex = value => Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, "0")).join("");

window.createStudyProfile = (legacyKey, defaults) => {
  const pointer = "toeic-active-code-v1";
  const storageKey = code => "toeic-profile-v1:" + code;
  let currentCode;
  let snapshot = structuredClone(defaults);
  try {
    const active = localStorage.getItem(pointer);
    const oldSync = JSON.parse(localStorage.getItem(syncConfigKey));
    currentCode = profileCodePattern.test(active || "") ? active :
      profileCodePattern.test(oldSync?.code || "") ? oldSync.code : undefined;
    const data = active && currentCode ? localStorage.getItem(storageKey(currentCode)) : localStorage.getItem(legacyKey);
    if (data) snapshot = { ...snapshot, ...JSON.parse(data) };
  } catch { /* Keep the current device usable when storage is unavailable. */ }
  currentCode ||= toHex(crypto.getRandomValues(new Uint8Array(32)));
  function write(data) {
    snapshot = data;
    localStorage.setItem(storageKey(currentCode), JSON.stringify(data));
  }
  try { write(snapshot); localStorage.setItem(pointer, currentCode); } catch { /* Report failure on a user write. */ }
  function read(code) {
    if (code === currentCode) return snapshot;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(storageKey(code))); } catch { /* Fall back to a new profile. */ }
    return { ...structuredClone(defaults), ...saved };
  }
  return {
    get code() { return currentCode; },
    read,
    write,
    has(code) {
      try { return !!localStorage.getItem(storageKey(code)); } catch { return false; }
    },
    activate(code) {
      const next = read(code);
      localStorage.setItem(storageKey(code), JSON.stringify(next));
      localStorage.setItem(pointer, code);
      currentCode = code;
      snapshot = next;
      return next;
    }
  };
};

window.createStudyData = (questions, getState, apply, notify, profile, switchProfile) => {
  const defaultEndpoint = document.querySelector('meta[name="toeic-sync-url"]')?.content || "";
  const sizeLimit = 1024 * 1024;
  const rates = [.5, .75, 1, 1.25, 1.5];
  const counts = [0, 10, 20];
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let config = {};
  let timer;
  let inFlight = false;
  let applying = false;
  let message = "";
  try {
    const stored = JSON.parse(localStorage.getItem(syncConfigKey));
    if (stored?.endpoint) config = { endpoint: endpoint(stored.endpoint) };
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
      petId: Number.isInteger(data.petId) && data.petId >= 1 && data.petId <= 6 ? data.petId : 1,
      petVisible: data.petVisible !== false,
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
    const backup = { format: "toeic-study", version: 2, profileCode: profile.code, ...normalize(getState()) };
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
      const code = data.version === 2 ? data.profileCode : null;
      if (data.format !== "toeic-study" || ![1, 2].includes(data.version) ||
          (data.version === 2 && (typeof code !== "string" || !profileCodePattern.test(code)))) throw new Error("請選擇多益練習室匯出的備份。");
      const restored = normalize(data);
      if (code && code !== profile.code) {
        switchProfile(code, merge(normalize(profile.read(code)), restored));
      } else applyMerged(restored);
      queue();
      result = "已合併備份。";
    } catch (error) { result = error instanceof SyntaxError ? "這個檔案不是有效的 JSON。" : error.message; }
    const status = document.querySelector("#backup-status");
    if (status) status.textContent = result;
  }

  const hash = value => crypto.subtle.digest("SHA-256", encoder.encode(value));
  const base64 = value => {
    const bytes = new Uint8Array(value);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  };
  const binary = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
  async function credentials(code) {
    const bearer = toHex(await hash("toeic-auth:" + code));
    return {
      bearer, id: toHex(await hash(bearer)),
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
  async function transfer(connection, readSnapshot = getState) {
    const access = await credentials(connection.code);
    const url = connection.endpoint + "/v1/" + access.id;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await request(url, access.bearer);
      if (!response.ok && response.status !== 404) throw new Error("同步服務暫時無法讀取。");
      const local = normalize(readSnapshot());
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
    localStorage.setItem(syncConfigKey, JSON.stringify(connection));
    config = connection;
  }
  async function sync(connection = { ...config, code: profile.code }, first = false) {
    if (!connection.endpoint || inFlight) return;
    clearTimeout(timer);
    inFlight = true;
    report("正在同步…");
    try {
      const remote = await transfer(connection);
      if (first) persist({ endpoint: connection.endpoint });
      if (profile.code !== connection.code) return;
      applyMerged(remote);
      report("已同步 · " + new Intl.DateTimeFormat("zh-TW", { timeStyle: "short" }).format(new Date()));
      if (first) window.dispatchEvent(new Event("toeic-sync-connected"));
      if (JSON.stringify(normalize(getState())) !== JSON.stringify(remote)) queue();
    } catch (error) {
      report(error instanceof TypeError || error.name === "TimeoutError" ? "目前連不上同步服務。紀錄已留在本機。" : error.message);
    } finally { inFlight = false; }
  }
  function queue(delay = 5000) {
    if (!config.endpoint || applying) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (inFlight) queue();
      else void sync();
    }, delay);
  }
  async function connect() {
    if (inFlight || config.endpoint) return;
    try {
      const server = defaultEndpoint || document.querySelector("#sync-endpoint").value.trim();
      await sync({ endpoint: endpoint(server), code: profile.code }, true);
    } catch (error) { report(error instanceof TypeError ? "請輸入有效的 HTTPS 同步服務網址。" : error.message); }
  }
  async function changeCode() {
    if (inFlight) return;
    const code = document.querySelector("#sync-code").value.trim().toLowerCase();
    if (!profileCodePattern.test(code)) { report("請輸入完整的同步碼。"); return; }
    if (code === profile.code) { report("目前已使用這組同步碼。"); return; }
    clearTimeout(timer);
    inFlight = true;
    try {
      const known = profile.has(code);
      const input = document.querySelector("#sync-endpoint")?.value.trim();
      const server = config.endpoint || defaultEndpoint || input;
      if (!known && !server) throw new Error("找不到此裝置上的同步碼。跨裝置切換需要同步服務。");
      let remote;
      if (server) {
        report("正在讀取這組同步碼的資料…");
        const url = endpoint(server);
        remote = await transfer({ endpoint: url, code, join: !known }, () => profile.read(code));
        if (!config.endpoint) persist({ endpoint: url });
      }
      switchProfile(code, remote);
      report("已切換同步碼。");
    } catch (error) {
      report(error instanceof TypeError || error.name === "TimeoutError" ? "目前連不上同步服務。原本的紀錄已保留。" : error.message);
    } finally { inFlight = false; }
  }
  function disconnect() {
    if (inFlight || !window.confirm("停止這台裝置的同步？本機紀錄與雲端備份會保留。")) return;
    try { persist({}); clearTimeout(timer); report("這台裝置已停止同步。"); }
    catch { report("目前無法更改同步設定。"); }
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(profile.code); report("同步碼已複製。"); }
    catch { report("無法自動複製。請選取同步碼欄位手動複製。"); }
  }
  function controls() {
    const status = '<p id="sync-status" class="small muted spaced" role="status"></p>';
    const code = '<div class="actions spaced"><label class="setting-control">目前同步碼 <input type="text" readonly value="' +
      profile.code + '"></label><button data-action="sync-copy">複製同步碼</button></div>';
    const service = config.endpoint ? '<div class="actions spaced"><button data-action="sync-now">立即同步</button>' +
      '<button data-action="sync-stop">停用雲端同步</button></div>' : '<div class="actions spaced">' +
      (defaultEndpoint ? "" : '<label class="setting-control">同步服務網址 <input type="url" id="sync-endpoint" placeholder="https://" autocomplete="off"></label>') +
      '<button data-action="sync-start">啟用雲端同步</button></div>';
    return code + service +
      '<div class="actions spaced"><label class="setting-control">另一組同步碼 <input type="text" id="sync-code" autocomplete="off" spellcheck="false"></label>' +
      '<button data-action="sync-switch">切換同步碼</button></div>' + status;
  }
  const renderStatus = () => { if (message) notify(message); };
  queue();
  setInterval(() => { if (!document.hidden) queue(250); }, 45000);
  return { download, importFile, controls, queue, sync, connect, changeCode, disconnect, copyCode, renderStatus };
};
