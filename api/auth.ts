import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import nodemailer from 'nodemailer';
import { randomBytes, randomInt, createHmac, timingSafeEqual } from 'crypto';

// IMPORTANT: self-contained Vercel function (no imports of values from ../src).
// Passwordless accounts: request a magic link by email, verify it → session.
// Also lists the customer's orders and handles account erasure (RGPD).

/**
 * URL pública de ESTE despliegue.
 *
 * Sin dominio fijo de reserva: antes caía a copyvending.vercel.app, y con dos
 * negocios distintos eso significa mandar a los clientes de una tienda a la web de
 * la otra (enlaces de acceso, seguimiento del pedido y vuelta del pago). Si falta
 * la variable, se usa la URL del propio despliegue, que nunca será la del vecino.
 */
const PUBLIC_URL =
  process.env.PUBLIC_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
const SHOP_NAME = process.env.SHOP_NAME || 'Copistería';

// ── Transactional email (provider-agnostic, over HTTP) ───────────────
// Sends through Brevo or Resend depending on MAIL_PROVIDER, and falls back to the
// legacy Gmail SMTP when nothing is configured (so a deploy without the new env
// vars keeps working). See docs/email.md.
//
// HTTP on purpose: SMTP does not work on Cloudflare Workers, so this is also the
// version that survives the migration. Duplicated across the api/ functions that
// send mail because Vercel functions have to be self-contained.
const MAIL_PROVIDER = (process.env.MAIL_PROVIDER || '').toLowerCase();
const MAIL_KEY = process.env.MAIL_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || process.env.GMAIL_USER || '';
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || process.env.SHOP_NAME || 'Copistería';
const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || '';

/** Send a plain-text email. Throws on failure so the caller can log it. */
async function sendEmail(to: string, subject: string, text: string, opts: { inReplyTo?: string } = {}): Promise<void> {
  if (!to) return; // nothing to do without a recipient
  // A missing sender is a MISCONFIGURATION, not a no-op: returning quietly here
  // would mean emails silently never go out, with nothing in the logs to explain it.
  if (!MAIL_FROM) throw new Error('Falta MAIL_FROM (o GMAIL_USER) en el servidor: no hay remitente configurado');
  // Threading headers, so a reply lands in the customer's original conversation.
  const headers = opts.inReplyTo ? { 'In-Reply-To': opts.inReplyTo, References: opts.inReplyTo } : undefined;

  if (MAIL_KEY && (MAIL_PROVIDER === 'brevo' || MAIL_PROVIDER === 'resend')) {
    const brevo = MAIL_PROVIDER === 'brevo';
    const url = brevo ? 'https://api.brevo.com/v3/smtp/email' : 'https://api.resend.com/emails';
    const body = brevo
      ? {
          sender: { email: MAIL_FROM, name: MAIL_FROM_NAME },
          to: [{ email: to }],
          subject,
          textContent: text,
          ...(MAIL_REPLY_TO ? { replyTo: { email: MAIL_REPLY_TO } } : {}),
          ...(headers ? { headers } : {}),
        }
      : {
          from: `${MAIL_FROM_NAME} <${MAIL_FROM}>`,
          to: [to],
          subject,
          text,
          ...(MAIL_REPLY_TO ? { reply_to: MAIL_REPLY_TO } : {}),
          ...(headers ? { headers } : {}),
        };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(brevo ? { 'api-key': MAIL_KEY, accept: 'application/json' } : { Authorization: `Bearer ${MAIL_KEY}` }),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${MAIL_PROVIDER} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }

  // SMTP fallback. Host/port configurable, so this can be the shop's OWN mail
  // hosting (smtp.fotocopiator.es) instead of Gmail: same cost as today and the
  // domain is already authenticated by the host. Fine as a stopgap, but it has
  // undocumented sending limits, gives no bounce tracking, shares the host's IP
  // reputation, and does NOT run on Cloudflare Workers. Defaults to Gmail so the
  // previous configuration keeps working untouched.
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = Number(process.env.SMTP_PORT) || 465;
  const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER || '';
  const smtpPass = (process.env.SMTP_PASSWORD || process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!smtpUser || !smtpPass) throw new Error('Email no configurado en el servidor (MAIL_PROVIDER/MAIL_API_KEY, o SMTP_*/GMAIL_*)');
  const t = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    // 465 = TLS directo; 587 (habitual en hostings españoles) = STARTTLS.
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
  await t.sendMail({
    from: `${MAIL_FROM_NAME} <${MAIL_FROM || smtpUser}>`,
    to,
    subject,
    text,
    ...(MAIL_REPLY_TO ? { replyTo: MAIL_REPLY_TO } : {}),
    ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo, references: opts.inReplyTo } : {}),
  });
}

