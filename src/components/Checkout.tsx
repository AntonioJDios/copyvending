import { useEffect, useState } from 'react';
import { useCart } from '../store/useCart';
import { useOrders } from '../store/useOrders';
import { useAuth } from '../store/useAuth';
import { hasBackend } from '../lib/api';
import { registerCustomer } from '../lib/customers';
import { AccountButton } from './AccountButton';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

const STEPS = ['Datos', 'Revisar', 'Confirmado'] as const;

function itemName(p: ReturnType<typeof useCart.getState>['items'][number]): string {
  if (p.nombre.trim()) return p.nombre.trim();
  return p.kind === 'taza' ? 'Taza personalizada' : p.kind === 'chapa' ? 'Chapa personalizada' : 'Proyecto sin título';
}

function itemMeta(p: ReturnType<typeof useCart.getState>['items'][number]): string {
  if (p.kind === 'copias') {
    const total = p.docs.reduce((s, d) => s + d.pages, 0);
    return `${p.docs.length} doc. · ${total} pág.${p.copias > 1 ? ` · ×${p.copias}` : ''}`;
  }
  return `${p.cantidad} ud.`;
}

type Mode = 'guest' | 'account';

/** Kiosk/tablet checkout: no payment yet. The customer can create an account
 *  (saved with RGPD consent, so they can manage their orders and — later — pay)
 *  or continue as a guest. Minimum data: name, surname, email and phone. */
