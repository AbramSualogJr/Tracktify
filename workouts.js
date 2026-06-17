/* ============================================================
   Tracktify — Workouts tracker
   Sessions with exercises (sets/reps/weight) or duration.
   Model: tracktify-workouts = [{ id, name, date, type, duration,
     notes, exercises:[{name,sets,reps,weight}], createdAt }]
   ============================================================ */
(function () {
  'use strict';
  if (!document.getElementById('view-workouts')) return;

  var TT = window.TT;
  var esc = TT.esc, uid = TT.uid, load = TT.load, store = TT.store, toast = TT.toast, fmtDate = TT.fmtDate;

  var TYPES = { strength: { label: 'Strength', icon: '🏋️', color: '#7c3aed' }, cardio: { label: 'Cardio', icon: '🏃', color: '#0891b2' }, other: { label: 'Other', icon: '🤸', color: '#d97706' } };

  var workouts = load('tracktify-workouts', []);
  workouts = Array.isArray(workouts) ? workouts : [];
  var filter = 'all', editId = null;
  function save() { store('tracktify-workouts', workouts); }

  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function startOfWeek() { var d = new Date(); var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); }

  var listEl = document.getElementById('workoutList');
  var summaryEl = document.getElementById('workoutSummary');
  var emptyEl = document.getElementById('workoutEmpty');
  var modal = document.getElementById('workoutModalWrap');
  var form = document.getElementById('workoutForm');
  var exMount = document.getElementById('wf-exercises');

  /* ---- dynamic exercise rows ---- */
  function exRow(ex) {
    ex = ex || {};
    var row = document.createElement('div');
    row.className = 'ex-row';
    row.innerHTML =
      '<input class="ex-name" placeholder="Exercise" value="' + esc(ex.name || '') + '" />' +
      '<input class="ex-sets" type="number" min="0" placeholder="Sets" value="' + (ex.sets != null ? ex.sets : '') + '" />' +
      '<input class="ex-reps" type="number" min="0" placeholder="Reps" value="' + (ex.reps != null ? ex.reps : '') + '" />' +
      '<input class="ex-wt" type="number" min="0" step="0.5" placeholder="Kg" value="' + (ex.weight != null ? ex.weight : '') + '" />' +
      '<button type="button" class="ic-btn del ex-del" title="Remove">✕</button>';
    row.querySelector('.ex-del').addEventListener('click', function () { row.remove(); });
    exMount.appendChild(row);
  }
  document.getElementById('wf-add-ex').addEventListener('click', function () { exRow(); });
  function collectExercises() {
    return Array.prototype.map.call(exMount.querySelectorAll('.ex-row'), function (r) {
      return { name: r.querySelector('.ex-name').value.trim(), sets: r.querySelector('.ex-sets').value, reps: r.querySelector('.ex-reps').value, weight: r.querySelector('.ex-wt').value };
    }).filter(function (e) { return e.name; });
  }

  /* ---- modal ---- */
  function openModal(w) {
    editId = w ? w.id : null;
    document.getElementById('workoutModalTitle').textContent = w ? 'Edit Workout' : 'New Workout';
    form.reset(); exMount.innerHTML = '';
    if (w) {
      form.elements['name'].value = w.name; form.elements['date'].value = w.date || '';
      form.elements['type'].value = w.type || 'strength'; form.elements['duration'].value = w.duration || '';
      form.elements['notes'].value = w.notes || '';
      (w.exercises || []).forEach(exRow);
    } else {
      form.elements['date'].value = todayStr();
      exRow();
    }
    modal.classList.add('open');
    setTimeout(function () { form.elements['name'].focus(); }, 50);
  }
  function closeModal() { modal.classList.remove('open'); editId = null; }
  document.getElementById('workoutAddBtn').addEventListener('click', function () { openModal(null); });
  document.getElementById('workoutEmptyAdd').addEventListener('click', function () { openModal(null); });
  document.getElementById('workoutModalClose').addEventListener('click', closeModal);
  document.getElementById('workoutCancelBtn').addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  TT.mobileAdd.workouts = function () { openModal(null); };

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData(form));
    if (!d.name.trim()) { form.elements['name'].focus(); return; }
    var rec = { name: d.name.trim(), date: d.date || todayStr(), type: d.type, duration: parseInt(d.duration, 10) || 0, notes: d.notes.trim(), exercises: collectExercises() };
    if (editId) {
      var i = workouts.findIndex(function (x) { return x.id === editId; });
      if (i !== -1) workouts[i] = Object.assign({}, workouts[i], rec);
      toast('Workout updated');
    } else {
      workouts.push(Object.assign({ id: uid(), createdAt: Date.now() }, rec));
      toast('Workout logged', 'success');
    }
    save(); closeModal(); render();
  });

  /* ---- filters ---- */
  document.querySelectorAll('#workoutFilters .f-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#workoutFilters .f-btn').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active'); filter = b.getAttribute('data-f'); render();
    });
  });

  function chip(n, l, color) { return '<div class="chip"><span class="chip-n" style="color:' + color + '">' + n + '</span><span class="chip-l">' + l + '</span></div>'; }

  function render() {
    var sow = startOfWeek();
    var thisWeek = workouts.filter(function (w) { return w.date >= sow; });
    var mins = thisWeek.reduce(function (s, w) { return s + (w.duration || 0); }, 0);
    // streak: consecutive days (ending today/yesterday) with a workout
    var days = {}; workouts.forEach(function (w) { days[w.date] = true; });
    var st = 0, c = new Date();
    var ck = function (dt) { return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); };
    if (!days[ck(c)]) c.setDate(c.getDate() - 1);
    while (days[ck(c)]) { st++; c.setDate(c.getDate() - 1); }

    summaryEl.innerHTML =
      chip(workouts.length, 'Total sessions', 'var(--accent)') +
      chip(thisWeek.length, 'This week', '#16a34a') +
      chip(mins + 'm', 'Minutes this week', '#0891b2') +
      chip('🔥 ' + st, 'Day streak', '#d97706');

    var list = filter === 'all' ? workouts : workouts.filter(function (w) { return (w.type || 'other') === filter; });
    list = list.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0); });

    listEl.innerHTML = '';
    if (workouts.length === 0) { emptyEl.classList.add('show'); return; }
    emptyEl.classList.remove('show');
    if (list.length === 0) { listEl.innerHTML = '<p class="no-match">No workouts in this filter.</p>'; return; }
    list.forEach(function (w) { listEl.appendChild(row(w)); });
  }

  function row(w) {
    var t = TYPES[w.type] || TYPES.other;
    var li = document.createElement('li');
    li.className = 'wo-row';
    li.style.borderLeftColor = t.color;
    var exHtml = (w.exercises && w.exercises.length)
      ? '<ul class="wo-ex">' + w.exercises.map(function (e) {
          var detail = [e.sets && e.reps ? e.sets + '×' + e.reps : (e.sets ? e.sets + ' sets' : ''), e.weight ? e.weight + ' kg' : ''].filter(Boolean).join(' · ');
          return '<li><span>' + esc(e.name) + '</span>' + (detail ? '<span class="wo-ex-d">' + detail + '</span>' : '') + '</li>';
        }).join('') + '</ul>'
      : '';
    var meta = ['<span class="cat-pill" style="background:' + hexA(t.color, 0.14) + ';color:' + t.color + '">' + t.icon + ' ' + t.label + '</span>',
      w.date ? '<span>' + fmtDate(w.date) + '</span>' : '',
      w.duration ? '<span>⏱ ' + w.duration + ' min</span>' : '',
      (w.exercises && w.exercises.length) ? '<span>' + w.exercises.length + ' exercise' + (w.exercises.length > 1 ? 's' : '') + '</span>' : ''].filter(Boolean).join('');
    li.innerHTML =
      '<div class="wo-main"><div class="exp-desc">' + esc(w.name) + '</div><div class="exp-meta">' + meta + '</div>' +
        (w.notes ? '<div class="exp-notes">' + esc(w.notes) + '</div>' : '') + exHtml + '</div>' +
      '<div class="exp-actions"><button class="ic-btn" data-a="edit" title="Edit">✏️</button><button class="ic-btn del" data-a="del" title="Delete">🗑️</button></div>';
    li.querySelector('[data-a="edit"]').addEventListener('click', function () { openModal(w); });
    li.querySelector('[data-a="del"]').addEventListener('click', function () {
      if (!confirm('Delete "' + w.name + '"?')) return;
      workouts = workouts.filter(function (x) { return x.id !== w.id; }); save(); render(); toast('Workout deleted');
    });
    return li;
  }
  function hexA(hex, a) { var h = hex.replace('#', ''); if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; return 'rgba(' + parseInt(h.slice(0,2),16) + ',' + parseInt(h.slice(2,4),16) + ',' + parseInt(h.slice(4,6),16) + ',' + a + ')'; }

  document.addEventListener('tt:view', function (e) { if (e.detail === 'workouts') render(); });
  render();
})();
