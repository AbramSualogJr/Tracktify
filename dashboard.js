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

  var AI_CACHE = 'tracktify-dash-ai';      // per-user cache of the last summary
  var AI_STALE_MS = 6 * 3600 * 1000;       // auto-regenerate if older than 6h
  var aiState = { loading: false };
  var currentSnaps = [];

  /* ============================================================
     AI choke point — the ONLY place an AI request is made.
     Path #2 (server proxy): routed through the existing /api contract so the
     API key lives server-side. To run as a Claude.ai Artifact instead, replace
     ONLY this body with a direct fetch('https://api.anthropic.com/v1/messages',
     { ...model:'claude-sonnet-4-6', max_tokens:1000 }) and parse content blocks.
  ============================================================ */
  TT.ai = TT.ai || {};
  TT.ai.summarize = function (snapshot) {
    return TT.api.request('/ai/summarize', { method: 'POST', body: snapshot })
      .then(function (r) {
        if (!r || !r.summary) throw new Error('empty AI response');
        return { summary: r.summary, insights: Array.isArray(r.insights) ? r.insights : [], source: 'ai' };
      });
  };

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
     Deterministic fallback (used when AI is unavailable)
  ============================================================ */
  function fallbackSummary(snaps) {
    var clauses = snaps.map(function (s) { return s.headline; }).filter(Boolean);
    var summary = clauses.slice(0, 4).join('  ·  ') ||
      'Nothing tracked yet — add data to any tracker and your summary will appear here.';
    var insights = [];
    snaps.forEach(function (s) {
      s.stats.forEach(function (st) {
        if (st.tone === 'bad') insights.push('⚠️ ' + s.name + ': ' + String(st.label).toLowerCase() + ' ' + st.value);
      });
      s.upcoming.forEach(function (u) { if (u.atRisk) insights.push('⏰ ' + s.name + ': ' + u.title + ' ' + relDay(u.date)); });
    });
    return { summary: summary, insights: insights.slice(0, 4), source: 'fallback' };
  }

  // Compact payload for the model — summarized labels/values, never raw dumps.
  function buildAISnapshot(snaps) {
    var u = TT.auth && TT.auth.currentUser && TT.auth.currentUser();
    return {
      date: new Date().toISOString().slice(0, 10),
      user: (u && u.name) || null,
      trackers: snaps.filter(function (s) {
        return s.recent.length || s.upcoming.length || s.stats.some(function (st) { return st.value && st.value !== 0 && st.value !== '0'; });
      }).map(function (s) {
        return {
          name: s.name,
          stats: s.stats.map(function (st) { return st.label + ': ' + st.value + (st.tone === 'bad' ? ' (!)' : ''); }),
          upcoming: s.upcoming.slice(0, 3).map(function (uu) { return uu.title + ' — ' + relDay(uu.date); })
        };
      })
    };
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
  var aiCard = document.getElementById('aiCard');
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
    renderCards(currentSnaps);
    renderFeeds(currentSnaps);
    renderAICard();

    // Auto-generate once if we have no fresh cached summary (non-blocking).
    // Only when authenticated — an unauthed AI call would 401 and (pre-login)
    // there's no user to summarize anyway.
    var cached = load(AI_CACHE, null);
    if (TT.userId && !aiState.loading && (!cached || !cached.ts || (Date.now() - cached.ts) > AI_STALE_MS)) refreshAI();
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

  function renderAICard() {
    var cached = load(AI_CACHE, null);
    var data = (cached && cached.summary) ? cached : fallbackSummary(currentSnaps);
    var foot = aiState.loading ? 'Generating your summary…'
      : data.source === 'ai' ? 'Updated ' + relTime(cached && cached.ts) + ' · AI'
      : 'Quick summary · AI offline';

    var insights = (data.insights || []).map(function (i) { return '<span class="ai-chip">' + esc(i) + '</span>'; }).join('');
    aiCard.className = 'ai-card' + (aiState.loading ? ' loading' : '');
    aiCard.innerHTML =
      '<div class="ai-head">' +
        '<span class="ai-icon" aria-hidden="true">✨</span>' +
        '<span class="ai-title">Your summary</span>' +
        '<button class="ai-refresh" id="aiRefresh" aria-label="Refresh summary"' + (aiState.loading ? ' disabled' : '') + '>' +
          (aiState.loading ? '<span class="ai-spin" aria-hidden="true"></span> Generating' : '⟳ Refresh') +
        '</button>' +
      '</div>' +
      '<p class="ai-body">' + esc(data.summary) + '</p>' +
      (insights ? '<div class="ai-insights">' + insights + '</div>' : '') +
      '<p class="ai-foot">' + esc(foot) + '</p>';

    var btn = document.getElementById('aiRefresh');
    if (btn) btn.addEventListener('click', function () { refreshAI(true); });
  }

  // `manual` = user clicked Refresh (we capture it up front because re-rendering
  // the card on failure blows away focus, so we can't read activeElement later).
  function refreshAI(manual) {
    if (aiState.loading) return;
    aiState.loading = true;
    renderAICard();
    TT.ai.summarize(buildAISnapshot(currentSnaps))
      .then(function (res) {
        aiState.loading = false;
        store(AI_CACHE, { summary: res.summary, insights: res.insights, source: 'ai', ts: Date.now() });
        renderAICard();
      })
      .catch(function () {
        aiState.loading = false;
        renderAICard(); // graceful degradation: keep the deterministic fallback on screen
        if (manual) toast('AI summary unavailable — showing a quick summary', 'error');
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
