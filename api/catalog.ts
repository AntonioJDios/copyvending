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

/** Shared admin settings (catalog / prices) so every device sees the same shop. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await ensureSchema();
    const sql = db();

    if (req.method === 'GET') {
      const rows = (await sql`select value from settings where key = 'catalog'`) as { value: unknown }[];
      return res.status(200).json(rows[0]?.value ?? null);
    }

    if (req.method === 'PUT') {
      const catalog = req.body;
      if (!catalog || typeof catalog !== 'object') return res.status(400).json({ error: 'catálogo inválido' });
      await sql`
        insert into settings (key, value, updated_at)
        values ('catalog', ${JSON.stringify(catalog)}::jsonb, ${Date.now()})
        on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error de base de datos' });
  }
}
