// Admin backoffice token storage (kept import-free so lib/api.ts can read it
// without a circular dependency). The token format is `<expiryMs>.<signature>`.
const KEY = 'copisteria/admin/token';

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(t: string): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function clearAdminToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** True if a token is stored and hasn't expired (expiry is the first segment). */
export function adminTokenValid(): boolean {
  const t = getAdminToken();
  if (!t) return false;
  const exp = Number(t.split('.')[0]);
  return !!exp && exp > Date.now();
}
