import { useState } from 'react';
import { computePrice } from '../domain/pricing';
import { validate } from '../domain/rules';
import { useConfigurator } from '../store/useConfigurator';
import { useCart } from '../store/useCart';
import { flyToCart } from '../lib/flyToCart';
import { API_BASE } from '../lib/api';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

export function PriceBar() {
  const { catalog, config, files, copias, comentario, nombreProyecto, proyectoId, editingOrderId, setCopias, setComentario, clearProject } =
    useConfigurator();
  const colorAnillas = useConfigurator((s) => s.colorAnillas);
  const colorContraportada = useConfigurator((s) => s.colorContraportada);
  const addToCart = useCart((s) => s.add);
  const [saving, setSaving] = useState(false);
  const price = computePrice({ config, files, copias }, catalog);
  const warnings = validate(config, files, catalog);
  const hasFiles = files.length > 0;
  const uploading = files.some((f) => f.uploadStatus === 'uploading');
  const failed = files.some((f) => f.uploadStatus === 'error');
  const notReady = uploading || failed;

  const buildProject = () => ({
    id: proyectoId, // same id as the R2 folder jobs/<proyectoId>/…
    kind: 'copias' as const,
    nombre: nombreProyecto,
    config: { ...config },
    docs: files.map((f) => ({ id: f.id, name: f.name, pages: f.pages, thumb: f.thumb, color: f.color, storageKey: f.storageKey })),
    copias,
    comentario,
    colorAnillas,
    colorContraportada,
    total: price.total,
  });

  const onAddToCart = () => {
    if (!hasFiles || notReady) return;
    flyToCart();
    addToCart(buildProject());
    // Let the fly animation read the current thumbnails before we clear them.
    window.setTimeout(() => clearProject(), 750);
  };

  const onSaveEdit = async () => {
    if (!hasFiles || notReady || saving || !editingOrderId) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE ?? ''}/orders?id=${encodeURIComponent(editingOrderId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [buildProject()] }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      alert(`Pedido ${editingOrderId} actualizado.`);
      clearProject();
      window.location.hash = 'recoger';
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo actualizar el pedido.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <footer className="pricebar">
      {editingOrderId && (
        <div className="editing-banner">
          ✏️ Estás modificando el pedido <b>{editingOrderId}</b>
          <button type="button" className="chip" onClick={() => clearProject()}>
            Cancelar
          </button>
        </div>
      )}
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

        {editingOrderId ? (
          <button type="button" className="btn btn-primary" disabled={!hasFiles || notReady || saving} onClick={onSaveEdit}>
            {saving ? 'Guardando…' : uploading ? 'Subiendo…' : failed ? 'Hay un archivo con error' : 'Guardar cambios'}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!hasFiles || notReady} onClick={onAddToCart}>
            {uploading ? 'Subiendo…' : failed ? 'Hay un archivo con error' : 'Añadir proyecto al carrito'}
          </button>
        )}
      </div>
    </footer>
  );
}
