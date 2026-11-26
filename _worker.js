// ============================================================
//  ELITE URL  --  Backend (Cloudflare Pages Functions)
//  v2.0  --  auth + dashboard + admin + 7-step ad engine
// ============================================================

const enc = new TextEncoder();
const ownerEmailOf = (env) => String(env.OWNER_EMAIL || '').trim().toLowerCase();
const COOKIE = 'eu_session';
const SESSION_DAYS = 30;

const RESERVED = new Set(['api','s','go','assets','admin','dashboard','login','register',
  'logout','about','terms','privacy','contact','features','how-it-works','earnings',
  'cookie','withdrawal-policy','abuse','advertisers','index.html']);

// ---------- tiny helpers ----------
const json = (o, s = 200, extra = {}) => new Response(JSON.stringify(o), {
  status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
});
const html = (b, s = 200, extra = {}) => new Response(b, {
  status: s, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra },
});

async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hmacHex(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const token = (secret, sid, step) => hmacHex(secret, `${sid}:${step}`);
const b64 = (u8) => btoa(String.fromCharCode(...u8));

// PBKDF2 (Workers free plan par CPU limit hai, isliye 20k rounds)
async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 20000, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$20000$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}
async function verifyPassword(pw, stored) {
  try {
    const [algo, iters, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'pbkdf2') return false;
    const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: Number(iters), hash: 'SHA-256' }, key, 256));
    const want = Uint8Array.from(atob(hashB64), (c) => c.charCodeAt(0));
    if (bits.length !== want.length) return false;
    let diff = 0;
    for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ want[i];
    return diff === 0;
  } catch { return false; }
}

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function slug(len = 6) {
  const b = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (let i = 0; i < len; i++) s += B62[b[i] % 62];
  return s;
}
function deviceOf(ua = '') {
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile';
  return 'desktop';
}
const looksBot = (ua = '') => !ua || /bot|crawler|spider|headless|curl|wget|python|java\/|phantom|slurp/i.test(ua);
function validUrl(raw) {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (!u.hostname.includes('.')) return null;
    if (/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.)/.test(u.hostname)) return null;
    if (raw.length > 2048) return null;
    return u.toString();
  } catch { return null; }
}
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(e || ''));

async function setting(env, key, fb) {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return r ? r.value : fb;
}
async function numSetting(env, key, fb) {
  const v = await setting(env, key, null);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fb;
}
async function rateLimited(env, key, limit, win) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT * FROM rate_limits WHERE key = ?').bind(key).first();
  if (!row || now - row.window_start > win) {
    await env.DB.prepare('INSERT INTO rate_limits (key,window_start,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=?, count=1')
      .bind(key, now, now).run();
    return false;
  }
  if (row.count >= limit) return true;
  await env.DB.prepare('UPDATE rate_limits SET count=count+1 WHERE key=?').bind(key).run();
  return false;
}

async function sendMail(env, to, subject, html) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM || 'EliteURL <onboarding@resend.dev>', to: [to], subject, html }),
    });
    return r.ok;
  } catch (e) { console.error('mail failed', e); return false; }
}

