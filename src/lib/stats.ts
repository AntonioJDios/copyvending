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

/** 'YYYY-MM' del pedido en hora local (la del navegador del dueño ≈ Europe/Madrid). */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Aggregate orders into the dashboard model. Breakdowns are scoped to
 * [fromMs, toMs]; the monthly series always spans the whole list (for the trend).
 * Revenue is gross (IVA incluido); item-level totals come pre-computed on each
 * project (`item.total`).
 */
export function aggregate(orders: Order[], fromMs: number, toMs: number): StatsData {
  const inRange = orders.filter((o) => o.createdAt >= fromMs && o.createdAt <= toMs);

  const bySource = new Map<string, Bucket>();
  const byType = new Map<string, Bucket>();
  const color = new Map<string, Bucket>();
  const size = new Map<string, Bucket>();
  const grosor = new Map<string, Bucket>();
  const acabado = new Map<string, Bucket>();
  const dobleCara = new Map<string, Bucket>();

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
      }
    }
  }

  const monthMap = new Map<string, { period: string; revenue: number; orders: number }>();
  for (const o of orders) {
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
    monthly,
  };
}
