import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AwsClient } from 'aws4fetch';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { PDFDocument } from 'pdf-lib';

// Self-contained (no ../src imports — they break the Vercel runtime). Pricing
// and the order insert are delegated to /api/orders, which is authoritative.
const SELF_URL = process.env.SELF_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://copyvending.vercel.app');

/**
 * Email → print order pipeline. This endpoint processes ONE normalised email
 * (from, subject, text, attachments) into a print order:
 *   dedupe by messageId → AI-parse the instructions → upload files to R2 →
 *   create an order (source: 'email') in Neon → return the order code.
 *
 * Reading the real inbox (Gmail IMAP / API) is added later; for now the email
 * is provided in the request body (so the whole pipeline can be tested with a
 * fake email). The processing is identical regardless of the source, so wiring
 * the real inbox on top requires no changes here.
 */

// ── R2 (self-contained, like /api/presign) ──────────────────────────
const ACCOUNT = process.env.R2_ACCOUNT_ID || '5e9102f62162d87f67622085dc6528b3';
const BUCKET = process.env.R2_BUCKET || 'copyvending';
const R2_BASE = `https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}`;
const ACCEPTED = ['application/pdf', 'image/'];
const MAX_MB = 300;

function r2(): AwsClient {
  return new AwsClient({ accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '' });
}
function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12) : '';
}
async function uploadToR2(projectId: string, name: string, type: string, bytes: Uint8Array): Promise<string> {
  const key = `jobs/${projectId}/${crypto.randomUUID()}${extOf(name)}`;
  const signed = await r2().sign(`${R2_BASE}/${key}?X-Amz-Expires=3600`, { method: 'PUT', aws: { signQuery: true } });
  const put = await fetch(signed.url, { method: 'PUT', body: bytes as BodyInit, headers: type ? { 'Content-Type': type } : undefined });
  if (!put.ok) throw new Error(`R2 PUT ${put.status}`);
  return key;
}

// ── Neon (self-contained) ────────────────────────────────────────────
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
      // Dedupe: one row per processed email so re-triggers never duplicate orders.
      await db()`
        create table if not exists email_jobs (
          message_id text primary key, order_id text, created_at bigint not null)`;
    })().catch((e) => {
      _ready = null;
      throw e;
    });
  }
  return _ready;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Map a loose colour word ("amarilla", "azul") to a catalog colour name
 *  ("Plástico Amarillo Pastel", "Azul Pastel"). Tolerant of accents/plurals. */
function matchColor(value: unknown, options: string[]): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const nv = norm(value.trim());
  let hit = options.find((o) => norm(o) === nv);
  if (hit) return hit;
  hit = options.find((o) => norm(o).includes(nv) || nv.includes(norm(o)));
  if (hit) return hit;
  // Match on colour-word roots (amarilla→amari, azules→azul, roja→roj).
  const roots = nv
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !['plastico', 'color', 'pastel'].includes(w))
    .map((w) => w.replace(/(es|as|os|a|o|s)$/, '').slice(0, 5));
  return options.find((o) => {
    const no = norm(o);
    return roots.some((r) => r.length >= 3 && no.includes(r));
  });
}

/** Fallback: read the colour word that follows a keyword in the free text,
 *  e.g. "contraportada amarilla" → "amarilla" → catalog colour. */
function colorAfter(text: string, keyword: string, options: string[]): string | undefined {
  const m = norm(text).match(new RegExp(`${keyword}\\s+(?:de\\s+)?(?:color\\s+)?([a-z]+)`));
  return m ? matchColor(m[1], options) : undefined;
}

/** Ring/back-cover colour names offered by the shop (from the Neon catalog). */
async function getColorOptions(): Promise<{ ring: string[]; cover: string[] }> {
  const fallback = {
    ring: ['Transparente', 'Negro', 'Verde Menta', 'Amarillo Golden', 'Turquesa', 'Rosa Pastel', 'Azul Pastel', 'Lila', 'Azul Purpurina'],
    cover: ['Plástico Negro', 'Plástico Rojo', 'Plástico Transparente', 'Plástico Verde Pastel', 'Plástico Azul Pastel'],
  };
  try {
    const rows = (await db()`select value from settings where key = 'catalog'`) as { value: { ringColors?: { name: string; enabled?: boolean }[]; coverColors?: { name: string; enabled?: boolean }[] } }[];
    const c = rows[0]?.value;
    if (c) {
      const ring = (c.ringColors || []).filter((x) => x.enabled !== false).map((x) => x.name);
      const cover = (c.coverColors || []).filter((x) => x.enabled !== false).map((x) => x.name);
      if (ring.length) return { ring, cover: cover.length ? cover : fallback.cover };
    }
  } catch {
    /* settings missing → fallback */
  }
  return fallback;
}

