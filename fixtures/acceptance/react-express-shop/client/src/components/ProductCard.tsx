import { formatPrice, type Product } from "@shared/types";

export function ProductCard({
  product,
  onAdd,
}: {
  product: Product;
  onAdd: () => void;
}) {
  return (
    <article>
      <h2>{product.name}</h2>
      <p>{formatPrice(product.priceCents)}</p>
      <button onClick={onAdd}>Add to cart</button>
    </article>
  );
}
