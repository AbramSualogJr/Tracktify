/* ============================================================
   Tracktify — settings.js  (loads after extras.js, before dashboard.js)
   App-level utilities that don't belong to any single tracker:
     • A sync-status pill in the sidebar (saved / saving / offline).
     • A Settings modal with: data backup (export/import), reminders,
       and account recovery (wired to auth.js when available).
   ============================================================ */
(function () {
  'use strict';
  var TT = window.TT;
  if (!TT || !document.getElementById('sidebar')) return;
  var esc = TT.esc, load = TT.load, store = TT.store, toast = TT.toast;

  var REMIND_KEY = 'tracktify-reminders';
  // Trackers that can have a simple daily reminder. Labels/icons for the UI.
  var REMINDABLE = [
    { id: 'meds', label: 'Medications', icon: '💊' },
    { id: 'habits', label: 'Habits', icon: '✅' },
    { id: 'water', label: 'Water', icon: '💧' },
    { id: 'mindful', label: 'Mindfulness', icon: '🧘' }
  ];

  function getRem() { var r = load(REMIND_KEY, null); return (r && typeof r === 'object') ? r : { enabled: false, items: {} }; }
  function setRem(r) { store(REMIND_KEY, r); }

  /* ============================================================
     Sidebar: sync pill + Settings button
  ============================================================ */
  var themeBtn = document.getElementById('themeToggle');
  var syncPill = document.createElement('div');
  syncPill.className = 'sync-pill';
  syncPill.id = 'syncPill';

  var gear = document.createElement('button');
  gear.className = 'theme-btn settings-btn';
  gear.id = 'settingsBtn';
  gear.innerHTML =
    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="10" cy="10" r="3" />' +
      '<path d="M10 1.5v2M10 16.5v2M3.5 3.5l1.4 1.4M15.1 15.1l1.4 1.4M1.5 10h2M16.5 10h2M3.5 16.5l1.4-1.4M15.1 4.9l1.4-1.4" />' +
    '</svg><span>Settings</span>';

  if (themeBtn && themeBtn.parentNode) {
    themeBtn.parentNode.insertBefore(syncPill, themeBtn);
    themeBtn.parentNode.insertBefore(gear, themeBtn);
  }

  function renderSync(state) {
    state = state || TT.getSyncState();
    var cls = 'ok', label = 'All changes saved';
    if (!state.online) { cls = 'off'; label = 'Offline — will sync'; }
    else if (state.pending > 0) { cls = 'busy'; label = 'Saving…'; }
    syncPill.className = 'sync-pill ' + cls;
    syncPill.innerHTML = '<span class="sync-dot"></span>' + esc(label);
  }
  document.addEventListener('tt:syncstate', function (e) { renderSync(e.detail); });
  renderSync();

  /* ============================================================
     Settings modal (injected once)
  ============================================================ */
  var holder = document.createElement('div');
  holder.innerHTML =
    '<div class="modal-wrap" id="settingsWrap" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">' +
      '<div class="modal modal-sm">' +
        '<div class="modal-top"><h2 id="settingsTitle">Settings</h2><button class="modal-x" id="settingsClose" aria-label="Close">✕</button></div>' +
        '<div class="set-body" id="setBody"></div>' +
        '<div class="modal-btns"><button type="button" class="submit" id="settingsDone">Done</button></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(holder.firstChild);

  var modal = document.getElementById('settingsWrap');
  var body = document.getElementById('setBody');
  // Hidden file input for import.
  var fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = 'application/json,.json'; fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  function close() { modal.classList.remove('open'); }
  gear.addEventListener('click', function () { renderBody(); modal.classList.add('open'); });
  document.getElementById('settingsClose').addEventListener('click', close);
  document.getElementById('settingsDone').addEventListener('click', close);
  modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  function renderBody() {
    var u = (TT.auth && TT.auth.currentUser && TT.auth.currentUser()) || {};
    var rem = getRem();
    var notifSupported = ('Notification' in window);
    var perm = notifSupported ? Notification.permission : 'unsupported';

    var remRows = REMINDABLE.map(function (t) {
      var it = (rem.items && rem.items[t.id]) || {};
      return '<div class="set-rem-row">' +
        '<label class="set-rem-name"><input type="checkbox" data-rem="' + t.id + '"' + (it.on ? ' checked' : '') + ' /> ' + t.icon + ' ' + esc(t.label) + '</label>' +
        '<input type="time" class="ctrl-sel set-rem-time" data-remtime="' + t.id + '" value="' + esc(it.time || '09:00') + '"' + (it.on ? '' : ' disabled') + ' />' +
        '</div>';
    }).join('');

    body.innerHTML =
      // ---- Data & backup ----
      '<section class="set-sec"><h3 class="set-h">Data &amp; backup</h3>' +
        '<p class="set-note">Download a full copy of your data, or restore it from a file. Keep a backup somewhere safe.</p>' +
        '<div class="set-actions">' +
          '<button type="button" class="btn-add" id="setExport">⬇ Export backup</button>' +
          '<button type="button" class="ev-today-btn" id="setImport">⬆ Import backup</button>' +
        '</div>' +
      '</section>' +
      // ---- Reminders ----
      '<section class="set-sec"><h3 class="set-h">Reminders</h3>' +
        (notifSupported
          ? '<label class="switch-row"><input type="checkbox" id="setRemEnabled"' + (rem.enabled ? ' checked' : '') + ' /> <span>Enable daily reminders</span></label>' +
            '<p class="set-note">Pick a time for each tracker. Notifications fire while Tracktify is open in your browser or installed as an app. ' +
            (perm === 'denied' ? '<b>Notifications are blocked in your browser settings — allow them to use this.</b>' : '') + '</p>' +
            '<div class="set-rem-list"' + (rem.enabled ? '' : ' hidden') + ' id="setRemList">' + remRows + '</div>'
          : '<p class="set-note">Your browser doesn’t support notifications.</p>') +
      '</section>' +
      // ---- Account ----
      '<section class="set-sec"><h3 class="set-h">Account</h3>' +
        '<p class="set-note">Signed in as <b>' + esc(u.email || '—') + '</b></p>' +
        '<div id="setAccount"></div>' +
      '</section>';

    document.getElementById('setExport').addEventListener('click', doExport);
    document.getElementById('setImport').addEventListener('click', function () { fileInput.value = ''; fileInput.click(); });

    if (notifSupported) {
      var en = document.getElementById('setRemEnabled');
      en.addEventListener('change', function () {
        var r = getRem();
        if (en.checked && Notification.permission !== 'granted') {
          Notification.requestPermission().then(function (p) {
            r.enabled = (p === 'granted'); setRem(r); renderBody();
            if (p !== 'granted') toast('Allow notifications to use reminders', 'error');
          });
          return;
        }
        r.enabled = en.checked; setRem(r);
        var list = document.getElementById('setRemList'); if (list) list.hidden = !en.checked;
      });
      body.querySelectorAll('[data-rem]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var id = cb.getAttribute('data-rem'), r = getRem();
          r.items = r.items || {}; r.items[id] = r.items[id] || {};
          r.items[id].on = cb.checked;
          if (!r.items[id].time) r.items[id].time = '09:00';
          setRem(r);
          var tinp = body.querySelector('[data-remtime="' + id + '"]'); if (tinp) tinp.disabled = !cb.checked;
        });
      });
      body.querySelectorAll('[data-remtime]').forEach(function (ti) {
        ti.addEventListener('change', function () {
          var id = ti.getAttribute('data-remtime'), r = getRem();
          r.items = r.items || {}; r.items[id] = r.items[id] || { on: true };
          r.items[id].time = ti.value; setRem(r);
        });
      });
    }

    renderAccount();
  }

  /* ---- Account / recovery (wired to auth.js) ---- */
  function renderAccount() {
    var mount = document.getElementById('setAccount');
    if (!mount) return;
    if (TT.MODE !== 'http' || !TT.auth || typeof TT.auth.recoveryStatus !== 'function') {
      mount.innerHTML = '<p class="set-note">Account recovery is available when signed in to a cloud account.</p>';
      return;
    }
    mount.innerHTML = '<p class="set-note">Checking recovery status…</p>';
    TT.auth.recoveryStatus().then(function (has) {
      mount.innerHTML =
        '<p class="set-note">A recovery code lets you reset your password if you forget it. ' +
        (has ? 'A recovery code is set for this account.' : 'No recovery code is set yet.') + '</p>' +
        '<button type="button" class="ev-today-btn" id="setRecovery">' + (has ? 'Regenerate recovery code' : 'Generate recovery code') + '</button>';
      document.getElementById('setRecovery').addEventListener('click', function () {
        TT.auth.generateRecovery().then(function (code) {
          TT.auth.showRecoveryModal(code);
          renderAccount();
        }).catch(function (e) { toast(e.message || 'Could not generate code', 'error'); });
      });
    });
  }

  /* ============================================================
     Export / Import
  ============================================================ */
  function doExport() {
    var payload = TT.db.exportAll();
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'tracktify-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Backup downloaded', 'success');
  }
  fileInput.addEventListener('change', function () {
    var f = fileInput.files && fileInput.files[0]; if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var payload = JSON.parse(fr.result);
        var n = (payload && payload.data) ? Object.keys(payload.data).length : 0;
        if (!n) throw new Error('No data found in file');
        if (!confirm('Restore ' + n + ' data set(s) from this backup?\nThis replaces the matching data on your current account.')) return;
        var restored = TT.db.importAll(payload);
        toast('Restored ' + restored + ' data set(s)', 'success');
        setTimeout(function () { location.reload(); }, 700);
      } catch (e) { toast('Could not read backup: ' + (e.message || 'invalid file'), 'error'); }
    };
    fr.readAsText(f);
  });

  /* ============================================================
     Reminder scheduler (best-effort; fires while the app is open)
     A reminder fires once per day, at or after its set time (so opening the
     app later in the day still surfaces a missed reminder). Background delivery
     when the app is fully closed needs a push server, which we don't run.
  ============================================================ */
  var firedToday = {};
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function checkReminders() {
    var rem = getRem();
    if (!rem.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
    var now = new Date();
    var hhmm = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    var today = now.toISOString().slice(0, 10);
    REMINDABLE.forEach(function (t) {
      var it = (rem.items && rem.items[t.id]) || {};
      if (!it.on || !it.time) return;
      if (it.time <= hhmm) {
        var fk = t.id + ':' + today;
        if (firedToday[fk]) return;
        firedToday[fk] = 1;
        try { new Notification('Tracktify', { body: 'Reminder: log your ' + t.label, icon: 'icon.svg', tag: fk }); } catch (e) {}
      }
    });
  }
  setInterval(checkReminders, 30000);
  setTimeout(checkReminders, 4000); // catch-up shortly after load
})();
