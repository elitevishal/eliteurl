/* EliteURL home page behaviour */
(function () {
  'use strict';
  var EU = window.EU, $ = function (s) { return document.querySelector(s); };
  var NAMES = { US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia', IN: 'India', PK: 'Pakistan', BD: 'Bangladesh', AE: 'UAE', SA: 'Saudi Arabia', DE: 'Germany', FR: 'France', NL: 'Netherlands', SG: 'Singapore', MY: 'Malaysia', ID: 'Indonesia', PH: 'Philippines', NG: 'Nigeria', KE: 'Kenya', ZA: 'South Africa', BR: 'Brazil', MX: 'Mexico', ES: 'Spain', IT: 'Italy', LK: 'Sri Lanka', NP: 'Nepal', EG: 'Egypt', TR: 'Turkey', ALL: 'Other countries' };

  /* ---------- hero shorten box ---------- */
  var form = $('#hero-form'), inp = $('#hero-url'), btn = $('#hero-btn'), err = $('#hero-err'), res = $('#hero-res'), short = $('#hero-short');
  function showErr(m) { err.textContent = m; err.classList.add('show'); res.classList.remove('show'); }
  function normalise(u) {
    u = (u || '').trim();
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u;
    try { var x = new URL(u); if (!/^https?:$/.test(x.protocol) || x.hostname.indexOf('.') < 1) return ''; return x.href; } catch (e) { return ''; }
  }
  if (form) form.addEventListener('submit', function (e) {
    e.preventDefault(); err.classList.remove('show');
    var url = normalise(inp.value);
    if (!url) { showErr('Please paste a valid link, for example https://example.com/page'); inp.focus(); return; }
    // link yahin nahi banti — pehle account, phir short link
    try { sessionStorage.setItem('eu-pending-url', url); } catch (x) {}
    btn.disabled = true; var old = btn.textContent; btn.innerHTML = '<span class="spin"></span> Saving your link…';
    EU.api('/api/me').then(function (m) {
      btn.disabled = false; btn.textContent = old;
      if (m.ok && m.data && m.data.ok) {
        // already signed in -> dashboard create page par le jao
        location.href = '/dashboard#create';
        return;
      }
      res.classList.add('show');
      var go = $('#hero-go');
      if (go) go.href = '/register?from=home';
    }).catch(function () {
      btn.disabled = false; btn.textContent = old;
      res.classList.add('show');
    });
  });

  /* ---------- live rates + calculator ---------- */
  var list = $('#rate-list'), sel = $('#c-country'), views = $('#c-views'), out = $('#c-out'), day = $('#c-day'), vn = $('#c-views-n');
  function calc() {
    var v = Number(views.value || 0), r = Number(sel.value || 0), perDay = v / 1000 * r, perMonth = perDay * 30;
    vn.textContent = EU.num(v); day.textContent = '≈ $' + perDay.toFixed(2) + ' per day'; out.textContent = '$' + perMonth.toFixed(2);
  }
  fetch('/api/rates').then(function (r) { return r.json(); }).then(function (d) {
    if (!d || !d.ok) throw 0;
    var share = Number(d.creator_share); if (!(share > 0 && share <= 1)) share = 1;
    var rows = (d.rates || []).map(function (x) { return { c: String(x.country_code || '').toUpperCase(), v: Number(x.cpm_usd || 0) * share }; }).sort(function (a, b) { return b.v - a.v; });
    if (!rows.length) { list.innerHTML = '<li><span class="muted">The rate card has not been published yet.</span></li>'; sel.innerHTML = '<option value="1.5">Other countries</option>'; calc(); }
    else {
      list.innerHTML = rows.slice(0, 7).map(function (x) {
        return '<li><span><span class="cc">' + EU.esc(x.c) + '</span>' + EU.esc(NAMES[x.c] || x.c) + '</span><span class="v">$' + x.v.toFixed(2) + ' <small>/ 1k views</small></span></li>';
      }).join('');
      sel.innerHTML = rows.map(function (x) { return '<option value="' + x.v + '">' + EU.esc(NAMES[x.c] || x.c) + ' — $' + x.v.toFixed(2) + ' per 1k</option>'; }).join('');
      var inIdx = rows.findIndex(function (x) { return x.c === 'IN'; }); if (inIdx > -1) sel.selectedIndex = inIdx;
      calc();
    }
    var mn = document.querySelector('[data-k="min"]'), hr = document.querySelector('[data-k="hrs"]');
    if (mn && d.min_withdrawal_usd != null) mn.textContent = '$' + Number(d.min_withdrawal_usd).toFixed(0);
    if (hr && d.payout_hours != null) hr.textContent = Number(d.payout_hours) + 'h';
  }).catch(function () {
    list.innerHTML = '<li><span class="muted">Live rates are unavailable right now.</span><a href="/rates">Open rate card</a></li>';
    sel.innerHTML = '<option value="1.5">Estimate (1.50 per 1k)</option>'; calc();
  });
  if (views) { views.addEventListener('input', calc); sel.addEventListener('change', calc); }
})();
