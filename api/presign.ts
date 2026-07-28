import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AwsClient } from 'aws4fetch';
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
  createHmac('sha256', ADMIN_SECRET || 'insecure-dev-secret').update(`proj.${projectId}`).digest('base64url');

/** The `<projectId>` segment of a `jobs/<projectId>/<file>` key, if any. */
function projectOf(key: string): string | null {
  const m = /^jobs\/([^/]+)\//.exec(key);
  return m && UUID_RE.test(m[1]) ? m[1] : null;
}

/** True when the caller may read/delete this key. */
function mayAccess(req: VercelRequest, key: string, token: unknown): boolean {
  if (isAdmin(req)) return true;
  const proj = projectOf(key);
  if (!proj || typeof token !== 'string' || !token) return false;
  return safeEq(token, projectToken(proj));
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
      const objectKey = `jobs/${projectId}/${crypto.randomUUID()}${extOf(name)}`;
      const signed = await client.sign(`${BASE}/${objectKey}?X-Amz-Expires=${EXPIRES}`, { method: 'PUT', aws: { signQuery: true } });
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