// ---------- auth ----------
function cookieHeader(tok) {
  return `${COOKIE}=${tok}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}
function readCookie(request, name) {
  const c = request.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
async function currentUser(request, env) {
  const tok = readCookie(request, COOKIE);
  if (tok) {
    const hash = await sha256Hex(tok);
    const s = await env.DB.prepare('SELECT * FROM auth_sessions WHERE token_hash = ? AND expires_at > ?')
      .bind(hash, Math.floor(Date.now() / 1000)).first();
    if (s) {
      const u = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND status = ?').bind(s.user_id, 'active').first();
      if (u) return u;
    }
  }
  const key = request.headers.get('x-api-key');
  if (key && key === env.API_KEY) {
    return env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(ownerEmailOf(env) || 'owner@eliteofficial.in').first();
  }
  return null;
}
async function createSession(env, userId) {
  const tok = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('INSERT INTO auth_sessions (id,user_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), userId, await sha256Hex(tok),
      Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400).run();
  return tok;
}

// ---------- main router ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (p === '/api/step') return await apiStep(request, env);
      if (p.startsWith('/api/')) return await api(request, env, url);
      if (p.startsWith('/s/')) return await stepPage(request, env, url);
      if (p.startsWith('/go/')) return await go(request, env, url);

      if (!p.startsWith('/api/')) {
        const mm = await setting(env, 'maintenance_mode', '0');
        if (mm === '1' && p !== '/admin' && p !== '/login') {
          const cu = await currentUser(request, env);
          if (!cu || cu.role !== 'admin') {
            return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maintenance — EliteURL</title><div style="font-family:Inter,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px"><div><h1 style="font-size:22px;margin:0 0 10px">We are doing some maintenance</h1><p style="color:#5b6076;font-size:14px;margin:0">EliteURL will be back in a few minutes. Thank you for your patience.</p></div></div>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
          }
        }
      }
      if ((p === '/login' || p === '/register') && (await currentUser(request, env))) {
        return Response.redirect(url.origin + '/dashboard', 302);
      }
      const page = PAGE_MAP[p];
      if (page) {
        if (page.auth) {
          const u = await currentUser(request, env);
          if (!u) return Response.redirect(url.origin + '/login', 302);
          if (page.admin && u.role !== 'admin') return Response.redirect(url.origin + '/dashboard', 302);
        }
        return env.ASSETS.fetch(request);
      }
      if (p.startsWith('/assets/')) return env.ASSETS.fetch(request);
      if (STATIC_FILES.has(p)) return env.ASSETS.fetch(request);
      if (INFO_PAGES[p]) return html(infoPage(p));
      return await openShortLink(request, env, p.slice(1));
    } catch (err) {
      console.error('ERR', err && err.stack || err);
      return json({ error: 'server_error', message: String(err && err.message || err) }, 500);
    }
  },
};

const STATIC_FILES = new Set(['/robots.txt','/sitemap.xml','/favicon.svg','/site.webmanifest']);

// NOTE: Pages khud /login -> login.html serve karta hai (pretty URLs).
// Isliye yahan .html file map nahi karte — warna Pages 301 karta hai aur loop ban jata hai.
const PAGE_MAP = {
  '/': {},
  '/login': {},
  '/register': {},
  '/forgot': {},
  '/reset': {},
  '/dashboard': { auth: true },
  '/admin': { auth: true, admin: true },
};

// ---------- API ----------
async function api(request, env, url) {
  const p = url.pathname;
  const m = request.method;

  // ---- auth ----
  if (p === '/api/auth/register' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const pw = String(b.password || '');
    if (name.length < 2) return json({ error: 'Name must be at least 2 characters' }, 400);
    if (!validEmail(email)) return json({ error: 'Please enter a valid email address' }, 400);
    if (pw.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
    const ipHash = await sha256Hex((request.headers.get('cf-connecting-ip') || '0') + (env.IP_SALT || ''));
    if (await rateLimited(env, `reg:${ipHash}`, 5, 3600)) return json({ error: 'Too many attempts. Please try again in an hour.' }, 429);
    const signupOn = await setting(env, 'signup_enabled', '1');
    if (signupOn === '0') return json({ error: 'New registrations are temporarily closed.' }, 403);
    const exists = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
    if (exists) return json({ error: 'This email is already registered' }, 409);
    const total = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first();
    const ownerEmailCfg = ownerEmailOf(env);
    const role = ownerEmailCfg ? (email === ownerEmailCfg ? 'admin' : 'user')
                               : ((total && total.c === 0) ? 'admin' : 'user');
    const code = (name.slice(0, 3) + Math.floor(Math.random() * 9000 + 1000)).toUpperCase();
    let referrerId = null;
    const refBy = String(b.ref || '').trim().toUpperCase();
    if (refBy) {
      const rf = await env.DB.prepare('SELECT id FROM users WHERE referral_code = ?').bind(refBy).first();
      if (rf) referrerId = rf.id;
    }
    await env.DB.prepare('INSERT INTO users (name,email,password_hash,role,referral_code,referred_by) VALUES (?,?,?,?,?,?)')
      .bind(name, email, await hashPassword(pw), role, code, referrerId).run();
    if (referrerId) {
      await env.DB.prepare('INSERT OR IGNORE INTO referrals (referrer_id,referred_user_id,status) VALUES (?,?,?)')
        .bind(referrerId, (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()).id, 'pending').run();
    }
    const u = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    const tok = await createSession(env, u.id);
    const roleOut = (ownerEmailOf(env) && String(u.email || '').trim().toLowerCase() === ownerEmailOf(env)) ? 'admin' : u.role;
    if (roleOut === 'admin' && u.role !== 'admin') { try { await env.DB.prepare("UPDATE users SET role='admin' WHERE id=?").bind(u.id).run(); } catch (e) {} }
    return json({ ok: true, role: roleOut }, 200, { 'set-cookie': cookieHeader(tok) });
  }

  if (p === '/api/auth/login' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const email = String(b.email || '').trim().toLowerCase();
    const pw = String(b.password || '');
    const ipHash = await sha256Hex((request.headers.get('cf-connecting-ip') || '0') + (env.IP_SALT || ''));
    if (await rateLimited(env, `login:${ipHash}`, 10, 900)) return json({ error: 'Too many attempts. Please try again in 15 minutes.' }, 429);
    const u = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (!u || !u.password_hash || !(await verifyPassword(pw, u.password_hash)))
      return json({ error: 'Incorrect email or password' }, 401);
    if (u.status !== 'active') return json({ error: 'This account has been suspended' }, 403);
    const tok = await createSession(env, u.id);
    const roleOut = (ownerEmailOf(env) && String(u.email || '').trim().toLowerCase() === ownerEmailOf(env)) ? 'admin' : u.role;
    if (roleOut === 'admin' && u.role !== 'admin') { try { await env.DB.prepare("UPDATE users SET role='admin' WHERE id=?").bind(u.id).run(); } catch (e) {} }
    return json({ ok: true, role: roleOut }, 200, { 'set-cookie': cookieHeader(tok) });
  }

  if (p === '/api/auth/logout' && m === 'POST') {
    const tok = readCookie(request, COOKIE);
    if (tok) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await sha256Hex(tok)).run();
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` });
  }

  // ---- forgot / reset password (public) ----
  if (p === '/api/auth/forgot' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const email = String(b.email || '').trim().toLowerCase();
    const ipHash = await sha256Hex((request.headers.get('cf-connecting-ip') || '0') + (env.IP_SALT || ''));
    if (await rateLimited(env, `forgot:${ipHash}`, 5, 3600)) return json({ error: 'Too many attempts. Try again later.' }, 429);
    if (!env.RESEND_API_KEY) {
      return json({ error: 'Email service is not configured yet. Ask the admin for a reset link.' }, 503);
    }
    const u = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (!u) return json({ ok: true, message: 'If that email exists, a code has been sent.' });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await env.DB.prepare('INSERT INTO otp_codes (user_id, code_hash, purpose, expires_at, code_plain) VALUES (?,?,?,?,?)')
      .bind(u.id, await sha256Hex(code), 'reset', Math.floor(Date.now() / 1000) + 600, code).run();
    const sent = await sendMail(env, u.email, 'Your EliteURL verification code',
      `<p>Your EliteURL password reset code is:</p><p style="font-size:28px;font-weight:800;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. If you did not request it, ignore this email.</p>`);
    if (!sent) {
      // enumeration leak se bachne ke liye hamesha same jawab
      console.error('reset mail failed for', u.id);
      return json({ ok: true, message: 'If that email exists, a code has been sent.' });
    }
    return json({ ok: true, message: 'A 6-digit code has been sent to your email.' });
  }

  if (p === '/api/auth/verify-otp' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const email = String(b.email || '').trim().toLowerCase();
    const code = String(b.code || '').trim();
    const pw = String(b.password || '');
    if (pw.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
    const u = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (!u) return json({ error: 'Invalid code or email' }, 400);
    const row = await env.DB.prepare("SELECT * FROM otp_codes WHERE user_id=? AND purpose='reset' AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1")
      .bind(u.id, Math.floor(Date.now() / 1000)).first();
    if (!row) return json({ error: 'This code has expired. Request a new one.' }, 400);
    if (row.attempts >= 5) return json({ error: 'Too many wrong attempts. Request a new code.' }, 429);
    if ((await sha256Hex(code)) !== row.code_hash) {
      await env.DB.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
      return json({ error: 'That code is not correct.' }, 400);
    }
    await env.DB.prepare('UPDATE otp_codes SET used_at = ? WHERE id = ?').bind(Math.floor(Date.now() / 1000), row.id).run();
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(pw), u.id).run();
    await env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(u.id).run();
    return json({ ok: true });
  }

  if (false) {
    const b = await request.json().catch(() => ({}));
    const email = String(b.email || '').trim().toLowerCase();
    const ipHash = await sha256Hex((request.headers.get('cf-connecting-ip') || '0') + (env.IP_SALT || ''));
    if (await rateLimited(env, `forgot:${ipHash}`, 5, 3600)) return json({ error: 'Too many attempts. Try again later.' }, 429);
    const u = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    // hamesha same jawab — email exist karta hai ya nahi, pata nahi chalna chahiye
    if (!u) return json({ ok: true, message: 'If that email exists, a reset link has been created.' });
    const tok = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, '0')).join('');
    await env.DB.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)')
      .bind(u.id, await sha256Hex(tok), Math.floor(Date.now() / 1000) + 3600).run();
    const link = `${url.origin}/reset?token=${tok}`;
    if (env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            from: env.MAIL_FROM || 'EliteURL <no-reply@eliteofficial.in>',
            to: [u.email], subject: 'Reset your EliteURL password',
            html: `<p>Click the link below to set a new password. It expires in 1 hour.</p><p><a href="${link}">${link}</a></p>`,
          }),
        });
      } catch (e) { console.error('mail failed', e); }
      return json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
    }
    // email service nahi hai -> admin panel se link generate karo
    return json({ ok: true, message: 'Email service is not configured yet. Please contact support to reset your password.' });
  }

  if (p === '/api/auth/reset' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const tok = String(b.token || '');
    const pw = String(b.password || '');
    if (pw.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
    const row = await env.DB.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
      .bind(await sha256Hex(tok), Math.floor(Date.now() / 1000)).first();
    if (!row) return json({ error: 'This reset link is invalid or has expired.' }, 400);
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(pw), row.user_id).run();
    await env.DB.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').bind(Math.floor(Date.now() / 1000), row.id).run();
    await env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(row.user_id).run();
    return json({ ok: true });
  }

  const user = await currentUser(request, env);

  if (p === '/api/me') {
    if (!user) return json({ ok: false }, 401);
    const safe = async (fn, fallback) => { try { return await fn(); } catch (e) { return fallback; } };
    const agg = await safe(async () => (await env.DB.prepare(
      'SELECT COUNT(*) AS links, COALESCE(SUM(clicks),0) AS clicks, COALESCE(SUM(valid_views),0) AS valid_views, COALESCE(SUM(invalid_views),0) AS invalid_views FROM links WHERE user_id = ?'
    ).bind(user.id).first()), { links: 0, clicks: 0, valid_views: 0, invalid_views: 0 });
    const bal = await safe(async () => env.DB.prepare('SELECT * FROM v_user_balances WHERE user_id = ?').bind(user.id).first(), null);
    return json({ ok: true,
      user: { id: user.id, name: user.name, email: user.email,
        role: (ownerEmailOf(env) && String(user.email || '').trim().toLowerCase() === ownerEmailOf(env)) ? 'admin' : user.role,
        referral_code: user.referral_code },
      links: agg ? agg.links : 0, clicks: agg ? agg.clicks : 0,
      valid_views: agg ? agg.valid_views : 0, invalid_views: agg ? agg.invalid_views : 0,
      estimated_usd: bal ? (bal.estimated_usd || 0) : 0,
      confirmed_usd: bal ? (bal.confirmed_usd || 0) : 0,
      support_email: await safe(async () => setting(env, 'support_email', 'support@eliteofficial.in'), 'support@eliteofficial.in'),
      min_withdrawal_usd: await safe(async () => numSetting(env, 'min_withdrawal_usd', 5), 5),
      payout_hours: await safe(async () => numSetting(env, 'payout_hours', 12), 12) });
  }

  if (p === '/api/whoami') {
    const ck = readCookie(request, COOKIE);
    const out = { cookie_present: !!ck, session_found: false, user: null, reason: null };
    if (!ck) { out.reason = 'no_cookie_in_browser'; return json(out); }
    try {
      const hash = await sha256Hex(ck);
      const s = await env.DB.prepare('SELECT * FROM auth_sessions WHERE token_hash = ?').bind(hash).first();
      if (!s) { out.reason = 'session_row_missing'; return json(out); }
      out.session_found = true;
      out.expires_at = s.expires_at; out.now = Math.floor(Date.now() / 1000);
      if (s.expires_at <= out.now) { out.reason = 'session_expired'; return json(out); }
      const u = await env.DB.prepare('SELECT id,email,status,role FROM users WHERE id = ?').bind(s.user_id).first();
      out.user = u || null;
      out.reason = !u ? 'user_missing' : (u.status !== 'active' ? 'user_status_' + u.status : 'ok');
      out.is_owner = !!u && ownerEmailOf(env) !== '' && String(u.email||'').trim().toLowerCase() === ownerEmailOf(env);
      out.owner_configured = ownerEmailOf(env) !== '';
      out.your_email = u ? u.email : null;
    } catch (e) { out.reason = 'error: ' + String(e.message || e); }
    return json(out);
  }

  if (p === '/api/health') {
    const out = { ok: true, db: false, tables: 0, resend: !!env.RESEND_API_KEY, owner_email: !!env.OWNER_EMAIL, api_key: !!env.API_KEY };
    try {
      const t = await env.DB.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'").first();
      out.db = true; out.tables = t ? t.c : 0;
    } catch (e) { out.db = false; out.error = String(e.message || e); }
    try { const s = await env.DB.prepare("SELECT value FROM settings WHERE key='steps_count'").first(); out.steps = s ? Number(s.value) : null; } catch (e) {}
    return json(out);
  }

  if (p === '/api/public/site') {
    return json({ ok: true,
      site_name: await setting(env, 'site_name', 'ELITE URL'),
      support_email: await setting(env, 'support_email', 'support@eliteofficial.in'),
      min_withdrawal_usd: await numSetting(env, 'min_withdrawal_usd', 5),
      payout_hours: await numSetting(env, 'payout_hours', 12),
      steps_count: await numSetting(env, 'steps_count', 7) });
  }

  if (p === '/api/v1/shorten' && m === 'POST') {
    const key = request.headers.get('x-api-key') || '';
    if (!env.API_KEY || key !== env.API_KEY) return json({ error: 'Invalid API key' }, 401);
    const b = await request.json().catch(() => ({}));
    const dest = validUrl(b.url || '');
    if (!dest) return json({ error: 'Enter a valid http or https URL' }, 400);
    const owner = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(ownerEmailOf(env)).first();
    if (!owner) return json({ error: 'Owner account not found' }, 500);
    let s2 = null;
    for (let i = 0; i < 6; i++) { s2 = slug(6); if (!(await env.DB.prepare('SELECT 1 FROM links WHERE slug = ?').bind(s2).first())) break; s2 = null; }
    if (!s2) return json({ error: 'Could not create the link' }, 500);
    await env.DB.prepare('INSERT INTO links (user_id,slug,destination_url) VALUES (?,?,?)').bind(owner.id, s2, dest).run();
    return json({ ok: true, short: `${url.origin}/${s2}`, slug: s2 });
  }

  if (p === '/api/public/shorten' && m === 'POST') {
    if (!user) return json({ error: 'Please sign in to create a link' }, 401);
  }

  if (!user) return json({ error: 'Please sign in' }, 401);

  // ---- links ----
  if (p === '/api/links' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const dest = validUrl(b.url || '');
    if (!dest) return json({ error: 'Enter a valid http or https URL' }, 400);
    let s = String(b.alias || '').trim();
    if (s) {
      if (!/^[A-Za-z0-9_-]{3,32}$/.test(s)) return json({ error: 'Alias may only contain letters, numbers, hyphens and underscores' }, 400);
      if (RESERVED.has(s.toLowerCase())) return json({ error: 'This alias is reserved' }, 400);
      if (await env.DB.prepare('SELECT 1 FROM links WHERE slug = ?').bind(s).first()) return json({ error: 'This alias is already taken' }, 409);
    } else {
      for (let i = 0; i < 6; i++) {
        s = slug(6);
        if (!(await env.DB.prepare('SELECT 1 FROM links WHERE slug = ?').bind(s).first())) break;
        s = null;
      }
      if (!s) return json({ error: 'Could not create the link. Please try again.' }, 500);
    }
    let expAt = null;
    const days = Number(b.expires_in_days);
    if (Number.isFinite(days) && days > 0) expAt = Math.floor(Date.now() / 1000) + Math.round(days * 86400);
    let pwHash = null;
    if (b.password && String(b.password).length >= 4) pwHash = await hashPassword(String(b.password));
    await env.DB.prepare('INSERT INTO links (user_id,slug,destination_url,title,expires_at,password_hash) VALUES (?,?,?,?,?,?)')
      .bind(user.id, s, dest, b.title || null, expAt, pwHash).run();
    return json({ ok: true, slug: s, short: `${url.origin}/${s}`, destination: dest });
  }

  if (p === '/api/links' && m === 'GET') {
    const rows = await env.DB.prepare('SELECT slug,destination_url,clicks,valid_views,invalid_views,status,created_at,expires_at,(password_hash IS NOT NULL) AS locked FROM links WHERE user_id = ? ORDER BY id DESC LIMIT 200').bind(user.id).all();
    return json({ ok: true, links: rows.results });
  }

  if (p.startsWith('/api/links/') && m === 'DELETE') {
    const s = p.split('/').pop();
    await env.DB.prepare("UPDATE links SET status='inactive' WHERE slug=? AND user_id=?").bind(s, user.id).run();
    return json({ ok: true });
  }

  // ---- 7-day stats ----
  if (p === '/api/stats/daily' && m === 'GET') {
    const r = await env.DB.prepare(`SELECT s.day, SUM(s.clicks) AS clicks, SUM(s.valid_views) AS valid
      FROM link_daily_stats s JOIN links l ON l.id = s.link_id
      WHERE l.user_id = ? AND s.day >= date('now','-6 days')
      GROUP BY s.day ORDER BY s.day`).bind(user.id).all();
    return json({ ok: true, days: r.results });
  }

  // ---- referrals ----
  if (p === '/api/referrals' && m === 'GET') {
    let count = 0, earned = 0;
    try {
      const cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM referrals WHERE referrer_id = ?').bind(user.id).first();
      count = cnt ? cnt.c : 0;
    } catch (e) { count = 0; }
    try {
      const led = await env.DB.prepare("SELECT COALESCE(SUM(amount_usd),0) AS s FROM ledger WHERE user_id = ? AND type = 'referral'").bind(user.id).first();
      earned = led ? led.s : 0;
    } catch (e) { earned = 0; }
    let rate = 0.10;
    try { rate = await numSetting(env, 'referral_commission', 0.10); } catch (e) {}
    return json({ ok: true, code: user.referral_code || '', count, earned_usd: earned, commission: rate });
  }

  // ---- account ----
  if (p === '/api/account/profile' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const name = String(b.name || '').trim();
    if (name.length < 2) return json({ error: 'Name must be at least 2 characters' }, 400);
    if (name.length > 60) return json({ error: 'Name is too long' }, 400);
    await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
    return json({ ok: true, name });
  }

  if (p === '/api/account/password' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const current = String(b.current || '');
    const next = String(b.password || '');
    if (next.length < 8) return json({ error: 'New password must be at least 8 characters' }, 400);
    const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
    if (!row || !row.password_hash) return json({ error: 'This account has no password set' }, 400);
    if (!(await verifyPassword(current, row.password_hash))) return json({ error: 'Your current password is not correct' }, 401);
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(next), user.id).run();
    const tok = readCookie(request, COOKIE);
    if (tok) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ? AND user_id != ?').bind(await sha256Hex(tok), user.id).run();
    return json({ ok: true });
  }

  // ---- withdrawals (user) ----
  if (p === '/api/withdrawals' && m === 'GET') {
    const r = await env.DB.prepare('SELECT id,amount_usd,method,payee_last4,status,txn_ref,requested_at,processed_at FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 50')
      .bind(user.id).all();
    const min = await numSetting(env, 'min_withdrawal_usd', 5);
    const bal = await env.DB.prepare('SELECT * FROM v_user_balances WHERE user_id=?').bind(user.id).first();
    return json({ ok: true, withdrawals: r.results, min_withdrawal_usd: min, available_usd: bal ? bal.confirmed_usd : 0 });
  }

  if (p === '/api/withdrawals' && m === 'POST') {
    const b = await request.json().catch(() => ({}));
    const amount = Number(b.amount);
    const method = String(b.method || '');
    const account = String(b.account || '').trim();
    const ifsc = String(b.ifsc || '').trim().toUpperCase();
    const holder = String(b.holder || '').trim();
    const min = await numSetting(env, 'min_withdrawal_usd', 5);
    if (!['paypal', 'upi', 'bank'].includes(method)) return json({ error: 'Choose a valid payout method' }, 400);
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: 'Enter a valid amount' }, 400);
    if (amount < min) return json({ error: `Minimum withdrawal is $${min}` }, 400);
    if (!account || account.length < 5) return json({ error: 'Enter your PayPal email, UPI ID or account number' }, 400);
    if (method === 'bank' && (!ifsc || !holder)) return json({ error: 'Bank name, account number and IFSC are required' }, 400);
    const bal = await env.DB.prepare('SELECT * FROM v_user_balances WHERE user_id=?').bind(user.id).first();
    const available = bal ? Number(bal.confirmed_usd) : 0;
    if (amount > available) return json({ error: `You can withdraw up to $${available.toFixed(2)}` }, 400);
    const pending = await env.DB.prepare("SELECT COUNT(*) AS c FROM withdrawals WHERE user_id=? AND status='pending'").bind(user.id).first();
    if (pending && pending.c >= 2) return json({ error: 'You already have pending withdrawal requests' }, 409);

    const payee = method === 'bank' ? `${holder} | ${account} | ${ifsc}` : account;
    await env.DB.prepare('INSERT INTO withdrawals (user_id,amount_usd,method,payee_enc,payee_last4,status) VALUES (?,?,?,?,?,?)')
      .bind(user.id, amount, method, payee, account.slice(-4), 'pending').run();
    const after = available - amount;
    await env.DB.prepare("INSERT INTO ledger (user_id,type,bucket,amount_usd,balance_after_usd,ref_table,reason) VALUES (?,'withdrawal_hold','confirmed',?,?,'withdrawals','withdrawal requested')")
      .bind(user.id, -amount, after).run();
    await env.DB.prepare('UPDATE users SET balance_conf_usd=? WHERE id=?').bind(after, user.id).run();
    return json({ ok: true, message: 'Withdrawal request submitted. It will be reviewed within 48 hours.' });
  }

  // ---- admin ----
  if (p.startsWith('/api/admin/')) {
    const ownerEmail = ownerEmailOf(env);
    const isOwner = ownerEmail !== '' && String(user.email || '').trim().toLowerCase() === ownerEmail;
    if (!isOwner) return json({ error: 'forbidden' }, 403);
    if (user.role !== 'admin') {
      try { await env.DB.prepare("UPDATE users SET role='admin' WHERE id=?").bind(user.id).run(); user.role = 'admin'; } catch (e) {}
    }

    if (p === '/api/admin/overview') {
      const warn = [];
      const safe = async (label, fn, fallback) => {
        try { return await fn(); } catch (e) { warn.push(label + ': ' + String(e.message || e)); return fallback; }
      };
      const u = await safe('users', () => env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active FROM users").first(), { total: 0, active: 0 });
      const l = await safe('links', () => env.DB.prepare('SELECT COUNT(*) AS links, COALESCE(SUM(clicks),0) AS clicks, COALESCE(SUM(valid_views),0) AS valid_views, COALESCE(SUM(invalid_views),0) AS invalid_views FROM links').first(), { links: 0, clicks: 0, valid_views: 0, invalid_views: 0 });
      const wd = await safe('withdrawals', () => env.DB.prepare("SELECT COUNT(*) AS pending FROM withdrawals WHERE status='pending'").first(), { pending: 0 });
      const bal = await safe('ledger', () => env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN bucket='estimated' THEN amount_usd END),0) AS est, COALESCE(SUM(CASE WHEN bucket='confirmed' THEN amount_usd END),0) AS conf FROM ledger").first(), { est: 0, conf: 0 });
      return json({ ok: true, users: u, links: l, withdrawals: wd, ledger: bal, warnings: warn });
    }

    if (p === '/api/admin/schema') {
      const out = {};
      for (const t of ['users','links','click_sessions','ledger','withdrawals','referrals','otp_codes','ad_zones','settings']) {
        try {
          const r = await env.DB.prepare(`SELECT name FROM pragma_table_info('${t}')`).all();
          out[t] = (r.results || []).map((x) => x.name);
        } catch (e) { out[t] = 'ERROR: ' + String(e.message || e); }
      }
      return json({ ok: true, schema: out });
    }
    if (p === '/api/admin/otp' && m === 'GET') {
      const id = Number(url.searchParams.get('user_id') || 0);
      const r = await env.DB.prepare('SELECT code_plain, expires_at, used_at FROM otp_codes WHERE user_id=? ORDER BY id DESC LIMIT 1').bind(id).first();
      if (!r) return json({ ok: true, code: null });
      return json({ ok: true, code: r.code_plain || null, expires_at: r.expires_at, used: !!r.used_at });
    }
    if (p === '/api/admin/users' && m === 'GET') {
      const r = await env.DB.prepare(`SELECT u.id,u.name,u.email,u.role,u.status,u.created_at,u.fraud_flag,u.fraud_note,COALESCE(u.rate_multiplier,1) AS rate_multiplier,
        COALESCE(b.confirmed_usd,0) AS confirmed_usd, COALESCE(b.estimated_usd,0) AS estimated_usd,
        COALESCE(v.valid,0) AS valid_views, COALESCE(v.invalid,0) AS invalid_views
      FROM users u
      LEFT JOIN v_user_balances b ON b.user_id = u.id
      LEFT JOIN (SELECT user_id, SUM(CASE WHEN is_valid=1 THEN 1 ELSE 0 END) AS valid,
                        SUM(CASE WHEN is_valid=0 AND status IN ('invalid','started') THEN 1 ELSE 0 END) AS invalid
                 FROM click_sessions GROUP BY user_id) v ON v.user_id = u.id
      ORDER BY u.id DESC LIMIT 200`).all();
      return json({ ok: true, users: r.results });
    }
    if (p === '/api/admin/links') {
      const r = await env.DB.prepare('SELECT l.slug,l.destination_url,l.clicks,l.valid_views,l.status,u.email FROM links l JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 200').all();
      return json({ ok: true, links: r.results });
    }
    if (p === '/api/admin/settings' && m === 'GET') {
      const r = await env.DB.prepare('SELECT key,value FROM settings ORDER BY key').all();
      return json({ ok: true, settings: r.results });
    }
    if (p === '/api/admin/settings' && m === 'POST') {
      const b = await request.json().catch(() => ({}));
      const allowed = ['steps_count','countdown_seconds','creator_share','platform_share','min_withdrawal_usd','payout_hours','support_email','hold_days','show_destination','earning_mode','maintenance_mode','signup_enabled'];
      for (const k of Object.keys(b)) {
        if (!allowed.includes(k)) continue;
        await env.DB.prepare('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=?, updated_at=?')
          .bind(k, String(b[k]), Math.floor(Date.now() / 1000), String(b[k]), Math.floor(Date.now() / 1000)).run();
      }
      return json({ ok: true });
    }
    if (p === '/api/admin/zones' && m === 'GET') {
      const r = await env.DB.prepare('SELECT id,network,label,format,step_no,status FROM ad_zones ORDER BY step_no,id').all();
      return json({ ok: true, zones: r.results });
    }
    if (p === '/api/admin/zones' && m === 'POST') {
      const b = await request.json().catch(() => ({}));
      if (!b.network || !b.format || !b.snippet) return json({ error: 'network, format and snippet are required' }, 400);
      await env.DB.prepare('INSERT INTO ad_zones (network,label,format,snippet,step_no,status) VALUES (?,?,?,?,?,?)')
        .bind(b.network, b.label || 'Zone', b.format, b.snippet, Number(b.step_no) || 1, 'active').run();
      return json({ ok: true });
    }

    if (p === '/api/admin/withdrawals' && m === 'GET') {
      const r = await env.DB.prepare('SELECT w.*, u.email, u.name FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 100').all();
      return json({ ok: true, withdrawals: r.results });
    }
    if (p === '/api/admin/withdrawals' && m === 'POST') {
      const b = await request.json().catch(() => ({}));
      const id = Number(b.id);
      const action = String(b.action || '');
      const wd = await env.DB.prepare('SELECT * FROM withdrawals WHERE id=?').bind(id).first();
      if (!wd) return json({ error: 'Not found' }, 404);
      const now = Math.floor(Date.now() / 1000);
      if (action === 'approve') {
        await env.DB.prepare("UPDATE withdrawals SET status='approved', processed_at=? WHERE id=?").bind(now, id).run();
        await env.DB.prepare('INSERT INTO admin_actions (admin_id,user_id,action,amount_usd,note) VALUES (?,?,?,?,?)')
          .bind(user.id, wd.user_id, 'withdrawal_approve', wd.amount_usd, null).run();
        const uu = await env.DB.prepare('SELECT email,name FROM users WHERE id=?').bind(wd.user_id).first();
        if (uu) await sendMail(env, uu.email, 'Your EliteURL withdrawal was approved',
          `<p>Hi ${uu.name || 'there'},</p><p>Your withdrawal of <strong>$${Number(wd.amount_usd).toFixed(2)}</strong> has been approved and will be paid within ${await numSetting(env, 'payout_hours', 12)} hours.</p><p>— EliteURL</p>`);
        return json({ ok: true });
      }
      if (action === 'reject') {
        await env.DB.prepare("UPDATE withdrawals SET status='rejected', processed_at=?, admin_note=? WHERE id=?").bind(now, b.note || null, id).run();
        await env.DB.prepare('INSERT INTO admin_actions (admin_id,user_id,action,amount_usd,note) VALUES (?,?,?,?,?)')
          .bind(user.id, wd.user_id, 'withdrawal_reject', wd.amount_usd, b.note || null).run();
        const bal = await env.DB.prepare('SELECT * FROM v_user_balances WHERE user_id=?').bind(wd.user_id).first();
        const after = (bal ? Number(bal.confirmed_usd) : 0) + Number(wd.amount_usd);
        await env.DB.prepare("INSERT INTO ledger (user_id,type,bucket,amount_usd,balance_after_usd,ref_table,ref_id,reason) VALUES (?,'withdrawal_release','confirmed',?,?,'withdrawals',?,'withdrawal rejected')")
          .bind(wd.user_id, Number(wd.amount_usd), after, String(id)).run();
        await env.DB.prepare('UPDATE users SET balance_conf_usd=? WHERE id=?').bind(after, wd.user_id).run();
        return json({ ok: true });
      }
      if (action === 'paid') {
        await env.DB.prepare("UPDATE withdrawals SET status='paid', processed_at=?, txn_ref=? WHERE id=?").bind(now, b.txn_ref || null, id).run();
        await env.DB.prepare('INSERT INTO admin_actions (admin_id,user_id,action,amount_usd,note) VALUES (?,?,?,?,?)')
          .bind(user.id, wd.user_id, 'withdrawal_paid', wd.amount_usd, b.txn_ref || null).run();
        const uu2 = await env.DB.prepare('SELECT email,name FROM users WHERE id=?').bind(wd.user_id).first();
        if (uu2) await sendMail(env, uu2.email, 'Your EliteURL payout was sent',
          `<p>Hi ${uu2.name || 'there'},</p><p>We have sent <strong>$${Number(wd.amount_usd).toFixed(2)}</strong> to your ${String(wd.method).toUpperCase()} account.</p><p>Transaction reference: <strong>${b.txn_ref || '—'}</strong></p><p>— EliteURL</p>`);
        return json({ ok: true });
      }
      return json({ error: 'Unknown action' }, 400);
    }
    if (p === '/api/admin/users' && m === 'POST') {
      const b = await request.json().catch(() => ({}));
      const id = Number(b.id);
      const u = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
      if (!u) return json({ error: 'User not found' }, 404);
      if (String(u.email || '').trim().toLowerCase() === ownerEmailOf(env))
        return json({ error: 'You cannot modify the owner account' }, 400);
      const now = Math.floor(Date.now() / 1000);
      const act = String(b.action || '');

      if (act === 'suspend') {
        await env.DB.prepare("UPDATE users SET status='suspended' WHERE id=?").bind(id).run();
        await env.DB.prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(id).run();
        await env.DB.prepare('INSERT INTO admin_actions (admin_id,user_id,action,note) VALUES (?,?,?,?)')
          .bind(user.id, id, 'suspend', b.note || null).run();
        return json({ ok: true });
      }
      if (act === 'activate') {
        await env.DB.prepare("UPDATE users SET status='active', fraud_flag=NULL, fraud_note=NULL WHERE id=?").bind(id).run();
        await env.DB.prepare('INSERT INTO admin_actions (admin_id,user_id,action) VALUES (?,?,?)')
          .bind(user.id, id, 'activate').run();
        return json({ ok: true });
      }
      if (act === 'rate') {
        const mult = Number(b.value);
        if (!Number.isFinite(mult) || mult < 0 || mult > 10) return json({ error: 'Rate must be between 0 and 10' }, 400);
        await env.DB.prepare('UPDATE users SET rate_multiplier = ? WHERE id = ?').bind(mult, id).run();
        await env.DB.prepare('INSERT INTO admin_actions (admin_id,user_id,action,amount_usd,note) VALUES (?,?,?,?,?)')
          .bind(user.id, id, 'rate', mult, b.note || null).run();
        return json({ ok: true, rate_multiplier: mult });
      }
      if (act === 'block') {
        await env.DB.prepare("UPDATE users SET status='suspended', fraud_flag='blocked' WHERE id=?").bind(id).run();
        await env.DB.prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(id).run();
        await env.DB.prepare('INSERT INTO admin_actions (admin_id,user_id,action,note) VALUES (?,?,?,?)')
          .bind(user.id, id, 'block', b.note || null).run();
        return json({ ok: true });
      }
      if (act === 'flag') {
        await env.DB.prepare('UPDATE users SET fraud_flag=?, fraud_note=? WHERE id=?')
          .bind(b.flag || 'suspicious', b.note || null, id).run();
        await env.DB.prepare('INSERT INTO admin_actions (admin_id,user_id,action,note) VALUES (?,?,?,?)')
          .bind(user.id, id, 'flag', b.note || null).run();
        return json({ ok: true });
      }
      if (act === 'resetlink') {
        const tok = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, '0')).join('');
        await env.DB.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)')
          .bind(id, await sha256Hex(tok), Math.floor(Date.now() / 1000) + 3600).run();
        await env.DB.prepare('INSERT INTO admin_actions (admin_id,user_id,action,note) VALUES (?,?,?,?)')
          .bind(user.id, id, 'reset_link', null).run();
        return json({ ok: true, link: `${url.origin}/reset?token=${tok}`, expires_in: 3600 });
      }
      if (act === 'adjust') {
        const amt = Number(b.amount);
        if (!Number.isFinite(amt) || amt === 0) return json({ error: 'Enter a non-zero amount' }, 400);
        const bal = await env.DB.prepare('SELECT * FROM v_user_balances WHERE user_id=?').bind(id).first();
        const after = (bal ? Number(bal.confirmed_usd) : 0) + amt;
        await env.DB.prepare("INSERT INTO ledger (user_id,type,bucket,amount_usd,balance_after_usd,reason) VALUES (?,'adjustment','confirmed',?,?,?)")
          .bind(id, amt, after, b.note || 'admin adjustment').run();
        await env.DB.prepare('UPDATE users SET balance_conf_usd=? WHERE id=?').bind(after, id).run();
        await env.DB.prepare('INSERT INTO admin_actions (admin_id,user_id,action,amount_usd,note) VALUES (?,?,?,?,?)')
          .bind(user.id, id, 'adjust', amt, b.note || null).run();
        return json({ ok: true, confirmed_usd: after });
      }
      return json({ error: 'Unknown action' }, 400);
    }

    if (p === '/api/admin/reset-link' && m === 'POST') {
      const b = await request.json().catch(() => ({}));
      const u = await env.DB.prepare('SELECT id,email FROM users WHERE email=?').bind(String(b.email || '').toLowerCase()).first();
      if (!u) return json({ error: 'User not found' }, 404);
      const tok = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, '0')).join('');
      await env.DB.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)')
        .bind(u.id, await sha256Hex(tok), Math.floor(Date.now() / 1000) + 3600).run();
      return json({ ok: true, link: `${url.origin}/reset?token=${tok}` });
    }
  }

  return json({ error: 'not_found' }, 404);
}

