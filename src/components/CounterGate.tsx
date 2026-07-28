import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { API_BASE } from '../lib/api';
import { counterConfigured, counterLogin } from '../lib/adminAuth';
import { counterTokenValid } from '../lib/counterToken';

type GateState = 'loading' | 'open' | 'locked' | 'ok' | 'unconfigured';

/**
 * Gate for the counter front (/papeleria.html).
 *
 * Why it exists: that page is served publicly like any other, and it is the one
 * that uses the counter price list. Without proof that the device really is the
 * shop's, anyone could open it and buy at counter prices. Pairing the tablet once
 * gives it a long-lived counter token, which the server checks before applying
 * the counter tariff (see the source derivation in /api/orders).
 */
export function CounterGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('loading');

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!API_BASE) {
        if (alive) setState('open'); // local demo: no shared prices, nothing to abuse
        return;
      }
      if (counterTokenValid()) {
        if (alive) setState('ok');
        return;
      }
      const configured = await counterConfigured();
      if (!alive) return;
      setState(configured ? 'locked' : 'unconfigured');
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
          <h1>🏪 Mostrador no configurado</h1>
          <p className="muted">
            Falta la contraseña del mostrador en el servidor (variable <code>COUNTER_PASSWORD</code>). Configúrala
            para poder usar esta tablet con los precios de papelería.
          </p>
          <a className="muted admin-login-back" href="/">
            ← Ir a la tienda web
          </a>
        </div>
      </div>
    );
  return <CounterLogin onOk={() => setState('ok')} />;
}

function CounterLogin({ onOk }: { onOk: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await counterLogin(password);
      onOk();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo activar el mostrador.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-login">
      <form className="admin-login-card" onSubmit={submit}>
        <h1>🏪 Activar mostrador</h1>
        <p className="muted">
          Introduce la contraseña del mostrador para vincular esta tablet a la papelería. Solo hay que hacerlo una vez
          por dispositivo.
        </p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Contraseña del mostrador"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err && <p className="admin-login-err">{err}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || !password}>
          {busy ? 'Activando…' : 'Activar'}
        </button>
        <a className="muted admin-login-back" href="/">
          ← Ir a la tienda web
        </a>
      </form>
    </div>
  );
}
