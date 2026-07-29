import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { AwsClient } from 'aws4fetch';
import nodemailer from 'nodemailer';
import { createHmac, timingSafeEqual } from 'crypto';

// Auth: verify the stateless scoped tokens issued by /api/auth ('admin' for the
// backoffice, 'counter' for the shop-floor tablet). The scope is inside the
// signed payload, so a counter token can never pass as an admin one.
//
// FAILS CLOSED: with no ADMIN_SECRET configured, admin operations are refused
// (503), never served. A missing env var must not expose every order.
const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || '';
function hasScope(req: VercelRequest, scope: 'admin' | 'counter'): boolean {
  if (!ADMIN_SECRET) return false;
  const h = req.headers['authorization'];
  const raw = Array.isArray(h) ? h[0] : h || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  if (!m) return false;
  const [expStr, sig] = m[1].split('.');
  const exp = Number(expStr);
  if (!exp || exp < Date.now() || !sig) return false;
  const expected = createHmac('sha256', ADMIN_SECRET).update(`${scope}.${exp}`).digest('base64url');
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
const isAdmin = (req: VercelRequest): boolean => hasScope(req, 'admin');
const isCounter = (req: VercelRequest): boolean => hasScope(req, 'counter');

/** Allow the request through, or answer 401/503 and return false. */
function requireAdmin(req: VercelRequest, res: VercelResponse): boolean {
  if (!ADMIN_SECRET) {
    res.status(503).json({ error: 'El backoffice no está configurado en el servidor (falta ADMIN_PASSWORD).' });
    return false;
  }
  if (isAdmin(req)) return true;
  res.status(401).json({ error: 'Necesitas iniciar sesión como administrador.' });
  return false;
}

// Shipment-notification email (folded in here to stay under the Hobby 12-function
// limit). Best-effort; uses the shop Gmail SMTP.
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://copyvending.vercel.app';
const SHOP_NAME = process.env.SHOP_NAME || 'Copistería';

// ── Transactional email (provider-agnostic, over HTTP) ───────────────
// Sends through Brevo or Resend depending on MAIL_PROVIDER, and falls back to the
// legacy Gmail SMTP when nothing is configured (so a deploy without the new env
// vars keeps working). See docs/email.md.
//
// HTTP on purpose: SMTP does not work on Cloudflare Workers, so this is also the
// version that survives the migration. Duplicated across the api/ functions that
// send mail because Vercel functions have to be self-contained.
const MAIL_PROVIDER = (process.env.MAIL_PROVIDER || '').toLowerCase();
const MAIL_KEY = process.env.MAIL_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || process.env.GMAIL_USER || '';
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || process.env.SHOP_NAME || 'Copistería';
const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || '';

/** Send a plain-text email. Throws on failure so the caller can log it. */
async function sendEmail(to: string, subject: string, text: string, opts: { inReplyTo?: string } = {}): Promise<void> {
  if (!to) return; // nothing to do without a recipient
  // A missing sender is a MISCONFIGURATION, not a no-op: returning quietly here
  // would mean emails silently never go out, with nothing in the logs to explain it.
  if (!MAIL_FROM) throw new Error('Falta MAIL_FROM (o GMAIL_USER) en el servidor: no hay remitente configurado');
  // Threading headers, so a reply lands in the customer's original conversation.
  const headers = opts.inReplyTo ? { 'In-Reply-To': opts.inReplyTo, References: opts.inReplyTo } : undefined;

  if (MAIL_KEY && (MAIL_PROVIDER === 'brevo' || MAIL_PROVIDER === 'resend')) {
    const brevo = MAIL_PROVIDER === 'brevo';
    const url = brevo ? 'https://api.brevo.com/v3/smtp/email' : 'https://api.resend.com/emails';
    const body = brevo
      ? {
          sender: { email: MAIL_FROM, name: MAIL_FROM_NAME },
          to: [{ email: to }],
          subject,
          textContent: text,
          ...(MAIL_REPLY_TO ? { replyTo: { email: MAIL_REPLY_TO } } : {}),
          ...(headers ? { headers } : {}),
        }
      : {
          from: `${MAIL_FROM_NAME} <${MAIL_FROM}>`,
          to: [to],
          subject,
          text,
          ...(MAIL_REPLY_TO ? { reply_to: MAIL_REPLY_TO } : {}),
          ...(headers ? { headers } : {}),
        };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(brevo ? { 'api-key': MAIL_KEY, accept: 'application/json' } : { Authorization: `Bearer ${MAIL_KEY}` }),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${MAIL_PROVIDER} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }

  // SMTP fallback. Host/port configurable, so this can be the shop's OWN mail
  // hosting (smtp.fotocopiator.es) instead of Gmail: same cost as today and the
  // domain is already authenticated by the host. Fine as a stopgap, but it has
  // undocumented sending limits, gives no bounce tracking, shares the host's IP
  // reputation, and does NOT run on Cloudflare Workers. Defaults to Gmail so the
  // previous configuration keeps working untouched.
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = Number(process.env.SMTP_PORT) || 465;
  const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER || '';
  const smtpPass = (process.env.SMTP_PASSWORD || process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!smtpUser || !smtpPass) throw new Error('Email no configurado en el servidor (MAIL_PROVIDER/MAIL_API_KEY, o SMTP_*/GMAIL_*)');
  const t = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    // 465 = TLS directo; 587 (habitual en hostings españoles) = STARTTLS.
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
  await t.sendMail({
    from: `${MAIL_FROM_NAME} <${MAIL_FROM || smtpUser}>`,
    to,
    subject,
    text,
    ...(MAIL_REPLY_TO ? { replyTo: MAIL_REPLY_TO } : {}),
    ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo, references: opts.inReplyTo } : {}),
  });
}

/** Tracking link for the customer. Carries the email (`e=`) because looking an
 *  order up needs code + email — this keeps our own links one-click. */
const trackLink = (orderId: string, email: string) =>
  `${PUBLIC_URL}/#recoger/${orderId}?e=${encodeURIComponent(email)}`;

// "Ready for pickup" notice (pickup orders only). Best-effort via the shop Gmail.
async function sendReadyMail(to: string, nombre: string, orderId: string): Promise<void> {
  await sendEmail(
    to,
    `Tu pedido ${orderId} ya está listo para recoger 📦`,
    `Hola ${nombre}:\n\n¡Buenas noticias! Tu pedido ${orderId} ya está preparado. Puedes pasar a recogerlo cuando quieras.\n\nDetalles y estado:\n${trackLink(orderId, to)}\n\nGracias por confiar en ${SHOP_NAME}.`
  );
}

// Order-received confirmation (web orders only). Best-effort via the shop Gmail.
async function sendOrderMail(to: string, nombre: string, orderId: string, total: number): Promise<void> {
  const eur = `${(Number(total) || 0).toFixed(2).replace('.', ',')} €`;
  await sendEmail(
    to,
    `Hemos recibido tu pedido ${orderId} ✅`, `Hola ${nombre}:\n\n¡Gracias por tu pedido! Lo hemos recibido correctamente y ya lo estamos gestionando.\n\nNº de pedido: ${orderId}\nTotal: ${eur}\n\nPuedes seguir su estado aquí:\n${trackLink(orderId, to)}\n\nPara consultarlo necesitarás este código y tu email (${to}).\n\nGracias por confiar en ${SHOP_NAME}.`
  );
}

async function sendShipMail(to: string, nombre: string, orderId: string, tracking: string): Promise<void> {
  await sendEmail(
    to,
    `Tu pedido ${orderId} va en camino 🚚`,
    `Hola ${nombre}:\n\nTu pedido ${orderId} ya está en camino.\n${tracking ? `Seguimiento: ${tracking}\n` : ''}\nPuedes ver su estado aquí:\n${trackLink(orderId, to)}\n\nGracias por tu compra.\n${SHOP_NAME}`
  );
}

