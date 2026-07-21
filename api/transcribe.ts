import type { VercelRequest, VercelResponse } from '@vercel/node';

// Speech-to-text via the same OpenAI-compatible provider as the assistant
// (Groq's Whisper by default, same API key). Turbo = fast + cheap, plenty for
// short voice notes. Override with STT_MODEL / LLM_BASE_URL / LLM_API_KEY.
const BASE_URL = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
const API_KEY = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || '';
const MODEL = process.env.STT_MODEL || 'whisper-large-v3-turbo';

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
