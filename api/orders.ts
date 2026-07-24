import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import nodemailer from 'nodemailer';
import { createHmac, timingSafeEqual } from 'crypto';

// Backoffice admin auth: verify the stateless token issued by /api/auth. Auth is
// OFF until ADMIN_PASSWORD is set (prototype stays open); setting it enforces
// protection on the admin-only operations below.
const ADMIN_AUTH_ON = !!process.env.ADMIN_PASSWORD;
const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || '';
function isAdmin(req: VercelRequest): boolean {
  if (!ADMIN_SECRET) return false;
  const h = req.headers['authorization'];
  const raw = Array.isArray(h) ? h[0] : h || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  if (!m) return false;
  const [expStr, sig] = m[1].split('.');
  const exp = Number(expStr);
  if (!exp || exp < Date.now() || !sig) return false;
  const expected = createHmac('sha256', ADMIN_SECRET).update(`admin.${exp}`).digest('base64url');
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
/** Allow the request through, or send 401 and return false. */
function requireAdmin(req: VercelRequest, res: VercelResponse): boolean {
  if (!ADMIN_AUTH_ON || isAdmin(req)) return true;
  res.status(401).json({ error: 'Necesitas iniciar sesión como administrador.' });
  return false;
}

// Shipment-notification email (folded in here to stay under the Hobby 12-function
// limit). Best-effort; uses the shop Gmail SMTP.
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://copyvending.vercel.app';
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_PASS = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const SHOP_NAME = process.env.SHOP_NAME || 'Copistería';
async function sendShipMail(to: string, nombre: string, orderId: string, tracking: string): Promise<void> {
  if (!GMAIL_USER || !GMAIL_PASS || !to) return;
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
  await t.sendMail({
    from: `${SHOP_NAME} <${GMAIL_USER}>`,
    to,
    subject: `Tu pedido ${orderId} va en camino 🚚`,
    text: `Hola ${nombre}:\n\nTu pedido ${orderId} ya está en camino.\n${tracking ? `Seguimiento: ${tracking}\n` : ''}\nPuedes ver su estado aquí:\n${PUBLIC_URL}/#recoger/${orderId}\n\nGracias por tu compra.\n${SHOP_NAME}`,
  });
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
// math below is a synced copy of src/domain/priceEngine.ts. Keep them in sync;
// both read the SAME admin catalog persisted in Neon, so results match and we
// can validate the price the client sent (anti-fraud).

// ── Fallback pricing values (used only if Neon has no catalog yet) ───
// Mirror of the pricing-relevant fields of DEFAULT_CATALOG.
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
const FALLBACK: PriceCatalog = {
  pagePrices: {
    'A3-80-BN-0': 0.07, 'A3-80-BN-1': 0.06, 'A3-80-Color-0': 0.22, 'A3-80-Color-1': 0.2,
    'A3-100-BN-0': 0.1, 'A3-100-BN-1': 0.08, 'A3-100-Color-0': 0.24, 'A3-100-Color-1': 0.22,
    'A3-250-BN-0': 0.4, 'A3-250-Color-0': 0.6,
    'A4-80-BN-0': 0.025, 'A4-80-BN-1': 0.0215, 'A4-80-Color-0': 0.085, 'A4-80-Color-1': 0.08,
    'A4-90-BN-0': 0.04, 'A4-90-BN-1': 0.0319, 'A4-90-Color-0': 0.119, 'A4-90-Color-1': 0.109,
    'A4-100-BN-0': 0.075, 'A4-100-BN-1': 0.05, 'A4-100-Color-0': 0.135, 'A4-100-Color-1': 0.12,
    'A4-120-BN-0': 0.099, 'A4-120-BN-1': 0.079, 'A4-120-Color-0': 0.169, 'A4-120-Color-1': 0.159,
    'A4-160-BN-0': 0.08, 'A4-160-BN-1': 0.07, 'A4-160-Color-0': 0.18, 'A4-160-Color-1': 0.16,
    'A4-250-BN-0': 0.25, 'A4-250-Color-0': 0.4,
    'A5-80-BN-0': 0.026, 'A5-80-BN-1': 0.02, 'A5-80-Color-0': 0.085, 'A5-80-Color-1': 0.08,
    'A5-90-BN-0': 0.04, 'A5-90-BN-1': 0.03, 'A5-90-Color-0': 0.1, 'A5-90-Color-1': 0.09,
    'A5-100-BN-0': 0.05, 'A5-100-BN-1': 0.04, 'A5-100-Color-0': 0.12, 'A5-100-Color-1': 0.11,
    'A5-120-BN-0': 0.06, 'A5-120-BN-1': 0.05, 'A5-120-Color-0': 0.135, 'A5-120-Color-1': 0.12,
    'A5-160-BN-0': 0.08, 'A5-160-BN-1': 0.07, 'A5-160-Color-0': 0.18, 'A5-160-Color-1': 0.16,
    'A5-250-BN-0': 0.15, 'A5-250-Color-0': 0.25,
  },
  bindingPrices: { sinencuadernacion: 0, grapado: 0.05, AnillasColores: 1.99, dos_agujeros: 0.25, cuatro_agujeros: 0.25, perforado: 0 },
  colorSurcharge: { A4: 0.08, A5: 0.08, A3: 0.15 },
  laminateSurcharge: { A4: 0.99, A5: 0.99, A3: 1.5 },
  coverColorSurcharge: 0.3,
  perforatePrice: 0.5,
  holesPrice: 0.1,
  stickerPrice: 0.15,
  noMarginsPrice: 0.8,
  extraFolioPrice: 0.1,
  mugPrice: 9.95,
  badgePrice: 2.5,
};

// ── Pricing (synced copy of src/domain/priceEngine.ts) ───────────────
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
function itemTotal(item: Record<string, unknown>, cat: PriceCatalog): number {
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
    })().catch((e) => {
      _ready = null;
      throw e;
    });
  }
  return _ready;
}
async function getCatalog(): Promise<PriceCatalog> {
  try {
    const rows = (await db()`select value from settings where key = 'catalog'`) as { value: PriceCatalog }[];
    if (rows[0]?.value?.pagePrices) return rows[0].value;
  } catch {
    /* settings table may not exist yet → fallback */
  }
  return FALLBACK;
}

