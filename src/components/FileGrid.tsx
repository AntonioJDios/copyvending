import { useRef, useState } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { readFileInfo, renderPdfPage } from '../lib/pdf';
import { bindingExtraCost, documentCost } from '../domain/pricing';
import { FINISH_LABEL } from '../domain/catalog';
import { MAX_FILE_MB, uploadService, validateFile } from '../lib/uploads';
import { analyzeFile, preflightWarnings } from '../lib/analyzePdf';
import { suggestConfig } from '../lib/suggest';
import { hasBackend } from '../lib/api';
import type { Configuracion, DocFile } from '../domain/types';
import type { Catalog } from '../domain/catalog';
import { useConfigurator } from '../store/useConfigurator';
import { SpiralBinding } from './SpiralBinding';
import { PeekBehind, PeekFront } from './DocPeeks';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

const COLOR_LABEL: Record<DocFile['color'], string> = {
  no: 'B/N',
  cover: 'Portada color',
  all: 'Todo color',
};
const COLOR_CYCLE: DocFile['color'][] = ['no', 'cover', 'all'];

/** Extra price for the chosen ring/back-cover colours (per binding). */
function colorExtra(config: Configuracion, catalog: Catalog, colorAnillas: string, colorContraportada: string): number {
  if (config.acabado !== 'AnillasColores') return 0;
  const r = catalog.ringColors.find((c) => c.name === colorAnillas)?.extra ?? 0;
  const c = catalog.coverColors.find((c) => c.name === colorContraportada)?.extra ?? 0;
  return r + c;
}

