import type { Order } from '../store/useOrders';

/** IVA español general. Los precios se guardan CON IVA incluido, así que para la
 *  declaración trimestral hay que desglosar la base y la cuota. */
export const VAT_RATE = 0.21;

/** Split an IVA-included gross amount into taxable base + IVA. */
export function splitVat(gross: number, rate = VAT_RATE): { base: number; vat: number } {
  const base = gross / (1 + rate);
  return { base, vat: gross - base };
}

export interface Bucket {
  key: string;
  revenue: number; // gross, IVA incluido
  count: number;
}

export interface StatsData {
  totals: { orders: number; revenue: number };
  bySource: Bucket[];
  byType: Bucket[];
  byConfig: {
    color: Bucket[];
    size: Bucket[];
    grosor: Bucket[];
    acabado: Bucket[];
    dobleCara: Bucket[];
  };
  /** Combinaciones de papel (tamaño · color · caras · gramaje), sin encuadernación,
   *  lo más pedido de un vistazo. */
  byCombo: Bucket[];
  /** Distribución por nº de copias del proyecto (en rangos). */
  byCopies: Bucket[];
  /** Serie mensual de TODO el histórico (para la tendencia), clave 'YYYY-MM'. */
  monthly: { period: string; revenue: number; orders: number }[];
}

function bump(map: Map<string, Bucket>, key: string, revenue: number): void {
  const b = map.get(key);
  if (b) {
    b.revenue += revenue;
    b.count += 1;
  } else {
    map.set(key, { key, revenue, count: 1 });
  }
}
const sorted = (m: Map<string, Bucket>): Bucket[] => [...m.values()].sort((a, b) => b.revenue - a.revenue);

/** Number of copies bucketed into readable ranges. */
function copiesRange(n: number): string {
  if (n <= 1) return '1 copia';
  if (n <= 5) return '2–5 copias';
  if (n <= 20) return '6–20 copias';
  if (n <= 50) return '21–50 copias';
  return '51+ copias';
}

/** 'YYYY-MM' del pedido en hora local (la del navegador del dueño ≈ Europe/Madrid). */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** 'YYYY-MM-DD' en hora local. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type Unit = 'day' | 'month';
export interface SeriesPoint {
  period: string;
  revenue: number;
  orders: number;
}

/**
 * Evolution series within [from, to] at `unit` (day/month), filtered by source.
 * When the window is bounded it seeds every bucket (zeros) so gaps show as empty
 * bars — a true daily/monthly evolution. For an unbounded window ('todo') it just
 * uses the buckets that have data.
 */
export function seriesBy(orders: Order[], from: number, to: number, unit: Unit, source = 'all'): SeriesPoint[] {
  const key = unit === 'day' ? dayKey : monthKey;
  const map = new Map<string, SeriesPoint>();

  if (to < Number.MAX_SAFE_INTEGER && from > 0) {
    const cur = new Date(from);
    if (unit === 'day') cur.setHours(0, 0, 0, 0);
    else cur.setDate(1);
    while (cur.getTime() <= to) {
      const k = key(cur.getTime());
      if (!map.has(k)) map.set(k, { period: k, revenue: 0, orders: 0 });
      if (unit === 'day') cur.setDate(cur.getDate() + 1);
      else cur.setMonth(cur.getMonth() + 1);
    }
  }

  const scoped = source === 'all' ? orders : orders.filter((o) => o.source === source);
  for (const o of scoped) {
    if (o.createdAt < from || o.createdAt > to) continue;
    const k = key(o.createdAt);
    const b = map.get(k);
    if (b) {
      b.revenue += o.total;
      b.orders += 1;
    } else {
      map.set(k, { period: k, revenue: o.total, orders: 1 });
    }
  }
  return [...map.values()].sort((a, b) => a.period.localeCompare(b.period));
}

// ── Coupons ─────────────────────────────────────────────────────────
export interface CouponRow {
  code: string;
  uses: number;
  /** Total € given away by this coupon. */
  discount: number;
  /** Gross revenue (IVA incl.) of the orders that used it. */
  revenue: number;
  /** Average order value for orders using it (revenue / uses). */
  avgOrder: number;
  /** Per-month breakdown, keyed 'YYYY-MM'. */
  byMonth: Record<string, { uses: number; discount: number }>;
}
export interface CouponAnalytics {
  /** Month keys in the window (chronological) — columns for the matrix + chart. */
  months: string[];
  rows: CouponRow[];
  totals: { uses: number; discount: number; revenue: number; ordersWithCoupon: number; ordersTotal: number };
  /** Overall series for the evolution chart. */
  monthly: { period: string; uses: number; discount: number }[];
}

/** Coupon usage over the last `monthsBack` months (by source). Uses are counted
 *  from the orders that stored each code, so the numbers match reality. */
