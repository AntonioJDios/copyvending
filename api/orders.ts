import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

// IMPORTANT: Vercel Node functions here must be SELF-CONTAINED — importing
// values from ../src (or other api files) breaks the runtime. So the pricing
// math below is a synced copy of src/domain/priceEngine.ts. Keep them in sync;
// both read the SAME admin catalog persisted in Neon, so results match and we
// can validate the price the client sent (anti-fraud).

// ── Fallback pricing values (used only if Neon has no catalog yet) ───
// Mirror of the pricing-relevant fields of DEFAULT_CATALOG.
type PriceCatalog = {
  pagePrices: Record<string, number>;
  bindingPrices: Record<string, number>;
  colorSurcharge: Record<string, number>;
  laminateSurcharge: Record<string, number>;
  coverColorSurcharge: number;
  perforatePrice: number;
  holesPrice: number;
  stickerPrice: number;
  noMarginsPrice: number;
  extraFolioPrice: number;
  mugPrice: number;
  badgePrice: number;
};
const FALLBACK: PriceCatalog = {
  pagePrices: {
    'A3-80-BN-0': 0.07, 'A3-80-BN-1': 0.06, 'A3-80-Color-0': 0.22, 'A3-80-Color-1': 0.2,
    'A3-100-BN-0': 0.1, 'A3-100-BN-1': 0.08, 'A3-100-Color-0': 0.24, 'A3-100-Color-1': 0.22,
    'A3-250-BN-0': 0.4, 'A3-250-Color-0': 0.6,
    'A4-80-BN-0': 0.025, 'A4-80-BN-1': 0.0215, 'A4-80-Color-0': 0.085, 'A4-80-Color-1': 0.08,
    'A4-90-BN-0': 0.04, 'A4-90-BN-1': 0.0319, 'A4-90-Color-0': 0.119, 'A4-90-Color-1': 0.109,
    'A4-100-BN-0': 0.075, 'A4-100-BN-1': 0.05, 'A4-100-Color-0': 0.135, 'A4-100-Color-1': 0.12,
    'A4-120-BN-0': 0.099, 'A4-120-BN-1': 0.079, 'A4-120-Color-0': 0.169, 'A4-120-Color-1': 0.159,
    'A4-160-BN-0': 0.08, 'A4-160-BN-1': 0.07, 'A4-160-Color-0': 0.18, 'A4-160-Color-1': 0.16,
    'A4-250-BN-0': 0.25, 'A4-250-Color-0': 0.4,
    'A5-80-BN-0': 0.026, 'A5-80-BN-1': 0.02, 'A5-80-Color-0': 0.085, 'A5-80-Color-1': 0.08,
    'A5-90-BN-0': 0.04, 'A5-90-BN-1': 0.03, 'A5-90-Color-0': 0.1, 'A5-90-Color-1': 0.09,
    'A5-100-BN-0': 0.05, 'A5-100-BN-1': 0.04, 'A5-100-Color-0': 0.12, 'A5-100-Color-1': 0.11,
    'A5-120-BN-0': 0.06, 'A5-120-BN-1': 0.05, 'A5-120-Color-0': 0.135, 'A5-120-Color-1': 0.12,
    'A5-160-BN-0': 0.08, 'A5-160-BN-1': 0.07, 'A5-160-Color-0': 0.18, 'A5-160-Color-1': 0.16,
    'A5-250-BN-0': 0.15, 'A5-250-Color-0': 0.25,
  },
  bindingPrices: { sinencuadernacion: 0, grapado: 0.05, AnillasColores: 1.99, dos_agujeros: 0.25, cuatro_agujeros: 0.25, perforado: 0 },
  colorSurcharge: { A4: 0.08, A5: 0.08, A3: 0.15 },
  laminateSurcharge: { A4: 0.99, A5: 0.99, A3: 1.5 },
  coverColorSurcharge: 0.3,
  perforatePrice: 0.5,
  holesPrice: 0.1,
  stickerPrice: 0.15,
  noMarginsPrice: 0.8,
  extraFolioPrice: 0.1,
  mugPrice: 9.95,
  badgePrice: 2.5,
};

// ── Pricing (synced copy of src/domain/priceEngine.ts) ───────────────
type Cfg = {
  size: string; color: string; grosor: number; dobleCara: string; paginasPorHoja: number;
  acabado: string; acabadoFolios: string; juntos: string; sinMargenes: boolean;
  foliosDelante: number; foliosDetras: number;
};
type Doc = { pages: number; color: string };
const psides = (pages: number, ppp: number) => Math.ceil(pages / ppp);
const psheets = (pages: number, ppp: number, cara: string) => Math.ceil(psides(pages, ppp) / (1 + Number(cara)));

