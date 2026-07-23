import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import nodemailer from 'nodemailer';
import { randomBytes, randomInt } from 'crypto';

// IMPORTANT: self-contained Vercel function (no imports of values from ../src).
// Passwordless accounts: request a magic link by email, verify it → session.
// Also lists the customer's orders and handles account erasure (RGPD).

const PUBLIC_URL = process.env.PUBLIC_URL || 'https://copyvending.vercel.app';
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_PASS = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const SHOP_NAME = process.env.SHOP_NAME || 'Copistería';

const LOGIN_TTL = 30 * 60 * 1000; // magic link: 30 min
const SESSION_TTL = 60 * 24 * 60 * 60 * 1000; // session: 60 days

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
      await db()`
        create table if not exists sessions (
          token text primary key, customer_id text not null, email text not null,
          expires_at bigint not null, created_at bigint not null)`;
      await db()`alter table customers add column if not exists shipping jsonb`;
      await db()`alter table customers add column if not exists billing jsonb`;
      await db()`alter table customers add column if not exists billing_same boolean default true`;
    })().catch((e) => {
      _ready = null;
      throw e;
    });
  }
  return _ready;
}

const token = () => randomBytes(24).toString('hex');
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Keep only known address fields (strings, capped) so we never store junk. */
function cleanAddr(a: unknown): Record<string, string> | null {
  if (!a || typeof a !== 'object') return null;
  const src = a as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of ['nombre', 'nif', 'linea1', 'linea2', 'cp', 'ciudad', 'provincia', 'telefono']) {
    const v = src[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 120);
  }
  return Object.keys(out).length ? out : null;
}

async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!GMAIL_USER || !GMAIL_PASS) throw new Error('Falta configuración de email en el servidor (GMAIL_USER / GMAIL_APP_PASSWORD)');
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
  await t.sendMail({ from: `${SHOP_NAME} <${GMAIL_USER}>`, to, subject, text });
}

interface Customer { id: string; email: string; nombre: string; apellidos: string; telefono: string | null }

async function sessionCustomer(sess: string): Promise<Customer | null> {
  if (!sess) return null;
  const rows = (await db()`
    select c.id, c.email, c.nombre, c.apellidos, c.telefono
    from sessions s join customers c on c.id = s.customer_id
    where s.token = ${sess} and s.expires_at > ${Date.now()}`) as Customer[];
  return rows[0] ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    await ensureSchema();
    const sql = db();
    const body = (req.body ?? {}) as {
      action?: string; email?: string; token?: string; code?: string; session?: string;
      shipping?: unknown; billing?: unknown; billingSame?: boolean;
    };
    const action = body.action;

    // 1) Request a magic link. Always answers ok (no email enumeration).
    if (action === 'request') {
      const email = String(body.email ?? '').trim().toLowerCase();
      if (!isEmail(email)) return res.status(400).json({ error: 'Email no válido' });
      const cust = (await sql`select nombre from customers where email = ${email}`) as { nombre: string }[];
      if (cust[0]) {
        const tk = token();
        const code = String(randomInt(0, 1000000)).padStart(6, '0');
        const now = Date.now();
        await sql`insert into login_tokens (token, code, email, expires_at, used, created_at) values (${tk}, ${code}, ${email}, ${now + LOGIN_TTL}, false, ${now})`;
        const link = `${PUBLIC_URL}/#acceder/${tk}`;
        await sendMail(
          email,
          `Acceso a tu cuenta · ${SHOP_NAME}`,
          `Hola ${cust[0].nombre}:\n\nEntra con este enlace (caduca en 30 minutos):\n${link}\n\nO usa este código para continuar en la web:\n${code}\n\nSi no lo has pedido, ignora este correo.\n\n${SHOP_NAME}`
        );
      }
      return res.status(200).json({ ok: true });
    }

    // 2) Verify a magic link → create a session.
    if (action === 'verify') {
      const tk = String(body.token ?? '');
      const now = Date.now();
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
    if (action === 'verify-code') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const code = String(body.code ?? '').trim();
      const now = Date.now();
      if (!isEmail(email) || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Código no válido' });
      const rows = (await sql`select token, expires_at, used from login_tokens where email = ${email} and code = ${code} order by created_at desc limit 1`) as { token: string; expires_at: number; used: boolean }[];
      const row = rows[0];
      if (!row || row.used || Number(row.expires_at) < now) return res.status(400).json({ error: 'Código no válido o caducado' });
      await sql`update login_tokens set used = true where token = ${row.token}`;
      const cust = (await sql`select id, email, nombre, apellidos, telefono from customers where email = ${email}`) as Customer[];
      if (!cust[0]) return res.status(404).json({ error: 'Cuenta no encontrada' });
      const sess = token();
      await sql`insert into sessions (token, customer_id, email, expires_at, created_at) values (${sess}, ${cust[0].id}, ${cust[0].email}, ${now + SESSION_TTL}, ${now})`;
      return res.status(200).json({ session: sess, customer: cust[0] });
    }

    // 3) Restore session → who am I (incl. addresses).
    if (action === 'me') {
      const c = await sessionCustomer(String(body.session ?? ''));
      if (!c) return res.status(401).json({ error: 'Sesión no válida' });
      const rows = (await sql`select shipping, billing, billing_same from customers where id = ${c.id}`) as { shipping: unknown; billing: unknown; billing_same: boolean }[];
      const a = rows[0];
      return res.status(200).json({
        customer: { ...c, shipping: a?.shipping ?? null, billing: a?.billing ?? null, billingSame: a?.billing_same ?? true },
      });
    }

    // 3b) Save the customer's shipping / billing addresses.
    if (action === 'save-addresses') {
      const c = await sessionCustomer(String(body.session ?? ''));
      if (!c) return res.status(401).json({ error: 'Sesión no válida' });
      const shipping = cleanAddr(body.shipping);
      const billingSame = body.billingSame !== false;
      const billing = billingSame ? shipping : cleanAddr(body.billing);
      await sql`update customers set
          shipping = ${shipping ? JSON.stringify(shipping) : null}::jsonb,
          billing = ${billing ? JSON.stringify(billing) : null}::jsonb,
          billing_same = ${billingSame},
          updated_at = ${Date.now()}
        where id = ${c.id}`;
      return res.status(200).json({ ok: true, shipping, billing, billingSame });
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
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error de autenticación' });
  }
}
