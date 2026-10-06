/**
 * Tests the Effort Tracker rules in Code.gs using fake Google services.
 * Run with:  node effort-tracker/dev/test-logic.js
 */
const assert = require('assert');
const { createApp } = require('./fake-google');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.log('  FAIL ' + name);
    throw e;
  }
}
function throwsMsg(fn, re) {
  assert.throws(fn, (e) => { assert.match(e.message, re); return true; });
}

const IND = ['Punctuality & Readiness', 'Use of Equipment & Time', 'Respect & Communication', 'Language of Instruction', 'Engagement & Work Ethic'];

function freshApp(opts) {
  const app = createApp(opts);
  app.ctx.doGet({ parameter: {} });
  const r = app.call('createTypedClass', ['English 9 - A', 'Ana Souza\nBruno Lima\nSilva, Carla Maria']);
  const state = app.call('getLogState', [r.classId]);
  const ids = Object.fromEntries(state.students.map((s) => [s.name, s.id]));
  return { app, classId: r.classId, ids };
}
const log = (app, classId, studentId, i, note) => app.call('logEntry', [{ classId, studentId, indicator: IND[i || 0], note }]);
const setSetting = (app, label, value) => {
  const sh = app.sheet('Settings');
  sh.getRange(sh.dump().findIndex((r) => r.Setting === label) + 2, 2).setValue(value);
};
const stageOf = (app, id) => app.call('getDashboard', []).students.find((s) => s.id === id).stage;

console.log('Setup');

test('creates the tabs, the rubric with your wording, and a weekday reminder', () => {
  const app = createApp();
  app.call('setUp', []);
  const names = app.state.ss.getSheets().map((s) => s.getName());
  assert.deepStrictEqual(names, ['Log', 'Follow-up', 'Settings', 'Rubric', 'Classes', 'Students', 'Enrollments']);
  const rubric = app.sheet('Rubric').dump();
  assert.deepStrictEqual(rubric.map((r) => r.Indicator), IND);
  assert.match(rubric[2]['Concern (CON)'], /requires reminders to maintain an appropriate tone/);
  assert.strictEqual(app.state.triggers.length, 1);
  assert.strictEqual(app.state.triggers[0].hour, 7);
  app.call('setUp', []); // running again replaces the trigger instead of adding another
  assert.strictEqual(app.state.triggers.length, 1);
});

test('names: full names on the dashboard, "Ana S." on the logging screen', () => {
  const { app, classId } = freshApp();
  assert.deepStrictEqual(app.call('getLogState', [classId]).students.map((s) => s.name), ['Ana S.', 'Bruno L.', 'Carla Maria S.']);
  const dash = app.call('getDashboard', []).students.map((s) => s.name).sort();
  assert.deepStrictEqual(dash, ['Ana Souza', 'Bruno Lima', 'Carla Maria Silva']);
});

test('only the owner (and listed teachers) can use it', () => {
  const { app } = freshApp();
  throwsMsg(() => app.call('getLogStart', [], 'student@chapelschool.com'), /do not have access/);
  app.state.user = 'student@chapelschool.com';
  assert.match(app.ctx.doGet({ parameter: {} }).getContent(), /does not have access/);
});

console.log('Reaching concern');

test('two entries: no concern yet; the third within 21 days triggers concern and an email', () => {
  const { app, classId, ids } = freshApp();
  assert.strictEqual(log(app, classId, ids['Ana S.'], 0).alert, null);
  assert.strictEqual(log(app, classId, ids['Ana S.'], 2, 'Rude to partner').alert, null);
  assert.strictEqual(app.state.mails.length, 0);
  const r = log(app, classId, ids['Ana S.'], 4);
  assert.strictEqual(r.alert, 'Reached concern');
  assert.match(r.message, /Contact home/);
  assert.strictEqual(app.state.mails.length, 1);
  assert.match(app.state.mails[0].subject, /Contact home: Ana Souza \(English 9 - A\)/);
  assert.match(app.state.mails[0].htmlBody, /Rude to partner/);
  assert.strictEqual(app.state.mails[0].to, 'teacher@chapelschool.com');
  assert.strictEqual(stageOf(app, ids['Ana S.']), 'contact');
  assert.strictEqual(app.sheet('Follow-up').dump()[0]['What happened'], 'Reached concern');
});

test('entries spread over more than 21 days do not trigger concern', () => {
  const { app, classId, ids } = freshApp();
  log(app, classId, ids['Bruno L.'], 0);
  log(app, classId, ids['Bruno L.'], 1);
  app.backdate(22);
  assert.strictEqual(log(app, classId, ids['Bruno L.'], 2).alert, null);
  assert.strictEqual(stageOf(app, ids['Bruno L.']), 'ok');
});

test('no second "contact home" email while one is waiting', () => {
  const { app, classId, ids } = freshApp();
  for (let i = 0; i < 5; i++) log(app, classId, ids['Ana S.'], i);
  assert.strictEqual(app.state.mails.length, 1);
});

test('undoing the third entry also undoes the concern', () => {
  const { app, classId, ids } = freshApp();
  log(app, classId, ids['Ana S.']);
  log(app, classId, ids['Ana S.']);
  const third = log(app, classId, ids['Ana S.']);
  app.call('undoEntry', [third.entryId, classId]);
  assert.strictEqual(stageOf(app, ids['Ana S.']), 'ok');
  assert.strictEqual(app.sheet('Follow-up').dump().length, 0);
  assert.strictEqual(app.sheet('Log').dump().length, 2);
});

