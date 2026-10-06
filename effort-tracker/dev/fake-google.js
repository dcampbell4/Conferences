/**
 * Small, in-memory stand-ins for the Google Apps Script services that Code.gs uses
 * (SpreadsheetApp, HtmlService, Classroom, ...). They are only for testing on a laptop;
 * the real app runs on Google's servers and never uses this file.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'apps-script');

/* ---------------- Spreadsheet ---------------- */

class FakeRange {
  constructor(sheet, row, col, rows, cols) {
    Object.assign(this, { sheet, row, col, rows: rows || 1, cols: cols || 1 });
    // Formatting calls (setFontWeight, setBackground, ...) do nothing and return the range.
    return new Proxy(this, {
      get(target, prop, proxy) {
        if (prop in target) return target[prop];
        return () => proxy;
      },
    });
  }
  getValues() {
    this.sheet.ss.reads = (this.sheet.ss.reads || 0) + 1;
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        const v = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
        row.push(v === undefined ? '' : v);
      }
      out.push(row);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.rows || values.some((r) => r.length !== this.cols)) {
      throw new Error('The number of rows or columns in the data does not match the range.');
    }
    values.forEach((row, r) => row.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat(fmt) {
    for (let c = 0; c < this.cols; c++) this.sheet.colFormats[this.col + c] = fmt;
    return this;
  }
}

class FakeSheet {
  constructor(ss, name) {
    this.ss = ss;
    this.name = name;
    this.data = [];
    this.maxRows = 1000;
    this.colFormats = {};
  }
  getName() { return this.name; }
  getIndex() { return this.ss.sheets.indexOf(this) + 1; }
  getRange(row, col, rows, cols) {
    if (row < 1 || col < 1) throw new Error('Bad range');
    return new FakeRange(this, row, col, rows, cols);
  }
  /** Mimics how Google Sheets turns typed values into numbers and booleans. */
  set(row, col, v) {
    if (row > this.maxRows) this.maxRows = row;
    if (typeof v === 'string' && this.colFormats[col] !== '@') {
      if (/^-?\d+(\.\d+)?$/.test(v.trim())) v = Number(v);
      else if (/^(true|false)$/i.test(v.trim())) v = v.trim().toUpperCase() === 'TRUE';
    }
    while (this.data.length < row) this.data.push([]);
    this.data[row - 1][col - 1] = v;
  }
  getLastRow() {
    for (let r = this.data.length; r > 0; r--) {
      if ((this.data[r - 1] || []).some((v) => v !== '' && v !== undefined && v !== null)) return r;
    }
    return 0;
  }
  getMaxRows() { return this.maxRows; }
  deleteRow(r) {
    if (this.maxRows - 1 <= 1) throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
    this.data.splice(r - 1, 1);
    this.maxRows--;
  }
  insertRowsAfter(after, n) {
    this.maxRows += n;
    if (after < this.data.length) this.data.splice(after, 0, ...Array.from({ length: n }, () => []));
  }
  setFrozenRows() {}
  setColumnWidth() {}
  /** Test helper: rows as objects keyed by header text. */
  dump() {
    const [headers, ...rows] = this.data.slice(0, this.getLastRow());
    return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
  }
}

class FakeSpreadsheet {
  constructor() {
    this.sheets = [new FakeSheet(this, 'Sheet1')];
    this.active = this.sheets[0];
  }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  insertSheet(name) {
    const s = new FakeSheet(this, name);
    this.sheets.push(s);
    return s;
  }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  setActiveSheet(s) { this.active = s; return s; }
  moveActiveSheet(pos) {
    this.sheets = this.sheets.filter((x) => x !== this.active);
    this.sheets.splice(pos - 1, 0, this.active);
  }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/FAKE/edit'; }
}

/* ---------------- HtmlService templates ---------------- */

function compileTemplate(text) {
  let code = 'let __o = "";\n';
  const re = /<\?(!=|=)?([\s\S]*?)\?>/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    code += '__o += ' + JSON.stringify(text.slice(last, m.index)) + ';\n';
    const expr = m[2].trim().replace(/;$/, '');
    if (m[1] === '!=') code += '__o += String(' + expr + ');\n';
    else if (m[1] === '=') code += '__o += __esc(' + expr + ');\n';
    else code += m[2] + '\n';
    last = re.lastIndex;
  }
  code += '__o += ' + JSON.stringify(text.slice(last)) + ';\nreturn __o;';
  return code;
}

function htmlOutput(content) {
  const out = {
    content,
    title: '',
    getContent: () => out.content,
    setTitle: (t) => { out.title = t; return out; },
    addMetaTag: () => out,
    setFaviconUrl: (u) => { out.favicon = u; return out; },
    setWidth: () => out,
    setHeight: () => out,
  };
  return out;
}

/* ---------------- Build a sandbox with Code.gs loaded ---------------- */

