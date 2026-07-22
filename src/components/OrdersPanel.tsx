import { useCallback, useEffect, useState } from 'react';
import { useOrders, type Order, type OrderStatus } from '../store/useOrders';
import { useConfigurator } from '../store/useConfigurator';
import { API_BASE } from '../lib/api';
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
const SOURCE_LABEL: Record<string, string> = {
  mostrador: '📟 Tablet',
  online: '🌐 Web',
  email: '📧 Email',
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

function OrderItem({ item, orderId, editable }: { item: CartProject; orderId: string; editable: boolean }) {
  const isCopias = item.kind === 'copias';
  const catalog = useConfigurator((s) => s.catalog);
  const loadProject = useConfigurator((s) => s.loadProject);
  const setEditingOrderId = useConfigurator((s) => s.setEditingOrderId);
  // Colour swatch for ring/back-cover specs (their value is a colour name).
  const swatchFor = (label: string, value: string): string | undefined => {
    if (label === 'Anillas') return catalog.ringColors.find((c) => c.name === value)?.hex;
    if (label === 'Contraportada') return catalog.coverColors.find((c) => c.name === value)?.hex;
    return undefined;
  };
  const onEdit = () => {
    loadProject(item);
    setEditingOrderId(orderId);
    window.location.hash = '';
  };
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
          {projectSpecLines(item).map(([k, v]) => {
            const hex = swatchFor(k, v);
            return (
              <div className="spec" key={k}>
                <dt>{k}</dt>
                {hex ? (
                  <dd className="spec-color">
                    <span className="spec-swatch" style={{ background: hex }} />
                    {v}
                  </dd>
                ) : (
                  <dd>{v}</dd>
                )}
              </div>
            );
          })}
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
        {isCopias && editable && (
          <button type="button" className="btn btn-small ord-edit" onClick={onEdit}>
            ✏️ Editar este proyecto
          </button>
        )}
      </div>
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  const setStatus = useOrders((s) => s.setStatus);
  const remove = useOrders((s) => s.remove);
  const [open, setOpen] = useState(false);
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
          <span className={`src-pill src-${order.source}`}>{SOURCE_LABEL[order.source] ?? order.source}</span>
          <span className={`status-pill st-${order.status}`}>{STATUS_LABEL[order.status]}</span>
          {order.priceMismatch && (
            <span className="price-flag" title="El precio enviado por el cliente no coincidía con el recalculado en el servidor. Se muestra el del servidor.">
              ⚠ precio recalculado
            </span>
          )}
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
              <OrderItem key={it.id} item={it} orderId={order.id} editable={order.status === 'nuevo'} />
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
  const fetchOrders = useOrders((s) => s.fetchOrders);
  const [filter, setFilter] = useState<'todos' | OrderStatus>('todos');
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [visible, setVisible] = useState(20);

  // Pull the Gmail inbox (slow IMAP) in the background, then refresh the list.
  const pullInbox = useCallback(async () => {
    setRefreshing(true);
    try {
      if (API_BASE) {
        try {
          await fetch(`${API_BASE}/ingest-email`, { method: 'POST' });
        } catch {
          /* no backend / no Gmail configured → ignore */
        }
      }
      await fetchOrders();
    } finally {
      setRefreshing(false);
    }
  }, [fetchOrders]);

  // On open: load the list first (fast) and read the inbox in the background so
  // Gmail never blocks the orders. Then poll the list (15s) and inbox (90s).
  useEffect(() => {
    void fetchOrders().finally(() => setInitialLoading(false));
    void pullInbox();
    const list = setInterval(() => void fetchOrders(), 15000);
    const inbox = setInterval(() => void pullInbox(), 90000);
    return () => {
      clearInterval(list);
      clearInterval(inbox);
    };
  }, [pullInbox, fetchOrders]);

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
          <button type="button" className="btn" onClick={() => void pullInbox()} disabled={refreshing}>
            {refreshing ? 'Actualizando…' : '↻ Actualizar'}
          </button>
          <a className="btn" href="#admin">
            Catálogo
          </a>
          <a className="btn" href="#estadisticas">
            📊 Estadísticas
          </a>
          <a className="btn" href="#">
            Tienda
          </a>
        </nav>
      </header>

      <div className="orders-body">
        <div className="orders-filters">
          {(['todos', 'nuevo', 'en_proceso', 'listo', 'entregado'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`filter-tab${filter === f ? ' filter-on' : ''}`}
              onClick={() => {
                setFilter(f);
                setVisible(20);
              }}
            >
              {f === 'todos' ? 'Todos' : STATUS_LABEL[f]}
              <span className="filter-count">{counts[f]}</span>
            </button>
          ))}
        </div>

        {initialLoading && orders.length === 0 ? (
          <p className="orders-empty">Cargando pedidos…</p>
        ) : shown.length === 0 ? (
          <p className="orders-empty">
            {orders.length === 0 ? 'Aún no hay pedidos. Los que se confirmen en la tienda aparecerán aquí.' : 'No hay pedidos en este estado.'}
          </p>
        ) : (
          <>
            <div className="orders-list">
              {shown.slice(0, visible).map((o) => (
                <OrderCard key={o.id} order={o} />
              ))}
            </div>
            {shown.length > visible && (
              <button type="button" className="btn orders-more" onClick={() => setVisible((v) => v + 20)}>
                Ver más ({shown.length - visible})
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
