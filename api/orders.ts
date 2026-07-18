import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { projectTotal, type PricedProject } from '../src/domain/orderTotal';
import { DEFAULT_CATALOG, type Catalog } from '../src/domain/catalog';
import type { Configuracion } from '../src/domain/types';

// Self-contained (no api/ relative imports). Lazy DB init.
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
      // Server flags when the client-sent total didn't match the recomputed one.
      await db()`alter table orders add column if not exists price_mismatch boolean default false`;
    })().catch((e) => {
      _ready = null;
      throw e;
    });
  }
  return _ready;
}

/** Prices always come from the admin-edited catalog persisted in Neon. */
async function getCatalog(): Promise<Catalog> {
  try {
    const rows = (await db()`select value from settings where key = 'catalog'`) as { value: unknown }[];
    const c = rows[0]?.value as Catalog | undefined;
    if (c && c.version === 6) return c;
  } catch {
    /* settings table may not exist yet → defaults */
  }
  return DEFAULT_CATALOG;
}

/** Map a stored/received cart item to the structural shape the pricer needs. */
function toPriced(item: Record<string, unknown>): PricedProject {
  const kind = item.kind;
  if (kind === 'taza' || kind === 'chapa') {
    return { kind, cantidad: Number(item.cantidad) || 1 } as PricedProject;
  }
  const docs = Array.isArray(item.docs) ? (item.docs as Record<string, unknown>[]) : [];
  return {
    kind: 'copias',
    config: item.config as Configuracion,
    docs: docs.map((d) => ({ pages: Number(d.pages) || 0, color: (d.color as 'no' | 'cover' | 'all') || 'no' })),
    copias: Number(item.copias) || 1,
  };
}

interface OrderRow {
  id: string;
  created_at: string | number;
  source: string;
  customer: unknown;
  items: unknown;
  total: string | number;
  status: string;
  price_mismatch?: boolean;
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
    priceMismatch: !!r.price_mismatch,
  };
}
function queryId(req: VercelRequest): string | undefined {
  const v = req.query.id;
  return Array.isArray(v) ? v[0] : v;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await ensureSchema();
    const sql = db();

    if (req.method === 'GET') {
      const id = queryId(req);
      if (id) {
        // Lookup by order code (kiosk "recover my order").
        const rows = (await sql`
          select id, created_at, source, customer, items, total, status, price_mismatch
          from orders where id = ${id}`) as OrderRow[];
        if (rows.length === 0) return res.status(404).json({ error: 'pedido no encontrado' });
        return res.status(200).json(mapRow(rows[0]));
      }
      const rows = (await sql`
        select id, created_at, source, customer, items, total, status, price_mismatch
        from orders order by created_at desc limit 2000`) as OrderRow[];
      return res.status(200).json(rows.map(mapRow));
    }

    if (req.method === 'POST') {
      const o = req.body as {
        id?: string;
        createdAt?: number;
        source?: string;
        customer?: unknown;
        items?: Record<string, unknown>[];
        total?: number;
        status?: string;
      };
      if (!o || typeof o.id !== 'string') return res.status(400).json({ error: 'pedido inválido' });

      // Anti-fraud: recompute the total server-side with the Neon catalog and
      // rewrite each item's total. The client-sent price is never trusted.
      const catalog = await getCatalog();
      const items = Array.isArray(o.items) ? o.items : [];
      let serverTotal = 0;
      const pricedItems = items.map((it) => {
        const t = projectTotal(toPriced(it), catalog);
        serverTotal += t;
        return { ...it, total: t };
      });
      const clientTotal = Number(o.total) || 0;
      const mismatch = Math.abs(Math.round(clientTotal * 100) - Math.round(serverTotal * 100)) > 0;

      await sql`
        insert into orders (id, created_at, source, customer, items, total, status, price_mismatch)
        values (${o.id}, ${o.createdAt ?? Date.now()}, ${o.source ?? 'mostrador'},
                ${JSON.stringify(o.customer ?? {})}::jsonb, ${JSON.stringify(pricedItems)}::jsonb,
                ${serverTotal}, ${o.status ?? 'nuevo'}, ${mismatch})
        on conflict (id) do nothing`;
      return res.status(201).json({ ok: true, total: serverTotal, priceMismatch: mismatch });
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
