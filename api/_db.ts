// Shared Neon (Postgres) client + schema bootstrap for the Vercel functions.
// Prefixed with "_" so Vercel does NOT expose it as an HTTP route.
import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL || '');

let ready: Promise<void> | null = null;

/** Create the tables on first use (idempotent). Orders hold structured data +
 *  small previews; the heavy binaries (print files, product artwork) live in
 *  R2 and are referenced by key. */
export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await sql`
        create table if not exists orders (
          id          text primary key,
          created_at  bigint not null,
          source      text not null,
          customer    jsonb not null,
          items       jsonb not null,
          total       double precision not null,
          status      text not null
        )`;
      await sql`
        create table if not exists settings (
          key         text primary key,
          value       jsonb not null,
          updated_at  bigint not null
        )`;
    })().catch((e) => {
      ready = null; // allow a retry on the next request
      throw e;
    });
  }
  return ready;
}
