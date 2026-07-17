import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AwsClient } from 'aws4fetch';

// Self-contained (no relative imports) to avoid any ESM module-resolution
// surprises in the Vercel Node runtime.
const MAX_MB = 300;
const ACCEPTED = ['application/pdf', 'image/'];
const EXPIRES = 3600; // presigned URL validity (seconds)
const ACCOUNT = process.env.R2_ACCOUNT_ID || '5e9102f62162d87f67622085dc6528b3';
const BUCKET = process.env.R2_BUCKET || 'copyvending';
const BASE = `https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    };
    const { op, name, type, size, projectId, key } = body;
    const client = r2();

    if (op === 'put') {
      if (typeof name !== 'string' || typeof type !== 'string' || typeof size !== 'number') {
        return res.status(400).json({ error: 'faltan datos' });
      }
      if (!ACCEPTED.some((p) => type.startsWith(p))) return res.status(415).json({ error: 'tipo no admitido' });
      if (size > MAX_MB * 1024 * 1024) return res.status(413).json({ error: `supera ${MAX_MB} MB` });
      if (projectId != null && !UUID_RE.test(String(projectId))) return res.status(400).json({ error: 'projectId inválido' });
      // Server-generated key with a UUID — the client filename is never the path.
      const folder = projectId ? `${projectId}/` : '';
      const objectKey = `jobs/${folder}${crypto.randomUUID()}${extOf(name)}`;
      const signed = await client.sign(`${BASE}/${objectKey}?X-Amz-Expires=${EXPIRES}`, { method: 'PUT', aws: { signQuery: true } });
      return res.status(200).json({ key: objectKey, url: signed.url });
    }

    if (op === 'get') {
      if (typeof key !== 'string' || !key.startsWith('jobs/')) return res.status(400).json({ error: 'key inválida' });
      const signed = await client.sign(`${BASE}/${key}?X-Amz-Expires=${EXPIRES}`, { method: 'GET', aws: { signQuery: true } });
      return res.status(200).json({ url: signed.url });
    }

    if (op === 'delete') {
      if (typeof key !== 'string' || !key.startsWith('jobs/')) return res.status(400).json({ error: 'key inválida' });
      const signed = await client.sign(`${BASE}/${key}`, { method: 'DELETE', aws: { signQuery: true } });
      await fetch(signed.url, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'operación inválida' });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error al firmar' });
  }
}
