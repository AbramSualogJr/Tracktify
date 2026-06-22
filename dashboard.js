/* ============================================================
   Tracktify — dashboard.js  (default homepage)
   Aggregates every tracker via the TT.dashboard provider registry,
   shows an AI summary (TT.ai.summarize) with a deterministic fallback,
   per-tracker stat cards, recent activity and upcoming items.

   Decoupling: the dashboard never reads tracker internals directly. It
   discovers trackers from the sidebar nav and asks each one's registered
   provider (or a generic default) for a normalized snapshot — so new and
   user-created trackers appear here automatically.
   ============================================================ */
(function () {
  'use strict';
  if (!document.getElementById('view-dashboard')) return;

  var TT = window.TT;
  var esc = TT.esc, load = TT.load, store = TT.store, toast = TT.toast;

  var currentSnaps = [];

  /* ============================================================
     Tracker discovery + snapshots
  ============================================================ */
  // Source of truth for "what trackers exist" = the sidebar nav (includes
  // dynamically-added custom trackers). Keeps the dashboard edit-free.
  function discover() {
    return Array.prototype.map.call(
      document.querySelectorAll('#sidebarNav .nav-item[data-tracker]'),
      function (btn) {
        var name = btn.getAttribute('data-tracker');
        var customId = btn.getAttribute('data-custom-id') || null;
        var iconEl = btn.querySelector('span');
        var icon = iconEl ? iconEl.textContent.trim() : '📊';
        // label is the button text MINUS the leading icon (avoids "✅ ✅ Habits")
        var label = (btn.textContent || '').replace(icon, '').replace(/\s+/g, ' ').trim();
        return { name: name, customId: customId, key: customId ? name + ':' + customId : name, icon: icon, label: label };
      }
    ).filter(function (t) { return t.name !== 'dashboard'; });
  }

  // Default provider for any tracker that hasn't registered one — reads its
  // localStorage array generically so nothing silently disappears.
  function genericSnapshot(t) {
    var entries;
    if (t.name === 'custom' && t.customId) {
      var data = load('tracktify-custom-data', {}) || {};
      entries = Array.isArray(data[t.customId]) ? data[t.customId] : [];
    } else {
      entries = load('tracktify-' + t.name, []);
      if (!Array.isArray(entries)) entries = [];
    }
    var recent = entries.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 5)
      .map(function (e) {
        return { title: e._title || e.title || e.name || e.description || e.label || '(entry)', ts: e.createdAt || 0, meta: '' };
      });
    return {
      stats: [{ label: 'Entries', value: entries.length, tone: '' }],
      recent: recent, upcoming: [],
      headline: entries.length ? entries.length + (entries.length === 1 ? ' entry' : ' entries') + ' in ' + t.label : ''
    };
  }

  // Build normalized snapshots for every tracker. A broken provider must never
  // take down the dashboard, so each call is guarded.
  function buildSnapshots() {
    return discover().map(function (t) {
      var provider = TT.dashboard.providers[t.key] || TT.dashboard.providers[t.name];
      var snap;
      try { snap = provider ? provider(t) : genericSnapshot(t); }
      catch (e) { snap = genericSnapshot(t); }
      // normalize + always trust discovery for identity/navigation
      snap = snap || {};
      snap.name = snap.name || t.label;
      snap.icon = snap.icon || t.icon;
      snap.navKey = t.key;          // used to jump to the tracker's view
      snap.stats = snap.stats || [];
      snap.recent = snap.recent || [];
      snap.upcoming = snap.upcoming || [];
      snap.headline = snap.headline || '';
      return snap;
    });
  }

  /* ============================================================
     Time helpers
  ============================================================ */
  function relTime(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts, m = 60000, h = 3600000, d = 86400000;
    if (diff < m) return 'just now';
    if (diff < h) return Math.floor(diff / m) + 'm ago';
    if (diff < d) return Math.floor(diff / h) + 'h ago';
    if (diff < 7 * d) return Math.floor(diff / d) + 'd ago';
    return TT.fmtDate(new Date(ts).toISOString().slice(0, 10));
  }
  function relDay(dateStr) {
    if (!dateStr) return '';
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var dd = new Date(dateStr + 'T00:00:00');
    if (isNaN(dd)) return dateStr;
    var diff = Math.round((dd - today) / 86400000);
    if (diff < 0) return TT.fmtDate(dateStr);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff < 7) return 'in ' + diff + ' days';
    return TT.fmtDate(dateStr);
  }

  /* ============================================================
     Navigation (reuse the sidebar buttons' wiring)
  ============================================================ */
  function jumpTo(navKey) {
    var btns = document.querySelectorAll('#sidebarNav .nav-item[data-tracker]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var key = b.getAttribute('data-custom-id') ? b.getAttribute('data-tracker') + ':' + b.getAttribute('data-custom-id') : b.getAttribute('data-tracker');
      if (key === navKey) { b.click(); return; }
    }
  }

  /* ============================================================
     Render
  ============================================================ */
  var greetingEl = document.getElementById('dashGreeting');
  var dateEl = document.getElementById('dashDate');
  var cardsEl = document.getElementById('dashCards');
  var recentEl = document.getElementById('dashRecent');
  var upcomingEl = document.getElementById('dashUpcoming');

  function render() {
    var u = TT.auth && TT.auth.currentUser && TT.auth.currentUser();
    var hr = new Date().getHours();
    var part = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    greetingEl.textContent = part + (u && u.name ? ', ' + u.name.split(' ')[0] : '');
    dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    currentSnaps = buildSnapshots();
    renderOnboard(!hasAnyData(currentSnaps));
    renderCards(currentSnaps);
    renderFeeds(currentSnaps);
  }

  // First-run: if nothing has been logged anywhere, show a friendly guide.
  function hasAnyData(snaps) {
    return snaps.some(function (s) {
      return (s.recent && s.recent.length) || (s.upcoming && s.upcoming.length) ||
        (s.stats && s.stats.some(function (st) { return st.value && st.value !== 0 && st.value !== '0'; }));
    });
  }
  var onboardEl = null;
  function renderOnboard(show) {
    if (show && !onboardEl) {
      onboardEl = document.createElement('section');
      onboardEl.className = 'onboard-card';
      onboardEl.innerHTML =
        '<h2 class="onboard-title">👋 Welcome to Tracktify</h2>' +
        '<p class="onboard-sub">Track anything — money, habits, health, and more. Here’s how to start:</p>' +
        '<ol class="onboard-steps">' +
          '<li><b>Pick a tracker</b> from the sidebar (or tap ☰ on mobile).</li>' +
          '<li>Hit <b>+ Add</b> to log your first entry.</li>' +
          '<li>Come back here — your dashboard fills in automatically.</li>' +
        '</ol>' +
        '<p class="onboard-tip">💾 Tip: open <b>Settings</b> (bottom-left) to set up reminders and download a backup of your data.</p>';
      cardsEl.parentNode.insertBefore(onboardEl, cardsEl);
    }
    if (onboardEl) onboardEl.style.display = show ? '' : 'none';
  }

  function renderCards(snaps) {
    cardsEl.innerHTML = snaps.map(function (s) {
      var stats = s.stats.slice(0, 3).map(function (st) {
        return '<div class="dc-stat"><span class="dc-val tone-' + (st.tone || 'none') + '">' + esc(String(st.value)) + '</span>' +
          '<span class="dc-lbl">' + esc(st.label) + '</span></div>';
      }).join('') || '<div class="dc-stat"><span class="dc-val tone-none">—</span><span class="dc-lbl">No data</span></div>';
      return '<button class="dash-card" data-nav="' + esc(s.navKey) + '" aria-label="Open ' + esc(s.name) + '">' +
        '<div class="dc-head"><span class="dc-icon">' + s.icon + '</span><span class="dc-name">' + esc(s.name) + '</span><span class="dc-go" aria-hidden="true">→</span></div>' +
        '<div class="dc-stats">' + stats + '</div></button>';
    }).join('');
    cardsEl.querySelectorAll('.dash-card').forEach(function (c) {
      c.addEventListener('click', function () { jumpTo(c.getAttribute('data-nav')); });
    });
  }

  function renderFeeds(snaps) {
    // Recent activity — merged, newest first
    var feed = [];
    snaps.forEach(function (s) { s.recent.forEach(function (r) { feed.push({ icon: s.icon, name: s.name, navKey: s.navKey, title: r.title, ts: r.ts || 0, meta: r.meta || '' }); }); });
    feed.sort(function (a, b) { return b.ts - a.ts; });
    recentEl.innerHTML = feed.length ? feed.slice(0, 8).map(function (f) {
      return '<li><button class="feed-row" data-nav="' + esc(f.navKey) + '">' +
        '<span class="feed-ic">' + f.icon + '</span>' +
        '<span class="feed-main"><span class="feed-title">' + esc(f.title) + '</span>' +
        '<span class="feed-sub">' + esc(f.name) + (f.meta ? ' · ' + esc(f.meta) : '') + '</span></span>' +
        '<span class="feed-when">' + esc(relTime(f.ts)) + '</span></button></li>';
    }).join('') : '<li class="feed-empty">No recent activity yet.</li>';

    // Upcoming — merged, soonest first
    var up = [];
    snaps.forEach(function (s) { s.upcoming.forEach(function (uu) { up.push({ icon: s.icon, name: s.name, navKey: s.navKey, title: uu.title, date: uu.date, meta: uu.meta || '', atRisk: uu.atRisk }); }); });
    up.sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; });
    upcomingEl.innerHTML = up.length ? up.slice(0, 8).map(function (f) {
      return '<li><button class="feed-row' + (f.atRisk ? ' at-risk' : '') + '" data-nav="' + esc(f.navKey) + '">' +
        '<span class="feed-ic">' + f.icon + '</span>' +
        '<span class="feed-main"><span class="feed-title">' + esc(f.title) + '</span>' +
        '<span class="feed-sub">' + esc(f.name) + (f.meta ? ' · ' + esc(f.meta) : '') + '</span></span>' +
        '<span class="feed-when">' + esc(relDay(f.date)) + '</span></button></li>';
    }).join('') : '<li class="feed-empty">Nothing coming up.</li>';

    [recentEl, upcomingEl].forEach(function (el) {
      el.querySelectorAll('.feed-row').forEach(function (r) { r.addEventListener('click', function () { jumpTo(r.getAttribute('data-nav')); }); });
    });
  }

  /* ============================================================
     Wiring
  ============================================================ */
  // The dashboard has no "+ Add" — hide the mobile add button on this view.
  function syncMobileAdd(view) {
    var addBtn = document.getElementById('mobileAddBtn');
    if (addBtn) addBtn.style.display = view === 'dashboard' ? 'none' : '';
  }

  document.addEventListener('tt:view', function (e) {
    syncMobileAdd(e.detail);
    if (e.detail === 'dashboard') render();
  });
  document.addEventListener('tt:theme', function () { if (TT.view === 'dashboard') render(); });

  // Initial paint (dashboard is the default view).
  syncMobileAdd(TT.view);
  render();
})();