const LOGIN_TTL = 30 * 60 * 1000; // magic link: 30 min
const SESSION_TTL = 60 * 24 * 60 * 60 * 1000; // session: 60 days
/** Wrong tries allowed on a 6-digit code before it is burnt. A code is only
 *  1 in a million, which is nothing without a cap: an attacker can request a code
 *  for someone else's address and then simply try them all. Five is plenty for a
 *  human mistyping, and leaves brute force with no path (the victim would have to
 *  request a fresh code for every five guesses). */
const MAX_CODE_ATTEMPTS = 5;

// ── Backoffice admin auth (single shared password) ───────────────────
// Stateless signed token so the (self-contained) orders/catalog functions can
// verify it without a DB lookup.
//
// FAILS CLOSED: if ADMIN_PASSWORD is not set on the server, the backoffice is
// not "open", it is *unavailable*. A missing env var must never turn into public
// access to every customer's orders.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_CONFIGURED = !!ADMIN_PASSWORD;
const ADMIN_SECRET = process.env.ADMIN_SECRET || ADMIN_PASSWORD;
const ADMIN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Counter (papelería tablet) auth ──────────────────────────────────
// The shop-floor tablet gets its own password and its own token scope. It is
// what proves an order really was placed at the counter, so the SERVER can pick
// the counter price list instead of trusting a flag sent by the browser
// (/papeleria.html is publicly reachable — anyone could claim to be the shop).
// Without COUNTER_PASSWORD the counter front simply can't authenticate, and
// orders fall back to the online price list (never the cheaper one).
const COUNTER_PASSWORD = process.env.COUNTER_PASSWORD || '';
const COUNTER_CONFIGURED = !!COUNTER_PASSWORD;
const COUNTER_TTL = 180 * 24 * 60 * 60 * 1000; // 180 days (a fixed shop device)

/** Signed, scoped, stateless token: `<expiry>.<hmac>`. The scope is part of the
 *  signed payload, so a counter token can never pass as an admin one. */
const signScoped = (scope: 'admin' | 'counter', exp: number) =>
  createHmac('sha256', ADMIN_SECRET).update(`${scope}.${exp}`).digest('base64url');
const makeToken = (scope: 'admin' | 'counter', ttl: number) => {
  const exp = Date.now() + ttl;
  return `${exp}.${signScoped(scope, exp)}`;
};

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready: Promise<void> | null = null;
function db(): NeonQueryFunction<false, false> {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en el servidor');
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}
function ensureSchema(): Promise<void> {
  if (!_ready) {
    _ready = (async () => {
      // customers is also created by api/customers; repeated DDL is idempotent.
      await db()`
        create table if not exists customers (
          id text primary key, email text unique not null, nombre text not null,
          apellidos text not null, telefono text, privacy_consent boolean not null default false,
          consent_at bigint, policy_version text, created_at bigint not null, updated_at bigint not null)`;
      await db()`
        create table if not exists login_tokens (
          token text primary key, email text not null, expires_at bigint not null,
          used boolean not null default false, created_at bigint not null)`;
      await db()`alter table login_tokens add column if not exists code text`;
      // Failed attempts per code, so a 6-digit code can be burnt before it can be
      // guessed (see MAX_CODE_ATTEMPTS).
      await db()`alter table login_tokens add column if not exists attempts int not null default 0`;
      await db()`
        create table if not exists sessions (
          token text primary key, customer_id text not null, email text not null,
          expires_at bigint not null, created_at bigint not null)`;
      await db()`alter table customers add column if not exists shipping jsonb`;
      await db()`alter table customers add column if not exists billing jsonb`;
      await db()`alter table customers add column if not exists billing_same boolean default true`;
      await db()`alter table customers add column if not exists addresses jsonb`;
    })().catch((e) => {
      _ready = null;
      throw e;
    });
  }
  return _ready;
}

