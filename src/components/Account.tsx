import { useEffect, useState } from 'react';
import { useAuth, type MyOrder, type Address } from '../store/useAuth';
import { hasBackend } from '../lib/api';
import { registerCustomer } from '../lib/customers';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const STATUS_LABEL: Record<string, string> = {
  nuevo: 'Recibido',
  en_proceso: 'En proceso',
  listo: 'Listo para recoger',
  entregado: 'Entregado',
};

/** Customer account area: passwordless access by email (magic link), "my orders"
 *  and account erasure (RGPD right to be forgotten). Routes: #cuenta / #acceder/<token>. */
export function Account() {
  const { customer, requestLink, verify, restore, logout, deleteAccount, fetchMyOrders, saveAddresses } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [telefono, setTelefono] = useState('');
  const [consent, setConsent] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentKind, setSentKind] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [shipping, setShipping] = useState<Address>({});
  const [billing, setBilling] = useState<Address>({});
  const [billingSame, setBillingSame] = useState(true);
  const [addrBusy, setAddrBusy] = useState(false);
  const [addrSaved, setAddrSaved] = useState(false);

  const registerOk = nombre.trim() && apellidos.trim() && isEmail(email) && telefono.trim().length >= 6 && consent;

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

  // Load the saved addresses into the forms when the account loads.
  useEffect(() => {
    if (customer) {
      setShipping(customer.shipping ?? {});
      setBilling(customer.billing ?? {});
      setBillingSame(customer.billingSame !== false);
    }
  }, [customer]);

  const onSaveAddresses = async () => {
    if (addrBusy) return;
    setAddrBusy(true);
    try {
      const sh = shipping.linea1?.trim() ? shipping : null;
      const bi = billingSame ? sh : billing.linea1?.trim() ? billing : null;
      await saveAddresses(sh, bi, billingSame);
      setAddrSaved(true);
      setTimeout(() => setAddrSaved(false), 2500);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudieron guardar las direcciones.');
    } finally {
      setAddrBusy(false);
    }
  };

  const onRequest = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await requestLink(email.trim());
      setSentKind('login');
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar el enlace.');
    } finally {
      setBusy(false);
    }
  };

  const onRegister = async () => {
    if (!registerOk || busy) return;
    setBusy(true);
    setError('');
    try {
      await registerCustomer({ nombre: nombre.trim(), apellidos: apellidos.trim(), email: email.trim().toLowerCase(), telefono: telefono.trim() });
      // Passwordless: send the access link so they can enter right away.
      await requestLink(email.trim());
      setSentKind('register');
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la cuenta.');
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
              <div className="account-head">
                <div>
                  <h2>Hola, {customer.nombre} 👋</h2>
                  <p className="muted">
                    {customer.nombre} {customer.apellidos} · {customer.email}
                    {customer.telefono ? ` · ${customer.telefono}` : ''}
                  </p>
                </div>
                <button type="button" className="btn" onClick={() => void logout()}>
                  Cerrar sesión
                </button>
              </div>
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

            <section className="checkout-card">
              <h2>Mis direcciones</h2>
              <h3 className="addr-title">📦 Dirección de envío</h3>
              <AddressForm value={shipping} onChange={setShipping} />
              <label className="checkout-consent" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={billingSame} onChange={(e) => setBillingSame(e.target.checked)} />
                <span>Usar la misma dirección para la facturación</span>
              </label>
              {!billingSame && (
                <>
                  <h3 className="addr-title">🧾 Dirección de facturación</h3>
                  <AddressForm value={billing} onChange={setBilling} showNif />
                </>
              )}
              <div className="addr-actions">
                <button type="button" className="btn btn-primary" onClick={() => void onSaveAddresses()} disabled={addrBusy}>
                  {addrBusy ? 'Guardando…' : 'Guardar direcciones'}
                </button>
                {addrSaved && <span className="muted">✓ Guardado</span>}
              </div>
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
            <div className="seg-toggle checkout-mode">
              <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setSent(false); setError(''); }}>
                Entrar
              </button>
              <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setSent(false); setError(''); }}>
                Crear cuenta
              </button>
            </div>

            {sent ? (
              <p className="recover-ready">
                📧 {sentKind === 'register' ? '¡Cuenta creada! ' : ''}
                Te hemos enviado un enlace de acceso a <b>{email.trim()}</b>. Revisa tu correo (caduca en 30 minutos).
              </p>
            ) : mode === 'login' ? (
              <>
                <h2>Accede a tu cuenta</h2>
                <p className="muted">Sin contraseñas: escribe tu email y te enviamos un enlace para entrar.</p>
                <div className="recover-form">
                  <input
                    type="email"
                    value={email}
                    autoFocus
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="tu@email.com"
                    onChange={(e) => setEmail(e.target.value.toLowerCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void onRequest();
                    }}
                  />
                  <button type="button" className="btn btn-primary" onClick={() => void onRequest()} disabled={busy || !email.trim()}>
                    {busy ? 'Enviando…' : 'Enviar enlace'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2>Crear cuenta</h2>
                <p className="muted">Sin contraseñas: creas la cuenta y entras con un enlace que te enviamos por email.</p>
                <div className="checkout-form">
                  <label className="field-block">
                    Nombre *
                    <input type="text" value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} />
                  </label>
                  <label className="field-block">
                    Apellidos *
                    <input type="text" value={apellidos} maxLength={80} onChange={(e) => setApellidos(e.target.value)} />
                  </label>
                  <label className="field-block">
                    Email *
                    <input
                      type="email"
                      value={email}
                      inputMode="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={120}
                      onChange={(e) => setEmail(e.target.value.toLowerCase())}
                    />
                  </label>
                  <label className="field-block">
                    Teléfono *
                    <input type="tel" value={telefono} maxLength={20} onChange={(e) => setTelefono(e.target.value)} />
                  </label>
                </div>
                <label className="checkout-consent">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>
                    He leído y acepto la{' '}
                    <a href="#privacidad" target="_blank" rel="noopener noreferrer">política de privacidad</a> y el tratamiento de mis datos.
                  </span>
                </label>
                <button type="button" className="btn btn-primary checkout-next" onClick={() => void onRegister()} disabled={busy || !registerOk}>
                  {busy ? 'Creando…' : 'Crear cuenta'}
                </button>
              </>
            )}
            {error && <p className="recover-error">⚠ {error}</p>}
          </section>
        )}
      </div>
    </div>
  );
}

