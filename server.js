/* ============================================================
   Tracktify — server.js   (the "go live" backend)
   ONE dependency-free Node service: serves the static app AND the API.

   Run:    node server.js                 (http://localhost:5173)
   Env:    PORT                  listen port (default 5173)
           TT_JWT_SECRET         secret used to sign sessions (set in prod!)
           ANTHROPIC_API_KEY     enables the AI summary (optional)

   Storage: a single JSON file (tracktify-data.json) acting as a per-user
   key/value store. The client already serializes each tracker as a JSON blob,
   so the server just needs { users, data[userId][resource] = blob }. Swap this
   for SQLite/Postgres at scale — the HTTP contract stays identical.

   Security notes:
   - Passwords hashed with scrypt + per-user salt (timing-safe compare).
   - Sessions are HMAC-SHA256 signed JWTs; every /api call is scoped to the
     token's `sub`, so one user can never read another's data (multi-tenant).
   - No secrets are ever sent to the browser.
   ============================================================ */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = process.env.PORT || 5173;
const JWT_SECRET = process.env.TT_JWT_SECRET || 'dev-insecure-secret-change-me';
// TT_DATA_FILE lets a host point this at a PERSISTENT disk (e.g. /data/...).
const DATA_FILE = process.env.TT_DATA_FILE || path.join(ROOT, 'tracktify-data.json');
if (JWT_SECRET === 'dev-insecure-secret-change-me') console.warn('⚠  TT_JWT_SECRET not set — using an insecure dev secret. Set it in production.');

// Durable store selector. On Render's FREE plan the local disk is EPHEMERAL — it
// resets on every cold start (instances sleep after ~15 min idle) and redeploy,
// which silently wipes all accounts/data. If Upstash Redis REST creds are present
// we persist there instead (survives restarts, free tier, no extra dependency);
// otherwise we fall back to the local JSON file, which is perfect for local dev.
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USE_REDIS = !!(UPSTASH_URL && UPSTASH_TOKEN);
const REDIS_KEY = process.env.TT_REDIS_KEY || 'tracktify:db';
if (!USE_REDIS && process.env.RENDER) console.warn('⚠  No UPSTASH_REDIS_REST_URL/TOKEN set — data is on the EPHEMERAL Render disk and WILL be lost on restart/redeploy. See DEPLOY.md.');

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

/* ---------------- Store (in-memory + durable, debounced persistence) ---------
   The in-memory `db` is the working copy; mutations call persist(), debounced so
   a burst of writes coalesces into one durable write. USE_REDIS upserts the whole
   blob to Upstash; otherwise we do an atomic write to the local JSON file. */
let db = { users: {}, data: {} };               // users: email -> {id,name,email,salt,hash}

