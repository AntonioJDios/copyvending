import { create } from 'zustand';
import { API_BASE } from '../lib/api';

export interface AuthCustomer {
  id: string;
  email: string;
  nombre: string;
  apellidos: string;
  telefono: string | null;
}
export interface MyOrder {
  id: string;
  createdAt: number;
  total: number;
  status: string;
}

const KEY = 'copisteria/session';

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE ?? ''}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data as T;
}

interface AuthState {
  session: string | null;
  customer: AuthCustomer | null;
  ready: boolean; // whether we've attempted to restore the session
  requestLink: (email: string) => Promise<void>;
  verify: (token: string) => Promise<void>;
  restore: () => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  fetchMyOrders: () => Promise<MyOrder[]>;
}

export const useAuth = create<AuthState>()((set, get) => ({
  session: (() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  })(),
  customer: null,
  ready: false,

  requestLink: async (email) => {
    await post({ action: 'request', email });
  },

  verify: async (tk) => {
    const d = await post<{ session: string; customer: AuthCustomer }>({ action: 'verify', token: tk });
    try {
      localStorage.setItem(KEY, d.session);
    } catch {
      /* ignore */
    }
    set({ session: d.session, customer: d.customer, ready: true });
  },

  restore: async () => {
    const s = get().session;
    if (!s) {
      set({ ready: true });
      return;
    }
    try {
      const d = await post<{ customer: AuthCustomer }>({ action: 'me', session: s });
      set({ customer: d.customer, ready: true });
    } catch {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
      set({ session: null, customer: null, ready: true });
    }
  },

  logout: async () => {
    const s = get().session;
    if (s) {
      try {
        await post({ action: 'logout', session: s });
      } catch {
        /* ignore */
      }
    }
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    set({ session: null, customer: null });
  },

  deleteAccount: async () => {
    const s = get().session;
    if (!s) return;
    await post({ action: 'delete', session: s });
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    set({ session: null, customer: null });
  },

  fetchMyOrders: async () => {
    const s = get().session;
    if (!s) return [];
    const d = await post<{ orders: MyOrder[] }>({ action: 'orders', session: s });
    return d.orders;
  },
}));