// ── GLS (ASM) shipping labels ────────────────────────────────────────
// GLS España = ASM SOAP webservice. A single HTTPS POST (GrabaServicios)
// registers the shipment and returns the tracking number (codbarras) + the
// label as a base64 PDF. Auth is a single GUID (uidcliente). Folded in here to
// respect the Hobby 12-function limit. No SOAP library: build XML, parse reply.
const GLS_URL = 'https://wsclientes.asmred.com/b2b.asmx';
const GLS_UID = process.env.GLS_UID || '';
const GLS_SERVICE = process.env.GLS_SERVICE || '96'; // 96 = BusinessParcel (24/48h)
const GLS_HORARIO = process.env.GLS_HORARIO || '18';
const GLS_WEIGHT = process.env.GLS_WEIGHT || '1'; // kg
const GLS_SENDER = {
  name: process.env.GLS_SENDER_NAME || SHOP_NAME,
  phone: process.env.GLS_SENDER_PHONE || '',
  street: process.env.GLS_SENDER_STREET || '',
  city: process.env.GLS_SENDER_CITY || '',
  cp: process.env.GLS_SENDER_CP || '',
  country: process.env.GLS_SENDER_COUNTRY || 'ES',
};
const GLS_TRACK_URL = 'https://mygls.gls-spain.es/e/';

const xesc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xcdata = (s: unknown) => `<![CDATA[${String(s ?? '').replace(/]]>/g, ']] >')}]]>`;

type GlsAddr = { nombre?: string; linea1?: string; linea2?: string; cp?: string; ciudad?: string; provincia?: string; telefono?: string };
type GlsCustomer = { nombre?: string; apellidos?: string; email?: string; telefono?: string; shipping?: GlsAddr };
// GLS config stored under the 'gls' settings key (backoffice only). Includes the
// guid credential — this stays server-side and is never sent to the browser.
type GlsConfig = {
  enabled?: boolean; guid?: string; senderName?: string; senderStreet?: string; senderCp?: string;
  senderCity?: string; senderPhone?: string; service?: string; horario?: string; weight?: string;
};

/** Read the backoffice GLS config from the settings table (server-side only). */
async function getGlsConfig(): Promise<GlsConfig | null> {
  try {
    const rows = (await db()`select value from settings where key = 'gls'`) as { value: GlsConfig }[];
    return rows[0]?.value ?? null;
  } catch {
    return null; // settings table may not exist yet
  }
}

/** Register a GLS shipment for an order and return its tracking + base64 PDF label.
 *  Config comes from the admin (`cfg`, settings key 'gls') when set, else env fallbacks. */
