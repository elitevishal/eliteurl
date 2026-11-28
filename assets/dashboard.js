/* EliteURL user dashboard */
(function () {
  'use strict';
  var EU = window.EU, d = document, $ = EU.$, $$ = EU.$$, esc = EU.esc, money = EU.money;
  var TITLES = { overview: 'Overview', create: 'Create link', links: 'My links', earnings: 'Earnings & payouts', referrals: 'Referrals', account: 'Account' };
  var NAMES = { US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia', IN: 'India', PK: 'Pakistan', BD: 'Bangladesh', AE: 'UAE', SA: 'Saudi Arabia', DE: 'Germany', FR: 'France', NL: 'Netherlands', SG: 'Singapore', MY: 'Malaysia', ID: 'Indonesia', PH: 'Philippines', NG: 'Nigeria', KE: 'Kenya', ZA: 'South Africa', BR: 'Brazil', ALL: 'Other countries' };
  var ME = null, SITE = '', LINKS = [], WD = null, FOLDERS = [], FOLD_FILTER = '';

  function showMsg(el, t, ok) { el.textContent = t; el.className = 'alert show ' + (ok ? 'ok' : 'err'); }
  function setBusy(b, on, label) { if (on) { b.setAttribute('data-l', b.textContent); b.disabled = true; b.innerHTML = '<span class="spin"></span> ' + label; } else { b.disabled = false; b.textContent = b.getAttribute('data-l') || label; } }
  function origin() { return SITE || location.origin; }
  function fmtDate(ts) { if (!ts) return '—'; return new Date(Number(ts) * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }

  /* ---------- navigation ---------- */
  function go(view) {
    if (!TITLES[view]) view = 'overview';
    $$('.view').forEach(function (v) { v.classList.toggle('on', v.id === 'view-' + view); });
    $$('.sb-link[data-view]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-view') === view); });
    $('#page-title').textContent = TITLES[view];
    d.title = TITLES[view] + ' — EliteURL';
    closeMenu(); window.scrollTo(0, 0);
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  }
  $$('.sb-link[data-view]').forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-view')); }); });
  $$('[data-go]').forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-go')); }); });
  function openMenu() { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); }
  function closeMenu() { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); }
  $('#menu-btn').addEventListener('click', openMenu); $('#scrim').addEventListener('click', closeMenu);

  /* ---------- account / balances ---------- */
  function loadMe() {
    return EU.api('/api/me').then(function (r) {
      if (r.status === 401) { location.href = '/login'; return; }
      var m = r.data;
      if (!m || !m.ok) { $('#hello').textContent = 'Could not load your account'; return; }
      ME = m; SITE = m.site_url || '';
      var first = (m.user.name || 'there').split(' ')[0];
      $('#hello').textContent = 'Welcome back, ' + first;
      $('#who-name').textContent = m.user.name; $('#who-email').textContent = m.user.email;
      $('#avatar').textContent = (m.user.name || 'U').trim().charAt(0).toUpperCase();
      if (m.user.role === 'admin') $('#adminlink').classList.remove('hide');
      $('#b-est').textContent = money(m.estimated_usd); $('#b-conf').textContent = money(m.confirmed_usd);
      EU.countUp($('#b-valid'), m.valid_views || 0);
      EU.countUp($('#k-links'), m.links || 0); EU.countUp($('#k-clicks'), m.clicks || 0); EU.countUp($('#k-valid'), m.valid_views || 0); EU.countUp($('#k-invalid'), m.invalid_views || 0);
      var tot = (m.valid_views || 0) + (m.invalid_views || 0);
      if (tot > 5) $('#k-ratio').textContent = Math.round((m.invalid_views || 0) * 100 / tot) + '% of all views';
      $('#e-avail').textContent = money(m.confirmed_usd);
      $('#a-name').value = m.user.name; $('#a-email').value = m.user.email; $('#a-ref').value = m.user.referral_code || '—';
      var se = m.support_email || 'support@eliteofficial.in'; var el = $('#sup-email'); el.textContent = se; el.href = 'mailto:' + se;
      if (m.min_withdrawal_usd != null) $('#r-min').textContent = '$' + Number(m.min_withdrawal_usd).toFixed(0);
      if (m.payout_hours != null) $('#r-hrs').textContent = Number(m.payout_hours) + 'h';
      renderTodo();
    }).catch(function () { $('#hello').textContent = 'Network problem — please refresh'; });
  }

  function renderTodo() {
    var hasLink = LINKS.length > 0, hasViews = ME && (ME.valid_views || 0) > 0, hasPaid = WD && (WD.withdrawals || []).some(function (w) { return w.status === 'paid'; });
    var items = [['Create your first short link', hasLink], ['Get your first verified view', hasViews], ['Make your first withdrawal', hasPaid]];
    $('#todo').innerHTML = items.map(function (i) { return '<div class="todo-i' + (i[1] ? ' done' : '') + '"><span class="ck"></span><b>' + i[0] + '</b></div>'; }).join('');
    var done = items.filter(function (i) { return i[1]; }).length;
    $('#todo-sub').textContent = done === 3 ? 'All done — nice work!' : done + ' of 3 completed';
  }

  /* ---------- links ---------- */
  function linkUrl(l) { return origin() + '/' + l.slug; }
  function openQR(url) {
    var src = 'https://api.qrserver.com/v1/create-qr-code/?size=480x480&margin=8&data=' + encodeURIComponent(url);
    EU.modal({ title: 'QR code', text: url, html: '<img class="qr" alt="QR code for ' + esc(url) + '" src="' + src + '">', okText: 'Download', cancel: 'Close' }).then(function (v) {
      if (v) { var a = d.createElement('a'); a.href = src; a.target = '_blank'; a.rel = 'noopener'; a.download = 'qr.png'; d.body.appendChild(a); a.click(); a.remove(); }
    });
  }
  function emptyLinks() {
    return '<div class="empty"><div class="em-ico"><svg viewBox="0 0 24 24"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg></div><h4>No links yet</h4><p>Create your first short link and start earning from every verified view.</p><button class="btn btn-primary" data-go="create" type="button">Create a link</button></div>';
  }
  function linkRows(list) {
    var rows = list.map(function (l) {
      var full = linkUrl(l), st = esc(l.status || 'active');
      var tags = (l.folder_name ? ' <span class="badge brand">' + esc(l.folder_name) + '</span>' : '') + (l.locked ? ' <span class="badge">locked</span>' : '') + (l.expires_at ? ' <span class="badge warn">expires ' + fmtDate(l.expires_at) + '</span>' : '') + (l.tool_name ? ' <span class="badge brand">' + esc(l.tool_name) + '</span>' : '');
      return { l: l, full: full, st: st, tags: tags };
    });
    var table = '<div class="tbl-wrap tbl-links"><table class="tbl"><thead><tr><th>Short link</th><th>Destination</th><th class="num">Clicks</th><th class="num">Valid</th><th>Status</th><th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td><a class="cell-link" href="' + esc(r.full) + '" target="_blank" rel="noopener">/' + esc(r.l.slug) + '</a><span class="sub-line">' + fmtDate(r.l.created_at) + r.tags + '</span></td>' +
          '<td><div class="truncate" title="' + esc(r.l.destination_url) + '">' + esc(r.l.destination_url) + '</div></td><td class="num">' + EU.num(r.l.clicks) + '</td><td class="num"><b>' + EU.num(r.l.valid_views) + '</b></td>' +
          '<td><span class="badge ' + r.st + '">' + r.st + '</span></td><td><div class="act" style="justify-content:flex-end"><button class="btn btn-secondary btn-sm" data-copy="' + esc(r.full) + '">Copy</button><button class="btn btn-ghost btn-sm" data-qr="' + esc(r.full) + '">QR</button>' +
          (r.l.status === 'active' ? '<button class="btn btn-ghost btn-sm" data-del="' + esc(r.l.slug) + '">Disable</button>' : '') + '</div></td></tr>';
      }).join('') + '</tbody></table></div>';
    var cards = rows.map(function (r) {
      return '<div class="link-card"><div class="top"><a class="cell-link" href="' + esc(r.full) + '" target="_blank" rel="noopener">/' + esc(r.l.slug) + '</a><span class="badge ' + r.st + '">' + r.st + '</span></div><div class="dest">' + esc(r.l.destination_url) + '</div>' +
        '<div class="meta"><span><b>' + EU.num(r.l.clicks) + '</b> clicks</span><span><b>' + EU.num(r.l.valid_views) + '</b> valid</span>' + r.tags + '</div>' +
        '<div class="act"><button class="btn btn-primary btn-sm" data-copy="' + esc(r.full) + '">Copy</button><button class="btn btn-secondary btn-sm" data-qr="' + esc(r.full) + '">QR</button><button class="btn btn-ghost btn-sm" data-edit="' + esc(r.l.slug) + '">Edit</button>' + (r.l.status === 'active' ? '<button class="btn btn-ghost btn-sm" data-del="' + esc(r.l.slug) + '">Disable</button>' : '') + '</div></div>';
    }).join('');
    return table + cards;
  }
  function bindLinkActions(box) {
    $$('[data-edit]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var slug = b.getAttribute('data-edit');
        var l = LINKS.filter(function (x) { return String(x.slug) === String(slug); })[0] || {};
        var opts = [{ value: '', label: 'No folder' }].concat(FOLDERS.map(function (f) { return { value: String(f.id), label: f.name }; }));
        EU.modal({
          title: 'Edit link', text: '/' + slug,
          fields: [
            { name: 'destination_url', label: 'Destination URL', value: l.destination_url || '' },
            { name: 'folder_id', label: 'Folder', type: 'select', options: opts, value: l.folder_id == null ? '' : String(l.folder_id) },
            { name: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'disabled', label: 'Disabled' }], value: l.status || 'active' }
          ],
          okText: 'Save changes'
        }).then(function (v) {
          if (!v) return;
          EU.api('/api/links/' + encodeURIComponent(slug), { method: 'PATCH', json: { destination_url: v.destination_url, folder_id: v.folder_id || null, status: v.status } })
            .then(function (r) {
              if (r.status === 200) { EU.toast('Link updated', 'ok'); loadLinks(); loadFolders(); }
              else EU.toast((r.data && r.data.error) || 'Could not update', 'err');
            });
        });
      });
    });
    $$('[data-copy]', box).forEach(function (b) { b.addEventListener('click', function () { EU.copy(b.getAttribute('data-copy'), b, 'Short link copied'); }); });
    $$('[data-qr]', box).forEach(function (b) { b.addEventListener('click', function () { openQR(b.getAttribute('data-qr')); }); });
    $$('[data-del]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var slug = b.getAttribute('data-del');
        EU.confirm('Disable this link?', 'The link /' + slug + ' will stop redirecting. This cannot be undone from the dashboard.', 'Disable link', true).then(function (ok) {
          if (!ok) return;
          EU.api('/api/links/' + encodeURIComponent(slug), { method: 'DELETE' }).then(function (r) { if (r.ok) { EU.toast('Link disabled', 'ok'); loadLinks(); } else EU.toast('Could not disable the link', 'err'); });
        });
      });
    });
    $$('[data-go]', box).forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-go')); }); });
  }
  function renderRecent() {
    var box = $('#recent');
    if (!LINKS.length) { box.innerHTML = emptyLinks(); bindLinkActions(box); return; }
    box.innerHTML = linkRows(LINKS.slice(0, 5)); bindLinkActions(box);
  }
  function renderAllLinks() {
    var box = $('#links-list'), q = ($('#l-search').value || '').toLowerCase().trim(), f = $('#l-filter').value, s = $('#l-sort').value;
    var list = LINKS.filter(function (l) { return (FOLD_FILTER == null || FOLD_FILTER === '' || String(l.folder_id) === String(FOLD_FILTER)) && (f === 'all' || l.status === f) && (!q || (l.slug + ' ' + l.destination_url + ' ' + (l.tool_name || '')).toLowerCase().indexOf(q) > -1); });
    list.sort(function (a, b) { return s === 'views' ? (b.valid_views || 0) - (a.valid_views || 0) : s === 'clicks' ? (b.clicks || 0) - (a.clicks || 0) : (b.created_at || 0) - (a.created_at || 0); });
    $('#links-sub').textContent = LINKS.length ? list.length + ' of ' + LINKS.length + ' links' : 'All the links you have created.';
    if (!LINKS.length) { box.innerHTML = emptyLinks(); }
    else if (!list.length) { box.innerHTML = '<div class="empty"><h4>No matching links</h4><p>Try a different search or filter.</p></div>'; }
    else box.innerHTML = linkRows(list);
    bindLinkActions(box);
  }
  function loadLinks() {
    return EU.api('/api/links').then(function (r) {
      if (r.status === 401) { location.href = '/login'; return; }
      if (!r.data.ok) { $('#links-list').innerHTML = '<div class="empty"><h4>Could not load your links</h4><p>Please refresh the page.</p></div>'; return; }
      LINKS = r.data.links || []; renderRecent(); renderAllLinks(); renderTodo();
    });
  }
  ['#l-search', '#l-filter', '#l-sort'].forEach(function (s) { $(s).addEventListener('input', renderAllLinks); });
  $('#links-csv').addEventListener('click', function () {
    if (!LINKS.length) { EU.toast('No links to export yet', 'info'); return; }
    var cols = ['slug', 'destination_url', 'clicks', 'valid_views', 'invalid_views', 'status', 'created_at'];
    var csv = [cols.join(',')].concat(LINKS.map(function (l) { return cols.map(function (c) { var v = l[c]; if (c === 'slug') v = linkUrl(l); if (c === 'created_at') v = v ? new Date(v * 1000).toISOString() : ''; return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); })).join('\n');
    var a = d.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'eliteurl-links.csv'; a.click();
  });

  /* ---------- chart ---------- */
  function loadChart() {
    EU.api('/api/stats/daily').then(function (r) {
      var box = $('#chart'), data = r.data;
      if (!data || !data.ok) { box.innerHTML = '<div class="chart-empty">No traffic data yet.</div>'; return; }
      var map = {}; (data.days || []).forEach(function (x) { map[x.day] = x; });
      var arr = [], max = 1;
      for (var i = 6; i >= 0; i--) {
        var dt = new Date(); dt.setDate(dt.getDate() - i);
        var key = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
        var row = map[key] || { clicks: 0, valid: 0 }; row.key = key; row.dt = dt; arr.push(row); if ((row.valid || 0) > max) max = row.valid;
      }
      var total = arr.reduce(function (s, x) { return s + (x.valid || 0); }, 0);
      $('#chart-total').textContent = EU.num(total) + ' views';
      if (!total) { box.innerHTML = '<div class="chart-empty"><div><b style="color:var(--ink);font-family:var(--font-d);font-size:17px">No traffic yet</b><br>Share a short link to see your views here.</div></div>'; return; }
      box.innerHTML = '<div class="chart">' + arr.map(function (x) {
        var v = x.valid || 0, h = v ? Math.max(6, Math.round(v / max * 100)) : 2;
        return '<div class="col"><div class="tip">' + x.dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' · ' + EU.num(v) + ' valid · ' + EU.num(x.clicks || 0) + ' clicks</div><div class="val">' + (v ? EU.num(v) : '') + '</div><div class="bar' + (v ? '' : ' zero') + '" style="height:0" data-h="' + h + '"></div><div class="lbl">' + x.dt.toLocaleDateString('en-IN', { weekday: 'short' }) + '</div></div>';
      }).join('') + '</div>';
      setTimeout(function () { $$('.bar', box).forEach(function (b) { b.style.height = 'calc(' + b.getAttribute('data-h') + '% - 44px)'; }); }, 40);
    }).catch(function () { $('#chart').innerHTML = '<div class="chart-empty">Could not load the chart.</div>'; });
  }

  /* ---------- rates ---------- */
  function loadRates() {
    EU.api('/api/rates').then(function (r) {
      var data = r.data, box = $('#rates-list'); if (!data || !data.ok) { box.innerHTML = '<li><span class="muted">Rates unavailable.</span></li>'; return; }
      var share = Number(data.creator_share); if (!(share > 0 && share <= 1)) share = 1;
      box.innerHTML = (data.rates || []).map(function (x) {
        var c = String(x.country_code || '').toUpperCase();
        return '<li><span><span class="cc">' + esc(c) + '</span>' + esc(NAMES[c] || c) + '</span><span class="v">$' + (Number(x.cpm_usd || 0) * share).toFixed(2) + ' <small>/ 1k</small></span></li>';
      }).join('') || '<li><span class="muted">Rate card not set yet.</span></li>';
      if (data.min_withdrawal_usd != null) $('#r-min').textContent = '$' + Number(data.min_withdrawal_usd).toFixed(0);
      if (data.payout_hours != null) $('#r-hrs').textContent = Number(data.payout_hours) + 'h';
    });
  }

  /* ---------- referrals ---------- */
  function loadRefs() {
    EU.api('/api/referrals').then(function (r) {
      var data = r.data; if (!data || !data.ok) return;
      var link = origin() + '/register?ref=' + (data.code || ''), pct = Math.round(Number(data.commission || 0.1) * 100) + '%';
      ['', '2'].forEach(function (s) { var l = $('#ref-link' + s); if (l) l.value = link; });
      $('#ref-count').textContent = data.count || 0; $('#ref-count2').textContent = data.count || 0;
      var earned = '$' + Number(data.earned_usd || 0).toFixed(2); $('#ref-earned').textContent = earned; $('#ref-earned2').textContent = earned;
      $('#ref-reward').textContent = pct; $('#ref-reward2').textContent = pct;
    });
  }
  $('#ref-copy').addEventListener('click', function () { EU.copy($('#ref-link').value, this, 'Referral link copied'); });
  $('#ref-copy2').addEventListener('click', function () { EU.copy($('#ref-link2').value, this, 'Referral link copied'); });

  /* ---------- create link ---------- */
  function addUtm(url) {
    if (!$('#useUtm').checked) return url;
    try {
      var u = new URL(url);
      ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) { var v = $('#' + k).value.trim(); if (v) u.searchParams.set(k, v); });
      return u.href;
    } catch (e) { return url; }
  }
  function normaliseUrl(u) { u = (u || '').trim(); if (u && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u; return u; }
  var lastShort = '';
  function showResult(boxId, linkId, url) { var o = $(boxId), s = $(linkId); s.textContent = url.replace(/^https?:\/\//, ''); s.href = url; o.classList.add('show'); lastShort = url; }

  $('#quick-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var u = $('#q-url'), a = $('#q-alias'), m = $('#q-msg'), b = $('#q-btn'); m.className = 'alert';
    if (!u.value.trim()) { showMsg(m, 'Paste a link first.', false); u.focus(); return; }
    setBusy(b, true, 'Creating…');
    EU.api('/api/links', { json: { url: normaliseUrl(u.value), alias: a.value.trim() } }).then(function (r) {
      setBusy(b, false, 'Shorten');
      if (r.status === 200) { showResult('#q-res', '#q-short', r.data.short); u.value = ''; a.value = ''; loadLinks(); loadMe(); EU.toast('Short link created', 'ok'); }
      else showMsg(m, r.data.error || 'Could not create the link.', false);
    }).catch(function () { setBusy(b, false, 'Shorten'); showMsg(m, 'Network error.', false); });
  });
  $('#q-copy').addEventListener('click', function () { EU.copy(lastShort, this, 'Short link copied'); });
  $('#q-qr').addEventListener('click', function () { openQR(lastShort); });

  [['useUtm', 'utmRow'], ['useExp', 'expRow'], ['usePw', 'pwRow'], ['useAdv', 'advRow']].forEach(function (p) {
    $('#' + p[0]).addEventListener('change', function () { $('#' + p[1]).classList.toggle('hide', !this.checked); });
  });
  $('#create-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var m = $('#msg'), b = $('#create'); m.className = 'alert';
    var raw = normaliseUrl($('#url').value);
    if (!raw) { showMsg(m, 'Paste a link first.', false); return; }
    if ($('#usePw').checked && $('#linkpw').value.length < 4) { showMsg(m, 'The link password needs at least 4 characters.', false); return; }
    var body = {
      url: addUtm(raw), alias: $('#alias').value.trim(),
      expires_in_days: $('#useExp').checked ? $('#expdays').value : '',
      password: $('#usePw').checked ? $('#linkpw').value : '', pw_hint: $('#usePw').checked ? $('#pwhint').value : '',
      advanced: $('#useAdv').checked, creator_name: $('#creator').value, tool_name: $('#toolname').value, video_url: $('#videourl').value,
      folder_id: (($('#folder-sel') || {}).value || null)
    };
    setBusy(b, true, 'Creating…');
    EU.api('/api/links', { json: body }).then(function (r) {
      setBusy(b, false, 'Create short link');
      if (r.status === 200) {
        showResult('#out', '#short', r.data.short); EU.toast('Short link created', 'ok');
        ['url', 'alias', 'expdays', 'linkpw', 'pwhint', 'creator', 'toolname', 'videourl', 'utm_source', 'utm_medium', 'utm_campaign'].forEach(function (id) { $('#' + id).value = ''; });
        ['useUtm', 'useExp', 'usePw', 'useAdv'].forEach(function (id) { $('#' + id).checked = false; });
        ['utmRow', 'expRow', 'pwRow', 'advRow'].forEach(function (id) { $('#' + id).classList.add('hide'); });
        loadLinks(); loadMe();
      } else showMsg(m, r.data.error || 'Could not create the link.', false);
    }).catch(function () { setBusy(b, false, 'Create short link'); showMsg(m, 'Network error.', false); });
  });
  $('#out-copy').addEventListener('click', function () { EU.copy(lastShort, this, 'Short link copied'); });
  $('#out-qr').addEventListener('click', function () { openQR(lastShort); });

  /* bulk */
  $$('#create-mode button').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('#create-mode button').forEach(function (x) { x.classList.toggle('on', x === b); });
      var bulk = b.getAttribute('data-mode') === 'bulk'; $('#mode-single').classList.toggle('hide', bulk); $('#mode-bulk').classList.toggle('hide', !bulk);
    });
  });
  var bulkResults = [];
  $('#bulk-go').addEventListener('click', function () {
    var m = $('#bulk-msg'), b = this; m.className = 'alert';
    var urls = $('#bulk-urls').value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!urls.length) { showMsg(m, 'Paste at least one link.', false); return; }
    if (urls.length > 20) { showMsg(m, 'Please paste at most 20 links at a time.', false); return; }
    setBusy(b, true, 'Shortening…'); bulkResults = [];
    var i = 0, fail = 0;
    (function next() {
      if (i >= urls.length) {
        setBusy(b, false, 'Shorten all'); $('#bulk-out').classList.remove('hide');
        $('#bulk-rows').innerHTML = bulkResults.map(function (x) { return '<tr><td><div class="truncate" title="' + esc(x.url) + '">' + esc(x.url) + '</div></td><td>' + (x.short ? '<a class="cell-link" href="' + esc(x.short) + '" target="_blank" rel="noopener">' + esc(x.short.replace(/^https?:\/\//, '')) + '</a>' : '<span class="badge err">' + esc(x.error) + '</span>') + '</td><td>' + (x.short ? '<button class="btn btn-ghost btn-sm" data-c="' + esc(x.short) + '">Copy</button>' : '') + '</td></tr>'; }).join('');
        $$('#bulk-rows [data-c]').forEach(function (c) { c.addEventListener('click', function () { EU.copy(c.getAttribute('data-c'), c); }); });
        showMsg(m, (urls.length - fail) + ' of ' + urls.length + ' links created.', fail === 0); loadLinks(); loadMe(); return;
      }
      var u = normaliseUrl(urls[i++]);
      EU.api('/api/links', { json: { url: u } }).then(function (r) {
        if (r.status === 200) bulkResults.push({ url: u, short: r.data.short }); else { fail++; bulkResults.push({ url: u, error: r.data.error || 'Failed' }); }
        next();
      }).catch(function () { fail++; bulkResults.push({ url: u, error: 'Network error' }); next(); });
    })();
  });
  $('#bulk-copy').addEventListener('click', function () { var t = bulkResults.filter(function (x) { return x.short; }).map(function (x) { return x.short; }).join('\n'); if (t) EU.copy(t, this, 'All short links copied'); });
  $('#bulk-csv').addEventListener('click', function () {
    var csv = 'original,short\n' + bulkResults.map(function (x) { return '"' + x.url.replace(/"/g, '""') + '","' + (x.short || x.error || '') + '"'; }).join('\n');
    var a = d.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'eliteurl-bulk.csv'; a.click();
  });

  /* ---------- withdrawals ---------- */
  $('#w-method').addEventListener('change', function () {
    var v = this.value, bank = v === 'bank';
    $('#lbl-account').textContent = bank ? 'Account number' : (v === 'paypal' ? 'PayPal email' : 'UPI ID');
    $('#w-account').placeholder = bank ? 'Your bank account number' : (v === 'paypal' ? 'you@example.com' : 'yourname@upi');
    $('#f-ifsc').classList.toggle('hide', !bank); $('#f-holder').classList.toggle('hide', !bank);
  });
  function loadWithdrawals() {
    var box = $('#wd-list');
    return EU.api('/api/withdrawals').then(function (r) {
      var data = r.data;
      if (!data || !data.ok) { box.innerHTML = '<div class="empty"><p>No withdrawal requests yet.</p></div>'; return; }
      WD = data;
      $('#w-hint').textContent = 'Available: ' + money(data.available_usd) + " · Minimum " + money(data.min_withdrawal_usd, 2) + ' · Paid within ' + (ME ? ME.payout_hours : 12) + ' hours.';
      $('#e-avail').textContent = money(data.available_usd);
      var pending = (data.withdrawals || []).some(function (x) { return x.status === 'pending'; });
      $('#w-pending-note').classList.toggle('show', pending); $('#w-submit').disabled = pending; $('#w-amount').disabled = pending;
      if (!data.withdrawals || !data.withdrawals.length) { box.innerHTML = '<div class="empty"><div class="em-ico"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/></svg></div><h4>No withdrawals yet</h4><p>Your payout requests will appear here with their status and reference.</p></div>'; renderTodo(); return; }
      box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Amount</th><th>Method</th><th>Status</th><th>Reference</th><th>Requested</th></tr></thead><tbody>' + data.withdrawals.map(function (w) {
        return '<tr><td><b>' + money(w.amount_usd, 2) + '</b></td><td>' + esc(String(w.method || '').toUpperCase()) + ' <span class="muted">••••' + esc(w.payee_last4 || '') + '</span></td><td><span class="badge ' + esc(w.status) + '">' + esc(w.status) + '</span></td><td class="mono" style="font-size:13px">' + esc(w.txn_ref || '—') + '</td><td class="muted">' + fmtDate(w.requested_at) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
      renderTodo();
    }).catch(function () { box.innerHTML = '<div class="empty"><p>Could not load withdrawals.</p></div>'; });
  }
  var wBusy = false;
  $('#w-submit').addEventListener('click', function () {
    var b = this, m = $('#w-msg'); if (wBusy) return; m.className = 'alert';
    var body = { amount: $('#w-amount').value, method: $('#w-method').value, account: $('#w-account').value.trim(), ifsc: $('#w-ifsc').value.trim(), holder: $('#w-holder').value.trim() };
    if (!body.amount || !body.account) { showMsg(m, 'Enter the amount and your payout details.', false); return; }
    wBusy = true; setBusy(b, true, 'Submitting…');
    EU.api('/api/withdrawals', { json: body }).then(function (r) {
      wBusy = false; setBusy(b, false, 'Submit request');
      if (r.status === 200) { showMsg(m, r.data.message || 'Request submitted.', true); $('#w-amount').value = ''; EU.toast('Withdrawal requested', 'ok'); loadWithdrawals(); loadMe(); }
      else showMsg(m, r.data.error || 'Could not submit.', false);
    }).catch(function () { wBusy = false; setBusy(b, false, 'Submit request'); showMsg(m, 'Network error.', false); });
  });

  /* ---------- account ---------- */
  function logout() { EU.api('/api/auth/logout', { method: 'POST' }).then(function () { location.href = '/'; }); }
  $('#logout').addEventListener('click', logout); $('#logout2').addEventListener('click', logout);
  $('#save-name').addEventListener('click', function () {
    var b = this, m = $('#n-msg'); m.className = 'alert'; setBusy(b, true, 'Saving…');
    EU.api('/api/account/profile', { json: { name: $('#a-name').value.trim() } }).then(function (r) {
      setBusy(b, false, 'Save changes');
      if (r.status === 200) { showMsg(m, 'Profile updated.', true); $('#who-name').textContent = r.data.name; $('#hello').textContent = 'Welcome back, ' + String(r.data.name).split(' ')[0]; $('#avatar').textContent = String(r.data.name).charAt(0).toUpperCase(); }
      else showMsg(m, r.data.error || 'Could not save.', false);
    }).catch(function () { setBusy(b, false, 'Save changes'); showMsg(m, 'Network error.', false); });
  });
  $('#save-pass').addEventListener('click', function () {
    var b = this, m = $('#p-msg'); m.className = 'alert'; setBusy(b, true, 'Updating…');
    EU.api('/api/account/password', { json: { current: $('#p-cur').value, password: $('#p-new').value } }).then(function (r) {
      setBusy(b, false, 'Update password');
      if (r.status === 200) { showMsg(m, 'Password updated.', true); $('#p-cur').value = ''; $('#p-new').value = ''; } else showMsg(m, r.data.error || 'Could not update.', false);
    }).catch(function () { setBusy(b, false, 'Update password'); showMsg(m, 'Network error.', false); });
  });

  /* ---------- boot ---------- */
  loadMe().then(function () { return Promise.all([loadLinks(), loadWithdrawals()]); }).then(renderTodo);
  loadChart(); loadRates(); loadRefs(); loadFolders(); loadAudience(); loadLeaderboard();
  go((location.hash || '#overview').slice(1));
  window.addEventListener('hashchange', function () { go((location.hash || '#overview').slice(1)); });
  // link typed on the home page before sign-up
  try { var pend = sessionStorage.getItem('eu-pending-url'); if (pend) { sessionStorage.removeItem('eu-pending-url'); $('#url').value = pend; go('create'); EU.toast('We saved your link — create it below', 'info'); } } catch (e) {}


  /* ---- folders ---- */
  function loadFolders() {
    EU.api('/api/folders').then(function (r) {
      if (r.status !== 200 || !r.data || !r.data.ok) return;
      FOLDERS = r.data.folders || [];
      var sel = $('#folder-sel');
      if (sel) {
        var cur = sel.value;
        sel.innerHTML = '<option value="">No folder</option>' + FOLDERS.map(function (f) {
          return '<option value="' + f.id + '">' + esc(f.name) + '</option>';
        }).join('');
        sel.value = cur;
      }
      var box = $('#folder-chips');
      if (box) {
        var total = FOLDERS.reduce(function (s, f) { return s + Number(f.link_count || 0); }, 0);
        box.innerHTML = '<button class="btn ' + (FOLD_FILTER === '' ? 'btn-primary' : 'btn-secondary') + ' btn-sm" data-f="">All (' + total + ')</button>'
          + FOLDERS.map(function (f) {
            return '<button class="btn ' + (String(FOLD_FILTER) === String(f.id) ? 'btn-primary' : 'btn-secondary') + ' btn-sm" data-f="' + f.id + '">' + esc(f.name) + ' (' + Number(f.link_count || 0) + ')</button>';
          }).join('');
        $$('[data-f]', box).forEach(function (b) {
          b.addEventListener('click', function () {
            FOLD_FILTER = b.getAttribute('data-f');
            renderAllLinks();
            loadFolders();
          });
        });
      }
    }).catch(function () {});
  }

  (function () {
    var nb = $('#new-folder');
    if (nb) nb.addEventListener('click', function () {
      EU.modal({ title: 'New folder', text: 'Group your links by topic.', fields: [{ name: 'name', label: 'Folder name', placeholder: 'e.g. Exam Notes' }], okText: 'Create folder' })
        .then(function (v) {
          if (!v || !v.name || !v.name.trim()) return;
          EU.api('/api/folders', { json: { name: v.name.trim() } }).then(function (r) {
            if (r.status === 200) { EU.toast('Folder created', 'ok'); loadFolders(); }
            else EU.toast((r.data && r.data.error) || 'Could not create folder', 'err');
          });
        });
    });
  })();

  /* ---- audience ---- */
  function loadAudience() {
    EU.api('/api/analytics/countries').then(function (r) {
      var box = $('#aud-box'); if (!box) return;
      if (r.status !== 200 || !r.data || !r.data.ok) { box.innerHTML = '<p class="muted" style="font-size:13px">No traffic yet.</p>'; return; }
      var cs = (r.data.countries || []).slice(0, 5);
      var total = cs.reduce(function (s, c) { return s + Number(c.v || 0); }, 0) || 1;
      if (!cs.length) { box.innerHTML = '<p class="muted" style="font-size:13px">No traffic yet.</p>'; return; }
      box.innerHTML = cs.map(function (c) {
        var pct = Math.round(Number(c.v || 0) / total * 100);
        return '<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:5px"><span>' + esc(NAMES[c.c] || c.c) + '</span><span>' + pct + '% · ' + EU.num(c.v) + '</span></div>'
          + '<div style="height:7px;border-radius:6px;background:#eef0f7;overflow:hidden"><i style="display:block;height:100%;width:' + pct + '%;background:linear-gradient(90deg,#4f46e5,#7c5cff);border-radius:6px"></i></div></div>';
      }).join('');
    }).catch(function () {});
  }

  /* ---- leaderboard ---- */
  function loadLeaderboard() {
    EU.api('/api/leaderboard').then(function (r) {
      var box = $('#lb-box'); if (!box) return;
      if (r.status !== 200 || !r.data || !r.data.ok || !(r.data.leaders || []).length) { box.innerHTML = '<p class="muted" style="font-size:13px">No data yet.</p>'; return; }
      box.innerHTML = r.data.leaders.slice(0, 5).map(function (x) {
        var medal = x.rank === 1 ? '🥇' : x.rank === 2 ? '🥈' : x.rank === 3 ? '🥉' : '#' + x.rank;
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #eef0f7;font-size:13.5px">'
          + '<span style="font-weight:700">' + medal + ' ' + esc(x.name) + '</span>'
          + '<span style="font-weight:800;color:#12a150">$' + esc(x.amount) + '</span></div>';
      }).join('');
    }).catch(function () {});
  }

  /* ---- public page (bio) + custom domain ---- */
  (function () {
    var uEl = $('#a-user'), urlEl = $('#a-user-url'), dEl = $('#a-domain');
    var mEl = $('#u-msg'), saveB = $('#save-profile2'), verB = $('#verify-domain'), openB = $('#open-bio');
    if (!uEl) return;
    function showM(t, ok) { if (!mEl) return; showMsg(mEl, t, ok); }
    function paint() {
      var u = (uEl.value || '').trim().toLowerCase();
      if (urlEl) urlEl.value = u ? (location.origin + '/u/' + u) : '';
      if (openB) openB.href = u ? ('/u/' + u) : '#';
    }
    uEl.addEventListener('input', paint);
    EU.api('/api/account').then(function (r) {
      if (r.status !== 200 || !r.data) return;
      if (r.data.username) uEl.value = r.data.username;
      if (dEl && r.data.custom_domain) dEl.value = r.data.custom_domain;
      paint();
    }).catch(function () {});
    if (saveB) saveB.addEventListener('click', function () {
      var u = (uEl.value || '').trim().toLowerCase();
      if (u && !/^[a-z0-9][a-z0-9_-]{2,23}$/.test(u)) { showM('Username: 3-24 characters, letters, numbers, - or _ only.'); return; }
      setBusy(saveB, true, 'Saving…');
      EU.api('/api/account', { method: 'PATCH', json: { username: u, custom_domain: (dEl ? dEl.value.trim() : '') } })
        .then(function (r) {
          setBusy(saveB, false, 'Save');
          if (r.status === 200) { showM('Saved. Your page is live.', true); paint(); }
          else showM((r.data && r.data.error) || 'Could not save.');
        }).catch(function () { setBusy(saveB, false, 'Save'); showM('Network error.'); });
    });
    if (verB) verB.addEventListener('click', function () {
      setBusy(verB, true, 'Checking…');
      EU.api('/api/account/verify-domain', { method: 'POST', json: {} }).then(function (r) {
        setBusy(verB, false, 'Verify domain');
        if (r.status === 200 && r.data && r.data.verified) showM('Domain verified.', true);
        else showM((r.data && r.data.error) || 'Point a CNAME to eliteofficial.in first, then verify.');
      }).catch(function () { setBusy(verB, false, 'Verify domain'); showM('Network error.'); });
    });
  })();

})();
