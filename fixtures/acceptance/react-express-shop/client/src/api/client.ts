import type { Cart, Product } from "@shared/types";

const userHeaders = {
  "x-user-id": "demo-user",
  "content-type": "application/json",
};

export async function fetchProducts(): Promise<Product[]> {
  const response = await fetch("/api/products");
  return response.json();
}

export async function fetchCart(): Promise<Cart> {
  const response = await fetch("/api/cart", { headers: userHeaders });
  return response.json();
}

export async function addCartItem(productId: string): Promise<Cart> {
  const response = await fetch("/api/cart/items", {
    method: "POST",
    headers: userHeaders,
    body: JSON.stringify({ productId }),
  });
  return response.json();
}

export async function clearCart(): Promise<void> {
  await fetch("/api/cart", { method: "DELETE", headers: userHeaders });
}
