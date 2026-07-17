# Copistería — decisiones de arquitectura y despliegue (pendientes)

Notas para el futuro sobre cómo llevar el configurador (React) a producción. Nada de esto está decidido todavía; es el mapa de opciones.

## El problema de partida

- La tienda original está en **PrestaShop 1.6.0.8**, con la customización hecha en Smarty (`.tpl`) + Vue 2 + PHP suelto.
- **Migrar 1.6 → 1.7 / 8.x es una migración con roturas fuertes**, no un update:
  - Cambió el sistema de temas y la estructura de plantillas (Smarty).
  - Cambiaron controladores, hooks y la API de carrito/customización.
  - Salto de PHP (1.6 → PHP 5/7; PS 8 exige PHP 8.1+).
- **PrestaShop 1.6 está EOL** (sin parches de seguridad). La carpeta `fotocopiator/` tenía scripts de limpieza de skimmers/infección → señal de que por ahí entró un hackeo. Quedarse en 1.6 a largo plazo es un riesgo real.

## La idea clave (por qué reescribir en React lo resuelve)

La app React **no depende de la versión de PrestaShop**. Toda la lógica (configurador, precios, PDF, subida, zip) vive en el React + un backend pequeño, **fuera** de PrestaShop.

- Solo una **capa fina de integración** toca la tienda: añadir al carrito, fijar el precio, guardar la referencia del zip.
- Resultado: **no se vuelven a portar los `.tpl`**. El problema pasa de "reescribir plantillas Smarty en cada versión" a "incrustar un bundle React + pegamento".

## Opciones de "caparazón" (dónde vive la tienda y el cobro)

### A) Standalone + checkout propio  ⭐ (recomendada de partida)
- Dejar PrestaShop del todo. Tienda propia: React + backend propio (subida/zip/precio) + pago (p. ej. Stripe).
- **Pros:** sin treadmill de versiones, sin EOL/inseguridad de 1.6, control total.
- **Contras:** hay que construir checkout, pagos, panel de pedidos (más trabajo).

### B) Migrar a PrestaShop 8 + módulo fino
- Migrar el core de PS (productos/pedidos) a 8.x y escribir **solo un módulo pequeño** que incrusta el React y hace añadir-al-carrito / precio / referencia-zip.
- **Pros:** se reutiliza el admin, catálogo, pedidos y pasarelas de PrestaShop. NO se reescriben los `.tpl`.
- **Contras:** hay que hacer la migración del core de PS igualmente; se sigue atado al ciclo de PrestaShop.

### C) Parche rápido sobre 1.6 (puente)
- Incrustar el React nuevo en la ficha del PS 1.6 actual sin migrar, para modernizar la UX ya.
- **Pros:** rápido.
- **Contras:** 1.6 sigue EOL/inseguro. Solución puente, no definitiva.

## El backend hace falta SÍ o SÍ (en cualquier opción)

Una tienda de verdad necesita backend, no por PrestaShop, sino porque:
- El **precio se recalcula en el servidor** (nunca fiarse del precio que manda el navegador → fraude).
- **Subir los ficheros**, **generar el zip**, y **guardar la referencia** en el pedido.

Diferencia entre opciones = solo *dónde vive* ese backend:
- Standalone → una API propia (Node/PHP).
- Módulo PS → un módulo PHP que además reutiliza carrito/pedidos/pagos.

**Ventaja que ya tenemos:** el dominio (precio, reglas, catálogo) está en **TypeScript puro y aislado** (`src/domain/`). Así que:
- Se puede hacer un **backend Node/TS que reutilice ese mismo dominio** (una sola fuente de verdad).
- Si se va a módulo PS, portar la fórmula a **PHP** es casi mecánico (funciones puras + tablas).
- Plan sin lock-in: **construir primero el backend mínimo agnóstico** (subida → zip → id + cálculo de precio autoritativo), que sirve para las dos vías, y decidir el caparazón más tarde.

## Cómo "cobra" un módulo de PrestaShop (si se va por B)

