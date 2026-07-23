import { API_BASE } from './api';
import { setAdminToken, clearAdminToken } from './adminToken';

/** Whether the backoffice requires a password (server has ADMIN_PASSWORD set). */
export async function adminStatus(): Promise<boolean> {
  if (!API_BASE) return false;
  const res = await fetch(`${API_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'admin-status' }),
  });
  if (!res.ok) return false;
  const d = (await res.json().catch(() => ({}))) as { enabled?: boolean };
  return !!d.enabled;
}

/** Log in with the shared admin password; stores the token on success. */
export async function adminLogin(password: string): Promise<void> {
  if (!API_BASE) throw new Error('El login de administración requiere el backend.');
  const res = await fetch(`${API_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'admin-login', password }),
  });
  const d = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!res.ok || !d.token) throw new Error(d.error || `Error ${res.status}`);
  setAdminToken(d.token);
}

export function adminLogout(): void {
  clearAdminToken();
}
