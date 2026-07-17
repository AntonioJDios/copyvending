import { useCart } from '../store/useCart';
import { CartProjectCard } from './CartProjectCard';

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items = useCart((s) => s.items);
  const total = items.reduce((s, p) => s + p.total, 0);

  const goToCart = () => {
    onClose();
    window.location.hash = 'carrito';
  };

  return (
    <div className={`cart-drawer${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="cart-overlay" onClick={onClose} />
      <aside className="cart-panel" role="dialog" aria-label="Carrito">
        <header className="cart-head">
          <span>
            Carrito {items.length > 0 && <em>· {items.length} artículo{items.length !== 1 ? 's' : ''}</em>}
          </span>
          <button type="button" className="btn btn-small" onClick={onClose}>
            Cerrar
          </button>
        </header>

        <div className="cart-body">
          {items.length === 0 ? (
            <p className="cart-empty">Tu carrito está vacío. Configura un proyecto y añádelo.</p>
          ) : (
            items.map((p) => <CartProjectCard key={p.id} project={p} onEditDone={onClose} />)
          )}
        </div>

        {items.length > 0 && (
          <footer className="cart-foot">
            <div className="cart-total">
              <span>Total</span>
              <strong>{eur(total)}</strong>
            </div>
            <button type="button" className="btn btn-primary cart-checkout" onClick={goToCart}>
              Ver carrito completo
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}
