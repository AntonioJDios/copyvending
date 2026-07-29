import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AwsClient } from 'aws4fetch';
import { neon } from '@neondatabase/serverless';
import { createHmac, timingSafeEqual } from 'crypto';

// Self-contained (no relative imports) to avoid any ESM module-resolution
// surprises in the Vercel Node runtime.
const MAX_MB = 300;
const ACCEPTED = ['application/pdf', 'image/'];
const EXPIRES = 3600; // presigned URL validity (seconds)
const ACCOUNT = process.env.R2_ACCOUNT_ID || '5e9102f62162d87f67622085dc6528b3';
const BUCKET = process.env.R2_BUCKET || 'copyvending';
const BASE = `https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || '';
/**
 * Key for the file capabilities. Optional: falls back to ADMIN_SECRET.
 *
 * Setting it decouples revocation — rotating the backoffice password/secret then
 * no longer invalidates the file tokens stored in customers' carts and orders.
 * ⚠️ Changing this value (including setting it for the first time) invalidates
 * every capability already issued: the shop keeps full access with its admin
 * token, but customers can't reopen the files of orders placed before the change.
 */
const FILE_SECRET = process.env.FILE_SECRET || ADMIN_SECRET;

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/** Backoffice/counter token check (same scheme as /api/auth). Admin sees all. */
function isAdmin(req: VercelRequest): boolean {
  if (!ADMIN_SECRET) return false;
  const h = req.headers['authorization'];
  const raw = Array.isArray(h) ? h[0] : h || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  if (!m) return false;
  const [expStr, sig] = m[1].split('.');
  const exp = Number(expStr);
  if (!exp || exp < Date.now() || !sig) return false;
  return safeEq(sig, createHmac('sha256', ADMIN_SECRET).update(`admin.${exp}`).digest('base64url'));
}

/**
 * Per-project capability token.
 *
 * Uploading returns one, and reading/deleting a file requires it. Otherwise
 * anyone who ever saw a storage key (or found one) could keep downloading or —
 * worse — deleting the customer's documents forever, with no authentication at
 * all. The token only grants access to `jobs/<projectId>/…`, so a customer can
 * manage their own files and nobody else's.
 */
const projectToken = (projectId: string) =>
  createHmac('sha256', FILE_SECRET || 'insecure-dev-secret').update(`proj.${projectId}`).digest('base64url');

/**
 * The project id inside a storage key.
 *
 * Two layouts exist and both must keep working:
 *   jobs/<projectId>/<file>            (original)
 *   jobs/<YYYY-MM>/<projectId>/<file>  (current: browsable by month in the
 *                                       Cloudflare dashboard)
 * So instead of assuming a position, take the first segment that IS a uuid. Get
 * this wrong and every customer loses access to their own files.
 */
function projectOf(key: string): string | null {
  if (!key.startsWith('jobs/')) return null;
  for (const seg of key.slice(5).split('/')) {
    if (UUID_RE.test(seg)) return seg;
  }
  return null;
}

/** True when the caller may read/delete this key. */
function mayAccess(req: VercelRequest, key: string, token: unknown): boolean {
  if (isAdmin(req)) return true;
  const proj = projectOf(key);
  if (!proj || typeof token !== 'string' || !token) return false;
  return safeEq(token, projectToken(proj));
}

/**
 * Registry of every uploaded file.
 *
 * A file reaches storage the moment the customer drops it in the configurator —
 * long before there is an order, and possibly without ever becoming one (someone
 * checking a price, an abandoned cart). Without a record of it, that file is
 * invisible: nothing references it and nothing can ever clean it up.
 *
 * So every upload is registered here with its date, and the retention sweep in
 * api/orders can then delete whatever is old enough and still belongs to no
 * order. Best-effort: a registry failure must never block a customer's upload.
 */
async function registerFile(key: string, projectId: string, size: number): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      create table if not exists files (
        key text primary key, project_id text not null, size_bytes bigint,
        created_at bigint not null)`;
    await sql`create index if not exists files_created_idx on files (created_at)`;
    await sql`
      insert into files (key, project_id, size_bytes, created_at)
      values (${key}, ${projectId}, ${size}, ${Date.now()})
      on conflict (key) do nothing`;
  } catch (e) {
    // Un fichero que no queda registrado es un huérfano invisible: seguirá
    // ocupando (y costando) en R2 y el barrido de limpieza no sabrá que existe.
    console.error('[presign] no se pudo registrar el fichero', e);
    await logEvent('error', 'Un archivo subido no se pudo registrar (quedará sin control en el almacenamiento)', { detail: { key, size, error: e instanceof Error ? e.message : String(e) } });
  }
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12) : '';
}

