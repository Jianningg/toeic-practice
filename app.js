"use strict";

const bank = window.TOEIC_BANK;
const timings = window.TOEIC_TIMINGS;
const app = document.querySelector("#app");
const audio = document.querySelector("#recording");
const live = document.querySelector("#updates");
const letters = ["A", "B", "C", "D"];
const parts = [
  ["照片描述", "Photographs"], ["問答", "Question–Response"], ["簡短對話", "Conversations"],
  ["簡短獨白", "Short Talks"], ["句子填空", "Incomplete Sentences"],
  ["段落填空", "Text Completion"], ["閱讀理解", "Reading Comprehension"]
];
const questions = new Map(bank.questions.map(question => [question.id, question]));
const initial = { active: null, attempts: [], wrong: {}, auto: true, rate: 1, unitCount: 10, petId: 1, petVisible: true, preferenceAt: 0 };
const profile = window.createStudyProfile("toeic-study-v1", initial);
let state = profile.read(profile.code);
let storageWarning = false;
let currentRoute;
let audioTarget = null;
let audioNotice = "";
let mockSavedSecond = 0;
let mockCue = 0;
const pets = ["太陽", "紅白條紋", "比愛心", "黃色墨鏡", "黑色上衣", "淺藍上衣"];
const petLines = ["一起練習吧！", "做完這題就很棒！", "準備好再聽一次。", "照自己的節奏來！"];
let petMessage = 0;
let petTimer;
const filters = { unitRound: 0, unitCount: state.unitCount, mockScope: "all", wrongPart: 0, wrongRound: 0, wrongStatus: "open" };
const study = window.createStudyData(questions, () => state, mergeStudy, updateSettings, profile, switchStudyProfile);
const icons = {
  headphones: '<path d="M3 14v-3a9 9 0 0 1 18 0v3M3 14v3a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2Zm13 0v3a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2h-1a2 2 0 0 0-2 2Z"/>',
  book: '<path d="M3 5h6a3 3 0 0 1 3 3v12a4 4 0 0 0-3-2H3zM21 5h-6a3 3 0 0 0-3 3v12a4 4 0 0 1 3-2h6z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  edit: '<path d="M9 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4M10 14l1-4 7-7 3 3-7 7-4 1Z"/>'
};

