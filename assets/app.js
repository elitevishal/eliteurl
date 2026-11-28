/* EliteURL shared UI helpers · v3 */
(function () {
  'use strict';
  var d = document, root = d.documentElement;
  root.classList.remove('no-js');

  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n, dp) { return '$' + Number(n || 0).toFixed(dp == null ? 4 : dp); }
  function num(n) { return Number(n || 0).toLocaleString('en-IN'); }
  function $(s, c) { return (c || d).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || d).querySelectorAll(s)); }

  /* ---- theme ---- */
  function applyTheme(t) { if (t) root.setAttribute('data-theme', t); else root.removeAttribute('data-theme'); }
  function currentTheme() {
    var t = root.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  $$('.theme-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var n = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(n); store('eu-theme', n);
    });
  });

  /* ---- header scroll + mobile menu ---- */
  var hdr = $('.site-header');
  if (hdr) {
    var onScroll = function () { hdr.classList.toggle('scrolled', window.scrollY > 8); };
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
  }
  var burger = $('.burger'), mm = $('.mobile-menu');
  if (burger && mm) {
    burger.addEventListener('click', function () {
      var o = mm.classList.toggle('open');
      burger.setAttribute('aria-expanded', o ? 'true' : 'false');
      d.body.style.overflow = o ? 'hidden' : '';
    });
    $$('a', mm).forEach(function (a) { a.addEventListener('click', function () { mm.classList.remove('open'); d.body.style.overflow = ''; }); });
  }

  /* ---- reveal on scroll ---- */
  var rv = $$('.reveal');
  if (rv.length) {
    if (!('IntersectionObserver' in window)) rv.forEach(function (e) { e.classList.add('in'); });
    else {
      var io = new IntersectionObserver(function (en) {
        en.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
      rv.forEach(function (e) { io.observe(e); });
    }
  }

  /* ---- toast ---- */
  var toastBox;
  var ICON = {
    ok: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    err: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/></svg>'
  };
  function toast(msg, type) {
    if (!toastBox) { toastBox = d.createElement('div'); toastBox.className = 'toasts'; toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite'); d.body.appendChild(toastBox); }
    var t = d.createElement('div'); t.className = 'toast ' + (type || 'info');
    t.innerHTML = (ICON[type] || ICON.info) + '<span>' + esc(msg) + '</span>';
    toastBox.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 260); }, 3200);
  }

  /* ---- clipboard ---- */
  function copy(text, btn, okMsg) {
    function done() {
      toast(okMsg || 'Copied to clipboard', 'ok');
      if (btn) { var o = btn.getAttribute('data-label') || btn.textContent; btn.setAttribute('data-label', o); btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = o; }, 1300); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() {
      var ta = d.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; d.body.appendChild(ta); ta.select();
      try { d.execCommand('copy'); done(); } catch (e) { toast('Could not copy', 'err'); }
      ta.remove();
    }
  }

  /* ---- modal ---- */
  function modal(o) {
    return new Promise(function (resolve) {
      var back = d.createElement('div'); back.className = 'modal-back';
      var fields = (o.fields || []).map(function (f, i) {
        var id = 'mf' + i;
        var ctl = f.type === 'select'
          ? '<select class="select" id="' + id + '">' + f.options.map(function (op) { return '<option value="' + esc(op.value) + '"' + (String(op.value) === String(f.value) ? ' selected' : '') + '>' + esc(op.label) + '</option>'; }).join('') + '</select>'
          : f.type === 'textarea'
            ? '<textarea class="textarea" id="' + id + '" placeholder="' + esc(f.placeholder || '') + '">' + esc(f.value || '') + '</textarea>'
            : '<input class="input" id="' + id + '" type="' + (f.type || 'text') + '" ' + (f.step ? 'step="' + f.step + '" ' : '') + 'placeholder="' + esc(f.placeholder || '') + '" value="' + esc(f.value == null ? '' : f.value) + '">';
        return '<div class="field"><label for="' + id + '">' + esc(f.label) + '</label>' + ctl + (f.hint ? '<div class="hint">' + esc(f.hint) + '</div>' : '') + '</div>';
      }).join('');
      back.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(o.title || '') + '">'
        + '<div class="modal-h"><h3>' + esc(o.title || '') + '</h3>' + (o.text ? '<p>' + esc(o.text) + '</p>' : '') + '</div>'
        + '<div class="modal-b">' + (o.html || '') + fields + '</div>'
        + '<div class="modal-f">' + (o.hideCancel ? '' : '<button class="btn btn-secondary" data-x="cancel">' + esc(o.cancel || 'Cancel') + '</button>')
        + (o.okText === null ? '' : '<button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-x="ok">' + esc(o.okText || 'Confirm') + '</button>') + '</div></div>';
      d.body.appendChild(back);
      var first = back.querySelector('input,select,textarea,button[data-x="ok"]'); if (first) setTimeout(function () { first.focus(); }, 30);
      function close(v) { back.remove(); d.removeEventListener('keydown', key); resolve(v); }
      function collect() { var out = {}; (o.fields || []).forEach(function (f, i) { out[f.name] = back.querySelector('#mf' + i).value; }); return out; }
      function key(e) { if (e.key === 'Escape') close(null); if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); close(o.fields ? collect() : true); } }
      d.addEventListener('keydown', key);
      back.addEventListener('mousedown', function (e) { if (e.target === back) close(null); });
      back.addEventListener('click', function (e) {
        var x = e.target.closest('[data-x]'); if (!x) return;
        if (x.getAttribute('data-x') === 'cancel') close(null); else close(o.fields ? collect() : true);
      });
    });
  }
  function confirmBox(title, text, okText, danger) { return modal({ title: title, text: text, okText: okText || 'Confirm', danger: !!danger }).then(function (v) { return !!v; }); }

  /* ---- fetch json ---- */
  function api(url, opt) {
    opt = opt || {};
    if (opt.json !== undefined) { opt.method = opt.method || 'POST'; opt.headers = Object.assign({ 'content-type': 'application/json' }, opt.headers || {}); opt.body = JSON.stringify(opt.json); }
    return fetch(url, opt).then(function (r) {
      return r.text().then(function (t) { var j = {}; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, ok: r.ok, data: j }; });
    });
  }

  /* ---- count up ---- */
  function countUp(el, to, dp, prefix) {
    to = Number(to || 0); dp = dp || 0; prefix = prefix || '';
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches || !to) { el.textContent = prefix + (dp ? to.toFixed(dp) : num(to)); return; }
    var t0 = null, dur = 800;
    function step(t) {
      if (!t0) t0 = t; var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3), v = to * e;
      el.textContent = prefix + (dp ? v.toFixed(dp) : num(Math.round(v)));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---- signed-in aware navigation (public pages) ---- */
  if (d.body.hasAttribute('data-public')) {
    fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (u) {
      if (!u || !u.ok) return;
      $$('[data-auth="out"]').forEach(function (e) { e.classList.add('hide'); });
      $$('[data-auth="in"]').forEach(function (e) { e.classList.remove('hide'); });
      $$('a[href="/register"].js-cta').forEach(function (a) { a.setAttribute('href', '/dashboard'); a.textContent = 'Open dashboard'; });
      d.body.setAttribute('data-signed-in', '1');
    }).catch(function () {});
  }

  /* ---- cookie / ads notice (public pages) ---- */
  if (d.body.hasAttribute('data-public') && !store('eu-cookie')) {
    setTimeout(function () {
      if (store('eu-cookie')) return;
      var c = d.createElement('div'); c.className = 'cookie'; c.setAttribute('role', 'dialog'); c.setAttribute('aria-label', 'Cookie notice');
      c.innerHTML = '<p>We use essential cookies to keep you signed in, and our advertising partners may use cookies on short-link pages. See our <a href="/privacy">Privacy Policy</a>.</p><div class="acts"><button class="btn btn-primary btn-sm" data-c="1">Got it</button><a class="btn btn-ghost btn-sm" href="/privacy">Learn more</a></div>';
      d.body.appendChild(c);
      c.querySelector('[data-c]').addEventListener('click', function () { store('eu-cookie', '1'); c.remove(); });
    }, 1200);
  }

  window.EU = { esc: esc, money: money, num: num, $: $, $$: $$, toast: toast, copy: copy, modal: modal, confirm: confirmBox, api: api, countUp: countUp, store: store };
})();
