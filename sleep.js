/* ============================================================
   Tracktify — Sleep tracker
   Bed/wake times, duration, quality, trend.
   Model: tracktify-sleep = [{ id, date, bedtime, waketime,
     quality(1-5), notes, createdAt }]
          tracktify-sleep-settings = { goalHours }
   ============================================================ */
(function () {
  'use strict';
  if (!document.getElementById('view-sleep')) return;

  var TT = window.TT;
  var esc = TT.esc, uid = TT.uid, load = TT.load, store = TT.store, toast = TT.toast, fmtDate = TT.fmtDate;

  var entries = load('tracktify-sleep', []);
  entries = Array.isArray(entries) ? entries : [];
  var settings = load('tracktify-sleep-settings', null) || { goalHours: 8 };
  var editId = null, formQuality = 3;

  function save() { store('tracktify-sleep', entries); }
  function saveSettings() { store('tracktify-sleep-settings', settings); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  // duration in hours from bedtime → waketime, handling crossing midnight
  function durHours(e) {
    if (!e.bedtime || !e.waketime) return 0;
    var b = e.bedtime.split(':'), w = e.waketime.split(':');
    var bm = (+b[0]) * 60 + (+b[1]), wm = (+w[0]) * 60 + (+w[1]);
    var diff = wm - bm; if (diff <= 0) diff += 1440;
    return diff / 60;
  }
  function fmtDur(h) { var hh = Math.floor(h), mm = Math.round((h - hh) * 60); return hh + 'h' + (mm ? ' ' + mm + 'm' : ''); }

  var listEl = document.getElementById('sleepList');
  var summaryEl = document.getElementById('sleepSummary');
  var trendEl = document.getElementById('sleepTrend');
  var emptyEl = document.getElementById('sleepEmpty');
  var modal = document.getElementById('sleepModalWrap');
  var form = document.getElementById('sleepForm');
  var starRow = document.getElementById('sf-stars');

  /* ---- star input ---- */
  function renderStars(q) {
    formQuality = q;
    document.getElementById('sf-quality').value = q;
    starRow.innerHTML = [1,2,3,4,5].map(function (n) { return '<button type="button" class="star' + (n <= q ? ' on' : '') + '" data-q="' + n + '">★</button>'; }).join('');
    starRow.querySelectorAll('.star').forEach(function (b) { b.addEventListener('click', function () { renderStars(+b.getAttribute('data-q')); }); });
  }

  function openModal(s) {
    editId = s ? s.id : null;
    document.getElementById('sleepModalTitle').textContent = s ? 'Edit Sleep' : 'Log Sleep';
    form.reset();
    if (s) {
      form.elements['date'].value = s.date; form.elements['bedtime'].value = s.bedtime || '23:00';
      form.elements['waketime'].value = s.waketime || '07:00'; form.elements['notes'].value = s.notes || '';
      renderStars(s.quality || 3);
    } else {
      form.elements['date'].value = todayStr(); form.elements['bedtime'].value = '23:00'; form.elements['waketime'].value = '07:00';
      renderStars(3);
    }
    modal.classList.add('open');
    setTimeout(function () { form.elements['bedtime'].focus(); }, 50);
  }
  function closeModal() { modal.classList.remove('open'); editId = null; }
  document.getElementById('sleepAddBtn').addEventListener('click', function () { openModal(null); });
  document.getElementById('sleepEmptyAdd').addEventListener('click', function () { openModal(null); });
  document.getElementById('sleepModalClose').addEventListener('click', closeModal);
  document.getElementById('sleepCancelBtn').addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  TT.mobileAdd.sleep = function () { openModal(null); };

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData(form));
    var rec = { date: d.date || todayStr(), bedtime: d.bedtime, waketime: d.waketime, quality: parseInt(d.quality, 10) || 3, notes: d.notes.trim() };
    if (editId) {
      var i = entries.findIndex(function (x) { return x.id === editId; });
      if (i !== -1) entries[i] = Object.assign({}, entries[i], rec);
      toast('Sleep updated');
    } else {
      entries.push(Object.assign({ id: uid(), createdAt: Date.now() }, rec));
      toast('Sleep logged', 'success');
    }
    save(); closeModal(); render();
  });

  /* ---- goal modal ---- */
  var gModal = document.getElementById('sleepGoalWrap');
  var gForm = document.getElementById('sleepGoalForm');
  document.getElementById('sleepGoalBtn').addEventListener('click', function () { gForm.elements['goal'].value = settings.goalHours; gModal.classList.add('open'); });
  function closeGoal() { gModal.classList.remove('open'); }
  document.getElementById('sleepGoalClose').addEventListener('click', closeGoal);
  document.getElementById('sleepGoalCancel').addEventListener('click', closeGoal);
  gModal.addEventListener('click', function (e) { if (e.target === gModal) closeGoal(); });
  gForm.addEventListener('submit', function (e) { e.preventDefault(); settings.goalHours = parseFloat(gForm.elements['goal'].value) || 8; saveSettings(); closeGoal(); render(); toast('Goal updated'); });

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeModal(); closeGoal(); } });

  function chip(n, l, color) { return '<div class="chip"><span class="chip-n" style="color:' + color + '">' + n + '</span><span class="chip-l">' + l + '</span></div>'; }
  function qColor(q) { return ['#dc2626','#dc2626','#d97706','#ca8a04','#16a34a','#16a34a'][q] || '#7c3aed'; }

  function render() {
    var sorted = entries.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var last7 = sorted.slice(0, 7);
    var avgDur = last7.length ? last7.reduce(function (s, e) { return s + durHours(e); }, 0) / last7.length : 0;
    var avgQ = last7.length ? last7.reduce(function (s, e) { return s + (e.quality || 0); }, 0) / last7.length : 0;
    var lastNight = sorted[0] ? durHours(sorted[0]) : 0;
    // goal-met streak
    var st = 0; for (var i = 0; i < sorted.length; i++) { if (durHours(sorted[i]) >= settings.goalHours) st++; else break; }

    summaryEl.innerHTML =
      chip(lastNight ? fmtDur(lastNight) : '—', 'Last night', qColor(sorted[0] ? sorted[0].quality : 0)) +
      chip(avgDur ? fmtDur(avgDur) : '—', '7-day avg', 'var(--accent)') +
      chip(avgQ ? avgQ.toFixed(1) + '★' : '—', 'Avg quality', '#ca8a04') +
      chip('🔥 ' + st, 'Goal streak', '#16a34a');

    // 14-day trend (oldest→newest), bar height by duration, color by quality, goal line
    var byDate = {}; entries.forEach(function (e) { byDate[e.date] = e; });
    var maxH = Math.max(settings.goalHours + 2, 10);
    var bars = '';
    for (var j = 13; j >= 0; j--) {
      var d = new Date(); d.setDate(d.getDate() - j);
      var dk = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      var e = byDate[dk];
      var hrs = e ? durHours(e) : 0;
      var h = Math.round((hrs / maxH) * 90);
      bars += '<div class="sl-bar-col"><div class="sl-bar-track"><div class="sl-bar" style="height:' + h + 'px;background:' + (e ? qColor(e.quality) : 'var(--line)') + '" title="' + (e ? fmtDur(hrs) : 'no data') + '"></div></div>' +
        '<span class="sl-bar-lbl' + (j === 0 ? ' today' : '') + '">' + d.getDate() + '</span></div>';
    }
    var goalTop = 100 - Math.round((settings.goalHours / maxH) * 90);
    trendEl.innerHTML = entries.length ? '<div class="card"><div class="card-h-row"><h3 class="card-h">Last 14 nights</h3><span class="range-lbl">goal ' + settings.goalHours + 'h</span></div>' +
      '<div class="sl-bars"><div class="sl-goal-line" style="bottom:' + Math.round((settings.goalHours / maxH) * 90 + 18) + 'px"></div>' + bars + '</div></div>' : '';

    listEl.innerHTML = '';
    if (entries.length === 0) { emptyEl.classList.add('show'); return; }
    emptyEl.classList.remove('show');
    sorted.forEach(function (e) { listEl.appendChild(row(e)); });
  }

  function row(e) {
    var li = document.createElement('li');
    li.className = 'sl-row';
    li.style.borderLeftColor = qColor(e.quality);
    var stars = ''; for (var i = 1; i <= 5; i++) stars += '<span class="' + (i <= e.quality ? 'q-on' : 'q-off') + '">★</span>';
    li.innerHTML =
      '<div><div class="exp-desc">' + fmtDur(durHours(e)) + ' <span class="sl-times">' + (e.bedtime || '?') + ' → ' + (e.waketime || '?') + '</span></div>' +
        '<div class="exp-meta"><span>' + fmtDate(e.date) + '</span><span class="sl-stars">' + stars + '</span></div>' +
        (e.notes ? '<div class="exp-notes">' + esc(e.notes) + '</div>' : '') + '</div>' +
      '<div class="exp-actions"><button class="ic-btn" data-a="edit" title="Edit">✏️</button><button class="ic-btn del" data-a="del" title="Delete">🗑️</button></div>';
    li.querySelector('[data-a="edit"]').addEventListener('click', function () { openModal(e); });
    li.querySelector('[data-a="del"]').addEventListener('click', function () {
      if (!confirm('Delete this sleep entry?')) return;
      entries = entries.filter(function (x) { return x.id !== e.id; }); save(); render(); toast('Entry deleted');
    });
    return li;
  }

  document.addEventListener('tt:view', function (e) { if (e.detail === 'sleep') render(); });
  document.addEventListener('tt:theme', function () { if (TT.view === 'sleep') render(); });
  render();
})();