function save() {
  try { profile.write(state); }
  catch {
    storageWarning = true;
    live.textContent = "目前無法儲存學習紀錄。請確認瀏覽器允許網站儲存資料。";
  }
  study.queue();
}
function switchStudyProfile(code, remote) {
  const saved = profile.activate(code);
  stopAudio();
  state = saved;
  mergeStudy(remote || {});
}
function mergeStudy(data) {
  Object.assign(state, data);
  audio.defaultPlaybackRate = state.rate;
  if (state.active?.section !== "L" || state.active.mode !== "mock") audio.playbackRate = state.rate;
  filters.unitCount = state.unitCount;
  save();
  if (["settings", "history", "wrong", "home"].includes(currentRoute)) render();
}
function esc(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
function icon(name) {
  return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + "</svg>";
}
function heading(title, subtitle) {
  return '<div class="page-head"><h1>' + title + '</h1><p class="muted">' + subtitle + "</p></div>";
}
function button(label, action, value = "", css = "", disabled = false) {
  return '<button type="button" data-action="' + action + '" data-value="' + esc(value) + '" class="' + css + '"' + (disabled ? " disabled" : "") + ">" + label + "</button>";
}
function select(name, values, css = "") {
  return '<select data-filter="' + name + '" class="' + css + '">' + values.map(([value, label]) =>
    '<option value="' + value + '"' + (String(filters[name]) === String(value) ? " selected" : "") + ">" + label + "</option>"
  ).join("") + "</select>";
}
function roundChoices() {
  return [[0, "全部回次"], ...[1, 2, 3, 4].map(number => [number, "第 " + number + " 回"])];
}
function percentage(correct, total) {
  return total ? Math.round(100 * correct / total) + "%" : "—";
}
function resultTotals(attempt, ids = attempt.ids) {
  return { correct: ids.filter(id => attempt.answers[id] === questions.get(id).answer).length,
    answered: ids.filter(id => attempt.answers[id] !== undefined).length, total: ids.length };
}
function stats() {
  const totals = state.attempts.reduce((count, attempt) => {
    const result = resultTotals(attempt);
    return { correct: count.correct + result.correct, answered: count.answered + result.answered };
  }, { correct: 0, answered: 0 });
  return '<div class="stats"><div><span class="muted small">累計作答</span><strong>' + totals.answered +
    '</strong></div><div><span class="muted small">作答正確率</span><strong>' + percentage(totals.correct, totals.answered) +
    '</strong></div><div><span class="muted small">待訂正</span><strong>' + Object.values(state.wrong).filter(entry => !entry.corrected).length + "</strong></div></div>";
}
function home() {
  const modes = [
    ["units", "book", "", "單元題庫", "依 Part 練習，每題看答案與解析。"],
    ["mocks", "clock", "green", "模擬考", "第 1–4 回限時測驗，可單考聽力或閱讀。"],
    ["wrong", "edit", "orange", "錯題本", "重做答錯的題目，追蹤訂正進度。"]
  ];
  const resume = state.active ? ' <a class="button secondary" href="#quiz">繼續作答</a>' : "";
  return '<section class="hero"><div><h1>多益練習室</h1><p>四回多益聽力與閱讀練習，共 ' + bank.questions.length +
    ' 題。</p><div class="actions"><a class="button primary" href="#units">開始練習</a>' + resume +
    '</div></div><div class="hero-pet"><img src="' + petFile() + '" alt="" width="112" height="126">' +
    '<a class="button secondary" href="#settings/pet">選擇陪練角色</a></div></section><section><div class="section-head"><h2>選擇練習方式</h2></div><div class="grid">' +
    modes.map(([route, graphic, color, title, subtitle]) => '<a class="card" href="#' + route + '"><span class="icon-tile ' + color + '">' + icon(graphic) +
      '</span><h3>' + title + '</h3><p class="muted small">' + subtitle + '</p></a>').join("") +
    '</div></section><section><div class="section-head"><h2>學習概況</h2><a class="link small" href="#history">查看紀錄</a></div>' + stats() + "</section>";
}
function petFile(id = state.petId) {
  return "theme/pet-" + (pets[id - 1] ? id : 1) + ".webp";
}
function updatePet() {
  const dock = document.querySelector("#pet-dock");
  const image = document.querySelector("#pet-image");
  const file = petFile();
  if (image.getAttribute("src") !== file) image.src = file;
  dock.hidden = !state.petVisible || currentRoute === "settings";
  const brand = document.querySelector("#brand-photo");
  const badge = state.petId === 4 ? "theme/person-4.webp" : "theme/person-1.webp";
  if (brand.getAttribute("src") !== badge) brand.src = badge;
}
function choosePet(id) {
  if (!pets[id - 1]) return;
  state.petId = id;
  state.petVisible = true;
  preferenceChanged();
  render();
  document.querySelector('[data-action="pet-select"][data-value="' + id + '"]')?.focus({ preventScroll: true });
}
function petSettings() {
  return '<section class="panel" id="pet-settings"><h2>陪練角色</h2>' +
    '<label class="setting-control spaced"><input type="checkbox" id="pet-visible"' + (state.petVisible ? " checked" : "") + '> 在網頁上顯示走動角色</label>' +
    '<div class="pet-choices spaced">' + pets.map((name, index) =>
      '<button type="button" data-action="pet-select" data-value="' + (index + 1) + '" aria-pressed="' + (state.petId === index + 1) +
      '"><img src="' + petFile(index + 1) + '" width="68" height="78" alt=""><span>' + name + '</span></button>').join("") + '</div></section>';
}
function units() {
  const tiles = (start, end) => '<div class="grid">' + parts.slice(start - 1, end).map(([name, english], i) => {
    const part = start + i;
    const count = bank.questions.filter(q => q.part === part && (!filters.unitRound || q.round === filters.unitRound)).length;
    return '<article class="card"><span class="badge">Part ' + part + "</span><h3>" + name + '</h3><p class="muted small">' + english + " · " + count +
      ' 題</p><div>' + button("開始練習", "start-unit", part) + "</div></article>";
  }).join("") + "</div>";
  return heading("單元題庫", "選一個 Part 開始。共用素材的題組會完整出題。") +
    '<div class="filters"><label>回次 ' + select("unitRound", roundChoices()) + '</label><label>練習題數 ' +
    select("unitCount", [[10, "約 10 題"], [20, "約 20 題"], [0, "全部題目"]]) + '</label></div>' +
    '<div class="section-head"><h2>聽力</h2></div>' + tiles(1, 4) + '<div class="section-head"><h2>閱讀</h2></div>' + tiles(5, 7);
}
function mocks() {
  return heading("模擬考", "限時作答，交卷後統一計分並檢討。") +
    '<div class="filters"><label>考試範圍 ' + select("mockScope", [["all", "整回 · 200 題"], ["L", "聽力 · 100 題"], ["R", "閱讀 · 100 題"]]) +
    '</label></div><div class="grid two">' + [1, 2, 3, 4].map(round => {
      const listening = Math.ceil(timings[round].duration / state.rate / 60);
      const details = filters.mockScope === "R" ? "閱讀 75 分鐘" : filters.mockScope === "L" ? "聽力約 " + listening + " 分鐘" :
        "聽力約 " + listening + " 分鐘 · 閱讀 75 分鐘";
      return '<article class="card"><span class="icon-tile green">' + icon("clock") + '</span><h2>第 ' + round +
        ' 回</h2><p class="muted small">' + details + '</p><div>' + button("開始模擬考", "start-mock", round, "primary") + "</div></article>";
    }).join("") + "</div>";
}
function filteredWrong() {
  return Object.entries(state.wrong).filter(([id, entry]) => {
    const q = questions.get(id);
    return q && (!filters.wrongPart || q.part === filters.wrongPart) && (!filters.wrongRound || q.round === filters.wrongRound) &&
      (filters.wrongStatus === "all" || entry.corrected === (filters.wrongStatus === "closed"));
  }).sort((a, b) => b[1].last - a[1].last);
}
function wrong() {
  const entries = filteredWrong();
  return heading("錯題本", "練習與模考的錯題會自動收錄。重做答對後會標為已訂正。") +
    '<div class="filters"><label>狀態 ' + select("wrongStatus", [["open", "待訂正"], ["closed", "已訂正"], ["all", "所有錯題"]]) +
    '</label><label>回次 ' + select("wrongRound", roundChoices()) + '</label><label>題型 ' +
    select("wrongPart", [[0, "全部題型"], ...parts.map(([part], i) => [i + 1, "Part " + (i + 1) + " " + part])]) + '</label></div>' +
    (entries.length ? '<div class="section-head"><h2>' + entries.length + ' 題</h2>' + button("重做篩選題目", "retry-filter", "", "primary") +
      '</div><div class="list">' + entries.map(([id, entry]) => {
        const q = questions.get(id);
        return '<article class="row"><div><strong>第 ' + q.round + ' 回 · Part ' + q.part + ' · 第 ' + q.number +
          ' 題</strong><p class="muted small">答錯 ' + entry.count + ' 次 · ' + (entry.corrected ? "已訂正" : "待訂正") +
          '</p></div>' + button("重做此題", "retry-one", id) + "</article>";
      }).join("") + "</div>" : '<div class="panel muted">這個篩選條件下沒有錯題。</div>');
}
function history() {
  const rows = [...state.attempts].reverse().map(attempt => {
    const { correct, total } = resultTotals(attempt);
    return '<article class="row"><div><strong>' + esc(attempt.title) + '</strong><p class="muted small">' +
      new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(attempt.ended) + " · " + correct + " / " +
      total + '</p></div><a class="button" href="#result/' + attempt.id + '">查看結果</a></article>';
  }).join("");
  const partRows = parts.map(([label], i) => {
    let correct = 0;
    let answered = 0;
    for (const attempt of state.attempts) {
      const result = resultTotals(attempt, attempt.ids.filter(id => questions.get(id).part === i + 1));
      correct += result.correct;
      answered += result.answered;
    }
    return '<div class="row"><span>Part ' + (i + 1) + " · " + label + '</span><strong>' + percentage(correct, answered) + "</strong></div>";
  }).join("");
  return heading("學習紀錄", "紀錄儲存在目前的瀏覽器。") + stats() +
    (state.active ? '<div class="spaced"><a class="button primary" href="#quiz">繼續作答</a></div>' : "") +
    '<div class="section-head"><h2>各 Part 正確率</h2></div><div class="grid two">' + partRows +
    '</div><div class="section-head"><h2>歷次練習</h2></div><div class="list">' +
    (rows || '<div class="panel muted">完成第一次練習後，結果會顯示在這裡。</div>') + "</div>";
}
function start(mode, title, ids, extra = {}) {
  if (!ids.length) return;
  if (state.active && !window.confirm("有一份未完成的練習。要捨棄目前進度並開始這一份嗎？")) return;
  stopAudio();
  state.active = { id: crypto.randomUUID?.() || String(Date.now()), mode, title, ids, index: 0, answers: {}, checked: {}, flags: {}, ...extra };
  save();
  go("quiz");
  if (mode === "mock" && extra.section === "L") playMock();
  else if (mode !== "mock" && state.auto && activeQuestion()?.part <= 4) playClip(activeQuestion(), true);
}
function go(route) {
  if (location.hash === "#" + route) render();
  else { location.hash = route; render(); }
}
function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
function startUnit(part) {
  const matches = bank.questions.filter(q => q.part === part && (!filters.unitRound || filters.unitRound === q.round));
  const sets = new Map();
  for (const q of matches) {
    if (!sets.has(q.group)) sets.set(q.group, []);
    sets.get(q.group).push(q.id);
  }
  const ids = [];
  const groups = [...sets.values()];
  if (!filters.unitRound) shuffle(groups);
  for (const group of groups) {
    ids.push(...group);
    if (filters.unitCount && ids.length >= filters.unitCount) break;
  }
  start("unit", "Part " + part + " · " + parts[part - 1][0], ids);
}
function startMock(round) {
  const scope = filters.mockScope;
  const section = scope === "R" ? "R" : "L";
  const ids = bank.questions.filter(q => q.round === round && (scope === "all" || q.section === scope)).map(q => q.id);
  const label = scope === "all" ? "整回" : scope === "L" ? "聽力" : "閱讀";
  start("mock", "第 " + round + " 回模擬考 · " + label, ids,
    { round, scope, section, offset: 0, listenRate: state.rate, deadline: section === "R" ? Date.now() + 75 * 60 * 1000 : null });
}
function activeQuestion() {
  const session = state.active;
  return session ? questions.get(session.ids[session.index]) : null;
}
function clockValue(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}
function tick() {
  const session = state.active;
  if (session?.mode !== "mock" || !session.deadline) return;
  const node = document.querySelector("#clock");
  if (node) node.textContent = clockValue(session.deadline - Date.now());
  if (session.deadline > Date.now()) return;
  if (session.section === "L") endListening();
  else finish();
}
function endListening() {
  const session = state.active;
  if (session?.mode !== "mock" || session.section !== "L") return;
  if (session.scope !== "all") { finish(); return; }
  const sectionEnd = Math.min(Date.now(), session.deadline || Date.now());
  stopAudio();
  session.section = "R";
  session.deadline = sectionEnd + 75 * 60 * 1000;
  session.index = session.ids.findIndex(id => questions.get(id).section === "R");
  save();
  if (currentRoute === "quiz") render();
  live.textContent = "聽力結束，開始閱讀測驗。";
}
function move(index, focusQuestion = true) {
  const session = state.active;
  const next = session && questions.get(session.ids[index]);
  if (!next || (session.mode === "mock" && next.section !== session.section)) return;
  const previous = activeQuestion();
  session.index = index;
  if (session.mode !== "mock" && previous.group !== next.group) {
    stopAudio();
    if (state.auto && next.part <= 4) playClip(next, true);
  }
  save();
  render();
  if (focusQuestion) document.querySelector("#question-title")?.focus({ preventScroll: true });
}
function selectAnswer(letter) {
  const session = state.active;
  const q = activeQuestion();
  if (!session || !q?.choices.some(([value]) => value === letter) || session.checked[q.id]) return;
  session.answers[q.id] = letter;
  save();
  render();
  document.querySelector('.option[data-value="' + letter + '"]')?.focus({ preventScroll: true });
}
function registerWrong(q, choice) {
  if (!choice) return;
  const entry = state.wrong[q.id];
  if (q.answer !== choice) state.wrong[q.id] = { count: (entry?.count ?? 0) + 1, corrected: false, last: Date.now() };
  else if (entry && !entry.corrected) {
    entry.corrected = true;
    entry.last = Date.now();
  }
}
function checkAnswer() {
  const session = state.active;
  const q = activeQuestion();
  if (!session || session.mode === "mock" || !q || session.checked[q.id] || !session.answers[q.id]) return;
  session.checked[q.id] = true;
  registerWrong(q, session.answers[q.id]);
  save();
  render();
  document.querySelector("#answer-feedback")?.focus();
}
function finish() {
  const session = state.active;
  if (!session) return;
  for (const id of session.ids) {
    if (!session.checked[id]) registerWrong(questions.get(id), session.answers[id]);
  }
  const attempt = { id: session.id, title: session.title, ids: session.ids, answers: session.answers, ended: Date.now() };
  state.attempts.push(attempt);
  state.active = null;
  stopAudio();
  save();
  go("result/" + attempt.id);
}
function submit() {
  const session = state.active;
  if (!session) return;
  const unanswered = session.ids.length - Object.keys(session.answers).length;
  if (session.mode === "mock" && !window.confirm(unanswered ? "還有 " + unanswered + " 題未答，確定交卷？" : "確定交卷並查看結果？")) return;
  finish();
}
function stopAudio() {
  audioTarget = null;
  mockCue = 0;
  audio.pause();
  audioNotice = "";
  updateAudioUI();
}
function syncAudio(round) {
  if (audio.dataset.round === String(round)) return;
  audio.dataset.round = round;
  audio.src = "listening-" + round + ".m4a";
}
function mockPosition(session, now) {
  const duration = timings[session.round].duration;
  const elapsed = session.deadline ? duration - (session.deadline - now) / 1000 * (session.listenRate || 1) : 0;
  return Math.min(duration, Math.max(session.offset || 0, elapsed));
}
function setSpeed(rate) {
  const session = state.active;
  if (session?.mode === "mock" && session.section === "L") {
    const now = Date.now();
    const duration = timings[session.round].duration;
    const position = audioTarget?.mock && !audio.paused ? audio.currentTime : mockPosition(session, now);
    if (session.deadline) session.deadline = now + Math.max(0, duration - position) * 1000 / rate;
    session.listenRate = rate;
    if (session.deadline) session.offset = position;
  }
  state.rate = rate;
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
  preferenceChanged();
  tick();
}
function preferenceChanged() {
  state.preferenceAt = Date.now();
  save();
}
function requestAudio(target, position) {
  audioTarget = target;
  audioNotice = "";
  syncAudio(target.round);
  const rate = target.mock ? state.active.listenRate || 1 : state.rate;
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
  if (position !== null) audio.currentTime = Math.max(0, position);
  audio.play().then(() => {
    if (audioTarget !== target) return;
    if (target.mock && !state.active?.deadline) {
      state.active.deadline = Date.now() + Math.ceil((timings[target.round].duration - audio.currentTime) * 1000 / audio.playbackRate);
      save();
    }
    updateAudioUI();
  }).catch(() => {
    if (audioTarget !== target) return;
    audioNotice = audio.error ? "音檔載入失敗，請重新整理再試。" : "請點「播放」啟動音訊。";
    updateAudioUI();
  });
  updateAudioUI();
}
function playClip(q, restart = false) {
  if (!q || q.part > 4) return;
  const range = timings[q.round].clips[q.groupNumber];
  const target = { round: q.round, group: q.group, start: range[0], end: range[1], mock: false };
  const resume = !restart && audioTarget?.group === target.group && audio.currentTime >= target.start && audio.currentTime < target.end - .15;
  requestAudio(target, resume ? null : target.start);
}
function playMock() {
  const session = state.active;
  if (session?.mode !== "mock" || session.section !== "L") return;
  const duration = timings[session.round].duration;
  const target = { round: session.round, mock: true, end: duration };
  const resume = audioTarget?.mock && audioTarget.round === target.round && !audio.paused;
  requestAudio(target, resume ? null : mockPosition(session, Date.now()));
}
function updateAudioUI() {
  const node = document.querySelector("#audio-status");
  const status = audioNotice || (audioTarget && !audio.paused
    ? (audioTarget.mock && mockCue ? " · 錄音進度第 " + mockCue + " 題" : " · 播放中")
    : "");
  if (node && node.textContent !== status) node.textContent = status;
}
audio.addEventListener("playing", updateAudioUI);
audio.addEventListener("pause", updateAudioUI);
audio.addEventListener("error", () => {
  if (audioTarget && audio.error) { audioNotice = "音檔載入失敗，請重新整理再試。"; updateAudioUI(); }
});
audio.addEventListener("timeupdate", () => {
  if (!audioTarget) return;
  const session = state.active;
  if (audioTarget.mock && session?.mode === "mock" && session.section === "L") {
    if (Math.abs(audio.currentTime - mockSavedSecond) > 5) {
      mockSavedSecond = audio.currentTime;
      session.offset = audio.currentTime;
      save();
    }
    const nextCue = timings[session.round].cues.findLastIndex(start => start <= audio.currentTime) + 1;
    if (nextCue !== mockCue) {
      const previousCue = mockCue;
      mockCue = nextCue;
      if (nextCue && currentRoute === "quiz" && activeQuestion()?.number === (previousCue || 1)) {
        const index = session.ids.findIndex(id => questions.get(id).number === nextCue);
        if (index !== session.index) move(index, false);
      }
      updateAudioUI();
    }
  } else if (audio.currentTime >= audioTarget.end) audio.pause();
});
audio.addEventListener("ended", () => { if (audioTarget?.mock) endListening(); else updateAudioUI(); });
function player(q, mock) {
  return '<div class="audio-panel"><div class="actions">' + icon("headphones") +
    (mock ? button("播放／繼續整回錄音", "mock-play") :
      button("播放", "play") + button("暫停", "pause") + button("重播本" + (q.part >= 3 ? "題組" : "題"), "replay") +
      (currentRoute === "quiz" ? '<label class="toggle small"><input id="autoplay" type="checkbox"' + (state.auto ? " checked" : "") + '> 隨題播放</label>' : "")) +
    rateSelect(mock ? state.active.listenRate || 1 : state.rate) +
    '</div><p class="muted small">' + (mock ? "依原錄音順序播放，可切換題號。倒數會依倍速調整。" : q.part >= 3 ? "同一題組共用一段錄音。" : "請聽錄音並選出答案。") +
    '<span id="audio-status" class="small" role="status"></span></p></div>';
}
function rateSelect(rate) {
  return '<label class="setting-control small">播放速度 <select data-speed>' +
    [[.5, "0.5"], [.75, "0.75"], [1, "1.0"], [1.25, "1.25"], [1.5, "1.5"]].map(([value, label]) =>
      '<option value="' + value + '"' + (rate === value ? " selected" : "") + ">" + label + "×</option>").join("") + "</select></label>";
}
function settings() {
  return heading("設定", "管理聽力偏好、跨裝置同步與作答紀錄備份。") +
    '<div class="settings-stack"><section class="panel"><h2>練習偏好</h2><div class="actions spaced">' +
    rateSelect(state.rate) + '<label class="setting-control"><input id="autoplay" type="checkbox"' + (state.auto ? " checked" : "") +
    '> 聽力換題自動播放</label><label class="setting-control">預設練習題數 ' +
    select("unitCount", [[10, "約 10 題"], [20, "約 20 題"], [0, "全部題目"]]) + '</label></div></section>' + petSettings() +
    '<section class="panel"><h2>跨裝置同步</h2><p class="muted spaced">第一次開啟就會取得同步碼。每組碼有自己的作答紀錄、錯題與偏好。換裝置時輸入原本的碼即可切換，請自行保管同步碼。進行中的練習留在目前瀏覽器。</p>' +
    study.controls() + '</section><section class="panel"><h2>紀錄備份</h2><p class="muted spaced">匯出 JSON 時會一起備份同步碼。匯入時會切換到備份中的碼，並和同一組碼的紀錄合併。請自己保管備份檔。</p>' +
    '<div class="actions spaced">' + button("匯出備份", "backup-export") +
    '<label class="file-control button">匯入備份<input type="file" id="backup-file" accept=".json,application/json"></label></div>' +
    '<p id="backup-status" class="small muted spaced" role="status"></p></section>' +
    '<section class="panel"><h2>安裝到主畫面</h2><p class="muted spaced">iPhone／iPad 用 Safari 的「分享」選「加入主畫面」。Android 用 Chrome 選單的「安裝應用程式」或「加到主畫面」。</p>' +
    '<div class="spaced" id="install-control" hidden>' + button("安裝多益練習室", "install", "", "primary") + '</div></section></div>';
}
function updateSettings(message) {
  const status = document.querySelector("#sync-status");
  if (status) status.textContent = message;
}
function renderQuestion(q, chosen, checked, mockAudio) {
  const group = bank.groups[q.group];
  const assets = group?.images || [];
  const title = q.prompt || (q.part === 1 ? "選出最符合照片的敘述。" : q.part === 2 ? "聽完題目後，選出最適合的回應。" : "選出最適合填入第 " + q.number + " 題的選項。");
  const graphics = assets.map((asset, index) => '<button type="button" class="picture-button" data-action="image" data-value="' + esc(asset) +
    '" aria-label="放大' + (q.part === 7 ? "文章" : "圖片") + ' ' + (index + 1) + '"><img src="' + esc(asset) + '" alt="' +
    (q.part === 1 ? "照片描述題圖片" : q.part === 7 ? "閱讀文章，點擊可放大" : "聽力題組圖表，點擊可放大") + '"></button>').join("");
  const context = group?.passage || graphics ? '<div class="passage">' +
    (group?.passage ? '<p lang="en">' + esc(group.passage) + "</p>" : "") + graphics + "</div>" : "";
  return '<span class="badge">第 ' + q.round + ' 回 · Part ' + q.part + ' · 原題號 ' + q.number + '</span>' +
    (q.part <= 4 ? player(q, mockAudio) : "") + context + '<h2 id="question-title" tabindex="-1" class="question-title"' +
    (q.prompt ? ' lang="en"' : "") + ">" + esc(title) + '</h2><div class="options" aria-label="作答選項">' + q.choices.map(([letter, content]) => {
      const classes = ["option"];
      if (chosen === letter) classes.push("selected");
      if (checked && q.answer === letter) classes.push("correct");
      if (checked && chosen === letter && q.answer !== letter) classes.push("incorrect");
      const label = checked && !content ? q.transcriptChoices?.find(([value]) => value === letter)?.[1] : content;
      return '<button type="button" class="' + classes.join(" ") + '" data-action="answer" data-value="' + letter +
        '" aria-pressed="' + (chosen === letter) + '"' + (checked ? " disabled" : "") + '><b>' + letter +
        '</b>' + (label ? '<span lang="en">' + esc(label) + '</span>' : "") + "</button>";
    }).join("") + "</div>" +
    (checked ? '<section class="feedback" id="answer-feedback" tabindex="-1"><strong>' +
      (chosen === q.answer ? "答對了" : chosen ? "答錯了" : "未作答") + " · 正確答案 " + q.answer + '</strong><p class="explanation">' + esc(q.explanation) +
      '</p>' + (q.transcript ? '<details><summary>聽力文字稿</summary><p class="explanation" lang="en">' + esc(q.transcript) + '</p></details>' : "") + '</section>' : "") +
    '<dialog class="picture-dialog"><div class="actions"><button type="button" data-action="close-image">關閉</button></div><img alt="放大的題目素材"></dialog>';
}
function quiz() {
  const session = state.active;
  if (!session) return heading("目前沒有進行中的練習", "你可以從題庫開始一份新練習。") + '<a class="button primary" href="#units">前往單元題庫</a>';
  const q = activeQuestion();
  const answered = Object.keys(session.answers).length;
  const mock = session.mode === "mock";
  const mockAudio = mock && session.section === "L";
  const checked = !!session.checked[q.id];
  const visible = session.ids.map((id, index) => [id, index]).filter(([id]) => !mock || questions.get(id).section === session.section);
  const position = visible.findIndex(([, index]) => index === session.index);
  const navigation = visible.map(([id, index]) => {
    const item = questions.get(id);
    const status = session.checked[id] ? (session.answers[id] === item.answer ? "right" : "miss") : session.answers[id] ? "done" : "";
    const here = index === session.index;
    const label = mock ? item.number : index + 1;
    return '<button type="button" data-action="move" data-value="' + index + '" class="' + status + (here ? " current" : "") +
      (session.flags[id] ? " flagged" : "") + '" aria-label="第 ' + label + ' 題' + (session.flags[id] ? "，已標記" : "") +
      '"' + (here ? ' aria-current="step"' : "") + ">" + label + "</button>";
  }).join("");
  return '<div class="quiz-head"><div><h1>' + esc(session.title) + '</h1><p class="muted small">已作答 ' + answered + " / " + session.ids.length +
    (mock ? " · " + (mockAudio ? "聽力" : "閱讀") : "") + '</p></div><div class="actions">' +
    (mock ? '<span class="clock" id="clock" aria-label="剩餘時間">' + (session.deadline ? clockValue(session.deadline - Date.now()) : "待播放") + "</span>" : "") +
    button(mock ? "交卷" : "結束練習", "submit", "", "primary") + '</div></div><div class="progress" role="progressbar" aria-label="作答進度" aria-valuenow="' +
    answered + '" aria-valuemax="' + session.ids.length + '"><div style="width:' + (100 * answered / session.ids.length) +
    '%"></div></div><div class="quiz-layout"><article class="panel question">' + renderQuestion(q, session.answers[q.id], checked, mockAudio) +
    '<div class="quiz-foot"><div class="actions">' + button("上一題", "move", visible[position - 1]?.[1], "", position === 0) +
    button("下一題", "move", visible[position + 1]?.[1], "", position === visible.length - 1) + '</div><div class="actions">' +
    (!mock && !checked ? button("確認答案", "check", "", "primary", !session.answers[q.id]) : "") +
    '</div></div></article><aside class="panel" aria-label="題目導覽"><h2>題號導覽</h2><div class="numbers">' + navigation +
    '</div><div class="actions">' + button(session.flags[q.id] ? "取消標記" : "標記待檢查", "flag") + "</div></aside></div>";
}
function result(attempt) {
  const { correct, answered, total } = resultTotals(attempt);
  const order = [...new Set(attempt.ids.map(id => questions.get(id).part))].sort((a, b) => a - b);
  const review = attempt.ids.map((id, index) => {
    const q = questions.get(id);
    const status = attempt.answers[id] === q.answer ? "right" : attempt.answers[id] ? "miss" : "";
    return '<a class="button small ' + status + '" href="#review/' + attempt.id + "/" + index + '">' +
      (q.section === "L" ? "聽 " : "讀 ") + q.number + (status === "right" ? " ✓" : status === "miss" ? " ✗" : " ○") + "</a>";
  }).join("");
  return heading("作答結果", esc(attempt.title)) +
    '<div class="stats"><div><span class="muted small">答對題數</span><strong>' + correct + " / " + total +
    '</strong></div><div><span class="muted small">整份正確率</span><strong>' + percentage(correct, total) +
    '</strong></div><div><span class="muted small">未作答</span><strong>' + (total - answered) +
    '</strong></div></div><div class="section-head"><h2>各 Part 表現</h2></div><div class="grid two">' +
    order.map(part => {
      const totals = resultTotals(attempt, attempt.ids.filter(id => questions.get(id).part === part));
      return "<div class='row'><span>Part " + part + " · " + parts[part - 1][0] + "</span><strong>" + totals.correct + " / " + totals.total +
        " · " + percentage(totals.correct, totals.total) + "</strong></div>";
    }).join("") + '</div><div class="section-head"><h2>逐題檢討</h2><a class="link" href="#wrong">前往錯題本</a></div><div class="panel actions">' + review + "</div>";
}
function review(attempt, index) {
  const q = questions.get(attempt.ids[index]);
  if (!q) return result(attempt);
  return '<div class="quiz-head"><div><h1>逐題檢討</h1><p class="muted small">' + (index + 1) + " / " + attempt.ids.length + '</p></div><a class="button" href="#result/' +
    attempt.id + '">返回結果</a></div><article class="panel question">' + renderQuestion(q, attempt.answers[q.id], true, false) +
    '<div class="quiz-foot">' + (index > 0 ? '<a class="button" href="#review/' + attempt.id + "/" + (index - 1) + '">上一題</a>' : "<span></span>") +
    (index + 1 < attempt.ids.length ? '<a class="button" href="#review/' + attempt.id + "/" + (index + 1) + '">下一題</a>' : "") + "</div></article>";
}
let lastHash;
function render() {
  const hash = location.hash.slice(1) || "home";
  const [route, id, index] = hash.split("/");
  const changedRoute = hash !== lastHash;
  if (hash !== lastHash) {
    if ((currentRoute === "quiz" && route !== "quiz") || currentRoute === "review") stopAudio();
    if (!(currentRoute === "review" && route === "review")) window.scrollTo(0, 0);
  }
  lastHash = hash;
  currentRoute = route;
  const screens = { home, units, mocks, wrong, history, quiz, settings };
  const attempt = state.attempts.find(item => item.id === id);
  const numberScroll = app.querySelector(".numbers")?.scrollTop || 0;
  app.innerHTML = (storageWarning ? '<p class="panel" role="status">瀏覽器無法儲存紀錄，關閉頁面後可能遺失進度。</p>' : "") +
    (route === "result" && attempt ? result(attempt) : route === "review" && attempt ? review(attempt, Number(index)) :
      Object.hasOwn(screens, route) ? screens[route]() : home());
  const navigation = app.querySelector(".numbers");
  if (navigation) navigation.scrollTop = numberScroll;
  if (route === "settings") {
    study.renderStatus();
    window.dispatchEvent(new Event("toeic-settings-rendered"));
  }
  updatePet();
  if (changedRoute && route === "settings" && id === "pet") document.querySelector("#pet-settings")?.scrollIntoView();
  for (const link of document.querySelectorAll("nav a")) {
    if (link.hash === "#" + route) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  updateAudioUI();
}
function displayedQuestion() {
  if (currentRoute === "quiz") return activeQuestion();
  if (currentRoute !== "review") return null;
  const [, id, index] = location.hash.slice(1).split("/");
  return questions.get(state.attempts.find(item => item.id === id)?.ids[Number(index)]);
}
app.addEventListener("click", event => {
  const control = event.target.closest("button[data-action]");
  if (!control) return;
  const value = control.dataset.value;
  switch (control.dataset.action) {
    case "start-unit": startUnit(Number(value)); break;
    case "start-mock": startMock(Number(value)); break;
    case "retry-one": start("retry", "錯題訂正", [value]); break;
    case "retry-filter": start("retry", "錯題訂正", filteredWrong().map(([id]) => id)); break;
    case "move": move(Number(value)); break;
    case "answer": selectAnswer(value); break;
    case "check": checkAnswer(); break;
    case "submit": submit(); break;
    case "flag": {
      const q = activeQuestion();
      if (q) { state.active.flags[q.id] = !state.active.flags[q.id]; save(); render(); }
      break;
    }
    case "play": playClip(displayedQuestion()); break;
    case "pause": audio.pause(); break;
    case "replay": playClip(displayedQuestion(), true); break;
    case "mock-play": playMock(); break;
    case "pet-select": choosePet(Number(value)); break;
    case "backup-export": study.download(); break;
    case "sync-start": void study.connect(); break;
    case "sync-switch": void study.changeCode(); break;
    case "sync-now": void study.sync(); break;
    case "sync-stop": study.disconnect(); render(); break;
    case "sync-copy": void study.copyCode(); break;
    case "image": {
      const dialog = app.querySelector("dialog");
      dialog.querySelector("img").src = value;
      dialog.showModal();
      break;
    }
    case "close-image": app.querySelector("dialog").close(); break;
  }
});
app.addEventListener("change", event => {
  const name = event.target.dataset.filter;
  if (name && Object.hasOwn(filters, name)) {
    filters[name] = typeof filters[name] === "number" ? Number(event.target.value) : event.target.value;
    render();
    document.querySelector('[data-filter="' + name + '"]')?.focus();
  }
  if (name === "unitCount") { state.unitCount = filters.unitCount; preferenceChanged(); }
  if (event.target.id === "autoplay") { state.auto = event.target.checked; preferenceChanged(); }
  if (event.target.id === "pet-visible") { state.petVisible = event.target.checked; preferenceChanged(); updatePet(); }
  if (event.target.matches("[data-speed]")) setSpeed(Number(event.target.value));
  if (event.target.id === "backup-file") void study.importFile(event.target.files[0]);
});
document.addEventListener("keydown", event => {
  if (currentRoute !== "quiz" || event.altKey || event.ctrlKey || event.metaKey || app.querySelector("dialog[open]") ||
    event.target.matches("input, select, textarea, [contenteditable]")) return;
  const letter = event.key.toUpperCase();
  if (letters.includes(letter)) { event.preventDefault(); selectAnswer(letter); }
  else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    if (state.active) move(state.active.index + (event.key === "ArrowLeft" ? -1 : 1));
  }
});
window.addEventListener("hashchange", () => { if ((location.hash.slice(1) || "home") !== lastHash) render(); });
window.addEventListener("toeic-sync-connected", render);
window.addEventListener("focus", () => study.queue(250));
document.querySelector("#pet-interact").addEventListener("click", event => {
  const bubble = document.querySelector("#pet-bubble");
  const control = event.currentTarget;
  bubble.textContent = petLines[petMessage++ % petLines.length];
  bubble.hidden = false;
  control.classList.remove("pet-hop");
  requestAnimationFrame(() => control.classList.add("pet-hop"));
  clearTimeout(petTimer);
  petTimer = setTimeout(() => { bubble.hidden = true; control.classList.remove("pet-hop"); }, 2200);
});
window.addEventListener("online", () => study.queue(250));
window.addEventListener("pagehide", () => {
  if (audioTarget?.mock && state.active?.section === "L") { state.active.offset = audio.currentTime; save(); }
});
setInterval(tick, 250);
render();
tick();