// ── AI parsing (Groq by default; provider-agnostic) ──────────────────
const LLM_BASE = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
const LLM_KEY = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';

const DEFAULT_CONFIG = {
  size: 'A4', color: 'BN', grosor: 90, dobleCara: '0', orientacion: 'vertical', paginasPorHoja: 1,
  acabado: 'sinencuadernacion', acabadoFolios: 'normal', juntos: 'agrupados', sinMargenes: false,
  ladoEncuadernacion: 'largo', foliosDelante: 0, foliosDetras: 0,
};
const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG);

async function parseEmail(
  subject: string,
  text: string,
  colors: { ring: string[]; cover: string[] },
  instructions?: string
): Promise<{ reply: string; changes: Record<string, unknown>; copias: number; docColor?: string; colorAnillas?: string; colorContraportada?: string }> {
  if (!LLM_KEY) return { reply: 'Sin IA configurada; configuración por defecto.', changes: {}, copias: 1 };
  const prompt = [
    'Eres el recepcionista de una copistería. Un cliente envía un email pidiendo imprimir unos archivos adjuntos.',
    'Extrae la configuración de impresión de su mensaje. Usa EXACTAMENTE estas claves/valores:',
    '- size: A4 | A3 | A5 · color: BN | Color · grosor: 80|90|100|120|250',
    "- dobleCara: '0' (una cara) | '1' (doble cara) · paginasPorHoja: 1|2|4 · orientacion: vertical|horizontal",
    '- acabado: sinencuadernacion|grapado|AnillasColores|dos_agujeros|cuatro_agujeros|perforado',
    '- juntos: agrupados|individual · sinMargenes: true|false · acabadoFolios: normal|plastificar|pegatinas',
    "- docColor: 'no'|'cover'|'all' (color por documento; 'cover' = solo portada en color)",
    '- copias: número entero',
    `- colorAnillas (SOLO si acabado=AnillasColores y el cliente menciona un color de anillas): uno de [${colors.ring.join(', ')}]`,
    `- colorContraportada (SOLO si acabado=AnillasColores y menciona color de contraportada): uno de [${colors.cover.join(', ')}]`,
    'Solo incluye lo que el cliente indique; lo no mencionado se queda por defecto.',
    instructions && instructions.trim() ? `Indicaciones del dueño: ${instructions.trim().slice(0, 1000)}` : '',
    `ASUNTO: ${subject}`,
    `MENSAJE: ${text.slice(0, 4000)}`,
    'Responde SOLO con JSON: { "reply": "<resumen breve en español>", "changes": { <config> }, "copias": <n>, "docColor": "<no|cover|all opcional>", "colorAnillas": "<opcional>", "colorContraportada": "<opcional>" }',
  ].join('\n');
  const r = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${LLM_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: LLM_MODEL, temperature: 0.2, max_tokens: 500, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: prompt }] }),
  });
  if (!r.ok) return { reply: 'No se pudo interpretar el mensaje; configuración por defecto.', changes: {}, copias: 1 };
  const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  let parsed: { reply?: unknown; changes?: unknown; copias?: unknown; docColor?: unknown } = {};
  try {
    parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  } catch {
    /* keep defaults */
  }
  const p = parsed as { reply?: unknown; changes?: unknown; copias?: unknown; docColor?: unknown; colorAnillas?: unknown; colorContraportada?: unknown };
  const changesIn = p.changes && typeof p.changes === 'object' ? (p.changes as Record<string, unknown>) : {};
  const changes: Record<string, unknown> = {};
  for (const k of CONFIG_KEYS) if (k in changesIn) changes[k] = changesIn[k];
  // Map loose colour words to catalog names; if the model didn't fill the field,
  // fall back to reading the colour straight from the message text.
  const fullText = `${subject} ${text}`;
  const ca = matchColor(p.colorAnillas, colors.ring) ?? colorAfter(fullText, 'anillas', colors.ring);
  const cc = matchColor(p.colorContraportada, colors.cover) ?? colorAfter(fullText, 'contraportada', colors.cover);
  return {
    reply: typeof p.reply === 'string' ? p.reply : 'Pedido recibido por email.',
    changes,
    copias: Math.max(1, Math.floor(Number(p.copias)) || 1),
    docColor: p.docColor === 'cover' || p.docColor === 'all' ? p.docColor : undefined,
    colorAnillas: ca,
    colorContraportada: cc,
  };
}

