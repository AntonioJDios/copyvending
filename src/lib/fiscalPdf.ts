/**
 * Quarterly (or any period) fiscal summary PDF — what the shop hands to their tax
 * advisor: taxable base + IVA (21%) + total, broken down by month and by order
 * source. Built client-side with pdf-lib (same as the invoices). It's an
 * orientative summary, not an invoice.
 */

export interface FiscalRow {
  label: string;
  orders: number;
  revenue: number; // gross, IVA incluido
}

export interface FiscalPdfInput {
  title: string;
  sourceLabel: string;
  filename: string;
  totals: { revenue: number; orders: number };
  months: FiscalRow[];
  bySource: FiscalRow[]; // empty when a single source is already selected
  vatRate: number;
}

const money = (n: number) => `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export async function downloadFiscalPdf(input: FiscalPdfInput): Promise<void> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const A4: [number, number] = [595.28, 841.89];
  const M = 48;
  const W = A4[0];
  const ink = rgb(0.12, 0.16, 0.2);
  const grey = rgb(0.4, 0.45, 0.5);
  const brand = rgb(0.055, 0.647, 0.717);

  let page = doc.addPage(A4);
  let y = A4[1] - M;

  const newPage = () => {
    page = doc.addPage(A4);
    y = A4[1] - M;
  };
  const need = (h: number) => {
    if (y - h < M) newPage();
  };
  const text = (t: string, x: number, size: number, f = font, color = ink) => page.drawText(t, { x, y, size, font: f, color });
  const right = (t: string, xr: number, size: number, f = font, color = ink) => {
    const w = f.widthOfTextAtSize(t, size);
    page.drawText(t, { x: xr - w, y, size, font: f, color });
  };

  // Right edges for the numeric columns.
  const RE = { orders: W - M - 300, base: W - M - 200, iva: W - M - 100, total: W - M };
  const ivaPct = Math.round(input.vatRate * 100);
  const baseOf = (gross: number) => gross / (1 + input.vatRate);

  // Header
  text(input.title, M, 18, bold);
  y -= 22;
  text(`Generado el ${new Date().toLocaleDateString('es-ES')}  ·  Origen: ${input.sourceLabel}`, M, 9, font, grey);
  y -= 26;

  // Totals
  const base = baseOf(input.totals.revenue);
  const vat = input.totals.revenue - base;
  text('Totales del periodo', M, 12, bold);
  y -= 18;
  const kv = (k: string, v: string, strong = false) => {
    text(k, M, 11, font, grey);
    right(v, W - M, 11, strong ? bold : font, strong ? brand : ink);
    y -= 16;
  };
  kv('Base imponible', money(base), true);
  kv(`IVA (${ivaPct}%)`, money(vat), true);
  kv('Facturación (IVA incluido)', money(input.totals.revenue));
  kv('Nº de pedidos', String(input.totals.orders));
  kv('Ticket medio', money(input.totals.orders ? input.totals.revenue / input.totals.orders : 0));
  y -= 14;

  const table = (firstCol: string, rows: FiscalRow[]) => {
    need(26);
    text(firstCol, M, 9, bold, grey);
    right('Pedidos', RE.orders, 9, bold, grey);
    right('Base', RE.base, 9, bold, grey);
    right(`IVA ${ivaPct}%`, RE.iva, 9, bold, grey);
    right('Total', RE.total, 9, bold, grey);
    y -= 5;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: grey });
    y -= 14;
    for (const r of rows) {
      need(16);
      const b = baseOf(r.revenue);
      text(r.label, M, 10);
      right(String(r.orders), RE.orders, 10);
      right(money(b), RE.base, 10);
      right(money(r.revenue - b), RE.iva, 10);
      right(money(r.revenue), RE.total, 10);
      y -= 15;
    }
  };

  if (input.months.length > 0) {
    text('Desglose por mes', M, 12, bold);
    y -= 18;
    table('Mes', input.months);
    y -= 14;
  }
  if (input.bySource.length > 1) {
    need(40);
    text('Desglose por origen', M, 12, bold);
    y -= 18;
    table('Origen', input.bySource);
    y -= 14;
  }

  need(34);
  text(`Precios con IVA incluido al ${ivaPct}%. Base y cuota calculadas para el modelo 303.`, M, 8, font, grey);
  y -= 11;
  text('Documento orientativo para el asesor fiscal; no es una factura.', M, 8, font, grey);

  const bytes = await doc.save();
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${input.filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
