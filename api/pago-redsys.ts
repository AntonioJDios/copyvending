import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

// Redsys redirect payment (card + Bizum). Builds and signs the parameters for an
// existing order; the browser then POSTs them to Redsys. Self-contained.
// Credentials come from env (NEVER hardcode the secret / commit it):
//   REDSYS_MERCHANT_CODE, REDSYS_TERMINAL, REDSYS_SECRET, REDSYS_ENV(test|prod)

const PUBLIC_URL = process.env.PUBLIC_URL || 'https://copyvending.vercel.app';
const MERCHANT = process.env.REDSYS_MERCHANT_CODE || '';
const TERMINAL = process.env.REDSYS_TERMINAL || '001';
const SECRET = process.env.REDSYS_SECRET || '';
const ENV = (process.env.REDSYS_ENV || 'test').toLowerCase();
const SHOP_NAME = process.env.SHOP_NAME || 'Copistería';
const REDSYS_URL = ENV === 'prod' ? 'https://sis.redsys.es/sis/realizarPago' : 'https://sis-t.redsys.es:25443/sis/realizarPago';

/** 3DES-CBC (zero IV, zero padding) of the order number with the merchant key. */
function encryptOrder(order: string): Buffer {
  const key = Buffer.from(SECRET, 'base64');
  const iv = Buffer.alloc(8, 0);
  const cipher = crypto.createCipheriv('des-ede3-cbc', key, iv);
  cipher.setAutoPadding(false);
  const pad = (8 - (order.length % 8)) % 8;
  const data = Buffer.from(order + '\0'.repeat(pad), 'utf8');
  return Buffer.concat([cipher.update(data), cipher.final()]);
}
/** HMAC-SHA256 of the base64 params with the per-order derived key → base64. */
function sign(paramsB64: string, order: string): string {
  return crypto.createHmac('sha256', encryptOrder(order)).update(paramsB64).digest('base64');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!MERCHANT || !SECRET) return res.status(500).json({ error: 'Redsys no configurado (faltan variables REDSYS_*)' });

    // GET → public config for the InSite card form (no secret).
    if (req.method === 'GET') {
      const jsUrl = ENV === 'prod' ? 'https://sis.redsys.es/sis/NC/redsysV3.js' : 'https://sis-t.redsys.es:25443/sis/NC/sandbox/redsysV3.js';
      return res.status(200).json({ merchantCode: MERCHANT, terminal: TERMINAL, env: ENV, jsUrl });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
    if (!process.env.DATABASE_URL) return res.status(500).json({ error: 'Falta DATABASE_URL' });

    const { orderId, method, idOper, order } = (req.body ?? {}) as {
      orderId?: string; method?: 'card' | 'bizum'; idOper?: string; order?: string;
    };
    if (!orderId) return res.status(400).json({ error: 'falta orderId' });

    const sql = neon(process.env.DATABASE_URL);
    const rows = (await sql`select total from orders where id = ${orderId}`) as { total: number }[];
    if (rows.length === 0) return res.status(404).json({ error: 'pedido no encontrado' });
    const amountCents = Math.round(Number(rows[0].total) * 100);
    if (amountCents <= 0) return res.status(400).json({ error: 'importe inválido' });

    // Redsys order number: 4-12 chars, first 4 numeric, unique. Our real id goes
    // in MERCHANTDATA so the notification can find the order. For InSite the order
    // must match the one used to generate the idOper, so accept it from the client.
    const dsOrder = order && /^\d{4,12}$/.test(order)
      ? order
      : (String(Date.now()).slice(-10) + Math.floor(10 + Math.random() * 89)).slice(0, 12);

    const params: Record<string, string> = {
      DS_MERCHANT_AMOUNT: String(amountCents),
      DS_MERCHANT_ORDER: dsOrder,
      DS_MERCHANT_MERCHANTCODE: MERCHANT,
      DS_MERCHANT_CURRENCY: '978',
      DS_MERCHANT_TRANSACTIONTYPE: '0',
      DS_MERCHANT_TERMINAL: TERMINAL,
      DS_MERCHANT_MERCHANTURL: `${PUBLIC_URL}/api/redsys-notify`,
      DS_MERCHANT_URLOK: `${PUBLIC_URL}/#recoger/${orderId}`,
      DS_MERCHANT_URLKO: `${PUBLIC_URL}/#carrito`,
      DS_MERCHANT_MERCHANTDATA: orderId,
      DS_MERCHANT_MERCHANTNAME: SHOP_NAME.slice(0, 25),
      DS_MERCHANT_CONSUMERLANGUAGE: '001',
    };
    if (method === 'bizum') params.DS_MERCHANT_PAYMETHODS = 'z';
    else if (method === 'card') params.DS_MERCHANT_PAYMETHODS = 'C';
    if (idOper) params.DS_MERCHANT_IDOPER = String(idOper); // InSite: tokenised card

    const paramsB64 = Buffer.from(JSON.stringify(params), 'utf8').toString('base64');
    return res.status(200).json({
      url: REDSYS_URL,
      Ds_SignatureVersion: 'HMAC_SHA256_V1',
      Ds_MerchantParameters: paramsB64,
      Ds_Signature: sign(paramsB64, dsOrder),
    });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error de pago' });
  }
}