function docCost(doc: Doc, c: Cfg, cat: PriceCatalog): number {
  const sides = psides(doc.pages, c.paginasPorHoja);
  const sh = psheets(doc.pages, c.paginasPorHoja, c.dobleCara);
  let cost = sides * (cat.pagePrices[`${c.size}-${c.grosor}-${c.color}-${c.dobleCara}`] ?? 0);
  if (c.color === 'BN') {
    if (doc.color === 'all') cost += sides * (cat.colorSurcharge[c.size] ?? 0);
    else if (doc.color === 'cover') cost += cat.coverColorSurcharge;
  }
  if (c.acabadoFolios === 'plastificar') cost += sh * (cat.laminateSurcharge[c.size] ?? 0);
  if (c.acabadoFolios === 'pegatinas') cost += sides * cat.stickerPrice;
  if (c.acabado === 'perforado') cost += cat.perforatePrice;
  if (c.acabado === 'dos_agujeros' || c.acabado === 'cuatro_agujeros') cost += cat.holesPrice;
  return cost;
}
function copiasTotal(c: Cfg, docs: Doc[], copias: number, cat: PriceCatalog): number {
  const bindings = c.juntos === 'agrupados' ? (docs.length > 0 ? 1 : 0) : docs.length;
  const noMargins = c.sinMargenes ? cat.noMarginsPrice : 0;
  const docsCost = docs.reduce((s, d) => s + docCost(d, c, cat), 0);
  const bindingCost = ((cat.bindingPrices[c.acabado] ?? 0) + noMargins) * bindings;
  const extraFolios = c.acabado === 'sinencuadernacion' ? 0 : (c.foliosDelante || 0) + (c.foliosDetras || 0);
  const extraCost = extraFolios * cat.extraFolioPrice * bindings;
  return (docsCost + bindingCost + extraCost) * Math.max(1, copias || 1);
}
function itemTotal(item: Record<string, unknown>, cat: PriceCatalog): number {
  if (item.kind === 'taza') return cat.mugPrice * Math.max(1, Number(item.cantidad) || 1);
  if (item.kind === 'chapa') return cat.badgePrice * Math.max(1, Number(item.cantidad) || 1);
  const docs = Array.isArray(item.docs) ? (item.docs as Record<string, unknown>[]) : [];
  return copiasTotal(
    item.config as Cfg,
    docs.map((d) => ({ pages: Number(d.pages) || 0, color: String(d.color || 'no') })),
    Number(item.copias) || 1,
    cat
  );
}

// ── DB ────────────────────────────────────────────────────────────────
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
      await db()`alter table orders add column if not exists price_mismatch boolean default false`;
    })().catch((e) => {
      _ready = null;
      throw e;
    });
  }
  return _ready;
}
async function getCatalog(): Promise<PriceCatalog> {
  try {
    const rows = (await db()`select value from settings where key = 'catalog'`) as { value: PriceCatalog }[];
    if (rows[0]?.value?.pagePrices) return rows[0].value;
  } catch {
    /* settings table may not exist yet → fallback */
  }
  return FALLBACK;
}

interface OrderRow {
  id: string; created_at: string | number; source: string; customer: unknown;
  items: unknown; total: string | number; status: string; price_mismatch?: boolean;
}
function mapRow(r: OrderRow) {
  return {
    id: r.id, createdAt: Number(r.created_at), source: r.source, customer: r.customer,
    items: r.items, total: Number(r.total), status: r.status, priceMismatch: !!r.price_mismatch,
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
        id?: string; createdAt?: number; source?: string; customer?: unknown;
        items?: Record<string, unknown>[]; total?: number; status?: string;
      };
      if (!o || typeof o.id !== 'string') return res.status(400).json({ error: 'pedido inválido' });

      // Anti-fraud: recompute totals server-side with the Neon catalog; the
      // client-sent price is never trusted.
      const catalog = await getCatalog();
      const items = Array.isArray(o.items) ? o.items : [];
      let serverTotal = 0;
      const pricedItems = items.map((it) => {
        const t = itemTotal(it, catalog);
        serverTotal += t;
        return { ...it, total: t };
      });
      serverTotal = Math.round(serverTotal * 100) / 100;
      // Email orders intentionally arrive with total 0 (priced here), so a
      // difference there isn't a client mismatch — only flag client sources.
      const mismatch =
        o.source !== 'email' && Math.round((Number(o.total) || 0) * 100) !== Math.round(serverTotal * 100);

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