- Hay **un solo producto** configurable en el catálogo (p. ej. "Impresión de documentos"). **Ese** es el que se añade al carrito y se cobra.
- El **precio dinámico** se aplica creando un **`SpecificPrice`** apuntado a ese carrito (`id_cart` + `id_product` + `id_product_attribute` + `price` = total calculado en servidor). Así esa línea se cobra exactamente lo que calculó el servidor.
- **No se modifican los controllers del core.** Un módulo aporta código nuevo:
  - **Front controllers** del módulo = endpoints AJAX (subir, precio, zip).
  - **Hooks** para inyectar el React en la ficha y para el precio del carrito.
  - **Admin**: página de configuración del módulo (o AdminController propio) para el catálogo.

## Cómo se guardan los ficheros (modelo del dueño, confirmado)

- En el viejo, los ficheros **no** iban al sistema de customización nativo de PrestaShop: se subían a un `/upload/<folder>/` externo y se **unificaban en un zip**; lo que se guardaba en el pedido era la **referencia** (carpeta/zip + identificador).
- Se mantiene ese modelo, pero mejorado:
  - La subida y el zip los hace el **servidor** (no un `upload.php` suelto).
  - El **id de carpeta lo genera el servidor (uuid)**, no el cliente → evita el **path traversal** que tenía el código viejo (tomaba `folder`/`name` del navegador).
  - En la app nueva los ficheros están en el navegador durante la edición; al **checkout** se suben, el backend arma el zip y devuelve un **id** que se guarda con el pedido.

## Automatización de impresión (imprimir con 1 clic)

Objetivo: que desde la configuración se pueda **mandar a imprimir con un clic**, sin configurar la impresión a mano, para automatizar el trabajo de la copistería.

**El navegador NO puede hacerlo.** `window.print()` solo abre el diálogo; una web no puede fijar dúplex/bandeja/color/grapado por seguridad. La automatización vive en una máquina **en la tienda**, no en el cliente.

**Patrón: "agente de impresión" local.**
1. El pedido llega al backend con el **zip de PDFs + un "job ticket"** (las opciones del configurador: tamaño, color, dúplex, n-up, copias, acabado, orden…). Eso ya lo produce el configurador.
2. Un **servicio local** en un PC de la tienda recoge el trabajo y lo manda a la impresora **traduciendo el ticket a opciones de impresión**, sin diálogo.

**Tecnología:**
- **IPP / CUPS** (estándar): enviar el PDF con atributos `media=A4`, `sides=two-sided-long-edge`, `print-color-mode=monochrome|color`, `number-up=2`, `copies=N`, bandeja… Casi todo el configurador mapea 1:1.
- **Copiadoras pro** (Xerox/Konica/Ricoh): **hot-folders** o **JDF** (ticket XML) → sueltas PDF + ticket y se imprime con esos ajustes.

**Qué se automatiza y qué no (honesto):**
- ✅ Automático vía IPP/CUPS: tamaño, color/BN, 1 o 2 caras, n-up, copias, orientación, bandeja/gramaje.
- ⚠️ Según hardware: **grapado y taladro (2/4 agujeros)** solo si la impresora tiene **finisher** que lo soporte (IPP `finishings`).
- ❌ Manual siempre (ninguna impresora lo hace): **anillas/espiral, plastificado, pegatinas** → post-proceso en máquinas aparte. El agente imprime una **hoja de trabajo** con instrucciones para el operario.

**Qué habría que construir:**
- **Agente de impresión local** (Node o Python + CUPS/IPP) al que el backend manda los trabajos.
- **Enrutado por capacidad**: color → cola color; A3 → impresora A3; etc.
- Backend que recibe pedido, arma zip y genera el **job ticket**.
- Opcional: **imposición** en PDF (ordenar páginas de varios docs, separar portada a color); el n-up y el dúplex mejor delegarlos a la impresora vía IPP.

**Dependencia clave (BLOQUEANTE para diseñar):** depende de **qué impresoras/copiadoras hay** (marca/modelo, si hablan IPP, si tienen finisher, si son pro con hot-folder). PENDIENTE: pedir al usuario los modelos. Con eso se define qué es automatizable y el formato exacto del job ticket + el agente.

**Ventaja:** el configurador ya genera el "ticket" con toda la config; falta el agente + backend que lo alimente.

## Estado actual (demo)

- `copisteria-web`: configurador de copias funcional en React (front-only, precio en cliente para enseñarlo). Admin en `/#admin` (catálogo en localStorage).
- Falta: backend mínimo (subida/zip/precio autoritativo), checkout/pago, y decidir el caparazón (A/B/C).
