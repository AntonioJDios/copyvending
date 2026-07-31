import { API_BASE } from './api';
import { getAdminToken } from './adminToken';

/**
 * Subida de la imagen de portada.
 *
 * Dos cosas que pasan aquí y no en el servidor:
 *
 *  1. **Se reduce antes de subir.** Una foto del móvil son 4 MB y 4000 px de
 *     ancho; en la portada se ve a 500 px. Subirla tal cual se lo cobraríamos en
 *     datos a cada visitante, así que se redimensiona y se recomprime en el
 *     navegador. La original ni sale del ordenador.
 *  2. **Se sube directa a R2** con una URL firmada, sin pasar por nuestra API. Un
 *     archivo de megas no cabe en el cuerpo de una función serverless.
 */

/** Ancho máximo. Por encima de esto no se gana nitidez en una portada. */
const MAX_WIDTH = 1400;
/** Calidad del JPEG. 0,82 es donde deja de notarse la diferencia. */
const QUALITY = 0.82;

/** Reduce y recomprime en el navegador. Devuelve un JPEG. */
export async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('El navegador no ha podido procesar la imagen.');
    // Fondo blanco: un PNG con transparencia sobre JPEG saldría con fondo negro.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('No se pudo comprimir la imagen.');
    return blob;
  } finally {
    bitmap.close();
  }
}

export interface UploadedImage {
  /** Dirección que se guarda en la configuración y que verán los visitantes. */
  publicUrl: string;
  /** Tamaño final, para poder decírselo a quien la sube. */
  bytes: number;
}

/** Reduce la imagen, la sube a R2 y devuelve su dirección pública. */
export async function uploadHeroImage(file: File): Promise<UploadedImage> {
  if (!API_BASE) throw new Error('Subir imágenes requiere el backend.');
  if (!file.type.startsWith('image/')) throw new Error('El archivo tiene que ser una imagen.');

  const blob = await shrinkImage(file);
  const token = getAdminToken();
  const res = await fetch(`${API_BASE}/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ op: 'putPublic', name: 'portada.jpg', type: 'image/jpeg', size: blob.size, folder: 'portada' }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `Error ${res.status} al preparar la subida`);
  }
  const { url, publicUrl } = (await res.json()) as { url: string; publicUrl: string };

  const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
  if (!put.ok) throw new Error(`El almacenamiento ha rechazado la imagen (error ${put.status}).`);

  return { publicUrl, bytes: blob.size };
}
