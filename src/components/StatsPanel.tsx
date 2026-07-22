import { useEffect, useMemo, useState } from 'react';
import { useOrders } from '../store/useOrders';
import { aggregate, monthKey, seriesBy, splitVat, VAT_RATE, type Bucket, type SeriesPoint, type Unit } from '../lib/stats';
import { FINISH_LABEL, SIZE_LABEL } from '../domain/catalog';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const eur0 = (n: number) => `${Math.round(n).toLocaleString('es-ES')} €`;
const int = (n: number) => Math.round(n).toLocaleString('es-ES');
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

type Gran = 'month' | 'quarter';
type Metric = 'revenue' | 'orders';

const nowQuarterKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
};
const monthToQuarter = (m: string) => {
  const [y, mm] = m.split('-').map(Number);
  return `${y}-Q${Math.floor((mm - 1) / 3) + 1}`;
};

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

/** The immediately previous month/quarter (for period-over-period comparison). */
function prevPeriod(period: string): string | null {
  if (period === 'all') return null;
  if (period.includes('Q')) {
    let [y, q] = period.split('-Q').map(Number);
    q -= 1;
    if (q < 1) { q = 4; y -= 1; }
    return `${y}-Q${q}`;
  }
  let [y, m] = period.split('-').map(Number);
  m -= 1;
  if (m < 1) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
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
function tick(period: string, unit: Unit): string {
  if (unit === 'day') return String(Number(period.split('-')[2]));
  const [, m] = period.split('-').map(Number);
  return MONTHS[m - 1];
}

function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

const SOURCE_LABEL: Record<string, string> = { mostrador: 'Mostrador', online: 'Online', email: 'Email' };
const TYPE_LABEL: Record<string, string> = { copias: 'Copias / impresión', taza: 'Tazas', chapa: 'Chapas' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Statistics dashboard: revenue/orders by period (daily/monthly/quarterly), by
 *  source, by configuration and by the most frequent config combinations, with
 *  the IVA split for the quarterly tax return and period-over-period comparison. */
export function StatsPanel() {
  const orders = useOrders((s) => s.orders);
  const fetchOrders = useOrders((s) => s.fetchOrders);
  const loading = useOrders((s) => s.loading);

  const [source, setSource] = useState('all');
  const [gran, setGran] = useState<Gran>('quarter');
  const [period, setPeriod] = useState<string>(nowQuarterKey());
  const [metric, setMetric] = useState<Metric>('revenue');
  const [compare, setCompare] = useState(false);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  // Sources present (for the source filter).
  const sources = useMemo(() => [...new Set(orders.map((o) => o.source))], [orders]);

  // Periods available at the chosen granularity, for the source, most recent first.
  const periodOptions = useMemo(() => {
    const scoped = source === 'all' ? orders : orders.filter((o) => o.source === source);
    const months = [...new Set(scoped.map((o) => monthKey(o.createdAt)))];
    const keys = gran === 'month' ? months : [...new Set(months.map(monthToQuarter))];
    return ['all', ...keys.sort().reverse()];
  }, [orders, source, gran]);

  // Keep the selected period valid when granularity/source change.
  useEffect(() => {
    if (!periodOptions.includes(period)) setPeriod(periodOptions[1] ?? 'all');
  }, [periodOptions, period]);

  const range = useMemo(() => rangeOf(period), [period]);
  const data = useMemo(() => aggregate(orders, range.from, range.to, source), [orders, range.from, range.to, source]);

  const compareOn = compare && period !== 'all';
  const prevKey = compareOn ? prevPeriod(period) : null;
  const prevRange = prevKey ? rangeOf(prevKey) : null;
  const prevData = useMemo(
    () => (prevRange ? aggregate(orders, prevRange.from, prevRange.to, source) : null),
    [orders, prevRange, source]
  );

  // Trend unit: a month shows daily bars; a quarter or "todo" shows monthly bars.
  const unit: Unit = period !== 'all' && gran === 'month' ? 'day' : 'month';
  const curSeries = useMemo(() => seriesBy(orders, range.from, range.to, unit, source), [orders, range, unit, source]);
  const prevSeries = useMemo(
    () => (prevRange ? seriesBy(orders, prevRange.from, prevRange.to, unit, source) : null),
    [orders, prevRange, unit, source]
  );

  const mv = (p: { revenue: number; orders: number }) => (metric === 'revenue' ? p.revenue : p.orders);
  const mfmt = (n: number) => (metric === 'revenue' ? eur0(n) : int(n));
  const maxSeries = Math.max(1, ...curSeries.map(mv), ...(prevSeries ?? []).map(mv));

  const { base, vat } = splitVat(data.totals.revenue);
  const ticket = data.totals.orders > 0 ? data.totals.revenue / data.totals.orders : 0;
  const dRevenue = prevData ? pctDelta(data.totals.revenue, prevData.totals.revenue) : null;
  const dOrders = prevData ? pctDelta(data.totals.orders, prevData.totals.orders) : null;

  const combos = useMemo(
    () => [...data.byCombo].sort((a, b) => (metric === 'revenue' ? b.revenue - a.revenue : b.count - a.count)).slice(0, 10),
    [data.byCombo, metric]
  );

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
          <label className="stats-ctl">
            Fuente
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="all">Todas</option>
              {sources.map((s) => (
                <option key={s} value={s}>{SOURCE_LABEL[s] ?? cap(s)}</option>
              ))}
            </select>
          </label>

          <div className="seg-toggle">
            <button type="button" className={gran === 'month' ? 'on' : ''} onClick={() => setGran('month')}>Mensual</button>
            <button type="button" className={gran === 'quarter' ? 'on' : ''} onClick={() => setGran('quarter')}>Trimestral</button>
          </div>

          <select className="stats-period" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {periodOptions.map((o) => (
              <option key={o} value={o}>{periodLabel(o)}</option>
            ))}
          </select>

          <div className="seg-toggle">
            <button type="button" className={metric === 'revenue' ? 'on' : ''} onClick={() => setMetric('revenue')}>Ventas €</button>
            <button type="button" className={metric === 'orders' ? 'on' : ''} onClick={() => setMetric('orders')}>Pedidos</button>
          </div>

          <label className={`stats-cmp${period === 'all' ? ' disabled' : ''}`}>
            <input type="checkbox" checked={compareOn} disabled={period === 'all'} onChange={(e) => setCompare(e.target.checked)} />
            Comparar con periodo anterior
          </label>
        </div>

        {orders.length === 0 ? (
          <p className="muted" style={{ padding: 20 }}>{loading ? 'Cargando pedidos…' : 'Aún no hay pedidos para analizar.'}</p>
        ) : (
          <>
            {/* KPIs */}
            <div className="stats-kpis">
              <Kpi label="Facturación (IVA incl.)" value={eur(data.totals.revenue)} delta={dRevenue} strong />
              <Kpi label="Base imponible" value={eur(base)} />
              <Kpi label={`IVA (${Math.round(VAT_RATE * 100)}%)`} value={eur(vat)} accent />
              <Kpi label="Pedidos" value={int(data.totals.orders)} delta={dOrders} />
              <Kpi label="Ticket medio" value={eur(ticket)} />
            </div>
            {compareOn && prevKey && (
              <p className="muted stats-cmp-note">Comparando <b>{periodLabel(period)}</b> con <b>{periodLabel(prevKey)}</b>.</p>
            )}

            {/* Tendencia */}
            <section className="card">
              <h2>Evolución · {metric === 'revenue' ? 'ventas' : 'pedidos'} {unit === 'day' ? 'por día' : 'por mes'}</h2>
              {compareOn && prevSeries ? (
                <div className="trend-compare">
                  <TrendChart title={periodLabel(period)} total={mfmt(curSeries.reduce((s, p) => s + mv(p), 0))} points={curSeries} max={maxSeries} unit={unit} value={mv} fmt={mfmt} />
                  <TrendChart title={periodLabel(prevKey!)} total={mfmt(prevSeries.reduce((s, p) => s + mv(p), 0))} points={prevSeries} max={maxSeries} unit={unit} value={mv} fmt={mfmt} muted />
                </div>
              ) : (
                <TrendChart points={curSeries} max={maxSeries} unit={unit} value={mv} fmt={mfmt} />
              )}
            </section>

            {/* Combinaciones más frecuentes */}
            <section className="card">
              <h2>Combinaciones más pedidas</h2>
              <p className="muted">Las recetas reales de impresión que más {metric === 'revenue' ? 'facturan' : 'se piden'} en el periodo.</p>
              <Breakdown buckets={combos} metric={metric} labelOf={(k) => k} />
            </section>

            {/* Desgloses */}
            <div className="stats-cols">
              {source === 'all' && (
                <section className="card">
                  <h2>Por origen del pedido</h2>
                  <Breakdown buckets={data.bySource} metric={metric} labelOf={(k) => SOURCE_LABEL[k] ?? cap(k)} />
                </section>
              )}
              <section className="card">
                <h2>Por tipo de artículo</h2>
                <Breakdown buckets={data.byType} metric={metric} labelOf={(k) => TYPE_LABEL[k] ?? cap(k)} />
              </section>
            </div>

            <section className="card">
              <h2>Por configuración de impresión</h2>
              <p className="muted">{metric === 'revenue' ? 'Facturación' : 'Nº de proyectos'} por cada opción (trabajos de copias/impresión).</p>
              <div className="stats-cols">
                <Breakdown title="Color" buckets={data.byConfig.color} metric={metric} labelOf={(k) => (k === 'BN' ? 'Blanco y negro' : 'Color')} />
                <Breakdown title="Tamaño" buckets={data.byConfig.size} metric={metric} labelOf={(k) => SIZE_LABEL[k as keyof typeof SIZE_LABEL] ?? k} />
                <Breakdown title="Gramaje" buckets={data.byConfig.grosor} metric={metric} labelOf={(k) => `${k} g`} />
                <Breakdown title="Encuadernación" buckets={data.byConfig.acabado} metric={metric} labelOf={(k) => FINISH_LABEL[k as keyof typeof FINISH_LABEL] ?? k} />
                <Breakdown title="Caras" buckets={data.byConfig.dobleCara} metric={metric} labelOf={(k) => (k === '1' ? 'Doble cara' : 'Una cara')} />
              </div>
            </section>

            <p className="muted stats-note">
              IVA incluido en los precios al {Math.round(VAT_RATE * 100)}%; base y cuota calculadas para el modelo 303.
              {source !== 'all' && ` Datos filtrados por origen: ${SOURCE_LABEL[source] ?? cap(source)}.`}{' '}
              El histórico analizado son los últimos pedidos cargados; los periodos recientes están completos.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, delta, strong, accent }: { label: string; value: string; delta?: number | null; strong?: boolean; accent?: boolean }) {
  return (
    <div className={`stats-kpi${strong ? ' strong' : ''}${accent ? ' accent' : ''}`}>
      <span className="stats-kpi-val">{value}</span>
      <span className="stats-kpi-label">{label}</span>
      {delta != null && (
        <span className={`kpi-delta ${delta >= 0 ? 'up' : 'down'}`}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%
        </span>
      )}
    </div>
  );
}

function TrendChart({
  points, max, unit, value, fmt, title, total, muted,
}: {
  points: SeriesPoint[];
  max: number;
  unit: Unit;
  value: (p: SeriesPoint) => number;
  fmt: (n: number) => string;
  title?: string;
  total?: string;
  muted?: boolean;
}) {
  return (
    <div className="trend-wrap">
      {title && (
        <div className="trend-title">
          {title} <b>{total}</b>
        </div>
      )}
      <div className={`trend${muted ? ' trend-prev' : ''}`} role="img" aria-label={title ? `Evolución ${title}` : 'Evolución del periodo'}>
        {points.map((p) => (
          <div key={p.period} className="trend-col" title={`${p.period}: ${fmt(value(p))}`}>
            <span className="trend-bar" style={{ height: `${Math.max(2, (value(p) / max) * 100)}%` }} />
            <span className="trend-tick">{tick(p.period, unit)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Breakdown({ title, buckets, metric, labelOf }: { title?: string; buckets: Bucket[]; metric: Metric; labelOf: (k: string) => string }) {
  const valOf = (b: Bucket) => (metric === 'revenue' ? b.revenue : b.count);
  const fmt = (n: number) => (metric === 'revenue' ? eur(n) : `${int(n)} uds`);
  if (buckets.length === 0) return title ? <div className="stats-break"><h3>{title}</h3><p className="muted">—</p></div> : null;
  const max = Math.max(1, ...buckets.map(valOf));
  const total = buckets.reduce((s, b) => s + valOf(b), 0) || 1;
  return (
    <div className="stats-break">
      {title && <h3>{title}</h3>}
      {buckets.map((b) => {
        const v = valOf(b);
        const share = Math.round((v / total) * 100);
        return (
          <div key={b.key} className="statbar" title={`${labelOf(b.key)}: ${eur(b.revenue)} · ${b.count} uds`}>
            <span className="statbar-label">{labelOf(b.key)}</span>
            <span className="statbar-track">
              <span className="statbar-fill" style={{ width: `${(v / max) * 100}%` }} />
            </span>
            <span className="statbar-val">{fmt(v)} <em>{share}%</em></span>
          </div>
        );
      })}
    </div>
  );
}
