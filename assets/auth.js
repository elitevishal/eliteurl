/* EliteURL auth pages: login, register, forgot (3-step), reset */
(function () {
  'use strict';
  var EU = window.EU, d = document;
  function $(s) { return d.querySelector(s); }
  var msg = $('#msg');
  function show(t, ok) { if (!msg) return; msg.textContent = t; msg.className = 'alert show ' + (ok ? 'ok' : 'err'); }
  function hideMsg() { if (msg) msg.className = 'alert'; }
  function busy(b, on, label) { if (!b) return; if (on) { b.setAttribute('data-l', b.textContent); b.disabled = true; b.innerHTML = '<span class="spin"></span> ' + label; } else { b.disabled = false; b.textContent = b.getAttribute('data-l') || label; } }

  /* show / hide password */
  EU.$$('[data-toggle]').forEach(function (t) {
    t.addEventListener('click', function () {
      var i = d.getElementById(t.getAttribute('data-toggle'));
      var hidden = i.type === 'password'; i.type = hidden ? 'text' : 'password';
      t.textContent = hidden ? 'Hide' : 'Show'; t.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
    });
  });

  /* password strength meter */
  var bar = $('#pw-bar'), pw = $('#password');
  function score(v) {
    var s = 0; if (v.length >= 8) s++; if (v.length >= 12) s++; if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++;
    return Math.min(4, s);
  }
  if (bar && pw) pw.addEventListener('input', function () {
    var v = pw.value, s = v ? Math.max(1, score(v)) : 0;
    bar.style.width = (s * 25) + '%'; bar.style.background = ['', '#ef4444', '#f59e0b', '#10b981', '#059669'][s] || '';
    var h = $('#pw-hint'); if (h) h.textContent = !v ? 'Use at least 8 characters. A mix of letters and numbers is stronger.' : (v.length < 8 ? 'Too short — use at least 8 characters.' : ['', 'Weak password', 'Okay password', 'Good password', 'Strong password'][s]);
  });

  /* ---- login ---- */
  var lf = $('#login-form');
  if (lf) lf.addEventListener('submit', function (e) {
    e.preventDefault(); hideMsg();
    var em = $('#email').value.trim(), p = $('#password').value, b = $('#btn');
    if (!em || !p) { show('Please enter your email and password.'); return; }
    busy(b, true, 'Signing in…');
    EU.api('/api/auth/login', { json: { email: em, password: p } }).then(function (r) {
      if (r.status === 200) { show('Signed in. Redirecting…', true); location.href = r.data.role === 'admin' ? '/admin' : '/dashboard'; }
      else { busy(b, false, 'Sign in'); show(r.data.error || 'Something went wrong. Please try again.'); }
    }).catch(function () { busy(b, false, 'Sign in'); show('Network error. Check your connection.'); });
  });

  /* ---- register ---- */
  var rf = $('#register-form');
  if (rf) {
    var qs = new URLSearchParams(location.search);
    try { if (qs.get('from') === 'home' && sessionStorage.getItem('eu-pending-url')) { var n = $('#pending-note'); if (n) n.className = 'alert info static'; } } catch (x) {}
    /* referral code: ?ref= se auto-fill, read-only */
    (function () {
      var rc = (qs.get('ref') || '').trim().toUpperCase();
      var box = $('#ref-field'), inp = $('#ref'), hint = $('#ref-hint');
      if (!box || !inp) return;
      if (rc) {
        inp.value = rc; box.style.display = '';
        inp.readOnly = true; inp.setAttribute('readonly', 'readonly');
        inp.addEventListener('input', function () { inp.value = rc; });
        inp.addEventListener('keydown', function (e) { e.preventDefault(); });
        if (hint) hint.textContent = 'Referred by ' + rc + ' — you both benefit.';
      }
    })();
    rf.addEventListener('submit', function (e) {
      e.preventDefault(); hideMsg();
      var n = $('#name').value.trim(), em = $('#email').value.trim(), p = $('#password').value, b = $('#btn');
      if (n.length < 2) { show('Please enter your name.'); $('#name').focus(); return; }
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(em)) { show('Please enter a valid email address.'); $('#email').focus(); return; }
      if (p.length < 8) { show('Password must be at least 8 characters.'); $('#password').focus(); return; }
      busy(b, true, 'Creating account…');
      EU.api('/api/auth/register', { json: { name: n, email: em, password: p, ref: qs.get('ref') || '' } }).then(function (r) {
        if (r.status === 200) { show('Account created. Redirecting…', true); location.href = r.data.role === 'admin' ? '/admin' : '/dashboard'; }
        else { busy(b, false, 'Create account'); show(r.data.error || 'Something went wrong. Please try again.'); }
      }).catch(function () { busy(b, false, 'Create account'); show('Network error. Check your connection.'); });
    });
  }

  /* ---- reset (token link) ---- */
  var sf = $('#reset-form');
  if (sf) {
    var token = new URLSearchParams(location.search).get('token') || '';
    if (!token) show('This link is missing its token. Please request a new one.');
    sf.addEventListener('submit', function (e) {
      e.preventDefault(); hideMsg();
      var p = $('#password').value, b = $('#btn');
      if (p.length < 8) { show('Password must be at least 8 characters.'); return; }
      busy(b, true, 'Saving…');
      EU.api('/api/auth/reset', { json: { token: token, password: p } }).then(function (r) {
        busy(b, false, 'Save password');
        if (r.status === 200) { show('Password updated. Redirecting to sign in…', true); setTimeout(function () { location.href = '/login'; }, 1200); }
        else show(r.data.error || 'Could not reset the password.');
      }).catch(function () { busy(b, false, 'Save password'); show('Network error.'); });
    });
  }

  /* ---- forgot (3 steps) ---- */
  var f1 = $('#f1');
  if (f1) {
    var emailVal = '', resetToken = '', cool = 0, coolT = null;
    function stepTo(n) {
      [1, 2, 3].forEach(function (i) { $('#step' + i).classList.toggle('hide', i !== n); $('#si' + i).classList.toggle('on', i <= n); });
      var first = n === 2 ? $('#code') : n === 3 ? $('#password') : $('#email'); if (first) first.focus();
    }
    function startCooldown() {
      var rb = $('#resend'); cool = 30; rb.disabled = true;
      clearInterval(coolT);
      coolT = setInterval(function () { cool--; if (cool <= 0) { clearInterval(coolT); rb.disabled = false; rb.textContent = 'Send a new code'; } else rb.textContent = 'Send a new code in ' + cool + 's'; }, 1000);
      rb.textContent = 'Send a new code in ' + cool + 's';
    }
    f1.addEventListener('submit', function (e) {
      e.preventDefault(); hideMsg();
      emailVal = $('#email').value.trim();
      if (!emailVal) { show('Enter your email address.'); return; }
      var b = $('#b1'); busy(b, true, 'Sending…');
      EU.api('/api/auth/forgot', { json: { email: emailVal } }).then(function (r) {
        busy(b, false, 'Send code');
        if (r.status === 200) { $('#sentto').textContent = emailVal; stepTo(2); startCooldown(); show(r.data.message || 'Code sent. Check your inbox and spam folder.', true); }
        else show(r.data.error || 'Could not send the code.');
      }).catch(function () { busy(b, false, 'Send code'); show('Network error.'); });
    });
    $('#code').addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 6); });
    $('#f2').addEventListener('submit', function (e) {
      e.preventDefault(); hideMsg();
      var code = $('#code').value.replace(/\D/g, '');
      if (code.length !== 6) { show('Enter the 6-digit code.'); return; }
      var b = $('#b2'); busy(b, true, 'Checking…');
      EU.api('/api/auth/verify-otp', { json: { email: emailVal, code: code } }).then(function (r) {
        busy(b, false, 'Verify code');
        if (r.status === 200 && r.data.reset_token) { resetToken = r.data.reset_token; hideMsg(); stepTo(3); }
        else show(r.data.error || 'That code is wrong.');
      }).catch(function () { busy(b, false, 'Verify code'); show('Network error.'); });
    });
    $('#f3').addEventListener('submit', function (e) {
      e.preventDefault(); hideMsg();
      var p = $('#password').value;
      if (p.length < 8) { show('Password must be at least 8 characters.'); return; }
      var b = $('#b3'); busy(b, true, 'Saving…');
      EU.api('/api/auth/reset', { json: { token: resetToken, password: p } }).then(function (r) {
        busy(b, false, 'Reset password');
        if (r.status === 200) { show('Password updated. Redirecting…', true); setTimeout(function () { location.href = '/login'; }, 1200); }
        else show(r.data.error || 'Could not reset the password.');
      }).catch(function () { busy(b, false, 'Reset password'); show('Network error.'); });
    });
    $('#resend').addEventListener('click', function () {
      if (cool > 0) return;
      EU.api('/api/auth/forgot', { json: { email: emailVal } }).then(function (r) { show(r.data.message || r.data.error || 'A new code has been sent.', r.status === 200); if (r.status === 200) startCooldown(); });
    });
  }
})();
