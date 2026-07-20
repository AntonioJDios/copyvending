import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

// Interactive "assistant studio": given the analysis of dropped files + a chat,
// group them into one or more print PROJECTS with their configuration. Same
// spirit as the email grouping, but conversational. Self-contained.
const LLM_BASE = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
const LLM_KEY = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';

const CONFIG_KEYS = [
  'size', 'color', 'grosor', 'dobleCara', 'orientacion', 'paginasPorHoja',
  'acabado', 'acabadoFolios', 'juntos', 'sinMargenes', 'ladoEncuadernacion',
  'foliosDelante', 'foliosDetras',
];

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function matchColor(value: unknown, options: string[]): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const nv = norm(value.trim());
  let hit = options.find((o) => norm(o) === nv);
  if (hit) return hit;
  hit = options.find((o) => norm(o).includes(nv) || nv.includes(norm(o)));
  if (hit) return hit;
  const roots = nv.split(/\s+/).filter((w) => w.length >= 4 && !['plastico', 'color', 'pastel'].includes(w)).map((w) => w.replace(/(es|as|os|a|o|s)$/, '').slice(0, 5));
  return options.find((o) => roots.some((r) => r.length >= 3 && norm(o).includes(r)));
}

async function getColors(): Promise<{ ring: string[]; cover: string[]; instructions: string }> {
  const fallback = {
    ring: ['Transparente', 'Negro', 'Verde Menta', 'Amarillo Golden', 'Turquesa', 'Rosa Pastel', 'Azul Pastel', 'Lila', 'Azul Purpurina'],
    cover: ['Plástico Negro', 'Plástico Rojo', 'Plástico Transparente', 'Plástico Verde Pastel', 'Plástico Amarillo Pastel', 'Plástico Azul Pastel', 'Plástico Naranja Pastel', 'Plástico Rosa Pastel', 'Plástico Lila Pastel'],
    instructions: '',
  };
  try {
    if (!process.env.DATABASE_URL) return fallback;
    const sql = neon(process.env.DATABASE_URL);
    const rows = (await sql`select value from settings where key = 'catalog'`) as {
      value: { ringColors?: { name: string; enabled?: boolean }[]; coverColors?: { name: string; enabled?: boolean }[]; assistant?: { instructions?: string } };
    }[];
    const c = rows[0]?.value;
    if (c) {
      const ring = (c.ringColors || []).filter((x) => x.enabled !== false).map((x) => x.name);
      const cover = (c.coverColors || []).filter((x) => x.enabled !== false).map((x) => x.name);
      if (ring.length) return { ring, cover: cover.length ? cover : fallback.cover, instructions: c.assistant?.instructions || '' };
    }
  } catch {
    /* fallback */
  }
  return fallback;
}

interface FileInfo {
  name: string;
  pages?: number;
  orientation?: string;
  hasColor?: boolean;
  colorPages?: number;
  title?: string;
  textExcerpt?: string;
}
interface ProjectPlan {
  files: string[];
  nombre?: string;
  changes: Record<string, unknown>;
  copias: number;
  docColor: 'no' | 'cover' | 'all';
  colorAnillas?: string;
  colorContraportada?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    if (!LLM_KEY) return res.status(500).json({ error: 'Falta GROQ_API_KEY en el servidor' });
    const body = (req.body ?? {}) as { analyses?: FileInfo[]; history?: { role?: string; content?: string }[]; message?: string };
    const files = Array.isArray(body.analyses) ? body.analyses.slice(0, 20) : [];
    const allNames = files.map((f) => f.name);
    if (files.length === 0) return res.status(400).json({ error: 'sin archivos que planificar' });

    const colors = await getColors();
    const system = [
      'Eres el asistente de una copistería de autoservicio. Hablas español, cercano y breve.',
      'El cliente ha soltado varios archivos y te dice cómo quiere imprimirlos. Tu tarea: agruparlos en uno o VARIOS PROYECTOS y dar a cada uno su configuración.',
      '- Archivos que van JUNTOS (misma config y/o encuadernados juntos) → mismo proyecto.',
      '- Archivos con configuración distinta o que no se encuadernan juntos → proyectos separados.',
      '- Si el cliente no ha dado detalles suficientes, PREGÚNTALE en "reply" y deja "projects" con tu mejor propuesta por defecto.',
      '',
      'Config por proyecto (claves/valores EXACTOS):',
      '- size: A4|A3|A5 · color: BN|Color · grosor: 80|90|100|120|250 · dobleCara: "0"|"1" · paginasPorHoja: 1|2|4 · orientacion: vertical|horizontal',
      '- acabado: sinencuadernacion|grapado|AnillasColores|dos_agujeros|cuatro_agujeros|perforado · juntos: agrupados|individual · sinMargenes: true|false',
      '- acabadoFolios: normal|plastificar|pegatinas · ladoEncuadernacion: largo|corto · docColor: no|cover|all · copias: entero',
      `- colorAnillas (solo AnillasColores): [${colors.ring.join(', ')}] · colorContraportada: [${colors.cover.join(', ')}]`,
      'Orientación: fija "orientacion" según la del archivo; vertical→lado largo, horizontal→lado corto. Gramaje por defecto 90.',
      colors.instructions ? `Indicaciones del dueño: ${colors.instructions.slice(0, 1000)}` : '',
      `ARCHIVOS (usa los nombres EXACTOS): ${JSON.stringify(files)}`,
      'Responde SOLO con JSON: { "reply": "<respuesta breve>", "projects": [ { "files": ["a.pdf"], "nombre": "<opcional>", "config": { <config> }, "copias": <n>, "docColor": "no|cover|all", "colorAnillas": "<opc>", "colorContraportada": "<opc>" } ] }',
    ].join('\n');

    const history = Array.isArray(body.history) ? body.history.slice(-10).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '').slice(0, 1500) })) : [];
    const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: String(body.message ?? 'Configúralos como creas mejor.').slice(0, 2000) }];

    const r = await fetch(`${LLM_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${LLM_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: LLM_MODEL, temperature: 0.2, max_tokens: 1000, response_format: { type: 'json_object' }, messages }),
    });
    if (!r.ok) return res.status(502).json({ error: `LLM ${r.status}: ${(await r.text()).slice(0, 200)}` });
    const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    let parsed: { reply?: unknown; projects?: unknown } = {};
    try {
      parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    } catch {
      /* keep empty */
    }
    const reply = typeof parsed.reply === 'string' ? parsed.reply : 'Te propongo esta configuración.';
    const raw = Array.isArray(parsed.projects) ? (parsed.projects as Record<string, unknown>[]) : [];
    let projects: ProjectPlan[] = raw.map((pr) => {
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
    projects = projects.filter((p) => p.files.length > 0);
    const assigned = new Set(projects.flatMap((p) => p.files));
    const leftover = allNames.filter((n) => !assigned.has(n));
    if (projects.length === 0) projects = [{ files: allNames, changes: {}, copias: 1, docColor: 'no' }];
    else if (leftover.length) projects.push({ files: leftover, changes: {}, copias: 1, docColor: 'no' });

    return res.status(200).json({ reply, projects });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error de planificación' });
  }
}
