/* ============================================================
   Tracktify — Expenses module
   Tabs: Overview · Transactions · Calendar · Budgets · Goals
         · Recurring · Reports · Settings
   Depends on window.TT (esc, uid, fmtDate, load, store, toast).
   ============================================================ */
(function () {
  'use strict';
  if (!document.getElementById('view-expenses')) return;

  var TT    = window.TT;
  var esc   = TT.esc, uid = TT.uid, load = TT.load, store = TT.store, toast = TT.toast;

  /* ============================================================
     1. DEFAULTS
  ============================================================ */
  var DEFAULT_CATS = {
    expense: [
      { id: 'food',          label: 'Food & Dining', icon: '🍔', color: '#7c3aed' },
      { id: 'housing',       label: 'Housing',       icon: '🏠', color: '#6366f1' },
      { id: 'transport',     label: 'Transport',     icon: '🚗', color: '#d97706' },
      { id: 'health',        label: 'Health',        icon: '💊', color: '#db2777' },
      { id: 'entertainment', label: 'Entertainment', icon: '🎬', color: '#0891b2' },
      { id: 'shopping',      label: 'Shopping',      icon: '🛍️', color: '#9333ea' },
      { id: 'education',     label: 'Education',     icon: '📚', color: '#2563eb' },
      { id: 'travel',        label: 'Travel',        icon: '✈️', color: '#0d9488' },
      { id: 'subscriptions', label: 'Subscriptions', icon: '🔁', color: '#0ea5e9' },
      { id: 'others',        label: 'Others',        icon: '📦', color: '#64748b' }
    ],
    income: [
      { id: 'salary',       label: 'Salary',    icon: '💼', color: '#16a34a' },
      { id: 'freelance',    label: 'Freelance', icon: '💻', color: '#059669' },
      { id: 'business',     label: 'Business',  icon: '🏪', color: '#0d9488' },
      { id: 'gifts',        label: 'Gifts',     icon: '🎁', color: '#ca8a04' },
      { id: 'refunds',      label: 'Refunds',   icon: '↩️', color: '#65a30d' },
      { id: 'other-income', label: 'Other',     icon: '💰', color: '#22c55e' }
    ]
  };

  var DEFAULT_ACCOUNTS = [
    { id: 'cash',   label: 'Cash',        icon: '💵' },
    { id: 'gcash',  label: 'GCash',       icon: '📱' },
    { id: 'bank',   label: 'Bank',        icon: '🏦' },
    { id: 'credit', label: 'Credit Card', icon: '💳' },
    { id: 'debit',  label: 'Debit Card',  icon: '💳' },
    { id: 'wallet', label: 'E-Wallet',    icon: '👛' }
  ];

  var DEFAULT_CURRENCIES = {
    USD: { symbol: '$',  rate: 1 },
    EUR: { symbol: '€',  rate: 1.08 },
    GBP: { symbol: '£',  rate: 1.27 },
    JPY: { symbol: '¥',  rate: 0.0064 },
    PHP: { symbol: '₱',  rate: 0.0177 },
    AUD: { symbol: 'A$', rate: 0.66 },
    CAD: { symbol: 'C$', rate: 0.73 },
    SGD: { symbol: 'S$', rate: 0.74 }
  };

  var WIDGETS = [
    { id: 'category', name: 'Category Breakdown' },
    { id: 'trend',    name: 'Spending Trend' },
    { id: 'budget',   name: 'Budget Progress' },
    { id: 'goals',    name: 'Savings Goals' },
    { id: 'recent',   name: 'Recent Transactions' },
    { id: 'insight',  name: 'Smart Insight' }
  ];

  var SWATCHES = ['#7c3aed','#6366f1','#2563eb','#0891b2','#0d9488','#16a34a',
                  '#65a30d','#ca8a04','#d97706','#dc2626','#db2777','#9333ea','#64748b'];

  /* ============================================================
     2. STATE
  ============================================================ */
  var txns = load('tracktify-expenses', []);
  // migrate legacy fields
  txns.forEach(function (t) {
    if (t.currency == null) t.currency = 'USD';
    if (t.tags == null) t.tags = [];
    if (t.type === 'income' && (!t.category || t.category === 'income')) t.category = 'other-income';
  });

  var settings = load('tracktify-exp-settings', null) || {};
  settings.primary    = settings.primary    || 'USD';
  settings.currencies = settings.currencies || JSON.parse(JSON.stringify(DEFAULT_CURRENCIES));
  settings.categories = settings.categories || JSON.parse(JSON.stringify(DEFAULT_CATS));
  settings.accounts   = settings.accounts   || JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
  settings.widgets    = settings.widgets    || { category:true, trend:true, budget:true, goals:true, recent:true, insight:true };
  settings.widgetOrder= settings.widgetOrder|| WIDGETS.map(function (w) { return w.id; });

  var budgets = load('tracktify-budgets', null) || { monthly: 0, categories: {} };
  var goals   = load('tracktify-goals', []);
  var recurring = load('tracktify-recurring', []);

  var state = {
    tab: 'overview',
    txnFilter: { q: '', type: 'all', cat: 'all', pay: 'all', sort: 'date-desc' },
    cal: { y: new Date().getFullYear(), m: new Date().getMonth(), view: 'calendar' },
    reportChart: 'donut',
    reportPeriod: 'month',
    reportFrom: '', reportTo: '',
    goalArchived: false,
    receiptUri: ''   // pending receipt URI in modal (object-storage ref, not base64)
  };

  function saveTxns()    { store('tracktify-expenses', txns); }
  function saveSettings(){ store('tracktify-exp-settings', settings); }
  function saveBudgets() { store('tracktify-budgets', budgets); }
  function saveGoals()   { store('tracktify-goals', goals); }
  function saveRecurring(){ store('tracktify-recurring', recurring); }

  // One-time upgrade: convert legacy FLOAT amounts to integer minor units.
  // Guarded by a per-user flag (lives in settings) so it runs exactly once.
  function migrateMoney() {
    if (settings._moneyMinor) return;
    // Safety net: the done-flag lives in `settings`, which can be reset or lost
    // independently of the data (e.g. an account migration). Without this guard a
    // lost flag would re-multiply ALREADY-minor amounts by 100 and corrupt every
    // value. Minor-unit amounts are always integers; the legacy float data this
    // targets has decimals. So if everything is already integral, treat it as
    // already migrated and only (re)set the flag — never multiply.
    var nums = txns.map(function (t) { return t.amount; })
      .concat(recurring.map(function (r) { return r.amount; }))
      .concat(goals.map(function (g) { return g.target; }), goals.map(function (g) { return g.saved; }))
      .concat([budgets.monthly || 0])
      .concat(Object.keys(budgets.categories || {}).map(function (k) { return budgets.categories[k]; }));
    var alreadyMinor = nums.every(function (n) { return Number.isInteger(Number(n)); });
    if (!alreadyMinor) {
      txns.forEach(function (t) { t.amount = Math.round((Number(t.amount) || 0) * 100); });
      recurring.forEach(function (r) { r.amount = Math.round((Number(r.amount) || 0) * 100); });
      if (budgets.monthly) budgets.monthly = Math.round(budgets.monthly * 100);
      Object.keys(budgets.categories || {}).forEach(function (k) { budgets.categories[k] = Math.round(budgets.categories[k] * 100); });
      goals.forEach(function (g) { g.target = Math.round((Number(g.target) || 0) * 100); g.saved = Math.round((Number(g.saved) || 0) * 100); });
    }
    settings._moneyMinor = true;
    saveTxns(); saveRecurring(); saveBudgets(); saveGoals(); saveSettings();
  }

  /* ============================================================
     3. HELPERS
  ============================================================ */
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return ymd(new Date()); }
  function monthKey(s) { return s ? s.slice(0, 7) : ''; }
  function curMonthKey() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }

  // --- Money as integer MINOR units (cents) ---------------------------------
  // WHY: floating-point currency drifts (0.1 + 0.2 !== 0.3). Every stored
  // amount is an integer number of cents; we only produce a decimal STRING at
  // the render boundary (money / moneyP). Inputs are converted with toMinor().
  function toMinor(majorStr) { return Math.round((parseFloat(majorStr) || 0) * 100); } // "12.50" -> 1250
  function toMajor(minor) { return (Number(minor) || 0) / 100; }                         // only for prefilling inputs
  function nf(minor) { return toMajor(minor).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function sym(code) { var c = settings.currencies[code || settings.primary]; return c ? c.symbol : (code + ' '); }
  function money(minor, code) { return sym(code) + nf(minor); }   // format at the edge — never store decimals
  function moneyP(minor) { return money(minor, settings.primary); }

  // Convert integer minor units in `code` to integer minor units in the primary
  // currency. Rounds ONCE so downstream sums never accumulate fractional cents.
  function toPrimary(minor, code) {
    if (!code || code === settings.primary) return Number(minor) || 0;
    var c = settings.currencies[code];
    return Math.round((Number(minor) || 0) * (c ? c.rate : 1));
  }

  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function catMeta(type, id) {
    var list = settings.categories[type === 'income' ? 'income' : 'expense'] || [];
    var found = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { found = list[i]; break; }
    if (found) return found;
    return type === 'income'
      ? { id: id, label: 'Income', icon: '💰', color: '#16a34a' }
      : { id: id, label: 'Uncategorized', icon: '📦', color: '#64748b' };
  }
  function acctMeta(id) {
    for (var i = 0; i < settings.accounts.length; i++) if (settings.accounts[i].id === id) return settings.accounts[i];
    return { id: id, label: id || '', icon: '' };
  }

  function addToDate(dateStr, freq) {
    var d = new Date(dateStr + 'T00:00:00');
    if (freq === 'daily')      d.setDate(d.getDate() + 1);
    else if (freq === 'weekly')d.setDate(d.getDate() + 7);
    else if (freq === 'monthly')   d.setMonth(d.getMonth() + 1);
    else if (freq === 'quarterly') d.setMonth(d.getMonth() + 3);
    else if (freq === 'yearly')    d.setFullYear(d.getFullYear() + 1);
    return ymd(d);
  }

  /* Populate <select>s ---------------------------------------- */
  function fillCurrencySelect(sel) {
    sel.innerHTML = Object.keys(settings.currencies).map(function (code) {
      return '<option value="' + code + '">' + code + ' (' + settings.currencies[code].symbol + ')</option>';
    }).join('');
    sel.value = settings.primary;
  }
  function fillCatSelect(sel, type) {
    var list = settings.categories[type === 'income' ? 'income' : 'expense'] || [];
    sel.innerHTML = list.map(function (c) {
      return '<option value="' + c.id + '">' + c.icon + ' ' + esc(c.label) + '</option>';
    }).join('');
  }
  function fillAccountSelect(sel) {
    sel.innerHTML = settings.accounts.map(function (a) {
      return '<option value="' + a.id + '">' + a.icon + ' ' + esc(a.label) + '</option>';
    }).join('');
  }

  /* Sortable (drag to reorder) -------------------------------- */
  function sortable(container, onReorder) {
    var dragEl = null;
    Array.prototype.forEach.call(container.querySelectorAll('[draggable="true"]'), function (el) {
      el.addEventListener('dragstart', function () { dragEl = el; setTimeout(function(){ el.classList.add('dragging'); }, 0); });
      el.addEventListener('dragend', function () { el.classList.remove('dragging'); dragEl = null;
        onReorder(Array.prototype.map.call(container.children, function (c) { return c.getAttribute('data-id'); }).filter(Boolean));
      });
    });
    container.addEventListener('dragover', function (e) {
      e.preventDefault();
      if (!dragEl) return;
      var after = getAfter(container, e.clientY);
      if (after == null) container.appendChild(dragEl);
      else container.insertBefore(dragEl, after);
    });
    function getAfter(c, y) {
      var els = Array.prototype.slice.call(c.querySelectorAll('[draggable="true"]:not(.dragging)'));
      var best = { offset: -Infinity, el: null };
      els.forEach(function (child) {
        var box = child.getBoundingClientRect();
        var offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > best.offset) best = { offset: offset, el: child };
      });
      return best.el;
    }
  }

  /* ============================================================
     4. RECURRING — materialize due occurrences
  ============================================================ */
  function runRecurring() {
    var today = todayStr();
    var created = 0;
    recurring.forEach(function (r) {
      if (r.active === false || !r.nextDate) return;
      var guard = 0;
      while (r.nextDate <= today && guard < 120) {
        txns.push({
          id: uid(), type: r.type, amount: Number(r.amount) || 0, currency: r.currency || settings.primary,
          description: r.description, category: r.category, account: r.account, tags: ['recurring'],
          notes: 'Auto from recurring (' + r.kind + ')', date: r.nextDate, recurringId: r.id, createdAt: Date.now()
        });
        created++;
        r.nextDate = addToDate(r.nextDate, r.frequency);
        guard++;
      }
    });
    if (created) { saveTxns(); saveRecurring(); toast(created + ' recurring entr' + (created === 1 ? 'y' : 'ies') + ' added', 'success'); }
  }

  // Recurring catch-up is heavy historical iteration → a server cron/worker
  // owns it in cloud mode. Locally the scheduler runs runRecurring() above as
  // the dev stand-in (keeps the while-loop OFF the main thread's critical path
  // conceptually, and out of the client entirely once MODE === 'http').
  function catchUpRecurring() { TT.scheduler.recurringCatchup('expenses', runRecurring); }

  /* ============================================================
     5. TAB SWITCHING
  ============================================================ */
  var tabBtns = document.querySelectorAll('.exp-tab');
  var panels  = document.querySelectorAll('.exp-panel');
  tabBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.tab = btn.getAttribute('data-tab');
      tabBtns.forEach(function (b) { b.classList.toggle('active', b === btn); });
      panels.forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== state.tab; });
      renderTab();
    });
  });
  function renderTab() {
    if (state.tab === 'overview')     renderOverview();
    else if (state.tab === 'transactions') renderTxns();
    else if (state.tab === 'calendar') renderCalendar();
    else if (state.tab === 'budgets')  renderBudgets();
    else if (state.tab === 'goals')    renderGoals();
    else if (state.tab === 'recurring')renderRecurring();
    else if (state.tab === 'reports')  renderReport();
    else if (state.tab === 'settings') renderSettings();
  }

  /* ============================================================
     6. TRANSACTION MODAL
  ============================================================ */
  var txnModal = document.getElementById('txnModalWrap');
  var txnForm  = document.getElementById('txnForm');
  var txnTypeToggle = document.getElementById('txnTypeToggle');
  var tfCat = document.getElementById('tf-cat');
  var tfCur = document.getElementById('tf-currency');
  var tfAcc = document.getElementById('tf-account');
  var receiptPreview = document.getElementById('receiptPreview');
  var receiptImg = document.getElementById('receiptImg');
  var txnEditId = null;

  function setTxnType(type) {
    txnForm.elements['type'].value = type;
    txnTypeToggle.querySelectorAll('.type-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-type') === type);
    });
    fillCatSelect(tfCat, type);
  }

  function openTxnModal(txn, opts) {
    opts = opts || {};
    txnEditId = txn ? txn.id : null;
    document.getElementById('txnModalTitle').textContent = txn ? 'Edit Transaction' : 'Add Transaction';
    txnForm.reset();
    state.receiptUri = '';
    receiptPreview.hidden = true;
    fillCurrencySelect(tfCur);
    fillAccountSelect(tfAcc);

    var type = txn ? txn.type : (opts.type || 'expense');
    setTxnType(type);

    if (txn) {
      txnForm.elements['id'].value = txn.id;
      txnForm.elements['amount'].value = toMajor(txn.amount); // minor → major for the input field
      txnForm.elements['date'].value = txn.date || '';
      txnForm.elements['description'].value = txn.description || '';
      tfCur.value = txn.currency || settings.primary;
      tfCat.value = txn.category;
      tfAcc.value = txn.account;
      txnForm.elements['tags'].value = (txn.tags || []).join(', ');
      txnForm.elements['notes'].value = txn.notes || '';
      // Receipts are referenced by URI now; resolve to a displayable src.
      // Legacy base64 records still render via the fallback in resolve().
      state.receiptUri = txn.receiptUri || '';
      var existingSrc = TT.uploads.resolve(txn.receiptUri || '') || txn.receipt || '';
      if (existingSrc) { receiptImg.src = existingSrc; receiptPreview.hidden = false; }
    } else {
      txnForm.elements['date'].value = opts.date || todayStr();
      tfCur.value = settings.primary;
    }
    txnModal.classList.add('open');
    setTimeout(function () { txnForm.elements['amount'].focus(); }, 50);
  }
  function closeTxnModal() { txnModal.classList.remove('open'); txnEditId = null; state.receiptUri = ''; }

  txnTypeToggle.querySelectorAll('.type-btn').forEach(function (b) {
    b.addEventListener('click', function () { setTxnType(b.getAttribute('data-type')); });
  });

  document.getElementById('tf-receipt').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    // Media pipeline: push bytes through the upload service (multipart → object
    // storage in cloud mode) and keep ONLY the returned URI on the record.
    TT.uploads.upload(file).then(function (uri) {
      state.receiptUri = uri;
      receiptImg.src = TT.uploads.resolve(uri);
      receiptPreview.hidden = false;
    }).catch(function () { toast('Upload failed', 'error'); });
  });
  document.getElementById('receiptRemove').addEventListener('click', function () {
    state.receiptUri = ''; receiptPreview.hidden = true;
    document.getElementById('tf-receipt').value = '';
  });

  document.getElementById('addTxnBtn').addEventListener('click', function () { openTxnModal(null); });
  document.getElementById('txnEmptyAdd').addEventListener('click', function () { openTxnModal(null); });
  document.getElementById('txnModalClose').addEventListener('click', closeTxnModal);
  document.getElementById('txnCancelBtn').addEventListener('click', closeTxnModal);
  txnModal.addEventListener('click', function (e) { if (e.target === txnModal) closeTxnModal(); });
  TT.mobileAdd.expenses = function () { openTxnModal(null); };

  txnForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData(txnForm));
    if (!d.amount || !d.description.trim()) return;
    var rec = {
      type: d.type,
      amount: toMinor(d.amount), // stored as integer cents — no float persisted
      currency: d.currency || settings.primary,
      description: d.description.trim(),
      category: d.category,
      account: d.account,
      tags: d.tags ? d.tags.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [],
      notes: d.notes.trim(),
      date: d.date || todayStr(),
      receiptUri: state.receiptUri || ''   // only the URI lives on the record
    };
    if (txnEditId) {
      var i = txns.findIndex(function (t) { return t.id === txnEditId; });
      if (i !== -1) txns[i] = Object.assign({}, txns[i], rec, { id: txnEditId });
      toast('Transaction updated');
    } else {
      txns.push(Object.assign({}, rec, { id: uid(), createdAt: Date.now() }));
      toast('Transaction added', 'success');
    }
    saveTxns(); closeTxnModal(); renderTab();
  });

  /* ============================================================
     7. TRANSACTIONS PANEL
  ============================================================ */
  var txnSearch = document.getElementById('txnSearch');
  var txnType   = document.getElementById('txnType');
  var txnCatF   = document.getElementById('txnCatFilter');
  var txnPay    = document.getElementById('txnPay');
  var txnSort   = document.getElementById('txnSort');
  var txnList   = document.getElementById('txnList');
  var txnEmpty  = document.getElementById('txnEmpty');
  var txnNoMatch= document.getElementById('txnNoMatch');

  function rebuildTxnFilters() {
    var cats = [].concat(settings.categories.expense, settings.categories.income);
    txnCatF.innerHTML = '<option value="all">All Categories</option>' +
      cats.map(function (c) { return '<option value="' + c.id + '">' + c.icon + ' ' + esc(c.label) + '</option>'; }).join('');
    txnPay.innerHTML = '<option value="all">All Methods</option>' +
      settings.accounts.map(function (a) { return '<option value="' + a.id + '">' + a.icon + ' ' + esc(a.label) + '</option>'; }).join('');
    txnCatF.value = state.txnFilter.cat; txnPay.value = state.txnFilter.pay;
  }

  [txnType, txnCatF, txnPay, txnSort].forEach(function (sel) {
    sel.addEventListener('change', function () {
      state.txnFilter.type = txnType.value; state.txnFilter.cat = txnCatF.value;
      state.txnFilter.pay = txnPay.value; state.txnFilter.sort = txnSort.value;
      renderTxns();
    });
  });
  txnSearch.addEventListener('input', function () { state.txnFilter.q = txnSearch.value.toLowerCase(); renderTxns(); });

  function filterSortTxns() {
    var f = state.txnFilter;
    var list = txns.filter(function (t) {
      if (f.type !== 'all' && t.type !== f.type) return false;
      if (f.cat !== 'all' && t.category !== f.cat) return false;
      if (f.pay !== 'all' && t.account !== f.pay) return false;
      if (f.q) {
        var hay = (t.description + ' ' + (t.notes || '') + ' ' + (t.tags || []).join(' ')).toLowerCase();
        if (hay.indexOf(f.q) === -1) return false;
      }
      return true;
    });
    list.sort(function (a, b) {
      if (f.sort === 'amount-desc') return toPrimary(b.amount, b.currency) - toPrimary(a.amount, a.currency);
      if (f.sort === 'amount-asc')  return toPrimary(a.amount, a.currency) - toPrimary(b.amount, b.currency);
      var da = a.date || '', db = b.date || '';
      if (da !== db) return f.sort === 'date-asc' ? (da < db ? -1 : 1) : (da < db ? 1 : -1);
      return f.sort === 'date-asc' ? (a.createdAt || 0) - (b.createdAt || 0) : (b.createdAt || 0) - (a.createdAt || 0);
    });
    return list;
  }

  function txnRow(t) {
    var li = document.createElement('li');
    li.className = 'exp-row';
    var cat = catMeta(t.type, t.category);
    var acc = acctMeta(t.account);
    var isInc = t.type === 'income';
    li.style.borderLeftColor = cat.color;

    var meta = [];
    if (acc.label) meta.push('<span>' + acc.icon + ' ' + esc(acc.label) + '</span>');
    if (t.date) meta.push('<span>' + TT.fmtDate(t.date) + '</span>');
    if (t.recurringId) meta.push('<span class="tag-mini">🔁 recurring</span>');
    (t.tags || []).forEach(function (tg) { if (tg !== 'recurring') meta.push('<span class="tag-mini">#' + esc(tg) + '</span>'); });

    var conv = (t.currency && t.currency !== settings.primary)
      ? '<span class="conv">≈ ' + moneyP(toPrimary(t.amount, t.currency)) + '</span>' : '';
    var rsrc = TT.uploads.resolve(t.receiptUri || '') || t.receipt || ''; // URI → src (legacy base64 fallback)
    var receiptThumb = rsrc ? '<img class="rcpt-thumb" src="' + rsrc + '" alt="receipt" />' : '';

    li.innerHTML =
      '<div class="exp-main">' +
        receiptThumb +
        '<div>' +
          '<div class="exp-desc">' + esc(t.description) + '</div>' +
          '<div class="exp-meta">' +
            '<span class="cat-pill" style="background:' + hexA(cat.color, 0.14) + ';color:' + cat.color + '">' + cat.icon + ' ' + esc(cat.label) + '</span>' +
            meta.join('') +
          '</div>' +
          (t.notes ? '<div class="exp-notes">' + esc(t.notes) + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="exp-right">' +
        '<div class="exp-amt-wrap">' +
          '<span class="exp-amt ' + (isInc ? 'is-income' : 'is-expense') + '">' + (isInc ? '+' : '−') + money(t.amount, t.currency) + '</span>' +
          conv +
        '</div>' +
        '<div class="exp-actions">' +
          '<button class="ic-btn" data-a="dup" title="Duplicate">⧉</button>' +
          '<button class="ic-btn" data-a="edit" title="Edit">✏️</button>' +
          '<button class="ic-btn del" data-a="del" title="Delete">🗑️</button>' +
        '</div>' +
      '</div>';

    li.querySelector('[data-a="edit"]').addEventListener('click', function () {
      var x = txns.find(function (z) { return z.id === t.id; }); if (x) openTxnModal(x);
    });
    li.querySelector('[data-a="dup"]').addEventListener('click', function () {
      var x = txns.find(function (z) { return z.id === t.id; }); if (!x) return;
      var copy = Object.assign({}, x, { id: uid(), date: todayStr(), createdAt: Date.now(), recurringId: undefined });
      txns.push(copy); saveTxns(); renderTab(); toast('Transaction duplicated', 'success');
    });
    li.querySelector('[data-a="del"]').addEventListener('click', function () {
      if (!confirm('Delete "' + t.description + '"?')) return;
      txns = txns.filter(function (z) { return z.id !== t.id; });
      saveTxns(); renderTab(); toast('Transaction deleted');
    });
    return li;
  }

  function renderTxns() {
    rebuildTxnFilters();
    var list = filterSortTxns();
    txnList.innerHTML = '';
    txnNoMatch.hidden = true;
    if (txns.length === 0) { txnEmpty.classList.add('show'); return; }
    txnEmpty.classList.remove('show');
    if (list.length === 0) { txnNoMatch.hidden = false; return; }
    list.forEach(function (t) { txnList.appendChild(txnRow(t)); });
  }

  /* ============================================================
     8. AGGREGATION HELPERS
  ============================================================ */
  function txnsInRange(from, to) {
    return txns.filter(function (t) { return t.date && t.date >= from && t.date <= to; });
  }
  function txnsInMonth(key) {
    return txns.filter(function (t) { return t.date && monthKey(t.date) === key; });
  }
  function totals(list) {
    var income = 0, expense = 0;
    list.forEach(function (t) {
      var v = toPrimary(t.amount, t.currency);
      if (t.type === 'income') income += v; else expense += v;
    });
    return { income: income, expense: expense, net: income - expense };
  }
  function categoryTotals(list) {
    var map = {};
    list.forEach(function (t) {
      if (t.type !== 'expense') return;
      map[t.category] = (map[t.category] || 0) + toPrimary(t.amount, t.currency);
    });
    return map;
  }
  function categorySlices(list) {
    var map = categoryTotals(list);
    return Object.keys(map).map(function (id) {
      var m = catMeta('expense', id);
      return { id: id, label: m.label, icon: m.icon, color: m.color, value: map[id] };
    }).sort(function (a, b) { return b.value - a.value; });
  }

  /* ============================================================
     9. CHARTS (inline SVG)
  ============================================================ */
  var AXIS = '#94a3b8';
  function polar(cx, cy, r, ang) { return { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) }; }

  function chartPie(slices, donut) {
    var total = slices.reduce(function (s, x) { return s + x.value; }, 0);
    if (total <= 0) return '<p class="chart-empty">No expense data for this period.</p>';
    var svg, parts = '';
    if (donut) {
      var C = 2 * Math.PI * 70, off = 0;
      slices.forEach(function (s) {
        var len = (s.value / total) * C;
        parts += '<circle cx="100" cy="100" r="70" fill="none" stroke="' + s.color + '" stroke-width="26" stroke-dasharray="' + len + ' ' + (C - len) + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 100 100)"/>';
        off += len;
      });
      svg = '<svg viewBox="0 0 200 200" class="chart-svg chart-pie">' + parts +
        '<text x="100" y="96" text-anchor="middle" class="donut-total">' + moneyP(total).replace(/\.\d+$/, '') + '</text>' +
        '<text x="100" y="114" text-anchor="middle" class="donut-sub">total spent</text></svg>';
    } else {
      var a0 = -Math.PI / 2;
      slices.forEach(function (s) {
        var a1 = a0 + (s.value / total) * 2 * Math.PI;
        var p0 = polar(100, 100, 85, a0), p1 = polar(100, 100, 85, a1);
        var large = (a1 - a0) > Math.PI ? 1 : 0;
        parts += '<path d="M100 100 L' + p0.x.toFixed(2) + ' ' + p0.y.toFixed(2) + ' A85 85 0 ' + large + ' 1 ' + p1.x.toFixed(2) + ' ' + p1.y.toFixed(2) + ' Z" fill="' + s.color + '"/>';
        a0 = a1;
      });
      svg = '<svg viewBox="0 0 200 200" class="chart-svg chart-pie">' + parts + '</svg>';
    }
    var legend = '<div class="chart-legend">' + slices.map(function (s) {
      return '<div class="leg-item"><span class="leg-dot" style="background:' + s.color + '"></span>' + s.icon + ' ' + esc(s.label) +
        '<span class="leg-val">' + moneyP(s.value) + '</span></div>';
    }).join('') + '</div>';
    return '<div class="chart-flex">' + svg + legend + '</div>';
  }

  function chartBars(data) {
    if (!data.length || data.every(function (d) { return d.value === 0; })) return '<p class="chart-empty">No data for this period.</p>';
    var max = Math.max.apply(null, data.map(function (d) { return d.value; })) || 1;
    var W = Math.max(280, data.length * 34), H = 180, base = H - 26, top = 14;
    var step = W / data.length, bw = Math.min(26, step * 0.6);
    var every = Math.ceil(data.length / 14);
    var bars = data.map(function (d, i) {
      var h = (d.value / max) * (base - top);
      var x = i * step + (step - bw) / 2, y = base - h;
      var lbl = (i % every === 0) ? '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" class="ax-lbl">' + esc(d.label) + '</text>' : '';
      return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="3" fill="' + (d.color || '#7c3aed') + '"/>' + lbl;
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart-svg" preserveAspectRatio="xMidYMid meet">' +
      '<line x1="0" y1="' + base + '" x2="' + W + '" y2="' + base + '" stroke="' + AXIS + '" stroke-width="1" opacity=".3"/>' + bars + '</svg>';
  }

  function chartStacked(buckets) {
    var maxes = buckets.map(function (b) { return b.segments.reduce(function (s, x) { return s + x.value; }, 0); });
    var max = Math.max.apply(null, maxes) || 1;
    if (max <= 0) return '<p class="chart-empty">No data for this period.</p>';
    var W = Math.max(280, buckets.length * 40), H = 180, base = H - 26, top = 14;
    var step = W / buckets.length, bw = Math.min(28, step * 0.62);
    var every = Math.ceil(buckets.length / 12);
    var legendSet = {};
    var cols = buckets.map(function (b, i) {
      var x = i * step + (step - bw) / 2, acc = 0;
      var segs = b.segments.map(function (s) {
        var h = (s.value / max) * (base - top);
        var y = base - acc - h; acc += h;
        legendSet[s.label] = s.color;
        return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" fill="' + s.color + '"/>';
      }).join('');
      var lbl = (i % every === 0) ? '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" class="ax-lbl">' + esc(b.label) + '</text>' : '';
      return segs + lbl;
    }).join('');
    var legend = '<div class="chart-legend row">' + Object.keys(legendSet).map(function (k) {
      return '<div class="leg-item"><span class="leg-dot" style="background:' + legendSet[k] + '"></span>' + esc(k) + '</div>';
    }).join('') + '</div>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart-svg" preserveAspectRatio="xMidYMid meet">' +
      '<line x1="0" y1="' + base + '" x2="' + W + '" y2="' + base + '" stroke="' + AXIS + '" stroke-width="1" opacity=".3"/>' + cols + '</svg>' + legend;
  }

  function chartLine(data, area) {
    if (!data.length) return '<p class="chart-empty">No data for this period.</p>';
    var max = Math.max.apply(null, data.map(function (d) { return d.value; })) || 1;
    var W = Math.max(280, data.length * 30), H = 180, base = H - 26, top = 14, left = 4, right = W - 4;
    var n = data.length;
    var pts = data.map(function (d, i) {
      var x = n === 1 ? (W / 2) : left + (right - left) * (i / (n - 1));
      var y = base - (d.value / max) * (base - top);
      return { x: x, y: y, d: d };
    });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
    var every = Math.ceil(n / 12);
    var labels = pts.map(function (p, i) {
      return (i % every === 0) ? '<text x="' + p.x + '" y="' + (H - 8) + '" text-anchor="middle" class="ax-lbl">' + esc(p.d.label) + '</text>' : '';
    }).join('');
    var dots = pts.map(function (p) { return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="2.5" fill="#7c3aed"/>'; }).join('');
    var fill = '';
    if (area) {
      var ap = 'M' + pts[0].x.toFixed(1) + ' ' + base + ' ' + line.replace(/^M/, 'L') + ' L' + pts[n - 1].x.toFixed(1) + ' ' + base + ' Z';
      fill = '<path d="' + ap + '" fill="' + hexA('#7c3aed', 0.16) + '"/>';
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart-svg" preserveAspectRatio="xMidYMid meet">' +
      '<line x1="0" y1="' + base + '" x2="' + W + '" y2="' + base + '" stroke="' + AXIS + '" stroke-width="1" opacity=".3"/>' +
      fill + '<path d="' + line + '" fill="none" stroke="#7c3aed" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' + dots + labels + '</svg>';
  }

  /* time buckets for trend charts */
  function buildBuckets(from, to) {
    var fd = new Date(from + 'T00:00:00'), td = new Date(to + 'T00:00:00');
    var spanDays = Math.round((td - fd) / 86400000) + 1;
    var buckets = [], map = {};
    if (spanDays <= 45) {
      for (var d = new Date(fd); d <= td; d.setDate(d.getDate() + 1)) {
        var k = ymd(d); buckets.push({ key: k, label: String(d.getDate()) }); map[k] = buckets.length - 1;
      }
      return { buckets: buckets, keyOf: function (s) { return s; } };
    }
    var cur = new Date(fd.getFullYear(), fd.getMonth(), 1);
    while (cur <= td) {
      var mk = cur.getFullYear() + '-' + pad(cur.getMonth() + 1);
      buckets.push({ key: mk, label: cur.toLocaleString('en-US', { month: 'short' }) });
      cur.setMonth(cur.getMonth() + 1);
    }
    return { buckets: buckets, keyOf: function (s) { return monthKey(s); } };
  }

  /* ============================================================
     10. OVERVIEW
  ============================================================ */
  var ovStats = document.getElementById('ovStats');
  var ovWidgets = document.getElementById('ovWidgets');

  function statCard(value, label, cls, sub) {
    return '<div class="stat-card ' + (cls || '') + '"><div class="sc-val">' + value + '</div>' +
      '<div class="sc-label">' + label + '</div>' + (sub ? '<div class="sc-sub">' + sub + '</div>' : '') + '</div>';
  }

  function renderOverview() {
    var mk = curMonthKey();
    var mTxns = txnsInMonth(mk);
    var t = totals(mTxns);
    var budgetLeft = budgets.monthly > 0 ? budgets.monthly - t.expense : null;
    var rate = t.income > 0 ? Math.round((t.net / t.income) * 100) : 0;

    ovStats.innerHTML =
      statCard(moneyP(t.expense), 'Spent this month', 'sc-red') +
      statCard(moneyP(t.income), 'Income', 'sc-green') +
      statCard((t.net < 0 ? '−' : '') + moneyP(Math.abs(t.net)), 'Net', t.net < 0 ? 'sc-red' : 'sc-green') +
      (budgetLeft != null
        ? statCard((budgetLeft < 0 ? '−' : '') + moneyP(Math.abs(budgetLeft)), budgetLeft < 0 ? 'Over budget' : 'Budget left', budgetLeft < 0 ? 'sc-red' : 'sc-amber')
        : statCard(rate + '%', 'Savings rate', 'sc-violet'));

    ovWidgets.innerHTML = '';
    state.widgetOrder = settings.widgetOrder;
    settings.widgetOrder.forEach(function (id) {
      if (!settings.widgets[id]) return;
      var card = buildWidget(id, mTxns, t);
      if (card) ovWidgets.appendChild(card);
    });
    sortable(ovWidgets, function (order) {
      settings.widgetOrder = order.concat(settings.widgetOrder.filter(function (x) { return order.indexOf(x) === -1; }));
      saveSettings();
    });
  }

  function widgetShell(id, title, bodyHtml) {
    var card = document.createElement('div');
    card.className = 'widget-card';
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-id', id);
    card.innerHTML = '<div class="widget-head"><span class="drag-dot" title="Drag to reorder">⠿</span>' +
      '<span class="widget-title">' + title + '</span></div><div class="widget-body">' + bodyHtml + '</div>';
    return card;
  }

  function buildWidget(id, mTxns, t) {
    if (id === 'category') {
      return widgetShell('category', 'Category Breakdown', chartPie(categorySlices(mTxns), true));
    }
    if (id === 'trend') {
      var to = todayStr();
      var d = new Date(); d.setMonth(d.getMonth() - 5); var from = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-01';
      var bb = buildBuckets(from, to);
      var data = bb.buckets.map(function (b) { return { key: b.key, label: b.label, value: 0, color: '#7c3aed' }; });
      var idx = {}; bb.buckets.forEach(function (b, i) { idx[b.key] = i; });
      txnsInRange(from, to).forEach(function (x) { if (x.type === 'expense') { var k = bb.keyOf(x.date); if (idx[k] != null) data[idx[k]].value += toPrimary(x.amount, x.currency); } });
      return widgetShell('trend', 'Spending Trend', chartBars(data));
    }
    if (id === 'budget') {
      return widgetShell('budget', 'Budget Progress', budgetBarsHtml(true));
    }
    if (id === 'goals') {
      var active = goals.filter(function (g) { return !g.archived; }).slice(0, 3);
      var html = active.length ? active.map(goalMiniHtml).join('') : '<p class="muted-note">No active goals. Add one in the Goals tab.</p>';
      return widgetShell('goals', 'Savings Goals', html);
    }
    if (id === 'recent') {
      var recent = txns.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 5);
      var html = recent.length ? '<ul class="mini-list">' + recent.map(function (x) {
        var c = catMeta(x.type, x.category);
        return '<li><span class="mini-ic">' + c.icon + '</span><span class="mini-desc">' + esc(x.description) + '</span>' +
          '<span class="mini-amt ' + (x.type === 'income' ? 'is-income' : 'is-expense') + '">' + (x.type === 'income' ? '+' : '−') + money(x.amount, x.currency) + '</span></li>';
      }).join('') + '</ul>' : '<p class="muted-note">No transactions yet.</p>';
      return widgetShell('recent', 'Recent Transactions', html);
    }
    if (id === 'insight') {
      return widgetShell('insight', 'Smart Insight', '<div class="insight-box">🤖 ' + computeInsight() + '</div>');
    }
    return null;
  }

  function computeInsight() {
    var mk = curMonthKey();
    var prev = new Date(); prev.setMonth(prev.getMonth() - 1);
    var pk = prev.getFullYear() + '-' + pad(prev.getMonth() + 1);
    var cur = totals(txnsInMonth(mk)).expense, was = totals(txnsInMonth(pk)).expense;
    var slices = categorySlices(txnsInMonth(mk));
    if (cur === 0) return 'No spending logged yet this month. Add a transaction to see insights.';
    var msgs = [];
    if (was > 0) {
      var diff = Math.round(((cur - was) / was) * 100);
      if (diff > 5) msgs.push('You\'ve spent ' + diff + '% more than last month so far.');
      else if (diff < -5) msgs.push('Nice — you\'re spending ' + Math.abs(diff) + '% less than last month.');
    }
    if (slices.length) msgs.push('Your biggest category is ' + slices[0].icon + ' ' + slices[0].label + ' at ' + moneyP(slices[0].value) + '.');
    if (budgets.monthly > 0) {
      var pct = Math.round((cur / budgets.monthly) * 100);
      var day = new Date().getDate(), dim = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
      if (pct >= 100) msgs.push('You\'re over your monthly budget by ' + moneyP(cur - budgets.monthly) + '.');
      else if (pct > (day / dim) * 100 + 10) msgs.push('You\'ve used ' + pct + '% of your budget with ' + (dim - day) + ' days left — pace down to stay on track.');
    }
    return msgs.slice(0, 2).join(' ') || 'You\'re tracking steadily. Keep it up!';
  }

  /* ============================================================
     11. CALENDAR
  ============================================================ */
  var calLabel = document.getElementById('calLabel');
  var calMount = document.getElementById('calMount');
  var calSummary = document.getElementById('calSummary');
  document.getElementById('calPrev').addEventListener('click', function () { shiftMonth(-1); });
  document.getElementById('calNext').addEventListener('click', function () { shiftMonth(1); });
  document.getElementById('calToday').addEventListener('click', function () {
    var d = new Date(); state.cal.y = d.getFullYear(); state.cal.m = d.getMonth(); renderCalendar();
  });
  document.querySelectorAll('#calViewToggle .seg').forEach(function (b) {
    b.addEventListener('click', function () {
      state.cal.view = b.getAttribute('data-calview');
      document.querySelectorAll('#calViewToggle .seg').forEach(function (x) { x.classList.toggle('active', x === b); });
      renderCalendar();
    });
  });
  function shiftMonth(n) {
    state.cal.m += n;
    if (state.cal.m < 0) { state.cal.m = 11; state.cal.y--; }
    if (state.cal.m > 11) { state.cal.m = 0; state.cal.y++; }
    renderCalendar();
  }

  function renderCalendar() {
    var y = state.cal.y, m = state.cal.m;
    var key = y + '-' + pad(m + 1);
    calLabel.textContent = new Date(y, m, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

    var mTxns = txnsInMonth(key);
    var tt = totals(mTxns);
    calSummary.innerHTML =
      '<div class="chip e-spent"><span class="chip-n">' + moneyP(tt.expense) + '</span><span class="chip-l">Spent</span></div>' +
      '<div class="chip e-income"><span class="chip-n">' + moneyP(tt.income) + '</span><span class="chip-l">Income</span></div>' +
      '<div class="chip ' + (tt.net < 0 ? 'e-net-neg' : 'e-net-pos') + '"><span class="chip-n">' + (tt.net < 0 ? '−' : '+') + moneyP(Math.abs(tt.net)) + '</span><span class="chip-l">Net</span></div>';

    if (state.cal.view === 'calendar')  calMount.innerHTML = '', calMount.appendChild(buildCalGrid(y, m, mTxns));
    else if (state.cal.view === 'timeline') calMount.innerHTML = '', calMount.appendChild(buildTimeline(mTxns));
    else { calMount.innerHTML = ''; var ul = document.createElement('ul'); ul.className = 'item-list';
      if (!mTxns.length) ul.innerHTML = '<p class="muted-note" style="padding:20px;text-align:center">No transactions this month.</p>';
      mTxns.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).forEach(function (t) { ul.appendChild(txnRow(t)); });
      calMount.appendChild(ul);
    }
  }

  function buildCalGrid(y, m, mTxns) {
    var byDay = {};
    mTxns.forEach(function (t) {
      var day = parseInt(t.date.slice(8, 10), 10);
      if (!byDay[day]) byDay[day] = { exp: 0, inc: 0, list: [] };
      var v = toPrimary(t.amount, t.currency);
      if (t.type === 'income') byDay[day].inc += v; else byDay[day].exp += v;
      byDay[day].list.push(t);
    });
    var daySpends = Object.keys(byDay).map(function (k) { return byDay[k].exp; });
    var avg = daySpends.length ? daySpends.reduce(function (a, b) { return a + b; }, 0) / daySpends.length : 0;

    var wrap = document.createElement('div');
    wrap.className = 'cal-grid-wrap';
    var head = '<div class="cal-grid cal-head">' + ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join('') + '</div>';
    var first = new Date(y, m, 1).getDay();
    var dim = new Date(y, m + 1, 0).getDate();
    var todayS = todayStr();
    var cells = '';
    for (var i = 0; i < first; i++) cells += '<div class="cal-cell empty"></div>';
    for (var d = 1; d <= dim; d++) {
      var ds = y + '-' + pad(m + 1) + '-' + pad(d);
      var info = byDay[d];
      var hot = info && info.exp > 0 && avg > 0 && info.exp >= avg * 1.5;
      var isToday = ds === todayS;
      cells += '<div class="cal-cell' + (hot ? ' hot' : '') + (isToday ? ' today' : '') + '" data-date="' + ds + '">' +
        '<div class="cal-daynum">' + d + '</div>' +
        (info ? '<div class="cal-amts">' +
          (info.exp ? '<span class="cal-exp">−' + compactMoney(info.exp) + '</span>' : '') +
          (info.inc ? '<span class="cal-inc">+' + compactMoney(info.inc) + '</span>' : '') +
        '</div>' : '') +
        '</div>';
    }
    wrap.innerHTML = head + '<div class="cal-grid cal-body">' + cells + '</div>';
    wrap.querySelectorAll('.cal-cell[data-date]').forEach(function (cell) {
      cell.addEventListener('click', function () { openDayModal(cell.getAttribute('data-date')); });
    });
    return wrap;
  }

  function compactMoney(n) {
    var s = sym(settings.primary), major = toMajor(n); // n is integer cents
    if (major >= 1000) return s + (major / 1000).toFixed(major >= 10000 ? 0 : 1) + 'k';
    return s + Math.round(major);
  }

  function buildTimeline(mTxns) {
    var wrap = document.createElement('div');
    wrap.className = 'timeline';
    if (!mTxns.length) { wrap.innerHTML = '<p class="muted-note" style="padding:20px;text-align:center">No transactions this month.</p>'; return wrap; }
    var byDate = {};
    mTxns.forEach(function (t) { (byDate[t.date] = byDate[t.date] || []).push(t); });
    Object.keys(byDate).sort().reverse().forEach(function (date) {
      var dt = totals(byDate[date]);
      var group = document.createElement('div');
      group.className = 'tl-group';
      group.innerHTML = '<div class="tl-date"><span class="tl-dot"></span>' + TT.fmtDate(date) +
        '<span class="tl-day-net">' + (dt.net < 0 ? '−' : '+') + moneyP(Math.abs(dt.net)) + '</span></div>';
      var ul = document.createElement('ul'); ul.className = 'item-list tl-list';
      byDate[date].forEach(function (t) { ul.appendChild(txnRow(t)); });
      group.appendChild(ul);
      wrap.appendChild(group);
    });
    return wrap;
  }

  /* Day modal */
  var dayModal = document.getElementById('dayModalWrap');
  var dayModalList = document.getElementById('dayModalList');
  var dayModalSummary = document.getElementById('dayModalSummary');
  var dayCurrentDate = '';
  function openDayModal(date) {
    dayCurrentDate = date;
    document.getElementById('dayModalTitle').textContent = TT.fmtDate(date);
    var list = txns.filter(function (t) { return t.date === date; });
    var dt = totals(list);
    dayModalSummary.innerHTML =
      '<span class="day-pill is-expense">−' + moneyP(dt.expense) + '</span>' +
      '<span class="day-pill is-income">+' + moneyP(dt.income) + '</span>';
    dayModalList.innerHTML = '';
    if (!list.length) dayModalList.innerHTML = '<p class="muted-note" style="text-align:center;padding:14px">Nothing logged for this day yet.</p>';
    list.forEach(function (t) { dayModalList.appendChild(txnRow(t)); });
    dayModal.classList.add('open');
  }
  function closeDayModal() { dayModal.classList.remove('open'); }
  document.getElementById('dayModalClose').addEventListener('click', closeDayModal);
  dayModal.addEventListener('click', function (e) { if (e.target === dayModal) closeDayModal(); });
  document.getElementById('dayAddBtn').addEventListener('click', function () {
    closeDayModal(); openTxnModal(null, { date: dayCurrentDate });
  });

  /* ============================================================
     12. BUDGETS
  ============================================================ */
  var budgetMount = document.getElementById('budgetMount');

  function budgetBarsHtml(mini) {
    var mk = curMonthKey();
    var spent = categoryTotals(txnsInMonth(mk));
    var cats = settings.categories.expense.filter(function (c) { return budgets.categories[c.id] > 0 || (!mini && true); });
    if (mini) cats = settings.categories.expense.filter(function (c) { return budgets.categories[c.id] > 0; });
    if (mini && !cats.length) return '<p class="muted-note">Set category budgets in the Budgets tab.</p>';
    return cats.map(function (c) {
      var limit = budgets.categories[c.id] || 0;
      var used = spent[c.id] || 0;
      var pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
      var over = limit > 0 && used > limit;
      var col = over ? '#dc2626' : (pct > 85 ? '#d97706' : c.color);
      return '<div class="budget-row">' +
        '<span class="budget-ic">' + c.icon + '</span>' +
        '<span class="budget-name">' + esc(c.label) + '</span>' +
        '<span class="budget-bar"><span class="budget-fill" style="width:' + pct + '%;background:' + col + '"></span></span>' +
        '<span class="budget-amt' + (over ? ' over' : '') + '">' + moneyP(used) + (limit > 0 ? ' / ' + moneyP(limit) : '') + '</span>' +
        '</div>';
    }).join('');
  }

  function renderBudgets() {
    var mk = curMonthKey();
    var t = totals(txnsInMonth(mk));
    var pct = budgets.monthly > 0 ? Math.min(100, (t.expense / budgets.monthly) * 100) : 0;
    var over = budgets.monthly > 0 && t.expense > budgets.monthly;
    var remain = budgets.monthly - t.expense;

    var overall =
      '<div class="card budget-overall">' +
        '<div class="bo-top"><div><div class="bo-label">Monthly Budget</div>' +
          '<div class="bo-spent">' + moneyP(t.expense) + ' <span>spent of</span></div></div>' +
          '<div class="bo-input"><span>' + sym(settings.primary) + '</span><input type="number" id="budgetMonthly" min="0" step="1" value="' + (budgets.monthly ? toMajor(budgets.monthly) : '') + '" placeholder="0" /></div>' +
        '</div>' +
        '<div class="budget-bar big"><span class="budget-fill" style="width:' + pct + '%;background:' + (over ? '#dc2626' : (pct > 85 ? '#d97706' : '#7c3aed')) + '"></span></div>' +
        '<div class="bo-foot">' + (budgets.monthly > 0
          ? (over ? '<span class="over">Over by ' + moneyP(-remain) + '</span>' : moneyP(remain) + ' remaining')
          : 'Set a monthly budget to track your progress') + '</div>' +
      '</div>';

    var rows = settings.categories.expense.map(function (c) {
      var limit = budgets.categories[c.id] || 0;
      var used = categoryTotals(txnsInMonth(mk))[c.id] || 0;
      var p = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
      var ov = limit > 0 && used > limit;
      var col = ov ? '#dc2626' : (p > 85 ? '#d97706' : c.color);
      return '<div class="budget-edit-row">' +
        '<span class="budget-ic">' + c.icon + '</span>' +
        '<span class="budget-name">' + esc(c.label) + '</span>' +
        '<span class="budget-bar"><span class="budget-fill" style="width:' + p + '%;background:' + col + '"></span></span>' +
        '<span class="budget-used' + (ov ? ' over' : '') + '">' + moneyP(used) + '</span>' +
        '<span class="budget-limit-input"><span>' + sym(settings.primary) + '</span><input type="number" min="0" step="1" data-cat="' + c.id + '" value="' + (limit ? toMajor(limit) : '') + '" placeholder="—" /></span>' +
        (ov ? '<span class="over-badge">!</span>' : '<span class="over-badge ghost"></span>') +
        '</div>';
    }).join('');

    budgetMount.innerHTML = overall +
      '<div class="card"><h3 class="card-h">Category Limits</h3><div class="budget-edit-list">' + rows + '</div>' +
      '<p class="muted-note" style="margin-top:10px">Limits apply to the current month. Bars turn amber past 85% and red when exceeded.</p></div>';

    var bm = document.getElementById('budgetMonthly');
    bm.addEventListener('change', function () { budgets.monthly = toMinor(bm.value); saveBudgets(); renderBudgets(); });
    budgetMount.querySelectorAll('input[data-cat]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var v = toMinor(inp.value);
        if (v > 0) budgets.categories[inp.getAttribute('data-cat')] = v;
        else delete budgets.categories[inp.getAttribute('data-cat')];
        saveBudgets(); renderBudgets();
      });
    });
  }

  /* ============================================================
     13. GOALS
  ============================================================ */
  var goalMount = document.getElementById('goalMount');
  var goalModal = document.getElementById('goalModalWrap');
  var goalForm  = document.getElementById('goalForm');
  var goalEditId = null;

  document.getElementById('goalShowArchived').addEventListener('change', function (e) { state.goalArchived = e.target.checked; renderGoals(); });
  document.getElementById('addGoalBtn').addEventListener('click', function () { openGoalModal(null); });
  document.getElementById('goalModalClose').addEventListener('click', closeGoalModal);
  document.getElementById('goalCancelBtn').addEventListener('click', closeGoalModal);
  goalModal.addEventListener('click', function (e) { if (e.target === goalModal) closeGoalModal(); });

  function openGoalModal(g) {
    goalEditId = g ? g.id : null;
    document.getElementById('goalModalTitle').textContent = g ? 'Edit Goal' : 'New Savings Goal';
    goalForm.reset();
    if (g) {
      goalForm.elements['id'].value = g.id;
      goalForm.elements['name'].value = g.name;
      goalForm.elements['target'].value = toMajor(g.target);
      goalForm.elements['saved'].value = toMajor(g.saved);
      goalForm.elements['deadline'].value = g.deadline || '';
      goalForm.elements['icon'].value = g.icon || '';
    }
    goalModal.classList.add('open');
    setTimeout(function () { goalForm.elements['name'].focus(); }, 50);
  }
  function closeGoalModal() { goalModal.classList.remove('open'); goalEditId = null; }

  goalForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData(goalForm));
    if (!d.name.trim() || !d.target) return;
    var rec = { name: d.name.trim(), target: toMinor(d.target), saved: toMinor(d.saved), deadline: d.deadline, icon: d.icon || '🎯' };
    if (goalEditId) {
      var i = goals.findIndex(function (g) { return g.id === goalEditId; });
      if (i !== -1) goals[i] = Object.assign({}, goals[i], rec);
      toast('Goal updated');
    } else {
      goals.push(Object.assign({}, rec, { id: uid(), archived: false, createdAt: Date.now() }));
      toast('Goal created', 'success');
    }
    saveGoals(); closeGoalModal(); renderGoals();
  });

  function goalMiniHtml(g) {
    var pct = g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
    return '<div class="goal-mini"><div class="goal-mini-top"><span>' + (g.icon || '🎯') + ' ' + esc(g.name) + '</span><span>' + Math.round(pct) + '%</span></div>' +
      '<div class="budget-bar"><span class="budget-fill" style="width:' + pct + '%;background:#7c3aed"></span></div></div>';
  }

  function goalCard(g) {
    var pct = g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
    var done = g.saved >= g.target;
    var remain = Math.max(0, g.target - g.saved);
    return '<div class="goal-card' + (g.archived ? ' archived' : '') + '" data-id="' + g.id + '">' +
      '<div class="goal-top">' +
        '<div class="goal-icon">' + (g.icon || '🎯') + '</div>' +
        '<div class="goal-info"><div class="goal-name">' + esc(g.name) + (done ? ' <span class="goal-done">✓ Reached</span>' : '') + '</div>' +
          '<div class="goal-sub">' + moneyP(g.saved) + ' of ' + moneyP(g.target) + (g.deadline ? ' · by ' + TT.fmtDate(g.deadline) : '') + '</div></div>' +
        '<div class="goal-pct">' + Math.round(pct) + '%</div>' +
      '</div>' +
      '<div class="budget-bar big"><span class="budget-fill" style="width:' + pct + '%;background:' + (done ? '#16a34a' : '#7c3aed') + '"></span></div>' +
      '<div class="goal-foot">' +
        (done ? '<span class="goal-remain">Goal reached! 🎉</span>' : '<span class="goal-remain">' + moneyP(remain) + ' to go</span>') +
        '<div class="goal-actions">' +
          '<button class="mini-btn" data-a="add">+ Add funds</button>' +
          '<button class="ic-btn" data-a="edit" title="Edit">✏️</button>' +
          '<button class="ic-btn" data-a="arch" title="' + (g.archived ? 'Unarchive' : 'Archive') + '">' + (g.archived ? '📤' : '📥') + '</button>' +
          '<button class="ic-btn del" data-a="del" title="Delete">🗑️</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderGoals() {
    var list = goals.filter(function (g) { return state.goalArchived ? true : !g.archived; });
    if (!goals.length) {
      goalMount.innerHTML = '<div class="empty show"><div class="empty-icon">🎯</div><h2>No savings goals yet</h2><p>Create a goal and track your progress toward it.</p></div>';
      return;
    }
    goalMount.innerHTML = '<div class="goal-grid">' + list.map(goalCard).join('') + '</div>';
    goalMount.querySelectorAll('.goal-card').forEach(function (card) {
      var id = card.getAttribute('data-id');
      var g = goals.find(function (x) { return x.id === id; });
      card.querySelector('[data-a="edit"]').addEventListener('click', function () { openGoalModal(g); });
      card.querySelector('[data-a="del"]').addEventListener('click', function () {
        if (!confirm('Delete goal "' + g.name + '"?')) return;
        goals = goals.filter(function (x) { return x.id !== id; }); saveGoals(); renderGoals(); toast('Goal deleted');
      });
      card.querySelector('[data-a="arch"]').addEventListener('click', function () {
        g.archived = !g.archived; saveGoals(); renderGoals(); toast(g.archived ? 'Goal archived' : 'Goal restored');
      });
      card.querySelector('[data-a="add"]').addEventListener('click', function () {
        var v = prompt('Add funds to "' + g.name + '" (' + sym(settings.primary) + '):', '');
        if (v == null) return;
        var n = toMinor(v); if (!n) return;
        g.saved = Math.max(0, (g.saved || 0) + n); saveGoals(); renderGoals();
        toast('Added ' + moneyP(n) + ' to ' + g.name, 'success');
      });
    });
  }

  /* ============================================================
     14. RECURRING
  ============================================================ */
  var recurMount = document.getElementById('recurMount');
  var recurModal = document.getElementById('recurModalWrap');
  var recurForm  = document.getElementById('recurForm');
  var recurTypeToggle = document.getElementById('recurTypeToggle');
  var rfCat = document.getElementById('rf-cat');
  var rfCur = document.getElementById('rf-currency');
  var rfAcc = document.getElementById('rf-account');
  var recurEditId = null;
  var KIND_ICON = { bill: '🧾', subscription: '🔁', salary: '💼', rent: '🏠', loan: '🏦', other: '📦' };

  function setRecurType(type) {
    recurForm.elements['type'].value = type;
    recurTypeToggle.querySelectorAll('.type-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-type') === type); });
    fillCatSelect(rfCat, type);
  }
  recurTypeToggle.querySelectorAll('.type-btn').forEach(function (b) {
    b.addEventListener('click', function () { setRecurType(b.getAttribute('data-type')); });
  });

  document.getElementById('addRecurBtn').addEventListener('click', function () { openRecurModal(null); });
  document.getElementById('recurModalClose').addEventListener('click', closeRecurModal);
  document.getElementById('recurCancelBtn').addEventListener('click', closeRecurModal);
  recurModal.addEventListener('click', function (e) { if (e.target === recurModal) closeRecurModal(); });

  function openRecurModal(r) {
    recurEditId = r ? r.id : null;
    document.getElementById('recurModalTitle').textContent = r ? 'Edit Recurring' : 'New Recurring';
    recurForm.reset();
    fillCurrencySelect(rfCur); fillAccountSelect(rfAcc);
    setRecurType(r ? r.type : 'expense');
    if (r) {
      recurForm.elements['id'].value = r.id;
      recurForm.elements['kind'].value = r.kind || 'bill';
      recurForm.elements['frequency'].value = r.frequency || 'monthly';
      recurForm.elements['amount'].value = toMajor(r.amount);
      rfCur.value = r.currency || settings.primary;
      recurForm.elements['nextDate'].value = r.nextDate || '';
      recurForm.elements['description'].value = r.description || '';
      rfCat.value = r.category; rfAcc.value = r.account;
    } else {
      recurForm.elements['nextDate'].value = todayStr();
      rfCur.value = settings.primary;
    }
    recurModal.classList.add('open');
    setTimeout(function () { recurForm.elements['amount'].focus(); }, 50);
  }
  function closeRecurModal() { recurModal.classList.remove('open'); recurEditId = null; }

  recurForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData(recurForm));
    if (!d.amount || !d.description.trim()) return;
    var rec = {
      type: d.type, kind: d.kind, frequency: d.frequency, amount: toMinor(d.amount),
      currency: d.currency || settings.primary, nextDate: d.nextDate || todayStr(),
      description: d.description.trim(), category: d.category, account: d.account, active: true
    };
    if (recurEditId) {
      var i = recurring.findIndex(function (r) { return r.id === recurEditId; });
      if (i !== -1) recurring[i] = Object.assign({}, recurring[i], rec);
      toast('Recurring updated');
    } else {
      recurring.push(Object.assign({}, rec, { id: uid(), createdAt: Date.now() }));
      toast('Recurring added', 'success');
    }
    saveRecurring(); closeRecurModal(); catchUpRecurring(); renderTab();
  });

  function renderRecurring() {
    if (!recurring.length) {
      recurMount.innerHTML = '<div class="empty show"><div class="empty-icon">🔁</div><h2>No recurring transactions</h2><p>Add bills, subscriptions, or salary to log them automatically.</p></div>';
      return;
    }
    recurMount.innerHTML = '<ul class="item-list">' + recurring.map(function (r) {
      var cat = catMeta(r.type, r.category);
      return '<li class="recur-row" data-id="' + r.id + '" style="border-left-color:' + cat.color + '">' +
        '<div class="recur-main">' +
          '<div class="recur-icon">' + (KIND_ICON[r.kind] || '🔁') + '</div>' +
          '<div><div class="exp-desc">' + esc(r.description) + (r.active === false ? ' <span class="paused">Paused</span>' : '') + '</div>' +
          '<div class="exp-meta"><span class="cat-pill" style="background:' + hexA(cat.color, 0.14) + ';color:' + cat.color + '">' + cat.icon + ' ' + esc(cat.label) + '</span>' +
          '<span>' + cap(r.frequency) + '</span><span>Next: ' + TT.fmtDate(r.nextDate) + '</span></div></div>' +
        '</div>' +
        '<div class="exp-right"><span class="exp-amt ' + (r.type === 'income' ? 'is-income' : 'is-expense') + '">' + (r.type === 'income' ? '+' : '−') + money(r.amount, r.currency) + '</span>' +
        '<div class="exp-actions">' +
          '<button class="ic-btn" data-a="toggle" title="' + (r.active === false ? 'Resume' : 'Pause') + '">' + (r.active === false ? '▶️' : '⏸️') + '</button>' +
          '<button class="ic-btn" data-a="edit" title="Edit">✏️</button>' +
          '<button class="ic-btn del" data-a="del" title="Delete">🗑️</button>' +
        '</div></div>' +
      '</li>';
    }).join('') + '</ul>';

    recurMount.querySelectorAll('.recur-row').forEach(function (row) {
      var id = row.getAttribute('data-id');
      var r = recurring.find(function (x) { return x.id === id; });
      row.querySelector('[data-a="edit"]').addEventListener('click', function () { openRecurModal(r); });
      row.querySelector('[data-a="toggle"]').addEventListener('click', function () { r.active = r.active === false ? true : false; saveRecurring(); renderRecurring(); });
      row.querySelector('[data-a="del"]').addEventListener('click', function () {
        if (!confirm('Delete recurring "' + r.description + '"?')) return;
        recurring = recurring.filter(function (x) { return x.id !== id; }); saveRecurring(); renderRecurring(); toast('Recurring deleted');
      });
    });
  }
  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

  /* ============================================================
     15. REPORTS
  ============================================================ */
  var reportMount = document.getElementById('reportMount');
  var reportPeriod = document.getElementById('reportPeriod');
  var reportRange = document.getElementById('reportRange');
  var reportFrom = document.getElementById('reportFrom');
  var reportTo = document.getElementById('reportTo');

  reportPeriod.addEventListener('change', function () {
    state.reportPeriod = reportPeriod.value;
    reportRange.hidden = reportPeriod.value !== 'custom';
    renderReport();
  });
  reportFrom.addEventListener('change', function () { state.reportFrom = reportFrom.value; renderReport(); });
  reportTo.addEventListener('change', function () { state.reportTo = reportTo.value; renderReport(); });
  document.querySelectorAll('#chartTypeToggle .ct-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      state.reportChart = b.getAttribute('data-chart');
      document.querySelectorAll('#chartTypeToggle .ct-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
      renderReport();
    });
  });

  function getReportRange() {
    var now = new Date(), from, to;
    var p = state.reportPeriod;
    if (p === 'day') { from = to = todayStr(); }
    else if (p === 'week') { var s = new Date(now); var dow = (s.getDay() + 6) % 7; s.setDate(s.getDate() - dow); from = ymd(s); to = todayStr(); }
    else if (p === 'month') { from = ymd(new Date(now.getFullYear(), now.getMonth(), 1)); to = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)); }
    else if (p === 'quarter') { var q = Math.floor(now.getMonth() / 3); from = ymd(new Date(now.getFullYear(), q * 3, 1)); to = ymd(new Date(now.getFullYear(), q * 3 + 3, 0)); }
    else if (p === 'year') { from = now.getFullYear() + '-01-01'; to = now.getFullYear() + '-12-31'; }
    else { from = state.reportFrom || ymd(new Date(now.getFullYear(), now.getMonth(), 1)); to = state.reportTo || todayStr(); }
    return { from: from, to: to };
  }

  function renderReport() {
    var r = getReportRange();
    if (r.from > r.to) { var t = r.from; r.from = r.to; r.to = t; }
    var list = txnsInRange(r.from, r.to);
    var tot = totals(list);
    var days = Math.max(1, Math.round((new Date(r.to + 'T00:00:00') - new Date(r.from + 'T00:00:00')) / 86400000) + 1);
    var avgDaily = tot.expense / days;
    var rate = tot.income > 0 ? Math.round((tot.net / tot.income) * 100) : 0;
    var slices = categorySlices(list);
    var topCat = slices[0];

    var stats =
      '<div class="report-stats">' +
        statCard(moneyP(tot.income), 'Total Income', 'sc-green') +
        statCard(moneyP(tot.expense), 'Total Expenses', 'sc-red') +
        statCard((tot.net < 0 ? '−' : '') + moneyP(Math.abs(tot.net)), 'Net Savings', tot.net < 0 ? 'sc-red' : 'sc-green') +
        statCard(rate + '%', 'Savings Rate', 'sc-violet') +
        statCard(moneyP(avgDaily), 'Avg / Day', 'sc-amber') +
        statCard(topCat ? topCat.icon + ' ' + esc(topCat.label) : '—', 'Top Category', 'sc-violet') +
      '</div>';

    var chart = renderReportChart(list, slices, r);
    var rangeLbl = TT.fmtDate(r.from) + ' → ' + TT.fmtDate(r.to);

    reportMount.innerHTML = stats +
      '<div class="card"><div class="card-h-row"><h3 class="card-h">Breakdown</h3><span class="range-lbl">' + rangeLbl + '</span></div>' + chart + '</div>';
  }

  function renderReportChart(list, slices, r) {
    var type = state.reportChart;
    if (type === 'donut') return chartPie(slices, true);
    if (type === 'pie')   return chartPie(slices, false);
    var bb = buildBuckets(r.from, r.to);
    var idx = {}; bb.buckets.forEach(function (b, i) { idx[b.key] = i; });
    if (type === 'stacked') {
      var catIds = slices.map(function (s) { return s.id; });
      var buckets = bb.buckets.map(function (b) { return { label: b.label, segments: catIds.map(function (id) { var m = catMeta('expense', id); return { label: m.label, color: m.color, value: 0 }; }) }; });
      list.forEach(function (x) {
        if (x.type !== 'expense') return;
        var bi = idx[bb.keyOf(x.date)], ci = catIds.indexOf(x.category);
        if (bi != null && ci !== -1) buckets[bi].segments[ci].value += toPrimary(x.amount, x.currency);
      });
      return chartStacked(buckets);
    }
    // bar / line / area → expense per bucket
    var data = bb.buckets.map(function (b) { return { label: b.label, value: 0, color: '#7c3aed' }; });
    list.forEach(function (x) { if (x.type === 'expense') { var bi = idx[bb.keyOf(x.date)]; if (bi != null) data[bi].value += toPrimary(x.amount, x.currency); } });
    if (type === 'bar') return chartBars(data);
    if (type === 'area') return chartLine(data, true);
    return chartLine(data, false);
  }

  /* ============================================================
     16. SETTINGS
  ============================================================ */
  var settingsMount = document.getElementById('settingsMount');
  var catModal = document.getElementById('catModalWrap');
  var catForm = document.getElementById('catForm');

  function renderSettings() {
    settingsMount.innerHTML =
      // Currency
      '<div class="card set-card"><h3 class="card-h">Primary Currency</h3>' +
        '<p class="muted-note">Totals are shown in this currency. Changing it re-bases your exchange rates.</p>' +
        '<select id="setPrimary" class="ctrl-sel wide"></select></div>' +
      // Exchange rates
      '<div class="card set-card"><div class="card-h-row"><h3 class="card-h">Currencies &amp; Rates</h3>' +
        '<button class="mini-btn" id="fetchRates">↻ Update rates</button></div>' +
        '<p class="muted-note">Rate = value of 1 unit in your primary currency.</p>' +
        '<div id="ratesMount"></div>' +
        '<div class="add-currency"><input id="newCurCode" maxlength="3" placeholder="Code (e.g. KRW)" /><input id="newCurSym" maxlength="3" placeholder="Symbol" /><input id="newCurRate" type="number" step="0.0001" placeholder="Rate" /><button class="mini-btn" id="addCurBtn">+ Add</button></div>' +
      '</div>' +
      // Categories
      '<div class="card set-card"><h3 class="card-h">Expense Categories</h3><p class="muted-note">Drag to reorder.</p>' +
        '<div id="catExpenseMount" class="cat-manage"></div>' +
        '<button class="mini-btn" id="addExpCat">+ Add expense category</button></div>' +
      '<div class="card set-card"><h3 class="card-h">Income Categories</h3><p class="muted-note">Drag to reorder.</p>' +
        '<div id="catIncomeMount" class="cat-manage"></div>' +
        '<button class="mini-btn" id="addIncCat">+ Add income category</button></div>' +
      // Payment methods
      '<div class="card set-card"><h3 class="card-h">Payment Methods</h3><div id="acctMount" class="cat-manage"></div>' +
        '<div class="add-currency"><input id="newAcctIcon" maxlength="2" placeholder="🏦" /><input id="newAcctLabel" placeholder="Method name" /><button class="mini-btn" id="addAcctBtn">+ Add</button></div></div>' +
      // Widgets
      '<div class="card set-card"><h3 class="card-h">Dashboard Widgets</h3><p class="muted-note">Toggle what shows on the Overview tab. Drag the cards there to reorder.</p>' +
        '<div id="widgetToggles"></div></div>' +
      // Data
      '<div class="card set-card"><h3 class="card-h">Data</h3><div class="data-btns">' +
        '<button class="mini-btn" id="exportCsv">⬇ Export CSV</button>' +
        '<button class="mini-btn" id="exportJson">⬇ Backup (JSON)</button>' +
        '<label class="mini-btn file-import">⬆ Import backup<input type="file" id="importJson" accept="application/json" hidden /></label>' +
        '<button class="mini-btn danger" id="clearData">Clear all expense data</button>' +
      '</div></div>';

    // Primary currency
    var sp = document.getElementById('setPrimary');
    fillCurrencySelect(sp); sp.value = settings.primary;
    sp.addEventListener('change', function () { changePrimary(sp.value); });

    renderRates();
    document.getElementById('fetchRates').addEventListener('click', fetchRates);
    document.getElementById('addCurBtn').addEventListener('click', addCurrency);

    renderCatManage('expense', document.getElementById('catExpenseMount'));
    renderCatManage('income', document.getElementById('catIncomeMount'));
    document.getElementById('addExpCat').addEventListener('click', function () { openCatModal('expense', null); });
    document.getElementById('addIncCat').addEventListener('click', function () { openCatModal('income', null); });

    renderAccts();
    document.getElementById('addAcctBtn').addEventListener('click', addAccount);

    renderWidgetToggles();

    document.getElementById('exportCsv').addEventListener('click', exportCsv);
    document.getElementById('exportJson').addEventListener('click', exportJson);
    document.getElementById('importJson').addEventListener('change', importJson);
    document.getElementById('clearData').addEventListener('click', clearData);
  }

  function changePrimary(code) {
    if (code === settings.primary) return;
    var base = settings.currencies[code].rate || 1;
    Object.keys(settings.currencies).forEach(function (c) { settings.currencies[c].rate = settings.currencies[c].rate / base; });
    settings.currencies[code].rate = 1;
    settings.primary = code;
    saveSettings();
    document.getElementById('currencyBadge').textContent = sym(code) + ' ' + code;
    renderSettings();
    toast('Primary currency set to ' + code, 'success');
  }

  function renderRates() {
    var mount = document.getElementById('ratesMount');
    mount.innerHTML = Object.keys(settings.currencies).map(function (code) {
      var c = settings.currencies[code];
      var isPrimary = code === settings.primary;
      return '<div class="rate-row"><span class="rate-code">' + c.symbol + ' ' + code + (isPrimary ? ' <em>(primary)</em>' : '') + '</span>' +
        '<input type="number" step="0.0001" data-code="' + code + '" value="' + c.rate + '"' + (isPrimary ? ' disabled' : '') + ' />' +
        (isPrimary ? '<span class="rate-del ghost"></span>' : '<button class="rate-del" data-del="' + code + '" title="Remove">✕</button>') + '</div>';
    }).join('');
    mount.querySelectorAll('input[data-code]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var v = parseFloat(inp.value); if (v > 0) { settings.currencies[inp.getAttribute('data-code')].rate = v; saveSettings(); }
      });
    });
    mount.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var code = btn.getAttribute('data-del');
        delete settings.currencies[code]; saveSettings(); renderRates();
      });
    });
  }

  function addCurrency() {
    var code = (document.getElementById('newCurCode').value || '').toUpperCase().trim();
    var s = document.getElementById('newCurSym').value.trim() || code;
    var rate = parseFloat(document.getElementById('newCurRate').value);
    if (!code || !(rate > 0)) { toast('Enter a code and rate'); return; }
    settings.currencies[code] = { symbol: s, rate: rate }; saveSettings(); renderSettings();
    toast('Added ' + code, 'success');
  }

  function fetchRates() {
    toast('Fetching latest rates…');
    fetch('https://open.er-api.com/v6/latest/' + settings.primary)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.rates) throw new Error('no rates');
        Object.keys(settings.currencies).forEach(function (code) {
          if (code === settings.primary) { settings.currencies[code].rate = 1; return; }
          var fx = j.rates[code]; // units of `code` per 1 primary
          if (fx) settings.currencies[code].rate = 1 / fx;
        });
        saveSettings(); renderRates(); toast('Rates updated', 'success');
      })
      .catch(function () { toast('Couldn\'t fetch rates — edit manually', 'error'); });
  }

  function renderCatManage(type, mount) {
    var list = settings.categories[type];
    mount.innerHTML = list.map(function (c) {
      return '<div class="cat-item" draggable="true" data-id="' + c.id + '">' +
        '<span class="drag-dot">⠿</span><span class="cat-swatch" style="background:' + c.color + '"></span>' +
        '<span class="cat-ic">' + c.icon + '</span><span class="cat-lbl">' + esc(c.label) + '</span>' +
        '<button class="ic-btn" data-a="edit" title="Edit">✏️</button>' +
        '<button class="ic-btn del" data-a="del" title="Delete">🗑️</button></div>';
    }).join('');
    mount.querySelectorAll('.cat-item').forEach(function (item) {
      var id = item.getAttribute('data-id');
      item.querySelector('[data-a="edit"]').addEventListener('click', function () { openCatModal(type, list.find(function (x) { return x.id === id; })); });
      item.querySelector('[data-a="del"]').addEventListener('click', function () {
        if (list.length <= 1) { toast('Keep at least one category'); return; }
        if (!confirm('Delete this category? Existing transactions keep their label.')) return;
        settings.categories[type] = list.filter(function (x) { return x.id !== id; }); saveSettings(); renderSettings();
      });
    });
    sortable(mount, function (order) {
      settings.categories[type] = order.map(function (id) { return list.find(function (x) { return x.id === id; }); }).filter(Boolean);
      saveSettings();
    });
  }

  function renderAccts() {
    var mount = document.getElementById('acctMount');
    mount.innerHTML = settings.accounts.map(function (a) {
      return '<div class="cat-item" data-id="' + a.id + '"><span class="cat-ic">' + a.icon + '</span><span class="cat-lbl">' + esc(a.label) + '</span>' +
        '<button class="ic-btn del" data-a="del" title="Delete">🗑️</button></div>';
    }).join('');
    mount.querySelectorAll('[data-a="del"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.closest('.cat-item').getAttribute('data-id');
        if (settings.accounts.length <= 1) { toast('Keep at least one method'); return; }
        settings.accounts = settings.accounts.filter(function (x) { return x.id !== id; }); saveSettings(); renderAccts();
      });
    });
  }
  function addAccount() {
    var icon = document.getElementById('newAcctIcon').value.trim() || '💳';
    var label = document.getElementById('newAcctLabel').value.trim();
    if (!label) { toast('Enter a method name'); return; }
    settings.accounts.push({ id: uid().slice(0, 8), label: label, icon: icon }); saveSettings(); renderSettings();
  }

  function renderWidgetToggles() {
    var mount = document.getElementById('widgetToggles');
    mount.innerHTML = WIDGETS.map(function (w) {
      return '<label class="toggle-row"><span>' + w.name + '</span>' +
        '<input type="checkbox" data-w="' + w.id + '"' + (settings.widgets[w.id] ? ' checked' : '') + ' /></label>';
    }).join('');
    mount.querySelectorAll('input[data-w]').forEach(function (inp) {
      inp.addEventListener('change', function () { settings.widgets[inp.getAttribute('data-w')] = inp.checked; saveSettings(); });
    });
  }

  /* Category modal */
  var catEditType = 'expense', catEditId = null;
  function openCatModal(type, c) {
    catEditType = type; catEditId = c ? c.id : null;
    document.getElementById('catModalTitle').textContent = c ? 'Edit Category' : 'New Category';
    catForm.reset();
    catForm.elements['kind'].value = type;
    var chosen = c ? c.color : SWATCHES[0];
    document.getElementById('cf-color').value = chosen;
    document.getElementById('catSwatches').innerHTML = SWATCHES.map(function (col) {
      return '<button type="button" class="swatch' + (col === chosen ? ' on' : '') + '" data-col="' + col + '" style="background:' + col + '"></button>';
    }).join('');
    document.getElementById('catSwatches').querySelectorAll('.swatch').forEach(function (b) {
      b.addEventListener('click', function () {
        document.getElementById('cf-color').value = b.getAttribute('data-col');
        document.getElementById('catSwatches').querySelectorAll('.swatch').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });
    if (c) { catForm.elements['label'].value = c.label; catForm.elements['icon'].value = c.icon; }
    catModal.classList.add('open');
    setTimeout(function () { catForm.elements['label'].focus(); }, 50);
  }
  function closeCatModal() { catModal.classList.remove('open'); catEditId = null; }
  document.getElementById('catModalClose').addEventListener('click', closeCatModal);
  document.getElementById('catCancelBtn').addEventListener('click', closeCatModal);
  catModal.addEventListener('click', function (e) { if (e.target === catModal) closeCatModal(); });

  catForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData(catForm));
    if (!d.label.trim()) return;
    var list = settings.categories[catEditType];
    var rec = { label: d.label.trim(), icon: d.icon || '🏷️', color: d.color || SWATCHES[0] };
    if (catEditId) {
      var i = list.findIndex(function (x) { return x.id === catEditId; });
      if (i !== -1) list[i] = Object.assign({}, list[i], rec);
    } else {
      list.push(Object.assign({ id: uid().slice(0, 8) }, rec));
    }
    saveSettings(); closeCatModal(); renderSettings();
    toast('Category saved', 'success');
  });

  /* Data import/export */
  function downloadFile(name, content, mime) {
    var blob = new Blob([content], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function exportCsv() {
    var head = ['Date','Type','Description','Category','Amount','Currency','Account','Tags','Notes'];
    var rows = txns.map(function (t) {
      var c = catMeta(t.type, t.category), a = acctMeta(t.account);
      return [t.date, t.type, t.description, c.label, toMajor(t.amount).toFixed(2), t.currency, a.label, (t.tags || []).join(' '), (t.notes || '')]
        .map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
    });
    downloadFile('tracktify-expenses.csv', head.join(',') + '\n' + rows.join('\n'), 'text/csv');
    toast('CSV exported', 'success');
  }
  function exportJson() {
    var backup = { transactions: txns, settings: settings, budgets: budgets, goals: goals, recurring: recurring, exportedAt: new Date().toISOString() };
    downloadFile('tracktify-backup.json', JSON.stringify(backup, null, 2), 'application/json');
    toast('Backup exported', 'success');
  }
  function importJson(e) {
    var file = e.target.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var data = JSON.parse(ev.target.result);
        if (!confirm('Import this backup? It replaces your current expense data.')) return;
        if (data.transactions) { txns = data.transactions; saveTxns(); }
        if (data.settings) { settings = data.settings; saveSettings(); }
        if (data.budgets) { budgets = data.budgets; saveBudgets(); }
        if (data.goals) { goals = data.goals; saveGoals(); }
        if (data.recurring) { recurring = data.recurring; saveRecurring(); }
        document.getElementById('currencyBadge').textContent = sym(settings.primary) + ' ' + settings.primary;
        renderTab(); toast('Backup imported', 'success');
      } catch (err) { toast('Invalid backup file', 'error'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  }
  function clearData() {
    if (!confirm('Delete ALL transactions, budgets, goals and recurring? This cannot be undone.')) return;
    txns = []; budgets = { monthly: 0, categories: {} }; goals = []; recurring = [];
    saveTxns(); saveBudgets(); saveGoals(); saveRecurring();
    renderTab(); toast('Expense data cleared');
  }

  /* ============================================================
     17. INIT
  ============================================================ */
  document.getElementById('currencyBadge').textContent = sym(settings.primary) + ' ' + settings.primary;
  document.getElementById('currencyBadge').addEventListener('click', function () {
    state.tab = 'settings';
    tabBtns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === 'settings'); });
    panels.forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== 'settings'; });
    renderTab();
  });

  // close modals on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    [txnModal, goalModal, recurModal, catModal, dayModal].forEach(function (mw) { mw.classList.remove('open'); });
  });

  // re-render when switching to the expenses view / theme change
  document.addEventListener('tt:view', function (e) { if (e.detail === 'expenses') renderTab(); });
  document.addEventListener('tt:theme', function () { if (TT.view === 'expenses') renderTab(); });

  migrateMoney();        // one-time float → integer-cents upgrade (guarded per user)
  catchUpRecurring();    // recurring materialization (server cron when MODE === 'http')
  renderOverview();

  // Dashboard provider — live data via closure. Money is integer cents; we
  // format with moneyP/money at the edge so the dashboard shows currency text.
  TT.dashboard.register('expenses', function () {
    var mk = curMonthKey();
    var t = totals(txnsInMonth(mk));
    var hasBudget = budgets.monthly > 0;
    var left = hasBudget ? budgets.monthly - t.expense : 0;
    var over = hasBudget && left < 0;
    var stats = [
      { label: 'Spent (mo)', value: moneyP(t.expense), tone: over ? 'bad' : '' },
      hasBudget
        ? { label: over ? 'Over budget' : 'Budget left', value: moneyP(Math.abs(left)), tone: over ? 'bad' : 'good' }
        : { label: 'Income (mo)', value: moneyP(t.income), tone: '' },
      { label: 'Net', value: (t.net < 0 ? '−' : '') + moneyP(Math.abs(t.net)), tone: t.net < 0 ? 'bad' : 'good' }
    ];
    var today = todayStr();
    var weekAhead = ymd(new Date(Date.now() + 7 * 864e5));
    var upcoming = recurring
      .filter(function (r) { return r.active !== false && r.nextDate && r.nextDate >= today && r.nextDate <= weekAhead; })
      .sort(function (a, b) { return a.nextDate < b.nextDate ? -1 : 1; }).slice(0, 5)
      .map(function (r) { return { title: r.description, date: r.nextDate, meta: (r.type === 'income' ? '+' : '−') + money(r.amount, r.currency), atRisk: false }; });
    var recent = txns.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 5)
      .map(function (x) { return { title: x.description, ts: x.createdAt || 0, meta: (x.type === 'income' ? '+' : '−') + money(x.amount, x.currency) }; });
    return {
      name: 'Expenses', icon: '💸', view: 'expenses', stats: stats, recent: recent, upcoming: upcoming,
      headline: t.expense ? moneyP(t.expense) + ' spent this month' + (hasBudget ? (over ? ', over budget!' : ', ' + moneyP(left) + ' left') : '') : ''
    };
  });
})();
