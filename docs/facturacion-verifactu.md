# Facturación y Verifactu — situación y decisión pendiente

> **Para qué es este documento:** llevárselo al asesor fiscal y volver con una
> decisión. Describe exactamente qué emite hoy el sistema, qué le falta para ser
> una factura válida y las tres opciones posibles. **No soy asesor fiscal**: lo
> que sigue es la descripción técnica honesta de lo que hay, no un dictamen.

---

## 1. Qué emite hoy el sistema

Desde el panel de pedidos se puede descargar un PDF por pedido
([src/lib/invoicePdf.ts](../src/lib/invoicePdf.ts)) que contiene:

- Cabecera con los datos del negocio (nombre, NIF, dirección, email) que el dueño
  rellena en el panel.
- Datos de facturación del cliente (nombre, NIF, dirección) si los dio.
- Líneas de detalle: cada proyecto con su configuración de impresión y su importe.
- Descuento de cupón y coste de envío, si los hay.
- Desglose de base imponible + IVA + total.
- Estado del pago y forma de pago.
- Se titula **"FACTURA"** si el pedido está pagado y **"FACTURA PROFORMA"** si no.

Además hay un **resumen fiscal del periodo**
([src/lib/fiscalPdf.ts](../src/lib/fiscalPdf.ts)): facturación, base e IVA por mes
y por canal, pensado como orientación para el modelo 303.

Los precios del catálogo se introducen **con IVA incluido**, y el sistema
desglosa base y cuota hacia atrás.

## 2. Qué le falta para ser una factura válida

Dos carencias concretas, ninguna resuelta:

**a) La numeración no es una serie correlativa.** El número que aparece es el
código del pedido (`P-XXXXXXXX`), que además **ahora es aleatorio** (antes derivaba
de la fecha). Una factura necesita una serie secuencial y sin huecos; esto no lo
es, y no puede convertirse en una simplemente renombrando el campo: hace falta un
contador propio en la base de datos, independiente de los pedidos.

**b) No cumple Verifactu.** El propio PDF lo declara al pie ("Documento
simplificado, sin validez Verifactu"). Según el calendario del RD 254/2025 la
obligación ya está en vigor: **1 de enero de 2026** para contribuyentes del
Impuesto sobre Sociedades y **1 de julio de 2026** para el resto. Cumplirlo exige
registro de facturación con huella/encadenado, remisión o conservación según
modalidad, y software que se declare conforme — es un proyecto en sí mismo, no un
ajuste.

**Riesgo mientras no se decida:** el documento se titula "FACTURA" cuando el
pedido está pagado. Entregar como factura algo que no cumple los requisitos es
peor que no entregar nada.

## 3. Lo que ya se ha corregido (28-07-2026)

- **El tipo de IVA ya no está en el código.** Estaba fijo al 21% en dos ficheros;
  ahora se configura en el panel (Pagos y facturación → IVA aplicado) y de ahí lo
  toman tanto los documentos como el resumen fiscal.
- **Avisos explícitos** en el panel de que estos documentos no son facturas con
  validez legal, con el motivo.
- La sección del panel se ha renombrado a **"Documentos de cobro"** para no dar a
  entender que emite facturas.

Lo que **no** se ha tocado a propósito: la numeración y el título del documento.
Ambas cosas dependen de la decisión de abajo, y construirlas antes sería trabajo
que puede sobrar.

## 4. Las tres opciones

### A) No facturar desde aquí ⭐ *(la que recomiendo de partida)*
El sistema emite solo **justificante de compra / proforma**, claramente no fiscal,
y la factura de verdad la hace el programa de facturación o la gestoría, a partir
del resumen de ventas que ya exportamos.

- **A favor:** cero riesgo regulatorio, cero desarrollo, y el resumen fiscal por
  periodo que ya existe es justo lo que necesita el asesor.
- **En contra:** si un cliente pide factura, hay que emitirla fuera del sistema.
- **Trabajo:** ~1 día (renombrar el documento, quitar la palabra "factura",
  ajustar textos).

### B) Integrar un proveedor de facturación homologado
El pedido se sigue gestionando aquí, pero al facturar se llama por API a un
servicio de facturación conforme a Verifactu, que asigna número, encadena el
registro y conserva/remite lo que toque.

- **A favor:** facturas válidas sin construir el cumplimiento nosotros.
- **En contra:** coste recurrente, dependencia de un tercero, y hay que elegir
  proveedor (con el asesor).
- **Trabajo:** ~1 semana, más el alta y las pruebas.

### C) Implementar Verifactu en el sistema
- **A favor:** todo en casa.
- **En contra:** es la opción con más riesgo y más mantenimiento (cambios
  normativos, declaración de conformidad del software). Para una copistería no lo
  recomiendo.
- **Trabajo:** semanas, y para siempre.

## 5. Preguntas concretas para el asesor

1. ¿La copistería tributa por **Sociedades** o por **IRPF**? (determina qué fecha
   del calendario Verifactu aplica).
2. ¿Cuántas facturas nominativas se piden al mes de verdad? Si son muy pocas, la
   opción A es claramente la buena.
3. ¿Vale un **ticket / factura simplificada** para la venta de mostrador, o hacen
   falta facturas completas?
4. ¿Qué **tipo de IVA** aplica a cada cosa? Hoy el sistema aplica un único tipo a
   todo el pedido; si la impresión de libros u otros conceptos llevan tipo
   reducido, hay que poder distinguirlo (sería un desarrollo adicional).
5. Si vamos a la opción B, ¿**qué proveedor** usa ya la gestoría o recomienda?
6. ¿Hay que emitir factura de los **envíos** por separado o van como una línea más?

## 6. Qué hace falta para ejecutar cada opción

| Opción | Desarrollo necesario |
|---|---|
| A | Renombrar documento y textos; eliminar el título "FACTURA" |
| B | Serie de numeración + cliente de la API del proveedor + estados de facturación en el pedido |
| C | Registro de facturación, huella/encadenado, remisión, conservación, conformidad |

**Nada de esto bloquea el resto del proyecto.** La tienda cobra y funciona sin
tomar esta decisión; lo único que hay que evitar es seguir llamando "factura" a lo
que no lo es, y eso ya está avisado en el panel.
