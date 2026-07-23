# Plan — Despliegue en Cloudflare (cliente real, desde cero)

> Este repo (prototipo en Vercel) es la referencia. Para el cliente real se
> monta un proyecto **nuevo en Cloudflare**, reutilizando **todo** el código de
> dominio y de UI, y reescribiendo solo la "cáscara" del backend.
>
> Motivos: el free tier de Cloudflare **permite uso comercial** (el Hobby de
> Vercel no), **R2 ya está en Cloudflare**, y no hay el límite molesto de deploys.

---

## 1. Arquitectura objetivo

| Pieza | En Cloudflare | Notas |
|---|---|---|
| Frontend | **Pages** (build Vite estático) | `src/` tal cual, sin cambios |
| Backend | **Pages Functions** o un **Worker** con **Hono** (router) | activar `nodejs_compat` |
| Base de datos | **Neon** (Postgres por HTTP) — igual que ahora | (opción futura: D1) |
| Ficheros | **R2 con binding nativo** (`env.BUCKET`) | sin claves S3 ni `aws4fetch` |
| IA | Groq/LLM por `fetch` | igual |
| Email saliente | **Resend / MailChannels (HTTP)** | ⚠️ NO `nodemailer` (SMTP no va en Workers) |
| Email entrante (pedidos) | **Email Routing + Email Worker** (push) | ⚠️ NO IMAP (`imapflow` no va en Workers) |
| Pagos (Redsys) | **Worker** (HTTPS + firma) | 3DES/HMAC con `nodejs_compat` o librería |

**Los ficheros ya se suben directos a R2** (presigned URL); eso no cambia.

---

## 2. Mapa de funciones (este repo → Cloudflare)

Portar casi tal cual (solo `fetch`/Neon/crypto → cambia la firma del handler):
- `orders`, `catalog`, `presign`, `assistant`, `plan`, `suggest`, `transcribe`

Cambian solo el **envío de email** (SMTP → HTTP):
- `customers` (email de bienvenida), `auth` (enlace/código de acceso)

Reescritura real:
- `ingest-email` → **Email Worker** (el correo entrante empuja al Worker; `mailparser` es JS y sirve, `imapflow` desaparece porque ya no "leemos" el buzón)

---

## 3. Cambios de código concretos

- **Handlers**: de `export default (req: VercelRequest, res: VercelResponse)` a
  Pages Functions (`export const onRequestPost = ({ request, env }) => Response`)
  o, recomendado, **un Worker con [Hono]** para enrutar cómodo y parecido a hoy.
- **Regla nueva**: en Cloudflare **sí** puedes compartir código entre rutas
  (no existe la limitación de "funciones autocontenidas" de Vercel) → se elimina
  la duplicación del motor de precios y helpers.
- **DB**: `@neondatabase/serverless` funciona igual; `DATABASE_URL` como secret.
- **R2**: `env.BUCKET.put/get/delete`. Para subida directa desde el navegador,
  presigned URL con la API S3-compat de R2 (o subir por el Worker si son
  pequeños). Adiós a las claves S3 en variables.
- **Email**: un helper `sendEmail(to, subject, body)` que llama a Resend.
  Sustituye 3 usos: bienvenida (`customers`), acceso (`auth`), respuesta (ingesta).
- **Env/secrets** (wrangler): `DATABASE_URL`, binding `BUCKET`, `LLM_API_KEY` /
  `LLM_BASE_URL` / `LLM_MODEL` / `STT_MODEL`, `RESEND_API_KEY`, `MAIL_FROM`,
  `PUBLIC_URL`, `SHOP_NAME`, y (Redsys) `REDSYS_CODE` / `REDSYS_TERMINAL` /
  `REDSYS_SECRET` / `REDSYS_ENV`.

---

## 4. Orden de construcción (fases)

1. **Pages (frontend)** — subir el build de Vite. Ya funciona la tienda; quita el
   límite de deploys desde el minuto uno.
2. **Backend "fácil"** — Worker con Hono + `nodejs_compat`: portar `orders`,
   `catalog`, `presign` (con binding R2), `assistant`, `plan`, `suggest`,
   `transcribe`. Conectar Neon. Con esto la tienda funciona entera salvo email.
3. **Email saliente (HTTP)** — helper `sendEmail` con Resend + verificar dominio
   (SPF/DKIM/DMARC). Enganchar bienvenida y acceso (`customers`, `auth`).
4. **Ingesta por email** — Email Routing del dominio → Email Worker que parsea,
   sube adjuntos a R2 y crea el pedido (reemplaza `ingest-email`/IMAP).
5. **Pagos (Redsys)** — Worker con init + webhook de notificación; marcar el
   pedido pagado en Neon. Habilita el envío (que exige pago previo).
6. **Dominio propio** — DNS en Cloudflare, registros de email, rutas
   (`/api/*` → Worker, resto → Pages) para quedar todo en el mismo origen.

---

## 5. Datos y arranque

- **Catálogo**: exportar el JSON actual (`settings.catalog`) y sembrarlo en el
  nuevo proyecto.
- **Clientes**: importar de PrestaShop (passwordless → solo nombre/email/tel;
  sin migrar contraseñas).
- **Pedidos**: al ser cliente nuevo desde cero, no hay histórico que migrar.
- **Antes de producción**: rellenar en el panel los **datos del negocio**
  (nombre/NIF/dirección/email) y revisar la **política de privacidad**.

---

## 6. Decisiones a tomar

- **Neon vs D1**: Neon al principio (menos cambios, Postgres conocido); D1
  (SQLite de Cloudflare) si se quiere 100% Cloudflare más adelante.
- **Resend vs MailChannels** para email saliente.
- **Pages Functions vs Worker+Hono**: recomendado Worker + Hono (un router,
  código compartido, secrets claros).

---

## 7. Qué se reutiliza SIN cambios de lógica

- Todo `src/domain/` (precios, reglas, catálogo, orderSpec), componentes React,
  stores, y libs de cliente (`pdf`, `downloadZip`, `invoicePdf`, `shipping`,
  `stats`, `analyzePdf`…). El dominio no cambia.
- La lógica de negocio de los endpoints (recálculo de precios, envío, factura) se
  **copia**; solo cambia la cáscara (handler + servicios de email/ingesta).

[Hono]: https://hono.dev
