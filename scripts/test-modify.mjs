// Verifies: (1) email ingestion captures ring/cover colours from loose words,
// (2) an order in 'nuevo' can be modified via PUT and the total is recomputed.
import { PDFDocument, StandardFonts } from 'pdf-lib';

const BASE = 'https://copyvending.vercel.app/api';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function samplePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) pdf.addPage([595, 842]).drawText(`pagina ${i}`, { x: 60, y: 760, size: 22, font });
  return Buffer.from(await pdf.save()).toString('base64');
}

async function main() {
  const dataBase64 = await samplePdf();
  const email = {
    messageId: `test-${Date.now()}`,
    fromName: 'Cliente Prueba',
    subject: 'Trabajo',
    text: 'Imprimir a color, A4, doble cara, encuadernado en anillas azules y contraportada amarilla.',
    attachments: [{ filename: 'x.pdf', contentType: 'application/pdf', dataBase64 }],
  };

  // create (retry while deploy comes up)
  let created;
  for (let i = 1; i <= 8; i++) {
    const res = await fetch(`${BASE}/ingest-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const txt = await res.text();
    if (res.status < 500 || !/FUNCTION_INVOCATION_FAILED|server error/i.test(txt)) {
      created = JSON.parse(txt);
      break;
    }
    console.log(`[deploy...] intento ${i}`);
    await delay(20000);
  }
  console.log('CREADO:', created);

  const ord = await (await fetch(`${BASE}/orders?id=${created.orderId}`)).json();
  const it = ord.items[0];
  console.log(`colores → anillas="${it.colorAnillas}" contraportada="${it.colorContraportada}"`);
  console.log(`total inicial = ${ord.total} (copias ${it.copias})`);

  // modify: triple the copies
  const newItem = { ...it, copias: 3 };
  const put = await fetch(`${BASE}/orders?id=${created.orderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [newItem] }) });
  const putData = await put.json();
  console.log(`PUT HTTP ${put.status}:`, putData);

  const ord2 = await (await fetch(`${BASE}/orders?id=${created.orderId}`)).json();
  console.log(`total tras modificar (copias 3) = ${ord2.total}`);

  const bad = await fetch(`${BASE}/orders?id=NO-EXISTE`);
  console.log(`GET id inexistente → HTTP ${bad.status}`);
}
main();
