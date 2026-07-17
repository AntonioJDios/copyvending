import { FINISH_LABEL, FOLIO_LABEL, SIZE_LABEL } from './catalog';
import type { CartProject } from '../store/useCart';

const DOC_COLOR: Record<string, string> = { all: 'todo color', cover: 'portada color', no: '' };

/** Display name for a cart/order item, with a sensible fallback per kind. */
export function projectDisplayName(p: CartProject): string {
  if (p.nombre.trim()) return p.nombre.trim();
  return p.kind === 'taza' ? 'Taza personalizada' : p.kind === 'chapa' ? 'Chapa personalizada' : 'Proyecto sin título';
}

/** Full, print-ready spec sheet for one item (label → value). */
export function projectSpecLines(p: CartProject): [string, string][] {
  if (p.kind === 'chapa') {
    return [['Producto', 'Chapa'], ['Tamaño', `Ø ${p.sizeMm} mm`], ['Trasera', p.back], ['Unidades', String(p.cantidad)]];
  }
  if (p.kind === 'taza') {
    return [['Producto', 'Taza sublimación'], ['Área', '24 × 9,5 cm'], ['Unidades', String(p.cantidad)]];
  }
  const c = p.config;
  const rows: [string, string][] = [
    ['Tamaño', SIZE_LABEL[c.size]],
    ['Impresión', c.color === 'BN' ? 'Blanco y negro' : 'Color'],
    ['Gramaje', `${c.grosor} gr`],
    ['Caras', c.dobleCara === '1' ? 'Doble cara' : 'Una cara'],
    ['Orientación', c.orientacion === 'vertical' ? 'Vertical' : 'Horizontal'],
    ['Págs. por cara', String(c.paginasPorHoja)],
    ['Encuadernación', FINISH_LABEL[c.acabado]],
  ];
  if (c.acabado !== 'sinencuadernacion') rows.push(['Lado', c.ladoEncuadernacion === 'largo' ? 'Lado largo' : 'Lado corto']);
  if (c.acabado === 'AnillasColores') rows.push(['Anillas', p.colorAnillas], ['Contraportada', p.colorContraportada]);
  if (c.acabado !== 'sinencuadernacion' && (c.foliosDelante > 0 || c.foliosDetras > 0)) {
    rows.push(['Folios en blanco', `${c.foliosDelante} delante · ${c.foliosDetras} detrás`]);
  }
  if (c.acabadoFolios !== 'normal') rows.push(['Acabado folios', FOLIO_LABEL[c.acabadoFolios]]);
  if (c.sinMargenes) rows.push(['Sin márgenes', 'Sí (284 × 198 mm)']);
  if (p.docs.length > 1) rows.push(['Agrupación', c.juntos === 'agrupados' ? 'Todo junto' : 'Por separado']);
  rows.push(['Copias', String(p.copias)]);
  return rows;
}

/** Per-document lines for a copies project (name → detail). */
export function projectDocLines(p: Extract<CartProject, { kind: 'copias' }>): [string, string][] {
  return p.docs.map((d) => {
    const col = p.config.color === 'BN' && d.color !== 'no' ? ` · ${DOC_COLOR[d.color]}` : '';
    return [d.name, `${d.pages} pág.${col}`];
  });
}