async function createGlsShipment(orderId: string, cust: GlsCustomer, cfg?: GlsConfig): Promise<{ ok: boolean; tracking?: string; label?: string; error?: string }> {
  if (cfg && cfg.enabled === false) return { ok: false, error: 'GLS está desactivado en el panel de administración.' };
  const guid = (cfg?.guid && cfg.guid.trim()) || GLS_UID;
  if (!guid) return { ok: false, error: 'GLS no está configurado (falta el GUID en el panel de administración).' };
  const s = cust.shipping;
  if (!s || !s.cp || !s.linea1) return { ok: false, error: 'El pedido no tiene una dirección de envío completa.' };
  const zone = zoneForCP(s.cp);
  if (!zone || zone === 'noservido') return { ok: false, error: 'No se realizan envíos a ese código postal.' };

  // Admin value wins; env var is the fallback; then a sane default.
  const service = cfg?.service || GLS_SERVICE;
  const horario = cfg?.horario || GLS_HORARIO;
  const weight = cfg?.weight || GLS_WEIGHT;
  const sender = {
    name: cfg?.senderName || GLS_SENDER.name,
    phone: cfg?.senderPhone || GLS_SENDER.phone,
    street: cfg?.senderStreet || GLS_SENDER.street,
    city: cfg?.senderCity || GLS_SENDER.city,
    cp: cfg?.senderCp || GLS_SENDER.cp,
    country: GLS_SENDER.country,
  };

  const nombre = [cust.nombre, cust.apellidos].filter(Boolean).join(' ') || s.nombre || 'Cliente';
  const direccion = [s.linea1, s.linea2].filter(Boolean).join(', ');
  const tel = s.telefono || cust.telefono || '';
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <GrabaServicios xmlns="http://www.asmred.com/">
      <docIn>
        <Servicios uidcliente="${xesc(guid)}">
          <Envio>
            <Portes>P</Portes>
            <Servicio>${xesc(service)}</Servicio>
            <Horario>${xesc(horario)}</Horario>
            <Bultos>1</Bultos>
            <Peso>${xesc(weight)}</Peso>
            <Remite>
              <Nombre>${xcdata(sender.name)}</Nombre>
              <Telefono>${xcdata(sender.phone)}</Telefono>
              <Direccion>${xcdata(sender.street)}</Direccion>
              <Poblacion>${xcdata(sender.city)}</Poblacion>
              <Pais>${xesc(sender.country)}</Pais>
              <CP>${xesc(sender.cp)}</CP>
            </Remite>
            <Destinatario>
              <Nombre>${xcdata(nombre)}</Nombre>
              <Direccion>${xcdata(direccion)}</Direccion>
              <Poblacion>${xcdata(s.ciudad || '')}</Poblacion>
              <Pais>ES</Pais>
              <CP>${xesc(s.cp)}</CP>
              <Telefono>${xesc(tel)}</Telefono>
              <Movil>${xesc(tel)}</Movil>
              <Observaciones>${xcdata('Pedido ' + orderId)}</Observaciones>
              <Email>${xesc(cust.email || '')}</Email>
            </Destinatario>
            <Referencias>
              <Referencia tipo="0">${xesc(orderId)}</Referencia>
            </Referencias>
            <DevuelveAdicionales>
              <Etiqueta tipo="PDF"></Etiqueta>
            </DevuelveAdicionales>
          </Envio>
          <Plataforma>copyvending</Plataforma>
        </Servicios>
      </docIn>
    </GrabaServicios>
  </soap12:Body>
</soap12:Envelope>`;

  let text = '';
  try {
    const resp = await fetch(GLS_URL, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=UTF-8' }, body: xml });
    text = await resp.text();
  } catch (e) {
    return { ok: false, error: 'No se pudo conectar con GLS: ' + (e instanceof Error ? e.message : 'error de red') };
  }
  const ret = /<Resultado[^>]*\breturn="([^"]*)"/i.exec(text)?.[1] ?? '';
  const codbarras = /\bcodbarras="([^"]+)"/i.exec(text)?.[1] ?? '';
  const errText = () =>
    /<Error[^>]*>([\s\S]*?)<\/Error>/i.exec(text)?.[1]?.trim() ||
    /<(?:\w+:)?faultstring[^>]*>([\s\S]*?)<\/(?:\w+:)?faultstring>/i.exec(text)?.[1]?.trim();
  if (ret && ret !== '0') {
    const e = errText();
    return { ok: false, error: `GLS rechazó el envío (código ${ret})${e ? ': ' + e : ''}.` };
  }
  if (!codbarras) return { ok: false, error: errText() || 'GLS no devolvió número de seguimiento.' };
  const label = /<Etiquetas>[\s\S]*?<Etiqueta[^>]*>([\s\S]*?)<\/Etiqueta>/i.exec(text)?.[1]?.replace(/\s+/g, '') || undefined;
  return { ok: true, tracking: codbarras, label };
}

// IMPORTANT: Vercel Node functions here must be SELF-CONTAINED — importing
// values from ../src (or other api files) breaks the runtime. So the pricing
// MATH below is a synced copy of src/domain/priceEngine.ts. Keep them in sync
// (this duplication disappears with the move to Cloudflare, where routes can
// share code).
//
// The pricing VALUES are NOT duplicated: there are no prices in this file. Both
// client and server read the one and only catalog stored in Neon
// (`settings.catalog`), which is why the server can re-price an order and
// validate what the client sent (anti-fraud). If that catalog is missing, we
// refuse the order instead of inventing a price.
type ColorOpt = { name: string; extra?: number };
type PriceCatalog = {
  pagePrices: Record<string, number>;
  bindingPrices: Record<string, number>;
  colorSurcharge: Record<string, number>;
  laminateSurcharge: Record<string, number>;
  coverColorSurcharge: number;
  perforatePrice: number;
  holesPrice: number;
  stickerPrice: number;
  noMarginsPrice: number;
  extraFolioPrice: number;
  mugPrice: number;
  badgePrice: number;
  ringColors?: ColorOpt[];
  coverColors?: ColorOpt[];
  sources?: Record<string, SourcePriceOverride>;
};
type SourcePriceOverride = Partial<Omit<PriceCatalog, 'sources' | 'ringColors' | 'coverColors'>> & {
  ringExtras?: Record<string, number>;
  coverExtras?: Record<string, number>;
  modules?: { payments?: boolean; invoicing?: boolean; shipping?: boolean; coupons?: boolean; assistant?: boolean };
};
// ── Pricing math (synced copy of src/domain/priceEngine.ts) ──────────
type Cfg = {
  size: string; color: string; grosor: number; dobleCara: string; paginasPorHoja: number;
  acabado: string; acabadoFolios: string; juntos: string; sinMargenes: boolean;
  foliosDelante: number; foliosDetras: number;
};
type Doc = { pages: number; color: string };
const psides = (pages: number, ppp: number) => Math.ceil(pages / ppp);
const psheets = (pages: number, ppp: number, cara: string) => Math.ceil(psides(pages, ppp) / (1 + Number(cara)));

function docCost(doc: Doc, c: Cfg, cat: PriceCatalog): number {
  const sides = psides(doc.pages, c.paginasPorHoja);
  const sh = psheets(doc.pages, c.paginasPorHoja, c.dobleCara);
  let cost = sides * (cat.pagePrices[`${c.size}-${c.grosor}-${c.color}-${c.dobleCara}`] ?? 0);
  if (c.color === 'BN') {
    if (doc.color === 'all') cost += sides * (cat.colorSurcharge[c.size] ?? 0);
    else if (doc.color === 'cover') cost += cat.coverColorSurcharge;
  }
  if (c.acabadoFolios === 'plastificar') cost += sh * (cat.laminateSurcharge[c.size] ?? 0);
  if (c.acabadoFolios === 'pegatinas') cost += sides * cat.stickerPrice;
  if (c.acabado === 'perforado') cost += cat.perforatePrice;
  if (c.acabado === 'dos_agujeros' || c.acabado === 'cuatro_agujeros') cost += cat.holesPrice;
  return cost;
}
function copiasTotal(c: Cfg, docs: Doc[], copias: number, cat: PriceCatalog, colorAnillas?: string, colorContraportada?: string): number {
  const bindings = c.juntos === 'agrupados' ? (docs.length > 0 ? 1 : 0) : docs.length;
  const noMargins = c.sinMargenes ? cat.noMarginsPrice : 0;
  const docsCost = docs.reduce((s, d) => s + docCost(d, c, cat), 0);
  const bindingCost = ((cat.bindingPrices[c.acabado] ?? 0) + noMargins) * bindings;
  const extraFolios = c.acabado === 'sinencuadernacion' ? 0 : (c.foliosDelante || 0) + (c.foliosDetras || 0);
  const extraCost = extraFolios * cat.extraFolioPrice * bindings;
  let colorExtra = 0;
  if (c.acabado === 'AnillasColores') {
    const ring = cat.ringColors?.find((x) => x.name === colorAnillas);
    const cover = cat.coverColors?.find((x) => x.name === colorContraportada);
    colorExtra = ((ring?.extra ?? 0) + (cover?.extra ?? 0)) * bindings;
  }
  return (docsCost + bindingCost + extraCost + colorExtra) * Math.max(1, copias || 1);
}
/** Exported ONLY so tests/pricing-parity.test.ts can check this copy against
 *  src/domain/priceEngine.ts. Vercel routes the default export (the handler);
 *  extra named exports are inert at runtime. */
export function itemTotal(item: Record<string, unknown>, cat: PriceCatalog): number {
  if (item.kind === 'taza') return cat.mugPrice * Math.max(1, Number(item.cantidad) || 1);
  if (item.kind === 'chapa') return cat.badgePrice * Math.max(1, Number(item.cantidad) || 1);
  const docs = Array.isArray(item.docs) ? (item.docs as Record<string, unknown>[]) : [];
  return copiasTotal(
    item.config as Cfg,
    docs.map((d) => ({ pages: Number(d.pages) || 0, color: String(d.color || 'no') })),
    Number(item.copias) || 1,
    cat,
    typeof item.colorAnillas === 'string' ? item.colorAnillas : undefined,
    typeof item.colorContraportada === 'string' ? item.colorContraportada : undefined
  );
}

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
      await db()`
        create table if not exists orders (
          id text primary key, created_at bigint not null, source text not null,
          customer jsonb not null, items jsonb not null,
          total double precision not null, status text not null)`;
      await db()`alter table orders add column if not exists price_mismatch boolean default false`;
      await db()`alter table orders add column if not exists paid boolean default false`;
      await db()`alter table orders add column if not exists payment_method text`;
      await db()`alter table orders add column if not exists shipping_method text`;
      await db()`alter table orders add column if not exists shipping_cost double precision default 0`;
      await db()`alter table orders add column if not exists tracking text`;
      await db()`alter table orders add column if not exists shipped_at bigint`;
      await db()`alter table orders add column if not exists label text`;
      await db()`alter table orders add column if not exists coupon_code text`;
      await db()`alter table orders add column if not exists coupon_discount double precision default 0`;
      // Which terms of sale the customer accepted at checkout, and when: the
      // withdrawal-right exclusion for personalised goods only holds if they
      // were informed beforehand, so this is the evidence of it.
      await db()`alter table orders add column if not exists terms_version text`;
      await db()`alter table orders add column if not exists terms_accepted_at bigint`;
      // When the customer's files were purged from storage. The ORDER stays (it is
      // the sales record: statistics, the 303 summary and coupon-usage counts all
      // read from it); only the documents go.
      await db()`alter table orders add column if not exists files_purged_at bigint`;
      // Pagination + the stats queries all sort by date; the id breaks ties so a
      // cursor can never skip or repeat a row (the PrestaShop import created
      // orders sharing the same millisecond).
      await db()`create index if not exists orders_created_idx on orders (created_at desc, id desc)`;
    })().catch((e) => {
      _ready = null;
      throw e;
    });
  }
  return _ready;
}
// ── Rate limiting (same fixed-window limiter as /api/auth; duplicated because
// Vercel functions must be self-contained). Fails OPEN on error. ──────
let _rlReady: Promise<void> | null = null;
function ensureRateLimitTable(): Promise<void> {
  if (!_rlReady) {
    _rlReady = db()`
      create table if not exists rate_limits (
        k text primary key, window_start bigint not null, hits int not null)`
      .then(() => undefined)
      .catch((e) => {
        _rlReady = null;
        throw e;
      });
  }
  return _rlReady;
}
async function rateLimit(key: string, max: number, windowMs: number): Promise<{ ok: boolean; retryInMin: number }> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const retryInMin = Math.max(1, Math.ceil((windowStart + windowMs - now) / 60000));
  try {
    await ensureRateLimitTable();
    const rows = (await db()`
      insert into rate_limits (k, window_start, hits) values (${key}, ${windowStart}, 1)
      on conflict (k) do update set
        hits = case when rate_limits.window_start = ${windowStart} then rate_limits.hits + 1 else 1 end,
        window_start = ${windowStart}
      returning hits`) as { hits: number }[];
    return { ok: (rows[0]?.hits ?? 1) <= max, retryInMin };
  } catch {
    return { ok: true, retryInMin };
  }
}
const clientIp = (req: VercelRequest): string => {
  const xf = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xf) ? xf[0] : xf || '';
  return (raw.split(',')[0] || 'unknown').trim().slice(0, 64) || 'unknown';
};

/** Raised when Neon has no usable price catalog. Never priced with defaults:
 *  inventing a price would silently under/over-charge the customer. */
class MissingCatalog extends Error {
  constructor() {
    super('El catálogo de precios no está configurado. Configúralo en el panel de administración antes de aceptar pedidos.');
  }
}

/** The ONE source of truth for prices: the `catalog` row in `settings`. */
async function getCatalog(): Promise<PriceCatalog> {
  let rows: { value: PriceCatalog }[] = [];
  try {
    rows = (await db()`select value from settings where key = 'catalog'`) as { value: PriceCatalog }[];
  } catch {
    throw new MissingCatalog(); // settings table not created yet
  }
  const cat = rows[0]?.value;
  if (!cat?.pagePrices || Object.keys(cat.pagePrices).length === 0) throw new MissingCatalog();
  return cat;
}

/** Effective price catalog for an order's source (mirror of catalogForSource).
 *  Exported for the parity test (see itemTotal). */
export function applySource(cat: PriceCatalog, source: string): PriceCatalog {
  const o = cat.sources?.[source];
  if (!o) return cat;
  return {
    ...cat,
    pagePrices: { ...cat.pagePrices, ...(o.pagePrices ?? {}) },
    bindingPrices: { ...cat.bindingPrices, ...(o.bindingPrices ?? {}) },
    colorSurcharge: { ...cat.colorSurcharge, ...(o.colorSurcharge ?? {}) },
    laminateSurcharge: { ...cat.laminateSurcharge, ...(o.laminateSurcharge ?? {}) },
    coverColorSurcharge: o.coverColorSurcharge ?? cat.coverColorSurcharge,
    perforatePrice: o.perforatePrice ?? cat.perforatePrice,
    holesPrice: o.holesPrice ?? cat.holesPrice,
    stickerPrice: o.stickerPrice ?? cat.stickerPrice,
    noMarginsPrice: o.noMarginsPrice ?? cat.noMarginsPrice,
    extraFolioPrice: o.extraFolioPrice ?? cat.extraFolioPrice,
    mugPrice: o.mugPrice ?? cat.mugPrice,
    badgePrice: o.badgePrice ?? cat.badgePrice,
    ringColors: (cat.ringColors ?? []).map((c) => ({ ...c, extra: o.ringExtras?.[c.name] ?? c.extra })),
    coverColors: (cat.coverColors ?? []).map((c) => ({ ...c, extra: o.coverExtras?.[c.name] ?? c.extra })),
  };
}

// ── R2 access (shared by the retention sweeps) ───────────────────────
const r2Client = () =>
  new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  });
const r2Base = () =>
  `https://${process.env.R2_ACCOUNT_ID || '5e9102f62162d87f67622085dc6528b3'}.r2.cloudflarestorage.com/${process.env.R2_BUCKET || 'copyvending'}`;

/** Delete one object. A 404 counts as success: gone is the state we want. */
async function deleteObject(client: AwsClient, base: string, key: string): Promise<boolean> {
  const signed = await client.sign(`${base}/${key}`, { method: 'DELETE', aws: { signQuery: true } });
  const res = await fetch(signed.url, { method: 'DELETE' });
  return res.ok || res.status === 404;
}

// ── File retention ───────────────────────────────────────────────────
/**
 * Delete the customer's uploaded files once an order is finished and old enough.
 *
 * Deletes FILES, never the order: the row is the sales record (statistics, the
 * quarterly VAT summary and the coupon-usage counts are all derived from it) and
 * has to be kept for years for tax purposes. What must not be kept forever are
 * other people's documents — that is both a storage cost and a GDPR obligation.
 *
 * "Finished" = delivered, or shipped, or ready for pickup (`listo`), because at
 * that point the job is printed and the file is no longer needed.
 */
const RETENTION_DAYS = Number(process.env.FILE_RETENTION_DAYS) || 10;

/** Every storage key an order item references. */
function itemKeys(item: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.startsWith('jobs/')) keys.push(v);
  };
  push(item.printImageKey);
  push(item.previewKey);
  const docs = Array.isArray(item.docs) ? (item.docs as Record<string, unknown>[]) : [];
  for (const d of docs) {
    push(d?.storageKey);
    push(d?.thumbKey);
  }
  return keys;
}

