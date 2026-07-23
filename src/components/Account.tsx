import { useEffect, useState } from 'react';
import { useAuth, type MyOrder } from '../store/useAuth';
import { hasBackend } from '../lib/api';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const STATUS_LABEL: Record<string, string> = {
  nuevo: 'Recibido',
  en_proceso: 'En proceso',
  listo: 'Listo para recoger',
  entregado: 'Entregado',
};

/** Customer account area: passwordless access by email (magic link), "my orders"
 *  and account erasure (RGPD right to be forgotten). Routes: #cuenta / #acceder/<token>. */
export function Account() {
  const { customer, requestLink, verify, restore, logout, deleteAccount, fetchMyOrders } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [orders, setOrders] = useState<MyOrder[] | null>(null);

  // On mount: verify the magic link if we arrived via #acceder/<token>, else
  // restore any existing session.
  useEffect(() => {
    const m = window.location.hash.match(/#acceder\/(.+)$/);
    if (m) {
      setVerifying(true);
      verify(decodeURIComponent(m[1]).trim())
        .then(() => {
          window.location.hash = 'cuenta';
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Enlace no válido o caducado'))
        .finally(() => setVerifying(false));
    } else {
      void restore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (customer) fetchMyOrders().then(setOrders).catch(() => setOrders([]));
  }, [customer, fetchMyOrders]);

  const onRequest = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await requestLink(email.trim());
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar el enlace.');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!window.confirm('¿Seguro que quieres borrar tu cuenta y todos tus datos personales? Esta acción no se puede deshacer.')) return;
    try {
      await deleteAccount();
      alert('Tu cuenta y tus datos personales se han eliminado.');
      window.location.hash = '';
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo borrar la cuenta.');
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>Mi cuenta</h1>
        <nav className="topnav">
          {customer && (
            <button type="button" className="btn" onClick={() => void logout()}>
              Cerrar sesión
            </button>
          )}
          <a className="btn" href="#">← Tienda</a>
        </nav>
      </header>

      <div className="recover">
        {!hasBackend ? (
          <section className="checkout-card">
            <p className="muted">Las cuentas requieren conexión con el servidor. En modo local no están disponibles.</p>
          </section>
        ) : verifying ? (
          <section className="checkout-card">
            <p className="muted">Accediendo a tu cuenta…</p>
          </section>
        ) : customer ? (
          <>
            <section className="checkout-card">
              <h2>Hola, {customer.nombre} 👋</h2>
              <p className="muted">
                {customer.nombre} {customer.apellidos} · {customer.email}
                {customer.telefono ? ` · ${customer.telefono}` : ''}
              </p>
            </section>

            <section className="checkout-card">
              <h2>Mis pedidos</h2>
              {orders === null ? (
                <p className="muted">Cargando…</p>
              ) : orders.length === 0 ? (
                <p className="muted">Aún no tienes pedidos.</p>
              ) : (
                <ul className="account-orders">
                  {orders.map((o) => (
                    <li key={o.id}>
                      <a href={`#recoger/${o.id}`} className="account-order-id">{o.id}</a>
                      <span className={`status-pill st-${o.status}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
                      <span className="muted">{new Date(o.createdAt).toLocaleDateString('es-ES')}</span>
                      <strong>{eur(o.total)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="checkout-card account-danger">
              <h2>Borrar mi cuenta</h2>
              <p className="muted">
                Ejerce tu <b>derecho al olvido</b>: eliminamos tu cuenta y tus datos personales. Los pedidos ya
                realizados se conservan de forma <b>anónima</b> por obligaciones fiscales, sin datos que te identifiquen.
              </p>
              <button type="button" className="btn btn-danger" onClick={onDelete}>
                Borrar mi cuenta y mis datos
              </button>
            </section>
          </>
        ) : (
          <section className="checkout-card">
            <h2>Accede a tu cuenta</h2>
            {sent ? (
              <p className="recover-ready">
                📧 Si hay una cuenta con <b>{email.trim()}</b>, te hemos enviado un enlace de acceso. Revisa tu correo
                (caduca en 30 minutos).
              </p>
            ) : (
              <>
                <p className="muted">Sin contraseñas: escribe tu email y te enviamos un enlace para entrar.</p>
                <div className="recover-form">
                  <input
                    type="email"
                    value={email}
                    autoFocus
                    placeholder="tu@email.com"
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void onRequest();
                    }}
                  />
                  <button type="button" className="btn btn-primary" onClick={() => void onRequest()} disabled={busy || !email.trim()}>
                    {busy ? 'Enviando…' : 'Enviar enlace'}
                  </button>
                </div>
                <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
                  ¿Aún no tienes cuenta? Se crea al tramitar un pedido eligiendo “Crear cuenta”.
                </p>
              </>
            )}
            {error && <p className="recover-error">⚠ {error}</p>}
          </section>
        )}
      </div>
    </div>
  );
}
