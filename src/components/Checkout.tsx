import { useState } from 'react';
import { useCart } from '../store/useCart';
import { useOrders } from '../store/useOrders';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

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

/** Kiosk checkout: no payment, no account — collect the customer's name so the
 *  counter can identify the job; pickup + pay in person. */
export function Checkout({ onBack }: { onBack: () => void }) {
  const items = useCart((s) => s.items);
  const clear = useCart((s) => s.clear);
  const addOrder = useOrders((s) => s.addOrder);
  const total = items.reduce((s, p) => s + p.total, 0);

  const [step, setStep] = useState(0);
  const [nombre, setNombre] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [telefono, setTelefono] = useState('');
  const [saving, setSaving] = useState(false);
  const [orderId] = useState(() => `P-${Date.now().toString(36).toUpperCase().slice(-6)}`);

  const canContinue = nombre.trim().length > 0 && apellidos.trim().length > 0;

  const confirm = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await addOrder({
        id: orderId,
        createdAt: Date.now(),
        source: 'mostrador',
        customer: { nombre: nombre.trim(), apellidos: apellidos.trim(), telefono: telefono.trim() || undefined },
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
        {step === 0 && (
          <section className="checkout-card">
            <h2>¿A nombre de quién es el pedido?</h2>
            <p className="muted">Lo usamos para localizar tu trabajo en el mostrador al recogerlo.</p>
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
                Teléfono (opcional)
                <input
                  type="tel"
                  value={telefono}
                  maxLength={20}
                  placeholder="Para avisarte cuando esté listo"
                  onChange={(e) => setTelefono(e.target.value)}
                />
              </label>
            </div>
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
                <b>{nombre} {apellidos}</b>
                {telefono.trim() && <> · {telefono.trim()}</>}
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
              Pasa a recogerlo y <b>paga allí ({eur(total)})</b>
              {telefono.trim() ? '; te avisaremos cuando esté listo.' : '.'}
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