function r2(): AwsClient {
  return new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  });
}

/**
 * Presigning endpoint (same Vercel domain as the app → the browser only talks
 * to *.vercel.app and r2.cloudflarestorage.com, not workers.dev). R2
 * keys/secrets are server-only env vars; they never reach the client.
 */

/**
 * Record an incident in the shared event log (insert only, no email: the mail
 * transport lives in api/orders, which sends these out — see flushPendingAlerts).
 * Best-effort and never throws.
 */
async function logEvent(
  level: 'error' | 'warn' | 'info',
  message: string,
  opts: { orderId?: string; detail?: unknown } = {}
): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const db = neon(process.env.DATABASE_URL);
    await db`
      create table if not exists events (
        id bigserial primary key, at bigint not null, level text not null,
        source text not null, order_id text, message text not null, detail text)`;
    await db`alter table events add column if not exists alerted boolean not null default false`;
    const detail =
      opts.detail === undefined
        ? null
        : String(opts.detail instanceof Error ? opts.detail.message : typeof opts.detail === 'string' ? opts.detail : JSON.stringify(opts.detail)).slice(0, 2000);
    await db`
      insert into events (at, level, source, order_id, message, detail, alerted)
      values (${Date.now()}, ${level}, 'archivos', ${opts.orderId ?? null}, ${message.slice(0, 300)}, ${detail}, false)`;
  } catch (e) {
    console.error('[events] no se pudo registrar', e);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  try {
    if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
      return res.status(500).json({ error: 'Faltan R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY en el servidor' });
    }

    const body = (req.body ?? {}) as {
      op?: string;
      name?: string;
      type?: string;
      size?: number;
      projectId?: string;
      key?: string;
      token?: string;
    };
    const { op, name, type, size, projectId, key, token } = body;
    const client = r2();

    if (op === 'put') {
      if (typeof name !== 'string' || typeof type !== 'string' || typeof size !== 'number') {
        return res.status(400).json({ error: 'faltan datos' });
      }
      if (!ACCEPTED.some((p) => type.startsWith(p))) return res.status(415).json({ error: 'tipo no admitido' });
      if (size > MAX_MB * 1024 * 1024) return res.status(413).json({ error: `supera ${MAX_MB} MB` });
      // A projectId is required so every object lands under a project folder we
      // can issue a capability for (see projectToken).
      if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) {
        return res.status(400).json({ error: 'projectId inválido' });
      }
      // Server-generated key with a UUID — the client filename is never the path.
      // Grouped by upload month so the bucket is navigable by hand in the
      // Cloudflare dashboard; the project folder inside keeps the capability model
      // intact (see projectOf).
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const objectKey = `jobs/${month}/${projectId}/${crypto.randomUUID()}${extOf(name)}`;
      const signed = await client.sign(`${BASE}/${objectKey}?X-Amz-Expires=${EXPIRES}`, { method: 'PUT', aws: { signQuery: true } });
      // Registered BEFORE handing out the URL, so nothing can be uploaded without
      // leaving a trace we can clean up later.
      await registerFile(objectKey, projectId, size);
      // The token travels with the project (cart → order), so the customer can
      // later re-open or delete their own files.
      return res.status(200).json({ key: objectKey, url: signed.url, token: projectToken(projectId) });
    }

    if (op === 'get') {
      if (typeof key !== 'string' || !key.startsWith('jobs/')) return res.status(400).json({ error: 'key inválida' });
      if (!mayAccess(req, key, token)) return res.status(403).json({ error: 'sin permiso para este archivo' });
      const signed = await client.sign(`${BASE}/${key}?X-Amz-Expires=${EXPIRES}`, { method: 'GET', aws: { signQuery: true } });
      return res.status(200).json({ url: signed.url });
    }

    if (op === 'delete') {
      if (typeof key !== 'string' || !key.startsWith('jobs/')) return res.status(400).json({ error: 'key inválida' });
      if (!mayAccess(req, key, token)) return res.status(403).json({ error: 'sin permiso para este archivo' });
      const signed = await client.sign(`${BASE}/${key}`, { method: 'DELETE', aws: { signQuery: true } });
      await fetch(signed.url, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'operación inválida' });
  } catch (e) {
    console.error('[presign]', e);
    return res.status(500).json({ error: 'Error del servidor al firmar el acceso al archivo.' });
  }
}
