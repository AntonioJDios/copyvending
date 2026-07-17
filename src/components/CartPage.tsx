import { useState } from 'react';
import { useCart } from '../store/useCart';
import { deleteProjectFiles } from '../lib/projectFiles';
import { CartProjectCard } from './CartProjectCard';
import { Checkout } from './Checkout';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

export function CartPage() {
  const items = useCart((s) => s.items);
  const clear = useCart((s) => s.clear);
  const [checkout, setCheckout] = useState(false);

  if (checkout && items.length > 0) return <Checkout onBack={() => setCheckout(false)} />;
  const total = items.reduce((s, p) => s + p.total, 0);
  const displayName = (p: (typeof items)[number]) =>
    p.nombre.trim() || (p.kind === 'taza' ? 'Taza personalizada' : p.kind === 'chapa' ? 'Chapa personalizada' : 'Proyecto sin título');

  // Editing a project sends the user back to the configurator with it loaded.
  const goToConfigurator = () => {
    window.location.hash = '';
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>Tu carrito</h1>
        <nav className="topnav">
          <a className="btn" href="#">
            ← Seguir comprando
          </a>
        </nav>
      </header>

      {items.length === 0 ? (
        <div className="cart-page-empty">
          <p>Tu carrito está vacío.</p>
          <a className="btn btn-primary" href="#">
            Configurar un proyecto
          </a>
        </div>
      ) : (
        <div className="cart-page">
          <section className="cart-page-list">
            <div className="cart-page-listhead">
              <h2>
                {items.length} artículo{items.length !== 1 ? 's' : ''}
              </h2>
              <button
                type="button"
                className="chip chip-danger"
                onClick={() => {
                  items.forEach((p) => void deleteProjectFiles(p));
                  clear();
                }}
              >
                Vaciar carrito
              </button>
            </div>
            {items.map((p) => (
              <CartProjectCard key={p.id} project={p} onEditDone={goToConfigurator} />
            ))}
          </section>

          <aside className="cart-page-summary">
            <h2>Resumen</h2>
            <ul className="cart-sum-lines">
              {items.map((p) => (
                <li key={p.id}>
                  <span className="cart-sum-name">{displayName(p)}</span>
                  <span>{eur(p.total)}</span>
                </li>
              ))}
            </ul>
            <div className="cart-sum-total">
              <span>Total</span>
              <strong>{eur(total)}</strong>
            </div>
            <p className="cart-sum-note">El precio se confirmará al tramitar el pedido.</p>
            <button type="button" className="btn btn-primary cart-checkout" onClick={() => setCheckout(true)}>
              Tramitar pedido
            </button>
            <a className="btn cart-continue" href="#">
              Añadir otro proyecto
            </a>
          </aside>
        </div>
      )}
    </div>
  );
}
