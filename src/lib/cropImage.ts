import type { Area } from 'react-easy-crop';

/** Legacy mug print area ratio (3450 × 1532 px ≈ 24 × 9,5 cm wrapped). */
export const MUG_ASPECT = 3450 / 1532;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = url;
  });
}

/** Crop `area` (source pixels from react-easy-crop) to a JPEG data URL. */
export async function cropToDataUrl(imageUrl: string, area: Area, maxWidth = 1400): Promise<string> {
  const img = await loadImage(imageUrl);
  const outW = Math.min(Math.round(area.width), maxWidth);
  const outH = Math.round(outW * (area.height / area.width));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D no disponible');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, outW, outH);
  return canvas.toDataURL('image/jpeg', 0.9);
}

/** Ceramic color for the mug body and the print margins (matches MugScene). */
const CERAMIC_HEX = '#f5f5f6';

/**
 * Build the mug's wrap texture: the cropped photo centered on a ceramic-colored
 * canvas with top/bottom margins, so the artwork sits in a band and the rim and
 * base stay ceramic (as on a real mug). `marginFrac` = margin per side as a
 * fraction of the full texture height.
 */
export interface MugTextureOptions {
  /** Vertical ceramic margin per side (fraction of full height) — rim & base. */
  vMargin?: number;
  /** Horizontal ceramic margin per side (fraction of full width) — the gap that,
   *  once wrapped, leaves ceramic around the handle. */
  hMargin?: number;
  maxWidth?: number;
}

export async function buildMugTexture(imageUrl: string, area: Area, opts: MugTextureOptions = {}): Promise<string> {
  const { vMargin = 0.14, hMargin = 0.1, maxWidth = 1600 } = opts;
  const img = await loadImage(imageUrl);
  const photoW = Math.min(Math.round(area.width), maxWidth);
  const photoH = Math.round(photoW * (area.height / area.width));
  const fullW = Math.round(photoW / (1 - 2 * hMargin));
  const fullH = Math.round(photoH / (1 - 2 * vMargin));
  const mx = Math.round((fullW - photoW) / 2);
  const my = Math.round((fullH - photoH) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = fullW;
  canvas.height = fullH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D no disponible');
  ctx.fillStyle = CERAMIC_HEX;
  ctx.fillRect(0, 0, fullW, fullH);
  ctx.drawImage(img, area.x, area.y, area.width, area.height, mx, my, photoW, photoH);
  return canvas.toDataURL('image/jpeg', 0.9);
}
