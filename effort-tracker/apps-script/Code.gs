/**
 * Chapel Effort Tracker
 * ---------------------
 * A quick way for a teacher to log effort/behaviour concerns against a five-indicator rubric.
 * Runs as a Google Apps Script web app attached to a Google Sheet. The Sheet is the database:
 *   Log          - every entry (date, student, indicator, note)
 *   Follow-up    - what happened next: reached concern, contacted home, intervention, back on track
 *   Settings     - options you can change (how many entries make a concern, emails, ...)
 *   Rubric       - the five indicators and their wording
 *   Classes, Students, Enrollments - your class lists (from Google Classroom or typed in)
 *
 * The rule: when a student gets 3 entries within 21 days (both changeable in Settings) they reach
 * CONCERN and you get an email to contact home. After you mark "Contacted home", if 3 more entries
 * happen within 21 days you get another email suggesting intervention. Moving to intervention, or
 * back on track, is always your decision.
 *
 * Functions ending in "_" are private helpers that the web pages cannot call.
 */

const APP_NAME = 'Chapel Effort Tracker';
const DAY = 24 * 60 * 60 * 1000;

/* ======================================================================
 * Tables
 * ==================================================================== */

const TABLES = {
  log: {
    tab: 'Log',
    cols: ['date', 'className', 'student', 'indicator', 'note', 'classId', 'studentId', 'entryId'],
    headers: ['Date', 'Class', 'Student', 'Indicator', 'Note', 'Class ID', 'Student ID', 'Entry ID'],
    formats: { date: 'yyyy-mm-dd h:mm am/pm' },
  },
  follow: {
    tab: 'Follow-up',
    cols: ['date', 'student', 'className', 'action', 'note', 'studentId', 'classId', 'entryId', 'followId'],
    headers: ['Date', 'Student', 'Class', 'What happened', 'Note', 'Student ID', 'Class ID', 'Triggered by entry', 'Follow-up ID'],
    formats: { date: 'yyyy-mm-dd h:mm am/pm' },
  },
  rubric: {
    tab: 'Rubric',
    cols: ['name', 'icon', 'color', 'expected', 'concern', 'intervention'],
    headers: ['Indicator', 'Icon', 'Colour', 'Expected (EXP)', 'Concern (CON)', 'Intervention (INT)'],
  },
  classes: {
    tab: 'Classes',
    cols: ['classId', 'name', 'teacherEmail', 'source', 'courseId', 'active'],
    headers: ['Class ID', 'Class name', 'Teacher email', 'Source', 'Classroom course ID', 'Active'],
  },
  students: {
    tab: 'Students',
    cols: ['studentId', 'first', 'last'],
    headers: ['Student ID', 'First name', 'Last name'],
  },
  enrollments: {
    tab: 'Enrollments',
    cols: ['classId', 'studentId'],
    headers: ['Class ID', 'Student ID'],
  },
};

const TAB_ORDER = ['log', 'follow', 'settings', 'rubric', 'classes', 'students', 'enrollments'];

/** What can happen to a student, in order. */
const ACTIONS = {
  concern: 'Reached concern',
  contacted: 'Contacted home',
  still: 'Still concerning after contact',
  intervention: 'Moved to intervention',
  ok: 'Back on track',
};

/** Where a student is after each kind of follow-up. */
const STAGE_AFTER = {
  'Reached concern': 'contact',
  'Contacted home': 'monitor',
  'Still concerning after contact': 'decide',
  'Moved to intervention': 'intervention',
  'Back on track': 'ok',
};

const SOURCE_CLASSROOM = 'Google Classroom';
const SOURCE_TYPED = 'Typed in';

const DEFAULT_RUBRIC = [
  ['Punctuality & Readiness', '⏰', '#2563eb',
    'Arrives to class on time and is consistently ready to learn with all necessary materials.',
    'Punctuality or readiness is inconsistent; occasionally arrives late, forgets materials, or requires extra time to settle in. Sometimes responds when redirected.',
    'Rarely arrives on time and is consistently unprepared for the lesson. Does not respond when redirected.'],
  ['Use of Equipment & Time', '🛠️', '#7c3aed',
    'Uses classroom equipment and instructional time appropriately and efficiently.',
    'Use of equipment and time is variable; requires occasional redirection to stay on task or use tools correctly.',
    'Significant misuse of equipment or consistent waste of instructional time. Does not respond when redirected.'],
  ['Respect & Communication', '🤝', '#db2777',
    'Consistently respectful to staff and peers; communicates in an appropriate and professional manner.',
    'Generally respectful, but communication style is inconsistent and requires reminders to maintain an appropriate tone.',
    'Frequently shows disrespect to others or uses inappropriate methods of communication. Does not respond when redirected.'],
  ['Language of Instruction', '💬', '#0891b2',
    'Consistently speaks in the language of instruction during all class activities.',
    'Uses the language of instruction inconsistently; requires occasional redirection to avoid reverting to another language.',
    'Rarely uses the language of instruction; relies almost exclusively on a native language. Does not respond when redirected.'],
  ['Engagement & Work Ethic', '🎯', '#d97706',
    'Always engaged in learning; completes all activities and consistently meets deadlines.',
    'Engagement and productivity are inconsistent; occasionally or frequently misses deadlines and leaves activities incomplete. Sometimes responds when redirected.',
    'Disengaged from learning; rarely completes activities or fails to meet deadlines. Does not respond when redirected.'],
];

