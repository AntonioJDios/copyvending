// Sends a fake print-job email to the deployed ingestion endpoint and prints
// the result. Retries while the new deployment comes up.
import { PDFDocument, StandardFonts } from 'pdf-lib';

const URL = process.env.INGEST_URL || 'https://copyvending.vercel.app/api/ingest-email';

async function samplePdfBase64() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`Documento de prueba - pagina ${i}`, { x: 60, y: 760, size: 22, font });
  }
  return Buffer.from(await pdf.save()).toString('base64');
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dataBase64 = await samplePdfBase64();
  const email = {
    messageId: `test-${Date.now()}`,
    from: 'cliente@example.com',
    fromName: 'Cliente de Prueba',
    subject: 'Trabajo de impresion',
    text: 'Hola, os envio un archivo. Quiero imprimirlo a color, A4, a doble cara y encuadernado en anillas. Gracias.',
    attachments: [{ filename: 'documento-de-prueba.pdf', contentType: 'application/pdf', dataBase64 }],
  };

  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const text = await res.text();
      console.log(`[intento ${attempt}] HTTP ${res.status}`);
      console.log(text.slice(0, 800));
      // 5xx invocation-failed pages during redeploy → retry; otherwise stop.
      if (res.status < 500 || !/FUNCTION_INVOCATION_FAILED|server error/i.test(text)) return;
    } catch (e) {
      console.log(`[intento ${attempt}] error de red: ${e.message}`);
    }
    await delay(20000);
  }
}
main();