function createApp(options = {}) {
  const owner = options.owner || 'teacher@chapelschool.com';
  const state = {
    ss: new FakeSpreadsheet(),
    user: owner,
    cache: new Map(),
    props: new Map(),
    triggers: [],
    alerts: [],
    mails: [],
    courses: options.courses || [],
    rosters: options.rosters || {},
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const readSrc = (name) => fs.readFileSync(path.join(SRC, name + '.html'), 'utf8');

  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => state.ss,
      getActive: () => state.ss,
      flush: () => {},
      getUi: () => ({
        alert: (msg) => state.alerts.push(msg),
        showModalDialog: () => {},
        createMenu: () => { const m = { addItem: () => m, addToUi: () => {} }; return m; },
      }),
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => state.user }),
      getEffectiveUser: () => ({ getEmail: () => owner }),
      getScriptTimeZone: () => 'America/Sao_Paulo',
    },
    ScriptApp: {
      getService: () => ({ getUrl: () => options.baseUrl || 'http://localhost:8787/exec' }),
      getProjectTriggers: () => state.triggers,
      newTrigger: (fn) => {
        const t = { getHandlerFunction: () => fn };
        const b = { timeBased: () => b, everyMinutes: () => b, everyDays: () => b,
          atHour: (h) => { t.hour = h; return b; }, create: () => state.triggers.push(t) };
        return b;
      },
      deleteTrigger: (t) => { state.triggers = state.triggers.filter((x) => x !== t); },
    },
    MailApp: { sendEmail: (msg) => state.mails.push(msg) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (state.cache.has(k) ? state.cache.get(k) : null),
        put: (k, v) => state.cache.set(k, v),
        remove: (k) => state.cache.delete(k),
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (state.props.has(k) ? state.props.get(k) : null),
        setProperty: (k, v) => state.props.set(k, v),
      }),
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, text) => Array.from(crypto.createHash(alg).update(text, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      base64Encode: (bytes) => Buffer.from(bytes.map((b) => (b + 256) % 256)).toString('base64'),
      formatDate: (d) => d.toDateString(),
    },
    HtmlService: {
      createHtmlOutput: (html) => htmlOutput(html || ''),
      createHtmlOutputFromFile: (name) => htmlOutput(readSrc(name)),
      createTemplateFromFile: (name) => {
        const tpl = {
          evaluate() {
            const vars = Object.assign({}, tpl);
            delete vars.evaluate;
            const fn = new Function('__ctx', '__esc', 'include', 'with (__ctx) {\n' + compileTemplate(readSrc(name)) + '\n}');
            return htmlOutput(fn(vars, esc, ctx.include));
          },
        };
        return tpl;
      },
    },
    Classroom: {
      Courses: {
        list: () => ({ courses: state.courses }),
        get: (id) => state.courses.find((c) => String(c.id) === String(id)),
        Students: {
          list: (courseId, opts) => {
            const all = state.rosters[courseId] || [];
            const start = Number(opts.pageToken || 0);
            const page = all.slice(start, start + 2); // tiny pages so paging gets tested
            return { students: page, nextPageToken: start + 2 < all.length ? String(start + 2) : undefined };
          },
        },
      },
    },
  };
  if (options.noClassroom) delete ctx.Classroom;

  vm.createContext(ctx);
  const code = fs.readFileSync(path.join(SRC, 'Code.gs'), 'utf8');
  vm.runInContext(code, ctx, { filename: 'Code.gs' });

  return {
    ctx,
    state,
    /** Calls a Code.gs function as a given user, copying values through JSON like google.script.run does. */
    call(fn, args = [], user) {
      state.user = user === undefined ? owner : user;
      if (typeof ctx[fn] !== 'function' || /_$/.test(fn)) throw new Error('Script function not found: ' + fn);
      const result = ctx[fn](...JSON.parse(JSON.stringify(args)));
      // A real person cannot do two things in the same millisecond; make sure tests can't either.
      const t = Date.now();
      while (Date.now() === t) { /* wait for the clock to tick */ }
      return result === undefined ? null : JSON.parse(JSON.stringify(result));
    },
    sheet(name) { return state.ss.getSheetByName(name); },
    /** Pretends time has passed: moves every date in the Log and Follow-up tabs into the past. */
    backdate(days) {
      const SandboxDate = vm.runInContext('Date', ctx);
      ['Log', 'Follow-up'].forEach((tab) => {
        const sh = state.ss.getSheetByName(tab);
        if (!sh) return;
        for (let r = 2; r <= sh.getLastRow(); r++) {
          const v = sh.data[r - 1][0];
          if (v && typeof v.getTime === 'function') sh.data[r - 1][0] = new SandboxDate(v.getTime() - days * 864e5);
        }
      });
    },
  };
}

module.exports = { createApp };
