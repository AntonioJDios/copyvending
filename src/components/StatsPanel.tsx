import { useEffect, useMemo, useState } from 'react';
import { useOrders } from '../store/useOrders';
import { aggregate, splitVat, VAT_RATE, type Bucket } from '../lib/stats';
import { FINISH_LABEL, SIZE_LABEL } from '../domain/catalog';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const eur0 = (n: number) => `${Math.round(n).toLocaleString('es-ES')} €`;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

type Gran = 'month' | 'quarter';

const nowMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const nowQuarterKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
};
const monthToQuarter = (m: string) => {
  const [y, mm] = m.split('-').map(Number);
  return `${y}-Q${Math.floor((mm - 1) / 3) + 1}`;
};

/** [from, to] ms for a period key ('all' | 'YYYY-MM' | 'YYYY-Qn'). */
function rangeOf(period: string): { from: number; to: number } {
  if (period === 'all') return { from: 0, to: Number.MAX_SAFE_INTEGER };
  if (period.includes('Q')) {
    const [y, q] = period.split('-Q').map(Number);
    const startM = (q - 1) * 3;
    return { from: new Date(y, startM, 1).getTime(), to: new Date(y, startM + 3, 1).getTime() - 1 };
  }
  const [y, m] = period.split('-').map(Number);
  return { from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 1).getTime() - 1 };
}