/* ======================================================================
 * Settings
 * ==================================================================== */

const SETTINGS_TAB = 'Settings';

const SETTINGS = [
  { key: 'schoolName', label: 'School name', def: 'Chapel School', note: 'Shown at the top of the screen.' },
  { key: 'threshold', label: 'Entries for concern', def: 3,
    note: 'How many entries (all indicators together) make a concern.' },
  { key: 'windowDays', label: 'Within (days)', def: 21,
    note: 'The entries must happen within this many days. 21 = three weeks.' },
  { key: 'periodStart', label: 'Marking period starts', def: '',
    note: 'Type the first day of the marking period (e.g. 2026-11-03). Only entries from that day on count. Change it each quarter to start fresh; old entries stay in the Log.' },
  { key: 'emailAlerts', label: 'Email me when a student reaches concern', def: 'Yes', note: 'Yes or No.' },
  { key: 'dailyReminder', label: 'Weekday reminder email', def: 'Yes',
    note: 'Yes or No. Each school-day morning, lists students still waiting on a call home or a decision.' },
  { key: 'reminderHour', label: 'Reminder time (hour 0-23)', def: 7,
    note: 'After changing this, run Effort Tracker > Set up this spreadsheet again.' },
  { key: 'alertEmail', label: 'Send emails to', def: '', note: 'Leave blank to use the owner of this sheet.' },
  { key: 'teachers', label: 'Other teacher emails', def: '',
    note: 'Optional. Other people allowed to open the app (separate with commas). The owner is always allowed.' },
  { key: 'iconUrl', label: 'Browser tab icon (link)', def: '',
    note: 'Optional. A link to a square picture used as the icon in browser tabs and bookmarks.' },
];

function getSettings_() {
  const sh = settingsTab_();
  const values = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).getValues();
  const byLabel = {};
  values.forEach(function (r) { byLabel[String(r[0]).trim()] = r[1]; });
  const s = {};
  SETTINGS.forEach(function (d) {
    const v = byLabel[d.label];
    s[d.key] = (v === '' || v === undefined || v === null) ? d.def : v;
  });
  s.schoolName = String(s.schoolName);
  s.threshold = posInt_(s.threshold, 3);
  s.windowDays = posInt_(s.windowDays, 21);
  s.periodStart = s.periodStart === '' ? 0 : startOfDayMs_(s.periodStart);
  s.emailAlerts = isYes_(s.emailAlerts);
  s.dailyReminder = isYes_(s.dailyReminder);
  s.reminderHour = Math.min(23, Math.max(0, parseInt(s.reminderHour, 10) || 7));
  s.alertEmail = String(s.alertEmail).trim() || Session.getEffectiveUser().getEmail();
  s.teachers = list_(s.teachers).map(lower_);
  s.iconUrl = /^https:\/\//.test(String(s.iconUrl).trim()) ? String(s.iconUrl).trim() : '';
  return s;
}

function publicSettings_(s) {
  return { schoolName: s.schoolName, threshold: s.threshold, windowDays: s.windowDays, periodStart: s.periodStart };
}

/* ======================================================================
 * Web app entry point
 * ==================================================================== */

function doGet(e) {
  ensureSetup_();
  const user = currentUser_();
  const page = (e && e.parameter && e.parameter.page) || 'log';
  const file = page === 'dashboard' ? 'Dashboard' : 'Log';

  if (!user.isTeacher) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:40px;max-width:520px"><h2>' + APP_NAME + '</h2>' +
      '<p>Sorry, ' + escapeHtml_(user.email || 'this account') + ' does not have access to this page.</p></div>'
    ).setTitle(APP_NAME);
  }

  const t = HtmlService.createTemplateFromFile(file);
  t.baseUrl = ScriptApp.getService().getUrl();
  const output = t.evaluate()
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
  const icon = getSettings_().iconUrl;
  if (icon) {
    try {
      output.setFaviconUrl(icon);
    } catch (err) {
      // A bad link in Settings should never stop the app from opening.
    }
  }
  return output;
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* ======================================================================
 * Spreadsheet menu and setup
 * ==================================================================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Effort Tracker')
    .addItem('Set up this spreadsheet', 'setUp')
    .addItem('Get the app link', 'showAppLink')
    .addToUi();
}

