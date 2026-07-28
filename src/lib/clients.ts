import { apiGet } from './api';
import type { Address } from '../store/useAuth';

// Backoffice customer search (admin-only endpoints in api/orders.ts). The admin
// token is attached automatically by apiGet.

export interface ClientRow {
  id: string;
  email: string;
  nombre: string;
  apellidos: string;
  telefono: string | null;
  addresses: Address[] | null;
  marketing_consent: boolean;
  created_at: number | string;
  orders_count: number;
}

export interface ClientOrder {
  id: string;
  created_at: number | string;
  source: string;
  total: number;
  status: string;
  paid: boolean;
  shipping_method: string | null;
  coupon_code: string | null;
  coupon_discount: number | null;
}

/** Search customers by (partial) email. */
export async function searchCustomers(term: string): Promise<ClientRow[]> {
  const d = await apiGet<{ customers: ClientRow[] }>(`/orders?findCustomer=${encodeURIComponent(term)}`);
  return Array.isArray(d.customers) ? d.customers : [];
}

/** All orders of a given customer email. */
export async function customerOrders(email: string): Promise<ClientOrder[]> {
  const d = await apiGet<{ orders: ClientOrder[] }>(`/orders?customerOrders=${encodeURIComponent(email)}`);
  return Array.isArray(d.orders) ? d.orders : [];
}