function periodLabel(period: string): string {
  if (period === 'all') return 'Todo el histórico';
  if (period.includes('Q')) {
    const [y, q] = period.split('-Q');
    return `${q}º trimestre ${y}`;
  }
  const [y, m] = period.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
/** Short label for the trend axis. */
function tickLabel(period: string): string {
  if (period.includes('Q')) return `T${period.split('-Q')[1]}`;
  const [, m] = period.split('-').map(Number);
  return MONTHS[m - 1];
}

const SOURCE_LABEL: Record<string, string> = { mostrador: 'Mostrador', online: 'Online', email: 'Email' };
const TYPE_LABEL: Record<string, string> = { copias: 'Copias / impresión', taza: 'Tazas', chapa: 'Chapas' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Statistics dashboard: revenue by period (month / quarter), by source and by
 *  configuration, with the IVA split for the quarterly tax return. */
export function StatsPanel() {
  const orders = useOrders((s) => s.orders);
  const fetchOrders = useOrders((s) => s.fetchOrders);
  const loading = useOrders((s) => s.loading);

  const [gran, setGran] = useState<Gran>('quarter');
  const [period, setPeriod] = useState<string>(nowQuarterKey());

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const range = useMemo(() => rangeOf(period), [period]);
  const data = useMemo(() => aggregate(orders, range.from, range.to), [orders, range.from, range.to]);

  // Trend series at the chosen granularity, derived from the all-time monthly data.
  const series = useMemo(() => {
    if (gran === 'month') return data.monthly.map((m) => ({ period: m.period, revenue: m.revenue }));
    const q = new Map<string, number>();
    for (const m of data.monthly) {
      const k = monthToQuarter(m.period);
      q.set(k, (q.get(k) ?? 0) + m.revenue);
    }
    return [...q.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([p, revenue]) => ({ period: p, revenue }));
  }, [data.monthly, gran]);

  // Options for the period dropdown (most recent first) + "todo".
  const options = useMemo(() => ['all', ...series.map((s) => s.period).reverse()], [series]);

  const switchGran = (g: Gran) => {
    setGran(g);
    setPeriod(g === 'month' ? nowMonthKey() : nowQuarterKey());
  };

  const { base, vat } = splitVat(data.totals.revenue);
  const ticket = data.totals.orders > 0 ? data.totals.revenue / data.totals.orders : 0;
  const maxSeries = Math.max(1, ...series.map((s) => s.revenue));

  return (
    <div className="app admin">
      <header className="topbar">
        <h1>Estadísticas</h1>
        <nav className="topnav">
          <a className="btn" href="#pedidos">Pedidos</a>
          <a className="btn" href="#admin">Catálogo</a>
          <a className="btn" href="#">← Tienda</a>
        </nav>
      </header>

      <div className="admin-body stats">
        {/* Controles */}
        <div className="stats-controls">
          <div className="seg-toggle">
            <button type="button" className={gran === 'month' ? 'on' : ''} onClick={() => switchGran('month')}>Mensual</button>
            <button type="button" className={gran === 'quarter' ? 'on' : ''} onClick={() => switchGran('quarter')}>Trimestral</button>
          </div>
          <select className="stats-period" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {options.map((o) => (
              <option key={o} value={o}>{periodLabel(o)}</option>
            ))}
          </select>
        </div>

        {orders.length === 0 ? (
          <p className="muted" style={{ padding: 20 }}>{loading ? 'Cargando pedidos…' : 'Aún no hay pedidos para analizar.'}</p>
        ) : (
          <>
            {/* KPIs */}
            <div className="stats-kpis">
              <Kpi label="Facturación (IVA incl.)" value={eur(data.totals.revenue)} strong />
              <Kpi label="Base imponible" value={eur(base)} />
              <Kpi label={`IVA (${Math.round(VAT_RATE * 100)}%)`} value={eur(vat)} accent />
              <Kpi label="Pedidos" value={String(data.totals.orders)} />
              <Kpi label="Ticket medio" value={eur(ticket)} />
            </div>

            {/* Tendencia */}
            <section className="card">
              <h2>Evolución {gran === 'month' ? 'mensual' : 'trimestral'} · facturación</h2>
              <div className="trend" role="img" aria-label="Evolución de la facturación por periodo">
                {series.map((s) => {
                  const on = s.period === period;
                  return (
                    <button
                      key={s.period}
                      type="button"
                      className={`trend-col${on ? ' on' : ''}`}
                      onClick={() => setPeriod(s.period)}
                      title={`${periodLabel(s.period)}: ${eur(s.revenue)}`}
                    >
                      <span className="trend-val">{on ? eur0(s.revenue) : ''}</span>
                      <span className="trend-bar" style={{ height: `${Math.max(2, (s.revenue / maxSeries) * 100)}%` }} />
                      <span className="trend-tick">{tickLabel(s.period)}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Desgloses */}
            <div className="stats-cols">
              <section className="card">
                <h2>Por origen del pedido</h2>
                <Breakdown buckets={data.bySource} labelOf={(k) => SOURCE_LABEL[k] ?? cap(k)} />
              </section>

              <section className="card">
                <h2>Por tipo de artículo</h2>
                <Breakdown buckets={data.byType} labelOf={(k) => TYPE_LABEL[k] ?? cap(k)} />
              </section>
            </div>

            <section className="card">
              <h2>Por configuración de impresión</h2>
              <p className="muted">Cuánto factura cada opción (solo trabajos de copias/impresión del periodo).</p>
              <div className="stats-cols">
                <Breakdown title="Color" buckets={data.byConfig.color} labelOf={(k) => (k === 'BN' ? 'Blanco y negro' : 'Color')} />
                <Breakdown title="Tamaño" buckets={data.byConfig.size} labelOf={(k) => SIZE_LABEL[k as keyof typeof SIZE_LABEL] ?? k} />
                <Breakdown title="Gramaje" buckets={data.byConfig.grosor} labelOf={(k) => `${k} g`} />
                <Breakdown title="Encuadernación" buckets={data.byConfig.acabado} labelOf={(k) => FINISH_LABEL[k as keyof typeof FINISH_LABEL] ?? k} />
                <Breakdown title="Caras" buckets={data.byConfig.dobleCara} labelOf={(k) => (k === '1' ? 'Doble cara' : 'Una cara')} />
              </div>
            </section>

            <p className="muted stats-note">
              IVA incluido en los precios al {Math.round(VAT_RATE * 100)}%. Base y cuota calculadas para el modelo 303.
              El histórico analizado son los últimos pedidos cargados; los trimestres recientes están completos.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <div className={`stats-kpi${strong ? ' strong' : ''}${accent ? ' accent' : ''}`}>
      <span className="stats-kpi-val">{value}</span>
      <span className="stats-kpi-label">{label}</span>
    </div>
  );
}

function Breakdown({ title, buckets, labelOf }: { title?: string; buckets: Bucket[]; labelOf: (k: string) => string }) {
  if (buckets.length === 0) return title ? <div className="stats-break"><h3>{title}</h3><p className="muted">—</p></div> : null;
  const max = buckets[0].revenue || 1;
  const total = buckets.reduce((s, b) => s + b.revenue, 0) || 1;
  return (
    <div className="stats-break">
      {title && <h3>{title}</h3>}
      {buckets.map((b) => {
        const share = Math.round((b.revenue / total) * 100);
        return (
          <div key={b.key} className="statbar" title={`${labelOf(b.key)}: ${eur(b.revenue)} · ${b.count} uds`}>
            <span className="statbar-label">{labelOf(b.key)}</span>
            <span className="statbar-track">
              <span className="statbar-fill" style={{ width: `${(b.revenue / max) * 100}%` }} />
            </span>
            <span className="statbar-val">{eur(b.revenue)} <em>{share}%</em></span>
          </div>
        );
      })}
    </div>
  );
}
