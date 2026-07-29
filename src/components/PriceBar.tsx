import { useState } from 'react';
import { computePrice } from '../domain/pricing';
import { validate } from '../domain/rules';
import { useConfigurator } from '../store/useConfigurator';
import { useCart } from '../store/useCart';
import { flyToCart } from '../lib/flyToCart';
import { API_BASE } from '../lib/api';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

export function PriceBar() {
  const { catalog, config, files, copias, comentario, nombreProyecto, proyectoId, proyectoToken, editingOrderId, editingOrderEmail, setCopias, setComentario, clearProject } =
    useConfigurator();
  const colorAnillas = useConfigurator((s) => s.colorAnillas);
  const colorContraportada = useConfigurator((s) => s.colorContraportada);
  const addToCart = useCart((s) => s.add);
  const [saving, setSaving] = useState(false);
  const catalogLoaded = useConfigurator((s) => s.catalogLoaded);
  const catalogError = useConfigurator((s) => s.catalogError);
  const price = computePrice({ config, files, copias, colorAnillas, colorContraportada }, catalog);
  const warnings = validate(config, files, catalog);
  const hasFiles = files.length > 0;
  const uploading = files.some((f) => f.uploadStatus === 'uploading');
  const failed = files.some((f) => f.uploadStatus === 'error');
  // Without a priced catalog there is no total to show and nothing may be
  // ordered — prices come from the DB, never from a default baked into the app.
  const notReady = uploading || failed || !catalogLoaded;

  const buildProjectFrom = (fileList: typeof files, id: string, nombre: string) => ({
    id,
    kind: 'copias' as const,
    nombre,
    // Travels with the project so its files stay readable/deletable later.
    storageToken: proyectoToken,
    config: { ...config },
    // Only the KEY travels with the order; the inline data URL is kept only
    // when the upload didn't happen (local mode or a failed upload).
    docs: fileList.map((f) => ({
      id: f.id,
      name: f.name,
      pages: f.pages,
      thumbKey: f.thumbKey,
      thumb: f.thumbKey ? undefined : f.thumb,
      color: f.color,
      storageKey: f.storageKey,
    })),
    copias,
    comentario,
    colorAnillas,
    colorContraportada,
    total: computePrice({ config, files: fileList.map((f) => ({ pages: f.pages, color: f.color })), copias, colorAnillas, colorContraportada }, catalog).total,
  });

  const buildProject = () => buildProjectFrom(files, proyectoId, nombreProyecto);

  const onAddToCart = () => {
    if (!hasFiles || notReady) return;
    flyToCart();
    // "Por separado" only makes sense with a binding → each file becomes its own
    // project (one binding each), same configuration.
    const splitIndividual = config.juntos === 'individual' && config.acabado !== 'sinencuadernacion' && files.length > 1;
    if (splitIndividual) {
      for (const f of files) {
        const base = f.name.replace(/\.[a-z0-9]+$/i, '');
        const nombre = nombreProyecto.trim() ? `${nombreProyecto.trim()} · ${base}` : base;
        addToCart(buildProjectFrom([f], crypto.randomUUID(), nombre));
      }
    } else {
      addToCart(buildProject());
    }
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
        // Replace only THIS project (by id); other projects of the order stay.
        // The email proves ownership (the server won't take the code alone).
        body: JSON.stringify({ item: buildProject(), email: editingOrderEmail ?? '' }),
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
          {!catalogLoaded ? (
            <span className="summary-meta">{catalogError ?? 'Cargando precios…'}</span>
          ) : hasFiles ? (
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
            {saving ? 'Guardando…' : !catalogLoaded ? 'Precios no disponibles' : uploading ? 'Subiendo…' : failed ? 'Hay un archivo con error' : 'Guardar cambios'}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!hasFiles || notReady} onClick={onAddToCart}>
            {!catalogLoaded ? 'Precios no disponibles' : uploading ? 'Subiendo…' : failed ? 'Hay un archivo con error' : 'Añadir proyecto al carrito'}
          </button>
        )}
      </div>
    </footer>
  );
}
