import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

// Redsys server-to-server notification (the source of truth for payment). Redsys
// POSTs the signed result here; we verify the signature and mark the order paid.
// Self-contained. Uses the same REDSYS_* env as pago-redsys.

const SECRET = process.env.REDSYS_SECRET || '';

function encryptOrder(order: string): Buffer {
  const key = Buffer.from(SECRET, 'base64');
  const iv = Buffer.alloc(8, 0);
  const cipher = crypto.createCipheriv('des-ede3-cbc', key, iv);
  cipher.setAutoPadding(false);
  const pad = (8 - (order.length % 8)) % 8;
  const data = Buffer.from(order + '\0'.repeat(pad), 'utf8');
  return Buffer.concat([cipher.update(data), cipher.final()]);
}
function sign(paramsB64: string, order: string): string {
  return crypto.createHmac('sha256', encryptOrder(order)).update(paramsB64).digest('base64');
}
/** Normalise a base64 / base64url signature for comparison. */
const norm = (s: string) => s.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('method not allowed');
  try {
    if (!SECRET) return res.status(500).send('Redsys no configurado');
    const body = (req.body ?? {}) as Record<string, string>;
    const paramsB64 = String(body.Ds_MerchantParameters ?? '');
    const sigReceived = String(body.Ds_Signature ?? '');
    if (!paramsB64 || !sigReceived) return res.status(400).send('faltan parámetros');

    const json = Buffer.from(paramsB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const params = JSON.parse(json) as Record<string, string>;
    const order = params.Ds_Order;
    if (!order) return res.status(400).send('sin Ds_Order');

    // Verify signature.
    if (norm(sign(paramsB64, order)) !== norm(sigReceived)) return res.status(403).send('firma no válida');

    // Response 0000-0099 = authorised.
    const code = parseInt(params.Ds_Response ?? '9999', 10);
    const orderId = params.Ds_MerchantData;
    if (Number.isFinite(code) && code >= 0 && code <= 99 && orderId && process.env.DATABASE_URL) {
      const sql = neon(process.env.DATABASE_URL);
      await sql`update orders set paid = true, payment_method = 'redsys' where id = ${orderId}`;
    }
    // Redsys only needs a 200 OK.
    return res.status(200).send('OK');
  } catch (e) {
    return res.status(500).send(e instanceof Error ? e.message : 'error');
  }
}
