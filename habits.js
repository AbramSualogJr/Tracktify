/* ============================================================
   Tracktify — Habits tracker
   Daily / weekly check-offs with streaks.
   Model: tracktify-habits = [{ id, name, icon, color,
     frequency:'daily'|'weekly', target, checks:{YYYY-MM-DD:true}, createdAt }]
   ============================================================ */
(function () {
  'use strict';
  if (!document.getElementById('view-habits')) return;

  var TT = window.TT;
  var esc = TT.esc, uid = TT.uid, load = TT.load, store = TT.store, toast = TT.toast;
  var SWATCHES = ['#7c3aed','#2563eb','#0891b2','#0d9488','#16a34a','#65a30d','#ca8a04','#d97706','#dc2626','#db2777'];

  var habits = load('tracktify-habits', []);
  // guard against malformed entries
  habits = Array.isArray(habits) ? habits.filter(function (h) { return h && h.id; }) : [];
  habits.forEach(function (h) { if (!h.checks || typeof h.checks !== 'object') h.checks = {}; });

  var filter = 'all', editId = null;
  function save() { store('tracktify-habits', habits); }

  /* ---- date helpers ---- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function key(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return new Date(); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function startOfWeek(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -x.getDay()); }

  function streak(h) {
    // consecutive checked days ending today (or yesterday if today not yet done)
    var d = today(), n = 0;
    if (!h.checks[key(d)]) d = addDays(d, -1);
    while (h.checks[key(d)]) { n++; d = addDays(d, -1); }
    return n;
  }
  function weekCount(h) {
    var s = startOfWeek(today()), n = 0;
    for (var i = 0; i < 7; i++) if (h.checks[key(addDays(s, i))]) n++;
    return n;
  }
  function last7Rate(h) {
    var done = 0;
    for (var i = 0; i < 7; i++) if (h.checks[key(addDays(today(), -i))]) done++;
    return Math.round((done / 7) * 100);
  }

  /* ---- DOM ---- */
  var listEl = document.getElementById('habitList');
  var summaryEl = document.getElementById('habitSummary');
  var emptyEl = document.getElementById('habitEmpty');
  var modal = document.getElementById('habitModalWrap');
  var form = document.getElementById('habitForm');
  var freqSel = document.getElementById('hf-freq');
  var targetWrap = document.getElementById('hf-target-wrap');

  /* ---- modal ---- */
  function renderColors(chosen) {
    var mount = document.getElementById('habitColors');
    mount.innerHTML = SWATCHES.map(function (c) { return '<button type="button" class="swatch' + (c === chosen ? ' on' : '') + '" data-col="' + c + '" style="background:' + c + '"></button>'; }).join('');
    document.getElementById('hf-color').value = chosen;
    mount.querySelectorAll('.swatch').forEach(function (b) {
      b.addEventListener('click', function () { document.getElementById('hf-color').value = b.getAttribute('data-col'); mount.querySelectorAll('.swatch').forEach(function (x) { x.classList.toggle('on', x === b); }); });
    });
  }
  function syncTarget() { targetWrap.style.display = freqSel.value === 'weekly' ? '' : 'none'; }
  freqSel.addEventListener('change', syncTarget);

  function openModal(h) {
    editId = h ? h.id : null;
    document.getElementById('habitModalTitle').textContent = h ? 'Edit Habit' : 'New Habit';
    form.reset();
    if (h) {
      form.elements['name'].value = h.name; form.elements['icon'].value = h.icon || '';
      form.elements['frequency'].value = h.frequency || 'daily'; form.elements['target'].value = h.target || 3;
    }
    syncTarget();
    renderColors(h && h.color ? h.color : SWATCHES[0]);
    modal.classList.add('open');
    setTimeout(function () { form.elements['name'].focus(); }, 50);
  }
  function closeModal() { modal.classList.remove('open'); editId = null; }
  document.getElementById('habitAddBtn').addEventListener('click', function () { openModal(null); });
  document.getElementById('habitEmptyAdd').addEventListener('click', function () { openModal(null); });
  document.getElementById('habitModalClose').addEventListener('click', closeModal);
  document.getElementById('habitCancelBtn').addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  TT.mobileAdd.habits = function () { openModal(null); };

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData(form));
    if (!d.name.trim()) { form.elements['name'].focus(); return; }
    var rec = { name: d.name.trim(), icon: d.icon || '✅', color: d.color, frequency: d.frequency, target: parseInt(d.target, 10) || 3 };
    if (editId) {
      var i = habits.findIndex(function (x) { return x.id === editId; });
      if (i !== -1) habits[i] = Object.assign({}, habits[i], rec);
      toast('Habit updated');
    } else {
      habits.push(Object.assign({ id: uid(), checks: {}, createdAt: Date.now() }, rec));
      toast('Habit added', 'success');
    }
    save(); closeModal(); render();
  });

  /* ---- filters ---- */
  document.querySelectorAll('#habitFilters .f-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#habitFilters .f-btn').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active'); filter = b.getAttribute('data-f'); render();
    });
  });

  /* ---- render ---- */
  function chip(n, l, color) { return '<div class="chip"><span class="chip-n" style="color:' + color + '">' + n + '</span><span class="chip-l">' + l + '</span></div>'; }

  function render() {
    // summary
    var daily = habits.filter(function (h) { return h.frequency !== 'weekly'; });
    var doneToday = daily.filter(function (h) { return h.checks[key(today())]; }).length;
    var best = habits.reduce(function (m, h) { return Math.max(m, streak(h)); }, 0);
    var avgRate = habits.length ? Math.round(habits.reduce(function (s, h) { return s + last7Rate(h); }, 0) / habits.length) : 0;
    summaryEl.innerHTML =
      chip(habits.length, 'Habits', 'var(--accent)') +
      chip(doneToday + '/' + daily.length, 'Done today', '#16a34a') +
      chip('🔥 ' + best, 'Best streak', '#d97706') +
      chip(avgRate + '%', '7-day rate', 'var(--accent)');

    var list = filter === 'all' ? habits : habits.filter(function (h) { return (h.frequency || 'daily') === filter; });
    listEl.innerHTML = '';
    if (habits.length === 0) { emptyEl.classList.add('show'); return; }
    emptyEl.classList.remove('show');
    if (list.length === 0) { listEl.innerHTML = '<p class="no-match">No habits in this filter.</p>'; return; }

    list.forEach(function (h) { listEl.appendChild(card(h)); });
  }

  function card(h) {
    var el = document.createElement('div');
    el.className = 'habit-card';
    el.style.borderLeftColor = h.color;
    var st = streak(h);
    // judgment call: trailing 7 days ending today reads as a familiar "week strip"
    var strip = '';
    for (var i = 6; i >= 0; i--) {
      var d = addDays(today(), -i), k = key(d), on = !!h.checks[k];
      strip += '<button class="hc-day' + (on ? ' on' : '') + (i === 0 ? ' today' : '') + '" data-k="' + k + '" title="' + k + '" style="' + (on ? 'background:' + h.color + ';border-color:' + h.color : '') + '">' +
        ['S','M','T','W','T','F','S'][d.getDay()] + '</button>';
    }
    var meta = h.frequency === 'weekly'
      ? '<span class="hc-tag">Weekly · ' + weekCount(h) + '/' + (h.target || 3) + ' this week</span>'
      : '<span class="hc-tag">Daily</span>';
    var todayOn = !!h.checks[key(today())];
    el.innerHTML =
      '<div class="hc-top">' +
        '<div class="hc-icon" style="background:' + hexA(h.color, 0.15) + '">' + (h.icon || '✅') + '</div>' +
        '<div class="hc-info"><div class="hc-name">' + esc(h.name) + '</div><div class="hc-meta">' + meta + ' <span class="hc-streak">🔥 ' + st + '</span></div></div>' +
        '<button class="hc-check' + (todayOn ? ' on' : '') + '" data-a="today" style="' + (todayOn ? 'background:' + h.color + ';border-color:' + h.color : '') + '" aria-label="Toggle today">' + (todayOn ? '✓' : '') + '</button>' +
      '</div>' +
      '<div class="hc-strip">' + strip + '</div>' +
      '<div class="hc-actions"><button class="ic-btn" data-a="edit" title="Edit">✏️</button><button class="ic-btn del" data-a="del" title="Delete">🗑️</button></div>';

    function toggle(k) { if (h.checks[k]) delete h.checks[k]; else h.checks[k] = true; save(); render(); }
    el.querySelectorAll('.hc-day').forEach(function (b) { b.addEventListener('click', function () { toggle(b.getAttribute('data-k')); }); });
    el.querySelector('[data-a="today"]').addEventListener('click', function () { toggle(key(today())); });
    el.querySelector('[data-a="edit"]').addEventListener('click', function () { openModal(h); });
    el.querySelector('[data-a="del"]').addEventListener('click', function () {
      if (!confirm('Delete habit "' + h.name + '"?')) return;
      habits = habits.filter(function (x) { return x.id !== h.id; }); save(); render(); toast('Habit deleted');
    });
    return el;
  }
  function hexA(hex, a) { var h = hex.replace('#', ''); if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; return 'rgba(' + parseInt(h.slice(0,2),16) + ',' + parseInt(h.slice(2,4),16) + ',' + parseInt(h.slice(4,6),16) + ',' + a + ')'; }

  document.addEventListener('tt:view', function (e) { if (e.detail === 'habits') render(); });
  render();
})();