function FileCard({ file, index = 0 }: { file: DocFile; index?: number }) {
  const { catalog, config, copias, colorAnillas, colorContraportada, files, removeFile, setFileColor } = useConfigurator();
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({ id: file.id });
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: file.id });

  // Per-document color add-ons only make sense on a B/N base (colour cover or
  // whole doc in colour); a full-colour job is already colour everywhere.
  const showColor = config.color === 'BN';
  const printCost = documentCost(file, config, catalog) * copias;

  // Colored ring binding + punched holes on the chosen edge.
  const ringHex = catalog.ringColors.find((c) => c.name === colorAnillas)?.hex ?? '#333';
  // Back-cover colour (peeks out behind the document when rings are selected).
  const coverHex = catalog.coverColors.find((c) => c.name === colorContraportada)?.hex;
  const long = config.ladoEncuadernacion === 'largo';

  // Black punch holes (for rings the hole is drawn inside each coil): a dense
  // row for perforado; 2 or 4 grouped holes for the filing punches.
  const holeCount =
    config.acabado === 'perforado'
      ? long
        ? 16
        : 12
      : config.acabado === 'dos_agujeros'
        ? 2
        : config.acabado === 'cuatro_agujeros'
          ? 4
          : 0;
  // Binding shows per-document when bound individually — or when there's a
  // single file (grouping is meaningless with one document). When grouped with
  // several files, the binding is drawn once on the combined block.
  const individual = config.juntos === 'individual' || files.length <= 1;
  // When bound individually (or single file), this document carries its own
  // finishing + per-binding surcharges; show them alongside the print price.
  const finishingCost = individual ? (bindingExtraCost(config, catalog) + colorExtra(config, catalog, colorAnillas, colorContraportada)) * copias : 0;
  const cost = printCost + finishingCost;
  const showHoles = holeCount > 0 && individual;
  const sparseHoles = config.acabado === 'dos_agujeros' || config.acabado === 'cuatro_agujeros';
  const showStaple = config.acabado === 'grapado' && individual;

  // Page-stack thickness, roughly proportional to the page count.
  const depth = Math.max(2, Math.min(13, Math.round(file.pages / 3) + 1));
  const stackShadow =
    Array.from({ length: depth }, (_, i) => `${i + 1}px ${i + 1}px 0 ${(i + 1) % 2 ? '#c9ced5' : '#ffffff'}`).join(', ') +
    ', 4px 7px 12px rgba(0,0,0,0.18)';

  // Flip-through: the blank sheets become extra "pages" so you can see each one.
  // Order: folios delante (blank) → páginas del PDF → folios detrás (blank). The
  // view starts on the first front folio, so it covers the cover by default, but
  // you can flip past it to reach the PDF.
  const nFront = individual ? config.foliosDelante : 0;
  const nBack = individual ? config.foliosDetras : 0;
  const isPdf = !!file.source && file.source.type === 'application/pdf';
  const total = nFront + file.pages + nBack;

  const [view, setView] = useState(1);
  const [thumb, setThumb] = useState(file.thumb);
  const [flipping, setFlipping] = useState(false);
  const cur = Math.min(view, total); // stay in range if folio counts change
  const pdfPage = cur > nFront && cur <= nFront + file.pages ? cur - nFront : null;
  const onFolio = pdfPage == null;
  const folioLabel = cur <= nFront ? 'blanco · delante' : 'blanco · detrás';
  const canFlip = total > 1;

  // The preview mirrors how the page will print: colour only when the job is
  // colour, the whole doc is marked colour, or it's the cover of a colour-cover doc.
  const pageInColor =
    config.color === 'Color' || file.color === 'all' || (file.color === 'cover' && pdfPage === 1);

  const goToView = async (target: number) => {
    const v = Math.max(1, Math.min(target, total));
    if (v === cur || flipping) return;
    const pg = v > nFront && v <= nFront + file.pages ? v - nFront : null;
    if (pg != null && pg !== 1 && file.source && isPdf) {
      setFlipping(true);
      try {
        setThumb(await renderPdfPage(file.source, pg));
        setView(v);
      } finally {
        setFlipping(false);
      }
    } else {
      if (pg === 1) setThumb(file.thumb); // PDF page 1 render is already the base thumb
      setView(v);
    }
  };
  const cycleColor = () => {
    const i = COLOR_CYCLE.indexOf(file.color);
    setFileColor(file.id, COLOR_CYCLE[(i + 1) % COLOR_CYCLE.length]);
  };

  return (
    <div
      ref={(n) => {
        dragRef(n);
        dropRef(n);
      }}
      className={`file-card${isOver ? ' drop' : ''}${isDragging ? ' dragging' : ''}`}
      style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
    >
      <div className="file-thumb" {...listeners} {...attributes}>
        <div className="doc-page">
          {individual && <PeekBehind acabado={config.acabado} coverHex={coverHex} foliosDetras={config.foliosDetras} depth={depth} />}
          <div className="doc-clip" style={{ boxShadow: stackShadow }}>
            {onFolio ? (
              <div className="doc-blank" aria-label="Hoja en blanco" />
            ) : thumb ? (
              <img
                src={thumb}
                alt={file.name}
                draggable={false}
                style={{ filter: pageInColor ? 'none' : 'grayscale(1)' }}
              />
            ) : (
              <div className="file-noimg" />
            )}
          </div>
          {showHoles && (
            <div className={`holes holes-${config.ladoEncuadernacion}${sparseHoles ? ' holes-sparse' : ''}`} aria-hidden>
              {Array.from({ length: holeCount }).map((_, i) => (
                <span key={i} className="hole" />
              ))}
            </div>
          )}
          {config.acabado === 'AnillasColores' && individual && (
            <SpiralBinding side={config.ladoEncuadernacion} color={ringHex} />
          )}
          {showStaple && <span className="staple" aria-hidden />}
          {file.uploadStatus === 'uploading' && (
            <div className="upload-overlay">
              <div className="upload-bar">
                <div className="upload-bar-fill" style={{ width: `${Math.round((file.uploadProgress ?? 0) * 100)}%` }} />
              </div>
              <span className="upload-pct">{Math.round((file.uploadProgress ?? 0) * 100)}%</span>
            </div>
          )}
          {file.uploadStatus === 'error' && (
            <div className="upload-overlay upload-overlay-error">⚠ {file.uploadError || 'Error al subir'}</div>
          )}
          {canFlip && (
            <div className="pageflip" onPointerDown={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => goToView(cur - 1)} disabled={cur <= 1 || flipping} aria-label="Anterior">
                ‹
              </button>
              <span>{onFolio ? folioLabel : `${pdfPage}/${file.pages}`}</span>
              <button type="button" onClick={() => goToView(cur + 1)} disabled={cur >= total || flipping} aria-label="Siguiente">
                ›
              </button>
            </div>
          )}
        </div>
        <span className="file-pages">{file.pages} pág.</span>
      </div>
      <div className="file-name" title={file.name}>
        {file.name}
      </div>
      <div className="file-meta">
        <span>{Math.ceil(file.pages / config.paginasPorHoja)} caras</span>
        {file.pages > 0 && (
          <span key={cost} className="file-price pop">
            {eur(cost)}
          </span>
        )}
      </div>
      {file.pages > 0 && finishingCost > 0 && (
        <div className="file-breakdown">
          <span>Impresión {eur(printCost)}</span>
          <span>
            + {config.acabado !== 'sinencuadernacion' ? FINISH_LABEL[config.acabado] : 'Sin márgenes'} {eur(finishingCost)}
          </span>
        </div>
      )}
      <div className="file-actions">
        {showColor && (
          <button type="button" className={`chip chip-color-${file.color}`} onClick={cycleColor}>
            {COLOR_LABEL[file.color]}
          </button>
        )}
        <button
          type="button"
          className="chip chip-danger"
          onClick={() => {
            if (file.storageKey) void uploadService.remove(file.storageKey);
            removeFile(file.id);
          }}
        >
          Quitar
        </button>
      </div>
    </div>
  );
}