/** Run from the "Effort Tracker" menu. Safe to run again (e.g. after changing the reminder time). */
function setUp() {
  const user = currentUser_();
  if (!user.isOwner) throw userError_('Only the owner of the spreadsheet can run setup.');
  ensureSetup_();
  const s = getSettings_();

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyReminder') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyReminder').timeBased().everyDays(1).atHour(s.reminderHour).create();

  SpreadsheetApp.getUi().alert(
    'The Effort Tracker is set up!\n\n' +
    'Emails will go to ' + s.alertEmail + '.\n\n' +
    'Next: in the Apps Script editor click Deploy > New deployment to get your app link. ' +
    'See the setup guide for details.'
  );
}

function showAppLink() {
  const url = ScriptApp.getService().getUrl();
  const html = url
    ? '<p style="font-family:sans-serif">Log entries: <a target="_blank" href="' + url + '">' + url + '</a></p>' +
      '<p style="font-family:sans-serif">Dashboard: <a target="_blank" href="' + url + '?page=dashboard">' + url + '?page=dashboard</a></p>'
    : '<p style="font-family:sans-serif">The app has not been deployed yet. In the Apps Script editor click <b>Deploy &gt; New deployment</b>.</p>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(560).setHeight(160), 'Effort Tracker links');
}

function ensureSetup_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  addMissingSettings_(settingsTab_());
  TAB_ORDER.forEach(function (key) { if (key !== 'settings') tab_(TABLES[key]); });
  const rubric = tab_(TABLES.rubric);
  if (rubric.getLastRow() < 2) {
    rubric.getRange(2, 1, DEFAULT_RUBRIC.length, 6).setValues(DEFAULT_RUBRIC);
    rubric.setColumnWidth(1, 200);
    [4, 5, 6].forEach(function (c) { rubric.setColumnWidth(c, 360); });
  }
  TAB_ORDER.forEach(function (key, i) {
    const sh = ss.getSheetByName(key === 'settings' ? SETTINGS_TAB : TABLES[key].tab);
    if (sh && sh.getIndex() !== i + 1) {
      ss.setActiveSheet(sh);
      ss.moveActiveSheet(i + 1);
    }
  });
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
}

function settingsTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SETTINGS_TAB);
  if (sh) return sh;
  sh = ss.insertSheet(SETTINGS_TAB);
  sh.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'What it means']]);
  styleHeader_(sh, 3);
  sh.setColumnWidth(1, 300);
  sh.setColumnWidth(2, 260);
  sh.setColumnWidth(3, 560);
  return sh;
}

/** Adds rows for any settings the tab does not have yet. */
function addMissingSettings_(sh) {
  const labels = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues()
    .map(function (r) { return String(r[0]).trim(); });
  const missing = SETTINGS.filter(function (d) { return labels.indexOf(d.label) < 0; })
    .map(function (d) { return [d.label, d.def, d.note]; });
  if (!missing.length) return;
  sh.getRange(sh.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
}

function tab_(table) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(table.tab);
  if (sh) return sh;
  sh = ss.insertSheet(table.tab);
  sh.getRange(1, 1, 1, table.headers.length).setValues([table.headers]);
  styleHeader_(sh, table.headers.length);
  const body = Math.max(sh.getMaxRows() - 1, 1);
  table.cols.forEach(function (c, i) {
    const fmt = (table.formats && table.formats[c]) || (/Id$/.test(c) ? '@' : null);
    if (fmt) sh.getRange(2, i + 1, body, 1).setNumberFormat(fmt);
  });
  return sh;
}

function styleHeader_(sh, width) {
  sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#2b2e83').setFontColor('#ffffff');
  sh.setFrozenRows(1);
}

/* ======================================================================
 * Reading and writing rows
 * ==================================================================== */

function readRows_(table) {
  const sh = tab_(table);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, table.cols.length).getValues();
  const rows = [];
  values.forEach(function (v, i) {
    if (v[0] === '' || v[0] === null) return;
    const o = { _row: i + 2 };
    table.cols.forEach(function (c, j) { o[c] = /Id$/.test(c) ? String(v[j]).trim() : v[j]; });
    rows.push(o);
  });
  return rows;
}

function appendRows_(table, objs) {
  if (!objs.length) return;
  const sh = tab_(table);
  const values = objs.map(function (o) { return rowValues_(table, o); });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, table.cols.length).setValues(values);
}

function updateRow_(table, obj) {
  tab_(table).getRange(obj._row, 1, 1, table.cols.length).setValues([rowValues_(table, obj)]);
}

