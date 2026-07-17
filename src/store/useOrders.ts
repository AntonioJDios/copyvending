import { create } from 'zustand';
import type { CartProject } from './useCart';

export type OrderStatus = 'nuevo' | 'en_proceso' | 'listo' | 'entregado';
export type OrderSource = 'mostrador' | 'online';

export interface Order {
  id: string;
  createdAt: number;
  source: OrderSource;
  customer: { nombre: string; apellidos: string; telefono?: string };
  items: CartProject[];
  total: number;
  status: OrderStatus;
}

const KEY = 'copisteria/orders/v1';

function load(): Order[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Order[];
  } catch {
    /* ignore corrupt storage */
  }
  return [];
}
function save(orders: Order[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(orders));
  } catch {
    /* quota/unavailable — non-fatal for the demo */
  }
}

interface OrdersState {
  orders: Order[];
  addOrder: (order: Order) => void;
  setStatus: (id: string, status: OrderStatus) => void;
  remove: (id: string) => void;
}

export const useOrders = create<OrdersState>()((set) => ({
  orders: load(),
  addOrder: (order) =>
    set((s) => {
      const orders = [order, ...s.orders];
      save(orders);
      return { orders };
    }),
  setStatus: (id, status) =>
    set((s) => {
      const orders = s.orders.map((o) => (o.id === id ? { ...o, status } : o));
      save(orders);
      return { orders };
    }),
  remove: (id) =>
    set((s) => {
      const orders = s.orders.filter((o) => o.id !== id);
      save(orders);
      return { orders };
    }),
}));
