import type { Product } from "@shared/types";
import { productRepository } from "../db/productRepository";

export function listProducts(): Product[] {
  return [...productRepository.values()];
}

export function getProduct(id: string): Product | undefined {
  return productRepository.get(id);
}
