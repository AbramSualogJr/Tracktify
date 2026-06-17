/* ============================================================
   Tracktify — Custom tracker builder (schema-driven)
   Lets users define their own trackers. One generic engine
   renders every custom tracker from its field schema, reusing
   the same add/edit/list/summary machinery as the built-ins.

   Model:
     tracktify-custom-defs = [{ id, name, icon, color,
       fields:[{ id, label, type, options:[] }], createdAt }]
     tracktify-custom-data = { <defId>: [ { id, _title,
       <fieldId>:value, createdAt } ] }
   Field types: text | number | date | select | checkbox | notes
   ============================================================ */
(function () {
  'use strict';
  if (!document.getElementById('view-custom')) return;

  var TT = window.TT;
  var esc = TT.esc, uid = TT.uid, load = TT.load, store = TT.store, toast = TT.toast, fmtDate = TT.fmtDate;
  var SWATCHES = ['#7c3aed','#2563eb','#0891b2','#0d9488','#16a34a','#65a30d','#ca8a04','#d97706','#dc2626','#db2777'];
  var TYPE_LABEL = { text: 'Text', number: 'Number', date: 'Date', select: 'Select', checkbox: 'Checkbox', notes: 'Notes' };

  var defs = load('tracktify-custom-defs', []);
  defs = Array.isArray(defs) ? defs.filter(function (d) { return d && d.id; }) : [];
  var data = load('tracktify-custom-data', {});
  if (!data || typeof data !== 'object') data = {};

  var search = '', filterVal = 'all', activeFilterDef = null;

  function saveDefs() { store('tracktify-custom-defs', defs); }
  function saveData() { store('tracktify-custom-data', data); }
  function entriesOf(id) { return Array.isArray(data[id]) ? data[id] : (data[id] = []); }
  function defById(id) { for (var i = 0; i < defs.length; i++) if (defs[i].id === id) return defs[i]; return null; }
  function activeId() { return TT.navKey && TT.navKey.indexOf('custom:') === 0 ? TT.navKey.slice(7) : null; }
  function activeDef() { return defById(activeId()); }

  var mount = document.getElementById('customMount');
  var navMount = document.getElementById('customNav');

  /* ============================================================
     Sidebar nav buttons (one per custom tracker)
  ============================================================ */
  function renderNav() {
    navMount.innerHTML = defs.map(function (d) {
      return '<button class="nav-item" data-tracker="custom" data-custom-id="' + d.id + '" data-title="' + esc(d.name) + '">' +
        '<span>' + (d.icon || '🧩') + '</span> ' + esc(d.name) + '</button>';
    }).join('');
    TT.bindNav();   // wire the freshly-added buttons with the shared handler
  }

  /* ============================================================
     Builder modal (define / edit a tracker)
  ============================================================ */
  var bModal = document.getElementById('customBuilderWrap');
  var bForm = document.getElementById('customBuilderForm');
  var fieldsMount = document.getElementById('cbf-fields');
  var builderEditId = null;

  function builderColors(chosen) {
    var m = document.getElementById('cbf-colors');
    m.innerHTML = SWATCHES.map(function (c) { return '<button type="button" class="swatch' + (c === chosen ? ' on' : '') + '" data-col="' + c + '" style="background:' + c + '"></button>'; }).join('');
    document.getElementById('cbf-color').value = chosen;
    m.querySelectorAll('.swatch').forEach(function (b) { b.addEventListener('click', function () { document.getElementById('cbf-color').value = b.getAttribute('data-col'); m.querySelectorAll('.swatch').forEach(function (x) { x.classList.toggle('on', x === b); }); }); });
  }
  function addFieldRow(f) {
    f = f || { label: '', type: document.getElementById('cbf-fieldtype').value, options: [] };
    var row = document.createElement('div');
    row.className = 'field-row';
    row.setAttribute('data-type', f.type);
    if (f.id) row.setAttribute('data-id', f.id);
    row.innerHTML =
      '<input class="fr-label" placeholder="Field name" value="' + esc(f.label || '') + '" />' +
      '<span class="fr-type">' + TYPE_LABEL[f.type] + '</span>' +
      (f.type === 'select' ? '<input class="fr-options" placeholder="Option 1, Option 2" value="' + esc((f.options || []).join(', ')) + '" />' : '') +
      '<button type="button" class="ic-btn del fr-del" title="Remove">✕</button>';
    row.querySelector('.fr-del').addEventListener('click', function () { row.remove(); });
    fieldsMount.appendChild(row);
  }
  document.getElementById('cbf-add-field').addEventListener('click', function () { addFieldRow(); });

  function collectFields() {
    return Array.prototype.map.call(fieldsMount.querySelectorAll('.field-row'), function (row) {
      var label = row.querySelector('.fr-label').value.trim();
      if (!label) return null;
      var type = row.getAttribute('data-type');
      var opts = row.querySelector('.fr-options');
      return { id: row.getAttribute('data-id') || uid().slice(0, 8), label: label, type: type, options: opts ? opts.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [] };
    }).filter(Boolean);
  }

  function openBuilder(def) {
    builderEditId = def ? def.id : null;
    document.getElementById('customBuilderTitle').textContent = def ? 'Edit Tracker' : 'New Tracker';
    bForm.reset(); fieldsMount.innerHTML = '';
    if (def) {
      bForm.elements['name'].value = def.name; bForm.elements['icon'].value = def.icon || '';
      (def.fields || []).forEach(addFieldRow);
    } else {
      // sensible starter fields
      addFieldRow({ label: 'Notes', type: 'notes', options: [] });
    }
    builderColors(def && def.color ? def.color : SWATCHES[0]);
    bModal.classList.add('open');
    setTimeout(function () { bForm.elements['name'].focus(); }, 50);
  }
  function closeBuilder() { bModal.classList.remove('open'); builderEditId = null; }
  document.getElementById('newTrackerBtn').addEventListener('click', function () { openBuilder(null); });
  document.getElementById('customBuilderClose').addEventListener('click', closeBuilder);
  document.getElementById('customBuilderCancel').addEventListener('click', closeBuilder);
  bModal.addEventListener('click', function (e) { if (e.target === bModal) closeBuilder(); });

  bForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData(bForm));
    if (!d.name.trim()) { bForm.elements['name'].focus(); return; }
    var rec = { name: d.name.trim(), icon: d.icon || '🧩', color: d.color, fields: collectFields() };
    var id;
    if (builderEditId) {
      var i = defs.findIndex(function (x) { return x.id === builderEditId; }); id = builderEditId;
      if (i !== -1) defs[i] = Object.assign({}, defs[i], rec);
      toast('Tracker updated');
    } else {
      id = uid(); defs.push(Object.assign({ id: id, createdAt: Date.now() }, rec)); data[id] = [];
      toast('Tracker created', 'success');
    }
    saveDefs(); saveData(); renderNav(); closeBuilder();
    TT.switchView('custom', 'custom:' + id, rec.name);
    renderView();
  });

  /* ============================================================
     Entry modal (fields generated from the schema)
  ============================================================ */
  var eModal = document.getElementById('customEntryWrap');
  var eForm = document.getElementById('customEntryForm');
  var eFields = document.getElementById('customEntryFields');
  var entryEditId = null;

  function fieldControl(f, val) {
    var id = 'ce-' + f.id;
    if (f.type === 'number') return '<input id="' + id + '" type="number" step="any" value="' + esc(val != null ? val : '') + '" />';
    if (f.type === 'date') return '<input id="' + id + '" type="date" value="' + esc(val || '') + '" />';
    if (f.type === 'checkbox') return '<label class="switch-row"><input id="' + id + '" type="checkbox"' + (val ? ' checked' : '') + ' /> <span>Yes</span></label>';
    if (f.type === 'notes') return '<textarea id="' + id + '" rows="2">' + esc(val || '') + '</textarea>';
    if (f.type === 'select') return '<select id="' + id + '">' + (f.options || []).map(function (o) { return '<option value="' + esc(o) + '"' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    return '<input id="' + id + '" type="text" value="' + esc(val || '') + '" />';
  }

  function openEntry(def, entry) {
    entryEditId = entry ? entry.id : null;
    document.getElementById('customEntryTitle').textContent = entry ? 'Edit Entry' : 'Add Entry';
    var html = '<div class="field"><label for="ce-_title">Title <span class="req">*</span></label><input id="ce-_title" type="text" placeholder="Entry name" value="' + esc(entry ? entry._title : '') + '" required /></div>';
    def.fields.forEach(function (f) {
      html += '<div class="field"><label for="ce-' + f.id + '">' + esc(f.label) + '</label>' + fieldControl(f, entry ? entry[f.id] : undefined) + '</div>';
    });
    eFields.innerHTML = html;
    eModal.classList.add('open');
    setTimeout(function () { document.getElementById('ce-_title').focus(); }, 50);
  }
  function closeEntry() { eModal.classList.remove('open'); entryEditId = null; }
  document.getElementById('customEntryClose').addEventListener('click', closeEntry);
  document.getElementById('customEntryCancel').addEventListener('click', closeEntry);
  eModal.addEventListener('click', function (e) { if (e.target === eModal) closeEntry(); });
  TT.mobileAdd.custom = function () { var def = activeDef(); if (def) openEntry(def, null); };

  eForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var def = activeDef(); if (!def) return;
    var title = document.getElementById('ce-_title').value.trim();
    if (!title) { document.getElementById('ce-_title').focus(); return; }
    var rec = { _title: title };
    def.fields.forEach(function (f) {
      var el = document.getElementById('ce-' + f.id);
      if (!el) return;
      rec[f.id] = f.type === 'checkbox' ? el.checked : el.value;
    });
    var list = entriesOf(def.id);
    if (entryEditId) {
      var i = list.findIndex(function (x) { return x.id === entryEditId; });
      if (i !== -1) list[i] = Object.assign({}, list[i], rec, { id: entryEditId });
      toast('Entry updated');
    } else {
      list.push(Object.assign({ id: uid(), createdAt: Date.now() }, rec));
      toast('Entry added', 'success');
    }
    saveData(); closeEntry(); renderView();
  });

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeBuilder(); closeEntry(); } });

  /* ============================================================
     View render (header + summary + filter + list)
  ============================================================ */
  function displayVal(f, v) {
    if (v == null || v === '') return '';
    if (f.type === 'checkbox') return v ? '✓' : '✗';
    if (f.type === 'date') return fmtDate(v);
    return v;
  }

  function renderView() {
    var def = activeDef();
    if (!def) { mount.innerHTML = '<div class="empty show"><div class="empty-icon">🧩</div><h2>Pick a tracker</h2><p>Select a custom tracker from the sidebar, or create a new one.</p></div>'; return; }

    if (activeFilterDef !== def.id) { filterVal = 'all'; search = ''; activeFilterDef = def.id; }
    var list = entriesOf(def.id);
    var selField = def.fields.filter(function (f) { return f.type === 'select'; })[0];

    // summary: count + sums of numeric fields
    var numFields = def.fields.filter(function (f) { return f.type === 'number'; }).slice(0, 3);
    var chips = '<div class="chip"><span class="chip-n" style="color:' + def.color + '">' + list.length + '</span><span class="chip-l">entries</span></div>';
    numFields.forEach(function (f) {
      var sum = list.reduce(function (s, e) { return s + (parseFloat(e[f.id]) || 0); }, 0);
      chips += '<div class="chip"><span class="chip-n" style="color:var(--accent)">' + (Math.round(sum * 100) / 100) + '</span><span class="chip-l">Σ ' + esc(f.label) + '</span></div>';
    });

    var filters = '';
    if (selField) {
      filters = '<div class="filters" id="customFilters"><button class="f-btn' + (filterVal === 'all' ? ' active' : '') + '" data-f="all">All</button>' +
        selField.options.map(function (o) { return '<button class="f-btn' + (filterVal === o ? ' active' : '') + '" data-f="' + esc(o) + '">' + esc(o) + '</button>'; }).join('') + '</div>';
    }

    mount.innerHTML =
      '<div class="page-top"><div><h1>' + (def.icon || '🧩') + ' ' + esc(def.name) + '</h1><p>' + list.length + ' entr' + (list.length === 1 ? 'y' : 'ies') + '</p></div>' +
        '<div class="page-top-right">' +
          '<button class="ev-today-btn" data-a="editTracker">⚙ Edit</button>' +
          '<button class="ic-btn del" data-a="delTracker" title="Delete tracker">🗑️</button>' +
          '<button class="btn-add" data-a="addEntry">+ Add Entry</button>' +
        '</div></div>' +
      '<div class="summary">' + chips + '</div>' +
      '<input class="txn-search" id="customSearch" type="search" placeholder="🔍  Search entries..." value="' + esc(search) + '" style="margin-bottom:14px" />' +
      filters +
      '<div class="empty' + (list.length ? '' : ' show') + '"><div class="empty-icon">' + (def.icon || '🧩') + '</div><h2>No entries yet</h2><p>Add your first ' + esc(def.name) + ' entry.</p><button class="btn-add" data-a="addEntry2">+ Add Entry</button></div>' +
      '<ul class="item-list" id="customList"></ul>';

    // header actions
    mount.querySelector('[data-a="editTracker"]').addEventListener('click', function () { openBuilder(def); });
    mount.querySelector('[data-a="addEntry"]').addEventListener('click', function () { openEntry(def, null); });
    var add2 = mount.querySelector('[data-a="addEntry2"]'); if (add2) add2.addEventListener('click', function () { openEntry(def, null); });
    mount.querySelector('[data-a="delTracker"]').addEventListener('click', function () {
      if (!confirm('Delete the "' + def.name + '" tracker and all its entries?')) return;
      defs = defs.filter(function (x) { return x.id !== def.id; }); delete data[def.id];
      saveDefs(); saveData(); renderNav(); TT.switchView('jobs'); toast('Tracker deleted');
    });
    var searchEl = document.getElementById('customSearch');
    searchEl.addEventListener('input', function () { search = searchEl.value.toLowerCase(); renderList(def, selField); });
    if (selField) {
      mount.querySelectorAll('#customFilters .f-btn').forEach(function (b) {
        b.addEventListener('click', function () { filterVal = b.getAttribute('data-f'); mount.querySelectorAll('#customFilters .f-btn').forEach(function (x) { x.classList.toggle('active', x === b); }); renderList(def, selField); });
      });
    }
    renderList(def, selField);
  }

  function renderList(def, selField) {
    var ul = document.getElementById('customList'); if (!ul) return;
    var list = entriesOf(def.id).slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    if (selField && filterVal !== 'all') list = list.filter(function (e) { return e[selField.id] === filterVal; });
    if (search) list = list.filter(function (e) {
      var hay = (e._title + ' ' + def.fields.map(function (f) { return e[f.id]; }).join(' ')).toLowerCase();
      return hay.indexOf(search) !== -1;
    });
    ul.innerHTML = '';
    list.forEach(function (e) { ul.appendChild(entryRow(def, e)); });
    if (!list.length) ul.innerHTML = '<p class="no-match">No matching entries.</p>';
  }

  function entryRow(def, e) {
    var li = document.createElement('li');
    li.className = 'exp-row';
    li.style.borderLeftColor = def.color;
    var notesField = null;
    var pills = def.fields.map(function (f) {
      if (f.type === 'notes') { notesField = e[f.id]; return ''; }
      var v = displayVal(f, e[f.id]);
      if (v === '') return '';
      return '<span class="cust-pill"><b>' + esc(f.label) + ':</b> ' + esc(v) + '</span>';
    }).filter(Boolean).join('');
    li.innerHTML =
      '<div class="exp-main"><div><div class="exp-desc">' + esc(e._title) + '</div>' +
        (pills ? '<div class="exp-meta">' + pills + '</div>' : '') +
        (notesField ? '<div class="exp-notes">' + esc(notesField) + '</div>' : '') + '</div></div>' +
      '<div class="exp-actions"><button class="ic-btn" data-a="edit" title="Edit">✏️</button><button class="ic-btn del" data-a="del" title="Delete">🗑️</button></div>';
    li.querySelector('[data-a="edit"]').addEventListener('click', function () { openEntry(def, e); });
    li.querySelector('[data-a="del"]').addEventListener('click', function () {
      if (!confirm('Delete "' + e._title + '"?')) return;
      data[def.id] = entriesOf(def.id).filter(function (x) { return x.id !== e.id; }); saveData(); renderView(); toast('Entry deleted');
    });
    return li;
  }

  /* ============================================================
     Init
  ============================================================ */
  document.addEventListener('tt:view', function (e) { if (e.detail === 'custom') renderView(); });
  renderNav();
})();
