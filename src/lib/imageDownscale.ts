/**
 * Shrink a data URL to a small JPEG for cheap inline display (cart/backoffice
 * thumbnails). The full-resolution, print-ready artwork is uploaded to R2
 * separately; this keeps order rows tiny and under the API body-size limit.
 */
export async function downscaleDataUrl(dataUrl: string, maxDim = 480, quality = 0.72): Promise<string> {
  try {
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return dataUrl; // on any failure keep the original (still works, just heavier)
  }
}

/** data URL → File, for uploading canvas/crop output to storage. */
export async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], filename, { type: blob.type || 'image/png' });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('no se pudo cargar la imagen'));
    img.src = src;
  });
}
