import { useEffect, useState } from "react";
import type { Product } from "@shared/types";
import { fetchProducts } from "../api/client";

export function useProducts(): Product[] {
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    void fetchProducts().then(setProducts);
  }, []);
  return products;
}
