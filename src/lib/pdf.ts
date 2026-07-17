import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface FileInfo {
  pages: number;
  thumb: string;
}

const THUMB_W = 180;

/**
 * Count pages and render a page-1 thumbnail for an uploaded file, in the
 * browser. PDFs go through pdf.js; images count as one page and are drawn
 * directly. Nothing is uploaded anywhere.
 */
export async function readFileInfo(file: File): Promise<FileInfo> {
  if (file.type.startsWith('image/')) {
    return { pages: 1, thumb: await imageThumb(file) };
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = THUMB_W / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const thumb = canvas.toDataURL('image/jpeg', 0.7);
  const pages = pdf.numPages;
  void pdf.cleanup();
  return { pages, thumb };
}

/** Render a specific PDF page (1-based) to a thumbnail data URL. */
export async function renderPdfPage(file: File, pageNum: number): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const page = await pdf.getPage(Math.max(1, Math.min(pageNum, pdf.numPages)));
  const base = page.getViewport({ scale: 1 });
  const scale = THUMB_W / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const url = canvas.toDataURL('image/jpeg', 0.7);
  void pdf.cleanup();
  return url;
}

async function imageThumb(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = THUMB_W / bitmap.width;
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_W;
  canvas.height = Math.ceil(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.7);
}
