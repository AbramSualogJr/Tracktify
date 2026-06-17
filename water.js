/* ============================================================
   Tracktify — Water tracker
   Daily intake vs goal, quick "+1 glass" logging.
   Model: tracktify-water = [{ id, date:'YYYY-MM-DD', ml, createdAt }]
          tracktify-water-settings = { goalGlasses, glassMl }
   ============================================================ */
(function () {
  'use strict';
  if (!document.getElementById('view-water')) return;

  var TT = window.TT;
  var esc = TT.esc, uid = TT.uid, load = TT.load, store = TT.store, toast = TT.toast;

  var entries = load('tracktify-water', []);
  entries = Array.isArray(entries) ? entries : [];
  var settings = load('tracktify-water-settings', null) || { goalGlasses: 8, glassMl: 250 };

  function save() { store('tracktify-water', entries); }
  function saveSettings() { store('tracktify-water-settings', settings); }

  function pad(n) { return String(n).padStart(2, '0'); }
  function key(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function todayKey() { return key(new Date()); }
  function mlOn(k) { return entries.filter(function (e) { return e.date === k; }).reduce(function (s, e) { return s + (e.ml || 0); }, 0); }
  function goalMl() { return settings.goalGlasses * settings.glassMl; }

  var mount = document.getElementById('waterMount');

  /* ---- quick logging ---- */
  function add(ml) {
    entries.push({ id: uid(), date: todayKey(), ml: ml, createdAt: Date.now() });
    save(); render();
  }
  function undoLast() {
    // remove most recent entry for today
    for (var i = entries.length - 1; i >= 0; i--) { if (entries[i].date === todayKey()) { entries.splice(i, 1); break; } }
    save(); render();
  }
  TT.mobileAdd.water = function () { add(settings.glassMl); toast('+1 glass 💧', 'success'); };

  /* ---- settings modal ---- */
  var sModal = document.getElementById('waterSettingsWrap');
  var sForm = document.getElementById('waterSettingsForm');
  document.getElementById('waterSettingsBtn').addEventListener('click', function () {
    sForm.elements['goal'].value = settings.goalGlasses;
    sForm.elements['glassMl'].value = settings.glassMl;
    sModal.classList.add('open');
  });
  function closeSettings() { sModal.classList.remove('open'); }
  document.getElementById('waterSettingsClose').addEventListener('click', closeSettings);
  document.getElementById('waterSettingsCancel').addEventListener('click', closeSettings);
  sModal.addEventListener('click', function (e) { if (e.target === sModal) closeSettings(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSettings(); });
  sForm.addEventListener('submit', function (e) {
    e.preventDefault();
    settings.goalGlasses = Math.max(1, parseInt(sForm.elements['goal'].value, 10) || 8);
    settings.glassMl = Math.max(50, parseInt(sForm.elements['glassMl'].value, 10) || 250);
    saveSettings(); closeSettings(); render(); toast('Goal updated');
  });

  /* ---- ring helper ---- */
  function ring(pct, color) {
    var C = 2 * Math.PI * 52, len = Math.min(1, pct) * C;
    return '<svg viewBox="0 0 130 130" class="w-ring-svg">' +
      '<circle cx="65" cy="65" r="52" fill="none" stroke="var(--surface-2)" stroke-width="13"/>' +
      '<circle cx="65" cy="65" r="52" fill="none" stroke="' + color + '" stroke-width="13" stroke-linecap="round" stroke-dasharray="' + len + ' ' + (C - len) + '" transform="rotate(-90 65 65)"/></svg>';
  }

  function render() {
    var k = todayKey();
    var ml = mlOn(k), goal = goalMl();
    var glasses = ml / settings.glassMl, goalGlasses = settings.goalGlasses;
    var pct = goal ? ml / goal : 0;
    var color = pct >= 1 ? '#16a34a' : '#0ea5e9';

    // 7-day trend
    var bars = '';
    var max = Math.max(goal, 1);
    for (var i = 6; i >= 0; i--) {
      var d = addDays(new Date(), -i), dk = key(d), v = mlOn(dk);
      max = Math.max(max, v);
    }
    for (var j = 6; j >= 0; j--) {
      var dd = addDays(new Date(), -j), ddk = key(dd), vv = mlOn(ddk);
      var h = Math.round((vv / max) * 70);
      var met = vv >= goal;
      bars += '<div class="w-bar-col"><div class="w-bar-track"><div class="w-bar" style="height:' + h + 'px;background:' + (met ? '#16a34a' : '#0ea5e9') + '"></div></div>' +
        '<span class="w-bar-lbl' + (j === 0 ? ' today' : '') + '">' + ['S','M','T','W','T','F','S'][dd.getDay()] + '</span></div>';
    }

    // streak of goal-met days (ending today/yesterday)
    var st = 0, c = new Date();
    if (mlOn(key(c)) < goal) c = addDays(c, -1);
    while (mlOn(key(c)) >= goal && goal > 0) { st++; c = addDays(c, -1); }

    // today's log
    var todays = entries.filter(function (e) { return e.date === k; }).slice().reverse();
    var log = todays.length ? todays.map(function (e) {
      var t = new Date(e.createdAt);
      return '<li class="w-log-row"><span>💧 ' + (e.ml / settings.glassMl % 1 === 0 ? (e.ml / settings.glassMl) + ' glass' + (e.ml / settings.glassMl > 1 ? 'es' : '') : e.ml + ' ml') + '</span>' +
        '<span class="w-log-time">' + t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '</span>' +
        '<button class="ic-btn del" data-del="' + e.id + '" title="Remove">🗑️</button></li>';
    }).join('') : '<li class="w-log-empty">No water logged yet today.</li>';

    mount.innerHTML =
      '<div class="summary">' +
        '<div class="chip"><span class="chip-n" style="color:' + color + '">' + Math.round(glasses * 10) / 10 + '</span><span class="chip-l">of ' + goalGlasses + ' glasses</span></div>' +
        '<div class="chip"><span class="chip-n" style="color:#0ea5e9">' + ml + '</span><span class="chip-l">ml today</span></div>' +
        '<div class="chip"><span class="chip-n" style="color:#16a34a">' + Math.round(pct * 100) + '%</span><span class="chip-l">of goal</span></div>' +
        '<div class="chip"><span class="chip-n" style="color:#d97706">🔥 ' + st + '</span><span class="chip-l">day streak</span></div>' +
      '</div>' +
      '<div class="w-grid">' +
        '<div class="card w-ring-card">' +
          '<div class="w-ring">' + ring(pct, color) + '<div class="w-ring-lbl"><strong>' + Math.round(glasses * 10) / 10 + '</strong><span>/ ' + goalGlasses + ' glasses</span></div></div>' +
          '<div class="w-buttons">' +
            '<button class="w-add-btn primary" data-add="' + settings.glassMl + '">+ 1 Glass</button>' +
            '<button class="w-add-btn" data-add="' + Math.round(settings.glassMl / 2) + '">+ ½</button>' +
            '<button class="w-add-btn" data-custom="1">+ Custom</button>' +
            '<button class="w-add-btn ghost" data-undo="1">↶ Undo</button>' +
          '</div>' +
        '</div>' +
        '<div class="card w-trend-card"><h3 class="card-h">Last 7 days</h3><div class="w-bars">' + bars + '</div></div>' +
      '</div>' +
      '<div class="card"><h3 class="card-h">Today\'s log</h3><ul class="w-log">' + log + '</ul></div>';

    mount.querySelectorAll('[data-add]').forEach(function (b) { b.addEventListener('click', function () { add(parseInt(b.getAttribute('data-add'), 10)); }); });
    var cu = mount.querySelector('[data-custom]'); if (cu) cu.addEventListener('click', function () { var v = prompt('How many ml?', '300'); if (v == null) return; var n = parseInt(v, 10); if (n > 0) add(n); });
    var un = mount.querySelector('[data-undo]'); if (un) un.addEventListener('click', undoLast);
    mount.querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () { entries = entries.filter(function (e) { return e.id !== b.getAttribute('data-del'); }); save(); render(); }); });
  }

  document.addEventListener('tt:view', function (e) { if (e.detail === 'water') render(); });
  document.addEventListener('tt:theme', function () { if (TT.view === 'water') render(); });
  render();
})();
