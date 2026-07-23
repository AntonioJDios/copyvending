import { useEffect, useMemo, useState } from 'react';
import { useCart } from '../store/useCart';
import { useOrders } from '../store/useOrders';
import { useAuth, type Address } from '../store/useAuth';
import { useConfigurator } from '../store/useConfigurator';
import { DEFAULT_PAYMENTS } from '../domain/catalog';
import { hasBackend } from '../lib/api';
import { registerCustomer } from '../lib/customers';
import { shippingQuote } from '../lib/shipping';
import { payWithRedsys, authorizeInsite, getRedsysConfig, type RedsysConfig } from '../lib/redsys';
import { AccountButton } from './AccountButton';
import { AddressForm } from './AddressForm';
import { InSiteForm } from './InSiteForm';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

const STEPS = ['Datos', 'Revisar', 'Pago', 'Confirmado'] as const;

// InSite (formulario embebido) requiere que la entidad lo active en el terminal y
// autorice el dominio del comercio; si no, Redsys rechaza el iframe. Mientras,
// el pago online va por redirección (funciona igual y es igual de seguro).
const INSITE_ENABLED = false;

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

type Mode = 'login' | 'guest' | 'account';

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
  const requestLink = useAuth((s) => s.requestLink);
  const verifyCode = useAuth((s) => s.verifyCode);
  const setDefaultBilling = useAuth((s) => s.setDefaultBilling);
  const loggedIn = !!customer;

  const payments = useConfigurator((s) => s.catalog.payments) ?? DEFAULT_PAYMENTS;
  const localPay = payments.local ?? DEFAULT_PAYMENTS.local;
  const invoicing = useConfigurator((s) => s.catalog.invoicing);
  const invoicingOn = !!invoicing?.enabled;
  const shippingCfg = useConfigurator((s) => s.catalog.shipping);
  const shippingOn = !!shippingCfg?.enabled;

  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<Mode>('guest');
  const [nombre, setNombre] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [billingAddr, setBillingAddr] = useState<Address>({});
  const [delivery, setDelivery] = useState<'recoger' | 'envio'>('recoger');
  const [shipAddr, setShipAddr] = useState<Address>({});
  const [payMethod, setPayMethod] = useState<'local' | 'redsys'>('local');
  const [redsysConfig, setRedsysConfig] = useState<RedsysConfig | null>(null);
  const [payError, setPayError] = useState('');
  const [saving, setSaving] = useState(false);
  // Stable Redsys order number for the InSite form (must match the authorisation).
  const dsOrder = useMemo(() => (String(Date.now()).slice(-10) + Math.floor(10 + Math.random() * 89)).slice(0, 12), []);

  const billingValid = !!(billingAddr.linea1?.trim() && billingAddr.cp?.trim() && billingAddr.ciudad?.trim());
  const quote = shippingOn && delivery === 'envio' && shippingCfg ? shippingQuote(shippingCfg, shipAddr.cp ?? '', total) : null;
  const shippingCost = quote?.cost ?? 0;
  const grandTotal = total + shippingCost;
  const shipValid = !!(shipAddr.linea1?.trim() && shipAddr.cp?.trim() && shipAddr.ciudad?.trim());
  const deliveryOk = !shippingOn || delivery === 'recoger' || (!!quote && quote.allowed && shipValid);
  // Home delivery requires prepayment (no pay-at-counter) → online (Redsys).
  const requiresPrepay = shippingOn && delivery === 'envio';
  const redsysOn = !!payments.redsys?.enabled;
  const canLocal = localPay.enabled && !requiresPrepay; // no pay-at-counter for delivery
  const canOnline = redsysOn;
  // Resolved payment method for this order.
  const payResolved: 'local' | 'redsys' | null = requiresPrepay
    ? (canOnline ? 'redsys' : null)
    : payMethod === 'redsys' && canOnline
      ? 'redsys'
      : canLocal
        ? 'local'
        : canOnline
          ? 'redsys'
          : null;
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
      const defBilling = customer.addresses?.find((a) => a.defaultBilling) ?? customer.addresses?.[0];
      if (defBilling) setBillingAddr(defBilling);
      const defShip = customer.addresses?.find((a) => a.defaultShipping) ?? customer.addresses?.[0];
      if (defShip) setShipAddr(defShip);
    }
  }, [customer]);

  // Load the Redsys config for the InSite form (only if InSite is enabled).
  useEffect(() => {
    if (INSITE_ENABLED && canOnline && !redsysConfig) getRedsysConfig().then(setRedsysConfig).catch(() => {});
  }, [canOnline, redsysConfig]);

  const dataOk = nombre.trim().length > 0 && apellidos.trim().length > 0 && isEmail(email) && telefono.trim().length >= 6;
  const canContinue = loggedIn || (dataOk && (mode === 'guest' || consent));

  // Create the order in the backend (idempotent by id). Returns nothing; the
  // caller decides what to do next (finish / go to Redsys).
  const placeOrder = async (payVia: 'local' | 'redsys') => {
    const data = { nombre: nombre.trim(), apellidos: apellidos.trim(), email: email.trim().toLowerCase(), telefono: telefono.trim() };
    let accountId: string | undefined;
    if (loggedIn) accountId = customer!.id;
    else if (mode === 'account' && hasBackend) accountId = await registerCustomer(data);
    const billing = invoicingOn && billingValid ? billingAddr : undefined;
    const shippingUsed = shippingOn && delivery === 'envio' ? shipAddr : undefined;
    await addOrder({
      id: orderId,
      createdAt: Date.now(),
      source: 'mostrador',
      customer: { ...data, accountId, billing, shipping: shippingUsed },
      items: items.map((p) => ({ ...p })),
      total: grandTotal,
      status: 'nuevo',
      paid: false,
      paymentMethod: payVia,
      shippingMethod: shippingOn ? delivery : undefined,
      shippingCost,
    });
    if (loggedIn && billing) void setDefaultBilling(billing).catch(() => {});
  };

  // Pay at the counter (local): just record the order and finish.
  const finishLocal = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await placeOrder('local');
      setStep(3);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo enviar el pedido. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };
  // Online via InSite: the card was tokenised on our page (idOper) → authorise.
  const payInsite = async (idOper: string) => {
    if (invoicingOn && !billingValid) {
      setPayError('Completa la dirección de facturación.');
      return;
    }
    if (saving) return;
    setSaving(true);
    setPayError('');
    try {
      await placeOrder('redsys');
      clear();
      await authorizeInsite(orderId, idOper, dsOrder);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'No se pudo procesar el pago.');
      setSaving(false);
    }
  };
  // Pay on the Redsys hosted page (redirection). `method`: card | bizum | both.
  const payRedirect = async (method?: 'card' | 'bizum') => {
    if (invoicingOn && !billingValid) {
      setPayError('Completa la dirección de facturación.');
      return;
    }
    if (saving) return;
    setSaving(true);
    setPayError('');
    try {
      await placeOrder('redsys');
      clear();
      await payWithRedsys(orderId, method);
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'No se pudo iniciar el pago.');
      setSaving(false);
    }
  };
  const onSendCode = async () => {
    if (authBusy || !isEmail(email)) return;
    setAuthBusy(true);
    setAuthError('');
    try {
      await requestLink(email.trim().toLowerCase());
      setCodeSent(true);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'No se pudo enviar el código.');
    } finally {
      setAuthBusy(false);
    }
  };
  const onVerifyCode = async () => {
    if (authBusy || code.length !== 6) return;
    setAuthBusy(true);
    setAuthError('');
    try {
      await verifyCode(email.trim().toLowerCase(), code);
      // On success the session is set → this component re-renders as "identified".
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Código no válido o caducado.');
    } finally {
      setAuthBusy(false);
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
          {step < 3 && (
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
              <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
                Entrar
              </button>
              <button type="button" className={mode === 'guest' ? 'on' : ''} onClick={() => setMode('guest')}>
                Invitado
              </button>
              <button type="button" className={mode === 'account' ? 'on' : ''} onClick={() => setMode('account')}>
                Crear cuenta
              </button>
            </div>

            {mode === 'login' ? (
              <div className="checkout-login">
                <p className="muted checkout-mode-hint">
                  ¿Ya tienes cuenta? Te enviamos un código a tu email y sigues con el pedido aquí mismo.
                </p>
                <label className="field-block">
                  Email
                  <input
                    type="email"
                    value={email}
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={codeSent}
                    placeholder="tu@email.com"
                    onChange={(e) => setEmail(e.target.value.toLowerCase())}
                  />
                </label>
                {codeSent && (
                  <label className="field-block">
                    Código (6 dígitos)
                    <input
                      type="text"
                      inputMode="numeric"
                      autoFocus
                      value={code}
                      maxLength={6}
                      placeholder="123456"
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void onVerifyCode();
                      }}
                    />
                  </label>
                )}
                {authError && <p className="recover-error">⚠ {authError}</p>}
                {!codeSent ? (
                  <button type="button" className="btn btn-primary checkout-next" onClick={() => void onSendCode()} disabled={authBusy || !isEmail(email)}>
                    {authBusy ? 'Enviando…' : 'Enviar código'}
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn btn-primary checkout-next" onClick={() => void onVerifyCode()} disabled={authBusy || code.length !== 6}>
                      {authBusy ? 'Entrando…' : 'Entrar y continuar'}
                    </button>
                    <button type="button" className="chip" style={{ marginTop: 8 }} onClick={() => { setCodeSent(false); setCode(''); setAuthError(''); }}>
                      Cambiar email / reenviar
                    </button>
                  </>
                )}
              </div>
            ) : (
              <>
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
              </>
            )}
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
            {shippingOn && (
              <div className="checkout-delivery">
                <h3 className="addr-title">Entrega</h3>
                <div className="seg-toggle checkout-mode">
                  <button type="button" className={delivery === 'recoger' ? 'on' : ''} onClick={() => setDelivery('recoger')}>Recoger en tienda</button>
                  <button type="button" className={delivery === 'envio' ? 'on' : ''} onClick={() => setDelivery('envio')}>Envío a domicilio</button>
                </div>
                {delivery === 'envio' && (
                  <>
                    {shippingCfg?.info?.trim() && <p className="muted checkout-mode-hint">{shippingCfg.info}</p>}
                    <AddressForm value={shipAddr} onChange={setShipAddr} />
                    {shipAddr.cp?.trim() && quote && !quote.allowed && (
                      <p className="recover-error">⚠ No realizamos envíos a ese código postal (Canarias no disponible).</p>
                    )}
                    {quote?.allowed && !quote.free && quote.toFree > 0 && (
                      <p className="free-ship-hint">🚚 ¡Añade <b>{eur(quote.toFree)}</b> más y el envío te sale <b>gratis</b>!</p>
                    )}
                    {quote?.allowed && quote.free && <p className="free-ship-ok">✓ ¡Enhorabuena, tu envío es gratis!</p>}
                    <p className="muted">ℹ️ Los envíos requieren <b>pago online</b>{redsysOn ? ' (tarjeta o Bizum, en el paso siguiente).' : ' (aún no activo).'}</p>
                  </>
                )}
              </div>
            )}

            {shippingOn && delivery === 'envio' && quote?.allowed && (
              <div className="checkout-total checkout-subline">
                <span>Envío {quote.zone === 'baleares' ? '(Baleares)' : '(Península)'}</span>
                <span>{shippingCost === 0 ? 'Gratis' : eur(shippingCost)}</span>
              </div>
            )}
            <div className="checkout-total">
              <span>Total</span>
              <strong>{eur(grandTotal)}</strong>
            </div>
            <button type="button" className="btn btn-primary checkout-next" onClick={() => setStep(2)} disabled={!deliveryOk}>
              {deliveryOk ? 'Continuar al pago' : 'Completa la dirección de envío'}
            </button>
          </section>
        )}

        {step === 2 && (
          <section className="checkout-card">
            <h2>Pago</h2>

            {invoicingOn && (
              <div className="checkout-billing">
                <h3 className="addr-title">🧾 Dirección de facturación</h3>
                <p className="muted">La usaremos para tu factura. {loggedIn ? 'Se guardará como predeterminada.' : ''}</p>
                <AddressForm value={billingAddr} onChange={setBillingAddr} showNif />
              </div>
            )}

            {payResolved === null ? (
              requiresPrepay ? (
                <p className="muted">
                  🚚 El <b>envío a domicilio</b> requiere <b>pago online</b>, que no está activo. Vuelve atrás y elige{' '}
                  <b>Recoger en tienda</b>, o pide a la copistería que active el pago online.
                </p>
              ) : (
                <p className="muted">No hay métodos de pago disponibles ahora mismo. Contacta con la copistería.</p>
              )
            ) : (
              <>
                {canLocal && canOnline && (
                  <>
                    <label className={`pay-opt${payResolved === 'local' ? ' on' : ''}`}>
                      <input type="radio" name="paymethod" checked={payResolved === 'local'} onChange={() => setPayMethod('local')} />
                      <span>🏪 <b>{localPay.label}</b> · <span className="muted">pagas {eur(grandTotal)} en el mostrador</span></span>
                    </label>
                    <label className={`pay-opt${payResolved === 'redsys' ? ' on' : ''}`}>
                      <input type="radio" name="paymethod" checked={payResolved === 'redsys'} onChange={() => setPayMethod('redsys')} />
                      <span>💳 <b>Pagar ahora</b> (tarjeta o Bizum) · <span className="muted">{eur(grandTotal)}</span></span>
                    </label>
                  </>
                )}

                {payResolved === 'local' ? (
                  <>
                    <div className="pay-choice on">
                      <span className="pay-choice-name">🏪 <b>{localPay.label}</b></span>
                      <span className="muted">Pagas <b>{eur(grandTotal)}</b> en el mostrador al recoger el pedido.</span>
                    </div>
                    <button type="button" className="btn btn-primary checkout-next" onClick={() => void finishLocal()} disabled={saving || (invoicingOn && !billingValid)}>
                      {saving ? 'Enviando…' : invoicingOn && !billingValid ? 'Completa la dirección de facturación' : 'Confirmar pedido'}
                    </button>
                  </>
                ) : (
                  <div className="insite-wrap">
                    <p className="muted">💳 Pago seguro con tarjeta o Bizum ({eur(grandTotal)}).</p>
                    {invoicingOn && !billingValid ? (
                      <p className="muted">Completa la dirección de facturación de arriba para pagar.</p>
                    ) : INSITE_ENABLED && redsysConfig ? (
                      <>
                        <InSiteForm config={redsysConfig} order={dsOrder} onToken={(id) => void payInsite(id)} onError={setPayError} />
                        <button type="button" className="chip" style={{ marginTop: 8 }} onClick={() => void payRedirect()} disabled={saving}>
                          ¿Problemas con el formulario? Pagar en la pasarela
                        </button>
                      </>
                    ) : (
                      <div className="pay-online-btns">
                        <button type="button" className="btn btn-primary checkout-next" onClick={() => void payRedirect('card')} disabled={saving}>
                          {saving ? 'Redirigiendo…' : '💳 Pagar con tarjeta'}
                        </button>
                        <button type="button" className="btn checkout-next pay-bizum" onClick={() => void payRedirect('bizum')} disabled={saving}>
                          Pagar con Bizum
                        </button>
                      </div>
                    )}
                    {saving && <p className="muted">Procesando…</p>}
                    {payError && <p className="recover-error">⚠ {payError}</p>}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="checkout-card checkout-done">
            <div className="checkout-check">✓</div>
            <h2>¡Pedido enviado!</h2>
            <p className="checkout-order">
              Nº de pedido <strong>{orderId}</strong>
            </p>
            <p className="muted">
              A nombre de <b>{nombre} {apellidos}</b>.{' '}
              {shippingOn && delivery === 'envio'
                ? <>Te lo enviaremos a tu dirección. Importe total <b>{eur(grandTotal)}</b>.</>
                : <>Pasa a recogerlo y <b>paga allí ({eur(grandTotal)})</b>; te avisaremos cuando esté listo.</>}
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
