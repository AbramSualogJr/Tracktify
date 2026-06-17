/* ============================================================
   Tracktify — Events (calendar) module
   Views: Month · Week · Day · Agenda
   Depends on window.TT (esc, uid, load, store, toast, fmtDate).
   ============================================================ */
(function () {
  'use strict';
  if (!document.getElementById('view-events')) return;

  var TT  = window.TT;
  var esc = TT.esc, uid = TT.uid, load = TT.load, store = TT.store, toast = TT.toast;

  /* ============================================================
     Defaults & state
  ============================================================ */
  var DEFAULT_LABELS = [
    { id: 'personal', name: 'Personal', color: '#7c3aed' },
    { id: 'work',     name: 'Work',     color: '#2563eb' },
    { id: 'school',   name: 'School',   color: '#0891b2' },
    { id: 'meeting',  name: 'Meeting',  color: '#d97706' },
    { id: 'health',   name: 'Health',   color: '#db2777' },
    { id: 'family',   name: 'Family',   color: '#16a34a' },
    { id: 'holiday',  name: 'Holiday',  color: '#dc2626' },
    { id: 'travel',   name: 'Travel',   color: '#0d9488' }
  ];
  var SWATCHES = ['#7c3aed','#2563eb','#0891b2','#0d9488','#16a34a','#65a30d',
                  '#ca8a04','#d97706','#dc2626','#db2777','#9333ea','#64748b'];
  var REMINDER_OPTS = [
    { v: 0, l: 'At time of event' }, { v: 5, l: '5 minutes before' },
    { v: 15, l: '15 minutes before' }, { v: 30, l: '30 minutes before' },
    { v: 60, l: '1 hour before' }, { v: 1440, l: '1 day before' }, { v: 'custom', l: 'Custom…' }
  ];
  var HOUR_PX = 48, SNAP = 15;
  var DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  var events   = load('tracktify-events', []);
  var labels   = load('tracktify-event-labels', null) || JSON.parse(JSON.stringify(DEFAULT_LABELS));
  var evSet    = load('tracktify-event-settings', null) || { timeFormat: '24', weekStart: 0 };

  var state = {
    view: 'month',
    cursor: stripTime(new Date()),
    selected: stripTime(new Date()),
    search: '',
    activeLabels: new Set(labels.map(function (l) { return l.id; })),
    pendingReminders: []   // reminders being edited in modal
  };
  var firedReminders = {}; // session de-dupe

  function saveEvents() { store('tracktify-events', events); }
  function saveLabels() { store('tracktify-event-labels', labels); }
  function saveSettings() { store('tracktify-event-settings', evSet); }

  /* ============================================================
     Date helpers
  ============================================================ */
  function pad(n) { return String(n).padStart(2, '0'); }
  function stripTime(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDT(s) {
    if (!s) return null;
    var p = String(s).split('T'), d = p[0].split('-');
    var date = new Date(+d[0], +d[1] - 1, +d[2]);
    if (p[1]) { var t = p[1].split(':'); date.setHours(+t[0] || 0, +t[1] || 0, 0, 0); }
    return date;
  }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function startOfWeek(d) { var x = stripTime(d); var diff = (x.getDay() - evSet.weekStart + 7) % 7; return addDays(x, -diff); }
  function minutesOfDay(d) { return d.getHours() * 60 + d.getMinutes(); }
  function fmtTime(d) {
    var h = d.getHours(), m = d.getMinutes();
    if (evSet.timeFormat === '24') return pad(h) + ':' + pad(m);
    var ap = h < 12 ? 'AM' : 'PM', h12 = h % 12 || 12;
    return h12 + (m ? ':' + pad(m) : '') + ' ' + ap;
  }
  function fmtTimeMin(min) { var d = new Date(); d.setHours(Math.floor(min / 60), min % 60, 0, 0); return fmtTime(d); }
  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    return 'rgba(' + parseInt(h.slice(0,2),16) + ',' + parseInt(h.slice(2,4),16) + ',' + parseInt(h.slice(4,6),16) + ',' + a + ')';
  }
  function labelOf(id) { for (var i = 0; i < labels.length; i++) if (labels[i].id === id) return labels[i]; return null; }
  function eventColor(ev) { if (ev.color) return ev.color; var l = labelOf(ev.label); return l ? l.color : '#7c3aed'; }

  /* ============================================================
     Recurrence expansion → occurrences in [from,to]
  ============================================================ */
  function stepDate(d, freq) {
    var x = new Date(d);
    if (freq === 'daily') x.setDate(x.getDate() + 1);
    else if (freq === 'weekly') x.setDate(x.getDate() + 7);
    else if (freq === 'monthly') x.setMonth(x.getMonth() + 1);
    else if (freq === 'yearly') x.setFullYear(x.getFullYear() + 1);
    return x;
  }
  function occInstance(ev, s, e) {
    return { base: ev, id: ev.id, occKey: ev.id + '@' + dateKey(s), title: ev.title, allDay: ev.allDay,
      label: ev.label, color: eventColor(ev), location: ev.location, description: ev.description,
      recurring: ev.recurrence && ev.recurrence !== 'none', s: s, e: e };
  }
  function getOccurrences(from, to) {
    var out = [];
    var fromMs = from.getTime(), toMs = to.getTime();
    events.forEach(function (ev) {
      if (!state.activeLabels.has(ev.label) && labelOf(ev.label)) return; // label filter (unlabeled always shown)
      if (state.search) {
        var hay = (ev.title + ' ' + (ev.description || '') + ' ' + (ev.location || '')).toLowerCase();
        if (hay.indexOf(state.search) === -1) return;
      }
      var s0 = parseDT(ev.start), e0 = parseDT(ev.end || ev.start);
      if (!s0) return;
      if (e0 < s0) e0 = new Date(s0);
      var dur = e0 - s0;
      if (!ev.recurrence || ev.recurrence === 'none') {
        if (e0.getTime() >= fromMs && s0.getTime() <= toMs) out.push(occInstance(ev, s0, e0));
        return;
      }
      var until = ev.until ? parseDT(ev.until) : null;
      var cur = new Date(s0), guard = 0;
      while (cur.getTime() <= toMs && guard < 800) {
        var ce = new Date(cur.getTime() + dur);
        if (ce.getTime() >= fromMs && (!until || cur <= until)) out.push(occInstance(ev, new Date(cur), ce));
        if (until && cur > until) break;
        cur = stepDate(cur, ev.recurrence); guard++;
      }
    });
    return out;
  }

  /* ============================================================
     DOM refs
  ============================================================ */
  var elBody = document.getElementById('evBody');
  var elRange = document.getElementById('evRange');
  var elMini = document.getElementById('evMini');
  var elSidebar = document.getElementById('evSidebar');
  var elLabelList = document.getElementById('evLabelList');
  var elTodayList = document.getElementById('evTodayList');
  var elUpcoming = document.getElementById('evUpcomingList');
  var elSearch = document.getElementById('evSearch');
  var elFormat = document.getElementById('evFormat');

  /* ============================================================
     Toolbar / nav
  ============================================================ */
  document.querySelectorAll('#evViewToggle .seg').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.getAttribute('data-evview')); });
  });
  function setView(v) {
    state.view = v;
    document.querySelectorAll('#evViewToggle .seg').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-evview') === v); });
    render();
  }
  document.getElementById('evPrev').addEventListener('click', function () { nav(-1); });
  document.getElementById('evNext').addEventListener('click', function () { nav(1); });
  document.getElementById('evTodayBtn').addEventListener('click', function () { state.cursor = stripTime(new Date()); state.selected = stripTime(new Date()); render(); });
  function nav(dir) {
    if (state.view === 'month') state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + dir, 1);
    else if (state.view === 'week') state.cursor = addDays(state.cursor, dir * 7);
    else if (state.view === 'day') state.cursor = addDays(state.cursor, dir);
    else state.cursor = addDays(state.cursor, dir * 30);
    render();
  }
  elFormat.addEventListener('click', function () {
    evSet.timeFormat = evSet.timeFormat === '24' ? '12' : '24'; saveSettings();
    elFormat.textContent = evSet.timeFormat === '24' ? '24h' : '12h';
    render();
  });
  elFormat.textContent = evSet.timeFormat === '24' ? '24h' : '12h';

  elSearch.addEventListener('input', function () { state.search = elSearch.value.toLowerCase(); render(); });
  document.getElementById('evSideToggle').addEventListener('click', function () { elSidebar.classList.toggle('open'); });
  document.getElementById('evAddBtn').addEventListener('click', function () { openEventModal(null); });
  document.getElementById('evQuickAdd').addEventListener('click', function () { openEventModal(null); });
  TT.mobileAdd.events = function () { openEventModal(null); };

  /* ============================================================
     MAIN RENDER
  ============================================================ */
  function render() {
    renderMini();
    renderLabels();
    renderSidebarLists();
    if (state.view === 'month') renderMonth();
    else if (state.view === 'agenda') renderAgenda();
    else renderTimeline();
  }

  /* ---- Month view ---- */
  function renderMonth() {
    var y = state.cursor.getFullYear(), m = state.cursor.getMonth();
    elRange.textContent = state.cursor.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    var first = startOfWeek(new Date(y, m, 1));
    var occ = getOccurrences(first, addDays(first, 42));
    var byDay = {};
    occ.forEach(function (o) {
      var d = stripTime(o.s), last = stripTime(o.e);
      for (var dd = new Date(d); dd <= last; dd = addDays(dd, 1)) { (byDay[dateKey(dd)] = byDay[dateKey(dd)] || []).push(o); }
    });

    var head = '<div class="mv-grid mv-head">' + orderedDow().map(function (d) { return '<div class="mv-dow">' + d + '</div>'; }).join('') + '</div>';
    var cells = '';
    var today = stripTime(new Date());
    for (var i = 0; i < 42; i++) {
      var cd = addDays(first, i), key = dateKey(cd);
      var list = (byDay[key] || []).slice().sort(evSort);
      var chips = list.slice(0, 3).map(monthChip).join('');
      var more = list.length > 3 ? '<div class="mv-more">+' + (list.length - 3) + ' more</div>' : '';
      cells += '<div class="mv-cell' + (cd.getMonth() !== m ? ' mv-other' : '') + (sameDay(cd, today) ? ' mv-today' : '') + '" data-date="' + key + '">' +
        '<div class="mv-daynum">' + cd.getDate() + '</div><div class="mv-events">' + chips + more + '</div></div>';
    }
    elBody.innerHTML = '<div class="mv-wrap">' + head + '<div class="mv-grid mv-body">' + cells + '</div></div>';

    elBody.querySelectorAll('.mv-cell').forEach(function (cell) {
      var key = cell.getAttribute('data-date');
      cell.addEventListener('click', function (e) { if (e.target.closest('.mv-chip')) return; });
      cell.addEventListener('dblclick', function (e) { if (e.target.closest('.mv-chip')) return; openEventModal(null, { date: key }); });
      // drag-drop target
      cell.addEventListener('dragover', function (e) { e.preventDefault(); cell.classList.add('drag-over'); });
      cell.addEventListener('dragleave', function () { cell.classList.remove('drag-over'); });
      cell.addEventListener('drop', function (e) {
        e.preventDefault(); cell.classList.remove('drag-over');
        var id = e.dataTransfer.getData('text/plain'); moveEventToDate(id, key);
      });
    });
    bindChips();
  }
  function orderedDow() { var a = []; for (var i = 0; i < 7; i++) a.push(DOW[(evSet.weekStart + i) % 7]); return a; }
  function evSort(a, b) { if (a.allDay !== b.allDay) return a.allDay ? -1 : 1; return a.s - b.s; }

  function monthChip(o) {
    var col = o.color;
    if (o.allDay) {
      return '<div class="mv-chip allday" draggable="' + (!o.recurring) + '" data-id="' + o.id + '" style="background:' + col + '">' +
        (o.recurring ? '🔁 ' : '') + esc(o.title) + '</div>';
    }
    return '<div class="mv-chip timed" draggable="' + (!o.recurring) + '" data-id="' + o.id + '">' +
      '<span class="mv-cdot" style="background:' + col + '"></span><span class="mv-ctime">' + fmtTime(o.s) + '</span> ' + esc(o.title) + '</div>';
  }

  function bindChips() {
    elBody.querySelectorAll('.mv-chip').forEach(function (chip) {
      var id = chip.getAttribute('data-id');
      chip.addEventListener('click', function (e) { e.stopPropagation(); openEventById(id); });
      chip.addEventListener('contextmenu', function (e) { e.preventDefault(); showCtx(e, id); });
      chip.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; });
    });
  }
  function moveEventToDate(id, key) {
    var ev = events.find(function (x) { return x.id === id; });
    if (!ev) return;
    var s = parseDT(ev.start), e = parseDT(ev.end || ev.start), dur = e - s;
    var nd = parseDT(key);
    var ns = new Date(nd.getFullYear(), nd.getMonth(), nd.getDate(), s.getHours(), s.getMinutes());
    var ne = new Date(ns.getTime() + dur);
    ev.start = serialize(ns, ev.allDay); ev.end = serialize(ne, ev.allDay);
    saveEvents(); render(); toast('Event moved');
  }
  function serialize(d, allDay) { return allDay ? dateKey(d) : dateKey(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  /* ---- Timeline (week / day) ---- */
  function renderTimeline() {
    var days = state.view === 'day' ? [stripTime(state.cursor)] : [];
    if (state.view === 'week') { var sow = startOfWeek(state.cursor); for (var i = 0; i < 7; i++) days.push(addDays(sow, i)); }

    if (state.view === 'day') elRange.textContent = state.cursor.toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    else { var a = days[0], b = days[6]; elRange.textContent = a.toLocaleString('en-US', { month: 'short', day: 'numeric' }) + ' – ' + b.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

    var from = days[0], to = addDays(days[days.length - 1], 1);
    var occ = getOccurrences(from, to);
    var allDayOcc = occ.filter(function (o) { return o.allDay; });
    var timedOcc = occ.filter(function (o) { return !o.allDay; });

    // header
    var today = stripTime(new Date());
    var colHead = '<div class="tl-corner"></div>' + days.map(function (d) {
      return '<div class="tl-dayhead' + (sameDay(d, today) ? ' is-today' : '') + '" data-date="' + dateKey(d) + '">' +
        '<span class="tl-dow">' + DOW[d.getDay()] + '</span><span class="tl-dnum">' + d.getDate() + '</span></div>';
    }).join('');

    // all-day row
    var allDayCells = '<div class="tl-allday-label">all-day</div>' + days.map(function (d) {
      var items = allDayOcc.filter(function (o) { return stripTime(o.s) <= d && stripTime(o.e) >= d; });
      return '<div class="tl-allday-cell" data-date="' + dateKey(d) + '">' + items.map(function (o) {
        return '<div class="tl-allday-chip" data-id="' + o.id + '" style="background:' + o.color + '">' + (o.recurring ? '🔁 ' : '') + esc(o.title) + '</div>';
      }).join('') + '</div>';
    }).join('');

    // hour gutter + columns
    var gutter = '';
    for (var h = 0; h < 24; h++) gutter += '<div class="tl-hour"><span>' + hourLabel(h) + '</span></div>';
    var cols = days.map(function (d) {
      return '<div class="tl-col" data-date="' + dateKey(d) + '" style="height:' + (24 * HOUR_PX) + 'px"></div>';
    }).join('');

    elBody.innerHTML =
      '<div class="tl-wrap">' +
        '<div class="tl-header" style="grid-template-columns:54px repeat(' + days.length + ',1fr)">' + colHead + '</div>' +
        '<div class="tl-allday" style="grid-template-columns:54px repeat(' + days.length + ',1fr)">' + allDayCells + '</div>' +
        '<div class="tl-scroll"><div class="tl-body" style="grid-template-columns:54px repeat(' + days.length + ',1fr)">' +
          '<div class="tl-gutter" style="height:' + (24 * HOUR_PX) + 'px">' + gutter + '</div>' + cols +
        '</div></div>' +
      '</div>';

    // place timed events per column
    days.forEach(function (d) {
      var col = elBody.querySelector('.tl-col[data-date="' + dateKey(d) + '"]');
      var dayItems = timedOcc.filter(function (o) { return sameDay(o.s, d); });
      layoutDay(dayItems).forEach(function (o) {
        col.appendChild(timedBlock(o));
      });
    });

    // now indicator
    placeNow(days);
    bindTimelineInteractions(days);
    bindChips();
    // scroll to ~7am
    var sc = elBody.querySelector('.tl-scroll'); if (sc) sc.scrollTop = 7 * HOUR_PX;
  }
  function hourLabel(h) {
    if (evSet.timeFormat === '24') return pad(h) + ':00';
    var ap = h < 12 ? 'AM' : 'PM', h12 = h % 12 || 12; return h12 + ' ' + ap;
  }

  function layoutDay(items) {
    items.sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    var groups = [], cur = [];
    var curEnd = 0;
    items.forEach(function (it) {
      if (cur.length && it.s.getTime() >= curEnd) { groups.push(cur); cur = []; curEnd = 0; }
      cur.push(it); curEnd = Math.max(curEnd, it.e.getTime());
    });
    if (cur.length) groups.push(cur);
    groups.forEach(function (g) {
      var lanes = [];
      g.forEach(function (it) {
        var placed = false;
        for (var i = 0; i < lanes.length; i++) {
          if (it.s.getTime() >= lanes[i]) { it._lane = i; lanes[i] = it.e.getTime(); placed = true; break; }
        }
        if (!placed) { it._lane = lanes.length; lanes.push(it.e.getTime()); }
      });
      g.forEach(function (it) { it._lanes = lanes.length; });
    });
    return items;
  }

  function timedBlock(o) {
    var startMin = minutesOfDay(o.s);
    var endMin = sameDay(o.s, o.e) ? minutesOfDay(o.e) : 24 * 60;
    var top = startMin / 60 * HOUR_PX, hgt = Math.max(18, (endMin - startMin) / 60 * HOUR_PX);
    var lane = o._lane || 0, lanes = o._lanes || 1;
    var w = 100 / lanes;
    var el = document.createElement('div');
    el.className = 'tl-event' + (o.recurring ? ' is-recurring' : '');
    el.setAttribute('data-id', o.id);
    el.style.top = top + 'px'; el.style.height = hgt + 'px';
    el.style.left = (lane * w) + '%'; el.style.width = 'calc(' + w + '% - 4px)';
    el.style.background = hexA(o.color, 0.16); el.style.borderLeft = '3px solid ' + o.color;
    el.innerHTML = '<div class="te-title" style="color:' + o.color + '">' + (o.recurring ? '🔁 ' : '') + esc(o.title) + '</div>' +
      '<div class="te-time">' + fmtTime(o.s) + (hgt > 32 ? ' – ' + fmtTime(o.e) : '') + '</div>' +
      (o.recurring ? '' : '<div class="te-resize"></div>');
    return el;
  }

  function placeNow(days) {
    var now = new Date();
    var idx = -1; days.forEach(function (d, i) { if (sameDay(d, now)) idx = i; });
    if (idx === -1) return;
    var col = elBody.querySelectorAll('.tl-col')[idx];
    if (!col) return;
    var line = document.createElement('div');
    line.className = 'tl-now'; line.id = 'tlNow';
    line.style.top = (minutesOfDay(now) / 60 * HOUR_PX) + 'px';
    line.innerHTML = '<span class="tl-now-dot"></span>';
    col.appendChild(line);
  }

  /* ---- Agenda ---- */
  function renderAgenda() {
    elRange.textContent = 'Agenda';
    var from = stripTime(new Date()), to = addDays(from, 60);
    var occ = getOccurrences(from, to).sort(function (a, b) { return a.s - b.s; });
    if (!occ.length) { elBody.innerHTML = '<div class="empty show"><div class="empty-icon">📅</div><h2>No upcoming events</h2><p>Nothing scheduled in the next 60 days.</p></div>'; return; }
    var byDate = {};
    occ.forEach(function (o) { var k = dateKey(o.s); (byDate[k] = byDate[k] || []).push(o); });
    var html = '<div class="agenda">';
    Object.keys(byDate).sort().forEach(function (k) {
      var d = parseDT(k);
      var isToday = sameDay(d, new Date());
      html += '<div class="ag-group"><div class="ag-date' + (isToday ? ' is-today' : '') + '">' +
        '<span class="ag-dnum">' + d.getDate() + '</span><span class="ag-dinfo">' + d.toLocaleString('en-US', { weekday: 'long' }) + '<small>' + d.toLocaleString('en-US', { month: 'short', year: 'numeric' }) + '</small></span></div>' +
        '<div class="ag-items">' + byDate[k].map(function (o) {
          return '<div class="ag-item" data-id="' + o.id + '" style="border-left-color:' + o.color + '">' +
            '<span class="ag-time">' + (o.allDay ? 'All day' : fmtTime(o.s) + ' – ' + fmtTime(o.e)) + '</span>' +
            '<span class="ag-title">' + (o.recurring ? '🔁 ' : '') + esc(o.title) + (o.location ? ' <span class="ag-loc">📍 ' + esc(o.location) + '</span>' : '') + '</span>' +
            '<span class="ag-dot" style="background:' + o.color + '"></span></div>';
        }).join('') + '</div></div>';
    });
    html += '</div>';
    elBody.innerHTML = html;
    elBody.querySelectorAll('.ag-item').forEach(function (it) {
      var id = it.getAttribute('data-id');
      it.addEventListener('click', function () { openEventById(id); });
      it.addEventListener('contextmenu', function (e) { e.preventDefault(); showCtx(e, id); });
    });
  }

  /* ============================================================
     Timeline interactions: create / move / resize
  ============================================================ */
  function bindTimelineInteractions(days) {
    if (elBody._tlCleanup) elBody._tlCleanup();
    var drag = null;

    elBody.querySelectorAll('.tl-col').forEach(function (col) {
      // double-click empty → create at hour
      col.addEventListener('dblclick', function (e) {
        if (e.target.closest('.tl-event')) return;
        var min = yToMin(e.clientY - col.getBoundingClientRect().top);
        openEventModal(null, { date: col.getAttribute('data-date'), startMin: min, endMin: min + 60 });
      });
      // mousedown to drag-create
      col.addEventListener('mousedown', function (e) {
        if (e.button !== 0 || e.target.closest('.tl-event')) return;
        var rect = col.getBoundingClientRect();
        var startMin = yToMin(e.clientY - rect.top);
        drag = { mode: 'create', col: col, date: col.getAttribute('data-date'), startMin: startMin, endMin: startMin + SNAP, moved: false };
        var ghost = document.createElement('div'); ghost.className = 'tl-ghost'; col.appendChild(ghost);
        drag.ghost = ghost; updateGhost(drag);
        e.preventDefault();
      });
    });

    // move + resize existing
    elBody.querySelectorAll('.tl-event').forEach(function (block) {
      var id = block.getAttribute('data-id');
      if (block.classList.contains('is-recurring')) return; // series edited via modal
      block.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.stopPropagation();
        var col = block.parentElement, rect = col.getBoundingClientRect();
        var isResize = !!e.target.closest('.te-resize');
        var ev = events.find(function (x) { return x.id === id; });
        if (!ev) return;
        var s = parseDT(ev.start), en = parseDT(ev.end || ev.start);
        drag = { mode: isResize ? 'resize' : 'move', id: id, ev: ev, block: block, col: col,
          startMin: minutesOfDay(s), endMin: minutesOfDay(en), dur: minutesOfDay(en) - minutesOfDay(s),
          grab: e.clientY - rect.top - (minutesOfDay(s) / 60 * HOUR_PX), date: col.getAttribute('data-date'), moved: false };
        block.classList.add('dragging');
        e.preventDefault();
      });
    });

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    // store cleanup on next render by replacing listeners (they reference fresh drag via closure of this render)
    elBody._tlCleanup = function () { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };

    function onMove(e) {
      if (!drag) return;
      drag.moved = true;
      if (drag.mode === 'create') {
        var rect = drag.col.getBoundingClientRect();
        drag.endMin = yToMin(e.clientY - rect.top);
        updateGhost(drag);
      } else if (drag.mode === 'move') {
        var targetCol = document.elementFromPoint(e.clientX, e.clientY);
        targetCol = targetCol && targetCol.closest ? targetCol.closest('.tl-col') : null;
        if (targetCol) { drag.col = targetCol; drag.date = targetCol.getAttribute('data-date'); drag.col.appendChild(drag.block); }
        var r = drag.col.getBoundingClientRect();
        var newStart = clampMin(yToMin(e.clientY - r.top - drag.grab));
        drag.startMin = newStart; drag.endMin = newStart + drag.dur;
        applyBlock(drag);
      } else if (drag.mode === 'resize') {
        var rr = drag.col.getBoundingClientRect();
        drag.endMin = Math.max(drag.startMin + SNAP, yToMin(e.clientY - rr.top));
        applyBlock(drag);
      }
    }
    function onUp() {
      if (!drag) return;
      var d = drag; drag = null;
      if (d.mode === 'create') {
        if (d.ghost) d.ghost.remove();
        var a = Math.min(d.startMin, d.endMin), b = Math.max(d.startMin, d.endMin);
        if (b - a < SNAP) b = a + 60;
        openEventModal(null, { date: d.date, startMin: a, endMin: b });
      } else {
        d.block.classList.remove('dragging');
        if (d.moved) {
          var nd = parseDT(d.date);
          var ns = new Date(nd.getFullYear(), nd.getMonth(), nd.getDate(), Math.floor(d.startMin / 60), d.startMin % 60);
          var ne = new Date(nd.getFullYear(), nd.getMonth(), nd.getDate(), Math.floor(d.endMin / 60), d.endMin % 60);
          d.ev.start = serialize(ns, false); d.ev.end = serialize(ne, false);
          saveEvents(); render(); toast(d.mode === 'resize' ? 'Duration updated' : 'Event moved');
        }
      }
    }
  }
  function yToMin(y) { return clampMin(Math.round((y / HOUR_PX * 60) / SNAP) * SNAP); }
  function clampMin(m) { return Math.max(0, Math.min(24 * 60, m)); }
  function updateGhost(d) {
    var a = Math.min(d.startMin, d.endMin), b = Math.max(d.startMin, d.endMin);
    d.ghost.style.top = (a / 60 * HOUR_PX) + 'px';
    d.ghost.style.height = Math.max(SNAP / 60 * HOUR_PX, (b - a) / 60 * HOUR_PX) + 'px';
    d.ghost.textContent = fmtTimeMin(a) + ' – ' + fmtTimeMin(b);
  }
  function applyBlock(d) {
    d.block.style.top = (d.startMin / 60 * HOUR_PX) + 'px';
    d.block.style.height = Math.max(18, (d.endMin - d.startMin) / 60 * HOUR_PX) + 'px';
    d.block.style.left = '0'; d.block.style.width = 'calc(100% - 4px)';
  }

  /* ============================================================
     Mini calendar + sidebar lists
  ============================================================ */
  function renderMini() {
    var base = state.cursor;
    var y = base.getFullYear(), m = base.getMonth();
    var first = startOfWeek(new Date(y, m, 1)), today = stripTime(new Date());
    var head = '<div class="ev-mini-top"><button class="ev-mini-nav" data-mini="-1">‹</button>' +
      '<span>' + base.toLocaleString('en-US', { month: 'long', year: 'numeric' }) + '</span>' +
      '<button class="ev-mini-nav" data-mini="1">›</button></div>';
    var dows = '<div class="ev-mini-grid">' + orderedDow().map(function (d) { return '<span class="ev-mini-dow">' + d[0] + '</span>'; }).join('');
    var cells = '';
    for (var i = 0; i < 42; i++) {
      var cd = addDays(first, i);
      cells += '<button class="ev-mini-cell' + (cd.getMonth() !== m ? ' other' : '') + (sameDay(cd, today) ? ' today' : '') +
        (sameDay(cd, state.selected) ? ' sel' : '') + '" data-d="' + dateKey(cd) + '">' + cd.getDate() + '</button>';
    }
    elMini.innerHTML = head + dows + cells + '</div>';
    elMini.querySelectorAll('[data-mini]').forEach(function (b) {
      b.addEventListener('click', function () { state.cursor = new Date(y, m + (+b.getAttribute('data-mini')), 1); renderMini(); });
    });
    elMini.querySelectorAll('.ev-mini-cell').forEach(function (b) {
      b.addEventListener('click', function () { var d = parseDT(b.getAttribute('data-d')); state.selected = d; state.cursor = d; if (state.view === 'agenda') setView('day'); else render(); });
    });
  }

  function renderLabels() {
    elLabelList.innerHTML = labels.map(function (l) {
      var on = state.activeLabels.has(l.id);
      return '<div class="ev-label-row" data-id="' + l.id + '">' +
        '<button class="ev-label-check' + (on ? ' on' : '') + '" style="border-color:' + l.color + ';background:' + (on ? l.color : 'transparent') + '" data-a="toggle"></button>' +
        '<span class="ev-label-name">' + esc(l.name) + '</span>' +
        '<button class="ev-label-edit" data-a="edit" title="Edit">✏️</button>' +
        '<button class="ev-label-edit" data-a="del" title="Delete">✕</button></div>';
    }).join('');
    elLabelList.querySelectorAll('.ev-label-row').forEach(function (row) {
      var id = row.getAttribute('data-id');
      row.querySelector('[data-a="toggle"]').addEventListener('click', function () {
        if (state.activeLabels.has(id)) state.activeLabels.delete(id); else state.activeLabels.add(id);
        render();
      });
      row.querySelector('[data-a="edit"]').addEventListener('click', function () { openLabelModal(labelOf(id)); });
      row.querySelector('[data-a="del"]').addEventListener('click', function () {
        if (!confirm('Delete label "' + labelOf(id).name + '"? Events keep their color.')) return;
        labels = labels.filter(function (x) { return x.id !== id; }); state.activeLabels.delete(id); saveLabels(); render();
      });
    });
  }

  function renderSidebarLists() {
    var today = stripTime(new Date());
    var todays = getOccurrences(today, addDays(today, 1)).filter(function (o) { return sameDay(o.s, today) || (o.allDay && stripTime(o.s) <= today && stripTime(o.e) >= today); }).sort(evSort);
    elTodayList.innerHTML = todays.length ? todays.map(miniItem).join('') : '<p class="ev-empty-note">Nothing today</p>';
    var upFrom = addDays(today, 1);
    var up = getOccurrences(upFrom, addDays(upFrom, 30)).sort(function (a, b) { return a.s - b.s; }).slice(0, 6);
    elUpcoming.innerHTML = up.length ? up.map(function (o) { return miniItem(o, true); }).join('') : '<p class="ev-empty-note">Nothing upcoming</p>';
    elTodayList.querySelectorAll('[data-id]').forEach(bindMiniItem);
    elUpcoming.querySelectorAll('[data-id]').forEach(bindMiniItem);
  }
  function miniItem(o, showDate) {
    return '<div class="ev-mini-item" data-id="' + o.id + '"><span class="ev-dot" style="background:' + o.color + '"></span>' +
      '<span class="ev-mini-itxt"><span class="ev-mini-ititle">' + esc(o.title) + '</span>' +
      '<span class="ev-mini-itime">' + (showDate ? o.s.toLocaleString('en-US', { month: 'short', day: 'numeric' }) + ' · ' : '') + (o.allDay ? 'All day' : fmtTime(o.s)) + '</span></span></div>';
  }
  function bindMiniItem(el) { el.addEventListener('click', function () { openEventById(el.getAttribute('data-id')); }); }

  /* ============================================================
     Event modal
  ============================================================ */
  var evModal = document.getElementById('evModalWrap');
  var evForm = document.getElementById('evForm');
  var evAllday = document.getElementById('evf-allday');
  var evLabelSel = document.getElementById('evf-label');
  var evColorRow = document.getElementById('evColorRow');
  var evRemindersEl = document.getElementById('evReminders');
  var evReminderSel = document.getElementById('evReminderSel');
  var evEditId = null;

  evReminderSel.innerHTML = REMINDER_OPTS.map(function (r) { return '<option value="' + r.v + '">' + r.l + '</option>'; }).join('');

  function fillLabelSelect() {
    evLabelSel.innerHTML = labels.map(function (l) { return '<option value="' + l.id + '">' + esc(l.name) + '</option>'; }).join('');
  }
  function renderColorRow(mount, hiddenInput, chosen) {
    mount.innerHTML = SWATCHES.map(function (c) { return '<button type="button" class="swatch' + (c === chosen ? ' on' : '') + '" data-col="' + c + '" style="background:' + c + '"></button>'; }).join('');
    hiddenInput.value = chosen;
    mount.querySelectorAll('.swatch').forEach(function (b) {
      b.addEventListener('click', function () { hiddenInput.value = b.getAttribute('data-col'); mount.querySelectorAll('.swatch').forEach(function (x) { x.classList.toggle('on', x === b); }); });
    });
  }
  function renderReminderChips() {
    evRemindersEl.innerHTML = state.pendingReminders.map(function (m, i) {
      var lbl = m === 0 ? 'At time' : m % 1440 === 0 ? (m / 1440) + 'd before' : m % 60 === 0 ? (m / 60) + 'h before' : m + 'm before';
      return '<span class="reminder-chip">🔔 ' + lbl + '<button type="button" data-i="' + i + '">✕</button></span>';
    }).join('');
    evRemindersEl.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { state.pendingReminders.splice(+b.getAttribute('data-i'), 1); renderReminderChips(); });
    });
  }
  document.getElementById('evAddReminder').addEventListener('click', function () {
    var v = evReminderSel.value;
    if (v === 'custom') { var n = prompt('Remind how many minutes before?', '10'); if (n == null) return; v = parseInt(n, 10); if (isNaN(v) || v < 0) return; }
    else v = parseInt(v, 10);
    if (state.pendingReminders.indexOf(v) === -1) { state.pendingReminders.push(v); state.pendingReminders.sort(function (a, b) { return a - b; }); renderReminderChips(); }
  });

  evAllday.addEventListener('change', function () { evModal.querySelectorAll('.ev-time-field').forEach(function (f) { f.style.display = evAllday.checked ? 'none' : ''; }); });

  function openEventModal(ev, opts) {
    opts = opts || {};
    evEditId = ev ? ev.id : null;
    document.getElementById('evModalTitle').textContent = ev ? 'Edit Event' : 'New Event';
    evForm.reset();
    fillLabelSelect();
    state.pendingReminders = ev && ev.reminders ? ev.reminders.slice() : [];

    var s, e, allDay;
    if (ev) {
      allDay = !!ev.allDay; s = parseDT(ev.start); e = parseDT(ev.end || ev.start);
      evForm.elements['title'].value = ev.title || '';
      evForm.elements['location'].value = ev.location || '';
      evForm.elements['description'].value = ev.description || '';
      evLabelSel.value = ev.label || labels[0].id;
      evForm.elements['recurrence'].value = ev.recurrence || 'none';
    } else {
      allDay = false;
      var base = opts.date ? parseDT(opts.date) : state.selected;
      s = new Date(base); e = new Date(base);
      if (opts.startMin != null) { s.setHours(Math.floor(opts.startMin / 60), opts.startMin % 60, 0, 0); e.setHours(Math.floor(opts.endMin / 60), opts.endMin % 60, 0, 0); }
      else { var now = new Date(); s.setHours(now.getHours() + 1, 0, 0, 0); e.setHours(now.getHours() + 2, 0, 0, 0); }
      evLabelSel.value = labels[0].id;
    }
    evAllday.checked = allDay;
    evModal.querySelectorAll('.ev-time-field').forEach(function (f) { f.style.display = allDay ? 'none' : ''; });
    evForm.elements['startDate'].value = dateKey(s);
    evForm.elements['endDate'].value = dateKey(e);
    evForm.elements['startTime'].value = pad(s.getHours()) + ':' + pad(s.getMinutes());
    evForm.elements['endTime'].value = pad(e.getHours()) + ':' + pad(e.getMinutes());

    renderColorRow(evColorRow, document.getElementById('evf-color'), ev && ev.color ? ev.color : (labelOf(evLabelSel.value) || labels[0]).color);
    evLabelSel.onchange = function () { renderColorRow(evColorRow, document.getElementById('evf-color'), (labelOf(evLabelSel.value) || labels[0]).color); };
    renderReminderChips();

    evModal.classList.add('open');
    setTimeout(function () { evForm.elements['title'].focus(); }, 50);
  }
  function closeEventModal() { evModal.classList.remove('open'); evEditId = null; }
  document.getElementById('evModalClose').addEventListener('click', closeEventModal);
  document.getElementById('evCancelBtn').addEventListener('click', closeEventModal);
  evModal.addEventListener('click', function (e) { if (e.target === evModal) closeEventModal(); });

  function openEventById(id) { var ev = events.find(function (x) { return x.id === id; }); if (ev) openEventModal(ev); }

  evForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData(evForm));
    if (!d.title.trim()) { evForm.elements['title'].focus(); return; }
    var allDay = evAllday.checked;
    var start, end;
    if (allDay) { start = d.startDate; end = d.endDate || d.startDate; }
    else {
      start = d.startDate + 'T' + (d.startTime || '09:00');
      end = (d.endDate || d.startDate) + 'T' + (d.endTime || d.startTime || '10:00');
      if (parseDT(end) < parseDT(start)) end = start;
    }
    var rec = {
      title: d.title.trim(), description: d.description.trim(), location: d.location.trim(),
      allDay: allDay, start: start, end: end, label: d.label, color: d.color,
      recurrence: d.recurrence, reminders: state.pendingReminders.slice()
    };
    if (evEditId) {
      var i = events.findIndex(function (x) { return x.id === evEditId; });
      if (i !== -1) events[i] = Object.assign({}, events[i], rec, { id: evEditId });
      toast('Event updated');
    } else {
      events.push(Object.assign({}, rec, { id: uid(), createdAt: Date.now() }));
      toast('Event created', 'success');
    }
    if (rec.reminders.length && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    saveEvents(); closeEventModal(); render();
  });

  /* ============================================================
     Label modal
  ============================================================ */
  var labelModal = document.getElementById('evLabelModalWrap');
  var labelForm = document.getElementById('evLabelForm');
  var labelEditId = null;
  document.getElementById('evAddLabel').addEventListener('click', function () { openLabelModal(null); });
  document.getElementById('evLabelClose').addEventListener('click', closeLabelModal);
  document.getElementById('evLabelCancel').addEventListener('click', closeLabelModal);
  labelModal.addEventListener('click', function (e) { if (e.target === labelModal) closeLabelModal(); });

  function openLabelModal(l) {
    labelEditId = l ? l.id : null;
    document.getElementById('evLabelModalTitle').textContent = l ? 'Edit Label' : 'New Label';
    labelForm.reset();
    if (l) labelForm.elements['name'].value = l.name;
    renderColorRow(document.getElementById('evLabelColors'), document.getElementById('evlf-color'), l ? l.color : SWATCHES[0]);
    labelModal.classList.add('open');
    setTimeout(function () { labelForm.elements['name'].focus(); }, 50);
  }
  function closeLabelModal() { labelModal.classList.remove('open'); labelEditId = null; }
  labelForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData(labelForm));
    if (!d.name.trim()) return;
    if (labelEditId) {
      var i = labels.findIndex(function (x) { return x.id === labelEditId; });
      if (i !== -1) labels[i] = Object.assign({}, labels[i], { name: d.name.trim(), color: d.color });
    } else {
      var id = uid().slice(0, 8);
      labels.push({ id: id, name: d.name.trim(), color: d.color });
      state.activeLabels.add(id);
    }
    saveLabels(); closeLabelModal(); render();
    toast('Label saved', 'success');
  });

  /* ============================================================
     Context menu
  ============================================================ */
  var ctx = document.getElementById('evCtx');
  var ctxId = null;
  function showCtx(e, id) {
    ctxId = id; ctx.hidden = false;
    var x = Math.min(e.clientX, window.innerWidth - 150), y = Math.min(e.clientY, window.innerHeight - 120);
    ctx.style.left = x + 'px'; ctx.style.top = y + 'px';
  }
  function hideCtx() { ctx.hidden = true; ctxId = null; }
  document.addEventListener('click', function (e) { if (!ctx.hidden && !e.target.closest('.ev-ctx')) hideCtx(); });
  ctx.querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () {
      var a = b.getAttribute('data-a'), ev = events.find(function (x) { return x.id === ctxId; });
      hideCtx(); if (!ev) return;
      if (a === 'edit') openEventModal(ev);
      else if (a === 'dup') { events.push(Object.assign({}, ev, { id: uid(), title: ev.title + ' (copy)', createdAt: Date.now() })); saveEvents(); render(); toast('Event duplicated', 'success'); }
      else if (a === 'del') { if (confirm('Delete "' + ev.title + '"' + (ev.recurrence && ev.recurrence !== 'none' ? '\n(this deletes the whole recurring series)' : '') + '?')) { events = events.filter(function (x) { return x.id !== ev.id; }); saveEvents(); render(); toast('Event deleted'); } }
    });
  });

  /* ============================================================
     Keyboard shortcuts
  ============================================================ */
  document.addEventListener('keydown', function (e) {
    if (TT.view !== 'events') return;
    if (document.querySelector('.modal-wrap.open')) { if (e.key === 'Escape') { closeEventModal(); closeLabelModal(); } return; }
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'ArrowLeft') { nav(-1); }
    else if (e.key === 'ArrowRight') { nav(1); }
    else if (e.key === 't') { state.cursor = stripTime(new Date()); render(); }
    else if (e.key === 'm') setView('month');
    else if (e.key === 'w') setView('week');
    else if (e.key === 'd') setView('day');
    else if (e.key === 'a') setView('agenda');
    else if (e.key === 'n') openEventModal(null);
  });

  /* ============================================================
     Reminders (in-app, best effort)
  ============================================================ */
  function checkReminders() {
    var now = Date.now();
    var from = stripTime(new Date()), to = addDays(from, 2);
    getOccurrences(from, to).forEach(function (o) {
      var base = o.base; if (!base.reminders || !base.reminders.length) return;
      base.reminders.forEach(function (mins) {
        var fireAt = o.s.getTime() - mins * 60000;
        var key = o.occKey + ':' + mins;
        if (fireAt <= now && now - fireAt < 60000 && !firedReminders[key]) {
          firedReminders[key] = true;
          var msg = o.title + ' — ' + (mins === 0 ? 'now' : 'in ' + (mins >= 60 ? (mins / 60) + 'h' : mins + 'm'));
          if ('Notification' in window && Notification.permission === 'granted') new Notification('Tracktify reminder', { body: msg });
          else toast('🔔 ' + msg);
        }
      });
    });
  }
  setInterval(checkReminders, 30000);
  setInterval(function () { if (TT.view === 'events' && (state.view === 'week' || state.view === 'day')) { var n = document.getElementById('tlNow'); if (n) n.style.top = (minutesOfDay(new Date()) / 60 * HOUR_PX) + 'px'; } }, 60000);

  /* ============================================================
     Init
  ============================================================ */
  document.addEventListener('tt:view', function (e) { if (e.detail === 'events') render(); });
  document.addEventListener('tt:theme', function () { if (TT.view === 'events') render(); });
  render();

  // Dashboard provider — live data via closure (expands recurrence too).
  TT.dashboard.register('events', function () {
    var today = stripTime(new Date());
    var occ = getOccurrences(today, addDays(today, 7));
    var now = new Date();
    var todayCount = occ.filter(function (o) { return sameDay(o.s, now); }).length;
    var upcoming = occ.slice().sort(function (a, b) { return a.s - b.s; }).slice(0, 5)
      .map(function (o) { return { title: o.title, date: dateKey(o.s), meta: o.allDay ? 'All day' : fmtTime(o.s), atRisk: false }; });
    var recent = events.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 5)
      .map(function (e) { return { title: e.title, ts: e.createdAt || 0, meta: e.allDay ? 'All day' : '' }; });
    return {
      name: 'Events', icon: '📅', view: 'events',
      stats: [
        { label: 'Today', value: todayCount, tone: todayCount ? 'warn' : '' },
        { label: 'This week', value: occ.length, tone: '' }
      ],
      recent: recent, upcoming: upcoming,
      headline: occ.length ? occ.length + ' event' + (occ.length === 1 ? '' : 's') + ' this week' + (todayCount ? ' (' + todayCount + ' today)' : '') : ''
    };
  });
})();