export function couponAnalytics(orders: Order[], monthsBack: number, source = 'all'): CouponAnalytics {
  const scoped = source === 'all' ? orders : orders.filter((o) => o.source === source);
  const now = new Date();
  const months: string[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    months.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1).getTime()));
  }
  const windowStart = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1).getTime();

  const rowMap = new Map<string, CouponRow>();
  const monthly = months.map((period) => ({ period, uses: 0, discount: 0 }));
  const monthlyIdx = new Map(monthly.map((m) => [m.period, m]));
  const totals = { uses: 0, discount: 0, revenue: 0, ordersWithCoupon: 0, ordersTotal: 0 };

  for (const o of scoped) {
    if (o.createdAt < windowStart) continue;
    totals.ordersTotal += 1;
    const code = (o.couponCode ?? '').trim().toUpperCase();
    if (!code) continue;
    const disc = Number(o.couponDiscount) || 0;
    const rev = Number(o.total) || 0;
    const mk = monthKey(o.createdAt);
    let row = rowMap.get(code);
    if (!row) {
      row = { code, uses: 0, discount: 0, revenue: 0, avgOrder: 0, byMonth: {} };
      rowMap.set(code, row);
    }
    row.uses += 1;
    row.discount += disc;
    row.revenue += rev;
    const bm = row.byMonth[mk] ?? { uses: 0, discount: 0 };
    bm.uses += 1;
    bm.discount += disc;
    row.byMonth[mk] = bm;
    const mm = monthlyIdx.get(mk);
    if (mm) { mm.uses += 1; mm.discount += disc; }
    totals.uses += 1;
    totals.discount += disc;
    totals.revenue += rev;
  }
  totals.ordersWithCoupon = totals.uses;
  const rows = [...rowMap.values()]
    .map((r) => ({ ...r, avgOrder: r.uses > 0 ? r.revenue / r.uses : 0 }))
    .sort((a, b) => b.uses - a.uses);
  return { months, rows, totals, monthly };
}

/**
 * Aggregate orders into the dashboard model. Breakdowns are scoped to
 * [fromMs, toMs]; the monthly series always spans the whole list (for the trend).
 * Revenue is gross (IVA incluido); item-level totals come pre-computed on each
 * project (`item.total`).
 */
export function aggregate(orders: Order[], fromMs: number, toMs: number, source = 'all'): StatsData {
  const scoped = source === 'all' ? orders : orders.filter((o) => o.source === source);
  const inRange = scoped.filter((o) => o.createdAt >= fromMs && o.createdAt <= toMs);

  const bySource = new Map<string, Bucket>();
  const byType = new Map<string, Bucket>();
  const color = new Map<string, Bucket>();
  const size = new Map<string, Bucket>();
  const grosor = new Map<string, Bucket>();
  const acabado = new Map<string, Bucket>();
  const dobleCara = new Map<string, Bucket>();
  const combo = new Map<string, Bucket>();
  const copies = new Map<string, Bucket>();

  let revenue = 0;
  for (const o of inRange) {
    revenue += o.total;
    bump(bySource, o.source, o.total);
    for (const it of o.items) {
      const t = Number(it.total) || 0;
      bump(byType, it.kind, t);
      if (it.kind === 'copias') {
        const c = it.config;
        bump(color, c.color, t);
        bump(size, c.size, t);
        bump(grosor, String(c.grosor), t);
        bump(acabado, c.acabado, t);
        bump(dobleCara, c.dobleCara, t);
        // Combinación de papel: tamaño · color · caras · gramaje (SIN encuadernación).
        const label = `${c.size} · ${c.color === 'BN' ? 'B/N' : 'Color'} · ${c.dobleCara === '1' ? '2 caras' : '1 cara'} · ${c.grosor}g`;
        bump(combo, label, t);
        bump(copies, copiesRange(Number(it.copias) || 1), t);
      }
    }
  }

  const monthMap = new Map<string, { period: string; revenue: number; orders: number }>();
  for (const o of scoped) {
    const k = monthKey(o.createdAt);
    const m = monthMap.get(k);
    if (m) {
      m.revenue += o.total;
      m.orders += 1;
    } else {
      monthMap.set(k, { period: k, revenue: o.total, orders: 1 });
    }
  }
  const monthly = [...monthMap.values()].sort((a, b) => a.period.localeCompare(b.period));

  return {
    totals: { orders: inRange.length, revenue },
    bySource: sorted(bySource),
    byType: sorted(byType),
    byConfig: {
      color: sorted(color),
      size: sorted(size),
      grosor: sorted(grosor),
      acabado: sorted(acabado),
      dobleCara: sorted(dobleCara),
    },
    byCombo: sorted(combo),
    byCopies: sorted(copies),
    monthly,
  };
}
