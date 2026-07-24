import { API_BASE } from './api';
import { getAdminToken } from './adminToken';
import type { Coupon } from '../domain/coupons';

/** Load the coupon list (admin). Empty when there's no backend or none defined. */
export async function loadCoupons(): Promise<Coupon[]> {
  if (!API_BASE) return [];
  const res = await fetch(`${API_BASE}/catalog?key=coupons`);
  if (!res.ok) return [];
  const v = (await res.json()) as Coupon[] | null;
  return Array.isArray(v) ? v : [];
}

/** Save the whole coupon list (admin-only; needs the admin token). */
export async function saveCoupons(list: Coupon[]): Promise<void> {
  if (!API_BASE) throw new Error('Guardar cupones requiere el backend.');
  const t = getAdminToken();
  const res = await fetch(`${API_BASE}/catalog?key=coupons`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(list),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `Error ${res.status}`);
  }
}

export interface CouponCheck {
  ok: boolean;
  discount: number;
  code?: string;
  reason?: string;
}

/** Ask the server to validate a code for a given products subtotal (never trusts
 *  the client; the same check re-runs when the order is placed). */
export async function validateCouponRemote(code: string, subtotal: number, email?: string): Promise<CouponCheck> {
  if (!API_BASE) return { ok: false, discount: 0, reason: 'Sin conexión' };
  const params = new URLSearchParams({ coupon: code, subtotal: String(subtotal) });
  if (email) params.set('email', email);
  const res = await fetch(`${API_BASE}/orders?${params.toString()}`);
  if (!res.ok) return { ok: false, discount: 0, reason: `Error ${res.status}` };
  return (await res.json()) as CouponCheck;
}
