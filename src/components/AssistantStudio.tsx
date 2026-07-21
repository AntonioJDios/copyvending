import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_FILE_MB, uploadService, validateFile } from '../lib/uploads';
import { readFileInfo } from '../lib/pdf';
import { analyzeFile, type FileAnalysis } from '../lib/analyzePdf';
import { planProjects, type PlanMsg, type PlanProject } from '../lib/plan';
import { computePrice } from '../domain/pricing';
import { normalize } from '../domain/rules';
import { FINISH_LABEL, FOLIO_LABEL, SIZE_LABEL } from '../domain/catalog';
import type { Configuracion } from '../domain/types';
import { DEFAULT_CONFIG, useConfigurator } from '../store/useConfigurator';
import { useCart } from '../store/useCart';
import { CartButton } from './CartButton';
import { MicButton } from './MicButton';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

/** Full, human spec of a proposed project so the customer can verify it. */
function specOf(config: Configuracion, p: PlanProject): string {
  const parts: string[] = [
    SIZE_LABEL[config.size],
    `${config.grosor} g`,
    config.color === 'BN' ? 'B/N' : 'Color',
    config.dobleCara === '1' ? 'doble cara' : 'una cara',
  ];
  if (config.paginasPorHoja > 1) parts.push(`${config.paginasPorHoja} pág/cara`);
  if (config.acabado !== 'sinencuadernacion') parts.push(FINISH_LABEL[config.acabado]);
  if (config.acabado === 'AnillasColores' && p.colorAnillas) parts.push(`anillas ${p.colorAnillas}`);
  if (config.acabado === 'AnillasColores' && p.colorContraportada) parts.push(`contra. ${p.colorContraportada}`);
  if (config.acabadoFolios !== 'normal') parts.push(FOLIO_LABEL[config.acabadoFolios]);
  if (config.sinMargenes) parts.push('sin márgenes');
  if (p.docColor === 'cover') parts.push('portada en color');
  if (p.copias > 1) parts.push(`×${p.copias} copias`);
  return parts.join(' · ');
}

interface StudioFile {
  id: string;
  name: string;
  pages: number;
  thumb?: string;
  storageKey?: string;
  status: 'uploading' | 'done' | 'error';
  analysis?: FileAnalysis;
}

/** Conversational studio: drop files, tell the assistant how you want each, and
 *  it builds a multi-project order straight into the cart. */
