/**
 * Length sweep on routes.ts descriptions (≤170 char limit).
 * Throwaway proof script.
 */
import { ALL_ROUTES } from "../shared/routes";

let over = 0;
for (const r of ALL_ROUTES) {
  if (r.description.length > 170) {
    console.log("OVER ", r.description.length, r.path, "·", r.description.slice(0, 80) + "…");
    over += 1;
  }
}
console.log(over === 0 ? "ALL ≤170" : `${over} over limit`);
process.exit(over === 0 ? 0 : 1);
