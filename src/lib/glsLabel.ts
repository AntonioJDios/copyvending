import { API_BASE } from './api';
import { getAdminToken } from './adminToken';

/** GLS parcel-tracking page for a given tracking number (codbarras). */
export const glsTrackUrl = (tracking: string) => `https://mygls.gls-spain.es/e/${encodeURIComponent(tracking)}`;

/** Fetch the stored GLS label (base64 PDF) for an order and trigger a download. */
export async function downloadGlsLabel(orderId: string): Promise<void> {
  if (!API_BASE) throw new Error('Los envíos GLS requieren el backend.');
  const t = getAdminToken();
  const res = await fetch(`${API_BASE}/orders?id=${encodeURIComponent(orderId)}&label=1`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
  });
  if (!res.ok) throw new Error(res.status === 404 ? 'Este pedido no tiene etiqueta GLS.' : `Error ${res.status}`);
  const { label } = (await res.json()) as { label?: string };
  if (!label) throw new Error('Este pedido no tiene etiqueta GLS.');

  // base64 → Blob (PDF) → download.
  const bytes = Uint8Array.from(atob(label), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `etiqueta-gls-${orderId}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
