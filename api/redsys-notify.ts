import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import crypto from 'crypto';

// Redsys server-to-server notification: the SOURCE OF TRUTH for payment. Redsys
// POSTs the signed result here and this is the only place (besides an explicit
// admin action) that may mark an order as paid.
//
// Self-contained. Uses the same REDSYS_* env as pago-redsys.

const SECRET = process.env.REDSYS_SECRET || '';
/** EUR. A notification in any other currency is not our payment. */
const EUR = '978';

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

// ── DB ────────────────────────────────────────────────────────────────
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
      // Reconciliation data. Without these the shop cannot answer "which bank
      // transaction paid this order?" — Ds_Order in particular is the reference you
      // search for in the Redsys portal, and it used to be thrown away.
      await db()`alter table orders add column if not exists paid_at bigint`;
      await db()`alter table orders add column if not exists payment_auth_code text`;
      await db()`alter table orders add column if not exists payment_ref text`;
      await db()`alter table orders add column if not exists payment_amount_cents integer`;
      // Audit trail: EVERY signature-valid notification, applied or not. This is
      // what lets you reconstruct what happened with a payment weeks later, and the
      // evidence if a customer disputes a charge.
      await db()`
        create table if not exists payment_events (
          id bigserial primary key,
          received_at bigint not null,
          order_id text,
          payment_ref text,
          response_code text,
          auth_code text,
          amount_cents integer,
          applied boolean not null,
          reason text)`;
      await db()`create index if not exists payment_events_order_idx on payment_events (order_id)`;
      // Event log. Definido igual que en api/orders: hoy hemos tenido dos caídas
      // por leer una tabla que solo creaba otra función.
      await db()`
        create table if not exists events (
          id bigserial primary key, at bigint not null, level text not null,
          source text not null, order_id text, message text not null, detail text)`;
      await db()`alter table events add column if not exists alerted boolean not null default false`;
    })().catch((e) => {
      _ready = null;
      throw e;
    });
  }
  return _ready;
}

// ── Decision ─────────────────────────────────────────────────────────
export interface NotifyDecision {
  /** Whether the order may be marked as paid. */
  pay: boolean;
  /** Machine-readable reason, stored in the audit trail. */
  reason: string;
}

/**
 * Should this notification mark the order as paid? Pure, so it can be tested.
 *
 * Verifying the signature only proves the message came from Redsys — NOT that it
 * authorises what we think it does. Three things still have to hold:
 *   - the response code says authorised (0000-0099);
 *   - the currency is EUR;
 *   - **the amount matches the order total**. Without this check, a notification
 *     for 1 € would happily mark a 300 € order as paid.
 */
export function decideNotification(
  params: Record<string, string>,
  order: { total: number; paid: boolean } | null
): NotifyDecision {
  if (!order) return { pay: false, reason: 'pedido no encontrado' };

  const code = parseInt(params.Ds_Response ?? '9999', 10);
  if (!Number.isFinite(code)) return { pay: false, reason: 'Ds_Response ausente o no numérico' };
  // 0000-0099 = authorised. Anything else is a denial and must NOT mark it paid.
  if (code < 0 || code > 99) return { pay: false, reason: `pago denegado (Ds_Response ${params.Ds_Response})` };

  const currency = String(params.Ds_Currency ?? '');
  if (currency && currency !== EUR) return { pay: false, reason: `moneda inesperada (${currency})` };

  const notified = Number.parseInt(String(params.Ds_Amount ?? ''), 10);
  if (!Number.isFinite(notified)) return { pay: false, reason: 'Ds_Amount ausente o no numérico' };
  const expected = Math.round((Number(order.total) || 0) * 100);
  if (notified !== expected) {
    return { pay: false, reason: `importe distinto: notificado ${notified} c, pedido ${expected} c` };
  }

  // Idempotency: a repeated notification (Redsys retries) must not re-apply.
  if (order.paid) return { pay: false, reason: 'ya estaba pagado (notificación repetida)' };

  return { pay: true, reason: 'autorizado' };
}

/**
 * Record an incident in the shared event log.
 *
 * Insert only, no email: the mail transport lives in api/orders, and duplicating
 * it into five functions is exactly how the schema ended up scattered across the
 * codebase. Rows land with alerted=false and api/orders sends them out.
 *
 * Never throws — and in particular never turns a payment notification into a 500,
 * because Redsys would then retry a notification we already applied.
 */