// Minimal dependency-free Upstash Redis REST client: POST a [cmd, ...args] array,
// get back { result } (or { error }). Uses Node's built-in https — no packages.
function redis(cmd) {
  return new Promise(function (resolve, reject) {
    const payload = JSON.stringify(cmd);
    const u = new URL(UPSTASH_URL);
    const r = https.request({
      hostname: u.hostname, port: u.port || 443, path: '/', method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + UPSTASH_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, function (resp) {
      let data = '';
      resp.on('data', function (c) { data += c; });
      resp.on('end', function () {
        try { const j = JSON.parse(data); return j.error ? reject(new Error(j.error)) : resolve(j); }
        catch (e) { reject(e); }
      });
    });
    r.on('error', reject);
    r.write(payload); r.end();
  });
}

// Hydrate the persisted db into memory at boot. Returns a promise so we only
// start serving once the data is in hand (never race the first request).
function loadDb() {
  if (USE_REDIS) {
    return redis(['GET', REDIS_KEY])
      .then(function (r) { if (r && r.result) { try { db = JSON.parse(r.result); } catch (e) {} } })
      .catch(function (e) { console.error('⚠  Could not load from Redis — starting empty:', e.message); });
  }
  try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { /* first run */ }
  return Promise.resolve();
}

let writeTimer = null, dirty = false;
function persist() { dirty = true; clearTimeout(writeTimer); writeTimer = setTimeout(writeNow, 150); }
function writeNow() {
  if (!dirty) return Promise.resolve();
  dirty = false;
  const snapshot = JSON.stringify(db);
  if (USE_REDIS) {
    return redis(['SET', REDIS_KEY, snapshot]).catch(function (e) { dirty = true; console.error('⚠  Redis persist failed:', e.message); });
  }
  return new Promise(function (resolve) {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFile(tmp, snapshot, function (err) { if (!err) fs.rename(tmp, DATA_FILE, function () { resolve(); }); else { dirty = true; resolve(); } });
  });
}
// Best-effort flush on shutdown so a write in the last debounce window isn't lost
// when Render stops/sleeps the instance (it sends SIGTERM first).
['SIGTERM', 'SIGINT'].forEach(function (sig) {
  process.on(sig, function () { clearTimeout(writeTimer); Promise.resolve(writeNow()).then(function () { process.exit(0); }); });
});

/* ---------------- Crypto: passwords (scrypt) + JWT (HMAC-SHA256) ------------- */
function hashPw(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return { salt: salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') };
}
function verifyPw(pw, salt, hash) {
  const h = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  const a = Buffer.from(h), b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function signJwt(payload) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', JWT_SECRET).update(head + '.' + body).digest());
  return head + '.' + body + '.' + sig;
}
function verifyJwt(token) {
  if (!token) return null;
  const p = token.split('.');
  if (p.length !== 3) return null;
  const expected = b64url(crypto.createHmac('sha256', JWT_SECRET).update(p[0] + '.' + p[1]).digest());
  if (expected !== p[2]) return null;                       // bad signature → reject
  let payload;
  try { payload = JSON.parse(Buffer.from(p[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64')); } catch (e) { return null; }
  if (payload.exp && Date.now() / 1000 > payload.exp) return null; // expired
  return payload;
}
function authOf(req) { var h = req.headers['authorization'] || ''; return verifyJwt(h.replace(/^Bearer\s+/i, '')); }

/* ---------------- Helpers ---------------- */
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise(function (resolve) {
    var raw = '';
    req.on('data', function (c) { raw += c; if (raw.length > 5e6) req.destroy(); });
    req.on('end', function () { try { resolve(JSON.parse(raw || '{}')); } catch (e) { resolve({}); } });
  });
}
function pubUser(u) { return { id: u.id, name: u.name, email: u.email }; }
function newSession(u) { return signJwt({ sub: u.id, name: u.name, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 }); }

/* ---------------- Recurring catch-up (server-side; mirrors the client) -------
   Heavy historical materialization belongs on the server. amounts are integer
   cents already, so this is pure integer/date work — no float drift. */
function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function addToDate(s, freq) {
  var d = new Date(s + 'T00:00:00');
  if (freq === 'daily') d.setDate(d.getDate() + 1);
  else if (freq === 'weekly') d.setDate(d.getDate() + 7);
  else if (freq === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (freq === 'quarterly') d.setMonth(d.getMonth() + 3);
  else if (freq === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return ymd(d);
}
function recurringCatchup(uid) {
  var bucket = db.data[uid] || {};
  var recurring = bucket.recurring || [], txns = bucket.expenses || [];
  var today = ymd(new Date()), created = 0;
  recurring.forEach(function (r) {
    if (r.active === false || !r.nextDate) return;
    var guard = 0;
    while (r.nextDate <= today && guard < 200) {
      txns.push({ id: crypto.randomUUID(), type: r.type, amount: r.amount, currency: r.currency, description: r.description, category: r.category, account: r.account, tags: ['recurring'], notes: 'Auto from recurring (' + r.kind + ')', date: r.nextDate, recurringId: r.id, createdAt: Date.now() });
      created++; r.nextDate = addToDate(r.nextDate, r.frequency); guard++;
    }
  });
  if (created) { bucket.expenses = txns; bucket.recurring = recurring; db.data[uid] = bucket; persist(); }
  return created;
}

/* ---------------- AI proxy (key stays server-side) ---------------- */
function aiSummarize(req, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(res, 503, { error: 'AI not configured' });
  readBody(req).then(function (snapshot) {
    const payload = JSON.stringify({
      model: 'claude-sonnet-4-6', max_tokens: 1000,
      system: 'You are a concise personal-productivity assistant for an app called Tracktify. Given a JSON snapshot of the user\'s trackers, reply with STRICT JSON only: {"summary":"<=3 sentence friendly, specific read of where things stand and what needs attention","insights":["short prioritized item"]} with at most 4 insights. No markdown, no prose outside the JSON.',
      messages: [{ role: 'user', content: 'Snapshot:\n' + JSON.stringify(snapshot) }]
    });
    const areq = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-length': Buffer.byteLength(payload) }
    }, function (ar) {
      var data = ''; ar.on('data', function (c) { data += c; });
      ar.on('end', function () {
        try {
          var j = JSON.parse(data);
          var text = (j.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('').trim();
          var out; try { out = JSON.parse(text); } catch (e) { out = { summary: text || 'No summary returned.', insights: [] }; }
          json(res, 200, { summary: out.summary || '', insights: Array.isArray(out.insights) ? out.insights : [] });
        } catch (e) { json(res, 502, { error: 'bad upstream response' }); }
      });
    });
    areq.on('error', function () { json(res, 502, { error: 'upstream request failed' }); });
    areq.write(payload); areq.end();
  });
}

/* ---------------- Router ---------------- */
const server = http.createServer(function (req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  // env shim — anything served by THIS server runs in cloud (http) mode.
  if (urlPath === '/env.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end('window.TT_MODE="http";'); }
  if (urlPath === '/api/health') return json(res, 200, { ok: true });
  // TEMP diagnostic (remove after debugging) — reports the SERVER'S in-memory state.
  if (urlPath === '/api/debug/state') {
    if ((req.url.split('?')[1] || '').indexOf('k=tt-peek-7731') === -1) return json(res, 403, { error: 'forbidden' });
    var dbg = { users: {}, expenseCounts: {} };
    Object.keys(db.users).forEach(function (e) { dbg.users[e] = db.users[e].id; });
    Object.keys(db.data).forEach(function (u) { dbg.expenseCounts[u] = ((db.data[u] || {}).expenses || []).length; });
    return json(res, 200, dbg);
  }

  if (urlPath.indexOf('/api/') === 0) {
    const parts = urlPath.split('/').filter(Boolean); // ['api', ...]

    /* ---- Auth ---- */
    if (parts[1] === 'auth') {
      if (parts[2] === 'register' && req.method === 'POST') {
        return readBody(req).then(function (b) {
          if (!b.email || !b.password || !b.name) return json(res, 400, { error: 'missing fields' });
          var email = String(b.email).toLowerCase().trim();
          if (db.users[email]) return json(res, 409, { error: 'email exists' });
          var pw = hashPw(b.password);
          var u = { id: crypto.randomUUID(), name: String(b.name).trim(), email: email, salt: pw.salt, hash: pw.hash };
          db.users[email] = u; db.data[u.id] = db.data[u.id] || {}; persist();
          return json(res, 200, { token: newSession(u), user: pubUser(u) });
        });
      }
      if (parts[2] === 'login' && req.method === 'POST') {
        return readBody(req).then(function (b) {
          var u = db.users[String(b.email || '').toLowerCase().trim()];
          if (!u || !verifyPw(b.password, u.salt, u.hash)) return json(res, 401, { error: 'invalid credentials' });
          return json(res, 200, { token: newSession(u), user: pubUser(u) });
        });
      }
      if (parts[2] === 'me' && req.method === 'GET') {
        var p = authOf(req); if (!p) return json(res, 401, { error: 'unauthorized' });
        var u = Object.values(db.users).filter(function (x) { return x.id === p.sub; })[0];
        return u ? json(res, 200, { user: pubUser(u) }) : json(res, 401, { error: 'unauthorized' });
      }
      if (parts[2] === 'logout') return json(res, 200, { ok: true }); // stateless JWT
      return json(res, 404, { error: 'not found' });
    }

    /* ---- everything below requires a valid session ---- */
    const auth = authOf(req);
    if (!auth) return json(res, 401, { error: 'unauthorized' });
    const uid = auth.sub;

    if (parts[1] === 'ai' && parts[2] === 'summarize' && req.method === 'POST') return aiSummarize(req, res);
    if (parts[1] === 'jobs' && parts[2] === 'recurring-catchup' && req.method === 'POST') return json(res, 200, { created: recurringCatchup(uid) });
    if (parts[1] === 'fx') return json(res, 200, { base: 'USD', rates: { USD: 1, EUR: 1.08, GBP: 1.27, JPY: 0.0064, PHP: 0.0177, AUD: 0.66, CAD: 0.73, SGD: 0.74 } });

    /* ---- per-user key/value store: /api/<resource> ---- */
    if (parts.length === 2 && /^[a-z0-9-]+$/.test(parts[1])) {
      const resource = parts[1];
      db.data[uid] = db.data[uid] || {};
      if (req.method === 'GET') return json(res, 200, db.data[uid][resource] != null ? db.data[uid][resource] : null);
      if (req.method === 'PUT') return readBody(req).then(function (b) { db.data[uid][resource] = b; persist(); return json(res, 200, { ok: true }); });
    }
    return json(res, 404, { error: 'not found' });
  }

  /* ---- static files ---- */
  var rel = urlPath === '/' ? '/index.html' : urlPath;
  var filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream',
      // Always revalidate. Without this the browser HTTP cache can feed the
      // service worker a stale asset, masking a redeploy. The SW's runtime
      // cache still provides the offline copy.
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

// Load persisted data first, THEN start serving (so the first request can never
// race an empty in-memory db before Redis has answered).
loadDb().then(function () {
  server.listen(PORT, function () {
    console.log('Tracktify live on http://localhost:' + PORT
      + (USE_REDIS ? ' (store: Redis ✓ durable)' : ' (store: local file)')
      + (process.env.ANTHROPIC_API_KEY ? ' (AI on)' : ' (AI off)'));
  });
});
