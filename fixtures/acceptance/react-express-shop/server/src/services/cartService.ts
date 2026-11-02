import type { Cart } from "@shared/types";
import { cartRepository } from "../db/cartRepository";
import { getProduct } from "./productService";

export function getCart(userId: string): Cart {
  return cartRepository.get(userId) ?? { userId, lines: [] };
}

export function addToCart(
  userId: string,
  productId: string,
  quantity: number,
): Cart {
  if (!getProduct(productId)) throw new Error(`Unknown product ${productId}`);
  const cart = getCart(userId);
  const line = cart.lines.find((item) => item.productId === productId);
  if (line) line.quantity += quantity;
  else cart.lines.push({ productId, quantity });
  cartRepository.set(userId, cart);
  return cart;
}