async function purgeOldFiles(days = RETENTION_DAYS): Promise<{ orders: number; files: number; errors: number }> {
  const cutoff = Date.now() - days * 86400000;
  const rows = (await db()`
    select id, items from orders
     where files_purged_at is null
       and created_at < ${cutoff}
       and (status in ('listo', 'entregado') or shipped_at is not null)
     limit 200`) as { id: string; items: Record<string, unknown>[] }[];
  if (rows.length === 0) return { orders: 0, files: 0, errors: 0 };

  const client = r2Client();
  const base = r2Base();

  let files = 0;
  let errors = 0;
  for (const row of rows) {
    const items = Array.isArray(row.items) ? row.items : [];
    const keys = items.flatMap(itemKeys);
    let ok = true;
    for (const key of keys) {
      try {
        const signed = await client.sign(`${base}/${key}`, { method: 'DELETE', aws: { signQuery: true } });
        const res = await fetch(signed.url, { method: 'DELETE' });
        // 404 means it is already gone, which is the state we want anyway.
        if (res.ok || res.status === 404) files++;
        else {
          ok = false;
          errors++;
        }
      } catch {
        ok = false;
        errors++;
      }
    }
    // Only mark it purged if everything went; otherwise it is retried next time
    // instead of leaving orphan files nobody will ever look at again.
    if (ok) await db()`update orders set files_purged_at = ${Date.now()} where id = ${row.id}`;
  }
  return { orders: rows.length, files, errors };
}

/**
 * Orphan files: uploaded to storage but referenced by NO order.
 *
 * Files land in storage the moment the customer drops them in the configurator —
 * before there is any order. So anyone who uploads a PDF just to check the price
 * and leaves, or who fills a cart and never checks out, leaves files behind that
 * the order-driven purge above can never see. On a shop with normal cart
 * abandonment this is likely MORE data than the real orders, and it is other
 * people's documents, so it is a GDPR matter as much as a storage bill.
 *
 * Matching is by FULL KEY, never by folder: the assistant studio uploads under
 * `jobs/<sessionId>/` while the resulting cart project gets a different id, so a
 * folder-based match would delete files belonging to real orders.
 */
const ORPHAN_DAYS = Number(process.env.ORPHAN_FILE_DAYS) || 10;

/** Every storage key still referenced by an order that hasn't been purged. */
async function referencedKeys(): Promise<Set<string>> {
  const rows = (await db()`select items from orders where files_purged_at is null`) as { items: Record<string, unknown>[] }[];
  const set = new Set<string>();
  for (const r of rows) {
    for (const it of Array.isArray(r.items) ? r.items : []) for (const k of itemKeys(it)) set.add(k);
  }
  return set;
}

/**
 * Files registered on upload (see api/presign) that are old enough and still
 * belong to no order: price-checkers who left, abandoned carts, failed checkouts.
 *
 * Driven by the `files` registry rather than by listing the bucket: it is one SQL
 * query instead of paginating thousands of objects, and it doubles as an inventory
 * of what is actually stored.
 */
