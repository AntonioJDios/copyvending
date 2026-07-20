import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AwsClient } from 'aws4fetch';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { PDFDocument } from 'pdf-lib';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

// Give the function headroom to read the inbox + upload attachments.
export const maxDuration = 60;

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

/** Shop settings from the Neon catalog: ring/cover colour names + the owner's
 *  free-text assistant instructions. */
async function getShopSettings(): Promise<{ ring: string[]; cover: string[]; instructions: string }> {
  const fallback = {
    ring: ['Transparente', 'Negro', 'Verde Menta', 'Amarillo Golden', 'Turquesa', 'Rosa Pastel', 'Azul Pastel', 'Lila', 'Azul Purpurina'],
    cover: [
      'Plástico Negro', 'Plástico Rojo', 'Plástico Transparente', 'Plástico Verde Pastel', 'Plástico Amarillo Pastel',
      'Plástico Azul Pastel', 'Plástico Naranja Pastel', 'Plástico Rosa Pastel', 'Plástico Lila Pastel',
    ],
    instructions: '',
  };
  try {
    const rows = (await db()`select value from settings where key = 'catalog'`) as {
      value: {
        ringColors?: { name: string; enabled?: boolean }[];
        coverColors?: { name: string; enabled?: boolean }[];
        assistant?: { instructions?: string };
      };
    }[];
    const c = rows[0]?.value;
    if (c) {
      const ring = (c.ringColors || []).filter((x) => x.enabled !== false).map((x) => x.name);
      const cover = (c.coverColors || []).filter((x) => x.enabled !== false).map((x) => x.name);
      const instructions = c.assistant?.instructions || '';
      if (ring.length) return { ring, cover: cover.length ? cover : fallback.cover, instructions };
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

interface ProjectPlan {
  files: string[]; // attachment filenames belonging to this project
  nombre?: string;
  changes: Record<string, unknown>;
  copias: number;
  docColor: 'no' | 'cover' | 'all';
  colorAnillas?: string;
  colorContraportada?: string;
}

interface FileInfo {
  name: string;
  pages: number;
  orientation: 'vertical' | 'horizontal' | 'desconocida';
}

/** Ask the AI to group the attachments into one or more print PROJECTS (files
 *  that go together in the same project; files with a different configuration or
 *  that shouldn't be bound together in separate projects) and give each its
 *  configuration. Falls back to a single project with all files. */
async function parseEmail(
  subject: string,
  text: string,
  fileInfos: FileInfo[],
  colors: { ring: string[]; cover: string[] },
  instructions?: string
): Promise<{ reply: string; projects: ProjectPlan[] }> {
  const allNames = fileInfos.map((f) => f.name);
  const single = (): ProjectPlan[] => [{ files: allNames, changes: {}, copias: 1, docColor: 'no' }];
  if (!LLM_KEY) return { reply: 'Sin IA configurada; configuración por defecto.', projects: single() };

  const prompt = [
    'Eres el recepcionista de una copistería. Un cliente envía un email con archivos adjuntos para imprimir.',
    'Agrupa los archivos en uno o VARIOS PROYECTOS y da a cada uno su configuración:',
    '- Archivos que van JUNTOS (misma configuración y/o encuadernados juntos) → el MISMO proyecto.',
    '- Archivos con configuración distinta o que NO se encuadernan juntos → proyectos SEPARADOS.',
    'Si no está claro, agrupa todo en un único proyecto.',
    '',
    'Cada proyecto usa EXACTAMENTE estas claves/valores en "config":',
    '- size: A4 | A3 | A5 · color: BN | Color · grosor: 80|90|100|120|250',
    "- dobleCara: '0' (una cara) | '1' (doble cara) · paginasPorHoja: 1|2|4 · orientacion: vertical|horizontal",
    '- acabado: sinencuadernacion|grapado|AnillasColores|dos_agujeros|cuatro_agujeros|perforado',
    '- juntos: agrupados|individual · sinMargenes: true|false · acabadoFolios: normal|plastificar|pegatinas · ladoEncuadernacion: largo|corto',
    "- docColor: 'no'|'cover'|'all' ('cover' = solo la portada en color)",
    '- copias: entero',
    `- colorAnillas (solo si acabado=AnillasColores): uno de [${colors.ring.join(', ')}]`,
    `- colorContraportada (solo si acabado=AnillasColores): uno de [${colors.cover.join(', ')}]`,
    'Solo incluye lo que el cliente indique; el resto se queda por defecto.',
    'ORIENTACIÓN: fija "orientacion" según la orientación detectada de cada archivo. Encuadernación: vertical→ladoEncuadernacion="largo", horizontal→"corto".',
    instructions && instructions.trim() ? `Indicaciones del dueño: ${instructions.trim().slice(0, 1000)}` : '',
    '',
    `ARCHIVOS (usa los nombres EXACTOS): ${JSON.stringify(fileInfos)}`,
    `ASUNTO: ${subject}`,
    `MENSAJE: ${text.slice(0, 4000)}`,
    '',
    'Responde SOLO con JSON:',
    '{ "reply": "<resumen breve en español>", "projects": [ { "files": ["nombre1.pdf"], "nombre": "<opcional>", "config": { <config> }, "copias": <n>, "docColor": "<no|cover|all>", "colorAnillas": "<opcional>", "colorContraportada": "<opcional>" } ] }',
  ].join('\n');

  let projects: ProjectPlan[] = [];
  let reply = 'Pedido recibido por email.';
  try {
    const r = await fetch(`${LLM_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${LLM_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: LLM_MODEL, temperature: 0.2, max_tokens: 900, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: prompt }] }),
    });
    if (r.ok) {
      const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
      const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}') as {
        reply?: unknown;
        projects?: unknown;
      };
      if (typeof parsed.reply === 'string') reply = parsed.reply;
      const raw = Array.isArray(parsed.projects) ? (parsed.projects as Record<string, unknown>[]) : [];
      projects = raw.map((pr) => {
        const cfgIn = pr.config && typeof pr.config === 'object' ? (pr.config as Record<string, unknown>) : {};
        const changes: Record<string, unknown> = {};
        for (const k of CONFIG_KEYS) if (k in cfgIn) changes[k] = cfgIn[k];
        const filesIn = Array.isArray(pr.files) ? (pr.files as unknown[]).map(String) : [];
        return {
          files: filesIn.filter((n) => allNames.includes(n)),
          nombre: typeof pr.nombre === 'string' ? pr.nombre : undefined,
          changes,
          copias: Math.max(1, Math.floor(Number(pr.copias)) || 1),
          docColor: pr.docColor === 'cover' || pr.docColor === 'all' ? pr.docColor : 'no',
          colorAnillas: matchColor(pr.colorAnillas, colors.ring),
          colorContraportada: matchColor(pr.colorContraportada, colors.cover),
        } as ProjectPlan;
      });
    }
  } catch {
    /* fall through to fallback */
  }

  // Drop empty projects; ensure every file is assigned exactly once.
  projects = projects.filter((p) => p.files.length > 0);
  const assigned = new Set(projects.flatMap((p) => p.files));
  const leftover = allNames.filter((n) => !assigned.has(n));
  if (projects.length === 0) return { reply, projects: single() };
  if (leftover.length) projects.push({ files: leftover, changes: {}, copias: 1, docColor: 'no' });

  // Single project → also try reading the colour from the free text.
  if (projects.length === 1) {
    const fullText = `${subject} ${text}`;
    projects[0].colorAnillas = projects[0].colorAnillas ?? colorAfter(fullText, 'anillas', colors.ring);
    projects[0].colorContraportada = projects[0].colorContraportada ?? colorAfter(fullText, 'contraportada', colors.cover);
  }

  return { reply, projects };
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

/** Process ONE normalised email into an order (dedupe → group → upload → create).
 *  Returns an { http, body } result instead of writing the response, so it can be
 *  reused both for the test endpoint and the Gmail loop. */
async function processEmail(
  email: EmailIn,
  settings: { ring: string[]; cover: string[]; instructions: string },
  instructions: string
): Promise<{ http: number; body: Record<string, unknown> }> {
  const sql = db();
  {
    const messageId = String(email.messageId || crypto.randomUUID());
    // Atomic claim → safe against duplicate/concurrent triggers.
    const claim = (await sql`
      insert into email_jobs (message_id, order_id, created_at)
      values (${messageId}, '', ${Date.now()})
      on conflict (message_id) do nothing returning message_id`) as { message_id: string }[];
    if (claim.length === 0) {
      const prev = (await sql`select order_id from email_jobs where message_id = ${messageId}`) as { order_id: string }[];
      return { http: 200, body: { status: 'duplicate', orderId: prev[0]?.order_id || null } };
    }

    // 1) Decode attachments + read metadata (pages, orientation). No upload yet —
    //    we upload per project once the AI has grouped them.
    type Decoded = { name: string; type: string; bytes: Uint8Array; pages: number; orientation: 'vertical' | 'horizontal' | 'desconocida' };
    const decoded: Decoded[] = [];
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
      let orientation: 'vertical' | 'horizontal' | 'desconocida' = 'desconocida';
      if (type.startsWith('application/pdf')) {
        try {
          const doc = await PDFDocument.load(bytes, { updateMetadata: false });
          pages = doc.getPageCount();
          if (pages > 0) {
            const { width, height } = doc.getPage(0).getSize();
            orientation = width > height ? 'horizontal' : 'vertical';
          }
        } catch {
          pages = 0; // encrypted/damaged → unknown
        }
      }
      decoded.push({ name, type, bytes, pages, orientation });
    }

    if (decoded.length === 0) {
      await sql`delete from email_jobs where message_id = ${messageId}`; // release claim; nothing to do
      return { http: 422, body: { error: 'El email no traía archivos imprimibles (PDF o imagen).', skipped } };
    }

    // 2) Group the files into one or more projects with the AI.
    const { reply, projects } = await parseEmail(
      email.subject || '',
      email.text || '',
      decoded.map((d) => ({ name: d.name, pages: d.pages, orientation: d.orientation })),
      { ring: settings.ring, cover: settings.cover },
      instructions
    );

    // 3) Upload each project's files to its own R2 folder and build the items.
    const byName = new Map(decoded.map((d) => [d.name, d]));
    const items: Record<string, unknown>[] = [];
    for (const plan of projects) {
      const projId = crypto.randomUUID();
      const planFiles = plan.files.map((n) => byName.get(n)).filter((f): f is Decoded => !!f);
      if (planFiles.length === 0) continue;
      const docs: { id: string; name: string; pages: number; color: string; storageKey: string }[] = [];
      for (const f of planFiles) {
        const storageKey = await uploadToR2(projId, f.name, f.type, f.bytes);
        docs.push({ id: crypto.randomUUID(), name: f.name, pages: f.pages, color: plan.docColor, storageKey });
      }
      // Orientation fallback: if the model didn't set it, use the first file's.
      const firstOri = planFiles.find((f) => f.orientation !== 'desconocida')?.orientation;
      const oriBase =
        !('orientacion' in plan.changes) && firstOri
          ? { orientacion: firstOri, ladoEncuadernacion: firstOri === 'horizontal' ? 'corto' : 'largo' }
          : {};
      items.push({
        id: projId,
        kind: 'copias',
        nombre: (plan.nombre || plan.files[0] || 'Proyecto').slice(0, 80),
        config: { ...DEFAULT_CONFIG, ...oriBase, ...plan.changes },
        docs,
        copias: plan.copias,
        comentario: '',
        colorAnillas: plan.colorAnillas ?? '',
        colorContraportada: plan.colorContraportada ?? '',
        total: 0,
      });
    }

    if (items.length === 0) {
      await sql`delete from email_jobs where message_id = ${messageId}`;
      return { http: 422, body: { error: 'No se pudo asignar ningún archivo a un proyecto.', skipped } };
    }

    // Note the AI summary (and any skipped files) on the first project.
    (items[0] as { comentario: string }).comentario = `📧 Pedido por email. IA entendió: ${reply}${skipped.length ? ` · (ignorados: ${skipped.join(', ')})` : ''}`;

    // 4) Create the order (source: 'email') via /api/orders (authoritative price).
    const orderId = `P-${crypto.randomUUID().replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase()}`;
    const nombre = (email.fromName || email.from || 'Cliente email').slice(0, 60);
    const order = {
      id: orderId,
      createdAt: Date.now(),
      source: 'email',
      customer: { nombre, apellidos: '', telefono: undefined as string | undefined },
      items,
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
      return { http: 502, body: { error: `No se pudo crear el pedido: ${orderData.error || orderRes.status}` } };
    }
    await sql`update email_jobs set order_id = ${orderId} where message_id = ${messageId}`;

    return {
      http: 201,
      body: {
        status: 'created',
        orderId,
        total: orderData.total ?? 0,
        projects: items.length,
        docs: items.reduce((s, it) => s + ((it.docs as unknown[])?.length ?? 0), 0),
        skipped,
        reply,
      },
    };
  }
}

/** Read the Gmail inbox (IMAP) and process recent messages. Robust to the
 *  read/unread state: it looks at recent mail and skips ones already processed
 *  (by Message-ID in email_jobs), so opening the inbox never loses an order. */
async function readGmailAndProcess(
  settings: { ring: string[]; cover: string[]; instructions: string }
): Promise<Record<string, unknown>> {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: process.env.GMAIL_USER || '', pass: process.env.GMAIL_APP_PASSWORD || '' },
    logger: false,
  });
  const sql = db();
  const results: unknown[] = [];
  let created = 0;
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000); // last 14 days
    const found = await client.search({ since }, { uid: true });
    const uids = (Array.isArray(found) ? found : []).slice(-25); // most recent 25
    for (const uid of uids) {
      try {
        // Cheap check first: envelope → Message-ID → skip if already processed.
        const env = await client.fetchOne(uid, { envelope: true }, { uid: true });
        const mid = env && env.envelope && env.envelope.messageId ? env.envelope.messageId : `gmail-${uid}`;
        const done = (await sql`select 1 from email_jobs where message_id = ${mid}`) as unknown[];
        if (done.length) continue; // already handled

        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const email: EmailIn = {
          messageId: mid,
          from: parsed.from?.value?.[0]?.address,
          fromName: parsed.from?.value?.[0]?.name,
          subject: parsed.subject || '',
          text: parsed.text || '',
          attachments: (parsed.attachments || []).map((a) => ({
            filename: a.filename || 'archivo',
            contentType: a.contentType || 'application/octet-stream',
            dataBase64: a.content.toString('base64'),
          })),
        };
        const r = await processEmail(email, settings, settings.instructions);
        if (r.body.status === 'created') created++;
        results.push({ uid, status: r.body.status ?? 'ok', orderId: r.body.orderId ?? null, error: r.body.error });
      } catch (e) {
        results.push({ uid, error: e instanceof Error ? e.message : 'error' });
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return { status: 'gmail', scanned: results.length, created, results };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const body = (req.body ?? {}) as { email?: EmailIn; instructions?: string };
    await ensureSchema();
    const settings = await getShopSettings();

    // Test / single mode: an email supplied in the body.
    if (body.email) {
      const r = await processEmail(body.email, settings, body.instructions ?? settings.instructions);
      return res.status(r.http).json(r.body);
    }

    // Gmail mode: read the inbox and process new messages.
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      return res.status(400).json({ error: 'Falta GMAIL_USER / GMAIL_APP_PASSWORD (o envía un email en el cuerpo para probar).' });
    }
    const summary = await readGmailAndProcess(settings);
    return res.status(200).json(summary);
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error procesando el email' });
  }
}
