import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

// Speech-to-text via the same OpenAI-compatible provider as the assistant
// (Groq's Whisper by default, same API key). Turbo = fast + cheap, plenty for
// short voice notes. Override with STT_MODEL / LLM_BASE_URL / LLM_API_KEY.
const BASE_URL = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
const API_KEY = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || '';
const MODEL = process.env.STT_MODEL || 'whisper-large-v3-turbo';

// ── Abuse guard ──────────────────────────────────────────────────────
// Every call here spends money at the LLM provider and needs no login, so
// without a cap anyone could run their AI workload on the shop's bill. Fixed
// window per IP, counted in Neon (serverless functions share no memory), shared
// with the other AI endpoints. Fails OPEN: a broken limiter must not break the
// shop. Duplicated across the AI endpoints because Vercel functions have to be
// self-contained (this goes away with the Cloudflare migration).
const RL_MAX = Number(process.env.LLM_RATE_MAX || 30);
const RL_WINDOW_MS = 10 * 60 * 1000;
let _rlReady: Promise<unknown> | null = null;
async function llmRateLimited(req: VercelRequest): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const xf = req.headers['x-forwarded-for'];
  const ip = ((Array.isArray(xf) ? xf[0] : xf || '').split(',')[0] || 'unknown').trim().slice(0, 64) || 'unknown';
  const w = Math.floor(Date.now() / RL_WINDOW_MS) * RL_WINDOW_MS;
  try {
    const sql = neon(process.env.DATABASE_URL);
    _rlReady ??= sql`create table if not exists rate_limits (k text primary key, window_start bigint not null, hits int not null)`;
    await _rlReady;
    const rows = (await sql`
      insert into rate_limits (k, window_start, hits) values (${`llm:${ip}`}, ${w}, 1)
      on conflict (k) do update set
        hits = case when rate_limits.window_start = ${w} then rate_limits.hits + 1 else 1 end,
        window_start = ${w}
      returning hits`) as { hits: number }[];
    return (rows[0]?.hits ?? 1) > RL_MAX;
  } catch {
    _rlReady = null;
    return false;
  }
}

export const maxDuration = 30;

// Filename extension per mime type — the provider infers the audio format from it.
const EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    if (!API_KEY) return res.status(500).json({ error: 'Falta GROQ_API_KEY (o LLM_API_KEY) en el servidor' });
    if (await llmRateLimited(req)) return res.status(429).json({ error: 'Has enviado demasiados audios. Espera unos minutos.' });

    const body = (req.body ?? {}) as { audio?: string; mime?: string; language?: string };
    // Accept a data: URL or a bare base64 string.
    const b64 = typeof body.audio === 'string' ? (body.audio.split(',').pop() ?? '') : '';
    if (!b64) return res.status(400).json({ error: 'Falta el audio' });
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) return res.status(400).json({ error: 'Audio vacío' });
    if (buf.length > 20 * 1024 * 1024) return res.status(413).json({ error: 'Audio demasiado largo' });

    const mime = (body.mime || 'audio/webm').split(';')[0];
    const ext = EXT[mime] || 'webm';

    const form = new FormData();
    form.append('file', new Blob([buf], { type: mime }), `audio.${ext}`);
    form.append('model', MODEL);
    form.append('language', (body.language || 'es').slice(0, 5));
    form.append('response_format', 'json');
    form.append('temperature', '0');

    const r = await fetch(`${BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: form,
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: `STT ${r.status}: ${t.slice(0, 300)}` });
    }
    const data = (await r.json()) as { text?: string };
    return res.status(200).json({ text: (data.text || '').trim() });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error de transcripción' });
  }
}
