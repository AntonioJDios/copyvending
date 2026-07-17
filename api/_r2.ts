// Shared R2 (S3-compatible) presigning helpers for the Vercel functions.
// Prefixed with "_" so Vercel does NOT expose it as an HTTP route.
import { AwsClient } from 'aws4fetch';

export const MAX_MB = 300;
export const ACCEPTED = ['application/pdf', 'image/'];
const EXPIRES = 3600; // presigned URL validity (seconds)

// Account/bucket are not secret; the two keys ARE (server-only env vars).
const ACCOUNT = process.env.R2_ACCOUNT_ID || '5e9102f62162d87f67622085dc6528b3';
const BUCKET = process.env.R2_BUCKET || 'copyvending';
const BASE = `https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}`;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function client(): AwsClient {
  return new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  });
}

/** Safe extension from a client filename (never used as the storage path). */
export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12) : '';
}

/** Presign an upload. The key is server-generated (UUID); the client filename
 *  is never part of the path. Optional projectId (a UUID) groups files in a
 *  per-project folder: jobs/<projectId>/<uuid><ext>. */
export async function signPut(name: string, projectId?: string): Promise<{ key: string; url: string }> {
  const folder = projectId ? `${projectId}/` : '';
  const key = `jobs/${folder}${crypto.randomUUID()}${extOf(name)}`;
  const signed = await client().sign(`${BASE}/${key}?X-Amz-Expires=${EXPIRES}`, { method: 'PUT', aws: { signQuery: true } });
  return { key, url: signed.url };
}

export async function signGet(key: string): Promise<string> {
  const signed = await client().sign(`${BASE}/${key}?X-Amz-Expires=${EXPIRES}`, { method: 'GET', aws: { signQuery: true } });
  return signed.url;
}

/** Delete server-side (the request goes from Vercel → R2, not the browser). */
export async function deleteObject(key: string): Promise<void> {
  const signed = await client().sign(`${BASE}/${key}`, { method: 'DELETE', aws: { signQuery: true } });
  await fetch(signed.url, { method: 'DELETE' });
}
