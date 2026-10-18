// Top picks for /tires, derived from the publicSearch result already on the
// page (no extra server call). Tiers come from the supplier-derived category.

type PickableTire = { id: string; category: "budget" | "mid" | "premium"; shopPrice: number };

export type PickKind = "lowest" | "value" | "premium";
export type TopPick<T> = { kind: PickKind; label: string; basis: string; tire: T };

/** The set price line the result list and the top-pick cards both render. */
export const setTotalLabel = (pricePerTire: number, qty: number) => `$${(pricePerTire * qty).toFixed(2)} for ${qty}`;

const cheapest = <T extends PickableTire>(tires: T[]) =>
  tires.reduce<T | undefined>((best, t) => (!best || t.shopPrice < best.shopPrice ? t : best), undefined);

export function pickTopTires<T extends PickableTire>(tires: readonly T[]): TopPick<T>[] {
  // A pick shows a price on a card, so a missing or non-positive price is never one.
  const priced = tires.filter((t) => Number.isFinite(t.shopPrice) && t.shopPrice > 0);
  const candidates = [
    { kind: "lowest", label: "Lowest price", basis: "Cheapest tire in your size", tire: cheapest(priced) },
    { kind: "value", label: "Best value", basis: "Lowest-priced mid-range tire", tire: cheapest(priced.filter((t) => t.category === "mid")) },
    { kind: "premium", label: "Premium", basis: "Lowest-priced premium tire", tire: cheapest(priced.filter((t) => t.category === "premium")) },
  ] as const;
  const seen = new Set<string>();
  const out: TopPick<T>[] = [];
  for (const c of candidates) {
    if (!c.tire || seen.has(c.tire.id)) continue;
    seen.add(c.tire.id);
    out.push({ ...c, tire: c.tire });
  }
  return out;
}