/** When bound "all together", the whole set is one block: total thickness,
 *  the first document as the cover, and a single binding on it. */
function GroupedBinding() {
  const { catalog, config, colorAnillas, colorContraportada, files, copias } = useConfigurator();
  // With a single file, grouped == individual, so no separate block.
  if (config.juntos !== 'agrupados' || config.acabado === 'sinencuadernacion' || files.length < 2) return null;

  const totalPages = files.reduce((s, f) => s + f.pages, 0);
  const finishingCost = (bindingExtraCost(config, catalog) + colorExtra(config, catalog, colorAnillas, colorContraportada)) * copias;
  const cover = files.find((f) => f.thumb);
  const long = config.ladoEncuadernacion === 'largo';

  const depth = Math.max(4, Math.min(22, Math.round(totalPages / 3) + 2));
  const stackShadow =
    Array.from({ length: depth }, (_, i) => `${i + 1}px ${i + 1}px 0 ${(i + 1) % 2 ? '#c9ced5' : '#ffffff'}`).join(', ') +
    ', 5px 9px 16px rgba(0,0,0,0.22)';

  const ringHex = catalog.ringColors.find((c) => c.name === colorAnillas)?.hex ?? '#333';
  const coverHex = catalog.coverColors.find((c) => c.name === colorContraportada)?.hex;
  const holeCount =
    config.acabado === 'perforado' ? (long ? 16 : 12) : config.acabado === 'dos_agujeros' ? 2 : config.acabado === 'cuatro_agujeros' ? 4 : 0;
  const sparseHoles = config.acabado === 'dos_agujeros' || config.acabado === 'cuatro_agujeros';

  return (
    <div className="grouped">
      <div className="file-thumb grouped-thumb">
        <div className="doc-page">
          <PeekBehind acabado={config.acabado} coverHex={coverHex} foliosDetras={config.foliosDetras} depth={depth} />
          <div className="doc-clip" style={{ boxShadow: stackShadow }}>
            {cover?.thumb ? <img src={cover.thumb} alt="" draggable={false} /> : <div className="file-noimg" />}
          </div>
          <PeekFront foliosDelante={config.foliosDelante} />
          {holeCount > 0 && (
            <div className={`holes holes-${config.ladoEncuadernacion}${sparseHoles ? ' holes-sparse' : ''}`} aria-hidden>
              {Array.from({ length: holeCount }).map((_, i) => (
                <span key={i} className="hole" />
              ))}
            </div>
          )}
          {config.acabado === 'AnillasColores' && <SpiralBinding side={config.ladoEncuadernacion} color={ringHex} />}
          {config.acabado === 'grapado' && <span className="staple" aria-hidden />}
        </div>
      </div>
      <div className="grouped-info">
        <strong>Encuadernado todo junto</strong>
        <span>
          {files.length} documento{files.length !== 1 ? 's' : ''} · {totalPages} páginas en un solo bloque
        </span>
        {finishingCost > 0 && (
          <span className="grouped-price">
            {FINISH_LABEL[config.acabado]}
            {config.sinMargenes || config.foliosDelante + config.foliosDetras > 0 ? ' + suplementos' : ''}
            <strong> {eur(finishingCost)}</strong>
          </span>
        )}
      </div>
    </div>
  );
}