async function purgeOrphans(days = ORPHAN_DAYS, maxDeletes = 500): Promise<{ candidates: number; deleted: number; errors: number }> {
  const cutoff = Date.now() - days * 86400000;
  const rows = (await db()`
    select key from files where created_at < ${cutoff} order by created_at limit ${maxDeletes}`) as { key: string }[];
  if (rows.length === 0) return { candidates: 0, deleted: 0, errors: 0 };

  const keep = await referencedKeys();
  const client = r2Client();
  const base = r2Base();
  let deleted = 0;
  let errors = 0;
  for (const { key } of rows) {
    if (keep.has(key)) {
      // It became a real order: stop tracking it here, the order-driven sweep
      // owns it from now on.
      await db()`delete from files where key = ${key}`;
      continue;
    }
    try {
      if (await deleteObject(client, base, key)) {
        await db()`delete from files where key = ${key}`;
        deleted++;
      } else errors++;
    } catch {
      errors++;
    }
  }
  return { candidates: rows.length, deleted, errors };
}

// ── Coupons ─────────────────────────────────────────────────────────
// Definitions live in settings key='coupons'; usage is derived by counting the
// orders that stored each code, so limits are always accurate (no separate
// counter to drift). Validation runs server-side (authoritative, anti-fraud).
type Coupon = {
  code: string; type: 'percent' | 'fixed'; value: number; active: boolean;
  minSubtotal?: number; maxUses?: number; maxUsesPerCustomer?: number; expiresAt?: number;
  sources?: string[];
};
async function getCoupons(): Promise<Coupon[]> {
  try {
    const rows = (await db()`select value from settings where key = 'coupons'`) as { value: Coupon[] }[];
    return Array.isArray(rows[0]?.value) ? rows[0].value : [];
  } catch {
    return [];
  }
}
/** Validate a coupon against a products subtotal (+ optional customer email for
 *  the per-customer limit). Returns the € discount to apply. */
async function validateCoupon(codeRaw: string, subtotal: number, email?: string, source?: string): Promise<{ ok: boolean; discount: number; code?: string; reason?: string }> {
  const code = String(codeRaw || '').trim().toUpperCase();
  if (!code) return { ok: false, discount: 0, reason: 'Introduce un código' };
  const c = (await getCoupons()).find((x) => String(x.code || '').trim().toUpperCase() === code);
  if (!c || !c.active) return { ok: false, discount: 0, reason: 'Cupón no válido' };
  if (source && Array.isArray(c.sources) && !c.sources.includes(source)) return { ok: false, discount: 0, reason: 'Cupón no válido para esta fuente' };
  if (c.expiresAt && Date.now() > Number(c.expiresAt)) return { ok: false, discount: 0, reason: 'Cupón caducado' };
  if (c.minSubtotal && subtotal < Number(c.minSubtotal)) {
    return { ok: false, discount: 0, reason: `Mínimo ${Number(c.minSubtotal).toFixed(2).replace('.', ',')} € para este cupón` };
  }
  if (c.maxUses && Number(c.maxUses) > 0) {
    const r = (await db()`select count(*)::int as n from orders where upper(coupon_code) = ${code}`) as { n: number }[];
    if ((r[0]?.n ?? 0) >= Number(c.maxUses)) return { ok: false, discount: 0, reason: 'Este cupón ya no está disponible' };
  }
  if (c.maxUsesPerCustomer && Number(c.maxUsesPerCustomer) > 0 && email) {
    const r = (await db()`select count(*)::int as n from orders where upper(coupon_code) = ${code} and lower(customer->>'email') = ${email.toLowerCase()}`) as { n: number }[];
    if ((r[0]?.n ?? 0) >= Number(c.maxUsesPerCustomer)) return { ok: false, discount: 0, reason: 'Ya has usado este cupón' };
  }
  const raw = c.type === 'percent' ? subtotal * (Number(c.value) || 0) / 100 : Number(c.value) || 0;
  const discount = Math.max(0, Math.min(Math.round(raw * 100) / 100, subtotal));
  return { ok: true, discount, code };
}

// ── Payment state (anti-fraud) ───────────────────────────────────────
// Hardening the PRICE is useless if the browser can declare itself paid. The
// customer's own request may never decide any of this: an order created with
// {paid:true} would show up as "💶 Pagado" in the backoffice and get handed over
// (or shipped, since home delivery is prepaid) without a single euro arriving.
//
// So: only the shop's own token may declare payment state. For everyone else the
// order starts unpaid and brand new, and `paid` can then only be set by the
// Redsys notification (server-to-server, signature verified) or by the admin.
const ORDER_STATUS = ['nuevo', 'en_proceso', 'listo', 'entregado'] as const;
const PAYMENT_METHODS = ['local', 'redsys'] as const;

export function orderStateFrom(
  body: { paid?: unknown; paymentMethod?: unknown; status?: unknown },
  isShop: boolean
): { paid: boolean; paymentMethod: string | null; status: string } {
  const method = typeof body.paymentMethod === 'string' && (PAYMENT_METHODS as readonly string[]).includes(body.paymentMethod)
    ? body.paymentMethod
    : null;
  if (!isShop) {
    // The chosen method is kept as an INTENT (useful in the backoffice: "is going
    // to pay by card"), but it can never imply the money arrived.
    return { paid: false, paymentMethod: method, status: 'nuevo' };
  }
  return {
    paid: body.paid === true,
    paymentMethod: method,
    status: typeof body.status === 'string' && (ORDER_STATUS as readonly string[]).includes(body.status) ? body.status : 'nuevo',
  };
}

/** One row of the per-configuration aggregation (see the `items` GET mode). */
interface ItemAggRow {
  kind: string | null;
  size: string | null;
  color: string | null;
  grosor: string | null;
  acabado: string | null;
  doble_cara: string | null;
  copias: string | null;
  count: number;
  revenue: number;
}

interface OrderRow {
  id: string; created_at: string | number; source: string; customer: unknown;
  items: unknown; total: string | number; status: string; price_mismatch?: boolean;
  paid?: boolean; payment_method?: string | null;
  shipping_method?: string | null; shipping_cost?: string | number | null;
  tracking?: string | null; shipped_at?: string | number | null; has_label?: boolean;
  coupon_code?: string | null; coupon_discount?: string | number | null;
  terms_version?: string | null; terms_accepted_at?: string | number | null;
  files_purged_at?: string | number | null;
  paid_at?: string | number | null; payment_auth_code?: string | null;
  payment_ref?: string | null; payment_amount_cents?: string | number | null;
}
function mapRow(r: OrderRow) {
  return {
    id: r.id, createdAt: Number(r.created_at), source: r.source, customer: r.customer,
    items: r.items, total: Number(r.total), status: r.status, priceMismatch: !!r.price_mismatch,
    paid: !!r.paid, paymentMethod: r.payment_method ?? undefined,
    shippingMethod: r.shipping_method ?? undefined, shippingCost: r.shipping_cost != null ? Number(r.shipping_cost) : undefined,
    tracking: r.tracking ?? undefined, shippedAt: r.shipped_at != null ? Number(r.shipped_at) : undefined,
    hasLabel: !!r.has_label,
    couponCode: r.coupon_code ?? undefined, couponDiscount: r.coupon_discount != null ? Number(r.coupon_discount) : undefined,
    filesPurgedAt: r.files_purged_at != null ? Number(r.files_purged_at) : undefined,
    termsVersion: r.terms_version ?? undefined,
    termsAcceptedAt: r.terms_accepted_at != null ? Number(r.terms_accepted_at) : undefined,
    paidAt: r.paid_at != null ? Number(r.paid_at) : undefined,
    paymentAuthCode: r.payment_auth_code ?? undefined,
    paymentRef: r.payment_ref ?? undefined,
    paymentAmountCents: r.payment_amount_cents != null ? Number(r.payment_amount_cents) : undefined,
  };
}

/** Shipping zone from a Spanish postal code. Not served: Canarias (35/38).
 *  Baleares 07; rest (incl. Ceuta/Melilla) peninsula. */
