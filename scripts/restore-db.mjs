#!/usr/bin/env node
/**
 * Restore a "copia completa" export (Configuración → Herramientas) into a Neon
 * database.
 *
 *   node scripts/restore-db.mjs copia-completa-2026-07-29-16-40.json
 *
 * Needs DATABASE_URL in the environment (the NEW database).
 *
 * A backup nobody has restored is not a backup, which is why this exists before
 * it is needed. Run it against an empty Neon branch once to prove it works.
 *
 * ── How a real recovery goes ──────────────────────────────────────────
 *  1. Create the new Neon project/branch and copy its connection string.
 *  2. Put it in Vercel as DATABASE_URL and redeploy.
 *  3. Open the backoffice once: the app CREATES THE SCHEMA itself (every table
 *     and column is created on demand by the code), so there is nothing to
 *     restore structurally.
 *  4. Run this script with the same connection string to put the rows back.
 *
 * ── What this does NOT recover ────────────────────────────────────────
 *  The customers' FILES. Those live in Cloudflare R2, a different service: losing
 *  the database does not lose them, and losing R2 is not fixed by this file. The
 *  export only carries the file REGISTRY (which key existed and how big it was).
 */
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/restore-db.mjs <copia-completa.json>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL en el entorno (la base de datos DESTINO).');
  process.exit(1);
}

const dump = JSON.parse(readFileSync(file, 'utf8'));
if (dump.format !== 'copisteria-db-export') {
  console.error('Ese archivo no es una copia completa de la copistería.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const t = dump.tables ?? {};
const rows = (name) => (Array.isArray(t[name]) ? t[name] : []);
const j = (v) => (v == null ? null : JSON.stringify(v));
const n = (v) => (v == null ? null : Number(v));

console.log(`Copia del ${dump.exportedAt}`);
for (const name of ['orders', 'customers', 'settings', 'files', 'payment_events']) {
  console.log(`  ${name}: ${rows(name).length} filas`);
}
console.log('');

let done = 0;
// ON CONFLICT DO NOTHING everywhere, so the script can be re-run safely and will
// never overwrite data that is already there (e.g. after a partial run).
for (const o of rows('orders')) {
  await sql`
    insert into orders (id, created_at, source, customer, items, total, status, price_mismatch, paid,
                        payment_method, shipping_method, shipping_cost, tracking, shipped_at, label,
                        coupon_code, coupon_discount, terms_version, terms_accepted_at, files_purged_at,
                        paid_at, payment_auth_code, payment_ref, payment_amount_cents)
    values (${o.id}, ${n(o.created_at)}, ${o.source}, ${j(o.customer)}::jsonb, ${j(o.items)}::jsonb,
            ${n(o.total)}, ${o.status}, ${o.price_mismatch ?? false}, ${o.paid ?? false},
            ${o.payment_method ?? null}, ${o.shipping_method ?? null}, ${n(o.shipping_cost)},
            ${o.tracking ?? null}, ${n(o.shipped_at)}, ${o.label ?? null},
            ${o.coupon_code ?? null}, ${n(o.coupon_discount)}, ${o.terms_version ?? null},
            ${n(o.terms_accepted_at)}, ${n(o.files_purged_at)},
            ${n(o.paid_at)}, ${o.payment_auth_code ?? null}, ${o.payment_ref ?? null}, ${n(o.payment_amount_cents)})
    on conflict (id) do nothing`;
  done++;
}
console.log(`orders: ${done} restaurados`);

done = 0;
for (const c of rows('customers')) {
  await sql`
    insert into customers (id, email, nombre, apellidos, telefono, privacy_consent, consent_at,
                           policy_version, created_at, updated_at, shipping, billing, billing_same, addresses)
    values (${c.id}, ${c.email}, ${c.nombre}, ${c.apellidos}, ${c.telefono ?? null},
            ${c.privacy_consent ?? false}, ${n(c.consent_at)}, ${c.policy_version ?? null},
            ${n(c.created_at)}, ${n(c.updated_at)}, ${j(c.shipping)}::jsonb, ${j(c.billing)}::jsonb,
            ${c.billing_same ?? true}, ${j(c.addresses)}::jsonb)
    on conflict (email) do nothing`;
  done++;
}
console.log(`customers: ${done} restaurados`);

// The catalogue, the coupons and the GLS config live here: without this the shop
// cannot price anything, so it is the most important table of the lot.
done = 0;
for (const s of rows('settings')) {
  await sql`
    insert into settings (key, value, updated_at)
    values (${s.key}, ${j(s.value)}::jsonb, ${n(s.updated_at) ?? Date.now()})
    on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`;
  done++;
}
console.log(`settings: ${done} restaurados`);

done = 0;
for (const f of rows('files')) {
  await sql`
    insert into files (key, project_id, size_bytes, created_at)
    values (${f.key}, ${f.project_id}, ${n(f.size_bytes)}, ${n(f.created_at)})
    on conflict (key) do nothing`;
  done++;
}
console.log(`files: ${done} restaurados`);

done = 0;
for (const e of rows('payment_events')) {
  await sql`
    insert into payment_events (received_at, order_id, payment_ref, response_code, auth_code,
                                amount_cents, applied, reason)
    values (${n(e.received_at)}, ${e.order_id ?? null}, ${e.payment_ref ?? null}, ${e.response_code ?? null},
            ${e.auth_code ?? null}, ${n(e.amount_cents)}, ${e.applied ?? false}, ${e.reason ?? null})`;
  done++;
}
console.log(`payment_events: ${done} restaurados`);

console.log('\nHecho. Comprueba en el panel que ves los precios y los pedidos.');
