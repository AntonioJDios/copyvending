# Pendiente: libretas personalizadas (y productos de este tipo)

Anotado el 2026-07-30 a petición del usuario. **No está hecho.** Referencia:
`https://fotocopiator.es/imprimir-online/1935-libreta-personalizada.html`

## Qué es

Una libreta de 90 páginas, papel Navigator de 100 g, desde **6,50 €**, donde el
cliente elige:

| Opción | Valores | ¿Existe ya? |
| --- | --- | --- |
| Tamaño | A5 o A4 | ✅ el catálogo ya los tiene |
| Encuadernación | Anillas de color + contraportada de color | ✅ ya existe, con sus 9 colores |
| Color de anillas | Rosa Neón, Verde Menta, Amarillo Golden, Turquesa, Rosa Pastel, Azul Pastel, Lila… | ✅ `ringColors` |
| Color de contraportada | Negro, Rojo, Transparente, Verde Pastel, Amarillo Pastel, Naranja Pastel, Lila Pastel | ✅ `coverColors` |
| Interior | Cuadros, Líneas, Puntos o Liso | ❌ **no existe** |
| Portada | La sube el cliente (PDF, JPEG o JPG) y se imprime a color | ⚠️ parcial |

## Por qué no es «otro producto más»

El configurador actual parte de que **el cliente sube el documento que se
imprime**. Aquí es al revés: el interior lo genera la tienda a partir de una
plantilla (cuadros, líneas, puntos o liso) y el cliente **solo sube la portada**.

Eso significa dos capacidades nuevas:

1. **Generar el interior.** 90 páginas de cuadrícula, rayado, puntos o liso, en A4
   y A5. Se puede hacer con `pdf-lib`, que ya es dependencia del proyecto (lo usa
   `api/ingest-email`), dibujando la retícula por código en vez de guardar cuatro
   PDF por tamaño. Hay que decidir si el PDF se genera al pedir (servidor) o si se
   guardan plantillas fijas — generar por código evita mantener ocho archivos.
2. **Producto de precio fijo.** Hoy el precio sale de páginas × tarifa. Una libreta
   cuesta 6,50 € «desde», con la encuadernación y los recargos de color ya dentro.
   Es un tipo de artículo distinto al trabajo de impresión por páginas.

## Cómo encaja con lo demás

Es el mismo patrón que las tazas y las chapas, que ya tienen su propio
configurador y su propia ruta (`#tazas`, `#chapas`). Lo natural es `#libretas`
con su configurador y su tarjeta en la portada, controlada por su interruptor en
Configuración → Portada, como las otras dos.

Cuando se haga, la tarjeta de la portada ya tiene sitio: `LandingConfig` lleva
`showMugs` y `showBadges`; haría falta un `showNotebooks` al lado.

## Ojo con esto

La papelería online, los recursos imprimibles, los calendarios y las agendas de la
web actual **están fuera de alcance por decisión del usuario** (2026-07-30). Las
libretas son lo único de esa lista que sí se quiere, y para más adelante.
