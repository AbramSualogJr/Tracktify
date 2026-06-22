/* ============================================================
   Tracktify — extras.js  (loads after custom.js, before dashboard.js)
   Two additive features, zero edits to the existing trackers:

   1) A small config-driven engine that ships several built-in trackers
      (Mood, Weight, Reading, Medications, Travel, Mindfulness, Screen Time).
      Each is described by a compact schema and rendered by ONE generic
      engine that reuses the app's existing markup/classes — so they look and
      behave exactly like the hand-written trackers. They appear on the
      dashboard automatically (it discovers trackers from the sidebar nav).

   2) Drag-to-reorder for the sidebar trackers. The chosen order is persisted
      via the normal data layer (key `tracktify-navorder`) so it syncs across
      devices like everything else.

   Storage: each tracker's entries live at `tracktify-<id>` as an array of
   { id, _title, <fieldId>:value, createdAt }. Field types mirror custom.js:
   text | number | date | select | checkbox | notes.
   ============================================================ */
(function () {
  'use strict';
  var TT = window.TT;
  if (!TT || !document.getElementById('sidebarNav')) return;
  var esc = TT.esc, uid = TT.uid, load = TT.load, store = TT.store, toast = TT.toast, fmtDate = TT.fmtDate;

  function todayStr() { return new Date().toISOString().slice(0, 10); }

  /* ============================================================
     Built-in tracker definitions
     - titleLabel  → show a required Title input (entry._title).
     - titleFrom   → otherwise derive _title from these field values.
     - stat(list)  → optional extra summary chips [{ n, l }].
  ============================================================ */
  var TRACKERS = [
    {
      id: 'mood', name: 'Mood', icon: '🧠', color: '#7c3aed', sub: 'How you feel, day by day',
      titleFrom: ['mood', 'date'],
      fields: [
        { id: 'date', label: 'Date', type: 'date' },
        { id: 'mood', label: 'Mood', type: 'select', options: ['😄 Great', '🙂 Good', '😐 Okay', '😟 Low', '😢 Bad'] },
        { id: 'energy', label: 'Energy', type: 'select', options: ['⚡ High', '🔋 Medium', '🪫 Low'] },
        { id: 'notes', label: 'What happened?', type: 'notes' }
      ]
    },
    {
      id: 'weight', name: 'Weight', icon: '⚖️', color: '#0891b2', sub: 'Track your body over time',
      titleFrom: ['weight', 'date'],
      fields: [
        { id: 'date', label: 'Date', type: 'date' },
        { id: 'weight', label: 'Weight', type: 'number' },
        { id: 'bodyfat', label: 'Body fat %', type: 'number' },
        { id: 'notes', label: 'Notes', type: 'notes' }
      ],
      stat: function (list) {
        if (!list.length) return [];
        var latest = list.slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : -1; })[0];
        var w = (latest && latest.weight !== '' && latest.weight != null) ? latest.weight : '—';
        return [{ n: w, l: 'latest' }];
      }
    },
    {
      id: 'reading', name: 'Reading', icon: '📚', color: '#16a34a', sub: 'Books & articles',
      titleLabel: 'Title', titlePlaceholder: 'e.g. Atomic Habits',
      fields: [
        { id: 'author', label: 'Author', type: 'text' },
        { id: 'status', label: 'Status', type: 'select', options: ['📖 Reading', '✅ Finished', '📌 To read', '⏸️ Paused'] },
        { id: 'rating', label: 'Rating (1–5)', type: 'number' },
        { id: 'pages', label: 'Pages', type: 'number' },
        { id: 'notes', label: 'Notes', type: 'notes' }
      ],
      stat: function (list) {
        return [{ n: list.filter(function (e) { return /Finished/.test(e.status || ''); }).length, l: 'finished' }];
      }
    },
    {
      id: 'meds', name: 'Medications', icon: '💊', color: '#dc2626', sub: 'Meds & supplements log',
      titleLabel: 'Name', titlePlaceholder: 'e.g. Vitamin D',
      fields: [
        { id: 'date', label: 'Date', type: 'date' },
        { id: 'dose', label: 'Dose', type: 'text' },
        { id: 'time', label: 'When', type: 'select', options: ['🌅 Morning', '☀️ Noon', '🌆 Evening', '🌙 Night'] },
        { id: 'taken', label: 'Taken', type: 'checkbox' },
        { id: 'notes', label: 'Notes', type: 'notes' }
      ],
      stat: function (list) {
        var t = todayStr();
        return [{ n: list.filter(function (e) { return e.date === t && e.taken; }).length, l: 'taken today' }];
      }
    },
    {
      id: 'travel', name: 'Travel', icon: '✈️', color: '#d97706', sub: 'Places you’ve been',
      titleLabel: 'Place', titlePlaceholder: 'e.g. Tokyo',
      fields: [
        { id: 'country', label: 'Country', type: 'text' },
        { id: 'start', label: 'From', type: 'date' },
        { id: 'end', label: 'To', type: 'date' },
        { id: 'rating', label: 'Rating (1–5)', type: 'number' },
        { id: 'notes', label: 'Notes', type: 'notes' }
      ]
    },
    {
      id: 'mindful', name: 'Mindfulness', icon: '🧘', color: '#0d9488', sub: 'Meditation & breathing',
      titleFrom: ['kind', 'date'],
      fields: [
        { id: 'date', label: 'Date', type: 'date' },
        { id: 'kind', label: 'Type', type: 'select', options: ['🧘 Meditation', '🌬️ Breathing', '🚶 Mindful walk', '📿 Other'] },
        { id: 'minutes', label: 'Minutes', type: 'number' },
        { id: 'notes', label: 'Notes', type: 'notes' }
      ],
      stat: function (list) {
        var wk = Date.now() - 7 * 86400000;
        var mins = list.filter(function (e) { return (e.createdAt || 0) >= wk; }).reduce(function (s, e) { return s + (parseFloat(e.minutes) || 0); }, 0);
        return [{ n: Math.round(mins), l: 'min this week' }];
      }
    },
    {
      id: 'screen', name: 'Screen Time', icon: '📱', color: '#2563eb', sub: 'Daily digital usage',
      titleFrom: ['hours', 'date'],
      fields: [
        { id: 'date', label: 'Date', type: 'date' },
        { id: 'hours', label: 'Hours', type: 'number' },
        { id: 'category', label: 'Mostly', type: 'select', options: ['📱 Social', '🎮 Gaming', '📺 Streaming', '💼 Work', '📚 Learning', '🔀 Mixed'] },
        { id: 'notes', label: 'Notes', type: 'notes' }
      ],
      stat: function (list) {
        var t = todayStr(), e = list.filter(function (x) { return x.date === t; })[0];
        return [{ n: (e && e.hours != null && e.hours !== '') ? e.hours + 'h' : '—', l: 'today' }];
      }
    }
  ];

  var byId = {};
  TRACKERS.forEach(function (t) { byId[t.id] = t; });
  var searchMap = {};

  // Trend-chart config for the time-series trackers: how to pull a number from
  // each entry. Mood maps its emoji scale to a 1–5 score.
  var MOODSCORE = { '😄 Great': 5, '🙂 Good': 4, '😐 Okay': 3, '😟 Low': 2, '😢 Bad': 1 };
  var CHARTS = {
    weight: { label: 'Weight trend', value: function (e) { return parseFloat(e.weight); } },
    screen: { label: 'Screen time (hours)', value: function (e) { return parseFloat(e.hours); } },
    mindful: { label: 'Minutes meditated', value: function (e) { return parseFloat(e.minutes); } },
    mood: { label: 'Mood trend (1–5)', value: function (e) { return MOODSCORE[e.mood]; } }
  };
  TRACKERS.forEach(function (t) { if (CHARTS[t.id]) t.chart = CHARTS[t.id]; });

  // Richer dashboard cards: Entries + This week + the tracker's own headline stat.
  TRACKERS.forEach(function (t) {
    TT.dashboard.register(t.id, function () {
      var list = load('tracktify-' + t.id, []); if (!Array.isArray(list)) list = [];
      var wk = Date.now() - 7 * 86400000;
      var stats = [
        { label: 'Entries', value: list.length, tone: '' },
        { label: 'This week', value: list.filter(function (e) { return (e.createdAt || 0) >= wk; }).length, tone: '' }
      ];
      if (t.stat) { try { (t.stat(list) || []).forEach(function (s) { stats.push({ label: s.l, value: s.n, tone: '' }); }); } catch (_) {} }
      var recent = list.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 5)
        .map(function (e) { return { title: e._title || '(entry)', ts: e.createdAt || 0, meta: '' }; });
      return {
        name: t.name, icon: t.icon, view: t.id, stats: stats.slice(0, 3), recent: recent, upcoming: [],
        headline: list.length ? list.length + (list.length === 1 ? ' entry' : ' entries') + ' in ' + t.name : ''
      };
    });
  });

  /* ============================================================
     Inject sidebar nav buttons + per-tracker view containers
  ============================================================ */
  var nav = document.getElementById('sidebarNav');
  var customNav = document.getElementById('customNav');
  var mainEl = document.querySelector('.main');

  TRACKERS.forEach(function (t) {
    if (!nav.querySelector('.nav-item[data-tracker="' + t.id + '"]')) {
      var btn = document.createElement('button');
      btn.className = 'nav-item';
      btn.setAttribute('data-tracker', t.id);
      btn.setAttribute('data-title', t.name);
      btn.innerHTML = '<span>' + t.icon + '</span> ' + esc(t.name);
      nav.insertBefore(btn, customNav);
    }
    if (mainEl && !document.getElementById('view-' + t.id)) {
      var view = document.createElement('div');
      view.id = 'view-' + t.id;
      view.hidden = true;
      view.innerHTML = '<div id="exmount-' + t.id + '"></div>';
      mainEl.appendChild(view);
    }
    TT.mobileAdd[t.id] = function () { openEntry(t, null); };
  });
  if (TT.bindNav) TT.bindNav();

  /* ============================================================
     Shared entry modal (injected once)
  ============================================================ */
  var holder = document.createElement('div');
  holder.innerHTML =
    '<div class="modal-wrap" id="exEntryWrap" role="dialog" aria-modal="true" aria-labelledby="exEntryTitle">' +
      '<div class="modal modal-sm">' +
        '<div class="modal-top"><h2 id="exEntryTitle">Add Entry</h2><button class="modal-x" id="exEntryClose" aria-label="Close">✕</button></div>' +
        '<form id="exEntryForm" novalidate><input type="hidden" name="id" />' +
          '<div id="exEntryFields"></div>' +
          '<div class="modal-btns"><button type="button" id="exEntryCancel">Cancel</button><button type="submit" class="submit">Save Entry</button></div>' +
        '</form>' +
      '</div>' +
    '</div>';
  document.body.appendChild(holder.firstChild);

  var modal = document.getElementById('exEntryWrap');
  var form = document.getElementById('exEntryForm');
  var fieldsMount = document.getElementById('exEntryFields');
  var curT = null, editId = null;

  function fieldControl(f, val) {
    var id = 'ex-' + f.id;
    if (f.type === 'number') return '<input id="' + id + '" type="number" step="any" value="' + esc(val != null ? val : '') + '" />';
    if (f.type === 'date') return '<input id="' + id + '" type="date" value="' + esc(val || '') + '" />';
    if (f.type === 'checkbox') return '<label class="switch-row"><input id="' + id + '" type="checkbox"' + (val ? ' checked' : '') + ' /> <span>Yes</span></label>';
    if (f.type === 'notes') return '<textarea id="' + id + '" rows="2">' + esc(val || '') + '</textarea>';
    if (f.type === 'select') return '<select id="' + id + '">' + (f.options || []).map(function (o) { return '<option value="' + esc(o) + '"' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    return '<input id="' + id + '" type="text" value="' + esc(val || '') + '" />';
  }

  function deriveTitle(t, rec) {
    if (t.titleLabel) return rec._title || '';
    var parts = (t.titleFrom || []).map(function (k) {
      var v = rec[k];
      if (v == null || v === '') return '';
      if (k === 'date' || k === 'start' || k === 'end') return fmtDate(v);
      return v;
    }).filter(Boolean);
    return parts.join(' · ') || (rec.date ? fmtDate(rec.date) : '') || 'Entry';
  }

  function openEntry(t, entry) {
    curT = t; editId = entry ? entry.id : null;
    document.getElementById('exEntryTitle').textContent = (entry ? 'Edit ' : 'Add ') + t.name;
    var html = '';
    if (t.titleLabel) {
      html += '<div class="field"><label for="ex-_title">' + esc(t.titleLabel) + ' <span class="req">*</span></label>' +
        '<input id="ex-_title" type="text" placeholder="' + esc(t.titlePlaceholder || '') + '" value="' + esc(entry ? entry._title : '') + '" required /></div>';
    }
    t.fields.forEach(function (f) {
      var v = entry ? entry[f.id] : (f.type === 'date' && f.id === 'date' ? todayStr() : undefined);
      html += '<div class="field"><label for="ex-' + f.id + '">' + esc(f.label) + '</label>' + fieldControl(f, v) + '</div>';
    });
    fieldsMount.innerHTML = html;
    modal.classList.add('open');
    setTimeout(function () {
      var first = document.getElementById(t.titleLabel ? 'ex-_title' : 'ex-' + t.fields[0].id);
      if (first) first.focus();
    }, 50);
  }
  function closeEntry() { modal.classList.remove('open'); editId = null; }

  document.getElementById('exEntryClose').addEventListener('click', closeEntry);
  document.getElementById('exEntryCancel').addEventListener('click', closeEntry);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeEntry(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeEntry(); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var t = curT; if (!t) return;
    var rec = {};
    if (t.titleLabel) {
      var tn = document.getElementById('ex-_title').value.trim();
      if (!tn) { document.getElementById('ex-_title').focus(); return; }
      rec._title = tn;
    }
    t.fields.forEach(function (f) {
      var el = document.getElementById('ex-' + f.id);
      if (!el) return;
      rec[f.id] = f.type === 'checkbox' ? el.checked : el.value;
    });
    if (!t.titleLabel) rec._title = deriveTitle(t, rec);
    var key = 'tracktify-' + t.id;
    var list = load(key, []); if (!Array.isArray(list)) list = [];
    if (editId) {
      var i = list.findIndex(function (x) { return x.id === editId; });
      if (i !== -1) list[i] = Object.assign({}, list[i], rec, { id: editId });
      toast('Entry updated');
    } else {
      list.push(Object.assign({ id: uid(), createdAt: Date.now() }, rec));
      toast('Saved', 'success');
    }
    store(key, list); closeEntry(); renderView(t);
  });

  /* ============================================================
     View render (header + summary + search + list)
  ============================================================ */
  function displayVal(f, v) {
    if (v == null || v === '') return '';
    if (f.type === 'checkbox') return v ? '✓' : '✗';
    if (f.type === 'date') return fmtDate(v);
    return v;
  }

  function summaryChips(t, list) {
    var c = '<div class="chip"><span class="chip-n" style="color:' + t.color + '">' + list.length + '</span><span class="chip-l">entries</span></div>';
    var wk = Date.now() - 7 * 86400000;
    var n = list.filter(function (e) { return (e.createdAt || 0) >= wk; }).length;
    c += '<div class="chip"><span class="chip-n" style="color:var(--accent)">' + n + '</span><span class="chip-l">this week</span></div>';
    if (t.stat) {
      try {
        (t.stat(list) || []).forEach(function (s) {
          c += '<div class="chip"><span class="chip-n" style="color:var(--accent)">' + esc(String(s.n)) + '</span><span class="chip-l">' + esc(s.l) + '</span></div>';
        });
      } catch (_) {}
    }
    return c;
  }

  /* ---- Inline SVG trend chart for time-series trackers ---- */
  function entryDate(e) {
    return e.date || e.start || (e.createdAt ? new Date(e.createdAt).toISOString().slice(0, 10) : '');
  }
  function fmtNum(n) { return (Math.round(n * 10) / 10).toString(); }
  function trendChart(t, list) {
    if (!t.chart) return '';
    var pts = list.map(function (e) {
      var v = t.chart.value(e), d = entryDate(e);
      return (v == null || isNaN(v) || !d) ? null : { d: d, v: v, ts: e.createdAt || 0 };
    }).filter(Boolean).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.ts - b.ts); }).slice(-30);
    if (pts.length < 2) return '';
    var W = 600, H = 120, P = 12, n = pts.length;
    var vals = pts.map(function (p) { return p.v; });
    var rmin = Math.min.apply(null, vals), rmax = Math.max.apply(null, vals);
    var min = rmin, max = rmax; if (min === max) { min -= 1; max += 1; }
    function X(i) { return P + (W - 2 * P) * (n === 1 ? 0.5 : i / (n - 1)); }
    function Y(v) { return P + (H - 2 * P) * (1 - (v - min) / (max - min)); }
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1); }).join(' ');
    var area = line + ' L' + X(n - 1).toFixed(1) + ' ' + (H - P) + ' L' + X(0).toFixed(1) + ' ' + (H - P) + ' Z';
    var dots = pts.map(function (p, i) { return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="2.5" fill="' + t.color + '" />'; }).join('');
    return '<div class="trend-card">' +
      '<div class="trend-head"><span class="trend-title">' + esc(t.chart.label || t.name) + '</span>' +
        '<span class="trend-range">' + esc(fmtDate(pts[0].d)) + ' → ' + esc(fmtDate(pts[n - 1].d)) + '</span></div>' +
      '<svg class="trend-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(t.chart.label || 'trend') + '">' +
        '<path d="' + area + '" fill="' + t.color + '" opacity="0.12" />' +
        '<path d="' + line + '" fill="none" stroke="' + t.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />' + dots +
      '</svg>' +
      '<div class="trend-foot"><span>min ' + fmtNum(rmin) + '</span><span>latest ' + fmtNum(pts[n - 1].v) + '</span><span>max ' + fmtNum(rmax) + '</span></div>' +
    '</div>';
  }

  function entryRow(t, e) {
    var li = document.createElement('li');
    li.className = 'exp-row';
    li.style.borderLeftColor = t.color;
    var notes = null;
    var pills = t.fields.map(function (f) {
      if (f.type === 'notes') { notes = e[f.id]; return ''; }
      var v = displayVal(f, e[f.id]);
      if (v === '') return '';
      return '<span class="cust-pill"><b>' + esc(f.label) + ':</b> ' + esc(v) + '</span>';
    }).filter(Boolean).join('');
    li.innerHTML =
      '<div class="exp-main"><div><div class="exp-desc">' + esc(e._title || '(entry)') + '</div>' +
        (pills ? '<div class="exp-meta">' + pills + '</div>' : '') +
        (notes ? '<div class="exp-notes">' + esc(notes) + '</div>' : '') + '</div></div>' +
      '<div class="exp-actions"><button class="ic-btn" data-a="edit" title="Edit">✏️</button><button class="ic-btn del" data-a="del" title="Delete">🗑️</button></div>';
    li.querySelector('[data-a="edit"]').addEventListener('click', function () { openEntry(t, e); });
    li.querySelector('[data-a="del"]').addEventListener('click', function () {
      if (!confirm('Delete "' + (e._title || 'this entry') + '"?')) return;
      var key = 'tracktify-' + t.id;
      store(key, load(key, []).filter(function (x) { return x.id !== e.id; }));
      renderView(t); toast('Entry deleted');
    });
    return li;
  }

  function renderList(t) {
    var ul = document.getElementById('exlist-' + t.id); if (!ul) return;
    var list = load('tracktify-' + t.id, []); if (!Array.isArray(list)) list = [];
    list = list.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    var q = searchMap[t.id] || '';
    if (q) list = list.filter(function (e) {
      var hay = ((e._title || '') + ' ' + t.fields.map(function (f) { return e[f.id]; }).join(' ')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    ul.innerHTML = '';
    list.forEach(function (e) { ul.appendChild(entryRow(t, e)); });
    if (!list.length && q) ul.innerHTML = '<p class="no-match">No matching entries.</p>';
  }

  function renderView(t) {
    var mount = document.getElementById('exmount-' + t.id); if (!mount) return;
    var list = load('tracktify-' + t.id, []); if (!Array.isArray(list)) list = [];
    var q = searchMap[t.id] || '';
    mount.innerHTML =
      '<div class="page-top"><div><h1>' + t.icon + ' ' + esc(t.name) + '</h1><p>' + esc(t.sub || '') + '</p></div>' +
        '<div class="page-top-right"><button class="btn-add" data-a="add">+ Add</button></div></div>' +
      '<div class="summary">' + summaryChips(t, list) + '</div>' +
      trendChart(t, list) +
      '<input class="txn-search" id="exsearch-' + t.id + '" type="search" placeholder="🔍  Search entries..." value="' + esc(q) + '" style="margin-bottom:14px" />' +
      '<div class="empty' + (list.length ? '' : ' show') + '"><div class="empty-icon">' + t.icon + '</div><h2>No entries yet</h2>' +
        '<p>Add your first ' + esc(t.name) + ' entry.</p><button class="btn-add" data-a="add2">+ Add</button></div>' +
      '<ul class="item-list" id="exlist-' + t.id + '"></ul>';
    mount.querySelector('[data-a="add"]').addEventListener('click', function () { openEntry(t, null); });
    var a2 = mount.querySelector('[data-a="add2"]'); if (a2) a2.addEventListener('click', function () { openEntry(t, null); });
    var se = document.getElementById('exsearch-' + t.id);
    se.addEventListener('input', function () { searchMap[t.id] = se.value.toLowerCase(); renderList(t); });
    renderList(t);
  }

  document.addEventListener('tt:view', function (e) { var t = byId[e.detail]; if (t) renderView(t); });
  document.addEventListener('tt:theme', function () { var t = byId[TT.view]; if (t) renderView(t); });

  /* ============================================================
     Sidebar trackers: sort modes + favorites + drag-to-reorder.
     ALL trackers are treated identically — built-in, new, and custom. Custom
     trackers normally live inside #customNav; we lift them out so every
     tracker is a direct sibling and participates in one ordered list.

     State (all synced via the data layer):
       tracktify-navsort  → 'az' | 'za' | 'fav' | 'custom'   (default 'az')
       tracktify-navfavs  → [ navKey, ... ]
       tracktify-navorder → [ navKey, ... ]   (used by the 'custom' mode)
     Dashboard (the home view) stays pinned at top; New Tracker stays at the
     bottom — everything between them sorts/reorders freely.
  ============================================================ */
  function keyOf(it) {
    var c = it.getAttribute('data-custom-id'), tr = it.getAttribute('data-tracker');
    return c ? tr + ':' + c : tr;
  }
  function labelOf(it) {
    var ic = it.querySelector('span'), t = it.textContent || '';
    if (ic) t = t.replace(ic.textContent, '');           // strip the leading icon
    return t.replace(/\s+/g, ' ').trim().toLowerCase();  // star/grip are pseudo-elements → no text
  }
  // The sortable group = every tracker nav-item except Dashboard.
  function groupItems() {
    return Array.prototype.filter.call(nav.querySelectorAll('.nav-item[data-tracker]'), function (it) {
      return it.getAttribute('data-tracker') !== 'dashboard';
    });
  }

  function getSort() { return load('tracktify-navsort', 'az') || 'az'; }
  function setSort(v) { store('tracktify-navsort', v); var s = document.getElementById('navSort'); if (s) s.value = v; }
  function getFavs() { var f = load('tracktify-navfavs', []); return Array.isArray(f) ? f : []; }
  function isFav(k) { return getFavs().indexOf(k) >= 0; }
  function toggleFav(k) { var f = getFavs(), i = f.indexOf(k); if (i >= 0) f.splice(i, 1); else f.push(k); store('tracktify-navfavs', f); }

  // Lift custom-tracker buttons out of #customNav so they're direct siblings
  // of the built-ins (run after custom.js (re)renders its nav).
  function normalizeCustoms() {
    Array.prototype.forEach.call(nav.querySelectorAll(':scope > .nav-item[data-custom-id]'), function (b) { b.remove(); });
    Array.prototype.forEach.call(customNav.querySelectorAll('.nav-item[data-custom-id]'), function (b) { nav.insertBefore(b, customNav); });
  }

  // Ensure every group item has a favorite-star button and a drag grip.
  function ensureControls() {
    groupItems().forEach(function (it) {
      var star = it.querySelector('.nav-fav');
      if (!star) {
        star = document.createElement('button');
        star.type = 'button';
        star.className = 'nav-fav';
        star.setAttribute('aria-label', 'Toggle favorite');
        star.setAttribute('tabindex', '-1');
        star.addEventListener('click', function (e) {
          e.stopPropagation(); e.preventDefault();      // don't navigate
          var k = keyOf(it);
          toggleFav(k);
          star.classList.toggle('on', isFav(k));
          if (getSort() === 'fav') applySort();
        });
        it.appendChild(star);
      }
      star.classList.toggle('on', isFav(keyOf(it)));
      if (!it.querySelector('.nav-grip')) {
        var grip = document.createElement('button');
        grip.type = 'button';
        grip.className = 'nav-grip';
        grip.setAttribute('aria-label', 'Drag to reorder');
        grip.setAttribute('tabindex', '-1');
        grip.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); });
        it.appendChild(grip);
      }
    });
  }

  function sortedItems() {
    var items = groupItems(), mode = getSort(), favs = getFavs();
    function byLabel(a, b) { var la = labelOf(a), lb = labelOf(b); return la < lb ? -1 : la > lb ? 1 : 0; }
    if (mode === 'za') return items.sort(byLabel).reverse();
    if (mode === 'fav') return items.sort(function (a, b) {
      var fa = favs.indexOf(keyOf(a)) >= 0, fb = favs.indexOf(keyOf(b)) >= 0;
      return fa !== fb ? (fa ? -1 : 1) : byLabel(a, b);
    });
    if (mode === 'custom') {
      var order = load('tracktify-navorder', []); if (!Array.isArray(order)) order = [];
      return items.sort(function (a, b) {
        var ia = order.indexOf(keyOf(a)), ib = order.indexOf(keyOf(b));
        return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
      });
    }
    return items.sort(byLabel); // 'az' (default)
  }
  function applySort() { sortedItems().forEach(function (it) { nav.insertBefore(it, customNav); }); }

  // Re-run after any nav (re)bind — including custom.js adding/removing trackers.
  var _bindNav = TT.bindNav;
  TT.bindNav = function () { if (_bindNav) _bindNav(); normalizeCustoms(); ensureControls(); applySort(); };

  /* ---- drag-to-reorder via the grip (pointer events: mouse + touch) ----
     Dragging starts only from the grip handle (which has touch-action:none), so
     touch users can still scroll the sidebar normally everywhere else. A manual
     reorder switches the sort to 'custom' and persists the new order. ---- */
  var dragEl = null, dragging = false, ptrId = null, startY = 0;
  function commitOrder() { setSort('custom'); store('tracktify-navorder', groupItems().map(keyOf)); }
  function suppressNextClick(el) {
    var h = function (ev) { ev.stopPropagation(); ev.preventDefault(); el.removeEventListener('click', h, true); };
    el.addEventListener('click', h, true);
    setTimeout(function () { el.removeEventListener('click', h, true); }, 400);
  }
  nav.addEventListener('pointerdown', function (e) {
    var grip = e.target && e.target.closest ? e.target.closest('.nav-grip') : null;
    if (!grip) return;
    var it = grip.closest('.nav-item[data-tracker]');
    if (!it || it.parentNode !== nav || it.getAttribute('data-tracker') === 'dashboard') return;
    dragEl = it; ptrId = e.pointerId; startY = e.clientY; dragging = false;
    try { grip.setPointerCapture(ptrId); } catch (_) {}
    e.preventDefault();
  });
  nav.addEventListener('pointermove', function (e) {
    if (!dragEl || e.pointerId !== ptrId) return;
    if (!dragging) {
      if (Math.abs(e.clientY - startY) < 5) return;        // ignore tiny jitters
      dragging = true; dragEl.classList.add('dragging'); document.body.style.userSelect = 'none';
    }
    e.preventDefault();
    var under = document.elementFromPoint(e.clientX, e.clientY);
    var over = under && under.closest ? under.closest('.nav-item[data-tracker]') : null;
    if (over && over.parentNode === nav && over !== dragEl && over.getAttribute('data-tracker') !== 'dashboard') {
      var r = over.getBoundingClientRect();
      if ((e.clientY - r.top) / r.height > 0.5) over.after(dragEl); else over.before(dragEl);
    }
  });
  function endDrag(e) {
    if (!dragEl || (e && e.pointerId !== ptrId)) return;
    var was = dragging, el = dragEl;
    if (dragging) { dragEl.classList.remove('dragging'); document.body.style.userSelect = ''; }
    dragEl = null; dragging = false; ptrId = null;
    if (was) { commitOrder(); suppressNextClick(el); }
  }
  nav.addEventListener('pointerup', endDrag);
  nav.addEventListener('pointercancel', endDrag);

  /* ---- sort dropdown in the sidebar header ---- */
  (function injectSortControl() {
    var label = document.querySelector('.nav-label');
    if (!label || document.getElementById('navSort')) return;
    var head = document.createElement('div');
    head.className = 'nav-head';
    label.parentNode.insertBefore(head, label);
    head.appendChild(label);
    var sel = document.createElement('select');
    sel.className = 'nav-sort';
    sel.id = 'navSort';
    sel.innerHTML =
      '<option value="az">A–Z</option>' +
      '<option value="za">Z–A</option>' +
      '<option value="fav">★ Favorites</option>' +
      '<option value="custom">Custom order</option>';
    sel.value = getSort();
    sel.addEventListener('change', function () { setSort(sel.value); applySort(); });
    head.appendChild(sel);
  })();

  // Initial pass: bind handlers, lift customs, add controls, apply the sort.
  TT.bindNav();
})();
