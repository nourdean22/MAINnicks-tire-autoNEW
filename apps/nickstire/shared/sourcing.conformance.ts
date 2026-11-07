/**
 * Supplier adapter conformance: every adapter (Gateway today, parts suppliers later) passes this before its offers
 * reach compareOffers. Each adapter's own test calls adapterConformanceProblems with recorded fixtures and expects [].
 */
import { SUPPLIER_SCHEDULES, UNKNOWN, type SupplierOffer, type SupplierSchedule } from "./sourcing";

export interface AdapterUnderTest<Raw> {
  supplierId: string;
  /** false when the supplier's data never carries a delivery or cutoff time (Gateway's search does not). */
  statesArrivalTimes: boolean;
  /** Branch codes proven orderable from this account; any other "yes" is a claim the adapter cannot back. */
  confirmedOrderableBranches: readonly string[];
  toOffers(raw: Raw, ctx: { size: string; verifiedAt: string }): SupplierOffer[];
  fixtures: { typical: Raw; zeroStock: Raw; missingEverything: Raw };
}

const CTX = { size: "225/65R17", verifiedAt: "2026-11-06T15:00:00.000Z" };
const blank = (v: unknown) => v === null || v === undefined;
const badNumber = (v: unknown) => typeof v === "number" && (!Number.isFinite(v) || v < 0);

/** One line per broken rule, "rule: detail". Empty means the adapter conforms. */
export function adapterConformanceProblems<Raw>(
  a: AdapterUnderTest<Raw>,
  schedules: Readonly<Record<string, SupplierSchedule>> = SUPPLIER_SCHEDULES,
): string[] {
  const problems: string[] = [];
  const out: Record<keyof AdapterUnderTest<Raw>["fixtures"], SupplierOffer[]> = { typical: [], zeroStock: [], missingEverything: [] };

  for (const name of Object.keys(out) as (keyof typeof out)[]) {
    const raw = a.fixtures[name];
    const before = JSON.stringify(raw);
    const first = a.toOffers(raw, CTX);
    if (JSON.stringify(raw) !== before) problems.push(`pure: toOffers changed its ${name} input`);
    else if (JSON.stringify(a.toOffers(raw, CTX)) !== JSON.stringify(first)) problems.push(`pure: ${name} gave two different answers`);
    out[name] = first;
  }

  if (!out.typical.some((o) => o.locations.length > 0)) problems.push("located: the typical fixture produced no offer location");

  for (const [name, offers] of Object.entries(out)) {
    for (const o of offers) {
      const at = `${name} ${o.sku}`;
      for (const f of ["unitPrice", "fet", "core", "priceStatus", "lastVerifiedAt"] as const) {
        if (blank(o[f])) problems.push(`no-null: ${at} ${f} is ${String(o[f])}, use UNKNOWN`);
      }
      if (badNumber(o.unitPrice) || badNumber(o.fet) || badNumber(o.core)) problems.push(`numbers: ${at} has a negative or non-finite price`);
      const hasPrice = typeof o.unitPrice === "number" && o.unitPrice > 0;
      if ((o.priceStatus === "priced") !== hasPrice) problems.push(`price-status: ${at} is ${o.priceStatus} with unitPrice ${String(o.unitPrice)}`);
      if (o.lastVerifiedAt !== CTX.verifiedAt) problems.push(`verified-at: ${at} stamped ${o.lastVerifiedAt}, not the lookup time`);
      if (o.supplierId !== a.supplierId || !schedules[o.supplierId]) problems.push(`schedule: ${at} supplier ${o.supplierId} has no schedule row`);
      const codes = new Set<string>();
      for (const l of o.locations) {
        const where = `${at}@${l.branchCode}`;
        if (codes.has(l.branchCode)) problems.push(`branch-unique: ${where} appears twice`);
        codes.add(l.branchCode);
        for (const v of [l.qty, l.orderable, l.kind, l.arrival?.at, l.arrival?.orderBy, l.fulfillmentMode]) {
          if (blank(v)) problems.push(`no-null: ${where} has a null or missing field, use UNKNOWN`);
        }
        if (badNumber(l.qty)) problems.push(`numbers: ${where} qty ${String(l.qty)}`);
        if (!a.statesArrivalTimes && (l.arrival.at !== UNKNOWN || l.arrival.orderBy !== UNKNOWN)) {
          problems.push(`no-invented-times: ${where} has a time the supplier never states`);
        }
        if (l.orderable === "yes" && !a.confirmedOrderableBranches.includes(l.branchCode)) {
          problems.push(`orderable: ${where} claims orderable without proof`);
        }
      }
    }
  }

  for (const o of out.missingEverything) {
    const known = o.locations.some((l) => l.qty !== UNKNOWN) || o.unitPrice !== UNKNOWN || o.fet !== UNKNOWN;
    if (known) problems.push(`unknown-not-zero: missing fields in ${o.sku} came out as values, not UNKNOWN`);
  }
  if (!out.zeroStock.some((o) => o.locations.some((l) => l.qty === 0))) problems.push("zero-is-zero: a stated 0 did not come out as 0");

  return problems;
}
