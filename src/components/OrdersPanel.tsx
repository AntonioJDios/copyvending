import { useCallback, useEffect, useState } from 'react';
import { useOrders, type Order, type OrderStatus } from '../store/useOrders';
import { useConfigurator } from '../store/useConfigurator';
import { API_BASE, apiSend } from '../lib/api';
import type { CartProject } from '../store/useCart';
import { projectDisplayName, projectDocLines, projectSpecLines } from '../domain/orderSpec';
import { deleteProjectFiles } from '../lib/projectFiles';
import { downloadOrderZip } from '../lib/downloadZip';
import { downloadInvoice } from '../lib/invoicePdf';
import { downloadGlsLabel, glsTrackUrl } from '../lib/glsLabel';
import { DEFAULT_BUSINESS, DEFAULT_VAT_PERCENT } from '../domain/catalog';
import { AdminLogoutButton } from './AdminLogoutButton';
import { CartDocsPreview } from './CartProjectCard';
import { useStoredImage } from '../lib/thumbs';

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

/** Mug/badge preview: from storage when available, inline for older orders. */
function ProductPreview({ item }: { item: Exclude<CartProject, { kind: 'copias' }> }) {
  const url = useStoredImage(item.previewKey, item.storageToken, item.preview);
  return (
    <div className={`cart-product-preview${item.kind === 'chapa' ? ' round' : ''}`}>
      <img src={url} alt="" />
    </div>
  );
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
          <ProductPreview item={item} />
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
  const setPaid = useOrders((s) => s.setPaid);
  const markShipped = useOrders((s) => s.markShipped);
  const generateGls = useOrders((s) => s.generateGls);
  const deleteGlsLabel = useOrders((s) => s.deleteGlsLabel);
  const remove = useOrders((s) => s.remove);
  const invoicing = useConfigurator((s) => s.catalog.invoicing);
  const invoicingOn = !!invoicing?.enabled;
  // VAT rate set by the shop in the admin, not hardcoded.
  const vatPercent = invoicing?.vatPercent ?? DEFAULT_VAT_PERCENT;
  const business = useConfigurator((s) => s.catalog.business) ?? DEFAULT_BUSINESS;
  const [open, setOpen] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [tracking, setTracking] = useState(order.tracking ?? '');
  const [shipping, setShipping] = useState(false);
  const [glsBusy, setGlsBusy] = useState(false);

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
          <span className={`pay-pill ${order.paid ? 'pay-yes' : 'pay-no'}`}>{order.paid ? '💶 Pagado' : '⏳ Pendiente'}</span>
          {order.shippingMethod === 'envio' && order.shippedAt && <span className="pay-pill pay-yes">🚚 Enviado</span>}
          {order.filesPurgedAt && (
            <span className="pay-pill" title={`Los archivos del cliente se borraron el ${new Date(order.filesPurgedAt).toLocaleDateString('es-ES')} por la política de conservación. El pedido se conserva.`}>
              🗑 Archivos borrados
            </span>
          )}
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
      {order.shippingMethod === 'envio' && order.customer.shipping && (
        <div className="order-customer">
          🚚 <b>Envío</b>{order.shippingCost ? ` (${eur(order.shippingCost)})` : ' (gratis)'} ·{' '}
          <span className="muted">
            {[order.customer.shipping.linea1, order.customer.shipping.linea2, order.customer.shipping.cp, order.customer.shipping.ciudad, order.customer.shipping.provincia].filter(Boolean).join(', ')}
          </span>
        </div>
      )}
      {/* Reconciliation data from the bank: this is what you search for in the
          Redsys portal when a charge has to be traced or disputed. */}
      {order.paid && order.paymentMethod === 'redsys' && (order.paymentAuthCode || order.paymentRef) && (
        <div className="order-customer">
          💳 <b>Cobro Redsys</b>
          {order.paymentRef && <span className="muted"> · ref. {order.paymentRef}</span>}
          {order.paymentAuthCode && <span className="muted"> · autorización {order.paymentAuthCode}</span>}
          {order.paymentAmountCents != null && <span className="muted"> · {eur(order.paymentAmountCents / 100)}</span>}
          {order.paidAt && <span className="muted"> · {new Date(order.paidAt).toLocaleString('es-ES')}</span>}
        </div>
      )}
      {order.couponCode && (
        <div className="order-customer">
          🏷️ <b>Cupón {order.couponCode}</b>
          {order.couponDiscount ? <span className="muted"> · −{eur(order.couponDiscount)}</span> : null}
        </div>
      )}

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
            {order.shippingMethod === 'envio' && (
              <div className="order-ship-row">
                <input
                  type="text"
                  value={tracking}
                  placeholder="Nº de seguimiento / transportista"
                  onChange={(e) => setTracking(e.target.value)}
                />
                <button
                  type="button"
                  className="chip"
                  disabled={shipping}
                  onClick={async () => {
                    setShipping(true);
                    try {
                      await markShipped(order.id, tracking.trim());
                    } catch (e) {
                      alert(e instanceof Error ? e.message : 'No se pudo marcar como enviado.');
                    } finally {
                      setShipping(false);
                    }
                  }}
                >
                  {shipping ? 'Avisando…' : order.shippedAt ? '↻ Actualizar seguimiento' : '🚚 Marcar enviado y avisar'}
                </button>
              </div>
            )}
            {order.shippingMethod === 'envio' && (
              <div className="order-ship-row order-gls-row">
                <span className="muted">GLS:</span>
                {!order.hasLabel ? (
                  <button
                    type="button"
                    className="chip"
                    disabled={glsBusy}
                    onClick={async () => {
                      if (!window.confirm('¿Generar la etiqueta de envío con GLS y avisar al cliente?')) return;
                      setGlsBusy(true);
                      try {
                        const r = await generateGls(order.id);
                        setTracking(r.tracking);
                        alert(`Envío GLS creado ✔\nSeguimiento: ${r.tracking}\n${r.trackUrl}`);
                      } catch (e) {
                        alert(e instanceof Error ? e.message : 'No se pudo generar el envío GLS.');
                      } finally {
                        setGlsBusy(false);
                      }
                    }}
                  >
                    {glsBusy ? 'Generando…' : '🏷️ Generar etiqueta'}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => downloadGlsLabel(order.id).catch((e) => alert(e instanceof Error ? e.message : 'No se pudo descargar la etiqueta.'))}
                    >
                      ⬇ Descargar etiqueta
                    </button>
                    {order.tracking && (
                      <a className="chip" href={glsTrackUrl(order.tracking)} target="_blank" rel="noopener noreferrer">
                        🔎 Seguir
                      </a>
                    )}
                    <button
                      type="button"
                      className="chip chip-danger"
                      disabled={glsBusy}
                      onClick={async () => {
                        if (!window.confirm('¿Borrar la etiqueta para poder generar una nueva?\n\nLa expedición anterior seguirá en tu cuenta de GLS (anúlala allí si hace falta).')) return;
                        setGlsBusy(true);
                        try {
                          await deleteGlsLabel(order.id);
                          setTracking('');
                        } catch (e) {
                          alert(e instanceof Error ? e.message : 'No se pudo borrar la etiqueta.');
                        } finally {
                          setGlsBusy(false);
                        }
                      }}
                    >
                      {glsBusy ? '…' : '🗑️ Borrar etiqueta'}
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="order-action-btns">
              <button type="button" className="btn btn-small btn-primary" onClick={onDownload} disabled={zipping}>
                {zipping ? 'Preparando…' : '⬇ Descargar archivos (ZIP)'}
              </button>
              <button type="button" className="chip" onClick={() => void setPaid(order.id, !order.paid)}>
                {order.paid ? '↩ Marcar pendiente' : '💶 Marcar pagado'}
              </button>
              {invoicingOn && (
                <button type="button" className="chip" onClick={() => void downloadInvoice(order, business, vatPercent)}>
                  🧾 {order.paid ? 'Ticket' : 'Albarán'}
                </button>
              )}
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
  const loadMore = useOrders((s) => s.loadMore);
  const serverCounts = useOrders((s) => s.counts);
  const cursor = useOrders((s) => s.cursor);
  const listLoading = useOrders((s) => s.loading);
  const [filter, setFilter] = useState<'todos' | OrderStatus>('todos');
  const [srcFilter, setSrcFilter] = useState<'todas' | string>('todas');
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [term, setTerm] = useState('');

  // Filters and search run in SQL (like the statistics), so the list is never
  // capped and the counters are the real totals, not what happens to be loaded.
  const applyQuery = (next: { status?: 'todos' | OrderStatus; source?: 'todas' | string; q?: string }) => {
    const status = next.status ?? filter;
    const source = next.source ?? srcFilter;
    const q = next.q ?? term;
    if (next.status !== undefined) setFilter(next.status);
    if (next.source !== undefined) setSrcFilter(next.source);
    if (next.q !== undefined) setTerm(next.q);
    void fetchOrders({
      status: status === 'todos' ? undefined : status,
      source: source === 'todas' ? undefined : source,
      q: q.trim() || undefined,
    });
  };

  // Pull the Gmail inbox (slow IMAP) in the background, then refresh the list.
  const pullInbox = useCallback(async () => {
    setRefreshing(true);
    try {
      const emailOn = useConfigurator.getState().catalog.emailEnabled ?? true;
      if (API_BASE && emailOn) {
        try {
          // Admin-only endpoint (it spends LLM/storage and creates orders).
          await apiSend('POST', '/ingest-email');
        } catch {
          /* no backend / no Gmail configured → ignore */
        }
      }
      // Retention sweep: costs one query that returns nothing when there is
      // nothing old enough to purge.
      try {
        await apiSend('POST', '/orders?purge=1');
      } catch {
        /* best-effort housekeeping; never block the panel */
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

  // Totals over the whole history, from the server. Status counts respect the
  // source filter and vice versa, so each badge says what clicking it would show.
  const sumBy = (pick: (r: { status: string; source: string; n: number }) => boolean) =>
    serverCounts.reduce((t, r) => (pick(r) ? t + r.n : t), 0);
  const inSrc = (r: { source: string }) => srcFilter === 'todas' || r.source === srcFilter;
  const inStatus = (r: { status: string }) => filter === 'todos' || r.status === filter;
  const counts = {
    todos: sumBy(inSrc),
    nuevo: sumBy((r) => inSrc(r) && r.status === 'nuevo'),
    en_proceso: sumBy((r) => inSrc(r) && r.status === 'en_proceso'),
    listo: sumBy((r) => inSrc(r) && r.status === 'listo'),
    entregado: sumBy((r) => inSrc(r) && r.status === 'entregado'),
  };
  const sources = [...new Set(serverCounts.map((r) => r.source))];
  const total = sumBy(() => true);
  // The server already filtered: what came back IS what to show.
  const shown = orders;

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
          <a className="btn" href="#clientes">
            👥 Clientes
          </a>
          <a className="btn" href="#">
            Tienda
          </a>
          <AdminLogoutButton />
        </nav>
      </header>

      <div className="orders-body">
        {sources.length > 1 && (
          <div className="orders-filters orders-filters-src">
            <span className="filter-group-label">Origen</span>
            <button
              type="button"
              className={`filter-tab${srcFilter === 'todas' ? ' filter-on' : ''}`}
              onClick={() => applyQuery({ source: 'todas' })}
            >
              Todas
              <span className="filter-count">{total}</span>
            </button>
            {sources.map((s) => (
              <button
                key={s}
                type="button"
                className={`filter-tab${srcFilter === s ? ' filter-on' : ''}`}
                onClick={() => applyQuery({ source: s })}
              >
                {SOURCE_LABEL[s] ?? s}
                <span className="filter-count">{sumBy((r) => r.source === s && inStatus(r))}</span>
              </button>
            ))}
          </div>
        )}

        {/* Search runs in SQL over the whole history: at a few thousand orders,
            scrolling is not a way to find anything. */}
        <div className="orders-search">
          <input
            type="search"
            value={term}
            placeholder="Buscar por código, email o nombre…"
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyQuery({ q: term });
            }}
          />
          <button type="button" className="btn" onClick={() => applyQuery({ q: term })}>
            Buscar
          </button>
          {term && (
            <button type="button" className="chip" onClick={() => applyQuery({ q: '' })}>
              Limpiar
            </button>
          )}
        </div>

        <div className="orders-filters">
          <span className="filter-group-label">Estado</span>
          {(['todos', 'nuevo', 'en_proceso', 'listo', 'entregado'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`filter-tab${filter === f ? ' filter-on' : ''}`}
              onClick={() => applyQuery({ status: f })}
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
            {orders.length === 0 ? 'Aún no hay pedidos. Los que se confirmen en la tienda aparecerán aquí.' : 'No hay pedidos con estos filtros.'}
          </p>
        ) : (
          <>
            <div className="orders-list">
              {shown.map((o) => (
                <OrderCard key={o.id} order={o} />
              ))}
            </div>
            {cursor && (
              <button type="button" className="btn orders-more" onClick={() => void loadMore()} disabled={listLoading}>
                {listLoading ? 'Cargando…' : 'Ver más pedidos'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
