/* ============================================================
   Tracktify — core shell + Job Applications tracker
   Shared utilities are exposed on window.TT for other modules.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- TT namespace, shared helpers and the async data layer are
       created in core.js (loaded before this file). We just consume them.
       Keeping the local aliases means the rest of this module is untouched. */
  var TT = window.TT;
  var esc = TT.esc, uid = TT.uid, fmtDate = TT.fmtDate, load = TT.load, store = TT.store, toast = TT.toast;
  TT.view = TT.view || 'jobs';
  if (!TT.mobileAdd) TT.mobileAdd = {};

  /* ---------- Theme ---------- */
  var root       = document.documentElement;
  var themeBtn   = document.getElementById('themeToggle');
  var themeLabel = document.getElementById('themeLabel');
  var savedTheme = localStorage.getItem('tracktify-theme');
  var initTheme  = savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.setAttribute('data-theme', initTheme);
  themeLabel.textContent = initTheme === 'dark' ? 'Dark mode' : 'Light mode';
  themeBtn.addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('tracktify-theme', next);
    themeLabel.textContent = next === 'dark' ? 'Dark mode' : 'Light mode';
    document.dispatchEvent(new CustomEvent('tt:theme', { detail: next }));
  });

  /* ---------- Sidebar (mobile) ---------- */
  var sidebar      = document.getElementById('sidebar');
  var backdrop     = document.getElementById('backdrop');
  var menuBtn      = document.getElementById('menuBtn');
  var sidebarClose = document.getElementById('sidebarClose');
  menuBtn.addEventListener('click', function () {
    sidebar.classList.add('open'); backdrop.classList.add('show');
  });
  function closeSidebar() { sidebar.classList.remove('open'); backdrop.classList.remove('show'); }
  sidebarClose.addEventListener('click', closeSidebar);
  backdrop.addEventListener('click', closeSidebar);

  /* ---------- View switching ---------- */
  var viewTitle = document.getElementById('viewTitle');
  var TITLES = {
    dashboard: 'Dashboard',
    jobs: 'Job Applications', expenses: 'Finance', events: 'Events',
    habits: 'Habits', water: 'Water', workouts: 'Workouts', sleep: 'Sleep', calories: 'Calories'
  };

  // A nav button's unique key. Built-ins key by tracker name; custom trackers
  // share the single #view-custom container but carry a data-custom-id so we
  // can tell which one is active. (Keeps switchView generic — no per-view list.)
  function navKeyOf(btn) {
    var c = btn.getAttribute('data-custom-id');
    return c ? btn.getAttribute('data-tracker') + ':' + c : btn.getAttribute('data-tracker');
  }

  // Bind any nav buttons not yet wired (called again by custom.js after it
  // injects its own buttons, so dynamic trackers get the same behavior).
  function bindNav() {
    document.querySelectorAll('.nav-item[data-tracker]').forEach(function (btn) {
      if (btn._navBound) return;
      btn._navBound = true;
      btn.addEventListener('click', function () {
        switchView(btn.getAttribute('data-tracker'), navKeyOf(btn), btn.getAttribute('data-title'));
        closeSidebar();
      });
    });
  }

  function switchView(name, key, title) {
    TT.view = name;
    TT.navKey = key || name;
    // generic: reveal only #view-<name>, hide every other view container
    document.querySelectorAll('[id^="view-"]').forEach(function (el) {
      el.hidden = el.id !== 'view-' + name;
    });
    document.querySelectorAll('.nav-item[data-tracker]').forEach(function (b) {
      b.classList.toggle('active', navKeyOf(b) === TT.navKey);
    });
    viewTitle.textContent = title || TITLES[name] || name;
    document.dispatchEvent(new CustomEvent('tt:view', { detail: name }));
  }

  bindNav();
  TT.bindNav = bindNav;          // custom.js re-binds after adding buttons
  TT.switchView = switchView;    // custom.js switches programmatically

  document.getElementById('mobileAddBtn').addEventListener('click', function () {
    var fn = TT.mobileAdd[TT.view];
    if (fn) fn();
  });

  /* ============================================================
     JOB APPLICATIONS
  ============================================================ */
  var jobs = load('tracktify-jobs', []);
  var jobFilter = 'all';
  var jobEditId = null;

  var jobModal   = document.getElementById('modalWrap');
  var jobForm    = document.getElementById('jobForm');
  var jobList    = document.getElementById('jobList');
  var jobSummary = document.getElementById('summary');
  var jobEmpty   = document.getElementById('empty');
  var jobNoMatch = document.getElementById('noMatch');

  function saveJobs() { store('tracktify-jobs', jobs); }

  function openJobModal(job) {
    jobEditId = job ? job.id : null;
    document.getElementById('jobModalTitle').textContent = job ? 'Edit Application' : 'Add Application';
    jobForm.reset();
    if (job) {
      ['id','title','company','location','date','url','status','notes'].forEach(function (k) {
        if (jobForm.elements[k]) jobForm.elements[k].value = job[k] || '';
      });
      if (!job.status) jobForm.elements['status'].value = 'pending';
    }
    jobModal.classList.add('open');
    setTimeout(function () { jobForm.elements['title'].focus(); }, 50);
  }
  function closeJobModal() { jobModal.classList.remove('open'); jobEditId = null; }

  document.getElementById('addBtn').addEventListener('click', function () { openJobModal(null); });
  document.getElementById('addBtnEmpty').addEventListener('click', function () { openJobModal(null); });
  document.getElementById('modalClose').addEventListener('click', closeJobModal);
  document.getElementById('cancelBtn').addEventListener('click', closeJobModal);
  jobModal.addEventListener('click', function (e) { if (e.target === jobModal) closeJobModal(); });
  TT.mobileAdd.jobs = function () { openJobModal(null); };

  jobForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var data = Object.fromEntries(new FormData(jobForm));
    if (!data.title.trim()) { jobForm.elements['title'].focus(); return; }
    if (jobEditId) {
      var i = jobs.findIndex(function (j) { return j.id === jobEditId; });
      if (i !== -1) jobs[i] = Object.assign({}, jobs[i], data, { id: jobEditId });
      toast('Application updated');
    } else {
      jobs.push(Object.assign({}, data, { id: uid(), createdAt: Date.now() }));
      toast('Application added', 'success');
    }
    saveJobs(); renderJobs(); closeJobModal();
  });

  document.querySelectorAll('#view-jobs .f-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#view-jobs .f-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      jobFilter = btn.getAttribute('data-f');
      renderJobs();
    });
  });

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeJobModal(); });

  function jobChip(cls, n, l) {
    return '<div class="chip s-' + cls + '"><span class="chip-n">' + n + '</span><span class="chip-l">' + l + '</span></div>';
  }
  function renderJobSummary() {
    var c = { all: jobs.length, pending: 0, noreply: 0, approved: 0, denied: 0 };
    jobs.forEach(function (j) {
      if (j.status === 'pending')  c.pending++;
      if (j.status === 'no-reply') c.noreply++;
      if (j.status === 'approved') c.approved++;
      if (j.status === 'denied')   c.denied++;
    });
    jobSummary.innerHTML =
      jobChip('all', c.all, 'Total') + jobChip('pending', c.pending, 'Pending') +
      jobChip('noreply', c.noreply, 'No Reply') + jobChip('approved', c.approved, 'Approved') +
      jobChip('denied', c.denied, 'Denied');
  }
  function jobStatusOpts(cur) {
    return [['pending','⏳ Pending'],['no-reply','🔇 No Reply'],['approved','✅ Approved'],['denied','❌ Denied']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; })
      .join('');
  }
  function makeJobRow(job) {
    var li = document.createElement('li');
    li.className = 'job-row st-' + esc(job.status);
    var meta = [];
    if (job.company)  meta.push(esc(job.company));
    if (job.location) meta.push(esc(job.location));
    if (job.date)     meta.push('Applied ' + fmtDate(job.date));
    var urlHtml = job.url ? '<span><a class="job-link" href="' + esc(job.url) + '" target="_blank" rel="noopener">View listing ↗</a></span>' : '';
    li.innerHTML =
      '<div class="job-left">' +
        '<div class="job-title">' + esc(job.title) + '</div>' +
        (meta.length || urlHtml ? '<div class="job-meta">' + meta.map(function (m) { return '<span>' + m + '</span>'; }).join('') + urlHtml + '</div>' : '') +
        (job.notes ? '<div class="job-notes">' + esc(job.notes) + '</div>' : '') +
      '</div>' +
      '<div class="job-actions">' +
        '<select class="status-pick st-' + esc(job.status) + '" aria-label="Status">' + jobStatusOpts(job.status) + '</select>' +
        '<button class="ic-btn" data-a="edit" title="Edit">✏️</button>' +
        '<button class="ic-btn del" data-a="del" title="Delete">🗑️</button>' +
      '</div>';
    li.querySelector('.status-pick').addEventListener('change', function (e) {
      var j = jobs.find(function (x) { return x.id === job.id; });
      if (!j) return;
      j.status = e.target.value;
      e.target.className = 'status-pick st-' + j.status;
      li.className = 'job-row st-' + j.status;
      saveJobs(); renderJobSummary();
      if (jobFilter !== 'all') renderJobs();
    });
    li.querySelector('[data-a="edit"]').addEventListener('click', function () {
      var j = jobs.find(function (x) { return x.id === job.id; });
      if (j) openJobModal(j);
    });
    li.querySelector('[data-a="del"]').addEventListener('click', function () {
      if (!confirm('Delete "' + job.title + '"?')) return;
      jobs = jobs.filter(function (x) { return x.id !== job.id; });
      saveJobs(); renderJobs(); toast('Application deleted');
    });
    return li;
  }
  function renderJobs() {
    renderJobSummary();
    var list = jobFilter === 'all' ? jobs : jobs.filter(function (j) { return j.status === jobFilter; });
    jobList.innerHTML = '';
    jobNoMatch.hidden = true;
    if (jobs.length === 0) { jobEmpty.classList.add('show'); return; }
    jobEmpty.classList.remove('show');
    if (list.length === 0) { jobNoMatch.hidden = false; return; }
    list.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); })
        .forEach(function (j) { jobList.appendChild(makeJobRow(j)); });
  }

  renderJobs();

  // Dashboard provider — live data via closure (see TT.dashboard in core.js).
  TT.dashboard.register('jobs', function () {
    var by = function (s) { return jobs.filter(function (j) { return j.status === s; }).length; };
    var pending = by('pending'), noreply = by('no-reply'), approved = by('approved');
    return {
      name: 'Job Applications', icon: '💼', view: 'jobs',
      stats: [
        { label: 'Pending', value: pending, tone: pending ? 'warn' : '' },
        { label: 'No reply', value: noreply, tone: noreply ? 'warn' : '' },
        { label: 'Approved', value: approved, tone: approved ? 'good' : '' }
      ],
      recent: jobs.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 5)
        .map(function (j) { return { title: j.title + (j.company ? ' · ' + j.company : ''), ts: j.createdAt || 0, meta: (j.status || '').replace('-', ' ') }; }),
      upcoming: [],
      headline: jobs.length ? jobs.length + ' application' + (jobs.length === 1 ? '' : 's') + (pending ? ', ' + pending + ' pending' : '') + (noreply ? ', ' + noreply + ' awaiting reply' : '') : ''
    };
  });
})();
