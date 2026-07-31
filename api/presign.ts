import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AwsClient } from 'aws4fetch';
import { neon } from '@neondatabase/serverless';
import { createHmac, timingSafeEqual } from 'crypto';

// Self-contained (no relative imports) to avoid any ESM module-resolution
// surprises in the Vercel Node runtime.
const MAX_MB = 300;
const ACCEPTED = ['application/pdf', 'image/'];
const EXPIRES = 3600; // presigned URL validity (seconds)

/**
 * Prefijo de los archivos PÚBLICOS (el logo grande, la foto de la portada).
 *
 * Todo lo que cuelgue de aquí lo puede descargar cualquiera sin autenticarse, así
 * que la ruta pública SOLO sirve claves que empiecen por esto. Sin esa
 * comprobación sería una puerta abierta a los apuntes y los trabajos que suben
 * los clientes, que viven bajo `jobs/`.
 */
const PUBLIC_PREFIX = 'publico/';
/** Claves públicas admitidas: las genera el servidor, así que el formato es fijo. */
const PUBLIC_KEY_RE = /^publico\/[0-9a-z-]+\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/;

/**
 * ¿Puede servirse esta clave sin autenticación?
 *
 * Exportada para poder castigarla a conciencia en los tests: es la única barrera
 * entre la foto de la portada y los apuntes que suben los clientes. No basta con
 * mirar el principio de la cadena — la clave tiene que encajar ENTERA con el
 * formato que genera el servidor, para que ni un `..`, ni una barra de más, ni un
 * carácter escapado permitan salir de la carpeta.
 */
export function isPublicKey(key: string): boolean {
  if (!key.startsWith(PUBLIC_PREFIX)) return false;
  if (key.includes('..') || key.includes('//') || key.includes('%')) return false;
  return PUBLIC_KEY_RE.test(key);
}
/** Una foto de portada no debería pesar más que esto ni queriendo. */
const MAX_PUBLIC_MB = 3;
/**
 * Almacenamiento R2. SIN valor por defecto, a propósito.
 *
 * Antes caían a la cuenta y el bucket de Fotocopiator. Con un único despliegue eso
 * era una comodidad; con dos negocios distintos es una fuga de datos: a la segunda
 * tienda se le olvida una variable y los archivos de SUS clientes acaban en el
 * almacenamiento de la otra, donde además la limpieza de una borraría los de la
 * otra. Mejor romper ruidosamente al arrancar que mezclar dos negocios en silencio.
 */
