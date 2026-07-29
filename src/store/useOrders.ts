import { create } from 'zustand';
import type { CartProject } from './useCart';
import type { Address } from './useAuth';
import { API_BASE, apiGet, apiSend } from '../lib/api';

export type OrderStatus = 'nuevo' | 'en_proceso' | 'listo' | 'entregado';
/** Where the order came from: kiosk tablet, online web, or email inbox. */
export type OrderSource = 'mostrador' | 'online' | 'email';

export interface Order {
  id: string;
  createdAt: number;
  source: OrderSource;
  customer: { nombre: string; apellidos: string; email?: string; telefono?: string; accountId?: string; billing?: Address; shipping?: Address };
  items: CartProject[];
  total: number;
  status: OrderStatus;
  /** Whether the order has been paid, and how (local/redsys…). Local = pending until paid at the counter. */
  paid?: boolean;
  paymentMethod?: string;
  /** Delivery: 'recoger' (pickup) or 'envio' (home delivery), + its cost. */
  shippingMethod?: string;
  shippingCost?: number;
  /** Shipment tracking (carrier + number, free text) and when it was shipped. */
  tracking?: string;
  shippedAt?: number;
  /** Whether a GLS label PDF is stored server-side for this order. */
  hasLabel?: boolean;
  /** Applied discount coupon (code + € discount), if any. */
  couponCode?: string;
  couponDiscount?: number;
  /** Version of the terms of sale accepted at checkout, and when. Evidence that
   *  the customer was informed of the withdrawal-right exclusion before buying. */
  termsVersion?: string;
  termsAcceptedAt?: number;
  /** When the customer's files were deleted from storage (retention). The order
   *  itself is kept; only the documents are gone. */
  filesPurgedAt?: number;
  /** Payment reconciliation, filled by the Redsys notification: when it was paid,
   *  the bank's authorisation code, the Redsys order reference (what you search for
   *  in their portal) and the amount actually charged, in cents. */
  paidAt?: number;
  paymentAuthCode?: string;
  paymentRef?: string;
  paymentAmountCents?: number;
  /** Set by the server when the client-sent total didn't match the recomputed one. */
  priceMismatch?: boolean;
}

const KEY = 'copisteria/orders/v1';

function loadLocal(): Order[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Order[];
  } catch {
    /* ignore corrupt storage */
  }
  return [];
}
function saveLocal(orders: Order[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(orders));
  } catch {
    /* quota/unavailable — non-fatal for the demo */
  }
}

/** Filters applied server-side (see the list endpoint in api/orders). */
export interface OrderQuery {
  status?: string;
  source?: string;
  q?: string;
  /** Page size. The orders list paginates; screens that still count coupon usage
   *  client-side ask for a big page so they don't silently count one page. */
  limit?: number;
}
/** status × source totals over the whole history, for the filter badges. */
export type OrderCounts = { status: string; source: string; n: number }[];
type Cursor = { at: number; id: string } | null;

