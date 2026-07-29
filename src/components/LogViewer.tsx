import { useCallback, useEffect, useState } from 'react';
import { clearEvents, fetchEvents, type LogEvent, type LogLevel } from '../lib/statsApi';

/**
 * The shop's event log.
 *
 * Until now everything went to console.error, which on this hosting plan means it
 * survives about an hour and is only visible to whoever opens the Vercel
 * dashboard — not to the copistería. That is how the orphan-file sweep managed to
 * fail all afternoon without anyone noticing, and why three separate 500s could
 * only be diagnosed by reading the deploy logs.
 *
 * So this screen is aimed at the shop, not at me: plain sentences, and the
 * technical detail folded away for when I do need it.
 */

const LEVELS: { id: LogLevel | ''; label: string }[] = [
  { id: '', label: 'Todo' },
  { id: 'error', label: 'Errores' },
  { id: 'warn', label: 'Avisos' },
  { id: 'info', label: 'Actividad' },
];

const ICON: Record<LogLevel, string> = { error: '⛔', warn: '⚠️', info: '·' };

/** "hoy 18:42" / "ayer 09:10" / "12 jul 18:42" — reading a log is scanning it. */
function when(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  const day = (x: Date) => x.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' });
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (day(d) === day(today)) return `hoy ${time}`;
  if (day(d) === day(yesterday)) return `ayer ${time}`;
  return `${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' })} ${time}`;
}

function Row({ e }: { e: LogEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`log-row log-${e.level}`}>
      <div className="log-head">
        <span className="log-icon" aria-hidden>
          {ICON[e.level]}
        </span>
        <span className="log-when">{when(e.at)}</span>
        <span className="log-source">{e.source}</span>
        <span className="log-msg">{e.message}</span>
        {e.orderId && (
          <a className="log-order" href={`#pedidos?q=${encodeURIComponent(e.orderId)}`}>
            {e.orderId}
          </a>
        )}
        {e.detail && (
          <button type="button" className="btn btn-sm log-more" onClick={() => setOpen(!open)}>
            {open ? 'Ocultar' : 'Detalle'}
          </button>
        )}
      </div>
      {/* Never dangerouslySetInnerHTML: this text comes from error messages and
          from anything a customer managed to send us. */}
      {open && e.detail && <pre className="log-detail">{e.detail}</pre>}
    </li>
  );
}

export function LogViewer() {
  const [level, setLevel] = useState<LogLevel | ''>('');
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [counts, setCounts] = useState<Record<LogLevel, number>>({ error: 0, warn: 0, info: 0 });
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (lv: LogLevel | '') => {
    setBusy(true);
    setError('');
    try {
      const page = await fetchEvents(lv);
      setEvents(page.events);
      setCounts(page.counts);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(level);
  }, [load, level]);

  const more = async () => {
    if (!cursor) return;
    setBusy(true);
    try {
      const page = await fetchEvents(level, cursor);
      setEvents((prev) => [...prev, ...page.events]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const empty = async () => {
    if (!window.confirm('¿Vaciar el registro? Se borran los avisos, no los pedidos.')) return;
    try {
      await clearEvents();
      await load(level);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="admin-block">
      <h2>Registro</h2>
      <p className="muted">
        Lo que le ha pasado a la tienda: correos que no salieron, cobros con problemas y limpiezas de archivos. Si algo
        falla, aparece aquí — y si es un error, también te llega un correo.
      </p>

      <div className="log-toolbar">
        <nav className="filter-tabs">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`filter-tab${level === l.id ? ' filter-on' : ''}`}
              onClick={() => setLevel(l.id)}
            >
              {l.label}
              {l.id !== '' && counts[l.id] > 0 && <span className="filter-count">{counts[l.id]}</span>}
            </button>
          ))}
        </nav>
        <div className="log-actions">
          <button type="button" className="btn btn-sm" onClick={() => void load(level)} disabled={busy}>
            ↻ Actualizar
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void empty()}>
            Vaciar
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      {events.length === 0 && !busy && !error ? (
        <p className="muted">
          {level === 'error'
            ? 'Ningún error registrado. '
            : level === '' && counts.error === 0 && counts.warn === 0
              ? 'Todo tranquilo: no hay nada registrado. '
              : 'Nada en este apartado. '}
          Es la buena noticia.
        </p>
      ) : (
        <ul className="log-list">
          {events.map((e) => (
            <Row key={e.id} e={e} />
          ))}
        </ul>
      )}

      {cursor && (
        <button type="button" className="btn" onClick={() => void more()} disabled={busy}>
          {busy ? 'Cargando…' : 'Ver más'}
        </button>
      )}
    </section>
  );
}
