import { useAuth } from '../store/useAuth';

/** User/account access next to the cart: passwordless login + "my orders".
 *  Shows the customer's initial when authenticated, a generic icon otherwise. */
export function AccountButton() {
  const customer = useAuth((s) => s.customer);
  const initial = customer?.nombre?.trim().charAt(0).toUpperCase() || '';
  return (
    <a
      className="cart-button account-button"
      href="#cuenta"
      title={customer ? `Mi cuenta · ${customer.nombre}` : 'Acceder / Mi cuenta'}
      aria-label={customer ? `Mi cuenta (${customer.nombre})` : 'Acceder'}
    >
      {customer ? <span className="account-avatar">{initial}</span> : '👤'}
    </a>
  );
}
