const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
function setup() {
  const context = vm.createContext({ window: {}, document: { querySelector: () => ({ addEventListener() {} }) } });
  vm.runInContext(fs.readFileSync(path.join(root, 'bank.js'), 'utf8'), context);
  context.window.createStudyProfile = (_key, initial) => ({ code: '', read: () => structuredClone(initial) });
  context.window.createStudyData = () => ({});
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8').split('app.addEventListener("click",')[0];
  vm.runInContext(source, context);
  vm.runInContext('start = (mode, title, ids) => { globalThis.selected = ids; };', context);
  return code => vm.runInContext(code, context);
}
test('empty and recent insights count answers, deduplicate coverage, and identify weakest Part', () => {
  const run = setup();
  assert.equal(run('learningInsights().recent.length'), 0);
  assert.equal(run('learningInsights().weak'), undefined);
  run(`const q = bank.questions.find(q => q.part === 5);
    state.attempts = Array.from({length: 60}, (_, i) => ({ ended: i, ids: [q.id], answers: {[q.id]: i < 10 ? q.answer : 'invalid'} }));`);
  assert.equal(run('learningInsights().seen.size'), 1);
  assert.equal(run('learningInsights().recent.length'), 50);
  assert.equal(run('learningInsights().recent.filter(Boolean).length'), 0);
  assert.equal(run('learningInsights().weak.part'), 5);
});
test('smart selection prioritizes unresolved mistakes over unseen and seen groups', () => {
  const run = setup();
  run(`const pool = bank.questions.filter(q => q.part === 5);
    const target = pool.at(-1);
    state.wrong[target.id] = {corrected: false}; filters.unitCount = 10;
    startUnit(5);`);
  assert.equal(run('selected[0] === target.id'), true);
  assert.equal(run('new Set(selected).size === selected.length'), true);
});
test('search is case insensitive, preserves complete groups, handles no results and escapes HTML', () => {
  const run = setup();
  run(`const target = bank.questions.find(q => q.part === 7 && bank.questions.filter(p => p.group === q.group).length > 1);
    target.prompt = 'UniqueNeedle'; filters.unitQuery = 'uniqueneedle'; filters.unitCount = 10; startUnit(7);`);
  assert.equal(run('selected.length === bank.questions.filter(q => q.group === target.group).length'), true);
  assert.equal(run('selected.every(id => questions.get(id).group === target.group)'), true);
  run(`filters.unitQuery = 'no-match-unique-987654321'; startUnit(7);`);
  assert.equal(run('selected.length'), 0);
  run(`filters.unitQuery = '<img src=x onerror=alert(1)>';`);
  assert.equal(run(`units().includes('&lt;img')`), true);
  assert.equal(run(`units().includes('<img src=x')`), false);
});
test('sequential order and round filter are respected', () => {
  const run = setup();
  run(`filters.unitRound = 2; filters.unitOrder = 'sequence'; filters.unitCount = 10; startUnit(5);`);
  assert.equal(run('selected.every(id => questions.get(id).round === 2)'), true);
  assert.equal(run('selected[0] === bank.questions.find(q => q.round === 2 && q.part === 5).id'), true);
});
