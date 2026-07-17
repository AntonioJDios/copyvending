# Subida de ficheros con Cloudflare R2 — guía completa

Sistema de subida real y multi-dispositivo (tablet, móvil con QR, web) para copyvending.
Los ficheros van directos del navegador a **Cloudflare R2** (almacenamiento de objetos,
sin coste de salida). Un **Worker** firma URLs temporales; los bytes nunca pasan por él,
así que no hay límite de tamaño por el Worker.

```
Navegador  ──(1) pide URL firmada──▶  Worker (Cloudflare)
    │                                      │
    │  ◀──────── URL temporal ─────────────┘
    │
    └──(2) PUT del fichero directo────▶  Bucket R2
```

---

## Estado actual (ya configurado)

| Cosa | Valor |
|---|---|
| Bucket R2 | `copyvending` |
| Account ID | `5e9102f62162d87f67622085dc6528b3` |
| Worker desplegado | `https://copyvending-uploads.copyvending.workers.dev` |
| Frontend (Vercel) | `https://copyvending.vercel.app` |
| Dev local | `http://localhost:8124` |

Archivos del código (ya hechos):
- `worker/index.ts` — Worker que firma las subidas/descargas/borrados.
- `wrangler.toml` — config del Worker (bucket, account, binding R2).
- `src/lib/uploads/r2UploadService.ts` — adaptador que habla con el Worker.
- `src/lib/uploads/localUploadService.ts` — adaptador local (IndexedDB) para demo sin backend.
- `src/lib/uploads/index.ts` — elige uno u otro según `VITE_UPLOAD_API`.
- `.env.local` — apunta a la URL del Worker en desarrollo.

---

## Cómo se montó (referencia / para rehacerlo)

### 1. Crear el token de R2
Cloudflare → **R2** → **Manage R2 API Tokens** → crear token con permiso de
**lectura y escritura** sobre el bucket `copyvending`. Te da 4 valores:

| Valor | ¿Se usa? |
|---|---|
| **Token value** | ❌ No (es para la S3 API con firma propia; aquí no). |
| **Endpoint / S3 API** | ❌ Ya está en `wrangler.toml`, no se toca. |
| **Access Key ID** | ✅ Sí → secreto del Worker. |
| **Secret Access Key** | ✅ Sí → secreto del Worker (solo se muestra una vez, cópialo ya). |

> Los dos valores ✅ **no van a ningún archivo del repo**. Se guardan como secretos del
> Worker con los comandos de abajo. Nunca en Vercel ni en el código (las `VITE_` son públicas).

### 2. Login, secretos y deploy (terminal, dentro de `copisteria-web`)
```bash
npx wrangler login
```
- Se abre el navegador → entra en la **misma cuenta del bucket** (si fue con Gmail, con Gmail).
- Pulsa **Allow**. Verás *"wrangler-oauth-consent-granted"* → fue bien.
- Si dice *"la web no es segura"*, es normal (dirección local de tu equipo).

```bash
npx wrangler secret put R2_ACCESS_KEY_ID      # pega el Access Key ID
npx wrangler secret put R2_SECRET_ACCESS_KEY  # pega el Secret Access Key
npx wrangler deploy                            # imprime la URL del Worker
```

### 3. CORS del bucket (permite subir desde el navegador)
Cloudflare → **R2** → bucket `copyvending` → **Settings** → **CORS Policy** →
**Add CORS policy / Edit** → pega y **Save**:

```json
[
  {
    "AllowedOrigins": ["https://copyvending.vercel.app", "http://localhost:8124"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"]
  }
]
```
- Debe ser un **array** `[ { … } ]`.
- JSON puro: sin comentarios, sin comas finales, comillas rectas `"`.
- Cuando tengas dominio propio, añade su origen a la lista.

### 4. Borrado automático a las 72 h (opcional, carritos abandonados)
Cloudflare → R2 → bucket `copyvending` → **Settings** → **Object lifecycle rules** →
nueva regla: **eliminar** objetos con prefijo `jobs/` **a los 3 días**.

### 5. Variable de entorno en Vercel  ⚠️ paso que se olvida
Vercel → proyecto **copyvending** → **Settings** → **Environment Variables** → añade:

| Campo | Valor |
|---|---|
| **Key** | `VITE_UPLOAD_API` |
| **Value** | `https://copyvending-uploads.copyvending.workers.dev` |
| **Environments** | Production, Preview y Development |

→ **Save**, y **muy importante**: Vercel **no** la aplica a lo ya desplegado.
Ve a **Deployments** → último deploy → **⋯** → **Redeploy**. Al reconstruir, Vite
incrusta la URL en el bundle y la app empieza a subir a R2.

- Con `VITE_UPLOAD_API` puesta → sube a **R2** (real, multi-dispositivo / QR).
- Sin ella → adaptador **local (IndexedDB)** (demo por navegador).

### 6. Desarrollo local
El archivo `.env.local` ya apunta al Worker:
```
VITE_UPLOAD_API=https://copyvending-uploads.copyvending.workers.dev
```
```bash
npm run dev
```

---

## Probar que funciona (end-to-end)

1. Entra en `https://copyvending.vercel.app` (o en local) y sube un PDF/imagen.
2. Cloudflare → **R2 → copyvending → Objects**: debe aparecer un objeto nuevo bajo
   **`jobs/…`**. Si aparece → ✅ la subida real a R2 funciona.
3. El backoffice (`#pedidos`) descarga el ZIP con los ficheros reales.

---

## Si algo falla (consola del navegador → F12)

| Síntoma | Causa | Solución |
|---|---|---|
| Error **CORS** al subir | Origen mal en la CORS policy | Revisa el paso 3 (origen exacto, con https, sin barra final). |
| **403** al subir/firmar | Secretos del Worker no coinciden con el token | Repite el paso 2 (`wrangler secret put`). |
| No sube y **no hay error** | Falta la variable o el redeploy en Vercel | Paso 5: añade `VITE_UPLOAD_API` y **Redeploy**. |
| `net::ERR` / URL rara | `VITE_UPLOAD_API` con barra final o mal escrita | Sin `/` al final. |

---

## Notas de seguridad (ya contempladas en el código)
- La **clave del fichero la genera el servidor con un UUID** (`jobs/<uuid>`), nunca con
  el nombre del cliente → sin *path traversal* (el bug del PHP viejo).
- Las URLs prefirmadas **caducan en 1 hora**.
- Secretos R2 **solo** en el Worker (`wrangler secret put`), nunca en Vercel ni en el
  repo — las variables `VITE_` acaban en el bundle público del cliente.
- El precio se calcula en el cliente y **es manipulable** → habrá que **revalidarlo en
  el servidor** antes de cobrar (pendiente para el backend de pedidos online).

---

## Pendiente / siguiente paso
- Los **pedidos y el catálogo siguen en `localStorage`** (por navegador), así que el
  backoffice todavía **no** ve pedidos de otros dispositivos. Para que un pedido hecho
  desde el móvil aparezca en la tablet de la tienda hay que mover los pedidos a una BD
  compartida → recomendado **Cloudflare D1** (SQLite gestionado, plan gratis generoso).