const token = () => randomBytes(24).toString('hex');
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// ── Rate limiting ────────────────────────────────────────────────────
// Serverless functions share no memory, so the counter lives in Neon (fixed
// window, one row per key). Deliberately FAILS OPEN: if the limiter itself is
// broken we let the request through rather than locking the shop out.
let _rlReady: Promise<void> | null = null;
function ensureRateLimitTable(): Promise<void> {
  if (!_rlReady) {
    _rlReady = db()`
      create table if not exists rate_limits (
        k text primary key, window_start bigint not null, hits int not null)`
      .then(() => undefined)
      .catch((e) => {
        _rlReady = null;
        throw e;
      });
  }
  return _rlReady;
}
async function rateLimit(key: string, max: number, windowMs: number): Promise<{ ok: boolean; retryInMin: number }> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const retryInMin = Math.max(1, Math.ceil((windowStart + windowMs - now) / 60000));
  try {
    await ensureRateLimitTable();
    const rows = (await db()`
      insert into rate_limits (k, window_start, hits) values (${key}, ${windowStart}, 1)
      on conflict (k) do update set
        hits = case when rate_limits.window_start = ${windowStart} then rate_limits.hits + 1 else 1 end,
        window_start = ${windowStart}
      returning hits`) as { hits: number }[];
    return { ok: (rows[0]?.hits ?? 1) <= max, retryInMin };
  } catch {
    return { ok: true, retryInMin };
  }
}
/** Best-effort client IP (Vercel sets x-forwarded-for). */
const clientIp = (req: VercelRequest): string => {
  const xf = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xf) ? xf[0] : xf || '';
  return (raw.split(',')[0] || 'unknown').trim().slice(0, 64) || 'unknown';
};

/** Sanitise one address (known fields only, capped). Requires a street line. */
function cleanAddress(a: unknown): Record<string, unknown> | null {
  if (!a || typeof a !== 'object') return null;
  const src = a as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ['id', 'label', 'nombre', 'nif', 'linea1', 'linea2', 'cp', 'ciudad', 'provincia', 'telefono']) {
    const v = src[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 120);
  }
  if (!out.linea1) return null;
  if (!out.id) out.id = randomBytes(6).toString('hex');
  out.defaultShipping = src.defaultShipping === true;
  out.defaultBilling = src.defaultBilling === true;
  return out;
}
/** At most one default of each kind. */
function enforceSingleDefaults(list: Record<string, unknown>[]): void {
  let sh = false;
  let bi = false;
  for (const a of list) {
    if (a.defaultShipping) { if (sh) a.defaultShipping = false; else sh = true; }
    if (a.defaultBilling) { if (bi) a.defaultBilling = false; else bi = true; }
  }
}

const sendMail = (to: string, subject: string, text: string) => sendEmail(to, subject, text);

interface Customer { id: string; email: string; nombre: string; apellidos: string; telefono: string | null }

async function sessionCustomer(sess: string): Promise<Customer | null> {
  if (!sess) return null;
  const rows = (await db()`
    select c.id, c.email, c.nombre, c.apellidos, c.telefono
    from sessions s join customers c on c.id = s.customer_id
    where s.token = ${sess} and s.expires_at > ${Date.now()}`) as Customer[];
  return rows[0] ?? null;
}


/**
 * Record an incident in the shared event log (insert only, no email: api/orders
 * sends these out — see flushPendingAlerts). Best-effort and never throws.
 */
