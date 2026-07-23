import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

// IMPORTANT: Vercel Node functions here must be SELF-CONTAINED — importing
// values from ../src (or other api files) breaks the runtime. So the pricing
// math below is a synced copy of src/domain/priceEngine.ts. Keep them in sync;
// both read the SAME admin catalog persisted in Neon, so results match and we
// can validate the price the client sent (anti-fraud).

// ── Fallback pricing values (used only if Neon has no catalog yet) ───
// Mirror of the pricing-relevant fields of DEFAULT_CATALOG.
type ColorOpt = { name: string; extra?: number };
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
  ringColors?: ColorOpt[];
  coverColors?: ColorOpt[];
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
function copiasTotal(c: Cfg, docs: Doc[], copias: number, cat: PriceCatalog, colorAnillas?: string, colorContraportada?: string): number {
  const bindings = c.juntos === 'agrupados' ? (docs.length > 0 ? 1 : 0) : docs.length;
  const noMargins = c.sinMargenes ? cat.noMarginsPrice : 0;
  const docsCost = docs.reduce((s, d) => s + docCost(d, c, cat), 0);
  const bindingCost = ((cat.bindingPrices[c.acabado] ?? 0) + noMargins) * bindings;
  const extraFolios = c.acabado === 'sinencuadernacion' ? 0 : (c.foliosDelante || 0) + (c.foliosDetras || 0);
  const extraCost = extraFolios * cat.extraFolioPrice * bindings;
  let colorExtra = 0;
  if (c.acabado === 'AnillasColores') {
    const ring = cat.ringColors?.find((x) => x.name === colorAnillas);
    const cover = cat.coverColors?.find((x) => x.name === colorContraportada);
    colorExtra = ((ring?.extra ?? 0) + (cover?.extra ?? 0)) * bindings;
  }
  return (docsCost + bindingCost + extraCost + colorExtra) * Math.max(1, copias || 1);
}
function itemTotal(item: Record<string, unknown>, cat: PriceCatalog): number {
  if (item.kind === 'taza') return cat.mugPrice * Math.max(1, Number(item.cantidad) || 1);
  if (item.kind === 'chapa') return cat.badgePrice * Math.max(1, Number(item.cantidad) || 1);
  const docs = Array.isArray(item.docs) ? (item.docs as Record<string, unknown>[]) : [];
  return copiasTotal(
    item.config as Cfg,
    docs.map((d) => ({ pages: Number(d.pages) || 0, color: String(d.color || 'no') })),
    Number(item.copias) || 1,
    cat,
    typeof item.colorAnillas === 'string' ? item.colorAnillas : undefined,
    typeof item.colorContraportada === 'string' ? item.colorContraportada : undefined
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
      await db()`alter table orders add column if not exists paid boolean default false`;
      await db()`alter table orders add column if not exists payment_method text`;
      await db()`alter table orders add column if not exists shipping_method text`;
      await db()`alter table orders add column if not exists shipping_cost double precision default 0`;
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
  paid?: boolean; payment_method?: string | null;
  shipping_method?: string | null; shipping_cost?: string | number | null;
}
function mapRow(r: OrderRow) {
  return {
    id: r.id, createdAt: Number(r.created_at), source: r.source, customer: r.customer,
    items: r.items, total: Number(r.total), status: r.status, priceMismatch: !!r.price_mismatch,
    paid: !!r.paid, paymentMethod: r.payment_method ?? undefined,
    shippingMethod: r.shipping_method ?? undefined, shippingCost: r.shipping_cost != null ? Number(r.shipping_cost) : undefined,
  };
}

/** Shipping zone from a Spanish postal code. Not served: Canarias (35/38).
 *  Baleares 07; rest (incl. Ceuta/Melilla) peninsula. */
function zoneForCP(cp: string): 'peninsula' | 'baleares' | 'noservido' | null {
  const p = (cp || '').trim().slice(0, 2);
  if (!/^\d{2}$/.test(p)) return null;
  if (['35', '38'].includes(p)) return 'noservido';
  if (p === '07') return 'baleares';
  return 'peninsula';
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
          select id, created_at, source, customer, items, total, status, price_mismatch, paid, payment_method, shipping_method, shipping_cost
          from orders where id = ${id}`) as OrderRow[];
        if (rows.length === 0) return res.status(404).json({ error: 'pedido no encontrado' });
        return res.status(200).json(mapRow(rows[0]));
      }
      const rows = (await sql`
        select id, created_at, source, customer, items, total, status, price_mismatch, paid, payment_method, shipping_method, shipping_cost
        from orders order by created_at desc limit 2000`) as OrderRow[];
      return res.status(200).json(rows.map(mapRow));
    }

    if (req.method === 'POST') {
      const o = req.body as {
        id?: string; createdAt?: number; source?: string; customer?: unknown;
        items?: Record<string, unknown>[]; total?: number; status?: string;
        paid?: boolean; paymentMethod?: string; shippingMethod?: string;
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
      const itemsSubtotal = Math.round(serverTotal * 100) / 100;

      // Shipping recomputed here (anti-fraud): zone by CP + free-shipping threshold.
      const ship = (catalog as unknown as { shipping?: { enabled?: boolean; peninsula?: number; baleares?: number; freeThreshold?: number } }).shipping;
      const cust = (o.customer ?? {}) as { shipping?: { cp?: string } };
      let shippingMethod = o.shippingMethod === 'envio' ? 'envio' : 'recoger';
      let shippingCost = 0;
      if (shippingMethod === 'envio') {
        if (!ship?.enabled) return res.status(400).json({ error: 'Los envíos no están disponibles' });
        const zone = zoneForCP(cust.shipping?.cp ?? '');
        if (!zone || zone === 'noservido') return res.status(400).json({ error: 'No realizamos envíos a ese código postal' });
        const base = zone === 'baleares' ? Number(ship.baleares) || 0 : Number(ship.peninsula) || 0;
        const threshold = Number(ship.freeThreshold) || 0;
        shippingCost = threshold > 0 && itemsSubtotal >= threshold ? 0 : base;
      }
      serverTotal = Math.round((itemsSubtotal + shippingCost) * 100) / 100;

      // Email orders intentionally arrive with total 0 (priced here), so a
      // difference there isn't a client mismatch — only flag client sources.
      const mismatch =
        o.source !== 'email' && Math.round((Number(o.total) || 0) * 100) !== Math.round(serverTotal * 100);

      await sql`
        insert into orders (id, created_at, source, customer, items, total, status, price_mismatch, paid, payment_method, shipping_method, shipping_cost)
        values (${o.id}, ${o.createdAt ?? Date.now()}, ${o.source ?? 'mostrador'},
                ${JSON.stringify(o.customer ?? {})}::jsonb, ${JSON.stringify(pricedItems)}::jsonb,
                ${serverTotal}, ${o.status ?? 'nuevo'}, ${mismatch}, ${o.paid ?? false}, ${o.paymentMethod ?? null},
                ${shippingMethod}, ${shippingCost})
        on conflict (id) do nothing`;
      return res.status(201).json({ ok: true, total: serverTotal, priceMismatch: mismatch });
    }

    if (req.method === 'PATCH') {
      const id = queryId(req);
      const body = (req.body ?? {}) as { status?: string; paid?: boolean; paymentMethod?: string };
      if (!id) return res.status(400).json({ error: 'falta id' });
      if (typeof body.status === 'string') await sql`update orders set status = ${body.status} where id = ${id}`;
      if (typeof body.paid === 'boolean') {
        await sql`update orders set paid = ${body.paid}, payment_method = ${body.paymentMethod ?? 'local'} where id = ${id}`;
      }
      return res.status(200).json({ ok: true });
    }

    // Modify an order — ONLY while it is still in the initial state. Accepts
    // either { items } (replace all) or { item } (replace one project by id,
    // keeping the rest — used to edit a single project of a multi-project order).
    if (req.method === 'PUT') {
      const id = queryId(req);
      const body = req.body as { items?: Record<string, unknown>[]; item?: Record<string, unknown> };
      if (!id || (!Array.isArray(body.items) && !body.item)) return res.status(400).json({ error: 'faltan datos' });
      const cur = (await sql`select status, items from orders where id = ${id}`) as { status: string; items: Record<string, unknown>[] }[];
      if (cur.length === 0) return res.status(404).json({ error: 'pedido no encontrado' });
      if (cur[0].status !== 'nuevo') {
        return res.status(409).json({ error: 'El pedido ya está en proceso y no se puede modificar.' });
      }

      let items: Record<string, unknown>[];
      if (body.item) {
        const existing = Array.isArray(cur[0].items) ? cur[0].items : [];
        let found = false;
        items = existing.map((x) => {
          if (x && (x as { id?: unknown }).id === (body.item as { id?: unknown }).id) {
            found = true;
            return body.item as Record<string, unknown>;
          }
          return x;
        });
        if (!found) items.push(body.item);
      } else {
        items = body.items as Record<string, unknown>[];
      }

      const catalog = await getCatalog();
      let serverTotal = 0;
      const priced = items.map((it) => {
        const t = itemTotal(it, catalog);
        serverTotal += t;
        return { ...it, total: t };
      });
      serverTotal = Math.round(serverTotal * 100) / 100;
      await sql`update orders set items = ${JSON.stringify(priced)}::jsonb, total = ${serverTotal} where id = ${id} and status = 'nuevo'`;
      return res.status(200).json({ ok: true, total: serverTotal });
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
