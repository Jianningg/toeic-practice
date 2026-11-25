"use strict";

(() => {
  const key = 'toeic-reminder-v1';
  const presets = {
    daily: ['多益每日練習', '每天進步一點，今天也來練習 10 題吧！'],
    listening: ['今天練聽力', '戴上耳機，花幾分鐘練習一組多益聽力。'],
    review: ['錯題複習時間', '回顧錯題、讀懂解析，把不熟的地方練熟。']
  };
  const endpoint = document.querySelector('meta[name="toeic-sync-url"]')?.content?.replace(/\/$/, '');
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  let config, device, busy = false;
  try { device = JSON.parse(localStorage.getItem(key)); } catch { /* Recover to defaults. */ }
  if (!/^[a-f0-9]{64}$/.test(device?.token || '')) device = null;
  device ||= { token: Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''),
    time: '20:00', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei', preset: 'daily', title: presets.daily[0], body: presets.daily[1] };
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const status = text => { const node = document.querySelector('#reminder-status'); if (node) node.textContent = text; };
  function persist() {
    // Persist the device access token before creating a remote subscription so it can be removed later.
    localStorage.setItem(key, JSON.stringify(device));
  }
  async function api(method, suffix = '', body) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(device.token));
    const id = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
    const response = await fetch(endpoint + '/push/' + id + suffix, { method, credentials: 'omit',
      headers: { Authorization: 'Bearer ' + device.token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      let detail = {}; try { detail = await response.json(); } catch {}
      const messages = {
        not_subscribed: '請先按「啟用／儲存提醒」，再傳送測試。',
        subscription_expired: '這台裝置的訂閱已失效，請重新啟用提醒。',
        push_rejected: '推播平台未接受通知，請稍候再試。',
        push_runtime: '伺服器發送推播時發生錯誤，已記錄供修復。'
      };
      throw new Error(messages[detail.error] || (response.status === 429 ? '請稍候一分鐘再傳送測試。' : response.status === 503 ? '推播服務尚未設定，請完成 Worker 部署。' : '無法更新推播服務，請檢查網路後再試。'));
    }
    return response.json();
  }
  function fields() {
    const preset = document.querySelector('#reminder-preset').value;
    const custom = preset === 'custom';
    document.querySelector('#reminder-title').readOnly = !custom;
    document.querySelector('#reminder-body').readOnly = !custom;
    if (!custom) {
      document.querySelector('#reminder-title').value = presets[preset][0];
      document.querySelector('#reminder-body').value = presets[preset][1];
    }
  }
  function lock(value) {
    busy = value;
    document.querySelectorAll('#reminder-form button').forEach(button => { button.disabled = value; });
  }
  async function render() {
    const host = document.querySelector('#reminder-controls');
    if (!host) return;
    host.innerHTML = '<h2>每日提醒推播</h2><p class="muted spaced">每天依設定的時區與時間提醒，即使關閉網頁也能收到。iPhone／iPad 需先加入主畫面，從安裝後的 App 開啟並允許通知。系統省電或網路狀況可能延遲送達。</p>' +
      '<form id="reminder-form" class="settings-stack spaced"><label class="setting-control">提醒時間 <input id="reminder-time" type="time" required value="' + escape(device.time) + '"></label>' +
      '<label class="setting-control">時區 <input id="reminder-zone" type="text" required maxlength="80" value="' + escape(device.timezone) + '"></label>' +
      '<label class="setting-control">提醒內容 <select id="reminder-preset">' +
      [['daily','每日練習'],['listening','聽力練習'],['review','錯題複習'],['custom','自行設定']].map(([value,label]) => '<option value="' + value + '"' + (device.preset === value ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label>' +
      '<label class="setting-control">標題 <input id="reminder-title" type="text" required maxlength="40" value="' + escape(device.title) + '"></label>' +
      '<label class="reminder-message">內容 <textarea id="reminder-body" required maxlength="160" rows="3">' + escape(device.body) + '</textarea></label>' +
      '<div class="actions"><button type="submit" class="primary">啟用／儲存提醒</button><button type="button" id="reminder-test">傳送測試</button><button type="button" id="reminder-off">關閉提醒</button></div></form>' +
      '<p class="small muted spaced">提醒綁定這台裝置，與學習同步碼分開管理。標題最多 40 字、內容最多 160 字，通知可能出現在鎖定畫面。變更時區或內容後請按儲存。</p><p id="reminder-status" role="status" class="spaced small"></p>';
    fields();
    document.querySelector('#reminder-preset').addEventListener('change', fields);
    host.querySelector('form').addEventListener('submit', enable);
    document.querySelector('#reminder-test').addEventListener('click', () => action(async () => {
      await api('POST', '/test'); status('測試已送出，將顯示目前伺服器已儲存的提醒內容。');
    }));
    document.querySelector('#reminder-off').addEventListener('click', () => action(async () => {
      await api('DELETE');
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) await sub.unsubscribe();
      status('已關閉這台裝置的每日提醒。');
    }));
    if (!supported()) { lock(true); status('此瀏覽器不支援 Web Push。iPhone／iPad 請先加入主畫面再開啟。'); return; }
    config = null;
    lock(true); status('正在檢查推播服務…');
    try {
      const response = await fetch(endpoint + '/push/config', { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error();
      config = await response.json();
      if (!config.ready) throw new Error();
      const remote = await api('GET');
      if (!host.isConnected) return;
      status(remote.enabled ? '這台裝置已啟用提醒。儲存後會套用目前的時間與內容。' : '尚未啟用。選好時間與內容後，按「啟用／儲存提醒」。');
    } catch { status('推播服務尚未就緒。需要部署提醒 Worker、D1 遷移與 VAPID 金鑰後才能啟用。'); }
    finally { if (host.isConnected) lock(false); }
  }
  async function action(work) {
    if (busy) return;
    lock(true);
    try { await work(); } catch (error) { status(error.message); } finally { lock(false); }
  }
  async function enable(event) {
    event.preventDefault();
    if (busy) return;
    if (!config?.ready) { status('推播服務尚未就緒，請先完成 Worker 設定。'); return; }
    if (Notification.permission === 'denied') { status('通知權限已封鎖，請先在瀏覽器或系統設定中允許通知。'); return; }
    // Ask for permission only from this explicit user action (required by iOS).
    const permission = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission();
    await action(async () => {
      if (await permission !== 'granted') throw new Error('尚未允許通知，提醒未啟用。');
      const next = { ...device, time: document.querySelector('#reminder-time').value,
        timezone: document.querySelector('#reminder-zone').value.trim(), preset: document.querySelector('#reminder-preset').value,
        title: document.querySelector('#reminder-title').value.trim(), body: document.querySelector('#reminder-body').value.trim() };
      try { new Intl.DateTimeFormat('en', {timeZone: next.timezone}).format(); } catch { throw new Error('請填入有效時區，例如 Asia/Taipei。'); }
      if (!next.title || !next.body) throw new Error('請填寫提醒標題與內容。');
      device = next; persist();
      const reg = await navigator.serviceWorker.ready;
      const padding = '='.repeat((4 - config.publicKey.length % 4) % 4);
      const applicationServerKey = Uint8Array.from(atob((config.publicKey + padding).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      let sub = await reg.pushManager.getSubscription();
      const created = !sub;
      sub ||= await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey});
      try { await api('PUT', '', {...device, token: undefined, subscription: sub.toJSON()}); }
      catch (error) { if (created) await sub.unsubscribe(); throw error; }
      status('已啟用：每天 ' + device.time + '（' + device.timezone + '）。可按「傳送測試」確認通知。');
    });
  }
  window.addEventListener('toeic-settings-rendered', () => void render());
  void render();
})();