export function FileGrid() {
  const { files, addFiles, patchFile, reorder, proyectoId, setAnalyzing, setPreflight, setSuggestion } = useConfigurator();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Analyse the uploaded files in-browser (deterministic): pre-flight quality
  // checks + auto project name. If a backend is wired, also ask the assistant
  // for a configuration suggestion. Best-effort; never blocks the upload.
  const runAnalysis = async (fileList: File[]) => {
    if (fileList.length === 0) return;
    setAnalyzing(true);
    try {
      const analyses = await Promise.all(fileList.map((f) => analyzeFile(f)));
      setPreflight(preflightWarnings(analyses));
      // Auto project name from the first document's detected title, if unset.
      const st = useConfigurator.getState();
      if (!st.nombreProyecto.trim() && analyses[0]?.title) st.setNombreProyecto(analyses[0].title);
      if (hasBackend && st.catalog.assistant?.suggestEnabled !== false) {
        const s = await suggestConfig(analyses, st.catalog);
        if (s.changes && Object.keys(s.changes).length) setSuggestion(s);
      }
    } catch {
      /* analysis is a nicety — stay silent on failure */
    } finally {
      setAnalyzing(false);
    }
  };

  const ingest = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    // Validate up front; reject unsupported / oversized files with a message.
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(list)) {
      const err = validateFile(file);
      if (err) rejected.push(`${file.name}: ${err}`);
      else accepted.push(file);
    }
    setErrors(rejected);
    if (accepted.length === 0) {
      if (fileInput.current) fileInput.current.value = '';
      return;
    }

    setBusy(true);
    try {
      const started: { doc: DocFile; file: File }[] = [];
      for (const file of accepted) {
        let pages = 0;
        let thumb: string | undefined;
        try {
          const info = await readFileInfo(file);
          pages = info.pages;
          thumb = info.thumb;
        } catch {
          /* unreadable preview — still uploads, shown without thumbnail */
        }
        const doc: DocFile = {
          id: crypto.randomUUID(),
          name: file.name,
          pages,
          thumb,
          source: file,
          color: 'no',
          uploadStatus: 'uploading',
          uploadProgress: 0,
        };
        started.push({ doc, file });
      }
      addFiles(started.map((s) => s.doc));

      // Kick off the uploads (abstraction: R2 via /api/presign, or local).
      // projectId groups this project's files into one R2 folder.
      for (const { doc, file } of started) {
        uploadService
          .upload(file, { projectId: proyectoId, onProgress: (p) => patchFile(doc.id, { uploadProgress: p }) })
          .then(({ key }) => patchFile(doc.id, { uploadStatus: 'done', uploadProgress: 1, storageKey: key }))
          .catch((e: unknown) => patchFile(doc.id, { uploadStatus: 'error', uploadError: e instanceof Error ? e.message : 'Error' }));
      }

      // Analyse (pre-flight + name + suggestion) in the background.
      void runAnalysis(accepted);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) reorder(String(active.id), String(over.id));
  };

  return (
    <section className="filegrid">
      <div
        className={`dropzone${dragOver ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void ingest(e.dataTransfer.files);
        }}
        onClick={() => fileInput.current?.click()}
      >
        {busy ? (
          'Procesando…'
        ) : (
          <>
            <span className="dropzone-main">Toca para elegir tus archivos</span>
            <span className="dropzone-sub">PDF o imágenes · desde tu USB o dispositivo · hasta {MAX_FILE_MB} MB</span>
          </>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,image/*"
          multiple
          hidden
          onChange={(e) => ingest(e.target.files)}
        />
      </div>

      {errors.length > 0 && (
        <ul className="upload-errors">
          {errors.map((e, i) => (
            <li key={i}>⚠ {e}</li>
          ))}
        </ul>
      )}

      <GroupedBinding />

      {files.length > 1 && <p className="hint">Arrastra las tarjetas para reordenar los documentos.</p>}

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="cards">
          {files.map((f, i) => (
            <FileCard key={f.id} file={f} index={i} />
          ))}
        </div>
      </DndContext>
    </section>
  );
}
