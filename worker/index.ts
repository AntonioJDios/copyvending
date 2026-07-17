/// <reference types="@cloudflare/workers-types" />
import { AwsClient } from 'aws4fetch';

interface Env {
  /** R2 bucket binding (used for delete). */
  BUCKET: R2Bucket;
  R2_ACCOUNT_ID: string;
  R2_BUCKET: string;
  /** Secrets (wrangler secret put ...). */
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  /** Comma-separated allowed origins, or "*" (default). */
  ALLOWED_ORIGIN?: string;
}

const MAX_MB = 300;
const ACCEPTED = ['application/pdf', 'image/'];
const EXPIRES = 3600; // presigned URL validity (seconds)

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  let allow = '*';
  if (env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== '*') {
    const list = env.ALLOWED_ORIGIN.split(',').map((s) => s.trim());
    allow = origin && list.includes(origin) ? origin : list[0];
  } else if (origin) {
    allow = origin;
  }
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** Safe extension from a client filename (never used as the storage path). */
function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12) : '';
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin');
    const h = corsHeaders(env, origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/presign') return json({ error: 'not found' }, 404, h);

    let body: { op?: string; name?: string; type?: string; size?: number; key?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'JSON inválido' }, 400, h);
    }

    const client = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY });
    const base = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}`;

    if (body.op === 'put') {
      const { name, type, size } = body;
      if (typeof name !== 'string' || typeof type !== 'string' || typeof size !== 'number') {
        return json({ error: 'faltan datos' }, 400, h);
      }
      if (!ACCEPTED.some((p) => type.startsWith(p))) return json({ error: 'tipo no admitido' }, 415, h);
      if (size > MAX_MB * 1024 * 1024) return json({ error: `supera ${MAX_MB} MB` }, 413, h);
      // Server-generated key with a UUID — the client filename is NEVER the path.
      const key = `jobs/${crypto.randomUUID()}${extOf(name)}`;
      const signed = await client.sign(`${base}/${key}?X-Amz-Expires=${EXPIRES}`, { method: 'PUT', aws: { signQuery: true } });
      return json({ key, url: signed.url }, 200, h);
    }

    if (body.op === 'get') {
      if (typeof body.key !== 'string') return json({ error: 'falta key' }, 400, h);
      const signed = await client.sign(`${base}/${body.key}?X-Amz-Expires=${EXPIRES}`, { method: 'GET', aws: { signQuery: true } });
      return json({ url: signed.url }, 200, h);
    }

    if (body.op === 'delete') {
      if (typeof body.key !== 'string') return json({ error: 'falta key' }, 400, h);
      await env.BUCKET.delete(body.key);
      return json({ ok: true }, 200, h);
    }

    return json({ error: 'operación inválida' }, 400, h);
  },
};