// ── Handler ───────────────────────────────────────────────────────────
interface Attachment {
  filename?: string;
  contentType?: string;
  dataBase64?: string;
}
interface EmailIn {
  messageId?: string;
  from?: string;
  fromName?: string;
  subject?: string;
  text?: string;
  attachments?: Attachment[];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    await ensureSchema();
    const sql = db();
    const body = (req.body ?? {}) as { email?: EmailIn; instructions?: string };
    const email = body.email;

    // Real inbox reading (Gmail) comes later; for now require a provided email.
    if (!email) return res.status(400).json({ error: 'Modo lectura de buzón pendiente (Gmail). Envía un email en el cuerpo para procesar.' });

    const messageId = String(email.messageId || crypto.randomUUID());
    // Atomic claim → safe against duplicate/concurrent triggers.
    const claim = (await sql`
      insert into email_jobs (message_id, order_id, created_at)
      values (${messageId}, '', ${Date.now()})
      on conflict (message_id) do nothing returning message_id`) as { message_id: string }[];
    if (claim.length === 0) {
      const prev = (await sql`select order_id from email_jobs where message_id = ${messageId}`) as { order_id: string }[];
      return res.status(200).json({ status: 'duplicate', orderId: prev[0]?.order_id || null });
    }

    // 1) Parse the instructions with AI (offering the catalog's ring/cover colours).
    const colorOpts = await getColorOptions();
    const { reply, changes, copias, docColor, colorAnillas, colorContraportada } = await parseEmail(
      email.subject || '',
      email.text || '',
      colorOpts,
      body.instructions
    );

    // 2) Upload attachments to R2 (PDF/images only).
    const projectId = crypto.randomUUID();
    const docColorVal = (docColor === 'cover' || docColor === 'all' ? docColor : 'no') as 'no' | 'cover' | 'all';
    const docs: { id: string; name: string; pages: number; color: string; storageKey: string }[] = [];
    const skipped: string[] = [];
    for (const att of email.attachments || []) {
      const type = att.contentType || '';
      const name = att.filename || 'archivo';
      if (!ACCEPTED.some((p) => type.startsWith(p)) || !att.dataBase64) {
        skipped.push(name);
        continue;
      }
      const bytes = new Uint8Array(Buffer.from(att.dataBase64, 'base64'));
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_MB * 1024 * 1024) {
        skipped.push(name);
        continue;
      }
      let pages = 1;
      if (type.startsWith('application/pdf')) {
        try {
          pages = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
        } catch {
          pages = 0; // encrypted/damaged → unknown
        }
      }
      const storageKey = await uploadToR2(projectId, name, type, bytes);
      docs.push({ id: crypto.randomUUID(), name, pages, color: docColorVal, storageKey });
    }

    if (docs.length === 0) {
      await sql`delete from email_jobs where message_id = ${messageId}`; // release claim; nothing to do
      return res.status(422).json({ error: 'El email no traía archivos imprimibles (PDF o imagen).', skipped });
    }

    // 3) Build the order (source: 'email') and hand it to /api/orders, which
    //    prices it authoritatively with the Neon catalog and inserts it.
    const config = { ...DEFAULT_CONFIG, ...changes };
    const orderId = `P-${crypto.randomUUID().replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase()}`;
    const nombre = (email.fromName || email.from || 'Cliente email').slice(0, 60);
    const comentario = `📧 Pedido por email. IA entendió: ${reply}${skipped.length ? ` · (ignorados: ${skipped.join(', ')})` : ''}`;
    const project = {
      id: projectId,
      kind: 'copias',
      nombre: (email.subject || 'Pedido por email').slice(0, 80),
      config,
      docs,
      copias,
      comentario,
      colorAnillas: colorAnillas ?? '',
      colorContraportada: colorContraportada ?? '',
      total: 0,
    };
    const order = {
      id: orderId,
      createdAt: Date.now(),
      source: 'email',
      customer: { nombre, apellidos: '', telefono: undefined as string | undefined },
      items: [project],
      total: 0,
      status: 'nuevo',
    };
    const orderRes = await fetch(`${SELF_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });
    const orderData = (await orderRes.json().catch(() => ({}))) as { total?: number; error?: string };
    if (!orderRes.ok) {
      await sql`delete from email_jobs where message_id = ${messageId}`; // release claim so a retry can work
      return res.status(502).json({ error: `No se pudo crear el pedido: ${orderData.error || orderRes.status}` });
    }
    await sql`update email_jobs set order_id = ${orderId} where message_id = ${messageId}`;

    return res.status(201).json({ status: 'created', orderId, total: orderData.total ?? 0, docs: docs.length, skipped, config, reply });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error procesando el email' });
  }
}
