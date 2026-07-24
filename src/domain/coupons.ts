// Discount coupons. Definitions live in the `settings` table under key='coupons'
// (managed in the backoffice); usage is DERIVED from the orders table (each order
// stores the coupon it used), so counts/limits are always accurate.

export type CouponType = 'percent' | 'fixed';

export interface Coupon {
  /** Case-insensitive code the customer types (stored uppercase). */
  code: string;
  type: CouponType;
  /** Percent (0–100) when type='percent', euros when type='fixed'. */
  value: number;
  /** Enable/disable from the admin without deleting it. */
  active: boolean;
  /** Minimum products subtotal (€) required to apply. 0 = no minimum. */
  minSubtotal?: number;
  /** Max total uses across all orders. 0 = unlimited. */
  maxUses?: number;
  /** Max uses per customer (by email). 0 = unlimited. */
  maxUsesPerCustomer?: number;
  /** Expiry (ms timestamp). Undefined = never expires. */
  expiresAt?: number;
  createdAt?: number;
}

export const NEW_COUPON: Omit<Coupon, 'code'> = {
  type: 'percent',
  value: 10,
  active: true,
  minSubtotal: 0,
  maxUses: 0,
  maxUsesPerCustomer: 0,
};

/** € discount for a products subtotal (rounded to cents, never above the subtotal). */
export function couponDiscount(c: Pick<Coupon, 'type' | 'value'>, subtotal: number): number {
  const raw = c.type === 'percent' ? subtotal * (Number(c.value) || 0) / 100 : Number(c.value) || 0;
  return Math.max(0, Math.min(Math.round(raw * 100) / 100, subtotal));
}

/** Human label for a coupon's discount (e.g. "10%" or "5,00 €"). */
export function couponLabel(c: Pick<Coupon, 'type' | 'value'>): string {
  return c.type === 'percent' ? `${c.value}%` : `${(Number(c.value) || 0).toFixed(2).replace('.', ',')} €`;
}
