import { useState } from 'react';
import { useOrders, type Order, type OrderStatus } from '../store/useOrders';
import type { CartProject } from '../store/useCart';
import { projectDisplayName, projectDocLines, projectSpecLines } from '../domain/orderSpec';
import { deleteProjectFiles } from '../lib/projectFiles';
import { downloadOrderZip } from '../lib/downloadZip';
import { CartDocsPreview } from './CartProjectCard';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

const STATUS: { id: OrderStatus; label: string }[] = [
  { id: 'nuevo', label: 'Nuevo' },
  { id: 'en_proceso', label: 'En proceso' },
  { id: 'listo', label: 'Listo' },
  { id: 'entregado', label: 'Entregado' },
];
const STATUS_LABEL: Record<OrderStatus, string> = {
  nuevo: 'Nuevo',
  en_proceso: 'En proceso',
  listo: 'Listo',
  entregado: 'Entregado',
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'ahora mismo';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function OrderItem({ item }: { item: CartProject }) {
  const isCopias = item.kind === 'copias';
  return (
    <div className="ord-item">
      <div className="ord-item-pic">
        {isCopias ? (
          <CartDocsPreview project={item} />
        ) : (
          <div className={`cart-product-preview${item.kind === 'chapa' ? ' round' : ''}`}>
            <img src={item.preview} alt="" />
          </div>
        )}
      </div>
      <div className="ord-item-info">
        <div className="ord-item-top">
          <strong>{projectDisplayName(item)}</strong>
          <span className="ord-item-price">{eur(item.total)}</span>
        </div>
        <dl className="ord-specs">
          {projectSpecLines(item).map(([k, v]) => (
            <div className="spec" key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {isCopias && (
          <ol className="ord-docs">
            {projectDocLines(item).map(([name, meta], i) => (
              <li key={i}>
                <span className="ord-doc-name">{name}</span>
                <span className="muted">{meta}</span>
              </li>
            ))}
          </ol>
        )}
        {isCopias && item.comentario.trim() && <span className="ord-note">“{item.comentario.trim()}”</span>}
      </div>
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  const setStatus = useOrders((s) => s.setStatus);
  const remove = useOrders((s) => s.remove);
  const [open, setOpen] = useState(order.status === 'nuevo');
  const [zipping, setZipping] = useState(false);

  const onDownload = async () => {
    setZipping(true);
    try {
      await downloadOrderZip(order);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudieron descargar los archivos.');
    } finally {
      setZipping(false);
    }
  };
  const onDelete = () => {
    if (!window.confirm(`¿Eliminar el pedido ${order.id} y sus archivos subidos?`)) return;
    order.items.forEach((p) => void deleteProjectFiles(p));
    remove(order.id);
  };

  return (
    <article className={`order-card status-${order.status}`}>
      <header className="order-head" onClick={() => setOpen((o) => !o)}>
        <div className="order-head-l">
          <span className="order-id">{order.id}</span>
          <span className={`src-pill src-${order.source}`}>{order.source === 'mostrador' ? '🏬 Mostrador' : '🌐 Online'}</span>
          <span className={`status-pill st-${order.status}`}>{STATUS_LABEL[order.status]}</span>
        </div>
        <div className="order-head-r">
          <span className="muted">{timeAgo(order.createdAt)}</span>
          <strong>{eur(order.total)}</strong>
          <span className="order-caret">{open ? '▾' : '▸'}</span>
        </div>
      </header>

      <div className="order-customer">
        👤 <b>{order.customer.nombre} {order.customer.apellidos}</b>
        {order.customer.telefono && <span className="muted"> · 📞 {order.customer.telefono}</span>}
        <span className="muted"> · {order.items.length} artículo{order.items.length !== 1 ? 's' : ''}</span>
      </div>

      {open && (
        <>
          <div className="order-items">
            {order.items.map((it) => (
              <OrderItem key={it.id} item={it} />
            ))}
          </div>

          <footer className="order-actions">
            <div className="order-status-row">
              <span className="muted">Estado:</span>
              {STATUS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`chip${order.status === s.id ? ' chip-active' : ''}`}
                  onClick={() => setStatus(order.id, s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="order-action-btns">
              <button type="button" className="btn btn-small btn-primary" onClick={onDownload} disabled={zipping}>
                {zipping ? 'Preparando…' : '⬇ Descargar archivos (ZIP)'}
              </button>
              <button type="button" className="chip chip-danger" onClick={onDelete}>
                Eliminar
              </button>
            </div>
          </footer>
        </>
      )}
    </article>
  );
}

export function OrdersPanel() {
  const orders = useOrders((s) => s.orders);
  const [filter, setFilter] = useState<'todos' | OrderStatus>('todos');

  const counts = {
    todos: orders.length,
    nuevo: orders.filter((o) => o.status === 'nuevo').length,
    en_proceso: orders.filter((o) => o.status === 'en_proceso').length,
    listo: orders.filter((o) => o.status === 'listo').length,
    entregado: orders.filter((o) => o.status === 'entregado').length,
  };
  const shown = filter === 'todos' ? orders : orders.filter((o) => o.status === filter);

  return (
    <div className="app admin">
      <header className="topbar">
        <h1>Pedidos</h1>
        <nav className="topnav">
          <a className="btn" href="#admin">
            Catálogo
          </a>
          <a className="btn" href="#">
            Tienda
          </a>
        </nav>
      </header>

      <div className="orders-body">
        <div className="orders-filters">
          {(['todos', 'nuevo', 'en_proceso', 'listo', 'entregado'] as const).map((f) => (
            <button key={f} type="button" className={`filter-tab${filter === f ? ' filter-on' : ''}`} onClick={() => setFilter(f)}>
              {f === 'todos' ? 'Todos' : STATUS_LABEL[f]}
              <span className="filter-count">{counts[f]}</span>
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="orders-empty">
            {orders.length === 0 ? 'Aún no hay pedidos. Los que se confirmen en la tienda aparecerán aquí.' : 'No hay pedidos en este estado.'}
          </p>
        ) : (
          <div className="orders-list">
            {shown.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
