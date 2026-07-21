import { FINISH_LABEL, SIZE_LABEL } from '../domain/catalog';
import type { Configuracion } from '../domain/types';
import { useCart, type CartDoc, type CartProject, type CopiasProject } from '../store/useCart';
import { useConfigurator } from '../store/useConfigurator';
import { deleteProjectFiles } from '../lib/projectFiles';
import { SpiralBinding } from './SpiralBinding';
import { PeekBehind, PeekFront } from './DocPeeks';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

/** Short, human summary of the print options (kept faithful to the labels). */
export function summarize(p: CopiasProject): string {
  const c = p.config;
  const bits = [
    SIZE_LABEL[c.size].replace(/\s*\(.*\)/, ''),
    c.color === 'BN' ? 'B/N' : 'Color',
    c.dobleCara === '1' ? '2 caras' : '1 cara',
    `${c.grosor} gr`,
  ];
  if (c.acabado !== 'sinencuadernacion') bits.push(FINISH_LABEL[c.acabado]);
  if (c.acabado === 'AnillasColores') bits.push(`anillas ${p.colorAnillas.toLowerCase()}`);
  if (p.copias > 1) bits.push(`×${p.copias} copias`);
  return bits.join(' · ');
}

/** A single drawn document (page stack + optional binding), scaled for the cart. */
function MiniDoc({
  doc,
  config,
  ringHex,
  coverHex,
  showBinding,
  pages,
  grouped = false,
}: {
  doc?: CartDoc;
  config: Configuracion;
  ringHex: string;
  coverHex?: string;
  showBinding: boolean;
  pages: number;
  grouped?: boolean;
}) {
  const long = config.ladoEncuadernacion === 'largo';
  const pageInColor = config.color === 'Color' || doc?.color === 'all' || doc?.color === 'cover';

  const holeCount = !showBinding
    ? 0
    : config.acabado === 'perforado'
      ? long
        ? 16
        : 12
      : config.acabado === 'dos_agujeros'
        ? 2
        : config.acabado === 'cuatro_agujeros'
          ? 4
          : 0;
  const sparseHoles = config.acabado === 'dos_agujeros' || config.acabado === 'cuatro_agujeros';

  const depth = grouped
    ? Math.max(4, Math.min(20, Math.round(pages / 4) + 2))
    : Math.max(2, Math.min(11, Math.round(pages / 4) + 1));
  const stackShadow =
    Array.from({ length: depth }, (_, i) => `${i + 1}px ${i + 1}px 0 ${(i + 1) % 2 ? '#c9ced5' : '#ffffff'}`).join(', ') +
    ', 3px 5px 9px rgba(0,0,0,0.18)';

  return (
    <div className="cart-doc">
      <div className="doc-page">
        {showBinding && <PeekBehind acabado={config.acabado} coverHex={coverHex} foliosDetras={config.foliosDetras} depth={depth} />}
        <div className="doc-clip" style={{ boxShadow: stackShadow }}>
          {doc?.thumb ? (
            <img src={doc.thumb} alt="" draggable={false} style={{ filter: pageInColor ? 'none' : 'grayscale(1)' }} />
          ) : (
            <div className="file-noimg" />
          )}
        </div>
        {showBinding && <PeekFront foliosDelante={config.foliosDelante} />}
        {holeCount > 0 && (
          <div className={`holes holes-${config.ladoEncuadernacion}${sparseHoles ? ' holes-sparse' : ''}`} aria-hidden>
            {Array.from({ length: holeCount }).map((_, i) => (
              <span key={i} className="hole" />
            ))}
          </div>
        )}
        {showBinding && config.acabado === 'AnillasColores' && <SpiralBinding side={config.ladoEncuadernacion} color={ringHex} />}
        {showBinding && config.acabado === 'grapado' && <span className="staple" aria-hidden />}
      </div>
    </div>
  );
}