function deleteRows_(table, objs) {
  if (!objs.length) return;
  const sh = tab_(table);
  if (sh.getMaxRows() - 1 <= objs.length) sh.insertRowsAfter(sh.getMaxRows(), objs.length);
  objs.map(function (o) { return o._row; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (r) { sh.deleteRow(r); });
}

function rowValues_(table, o) {
  return table.cols.map(function (c) { return (o[c] === undefined || o[c] === null) ? '' : o[c]; });
}

/* ======================================================================
 * Who is using the app?
 * ==================================================================== */

function currentUser_() {
  const email = lower_(Session.getActiveUser().getEmail());
  const owner = lower_(Session.getEffectiveUser().getEmail());
  const s = getSettings_();
  const isOwner = !!email && email === owner;
  return { email: email, isOwner: isOwner, isTeacher: isOwner || (!!email && s.teachers.indexOf(email) >= 0) };
}

function requireTeacher_() {
  const user = currentUser_();
  if (!user.isTeacher) throw userError_('You do not have access to the Effort Tracker.');
  return user;
}

function visibleClasses_(user) {
  return readRows_(TABLES.classes).filter(function (c) {
    return user.isOwner || lower_(c.teacherEmail) === user.email;
  });
}

function getClassFor_(user, classId) {
  const cls = visibleClasses_(user).filter(function (c) { return c.classId === String(classId); })[0];
  if (!cls) throw userError_('That class could not be found.');
  return cls;
}

/* ======================================================================
 * Where each student stands
 * ==================================================================== */

/**
 * Works out every student's stage from the Log and Follow-up tabs.
 *   ok           - nothing to do
 *   contact      - reached concern: contact home
 *   monitor      - home contacted, watching whether things change
 *   decide       - still concerning after contact: intervention or back on track?
 *   intervention - in intervention
 * Returns { studentId: { stage, since, recent, sinceContact, total, byIndicator, entries, follows } }
 */
function computeStatus_(s, logs, follows, now) {
  const status = {};
  const get = function (id) {
    return status[id] || (status[id] = {
      stage: 'ok', since: 0, cycleStart: s.periodStart, recent: 0, total: 0,
      byIndicator: {}, entries: [], follows: [],
    });
  };

  follows.forEach(function (f) {
    const t = toMs_(f.date);
    if (t < s.periodStart) return;
    get(f.studentId).follows.push(f);
  });
  logs.forEach(function (l) {
    const t = toMs_(l.date);
    if (t < s.periodStart) return;
    get(l.studentId).entries.push(l);
  });

  Object.keys(status).forEach(function (id) {
    const st = status[id];
    st.follows.sort(function (a, b) { return toMs_(a.date) - toMs_(b.date); });
    st.entries.sort(function (a, b) { return toMs_(a.date) - toMs_(b.date); });
    const last = st.follows[st.follows.length - 1];
    if (last) {
      st.stage = STAGE_AFTER[last.action] || 'ok';
      st.since = toMs_(last.date);
    }
    // Entries count again after the last "Back on track" or "Contacted home".
    const reset = st.follows.filter(function (f) {
      return f.action === ACTIONS.ok || f.action === ACTIONS.contacted;
    }).pop();
    st.cycleStart = Math.max(s.periodStart, reset ? toMs_(reset.date) : 0);
    const windowStart = now - s.windowDays * DAY;
    st.recent = st.entries.filter(function (l) {
      const t = toMs_(l.date);
      return t >= st.cycleStart && t >= windowStart;
    }).length;
    st.total = st.entries.length;
    st.entries.forEach(function (l) { st.byIndicator[l.indicator] = (st.byIndicator[l.indicator] || 0) + 1; });
  });
  return status;
}

/** After a new entry: does this student now need a call home, or a decision? */
function checkThreshold_(s, student, cls, entry) {
  const status = computeStatus_(s, readRows_(TABLES.log), readRows_(TABLES.follow), Date.now())[student.studentId];
  if (!status || status.recent < s.threshold) return null;

  let action = null;
  if (status.stage === 'ok') action = ACTIONS.concern;
  if (status.stage === 'monitor') action = ACTIONS.still;
  if (!action) return null;

  appendRows_(TABLES.follow, [{
    date: new Date(), student: fullName_(student), className: cls.name, action: action,
    note: status.recent + ' entries in ' + s.windowDays + ' days', studentId: student.studentId,
    classId: cls.classId, entryId: entry.entryId, followId: shortId_(),
  }]);
  if (s.emailAlerts) sendAlert_(s, action, student, cls, status);
  return action;
}

/* ======================================================================
 * Logging - called by Log.html
 * ==================================================================== */

function getLogStart() {
  const user = requireTeacher_();
  const s = getSettings_();
  return {
    schoolName: s.schoolName,
    classes: visibleClasses_(user).filter(function (c) { return isTrue_(c.active); })
      .map(function (c) { return { classId: c.classId, name: c.name }; }),
  };
}

function getLogState(classId) {
  const user = requireTeacher_();
  return buildLogState_(getClassFor_(user, classId), getSettings_());
}

/** req = { classId, studentId, indicator, note } */
function logEntry(req) {
  const user = requireTeacher_();
  return withLock_(function () {
    const s = getSettings_();
    const cls = getClassFor_(user, req.classId);
    const student = getStudent_(req.studentId);
    if (!isEnrolled_(cls.classId, student.studentId)) throw userError_('That student is not in this class.');
    const rubric = getRubric_();
    if (!rubric.some(function (r) { return r.name === req.indicator; })) throw userError_('Choose an indicator.');

    const entry = {
      date: new Date(), className: cls.name, student: fullName_(student), indicator: req.indicator,
      note: String(req.note || '').trim(), classId: cls.classId, studentId: student.studentId, entryId: shortId_(),
    };
    appendRows_(TABLES.log, [entry]);
    const alert = checkThreshold_(s, student, cls, entry);

    let message = req.indicator + ' logged for ' + shortName_(student) + '.';
    if (alert === ACTIONS.concern) message = shortName_(student) + ' has reached concern. Contact home.';
    if (alert === ACTIONS.still) message = shortName_(student) + ' is still concerning after contact. Decide on next steps.';
    return { entryId: entry.entryId, alert: alert, message: message, state: buildLogState_(cls, s) };
  });
}

/** Removes an entry (and any concern it caused). */
function undoEntry(entryId, classId) {
  const user = requireTeacher_();
  return withLock_(function () {
    const s = getSettings_();
    const rows = readRows_(TABLES.log).filter(function (l) { return l.entryId === String(entryId); });
    if (!rows.length) throw userError_('That entry was already removed.');
    deleteRows_(TABLES.log, rows);
    deleteRows_(TABLES.follow, readRows_(TABLES.follow).filter(function (f) { return f.entryId === String(entryId); }));
    const result = { message: 'Entry removed.' };
    if (classId) result.state = buildLogState_(getClassFor_(user, classId), s);
    return result;
  });
}

function buildLogState_(cls, s) {
  const status = computeStatus_(s, readRows_(TABLES.log), readRows_(TABLES.follow), Date.now());
  const studentsById = indexBy_(readRows_(TABLES.students), 'studentId');
  const students = classStudentIds_(cls.classId)
    .map(function (id) { return studentsById[id]; })
    .filter(Boolean)
    .map(function (st) {
      const x = status[st.studentId];
      return { id: st.studentId, name: shortName_(st), stage: x ? x.stage : 'ok', recent: x ? x.recent : 0 };
    })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
  return {
    classId: cls.classId, className: cls.name, settings: publicSettings_(s),
    rubric: getRubric_().map(function (r) { return { name: r.name, icon: r.icon, color: r.color }; }),
    students: students,
  };
}

/* ======================================================================
 * Dashboard - called by Dashboard.html
 * ==================================================================== */

function getDashboard() {
  const user = requireTeacher_();
  const s = getSettings_();
  const classes = visibleClasses_(user);
  const classIds = {};
  classes.forEach(function (c) { classIds[c.classId] = c; });
  const classesOf = {};
  readRows_(TABLES.enrollments).forEach(function (e) {
    if (classIds[e.classId]) (classesOf[e.studentId] = classesOf[e.studentId] || []).push(classIds[e.classId].name);
  });

  const status = computeStatus_(s, readRows_(TABLES.log), readRows_(TABLES.follow), Date.now());
  const students = readRows_(TABLES.students)
    .filter(function (st) { return classesOf[st.studentId] || status[st.studentId]; })
    .map(function (st) {
      const x = status[st.studentId] || { stage: 'ok', since: 0, recent: 0, total: 0, byIndicator: {}, entries: [] };
      const lastEntry = x.entries[x.entries.length - 1];
      return {
        id: st.studentId, name: fullName_(st), classes: (classesOf[st.studentId] || []).join(', '),
        stage: x.stage, since: x.since, recent: x.recent, total: x.total, byIndicator: x.byIndicator,
        lastEntry: lastEntry ? toMs_(lastEntry.date) : 0,
      };
    })
    .sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name); });

  return {
    settings: publicSettings_(s),
    rubric: getRubric_().map(function (r) { return { name: r.name, icon: r.icon, color: r.color }; }),
    students: students,
    classes: classes.map(function (c) { return c.name; }),
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
  };
}

