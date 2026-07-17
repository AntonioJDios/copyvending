import { useCart } from '../store/useCart';

/** Cart button with the item-count badge. `id="cart-button"` is the fly-to-cart
 *  animation target; only one instance is mounted at a time (per route). */
export function CartButton({ onClick }: { onClick: () => void }) {
  const count = useCart((s) => s.items.length);
  return (
    <button
      id="cart-button"
      type="button"
      className="cart-button"
      onClick={onClick}
      title="Carrito"
      aria-label={`Carrito, ${count} proyecto${count !== 1 ? 's' : ''}`}
    >
      🛒
      {count > 0 && <span className="cart-badge">{count}</span>}
    </button>
  );
}
