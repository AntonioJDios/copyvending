import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import nodemailer from 'nodemailer';

const PUBLIC_URL = process.env.PUBLIC_URL || 'https://copyvending.vercel.app';
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
  if (!to || !MAIL_FROM) return;
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

  // Legacy fallback: Gmail SMTP. Works, but has a ~500/day cap, signs as Gmail
  // (not as the shop's domain) and does not run on Workers — migrate to a provider.
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!process.env.GMAIL_USER || !pass) throw new Error('Email no configurado en el servidor (MAIL_PROVIDER/MAIL_API_KEY o GMAIL_*)');
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: process.env.GMAIL_USER, pass } });
  await t.sendMail({
    from: `${MAIL_FROM_NAME} <${process.env.GMAIL_USER}>`,
    to,
    subject,
    text,
    ...(MAIL_REPLY_TO ? { replyTo: MAIL_REPLY_TO } : {}),
    ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo, references: opts.inReplyTo } : {}),
  });
}

async function sendWelcome(to: string, nombre: string): Promise<void> {
  await sendEmail(
    to,
    `¡Bienvenido a ${SHOP_NAME}!`, `¡Hola ${nombre}!\n\nTu cuenta en ${SHOP_NAME} está lista. Desde tu área personal puedes ver y gestionar tus pedidos:\n${PUBLIC_URL}/#cuenta\n\nCuando quieras entrar, te enviaremos un enlace de acceso a este correo (no necesitas contraseña).\n\nGracias por confiar en nosotros.\n${SHOP_NAME}`
  );
}

// IMPORTANT: self-contained Vercel function (no imports of values from ../src).
// Customer accounts for the shop: minimum personal data + RGPD consent. Used by
// the kiosk/tablet checkout when the customer chooses to create an account
// (guests are not stored here — their data lives only on their order).

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
      await db()`
        create table if not exists customers (
          id text primary key,
          email text unique not null,
          nombre text not null,
          apellidos text not null,
          telefono text,
          privacy_consent boolean not null default false,
          consent_at bigint,
          policy_version text,
          created_at bigint not null,
          updated_at bigint not null)`;
    })().catch((e) => {
      _ready = null;
      throw e;
    });
  }
  return _ready;
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const uuid = () => (globalThis.crypto?.randomUUID?.() ?? `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await ensureSchema();
    const sql = db();

    if (req.method === 'POST') {
      const b = (req.body ?? {}) as {
        nombre?: string; apellidos?: string; email?: string; telefono?: string;
        consent?: boolean; policyVersion?: string;
      };
      const nombre = String(b.nombre ?? '').trim();
      const apellidos = String(b.apellidos ?? '').trim();
      const email = String(b.email ?? '').trim().toLowerCase();
      const telefono = String(b.telefono ?? '').trim() || null;
      if (!nombre || !apellidos || !isEmail(email) || !telefono) {
        return res.status(400).json({ error: 'Faltan datos: nombre, apellidos, email y teléfono son obligatorios' });
      }
      if (!b.consent) {
        return res.status(400).json({ error: 'Es necesario aceptar la política de privacidad para crear la cuenta' });
      }
      const now = Date.now();
      const policyVersion = String(b.policyVersion ?? '1.0');
      const rows = (await sql`
        insert into customers (id, email, nombre, apellidos, telefono, privacy_consent, consent_at, policy_version, created_at, updated_at)
        values (${uuid()}, ${email}, ${nombre}, ${apellidos}, ${telefono}, true, ${now}, ${policyVersion}, ${now}, ${now})
        on conflict (email) do update set
          nombre = excluded.nombre,
          apellidos = excluded.apellidos,
          telefono = excluded.telefono,
          privacy_consent = true,
          consent_at = coalesce(customers.consent_at, excluded.consent_at),
          policy_version = excluded.policy_version,
          updated_at = excluded.updated_at
        returning id, (xmax = 0) as inserted`) as { id: string; inserted: boolean }[];

      // Welcome email only on a brand-new account (best-effort; never blocks).
      if (rows[0]?.inserted) {
        try {
          await sendWelcome(email, nombre);
        } catch (e) {
          // Best-effort, but LOGGED: a silently dropped welcome email is
          // indistinguishable from a broken email provider.
          console.error('[email] bienvenida', e);
        }
      }
      return res.status(200).json({ ok: true, id: rows[0]?.id });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error de base de datos' });
  }
}
