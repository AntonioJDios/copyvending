import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useOrders, type Order } from '../store/useOrders';
import { aggregate, couponAnalytics, monthKey, seriesBy, splitVat, VAT_RATE, type Bucket, type CouponRow, type SeriesPoint, type Unit } from '../lib/stats';
import { downloadFiscalPdf } from '../lib/fiscalPdf';
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
  const [dailyDays, setDailyDays] = useState(90);
  // Deep link like #estadisticas/cupon/CODE opens the Coupons tab focused on it.
  const initialCoupon = (() => {
    const m = window.location.hash.match(/#estadisticas\/cupon\/(.+)$/i);
    return m ? decodeURIComponent(m[1].split(/[?&]/)[0]).trim().toUpperCase() : '';
  })();
  const [statsTab, setStatsTab] = useState<'resumen' | 'config' | 'cupones'>(initialCoupon ? 'cupones' : 'resumen');

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

  // Keep the selected period valid when granularity/source change. Only act once
  // there are real periods (length > 1, since 'all' is always present) so the
  // initial empty-orders render doesn't leave us stuck on "Todo el histórico".
  useEffect(() => {
    if (periodOptions.length > 1 && !periodOptions.includes(period)) setPeriod(periodOptions[1]);
  }, [periodOptions, period]);

  const range = useMemo(() => rangeOf(period), [period]);
  const data = useMemo(() => aggregate(orders, range.from, range.to, source), [orders, range.from, range.to, source]);

  // Trend unit: a month shows daily bars; a quarter or "todo" shows monthly bars.
  const unit: Unit = period !== 'all' && gran === 'month' ? 'day' : 'month';
  const curSeries = useMemo(() => seriesBy(orders, range.from, range.to, unit, source), [orders, range, unit, source]);

  // Dedicated daily-evolution window (independent of the fiscal period).
  const dailyRange = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { from: start.getTime() - (dailyDays - 1) * 86400000, to: start.getTime() + 86400000 - 1 };
  }, [dailyDays]);
  const dailySeries = useMemo(
    () => seriesBy(orders, dailyRange.from, dailyRange.to, 'day', source),
    [orders, dailyRange, source]
  );
  // Previous window of the same length, for the daily-chart overlay.
  const dailyPrevSeries = useMemo(() => {
    if (!compare) return null;
    const len = dailyDays * 86400000;
    return seriesBy(orders, dailyRange.from - len, dailyRange.from - 1, 'day', source);
  }, [compare, orders, dailyRange, dailyDays, source]);

  const mv = (p: { revenue: number; orders: number }) => (metric === 'revenue' ? p.revenue : p.orders);
  const mfmt = (n: number) => (metric === 'revenue' ? eur0(n) : int(n));
  const maxSeries = Math.max(1, ...curSeries.map(mv));

  const { base, vat } = splitVat(data.totals.revenue);
  const ticket = data.totals.orders > 0 ? data.totals.revenue / data.totals.orders : 0;

  const combos = useMemo(
    () => [...data.byCombo].sort((a, b) => (metric === 'revenue' ? b.revenue - a.revenue : b.count - a.count)).slice(0, 10),
    [data.byCombo, metric]
  );

  const exportPdf = () => {
    const months = data.monthly
      .filter((m) => {
        const [y, mm] = m.period.split('-').map(Number);
        const t = new Date(y, mm - 1, 1).getTime();
        return t >= range.from && t <= range.to;
      })
      .map((m) => {
        const [y, mm] = m.period.split('-').map(Number);
        return { label: `${MONTHS[mm - 1]} ${y}`, orders: m.orders, revenue: m.revenue };
      });
    const bySourceRows = source === 'all' ? data.bySource.map((b) => ({ label: SOURCE_LABEL[b.key] ?? cap(b.key), orders: b.count, revenue: b.revenue })) : [];
    void downloadFiscalPdf({
      title: `Resumen fiscal — ${periodLabel(period)}`,
      sourceLabel: source === 'all' ? 'Todas las fuentes' : SOURCE_LABEL[source] ?? cap(source),
      filename: `resumen-fiscal-${period}`,
      totals: { revenue: data.totals.revenue, orders: data.totals.orders },
      months,
      bySource: bySourceRows,
      vatRate: VAT_RATE,
    });
  };

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

          <button type="button" className="btn btn-primary stats-pdf" onClick={exportPdf} disabled={data.totals.orders === 0}>
            📄 PDF para el asesor
          </button>
        </div>

        {orders.length === 0 ? (
          <p className="muted" style={{ padding: 20 }}>{loading ? 'Cargando pedidos…' : 'Aún no hay pedidos para analizar.'}</p>
        ) : (
          <>
            <nav className="admin-tabs stats-tabs">
              <button type="button" className={`admin-tab${statsTab === 'resumen' ? ' on' : ''}`} onClick={() => setStatsTab('resumen')}>Resumen</button>
              <button type="button" className={`admin-tab${statsTab === 'config' ? ' on' : ''}`} onClick={() => setStatsTab('config')}>Configuraciones</button>
              <button type="button" className={`admin-tab${statsTab === 'cupones' ? ' on' : ''}`} onClick={() => setStatsTab('cupones')}>Cupones</button>
            </nav>

            {statsTab === 'resumen' && (
              <>
                {/* KPIs */}
                <div className="stats-kpis">
                  <Kpi label="Facturación (IVA incl.)" value={eur(data.totals.revenue)} strong />
                  <Kpi label="Base imponible" value={eur(base)} />
                  <Kpi label={`IVA (${Math.round(VAT_RATE * 100)}%)`} value={eur(vat)} accent />
                  <Kpi label="Pedidos" value={int(data.totals.orders)} />
                  <Kpi label="Ticket medio" value={eur(ticket)} />
                </div>

                {/* Tendencia del periodo */}
                <section className="card">
                  <h2>Evolución · {metric === 'revenue' ? 'ventas' : 'pedidos'} {unit === 'day' ? 'por día' : 'por mes'}</h2>
                  <TrendChart points={curSeries} max={maxSeries} unit={unit} value={mv} fmt={mfmt} />
                </section>

                {/* Evolución diaria (ventana propia) */}
                <section className="card">
                  <div className="stats-card-head">
                    <h2>Evolución diaria · {metric === 'revenue' ? 'ventas' : 'pedidos'}</h2>
                    <div className="dayline-ctls">
                      <label className="stats-cmp sm">
                        <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
                        Comparar periodo anterior
                      </label>
                      <div className="seg-toggle sm">
                        {[30, 90, 180, 365].map((d) => (
                          <button key={d} type="button" className={dailyDays === d ? 'on' : ''} onClick={() => setDailyDays(d)}>{d}d</button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <DailyLine points={dailySeries} prevPoints={dailyPrevSeries} value={mv} fmt={mfmt} />
                </section>

                <p className="muted stats-note">
                  IVA incluido en los precios al {Math.round(VAT_RATE * 100)}%; base y cuota calculadas para el modelo 303.
                  {source !== 'all' && ` Datos filtrados por origen: ${SOURCE_LABEL[source] ?? cap(source)}.`}{' '}
                  El histórico analizado son los últimos pedidos cargados; los periodos recientes están completos.
                </p>
              </>
            )}

            {statsTab === 'config' && (
              <>
                {/* Combinaciones más frecuentes */}
                <section className="card">
                  <h2>Combinaciones de papel más pedidas</h2>
                  <p className="muted">Tamaño · color · caras · gramaje (sin encuadernación) que más {metric === 'revenue' ? 'facturan' : 'se piden'} en el periodo.</p>
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
                    <Breakdown title="Nº de copias" buckets={data.byCopies} metric={metric} labelOf={(k) => k} />
                  </div>
                </section>
              </>
            )}

            {statsTab === 'cupones' && <CouponStats orders={orders} source={source} initialCoupon={initialCoupon} />}
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

/** Daily line/area chart. Current window = solid brand line + area; the optional
 *  previous window (same length) overlays as a dashed grey line, aligned by day
 *  index. Only paths + hover rects live in the SVG (stretched, non-scaling
 *  stroke); axis, legend and figures are HTML so they never distort. */
function DailyLine({
  points, prevPoints, value, fmt,
}: {
  points: SeriesPoint[];
  prevPoints?: SeriesPoint[] | null;
  value: (p: SeriesPoint) => number;
  fmt: (n: number) => string;
}) {
  const W = 760;
  const H = 200;
  const padT = 12;
  const padB = 8;
  const n = points.length;
  const innerH = H - padT - padB;
  const baseline = padT + innerH;
  const all = prevPoints ? [...points, ...prevPoints] : points;
  const max = Math.max(1, ...all.map(value));
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const xOf = (i: number, len: number) => (len <= 1 ? W / 2 : (i / (len - 1)) * W);

  const linePath = (pp: SeriesPoint[]) =>
    pp.map((p, i) => `${i ? 'L' : 'M'}${xOf(i, pp.length).toFixed(1)},${y(value(p)).toFixed(1)}`).join(' ');
  const areaPath = (pp: SeriesPoint[]) =>
    pp.length
      ? `M${xOf(0, pp.length).toFixed(1)},${baseline} ${pp.map((p, i) => `L${xOf(i, pp.length).toFixed(1)},${y(value(p)).toFixed(1)}`).join(' ')} L${xOf(pp.length - 1, pp.length).toFixed(1)},${baseline} Z`
      : '';

  const total = points.reduce((s, p) => s + value(p), 0);
  const prevTotal = prevPoints ? prevPoints.reduce((s, p) => s + value(p), 0) : 0;
  const bw = n > 0 ? W / n : W;
  const dayLbl = (p: string) => {
    const [, m, d] = p.split('-');
    return `${Number(d)}/${Number(m)}`;
  };

  return (
    <div className="dayline">
      <div className="dayline-head">
        <span>máx {fmt(max)}</span>
        {prevPoints ? (
          <span className="dayline-legend">
            <span className="lg"><i className="sw cur" /> Actual {fmt(total)}</span>
            <span className="lg"><i className="sw prev" /> Anterior {fmt(prevTotal)}</span>
          </span>
        ) : (
          <span>Total {fmt(total)}</span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="dayline-svg" role="img" aria-label="Evolución diaria">
        {areaPath(points) && <path d={areaPath(points)} className="dayline-area" />}
        {prevPoints && prevPoints.length > 0 && (
          <path d={linePath(prevPoints)} className="dayline-line prev" fill="none" vectorEffect="non-scaling-stroke" />
        )}
        {points.length > 0 && <path d={linePath(points)} className="dayline-line" fill="none" vectorEffect="non-scaling-stroke" />}
        {points.map((p, i) => (
          <rect key={p.period} x={xOf(i, n) - bw / 2} y={0} width={bw} height={H} fill="transparent">
            <title>{`${dayLbl(p.period)}: ${fmt(value(p))}${prevPoints && prevPoints[i] ? ` · anterior ${fmt(value(prevPoints[i]))}` : ''}`}</title>
          </rect>
        ))}
      </svg>
      <div className="dayline-axis">
        <span>{n ? dayLbl(points[0].period) : ''}</span>
        <span>{n ? dayLbl(points[n - 1].period) : ''}</span>
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

type CSort = 'uses' | 'discount' | 'revenue' | 'avgOrder';

function SortTh({ k, sort, onSort, children }: { k: CSort; sort: CSort; onSort: (k: CSort) => void; children: ReactNode }) {
  return (
    <th className={`sortable${sort === k ? ' on' : ''}`} onClick={() => onSort(k)}>
      {children}
      {sort === k ? ' ▾' : ''}
    </th>
  );
}

/** Coupons dashboard: total discount given away, evolution by month, a sortable
 *  per-coupon ranking and a coupon×month usage matrix. */
function CouponStats({ orders, source, initialCoupon = '' }: { orders: Order[]; source: string; initialCoupon?: string }) {
  const [months, setMonths] = useState(6);
  const [cmetric, setCmetric] = useState<'discount' | 'uses'>('discount');
  const [sort, setSort] = useState<CSort>('uses');
  const [selected, setSelected] = useState(initialCoupon); // '' = all coupons
  const [find, setFind] = useState('');
  const data = useMemo(() => couponAnalytics(orders, months, source), [orders, months, source]);

  const monthsToggle = (
    <div className="seg-toggle sm">
      {[6, 12, 24].map((m) => (
        <button key={m} type="button" className={months === m ? 'on' : ''} onClick={() => setMonths(m)}>{m}m</button>
      ))}
    </div>
  );

  if (data.totals.uses === 0) {
    return (
      <section className="card">
        <div className="stats-card-head">
          <h2>Cupones de descuento</h2>
          {monthsToggle}
        </div>
        <p className="muted">No se ha usado ningún cupón en los últimos {months} meses{source !== 'all' ? ' para esta fuente' : ''}.</p>
      </section>
    );
  }

  // Coupon in focus for the chart + KPIs ('' = all coupons combined).
  const sel = selected ? data.rows.find((r) => r.code === selected) ?? null : null;
  const rowsAll: CouponRow[] = [...data.rows].sort((a, b) => b[sort] - a[sort]);
  // Table/matrix rows: the single selected one, else the search-filtered list.
  const rows: CouponRow[] = sel ? [sel] : find ? rowsAll.filter((r) => r.code.includes(find.toUpperCase())) : rowsAll;
  const monthLbl = (mk: string) => { const [, m] = mk.split('-').map(Number); return MONTHS[m - 1]; };
  // Chart series: the selected coupon's own months, else the overall series.
  const pts: SeriesPoint[] = sel
    ? data.months.map((mk) => ({ period: mk, revenue: sel.byMonth[mk]?.discount ?? 0, orders: sel.byMonth[mk]?.uses ?? 0 }))
    : data.monthly.map((p) => ({ period: p.period, revenue: p.discount, orders: p.uses }));
  const cval = (p: SeriesPoint) => (cmetric === 'discount' ? p.revenue : p.orders);
  const cfmt = (n: number) => (cmetric === 'discount' ? eur0(n) : int(n));
  const cmax = Math.max(1, ...pts.map(cval));
  const cellVal = (v?: { uses: number; discount: number }) => (v ? (cmetric === 'discount' ? v.discount : v.uses) : 0);
  const pct = data.totals.ordersTotal > 0 ? Math.round((data.totals.ordersWithCoupon / data.totals.ordersTotal) * 100) : 0;
  // KPI values: for the selected coupon, else the totals.
  const kUses = sel ? sel.uses : data.totals.ordersWithCoupon;
  const kDiscount = sel ? sel.discount : data.totals.discount;
  const kRevenue = sel ? sel.revenue : data.totals.revenue;
  const kAvg = sel ? sel.avgOrder : data.totals.ordersWithCoupon > 0 ? data.totals.revenue / data.totals.ordersWithCoupon : 0;

  return (
    <section className="card">
      <div className="stats-card-head">
        <h2>Cupones de descuento{sel ? ` · ${sel.code}` : ''}</h2>
        <div className="dayline-ctls">
          <div className="seg-toggle sm">
            <button type="button" className={cmetric === 'discount' ? 'on' : ''} onClick={() => setCmetric('discount')}>Descuento €</button>
            <button type="button" className={cmetric === 'uses' ? 'on' : ''} onClick={() => setCmetric('uses')}>Usos</button>
          </div>
          {monthsToggle}
        </div>
      </div>

      {/* Selector de cupón: sin selección = todos; con selección = solo ese. */}
      <div className="coupon-select-row">
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Todos los cupones</option>
          {data.rows.map((r) => (
            <option key={r.code} value={r.code}>{r.code}</option>
          ))}
        </select>
        {sel && <button type="button" className="chip" onClick={() => setSelected('')}>✕ Ver todos</button>}
      </div>

      <div className="stats-kpis">
        <Kpi label={sel ? 'Descuento (dejado de ganar)' : 'Descuento total (dejado de ganar)'} value={eur(kDiscount)} accent />
        <Kpi label="Pedidos con cupón" value={sel ? int(kUses) : `${int(kUses)} · ${pct}%`} />
        <Kpi label="Ingresos con cupón" value={eur(kRevenue)} />
        <Kpi label="Ticket medio con cupón" value={eur(kAvg)} />
      </div>

      <h3>Evolución · {cmetric === 'discount' ? 'descuento' : 'usos'} por mes {sel ? `· ${sel.code}` : '· todos'}</h3>
      <TrendChart points={pts} max={cmax} unit="month" value={cval} fmt={cfmt} />

      {!sel && data.rows.length > 1 && (
        <input
          className="coupon-search"
          type="search"
          placeholder="🔎 Buscar cupón por código…"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
      )}

      <h3>Por cupón</h3>
      <div className="coupon-stats-wrap">
        <table className="coupon-stats-table">
          <thead>
            <tr>
              <th>Código</th>
              <SortTh k="uses" sort={sort} onSort={setSort}>Usos</SortTh>
              <SortTh k="discount" sort={sort} onSort={setSort}>Descuento</SortTh>
              <SortTh k="revenue" sort={sort} onSort={setSort}>Ingresos</SortTh>
              <SortTh k="avgOrder" sort={sort} onSort={setSort}>Ticket medio</SortTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code}>
                <td><b>{r.code}</b></td>
                <td>{int(r.uses)}</td>
                <td>{eur(r.discount)}</td>
                <td>{eur(r.revenue)}</td>
                <td>{eur(r.avgOrder)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Uso por meses · {cmetric === 'discount' ? '€ descuento' : 'usos'}</h3>
      <div className="coupon-stats-wrap">
        <table className="coupon-stats-table coupon-matrix">
          <thead>
            <tr>
              <th>Cupón</th>
              {data.months.map((mk) => <th key={mk}>{monthLbl(mk)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code}>
                <td><b>{r.code}</b></td>
                {data.months.map((mk) => {
                  const n = cellVal(r.byMonth[mk]);
                  return <td key={mk} className={n ? 'has' : 'zero'}>{n ? cfmt(n) : '·'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
