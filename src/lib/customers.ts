import { API_BASE } from './api';

/** Current version of the privacy policy the customer consents to. Bump it when
 *  the policy text changes so we record which version each customer accepted. */
export const PRIVACY_POLICY_VERSION = '1.0';

export interface CustomerData {
  nombre: string;
  apellidos: string;
  email: string;
  telefono: string;
}

/** Create (or update) the customer account. Requires a backend; returns the id. */
export async function registerCustomer(data: CustomerData): Promise<string | undefined> {
  const res = await fetch(`${API_BASE ?? ''}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, consent: true, policyVersion: PRIVACY_POLICY_VERSION }),
  });
  const out = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok) throw new Error(out.error || `Error ${res.status}`);
  return out.id;
}
