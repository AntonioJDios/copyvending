/** User/account access next to the cart. No login yet, so for now it leads to
 *  order tracking (#recoger); it becomes the account entry with the Online module. */
export function AccountButton() {
  return (
    <a className="cart-button account-button" href="#recoger" title="Mis pedidos" aria-label="Mis pedidos">
      👤
    </a>
  );
}
