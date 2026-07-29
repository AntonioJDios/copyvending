import { describe, expect, it } from 'vitest';
import { couponAnalytics, monthKey, monthWindow, pivotCouponAgg, type CouponAggRow } from '../src/lib/stats';
import type { Order } from '../src/store/useOrders';

/**
 * Coupon analytics moved from the browser (over the loaded orders) to SQL over the
 * whole history: a statistic computed on a page is not a statistic. These tests
 * pin the pivot AND check it against the original local computation, so the screen
 * keeps meaning the same thing now that the data covers everything.
 */

const thisMonth = monthKey(Date.now());

const row = (over: Partial<CouponAggRow> = {}): CouponAggRow => ({
  code: 'VERANO',
  period: thisMonth,
  uses: 1,
  discount: 2,
  revenue: 20,
  ...over,
});

describe('pivotCouponAgg', () => {
  it('accumulates uses, discount and revenue per coupon', () => {
    const a = pivotCouponAgg([row({ uses: 3, discount: 6, revenue: 60 })], [thisMonth], 10);
    expect(a.rows[0]).toMatchObject({ code: 'VERANO', uses: 3, discount: 6, revenue: 60 });
    expect(a.totals).toMatchObject({ uses: 3, discount: 6, revenue: 60, ordersWithCoupon: 3, ordersTotal: 10 });
  });

  it('computes the average order value from revenue and uses', () => {
    const a = pivotCouponAgg([row({ uses: 4, revenue: 100 })], [thisMonth], 10);
    expect(a.rows[0].avgOrder).toBeCloseTo(25, 10);
  });

  it('sorts coupons by uses, most used first', () => {
    const a = pivotCouponAgg(
      [row({ code: 'A', uses: 1 }), row({ code: 'B', uses: 9 }), row({ code: 'C', uses: 5 })],
      [thisMonth],
      20
    );
    expect(a.rows.map((r) => r.code)).toEqual(['B', 'C', 'A']);
  });

  it('keeps the per-month breakdown and the overall monthly series', () => {
    const prev = monthKey(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).getTime());
    const a = pivotCouponAgg(
      [row({ period: prev, uses: 2, discount: 4 }), row({ period: thisMonth, uses: 1, discount: 3 })],
      [prev, thisMonth],
      10
    );
    expect(a.rows[0].byMonth[prev]).toEqual({ uses: 2, discount: 4 });
    expect(a.monthly).toEqual([
      { period: prev, uses: 2, discount: 4 },
      { period: thisMonth, uses: 1, discount: 3 },
    ]);
  });

  it('seeds every month of the window, including the empty ones', () => {
    const a = pivotCouponAgg([], ['2026-01', '2026-02'], 0);
    expect(a.monthly).toEqual([
      { period: '2026-01', uses: 0, discount: 0 },
      { period: '2026-02', uses: 0, discount: 0 },
    ]);
    expect(a.rows).toEqual([]);
  });

  it('ignores rows outside the window in the series but still counts the totals', () => {
    // The server may return a month the client window doesn't display.
    const a = pivotCouponAgg([row({ period: '1999-01', uses: 2, discount: 5 })], [thisMonth], 5);
    expect(a.monthly).toEqual([{ period: thisMonth, uses: 0, discount: 0 }]);
    expect(a.totals.uses).toBe(2);
  });

  it('normalises the code and skips blank ones', () => {
    const a = pivotCouponAgg([row({ code: ' verano ' }), row({ code: '' })], [thisMonth], 5);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].code).toBe('VERANO');
  });

  it('survives non-numeric figures', () => {
    const a = pivotCouponAgg([row({ uses: NaN, discount: NaN, revenue: NaN })], [thisMonth], 0);
    expect(a.rows[0]).toMatchObject({ uses: 0, discount: 0, revenue: 0, avgOrder: 0 });
  });
});

describe('monthWindow', () => {
  it('returns the requested number of months, ending this month', () => {
    const w = monthWindow(6);
    expect(w.months).toHaveLength(6);
    expect(w.months[5]).toBe(thisMonth);
    expect(w.from).toBeLessThan(w.to);
  });
});

describe('pivotCouponAgg matches the local computation for the same data', () => {
  const order = (code: string, discount: number, total: number): Order =>
    ({
      id: `P-${code}${total}`,
      createdAt: Date.now(),
      source: 'online',
      customer: { nombre: 'A', apellidos: 'B' },
      items: [],
      total,
      status: 'nuevo',
      couponCode: code,
      couponDiscount: discount,
    }) as unknown as Order;

  const orders = [order('VERANO', 2, 20), order('VERANO', 3, 30), order('NAVIDAD', 5, 50)];
  const local = couponAnalytics(orders, 1, 'all');
  // The same thing, as the server would group it.
  const server = pivotCouponAgg(
    [
      row({ code: 'VERANO', uses: 2, discount: 5, revenue: 50 }),
      row({ code: 'NAVIDAD', uses: 1, discount: 5, revenue: 50 }),
    ],
    [thisMonth],
    3
  );

  it('agrees on the totals', () => {
    expect(server.totals).toEqual(local.totals);
  });

  it('agrees on the per-coupon rows', () => {
    expect(server.rows).toEqual(local.rows);
  });

  it('agrees on the monthly series', () => {
    expect(server.monthly).toEqual(local.monthly);
  });
});
