import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ACCEPTED, MAX_MB, UUID_RE, deleteObject, signGet, signPut } from './_r2';

/**
 * Presigning endpoint (replaces the Cloudflare Worker). Lives on the same
 * Vercel domain as the app, so the browser only ever talks to *.vercel.app and
 * r2.cloudflarestorage.com — no workers.dev (which some network filters block).
 *
 * The R2 keys/secrets are server-only env vars; they never reach the client.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const body = (req.body ?? {}) as {
    op?: string;
    name?: string;
    type?: string;
    size?: number;
    projectId?: string;
    key?: string;
  };
  const { op, name, type, size, projectId, key } = body;

  try {
    if (op === 'put') {
      if (typeof name !== 'string' || typeof type !== 'string' || typeof size !== 'number') {
        return res.status(400).json({ error: 'faltan datos' });
      }
      if (!ACCEPTED.some((p) => type.startsWith(p))) return res.status(415).json({ error: 'tipo no admitido' });
      if (size > MAX_MB * 1024 * 1024) return res.status(413).json({ error: `supera ${MAX_MB} MB` });
      if (projectId != null && !UUID_RE.test(String(projectId))) return res.status(400).json({ error: 'projectId inválido' });
      const signed = await signPut(name, projectId);
      return res.status(200).json(signed);
    }

    // get/delete only operate on our own jobs/ prefix (defensive).
    if (op === 'get') {
      if (typeof key !== 'string' || !key.startsWith('jobs/')) return res.status(400).json({ error: 'key inválida' });
      return res.status(200).json({ url: await signGet(key) });
    }
    if (op === 'delete') {
      if (typeof key !== 'string' || !key.startsWith('jobs/')) return res.status(400).json({ error: 'key inválida' });
      await deleteObject(key);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'operación inválida' });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error al firmar' });
  }
}
