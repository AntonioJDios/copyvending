import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

// Self-contained. Lazy DB init so a missing DATABASE_URL returns a clean JSON
// error instead of crashing the function at import time.
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
        create table if not exists orders (
          id text primary key, created_at bigint not null, source text not null,
          customer jsonb not null, items jsonb not null,
          total double precision not null, status text not null)`;
    })().catch((e) => {
      _ready = null;
      throw e;
    });
  }
  return _ready;
}

interface OrderRow {
  id: string;
  created_at: string | number;
  source: string;
  customer: unknown;
  items: unknown;
  total: string | number;
  status: string;
}
function mapRow(r: OrderRow) {
  return {
    id: r.id,
    createdAt: Number(r.created_at),
    source: r.source,
    customer: r.customer,
    items: r.items,
    total: Number(r.total),
    status: r.status,
  };
}
function queryId(req: VercelRequest): string | undefined {
  const v = req.query.id;
  return Array.isArray(v) ? v[0] : v;
}

/** Orders backoffice API — shared across devices/browsers via Neon Postgres. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await ensureSchema();
    const sql = db();

    if (req.method === 'GET') {
      const rows = (await sql`
        select id, created_at, source, customer, items, total, status
        from orders order by created_at desc limit 2000`) as OrderRow[];
      return res.status(200).json(rows.map(mapRow));
    }

    if (req.method === 'POST') {
      const o = req.body as {
        id?: string;
        createdAt?: number;
        source?: string;
        customer?: unknown;
        items?: unknown;
        total?: number;
        status?: string;
      };
      if (!o || typeof o.id !== 'string') return res.status(400).json({ error: 'pedido inválido' });
      await sql`
        insert into orders (id, created_at, source, customer, items, total, status)
        values (${o.id}, ${o.createdAt ?? Date.now()}, ${o.source ?? 'mostrador'},
                ${JSON.stringify(o.customer ?? {})}::jsonb, ${JSON.stringify(o.items ?? [])}::jsonb,
                ${o.total ?? 0}, ${o.status ?? 'nuevo'})
        on conflict (id) do nothing`;
      return res.status(201).json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const id = queryId(req);
      const { status } = (req.body ?? {}) as { status?: string };
      if (!id || !status) return res.status(400).json({ error: 'faltan datos' });
      await sql`update orders set status = ${status} where id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = queryId(req);
      if (!id) return res.status(400).json({ error: 'falta id' });
      await sql`delete from orders where id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error de base de datos' });
  }
}
