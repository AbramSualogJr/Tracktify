/* ============================================================
   Tracktify — preview-server.js
   Tiny dependency-free static server + an OPTIONAL AI proxy.

   Run:   node preview-server.js          (serves this folder on :5173)
   AI on: set ANTHROPIC_API_KEY in the env, then restart. The key stays on the
          server — it is NEVER sent to the browser. Without it, /api/ai/summarize
          returns 503 and the dashboard falls back to its deterministic summary.

   This is also the seam for "go live": the same /api/ai/summarize endpoint (and,
   later, the data endpoints) can be reimplemented in a real backend.
   ============================================================ */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 5173;
const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// POST /api/ai/summarize — server-side proxy to the Anthropic Messages API.
// The browser sends a compact snapshot; we attach the key here and forward.
function handleAiSummarize(req, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return sendJson(res, 503, { error: 'AI not configured (set ANTHROPIC_API_KEY)' });

  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', () => {
    let snapshot = {};
    try { snapshot = JSON.parse(raw || '{}'); } catch (e) { /* ignore — send {} */ }

    const payload = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system:
        'You are a concise personal-productivity assistant for an app called Tracktify. ' +
        'Given a JSON snapshot of the user\'s trackers, reply with STRICT JSON only: ' +
        '{"summary":"<=3 sentence friendly, specific read of where things stand and what needs attention",' +
        '"insights":["short prioritized item", "..."]} with at most 4 insights. No markdown, no prose outside the JSON.',
      messages: [{ role: 'user', content: 'Snapshot:\n' + JSON.stringify(snapshot) }]
    });

    const areq = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-length': Buffer.byteLength(payload)
      }
    }, (ar) => {
      let data = '';
      ar.on('data', (c) => { data += c; });
      ar.on('end', () => {
        try {
          const j = JSON.parse(data);
          const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
          let out;
          try { out = JSON.parse(text); } catch (e) { out = { summary: text || 'No summary returned.', insights: [] }; }
          sendJson(res, 200, { summary: out.summary || '', insights: Array.isArray(out.insights) ? out.insights : [] });
        } catch (e) { sendJson(res, 502, { error: 'bad upstream response' }); }
      });
    });
    areq.on('error', () => sendJson(res, 502, { error: 'upstream request failed' }));
    areq.write(payload); areq.end();
  });
}

http.createServer((req, res) => {
  // --- API routes (the only dynamic surface; everything else is static) ---
  if (req.url === '/api/ai/summarize') {
    if (req.method === 'POST') return handleAiSummarize(req, res);
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  // --- Static files ---
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log('Tracktify on http://localhost:' + PORT + (process.env.ANTHROPIC_API_KEY ? ' (AI enabled)' : ' (AI off — set ANTHROPIC_API_KEY to enable)')));
