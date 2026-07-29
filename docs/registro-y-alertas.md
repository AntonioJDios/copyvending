# Registro y alertas

## Por qué existe

Hasta ahora todo se escribía con `console.error`, que en este plan de hosting
significa: se ve solo desde el panel de Vercel y desaparece en una hora. Eso tuvo
dos consecuencias reales el mismo día:

- el barrido de archivos huérfanos llevaba horas fallando (la tabla `files` no
  existía todavía) y **nadie podía saberlo**;
- tres errores 500 distintos solo se pudieron diagnosticar leyendo los logs del
  despliegue, porque al navegador llegaba «Error del servidor» sin más.

El registro lo arregla por los dos lados: queda guardado en la base de datos, la
copistería lo ve en su panel, y si es un error además recibe un correo.

## Cómo se ve

**Configuración → Registro.** Cuatro pestañas (Todo / Errores / Avisos /
Actividad) con el contador real de cada nivel sobre todo el histórico, no sobre lo
que haya en pantalla. Cada línea trae la hora, de dónde viene, la frase en
castellano y —si el evento es de un pedido— un enlace que abre la lista de pedidos
ya buscando ese pedido. El detalle técnico va plegado detrás de «Detalle».

La tarjeta del dashboard de Configuración muestra «3 errores» y se pone en rojo
cuando hay alguno: un registro que hay que abrir para saber que pasa algo no sirve
de nada.

El botón **Vaciar** borra el registro. Es diagnóstico, no datos del negocio: se
puede vaciar sin miedo, no toca los pedidos.

## Qué se registra

| Apartado | Qué queda |
| --- | --- |
| `pedidos` | cualquier error 500, con el mensaje real y la traza |
| `email` | confirmación, aviso de envío o «listo para recoger» que no salieron |
| `cobros` | notificación de Redsys con firma inválida, importe que no cuadra, o error procesándola |
| `buzon` | un correo que no se pudo convertir en pedido |
| `acceso` | el correo con el código de acceso no salió (el cliente no puede entrar) |
| `archivos` | una subida que no se pudo registrar (quedaría sin control en R2) |
| `limpieza` | cada barrido: cuántos archivos borró, y si alguno falló |
| `precios` | el total del cliente no coincide con el calculado en el servidor |
| `catalogo` | la tienda se quedó sin catálogo y no puede calcular precios |

Los rechazos normales del banco («denegada») se registran como actividad, no como
error: son parte del día a día y no deben hacer sonar la alarma.

## Las alertas

Se manda un correo a `ALERT_EMAIL` cuando aparece un **error** (los avisos y la
actividad no molestan a nadie). **Como máximo uno por apartado y hora:** si el
proveedor de correo se cae una tarde, llega un aviso, no doscientos.

Sin `ALERT_EMAIL` definida todo sigue registrándose; simplemente no se avisa.

### El detalle de por qué no todas avisan al instante

El transporte de correo vive en `api/orders.ts`. Las demás funciones
(`redsys-notify`, `presign`, `ingest-email`, `customers`, `auth`) **solo escriben
la fila**, con `alerted = false`, y `api/orders.ts` las envía agrupadas en un
único correo desde `flushPendingAlerts()`.

Es a propósito. Duplicar el envío de correo en seis funciones es exactamente lo
que hizo que el esquema de la base de datos acabara repartido por medio código y
provocó dos caídas. El disparador es la lista de pedidos, que la tablet del
mostrador consulta cada 15 segundos: en la práctica es un latido durante todo el
horario comercial. Si el panel está cerrado, el aviso sale la próxima vez que se
abra.

**Consecuencia a tener en cuenta:** un problema de cobro fuera del horario de
apertura se avisa cuando se abre el panel, no en ese momento. Si algún día hace
falta que sea inmediato, la solución no es duplicar el envío: es sacar `logEvent`,
`sendEmail` y `rateLimit` a un módulo compartido fuera de `api/` (Vercel lo
empaqueta con cada función y no cuenta para el límite de 12), que es el
refactor que este código está pidiendo desde hace tiempo.

## Lo que sigue pendiente

- El mismo módulo compartido resolvería también el `ensureSchema` repartido: hoy
  la tabla `events` se declara **idéntica en seis sitios** porque cualquier
  función que escriba en una tabla tiene que ser capaz de crearla. Funciona, pero
  la forma correcta son migraciones SQL versionadas.
- `tests/sqlParams.test.ts` vigila el otro fallo repetido (el `::bigint` que
  faltaba). Es un test que lee el código fuente: si algún día molesta, lo que hay
  que arreglar es el código, no el test.
