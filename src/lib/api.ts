// Single place that knows whether a real backend is wired.
//
// VITE_API_BASE (e.g. "/api" on Vercel) turns on server mode: uploads are
// signed by /api/presign and stored in R2, orders live in Neon, and the admin
// catalog is shared. Without it, the app falls back to fully local storage
// (IndexedDB + localStorage) so the UI still runs offline / as a demo.
//
// VITE_UPLOAD_API is still read for backwards compatibility (older setups).
const env = import.meta.env as Record<string, string | undefined>;
const raw = env.VITE_API_BASE ?? env.VITE_UPLOAD_API;

export const API_BASE: string | null = raw ? raw.replace(/\/+$/, '') : null;
export const hasBackend = API_BASE !== null;

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiSend<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `${method} ${path} → ${res.status}`);
  }
  return res.json().catch(() => ({})) as Promise<T>;
}