export function AssistantStudio() {
  const catalog = useConfigurator((s) => s.catalog);
  const addToCart = useCart((s) => s.add);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [files, setFiles] = useState<StudioFile[]>([]);
  const [messages, setMessages] = useState<PlanMsg[]>([]);
  const [plan, setPlan] = useState<PlanProject[] | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const planned = useRef(false);

  const patch = (id: string, p: Partial<StudioFile>) => setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const readyFiles = useMemo(() => files.filter((f) => f.status === 'done' && f.analysis), [files]);
  const allSettled = files.length > 0 && files.every((f) => f.status !== 'uploading');

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  const ingest = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const f of Array.from(list)) {
      const e = validateFile(f);
      if (e) rejected.push(`${f.name}: ${e}`);
      else accepted.push(f);
    }
    setErrors(rejected);
    if (fileInput.current) fileInput.current.value = '';
    if (accepted.length === 0) return;
    planned.current = false; // new files → re-plan
    setPlan(null);
    for (const file of accepted) {
      const id = crypto.randomUUID();
      setFiles((fs) => [...fs, { id, name: file.name, pages: 0, status: 'uploading' }]);
      void (async () => {
        try {
          const info = await readFileInfo(file).catch(() => ({ pages: 0, thumb: undefined as string | undefined }));
          const analysis = await analyzeFile(file);
          const { key } = await uploadService.upload(file, { projectId: sessionId });
          patch(id, { pages: analysis.pages || info.pages, thumb: info.thumb, storageKey: key, status: 'done', analysis });
        } catch {
          patch(id, { status: 'error' });
        }
      })();
    }
  };

  const runPlan = async (message: string) => {
    const analyses = readyFiles.map((f) => f.analysis!).filter(Boolean);
    if (analyses.length === 0 || busy) return;
    setBusy(true);
    const next: PlanMsg[] = message ? [...messages, { role: 'user', content: message }] : messages;
    if (message) setMessages(next);
    try {
      const { reply, projects } = await planProjects(analyses, next, message || 'Configúralos como creas mejor.');
      setPlan(projects);
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠ ${e instanceof Error ? e.message : 'Error'}` }]);
    } finally {
      setBusy(false);
    }
  };

  // First proposal automatically once the dropped files are analysed.
  useEffect(() => {
    if (!planned.current && allSettled && readyFiles.length > 0 && !busy) {
      planned.current = true;
      void runPlan('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSettled, readyFiles.length]);

  const send = () => {
    const t = input.trim();
    if (!t || busy) return;
    setInput('');
    void runPlan(t);
  };

  // Turn the plan into priced project cards (docs resolved to uploaded files).
  const projectCards = useMemo(() => {
    return (plan || [])
      .map((p) => {
        const docs = p.files.map((name) => readyFiles.find((f) => f.name === name)).filter((f): f is StudioFile => !!f);
        const config = normalize({ ...DEFAULT_CONFIG, ...p.changes }, catalog);
        const priceFiles = docs.map((d) => ({ pages: d.pages, color: p.docColor }));
        const total = computePrice({ config, files: priceFiles, copias: p.copias, colorAnillas: p.colorAnillas, colorContraportada: p.colorContraportada }, catalog).total;
        return { p, docs, config, total };
      })
      .filter((pc) => pc.docs.length > 0);
  }, [plan, readyFiles, catalog]);

  const grandTotal = projectCards.reduce((s, pc) => s + pc.total, 0);

  const addAll = () => {
    for (const pc of projectCards) {
      addToCart({
        id: crypto.randomUUID(),
        kind: 'copias',
        nombre: pc.p.nombre || pc.docs[0].name,
        config: pc.config,
        docs: pc.docs.map((d) => ({ id: d.id, name: d.name, pages: d.pages, thumb: d.thumb, color: pc.p.docColor, storageKey: d.storageKey })),
        copias: pc.p.copias,
        comentario: '',
        colorAnillas: pc.p.colorAnillas ?? '',
        colorContraportada: pc.p.colorContraportada ?? '',
        total: pc.total,
      });
    }
    window.location.hash = 'carrito';
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>Asistente</h1>
        <nav className="topnav">
          <a className="btn" href="#">← Volver</a>
          <CartButton onClick={() => (window.location.hash = 'carrito')} />
        </nav>
      </header>

      <div className="studio">
        {/* Files pane */}
        <section className="studio-files">
          <div
            className={`dropzone${dragOver ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); void ingest(e.dataTransfer.files); }}
            onClick={() => fileInput.current?.click()}
          >
            <span className="dropzone-main">Suelta aquí tus archivos</span>
            <span className="dropzone-sub">PDF o imágenes · varios a la vez · hasta {MAX_FILE_MB} MB</span>
            <input ref={fileInput} type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => ingest(e.target.files)} />
          </div>

          {errors.length > 0 && (
            <ul className="upload-errors">{errors.map((e, i) => <li key={i}>⚠ {e}</li>)}</ul>
          )}

          <div className="studio-thumbs">
            {files.map((f) => (
              <div key={f.id} className={`studio-thumb status-${f.status}`}>
                {f.thumb ? <img src={f.thumb} alt="" /> : <div className="studio-noimg" />}
                <span className="studio-thumb-name" title={f.name}>{f.name}</span>
                <span className="studio-thumb-meta">
                  {f.status === 'uploading' ? 'Subiendo…' : f.status === 'error' ? '⚠ error' : `${f.pages} pág.`}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Chat + plan pane */}
        <section className="studio-chat">
          <div className="studio-msgs" ref={listRef}>
            {files.length === 0 && (
              <div className="assistant-hello">
                <p>Suelta tus archivos a la izquierda y te propongo cómo imprimir cada uno. 👈</p>
                <p className="muted">Luego dime cosas como: “el informe a color con anillas; los apuntes en B/N a doble cara”.</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`assistant-msg ${m.role}`}>{m.content}</div>
            ))}
            {busy && <div className="assistant-msg assistant assistant-typing">···</div>}

            {/* Proposed projects */}
            {projectCards.length > 0 && (
              <div className="studio-plan">
                <div className="studio-plan-head">Propuesta · {projectCards.length} proyecto{projectCards.length !== 1 ? 's' : ''}</div>
                {projectCards.map((pc, i) => (
                  <div key={i} className="studio-project">
                    <div className="studio-project-top">
                      <strong>{pc.p.nombre || pc.docs[0].name}</strong>
                      <span>{eur(pc.total)}</span>
                    </div>
                    <div className="studio-project-meta">{specOf(pc.config, pc.p)}</div>
                    <div className="studio-project-files">{pc.docs.map((d) => d.name).join(', ')}</div>
                  </div>
                ))}
                <button type="button" className="btn btn-primary studio-add" onClick={addAll}>
                  Añadir al carrito · {eur(grandTotal)}
                </button>
              </div>
            )}
          </div>

          <div className="assistant-input">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
              placeholder={readyFiles.length ? 'Dime o dicta cómo quieres cada archivo…' : 'Sube archivos primero…'}
              disabled={busy || readyFiles.length === 0}
            />
            <MicButton
              disabled={busy || readyFiles.length === 0}
              onText={(t) => setInput((v) => (v.trim() ? `${v.trim()} ${t}` : t))}
            />
            <button type="button" onClick={send} disabled={busy || !input.trim()}>Enviar</button>
          </div>
        </section>
      </div>
    </div>
  );
}