function getStudentDetail(studentId) {
  requireTeacher_();
  const s = getSettings_();
  const st = getStudent_(studentId);
  const x = computeStatus_(s, readRows_(TABLES.log), readRows_(TABLES.follow), Date.now())[st.studentId] ||
    { stage: 'ok', since: 0, recent: 0, total: 0, byIndicator: {}, entries: [], follows: [] };
  const rubric = getRubric_().map(function (r) {
    const n = x.byIndicator[r.name] || 0;
    return { name: r.name, icon: r.icon, color: r.color, count: n, wording: n ? r.concern : r.expected,
      intervention: r.intervention, concern: r.concern, expected: r.expected };
  });
  return {
    id: st.studentId, name: fullName_(st), stage: x.stage, since: x.since, recent: x.recent, total: x.total,
    settings: publicSettings_(s), rubric: rubric,
    entries: x.entries.map(function (l) {
      return { entryId: l.entryId, date: toMs_(l.date), className: String(l.className), indicator: String(l.indicator), note: String(l.note) };
    }).reverse(),
    follows: x.follows.map(function (f) {
      return { date: toMs_(f.date), action: String(f.action), note: String(f.note) };
    }).reverse(),
  };
}

/** Teacher records what happened: 'contacted', 'intervention' or 'ok'. */
function recordFollowUp(studentId, action, note) {
  const user = requireTeacher_();
  if (['contacted', 'intervention', 'ok'].indexOf(action) < 0) throw userError_('Unknown follow-up.');
  return withLock_(function () {
    const st = getStudent_(studentId);
    const classIds = classIdsOfStudent_(st.studentId);
    const cls = visibleClasses_(user).filter(function (c) { return classIds.indexOf(c.classId) >= 0; })[0] || {};
    appendRows_(TABLES.follow, [{
      date: new Date(), student: fullName_(st), className: cls.name || '', action: ACTIONS[action],
      note: String(note || '').trim(), studentId: st.studentId, classId: cls.classId || '', entryId: '', followId: shortId_(),
    }]);
    return { message: ACTIONS[action] + ': ' + fullName_(st) + '.' };
  });
}