/** Simple address form (shipping / billing). NIF only for billing. */
function AddressForm({ value, onChange, showNif }: { value: Address; onChange: (a: Address) => void; showNif?: boolean }) {
  const set = (k: keyof Address, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="addr-form">
      <label className="field-block addr-wide">
        Nombre y apellidos {showNif ? '/ empresa' : '(destinatario)'}
        <input type="text" value={value.nombre ?? ''} maxLength={120} onChange={(e) => set('nombre', e.target.value)} />
      </label>
      {showNif && (
        <label className="field-block">
          NIF / DNI
          <input type="text" value={value.nif ?? ''} maxLength={20} onChange={(e) => set('nif', e.target.value)} />
        </label>
      )}
      <label className="field-block addr-wide">
        Dirección (calle y número)
        <input type="text" value={value.linea1 ?? ''} maxLength={120} onChange={(e) => set('linea1', e.target.value)} />
      </label>
      <label className="field-block">
        Piso / puerta (opcional)
        <input type="text" value={value.linea2 ?? ''} maxLength={60} onChange={(e) => set('linea2', e.target.value)} />
      </label>
      <label className="field-block">
        Código postal
        <input type="text" inputMode="numeric" value={value.cp ?? ''} maxLength={10} onChange={(e) => set('cp', e.target.value)} />
      </label>
      <label className="field-block">
        Ciudad
        <input type="text" value={value.ciudad ?? ''} maxLength={80} onChange={(e) => set('ciudad', e.target.value)} />
      </label>
      <label className="field-block">
        Provincia
        <input type="text" value={value.provincia ?? ''} maxLength={80} onChange={(e) => set('provincia', e.target.value)} />
      </label>
      <label className="field-block">
        Teléfono (opcional)
        <input type="tel" inputMode="tel" value={value.telefono ?? ''} maxLength={20} onChange={(e) => set('telefono', e.target.value)} />
      </label>
    </div>
  );
}