// ---------- short link ----------
async function openShortLink(request, env, rawSlug) {
  const s = rawSlug.replace(/\/+$/, '');
  if (!s || s.length > 64) return html(messagePage('Link not found', 'This short link does not exist.'), 404);
  const link = await env.DB.prepare("SELECT * FROM links WHERE slug = ? AND status = 'active'").bind(s).first();
  if (!link) return html(messagePage('Link not found', 'This short link does not exist or has been disabled.'), 404);
  if (link.expires_at && link.expires_at < Math.floor(Date.now() / 1000))
    return html(messagePage('Link expired', 'This short link has expired.'), 410);
  if (link.password_hash) {
    const given = String(new URL(request.url).searchParams.get('pw') || '');
    const ok = given ? await verifyPassword(given, link.password_hash) : false;
    if (!ok) return html(passwordPage(s, !!given), given ? 401 : 401);
  }

  const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
  const ua = request.headers.get('user-agent') || '';
  const ipHash = await sha256Hex(ip + (env.IP_SALT || 'salt'));
  const uaHash = await sha256Hex(ua);

  if (await rateLimited(env, `ip:${ipHash}`, 40, 3600))
    return html(messagePage('Too many requests', 'Please try again later.'), 429);

  const steps = Math.max(1, Math.min(8, await numSetting(env, 'steps_count', 7)));
  const sid = crypto.randomUUID();
  let invalidReason = null;
  if (looksBot(ua)) invalidReason = 'bot';
  if (!invalidReason) {
    const dup = await env.DB.prepare("SELECT 1 FROM click_sessions WHERE ip_hash=? AND link_id=? AND is_valid=1 AND created_at>? LIMIT 1")
      .bind(ipHash, link.id, Math.floor(Date.now() / 1000) - 86400).first();
    if (dup) invalidReason = 'duplicate_24h';
  }
  const cf = request.cf || {};
  await env.DB.prepare(`INSERT INTO click_sessions
    (id,link_id,user_id,ip_hash,ua_hash,country,device,browser,referrer,steps_required,status,is_valid,invalid_reason,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(sid, link.id, link.user_id, ipHash, uaHash, cf.country || 'XX', deviceOf(ua), '',
      request.headers.get('referer') || '', steps, invalidReason ? 'invalid' : 'started', 0, invalidReason,
      Math.floor(Date.now() / 1000)).run();
  if (invalidReason) {
    await env.DB.prepare('INSERT INTO fraud_events (session_id,user_id,rule,severity,action) VALUES (?,?,?,?,?)')
      .bind(sid, link.user_id, invalidReason, 'medium', 'counted_invalid').run();
  }
  await env.DB.prepare('UPDATE links SET clicks=clicks+1 WHERE id=?').bind(link.id).run();
  const t = await token(env.SESSION_SECRET, sid, 1);
  return Response.redirect(`${new URL(request.url).origin}/s/${sid}/1?t=${t}`, 302);
}

// ---------- step page ----------
async function stepPage(request, env, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const sid = parts[1];
  const n = parseInt(parts[2] || '1', 10);
  const t = url.searchParams.get('t') || '';
  if (!sid || !Number.isFinite(n) || n < 1 || n > 8) return html(messagePage('Invalid link', ''), 400);
  if (t !== await token(env.SESSION_SECRET, sid, n)) return html(messagePage('Invalid link', 'Security check failed.'), 403);

  const sess = await env.DB.prepare('SELECT * FROM click_sessions WHERE id=?').bind(sid).first();
  if (!sess) return html(messagePage('Session not found', ''), 404);
  const zones = await env.DB.prepare("SELECT * FROM ad_zones WHERE step_no=? AND status='active' ORDER BY id").bind(n).all();
  const countdown = Math.max(3, Math.min(60, await numSetting(env, 'countdown_seconds', 15)));
  const showDest = (await setting(env, 'show_destination', '0')) === '1';
  const link = showDest ? await env.DB.prepare('SELECT destination_url FROM links WHERE id=?').bind(sess.link_id).first() : null;
  const destHost = link ? new URL(link.destination_url).hostname : null;
  const stepToken = await token(env.SESSION_SECRET, sid, n);

  return html(renderStep({
    sid, n, total: sess.steps_required, countdown, destHost,
    zones: zones.results, stepToken, isLast: n === sess.steps_required,
  }));
}

async function apiStep(request, env) {
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  const b = await request.json().catch(() => ({}));
  const step = parseInt(b.n, 10);
  if (!b.sid || !Number.isFinite(step)) return json({ error: 'bad_request' }, 400);
  if (b.t !== await token(env.SESSION_SECRET, b.sid, step)) return json({ error: 'bad_token' }, 403);
  const sess = await env.DB.prepare('SELECT * FROM click_sessions WHERE id=?').bind(b.sid).first();
  if (!sess) return json({ error: 'no_session' }, 404);
  if (sess.status === 'invalid') return json({ error: 'invalid_session' }, 403);
  if (sess.steps_completed !== step - 1) return json({ error: 'out_of_order' }, 409);
  if (Math.floor(Date.now() / 1000) - sess.created_at > 7200) return json({ error: 'expired' }, 410);

  await env.DB.prepare('INSERT OR IGNORE INTO step_events (session_id,step_no,ad_fired,dwell_ms) VALUES (?,?,?,?)')
    .bind(b.sid, step, 1, 0).run();
  await env.DB.prepare('UPDATE click_sessions SET steps_completed=? WHERE id=?').bind(step, b.sid).run();

  const origin = new URL(request.url).origin;
  if (step >= sess.steps_required) {
    return json({ ok: true, done: true, next: `${origin}/go/${b.sid}?t=${await token(env.SESSION_SECRET, b.sid, 'go')}` });
  }
  return json({ ok: true, done: false, next: `${origin}/s/${b.sid}/${step + 1}?t=${await token(env.SESSION_SECRET, b.sid, step + 1)}` });
}

async function go(request, env, url) {
  const sid = url.pathname.split('/').filter(Boolean)[1];
  const t = url.searchParams.get('t') || '';
  if (!sid) return html(messagePage('Invalid link', ''), 400);
  if (t !== await token(env.SESSION_SECRET, sid, 'go')) return html(messagePage('Invalid link', ''), 403);
  const sess = await env.DB.prepare('SELECT * FROM click_sessions WHERE id=?').bind(sid).first();
  if (!sess) return html(messagePage('Session not found', ''), 404);
  const link = await env.DB.prepare('SELECT * FROM links WHERE id=?').bind(sess.link_id).first();
  if (!link) return html(messagePage('Link not found', ''), 404);

  if (sess.status === 'started' && sess.steps_completed >= sess.steps_required) {
    const now = Math.floor(Date.now() / 1000);
    const valid = sess.invalid_reason === null;
    const ownerStatus = await env.DB.prepare('SELECT status FROM users WHERE id = ?').bind(link.user_id).first();
    const ownerActive = !ownerStatus || ownerStatus.status === 'active';
    const zoneRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM ad_zones WHERE status='active'").first();
    const adsLive = !!(zoneRow && zoneRow.c > 0);
    if (valid && adsLive && ownerActive) {
      const share = await numSetting(env, 'creator_share', 0.95);
      const mult0 = 1;
      const rc = await env.DB.prepare('SELECT cpm_usd FROM rate_card WHERE country_code=? AND device=? LIMIT 1')
        .bind(sess.country || 'ALL', 'all').first()
        || await env.DB.prepare("SELECT cpm_usd FROM rate_card WHERE country_code='ALL' LIMIT 1").first();
      // earning seedha USD mein: (CPM / 1000) * creator share
      // referrer commission (uske traffic ki kamai ka %)
      try {
        const ownerInfo = await env.DB.prepare('SELECT referred_by FROM users WHERE id = ?').bind(link.user_id).first();
        if (ownerInfo && ownerInfo.referred_by) {
          const rate = await numSetting(env, 'referral_commission', 0.10);
          const comm = ((rc ? rc.cpm_usd : 1.5) / 1000) * share * mult0 * rate;
          if (comm > 0) {
            const rb = await env.DB.prepare('SELECT * FROM v_user_balances WHERE user_id = ?').bind(ownerInfo.referred_by).first();
            const rafter = (rb ? Number(rb.confirmed_usd) : 0) + comm;
            await env.DB.prepare("INSERT INTO ledger (user_id,type,bucket,amount_usd,balance_after_usd,ref_table,ref_id,reason) VALUES (?,'referral','confirmed',?,?,?,?,?)")
              .bind(ownerInfo.referred_by, comm, rafter, 'click_sessions', sid, 'referral commission').run();
            await env.DB.prepare('UPDATE users SET balance_conf_usd = ? WHERE id = ?').bind(rafter, ownerInfo.referred_by).run();
            await env.DB.prepare("UPDATE referrals SET status='qualified', reward_usd = COALESCE(reward_usd,0) + ? WHERE referred_user_id = ?")
              .bind(comm, link.user_id).run();
          }
        }
      } catch (e) { console.error('ref commission failed', e); }
      const ownerRow = await env.DB.prepare('SELECT rate_multiplier FROM users WHERE id = ?').bind(link.user_id).first();
      const mult = ownerRow && Number.isFinite(ownerRow.rate_multiplier) ? ownerRow.rate_multiplier : 1;
      let earn = ((rc ? rc.cpm_usd : 1.5) / 1000) * share * mult;
      // daily cap per user
      try {
        const cap = await numSetting(env, 'daily_earning_cap_usd', 0);
        if (cap > 0) {
          const today = await env.DB.prepare("SELECT COALESCE(SUM(amount_usd),0) AS s FROM ledger WHERE user_id=? AND type='earning' AND created_at >= ?")
            .bind(link.user_id, Math.floor(Date.now() / 1000) - 86400).first();
          const used = today ? Number(today.s) : 0;
          if (used >= cap) earn = 0;
          else if (used + earn > cap) earn = cap - used;
        }
      } catch (e) {}
      await env.DB.prepare("UPDATE click_sessions SET status='completed', is_valid=1, earning_est_usd=?, completed_at=? WHERE id=?")
        .bind(earn, now, sid).run();
      await env.DB.prepare('UPDATE links SET valid_views=valid_views+1 WHERE id=?').bind(link.id).run();
      await env.DB.prepare(`INSERT INTO link_daily_stats (link_id,day,clicks,valid_views,invalid_views,earning_est_usd)
        VALUES (?,date('now'),0,1,0,?) ON CONFLICT(link_id,day) DO UPDATE SET valid_views=valid_views+1, earning_est_usd=earning_est_usd+?`)
        .bind(link.id, earn, earn).run();
      const bal = await env.DB.prepare('SELECT * FROM v_user_balances WHERE user_id=?').bind(sess.user_id).first();
      const after = (bal ? bal.estimated_usd : 0) + earn;
      await env.DB.prepare("INSERT INTO ledger (user_id,type,bucket,amount_usd,balance_after_usd,ref_table,ref_id,reason) VALUES (?,'earning','estimated',?,?,'click_sessions',?,'valid view')")
        .bind(sess.user_id, earn, after, sid).run();
      await env.DB.prepare('UPDATE users SET balance_est_usd=? WHERE id=?').bind(after, sess.user_id).run();
    } else if (valid && (!adsLive || !ownerActive)) {
      // view valid hai par koi ad serve nahi hua -> koi earning nahi
      await env.DB.prepare("UPDATE click_sessions SET status='completed', is_valid=1, earning_est_usd=0, completed_at=? WHERE id=?").bind(now, sid).run();
      await env.DB.prepare('UPDATE links SET valid_views=valid_views+1 WHERE id=?').bind(link.id).run();
    } else {
      await env.DB.prepare("UPDATE click_sessions SET status='invalid', completed_at=? WHERE id=?").bind(now, sid).run();
      await env.DB.prepare('UPDATE links SET invalid_views=invalid_views+1 WHERE id=?').bind(link.id).run();
    }
  }
  return Response.redirect(link.destination_url, 302);
}

// ---------- step page render ----------
const STEP_CONTENT = [
  { h: 'What happens when you open a short link',
    b: `<p>A short link is a redirect. When you tap <strong>an EliteURL link</strong>, our server looks up the code, checks that the link is active and safe, then sends you to the original address.</p>
        <p>The sponsored blocks on this page are what pay for the service — they are how the person who created the link earns, and how EliteURL stays free for everyone.</p>
        <div class="cards"><div class="mini"><b>Safe by default</b><p>Destinations are screened before a link is created.</p></div>
        <div class="mini"><b>No sign-up needed</b><p>You never need an account to reach a destination.</p></div>
        <div class="mini"><b>No personal data</b><p>We never ask for a password or card number.</p></div></div>` },
  { h: 'How to stay safe with shortened links',
    b: `<ul><li><strong>Check the destination domain</strong> before you continue.</li>
        <li><strong>Never enter a password</strong> on a page reached through a short link.</li>
        <li><strong>Ignore “download ready” buttons</strong> that are really ads.</li>
        <li><strong>Close pop-ups</strong> using the small ✕, not the big colourful button.</li>
        <li><strong>Report suspicious links</strong> to our abuse address.</li></ul>
        <div class="callout"><strong>Good to know:</strong> a view only counts when a real person completes the steps. Automated traffic, VPNs and duplicate visits are filtered out, so honest creators are never penalised.</div>` },
  { h: 'Why advertising funds free link shortening',
    b: `<p>Hosting, fraud detection and payment processing all cost money. Instead of charging creators a subscription, EliteURL shows a small number of sponsored placements per page.</p>
        <p>That is the entire business model: advertisers pay for attention, creators keep <strong>95%</strong> of what their links earn, and visitors pay nothing.</p>
        <p>We cap the number of placements per step so the page stays usable, and every sponsored block is clearly labelled.</p>` },
  { h: 'How creators earn on EliteURL',
    b: `<p>Creators keep <strong>95%</strong> of the advertising revenue their links generate. The remaining 5% covers servers, fraud checks and payment processing.</p>
        <ul><li><strong>Minimum payout:</strong> $5</li><li><strong>Methods:</strong> PayPal, UPI and direct bank transfer</li>
        <li><strong>Processing:</strong> reviewed and sent within 12 hours</li></ul>
        <p>Earnings appear as <em>estimated</em> first, then become <em>confirmed</em> after the network reconciles them — usually 30 to 45 days.</p>` },
  { h: 'Why we built this in India',
    b: `<p>India has one of the largest creator economies in the world, but most link monetisation platforms pay out through PayPal or crypto only — both awkward for a creator in Jaipur or Patna.</p>
        <p>EliteURL was built around UPI first. Earnings are denominated in US dollars because advertising is bought globally, and conversion happens at withdrawal.</p>
        <p>Every rupee and dollar that moves through the platform is written to an append-only ledger that can never be edited or deleted.</p>` },
  { h: 'Understanding your link statistics',
    b: `<p>Your dashboard shows four numbers: total clicks, valid views, invalid views and estimated earnings. They are not the same thing.</p>
        <ul><li><strong>Clicks</strong> — every time someone opened your link.</li>
        <li><strong>Valid views</strong> — clicks that passed the fraud checks and completed the steps.</li>
        <li><strong>Invalid views</strong> — bots, VPNs, duplicates and self-clicks.</li></ul>
        <p>Only valid views earn. Showing all four honestly is more useful than hiding the ones that do not pay.</p>` },
  { h: 'Payouts, taxes and records',
    b: `<p>Withdrawals are reviewed manually so every payment can be traced. Each payout carries a transaction reference you can verify with your bank or UPI app.</p>
        <p>Keep your own record of earnings for tax purposes. Depending on your income and jurisdiction, creator earnings may be taxable — speak to a chartered accountant.</p>
        <div class="callout"><strong>Note:</strong> EliteURL does not guarantee any level of income. What you earn depends entirely on your traffic and its geography.</div>` },
];

function renderStep({ sid, n, total, countdown, destHost, zones, stepToken, isLast }) {
  const pct = Math.round((n / total) * 100);
  const fullscreen = zones.filter((z) => (z.format === 'interstitial' || z.format === 'vignette') && z.network !== 'house');
  const house = zones.filter((z) => z.network === 'house');
  const inline = zones.filter((z) => z.format !== 'interstitial' && z.format !== 'vignette' && z.network !== 'house');
  const pool = inline.length ? inline : (house.length ? house : []);

  const adBlock = (i) => {
    const z = pool.length ? pool[i % pool.length] : null;
    const inner = z ? z.snippet : `<div class="ph">Sponsored space</div>`;
    return `<div class="ad"><span class="adlabel">sponsored</span>${inner}</div>`;
  };

  const c1 = STEP_CONTENT[(n - 1) % STEP_CONTENT.length];
  const c2 = STEP_CONTENT[n % STEP_CONTENT.length];
  const c3 = STEP_CONTENT[(n + 1) % STEP_CONTENT.length];

  let dots = '';
  for (let i = 1; i <= total; i++) dots += `<i class="${i <= n ? 'on' : ''}"></i>`;

  const fsAd = fullscreen.length
    ? `<div class="fs" id="fsAd">
         <div class="fs-top"><span class="fs-tag">Sponsored</span><button class="fs-close" id="fsClose" type="button">Close ✕</button></div>
         <div class="fs-body">${fullscreen.map((z) => z.snippet).join('')}</div>
         <div class="fs-foot">This ad keeps link shortening free. Close it to continue.</div>
       </div>`
    : '';

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Please wait — EliteURL</title>
<style>
:root{--ink:#0b0d1a;--body:#3f4459;--muted:#5b6076;--accent:#3b3ff2;--green:#16a34a;--line:#e8eaf3;--soft:#f7f8fc}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:var(--ink);-webkit-font-smoothing:antialiased;line-height:1.65;overflow-x:hidden}
.ad{display:block;width:100%;background:#f4f5fa;position:relative;overflow:hidden;line-height:0;min-height:90px}
.ad svg,.ad img,.ad iframe{display:block;width:100%;height:auto;max-width:100%}
.ad .ph{min-height:280px;display:flex;align-items:center;justify-content:center;font-size:13px;color:#a8adc2;letter-spacing:.1em;text-transform:uppercase;font-weight:700}
.adlabel{position:absolute;top:5px;left:6px;font-size:8.5px;letter-spacing:.16em;text-transform:uppercase;color:#98a0b8;font-weight:800;background:rgba(255,255,255,.92);padding:2px 5px;border-radius:3px;line-height:1.4;z-index:2}
.line{padding:22px 16px;text-align:center;font-size:16.5px;line-height:1.55;font-weight:700;background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.line small{display:block;font-size:12.5px;font-weight:600;color:var(--muted);margin-top:5px}
.wrap{max-width:720px;margin:0 auto;padding:0 18px}
.sec{padding:26px 0 10px}
.sec h2{font-size:21px;letter-spacing:-.025em;margin:0 0 10px;font-weight:800}
.sec p{font-size:15px;color:var(--body);margin:0 0 14px}
.sec ul{padding-left:20px;margin:0 0 14px}
.sec li{font-size:15px;color:var(--body);margin-bottom:8px}
.callout{background:var(--soft);border-left:3px solid var(--accent);border-radius:0 12px 12px 0;padding:14px 16px;margin:18px 0;font-size:14.5px;color:var(--body)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:18px 0}
.mini{background:#fff;border:1px solid var(--line);border-radius:13px;padding:16px}
.mini b{display:block;font-size:13.5px;margin-bottom:5px}
.mini p{margin:0;font-size:12.5px;color:var(--muted);line-height:1.55}
.bottom{padding:26px 18px 32px;text-align:center;background:#fff;border-top:1px solid var(--line)}
.bottom .stat{font-size:13px;color:var(--muted);margin-bottom:14px;line-height:1.5}
.spinrow{display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;color:var(--muted);margin-bottom:16px}
.spin{width:13px;height:13px;border:2px solid #dfe3ee;border-top-color:var(--accent);border-radius:50%;animation:sp .8s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.bigbtn{display:block;width:100%;max-width:400px;margin:0 auto;padding:20px 22px;font-size:18px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;border:0;border-radius:8px;background:#e3e7f2;color:#9aa0b8;cursor:not-allowed;font-family:inherit;transition:.18s}
.bigbtn.on{background:var(--green);color:#fff;cursor:pointer;box-shadow:0 12px 26px -14px rgba(22,163,74,.95)}
.bigbtn.on:hover{background:#12833b}
.foot{padding:16px;text-align:center;font-size:11px;color:#9aa0b8;border-top:1px solid var(--line);line-height:1.6}
.foot a{color:#9aa0b8;text-decoration:none;margin:0 7px}
.dots{display:flex;justify-content:center;gap:6px;margin-bottom:8px}
.dots i{width:6px;height:6px;border-radius:50%;background:#d9dcea;display:block;transition:.2s}
.dots i.on{background:var(--accent)}
.fs{position:fixed;inset:0;z-index:9999;background:#fff;display:flex;flex-direction:column}
.fs-top{display:flex;align-items:center;justify-content:space-between;padding:11px 16px;border-bottom:1px solid var(--line)}
.fs-tag{font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:#a2a6bd;font-weight:800}
.fs-close{background:#f1f2f8;border:0;border-radius:99px;padding:9px 17px;font-size:13px;font-weight:700;color:var(--ink);cursor:pointer;font-family:inherit}
.fs-body{flex:1;display:flex;align-items:center;justify-content:center;padding:8px;overflow:auto}
.fs-foot{padding:11px 16px 16px;text-align:center;font-size:11.5px;color:var(--muted);border-top:1px solid var(--line)}
</style></head><body>

${adBlock(0)}

<div class="line">
  Please wait 👆 while we prepare your link 👆
  <small>The page continues automatically in ${countdown} seconds</small>
</div>

${adBlock(1)}

<div class="wrap"><div class="sec"><h2>${c1.h}</h2>${c1.b}</div></div>

${adBlock(2)}

<div class="wrap"><div class="sec"><h2>${c2.h}</h2>${c2.b}</div></div>

${adBlock(3)}

<div class="wrap"><div class="sec"><h2>${c3.h}</h2>${c3.b}</div></div>

${adBlock(4)}

<div class="bottom">
  <div class="stat">Step ${n} of ${total} — your link will be ready in a moment.</div>
  <div class="spinrow" id="spinrow"><span class="spin"></span> Preparing your link</div>
  <button class="bigbtn" id="go">Please wait…</button>
</div>

<div class="foot">
  <div class="dots">${dots}</div>
  <a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/help">Help</a>
  <div style="margin-top:7px">© 2026 EliteURL</div>
</div>

${fsAd}
<script>
(function(){
  var left=${countdown},btn=document.getElementById('go'),timer=null;
  function start(){
    if(timer) return;
    timer=setInterval(function(){
      left--;
      if(left<=0){clearInterval(timer);btn.className='bigbtn on';btn.textContent='Click here';document.getElementById('spinrow').style.display='none';}
    },1000);
  }
  var fs=document.getElementById('fsAd'),fsClose=document.getElementById('fsClose');
  var bottomEl=document.querySelector('.bottom');
  function armWhenVisible(){
    if(!bottomEl || !('IntersectionObserver' in window)){ start(); return; }
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(en){ if(en.isIntersecting){ io.disconnect(); start(); } });
    },{threshold:0.35});
    io.observe(bottomEl);
  }
  if(fs&&fsClose){ fsClose.addEventListener('click',function(){fs.style.display='none';armWhenVisible();}); } else { armWhenVisible(); }
  btn.addEventListener('click',function(){
    if(!btn.classList.contains('on')) return;
    btn.textContent='Loading…';
    fetch('/api/step',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({sid:${JSON.stringify(sid)},n:${n},t:${JSON.stringify(stepToken)}})})
      .then(function(r){return r.json();})
      .then(function(d){ if(d.next){ location.href=d.next; } else { btn.textContent='Click here'; } })
      .catch(function(){ btn.textContent='Click here'; });
  });
})();
</script></body></html>`;
}

function passwordPage(slug, wrong) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Protected link - EliteURL</title>
<style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#f7f8fc;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{background:#fff;border:1px solid #e6e8f2;border-radius:18px;padding:32px 26px;max-width:380px;width:100%;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:#5b6076;font-size:13.5px;margin:0 0 20px;line-height:1.5}
input{width:100%;padding:14px;border:1px solid #e6e8f2;border-radius:11px;font-size:15px;font-family:inherit;outline:none;margin-bottom:12px}
button{width:100%;padding:14px;border:0;border-radius:11px;background:#3b3ff2;color:#fff;font-weight:700;font-size:15px;font-family:inherit;cursor:pointer}
.err{color:#b3261e;font-size:13px;margin-bottom:12px}</style></head><body>
<div class="card"><h1>Protected link</h1><p>This link is password protected. Enter the password to continue.</p>
${wrong ? '<div class="err">Wrong password. Try again.</div>' : ''}
<form method="get" action="/${slug}"><input name="pw" type="password" placeholder="Password" autofocus><button>Unlock</button></form>
</div></body></html>`;
}

function messagePage(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — EliteURL</title>
<style>body{font-family:Inter,system-ui,sans-serif;background:#f7f8fc;color:#0e1020;display:flex;min-height:100vh;
align-items:center;justify-content:center;margin:0;padding:24px}
.b{background:#fff;border:1px solid #e6e8f2;border-radius:18px;padding:32px;max-width:420px;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:#5b6076;font-size:14px;margin:0 0 20px;line-height:1.5}
a{color:#3b3ff2;font-weight:600;text-decoration:none}</style></head>
<body><div class="b"><h1>${title}</h1><p>${body}</p><a href="/">Back to EliteURL</a></div></body></html>`;
}

// ---------- info pages ----------
const INFO_PAGES = {
  '/blog': 'Blog',
  '/blog/how-to-earn-with-link-shortening': 'How to earn with link shortening',
  '/blog/why-indian-creators-need-upi-payouts': 'Why Indian creators need UPI payouts',
  '/blog/staying-safe-with-short-links': 'Staying safe with short links',
  '/help': 'Help Center',
  '/about': 'About',
  '/terms': 'Terms of Service',
  '/privacy': 'Privacy Policy',
  '/contact': 'Contact',
  '/how-it-works': 'How It Works',
  '/earnings': 'Earnings',
};

const INFO_TEXT = {
  '/blog': `<p>Notes on link monetisation, payouts and traffic quality — written for creators in India.</p>
    <h2 style="font-size:18px;margin:22px 0 8px"><a href="/blog/how-to-earn-with-link-shortening" style="color:#3b3ff2;text-decoration:none">How to earn with link shortening</a></h2>
    <p>What actually drives income on a shortener, and why traffic quality matters more than raw clicks.</p>
    <h2 style="font-size:18px;margin:22px 0 8px"><a href="/blog/why-indian-creators-need-upi-payouts" style="color:#3b3ff2;text-decoration:none">Why Indian creators need UPI payouts</a></h2>
    <p>PayPal and crypto leave most Indian creators out. Here is what we changed.</p>
    <h2 style="font-size:18px;margin:22px 0 8px"><a href="/blog/staying-safe-with-short-links" style="color:#3b3ff2;text-decoration:none">Staying safe with short links</a></h2>
    <p>Five habits that keep you safe when a link looks unfamiliar.</p>`,
  '/blog/how-to-earn-with-link-shortening': `<p>Every short link you share creates two kinds of value: an audience that trusts you, and an advertiser willing to pay for their attention. A shortener simply sits between the two.</p>
    <h2>What a view is worth</h2><p>Rates are quoted per thousand views (CPM) and depend almost entirely on the visitor's country. Tier-1 traffic earns several times what Tier-3 traffic does. That is not a policy choice — it is what advertisers bid.</p>
    <h2>Why quality beats volume</h2><p>Networks deduct invalid traffic before paying. Bots, VPNs and duplicate clicks inflate your numbers on paper and reduce them on payout day. Honest traffic earns more per view because it survives reconciliation.</p>
    <h2>What to do first</h2><p>Start with the audience you already have — a WhatsApp group, a Telegram channel, a YouTube description. Ten thousand genuine views will out-earn a hundred thousand automated ones, every month.</p>`,
  '/blog/why-indian-creators-need-upi-payouts': `<p>Most link monetisation platforms pay through PayPal, Payoneer or crypto. For a creator in Jaipur or Patna, that is three extra steps and often a fee.</p>
    <h2>The problem with PayPal</h2><p>Business accounts, withdrawal limits and currency conversion all add friction to a payout that might be twenty dollars.</p>
    <h2>What we built instead</h2><p>EliteURL pays to UPI first, with bank transfer and PayPal as alternatives. Earnings are denominated in US dollars because advertising is bought globally, and conversion happens at withdrawal.</p>
    <h2>Records that hold up</h2><p>Every payout carries a transaction reference, and every credit is written to an append-only ledger that cannot be edited or deleted.</p>`,
  '/blog/staying-safe-with-short-links': `<p>Shortened links are ordinary links. The habit that protects you is simple: check where a link goes before you act on it.</p>
    <h2>Five habits</h2><p>Check the destination domain. Never enter a password on a page you reached from a short link. Ignore "download ready" buttons that are really ads. Close pop-ups with the small cross. Report anything that looks wrong.</p>
    <h2>What a legitimate step looks like</h2><p>A sponsored step should be labelled, should show a timer, and should never hide its continue button or pretend to be a system message.</p>
    <h2>If something looks wrong</h2><p>Write to the abuse address on the site. We remove links that lead to malware or phishing.</p>`,
  '/help': `<p><strong>Getting paid.</strong> Earnings appear as <em>estimated</em> first, then become <em>confirmed</em> once they are reconciled with the advertising network (usually 30–45 days). You can request a withdrawal once your confirmed balance reaches $5. Payouts are reviewed and sent within 12 hours.</p>
    <p><strong>Payout methods.</strong> PayPal, UPI (India) and direct bank transfer. Enter your details in Dashboard → Withdrawals.</p>
    <p><strong>Why are my views not counting?</strong> Views are only counted when a real visitor completes the sponsored steps. Bots, VPNs, proxies, duplicate visits within 24 hours and your own clicks are filtered out.</p>
    <p><strong>Forgot password.</strong> Use the “Forgot password?” link on the sign-in page. A 6-digit code is emailed to you and expires in 10 minutes.</p>
    <p><strong>Still stuck?</strong> Email us and we reply within one business day.</p>`,
  '/about': `<p>EliteURL is a link shortening platform that pays creators for the traffic they generate. We shorten long URLs, show a short sponsored step before the destination, and share the advertising revenue with the person who created the link.</p>
    <p>The platform is operated from India and built for creators who share links on social media, messaging apps and content platforms.</p>`,
  '/how-it-works': `<ol><li><strong>Create a link.</strong> Paste any long URL into your dashboard.</li>
    <li><strong>Share it.</strong> Post the short link wherever your audience is.</li>
    <li><strong>Get paid.</strong> Every verified view earns you a share of the advertising revenue.</li></ol>
    <p>A view is verified only when a real visitor completes the sponsored step and reaches the destination. Duplicate, automated and proxy traffic is not counted.</p>`,
  '/earnings': `<p>Creators keep <strong>80%</strong> of verified advertising revenue. Rates depend on the visitor's country and device, and on the advertising network's current demand.</p>
    <p>Earnings are shown as <em>estimated</em> until they are reconciled against the advertising network's report, typically within 30 to 45 days. Only confirmed earnings can be withdrawn.</p>
    <p>We do not guarantee any level of income. What you earn depends on your traffic.</p>`,
  '/terms': `<p>By using EliteURL you agree to use the service lawfully. The following are prohibited: automated or incentivised traffic, clicking your own links to generate earnings, shortening links to malware, phishing pages, adult content, gambling or pirated material, and any attempt to manipulate view counts.</p>
    <p>Accounts that violate these terms may be suspended and unpaid balances withheld. We may change the service, rates and these terms at any time.</p>`,
  '/privacy': `<p>We collect the information you provide at registration (name, email, password hash) and technical data about visits to your links (hashed IP address, browser type, approximate country, timestamps).</p>
    <p>IP addresses are stored only as irreversible hashes. We do not sell personal data. Data is retained while your account is active and deleted on request.</p>`,
  '/contact': `<p>Support: <a href="mailto:support@eliteofficial.in">support@eliteofficial.in</a></p>
    <p>Abuse reports: <a href="mailto:abuse@eliteofficial.in">abuse@eliteofficial.in</a></p>
    <p>We reply within two business days.</p>`,
};

function infoPage(path) {
  const title = INFO_PAGES[path];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — EliteURL</title>
<style>
:root{--ink:#0e1020;--muted:#5b6076;--accent:#3b3ff2;--line:#e6e8f2;--bg:#f7f8fc}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.65}
header{background:#fff;border-bottom:1px solid var(--line);padding:15px 18px}
.h{max-width:1080px;margin:0 auto;display:flex;justify-content:space-between;align-items:center}
.brand{font-weight:800;letter-spacing:.1em;color:var(--accent);font-size:14px;text-decoration:none}
nav a{color:var(--muted);text-decoration:none;font-size:13px;margin-left:16px}
main{max-width:680px;margin:0 auto;padding:44px 20px 60px}
h1{font-size:30px;letter-spacing:-.02em;margin:0 0 20px}
p,li{font-size:15px;color:#33364a}
a{color:var(--accent)}
footer{border-top:1px solid var(--line);padding:24px;text-align:center;color:var(--muted);font-size:12px}
</style></head><body>
<header><div class="h"><a class="brand" href="/">ELITEURL</a>
<nav><a href="/how-it-works">How it works</a><a href="/earnings">Earnings</a><a href="/login">Sign in</a></nav></div></header>
<main><h1>${title}</h1>${INFO_TEXT[path] || ''}</main>
<footer>© 2026 EliteURL · eliteofficial.in</footer></body></html>`;
}
