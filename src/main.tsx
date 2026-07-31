import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './landing-oscura.css'
import App from './App.tsx'
import { startRouter } from './lib/router'

// Antes de pintar: traduce los enlaces viejos con `#` (hay correos ya enviados con
// ellos) y hace que los clics internos no recarguen la página.
startRouter()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