async function logEvent(level: 'error' | 'warn' | 'info', message: string, detail?: unknown): Promise<void> {
  try {
    await db()`
      create table if not exists events (
        id bigserial primary key, at bigint not null, level text not null,
        source text not null, order_id text, message text not null, detail text)`;
    await db()`alter table events add column if not exists alerted boolean not null default false`;
    const d = detail === undefined ? null : String(detail instanceof Error ? detail.message : typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 2000);
    await db()`
      insert into events (at, level, source, order_id, message, detail, alerted)
      values (${Date.now()}, ${level}, 'acceso', null, ${message.slice(0, 300)}, ${d}, false)`;
  } catch (e) {
    console.error('[events] no se pudo registrar', e);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const body = (req.body ?? {}) as {
      action?: string; email?: string; token?: string; code?: string; session?: string;
      addresses?: unknown; password?: string;
    };
    const action = body.action;

    // Backoffice + counter auth (no DB needed).
    // `configured` says whether the server has a password; it NEVER means "come
    // on in". The client always has to log in.
    if (action === 'admin-status') return res.status(200).json({ configured: ADMIN_CONFIGURED });
    if (action === 'counter-status') return res.status(200).json({ configured: COUNTER_CONFIGURED });

    if (action === 'admin-login' || action === 'counter-login') {
      const isCounter = action === 'counter-login';
      const configured = isCounter ? COUNTER_CONFIGURED : ADMIN_CONFIGURED;
      const expected = isCounter ? COUNTER_PASSWORD : ADMIN_PASSWORD;
      if (!configured) {
        return res.status(503).json({
          error: isCounter
            ? 'El modo mostrador no está configurado en el servidor (falta COUNTER_PASSWORD).'
            : 'El backoffice no está configurado en el servidor (falta ADMIN_PASSWORD).',
        });
      }
      // Throttle before checking: a single shared password must not be brute-forceable.
      const gate = await rateLimit(`login:${action}:${clientIp(req)}`, 10, 10 * 60 * 1000);
      if (!gate.ok) return res.status(429).json({ error: `Demasiados intentos. Prueba de nuevo en ${gate.retryInMin} min.` });
      const given = Buffer.from(String(body.password ?? ''));
      const want = Buffer.from(expected);
      const ok = given.length === want.length && timingSafeEqual(given, want);
      if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta.' });
      return res.status(200).json({
        token: isCounter ? makeToken('counter', COUNTER_TTL) : makeToken('admin', ADMIN_TTL),
      });
    }

    await ensureSchema();
    const sql = db();

    // 1) Request a magic link. Always answers ok (no email enumeration).
    if (action === 'request') {
      const email = String(body.email ?? '').trim().toLowerCase();
      if (!isEmail(email)) return res.status(400).json({ error: 'Email no válido' });
      // Don't let anyone use us as a mailer: cap link requests per IP and per address.
      const byIp = await rateLimit(`magic:ip:${clientIp(req)}`, 10, 15 * 60 * 1000);
      const byMail = await rateLimit(`magic:to:${email}`, 5, 15 * 60 * 1000);
      if (!byIp.ok || !byMail.ok) {
        return res.status(429).json({ error: 'Has pedido demasiados enlaces de acceso. Prueba de nuevo en unos minutos.' });
      }
      const cust = (await sql`select nombre from customers where email = ${email}`) as { nombre: string }[];
      if (cust[0]) {
        const tk = token();
        const code = String(randomInt(0, 1000000)).padStart(6, '0');
        const now = Date.now();
        await sql`insert into login_tokens (token, code, email, expires_at, used, created_at) values (${tk}, ${code}, ${email}, ${now + LOGIN_TTL}, false, ${now})`;
        const link = `${PUBLIC_URL}/acceder/${tk}`;
        try {
          await sendMail(
            email,
            `Acceso a tu cuenta · ${SHOP_NAME}`,
            `Hola ${cust[0].nombre}:\n\nEntra con este enlace (caduca en 30 minutos):\n${link}\n\nO usa este código para continuar en la web:\n${code}\n\nSi no lo has pedido, ignora este correo.\n\n${SHOP_NAME}`
          );
        } catch (e) {
          // Sin este correo el cliente no puede entrar en su cuenta. Se lo decimos
          // claro (antes salía un 500 sin explicación) y queda registrado.
          await logEvent('error', 'No se pudo enviar el correo de acceso: hay clientes que no pueden entrar', e);
          return res.status(502).json({
            error: 'No hemos podido enviarte el correo de acceso. Inténtalo en unos minutos o llámanos y te ayudamos.',
          });
        }
      }
      return res.status(200).json({ ok: true });
    }

    // 2) Verify a magic link → create a session.
    if (action === 'verify') {
      const tk = String(body.token ?? '');
      const now = Date.now();
      // The link token is 24 random bytes (not guessable), but cap it anyway so it
      // can't be used to hammer the database.
      const gate = await rateLimit(`verify:${clientIp(req)}`, 30, 15 * 60 * 1000);
      if (!gate.ok) return res.status(429).json({ error: 'Demasiados intentos. Prueba de nuevo en unos minutos.' });
      const rows = (await sql`select email, expires_at, used from login_tokens where token = ${tk}`) as { email: string; expires_at: number; used: boolean }[];
      const row = rows[0];
      if (!row || row.used || Number(row.expires_at) < now) return res.status(400).json({ error: 'Enlace no válido o caducado' });
      await sql`update login_tokens set used = true where token = ${tk}`;
      const cust = (await sql`select id, email, nombre, apellidos, telefono from customers where email = ${row.email}`) as Customer[];
      if (!cust[0]) return res.status(404).json({ error: 'Cuenta no encontrada' });
      const sess = token();
      await sql`insert into sessions (token, customer_id, email, expires_at, created_at) values (${sess}, ${cust[0].id}, ${cust[0].email}, ${now + SESSION_TTL}, ${now})`;
      return res.status(200).json({ session: sess, customer: cust[0] });
    }

    // 2b) Verify a 6-digit code (inline login, e.g. during checkout) → session.
    // Guessing this code is a full account takeover (orders, addresses, deletion),
    // so it is defended twice: a request cap per IP/address, and a per-code attempt
    // counter that burns the code. Only the NEWEST code for the address is valid.
    if (action === 'verify-code') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const code = String(body.code ?? '').trim();
      const now = Date.now();
      if (!isEmail(email) || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Código no válido' });
      const byIp = await rateLimit(`code:ip:${clientIp(req)}`, 20, 15 * 60 * 1000);
      const byMail = await rateLimit(`code:to:${email}`, 10, 15 * 60 * 1000);
      if (!byIp.ok || !byMail.ok) {
        return res.status(429).json({ error: 'Demasiados intentos. Pide un código nuevo en unos minutos.' });
      }
      const rows = (await sql`
        select token, code, expires_at, used, coalesce(attempts, 0) as attempts
        from login_tokens where email = ${email} order by created_at desc limit 1`) as {
        token: string; code: string | null; expires_at: number; used: boolean; attempts: number;
      }[];
      const row = rows[0];
      if (!row || row.used || Number(row.expires_at) < now) return res.status(400).json({ error: 'Código no válido o caducado' });
      if (row.attempts >= MAX_CODE_ATTEMPTS) {
        await sql`update login_tokens set used = true where token = ${row.token}`;
        return res.status(400).json({ error: 'Demasiados intentos con este código. Pide uno nuevo.' });
      }
      if (row.code !== code) {
        // Burn the code once the attempts run out, so a fresh one is required.
        const left = MAX_CODE_ATTEMPTS - (row.attempts + 1);
        await sql`update login_tokens set attempts = attempts + 1, used = ${left <= 0} where token = ${row.token}`;
        return res.status(400).json({
          error: left > 0 ? `Código incorrecto. Te quedan ${left} intentos.` : 'Código incorrecto. Pide uno nuevo.',
        });
      }
      await sql`update login_tokens set used = true where token = ${row.token}`;
      const cust = (await sql`select id, email, nombre, apellidos, telefono from customers where email = ${email}`) as Customer[];
      if (!cust[0]) return res.status(404).json({ error: 'Cuenta no encontrada' });
      const sess = token();
      await sql`insert into sessions (token, customer_id, email, expires_at, created_at) values (${sess}, ${cust[0].id}, ${cust[0].email}, ${now + SESSION_TTL}, ${now})`;
      return res.status(200).json({ session: sess, customer: cust[0] });
    }

    // 3) Restore session → who am I (incl. address list).
    if (action === 'me') {
      const c = await sessionCustomer(String(body.session ?? ''));
      if (!c) return res.status(401).json({ error: 'Sesión no válida' });
      const rows = (await sql`select shipping, billing, billing_same, addresses from customers where id = ${c.id}`) as {
        shipping: unknown; billing: unknown; billing_same: boolean; addresses: unknown;
      }[];
      const a = rows[0];
      let addresses = (Array.isArray(a?.addresses) ? a!.addresses : []).map(cleanAddress).filter(Boolean) as Record<string, unknown>[];
      // Migrate a legacy single shipping/billing to the new list on first read.
      if (addresses.length === 0 && a) {
        const sh = cleanAddress(a.shipping);
        if (sh) { sh.defaultShipping = true; sh.defaultBilling = a.billing_same === true; addresses.push(sh); }
        if (a.billing_same !== true) {
          const bi = cleanAddress(a.billing);
          if (bi) { bi.defaultBilling = true; addresses.push(bi); }
        }
      }
      enforceSingleDefaults(addresses);
      return res.status(200).json({ customer: { ...c, addresses } });
    }

    // 3b) Replace the customer's address list.
    if (action === 'save-addresses') {
      const c = await sessionCustomer(String(body.session ?? ''));
      if (!c) return res.status(401).json({ error: 'Sesión no válida' });
      const arr = Array.isArray(body.addresses) ? body.addresses : [];
      const cleaned = arr.map(cleanAddress).filter(Boolean).slice(0, 20) as Record<string, unknown>[];
      enforceSingleDefaults(cleaned);
      await sql`update customers set addresses = ${JSON.stringify(cleaned)}::jsonb, updated_at = ${Date.now()} where id = ${c.id}`;
      return res.status(200).json({ ok: true, addresses: cleaned });
    }

    // 4) My orders (only mine, by email).
    if (action === 'orders') {
      const c = await sessionCustomer(String(body.session ?? ''));
      if (!c) return res.status(401).json({ error: 'Sesión no válida' });
      const rows = (await sql`
        select id, created_at, total, status, paid from orders
        where customer->>'email' = ${c.email} order by created_at desc limit 100`) as { id: string; created_at: number; total: number; status: string; paid: boolean }[];
      return res.status(200).json({ orders: rows.map((r) => ({ id: r.id, createdAt: Number(r.created_at), total: Number(r.total), status: r.status, paid: !!r.paid })) });
    }

    // 5) Logout.
    if (action === 'logout') {
      await sql`delete from sessions where token = ${String(body.session ?? '')}`;
      return res.status(200).json({ ok: true });
    }

    // 6) Right to erasure (RGPD): delete the account and de-identify past orders
    // (the fiscal record of the sale is kept, but no longer identifies anyone).
    if (action === 'delete') {
      const c = await sessionCustomer(String(body.session ?? ''));
      if (!c) return res.status(401).json({ error: 'Sesión no válida' });
      await sql`update orders set customer = '{"nombre":"Cliente eliminado","apellidos":""}'::jsonb where customer->>'email' = ${c.email}`;
      await sql`delete from sessions where email = ${c.email}`;
      await sql`delete from login_tokens where email = ${c.email}`;
      await sql`delete from customers where email = ${c.email}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'acción no válida' });
  } catch (e) {
    console.error('[auth]', e);
    return res.status(500).json({ error: 'Error del servidor de autenticación.' });
  }
}
