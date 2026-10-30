import { add } from "./math";

export function total(left: number, right: number): number {
  return add(left, right);
}

export interface Summary {
  value: number;
}
