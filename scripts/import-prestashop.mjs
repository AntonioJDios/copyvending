// Importa clientes + pedidos históricos de PrestaShop a Neon.
//
// Uso (desde copisteria-web):
//   node scripts/import-prestashop.mjs --dir="C:/Users/ajmn/Downloads"            (DRY-RUN: no escribe)
//   DATABASE_URL="postgres://…" node scripts/import-prestashop.mjs --dir="…" --commit   (escribe)
//
// Regla de clientes (decisión del dueño): importar si (tiene ≥1 pedido) O
// (aceptó marketing), + cuenta activa + email válido; dedup por email.
// Pedidos: solo válidos (valid=1); source='online' (Web); items=[] (solo
// fecha+importe para estadísticas). Idempotente (upsert por email / id).
import { readFileSync } from 'fs';
import { neon } from '@neondatabase/serverless';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const DIR = (args.find((a) => a.startsWith('--dir=')) || '--dir=C:/Users/ajmn/Downloads').slice(6).replace(/\/?$/, '/');

// ── Parser de dump MySQL (phpMyAdmin: INSERT ... (cols) VALUES (...),(...);) ──
const unesc = (s) => s.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\0/g, '').replace(/\\Z/g, '');
function parse(file, table, want) {
  const sql = readFileSync(DIR + file, 'utf8');
  const re = new RegExp('INSERT INTO `' + table + '` \\(([^)]*)\\) VALUES', 'g');
  let m, cols = null;
  const idx = {};
  const rows = [];
  while ((m = re.exec(sql))) {
    if (!cols) { cols = m[1].split(',').map((s) => s.trim().replace(/`/g, '')); want.forEach((w) => (idx[w] = cols.indexOf(w))); }
    let i = re.lastIndex;
    const n = sql.length;
    for (;;) {
      while (i < n && /\s/.test(sql[i])) i++;
      if (sql[i] !== '(') break;
      i++;
      const vals = [];
      let cur = '', str = false, isStr = false;
      while (i < n) {
        const ch = sql[i];
        if (str) {
          if (ch === '\\') { cur += ch + (sql[i + 1] ?? ''); i += 2; continue; }
          if (ch === "'") { str = false; i++; continue; }
          cur += ch; i++; continue;
        }
        if (ch === "'") { str = true; isStr = true; i++; continue; }
        if (ch === ',') { vals.push(isStr ? unesc(cur) : cur.trim() === 'NULL' ? null : cur.trim()); cur = ''; isStr = false; i++; continue; }
        if (ch === ')') { vals.push(isStr ? unesc(cur) : cur.trim() === 'NULL' ? null : cur.trim()); cur = ''; isStr = false; i++; break; }
        cur += ch; i++;
      }
      const o = {};
      for (const w of want) o[w] = idx[w] >= 0 ? vals[idx[w]] : undefined;
      rows.push(o);
      while (i < n && /\s/.test(sql[i])) i++;
      if (sql[i] === ',') { i++; continue; }
      break;
    }
    re.lastIndex = i;
  }
  return rows;
}
const toMs = (s) => { const t = new Date(String(s || '').replace(' ', 'T')).getTime(); return Number.isFinite(t) ? t : Date.now(); };
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Cargar dumps ──
const customers = parse('prstshp_customer.sql', 'prstshp_customer', ['id_customer', 'firstname', 'lastname', 'email', 'active', 'deleted', 'newsletter', 'optin', 'date_add']);
const orders = parse('prstshp_orders.sql', 'prstshp_orders', ['id_order', 'id_customer', 'total_paid_tax_incl', 'total_paid', 'date_add', 'valid']);
const addresses = parse('prstshp_address.sql', 'prstshp_address', ['id_customer', 'phone', 'phone_mobile', 'deleted']);

const phoneByCust = new Map();
for (const a of addresses) {
  if (a.deleted === '1') continue;
  const id = Number(a.id_customer);
  const ph = (a.phone_mobile || a.phone || '').trim();
  if (ph && !phoneByCust.has(id)) phoneByCust.set(id, ph.slice(0, 30));
}
const buyerIds = new Set(orders.map((o) => Number(o.id_customer)));
const fullCust = new Map(); // id → {nombre,apellidos,email} para poner nombre al pedido
for (const c of customers) fullCust.set(Number(c.id_customer), { nombre: (c.firstname || '').trim(), apellidos: (c.lastname || '').trim(), email: (c.email || '').toLowerCase().trim() });

// ── Clientes a importar (regla + dedup por email) ──
const byEmail = new Map();
for (const c of customers) {
  const email = (c.email || '').toLowerCase().trim();
  if (c.active !== '1' || c.deleted === '1' || !emailRe.test(email)) continue;
  if (email.endsWith('@prestashop.com')) continue; // cliente demo de PrestaShop
  const hasOrder = buyerIds.has(Number(c.id_customer));
  const consent = c.newsletter === '1' || c.optin === '1';
  if (!(hasOrder || consent)) continue;
  const rec = {
    id: 'ps-' + c.id_customer, email, nombre: (c.firstname || '').trim().slice(0, 120), apellidos: (c.lastname || '').trim().slice(0, 120),
    telefono: phoneByCust.get(Number(c.id_customer)) || '', consent, createdAt: toMs(c.date_add),
  };
  const prev = byEmail.get(email);
  if (!prev) byEmail.set(email, rec);
  else {
    prev.consent = prev.consent || consent;
    if (!prev.nombre && rec.nombre) prev.nombre = rec.nombre;
    if (!prev.apellidos && rec.apellidos) prev.apellidos = rec.apellidos;
    if (!prev.telefono && rec.telefono) prev.telefono = rec.telefono;
    if (rec.createdAt < prev.createdAt) prev.createdAt = rec.createdAt;
  }
}
const custRows = [...byEmail.values()];

// ── Pedidos a importar (válidos) ──
const orderRows = [];
for (const o of orders) {
  if (o.valid !== '1') continue;
  const cust = fullCust.get(Number(o.id_customer)) || {};
  orderRows.push({
    id: 'PS-' + o.id_order,
    created_at: toMs(o.date_add),
    total: parseFloat(o.total_paid_tax_incl || o.total_paid || '0') || 0,
    customer: { nombre: cust.nombre || '', apellidos: cust.apellidos || '', email: cust.email || '', accountId: 'ps-' + o.id_customer },
  });
}

console.log(`Clientes a importar: ${custRows.length} (con consentimiento: ${custRows.filter((r) => r.consent).length})`);
console.log(`Pedidos a importar:  ${orderRows.length} · importe ${orderRows.reduce((s, o) => s + o.total, 0).toFixed(2)} €`);
console.log('Ejemplos cliente:', custRows.slice(0, 2).map((r) => `${r.email} (${r.nombre})`).join(' · '));

if (!COMMIT) {
  console.log('\n🟡 DRY-RUN — no se ha escrito nada. Añade --commit (y DATABASE_URL) para importar.');
  process.exit(0);
}
if (!process.env.DATABASE_URL) { console.error('❌ Falta DATABASE_URL'); process.exit(1); }

const sql = neon(process.env.DATABASE_URL);
/** Insert rows in chunks. `casts[k]` is an optional per-column suffix (e.g. '::jsonb'). */
async function chunkInsert(table, rows, cols, casts, rowToParams, conflict) {
  const CH = 200;
  let done = 0;
  for (let i = 0; i < rows.length; i += CH) {
    const batch = rows.slice(i, i + CH);
    const params = [];
    const groups = batch.map((r) => {
      const p = rowToParams(r);
      const start = params.length;
      params.push(...p);
      return '(' + p.map((_, k) => `$${start + k + 1}${casts[k] || ''}`).join(',') + ')';
    });
    await sql.query(`insert into ${table} (${cols.join(',')}) values ${groups.join(',')} ${conflict}`, params);
    done += batch.length;
    process.stdout.write(`\r  ${table}: ${done}/${rows.length}`);
  }
  console.log();
}

console.log('\nEscribiendo en Neon…');
await sql.query('alter table customers add column if not exists marketing_consent boolean default false');
const now = Date.now();
await chunkInsert(
  'customers',
  custRows,
  ['id', 'email', 'nombre', 'apellidos', 'telefono', 'privacy_consent', 'consent_at', 'policy_version', 'marketing_consent', 'created_at', 'updated_at'],
  [], // sin casts
  (r) => [r.id, r.email, r.nombre, r.apellidos, r.telefono || null, true, r.createdAt, 'prestashop-import', r.consent, r.createdAt, now],
  `on conflict (email) do update set
     marketing_consent = customers.marketing_consent or excluded.marketing_consent,
     nombre = coalesce(nullif(customers.nombre, ''), excluded.nombre),
     apellidos = coalesce(nullif(customers.apellidos, ''), excluded.apellidos),
     telefono = coalesce(nullif(customers.telefono, ''), excluded.telefono)`
);
await chunkInsert(
  'orders',
  orderRows,
  ['id', 'created_at', 'source', 'customer', 'items', 'total', 'status', 'paid', 'payment_method', 'shipping_method', 'shipping_cost', 'price_mismatch'],
  ['', '', '', '::jsonb', '::jsonb', '', '', '', '', '', '', ''], // customer + items son jsonb
  (r) => [r.id, r.created_at, 'online', JSON.stringify(r.customer), '[]', r.total, 'entregado', true, 'prestashop', null, 0, false],
  'on conflict (id) do nothing'
);
console.log('✅ Importación completada.');
