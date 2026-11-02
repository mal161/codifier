import { useEffect, useState } from "react";
import type { Cart } from "@shared/types";
import { addCartItem, clearCart, fetchCart } from "../api/client";

export function useCart() {
  const [cart, setCart] = useState<Cart>({ userId: "demo-user", lines: [] });
  useEffect(() => {
    void fetchCart().then(setCart);
  }, []);
  return {
    cart,
    add: (productId: string) => void addCartItem(productId).then(setCart),
    clear: () => void clearCart().then(() => setCart({ ...cart, lines: [] })),
  };
}
