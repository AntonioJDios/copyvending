import { API_BASE } from './api';
import { getAdminToken } from './adminToken';
import type { CouponAggRow, ItemAggRow } from './stats';

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

export interface StorageReport {
  totals: { files: number; bytes: number; since: number | null };
  byMonth: { period: string; files: number; bytes: number }[];
  top: { project: string; files: number; bytes: number }[];
}

export interface StoredFile {
  key: string;
  project_id: string;
  size: number;
  at: number;
  /** True when an order references it: deleting it makes that order unprintable. */
  inOrder: boolean;
}

/** Paginated list of stored files, newest first. Admin-only. */
export async function fetchFiles(cursor?: { at: number; key: string } | null): Promise<{ files: StoredFile[]; nextCursor: { at: number; key: string } | null } | null> {
  if (!API_BASE) return null;
  const t = getAdminToken();
  const p = new URLSearchParams({ files: '1' });
  if (cursor) {
    p.set('before', String(cursor.at));
    p.set('beforeKey', cursor.key);
  }
  const res = await fetch(`${API_BASE}/orders?${p.toString()}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) return null;
  return (await res.json()) as { files: StoredFile[]; nextCursor: { at: number; key: string } | null };
}

/** Delete a single stored file. Admin-only. */
export async function deleteStoredFile(key: string): Promise<void> {
  if (!API_BASE) throw new Error('Requiere el backend.');
  const t = getAdminToken();
  const res = await fetch(`${API_BASE}/orders?deleteFile=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `Error ${res.status}`);
  }
}

/** What is stored, how it grows and what it costs. Admin-only. */
export async function fetchStorage(): Promise<StorageReport | null> {
  if (!API_BASE) return null;
  const t = getAdminToken();
  const res = await fetch(`${API_BASE}/orders?storage=1`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) return null;
  return (await res.json()) as StorageReport;
}

/** Run the retention sweeps now (finished orders + files that never became one). */
export async function runPurge(): Promise<{ orders: { orders: number; files: number }; orphans: { deleted: number } } | null> {
  if (!API_BASE) return null;
  const t = getAdminToken();
  const res = await fetch(`${API_BASE}/orders?purge=1`, {
    method: 'POST',
    headers: t ? { Authorization: `Bearer ${t}` } : {},
  });
  if (!res.ok) return null;
  return (await res.json()) as { orders: { orders: number; files: number }; orphans: { deleted: number } };
}

/** Coupon analytics over the whole history in a window. Admin-only. */
export async function fetchCouponAgg(
  from: number,
  to: number,
  source: string,
  opts: { month?: string; code?: string } = {}
): Promise<{ rows: CouponAggRow[]; ordersTotal: number; daily: { period: string; uses: number; discount: number }[] } | null> {
  if (!API_BASE) return null;
  const t = getAdminToken();
  const p = new URLSearchParams({ coupons: '1', from: String(from), to: String(to), source });
  if (opts.month) p.set('month', opts.month);
  if (opts.code) p.set('code', opts.code);
  const res = await fetch(`${API_BASE}/orders?${p.toString()}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) return null;
  return (await res.json()) as { rows: CouponAggRow[]; ordersTotal: number; daily: { period: string; uses: number; discount: number }[] };
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