function r2Config(): { account: string; bucket: string } {
  const account = process.env.R2_ACCOUNT_ID || '';
  const bucket = process.env.R2_BUCKET || '';
  if (!account || !bucket) {
    throw new Error('Falta R2_ACCOUNT_ID o R2_BUCKET en el servidor: el almacenamiento no está configurado');
  }
  return { account, bucket };
}
const r2BaseUrl = () => {
  const { account, bucket } = r2Config();
  return `https://${account}.r2.cloudflarestorage.com/${bucket}`;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || '';
/**
 * Key for the file capabilities. Optional: falls back to ADMIN_SECRET.
 *
 * Setting it decouples revocation — rotating the backoffice password/secret then
 * no longer invalidates the file tokens stored in customers' carts and orders.
 * ⚠️ Changing this value (including setting it for the first time) invalidates
 * every capability already issued: the shop keeps full access with its admin
 * token, but customers can't reopen the files of orders placed before the change.
 */
const FILE_SECRET = process.env.FILE_SECRET || ADMIN_SECRET;

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/** Backoffice/counter token check (same scheme as /api/auth). Admin sees all. */
function isAdmin(req: VercelRequest): boolean {
  if (!ADMIN_SECRET) return false;
  const h = req.headers['authorization'];
  const raw = Array.isArray(h) ? h[0] : h || '';
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  if (!m) return false;
  const [expStr, sig] = m[1].split('.');
  const exp = Number(expStr);
  if (!exp || exp < Date.now() || !sig) return false;
  return safeEq(sig, createHmac('sha256', ADMIN_SECRET).update(`admin.${exp}`).digest('base64url'));
}

/**
 * Per-project capability token.
 *
 * Uploading returns one, and reading/deleting a file requires it. Otherwise
 * anyone who ever saw a storage key (or found one) could keep downloading or —
 * worse — deleting the customer's documents forever, with no authentication at
 * all. The token only grants access to `jobs/<projectId>/…`, so a customer can
 * manage their own files and nobody else's.
 */
const projectToken = (projectId: string) =>
  createHmac('sha256', FILE_SECRET || 'insecure-dev-secret').update(`proj.${projectId}`).digest('base64url');

/**
 * The project id inside a storage key.
 *
 * Two layouts exist and both must keep working:
 *   jobs/<projectId>/<file>            (original)
 *   jobs/<YYYY-MM>/<projectId>/<file>  (current: browsable by month in the
 *                                       Cloudflare dashboard)
 * So instead of assuming a position, take the first segment that IS a uuid. Get
 * this wrong and every customer loses access to their own files.
 */
function projectOf(key: string): string | null {
  if (!key.startsWith('jobs/')) return null;
  for (const seg of key.slice(5).split('/')) {
    if (UUID_RE.test(seg)) return seg;
  }
  return null;
}

/** True when the caller may read/delete this key. */
function mayAccess(req: VercelRequest, key: string, token: unknown): boolean {
  if (isAdmin(req)) return true;
  const proj = projectOf(key);
  if (!proj || typeof token !== 'string' || !token) return false;
  return safeEq(token, projectToken(proj));
}

/**
 * Registry of every uploaded file.
 *
 * A file reaches storage the moment the customer drops it in the configurator —
 * long before there is an order, and possibly without ever becoming one (someone
 * checking a price, an abandoned cart). Without a record of it, that file is
 * invisible: nothing references it and nothing can ever clean it up.
 *
 * So every upload is registered here with its date, and the retention sweep in
 * api/orders can then delete whatever is old enough and still belongs to no
 * order. Best-effort: a registry failure must never block a customer's upload.
 */
async function registerFile(key: string, projectId: string, size: number): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      create table if not exists files (
        key text primary key, project_id text not null, size_bytes bigint,
        created_at bigint not null)`;
    await sql`create index if not exists files_created_idx on files (created_at)`;
    await sql`
      insert into files (key, project_id, size_bytes, created_at)
      values (${key}, ${projectId}, ${size}, ${Date.now()})
      on conflict (key) do nothing`;
  } catch (e) {
    // Un fichero que no queda registrado es un huérfano invisible: seguirá
    // ocupando (y costando) en R2 y el barrido de limpieza no sabrá que existe.
    console.error('[presign] no se pudo registrar el fichero', e);
    await logEvent('error', 'Un archivo subido no se pudo registrar (quedará sin control en el almacenamiento)', { detail: { key, size, error: e instanceof Error ? e.message : String(e) } });
  }
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12) : '';
}

function r2(): AwsClient {
  return new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  });
}

/**
 * Presigning endpoint (same Vercel domain as the app → the browser only talks
 * to *.vercel.app and r2.cloudflarestorage.com, not workers.dev). R2
 * keys/secrets are server-only env vars; they never reach the client.
 */

/**
 * Record an incident in the shared event log (insert only, no email: the mail
 * transport lives in api/orders, which sends these out — see flushPendingAlerts).
 * Best-effort and never throws.
 */
async function logEvent(
  level: 'error' | 'warn' | 'info',
  message: string,
  opts: { orderId?: string; detail?: unknown } = {}
): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const db = neon(process.env.DATABASE_URL);
    await db`
      create table if not exists events (
        id bigserial primary key, at bigint not null, level text not null,
        source text not null, order_id text, message text not null, detail text)`;
    await db`alter table events add column if not exists alerted boolean not null default false`;
    const detail =
      opts.detail === undefined
        ? null
        : String(opts.detail instanceof Error ? opts.detail.message : typeof opts.detail === 'string' ? opts.detail : JSON.stringify(opts.detail)).slice(0, 2000);
    await db`
      insert into events (at, level, source, order_id, message, detail, alerted)
      values (${Date.now()}, ${level}, 'archivos', ${opts.orderId ?? null}, ${message.slice(0, 300)}, ${detail}, false)`;
  } catch (e) {
    console.error('[events] no se pudo registrar', e);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  /**
   * Entrega de un archivo público, sin autenticación: `GET /api/presign?img=<clave>`.
   *
   * Responde con una redirección a una URL firmada. Es lo que permite que la foto
   * de la portada la vea cualquier visitante aunque las URLs de R2 caduquen: el
   * navegador sigue la redirección y guarda el resultado en caché.
   *
   * LA COMPROBACIÓN DEL PREFIJO ES LO IMPORTANTE DE TODA ESTA FUNCIÓN. Si aceptara
   * cualquier clave, sería una puerta para descargar los apuntes y los trabajos de
   * cualquier cliente sin identificarse. Por eso no basta con `startsWith`: la
   * clave tiene que encajar entera con el formato que genera el servidor, de modo
   * que ni un `..` ni una barra de más puedan salir de la carpeta.
   */
  if (req.method === 'GET' && req.query.img !== undefined) {
    try {
      const raw = Array.isArray(req.query.img) ? req.query.img[0] : req.query.img;
      const key = String(raw ?? '');
      if (!isPublicKey(key)) return res.status(400).json({ error: 'clave no válida' });
      if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
        return res.status(500).json({ error: 'almacenamiento no configurado' });
      }
      const signed = await r2().sign(`${r2BaseUrl()}/${key}?X-Amz-Expires=${EXPIRES}`, {
        method: 'GET',
        aws: { signQuery: true },
      });
      // Menos que la validez de la firma: si el navegador guardase la redirección
      // más tiempo del que dura la URL firmada, acabaría pidiendo una caducada.
      res.setHeader('Cache-Control', `public, max-age=${Math.floor(EXPIRES / 2)}`);
      return res.redirect(302, signed.url);
    } catch (e) {
      console.error('[presign] público', e);
      return res.status(500).json({ error: 'no se pudo servir el archivo' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  try {
    if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
      return res.status(500).json({ error: 'Faltan R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY en el servidor' });
    }

    const body = (req.body ?? {}) as {
      op?: string;
      name?: string;
      type?: string;
      size?: number;
      projectId?: string;
      key?: string;
      token?: string;
      folder?: string;
    };
    const { op, name, type, size, projectId, key, token } = body;
    const client = r2();

    if (op === 'put') {
      if (typeof name !== 'string' || typeof type !== 'string' || typeof size !== 'number') {
        return res.status(400).json({ error: 'faltan datos' });
      }
      if (!ACCEPTED.some((p) => type.startsWith(p))) return res.status(415).json({ error: 'tipo no admitido' });
      if (size > MAX_MB * 1024 * 1024) return res.status(413).json({ error: `supera ${MAX_MB} MB` });
      // A projectId is required so every object lands under a project folder we
      // can issue a capability for (see projectToken).
      if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) {
        return res.status(400).json({ error: 'projectId inválido' });
      }
      // Server-generated key with a UUID — the client filename is never the path.
      // Grouped by upload month so the bucket is navigable by hand in the
      // Cloudflare dashboard; the project folder inside keeps the capability model
      // intact (see projectOf).
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const objectKey = `jobs/${month}/${projectId}/${crypto.randomUUID()}${extOf(name)}`;
      const signed = await client.sign(`${r2BaseUrl()}/${objectKey}?X-Amz-Expires=${EXPIRES}`, { method: 'PUT', aws: { signQuery: true } });
      // Registered BEFORE handing out the URL, so nothing can be uploaded without
      // leaving a trace we can clean up later.
      await registerFile(objectKey, projectId, size);
      // The token travels with the project (cart → order), so the customer can
      // later re-open or delete their own files.
      return res.status(200).json({ key: objectKey, url: signed.url, token: projectToken(projectId) });
    }

    /**
     * Subida de un archivo público: la foto de la portada. Solo el administrador.
     *
     * Va a su propio prefijo, separado de `jobs/`, porque lo que se sube aquí lo
     * podrá descargar cualquiera. No se registra en la tabla `files` a propósito:
     * esa tabla alimenta el barrido de huérfanos, que borra lo que no pertenece a
     * ningún pedido — y se llevaría por delante la foto de la portada.
     */
    if (op === 'putPublic') {
      if (!isAdmin(req)) return res.status(403).json({ error: 'solo el administrador' });
      if (typeof name !== 'string' || typeof type !== 'string' || typeof size !== 'number') {
        return res.status(400).json({ error: 'faltan datos' });
      }
      if (!type.startsWith('image/')) return res.status(415).json({ error: 'solo imágenes' });
      if (size > MAX_PUBLIC_MB * 1024 * 1024) return res.status(413).json({ error: `supera ${MAX_PUBLIC_MB} MB` });
      const folder = typeof body.folder === 'string' && /^[a-z-]{1,20}$/.test(body.folder) ? body.folder : 'portada';
      const objectKey = `${PUBLIC_PREFIX}${folder}/${crypto.randomUUID()}${extOf(name) || '.jpg'}`;
      const signed = await client.sign(`${r2BaseUrl()}/${objectKey}?X-Amz-Expires=${EXPIRES}`, {
        method: 'PUT',
        aws: { signQuery: true },
      });
      // La dirección que se guarda en la configuración y que verán los visitantes.
      return res.status(200).json({ key: objectKey, url: signed.url, publicUrl: `/api/presign?img=${encodeURIComponent(objectKey)}` });
    }

    if (op === 'get') {
      if (typeof key !== 'string' || !key.startsWith('jobs/')) return res.status(400).json({ error: 'key inválida' });
      if (!mayAccess(req, key, token)) return res.status(403).json({ error: 'sin permiso para este archivo' });
      const signed = await client.sign(`${r2BaseUrl()}/${key}?X-Amz-Expires=${EXPIRES}`, { method: 'GET', aws: { signQuery: true } });
      return res.status(200).json({ url: signed.url });
    }

    if (op === 'delete') {
      if (typeof key !== 'string' || !key.startsWith('jobs/')) return res.status(400).json({ error: 'key inválida' });
      if (!mayAccess(req, key, token)) return res.status(403).json({ error: 'sin permiso para este archivo' });
      const signed = await client.sign(`${r2BaseUrl()}/${key}`, { method: 'DELETE', aws: { signQuery: true } });
      await fetch(signed.url, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'operación inválida' });
  } catch (e) {
    console.error('[presign]', e);
    return res.status(500).json({ error: 'Error del servidor al firmar el acceso al archivo.' });
  }
}
