import { useEffect, useState } from 'react';
import { useAuth, type MyOrder, type Address } from '../store/useAuth';
import { apiGet, hasBackend } from '../lib/api';
import { registerCustomer } from '../lib/customers';
import { AddressForm } from './AddressForm';
import { useConfigurator } from '../store/useConfigurator';
import { downloadInvoice } from '../lib/invoicePdf';
import { DEFAULT_BUSINESS } from '../domain/catalog';
import type { Order } from '../store/useOrders';

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
  const [atab, setAtab] = useState<'perfil' | 'direcciones' | 'pedidos'>('perfil');
  const [invBusy, setInvBusy] = useState<string | null>(null);
  const invoicingOn = !!useConfigurator((s) => s.catalog.invoicing)?.enabled;
  const business = useConfigurator((s) => s.catalog.business) ?? DEFAULT_BUSINESS;

  const downloadFactura = async (id: string) => {
    if (invBusy) return;
    setInvBusy(id);
    try {
      const order = await apiGet<Order>(`/orders?id=${encodeURIComponent(id)}`);
      await downloadInvoice(order, business);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo generar la factura.');
    } finally {
      setInvBusy(null);
    }
  };

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
            <nav className="admin-tabs account-tabs">
              <button type="button" className={`admin-tab${atab === 'perfil' ? ' on' : ''}`} onClick={() => setAtab('perfil')}>Perfil</button>
              <button type="button" className={`admin-tab${atab === 'direcciones' ? ' on' : ''}`} onClick={() => setAtab('direcciones')}>Direcciones</button>
              <button type="button" className={`admin-tab${atab === 'pedidos' ? ' on' : ''}`} onClick={() => setAtab('pedidos')}>Pedidos</button>
            </nav>

            {atab === 'perfil' && (
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
            )}

            {atab === 'direcciones' && (
              <section className="checkout-card">
                <h2>Mis direcciones</h2>
                <AddressesManager addresses={customer.addresses ?? []} onSave={saveAddresses} />
              </section>
            )}

            {atab === 'pedidos' && (
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
                        {invoicingOn && (
                          <button type="button" className="chip" disabled={invBusy === o.id} onClick={() => void downloadFactura(o.id)}>
                            🧾 {invBusy === o.id ? '…' : o.paid ? 'Factura' : 'Proforma'}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
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

const newAddrId = () => (globalThis.crypto?.randomUUID?.() ?? `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

/** List of saved addresses with default-shipping / default-billing badges, plus
 *  add / edit / delete / set-default — instead of two big always-open forms. */
function AddressesManager({ addresses, onSave }: { addresses: Address[]; onSave: (list: Address[]) => Promise<void> }) {
  const [editing, setEditing] = useState<Address | null>(null);
  const [busy, setBusy] = useState(false);

  const persist = async (list: Address[]) => {
    setBusy(true);
    try {
      await onSave(list);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  };

  const save = async (addr: Address) => {
    const a: Address = { ...addr, id: addr.id || newAddrId() };
    let list = addresses.map((x) => ({ ...x }));
    if (a.defaultShipping) list = list.map((x) => ({ ...x, defaultShipping: false }));
    if (a.defaultBilling) list = list.map((x) => ({ ...x, defaultBilling: false }));
    const idx = list.findIndex((x) => x.id === a.id);
    if (idx >= 0) list[idx] = a;
    else list.push(a);
    await persist(list);
    setEditing(null);
  };

  const del = async (id?: string) => {
    if (!id || !window.confirm('¿Eliminar esta dirección?')) return;
    await persist(addresses.filter((x) => x.id !== id));
  };

  const setDefault = async (id: string, kind: 'defaultShipping' | 'defaultBilling') => {
    await persist(addresses.map((x) => ({ ...x, [kind]: x.id === id })));
  };

  if (editing) return <AddressEditor initial={editing} busy={busy} onCancel={() => setEditing(null)} onSave={save} />;

  return (
    <div className="addr-list">
      {addresses.length === 0 && <p className="muted">Aún no tienes direcciones guardadas.</p>}
      {addresses.map((a) => (
        <div key={a.id} className="addr-card">
          <div className="addr-card-body">
            {(a.defaultShipping || a.defaultBilling) && (
              <div className="addr-badges">
                {a.defaultShipping && <span className="addr-badge">⭐ Envío por defecto</span>}
                {a.defaultBilling && <span className="addr-badge billing">🧾 Facturación por defecto</span>}
              </div>
            )}
            <strong>{a.label || a.nombre || a.linea1}</strong>
            <span className="muted">{[a.linea1, a.linea2].filter(Boolean).join(', ')}</span>
            <span className="muted">{[a.cp, a.ciudad, a.provincia].filter(Boolean).join(' · ')}</span>
            {a.nif && <span className="muted">NIF: {a.nif}</span>}
          </div>
          <div className="addr-card-actions">
            <button type="button" className="chip" onClick={() => setEditing(a)}>Editar</button>
            {!a.defaultShipping && <button type="button" className="chip" disabled={busy} onClick={() => void setDefault(a.id!, 'defaultShipping')}>Predet. envío</button>}
            {!a.defaultBilling && <button type="button" className="chip" disabled={busy} onClick={() => void setDefault(a.id!, 'defaultBilling')}>Predet. factura</button>}
            <button type="button" className="chip chip-danger" disabled={busy} onClick={() => void del(a.id)}>Eliminar</button>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setEditing({})}>
        + Añadir dirección
      </button>
    </div>
  );
}

function AddressEditor({ initial, busy, onCancel, onSave }: { initial: Address; busy: boolean; onCancel: () => void; onSave: (a: Address) => void }) {
  const [addr, setAddr] = useState<Address>(initial);
  const valid = !!(addr.linea1?.trim() && addr.cp?.trim() && addr.ciudad?.trim());
  return (
    <div className="addr-editor">
      <label className="field-block addr-wide">
        Etiqueta (ej. Casa, Trabajo)
        <input type="text" value={addr.label ?? ''} maxLength={40} onChange={(e) => setAddr({ ...addr, label: e.target.value })} />
      </label>
      <AddressForm value={addr} onChange={setAddr} showNif />
      <div className="addr-editor-defaults">
        <label className="chk">
          <input type="checkbox" checked={!!addr.defaultShipping} onChange={(e) => setAddr({ ...addr, defaultShipping: e.target.checked })} /> Predeterminada de envío
        </label>
        <label className="chk">
          <input type="checkbox" checked={!!addr.defaultBilling} onChange={(e) => setAddr({ ...addr, defaultBilling: e.target.checked })} /> Predeterminada de facturación
        </label>
      </div>
      <div className="addr-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !valid} onClick={() => onSave(addr)}>
          {busy ? 'Guardando…' : 'Guardar dirección'}
        </button>
        <button type="button" className="chip" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

