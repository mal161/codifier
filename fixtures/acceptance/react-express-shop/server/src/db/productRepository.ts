import type { Product } from "@shared/types";

export const productRepository = new Map<string, Product>([
  ["p-1", { id: "p-1", name: "Notebook", priceCents: 450 }],
  ["p-2", { id: "p-2", name: "Fountain pen", priceCents: 2900 }],
]);
