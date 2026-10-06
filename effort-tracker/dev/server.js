/**
 * Runs the Effort Tracker on your own computer with fake Google services and made-up students,
 * so you can try the screens without touching real data.
 *
 *   node effort-tracker/dev/server.js     then open http://localhost:8787/exec
 *
 * Pages:  /exec  (logging)   /exec?page=dashboard
 */
const http = require('http');
const { createApp } = require('./fake-google');

const PORT = Number(process.env.PORT || 8787);

const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eva', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João',
  'Larissa', 'Mateus', 'Natália', 'Otávio', 'Paula', 'Rafael', 'Sofia', 'Thiago', 'Valentina', 'Yuri'];
const LAST = ['Souza', 'Lima', 'Dias', 'Rocha', 'Silva', 'Costa', 'Alves', 'Pereira', 'Gomes', 'Martins'];
const courses = [
  { id: '700000000001', name: 'Grade 9 English', section: 'A' },
  { id: '700000000002', name: 'Grade 9 English', section: 'B' },
];
const rosters = {};
courses.forEach((c, ci) => {
  rosters[c.id] = FIRST.map((f, i) => ({
    userId: String(1000 + ci * 100 + i),
    profile: { name: { givenName: f, familyName: LAST[(i + ci) % LAST.length] } },
  }));
});

const app = createApp({ courses, rosters, baseUrl: 'http://localhost:' + PORT + '/exec' });
app.ctx.doGet({ parameter: {} });

const SHIM = `<script>
  // Stand-in for google.script.run that talks to dev/server.js
  window.google = { script: { run: (function make(ok, fail) {
    return new Proxy({}, { get: function (_, fn) {
      if (fn === 'withSuccessHandler') return function (f) { return make(f, fail); };
      if (fn === 'withFailureHandler') return function (f) { return make(ok, f); };
      return function () {
        var args = Array.prototype.slice.call(arguments);
        fetch('/api/' + fn, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ args: args, as: new URLSearchParams(location.search).get('as') }) })
          .then(function (r) { return r.json(); })
          .then(function (r) { if (r.ok) { ok && ok(r.result); } else { fail && fail(new Error(r.message)); } });
      };
    } });
  })() } };
</script>`;

function body(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b ? JSON.parse(b) : {}));
  });
}

function send(res, code, type, text) {
  res.writeHead(code, { 'content-type': type });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/exec' || url.pathname === '/') {
      app.state.user = url.searchParams.get('as') || 'teacher@chapelschool.com';
      const page = app.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) });
      let html = page.getContent();
      html = html.includes('<head>') ? html.replace('<head>', '<head>' + SHIM) : SHIM + html;
      return send(res, 200, 'text/html; charset=utf-8', html);
    }
    if (url.pathname.startsWith('/api/')) {
      const { args, as } = await body(req);
      const fn = url.pathname.slice(5);
      try {
        const result = app.call(fn, args || [], as || undefined);
        return send(res, 200, 'application/json', JSON.stringify({ ok: true, result }));
      } catch (e) {
        return send(res, 200, 'application/json', JSON.stringify({ ok: false, message: e.message }));
      }
    }
    // Test helpers
    if (url.pathname === '/debug/backdate') {
      app.backdate(Number(url.searchParams.get('days') || 1));
      return send(res, 200, 'text/plain', 'ok');
    }
    if (url.pathname === '/debug/run') {
      app.call(url.searchParams.get('fn'), []);
      return send(res, 200, 'text/plain', 'ok');
    }
    if (url.pathname === '/debug/sheet') {
      return send(res, 200, 'application/json', JSON.stringify(app.sheet(url.searchParams.get('name')).dump()));
    }
    if (url.pathname === '/debug/mails') {
      return send(res, 200, 'application/json', JSON.stringify(app.state.mails));
    }
    send(res, 404, 'text/plain', 'Not found');
  } catch (e) {
    send(res, 500, 'text/plain', e.stack);
  }
});

server.listen(PORT, () => console.log('Effort Tracker running at http://localhost:' + PORT + '/exec'));
module.exports = server;
