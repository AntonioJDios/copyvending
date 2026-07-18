import { useState } from 'react';
import { API_BASE } from '../lib/api';
import type { Order, OrderStatus } from '../store/useOrders';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const STATUS_LABEL: Record<OrderStatus, string> = {
  nuevo: 'Recibido',
  en_proceso: 'En proceso',
  listo: 'Listo para recoger',
  entregado: 'Entregado',
};

/** Kiosk screen: a customer enters their order code to see its status. */
export function RecoverOrder() {
  const [code, setCode] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    const c = code.trim();
    if (!c || loading) return;
    setLoading(true);
    setError('');
    setOrder(null);
    try {
      const res = await fetch(`${API_BASE ?? ''}/orders?id=${encodeURIComponent(c)}`);
      if (!res.ok) throw new Error('no');
      setOrder((await res.json()) as Order);
    } catch {
      setError('No encontramos ningún pedido con ese código. Revísalo, por favor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>Recoger pedido</h1>
        <nav className="topnav">
          <a className="btn" href="#">← Volver</a>
        </nav>
      </header>

      <div className="recover">
        <section className="checkout-card">
          <h2>Introduce tu código de pedido</h2>
          <p className="muted">Lo recibiste por email al enviar tu trabajo (por ejemplo, P-AB12CD).</p>
          <div className="recover-form">
            <input
              type="text"
              value={code}
              autoFocus
              placeholder="P-XXXXXX"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void lookup();
              }}
            />
            <button type="button" className="btn btn-primary" onClick={() => void lookup()} disabled={loading || !code.trim()}>
              {loading ? 'Buscando…' : 'Buscar'}
            </button>
          </div>
          {error && <p className="recover-error">⚠ {error}</p>}
        </section>

        {order && (
          <section className="checkout-card">
            <div className="recover-head">
              <span className="order-id">{order.id}</span>
              <span className={`status-pill st-${order.status}`}>{STATUS_LABEL[order.status]}</span>
            </div>
            <p>
              A nombre de <b>{order.customer.nombre} {order.customer.apellidos}</b>
            </p>
            <p className="muted">
              {order.items.length} artículo{order.items.length !== 1 ? 's' : ''} · creado el{' '}
              {new Date(order.createdAt).toLocaleString('es-ES')}
            </p>
            <div className="checkout-total">
              <span>Total (se paga en el mostrador)</span>
              <strong>{eur(order.total)}</strong>
            </div>
            {order.status === 'listo' && <p className="recover-ready">🎉 ¡Tu pedido está listo! Pasa a recogerlo.</p>}
          </section>
        )}
      </div>
    </div>
  );
}
