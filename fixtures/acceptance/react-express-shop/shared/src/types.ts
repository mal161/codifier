export interface Product {
  id: string;
  name: string;
  priceCents: number;
}

export interface CartLine {
  productId: string;
  quantity: number;
}

export interface Cart {
  userId: string;
  lines: CartLine[];
}

export function formatPrice(priceCents: number): string {
  return `$${(priceCents / 100).toFixed(2)}`;
}
