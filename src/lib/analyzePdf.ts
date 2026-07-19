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
  /** ~30% of page 1's text (bounded) so the model can guess the document type. */
  textExcerpt: string;
  /** Best-guess document title (biggest text on page 1). */
  title: string;
  likelyPhoto: boolean;
  // --- Pre-flight quality signals ---
  /** Blank pages detected (approx. if sampled). */
  blankPages: number;
  /** True if page sizes are mixed (e.g. A4 + A3). */
  mixedSizes: boolean;
  /** For image uploads: low-resolution for large printing. */
  lowRes?: { w: number; h: number };
}

const SIZES: { size: Size; w: number; h: number }[] = [
  { size: 'A4', w: 595, h: 842 },
  { size: 'A3', w: 842, h: 1191 },
  { size: 'A5', w: 420, h: 595 },
];
const MAX_SCAN = 140;
const COLOR_SPREAD = 26;
const COLOR_PAGE_FRACTION = 0.004;
const INK_BLANK_FRACTION = 0.002; // below this a page is considered blank

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

/** Colour + ink coverage of a rendered page (sampled pixels). */
function canvasStats(ctx: CanvasRenderingContext2D, w: number, h: number): { colored: boolean; blank: boolean } {
  const { data } = ctx.getImageData(0, 0, w, h);
  let colored = 0;
  let ink = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 16) continue;
    total++;
    if (Math.max(r, g, b) - Math.min(r, g, b) > COLOR_SPREAD) colored++;
    if ((r + g + b) / 3 < 245) ink++;
  }
  return { colored: total > 0 && colored / total > COLOR_PAGE_FRACTION, blank: total > 0 && ink / total < INK_BLANK_FRACTION };
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
  const { colored } = canvasStats(ctx, w, h);
  const orientation = bitmap.width >= bitmap.height ? 'horizontal' : 'vertical';
  // Low-res if the long edge is under ~A4 at 150 dpi (≈1400 px).
  const longEdge = Math.max(bitmap.width, bitmap.height);
  const lowRes = longEdge < 1400 ? { w: bitmap.width, h: bitmap.height } : undefined;
  bitmap.close();
  return {
    name: file.name,
    pages: 1,
    size: 'desconocido',
    orientation,
    colorPages: colored ? 1 : 0,
    colorApprox: false,
    hasColor: colored,
    textExcerpt: '',
    title: file.name.replace(/\.[a-z0-9]+$/i, ''),
    likelyPhoto: true,
    blankPages: 0,
    mixedSizes: false,
    lowRes,
  };
}

/** Biggest text on page 1 → best-guess title. */
function guessTitle(items: { str: string; height: number }[]): string {
  const words = items.filter((i) => i.str.trim());
  if (words.length === 0) return '';
  const maxH = Math.max(...words.map((i) => i.height || 0));
  const pick = maxH > 0 ? words.filter((i) => (i.height || 0) >= maxH * 0.9) : words.slice(0, 6);
  return pick
    .map((i) => i.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);
}

export async function analyzeFile(file: File, onProgress?: (done: number, total: number) => void): Promise<FileAnalysis> {
  if (file.type.startsWith('image/')) return analyzeImage(file);

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = pdf.numPages;

  const p1 = await pdf.getPage(1);
  const base = p1.getViewport({ scale: 1 });
  const size = nearestSize(base.width, base.height);
  const orientation = base.width > base.height ? 'horizontal' : 'vertical';

  let textExcerpt = '';
  let title = '';
  try {
    const tc = await p1.getTextContent();
    const items = tc.items.map((it) => ('str' in it ? { str: it.str, height: (it as { height?: number }).height ?? 0 } : { str: '', height: 0 }));
    const full = items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
    const take = Math.min(2000, Math.max(600, Math.round(full.length * 0.3)));
    textExcerpt = full.slice(0, take);
    title = guessTitle(items);
  } catch {
    /* scanned PDF w/o text layer */
  }
  if (!title) title = file.name.replace(/\.[a-z0-9]+$/i, '');

  // Colour + blank + size scan (sampled for big docs).
  const step = Math.max(1, Math.ceil(pages / MAX_SCAN));
  const scanned: number[] = [];
  for (let n = 1; n <= pages; n += step) scanned.push(n);
  if (scanned[scanned.length - 1] !== pages) scanned.push(pages); // always check the last page
  let coloredScanned = 0;
  let blankScanned = 0;
  const sizeKeys = new Set<string>();
  for (let idx = 0; idx < scanned.length; idx++) {
    const n = scanned[idx];
    try {
      const page = n === 1 ? p1 : await pdf.getPage(n);
      const vp0 = page.getViewport({ scale: 1 });
      const lo = Math.round(Math.min(vp0.width, vp0.height) / 10);
      const hi = Math.round(Math.max(vp0.width, vp0.height) / 10);
      sizeKeys.add(`${lo}x${hi}`);
      const scale = 96 / vp0.width;
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      const stats = canvasStats(ctx, canvas.width, canvas.height);
      if (stats.colored) coloredScanned++;
      if (stats.blank) blankScanned++;
    } catch {
      /* skip unrenderable page */
    }
    onProgress?.(idx + 1, scanned.length);
  }
  void pdf.cleanup();

  const colorApprox = step > 1;
  const factor = pages / scanned.length;
  const colorPages = colorApprox ? Math.round(coloredScanned * factor) : coloredScanned;
  const blankPages = colorApprox ? Math.round(blankScanned * factor) : blankScanned;

  return {
    name: file.name,
    pages,
    size,
    orientation,
    colorPages,
    colorApprox,
    hasColor: coloredScanned > 0,
    textExcerpt,
    title,
    likelyPhoto: pages <= 2 && textExcerpt.length < 20,
    blankPages,
    mixedSizes: sizeKeys.size > 1,
  };
}

/** Human, deterministic pre-flight warnings for the uploaded files. */
export function preflightWarnings(analyses: FileAnalysis[]): string[] {
  const w: string[] = [];
  for (const a of analyses) {
    if (a.lowRes) {
      w.push(`«${a.name}»: imagen de baja resolución (${a.lowRes.w}×${a.lowRes.h} px); a tamaño grande puede verse pixelada.`);
    }
    if (a.mixedSizes) {
      w.push(`«${a.name}»: mezcla tamaños de página (p.ej. A4 y A3); revisa cómo quieres imprimirlo.`);
    }
    if (a.blankPages > 0) {
      w.push(`«${a.name}»: ${a.blankPages} página${a.blankPages !== 1 ? 's' : ''} en blanco detectada${a.blankPages !== 1 ? 's' : ''}${a.colorApprox ? ' (aprox.)' : ''}.`);
    }
  }
  return w;
}
