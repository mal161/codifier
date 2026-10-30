import { add } from "@fixture/shared/math";
import { version } from "@fixture/shared";
import { add as aliasedAdd } from "@shared/math";

export const result = add(aliasedAdd(1, 2), Number(version));
