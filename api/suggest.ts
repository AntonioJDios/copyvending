import type { VercelRequest, VercelResponse } from '@vercel/node';

// Same provider-agnostic setup as /api/assistant (defaults to Groq).
const BASE_URL = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
const API_KEY = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || '';
const MODEL = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';

const CONFIG_KEYS = [
  'size', 'color', 'grosor', 'dobleCara', 'orientacion', 'paginasPorHoja',
  'acabado', 'acabadoFolios', 'juntos', 'sinMargenes', 'ladoEncuadernacion',
  'foliosDelante', 'foliosDetras', 'docColor',
];

interface Analysis {
  name?: string;
  pages?: number;
  size?: string;
  orientation?: string;
  colorPages?: number;
  colorApprox?: boolean;
  hasColor?: boolean;
  textExcerpt?: string;
  likelyPhoto?: boolean;
}

function systemPrompt(analyses: Analysis[], options: Record<string, unknown>, instructions?: string): string {
  const sizes = (options.sizes as { key: string; label: string }[] | undefined)?.map((s) => `${s.key} (${s.label})`).join(', ');
  const finishes = (options.finishes as { key: string; label: string }[] | undefined)?.map((f) => `${f.key} (${f.label})`).join(', ');
  return [
    'Eres un experto de imprenta. Te doy el análisis (determinista) de los documentos que un cliente acaba de subir.',
    'Cada documento incluye "textExcerpt" (parte del texto de su primera página). ÚSALO para adivinar qué es (TFM, apuntes, CV, contrato, póster, presentación, foto…) y menciónalo en tu explicación.',
    'Propón la MEJOR configuración de impresión, buscando además que sea ECONÓMICA, y explícalo en 1-2 frases claras en español.',
    '',
    'Documentos analizados:',
    JSON.stringify(analyses),
    '',
    'Opciones válidas (usa EXACTAMENTE estas claves/valores):',
    `- size: ${sizes || 'A4, A3, A5'}`,
    '- color: BN | Color',
    "- dobleCara: '0' (una cara) | '1' (doble cara)",
    '- paginasPorHoja: 1 | 2 | 4',
    `- acabado: ${finishes || 'sinencuadernacion, grapado, AnillasColores, dos_agujeros, cuatro_agujeros, perforado'}`,
    '- juntos: agrupados | individual · orientacion: vertical | horizontal · sinMargenes: true|false',
    '',
    'CRITERIOS:',
    '- Muchas páginas (p.ej. >40) → sugiere encuadernación (anillas si es grande, grapado si es pequeño) y doble cara para ahorrar.',
    '- Si NINGUNA página tiene color → color=BN. Si prácticamente todo es color → Color. Si solo unas pocas, mantén BN y coméntalo (aún no cobramos color por página).',
    '- Respeta el tamaño detectado (size). Si es "desconocido", no cambies el tamaño.',
    '- Foto/imagen suelta → probablemente Color, sin encuadernación.',
    '- No inventes precios (el sistema los calcula). Cambia solo lo que aporte.',
    instructions && instructions.trim()
      ? `\nINSTRUCCIONES DEL DUEÑO (prioritarias, si no contradicen las reglas ni los valores válidos):\n${instructions.trim().slice(0, 2000)}\n`
      : '',
    '',
    'RESPONDE SOLO con un objeto JSON válido:',
    '{ "reply": "<explicación breve y amable>", "changes": { <clave>: <valor>, ... } }',
  ].join('\n');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    if (!API_KEY) return res.status(500).json({ error: 'Falta GROQ_API_KEY (o LLM_API_KEY) en el servidor' });
    const body = (req.body ?? {}) as { analyses?: Analysis[]; options?: Record<string, unknown>; instructions?: string };
    const analyses = Array.isArray(body.analyses) ? body.analyses.slice(0, 12) : [];
    if (analyses.length === 0) return res.status(400).json({ error: 'sin documentos que analizar' });

    const r = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: systemPrompt(analyses, body.options ?? {}, body.instructions) }],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: `LLM ${r.status}: ${t.slice(0, 300)}` });
    }
    const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    let parsed: { reply?: unknown; changes?: unknown };
    try {
      parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    } catch {
      parsed = {};
    }
    const reply = typeof parsed.reply === 'string' ? parsed.reply : 'Te sugiero una configuración para tus documentos.';
    const changesIn = parsed.changes && typeof parsed.changes === 'object' ? (parsed.changes as Record<string, unknown>) : {};
    const changes: Record<string, unknown> = {};
    for (const k of CONFIG_KEYS) if (k in changesIn) changes[k] = changesIn[k];

    return res.status(200).json({ reply, changes });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error de la sugerencia' });
  }
}