function deleteEntry(entryId) {
  return undoEntry(entryId, null);
}

/* ======================================================================
 * Emails
 * ==================================================================== */

function sendAlert_(s, action, student, cls, status) {
  const name = fullName_(student);
  const url = ScriptApp.getService().getUrl();
  const recent = status.entries.filter(function (l) {
    return toMs_(l.date) >= status.cycleStart && toMs_(l.date) >= Date.now() - s.windowDays * DAY;
  });
  const list = recent.map(function (l) {
    return '<li>' + formatDay_(l.date) + ' - <b>' + escapeHtml_(l.indicator) + '</b>' +
      (l.note ? ': ' + escapeHtml_(l.note) : '') + ' (' + escapeHtml_(l.className) + ')</li>';
  }).join('');
  const subject = action === ACTIONS.concern
    ? 'Contact home: ' + name + ' (' + cls.name + ')'
    : 'Still concerning after contact: ' + name + ' (' + cls.name + ')';
  const intro = action === ACTIONS.concern
    ? name + ' has reached <b>concern</b>: ' + recent.length + ' entries in the last ' + s.windowDays + ' days. Time to contact home.'
    : name + ' has had ' + recent.length + ' more entries since you contacted home. Decide whether to move to <b>intervention</b>.';
  const html = '<p>' + intro + '</p><ul>' + list + '</ul>' +
    (url ? '<p><a href="' + url + '?page=dashboard">Open the dashboard</a> to record what you did.</p>' : '');
  try {
    MailApp.sendEmail({ to: s.alertEmail, subject: subject, htmlBody: html, body: html.replace(/<[^>]+>/g, '') });
  } catch (err) {
    // Out of daily email quota, etc. The dashboard still shows the alert.
  }
}

/** Runs every morning (installed by setUp). Lists students still waiting on you. */
function dailyReminder() {
  const s = getSettings_();
  if (!s.dailyReminder) return;
  const day = new Date().getDay();
  if (day === 0 || day === 6) return;

  const studentsById = indexBy_(readRows_(TABLES.students), 'studentId');
  const status = computeStatus_(s, readRows_(TABLES.log), readRows_(TABLES.follow), Date.now());
  const waiting = Object.keys(status).filter(function (id) {
    return (status[id].stage === 'contact' || status[id].stage === 'decide') && studentsById[id];
  });
  if (!waiting.length) return;

  const line = function (id) {
    const days = Math.floor((Date.now() - status[id].since) / DAY);
    return '<li><b>' + escapeHtml_(fullName_(studentsById[id])) + '</b> - waiting ' +
      (days === 0 ? 'since today' : days + (days === 1 ? ' day' : ' days')) + '</li>';
  };
  const contact = waiting.filter(function (id) { return status[id].stage === 'contact'; });
  const decide = waiting.filter(function (id) { return status[id].stage === 'decide'; });
  const url = ScriptApp.getService().getUrl();
  let html = '';
  if (contact.length) html += '<p><b>Contact home</b></p><ul>' + contact.map(line).join('') + '</ul>';
  if (decide.length) html += '<p><b>Still concerning after contact: intervention or back on track?</b></p><ul>' +
    decide.map(line).join('') + '</ul>';
  if (url) html += '<p><a href="' + url + '?page=dashboard">Open the dashboard</a></p>';
  try {
    MailApp.sendEmail({
      to: s.alertEmail, subject: 'Effort Tracker: ' + waiting.length + ' student(s) waiting on you',
      htmlBody: html, body: html.replace(/<[^>]+>/g, ''),
    });
  } catch (err) {
    // Ignore quota problems; try again tomorrow.
  }
}

/* ======================================================================
 * Rubric, students, classes
 * ==================================================================== */

function getRubric_() {
  return readRows_(TABLES.rubric).map(function (r) {
    return {
      name: String(r.name).trim(), icon: String(r.icon || ''), color: String(r.color || '#2b2e83'),
      expected: String(r.expected), concern: String(r.concern), intervention: String(r.intervention),
    };
  });
}

