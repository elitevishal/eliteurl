/* EliteURL admin panel */
(function () {
  'use strict';
  var EU = window.EU, d = document, $ = EU.$, $$ = EU.$$, esc = EU.esc, money = EU.money;
  var TITLES = { overview: 'Overview', users: 'Users', links: 'Links', payouts: 'Payouts', fraud: 'Fraud monitor', zones: 'Ad zones', settings: 'Settings', tools: 'Maintenance' };
  var DATA = { users: [], links: [], wd: [] }, WSTATUS = 'all';

  function showMsg(el, t, ok) { el.textContent = t; el.className = 'alert show ' + (ok ? 'ok' : 'err'); }
  function fmtDate(ts) { return ts ? new Date(Number(ts) * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }
  function API(p, o) {
    o = o || {};
    return EU.api(p, o).then(function (r) { if (r.status === 403) { location.href = '/dashboard'; } r.data._status = r.status; return r.data; });
  }
  function post(p, body) { return API(p, { json: body }); }
  function emptyRow(t) { return '<div class="empty"><p>' + t + '</p></div>'; }

  /* ---- navigation ---- */
  function go(v) {
    if (!TITLES[v]) v = 'overview';
    $$('.view').forEach(function (x) { x.classList.toggle('on', x.id === 'view-' + v); });
    $$('.sb-link[data-view]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-view') === v); });
    $('#page-title').textContent = TITLES[v]; d.title = TITLES[v] + ' — Admin — EliteURL';
    $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); window.scrollTo(0, 0);
    if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  }
  $$('.sb-link[data-view]').forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-view')); }); });
  $('#menu-btn').addEventListener('click', function () { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); });
  $('#scrim').addEventListener('click', function () { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); });
  $('#logout').addEventListener('click', function () { fetch('/api/auth/logout', { method: 'POST' }).then(function () { location.href = '/'; }); });

  /* ---- who am i ---- */
  EU.api('/api/me').then(function (r) {
    if (r.status === 401) { location.href = '/login'; return; }
    var u = (r.data || {}).user; if (!u) return;
    $('#who-name').textContent = u.name; $('#who-email').textContent = u.email; $('#avatar').textContent = (u.name || 'A').charAt(0).toUpperCase();
  });

  /* ---- overview ---- */
  function loadOverview() {
    API('/api/admin/overview').then(function (o) {
      if (!o || !o.ok) { $('#ovErr').classList.add('show'); return; }
      $('#ovErr').classList.remove('show');
      if (o.warnings && o.warnings.length) { var w = $('#ovWarn'); w.innerHTML = '<b>Database needs an update.</b> Some columns are missing:<br><code style="font-size:12px">' + o.warnings.map(esc).join('<br>') + '</code>'; w.classList.add('show'); }
      EU.countUp($('#o-users'), o.users.total || 0); EU.countUp($('#o-links'), o.links.links || 0); EU.countUp($('#o-clicks'), o.links.clicks || 0);
      EU.countUp($('#o-valid'), o.links.valid_views || 0); EU.countUp($('#o-invalid'), o.links.invalid_views || 0); EU.countUp($('#o-pending'), o.withdrawals.pending || 0);
      $('#o-est').textContent = money(o.ledger.est); $('#o-conf').textContent = money(o.ledger.conf);
      var n = o.withdrawals.pending || 0, c = $('#nav-pending'); c.textContent = n; c.classList.toggle('hide', !n);
    });
    fetch('/api/admin/economics').then(function (r) { return r.json(); }).then(function (e) {
      var box = $('#econ-body'); if (!e || !e.ok) { box.innerHTML = '<p class="muted">Economics unavailable.</p>'; return; }
      function line(a, b, cls) { return '<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)"><span>' + a + '</span><b class="' + (cls || '') + '">' + b + '</b></div>'; }
      box.innerHTML = line('Ad impressions per view', e.impressions.total + ' <span class="muted" style="font-weight:500;font-size:12px">(' + e.impressions.banners + ' banner + ' + e.impressions.popunders + ' pop)</span>') +
        line('Revenue per view', '$' + e.revenue_per_view_usd.toFixed(5), 'money') + line('Payout per view', '$' + e.payout_per_view_usd.toFixed(5)) +
        line('<b>Margin</b>', e.margin_percent.toFixed(1) + '% ($' + e.margin_per_view_usd.toFixed(5) + ')', e.safe ? 'money' : '') +
        '<div class="alert show ' + (e.safe ? 'ok' : 'err') + '" style="margin-top:12px">' + (e.safe ? '<b>Safe.</b> You earn more than you pay out.' : '<b>Loss!</b> ' + esc(e.warning || '')) + '</div>';
    }).catch(function () {});
  }
  $('#refresh').addEventListener('click', function () { loadOverview(); loadUsers(); loadLinks(); loadPayouts(); EU.toast('Refreshed', 'ok'); });

  /* ---- users ---- */
  function renderUsers() {
    var q = ($('#u-search').value || '').toLowerCase().trim(), f = $('#u-filter').value;
    var list = DATA.users.filter(function (u) {
      var tot = (u.valid_views || 0) + (u.invalid_views || 0), bad = tot > 3 ? (u.invalid_views || 0) * 100 / tot >= 40 : false;
      if (f === 'active' && u.status !== 'active') return false; if (f === 'blocked' && u.status === 'active') return false; if (f === 'flagged' && !(bad || u.fraud_flag)) return false;
      var hay = (String(u.name || '') + ' ' + String(u.email || '') + ' ' + String(u.username || '') + ' #' + String(u.id || '')).toLowerCase();
      return !q || hay.indexOf(q) > -1 || hay.indexOf(q.replace(/^@/, '')) > -1;
    });
    $('#u-sub').textContent = list.length + ' of ' + DATA.users.length + ' users';
    var box = $('#u-list');
    if (!list.length) { box.innerHTML = emptyRow('No users match.'); return; }
    box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>User</th><th>Status</th><th class="num">Valid / Invalid</th><th class="num">Balance</th><th></th></tr></thead><tbody>' + list.map(function (u) {
      var tot = (u.valid_views || 0) + (u.invalid_views || 0), pct = tot > 3 ? Math.round((u.invalid_views || 0) * 100 / tot) : 0, warn = '';
      if (pct >= 40) warn += '<span class="sub-line" style="color:var(--danger);font-weight:700">⚠ ' + pct + '% invalid traffic</span>';
      if (u.fraud_flag) warn += '<span class="sub-line" style="color:var(--warn);font-weight:700">⚑ ' + esc(u.fraud_flag) + '</span>';
      return '<tr><td><b style="color:var(--ink)">' + esc(u.name) + '</b>' + (u.role === 'admin' ? ' <span class="badge brand">admin</span>' : '') + '<span class="sub-line">' + esc(u.email) + '</span></td>' +
        '<td><span class="badge ' + (u.status === 'active' ? 'active' : 'blocked') + '">' + esc(u.status) + '</span></td>' +
        '<td class="num">' + (u.valid_views || 0) + ' / ' + (u.invalid_views || 0) + warn + '</td><td class="num"><b>' + money(u.confirmed_usd) + '</b><span class="sub-line">rate ×' + (u.rate_multiplier || 1) + '</span></td>' +
        '<td><div class="act" style="justify-content:flex-end">' +
        (u.status === 'active' ? '<button class="btn btn-ghost btn-sm" data-u="' + u.id + '" data-a="block">Block</button>' : '<button class="btn btn-primary btn-sm" data-u="' + u.id + '" data-a="activate">Unblock</button>') +
        '<button class="btn btn-secondary btn-sm" data-u="' + u.id + '" data-a="adjust">Balance</button><button class="btn btn-secondary btn-sm" data-u="' + u.id + '" data-a="rate">Rate</button>' +
        '<button class="btn btn-secondary btn-sm" data-u="' + u.id + '" data-a="resetlink">Reset link</button><button class="btn btn-secondary btn-sm" data-u="' + u.id + '" data-a="otp">OTP</button><button class="btn btn-secondary btn-sm" data-u="' + u.id + '" data-a="flag">Flag</button></div></td></tr>';
    }).join('') + '</tbody></table></div>';
    $$('[data-u]', box).forEach(function (b) { b.addEventListener('click', function () { userAction(b.getAttribute('data-u'), b.getAttribute('data-a')); }); });
  }
  function userAction(id, act) {
    var u = DATA.users.filter(function (x) { return String(x.id) === String(id); })[0] || {}, body = { id: id, action: act };
    function send() { return post('/api/admin/users', body).then(function (r) { if (!r.ok) EU.toast(r.error || 'Action failed', 'err'); else EU.toast('Done', 'ok'); loadUsers(); return r; }); }
    if (act === 'adjust') return EU.modal({ title: 'Adjust balance', text: u.email, okText: 'Apply', fields: [{ name: 'amount', label: 'Amount in USD', type: 'number', step: '0.0001', placeholder: 'e.g. 2.5 or -1', hint: 'Positive adds to the balance, negative deducts.' }, { name: 'note', label: 'Reason (optional)', placeholder: 'Bonus / correction' }] }).then(function (v) { if (!v || v.amount === '') return; body.amount = v.amount; body.note = v.note; send(); });
    if (act === 'rate') return EU.modal({ title: 'Earning rate', text: u.email, okText: 'Save rate', fields: [{ name: 'value', label: 'Rate multiplier', type: 'number', step: '0.05', value: u.rate_multiplier || 1, hint: '1 = normal, 0.5 = half, 2 = double.' }] }).then(function (v) { if (!v) return; body.value = v.value; send(); });
    if (act === 'flag') return EU.modal({ title: 'Flag user', text: u.email, okText: 'Flag', fields: [{ name: 'flag', label: 'Flag label', value: 'fake traffic' }] }).then(function (v) { if (!v) return; body.flag = v.flag; body.note = v.flag; send(); });
    if (act === 'block') return EU.modal({ title: 'Block user?', text: u.email + ' will no longer be able to earn or sign in.', okText: 'Block user', danger: true, fields: [{ name: 'note', label: 'Reason (optional)' }] }).then(function (v) { if (!v) return; body.note = v.note; send(); });
    if (act === 'resetlink') return post('/api/admin/users', { id: id, action: 'resetlink' }).then(function (r) {
      if (r && r.link) EU.modal({ title: 'Password reset link', text: 'Valid for 1 hour. Send it to the user.', fields: [{ name: 'l', label: 'Link', value: r.link }], okText: 'Copy link', cancel: 'Close' }).then(function (v) { if (v) EU.copy(r.link, null, 'Link copied'); });
      else EU.toast((r && r.error) || 'Could not create link', 'err');
    });
    if (act === 'otp') return API('/api/admin/otp?user_id=' + encodeURIComponent(id)).then(function (r) {
      if (r && r.code) EU.modal({ title: 'Latest OTP', text: 'Valid for 10 minutes.', html: '<div class="mono" style="font-size:34px;letter-spacing:.3em;text-align:center;color:var(--ink);padding:10px 0">' + esc(r.code) + '</div>', okText: 'Copy code', cancel: 'Close' }).then(function (v) { if (v) EU.copy(String(r.code), null, 'Code copied'); });
      else EU.toast('No OTP found. Ask the user to tap “Forgot password” first.', 'err');
    });
    send();
  }
  function loadUsers() { return API('/api/admin/users').then(function (r) { if (!r.ok) return; DATA.users = r.users || []; renderUsers(); }); }
  $('#u-search').addEventListener('input', renderUsers); $('#u-filter').addEventListener('change', renderUsers);

  /* ---- links ---- */
  function renderLinks() {
    var q = ($('#al-search').value || '').toLowerCase().trim(), box = $('#l-list');
    var st = (($('#al-status') || {}).value || 'all');
    var list = DATA.links.filter(function (l) {
      if (st !== 'all' && String(l.status || 'active') !== st) return false;
      return !q || (l.slug + ' ' + l.email + ' ' + l.destination_url).toLowerCase().indexOf(q) > -1;
    });
    if (!list.length) { box.innerHTML = emptyRow(DATA.links.length ? 'No links match.' : 'No links yet.'); return; }
    box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Slug</th><th>Owner</th><th>Destination</th><th class="num">Clicks</th><th class="num">Valid</th><th>Status</th></tr></thead><tbody>' + list.map(function (l) {
      return '<tr><td><a class="cell-link" href="/' + esc(l.slug) + '" target="_blank" rel="noopener">/' + esc(l.slug) + '</a></td><td>' + esc(l.email) + '</td><td><div class="truncate" title="' + esc(l.destination_url) + '">' + esc(l.destination_url) + '</div></td><td class="num">' + EU.num(l.clicks) + '</td><td class="num">' + EU.num(l.valid_views) + '</td><td><span class="badge ' + esc(l.status || 'active') + '">' + esc(l.status || 'active') + '</span></td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function loadLinks() { return API('/api/admin/links').then(function (r) { if (!r.ok) return; DATA.links = r.links || []; renderLinks(); }); }
  $('#al-search').addEventListener('input', renderLinks);
  if ($('#al-status')) $('#al-status').addEventListener('change', renderLinks);

  /* ---- payouts ---- */
  function renderPayouts() {
    var box = $('#w-list');
    var q = (($('#w-search') || {}).value || '').toLowerCase().trim();
    var list = DATA.wd.filter(function (w) {
      if (WSTATUS !== 'all' && w.status !== WSTATUS) return false;
      if (!q) return true;
      var hay = (String(w.name || '') + ' ' + String(w.email || '') + ' ' + String(w.method || '') + ' ' + String(w.amount_usd || '') + ' ' + String(w.status || '') + ' #' + String(w.id || '')).toLowerCase();
      return hay.indexOf(q) > -1;
    });
    if (!list.length) { box.innerHTML = emptyRow('No withdrawal requests here.'); return; }
    box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>User</th><th class="num">Amount</th><th>Method</th><th>Payout details</th><th>Status</th><th></th></tr></thead><tbody>' + list.map(function (w) {
      var a = '';
      if (w.status === 'pending') a = '<button class="btn btn-primary btn-sm" data-wd="' + w.id + '" data-act="approve">Approve</button><button class="btn btn-danger btn-sm" data-wd="' + w.id + '" data-act="reject">Reject</button>';
      else if (w.status === 'approved') a = '<button class="btn btn-success btn-sm" data-wd="' + w.id + '" data-act="paid">Mark paid</button><button class="btn btn-secondary btn-sm" data-wd="' + w.id + '" data-set="pending">Back to pending</button><button class="btn btn-danger btn-sm" data-wd="' + w.id + '" data-act="reject">Reject</button>';
      else if (w.status === 'rejected') a = '<button class="btn btn-secondary btn-sm" data-wd="' + w.id + '" data-set="pending">Restore to pending</button><button class="btn btn-secondary btn-sm" data-wd="' + w.id + '" data-set="approved">Approve</button>';
      else a = '<span class="muted">Paid ✓ ' + esc(w.txn_ref || '') + '</span>';
      return '<tr><td>' + esc(w.email) + '<span class="sub-line">' + fmtDate(w.requested_at) + '</span></td><td class="num"><b>' + money(w.amount_usd, 2) + '</b></td><td>' + esc(String(w.method || '').toUpperCase()) + '</td>' +
        '<td><div style="max-width:240px;word-break:break-all;font-size:13px;font-weight:600;color:var(--ink)">' + esc(w.payee_enc || '—') + '</div><button class="btn btn-ghost btn-sm" data-pay="' + esc(w.payee_enc || '') + '" style="margin-top:4px">Copy</button></td>' +
        '<td><span class="badge ' + esc(w.status || 'pending') + '">' + esc(w.status) + '</span></td><td><div class="act" style="justify-content:flex-end">' + a + '</div></td></tr>';
    }).join('') + '</tbody></table></div>';
    $$('[data-pay]', box).forEach(function (b) { b.addEventListener('click', function () { EU.copy(b.getAttribute('data-pay'), b, 'Payout details copied'); }); });
    $$('[data-set]', box).forEach(function (b) { b.addEventListener('click', function () {
      EU.modal({ title: 'Change status', text: 'Set this request to “' + b.getAttribute('data-set') + '”.', fields: [{ name: 'note', label: 'Note (optional)' }], okText: 'Change status' }).then(function (v) {
        if (!v) return; post('/api/admin/withdrawals', { id: Number(b.getAttribute('data-wd')), action: 'setstatus', status: b.getAttribute('data-set'), note: v.note }).then(function (r) { if (r && r.ok) { EU.toast('Status updated', 'ok'); loadPayouts(); } else EU.toast((r && r.error) || 'Could not change status', 'err'); });
      });
    }); });
    $$('[data-act]', box).forEach(function (b) { b.addEventListener('click', function () {
      var act = b.getAttribute('data-act'), id = b.getAttribute('data-wd'), body = { id: id, action: act };
      var cfg = act === 'paid' ? { title: 'Mark as paid', text: 'Enter the transaction reference (UTR / UPI ref / PayPal ID).', okText: 'Mark paid', fields: [{ name: 'txn_ref', label: 'Transaction reference', placeholder: 'UTR123456' }] }
        : act === 'reject' ? { title: 'Reject withdrawal', text: 'The amount returns to the creator’s balance.', okText: 'Reject', danger: true, fields: [{ name: 'note', label: 'Reason (optional)' }] }
        : { title: 'Approve withdrawal', text: 'Approve this payout request?', okText: 'Approve' };
      EU.modal(cfg).then(function (v) { if (!v) return; if (v.txn_ref !== undefined) body.txn_ref = v.txn_ref; if (v.note !== undefined) body.note = v.note; post('/api/admin/withdrawals', body).then(function (r) { if (r && r.ok === false) EU.toast(r.error || 'Failed', 'err'); else EU.toast('Updated', 'ok'); loadPayouts(); loadOverview(); }); });
    }); });
  }
  function loadPayouts() { return API('/api/admin/withdrawals').then(function (r) { if (!r.ok) return; DATA.wd = r.withdrawals || []; renderPayouts(); }); }
  $$('#w-seg button').forEach(function (b) { b.addEventListener('click', function () { WSTATUS = b.getAttribute('data-s'); $$('#w-seg button').forEach(function (x) { x.classList.toggle('on', x === b); }); renderPayouts(); }); });
  if ($('#w-search')) $('#w-search').addEventListener('input', renderPayouts);

  /* ---- settings ---- */
  API('/api/admin/settings').then(function (r) {
    if (!r.ok) return; var m = {}; r.settings.forEach(function (s) { m[s.key] = s.value; });
    $('#s-steps').value = m.steps_count || 7; $('#s-count').value = m.countdown_seconds || 15; $('#s-share').value = m.creator_share || 0.95; $('#s-min').value = m.min_withdrawal_usd || 5;
    $('#s-dest').value = m.show_destination || '0'; $('#s-support').value = m.support_email || 'support@eliteofficial.in'; $('#s-payout').value = m.payout_hours || 12;
    $('#s-signup').checked = (m.signup_enabled == null ? '1' : m.signup_enabled) !== '0'; $('#s-maint').checked = m.maintenance_mode === '1';
  });
  $('#save-settings').addEventListener('click', function () {
    var m = $('#s-msg'); m.className = 'alert';
    post('/api/admin/settings', { steps_count: $('#s-steps').value, countdown_seconds: $('#s-count').value, creator_share: $('#s-share').value, min_withdrawal_usd: $('#s-min').value, show_destination: $('#s-dest').value, support_email: $('#s-support').value, payout_hours: $('#s-payout').value, signup_enabled: $('#s-signup').checked ? '1' : '0', maintenance_mode: $('#s-maint').checked ? '1' : '0' })
      .then(function (r) { showMsg(m, r.ok ? 'Settings saved.' : 'Could not save.', !!r.ok); if (r.ok) EU.toast('Settings saved', 'ok'); });
  });

  /* ---- ad zones ---- */
  function loadZones() {
    API('/api/admin/zones').then(function (r) {
      if (!r.ok) return; if (r.build) $('#buildtag').textContent = r.build;
      var box = $('#z-list'); if (!r.zones.length) { box.innerHTML = emptyRow('No ad zones yet.'); return; }
      box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Step</th><th>Network</th><th>Format</th><th>Label</th><th>Status</th><th>Code</th></tr></thead><tbody>' + r.zones.map(function (z) {
        return '<tr><td>' + z.step_no + '</td><td>' + esc(z.network) + '</td><td>' + esc(z.format) + '</td><td>' + esc(z.label) + '</td><td><span class="badge ' + esc(z.status) + '">' + esc(z.status) + '</span></td><td>' + (z.has_script ? '<span class="money" style="font-weight:800">✓ ' + z.len + '</span>' : '<span style="color:var(--danger);font-weight:800">✗ EMPTY</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    });
  }
  $('#add-zone').addEventListener('click', function () {
    var m = $('#z-msg'); m.className = 'alert';
    var body = { network: $('#z-network').value, format: $('#z-format').value, step_no: $('#z-step').value, label: $('#z-label').value, snippet: $('#z-snippet').value };
    if (!body.snippet.trim()) { showMsg(m, 'Paste the ad code first.', false); return; }
    post('/api/admin/zones', body).then(function (r) { showMsg(m, r.ok ? 'Zone added.' : 'Could not add zone.', !!r.ok); if (r.ok) { $('#z-snippet').value = ''; loadZones(); } });
  });

  /* ---- tools ---- */
  $('#confirm-earn-btn').addEventListener('click', function () {
    var b = this, m = $('#confirm-earn-msg'); b.disabled = true; m.className = 'alert';
    post('/api/admin/confirm-earnings', {}).then(function (r) { b.disabled = false; if (r && r.ok) showMsg(m, r.message || 'Done.', true); else showMsg(m, (r && r.error) || 'Failed', false); loadOverview(); }).catch(function () { b.disabled = false; showMsg(m, 'Network error', false); });
  });
  $('#cleanup-btn').addEventListener('click', function () {
    var b = this, m = $('#cleanup-msg'); m.className = 'alert';
    EU.confirm('Run database cleanup?', 'Old visit logs are deleted. Users, links, earnings and withdrawals will NOT be touched.', 'Run cleanup').then(function (ok) {
      if (!ok) return; b.disabled = true;
      post('/api/admin/cleanup', {}).then(function (r) { b.disabled = false; if (r && r.ok) showMsg(m, 'Deleted ' + r.deleted.sessions + ' sessions, ' + r.deleted.steps + ' step logs, ' + r.deleted.limits + ' rate limits, ' + r.deleted.otp + ' OTPs. Your money and accounts are safe.', true); else showMsg(m, (r && r.error) || 'Cleanup failed', false); }).catch(function () { b.disabled = false; showMsg(m, 'Network error', false); });
    });
  });
  $('#tm-send').addEventListener('click', function () {
    var to = $('#tm-to').value.trim(), m = $('#tm-msg'); if (!to) { showMsg(m, 'Enter an email address.', false); return; }
    post('/api/admin/testmail', { to: to }).then(function (r) { if (r && r.ok) showMsg(m, 'Sent from ' + (r.from || '?') + '. Check the inbox and spam folder.', true); else showMsg(m, (r && (r.error || r.response)) || 'Failed. Check RESEND_API_KEY and MAIL_FROM.', false); });
  });

  /* ---- CSV export ---- */
  function csv(rows, cols) { return [cols.join(',')].concat(rows.map(function (r) { return cols.map(function (c) { var v = r[c]; return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); })).join('\n'); }
  function download(name, text) { var a = d.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' })); a.download = name; a.click(); }
  $('#csvUsers').addEventListener('click', function () { download('eliteurl-users.csv', csv(DATA.users, ['id', 'name', 'email', 'role', 'status', 'confirmed_usd', 'estimated_usd', 'valid_views', 'invalid_views', 'rate_multiplier'])); });
  $('#csvLinks').addEventListener('click', function () { download('eliteurl-links.csv', csv(DATA.links, ['slug', 'email', 'destination_url', 'clicks', 'valid_views', 'status'])); });
  $('#csvWd').addEventListener('click', function () { download('eliteurl-payouts.csv', csv(DATA.wd, ['id', 'email', 'amount_usd', 'method', 'status', 'txn_ref', 'requested_at'])); });

  /* ---- boot ---- */
  loadOverview(); loadUsers(); loadLinks(); loadPayouts(); loadZones();

  /* ---- fraud monitor ---- */
  function loadFraud() {
    var body = document.getElementById('fraud-body'); if (!body) return;
    EU.api('/api/admin/fraud').then(function (r) {
      if (r.status !== 200 || !r.data || !r.data.ok) { body.innerHTML = '<p class="muted" style="font-size:13px">Could not load fraud data.</p>'; return; }
      var s = r.data.stats || {};
      function set(id, v) { var el = document.getElementById(id); if (el) el.textContent = EU.num(v || 0); }
      set('f-blocked', s.blocked_views || s.invalid_views);
      set('f-bots', s.bot_hits);
      set('f-vpn', s.vpn_hits);
      set('f-risky', s.risky_users || s.risky_accounts);
      var ev = r.data.events || [];
      if (!ev.length) { body.innerHTML = '<p class="muted" style="font-size:13px">No suspicious activity yet. That is good.</p>'; return; }
      body.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>User</th><th>Reason</th><th>Severity</th></tr></thead><tbody>'
        + ev.slice(0, 50).map(function (x) {
            var sev = String(x.severity || x.level || 'low').toLowerCase();
            var cls = sev === 'high' ? 'err' : sev === 'medium' ? 'warn' : 'ok';
            return '<tr><td>' + esc(x.created_at ? new Date(Number(x.created_at) * 1000).toLocaleString('en-IN') : '—') + '</td>'
              + '<td>' + esc(x.user_name || x.email || ('#' + (x.user_id || '?'))) + '</td>'
              + '<td>' + esc(x.reason || x.type || '—') + '</td>'
              + '<td><span class="badge ' + cls + '">' + esc(sev) + '</span></td></tr>';
          }).join('') + '</tbody></table></div>';
    }).catch(function () { body.innerHTML = '<p class="muted" style="font-size:13px">Network error.</p>'; });
  }

  var _fr = document.getElementById('fraud-refresh'); if (_fr) _fr.addEventListener('click', loadFraud);
  var _gof = go; go = function (v) { _gof(v); if (v === 'fraud') loadFraud(); };
  go((location.hash || '#overview').slice(1)); window.addEventListener('hashchange', function () { go((location.hash || '#overview').slice(1)); });
})();