async function logEvent(
  level: 'error' | 'warn' | 'info',
  message: string,
  opts: { orderId?: string; detail?: unknown } = {}
): Promise<void> {
  try {
    await ensureSchema();
    const detail =
      opts.detail === undefined
        ? null
        : String(
            opts.detail instanceof Error ? opts.detail.message : typeof opts.detail === 'string' ? opts.detail : JSON.stringify(opts.detail)
          ).slice(0, 2000);
    await db()`
      insert into events (at, level, source, order_id, message, detail, alerted)
      values (${Date.now()}, ${level}, 'cobros', ${opts.orderId ?? null}, ${message.slice(0, 300)}, ${detail}, false)`;
  } catch (e) {
    console.error('[events] no se pudo registrar', e);
  }
}

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
    const dsOrder = params.Ds_Order;
    if (!dsOrder) return res.status(400).send('sin Ds_Order');

    // Verify the signature FIRST: everything below trusts these values.
    if (norm(sign(paramsB64, dsOrder)) !== norm(sigReceived)) {
      console.error('[redsys] firma no válida', { dsOrder });
      // Alguien ha mandado una notificación de pago sin la clave. Puede ser una
      // prueba, o puede ser un intento de marcar pedidos como pagados.
      await logEvent('error', 'Notificación de pago con firma no válida (se ha rechazado)', { detail: { dsOrder } });
      return res.status(403).send('firma no válida');
    }

    await ensureSchema();
    const sql = db();

    const orderId = params.Ds_MerchantData;
    const rows = orderId
      ? ((await sql`select total, paid from orders where id = ${orderId}`) as { total: number; paid: boolean }[])
      : [];
    const order = rows[0] ?? null;
    const decision = decideNotification(params, order);

    const authCode = params.Ds_AuthorisationCode ?? null;
    const amountCents = Number.parseInt(String(params.Ds_Amount ?? ''), 10);
    const now = Date.now();

    if (decision.pay) {
      // Guarded by `paid = false` as well as by the decision: if two notifications
      // land at once, only one wins and the other is a no-op.
      const upd = (await sql`
        update orders
           set paid = true,
               payment_method = 'redsys',
               paid_at = ${now},
               payment_auth_code = ${authCode},
               payment_ref = ${dsOrder},
               payment_amount_cents = ${Number.isFinite(amountCents) ? amountCents : null}
         where id = ${orderId} and paid = false
        returning id`) as { id: string }[];
      if (upd.length === 0) decision.reason = 'ya estaba pagado (carrera entre notificaciones)';
    } else {
      // Loud, because these are the cases someone has to look at: a denial is
      // normal, but a mismatched amount is either an attack or our own bug.
      console.error('[redsys] notificación NO aplicada', { orderId, dsOrder, reason: decision.reason });
      // Un rechazo del banco es normal y no es noticia; que no cuadre el importe
      // o que no exista el pedido sí lo es: o es un ataque o es un fallo nuestro.
      const routine = /denegad|rechazad/i.test(decision.reason ?? '');
      await logEvent(routine ? 'info' : 'error', `Cobro no aplicado: ${decision.reason ?? 'sin motivo'}`, {
        orderId: orderId ?? undefined,
        detail: { dsOrder },
      });
    }

    // Log it either way — applied or not.
    await sql`
      insert into payment_events (received_at, order_id, payment_ref, response_code, auth_code, amount_cents, applied, reason)
      values (${now}, ${orderId ?? null}, ${dsOrder}, ${params.Ds_Response ?? null}, ${authCode},
              ${Number.isFinite(amountCents) ? amountCents : null}, ${decision.pay}, ${decision.reason})`;

    // Redsys only needs a 200; anything else makes it retry, and retrying will not
    // change a denial or a mismatched amount.
    return res.status(200).send('OK');
  } catch (e) {
    // A 500 DOES make Redsys retry, which is what we want for a transient failure
    // (e.g. the database being briefly unavailable): the payment is not lost.
    console.error('[redsys] error procesando la notificación', e);
    // Redsys reintentará, pero si el fallo persiste el cliente ha pagado y el
    // pedido no lo refleja: es lo más urgente que puede pasar en esta tienda.
    await logEvent('error', 'Error procesando una notificación de pago (el cliente puede haber pagado)', { detail: e });
    return res.status(500).send('error');
  }
}
