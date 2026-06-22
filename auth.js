/* ============================================================
   Tracktify — auth.js  (loads after core.js, before script.js + modules)
   Client-side identity + session + view-guarding.

   WHY it runs before the modules:
   It must resolve the session and set TT.userId SYNCHRONOUSLY so that when
   the tracker modules execute their `var data = TT.load(...)` at eval time,
   they read the correct per-user namespace. If there's no valid session it
   gates the app (renders auth UI, hides the shell) so no dashboard or other
   tenant's data is ever exposed.

   Local mode ships a working mock auth. The HTTP path is wired and commented
   — passwords are hashed/verified and JWTs are SIGNED on the SERVER, never here.
   ============================================================ */
(function () {
  'use strict';
  var TT = window.TT;
  var SESSION_KEY = 'tt:session';      // {userId,name,email,token,exp}
  var USERS_KEY = 'tt:users';          // local mock user store (dev only)

  /* ---------- low-level session storage ---------- */
  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
  }
  function writeSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
  function clearSession() { localStorage.removeItem(SESSION_KEY); }

  // A real JWT is signed by the server with a secret; we only DECODE the exp
  // claim to gate the UI. Never trust this for authorization — the API does that.
  function tokenValid(s) { return s && s.token && s.exp && s.exp > Date.now(); }

  /* ---------- mock-only helpers (dev) ---------- */
  function getUsers() { try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; } catch (e) { return []; } }
  function setUsers(u) { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }
  // NOT a real hash. Real apps hash with bcrypt/argon2 SERVER-SIDE. This only
  // keeps plaintext out of localStorage for the local demo.
  function obfuscate(pw) { try { return btoa(unescape(encodeURIComponent('tt$' + pw))); } catch (e) { return pw; } }
  // Fake unsigned JWT-shaped token for the local adapter. Server issues a
  // properly signed one and the api client sends it as `Authorization: Bearer`.
  function mintToken(user, exp) {
    var header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    var payload = btoa(JSON.stringify({ sub: user.id, name: user.name, exp: Math.floor(exp / 1000) }));
    return header + '.' + payload + '.local';
  }

  /* ---------- apply / drop a session ---------- */
  function applySession(s) {
    TT.userId = s.userId;
    TT.api.setToken(s.token);
  }

  /* ============================================================
     GUARD — runs immediately at load
  ============================================================ */
  var session = readSession();
  if (tokenValid(session)) {
    applySession(session);            // modules will now read this user's namespace
    // Self-heal stale caches: in cloud mode, re-pull the server's copy on each fresh
    // load. The modules read the (possibly stale) cache synchronously below, so if the
    // pull actually changed anything we reload to re-read fresh data. We ALWAYS run the
    // pull (so a cold-start failure simply retries on the next load) and guard only the
    // RELOAD against an infinite loop. Also makes cross-device edits appear on next open.
    if (TT.MODE === 'http') {
      TT.db.bootstrap().then(function (changed) {
        if (changed && !sessionStorage.getItem('tt:healed')) {
          sessionStorage.setItem('tt:healed', '1');
          location.reload();
        }
      });
    }
    // Show the one-time recovery code captured during sign-up (after the reload).
    var pendingCode = null; try { pendingCode = sessionStorage.getItem('tt:show-recovery'); } catch (e) {}
    if (pendingCode) {
      try { sessionStorage.removeItem('tt:show-recovery'); } catch (e) {}
      var showIt = function () { showRecoveryModal(pendingCode); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showIt); else showIt();
    }
    document.addEventListener('DOMContentLoaded', mountUserChip);
    if (document.readyState !== 'loading') mountUserChip();
  } else {
    clearSession();
    // Lock the shell BEFORE it can paint, then show the auth screen.
    document.documentElement.classList.add('auth-locked');
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderAuthScreen);
    else renderAuthScreen();
  }

  // The API tells us a token went stale (server-driven logout). Force re-auth —
  // but ONLY if we actually have a session. A 401 while logged out is expected
  // (e.g. a pre-login request) and must never trigger a reload loop.
  document.addEventListener('tt:unauthorized', function () { if (readSession()) doLogout(); });

  /* ============================================================
     LOGIN / REGISTER (local adapter; HTTP path stubbed)
  ============================================================ */
  // Maps the api client's generic HTTP errors to friendly auth messages.
  function httpAuthError(err) {
    var m = String((err && err.message) || '');
    if (m.indexOf('409') > -1) throw new Error('That email is already registered.');
    if (m.indexOf('401') > -1) throw new Error('Invalid email or password.');
    throw new Error('Could not reach the server. Please try again.');
  }

  function register(name, email, password) {
    if (TT.MODE === 'http') {
      // Real server hashes the password (scrypt) and signs the JWT — never here.
      return TT.api.request('/auth/register', { method: 'POST', body: { name: name, email: email, password: password } })
        .then(function (r) {
          if (r.recoveryCode) { try { sessionStorage.setItem('tt:show-recovery', r.recoveryCode); } catch (e) {} }
          return finishLogin(r.user, r.token);
        }).catch(httpAuthError);
    }
    var users = getUsers();
    if (users.some(function (u) { return u.email === email; })) return Promise.reject(new Error('That email is already registered.'));
    var user = { id: TT.uid(), name: name, email: email, pass: obfuscate(password) };
    users.push(user); setUsers(users);
    return finishLogin(user);
  }
  function login(email, password) {
    if (TT.MODE === 'http') {
      return TT.api.request('/auth/login', { method: 'POST', body: { email: email, password: password } })
        .then(function (r) { return finishLogin(r.user, r.token); }).catch(httpAuthError);
    }
    var user = getUsers().filter(function (u) { return u.email === email; })[0];
    if (!user || user.pass !== obfuscate(password)) return Promise.reject(new Error('Invalid email or password.'));
    return finishLogin(user);
  }

  // Shared post-auth path: mint/store session, bootstrap cloud data, reload
  // into the authenticated context (a clean way to re-run every module's
  // synchronous init now that TT.userId is set — no per-module rewrites).
  // `token` is supplied by the server in http mode; in local mode we mint one.
  function finishLogin(user, token) {
    var exp = Date.now() + 7 * 24 * 3600 * 1000; // client gate hint; server enforces the real exp
    var s = { userId: user.id, name: user.name, email: user.email, token: token || mintToken(user, exp), exp: exp };
    applySession(s); writeSession(s);
    TT.db.migrateLegacy();                 // lift any pre-auth single-user data into this account
    return TT.db.bootstrap().then(function () { // pull cloud state (no-op in local mode)
      location.reload();                   // re-enter the app authenticated
    });
  }

  function doLogout() {
    if (TT.MODE === 'http') { try { TT.api.request('/auth/logout', { method: 'POST' }).catch(function () {}); } catch (e) {} }
    clearSession();
    TT.api.setToken(null);
    TT.userId = null;
    location.reload();
  }
  /* ---------- Account recovery (cloud mode) ---------- */
  function recoveryStatus() {
    if (TT.MODE !== 'http') return Promise.resolve(false);
    return TT.api.request('/auth/recovery').then(function (r) { return !!(r && r.has); }).catch(function () { return false; });
  }
  function generateRecovery() {
    if (TT.MODE !== 'http') return Promise.reject(new Error('Recovery is only available with a cloud account.'));
    return TT.api.request('/auth/recovery', { method: 'POST' }).then(function (r) { if (!r || !r.code) throw new Error('No code returned'); return r.code; });
  }
  function resetWithCode(email, code, password) {
    return TT.api.request('/auth/reset', { method: 'POST', body: { email: email, code: code, password: password } })
      .then(function (r) { return finishLogin(r.user, r.token); })
      .catch(function (err) {
        var m = String((err && err.message) || '');
        if (m.indexOf('401') > -1) throw new Error('Invalid email or recovery code.');
        throw new Error('Could not reset password. Please try again.');
      });
  }

  // One-time recovery-code reveal (used after sign-up and from Settings).
  function showRecoveryModal(code) {
    var w = document.createElement('div');
    w.className = 'modal-wrap open';
    w.innerHTML =
      '<div class="modal modal-sm"><div class="modal-top"><h2>Save your recovery code</h2></div>' +
      '<p class="set-note">This code lets you reset your password if you ever forget it. It’s shown only once — store it somewhere safe.</p>' +
      '<div class="recovery-code">' + TT.esc(code) + '</div>' +
      '<div class="modal-btns"><button type="button" class="ev-today-btn" id="arcCopy">Copy</button><button type="button" class="submit" id="arcDone">I’ve saved it</button></div></div>';
    document.body.appendChild(w);
    w.querySelector('#arcCopy').addEventListener('click', function () { try { navigator.clipboard.writeText(code); TT.toast('Copied', 'success'); } catch (e) {} });
    w.querySelector('#arcDone').addEventListener('click', function () { w.remove(); });
  }
  TT.auth = {
    logout: doLogout, register: register, login: login,
    currentUser: function () { return readSession(); },
    recoveryStatus: recoveryStatus, generateRecovery: generateRecovery, resetWithCode: resetWithCode,
    showRecoveryModal: showRecoveryModal
  };

  /* ============================================================
     AUTH SCREEN UI (injected; no index.html markup needed)
  ============================================================ */
  function renderAuthScreen() {
    if (document.getElementById('authScreen')) return;
    var el = document.createElement('div');
    el.id = 'authScreen';
    el.innerHTML =
      '<div class="auth-card">' +
        '<div class="auth-brand"><span class="auth-mark">' +
          '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 14l4-4 3.5 3.5L16 6"/><path d="M13 6h4v4"/></svg>' +
        '</span><span class="auth-name">Tracktify</span></div>' +
        '<h1 class="auth-title" id="authTitle">Welcome back</h1>' +
        '<p class="auth-sub" id="authSub">Log in to your trackers.</p>' +
        '<form id="authForm" novalidate>' +
          '<div class="field" id="authNameField" hidden><label for="auth-name">Name</label><input id="auth-name" type="text" autocomplete="name" placeholder="Your name" /></div>' +
          '<div class="field"><label for="auth-email">Email</label><input id="auth-email" type="email" autocomplete="email" placeholder="you@example.com" required /></div>' +
          '<div class="field" id="authCodeField" hidden><label for="auth-code">Recovery code</label><input id="auth-code" type="text" autocomplete="off" placeholder="ABCD-EFGH-JKMN-PQRS" /></div>' +
          '<div class="field"><label for="auth-pass" id="authPassLabel">Password</label><input id="auth-pass" type="password" autocomplete="current-password" placeholder="••••••••" required /></div>' +
          '<p class="auth-error" id="authError" role="alert"></p>' +
          '<button type="submit" class="btn-add auth-submit" id="authSubmit">Log In</button>' +
        '</form>' +
        '<p class="auth-switch" id="authSwitchRow">' +
          '<span id="authSwitchText">New here?</span> ' +
          '<button type="button" id="authToggle" class="auth-link">Create an account</button>' +
        '</p>' +
        '<p class="auth-switch"><button type="button" id="authForgot" class="auth-link">Forgot password?</button></p>' +
      '</div>';
    document.body.appendChild(el);

    var mode = 'login';
    var form = el.querySelector('#authForm');
    var err = el.querySelector('#authError');
    function setMode(m) {
      mode = m;
      var reg = m === 'register', rst = m === 'reset';
      el.querySelector('#authTitle').textContent = reg ? 'Create your account' : rst ? 'Reset password' : 'Welcome back';
      el.querySelector('#authSub').textContent = reg ? 'Start tracking in seconds.' : rst ? 'Enter your email, recovery code, and a new password.' : 'Log in to your trackers.';
      el.querySelector('#authNameField').hidden = !reg;
      el.querySelector('#auth-name').required = reg;
      el.querySelector('#authCodeField').hidden = !rst;
      el.querySelector('#authPassLabel').textContent = rst ? 'New password' : 'Password';
      el.querySelector('#auth-pass').setAttribute('autocomplete', (reg || rst) ? 'new-password' : 'current-password');
      el.querySelector('#authSubmit').textContent = reg ? 'Create Account' : rst ? 'Reset Password' : 'Log In';
      el.querySelector('#authSwitchText').textContent = reg ? 'Already have an account?' : 'New here?';
      el.querySelector('#authToggle').textContent = reg ? 'Log in' : 'Create an account';
      el.querySelector('#authSwitchRow').style.display = rst ? 'none' : '';
      el.querySelector('#authForgot').textContent = rst ? '← Back to log in' : 'Forgot password?';
      err.textContent = '';
    }
    el.querySelector('#authToggle').addEventListener('click', function () { setMode(mode === 'login' ? 'register' : 'login'); });
    el.querySelector('#authForgot').addEventListener('click', function () { setMode(mode === 'reset' ? 'login' : 'reset'); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.textContent = '';
      var email = el.querySelector('#auth-email').value.trim();
      var pass = el.querySelector('#auth-pass').value;
      var name = el.querySelector('#auth-name').value.trim();
      var code = el.querySelector('#auth-code').value.trim();
      if (!email || !pass || (mode === 'register' && !name) || (mode === 'reset' && !code)) { err.textContent = 'Please fill in all fields.'; return; }
      var btn = el.querySelector('#authSubmit'), orig = btn.textContent;
      btn.disabled = true; btn.textContent = 'Please wait…';
      var p = mode === 'register' ? register(name, email, pass) : mode === 'reset' ? resetWithCode(email, code, pass) : login(email, pass);
      p.catch(function (ex) { err.textContent = ex.message || 'Something went wrong.'; btn.disabled = false; btn.textContent = orig; });
    });
    setTimeout(function () { el.querySelector('#auth-email').focus(); }, 60);
  }

  /* ---------- logged-in user chip + logout (injected into sidebar) ---------- */
  function mountUserChip() {
    var s = readSession(); if (!s) return;
    var brand = document.querySelector('.sidebar .brand');
    if (!brand || document.getElementById('userChip')) return;
    var chip = document.createElement('div');
    chip.id = 'userChip';
    chip.className = 'user-chip';
    var initials = (s.name || s.email || '?').trim().slice(0, 1).toUpperCase();
    chip.innerHTML =
      '<span class="user-avatar">' + TT.esc(initials) + '</span>' +
      '<span class="user-meta"><span class="user-name">' + TT.esc(s.name || 'Account') + '</span><span class="user-email">' + TT.esc(s.email || '') + '</span></span>' +
      '<button class="user-logout" id="logoutBtn" title="Log out" aria-label="Log out">⎋</button>';
    brand.insertAdjacentElement('afterend', chip);
    document.getElementById('logoutBtn').addEventListener('click', function () {
      if (confirm('Log out of Tracktify?')) doLogout();
    });
  }
})();