function getStudent_(studentId) {
  const st = readRows_(TABLES.students).filter(function (r) { return r.studentId === String(studentId); })[0];
  if (!st) throw userError_('That student could not be found.');
  return st;
}

function classStudentIds_(classId) {
  return readRows_(TABLES.enrollments)
    .filter(function (e) { return e.classId === classId; })
    .map(function (e) { return e.studentId; });
}

function classIdsOfStudent_(studentId) {
  return readRows_(TABLES.enrollments)
    .filter(function (e) { return e.studentId === studentId; })
    .map(function (e) { return e.classId; });
}

function isEnrolled_(classId, studentId) {
  return classStudentIds_(classId).indexOf(studentId) >= 0;
}

function fullName_(st) {
  return (String(st.first).trim() + ' ' + String(st.last || '').trim()).trim();
}

/** "Ana S." - used on the logging screen. */
function shortName_(st) {
  const initial = String(st.last || '').trim().charAt(0).toUpperCase();
  return String(st.first).trim() + (initial ? ' ' + initial + '.' : '');
}

function getSetupData() {
  const user = requireTeacher_();
  const counts = {};
  readRows_(TABLES.enrollments).forEach(function (e) { counts[e.classId] = (counts[e.classId] || 0) + 1; });
  return visibleClasses_(user).map(function (c) {
    return { classId: c.classId, name: c.name, source: c.source, active: isTrue_(c.active), count: counts[c.classId] || 0 };
  });
}

function getRoster(classId) {
  const user = requireTeacher_();
  const cls = getClassFor_(user, classId);
  const byId = indexBy_(readRows_(TABLES.students), 'studentId');
  return classStudentIds_(cls.classId)
    .map(function (id) { return byId[id]; })
    .filter(Boolean)
    .map(function (st) { return { id: st.studentId, first: String(st.first), last: String(st.last) }; })
    .sort(function (a, b) { return a.first.localeCompare(b.first); });
}

function listClassroomCourses() {
  requireTeacher_();
  requireClassroom_();
  const imported = {};
  readRows_(TABLES.classes).forEach(function (c) { if (c.courseId) imported[c.courseId] = true; });
  const courses = [];
  let token;
  do {
    const r = Classroom.Courses.list({ teacherId: 'me', courseStates: ['ACTIVE'], pageSize: 100, pageToken: token });
    (r.courses || []).forEach(function (c) {
      courses.push({ id: String(c.id), name: courseLabel_(c), imported: !!imported[String(c.id)] });
    });
    token = r.nextPageToken;
  } while (token);
  return courses;
}

function importClassroomCourses(courseIds) {
  const user = requireTeacher_();
  requireClassroom_();
  return withLock_(function () {
    let classes = 0;
    let added = 0;
    (courseIds || []).forEach(function (id) {
      id = String(id);
      let cls = readRows_(TABLES.classes).filter(function (c) { return c.courseId === id; })[0];
      if (!cls) {
        const course = Classroom.Courses.get(id);
        cls = { classId: 'c-' + shortId_(), name: courseLabel_(course), teacherEmail: user.email,
          source: SOURCE_CLASSROOM, courseId: id, active: true };
        appendRows_(TABLES.classes, [cls]);
        classes++;
      }
      added += syncFromClassroom_(cls).newStudents;
    });
    return { message: 'Imported ' + classes + ' class(es) and ' + added + ' student(s).' };
  });
}

function syncClass(classId) {
  const user = requireTeacher_();
  requireClassroom_();
  return withLock_(function () {
    const cls = getClassFor_(user, classId);
    if (cls.source !== SOURCE_CLASSROOM) throw userError_('This class was typed in, so there is nothing to sync.');
    const r = syncFromClassroom_(cls);
    return { message: r.added + ' student(s) added and ' + r.removed + ' removed.' };
  });
}

function syncFromClassroom_(cls) {
  const roster = [];
  let token;
  do {
    const r = Classroom.Courses.Students.list(cls.courseId, { pageSize: 100, pageToken: token });
    (r.students || []).forEach(function (st) { roster.push(st); });
    token = r.nextPageToken;
  } while (token);

  const known = indexBy_(readRows_(TABLES.students), 'studentId');
  const newStudents = [];
  const ids = roster.map(function (st) {
    const id = 'g-' + st.userId;
    if (!known[id]) {
      const n = (st.profile && st.profile.name) || {};
      const parts = String(n.fullName || 'Student').split(' ');
      newStudents.push({ studentId: id, first: n.givenName || parts[0], last: n.familyName || parts.slice(1).join(' ') });
      known[id] = true;
    }
    return id;
  });
  appendRows_(TABLES.students, newStudents);
  const r = setEnrollment_(cls.classId, ids);
  r.newStudents = newStudents.length;
  return r;
}

