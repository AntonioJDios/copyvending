# Email transaccional

El código ya no depende de Gmail: hay un único helper `sendEmail()` que envía por
**HTTP** contra Brevo o Resend, y solo cae a Gmail SMTP si no configuras nada.

Se envían 6 correos: confirmación de pedido web, "listo para recoger", "va en
camino", enlace/código de acceso a la cuenta, bienvenida al crear cuenta, y la
respuesta al pedido recibido por email.

## Por qué se cambia (y no es opcional a medio plazo)

- Gmail firma como Gmail, **no como tu dominio** → sin SPF/DKIM propios, las
  confirmaciones acaban en spam o en "Promociones".
- Tope de ~**500 destinatarios/día** en cuentas gratuitas. Pasarte no da un error:
  Google frena o bloquea la cuenta, y con ella todo el correo de la tienda.
- Los términos de Gmail no contemplan usarlo como relé transaccional de un servicio.
- **SMTP no funciona en Cloudflare Workers**, así que había que cambiarlo igual.

## Puesta en marcha SIN dominio todavía

Se puede dejar funcionando hoy, contra clientes reales, y cambiar al dominio
después **sin tocar código** (solo variables de entorno).

1. Cuenta gratuita en [Brevo](https://www.brevo.com) (300 correos/día).
2. **Senders → Add a sender**: pon el email actual de la tienda (el Gmail sirve) y
   valida el enlace que te llega. Brevo permite verificar un **remitente
   individual** sin poseer un dominio.
3. **SMTP & API → API Keys** → crea una clave.
4. En Vercel → Settings → Environment Variables:

   | Variable | Valor |
   |---|---|
   | `MAIL_PROVIDER` | `brevo` |
   | `MAIL_API_KEY` | la clave de Brevo |
   | `MAIL_FROM` | el remitente verificado |
   | `MAIL_FROM_NAME` | nombre que verá el cliente, p. ej. `Fotocopiator` |
   | `MAIL_REPLY_TO` | (opcional) buzón que lee una persona |

5. **Redeploy** y prueba: crea una cuenta en la tienda (llega el email de
   bienvenida) y pide el enlace de acceso.

Con esto ya no hay tope de 500/día ni riesgo de bloqueo de la cuenta de Google, y
tienes registro de entregas y rebotes en el panel de Brevo. Lo que **todavía no**
tienes es autenticación con tu dominio: la entregabilidad mejora, pero no es la
definitiva.

## Cuando tengas el dominio (fotocopiator.es)

⚠️ **Esto se puede hacer con la web antigua funcionando**: los registros de email
son TXT/CNAME y **no tocan** los registros A/CNAME que apuntan la web. Cero
downtime y cero riesgo para el sitio actual.

1. Brevo → **Domains → Add a domain** → te da 3-4 registros DNS.
2. Añádelos en el DNS de `fotocopiator.es`:
   - **DKIM** (CNAME o TXT): firma los correos.
   - **SPF** (TXT): autoriza a Brevo a enviar por ti.
   - **DMARC** (TXT): empieza por `v=DMARC1; p=none; rua=mailto:…` para observar
     antes de endurecer.
3. ⚠️ **Cuidado con SPF si la web antigua también envía correo desde ese dominio.**
   Solo puede existir **un** registro SPF: hay que combinar los dos en uno
   (`v=spf1 include:spf.brevo.com include:<lo-que-ya-hubiera> ~all`), no añadir un
   segundo. Si pones dos, fallan los dos.
4. Cambia en Vercel `MAIL_FROM` a `pedidos@fotocopiator.es` y redeploy.
5. Cuando lleves unas semanas sin fallos de DMARC, sube la política a
   `p=quarantine` y luego `p=reject`.

## Entrada de pedidos por email (pendiente)

La lectura del buzón sigue siendo **IMAP contra Gmail** (`api/ingest-email.ts`), y
eso no sobrevive a Cloudflare Workers. Cuando migremos se sustituye por un webhook
de entrada (Cloudflare Email Routing, o el inbound de Brevo). No es urgente: lo
que se envía ya está resuelto; esto es solo lo que se recibe.

## Detalles de implementación

- El helper está **duplicado** en `api/orders.ts`, `api/auth.ts`,
  `api/customers.ts` y `api/ingest-email.ts` porque las funciones de Vercel deben
  ser autocontenidas. Con Cloudflare pasa a ser un módulo único.
- `sendEmail()` **lanza** el error en lugar de tragárselo, y cada llamada lo
  registra con `console.error`, así los fallos se ven en los logs de Vercel. Antes
  un email fallido desaparecía sin rastro.
- Los correos son texto plano a propósito: llegan mejor y no hay plantillas HTML
  que mantener.
- El único que necesita cabeceras especiales es la respuesta a un pedido por email
  (`In-Reply-To` / `References`), para que caiga en el hilo del cliente.
