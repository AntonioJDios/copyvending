import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ADMIN_AUTH_EXPIRED, API_BASE } from '../lib/api';
import { ADMIN_LOGGED_OUT, adminConfigured, adminLogin } from '../lib/adminAuth';
import { adminTokenValid } from '../lib/adminToken';

type GateState = 'loading' | 'open' | 'locked' | 'ok' | 'unconfigured';

/**
 * Gate for the backoffice routes (#admin/#pedidos/#estadisticas).
 *
 * FAILS CLOSED: a server without ADMIN_PASSWORD does not mean "open", it means
 * the backoffice is unavailable until the owner configures it. The only case
 * that needs no password is running with no backend at all (local demo: there is
 * no shared data to protect).
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('loading');
  const [expired, setExpired] = useState(false);

  // The stored token carries only its expiry, so we can't verify its signature
  // here. If the server rejects it (401), lib/api drops it and fires this event:
  // go back to the password form instead of showing a panel that can't load.
  useEffect(() => {
    const onExpired = () => {
      setExpired(true);
      setState('locked');
    };
    // Deliberate logout: same destination (the password form), different reason,
    // so we don't tell the user their session "expired" when they clicked Salir.
    const onLoggedOut = () => {
      setExpired(false);
      setState('locked');
    };
    window.addEventListener(ADMIN_AUTH_EXPIRED, onExpired);
    window.addEventListener(ADMIN_LOGGED_OUT, onLoggedOut);
    return () => {
      window.removeEventListener(ADMIN_AUTH_EXPIRED, onExpired);
      window.removeEventListener(ADMIN_LOGGED_OUT, onLoggedOut);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!API_BASE) {
        if (alive) setState('open'); // local demo, nothing shared to protect
        return;
      }
      const configured = await adminConfigured();
      if (!alive) return;
      if (!configured) setState('unconfigured');
      else setState(adminTokenValid() ? 'ok' : 'locked');
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state === 'loading') return <div style={{ padding: 24 }}>Cargando…</div>;
  if (state === 'open' || state === 'ok') return <>{children}</>;
  if (state === 'unconfigured')
    return (
      <div className="admin-login">
        <div className="admin-login-card">
          <h1>🔒 Administración no disponible</h1>
          <p className="muted">
            Falta configurar la contraseña del backoffice en el servidor (variable <code>ADMIN_PASSWORD</code>).
            Hasta entonces el panel permanece cerrado.
          </p>
          <a className="muted admin-login-back" href="/">
            ← Volver a la tienda
          </a>
        </div>
      </div>
    );
  return <AdminLogin expired={expired} onOk={() => { setExpired(false); setState('ok'); }} />;
}

function AdminLogin({ onOk, expired = false }: { onOk: () => void; expired?: boolean }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await adminLogin(password);
      onOk();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo entrar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-login">
      <form className="admin-login-card" onSubmit={submit}>
        <h1>🔒 Administración</h1>
        <p className="muted">
          {expired
            ? 'Tu sesión ya no es válida (caducó o cambió la clave del servidor). Vuelve a introducir la contraseña.'
            : 'Introduce la contraseña del backoffice.'}
        </p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err && <p className="admin-login-err">{err}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <a className="muted admin-login-back" href="/">
          ← Volver a la tienda
        </a>
      </form>
    </div>
  );
}
