import type { VercelRequest, VercelResponse } from '@vercel/node';

// Provider-agnostic (OpenAI-compatible). Defaults to Groq's free tier; switch
// provider/model by setting env vars — no code change:
//   LLM_BASE_URL (default Groq), LLM_API_KEY (default GROQ_API_KEY), LLM_MODEL.
const BASE_URL = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
const API_KEY = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || '';
const MODEL = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';

// Fields the assistant may change. The client re-validates via the domain
// (normalize/rules), so a bad suggestion can never break pricing or rules.
const CONFIG_KEYS = [
  'size', 'color', 'grosor', 'dobleCara', 'orientacion', 'paginasPorHoja',
  'acabado', 'acabadoFolios', 'juntos', 'sinMargenes', 'ladoEncuadernacion',
  'foliosDelante', 'foliosDetras', 'colorAnillas', 'colorContraportada', 'copias',
];

interface Ctx {
  config: Record<string, unknown>;
  copias: number;
  price?: { total?: number; sheets?: number; hasFiles?: boolean; pages?: number };
  options: {
    sizes?: { key: string; label: string }[];
    grosoresBySize?: Record<string, number[]>;
    finishes?: { key: string; label: string }[];
    folios?: { key: string; label: string }[];
    ringColors?: string[];
    coverColors?: string[];
  };
}

function systemPrompt(ctx: Ctx): string {
  const o = ctx.options || {};
  const sizes = (o.sizes || []).map((s) => `${s.key} (${s.label})`).join(', ');
  const finishes = (o.finishes || []).map((f) => `${f.key} (${f.label})`).join(', ');
  const folios = (o.folios || []).map((f) => `${f.key} (${f.label})`).join(', ');
  return [
    'Eres el asistente de una copistería de autoservicio. Hablas español, claro y breve, tono cercano.',
    'Ayudas al cliente con DOS cosas: (1) explicar qué es cada opción de impresión, (2) configurar el pedido según lo que pida.',
    '',
    'Opciones disponibles y sus valores VÁLIDOS (usa EXACTAMENTE estas claves y valores):',
    `- size (tamaño de papel): ${sizes || 'A4, A3, A5'}`,
    '- color: BN (blanco y negro) | Color',
    `- grosor (gramaje del papel, según tamaño): ${JSON.stringify(o.grosoresBySize || {})}`,
    "- dobleCara: '0' (una cara) | '1' (doble cara / dúplex)",
    '- orientacion: vertical | horizontal',
    '- paginasPorHoja: 1 | 2 | 4 (varias páginas reducidas por cara)',
    `- acabado (encuadernación): ${finishes || 'sinencuadernacion, grapado, AnillasColores, dos_agujeros, cuatro_agujeros, perforado'}`,
    `- acabadoFolios (tratamiento del folio): ${folios || 'normal, plastificar, pegatinas'}`,
    '- juntos: agrupados (todo en una encuadernación) | individual (una por documento)',
    '- sinMargenes: true | false (impresión a sangre, sin márgenes)',
    '- ladoEncuadernacion: largo | corto (por qué borde van las anillas/agujeros)',
    '- foliosDelante / foliosDetras: número de folios en blanco antes/después de la encuadernación',
    `- colorAnillas (solo si acabado=AnillasColores): ${(o.ringColors || []).join(', ')}`,
    `- colorContraportada (solo si acabado=AnillasColores): ${(o.coverColors || []).join(', ')}`,
    '- copias: número de copias del pedido',
    '',
    `Configuración ACTUAL del cliente: ${JSON.stringify(ctx.config)} · copias: ${ctx.copias}`,
    ctx.price?.hasFiles
      ? `PRECIO ACTUAL del pedido: ${(ctx.price.total ?? 0).toFixed(2)} € (${ctx.price.pages ?? 0} páginas, ${ctx.price.sheets ?? 0} folios).`
      : 'El cliente AÚN NO ha subido documentos, así que no hay precio todavía.',
    '',
    'REGLAS:',
    '- Cambia SOLO lo que el cliente pida o lo que sea necesario; no toques el resto.',
    '- Usa únicamente claves y valores de la lista. Si algo no es posible o no existe, dilo y no lo cambies.',
    '- PRECIO: si preguntan cuánto cuesta y hay precio actual, dilo (ese número exacto). Si NO hay documentos, di que primero suba el documento para calcular el precio.',
    '- No inventes el precio de una configuración distinta: si cambias opciones, di que el total se actualiza abajo (el sistema lo recalcula). No des un euro inventado.',
    '- Si el cliente solo pregunta, responde y deja "changes" vacío.',
    '',
    'RESPONDE SIEMPRE con un único objeto JSON válido, sin texto fuera del JSON:',
    '{ "reply": "<tu respuesta en español>", "changes": { <clave>: <valor>, ... } }',
    'Ejemplo: { "reply": "Listo: A4, doble cara y anillas.", "changes": { "size": "A4", "dobleCara": "1", "acabado": "AnillasColores" } }',
  ].join('\n');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    if (!API_KEY) return res.status(500).json({ error: 'Falta GROQ_API_KEY (o LLM_API_KEY) en el servidor' });

    const body = (req.body ?? {}) as {
      history?: { role?: string; content?: string }[];
      config?: Record<string, unknown>;
      copias?: number;
      price?: Ctx['price'];
      options?: Ctx['options'];
    };
    const history = Array.isArray(body.history) ? body.history : [];

    const messages = [
      { role: 'system', content: systemPrompt({ config: body.config ?? {}, copias: body.copias ?? 1, price: body.price, options: body.options ?? {} }) },
      ...history.slice(-12).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content ?? '').slice(0, 2000),
      })),
    ];

    const r = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, temperature: 0.3, max_tokens: 700, response_format: { type: 'json_object' }, messages }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: `LLM ${r.status}: ${t.slice(0, 300)}` });
    }
    const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content || '{}';

    let parsed: { reply?: unknown; changes?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { reply: content, changes: {} };
    }
    const reply = typeof parsed.reply === 'string' ? parsed.reply : 'Perdona, ¿me lo repites?';
    const changesIn = parsed.changes && typeof parsed.changes === 'object' ? (parsed.changes as Record<string, unknown>) : {};
    const changes: Record<string, unknown> = {};
    for (const k of CONFIG_KEYS) if (k in changesIn) changes[k] = changesIn[k];

    return res.status(200).json({ reply, changes });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error del asistente' });
  }
}
