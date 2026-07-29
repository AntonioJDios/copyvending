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

## Puesta en marcha con Brevo

1. Cuenta gratuita en [Brevo](https://www.brevo.com) (300 correos/día).
2. Verifica el **dominio** (`Domains → Add a domain`, ver más abajo). Si aún no
   pudieras tocar el DNS, Brevo también permite verificar un **remitente
   individual** (`Senders → Add a sender`) y arrancar sin dominio.
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

## Alternativa: usar el correo del dominio que ya pagas

Si ya tienes hosting de correo en `fotocopiator.es`, puedes enviar por su SMTP sin
contratar nada:

    SMTP_HOST=smtp.tudominio.es
    SMTP_PORT=587
    SMTP_USER=pedidos@fotocopiator.es
    SMTP_PASSWORD=...
    MAIL_FROM=pedidos@fotocopiator.es
    MAIL_FROM_NAME=Fotocopiator

**A favor:** coste cero adicional, y el dominio ya lo tiene autenticado tu hosting
(SPF/DKIM configurados por ellos), así que la entregabilidad ya es decente.

**En contra, y por eso no es el destino final:**

- Los hostings compartidos tienen **límites de envío** casi siempre no
  documentados (del orden de unos cientos por hora o por día) y, al pasarlos,
  rechazan o bloquean la cuenta.
- **No hay seguimiento de rebotes**: si una confirmación no llega, no te enteras.
- Compartes la **reputación de IP** con el resto de clientes de ese hosting.
- Es el **mismo punto único de fallo** que Gmail, cambiando de proveedor: si el
  volumen transaccional te frena la cuenta, pierdes también tu correo humano.
- **No funciona en Cloudflare Workers**, así que habrá que cambiarlo en la
  migración de todas formas.

Buen paso intermedio si no quieres añadir un proveedor ahora. Cuando el volumen
crezca (o al migrar), pasas a Brevo o SES cambiando variables de entorno.

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

El buzón del que se leen los pedidos ya es **configurable** (no solo Gmail):

    IMAP_HOST=imap.tudominio.es
    IMAP_PORT=993
    IMAP_USER=pedidos@fotocopiator.es
    IMAP_PASSWORD=...

Así los clientes escriben a una dirección de tu dominio y desaparece la dependencia
de una cuenta de Google. Lo que sigue pendiente es que **IMAP no funciona en
Cloudflare Workers**: al migrar habrá que sustituir el sondeo del buzón por un
webhook de entrada (Cloudflare Email Routing, o el inbound de Brevo).

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
