import { useEffect, useState } from 'react';
import { API_BASE } from '../lib/api';
import { useConfigurator } from '../store/useConfigurator';
import { AccountButton } from './AccountButton';
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
  const loadProject = useConfigurator((s) => s.loadProject);
  const setEditingOrderId = useConfigurator((s) => s.setEditingOrderId);

  // Only orders still in the initial state, with a single copies project, can be
  // self-edited here (products/multi-item → shop handles it).
  const editable =
    order != null && order.status === 'nuevo' && order.items.length === 1 && order.items[0]?.kind === 'copias';

  const modify = () => {
    if (!order || !editable) return;
    loadProject(order.items[0]);
    setEditingOrderId(order.id);
    window.location.hash = '';
  };

  const lookup = async (codeArg?: string) => {
    const c = (codeArg ?? code).trim();
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

  // If arrived via a link like #recoger/P-XXXXXX, prefill and search automatically.
  useEffect(() => {
    const m = window.location.hash.match(/#recoger\/(.+)$/);
    if (m) {
      const c = decodeURIComponent(m[1]).trim().toUpperCase();
      setCode(c);
      void lookup(c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Recoger pedido</h1>
        <nav className="topnav">
          <a className="btn" href="#">← Volver</a>
          <AccountButton />
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
            {editable ? (
              <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={modify}>
                ✏️ Modificar pedido
              </button>
            ) : (
              order.status !== 'nuevo' && (
                <p className="muted" style={{ marginTop: 12 }}>
                  Este pedido ya está en proceso y no se puede modificar. Contacta con la copistería.
                </p>
              )
            )}
          </section>
        )}
      </div>
    </div>
  );
}
