# Backend de copyvending (Vercel + Neon + R2)

Todo lo compartido entre dispositivos vive detrás de **funciones serverless en
Vercel** (`/api`), en el **mismo dominio verde** que la web. Así ni el firewall
de empresa (que bloquea `workers.dev`) ni la falta de un dominio propio impiden
usarlo: el navegador solo habla con `copyvending.vercel.app` y con
`r2.cloudflarestorage.com`.

```
navegador ─▶ /api/presign   ─▶ firma            ─▶ R2   (ficheros + artwork)
navegador ─▶ /api/orders     ─▶ Neon (Postgres)         (pedidos)
navegador ─▶ /api/catalog    ─▶ Neon (Postgres)         (ajustes del admin)
navegador ─▶ r2.cloudflarestorage.com                   (subida/bajada directa)
```

## Qué se persiste y dónde
| Dato | Dónde |
|---|---|
| Ficheros de impresión (copias) | **R2** — `jobs/<idProyecto>/<uuid>.<ext>` |
| Artwork de producto (taza/chapa) | **R2** (el pedido guarda solo la clave) |
| Pedidos (config completa, cliente, estado) | **Neon** tabla `orders` |
| Ajustes del admin (catálogo/precios) | **Neon** tabla `settings` |
| Miniaturas de display | pequeñas, dentro del pedido (JSON) |

Las tablas se crean solas la primera vez (`create table if not exists`).

## Endpoints (`/api`)
- `POST /api/presign` — `{op:'put'|'get'|'delete', ...}` → URL firmada de R2.
  La clave la genera el servidor con UUID; el nombre del cliente nunca es la ruta.
- `GET/POST/PATCH/DELETE /api/orders` — CRUD de pedidos.
- `GET/PUT /api/catalog` — leer/guardar el catálogo compartido.

## Variables de entorno en Vercel
Vercel → proyecto **copyvending** → **Settings → Environment Variables**
(Production, Preview y Development):

| Nombre | Valor | Notas |
|---|---|---|
| `VITE_API_BASE` | `/api` | **Pública** (va al cliente). Enciende el modo backend. |
| `R2_ACCESS_KEY_ID` | *(secreto del token R2)* | **Solo servidor.** Sin prefijo VITE_. |
| `R2_SECRET_ACCESS_KEY` | *(secreto del token R2)* | **Solo servidor.** |
| `R2_ACCOUNT_ID` | `5e9102f62162d87f67622085dc6528b3` | Opcional (ya es el valor por defecto). |
| `R2_BUCKET` | `copyvending` | Opcional (por defecto). |
| `DATABASE_URL` | *(la pone la integración de Neon)* | Ya creada al añadir Neon. |

> ⚠️ Si tenías `VITE_UPLOAD_API` apuntando a `workers.dev`, **cámbiala o bórrala**
> (usa `VITE_API_BASE=/api`). `workers.dev` está bloqueado en redes filtradas.

Tras guardar variables → **Deployments → ⋯ → Redeploy** (Vite las incrusta al construir).

## CORS del bucket R2 (subida directa desde el navegador)
Cloudflare → R2 → bucket `copyvending` → **Settings → CORS Policy**:
```json
[
  {
    "AllowedOrigins": ["https://copyvending.vercel.app", "http://localhost:8124"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"]
  }
]
```

## Base de datos (Neon)
Se creó desde Vercel → **Storage → Neon**. Eso añadió solo las variables
(`DATABASE_URL`, etc.). No hay que crear tablas a mano: las funciones las crean
al primer uso.

## Desarrollo local
`npm run dev` (vite) **no** sirve `/api`, así que en local el modo es local
(IndexedDB + localStorage). El sistema real corre en Vercel. Para probar el
backend en local: `vercel dev` + `VITE_API_BASE=/api`.

## Probar (multi-navegador)
1. Abre `copyvending.vercel.app` en el **navegador A**, sube documentos y confirma un pedido.
2. Abre `copyvending.vercel.app/#pedidos` en el **navegador B** → aparece el pedido
   con toda la config, y **⬇ Descargar (ZIP)** trae los ficheros reales desde R2.
3. En R2 → Objects verás `jobs/<idProyecto>/…`.

## Seguridad (ya contemplado)
- Clave de fichero server-side con UUID → sin *path traversal*.
- Secretos R2 solo en el servidor (nunca `VITE_`, nunca en el repo).
- URLs firmadas caducan en 1 h.
- El precio se calcula en cliente → **revalidar en servidor antes de cobrar**
  (pendiente para el pago online).

## Nota
El Worker de Cloudflare (`worker/`, `wrangler.toml`) y `SETUP-CLOUDFLARE.md`
quedan como **legado**; el backend activo es el de Vercel (`/api`).
