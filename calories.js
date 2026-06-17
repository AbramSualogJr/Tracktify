/* ============================================================
   Tracktify — Calories tracker
   Food entries with calorie/macro totals vs a daily target.
   Model: tracktify-calories = [{ id, date, meal, name, calories,
     protein, carbs, fat, createdAt }]
          tracktify-calories-settings = { goal, pg, cg, fg }
   ============================================================ */
(function () {
  'use strict';
  if (!document.getElementById('view-calories')) return;

  var TT = window.TT;
  var esc = TT.esc, uid = TT.uid, load = TT.load, store = TT.store, toast = TT.toast;
  var MEALS = { breakfast: { label: 'Breakfast', icon: '🍳' }, lunch: { label: 'Lunch', icon: '🥗' }, dinner: { label: 'Dinner', icon: '🍽️' }, snack: { label: 'Snack', icon: '🍫' } };

  var foods = load('tracktify-calories', []);
  foods = Array.isArray(foods) ? foods : [];
  var settings = load('tracktify-calories-settings', null) || { goal: 2000, pg: 0, cg: 0, fg: 0 };
  var editId = null;

  function pad(n) { return String(n).padStart(2, '0'); }
  function key(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  var day = new Date(); // currently viewed day

  function save() { store('tracktify-calories', foods); }
  function saveSettings() { store('tracktify-calories-settings', settings); }
  function num(v) { return parseFloat(v) || 0; }

  var mount = document.getElementById('calorieMount');
  var dayLabel = document.getElementById('calorieDayLabel');

  /* ---- day nav ---- */
  document.getElementById('calPrevDay').addEventListener('click', function () { day.setDate(day.getDate() - 1); render(); });
  document.getElementById('calNextDay').addEventListener('click', function () { day.setDate(day.getDate() + 1); render(); });
  document.getElementById('calTodayBtn').addEventListener('click', function () { day = new Date(); render(); });

  /* ---- entry modal ---- */
  var modal = document.getElementById('calorieModalWrap');
  var form = document.getElementById('calorieForm');
  function openModal(f, meal) {
    editId = f ? f.id : null;
    document.getElementById('calorieModalTitle').textContent = f ? 'Edit Food' : 'Add Food';
    form.reset();
    if (f) {
      form.elements['name'].value = f.name; form.elements['meal'].value = f.meal; form.elements['calories'].value = f.calories;
      form.elements['date'].value = f.date; form.elements['protein'].value = f.protein || ''; form.elements['carbs'].value = f.carbs || ''; form.elements['fat'].value = f.fat || '';
    } else {
      form.elements['date'].value = key(day);
      if (meal) form.elements['meal'].value = meal;
    }
    modal.classList.add('open');
    setTimeout(function () { form.elements['name'].focus(); }, 50);
  }
  function closeModal() { modal.classList.remove('open'); editId = null; }
  document.getElementById('calorieAddBtn').addEventListener('click', function () { openModal(null); });
  document.getElementById('calorieModalClose').addEventListener('click', closeModal);
  document.getElementById('calorieCancelBtn').addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  TT.mobileAdd.calories = function () { openModal(null); };

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData(form));
    if (!d.name.trim() || d.calories === '') { form.elements['name'].focus(); return; }
    var rec = { name: d.name.trim(), meal: d.meal, calories: num(d.calories), date: d.date || key(day), protein: num(d.protein), carbs: num(d.carbs), fat: num(d.fat) };
    if (editId) {
      var i = foods.findIndex(function (x) { return x.id === editId; });
      if (i !== -1) foods[i] = Object.assign({}, foods[i], rec);
      toast('Food updated');
    } else {
      foods.push(Object.assign({ id: uid(), createdAt: Date.now() }, rec));
      toast('Food added', 'success');
    }
    // keep viewing the day we logged to
    day = new Date(rec.date + 'T00:00:00');
    save(); closeModal(); render();
  });

  /* ---- goal modal ---- */
  var gModal = document.getElementById('calorieSettingsWrap');
  var gForm = document.getElementById('calorieSettingsForm');
  document.getElementById('calorieGoalBtn').addEventListener('click', function () {
    gForm.elements['goal'].value = settings.goal; gForm.elements['pg'].value = settings.pg || ''; gForm.elements['cg'].value = settings.cg || ''; gForm.elements['fg'].value = settings.fg || '';
    gModal.classList.add('open');
  });
  function closeGoal() { gModal.classList.remove('open'); }
  document.getElementById('calorieSettingsClose').addEventListener('click', closeGoal);
  document.getElementById('calorieSettingsCancel').addEventListener('click', closeGoal);
  gModal.addEventListener('click', function (e) { if (e.target === gModal) closeGoal(); });
  gForm.addEventListener('submit', function (e) {
    e.preventDefault();
    settings = { goal: num(gForm.elements['goal'].value) || 2000, pg: num(gForm.elements['pg'].value), cg: num(gForm.elements['cg'].value), fg: num(gForm.elements['fg'].value) };
    saveSettings(); closeGoal(); render(); toast('Goals updated');
  });

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeModal(); closeGoal(); } });

  /* ---- ring ---- */
  function ring(pct, color) {
    var C = 2 * Math.PI * 52, len = Math.min(1, pct) * C;
    return '<svg viewBox="0 0 130 130" class="w-ring-svg">' +
      '<circle cx="65" cy="65" r="52" fill="none" stroke="var(--surface-2)" stroke-width="13"/>' +
      '<circle cx="65" cy="65" r="52" fill="none" stroke="' + color + '" stroke-width="13" stroke-linecap="round" stroke-dasharray="' + len + ' ' + (C - len) + '" transform="rotate(-90 65 65)"/></svg>';
  }
  function macroBar(label, val, goal, color) {
    var pct = goal > 0 ? Math.min(100, (val / goal) * 100) : 0;
    return '<div class="macro"><div class="macro-top"><span>' + label + '</span><span>' + Math.round(val) + 'g' + (goal > 0 ? ' / ' + goal + 'g' : '') + '</span></div>' +
      '<div class="budget-bar"><span class="budget-fill" style="width:' + (goal > 0 ? pct : 0) + '%;background:' + color + '"></span></div></div>';
  }

  function render() {
    var k = key(day);
    var isToday = k === key(new Date());
    dayLabel.textContent = isToday ? 'Today' : day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    var list = foods.filter(function (f) { return f.date === k; });
    var cals = list.reduce(function (s, f) { return s + f.calories; }, 0);
    var P = list.reduce(function (s, f) { return s + (f.protein || 0); }, 0);
    var Cc = list.reduce(function (s, f) { return s + (f.carbs || 0); }, 0);
    var F = list.reduce(function (s, f) { return s + (f.fat || 0); }, 0);
    var goal = settings.goal || 0;
    var pct = goal ? cals / goal : 0;
    var remain = goal - cals;
    var color = goal && cals > goal ? '#dc2626' : '#16a34a';

    // 7-day trend
    var max = Math.max(goal, 1), seven = [];
    for (var i = 6; i >= 0; i--) { var d = new Date(); d.setDate(d.getDate() - i); var dk = key(d); var c = foods.filter(function (f) { return f.date === dk; }).reduce(function (s, f) { return s + f.calories; }, 0); seven.push({ d: d, c: c }); max = Math.max(max, c); }
    var bars = seven.map(function (o) {
      var h = Math.round((o.c / max) * 70), over = goal && o.c > goal;
      return '<div class="w-bar-col"><div class="w-bar-track"><div class="w-bar" style="height:' + h + 'px;background:' + (over ? '#dc2626' : '#16a34a') + '"></div></div><span class="w-bar-lbl">' + ['S','M','T','W','T','F','S'][o.d.getDay()] + '</span></div>';
    }).join('');

    // meal groups
    var groups = Object.keys(MEALS).map(function (mk) {
      var items = list.filter(function (f) { return f.meal === mk; });
      var sub = items.reduce(function (s, f) { return s + f.calories; }, 0);
      var rows = items.length ? items.map(function (f) {
        return '<li class="cal-food" data-id="' + f.id + '"><span class="cal-food-name">' + esc(f.name) + '</span>' +
          '<span class="cal-food-cal">' + Math.round(f.calories) + '</span>' +
          '<button class="ic-btn" data-a="edit" title="Edit">✏️</button><button class="ic-btn del" data-a="del" title="Delete">🗑️</button></li>';
      }).join('') : '<li class="cal-food-empty">—</li>';
      return '<div class="cal-meal"><div class="cal-meal-head"><span>' + MEALS[mk].icon + ' ' + MEALS[mk].label + '</span>' +
        '<span class="cal-meal-sub">' + Math.round(sub) + ' kcal <button class="cal-meal-add" data-meal="' + mk + '" title="Add to ' + MEALS[mk].label + '">+</button></span></div>' +
        '<ul class="cal-food-list">' + rows + '</ul></div>';
    }).join('');

    mount.innerHTML =
      '<div class="summary">' +
        '<div class="chip"><span class="chip-n" style="color:' + color + '">' + Math.round(cals) + '</span><span class="chip-l">of ' + (goal || '—') + ' kcal</span></div>' +
        '<div class="chip"><span class="chip-n" style="color:' + (remain < 0 ? '#dc2626' : '#16a34a') + '">' + (goal ? (remain < 0 ? '−' : '') + Math.abs(Math.round(remain)) : '—') + '</span><span class="chip-l">' + (remain < 0 ? 'over' : 'remaining') + '</span></div>' +
        '<div class="chip"><span class="chip-n" style="color:var(--accent)">' + list.length + '</span><span class="chip-l">items</span></div>' +
      '</div>' +
      '<div class="w-grid">' +
        '<div class="card w-ring-card"><div class="w-ring">' + ring(pct, color) + '<div class="w-ring-lbl"><strong>' + Math.round(cals) + '</strong><span>' + (goal ? 'of ' + goal : 'kcal') + '</span></div></div></div>' +
        '<div class="card"><h3 class="card-h">Macros</h3>' + macroBar('Protein', P, settings.pg, '#7c3aed') + macroBar('Carbs', Cc, settings.cg, '#0891b2') + macroBar('Fat', F, settings.fg, '#d97706') + '</div>' +
      '</div>' +
      '<div class="card"><h3 class="card-h">Meals</h3>' + groups + '</div>' +
      '<div class="card"><h3 class="card-h">Last 7 days</h3><div class="w-bars">' + bars + '</div></div>';

    mount.querySelectorAll('.cal-meal-add').forEach(function (b) { b.addEventListener('click', function () { openModal(null, b.getAttribute('data-meal')); }); });
    mount.querySelectorAll('.cal-food').forEach(function (li) {
      var f = foods.find(function (x) { return x.id === li.getAttribute('data-id'); });
      li.querySelector('[data-a="edit"]').addEventListener('click', function () { openModal(f); });
      li.querySelector('[data-a="del"]').addEventListener('click', function () { foods = foods.filter(function (x) { return x.id !== f.id; }); save(); render(); toast('Food removed'); });
    });
  }

  document.addEventListener('tt:view', function (e) { if (e.detail === 'calories') render(); });
  document.addEventListener('tt:theme', function () { if (TT.view === 'calories') render(); });
  render();
})();
