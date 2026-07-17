import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureSchema, sql } from './_db';

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
