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
  customer: { nombre: string; apellidos: string; email?: string; telefono?: string; accountId?: string; billing?: Address };
  items: CartProject[];
  total: number;
  status: OrderStatus;
  /** Whether the order has been paid, and how (local/redsys…). Local = pending until paid at the counter. */
  paid?: boolean;
  paymentMethod?: string;
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

interface OrdersState {
  orders: Order[];
  loading: boolean;
  /** Reload from the shared backend (no-op in local mode). */
  fetchOrders: () => Promise<void>;
  addOrder: (order: Order) => Promise<void>;
  setStatus: (id: string, status: OrderStatus) => Promise<void>;
  setPaid: (id: string, paid: boolean, paymentMethod?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useOrders = create<OrdersState>()((set, get) => ({
  // With a backend, start empty and let fetchOrders fill it; otherwise localStorage.
  orders: API_BASE ? [] : loadLocal(),
  loading: false,

  fetchOrders: async () => {
    if (!API_BASE) return;
    set({ loading: true });
    try {
      const orders = await apiGet<Order[]>('/orders');
      set({ orders });
    } catch {
      /* keep whatever we had; backoffice shows a stale-but-usable list */
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

  remove: async (id) => {
    set((s) => ({ orders: s.orders.filter((o) => o.id !== id) }));
    if (API_BASE) await apiSend('DELETE', `/orders?id=${encodeURIComponent(id)}`);
    else saveLocal(get().orders);
  },
}));
