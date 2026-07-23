import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

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
        returning id`) as { id: string }[];
      return res.status(200).json({ ok: true, id: rows[0]?.id });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error de base de datos' });
  }
}
