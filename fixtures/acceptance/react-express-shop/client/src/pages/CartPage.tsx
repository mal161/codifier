import { useCart } from "../hooks/useCart";

export function CartPage() {
  const { cart, clear } = useCart();
  return (
    <section aria-label="Cart">
      <p>{cart.lines.length} items</p>
      <button onClick={clear}>Clear cart</button>
    </section>
  );
}
