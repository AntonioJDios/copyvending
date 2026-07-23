import type { Order } from '../store/useOrders';
import type { InvoicingConfig } from '../domain/catalog';
import { projectDisplayName, projectSpecLines } from '../domain/orderSpec';

/**
 * Simple invoice PDF (like PrestaShop's): shop fiscal header, customer billing
 * data, line items with their configuration, IVA breakdown and payment status.
 * Proforma when unpaid; final invoice when paid. Not Verifactu — orientative.
 */
const VAT_RATE = 0.21;
const money = (n: number) => `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const PAYMENT_LABEL: Record<string, string> = { local: 'Pago en el mostrador', redsys: 'Tarjeta / Bizum (Redsys)' };

export async function downloadInvoice(order: Order, shop: InvoicingConfig): Promise<void> {
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
  const newPage = () => { page = doc.addPage(A4); y = A4[1] - M; };
  const need = (h: number) => { if (y - h < M) newPage(); };
  const text = (t: string, x: number, size: number, f = font, color = ink) => page.drawText(t, { x, y, size, font: f, color });
  const right = (t: string, xr: number, size: number, f = font, color = ink) => page.drawText(t, { x: xr - f.widthOfTextAtSize(t, size), y, size, font: f, color });
  const clip = (t: string, size: number, max: number, f = font) => {
    if (f.widthOfTextAtSize(t, size) <= max) return t;
    let s = t;
    while (s.length > 1 && f.widthOfTextAtSize(s + '…', size) > max) s = s.slice(0, -1);
    return s + '…';
  };

  const paid = !!order.paid;
  const title = paid ? 'FACTURA' : 'FACTURA PROFORMA';
  const d = new Date(order.createdAt);
  const billing = order.customer.billing;

  // Header: shop (emisor) + title.
  text(shop.shopName || 'Copistería', M, 15, bold);
  y -= 15;
  if (shop.shopNif) { text(`NIF: ${shop.shopNif}`, M, 9, font, grey); y -= 12; }
  for (const line of (shop.shopAddress || '').split('\n').slice(0, 3)) {
    if (line.trim()) { text(line.trim(), M, 9, font, grey); y -= 12; }
  }
  // Title block (right side of the first row).
  page.drawText(title, { x: W - M - bold.widthOfTextAtSize(title, 18), y: A4[1] - M - 2, size: 18, font: bold, color: brand });
  page.drawText(`Nº ${order.id}`, { x: W - M - font.widthOfTextAtSize(`Nº ${order.id}`, 10), y: A4[1] - M - 22, size: 10, font, color: ink });
  page.drawText(d.toLocaleDateString('es-ES'), { x: W - M - font.widthOfTextAtSize(d.toLocaleDateString('es-ES'), 10), y: A4[1] - M - 36, size: 10, font, color: grey });

  y -= 14;
  // Cliente (facturar a).
  text('Facturar a', M, 9, bold, grey);
  y -= 14;
  const cName = billing?.nombre || `${order.customer.nombre} ${order.customer.apellidos}`.trim();
  text(cName, M, 11, bold);
  y -= 13;
  if (billing?.nif) { text(`NIF: ${billing.nif}`, M, 10); y -= 13; }
  if (billing?.linea1) {
    text([billing.linea1, billing.linea2].filter(Boolean).join(', '), M, 10);
    y -= 13;
    text([billing.cp, billing.ciudad, billing.provincia].filter(Boolean).join(' · '), M, 10);
    y -= 13;
  } else if (order.customer.email) {
    text(order.customer.email, M, 10, font, grey);
    y -= 13;
  }
  y -= 8;

  // Line items table.
  const REtotal = W - M;
  const REqty = W - M - 90;
  text('Concepto', M, 9, bold, grey);
  right('Cant.', REqty, 9, bold, grey);
  right('Importe', REtotal, 9, bold, grey);
  y -= 5;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: grey });
  y -= 15;

  for (const it of order.items) {
    need(30);
    const qty = it.kind === 'copias' ? it.copias : it.cantidad;
    text(clip(projectDisplayName(it), 10, REqty - M - 10), M, 10, bold);
    right(String(qty), REqty, 10);
    right(money(it.total), REtotal, 10);
    y -= 13;
    const spec = projectSpecLines(it).map(([k, v]) => `${k}: ${v}`).join(' · ');
    if (spec) { text(clip(spec, 8, W - 2 * M), M + 8, 8, font, grey); y -= 12; }
    y -= 4;
  }

  // Totals.
  need(64);
  y -= 6;
  page.drawLine({ start: { x: W - M - 220, y }, end: { x: W - M, y }, thickness: 0.5, color: grey });
  y -= 16;
  const base = order.total / (1 + VAT_RATE);
  const vat = order.total - base;
  const totalRow = (k: string, v: string, strong = false) => {
    text(k, W - M - 220, 10, strong ? bold : font, strong ? ink : grey);
    right(v, W - M, 10, strong ? bold : font, strong ? ink : ink);
    y -= 15;
  };
  totalRow('Base imponible', money(base));
  totalRow(`IVA (${Math.round(VAT_RATE * 100)}%)`, money(vat));
  totalRow('TOTAL', money(order.total), true);

  y -= 10;
  need(30);
  if (paid) {
    text(`Estado: PAGADO · ${PAYMENT_LABEL[order.paymentMethod ?? ''] ?? order.paymentMethod ?? ''}`, M, 10, bold, brand);
  } else {
    text('Estado: PENDIENTE DE PAGO', M, 10, bold, rgb(0.72, 0.28, 0.28));
  }
  y -= 16;
  if (!paid) {
    text('Documento proforma; no válido como factura hasta que se complete el pago.', M, 8, font, grey);
    y -= 11;
  }
  text('IVA incluido en los precios. Documento simplificado, sin validez Verifactu.', M, 8, font, grey);

  const bytes = await doc.save();
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${paid ? 'factura' : 'proforma'}-${order.id}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