test('the threshold and window come from Settings', () => {
  const { app, classId, ids } = freshApp();
  setSetting(app, 'Entries for concern', '2');
  log(app, classId, ids['Ana S.']);
  assert.strictEqual(log(app, classId, ids['Ana S.']).alert, 'Reached concern');
  setSetting(app, 'Email me when a student reaches concern', 'No');
  log(app, classId, ids['Bruno L.']);
  log(app, classId, ids['Bruno L.']);
  assert.strictEqual(app.state.mails.length, 1); // emails off for Bruno
});

console.log('After contacting home');

test('contacted home -> 3 more entries -> "still concerning" email -> teacher decides', () => {
  const { app, classId, ids } = freshApp();
  const ana = ids['Ana S.'];
  for (let i = 0; i < 3; i++) log(app, classId, ana);
  app.call('recordFollowUp', [ana, 'contacted', 'Emailed mother']);
  assert.strictEqual(stageOf(app, ana), 'monitor');
  log(app, classId, ana);
  log(app, classId, ana);
  assert.strictEqual(stageOf(app, ana), 'monitor');
  const r = log(app, classId, ana);
  assert.strictEqual(r.alert, 'Still concerning after contact');
  assert.strictEqual(app.state.mails.length, 2);
  assert.match(app.state.mails[1].subject, /Still concerning after contact: Ana Souza/);
  assert.strictEqual(stageOf(app, ana), 'decide');
  app.call('recordFollowUp', [ana, 'intervention', 'Referred to counselor']);
  assert.strictEqual(stageOf(app, ana), 'intervention');
  log(app, classId, ana); // no more emails while in intervention
  assert.strictEqual(app.state.mails.length, 2);
  const detail = app.call('getStudentDetail', [ana]);
  assert.deepStrictEqual(detail.follows.map((f) => f.action).reverse(),
    ['Reached concern', 'Contacted home', 'Still concerning after contact', 'Moved to intervention']);
  assert.strictEqual(detail.follows[0].note, 'Referred to counselor');
});

test('back on track starts the count again from zero', () => {
  const { app, classId, ids } = freshApp();
  const ana = ids['Ana S.'];
  for (let i = 0; i < 3; i++) log(app, classId, ana);
  app.call('recordFollowUp', [ana, 'contacted', '']);
  app.call('recordFollowUp', [ana, 'ok', 'Much better']);
  assert.strictEqual(stageOf(app, ana), 'ok');
  assert.strictEqual(app.call('getDashboard', []).students.find((s) => s.id === ana).recent, 0);
  log(app, classId, ana);
  log(app, classId, ana);
  assert.strictEqual(log(app, classId, ana).alert, 'Reached concern');
});

console.log('Marking periods');

test('a new "Marking period starts" date starts everyone fresh; old entries stay in the Log', () => {
  const { app, classId, ids } = freshApp();
  for (let i = 0; i < 3; i++) log(app, classId, ids['Ana S.']);
  app.backdate(10);
  const today = new Date();
  setSetting(app, 'Marking period starts', today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate());
  assert.strictEqual(stageOf(app, ids['Ana S.']), 'ok');
  assert.strictEqual(app.call('getStudentDetail', [ids['Ana S.']]).total, 0);
  assert.strictEqual(app.sheet('Log').dump().length, 3);
});

console.log('Reminders');

test('the weekday reminder lists students waiting on a call home', () => {
  const { app, classId, ids } = freshApp();
  app.call('dailyReminder', []);
  assert.strictEqual(app.state.mails.length, 0); // nobody waiting: no email
  for (let i = 0; i < 3; i++) log(app, classId, ids['Bruno L.']);
  app.call('dailyReminder', []);
  const day = new Date().getDay();
  if (day === 0 || day === 6) {
    assert.strictEqual(app.state.mails.length, 1); // no reminders at weekends
  } else {
    assert.strictEqual(app.state.mails.length, 2);
    assert.match(app.state.mails[1].subject, /1 student\(s\) waiting/);
    assert.match(app.state.mails[1].htmlBody, /Contact home[\s\S]*Bruno Lima/);
  }
  setSetting(app, 'Weekday reminder email', 'No');
  const before = app.state.mails.length;
  app.call('dailyReminder', []);
  assert.strictEqual(app.state.mails.length, before);
});

console.log('Classes');

test('imports Google Classroom classes with full names', () => {
  const courses = [{ id: '800000000001', name: 'English 9', section: 'A' }];
  const rosters = { 800000000001: [
    { userId: '1', profile: { name: { givenName: 'Lucas', familyName: 'de Souza Ferreira' } } },
    { userId: '2', profile: { name: { givenName: 'Julia', familyName: 'Almeida' } } },
    { userId: '3', profile: { name: { givenName: 'Rafael', familyName: 'Costa' } } },
  ] };
  const app = createApp({ courses, rosters });
  app.ctx.doGet({ parameter: {} });
  assert.match(app.call('importClassroomCourses', [['800000000001']]).message, /1 class\(es\) and 3 student/);
  const cls = app.call('getSetupData', [])[0];
  assert.strictEqual(cls.name, 'English 9 - A');
  assert.deepStrictEqual(app.call('getRoster', [cls.classId]).map((s) => s.first + ' ' + s.last),
    ['Julia Almeida', 'Lucas de Souza Ferreira', 'Rafael Costa']);
});

test('an unknown indicator is refused', () => {
  const { app, classId, ids } = freshApp();
  throwsMsg(() => app.call('logEntry', [{ classId, studentId: ids['Ana S.'], indicator: 'Talking' }]), /Choose an indicator/);
});

console.log('\nAll ' + passed + ' tests passed.');
