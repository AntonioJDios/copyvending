import { useEffect, useMemo, useRef, useState } from 'react';
import { useConfigurator } from '../store/useConfigurator';
import { askAssistant, type ChatMsg } from '../lib/assistant';
import { computePrice } from '../domain/pricing';
import { normalize } from '../domain/rules';
import type { Configuracion } from '../domain/types';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

const CONFIG_FIELDS = new Set<keyof Configuracion>([
  'size', 'color', 'grosor', 'dobleCara', 'orientacion', 'paginasPorHoja',
  'acabado', 'acabadoFolios', 'juntos', 'sinMargenes', 'ladoEncuadernacion',
  'foliosDelante', 'foliosDetras',
]);

const SUGGESTIONS = ['¿Cuánto cuesta?', 'A4 a doble cara', 'Encuadernar en anillas', '¿Qué es el gramaje?'];

/**
 * Customer-facing assistant: answers questions (incl. price) and sets the print
 * configuration from a plain-language request. It only proposes catalog values;
 * the store's normalize/rules re-validate everything, and the price shown is
 * always computed by the domain (never by the model).
 */
export function AssistantChat() {
  const { catalog, config, copias, files, setField, setCopias, setColorAnillas, setColorContraportada } = useConfigurator();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const currentPrice = useMemo(() => computePrice({ config, files, copias }, catalog), [config, files, copias, catalog]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open, busy]);

  const applyChanges = (changes: Record<string, unknown>) => {
    const set = setField as unknown as (k: string, v: unknown) => void;
    for (const [k, v] of Object.entries(changes)) {
      if (k === 'copias') setCopias(Number(v));
      else if (k === 'colorAnillas') setColorAnillas(String(v));
      else if (k === 'colorContraportada') setColorContraportada(String(v));
      else set(k as keyof Configuracion, v);
    }
  };

  // Exact total for the config that results from applying `changes` (so we can
  // state the real number after "ponlo en A4 color", not an LLM guess).
  const projectedTotal = (changes: Record<string, unknown>): number => {
    const patch: Partial<Configuracion> = {};
    for (const k of Object.keys(changes)) {
      if (CONFIG_FIELDS.has(k as keyof Configuracion)) (patch as Record<string, unknown>)[k] = changes[k];
    }
    const cfg = normalize({ ...config, ...patch }, catalog);
    const nCopias = 'copias' in changes ? Math.max(1, Math.floor(Number(changes.copias)) || 1) : copias;
    return computePrice({ config: cfg, files, copias: nCopias }, catalog).total;
  };

  const send = async (preset?: string) => {
    const text = (preset ?? input).trim();
    if (!text || busy) return;
    const next: ChatMsg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const { reply, changes } = await askAssistant(next, config, copias, catalog, {
        total: currentPrice.total,
        sheets: currentPrice.totalSheets,
        hasFiles: files.length > 0,
        pages: files.reduce((s, f) => s + f.pages, 0),
      });
      let text2 = reply;
      if (changes && Object.keys(changes).length) {
        if (files.length > 0) text2 += `\n\n💶 Total: ${eur(projectedTotal(changes))}`;
        applyChanges(changes);
      }
      setMessages((m) => [...m, { role: 'assistant', content: text2 }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠ ${e instanceof Error ? e.message : 'Error'}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className={`assistant-fab${open ? ' open' : ''}`} onClick={() => setOpen((o) => !o)} aria-label="Asistente">
        {open ? '×' : '💬'}
      </button>
      {open && (
        <section className="assistant-panel" role="dialog" aria-label="Asistente de la copistería">
          <header className="assistant-head">
            <div>
              <strong>Asistente</strong>
              <span className="assistant-sub">pregúntame o dime cómo lo quieres</span>
            </div>
            <button type="button" className="assistant-x" onClick={() => setOpen(false)} aria-label="Cerrar">
              ×
            </button>
          </header>
          <div className="assistant-msgs" ref={listRef}>
            {messages.length === 0 && (
              <div className="assistant-hello">
                <p>¡Hola! 👋 Dime qué necesitas y te lo dejo configurado.</p>
                <p className="muted">Ej.: “mi TFM en anillas, doble cara y portada en color”. También respondo precios y dudas (gramaje, acabados…).</p>
                <div className="assistant-chips">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className="assistant-chip" onClick={() => void send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`assistant-msg ${m.role}`}>
                {m.content}
              </div>
            ))}
            {busy && <div className="assistant-msg assistant assistant-typing">···</div>}
          </div>
          <div className="assistant-input">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send();
              }}
              placeholder="Escribe qué quieres imprimir…"
              disabled={busy}
              autoFocus
            />
            <button type="button" onClick={() => void send()} disabled={busy || !input.trim()}>
              Enviar
            </button>
          </div>
        </section>
      )}
    </>
  );
}
