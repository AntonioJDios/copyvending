import { API_BASE } from './api';
import { getAdminToken } from './adminToken';
import type { ItemAggRow } from './stats';

export interface AggResult {
  totals: { revenue: number; orders: number };
  series: { period: string; revenue: number; orders: number }[];
  bySource: { key: string; revenue: number; count: number }[];
  /** Every month with orders (for the period selector), for the chosen source. */
  allMonths: string[];
}

/** Server-side aggregation over the FULL order history (SQL GROUP BY), so stats
 *  aren't limited to the latest 2000 rows. Admin-only. */
export async function fetchAgg(from: number, to: number, unit: 'day' | 'month', source: string): Promise<AggResult | null> {
  if (!API_BASE) return null;
  const t = getAdminToken();
  const p = new URLSearchParams({ agg: '1', from: String(from), to: String(to), unit, source });
  const res = await fetch(`${API_BASE}/orders?${p.toString()}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) return null;
  return (await res.json()) as AggResult;
}

/** Per-configuration aggregation (unnests the order items in SQL), also over the
 *  full history. Feeds the Configuraciones tab. Admin-only. */
export async function fetchItemAgg(from: number, to: number, source: string): Promise<ItemAggRow[] | null> {
  if (!API_BASE) return null;
  const t = getAdminToken();
  const p = new URLSearchParams({ items: '1', from: String(from), to: String(to), source });
  const res = await fetch(`${API_BASE}/orders?${p.toString()}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) return null;
  const d = (await res.json()) as { rows?: ItemAggRow[] };
  return Array.isArray(d.rows) ? d.rows : [];
}