function zoneForCP(cp: string): 'peninsula' | 'baleares' | 'noservido' | null {
  const p = (cp || '').trim().slice(0, 2);
  if (!/^\d{2}$/.test(p)) return null;
  if (['35', '38'].includes(p)) return 'noservido';
  if (p === '07') return 'baleares';
  return 'peninsula';
}
function queryId(req: VercelRequest): string | undefined {
  const v = req.query.id;
  return Array.isArray(v) ? v[0] : v;
}
const queryStr = (req: VercelRequest, k: string): string =>
  (Array.isArray(req.query[k]) ? (req.query[k] as string[])[0] : (req.query[k] as string | undefined)) ?? '';

/**
 * Ownership check for the customer-facing endpoints: the order code ALONE is not
 * enough, the email on the order must match too. Codes are short (people read
 * them out loud), so on their own they are guessable; requiring the email makes
 * a stolen/guessed code useless and keeps every customer's personal data out of
 * reach. The shop's own admin token bypasses this (it sees everything anyway).
 */
async function ownsOrder(sql: NeonQueryFunction<false, false>, id: string, email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  const rows = (await sql`select 1 as ok from orders where id = ${id} and lower(customer->>'email') = ${e}`) as { ok: number }[];
  return rows.length > 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await ensureSchema();
    const sql = db();

    if (req.method === 'GET') {
      const id = queryId(req);
      // Validate a coupon (public preview for the checkout: never lists codes).
      // Throttled so the endpoint can't be used to fish for valid codes.
      if (req.query.coupon !== undefined) {
        const gate = await rateLimit(`coupon:${clientIp(req)}`, 30, 10 * 60 * 1000);
        if (!gate.ok) return res.status(429).json({ ok: false, discount: 0, reason: 'Demasiados intentos. Prueba en unos minutos.' });
        const q = (k: string) => (Array.isArray(req.query[k]) ? (req.query[k] as string[])[0] : (req.query[k] as string | undefined));
        const v = await validateCoupon(q('coupon') || '', Number(q('subtotal')) || 0, q('email'), q('source') || 'online');
        return res.status(200).json(v);
      }
      // Aggregated stats over the FULL history (SQL GROUP BY), no 2000 cap. Admin.
      if (req.query.agg !== undefined) {
        if (!requireAdmin(req, res)) return;
        const qa = (k: string) => (Array.isArray(req.query[k]) ? (req.query[k] as string[])[0] : (req.query[k] as string | undefined));
        const from = Number(qa('from')) || 0;
        const to = Number(qa('to')) || Number.MAX_SAFE_INTEGER;
        const src = qa('source') || 'all';
        const fmt = qa('unit') === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
        const series = (await sql`
          select to_char(to_timestamp(created_at / 1000.0) at time zone 'Europe/Madrid', ${fmt}) as period,
                 count(*)::int as orders, coalesce(sum(total), 0)::float8 as revenue
          from orders
          where created_at >= ${from} and created_at <= ${to} and (${src} = 'all' or source = ${src})
          group by period order by period`) as { period: string; orders: number; revenue: number }[];
        const bySource = (await sql`
          select source as key, count(*)::int as count, coalesce(sum(total), 0)::float8 as revenue
          from orders
          where created_at >= ${from} and created_at <= ${to}
          group by source order by revenue desc`) as { key: string; count: number; revenue: number }[];
        const monthsRows = (await sql`
          select distinct to_char(to_timestamp(created_at / 1000.0) at time zone 'Europe/Madrid', 'YYYY-MM') as period
          from orders where (${src} = 'all' or source = ${src}) order by period`) as { period: string }[];
        const totals = series.reduce((a, r) => ({ revenue: a.revenue + r.revenue, orders: a.orders + r.orders }), { revenue: 0, orders: 0 });
        return res.status(200).json({ totals, series, bySource, allMonths: monthsRows.map((m) => m.period) });
      }
      // Breakdown by print CONFIGURATION over the full history. Needs the detail
      // of each item, so it unnests the items jsonb and groups in SQL — otherwise
      // the client would have to do it over the 2000 orders it can hold, which
      // silently under-reports anything older. Admin.
      if (req.query.items !== undefined) {
        if (!requireAdmin(req, res)) return;
        const qi = (k: string) => (Array.isArray(req.query[k]) ? (req.query[k] as string[])[0] : (req.query[k] as string | undefined));
        const from = Number(qi('from')) || 0;
        const to = Number(qi('to')) || Number.MAX_SAFE_INTEGER;
        const src = qi('source') || 'all';
        // `total` is written by us as a number, but historical/imported rows may
        // carry anything — a bad value must not abort the whole query, so it is
        // only cast when it actually looks numeric.
        const rows = (await sql`
          select
            it->>'kind'                                  as kind,
            it->'config'->>'size'                        as size,
            it->'config'->>'color'                       as color,
            it->'config'->>'grosor'                      as grosor,
            it->'config'->>'acabado'                     as acabado,
            it->'config'->>'dobleCara'                   as doble_cara,
            coalesce(it->>'copias', it->>'cantidad')      as copias,
            count(*)::int                                as count,
            coalesce(sum(case when it->>'total' ~ '^-?[0-9]+(\.[0-9]+)?$' then (it->>'total')::float8 else 0 end), 0)::float8 as revenue
          from orders o, jsonb_array_elements(o.items) as it
          where o.created_at >= ${from} and o.created_at <= ${to} and (${src} = 'all' or o.source = ${src})
          group by 1, 2, 3, 4, 5, 6, 7`) as ItemAggRow[];
        return res.status(200).json({ rows });
      }
      // Backoffice: search customers by email (admin only). Returns basic
      // profile + address + order count for each match.
      if (req.query.findCustomer !== undefined) {
        if (!requireAdmin(req, res)) return;
        const term = (queryStr(req, 'findCustomer') || '').trim().toLowerCase();
        if (term.length < 2) return res.status(200).json({ customers: [] });
        const customers = await sql`
          select c.id, c.email, c.nombre, c.apellidos, c.telefono, c.addresses, c.marketing_consent, c.created_at,
                 (select count(*) from orders o where lower(o.customer->>'email') = lower(c.email))::int as orders_count
          from customers c
          where c.email ilike ${'%' + term + '%'}
          order by c.email
          limit 25`;
        return res.status(200).json({ customers });
      }
      // Backoffice: all orders of a given customer email (admin only).
      if (req.query.customerOrders !== undefined) {
        if (!requireAdmin(req, res)) return;
        const email = (queryStr(req, 'customerOrders') || '').trim().toLowerCase();
        if (!email) return res.status(400).json({ error: 'falta email' });
        const orders = await sql`
          select id, created_at, source, total, status, paid, shipping_method, coupon_code, coupon_discount
          from orders where lower(customer->>'email') = ${email}
          order by created_at desc limit 500`;
        return res.status(200).json({ orders });
      }
      // Download a stored GLS label (base64 PDF) on demand — kept out of the
      // list/detail payloads because it's large. Admin only.
      if (id && req.query.label !== undefined) {
        if (!requireAdmin(req, res)) return;
        const rows = (await sql`select label from orders where id = ${id}`) as { label: string | null }[];
        if (rows.length === 0 || !rows[0].label) return res.status(404).json({ error: 'sin etiqueta' });
        return res.status(200).json({ label: rows[0].label });
      }
      // Single order: the customer must prove ownership with code + email.
      if (id) {
        if (!isAdmin(req)) {
          // Throttle so the pair (code, email) can't be brute-forced.
          const gate = await rateLimit(`order:${clientIp(req)}`, 30, 10 * 60 * 1000);
          if (!gate.ok) return res.status(429).json({ error: `Demasiadas consultas. Prueba de nuevo en ${gate.retryInMin} min.` });
          const email = queryStr(req, 'email');
          if (!email) return res.status(400).json({ error: 'Indica el email con el que hiciste el pedido.' });
          // Same answer whether the code doesn't exist or the email doesn't match,
          // so this can't be used to find out which codes are real.
          if (!(await ownsOrder(sql, id, email))) {
            return res.status(404).json({ error: 'No encontramos ningún pedido con ese código y ese email.' });
          }
        }
        const rows = (await sql`
          select id, created_at, source, customer, items, total, status, price_mismatch, paid, payment_method, shipping_method, shipping_cost, tracking, shipped_at, (label is not null) as has_label, coupon_code, coupon_discount, terms_version, terms_accepted_at, files_purged_at, paid_at, payment_auth_code, payment_ref, payment_amount_cents
          from orders where id = ${id}`) as OrderRow[];
        if (rows.length === 0) return res.status(404).json({ error: 'pedido no encontrado' });
        return res.status(200).json(mapRow(rows[0]));
      }
      // Full list exposes every customer's data → admin only.
      //
      // Paginated by CURSOR, not by a fixed cap: with a real order history a
      // `limit 2000` silently hides everything older, and the shop just sees its
      // old orders "disappear". Filtering and the counters are done in SQL too —
      // filtering a single page client-side would show numbers that don't match
      // the list.
      if (!requireAdmin(req, res)) return;
      const lim = Math.min(Math.max(Number(queryStr(req, 'limit')) || 40, 1), 200);
      const beforeAt = Number(queryStr(req, 'before')) || 0;
      const beforeId = queryStr(req, 'beforeId');
      const fStatus = queryStr(req, 'status');
      const fSource = queryStr(req, 'source');
      const term = queryStr(req, 'q').trim().slice(0, 80);
      const like = `%${term}%`;
      const rows = (await sql`
        select id, created_at, source, customer, items, total, status, price_mismatch, paid, payment_method, shipping_method, shipping_cost, tracking, shipped_at, (label is not null) as has_label, coupon_code, coupon_discount, terms_version, terms_accepted_at, files_purged_at, paid_at, payment_auth_code, payment_ref, payment_amount_cents
        from orders
        where (${beforeAt} = 0 or (created_at, id) < (${beforeAt}, ${beforeId}))
          and (${fStatus} = '' or status = ${fStatus})
          and (${fSource} = '' or source = ${fSource})
          and (${term} = '' or id ilike ${like} or customer->>'email' ilike ${like}
               or customer->>'nombre' ilike ${like} or customer->>'apellidos' ilike ${like})
        order by created_at desc, id desc
        limit ${lim}`) as OrderRow[];
      // Counters over the WHOLE history (respecting only the search), so the
      // filter badges tell the truth instead of counting the current page.
      const counts = (await sql`
        select status, source, count(*)::int as n from orders
        where (${term} = '' or id ilike ${like} or customer->>'email' ilike ${like}
               or customer->>'nombre' ilike ${like} or customer->>'apellidos' ilike ${like})
        group by status, source`) as { status: string; source: string; n: number }[];
      const last = rows[rows.length - 1];
      return res.status(200).json({
        orders: rows.map(mapRow),
        counts,
        // Present only while there may be more; the client stops asking when null.
        nextCursor: rows.length === lim && last ? { at: Number(last.created_at), id: last.id } : null,
      });
    }

    if (req.method === 'POST') {
      // Retention sweep: delete the files of finished orders older than the
      // retention window. The orders themselves are never touched.
      if (req.query.purge !== undefined) {
        if (!requireAdmin(req, res)) return;
        const q = Array.isArray(req.query.days) ? req.query.days[0] : req.query.days;
        const days = Number(q) > 0 ? Number(q) : RETENTION_DAYS;
        const orders = await purgeOldFiles(days);
        // Second sweep: files that never became an order at all (price checks,
        // abandoned carts). Driven by the upload registry (see api/presign).
        const orphans = await purgeOrphans();
        return res.status(200).json({ ok: true, days, orders, orphans });
      }

      const o = req.body as {
        id?: string; createdAt?: number; source?: string; customer?: unknown;
        items?: Record<string, unknown>[]; total?: number; status?: string;
        paid?: boolean; paymentMethod?: string; shippingMethod?: string; couponCode?: string;
        termsVersion?: string; termsAcceptedAt?: number;
      };
      if (!o || typeof o.id !== 'string') return res.status(400).json({ error: 'pedido inválido' });

      // Which price list applies is decided HERE, never by the browser:
      // /papeleria.html is publicly reachable, so a claim of "I'm the counter"
      // (usually the cheaper tariff) has to be proven with the counter token.
      //  - admin token   → the shop itself (backoffice, email ingestion): may
      //                    declare the source explicitly.
      //  - counter token → the shop-floor tablet: 'mostrador'.
      //  - anything else → 'online' (the public web, and the safe default: it
      //                    can never end up cheaper than it should be).
      const shopRequest = isAdmin(req);
      const declared = typeof o.source === 'string' && ['online', 'mostrador', 'email'].includes(o.source) ? o.source : null;
      const source = shopRequest && declared ? declared : isCounter(req) ? 'mostrador' : 'online';
      // Payment state decided here too, never by the browser (see orderStateFrom).
      const state = orderStateFrom(o, shopRequest);
      const base = await getCatalog();
      const catalog = applySource(base, source);
      const sourceMods = base.sources?.[source]?.modules ?? {};
      const items = Array.isArray(o.items) ? o.items : [];
      let serverTotal = 0;
      const pricedItems = items.map((it) => {
        const t = itemTotal(it, catalog);
        serverTotal += t;
        return { ...it, total: t };
      });
      const itemsSubtotal = Math.round(serverTotal * 100) / 100;

      // Shipping recomputed here (anti-fraud): zone by CP + free-shipping threshold.
      const ship = (catalog as unknown as { shipping?: { enabled?: boolean; peninsula?: number; baleares?: number; freeThreshold?: number } }).shipping;
      const cust = (o.customer ?? {}) as { shipping?: { cp?: string } };
      let shippingMethod = o.shippingMethod === 'envio' ? 'envio' : 'recoger';
      let shippingCost = 0;
      if (shippingMethod === 'envio') {
        if (!ship || !(sourceMods.shipping ?? ship.enabled)) return res.status(400).json({ error: 'Los envíos no están disponibles' });
        const zone = zoneForCP(cust.shipping?.cp ?? '');
        if (!zone || zone === 'noservido') return res.status(400).json({ error: 'No realizamos envíos a ese código postal' });
        const shipBase = zone === 'baleares' ? Number(ship.baleares) || 0 : Number(ship.peninsula) || 0;
        const threshold = Number(ship.freeThreshold) || 0;
        shippingCost = threshold > 0 && itemsSubtotal >= threshold ? 0 : shipBase;
      }

      // Coupon (validated + applied server-side; discount on the products
      // subtotal, BEFORE shipping). Invalid/expired/exhausted → simply ignored.
      let couponCode: string | null = null;
      let couponDiscount = 0;
      if ((sourceMods.coupons ?? true) && typeof o.couponCode === 'string' && o.couponCode.trim()) {
        const email = (o.customer as { email?: string } | undefined)?.email;
        const v = await validateCoupon(o.couponCode, itemsSubtotal, email, source);
        if (v.ok) {
          couponCode = v.code ?? null;
          couponDiscount = v.discount;
        }
      }
      const discountedSubtotal = Math.max(0, Math.round((itemsSubtotal - couponDiscount) * 100) / 100);
      serverTotal = Math.round((discountedSubtotal + shippingCost) * 100) / 100;

      // Email orders intentionally arrive with total 0 (priced here), so a
      // difference there isn't a client mismatch — only flag client sources.
      const mismatch =
        source !== 'email' && Math.round((Number(o.total) || 0) * 100) !== Math.round(serverTotal * 100);

      const ins = (await sql`
        insert into orders (id, created_at, source, customer, items, total, status, price_mismatch, paid, payment_method, shipping_method, shipping_cost, coupon_code, coupon_discount, terms_version, terms_accepted_at, files_purged_at, paid_at, payment_auth_code, payment_ref, payment_amount_cents)
        values (${o.id}, ${o.createdAt ?? Date.now()}, ${source},
                ${JSON.stringify(o.customer ?? {})}::jsonb, ${JSON.stringify(pricedItems)}::jsonb,
                ${serverTotal}, ${state.status}, ${mismatch}, ${state.paid}, ${state.paymentMethod},
                ${shippingMethod}, ${shippingCost}, ${couponCode}, ${couponDiscount},
                ${typeof o.termsVersion === 'string' ? o.termsVersion.slice(0, 20) : null},
                ${Number(o.termsAcceptedAt) > 0 ? Number(o.termsAcceptedAt) : null})
        on conflict (id) do nothing
        returning id`) as { id: string }[];
      // Confirmación al cliente SOLO en pedidos WEB (online) y solo si es nuevo
      // (no re-envío en un POST duplicado). En mostrador el cliente está delante.
      if (ins.length > 0 && source === 'online') {
        const c = (o.customer ?? {}) as { email?: string; nombre?: string };
        if (c.email) {
          try {
            await sendOrderMail(c.email, c.nombre ?? '', o.id, serverTotal);
          } catch (e) {
            console.error('[email]', e); // best-effort, pero visible en logs
          }
        }
      }
      return res.status(201).json({ ok: true, total: serverTotal, priceMismatch: mismatch, couponCode, couponDiscount });
    }

    if (req.method === 'PATCH') {
      const id = queryId(req);
      const body = (req.body ?? {}) as { status?: string; paid?: boolean; paymentMethod?: string; tracking?: string; shipped?: boolean; generateGls?: boolean; deleteGls?: boolean };
      if (!id) return res.status(400).json({ error: 'falta id' });
      if (!requireAdmin(req, res)) return; // order management is admin-only

      // Delete the stored GLS label so a fresh one can be generated. Clears the
      // label + tracking + shipped mark locally (the old GLS expedition, if any,
      // stays in your GLS account — cancel it there if needed).
      if (body.deleteGls) {
        await sql`update orders set label = null, tracking = null, shipped_at = null where id = ${id}`;
        return res.status(200).json({ ok: true });
      }

      // Generate a GLS shipment: registers it with GLS, stores the returned
      // tracking + label, and emails the customer. Replaces the manual tracking.
      if (body.generateGls) {
        const r = (await sql`select customer from orders where id = ${id}`) as { customer: GlsCustomer | null }[];
        if (r.length === 0) return res.status(404).json({ error: 'pedido no encontrado' });
        const cust = (r[0].customer ?? {}) as GlsCustomer;
        const glsCfg = await getGlsConfig();
        const g = await createGlsShipment(id, cust, glsCfg ?? undefined);
        if (!g.ok) return res.status(502).json({ error: g.error });
        const now = Date.now();
        await sql`update orders set tracking = ${g.tracking!}, shipped_at = ${now}, label = ${g.label ?? null} where id = ${id}`;
        try {
          if (cust.email) await sendShipMail(cust.email, cust.nombre ?? '', id, `GLS ${g.tracking} — ${GLS_TRACK_URL}${g.tracking}`);
        } catch (e) {
          console.error('[email]', e); // best-effort, pero visible en logs
        }
        return res.status(200).json({ ok: true, tracking: g.tracking, shippedAt: now, hasLabel: !!g.label, trackUrl: `${GLS_TRACK_URL}${g.tracking}` });
      }

      if (typeof body.status === 'string') {
        // Avisar "Listo para recoger" al pasar a 'listo' (solo recogida, solo si
        // cambia de estado — evita reenvíos al reclicar).
        if (body.status === 'listo') {
          const r = (await sql`select status, customer, shipping_method from orders where id = ${id}`) as { status: string; customer: { email?: string; nombre?: string } | null; shipping_method: string | null }[];
          await sql`update orders set status = ${body.status} where id = ${id}`;
          const row = r[0];
          if (row && row.status !== 'listo' && row.shipping_method !== 'envio' && row.customer?.email) {
            try {
              await sendReadyMail(row.customer.email, row.customer.nombre ?? '', id);
            } catch (e) {
              console.error('[email]', e); // best-effort, pero visible en logs
            }
          }
        } else {
          await sql`update orders set status = ${body.status} where id = ${id}`;
        }
      }
      if (typeof body.paid === 'boolean') {
        await sql`update orders set paid = ${body.paid}, payment_method = ${body.paymentMethod ?? 'local'} where id = ${id}`;
      }
      if (body.shipped !== undefined || body.tracking !== undefined) {
        await sql`update orders set tracking = ${body.tracking ?? null}, shipped_at = ${body.shipped ? Date.now() : null} where id = ${id}`;
        if (body.shipped) {
          try {
            const r = (await sql`select customer from orders where id = ${id}`) as { customer: { nombre?: string; email?: string } | null }[];
            const c = r[0]?.customer;
            if (c?.email) await sendShipMail(c.email, c.nombre ?? '', id, body.tracking ?? '');
          } catch (e) {
            console.error('[email]', e); // best-effort, pero visible en logs
          }
        }
      }
      return res.status(200).json({ ok: true });
    }

    // Modify an order — ONLY while it is still in the initial state. Accepts
    // either { items } (replace all) or { item } (replace one project by id,
    // keeping the rest — used to edit a single project of a multi-project order).
    if (req.method === 'PUT') {
      const id = queryId(req);
      const body = req.body as { items?: Record<string, unknown>[]; item?: Record<string, unknown>; email?: string };
      if (!id || (!Array.isArray(body.items) && !body.item)) return res.status(400).json({ error: 'faltan datos' });
      // Only the owner (code + email) or the shop may rewrite an order's contents.
      if (!isAdmin(req) && !(await ownsOrder(sql, id, String(body.email ?? '')))) {
        return res.status(403).json({ error: 'No puedes modificar este pedido.' });
      }
      const cur = (await sql`select status, items, source from orders where id = ${id}`) as { status: string; items: Record<string, unknown>[]; source: string }[];
      if (cur.length === 0) return res.status(404).json({ error: 'pedido no encontrado' });
      if (cur[0].status !== 'nuevo') {
        return res.status(409).json({ error: 'El pedido ya está en proceso y no se puede modificar.' });
      }

      let items: Record<string, unknown>[];
      if (body.item) {
        const existing = Array.isArray(cur[0].items) ? cur[0].items : [];
        let found = false;
        items = existing.map((x) => {
          if (x && (x as { id?: unknown }).id === (body.item as { id?: unknown }).id) {
            found = true;
            return body.item as Record<string, unknown>;
          }
          return x;
        });
        if (!found) items.push(body.item);
      } else {
        items = body.items as Record<string, unknown>[];
      }

      const catalog = applySource(await getCatalog(), cur[0].source || 'mostrador');
      let serverTotal = 0;
      const priced = items.map((it) => {
        const t = itemTotal(it, catalog);
        serverTotal += t;
        return { ...it, total: t };
      });
      serverTotal = Math.round(serverTotal * 100) / 100;
      await sql`update orders set items = ${JSON.stringify(priced)}::jsonb, total = ${serverTotal} where id = ${id} and status = 'nuevo'`;
      return res.status(200).json({ ok: true, total: serverTotal });
    }

    if (req.method === 'DELETE') {
      const id = queryId(req);
      if (!id) return res.status(400).json({ error: 'falta id' });
      if (!requireAdmin(req, res)) return; // deleting orders is admin-only
      await sql`delete from orders where id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    if (e instanceof MissingCatalog) return res.status(503).json({ error: e.message });
    // Don't leak internals (DB errors, connection strings) to the client.
    console.error('[orders]', e);
    return res.status(500).json({ error: 'Error del servidor al procesar el pedido.' });
  }
}