/** The drawn stack of a project's documents (shared by the drawer and page). */
export function CartDocsPreview({ project }: { project: CopiasProject }) {
  const catalog = useConfigurator((s) => s.catalog);
  const ringHex = catalog.ringColors.find((c) => c.name === project.colorAnillas)?.hex ?? '#333';
  const coverHex = catalog.coverColors.find((c) => c.name === project.colorContraportada)?.hex;

  const { config, docs } = project;
  const totalPages = docs.reduce((s, d) => s + d.pages, 0);
  const bound = config.acabado !== 'sinencuadernacion';
  const combined = bound && config.juntos === 'agrupados' && docs.length >= 2;
  const stacked = !combined && docs.length > 1;
  const MAX_VISIBLE = 3;

  return (
    <div className={`cart-docs${stacked ? ' stacked' : ''}`}>
      {combined ? (
        <MiniDoc doc={docs.find((d) => d.thumb) ?? docs[0]} config={config} ringHex={ringHex} coverHex={coverHex} showBinding pages={totalPages} grouped />
      ) : (
        docs.slice(0, MAX_VISIBLE).map((d, i) => (
          <div
            key={d.id}
            className="cart-doc-slot"
            style={stacked ? { marginLeft: i ? -42 : 0, marginTop: i * 9, zIndex: i } : undefined}
          >
            <MiniDoc doc={d} config={config} ringHex={ringHex} coverHex={coverHex} showBinding={bound} pages={d.pages} />
          </div>
        ))
      )}
      {!combined && docs.length > MAX_VISIBLE && <span className="cart-more">+{docs.length - MAX_VISIBLE}</span>}
    </div>
  );
}

/** One cart card — dispatches on the product kind. */
export function CartProjectCard({ project, onEditDone }: { project: CartProject; onEditDone: () => void }) {
  if (project.kind === 'copias') return <CopiasCard project={project} onEditDone={onEditDone} />;
  return <ProductCard project={project} />;
}

/** A personalised mug/badge card: photo preview + options + remove. */
function ProductCard({ project }: { project: Exclude<CartProject, CopiasProject> }) {
  const remove = useCart((s) => s.remove);
  const isChapa = project.kind === 'chapa';
  const fallback = isChapa ? 'Chapa personalizada' : 'Taza personalizada';
  const summary = isChapa
    ? `Ø ${project.sizeMm} mm · ${project.back}`
    : 'Taza sublimación 24 × 9,5 cm';

  return (
    <div className="cart-item">
      <div className={`cart-product-preview${isChapa ? ' round' : ''}`}>
        <img src={project.preview} alt="" />
      </div>
      <div className="cart-item-info">
        <strong className="cart-item-name">{project.nombre.trim() || fallback}</strong>
        <span className="cart-item-summary">{summary}</span>
        <span className="cart-item-docs">
          {project.cantidad} unidad{project.cantidad !== 1 ? 'es' : ''}
        </span>
        <div className="cart-item-foot">
          <span className="cart-item-price">{eur(project.total)}</span>
          <div className="cart-item-btns">
            <button
              type="button"
              className="chip chip-danger"
              onClick={() => {
                void deleteProjectFiles(project);
                remove(project.id);
              }}
            >
              Quitar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A copy-shop print project card: drawn documents + summary + edit/remove. */
function CopiasCard({ project, onEditDone }: { project: CopiasProject; onEditDone: () => void }) {
  const loadProject = useConfigurator((s) => s.loadProject);
  const remove = useCart((s) => s.remove);

  const { config, docs } = project;
  const totalPages = docs.reduce((s, d) => s + d.pages, 0);
  const bound = config.acabado !== 'sinencuadernacion';
  const combined = bound && config.juntos === 'agrupados' && docs.length >= 2;

  const onEdit = () => {
    loadProject(project);
    remove(project.id);
    onEditDone();
  };

  return (
    <div className="cart-item">
      <CartDocsPreview project={project} />

      <div className="cart-item-info">
        <strong className="cart-item-name">{project.nombre.trim() || 'Proyecto sin título'}</strong>
        <span className="cart-item-summary">{summarize(project)}</span>
        <span className="cart-item-docs">
          {docs.length} documento{docs.length !== 1 ? 's' : ''} · {totalPages} pág.
          {combined ? ' · encuadernado junto' : bound ? ' · por separado' : ''}
        </span>
        {project.comentario.trim() && <span className="cart-item-note">“{project.comentario.trim()}”</span>}
        <div className="cart-item-foot">
          <span className="cart-item-price">{eur(project.total)}</span>
          <div className="cart-item-btns">
            <button type="button" className="chip" onClick={onEdit}>
              Editar
            </button>
            <button
              type="button"
              className="chip chip-danger"
              onClick={() => {
                void deleteProjectFiles(project);
                remove(project.id);
              }}
            >
              Quitar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
