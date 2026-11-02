import { ProductCard } from "../components/ProductCard";
import { useCart } from "../hooks/useCart";
import { useProducts } from "../hooks/useProducts";

export function ProductsPage() {
  const products = useProducts();
  const { add } = useCart();
  return (
    <section aria-label="Products">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          onAdd={() => add(product.id)}
          product={product}
        />
      ))}
    </section>
  );
}