interface OrdersState {
  orders: Order[];
  loading: boolean;
  /** Totals from the server, so the badges don't count only the loaded page. */
  counts: OrderCounts;
  /** Cursor for the next page; null when there is nothing more to load. */
  cursor: Cursor;
  /** Filters the loaded list corresponds to. */
  query: OrderQuery;
  /** Load the FIRST page for a set of filters (replaces the list). */
  fetchOrders: (query?: OrderQuery) => Promise<void>;
  /** Load the next page and append it. */
  loadMore: () => Promise<void>;
  addOrder: (order: Order) => Promise<void>;
  setStatus: (id: string, status: OrderStatus) => Promise<void>;
  setPaid: (id: string, paid: boolean, paymentMethod?: string) => Promise<void>;
  markShipped: (id: string, tracking: string) => Promise<void>;
  /** Register a GLS shipment: creates it at GLS, stores tracking + label, emails the customer. */
  generateGls: (id: string) => Promise<{ tracking: string; trackUrl: string }>;
  /** Delete the stored GLS label + tracking so a new one can be generated. */
  deleteGlsLabel: (id: string) => Promise<void>;
  /** Delete this order's files from storage on request (RGPD erasure, or space).
   *  The order itself is kept. */
  purgeFiles: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useOrders = create<OrdersState>()((set, get) => ({
  // With a backend, start empty and let fetchOrders fill it; otherwise localStorage.
  orders: API_BASE ? [] : loadLocal(),
  loading: false,
  counts: [],
  cursor: null,
  query: {},

  fetchOrders: async (query) => {
    if (!API_BASE) return;
    const q = query ?? get().query;
    set({ loading: true, query: q });
    try {
      const p = new URLSearchParams();
      if (q.status) p.set('status', q.status);
      if (q.source) p.set('source', q.source);
      if (q.q) p.set('q', q.q);
      if (q.limit) p.set('limit', String(q.limit));
      const r = await apiGet<{ orders: Order[]; counts: OrderCounts; nextCursor: Cursor }>(`/orders?${p.toString()}`);
      set({ orders: r.orders, counts: r.counts, cursor: r.nextCursor });
    } catch {
      /* keep whatever we had; backoffice shows a stale-but-usable list */
    } finally {
      set({ loading: false });
    }
  },

  loadMore: async () => {
    const { cursor, query, loading, orders } = get();
    if (!API_BASE || !cursor || loading) return;
    set({ loading: true });
    try {
      const p = new URLSearchParams({ before: String(cursor.at), beforeId: cursor.id });
      if (query.status) p.set('status', query.status);
      if (query.source) p.set('source', query.source);
      if (query.q) p.set('q', query.q);
      if (query.limit) p.set('limit', String(query.limit));
      const r = await apiGet<{ orders: Order[]; counts: OrderCounts; nextCursor: Cursor }>(`/orders?${p.toString()}`);
      // Guard against a double click appending the same page twice.
      const known = new Set(orders.map((o) => o.id));
      set({ orders: [...orders, ...r.orders.filter((o) => !known.has(o.id))], cursor: r.nextCursor });
    } catch {
      /* leave the list as it is */
    } finally {
      set({ loading: false });
    }
  },

  addOrder: async (order) => {
    set((s) => ({ orders: [order, ...s.orders] }));
    if (API_BASE) await apiSend('POST', '/orders', order);
    else saveLocal(get().orders);
  },

  setStatus: async (id, status) => {
    set((s) => ({ orders: s.orders.map((o) => (o.id === id ? { ...o, status } : o)) }));
    if (API_BASE) await apiSend('PATCH', `/orders?id=${encodeURIComponent(id)}`, { status });
    else saveLocal(get().orders);
  },

  setPaid: async (id, paid, paymentMethod = 'local') => {
    set((s) => ({ orders: s.orders.map((o) => (o.id === id ? { ...o, paid, paymentMethod } : o)) }));
    if (API_BASE) await apiSend('PATCH', `/orders?id=${encodeURIComponent(id)}`, { paid, paymentMethod });
    else saveLocal(get().orders);
  },

  markShipped: async (id, tracking) => {
    const shippedAt = Date.now();
    set((s) => ({ orders: s.orders.map((o) => (o.id === id ? { ...o, tracking, shippedAt } : o)) }));
    // The PATCH updates the order and (server-side) emails the customer.
    if (API_BASE) await apiSend('PATCH', `/orders?id=${encodeURIComponent(id)}`, { tracking, shipped: true });
    else saveLocal(get().orders);
  },

  generateGls: async (id) => {
    if (!API_BASE) throw new Error('Los envíos GLS requieren el backend.');
    const r = await apiSend<{ tracking: string; shippedAt: number; hasLabel: boolean; trackUrl: string }>(
      'PATCH',
      `/orders?id=${encodeURIComponent(id)}`,
      { generateGls: true }
    );
    set((s) => ({
      orders: s.orders.map((o) => (o.id === id ? { ...o, tracking: r.tracking, shippedAt: r.shippedAt, hasLabel: r.hasLabel } : o)),
    }));
    return { tracking: r.tracking, trackUrl: r.trackUrl };
  },

  deleteGlsLabel: async (id) => {
    if (!API_BASE) throw new Error('Los envíos GLS requieren el backend.');
    await apiSend('PATCH', `/orders?id=${encodeURIComponent(id)}`, { deleteGls: true });
    set((s) => ({
      orders: s.orders.map((o) => (o.id === id ? { ...o, tracking: undefined, shippedAt: undefined, hasLabel: false } : o)),
    }));
  },

  purgeFiles: async (id) => {
    if (!API_BASE) throw new Error('Borrar archivos requiere el backend.');
    await apiSend('PATCH', `/orders?id=${encodeURIComponent(id)}`, { purgeFiles: true });
    set((s) => ({ orders: s.orders.map((o) => (o.id === id ? { ...o, filesPurgedAt: Date.now() } : o)) }));
  },

  remove: async (id) => {
    set((s) => ({ orders: s.orders.filter((o) => o.id !== id) }));
    if (API_BASE) await apiSend('DELETE', `/orders?id=${encodeURIComponent(id)}`);
    else saveLocal(get().orders);
  },
}));
