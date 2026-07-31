import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { createHmac, timingSafeEqual } from 'crypto';

// Backoffice admin auth (mirror of orders.ts; self-contained). FAILS CLOSED:
// with no ADMIN_SECRET configured, admin operations are refused, not opened.
const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || '';
function isAdmin(req: VercelRequest): boolean {
  if (!ADMIN_SECRET) return false;
  const h = req.headers['authorization'];
  const raw = Array.isArray(h) ? h[0] : h || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  if (!m) return false;
  const [expStr, sig] = m[1].split('.');
  const exp = Number(expStr);
  if (!exp || exp < Date.now() || !sig) return false;
  const expected = createHmac('sha256', ADMIN_SECRET).update(`admin.${exp}`).digest('base64url');
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
function requireAdmin(req: VercelRequest, res: VercelResponse): boolean {
  if (!ADMIN_SECRET) {
    res.status(503).json({ error: 'El backoffice no está configurado en el servidor (falta ADMIN_PASSWORD).' });
    return false;
  }
  if (isAdmin(req)) return true;
  res.status(401).json({ error: 'Necesitas iniciar sesión como administrador.' });
  return false;
}

// Self-contained. Lazy DB init (see orders.ts).
let _sql: NeonQueryFunction<false, false> | null = null;
let _ready: Promise<void> | null = null;

function db(): NeonQueryFunction<false, false> {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en el servidor');
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}
function ensureSchema(): Promise<void> {
  if (!_ready) {
    _ready = (async () => {
      await db()`
        create table if not exists settings (
          key text primary key, value jsonb not null, updated_at bigint not null)`;
    })().catch((e) => {
      _ready = null;
      throw e;
    });
  }
  return _ready;
}

// The `settings` table is a key/value store (like PrestaShop's ps_configuration).
//  - 'catalog'  → prices + public shop config. The customer configurator loads
//                 this, so it must never hold secrets. PUBLIC on GET.
//  - 'gls'      → GLS courier config. BACKOFFICE ONLY. Its `guid` credential is
//                 additionally write-only (GET returns `hasGuid`, never the value).
//  - 'coupons'  → coupon definitions. BACKOFFICE ONLY: reading them publicly
//                 would hand out every discount code in the shop. Customers
//                 validate a code they already know via /api/orders?coupon=…
const ALLOWED_KEYS = new Set(['catalog', 'gls', 'coupons']);
/** Keys that only the shop may read. */
const PRIVATE_KEYS = new Set(['gls', 'coupons']);
function keyOf(req: VercelRequest): string {
  const k = Array.isArray(req.query.key) ? req.query.key[0] : req.query.key;
  return k && ALLOWED_KEYS.has(k) ? k : 'catalog';
}

/**
 * Rutas públicas de la tienda, para el sitemap.
 *
 * Solo lo que un cliente puede visitar y tiene sentido que salga en Google. Fuera
 * quedan el carrito y la cuenta (no aportan y cambian por usuario), el backoffice
 * y la tablet del mostrador.
 */
export function sitemapPaths(catalog: Record<string, unknown> | null): string[] {
  const landing = (catalog?.landing ?? {}) as { showMugs?: boolean; showBadges?: boolean };
  const paths = ['/', '/imprimir'];
  // No se anuncian secciones que la tienda ha apagado.
  if (landing.showMugs !== false) paths.push('/tazas');
  if (landing.showBadges !== false) paths.push('/chapas');
  paths.push('/recoger', '/aviso-legal', '/condiciones', '/privacidad');
  return paths;
}

/** El XML del sitemap, con direcciones absolutas (que es lo único que vale). */
export function sitemapXml(origin: string, paths: string[], lastmod: string): string {
  const url = (p: string) =>
    [
      '  <url>',
      `    <loc>${origin}${p}</loc>`,
      `    <lastmod>${lastmod}</lastmod>`,
      `    <priority>${p === '/' ? '1.0' : '0.7'}</priority>`,
      '  </url>',
    ].join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map(url),
    '</urlset>',
    '',
  ].join('\n');
}

/** Shared admin settings so every device sees the same shop. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await ensureSchema();
    const sql = db();
    const key = keyOf(req);

    /**
     * `/sitemap.xml` (reescrito aquí desde vercel.json).
     *
     * Va dentro de esta función y no en una propia porque el plan gratuito admite
     * 12 y ya vamos por 11. Y se genera en el servidor porque un sitemap necesita
     * direcciones ABSOLUTAS: el dominio cambia en cada despliegue, así que no se
     * puede dejar escrito en un archivo estático del repositorio.
     */
    if (req.method === 'GET' && req.query.sitemap !== undefined) {
      const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
      if (!host) return res.status(500).send('sin host');
      const proto = String(req.headers['x-forwarded-proto'] ?? 'https');
      const rows = (await sql`select value, updated_at from settings where key = 'catalog'`) as {
        value: Record<string, unknown> | null;
        updated_at: number | null;
      }[];
      const lastmod = new Date(Number(rows[0]?.updated_at) || Date.now()).toISOString().slice(0, 10);
      const xml = sitemapXml(`${proto}://${host}`, sitemapPaths(rows[0]?.value ?? null), lastmod);
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(xml);
    }

    if (req.method === 'GET') {
      if (PRIVATE_KEYS.has(key) && !requireAdmin(req, res)) return;
      const rows = (await sql`select value from settings where key = ${key}`) as { value: unknown }[];
      let value = rows[0]?.value ?? null;
      // Never expose the GLS credential to the browser.
      if (key === 'gls' && value && typeof value === 'object') {
        const { guid, ...rest } = value as Record<string, unknown>;
        value = { ...rest, hasGuid: typeof guid === 'string' && guid.trim().length > 0 };
      }
      return res.status(200).json(value);
    }

    if (req.method === 'PUT') {
      if (!requireAdmin(req, res)) return; // saving settings is admin-only
      const body = req.body;
      if (!body || typeof body !== 'object') return res.status(400).json({ error: 'datos inválidos' });

      let toStore: unknown = body;
      if (key === 'gls') {
        // Preserve the stored guid unless a new, non-empty one is provided; strip
        // the transient `hasGuid` flag the GET added.
        const prevRows = (await sql`select value from settings where key = 'gls'`) as { value: Record<string, unknown> }[];
        const prevGuid = typeof prevRows[0]?.value?.guid === 'string' ? (prevRows[0].value.guid as string) : '';
        const incoming = { ...(body as Record<string, unknown>) };
        const newGuid = typeof incoming.guid === 'string' ? incoming.guid.trim() : '';
        delete incoming.hasGuid;
        incoming.guid = newGuid || prevGuid;
        toStore = incoming;
      }

      await sql`
        insert into settings (key, value, updated_at)
        values (${key}, ${JSON.stringify(toStore)}::jsonb, ${Date.now()})
        on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('[catalog]', e);
    return res.status(500).json({ error: 'Error del servidor al leer/guardar la configuración.' });
  }
}
