import { computePrice } from '../domain/pricing';
import { validate } from '../domain/rules';
import { useConfigurator } from '../store/useConfigurator';
import { useCart } from '../store/useCart';
import { flyToCart } from '../lib/flyToCart';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

export function PriceBar() {
  const { catalog, config, files, copias, comentario, nombreProyecto, setCopias, setComentario, clearProject } =
    useConfigurator();
  const colorAnillas = useConfigurator((s) => s.colorAnillas);
  const colorContraportada = useConfigurator((s) => s.colorContraportada);
  const addToCart = useCart((s) => s.add);
  const price = computePrice({ config, files, copias }, catalog);
  const warnings = validate(config, files, catalog);
  const hasFiles = files.length > 0;
  const uploading = files.some((f) => f.uploadStatus === 'uploading');
  const failed = files.some((f) => f.uploadStatus === 'error');
  const notReady = uploading || failed;

  const onAddToCart = () => {
    if (!hasFiles || notReady) return;
    flyToCart();
    addToCart({
      id: crypto.randomUUID(),
      kind: 'copias',
      nombre: nombreProyecto,
      config: { ...config },
      docs: files.map((f) => ({ id: f.id, name: f.name, pages: f.pages, thumb: f.thumb, color: f.color, storageKey: f.storageKey })),
      copias,
      comentario,
      colorAnillas,
      colorContraportada,
      total: price.total,
    });
    // Let the fly animation read the current thumbnails before we clear them.
    window.setTimeout(() => clearProject(), 750);
  };

  return (
    <footer className="pricebar">
      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w) => (
            <li key={w.code}>⚠ {w.message}</li>
          ))}
        </ul>
      )}

      <div className="pricebar-row">
        <label className="field">
          Copias
          <input
            type="number"
            min={1}
            value={copias}
            onChange={(e) => setCopias(Number(e.target.value))}
          />
        </label>

        <label className="field field-grow">
          Comentario
          <input
            type="text"
            placeholder="Instrucciones para la copistería (opcional)"
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
          />
        </label>

        <div className="summary">
          {hasFiles ? (
            <>
              <span className="summary-meta">
                {price.totalPrintedSides} caras · {price.totalSheets} folios
                {price.bindings > 0 ? ` · ${price.bindings} encuad.` : ''}
              </span>
              <span key={price.total} className="summary-total pop">
                {eur(price.total)}
              </span>
            </>
          ) : (
            <span className="summary-meta">Sube documentos para ver el precio</span>
          )}
        </div>

        <button type="button" className="btn btn-primary" disabled={!hasFiles || notReady} onClick={onAddToCart}>
          {uploading ? 'Subiendo…' : failed ? 'Hay un archivo con error' : 'Añadir proyecto al carrito'}
        </button>
      </div>
    </footer>
  );
}
