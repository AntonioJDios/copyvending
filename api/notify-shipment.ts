import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import nodemailer from 'nodemailer';

// Emails the customer that their order has shipped (with tracking + link).
// Self-contained. Uses the shop Gmail SMTP (same as the other notifications).

const PUBLIC_URL = process.env.PUBLIC_URL || 'https://copyvending.vercel.app';
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_PASS = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const SHOP_NAME = process.env.SHOP_NAME || 'Copistería';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    if (!process.env.DATABASE_URL) return res.status(500).json({ error: 'Falta DATABASE_URL' });
    const { orderId } = (req.body ?? {}) as { orderId?: string };
    if (!orderId) return res.status(400).json({ error: 'falta orderId' });

    const sql = neon(process.env.DATABASE_URL);
    const rows = (await sql`select customer, tracking from orders where id = ${orderId}`) as {
      customer: { nombre?: string; email?: string } | null;
      tracking: string | null;
    }[];
    if (rows.length === 0) return res.status(404).json({ error: 'pedido no encontrado' });

    const to = rows[0].customer?.email;
    if (!to) return res.status(200).json({ ok: true, skipped: 'sin email' });
    if (!GMAIL_USER || !GMAIL_PASS) return res.status(200).json({ ok: true, skipped: 'email no configurado' });

    const nombre = rows[0].customer?.nombre ?? '';
    const tracking = rows[0].tracking ?? '';
    const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
    await t.sendMail({
      from: `${SHOP_NAME} <${GMAIL_USER}>`,
      to,
      subject: `Tu pedido ${orderId} va en camino 🚚`,
      text:
        `Hola ${nombre}:\n\nTu pedido ${orderId} ya está en camino.\n` +
        (tracking ? `Seguimiento: ${tracking}\n` : '') +
        `\nPuedes ver su estado aquí:\n${PUBLIC_URL}/#recoger/${orderId}\n\nGracias por tu compra.\n${SHOP_NAME}`,
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error' });
  }
}
