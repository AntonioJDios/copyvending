import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureSchema, sql } from './_db';

/** Shared admin settings (catalog / prices) so every device sees the same shop
 *  configuration. Stored as a single JSON row in `settings`. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const rows = (await sql`select value from settings where key = 'catalog'`) as { value: unknown }[];
      return res.status(200).json(rows[0]?.value ?? null);
    }

    if (req.method === 'PUT') {
      const catalog = req.body;
      if (!catalog || typeof catalog !== 'object') return res.status(400).json({ error: 'catálogo inválido' });
      await sql`
        insert into settings (key, value, updated_at)
        values ('catalog', ${JSON.stringify(catalog)}::jsonb, ${Date.now()})
        on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'error de base de datos' });
  }
}
