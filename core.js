/* ============================================================
   Tracktify — core.js  (LOADS FIRST, before auth.js + modules)
   Creates window.TT: shared helpers + the async, multi-tenant,
   optimistic data layer that replaces raw localStorage.

   WHY this file exists:
   The app was a monolith calling synchronous localStorage everywhere.
   To go cloud-scalable WITHOUT rewriting all 9 tracker modules, we keep
   the exact TT.load(key,fallback) / TT.store(key,val) call signatures but
   route them through a swappable adapter:
     - MODE 'local'  → the localStorage cache IS the source of truth (today)
     - MODE 'http'   → cache is a write-through layer synced to a REST API
   Every key is namespaced by the logged-in user → multi-tenant isolation.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- Config / mode switch ---------- */
  // Resolved from env.js (loaded first). Served statically → 'local'; served by
  // the real backend (server.js serves its own /env.js) → 'http'. No code edit
  // needed to go live — the deploy decides the mode.
  var MODE = (typeof window !== 'undefined' && window.TT_MODE) || 'local';

  /* ---------- Shared helpers (unchanged API) ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function uid() {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
  function fmtDate(s) {
    if (!s) return '';
    var d = new Date(s + 'T00:00:00');
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /* ---------- Toast ---------- */
  function toast(msg, kind) {
    var stack = document.getElementById('toastStack');
    if (!stack) return;
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' toast-' + kind : '');
    t.textContent = msg;
    stack.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 250); }, 2600);
  }

  /* ---------- Namespace ---------- */
  // userId/token are populated by auth.js before any module reads data.
  var TT = window.TT = {
    MODE: MODE,
    view: 'dashboard',   // Dashboard is the default homepage
    mobileAdd: {},
    userId: null,
    esc: esc, uid: uid, fmtDate: fmtDate, toast: toast
  };

  // --- Dashboard provider registry (additive) -------------------------------
  // Tracker modules call TT.dashboard.register(name, provider). Each provider()
  // returns a normalized snapshot the dashboard renders. dashboard.js supplies
  // a generic provider for any tracker that hasn't registered one, so new and
  // user-created trackers appear automatically with zero dashboard edits.
  TT.dashboard = {
    providers: {},
    register: function (name, provider) { this.providers[name] = provider; }
  };

  /* Every persisted resource. Drives bootstrap + legacy migration. */
  var RESOURCE_KEYS = [
    'tracktify-jobs',
    'tracktify-expenses', 'tracktify-exp-settings', 'tracktify-budgets', 'tracktify-goals', 'tracktify-recurring',
    'tracktify-events', 'tracktify-event-labels', 'tracktify-event-settings',
    'tracktify-habits',
    'tracktify-water', 'tracktify-water-settings',
    'tracktify-workouts',
    'tracktify-sleep', 'tracktify-sleep-settings',
    'tracktify-calories', 'tracktify-calories-settings',
    'tracktify-custom-defs', 'tracktify-custom-data'
  ];
  TT.RESOURCE_KEYS = RESOURCE_KEYS;

  /* ---------- Per-user cache (namespaced localStorage) ---------- */
  // Physical key embeds the user id so two tenants on the same browser
  // never read each other's data. Returns null when logged out (the app
  // is gated by auth.js, so modules simply see empty state pre-login).
  function physKey(key) { return TT.userId ? 'tt:' + TT.userId + ':' + key : null; }
  function cacheGet(key) {
    var p = physKey(key); if (!p) return undefined;
    try { return JSON.parse(localStorage.getItem(p)); } catch (e) { return undefined; }
  }
  function cacheSet(key, val) {
    var p = physKey(key); if (!p) return;
    localStorage.setItem(p, JSON.stringify(val));
  }

  /* ---------- Public sync API (kept identical for modules) ---------- */
  function load(key, fallback) {
    var v = cacheGet(key);
    return (v === undefined || v === null) ? fallback : v;
  }
  function store(key, val) {
    // OPTIMISTIC: commit to local cache synchronously so the UI is zero-latency.
    var prev = cacheGet(key);
    cacheSet(key, val);
    // In cloud mode, persist in the background and roll back the cache on failure.
    if (TT.MODE === 'http') backgroundSync(key, val, prev);
  }
  TT.load = load;
  TT.store = store;

  function backgroundSync(key, val, prev) {
    // Fire-and-forget mutation. The local cache already reflects the change;
    // if the server rejects it we restore the snapshot and tell the user.
    TT.api.request('/' + resourcePath(key), { method: 'PUT', body: val })
      .catch(function () {
        cacheSet(key, prev); // rollback to last-known-good
        toast('Could not sync — change rolled back', 'error');
        document.dispatchEvent(new CustomEvent('tt:rollback', { detail: key }));
      });
  }
  function resourcePath(key) { return key.replace(/^tracktify-/, ''); } // tracktify-expenses -> expenses

  /* ---------- HTTP client (JWT-aware) ---------- */
  TT.api = {
    base: '/api',
    token: null, // in-memory access token (see auth.js for the HttpOnly-cookie note)
    setToken: function (t) { this.token = t; },
    request: function (path, opts) {
      opts = opts || {};
      var headers = {};
      // Multi-tenant: the server derives the tenant from this token's `sub`
      // and scopes every query — client filtering below is only for UX.
      if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
      var body = opts.body;
      if (opts.isForm) {
        // Let the browser set the multipart boundary — never set Content-Type here.
      } else if (body != null) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body);
      }
      return fetch(this.base + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: body,
        credentials: 'include' // allow an HttpOnly refresh cookie if the server uses one
      }).then(function (res) {
        if (res.status === 401) { document.dispatchEvent(new CustomEvent('tt:unauthorized')); throw new Error('unauthorized'); }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var ct = res.headers.get('content-type') || '';
        return ct.indexOf('json') !== -1 ? res.json() : res.text();
      });
    }
  };

  /* ---------- Data lifecycle (bootstrap / migrate / reset) ---------- */
  TT.db = {
    // Pull the user's cloud data into the cache so the sync modules can read
    // it. Called by auth.js right after login, before the dashboard renders.
    bootstrap: function () {
      if (TT.MODE !== 'http') return Promise.resolve(false); // local: cache already is the store
      var changed = false;
      return Promise.all(RESOURCE_KEYS.map(function (key) {
        return TT.api.request('/' + resourcePath(key))
          .then(function (data) {
            if (data == null) return;
            // Overwrite the local cache with the server's copy (server is the source
            // of truth in cloud mode). Track whether it actually differed so the
            // caller can reload to surface fresh data / heal a stale cache.
            if (localStorage.getItem(physKey(key)) !== JSON.stringify(data)) { cacheSet(key, data); changed = true; }
          })
          .catch(function () { /* missing resource = empty; ignore */ });
      })).then(function () { return changed; });
    },
    // One-time: lift the old single-user `tracktify-*` data into the first
    // account's namespace so existing users don't lose anything.
    migrateLegacy: function () {
      if (!TT.userId || localStorage.getItem('tt:migrated')) return;
      RESOURCE_KEYS.forEach(function (key) {
        var legacy = localStorage.getItem(key);
        var phys = 'tt:' + TT.userId + ':' + key;
        if (legacy != null && localStorage.getItem(phys) == null) localStorage.setItem(phys, legacy);
      });
      localStorage.setItem('tt:migrated', '1');
    }
  };

  /* ---------- Dynamic FX service (replaces hardcoded conversions) ---------- */
  TT.fx = {
    getRates: function (base) {
      if (TT.MODE === 'http') return TT.api.request('/fx/rates?base=' + encodeURIComponent(base));
      // Local dev stub — a real deployment fetches live rates server-side and caches them.
      return Promise.resolve({ base: base, rates: { USD: 1, EUR: 1.08, GBP: 1.27, JPY: 0.0064, PHP: 0.0177, AUD: 0.66, CAD: 0.73, SGD: 0.74 } });
    }
  };

  /* ---------- Upload service (multipart → URI, no base64 in payloads) ---------- */
  TT.uploads = {
    // Returns a Promise<uri>. Records store ONLY this string, never the bytes.
    upload: function (file) {
      if (TT.MODE === 'http') {
        var fd = new FormData();
        fd.append('file', file); // multipart upload straight to object storage (S3)
        return TT.api.request('/uploads', { method: 'POST', body: fd, isForm: true })
          .then(function (r) { return r.uri; });
      }
      // Local dev stub: emulate object storage by stashing the bytes in a
      // SEPARATE uploads bucket (not in the record), handing back only a URI.
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () {
          var id = uid().slice(0, 12);
          var bucket = JSON.parse(localStorage.getItem('tt:uploads') || '{}');
          bucket[id] = fr.result;
          localStorage.setItem('tt:uploads', JSON.stringify(bucket));
          resolve('local://upload/' + id);
        };
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
    },
    // Sync resolve so the render layer can drop the result into img.src directly.
    resolve: function (uri) {
      if (!uri) return '';
      if (uri.indexOf('local://upload/') === 0) {
        var id = uri.slice('local://upload/'.length);
        var bucket = JSON.parse(localStorage.getItem('tt:uploads') || '{}');
        return bucket[id] || '';
      }
      return uri; // already an http(s) URL
    }
  };

  /* ---------- Scheduler (heavy catch-up loops → server cron) ---------- */
  TT.scheduler = {
    // In cloud mode the server worker materializes due recurring entries.
    // In local dev we run the provided fallback (a stand-in for that cron).
    recurringCatchup: function (resource, localRunner) {
      if (TT.MODE === 'http') return TT.api.request('/jobs/recurring-catchup', { method: 'POST', body: { resource: resource } });
      if (typeof localRunner === 'function') localRunner();
      return Promise.resolve();
    }
  };

  /* ---------- PWA: register the service worker (installable + offline) ----------
     Secure-context only (https or localhost); fails silently elsewhere. */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
