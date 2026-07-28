import { useState } from 'react';
import { searchCustomers, customerOrders, type ClientRow, type ClientOrder } from '../lib/clients';
import type { Address } from '../store/useAuth';
import { AdminLogoutButton } from './AdminLogoutButton';

const eur = (n: number) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;
const fmtDate = (ts: number | string) => new Date(Number(ts)).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
const SOURCE_LABEL: Record<string, string> = { mostrador: 'Papelería', online: 'Web', email: 'Email' };
const STATUS_LABEL: Record<string, string> = { nuevo: 'Nuevo', en_proceso: 'En proceso', listo: 'Listo', entregado: 'Entregado' };

function fmtAddr(a: Address): string {
  return [a.linea1, a.linea2, [a.cp, a.ciudad].filter(Boolean).join(' '), a.provincia].filter(Boolean).join(' · ');
}

export function ClientsPanel() {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<ClientRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<ClientRow | null>(null);
  const [orders, setOrders] = useState<ClientOrder[] | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const search = async () => {
    const t = term.trim();
    if (t.length < 2) { setErr('Escribe al menos 2 caracteres del email.'); return; }
    setLoading(true);
    setErr('');
    setSelected(null);
    setOrders(null);
    try {
      setResults(await searchCustomers(t));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo buscar.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  const open = async (c: ClientRow) => {
    setSelected(c);
    setOrders(null);
    setOrdersLoading(true);
    try {
      setOrders(await customerOrders(c.email));
    } catch {
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  };

  return (
    <div className="app admin">
      <header className="topbar">
        <h1>Clientes</h1>
        <nav className="topnav">
          <a className="btn" href="#pedidos">Pedidos</a>
          <a className="btn" href="#estadisticas">📊 Estadísticas</a>
          <a className="btn" href="#admin">Catálogo</a>
          <a className="btn" href="#">← Tienda</a>
          <AdminLogoutButton />
        </nav>
      </header>

      <div className="admin-body">
        <section className="card">
          <h2>Buscar cliente por email</h2>
          <div className="recover-form">
            <input
              type="search"
              autoFocus
              placeholder="email o parte del email…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
            />
            <button type="button" className="btn btn-primary" onClick={() => void search()} disabled={loading}>
              {loading ? 'Buscando…' : 'Buscar'}
            </button>
          </div>
          {err && <p className="recover-error">⚠ {err}</p>}
          {results && results.length === 0 && <p className="muted">Sin resultados para “{term}”.</p>}
        </section>

        {results && results.length > 0 && (
          <section className="card">
            <h3>{results.length} cliente{results.length !== 1 ? 's' : ''}</h3>
            <div className="client-list">
              {results.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className={`client-row${selected?.id === c.id ? ' on' : ''}`}
                  onClick={() => void open(c)}
                >
                  <div className="client-main">
                    <b>{c.email}</b>
                    <span className="muted">{[c.nombre, c.apellidos].filter(Boolean).join(' ')}</span>
                  </div>
                  <div className="client-meta">
                    {c.telefono && <span className="muted">📞 {c.telefono}</span>}
                    <span className="chip">{c.orders_count} pedido{c.orders_count !== 1 ? 's' : ''}</span>
                    {c.marketing_consent ? <span className="chip pay-yes">✉ marketing</span> : <span className="chip">✉ no</span>}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {selected && (
          <section className="card">
            <h2>{selected.email}</h2>
            <p className="order-customer">
              👤 <b>{[selected.nombre, selected.apellidos].filter(Boolean).join(' ') || '—'}</b>
              {selected.telefono && <span className="muted"> · 📞 {selected.telefono}</span>}
              <span className="muted"> · alta {fmtDate(selected.created_at)}</span>
              <span className="muted"> · marketing: <b>{selected.marketing_consent ? 'sí' : 'no'}</b></span>
            </p>

            <h3>Direcciones</h3>
            {selected.addresses && selected.addresses.length > 0 ? (
              <div className="client-addr-list">
                {selected.addresses.map((a, i) => (
                  <div key={a.id ?? i} className="client-addr">
                    <span>
                      {a.nombre && <b>{a.nombre} · </b>}
                      {fmtAddr(a) || '—'}
                    </span>
                    <span className="client-addr-badges">
                      {a.defaultShipping && <span className="chip">📦 envío</span>}
                      {a.defaultBilling && <span className="chip">🧾 factura</span>}
                      {a.nif && <span className="muted">NIF {a.nif}</span>}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Sin direcciones guardadas.</p>
            )}

            <h3>Pedidos</h3>
            {ordersLoading ? (
              <p className="muted">Cargando pedidos…</p>
            ) : orders && orders.length > 0 ? (
              <div className="coupon-stats-wrap">
                <table className="coupon-stats-table">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Fecha</th>
                      <th>Origen</th>
                      <th>Estado</th>
                      <th>Pago</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td><b>{o.id}</b></td>
                        <td>{fmtDate(o.created_at)}</td>
                        <td>{SOURCE_LABEL[o.source] ?? o.source}</td>
                        <td>{STATUS_LABEL[o.status] ?? o.status}</td>
                        <td>{o.paid ? '💶 Pagado' : '⏳ Pend.'}</td>
                        <td>{eur(o.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Este cliente no tiene pedidos.</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