export function Checkout({ onBack }: { onBack: () => void }) {
  const items = useCart((s) => s.items);
  const clear = useCart((s) => s.clear);
  const addOrder = useOrders((s) => s.addOrder);
  const total = items.reduce((s, p) => s + p.total, 0);

  const customer = useAuth((s) => s.customer);
  const restore = useAuth((s) => s.restore);
  const loggedIn = !!customer;

  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<Mode>('guest');
  const [nombre, setNombre] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [orderId] = useState(() => `P-${Date.now().toString(36).toUpperCase().slice(-6)}`);

  // Recognise an existing session and prefill from the account.
  useEffect(() => {
    if (!customer) void restore();
  }, [customer, restore]);
  useEffect(() => {
    if (customer) {
      setNombre(customer.nombre);
      setApellidos(customer.apellidos);
      setEmail(customer.email);
      setTelefono(customer.telefono ?? '');
    }
  }, [customer]);

  const dataOk = nombre.trim().length > 0 && apellidos.trim().length > 0 && isEmail(email) && telefono.trim().length >= 6;
  const canContinue = loggedIn || (dataOk && (mode === 'guest' || consent));

  const confirm = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const data = { nombre: nombre.trim(), apellidos: apellidos.trim(), email: email.trim().toLowerCase(), telefono: telefono.trim() };
      let accountId: string | undefined;
      if (loggedIn) {
        accountId = customer!.id; // already identified → link to the account
      } else if (mode === 'account' && hasBackend) {
        accountId = await registerCustomer(data); // throws → aborts below (order not created)
      }
      await addOrder({
        id: orderId,
        createdAt: Date.now(),
        source: 'mostrador',
        customer: { ...data, accountId },
        items: items.map((p) => ({ ...p })),
        total,
        status: 'nuevo',
      });
      setStep(2);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo enviar el pedido. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };
  const finish = () => {
    clear();
    window.location.hash = '';
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>Tramitar pedido</h1>
        <nav className="topnav">
          {step < 2 && (
            <button type="button" className="btn" onClick={step === 0 ? onBack : () => setStep(step - 1)}>
              ← Atrás
            </button>
          )}
          <AccountButton />
        </nav>
      </header>

      {/* Step indicator */}
      <ol className="steps">
        {STEPS.map((label, i) => (
          <li key={label} className={`step${i === step ? ' step-on' : ''}${i < step ? ' step-done' : ''}`}>
            <span className="step-num">{i < step ? '✓' : i + 1}</span>
            <span className="step-label">{label}</span>
          </li>
        ))}
      </ol>

      <div className="checkout">
        {step === 0 && loggedIn && (
          <section className="checkout-card">
            <h2>¿A nombre de quién es el pedido?</h2>
            <p className="muted">
              Estás identificado como <b>{customer!.nombre} {customer!.apellidos}</b> · {customer!.email}
              {customer!.telefono ? ` · ${customer!.telefono}` : ''}. Usaremos los datos de tu cuenta.
            </p>
            <a className="chip" href="#cuenta">Ver mi cuenta</a>
            <button type="button" className="btn btn-primary checkout-next" onClick={() => setStep(1)}>
              Continuar
            </button>
          </section>
        )}

        {step === 0 && !loggedIn && (
          <section className="checkout-card">
            <div className="seg-toggle checkout-mode">
              <button type="button" className={mode === 'guest' ? 'on' : ''} onClick={() => setMode('guest')}>
                Continuar como invitado
              </button>
              <button type="button" className={mode === 'account' ? 'on' : ''} onClick={() => setMode('account')}>
                Crear cuenta
              </button>
            </div>
            <p className="muted checkout-mode-hint">
              {mode === 'account'
                ? 'Guardamos tus datos para que gestiones tus pedidos (y, próximamente, pagues online).'
                : 'Solo usamos tus datos para este pedido y avisarte cuando esté listo.'}
            </p>

            <div className="checkout-form">
              <label className="field-block">
                Nombre *
                <input type="text" value={nombre} autoFocus maxLength={60} onChange={(e) => setNombre(e.target.value)} />
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
                  maxLength={120}
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="para el resguardo y avisos"
                  onChange={(e) => setEmail(e.target.value.toLowerCase())}
                />
              </label>
              <label className="field-block">
                Teléfono *
                <input type="tel" value={telefono} maxLength={20} placeholder="para avisarte cuando esté listo" onChange={(e) => setTelefono(e.target.value)} />
              </label>
            </div>

            {mode === 'account' && (
              <label className="checkout-consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  He leído y acepto la{' '}
                  <a href="#privacidad" target="_blank" rel="noopener noreferrer">política de privacidad</a> y el tratamiento de mis datos.
                </span>
              </label>
            )}

            <p className="muted checkout-privacy">
              Tratamos tus datos para gestionar tu pedido conforme al RGPD. Más información en la{' '}
              <a href="#privacidad" target="_blank" rel="noopener noreferrer">política de privacidad</a>.
            </p>

            <button type="button" className="btn btn-primary checkout-next" disabled={!canContinue} onClick={() => setStep(1)}>
              Continuar
            </button>
          </section>
        )}

        {step === 1 && (
          <section className="checkout-card">
            <h2>Revisa tu pedido</h2>
            <div className="checkout-who">
              <span>
                <b>{nombre} {apellidos}</b> · {email.trim().toLowerCase()} · {telefono.trim()}
                {(loggedIn || mode === 'account') && <span className="checkout-badge">cuenta</span>}
              </span>
              <button type="button" className="chip" onClick={() => setStep(0)}>
                Editar datos
              </button>
            </div>
            <ul className="checkout-lines">
              {items.map((p) => (
                <li key={p.id}>
                  <span className="checkout-line-name">
                    {itemName(p)}
                    <span className="checkout-line-meta">{itemMeta(p)}</span>
                  </span>
                  <span>{eur(p.total)}</span>
                </li>
              ))}
            </ul>
            <div className="checkout-total">
              <span>Total (se paga en el mostrador)</span>
              <strong>{eur(total)}</strong>
            </div>
            <button type="button" className="btn btn-primary checkout-next" onClick={confirm} disabled={saving}>
              {saving ? 'Enviando…' : 'Confirmar pedido'}
            </button>
          </section>
        )}

        {step === 2 && (
          <section className="checkout-card checkout-done">
            <div className="checkout-check">✓</div>
            <h2>¡Pedido enviado!</h2>
            <p className="checkout-order">
              Nº de pedido <strong>{orderId}</strong>
            </p>
            <p className="muted">
              A nombre de <b>{nombre} {apellidos}</b>. Hemos enviado tu trabajo al mostrador.
              Pasa a recogerlo y <b>paga allí ({eur(total)})</b>; te avisaremos cuando esté listo.
            </p>
            <button type="button" className="btn btn-primary checkout-next" onClick={finish}>
              Hacer otro pedido
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
