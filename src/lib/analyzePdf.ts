import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Size } from '../domain/types';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface FileAnalysis {
  name: string;
  pages: number;
  /** Detected paper size (nearest standard) or 'desconocido'. */
  size: Size | 'desconocido';
  orientation: 'vertical' | 'horizontal';
  /** Pages that contain colour (approx. if the doc was sampled). */
  colorPages: number;
  colorApprox: boolean;
  hasColor: boolean;
  /** First ~500 chars of page 1 (to infer the document type). Never the whole doc. */
  textExcerpt: string;
  likelyPhoto: boolean;
}

// Standard sizes in PostScript points (1/72"), portrait.
const SIZES: { size: Size; w: number; h: number }[] = [
  { size: 'A4', w: 595, h: 842 },
  { size: 'A3', w: 842, h: 1191 },
  { size: 'A5', w: 420, h: 595 },
];
const MAX_SCAN = 140; // cap colour-scan work; sample beyond this
const COLOR_SPREAD = 26; // channel spread above which a pixel counts as colour
const COLOR_PAGE_FRACTION = 0.004; // ≥0.4% coloured pixels ⇒ page has colour

function nearestSize(wPt: number, hPt: number): Size | 'desconocido' {
  const w = Math.min(wPt, hPt);
  const h = Math.max(wPt, hPt);
  let best: Size | 'desconocido' = 'desconocido';
  let bestErr = Infinity;
  for (const s of SIZES) {
    const err = Math.abs(w - s.w) / s.w + Math.abs(h - s.h) / s.h;
    if (err < bestErr && err < 0.12) {
      bestErr = err;
      best = s.size;
    }
  }
  return best;
}

/** True if the rendered page/image has a meaningful amount of colour. */
function canvasHasColor(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  let colored = 0;
  let total = 0;
  // Sample every 4th pixel (stride 16 bytes).
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 16) continue;
    total++;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread > COLOR_SPREAD) colored++;
  }
  return total > 0 && colored / total > COLOR_PAGE_FRACTION;
}

async function analyzeImage(file: File): Promise<FileAnalysis> {
  const bitmap = await createImageBitmap(file);
  const targetW = 120;
  const scale = Math.min(1, targetW / bitmap.width);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const hasColor = canvasHasColor(ctx, w, h);
  const orientation = bitmap.width >= bitmap.height ? 'horizontal' : 'vertical';
  bitmap.close();
  return {
    name: file.name,
    pages: 1,
    size: 'desconocido',
    orientation,
    colorPages: hasColor ? 1 : 0,
    colorApprox: false,
    hasColor,
    textExcerpt: '',
    likelyPhoto: true,
  };
}

/**
 * Deterministic, in-browser analysis. NO tokens: page count, paper size,
 * orientation, colour per page (sampled) and a short page-1 text excerpt.
 */
export async function analyzeFile(file: File, onProgress?: (done: number, total: number) => void): Promise<FileAnalysis> {
  if (file.type.startsWith('image/')) return analyzeImage(file);

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = pdf.numPages;

  // Page 1: size + orientation + text excerpt.
  const p1 = await pdf.getPage(1);
  const base = p1.getViewport({ scale: 1 });
  const size = nearestSize(base.width, base.height);
  const orientation = base.width > base.height ? 'horizontal' : 'vertical';
  let textExcerpt = '';
  try {
    const tc = await p1.getTextContent();
    textExcerpt = tc.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
  } catch {
    /* scanned PDF w/o text layer */
  }

  // Colour scan (sampled for big docs).
  const step = Math.max(1, Math.ceil(pages / MAX_SCAN));
  const scanned: number[] = [];
  for (let n = 1; n <= pages; n += step) scanned.push(n);
  let coloredScanned = 0;
  for (let idx = 0; idx < scanned.length; idx++) {
    const n = scanned[idx];
    try {
      const page = n === 1 ? p1 : await pdf.getPage(n);
      const vp0 = page.getViewport({ scale: 1 });
      const scale = 96 / vp0.width; // ~96px wide, enough to detect colour
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      if (canvasHasColor(ctx, canvas.width, canvas.height)) coloredScanned++;
    } catch {
      /* skip unrenderable page */
    }
    onProgress?.(idx + 1, scanned.length);
  }
  void pdf.cleanup();

  const colorApprox = step > 1;
  const colorPages = colorApprox ? Math.round((coloredScanned / scanned.length) * pages) : coloredScanned;
  const likelyPhoto = pages <= 2 && textExcerpt.length < 20;

  return {
    name: file.name,
    pages,
    size,
    orientation,
    colorPages,
    colorApprox,
    hasColor: coloredScanned > 0,
    textExcerpt,
    likelyPhoto,
  };
}
