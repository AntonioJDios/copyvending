import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Two entry points, same app, different "source":
//  - index.html    → Web (source: online), la web pública + QR.
//  - papeleria.html → Papelería (source: mostrador), la tablet de la tienda.
// (Email es server-side; no tiene HTML.)
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        papeleria: fileURLToPath(new URL('./papeleria.html', import.meta.url)),
      },
    },
  },
})
