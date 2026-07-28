import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { createHmac, timingSafeEqual } from 'crypto';

// Backoffice admin auth (mirror of orders.ts; self-contained). FAILS CLOSED:
// with no ADMIN_SECRET configured, admin operations are refused, not opened.
const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || '';
function isAdmin(req: VercelRequest): boolean {
  if (!ADMIN_SECRET) return false;
  const h = req.headers['authorization'];
  const raw = Array.isArray(h) ? h[0] : h || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  if (!m) return false;
  const [expStr, sig] = m[1].split('.');
  const exp = Number(expStr);
  if (!exp || exp < Date.now() || !sig) return false;
  const expected = createHmac('sha256', ADMIN_SECRET).update(`admin.${exp}`).digest('base64url');
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
function requireAdmin(req: VercelRequest, res: VercelResponse): boolean {
  if (!ADMIN_SECRET) {
    res.status(503).json({ error: 'El backoffice no está configurado en el servidor (falta ADMIN_PASSWORD).' });
    return false;
  }
  if (isAdmin(req)) return true;
  res.status(401).json({ error: 'Necesitas iniciar sesión como administrador.' });
  return false;
}

// Self-contained. Lazy DB init (see orders.ts).
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
        create table if not exists settings (
          key text primary key, value jsonb not null, updated_at bigint not null)`;
    })().catch((e) => {
      _ready = null;
      throw e;
    });
  }
  return _ready;
}

// The `settings` table is a key/value store (like PrestaShop's ps_configuration).
//  - 'catalog'  → prices + public shop config. The customer configurator loads
//                 this, so it must never hold secrets. PUBLIC on GET.
//  - 'gls'      → GLS courier config. BACKOFFICE ONLY. Its `guid` credential is
//                 additionally write-only (GET returns `hasGuid`, never the value).
//  - 'coupons'  → coupon definitions. BACKOFFICE ONLY: reading them publicly
//                 would hand out every discount code in the shop. Customers
//                 validate a code they already know via /api/orders?coupon=…
const ALLOWED_KEYS = new Set(['catalog', 'gls', 'coupons']);
/** Keys that only the shop may read. */
const PRIVATE_KEYS = new Set(['gls', 'coupons']);
function keyOf(req: VercelRequest): string {
  const k = Array.isArray(req.query.key) ? req.query.key[0] : req.query.key;
  return k && ALLOWED_KEYS.has(k) ? k : 'catalog';
}

/** Shared admin settings so every device sees the same shop. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await ensureSchema();
    const sql = db();
    const key = keyOf(req);

    if (req.method === 'GET') {
      if (PRIVATE_KEYS.has(key) && !requireAdmin(req, res)) return;
      const rows = (await sql`select value from settings where key = ${key}`) as { value: unknown }[];
      let value = rows[0]?.value ?? null;
      // Never expose the GLS credential to the browser.
      if (key === 'gls' && value && typeof value === 'object') {
        const { guid, ...rest } = value as Record<string, unknown>;
        value = { ...rest, hasGuid: typeof guid === 'string' && guid.trim().length > 0 };
      }
      return res.status(200).json(value);
    }

    if (req.method === 'PUT') {
      if (!requireAdmin(req, res)) return; // saving settings is admin-only
      const body = req.body;
      if (!body || typeof body !== 'object') return res.status(400).json({ error: 'datos inválidos' });

      let toStore: unknown = body;
      if (key === 'gls') {
        // Preserve the stored guid unless a new, non-empty one is provided; strip
        // the transient `hasGuid` flag the GET added.
        const prevRows = (await sql`select value from settings where key = 'gls'`) as { value: Record<string, unknown> }[];
        const prevGuid = typeof prevRows[0]?.value?.guid === 'string' ? (prevRows[0].value.guid as string) : '';
        const incoming = { ...(body as Record<string, unknown>) };
        const newGuid = typeof incoming.guid === 'string' ? incoming.guid.trim() : '';
        delete incoming.hasGuid;
        incoming.guid = newGuid || prevGuid;
        toStore = incoming;
      }

      await sql`
        insert into settings (key, value, updated_at)
        values (${key}, ${JSON.stringify(toStore)}::jsonb, ${Date.now()})
        on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('[catalog]', e);
    return res.status(500).json({ error: 'Error del servidor al leer/guardar la configuración.' });
  }
}
