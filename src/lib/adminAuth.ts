import { API_BASE } from './api';
import { setAdminToken, clearAdminToken } from './adminToken';
import { setCounterToken, clearCounterToken } from './counterToken';

async function authPost<T>(body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(d.error || `Error ${res.status}`);
  return d;
}

/** Whether the server has an admin password configured. NOTE: `false` does NOT
 *  mean "no login needed" — it means the backoffice is unavailable until the
 *  owner sets ADMIN_PASSWORD. Access is never granted by a missing setting. */
export async function adminConfigured(): Promise<boolean> {
  if (!API_BASE) return false;
  try {
    const d = await authPost<{ configured?: boolean }>({ action: 'admin-status' });
    return !!d.configured;
  } catch {
    return false;
  }
}

/** Log in with the shared admin password; stores the token on success. */
export async function adminLogin(password: string): Promise<void> {
  if (!API_BASE) throw new Error('El login de administración requiere el backend.');
  const d = await authPost<{ token?: string }>({ action: 'admin-login', password });
  if (!d.token) throw new Error('El servidor no devolvió un token.');
  setAdminToken(d.token);
}

/** Fired when the user logs out on purpose, so the backoffice gate can go back to
 *  the password form without a full page reload. */
export const ADMIN_LOGGED_OUT = 'admin-logged-out';

export function adminLogout(): void {
  clearAdminToken();
  window.dispatchEvent(new Event(ADMIN_LOGGED_OUT));
}

/** Whether the server has a counter password configured (papelería tablet). */
export async function counterConfigured(): Promise<boolean> {
  if (!API_BASE) return false;
  try {
    const d = await authPost<{ configured?: boolean }>({ action: 'counter-status' });
    return !!d.configured;
  } catch {
    return false;
  }
}

/** Pair this device as the shop counter; stores the counter token on success. */
export async function counterLogin(password: string): Promise<void> {
  if (!API_BASE) throw new Error('El modo mostrador requiere el backend.');
  const d = await authPost<{ token?: string }>({ action: 'counter-login', password });
  if (!d.token) throw new Error('El servidor no devolvió un token.');
  setCounterToken(d.token);
}

export function counterLogout(): void {
  clearCounterToken();
}
