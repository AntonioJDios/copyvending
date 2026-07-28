// Counter (papelería tablet) token storage. Same format as the admin one
// (`<expiryMs>.<signature>`) but a different scope, signed server-side.
//
// This token is what proves to the server that an order really was taken at the
// shop counter, so the counter price list applies. Kept import-free so
// lib/api.ts can read it without a circular dependency.
const KEY = 'copisteria/counter/token';

export function getCounterToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setCounterToken(t: string): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function clearCounterToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** True if a token is stored and hasn't expired (expiry is the first segment). */
export function counterTokenValid(): boolean {
  const t = getCounterToken();
  if (!t) return false;
  const exp = Number(t.split('.')[0]);
  return !!exp && exp > Date.now();
}
