import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { API_BASE } from '../lib/api';
import { adminConfigured, adminLogin } from '../lib/adminAuth';
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
          <a className="muted admin-login-back" href="#">
            ← Volver a la tienda
          </a>
        </div>
      </div>
    );
  return <AdminLogin onOk={() => setState('ok')} />;
}

function AdminLogin({ onOk }: { onOk: () => void }) {
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
        <p className="muted">Introduce la contraseña del backoffice.</p>
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
        <a className="muted admin-login-back" href="#">
          ← Volver a la tienda
        </a>
      </form>
    </div>
  );
}
