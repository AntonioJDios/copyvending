import { API_BASE } from './api';
import { getAdminToken } from './adminToken';
import type { Catalog } from '../domain/catalog';
import type { Coupon } from '../domain/coupons';

/**
 * Catalog backup (export / restore).
 *
 * Why this exists: prices live ONLY in the database — there are no default
 * prices in the code to fall back on. That is the right design (one source of
 * truth), but it makes that single row a single point of failure: lose it and
 * the shop can't price anything. This gives the owner a file they control.
 *
 * The file deliberately carries the catalog AND the coupons, which is everything
 * the shop configured by hand. It never contains credentials: the GLS settings
 * are excluded (their guid is write-only server-side and must not travel in a
 * file the owner may email around).
 */

const FORMAT = 'copisteria-backup';
const FORMAT_VERSION = 1;

export interface CatalogBackup {
  format: typeof FORMAT;
  formatVersion: number;
  /** When the backup was taken (ISO, for the humans reading the file). */
  exportedAt: string;
  catalog: Catalog;
  coupons: Coupon[];
}

function authHeaders(): Record<string, string> {
  const t = getAdminToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Read catalog + coupons straight from the server (not the local cache, so the
 *  backup reflects what the shop is really charging). */
export async function fetchBackup(): Promise<CatalogBackup> {
  if (!API_BASE) throw new Error('La copia de seguridad requiere el backend.');
  const [catRes, coupRes] = await Promise.all([
    fetch(`${API_BASE}/catalog`, { headers: authHeaders() }),
    fetch(`${API_BASE}/catalog?key=coupons`, { headers: authHeaders() }),
  ]);
  if (!catRes.ok) throw new Error(`No se pudo leer el catálogo (error ${catRes.status}).`);
  const catalog = (await catRes.json()) as Catalog | null;
  if (!catalog) throw new Error('El servidor no tiene ningún catálogo guardado todavía.');
  // Coupons are admin-only; if they fail we still want the catalog backed up.
  const coupons = coupRes.ok ? (((await coupRes.json()) as Coupon[] | null) ?? []) : [];
  return { format: FORMAT, formatVersion: FORMAT_VERSION, exportedAt: new Date().toISOString(), catalog, coupons };
}

/** Download the backup as a dated .json file. */
export async function downloadBackup(): Promise<string> {
  const backup = await fetchBackup();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const filename = `catalogo-copisteria-${stamp}.json`;
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return filename;
}

export interface ParsedBackup {
  catalog: Catalog;
  coupons: Coupon[];
  exportedAt?: string;
  /** How many priced entries the file carries — shown before restoring. */
  priceCount: number;
}

/** Validate a backup file BEFORE letting anyone restore it. A malformed or
 *  price-less file must never be allowed to overwrite a working catalog. */
export function parseBackup(text: string): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  if (!data || typeof data !== 'object') throw new Error('El archivo no tiene el formato esperado.');
  const b = data as Partial<CatalogBackup>;
  if (b.format !== FORMAT) throw new Error('El archivo no es una copia de seguridad de la copistería.');
  const catalog = b.catalog;
  if (!catalog || typeof catalog !== 'object') throw new Error('La copia no contiene ningún catálogo.');
  if (catalog.version !== 6) throw new Error(`La copia es de una versión de catálogo distinta (v${String(catalog.version)}); no se puede restaurar.`);
  const priceCount = Object.keys(catalog.pagePrices ?? {}).length;
  if (priceCount === 0) throw new Error('La copia no contiene precios; restaurarla dejaría la tienda sin poder cobrar.');
  return {
    catalog,
    coupons: Array.isArray(b.coupons) ? b.coupons : [],
    exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : undefined,
    priceCount,
  };
}

/**
 * Download EVERYTHING in the database as JSON: orders, customers, settings, the
 * file registry and the payment log.
 *
 * The catalogue backup above protects the configuration; this protects the
 * business. It is not a pg_dump (no schema), but it is the copy the owner can take
 * themselves and the one that matters if the database is lost.
 */
export async function downloadDbExport(): Promise<string> {
  if (!API_BASE) throw new Error('Requiere el backend.');
  const res = await fetch(`${API_BASE}/orders?export=1`, { headers: authHeaders() });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `Error ${res.status}`);
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const filename = `copia-completa-${stamp}.json`;
  const blob = new Blob([JSON.stringify(await res.json(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return filename;
}

/** Write a validated backup back to the server (catalog + coupons). */
export async function restoreBackup(parsed: ParsedBackup): Promise<void> {
  if (!API_BASE) throw new Error('Restaurar requiere el backend.');
  const put = async (path: string, body: unknown) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error || `Error ${res.status} al guardar ${path}`);
    }
  };
  await put('/catalog', parsed.catalog);
  await put('/catalog?key=coupons', parsed.coupons);
}
