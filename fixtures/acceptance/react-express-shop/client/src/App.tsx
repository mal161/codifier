import { useState } from "react";
import { CartPage } from "./pages/CartPage";
import { ProductsPage } from "./pages/ProductsPage";

export function App() {
  const [view, setView] = useState<"products" | "cart">("products");
  return (
    <main>
      <nav>
        <button onClick={() => setView("products")}>Products</button>
        <button onClick={() => setView("cart")}>Cart</button>
      </nav>
      {view === "products" ? <ProductsPage /> : <CartPage />}
    </main>
  );
}