/** Effective price catalog for an order's source (mirror of catalogForSource). */
function applySource(cat: PriceCatalog, source: string): PriceCatalog {
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

// ── Coupons ─────────────────────────────────────────────────────────
// Definitions live in settings key='coupons'; usage is derived by counting the
// orders that stored each code, so limits are always accurate (no separate
// counter to drift). Validation runs server-side (authoritative, anti-fraud).
type Coupon = {
  code: string; type: 'percent' | 'fixed'; value: number; active: boolean;
  minSubtotal?: number; maxUses?: number; maxUsesPerCustomer?: number; expiresAt?: number;
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
async function validateCoupon(codeRaw: string, subtotal: number, email?: string): Promise<{ ok: boolean; discount: number; code?: string; reason?: string }> {
  const code = String(codeRaw || '').trim().toUpperCase();
  if (!code) return { ok: false, discount: 0, reason: 'Introduce un código' };
  const c = (await getCoupons()).find((x) => String(x.code || '').trim().toUpperCase() === code);
  if (!c || !c.active) return { ok: false, discount: 0, reason: 'Cupón no válido' };
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

interface OrderRow {
  id: string; created_at: string | number; source: string; customer: unknown;
  items: unknown; total: string | number; status: string; price_mismatch?: boolean;
  paid?: boolean; payment_method?: string | null;
  shipping_method?: string | null; shipping_cost?: string | number | null;
  tracking?: string | null; shipped_at?: string | number | null; has_label?: boolean;
  coupon_code?: string | null; coupon_discount?: string | number | null;
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await ensureSchema();
    const sql = db();

    if (req.method === 'GET') {
      const id = queryId(req);
      // Validate a coupon (public preview for the checkout: never lists codes).
      if (req.query.coupon !== undefined) {
        const q = (k: string) => (Array.isArray(req.query[k]) ? (req.query[k] as string[])[0] : (req.query[k] as string | undefined));
        const v = await validateCoupon(q('coupon') || '', Number(q('subtotal')) || 0, q('email'));
        return res.status(200).json(v);
      }
      // Download a stored GLS label (base64 PDF) on demand — kept out of the
      // list/detail payloads because it's large. Admin only.
      if (id && req.query.label !== undefined) {
        if (!requireAdmin(req, res)) return;
        const rows = (await sql`select label from orders where id = ${id}`) as { label: string | null }[];
        if (rows.length === 0 || !rows[0].label) return res.status(404).json({ error: 'sin etiqueta' });
        return res.status(200).json({ label: rows[0].label });
      }
      // Single order by code stays public (customers look up their own pickup).
      if (id) {
        const rows = (await sql`
          select id, created_at, source, customer, items, total, status, price_mismatch, paid, payment_method, shipping_method, shipping_cost, tracking, shipped_at, (label is not null) as has_label, coupon_code, coupon_discount
          from orders where id = ${id}`) as OrderRow[];
        if (rows.length === 0) return res.status(404).json({ error: 'pedido no encontrado' });
        return res.status(200).json(mapRow(rows[0]));
      }
      // Full list exposes every customer's data → admin only.
      if (!requireAdmin(req, res)) return;
      const rows = (await sql`
        select id, created_at, source, customer, items, total, status, price_mismatch, paid, payment_method, shipping_method, shipping_cost, tracking, shipped_at, (label is not null) as has_label, coupon_code, coupon_discount
        from orders order by created_at desc limit 2000`) as OrderRow[];
      return res.status(200).json(rows.map(mapRow));
    }

    if (req.method === 'POST') {
      const o = req.body as {
        id?: string; createdAt?: number; source?: string; customer?: unknown;
        items?: Record<string, unknown>[]; total?: number; status?: string;
        paid?: boolean; paymentMethod?: string; shippingMethod?: string; couponCode?: string;
      };
      if (!o || typeof o.id !== 'string') return res.status(400).json({ error: 'pedido inválido' });

      // Anti-fraud: recompute totals server-side with the Neon catalog for THIS
      // order's source; the client-sent price is never trusted.
      const source = typeof o.source === 'string' ? o.source : 'mostrador';
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
        const v = await validateCoupon(o.couponCode, itemsSubtotal, email);
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
        o.source !== 'email' && Math.round((Number(o.total) || 0) * 100) !== Math.round(serverTotal * 100);

      await sql`
        insert into orders (id, created_at, source, customer, items, total, status, price_mismatch, paid, payment_method, shipping_method, shipping_cost, coupon_code, coupon_discount)
        values (${o.id}, ${o.createdAt ?? Date.now()}, ${o.source ?? 'mostrador'},
                ${JSON.stringify(o.customer ?? {})}::jsonb, ${JSON.stringify(pricedItems)}::jsonb,
                ${serverTotal}, ${o.status ?? 'nuevo'}, ${mismatch}, ${o.paid ?? false}, ${o.paymentMethod ?? null},
                ${shippingMethod}, ${shippingCost}, ${couponCode}, ${couponDiscount})
        on conflict (id) do nothing`;
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
        } catch {
          /* email opcional */
        }
        return res.status(200).json({ ok: true, tracking: g.tracking, shippedAt: now, hasLabel: !!g.label, trackUrl: `${GLS_TRACK_URL}${g.tracking}` });
      }

      if (typeof body.status === 'string') await sql`update orders set status = ${body.status} where id = ${id}`;
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
          } catch {
            /* email opcional */
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
      const body = req.body as { items?: Record<string, unknown>[]; item?: Record<string, unknown> };
      if (!id || (!Array.isArray(body.items) && !body.item)) return res.status(400).json({ error: 'faltan datos' });
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
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error de base de datos' });
  }
}
