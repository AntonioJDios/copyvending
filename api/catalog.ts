import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

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
//  - 'catalog'  → pricing + public shop config. The customer configurator loads
//                 this, so it must never hold secrets.
//  - 'gls'      → GLS courier config (backoffice only). The configurator never
//                 requests it. Its `guid` credential is WRITE-ONLY: it is stored
//                 but never returned by GET (we return `hasGuid` instead), so it
//                 can't leak to the browser.
const ALLOWED_KEYS = new Set(['catalog', 'gls']);
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
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error de base de datos' });
  }
}