function setEnrollment_(classId, studentIds) {
  const current = readRows_(TABLES.enrollments).filter(function (e) { return e.classId === classId; });
  const currentIds = current.map(function (e) { return e.studentId; });
  const toAdd = studentIds.filter(function (id, i) { return currentIds.indexOf(id) < 0 && studentIds.indexOf(id) === i; });
  const toRemove = current.filter(function (e) { return studentIds.indexOf(e.studentId) < 0; });
  appendRows_(TABLES.enrollments, toAdd.map(function (id) { return { classId: classId, studentId: id }; }));
  deleteRows_(TABLES.enrollments, toRemove);
  return { added: toAdd.length, removed: toRemove.length };
}

function createTypedClass(name, namesText) {
  const user = requireTeacher_();
  name = String(name || '').trim();
  if (!name) throw userError_('Give the class a name.');
  return withLock_(function () {
    const cls = { classId: 'c-' + shortId_(), name: name, teacherEmail: user.email, source: SOURCE_TYPED, courseId: '', active: true };
    appendRows_(TABLES.classes, [cls]);
    const n = addTypedStudents_(cls.classId, namesText);
    return { classId: cls.classId, message: name + ' was created with ' + n + ' student(s).' };
  });
}

function addStudents(classId, namesText) {
  const user = requireTeacher_();
  return withLock_(function () {
    const cls = getClassFor_(user, classId);
    return { message: addTypedStudents_(cls.classId, namesText) + ' student(s) added.' };
  });
}

function addTypedStudents_(classId, namesText) {
  const students = parseNames_(namesText).map(function (p) {
    return { studentId: 'm-' + shortId_(), first: p.first, last: p.last };
  });
  appendRows_(TABLES.students, students);
  appendRows_(TABLES.enrollments, students.map(function (st) { return { classId: classId, studentId: st.studentId }; }));
  return students.length;
}

/** One name per line: "Ana Souza" or "Souza, Ana". */
function parseNames_(text) {
  return String(text || '').split(/\r?\n/)
    .map(function (line) { return line.trim(); })
    .filter(Boolean)
    .map(function (line) {
      if (line.indexOf(',') >= 0) {
        return { first: line.split(',').slice(1).join(',').trim(), last: line.split(',')[0].trim() };
      }
      const parts = line.split(/\s+/);
      return { first: parts[0], last: parts.slice(1).join(' ') };
    });
}

function updateStudent(studentId, fields) {
  requireTeacher_();
  return withLock_(function () {
    const st = getStudent_(studentId);
    if (fields.first !== undefined) {
      if (!String(fields.first).trim()) throw userError_('First name cannot be empty.');
      st.first = String(fields.first).trim();
    }
    if (fields.last !== undefined) st.last = String(fields.last).trim();
    updateRow_(TABLES.students, st);
    return { message: 'Saved.' };
  });
}

function removeFromClass(classId, studentId) {
  const user = requireTeacher_();
  return withLock_(function () {
    const cls = getClassFor_(user, classId);
    deleteRows_(TABLES.enrollments, readRows_(TABLES.enrollments).filter(function (e) {
      return e.classId === cls.classId && e.studentId === String(studentId);
    }));
    return { message: 'Removed from ' + cls.name + '. Their past entries stay in the Log.' };
  });
}

function updateClass(classId, fields) {
  const user = requireTeacher_();
  return withLock_(function () {
    const cls = getClassFor_(user, classId);
    if (fields.name !== undefined) {
      if (!String(fields.name).trim()) throw userError_('Class name cannot be empty.');
      cls.name = String(fields.name).trim();
    }
    if (fields.active !== undefined) cls.active = !!fields.active;
    updateRow_(TABLES.classes, cls);
    return { message: 'Saved.' };
  });
}

function requireClassroom_() {
  if (typeof Classroom === 'undefined') {
    throw userError_('Google Classroom is not connected yet. See step 4 of the setup guide.');
  }
}

function courseLabel_(c) {
  return c.section ? c.name + ' - ' + c.section : c.name;
}

/* ======================================================================
 * Small helpers
 * ==================================================================== */

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw userError_('The tracker is busy. Please try again.');
  try {
    const result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function userError_(message) {
  return new Error(message);
}

function indexBy_(rows, key) {
  const o = {};
  rows.forEach(function (r) { o[r[key]] = r; });
  return o;
}

function list_(v) {
  return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
}

function lower_(v) {
  return String(v || '').trim().toLowerCase();
}

function posInt_(v, fallback) {
  const n = parseInt(v, 10);
  return n > 0 ? n : fallback;
}

function isTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function isYes_(v) {
  return v === true || /^(yes|y|true|on)$/i.test(String(v).trim());
}

function toMs_(v) {
  return (v instanceof Date ? v : new Date(v)).getTime();
}

/** A date typed into Settings ("2026-11-03" or a real date cell) -> midnight that day, in ms. */
function startOfDayMs_(v) {
  if (v instanceof Date) {
    const d = new Date(v.getTime());
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const m = String(v).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

function formatDay_(v) {
  return Utilities.formatDate(v instanceof Date ? v : new Date(v), Session.getScriptTimeZone(), 'EEE d MMM');
}

function shortId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
